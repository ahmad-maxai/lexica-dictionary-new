# LEXICA — Assignment 007: Open Dictionary Datasets, Provenance & Licensing

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  

---

## 1. Current Baseline Dataset Provenance

- **English Prototype Dataset (`v0.2.0` / `v0.3.0`):**  
  Extracted from **English Wiktionary** via **Kaikki.org / Wiktextract** structured JSONL dumps (`https://kaikki.org/dictionary/English/`).
- **Upstream Licenses:** **CC BY-SA 4.0** (Creative Commons Attribution-ShareAlike 4.0 International) and **GFDL** (GNU Free Documentation License).
- **In-Database Provenance:** Every compiled SQLite pack (`A0`, `A1`, `D`) preserves `sources` and `metadata` tables containing `code`, `name`, `license`, `attribution_text`, `source_url`, and `dataset_version`.

---

## 2. Open Data Sources & Legal Redistribution Assessment (All 7 LEXICA Languages)

| Language | Recommended Open Sources | License | Commercial & Offline Android Redistribution |
| :--- | :--- | :--- | :--- |
| **English (`en`)** | Wiktionary via Kaikki/Wiktextract; Princeton **WordNet** (`OED`/OMW); **GCIDE** | CC BY-SA 4.0 (Wiktionary), Princeton WordNet License (permissive), GPL (GCIDE — avoid for closed APK bundling) | **Allowed** with Wiktionary/WordNet attribution & ShareAlike notice for derived lexical packs; avoid GPL GCIDE inside proprietary binaries. |
| **French (`fr`)** | French Wiktionary (`fr.wiktionary.org` / Kaikki), WOLF (Wordnet Libre du Français) | CC BY-SA 4.0 (Wiktionary), CeCILL-C (WOLF) | **Allowed** offline with attribution and ShareAlike compliance on the compiled dictionary pack. |
| **Arabic (`ar`)** | Kaikki/Wiktionary Arabic dumps, Open Multilingual WordNet Arabic (AWN) | CC BY-SA 4.0, BSD-like (OMW) | **Allowed** offline with attribution. |
| **Chinese (`zh`)** | **CC-CEDICT** (`mdbg.net`), Kaikki/Wiktionary Mandarin extracts | **CC BY-SA 4.0** (CC-CEDICT & Wiktionary) | **Allowed** offline with explicit CC-CEDICT & Wiktionary attribution in app About/Legal screen and pack `sources` table. |
| **Hausa (`ha`)** | Wiktionary / Kaikki Hausa extracts, **Masakhane** / African NLP lexicons, university open corpora (verify per-dataset license) | CC BY-SA 4.0 / CC BY 4.0 (varies by corpus; exclude NC/ND corpora) | **Allowed** for CC BY / CC BY-SA datasets; **reject CC BY-NC / non-commercial** academic wordlists. |
| **Yoruba (`yo`)** | Wiktionary / Kaikki Yoruba extracts, Masakhane / Menyo / YorubaLex open lexicons (CC BY / CC BY-SA) | CC BY 4.0 / CC BY-SA 4.0 | **Allowed** when strictly filtered to CC0 / CC BY / CC BY-SA sources. |
| **Fulfulde (`ff`)** | Wiktionary / Kaikki Fula extracts, verified CC BY / CC BY-SA SIL / open community lexicons | CC BY-SA 4.0 / CC BY 4.0 | **Allowed**; sparse open coverage requires careful human/community curation and strict license provenance per entry (`source_id`). |

---

## 3. Compliance Rules for Offline Android Distribution

1. **Mandatory Attribution Surface:** Bundle `sources.attribution_text` and `sources.license` inside every downloadable `.db` pack (`metadata` + `sources` tables) and render them in LEXICA's **About / Legal & Licenses** screen.
2. **ShareAlike Separation:** Because Wiktionary and CC-CEDICT use **CC BY-SA 4.0**, distribute the compiled dictionary database packs as separate data files (or publish the compiler/pack schema under compatible terms) with full source URLs and modification/build dates.
3. **Strict License Gate at Build Time:** Compiler pipelines must reject any dataset carrying `-NC` (NonCommercial), `-ND` (NoDerivatives), or `GPL` restrictions unless explicitly cleared.
