# Lexica English Dictionary Prototype — Reproducibility, Audit & Android Feasibility Report

**Branch:** `feature/english-dictionary-prototype` (branched from `main` at `0674331ffc664de3af259df15865edbef634f47d`)  
**Release Tag:** `prototype-en-v0.1.0`  
**Date:** 2026-11-19  

---

## 1. Reproducible Prototype Package & Provenance

### 1.1 Source Dataset Version & Retrieval
- **Source:** Kaikki.org English Wiktionary JSONL (`kaikki.org-dictionary-English.jsonl.gz`)
- **URL:** `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz`
- **Underlying Wikimedia Dump Date:** `2026-10-01` (`enwiktionary`)
- **Kaikki Extraction Date:** `2026-10-30` (`Last-Modified: Fri, 30 Oct 2026 23:09:26 GMT`)
- **Wiktextract / Wikitextprocessor Commits:** `19f9a3006a405fb7bfb40193dca41c7117a009a5` / `6f96ddf5f3466707f1869fe6618390fd77dfd109`
- **Retrieval Date:** `2026-11-19`
- **License:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) / GFDL

### 1.2 Environment & Dependencies
- **Python:** `3.11.2`
- **SQLite Engine:** `3.40.1` (with FTS5 compiled in)
- **External Python Dependencies:** None (uses Python Standard Library only: `argparse`, `gzip`, `json`, `os`, `sqlite3`, `sys`, `time`, `typing`).

### 1.3 SHA-256 Checksums & Sizes
| Artifact | Size (Bytes) | Size (MiB) | SHA-256 Checksum | Distribution Location |
| :--- | ---: | ---: | :--- | :--- |
| `kaikki-English.jsonl.gz` (source) | 534,186,395 | 509.44 | `4d03b6cba283744756c57ff661c2c6cbfe34fcf8ff513a966576cf7d97e91a99` | Upstream Kaikki.org |
| `scripts/compile_english_dictionary.py` | 17,474 | 0.02 | `01b39a71049eab686db62653f8dc47d2a9c8343b45c68d25886f6d808d011668` | Git branch `feature/english-dictionary-prototype` |
| `scripts/verify_english_database.py` | 11,821 | 0.01 | `f7dd144790928c6410aeb60c0e2e8a68abe4b5e88cf900ebbab5d678341893f8` | Git branch `feature/english-dictionary-prototype` |
| `lexica_english.db` | 165,920,768 | 158.23 | `443604e61a94cf26a087771e43604d390fff2f5f03c0ba6dbd2b0f0bd48ff305` | GitHub Release `prototype-en-v0.1.0` |
| `lexica_english.db.gz` | 58,199,556 | 55.50 | `43c98048c6188c59fc2038f536a3e6847cf8912fac692d10ab2cbf07774f6acf` | GitHub Release `prototype-en-v0.1.0` |

### 1.4 Exact Reproduction Commands
```bash
# 1. Download raw source dataset
curl -L --fail --retry 3 -o /tmp/kaikki-English.jsonl.gz \
  https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz

# 2. Compile SQLite prototype (75,000 entries, FTS5 indexed, VACUUMed)
python3 scripts/compile_english_dictionary.py \
  --source /tmp/kaikki-English.jsonl.gz \
  --output packs/lexica_english.db \
  --limit 75000

# 3. Verify database integrity, schema, and search features
python3 scripts/verify_english_database.py --db packs/lexica_english.db

# 4. Compress for network distribution (55.50 MiB)
gzip -9 -c packs/lexica_english.db > packs/lexica_english.db.gz
```

---

## 2. Independent Database Audit Findings

Direct read-only SQLite inspection of `lexica_english.db` verified every claimed metric:
- **Total `entries` rows:** `75,000` (exact match)
- **Distinct `headword_lower` (case-insensitive):** `45,317` (exact match; `47,728` distinct case-sensitive `headword` strings)
- **Total `senses` rows:** `190,672` (exact match)
- **Total `word_forms` rows:** `134,837`
- **Total `entries_fts` rows:** `75,000`
- **Integrity & Foreign Keys:**
  - `PRAGMA integrity_check;` -> `ok`
  - `PRAGMA foreign_key_check;` -> `0` violations
  - Orphaned `senses`: `0`; Orphaned `word_forms`: `0`
  - Entries without senses: `0`; Empty/NULL definitions: `0`
  - Invalid `source_id`: `0`
  - Sense numbering gaps (`sense_number` 1..N): `0`
- **FTS5 Synchronization:**
  - `INSERT INTO entries_fts(entries_fts) VALUES('integrity-check');` -> **PASS**
  - Entries missing in FTS5 / extra in FTS5: `0` / `0`
  - `headword` / `part_of_speech` mismatches vs `entries`: `0`
  - Exact `definitions_text` mismatches vs concatenated `senses.definition`: `0`
