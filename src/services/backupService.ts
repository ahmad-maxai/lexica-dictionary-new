import { Collection, InstalledPack, LanguageCode } from '../types/dictionary';
import { ENGLISH_PACK_MANIFEST } from '../config/englishDictionaryConfig';
import { dictionaryDb } from './dictionaryDatabase';
import { StorageService } from './storageService';
import {
  englishPackService,
  EnglishPackInstallError,
} from './englishPackService';

export const LEXICA_BACKUP_FORMAT = 'lexica-offline-backup';
export const LEXICA_BACKUP_STATE_VERSION = 1;
const BUNDLED_LANGUAGES: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];

export interface LexicaBundledBackupState {
  format: typeof LEXICA_BACKUP_FORMAT;
  stateVersion: number;
  createdAtIso: string;
  installedPacks: Partial<Record<LanguageCode, InstalledPack>>;
  savedWordIds: string[];
  recentSearches: string[];
  collections: Collection[];
  preferences: {
    interfaceLang: LanguageCode;
    dictionaryMode: 'standard' | 'multilingual';
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    audioPronunciation: boolean;
    showPhonetics: boolean;
  };
}

export interface WebBackupEnvelope {
  format: typeof LEXICA_BACKUP_FORMAT;
  formatVersion: 1;
  createdAtIso: string;
  includesEnglishSqlite: boolean;
  bundledStateSha256: string;
  bundledStateBytes: number;
  bundledState: LexicaBundledBackupState;
}

export interface BackupExportSummary {
  mode: 'android-saf' | 'web-file';
  includesEnglishSqlite: boolean;
  englishDbBytes: number;
  englishDbSha256: string;
  bundledStateSha256: string;
  fileNameOrUri: string;
}

export interface BackupRestoreSummary {
  mode: 'android-saf' | 'web-file';
  includesEnglishSqlite: boolean;
  restoredPackCount: number;
  restoredSavedWordsCount: number;
  restoredCollectionsCount: number;
  englishDatasetVersion: string;
  englishEntriesCount: number;
}

export async function sha256HexUtf8(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('Web Crypto SHA-256 is unavailable in this runtime.');
}

export function buildBundledStatePayload(): LexicaBundledBackupState {
  const prefs = StorageService.getPreferences();
  const liveStats = dictionaryDb.getLanguagePackStats();
  const collections = StorageService.getCollections();

  const installedPacks: Partial<Record<LanguageCode, InstalledPack>> = {};
  for (const code of BUNDLED_LANGUAGES) {
    const existing = prefs.installedPacks?.[code];
    const stat = liveStats[code];
    installedPacks[code] = {
      code,
      installed: existing ? Boolean(existing.installed) : stat?.isInstalled ?? true,
      version: stat?.datasetVersion || existing?.version || '2026.4.0',
      sizeMb: stat?.actualSizeMb ?? existing?.sizeMb ?? 0.24,
      downloadDate: existing?.downloadDate,
    };
  }

  return {
    format: LEXICA_BACKUP_FORMAT,
    stateVersion: LEXICA_BACKUP_STATE_VERSION,
    createdAtIso: new Date().toISOString(),
    installedPacks,
    savedWordIds: [...(prefs.savedWordIds || [])],
    recentSearches: [...(prefs.recentSearches || [])],
    collections: [...collections],
    preferences: {
      interfaceLang: prefs.interfaceLang,
      dictionaryMode: prefs.dictionaryMode,
      sourceLang: prefs.sourceLang,
      targetLang: prefs.targetLang,
      audioPronunciation: prefs.audioPronunciation,
      showPhonetics: prefs.showPhonetics,
    },
  };
}

