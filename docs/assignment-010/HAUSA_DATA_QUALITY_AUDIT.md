# LEXICA Assignment 010 — Hausa Data Quality Audit

**Purpose:** Forensic explanation of why Assignment 009 failed real Hausa lexicography despite reporting 100% definition coverage, compared against verified measurements from the Assignment 010 isolated open-source recovery prototype.

---

## 1. Root Cause Analysis of Assignment 009 Failure

Assignment 009 (`scripts/build_hausa_core_pack.py`, manifest `0.4.0-core`) reported:
- **Total Entries:** `2,260` (`2,013` distinct headwords)
- **Reported Definition Coverage:** `2,260 / 2,260 (100.00%, 0 missing)`

Forensic re-inspection (`scripts/inspect_hausa_sources.py`) of the exact Assignment 009 inputs (`/tmp/kaikki_hausa.jsonl.gz` + `seedDictionary.ts` + `dictionaryData.ts`) establishes three compounding defects:

1. **Wrong Wiktionary Edition Ingested:** `build_hausa_core_pack.py` downloaded `kaikki.org-dictionary-Hausa.jsonl.gz`, which extracts **English Wiktionary (`en.wiktionary.org`)** entries tagged as Hausa. All **`2,192`** populated Kaikki records contain **English translations** (e.g., `"water"`, `"door"`, `"to run"`), **`1`** record (`aiki`) had **empty senses**, and **`0`** Kaikki records contained Hausa-language definitions.
2. **Naive Validation Rule:** Line 92 of `build_hausa_core_pack.py` checked only `any(ch.isalnum() for ch in defn)`—meaning any non-empty ASCII string passed regardless of language or semantic validity.
3. **Silent Placeholder Substitution:** Lines 324–329 and 355 substituted hardcoded placeholder strings (`"Hausa lexical entry."`, `"A given name; (verb/noun: work, labor, job)"`, `"Hausa entry."`) whenever senses were empty.

### Verified Breakdown of Assignment 009 (`2,260` Entries)

| Definition Category | Entry Count | Share of Pack | Real Lexicographic Status |
| :--- | ---: | ---: | :--- |
| Genuine Hausa-to-Hausa explanations (Lexica Curated) | **71** | **3.14%** | Genuine Hausa monolingual + EN |
| English-only glosses misreported as definitions (Kaikki) | **2,188** | **96.81%** | Bilingual gloss only (`0` Hausa prose) |
| Empty sense patched with fallback string (`aiki`) | **1** | **0.04%** | Synthetic fallback |
| **Honest Hausa Monolingual Coverage** | **71 / 2,260** | **3.14%** | **Reported falsely as 100.00%** |

---

## 2. Quality Defects Discovered in Candidate Third-Party Datasets

| Dataset | Rows Inspected | Language & Orthography Findings | Why Unsafe Without Repair |
| :--- | ---: | :--- | :--- |
| `taresco/afri-dict` (`hau_dictionary.csv`) | `4,921` | `4,279` English headwords -> Hausa translations; `0` Hausa monolingual defs | Upstream text is Robinson & Brooks (1900); **`328`** `"see ..."` cross-references; only `39` rows have `ɓ/ɗ/ƙ/ƴ`; archaic/colonial terms (`"aborigines" -> "habe"`). |
| `taresco/afri-dict` (`hau_v1_entries.csv.gz` & `en_hau_v1.csv.gz`) | `1,914` + `1,554` | `100%` `eng -> hau`; `0` Hausa monolingual defs | Pre-standard missionary orthography (`ber(r)i`, `kunia`); only `8` + `5` hooked consonants. |
| `adab-tech/murya-hausa-en-lexicon-robinson1914` | `20,628` | `7,142` EN terms, `10,472` Hausa strings; `0` Hausa monolingual defs | **`0` hooked consonants (`ɓ/ɗ/ƙ/ƴ`)**; **`1,446` `"see ..."` artifacts**; **line-break OCR splits** (e.g., `abandoned -> "profli"` & `"gate"`). |

---

## 3. Isolated Assignment 010 Recovery Prototype Audit (Approved Open Sources Only)

Using `scripts/build_hausa_recovery_prototype.py` (`/tmp/hausa_recovery_v050`), strictly combining **Lexica Curated (`71`) + Native Hausa Wiktionary (`ha.wiktionary.org`, `CC BY-SA 4.0`) + Kaikki EN-Wiktionary (`CC BY-SA 4.0`) + Wikidata Lexemes `Q56475` (`CC0 1.0`) + Tatoeba Hausa Examples (`CC BY 2.0 FR`)**, with all automated Assignment 010 quality gates enforced:

| Measured Metric | Assignment 009 (Production) | Assignment 010 (Isolated Prototype) |
| :--- | ---: | ---: |
| **Total Accepted Entries** | `2,260` | **`10,201`** |
| **Distinct Headwords** | `2,013` | **`9,893`** |
| **Total Senses (Core + Extended)** | `2,832` | **`15,010`** |
| **Inflected / Variant Forms Preserved** | `4,502` | **`5,501`** |
| **Genuine Hausa Monolingual Explanations** | `71` (`3.14%`) | **`8,736` (`85.64%`)** |
| — Pure `hausa_monolingual` | `0` | **`6,180`** |
| — `bilingual_explanation` (Hausa + English) | `71` | **`2,556`** |
| — Explicitly typed `english_gloss` only | `2,188` (hidden as valid defs) | **`1,465`** (explicitly labelled) |
| — `machine_generated` / `unavailable` | `1` hidden placeholder | **`0` / `0`** |
| **Entries with Usage Examples / Proverbs** | `71` | **`6,699`** |
| **Entries with IPA Pronunciation** | `2,214` | **`2,261`** |
| **Entries with Ajami Script Variants (`Q56475`)** | `71` | **`1,316`** |
| **Cross-Source Conflicts Flagged (Non-Auto-Merged)** | `0` (silent overwrite) | **`352`** (`321` entries tagged `conflict_flagged`) |
| **Raw `<ref>` / Template Leaks** | `0` (EN-only) | **`0`** (verified via SQLite test A10.7) |
| **Core SQLite Uncompressed Size** | `663,552 B` (`648.00 KiB`) | **`3,661,824 B` (`3.49 MiB`)** |
| **Core GZIP-9 Download Size** | `303,106 B` (`296.00 KiB`) | **`1,200,005 B` (`1.14 MiB`)** |
| **Extended SQLite Uncompressed / GZIP-9** | `421,888 B` / `138,086 B` | **`2,936,832 B` / `953,230 B`** |
| **Query Latency (Exact / Hooked / Prefix / FTS5)** | `0.031 / 0.023 / 0.068 / 0.045 ms` | **`0.029 / 0.027 / 0.032 / 0.058 ms`** |

*(Full machine-generated JSON report archived at `docs/assignment-010/hausa_recovery_audit_report.json`.)*
