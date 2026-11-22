#!/usr/bin/env python3
"""
Lexica English Layered Core + Extended SQLite Builder (Assignment 008 / Schema v3)

Builds the Architecture D layered SQLite packs from the canonical 75,000-entry
English dataset (either from Kaikki JSONL.gz or an existing v0.3.0 SQLite DB):
  1. lexica_english_core.db (+ .db.gz)
     - All 75,000 accepted entries
     - Audited primary definitions (never blindly picking empty/unusable stubs)
     - Normalized lookup columns (headword_norm / form_norm stored only when different)
     - All 134,837 inflected word forms
     - Primary IPA pronunciations + parts of speech + source/license attribution
     - Contentless FTS5 index (detail=none, unicode61 remove_diacritics 1)
  2. lexica_english_extended.db (+ .db.gz) [optional companion pack]
     - Secondary senses, usage examples, synonyms/antonyms, etymologies,
       dialect IPA variants, audio filenames, and word-form grammatical tags
  3. core_audit_report.json & pack_manifest.json

Usage:
  python3 scripts/build_english_core_pack.py \\
    --from-sqlite /tmp/lexica_english_v030.db \\
    --out-dir /tmp/lexica_core_v040
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sqlite3
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

PACK_ID = "en-wiktionary-sqlite"
CORE_PACK_VERSION = "0.4.0-core"
EXTENDED_PACK_VERSION = "0.4.0-extended"
DATASET_VERSION = "2026.11-wiktionary-en-v0.4.0"
DEFAULT_RELEASE_TAG = "prototype-en-core-v0.4.0"
DEFAULT_REPO = "ahmad-maxai/lexica-dictionary-new"

SOURCE_INFO = {
    "code": "kaikki-en-wiktionary",
    "name": "English Wiktionary via Kaikki.org (Wiktextract)",
    "license": "CC BY-SA 4.0 & GFDL",
    "attribution_text": (
        "Extracted from English Wiktionary by Kaikki.org (Wiktextract). "
        "Copyright Wikimedia Contributors and Tatu Ylönen."
    ),
    "source_url": "https://kaikki.org/dictionary/English/",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "dataset_version": DATASET_VERSION,
}

# Only treat Sense #1 as a weak stub if it is an archaic/obsolete/nonstandard/eye-dialect
# pointer or empty/unusable text AND a genuine lexical sense follows in the same entry.
WEAK_STUB_SENSE_RE = re.compile(
    r"^(?:(?:obsolete|archaic|dated|nonstandard|proscribed|eye dialect|misspelling|pronunciation)"
    r"\s+(?:spelling|form|variant)\s+of)\s+\S+",
    re.IGNORECASE,
)
BARE_CROSSREF_RE = re.compile(
    r"^(?:(?:alternative|archaic|obsolete|dated|rare|nonstandard|proscribed|eye dialect|misspelling|pronunciation|contraction)"
    r"\s+(?:spelling|form|variant)\s+of|(?:plural|simple\s+past|past\s+participle|present\s+participle|"
    r"third-person\s+singular|comparative|superlative)(?:\s+and\s+\w+)*\s+of)\s+\S+",
    re.IGNORECASE,
)
WHITESPACE_RE = re.compile(r"\s+")


def normalize_latin_soft(text: str) -> str:
    """Matches src/services/textNormalization.ts TextNormalization.normalizeLatin().soft."""
    if not text:
        return ""
    nfd = unicodedata.normalize("NFD", text.lower())
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return re.sub(r"[’'ʽ‘`]", "", stripped).strip()


def clean_definition_text(raw: str | None) -> str:
    if not raw:
        return ""
    cleaned = raw.replace("[[]]", "").replace("{}", "")
    cleaned = WHITESPACE_RE.sub(" ", cleaned).strip()
    # Fix accidental "- " spacing left when empty [[]] is stripped (e.g. "Al-[]],")
    cleaned = cleaned.replace("-,", "-").replace("- )", ")").strip()
    return cleaned


def is_usable_definition(defn: str) -> bool:
    if not defn:
        return False
    # Reject punctuation-only or single-symbol strings
    return any(ch.isalnum() for ch in defn)


def select_audited_primary_sense(
    senses: list[dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    """
    Selects the best primary sense for the Core pack without blindly picking empty or
    weak archaic/misspelling Sense #1 stubs when a real lexical sense exists.
    Returns (chosen_sense, selection_reason).
    """
    cleaned_candidates: list[tuple[dict[str, Any], str]] = []
    for s in senses:
        cleaned_def = clean_definition_text(s.get("definition"))
        s_copy = dict(s)
        s_copy["definition"] = cleaned_def
        cleaned_candidates.append((s_copy, cleaned_def))

    if not cleaned_candidates:
        raise ValueError("Entry has zero senses")

    first_sense, first_def = cleaned_candidates[0]
    first_is_usable = is_usable_definition(first_def)
    first_is_weak_stub = bool(WEAK_STUB_SENSE_RE.match(first_def)) and len(first_def) < 95

    if first_is_usable and not first_is_weak_stub:
        return first_sense, "sense_1_direct"

    # Search for a substantive later sense (usable + not another bare cross-reference stub)
    for cand_sense, cand_def in cleaned_candidates[1:]:
        if (
            is_usable_definition(cand_def)
            and len(cand_def) >= 8
            and not WEAK_STUB_SENSE_RE.match(cand_def)
            and not BARE_CROSSREF_RE.match(cand_def)
        ):
            reason = (
                "promoted_over_unusable_sense_1"
                if not first_is_usable
                else "promoted_over_weak_stub_sense_1"
            )
            return cand_sense, reason

    # If Sense #1 is usable (e.g., entry only has archaic/cross-reference senses), keep Sense #1 honestly
    if first_is_usable:
        return first_sense, "sense_1_crossref_only"

    # Fallback to first usable sense of any kind
    for cand_sense, cand_def in cleaned_candidates[1:]:
        if is_usable_definition(cand_def):
            return cand_sense, "promoted_over_empty_sense_1"

    return first_sense, "unusable_missing_fallback"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def gzip_file(src_path: Path, dst_gz_path: Path, compresslevel: int = 9) -> None:
    if dst_gz_path.exists():
        dst_gz_path.unlink()
    with open(src_path, "rb") as f_in:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=compresslevel, mtime=0, fileobj=open(dst_gz_path, "wb")) as gz_out:
            while True:
                chunk = f_in.read(1024 * 1024)
                if not chunk:
                    break
                gz_out.write(chunk)


def load_canonical_dataset_from_sqlite(src_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    metadata = dict(conn.execute("SELECT key, value FROM metadata;").fetchall())
    sources = [
        dict(zip([d[0] for d in conn.execute("SELECT * FROM sources;").description], r))
        for r in conn.execute("SELECT * FROM sources ORDER BY id ASC;").fetchall()
    ]

    has_pos_table = (
        conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='parts_of_speech';"
        ).fetchone()[0]
        > 0
    )

    entries: list[dict[str, Any]] = []
    if has_pos_table:
        rows = conn.execute(
            """
            SELECT e.id, e.headword_lower, COALESCE(e.headword, e.headword_lower), p.name,
                   e.primary_ipa, pr.all_ipas, au.filename, et.text, e.source_id
            FROM entries e
            JOIN parts_of_speech p ON p.id = e.pos_id
            LEFT JOIN pronunciations pr ON pr.id = e.pronunciation_id
            LEFT JOIN audio_files au ON au.id = e.audio_id
            LEFT JOIN etymologies et ON et.id = e.etymology_id
            ORDER BY e.id ASC;
            """
        )
    else:
        rows = conn.execute(
            """
            SELECT id, headword_lower, headword, part_of_speech,
                   primary_ipa, all_ipas, audio_file, etymology, 1
            FROM entries
            ORDER BY id ASC;
            """
        )

    for r in rows:
        entries.append(
            {
                "id": r[0],
                "headword_lower": r[1],
                "headword": r[2],
                "pos": r[3],
                "primary_ipa": r[4],
                "all_ipas": r[5],
                "audio_file": r[6],
                "etymology": r[7],
                "source_id": r[8],
            }
        )

    senses_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    if has_pos_table:
        s_rows = conn.execute(
            """
            SELECT s.entry_id, s.sense_number, s.definition, ts.tags_json, s.examples, s.synonyms, s.antonyms
            FROM senses s
            LEFT JOIN tag_sets ts ON ts.id = s.tags_id
            ORDER BY s.entry_id ASC, s.sense_number ASC, s.id ASC;
            """
        )
    else:
        s_rows = conn.execute(
            """
            SELECT entry_id, sense_number, definition, tags, examples, synonyms, antonyms
            FROM senses
            ORDER BY entry_id ASC, sense_number ASC, id ASC;
            """
        )
    for r in s_rows:
        senses_by_entry[r[0]].append(
            {
                "sense_number": r[1],
                "definition": r[2],
                "tags": r[3],
                "examples": r[4],
                "synonyms": r[5],
                "antonyms": r[6],
            }
        )

    forms_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    if has_pos_table:
        wf_rows = conn.execute(
            """
            SELECT wf.entry_id, wf.form_lower, COALESCE(wf.form, wf.form_lower), ts.tags_json
            FROM word_forms wf
            LEFT JOIN tag_sets ts ON ts.id = wf.tags_id
            ORDER BY wf.entry_id ASC, wf.id ASC;
            """
        )
    else:
        wf_rows = conn.execute(
            """
            SELECT entry_id, form_lower, form, tags
            FROM word_forms
            ORDER BY entry_id ASC, id ASC;
            """
        )
    for r in wf_rows:
        forms_by_entry[r[0]].append(
            {
                "form_lower": r[1],
                "form": r[2],
                "tags": r[3],
            }
        )

    conn.close()
    return {
        "metadata": metadata,
        "sources": sources,
        "entries": entries,
        "senses_by_entry": senses_by_entry,
        "forms_by_entry": forms_by_entry,
    }


def load_canonical_dataset_from_jsonl_gz(source_gz: Path, limit: int | None = None) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    senses_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    forms_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)

    entry_id = 0
    with gzip.open(source_gz, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("lang_code") != "en":
                continue
            headword = (rec.get("word") or "").strip()
            pos = (rec.get("pos") or "").strip().lower()
            raw_senses = rec.get("senses") or []
            if not headword or not pos or not isinstance(raw_senses, list):
                continue

            valid_senses: list[dict[str, Any]] = []
            for s in raw_senses:
                if not isinstance(s, dict):
                    continue
                glosses = s.get("glosses") or []
                if isinstance(glosses, list) and glosses:
                    defn = " — ".join(str(g).strip() for g in glosses if str(g).strip())
                else:
                    defn = ""
                if not defn:
                    raw_glosses = s.get("raw_glosses") or []
                    if isinstance(raw_glosses, list) and raw_glosses:
                        defn = " — ".join(str(g).strip() for g in raw_glosses if str(g).strip())
                if not defn:
                    continue

                tags = s.get("tags") or []
                examples = []
                for ex in s.get("examples") or []:
                    if isinstance(ex, dict) and ex.get("text"):
                        examples.append([ex["text"], ex.get("ref") or ""])
                synonyms = [x.get("word") for x in (s.get("synonyms") or []) if isinstance(x, dict) and x.get("word")]
                antonyms = [x.get("word") for x in (s.get("antonyms") or []) if isinstance(x, dict) and x.get("word")]

                valid_senses.append(
                    {
                        "sense_number": len(valid_senses) + 1,
                        "definition": defn,
                        "tags": json.dumps(tags, ensure_ascii=False, separators=(",", ":")) if tags else None,
                        "examples": json.dumps(examples, ensure_ascii=False, separators=(",", ":")) if examples else None,
                        "synonyms": json.dumps(synonyms, ensure_ascii=False, separators=(",", ":")) if synonyms else None,
                        "antonyms": json.dumps(antonyms, ensure_ascii=False, separators=(",", ":")) if antonyms else None,
                    }
                )
            if not valid_senses:
                continue

            sounds = rec.get("sounds") or []
            primary_ipa = None
            all_ipas = []
            audio_file = None
            for snd in sounds:
                if isinstance(snd, dict):
                    if snd.get("ipa"):
                        ipa_val = snd["ipa"]
                        s_tags = snd.get("tags") or []
                        all_ipas.append([ipa_val, s_tags])
                        if primary_ipa is None:
                            primary_ipa = ipa_val
                    if not audio_file and snd.get("audio"):
                        audio_file = snd["audio"]

            entry_id += 1
            entries.append(
                {
                    "id": entry_id,
                    "headword_lower": headword.lower(),
                    "headword": headword,
                    "pos": pos,
                    "primary_ipa": primary_ipa,
                    "all_ipas": json.dumps(all_ipas, ensure_ascii=False, separators=(",", ":")) if all_ipas else None,
                    "audio_file": audio_file,
                    "etymology": rec.get("etymology_text"),
                    "source_id": 1,
                }
            )
            senses_by_entry[entry_id] = valid_senses
            for f_item in rec.get("forms") or []:
                if isinstance(f_item, dict):
                    f_str = (f_item.get("form") or "").strip()
                    if f_str and f_str != headword:
                        f_tags = f_item.get("tags") or []
                        forms_by_entry[entry_id].append(
                            {
                                "form_lower": f_str.lower(),
                                "form": f_str,
                                "tags": json.dumps(f_tags, ensure_ascii=False, separators=(",", ":")) if f_tags else None,
                            }
                        )
            if limit and entry_id >= limit:
                break

    return {
        "metadata": {},
        "sources": [
            {
                "id": 1,
                "code": SOURCE_INFO["code"],
                "name": SOURCE_INFO["name"],
                "license": SOURCE_INFO["license"],
                "attribution_text": SOURCE_INFO["attribution_text"],
                "source_url": SOURCE_INFO["source_url"],
                "dataset_version": DATASET_VERSION,
            }
        ],
        "entries": entries,
        "senses_by_entry": senses_by_entry,
        "forms_by_entry": forms_by_entry,
    }


def build_core_and_extended(
    data: dict[str, Any],
    out_dir: Path,
    release_tag: str,
    repo_slug: str,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    core_db = out_dir / "lexica_english_core.db"
    core_gz = out_dir / "lexica_english_core.db.gz"
    ext_db = out_dir / "lexica_english_extended.db"
    ext_gz = out_dir / "lexica_english_extended.db.gz"

    for p in (core_db, core_gz, ext_db, ext_gz):
        if p.exists():
            p.unlink()

    t0 = time.perf_counter()

    # Audit structures
    total_entries = len(data["entries"])
    distinct_hw_lower: Counter[str] = Counter()
    hw_pos_counter: Counter[tuple[str, str]] = Counter()
    hw_norm_collisions: dict[str, set[str]] = defaultdict(set)
    selection_reasons: Counter[str] = Counter()
    promoted_samples: list[dict[str, Any]] = []
    markup_cleaned_count = 0
    entries_with_ipa = 0
    entries_missing_def = 0
    entries_bare_crossref_only = 0
    total_senses = 0
    total_word_forms = 0
    non_ascii_hw_count = 0
    apostrophe_hw_count = 0
    wf_norm_stored_count = 0
    hw_norm_stored_count = 0

    c_conn = sqlite3.connect(str(core_db))
    c_conn.executescript(
        """
        PRAGMA page_size = 16384;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = ON;

        CREATE TABLE metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            license TEXT NOT NULL,
            attribution_text TEXT NOT NULL,
            source_url TEXT NOT NULL,
            dataset_version TEXT NOT NULL
        );

        CREATE TABLE parts_of_speech (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
        );

        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            headword_lower TEXT NOT NULL,
            headword TEXT,
            headword_norm TEXT,
            pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
            primary_ipa TEXT,
            primary_definition TEXT NOT NULL,
            extra_senses_count INTEGER NOT NULL DEFAULT 0,
            source_id INTEGER NOT NULL REFERENCES sources(id)
        );

        CREATE TABLE word_forms (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            form_lower TEXT NOT NULL,
            form TEXT,
            form_norm TEXT
        );

        CREATE VIRTUAL TABLE entries_fts USING fts5(
            headword,
            primary_definition,
            content='',
            detail=none,
            tokenize = 'unicode61 remove_diacritics 1'
        );
        """
    )

    e_conn = sqlite3.connect(str(ext_db))
    e_conn.executescript(
        """
        PRAGMA page_size = 16384;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = ON;

        CREATE TABLE metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE tag_sets (
            id INTEGER PRIMARY KEY,
            tags_json TEXT NOT NULL
        );

        CREATE TABLE pronunciations (
            id INTEGER PRIMARY KEY,
            all_ipas TEXT NOT NULL
        );

        CREATE TABLE etymologies (
            id INTEGER PRIMARY KEY,
            text TEXT NOT NULL
        );

        CREATE TABLE audio_files (
            id INTEGER PRIMARY KEY,
            filename TEXT NOT NULL
        );

        CREATE TABLE entry_extensions (
            entry_id INTEGER PRIMARY KEY,
            pronunciation_id INTEGER REFERENCES pronunciations(id),
            audio_id INTEGER REFERENCES audio_files(id),
            etymology_id INTEGER REFERENCES etymologies(id),
            primary_sense_number INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE senses_ext (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL,
            sense_number INTEGER NOT NULL,
            definition TEXT,
            tags_id INTEGER REFERENCES tag_sets(id),
            examples TEXT,
            synonyms TEXT,
            antonyms TEXT
        );

        CREATE TABLE word_form_tags (
            entry_id INTEGER NOT NULL,
            form_index INTEGER NOT NULL,
            tags_id INTEGER NOT NULL REFERENCES tag_sets(id),
            PRIMARY KEY (entry_id, form_index)
        ) WITHOUT ROWID;
        """
    )

    for s in data["sources"]:
        c_conn.execute(
            "INSERT INTO sources (id, code, name, license, attribution_text, source_url, dataset_version) VALUES (?, ?, ?, ?, ?, ?, ?);",
            (
                s["id"],
                s["code"],
                s["name"],
                s["license"],
                s["attribution_text"],
                s["source_url"],
                DATASET_VERSION,
            ),
        )

    pos_ids: dict[str, int] = {}
    for pos_name in sorted({e["pos"] for e in data["entries"]}):
        cur = c_conn.execute("INSERT INTO parts_of_speech (name) VALUES (?);", (pos_name,))
        pos_ids[pos_name] = int(cur.lastrowid)

    tag_cache: dict[str, int] = {}
    pron_cache: dict[str, int] = {}
    etym_cache: dict[str, int] = {}
    audio_cache: dict[str, int] = {}

    def intern_ext(table: str, col: str, cache: dict[str, int], val: str | None) -> int | None:
        if not val:
            return None
        hit = cache.get(val)
        if hit is not None:
            return hit
        cur = e_conn.execute(f"INSERT INTO {table} ({col}) VALUES (?);", (val,))
        cache[val] = int(cur.lastrowid)
        return cache[val]

    core_entries_batch: list[tuple[Any, ...]] = []
    core_wf_batch: list[tuple[Any, ...]] = []
    core_fts_batch: list[tuple[Any, ...]] = []
    ext_entry_batch: list[tuple[Any, ...]] = []
    ext_senses_batch: list[tuple[Any, ...]] = []
    ext_wf_tags_batch: list[tuple[Any, ...]] = []

    for e in data["entries"]:
        eid = e["id"]
        hw = e["headword"]
        hw_lower = e["headword_lower"]
        hw_opt = None if hw == hw_lower else hw
        hw_norm = normalize_latin_soft(hw_lower)
        hw_norm_opt = None if hw_norm == hw_lower else hw_norm
        if hw_norm_opt is not None:
            hw_norm_stored_count += 1

        distinct_hw_lower[hw_lower] += 1
        hw_pos_counter[(hw_lower, e["pos"])] += 1
        hw_norm_collisions[hw_norm].add(hw_lower)
        if any(ord(ch) > 127 for ch in hw_lower):
            non_ascii_hw_count += 1
        if "'" in hw_lower or "’" in hw_lower:
            apostrophe_hw_count += 1
        if e["primary_ipa"]:
            entries_with_ipa += 1

        senses = data["senses_by_entry"].get(eid, [])
        total_senses += len(senses)

        chosen_sense, reason = select_audited_primary_sense(senses)
        selection_reasons[reason] += 1

        raw_first = (senses[0].get("definition") or "").strip() if senses else ""
        if raw_first != clean_definition_text(raw_first):
            markup_cleaned_count += 1

        primary_def = chosen_sense["definition"]
        if not is_usable_definition(primary_def):
            entries_missing_def += 1
        if BARE_CROSSREF_RE.match(primary_def) and len(primary_def) < 95:
            entries_bare_crossref_only += 1
        if reason.startswith("promoted_") and len(promoted_samples) < 35:
            promoted_samples.append(
                {
                    "entry_id": eid,
                    "headword": hw,
                    "pos": e["pos"],
                    "reason": reason,
                    "original_sense_1": raw_first,
                    "selected_sense_number": chosen_sense["sense_number"],
                    "selected_primary_definition": primary_def,
                }
            )

        extra_cnt = max(0, len(senses) - 1)
        core_entries_batch.append(
            (
                eid,
                hw_lower,
                hw_opt,
                hw_norm_opt,
                pos_ids[e["pos"]],
                e["primary_ipa"],
                primary_def,
                extra_cnt,
                e["source_id"],
            )
        )
        core_fts_batch.append((eid, hw, primary_def))

        for wf_idx, wf in enumerate(data["forms_by_entry"].get(eid, [])):
            total_word_forms += 1
            f_lower = wf["form_lower"]
            f_opt = None if wf["form"] == f_lower else wf["form"]
            f_norm = normalize_latin_soft(f_lower)
            f_norm_opt = None if f_norm == f_lower else f_norm
            if f_norm_opt is not None:
                wf_norm_stored_count += 1
            core_wf_batch.append((eid, f_lower, f_opt, f_norm_opt))

            ft_id = intern_ext("tag_sets", "tags_json", tag_cache, wf["tags"])
            if ft_id is not None:
                ext_wf_tags_batch.append((eid, wf_idx, ft_id))

        # Populate Extended pack rows
        pr_id = intern_ext("pronunciations", "all_ipas", pron_cache, e["all_ipas"])
        au_id = intern_ext("audio_files", "filename", audio_cache, e["audio_file"])
        et_id = intern_ext("etymologies", "text", etym_cache, e["etymology"])
        if pr_id or au_id or et_id or chosen_sense["sense_number"] != 1:
            ext_entry_batch.append((eid, pr_id, au_id, et_id, chosen_sense["sense_number"]))

        for s in senses:
            t_id = intern_ext("tag_sets", "tags_json", tag_cache, s["tags"])
            def_opt = None if s["sense_number"] == chosen_sense["sense_number"] else clean_definition_text(s["definition"])
            if def_opt is not None or t_id is not None or s["examples"] or s["synonyms"] or s["antonyms"]:
                ext_senses_batch.append(
                    (eid, s["sense_number"], def_opt, t_id, s["examples"], s["synonyms"], s["antonyms"])
                )

    c_conn.executemany(
        """INSERT INTO entries
           (id, headword_lower, headword, headword_norm, pos_id, primary_ipa, primary_definition, extra_senses_count, source_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);""",
        core_entries_batch,
    )
    c_conn.executemany(
        """INSERT INTO word_forms (entry_id, form_lower, form, form_norm) VALUES (?, ?, ?, ?);""",
        core_wf_batch,
    )
    c_conn.executemany(
        """INSERT INTO entries_fts (rowid, headword, primary_definition) VALUES (?, ?, ?);""",
        core_fts_batch,
    )

    core_meta = [
        ("dataset_name", "Lexica English Monolingual Dictionary (Core)"),
        ("pack_id", PACK_ID),
        ("pack_layer", "core"),
        ("pack_version", CORE_PACK_VERSION),
        ("dataset_version", DATASET_VERSION),
        ("schema_version", "3"),
        ("extended_compatible_version", EXTENDED_PACK_VERSION),
        ("accepted_entries", str(total_entries)),
        ("distinct_headwords", str(len(distinct_hw_lower))),
        ("total_senses", str(total_senses)),
        ("core_primary_senses", str(total_entries)),
        ("total_word_forms", str(total_word_forms)),
        ("source_name", SOURCE_INFO["name"]),
        ("source_license", SOURCE_INFO["license"]),
        ("source_attribution", SOURCE_INFO["attribution_text"]),
        ("source_url", SOURCE_INFO["source_url"]),
    ]
    c_conn.executemany("INSERT INTO metadata (key, value) VALUES (?, ?);", core_meta)

    c_conn.executescript(
        """
        CREATE INDEX idx_core_entries_hw_lower ON entries(headword_lower);
        CREATE INDEX idx_core_entries_hw_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;
        CREATE INDEX idx_core_wf_lower ON word_forms(form_lower);
        CREATE INDEX idx_core_wf_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;
        CREATE INDEX idx_core_wf_entry_id ON word_forms(entry_id);
        ANALYZE;
        VACUUM;
        """
    )

    # Verify Core integrity before closing
    ic_core = c_conn.execute("PRAGMA integrity_check;").fetchall()
    fk_core = c_conn.execute("PRAGMA foreign_key_check;").fetchall()
    fts_indexed = c_conn.execute("SELECT COUNT(*) FROM entries WHERE id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'a* OR e* OR i* OR o* OR u* OR the');").fetchone()[0]
    fts_kw = c_conn.execute("SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH '\"knowledge\"*';").fetchone()[0]
    norm_probe = c_conn.execute(
        "SELECT COALESCE(headword, headword_lower) FROM entries WHERE headword_norm = 'regime' ORDER BY id;"
    ).fetchall()
    c_conn.close()

    # Finalize Extended DB
    e_conn.executemany(
        "INSERT INTO entry_extensions (entry_id, pronunciation_id, audio_id, etymology_id, primary_sense_number) VALUES (?, ?, ?, ?, ?);",
        ext_entry_batch,
    )
    e_conn.executemany(
        "INSERT INTO senses_ext (entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?);",
        ext_senses_batch,
    )
    e_conn.executemany(
        "INSERT INTO word_form_tags (entry_id, form_index, tags_id) VALUES (?, ?, ?);",
        ext_wf_tags_batch,
    )
    ext_meta = [
        ("dataset_name", "Lexica English Monolingual Dictionary (Extended Enrichment)"),
        ("pack_id", f"{PACK_ID}-extended"),
        ("pack_layer", "extended"),
        ("pack_version", EXTENDED_PACK_VERSION),
        ("core_compatible_version", CORE_PACK_VERSION),
        ("dataset_version", DATASET_VERSION),
        ("schema_version", "3"),
        ("accepted_entries", str(total_entries)),
        ("total_senses", str(total_senses)),
    ]
    e_conn.executemany("INSERT INTO metadata (key, value) VALUES (?, ?);", ext_meta)
    e_conn.executescript(
        """
        CREATE INDEX idx_ext_senses_entry ON senses_ext(entry_id, sense_number);
        ANALYZE;
        VACUUM;
        """
    )
    ic_ext = e_conn.execute("PRAGMA integrity_check;").fetchall()
    e_conn.close()

    gzip_file(core_db, core_gz, compresslevel=9)
    gzip_file(ext_db, ext_gz, compresslevel=9)

    core_bytes = core_db.stat().st_size
    core_gz_bytes = core_gz.stat().st_size
    core_sha = sha256_file(core_db)
    core_gz_sha = sha256_file(core_gz)

    ext_bytes = ext_db.stat().st_size
    ext_gz_bytes = ext_gz.stat().st_size
    ext_sha = sha256_file(ext_db)
    ext_gz_sha = sha256_file(ext_gz)

    collision_items = {k: sorted(v) for k, v in hw_norm_collisions.items() if len(v) > 1}

    audit_report = {
        "build_seconds": round(time.perf_counter() - t0, 3),
        "schema_version": 3,
        "pack_layer": "core",
        "pack_version": CORE_PACK_VERSION,
        "counts": {
            "total_entries": total_entries,
            "entries_with_valid_primary_definition": total_entries - entries_missing_def,
            "entries_missing_definitions": entries_missing_def,
            "word_forms_preserved": total_word_forms,
            "entries_with_primary_ipa": entries_with_ipa,
            "ipa_coverage_percent": round(entries_with_ipa * 100.0 / total_entries, 2),
            "source_total_senses": total_senses,
            "entries_with_extra_senses_for_extended": sum(1 for r in core_entries_batch if r[7] > 0),
        },
        "primary_definition_audit": {
            "selection_reason_counts": dict(selection_reasons),
            "markup_artifacts_cleaned": markup_cleaned_count,
            "entries_whose_only_senses_are_crossref_or_inflection": entries_bare_crossref_only,
            "promoted_samples": promoted_samples,
        },
        "duplicate_and_normalization_audit": {
            "distinct_headword_lower": len(distinct_hw_lower),
            "multi_entry_headword_lower_homographs": sum(1 for c in distinct_hw_lower.values() if c > 1),
            "same_headword_lower_and_pos_entries": sum(1 for c in hw_pos_counter.values() if c > 1),
            "non_ascii_headwords": non_ascii_hw_count,
            "apostrophe_headwords": apostrophe_hw_count,
            "core_entries_headword_norm_rows": hw_norm_stored_count,
            "core_word_forms_norm_rows": wf_norm_stored_count,
            "normalization_collision_groups": len(collision_items),
            "normalization_collision_samples": dict(list(collision_items.items())[:25]),
        },
        "search_index_integrity": {
            "core_integrity_check": ic_core == [("ok",)],
            "core_foreign_key_check": len(fk_core) == 0,
            "extended_integrity_check": ic_ext == [("ok",)],
            "fts5_knowledge_hits": fts_kw,
            "fts5_vowel_or_the_sample_hits": fts_indexed,
            "normalized_regime_lookup": [r[0] for r in norm_probe],
        },
        "sizes": {
            "core_db_bytes": core_bytes,
            "core_db_mib": round(core_bytes / (1024 * 1024), 2),
            "core_gz_bytes": core_gz_bytes,
            "core_gz_mib": round(core_gz_bytes / (1024 * 1024), 2),
            "extended_db_bytes": ext_bytes,
            "extended_db_mib": round(ext_bytes / (1024 * 1024), 2),
            "extended_gz_bytes": ext_gz_bytes,
            "extended_gz_mib": round(ext_gz_bytes / (1024 * 1024), 2),
        },
        "checksums": {
            "core_db_sha256": core_sha,
            "core_gz_sha256": core_gz_sha,
            "extended_db_sha256": ext_sha,
            "extended_gz_sha256": ext_gz_sha,
        },
    }

    manifest = {
        "packId": PACK_ID,
        "targetLanguage": "en",
        "format": "sqlite-gzip",
        "packLayer": "core",
        "schemaVersion": 3,
        "packVersion": CORE_PACK_VERSION,
        "datasetVersion": DATASET_VERSION,
        "releaseTag": release_tag,
        "downloadUrl": f"https://github.com/{repo_slug}/releases/download/{release_tag}/lexica_english_core.db.gz",
        "compressedSizeBytes": core_gz_bytes,
        "compressedSha256": core_gz_sha,
        "uncompressedSizeBytes": core_bytes,
        "uncompressedSha256": core_sha,
        "acceptedEntries": total_entries,
        "distinctHeadwords": len(distinct_hw_lower),
        "totalSenses": total_senses,
        "corePrimarySenses": total_entries,
        "totalWordForms": total_word_forms,
        "extendedCompanion": {
            "packId": f"{PACK_ID}-extended",
            "packLayer": "extended",
            "schemaVersion": 3,
            "packVersion": EXTENDED_PACK_VERSION,
            "optional": True,
            "autoDownload": False,
            "compressedSizeBytes": ext_gz_bytes,
            "compressedSha256": ext_gz_sha,
            "uncompressedSizeBytes": ext_bytes,
            "uncompressedSha256": ext_sha,
            "downloadUrl": None,
        },
        "attribution": {
            "sourceName": SOURCE_INFO["name"],
            "license": SOURCE_INFO["license"],
            "attributionText": SOURCE_INFO["attribution_text"],
            "sourceUrl": SOURCE_INFO["source_url"],
            "licenseUrl": SOURCE_INFO["license_url"],
        },
    }

    (out_dir / "core_audit_report.json").write_text(json.dumps(audit_report, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / "pack_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"manifest": manifest, "audit": audit_report}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Lexica English Core + Extended SQLite Packs (Schema v3)")
    parser.add_argument("--source", default=None, help="Path to Kaikki English JSONL (.gz)")
    parser.add_argument("--from-sqlite", default="/tmp/lexica_english_v030.db", help="Canonical v0.3.0 SQLite DB path")
    parser.add_argument("--out-dir", default="/tmp/lexica_core_v040", help="Output directory")
    parser.add_argument("--release-tag", default=DEFAULT_RELEASE_TAG, help="GitHub release tag")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub owner/repo")
    parser.add_argument("--limit", type=int, default=None, help="Optional entry limit")
    args = parser.parse_args()

    if args.source and Path(args.source).exists():
        data = load_canonical_dataset_from_jsonl_gz(Path(args.source), limit=args.limit)
    else:
        data = load_canonical_dataset_from_sqlite(Path(args.from_sqlite))
        if args.limit:
            data["entries"] = data["entries"][: args.limit]

    result = build_core_and_extended(data, Path(args.out_dir), args.release_tag, args.repo)
    print(json.dumps(result["manifest"], indent=2))
    print("--- AUDIT SUMMARY ---")
    print(json.dumps({
        "counts": result["audit"]["counts"],
        "primary_definition_audit_reasons": result["audit"]["primary_definition_audit"]["selection_reason_counts"],
        "duplicate_and_normalization_audit": {
            k: v for k, v in result["audit"]["duplicate_and_normalization_audit"].items()
            if k != "normalization_collision_samples"
        },
        "search_index_integrity": result["audit"]["search_index_integrity"],
        "sizes": result["audit"]["sizes"],
    }, indent=2))


if __name__ == "__main__":
    main()
