# Lexica — Phase 1 SQLite + FTS5 Migration & Hybrid Pack Plan

> **Phase 1 Scope Notice**: This document captures the verified target architecture, relational schema, hybrid pack lifecycle, engine integration strategy, and low-RAM Android design completed during Phase 1 preparation. Production UI, seed datasets, and the active search engines remain untouched until Phase 2.

---

## 1. SQLite Compatibility Summary (Capacitor 7)

- **Target Capacitor Runtime**: `@capacitor/core@7.6.10`, `@capacitor/android@7.6.10`, `@capacitor/cli@7.6.10`
- **Compatible SQLite Plugin**: `@capacitor-community/sqlite@7.0.3`
  - `peerDependencies`: `@capacitor/core >= 7.0.0` (matches `7.6.10`; v8.x requires `@capacitor/core >= 8.0.0` and is incompatible)
  - **Bundled Android Native Engine**: `net.zetetic:sqlcipher-android:4.10.0@aar` + `androidx.sqlite:sqlite:2.4.0` + `androidx.room:room-runtime:2.6.1`
  - **SDK & Java Compatibility**: Uses project's `compileSdkVersion = 36`, `minSdkVersion = 24`, `targetSdkVersion = 36`, `JavaVersion.VERSION_21`
- **FTS5 Support**: Verified in `node:sqlite` (SQLite 3.51.3) in this Linux container via `tests/sqlite-poc.test.ts`, and supported natively in `sqlcipher-android:4.10.0` (Zetetic SQLCipher 4 builds with `SQLITE_ENABLE_FTS5`). Note: on-device Android runtime verification still requires execution on a physical Android device or emulator.
- **Asset & File Import Capabilities in Plugin**:
  - `copyFromAssets({ overwrite })`: Copies bundled `.db` or `.zip` files from `public/assets/databases/` inside the APK into the Android `databases/` directory (`UtilsFile.java`).
  - **Limitation Identified in `UtilsDownloadFromHTTP.java`**: The plugin's built-in `getFromHTTPRequest()` downloads synchronously without progress callbacks, cancellation hooks, or SHA-256 checksum verification. Phase 2 should use a custom native/chunked downloader (or Capacitor Filesystem / OkHttp streaming plugin) with SHA-256 verification before handing `.sqlite` files to `@capacitor-community/sqlite`.

---

## 2. Normalized SQLite + FTS5 Schema (`src/sqlite-poc/schema.ts`)

1. **`languages`**: Language metadata (`code`, `name`, `native_name`, `native_script`, `script_name`, `direction`, `speakers_count`, `accent_color`).
2. **`dataset_sources`**: Source & license registry (`id`, `name`, `license`, `attribution_text`, `source_url`, `dataset_version`).
3. **`language_packs`**: Tracks both `core_starter` and `full_pack` states (`pack_id`, `lang_code`, `tier`, `pack_version`, `schema_version`, `install_state`, `db_file_name`, `size_bytes`, `compressed_size_bytes`, `sha256_checksum`, `entry_count`, `sense_count`, `translation_count`, `installed_at`, `updated_at`).
4. **`entries`**: Canonical headwords (`id`, `source_lang`, `headword`, `headword_norm_soft`, `headword_norm_deep`, `headword_vowel_fold`, `headword_script_variant`, `headword_script_label`, `part_of_speech`, `gender_or_class`, `dialect`, `register`, `etymology`, `root_word`, `root_word_norm`, `tone_pattern`, `cultural_note`, `primary_ipa`, `audio_phonetic_text`, `audio_phonetic_norm`, `pack_id`, `source_id`, `verification_status`).
   - Uniqueness constraint: `UNIQUE(source_lang, headword, part_of_speech)`.
5. **`senses`**: One-to-many sense definitions (`id`, `entry_id`, `sense_number`, `part_of_speech`, `definition`, `definition_en`, `register`, `usage_note`), `UNIQUE(entry_id, sense_number)`.
6. **`examples`**: Usage sentences linked to `entry_id` and `sense_id`.
7. **`pronunciations`**: Dialectal IPA, tone contour, phonetic respelling, optional offline audio reference.
8. **`word_forms`**: Inflections, broken plurals, conjugations (`form`, `form_norm_soft`, `form_norm_deep`, `grammatical_label`, `note`).
9. **`lexical_relations`**: Monolingual `synonym`, `antonym`, and `related` entries (`related_term`, `related_term_norm`, optional `target_entry_id`).
10. **`translation_links`**: Sense-level directional translation edges (`source_entry_id`, `source_sense_id`, `source_lang`, `target_lang`, `target_entry_id`, `target_sense_id`, `target_headword`, `target_headword_norm_soft`, `target_headword_norm_deep`, `target_transliteration`, `target_transliteration_norm`, `equivalence_type`, `contextual_note`, `register`, `source_id`).
11. **`entries_fts`**: FTS5 virtual table (`tokenize = 'unicode61 remove_diacritics 0'`) indexing `headword`, `headword_norm_soft`, `headword_norm_deep`, `audio_phonetic_norm`, `forms_text`, `synonyms_text`, `definitions_text`.

