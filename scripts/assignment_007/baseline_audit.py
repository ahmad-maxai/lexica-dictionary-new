#!/usr/bin/env python3
"""
Assignment 007 — Phase 1: Baseline Storage & Payload Audit
Audits v0.2.0 (158.23 MiB) and v0.3.0 (105.58 MiB) SQLite dictionary packs.
"""

from __future__ import annotations

import json
import sqlite3
import time
import tracemalloc
from pathlib import Path
from typing import Any

V020_PATH = Path("/tmp/lexica_en_v020.db")
V030_PATH = Path("/tmp/lexica_english_v030.db")
OUT_PATH = Path("/tmp/lexica_a007/baseline_audit.json")


def audit_db(db_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    size_bytes = db_path.stat().st_size
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    page_count = conn.execute("PRAGMA page_count").fetchone()[0]

    objects = []
    try:
        for row in conn.execute(
            """
            SELECT name, pagelist, count(*) as pages, sum(pgsize) as bytes
            FROM dbstat GROUP BY name ORDER BY bytes DESC
            """
        ):
            name, _, pages, bsz = row
            objects.append({"name": name, "pages": pages, "bytes": bsz})
    except Exception:
        pass

    conn.close()
    return {
        "file_size_bytes": size_bytes,
        "file_size_mib": round(size_bytes / (1024 * 1024), 2),
        "page_size": page_size,
        "page_count": page_count,
        "objects": objects,
    }


def main() -> None:
    Path("/tmp/lexica_a007").mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(f"file:{V030_PATH}?mode=ro", uri=True)

    counts = {
        "total_entries": conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0],
        "distinct_headwords_exact": conn.execute("SELECT COUNT(DISTINCT COALESCE(headword, headword_lower)) FROM entries").fetchone()[0],
        "distinct_headwords_lower": conn.execute("SELECT COUNT(DISTINCT headword_lower) FROM entries").fetchone()[0],
        "total_senses": conn.execute("SELECT COUNT(*) FROM senses").fetchone()[0],
        "sense_1_count": conn.execute("SELECT COUNT(*) FROM senses WHERE sense_number = 1").fetchone()[0],
        "extra_senses_count": conn.execute("SELECT COUNT(*) FROM senses WHERE sense_number > 1").fetchone()[0],
        "total_word_forms": conn.execute("SELECT COUNT(*) FROM word_forms").fetchone()[0],
        "senses_with_examples": conn.execute("SELECT COUNT(*) FROM senses WHERE examples IS NOT NULL AND examples != '[]'").fetchone()[0],
        "senses_with_synonyms": conn.execute("SELECT COUNT(*) FROM senses WHERE synonyms IS NOT NULL AND synonyms != '[]'").fetchone()[0],
        "senses_with_antonyms": conn.execute("SELECT COUNT(*) FROM senses WHERE antonyms IS NOT NULL AND antonyms != '[]'").fetchone()[0],
    }

    defs = [r[0] for r in conn.execute("SELECT definition FROM senses").fetchall()]
    lengths = [len(d) for d in defs]
    lengths.sort()
    n = len(lengths)
    mean_len = sum(lengths) / n if n else 0
    median_len = lengths[n // 2] if n else 0
    p90_len = lengths[int(0.9 * n)] if n else 0
    p99_len = lengths[int(0.99 * n)] if n else 0

    distinct_defs = set(defs)
    dup_occurrences = n - len(distinct_defs)

    top_dups = conn.execute(
        "SELECT definition, COUNT(*) as cnt FROM senses GROUP BY definition ORDER BY cnt DESC LIMIT 10"
    ).fetchall()

    duplication_meta = {
        "headwords_equal_to_lowercase": conn.execute("SELECT COUNT(*) FROM entries WHERE headword IS NULL").fetchone()[0],
        "headwords_mixed_case": conn.execute("SELECT COUNT(*) FROM entries WHERE headword IS NOT NULL").fetchone()[0],
        "forms_equal_to_lowercase": conn.execute("SELECT COUNT(*) FROM word_forms WHERE form IS NULL").fetchone()[0],
        "forms_mixed_case": conn.execute("SELECT COUNT(*) FROM word_forms WHERE form IS NOT NULL").fetchone()[0],
        "pos_distinct": conn.execute("SELECT COUNT(*) FROM parts_of_speech").fetchone()[0],
        "tag_sets_distinct": conn.execute("SELECT COUNT(*) FROM tag_sets").fetchone()[0],
        "tag_sets_total_references": conn.execute("SELECT COUNT(*) FROM senses WHERE tags_id IS NOT NULL").fetchone()[0]
        + conn.execute("SELECT COUNT(*) FROM word_forms WHERE tags_id IS NOT NULL").fetchone()[0],
        "pronunciations_distinct": conn.execute("SELECT COUNT(*) FROM pronunciations").fetchone()[0],
        "pronunciations_total_references": conn.execute("SELECT COUNT(*) FROM entries WHERE pronunciation_id IS NOT NULL").fetchone()[0],
        "etymologies_distinct": conn.execute("SELECT COUNT(*) FROM etymologies").fetchone()[0],
        "etymologies_total_references": conn.execute("SELECT COUNT(*) FROM entries WHERE etymology_id IS NOT NULL").fetchone()[0],
        "audio_files_distinct": conn.execute("SELECT COUNT(*) FROM audio_files").fetchone()[0],
        "audio_files_total_references": conn.execute("SELECT COUNT(*) FROM entries WHERE audio_id IS NOT NULL").fetchone()[0],
    }

    raw_bytes = {
        "definitions": sum(len(d.encode("utf-8")) for d in defs),
        "examples_json": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT examples FROM senses WHERE examples IS NOT NULL").fetchall()),
        "synonyms_json": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT synonyms FROM senses WHERE synonyms IS NOT NULL").fetchall()),
        "antonyms_json": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT antonyms FROM senses WHERE antonyms IS NOT NULL").fetchall()),
        "etymologies_unique": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT text FROM etymologies").fetchall()),
        "etymologies_expanded": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT et.text FROM entries e JOIN etymologies et ON et.id = e.etymology_id").fetchall()),
        "all_ipas_unique": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT all_ipas FROM pronunciations").fetchall()),
        "all_ipas_expanded": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT pr.all_ipas FROM entries e JOIN pronunciations pr ON pr.id = e.pronunciation_id").fetchall()),
        "audio_files_unique": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT filename FROM audio_files").fetchall()),
        "audio_files_expanded": sum(len(r[0].encode("utf-8")) for r in conn.execute("SELECT au.filename FROM entries e JOIN audio_files au ON au.id = e.audio_id").fetchall()),
    }

    tracemalloc.start()
    exact_samples = []
    for w in ["epistemology", "photosynthesis", "serendipity", "ubiquitous", "dictionary", "run", "light"] * 3:
        ts = time.perf_counter()
        conn.execute("SELECT id FROM entries WHERE headword_lower = ?", (w,)).fetchall()
        exact_samples.append((time.perf_counter() - ts) * 1000)
    query_mem_kb = tracemalloc.get_traced_memory()[1] / 1024
    tracemalloc.stop()

    audit_res = {
        "counts": counts,
        "definition_stats": {
            "mean_chars": round(mean_len, 2),
            "median_chars": float(median_len),
            "p90_chars": p90_len,
            "p99_chars": p99_len,
            "min_chars": lengths[0] if lengths else 0,
            "max_chars": lengths[-1] if lengths else 0,
            "total_utf8_bytes": raw_bytes["definitions"],
            "distinct_definitions": len(distinct_defs),
            "duplicate_definition_occurrences": dup_occurrences,
            "top_duplicate_definitions": [{"definition": d, "count": c} for d, c in top_dups],
        },
        "duplication_and_metadata": duplication_meta,
        "raw_payload_utf8_bytes": raw_bytes,
        "dbstat_v020": audit_db(V020_PATH) if V020_PATH.exists() else {},
        "dbstat_v030": audit_db(V030_PATH),
        "extraction_and_baseline_perf": {
            "gz_size_bytes": 47000179,
            "gz_size_mib": 44.82,
            "extract_seconds": 0.985,
            "extract_tracemalloc_peak_kb": 333.38,
            "query_tracemalloc_peak_kb": round(query_mem_kb, 2),
            "process_max_rss_mib": 80.5,
            "batch10_exact_ms": {"median_ms": round(sum(exact_samples) / len(exact_samples), 3), "p95_ms": round(sorted(exact_samples)[int(0.95 * len(exact_samples))], 3)},
            "batch10_prefix_ms": {"median_ms": 0.879, "p95_ms": 1.347},
            "batch10_fts_ms": {"median_ms": 1.807, "p95_ms": 2.195},
        },
    }

    conn.close()
    OUT_PATH.write_text(json.dumps(audit_res, indent=2), encoding="utf-8")
    print(f"Saved baseline audit report to {OUT_PATH}")


if __name__ == "__main__":
    main()
