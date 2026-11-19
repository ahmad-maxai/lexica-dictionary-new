#!/usr/bin/env python3
"""
Lexica English Dictionary Compiler
Compiles Wiktionary JSONL data (via Kaikki.org / Wiktextract) into a verified,
indexed, FTS5-enabled offline SQLite database.

Preserves:
- Distinct parts of speech and senses per headword
- Exact definitions without rewriting
- IPA pronunciations and audio filenames
- Authentic example sentences and usage quotations
- Inflected word forms (plurals, verb tenses, comparatives)
- Etymology and lexical tags
- Source provenance and CC BY-SA 4.0 license attribution
"""

import argparse
import gzip
import json
import os
import sqlite3
import sys
import time
from typing import Dict, List, Optional, Tuple, Any


SOURCE_INFO = {
    "id": "src-kaikki-enwiktionary",
    "name": "Wiktionary English Lexicon via Kaikki.org",
    "license": "CC BY-SA 4.0",
    "attribution_text": "Extracted from English Wiktionary by Kaikki.org (Wiktextract). Copyright Wikimedia Contributors and Tatu Ylönen.",
    "source_url": "https://kaikki.org/dictionary/English/",
    "dataset_version": "2026.11-wiktionary-en",
}

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution_text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    dataset_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    headword TEXT NOT NULL,
    headword_lower TEXT NOT NULL,
    part_of_speech TEXT NOT NULL,
    primary_ipa TEXT,
    all_ipas TEXT, -- JSON array of all IPA transcriptions with dialects
    audio_file TEXT,
    etymology TEXT,
    source_id TEXT NOT NULL REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS senses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    sense_number INTEGER NOT NULL,
    definition TEXT NOT NULL,
    tags TEXT,       -- JSON array of usage/domain tags
    examples TEXT,   -- JSON array of {text, ref}
    synonyms TEXT,   -- JSON array of string terms
    antonyms TEXT    -- JSON array of string terms
);

CREATE TABLE IF NOT EXISTS word_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    form TEXT NOT NULL,
    form_lower TEXT NOT NULL,
    tags TEXT        -- JSON array of inflection tags (e.g. plural, past)
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    entry_id UNINDEXED,
    headword,
    headword_lower,
    part_of_speech,
    definitions_text,
    tokenize = 'unicode61 remove_diacritics 1'
);

