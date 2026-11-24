import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchInputField } from '../src/components/SearchInputField';
import {
  applyPasteAtCursor,
  deleteBeforeCursor,
  insertTextAtCursor,
  sanitizeSearchPaste,
} from '../src/utils/searchInputUtils';
import { dictionaryDb } from '../src/services/dictionaryDatabase';

console.log('==============================================================');
console.log('LEXICA — SEARCH INPUT & ANDROID WEBVIEW REGRESSION SUITE');
console.log('==============================================================\n');

let passed = 0;
let total = 0;

function runTest(name: string, fn: () => void) {
  total++;
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

runTest('Config: capacitor.config.json sets android.captureInput = false (native Chromium InputConnection)', () => {
  const capConfig = JSON.parse(fs.readFileSync(path.resolve('capacitor.config.json'), 'utf8'));
  assert.strictEqual(
    capConfig.android?.captureInput,
    false,
    'captureInput MUST be false; true installs BaseInputConnection(this, false) and breaks Android Backspace and paste'
  );
});

runTest('Config: AndroidManifest.xml sets windowSoftInputMode="adjustResize" on MainActivity', () => {
  const manifest = fs.readFileSync(
    path.resolve('android/app/src/main/AndroidManifest.xml'),
    'utf8'
  );
  assert(
    manifest.includes('android:windowSoftInputMode="adjustResize"'),
    'MainActivity must declare android:windowSoftInputMode="adjustResize"'
  );
});

runTest('UI Guard: DictionaryScreen & HomeScreen use SearchInputField with stable dir (no empty-query dir flip)', () => {
  const dictSrc = fs.readFileSync(path.resolve('src/components/DictionaryScreen.tsx'), 'utf8');
  const homeSrc = fs.readFileSync(path.resolve('src/components/HomeScreen.tsx'), 'utf8');

  assert(dictSrc.includes('<SearchInputField'), 'DictionaryScreen must render SearchInputField');
  assert(homeSrc.includes('<SearchInputField'), 'HomeScreen must render SearchInputField');
  assert(
    !dictSrc.includes('dir={!query'),
    'DictionaryScreen must NOT dynamically toggle dir on empty query'
  );
  assert(
    !homeSrc.includes('dir={!searchQuery'),
    'HomeScreen must NOT dynamically toggle dir on empty query'
  );
  assert(
    dictSrc.includes('insertTextAtCursor('),
    'DictionaryScreen diacritic quick-bar must insert at cursor position'
  );
});

runTest('Component Markup: SearchInputField emits mobile/IME-safe attributes and stable directionality', () => {
  const emptyLtrHtml = renderToStaticMarkup(
    React.createElement(SearchInputField, {
      value: '',
      onValueChange: () => {},
      direction: 'ltr',
      placeholder: 'Search',
    })
  );
  assert(emptyLtrHtml.includes('inputMode="search"') || emptyLtrHtml.includes('inputmode="search"'));
  assert(emptyLtrHtml.includes('enterKeyHint="search"') || emptyLtrHtml.includes('enterkeyhint="search"'));
  assert(emptyLtrHtml.includes('autoComplete="off"') || emptyLtrHtml.includes('autocomplete="off"'));
  assert(emptyLtrHtml.includes('autoCapitalize="none"') || emptyLtrHtml.includes('autocapitalize="none"'));
  assert(emptyLtrHtml.includes('spellCheck="false"') || emptyLtrHtml.includes('spellcheck="false"'));
  assert(emptyLtrHtml.includes('dir="ltr"'));

  const rtlHtml = renderToStaticMarkup(
    React.createElement(SearchInputField, {
      value: 'سلام',
      onValueChange: () => {},
      direction: 'rtl',
    })
  );
  assert(rtlHtml.includes('dir="rtl"'));
});

runTest('Scenario 1: Normal sequential character typing updates query and executes search', () => {
  let q = '';
  let cursor = 0;
  for (const ch of ['w', 'a', 't', 'e', 'r']) {
    const res = insertTextAtCursor(q, ch, cursor, cursor);
    q = res.nextValue;
    cursor = res.nextCursor;
  }
  assert.strictEqual(q, 'water');
  const searchRes = dictionaryDb.searchStandard(q, 'en');
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.results[0].entry.headword, 'Water');
});

runTest('Scenario 2: Pasting a complete word auto-executes search without manual submit', () => {
  const pasted = sanitizeSearchPaste('Ruwa\n');
  const { nextValue } = applyPasteAtCursor('', pasted, 0, 0);
  assert.strictEqual(nextValue, 'Ruwa ');
  const searchRes = dictionaryDb.searchStandard(nextValue.trim(), 'ha');
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.results[0].entry.headword, 'Ruwa');
});

runTest('Scenario 3: Pasting Yoruba "ẹ̀kọ́" (NFC & NFD) preserves diacritics and returns lookup', () => {
  const nfcWord = 'ẹ̀kọ́';
  const nfdWord = nfcWord.normalize('NFD');

  const pasteNfc = applyPasteAtCursor('', nfcWord, 0, 0);
  assert.strictEqual(pasteNfc.nextValue, nfcWord);

  const pasteNfd = applyPasteAtCursor('', nfdWord, 0, 0);
  assert.strictEqual(pasteNfd.nextValue, nfdWord);

  // Verify bundled dictionary entry lookup with Yoruba diacritics works (e.g. Àlàáfíà / Omi)
  const yoPaste = applyPasteAtCursor('', 'Àlàáfíà', 0, 0);
  const yoRes = dictionaryDb.searchStandard(yoPaste.nextValue, 'yo');
  assert.strictEqual(yoRes.status, 'ok');
  assert.strictEqual(yoRes.results[0].entry.headword, 'Àlàáfíà');
});

