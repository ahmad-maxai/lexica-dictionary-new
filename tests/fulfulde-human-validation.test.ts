import assert from 'node:assert';
import { FULFULDE_RECOVERY_CORPUS } from '../src/data/fulfuldeRecoveryCorpus';
import {
  exportEntryReviewsToCsv,
  exportReviewBundleToJson,
  type EntryReviewRecord,
  type HumanReviewExportBundle,
  type ReviewerProfile,
} from '../src/data/fulfuldeHumanReviewSchema';

console.log('==============================================================');
console.log('LEXICA — ASSIGNMENT 018 HUMAN REVIEW & VALIDATION SUITE');
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

runTest('H.1 Schema Compliance: ReviewerProfile and EntryReviewRecord structure', () => {
  const sampleProfile: ReviewerProfile = {
    reviewerId: 'FF-REV-SAMPLE-001',
    selfDescribedFluency: 'native_speaker',
    isNativeSpeaker: true,
    communityOrRegion: 'Adamawa State, Nigeria',
    dialectOrVariety: 'Nigerian Adamawa Fulfulde',
    yearsOfSpeakingExperience: 25,
    latinLiteracy: true,
    adlamFamiliarity: true,
    consentGiven: true,
    consentDate: '2026-11-24',
  };
  assert.strictEqual(sampleProfile.isNativeSpeaker, true);
  assert.strictEqual(sampleProfile.consentGiven, true);

  const sampleReview: EntryReviewRecord = {
    entryId: 'ff-rec-001',
    headword: 'Hakkillo',
    reviewerId: 'FF-REV-SAMPLE-001',
    reviewTimestamp: '2026-11-24T00:00:00Z',
    proposedVariety: 'nigerian_adamawa',
    spellingAssessment: 'verified',
    definitionAssessment: 'verified',
    semanticAccuracy: 'verified',
    grammarAssessment: 'verified',
    englishTranslationFidelity: 'verified',
    exampleNaturalness: 'verified',
    exampleTranslationFidelity: 'verified',
    dialectAppropriateness: 'verified',
    ipaAssessment: 'verified',
    adlamAssessment: 'verified',
    overallOutcome: 'approved',
    confidenceRating: 5,
    comments: 'Example sample review record. Not an active external review.',
  };
  assert.strictEqual(sampleReview.overallOutcome, 'approved');
});

runTest('H.2 Explicit Statement: NO_EXTERNAL_HUMAN_REVIEWS_RECEIVED & AWAITING_EXTERNAL_REVIEW status', () => {
  const bundle: HumanReviewExportBundle = {
    schemaVersion: '1.0.0',
    exportTimestamp: '2026-11-24T05:00:00Z',
    finalReadinessStatus: 'AWAITING_EXTERNAL_REVIEW',
    externalReviewsReceived: false,
    reviewers: [],
    reviews: [],
    disagreements: [],
  };

  assert.strictEqual(bundle.finalReadinessStatus, 'AWAITING_EXTERNAL_REVIEW');
  assert.strictEqual(bundle.externalReviewsReceived, false);

  const jsonOut = exportReviewBundleToJson(bundle);
  assert(jsonOut.includes('AWAITING_EXTERNAL_REVIEW'));
});

runTest('H.3 All 20 Recovery Entries Have Review Template Support', () => {
  assert.strictEqual(FULFULDE_RECOVERY_CORPUS.length, 20);
  const reviewRecords: EntryReviewRecord[] = FULFULDE_RECOVERY_CORPUS.map((e) => ({
    entryId: e.id,
    headword: e.headword,
    reviewerId: 'PENDING_REVIEWER',
    reviewTimestamp: new Date().toISOString(),
    proposedVariety: e.variety,
    spellingAssessment: 'unverified',
    definitionAssessment: 'unverified',
    semanticAccuracy: 'unverified',
    grammarAssessment: 'unverified',
    englishTranslationFidelity: 'unverified',
    exampleNaturalness: 'unverified',
    exampleTranslationFidelity: 'unverified',
    dialectAppropriateness: 'unverified',
    ipaAssessment: 'unverified',
    adlamAssessment: 'unverified',
    overallOutcome: 'pending',
    confidenceRating: 0,
    comments: 'Awaiting assignment to qualified native speaker.',
  }));

  assert.strictEqual(reviewRecords.length, 20);
  const csvOut = exportEntryReviewsToCsv(reviewRecords);
  assert(csvOut.includes('entryId,headword'));
  assert(csvOut.includes('Hakkillo'));
});

console.log('\n==============================================================');
console.log(`HUMAN VALIDATION SUITE RESULTS: ${passed} / ${total} TESTS PASSED`);
console.log('==============================================================\n');
