# Assignment 008 — Core Primary Definition & Coverage Audit Report

**Generator:** `scripts/build_english_core_pack.py`  
**Machine-Readable Report:** [`core_audit_report.json`](./core_audit_report.json)  
**Source Corpus:** Canonical 75,000-entry English Wiktionary (Kaikki/Wiktextract) dataset (`v0.3.0`)

---

## 1. Required Completeness Metrics

| Audit Metric | Verified Value | Notes |
| :--- | :--- | :--- |
| **Total entries** | **`75,000`** | Zero accepted entries dropped or merged away |
| **Entries with valid primary definitions** | **`75,000` (`100.0%`)** | Every entry has a non-empty cleaned `primary_definition` |
| **Entries missing definitions** | **`0` (`0.0%`)** | Verified cleanly in SQL build and test assertions |
| **Word forms preserved** | **`134,837` (`100.0%`)** | All inflected/alternative forms from canonical dataset |
| **IPA coverage** | **`50,902` (`67.87%`)** | Matches exact canonical primary-IPA coverage |
| **Search-index integrity** | **Verified (`PASS`)** | `PRAGMA integrity_check = ok`, `foreign_key_check = 0 errors`, FTS5 `knowledge` = `129` hits, `regime` -> `régime` |
| **Distinct lowercase headwords** | **`45,317`** | Matches Assignment 006 / 007 baseline |
| **Normalization collision groups** | **`153` groups** | Diacritic & apostrophe fold collisions (e.g., `regime`/`régime`, `its`/`it's`, `'a`/`a`/`ä`) |

---

## 2. Smart Primary-Definition Selection Policy (Why Blind Sense #1 Is Avoided — and Why Naive Regexes Are Unsafe)

During audit of the 75,000 accepted entries (`190,672` senses):
- **`5,651` entries** have *only* cross-reference/inflection glosses across all senses (e.g., `"Plural of ..."`, `"Simple past tense and past participle of ..."`), meaning those glosses *are* the valid dictionary meaning for inflected headwords (`done`, `went`, `teeth`) or initialisms (`FBI`, `USA`).
- A naive regex rejecting every `"Alternative form of..."` or `"Initialism of..."` at Sense #1 was rejected because it would accidentally demote common primary meanings (e.g., `blonde`, `FBI`).

**Implemented Audited Heuristic:**
1. Clean markup/placeholder artifacts across candidate senses (e.g., empty wiki-links `"[[]]"` -> cleaned across **`23` entries**, including `"Ally"`).
2. Accept Sense #1 when it is valid and NOT a weak archaic/obsolete/dated/nonstandard/eye-dialect/pronunciation-spelling stub (`"Obsolete spelling of..."`, `"Archaic form of..."`, `"Eye dialect spelling of..."`, `"Pronunciation spelling of..."`, `"Nonstandard spelling of..."`), OR when no non-stub sense follows it.
3. Promote the earliest later sense whenever Sense #1 is empty/unusable OR is one of those weak stub cross-references AND a substantive non-stub sense exists later in the entry.

### Audit Selection Breakdown

| Selection Path | Count | Meaning |
| :--- | :--- | :--- |
| **`sense_1_direct`** | **`74,288`** | Valid non-crossref Sense #1 selected directly |
| **`sense_1_crossref_only`** | **`670`** | Valid inflection/cross-reference Sense #1 with no better candidate |
| **`promoted_over_weak_stub_sense_1`** | **`42`** | Substantive Sense #2+ promoted over obsolete/archaic/eye-dialect Sense #1 |
| **Data lost** | **`0`** | Full 190,672 senses preserved inside optional Extended pack (`34,352` entries have `extra_senses_count > 0`) |

### Verified Promotion Examples
- **`non` (`adv`):** Promoted Sense #2 (*"Used to negate or invert the meaning of the following adjective..."*) over Sense #1 (*"Obsolete form of none."*).
- **`fella` (`noun`):** Promoted Sense #2 (*"Used as a general intensifier..."*) over Sense #1 (*"Pronunciation spelling of fellow."*).
- **`bovver` (`noun`):** Promoted Sense #2 (*"Violence, especially that associated with youth gangs."*) over Sense #1 (*"Pronunciation spelling of bother."*).
- **`connexion` (`noun`):** Promoted Sense #2 (*"A Methodist denomination as a whole..."*) over Sense #1 (*"Dated spelling of connection."*).
- **`daemonize` (`verb`):** Promoted Sense #2 (*"Of a computer program or script, to prepare to go in to the background..."*) over Sense #1 (*"Archaic spelling of demonize."*).
- **`Ally` (`noun`):** Cleaned empty wiki markup `[[]]` -> `"A diminutive of the female given names Alice, Alison, Alexandra, and other names beginning with Al- from the Germanic languages or Ancient Greek."`.

---

## 3. Duplicate & Normalization Collision Audit

- **Multi-entry lowercase homographs:** `17,051` lowercase forms share multiple entries across parts of speech or etymological homographs (`45,317` distinct `headword_lower` across `75,000` entries). All are preserved as distinct rows (`entries.id`).
- **Same `(headword_lower, part_of_speech)` entries:** `6,202` distinct etymological homograph groups (preserved individually).
- **Unicode / non-ASCII headwords:** `378` entries; **apostrophe headwords:** `512` entries.
- **Partial-indexed `headword_norm` rows:** `789`; **partial-indexed `form_norm` rows:** `2,853`.
- **Sample `normalization_collision_groups` (`153` total):** `regime`/`régime`, `its`/`it's`, `hell`/`he'll`, `id`/`i'd`, `mexico`/`méxico`, `pinata`/`piñata`, `maori`/`māori`. Exact matches prioritize `headword_lower = qLower` before folded `headword_norm = qNorm` so typing `its` still ranks `"its"` first while surfacing `"it's"` safely.
