import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  ENGLISH_PACK_MANIFEST,
  validateEnglishPackManifest,
  type EnglishPackManifest,
} from '../config/englishDictionaryConfig';

export type PackInstallStage =
  | 'idle'
  | 'downloading'
  | 'paused'
  | 'verifying_archive'
  | 'extracting'
  | 'verifying_database'
  | 'verifying_integrity'
  | 'activating'
  | 'installed'
  | 'exporting_backup'
  | 'reading_backup'
  | 'verifying_backup'
  | 'restoring_backup'
  | 'error';

export interface EnglishPackStatus {
  installed: boolean;
  alreadyInstalled?: boolean;
  dbPath: string;
  dbSizeBytes: number;
  partialBytes: number;
  availableBytes: number;
  inProgress: boolean;
  datasetVersion: string;
  schemaVersion?: number;
  acceptedEntries: number;
  distinctHeadwords: number;
  totalSenses: number;
  platform: 'android' | 'web' | 'ios';
  error?: string | null;
}

export interface PackInstallProgress {
  stage: PackInstallStage;
  processedBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
}

export interface DeviceMemoryMetrics {
  javaHeapUsedBytes: number;
  javaHeapMaxBytes: number;
  nativeHeapAllocatedBytes: number;
  systemAvailMemBytes: number;
  systemTotalMemBytes: number;
  lowMemory: boolean;
}

export interface NativeBackupExportResult {
  exported: boolean;
  includesEnglishSqlite: boolean;
  englishDbBytes: number;
  englishDbSha256: string;
  bundledStateSha256: string;
  uri: string;
}

export interface NativeBackupImportResult extends Partial<EnglishPackStatus> {
  restored: boolean;
  includesEnglishSqlite: boolean;
  bundledStateJson: string;
  uri?: string;
}

export interface EnglishPackInstallerNative {
  getPackStatus(): Promise<Partial<EnglishPackStatus>>;
  installPack(options: {
    packId?: string;
    packVersion?: string;
    forceReinstall?: boolean;
    url: string;
    compressedSha256: string;
    uncompressedSha256: string;
    compressedSizeBytes: number;
    uncompressedSizeBytes: number;
  }): Promise<Partial<EnglishPackStatus>>;
  cancelInstall(): Promise<{ cancelled: boolean }>;
  removePack(): Promise<{ removed: boolean; availableBytes: number }>;
  verifyInstalledPack(): Promise<Partial<EnglishPackStatus>>;
  getMemoryMetrics(): Promise<DeviceMemoryMetrics>;
  exportBackup?(options: {
    bundledStateJson: string;
    includeEnglishPack?: boolean;
    suggestedFileName?: string;
  }): Promise<NativeBackupExportResult>;
  importBackup?(options: {
    replaceExisting?: boolean;
  }): Promise<NativeBackupImportResult>;
  addListener(
    eventName: 'packInstallProgress',
    listenerFunc: (progress: PackInstallProgress) => void
  ): Promise<PluginListenerHandle>;
}

const NativeEnglishPackInstaller = registerPlugin<EnglishPackInstallerNative>('EnglishPackInstaller');

export class EnglishPackInstallError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'EnglishPackInstallError';
    this.code = code;
    this.details = details;
  }
}

type StatusListener = (status: EnglishPackStatus) => void;
type ProgressListener = (progress: PackInstallProgress) => void;

class EnglishPackService {
  private nativeBridge: EnglishPackInstallerNative = NativeEnglishPackInstaller;
  private platformOverride: 'android' | 'web' | 'ios' | null = null;
  private beforeMutateDbHook: (() => Promise<void>) | null = null;
  private statusListeners = new Set<StatusListener>();
  private progressListeners = new Set<ProgressListener>();
  private nativeProgressHandle: PluginListenerHandle | null = null;
  private statusLoaded = false;
  private statusLoadPromise: Promise<EnglishPackStatus> | null = null;
  private manifestOverride: EnglishPackManifest | null = null;

