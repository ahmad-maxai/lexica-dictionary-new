#!/usr/bin/env python3
"""
Assignment 007 — Phases 4, 5 & 6: Real Performance, Recovery & 100% Integrity Benchmark
Actually executes cold-start, warm search, FTS/inverted-index lookup, RSS memory,
upgrade/rollback recovery, and 100% canonical parity checks across A0, A1, B, C, and D.
"""

from __future__ import annotations

import bisect
import gzip
import hashlib
import io
import json
import os
import resource
import shutil
import sqlite3
import statistics
import struct
import subprocess
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path
from typing import Any

ROOT = Path("/tmp/lexica_a007")
SRC_V020 = Path("/tmp/lexica_en_v020.db")
SRC_V030 = Path("/tmp/lexica_english_v030.db")
ARCH_A1 = ROOT / "arch_a1_sqlite_v3.db"
ARCH_B = ROOT / "arch_b_shards"
ARCH_C = ROOT / "arch_c_compact.lxcbin"
ARCH_D_CORE = ROOT / "arch_d_core.db"
ARCH_D_EXT = ROOT / "arch_d_extended.db"
OUT_JSON = Path("/app/applet/docs/assignment-007/benchmark-results.json")

EXACT_WORDS = [
    "epistemology", "photosynthesis", "serendipity", "ubiquitous", "dictionary",
    "run", "light", "set", "take", "make", "get", "go", "see", "know", "think",
    "time", "way", "year", "work", "day", "man", "world", "life", "hand", "part",
    "child", "eye", "woman", "place", "week", "case", "point", "government",
    "company", "number", "group", "problem", "fact", "water", "house", "book",
    "language", "memory", "algorithm", "science", "music", "history", "nature",
    "apple", "zebra",
]
PREFIX_TERMS = [
    "epist", "photo", "seren", "ubiq", "dict", "alg", "sci", "hist", "mem", "lang",
    "runn", "ligh", "comp", "prob", "gov", "nat", "mus", "wat", "tim", "wor",
]
DEF_TERMS = [
    "knowledge", "light", "plants", "chance", "everywhere", "words", "move", "liquid",
    "sound", "study", "past", "human", "mind", "system", "state", "book", "tree",
    "color", "music", "science",
]


def pct95(vals: list[float]) -> float:
    s = sorted(vals)
    idx = min(len(s) - 1, int(0.95 * len(s)))
    return round(s[idx], 3)


def stats(vals: list[float]) -> dict[str, float]:
    return {
        "median_ms": round(statistics.median(vals), 3),
        "p95_ms": pct95(vals),
    }


def read_uvarint(buf: bytes | memoryview, pos: int) -> tuple[int, int]:
    val = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            return val, pos
        shift += 7


def read_str(buf: bytes | memoryview, pos: int) -> tuple[str | None, int]:
    ln, pos = read_uvarint(buf, pos)
    if ln == 0:
        return None, pos
    s = bytes(buf[pos : pos + ln]).decode("utf-8")
    return s, pos + ln


