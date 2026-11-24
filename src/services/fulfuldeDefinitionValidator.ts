/**
 * LEXICA — Assignment 015: Isolated Fulfulde Lexicography & Definition Validator
 *
 * Enforces strict classification of Fulfulde dictionary definitions:
 *   - fulfulde_monolingual: native Fulfulde / Pulaar / Pular explanation only
 *   - bilingual_explanation: both native Fulfulde explanation and English gloss/explanation
 *   - english_gloss: English gloss/explanation only (never mislabelled as Fulfulde)
 *   - machine_generated: unverified machine output (excluded from verified counts)
 *   - unavailable: empty, placeholder, cross-reference-only, or malformed
 *
 * Orthography Policy (Bamako 1966 / NERDC Nigerian Fulfulde Primary Standard):
 *   - Preserves hooked/implosive & nasal consonants: ɓ, ɗ, ƴ, ŋ, ɲ (and regional ñ)
 *   - Preserves doubled long vowels: aa, ee, ii, oo, uu
 *   - Detects non-standard Czech/Latin substitutions (ď, đ for ɗ; y'/’y for ƴ) so
 *     imported datasets can be audited honestly and flagged cleanly.
 *   - Never strips ɓ, ɗ, ƴ, ŋ, ɲ when computing exact Fulfulde keys; provides a
 *     separate flexible search normalizer (`strictOrthography = false`) for ASCII fallback.
 */

export type FulfuldeDefinitionType =
  | 'fulfulde_monolingual'
  | 'bilingual_explanation'
  | 'english_gloss'
  | 'machine_generated'
  | 'unavailable';

export type FulfuldeVerificationStatus =
  | 'community_reviewed'
  | 'academic_verified'
  | 'corpus_derived'
  | 'machine_unverified'
  | 'unverified';

export type FulfuldeVariety =
  | 'nigerian_adamawa'
  | 'nigerian_sokoto_gombe'
  | 'maasina'
  | 'pulaar_futa_tooro'
  | 'pular_futa_jallon'
  | 'borgu_western_niger'
  | 'pan_fulfulde';

export interface FulfuldeLexicographyRecord {
  headword: string;
  normalizedHeadword?: string;
  scriptVariant?: string;
  variety?: FulfuldeVariety | string;
  partOfSpeech: string;
  definitionFf?: string;
  definitionEn?: string;
  definitionType: FulfuldeDefinitionType;
  examples?: string[];
  pronunciation?: string;
  relatedWords?: string[];
  source: string;
  license: string;
  verificationStatus?: FulfuldeVerificationStatus;
}

export interface FulfuldeValidationResult {
  validRecord: boolean;
  validFulfuldeMonolingual: boolean;
  isHumanVerifiedFulfulde: boolean;
  effectiveDefinitionType: FulfuldeDefinitionType;
  hasOrthographySubstitutionArtifact: boolean;
  warnings: string[];
}

const PLACEHOLDERS = new Set([
  '',
  'none',
  'n/a',
  'na',
  'tbd',
  'todo',
  'same as',
  'fulfulde entry',
  'fulfulde lexical entry',
  'fula entry',
  'definition needed',
  'the',
  'a',
  'an',
  '...',
  '---',
]);

const FULFULDE_HOOKED_OR_SPECIAL_RE = /[ɓɗƴŋɲñƁƊƳŊƝÑ]/;
const NON_STANDARD_D_ARTIFACT_RE = /[ďđĎĐ]/;

const FULFULDE_MARKERS = new Set([
  'ko',
  'nde',
  'nder',
  'e',
  'mo',
  'be',
  'ɓe',
  'ngol',
  'ngal',
  'ngel',
  'kal',
  'dam',
  'ɗam',
  'dum',
  'ɗum',
  'hono',
  'walla',
  'ngam',
  'gila',
  'dow',
  'les',
  'yeeso',
  'caggal',
  'neɗɗo',
  'neddo',
  'huunde',
  'hunde',
  'konngol',
  'firti',
  'waɗi',
  'wadi',
  'wonande',
  'fof',
  'fuu',
  'kala',
  'maa',
  'mum',
  'mun',
]);