  private currentStatus: EnglishPackStatus = {
    installed: false,
    dbPath: '',
    dbSizeBytes: 0,
    partialBytes: 0,
    availableBytes: 0,
    inProgress: false,
    datasetVersion: '',
    schemaVersion: ENGLISH_PACK_MANIFEST.schemaVersion,
    acceptedEntries: 0,
    distinctHeadwords: 0,
    totalSenses: 0,
    platform: 'web',
    error: null,
  };

  private currentProgress: PackInstallProgress = {
    stage: 'idle',
    processedBytes: 0,
    totalBytes: ENGLISH_PACK_MANIFEST.compressedSizeBytes,
    percent: 0,
    message: '',
  };

  public getManifest(): EnglishPackManifest {
    return this.manifestOverride ?? ENGLISH_PACK_MANIFEST;
  }

  public getPlatform(): 'android' | 'web' | 'ios' {
    if (this.platformOverride) return this.platformOverride;
    const plat = Capacitor.getPlatform();
    if (plat === 'android') return 'android';
    if (plat === 'ios') return 'ios';
    return 'web';
  }

  public isNativeAndroid(): boolean {
    return this.getPlatform() === 'android';
  }

  public setBeforeMutateDbHook(hook: (() => Promise<void>) | null): void {
    this.beforeMutateDbHook = hook;
  }

  public setTestingOverrides(options: {
    nativeBridge?: EnglishPackInstallerNative;
    platform?: 'android' | 'web' | 'ios' | null;
    status?: Partial<EnglishPackStatus>;
    manifest?: EnglishPackManifest | null;
  }): void {
    if (options.nativeBridge !== undefined) {
      this.nativeBridge = options.nativeBridge;
      this.statusLoaded = false;
      this.statusLoadPromise = null;
    }
    if (options.platform !== undefined) {
      this.platformOverride = options.platform;
      this.statusLoaded = false;
      this.statusLoadPromise = null;
    }
    if (options.manifest !== undefined) {
      this.manifestOverride = options.manifest;
    }
    if (options.status) {
      this.currentStatus = {
        ...this.currentStatus,
        ...options.status,
        platform: this.getPlatform(),
      };
      this.statusLoaded = true;
      this.emitStatus();
    }
  }

  public resetTestingOverrides(): void {
    this.nativeBridge = NativeEnglishPackInstaller;
    this.platformOverride = null;
    this.manifestOverride = null;
    this.statusLoaded = false;
    this.statusLoadPromise = null;
    this.currentStatus = {
      installed: false,
      dbPath: '',
      dbSizeBytes: 0,
      partialBytes: 0,
      availableBytes: 0,
      inProgress: false,
      datasetVersion: '',
      schemaVersion: ENGLISH_PACK_MANIFEST.schemaVersion,
      acceptedEntries: 0,
      distinctHeadwords: 0,
      totalSenses: 0,
      platform: this.getPlatform(),
      error: null,
    };
  }

  public getCachedStatus(): EnglishPackStatus {
    return { ...this.currentStatus, platform: this.getPlatform() };
  }

