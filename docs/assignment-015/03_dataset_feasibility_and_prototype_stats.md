# LEXICA — Assignment 015: Dataset Feasibility & Schema v4 Isolated Prototype Statistics

**Branch:** `feature/assignment-015-fulfulde-source-audit`
**Prototype Builder:** `scripts/build_fulfulde_prototype_v4.py` (isolated output, NOT wired into production UI, configs, or Android release packs)
**Manifest Snapshot:** `docs/assignment-015/fulfulde_prototype_manifest.json`

---

## 1. Empirical Prototype Statistics (Schema v4 Core + Extended)

Built directly from audited open-licensed sources (`kaikki_fula.jsonl`, `wikidata_q33454_full.json`, `tatoeba_fuc.json`, and verified starter entries):

| Metric | Measured Value | Verification Method |
| :--- | :---: | :--- |
| **Total Accepted Entries** | **8,380** | `SELECT COUNT(*) FROM entries` |
| **Distinct Headwords (case-insensitive)** | **7,952** | `SELECT COUNT(DISTINCT headword_lower) FROM entries` |
| **Total Word Senses (`ext.senses_ext`)** | **9,006** | `SELECT COUNT(*) FROM senses_ext` |
| **Indexed Morphological & Orthographic Forms** | **3,129** | `SELECT COUNT(*) FROM word_forms` |
| **Entries with Verified Usage Examples** | **186** | Kaikki examples + 13 Tatoeba `fuc` sentences (`0` synthetic `"standard usage."` templates) |
| **Entries with IPA Transcription** | **106** | Kaikki `sounds` + Curated IPA |
| **Entries with Adlam (`𞤀𞤣𞤤𞤢𞤥`) Script Variant** | **118** | Kaikki Adlam forms + Curated Adlam |
| **Orthographic Variant Sets (`word_forms` / ASCII-folded collisions)** | **120** | Exact vs `headword_norm` grouping |
| **Flagged Conflict / Review Entries (`ext.conflict_reviews`)** | **321** | Multi-source gloss divergence + `83` normalized `ď/đ -> ɗ` records |

### Definition Type Breakdown
- `english_gloss`: **8,310** (`99.16%`)
- `bilingual_explanation`: **70** (`0.84%`)
- `fulfulde_monolingual` (without English fallback): **0** (`0.00%`)
- `machine_generated`: **0**

### Source Attribution Breakdown (`entries.source_id`)
- `wikidata-q33454` (`CC0 1.0`): **6,374** primary entries
- `kaikki-en-wikt-ff` (`CC BY-SA 4.0 & GFDL`): **1,937** primary entries
- `lexica-curated-ff` (`CC0 1.0 / Lexica`): **69** primary entries
- `tatoeba-fuc` (`CC BY 2.0 FR / CC BY 4.0`): **13** linked usage sentences
- `ff-wiktionary-incubator`: **0** imported (audited closed/empty)

### Dialect / Variety Distribution (`entries.dialect`)
- `Pan-Fulfulde` (macro-Fula / Adamawa-heavy Wikidata + untagged Kaikki): **7,248**
- `Pular (Futa Jallon)`: **723**
- `Pulaar (Futa Tooro)`: **297**
- `Fulfulde Standard` (Curated): **68**
- `Pular (Futa Jallon), Pulaar (Futa Tooro)` (shared forms): **43**
- `Adamawa / Maasina Fulfulde`: **1**

---

## 2. Storage, Checksums & Performance Benchmarks

| Artifact | Uncompressed Size | Compressed `.db.gz` Size | SHA-256 (Compressed) | Integrity (`PRAGMA quick_check`) |
| :--- | :---: | :---: | :--- | :---: |
| `lexica_fulfulde_core_proto.db(.gz)` | **1,949,696 B** (`1.86 MiB`) | **641,319 B** (`626.3 KiB`) | `a9245f0e498ac269d987f9e9e47182a2b0c97fa848905470df85dc70b3ab5fbe` | **`ok`** |
| `lexica_fulfulde_extended_proto.db(.gz)` | **1,163,264 B** (`1.11 MiB`) | **270,463 B** (`264.1 KiB`) | `31f7e2fadab4214c82ebafb5f65785fdf85a390e2ac041421234b6f93ae952a5` | **`ok`** |

- **Core Uncompressed SHA-256:** `ce1febaeac894747b08dd6ad4b8559250547067062faaf8bd0c3c3ea18ed5c97`
- **Extended Uncompressed SHA-256:** `9234bda06f48a0654673bf90399840a8001d5175621e3bd4708a140513d85f52`
- **Query Benchmarks (100-iteration average on Core SQLite):**
  - Exact headword lookup (`suudu`): **0.0220 ms**
  - Flexible orthography lookup (`cuudi` / `cuuɗi`): **0.0244 ms**
  - FTS5 gloss search (`water`): **0.0371 ms**

---

## 3. Feasibility Conclusion & Pre-Integration Recommendations

1. **Architecturally Ready (Schema v4):** A Fulfulde Core pack under `0.63 MiB` gzipped (`1.86 MiB` uncompressed) and Extended pack under `0.26 MiB` gzipped fits seamlessly inside LEXICA's existing Schema v4 dual-pack downloader and `EnglishPackInstallerPlugin` architecture.
2. **Linguistic Gap & Honest Labelling Requirement:** Because `99.16%` of open-licensed Fulfulde entries currently have English glosses only (`0` external native Fulfulde monolingual definitions), any future Fulfulde Core pack MUST prominently surface the `English gloss only` honesty badge (matching Hausa and Yoruba) and preserve regional dialect tags (`Pular`, `Pulaar`, `Pan-Fulfulde`).
3. **Recommended Next Approval Gates Before Production Integration:**
   - Approve Bamako/NERDC primary orthography (`ɓ`, `ɗ`, `ƴ`, `ŋ`, `ɲ`) + dual strict/flexible orthographic toggle.
   - Commission/author native Nigerian Fulfulde (`fuv`/`fub`) definitions for top-frequency Core lemmas, and seek formal licensing clearance from BUK CSNL / SIL Webonary / Roger Blench if expanded institutional coverage is desired.
   - Production UI integration (`LanguageLibraryScreen`, `dictionaryDatabase`, Android download manifest) remains **intentionally unimplemented** pending review and approval of this audit.
