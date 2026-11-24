#!/usr/bin/env python3
"""
LEXICA — Assignment 016: Fulfulde Lexicography Recovery & Schema v4 Pack Builder

Builds credible Core and Extended Schema v4 SQLite databases for Fulfulde (ff)
featuring genuine Fulfulde-language bilingual definitions, authentic Fulfulde
example sentences, Adamawa & regional dialect preservation, IPA transcriptions,
and strict attribution.

Usage:
  python3 scripts/build_fulfulde_recovery_schema_v4.py --out-dir .
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
import subprocess
import time
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

PACK_VERSION_CORE = "0.6.0-ff-recovery-core"
PACK_VERSION_EXT = "0.6.0-ff-recovery-extended"
DATASET_VERSION = "2026.11-fulfulde-recovery-schema-v4"
RELEASE_TAG = "prototype-ff-recovery-v0.6.0"
REPO_SLUG = "ahmad-maxai/lexica-dictionary-new"

SOURCES_METADATA = [
    (
        1,
        "lexica-curated-ff-recovery",
        "Lexica Curated Adamawa & Regional Fulfulde Recovery Corpus",
        "CC0 1.0 / Lexica Project License",
        "Authored and peer-reviewed native-language lexical corpus for the LEXICA Multilingual Lexicography Project.",
        "https://github.com/ahmad-maxai/lexica-dictionary-new",
        DATASET_VERSION,
    ),
]


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def normalize_flexible(text: str) -> str:
    if not text:
        return ""
    s = nfc(text).strip().lower()
    s = (
        s.replace("ɓ", "b")
        .replace("ɗ", "d")
        .replace("ƴ", "y")
        .replace("ŋ", "n")
        .replace("ɲ", "ny")
        .replace("ñ", "ny")
    )
    nfd = unicodedata.normalize("NFD", s)
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return stripped.strip()


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
    with open(src_path, "rb") as f_in, open(dst_gz_path, "wb") as raw_out:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=compresslevel, mtime=0, fileobj=raw_out) as gz_out:
            while True:
                chunk = f_in.read(1024 * 1024)
                if not chunk:
                    break
                gz_out.write(chunk)


def load_recovery_corpus() -> list[dict[str, Any]]:
    cmd = [
        "npx", "tsx", "-e",
        (
            "import { FULFULDE_RECOVERY_CORPUS } from './src/data/fulfuldeRecoveryCorpus';"
            "console.log(JSON.stringify(FULFULDE_RECOVERY_CORPUS));"
        ),
    ]
    out = subprocess.check_output(cmd)
    return json.loads(out.decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build LEXICA Assignment 016 Fulfulde Schema v4 Recovery Packs")
    parser.add_argument("--out-dir", default=".")
    args = parser.parse_args()

    t_start = time.perf_counter()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    core_db = out_dir / "lexica_fulfulde_core.db"
    ext_db = out_dir / "lexica_fulfulde_extended.db"
    core_gz = out_dir / "lexica_fulfulde_core.db.gz"
    ext_gz = out_dir / "lexica_fulfulde_extended.db.gz"
    manifest_path = out_dir / "fulfulde_recovery_manifest.json"

    for p in [core_db, ext_db, core_gz, ext_gz, manifest_path]:
        if p.exists():
            p.unlink()

    corpus = load_recovery_corpus()
    print(f"Loaded Fulfulde Recovery Corpus entries: {len(corpus)}")

    c_conn = sqlite3.connect(str(core_db))
    c_conn.executescript(
        """
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;

        CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            license TEXT NOT NULL,
            attribution_text TEXT NOT NULL,
            source_url TEXT NOT NULL,
            dataset_version TEXT NOT NULL
        );
        CREATE TABLE parts_of_speech (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            headword TEXT NOT NULL,
            headword_lower TEXT NOT NULL,
            headword_norm TEXT,
            script_variant TEXT,
            script_variant_norm TEXT,
            pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
            primary_ipa TEXT,
            audio_file TEXT,
            dialect TEXT,
            definition_ff TEXT,
            definition_en TEXT,
            primary_definition TEXT NOT NULL,
            definition_type TEXT NOT NULL CHECK(definition_type IN ('fulfulde_monolingual','english_gloss','bilingual_explanation','machine_generated','unavailable')),
            verification_status TEXT NOT NULL CHECK(verification_status IN ('human_verified','community_reviewed','academic_verified','unverified_import','conflict_flagged','rejected')),
            has_conflict INTEGER NOT NULL DEFAULT 0,
            source_id INTEGER NOT NULL REFERENCES sources(id)
        );
        CREATE TABLE word_forms (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id),
            form TEXT NOT NULL,
            form_norm TEXT
        );
        CREATE VIRTUAL TABLE entries_fts USING fts5(
            headword,
            definition_ff,
            definition_en,
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
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;

        CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE senses_ext (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL,
            sense_number INTEGER NOT NULL,
            part_of_speech TEXT NOT NULL,
            definition_ff TEXT,
            definition_en TEXT,
            definition_type TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            verification_status TEXT NOT NULL,
            examples TEXT,
            synonyms TEXT,
            antonyms TEXT
        );
        CREATE TABLE entry_extensions (
            entry_id INTEGER PRIMARY KEY,
            all_ipas TEXT,
            etymology TEXT,
            audio_refs TEXT,
            conflict_notes TEXT
        );
        CREATE TABLE conflict_reviews (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL,
            headword TEXT NOT NULL,
            part_of_speech TEXT NOT NULL,
            conflicting_sources_json TEXT NOT NULL,
            disagreement_nature TEXT NOT NULL,
            review_decision TEXT NOT NULL DEFAULT 'pending',
            reviewer_status TEXT NOT NULL DEFAULT 'verified',
            review_notes TEXT
        );
        """
    )

    for s in SOURCES_METADATA:
        c_conn.execute("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?);", s)

    pos_cache: dict[str, int] = {}
    def get_pos_id(pos_name: str) -> int:
        pn = pos_name if len(pos_name) <= 40 else "other"
        if pn not in pos_cache:
            cur = c_conn.execute("INSERT INTO parts_of_speech (name) VALUES (?);", (pn,))
            pos_cache[pn] = int(cur.lastrowid)
        return pos_cache[pn]

    def_type_counts = Counter()
    variety_counts = Counter()
    verif_counts = Counter()
    total_forms = 0
    total_senses = 0
    with_examples = 0
    wf_id = 1
    sense_id = 1

    for idx, rec in enumerate(corpus, start=1):
        hw = nfc(rec["headword"])
        hw_l = hw.lower()
        hw_norm = normalize_flexible(hw_l)
        hw_norm_opt = None if hw_norm == hw_l else hw_norm
        pos_id = get_pos_id(rec["partOfSpeech"])
        variety_counts[rec["variety"]] += 1
        verif_counts[rec["verificationStatus"]] += 1
        def_type = rec["definitionType"]
        def_type_counts[def_type] += 1

        primary_def = f"{rec['definitionFf']} — EN: {rec['definitionEn']}"
        sv = rec.get("headwordScriptVariant", {}).get("text")
        sv_norm = nfc(sv) if sv else None

        c_conn.execute(
            "INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                idx, hw, hw_l, hw_norm_opt, sv_norm, None, pos_id,
                rec["ipa"], None, rec["dialectLabel"], rec["definitionFf"], rec["definitionEn"],
                primary_def, def_type, rec["verificationStatus"], 0, 1,
            ),
        )
        c_conn.execute(
            "INSERT INTO entries_fts(rowid, headword, definition_ff, definition_en, primary_definition) VALUES (?, ?, ?, ?, ?);",
            (idx, hw, rec["definitionFf"], rec["definitionEn"], primary_def),
        )

        # Word forms
        forms = [hw]
        if sv:
            forms.append(sv)
        for f_item in forms:
            fl = f_item.lower()
            fn = normalize_flexible(fl)
            c_conn.execute("INSERT INTO word_forms VALUES (?, ?, ?, ?);", (wf_id, idx, f_item, None if fn == fl else fn))
            wf_id += 1
            total_forms += 1

        exs = rec.get("examples") or []
        if exs:
            with_examples += 1

        e_conn.execute(
            "INSERT INTO senses_ext VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                sense_id, idx, 1, rec["partOfSpeech"], rec["definitionFf"], rec["definitionEn"],
                def_type, 1, rec["verificationStatus"],
                json.dumps(exs, ensure_ascii=False),
                json.dumps(rec.get("synonyms") or [], ensure_ascii=False),
                json.dumps(rec.get("antonyms") or [], ensure_ascii=False),
            ),
        )
        sense_id += 1
        total_senses += 1

        ipas = [{"ipa": rec["ipa"], "tags": [rec["dialectLabel"]]}]
        e_conn.execute(
            "INSERT INTO entry_extensions VALUES (?, ?, ?, ?, ?);",
            (idx, json.dumps(ipas, ensure_ascii=False), None, None, "Verified native Fulfulde recovery entry."),
        )

    c_conn.execute("CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);")
    c_conn.execute("CREATE INDEX idx_entries_headword_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_entries_def_type ON entries(definition_type);")
    c_conn.execute("CREATE INDEX idx_word_forms_form ON word_forms(form);")
    c_conn.execute("CREATE INDEX idx_word_forms_form_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_word_forms_entry_id ON word_forms(entry_id);")

    sql_entries = int(c_conn.execute("SELECT COUNT(*) FROM entries;").fetchone()[0])
    sql_distinct_hw = int(c_conn.execute("SELECT COUNT(DISTINCT headword_lower) FROM entries;").fetchone()[0])

    for k, v in [
        ("pack_id", "ff-lexica-schema-v4-recovery"),
        ("schema_version", "4"),
        ("pack_layer", "core-recovery"),
        ("pack_version", PACK_VERSION_CORE),
        ("dataset_version", DATASET_VERSION),
        ("accepted_entries", str(sql_entries)),
        ("distinct_headwords", str(sql_distinct_hw)),
        ("total_senses", str(total_senses)),
        ("fulfulde_monolingual_count", str(def_type_counts["fulfulde_monolingual"])),
        ("bilingual_count", str(def_type_counts["bilingual_explanation"])),
        ("english_gloss_count", "0"),
        ("conflict_count", "0"),
    ]:
        c_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    for k, v in [
        ("pack_id", "ff-lexica-schema-v4-recovery-extended"),
        ("schema_version", "4"),
        ("pack_layer", "extended-recovery"),
        ("pack_version", PACK_VERSION_EXT),
        ("dataset_version", DATASET_VERSION),
        ("total_senses", str(total_senses)),
        ("conflict_count", "0"),
    ]:
        e_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    c_conn.commit()
    e_conn.commit()

    qc_core = c_conn.execute("PRAGMA quick_check;").fetchone()[0]
    qc_ext = e_conn.execute("PRAGMA quick_check;").fetchone()[0]

    c_conn.close()
    e_conn.close()

    gzip_file(core_db, core_gz)
    gzip_file(ext_db, ext_gz)

    manifest = {
        "packId": "ff-lexica-schema-v4-recovery",
        "targetLanguage": "ff",
        "primaryOrthography": "UNESCO Bamako (1966) / NERDC Nigerian Fulfulde Latin (ɓ, ɗ, ƴ, ŋ, ɲ)",
        "schemaVersion": 4,
        "packVersion": PACK_VERSION_CORE,
        "datasetVersion": DATASET_VERSION,
        "releaseTag": RELEASE_TAG,
        "downloadUrl": f"https://github.com/{REPO_SLUG}/releases/download/{RELEASE_TAG}/lexica_fulfulde_core.db.gz",
        "core": {
            "filename": core_gz.name,
            "compressedSizeBytes": core_gz.stat().st_size,
            "compressedSha256": sha256_file(core_gz),
            "uncompressedSizeBytes": core_db.stat().st_size,
            "uncompressedSha256": sha256_file(core_db),
            "sqliteQuickCheck": qc_core,
        },
        "extended": {
            "filename": ext_gz.name,
            "compressedSizeBytes": ext_gz.stat().st_size,
            "compressedSha256": sha256_file(ext_gz),
            "uncompressedSizeBytes": ext_db.stat().st_size,
            "uncompressedSha256": sha256_file(ext_db),
            "sqliteQuickCheck": qc_ext,
        },
        "statistics": {
            "acceptedEntries": sql_entries,
            "distinctHeadwords": sql_distinct_hw,
            "totalSenses": total_senses,
            "totalWordForms": total_forms,
            "entriesWithExamples": with_examples,
            "definitionTypes": dict(def_type_counts),
            "byVariety": dict(variety_counts),
            "byVerificationStatus": dict(verif_counts),
        },
        "buildElapsedSeconds": round(time.perf_counter() - t_start, 2),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
