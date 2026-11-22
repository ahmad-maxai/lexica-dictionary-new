# LEXICA — Assignment 007: Final Architectural Recommendation

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  
**Status:** Research & Benchmark Complete — **No Production Integration Applied**  

---

## 1. Executive Decision

**Adopt Architecture D (Layered Core + Extended SQLite Packs)** as LEXICA's next-generation offline dictionary architecture.

When measured across the exact same 75,000-entry English dataset (`45,317` distinct lowercase headwords, `190,672` senses, `134,837` word forms), **Architecture D** outperforms monolithic SQLite (`A0`/`A1`), sharded JSONL (`B`), and custom binary (`C`) on the constraints that matter most for Android 15 Go (~2.7 GiB RAM) and multilingual scaling:

- **Mandatory Installed Storage Cut by 83.5%:** `105.58 MiB` (`v0.3.0`) -> **`17.39 MiB`** (`arch_d_core.db`), delivering all `75,000` entries, `134,837` word forms, primary IPA, primary Sense #1 definition, and FTS5 prefix/definition search immediately.
- **Mandatory Download Size Cut by 81.8%:** `44.95 MiB` (`v0.3.0` GZIP `-6`) -> **`8.16 MiB` GZIP** (`7.29 MiB` Brotli, `8.11 MiB` Zstd), extracting in **`0.148 s`** (`0.119 s` Zstd) with **`~256 KiB`** streaming peak heap.
- **Fastest Cold & Warm Queries:** `0.971 ms` cold start (`0.201 ms` open + `0.777 ms` exact lookup), `0.068 ms` warm exact median, `0.168 ms` FTS5 median, and only **`15.87 KiB`** Python `tracemalloc` query heap on Linux `x86_64`.
- **Optional Scholarly Enrichment (`85.45 MiB` Extended Pack):** Secondary senses (`115,672` rows), example sentences (`101,240` rows = `50.21 MiB` raw JSON), synonyms/antonyms, etymologies, audio filenames, and full regional IPAs remain cleanly optional via SQLite `ATTACH DATABASE`.
- **Resilient Atomic Upgrades:** Simulated interrupted Extended pack downloads (`EOFError`) are rejected in staging with **`0` impact** to the Core database (`PRAGMA integrity_check = ok`).

---

## 2. Production Implementation Guidelines (For Future Authorized Phase)

1. **Maintain Strict SQLite Schema Discipline:**
   - Use `PRAGMA page_size = 16384`, `WITHOUT ROWID` metadata tables, and `content=''` FTS5 with `detail=none`.
   - **Never** place redundant `UNIQUE` constraints on build-time pre-deduplicated text lookup tables (`+17.14 MiB` `sqlite_autoindex_*` bloat trap).
   - Keep `examples`, `synonyms`, and `antonyms` inside `senses_ext` in the Extended pack rather than splitting into an extra internal side table inside the same DB.
2. **Distribution Format:**
   - Ship **GZIP** (`8.16 MiB` Core) for immediate universal compatibility (`java.util.zip` / Web `DecompressionStream`), or **Brotli (`q=5`)** / **Zstd** where native decompression is available. Avoid LZMA on mobile (`5.5x` slower extraction than Zstd).
3. **Multilingual Packaging Across All 7 Languages:**
   - Generate independent `core_<lang>.db` + `extended_<lang>.db` packs for `en`, `ha`, `yo`, `ff`, `ar`, `fr`, `zh` with normalized lookup columns matching `src/services/textNormalization.ts` and full CC BY-SA 4.0 / CC-CEDICT attribution inside `sources`.
