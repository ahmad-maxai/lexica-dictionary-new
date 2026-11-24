# LEXICA — Assignment 017: Orthography, IPA and Adlam Audit

**Branch:** `feature/assignment-017-fulfulde-validation`
**Scope:** Verification of special characters, IPA consistency, and Adlam representations.

---

## 1. Orthographic Compliance

The recovery corpus strictly enforces the **UNESCO Bamako (1966) & Nigerian NERDC Fulfulde Latin Orthography**:
- **Hooked / Implosive & Nasal Consonants:** `ɓ`, `ɗ`, `ƴ`, `ŋ`, `ɲ` are fully preserved without substitution or ASCII degradation.
- **Vowel Length:** Phonemic doubled long vowels (`aa`, `ee`, `ii`, `oo`, `uu`) are preserved.
- **Normalization & Search:** The flexible search normalizer (`normalize_flexible`) maps hooked consonants and diacritics to ASCII skeletons for tolerant lookup while preserving exact Unicode strings in primary display fields.

---

## 2. IPA and Adlam Verification

- **IPA:** Transcriptions follow standard West African IPA conventions matching regional phonology (e.g., `/hak.kil.lo/` for *Hakkillo*, `/mu.ɲal/` for *Muñal*, `/naː.ŋe/` for *Naange*).
- **Adlam (`𞤀𞤣𞤤𞤢𞤥`):** Curated Adlam representations are correctly encoded using Unicode Adlam code points (`U+1E900`–`U+1E95F`) and stored in `headwordScriptVariant`.
