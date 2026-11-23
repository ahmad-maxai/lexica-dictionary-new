import { TextNormalization } from './textNormalization';

export type HausaDefinitionType =
  | 'hausa_monolingual'
  | 'english_gloss'
  | 'bilingual_explanation'
  | 'machine_generated'
  | 'unavailable';

export type HausaVerificationStatus =
  | 'human_verified'
  | 'community_reviewed'
  | 'unverified_import'
  | 'conflict_flagged'
  | 'rejected';

/**
 * Canonical 12-field Hausa Lexicography Record (Assignment 010 Architecture)
 * Preserves full source provenance, license compliance, and separates
 * Hausa monolingual explanations from English glosses and unverified imports.
 */
export interface HausaLexicographyRecord {
  headword: string;
  normalizedHeadword: string;
  scriptVariant: string | null;
  partOfSpeech: string;
  definitionHa: string | null;
  definitionEn: string | null;
  definitionType: HausaDefinitionType;
  examples: string[];
  pronunciation: string | null;
  relatedWords: string[];
  source: string;
  license: string;
  verificationStatus?: HausaVerificationStatus;
  hasConflictingSources?: boolean;
  conflictNotes?: string[];
}

export interface HausaDefinitionValidationResult {
  validRecord: boolean;
  validHausaMonolingual: boolean;
  isHumanVerifiedHausa: boolean;
  effectiveDefinitionType: HausaDefinitionType;
  reasons: string[];
}

export interface HausaSourceConflictResult {
  headword: string;
  hasConflict: boolean;
  preservedSources: Array<{
    source: string;
    license: string;
    partOfSpeech: string;
    definitionType: HausaDefinitionType;
    definitionText: string;
  }>;
  conflictReasons: string[];
  requiresNativeReview: boolean;
}

const GENERIC_PLACEHOLDER_PATTERNS: RegExp[] = [
  /^hausa lexical entry\.?$/i,
  /^hausa entry\.?$/i,
  /^kalmar tana nufin\.?$/i,
  /^wannan kalma tana nufin\.?$/i,
  /^see\s+[\w-]+(\s+[\w-]+)*\.?$/i,
  /^(tbd|todo|placeholder|no definition|unavailable|none|null|n\/a)\.?$/i,
];

