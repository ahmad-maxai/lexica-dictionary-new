export interface EnglishPackManifest {
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

export const ENGLISH_PACK_MANIFEST: EnglishPackManifest = {
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
