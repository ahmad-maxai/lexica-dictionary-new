# LEXICA Assignment 009 — Hausa Dictionary Core Pack (Architecture D)

**Branch:** `feature/assignment-009-hausa-core-pack`  
**Release Tag:** `prototype-ha-core-v0.4.0`  
**Architecture:** Layered Core + Optional Extended Companion SQLite Packs (reused directly from Assignment 008)

---

## 1. Verified Dataset & Audit Measurements

All entries are extracted directly from the Kaikki.org Hausa Wiktionary dump (`kaikki.org-dictionary-Hausa.jsonl.gz`) merged with verified Hausa entries from Lexica's curated offline seed corpus (`src/data/seedDictionary.ts` and `src/data/dictionaryData.ts`). No entries or linguistic fields were fabricated.

| Metric | Measured Value |
| :--- | ---: |
| **Total Accepted Entries** | **2,260** |
| **Distinct Headwords** | **2,013** |
| **Entries with Valid Primary Definitions** | **2,260 (100.00%, 0 missing)** |
| **Total Senses (Core + Extended)** | **2,832** |
| **Inflected & Grammatical Word Forms Preserved** | **4,502** |
| **IPA Pronunciations Preserved** | **2,214 (97.96% coverage)** |

---

## 2. Compression & Storage Benchmarks

| Artifact | Format | Measured Size (Bytes) | Human Size | SHA-256 |
| :--- | :--- | ---: | ---: | :--- |
| **Core Pack (Uncompressed SQLite)** | SQLite 3 (Schema v3, 4 KB pages) | **663,552 B** | **648.00 KiB (0.63 MiB)** | `08c0ae60f2329e3685db34a9b059357667dc0de1ba525343ad78c74f8e52c953` |
| **Core Pack (GZIP Download)** | `.db.gz` (level 9, deterministic) | **303,106 B** | **296.00 KiB (0.29 MiB)** | `15dbc6906124348d21b1ba46475e85092feb705babd4315295f582f04971ff70` |
| **Extended Pack (Uncompressed SQLite)** | Companion SQLite 3 (`ATTACH AS ext`) | **421,888 B** | **412.00 KiB (0.40 MiB)** | `c72ffb3bf189acab9f682ad296dae076f611ac87b5258172ab587948a665d810` |
| **Extended Pack (GZIP Download)** | `.db.gz` (level 9, deterministic) | **138,086 B** | **134.85 KiB (0.13 MiB)** | `e726147cba40d88eee1b23ba2d0d87f8e8383c371f1131579440ced3a3773906` |

- **Compression ratio (Core):** 54.3% reduction (`648.00 KiB` -> `296.00 KiB`).
- **Android 15 Go & low-RAM suitability:** Sub-1 MB active Core DB fits effortlessly into persistent `noBackupFilesDir/lexica_packs/lexica_hausaSQLite.db` with streaming `GZIPInputStream` extraction (32 KB I/O buffer, zero in-memory archive buffering) and atomic `.tmp`/`.bak` database activation.

---

## 3. Architecture Reuse & Hausa Orthography Support

1. **Shared Native Installer (`EnglishPackInstallerPlugin.java`):**
   - Extended with language/pack routing (`isHausa`, `getActiveDb`, `getTmpDb`, `getBakDb`, `getPartGz`, `getMetaFile`, `getExtendedDb`) without duplicating native streaming download, HTTP `Range` resume, SHA-256 verification, SQLite `PRAGMA quick_check`, or atomic file swap code.
2. **Core & Optional Extended Layering:**
   - **Core Pack (`lexica_hausaSQLite.db`):** Standalone offline SQLite database containing `entries`, `parts_of_speech`, `word_forms`, `sources`, `metadata`, and contentless `entries_fts` (`detail=none`, `unicode61 remove_diacritics 1`).
   - **Extended Pack (`lexica_hausa_extended.db`):** Completely optional (`autoDownload: false`), containing `senses_ext` (secondary senses, usage examples, synonyms, antonyms) and `entry_extensions` (dialect IPAs, etymologies). Attached via `ATTACH DATABASE ? AS ext;` when present and detached cleanly without affecting Core searches.
3. **Hausa Orthography Normalization:**
   - Dedicated `headword_norm` and `form_norm` partial indexes store deep-normalized forms stripping tones/macrons (`à, á, â, ā, ē, ī, ō, ū`) and folding hooked consonants (`ɓ -> b`, `ɗ -> d`, `ƙ -> k`, `ƴ -> y`).
   - Searching either exact hooked Unicode (`ƙofa`, `ɓarka`) or ASCII keyboard input (`kofa`, `barka`) resolves cleanly via indexed `B-Tree` lookups.

---

## 4. Measured Search Latency Benchmarks

Benchmarked directly against the built 2,260-entry `lexica_hausa_core.db` (`200` iterations after warmup, Node `node:sqlite` / SQLite 3):

| Query Type | Query Pattern | Avg Latency (ms) |
| :--- | :--- | ---: |
| **Exact Headword** | `WHERE headword_lower = 'ruwa'` | **0.0308 ms** |
| **Normalized / Hooked Consonant** | `WHERE headword_norm = 'kofa' OR headword_lower = 'kofa'` | **0.0229 ms** |
| **Prefix Lookup** | `WHERE headword_lower >= 'bar' AND headword_lower < 'bas' LIMIT 20` | **0.0676 ms** |
| **FTS5 Definition Search** | `FROM entries_fts WHERE entries_fts MATCH 'water' LIMIT 20` | **0.0451 ms** |

---

## 5. Automated Test Verification

- `tests/dictionary-search.test.ts`: **21 / 21 PASSED** (starter 7-language corpus & bilingual lookup regression check)
- `tests/english-sqlite-integration.test.ts`: **16 / 16 PASSED** (Assignment 008 English SQLite Core + Extended & installer safety checks)
- `tests/hausa-sqlite-integration.test.ts`: **6 / 6 PASSED** (Manifest validation, Core standalone queries, hooked consonants `ƙ`/`ɓ`, tone/diacritic/inflection lookup, FTS5 search, bounded pagination, close/reopen persistence, Extended DB `ATTACH`/`DETACH`, failure recovery, and live 2,260-entry DB verification — tested under both `node:sqlite` and `LEXICA_TEST_FORCE_PY_SQLITE=1`).

---

## 6. Known Dataset & Licensing Limitations

1. **Dataset Size:** Wiktionary/Kaikki's public Hausa dump contains ~2,193 raw lexical records, yielding **2,260 verified entries** after merging Lexica's curated Hausa entries (`0` fabricated words).
2. **Primary Sense Coverage:** 100% of accepted entries have a non-empty primary definition; specialized domain terminology and dialectical idioms remain bounded by upstream Wiktionary coverage.
3. **Licensing:** Source records are derived from Wiktionary via Kaikki.org (Wiktextract) and are distributed under **CC BY-SA 4.0 & GFDL**, requiring attribution (`Copyright Wikimedia Contributors and Tatu Ylönen`), preserved in both `sources` metadata and `HAUSA_PACK_MANIFEST.attribution`.
