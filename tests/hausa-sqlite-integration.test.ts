import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

interface NodeSqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { lastInsertRowid?: number | bigint };
}

interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

type NodeSqliteCtor = new (path: string, opts?: { readOnly?: boolean }) => NodeSqliteDatabase;

const require = createRequire(import.meta.url);
let NodeDatabaseSync: NodeSqliteCtor | null = null;
if (process.env.LEXICA_TEST_FORCE_PY_SQLITE !== '1') {
  try {
    const mod = require('node:sqlite') as { DatabaseSync?: NodeSqliteCtor };
    if (mod?.DatabaseSync) {
      NodeDatabaseSync = mod.DatabaseSync;
    }
  } catch {
    NodeDatabaseSync = null;
  }
}

const PY_SQLITE_QUERY = `
import json, sqlite3, sys
payload = json.load(sys.stdin)
db_path = payload["dbPath"]
attach_path = payload.get("attachPath")
mode = payload.get("mode", "query")
sql_text = payload.get("sql", "").strip()
sql_upper = sql_text.upper()
if payload.get("readOnly"):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
else:
    conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
if attach_path:
    conn.execute("ATTACH DATABASE ? AS ext;", (attach_path,))
try:
    if mode == "exec":
        conn.executescript(sql_text)
        conn.commit()
        print(json.dumps({"ok": True}))
    elif sql_upper.startswith(("ATTACH", "DETACH")):
        cur = conn.execute(sql_text, payload.get("params", []))
        conn.commit()
        print(json.dumps({"rows": []}))
    elif mode == "run":
        cur = conn.execute(sql_text, payload.get("params", []))
        conn.commit()
        print(json.dumps({"lastInsertRowid": cur.lastrowid}))
    else:
        cur = conn.execute(sql_text, payload.get("params", []))
        rows = [dict(r) for r in cur.fetchall()]
        print(json.dumps({"rows": rows}))
finally:
    conn.close()
`;