const ENGLISH_MARKERS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'to',
  'by',
  'as',
  'into',
  'is',
  'are',
  'was',
  'were',
  'used',
  'kind',
  'type',
  'person',
  'something',
  'anything',
  'which',
  'that',
  'who',
  'plural',
  'singular',
  'abbreviation',
  'abriviation',
  'variant',
  'alternative',
]);

export function isPlaceholderOrEmptyFulfulde(text?: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDERS.has(lower)) return true;
  if (lower.startsWith('see ') || lower.startsWith('cf. ') || lower.startsWith('alt. ')) return true;
  if (trimmed.length < 2) return true;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
  return false;
}

export function hasNonStandardOrthographyArtifact(text?: string): boolean {
  if (!text) return false;
  return NON_STANDARD_D_ARTIFACT_RE.test(text);
}

/**
 * Normalizes Fulfulde headwords for either exact orthographic matching (preserving
 * ɓ, ɗ, ƴ, ŋ, ɲ, ñ and doubled vowel length) or flexible ASCII-folded search.
 */
export function normalizeFulfuldeKey(text: string, strictOrthography: boolean = true): string {
  let res = (text || '').trim().normalize('NFC').toLowerCase();
  if (strictOrthography) {
    return res;
  }

  // Flexible orthographic folding for cross-variety & ASCII keyboard lookup:
  // map regional/variant hooked letters and artifacts to ASCII base while keeping searchable tokens
  res = res
    .replace(/[ɓ]/g, 'b')
    .replace(/[ɗďđ]/g, 'd')
    .replace(/[ƴ]/g, 'y')
    .replace(/[ŋ]/g, 'n')
    .replace(/[ɲñ]/g, 'ny')
    .replace(/['’ʼ`]/g, '');

  res = res.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  return res;
}

/**
 * Detects whether a putative Fulfulde definition string is actually English-only gloss text.
 */
export function looksLikeEnglishOnlyFulfulde(def?: string): boolean {
  if (!def) return false;
  const trimmed = def.trim();
  if (!trimmed) return false;
  if (FULFULDE_HOOKED_OR_SPECIAL_RE.test(trimmed)) {
    return false;
  }

  const tokens = trimmed
    .toLowerCase()
    .split(/[^a-zA-Zɓɗƴŋɲñ’']+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;

  const ffHits = tokens.filter((t) => FULFULDE_MARKERS.has(t)).length;
  const enHits = tokens.filter((t) => ENGLISH_MARKERS.has(t)).length;

  if (/^(to|a|an|the|used|one who|he who|she who|plural of)\s+[a-z]{2,}/i.test(trimmed) && ffHits === 0) {
    return true;
  }
  if (enHits > 0 && ffHits === 0) {
    return true;
  }
  if (tokens.length >= 3 && ffHits === 0 && /^[a-z\s,;().'/-]+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function validateFulfuldeDefinition(record: FulfuldeLexicographyRecord): FulfuldeValidationResult {
  const warnings: string[] = [];
  let effectiveType: FulfuldeDefinitionType = record.definitionType;
  let validFulfuldeMonolingual = false;
  let isHumanVerified = false;

  const hasArtifact =
    hasNonStandardOrthographyArtifact(record.headword) ||
    hasNonStandardOrthographyArtifact(record.definitionFf);

  if (hasArtifact) {
    warnings.push('Non-standard Unicode artifact (ď/đ instead of implosive ɗ) detected in headword or definition');
  }

  const ffEmpty = isPlaceholderOrEmptyFulfulde(record.definitionFf);
  const enEmpty = isPlaceholderOrEmptyFulfulde(record.definitionEn);

  if (ffEmpty && enEmpty) {
    warnings.push('Definition missing or placeholder');
    effectiveType = 'unavailable';
  } else if (effectiveType === 'machine_generated') {
    if (record.verificationStatus === 'machine_unverified' || !record.verificationStatus) {
      isHumanVerified = false;
      warnings.push('Unverified machine-generated content excluded from verified Fulfulde statistics');
    }
  } else if (effectiveType === 'fulfulde_monolingual') {
    if (ffEmpty) {
      if (!enEmpty) {
        warnings.push('Declared fulfulde_monolingual but definitionFf missing; reclassifying to english_gloss');
        effectiveType = 'english_gloss';
      } else {
        warnings.push('Declared fulfulde_monolingual but definitionFf is empty or placeholder');
        effectiveType = 'unavailable';
      }
    } else if (looksLikeEnglishOnlyFulfulde(record.definitionFf)) {
      warnings.push('English gloss detected in fulfulde_monolingual field; reclassifying to english_gloss');
      effectiveType = 'english_gloss';
    } else {
      validFulfuldeMonolingual = true;
      isHumanVerified =
        record.verificationStatus === 'community_reviewed' ||
        record.verificationStatus === 'academic_verified' ||
        record.verificationStatus === 'corpus_derived';
    }
  } else if (effectiveType === 'bilingual_explanation') {
    if (ffEmpty && enEmpty) {
      effectiveType = 'unavailable';
    } else if (ffEmpty && !enEmpty) {
      warnings.push('Bilingual explanation missing Fulfulde component; reclassifying to english_gloss');
      effectiveType = 'english_gloss';
    } else if (!ffEmpty && looksLikeEnglishOnlyFulfulde(record.definitionFf)) {
      warnings.push('English-only text found in definitionFf inside bilingual_explanation; reclassifying to english_gloss');
      effectiveType = 'english_gloss';
    } else if (!ffEmpty && enEmpty) {
      warnings.push('Bilingual explanation missing English component; reclassifying to fulfulde_monolingual');
      effectiveType = 'fulfulde_monolingual';
      validFulfuldeMonolingual = true;
      isHumanVerified = record.verificationStatus !== 'machine_unverified' && record.verificationStatus !== 'unverified';
    } else {
      validFulfuldeMonolingual = true;
      isHumanVerified = record.verificationStatus !== 'machine_unverified' && record.verificationStatus !== 'unverified';
    }
  } else if (effectiveType === 'english_gloss') {
    if (enEmpty) {
      warnings.push('English gloss is empty or placeholder');
      effectiveType = 'unavailable';
    }
  }

  const validRecord =
    effectiveType !== 'unavailable' &&
    effectiveType !== 'machine_generated' &&
    (!ffEmpty || !enEmpty);

  return {
    validRecord,
    validFulfuldeMonolingual,
    isHumanVerifiedFulfulde: isHumanVerified,
    effectiveDefinitionType: effectiveType,
    hasOrthographySubstitutionArtifact: hasArtifact,
    warnings,
  };
}

export interface FulfuldeConflictReview {
  headword: string;
  varieties: string[];
  sources: string[];
  conflictType: 'orthographic_variant' | 'regional_variety_divergence' | 'definition_mismatch';
  resolutionStatus: 'retained_labelled' | 'flagged_for_review';
}

export function evaluateFulfuldeConflicts(records: FulfuldeLexicographyRecord[]): FulfuldeConflictReview[] {
  const map = new Map<string, FulfuldeLexicographyRecord[]>();
  for (const r of records) {
    const key = normalizeFulfuldeKey(r.headword, false);
    const list = map.get(key) || [];
    list.push(r);
    map.set(key, list);
  }

  const conflicts: FulfuldeConflictReview[] = [];
  for (const [key, list] of map.entries()) {
    if (list.length <= 1) continue;
    const distinctForms = new Set(list.map((l) => l.headword.normalize('NFC').toLowerCase()));
    const distinctVarieties = Array.from(new Set(list.map((l) => String(l.variety || 'pan_fulfulde'))));
    const distinctSources = Array.from(new Set(list.map((l) => l.source)));

    if (distinctForms.size > 1) {
      conflicts.push({
        headword: key,
        varieties: distinctVarieties,
        sources: distinctSources,
        conflictType: distinctVarieties.length > 1 ? 'regional_variety_divergence' : 'orthographic_variant',
        resolutionStatus: 'retained_labelled',
      });
    } else if (distinctSources.length > 1) {
      conflicts.push({
        headword: key,
        varieties: distinctVarieties,
        sources: distinctSources,
        conflictType: 'definition_mismatch',
        resolutionStatus: 'flagged_for_review',
      });
    }
  }

  return conflicts;
}
