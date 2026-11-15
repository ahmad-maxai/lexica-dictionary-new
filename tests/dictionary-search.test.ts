import assert from 'node:assert';
import { dictionaryDb } from '../src/services/dictionaryDatabase';
import { WordEntry } from '../src/types/dictionary';

console.log('==============================================================');
console.log('LEXICA TWO-ENGINE DICTIONARY — AUTOMATED VERIFICATION SUITE');
console.log('==============================================================\n');

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

// ======================================================================
// SECTION 1: ENGINE 1 — STANDARD MONOLINGUAL DICTIONARY SEARCH
// ======================================================================

runTest('1.1 Standard (EN): "Water" returns multi-sense entry, IPA, morphology & synonyms', () => {
  const res = dictionaryDb.searchStandard('Water', 'en');
  assert.strictEqual(res.status, 'ok');
  assert(res.results.length > 0);
  const top = res.results[0];
  assert.strictEqual(top.entry.sourceLang, 'en');
  assert.strictEqual(top.entry.headword, 'Water');
  assert(top.senses.length >= 2, 'Water must expose >= 2 structured senses');
  assert(top.morphologicalForms.length >= 3, 'Water must expose morphological forms');
  assert(top.entry.synonyms.length > 0, 'Water must include synonyms');
});

runTest('1.2 Standard (EN): Browse mode returns all English entries without targetLang', () => {
  const res = dictionaryDb.searchStandard('', 'en');
  assert.strictEqual(res.status, 'browse');
  assert(res.results.length >= 69, `Expected >= 69 English entries, got ${res.results.length}`);
});

runTest('1.3 Standard (HA): Hausa monolingual lookup ("Ruwa", hooked "Ƙofa")', () => {
  const ruwa = dictionaryDb.searchStandard('Ruwa', 'ha');
  assert.strictEqual(ruwa.status, 'ok');
  assert.strictEqual(ruwa.results[0].entry.headword, 'Ruwa');

  const kofaHooked = dictionaryDb.searchStandard('Ƙofa', 'ha');
  const kofaAscii = dictionaryDb.searchStandard('kofa', 'ha');
  assert.strictEqual(kofaHooked.status, 'ok');
  assert.strictEqual(kofaAscii.status, 'ok');
  assert.strictEqual(kofaHooked.results[0].entry.id, kofaAscii.results[0].entry.id);
});

runTest('1.4 Standard (YO): Yoruba monolingual lookup with tone marks & ASCII fallback', () => {
  const exact = dictionaryDb.searchStandard('Àlàáfíà', 'yo');
  const ascii = dictionaryDb.searchStandard('alafia', 'yo');
  assert.strictEqual(exact.status, 'ok');
  assert.strictEqual(ascii.status, 'ok');
  assert.strictEqual(exact.results[0].entry.id, ascii.results[0].entry.id);
});

runTest('1.5 Standard (FF): Fulfulde monolingual lookup & hooked orthography', () => {
  const suudu = dictionaryDb.searchStandard('Suudu', 'ff');
  assert.strictEqual(suudu.status, 'ok');
  assert.strictEqual(suudu.results[0].entry.sourceLang, 'ff');

  const munal = dictionaryDb.searchStandard('Muñal', 'ff');
  const munalAscii = dictionaryDb.searchStandard('munal', 'ff');
  assert.strictEqual(munal.status, 'ok');
  assert.strictEqual(munalAscii.status, 'ok');
  assert.strictEqual(munal.results[0].entry.id, munalAscii.results[0].entry.id);
});

runTest('1.6 Standard (AR): Arabic monolingual lookup with & without Tashkeel', () => {
  const exact = dictionaryDb.searchStandard('خَيْرٌ', 'ar');
  const bare = dictionaryDb.searchStandard('خير', 'ar');
  assert.strictEqual(exact.status, 'ok');
  assert.strictEqual(bare.status, 'ok');
  assert.strictEqual(exact.results[0].entry.id, bare.results[0].entry.id);
  assert(exact.results[0].senses.length >= 2, 'Arabic خَيْرٌ must expose 2 senses');
});

runTest('1.7 Standard (FR): French monolingual lookup with accents & ligatures', () => {
  const mere = dictionaryDb.searchStandard('mere', 'fr');
  assert.strictEqual(mere.status, 'ok');
  assert.strictEqual(mere.results[0].entry.headword, 'Mère / Maman');

  const coeur = dictionaryDb.searchStandard('coeur', 'fr');
  assert.strictEqual(coeur.status, 'ok');
  assert.strictEqual(coeur.results[0].entry.headword, 'Cœur');
});

