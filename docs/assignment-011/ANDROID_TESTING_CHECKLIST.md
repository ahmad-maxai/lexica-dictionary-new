# Assignment 011 — Verification & Android Testing Checklist

This checklist separates **CI / Automated Host Verification (executed)** from **Android Emulator Verification** and **Physical Android 15 Go Hardware Testing (pending local device execution)**.

---

## 1. Automated Host & CI Verification (Executed)

### TypeScript Compilation, Typecheck & Build
- [x] `tsc --noEmit` (`lint_applet`) passed with 0 errors.
- [x] Vite production bundle (`compile_applet` / `npm run build`) succeeded with 0 errors.

### Automated Test Suites (`npm test` — 50 / 50 Passing)
- [x] **Core Corpus & Search Suite (`tests/dictionary-search.test.ts`):** `21 / 21` passed (no regressions across English, Hausa, Yoruba, Fulfulde, Arabic, French, Chinese).
- [x] **English SQLite Suite (`tests/english-sqlite-integration.test.ts`):** `16 / 16` passed (Core + Extended English unchanged).
- [x] **Hausa Schema v4 Integration Suite (`tests/hausa-sqlite-integration.test.ts`):** `6 / 6` passed:
  - `H.1` Schema v4 Manifest (`0.5.0-core` + `0.5.0-extended`), SHA-256 format checks, 5-source metadata validation.
  - `H.2` Exact lookup, hooked-consonant discrimination (`ƙasa` excludes plain `kasa`; `kofa` finds `ƙofa`), Ajami script exact/normalized (`رُوَا`, `قوفا`), inflected `word_forms`, English-to-Hausa lookup, `english_gloss` vs `hausa_monolingual` distinction.
  - `H.3` Bounded pagination, `Ɓ/Ɗ/Ƙ/Ƴ` available letters, `getEntriesByIds`, and restart connection recovery.
  - `H.4` Extended Schema v4 `ATTACH DATABASE ... AS ext`, multi-sense/example/IPA/audio ref hydration, `conflict_reviews` queue + `hausaConflictReviewService` decision persistence, clean detach leaving Core operational.
  - `H.5` Independent Extended install/remove preserving Core, SHA-256 tamper rejection, `setHausaSqliteIntegrationEnabled(false)` reversibility to starter corpus, and zero regression on all other 6 languages.
  - `H.6` End-to-end verification against full built `/tmp/hausa_core_v050/lexica_hausa_core.db` (**10,201** entries, `0` placeholders, `0` machine-generated entries, `5,581` word forms, `352` conflicts).
- [x] **Hausa Lexicography Quality Audit (`tests/hausa-lexicography-audit.test.ts`):** `7 / 7` passed (Assignment 009 preservation check + Schema v4 DB quality audit).

### CI Android Build (`.github/workflows/build-android-apk.yml`)
- [x] Triggered via GitHub Actions `workflow_dispatch` on `feature/assignment-011-hausa-core-integration` (compile Java Capacitor plugin `EnglishPackInstallerPlugin.java`, Capacitor sync & Gradle Debug APK build, artifact upload).

---

## 2. Android Emulator Manual QA Checklist (Requires Emulator / Local ADB)
- [ ] Clean install Debug APK on API 34 / API 35 AVD.
- [ ] Language Library → Tap **Install (1.19 MB)** under Hausa → verify progress bar stages (`downloading`, `verifying_archive`, `extracting`, `verifying_integrity`, `activating`).
- [ ] Airplane Mode / Offline toggle → verify exact Hausa lookup (`ruwa`, `ƙofa`, `ƙasa`), ASCII fallback (`kofa`), English lookup (`water`), and Ajami lookup (`رُوَا`) work without network.
- [ ] Force-stop & cold-relaunch app → verify Hausa Core stays installed and searchable offline.
- [ ] Optional Extended Install (**1.03 MB**) → verify `WordDetailModal` loads extra senses, Tatoeba examples, etymology, audio credit, and collapsible Conflict QA workflow (`ƙasa` / flagged words).
- [ ] Tap **Remove Extended Only** → verify Core searches continue functioning seamlessly offline.
- [ ] Check Saved tab after bookmarking Hausa SQLite words and restarting app.

---

## 3. Physical Android 15 Go Hardware Checklist (Requires Physical Device)
- [ ] Install APK on a low-RAM (1–2 GB) Android Go device and monitor memory footprint (`LanguageLibraryScreen` → **Run Benchmark**).
- [ ] Simulate mid-download Wi-Fi disconnect → confirm recovery/retry preserves clean state without corrupting existing Core DB.
- [ ] Confirm smooth scrolling on 20-entry paginated results and fast keyboard input responsiveness with hooked characters (`ɓ`, `ɗ`, `ƙ`, `ƴ`).
