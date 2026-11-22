# LEXICA — Assignment 007: Performance, Memory & Integrity Benchmark Report

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  
**Machine-Readable Results:** `docs/assignment-007/benchmark-results.json`  
**Benchmark Script:** `scripts/assignment_007/performance_and_integrity_benchmark.py`  

---

## 1. Test Environment & Honesty Statement

All timing and memory measurements were executed on a **Linux `x86_64` container** (Python `3.11.2`, SQLite `3.40.1`, Node.js `v22.23.2`, `4 GiB` container RAM) on warm OS page cache across 5 cold-start subprocess invocations and 50/20-query warm loops.

> **Important:** These timings are desktop/container measurements, **not** measurements on a physical Android 15 Go handset (~2.7 GiB total RAM, eMMC flash storage, ARM Cortex-A53/A55 CPU). Relative architectural ratios (e.g., cold-open overhead, heap allocation explosion in JSON parsing vs SQLite B-tree cursor lookups) transfer directly, while absolute latencies on eMMC Android Go hardware will scale higher proportionally to I/O seek latency.

Test workloads:
- **Cold Start:** Fresh Python subprocess opening the store and executing the first exact lookup (`epistemology`).
- **Warm Exact (50 terms):** 50 headwords including `epistemology`, `photosynthesis`, `serendipity`, `ubiquitous`, `dictionary`, `run`, `light`, etc.
- **Warm Prefix (20 prefixes):** Range/prefix queries returning up to 20 headwords (`epist`, `photo`, `seren`, `ubiq`, `dict`, etc.).
- **Warm Definition / Full-Text Search (20 queries):** FTS5 `MATCH` (Architectures A0, A1, D) or inverted-index/bucket lookup (Architectures B, C).
- **Warm Full Entry Fetch (20 terms):** Retrieving senses, definitions, and examples.

---

## 2. Cold-Start Latency (Fresh Subprocess, Median of 5 Runs)

| Architecture | Open / Init (ms) | First Exact Lookup (ms) | Total Cold Start (ms) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **A0 (`v0.3.0` SQLite v2)** | `0.173` | `0.908` | `1.069` | Single SQLite file |
| **A1 (`v0.3` SQLite v3)** | `0.195` | `0.743` | `0.986` | `detail=none` FTS5 |
| **B (27 JSONL Shards)** | `0.070` | `24.680` | `24.750` | Must scan/parse entire `e.jsonl` shard |
| **C (`.lxcbin` Binary)** | `57.702` | `0.148` | `57.851` | Unpacks 3 front-coded directory indexes in Python on open |
| **D (Core SQLite Only)** | `0.201` | `0.777` | **`0.971`** | Fastest cold-start SQLite path (`17.39 MiB` DB) |
| **D (Core + Extended `ATTACH`)** | `1.280` | `0.323` | `1.593` | Opens Core and attaches Extended DB |

---

## 3. Warm Search Latency & Heap Allocation

| Architecture | Exact (50) Median / p95 | Prefix (20) Median / p95 | Full-Text / Def (20) Median / p95 | Fetch (20) Median / p95 | Python `tracemalloc` Peak |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A0 (`v0.3.0` SQLite v2)** | `0.121` / `0.248` ms | `0.077` / `0.144` ms | `0.262` / `1.200` ms | `0.532` / `1.806` ms | `130.32 KiB` |
| **A1 (`v0.3` SQLite v3)** | `0.076` / `0.142` ms | `0.071` / `0.108` ms | `0.146` / `0.418` ms | `0.468` / `5.998` ms | `120.18 KiB` |
| **B (JSONL Shards)** | `1.023` / `911.601` ms | `1.741` / `3.926` ms | `0.002` / `0.009` ms *(bucket)* | — *(see note)* | **`367,069.99 KiB` (`358.47 MiB`)** |
| **C (`.lxcbin` Binary)** | `0.291` / `0.561` ms | `0.593` / `0.854` ms | `3.737` / `11.391` ms | `0.423` / `0.794` ms | `836.38 KiB` (`dir: 762.35 KiB`) |
| **D (Core Only)** | `0.068` / `0.104` ms | `0.080` / `0.118` ms | `0.168` / `0.521` ms | **`0.116` / `0.194` ms** | **`15.87 KiB`** |
| **D (Core + Extended)** | `0.066` / `0.111` ms | `0.072` / `0.104` ms | **`0.117` / `0.380` ms** | `0.503` / `1.693` ms | `139.24 KiB` |

*Architecture B note:* Loading `token_buckets.json` took `275.921 ms`, and first-access JSON parsing across letter shards caused a **`911.601 ms` p95 spike** and **`358.47 MiB` Python heap peak**, confirming JSON shard parsing is unsuitable for low-RAM Android Go devices.

---

## 4. Upgrade, Interrupted Download & Rollback Verification

Simulated on Architecture D (`test_upgrade_and_recovery()`):
- **Core state before upgrade:** `75,000` entries intact.
- **Interrupted Extended Pack simulation:** Truncated GZIP stream (1/3 length) detected via `EOFError: Compressed file ended before the end-of-stream marker was reached` in `248.64 ms`.
- **Atomic staging cleanup:** `.staging` file automatically removed; Core database verified via `PRAGMA integrity_check = ok`.
- **Clean Extended Pack upgrade:** Streaming GZIP extract + atomic `os.replace` + `ATTACH DATABASE` completed in `869.29 ms`, exposing all `115,672` secondary senses seamlessly.

---

## 5. 100% Content Integrity Verification

Verified against canonical `v0.3.0` (`75,000` entries, `190,672` senses, `134,837` word forms):

- **Architecture A1:** `PRAGMA integrity_check = ok`, `0` foreign-key violations, `100%` row-by-row parity (`75,000` / `190,672` / `134,837`).
- **Architecture B:** `75,000` entries, `190,672` senses, `134,837` word forms (`100%` parity across all 27 JSONL shards).
- **Architecture C:** `75,000` header entries; all 7 canonical verification test words (`epistemology`, `photosynthesis`, `serendipity`, `ubiquitous`, `dictionary`, `run`, `light`) resolved cleanly via binary front-coded lookup.
- **Architecture D (Core Only):** `PRAGMA integrity_check = ok`, `0` foreign-key violations, `75,000` entries, `134,837` word forms (`100%` core-scope parity).
- **Architecture D (Core + Extended):** `PRAGMA integrity_check = ok`, `0` foreign-key violations, `75,000` primary + `115,672` secondary = `190,672` total senses (`100%` full parity).