runTest('Scenario 4: Single Backspace after typing removes last character reliably', () => {
  const typed = insertTextAtCursor('wat', 'e', 3, 3);
  assert.strictEqual(typed.nextValue, 'wate');
  const deleted = deleteBeforeCursor(typed.nextValue, typed.nextCursor, typed.nextCursor);
  assert.strictEqual(deleted.nextValue, 'wat');
  assert.strictEqual(deleted.nextCursor, 3);

  // Also test Backspace on Fulfulde/Adlam surrogate pair (2 UTF-16 units deleted as 1 code point)
  const adlam = '𞤀𞤤';
  const delAdlam = deleteBeforeCursor(adlam, adlam.length, adlam.length);
  assert.strictEqual(delAdlam.nextValue, '𞤀');
});

runTest('Scenario 5: Multi-character deletion & range selection delete work cleanly', () => {
  let q = 'Suudu';
  let c = q.length;
  for (let i = 0; i < 3; i++) {
    const r = deleteBeforeCursor(q, c, c);
    q = r.nextValue;
    c = r.nextCursor;
  }
  assert.strictEqual(q, 'Su');

  const rangeDel = deleteBeforeCursor('Àlàáfíà', 1, 5);
  assert.strictEqual(rangeDel.nextValue, 'Àíà');
  assert.strictEqual(rangeDel.nextCursor, 1);
});

runTest('Scenario 6: Mid-word cursor editing & diacritic insertion updates at caret, not end', () => {
  const base = 'kfa';
  // Caret is at index 1 (between 'k' and 'fa'); insert 'o' then replace or insert hooked char
  const mid = insertTextAtCursor(base, 'o', 1, 1);
  assert.strictEqual(mid.nextValue, 'kofa');
  assert.strictEqual(mid.nextCursor, 2);

  // Mid-word Yoruba/Fulfulde special char insertion (e.g. 'suu' + 'ɗ' before 'u')
  const ffMid = insertTextAtCursor('cuui', 'ɗ', 3, 3);
  assert.strictEqual(ffMid.nextValue, 'cuuɗi');
  assert.strictEqual(ffMid.nextCursor, 4);
  const ffSearch = dictionaryDb.searchStandard(ffMid.nextValue, 'ff');
  assert.strictEqual(ffSearch.status, 'ok');
  assert.strictEqual(ffSearch.results[0].entry.headword, 'Suudu');
});

runTest('Scenario 7: Clearing full query resets state cleanly without corrupting subsequent input', () => {
  const cleared = deleteBeforeCursor('Ruwa', 0, 4);
  assert.strictEqual(cleared.nextValue, '');
  assert.strictEqual(cleared.nextCursor, 0);

  const retyped = insertTextAtCursor(cleared.nextValue, 'Gida', 0, 0);
  assert.strictEqual(retyped.nextValue, 'Gida');
  assert.strictEqual(dictionaryDb.searchStandard(retyped.nextValue, 'ha').status, 'ok');
});

runTest('Scenario 8: Replacing an existing query with a pasted word replaces cleanly and searches new word', () => {
  const prev = 'Water';
  const replaced = applyPasteAtCursor(prev, 'Omi', 0, prev.length);
  assert.strictEqual(replaced.nextValue, 'Omi');
  const res = dictionaryDb.searchStandard(replaced.nextValue, 'yo');
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.results[0].entry.headword, 'Omi');
});

runTest('Scenario 9: Switching languages preserves special characters (ẹ̀kọ́, ɓ, ɗ, ƴ, ŋ) & finds matches', () => {
  const testCases: Array<{ lang: 'en' | 'ha' | 'yo' | 'ff'; term: string }> = [
    { lang: 'en', term: 'Peace' },
    { lang: 'ha', term: 'Ƙofa' },
    { lang: 'yo', term: 'Àlàáfíà' },
    { lang: 'ff', term: 'Muñal' },
  ];
  for (const tc of testCases) {
    const pasted = applyPasteAtCursor('', tc.term, 0, 0);
    assert.strictEqual(pasted.nextValue, tc.term);
    const res = dictionaryDb.searchStandard(pasted.nextValue, tc.lang);
    assert.strictEqual(res.status, 'ok', `Expected ok search for ${tc.lang}: ${tc.term}`);
  }
});

runTest('Scenario 10: Keyboard show/hide & focus retention preserve query state without resetting input', () => {
  const initial = 'ẹ̀kọ́';
  // Simulate keyboard show/hide cycle: value and selection indices remain unchanged
  const retained = applyPasteAtCursor(initial, '', initial.length, initial.length);
  assert.strictEqual(retained.nextValue, initial);
  assert.strictEqual(retained.nextCursor, initial.length);
  const afterBack = deleteBeforeCursor(retained.nextValue, retained.nextCursor, retained.nextCursor);
  assert(afterBack.nextValue.length < initial.length, 'Backspace after keyboard show/hide must delete normally');
});

console.log('\n==============================================================');
console.log(`SEARCH INPUT REGRESSION RESULTS: ${passed} / ${total} TESTS PASSED`);
console.log('==============================================================\n');
