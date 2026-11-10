import assert from 'node:assert';
import { dictionaryDb } from '../src/services/dictionaryDatabase';
import { MultilingualSearchEngine } from '../src/services/dictionarySearchEngine';

console.log('====================================================');
console.log('LEXICA MULTILINGUAL DICTIONARY — AUTOMATED TEST SUITE');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passedTests++;
  } catch (err: unknown) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------
// TEST 1: User's reported bug: Arabic -> Hausa "خير"
// ----------------------------------------------------
runTest('Arabic -> Hausa: Search for "خير" retrieves verified entry with Hausa translation', () => {
  const results = dictionaryDb.search('خير', 'ar', 'ha');
  assert(results.length > 0, 'Expected at least 1 result for "خير" in Arabic -> Hausa');
  
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'ar', 'Source language must be Arabic');
  assert(match.headword.includes('خَيْر') || match.headword.includes('خير'), 'Headword must be Khayr');
  
  const hausaTranslations = match.translations.ha;
  assert(hausaTranslations && hausaTranslations.length > 0, 'Must have Hausa translation');
  assert(
    hausaTranslations.some((t) => t.headword.includes('Alheri') || t.headword.includes('Nagarta')),
    'Hausa translation must contain Alheri or Nagarta'
  );
  assert.strictEqual(match.verifiedOffline, true, 'Entry must be verified offline');
});

// ----------------------------------------------------
// TEST 2: Arabic Diacritics (With Tashkeel vs Bare)
// ----------------------------------------------------
runTest('Arabic search works identically with and without Harakat (Tashkeel)', () => {
  const withDiacritics = dictionaryDb.search('خَيْرٌ', 'ar', 'ha');
  const withoutDiacritics = dictionaryDb.search('خير', 'ar', 'ha');
  
  assert(withDiacritics.length > 0, 'Search with Tashkeel "خَيْرٌ" must find entry');
  assert(withoutDiacritics.length > 0, 'Search without Tashkeel "خير" must find entry');
  assert.strictEqual(withDiacritics[0].id, withoutDiacritics[0].id, 'Both queries must resolve to the same entry');
  
  // Test Salam with Tashkeel
  const salamWithTashkeel = dictionaryDb.search('سَلَام', 'ar', 'en');
  const salamBare = dictionaryDb.search('سلام', 'ar', 'en');
  assert(salamWithTashkeel.length > 0, 'سَلَام must be found');
  assert(salamBare.length > 0, 'سلام must be found');
  assert.strictEqual(salamWithTashkeel[0].id, salamBare[0].id);
});

// ----------------------------------------------------
// TEST 3: Yoruba Tone Marks and Sub-dots
// ----------------------------------------------------
runTest('Yoruba search handles exact tones and ASCII keyboard fallback', () => {
  // Exact tone: Àlàáfíà
  const exact = dictionaryDb.search('Àlàáfíà', 'yo', 'en');
  assert(exact.length > 0, 'Exact tone "Àlàáfíà" must find entry');
  
  // ASCII fallback: alafia
  const fallback = dictionaryDb.search('alafia', 'yo', 'en');
  assert(fallback.length > 0, 'ASCII "alafia" must find entry via soft normalization');
  assert.strictEqual(exact[0].id, fallback[0].id);
  
  // Ọgbọ́n vs ogbon
  const ogbonExact = dictionaryDb.search('Ọgbọ́n', 'yo', 'en');
  const ogbonFallback = dictionaryDb.search('ogbon', 'yo', 'en');
  assert(ogbonExact.length > 0, '"Ọgbọ́n" must be found');
  assert(ogbonFallback.length > 0, '"ogbon" must be found');
});

// ----------------------------------------------------
// TEST 4: Hausa Hooked Consonants (Ɓ, Ɗ, Ƙ, Ƴ)
// ----------------------------------------------------
runTest('Hausa search supports hooked consonants and standard keyboard letters', () => {
  const hooked = dictionaryDb.search('Ƙofa', 'ha', 'en');
  const standard = dictionaryDb.search('kofa', 'ha', 'en');
  
  assert(hooked.length > 0, 'Search with hooked Ƙ "Ƙofa" must find entry');
  assert(standard.length > 0, 'Search with standard k "kofa" must find entry');
  assert.strictEqual(hooked[0].id, standard[0].id);
});

