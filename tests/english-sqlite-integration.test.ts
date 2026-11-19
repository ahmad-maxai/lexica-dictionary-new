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
mode = payload.get("mode", "query")
if payload.get("readOnly"):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
else:
    conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
try:
    if mode == "exec":
        conn.executescript(payload["sql"])
        conn.commit()
        print(json.dumps({"ok": True}))
    elif mode == "run":
        cur = conn.execute(payload["sql"], payload.get("params", []))
        conn.commit()
        print(json.dumps({"lastInsertRowid": cur.lastrowid}))
    else:
        cur = conn.execute(payload["sql"], payload.get("params", []))
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

function createCompatDb(dbPath: string, readOnly = false): NodeSqliteDatabase {
  if (NodeDatabaseSync) {
    return new NodeDatabaseSync(dbPath, { readOnly });
  }
  return {
    exec(sql: string) {
      runPythonSqlite({ dbPath, readOnly, mode: 'exec', sql });
    },
    prepare(sql: string): NodeSqliteStatement {
      return {
        all(...params: unknown[]) {
          const res = runPythonSqlite<{ rows: unknown[] }>({ dbPath, readOnly, mode: 'query', sql, params });
          return res.rows;
        },
        run(...params: unknown[]) {
          const res = runPythonSqlite<{ lastInsertRowid: number }>({ dbPath, readOnly, mode: 'run', sql, params });
          return { lastInsertRowid: res.lastInsertRowid };
        },
      };
    },
    close() {},
  };
}
import {
  ENGLISH_PACK_MANIFEST,
  setEnglishSqliteIntegrationEnabled,
} from '../src/config/englishDictionaryConfig';
import { dictionaryDb } from '../src/services/dictionaryDatabase';
import {
  englishPackService,
  EnglishPackInstallError,
  type EnglishPackInstallerNative,
} from '../src/services/englishPackService';
import {
  englishSqliteRepo,
  type SqlQueryExecutor,
} from '../src/services/englishSqliteRepository';
import { searchEnglishStandardUnified } from '../src/services/englishSearchCoordinator';

let passed = 0;
let total = 0;

async function runAsyncTest(name: string, fn: () => Promise<void>): Promise<void> {
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
    if (!this.db) throw new Error('NodeSqliteExecutor database is not open.');
    const stmt = this.db.prepare(statement);
    const params = values.map((v) => {
      if (v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as string | number | bigint | Uint8Array | null;
    });
    return stmt.all(...params) as T[];
  }
}

