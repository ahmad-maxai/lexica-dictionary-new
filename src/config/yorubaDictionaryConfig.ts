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
  packVersion: '0.5.1-core',
  datasetVersion: '2026.11-yoruba-schema-v4-v0.5.1',
  releaseTag: 'prototype-yo-core-v0.5.1',
  downloadUrl:
    'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-yo-core-v0.5.1/lexica_yoruba_core.db.gz',
  compressedSizeBytes: 803953,
  compressedSha256: 'd09dc626dbb2a49ba30af6f15465af2115383a5cdcb374125388e043cfbba4bc',
  uncompressedSizeBytes: 2166784,
  uncompressedSha256: 'f60383cb050fb06305f257dbeefe37bd5a67c146f658122fe97a3a90a0c5c130',
  acceptedEntries: 5804,
  distinctHeadwords: 5542,
  totalSenses: 8024,
  corePrimarySenses: 5804,
  totalWordForms: 8182,
  yorubaMonolingualCount: 14,
  bilingualExplanationCount: 120,
  englishGlossOnlyCount: 5670,
  conflictCount: 75,
  extendedCompanion: {
    packId: 'yo-lexica-schema-v4-extended',
    packLayer: 'extended',
    schemaVersion: 4,
    packVersion: '0.5.1-extended',
    optional: true,
    autoDownload: false,
    compressedSizeBytes: 642274,
    compressedSha256: '4d51545c3cdf6eca8d8b4ae58fcde630aab8cdf0313788cb11fff456ae907f96',
    uncompressedSizeBytes: 2252800,
    uncompressedSha256: 'f9340682d659ca183190cd573300dca7ebfe306564dcd29992cb51552e623d2e',
    downloadUrl:
      'https://github.com/ahmad-maxai/lexica-dictionary-new/releases/download/prototype-yo-core-v0.5.1/lexica_yoruba_extended.db.gz',
  },
  attribution: {
    sourceName: 'Kaikki EN-Wiktionary Yoruba, Wikidata Q34311, Tatoeba & Lexica Curated Corpus',
    license: 'CC BY-SA 4.0 & GFDL; CC0 1.0; CC BY 2.0 FR',
    attributionText:
      'Open-licensed Yoruba lexicography compiled from English Wiktionary via Kaikki.org (CC BY-SA 4.0 & GFDL), Wikidata Lexemes Q34311 (CC0 1.0), Tatoeba Yoruba Corpus (CC BY 2.0 FR), and Lexica Curated Corpus.',
    sourceUrl: 'https://kaikki.org/dictionary/Yoruba/',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  sourceAttributions: [
    {
      code: 'kaikki-en-wikt-yo',
      sourceName: 'English Wiktionary Yoruba via Kaikki.org',
      license: 'CC BY-SA 4.0 & GFDL',
      attributionText:
        'Copyright Wikimedia Contributors & Tatu Ylönen (Kaikki.org / Wiktextract). Share-Alike applies under CC BY-SA 4.0.',
      sourceUrl: 'https://kaikki.org/dictionary/Yoruba/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      shareAlikeRequired: true,
      entriesIncludedCount: 5664,
      role: 'Canonical tone-marked Yoruba headwords, English glosses, IPA pronunciations & inflected forms',
    },
    {
      code: 'lexica-curated-yo',
      sourceName: 'Lexica Curated Yoruba Corpus',
      license: 'CC0 1.0 / Lexica Project License',
      attributionText: 'Curated and native-authored by the LEXICA Multilingual Lexicography Project.',
      sourceUrl: 'https://github.com/ahmad-maxai/lexica-dictionary-new',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      shareAlikeRequired: false,
      entriesIncludedCount: 70,
      role: 'Human-verified tonal minimum pairs, IPA, Yoruba explanations & bilingual glosses',
    },
    {
      code: 'wikidata-q34311',
      sourceName: 'Wikidata Lexemes (Yoruba Q34311)',
      license: 'CC0 1.0 Public Domain Dedication',
      attributionText: 'Structured lexeme lemmas and bilingual glosses from Wikidata contributors.',
      sourceUrl: 'https://www.wikidata.org/wiki/Q34311',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      shareAlikeRequired: false,
      entriesIncludedCount: 70,
      role: 'Structured lemmas, Yoruba glosses & part-of-speech mappings',
    },
    {
      code: 'tatoeba-yor',
      sourceName: 'Tatoeba Yoruba Sentence Corpus',
      license: 'CC BY 2.0 FR',
      attributionText: 'Yoruba usage sentences contributed by Tatoeba Project contributors (CC BY 2.0 FR).',
      sourceUrl: 'https://tatoeba.org/en/downloads',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
      shareAlikeRequired: false,
      role: 'Verified Yoruba-English sentence examples (Extended pack)',
    },
    {
      code: 'yowiktionary',
      sourceName: 'Yoruba Wiktionary (yo.wiktionary.org dump audited)',
      license: 'CC BY-SA 4.0 & GFDL',
      attributionText:
        'Audited Wikimedia dump (167 XML pages; only 1 mainspace Main Page, 0 lexical entries published upstream). Retained as attribution audit record.',
      sourceUrl: 'https://yo.wiktionary.org/',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      shareAlikeRequired: true,
      entriesIncludedCount: 0,
      role: 'Audited upstream source (currently 0 lexical entries in yo.wiktionary.org dump)',
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