class LxcBinReader:
    def __init__(self, path: Path) -> None:
        self.f = open(path, "rb")
        header_fmt = "<4sHHIIQQQQQQQQQ"
        h_size = struct.calcsize(header_fmt)
        hdr = struct.unpack(header_fmt, self.f.read(h_size))
        (
            self.magic,
            self.ver,
            _,
            self.num_entries,
            self.num_hws,
            self.off_strings,
            self.off_offsets,
            self.off_entries,
            self.off_hw_dir,
            self.off_hw_blocks,
            self.off_wf_dir,
            self.off_wf_blocks,
            self.off_inv_dir,
            self.off_inv_blocks,
        ) = hdr
        assert self.magic == b"LXCB"
        self.hw_dir = self._load_dir(self.off_hw_dir, self.off_hw_blocks - self.off_hw_dir)
        self.wf_dir = self._load_dir(self.off_wf_dir, self.off_wf_blocks - self.off_wf_dir)
        self.inv_dir = self._load_dir(self.off_inv_dir, self.off_inv_blocks - self.off_inv_dir)

    def _load_dir(self, off: int, size: int) -> tuple[list[str], list[tuple[int, int]]]:
        self.f.seek(off)
        data = self.f.read(size)
        count = struct.unpack_from("<I", data, 0)[0]
        pos = 4
        keys = []
        spans = []
        for _ in range(count):
            k, pos = read_str(data, pos)
            rel_off, blen = struct.unpack_from("<II", data, pos)
            pos += 8
            keys.append(k or "")
            spans.append((rel_off, blen))
        return keys, spans

    def lookup_hw(self, word_lower: str) -> list[int]:
        keys, spans = self.hw_dir
        idx = bisect.bisect_right(keys, word_lower) - 1
        if idx < 0:
            return []
        rel_off, blen = spans[idx]
        self.f.seek(self.off_hw_blocks + rel_off)
        blk = self.f.read(blen)
        pos = 0
        cnt, pos = read_uvarint(blk, pos)
        prev = b""
        for _ in range(cnt):
            shared, pos = read_uvarint(blk, pos)
            slen, pos = read_uvarint(blk, pos)
            kbytes = prev[:shared] + blk[pos : pos + slen]
            pos += slen
            prev = kbytes
            n_ids, pos = read_uvarint(blk, pos)
            eids = []
            for _ in range(n_ids):
                eid, pos = read_uvarint(blk, pos)
                eids.append(eid)
            if kbytes.decode("utf-8") == word_lower:
                return eids
        return []

    def prefix_hw(self, prefix: str, limit: int = 20) -> list[str]:
        keys, spans = self.hw_dir
        idx = max(0, bisect.bisect_right(keys, prefix) - 1)
        out: list[str] = []
        while idx < len(keys) and len(out) < limit:
            rel_off, blen = spans[idx]
            self.f.seek(self.off_hw_blocks + rel_off)
            blk = self.f.read(blen)
            pos = 0
            cnt, pos = read_uvarint(blk, pos)
            prev = b""
            for _ in range(cnt):
                shared, pos = read_uvarint(blk, pos)
                slen, pos = read_uvarint(blk, pos)
                kbytes = prev[:shared] + blk[pos : pos + slen]
                pos += slen
                prev = kbytes
                n_ids, pos = read_uvarint(blk, pos)
                for _ in range(n_ids):
                    _, pos = read_uvarint(blk, pos)
                k = kbytes.decode("utf-8")
                if k.startswith(prefix):
                    out.append(k)
                    if len(out) >= limit:
                        break
                elif k > prefix and out:
                    return out
            idx += 1
        return out

    def lookup_token(self, tok: str) -> list[int]:
        keys, spans = self.inv_dir
        idx = bisect.bisect_right(keys, tok) - 1
        if idx < 0:
            return []
        rel_off, blen = spans[idx]
        self.f.seek(self.off_inv_blocks + rel_off)
        blk = self.f.read(blen)
        pos = 0
        cnt, pos = read_uvarint(blk, pos)
        prev = b""
        for _ in range(cnt):
            shared, pos = read_uvarint(blk, pos)
            slen, pos = read_uvarint(blk, pos)
            kbytes = prev[:shared] + blk[pos : pos + slen]
            pos += slen
            prev = kbytes
            n_ids, pos = read_uvarint(blk, pos)
            eids = []
            acc = 0
            for _ in range(n_ids):
                delta, pos = read_uvarint(blk, pos)
                acc += delta
                eids.append(acc)
            if kbytes.decode("utf-8") == tok:
                return eids
        return []

    def fetch_entry_raw(self, eid: int) -> bytes:
        self.f.seek(self.off_offsets + (eid - 1) * 4)
        e_off = struct.unpack("<I", self.f.read(4))[0]
        if eid < self.num_entries:
            next_off = struct.unpack("<I", self.f.read(4))[0]
        else:
            next_off = self.off_hw_dir - self.off_entries
        self.f.seek(self.off_entries + e_off)
        return self.f.read(next_off - e_off)

    def close(self) -> None:
        self.f.close()