  public getCachedProgress(): PackInstallProgress {
    return { ...this.currentProgress };
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getCachedStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    listener(this.getCachedProgress());
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private emitStatus(): void {
    const snapshot = this.getCachedStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }

  private emitProgress(progress: PackInstallProgress): void {
    this.currentProgress = progress;
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private async attachNativeProgressListener(): Promise<void> {
    if (this.nativeProgressHandle || !this.isNativeAndroid()) return;
    try {
      this.nativeProgressHandle = await this.nativeBridge.addListener('packInstallProgress', (progress) => {
        this.emitProgress(progress);
      });
    } catch {
      // Ignore listener registration errors in non-native environments
    }
  }

  public async refreshStatus(): Promise<EnglishPackStatus> {
    const platform = this.getPlatform();
    if (platform !== 'android') {
      this.currentStatus = {
        ...this.currentStatus,
        platform,
      };
      this.emitStatus();
      return this.getCachedStatus();
    }

    try {
      const nativeRes = await this.nativeBridge.getPackStatus();
      this.currentStatus = {
        installed: Boolean(nativeRes.installed),
        dbPath: nativeRes.dbPath || '',
        dbSizeBytes: Number(nativeRes.dbSizeBytes || 0),
        partialBytes: Number(nativeRes.partialBytes || 0),
        availableBytes: Number(nativeRes.availableBytes || 0),
        inProgress: Boolean(nativeRes.inProgress),
        datasetVersion: nativeRes.datasetVersion || '',
        schemaVersion: Number(nativeRes.schemaVersion || ENGLISH_PACK_MANIFEST.schemaVersion),
        acceptedEntries: Number(nativeRes.acceptedEntries || 0),
        distinctHeadwords: Number(nativeRes.distinctHeadwords || 0),
        totalSenses: Number(nativeRes.totalSenses || 0),
        platform,
        error: nativeRes.error || null,
      };
    } catch (err) {
      this.currentStatus = {
        ...this.currentStatus,
        platform,
        error: err instanceof Error ? err.message : 'Failed to inspect English SQLite pack status.',
      };
    }
    this.statusLoaded = true;
    this.emitStatus();
    return this.getCachedStatus();
  }

  public async ensureStatusLoaded(): Promise<EnglishPackStatus> {
    if (!this.isNativeAndroid() || this.statusLoaded) {
      return this.getCachedStatus();
    }
    if (!this.statusLoadPromise) {
      this.statusLoadPromise = this.refreshStatus().finally(() => {
        this.statusLoadPromise = null;
      });
    }
    return this.statusLoadPromise;
  }

  public async installEnglishPack(options?: { forceReinstall?: boolean }): Promise<EnglishPackStatus> {
    if (!this.isNativeAndroid()) {
      throw new EnglishPackInstallError(
        'UNSUPPORTED_PLATFORM',
        'Native offline SQLite pack installation runs on Android devices. Browser preview uses the lightweight development fallback.'
      );
    }

    const manifest = this.getManifest();
    const validation = validateEnglishPackManifest(manifest);
    if (!validation.valid) {
      const err = new EnglishPackInstallError('INVALID_MANIFEST', validation.message, {
        missingOrInvalidFields: validation.missingOrInvalidFields,
      });
      this.currentStatus = {
        ...this.currentStatus,
        inProgress: false,
        error: err.message,
      };
      this.emitStatus();
      throw err;
    }

    // Duplicate-version guard before mutating connections or transferring bytes
    if (!options?.forceReinstall) {
      const latestStatus = await this.ensureStatusLoaded();
      if (
        latestStatus.installed &&
        latestStatus.datasetVersion === manifest.packVersion &&
        latestStatus.dbSizeBytes === manifest.uncompressedSizeBytes &&
        latestStatus.acceptedEntries > 0
      ) {
        try {
          const verified = await this.nativeBridge.verifyInstalledPack();
          if (Number(verified.acceptedEntries || 0) > 0) {
            this.currentStatus = {
              ...latestStatus,
              alreadyInstalled: true,
              error: null,
            };
            this.emitProgress({
              stage: 'installed',
              processedBytes: manifest.uncompressedSizeBytes,
              totalBytes: manifest.uncompressedSizeBytes,
              percent: 100,
              message: `English v${manifest.packVersion} is already installed and verified.`,
            });
            this.emitStatus();
            return this.getCachedStatus();
          }
        } catch {
          // Existing local DB failed integrity check — fall through to native staging recovery
        }
      }
    }

    await this.attachNativeProgressListener();
    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }

    this.currentStatus = {
      ...this.currentStatus,
      inProgress: true,
      error: null,
    };
    this.emitProgress({
      stage: 'downloading',
      processedBytes: this.currentStatus.partialBytes,
      totalBytes: manifest.compressedSizeBytes,
      percent:
        manifest.compressedSizeBytes > 0
          ? Math.round((this.currentStatus.partialBytes * 100) / manifest.compressedSizeBytes)
          : 0,
      message: 'Preparing download...',
    });
    this.emitStatus();

    try {
      const res = await this.nativeBridge.installPack({
        packId: manifest.packId,
        packVersion: manifest.packVersion,
        forceReinstall: Boolean(options?.forceReinstall),
        url: manifest.downloadUrl.trim(),
        compressedSha256: manifest.compressedSha256.trim().toLowerCase(),
        uncompressedSha256: manifest.uncompressedSha256.trim().toLowerCase(),
        compressedSizeBytes: Math.trunc(manifest.compressedSizeBytes),
        uncompressedSizeBytes: Math.trunc(manifest.uncompressedSizeBytes),
      });

      this.currentStatus = {
        installed: Boolean(res.installed),
        alreadyInstalled: Boolean(res.alreadyInstalled),
        dbPath: res.dbPath || this.currentStatus.dbPath,
        dbSizeBytes: Number(res.dbSizeBytes || manifest.uncompressedSizeBytes),
        partialBytes: 0,
        availableBytes: this.currentStatus.availableBytes,
        inProgress: false,
        datasetVersion: res.datasetVersion || manifest.packVersion,
        schemaVersion: Number(res.schemaVersion || manifest.schemaVersion),
        acceptedEntries: Number(res.acceptedEntries || manifest.acceptedEntries),
        distinctHeadwords: Number(res.distinctHeadwords || manifest.distinctHeadwords),
        totalSenses: Number(res.totalSenses || manifest.totalSenses),
        platform: 'android',
        error: null,
      };
      this.statusLoaded = true;

      this.emitProgress({
        stage: 'installed',
        processedBytes: manifest.uncompressedSizeBytes,
        totalBytes: manifest.uncompressedSizeBytes,
        percent: 100,
        message: res.alreadyInstalled
          ? `English v${manifest.packVersion} already installed and verified.`
          : 'English offline dictionary verified and ready.',
      });
      this.emitStatus();
      return this.getCachedStatus();
    } catch (err) {
      const normalized = this.normalizeNativeError(err);
      await this.refreshStatus();
      this.currentStatus = {
        ...this.currentStatus,
        inProgress: false,
        error: normalized.code === 'DOWNLOAD_CANCELLED' ? null : normalized.message,
      };
      this.emitProgress({
        stage: normalized.code === 'DOWNLOAD_CANCELLED' ? 'paused' : 'error',
        processedBytes: this.currentStatus.partialBytes,
        totalBytes: manifest.compressedSizeBytes,
        percent:
          manifest.compressedSizeBytes > 0
            ? Math.round((this.currentStatus.partialBytes * 100) / manifest.compressedSizeBytes)
            : 0,
        message: normalized.message,
      });
      this.emitStatus();
      throw normalized;
    }
  }

  public async pauseOrCancelInstall(): Promise<void> {
    if (!this.isNativeAndroid()) return;
    await this.nativeBridge.cancelInstall();
  }

  public async removeEnglishPack(): Promise<EnglishPackStatus> {
    if (!this.isNativeAndroid()) {
      return this.getCachedStatus();
    }
    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }
    await this.nativeBridge.removePack();
    this.emitProgress({
      stage: 'idle',
      processedBytes: 0,
      totalBytes: ENGLISH_PACK_MANIFEST.compressedSizeBytes,
      percent: 0,
      message: '',
    });
    return this.refreshStatus();
  }

