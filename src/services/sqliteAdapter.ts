import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js-fts5';
import type { LanguageCode } from '../types/dictionary';

export interface SqliteRow {
  [key: string]: string | number | Uint8Array | null;
}

export interface SqliteConnection {
  readonly dbKey: string;
  readonly isReadOnly: boolean;
  query<T extends SqliteRow = SqliteRow>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
  run(sql: string, params?: Array<string | number | null>): Promise<void>;
  execute(statements: string, transaction?: boolean): Promise<void>;
  exportBytes?(): Uint8Array;
  close(): Promise<void>;
}

const CORE_DB_NAME = 'lexica_core';
const STATE_DB_NAME = 'lexica_state';
const CORE_DB_ASSET_VERSION_KEY = 'lexica_core_sqlite_version';
export const CURRENT_CORE_SCHEMA_AND_DATA_VERSION = '2026.6.0';

const IDB_NAME = 'lexica_sqlite_storage_v2';
const IDB_STORE = 'sqlite_blobs';

function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    typeof window === 'undefined'
  );
}

function isNativeAndroidOrIos(): boolean {
  try {
    return typeof window !== 'undefined' && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const mod = await import('sql.js-fts5');
      const initSqlJs = mod.default;
      if (isNodeRuntime()) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js-fts5/dist/sql-wasm.wasm');
        const wasmBinary = fs.readFileSync(wasmPath);
        return initSqlJs({ wasmBinary });
      }
      return initSqlJs({
        locateFile: () => '/assets/wasm/sql-wasm.wasm',
      });
    })();
  }
  return sqlJsPromise;
}

// ============================================================================
// IndexedDB Blob Persistence (for Web Browser offline packs & state DB)
// ============================================================================

