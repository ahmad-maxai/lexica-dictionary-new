export interface HausaPackManifest {
  packId: string;
  targetLanguage: 'ha';
  format: 'sqlite-gzip';
  packLayer?: 'core' | 'extended' | 'full';
  schemaVersion: number;
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
  corePrimarySenses?: number;
  totalWordForms?: number;
  extendedCompanion?: {
    packId: string;
    packLayer: 'extended';
    schemaVersion: number;
    packVersion: string;
    optional: true;
    autoDownload: false;
    compressedSizeBytes: number;
    compressedSha256: string;
    uncompressedSizeBytes: number;
    uncompressedSha256: string;
    downloadUrl: string | null;
  };
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

export function validateHausaPackManifest(
  manifest: Partial<HausaPackManifest> | null | undefined
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

export const HAUSA_PACK_MANIFEST: HausaPackManifest = {
  packId: 'ha-wiktionary-sqlite',
  targetLanguage: 'ha',
  format: 'sqlite-gzip',
  packLayer: 'core',
  schemaVersion: 3,
  packVersion: '0.4.0-core',
  datasetVersion: '2026.11-wiktionary-ha-v0.4.0',
  releaseTag: 'prototype-ha-core-v0.4.0',
  downloadUrl:
    'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-ha-core-v0.4.0/lexica_hausa_core.db.gz',
  compressedSizeBytes: 303106,
  compressedSha256: '15dbc6906124348d21b1ba46475e85092feb705babd4315295f582f04971ff70',
  uncompressedSizeBytes: 663552,
  uncompressedSha256: '08c0ae60f2329e3685db34a9b059357667dc0de1ba525343ad78c74f8e52c953',
  acceptedEntries: 2260,
  distinctHeadwords: 2013,
  totalSenses: 2832,
  corePrimarySenses: 2260,
  totalWordForms: 4502,
  extendedCompanion: {
    packId: 'ha-wiktionary-sqlite-extended',
    packLayer: 'extended',
    schemaVersion: 3,
    packVersion: '0.4.0-extended',
    optional: true,
    autoDownload: false,
    compressedSizeBytes: 138086,
    compressedSha256: 'e726147cba40d88eee1b23ba2d0d87f8e8383c371f1131579440ced3a3773906',
    uncompressedSizeBytes: 421888,
    uncompressedSha256: 'c72ffb3bf189acab9f682ad296dae076f611ac87b5258172ab587948a665d810',
    downloadUrl:
      'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-ha-core-v0.4.0/lexica_hausa_extended.db.gz',
  },
  attribution: {
    sourceName: 'Hausa Wiktionary via Kaikki.org & Lexica Curation',
    license: 'CC BY-SA 4.0 & GFDL',
    attributionText:
      'Extracted from Wiktionary by Kaikki.org (Wiktextract) and curated by Lexica Multilingual Lexicography Project. Copyright Wikimedia Contributors and Tatu Ylönen.',
    sourceUrl: 'https://kaikki.org/dictionary/Hausa/',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
};

export function isHausaSqliteIntegrationEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const override = localStorage.getItem('lexica_enable_hausa_sqlite');
    if (override === 'false') return false;
    if (override === 'true') return true;
  }
  return true;
}
