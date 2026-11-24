# LEXICA — Assignment 015: Search Input Root-Cause Investigation & Repair

**Branch:** `feature/assignment-015-fulfulde-source-audit`
**Status:** Production fixes implemented, synced to Android Capacitor assets, and covered by 14 automated regression assertions (`tests/search-input-regression.test.ts`).

---

## 1. Root-Cause Trace (Android WebView + Capacitor + React)

User symptoms reported on installed Android builds:
- Pasting a word into the search box did not execute live search automatically.
- Pressing Backspace/Delete after typing a character failed reliably, forcing the user to clear/cancel search to recover.
- Entering or pasting Yoruba diacritics (e.g., `ẹ̀kọ́`) and special African Latin characters was unreliable.

### Primary Root Cause — `capacitor.config.json` (`"captureInput": true`)
In `capacitor.config.json`, `android.captureInput` was set to `true` (and copied into `android/app/src/main/assets/capacitor.config.json`).

In `@capacitor/android@7.6.10` (`CapacitorWebView.java`, lines 30–56):
1. Returning `new BaseInputConnection(this, false)` sets `fullEditor = false`, meaning the WebView exposes **no `Editable` buffer** and **no cursor/surrounding-text bridge** to Android soft keyboards (Gboard, Samsung Keyboard, SwiftKey).
2. Calls from soft keyboards to `deleteSurroundingText(1, 0)` or `getTextBeforeCursor()` fail after characters are entered, breaking Backspace/Delete.
3. Multi-character IME commits and clipboard paste events sent as `KeyEvent.ACTION_MULTIPLE` trigger `evaluateJavascript("document.activeElement.value = document.activeElement.value + '" + event.getCharacters() + "';", null);`, mutating the raw DOM `.value` property directly while **bypassing React's controlled `value` setter and `onChange` handler**. React's `query` state stayed stale, so search `useEffect` hooks never fired.

### Secondary Causes in React UI & Android Manifest
1. **Dynamic `dir` flipping on `<input>` (`DictionaryScreen.tsx` & `HomeScreen.tsx`):** Both components evaluated `dir={!query ? (interfaceLang === 'ar' ? 'rtl' : 'ltr') : sourceMeta.direction}`, flipping the input's `dir` attribute every time the query transitioned between empty and 1 character (or when clearing/backspacing the final character). Mutating `dir` mid-typing resets Chromium WebView's active IME `InputConnection`.
2. **Missing mobile/IME input hints:** Inputs lacked `inputMode="search"`, `enterKeyHint="search"`, `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="none"`, and `spellCheck={false}`.
3. **End-only diacritic insertion (`DictionaryScreen.tsx`):** `handleInsertChar` appended characters (`prev + char`) instead of inserting at `[selectionStart, selectionEnd]` and restoring the caret.
4. **Missing soft-keyboard resize policy (`AndroidManifest.xml`):** `.MainActivity` lacked `android:windowSoftInputMode="adjustResize"`.

---

## 2. Implemented Fixes

| File | Change | Purpose |
| :--- | :--- | :--- |
| `capacitor.config.json` (+ synced `android/app/src/main/assets/capacitor.config.json`) | `"captureInput": false` | Restores Chromium WebView's real `InputConnection` for Backspace, mid-word cursor edits, IME diacritic composition (`ẹ̀kọ́`), and native paste. |
| `android/app/src/main/AndroidManifest.xml` | Added `android:windowSoftInputMode="adjustResize"` on `.MainActivity` | Prevents keyboard show/hide from dropping focus or displacing the search bar. |
| `src/utils/searchInputUtils.ts` | Added `insertTextAtCursor`, `deleteBeforeCursor`, `applyPasteAtCursor`, `sanitizeSearchPaste` | Cursor-aware, Unicode code-point-safe editing that preserves combining marks and Adlam/Fulfulde characters. |
| `src/components/SearchInputField.tsx` | Created hardened controlled search `<input>` | Stable `dir`, IME composition listeners (`onCompositionStart`/`Update`/`End`), `onInput`, and non-blocking `onPaste` DOM reconciliation (`queueMicrotask` + `requestAnimationFrame`). |
| `src/components/DictionaryScreen.tsx` | Replaced `<input>` with `<SearchInputField>`, updated `handleInsertChar` to use `insertTextAtCursor` | Fixes Dictionary search typing/pasting/backspacing and inserts Yoruba/Fulfulde/Hausa diacritics at the exact cursor offset. |
| `src/components/HomeScreen.tsx` | Replaced `<input>` with `<SearchInputField>` | Fixes Home search bar typing, pasting, and Backspace behavior with stable `direction`. |

---

## 3. Verification Scope & Honest Hardware Limitation

- **Automated Verification Completed:**
  - `tests/search-input-regression.test.ts` (**14/14 checks passing**): verifies `capacitor.config.json` (`captureInput: false`), `AndroidManifest.xml` (`adjustResize`), UI source guards (no empty-query `dir` flip, cursor-aware diacritic insertion), `SearchInputField` SSR attributes, and all 10 user scenarios (normal typing, paste auto-search, pasting `ẹ̀kọ́` NFC/NFD, single Backspace including Adlam surrogate pairs, multi-delete/range delete, mid-word cursor insertion, clearing query, replacing with pasted word, multi-language switching across `en`/`ha`/`yo`/`ff`, and keyboard show/hide focus retention).
  - Full TypeScript check (`npm run lint`), production Vite build (`npm run build`), `npx cap sync android` (updating `android/app/src/main/assets/capacitor.config.json`), and GitHub Actions Android Gradle APK build verification.
- **Physical Android Device Limitation (Explicitly Stated):**
  - This environment is a headless Linux build container with no physical Android handset or interactive Android emulator attached. Therefore, **live interactive typing/pasting with an OEM Android soft keyboard (Gboard/Samsung Keyboard) on a physical device was not executed directly in this session** and should be confirmed via the generated feature-branch APK on a physical handset.
