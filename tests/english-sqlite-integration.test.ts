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
    try:
        conn.execute("ATTACH DATABASE ? AS ext;", (attach_path,))
    except Exception:
        pass
try:
    if mode == "exec":
        conn.executescript(sql_text)
        conn.commit()
        print(json.dumps({"ok": True}))
    elif sql_upper.startswith(("ATTACH", "DETACH")):
        cur = conn.execute(sql_text, payload.get("params", []))
        conn.commit()
        rows = [dict(r) for r in cur.fetchall()] if sql_upper.startswith("PRAGMA") else []
        print(json.dumps({"rows": rows}))
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
  return {
    exec(sql: string) {
      runPythonSqlite({ dbPath, readOnly, attachPath, mode: 'exec', sql });
    },
    prepare(sql: string): NodeSqliteStatement {
      return {
        all(...params: unknown[]) {
          const res = runPythonSqlite<{ rows: unknown[] }>({ dbPath, readOnly, attachPath, mode: 'query', sql, params });
          return res.rows;
        },
        run(...params: unknown[]) {
          const res = runPythonSqlite<{ lastInsertRowid: number }>({ dbPath, readOnly, attachPath, mode: 'run', sql, params });
          return { lastInsertRowid: res.lastInsertRowid };
        },
      };
    },
    close() {},
  };
}
import {
  ENGLISH_PACK_MANIFEST,
  validateEnglishPackManifest,
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
import {
  buildBundledStatePayload,
  createWebBackupEnvelope,
  parseAndVerifyWebBackupEnvelope,
  importOfflineBackup,
  exportOfflineBackup,
  LEXICA_BACKUP_FORMAT,
} from '../src/services/backupService';

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
  private attachPath: string | null = null;

  constructor(private readonly defaultPath: string) {
    this.dbPath = defaultPath;
  }

  public setAttachPath(p: string | null): void {
    if (this.attachPath !== p) {
      this.attachPath = p;
      if (this.db) {
        this.close();
      }
    }
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
    this.db = createCompatDb(dbPath, true, this.attachPath);
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

function createSchemaV2FixtureEnglishSqliteDb(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const db = createCompatDb(filePath, false);
  db.exec(`
    PRAGMA page_size = 16384;
    PRAGMA foreign_keys = ON;
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      license TEXT NOT NULL,
      attribution_text TEXT NOT NULL,
      source_url TEXT NOT NULL,
      dataset_version TEXT NOT NULL
    );
    CREATE TABLE parts_of_speech (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE tag_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tags_json TEXT NOT NULL UNIQUE
    );
    CREATE TABLE pronunciations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      all_ipas TEXT NOT NULL UNIQUE
    );
    CREATE TABLE etymologies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL UNIQUE
    );
    CREATE TABLE audio_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headword_lower TEXT NOT NULL,
      headword TEXT,
      pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
      primary_ipa TEXT,
      pronunciation_id INTEGER REFERENCES pronunciations(id),
      audio_id INTEGER REFERENCES audio_files(id),
      etymology_id INTEGER REFERENCES etymologies(id),
      source_id INTEGER NOT NULL REFERENCES sources(id)
    );
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      sense_number INTEGER NOT NULL,
      definition TEXT NOT NULL,
      tags_id INTEGER REFERENCES tag_sets(id),
      examples TEXT,
      synonyms TEXT,
      antonyms TEXT
    );
    CREATE TABLE word_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      form_lower TEXT NOT NULL,
      form TEXT,
      tags_id INTEGER REFERENCES tag_sets(id)
    );
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      headword,
      definitions_text,
      content='',
      detail=column,
      tokenize = 'unicode61 remove_diacritics 1'
    );
    CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);
    CREATE INDEX idx_senses_entry_id ON senses(entry_id, sense_number);
    CREATE INDEX idx_word_forms_entry_id ON word_forms(entry_id);
    CREATE INDEX idx_word_forms_lower ON word_forms(form_lower);
  `);

  const srcRes = db.prepare(
    `INSERT INTO sources (code, name, license, attribution_text, source_url, dataset_version) VALUES (?, ?, ?, ?, ?, ?);`
  ).run(
    'src-kaikki-enwiktionary',
    ENGLISH_PACK_MANIFEST.attribution.sourceName,
    ENGLISH_PACK_MANIFEST.attribution.license,
    ENGLISH_PACK_MANIFEST.attribution.attributionText,
    ENGLISH_PACK_MANIFEST.attribution.sourceUrl,
    ENGLISH_PACK_MANIFEST.datasetVersion
  );
  const srcId = Number(srcRes.lastInsertRowid);

  const posNounId = Number(db.prepare(`INSERT INTO parts_of_speech (name) VALUES (?);`).run('noun').lastInsertRowid);
  const posAdjId = Number(db.prepare(`INSERT INTO parts_of_speech (name) VALUES (?);`).run('adj').lastInsertRowid);
  const posVerbId = Number(db.prepare(`INSERT INTO parts_of_speech (name) VALUES (?);`).run('verb').lastInsertRowid);

  const tagPluralId = Number(db.prepare(`INSERT INTO tag_sets (tags_json) VALUES (?);`).run('["plural"]').lastInsertRowid);
  const tagPartId = Number(db.prepare(`INSERT INTO tag_sets (tags_json) VALUES (?);`).run('["participle","present"]').lastInsertRowid);

  const pronEpistId = Number(
    db.prepare(`INSERT INTO pronunciations (all_ipas) VALUES (?);`)
      .run(JSON.stringify([['/ɪˌpɪstəˈmɒləd͡ʒi/', ['Received-Pronunciation']], ['/ɪˌpɪstəˈmɑləd͡ʒi/', ['General-American']]]))
      .lastInsertRowid
  );
  const pronLightId = Number(
    db.prepare(`INSERT INTO pronunciations (all_ipas) VALUES (?);`)
      .run(JSON.stringify([['[laɪt]', ['Received-Pronunciation']], ['[laɪt]', ['General-American']], ['[lʌɪt]', ['Scotland']]]))
      .lastInsertRowid
  );
  const etymEpistId = Number(
    db.prepare(`INSERT INTO etymologies (text) VALUES (?);`).run('Ancient Greek episteme + -logy').lastInsertRowid
  );

  // Entry 1: epistemology (nullable headword since identical to lowercase)
  const e1 = Number(
    db.prepare(`INSERT INTO entries (headword, headword_lower, pos_id, primary_ipa, pronunciation_id, etymology_id, source_id) VALUES (?, ?, ?, ?, ?, ?, ?);`)
      .run(null, 'epistemology', posNounId, '/ɪˌpɪstəˈmɒləd͡ʒi/', pronEpistId, etymEpistId, srcId).lastInsertRowid
  );
  db.prepare(`INSERT INTO senses (entry_id, sense_number, definition, tags_id, examples, synonyms) VALUES (?, ?, ?, ?, ?, ?);`)
    .run(e1, 1, 'The branch of philosophy studying the nature and limits of human knowledge.', tagPluralId,
      JSON.stringify([['Epistemology investigates justified belief.', 'Philosophy Text']]), JSON.stringify(['theory of knowledge']));
  db.prepare(`INSERT INTO word_forms (entry_id, form, form_lower, tags_id) VALUES (?, ?, ?, ?);`)
    .run(e1, null, 'epistemologies', tagPluralId);
  db.prepare(`INSERT INTO entries_fts (rowid, headword, definitions_text) VALUES (?, ?, ?);`)
    .run(e1, 'epistemology', 'The branch of philosophy studying the nature and limits of human knowledge.');

  // Entry 2 & 3: light (noun + adj)
  const e2 = Number(
    db.prepare(`INSERT INTO entries (headword, headword_lower, pos_id, primary_ipa, pronunciation_id, source_id) VALUES (?, ?, ?, ?, ?, ?);`)
      .run(null, 'light', posNounId, '[laɪt]', pronLightId, srcId).lastInsertRowid
  );
  db.prepare(`INSERT INTO senses (entry_id, sense_number, definition) VALUES (?, ?, ?);`)
    .run(e2, 1, 'Visible electromagnetic radiation.');
  db.prepare(`INSERT INTO senses (entry_id, sense_number, definition) VALUES (?, ?, ?);`)
    .run(e2, 2, 'A source of illumination such as a lamp.');
  db.prepare(`INSERT INTO entries_fts (rowid, headword, definitions_text) VALUES (?, ?, ?);`)
    .run(e2, 'light', 'Visible electromagnetic radiation. | A source of illumination such as a lamp.');

  const e3 = Number(
    db.prepare(`INSERT INTO entries (headword, headword_lower, pos_id, primary_ipa, pronunciation_id, source_id) VALUES (?, ?, ?, ?, ?, ?);`)
      .run(null, 'light', posAdjId, '[laɪt]', pronLightId, srcId).lastInsertRowid
  );
  db.prepare(`INSERT INTO senses (entry_id, sense_number, definition) VALUES (?, ?, ?);`)
    .run(e3, 1, 'Having low weight; not heavy.');
  db.prepare(`INSERT INTO entries_fts (rowid, headword, definitions_text) VALUES (?, ?, ?);`)
    .run(e3, 'light', 'Having low weight; not heavy.');

  // Entry 4: run (verb + inflected form)
  const e4 = Number(
    db.prepare(`INSERT INTO entries (headword, headword_lower, pos_id, source_id) VALUES (?, ?, ?, ?);`)
      .run(null, 'run', posVerbId, srcId).lastInsertRowid
  );
  db.prepare(`INSERT INTO senses (entry_id, sense_number, definition) VALUES (?, ?, ?);`)
    .run(e4, 1, 'To move swiftly on foot.');
  db.prepare(`INSERT INTO word_forms (entry_id, form, form_lower, tags_id) VALUES (?, ?, ?, ?);`)
    .run(e4, null, 'running', tagPartId);
  db.prepare(`INSERT INTO entries_fts (rowid, headword, definitions_text) VALUES (?, ?, ?);`)
    .run(e4, 'run', 'To move swiftly on foot.');

  // Entry 5: capitalized headword preserved explicitly
  const e5 = Number(
    db.prepare(`INSERT INTO entries (headword, headword_lower, pos_id, source_id) VALUES (?, ?, ?, ?);`)
      .run('Serendipity', 'serendipity', posNounId, srcId).lastInsertRowid
  );
  db.prepare(`INSERT INTO senses (entry_id, sense_number, definition) VALUES (?, ?, ?);`)
    .run(e5, 1, 'Finding valuable things unexpectedly by chance.');
  db.prepare(`INSERT INTO entries_fts (rowid, headword, definitions_text) VALUES (?, ?, ?);`)
    .run(e5, 'Serendipity', 'Finding valuable things unexpectedly by chance.');

  const metaInsert = db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?);`);
  metaInsert.run('schema_version', '2');
  metaInsert.run('dataset_name', 'Lexica English Schema v2 Fixture');
  metaInsert.run('pack_version', '0.3.0');
  metaInsert.run('accepted_entries', '5');
  metaInsert.run('distinct_headwords', '4');
  metaInsert.run('total_senses', '6');
  metaInsert.run('source_license', ENGLISH_PACK_MANIFEST.attribution.license);
  metaInsert.run('source_attribution', ENGLISH_PACK_MANIFEST.attribution.attributionText);

  db.close();
}

function createSchemaV3CoreAndExtendedFixtures(corePath: string, extPath: string): void {
  if (fs.existsSync(corePath)) fs.unlinkSync(corePath);
  if (fs.existsSync(extPath)) fs.unlinkSync(extPath);

  const cDb = createCompatDb(corePath, false);
  cDb.exec(`
    PRAGMA page_size = 16384;
    PRAGMA foreign_keys = ON;
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
      license TEXT NOT NULL, attribution_text TEXT NOT NULL,
      source_url TEXT NOT NULL, dataset_version TEXT NOT NULL
    );
    CREATE TABLE parts_of_speech (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      headword_lower TEXT NOT NULL,
      headword TEXT,
      headword_norm TEXT,
      pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
      primary_ipa TEXT,
      primary_definition TEXT NOT NULL,
      extra_senses_count INTEGER NOT NULL DEFAULT 0,
      source_id INTEGER NOT NULL REFERENCES sources(id)
    );
    CREATE TABLE word_forms (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      form_lower TEXT NOT NULL,
      form TEXT,
      form_norm TEXT
    );
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      headword, primary_definition, content='', detail=none, tokenize = 'unicode61 remove_diacritics 1'
    );
  `);

  cDb.prepare(
    `INSERT INTO sources (id, code, name, license, attribution_text, source_url, dataset_version) VALUES (?, ?, ?, ?, ?, ?, ?);`
  ).run(
    1,
    'src-kaikki-enwiktionary',
    ENGLISH_PACK_MANIFEST.attribution.sourceName,
    ENGLISH_PACK_MANIFEST.attribution.license,
    ENGLISH_PACK_MANIFEST.attribution.attributionText,
    ENGLISH_PACK_MANIFEST.attribution.sourceUrl,
    ENGLISH_PACK_MANIFEST.datasetVersion
  );
  cDb.prepare(`INSERT INTO parts_of_speech (id, name) VALUES (?, ?);`).run(1, 'noun');
  cDb.prepare(`INSERT INTO parts_of_speech (id, name) VALUES (?, ?);`).run(2, 'adj');
  cDb.prepare(`INSERT INTO parts_of_speech (id, name) VALUES (?, ?);`).run(3, 'verb');

  const insEntry = cDb.prepare(
    `INSERT INTO entries (id, headword_lower, headword, headword_norm, pos_id, primary_ipa, primary_definition, extra_senses_count, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
  );
  const insForm = cDb.prepare(
    `INSERT INTO word_forms (entry_id, form_lower, form, form_norm) VALUES (?, ?, ?, ?);`
  );
  const insFts = cDb.prepare(
    `INSERT INTO entries_fts (rowid, headword, primary_definition) VALUES (?, ?, ?);`
  );

  // Entry 1: light (noun) with extra senses in Extended
  insEntry.run(1, 'light', null, null, 1, '[laɪt]', 'Visible electromagnetic radiation enabling sight.', 1, 1);
  insForm.run(1, 'lights', null, null);
  insFts.run(1, 'light', 'Visible electromagnetic radiation enabling sight.');

  // Entry 2: régime (noun) with partial-indexed headword_norm='regime' and form_norm='regimes'
  insEntry.run(2, 'régime', null, 'regime', 1, '/ɹeɪˈʒiːm/', 'A mode of rule or management; a form of government.', 0, 1);
  insForm.run(2, 'régimes', null, 'regimes');
  insFts.run(2, 'régime', 'A mode of rule or management; a form of government.');

  // Entry 3: run (verb) with irregular inflected form + normalized contraction
  insEntry.run(3, 'run', null, null, 3, '/ɹʌn/', 'To move swiftly on foot so that both feet leave the ground.', 2, 1);
  insForm.run(3, 'running', null, null);
  insForm.run(3, "runnin'", null, 'runnin');
  insFts.run(3, 'run', 'To move swiftly on foot so that both feet leave the ground.');

  // Entry 4: Serendipity (noun) explicit casing
  insEntry.run(4, 'serendipity', 'Serendipity', null, 1, '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', 'The occurrence of fortunate discoveries by chance.', 0, 1);
  insFts.run(4, 'Serendipity', 'The occurrence of fortunate discoveries by chance.');

  // Entry 5: photosynthesis (noun) for FTS5 query test
  insEntry.run(5, 'photosynthesis', null, null, 1, '/ˌfəʊ.təʊˈsɪn.θə.sɪs/', 'The biological process converting solar knowledge and light energy.', 0, 1);
  insFts.run(5, 'photosynthesis', 'The biological process converting solar knowledge and light energy.');

  cDb.exec(`
    CREATE INDEX idx_core_entries_hw_lower ON entries(headword_lower);
    CREATE INDEX idx_core_entries_hw_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;
    CREATE INDEX idx_core_wf_lower ON word_forms(form_lower);
    CREATE INDEX idx_core_wf_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;
    CREATE INDEX idx_core_wf_entry_id ON word_forms(entry_id);
  `);

  const cMeta = cDb.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?);`);
  cMeta.run('schema_version', '3');
  cMeta.run('pack_layer', 'core');
  cMeta.run('dataset_name', 'Lexica English Monolingual Dictionary (Core)');
  cMeta.run('pack_version', '0.4.0-core');
  cMeta.run('accepted_entries', '5');
  cMeta.run('distinct_headwords', '5');
  cMeta.run('total_senses', '8');
  cMeta.run('core_primary_senses', '5');
  cMeta.run('total_word_forms', '4');
  cMeta.run('source_name', ENGLISH_PACK_MANIFEST.attribution.sourceName);
  cMeta.run('source_license', ENGLISH_PACK_MANIFEST.attribution.license);
  cMeta.run('source_attribution', ENGLISH_PACK_MANIFEST.attribution.attributionText);
  cDb.close();

  const eDb = createCompatDb(extPath, false);
  eDb.exec(`
    PRAGMA page_size = 16384;
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE tag_sets (id INTEGER PRIMARY KEY, tags_json TEXT NOT NULL);
    CREATE TABLE pronunciations (id INTEGER PRIMARY KEY, all_ipas TEXT NOT NULL);
    CREATE TABLE etymologies (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE audio_files (id INTEGER PRIMARY KEY, filename TEXT NOT NULL);
    CREATE TABLE entry_extensions (
      entry_id INTEGER PRIMARY KEY,
      pronunciation_id INTEGER, audio_id INTEGER, etymology_id INTEGER,
      primary_sense_number INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE senses_ext (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      sense_number INTEGER NOT NULL,
      definition TEXT,
      tags_id INTEGER,
      examples TEXT,
      synonyms TEXT,
      antonyms TEXT
    );
    CREATE INDEX idx_ext_senses_entry ON senses_ext(entry_id, sense_number);
  `);
  eDb.prepare(`INSERT INTO pronunciations (id, all_ipas) VALUES (?, ?);`)
    .run(1, JSON.stringify([['[laɪt]', ['Received-Pronunciation']], ['[ɫɐɪt]', ['General-American']]]));
  eDb.prepare(`INSERT INTO etymologies (id, text) VALUES (?, ?);`)
    .run(1, 'From Old English lēoht.');
  eDb.prepare(`INSERT INTO tag_sets (id, tags_json) VALUES (?, ?);`).run(1, '["countable","uncountable"]');
  eDb.prepare(`INSERT INTO entry_extensions (entry_id, pronunciation_id, audio_id, etymology_id, primary_sense_number) VALUES (?, ?, ?, ?, ?);`)
    .run(1, 1, null, 1, 1);
  eDb.prepare(`INSERT INTO senses_ext (id, entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`)
    .run(1, 1, 1, null, 1, JSON.stringify([['Morning light filled the courtyard.', 'Sample']]), JSON.stringify(['illumination']), null);
  eDb.prepare(`INSERT INTO senses_ext (id, entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`)
    .run(2, 1, 2, 'A source of illumination such as a lamp or lantern.', null, null, JSON.stringify(['lamp']), null);
  eDb.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?);`).run('pack_layer', 'extended');
  eDb.close();
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
      const expectedCompressedMb = (ENGLISH_PACK_MANIFEST.compressedSizeBytes / (1024 * 1024)).toFixed(2);
      assert(androidMissing.message?.includes(`${expectedCompressedMb} MB`), `Must expose actual compressed size (${expectedCompressedMb} MB)`);

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
    const fullCoreV040Path = '/tmp/lexica_core_v040/lexica_english_core.db';
    const fullExtV040Path = '/tmp/lexica_core_v040/lexica_english_extended.db';
    if (fs.existsSync(fullCoreV040Path)) {
      await runAsyncTest('4.9c Full 75,000-entry Schema v3 Core (v0.4.0-core) & optional Extended SQLite DB verification', async () => {
        const coreExec = new NodeSqliteExecutor(fullCoreV040Path);
        englishSqliteRepo.setExecutorForTest(coreExec);
        for (const word of ['epistemology', 'photosynthesis', 'serendipity', 'ubiquitous', 'dictionary', 'run', 'light']) {
          const r = await searchEnglishStandardUnified(word, { limit: 10, offset: 0 });
          assert.strictEqual(r.status, 'ok', `Expected ok for ${word} in Core v0.4.0 DB`);
          assert(r.results.length > 0, `Expected hits for ${word}`);
          assert(r.results[0].senses.length === 1, `Core-only lookup exposes primary sense for ${word}`);
          assert(r.results[0].senses[0].definition.trim().length > 0, `Non-empty primary definition for ${word}`);
          assert.strictEqual(r.results[0].entry.isCoreOnly, true);
        }
        // Normalized diacritic & apostrophe lookup on 75k dataset
        const regimeRes = await searchEnglishStandardUnified('regime');
        assert.strictEqual(regimeRes.status, 'ok');
        assert(regimeRes.results.some((r) => r.entry.headword === 'régime'), 'regime must match régime via headword_norm');

        const itsRes = await searchEnglishStandardUnified('its');
        assert.strictEqual(itsRes.status, 'ok');
        assert(itsRes.results.some((r) => r.entry.headword === "it's"), "its must match it's via headword_norm");

        // Audited Ally cleaning check (zero empty [[]] brackets)
        const allyRes = await searchEnglishStandardUnified('Ally');
        assert.strictEqual(allyRes.status, 'ok');
        for (const item of allyRes.results) {
          assert(!item.entry.definition.includes('[[]]'), 'Markup artifact [[]] must be cleaned');
        }

        // Real 75k FTS5 & word-form fallback checks on Core DB
        const epistFts = await searchEnglishStandardUnified('branch philosophy acquired');
        assert.strictEqual(epistFts.status, 'ok');
        assert(epistFts.results.some((r) => r.entry.headword === 'epistemology'), 'FTS5 definition search must match epistemology');

        const formFull = await searchEnglishStandardUnified('swam');
        assert.strictEqual(formFull.status, 'ok');
        assert(formFull.results.some((r) => r.entry.headword === 'swim'), 'word_forms lookup must match swim for swam');

        const meta = englishSqliteRepo.getCachedMetadata();
        assert.strictEqual(meta?.schemaVersion, 3);
        assert.strictEqual(meta?.packLayer, 'core');
        assert.strictEqual(meta?.acceptedEntries, 75000);
        assert.strictEqual(meta?.distinctHeadwords, 45317);

        if (fs.existsSync(fullExtV040Path)) {
          englishSqliteRepo.setExtendedDbPathForTest(fullExtV040Path);
          await englishSqliteRepo.closeConnection();
          const lightExt = await searchEnglishStandardUnified('light');
          assert.strictEqual(lightExt.results[0].entry.extendedInstalled, true);
          assert((lightExt.results[0].entry.allIpas?.length || 0) >= 6, 'Attached Extended DB restores all dialect IPAs');
          assert(lightExt.results[0].senses.length > 1, 'Attached Extended DB restores secondary senses');
          englishSqliteRepo.setExtendedDbPathForTest(null);
          await englishSqliteRepo.closeConnection();
        }
      });
    }

    const fullV030Path = '/tmp/lexica_release_v030/lexica_english.db';
    if (fs.existsSync(fullV030Path)) {
      await runAsyncTest('4.9b Full 75,000-entry Schema v2 (v0.3.0) SQLite DB verification', async () => {
        englishSqliteRepo.setExecutorForTest(new NodeSqliteExecutor(fullV030Path));
        for (const word of ['epistemology', 'photosynthesis', 'serendipity', 'ubiquitous', 'dictionary', 'run', 'light']) {
          const r = await searchEnglishStandardUnified(word, { limit: 10, offset: 0 });
          assert.strictEqual(r.status, 'ok', `Expected ok for ${word} in v0.3.0 DB`);
          assert(r.results.length > 0, `Expected hits for ${word}`);
          assert(r.results[0].senses.length > 0, `Expected senses for ${word}`);
        }
        const lightFull = await searchEnglishStandardUnified('light');
        assert.strictEqual(lightFull.results[0].entry.ipa, '[laɪt]', 'Full v0.3.0 DB light must use RP [laɪt]');
        assert((lightFull.results[0].entry.allIpas?.length || 0) >= 6, 'Full v0.3.0 DB preserves all 6 dialect IPAs');
        const epistPrefix = await searchEnglishStandardUnified('epistem', { limit: 10, offset: 0 });
        assert(epistPrefix.results.some((r) => r.entry.headword === 'epistemology'));
        const meta = englishSqliteRepo.getCachedMetadata();
        assert.strictEqual(meta?.acceptedEntries, 75000);
        assert.strictEqual(meta?.distinctHeadwords, 45317);
        assert.strictEqual(meta?.totalSenses, 190672);
      });
    }

    const fullV020Path = '/tmp/lexica_en_v020.db';
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

    await runAsyncTest('4.10 Manifest validation rejects invalid/missing fields cleanly before native call', async () => {
      const liveValidation = validateEnglishPackManifest(ENGLISH_PACK_MANIFEST);
      assert.strictEqual(liveValidation.valid, true, liveValidation.message);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.packId, 'en-wiktionary-sqlite');
      assert.strictEqual(ENGLISH_PACK_MANIFEST.packLayer, 'core');
      assert.strictEqual(ENGLISH_PACK_MANIFEST.packVersion, '0.4.0-core');
      assert.strictEqual(ENGLISH_PACK_MANIFEST.schemaVersion, 3);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.releaseTag, 'prototype-en-core-v0.4.0');
      assert.strictEqual(ENGLISH_PACK_MANIFEST.compressedSizeBytes, 8602919);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.uncompressedSizeBytes, 18546688);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.corePrimarySenses, 75000);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.totalWordForms, 134837);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.extendedCompanion?.optional, true);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.extendedCompanion?.autoDownload, false);
      assert.strictEqual(ENGLISH_PACK_MANIFEST.extendedCompanion?.downloadUrl, null);
      assert(/^[a-f0-9]{64}$/.test(ENGLISH_PACK_MANIFEST.compressedSha256));
      assert(/^[a-f0-9]{64}$/.test(ENGLISH_PACK_MANIFEST.uncompressedSha256));

      let nativeCalled = false;
      englishPackService.setTestingOverrides({
        platform: 'android',
        manifest: {
          ...ENGLISH_PACK_MANIFEST,
          downloadUrl: 'http://insecure.example.com/bad.db.gz',
          compressedSizeBytes: 0,
          compressedSha256: 'not-a-sha256',
        },
        nativeBridge: {
          async getPackStatus() { return { installed: false }; },
          async installPack() { nativeCalled = true; return { installed: true }; },
          async cancelInstall() { return { cancelled: true }; },
          async removePack() { return { removed: true, availableBytes: 500_000_000 }; },
          async verifyInstalledPack() { return { installed: false }; },
          async getMemoryMetrics() {
            return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
          },
          async addListener() { return { remove: async () => {} }; },
        },
      });

      let caught: unknown = null;
      try {
        await englishPackService.installEnglishPack();
      } catch (err) {
        caught = err;
      }
      assert.strictEqual(nativeCalled, false, 'Invalid manifest must fail before calling native installPack');
      assert(caught instanceof EnglishPackInstallError);
      assert.strictEqual(caught.code, 'INVALID_MANIFEST');
      assert(caught.message.includes('downloadUrl'));
      assert(caught.message.includes('compressedSizeBytes'));
      assert(caught.message.includes('compressedSha256'));
    });

    await runAsyncTest('4.11 Retry recovery without restart, startup status persistence & other 6 packs', async () => {
      englishPackService.resetTestingOverrides();
      let attempts = 0;
      let persistedInstalled = false;
      let partialBytes = 0;
      const exec = new NodeSqliteExecutor(tmpDbPath);

      const bridge: EnglishPackInstallerNative = {
        async getPackStatus() {
          return {
            installed: persistedInstalled,
            dbPath: persistedInstalled ? tmpDbPath : '',
            dbSizeBytes: persistedInstalled ? ENGLISH_PACK_MANIFEST.uncompressedSizeBytes : 0,
            partialBytes,
            availableBytes: 1_500_000_000,
            inProgress: false,
            datasetVersion: persistedInstalled ? ENGLISH_PACK_MANIFEST.packVersion : '',
            acceptedEntries: persistedInstalled ? ENGLISH_PACK_MANIFEST.acceptedEntries : 0,
            distinctHeadwords: persistedInstalled ? ENGLISH_PACK_MANIFEST.distinctHeadwords : 0,
            totalSenses: persistedInstalled ? ENGLISH_PACK_MANIFEST.totalSenses : 0,
          };
        },
        async installPack(options) {
          attempts++;
          assert.strictEqual(options.url, ENGLISH_PACK_MANIFEST.downloadUrl);
          assert.strictEqual(options.compressedSizeBytes, ENGLISH_PACK_MANIFEST.compressedSizeBytes);
          assert.strictEqual(options.uncompressedSizeBytes, ENGLISH_PACK_MANIFEST.uncompressedSizeBytes);
          assert.strictEqual(options.compressedSha256, ENGLISH_PACK_MANIFEST.compressedSha256);
          assert.strictEqual(options.uncompressedSha256, ENGLISH_PACK_MANIFEST.uncompressedSha256);
          if (attempts === 1) {
            partialBytes = 15_000_000;
            throw { code: 'PACK_INSTALL_FAILED', message: 'Download interrupted at 15000000 bytes.' };
          }
          partialBytes = 0;
          persistedInstalled = true;
          return {
            installed: true,
            dbPath: tmpDbPath,
            dbSizeBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
            datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
            acceptedEntries: ENGLISH_PACK_MANIFEST.acceptedEntries,
            distinctHeadwords: ENGLISH_PACK_MANIFEST.distinctHeadwords,
            totalSenses: ENGLISH_PACK_MANIFEST.totalSenses,
          };
        },
        async cancelInstall() { return { cancelled: true }; },
        async removePack() { persistedInstalled = false; return { removed: true, availableBytes: 1_500_000_000 }; },
        async verifyInstalledPack() { return { installed: persistedInstalled }; },
        async getMemoryMetrics() {
          return { javaHeapUsedBytes: 10_000_000, javaHeapMaxBytes: 256_000_000, nativeHeapAllocatedBytes: 20_000_000, systemAvailMemBytes: 1_000_000_000, systemTotalMemBytes: 4_000_000_000, lowMemory: false };
        },
        async addListener() { return { remove: async () => {} }; },
      };

      englishPackService.setTestingOverrides({ platform: 'android', nativeBridge: bridge });
      // Attempt 1 fails mid-download
      let err1: unknown = null;
      try {
        await englishPackService.installEnglishPack();
      } catch (e) {
        err1 = e;
      }
      assert(err1 instanceof EnglishPackInstallError);
      assert.strictEqual(englishPackService.getCachedStatus().partialBytes, 15_000_000);

      // Immediate Retry without app restart succeeds
      const statusAfterRetry = await englishPackService.installEnglishPack();
      assert.strictEqual(statusAfterRetry.installed, true);
      assert.strictEqual(statusAfterRetry.error, null);
      assert.strictEqual(attempts, 2);

      // Simulate cold restart where cached status is reset but persisted DB exists natively
      englishPackService.resetTestingOverrides();
      englishPackService.setTestingOverrides({ platform: 'android', nativeBridge: bridge });
      englishSqliteRepo.setExecutorForTest(exec);
      const coldBootSearch = await searchEnglishStandardUnified('epistemology');
      assert.strictEqual(coldBootSearch.status, 'ok');
      assert.strictEqual(coldBootSearch.results[0].entry.headword, 'epistemology');
      assert.strictEqual(englishPackService.getCachedStatus().installed, true);

      // Verify other 6 language packs (ha, yo, ff, ar, fr, zh) remain installed and unaffected
      const stats = dictionaryDb.getLanguagePackStats();
      for (const code of ['ha', 'yo', 'ff', 'ar', 'fr', 'zh'] as const) {
        assert.strictEqual(stats[code].isInstalled, true, `${code} pack must remain installed`);
        assert(stats[code].loadedEntriesCount > 0, `${code} must retain offline entries`);
      }
    });
    const tmpV2DbPath = path.join(os.tmpdir(), `lexica_en_v2_test_${process.pid}.db`);
    createSchemaV2FixtureEnglishSqliteDb(tmpV2DbPath);
    try {
      await runAsyncTest('4.12 Schema v2 normalized tables, compact JSON, nullable headwords & contentless FTS5', async () => {
        englishSqliteRepo.setExecutorForTest(new NodeSqliteExecutor(tmpV2DbPath));
        const epist = await searchEnglishStandardUnified('epistemology');
        assert.strictEqual(epist.status, 'ok');
        assert.strictEqual(epist.results[0].entry.headword, 'epistemology');
        assert.strictEqual(epist.results[0].entry.ipa, '/ɪˌpɪstəˈmɒləd͡ʒi/');
        assert.strictEqual(epist.results[0].entry.allIpas?.length, 2);
        assert.strictEqual(epist.results[0].entry.etymology, 'Ancient Greek episteme + -logy');
        assert.strictEqual(epist.results[0].senses[0].examples[0]?.sourceText, 'Epistemology investigates justified belief.');
        assert.strictEqual(epist.results[0].senses[0].examples[0]?.culturalContext, 'Reference: Philosophy Text');

        const light = await searchEnglishStandardUnified('LIGHT');
        assert.strictEqual(light.results.length, 2);
        assert.strictEqual(light.results[0].senses.length, 2);
        assert.strictEqual(light.results[0].entry.allIpas?.length, 3);

        const cap = await searchEnglishStandardUnified('serendipity');
        assert.strictEqual(cap.results[0].entry.headword, 'Serendipity', 'Explicit capitalized headword preserved');

        const prefix = await searchEnglishStandardUnified('epistem');
        assert(prefix.results.some((r) => r.entry.headword === 'epistemology'));

        const morph = await searchEnglishStandardUnified('running');
        assert.strictEqual(morph.results[0].matchedField, 'morphology');
        assert.strictEqual(morph.results[0].entry.headword, 'run');

        const fts = await searchEnglishStandardUnified('nature limits');
        assert.strictEqual(fts.status, 'ok');
        assert.strictEqual(fts.results[0].matchedField, 'definition');
      });
    } finally {
      if (fs.existsSync(tmpV2DbPath)) fs.unlinkSync(tmpV2DbPath);
    }

    await runAsyncTest('4.13 Duplicate-version download guard avoids redundant network downloads', async () => {
      englishPackService.resetTestingOverrides();
      let networkDownloadCalls = 0;
      const bridge: EnglishPackInstallerNative = {
        async getPackStatus() {
          return {
            installed: true,
            dbPath: tmpDbPath,
            dbSizeBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
            partialBytes: 0,
            availableBytes: 1_500_000_000,
            inProgress: false,
            datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
            schemaVersion: 2,
            acceptedEntries: ENGLISH_PACK_MANIFEST.acceptedEntries,
            distinctHeadwords: ENGLISH_PACK_MANIFEST.distinctHeadwords,
            totalSenses: ENGLISH_PACK_MANIFEST.totalSenses,
          };
        },
        async installPack() {
          networkDownloadCalls++;
          return { installed: true };
        },
        async cancelInstall() { return { cancelled: true }; },
        async removePack() { return { removed: true, availableBytes: 1_500_000_000 }; },
        async verifyInstalledPack() {
          return {
            installed: true,
            dbPath: tmpDbPath,
            dbSizeBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
            datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
            acceptedEntries: ENGLISH_PACK_MANIFEST.acceptedEntries,
            distinctHeadwords: ENGLISH_PACK_MANIFEST.distinctHeadwords,
            totalSenses: ENGLISH_PACK_MANIFEST.totalSenses,
          };
        },
        async getMemoryMetrics() {
          return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
        },
        async addListener() { return { remove: async () => {} }; },
      };

      englishPackService.setTestingOverrides({ platform: 'android', nativeBridge: bridge });
      const res = await englishPackService.installEnglishPack();
      assert.strictEqual(res.installed, true);
      assert.strictEqual(res.alreadyInstalled, true);
      assert.strictEqual(networkDownloadCalls, 0, 'Duplicate version must not trigger installPack download');
    });

    await runAsyncTest('4.14 Offline backup export/restore checksum validation, tamper rejection & 6-pack safety', async () => {
      englishPackService.resetTestingOverrides();
      // Provide an isolated in-memory localStorage mock for Node test runtime
      const memStore = new Map<string, string>();
      const prevWindow = (globalThis as Record<string, unknown>).window;
      const prevLocalStorage = (globalThis as Record<string, unknown>).localStorage;
      const mockLocalStorage = {
        getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
        setItem: (k: string, v: string) => { memStore.set(k, String(v)); },
        removeItem: (k: string) => { memStore.delete(k); },
        clear: () => { memStore.clear(); },
      };
      (globalThis as Record<string, unknown>).window = { localStorage: mockLocalStorage };
      (globalThis as Record<string, unknown>).localStorage = mockLocalStorage;

      try {
        const { envelope, serialized } = await createWebBackupEnvelope();
        assert.strictEqual(envelope.format, LEXICA_BACKUP_FORMAT);
        assert(/^[a-f0-9]{64}$/.test(envelope.bundledStateSha256));

        // 1. Corrupt/tamper check must reject before modifying active state
        const tamperedObj = JSON.parse(serialized);
        tamperedObj.bundledState.savedWordIds = ['tampered-word-id'];
        let corruptErr: unknown = null;
        try {
          await parseAndVerifyWebBackupEnvelope(JSON.stringify(tamperedObj), { replaceExisting: true });
        } catch (e) {
          corruptErr = e;
        }
        assert(corruptErr instanceof EnglishPackInstallError);
        assert.strictEqual(corruptErr.code, 'BACKUP_CORRUPTED');

        // 2. Duplicate backup check must guard against accidental redundant restore
        let dupErr: unknown = null;
        try {
          await parseAndVerifyWebBackupEnvelope(serialized, { replaceExisting: false });
        } catch (e) {
          dupErr = e;
        }
        assert(dupErr instanceof EnglishPackInstallError);
        assert.strictEqual(dupErr.code, 'BACKUP_DUPLICATE_PACK');

        // 3. Valid restore with replaceExisting=true preserves all 6 bundled packs (ha, yo, ff, ar, fr, zh)
        const restored = await parseAndVerifyWebBackupEnvelope(serialized, { replaceExisting: true });
        assert.strictEqual(restored.restoredPackCount, 7);
        const statsAfter = dictionaryDb.getLanguagePackStats();
        for (const code of ['ha', 'yo', 'ff', 'ar', 'fr', 'zh'] as const) {
          assert.strictEqual(statsAfter[code].isInstalled, true, `${code} must remain active after restore`);
        }

        // 4. Native Android SAF bridge export/import round-trip (zero network calls)
        let safExportCalled = false;
        let safImportCalled = false;
        const safStateJson = JSON.stringify(buildBundledStatePayload());
        englishPackService.setTestingOverrides({
          platform: 'android',
          nativeBridge: {
            async getPackStatus() {
              return {
                installed: true,
                dbPath: tmpDbPath,
                dbSizeBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
                datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
                acceptedEntries: ENGLISH_PACK_MANIFEST.acceptedEntries,
                distinctHeadwords: ENGLISH_PACK_MANIFEST.distinctHeadwords,
                totalSenses: ENGLISH_PACK_MANIFEST.totalSenses,
              };
            },
            async installPack() { return { installed: true }; },
            async cancelInstall() { return { cancelled: true }; },
            async removePack() { return { removed: true, availableBytes: 1_500_000_000 }; },
            async verifyInstalledPack() { return { installed: true }; },
            async getMemoryMetrics() {
              return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
            },
            async exportBackup(opts) {
              safExportCalled = true;
              assert(opts.bundledStateJson.includes(LEXICA_BACKUP_FORMAT));
              return {
                exported: true,
                includesEnglishSqlite: true,
                englishDbBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
                englishDbSha256: ENGLISH_PACK_MANIFEST.uncompressedSha256,
                bundledStateSha256: envelope.bundledStateSha256,
                uri: 'content://com.android.externalstorage.documents/document/primary%3ALexica%2Fbackup.lexicabackup',
              };
            },
            async importBackup(opts) {
              safImportCalled = true;
              assert.strictEqual(opts.replaceExisting, true);
              return {
                restored: true,
                includesEnglishSqlite: true,
                bundledStateJson: safStateJson,
                datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
                acceptedEntries: ENGLISH_PACK_MANIFEST.acceptedEntries,
              };
            },
            async addListener() { return { remove: async () => {} }; },
          },
        });
        const safExported = await exportOfflineBackup({ includeEnglishPack: true });
        assert.strictEqual(safExportCalled, true);
        assert.strictEqual(safExported.mode, 'android-saf');
        assert.strictEqual(safExported.includesEnglishSqlite, true);

        const safImported = await importOfflineBackup({ replaceExisting: true });
        assert.strictEqual(safImportCalled, true);
        assert.strictEqual(safImported.mode, 'android-saf');
        assert.strictEqual(safImported.englishEntriesCount, ENGLISH_PACK_MANIFEST.acceptedEntries);
      } finally {
        if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
        else (globalThis as Record<string, unknown>).window = prevWindow;
        if (prevLocalStorage === undefined) delete (globalThis as Record<string, unknown>).localStorage;
        else (globalThis as Record<string, unknown>).localStorage = prevLocalStorage;
      }
    });

    const tmpV3CorePath = path.join(os.tmpdir(), `lexica_en_v3_core_test_${process.pid}.db`);
    const tmpV3ExtPath = path.join(os.tmpdir(), `lexica_en_v3_ext_test_${process.pid}.db`);
    createSchemaV3CoreAndExtendedFixtures(tmpV3CorePath, tmpV3ExtPath);
    try {
      await runAsyncTest('4.15 Schema v3 Core standalone query (no senses table), normalization & FTS5', async () => {
        englishPackService.resetTestingOverrides();
        englishSqliteRepo.setExecutorForTest(new NodeSqliteExecutor(tmpV3CorePath));

        const light = await searchEnglishStandardUnified('LIGHT');
        assert.strictEqual(light.status, 'ok');
        assert.strictEqual(light.results[0].entry.isCoreOnly, true);
        assert.strictEqual(light.results[0].entry.extendedInstalled, false);
        assert.strictEqual(light.results[0].entry.extraSensesCount, 1);
        assert.strictEqual(light.results[0].senses.length, 1);
        assert.strictEqual(light.results[0].entry.ipa, '[laɪt]');

        // Diacritic and apostrophe normalization via headword_norm / form_norm
        const regime = await searchEnglishStandardUnified('regime');
        assert.strictEqual(regime.status, 'ok');
        assert.strictEqual(regime.results[0].entry.headword, 'régime');
        assert.strictEqual(regime.results[0].matchedField, 'headword-normalized');

        const formNorm = await searchEnglishStandardUnified('regimes');
        assert.strictEqual(formNorm.status, 'ok');
        assert.strictEqual(formNorm.results[0].matchedField, 'morphology');
        assert.strictEqual(formNorm.results[0].entry.headword, 'régime');

        const runForm = await searchEnglishStandardUnified('runnin');
        assert.strictEqual(runForm.status, 'ok');
        assert.strictEqual(runForm.results[0].matchedField, 'morphology');
        assert.strictEqual(runForm.results[0].entry.headword, 'run');

        // Explicit casing & prefix & FTS5 (detail=none)
        const cap = await searchEnglishStandardUnified('serendipity');
        assert.strictEqual(cap.results[0].entry.headword, 'Serendipity');

        const pref = await searchEnglishStandardUnified('photosyn');
        assert(pref.results.some((r) => r.entry.headword === 'photosynthesis'));

        const fts = await searchEnglishStandardUnified('solar knowledge');
        assert.strictEqual(fts.status, 'ok');
        assert.strictEqual(fts.results[0].matchedField, 'definition');
        assert.strictEqual(fts.results[0].entry.headword, 'photosynthesis');

        const meta = englishSqliteRepo.getCachedMetadata();
        assert.strictEqual(meta?.schemaVersion, 3);
        assert.strictEqual(meta?.packLayer, 'core');
        assert.strictEqual(meta?.extendedAttached, false);
      });

      await runAsyncTest('4.16 Optional Extended DB attachment enriches Core seamlessly and detaches cleanly', async () => {
        englishSqliteRepo.setExecutorForTest(new NodeSqliteExecutor(tmpV3CorePath));
        englishSqliteRepo.setExtendedDbPathForTest(tmpV3ExtPath);
        await englishSqliteRepo.closeConnection();

        const lightExt = await searchEnglishStandardUnified('light');
        assert.strictEqual(lightExt.status, 'ok');
        assert.strictEqual(lightExt.results[0].entry.isCoreOnly, false);
        assert.strictEqual(lightExt.results[0].entry.extendedInstalled, true);
        assert.strictEqual(lightExt.results[0].senses.length, 2, 'Secondary senses loaded from Extended DB');
        assert.strictEqual(lightExt.results[0].entry.allIpas?.length, 2, 'Dialect IPAs loaded from Extended DB');
        assert.strictEqual(lightExt.results[0].entry.etymology, 'From Old English lēoht.');
        assert.strictEqual(lightExt.results[0].senses[0].examples[0]?.sourceText, 'Morning light filled the courtyard.');

        // Detach Extended -> Core stays fully operational
        englishSqliteRepo.setExtendedDbPathForTest(null);
        await englishSqliteRepo.closeConnection();
        const lightCoreAgain = await searchEnglishStandardUnified('light');
        assert.strictEqual(lightCoreAgain.status, 'ok');
        assert.strictEqual(lightCoreAgain.results[0].entry.isCoreOnly, true);
        assert.strictEqual(lightCoreAgain.results[0].senses.length, 1);
      });

      await runAsyncTest('4.17 Core pack layer status metadata, duplicate guard & backup compatibility', async () => {
        englishPackService.resetTestingOverrides();
        let networkCalls = 0;
        englishPackService.setTestingOverrides({
          platform: 'android',
          nativeBridge: {
            async getPackStatus() {
              return {
                installed: true,
                dbPath: tmpV3CorePath,
                dbSizeBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
                partialBytes: 0,
                availableBytes: 1_500_000_000,
                inProgress: false,
                datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
                schemaVersion: 3,
                packLayer: 'core',
                acceptedEntries: 75000,
                distinctHeadwords: 45317,
                totalSenses: 190672,
                corePrimarySenses: 75000,
                totalWordForms: 134837,
                extendedInstalled: false,
                extendedDbPath: '',
                extendedDbSizeBytes: 0,
              };
            },
            async installPack() {
              networkCalls++;
              return { installed: true };
            },
            async cancelInstall() { return { cancelled: true }; },
            async removePack() { return { removed: true, availableBytes: 1_500_000_000 }; },
            async verifyInstalledPack() {
              return {
                installed: true,
                dbPath: tmpV3CorePath,
                dbSizeBytes: ENGLISH_PACK_MANIFEST.uncompressedSizeBytes,
                datasetVersion: ENGLISH_PACK_MANIFEST.packVersion,
                acceptedEntries: 75000,
              };
            },
            async getMemoryMetrics() {
              return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
            },
            async addListener() { return { remove: async () => {} }; },
          },
        });

        const status = await englishPackService.refreshStatus();
        assert.strictEqual(status.packLayer, 'core');
        assert.strictEqual(status.schemaVersion, 3);
        assert.strictEqual(status.corePrimarySenses, 75000);
        assert.strictEqual(status.totalWordForms, 134837);
        assert.strictEqual(status.extendedInstalled, false);

        const installCheck = await englishPackService.installEnglishPack();
        assert.strictEqual(installCheck.alreadyInstalled, true);
        assert.strictEqual(networkCalls, 0, 'Duplicate v0.4.0-core install must make 0 network requests');
      });
    } finally {
      if (fs.existsSync(tmpV3CorePath)) fs.unlinkSync(tmpV3CorePath);
      if (fs.existsSync(tmpV3ExtPath)) fs.unlinkSync(tmpV3ExtPath);
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
