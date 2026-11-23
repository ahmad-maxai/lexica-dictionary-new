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

class YorubaPackService {
  private static readonly PREF_STATUS_KEY = 'lexica_yoruba_pack_status_v4';

  private statusListeners = new Set<(status: YorubaPackStatus) => void>();
  private progressListeners = new Set<(progress: PackInstallProgress) => void>();
  private nativeListenerHandle: PluginListenerHandle | null = null;
  private beforeMutateDbHook: (() => Promise<void>) | null = null;
  private mockInstaller: YorubaPackInstallerNative | null = null;
  private statusLoaded = false;
  private statusLoadingPromise: Promise<YorubaPackStatus> | null = null;

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
    acceptedEntries: YORUBA_PACK_MANIFEST.acceptedEntries,
    distinctHeadwords: YORUBA_PACK_MANIFEST.distinctHeadwords,
    totalSenses: YORUBA_PACK_MANIFEST.totalSenses,
    corePrimarySenses: YORUBA_PACK_MANIFEST.corePrimarySenses,
    totalWordForms: YORUBA_PACK_MANIFEST.totalWordForms,
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
      this.currentStatus.platform = this.detectPlatform();
    }
    if (overrides.nativeBridge !== undefined) {
      this._injectMockInstaller(overrides.nativeBridge ?? null);
    }
  }

  private getInstaller(): YorubaPackInstallerNative {
    if (this.mockInstaller) return this.mockInstaller;
    return NativeYorubaPackInstaller;
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
          platform: this.detectPlatform(),
        };
      }
    } catch {
      // Ignore
    }
  }

  private persistStatus(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        YorubaPackService.PREF_STATUS_KEY,
        JSON.stringify(this.currentStatus)
      );
    } catch {
      // Ignore
    }
  }

  private initNativeListener(): void {
    if (typeof window === 'undefined') return;
    try {
      this.getInstaller()
        .addListener('packInstallProgress', (p: PackInstallProgress) => {
          this.currentProgress = p;
          if (p.stage === 'error') {
            this.currentStatus.inProgress = false;
            this.currentStatus.error = p.message;
            this.persistStatus();
            this.notifyStatusListeners();
          } else if (p.stage === 'installed') {
            this.currentStatus.inProgress = false;
            this.currentStatus.installed = true;
            this.currentStatus.error = null;
            this.persistStatus();
            this.notifyStatusListeners();
          }
          this.notifyProgressListeners(p);
        })
        .then((handle) => {
          this.nativeListenerHandle = handle;
        })
        .catch(() => {
          // Native listener fallback for web/non-native
        });
    } catch {
      // Ignore
    }
  }

  public subscribeStatus(listener: (status: YorubaPackStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeProgress(listener: (progress: PackInstallProgress) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.currentProgress);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private notifyStatusListeners(): void {
    for (const l of this.statusListeners) {
      try {
        l(this.currentStatus);
      } catch {
        // Ignore
      }
    }
  }

  private notifyProgressListeners(p: PackInstallProgress): void {
    for (const l of this.progressListeners) {
      try {
        l(p);
      } catch {
        // Ignore
      }
    }
  }

  public async getStatus(forceRefresh = false): Promise<YorubaPackStatus> {
    if (this.statusLoaded && !forceRefresh) {
      return this.currentStatus;
    }
    if (this.statusLoadingPromise && !forceRefresh) {
      return this.statusLoadingPromise;
    }

    this.statusLoadingPromise = (async () => {
      try {
        const platform = this.detectPlatform();
        if (platform === 'android' && !this.mockInstaller) {
          const res = await this.getInstaller().getPackStatus({
            lang: 'yo',
            packId: YORUBA_PACK_MANIFEST.packId,
          });
          if (res) {
            this.currentStatus = {
              ...this.currentStatus,
              ...res,
              platform,
            };
          }
        } else if (this.mockInstaller) {
          const res = await this.mockInstaller.getPackStatus({
            lang: 'yo',
            packId: YORUBA_PACK_MANIFEST.packId,
          });
          if (res) {
            this.currentStatus = {
              ...this.currentStatus,
              ...res,
              platform,
            };
          }
        }
      } catch (err) {
        this.currentStatus.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.statusLoaded = true;
        this.statusLoadingPromise = null;
        this.persistStatus();
        this.notifyStatusListeners();
      }
      return this.currentStatus;
    })();

    return this.statusLoadingPromise;
  }

  public async refreshStatus(): Promise<YorubaPackStatus> {
    return this.getStatus(true);
  }

  public async installCorePack(forceReinstall = false): Promise<YorubaPackStatus> {
    const manifestVal = validateYorubaPackManifest(YORUBA_PACK_MANIFEST);
    if (!manifestVal.valid) {
      throw new YorubaPackInstallError(
        'INVALID_MANIFEST',
        `Cannot install Yoruba pack: ${manifestVal.message}`,
        { missing: manifestVal.missingOrInvalidFields }
      );
    }

    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }

    this.currentStatus.inProgress = true;
    this.currentStatus.error = null;
    this.notifyStatusListeners();

    this.currentProgress = {
      stage: 'downloading',
      processedBytes: 0,
      totalBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
      percent: 0,
      message: 'Downloading Yoruba Core dictionary pack...',
    };
    this.notifyProgressListeners(this.currentProgress);

    const platform = this.detectPlatform();
    try {
      if (platform === 'android' || this.mockInstaller) {
        const installer = this.getInstaller();
        const res = await installer.installPack({
          lang: 'yo',
          packId: YORUBA_PACK_MANIFEST.packId,
          packLayer: 'core',
          packVersion: YORUBA_PACK_MANIFEST.packVersion,
          forceReinstall,
          url: YORUBA_PACK_MANIFEST.downloadUrl,
          compressedSha256: YORUBA_PACK_MANIFEST.compressedSha256,
          uncompressedSha256: YORUBA_PACK_MANIFEST.uncompressedSha256,
          compressedSizeBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
          uncompressedSizeBytes: YORUBA_PACK_MANIFEST.uncompressedSizeBytes,
        });

        this.currentStatus = {
          ...this.currentStatus,
          ...res,
          installed: true,
          inProgress: false,
          error: null,
          platform,
        };
      } else {
        // Web preview mock install simulation
        await new Promise((r) => setTimeout(r, 600));
        this.currentProgress = {
          stage: 'extracting',
          processedBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
          totalBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
          percent: 50,
          message: 'Extracting Yoruba Core SQLite database...',
        };
        this.notifyProgressListeners(this.currentProgress);

        await new Promise((r) => setTimeout(r, 600));
        this.currentStatus.installed = true;
        this.currentStatus.dbPath = 'web_simulated_yoruba_core.db';
        this.currentStatus.dbSizeBytes = YORUBA_PACK_MANIFEST.uncompressedSizeBytes;
        this.currentStatus.inProgress = false;
        this.currentStatus.error = null;
      }

      this.currentProgress = {
        stage: 'installed',
        processedBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
        totalBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
        percent: 100,
        message: 'Yoruba Core offline dictionary installed successfully.',
      };
      this.notifyProgressListeners(this.currentProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.currentStatus.inProgress = false;
      this.currentStatus.error = msg;
      this.currentProgress = {
        stage: 'error',
        processedBytes: 0,
        totalBytes: YORUBA_PACK_MANIFEST.compressedSizeBytes,
        percent: 0,
        message: `Yoruba install failed: ${msg}`,
      };
      this.notifyProgressListeners(this.currentProgress);
      throw new YorubaPackInstallError('INSTALL_FAILED', msg, { originalError: err });
    } finally {
      this.persistStatus();
      this.notifyStatusListeners();
    }

    return this.currentStatus;
  }

  public async installExtendedPack(): Promise<YorubaPackStatus> {
    const extInfo = YORUBA_PACK_MANIFEST.extendedCompanion;
    if (!extInfo || !extInfo.downloadUrl) {
      throw new YorubaPackInstallError('NO_EXTENDED_PACK', 'Extended companion pack is not available.');
    }

    this.currentStatus.inProgress = true;
    this.notifyStatusListeners();

    const platform = this.detectPlatform();
    try {
      if (platform === 'android' || this.mockInstaller) {
        const installer = this.getInstaller();
        const res = await installer.installPack({
          lang: 'yo',
          packId: extInfo.packId,
          packLayer: 'extended',
          packVersion: extInfo.packVersion,
          url: extInfo.downloadUrl,
          compressedSha256: extInfo.compressedSha256,
          uncompressedSha256: extInfo.uncompressedSha256,
          compressedSizeBytes: extInfo.compressedSizeBytes,
          uncompressedSizeBytes: extInfo.uncompressedSizeBytes,
        });

        this.currentStatus = {
          ...this.currentStatus,
          ...res,
          extendedInstalled: true,
          inProgress: false,
          error: null,
        };
      } else {
        await new Promise((r) => setTimeout(r, 800));
        this.currentStatus.extendedInstalled = true;
        this.currentStatus.extendedDbPath = 'web_simulated_yoruba_extended.db';
        this.currentStatus.extendedDbSizeBytes = extInfo.uncompressedSizeBytes;
        this.currentStatus.inProgress = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.currentStatus.inProgress = false;
      this.currentStatus.error = msg;
      throw new YorubaPackInstallError('EXTENDED_INSTALL_FAILED', msg);
    } finally {
      this.persistStatus();
      this.notifyStatusListeners();
    }

    return this.currentStatus;
  }

  public async removePack(packLayer: 'core' | 'extended' = 'core'): Promise<YorubaPackStatus> {
    if (this.beforeMutateDbHook) {
      await this.beforeMutateDbHook();
    }

    const platform = this.detectPlatform();
    try {
      if (platform === 'android' || this.mockInstaller) {
        const installer = this.getInstaller();
        await installer.removePack({
          lang: 'yo',
          packId: packLayer === 'core' ? YORUBA_PACK_MANIFEST.packId : YORUBA_PACK_MANIFEST.extendedCompanion?.packId,
          packLayer,
        });
      }

      if (packLayer === 'core') {
        this.currentStatus.installed = false;
        this.currentStatus.dbPath = '';
        this.currentStatus.dbSizeBytes = 0;
        this.currentStatus.extendedInstalled = false;
        this.currentStatus.extendedDbPath = '';
        this.currentStatus.extendedDbSizeBytes = 0;
      } else {
        this.currentStatus.extendedInstalled = false;
        this.currentStatus.extendedDbPath = '';
        this.currentStatus.extendedDbSizeBytes = 0;
      }
      this.currentStatus.error = null;
    } catch (err) {
      this.currentStatus.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.persistStatus();
      this.notifyStatusListeners();
    }

    return this.currentStatus;
  }
}

export const yorubaPackService = new YorubaPackService();
