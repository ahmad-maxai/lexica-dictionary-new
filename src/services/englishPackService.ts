import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { ENGLISH_PACK_MANIFEST, type EnglishPackManifest } from '../config/englishDictionaryConfig';

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
  | 'error';

export interface EnglishPackStatus {
  installed: boolean;
  dbPath: string;
  dbSizeBytes: number;
  partialBytes: number;
  availableBytes: number;
  inProgress: boolean;
  datasetVersion: string;
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

export interface EnglishPackInstallerNative {
  getPackStatus(): Promise<Partial<EnglishPackStatus>>;
  installPack(options: {
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

  private currentStatus: EnglishPackStatus = {
    installed: false,
    dbPath: '',
    dbSizeBytes: 0,
    partialBytes: 0,
    availableBytes: 0,
    inProgress: false,
    datasetVersion: '',
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
    return ENGLISH_PACK_MANIFEST;
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
  }): void {
    if (options.nativeBridge !== undefined) {
      this.nativeBridge = options.nativeBridge;
    }
    if (options.platform !== undefined) {
      this.platformOverride = options.platform;
    }
    if (options.status) {
      this.currentStatus = {
        ...this.currentStatus,
        ...options.status,
        platform: this.getPlatform(),
      };
      this.emitStatus();
    }
  }

  public resetTestingOverrides(): void {
    this.nativeBridge = NativeEnglishPackInstaller;
    this.platformOverride = null;
    this.currentStatus = {
      installed: false,
      dbPath: '',
      dbSizeBytes: 0,
      partialBytes: 0,
      availableBytes: 0,
      inProgress: false,
      datasetVersion: '',
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
    this.emitStatus();
    return this.getCachedStatus();
  }

  public async installEnglishPack(): Promise<EnglishPackStatus> {
    if (!this.isNativeAndroid()) {
      throw new EnglishPackInstallError(
        'UNSUPPORTED_PLATFORM',
        'Native 158 MB SQLite pack installation runs on Android devices. Browser preview uses the lightweight development fallback.'
      );
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
    this.emitStatus();

    const manifest = this.getManifest();
    try {
      const res = await this.nativeBridge.installPack({
        url: manifest.downloadUrl,
        compressedSha256: manifest.compressedSha256,
        uncompressedSha256: manifest.uncompressedSha256,
        compressedSizeBytes: manifest.compressedSizeBytes,
        uncompressedSizeBytes: manifest.uncompressedSizeBytes,
      });

      this.currentStatus = {
        installed: Boolean(res.installed),
        dbPath: res.dbPath || this.currentStatus.dbPath,
        dbSizeBytes: Number(res.dbSizeBytes || manifest.uncompressedSizeBytes),
        partialBytes: 0,
        availableBytes: this.currentStatus.availableBytes,
        inProgress: false,
        datasetVersion: res.datasetVersion || manifest.packVersion,
        acceptedEntries: Number(res.acceptedEntries || manifest.acceptedEntries),
        distinctHeadwords: Number(res.distinctHeadwords || manifest.distinctHeadwords),
        totalSenses: Number(res.totalSenses || manifest.totalSenses),
        platform: 'android',
        error: null,
      };

      this.emitProgress({
        stage: 'installed',
        processedBytes: manifest.uncompressedSizeBytes,
        totalBytes: manifest.uncompressedSizeBytes,
        percent: 100,
        message: 'English offline dictionary verified and ready.',
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
      acceptedEntries: Number(res.acceptedEntries || this.currentStatus.acceptedEntries),
      distinctHeadwords: Number(res.distinctHeadwords || this.currentStatus.distinctHeadwords),
      totalSenses: Number(res.totalSenses || this.currentStatus.totalSenses),
      error: null,
    };
    this.emitStatus();
    return this.getCachedStatus();
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
          : 'English pack installation failed.';
    const code =
      typeof rawObj.code === 'string' && rawObj.code.length > 0
        ? rawObj.code
        : rawMsg.includes('INSUFFICIENT_STORAGE')
          ? 'INSUFFICIENT_STORAGE'
          : rawMsg.includes('DOWNLOAD_CANCELLED')
            ? 'DOWNLOAD_CANCELLED'
            : rawMsg.includes('CHECKSUM_MISMATCH_COMPRESSED')
              ? 'CHECKSUM_MISMATCH_COMPRESSED'
              : rawMsg.includes('CHECKSUM_MISMATCH_UNCOMPRESSED')
                ? 'CHECKSUM_MISMATCH_UNCOMPRESSED'
                : rawMsg.includes('SQLITE_INTEGRITY_FAILED')
                  ? 'SQLITE_INTEGRITY_FAILED'
                  : 'PACK_INSTALL_FAILED';

    return new EnglishPackInstallError(code, rawMsg, rawObj.data as Record<string, unknown> | undefined);
  }
}

export const englishPackService = new EnglishPackService();
