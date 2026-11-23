# Assignment 011 — Hausa Dataset Integrity & Provenance Report (Schema v4)

**Branch:** `feature/assignment-011-hausa-core-integration`  
**Pack ID:** `ha-lexica-schema-v4`  
**Release Tag:** `prototype-ha-core-v0.5.0`  
**Dataset Version:** `2026.11-hausa-schema-v4-v0.5.0`  
**Builder Script:** `scripts/build_hausa_schema_v4.py`  
**SQLite Integrity (`PRAGMA quick_check`):** `ok` (both Core & Extended)

---

## 1. Reproduced Dataset Metrics (Verified Live From SQLite Build)

| Metric | Assignment 010 Baseline | Assignment 011 Built Schema v4 | Notes |
| --- | ---: | ---: | --- |
| Total Entries (`entries`) | 10,201 | **10,201** | Identical vocabulary coverage; zero omitted/fabricated entries |
| Distinct Headwords | 9,893 | **9,893** | Normalized case-insensitively across POS entries |
| Total Senses (`senses_ext`) | 15,010 | **15,010** | Full multi-sense breakdown preserved in Extended DB |
| Word Forms (`word_forms`) | 5,501 | **5,581** | Includes inflections, plurals & Ajami variants |
| `hausa_monolingual` definitions | 6,180 | **6,180** | Verified genuine Hausa explanations only |
| `bilingual_explanation` definitions | 2,556 | **2,556** | Verified Hausa explanation + English translation |
| Combined Hausa Explanations (`%`) | 8,736 (85.64%) | **8,736 (85.64%)** | Strictly excludes English-only glosses |
| `english_gloss` only | 1,465 | **1,465** | Explicitly labeled *"English gloss only"* in UI & DB |
| `machine_generated` | 0 | **0** | Zero LLM-generated or synthetic Hausa explanations |
| `unavailable` | 0 | **0** | Zero empty/stub placeholders |
| Entries with Examples | 6,699 | **6,700** | Multi-sense examples including Tatoeba CC BY 2.0 FR |
| Entries with IPA | 2,261 | **2,261** | Primary IPA in Core + dialect IPAs in Extended |
| Entries with Audio References | Verified subset | **105** | Wikimedia Commons verified `.ogg`/`.mp3` metadata |
| Ajami Script Variants | 1,316 | **1,316** | Indexed in `script_variant` & diacritic-stripped `script_variant_norm` |
| Flagged Cross-Source Conflicts | 352 | **352** | `has_conflict = 1` in Core; competing versions in `ext.conflict_reviews` |

---

## 2. Definition Classification & Verification Integrity

Every record preserves its `definition_type` and `verification_status` without relabeling English translations as Hausa definitions or auto-merging disagreements:

- **`hausa_monolingual` (6,180 entries):** Verified Hausa explanation without English gloss.
- **`bilingual_explanation` (2,556 entries):** Both verified Hausa explanation (`definition_ha`) and English translation (`definition_en`) stored separately and displayed distinctly in the UI.
- **`english_gloss` (1,465 entries):** English translation only; displayed with an explicit badge/notice (`"English translation only — verified Hausa explanation unavailable."`).
- **`verification_status` breakdown:**
  - `community_reviewed`: **9,809**
  - `human_verified`: **71** (Lexica Curated Corpus)
  - `conflict_flagged`: **321** primary (`352` total cross-source conflicts stored in `conflict_reviews`)
- **Markup & Placeholder Audit:** Automated test `A10.7` confirms `0` generic fallback placeholders (`'hausa lexical entry.'`, `'hausa entry.'`, `'kalmar tana nufin'`, `''`) and `0` unstripped `<ref` / `{{` template leaks.

---

## 3. Source Attribution, Licensing & Ƙamusun Hausa Policy

| Source Code | Source Name | License | Primary Entries | Role |
| --- | --- | --- | ---: | --- |
| `hawiktionary` | Hausa Wiktionary (`ha.wiktionary.org`) | CC BY-SA 4.0 & GFDL *(Share-Alike)* | 8,715 | Primary Hausa-to-Hausa definitions, examples & plurals |
| `kaikki-en-wikt` | English Wiktionary via Kaikki.org | CC BY-SA 4.0 & GFDL *(Share-Alike)* | 1,030 | English glosses, IPA, Wikimedia audio refs & inflections |
| `wikidata-q56475` | Wikidata Lexemes (Hausa Q56475) | CC0 1.0 | 385 | Ajami Arabic-script orthographic variants & supplementary glosses |
| `lexica-curated` | Lexica Curated Hausa Corpus | CC0 1.0 / Lexica Project License | 71 | Human-verified bilingual entries, IPA, tone & Ajami variants |
| `tatoeba-hau` | Tatoeba Hausa Sentence Corpus | CC BY 2.0 FR | *(Extended examples)* | Usage example sentences attached to senses in Extended DB |

### Compliance Clarifications
- **Ƙamusun Hausa (CSNL / Bayero University):** **0 entries included.** Written permission from CSNL/HausaNLP is required prior to any future ingestion.
- **License Separation:** Application source code and downloaded offline dictionary data packs retain their own licenses. Wiktionary-derived dictionary data carries CC BY-SA 4.0 & GFDL Share-Alike notices in both `SettingsModal` and `HausaAttributionAndReviewModal`; LEXICA does **not** claim the entire database is under GPL.
