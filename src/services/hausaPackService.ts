import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  HAUSA_PACK_MANIFEST,
  validateHausaPackManifest,
  type HausaPackManifest,
} from '../config/hausaDictionaryConfig';
import { type PackInstallProgress, type DeviceMemoryMetrics } from './englishPackService';

export interface HausaPackStatus {
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

export interface HausaPackInstallerNative {
  getPackStatus(options?: { lang?: string; packId?: string }): Promise<Partial<HausaPackStatus>>;
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
  }): Promise<Partial<HausaPackStatus>>;
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
  }): Promise<Partial<HausaPackStatus>>;
  getMemoryMetrics(): Promise<DeviceMemoryMetrics>;
  addListener(
    eventName: 'packInstallProgress',
    listenerFunc: (progress: PackInstallProgress) => void
  ): Promise<PluginListenerHandle>;
}

const NativeHausaPackInstaller = registerPlugin<HausaPackInstallerNative>('EnglishPackInstaller');

export class HausaPackInstallError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HausaPackInstallError';
    this.code = code;
    this.details = details;
  }
}

class HausaPackService {
  private static readonly PREF_STATUS_KEY = 'lexica_hausa_pack_status_v4';

  private statusListeners = new Set<(status: HausaPackStatus) => void>();
  private progressListeners = new Set<(progress: PackInstallProgress) => void>();
  private nativeListenerHandle: PluginListenerHandle | null = null;
  private beforeMutateDbHook: (() => Promise<void>) | null = null;
  private mockInstaller: HausaPackInstallerNative | null = null;
  private statusLoaded = false;
  private statusLoadingPromise: Promise<HausaPackStatus> | null = null;

  private currentStatus: HausaPackStatus = {
    installed: false,
    dbPath: '',
    dbSizeBytes: 0,
    partialBytes: 0,
    availableBytes: 0,
    inProgress: false,
    datasetVersion: HAUSA_PACK_MANIFEST.datasetVersion,
    schemaVersion: HAUSA_PACK_MANIFEST.schemaVersion,
    packLayer: 'core',
    acceptedEntries: HAUSA_PACK_MANIFEST.acceptedEntries,
    distinctHeadwords: HAUSA_PACK_MANIFEST.distinctHeadwords,
    totalSenses: HAUSA_PACK_MANIFEST.totalSenses,
    corePrimarySenses: HAUSA_PACK_MANIFEST.corePrimarySenses,
    totalWordForms: HAUSA_PACK_MANIFEST.totalWordForms,
    extendedInstalled: false,
    extendedDbPath: '',
    extendedDbSizeBytes: 0,
    platform: this.detectPlatform(),
    error: null,
  };

  private currentProgress: PackInstallProgress = {
    stage: 'idle',
    processedBytes: 0,
    totalBytes: HAUSA_PACK_MANIFEST.compressedSizeBytes,
    percent: 0,
    message: 'Ready to download Hausa Core offline dictionary.',
  };

  constructor() {
    this.restorePersistedStatus();
    this.initNativeListener();
  }

  private platformOverride: 'android' | 'web' | 'ios' | null = null;

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

  public _injectMockInstaller(mock: HausaPackInstallerNative | null): void {
    this.mockInstaller = mock;
    this.statusLoaded = false;
    this.statusLoadingPromise = null;
  }

  public setTestingOverrides(overrides: {
    platform?: 'android' | 'web' | 'ios' | null;
    nativeBridge?: HausaPackInstallerNative | null;
  }): void {
    if (overrides.platform !== undefined) {
      this.platformOverride = overrides.platform;
    }
    if (overrides.nativeBridge !== undefined) {
      this.mockInstaller = overrides.nativeBridge;
    }
    this.statusLoaded = false;
    this.statusLoadingPromise = null;
  }

  public resetTestingOverrides(): void {
    this.platformOverride = null;
    this.mockInstaller = null;
    this.statusLoaded = false;
    this.statusLoadingPromise = null;
    this.currentStatus = {
      ...this.currentStatus,
      installed: false,
      alreadyInstalled: false,
      dbPath: '',
      dbSizeBytes: 0,
      inProgress: false,
      extendedInstalled: false,
      extendedDbPath: '',
      extendedDbSizeBytes: 0,
      platform: this.detectPlatform(),
      error: null,
    };
  }