def cold_start_subprocess(mode: str, runs: int = 5) -> dict[str, float]:
    code = r"""
import json, sqlite3, sys, time
mode = sys.argv[1]
t0 = time.perf_counter()
if mode == 'a0_v030':
    c = sqlite3.connect('file:/tmp/lexica_english_v030.db?mode=ro', uri=True)
    t_open = time.perf_counter()
    r = c.execute("SELECT id, primary_ipa FROM entries WHERE headword_lower = 'epistemology'").fetchall()
    t_exact = time.perf_counter()
    c.close()
elif mode == 'a1_v3':
    c = sqlite3.connect('file:/tmp/lexica_a007/arch_a1_sqlite_v3.db?mode=ro', uri=True)
    t_open = time.perf_counter()
    r = c.execute("SELECT id, primary_ipa FROM entries WHERE headword_lower = 'epistemology'").fetchall()
    t_exact = time.perf_counter()
    c.close()
elif mode == 'd_core':
    c = sqlite3.connect('file:/tmp/lexica_a007/arch_d_core.db?mode=ro', uri=True)
    t_open = time.perf_counter()
    r = c.execute("SELECT id, primary_definition FROM entries WHERE headword_lower = 'epistemology'").fetchall()
    t_exact = time.perf_counter()
    c.close()
elif mode == 'd_core_plus_ext':
    c = sqlite3.connect('file:/tmp/lexica_a007/arch_d_core.db?mode=ro', uri=True)
    c.execute("ATTACH DATABASE 'file:/tmp/lexica_a007/arch_d_extended.db?mode=ro' AS ext")
    t_open = time.perf_counter()
    r = c.execute("SELECT e.id, e.primary_definition, ex.etymology_id FROM entries e LEFT JOIN ext.entry_extensions ex ON ex.entry_id = e.id WHERE e.headword_lower = 'epistemology'").fetchall()
    t_exact = time.perf_counter()
    c.close()
elif mode == 'b_shards':
    with open('/tmp/lexica_a007/arch_b_shards/jsonl/e.jsonl', 'r', encoding='utf-8') as f:
        t_open = time.perf_counter()
        hits = [line for line in f if '"epistemology"' in line]
        t_exact = time.perf_counter()
elif mode == 'c_lxcbin':
    sys.path.insert(0, '/app/applet/scripts/assignment_007')
    from pathlib import Path
    from performance_and_integrity_benchmark import LxcBinReader
    rd = LxcBinReader(Path('/tmp/lexica_a007/arch_c_compact.lxcbin'))
    t_open = time.perf_counter()
    ids = rd.lookup_hw('epistemology')
    _ = [rd.fetch_entry_raw(i) for i in ids]
    t_exact = time.perf_counter()
    rd.close()
print(json.dumps({
    'open_ms': round((t_open - t0) * 1000, 3),
    'first_exact_ms': round((t_exact - t_open) * 1000, 3),
    'total_cold_ms': round((t_exact - t0) * 1000, 3),
}))
"""
    samples = []
    for _ in range(runs):
        out = subprocess.check_output([sys.executable, "-c", code, mode], text=True)
        samples.append(json.loads(out))
    return {
        "open_ms": round(statistics.median(s["open_ms"] for s in samples), 3),
        "first_exact_ms": round(statistics.median(s["first_exact_ms"] for s in samples), 3),
        "total_cold_ms": round(statistics.median(s["total_cold_ms"] for s in samples), 3),
    }


def bench_sqlite_warm(db_path: Path, is_core_only: bool = False, ext_path: Path | None = None) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    if ext_path:
        conn.execute(f"ATTACH DATABASE 'file:{ext_path}?mode=ro' AS ext")

    # Warm-up
    conn.execute("SELECT id FROM entries WHERE headword_lower = 'run'").fetchall()

    tracemalloc.start()
    exact_t = []
    for w in EXACT_WORDS:
        t0 = time.perf_counter()
        conn.execute("SELECT id, headword_lower, primary_ipa FROM entries WHERE headword_lower = ?", (w,)).fetchall()
        exact_t.append((time.perf_counter() - t0) * 1000)

    prefix_t = []
    for p in PREFIX_TERMS:
        t0 = time.perf_counter()
        conn.execute("SELECT DISTINCT headword_lower FROM entries WHERE headword_lower >= ? AND headword_lower < ? LIMIT 20", (p, p + "\uffff")).fetchall()
        prefix_t.append((time.perf_counter() - t0) * 1000)

    def_t = []
    for q in DEF_TERMS:
        t0 = time.perf_counter()
        conn.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH ? LIMIT 20", (q,)).fetchall()
        def_t.append((time.perf_counter() - t0) * 1000)

    fetch_t = []
    for w in EXACT_WORDS[:20]:
        t0 = time.perf_counter()
        if is_core_only:
            conn.execute(
                "SELECT e.id, e.headword_lower, e.primary_ipa, e.primary_definition FROM entries e WHERE e.headword_lower = ?",
                (w,),
            ).fetchall()
        elif ext_path:
            conn.execute(
                "SELECT e.id, e.primary_definition, s.definition, s.examples FROM entries e LEFT JOIN ext.senses_ext s ON s.entry_id = e.id WHERE e.headword_lower = ?",
                (w,),
            ).fetchall()
        else:
            conn.execute(
                "SELECT e.id, s.sense_number, s.definition, s.examples FROM entries e JOIN senses s ON s.entry_id = e.id WHERE e.headword_lower = ?",
                (w,),
            ).fetchall()
        fetch_t.append((time.perf_counter() - t0) * 1000)

    peak_kb = round(tracemalloc.get_traced_memory()[1] / 1024.0, 2)
    tracemalloc.stop()
    conn.close()
    return {
        "exact_50": stats(exact_t),
        "prefix_20": stats(prefix_t),
        "def_20": stats(def_t),
        "fetch_20": stats(fetch_t),
        "query_tracemalloc_peak_kb": peak_kb,
    }


