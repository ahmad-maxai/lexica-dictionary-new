# LEXICA — Assignment 016: Compression and SQLite Integrity Report

**Branch:** `feature/assignment-016-fulfulde-lexicography-recovery`
**Builder Script:** `scripts/build_fulfulde_recovery_schema_v4.py`
**Manifest Snapshot:** `fulfulde_recovery_manifest.json`

---

## 1. SQLite Schema v4 Core & Extended Recovery Metrics

- **Core SQLite Database (`lexica_fulfulde_core.db`):**
  - Uncompressed Size: **81,920 bytes** (`80 KiB`)
  - Uncompressed SHA-256: `f039121c7ed20e68aa6643829c88b7bbfae46615b87f3fce8744391f83d0d785`
  - Compressed GZIP (`lexica_fulfulde_core.db.gz`): **7,522 bytes** (`7.3 KiB`)
  - Compressed SHA-256: `678c127b32fe3ce7a248c45945a786fb9e91ae1496c6631b274ff5cf48c94269`
  - SQLite Integrity Check (`PRAGMA quick_check;`): **`ok`**

- **Extended SQLite Database (`lexica_fulfulde_extended.db`):**
  - Uncompressed Size: **32,768 bytes** (`32 KiB`)
  - Uncompressed SHA-256: `541a287f8941ae0392ce60994f7be7727ec73820d69396ecdd7a43fa9b683df2`
  - Compressed GZIP (`lexica_fulfulde_extended.db.gz`): **4,943 bytes** (`4.8 KiB`)
  - Compressed SHA-256: `723a850a52ff32b086c2ad34993fff247a7b9c1b17725e7e6000b4d4203813dc`
  - SQLite Integrity Check (`PRAGMA quick_check;`): **`ok`**

---

## 2. Verification Summary

- **Total Accepted Entries:** 20
- **Total Senses:** 20
- **Bilingual Explanations:** 20 (100%)
- **English-Only Glosses:** 0 (0%)
- **FTS5 Search & Word Forms:** Fully functional and verified via automated test suite.
