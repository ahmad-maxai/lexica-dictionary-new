# LEXICA Assignment 010 — Remaining Dependencies & Blockers

Before promoting the Assignment 010 Hausa prototype into production (Assignment 011), the following external permissions, human linguistic reviews, and engineering prerequisites must be resolved:

---

## 1. Pending External Licensing Permissions

| Resource | Owner | Required Action | Impact |
| :--- | :--- | :--- | :--- |
| **Ƙamusun Hausa (`kamusunhausa.hausanlp.org`)** | CRNLT&F (CSNL), Bayero University, Kano & HausaNLP | Send `HAUSA_PERMISSION_REQUEST.md` (`hausanlp@gmail.com` / `shamsuddeen2004@gmail.com`) and obtain written licensing agreement + authorized dataset dump. | Unlocks authoritative academic Hausa-to-Hausa definitions. Blocked until written reply received. |
| **PanLex Open Subset (Optional)** | PanLex / Long Now Foundation | Filter PanLex snapshot strictly by open-licensed `src` IDs (`CC0`, `CC BY`, `CC BY-SA`) once API/snapshot sync is scheduled outside sandbox DNS constraints. | Potential incremental cross-lingual glosses. |

## 2. Human Native-Speaker Editorial Reviews Required

1. **Community Wiktionary QA (`ha.wiktionary.org` — `8,715` primary entries):**
   - Although community entries carry genuine Hausa prose under `CC BY-SA 4.0 & GFDL`, spot-audits show occasional informal spelling (`ts` vs `c`, missing hooked consonants such as `Kwai` for `ƙwai`, or contributor typos). Native Hausa review is required to promote entries from `community_reviewed` to `human_verified`.
2. **Multi-Source Conflict Resolution (`352` flagged entries):**
   - `321` primary entries are tagged `conflict_flagged` where independent open sources disagree on part of speech or provide divergent Hausa explanations (preserved separately in `senses_ext` without auto-merging). Native adjudication is required before marking a canonical primary sense.
3. **English-Only Tail (`1,465` Kaikki/Wikidata entries):**
   - Remain accurately tagged `english_gloss` (`hausaMonolingualCoveragePercent = 85.64%`). Expanding Hausa explanations for these ~1,465 lemmas requires either CSNL/HausaNLP permission or original native-speaker lexicography.
4. **Historical Orthography Modernization (Optional `Robinson 1914` / `Afri-Dict`):**
   - Rejected for Core use until all pre-standard spellings (`k→ƙ`, `b→ɓ`, `d→ɗ`), OCR hyphen splits, and colonial-era terms are repaired by Hausa scholars.

## 3. Repository & Packaging Prerequisites

- **Production Isolation Preserved:** `src/config/hausaDictionaryConfig.ts` (`0.4.0-core`) has intentionally NOT been swapped during Assignment 010; Schema v4 UI updates (`definition_ha`, `definition_type` badge, Ajami display, CC BY-SA 4.0 attribution screen) must land alongside manifest `0.5.0-core` in Assignment 011.
- **No Raw Dump Artifacts Committed:** Source dumps (`/tmp/audit_sources/`) and prototype SQLite binaries (`/tmp/hausa_recovery_v050/`) remain external to Git and are excluded from the repository.
