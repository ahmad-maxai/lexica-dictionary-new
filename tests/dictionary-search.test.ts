import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dictionaryDb } from '../src/services/dictionaryDatabase';
import { sqliteManager } from '../src/services/sqliteAdapter';
import { packManager } from '../src/services/packManager';
import { LanguageCode, PackDownloadProgress, WordEntry } from '../src/types/dictionary';

console.log('==============================================================');
console.log('LEXICA SQLITE + FTS5 TWO-ENGINE DICTIONARY — VERIFICATION SUITE');
console.log('==============================================================\n');

const tempTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lexica-sqlite-test-'));
const tempStateDir = path.join(tempTestRoot, 'state');
const tempPackDir = path.join(tempTestRoot, 'packs');
fs.mkdirSync(tempStateDir, { recursive: true });
fs.mkdirSync(tempPackDir, { recursive: true });

sqliteManager.configureNodeDirs({ stateDir: tempStateDir });
packManager.configureForTests({
  nodePackDir: tempPackDir,
  fetchImpl: async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const match = urlStr.match(/lexica_pack_(en|ha|yo|ff|ar|fr|zh)\.sqlite\.gz/);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }
    const gzPath = path.resolve(process.cwd(), 'packs', `lexica_pack_${match[1]}.sqlite.gz`);
    const fileBytes = fs.readFileSync(gzPath);
    const total = fileBytes.byteLength;
    const chunkSize = Math.max(64 * 1024, Math.floor(total / 6));
    let offset = 0;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (init?.signal?.aborted) {
          controller.error(new DOMException('Download cancelled', 'AbortError'));
          return;
        }
        await new Promise((r) => setTimeout(r, 10));
        if (init?.signal?.aborted) {
          controller.error(new DOMException('Download cancelled', 'AbortError'));
          return;
        }
        if (offset >= total) {
          controller.close();
          return;
        }
        const end = Math.min(total, offset + chunkSize);
        controller.enqueue(new Uint8Array(fileBytes.subarray(offset, end)));
        offset = end;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-length': String(total) },
    });
  },
});

