# Assignment 012 — Report 8: Risks, Unresolved Licensing Questions and Next-Step Recommendations

## 1. Identified Risks & Challenges
1. **Tone Mark Inconsistencies:** Community-contributed Wiktionary entries frequently omit tone marks or under-dots on secondary headwords. Automated heuristics must flag ambiguous entries for manual curation.
2. **Attribution Complexity:** Combining multiple sources (Wiktionary, Wikidata, Tatoeba) requires clear multi-source attribution strings in the application UI without cluttering user experience.
3. **Storage Constraints on Mobile:** While compressed package size (~2.1 MB) is small, low-end Android devices require robust download resume logic and checksum verification.

---

## 2. Unresolved Licensing Questions
- Certain academic corpora require institutional data sharing agreements. Until granted, integration is strictly limited to openly licensed CC BY-SA 4.0 (Wiktionary/Kaikki) and CC0 (Wikidata) datasets.

---

## 3. Next-Step Recommendations
1. **Proceed to Implementation:** With the source audit, linguistic quality framework, and Schema v4 architecture validated, Yoruba is **fully ready for integration** in a subsequent implementation assignment.
2. **Build Pipeline Scripting:** Develop automated SQLite database builders mirroring the Hausa pack generation scripts.
3. **UI Integration:** Ensure the UI correctly renders tone diacritics and under-dots (`ẹ`, `ọ`, `ṣ`).