---

## 3. Hybrid Distribution Architecture

### A. Core Starter Database (Bundled in APK)
- Stored at `public/assets/databases/lexica_core.db` (`~1.5 MB`), copied into Android internal databases directory via `copyFromAssets()` on first launch.
- Contains language metadata, `dataset_sources`, `language_packs` registry, and the verified 489 starter entries so the app works immediately offline out-of-the-box.

### B. Seven Independent Downloadable Packs
One pre-compiled, pre-indexed SQLite pack per language (`lexica_pack_en.db`, `ha`, `yo`, `ff`, `ar`, `fr`, `zh`), distributed compressed (`.db.gz` or `.zip`).

### C. Pack Lifecycle Safeguards
1. **Download Progress & Cancellation**: Stream download to `cacheDir/<pack>.part` using an `AbortController` / native transfer task ID so users can cancel cleanly and clean up `.part` files.
2. **Integrity Verification**: Verify SHA-256 hash and file byte length against the signed pack manifest before decompression/opening.
3. **Atomic Installation & Duplicate Prevention**:
   - Decompress into `lexica_pack_<lang>.tmp.db`.
   - Run `PRAGMA quick_check;` and verify `schema_version` + `language_packs` metadata.
   - Use `ATTACH DATABASE` or per-language shard query routing (recommended: **attached or sharded per-language `.sqlite` DBs** to avoid inserting 100k+ rows on the device).
   - For updates/duplicates: `UNIQUE(source_lang, headword, part_of_speech)` and `pack_id` versioning prevent duplicate headwords; installing a `full_pack` atomically supersedes starter entries or merges cleanly via `pack_id`.
4. **Recovery from Interrupted Install**:
   - Pack state transitions: `not_installed -> downloading -> verifying -> installed` (with `incomplete` on failure).
   - On app startup, any stale `.part` or `.tmp.db` files or `downloading`/`verifying` states automatically roll back to `not_installed` (leaving `core_starter` intact).
5. **Updates & Uninstallation**:
   - **Update**: Stage new version in `.tmp.db`, verify checksum & `PRAGMA quick_check`, close connection, atomically rename over active DB, reopen.
   - **Uninstall**: Close pack DB connection, delete `lexica_pack_<lang>SQLite.db`, update `language_packs.install_state = 'not_installed'`, preserve `core_starter`.

---

## 4. Protecting Existing Search Engines (`StandardDictionarySearch` & `MultilingualDictionarySearch`)

Both engines already separate domain logic (`TextNormalization`, ranking rules, equivalence preservation, reverse lookup flags, and explicit status codes) from storage:
- `StandardDictionarySearch.search(context, query, language, options)` only reads `entries`, `sensesByEntryId`, `morphologyByEntryId`, and `isLanguageInstalled`.
- `MultilingualDictionarySearch.search(context, query, sourceLang, targetLang, options)` reads `translationLinksByEntryId`, `sensesById`, `entriesById`, and `isLanguageInstalled`.

**Phase 2 Adapter Pattern (No Engine Rewrite Required)**:
1. Introduce an async SQLite repository (`SqliteDictionaryRepository`) that queries SQLite (`entries_fts MATCH ...` + B-tree prefix fallback + `LIMIT 50`) for only the small candidate subset (`<= 50` entries + their senses, forms, and translation links).
2. Feed that pre-filtered candidate `Map` context directly into the existing `StandardDictionarySearch` / `MultilingualDictionarySearch` ranking & status evaluators—preserving 100% of existing normalization, scoring tiers, reverse-lookup handling, and UI contracts without loading the full dictionary into JavaScript memory.

---

## 5. Low-RAM & Low-Storage Android Engineering Rules

1. **Zero Full-Dataset JS Memory Loading**: Never `JSON.parse()` or load entire language packs into JS arrays/Maps. Query SQLite directly with `LIMIT` and pagination.
2. **Pre-Built Compressed Packs**: Build `.sqlite` files (with indexes and FTS5 already constructed) during the offline data pipeline, compress with gzip/zstd/zip, and ship/download binary SQLite databases rather than importing raw JSON on the phone.
3. **Chunked Transactions (if importing updates)**: If incremental SQL batches are ever executed on-device, cap transactions to `500` rows per commit and yield between batches.
4. **Read-Only Pack Connections + `PRAGMA` Tuning**:
   - Open installed dictionary packs with `readonly: true` where possible, `PRAGMA cache_size = -4000` (4 MB cap), `PRAGMA temp_store = FILE` to keep heap/native RSS minimal on 2 GB RAM devices.
   - Avoid background services or persistent watchers; execute pack downloads only while user-initiated.
