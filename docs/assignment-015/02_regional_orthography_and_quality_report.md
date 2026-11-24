# LEXICA — Assignment 015: Regional Varieties, Orthography Standard & Linguistic Quality Report

**Branch:** `feature/assignment-015-fulfulde-source-audit`

---

## 1. Regional & Variety Coverage Analysis

Fulfulde / Fula / Pulaar (`ff`, Glottolog `fula1264`) forms a trans-Sahelian dialect continuum spanning from Senegal and Guinea to Nigeria, Cameroon, and Sudan. Treating all varieties as an undifferentiated monolith causes silent orthography collisions and mistranslations.

| Region / Variety | ISO 639-3 | Spoken In | Key Linguistic & Orthographic Features | Coverage in Audited Open Data |
| :--- | :--- | :--- | :--- | :--- |
| **Nigerian Fulfulde (Kano-Katsina-Bororo / Sokoto / Gombe)** | `fuv` | Northern Nigeria (Sokoto, Katsina, Kano, Bauchi, Gombe, Taraba) | Uses NERDC / Bamako hooked letters `ɓ`, `ɗ`, `ƴ`, `ŋ`; infinitive often `-go` or `-de`; Arabic loanwords filtered through Hausa/Kanuri | Under-tagged (`0` dedicated Wikidata `Q36459` lexemes), partially inside untagged Wikidata `Q33454` & Kaikki (`aawgo`) |
| **Adamawa Fulfulde** | `fub` | Northeastern Nigeria (Adamawa, Taraba) & Northern Cameroon | Infinitive `-go` (e.g. `aawgo`, `yiɗgo`); `ɲ` vs `ny` orthography; historical St. Croix / Taylor Adamawa dictionary lineage | **~6,300+ lexemes** inside Wikidata `Q33454` (untagged macro-Fula, identified via Adamawa morphology/glosses & `83` Czech `ď`/`đ` OCR artifacts) |
| **Maasina Fulfulde** | `ffm` | Central Mali (Inland Niger Delta) | Infinitive `-de`; `ny` or `ɲ`; strong Bamako 1966 orthographic alignment | Embedded in pan-Fulfulde `Q33454` / curated starter entries |
| **Pulaar (Futa Tooro)** | `fuc` | Senegal, Mauritania, The Gambia | Uses `ñ` (Unicode U+00F1) instead of `ɲ`/`ny`; infinitive `-de`; distinct lexical items (e.g. `ndiyam`, `teneŋ`) | **343** distinct CI headwords in Kaikki + **13** Tatoeba `fuc` sentences |
| **Pular (Futa Jallon)** | `fuf` | Guinea, Sierra Leone, Guinea-Bissau | Uses `ɲ` (or `ny`/`ñ` depending on publisher) + hooked `ɠ` in some Guinean traditions; infinitive `-gol` (e.g. `aadagol`, `jooɗagol`); strong Adlam adoption | **770** distinct CI headwords in Kaikki (largest labelled subset in Wiktionary) |

---

## 2. Primary Orthographic Standard Decision

For the initial LEXICA Fulfulde Core pack, the documented **Primary Orthographic Standard** is:

> **UNESCO Bamako (1966) & Nigerian NERDC Fulfulde Latin Orthography**

### Normative Character & Indexing Rules
1. **Implosive / Hooked & Nasal Consonants (Preserved — Never Stripped in Exact Mode):**
   - `ɓ` / `Ɓ` (bilabial implosive)
   - `ɗ` / `Ɗ` (alveolar implosive)
   - `ƴ` / `Ƴ` (palatalized glottal / implosive; regional `'y` in older Nigerian Hausa-influenced print)
   - `ŋ` / `Ŋ` (velar nasal)
   - `ɲ` / `Ɲ` (palatal nasal; Nigerian NERDC frequently writes `ny`, whereas Pulaar writes `ñ` — all three are indexed via `word_forms` and flexible search without merging headwords)