function createFixtureEnglishSqliteDb(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const db = createCompatDb(filePath, false);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE sources (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, license TEXT NOT NULL,
      attribution_text TEXT NOT NULL, source_url TEXT NOT NULL, dataset_version TEXT NOT NULL
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headword TEXT NOT NULL, headword_lower TEXT NOT NULL, part_of_speech TEXT NOT NULL,
      primary_ipa TEXT, all_ipas TEXT, audio_file TEXT, etymology TEXT,
      source_id TEXT NOT NULL REFERENCES sources(id)
    );
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      sense_number INTEGER NOT NULL, definition TEXT NOT NULL,
      tags TEXT, examples TEXT, synonyms TEXT, antonyms TEXT
    );
    CREATE TABLE word_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      form TEXT NOT NULL, form_lower TEXT NOT NULL, tags TEXT
    );
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      entry_id UNINDEXED, headword, headword_lower, part_of_speech, definitions_text,
      tokenize = 'unicode61 remove_diacritics 1'
    );
    CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);
    CREATE INDEX idx_word_forms_lower ON word_forms(form_lower);
  `);

  db.prepare(
    `INSERT INTO sources (id, name, license, attribution_text, source_url, dataset_version)
     VALUES (?, ?, ?, ?, ?, ?);`
  ).run(
    'src-kaikki-enwiktionary',
    ENGLISH_PACK_MANIFEST.attribution.sourceName,
    ENGLISH_PACK_MANIFEST.attribution.license,
    ENGLISH_PACK_MANIFEST.attribution.attributionText,
    ENGLISH_PACK_MANIFEST.attribution.sourceUrl,
    ENGLISH_PACK_MANIFEST.datasetVersion
  );

  const fixtureEntries = [
    {
      headword: 'epistemology',
      pos: 'noun',
      primaryIpa: '/ɪˌpɪstəˈmɒləd͡ʒi/',
      allIpas: [
        { ipa: '/ɪˌpɪstəˈmɒləd͡ʒi/', tags: ['UK'] },
        { ipa: '/ɪˌpɪstəˈmɑləd͡ʒi/', tags: ['US'] },
      ],
      etymology: 'From Ancient Greek ἐπιστήμη (epistḗmē, “knowledge”) + -logy.',
      senses: [
        {
          def: 'The branch of philosophy studying the nature, origin, and limits of human knowledge.',
          examples: [{ text: 'Epistemology asks how justified belief differs from opinion.', ref: 'Philosophy Text' }],
          synonyms: ['theory of knowledge'],
        },
      ],
      forms: [{ form: 'epistemologies', tags: ['plural'] }],
    },
    {
      headword: 'epistemological',
      pos: 'adj',
      primaryIpa: '/ɪˌpɪstəməˈlɒdʒɪkəl/',
      allIpas: [{ ipa: '/ɪˌpɪstəməˈlɒdʒɪkəl/', tags: ['Received-Pronunciation'] }],
      etymology: null,
      senses: [{ def: 'Of or pertaining to epistemology.', examples: [], synonyms: [] }],
      forms: [],
    },
    {
      headword: 'light',
      pos: 'noun',
      primaryIpa: '[laɪt]',
      allIpas: [
        { ipa: '[laɪt]', tags: ['Received-Pronunciation'] },
        { ipa: '[ɫɐɪt]', tags: ['General-American'] },
        { ipa: '[ləjt]', tags: ['Canada', 'US', 'regional'] },
      ],
      etymology: 'From Old English lēoht.',
      senses: [
        {
          def: 'Visible electromagnetic radiation enabling sight.',
          examples: [{ text: 'Morning light filled the courtyard.', ref: '' }],
          synonyms: ['illumination', 'radiance'],
        },
        {
          def: 'A source of illumination such as a lamp or lantern.',
          examples: [],
          synonyms: ['lamp'],
        },
      ],
      forms: [{ form: 'lights', tags: ['plural'] }],
    },
    {
      headword: 'light',
      pos: 'adj',
      primaryIpa: '[laɪt]',
      allIpas: [{ ipa: '[laɪt]', tags: ['Received-Pronunciation'] }],
      etymology: null,
      senses: [{ def: 'Having little weight; not heavy.', examples: [], synonyms: ['weightless'] }],
      forms: [{ form: 'lighter', tags: ['comparative'] }, { form: 'lightest', tags: ['superlative'] }],
    },
    {
      headword: 'run',
      pos: 'verb',
      primaryIpa: '/ɹʌn/',
      allIpas: [
        { ipa: '/ɹʌn/', tags: ['General-American', 'Received-Pronunciation'] },
        { ipa: '/ɹʊn/', tags: ['Northern-England'] },
      ],
      etymology: null,
      senses: [
        { def: 'To move swiftly on foot.', examples: [{ text: 'They run every dawn.', ref: '' }], synonyms: ['sprint'] },
      ],
      forms: [{ form: 'running', tags: ['participle'] }, { form: 'ran', tags: ['past'] }],
    },
    {
      headword: 'run',
      pos: 'noun',
      primaryIpa: '/ɹʌn/',
      allIpas: [{ ipa: '/ɹʌn/', tags: ['General-American', 'Received-Pronunciation'] }],
      etymology: null,
      senses: [{ def: 'An act or spell of running.', examples: [], synonyms: ['jog'] }],
      forms: [{ form: 'runs', tags: ['plural'] }],
    },
    {
      headword: 'photosynthesis',
      pos: 'noun',
      primaryIpa: '/ˌfəʊ.təʊˈsɪn.θə.sɪs/',
      allIpas: [
        { ipa: '/ˌfəʊ.təʊˈsɪn.θə.sɪs/', tags: ['UK'] },
        { ipa: '/ˌfoʊ.toʊˈsɪn.θə.sɪs/', tags: ['US'] },
      ],
      etymology: null,
      senses: [{ def: 'The process by which green plants convert sunlight into chemical energy.', examples: [], synonyms: [] }],
      forms: [],
    },
    {
      headword: 'serendipity',
      pos: 'noun',
      primaryIpa: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/',
      allIpas: [{ ipa: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', tags: ['UK'] }],
      etymology: null,
      senses: [{ def: 'The occurrence of fortunate discoveries by chance.', examples: [], synonyms: [] }],
      forms: [],
    },
    {
      headword: 'ubiquitous',
      pos: 'adj',
      primaryIpa: '/juːˈbɪkwɪtəs/',
      allIpas: [{ ipa: '/juːˈbɪkwɪtəs/', tags: ['Received-Pronunciation'] }],
      etymology: null,
      senses: [{ def: 'Being present everywhere at once.', examples: [], synonyms: ['omnipresent'] }],
      forms: [],
    },
    {
      headword: 'dictionary',
      pos: 'noun',
      primaryIpa: '/ˈdɪk.ʃə.nə.ɹi/',
      allIpas: [
        { ipa: '/ˈdɪk.ʃə.nə.ɹi/', tags: ['Received-Pronunciation'] },
        { ipa: '/ˈdɪk.ʃəˌnɛ.ɹi/', tags: ['US'] },
      ],
      etymology: null,
      senses: [{ def: 'A reference work listing words and their meanings.', examples: [], synonyms: ['lexicon'] }],
      forms: [{ form: 'dictionaries', tags: ['plural'] }],
    },
  ];

  const insertEntry = db.prepare(
    `INSERT INTO entries (headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology, source_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?);`
  );
  const insertSense = db.prepare(
    `INSERT INTO senses (entry_id, sense_number, definition, tags, examples, synonyms, antonyms)
     VALUES (?, ?, ?, NULL, ?, ?, NULL);`
  );
  const insertForm = db.prepare(
    `INSERT INTO word_forms (entry_id, form, form_lower, tags) VALUES (?, ?, ?, ?);`
  );
  const insertFts = db.prepare(
    `INSERT INTO entries_fts (entry_id, headword, headword_lower, part_of_speech, definitions_text)
     VALUES (?, ?, ?, ?, ?);`
  );

  let totalSenses = 0;
  for (const item of fixtureEntries) {
    const res = insertEntry.run(
      item.headword,
      item.headword.toLowerCase(),
      item.pos,
      item.primaryIpa,
      JSON.stringify(item.allIpas),
      item.etymology,
      'src-kaikki-enwiktionary'
    );
    const entryId = Number(res.lastInsertRowid);
    item.senses.forEach((s, idx) => {
      totalSenses++;
      insertSense.run(
        entryId,
        idx + 1,
        s.def,
        s.examples.length ? JSON.stringify(s.examples) : null,
        s.synonyms.length ? JSON.stringify(s.synonyms) : null
      );
    });
    for (const f of item.forms) {
      insertForm.run(entryId, f.form, f.form.toLowerCase(), JSON.stringify(f.tags));
    }
    insertFts.run(
      entryId,
      item.headword,
      item.headword.toLowerCase(),
      item.pos,
      item.senses.map((s) => s.def).join(' | ')
    );
  }

  const metaInsert = db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?);`);
  metaInsert.run('dataset_name', 'Lexica English Test Fixture');
  metaInsert.run('pack_version', '0.2.0');
  metaInsert.run('accepted_entries', String(fixtureEntries.length));
  metaInsert.run('distinct_headwords', '8');
  metaInsert.run('total_senses', String(totalSenses));
  metaInsert.run('source_license', ENGLISH_PACK_MANIFEST.attribution.license);
  metaInsert.run('source_attribution', ENGLISH_PACK_MANIFEST.attribution.attributionText);

  db.close();
}

