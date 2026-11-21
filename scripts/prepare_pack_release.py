#!/usr/bin/env python3
"""
Lexica Build-Time Dataset Preparation & Release Pipeline
Automates:
1. Compiling/optimizing SQLite dictionary packages
2. Running integrity, foreign-key, FTS5, and search verification
3. Producing gzip-compressed distribution assets (.db.gz)
4. Computing compressed & uncompressed SHA-256 checksums and exact sizes
5. Generating manifest JSON and before/after storage audit metrics
"""

import argparse
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Optional

from compile_english_dictionary import compile_dictionary, compile_from_sqlite, SOURCE_INFO
from verify_english_database import run_comprehensive_verification


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def gzip_file(src: Path, dst: Path, level: int = 9) -> None:
    with src.open("rb") as fin, gzip.open(dst, "wb", compresslevel=level) as fout:
        shutil.copyfileobj(fin, fout, length=65536)


def collect_dbstat_summary(db_path: Path) -> dict:
    conn = sqlite3.connect(f"file:{db_path.resolve()}?mode=ro", uri=True)
    summary = {
        "file_size_bytes": db_path.stat().st_size,
        "page_size": conn.execute("PRAGMA page_size;").fetchone()[0],
        "page_count": conn.execute("PRAGMA page_count;").fetchone()[0],
        "objects": [],
    }
    try:
        rows = conn.execute(
            """SELECT name, COUNT(*) AS pages, SUM(pgsize) AS bytes, SUM(payload) AS payload, SUM(unused) AS unused
               FROM dbstat GROUP BY name ORDER BY bytes DESC;"""
        ).fetchall()
        for name, pages, b, pay, unu in rows:
            summary["objects"].append({
                "name": name,
                "pages": pages,
                "bytes": b,
                "payload_bytes": pay,
                "unused_bytes": unu,
            })
    except sqlite3.OperationalError:
        pass
    conn.close()
    return summary


def run_pipeline(
    out_dir: Path,
    source_jsonl: Optional[str],
    from_sqlite: Optional[str],
    release_tag: str,
    repo_slug: str,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = out_dir / "lexica_english.db"
    gz_path = out_dir / "lexica_english.db.gz"
    manifest_path = out_dir / "pack_manifest.json"
    verify_path = out_dir / "verification_report.json"
    audit_path = out_dir / "storage_audit_report.json"

    if from_sqlite:
        compile_report = compile_from_sqlite(from_sqlite, str(db_path))
    elif source_jsonl:
        compile_report = compile_dictionary(source_jsonl, str(db_path))
    else:
        raise ValueError("Provide either --source or --from-sqlite")

    verify_report = run_comprehensive_verification(str(db_path))
    if not verify_report.get("all_passed"):
        raise RuntimeError("Database verification failed; aborting release preparation.")

    gzip_file(db_path, gz_path, level=9)

    uncompressed_bytes = db_path.stat().st_size
    compressed_bytes = gz_path.stat().st_size
    uncompressed_sha256 = sha256_file(db_path)
    compressed_sha256 = sha256_file(gz_path)

    manifest = {
        "packId": "en-wiktionary-sqlite",
        "targetLanguage": "en",
        "format": "sqlite-gzip",
        "schemaVersion": 2,
        "packVersion": compile_report["pack_version"],
        "datasetVersion": SOURCE_INFO["dataset_version"],
        "releaseTag": release_tag,
        "downloadUrl": f"https://github.com/{repo_slug}/releases/download/{release_tag}/lexica_english.db.gz",
        "compressedSizeBytes": compressed_bytes,
        "compressedSha256": compressed_sha256,
        "uncompressedSizeBytes": uncompressed_bytes,
        "uncompressedSha256": uncompressed_sha256,
        "acceptedEntries": verify_report["counts"]["entries"],
        "distinctHeadwords": verify_report["counts"]["distinct_headwords"],
        "totalSenses": verify_report["counts"]["senses"],
        "attribution": {
            "sourceName": SOURCE_INFO["name"],
            "license": SOURCE_INFO["license"],
            "attributionText": SOURCE_INFO["attribution_text"],
            "sourceUrl": SOURCE_INFO["source_url"],
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        },
    }

    audit = {
        "compile_report": compile_report,
        "dbstat_optimized": collect_dbstat_summary(db_path),
        "compressed_size_bytes": compressed_bytes,
        "compressed_sha256": compressed_sha256,
        "uncompressed_size_bytes": uncompressed_bytes,
        "uncompressed_sha256": uncompressed_sha256,
    }
    if from_sqlite and os.path.exists(from_sqlite):
        baseline_path = Path(from_sqlite)
        audit["dbstat_baseline"] = collect_dbstat_summary(baseline_path)
        saved_bytes = baseline_path.stat().st_size - uncompressed_bytes
        audit["storage_reduction_bytes"] = saved_bytes
        audit["storage_reduction_percent"] = round((saved_bytes * 100.0) / baseline_path.stat().st_size, 2)

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    verify_path.write_text(json.dumps(verify_report, indent=2), encoding="utf-8")
    audit_path.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare Lexica dictionary release assets and manifest")
    parser.add_argument("--source", default=None, help="Path to Kaikki JSONL (.gz)")
    parser.add_argument("--from-sqlite", default=None, help="Path to source SQLite DB to optimize")
    parser.add_argument("--out-dir", default="/tmp/lexica_release_v030", help="Output directory")
    parser.add_argument("--release-tag", default="prototype-en-v0.3.0", help="GitHub release tag")
    parser.add_argument("--repo", default="ahmad-maxai/lexica-dictionary-new", help="GitHub owner/repo")
    args = parser.parse_args()

    manifest_out = run_pipeline(
        Path(args.out_dir),
        args.source,
        args.from_sqlite,
        args.release_tag,
        args.repo,
    )
    print(json.dumps(manifest_out, indent=2))
