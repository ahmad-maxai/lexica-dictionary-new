# LEXICA — Assignment 007: Compression & Extraction Benchmark Report

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  
**Benchmark Script:** `scripts/assignment_007/compression_benchmark.py`  
**Machine-Readable Results:** `docs/assignment-007/benchmark-results.json`  

---

## 1. Methodology

Every prototype artifact built from the canonical 75,000-entry English dataset was compressed and decompressed on a Linux `x86_64` container (Python `3.11.2`, Node.js `v22.23.2` `zlib`) using four algorithms:
- **GZIP (`level 6`):** Baseline universal mobile-compatible format (`zlib` / `java.util.zip` / Web `DecompressionStream`).
- **Zstandard (`zstd` default level via Node `zlib`):** Modern fast-extract compression format.
- **Brotli (`quality 5` via Node `zlib`):** High-density web/HTTP & pack compression format.
- **LZMA (`preset 1` on D Core):** Evaluated on `arch_d_core.db` to quantify mobile CPU decompression penalty vs. size savings.

Both **download size** (compressed bytes) and **installed/extracted size** (uncompressed bytes), along with **compression time**, **extraction time**, and **streaming peak heap (`tracemalloc`)** were recorded separately.

---

## 2. Measured Compression & Extraction Results

| Asset / Architecture | Uncompressed Size | GZIP (`-6`) | GZIP Extract | Zstd | Zstd Extract | Brotli (`q=5`) | Brotli Extract |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A0 SQLite v1 (`v0.2.0`)** | `158.23 MiB` (`165,916,672` B) | `55.71 MiB` | `1.293 s` | `52.78 MiB` | `0.648 s` | `46.20 MiB` | `0.989 s` |
| **A0 SQLite v2 (`v0.3.0`)** | `105.58 MiB` (`110,706,688` B) | `44.95 MiB`* | `0.858 s` | `42.56 MiB` | `0.455 s` | `37.72 MiB` | `0.703 s` |
| **A1 SQLite v3 Optimized** | `102.64 MiB` (`107,626,496` B) | `44.33 MiB` | `0.887 s` | `41.92 MiB` | `0.476 s` | `37.23 MiB` | `0.762 s` |
| **B JSONL Shards + Indexes (tar)** | `106.19 MiB` (`111,349,760` B) | `36.26 MiB` | `0.791 s` | `33.87 MiB` | `0.493 s` | `29.30 MiB` | `0.767 s` |
| **C Compact Binary (`.lxcbin`)** | **`87.04 MiB`** (`91,263,167` B) | `37.55 MiB` | `0.761 s` | `35.22 MiB` | `0.404 s` | `30.94 MiB` | `0.646 s` |
| **D Layered Core SQLite** | **`17.39 MiB`** (`18,235,392` B) | **`8.16 MiB`** | **`0.148 s`** | **`8.11 MiB`** | **`0.119 s`** | **`7.29 MiB`** | **`0.151 s`** |
| **D Layered Extended SQLite** | `85.45 MiB` (`89,604,096` B) | `35.84 MiB` | `0.766 s` | `33.36 MiB` | `0.407 s` | `29.35 MiB` | `0.575 s` |
| **D Combined (Core + Extended)** | `102.84 MiB` (`107,839,488` B) | `44.00 MiB` | `0.914 s` | `41.47 MiB` | `0.526 s` | `36.64 MiB` | `0.726 s` |

*\*Note: Official `v0.3.0` release asset `lexica_english.db.gz` (`gzip -9`) is `47,000,179` B (`44.82 MiB`).*

### LZMA Comparison on `arch_d_core.db` (`17.39 MiB`)
- **LZMA (`preset 1`):** `7,074,548` B (**`6.75 MiB`**), compress `3.185 s`, extract **`0.652 s`** — **5.48x slower to extract than Zstd** (`0.119 s`) and **4.41x slower than GZIP** (`0.148 s`) for only `1.41 MiB` extra savings over GZIP.

### Streaming Extraction Peak Memory (`tracemalloc`)
Across all targets, streaming `64 KiB` chunked GZIP extraction used **`233.96 KiB` – `261.27 KiB`** peak Python heap (and `~80 MiB` total process RSS during baseline `v0.3.0` audit), proving zero full-file buffering in RAM is needed during pack installation.

---

## 3. Key Compression Conclusions

1. **Structural Layering Beats Entropy Coding Alone:**  
   Compressing the full 105 MiB English lexicon yields `37–45 MiB` downloads regardless of format because `50.21 MiB` of raw example sentences and `11.04 MiB` of definitions are high-entropy natural prose. By separating **Core** from **Extended** in **Architecture D**, mandatory initial download drops by **82%**: from `44.95 MiB` (`v0.3.0` GZIP) down to **`8.16 MiB` GZIP (`7.29 MiB` Brotli)** — and installed disk usage drops from `105.58 MiB` to **`17.39 MiB`**.
2. **GZIP vs. Zstandard vs. Brotli:**  
   - **GZIP** remains ideal for universal Capacitor/Android `java.util.zip` and browser `DecompressionStream('gzip')` compatibility with zero extra native dependencies (`8.16 MiB` Core, `0.148 s` extract).
   - **Brotli (`q=5`)** saves an additional `10–15%` download size (`7.29 MiB` Core, `36.64 MiB` D Combined) with fast extraction (`0.151 s` Core).
   - **Zstandard** delivers the fastest extraction speeds (`0.119 s` Core, `0.404 s–0.476 s` on full packs — ~2x faster than GZIP), making it ideal if a native Zstd plugin is added later for multi-hundred-thousand-entry packs.
   - **LZMA** is rejected for mobile packs due to high decompression CPU/RAM cost (`5.5x` slower than Zstd).
