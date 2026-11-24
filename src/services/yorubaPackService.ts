import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  YORUBA_PACK_MANIFEST,
  validateYorubaPackManifest,
  type YorubaPackManifest,
} from '../config/yorubaDictionaryConfig';
import { type PackInstallProgress, type DeviceMemoryMetrics } from './englishPackService';

export interface YorubaPackStatus {
  installed: boolean;
  alreadyInstalled?: boolean;
  dbPath: string;
  dbSizeBytes: number;
  partialBytes: number;
  availableBytes: number;
  inProgress: boolean;
  datasetVersion: string;
  schemaVersion?: number;
  packLayer?: 'core' | 'full';
  acceptedEntries: number;
  distinctHeadwords: number;
  totalSenses: number;
  corePrimarySenses?: number;
  totalWordForms?: number;
  extendedInstalled?: boolean;
  extendedDbPath?: string;
  extendedDbSizeBytes?: number;
  platform: 'android' | 'web' | 'ios';
  error?: string | null;
}

export interface YorubaPackInstallerNative {
  getPackStatus(options?: { lang?: string; packId?: string }): Promise<Partial<YorubaPackStatus>>;
  installPack(options: {
    lang?: string;
    packId?: string;
    packLayer?: 'core' | 'extended';
    packVersion?: string;
    forceReinstall?: boolean;
    url: string;
    compressedSha256: string;
    uncompressedSha256: string;
    compressedSizeBytes: number;
    uncompressedSizeBytes: number;
  }): Promise<Partial<YorubaPackStatus>>;
  cancelInstall(options?: { lang?: string; packId?: string }): Promise<{ cancelled: boolean }>;
  removePack(options?: {
    lang?: string;
    packId?: string;
    packLayer?: 'core' | 'extended';
  }): Promise<{ removed: boolean; availableBytes: number }>;
  verifyInstalledPack(options?: {
    lang?: string;
    packId?: string;
    packLayer?: 'core' | 'extended';
  }): Promise<Partial<YorubaPackStatus>>;
  getMemoryMetrics(): Promise<DeviceMemoryMetrics>;
  addListener(
    eventName: 'packInstallProgress',
    listenerFunc: (progress: PackInstallProgress) => void
  ): Promise<PluginListenerHandle>;
}

const NativeYorubaPackInstaller = registerPlugin<YorubaPackInstallerNative>('EnglishPackInstaller');

export class YorubaPackInstallError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'YorubaPackInstallError';
    this.code = code;
    this.details = details;
  }
}

function isValidInstalledNativeResponse(res: Partial<YorubaPackStatus> | null | undefined): boolean {
  if (!res) return false;
  return Boolean(res.installed) && Boolean(res.dbPath) && (res.acceptedEntries || 0) > 0;
}

class YorubaPackService {
  private static readonly PREF_STATUS_KEY = 'lexica_yoruba_pack_status_v4';

  private statusListeners = new Set<(status: YorubaPackStatus) => void>();
  private progressListeners = new Set<(progress: PackInstallProgress) => void>();
  private nativeListenerHandle: PluginListenerHandle | null = null;
  private beforeMutateDbHook: (() => Promise<void>) | null = null;
  private mockInstaller: YorubaPackInstallerNative | null = null;
  private statusLoaded = false;
  private statusLoadingPromise: Promise<YorubaPackStatus> | null = null;
  private platformOverride: 'android' | 'web' | 'ios' | null = null;

  private currentStatus: YorubaPackStatus = {
    installed: false,
    dbPath: '',
    dbSizeBytes: 0,
    partialBytes: 0,
    availableBytes: 0,
    inProgress: false,
    datasetVersion: YORUBA_PACK_MANIFEST.datasetVersion,
    schemaVersion: YORUBA_PACK_MANIFEST.schemaVersion,
    packLayer: 'core',
    acceptedEntries: 0,
    distinctHeadwords: 0,
    totalSenses: 0,
    corePrimarySenses: 0,
    totalWordForms: 0,
    extendedInstalled: false,
    extendedDbPath: '',
    extendedDbSizeBytes: 0,
    platform: this.detectPlatform(),
    error: null,
  };

  private currentProgress: PackInstallProgress = {
    stage: 'idle',
    processedBytes: 0,
    totalBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
    percent: 0,
    message: 'Ready to download Yoruba Core offline dictionary.',
  };

  constructor() {
    this.restorePersistedStatus();
    void this.initNativeListener();
  }