CREATE INDEX IF NOT EXISTS idx_entries_headword ON entries(headword);
CREATE INDEX IF NOT EXISTS idx_entries_headword_lower ON entries(headword_lower);
CREATE INDEX IF NOT EXISTS idx_entries_pos ON entries(part_of_speech);
CREATE INDEX IF NOT EXISTS idx_senses_entry_id ON senses(entry_id, sense_number);
CREATE INDEX IF NOT EXISTS idx_word_forms_lower ON word_forms(form_lower);
CREATE INDEX IF NOT EXISTS idx_word_forms_entry_id ON word_forms(entry_id);
"""


def extract_definition(sense: Dict[str, Any]) -> Optional[str]:
    """Extracts the cleanest, most specific definition gloss."""
    glosses = sense.get("glosses")
    if glosses and isinstance(glosses, list) and len(glosses) > 0:
        # In Kaikki, glosses is often [broad_category, specific_definition]
        # The last element is the precise definition.
        def_str = str(glosses[-1]).strip()
        if def_str:
            return def_str
    raw_glosses = sense.get("raw_glosses")
    if raw_glosses and isinstance(raw_glosses, list) and len(raw_glosses) > 0:
        def_str = str(raw_glosses[-1]).strip()
        if def_str:
            return def_str
    return None


def extract_examples(sense: Dict[str, Any]) -> List[Dict[str, str]]:
    """Extracts authentic example sentences."""
    res = []
    raw_examples = sense.get("examples", [])
    if isinstance(raw_examples, list):
        for ex in raw_examples:
            if isinstance(ex, dict):
                text = ex.get("text", "").strip()
                ref = ex.get("ref", "").strip()
                if text:
                    res.append({"text": text, "ref": ref})
            elif isinstance(ex, str) and ex.strip():
                res.append({"text": ex.strip(), "ref": ""})
    return res


def extract_pronunciations(sounds: List[Dict[str, Any]]) -> Tuple[Optional[str], str, Optional[str]]:
    """Extracts primary IPA, all IPAs as JSON, and primary audio filename."""
    if not sounds or not isinstance(sounds, list):
        return None, "[]", None

    ipas = []
    primary_ipa = None
    audio_file = None

    for s in sounds:
        if not isinstance(s, dict):
            continue
        ipa_val = s.get("ipa")
        if ipa_val:
            tags = s.get("tags", [])
            ipas.append({"ipa": ipa_val, "tags": tags})
            if not primary_ipa:
                # Prefer UK / US or first found
                primary_ipa = ipa_val
            elif any("US" in t or "Received-Pronunciation" in t or "UK" in t for t in tags):
                primary_ipa = ipa_val

        if not audio_file and s.get("audio"):
            audio_file = s.get("audio")

    return primary_ipa, json.dumps(ipas, ensure_ascii=False), audio_file


def compile_dictionary(
    source_path: str,
    output_db_path: str,
    max_entries: Optional[int] = None,
    batch_size: int = 5000,
) -> Dict[str, Any]:
    """Compiles source JSONL dataset into optimized SQLite database."""
    start_time = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(output_db_path)), exist_ok=True)

    if os.path.exists(output_db_path):
        os.remove(output_db_path)

    conn = sqlite3.connect(output_db_path)
    conn.execute("PRAGMA journal_mode = MEMORY;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -64000;")
    conn.executescript(SCHEMA_SQL)

    # Insert source record
    conn.execute(
        """INSERT INTO sources (id, name, license, attribution_text, source_url, dataset_version)
           VALUES (:id, :name, :license, :attribution_text, :source_url, :dataset_version);""",
        SOURCE_INFO,
    )
    conn.commit()

    stats = {
        "lines_scanned": 0,
        "accepted_entries": 0,
        "distinct_headwords": set(),
        "total_senses": 0,
        "records_with_ipa": 0,
        "records_with_examples": 0,
        "records_with_forms": 0,
        "rejected_non_english": 0,
        "rejected_no_definitions": 0,
        "rejected_malformed": 0,
        "rejected_redirect_only": 0,
    }

    # Open dataset (supports .gz and uncompressed .jsonl)
    is_gz = source_path.endswith(".gz")
    file_open = gzip.open(source_path, "rt", encoding="utf-8") if is_gz else open(source_path, "r", encoding="utf-8")

    entries_batch = []
    senses_batch = []
    forms_batch = []
    fts_batch = []

    current_entry_id = 0

    print(f"[*] Starting compilation from {source_path} -> {output_db_path}...")

    with file_open as f:
        for line in f:
            stats["lines_scanned"] += 1
            if not line.strip():
                continue

            try:
                rec = json.loads(line)
            except Exception:
                stats["rejected_malformed"] += 1
                continue

            # 1. Verify language is English
            lang = rec.get("lang")
            lang_code = rec.get("lang_code")
            if lang != "English" and lang_code != "en":
                stats["rejected_non_english"] += 1
                continue

            headword = rec.get("word", "").strip()
            if not headword or headword.startswith("Wiktionary:") or headword.startswith("Template:"):
                stats["rejected_malformed"] += 1
                continue

            pos = rec.get("pos", "noun").strip().lower()

            # 2. Extract valid senses and definitions
            raw_senses = rec.get("senses", [])
            valid_senses = []
            for s in raw_senses:
                definition = extract_definition(s)
                if not definition:
                    continue
                # Check if it's purely a form-of redirect without description
                tags = s.get("tags", [])
                examples = extract_examples(s)
                synonyms = [syn.get("word") if isinstance(syn, dict) else syn for syn in s.get("synonyms", []) if syn]
                antonyms = [ant.get("word") if isinstance(ant, dict) else ant for ant in s.get("antonyms", []) if ant]

                valid_senses.append({
                    "definition": definition,
                    "tags": json.dumps(tags, ensure_ascii=False) if tags else None,
                    "examples": json.dumps(examples, ensure_ascii=False) if examples else None,
                    "synonyms": json.dumps(synonyms, ensure_ascii=False) if synonyms else None,
                    "antonyms": json.dumps(antonyms, ensure_ascii=False) if antonyms else None,
                    "has_examples": len(examples) > 0,
                })

            if not valid_senses:
                if rec.get("redirect"):
                    stats["rejected_redirect_only"] += 1
                else:
                    stats["rejected_no_definitions"] += 1
                continue

            # 3. Extract pronunciations
            primary_ipa, all_ipas, audio_file = extract_pronunciations(rec.get("sounds", []))
            etymology = rec.get("etymology_text")

            # 4. Extract word forms
            raw_forms = rec.get("forms", [])
            entry_forms = []
            if isinstance(raw_forms, list):
                for f_item in raw_forms:
                    if isinstance(f_item, dict):
                        f_str = f_item.get("form", "").strip()
                        if f_str and f_str != headword:
                            f_tags = f_item.get("tags", [])
                            entry_forms.append((
                                f_str,
                                f_str.lower(),
                                json.dumps(f_tags, ensure_ascii=False) if f_tags else None
                            ))

            # 5. Accumulate entry
            current_entry_id += 1
            headword_lower = headword.lower()

            entries_batch.append((
                current_entry_id,
                headword,
                headword_lower,
                pos,
                primary_ipa,
                all_ipas,
                audio_file,
                etymology,
                SOURCE_INFO["id"],
            ))

            stats["distinct_headwords"].add(headword_lower)
            stats["accepted_entries"] += 1

            if primary_ipa:
                stats["records_with_ipa"] += 1

            has_any_example = False
            for s_idx, s_data in enumerate(valid_senses, start=1):
                senses_batch.append((
                    current_entry_id,
                    s_idx,
                    s_data["definition"],
                    s_data["tags"],
                    s_data["examples"],
                    s_data["synonyms"],
                    s_data["antonyms"],
                ))
                stats["total_senses"] += 1
                if s_data["has_examples"]:
                    has_any_example = True

            if has_any_example:
                stats["records_with_examples"] += 1

            for form_str, form_lower, form_tags in entry_forms:
                forms_batch.append((
                    current_entry_id,
                    form_str,
                    form_lower,
                    form_tags,
                ))

            if entry_forms:
                stats["records_with_forms"] += 1

            # Prepare FTS text
            defs_text = " | ".join(s_data["definition"] for s_data in valid_senses)
            fts_batch.append((
                current_entry_id,
                headword,
                headword_lower,
                pos,
                defs_text,
            ))

            # Batch flush
            if len(entries_batch) >= batch_size:
                conn.executemany(
                    """INSERT INTO entries (id, headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology, source_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
                    entries_batch,
                )
                conn.executemany(
                    """INSERT INTO senses (entry_id, sense_number, definition, tags, examples, synonyms, antonyms)
                       VALUES (?, ?, ?, ?, ?, ?, ?);""",
                    senses_batch,
                )
                conn.executemany(
                    """INSERT INTO word_forms (entry_id, form, form_lower, tags)
                       VALUES (?, ?, ?, ?);""",
                    forms_batch,
                )
                conn.executemany(
                    """INSERT INTO entries_fts (entry_id, headword, headword_lower, part_of_speech, definitions_text)
                       VALUES (?, ?, ?, ?, ?);""",
                    fts_batch,
                )
                conn.commit()
                entries_batch.clear()
                senses_batch.clear()
                forms_batch.clear()
                fts_batch.clear()

                if stats["accepted_entries"] % 25000 == 0:
                    print(f"    Processed {stats['accepted_entries']} entries ({len(stats['distinct_headwords'])} distinct words)...")

            if max_entries and stats["accepted_entries"] >= max_entries:
                print(f"[!] Reached max limit of {max_entries} accepted entries.")
                break

    # Final batch flush
    if entries_batch:
        conn.executemany(
            """INSERT INTO entries (id, headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology, source_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            entries_batch,
        )
        conn.executemany(
            """INSERT INTO senses (entry_id, sense_number, definition, tags, examples, synonyms, antonyms)
               VALUES (?, ?, ?, ?, ?, ?, ?);""",
            senses_batch,
        )
        conn.executemany(
            """INSERT INTO word_forms (entry_id, form, form_lower, tags)
               VALUES (?, ?, ?, ?);""",
            forms_batch,
        )
        conn.executemany(
            """INSERT INTO entries_fts (entry_id, headword, headword_lower, part_of_speech, definitions_text)
               VALUES (?, ?, ?, ?, ?);""",
            fts_batch,
        )
        conn.commit()

    # Write metadata summaries
    meta_pairs = [
        ("dataset_name", "Lexica English Monolingual Dictionary"),
        ("language_code", "en"),
        ("language_name", "English"),
        ("schema_version", "1"),
        ("build_timestamp", str(int(time.time()))),
        ("accepted_entries", str(stats["accepted_entries"])),
        ("distinct_headwords", str(len(stats["distinct_headwords"]))),
        ("total_senses", str(stats["total_senses"])),
        ("source_license", SOURCE_INFO["license"]),
        ("source_attribution", SOURCE_INFO["attribution_text"]),
    ]
    conn.executemany("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);", meta_pairs)
    conn.commit()

    # Integrity verification
    print("[*] Running PRAGMA integrity_check and foreign_key_check...")
    integrity = conn.execute("PRAGMA integrity_check;").fetchall()
    fk_check = conn.execute("PRAGMA foreign_key_check;").fetchall()

    if integrity != [("ok",)]:
        raise RuntimeError(f"Integrity check failed: {integrity}")
    if fk_check:
        raise RuntimeError(f"Foreign key violations found: {fk_check}")

    print("[*] Optimizing database with VACUUM & ANALYZE...")
    conn.execute("ANALYZE;")
    conn.execute("VACUUM;")
    conn.close()

    elapsed = time.time() - start_time
    db_size = os.path.getsize(output_db_path)

    stats["distinct_headwords_count"] = len(stats["distinct_headwords"])
    del stats["distinct_headwords"]
    stats["elapsed_seconds"] = round(elapsed, 2)
    stats["db_size_bytes"] = db_size
    stats["db_size_mb"] = round(db_size / (1024 * 1024), 2)
    stats["integrity_check"] = "PASS"
    stats["foreign_key_check"] = "PASS"

    print(f"[✓] Compilation finished in {stats['elapsed_seconds']}s.")
    print(f"    Entries: {stats['accepted_entries']} | Distinct words: {stats['distinct_headwords_count']} | Senses: {stats['total_senses']}")
    print(f"    Output DB: {output_db_path} ({stats['db_size_mb']} MB)")
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compile Kaikki English Wiktionary into Lexica SQLite DB")
    parser.add_argument("--source", default="/tmp/kaikki-English.jsonl.gz", help="Path to source JSONL (.gz)")
    parser.add_argument("--output", default="packs/lexica_english.db", help="Path to output SQLite database")
    parser.add_argument("--limit", type=int, default=None, help="Optional maximum number of accepted entries")
    args = parser.parse_args()

    report = compile_dictionary(args.source, args.output, max_entries=args.limit)
    print("\n=== FINAL COMPILATION REPORT ===")
    print(json.dumps(report, indent=2))
