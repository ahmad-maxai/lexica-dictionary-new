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

// ====================================================
// SECTION 1: THE 10 MINIMUM REQUIRED BIDIRECTIONAL PAIRS
// ====================================================

// 1. English -> Hausa
runTest('1. English -> Hausa: Search "Water" finds "Ruwa"', () => {
  const results = dictionaryDb.search('Water', 'en', 'ha');
  assert(results.length > 0, 'Must find result for "Water" in en -> ha');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'en');
  assert(match.translations.ha && match.translations.ha.length > 0);
  assert(match.translations.ha.some((t) => t.headword.includes('Ruwa')));
});

// 2. Hausa -> English
runTest('2. Hausa -> English: Search "Ruwa" finds "Water"', () => {
  const results = dictionaryDb.search('Ruwa', 'ha', 'en');
  assert(results.length > 0, 'Must find result for "Ruwa" in ha -> en');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'ha');
  assert(match.translations.en && match.translations.en.length > 0);
  assert(match.translations.en.some((t) => t.headword.includes('Water')));
});

// 3. English -> Yoruba
runTest('3. English -> Yoruba: Search "Water" finds "Omi"', () => {
  const results = dictionaryDb.search('Water', 'en', 'yo');
  assert(results.length > 0, 'Must find result for "Water" in en -> yo');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'en');
  assert(match.translations.yo && match.translations.yo.length > 0);
  assert(match.translations.yo.some((t) => t.headword.includes('Omi')));
});

// 4. Yoruba -> English
runTest('4. Yoruba -> English: Search "Omi" finds "Water"', () => {
  const results = dictionaryDb.search('Omi', 'yo', 'en');
  assert(results.length > 0, 'Must find result for "Omi" in yo -> en');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'yo');
  assert(match.translations.en && match.translations.en.length > 0);
  assert(match.translations.en.some((t) => t.headword.includes('Water')));
});

// 5. English -> Arabic
runTest('5. English -> Arabic: Search "Water" finds "مَاء"', () => {
  const results = dictionaryDb.search('Water', 'en', 'ar');
  assert(results.length > 0, 'Must find result for "Water" in en -> ar');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'en');
  assert(match.translations.ar && match.translations.ar.length > 0);
  assert(match.translations.ar.some((t) => t.headword.includes('ماء') || t.headword.includes('مَاء')));
});

// 6. Arabic -> English
runTest('6. Arabic -> English: Search "مَاء" finds "Water"', () => {
  const results = dictionaryDb.search('مَاء', 'ar', 'en');
  assert(results.length > 0, 'Must find result for "مَاء" in ar -> en');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'ar');
  assert(match.translations.en && match.translations.en.length > 0);
  assert(match.translations.en.some((t) => t.headword.includes('Water')));
});

// 7. English -> French
runTest('7. English -> French: Search "Water" finds "Eau"', () => {
  const results = dictionaryDb.search('Water', 'en', 'fr');
  assert(results.length > 0, 'Must find result for "Water" in en -> fr');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'en');
  assert(match.translations.fr && match.translations.fr.length > 0);
  assert(match.translations.fr.some((t) => t.headword.includes('Eau')));
});

// 8. French -> English
runTest('8. French -> English: Search "Eau" finds "Water"', () => {
  const results = dictionaryDb.search('Eau', 'fr', 'en');
  assert(results.length > 0, 'Must find result for "Eau" in fr -> en');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'fr');
  assert(match.translations.en && match.translations.en.length > 0);
  assert(match.translations.en.some((t) => t.headword.includes('Water')));
});

// 9. English -> Chinese
runTest('9. English -> Chinese: Search "Water" finds "水"', () => {
  const results = dictionaryDb.search('Water', 'en', 'zh');
  assert(results.length > 0, 'Must find result for "Water" in en -> zh');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'en');
  assert(match.translations.zh && match.translations.zh.length > 0);
  assert(match.translations.zh.some((t) => t.headword.includes('水')));
});

