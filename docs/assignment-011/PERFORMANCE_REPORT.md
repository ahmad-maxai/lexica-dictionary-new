# Assignment 011 — Schema v4 Performance & Storage Benchmark Report

**Pack Version:** `0.5.0-core` / `0.5.0-extended` (`ha-lexica-schema-v4`)  
**Release Tag:** `prototype-ha-core-v0.5.0`

---

## 1. Storage & Compression Measurements (Measured Directly From Built Artifacts)

| Artifact | Uncompressed Size | GZIP Compressed Size | Compression Ratio | SHA-256 (Compressed `.db.gz`) |
| --- | --- | --- | ---: | --- |
| `lexica_hausa_core.db` | 3,846,144 B (**3.67 MiB**) | 1,250,359 B (**1.19 MiB**) | 0.3251 | `5a3ca52afceb1565c075f584f511c3e71f129148b13c5a5171c54a7e98dafc0a` |
| `lexica_hausa_extended.db` | 4,861,952 B (**4.64 MiB**) | 1,083,908 B (**1.03 MiB**) | 0.2229 | `9884ac6d24ece944c66a92499e82c84492b2bd365e9e3059bc650339a5bca9d9` |
| **Combined Core + Extended** | **8.31 MiB** offline | **2.22 MiB** download | — | Independent Core-only works at **1.19 MiB** download / **3.67 MiB** offline |

### APK & Low-Memory Discipline
- **APK Bundle Overhead:** `0 bytes` (both Core & Extended packs are downloaded dynamically on demand via `EnglishPackInstallerPlugin` with HTTP Range resume and streaming GZIP extraction into `noBackupFilesDir/lexica_packs/`).
- **Builder Peak RSS:** `88,232 KiB` (~86.2 MiB) in `8.01 s` build time.
- **Duplicate Prevention:** Installing an identical pack version & byte size triggers Step 0 verification and skips network download cleanly.
- **Independent Extended Layer:** Installing/removing Extended (`packLayer: "extended"`) isolates staging/DB paths (`lexica_hausa_extended.db`) so removing Extended leaves `lexica_hausaSQLite.db` (Core) untouched.

---

## 2. Query Latency Benchmarks (Host SQLite Engine on Built Schema v4 DB)

Measured directly by `scripts/build_hausa_schema_v4.py` against the 10,201-entry Core database:

| Query Operation | Mean Latency (ms) | Notes |
| --- | ---: | --- |
| Exact Headword (`headword_lower = ?`) | **0.0228 ms** | B-tree indexed (`idx_entries_lower`), distinguishes `b/ɓ`, `d/ɗ`, `k/ƙ`, `y/ƴ` |
| Normalized / Hooked Fallback (`headword_norm = ?`) | **0.0237 ms** | Partial index (`idx_entries_norm`); suppressed when query already contains hooked letters |
| Prefix Search (`headword_lower >= ? AND < ?`) | **0.0387 ms** | Bounded range scan (`LIMIT 50`) |
| FTS5 Full-Text Definition Search (`entries_fts MATCH ?`) | **0.0380 ms** | Contentless FTS5 across `headword`, `definition_ha`, `definition_en`, `primary_definition` |

---

## 3. Orthographic Accuracy Improvements Over Assignment 009
1. **Strict Hooked-Consonant Discrimination:** Searching `ƙasa` queries `headword_lower`/`qSoft` only and never flattens to `qDeep`, preventing unrelated plain-`k` results like `kasa` (*puff adder snake*). Plain ASCII `kofa` still resolves `ƙofa` via normalized fallback below exact matches.
2. **Unicode Hooked Browse Letters:** `getAvailableLetters()` normalizes characters in JS (`toLocaleUpperCase('ha')`) instead of relying on SQLite's ASCII-only `upper()`, properly exposing `Ɓ`, `Ɗ`, `Ƙ`, `Ƴ` browse filters.
3. **Result Quality Tie-Breaking:** Equal-score headword hits rank `bilingual_explanation` and `hausa_monolingual` above `english_gloss`-only entries (`e.g.` searching `ruwa` surfaces the Hausa noun definition first).
4. **English-to-Hausa & Ajami Lookup:** Supports `definition_en` lookup (`water` → `Ruwa`), multi-column FTS5, and Arabic diacritic-normalized Ajami lookups (`script_variant_norm`).
