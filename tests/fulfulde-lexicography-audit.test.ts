import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateFulfuldeConflicts,
  hasNonStandardOrthographyArtifact,
  isPlaceholderOrEmptyFulfulde,
  looksLikeEnglishOnlyFulfulde,
  normalizeFulfuldeKey,
  validateFulfuldeDefinition,
} from '../src/services/fulfuldeDefinitionValidator';

console.log('==============================================================');
console.log('LEXICA — ASSIGNMENT 015 FULFULDE AUDIT & FEASIBILITY SUITE');
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

runTest('1. Validator separates fulfulde_monolingual, bilingual_explanation & english_gloss cleanly', () => {
  const mono = validateFulfuldeDefinition({
    headword: 'Suudu',
    partOfSpeech: 'noun',
    definitionFf: 'Mahdi ɗo neɗɗo hoɗata ngam reenaade naange e toɓo.',
    definitionType: 'fulfulde_monolingual',
    source: 'lexica-curated-ff',
    license: 'CC0 1.0',
    verificationStatus: 'academic_verified',
  });
  assert.strictEqual(mono.validRecord, true);
  assert.strictEqual(mono.validFulfuldeMonolingual, true);
  assert.strictEqual(mono.isHumanVerifiedFulfulde, true);
  assert.strictEqual(mono.effectiveDefinitionType, 'fulfulde_monolingual');

  const bil = validateFulfuldeDefinition({
    headword: 'A jaaraama',
    partOfSpeech: 'greeting',
    definitionFf: 'Salminaango jaɓɓorgal koɗo e nder pulaaku.',
    definitionEn: 'A greeting given to an arriving guest.',
    definitionType: 'bilingual_explanation',
    source: 'lexica-curated-ff',
    license: 'CC0 1.0',
    verificationStatus: 'community_reviewed',
  });
  assert.strictEqual(bil.validRecord, true);
  assert.strictEqual(bil.validFulfuldeMonolingual, true);
  assert.strictEqual(bil.effectiveDefinitionType, 'bilingual_explanation');

  const eng = validateFulfuldeDefinition({
    headword: 'ndiyam',
    partOfSpeech: 'noun',
    definitionEn: 'water',
    definitionType: 'english_gloss',
    source: 'kaikki-en-wikt-ff',
    license: 'CC BY-SA 4.0 & GFDL',
    verificationStatus: 'community_reviewed',
  });
  assert.strictEqual(eng.validRecord, true);
  assert.strictEqual(eng.validFulfuldeMonolingual, false);
  assert.strictEqual(eng.effectiveDefinitionType, 'english_gloss');
});

runTest('2. English-only definition mislabelled as fulfulde_monolingual is reclassified to english_gloss', () => {
  const mislabelled = validateFulfuldeDefinition({
    headword: 'Hakkillo',
    partOfSpeech: 'noun',
    definitionFf: 'Mind, intellect, prudence, watchful care in cattle management.',
    definitionType: 'fulfulde_monolingual',
    source: 'lexica-curated-ff',
    license: 'CC0 1.0',
    verificationStatus: 'community_reviewed',
  });
  assert.strictEqual(looksLikeEnglishOnlyFulfulde('Mind, intellect, prudence, watchful care in cattle management.'), true);
  assert.strictEqual(mislabelled.effectiveDefinitionType, 'english_gloss');
  assert.strictEqual(mislabelled.validFulfuldeMonolingual, false);
});

runTest('3. Placeholders, truncated stubs ("same as"), and machine_generated unverified records are rejected/excluded', () => {
  for (const stub of ['', 'n/a', 'tbd', 'the', 'same as', 'See aawde', '...']) {
    assert.strictEqual(isPlaceholderOrEmptyFulfulde(stub), true, `Expected stub "${stub}" to be rejected`);
  }

  const machine = validateFulfuldeDefinition({
    headword: 'Testword',
    partOfSpeech: 'noun',
    definitionFf: 'Konngol nguurndam.',
    definitionType: 'machine_generated',
    source: 'unverified-mt',
    license: 'unknown',
    verificationStatus: 'machine_unverified',
  });
  assert.strictEqual(machine.validRecord, false);
  assert.strictEqual(machine.isHumanVerifiedFulfulde, false);
});