  private getNativePlugin(): HausaPackInstallerNative {
    return this.mockInstaller || NativeHausaPackInstaller;
  }

  private restorePersistedStatus(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(HausaPackService.PREF_STATUS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<HausaPackStatus>;
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
      const payload: Partial<HausaPackStatus> = {
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
      localStorage.setItem(HausaPackService.PREF_STATUS_KEY, JSON.stringify(payload));
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
      console.warn('Native Hausa pack progress listener initialization failed:', e);
    }
  }

  public getCachedStatus(): HausaPackStatus {
    return { ...this.currentStatus };
  }

  public getCachedProgress(): PackInstallProgress {
    return { ...this.currentProgress };
  }

  public subscribeStatus(listener: (status: HausaPackStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getCachedStatus());
    return () => this.statusListeners.delete(listener);
  }

  public subscribeProgress(listener: (progress: PackInstallProgress) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.getCachedProgress());
    return () => this.progressListeners.delete(listener);
  }

  private notifyStatus(status: HausaPackStatus): void {
    this.statusListeners.forEach((l) => {
      try {
        l(status);
      } catch (e) {
        console.error('Error in Hausa pack status subscriber:', e);
      }
    });
  }

  private notifyProgress(progress: PackInstallProgress): void {
    this.progressListeners.forEach((l) => {
      try {
        l(progress);
      } catch (e) {
        console.error('Error in Hausa pack progress subscriber:', e);
      }
    });
  }

  public async ensureStatusLoaded(): Promise<HausaPackStatus> {
    if (this.statusLoaded) return this.getCachedStatus();
    if (this.statusLoadingPromise) return this.statusLoadingPromise;
    this.statusLoadingPromise = this.refreshStatus().finally(() => {
      this.statusLoadingPromise = null;
    });
    return this.statusLoadingPromise;
  }

  public async refreshStatus(): Promise<HausaPackStatus> {
    if (!this.isNativeAndroid() && !this.mockInstaller) {
      this.statusLoaded = true;
      return this.getCachedStatus();
    }
    try {
      const nativeStatus = await this.getNativePlugin().getPackStatus({ lang: 'ha', packId: HAUSA_PACK_MANIFEST.packId });
      this.currentStatus = {
        ...this.currentStatus,
        ...nativeStatus,
        platform: this.detectPlatform(),
        error: nativeStatus.error ?? null,
      };
      this.statusLoaded = true;
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.currentStatus = {
        ...this.currentStatus,
        error: msg,
      };
      this.statusLoaded = true;
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    }
  }

  public async installHausaPack(options: {
    manifest?: Partial<HausaPackManifest>;
    forceReinstall?: boolean;
  } = {}): Promise<HausaPackStatus> {
    return this.installPack(options);
  }

