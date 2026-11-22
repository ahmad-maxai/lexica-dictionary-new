# Assignment 008 — Real-Device Validation Checklist & Status

**Target Device Profile:** Entry-level Android 15 (Go edition), e.g., Samsung Galaxy A04e (limited RAM, constrained internal storage)  
**Artifact Tested:** Debug APK built via GitHub Actions workflow `Build Android Debug APK` (`workflow_dispatch` on `feature/assignment-008-android-core-prototype`)

---

## 1. Automated & Desktop Verification Completed Before Release

| Check | Status | Scope / Environment |
| :--- | :--- | :--- |
| Core + Extended SQLite deterministic build (`75,000` entries, `134,837` word forms) | **PASS** | Linux build host (`scripts/build_english_core_pack.py`) |
| SHA-256 compressed (`8,602,919` B) & uncompressed (`18,546,688` B) verification | **PASS** | Linux host (`gzip -9`, `sha256sum`) |
| `verify_english_database.py` (integrity, FK, FTS5 `detail=none`, exact/prefix/case/pagination) | **PASS** | Linux SQLite 3.40.1 (`all_passed: true`) |
| `tests/dictionary-search.test.ts` (`21/21` bundled 6-language & multilingual tests) | **PASS** | Node.js TypeScript test suite |
| `tests/english-sqlite-integration.test.ts` (`18/18` including real 75k Core v3 DB + Extended attach + SAF mock) | **PASS** | Node.js + SQLite integration suite |
| TypeScript (`tsc --noEmit`) & Production Vite Bundle (`vite build`) | **PASS** | CI & local build |
| GitHub Release Asset Live Reachability (`prototype-en-core-v0.4.0`) | **PASS** | Live HTTPS check after release upload |
| GitHub Actions Debug APK Compilation | **PASS** | Ubuntu CI Android SDK + Gradle |

---

## 2. Physical Android 15 Go Real-Device Validation Checklist (**Pending Physical Hardware Run**)

Because this environment has no tethered physical Android 15 Go handset, **the following hardware checks remain to be executed manually on the physical device** and must NOT be assumed passed from desktop runs:

1. **Clean Fresh APK Installation**
   - Install `app-debug.apk` from CI artifact `lexica-multilingual-dictionary-debug-apk`.
   - Confirm APK stays lightweight (`~5–7 MiB`, Core dictionary not bundled inside APK).
   - Confirm bundled offline languages (`ha`, `yo`, `ff`, `ar`, `fr`, `zh`) work immediately with zero network access.
2. **Core Pack Network Download & Installation**
   - Open **Language Library** -> tap **Download & Install** for English (`8.20 MB download · 17.69 MB offline · 75,000 entries`).
   - Verify progress stages advance smoothly (`downloading` -> `verifying compressed SHA-256` -> `decompressing` -> `verifying uncompressed SHA-256` -> `PRAGMA quick_check` -> `installed`).
3. **Offline Search & Lookup Performance**
   - Enable **Airplane Mode**.
   - Test exact lookups (`epistemology`, `light`, `run`, `Serendipity`), normalized lookups (`regime` -> `régime`, `its` -> `it's`), prefix (`epistem`), word-form (`swam` -> `swim`, `running` -> `run`), FTS5 definition query (`branch philosophy`), and multi-page A–Z browse.
   - Verify detail view shows IPA, part of speech, audited primary definition, word forms, and calm notice that optional Extended enrichment is not installed.
4. **Persistence Across Restarts & Cache Clearing**
   - Force-stop and relaunch app -> confirm English stays **Installed** without re-downloading.
   - Clear Android **App Cache** in OS Settings -> confirm `getNoBackupFilesDir()/lexica_packs/lexica_english_core.db` survives intact (`0` bytes re-downloaded).
5. **Duplicate Download & Failure Recovery**
   - Tap **Verify Local Database** / retry install -> confirm `0` network download calls when `0.4.0-core` is already installed.
   - Start download with flaky network and cancel/interrupt mid-stream -> verify `.part` resume file is retained and prior working dictionary is never corrupted.
6. **SAF Offline Backup & Restore**
   - Export `.lexicabackup` via Android Storage Access Framework (internal storage / SD card).
   - Remove English pack -> import `.lexicabackup` offline in Airplane Mode -> confirm SHA-256 verification and full restoration of both `0.4.0-core` and user state.