- **Duplicate, Variant & Multi-POS Handling:**
  - Multiple POS under the same headword are cleanly stored as distinct `entries` rows (e.g., `dictionary`: noun + verb; `run`: 4 entries across verb/noun/adj; `light`: 8 entries across noun/verb/adj/adv) with senses linked via `entry_id`.
  - `5,348` `(headword, part_of_speech)` homograph groups represent distinct Wiktionary etymology blocks (e.g., `light` from PIE *lewk- "brightness" vs PIE *h₁lengʷʰ- "not heavy").
  - **Audit Observation (Non-blocking):** In `extract_pronunciations()`, `primary_ipa` keeps the *last* IPA entry tagged `US`/`Received-Pronunciation`/`UK` (so for `light`, `primary_ipa` picked `[ləjt]` tagged `["Canada", "US", "regional"]` even though `[laɪt]` and `[ɫɐɪt]` are preserved in `all_ipas`). Recommend tightening priority order (`Received-Pronunciation` / `General-American` first, excluding `regional`) in the next compiler revision.

---

## 3. Android SQLite Integration Feasibility (Capacitor 7)

Inspection of `package.json` on `main` (`0674331`) and `feature/lexica-sqlite-migration` (`c9cd2eb`) confirms that **no SQLite or Filesystem plugin is currently installed** (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli` `7.6.10` only; `c9cd2eb` removed `@capacitor-community/sqlite`). `android/variables.gradle` targets `minSdkVersion = 24`, `compileSdkVersion = 36`, `targetSdkVersion = 36`, AGP `8.13.0`, and `JavaVersion.VERSION_21`.

### Option Comparison
- **Option A — Native Android SQLite (`@capacitor-community/sqlite@7.0.3`):** Uses `net.zetetic:sqlcipher-android` (16 KB page-size compliant for Android 15/16). Reads directly from disk via native SQLite/FTS5 with `PRAGMA cache_size = -4000` (~4 MB RAM), full offline persistence, fast B-tree & FTS5 pagination, zero JS heap bloat.
- **Option B — SQLite WASM (`sql.js-fts5@1.4.0` or `@sqlite.org/sqlite-wasm`):** `sql.js` loads the entire 158 MB DB into JS/WASM linear memory (`~200+ MB` RAM), causing OOM crashes on low-memory Android devices and lacking native APK database access. `@sqlite.org/sqlite-wasm` with OPFS avoids full-buffer RAM in modern browsers/WebViews, but still incurs WebView memory/quota limits and bridge overhead compared to native SQLite.
- **Option C — Hybrid (Recommended):** `@capacitor-community/sqlite@7.0.3` on Android native + `@sqlite.org/sqlite-wasm` (OPFS) or `sql.js-fts5` only for small browser preview dev mode.

---

## 4. Database Distribution Strategy (158.23 MiB Uncompressed / 55.50 MiB `.gz`)

- **Avoid bundling 158 MB in the APK:** Keeps base APK ~8–10 MB and avoids Google Play size friction.
- **Avoid JS-memory decompression:** The earlier `packManager.ts` / `sqliteAdapter.ts` prototype fetched compressed blobs into JS memory, ran `fflate.gunzipSync` (~158 MB buffer), and converted to Base64 (~211 MB string) across the Capacitor bridge—guaranteed OOM crash on low-RAM Android phones.
- **Recommended Delivery Pipeline:**
  1. Host `lexica_english.db.gz` (`58,199,556` bytes, SHA-256 verified) on GitHub Releases / CDN with `Accept-Ranges: bytes`.
  2. Use a small native Android Capacitor plugin (using built-in `HttpURLConnection`, `java.util.zip.GZIPInputStream`, `MessageDigest("SHA-256")`, and `android.database.sqlite.SQLiteDatabase`) to stream download directly to app-private `noBackupFilesDir` (`*.part` with HTTP `Range` resume), verify SHA-256 with an 8 KB buffer, stream-decompress with a 32 KB buffer into `*.tmp`, run `PRAGMA quick_check`, and atomically rename to `lexica_english.db`.
  3. Set `dataExtractionRules` / `fullBackupContent` to exclude downloaded packs from Android Auto Backup (25 MB cloud limit).

---

## 5. Android Device Performance Benchmark Plan

Desktop Python timings (`0.019 ms` avg) must **not** be treated as Android WebView timings (due to Capacitor JS-to-Native JSON bridge serialization and mobile flash I/O). Before shipping:
1. Run an instrumented test harness inside the Capacitor Android app on both a **mid-range device (Android 14/15, 6–8 GB RAM)** and a **low-memory device (Android 11–13, 2–3 GB RAM)**.
2. Measure cold DB open, warm DB open, exact lookup (`dictionary`, `epistemology`, `run`), prefix search (`epistem%` `LIMIT 25`), FTS5 search (`knowledge AND branch` `LIMIT 25`), pagination (`OFFSET 0, 25, 50`), repeated-query latency (100 sequential queries, P50/P95/P99), and Android PSS/native heap via `adb shell dumpsys meminfo com.lexica.dictionary`.
