#!/usr/bin/env python3
"""
Lexica English SQLite Verifier
Supports both Schema v1 (v0.2.0) and Schema v2 (v0.3.0 optimized).
Exits non-zero if any required verification check fails.
"""

import argparse
import json
import os
import resource
import sqlite3
import sys
import time
from typing import Any, Dict, List

TEST_WORDS = [
    "epistemology",
    "photosynthesis",
    "serendipity",
    "ubiquitous",
    "dictionary",
    "run",
    "light",
]


def get_process_memory_mb() -> float:
    rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(rss_kb / 1024.0, 2)


def detect_schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM metadata WHERE key = 'schema_version';").fetchone()
    if row and str(row[0]).isdigit():
        return int(row[0])
    has_pos_table = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='parts_of_speech';"
    ).fetchone()[0]
    return 2 if has_pos_table else 1


def fetch_entries_by_headword(conn: sqlite3.Connection, schema_ver: int, headword_lower: str) -> List[Dict[str, Any]]:
    if schema_ver >= 2:
        rows = conn.execute(
            """SELECT e.id, COALESCE(e.headword, e.headword_lower), p.name, e.primary_ipa, pr.all_ipas
               FROM entries e
               JOIN parts_of_speech p ON p.id = e.pos_id
               LEFT JOIN pronunciations pr ON pr.id = e.pronunciation_id
               WHERE e.headword_lower = ?
               ORDER BY e.id ASC;""",
            (headword_lower,),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, headword, part_of_speech, primary_ipa, all_ipas
               FROM entries WHERE headword_lower = ? ORDER BY id ASC;""",
            (headword_lower,),
        ).fetchall()

    results = []
    for eid, hw, pos, pipa, aipas in rows:
        senses = conn.execute(
            "SELECT sense_number, definition, examples FROM senses WHERE entry_id = ? ORDER BY sense_number ASC;",
            (eid,),
        ).fetchall()
        results.append({
            "id": eid,
            "headword": hw,
            "pos": pos,
            "primary_ipa": pipa,
            "all_ipas": json.loads(aipas) if aipas else [],
            "senses": [{"sense_number": s[0], "definition": s[1], "has_examples": bool(s[2])} for s in senses],
        })
    return results


def run_comprehensive_verification(db_path: str) -> Dict[str, Any]:
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found: {db_path}")

    mem_before = get_process_memory_mb()
    conn = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    schema_ver = detect_schema_version(conn)

    integrity = conn.execute("PRAGMA integrity_check;").fetchall()
    fk_check = conn.execute("PRAGMA foreign_key_check;").fetchall()

    report: Dict[str, Any] = {
        "database_path": db_path,
        "schema_version": schema_ver,
        "database_size_bytes": os.path.getsize(db_path),
        "database_size_mb": round(os.path.getsize(db_path) / (1024 * 1024), 2),
        "integrity_check": integrity == [("ok",)],
        "foreign_key_check": len(fk_check) == 0,
        "counts": {
            "entries": conn.execute("SELECT COUNT(*) FROM entries;").fetchone()[0],
            "distinct_headwords": conn.execute("SELECT COUNT(DISTINCT headword_lower) FROM entries;").fetchone()[0],
            "senses": conn.execute("SELECT COUNT(*) FROM senses;").fetchone()[0],
            "word_forms": conn.execute("SELECT COUNT(*) FROM word_forms;").fetchone()[0],
        },
        "target_word_tests": {},
        "prefix_search_test": {},
        "case_insensitivity_test": {},
        "multi_pos_test": {},
        "missing_word_test": {},
        "pagination_test": {},
        "fts5_search_test": {},
        "reopen_test": {},
        "performance": {},
    }

    all_passed = bool(report["integrity_check"] and report["foreign_key_check"])

    for word in TEST_WORDS:
        entries = fetch_entries_by_headword(conn, schema_ver, word.lower())
        total_senses = sum(len(e["senses"]) for e in entries)
        ok = len(entries) > 0 and total_senses > 0
        if not ok:
            all_passed = False
        report["target_word_tests"][word] = {
            "status": "FOUND" if ok else "MISSING",
            "entries_count": len(entries),
            "total_senses": total_senses,
            "parts_of_speech": [e["pos"] for e in entries],
            "primary_ipa": entries[0]["primary_ipa"] if entries else None,
            "sample_def": entries[0]["senses"][0]["definition"] if entries and entries[0]["senses"] else None,
        }

    # Prefix range search
    prefix_rows = conn.execute(
        "SELECT DISTINCT COALESCE(headword, headword_lower) FROM entries WHERE headword_lower >= 'epistem' AND headword_lower < 'episten' ORDER BY headword_lower ASC LIMIT 10;"
    ).fetchall()
    prefix_words = [r[0] for r in prefix_rows]
    prefix_ok = len(prefix_words) > 0 and "epistemology" in [w.lower() for w in prefix_words]
    if not prefix_ok:
        all_passed = False
    report["prefix_search_test"] = {"prefix": "epistem*", "sample_words": prefix_words, "pass": prefix_ok}

    # Case-insensitivity
    case_res = {}
    for mc in ["EPISTEMOLOGY", "pHotoSynthesis", "SeReNdIpItY", "UBIQUITOUS"]:
        r = conn.execute("SELECT COALESCE(headword, headword_lower) FROM entries WHERE headword_lower = ? LIMIT 1;", (mc.lower(),)).fetchone()
        ok = bool(r)
        if not ok:
            all_passed = False
        case_res[mc] = {"matched": r[0] if r else None, "pass": ok}
    report["case_insensitivity_test"] = case_res

    # Multi-POS
    mp_res = {}
    for w in ["run", "light"]:
        entries = fetch_entries_by_headword(conn, schema_ver, w)
        poses = [e["pos"] for e in entries]
        ok = len(set(poses)) >= 2
        if not ok:
            all_passed = False
        mp_res[w] = {"parts_of_speech": poses, "pass": ok}
    report["multi_pos_test"] = mp_res

    # Missing word
    miss = conn.execute("SELECT id FROM entries WHERE headword_lower = 'xyznonexistentlexicaword999';").fetchall()
    miss_ok = len(miss) == 0
    if not miss_ok:
        all_passed = False
    report["missing_word_test"] = {"results_count": len(miss), "pass": miss_ok}

    # Pagination
    p1 = [r[0] for r in conn.execute("SELECT id FROM entries ORDER BY id ASC LIMIT 5 OFFSET 0;").fetchall()]
    p2 = [r[0] for r in conn.execute("SELECT id FROM entries ORDER BY id ASC LIMIT 5 OFFSET 5;").fetchall()]
    pag_ok = len(p1) == 5 and len(p2) == 5 and len(set(p1) & set(p2)) == 0
    if not pag_ok:
        all_passed = False
    report["pagination_test"] = {"page1_ids": p1, "page2_ids": p2, "pass": pag_ok}

    # FTS5
    if schema_ver >= 2:
        fts_rows = conn.execute(
            """SELECT e.id, COALESCE(e.headword, e.headword_lower), p.name
               FROM entries_fts f
               JOIN entries e ON e.id = f.rowid
               JOIN parts_of_speech p ON p.id = e.pos_id
               WHERE entries_fts MATCH '"knowledge"* AND "branch"*'
               ORDER BY bm25(entries_fts) ASC
               LIMIT 5;"""
        ).fetchall()
    else:
        fts_rows = conn.execute(
            """SELECT entry_id, headword, part_of_speech
               FROM entries_fts
               WHERE entries_fts MATCH 'knowledge AND branch'
               LIMIT 5;"""
        ).fetchall()
    fts_ok = len(fts_rows) > 0
    if not fts_ok:
        all_passed = False
    report["fts5_search_test"] = {
        "count_returned": len(fts_rows),
        "sample_hits": [{"entry_id": r[0], "headword": r[1], "pos": r[2]} for r in fts_rows],
        "pass": fts_ok,
    }

    # Reopen
    conn.close()
    conn_ro = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    reopen_row = conn_ro.execute("SELECT COALESCE(headword, headword_lower) FROM entries WHERE headword_lower = 'serendipity';").fetchone()
    reopen_ok = bool(reopen_row and reopen_row[0].lower() == "serendipity")
    if not reopen_ok:
        all_passed = False
    report["reopen_test"] = {"result": reopen_row[0] if reopen_row else None, "pass": reopen_ok}

    # Latency benchmark
    words = ["dictionary", "run", "water", "light", "house", "peace", "epistemology", "photosynthesis"]
    lats = []
    for i in range(1000):
        w = words[i % len(words)]
        t0 = time.perf_counter()
        conn_ro.execute("SELECT id, primary_ipa FROM entries WHERE headword_lower = ?;", (w,)).fetchall()
        lats.append((time.perf_counter() - t0) * 1000.0)
    conn_ro.close()

    report["performance"] = {
        "queries_executed": len(lats),
        "avg_latency_ms": round(sum(lats) / len(lats), 3),
        "p95_latency_ms": round(sorted(lats)[int(len(lats) * 0.95)], 3),
        "process_memory_before_mb": mem_before,
        "process_memory_after_mb": get_process_memory_mb(),
    }
    report["all_passed"] = all_passed
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify Lexica English SQLite Database")
    parser.add_argument("--db", default="packs/lexica_english.db", help="Path to SQLite DB")
    args = parser.parse_args()
    res = run_comprehensive_verification(args.db)
    print(json.dumps(res, indent=2))
    if not res.get("all_passed"):
        sys.exit(1)
