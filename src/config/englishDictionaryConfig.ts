export interface EnglishPackManifest {
  packId: string;
  targetLanguage: 'en';
  format: 'sqlite-gzip';
  packVersion: string;
  datasetVersion: string;
  releaseTag: string;
  downloadUrl: string;
  compressedSizeBytes: number;
  compressedSha256: string;
  uncompressedSizeBytes: number;
  uncompressedSha256: string;
  acceptedEntries: number;
  distinctHeadwords: number;
  totalSenses: number;
  attribution: {
    sourceName: string;
    license: string;
    attributionText: string;
    sourceUrl: string;
    licenseUrl: string;
  };
}

export interface ManifestValidationResult {
  valid: boolean;
  missingOrInvalidFields: string[];
  message: string;
}

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export function validateEnglishPackManifest(
  manifest: Partial<EnglishPackManifest> | null | undefined
): ManifestValidationResult {
  const missing: string[] = [];
  if (!manifest) {
    return {
      valid: false,
      missingOrInvalidFields: ['manifest'],
      message: 'INVALID_MANIFEST: Pack manifest object is missing.',
    };
  }
  if (!manifest.packId || typeof manifest.packId !== 'string' || !manifest.packId.trim()) {
    missing.push('packId');
  }
  if (!manifest.packVersion || typeof manifest.packVersion !== 'string' || !manifest.packVersion.trim()) {
    missing.push('packVersion');
  }
  if (!manifest.datasetVersion || typeof manifest.datasetVersion !== 'string' || !manifest.datasetVersion.trim()) {
    missing.push('datasetVersion');
  }
  if (
    !manifest.downloadUrl ||
    typeof manifest.downloadUrl !== 'string' ||
    !/^https:\/\//i.test(manifest.downloadUrl.trim())
  ) {
    missing.push('downloadUrl');
  }
  if (
    typeof manifest.compressedSizeBytes !== 'number' ||
    !Number.isFinite(manifest.compressedSizeBytes) ||
    manifest.compressedSizeBytes <= 0
  ) {
    missing.push('compressedSizeBytes');
  }
  if (
    typeof manifest.uncompressedSizeBytes !== 'number' ||
    !Number.isFinite(manifest.uncompressedSizeBytes) ||
    manifest.uncompressedSizeBytes <= 0
  ) {
    missing.push('uncompressedSizeBytes');
  }
  if (
    !manifest.compressedSha256 ||
    typeof manifest.compressedSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(manifest.compressedSha256.trim())
  ) {
    missing.push('compressedSha256');
  }
  if (
    !manifest.uncompressedSha256 ||
    typeof manifest.uncompressedSha256 !== 'string' ||
    !SHA256_HEX_REGEX.test(manifest.uncompressedSha256.trim())
  ) {
    missing.push('uncompressedSha256');
  }

  return {
    valid: missing.length === 0,
    missingOrInvalidFields: missing,
    message:
      missing.length === 0
        ? 'Manifest validated.'
        : `INVALID_MANIFEST: Invalid or missing field(s): ${missing.join(', ')}.`,
  };
}

export const ENGLISH_PACK_MANIFEST: EnglishPackManifest = {
  packId: 'en-wiktionary-sqlite',
  targetLanguage: 'en',
  format: 'sqlite-gzip',
  packVersion: '0.2.0',
  datasetVersion: '2026.11-wiktionary-en-v0.2.0',
  releaseTag: 'prototype-en-v0.2.0',
  downloadUrl:
    'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-en-v0.2.0/lexica_english.db.gz',
  compressedSizeBytes: 58190048,
  compressedSha256: '244252ca0e660796ab27b446164696dda77195c404c64f42f9075c1192bd0cfb',
  uncompressedSizeBytes: 165916672,
  uncompressedSha256: '5c0b56064fdda54db58b397729ec83cf74fba9f6eeb6ec7a4fd793973ddb42ea',
  acceptedEntries: 75000,
  distinctHeadwords: 45317,
  totalSenses: 190672,
  attribution: {
    sourceName: 'English Wiktionary via Kaikki.org (Wiktextract)',
    license: 'CC BY-SA 4.0 & GFDL',
    attributionText:
      'Extracted from English Wiktionary by Kaikki.org (Wiktextract). Copyright Wikimedia Contributors and Tatu Ylönen.',
    sourceUrl: 'https://kaikki.org/dictionary/English/',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
};

const FEATURE_FLAG_STORAGE_KEY = 'lexica_feature_english_sqlite';

let runtimeFeatureOverride: boolean | null = null;

/**
 * Isolated feature switch controlling whether Standard English dictionary queries
 * route through the verified English SQLite pack vs. preserving the original
 * starter English corpus implementation.
 */
export function isEnglishSqliteIntegrationEnabled(): boolean {
  if (runtimeFeatureOverride !== null) {
    return runtimeFeatureOverride;
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(FEATURE_FLAG_STORAGE_KEY);
      if (stored === 'false') return false;
      if (stored === 'true') return true;
    } catch {
      // Ignore storage access errors
    }
  }
  return true;
}

export function setEnglishSqliteIntegrationEnabled(enabled: boolean | null): void {
  runtimeFeatureOverride = enabled;
  if (typeof window !== 'undefined') {
    try {
      if (enabled === null) {
        window.localStorage.removeItem(FEATURE_FLAG_STORAGE_KEY);
      } else {
        window.localStorage.setItem(FEATURE_FLAG_STORAGE_KEY, String(enabled));
      }
    } catch {
      // Ignore storage access errors
    }
  }
}