const WIKI_OR_OCR_CORRUPTION_PATTERNS: RegExp[] = [
  /<ref[\s>]/i,
  /<\/ref>/i,
  /\{\{[^}]*\}\}/,
  /\[\[Category:/i,
  /^==+.*==+$/,
  /\bprofli-\s*gate\b/i,
];

const ENGLISH_GLOSS_MARKERS = new Set([
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
  'by',
  'as',
  'into',
  'substance',
  'liquid',
  'given',
  'name',
  'something',
  'someone',
  'person',
  'plural',
  'singular',
  'verbal',
  'noun',
  'alternative',
  'form',
  'spelling',
  'variant',
  'dialectal',
  'action',
  'act',
  'state',
  'used',
  'relating',
]);

const HAUSA_EXPLANATION_MARKERS = new Set([
  'ne',
  'ce',
  'na',
  'ta',
  'da',
  'ko',
  'mai',
  'masu',
  'wanda',
  'wadda',
  'wadanda',
  'waɗanda',
  'kalma',
  'kalmar',
  'abu',
  'abun',
  'wuri',
  'lokaci',
  'mutum',
  'mutane',
  'tana',
  'yana',
  'suna',
  'nufin',
  'aiki',
  'gida',
  'ruwa',
  'kuma',
  'cikin',
  'don',
  'saboda',
  'kamar',
  'ma’ana',
  "ma'ana",
  'irin',
  'wani',
  'wata',
  'wasu',
  'daga',
  'bayan',
  'kafin',
  'tsakanin',
  'ƙasa',
  'kasa',
  'sanya',
  'yin',
  'samu',
  'bayani',
  'sunan',
  'suna',
]);

export function isPlaceholderOrEmpty(text: string | null | undefined): boolean {
  if (!text) return true;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 3) return true;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;

  for (const pat of GENERIC_PLACEHOLDER_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

export function hasMarkupOrOcrDefect(text: string | null | undefined): boolean {
  if (!text) return false;
  return WIKI_OR_OCR_CORRUPTION_PATTERNS.some((pat) => pat.test(text));
}

/**
 * Heuristic detector that ensures English glosses (like Assignment 009's Kaikki records)
 * cannot masquerade as Hausa monolingual explanations.
 */
export function looksLikeEnglishOnlyGloss(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;

  // Contains Hausa hooked consonants -> definitely contains Hausa orthography
  if (/[ɓɗƙƴƁƊƘƳ]/.test(trimmed)) {
    return false;
  }

  const tokens = trimmed
    .toLowerCase()
    .split(/[^a-zɗɓƙƴ’']+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;

  let enHits = 0;
  let haHits = 0;
  for (const tok of tokens) {
    if (ENGLISH_GLOSS_MARKERS.has(tok)) enHits++;
    if (HAUSA_EXPLANATION_MARKERS.has(tok)) haHits++;
  }

  // Typical dictionary English infinitive gloss: "to run", "to eat; consume"
  if (/^to\s+[a-z]{2,}\b/i.test(trimmed) && haHits === 0) {
    return true;
  }

  // Typical English noun gloss with parentheses/grammar tags: "A given name", "plural of ..."
  if (/^(a|an|the)\s+[a-z]+\b/i.test(trimmed) && haHits === 0) {
    return true;
  }

  if (enHits > 0 && haHits === 0) {
    return true;
  }

  // Long glosses with zero Hausa structural particles and multiple English markers
  if (enHits >= 2 && enHits > haHits * 2) {
    return true;
  }

  return false;
}

export function validateHausaDefinition(record: Partial<HausaLexicographyRecord>): HausaDefinitionValidationResult {
  const reasons: string[] = [];

  if (!record.headword || record.headword.trim().length === 0) {
    reasons.push('Missing required headword.');
  }
  if (!record.partOfSpeech || record.partOfSpeech.trim().length === 0) {
    reasons.push('Missing required partOfSpeech.');
  }
  if (!record.source || record.source.trim().length === 0) {
    reasons.push('Missing required source provenance.');
  }
  if (!record.license || record.license.trim().length === 0) {
    reasons.push('Missing required license metadata.');
  }

  const haDef = record.definitionHa?.replace(/\s+/g, ' ').trim() || '';
  const enDef = record.definitionEn?.replace(/\s+/g, ' ').trim() || '';
  const declaredType = record.definitionType || 'unavailable';

  const haUsable = !isPlaceholderOrEmpty(haDef);
  const enUsable = !isPlaceholderOrEmpty(enDef);

  if (haUsable && hasMarkupOrOcrDefect(haDef)) {
    reasons.push('Hausa definition contains raw wiki markup or OCR line-break corruption.');
  }
  if (enUsable && hasMarkupOrOcrDefect(enDef)) {
    reasons.push('English gloss contains raw wiki markup or OCR line-break corruption.');
  }

  if (declaredType === 'machine_generated') {
    reasons.push('Machine-generated Hausa definitions cannot be counted as verified human-authored definitions.');
    return {
      validRecord: reasons.length <= 1 && Boolean(record.headword && record.source && record.license),
      validHausaMonolingual: false,
      isHumanVerifiedHausa: false,
      effectiveDefinitionType: 'machine_generated',
      reasons,
    };
  }

  let effectiveType: HausaDefinitionType = declaredType;
  let validHausaMonolingual = false;

  if (haUsable && !hasMarkupOrOcrDefect(haDef)) {
    if (looksLikeEnglishOnlyGloss(haDef)) {
      reasons.push('definitionHa appears to be an English gloss rather than a Hausa-language explanation.');
      effectiveType = enUsable || haUsable ? 'english_gloss' : 'unavailable';
      validHausaMonolingual = false;
    } else {
      validHausaMonolingual = true;
      effectiveType = enUsable ? 'bilingual_explanation' : 'hausa_monolingual';
    }
  } else if (enUsable && !hasMarkupOrOcrDefect(enDef)) {
    if (declaredType === 'hausa_monolingual' || declaredType === 'bilingual_explanation') {
      reasons.push('Declared Hausa definition is missing or generic placeholder; downgrading to english_gloss.');
    }
    effectiveType = 'english_gloss';
    validHausaMonolingual = false;
  } else {
    reasons.push('No usable Hausa explanation or English gloss available (placeholder or empty rejected).');
    effectiveType = 'unavailable';
    validHausaMonolingual = false;
  }

  const isHumanVerifiedHausa =
    validHausaMonolingual &&
    record.verificationStatus !== 'unverified_import' &&
    record.verificationStatus !== 'rejected';

  const hasCoreProvenance = Boolean(
    record.headword?.trim() &&
      record.partOfSpeech?.trim() &&
      record.source?.trim() &&
      record.license?.trim()
  );

  return {
    validRecord: hasCoreProvenance && (validHausaMonolingual || effectiveType === 'english_gloss'),
    validHausaMonolingual,
    isHumanVerifiedHausa,
    effectiveDefinitionType: effectiveType,
    reasons,
  };
}

/**
 * Compares multiple sourced records for the same Hausa headword.
 * Never auto-merges or silently overwrites conflicting definitions or parts of speech.
 */
export function evaluateSourceConflicts(records: HausaLexicographyRecord[]): HausaSourceConflictResult {
  if (records.length === 0) {
    return {
      headword: '',
      hasConflict: false,
      preservedSources: [],
      conflictReasons: [],
      requiresNativeReview: false,
    };
  }

  const headword = records[0].headword;
  const posSet = new Set(records.map((r) => r.partOfSpeech.trim().toLowerCase()).filter(Boolean));
  const defNormSet = new Set(
    records
      .map((r) => {
        const primary = r.definitionHa || r.definitionEn || '';
        return TextNormalization.normalizeLatin(primary).deep;
      })
      .filter((d) => d.length > 0)
  );
  const typeSet = new Set(records.map((r) => r.definitionType));

  const conflictReasons: string[] = [];
  if (posSet.size > 1) {
    conflictReasons.push(`Conflicting parts of speech across sources: ${Array.from(posSet).join(', ')}`);
  }
  if (
    typeSet.has('hausa_monolingual') &&
    typeSet.has('english_gloss') &&
    records.some((r) => r.verificationStatus === 'unverified_import')
  ) {
    conflictReasons.push('Unverified historical/gloss entry differs in type from Hausa monolingual sense.');
  }
  if (defNormSet.size > 1 && records.length > 1) {
    // Check if definitions share minimal token overlap
    const tokenSets = records
      .map((r) => new Set((r.definitionHa || r.definitionEn || '').toLowerCase().split(/\W+/).filter((t) => t.length >= 3)));
    if (tokenSets.length >= 2) {
      const a = tokenSets[0];
      const b = tokenSets[1];
      let overlap = 0;
      for (const tok of a) {
        if (b.has(tok)) overlap++;
      }
      if (overlap === 0 && a.size > 0 && b.size > 0 && typeSet.size === 1) {
        conflictReasons.push('Same definition language/type across sources with zero lexical overlap; manual review required.');
      }
    }
  }

  return {
    headword,
    hasConflict: conflictReasons.length > 0,
    preservedSources: records.map((r) => ({
      source: r.source,
      license: r.license,
      partOfSpeech: r.partOfSpeech,
      definitionType: r.definitionType,
      definitionText: r.definitionHa || r.definitionEn || '',
    })),
    conflictReasons,
    requiresNativeReview: conflictReasons.length > 0,
  };
}
