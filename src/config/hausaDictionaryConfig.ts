export interface HausaSourceAttribution {
  code: string;
  sourceName: string;
  license: string;
  attributionText: string;
  sourceUrl: string;
  licenseUrl: string;
  shareAlikeRequired: boolean;
  entriesIncludedCount?: number;
  role: string;
}

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
  hausaMonolingualCount?: number;
  bilingualExplanationCount?: number;
  englishGlossOnlyCount?: number;
  conflictCount?: number;
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
  sourceAttributions: HausaSourceAttribution[];
  kamusunHausaStatusNote: string;
  appVsDataLicensingNote: string;
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
  packId: 'ha-lexica-schema-v4',
  targetLanguage: 'ha',
  format: 'sqlite-gzip',
  packLayer: 'core',
  schemaVersion: 4,
  packVersion: '0.5.0-core',
  datasetVersion: '2026.11-hausa-schema-v4-v0.5.0',
  releaseTag: 'prototype-ha-core-v0.5.0',
  downloadUrl:
    'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-ha-core-v0.5.0/lexica_hausa_core.db.gz',
  compressedSizeBytes: 1250359,
  compressedSha256: '5a3ca52afceb1565c075f584f511c3e71f129148b13c5a5171c54a7e98dafc0a',
  uncompressedSizeBytes: 3846144,
  uncompressedSha256: 'f27c2beac0935124146db25cbc9d4de9ac6c185cf3e403570873bcdc8dbfcc61',
  acceptedEntries: 10201,
  distinctHeadwords: 9893,
  totalSenses: 15010,
  corePrimarySenses: 10201,
  totalWordForms: 5581,
  hausaMonolingualCount: 6180,
  bilingualExplanationCount: 2556,
  englishGlossOnlyCount: 1465,
  conflictCount: 352,
  extendedCompanion: {
    packId: 'ha-lexica-schema-v4-extended',
    packLayer: 'extended',
    schemaVersion: 4,
    packVersion: '0.5.0-extended',
    optional: true,
    autoDownload: false,
    compressedSizeBytes: 1083908,
    compressedSha256: '9884ac6d24ece944c66a92499e82c84492b2bd365e9e3059bc650339a5bca9d9',
    uncompressedSizeBytes: 4861952,
    uncompressedSha256: '33aab68b6ff5b02e89995355755ccd18b225fc06715f2696524ca9682bb6cbd9',
    downloadUrl:
      'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-ha-core-v0.5.0/lexica_hausa_extended.db.gz',
  },
  attribution: {
    sourceName: 'Hausa Wiktionary, Kaikki EN-Wiktionary, Wikidata Q56475, Tatoeba & Lexica Curated Corpus',
    license: 'CC BY-SA 4.0 & GFDL; CC0 1.0; CC BY 2.0 FR',
    attributionText:
      'Open-licensed Hausa lexicography compiled from Hausa Wiktionary (ha.wiktionary.org), English Wiktionary via Kaikki.org (CC BY-SA 4.0 & GFDL), Wikidata Q56475 (CC0 1.0), Tatoeba (CC BY 2.0 FR), and Lexica Curated Corpus.',
    sourceUrl: 'https://ha.wiktionary.org/',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  sourceAttributions: [
    {
      code: 'hawiktionary',
      sourceName: 'Hausa Wiktionary (ha.wiktionary.org)',
      license: 'CC BY-SA 4.0 & GFDL',
      attributionText:
        'Copyright Wikimedia Contributors (ha.wiktionary.org). Share-Alike applies to modified or derivative Wiktionary dictionary text under CC BY-SA 4.0.',
      sourceUrl: 'https://ha.wiktionary.org/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      shareAlikeRequired: true,
      entriesIncludedCount: 8715,
      role: 'Primary Hausa-to-Hausa definitions, examples & plurals',
    },
    {
      code: 'kaikki-en-wikt',
      sourceName: 'English Wiktionary Hausa via Kaikki.org',
      license: 'CC BY-SA 4.0 & GFDL',
      attributionText:
        'Copyright Wikimedia Contributors & Tatu Ylönen (Kaikki.org / Wiktextract). Share-Alike applies under CC BY-SA 4.0.',
      sourceUrl: 'https://kaikki.org/dictionary/Hausa/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      shareAlikeRequired: true,
      entriesIncludedCount: 1030,
      role: 'English glosses, IPA pronunciations, audio refs & inflected forms',
    },
    {
      code: 'wikidata-q56475',
      sourceName: 'Wikidata Lexemes (Hausa Q56475)',
      license: 'CC0 1.0 Public Domain Dedication',
      attributionText: 'Structured lexeme lemmas, Ajami forms and bilingual glosses from Wikidata contributors.',
      sourceUrl: 'https://www.wikidata.org/',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      shareAlikeRequired: false,
      entriesIncludedCount: 385,
      role: 'Ajami Arabic-script orthographic variants & supplementary glosses',
    },
    {
      code: 'tatoeba-hau',
      sourceName: 'Tatoeba Hausa Sentence Corpus',
      license: 'CC BY 2.0 FR',
      attributionText: 'Hausa usage sentences contributed by Tatoeba Project contributors (CC BY 2.0 FR).',
      sourceUrl: 'https://tatoeba.org/',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
      shareAlikeRequired: false,
      role: 'Verified Hausa usage examples (Extended pack)',
    },
    {
      code: 'lexica-curated',
      sourceName: 'Lexica Curated Hausa Corpus',
      license: 'CC0 1.0 / Lexica Project License',
      attributionText: 'Curated and native-authored by the LEXICA Multilingual Lexicography Project.',
      sourceUrl: 'https://github.com/ahmad-maxai/lexica-dictionary-new',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      shareAlikeRequired: false,
      entriesIncludedCount: 71,
      role: 'Human-verified bilingual entries, IPA, tone & Ajami variants',
    },
  ],
  kamusunHausaStatusNote:
    '0 entries from Ƙamusun Hausa (CSNL / Bayero University) are included. Written permission from CSNL/HausaNLP is required prior to any future ingestion.',
  appVsDataLicensingNote:
    'Application source code and downloaded offline dictionary data packs are governed by their respective licenses. Wiktionary-derived dictionary packs retain CC BY-SA 4.0 & GFDL Share-Alike obligations; the entire bundled LEXICA database is not claimed to be under GPL.',
};

const HAUSA_FEATURE_FLAG_KEY = 'lexica_enable_hausa_sqlite';
let runtimeHausaOverride: boolean | null = null;

export function isHausaSqliteIntegrationEnabled(): boolean {
  if (runtimeHausaOverride !== null) {
    return runtimeHausaOverride;
  }
  if (typeof window !== 'undefined') {
    try {
      const override = window.localStorage.getItem(HAUSA_FEATURE_FLAG_KEY);
      if (override === 'false') return false;
      if (override === 'true') return true;
    } catch {
      // Ignore storage access errors
    }
  }
  return true;
}

export function setHausaSqliteIntegrationEnabled(enabled: boolean | null): void {
  runtimeHausaOverride = enabled;
  if (typeof window !== 'undefined') {
    try {
      if (enabled === null) {
        window.localStorage.removeItem(HAUSA_FEATURE_FLAG_KEY);
      } else {
        window.localStorage.setItem(HAUSA_FEATURE_FLAG_KEY, String(enabled));
      }
    } catch {
      // Ignore storage access errors
    }
  }
}