// 10. Chinese -> English
runTest('10. Chinese -> English: Search "水" finds "Water"', () => {
  const results = dictionaryDb.search('水', 'zh', 'en');
  assert(results.length > 0, 'Must find result for "水" in zh -> en');
  const match = results[0];
  assert.strictEqual(match.sourceLang, 'zh');
  assert(match.translations.en && match.translations.en.length > 0);
  assert(match.translations.en.some((t) => t.headword.includes('Water')));
});

// ====================================================
// SECTION 2: SPECIAL CHARACTERS & ORTHOGRAPHY
// ====================================================

// 11. Arabic Harakat (Tashkeel) and Root Matching
runTest('11. Arabic Harakat: Search works identically with and without Tashkeel', () => {
  const withDiacritics = dictionaryDb.search('خَيْرٌ', 'ar', 'ha');
  const withoutDiacritics = dictionaryDb.search('خير', 'ar', 'ha');
  assert(withDiacritics.length > 0, 'Search with Tashkeel "خَيْرٌ" must find entry');
  assert(withoutDiacritics.length > 0, 'Search without Tashkeel "خير" must find entry');
  assert.strictEqual(withDiacritics[0].id, withoutDiacritics[0].id);

  // Test Salam
  const salamWithTashkeel = dictionaryDb.search('سَلَام', 'ar', 'en');
  const salamBare = dictionaryDb.search('سلام', 'ar', 'en');
  assert(salamWithTashkeel.length > 0);
  assert(salamBare.length > 0);
  assert.strictEqual(salamWithTashkeel[0].id, salamBare[0].id);
});

// 12. Yoruba Tone Marks and Sub-dots
runTest('12. Yoruba Tones: Exact diacritics and ASCII keyboard fallback', () => {
  const exact = dictionaryDb.search('Àlàáfíà', 'yo', 'en');
  const fallback = dictionaryDb.search('alafia', 'yo', 'en');
  assert(exact.length > 0, 'Exact tone "Àlàáfíà" must find entry');
  assert(fallback.length > 0, 'ASCII "alafia" must find entry via soft normalization');
  assert.strictEqual(exact[0].id, fallback[0].id);

  // Wisdom: Ọgbọ́n vs ogbon
  const ogbonExact = dictionaryDb.search('Ọgbọ́n', 'yo', 'en');
  const ogbonFallback = dictionaryDb.search('ogbon', 'yo', 'en');
  assert(ogbonExact.length > 0, '"Ọgbọ́n" must be found');
  assert(ogbonFallback.length > 0, '"ogbon" must be found');
  assert.strictEqual(ogbonExact[0].id, ogbonFallback[0].id);
});

// 13. Hausa Hooked Consonants (Ƙ, Ɓ, Ɗ, Ƴ)
runTest('13. Hausa Hooked Consonants: Hooked Ƙ and standard k', () => {
  const hooked = dictionaryDb.search('Ƙofa', 'ha', 'en');
  const standard = dictionaryDb.search('kofa', 'ha', 'en');
  assert(hooked.length > 0, 'Search with hooked Ƙ "Ƙofa" must find entry');
  assert(standard.length > 0, 'Search with standard k "kofa" must find entry');
  assert.strictEqual(hooked[0].id, standard[0].id);
});

// 14. Chinese Hanzi and Pinyin with/without Tonal Marks
runTest('14. Chinese: Hanzi, Pinyin with tones, and bare Pinyin', () => {
  const hanzi = dictionaryDb.search('善', 'zh', 'en');
  const pinyinWithTone = dictionaryDb.search('shàn', 'zh', 'en');
  const pinyinBare = dictionaryDb.search('shan', 'zh', 'en');
  assert(hanzi.length > 0, 'Hanzi "善" must find entry');
  assert(pinyinWithTone.length > 0, 'Pinyin with tone "shàn" must find entry');
  assert(pinyinBare.length > 0, 'Pinyin without tone "shan" must find entry');
  assert.strictEqual(hanzi[0].id, pinyinWithTone[0].id);
  assert.strictEqual(hanzi[0].id, pinyinBare[0].id);

  // Peace: 和平 vs heping
  const heping = dictionaryDb.search('和平', 'zh', 'en');
  const hepingPinyin = dictionaryDb.search('heping', 'zh', 'en');
  assert(heping.length > 0);
  assert(hepingPinyin.length > 0);
  assert.strictEqual(heping[0].id, hepingPinyin[0].id);
});

