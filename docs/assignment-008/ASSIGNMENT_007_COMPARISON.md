# Assignment 008 vs. Assignment 007 & Baseline Comparison

This document compares the production-integrated **Assignment 008 Schema v3 Core Pack (`0.4.0-core`)** against the research prototype **Assignment 007 Architecture D (`arch_d_core`)** and the prior **Assignment 006 monolith (`v0.3.0`)**.

---

## 1. Size & Content Comparison

| Dimension | Assignment 006 (`v0.3.0` Schema v2) | Assignment 007 (`arch_d_core` Research) | Assignment 008 (`0.4.0-core` Prototype) | Delta (`008` vs `007`) |
| :--- | :--- | :--- | :--- | :--- |
| **Installed Core DB** | `105.58 MiB` (`110,706,688` B) | `17.39 MiB` | **`17.69 MiB` (`18,546,688` B)** | `+0.30 MiB` (`+1.7%`) |
| **GZIP Archive** | `44.82 MiB` (`47,000,179` B) | `8.16 MiB` (gzip `-6`) | **`8.20 MiB` (`8,602,919` B, gzip `-9`)** | `+0.04 MiB` (`+0.5%`) |
| **Companion Extended DB** | Inside single file | `85.45 MiB` (`35.84 MiB` gz) | **`85.48 MiB` (`35.78 MiB` gz)** | `+0.03 MiB` |
| **Normalized Lookup Columns** | None (`headword_lower` only) | None (`headword_lower` only) | **`headword_norm` + `form_norm` partial indexes** | Adds `regime`->`régime`, `its`->`it's` |
| **Primary Definition Selection** | All `190,672` senses stored | Blind Sense #1 | **Audited primary sense (`42` weak stubs promoted, `23` cleanups)** | Higher UX quality |
| **Word Forms Index** | `form_lower` + `entry_id` | `form_lower` + `entry_id` | `form_lower` + partial `form_norm` + `entry_id` | Full `134,837` forms |
| **Metadata / Attribution** | Full metadata + sources | Prototype metadata | Full Android manifest + licensing + Extended link | Production-ready |

### Why Is Core `17.69 MiB` (+`0.30 MiB` Over Assignment 007's `17.39 MiB`)?
1. **`headword_norm` & `form_norm` Partial Indexes (~`0.24 MiB`):** Supports fast diacritic- and apostrophe-folded lookup without full-table scans on all 75,000 entries and 134,837 forms.
2. **Rich Attribution & Schema Metadata + `VACUUM` (`~0.06 MiB`):** Preserves complete Wiktionary CC BY-SA 4.0 / GFDL attribution, schema version markers, and extended companion linkage required by Android validator & Language Library UI.
3. Even with these production capabilities, `0.4.0-core` trims **`36.62 MiB`** off downloads (`81.7%` smaller) and **`87.89 MiB`** off on-device flash (`83.2%` smaller) vs `v0.3.0`.

---

## 2. Measured Desktop Verification Latency (Non-Device)

Measured in Python 3.11 / SQLite 3.40.1 (`scripts/verify_english_database.py --db /tmp/lexica_core_v040/lexica_english_core.db`) on Linux container:
- **1,000 indexed exact queries:** **`0.040 ms` average**, **`0.060 ms` p95**
- **Peak verification process RSS:** **`18.1 MiB`** (compared to desktop Container environment; physical Android 15 Go timings must still be measured on target hardware).

---

## 3. Architectural Gains for Low-End Android 15 Go Devices
1. **3-Second Cellular Download Feasibility:** `8.20 MiB` download finishes quickly even on throttled mobile networks, reducing interrupted-download exposure and storage errors on `2.7 GiB` internal flash phones.
2. **Minimal SQLite Working Set:** Separating out `85.48 MiB` of examples, etymologies, secondary senses, and multi-dialect pronunciation JSON keeps the active Core file under `18 MiB`, minimizing page-cache thrashing when constrained to `PRAGMA cache_size = -2000`.
3. **Resilient Upgrades & Backups:** Both legacy (`v0.2.0`/`v0.3.0`) `.lexicabackup` files and new Core (`0.4.0-core`) packages share one atomic staging/validation pipeline cleanly.
