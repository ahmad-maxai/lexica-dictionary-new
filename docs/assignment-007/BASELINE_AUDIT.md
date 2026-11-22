# LEXICA — Assignment 007: Baseline Dataset & Storage Audit

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  
**Audit Source:** `prototype-en-v0.2.0` (SQLite schema v1) & `prototype-en-v0.3.0` (SQLite schema v2)  
**Benchmark Script:** `scripts/assignment_007/baseline_audit.py`  

---

## 1. Executive Summary

Assignment 007 evaluates how LEXICA can scale offline dictionaries to hundreds of thousands or millions of entries while minimizing download size, installed storage, RAM consumption, and search latency on constrained mobile hardware (e.g., Android 15 Go devices with ~2.7 GiB total RAM).

This baseline audit measures the exact composition, storage breakdown, B-tree overhead, text payload distribution, and deduplication characteristics of LEXICA's existing 75,000-entry English dictionary (`v0.2.0` vs `v0.3.0`).

---

## 2. Canonical Dataset Composition

Measured directly from `/tmp/lexica_english_v030.db` (`baseline_audit.py`):

| Metric | Measured Count | Notes |
| :--- | :--- | :--- |
| **Total Accepted Entries** | `75,000` | Multi-POS headword entries |
| **Distinct Headwords (Lowercase)** | `45,317` | Case-insensitive unique lemmas |
| **Distinct Headwords (Exact Case)** | `47,728` | Case-preserving unique lemmas (`61,720` equal to lowercase, `13,280` mixed case) |
| **Total Senses** | `190,672` | `75,000` primary (`sense_number = 1`) + `115,672` secondary senses |
| **Total Word Forms / Inflections** | `134,837` | `122,358` lowercase + `12,479` mixed case |
| **Senses with Examples** | `101,240` | Raw `examples` JSON payload = `52,651,331` UTF-8 bytes (`50.21 MiB`) |
| **Senses with Synonyms** | `32,595` | Raw `synonyms` JSON payload = `3,099,151` UTF-8 bytes (`2.96 MiB`) |
| **Senses with Antonyms** | `3,983` | Raw `antonyms` JSON payload = `215,716` UTF-8 bytes (`0.21 MiB`) |
| **Entries with IPA References** | `50,902` | `29,743` distinct `pronunciations` rows (`2.64 MiB` unique vs `4.78 MiB` expanded) |
| **Entries with Etymology References** | `56,637` | `41,186` distinct `etymologies` rows (`9.66 MiB` unique vs `14.65 MiB` expanded) |
| **Entries with Audio References** | `52,859` | `31,385` distinct `audio_files` rows (`0.87 MiB` unique vs `1.37 MiB` expanded) |
| **Distinct Parts of Speech** | `24` | Normalized lookup table |
| **Distinct Tag Sets** | `9,438` | Referenced `256,425` times across senses and word forms |

### Definition Payload Statistics

- **Total UTF-8 Definition Bytes:** `11,574,428` bytes (`11.04 MiB`)
- **Length Distribution:** mean `60.61` chars, median `48.0` chars, p90 `117` chars, p99 `223` chars (min `2`, max `722`)
- **Distinct Definitions:** `183,554` (`7,118` duplicate definition occurrences across all `190,672` senses — top duplicate: `"A surname."` appearing `512` times)

---

## 3. Storage Breakdown: `v0.2.0` vs `v0.3.0`

From the `prototype-en-v0.3.0` storage audit (`storage_audit_report.json`) and local audit:

| Metric | `v0.2.0` (Schema v1) | `v0.3.0` (Schema v2 / A0) | Reduction |
| :--- | :--- | :--- | :--- |
| **Extracted SQLite Size** | `165,916,672` B (`158.23 MiB`) | `110,706,688` B (`105.58 MiB`) | `-33.28%` (`-52.65 MiB`) |
| **Compressed Archive (`.db.gz`)** | `58,190,048` B (`55.49 MiB`) | `47,000,179` B (`44.82 MiB`) | `-19.23%` (`-10.67 MiB`) |
| **SQLite Page Size / Page Count** | `4,096` B / `40,507` pages | `16,384` B / `6,757` pages | `4x` larger pages |
| **`senses` Table** | `89,673,728` B (`85.52 MiB`) | `74,104,832` B (`70.67 MiB`) | `-14.85 MiB` |
| **`entries` Table** | `32,522,240` B (`31.02 MiB`) | `2,916,352` B (`2.78 MiB`) | Normalized out text blobs |
| **FTS5 Tables (`entries_fts_*`)** | `27,152,384` B (`25.89 MiB`) | `6,995,968` B (`6.67 MiB`) | `-74.23%` (`content=''`, `detail=column`) |
| **Average Extracted Size per Entry** | `2,212` B (`2.16 KiB`) | `1,476` B (`1.44 KiB`) | — |
| **Average Extracted Size per Sense** | `870` B | `581` B | — |

---

## 4. Key Storage Drivers & Optimization Findings

1. **Example Sentences Dominate Raw Payload (`50.21 MiB`):**  
   Of the ~79 MiB of raw UTF-8 text in `v0.3.0`, `examples_json` accounts for `52.65 MB` (`50.21 MiB`) alone — more than `4.5x` the size of all `190,672` definitions (`11.04 MiB`) combined. Secondary senses (`115,672` rows) + examples + etymologies (`9.66 MiB`) account for ~83% of the uncompressed database.
2. **The `UNIQUE` Autoindex Trap (`+17.14 MiB` in experimental builds):**  
   Adding `UNIQUE` constraints on build-time deduplicated lookup tables (`etymologies(text)`, `pronunciations(all_ipas)`, `audio_files(filename)`, `tag_sets(tags_json)`) forces SQLite to maintain hidden `sqlite_autoindex_*` B-trees duplicating every lookup string (`+17.14 MiB` overhead). Eliminating redundant `UNIQUE` constraints on pre-deduplicated build-time tables keeps `A1` (`102.64 MiB`) and `D` compact.
3. **Hot/Cold Table Splitting Within a Single SQLite File Backfires:**  
   Moving `examples`, `synonyms`, and `antonyms` out of `senses` into a 101,240-row side table inside the same SQLite database adds rowid B-tree headers and hurts size; instead, splitting **Core (`entries` + Sense #1 + `word_forms` + FTS5)** from **Extended (secondary senses + examples + etymologies + `all_ipas`)** into two separate attachable SQLite packs cuts the mandatory Core pack to **`17.39 MiB`** (`18,235,392` B).
4. **Baseline `v0.3.0` Extraction & Query Footprint (Linux x86_64 Container):**
   - Streaming `.db.gz` extraction: `0.985 s`, Python `tracemalloc` peak `333.38 KiB`, max process RSS `80.5 MiB`.
   - Batch exact lookup median: `0.118 ms` (p95 `0.322 ms`), prefix median: `0.879 ms`, FTS5 median: `1.807 ms`.
