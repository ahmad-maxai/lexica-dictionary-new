# LEXICA — Assignment 008: Android Core Pack Prototype & Real-Device Validation Readiness

- **Branch:** `feature/assignment-008-android-core-prototype`
- **Branched From:** `origin/feature/storage-optimization-and-backup` (`1b50427e8cbd4bcfb78f5203f8b8617ccd20ab72`)
- **Research Foundation:** Assignment 007 on `feature/assignment-007-dictionary-benchmark` (`Architecture D — Layered Core + Extended SQLite Packs`)
- **Release Tag & Asset:** `prototype-en-core-v0.4.0` (`lexica_english_core.db.gz`)
- **Production `main` Status:** Untouched (`0674331`)

---

## 1. Key Prototype Measurements (Verified)

| Metric | Assignment 006 (`v0.3.0` Schema v2) | Assignment 007 (`arch_d_core`) | Assignment 008 (`0.4.0-core` Schema v3) |
| :--- | :--- | :--- | :--- |
| **Compressed Download (GZIP -9)** | `44.82 MiB` (`47,000,179` B) | `8.16 MiB` (gzip -6) | **`8.20 MiB` (`8,602,919` B)** |
| **Installed SQLite Size** | `105.58 MiB` (`110,706,688` B) | `17.39 MiB` | **`17.69 MiB` (`18,546,688` B)** |
| **Accepted Entries** | `75,000` (`45,317` distinct hw) | `75,000` (`45,317` distinct hw) | **`75,000` (`45,317` distinct hw)** |
| **Definitions Included** | `190,672` all senses | `75,000` Sense #1 | **`75,000` audited primary definitions** |
| **Entries Missing Definitions** | `0` | `0` | **`0`** |
| **Word Forms Preserved** | `134,837` | `134,837` | **`134,837`** |
| **Primary IPA Coverage** | `50,902` (`67.87%`) | `50,902` (`67.87%`) | **`50,902` (`67.87%`)** |
| **Normalization Support** | Case-insensitive `*_lower` | Case-insensitive `*_lower` | **Partial-indexed `headword_norm` / `form_norm` + `*_lower`** |
| **Full-Text Search** | FTS5 `detail=column` | FTS5 `detail=none` | **FTS5 `detail=none` (`content=''`, unicode61 diacritic fold)** |
| **Optional Companion Extended** | Bundled inside monolith | `85.45 MiB` (`35.84 MiB` gz) | **`85.48 MiB` (`37,514,633` B gz — optional, never auto-downloaded)** |

- **Download Reduction vs `v0.3.0`:** **`-81.7%`** (`44.82 MiB -> 8.20 MiB`)
- **Installed Storage Reduction vs `v0.3.0`:** **`-83.2%`** (`105.58 MiB -> 17.69 MiB`)
- **Compressed SHA-256:** `5c80de4b38765186b8509bd129c8e6de79642e41b020c19a4304eb76e4892788`
- **Uncompressed SHA-256:** `8a66010602321ae1db7d03fe788d07e5e787e160959962bb0fc7fe66c1f20d44`

---

## 2. Documents in This Folder

1. [`INTEGRATION_PLAN.md`](./INTEGRATION_PLAN.md) — Audit of existing interfaces and end-to-end integration plan.
2. [`SCHEMA_AND_MIGRATION.md`](./SCHEMA_AND_MIGRATION.md) — Schema v3 Core + Companion Extended DDL, Android validator update, and `ATTACH DATABASE` enrichment flow.
3. [`PRIMARY_DEFINITION_AUDIT.md`](./PRIMARY_DEFINITION_AUDIT.md) — Complete primary-sense selection policy, promoted weak stubs, markup cleanup, and duplicate/normalization collision report.
4. [`ASSIGNMENT_007_COMPARISON.md`](./ASSIGNMENT_007_COMPARISON.md) — Exact comparison against Assignment 007 Architecture D benchmarks and trade-off rationale.
5. [`REAL_DEVICE_VALIDATION_CHECKLIST.md`](./REAL_DEVICE_VALIDATION_CHECKLIST.md) — Step-by-step protocol and Pass/Pending validation boundaries for Android 15 Go real-device testing.
6. [`core_audit_report.json`](./core_audit_report.json) & [`pack_manifest.json`](./pack_manifest.json) — Machine-readable build audit and release manifest output.

---

## 3. Honest Verification Scope

- **Verified locally on Linux (`Node v22` + `Python 3.11 / SQLite 3.40.1`) & GitHub Actions CI (`Ubuntu` + `Android Gradle`):**
  - Reproducible Core + Extended SQLite build (`scripts/build_english_core_pack.py`), checksum verification, and structural audit (`scripts/verify_english_database.py`).
  - Full automated TypeScript test suites (`npm test`: `21/21` non-English & multilingual tests + `18/18` English SQLite Core/Extended/backup/failure-mode tests), `tsc --noEmit`, `vite build`, and GitHub Actions Debug APK build.
- **Not yet executed in this environment:**
  - **Physical Android 15 Go device testing** (Samsung Galaxy A04e download over cellular/Wi-Fi, real Android `PRAGMA` query timings under Go-edition memory constraints, app cold restart persistence, SAF SD/USB export & restore, cache-clear survival). See [`REAL_DEVICE_VALIDATION_CHECKLIST.md`](./REAL_DEVICE_VALIDATION_CHECKLIST.md).
