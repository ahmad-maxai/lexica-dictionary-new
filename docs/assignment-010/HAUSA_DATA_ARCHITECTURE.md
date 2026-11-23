# LEXICA Assignment 010 — Hausa Lexicography Data Architecture

**Implementation Reference:** `src/services/hausaDefinitionValidator.ts`  
**Storage Foundation:** Preserves Assignment 008/009 Architecture D (layered Core + optional Extended SQLite `.db.gz` downloaded to persistent `noBackupFilesDir`).

---

## 1. Canonical 12-Field Record Schema (`HausaLexicographyRecord`)

Every Hausa lexical record entering LEXICA pipelines must conform to these 12 core fields plus explicit verification/conflict tracking metadata:

| # | Field | SQLite Layer | Type & Purpose |
|---:|---|---|---|
| 1 | `headword` | Core (`entries`) | Canonical orthography with standard Nigerian Boko hooked letters (`ɓ, ɗ, ƙ, ƴ`) and optional tone/length markers |
| 2 | `normalizedHeadword` | Core (`headword_norm`) | Deep-normalized lookup form (`ɓ→b, ɗ→d, ƙ→k, ƴ→y`, diacritics stripped) matching `TextNormalization.normalizeLatin()` |
| 3 | `scriptVariant` | Core (`entries` + `word_forms`) | Ajami Arabic-script orthographic equivalent (e.g., sourced from `Wikidata Q56475` or curated entries) |
| 4 | `partOfSpeech` | Core (`parts_of_speech`) | Normalized grammatical category (`noun`, `verb`, `adjective`, `adverb`, `pronoun`, `interjection`, etc.) |
| 5 | `definitionHa` | Core (`entries.definition_ha`) | **Authentic Hausa-to-Hausa explanation ONLY** (`NULL` if unavailable — never backfilled with English or placeholders) |
| 6 | `definitionEn` | Core (`entries.definition_en`) | English gloss / translation when legitimately sourced (`NULL` if monolingual-only) |
| 7 | `definitionType` | Core (`entries.definition_type`) | Mandatory enum: `'hausa_monolingual' \| 'english_gloss' \| 'bilingual_explanation' \| 'machine_generated' \| 'unavailable'` |
| 8 | `examples` | Extended (`senses_ext`) | Verified Hausa usage sentences and `Karin magana` proverbs (e.g., `ha.wiktionary.org` Misali + Tatoeba `CC BY 2.0 FR`) |
| 9 | `pronunciation` | Core (`primary_ipa`) / Ext (`all_ipas`) | Phonetic IPA transcription (preserved largely from Kaikki EN-Wiktionary `2,261+` entries) |
| 10 | `relatedWords` | Core (`word_forms`) / Ext | Inflected plurals (`jam'i`), feminine forms, possessed forms, and Ajami variants |
| 11 | `source` | Core (`sources`) + Ext (`senses_ext`) | Exact dataset identifier & official URL (e.g., `hawiktionary`, `kaikki-en-wikt`, `wikidata-q56475`, `tatoeba-hau`) |
| 12 | `license` | Core (`sources.license`) | Exact versioned licence string (`CC BY-SA 4.0 & GFDL`, `CC0 1.0`, `CC BY 2.0 FR`) |

---

## 2. Explicit Definition-Type Taxonomy & Display Rules

1. **`hausa_monolingual`**: Human-authored Hausa-to-Hausa explanation (`definitionHa != null`, `definitionEn == null`). Eligible for verified Hausa dictionary counts.
2. **`bilingual_explanation`**: Both authentic `definitionHa` AND complementary `definitionEn` translation exist. Ideal user-facing dictionary state.
3. **`english_gloss`**: Only `definitionEn` exists (`definitionHa == null`, e.g., Kaikki-only entries). Displayed honestly in the UI with an explicit **"English translation only (Hausa explanation pending)"** badge — **never** counted toward Hausa monolingual coverage.
4. **`machine_generated`**: Drafted or translated automatically. Strictly isolated; **prohibited** from verified human-authored counts and excluded from Core production packs until reviewed and reclassified by a native Hausa linguist.
5. **`unavailable`**: Empty, stub (`Kalmar tana nufin`), cross-reference (`see ...`), or generic fallback (`Hausa lexical entry.`). Rejected from production Core admission.

---

## 3. Non-Auto-Merge Conflict Policy & Native Review Workflow

- **Never Auto-Overwrite:** When two approved sources supply differing parts of speech or non-overlapping Hausa definitions for the same `(headword_lower, pos)`, `evaluateSourceConflicts()` preserves **all** source-attributed senses in `senses_ext` and flags `has_conflict = 1` / `verification_status = 'conflict_flagged'` (`352` entries flagged in the prototype).
- **Automated Gate (`hausaDefinitionValidator.ts`):**
  1. Rejects generic placeholders, markup leaks (`<ref>`, `{{...}}`), and OCR hyphenation splits (`profli- gate`).
  2. Runs language-integrity detection (`looksLikeEnglishOnlyGloss`) so English glosses can never enter `definitionHa`.
  3. Enforces per-record `source` and `license` presence.
- **Native Review Workflow (Tier Promotion):**
  - `unverified_import` → **automated filter (`validateHausaDefinition`)** → `community_reviewed` (Wiktionary/Wikidata) → **native Hausa linguist sign-off** → `human_verified`.