runTest('1.8 Standard (ZH): Chinese monolingual lookup via Hanzi, tonal Pinyin & bare Pinyin', () => {
  const hanzi = dictionaryDb.searchStandard('善', 'zh');
  const pinyinTone = dictionaryDb.searchStandard('shàn', 'zh');
  const pinyinBare = dictionaryDb.searchStandard('shan', 'zh');
  assert.strictEqual(hanzi.status, 'ok');
  assert.strictEqual(pinyinTone.status, 'ok');
  assert.strictEqual(pinyinBare.status, 'ok');
  assert.strictEqual(hanzi.results[0].entry.id, pinyinTone.results[0].entry.id);
  assert.strictEqual(hanzi.results[0].entry.id, pinyinBare.results[0].entry.id);
});

runTest('1.9 Standard Morphology Search: Inflected forms match base entries across languages', () => {
  const men = dictionaryDb.searchStandard('men', 'en');
  assert.strictEqual(men.status, 'ok');
  assert.strictEqual(men.results[0].entry.headword, 'Man');
  assert.strictEqual(men.results[0].matchedField, 'morphology');

  const went = dictionaryDb.searchStandard('went', 'en');
  assert.strictEqual(went.status, 'ok');
  assert.strictEqual(went.results[0].entry.headword, 'Go / Travel');

  const gidaje = dictionaryDb.searchStandard('gidaje', 'ha');
  assert.strictEqual(gidaje.status, 'ok');
  assert.strictEqual(gidaje.results[0].entry.headword, 'Gida');

  const cuudi = dictionaryDb.searchStandard('cuuɗi', 'ff');
  assert.strictEqual(cuudi.status, 'ok');
  assert.strictEqual(cuudi.results[0].entry.headword, 'Suudu');

  const miyah = dictionaryDb.searchStandard('مِيَاه', 'ar');
  assert.strictEqual(miyah.status, 'ok');
  assert.strictEqual(miyah.results[0].entry.headword, 'مَاء');

  const eaux = dictionaryDb.searchStandard('eaux', 'fr');
  assert.strictEqual(eaux.status, 'ok');
  assert.strictEqual(eaux.results[0].entry.headword, 'Eau');
});

runTest('1.10 Standard Synonym Search: "serenity" finds "Peace"', () => {
  const res = dictionaryDb.searchStandard('serenity', 'en');
  assert.strictEqual(res.status, 'ok');
  assert(res.results.some((r) => r.entry.headword === 'Peace'));
});

runTest('1.11 Standard Explicit Failure States: not_found, no_definition & language_not_installed', () => {
  const missing = dictionaryDb.searchStandard('xyz99nonexistentword', 'en');
  assert.strictEqual(missing.status, 'not_found');
  assert.strictEqual(missing.results.length, 0);

  // Temporarily register a headword without any definition
  const emptyDefEntry: WordEntry = {
    id: 'test-no-def-en',
    sourceLang: 'en',
    headword: 'Zetamockterm',
    ipa: '/ˈzeɪ.tə/',
    partOfSpeech: 'noun',
    definition: '',
    definitionEn: '',
    translations: {},
    examples: [],
    synonyms: [],
    antonyms: [],
    verifiedOffline: false,
    tags: [],
  };
  dictionaryDb.upsertEntry(emptyDefEntry);
  try {
    const noDef = dictionaryDb.searchStandard('Zetamockterm', 'en');
    assert.strictEqual(noDef.status, 'no_definition');
  } finally {
    dictionaryDb.removeEntry('test-no-def-en');
  }

  // Test language_not_installed enforcement
  dictionaryDb.setPackInstalled('ff', false);
  try {
    const uninstalled = dictionaryDb.searchStandard('Suudu', 'ff');
    assert.strictEqual(uninstalled.status, 'language_not_installed');
    assert.strictEqual(uninstalled.results.length, 0);
  } finally {
    dictionaryDb.setPackInstalled('ff', true);
  }
});

// ======================================================================
// SECTION 2: ENGINE 2 — MULTILINGUAL DICTIONARY SEARCH
// ======================================================================