// 15. French Accents & Ligatures
runTest('15. French: Accented and unaccented search', () => {
  const accented = dictionaryDb.search('Mère', 'fr', 'en');
  const unaccented = dictionaryDb.search('mere', 'fr', 'en');
  assert(accented.length > 0, 'Accented "Mère" must find entry');
  assert(unaccented.length > 0, 'Unaccented "mere" must find entry');
  assert.strictEqual(accented[0].id, unaccented[0].id);

  // Coeur / Cœur
  const coeur = dictionaryDb.search('coeur', 'fr', 'en');
  assert(coeur.length > 0, '"coeur" must find Cœur entry');
});

// ====================================================
// SECTION 3: CASE, PARTIAL, MISSING & ISOLATION
// ====================================================

// 16. Case Insensitivity
runTest('16. Case Handling: UPPERCASE, lowercase, and TitleCase', () => {
  const lower = dictionaryDb.search('water', 'en', 'ha');
  const upper = dictionaryDb.search('WATER', 'en', 'ha');
  const title = dictionaryDb.search('Water', 'en', 'ha');
  assert(lower.length > 0);
  assert(upper.length > 0);
  assert(title.length > 0);
  assert.strictEqual(lower[0].id, upper[0].id);
  assert.strictEqual(lower[0].id, title[0].id);
});

// 17. Partial Prefix Search
runTest('17. Partial Prefix Search: "wat" finds "Water", "ruw" finds "Ruwa"', () => {
  const partialEn = dictionaryDb.search('wat', 'en', 'ha');
  const partialHa = dictionaryDb.search('ruw', 'ha', 'en');
  assert(partialEn.length > 0, '"wat" must find Water');
  assert(partialHa.length > 0, '"ruw" must find Ruwa');
  assert(partialEn.some((e) => e.headword.toLowerCase().includes('water')));
  assert(partialHa.some((e) => e.headword.toLowerCase().includes('ruwa')));
});

// 18. Missing / Nonexistent Word
runTest('18. Missing Words: Nonexistent queries return empty array without throwing', () => {
  const missing = dictionaryDb.search('xyz99nonexistentword', 'en', 'ha');
  assert.strictEqual(missing.length, 0, 'Nonexistent word must return empty array');
});

// 19. Language Pair Isolation
runTest('19. Pair Isolation: Search results do NOT mix unrelated language pairs', () => {
  const results = dictionaryDb.search('', 'ar', 'ha');
  assert(results.length > 0, 'Must have entries');
  for (const entry of results) {
    const isAr = entry.sourceLang === 'ar' && !!entry.translations.ha?.length;
    const isHa = entry.sourceLang === 'ha' && !!entry.translations.ar?.length;
    assert(isAr || isHa, `Entry ${entry.id} must be strictly within ar <-> ha pair`);
  }
});

// 20. Offline Database Integrity across all 7 launch languages
runTest('20. Offline Database: All 7 launch languages populated and available offline', () => {
  const stats = dictionaryDb.getLanguagePackStats();
  const languages = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'] as const;
  for (const lang of languages) {
    assert(stats[lang].loadedEntriesCount >= 17, `Language ${lang} must have >= 17 entries`);
    assert(stats[lang].isAvailableOffline, `Language ${lang} must be available offline`);
    assert(stats[lang].verifiedDirectedPairsCount >= 6, `Language ${lang} must connect to other languages`);
  }
});

console.log('\n====================================================');
console.log(`RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('====================================================\n');