  public detectPlatform(): 'android' | 'web' | 'ios' {
    if (this.platformOverride) return this.platformOverride;
    const p = Capacitor.getPlatform();
    if (p === 'android') return 'android';
    if (p === 'ios') return 'ios';
    return 'web';
  }

  public isNativeAndroid(): boolean {
    return this.detectPlatform() === 'android';
  }

  public setBeforeMutateDbHook(hook: (() => Promise<void>) | null): void {
    this.beforeMutateDbHook = hook;
  }

  public _injectMockInstaller(mock: YorubaPackInstallerNative | null): void {
    this.mockInstaller = mock;
    this.statusLoaded = false;
    this.statusLoadingPromise = null;
  }

  public setTestingOverrides(overrides: {
    platform?: 'android' | 'web' | 'ios' | null;
    nativeBridge?: YorubaPackInstallerNative | null;
  }): void {
    if (overrides.platform !== undefined) {
      this.platformOverride = overrides.platform ?? null;
    }
    if (overrides.nativeBridge !== undefined) {
      this.mockInstaller = overrides.nativeBridge ?? null;
    }
    this.statusLoaded = false;
    this.statusLoadingPromise = null;
    this.currentStatus = {
      ...this.currentStatus,
      platform: this.detectPlatform(),
    };
  }

  public resetTestingOverrides(): void {
    this.platformOverride = null;
    this.mockInstaller = null;
    this.statusLoaded = false;
    this.statusLoadingPromise = null;
    this.currentStatus = {
      installed: false,
      alreadyInstalled: false,
      dbPath: '',
      dbSizeBytes: 0,
      partialBytes: 0,
      availableBytes: 0,
      inProgress: false,
      datasetVersion: YORUBA_PACK_MANIFEST.datasetVersion,
      schemaVersion: YORUBA_PACK_MANIFEST.schemaVersion,
      packLayer: 'core',
      acceptedEntries: 0,
      distinctHeadwords: 0,
      totalSenses: 0,
      corePrimarySenses: 0,
      totalWordForms: 0,
      extendedInstalled: false,
      extendedDbPath: '',
      extendedDbSizeBytes: 0,
      platform: this.detectPlatform(),
      error: null,
    };
  }

  private getNativePlugin(): YorubaPackInstallerNative {
    return this.mockInstaller || NativeYorubaPackInstaller;
  }