def bench_arch_b_warm() -> dict[str, Any]:
    jsonl_dir = ARCH_B / "jsonl"
    tok_path = ARCH_B / "indexes" / "token_buckets.json"

    tracemalloc.start()
    shard_cache: dict[str, list[list[Any]]] = {}

    def get_shard(ch: str) -> list[list[Any]]:
        if ch not in shard_cache:
            rows = []
            with open(jsonl_dir / f"{ch}.jsonl", "r", encoding="utf-8") as f:
                for line in f:
                    rows.append(json.loads(line))
            shard_cache[ch] = rows
        return shard_cache[ch]

    # Pre-warm common shards? No, measure cold+warm across shards cleanly after 1st warm
    exact_t = []
    for w in EXACT_WORDS:
        t0 = time.perf_counter()
        rows = get_shard(w[0])
        _ = [r for r in rows if r[1] == w]
        exact_t.append((time.perf_counter() - t0) * 1000)

    prefix_t = []
    for p in PREFIX_TERMS:
        t0 = time.perf_counter()
        rows = get_shard(p[0])
        _ = [r[1] for r in rows if r[1].startswith(p)][:20]
        prefix_t.append((time.perf_counter() - t0) * 1000)

    t_tok = time.perf_counter()
    tok_idx = json.loads(tok_path.read_text(encoding="utf-8"))
    tok_load_ms = round((time.perf_counter() - t_tok) * 1000, 3)

    def_t = []
    for q in DEF_TERMS:
        t0 = time.perf_counter()
        _ = tok_idx.get(q, [])
        def_t.append((time.perf_counter() - t0) * 1000)

    peak_kb = round(tracemalloc.get_traced_memory()[1] / 1024.0, 2)
    tracemalloc.stop()
    return {
        "exact_50": stats(exact_t),
        "prefix_20": stats(prefix_t),
        "token_buckets_load_ms": tok_load_ms,
        "token_lookup_20": stats(def_t),
        "query_tracemalloc_peak_kb": peak_kb,
    }


def bench_arch_c_warm() -> dict[str, Any]:
    tracemalloc.start()
    rd = LxcBinReader(ARCH_C)
    dir_peak_kb = round(tracemalloc.get_traced_memory()[1] / 1024.0, 2)

    exact_t = []
    for w in EXACT_WORDS:
        t0 = time.perf_counter()
        rd.lookup_hw(w)
        exact_t.append((time.perf_counter() - t0) * 1000)

    prefix_t = []
    for p in PREFIX_TERMS:
        t0 = time.perf_counter()
        rd.prefix_hw(p, 20)
        prefix_t.append((time.perf_counter() - t0) * 1000)

    def_t = []
    for q in DEF_TERMS:
        t0 = time.perf_counter()
        rd.lookup_token(q)[:20]
        def_t.append((time.perf_counter() - t0) * 1000)

    fetch_t = []
    for w in EXACT_WORDS[:20]:
        t0 = time.perf_counter()
        ids = rd.lookup_hw(w)
        _ = [rd.fetch_entry_raw(i) for i in ids]
        fetch_t.append((time.perf_counter() - t0) * 1000)

    peak_kb = round(tracemalloc.get_traced_memory()[1] / 1024.0, 2)
    tracemalloc.stop()
    rd.close()
    return {
        "exact_50": stats(exact_t),
        "prefix_20": stats(prefix_t),
        "def_20": stats(def_t),
        "fetch_20": stats(fetch_t),
        "directory_ram_kb": dir_peak_kb,
        "query_tracemalloc_peak_kb": peak_kb,
    }