function runPythonSqlite<T = unknown>(payload: Record<string, unknown>): T {
  const out = execFileSync('python3', ['-c', PY_SQLITE_QUERY], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(out) as T;
}

function createCompatDb(dbPath: string, readOnly = false, attachPath?: string | null): NodeSqliteDatabase {
  if (NodeDatabaseSync) {
    const db = new NodeDatabaseSync(dbPath, { readOnly });
    if (attachPath) {
      try {
        db.prepare('ATTACH DATABASE ? AS ext;').run(attachPath);
      } catch {
        // Ignore if already attached
      }
    }
    return db;
  }
  let trackedAttach: string | null = attachPath || null;
  return {
    exec(sql: string) {
      runPythonSqlite({ dbPath, readOnly, attachPath: trackedAttach, mode: 'exec', sql });
    },
    prepare(sql: string): NodeSqliteStatement {
      const upper = sql.trim().toUpperCase();
      return {
        all(...params: unknown[]) {
          if (upper.startsWith('ATTACH') && params[0]) {
            trackedAttach = String(params[0]);
            return [];
          }
          if (upper.startsWith('DETACH')) {
            trackedAttach = null;
            return [];
          }
          const res = runPythonSqlite<{ rows: unknown[] }>({
            dbPath,
            readOnly,
            attachPath: trackedAttach,
            mode: 'query',
            sql,
            params,
          });
          return res.rows;
        },
        run(...params: unknown[]) {
          if (upper.startsWith('ATTACH') && params[0]) {
            trackedAttach = String(params[0]);
            return {};
          }
          if (upper.startsWith('DETACH')) {
            trackedAttach = null;
            return {};
          }
          const res = runPythonSqlite<{ lastInsertRowid: number }>({
            dbPath,
            readOnly,
            attachPath: trackedAttach,
            mode: 'run',
            sql,
            params,
          });
          return { lastInsertRowid: res.lastInsertRowid };
        },
      };
    },
    close() {},
  };
}

import {
  HAUSA_PACK_MANIFEST,
  validateHausaPackManifest,
} from '../src/config/hausaDictionaryConfig';
import {
  hausaPackService,
  HausaPackInstallError,
  type HausaPackInstallerNative,
} from '../src/services/hausaPackService';
import { hausaSqliteRepo } from '../src/services/hausaSqliteRepository';
import { type SqlQueryExecutor } from '../src/services/englishSqliteRepository';
import { searchHausaStandardUnified } from '../src/services/hausaSearchCoordinator';
import { dictionaryDb } from '../src/services/dictionaryDatabase';

class NodeSqliteExecutor implements SqlQueryExecutor {
  private db: NodeSqliteDatabase | null = null;
  private dbPath: string | null = null;

  constructor(private readonly defaultPath: string) {
    this.dbPath = defaultPath;
  }

  public isOpen(): boolean {
    return this.db !== null;
  }

  public getDbPath(): string | null {
    return this.dbPath;
  }

  public async open(dbPath: string): Promise<void> {
    if (this.db && this.dbPath === dbPath) return;
    await this.close();
    this.db = createCompatDb(dbPath, true);
    this.dbPath = dbPath;
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public async query<T = Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    if (!this.db) {
      await this.open(this.dbPath || '');
    }
    if (!this.db) throw new Error('NodeSqliteExecutor database is not open.');
    const stmt = this.db.prepare(statement);
    const params = values.map((v) => {
      if (v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as string | number | bigint | Uint8Array | null;
    });
    const trimmed = statement.trim().toUpperCase();
    if (trimmed.startsWith('ATTACH') || trimmed.startsWith('DETACH')) {
      if (typeof stmt.run === 'function') {
        stmt.run(...params);
      } else {
        stmt.all(...params);
      }
      return [] as T[];
    }
    return stmt.all(...params) as T[];
  }
}

function createHausaTestDatabase(corePath: string, extPath: string): void {
  if (fs.existsSync(corePath)) fs.unlinkSync(corePath);
  if (fs.existsSync(extPath)) fs.unlinkSync(extPath);

  const coreDb = createCompatDb(corePath, false);
  coreDb.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      license TEXT NOT NULL,
      attribution_text TEXT NOT NULL,
      source_url TEXT NOT NULL,
      dataset_version TEXT NOT NULL
    );
    CREATE TABLE parts_of_speech (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      headword TEXT NOT NULL,
      headword_lower TEXT NOT NULL,
      headword_norm TEXT,
      pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
      primary_ipa TEXT,
      primary_definition TEXT NOT NULL,
      source_id INTEGER NOT NULL REFERENCES sources(id)
    );
    CREATE TABLE word_forms (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id),
      form TEXT NOT NULL,
      form_norm TEXT
    );
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      headword,
      primary_definition,
      content='',
      detail=none,
      tokenize = 'unicode61 remove_diacritics 1'
    );

    INSERT INTO metadata VALUES ('schema_version', '3');
    INSERT INTO metadata VALUES ('pack_layer', 'core');
    INSERT INTO metadata VALUES ('pack_version', '0.4.0-core');
    INSERT INTO metadata VALUES ('dataset_version', '2026.11-wiktionary-ha-test');
    INSERT INTO metadata VALUES ('accepted_entries', '4');
    INSERT INTO metadata VALUES ('distinct_headwords', '4');
    INSERT INTO metadata VALUES ('total_senses', '5');
    INSERT INTO metadata VALUES ('core_primary_senses', '4');
    INSERT INTO metadata VALUES ('total_word_forms', '5');

    INSERT INTO sources VALUES (
      1, 'kaikki-ha-wiktionary', 'Hausa Wiktionary via Kaikki.org & Lexica Curation',
      'CC BY-SA 4.0 & GFDL', 'Copyright Wikimedia Contributors and Tatu Ylonen.',
      'https://kaikki.org/dictionary/Hausa/', '2026.11-wiktionary-ha-test'
    );

    INSERT INTO parts_of_speech (id, name) VALUES (1, 'noun');
    INSERT INTO parts_of_speech (id, name) VALUES (2, 'interjection');

    INSERT INTO entries (id, headword, headword_lower, headword_norm, pos_id, primary_ipa, primary_definition, source_id)
    VALUES (1, 'ruwa', 'ruwa', NULL, 1, '[rúwá:]', 'Water; liquid substance essential for life.', 1);
    INSERT INTO entries (id, headword, headword_lower, headword_norm, pos_id, primary_ipa, primary_definition, source_id)
    VALUES (2, 'ƙofa', 'ƙofa', 'kofa', 1, '[kó.fá:]', 'Door, gateway or entrance to a room or enclosure.', 1);
    INSERT INTO entries (id, headword, headword_lower, headword_norm, pos_id, primary_ipa, primary_definition, source_id)
    VALUES (3, 'sannu', 'sannu', NULL, 2, '[sán.nú:]', 'Hello, greetings, well done or slow down.', 1);
    INSERT INTO entries (id, headword, headword_lower, headword_norm, pos_id, primary_ipa, primary_definition, source_id)
    VALUES (4, 'ɓarka', 'ɓarka', 'barka', 1, '[ɓár.kàː]', 'Blessing, congratulations or well-wishing.', 1);

    INSERT INTO word_forms (id, entry_id, form, form_norm) VALUES (1, 1, 'ruwaye', NULL);
    INSERT INTO word_forms (id, entry_id, form, form_norm) VALUES (2, 1, 'ruwan', NULL);
    INSERT INTO word_forms (id, entry_id, form, form_norm) VALUES (3, 2, 'ƙofofi', 'kofofi');
    INSERT INTO word_forms (id, entry_id, form, form_norm) VALUES (4, 3, 'sannuna', NULL);
    INSERT INTO word_forms (id, entry_id, form, form_norm) VALUES (5, 4, 'ɓarkoni', 'barkoni');

    INSERT INTO entries_fts(rowid, headword, primary_definition) VALUES (1, 'ruwa', 'Water; liquid substance essential for life.');
    INSERT INTO entries_fts(rowid, headword, primary_definition) VALUES (2, 'ƙofa', 'Door, gateway or entrance to a room or enclosure.');
    INSERT INTO entries_fts(rowid, headword, primary_definition) VALUES (3, 'sannu', 'Hello, greetings, well done or slow down.');
    INSERT INTO entries_fts(rowid, headword, primary_definition) VALUES (4, 'ɓarka', 'Blessing, congratulations or well-wishing.');

    CREATE INDEX idx_entries_lower ON entries(headword_lower);
    CREATE INDEX idx_entries_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;
    CREATE INDEX idx_word_forms_form ON word_forms(form);
    CREATE INDEX idx_word_forms_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;
  `);
  coreDb.close();

  const extDb = createCompatDb(extPath, false);
  const sampleExamples = JSON.stringify(['Ruwan ya shiga ɗaki.']);
  const sampleSynonyms = JSON.stringify(['ruwan sha']);
  const sampleIpas = JSON.stringify(['[rúwá:]', '[rwá:]']);
  extDb.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE senses_ext (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      sense_number INTEGER NOT NULL,
      definition TEXT,
      examples TEXT,
      synonyms TEXT,
      antonyms TEXT
    );
    CREATE TABLE entry_extensions (
      entry_id INTEGER PRIMARY KEY,
      all_ipas TEXT,
      etymology TEXT
    );

    INSERT INTO metadata VALUES ('schema_version', '3');
    INSERT INTO metadata VALUES ('pack_layer', 'extended');
    INSERT INTO metadata VALUES ('pack_version', '0.4.0-extended');

    INSERT INTO senses_ext (id, entry_id, sense_number, definition, examples, synonyms, antonyms)
    VALUES (1, 1, 1, 'Water; liquid substance essential for life.', '${sampleExamples}', '${sampleSynonyms}', '[]');
    INSERT INTO senses_ext (id, entry_id, sense_number, definition, examples, synonyms, antonyms)
    VALUES (2, 1, 2, 'Rainfall or meteorological precipitation.', '[]', '[]', '[]');

    INSERT INTO entry_extensions (entry_id, all_ipas, etymology)
    VALUES (1, '${sampleIpas}', 'From Proto-Chadic *rəw-');
  `);
  extDb.close();
}