  private restorePersistedStatus(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(YorubaPackService.PREF_STATUS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<YorubaPackStatus>;
        this.currentStatus = {
          ...this.currentStatus,
          ...parsed,
          inProgress: false,
          platform: this.detectPlatform(),
        };
      }
    } catch {
      // Ignore localStorage parse errors
    }
  }

  private persistStatus(): void {
    if (typeof window === 'undefined') return;
    try {
      const payload: Partial<YorubaPackStatus> = {
        installed: this.currentStatus.installed,
        dbPath: this.currentStatus.dbPath,
        dbSizeBytes: this.currentStatus.dbSizeBytes,
        datasetVersion: this.currentStatus.datasetVersion,
        schemaVersion: this.currentStatus.schemaVersion,
        packLayer: this.currentStatus.packLayer,
        acceptedEntries: this.currentStatus.acceptedEntries,
        distinctHeadwords: this.currentStatus.distinctHeadwords,
        totalSenses: this.currentStatus.totalSenses,
        corePrimarySenses: this.currentStatus.corePrimarySenses,
        totalWordForms: this.currentStatus.totalWordForms,
        extendedInstalled: this.currentStatus.extendedInstalled,
        extendedDbPath: this.currentStatus.extendedDbPath,
        extendedDbSizeBytes: this.currentStatus.extendedDbSizeBytes,
      };
      window.localStorage.setItem(YorubaPackService.PREF_STATUS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }
  }

  private async initNativeListener(): Promise<void> {
    if ((!this.isNativeAndroid() && !this.mockInstaller) || this.nativeListenerHandle) return;
    try {
      this.nativeListenerHandle = await this.getNativePlugin().addListener(
        'packInstallProgress',
        (progress: PackInstallProgress) => {
          this.currentProgress = progress;
          this.notifyProgress(progress);
        }
      );
    } catch (e) {
      console.warn('Native Yoruba pack progress listener initialization failed:', e);
    }
  }

  public getCachedStatus(): YorubaPackStatus {
    return { ...this.currentStatus };
  }

  public getCachedProgress(): PackInstallProgress {
    return { ...this.currentProgress };
  }

  public subscribeStatus(listener: (status: YorubaPackStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getCachedStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeProgress(listener: (progress: PackInstallProgress) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.getCachedProgress());
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private notifyStatus(status: YorubaPackStatus): void {
    this.statusListeners.forEach((l) => {
      try {
        l(status);
      } catch (e) {
        console.error('Error in Yoruba pack status subscriber:', e);
      }
    });
  }

  private notifyProgress(progress: PackInstallProgress): void {
    this.progressListeners.forEach((l) => {
      try {
        l(progress);
      } catch (e) {
        console.error('Error in Yoruba pack progress subscriber:', e);
      }
    });
  }

  public async ensureStatusLoaded(): Promise<YorubaPackStatus> {
    if (this.statusLoaded) return this.getCachedStatus();
    if (this.statusLoadingPromise) return this.statusLoadingPromise;
    this.statusLoadingPromise = this.refreshStatus().finally(() => {
      this.statusLoadingPromise = null;
    });
    return this.statusLoadingPromise;
  }

  public async getStatus(forceRefresh = false): Promise<YorubaPackStatus> {
    return forceRefresh ? this.refreshStatus() : this.ensureStatusLoaded();
  }

  public async refreshStatus(): Promise<YorubaPackStatus> {
    if (!this.isNativeAndroid() && !this.mockInstaller) {
      this.statusLoaded = true;
      return this.getCachedStatus();
    }
    try {
      const nativeStatus = await this.getNativePlugin().getPackStatus({
        lang: 'yo',
        packId: YORUBA_PACK_MANIFEST.packId,
      });
      const validInstalled = isValidInstalledNativeResponse(nativeStatus);
      this.currentStatus = {
        ...this.currentStatus,
        ...nativeStatus,
        installed: validInstalled,
        acceptedEntries: validInstalled ? (nativeStatus.acceptedEntries || 0) : 0,
        distinctHeadwords: validInstalled ? (nativeStatus.distinctHeadwords || 0) : 0,
        totalSenses: validInstalled ? (nativeStatus.totalSenses || 0) : 0,
        corePrimarySenses: validInstalled ? (nativeStatus.corePrimarySenses || nativeStatus.acceptedEntries || 0) : 0,
        totalWordForms: validInstalled ? (nativeStatus.totalWordForms || 0) : 0,
        extendedInstalled: validInstalled && Boolean(nativeStatus.extendedInstalled),
        extendedDbPath: validInstalled && nativeStatus.extendedInstalled ? (nativeStatus.extendedDbPath || '') : '',
        extendedDbSizeBytes:
          validInstalled && nativeStatus.extendedInstalled ? (nativeStatus.extendedDbSizeBytes || 0) : 0,
        platform: this.detectPlatform(),
        error: nativeStatus?.error ?? null,
      };
      this.statusLoaded = true;
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.currentStatus = {
        ...this.currentStatus,
        installed: false,
        acceptedEntries: 0,
        distinctHeadwords: 0,
        totalSenses: 0,
        extendedInstalled: false,
        error: msg,
      };
      this.statusLoaded = true;
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    }
  }

  public async installCorePack(forceReinstall = false): Promise<YorubaPackStatus> {
    return this.installPack({ forceReinstall });
  }

  public async installPack(options: {
    manifest?: Partial<YorubaPackManifest>;
    forceReinstall?: boolean;
  } = {}): Promise<YorubaPackStatus> {
    const manifest = (options.manifest || YORUBA_PACK_MANIFEST) as YorubaPackManifest;
    const manifestVal = validateYorubaPackManifest(manifest);
    if (!manifestVal.valid) {
      throw new YorubaPackInstallError(
        'INVALID_MANIFEST',
        `Cannot install Yoruba pack: ${manifestVal.message}`,
        { missing: manifestVal.missingOrInvalidFields }
      );
    }

    if (!options.forceReinstall) {
      const current = this.statusLoaded ? this.getCachedStatus() : await this.ensureStatusLoaded();
      if (
        current.installed &&
        current.datasetVersion === manifest.packVersion &&
        (current.dbSizeBytes || 0) === manifest.uncompressedSizeBytes
      ) {
        return {
          ...current,
          alreadyInstalled: true,
        };
      }
    }

    await this.initNativeListener();
    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }

    this.currentStatus = { ...this.currentStatus, inProgress: true, error: null };
    this.notifyStatus(this.getCachedStatus());

    this.currentProgress = {
      stage: 'downloading',
      processedBytes: 0,
      totalBytes: manifest.compressedSizeBytes,
      percent: 0,
      message: 'Downloading Yoruba Core dictionary pack...',
    };
    this.notifyProgress(this.currentProgress);

    const platform = this.detectPlatform();
    try {
      if (platform === 'android' || this.mockInstaller) {
        const nativeRes = await this.getNativePlugin().installPack({
          lang: 'yo',
          packId: manifest.packId,
          packLayer: 'core',
          packVersion: manifest.packVersion,
          forceReinstall: Boolean(options.forceReinstall),
          url: manifest.downloadUrl,
          compressedSha256: manifest.compressedSha256,
          uncompressedSha256: manifest.uncompressedSha256,
          compressedSizeBytes: manifest.compressedSizeBytes,
          uncompressedSizeBytes: manifest.uncompressedSizeBytes,
        });

        if (!isValidInstalledNativeResponse(nativeRes)) {
          throw new Error(
            nativeRes?.error ||
              'Native installer completed without returning a verified Yoruba SQLite database.'
          );
        }

        this.currentStatus = {
          ...this.currentStatus,
          ...nativeRes,
          installed: true,
          inProgress: false,
          error: null,
          platform,
        };
      } else {
        throw new YorubaPackInstallError(
          'NATIVE_ONLY',
          'Yoruba SQLite pack installation is available on Android devices.'
        );
      }

      this.statusLoaded = true;
      this.currentProgress = {
        stage: 'installed',
        processedBytes: manifest.compressedSizeBytes,
        totalBytes: manifest.compressedSizeBytes,
        percent: 100,
        message: 'Yoruba Core offline dictionary installed successfully.',
      };
      this.notifyProgress(this.currentProgress);
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.currentStatus = {
        ...this.currentStatus,
        inProgress: false,
        error: msg,
      };
      this.currentProgress = {
        stage: 'error',
        processedBytes: 0,
        totalBytes: manifest.compressedSizeBytes,
        percent: 0,
        message: `Yoruba install failed: ${msg}`,
      };
      this.notifyProgress(this.currentProgress);
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      if (err instanceof YorubaPackInstallError) {
        throw err;
      }
      throw new YorubaPackInstallError('INSTALL_FAILED', msg, { originalError: err });
    }
  }

  public async installExtendedPack(options: { forceReinstall?: boolean } = {}): Promise<YorubaPackStatus> {
    const extInfo = YORUBA_PACK_MANIFEST.extendedCompanion;
    if (!extInfo || !extInfo.downloadUrl) {
      throw new YorubaPackInstallError('NO_EXTENDED_PACK', 'Extended companion pack is not available.');
    }

    const current = this.statusLoaded ? this.getCachedStatus() : await this.ensureStatusLoaded();
    if (!current.installed) {
      throw new YorubaPackInstallError(
        'CORE_REQUIRED',
        'Install Yoruba Core offline pack before installing Extended enrichment.'
      );
    }
    if (
      !options.forceReinstall &&
      current.extendedInstalled &&
      current.extendedDbSizeBytes === extInfo.uncompressedSizeBytes
    ) {
      return {
        ...current,
        alreadyInstalled: true,
      };
    }

    await this.initNativeListener();
    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }

    this.currentStatus = { ...this.currentStatus, inProgress: true, error: null };
    this.notifyStatus(this.getCachedStatus());

    const platform = this.detectPlatform();
    try {
      if (platform === 'android' || this.mockInstaller) {
        const res = await this.getNativePlugin().installPack({
          lang: 'yo',
          packId: extInfo.packId,
          packLayer: 'extended',
          packVersion: extInfo.packVersion,
          forceReinstall: Boolean(options.forceReinstall),
          url: extInfo.downloadUrl,
          compressedSha256: extInfo.compressedSha256,
          uncompressedSha256: extInfo.uncompressedSha256,
          compressedSizeBytes: extInfo.compressedSizeBytes,
          uncompressedSizeBytes: extInfo.uncompressedSizeBytes,
        });

        this.currentStatus = {
          ...this.currentStatus,
          ...res,
          installed: Boolean(res.installed ?? true),
          extendedInstalled: Boolean(res.extendedInstalled ?? true),
          inProgress: false,
          error: null,
          platform,
        };
      } else {
        throw new YorubaPackInstallError(
          'NATIVE_ONLY',
          'Yoruba Extended pack installation is available on Android devices.'
        );
      }

      this.statusLoaded = true;
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.currentStatus = {
        ...this.currentStatus,
        inProgress: false,
        error: msg,
      };
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      if (err instanceof YorubaPackInstallError) {
        throw err;
      }
      throw new YorubaPackInstallError('EXTENDED_INSTALL_FAILED', msg);
    }
  }

  public async removeExtendedPack(): Promise<YorubaPackStatus> {
    try {
      if (this.beforeMutateDbHook) {
        await this.beforeMutateDbHook();
      }
      const res = await this.getNativePlugin().removePack({
        lang: 'yo',
        packId: YORUBA_PACK_MANIFEST.extendedCompanion?.packId || 'yo-lexica-schema-v4-extended',
        packLayer: 'extended',
      });
      this.currentStatus = {
        ...this.currentStatus,
        availableBytes: res.availableBytes,
        extendedInstalled: false,
        extendedDbPath: '',
        extendedDbSizeBytes: 0,
        totalSenses: this.currentStatus.corePrimarySenses || this.currentStatus.acceptedEntries,
        error: null,
      };
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new YorubaPackInstallError('REMOVE_FAILED', msg);
    }
  }

  public async verifyExtendedPack(): Promise<YorubaPackStatus> {
    try {
      const verified = await this.getNativePlugin().verifyInstalledPack({
        lang: 'yo',
        packId: YORUBA_PACK_MANIFEST.extendedCompanion?.packId || 'yo-lexica-schema-v4-extended',
        packLayer: 'extended',
      });
      this.currentStatus = {
        ...this.currentStatus,
        ...verified,
        extendedInstalled: Boolean(verified.extendedInstalled ?? true),
        error: null,
      };
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new YorubaPackInstallError('VERIFY_FAILED', msg);
    }
  }

  public async cancelInstall(): Promise<{ cancelled: boolean }> {
    try {
      const res = await this.getNativePlugin().cancelInstall({
        lang: 'yo',
        packId: YORUBA_PACK_MANIFEST.packId,
      });
      this.currentStatus = { ...this.currentStatus, inProgress: false };
      this.notifyStatus(this.getCachedStatus());
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new YorubaPackInstallError('CANCEL_FAILED', msg);
    }
  }

  public async removePack(packLayer: 'core' | 'extended' = 'core'): Promise<YorubaPackStatus> {
    if (packLayer === 'extended') {
      return this.removeExtendedPack();
    }
    try {
      if (this.beforeMutateDbHook) {
        await this.beforeMutateDbHook();
      }
      const platform = this.detectPlatform();
      let availableBytes = this.currentStatus.availableBytes;
      if (platform === 'android' || this.mockInstaller) {
        const res = await this.getNativePlugin().removePack({
          lang: 'yo',
          packId: YORUBA_PACK_MANIFEST.packId,
          packLayer: 'core',
        });
        availableBytes = res.availableBytes;
      }

      this.currentStatus = {
        ...this.currentStatus,
        installed: false,
        dbPath: '',
        dbSizeBytes: 0,
        acceptedEntries: 0,
        distinctHeadwords: 0,
        totalSenses: 0,
        corePrimarySenses: 0,
        totalWordForms: 0,
        availableBytes,
        extendedInstalled: false,
        extendedDbPath: '',
        extendedDbSizeBytes: 0,
        error: null,
      };
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.currentStatus = { ...this.currentStatus, error: msg };
      this.notifyStatus(this.getCachedStatus());
      throw new YorubaPackInstallError('REMOVE_FAILED', msg);
    }
  }

  public async verifyInstalledPack(): Promise<YorubaPackStatus> {
    try {
      const verified = await this.getNativePlugin().verifyInstalledPack({
        lang: 'yo',
        packId: YORUBA_PACK_MANIFEST.packId,
        packLayer: 'core',
      });
      const valid = isValidInstalledNativeResponse(verified);
      if (!valid) {
        throw new Error('Verified Yoruba database returned empty or invalid summary.');
      }
      this.currentStatus = {
        ...this.currentStatus,
        ...verified,
        installed: true,
        error: null,
      };
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new YorubaPackInstallError('VERIFY_FAILED', msg);
    }
  }

  public async getMemoryMetrics(): Promise<DeviceMemoryMetrics> {
    try {
      return await this.getNativePlugin().getMemoryMetrics();
    } catch {
      return {
        javaHeapUsedBytes: 0,
        javaHeapMaxBytes: 0,
        nativeHeapAllocatedBytes: 0,
        systemAvailMemBytes: 0,
        systemTotalMemBytes: 0,
        lowMemory: false,
      };
    }
  }
}

export const yorubaPackService = new YorubaPackService();