async function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetBlob(key: string): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const val = req.result;
        if (!val) return resolve(null);
        if (val instanceof Uint8Array) return resolve(val);
        if (val instanceof ArrayBuffer) return resolve(new Uint8Array(val));
        resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbPutBlob(key: string, bytes: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDeleteBlob(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// SqlJs WASM Connection Wrapper (Web + Node)
// ============================================================================

class SqlJsConnection implements SqliteConnection {
  public readonly dbKey: string;
  public readonly isReadOnly: boolean;
  private db: SqlJsDatabase;
  private onPersist?: (bytes: Uint8Array) => Promise<void>;

  constructor(
    dbKey: string,
    db: SqlJsDatabase,
    isReadOnly: boolean,
    onPersist?: (bytes: Uint8Array) => Promise<void>
  ) {
    this.dbKey = dbKey;
    this.db = db;
    this.isReadOnly = isReadOnly;
    this.onPersist = onPersist;
  }

  public async query<T extends SqliteRow = SqliteRow>(
    sql: string,
    params: Array<string | number | null> = []
  ): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  public async run(sql: string, params: Array<string | number | null> = []): Promise<void> {
    if (this.isReadOnly) {
      throw new Error(`Cannot execute write query on read-only DB: ${this.dbKey}`);
    }
    this.db.run(sql, params);
    if (this.onPersist) {
      await this.onPersist(this.db.export());
    }
  }

  public async execute(statements: string, transaction: boolean = true): Promise<void> {
    if (this.isReadOnly) {
      throw new Error(`Cannot execute batch write on read-only DB: ${this.dbKey}`);
    }
    if (transaction) {
      this.db.run('BEGIN TRANSACTION;');
      try {
        this.db.run(statements);
        this.db.run('COMMIT;');
      } catch (err) {
        try {
          this.db.run('ROLLBACK;');
        } catch {
          // ignore
        }
        throw err;
      }
    } else {
      this.db.run(statements);
    }
    if (this.onPersist) {
      await this.onPersist(this.db.export());
    }
  }

  public exportBytes(): Uint8Array {
    return this.db.export();
  }

  public async close(): Promise<void> {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

// ============================================================================
// Capacitor Native Android Connection Wrapper
// ============================================================================

class CapacitorNativeConnection implements SqliteConnection {
  public readonly dbKey: string;
  public readonly isReadOnly: boolean;
  private readonly isNonConformed: boolean;

  constructor(dbKey: string, isReadOnly: boolean, isNonConformed: boolean) {
    this.dbKey = dbKey;
    this.isReadOnly = isReadOnly;
    this.isNonConformed = isNonConformed;
  }

  public async query<T extends SqliteRow = SqliteRow>(
    sql: string,
    params: Array<string | number | null> = []
  ): Promise<T[]> {
    const res = await CapacitorSQLite.query({
      database: this.dbKey,
      statement: sql,
      values: params,
      readonly: this.isReadOnly,
    });
    return (res.values || []) as T[];
  }

  public async run(sql: string, params: Array<string | number | null> = []): Promise<void> {
    if (this.isReadOnly) {
      throw new Error(`Cannot run write on read-only DB ${this.dbKey}`);
    }
    await CapacitorSQLite.run({
      database: this.dbKey,
      statement: sql,
      values: params,
      transaction: true,
      readonly: false,
    });
  }

  public async execute(statements: string, transaction: boolean = true): Promise<void> {
    if (this.isReadOnly) {
      throw new Error(`Cannot execute write on read-only DB ${this.dbKey}`);
    }
    await CapacitorSQLite.execute({
      database: this.dbKey,
      statements,
      transaction,
      readonly: false,
    });
  }

  public async close(): Promise<void> {
    try {
      if (this.isNonConformed) {
        await CapacitorSQLite.closeNCConnection({ databasePath: this.dbKey });
      } else {
        await CapacitorSQLite.close({ database: this.dbKey, readonly: this.isReadOnly });
        await CapacitorSQLite.closeConnection({ database: this.dbKey, readonly: this.isReadOnly });
      }
    } catch {
      // Ignore if already closed
    }
  }
}

// ============================================================================
// Unified Cross-Platform SqliteManager
// ============================================================================

class SqliteManager {
  private coreConn: SqliteConnection | null = null;
  private stateConn: SqliteConnection | null = null;
  private packConns: Map<LanguageCode, SqliteConnection> = new Map();
  private initPromise: Promise<void> | null = null;
  private nodeStateDir: string | null = null;

  public configureNodeDirs(opts: { stateDir?: string | null }): void {
    this.nodeStateDir = opts.stateDir ?? null;
  }

  public hasActiveConnections(): boolean {
    return Boolean(this.coreConn && this.stateConn);
  }

  public async ensureInitialized(): Promise<void> {
    if (this.coreConn && this.stateConn) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeInternal().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  private async initializeInternal(): Promise<void> {
    await this.openCoreDatabase();
    await this.openStateDatabase();
  }

  private async openCoreDatabase(): Promise<void> {
    if (isNativeAndroidOrIos()) {
      const installedVersion =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(CORE_DB_ASSET_VERSION_KEY)
          : null;
      const dbExistsRes = await CapacitorSQLite.isDatabase({ database: CORE_DB_NAME });
      const needsCopy = !dbExistsRes.result || installedVersion !== CURRENT_CORE_SCHEMA_AND_DATA_VERSION;

      if (needsCopy) {
        try {
          const isOpen = await CapacitorSQLite.isDBOpen({ database: CORE_DB_NAME, readonly: true });
          if (isOpen.result) {
            await CapacitorSQLite.close({ database: CORE_DB_NAME, readonly: true });
          }
          await CapacitorSQLite.closeConnection({ database: CORE_DB_NAME, readonly: true });
        } catch {
          // Safe if not previously open
        }
        await CapacitorSQLite.copyFromAssets({ overwrite: true });
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CORE_DB_ASSET_VERSION_KEY, CURRENT_CORE_SCHEMA_AND_DATA_VERSION);
        }
      }

      try {
        await CapacitorSQLite.createConnection({
          database: CORE_DB_NAME,
          version: 1,
          encrypted: false,
          mode: 'no-encryption',
          readonly: true,
        });
      } catch {
        // Connection might already exist across hot reload
      }
      await CapacitorSQLite.open({ database: CORE_DB_NAME, readonly: true });
      const conn = new CapacitorNativeConnection(CORE_DB_NAME, true, false);
      try {
        await conn.query('PRAGMA cache_size = -4000;');
        await conn.query('PRAGMA temp_store = FILE;');
      } catch {
        // Non-fatal on some Android SQLite builds
      }
      this.coreConn = conn;
      return;
    }

    const SQL = await getSqlJs();
    let coreBytes: Uint8Array;
    if (isNodeRuntime()) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dbPath = path.resolve(process.cwd(), 'public/assets/databases/lexica_coreSQLite.db');
      coreBytes = new Uint8Array(fs.readFileSync(dbPath));
    } else {
      const resp = await fetch('/assets/databases/lexica_coreSQLite.db');
      if (!resp.ok) {
        throw new Error(`Failed to fetch bundled dictionary database: HTTP ${resp.status}`);
      }
      coreBytes = new Uint8Array(await resp.arrayBuffer());
    }

    const db = new SQL.Database(coreBytes);
    const conn = new SqlJsConnection(CORE_DB_NAME, db, true);
    await conn.query('PRAGMA cache_size = -4000;');
    this.coreConn = conn;
  }

  private async openStateDatabase(): Promise<void> {
    const createStateTablesSql = `
      CREATE TABLE IF NOT EXISTS language_pack_states (
        lang_code TEXT PRIMARY KEY NOT NULL,
        pack_id TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'core_starter',
        pack_version TEXT NOT NULL,
        install_state TEXT NOT NULL,
        db_file_path TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        compressed_size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256_checksum TEXT,
        entry_count INTEGER NOT NULL DEFAULT 0,
        sense_count INTEGER NOT NULL DEFAULT 0,
        translation_count INTEGER NOT NULL DEFAULT 0,
        installed_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `;

    if (isNativeAndroidOrIos()) {
      try {
        await CapacitorSQLite.createConnection({
          database: STATE_DB_NAME,
          version: 1,
          encrypted: false,
          mode: 'no-encryption',
          readonly: false,
        });
      } catch {
        // Connection already registered
      }
      await CapacitorSQLite.open({ database: STATE_DB_NAME, readonly: false });
      const conn = new CapacitorNativeConnection(STATE_DB_NAME, false, false);
      await conn.execute(createStateTablesSql, true);
      this.stateConn = conn;
      return;
    }

    const SQL = await getSqlJs();
    let existingBytes: Uint8Array | null = null;
    let persistFn: ((bytes: Uint8Array) => Promise<void>) | undefined;

    if (isNodeRuntime()) {
      if (this.nodeStateDir) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        fs.mkdirSync(this.nodeStateDir, { recursive: true });
        const stateFile = path.join(this.nodeStateDir, 'lexica_stateSQLite.db');
        if (fs.existsSync(stateFile)) {
          existingBytes = new Uint8Array(fs.readFileSync(stateFile));
        }
        persistFn = async (bytes: Uint8Array) => {
          fs.writeFileSync(stateFile, bytes);
        };
      }
    } else {
      existingBytes = await idbGetBlob('state_db');
      persistFn = async (bytes: Uint8Array) => {
        await idbPutBlob('state_db', bytes);
      };
    }

    const db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
    const conn = new SqlJsConnection(STATE_DB_NAME, db, false, persistFn);
    await conn.execute(createStateTablesSql, true);
    this.stateConn = conn;
  }

  public getCoreConnection(): SqliteConnection {
    if (!this.coreConn) {
      throw new Error('Core SQLite database is not initialized.');
    }
    return this.coreConn;
  }

  public getStateConnection(): SqliteConnection {
    if (!this.stateConn) {
      throw new Error('State SQLite database is not initialized.');
    }
    return this.stateConn;
  }

  public getPackConnection(lang: LanguageCode): SqliteConnection | null {
    return this.packConns.get(lang) || null;
  }

  public async openInstalledPack(lang: LanguageCode, filePathOrBlobKey: string, bytes?: Uint8Array): Promise<SqliteConnection> {
    const existing = this.packConns.get(lang);
    if (existing) {
      await existing.close();
      this.packConns.delete(lang);
    }

    if (isNativeAndroidOrIos()) {
      await CapacitorSQLite.createNCConnection({ databasePath: filePathOrBlobKey, version: 1 });
      await CapacitorSQLite.open({ database: filePathOrBlobKey, readonly: true });
      const conn = new CapacitorNativeConnection(filePathOrBlobKey, true, true);
      try {
        await conn.query('PRAGMA cache_size = -4000;');
        await conn.query('PRAGMA temp_store = FILE;');
      } catch {
        // Safe fallback
      }
      this.packConns.set(lang, conn);
      return conn;
    }

    const SQL = await getSqlJs();
    let packBytes = bytes || null;
    if (!packBytes) {
      if (isNodeRuntime()) {
        const fs = await import('node:fs');
        if (fs.existsSync(filePathOrBlobKey)) {
          packBytes = new Uint8Array(fs.readFileSync(filePathOrBlobKey));
        }
      } else {
        packBytes = await idbGetBlob(`pack_${lang}`);
      }
    }
    if (!packBytes) {
      throw new Error(`Pack binary not found for language: ${lang}`);
    }

    const db = new SQL.Database(packBytes);
    const conn = new SqlJsConnection(`pack_${lang}`, db, true);
    await conn.query('PRAGMA cache_size = -4000;');
    this.packConns.set(lang, conn);
    return conn;
  }

  public async verifyRawSqliteBytes(lang: LanguageCode, sqliteBytes: Uint8Array): Promise<{
    valid: boolean;
    entryCount: number;
    senseCount: number;
    translationCount: number;
    packVersion: string;
    schemaVersion: number;
    nativeTmpPath?: string;
  }> {
    if (isNativeAndroidOrIos()) {
      const tmpRelPath = `packs/lexica_pack_${lang}.tmpSQLite.db`;
      await Filesystem.mkdir({ path: 'packs', directory: Directory.Data, recursive: true }).catch(() => {});
      const base64 = uint8ArrayToBase64(sqliteBytes);
      await Filesystem.writeFile({
        path: tmpRelPath,
        data: base64,
        directory: Directory.Data,
      });
      const uriRes = await Filesystem.getUri({ path: tmpRelPath, directory: Directory.Data });
      const nativePath = uriRes.uri.replace(/^file:\/\//, '');

      try {
        await CapacitorSQLite.createNCConnection({ databasePath: nativePath, version: 1 });
        await CapacitorSQLite.open({ database: nativePath, readonly: true });
        const check = await CapacitorSQLite.query({
          database: nativePath,
          statement: 'PRAGMA quick_check;',
          values: [],
          readonly: true,
        });
        const qcFirstRow = check.values?.[0] as Record<string, unknown> | undefined;
        const qcVal = qcFirstRow ? qcFirstRow.quick_check ?? Object.values(qcFirstRow)[0] : '';
        const ok = String(qcVal ?? '').toLowerCase() === 'ok';
        const ftsCheck = await CapacitorSQLite.query({
          database: nativePath,
          statement: `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE name = 'entries_fts';`,
          values: [],
          readonly: true,
        });
        const hasFts = Number(ftsCheck.values?.[0]?.cnt ?? 0) === 1;
        const meta = await CapacitorSQLite.query({
          database: nativePath,
          statement: `SELECT pack_version, schema_version, entry_count, sense_count, translation_count FROM language_packs WHERE lang_code = ? LIMIT 1;`,
          values: [lang],
          readonly: true,
        });
        const row = meta.values?.[0];
        await CapacitorSQLite.closeNCConnection({ databasePath: nativePath }).catch(() => {});
        return {
          valid: ok && hasFts && Boolean(row),
          entryCount: Number(row?.entry_count ?? 0),
          senseCount: Number(row?.sense_count ?? 0),
          translationCount: Number(row?.translation_count ?? 0),
          packVersion: String(row?.pack_version ?? ''),
          schemaVersion: Number(row?.schema_version ?? 0),
          nativeTmpPath: tmpRelPath,
        };
      } catch (err) {
        await CapacitorSQLite.closeNCConnection({ databasePath: nativePath }).catch(() => {});
        await Filesystem.deleteFile({ path: tmpRelPath, directory: Directory.Data }).catch(() => {});
        throw err;
      }
    }

    const SQL = await getSqlJs();
    const db = new SQL.Database(sqliteBytes);
    try {
      const qc = db.exec('PRAGMA quick_check;');
      const ok = String(qc?.[0]?.values?.[0]?.[0] ?? '').toLowerCase() === 'ok';
      const ftsRes = db.exec(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'entries_fts';`);
      const hasFts = Number(ftsRes?.[0]?.values?.[0]?.[0] ?? 0) === 1;
      const metaRes = db.exec(
        `SELECT pack_version, schema_version, entry_count, sense_count, translation_count FROM language_packs WHERE lang_code = '${lang}' LIMIT 1;`
      );
      const vals = metaRes?.[0]?.values?.[0];
      return {
        valid: ok && hasFts && Boolean(vals),
        packVersion: String(vals?.[0] ?? ''),
        schemaVersion: Number(vals?.[1] ?? 0),
        entryCount: Number(vals?.[2] ?? 0),
        senseCount: Number(vals?.[3] ?? 0),
        translationCount: Number(vals?.[4] ?? 0),
      };
    } finally {
      db.close();
    }
  }

  public async closePack(lang: LanguageCode): Promise<void> {
    const conn = this.packConns.get(lang);
    if (conn) {
      await conn.close();
      this.packConns.delete(lang);
    }
  }

  public async closeAll(): Promise<void> {
    for (const [lang, conn] of this.packConns.entries()) {
      await conn.close();
      this.packConns.delete(lang);
    }
    if (this.coreConn) {
      await this.coreConn.close();
      this.coreConn = null;
    }
    if (this.stateConn) {
      await this.stateConn.close();
      this.stateConn = null;
    }
    this.initPromise = null;
  }
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export const sqliteManager = new SqliteManager();