export function validateAndApplyBundledStateJson(jsonText: string): {
  restoredPackCount: number;
  restoredSavedWordsCount: number;
  restoredCollectionsCount: number;
} {
  let parsed: Partial<LexicaBundledBackupState>;
  try {
    parsed = JSON.parse(jsonText) as Partial<LexicaBundledBackupState>;
  } catch {
    throw new EnglishPackInstallError(
      'BACKUP_CORRUPTED',
      'BACKUP_CORRUPTED: Bundled dictionary state JSON could not be parsed.'
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.format !== LEXICA_BACKUP_FORMAT ||
    typeof parsed.stateVersion !== 'number' ||
    !parsed.installedPacks ||
    typeof parsed.installedPacks !== 'object'
  ) {
    throw new EnglishPackInstallError(
      'BACKUP_CORRUPTED',
      'BACKUP_CORRUPTED: Unrecognized or incomplete Lexica backup state structure.'
    );
  }

  const currentPrefs = StorageService.getPreferences();
  const nextInstalledPacks = { ...currentPrefs.installedPacks };
  let restoredPackCount = 0;

  for (const code of BUNDLED_LANGUAGES) {
    const packMeta = parsed.installedPacks[code];
    if (packMeta && typeof packMeta === 'object') {
      const isInstalled = Boolean(packMeta.installed);
      dictionaryDb.setPackInstalled(code, isInstalled);
      nextInstalledPacks[code] = {
        ...nextInstalledPacks[code],
        ...packMeta,
        code,
        installed: isInstalled,
      };
      if (isInstalled) {
        restoredPackCount += 1;
      }
    }
  }

  const savedWordIds = Array.isArray(parsed.savedWordIds)
    ? parsed.savedWordIds.filter((id): id is string => typeof id === 'string')
    : currentPrefs.savedWordIds;

  const recentSearches = Array.isArray(parsed.recentSearches)
    ? parsed.recentSearches.filter((q): q is string => typeof q === 'string')
    : currentPrefs.recentSearches;

  const prefSubset = parsed.preferences;
  StorageService.savePreferences({
    installedPacks: nextInstalledPacks,
    savedWordIds,
    recentSearches,
    ...(prefSubset
      ? {
          interfaceLang: prefSubset.interfaceLang || currentPrefs.interfaceLang,
          dictionaryMode:
            prefSubset.dictionaryMode === 'multilingual' ? 'multilingual' : 'standard',
          sourceLang: prefSubset.sourceLang || currentPrefs.sourceLang,
          targetLang: prefSubset.targetLang || currentPrefs.targetLang,
          audioPronunciation:
            typeof prefSubset.audioPronunciation === 'boolean'
              ? prefSubset.audioPronunciation
              : currentPrefs.audioPronunciation,
          showPhonetics:
            typeof prefSubset.showPhonetics === 'boolean'
              ? prefSubset.showPhonetics
              : currentPrefs.showPhonetics,
        }
      : {}),
  });

  let restoredCollectionsCount = 0;
  if (Array.isArray(parsed.collections)) {
    StorageService.restoreCollections(parsed.collections);
    restoredCollectionsCount = parsed.collections.length;
  }

  return {
    restoredPackCount,
    restoredSavedWordsCount: savedWordIds.length,
    restoredCollectionsCount,
  };
}

export async function createWebBackupEnvelope(): Promise<{
  envelope: WebBackupEnvelope;
  serialized: string;
}> {
  const bundledState = buildBundledStatePayload();
  const stateJson = JSON.stringify(bundledState);
  const bundledStateSha256 = await sha256HexUtf8(stateJson);
  const bundledStateBytes = new TextEncoder().encode(stateJson).byteLength;

  const envelope: WebBackupEnvelope = {
    format: LEXICA_BACKUP_FORMAT,
    formatVersion: 1,
    createdAtIso: bundledState.createdAtIso,
    includesEnglishSqlite: false,
    bundledStateSha256,
    bundledStateBytes,
    bundledState,
  };

  return {
    envelope,
    serialized: JSON.stringify(envelope, null, 2),
  };
}

export async function parseAndVerifyWebBackupEnvelope(
  rawText: string,
  options?: { replaceExisting?: boolean }
): Promise<BackupRestoreSummary> {
  let parsed: Partial<WebBackupEnvelope>;
  try {
    parsed = JSON.parse(rawText) as Partial<WebBackupEnvelope>;
  } catch {
    throw new EnglishPackInstallError(
      'BACKUP_CORRUPTED',
      'BACKUP_CORRUPTED: Selected backup file is not valid JSON.'
    );
  }

  if (
    !parsed ||
    parsed.format !== LEXICA_BACKUP_FORMAT ||
    parsed.formatVersion !== 1 ||
    !parsed.bundledState ||
    typeof parsed.bundledStateSha256 !== 'string'
  ) {
    throw new EnglishPackInstallError(
      'BACKUP_CORRUPTED',
      'BACKUP_CORRUPTED: Missing required Lexica backup metadata.'
    );
  }

  const stateJson = JSON.stringify(parsed.bundledState);
  const actualSha = await sha256HexUtf8(stateJson);
  const actualBytes = new TextEncoder().encode(stateJson).byteLength;

  if (
    actualSha.toLowerCase() !== parsed.bundledStateSha256.toLowerCase() ||
    (typeof parsed.bundledStateBytes === 'number' && parsed.bundledStateBytes !== actualBytes)
  ) {
    throw new EnglishPackInstallError(
      'BACKUP_CORRUPTED',
      'BACKUP_CORRUPTED: Backup SHA-256 verification failed. Active dictionaries were not modified.'
    );
  }

  if (!options?.replaceExisting) {
    const currentStateJson = JSON.stringify(buildBundledStatePayload());
    const currentNormalized = JSON.stringify({
      ...JSON.parse(currentStateJson),
      createdAtIso: parsed.bundledState.createdAtIso,
    });
    if (currentNormalized === stateJson) {
      throw new EnglishPackInstallError(
        'BACKUP_DUPLICATE_PACK',
        'BACKUP_DUPLICATE_PACK: The selected backup matches your currently installed dictionary packs.'
      );
    }
  }

  const applied = validateAndApplyBundledStateJson(stateJson);
  return {
    mode: 'web-file',
    includesEnglishSqlite: false,
    restoredPackCount: applied.restoredPackCount,
    restoredSavedWordsCount: applied.restoredSavedWordsCount,
    restoredCollectionsCount: applied.restoredCollectionsCount,
    englishDatasetVersion: '',
    englishEntriesCount: 0,
  };
}

export async function exportOfflineBackup(options?: {
  includeEnglishPack?: boolean;
}): Promise<BackupExportSummary> {
  const includeEnglishPack = options?.includeEnglishPack !== false;
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suggestedFileName = `lexica-dictionary-backup-${dateTag}.lexicabackup`;

  if (englishPackService.isNativeAndroid()) {
    const statePayload = buildBundledStatePayload();
    const stateJson = JSON.stringify(statePayload);
    const nativeRes = await englishPackService.exportBackupNative({
      bundledStateJson: stateJson,
      includeEnglishPack,
      suggestedFileName,
    });
    return {
      mode: 'android-saf',
      includesEnglishSqlite: Boolean(nativeRes.includesEnglishSqlite),
      englishDbBytes: Number(nativeRes.englishDbBytes || 0),
      englishDbSha256: nativeRes.englishDbSha256 || '',
      bundledStateSha256: nativeRes.bundledStateSha256 || '',
      fileNameOrUri: nativeRes.uri || suggestedFileName,
    };
  }

  const { envelope, serialized } = await createWebBackupEnvelope();
  const webFileName = `lexica-dictionary-backup-${dateTag}.lexicabackup.json`;
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = webFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    mode: 'web-file',
    includesEnglishSqlite: false,
    englishDbBytes: 0,
    englishDbSha256: '',
    bundledStateSha256: envelope.bundledStateSha256,
    fileNameOrUri: webFileName,
  };
}

