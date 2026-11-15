import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { gunzipSync } from 'fflate';
import type {
  LanguageCode,
  PackDownloadProgress,
  PackInstallState,
  PackManifestItem,
} from '../types/dictionary';
import {
  sqliteManager,
  idbPutBlob,
  idbDeleteBlob,
  idbGetBlob,
  uint8ArrayToBase64,
} from './sqliteAdapter';
import { LEXICA_SQLITE_SCHEMA_VERSION } from '../sqlite-poc/schema';

export type PackProgressListener = (progress: PackDownloadProgress) => void;

export interface PackRuntimeState {
  langCode: LanguageCode;
  packId: string;
  tier: 'core_starter' | 'full_pack';
  version: string;
  installState: PackInstallState;
  entryCount: number;
  senseCount: number;
  translationCount: number;
  sizeBytes: number;
  compressedSizeBytes: number;
  sha256Checksum?: string;
  installedAt?: number;
  updatedAt?: number;
  availableUpdateVersion?: string | null;
}

const ALL_LANGUAGES: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];

function isNativeAndroidOrIos(): boolean {
  try {
    return typeof window !== 'undefined' && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    typeof window === 'undefined'
  );
}

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (isNodeRuntime()) {
    const crypto = await import('node:crypto');
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

import { PACK_MANIFEST_ITEMS } from '../data/packManifest';

class PackManagerService {
  private activeDownloads: Map<LanguageCode, AbortController> = new Map();
  private progressState: Map<LanguageCode, PackDownloadProgress> = new Map();
  private listeners: Set<PackProgressListener> = new Set();
  private manifestItems: Map<LanguageCode, PackManifestItem> = new Map();
  private nodePackDir: string | null = null;
  private customFetch: typeof fetch | null = null;

  constructor() {
    this.setManifest(PACK_MANIFEST_ITEMS);
  }

  public configureForTests(opts: { nodePackDir?: string | null; fetchImpl?: typeof fetch | null }): void {
    if (opts.nodePackDir !== undefined) this.nodePackDir = opts.nodePackDir;
    if (opts.fetchImpl !== undefined) this.customFetch = opts.fetchImpl;
  }

  public subscribe(listener: PackProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitProgress(progress: PackDownloadProgress): void {
    this.progressState.set(progress.langCode, progress);
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  public getProgress(lang: LanguageCode): PackDownloadProgress | null {
    return this.progressState.get(lang) || null;
  }

  public setManifest(items: PackManifestItem[]): void {
    this.manifestItems.clear();
    for (const item of items) {
      this.manifestItems.set(item.langCode, item);
    }
  }

  public getManifestItem(lang: LanguageCode): PackManifestItem | null {
    return this.manifestItems.get(lang) || null;
  }

  public getAllManifestItems(): PackManifestItem[] {
    return ALL_LANGUAGES.map((code) => this.manifestItems.get(code)).filter(
      (item): item is PackManifestItem => Boolean(item)
    );
  }

  /**
   * Startup initialization + crash recovery:
   * - Seeds language_pack_states from core DB's language_packs registry if not yet present
   * - Cleans up stale .part / .tmpSQLite.db artifacts from interrupted downloads/installs
   * - Opens any already-installed full packs ready for offline querying
   */
  public async initializeAndRecover(): Promise<void> {
    await sqliteManager.ensureInitialized();
    const core = sqliteManager.getCoreConnection();
    const stateDb = sqliteManager.getStateConnection();

    // Load pack metadata bundled inside core DB
    const corePackRows = await core.query<{
      pack_id: string;
      lang_code: LanguageCode;
      tier: string;
      pack_version: string;
      install_state: string;
      db_file_name: string;
      size_bytes: number;
      compressed_size_bytes: number;
      sha256_checksum: string | null;
      entry_count: number;
      sense_count: number;
      translation_count: number;
    }>(`SELECT * FROM language_packs;`);

    const existingStates = await stateDb.query<{
      lang_code: LanguageCode;
      pack_id: string;
      tier: string;
      pack_version: string;
      install_state: string;
      db_file_path: string | null;
      size_bytes: number;
      compressed_size_bytes: number;
      sha256_checksum: string | null;
      entry_count: number;
      sense_count: number;
      translation_count: number;
      installed_at: number | null;
      updated_at: number | null;
    }>(`SELECT * FROM language_pack_states;`);

    const stateByLang = new Map(existingStates.map((r) => [r.lang_code, r]));

    for (const lang of ALL_LANGUAGES) {
      const existing = stateByLang.get(lang);
      const coreRow = corePackRows.find((r) => r.lang_code === lang && r.tier === 'core_starter');

      if (!existing) {
        const entryCount = Number(coreRow?.entry_count ?? 0);
        const senseCount = Number(coreRow?.sense_count ?? 0);
        const translationCount = Number(coreRow?.translation_count ?? 0);
        const sizeBytes = Number(coreRow?.size_bytes ?? 0);
        await stateDb.run(
          `INSERT OR REPLACE INTO language_pack_states(
            lang_code, pack_id, tier, pack_version, install_state, db_file_path,
            size_bytes, compressed_size_bytes, sha256_checksum,
            entry_count, sense_count, translation_count, installed_at, updated_at
          ) VALUES (?, ?, 'core_starter', ?, 'core_only', NULL, ?, 0, ?, ?, ?, ?, ?, ?);`,
          [
            lang,
            coreRow?.pack_id || `core-${lang}`,
            coreRow?.pack_version || '2026.6.0',
            sizeBytes,
            coreRow?.sha256_checksum || null,
            entryCount,
            senseCount,
            translationCount,
            Date.now(),
            Date.now(),
          ]
        );
        continue;
      }

      // Recover interrupted downloads or staging verifications
      if (existing.install_state === 'downloading' || existing.install_state === 'verifying') {
        await this.cleanupTempFiles(lang);
        const fallbackState: PackInstallState = coreRow ? 'core_only' : 'incomplete';
        await stateDb.run(
          `UPDATE language_pack_states
           SET install_state = ?, updated_at = ?
           WHERE lang_code = ?;`,
          [fallbackState, Date.now(), lang]
        );
        continue;
      }

      // If full_pack was previously installed, verify file/blob exists and open it
      if (existing.tier === 'full_pack' && existing.install_state === 'installed') {
        const opened = await this.tryOpenExistingFullPack(lang, existing.db_file_path);
        if (!opened) {
          // Recover gracefully to core starter if pack file disappeared
          await stateDb.run(
            `UPDATE language_pack_states
             SET tier = 'core_starter',
                 install_state = 'core_only',
                 db_file_path = NULL,
                 entry_count = ?,
                 sense_count = ?,
                 translation_count = ?,
                 size_bytes = ?,
                 updated_at = ?
             WHERE lang_code = ?;`,
            [
              Number(coreRow?.entry_count ?? 0),
              Number(coreRow?.sense_count ?? 0),
              Number(coreRow?.translation_count ?? 0),
              Number(coreRow?.size_bytes ?? 0),
              Date.now(),
              lang,
            ]
          );
        }
      }
    }

    // Clean any orphaned temp files left on native Android storage
    if (isNativeAndroidOrIos()) {
      for (const lang of ALL_LANGUAGES) {
        await this.cleanupTempFiles(lang);
      }
    }
  }

  private async tryOpenExistingFullPack(lang: LanguageCode, dbFilePath: string | null): Promise<boolean> {
    try {
      if (isNativeAndroidOrIos()) {
        if (!dbFilePath) return false;
        await sqliteManager.openInstalledPack(lang, dbFilePath);
        return true;
      }
      if (isNodeRuntime()) {
        if (!dbFilePath) return false;
        const fs = await import('node:fs');
        if (!fs.existsSync(dbFilePath)) return false;
        await sqliteManager.openInstalledPack(lang, dbFilePath);
        return true;
      }
      const blob = await idbGetBlob(`pack_${lang}`);
      if (!blob) return false;
      await sqliteManager.openInstalledPack(lang, `pack_${lang}`, blob);
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupTempFiles(lang: LanguageCode): Promise<void> {
    if (isNativeAndroidOrIos()) {
      await Filesystem.deleteFile({
        path: `packs/lexica_pack_${lang}.part`,
        directory: Directory.Data,
      }).catch(() => {});
      await Filesystem.deleteFile({
        path: `packs/lexica_pack_${lang}.tmpSQLite.db`,
        directory: Directory.Data,
      }).catch(() => {});
    } else if (isNodeRuntime() && this.nodePackDir) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      for (const suffix of ['.part', '.tmpSQLite.db']) {
        const p = path.join(this.nodePackDir, `lexica_pack_${lang}${suffix}`);
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    }
  }

  public async getPackStates(): Promise<Record<LanguageCode, PackRuntimeState>> {
    await sqliteManager.ensureInitialized();
    const stateDb = sqliteManager.getStateConnection();
    const rows = await stateDb.query<{
      lang_code: LanguageCode;
      pack_id: string;
      tier: 'core_starter' | 'full_pack';
      pack_version: string;
      install_state: PackInstallState;
      size_bytes: number;
      compressed_size_bytes: number;
      sha256_checksum: string | null;
      entry_count: number;
      sense_count: number;
      translation_count: number;
      installed_at: number | null;
      updated_at: number | null;
    }>(`SELECT * FROM language_pack_states;`);

    const map: Partial<Record<LanguageCode, PackRuntimeState>> = {};
    for (const row of rows) {
      const manifest = this.manifestItems.get(row.lang_code);
      const hasUpdate =
        row.tier === 'full_pack' &&
        row.install_state === 'installed' &&
        Boolean(manifest) &&
        manifest!.version !== row.pack_version;

      map[row.lang_code] = {
        langCode: row.lang_code,
        packId: row.pack_id,
        tier: row.tier,
        version: row.pack_version,
        installState: row.install_state,
        entryCount: Number(row.entry_count || 0),
        senseCount: Number(row.sense_count || 0),
        translationCount: Number(row.translation_count || 0),
        sizeBytes: Number(row.size_bytes || 0),
        compressedSizeBytes: Number(row.compressed_size_bytes || manifest?.compressedSizeBytes || 0),
        sha256Checksum: row.sha256_checksum || undefined,
        installedAt: row.installed_at || undefined,
        updatedAt: row.updated_at || undefined,
        availableUpdateVersion: hasUpdate ? manifest!.version : null,
      };
    }

    return map as Record<LanguageCode, PackRuntimeState>;
  }

  public async downloadAndInstallPack(lang: LanguageCode): Promise<PackRuntimeState> {
    await sqliteManager.ensureInitialized();
    const manifest = this.manifestItems.get(lang);
    if (!manifest) {
      throw new Error(`No downloadable pack manifest available for language ${lang}.`);
    }

    if (this.activeDownloads.has(lang)) {
      throw new Error(`Download already in progress for ${lang}.`);
    }

    const stateDb = sqliteManager.getStateConnection();
    const controller = new AbortController();
    this.activeDownloads.set(lang, controller);

    const prevRows = await stateDb.query<{
      tier: string;
      install_state: string;
      pack_version: string;
      entry_count: number;
      sense_count: number;
      translation_count: number;
      size_bytes: number;
    }>(
      `SELECT tier, install_state, pack_version, entry_count, sense_count, translation_count, size_bytes
       FROM language_pack_states WHERE lang_code = ?;`,
      [lang]
    );
    const prevState = prevRows[0];

    await stateDb.run(
      `UPDATE language_pack_states SET install_state = 'downloading', updated_at = ? WHERE lang_code = ?;`,
      [Date.now(), lang]
    );

    this.emitProgress({
      langCode: lang,
      state: 'downloading',
      receivedBytes: 0,
      totalBytes: manifest.compressedSizeBytes || manifest.sizeBytes,
      percent: 0,
    });

    try {
      const fetchFn = this.customFetch || globalThis.fetch;
      let resp: Response;
      try {
        resp = await fetchFn(manifest.downloadUrl, { signal: controller.signal });
        if (!resp.ok && manifest.fallbackDownloadUrl) {
          resp = await fetchFn(manifest.fallbackDownloadUrl, { signal: controller.signal });
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || !manifest.fallbackDownloadUrl) {
          throw err;
        }
        resp = await fetchFn(manifest.fallbackDownloadUrl, { signal: controller.signal });
      }

      if (!resp.ok) {
        throw new Error(`Pack download failed with status HTTP ${resp.status}`);
      }

      const headerLength = Number(resp.headers.get('content-length') || '0');
      const totalBytes = headerLength > 0 ? headerLength : manifest.compressedSizeBytes;

      let compressedBytes: Uint8Array;
      if (resp.body && typeof resp.body.getReader === 'function') {
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
          if (controller.signal.aborted) {
            await reader.cancel().catch(() => {});
            throw new DOMException('Download cancelled', 'AbortError');
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.byteLength;
            const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
            this.emitProgress({
              langCode: lang,
              state: 'downloading',
              receivedBytes,
              totalBytes,
              percent,
            });
          }
        }

        compressedBytes = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const c of chunks) {
          compressedBytes.set(c, offset);
          offset += c.byteLength;
        }
      } else {
        const buf = await resp.arrayBuffer();
        compressedBytes = new Uint8Array(buf);
        this.emitProgress({
          langCode: lang,
          state: 'downloading',
          receivedBytes: compressedBytes.byteLength,
          totalBytes: compressedBytes.byteLength,
          percent: 99,
        });
      }

      if (controller.signal.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }

      // Transition to checksum & SQLite verification stage
      await stateDb.run(
        `UPDATE language_pack_states SET install_state = 'verifying', updated_at = ? WHERE lang_code = ?;`,
        [Date.now(), lang]
      );
      this.emitProgress({
        langCode: lang,
        state: 'verifying',
        receivedBytes: compressedBytes.byteLength,
        totalBytes: compressedBytes.byteLength,
        percent: 100,
      });

      const actualSha = await computeSha256Hex(compressedBytes);
      if (manifest.sha256Checksum && actualSha !== manifest.sha256Checksum) {
        throw new Error(
          `Integrity check failed for ${lang} pack (expected ${manifest.sha256Checksum.slice(0, 12)}, got ${actualSha.slice(0, 12)}).`
        );
      }

      // Decompress .sqlite.gz
      const sqliteBytes = gunzipSync(compressedBytes);

      // Integrity & schema verification before replacing active pack
      const verified = await sqliteManager.verifyRawSqliteBytes(lang, sqliteBytes);
      if (!verified.valid) {
        throw new Error(`SQLite quick_check or schema validation failed for ${lang} pack.`);
      }
      if (verified.schemaVersion > LEXICA_SQLITE_SCHEMA_VERSION) {
        throw new Error(`Pack schema v${verified.schemaVersion} is newer than supported app schema.`);
      }

      // Close previous connection if upgrading
      await sqliteManager.closePack(lang);

      let dbFilePath = `pack_${lang}`;
      if (isNativeAndroidOrIos()) {
        const finalRelPath = `packs/lexica_pack_${lang}SQLite.db`;
        if (verified.nativeTmpPath) {
          await Filesystem.deleteFile({ path: finalRelPath, directory: Directory.Data }).catch(() => {});
          await Filesystem.rename({
            from: verified.nativeTmpPath,
            to: finalRelPath,
            directory: Directory.Data,
          });
        } else {
          await Filesystem.writeFile({
            path: finalRelPath,
            data: uint8ArrayToBase64(sqliteBytes),
            directory: Directory.Data,
          });
        }
        const uriRes = await Filesystem.getUri({ path: finalRelPath, directory: Directory.Data });
        dbFilePath = uriRes.uri.replace(/^file:\/\//, '');
        await sqliteManager.openInstalledPack(lang, dbFilePath);
      } else if (isNodeRuntime()) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = this.nodePackDir || path.resolve(process.cwd(), 'packs');
        fs.mkdirSync(dir, { recursive: true });
        const tmpFile = path.join(dir, `lexica_pack_${lang}.tmpSQLite.db`);
        const finalFile = path.join(dir, `lexica_pack_${lang}SQLite.db`);
        fs.writeFileSync(tmpFile, sqliteBytes);
        fs.renameSync(tmpFile, finalFile);
        dbFilePath = finalFile;
        await sqliteManager.openInstalledPack(lang, finalFile, sqliteBytes);
      } else {
        await idbPutBlob(`pack_${lang}`, sqliteBytes);
        await sqliteManager.openInstalledPack(lang, `pack_${lang}`, sqliteBytes);
      }

      const now = Date.now();
      await stateDb.run(
        `INSERT OR REPLACE INTO language_pack_states(
          lang_code, pack_id, tier, pack_version, install_state, db_file_path,
          size_bytes, compressed_size_bytes, sha256_checksum,
          entry_count, sense_count, translation_count, installed_at, updated_at
        ) VALUES (?, ?, 'full_pack', ?, 'installed', ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          lang,
          manifest.packId,
          verified.packVersion || manifest.version,
          dbFilePath,
          sqliteBytes.byteLength,
          compressedBytes.byteLength,
          actualSha,
          verified.entryCount || manifest.entryCount,
          verified.senseCount || manifest.senseCount,
          verified.translationCount || manifest.translationCount,
          now,
          now,
        ]
      );

      this.emitProgress({
        langCode: lang,
        state: 'installed',
        receivedBytes: compressedBytes.byteLength,
        totalBytes: compressedBytes.byteLength,
        percent: 100,
      });

      const allStates = await this.getPackStates();
      return allStates[lang];
    } catch (err) {
      await this.cleanupTempFiles(lang);
      const isAbort = (err as Error)?.name === 'AbortError';
      const restoreState: PackInstallState =
        prevState && prevState.install_state === 'installed'
          ? 'installed'
          : prevState && prevState.install_state === 'core_only'
          ? 'core_only'
          : isAbort
          ? 'core_only'
          : 'incomplete';

      await stateDb.run(
        `UPDATE language_pack_states SET install_state = ?, updated_at = ? WHERE lang_code = ?;`,
        [restoreState, Date.now(), lang]
      );

      this.emitProgress({
        langCode: lang,
        state: restoreState,
        receivedBytes: 0,
        totalBytes: manifest.compressedSizeBytes,
        percent: 0,
        errorMessage: isAbort ? undefined : err instanceof Error ? err.message : 'Download failed',
      });
      throw err;
    } finally {
      this.activeDownloads.delete(lang);
    }
  }

  public cancelDownload(lang: LanguageCode): boolean {
    const controller = this.activeDownloads.get(lang);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Removes any downloaded full_pack file from device storage AND optionally marks
   * the language inactive (`not_installed`) or reverts to `core_only`.
   */
  public async uninstallPack(
    lang: LanguageCode,
    mode: 'disable_language' | 'revert_to_starter' = 'disable_language'
  ): Promise<void> {
    this.cancelDownload(lang);
    await sqliteManager.ensureInitialized();
    await sqliteManager.closePack(lang);

    if (isNativeAndroidOrIos()) {
      await Filesystem.deleteFile({
        path: `packs/lexica_pack_${lang}SQLite.db`,
        directory: Directory.Data,
      }).catch(() => {});
    } else if (isNodeRuntime()) {
      if (this.nodePackDir) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const p = path.join(this.nodePackDir, `lexica_pack_${lang}SQLite.db`);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } else {
      await idbDeleteBlob(`pack_${lang}`).catch(() => {});
    }

    const core = sqliteManager.getCoreConnection();
    const coreRows = await core.query<{
      pack_id: string;
      pack_version: string;
      size_bytes: number;
      entry_count: number;
      sense_count: number;
      translation_count: number;
    }>(`SELECT * FROM language_packs WHERE lang_code = ? AND tier = 'core_starter' LIMIT 1;`, [lang]);
    const coreRow = coreRows[0];

    const stateDb = sqliteManager.getStateConnection();
    const nextState: PackInstallState = mode === 'revert_to_starter' ? 'core_only' : 'not_installed';
    await stateDb.run(
      `UPDATE language_pack_states
       SET tier = 'core_starter',
           install_state = ?,
           db_file_path = NULL,
           pack_id = ?,
           pack_version = ?,
           size_bytes = ?,
           entry_count = ?,
           sense_count = ?,
           translation_count = ?,
           updated_at = ?
       WHERE lang_code = ?;`,
      [
        nextState,
        coreRow?.pack_id || `core-${lang}`,
        coreRow?.pack_version || '2026.6.0',
        mode === 'revert_to_starter' ? Number(coreRow?.size_bytes ?? 0) : 0,
        mode === 'revert_to_starter' ? Number(coreRow?.entry_count ?? 0) : 0,
        mode === 'revert_to_starter' ? Number(coreRow?.sense_count ?? 0) : 0,
        mode === 'revert_to_starter' ? Number(coreRow?.translation_count ?? 0) : 0,
        Date.now(),
        lang,
      ]
    );
  }

  public async setLanguageActiveState(lang: LanguageCode, active: boolean): Promise<void> {
    await sqliteManager.ensureInitialized();
    const stateDb = sqliteManager.getStateConnection();
    const core = sqliteManager.getCoreConnection();
    const coreRows = await core.query<{
      size_bytes: number;
      entry_count: number;
      sense_count: number;
      translation_count: number;
    }>(`SELECT size_bytes, entry_count, sense_count, translation_count FROM language_packs WHERE lang_code = ? AND tier = 'core_starter' LIMIT 1;`, [lang]);
    const coreRow = coreRows[0];

    const currentRows = await stateDb.query<{ tier: string; db_file_path: string | null }>(
      `SELECT tier, db_file_path FROM language_pack_states WHERE lang_code = ?;`,
      [lang]
    );
    const current = currentRows[0];

    if (active) {
      const hasFullPack =
        current?.tier === 'full_pack' &&
        (await this.tryOpenExistingFullPack(lang, current.db_file_path));

      if (hasFullPack) {
        await stateDb.run(
          `UPDATE language_pack_states SET install_state = 'installed', updated_at = ? WHERE lang_code = ?;`,
          [Date.now(), lang]
        );
      } else {
        await stateDb.run(
          `UPDATE language_pack_states
           SET tier = 'core_starter',
               install_state = 'core_only',
               entry_count = ?,
               sense_count = ?,
               translation_count = ?,
               size_bytes = ?,
               updated_at = ?
           WHERE lang_code = ?;`,
          [
            Number(coreRow?.entry_count ?? 0),
            Number(coreRow?.sense_count ?? 0),
            Number(coreRow?.translation_count ?? 0),
            Number(coreRow?.size_bytes ?? 0),
            Date.now(),
            lang,
          ]
        );
      }
    } else {
      await sqliteManager.closePack(lang);
      await stateDb.run(
        `UPDATE language_pack_states SET install_state = 'not_installed', updated_at = ? WHERE lang_code = ?;`,
        [Date.now(), lang]
      );
    }
  }
}

export const packManager = new PackManagerService();
