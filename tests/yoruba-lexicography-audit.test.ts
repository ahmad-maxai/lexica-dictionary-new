import assert from 'node:assert';
import {
  validateYorubaDefinition,
  evaluateYorubaConflicts,
  isPlaceholderOrEmpty,
  looksLikeEnglishOnlyGloss,
  normalizeYorubaKey,
  type YorubaLexicographyRecord,
} from '../src/services/yorubaDefinitionValidator';

async function main() {
  console.log('\n==============================================================');
  console.log('LEXICA ASSIGNMENT 012 — YORUBA LEXICOGRAPHY & QUALITY AUDIT SUITE');
  console.log('==============================================================\n');

  let passed = 0;
  let total = 0;

  async function runTest(name: string, fn: () => Promise<void> | void) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✅ PASS: ${name}`);
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  await runTest('Y12.1 Rejects placeholders and empty definitions', () => {
    const placeholders = ['', '   ', 'N/A', 'todo', '...', 'see run'];
    for (const p of placeholders) {
      assert.strictEqual(isPlaceholderOrEmpty(p), true);
      const res = validateYorubaDefinition({
        headword: 'ilé',
        partOfSpeech: 'noun',
        definitionYo: p,
        definitionType: 'yoruba_monolingual',
        source: 'yo.wiktionary.org',
        license: 'CC BY-SA 4.0',
      });
      assert.strictEqual(res.validRecord, false);
      assert.strictEqual(res.effectiveDefinitionType, 'unavailable');
    }
  });

  await runTest('Y12.2 Distinguishes tonal minimum pairs and diacritic preservation', () => {
    const w1 = 'ọ̀rọ̀'; // word / speech / matter (low-low)
    const w2 = 'ọ́rọ́'; // wealth / riches (high-high)
    const normStrict1 = normalizeYorubaKey(w1, true);
    const normStrict2 = normalizeYorubaKey(w2, true);
    assert.notStrictEqual(normStrict1, normStrict2, 'Strict diacritic normalization must keep tonal variants distinct');

    const normLoose1 = normalizeYorubaKey(w1, false);
    const normLoose2 = normalizeYorubaKey(w2, false);
    assert.strictEqual(normLoose1, 'ọrọ');
    assert.strictEqual(normLoose2, 'ọrọ');
  });

  await runTest('Y12.3 Prevents English gloss misclassification in yoruba_monolingual', () => {
    const misclassified = validateYorubaDefinition({
      headword: 'omi',
      partOfSpeech: 'noun',
      definitionYo: 'Water; liquid substance essential for life and drinking.',
      definitionType: 'yoruba_monolingual',
      source: 'kaikki-yoruba',
      license: 'CC BY-SA 4.0',
    });
    assert.strictEqual(misclassified.validYorubaMonolingual, false);
    assert.strictEqual(misclassified.effectiveDefinitionType, 'english_gloss');
  });

  await runTest('Y12.4 Accepts genuine Yoruba monolingual & bilingual definitions with provenance', () => {
    const genuine = validateYorubaDefinition({
      headword: 'ilé',
      partOfSpeech: 'noun',
      definitionYo: 'Ilé jẹ́ ibi tí àwọn ènìyàn ń gbé lọ́jọojúmọ́.',
      definitionEn: 'house, home, dwelling place',
      definitionType: 'bilingual_explanation',
      examples: ['Ilé mi dára gan-an.'],
      pronunciation: '[ì.lé]',
      source: 'yo.wiktionary.org & Academic Lexicon',
      license: 'CC BY-SA 4.0',
      verificationStatus: 'community_reviewed',
    });
    assert.strictEqual(genuine.validRecord, true);
    assert.strictEqual(genuine.validYorubaMonolingual, true);
    assert.strictEqual(genuine.isHumanVerifiedYoruba, true);
  });

  await runTest('Y12.5 Evaluates tone-based and cross-source conflicts without silent merging', () => {
    const records: YorubaLexicographyRecord[] = [
      {
        headword: 'ọ̀rọ̀',
        partOfSpeech: 'noun',
        definitionYo: 'Ọ̀rọ̀ túmọ̀ sí ohun tí a sọ sẹ́nu.',
        definitionType: 'yoruba_monolingual',
        source: 'yo.wiktionary.org',
        license: 'CC BY-SA 4.0',
      },
      {
        headword: 'ọ̀rọ̀',
        partOfSpeech: 'noun',
        definitionYo: 'Ọ̀rọ̀ ni ọ̀rọ̀ sísọ.',
        definitionType: 'yoruba_monolingual',
        source: 'Academic Corpus 2024',
        license: 'CC BY 4.0',
      },
    ];
    const conflicts = evaluateYorubaConflicts(records);
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].headword, 'ọ̀rọ̀');
    assert.strictEqual(conflicts[0].resolutionStatus, 'flagged_for_review');
  });

  console.log(`\n==============================================================`);
  console.log(`RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log(`==============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