export async function importOfflineBackup(options?: {
  replaceExisting?: boolean;
  webFile?: File;
}): Promise<BackupRestoreSummary> {
  const replaceExisting = Boolean(options?.replaceExisting);

  if (englishPackService.isNativeAndroid()) {
    const nativeRes = await englishPackService.importBackupNative({ replaceExisting });
    const applied = validateAndApplyBundledStateJson(nativeRes.bundledStateJson);
    return {
      mode: 'android-saf',
      includesEnglishSqlite: Boolean(nativeRes.includesEnglishSqlite),
      restoredPackCount: applied.restoredPackCount,
      restoredSavedWordsCount: applied.restoredSavedWordsCount,
      restoredCollectionsCount: applied.restoredCollectionsCount,
      englishDatasetVersion: nativeRes.datasetVersion || (nativeRes.includesEnglishSqlite ? ENGLISH_PACK_MANIFEST.packVersion : ''),
      englishEntriesCount: Number(nativeRes.acceptedEntries || 0),
    };
  }

  if (!options?.webFile) {
    throw new EnglishPackInstallError(
      'BACKUP_INVALID_PAYLOAD',
      'Please select a .lexicabackup.json file to restore.'
    );
  }
  const text = await options.webFile.text();
  return parseAndVerifyWebBackupEnvelope(text, { replaceExisting });
}
