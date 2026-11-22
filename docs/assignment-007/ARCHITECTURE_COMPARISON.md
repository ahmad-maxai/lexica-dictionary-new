# LEXICA — Assignment 007: Architecture Comparison & Prototype Evaluation

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  
**Prototype Generator:** `scripts/assignment_007/build_prototypes.py`  

---

## 1. Evaluated Architectures

All four prototypes were compiled from the identical canonical 75,000-entry English dataset (`45,317` distinct lowercase headwords / `47,728` exact-case headwords, `190,672` senses, `134,837` word forms):

1. **Architecture A (`A0` `v0.3.0` SQLite v2 vs `A1` Optimized SQLite v3):**  
   Single-file SQLite (`PRAGMA page_size = 16384`, `WITHOUT ROWID` metadata, normalized lookup tables without redundant `UNIQUE` autoindexes, `content=''` FTS5 with `detail=none`, `ANALYZE`, `VACUUM`).
2. **Architecture B (`arch_b_shards` — 27 Initial-Letter JSON/JSONL Shards):**  
   Letter-bucketed JSONL & compact JSON (`a..z` + `_other`, `128` to `7,509` entries per shard) plus 27 sharded `word_forms` JSON maps and `token_buckets.json`.
3. **Architecture C (`arch_c_compact.lxcbin` — Custom Compact Binary `LXCB v1`):**  
   Five interned string pools (`pos`, `tags`, `pronunciations`, `audio`, `etymologies`), ULEB128 varints, `32`-bit entry offset table, sorted front-coded blocks for headwords (`block=32`) and word forms (`block=64`), and delta-varint inverted token postings (`block=64`). Compact index directory on disk = `70,889` bytes (`69.23 KiB`).
4. **Architecture D (`arch_d_core.db` + `arch_d_extended.db` — Layered SQLite Packs):**  
   - **Core Pack (`17.39 MiB`):** All `75,000` entries, `45,317` lowercase headwords, `pos_id`, `primary_ipa`, Sense #1 `primary_definition`, `extra_senses_count`, `134,837` `word_forms`, and `detail=none` FTS5 prefix/definition search.
   - **Extended Pack (`85.45 MiB`):** `115,672` secondary senses, `101,240` examples, synonyms/antonyms, full `all_ipas`, audio filenames, etymologies, and tag sets — joined on demand via SQLite `ATTACH DATABASE`.

---

## 2. Quantitative Comparison Table (All Measurements Verified)

| Architecture | Installed Size | GZIP (`-6`) | Brotli (`q=5`) | Build Time | Cold Start (Median) | Warm Exact (Median) | Warm Heap Peak (`tracemalloc`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A0 (`v0.2.0` SQLite v1)** | `158.23 MiB` | `55.71 MiB` | `46.20 MiB` | — | — | — | — |
| **A0 (`v0.3.0` SQLite v2)** | `105.58 MiB` | `44.95 MiB`* | `37.72 MiB` | — | `1.069 ms` | `0.121 ms` | `130.32 KiB` |
| **A1 (SQLite v3 Optimized)** | `102.64 MiB` | `44.33 MiB` | `37.23 MiB` | `5.984 s` | `0.986 ms` | `0.076 ms` | `120.18 KiB` |
| **B (JSONL Shards + Indexes)** | `106.09 MiB` | `36.26 MiB` | `29.30 MiB` | `17.731 s` | `24.750 ms` | `1.023 ms` (`p95: 911.6 ms`) | **`367,069.99 KiB` (`358.47 MiB`)** |
| **C (Custom Binary `.lxcbin`)** | **`87.04 MiB`** | `37.55 MiB` | `30.94 MiB` | `13.533 s` | `57.851 ms` | `0.291 ms` | `836.38 KiB` (`dir: 762.35 KiB`) |
| **D (Layered Core Only)** | **`17.39 MiB`** | **`8.16 MiB`** | **`7.29 MiB`** | < `4 s` | **`0.971 ms`** | **`0.068 ms`** | **`15.87 KiB`** |
| **D (Layered Extended)** | `85.45 MiB` | `35.84 MiB` | `29.35 MiB` | — | — | — | — |
| **D (Core + Ext Combined)** | `102.84 MiB` | `44.00 MiB` | `36.64 MiB` | `11.273 s` | `1.593 ms` | **`0.066 ms`** | `139.24 KiB` |

*\*Official `v0.3.0` release `gzip -9` asset = `44.82 MiB` (`47,000,179` B).*

---

## 3. Scaling Projection: Hundreds of Thousands / Millions of Entries

| Scale | A1 Monolithic SQLite (Est.) | D Core Pack Only (Est.) | Feasibility on 2.7 GiB Android 15 Go |
| :--- | :--- | :--- | :--- |
| **75k entries (`en` baseline)** | `102.6 MiB` (`44.3 MiB` gz) | **`17.4 MiB`** (`8.2 MiB` gz) | Instant install & sub-ms search on Core |
| **500k entries (~6.7x)** | `~684 MiB` (`~295 MiB` gz) | **`~116 MiB`** (`~54 MiB` gz) | Monolithic pack risks storage exhaustion; Core remains lightweight |
| **1M+ entries (~13.3x)** | `~1.37 GiB` (`~591 MiB` gz) | **`~232 MiB`** (`~109 MiB` gz) | Only layered packs (or Core + regional/topic Extended shards) remain viable on entry-level flash |

---

## 4. Architectural Verdict

- **Architecture B (JSONL Shards):** Disqualified — `358.47 MiB` heap spike during parsing, `911.6 ms` p95 first-shard latency, and poor multilingual bucketing (`ar`/`zh`/`ff` collapse into `_other`).
- **Architecture C (`.lxcbin`):** Smallest monolithic single-file size (`87.04 MiB` installed, `-17.6%` vs `v0.3.0`), but lacks SQL/FTS5 expressiveness, has `57.7 ms` directory unpack in interpreted runtimes, and does not solve the optional-content problem.
- **Architecture D (Layered Core + Extended SQLite):** Best overall architecture — reduces mandatory installed storage by **83.5%** (`105.58 MiB` -> **`17.39 MiB`**) and download size by **81.8%** (`44.95 MiB` -> **`8.16 MiB` GZIP**), achieves the fastest cold start (`0.971 ms`) and lowest query heap (`15.87 KiB`), works natively with Capacitor SQLite `ATTACH DATABASE`, and isolates corrupted Extended upgrades cleanly from the working Core dictionary.