runTest('2.1 English <-> Hausa bidirectional sense-level lookup', () => {
  const enToHa = dictionaryDb.searchMultilingual('Water', 'en', 'ha');
  assert.strictEqual(enToHa.status, 'ok');
  assert.strictEqual(enToHa.results[0].entry.sourceLang, 'en');
  assert(
    enToHa.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Ruwa')),
    'en->ha Water must link to Ruwa'
  );

  const haToEn = dictionaryDb.searchMultilingual('Ruwa', 'ha', 'en');
  assert.strictEqual(haToEn.status, 'ok');
  assert.strictEqual(haToEn.results[0].entry.sourceLang, 'ha');
  assert(
    haToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')),
    'ha->en Ruwa must link to Water'
  );
});

runTest('2.2 English <-> Yoruba bidirectional lookup & contextual equivalence', () => {
  const enToYo = dictionaryDb.searchMultilingual('Peace', 'en', 'yo');
  assert.strictEqual(enToYo.status, 'ok');
  const alafiaRel = enToYo.results[0].senseMatches.find((sm) =>
    sm.relationship.targetHeadword.includes('Àlàáfíà')
  )?.relationship;
  assert(alafiaRel, 'en->yo Peace must link to Àlàáfíà');
  assert.strictEqual(alafiaRel.equivalenceType, 'contextual');
  assert(alafiaRel.contextualNote && alafiaRel.contextualNote.length > 0);

  const yoToEn = dictionaryDb.searchMultilingual('Omi', 'yo', 'en');
  assert.strictEqual(yoToEn.status, 'ok');
  assert(yoToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')));
});

runTest('2.3 English <-> Arabic bidirectional lookup & Tashkeel normalization', () => {
  const enToAr = dictionaryDb.searchMultilingual('Water', 'en', 'ar');
  assert.strictEqual(enToAr.status, 'ok');
  assert(
    enToAr.results[0].senseMatches.some(
      (sm) => sm.relationship.targetHeadword.includes('ماء') || sm.relationship.targetHeadword.includes('مَاء')
    )
  );

  const arToEn = dictionaryDb.searchMultilingual('سلام', 'ar', 'en');
  assert.strictEqual(arToEn.status, 'ok');
  assert(arToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Peace')));
});

runTest('2.4 English <-> French & Arabic <-> French lookups', () => {
  const enToFr = dictionaryDb.searchMultilingual('Water', 'en', 'fr');
  assert.strictEqual(enToFr.status, 'ok');
  assert(enToFr.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Eau')));

  const frToEn = dictionaryDb.searchMultilingual('Eau', 'fr', 'en');
  assert.strictEqual(frToEn.status, 'ok');
  assert(frToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')));

  const arToFr = dictionaryDb.searchMultilingual('خَيْرٌ', 'ar', 'fr');
  assert.strictEqual(arToFr.status, 'ok');
  assert(arToFr.results[0].senseMatches.length > 0);
});

runTest('2.5 English <-> Chinese bidirectional lookup (Hanzi + Pinyin)', () => {
  const enToZh = dictionaryDb.searchMultilingual('Water', 'en', 'zh');
  assert.strictEqual(enToZh.status, 'ok');
  assert(enToZh.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('水')));

  const zhToEn = dictionaryDb.searchMultilingual('水', 'zh', 'en');
  assert.strictEqual(zhToEn.status, 'ok');
  assert(zhToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')));

  const hepingEn = dictionaryDb.searchMultilingual('heping', 'zh', 'en');
  assert.strictEqual(hepingEn.status, 'ok');
  assert(hepingEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Peace')));
});

runTest('2.6 Multilingual Reverse Lookup: Searching target term finds pair & flags isReverseLookup', () => {
  const reverse = dictionaryDb.searchMultilingual('Ruwa', 'en', 'ha');
  assert.strictEqual(reverse.status, 'ok');
  assert(reverse.results.length > 0);
  assert.strictEqual(reverse.results[0].isReverseLookup, true);
});

runTest('2.7 Multilingual Idiomatic Equivalence Detection', () => {
  const idiomRes = dictionaryDb.searchMultilingual('Ƙarfin hali', 'ha', 'en');
  assert.strictEqual(idiomRes.status, 'ok');
  const link = idiomRes.results[0].senseMatches[0].relationship;
  assert.strictEqual(link.equivalenceType, 'idiomatic');
  assert(link.contextualNote && link.contextualNote.toLowerCase().includes('idiomatic'));
});

runTest('2.8 Multilingual Statuses: invalid_pair, no_translation, language_not_installed & not_found', () => {
  const invalid = dictionaryDb.searchMultilingual('Water', 'en', 'en');
  assert.strictEqual(invalid.status, 'invalid_pair');

  const missing = dictionaryDb.searchMultilingual('xyz99nonexistentword', 'en', 'ha');
  assert.strictEqual(missing.status, 'not_found');
  assert.strictEqual(missing.existsInStandardDictionary, false);

  // Monolingual-only word with NO translation links
  const monolingualOnly: WordEntry = {
    id: 'test-mono-only-en',
    sourceLang: 'en',
    headword: 'Monolithsample',
    ipa: '/ˈmɒn.ə.lɪθ/',
    partOfSpeech: 'noun',
    definition: 'A large single upright block of stone.',
    definitionEn: 'A large single upright block of stone.',
    translations: {},
    examples: [],
    synonyms: [],
    antonyms: [],
    verifiedOffline: false,
    tags: [],
  };
  dictionaryDb.upsertEntry(monolingualOnly);
  try {
    const stdFound = dictionaryDb.searchStandard('Monolithsample', 'en');
    assert.strictEqual(stdFound.status, 'ok', 'Monolingual entry must still work in Engine 1');

    const noTrans = dictionaryDb.searchMultilingual('Monolithsample', 'en', 'ha');
    assert.strictEqual(noTrans.status, 'no_translation');
    assert.strictEqual(noTrans.existsInStandardDictionary, true);
  } finally {
    dictionaryDb.removeEntry('test-mono-only-en');
  }

  // Uninstall target language and verify Multilingual engine blocks queries cleanly
  dictionaryDb.setPackInstalled('yo', false);
  try {
    const blocked = dictionaryDb.searchMultilingual('Water', 'en', 'yo');
    assert.strictEqual(blocked.status, 'language_not_installed');
  } finally {
    dictionaryDb.setPackInstalled('yo', true);
  }
});

// ======================================================================
// SECTION 3: CASE, PARTIAL & SHARED DATA INTEGRITY
// ======================================================================

runTest('3.1 Case Insensitivity & Partial Prefix Searches in Both Engines', () => {
  const stdUpper = dictionaryDb.searchStandard('WATER', 'en');
  const stdPrefix = dictionaryDb.searchStandard('wat', 'en');
  assert.strictEqual(stdUpper.status, 'ok');
  assert.strictEqual(stdPrefix.status, 'ok');
  assert.strictEqual(stdUpper.results[0].entry.headword, 'Water');
  assert(stdPrefix.results.some((r) => r.entry.headword === 'Water'));

  const multiPrefix = dictionaryDb.searchMultilingual('ruw', 'ha', 'en');
  assert.strictEqual(multiPrefix.status, 'ok');
  assert(multiPrefix.results.some((r) => r.entry.headword === 'Ruwa'));
});

runTest('3.2 Honest Offline Dataset Integrity & Zero Fake Sizes', () => {
  const stats = dictionaryDb.getLanguagePackStats();
  const languages = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'] as const;
  let totalEntries = 0;
  let totalSenses = 0;
  let totalBytes = 0;

  for (const lang of languages) {
    assert(stats[lang].loadedEntriesCount >= 69, `${lang} must have real bundled entries`);
    assert(stats[lang].isInstalled, `${lang} must be installed by default`);
    assert(stats[lang].actualSizeBytes > 50_000, `${lang} real serialized size must be > 50 KB`);
    assert(stats[lang].actualSizeMb < 1.0, `${lang} real starter size must NOT be inflated`);
    totalEntries += stats[lang].loadedEntriesCount;
    totalSenses += stats[lang].sensesCount;
    totalBytes += stats[lang].actualSizeBytes;
  }

  const totalRels = dictionaryDb.getTotalTranslationRelationshipsCount();
  console.log('\n--- LIVE DATASET SUMMARY ---');
  console.log(`Total Entries: ${totalEntries}`);
  console.log(`Total Senses:  ${totalSenses}`);
  console.log(`Total Translation Relationships: ${totalRels}`);
  console.log(`Total Serialized Corpus Size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB (${totalBytes} bytes)`);
  for (const lang of languages) {
    console.log(
      `  [${lang.toUpperCase()}] entries=${stats[lang].loadedEntriesCount}, senses=${stats[lang].sensesCount}, rels=${stats[lang].translationRelationshipsCount}, size=${Math.round(stats[lang].actualSizeBytes / 1024)} KB`
    );
  }
  console.log('----------------------------\n');
});

console.log('\n==============================================================');
console.log(`RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('==============================================================\n');