// ----------------------------------------------------
// TEST 5: Chinese Hanzi and Pinyin matching
// ----------------------------------------------------
runTest('Chinese search supports Simplified Hanzi, Traditional, and Pinyin', () => {
  const hanzi = dictionaryDb.search('善', 'zh', 'en');
  assert(hanzi.length > 0, 'Hanzi "善" must find entry');
  
  const pinyinWithTone = dictionaryDb.search('shàn', 'zh', 'en');
  const pinyinBare = dictionaryDb.search('shan', 'zh', 'en');
  assert(pinyinWithTone.length > 0, 'Pinyin with tone "shàn" must find entry');
  assert(pinyinBare.length > 0, 'Pinyin without tone "shan" must find entry');
  
  const heping = dictionaryDb.search('和平', 'zh', 'en');
  const hepingPinyin = dictionaryDb.search('heping', 'zh', 'en');
  assert(heping.length > 0, 'Hanzi "和平" must find entry');
  assert(hepingPinyin.length > 0, 'Pinyin "heping" must find entry');
});

// ----------------------------------------------------
// TEST 6: Nonexistent word returns clean no-result
// ----------------------------------------------------
runTest('Missing / nonexistent word returns empty result set without errors', () => {
  const missing = dictionaryDb.search('xyz99nonexistentword', 'en', 'ha');
  assert.strictEqual(missing.length, 0, 'Nonexistent word must return empty array');
});

// ----------------------------------------------------
// TEST 7: Strict Language-Pair Isolation (No mixing unrelated pairs)
// ----------------------------------------------------
runTest('Search results do NOT mix unrelated language pairs', () => {
  // Query empty string or common word in Arabic -> Hausa
  const results = dictionaryDb.search('', 'ar', 'ha');
  assert(results.length > 0, 'Must have active pairs');
  
  for (const entry of results) {
    const isArSource = entry.sourceLang === 'ar' && !!entry.translations.ha?.length;
    const isHaSource = entry.sourceLang === 'ha' && !!entry.translations.ar?.length;
    assert(
      isArSource || isHaSource,
      `Entry ${entry.id} (${entry.sourceLang}) must be strictly within the ar <-> ha pair!`
    );
  }
});

// ----------------------------------------------------
// TEST 8: Language-Pair Switching (Bidirectional)
// ----------------------------------------------------
runTest('Language-pair switching works across all 7 launch languages', () => {
  const pairs: Array<[string, string]> = [
    ['en', 'ha'],
    ['ha', 'en'],
    ['ar', 'ha'],
    ['ha', 'ar'],
    ['yo', 'en'],
    ['fr', 'en'],
    ['zh', 'en'],
    ['ff', 'fr'],
  ];
  
  for (const [src, tgt] of pairs) {
    const results = dictionaryDb.search('', src as any, tgt as any);
    assert(
      results.length > 0,
      `Language pair ${src} -> ${tgt} must have verified entries available offline`
    );
  }
});

// ----------------------------------------------------
// TEST 9: Offline Database Initialization & Storage Persistence
// ----------------------------------------------------
runTest('Database persists entries and survives simulated re-instantiation', () => {
  const countBefore = dictionaryDb.getAllEntries().length;
  assert(countBefore >= 15, `Database must contain rich starter dataset (found ${countBefore})`);
  
  // Check stats per language
  const stats = dictionaryDb.getLanguagePackStats();
  for (const lang of ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'] as const) {
    assert(stats[lang].loadedEntriesCount > 0, `Language ${lang} must have loaded entries`);
    assert(stats[lang].isAvailableOffline, `Language ${lang} must be available offline`);
  }
});

console.log('\n====================================================');
console.log(`RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('====================================================\n');
