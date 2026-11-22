# Assignment 008 — Schema v3 Core + Extended Specification & Migration Notes

## 1. Schema Evolution Overview

| Version | Release | Design | Installed Size | Download Size (GZIP) |
| :--- | :--- | :--- | :--- | :--- |
| **Schema v1** | `v0.2.0` | Denormalized single DB (`all_ipas` JSON per entry, redundant source text, default FTS5) | `158.23 MiB` | `~55.7 MiB` |
| **Schema v2** | `v0.3.0` | Normalized lookup tables, nullable exact casing, contentless `detail=column` FTS5, `page_size=16384` | `105.58 MiB` | `44.82 MiB` |
| **Schema v3 Core** | `0.4.0-core` | Layered **Core DB**: 75k entries, audited `primary_definition`, `extra_senses_count`, `primary_ipa`, `134,837` `word_forms`, partial-indexed `*_norm`, `detail=none` FTS5 | **`17.69 MiB`** | **`8.20 MiB`** |
| **Schema v3 Extended** | `0.4.0-extended` *(optional)* | Companion **Extended DB** attached via `ATTACH DATABASE`: secondary senses, examples, synonyms, antonyms, dialect IPAs, etymologies, audio filenames, form tags | `85.48 MiB` | `35.78 MiB` |

---

## 2. Schema v3 Core DDL (`lexica_english_core.db`)

Settings applied at build time: `PRAGMA page_size = 16384;`, `PRAGMA foreign_keys = ON;`, `ANALYZE;`, `VACUUM;`.

```sql
CREATE TABLE metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  license TEXT NOT NULL,
  attribution_text TEXT NOT NULL,
  source_url TEXT NOT NULL,
  dataset_version TEXT NOT NULL
);

CREATE TABLE parts_of_speech (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  headword_lower TEXT NOT NULL,
  headword TEXT,               -- NULL when identical to headword_lower
  headword_norm TEXT,          -- Partial-indexed folded ASCII/apostrophe key ONLY when != headword_lower
  pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
  primary_ipa TEXT,
  primary_definition TEXT NOT NULL,
  extra_senses_count INTEGER NOT NULL DEFAULT 0,
  source_id INTEGER NOT NULL REFERENCES sources(id)
);

CREATE TABLE word_forms (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  form_lower TEXT NOT NULL,
  form TEXT,                   -- NULL when identical to form_lower
  form_norm TEXT               -- Partial-indexed folded key ONLY when != form_lower
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  headword,
  primary_definition,
  content='',
  detail=none,
  tokenize = 'unicode61 remove_diacritics 1'
);

CREATE INDEX idx_core_entries_hw_lower ON entries(headword_lower);
CREATE INDEX idx_core_entries_hw_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;
CREATE INDEX idx_core_wf_lower ON word_forms(form_lower);
CREATE INDEX idx_core_wf_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;
CREATE INDEX idx_core_wf_entry_id ON word_forms(entry_id);
```

### Partial-Indexed Normalization Strategy
- `headword_norm` is stored **only** when `normalize_latin_soft(headword_lower) != headword_lower` (`789` rows out of `75,000`), and `form_norm` **only** when `normalize_latin_soft(form_lower) != form_lower` (`2,853` rows out of `134,837`).
- Partial indexes (`WHERE headword_norm IS NOT NULL` / `WHERE form_norm IS NOT NULL`) add negligible flash footprint (`< 0.15 MiB`) while supporting fast normalized lookups such as `"regime" -> "régime"`, `"mexico" -> "México"`, `"pinata" -> "piñata"`, and `"its" -> "it's"`.
- Query predicates guard against SQLite 3-valued `NULL` evaluation (`(e.headword_norm IS NULL OR e.headword_norm != ?)` in exclusion clauses so Tier 3 `word_forms` and Tier 4 `FTS5` queries never drop rows with `NULL` normalization keys).

---

## 3. Companion Extended DDL (`lexica_english_extended.db`)

Designed for optional attachment (`ATTACH DATABASE '<path>/lexica_english_extended.db' AS ext;`) without modifying Core IDs (`entries.id` is shared directly):

- `entry_extensions(entry_id PRIMARY KEY, pronunciation_id, audio_id, etymology_id, primary_sense_number)`
- `senses_ext(id PRIMARY KEY, entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms)` — omits duplicate primary definition string when identical to Core `primary_definition` (`definition IS NULL` falls back cleanly via `COALESCE(s.definition, e.primary_definition)`).
- Interned pools: `tag_sets`, `pronunciations`, `etymologies`, `audio_files`, plus `word_form_tags(entry_id, form_index, tags_id)`.
- Extended companion delivery is **strictly optional**, has `autoDownload: false`, and is never required for online or offline dictionary searches.

---

## 4. Android Native Validator & Backup Compatibility

`EnglishPackInstallerPlugin.java` (`validateStagingDatabase`) supports both architectures seamlessly:
- Checks `PRAGMA quick_check` (`ok`), `entries` >= `1` (or `>= 75000` for production size match), `word_forms`, `entries_fts` (`MATCH 'knowledge'`).
- **Schema v3 Core branch:** verifies `parts_of_speech` exists and `entries` has `primary_definition` without requiring a `senses` table.
- **Schema v1/v2 Legacy branch:** continues validating `senses` >= `1` so user-exported `.lexicabackup` archives created under `v0.2.0` or `v0.3.0` still restore cleanly without breaking existing users.
- Duplicate-version guard checks `datasetVersion`, `uncompressedSizeBytes`, and `acceptedEntries` via `verifyInstalledPack()` before opening any HTTP connection (`0` network bytes transferred when `0.4.0-core` is already installed).
