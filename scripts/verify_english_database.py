#!/usr/bin/env python3
"""
Lexica English Dictionary Verification Suite
Validates database schema, data integrity, required test vocabulary,
prefix searching, case insensitivity, multi-POS handling, pagination,
re-opening, search latency, and memory consumption.
"""

import argparse
import json
import os
import resource
import sqlite3
import sys
import time
from typing import Dict, List, Any


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
    """Returns current process resident memory (RSS) in megabytes."""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    # ru_maxrss is in kilobytes on Linux
    return round(usage.ru_maxrss / 1024.0, 2)


def test_target_word(conn: sqlite3.Connection, word: str) -> Dict[str, Any]:
    """Retrieves and verifies all entries, senses, forms, and pronunciations for a word."""
    cur = conn.cursor()
    entries_rows = cur.execute(
        """SELECT id, headword, part_of_speech, primary_ipa, all_ipas, audio_file, etymology
           FROM entries
           WHERE headword_lower = ?;""",
        (word.lower(),),
    ).fetchall()

    if not entries_rows:
        return {"word": word, "status": "NOT_FOUND", "entries": []}

    entries_data = []
    for row in entries_rows:
        e_id, headword, pos, ipa, all_ipas, audio, etymology = row

        # Fetch senses
        senses_rows = cur.execute(
            """SELECT sense_number, definition, tags, examples, synonyms, antonyms
               FROM senses
               WHERE entry_id = ?
               ORDER BY sense_number ASC;""",
            (e_id,),
        ).fetchall()

        senses_data = []
        for s in senses_rows:
            s_num, s_def, s_tags, s_ex, s_syn, s_ant = s
            senses_data.append({
                "sense_number": s_num,
                "definition": s_def,
                "tags": json.loads(s_tags) if s_tags else [],
                "examples": json.loads(s_ex) if s_ex else [],
                "synonyms": json.loads(s_syn) if s_syn else [],
                "antonyms": json.loads(s_ant) if s_ant else [],
            })

        # Fetch forms
        forms_rows = cur.execute(
            """SELECT form, tags FROM word_forms WHERE entry_id = ?;""",
            (e_id,),
        ).fetchall()
        forms_data = [{"form": f[0], "tags": json.loads(f[1]) if f[1] else []} for f in forms_rows]

        entries_data.append({
            "entry_id": e_id,
            "headword": headword,
            "part_of_speech": pos,
            "primary_ipa": ipa,
            "all_ipas": json.loads(all_ipas) if all_ipas else [],
            "audio_file": audio,
            "etymology": etymology[:150] + "..." if etymology and len(etymology) > 150 else etymology,
            "senses_count": len(senses_data),
            "senses": senses_data,
            "forms": forms_data,
        })

    return {
        "word": word,
        "status": "FOUND",
        "entries_count": len(entries_data),
        "total_senses": sum(e["senses_count"] for e in entries_data),
        "parts_of_speech": [e["part_of_speech"] for e in entries_data],
        "has_ipa": any(bool(e["primary_ipa"]) for e in entries_data),
        "has_examples": any(any(bool(s["examples"]) for s in e["senses"]) for e in entries_data),
        "entries": entries_data,
    }