let passedTests = 0;
let totalTests = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passedTests++;
  } catch (err: unknown) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  await dictionaryDb.initialize();

  // ======================================================================
  // SECTION 1: ENGINE A — STANDARD MONOLINGUAL DICTIONARY SEARCH (SQLite)
  // ======================================================================

  await runTest('1.1 Standard (EN): "Water" returns multi-sense entry, IPA, morphology & synonyms', async () => {
    const res = await dictionaryDb.searchStandard('Water', 'en');
    assert.strictEqual(res.status, 'ok');
    assert(res.results.length > 0);
    const top = res.results[0];
    assert.strictEqual(top.entry.sourceLang, 'en');
    assert.strictEqual(top.entry.headword, 'Water');
    assert(top.senses.length >= 2, 'Water must expose >= 2 structured senses');
    assert(top.morphologicalForms.length >= 3, 'Water must expose morphological forms');
    assert(top.entry.synonyms.length > 0, 'Water must include synonyms');
  });

  await runTest('1.2 Standard (EN): Browse mode pages cleanly without loading giant JS arrays', async () => {
    const res = await dictionaryDb.searchStandard('', 'en');
    assert.strictEqual(res.status, 'browse');
    assert(res.results.length >= 40, `Expected paged SQLite browse results >= 40, got ${res.results.length}`);
  });

  await runTest('1.3 Standard (HA): Hausa monolingual lookup ("Ruwa", hooked "Ƙofa")', async () => {
    const ruwa = await dictionaryDb.searchStandard('Ruwa', 'ha');
    assert.strictEqual(ruwa.status, 'ok');
    assert.strictEqual(ruwa.results[0].entry.headword, 'Ruwa');

    const kofaHooked = await dictionaryDb.searchStandard('Ƙofa', 'ha');
    const kofaAscii = await dictionaryDb.searchStandard('kofa', 'ha');
    assert.strictEqual(kofaHooked.status, 'ok');
    assert.strictEqual(kofaAscii.status, 'ok');
    assert.strictEqual(kofaHooked.results[0].entry.id, kofaAscii.results[0].entry.id);
  });

  await runTest('1.4 Standard (YO): Yoruba monolingual lookup with tone marks & ASCII fallback', async () => {
    const exact = await dictionaryDb.searchStandard('Àlàáfíà', 'yo');
    const ascii = await dictionaryDb.searchStandard('alafia', 'yo');
    assert.strictEqual(exact.status, 'ok');
    assert.strictEqual(ascii.status, 'ok');
    assert.strictEqual(exact.results[0].entry.id, ascii.results[0].entry.id);
  });

  await runTest('1.5 Standard (FF): Fulfulde monolingual lookup & hooked orthography', async () => {
    const suudu = await dictionaryDb.searchStandard('Suudu', 'ff');
    assert.strictEqual(suudu.status, 'ok');
    assert.strictEqual(suudu.results[0].entry.sourceLang, 'ff');

    const munal = await dictionaryDb.searchStandard('Muñal', 'ff');
    const munalAscii = await dictionaryDb.searchStandard('munal', 'ff');
    assert.strictEqual(munal.status, 'ok');
    assert.strictEqual(munalAscii.status, 'ok');
    assert.strictEqual(munal.results[0].entry.id, munalAscii.results[0].entry.id);
  });

  await runTest('1.6 Standard (AR): Arabic monolingual lookup with & without Tashkeel', async () => {
    const exact = await dictionaryDb.searchStandard('خَيْرٌ', 'ar');
    const bare = await dictionaryDb.searchStandard('خير', 'ar');
    assert.strictEqual(exact.status, 'ok');
    assert.strictEqual(bare.status, 'ok');
    assert(
      bare.results.some((r) => r.entry.id === exact.results[0].entry.id),
      'Unvocalized خير must retrieve the vocalized خَيْرٌ entry'
    );
    assert(exact.results[0].senses.length >= 2, 'Arabic خَيْرٌ must expose 2 senses');
  });

  await runTest('1.7 Standard (FR): French monolingual lookup with accents & ligatures', async () => {
    const mere = await dictionaryDb.searchStandard('mere', 'fr');
    assert.strictEqual(mere.status, 'ok');
    assert.strictEqual(mere.results[0].entry.headword, 'Mère / Maman');

    const coeur = await dictionaryDb.searchStandard('coeur', 'fr');
    assert.strictEqual(coeur.status, 'ok');
    assert.strictEqual(coeur.results[0].entry.headword, 'Cœur');
  });

  await runTest('1.8 Standard (ZH): Chinese monolingual lookup via Hanzi, tonal Pinyin & bare Pinyin', async () => {
    const hanzi = await dictionaryDb.searchStandard('善', 'zh');
    const pinyinTone = await dictionaryDb.searchStandard('shàn', 'zh');
    const pinyinBare = await dictionaryDb.searchStandard('shan', 'zh');
    assert.strictEqual(hanzi.status, 'ok');
    assert.strictEqual(pinyinTone.status, 'ok');
    assert.strictEqual(pinyinBare.status, 'ok');
    assert.strictEqual(hanzi.results[0].entry.id, pinyinTone.results[0].entry.id);
    assert.strictEqual(hanzi.results[0].entry.id, pinyinBare.results[0].entry.id);
  });

  await runTest('1.9 Standard Morphology Search: Inflected forms match base entries across languages', async () => {
    const men = await dictionaryDb.searchStandard('men', 'en');
    assert.strictEqual(men.status, 'ok');
    assert.strictEqual(men.results[0].entry.headword, 'Man');
    assert.strictEqual(men.results[0].matchedField, 'morphology');

    const went = await dictionaryDb.searchStandard('went', 'en');
    assert.strictEqual(went.status, 'ok');
    assert(
      went.results.some((r) => r.entry.headword.toLowerCase().includes('go')),
      'went must match Go verb entry'
    );

    const gidaje = await dictionaryDb.searchStandard('gidaje', 'ha');
    assert.strictEqual(gidaje.status, 'ok');
    assert.strictEqual(gidaje.results[0].entry.headword, 'Gida');

    const cuudi = await dictionaryDb.searchStandard('cuuɗi', 'ff');
    assert.strictEqual(cuudi.status, 'ok');
    assert.strictEqual(cuudi.results[0].entry.headword, 'Suudu');

    const miyah = await dictionaryDb.searchStandard('مِيَاه', 'ar');
    assert.strictEqual(miyah.status, 'ok');
    assert.strictEqual(miyah.results[0].entry.headword, 'مَاء');

    const eaux = await dictionaryDb.searchStandard('eaux', 'fr');
    assert.strictEqual(eaux.status, 'ok');
    assert.strictEqual(eaux.results[0].entry.headword, 'Eau');
  });

  await runTest('1.10 Standard Synonym Search: "serenity" finds "Peace"', async () => {
    const res = await dictionaryDb.searchStandard('serenity', 'en');
    assert.strictEqual(res.status, 'ok');
    assert(res.results.some((r) => r.entry.headword === 'Peace'));
  });

  await runTest('1.11 Standard Explicit Failure States: not_found, no_definition & language_not_installed', async () => {
    const missing = await dictionaryDb.searchStandard('xyz99nonexistentword', 'en');
    assert.strictEqual(missing.status, 'not_found');
    assert.strictEqual(missing.results.length, 0);

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
    await dictionaryDb.upsertEntry(emptyDefEntry);
    try {
      const noDef = await dictionaryDb.searchStandard('Zetamockterm', 'en');
      assert.strictEqual(noDef.status, 'no_definition');
    } finally {
      await dictionaryDb.removeEntry('test-no-def-en');
    }

    await dictionaryDb.setPackInstalled('ff', false);
    try {
      const uninstalled = await dictionaryDb.searchStandard('Suudu', 'ff');
      assert.strictEqual(uninstalled.status, 'language_not_installed');
      assert.strictEqual(uninstalled.results.length, 0);
    } finally {
      await dictionaryDb.setPackInstalled('ff', true);
    }
  });

  // ======================================================================
  // SECTION 2: ENGINE B — MULTILINGUAL DICTIONARY SEARCH (SQLite)
  // ======================================================================

  await runTest('2.1 English <-> Hausa bidirectional sense-level lookup', async () => {
    const enToHa = await dictionaryDb.searchMultilingual('Water', 'en', 'ha');
    assert.strictEqual(enToHa.status, 'ok');
    assert.strictEqual(enToHa.results[0].entry.sourceLang, 'en');
    assert(
      enToHa.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Ruwa')),
      'en->ha Water must link to Ruwa'
    );

    const haToEn = await dictionaryDb.searchMultilingual('Ruwa', 'ha', 'en');
    assert.strictEqual(haToEn.status, 'ok');
    assert.strictEqual(haToEn.results[0].entry.sourceLang, 'ha');
    assert(
      haToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')),
      'ha->en Ruwa must link to Water'
    );
  });

  await runTest('2.2 English <-> Yoruba bidirectional lookup & contextual equivalence', async () => {
    const enToYo = await dictionaryDb.searchMultilingual('Peace', 'en', 'yo');
    assert.strictEqual(enToYo.status, 'ok');
    const alafiaRel = enToYo.results[0].senseMatches.find((sm) =>
      sm.relationship.targetHeadword.includes('Àlàáfíà')
    )?.relationship;
    assert(alafiaRel, 'en->yo Peace must link to Àlàáfíà');
    assert.strictEqual(alafiaRel.equivalenceType, 'contextual');
    assert(alafiaRel.contextualNote && alafiaRel.contextualNote.length > 0);

    const yoToEn = await dictionaryDb.searchMultilingual('Omi', 'yo', 'en');
    assert.strictEqual(yoToEn.status, 'ok');
    assert(yoToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')));
  });

  await runTest('2.3 English <-> Arabic bidirectional lookup & Tashkeel normalization', async () => {
    const enToAr = await dictionaryDb.searchMultilingual('Water', 'en', 'ar');
    assert.strictEqual(enToAr.status, 'ok');
    assert(
      enToAr.results[0].senseMatches.some(
        (sm) => sm.relationship.targetHeadword.includes('ماء') || sm.relationship.targetHeadword.includes('مَاء')
      )
    );

    const arToEn = await dictionaryDb.searchMultilingual('سلام', 'ar', 'en');
    assert.strictEqual(arToEn.status, 'ok');
    assert(
      arToEn.results.some((r) =>
        r.senseMatches.some((sm) => sm.relationship.targetHeadword.toLowerCase().includes('peace'))
      )
    );
  });

  await runTest('2.4 English <-> French & Arabic <-> French lookups', async () => {
    const enToFr = await dictionaryDb.searchMultilingual('Water', 'en', 'fr');
    assert.strictEqual(enToFr.status, 'ok');
    assert(enToFr.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Eau')));

    const frToEn = await dictionaryDb.searchMultilingual('Eau', 'fr', 'en');
    assert.strictEqual(frToEn.status, 'ok');
    assert(frToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')));

    const arToFr = await dictionaryDb.searchMultilingual('خَيْرٌ', 'ar', 'fr');
    assert.strictEqual(arToFr.status, 'ok');
    assert(arToFr.results[0].senseMatches.length > 0);
  });

  await runTest('2.5 English <-> Chinese bidirectional lookup (Hanzi + Pinyin)', async () => {
    const enToZh = await dictionaryDb.searchMultilingual('Water', 'en', 'zh');
    assert.strictEqual(enToZh.status, 'ok');
    assert(enToZh.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('水')));

    const zhToEn = await dictionaryDb.searchMultilingual('水', 'zh', 'en');
    assert.strictEqual(zhToEn.status, 'ok');
    assert(zhToEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Water')));

    const hepingEn = await dictionaryDb.searchMultilingual('heping', 'zh', 'en');
    assert.strictEqual(hepingEn.status, 'ok');
    assert(hepingEn.results[0].senseMatches.some((sm) => sm.relationship.targetHeadword.includes('Peace')));
  });

  await runTest('2.6 Multilingual Reverse Lookup: Searching target term finds pair & flags isReverseLookup', async () => {
    const reverse = await dictionaryDb.searchMultilingual('Ruwa', 'en', 'ha');
    assert.strictEqual(reverse.status, 'ok');
    assert(reverse.results.length > 0);
    assert.strictEqual(reverse.results[0].isReverseLookup, true);
  });

  await runTest('2.7 Multilingual Idiomatic Equivalence Detection', async () => {
    const idiomRes = await dictionaryDb.searchMultilingual('Ƙarfin hali', 'ha', 'en');
    assert.strictEqual(idiomRes.status, 'ok');
    const link = idiomRes.results[0].senseMatches[0].relationship;
    assert.strictEqual(link.equivalenceType, 'idiomatic');
    assert(link.contextualNote && link.contextualNote.toLowerCase().includes('idiomatic'));
  });

  await runTest('2.8 Multilingual Statuses: invalid_pair, no_translation, language_not_installed & not_found', async () => {
    const invalid = await dictionaryDb.searchMultilingual('Water', 'en', 'en');
    assert.strictEqual(invalid.status, 'invalid_pair');

    const missing = await dictionaryDb.searchMultilingual('xyz99nonexistentword', 'en', 'ha');
    assert.strictEqual(missing.status, 'not_found');
    assert.strictEqual(missing.existsInStandardDictionary, false);

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
    await dictionaryDb.upsertEntry(monolingualOnly);
    try {
      const stdFound = await dictionaryDb.searchStandard('Monolithsample', 'en');
      assert.strictEqual(stdFound.status, 'ok', 'Monolingual entry must still work in Engine A');

      const noTrans = await dictionaryDb.searchMultilingual('Monolithsample', 'en', 'ha');
      assert.strictEqual(noTrans.status, 'no_translation');
      assert.strictEqual(noTrans.existsInStandardDictionary, true);
    } finally {
      await dictionaryDb.removeEntry('test-mono-only-en');
    }

    await dictionaryDb.setPackInstalled('yo', false);
    try {
      const blocked = await dictionaryDb.searchMultilingual('Water', 'en', 'yo');
      assert.strictEqual(blocked.status, 'language_not_installed');
    } finally {
      await dictionaryDb.setPackInstalled('yo', true);
    }
  });

  // ======================================================================
  // SECTION 3: NEWLY IMPORTED REAL CORPUS VERIFICATION (ALL 7 LANGUAGES)
  // ======================================================================

  await runTest('3.1 Newly Imported Real Entries Across All 7 Languages + Multi-Sense Preservation', async () => {
    const probes: Array<{ lang: LanguageCode; query: string; minSenses: number }> = [
      { lang: 'en', query: 'key', minSenses: 4 },
      { lang: 'ha', query: 'sarki', minSenses: 2 },
      { lang: 'yo', query: 'gbọ́', minSenses: 3 },
      { lang: 'ff', query: 'nebbam', minSenses: 2 },
      { lang: 'ar', query: 'سَمَاء', minSenses: 3 },
      { lang: 'fr', query: 'faire', minSenses: 3 },
      { lang: 'zh', query: '下', minSenses: 3 },
    ];

    for (const p of probes) {
      const res = await dictionaryDb.searchStandard(p.query, p.lang);
      assert.strictEqual(res.status, 'ok', `Newly imported entry "${p.query}" (${p.lang}) must be found`);
      const matching = res.results.filter(
        (r) => r.entry.headword.toLowerCase() === p.query.toLowerCase()
      );
      assert(matching.length > 0, `Exact headword match expected for "${p.query}" in ${p.lang}`);
      const maxSenses = Math.max(...matching.map((m) => m.senses.length));
      assert(
        maxSenses >= p.minSenses,
        `Expected multi-sense preservation >= ${p.minSenses} for ${p.query} (${p.lang}), got ${maxSenses}`
      );
      assert(
        matching.every((m) => m.entry.sourceAttribution && m.entry.sourceAttribution.length > 0),
        `Source attribution must be preserved for ${p.query}`
      );
    }

    // Also test Fulfulde baobab / dictionary & Hausa air / name
    const bokki = await dictionaryDb.searchStandard('ɓokki', 'ff');
    assert.strictEqual(bokki.status, 'ok');
    assert(bokki.results.some((r) => r.entry.headword === 'ɓokki'));

    const saggitorde = await dictionaryDb.searchStandard('saggitorde', 'ff');
    assert.strictEqual(saggitorde.status, 'ok');
    assert(saggitorde.results.some((r) => r.entry.headword === 'saggitorde'));
  });

  await runTest('3.2 Orthography Integrity: Yoruba Tonal Homographs Stay Distinct + Arabic Vocalized/Bare', async () => {
    // Yoruba tonal distinction: fà ("to pull") vs fá ("to scrape or wipe off")
    const bareFa = await dictionaryDb.searchStandard('fa', 'yo');
    assert.strictEqual(bareFa.status, 'ok');
    const lowFa = bareFa.results.find((r) => r.entry.headword === 'fà');
    const highFa = bareFa.results.find((r) => r.entry.headword === 'fá');
    assert(lowFa && highFa, 'Yoruba tonal pairs fà and fá must NOT be merged into one row');
    assert.notStrictEqual(lowFa.entry.id, highFa.entry.id);
    assert.notStrictEqual(lowFa.senses[0].definition, highFa.senses[0].definition);

    // Exact tonal query ranks tonal match first
    const exactLow = await dictionaryDb.searchStandard('fà', 'yo');
    assert.strictEqual(exactLow.results[0].entry.headword, 'fà');

    // Arabic vocalized & unvocalized lookup on new Kaikki verb
    const arVoc = await dictionaryDb.searchStandard('حَمَلَ', 'ar');
    const arBare = await dictionaryDb.searchStandard('حمل', 'ar');
    assert.strictEqual(arVoc.status, 'ok');
    assert.strictEqual(arBare.status, 'ok');
    assert(arBare.results.some((r) => r.entry.headword === 'حَمَلَ'));

    // Chinese bare Pinyin on CC-CEDICT imported word
    const zhPinyin = await dictionaryDb.searchStandard('xia', 'zh');
    assert.strictEqual(zhPinyin.status, 'ok');
    assert(zhPinyin.results.some((r) => r.entry.headword === '下'));
  });

  await runTest('3.3 Engine B Multilingual Sense Links on Newly Imported Entries', async () => {
    const pairs: Array<{ q: string; src: LanguageCode; tgt: LanguageCode; expectedTargetSubstr: string }> = [
      { q: 'Adam', src: 'en', tgt: 'ha', expectedTargetSubstr: 'Adamu' },
      { q: 'airplane', src: 'en', tgt: 'ff', expectedTargetSubstr: 'arapulel' },
      { q: 'alwala', src: 'ha', tgt: 'en', expectedTargetSubstr: 'ablution' },
      { q: 'abákọ́ọ̀sì', src: 'yo', tgt: 'en', expectedTargetSubstr: 'abacus' },
      { q: 'selugol', src: 'ff', tgt: 'en', expectedTargetSubstr: 'abandon' },
      { q: '滴', src: 'zh', tgt: 'en', expectedTargetSubstr: 'a drop' },
    ];

    for (const pair of pairs) {
      const res = await dictionaryDb.searchMultilingual(pair.q, pair.src, pair.tgt);
      assert.strictEqual(res.status, 'ok', `Multilingual query "${pair.q}" (${pair.src}->${pair.tgt}) failed`);
      const hasLink = res.results.some((r) =>
        r.senseMatches.some((sm) =>
          sm.relationship.targetHeadword.toLowerCase().includes(pair.expectedTargetSubstr.toLowerCase())
        )
      );
      assert(
        hasLink,
        `Expected ${pair.src}->${pair.tgt} link for "${pair.q}" containing "${pair.expectedTargetSubstr}"`
      );
    }
  });

  await runTest('3.4 Honest Bundled Core SQLite Corpus Counts Across All 7 Languages', async () => {
    const stats = await dictionaryDb.getLanguagePackStats();
    const languages: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];
    let totalEntries = 0;
    let totalSenses = 0;

    for (const lang of languages) {
      assert(stats[lang].loadedEntriesCount >= 1400, `${lang} bundled core must have >= 1400 real entries`);
      assert(stats[lang].isInstalled, `${lang} must start active offline`);
      assert(stats[lang].actualSizeBytes > 500_000, `${lang} DB slice must have real byte size`);
      totalEntries += stats[lang].loadedEntriesCount;
      totalSenses += stats[lang].sensesCount;
    }

    assert(totalEntries >= 13_000, `Total core entries expected >= 13,000, got ${totalEntries}`);
    const totalRels = await dictionaryDb.getTotalTranslationRelationshipsCount();
    console.log('\n--- BUNDLED CORE SQLITE CORPUS SUMMARY ---');
    console.log(`Total Bundled Entries: ${totalEntries}`);
    console.log(`Total Bundled Senses:  ${totalSenses}`);
    console.log(`Total Translation Links: ${totalRels}`);
    for (const lang of languages) {
      console.log(
        `  [${lang.toUpperCase()}] entries=${stats[lang].loadedEntriesCount}, senses=${stats[lang].sensesCount}, rels=${stats[lang].translationRelationshipsCount}, coreSize=${(stats[lang].actualSizeBytes / (1024 * 1024)).toFixed(2)} MB`
      );
    }
    console.log('------------------------------------------\n');
  });

  // ======================================================================
  // SECTION 4: OFFLINE PACK LIFECYCLE, PERSISTENCE & CRASH RECOVERY
  // ======================================================================

  await runTest('4.1 Full Offline Pack Download (YO), Progress Events, SHA-256 Check, Search & Persistence', async () => {
    // Confirm IwajuAI-only word is NOT in bundled core before installing full YO pack
    const before = await dictionaryDb.searchStandard('ìgékúrú', 'yo');
    assert.strictEqual(before.status, 'not_found');

    const progressEvents: PackDownloadProgress[] = [];
    const unsub = packManager.subscribe((p) => {
      if (p.langCode === 'yo') progressEvents.push(p);
    });

    try {
      const installed = await packManager.downloadAndInstallPack('yo');
      assert.strictEqual(installed.tier, 'full_pack');
      assert.strictEqual(installed.installState, 'installed');
      assert(installed.entryCount >= 8000, `Expected full YO pack >= 8000 entries, got ${installed.entryCount}`);
      assert(progressEvents.some((p) => p.state === 'downloading' && p.percent > 0 && p.percent < 100));
      assert(progressEvents.some((p) => p.state === 'verifying'));
      assert(progressEvents.some((p) => p.state === 'installed'));
    } finally {
      unsub();
    }

    // Now offline FTS5 search retrieves IwajuAI full-pack entry and EN link
    const afterStd = await dictionaryDb.searchStandard('ìgékúrú', 'yo');
    assert.strictEqual(afterStd.status, 'ok');
    assert(afterStd.results.some((r) => r.entry.headword === 'ìgékúrú'));

    const afterMulti = await dictionaryDb.searchMultilingual('ìgékúrú', 'yo', 'en');
    assert.strictEqual(afterMulti.status, 'ok');
    assert(
      afterMulti.results[0].senseMatches.some((sm) =>
        sm.relationship.targetHeadword.toLowerCase().includes('abbreviation')
      )
    );

    // Close all SQLite connections and re-open from persisted state DB on disk
    await sqliteManager.closeAll();
    await dictionaryDb.initialize();
    const persistedStates = await packManager.getPackStates();
    assert.strictEqual(persistedStates.yo.tier, 'full_pack');
    assert.strictEqual(persistedStates.yo.installState, 'installed');

    const persistedSearch = await dictionaryDb.searchStandard('ìgékúrú', 'yo');
    assert.strictEqual(persistedSearch.status, 'ok');
    assert(persistedSearch.results.some((r) => r.entry.headword === 'ìgékúrú'));

    // Uninstall full YO pack -> removes file & falls back cleanly to core starter
    await packManager.uninstallPack('yo', 'revert_to_starter');
    const packFile = path.join(tempPackDir, 'lexica_pack_yoSQLite.db');
    assert(!fs.existsSync(packFile), 'Uninstalled pack SQLite file must be removed from disk');

    const afterUninstall = await dictionaryDb.searchStandard('ìgékúrú', 'yo');
    assert.strictEqual(afterUninstall.status, 'not_found');

    const starterStillWorks = await dictionaryDb.searchStandard('Àlàáfíà', 'yo');
    assert.strictEqual(starterStillWorks.status, 'ok');
  });

  await runTest('4.2 Pack Download Cancellation & Startup Crash Recovery', async () => {
    // 1) Cancellation mid-download
    const downloadPromise = packManager.downloadAndInstallPack('ha');
    await new Promise((r) => setTimeout(r, 15));
    const cancelled = packManager.cancelDownload('ha');
    assert.strictEqual(cancelled, true);

    await assert.rejects(downloadPromise, (err: Error) => err.name === 'AbortError');
    const postCancelStates = await packManager.getPackStates();
    assert.strictEqual(postCancelStates.ha.installState, 'core_only');
    assert(!fs.existsSync(path.join(tempPackDir, 'lexica_pack_ha.part')));
    assert(!fs.existsSync(path.join(tempPackDir, 'lexica_pack_ha.tmpSQLite.db')));

    // 2) Startup crash recovery from interrupted 'downloading' state + stale temp artifacts
    const stateDb = sqliteManager.getStateConnection();
    const stalePart = path.join(tempPackDir, 'lexica_pack_ha.part');
    fs.writeFileSync(stalePart, 'corrupted partial bytes');
    await stateDb.run(
      `UPDATE language_pack_states SET install_state = 'downloading' WHERE lang_code = 'ha';`
    );

    await packManager.initializeAndRecover();
    const recoveredStates = await packManager.getPackStates();
    assert.strictEqual(recoveredStates.ha.installState, 'core_only');
    assert(!fs.existsSync(stalePart), 'Startup recovery must clean up orphaned .part files');
  });

  await sqliteManager.closeAll();
  fs.rmSync(tempTestRoot, { recursive: true, force: true });

  console.log('\n==============================================================');
  console.log(`RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('==============================================================\n');
}

main().catch(async (err) => {
  console.error(err);
  await sqliteManager.closeAll().catch(() => {});
  fs.rmSync(tempTestRoot, { recursive: true, force: true });
  process.exit(1);
});
