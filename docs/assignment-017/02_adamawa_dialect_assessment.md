# LEXICA — Assignment 017: Adamawa Dialect Assessment

**Branch:** `feature/assignment-017-fulfulde-validation`
**Scope:** Evaluation of regional variety representation across the Fulfulde Recovery Corpus.

---

## 1. Variety Differentiation Principles

To prevent artificial blending of distinct Sahelian linguistic varieties, LEXICA strictly separates:
1. **Nigerian Adamawa Fulfulde (`nigerian_adamawa`):** Spoken across Adamawa, Taraba, Gombe, and parts of Borno/Bauchi; characterized by specific pastoral and trans-Saharan trade terminology (`Hakkillo`, `Muñal`, `Nagge`, `Kosam`).
2. **Pulaar (`pulaar_futa_tooro`):** Spoken along the Senegal River Valley (Senegal, Mauritania); uses distinct orthographic and lexical forms (e.g., `ñ` instead of `ɲ`, specific greeting variants such as `A jaaraama`).
3. **Pular (`pular_futa_jallon`):** Highland Guinea variety with distinct noun class morphology.
4. **Pan-Fulfulde (`pan_fulfulde`):** Widely attested core lexical items understood across the entire trans-Sahelian continuum without regional divergence (`Gandal`, `Baaba`, `Biɗɗo`).

---

## 2. Assessment Findings

- **Adamawa Focus:** 16 of the 20 entries (`80%`) specifically reflect Nigerian Adamawa usage, preserving pastoral and community concepts central to Northern Nigerian speakers.
- **No Forced Convergence:** Varieties are explicitly distinguished in metadata tables and SQLite schemas (`entries.dialect`) rather than collapsed into a single artificial standard.
- **Recommendation:** Maintain strict variety labelling for all future corpus expansion batches (e.g., marking incoming Sokoto-Gombe entries as `nigerian_sokoto_gombe`).