async function main() {
  console.log('\n==============================================================');
  console.log('LEXICA HAUSA SQLITE INTEGRATION & FAILURE MODE TEST SUITE');
  console.log('==============================================================\n');

  let passed = 0;
  let total = 0;

  async function runAsyncTest(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✅ PASS: ${name}`);
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  const tmpCorePath = path.join(os.tmpdir(), `lexica_hausa_core_test_${process.pid}.db`);
  const tmpExtPath = path.join(os.tmpdir(), `lexica_hausa_ext_test_${process.pid}.db`);
  createHausaTestDatabase(tmpCorePath, tmpExtPath);

  try {
    await runAsyncTest('H.1 Manifest validation accepts valid v0.4.0-core manifest & rejects tampered manifest', async () => {
      const res = validateHausaPackManifest(HAUSA_PACK_MANIFEST);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(HAUSA_PACK_MANIFEST.targetLanguage, 'ha');
      assert.strictEqual(HAUSA_PACK_MANIFEST.acceptedEntries, 2260);
      assert.strictEqual(HAUSA_PACK_MANIFEST.schemaVersion, 3);
      assert.strictEqual(HAUSA_PACK_MANIFEST.extendedCompanion?.autoDownload, false);

      const badRes = validateHausaPackManifest({
        packId: 'ha-wiktionary-sqlite',
        downloadUrl: 'http://insecure.example/db.gz',
        compressedSha256: 'bad-sha',
      });
      assert.strictEqual(badRes.valid, false);
      assert(badRes.missingOrInvalidFields.includes('downloadUrl'));
      assert(badRes.missingOrInvalidFields.includes('compressedSha256'));
    });

    await runAsyncTest('H.2 Core standalone query, hooked consonants (ƙ, ɓ), tones, forms & FTS5', async () => {
      hausaPackService.resetTestingOverrides();
      const exec = new NodeSqliteExecutor(tmpCorePath);
      await exec.open(tmpCorePath);
      hausaSqliteRepo._injectExecutor(exec);

      // Exact headword lookup (case-insensitive)
      const ruwa = await searchHausaStandardUnified('RUWA');
      assert.strictEqual(ruwa.status, 'ok');
      assert.strictEqual(ruwa.engineSource, 'sqlite-ha');
      assert.strictEqual(ruwa.results[0].entry.headword, 'ruwa');
      assert.strictEqual(ruwa.results[0].entry.isCoreOnly, true);
      assert.strictEqual(ruwa.results[0].entry.extendedInstalled, false);
      assert.strictEqual(ruwa.results[0].senses.length, 1);

      // Hooked consonant ASCII fallback: 'kofa' -> 'ƙofa' & 'barka' -> 'ɓarka'
      const kofaNorm = await searchHausaStandardUnified('kofa');
      assert.strictEqual(kofaNorm.status, 'ok');
      assert.strictEqual(kofaNorm.results[0].entry.headword, 'ƙofa');
      assert.strictEqual(kofaNorm.results[0].matchedField, 'headword-normalized');

      const barkaNorm = await searchHausaStandardUnified('barka');
      assert.strictEqual(barkaNorm.status, 'ok');
      assert.strictEqual(barkaNorm.results[0].entry.headword, 'ɓarka');

      // Exact hooked consonant lookup
      const kofaExact = await searchHausaStandardUnified('ƙofa');
      assert.strictEqual(kofaExact.status, 'ok');
      assert.strictEqual(kofaExact.results[0].entry.headword, 'ƙofa');
      assert.strictEqual(kofaExact.results[0].matchedField, 'headword-exact');

      // Prefix lookup
      const pref = await searchHausaStandardUnified('san');
      assert.strictEqual(pref.status, 'ok');
      assert(pref.results.some((r) => r.entry.headword === 'sannu'));

      // Morphology / inflected form lookup (exact & ASCII-normalized)
      const form = await searchHausaStandardUnified('ruwan');
      assert.strictEqual(form.status, 'ok');
      assert.strictEqual(form.results[0].matchedField, 'morphology');
      assert.strictEqual(form.results[0].entry.headword, 'ruwa');

      const formHooked = await searchHausaStandardUnified('kofofi');
      assert.strictEqual(formHooked.status, 'ok');
      assert.strictEqual(formHooked.results[0].matchedField, 'morphology');
      assert.strictEqual(formHooked.results[0].entry.headword, 'ƙofa');

      // FTS5 definition search
      const fts = await searchHausaStandardUnified('essential life');
      assert.strictEqual(fts.status, 'ok');
      assert.strictEqual(fts.results[0].matchedField, 'definition');
      assert.strictEqual(fts.results[0].entry.headword, 'ruwa');
    });

    await runAsyncTest('H.3 Bounded pagination & close/reopen persistence across sessions', async () => {
      const page1 = await searchHausaStandardUnified('', { limit: 2, offset: 0 });
      assert.strictEqual(page1.status, 'ok');
      assert.strictEqual(page1.results.length, 2);
      assert.strictEqual(page1.totalCount, 4);
      assert.strictEqual(page1.hasMore, true);

      const page2 = await searchHausaStandardUnified('', { limit: 2, offset: 2 });
      assert.strictEqual(page2.status, 'ok');
      assert.strictEqual(page2.results.length, 2);
      assert.strictEqual(page2.hasMore, false);

      const ids1 = new Set(page1.results.map((r) => r.entry.id));
      for (const r of page2.results) {
        assert(!ids1.has(r.entry.id), 'Paginated pages must be strictly disjoint');
      }

      // Simulate app restart / DB close & reopen
      await hausaSqliteRepo.closeConnection();
      hausaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return {
              installed: true,
              dbPath: tmpCorePath,
              dbSizeBytes: fs.statSync(tmpCorePath).size,
              partialBytes: 0,
              availableBytes: 1_500_000_000,
              inProgress: false,
              datasetVersion: HAUSA_PACK_MANIFEST.packVersion,
              schemaVersion: 3,
              packLayer: 'core',
              acceptedEntries: 4,
              distinctHeadwords: 4,
              totalSenses: 5,
              corePrimarySenses: 4,
              totalWordForms: 5,
              extendedInstalled: false,
              extendedDbPath: '',
              extendedDbSizeBytes: 0,
            };
          },
          async installPack() { return { installed: true }; },
          async cancelInstall() { return { cancelled: true }; },
          async removePack() { return { removed: true, availableBytes: 1_500_000_000 }; },
          async verifyInstalledPack() { return { installed: true }; },
          async getMemoryMetrics() {
            return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
          },
          async addListener() { return { remove: async () => {} }; },
        },
      });
      await hausaPackService.refreshStatus();

      const afterRestart = await searchHausaStandardUnified('sannu');
      assert.strictEqual(afterRestart.status, 'ok');
      assert.strictEqual(afterRestart.results[0].entry.headword, 'sannu');
    });

    await runAsyncTest('H.4 Optional Extended DB attachment enriches Hausa Core seamlessly and detaches cleanly', async () => {
      const exec = new NodeSqliteExecutor(tmpCorePath);
      await exec.open(tmpCorePath);
      hausaSqliteRepo._injectExecutor(exec);
      hausaSqliteRepo._injectExtendedDbPathForTest(tmpExtPath);

      const ruwaExt = await searchHausaStandardUnified('ruwa');
      assert.strictEqual(ruwaExt.status, 'ok');
      assert.strictEqual(ruwaExt.results[0].entry.isCoreOnly, false);
      assert.strictEqual(ruwaExt.results[0].entry.extendedInstalled, true);
      assert.strictEqual(ruwaExt.results[0].senses.length, 2, 'Secondary senses loaded from Extended DB');
      assert.strictEqual(ruwaExt.results[0].entry.allIpas?.length, 2, 'Dialect IPAs loaded from Extended DB');
      assert.strictEqual(ruwaExt.results[0].entry.etymology, 'From Proto-Chadic *rəw-');
      assert.strictEqual(ruwaExt.results[0].senses[0].examples[0]?.sourceText, 'Ruwan ya shiga ɗaki.');

      // Detach Extended -> Core stays fully operational offline
      hausaSqliteRepo._injectExtendedDbPathForTest(null);
      await hausaSqliteRepo.closeConnection();
      await exec.open(tmpCorePath);
      const ruwaCoreAgain = await searchHausaStandardUnified('ruwa');
      assert.strictEqual(ruwaCoreAgain.status, 'ok');
      assert.strictEqual(ruwaCoreAgain.results[0].entry.isCoreOnly, true);
      assert.strictEqual(ruwaCoreAgain.results[0].entry.extendedInstalled, false);
      assert.strictEqual(ruwaCoreAgain.results[0].senses.length, 1);
    });

    await runAsyncTest('H.5 Installer lifecycle: duplicate download guard, interrupted/checksum failure recovery & starter corpus isolation', async () => {
      hausaPackService.resetTestingOverrides();
      let installAttempts = 0;

      hausaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return {
              installed: true,
              dbPath: tmpCorePath,
              dbSizeBytes: HAUSA_PACK_MANIFEST.uncompressedSizeBytes,
              partialBytes: 0,
              availableBytes: 1_500_000_000,
              inProgress: false,
              datasetVersion: HAUSA_PACK_MANIFEST.packVersion,
              schemaVersion: 3,
              packLayer: 'core',
              acceptedEntries: HAUSA_PACK_MANIFEST.acceptedEntries,
              distinctHeadwords: HAUSA_PACK_MANIFEST.distinctHeadwords,
              totalSenses: HAUSA_PACK_MANIFEST.totalSenses,
              corePrimarySenses: HAUSA_PACK_MANIFEST.corePrimarySenses,
              totalWordForms: HAUSA_PACK_MANIFEST.totalWordForms,
              extendedInstalled: false,
              extendedDbPath: '',
              extendedDbSizeBytes: 0,
            };
          },
          async installPack() {
            installAttempts++;
            return { installed: true };
          },
          async cancelInstall() { return { cancelled: true }; },
          async removePack() { return { removed: true, availableBytes: 1_500_000_000 }; },
          async verifyInstalledPack() {
            return {
              installed: true,
              dbPath: tmpCorePath,
              dbSizeBytes: HAUSA_PACK_MANIFEST.uncompressedSizeBytes,
              datasetVersion: HAUSA_PACK_MANIFEST.packVersion,
              acceptedEntries: HAUSA_PACK_MANIFEST.acceptedEntries,
            };
          },
          async getMemoryMetrics() {
            return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
          },
          async addListener() { return { remove: async () => {} }; },
        },
      });

      const status = await hausaPackService.refreshStatus();
      assert.strictEqual(status.packLayer, 'core');
      assert.strictEqual(status.schemaVersion, 3);
      assert.strictEqual(status.acceptedEntries, 2260);
      assert.strictEqual(status.extendedInstalled, false);

      // Duplicate install guard skips network call
      const installCheck = await hausaPackService.installHausaPack();
      assert.strictEqual(installCheck.alreadyInstalled, true);
      assert.strictEqual(installAttempts, 0, 'Duplicate install must make 0 native download calls');

      // Simulated interrupted / checksum failure preserves error cleanly
      hausaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return { installed: false, dbPath: '', dbSizeBytes: 0, partialBytes: 131072, availableBytes: 500_000_000, inProgress: false };
          },
          async installPack() {
            throw new Error('CHECKSUM_MISMATCH_COMPRESSED: SHA-256 verification failed');
          },
          async cancelInstall() { return { cancelled: true }; },
          async removePack() { return { removed: true, availableBytes: 500_000_000 }; },
          async verifyInstalledPack() { throw new Error('NOT_INSTALLED'); },
          async getMemoryMetrics() {
            return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
          },
          async addListener() { return { remove: async () => {} }; },
        },
      });
      await hausaPackService.refreshStatus();
      await assert.rejects(
        () => hausaPackService.installHausaPack(),
        (err: unknown) => err instanceof HausaPackInstallError && err.code === 'INSTALL_FAILED'
      );

      // Android uninstalled state returns explicit language_not_installed
      hausaSqliteRepo._injectExecutor(null);
      const uninstalled = await searchHausaStandardUnified('ruwa');
      assert.strictEqual(uninstalled.status, 'language_not_installed');
      assert.strictEqual(uninstalled.engineSource, 'sqlite-ha');

      // Other bundled starter packs remain 100% functional
      const yoRes = dictionaryDb.searchStandard('omi', 'yo');
      assert.strictEqual(yoRes.status, 'ok');
      const enHaMulti = dictionaryDb.searchMultilingual('water', 'en', 'ha');
      assert.strictEqual(enHaMulti.status, 'ok');
    });

    // H.6: Verify real built artifacts if present in /tmp/hausa_core_v040
    const builtCorePath = '/tmp/hausa_core_v040/lexica_hausa_core.db';
    const builtExtPath = '/tmp/hausa_core_v040/lexica_hausa_extended.db';
    if (fs.existsSync(builtCorePath)) {
      await runAsyncTest('H.6 Full built Hausa Core & Extended SQLite DB verification (2,260 entries)', async () => {
        const db = createCompatDb(builtCorePath, true);
        const qc = db.prepare('PRAGMA quick_check;').all() as Array<Record<string, string>>;
        assert.strictEqual(Object.values(qc[0])[0], 'ok');

        const counts = db.prepare('SELECT COUNT(*) AS cnt FROM entries;').all() as Array<{ cnt: number }>;
        assert.strictEqual(counts[0].cnt, 2260);

        const missingDefs = db.prepare("SELECT COUNT(*) AS cnt FROM entries WHERE primary_definition IS NULL OR length(trim(primary_definition)) = 0;").all() as Array<{ cnt: number }>;
        assert.strictEqual(missingDefs[0].cnt, 0);

        const wfCounts = db.prepare('SELECT COUNT(*) AS cnt FROM word_forms;').all() as Array<{ cnt: number }>;
        assert.strictEqual(wfCounts[0].cnt, 4502);
        db.close();

        // Query real DB through HausaSqliteRepository
        const exec = new NodeSqliteExecutor(builtCorePath);
        await exec.open(builtCorePath);
        hausaSqliteRepo._injectExecutor(exec);
        hausaSqliteRepo._injectExtendedDbPathForTest(fs.existsSync(builtExtPath) ? builtExtPath : null);

        const realKofa = await searchHausaStandardUnified('kofa');
        assert.strictEqual(realKofa.status, 'ok');
        assert(realKofa.results.some((r) => r.entry.headword.toLowerCase() === 'ƙofa'));

        const realRuwa = await searchHausaStandardUnified('ruwa');
        assert.strictEqual(realRuwa.status, 'ok');
        assert(realRuwa.results[0].senses.length >= 1);

        const bench = await hausaSqliteRepo.runBenchmark();
        assert.strictEqual(bench.totalEntriesVerified, 2260);
        assert(bench.exactHeadwordMs >= 0);

        await hausaSqliteRepo.closeConnection();
      });
    }
  } finally {
    hausaSqliteRepo._injectExecutor(null);
    hausaSqliteRepo._injectExtendedDbPathForTest(null);
    hausaPackService.resetTestingOverrides();
    if (fs.existsSync(tmpCorePath)) fs.unlinkSync(tmpCorePath);
    if (fs.existsSync(tmpExtPath)) fs.unlinkSync(tmpExtPath);
  }

  console.log('\n==============================================================');
  console.log(`HAUSA SQLITE INTEGRATION RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('==============================================================\n');
}

void main();