def run_comprehensive_verification(db_path: str) -> Dict[str, Any]:
    """Executes the full test suite required by Dev #2 Assignment 002."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found: {db_path}")

    mem_before = get_process_memory_mb()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    report = {
        "database_path": db_path,
        "database_size_bytes": os.path.getsize(db_path),
        "database_size_mb": round(os.path.getsize(db_path) / (1024 * 1024), 2),
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

    # 1. Target Word Verification
    print("\n--- 1. Testing Required Target Words ---")
    all_found = True
    for word in TEST_WORDS:
        res = test_target_word(conn, word)
        report["target_word_tests"][word] = {
            "status": res["status"],
            "entries_count": res.get("entries_count", 0),
            "total_senses": res.get("total_senses", 0),
            "parts_of_speech": res.get("parts_of_speech", []),
            "has_ipa": res.get("has_ipa", False),
            "has_examples": res.get("has_examples", False),
            "sample_def": res["entries"][0]["senses"][0]["definition"] if res.get("entries") and res["entries"][0].get("senses") else None,
        }
        if res["status"] != "FOUND":
            all_found = False
        print(f"  [{res['status']}] '{word}': {res.get('entries_count', 0)} POS entries, {res.get('total_senses', 0)} senses. POS: {res.get('parts_of_speech', [])}")
        if res.get("entries"):
            print(f"      Def: {res['entries'][0]['senses'][0]['definition'][:90]}...")

    # 2. Prefix Search Test
    print("\n--- 2. Testing Prefix Search ('epistem%') ---")
    prefix_results = cur.execute(
        """SELECT DISTINCT headword FROM entries WHERE headword_lower LIKE 'epistem%' ORDER BY headword ASC LIMIT 10;"""
    ).fetchall()
    prefix_words = [r[0] for r in prefix_results]
    report["prefix_search_test"] = {
        "prefix": "epistem%",
        "count_returned": len(prefix_words),
        "sample_words": prefix_words,
        "pass": len(prefix_words) > 0 and "epistemology" in [w.lower() for w in prefix_words],
    }
    print(f"  Prefix results for 'epistem%': {prefix_words}")

    # 3. Case-Insensitive Search Test
    print("\n--- 3. Testing Case-Insensitive Search ---")
    mixed_cases = ["EPISTEMOLOGY", "pHotoSynthesis", "SeReNdIpItY", "UBIQUITOUS"]
    case_test_results = {}
    for mc in mixed_cases:
        row = cur.execute("SELECT headword FROM entries WHERE headword_lower = ?;", (mc.lower(),)).fetchone()
        case_test_results[mc] = {
            "matched_headword": row[0] if row else None,
            "pass": bool(row),
        }
        print(f"  Query: '{mc}' -> Matched: {row[0] if row else 'NONE'}")
    report["case_insensitivity_test"] = case_test_results

    # 4. Multi-POS Handling Test
    print("\n--- 4. Testing Multi-POS Handling ('run' & 'light') ---")
    multi_pos_results = {}
    for mp_word in ["run", "light"]:
        poses = [r[0] for r in cur.execute("SELECT part_of_speech FROM entries WHERE headword_lower = ?;", (mp_word,)).fetchall()]
        multi_pos_results[mp_word] = {
            "parts_of_speech_found": poses,
            "distinct_pos_count": len(set(poses)),
            "pass": len(set(poses)) >= 2,
        }
        print(f"  Word: '{mp_word}' -> Distinct POS entries: {poses}")
    report["multi_pos_test"] = multi_pos_results

    # 5. Missing Word Test
    print("\n--- 5. Testing Missing Word Search ---")
    non_word = "xyznonexistentlexicaword999"
    missing_res = cur.execute("SELECT headword FROM entries WHERE headword_lower = ?;", (non_word,)).fetchall()
    report["missing_word_test"] = {
        "query": non_word,
        "results_count": len(missing_res),
        "pass": len(missing_res) == 0,
    }
    print(f"  Query: '{non_word}' -> Results: {len(missing_res)} (Expected: 0)")

    # 6. Pagination Test
    print("\n--- 6. Testing Pagination ---")
    page1 = cur.execute("SELECT id, headword FROM entries ORDER BY id ASC LIMIT 5 OFFSET 0;").fetchall()
    page2 = cur.execute("SELECT id, headword FROM entries ORDER BY id ASC LIMIT 5 OFFSET 5;").fetchall()
    page1_ids = [r[0] for r in page1]
    page2_ids = [r[0] for r in page2]
    is_disjoint = len(set(page1_ids).intersection(set(page2_ids))) == 0
    report["pagination_test"] = {
        "page1_ids": page1_ids,
        "page2_ids": page2_ids,
        "disjoint": is_disjoint,
        "pass": is_disjoint and len(page1) == 5 and len(page2) == 5,
    }
    print(f"  Page 1 IDs: {page1_ids} -> Words: {[r[1] for r in page1]}")
    print(f"  Page 2 IDs: {page2_ids} -> Words: {[r[1] for r in page2]}")
    print(f"  Disjoint pages: {is_disjoint}")

    # 7. FTS5 Search Test
    print("\n--- 7. Testing FTS5 Full-Text Search ---")
    fts_results = cur.execute(
        """SELECT entry_id, headword, part_of_speech, snippet(entries_fts, 4, '<b>', '</b>', '...', 12)
           FROM entries_fts
           WHERE entries_fts MATCH 'knowledge AND branch'
           LIMIT 5;"""
    ).fetchall()
    report["fts5_search_test"] = {
        "query": "knowledge AND branch",
        "count_returned": len(fts_results),
        "sample_hits": [{"entry_id": r[0], "headword": r[1], "pos": r[2], "snippet": r[3]} for r in fts_results],
        "pass": len(fts_results) > 0,
    }
    print(f"  FTS5 match 'knowledge AND branch': {len(fts_results)} hits")
    for r in fts_results[:3]:
        print(f"    Hit: {r[1]} ({r[2]}) -> {r[3]}")

    # 8. Re-open Database Test
    print("\n--- 8. Testing Database Close & Re-open ---")
    conn.close()
    # Re-open in read-only URI mode
    conn_ro = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    cur_ro = conn_ro.cursor()
    reopen_row = cur_ro.execute("SELECT headword FROM entries WHERE headword_lower = 'serendipity';").fetchone()
    report["reopen_test"] = {
        "reopened_mode": "read_only_uri",
        "queried_word": "serendipity",
        "result": reopen_row[0] if reopen_row else None,
        "pass": bool(reopen_row and reopen_row[0].lower() == "serendipity"),
    }
    print(f"  Re-opened DB in read-only mode -> Queried 'serendipity': {reopen_row[0] if reopen_row else 'FAILED'}")

    # 9. Latency & Performance Benchmark
    print("\n--- 9. Measuring Search Latency over 1,000 Queries ---")
    benchmark_words = ["dictionary", "run", "water", "light", "house", "peace", "epistemology", "photosynthesis"]
    latencies_ms = []
    for i in range(1000):
        target = benchmark_words[i % len(benchmark_words)]
        t0 = time.perf_counter()
        cur_ro.execute("SELECT id, headword, primary_ipa FROM entries WHERE headword_lower = ?;", (target,)).fetchall()
        t1 = time.perf_counter()
        latencies_ms.append((t1 - t0) * 1000.0)

    avg_latency = round(sum(latencies_ms) / len(latencies_ms), 3)
    p95_latency = round(sorted(latencies_ms)[int(len(latencies_ms) * 0.95)], 3)
    p99_latency = round(sorted(latencies_ms)[int(len(latencies_ms) * 0.99)], 3)
    conn_ro.close()

    mem_after = get_process_memory_mb()

    report["performance"] = {
        "queries_executed": len(latencies_ms),
        "avg_latency_ms": avg_latency,
        "p95_latency_ms": p95_latency,
        "p99_latency_ms": p99_latency,
        "process_memory_before_mb": mem_before,
        "process_memory_after_mb": mem_after,
        "memory_delta_mb": round(mem_after - mem_before, 2),
    }

    print(f"  Average query latency: {avg_latency} ms (P95: {p95_latency} ms, P99: {p99_latency} ms)")
    print(f"  Memory: Before={mem_before} MB, After={mem_after} MB (Delta: {report['performance']['memory_delta_mb']} MB)")

    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify Lexica English SQLite Database")
    parser.add_argument("--db", default="packs/lexica_english.db", help="Path to SQLite database")
    args = parser.parse_args()

    results = run_comprehensive_verification(args.db)
    print("\n=== COMPREHENSIVE VERIFICATION REPORT ===")
    print(json.dumps(results, indent=2))