  public async installPack(options: {
    manifest?: Partial<HausaPackManifest>;
    forceReinstall?: boolean;
  } = {}): Promise<HausaPackStatus> {
    const manifest = (options.manifest || HAUSA_PACK_MANIFEST) as HausaPackManifest;
    const valResult = validateHausaPackManifest(manifest);
    if (!valResult.valid) {
      throw new HausaPackInstallError('INVALID_MANIFEST', valResult.message, {
        missing: valResult.missingOrInvalidFields,
      });
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

    try {
      const nativeRes = await this.getNativePlugin().installPack({
        lang: 'ha',
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

      this.currentStatus = {
        ...this.currentStatus,
        ...nativeRes,
        installed: true,
        inProgress: false,
        error: null,
      };
      this.statusLoaded = true;
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.currentStatus = {
        ...this.currentStatus,
        inProgress: false,
        error: msg,
      };
      this.notifyStatus(this.getCachedStatus());
      throw new HausaPackInstallError('INSTALL_FAILED', msg);
    }
  }

  public async installExtendedPack(options: { forceReinstall?: boolean } = {}): Promise<HausaPackStatus> {
    const ext = HAUSA_PACK_MANIFEST.extendedCompanion;
    if (!ext || !ext.downloadUrl) {
      throw new HausaPackInstallError('INVALID_MANIFEST', 'Hausa Extended pack manifest or download URL is unavailable.');
    }
    const current = this.statusLoaded ? this.getCachedStatus() : await this.ensureStatusLoaded();
    if (!current.installed) {
      throw new HausaPackInstallError('CORE_REQUIRED', 'Install Hausa Core offline pack before installing Extended enrichment.');
    }
    if (!options.forceReinstall && current.extendedInstalled && current.extendedDbSizeBytes === ext.uncompressedSizeBytes) {
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

    try {
      const nativeRes = await this.getNativePlugin().installPack({
        lang: 'ha',
        packId: ext.packId,
        packLayer: 'extended',
        packVersion: ext.packVersion,
        forceReinstall: Boolean(options.forceReinstall),
        url: ext.downloadUrl,
        compressedSha256: ext.compressedSha256,
        uncompressedSha256: ext.uncompressedSha256,
        compressedSizeBytes: ext.compressedSizeBytes,
        uncompressedSizeBytes: ext.uncompressedSizeBytes,
      });

      this.currentStatus = {
        ...this.currentStatus,
        ...nativeRes,
        installed: nativeRes.installed ?? true,
        extendedInstalled: nativeRes.extendedInstalled ?? true,
        inProgress: false,
        error: null,
      };
      this.statusLoaded = true;
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.currentStatus = {
        ...this.currentStatus,
        inProgress: false,
        error: msg,
      };
      this.notifyStatus(this.getCachedStatus());
      throw new HausaPackInstallError('INSTALL_FAILED', msg);
    }
  }

  public async removeExtendedPack(): Promise<HausaPackStatus> {
    try {
      if (this.beforeMutateDbHook) {
        await this.beforeMutateDbHook();
      }
      const res = await this.getNativePlugin().removePack({
        lang: 'ha',
        packId: HAUSA_PACK_MANIFEST.extendedCompanion?.packId || 'ha-lexica-schema-v4-extended',
        packLayer: 'extended',
      });
      this.currentStatus = {
        ...this.currentStatus,
        availableBytes: res.availableBytes,
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
      throw new HausaPackInstallError('REMOVE_FAILED', msg);
    }
  }

  public async verifyExtendedPack(): Promise<HausaPackStatus> {
    try {
      const verified = await this.getNativePlugin().verifyInstalledPack({
        lang: 'ha',
        packId: HAUSA_PACK_MANIFEST.extendedCompanion?.packId || 'ha-lexica-schema-v4-extended',
        packLayer: 'extended',
      });
      this.currentStatus = {
        ...this.currentStatus,
        ...verified,
        extendedInstalled: verified.extendedInstalled ?? true,
        error: null,
      };
      this.persistStatus();
      this.notifyStatus(this.getCachedStatus());
      return this.getCachedStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HausaPackInstallError('VERIFY_FAILED', msg);
    }
  }

  public async cancelInstall(): Promise<{ cancelled: boolean }> {
    try {
      const res = await this.getNativePlugin().cancelInstall({ lang: 'ha', packId: HAUSA_PACK_MANIFEST.packId });
      this.currentStatus = { ...this.currentStatus, inProgress: false };
      this.notifyStatus(this.getCachedStatus());
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HausaPackInstallError('CANCEL_FAILED', msg);
    }
  }

  public async removePack(): Promise<HausaPackStatus> {
    try {
      if (this.beforeMutateDbHook) {
        await this.beforeMutateDbHook();
      }
      const res = await this.getNativePlugin().removePack({
        lang: 'ha',
        packId: HAUSA_PACK_MANIFEST.packId,
        packLayer: 'core',
      });
      this.currentStatus = {
        ...this.currentStatus,
        installed: false,
        dbSizeBytes: 0,
        availableBytes: res.availableBytes,
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
      throw new HausaPackInstallError('REMOVE_FAILED', msg);
    }
  }

  public async verifyInstalledPack(): Promise<HausaPackStatus> {
    try {
      const verified = await this.getNativePlugin().verifyInstalledPack({
        lang: 'ha',
        packId: HAUSA_PACK_MANIFEST.packId,
        packLayer: 'core',
      });
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
      throw new HausaPackInstallError('VERIFY_FAILED', msg);
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

export const hausaPackService = new HausaPackService();
