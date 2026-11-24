/**
 * LEXICA — Assignment 017: Machine-Readable Fulfulde Human Review Template
 *
 * Designed for fluent Fulfulde speakers and linguists to assess recovery corpus entries
 * against orthography, grammatical correctness, definition meaning, and dialect authenticity.
 */

export type ReviewLabel = 'verified' | 'needs_review' | 'incorrect' | 'unverified';

export interface FulfuldeReviewRecord {
  entryId: string;
  headword: string;
  proposedVariety: 'nigerian_adamawa' | 'nigerian_sokoto_gombe' | 'pulaar_futa_tooro' | 'pular_futa_jallon' | 'pan_fulfulde' | 'variety_unspecified';
  reviewerName: string;
  reviewerFluency: 'native_speaker' | 'professional_linguist' | 'advanced_learner' | 'unspecified';
  reviewerDialect: string;
  definitionAssessment: ReviewLabel;
  exampleAssessment: ReviewLabel;
  orthographyCorrections?: string;
  ipaCorrections?: string;
  adlamCorrections?: string;
  confidenceRating: number; // 1 to 5
  reviewDate: string;
  commentsAndDisagreements: string;
}

export const FULFULDE_REVIEW_TEMPLATE_SCHEMA = {
  version: '1.0.0',
  description: 'Validation template for LEXICA Fulfulde lexicography recovery entries.',
  labels: ['verified', 'needs_review', 'incorrect', 'unverified'] as ReviewLabel[],
  fields: [
    'entryId',
    'headword',
    'proposedVariety',
    'reviewerName',
    'reviewerFluency',
    'reviewerDialect',
    'definitionAssessment',
    'exampleAssessment',
    'orthographyCorrections',
    'ipaCorrections',
    'adlamCorrections',
    'confidenceRating',
    'reviewDate',
    'commentsAndDisagreements',
  ],
};
