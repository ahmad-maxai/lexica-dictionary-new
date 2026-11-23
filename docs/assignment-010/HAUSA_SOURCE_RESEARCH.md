# LEXICA Assignment 010 — Hausa Dictionary Source Research

**Audit Scope:** Independent investigation of legitimate Hausa lexicographic, academic, Wikimedia, and historical datasets.  
**Non-Negotiable Rule:** No copyrighted website scraping, no bypass of access controls, no treatment of English glosses as Hausa definitions, and no fabrication of vocabulary counts or licences.

---

## 1. Source A — Ƙamusun Hausa (HausaNLP / CSNL, Bayero University, Kano)

- **URLs Inspected:** `https://kamusunhausa.hausanlp.org/`, `https://kamusunhausa.hausanlp.org/about-us`, `https://github.com/hausanlp`
- **Institutional Owners & Stewards:** Centre for Research in Nigerian Languages, Translation, and Folklore (CRNLT&F, formerly CSNL), Bayero University, Kano (BUK), in partnership with the HausaNLP Research Group (Department of Computing, BUK).
- **Verified Background:** Digitization of the landmark 1990s CSNL Hausa-to-Hausa monolingual dictionary into a Next.js web application (~2020s). Includes authentic Hausa-to-Hausa explanations, parts of speech, grammatical gender/plurality notes, and dialectal usage.
- **Public Dataset / API Availability:** **None.** The website renders dynamically via Next.js endpoints with no public bulk export, JSON/CSV archive, or documented public API.
- **Licensing Audit:** Although UI/application repositories under `github.com/hausanlp` contain open-source code licences (MIT), **no open-data licence (CC BY, CC BY-SA, CC0, etc.) is granted for the dictionary lexical database**. Website availability does not grant permission for offline redistribution, SQLite transformation, or commercial packaging.
- **Contact Information Found:** `hausanlp@gmail.com`; Dr. Shamsuddeen Hassan Muhammad (`shamsuddeen2004@gmail.com`).
- **Decision:** **Permission required.** Ready-to-send email drafted in `docs/assignment-010/HAUSA_PERMISSION_REQUEST.md` (not sent automatically). Zero entries imported.

---

## 2. Source B — Afri-Dict (`taresco/afri-dict`)

- **URL Inspected:** `https://huggingface.co/datasets/taresco/afri-dict`
- **Files Downloaded & Audited (`/tmp/audit_sources/afri_dict/`):**
  - `hau_dictionary.csv` (`339,685 B`): **4,921 rows**, **4,279 unique English headwords**.
  - `hau_v1_entries.csv.gz` (`219,911 B`): **1,914 rows**, **1,875 unique English headwords** (`1,181` `verified_against_printed_source`, `733` `corrected_from_printed_source`).
  - `en_hau_v1.csv.gz` (`208,237 B`): **1,554 rows**, **1,554 unique English headwords** (`source_audited_historical_candidate`).
- **Critical Forensic Findings:**
  1. **Translation Direction Misconception:** Every row inspected across all three Hausa files has **`language = eng`** (English headword) mapping to **`target_language = hau`** (Hausa equivalent gloss). It is an **English-to-Hausa bilingual list**, **not** a Hausa-to-Hausa monolingual dictionary (`0` Hausa monolingual explanations).
  2. **Actual Upstream Source:** Inspection of `entry_json` and printed edition metadata identifies the underlying text as **Robinson & Brooks (1900) Vol. II (`robinson-brooks-hausa-vol2-1900`)**.
  3. **Orthographic & Structural Defects:** Uses pre-standard missionary spelling (`ber(r)i`, `kunia`, `mugunia`), largely lacks standard Nigerian Boko hooked consonants (`ɓ`, `ɗ`, `ƙ`, `ƴ` appear in only `39` rows of `hau_dictionary.csv` and `8` rows of `hau_v1_entries.csv.gz`), contains **`328` `"see ..."` cross-reference stubs** instead of definitions, and retains archaic/offensive colonial glosses (e.g., `"aborigines" -> "habe"`).
  4. **MIT Licence Nuance:** While the Hugging Face card declares `MIT` and the underlying 1900 printed book is out of copyright globally, modern audit JSON fields and schema provenance warrant caution before redistribution without normalization and native Hausa review.
- **Decision:** **Rejected** for Hausa monolingual dictionary use; **Restricted** strictly as a secondary historical English-to-Hausa candidate pending orthographic modernization and human editorial review.

---

## 3. Source C — Robinson's Dictionary of the Hausa Language (1913 / 1914)

- **Internet Archive Verification:**
  - Vol. I (Hausa–English, 3rd ed., 1913): `archive.org/details/dictionaryofhaus01robiuoft` — marked `possible-copyright-status: NOT_IN_COPYRIGHT`.
  - Vol. II (English–Hausa, 3rd ed., 1914): `archive.org/details/dictionaryofhaus02robiuoft` — marked `possible-copyright-status: NOT_IN_COPYRIGHT`.
  - Author Charles Henry Robinson died in **1925** (public domain globally under life+70 and pre-1923 US/international rules).