2. **Prenasalized Consonants:** `mb`, `nd`, `ng`, `nj` preserved verbatim.
3. **Vowel Length (Phonemic):** Doubled vowels (`aa`, `ee`, `ii`, `oo`, `uu`) are contrastive in Fulfulde (e.g., *waɗude* vs *waaɗude*) and **MUST NOT** be collapsed. Unlike Yoruba, Fulfulde does not carry lexical tone marks (`á`, `à`), so vowel length and hooked consonants carry primary lexical contrast.
4. **Adlam (`𞤀𞤣𞤤𞤢𞤥`, U+1E900–U+1E95F) & Ajami:** Preserved in `entries.script_variant` and `word_forms` as first-class secondary script links (`118` entries in the prototype carry Adlam script variants across curated + Kaikki extracts).
5. **Regional Variant Preservation (No Silent Merging):**
   - Pular (`-gol`), Pulaar (`ñ`), and Nigerian/Adamawa (`-go`, `'y`) forms remain separately labelled in `entries.dialect` and linked via `word_forms` / `conflict_reviews`.
6. **Discovery & Repair of Legacy `ď`/`đ` Substitution Artifacts:**
   - **83** Wikidata `wd:Q33454` headwords (e.g., `Ba'eteeďi`, `Ba'ateeđum`, `Ba'iiďo`, `Ba'irteeďum`) encoded implosive `ɗ` using Czech/Croatian `ď` (U+010F) or `đ` (U+0111).
   - Our pipeline normalizes the primary searchable headword to canonical Bamako/NERDC `ɗ` (`Ba'eteeɗi`), retains the raw `ď`/`đ` string inside `word_forms` for compatibility, and flags the entry in `ext.conflict_reviews` (`has_conflict = 1`) for linguist confirmation.

---

## 3. Linguistic Quality & Definition Classification Rules

Implemented in `/src/services/fulfuldeDefinitionValidator.ts` and `/scripts/build_fulfulde_prototype_v4.py`:

| Classification | Definition | Prototype Yield | Rule Applied |
| :--- | :--- | :---: | :--- |
| `fulfulde_monolingual` | Definition written exclusively in Fulfulde / Pulaar / Pular | **0** | Must contain genuine Fulfulde lexical prose and fail `looksLikeEnglishOnlyFulfulde()` |
| `bilingual_explanation` | Verified Fulfulde explanation + English gloss/explanation kept in separate fields (`definition_ff`, `definition_en`) | **70** | `68` curated bilingual starter explanations + `2` Wikidata bilingual entries (`altine`, `dada`) |
| `english_gloss` | English translation/gloss only (`definition_ff = NULL`) | **8,310** | Never counted as Fulfulde monolingual; clearly badged `English gloss only` in UI |
| `machine_generated` | Unverified MT/LLM text | **0** | Explicitly excluded from verified lexical statistics |
| `unavailable` | Empty, placeholder (`n/a`, `tbd`, `the`, `same as`, `see ...`), or reversed English lemmas | **527 rejected** | `515` glossless/stub records + `12` junk/reversed entries (including English lemmas `Be` -> `nanndude` and `Visitor` -> `Kodo`) rejected prior to DB insertion |

### Notable Quality Corrections Caught During Audit
- **Reclassified English-Mislabeled Curated Entry:** `Hakkillo` in `src/data/dictionaryData.ts` placed English text (`"Mind, intellect, prudence..."`) inside the `definition` field; our validator automatically detected English-only syntax and reclassified it as `english_gloss`.
- **Rejected Reversed Wikidata Entries:** Wikidata `L1742947` (`lemma="Visitor"`, `ff gloss="Kodo"`) and `Be` (`ff gloss="nanndude"`) had reversed English lemmas and were filtered out rather than miscounted as `fulfulde_monolingual`.
- **Rejected Incomplete Cross-Reference Stubs:** Entries whose sole gloss was `"Same as"` (`Ba'atal`) or `"The"` were excluded from accepted entries.