async function main(): Promise<void> {
  console.log('\n==============================================================');
  console.log('LEXICA ENGLISH SQLITE INTEGRATION & FAILURE MODE TEST SUITE');
  console.log('==============================================================\n');

  const tmpDbPath = path.join(os.tmpdir(), `lexica_en_test_${process.pid}.db`);
  createFixtureEnglishSqliteDb(tmpDbPath);

  try {
    const exec = new NodeSqliteExecutor(tmpDbPath);
    englishSqliteRepo.setExecutorForTest(exec);
    setEnglishSqliteIntegrationEnabled(true);

    await runAsyncTest('4.1 Exact, case-insensitive, multi-POS & RP/GA IPA lookup via SQLite repo', async () => {
      const light = await searchEnglishStandardUnified('LIGHT');
      assert.strictEqual(light.status, 'ok');
      assert.strictEqual(light.engineSource, 'sqlite-en');
      assert.strictEqual(light.results.length, 2, 'Expected noun + adj entries for light');
      assert.strictEqual(light.results[0].entry.ipa, '[laɪt]', 'Expected RP primary IPA for light');
      assert.strictEqual(light.results[0].entry.allIpas?.length, 3, 'All dialect IPAs preserved');
      assert.strictEqual(light.results[0].senses.length, 2, 'Multiple senses preserved');

      const adjOnly = await searchEnglishStandardUnified('light', { partOfSpeech: 'adjective' });
      assert.strictEqual(adjOnly.results.length, 1);
      assert.strictEqual(adjOnly.results[0].entry.partOfSpeech, 'adj');
    });

    await runAsyncTest('4.2 Prefix, inflected word_forms & FTS5 definition search', async () => {
      const prefix = await searchEnglishStandardUnified('epistem');
      assert.strictEqual(prefix.status, 'ok');
      assert(prefix.results.some((r) => r.entry.headword === 'epistemology'));
      assert(prefix.results.some((r) => r.entry.headword === 'epistemological'));

      const inflected = await searchEnglishStandardUnified('running');
      assert.strictEqual(inflected.status, 'ok');
      assert.strictEqual(inflected.results[0].matchedField, 'morphology');
      assert.strictEqual(inflected.results[0].entry.headword, 'run');

      const fts = await searchEnglishStandardUnified('sunlight energy');
      assert.strictEqual(fts.status, 'ok');
      assert.strictEqual(fts.results[0].matchedField, 'definition');
      assert.strictEqual(fts.results[0].entry.headword, 'photosynthesis');

      // Punctuation safety in FTS5
      const safePunct = await searchEnglishStandardUnified('what-is "sunlight"?');
      assert.strictEqual(safePunct.status, 'not_found');
    });

    await runAsyncTest('4.3 Bounded pagination returns disjoint pages without loading full DB', async () => {
      const p1 = await searchEnglishStandardUnified('', { limit: 3, offset: 0 });
      const p2 = await searchEnglishStandardUnified('', { limit: 3, offset: 3 });
      assert.strictEqual(p1.status, 'browse');
      assert.strictEqual(p1.results.length, 3);
      assert.strictEqual(p2.results.length, 3);
      assert.strictEqual(p1.totalCount, 10);
      assert.strictEqual(p1.hasMore, true);
      const ids1 = new Set(p1.results.map((r) => r.entry.id));
      for (const r of p2.results) {
        assert(!ids1.has(r.entry.id), `Page 2 repeated ID ${r.entry.id}`);
      }
    });

    await runAsyncTest('4.4 Database close & reopen across sessions preserves query capability', async () => {
      await englishSqliteRepo.closeConnection();
      const afterReopen = await searchEnglishStandardUnified('serendipity');
      assert.strictEqual(afterReopen.status, 'ok');
      assert.strictEqual(afterReopen.results[0].entry.headword, 'serendipity');
      const byId = await englishSqliteRepo.getEntryById(afterReopen.results[0].entry.id);
      assert.strictEqual(byId?.headword, 'serendipity');
    });

    await runAsyncTest('4.5 Feature switch isolation & zero regression on other 6 languages', async () => {
      setEnglishSqliteIntegrationEnabled(false);
      const legacy = await searchEnglishStandardUnified('Water');
      assert.strictEqual(legacy.engineSource, 'starter-corpus');
      assert.strictEqual(legacy.results[0].entry.headword, 'Water');

      setEnglishSqliteIntegrationEnabled(true);
      const ha = dictionaryDb.searchStandard('Ruwa', 'ha');
      const ar = dictionaryDb.searchStandard('خير', 'ar');
      const yo = dictionaryDb.searchStandard('Àlàáfíà', 'yo');
      assert.strictEqual(ha.status, 'ok');
      assert.strictEqual(ar.status, 'ok');
      assert.strictEqual(yo.status, 'ok');
    });

    await runAsyncTest('4.6 Explicit uninstalled & web-preview fallback behavior', async () => {
      englishSqliteRepo.setExecutorForTest(null);
      englishPackService.setTestingOverrides({
        platform: 'android',
        status: { installed: false, dbPath: '' },
      });
      const androidMissing = await searchEnglishStandardUnified('epistemology');
      assert.strictEqual(androidMissing.status, 'language_not_installed');
      assert(androidMissing.message?.includes('55.49 MB'), 'Must expose actual compressed size');

      englishPackService.setTestingOverrides({ platform: 'web' });
      const webFallback = await searchEnglishStandardUnified('Water');
      assert.strictEqual(webFallback.status, 'ok');
      assert.strictEqual(webFallback.engineSource, 'web-preview-fallback');
    });

    await runAsyncTest('4.7 Pack installer failure modes: storage, interrupted resume, bad checksum, corrupt DB', async () => {
      const failureCases: Array<{
        code: string;
        msg: string;
        priorInstalled: boolean;
        partialBytes: number;
      }> = [
        { code: 'INSUFFICIENT_STORAGE', msg: 'Insufficient storage space.', priorInstalled: false, partialBytes: 0 },
        { code: 'DOWNLOAD_CANCELLED', msg: 'Download paused.', priorInstalled: false, partialBytes: 12_500_000 },
        { code: 'CHECKSUM_MISMATCH_COMPRESSED', msg: 'Compressed SHA-256 mismatch.', priorInstalled: true, partialBytes: 0 },
        { code: 'SQLITE_INTEGRITY_FAILED', msg: 'PRAGMA quick_check failed.', priorInstalled: true, partialBytes: 0 },
      ];

      for (const tc of failureCases) {
        const fakeNative: EnglishPackInstallerNative = {
          async getPackStatus() {
            return {
              installed: tc.priorInstalled,
              dbPath: tc.priorInstalled ? '/data/no_backup/lexica_packs/lexica_englishSQLite.db' : '',
              dbSizeBytes: tc.priorInstalled ? ENGLISH_PACK_MANIFEST.uncompressedSizeBytes : 0,
              partialBytes: tc.partialBytes,
              availableBytes: 50_000_000,
              inProgress: false,
            };
          },
          async installPack() {
            throw { code: tc.code, message: tc.msg };
          },
          async cancelInstall() {
            return { cancelled: true };
          },
          async removePack() {
            return { removed: true, availableBytes: 500_000_000 };
          },
          async verifyInstalledPack() {
            return { installed: tc.priorInstalled };
          },
          async getMemoryMetrics() {
            return {
              javaHeapUsedBytes: 10_000_000,
              javaHeapMaxBytes: 256_000_000,
              nativeHeapAllocatedBytes: 20_000_000,
              systemAvailMemBytes: 1_000_000_000,
              systemTotalMemBytes: 4_000_000_000,
              lowMemory: false,
            };
          },
          async addListener() {
            return { remove: async () => {} };
          },
        };

        englishPackService.setTestingOverrides({
          platform: 'android',
          nativeBridge: fakeNative,
        });

        let caught: unknown = null;
        try {
          await englishPackService.installEnglishPack();
        } catch (err) {
          caught = err;
        }
        assert(caught instanceof EnglishPackInstallError, `Expected EnglishPackInstallError for ${tc.code}`);
        assert.strictEqual(caught.code, tc.code);
        const postStatus = englishPackService.getCachedStatus();
        assert.strictEqual(
          postStatus.installed,
          tc.priorInstalled,
          `Existing working DB state (${tc.priorInstalled}) must be preserved after ${tc.code}`
        );
        if (tc.code === 'DOWNLOAD_CANCELLED') {
          assert.strictEqual(postStatus.partialBytes, 12_500_000, 'Partial download bytes preserved for resume');
          assert.strictEqual(postStatus.error, null, 'User pause is not treated as fatal error');
        }
      }
    });

    await runAsyncTest('4.8 Recoverable SQLite query/connection failure returns status="error"', async () => {
      const brokenExecutor: SqlQueryExecutor = {
        isOpen: () => true,
        getDbPath: () => '/tmp/broken.db',
        async open() {},
        async close() {},
        async query() {
          throw new Error('SQLITE_CORRUPT: disk I/O error');
        },
      };
      englishSqliteRepo.setExecutorForTest(brokenExecutor);
      const res = await searchEnglishStandardUnified('epistemology');
      assert.strictEqual(res.status, 'error');
      assert(res.message?.includes('SQLITE_CORRUPT'));
    });

    // Optional full 75,000-entry prototype DB verification when running on build machine with /tmp/lexica_english_v020.db
    const fullV020Path = '/tmp/lexica_english_v020.db';
    if (fs.existsSync(fullV020Path)) {
      await runAsyncTest('4.9 Full 75,000-entry v0.2.0 SQLite DB repository & RP/GA IPA verification', async () => {
        englishSqliteRepo.setExecutorForTest(new NodeSqliteExecutor(fullV020Path));
        for (const word of ['epistemology', 'photosynthesis', 'serendipity', 'ubiquitous', 'dictionary', 'run', 'light']) {
          const r = await searchEnglishStandardUnified(word, { limit: 10, offset: 0 });
          assert.strictEqual(r.status, 'ok', `Expected ok for ${word}`);
          assert(r.results.length > 0, `Expected hits for ${word}`);
          assert(r.results[0].senses.length > 0, `Expected real senses for ${word}`);
        }
        const lightFull = await searchEnglishStandardUnified('light');
        assert.strictEqual(lightFull.results[0].entry.ipa, '[laɪt]', 'Full v0.2.0 DB light must use RP [laɪt]');
        assert((lightFull.results[0].entry.allIpas?.length || 0) >= 6, 'Full v0.2.0 DB preserves all 6 dialect IPAs');

        const meta = englishSqliteRepo.getCachedMetadata();
        assert.strictEqual(meta?.acceptedEntries, 75000);
        assert.strictEqual(meta?.distinctHeadwords, 45317);
        assert.strictEqual(meta?.totalSenses, 190672);
      });
    }
  } finally {
    englishSqliteRepo.setExecutorForTest(null);
    englishPackService.resetTestingOverrides();
    setEnglishSqliteIntegrationEnabled(null);
    if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  }

  console.log('\n==============================================================');
  console.log(`SQLITE INTEGRATION RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('==============================================================\n');
}

void main();