- **Digital Derivative Audited (`adab-tech/murya-hausa-en-lexicon-robinson1914`):**
  - `en_ha_pairs.jsonl` (`3,318,650 B`): **20,628 rows**, **7,142 unique English terms**, **10,472 unique Hausa strings**.
  - **Measured Defects:** **`0` rows contain hooked consonants (`ɓ, ɗ, ƙ, ƴ`)**; **`1,446` rows contain `"see ..."` cross-reference artifacts**; **`28` sample line-break hyphenation splits** (e.g. `abandoned -> "profli"`, `"gate"` extracted from `"see profli- gate."`, or `"rami"` misparsed as English). Contains **`0` Hausa monolingual explanations**.
- **Decision:** **Restricted.** Approved only as historical public-domain English→Hausa reference text **after** OCR re-parsing from clean page scans and orthographic modernization by native Hausa reviewers. Not safe for direct Core Pack ingestion.

---

## 4. Source D — Hausa Wiktionary & Kaikki

### D1. Kaikki.org English-Wiktionary Hausa (`kaikki.org-dictionary-Hausa.jsonl.gz`)
- **Measured Yield:** `2,193` raw records (`1,977` unique headwords), `2,146` with IPA (`97.86%`), `4,408` word forms.
- **Licence:** **CC BY-SA 4.0 & GFDL** (Wikimedia Contributors & Tatu Ylönen / Wiktextract).
- **Critical Limitation:** **`2,192` English-gloss-only records + `1` empty sense (`aiki`) + `0` Hausa-to-Hausa explanations.** Assignment 009 incorrectly relied on this as its main source.
- **Decision:** **Approved strictly for IPA, inflected `word_forms`, etymology, and English glosses (`definitionType = 'english_gloss'`).**

### D2. Native Hausa-Language Wiktionary (`ha.wiktionary.org`)
- **Dump Audited:** `hawiktionary-latest-pages-articles.xml.bz2` (`1,397,679 B`, Wikimedia public XML dump).
- **Measured Yield:**
  - `9,445` ns=0 pages (`348` redirects, `9,097` non-redirect pages).
  - Excluding foreign-language-only pages (`== Larabci ==`, `== Turanci ==`, `== Faransanci ==`) and empty/placeholder stubs (`11` pages like `Kalmar tana nufin`), **`8,715` primary entries (`8,746` POS-keyed parsed entries) contain genuine Hausa-to-Hausa explanations**, plus **`1,167+` `Turanci:` English translations** and **`2,709+` native usage examples / `Karin magana` proverbs**.
- **Licence & Compliance Audit:** **CC BY-SA 4.0 & GFDL**. Inline `<ref>` citations frequently cite printed works (*Bargery*, *Newman*, *Skinner*, *kamus.com.ng* — `3,764` pages cite Bargery/Newman/Skinner and `621` cite `kamus.com.ng` as bibliographical references). Under Wikimedia licensing, short factual definitions and contributor-written Hausa prose are CC BY-SA 4.0, provided raw `<ref>` / template markup is stripped cleanly, derivative SQLite data packs retain **CC BY-SA 4.0** Share-Alike licensing + attribution, and community-authored spellings undergo native QA review.
- **Decision:** **Approved** as the primary open-licensed source of genuine Hausa monolingual explanations in the Assignment 010 isolated prototype.

---

## 5. Source E — Additional Sources Audited

1. **Wikidata Lexemes (`wd:Q56475`) — APPROVED (`CC0 1.0`)**
   - `1,782` unique lexemes (`1,699` unique Latin lemmas, **`1,215` unique Ajami Arabic-script lemmas**, `48` lexemes with Hausa glosses, `1,627` with English glosses). Provides the highest-integrity open Ajami orthography mapping available.
2. **Tatoeba Hausa Corpus (`hau_sentences.tsv.bz2`) — APPROVED (`CC BY 2.0 FR`, Extended Pack Examples)**
   - **`21,850` authentic Hausa sentences** (`5,339` using hooked consonants `ɓ, ɗ, ƙ, ƴ`). Suitable strictly for optional Extended DB usage examples with Tatoeba attribution.
3. **Lexica Curated Hausa Corpus (`seedDictionary.ts` + `dictionaryData.ts`) — APPROVED (`CC0 1.0 / Project MIT`)**
   - `71` verified Hausa entries with human-authored Hausa explanations, English glosses, Ajami variants, IPA, and examples.
4. **PanLex — RESTRICTED**
   - PanLex database snapshots carry CC0 1.0 for metadata structure, but individual translation pairs inherit hundreds of upstream dictionary licences, many All Rights Reserved or NC. Cannot be imported wholesale without strict per-`src` open-license whitelisting.
5. **G. P. Bargery (1934) / *e-Bargery* — REJECTED**
   - George Percy Bargery died in **1966**; copyright remains active through end of **2036** under 70 years *post mortem auctoris*, alongside Oxford University Press and electronic database rights.
6. **Paul Newman (2007/2021), Roxana Ma Newman (1997/2012), Neil Skinner (1965/2007), CSNL (2006), `kamus.com.ng` (2014–2026) — REJECTED**
   - All Rights Reserved commercial print or proprietary web dictionaries without redistribution rights.
7. **`HausaNLP/Naija-Lex` (`CC BY-NC-SA 4.0`) — REJECTED**
   - NonCommercial clause conflicts with general distribution, and content consists of sentiment wordlists rather than dictionary definitions.
8. **`mangaphd/hausa_aug_lex` (`CC BY-ND 4.0`) — REJECTED**
   - NoDerivatives licence prohibits restructuring entries into LEXICA's layered SQLite schema.
