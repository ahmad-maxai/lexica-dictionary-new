# Assignment 012 — Report 2: Yoruba Source-by-Source Linguistic Quality Report

## 1. Introduction
Yoruba is a Niger-Congo tonal language characterized by three distinct lexical/grammatical tones (High `á`, Mid `a` or unmarked, Low `à`) and three mandatory under-dot vowels/consonants (`ẹ`, `ọ`, `ṣ`). Linguistic quality assurance for Yoruba requires strict preservation of diacritics and tone marks to prevent semantic ambiguity.

---

## 2. Linguistic Challenges & Requirements

### A. Tonal Discrimination & Minimum Pairs
Yoruba is replete with tonal minimum pairs where meaning changes entirely based on pitch/tone diacritics:
- *ọ̀rọ̀* (speech / matter / word) vs. *ọ́rọ́* (wealth / riches)
- *òòrùn* (sun) vs. *oòrùn* (odor / smell)
- *gba* (to receive / take) vs. *gbà* (to save / agree)

**Requirement:** The search engine and schema must support both strict diacritic matching (distinguishing tone marks) and normalized fallback matching (ignoring tone accents while retaining under-dots).

### B. Under-Dots & Orthography
- Letters with under-dots (`ẹ` U+1EB9, `ọ` U+1ECD, `ṣ` U+1E63) are distinct phonemes from `e`, `o`, and `s`.
- Silently stripping under-dots during ingestion or search normalization is strictly prohibited, as it destroys lexical validity.

### C. Yoruba-First Definitions vs. English Glosses
- Many open datasets (such as raw machine translation outputs or basic bilingual glossaries) supply English translations (`water`, `house`) and mislabel them as monolingual Yoruba definitions.
- LEXICA's validation pipeline (`yorubaDefinitionValidator.ts`) automatically inspects definition prose, rejecting English glosses misclassified as `yoruba_monolingual` and enforcing proper categorization (`yoruba_monolingual`, `bilingual_explanation`, `english_gloss`).

---

## 3. Source-by-Source Quality Assessment

1. **Yoruba Wiktionary:** High proportion of genuine Yoruba explanations and examples, but prone to editorial inconsistencies, missing tone marks in user-contributed lemmas, and occasional stubs.
2. **Kaikki Extracted Data:** Provides clean structural JSON but requires filtering out English-only glosses and formatting tags.
3. **Wikidata Lexemes:** Highly accurate lemmas and grammatical tags, but lacks rich explanatory sentences.

---

## 4. Summary & Verification Standards
All ingested entries must pass automated validation verifying tone mark integrity, under-dot presence, part-of-speech completeness, and definition type classification.
