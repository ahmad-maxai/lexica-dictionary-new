export interface YorubaSourceAttribution {
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

export interface YorubaPackManifest {
  packId: string;
  targetLanguage: 'yo';
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
  yorubaMonolingualCount?: number;
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
  sourceAttributions: YorubaSourceAttribution[];
  appVsDataLicensingNote: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  missingOrInvalidFields: string[];
  message: string;
}

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export function validateYorubaPackManifest(
  manifest: Partial<YorubaPackManifest> | null | undefined
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

export const YORUBA_PACK_MANIFEST: YorubaPackManifest = {
  packId: 'yo-lexica-schema-v4',
  targetLanguage: 'yo',
  format: 'sqlite-gzip',
  packLayer: 'core',
  schemaVersion: 4,
  packVersion: '0.5.0-core',
  datasetVersion: '2026.11-yoruba-schema-v4-v0.5.0',
  releaseTag: 'prototype-yo-core-v0.5.0',
  downloadUrl:
    'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-yo-core-v0.5.0/lexica_yoruba_core.db.gz',
  compressedSizeBytes: 303855,
  compressedSha256: '36035398206e1ad8fa41c70614df1f56612f945aa661304428be44caedfd28d7',
  uncompressedSizeBytes: 4079616,
  uncompressedSha256: '88457fa5d02d04f26059e4578b6a0f4cac93d5966b9f88ecbf34b550cf7119e0',
  acceptedEntries: 11200,
  distinctHeadwords: 11200,
  totalSenses: 14850,
  corePrimarySenses: 11200,
  totalWordForms: 4200,
  yorubaMonolingualCount: 5420,
  bilingualExplanationCount: 3890,
  englishGlossOnlyCount: 1890,
  conflictCount: 342,
  extendedCompanion: {
    packId: 'yo-lexica-schema-v4-extended',
    packLayer: 'extended',
    schemaVersion: 4,
    packVersion: '0.5.0-extended',
    optional: true,
    autoDownload: false,
    compressedSizeBytes: 116538,
    compressedSha256: '6e084a2998f120c1e9a29fa8891b38c5bff9d6077c65c48455eb194b00f100fa',
    uncompressedSizeBytes: 4628480,
    uncompressedSha256: 'a6b7b931ae67e23fbfb76f14cb86cb74071e62554ba40962a79737b0cc9bf7f1',
    downloadUrl:
      'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-yo-core-v0.5.0/lexica_yoruba_extended.db.gz',
  },
  attribution: {
    sourceName: 'Yoruba Wiktionary, Kaikki EN-Wiktionary, Wikidata Q34343, Tatoeba & Lexica Curated Corpus',
    license: 'CC BY-SA 4.0 & GFDL; CC0 1.0; CC BY 4.0',
    attributionText:
      'Open-licensed Yoruba lexicography compiled from Yoruba Wiktionary (yo.wiktionary.org), English Wiktionary via Kaikki.org (CC BY-SA 4.0 & GFDL), Wikidata Q34343 (CC0 1.0), Tatoeba (CC BY 4.0), and Lexica Curated Corpus.',
    sourceUrl: 'https://yo.wiktionary.org/',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  sourceAttributions: [
    {
      code: 'yowiktionary',
      sourceName: 'Yoruba Wiktionary (yo.wiktionary.org)',
      license: 'CC BY-SA 4.0 & GFDL',
      attributionText:
        'Copyright Wikimedia Contributors (yo.wiktionary.org). Share-Alike applies to modified or derivative Wiktionary dictionary text under CC BY-SA 4.0.',
      sourceUrl: 'https://yo.wiktionary.org/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      shareAlikeRequired: true,
      entriesIncludedCount: 8900,
      role: 'Primary Yoruba-to-Yoruba definitions, examples & tonal lemmas',
    },
    {
      code: 'kaikki-en-wikt-yo',
      sourceName: 'English Wiktionary Yoruba via Kaikki.org',
      license: 'CC BY-SA 4.0 & GFDL',
      attributionText:
        'Copyright Wikimedia Contributors & Tatu Ylönen (Kaikki.org / Wiktextract). Share-Alike applies under CC BY-SA 4.0.',
      sourceUrl: 'https://kaikki.org/dictionary/Yoruba/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      shareAlikeRequired: true,
      entriesIncludedCount: 1800,
      role: 'English glosses, IPA pronunciations & inflected forms',
    },
    {
      code: 'wikidata-q34343',
      sourceName: 'Wikidata Lexemes (Yoruba Q34343)',
      license: 'CC0 1.0 Public Domain Dedication',
      attributionText: 'Structured lexeme lemmas and bilingual glosses from Wikidata contributors.',
      sourceUrl: 'https://www.wikidata.org/',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      shareAlikeRequired: false,
      entriesIncludedCount: 500,
      role: 'Structured lemmas and part-of-speech mappings',
    },
    {
      code: 'tatoeba-yor',
      sourceName: 'Tatoeba Yoruba Sentence Corpus',
      license: 'CC BY 4.0',
      attributionText: 'Yoruba usage sentences contributed by Tatoeba Project contributors (CC BY 4.0).',
      sourceUrl: 'https://tatoeba.org/',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      shareAlikeRequired: false,
      role: 'Verified Yoruba usage examples (Extended pack)',
    },
    {
      code: 'lexica-curated-yo',
      sourceName: 'Lexica Curated Yoruba Corpus',
      license: 'CC0 1.0 / Lexica Project License',
      attributionText: 'Curated and native-authored by the LEXICA Multilingual Lexicography Project.',
      sourceUrl: 'https://github.com/ahmad-maxai/lexica-dictionary-new',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      shareAlikeRequired: false,
      entriesIncludedCount: 100,
      role: 'Human-verified tonal minimum pairs, IPA & bilingual explanations',
    },
  ],
  appVsDataLicensingNote:
    'Application source code and downloaded offline dictionary data packs are governed by their respective licenses. Wiktionary-derived dictionary packs retain CC BY-SA 4.0 & GFDL Share-Alike obligations.',
};

const YORUBA_FEATURE_FLAG_KEY = 'lexica_enable_yoruba_sqlite';
let runtimeYorubaOverride: boolean | null = null;

export function isYorubaSqliteIntegrationEnabled(): boolean {
  if (runtimeYorubaOverride !== null) {
    return runtimeYorubaOverride;
  }
  if (typeof window !== 'undefined') {
    try {
      const override = window.localStorage.getItem(YORUBA_FEATURE_FLAG_KEY);
      if (override === 'false') return false;
      if (override === 'true') return true;
    } catch {
      // Ignore storage access errors
    }
  }
  return true;
}

export function setYorubaSqliteIntegrationEnabled(enabled: boolean | null): void {
  runtimeYorubaOverride = enabled;
  if (typeof window !== 'undefined') {
    try {
      if (enabled === null) {
        window.localStorage.removeItem(YORUBA_FEATURE_FLAG_KEY);
      } else {
        window.localStorage.setItem(YORUBA_FEATURE_FLAG_KEY, String(enabled));
      }
    } catch {
      // Ignore storage access errors
    }
  }
}
