#!/usr/bin/env python3
"""
Lexica English Dictionary Compiler (Schema v2 — Storage Optimized)
Compiles Wiktionary JSONL data (via Kaikki.org / Wiktextract) or re-optimizes
an existing v1 SQLite database into a normalized, contentless-FTS5,
16 KB page-aligned offline SQLite database.

Preserves 100% of accepted entries, distinct headwords, senses, examples,
IPA pronunciations (RP/GA priority + all dialect tags), audio filenames,
inflected word forms, etymologies, and CC BY-SA 4.0 / GFDL attribution.
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
    "code": "src-kaikki-enwiktionary",
    "name": "English Wiktionary via Kaikki.org (Wiktextract)",
    "license": "CC BY-SA 4.0 & GFDL",
    "attribution_text": "Extracted from English Wiktionary by Kaikki.org (Wiktextract). Copyright Wikimedia Contributors and Tatu Ylönen.",
    "source_url": "https://kaikki.org/dictionary/English/",
    "dataset_version": "2026.11-wiktionary-en-v0.3.0",
}

SCHEMA_V2_TABLES_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution_text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    dataset_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parts_of_speech (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_sets (
    id INTEGER PRIMARY KEY,
    tags_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pronunciations (
    id INTEGER PRIMARY KEY,
    all_ipas TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etymologies (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_files (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    headword_lower TEXT NOT NULL,
    headword TEXT,       -- NULL when headword == headword_lower
    pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
    primary_ipa TEXT,
    pronunciation_id INTEGER REFERENCES pronunciations(id),
    audio_id INTEGER REFERENCES audio_files(id),
    etymology_id INTEGER REFERENCES etymologies(id),
    source_id INTEGER NOT NULL REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS senses (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    sense_number INTEGER NOT NULL,
    definition TEXT NOT NULL,
    tags_id INTEGER REFERENCES tag_sets(id),
    examples TEXT,       -- compact JSON: [[text, ref?], ...]
    synonyms TEXT,
    antonyms TEXT
);

CREATE TABLE IF NOT EXISTS word_forms (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    form_lower TEXT NOT NULL,
    form TEXT,           -- NULL when form == form_lower
    tags_id INTEGER REFERENCES tag_sets(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    headword,
    definitions_text,
    content='',
    detail=column,
    tokenize = 'unicode61 remove_diacritics 1'
);
"""

