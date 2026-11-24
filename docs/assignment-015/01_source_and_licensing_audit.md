# LEXICA — Assignment 015: Fulfulde Source Audit & Licensing Matrix

**Branch:** `feature/assignment-015-fulfulde-source-audit`
**Scope:** Independent empirical discovery and licensing audit for Fulfulde / Fula (`ff`). No production files or existing Yoruba/Hausa/English language packs were modified.

---

## 1. Executive Summary

Publicly accessible does **not** mean legally open-licensed for offline mobile redistribution. Across all audited Wikimedia, academic, institutional, and community Fulfulde resources:

1. **No standalone Fulfulde Wiktionary exists.** `ff.wiktionary.org` is closed/non-existent, and Wikimedia Incubator (`Wt/fuf` Pular) holds only **3** test pages (`Wt/fuf/aar`, `Wt/fuf/jooɗi`, `Wt/fuf/yahi`), while Nigerian Fulfulde incubators (`Wt/fuv`, `Wt/fub`, `Wt/ff`) hold **0** pages.
2. **Approved open-licensed lexicographic sources yield 8,380 unique keyed entries (7,952 distinct headwords)** in an isolated Schema v4 prototype:
   - **Kaikki.org English Wiktionary (`Fula`)** (`CC BY-SA 4.0 & GFDL`): **1,992** raw records (`1,926` distinct case-sensitive headwords, `1,920` case-insensitive), predominantly Pular (`814` tags / `770` headwords) and Pulaar (`358` tags / `343` headwords), plus `862` untagged macro-Fula entries.
   - **Wikidata Lexemes (`wd:Q33454` Fula)** (`CC0 1.0`): **7,871** total lexemes (`6,803` distinct case-insensitive lemmas, `7,487` with glosses), yielding **6,642** clean keyed entries after rejecting `515` glossless/stub records and `12` reversed/junk records. Critically, **83** lexemes exhibit non-standard Czech `ď`/`đ` substitution artifacts for implosive `ɗ` (likely legacy Adamawa print digitization), requiring Bamako/NERDC normalization and review flagging.
   - **Lexica Curated Fulfulde Starter Corpus** (`CC0 1.0 / Lexica Project License`): **70** starter entries (**68** verified bilingual explanations + **1** English-only explanation `Hakkillo` + **1** regional variant).
   - **Tatoeba (`fuc` Pulaar)** (`CC BY 2.0 FR / CC BY 4.0`): **13** verified sentences (`fuv` Nigerian Fulfulde has **0** sentences; other ISO codes like `fub`/`fuf`/`ffm` are unsupported by Tatoeba's search filter and fall back to default multi-language paging).
3. **Critical Quality Finding:** Across all external open sources, there are **0 standalone `fulfulde_monolingual` definitions** (`99.16%` of external entries are `english_gloss` only, with `2` Wikidata bilingual synonym entries `altine` and `dada`, plus `68` curated bilingual starter explanations).
4. **Proprietary / Excluded Nigerian & Regional Works:** Major Nigerian Fulfulde references — Bayero University Kano CSNL *Fulfulde–English Dictionary*, SIL Webonary *Fulfulde–French–English Dictionary (Burkina Faso)* (`11,400+` entries), and Roger Blench / Kay Williamson Educational Foundation draft wordlists without explicit open redistribution permission — are **excluded** pending written licensing clearance.

---

## 2. Verified Source & Licensing Matrix

| Source | Exact URL & Edition | License & Attribution Requirements | Commercial / Modification Permitted? | Empirical Yield | Definition Language | Audit Decision |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fula Wiktionary (`ff.wiktionary.org`)** | `https://ff.wiktionary.org/` | CC BY-SA 4.0 & GFDL (if existed) | N/A | **0** pages (site closed / non-existent) | N/A | **Audited — 0 usable entries** |
| **Wikimedia Incubator (`Wt/fuf`, `Wt/fuv`, `Wt/fub`)** | `https://incubator.wikimedia.org/wiki/Wt/fuf` | CC BY-SA 4.0 & GFDL | Yes (with ShareAlike attribution) | `Wt/fuf`: **3** pages (`aar`, `jooɗi`, `yahi`); `Wt/fuv`, `Wt/fub`, `Wt/ff`, `Wt/fuc`, `Wt/ffm`: **0** pages | English/French stubs | **Audited — Excluded (negligible test stubs)** |
| **Fula Wikipedia (`ff.wikipedia.org`)** | `https://ff.wikipedia.org/` | CC BY-SA 4.0 | Yes (with attribution & ShareAlike) | `22,840` articles (`32` active users) | Encyclopedic Fulfulde prose (not structured lexicography) | **Reference corpus only (not dictionary definitions)** |
| **English Wiktionary (`Fula`) via Kaikki.org** | `https://kaikki.org/dictionary/Fula/kaikki.org-dictionary-Fula.jsonl` (`en.wiktionary.org` `Category:Fula_lemmas`: `1,889` pages) | **CC BY-SA 4.0 & GFDL** (Wikimedia Contributors & Kaikki.org / Wiktextract attribution) | **Yes** (with ShareAlike & attribution) | **1,992** raw records -> **1,972** keyed entries (**1,920** distinct CI headwords, `42` IPA, `1,298` with forms, `157` w/ examples) | `english_gloss` (`100%`) | **APPROVED (Core & Extended)** |
| **French Wiktionary (`peul` / `pulaar`)** | `https://fr.wiktionary.org/wiki/Catégorie:peul` (`777` pages) & `Catégorie:pulaar` (`18` pages) | **CC BY-SA 4.0 & GFDL** | **Yes** (with ShareAlike & attribution) | `777` + `18` pages (French glosses) | French glosses | **Audited — Defer (Phase 2 French/bilingual enrichment)** |
| **Wikidata Lexemes (`wd:Q33454` Fula)** | `https://www.wikidata.org/` SPARQL `wd:Q33454` (tested `Q36459` Nigerian, `Q35723` Adamawa, `Q36186` Pulaar -> `0` items) | **CC0 1.0 Public Domain** | **Yes** (no restrictions) | **7,871** raw lexemes -> **6,642** clean keyed entries (`515` no-gloss & `12` reversed/junk rejected; `83` `ď/đ` artifacts repaired) | `99.97%` `english_gloss`, `2` bilingual syn/gloss (`altine`, `dada`) | **APPROVED with strict sanitization & conflict flagging** |
| **Tatoeba Fulfulde (`fuc`, `fuv`)** | `https://tatoeba.org/` API v0 (`from=fuc`, `from=fuv`) | **CC BY 2.0 FR / CC BY 4.0** (attribution required) | **Yes** (with attribution) | `fuc` (Pulaar): **13** sentences; `fuv` (Nigerian Fulfulde): **0** sentences | Usage sentences + English translations | **APPROVED (`fuc` 13 sentences as labelled examples)** |
| **Lexica Curated Starter Corpus** | `src/data/seedDictionary.ts` & `src/data/dictionaryData.ts` | **CC0 1.0 / Lexica Project License** | **Yes** | **70** entries (**68** bilingual, **1** English-only `Hakkillo`, **1** Adamawa/Maasina variant) | `bilingual_explanation` (`68`) + `english_gloss` (`1`) | **APPROVED** |
| **IDS / Lexibank (CLLD)** | `https://ids.clld.org/` / Lexibank comparative datasets | **CC BY 4.0** | **Yes** (with attribution) | Small comparative concept wordlists (e.g. Bangime/Fulfulde contact concepts) | Concept glosses only | **Audited — Optional comparative supplement** |
| **Bayero Univ. Kano CSNL *Fulfulde–English Dictionary*** | St. Croix / Daudu, Abu-Manga, Mukoshy, McIntosh (1998) | **All Rights Reserved / Institutional Copyright (CSNL / BUK)** | **No** (requires formal institutional permission) | Not scraped | Bilingual | **EXCLUDED (License barrier)** |
| **SIL Webonary (*Fulfulde–French–English Burkina Faso*)** | `https://www.webonary.org/fulfuldeburkina/` | **Copyrighted SIL / Burkina Langues project** (no open CC license declared; HTTP 403 automated fetch) | **No** (without explicit written SIL license) | `~11,400` entries reported publicly | Trilingual | **EXCLUDED (License barrier)** |
| **Roger Blench / KWEF Fulfulde Wordlists** | Adamawa Fulfulde wordlists | Author copyright / restricted draft terms unless explicitly licensed CC BY | Unverified for bulk redistribution | Wordlist manuscripts | Glosses | **EXCLUDED pending explicit license verification** |