  public async verifyInstalledPack(): Promise<EnglishPackStatus> {
    if (!this.isNativeAndroid()) {
      throw new EnglishPackInstallError('UNSUPPORTED_PLATFORM', 'Available on Android native runtime.');
    }
    const res = await this.nativeBridge.verifyInstalledPack();
    this.currentStatus = {
      ...this.currentStatus,
      installed: true,
      dbPath: res.dbPath || this.currentStatus.dbPath,
      dbSizeBytes: Number(res.dbSizeBytes || this.currentStatus.dbSizeBytes),
      datasetVersion: res.datasetVersion || this.currentStatus.datasetVersion,
      schemaVersion: Number(res.schemaVersion || this.currentStatus.schemaVersion || ENGLISH_PACK_MANIFEST.schemaVersion),
      acceptedEntries: Number(res.acceptedEntries || this.currentStatus.acceptedEntries),
      distinctHeadwords: Number(res.distinctHeadwords || this.currentStatus.distinctHeadwords),
      totalSenses: Number(res.totalSenses || this.currentStatus.totalSenses),
      error: null,
    };
    this.emitStatus();
    return this.getCachedStatus();
  }

  public async exportBackupNative(options: {
    bundledStateJson: string;
    includeEnglishPack: boolean;
    suggestedFileName: string;
  }): Promise<NativeBackupExportResult> {
    if (!this.isNativeAndroid() || !this.nativeBridge.exportBackup) {
      throw new EnglishPackInstallError('UNSUPPORTED_PLATFORM', 'Android SAF backup export requires native Android.');
    }
    await this.attachNativeProgressListener();
    try {
      return await this.nativeBridge.exportBackup(options);
    } catch (err) {
      throw this.normalizeNativeError(err);
    }
  }