SCHEMA_V2_INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_entries_headword_lower ON entries(headword_lower);
CREATE INDEX IF NOT EXISTS idx_senses_entry_id ON senses(entry_id, sense_number);
CREATE INDEX IF NOT EXISTS idx_word_forms_lower ON word_forms(form_lower);
CREATE INDEX IF NOT EXISTS idx_word_forms_entry_id ON word_forms(entry_id);
"""

NON_PRIMARY_PRONUNCIATION_TAGS = {
    "regional", "dialectal", "dialect", "nonstandard", "rare", "archaic",
    "obsolete", "dated", "colloquial", "informal", "slang", "eye-dialect",
    "pronunciation-spelling", "cockney", "estuary-english",
    "multicultural-london-english", "aave", "scotland", "wales", "ireland",
    "northern-england", "yorkshire", "northumbria", "west-country", "scouse",
    "geordie", "australia", "new-zealand", "south-asia", "india", "singapore",
    "malaysia", "philippines", "general-south-african", "south-africa",
    "new-york-city", "boston", "southern-us", "midwestern-us", "pennsylvania",
    "western", "cot-caught-merger", "pin-pen-merger",
    "mary-marry-merry-merger", "weak-vowel-merger", "yod-coalescence",
    "th-fronting",
}


def extract_definition(sense: Dict[str, Any]) -> Optional[str]:
    glosses = sense.get("glosses")
    if glosses and isinstance(glosses, list) and len(glosses) > 0:
        def_str = str(glosses[-1]).strip()
        if def_str:
            return def_str
    raw_glosses = sense.get("raw_glosses")
    if raw_glosses and isinstance(raw_glosses, list) and len(raw_glosses) > 0:
        def_str = str(raw_glosses[-1]).strip()
        if def_str:
            return def_str
    return None


def extract_examples(sense: Dict[str, Any]) -> List[List[str]]:
    res: List[List[str]] = []
    raw_examples = sense.get("examples", [])
    if isinstance(raw_examples, list):
        for ex in raw_examples:
            if isinstance(ex, dict):
                text = ex.get("text", "").strip()
                ref = ex.get("ref", "").strip()
                if text:
                    res.append([text, ref] if ref else [text])
            elif isinstance(ex, str) and ex.strip():
                res.append([ex.strip()])
    return res


def _score_ipa_candidate(ipa_val: str, tags: List[str], index: int) -> Tuple[int, int, int, int, int]:
    stripped = ipa_val.strip()
    inner = stripped[1:-1] if len(stripped) >= 2 and stripped[0] in "/[" and stripped[-1] in "/]" else stripped
    not_partial = 0 if (inner.startswith("-") or inner.endswith("-")) else 1
    norm_tags = {str(t).strip().lower() for t in (tags or []) if t}
    no_penalty = 0 if (norm_tags & NON_PRIMARY_PRONUNCIATION_TAGS) else 1
    has_rp = "received-pronunciation" in norm_tags
    has_ga = "general-american" in norm_tags
    has_uk_us = bool(norm_tags & {"uk", "us", "british", "american"})
    if has_rp and has_ga:
        tier = 5
    elif has_rp:
        tier = 4
    elif has_ga:
        tier = 3
    elif has_uk_us:
        tier = 2
    elif not norm_tags:
        tier = 1
    else:
        tier = 0
    is_phonemic = 1 if (stripped.startswith("/") and stripped.endswith("/")) else 0
    return (not_partial, no_penalty, tier, is_phonemic, -index)


def extract_pronunciations(sounds: List[Dict[str, Any]]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if not sounds or not isinstance(sounds, list):
        return None, None, None
    ipas = []
    best_score: Optional[Tuple[int, int, int, int, int]] = None
    primary_ipa = None
    audio_file = None
    for idx, s in enumerate(sounds):
        if not isinstance(s, dict):
            continue
        ipa_val = s.get("ipa")
        if ipa_val:
            tags = s.get("tags", [])
            if not isinstance(tags, list):
                tags = []
            ipas.append([ipa_val, tags])
            score = _score_ipa_candidate(str(ipa_val), tags, idx)
            if best_score is None or score > best_score:
                best_score = score
                primary_ipa = str(ipa_val)
        if not audio_file and s.get("audio"):
            audio_file = s.get("audio")
    compact_json = json.dumps(ipas, ensure_ascii=False, separators=(",", ":")) if ipas else None
    return primary_ipa, compact_json, audio_file


def _intern(table: Dict[str, int], value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    if value not in table:
        table[value] = len(table) + 1
    return table[value]


def _compact_list_json(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    arr = json.loads(raw)
    if not arr:
        return None
    return json.dumps(arr, ensure_ascii=False, separators=(",", ":"))


def _compact_examples_json(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    arr = json.loads(raw)
    if not arr:
        return None
    comp = []
    for item in arr:
        if isinstance(item, list):
            comp.append(item)
        elif isinstance(item, dict):
            t = str(item.get("text", "")).strip()
            r = str(item.get("ref", "")).strip()
            if t:
                comp.append([t, r] if r else [t])
    return json.dumps(comp, ensure_ascii=False, separators=(",", ":")) if comp else None


def _compact_ipas_json(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    arr = json.loads(raw)
    if not arr:
        return None
    comp = []
    for item in arr:
        if isinstance(item, list):
            comp.append(item)
        elif isinstance(item, dict) and item.get("ipa"):
            comp.append([item["ipa"], item.get("tags", [])])
    return json.dumps(comp, ensure_ascii=False, separators=(",", ":")) if comp else None


def _finalize_db(
    conn: sqlite3.Connection,
    output_db_path: str,
    stats: Dict[str, Any],
    start_time: float,
) -> Dict[str, Any]:
    meta_pairs = [
        ("dataset_name", "Lexica English Monolingual Dictionary"),
        ("language_code", "en"),
        ("language_name", "English"),
        ("schema_version", "2"),
        ("pack_version", "0.3.0"),
        ("build_timestamp", str(int(time.time()))),
        ("accepted_entries", str(stats["accepted_entries"])),
        ("distinct_headwords", str(stats["distinct_headwords_count"])),
        ("total_senses", str(stats["total_senses"])),
        ("source_license", SOURCE_INFO["license"]),
        ("source_attribution", SOURCE_INFO["attribution_text"]),
    ]
    conn.executemany("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);", meta_pairs)
    conn.executescript(SCHEMA_V2_INDEXES_SQL)
    conn.commit()

    print("[*] Running PRAGMA integrity_check and foreign_key_check...")
    integrity = conn.execute("PRAGMA integrity_check;").fetchall()
    fk_check = conn.execute("PRAGMA foreign_key_check;").fetchall()
    if integrity != [("ok",)]:
        raise RuntimeError(f"Integrity check failed: {integrity}")
    if fk_check:
        raise RuntimeError(f"Foreign key violations found: {fk_check}")

    print("[*] Optimizing database with ANALYZE & VACUUM (16 KB pages)...")
    conn.execute("ANALYZE;")
    conn.execute("VACUUM;")
    conn.close()

    elapsed = time.time() - start_time
    db_size = os.path.getsize(output_db_path)
    stats["elapsed_seconds"] = round(elapsed, 2)
    stats["db_size_bytes"] = db_size
    stats["db_size_mb"] = round(db_size / (1024 * 1024), 2)
    stats["schema_version"] = 2
    stats["pack_version"] = "0.3.0"
    stats["page_size_bytes"] = 16384
    stats["integrity_check"] = "PASS"
    stats["foreign_key_check"] = "PASS"
    return stats


def compile_from_sqlite(source_db_path: str, output_db_path: str) -> Dict[str, Any]:
    """Re-optimizes an existing verified v1/v2 English SQLite database into Schema v2."""
    start_time = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(output_db_path)), exist_ok=True)
    if os.path.exists(output_db_path):
        os.remove(output_db_path)

    src = sqlite3.connect(f"file:{os.path.abspath(source_db_path)}?mode=ro", uri=True)
    dst = sqlite3.connect(output_db_path)
    dst.execute("PRAGMA page_size = 16384;")
    dst.execute("PRAGMA journal_mode = OFF;")
    dst.execute("PRAGMA synchronous = OFF;")
    dst.execute("PRAGMA temp_store = MEMORY;")
    dst.execute("PRAGMA cache_size = -64000;")
    dst.executescript(SCHEMA_V2_TABLES_SQL)

    dst.execute(
        """INSERT INTO sources (id, code, name, license, attribution_text, source_url, dataset_version)
           VALUES (1, :code, :name, :license, :attribution_text, :source_url, :dataset_version);""",
        SOURCE_INFO,
    )

    pos_map: Dict[str, int] = {}
    tag_map: Dict[str, int] = {}
    pron_map: Dict[str, int] = {}
    ety_map: Dict[str, int] = {}
    aud_map: Dict[str, int] = {}

    entries_batch = []
    defs_by_entry: Dict[int, List[str]] = {}
    distinct_hw = set()
    records_with_ipa = 0
    records_with_examples = 0
    senses_with_ex_entries = set()
    entries_with_forms = set()

    for eid, hw, hwl, pos, pipa, aipas, audio, ety in src.execute(
        "SELECT id, headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology FROM entries ORDER BY id;"
    ):
        distinct_hw.add(hwl)
        if pipa:
            records_with_ipa += 1
        entries_batch.append((
            eid,
            hwl,
            None if hw == hwl else hw,
            _intern(pos_map, pos),
            pipa,
            _intern(pron_map, _compact_ipas_json(aipas)),
            _intern(aud_map, audio),
            _intern(ety_map, ety),
            1,
        ))
        defs_by_entry[eid] = [hw]

    senses_batch = []
    for sid, eid, snum, defn, tags, ex, syn, ant in src.execute(
        "SELECT id, entry_id, sense_number, definition, tags, examples, synonyms, antonyms FROM senses ORDER BY id;"
    ):
        comp_ex = _compact_examples_json(ex)
        if comp_ex:
            senses_with_ex_entries.add(eid)
        senses_batch.append((
            sid,
            eid,
            snum,
            defn,
            _intern(tag_map, _compact_list_json(tags)),
            comp_ex,
            _compact_list_json(syn),
            _compact_list_json(ant),
        ))
        defs_by_entry[eid].append(defn)

    forms_batch = []
    for fid, eid, form, form_l, tags in src.execute(
        "SELECT id, entry_id, form, form_lower, tags FROM word_forms ORDER BY id;"
    ):
        entries_with_forms.add(eid)
        forms_batch.append((
            fid,
            eid,
            form_l,
            None if form == form_l else form,
            _intern(tag_map, _compact_list_json(tags)),
        ))

    fts_batch = [(eid, parts[0], " | ".join(parts[1:])) for eid, parts in defs_by_entry.items()]

    dst.executemany("INSERT INTO parts_of_speech (id, name) VALUES (?, ?);", [(v, k) for k, v in pos_map.items()])
    dst.executemany("INSERT INTO tag_sets (id, tags_json) VALUES (?, ?);", [(v, k) for k, v in tag_map.items()])
    dst.executemany("INSERT INTO pronunciations (id, all_ipas) VALUES (?, ?);", [(v, k) for k, v in pron_map.items()])
    dst.executemany("INSERT INTO etymologies (id, text) VALUES (?, ?);", [(v, k) for k, v in ety_map.items()])
    dst.executemany("INSERT INTO audio_files (id, filename) VALUES (?, ?);", [(v, k) for k, v in aud_map.items()])
    dst.executemany(
        """INSERT INTO entries (id, headword_lower, headword, pos_id, primary_ipa, pronunciation_id, audio_id, etymology_id, source_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
        entries_batch,
    )
    dst.executemany(
        """INSERT INTO senses (id, entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
        senses_batch,
    )
    dst.executemany(
        """INSERT INTO word_forms (id, entry_id, form_lower, form, tags_id)
           VALUES (?, ?, ?, ?, ?);""",
        forms_batch,
    )
    dst.executemany(
        """INSERT INTO entries_fts (rowid, headword, definitions_text)
           VALUES (?, ?, ?);""",
        fts_batch,
    )
    src.close()

    stats = {
        "source_mode": "sqlite-repack",
        "accepted_entries": len(entries_batch),
        "distinct_headwords_count": len(distinct_hw),
        "total_senses": len(senses_batch),
        "total_word_forms": len(forms_batch),
        "records_with_ipa": records_with_ipa,
        "records_with_examples": len(senses_with_ex_entries),
        "records_with_forms": len(entries_with_forms),
        "dedup_pos_count": len(pos_map),
        "dedup_tag_sets_count": len(tag_map),
        "dedup_pronunciations_count": len(pron_map),
        "dedup_etymologies_count": len(ety_map),
        "dedup_audio_files_count": len(aud_map),
    }
    return _finalize_db(dst, output_db_path, stats, start_time)


def compile_dictionary(
    source_path: str,
    output_db_path: str,
    max_entries: Optional[int] = None,
    batch_size: int = 5000,
) -> Dict[str, Any]:
    """Compiles source Kaikki JSONL.gz dataset directly into Schema v2 SQLite database."""
    start_time = time.time()
    os.makedirs(os.path.dirname(os.path.abspath(output_db_path)), exist_ok=True)
    if os.path.exists(output_db_path):
        os.remove(output_db_path)

    conn = sqlite3.connect(output_db_path)
    conn.execute("PRAGMA page_size = 16384;")
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -64000;")
    conn.executescript(SCHEMA_V2_TABLES_SQL)

    conn.execute(
        """INSERT INTO sources (id, code, name, license, attribution_text, source_url, dataset_version)
           VALUES (1, :code, :name, :license, :attribution_text, :source_url, :dataset_version);""",
        SOURCE_INFO,
    )

    pos_map: Dict[str, int] = {}
    tag_map: Dict[str, int] = {}
    pron_map: Dict[str, int] = {}
    ety_map: Dict[str, int] = {}
    aud_map: Dict[str, int] = {}

    stats: Dict[str, Any] = {
        "source_mode": "kaikki-jsonl-gz",
        "lines_scanned": 0,
        "accepted_entries": 0,
        "distinct_headwords": set(),
        "total_senses": 0,
        "total_word_forms": 0,
        "records_with_ipa": 0,
        "records_with_examples": 0,
        "records_with_forms": 0,
        "rejected_non_english": 0,
        "rejected_malformed_json": 0,
        "rejected_no_word": 0,
        "rejected_redirect_only": 0,
        "rejected_no_definitions": 0,
        "duplicated_sense_defs_filtered": 0,
    }

    entries_batch = []
    senses_batch = []
    forms_batch = []
    fts_batch = []
    current_entry_id = 0

    opener = gzip.open if source_path.endswith(".gz") else open
    print(f"[*] Compiling Schema v2 from {source_path} into {output_db_path}...")

    with opener(source_path, "rt", encoding="utf-8") as f:
        for line in f:
            stats["lines_scanned"] += 1
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                stats["rejected_malformed_json"] += 1
                continue

            if rec.get("lang_code") != "en":
                stats["rejected_non_english"] += 1
                continue

            headword = rec.get("word", "").strip()
            pos = rec.get("pos", "other").strip() or "other"
            if not headword:
                stats["rejected_no_word"] += 1
                continue

            raw_senses = rec.get("senses", [])
            valid_senses = []
            seen_defs = set()
            for s in raw_senses:
                if not isinstance(s, dict):
                    continue
                if "form_of" in s and not s.get("glosses") and not s.get("raw_glosses"):
                    continue
                defn = extract_definition(s)
                if not defn:
                    continue
                if defn in seen_defs:
                    stats["duplicated_sense_defs_filtered"] += 1
                    continue
                seen_defs.add(defn)
                tags = s.get("tags", [])
                examples = extract_examples(s)
                synonyms = [str(sy.get("word", "")).strip() for sy in s.get("synonyms", []) if isinstance(sy, dict) and sy.get("word")]
                antonyms = [str(an.get("word", "")).strip() for an in s.get("antonyms", []) if isinstance(an, dict) and an.get("word")]
                valid_senses.append({
                    "definition": defn,
                    "tags_json": json.dumps(tags, ensure_ascii=False, separators=(",", ":")) if tags else None,
                    "examples": json.dumps(examples, ensure_ascii=False, separators=(",", ":")) if examples else None,
                    "synonyms": json.dumps(synonyms, ensure_ascii=False, separators=(",", ":")) if synonyms else None,
                    "antonyms": json.dumps(antonyms, ensure_ascii=False, separators=(",", ":")) if antonyms else None,
                    "has_examples": len(examples) > 0,
                })

            if not valid_senses:
                if rec.get("redirect"):
                    stats["rejected_redirect_only"] += 1
                else:
                    stats["rejected_no_definitions"] += 1
                continue

            primary_ipa, all_ipas_json, audio_file = extract_pronunciations(rec.get("sounds", []))
            etymology = rec.get("etymology_text")

            raw_forms = rec.get("forms", [])
            entry_forms = []
            if isinstance(raw_forms, list):
                for f_item in raw_forms:
                    if isinstance(f_item, dict):
                        f_str = f_item.get("form", "").strip()
                        if f_str and f_str != headword:
                            f_tags = f_item.get("tags", [])
                            f_tags_json = json.dumps(f_tags, ensure_ascii=False, separators=(",", ":")) if f_tags else None
                            entry_forms.append((f_str, f_str.lower(), f_tags_json))

            current_entry_id += 1
            headword_lower = headword.lower()
            entries_batch.append((
                current_entry_id,
                headword_lower,
                None if headword == headword_lower else headword,
                _intern(pos_map, pos),
                primary_ipa,
                _intern(pron_map, all_ipas_json),
                _intern(aud_map, audio_file),
                _intern(ety_map, etymology),
                1,
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
                    _intern(tag_map, s_data["tags_json"]),
                    s_data["examples"],
                    s_data["synonyms"],
                    s_data["antonyms"],
                ))
                stats["total_senses"] += 1
                if s_data["has_examples"]:
                    has_any_example = True
            if has_any_example:
                stats["records_with_examples"] += 1

            for form_str, form_lower, form_tags_json in entry_forms:
                forms_batch.append((
                    current_entry_id,
                    form_lower,
                    None if form_str == form_lower else form_str,
                    _intern(tag_map, form_tags_json),
                ))
                stats["total_word_forms"] += 1
            if entry_forms:
                stats["records_with_forms"] += 1

            defs_text = " | ".join(s_data["definition"] for s_data in valid_senses)
            fts_batch.append((current_entry_id, headword, defs_text))

            if len(entries_batch) >= batch_size:
                conn.executemany(
                    """INSERT INTO entries (id, headword_lower, headword, pos_id, primary_ipa, pronunciation_id, audio_id, etymology_id, source_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
                    entries_batch,
                )
                conn.executemany(
                    """INSERT INTO senses (entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms)
                       VALUES (?, ?, ?, ?, ?, ?, ?);""",
                    senses_batch,
                )
                conn.executemany(
                    """INSERT INTO word_forms (entry_id, form_lower, form, tags_id)
                       VALUES (?, ?, ?, ?);""",
                    forms_batch,
                )
                conn.executemany(
                    """INSERT INTO entries_fts (rowid, headword, definitions_text)
                       VALUES (?, ?, ?);""",
                    fts_batch,
                )
                entries_batch.clear()
                senses_batch.clear()
                forms_batch.clear()
                fts_batch.clear()

            if max_entries and stats["accepted_entries"] >= max_entries:
                break

    if entries_batch:
        conn.executemany(
            """INSERT INTO entries (id, headword_lower, headword, pos_id, primary_ipa, pronunciation_id, audio_id, etymology_id, source_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            entries_batch,
        )
        conn.executemany(
            """INSERT INTO senses (entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms)
               VALUES (?, ?, ?, ?, ?, ?, ?);""",
            senses_batch,
        )
        conn.executemany(
            """INSERT INTO word_forms (entry_id, form_lower, form, tags_id)
               VALUES (?, ?, ?, ?);""",
            forms_batch,
        )
        conn.executemany(
            """INSERT INTO entries_fts (rowid, headword, definitions_text)
               VALUES (?, ?, ?);""",
            fts_batch,
        )

    conn.executemany("INSERT INTO parts_of_speech (id, name) VALUES (?, ?);", [(v, k) for k, v in pos_map.items()])
    conn.executemany("INSERT INTO tag_sets (id, tags_json) VALUES (?, ?);", [(v, k) for k, v in tag_map.items()])
    conn.executemany("INSERT INTO pronunciations (id, all_ipas) VALUES (?, ?);", [(v, k) for k, v in pron_map.items()])
    conn.executemany("INSERT INTO etymologies (id, text) VALUES (?, ?);", [(v, k) for k, v in ety_map.items()])
    conn.executemany("INSERT INTO audio_files (id, filename) VALUES (?, ?);", [(v, k) for k, v in aud_map.items()])
    conn.commit()

    stats["distinct_headwords_count"] = len(stats["distinct_headwords"])
    del stats["distinct_headwords"]
    return _finalize_db(conn, output_db_path, stats, start_time)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compile Lexica English SQLite Database (Schema v2)")
    parser.add_argument("--source", default="/tmp/kaikki-English.jsonl.gz", help="Path to Kaikki JSONL (.gz)")
    parser.add_argument("--from-sqlite", default=None, help="Optional existing SQLite DB path to re-optimize into Schema v2")
    parser.add_argument("--output", default="packs/lexica_english.db", help="Path to output SQLite database")
    parser.add_argument("--limit", type=int, default=None, help="Optional max accepted entries")
    args = parser.parse_args()

    if args.from_sqlite:
        report = compile_from_sqlite(args.from_sqlite, args.output)
    else:
        report = compile_dictionary(args.source, args.output, max_entries=args.limit)
    print(json.dumps(report, indent=2))