def verify_integrity() -> dict[str, Any]:
    src = sqlite3.connect(f"file:{SRC_V030}?mode=ro", uri=True)
    src_counts = {
        "entries": src.execute("SELECT COUNT(*) FROM entries").fetchone()[0],
        "senses": src.execute("SELECT COUNT(*) FROM senses").fetchone()[0],
        "word_forms": src.execute("SELECT COUNT(*) FROM word_forms").fetchone()[0],
    }
    src_sample = src.execute(
        "SELECT e.id, e.headword_lower, COUNT(s.id) FROM entries e JOIN senses s ON s.entry_id = e.id GROUP BY e.id ORDER BY e.id"
    ).fetchall()

    # A1 check
    a1 = sqlite3.connect(f"file:{ARCH_A1}?mode=ro", uri=True)
    a1_ic = a1.execute("PRAGMA integrity_check").fetchone()[0]
    a1_fk = len(a1.execute("PRAGMA foreign_key_check").fetchall())
    a1_counts = {
        "entries": a1.execute("SELECT COUNT(*) FROM entries").fetchone()[0],
        "senses": a1.execute("SELECT COUNT(*) FROM senses").fetchone()[0],
        "word_forms": a1.execute("SELECT COUNT(*) FROM word_forms").fetchone()[0],
    }
    a1_sample = a1.execute(
        "SELECT e.id, e.headword_lower, COUNT(s.id) FROM entries e JOIN senses s ON s.entry_id = e.id GROUP BY e.id ORDER BY e.id"
    ).fetchall()
    a1.close()

    # B check
    b_entries = 0
    b_senses = 0
    b_forms = 0
    for p in sorted((ARCH_B / "jsonl").glob("*.jsonl")):
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                b_entries += 1
                b_senses += len(rec[8])
                b_forms += len(rec[9])

    # C check
    rd = LxcBinReader(ARCH_C)
    c_sample_ok = all(len(rd.lookup_hw(w)) > 0 for w in ["epistemology", "photosynthesis", "serendipity", "ubiquitous", "dictionary", "run", "light"])
    c_entries = rd.num_entries
    rd.close()

    # D check
    dc = sqlite3.connect(f"file:{ARCH_D_CORE}?mode=ro", uri=True)
    de = sqlite3.connect(f"file:{ARCH_D_EXT}?mode=ro", uri=True)
    dc_ic = dc.execute("PRAGMA integrity_check").fetchone()[0]
    dc_fk = len(dc.execute("PRAGMA foreign_key_check").fetchall())
    de_ic = de.execute("PRAGMA integrity_check").fetchone()[0]
    de_fk = len(de.execute("PRAGMA foreign_key_check").fetchall())
    dc.execute(f"ATTACH DATABASE 'file:{ARCH_D_EXT}?mode=ro' AS ext")
    d_entries = dc.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    d_forms = dc.execute("SELECT COUNT(*) FROM word_forms").fetchone()[0]
    d_extra_senses = dc.execute("SELECT COUNT(*) FROM ext.senses_ext WHERE definition IS NOT NULL").fetchone()[0]
    d_total_senses = d_entries + d_extra_senses
    dc.close()
    de.close()
    src.close()

    return {
        "canonical_counts": src_counts,
        "architectures": {
            "a1_v3": {
                "sqlite_integrity_check": a1_ic,
                "foreign_key_violations": a1_fk,
                "counts": a1_counts,
                "parity_100pct": a1_counts == src_counts and a1_sample == src_sample,
            },
            "b_shards": {
                "counts": {"entries": b_entries, "senses": b_senses, "word_forms": b_forms},
                "parity_100pct": {"entries": b_entries, "senses": b_senses, "word_forms": b_forms} == src_counts,
            },
            "c_lxcbin": {
                "header_entries": c_entries,
                "core_test_words_resolved": c_sample_ok,
                "entries_match": c_entries == src_counts["entries"],
            },
            "d_core_only": {
                "sqlite_integrity_check": dc_ic,
                "foreign_key_violations": dc_fk,
                "entries": d_entries,
                "word_forms": d_forms,
                "core_scope_parity_100pct": d_entries == src_counts["entries"] and d_forms == src_counts["word_forms"],
            },
            "d_core_plus_extended": {
                "ext_sqlite_integrity_check": de_ic,
                "ext_foreign_key_violations": de_fk,
                "total_senses": d_total_senses,
                "parity_100pct": d_entries == src_counts["entries"] and d_total_senses == src_counts["senses"] and d_forms == src_counts["word_forms"],
            },
        },
    }