runTest('4. Bamako/NERDC hooked letters (ɓ, ɗ, ƴ, ŋ, ɲ) preserved in exact mode & folded in flexible mode', () => {
  assert.strictEqual(normalizeFulfuldeKey('Cuuɗi', true), 'cuuɗi');
  assert.strictEqual(normalizeFulfuldeKey('Cuuɗi', false), 'cuudi');
  assert.strictEqual(normalizeFulfuldeKey('Ɓiɓɓe', true), 'ɓiɓɓe');
  assert.strictEqual(normalizeFulfuldeKey('Ɓiɓɓe', false), 'bibbe');
  assert.strictEqual(normalizeFulfuldeKey('Ƴiiƴam', true), 'ƴiiƴam');
  assert.strictEqual(normalizeFulfuldeKey('Ƴiiƴam', false), 'yiiyam');
  assert.strictEqual(normalizeFulfuldeKey('Muñal', true), 'muñal');
  assert.strictEqual(normalizeFulfuldeKey('Muñal', false), 'munyal');
  // Doubled vowel length must remain distinct
  assert.notStrictEqual(normalizeFulfuldeKey('waɗude', true), normalizeFulfuldeKey('waaɗude', true));
});

runTest('5. Detects Wikidata ď/đ substitution artifacts and flags regional variants without silent merge', () => {
  assert.strictEqual(hasNonStandardOrthographyArtifact("Ba'eteeďi"), true);
  assert.strictEqual(hasNonStandardOrthographyArtifact("Ba'ateeđum"), true);
  assert.strictEqual(hasNonStandardOrthographyArtifact("Ba'eteeɗi"), false);

  const checkArtifact = validateFulfuldeDefinition({
    headword: "Ba'eteeďi",
    partOfSpeech: 'noun',
    definitionEn: 'Chariot',
    definitionType: 'english_gloss',
    source: 'wikidata-q33454',
    license: 'CC0 1.0',
  });
  assert.strictEqual(checkArtifact.hasOrthographySubstitutionArtifact, true);

  const conflicts = evaluateFulfuldeConflicts([
    {
      headword: 'aawgo',
      variety: 'nigerian_adamawa',
      partOfSpeech: 'verb',
      definitionEn: 'to sow',
      definitionType: 'english_gloss',
      source: 'kaikki-en-wikt-ff',
      license: 'CC BY-SA 4.0',
    },
    {
      headword: 'aawde',
      variety: 'pulaar_futa_tooro',
      partOfSpeech: 'verb',
      definitionEn: 'to sow seeds',
      definitionType: 'english_gloss',
      source: 'wikidata-q33454',
      license: 'CC0 1.0',
    },
    {
      headword: 'ɲamdu',
      variety: 'pular_futa_jallon',
      partOfSpeech: 'noun',
      definitionEn: 'food',
      definitionType: 'english_gloss',
      source: 'kaikki-en-wikt-ff',
      license: 'CC BY-SA 4.0',
    },
    {
      headword: 'ñamdu',
      variety: 'pulaar_futa_tooro',
      partOfSpeech: 'noun',
      definitionEn: 'food',
      definitionType: 'english_gloss',
      source: 'kaikki-en-wikt-ff',
      license: 'CC BY-SA 4.0',
    },
  ]);
  assert(conflicts.some((c) => c.headword === 'nyamdu' && c.resolutionStatus === 'retained_labelled'));
});

runTest('6. Isolated Prototype Manifest integrity & zero contamination of production language packs', () => {
  const manifestPath = path.resolve('docs/assignment-015/fulfulde_prototype_manifest.json');
  assert(fs.existsSync(manifestPath), 'Fulfulde prototype manifest snapshot must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.strictEqual(manifest.prototypeOnly, true);
  assert.strictEqual(manifest.schemaVersion, 4);
  assert.strictEqual(manifest.core.sqliteQuickCheck, 'ok');
  assert.strictEqual(manifest.extended.sqliteQuickCheck, 'ok');
  assert(manifest.statistics.acceptedEntries >= 8000, 'Expected >= 8000 audited Fulfulde entries');
  assert(manifest.statistics.wikidataDCaronNormalized === 83, 'Expected 83 ď/đ artifacts tracked');

  const dt = manifest.statistics.definitionTypes;
  const totalTyped =
    (dt.fulfulde_monolingual || 0) +
    (dt.bilingual_explanation || 0) +
    (dt.english_gloss || 0);
  assert.strictEqual(totalTyped, manifest.statistics.acceptedEntries);
  assert.strictEqual(dt.fulfulde_monolingual || 0, 0, 'Must honestly report 0 standalone external Fulfulde monolingual defs');

  // Verify production Yoruba/Hausa configs & UI do NOT wire the isolated prototype
  const libSrc = fs.readFileSync(path.resolve('src/components/LanguageLibraryScreen.tsx'), 'utf8');
  assert(!libSrc.includes('ff-lexica-schema-v4-proto'), 'Prototype must remain strictly isolated from LanguageLibraryScreen');
});

console.log('\n==============================================================');
console.log(`FULFULDE AUDIT SUITE RESULTS: ${passed} / ${total} TESTS PASSED`);
console.log('==============================================================\n');
