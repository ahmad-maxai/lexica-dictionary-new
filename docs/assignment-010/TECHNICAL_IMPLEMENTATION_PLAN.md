# LEXICA Assignment 010 — Technical Implementation Plan (Path to Assignment 011)

**Current Status:** Assignments 008 (English) and 009 (Hausa `0.4.0-core`) remain untouched and operational. Assignment 010 deliverables validate data quality rules and benchmark an isolated prototype (`10,201` entries, `85.64%` genuine Hausa explanations) under `/tmp/hausa_recovery_v050`.

---

## Phase 1 — Schema & Repository Upgrade (Assignment 011)

1. **Extend Schema v3 → Schema v4 (`entries` & `senses_ext`):**
   - Add `definition_ha`, `definition_en`, `definition_type` (`CHECK` constraint on the 5 enum values), `script_variant`, `verification_status`, `has_conflict`, and per-sense `source_id` columns as prototyped in `scripts/build_hausa_recovery_prototype.py`.
   - Maintain backward compatibility in `hausaSqliteRepository.ts` by querying `definition_ha`, `definition_en`, and `definition_type` safely (falling back cleanly on Schema v3 if an older pack is installed).
2. **Transparent UI Signalling:**
   - Update entry cards to display `definitionHa` prominently as the primary Hausa explanation, `definitionEn` cleanly labelled as English Translation, `scriptVariant` (Ajami), and an honest indicator when an entry currently carries only an `english_gloss` (`1,465` entries) or is `conflict_flagged` (`321` entries).
3. **CC BY-SA 4.0 & Attribution Surface:**
   - Surface multi-source attributions dynamically from the SQLite `sources` table (`Wikimedia Contributors / ha.wiktionary.org`, `Kaikki.org`, `Wikidata Q56475`, `Tatoeba CC BY 2.0 FR`) inside the Offline Pack Settings and entry footer.

## Phase 2 — Native QA & Source Expansion

1. **Native Hausa QA Pass on `ha.wiktionary.org`:**
   - Prioritize verification of the top 3,000 high-frequency Hausa headwords and the `352` flagged multi-source conflicts (`conflict_flagged`), standardizing dialectical variations (`ɓ, ɗ, ƙ, ƴ`) and pruning low-detail community stubs.
2. **HausaNLP / CSNL Partnership Integration (Pending Written Permission):**
   - Upon receiving a positive written response to `HAUSA_PERMISSION_REQUEST.md`, ingest authorized CRNLT&F / Ƙamusun Hausa JSON/CSV exports via a dedicated `source_id = 6` importer with exact agreed attribution and commercial/non-commercial license terms.
3. **Historical Lexical Bridge (Optional Phase):**
   - Only if native linguists are available for orthographic modernization, selectively align cleaned Robinson (1913/1914) English→Hausa pairs purely to enrich `english_gloss` cross-links—never bypassing hooked-consonant repair.

## Phase 3 — Release Packaging & Android Verification

1. **Size Budget & Android Go Verification:**
   - Core GZIP download of the 10,201-entry prototype is **`1.20 MB` (`1,200,005 B`)** (`3.49 MiB` uncompressed), and Extended GZIP is **`953 KB`** — well within mobile cellular budgets and Android 15 Go storage/RAM constraints (`~0.029 ms` exact lookup).
2. **Release Rollout:**
   - Bump `HAUSA_PACK_MANIFEST` to `0.5.0-core`, update `compressedSha256`/`uncompressedSha256`, upload `lexica_hausa_core.db.gz` and `lexica_hausa_extended.db.gz` to GitHub Release `prototype-ha-core-v0.5.0`, and run full Android Debug APK CI verification.