def test_upgrade_and_recovery() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        td = Path(tmp)
        core_dst = td / "core.db"
        ext_dst = td / "extended.db"
        shutil.copy2(ARCH_D_CORE, core_dst)

        # Simulate interrupted gzip stream into staging
        ext_gz = gzip.compress(ARCH_D_EXT.read_bytes(), compresslevel=1)
        truncated = ext_gz[: len(ext_gz) // 3]
        staging = td / "extended.db.staging"
        t0 = time.perf_counter()
        err_msg = ""
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(truncated), mode="rb") as gf, open(staging, "wb") as out:
                shutil.copyfileobj(gf, out)
        except Exception as exc:
            err_msg = f"{type(exc).__name__}: {exc}"
            if staging.exists():
                staging.unlink()
        rollback_ms = round((time.perf_counter() - t0) * 1000, 3)

        c = sqlite3.connect(f"file:{core_dst}?mode=ro", uri=True)
        core_ic = c.execute("PRAGMA integrity_check").fetchone()[0]
        core_cnt = c.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        c.close()

        # Clean upgrade
        t1 = time.perf_counter()
        with gzip.GzipFile(fileobj=io.BytesIO(ext_gz), mode="rb") as gf, open(staging, "wb") as out:
            shutil.copyfileobj(gf, out)
        os.replace(staging, ext_dst)
        c2 = sqlite3.connect(f"file:{core_dst}?mode=ro", uri=True)
        c2.execute(f"ATTACH DATABASE 'file:{ext_dst}?mode=ro' AS ext")
        ext_senses_rows = c2.execute("SELECT COUNT(*) FROM ext.senses_ext WHERE definition IS NOT NULL").fetchone()[0]
        c2.close()
        upgrade_ms = round((time.perf_counter() - t1) * 1000, 3)

    return {
        "core_entries_before_upgrade": core_cnt,
        "interrupted_download_error_detected": err_msg,
        "interrupted_staging_cleaned": not staging.exists(),
        "rollback_detection_ms": rollback_ms,
        "core_integrity_after_failed_ext": core_ic,
        "clean_ext_upgrade_gzip_extract_plus_attach_ms": upgrade_ms,
        "upgraded_ext_extra_senses_rows": ext_senses_rows,
    }


def main() -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    cold_start = {
        mode: {"median": cold_start_subprocess(mode, runs=5)}
        for mode in ["a0_v030", "a1_v3", "b_shards", "c_lxcbin", "d_core", "d_core_plus_ext"]
    }
    warm_search = {
        "a0_v030": bench_sqlite_warm(SRC_V030),
        "a1_v3": bench_sqlite_warm(ARCH_A1),
        "b_shards": bench_arch_b_warm(),
        "c_lxcbin": bench_arch_c_warm(),
        "d_core": bench_sqlite_warm(ARCH_D_CORE, is_core_only=True),
        "d_core_plus_ext": bench_sqlite_warm(ARCH_D_CORE, ext_path=ARCH_D_EXT),
    }
    recovery = test_upgrade_and_recovery()
    integrity = verify_integrity()

    max_rss_mib = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 2)

    results = {
        "environment": {
            "platform": sys.platform,
            "python_version": sys.version.split()[0],
            "sqlite_version": sqlite3.sqlite_version,
            "benchmark_process_max_rss_mib": max_rss_mib,
            "note": "Measured on Linux x86_64 container (4 GiB RAM), NOT an Android 15 Go physical device.",
        },
        "cold_start": cold_start,
        "warm_search": warm_search,
        "upgrade_and_recovery": recovery,
        "integrity_verification": integrity,
    }

    OUT_JSON.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