  public async importBackupNative(options: { replaceExisting: boolean }): Promise<NativeBackupImportResult> {
    if (!this.isNativeAndroid() || !this.nativeBridge.importBackup) {
      throw new EnglishPackInstallError('UNSUPPORTED_PLATFORM', 'Android SAF backup restore requires native Android.');
    }
    await this.attachNativeProgressListener();
    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }
    try {
      const res = await this.nativeBridge.importBackup(options);
      await this.refreshStatus();
      return res;
    } catch (err) {
      throw this.normalizeNativeError(err);
    }
  }

  public async getMemoryMetrics(): Promise<DeviceMemoryMetrics | null> {
    if (!this.isNativeAndroid()) return null;
    try {
      return await this.nativeBridge.getMemoryMetrics();
    } catch {
      return null;
    }
  }

  private normalizeNativeError(err: unknown): EnglishPackInstallError {
    if (err instanceof EnglishPackInstallError) return err;
    const rawObj = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
    const rawMsg =
      typeof rawObj.message === 'string'
        ? rawObj.message
        : err instanceof Error
          ? err.message
          : 'English pack operation failed.';
    const KNOWN_CODES = [
      'INVALID_MANIFEST',
      'INSUFFICIENT_STORAGE',
      'DOWNLOAD_CANCELLED',
      'CHECKSUM_MISMATCH_COMPRESSED',
      'CHECKSUM_MISMATCH_UNCOMPRESSED',
      'SQLITE_INTEGRITY_FAILED',
      'BACKUP_CANCELLED',
      'BACKUP_CORRUPTED',
      'BACKUP_DUPLICATE_PACK',
      'BACKUP_CONFLICT_EXISTS',
      'BACKUP_EXPORT_FAILED',
      'BACKUP_IMPORT_FAILED',
      'BACKUP_IN_PROGRESS',
      'INSTALL_IN_PROGRESS',
    ];
    let code = typeof rawObj.code === 'string' && rawObj.code.length > 0 ? rawObj.code : '';
    if (!code) {
      code = KNOWN_CODES.find((candidate) => rawMsg.includes(candidate)) || 'PACK_INSTALL_FAILED';
    }

    return new EnglishPackInstallError(code, rawMsg, rawObj.data as Record<string, unknown> | undefined);
  }
}

export const englishPackService = new EnglishPackService();
