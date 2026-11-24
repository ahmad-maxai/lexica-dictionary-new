/**
 * LEXICA — Assignment 018: Machine-Readable Human Review & Field Validation Schema
 *
 * Defines structured types and export helpers for reviewer profiles, entry reviews,
 * field-level corrections, regional variants, and disagreement records.
 */

export type ReviewerFluency = 'native_speaker' | 'professional_linguist' | 'advanced_learner' | 'unspecified';
export type ReviewOutcome = 'approved' | 'approved_with_regional_variants' | 'needs_correction' | 'disputed' | 'rejected' | 'pending';
export type ReviewFieldStatus = 'verified' | 'needs_review' | 'incorrect' | 'unverified';

export interface ReviewerProfile {
  reviewerId: string; // Pseudonymous (e.g. "FF-REV-001")
  selfDescribedFluency: ReviewerFluency;
  isNativeSpeaker: boolean;
  communityOrRegion?: string;
  dialectOrVariety: string;
  yearsOfSpeakingExperience?: number;
  latinLiteracy: boolean;
  adlamFamiliarity: boolean;
  consentGiven: boolean;
  consentDate: string;
}

export interface EntryReviewRecord {
  entryId: string;
  headword: string;
  reviewerId: string;
  reviewTimestamp: string;
  proposedVariety: string;
  spellingAssessment: ReviewFieldStatus;
  definitionAssessment: ReviewFieldStatus;
  semanticAccuracy: ReviewFieldStatus;
  grammarAssessment: ReviewFieldStatus;
  englishTranslationFidelity: ReviewFieldStatus;
  exampleNaturalness: ReviewFieldStatus;
  exampleTranslationFidelity: ReviewFieldStatus;
  dialectAppropriateness: ReviewFieldStatus;
  ipaAssessment: ReviewFieldStatus;
  adlamAssessment: ReviewFieldStatus;
  overallOutcome: ReviewOutcome;
  suggestedCorrectionFf?: string;
  suggestedCorrectionEn?: string;
  regionalAlternative?: string;
  confidenceRating: number; // 1 to 5
  comments: string;
}

export interface DisagreementRecord {
  entryId: string;
  headword: string;
  disagreementNature: 'dialectal' | 'semantic' | 'orthographic' | 'grammatical';
  reviewerIds: string[];
  conflictingOutcomes: string[];
  adjudicationStatus: 'pending' | 'retained_regional_variants' | 'resolved';
  adjudicationNotes?: string;
}

export interface HumanReviewExportBundle {
  schemaVersion: string;
  exportTimestamp: string;
  finalReadinessStatus: 'AWAITING_EXTERNAL_REVIEW';
  externalReviewsReceived: boolean;
  reviewers: ReviewerProfile[];
  reviews: EntryReviewRecord[];
  disagreements: DisagreementRecord[];
}

/**
 * Helper to export review bundle to JSON string.
 */
export function exportReviewBundleToJson(bundle: HumanReviewExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Helper to export entry reviews to CSV string.
 */
export function exportEntryReviewsToCsv(reviews: EntryReviewRecord[]): string {
  const headers = [
    'entryId',
    'headword',
    'reviewerId',
    'reviewTimestamp',
    'proposedVariety',
    'overallOutcome',
    'confidenceRating',
    'comments',
  ];
  const rows = reviews.map((r) => [
    r.entryId,
    `"${r.headword}"`,
    r.reviewerId,
    r.reviewTimestamp,
    `"${r.proposedVariety}"`,
    r.overallOutcome,
    r.confidenceRating,
    `"${(r.comments || '').replace(/"/g, '""')}"`,
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}
