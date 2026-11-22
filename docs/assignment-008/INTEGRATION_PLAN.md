# Assignment 008 — Pre-Change Audit & Integration Plan

## 1. Repository Inspection Summary

Before implementing the Schema v3 Core prototype, all existing storage, download, SQLite, search, and UI layers were inspected across three branches:

1. **`main` (`0674331`)** — Untouched production baseline.
2. **`feature/storage-optimization-and-backup` (`1b50427`)** — Assignment 006 implementation introducing Schema v2 (`v0.3.0`), native streaming GZIP downloader + SHA-256 verifier, persistent `noBackupFilesDir/lexica_packs` storage, and SAF `.lexicabackup` export/import.
3. **`feature/assignment-007-dictionary-benchmark` (`9bb979b`)** — Research prototypes (`A0`, `A1`, `B`, `C`, `D`) and reproducible benchmarks recommending **Architecture D — Layered Core + Extended SQLite Packs**.

---

## 2. Inspected Application Interfaces

| Layer | File | Pre-Change Contract & Findings |
| :--- | :--- | :--- |
| **Domain Types** | `src/types/dictionary.ts` | `WordEntry` expected `senses: WordSense[]`, `etymology`, `allIpas`, `synonyms`, `antonyms`, `examples`. Needed non-breaking flags (`isCoreOnly`, `extraSensesCount`, `extendedInstalled`) for calm UI messaging when Extended is absent. |
| **Pack Manifest** | `src/config/englishDictionaryConfig.ts` | Contained hardcoded `v0.3.0` (`44.82 MiB` / `105.58 MiB`) values and required URL/SHA/size fields validated before native invocation. |
| **Native Android Installer** | `android/app/src/main/java/com/lexica/dictionary/EnglishPackInstallerPlugin.java` | Downloads `.db.gz` via `HttpURLConnection`, supports HTTP `Range` resume, verifies compressed + uncompressed SHA-256, swaps atomically inside `getNoBackupFilesDir()/lexica_packs/`, and validates staging SQLite schema. **Finding:** `validateStagingDatabase()` rejected any DB without a `senses` table — incompatible with Schema v3 Core unless updated. |
| **JS Pack Bridge** | `src/services/englishPackService.ts` | Wraps `EnglishPackInstaller` plugin, enforces manifest validation & duplicate-version guard before network calls, exposes `getPackStatus`, `installEnglishPack`, `removePack`, and `cancelInstall`. |
| **SQLite Query Engine** | `src/services/englishSqliteRepository.ts` | Supported Schema v1 (`v0.2.0`) and Schema v2 (`v0.3.0`) via `@capacitor-community/sqlite`, enforcing bounded pagination (`LIMIT/OFFSET`), `cache_size = -2000`, `temp_store = FILE`, and 4-tier ranking (`exact -> prefix -> word_forms -> FTS5`). **Finding:** Queries joined `pronunciations`, `etymologies`, `audio_files`, and `senses` unconditionally. |
| **Coordinator** | `src/services/englishSearchCoordinator.ts` | Routes `standard` + `en` searches to SQLite when active, returns explicit `language_not_installed` on Android otherwise, and falls back only on web preview. All 6 non-English languages (`ha`, `yo`, `ff`, `ar`, `fr`, `zh`) remain independent in `dictionaryDatabase.ts`. |
| **Backup Service** | `src/services/backupService.ts` | Exports/imports bundled corpus + user state (`JSON` on web) or `.lexicabackup` ZIP stream via Android SAF (containing `lexica_englishSQLite.db` + SHA-256 manifest + bundled state). |
| **UI Screens** | `src/components/LanguageLibraryScreen.tsx`, `src/components/WordDetailModal.tsx`, `src/components/HomeScreen.tsx`, `src/components/DictionaryScreen.tsx` | All UI screens consume `ENGLISH_PACK_MANIFEST` dynamically. Minor updates needed only in `LanguageLibraryScreen` (Core primary senses vs total senses + Extended optional row) and `WordDetailModal` (subtle note when only Core is installed). |

---

## 3. Integration Architecture Implemented

1. **Build Pipeline (`scripts/build_english_core_pack.py`):**
   - Produces deterministic **Core (`lexica_english_core.db` + `.db.gz`)** and optional **Extended (`lexica_english_extended.db` + `.db.gz`)** packs from the identical 75,000-entry canonical English dataset, outputting `core_audit_report.json` and `pack_manifest.json`.
2. **Native Validator Dual-Schema Support (`EnglishPackInstallerPlugin.java`):**
   - `validateStagingDatabase()` now validates **both** Schema v3 Core (`entries` with `primary_definition` + `parts_of_speech` + `word_forms` + `entries_fts`, **no** `senses` required) and legacy Schema v1/v2 (`senses` required) so new Core downloads AND older `.lexicabackup` restores work safely.
   - Reports `packLayer`, `corePrimarySenses`, `totalWordForms`, `extendedInstalled`, `extendedDbPath`, and `extendedDbSizeBytes`.
   - Checks `lexica_english_extended.db` lazily in the same `lexica_packs` directory and removes both Core + optional Extended on explicit user removal.
3. **Repository Dual-Layer Query Engine (`englishSqliteRepository.ts`):**
   - Auto-detects `schemaVersion = 3` (`pack_layer = 'core'`) on open.
   - Standalone Core mode queries `entries`, `parts_of_speech`, `sources`, `word_forms`, and `entries_fts` (`detail=none`) with **zero dependency on Extended**.
   - Adds partial-indexed normalization (`headword_norm` / `form_norm`) with NULL-safe SQL predicates for exact, normalized, prefix, word-form, and FTS5 searches.
   - When optional `lexica_english_extended.db` is present, transparently runs `ATTACH DATABASE ? AS ext` on open to hydrate all secondary senses, examples, synonyms/antonyms, dialect IPAs, audio filenames, and etymologies without altering user-facing query APIs.
4. **Live HTTPS GitHub Release Asset:**
   - Publishes `lexica_english_core.db.gz` under tag `prototype-en-core-v0.4.0` without touching releases `v0.1.0`, `v0.2.0`, or `v0.3.0`.
