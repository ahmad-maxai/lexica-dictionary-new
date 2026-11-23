export type YorubaDefinitionType =
  | 'yoruba_monolingual'
  | 'english_gloss'
  | 'bilingual_explanation'
  | 'machine_generated'
  | 'unavailable';

export type VerificationStatus =
  | 'community_reviewed'
  | 'academic_verified'
  | 'corpus_derived'
  | 'machine_unverified'
  | 'unverified';

export interface YorubaLexicographyRecord {
  headword: string;
  normalizedHeadword?: string;
  scriptVariant?: string;
  partOfSpeech: string;
  definitionYo?: string;
  definitionEn?: string;
  definitionType: YorubaDefinitionType;
  examples?: string[];
  pronunciation?: string;
  relatedWords?: string[];
  tonePattern?: string;
  source: string;
  license: string;
  verificationStatus?: VerificationStatus;
}

export interface YorubaValidationResult {
  validRecord: boolean;
  validYorubaMonolingual: boolean;
  isHumanVerifiedYoruba: boolean;
  effectiveDefinitionType: YorubaDefinitionType;
  warnings: string[];
}

const PLACEHOLDERS = new Set([
  '',
  'none',
  'n/a',
  'tbd',
  'todo',
  'yoruba entry',
  'yoruba lexical entry',
  'definition needed',
  '...',
  '---',
]);

export function isPlaceholderOrEmpty(text?: string): boolean {
  if (!text) return true;
  const trimmed = text.trim().toLowerCase();
  if (PLACEHOLDERS.has(trimmed)) return true;
  if (trimmed.startsWith('see ') || trimmed.startsWith('cf. ')) return true;
  if (trimmed.length < 3) return true;
  return false;
}

export function normalizeYorubaKey(text: string, strictDiacritics: boolean = false): string {
  let res = text.trim().toLowerCase();
  if (!strictDiacritics) {
    res = res.normalize('NFD');
    res = res.replace(/[\u0300\u0301\u0304]/g, '');
    res = res.normalize('NFC');
  }
  return res;
}

export function looksLikeEnglishOnlyGloss(def?: string): boolean {
  if (!def) return false;
  const lower = def.toLowerCase();
  const englishKeywords = [
    'a kind of',
    'type of animal',
    'used for',
    'plural of',
    'capital of',
    'water; liquid',
    'to run quickly',
    'a given name',
  ];
  if (englishKeywords.some(k => lower.includes(k))) return true;

  const yorubaWords = ['ni', 'ti', 'fun', 'pe', 'ohun', 'oruko', 'kii', 'se', 'bi', 'lati', 'ara', 'ilé', 'omi'];
  const words = lower.split(/\s+/);
  const yorubaMatchCount = words.filter(w => yorubaWords.includes(w)).length;
  
  if (words.length > 3 && yorubaMatchCount === 0 && /^[a-z\s,;()-]+$/.test(lower)) {
    return true;
  }

  return false;
}

export function validateYorubaDefinition(record: YorubaLexicographyRecord): YorubaValidationResult {
  const warnings: string[] = [];
  let effectiveType = record.definitionType;
  let validYorubaMonolingual = false;
  let isHumanVerified = false;

  if (isPlaceholderOrEmpty(record.definitionYo) && isPlaceholderOrEmpty(record.definitionEn)) {
    warnings.push('Definition missing or placeholder');
    effectiveType = 'unavailable';
  } else if (effectiveType === 'yoruba_monolingual') {
    if (isPlaceholderOrEmpty(record.definitionYo)) {
      warnings.push('Declared yoruba_monolingual but definitionYo is empty or placeholder');
      effectiveType = 'unavailable';
    } else if (looksLikeEnglishOnlyGloss(record.definitionYo)) {
      warnings.push('English gloss detected in yoruba_monolingual field; reclassifying to english_gloss');
      effectiveType = 'english_gloss';
    } else {
      validYorubaMonolingual = true;
      if (record.verificationStatus === 'community_reviewed' || record.verificationStatus === 'academic_verified' || record.verificationStatus === 'corpus_derived') {
        isHumanVerified = true;
      }
    }
  } else if (effectiveType === 'bilingual_explanation') {
    if (isPlaceholderOrEmpty(record.definitionYo) || isPlaceholderOrEmpty(record.definitionEn)) {
      warnings.push('Bilingual explanation missing either Yoruba or English component');
    } else {
      validYorubaMonolingual = true;
      if (record.verificationStatus !== 'machine_unverified') {
        isHumanVerified = true;
      }
    }
  } else if (effectiveType === 'english_gloss') {
    if (isPlaceholderOrEmpty(record.definitionEn)) {
      warnings.push('English gloss is empty');
      effectiveType = 'unavailable';
    }
  } else if (effectiveType === 'machine_generated') {
    if (record.verificationStatus === 'machine_unverified' || !record.verificationStatus) {
      isHumanVerified = false;
      warnings.push('Unverified machine-generated content excluded from verified human counts');
    }
  }

  const validRecord = effectiveType !== 'unavailable' && (Boolean(record.definitionYo) || Boolean(record.definitionEn));

  return {
    validRecord,
    validYorubaMonolingual,
    isHumanVerifiedYoruba: isHumanVerified,
    effectiveDefinitionType: effectiveType,
    warnings,
  };
}

export interface ConflictReview {
  headword: string;
  sources: string[];
  conflictType: 'tonal_variant' | 'definition_mismatch' | 'pos_discrepancy';
  resolutionStatus: 'unresolved' | 'retained_both' | 'flagged_for_review';
}

export function evaluateYorubaConflicts(records: YorubaLexicographyRecord[]): ConflictReview[] {
  const map = new Map<string, YorubaLexicographyRecord[]>();
  for (const r of records) {
    const key = normalizeYorubaKey(r.headword, true);
    const list = map.get(key) || [];
    list.push(r);
    map.set(key, list);
  }

  const conflicts: ConflictReview[] = [];
  for (const [key, list] of map.entries()) {
    if (list.length > 1) {
      const sources = Array.from(new Set(list.map(l => l.source)));
      conflicts.push({
        headword: key,
        sources,
        conflictType: 'tonal_variant',
        resolutionStatus: 'flagged_for_review',
      });
    }
  }
  return conflicts;
}
