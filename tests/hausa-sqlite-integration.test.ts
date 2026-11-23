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
  setHausaSqliteIntegrationEnabled,
  isHausaSqliteIntegrationEnabled,
} from '../src/config/hausaDictionaryConfig';
import {
  hausaPackService,
  HausaPackInstallError,
} from '../src/services/hausaPackService';
import { hausaSqliteRepo } from '../src/services/hausaSqliteRepository';
import { hausaConflictReviewService } from '../src/services/hausaConflictReviewService';
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

function createHausaSchemaV4TestDatabase(corePath: string, extPath: string): void {
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
      script_variant TEXT,
      script_variant_norm TEXT,
      pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
      primary_ipa TEXT,
      audio_file TEXT,
      dialect TEXT,
      definition_ha TEXT,
      definition_en TEXT,
      primary_definition TEXT NOT NULL,
      definition_type TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      has_conflict INTEGER NOT NULL DEFAULT 0,
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
      definition_ha,
      definition_en,
      primary_definition,
      content='',
      detail=none,
      tokenize = 'unicode61 remove_diacritics 1'
    );

    INSERT INTO metadata VALUES ('schema_version', '4');
    INSERT INTO metadata VALUES ('pack_layer', 'core');
    INSERT INTO metadata VALUES ('pack_version', '0.5.0-core');
    INSERT INTO metadata VALUES ('dataset_version', '2026.11-hausa-schema-v4-test');
    INSERT INTO metadata VALUES ('accepted_entries', '6');
    INSERT INTO metadata VALUES ('distinct_headwords', '6');
    INSERT INTO metadata VALUES ('total_senses', '8');
    INSERT INTO metadata VALUES ('core_primary_senses', '6');
    INSERT INTO metadata VALUES ('total_word_forms', '6');

    INSERT INTO sources VALUES (
      1, 'hawiktionary', 'Hausa Wiktionary (ha.wiktionary.org)',
      'CC BY-SA 4.0 & GFDL', 'Copyright Wikimedia Contributors.',
      'https://ha.wiktionary.org/', '2026.11-hausa-schema-v4-test'
    );
    INSERT INTO sources VALUES (
      2, 'kaikki-en-wikt', 'English Wiktionary Hausa via Kaikki.org',
      'CC BY-SA 4.0 & GFDL', 'Copyright Wikimedia Contributors & Kaikki.',
      'https://kaikki.org/dictionary/Hausa/', '2026.11-hausa-schema-v4-test'
    );

    INSERT INTO parts_of_speech (id, name) VALUES (1, 'noun');
    INSERT INTO parts_of_speech (id, name) VALUES (2, 'verb');

    INSERT INTO entries (
      id, headword, headword_lower, headword_norm, script_variant, script_variant_norm,
      pos_id, primary_ipa, audio_file, dialect, definition_ha, definition_en,
      primary_definition, definition_type, verification_status, has_conflict, source_id
    ) VALUES (
      1, 'ruwa', 'ruwa', 'ruwa', 'رُوَا', 'روا',
      1, '[rúwá:]', 'Ha-ruwa.ogg', 'Standard Hausa',
      'Wani ruwa mai tsabta da ake sha kuma ake amfani da shi wajen rayuwa.',
      'water; liquid',
      'Wani ruwa mai tsabta da ake sha kuma ake amfani da shi wajen rayuwa.',
      'bilingual_explanation', 'human_verified', 0, 1
    );
    INSERT INTO entries VALUES (
      2, 'ƙofa', 'ƙofa', 'kofa', 'قُوفَا', 'قوفا',
      1, '[kó.fá:]', NULL, 'Standard Hausa',
      'Matokara ce da ake rufe ɗaki ko shago da ita.',
      'door; gateway',
      'Matokara ce da ake rufe ɗaki ko shago da ita.',
      'bilingual_explanation', 'community_reviewed', 0, 1
    );
    INSERT INTO entries VALUES (
      3, 'kasa', 'kasa', 'kasa', NULL, NULL,
      1, '[ká.sà]', NULL, 'Standard Hausa',
      'Dabbar rarrafe mai tsawo marar ƙafafuwa.',
      'puff adder snake',
      'Dabbar rarrafe mai tsawo marar ƙafafuwa.',
      'bilingual_explanation', 'community_reviewed', 0, 1
    );
    INSERT INTO entries VALUES (
      4, 'ƙasa', 'ƙasa', 'kasa', 'قَسَا', 'قسا',
      1, '[ƙá.sàː]', NULL, 'Standard Hausa',
      'Ƙasar da ake takawa ko noma a kai; kuma ƙasa tana nufin yanki mai iyaka.',
      'earth; land; country',
      'Ƙasar da ake takawa ko noma a kai; kuma ƙasa tana nufin yanki mai iyaka.',
      'bilingual_explanation', 'conflict_flagged', 1, 1
    );
    INSERT INTO entries VALUES (
      5, 'ɓarka', 'ɓarka', 'barka', NULL, NULL,
      1, '[ɓár.kàː]', NULL, 'Standard Hausa',
      NULL,
      'blessing, well-wishing',
      'blessing, well-wishing',
      'english_gloss', 'community_reviewed', 0, 2
    );
    INSERT INTO entries VALUES (
      6, 'sannu', 'sannu', 'sannu', NULL, NULL,
      1, '[sán.nú:]', NULL, 'Standard Hausa',
      'Gaisuwar girmamawa ko ta taimako ga mutum.',
      NULL,
      'Gaisuwar girmamawa ko ta taimako ga mutum.',
      'hausa_monolingual', 'community_reviewed', 0, 1
    );

    INSERT INTO word_forms VALUES (1, 1, 'ruwaye', 'ruwaye');
    INSERT INTO word_forms VALUES (2, 1, 'ruwan', 'ruwan');
    INSERT INTO word_forms VALUES (3, 2, 'ƙofofi', 'kofofi');
    INSERT INTO word_forms VALUES (4, 3, 'kasashe', 'kasashe');
    INSERT INTO word_forms VALUES (5, 4, 'ƙasashe', 'kasashe');
    INSERT INTO word_forms VALUES (6, 5, 'ɓarkoni', 'barkoni');

    INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition)
      VALUES (1, 'ruwa', 'Wani ruwa mai tsabta da ake sha kuma ake amfani da shi wajen rayuwa.', 'water; liquid', 'Wani ruwa mai tsabta da ake sha kuma ake amfani da shi wajen rayuwa.');
    INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition)
      VALUES (2, 'ƙofa', 'Matokara ce da ake rufe ɗaki ko shago da ita.', 'door; gateway', 'Matokara ce da ake rufe ɗaki ko shago da ita.');
    INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition)
      VALUES (3, 'kasa', 'Dabbar rarrafe mai tsawo marar ƙafafuwa.', 'puff adder snake', 'Dabbar rarrafe mai tsawo marar ƙafafuwa.');
    INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition)
      VALUES (4, 'ƙasa', 'Ƙasar da ake takawa ko noma a kai; kuma ƙasa tana nufin yanki mai iyaka.', 'earth; land; country', 'Ƙasar da ake takawa ko noma a kai; kuma ƙasa tana nufin yanki mai iyaka.');
    INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition)
      VALUES (5, 'ɓarka', '', 'blessing, well-wishing', 'blessing, well-wishing');
    INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition)
      VALUES (6, 'sannu', 'Gaisuwar girmamawa ko ta taimako ga mutum.', '', 'Gaisuwar girmamawa ko ta taimako ga mutum.');

    CREATE INDEX idx_entries_lower ON entries(headword_lower);
    CREATE INDEX idx_entries_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;
    CREATE INDEX idx_entries_script ON entries(script_variant_norm) WHERE script_variant_norm IS NOT NULL;
    CREATE INDEX idx_word_forms_form ON word_forms(form);
    CREATE INDEX idx_word_forms_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;
  `);
  coreDb.close();

  const extDb = createCompatDb(extPath, false);
  const sampleExamples = JSON.stringify([
    { sourceText: 'Ruwan ya shiga ɗaki.', targetText: 'Water entered the room.', attribution: 'Tatoeba (CC BY 2.0 FR)' },
  ]);
  const sampleSynonyms = JSON.stringify(['ruwan sha']);
  const sampleIpas = JSON.stringify([{ ipa: '[rúwá:]', tags: ['Standard'] }, { ipa: '[rwá:]', tags: ['Rapid'] }]);
  const sampleAudioRefs = JSON.stringify([
    { file: 'Ha-ruwa.ogg', oggUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Ha-ruwa.ogg', license: 'Wikimedia Commons (CC BY-SA)' },
  ]);
  const sampleConflictVersions = JSON.stringify([
    {
      sourceCode: 'hawiktionary',
      sourceName: 'Hausa Wiktionary',
      license: 'CC BY-SA 4.0 & GFDL',
      definitionHa: 'Ƙasar da ake takawa ko noma a kai.',
      definitionEn: 'earth; soil',
      definitionType: 'bilingual_explanation',
      verificationStatus: 'community_reviewed',
    },
    {
      sourceCode: 'kaikki-en-wikt',
      sourceName: 'English Wiktionary via Kaikki',
      license: 'CC BY-SA 4.0 & GFDL',
      definitionHa: null,
      definitionEn: 'country; state; downward direction',
      definitionType: 'english_gloss',
      verificationStatus: 'conflict_flagged',
    },
  ]);

  extDb.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE senses_ext (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      sense_number INTEGER NOT NULL,
      part_of_speech TEXT,
      definition_ha TEXT,
      definition_en TEXT,
      definition_type TEXT,
      source_id INTEGER,
      verification_status TEXT,
      examples TEXT,
      synonyms TEXT,
      antonyms TEXT
    );
    CREATE TABLE entry_extensions (
      entry_id INTEGER PRIMARY KEY,
      all_ipas TEXT,
      etymology TEXT,
      audio_refs TEXT,
      conflict_notes TEXT
    );
    CREATE TABLE conflict_reviews (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      headword TEXT NOT NULL,
      part_of_speech TEXT NOT NULL,
      conflicting_sources_json TEXT NOT NULL,
      disagreement_nature TEXT NOT NULL,
      review_decision TEXT NOT NULL DEFAULT 'pending',
      reviewer_status TEXT NOT NULL DEFAULT 'conflict_flagged',
      review_notes TEXT
    );

    INSERT INTO metadata VALUES ('schema_version', '4');
    INSERT INTO metadata VALUES ('pack_layer', 'extended');
    INSERT INTO metadata VALUES ('pack_version', '0.5.0-extended');

    INSERT INTO senses_ext VALUES (
      1, 1, 1, 'noun',
      'Wani ruwa mai tsabta da ake sha kuma ake amfani da shi wajen rayuwa.',
      'water; liquid',
      'bilingual_explanation', 1, 'human_verified',
      '${sampleExamples.replace(/'/g, "''")}',
      '${sampleSynonyms.replace(/'/g, "''")}',
      '[]'
    );
    INSERT INTO senses_ext VALUES (
      2, 1, 2, 'noun',
      'Ruwan sama da ke sauka daga gajimare.',
      'rain; precipitation',
      'bilingual_explanation', 1, 'community_reviewed',
      '[]', '[]', '[]'
    );

    INSERT INTO entry_extensions VALUES (
      1,
      '${sampleIpas.replace(/'/g, "''")}',
      'From Proto-Chadic *rəw-',
      '${sampleAudioRefs.replace(/'/g, "''")}',
      NULL
    );

    INSERT INTO conflict_reviews VALUES (
      1, 4, 'ƙasa', 'noun',
      '${sampleConflictVersions.replace(/'/g, "''")}',
      'Polysemy across soil/country/downward senses between HaWikt and Kaikki.',
      'pending', 'conflict_flagged', NULL
    );
  `);
  extDb.close();
}

async function main() {
  console.log('\n==============================================================');
  console.log('LEXICA HAUSA SCHEMA v4 INTEGRATION & VERIFICATION TEST SUITE');
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

  const tmpCorePath = path.join(os.tmpdir(), `lexica_hausa_v4_core_test_${process.pid}.db`);
  const tmpExtPath = path.join(os.tmpdir(), `lexica_hausa_v4_ext_test_${process.pid}.db`);
  createHausaSchemaV4TestDatabase(tmpCorePath, tmpExtPath);

  try {
    await runAsyncTest('H.1 Schema v4 Manifest & Dual-Pack Validation (Core 0.5.0 + Extended Companion)', async () => {
      const res = validateHausaPackManifest(HAUSA_PACK_MANIFEST);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(HAUSA_PACK_MANIFEST.targetLanguage, 'ha');
      assert.strictEqual(HAUSA_PACK_MANIFEST.schemaVersion, 4);
      assert.strictEqual(HAUSA_PACK_MANIFEST.packVersion, '0.5.0-core');
      assert.strictEqual(HAUSA_PACK_MANIFEST.acceptedEntries, 10201);
      assert.strictEqual(HAUSA_PACK_MANIFEST.distinctHeadwords, 9893);
      assert.strictEqual(HAUSA_PACK_MANIFEST.totalSenses, 15010);
      assert.strictEqual(HAUSA_PACK_MANIFEST.hausaMonolingualCount, 6180);
      assert.strictEqual(HAUSA_PACK_MANIFEST.bilingualExplanationCount, 2556);
      assert.strictEqual(HAUSA_PACK_MANIFEST.englishGlossOnlyCount, 1465);
      assert.strictEqual(HAUSA_PACK_MANIFEST.extendedCompanion?.packVersion, '0.5.0-extended');
      assert.strictEqual(HAUSA_PACK_MANIFEST.extendedCompanion?.autoDownload, false);
      assert(HAUSA_PACK_MANIFEST.sourceAttributions.length === 5);
      assert(/0 entries from Ƙamusun Hausa/i.test(HAUSA_PACK_MANIFEST.kamusunHausaStatusNote));

      const badRes = validateHausaPackManifest({
        packId: 'ha-lexica-schema-v4',
        downloadUrl: 'http://insecure.example/db.gz',
        compressedSha256: 'bad-sha',
      });
      assert.strictEqual(badRes.valid, false);
      assert(badRes.missingOrInvalidFields.includes('downloadUrl'));
      assert(badRes.missingOrInvalidFields.includes('compressedSha256'));
    });

    await runAsyncTest('H.2 Schema v4 Lookup: exact, hooked-consonant discrimination (k/ƙ, b/ɓ), Ajami, morphology & EN-to-HA', async () => {
      hausaPackService.resetTestingOverrides();
      setHausaSqliteIntegrationEnabled(true);
      const exec = new NodeSqliteExecutor(tmpCorePath);
      await exec.open(tmpCorePath);
      hausaSqliteRepo._injectExecutor(exec);

      // 1. Exact case-insensitive Hausa bilingual entry
      const ruwa = await searchHausaStandardUnified('RUWA');
      assert.strictEqual(ruwa.status, 'ok');
      assert.strictEqual(ruwa.engineSource, 'sqlite-ha');
      assert.strictEqual(ruwa.results[0].entry.headword, 'ruwa');
      assert.strictEqual(ruwa.results[0].entry.definitionType, 'bilingual_explanation');
      assert(ruwa.results[0].entry.definitionHa && ruwa.results[0].entry.definitionHa.includes('tsabta'));
      assert.strictEqual(ruwa.results[0].entry.definitionEn, 'water; liquid');
      assert.strictEqual(ruwa.results[0].entry.isCoreOnly, true);

      // 2. Hooked consonant accuracy: searching "ƙasa" MUST NOT flatten to unrelated "kasa"
      const kasaHooked = await searchHausaStandardUnified('ƙasa');
      assert.strictEqual(kasaHooked.status, 'ok');
      assert.strictEqual(kasaHooked.results[0].entry.headword, 'ƙasa');
      assert(!kasaHooked.results.some((r) => r.entry.headword === 'kasa'), 'Hooked query ƙasa must never return unrelated plain kasa');

      // Plain ASCII fallback: searching "kofa" finds "ƙofa"
      const kofaAscii = await searchHausaStandardUnified('kofa');
      assert.strictEqual(kofaAscii.status, 'ok');
      assert.strictEqual(kofaAscii.results[0].entry.headword, 'ƙofa');
      assert.strictEqual(kofaAscii.results[0].matchedField, 'headword-normalized');

      // 3. Ajami Arabic-script lookup (exact & diacritic-normalized)
      const ajamiExact = await searchHausaStandardUnified('رُوَا');
      assert.strictEqual(ajamiExact.status, 'ok');
      assert.strictEqual(ajamiExact.results[0].entry.headword, 'ruwa');
      assert.strictEqual(ajamiExact.results[0].matchedField, 'script-variant');

      const ajamiUnvoweled = await searchHausaStandardUnified('قوفا');
      assert.strictEqual(ajamiUnvoweled.status, 'ok');
      assert.strictEqual(ajamiUnvoweled.results[0].entry.headword, 'ƙofa');

      // 4. Morphology / inflected word form lookup
      const formHooked = await searchHausaStandardUnified('kofofi');
      assert.strictEqual(formHooked.status, 'ok');
      assert.strictEqual(formHooked.results[0].entry.headword, 'ƙofa');
      assert.strictEqual(formHooked.results[0].matchedField, 'morphology');

      // 5. English-to-Hausa lookup + FTS5 definition search
      const enWater = await searchHausaStandardUnified('water');
      assert.strictEqual(enWater.status, 'ok');
      assert(enWater.results.some((r) => r.entry.headword === 'ruwa'));

      // 6. Honest separation of english_gloss vs hausa_monolingual
      const barka = await searchHausaStandardUnified('ɓarka');
      assert.strictEqual(barka.status, 'ok');
      assert.strictEqual(barka.results[0].entry.definitionType, 'english_gloss');
      assert.strictEqual(barka.results[0].entry.definitionHa, null);

      const sannu = await searchHausaStandardUnified('sannu');
      assert.strictEqual(sannu.status, 'ok');
      assert.strictEqual(sannu.results[0].entry.definitionType, 'hausa_monolingual');
      assert(sannu.results[0].entry.definitionHa && sannu.results[0].entry.definitionHa.includes('Gaisuwar'));
    });

    await runAsyncTest('H.3 Core pagination, available letters, getEntriesByIds & restart persistence', async () => {
      const letters = await hausaSqliteRepo.getAvailableLetters();
      assert(letters.includes('R') && letters.includes('Ƙ') && letters.includes('Ɓ'));

      const page1 = await searchHausaStandardUnified('', { limit: 3, offset: 0 });
      assert.strictEqual(page1.status, 'ok');
      assert.strictEqual(page1.results.length, 3);
      assert.strictEqual(page1.totalCount, 6);
      assert.strictEqual(page1.hasMore, true);

      const page2 = await searchHausaStandardUnified('', { limit: 3, offset: 3 });
      assert.strictEqual(page2.status, 'ok');
      assert.strictEqual(page2.results.length, 3);
      assert.strictEqual(page2.hasMore, false);

      const byIds = await hausaSqliteRepo.getEntriesByIds(['ha-1', 'ha-2']);
      assert.strictEqual(byIds.length, 2);
      assert(byIds.some((e) => e.headword === 'ruwa'));
      assert(byIds.some((e) => e.headword === 'ƙofa'));

      // Simulate restart persistence
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
              schemaVersion: 4,
              packLayer: 'core',
              acceptedEntries: 6,
              distinctHeadwords: 6,
              totalSenses: 8,
              corePrimarySenses: 6,
              totalWordForms: 6,
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

    await runAsyncTest('H.4 Extended Schema v4 attachment enriches senses, audio refs, examples & conflict queue cleanly; detaching preserves Core', async () => {
      const exec = new NodeSqliteExecutor(tmpCorePath);
      await exec.open(tmpCorePath);
      hausaSqliteRepo._injectExecutor(exec);
      hausaSqliteRepo._injectExtendedDbPathForTest(tmpExtPath);

      const ruwaExt = await searchHausaStandardUnified('ruwa');
      assert.strictEqual(ruwaExt.status, 'ok');
      assert.strictEqual(ruwaExt.results[0].entry.isCoreOnly, false);
      assert.strictEqual(ruwaExt.results[0].entry.extendedInstalled, true);
      assert.strictEqual(ruwaExt.results[0].senses.length, 2);
      assert.strictEqual(ruwaExt.results[0].entry.allIpas?.length, 2);
      assert.strictEqual(ruwaExt.results[0].entry.etymology, 'From Proto-Chadic *rəw-');
      assert.strictEqual(ruwaExt.results[0].entry.audioRefs?.[0]?.file, 'Ha-ruwa.ogg');
      assert.strictEqual(ruwaExt.results[0].senses[0].examples[0]?.sourceText, 'Ruwan ya shiga ɗaki.');
      assert.strictEqual(ruwaExt.results[0].senses[0].examples[0]?.targetText, 'Water entered the room.');

      // Conflict review preservation & internal QA workflow
      const qRes = await hausaSqliteRepo.getConflictReviewQueue(20, 0);
      assert.strictEqual(qRes.totalCount, 1);
      assert.strictEqual(qRes.items[0].headword, 'ƙasa');
      assert.strictEqual(qRes.items[0].conflictingVersions.length, 2);

      hausaConflictReviewService.clearForTesting();
      const recorded = hausaConflictReviewService.saveReviewDecision({
        entryId: qRes.items[0].entryId,
        headword: qRes.items[0].headword,
        partOfSpeech: qRes.items[0].partOfSpeech,
        conflictingVersions: qRes.items[0].conflictingVersions,
        disagreementNature: qRes.items[0].disagreementNature,
        reviewDecision: 'keep_both',
        reviewerStatus: 'approved_human_verified',
        reviewNotes: 'Confirmed polysemy: soil/earth and country.',
      });
      assert.strictEqual(recorded.reviewerStatus, 'approved_human_verified');
      const reloaded = await hausaSqliteRepo.getConflictReviewQueue(20, 0);
      assert.strictEqual(reloaded.items[0].reviewDecision, 'keep_both');
      hausaConflictReviewService.clearForTesting();

      // Detach Extended -> Core stays intact offline
      hausaSqliteRepo._injectExtendedDbPathForTest(null);
      await hausaSqliteRepo.closeConnection();
      await exec.open(tmpCorePath);
      const ruwaCoreAgain = await searchHausaStandardUnified('ruwa');
      assert.strictEqual(ruwaCoreAgain.status, 'ok');
      assert.strictEqual(ruwaCoreAgain.results[0].entry.isCoreOnly, true);
      assert.strictEqual(ruwaCoreAgain.results[0].entry.extendedInstalled, false);
      assert.strictEqual(ruwaCoreAgain.results[0].senses.length, 1);
    });

    await runAsyncTest('H.5 Extended pack install/remove preserves Core + installer failure recovery + feature flag reversibility & regression check', async () => {
      hausaPackService.resetTestingOverrides();
      let coreExists = true;
      let extExists = false;
      const calls: Array<{ method: string; layer?: string }> = [];

      hausaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return {
              installed: coreExists,
              dbPath: coreExists ? tmpCorePath : '',
              dbSizeBytes: coreExists ? HAUSA_PACK_MANIFEST.uncompressedSizeBytes : 0,
              partialBytes: 0,
              availableBytes: 1_500_000_000,
              inProgress: false,
              datasetVersion: HAUSA_PACK_MANIFEST.packVersion,
              schemaVersion: 4,
              packLayer: 'core',
              acceptedEntries: HAUSA_PACK_MANIFEST.acceptedEntries,
              distinctHeadwords: HAUSA_PACK_MANIFEST.distinctHeadwords,
              totalSenses: HAUSA_PACK_MANIFEST.totalSenses,
              corePrimarySenses: HAUSA_PACK_MANIFEST.corePrimarySenses,
              totalWordForms: HAUSA_PACK_MANIFEST.totalWordForms,
              extendedInstalled: extExists,
              extendedDbPath: extExists ? tmpExtPath : '',
              extendedDbSizeBytes: extExists ? HAUSA_PACK_MANIFEST.extendedCompanion!.uncompressedSizeBytes : 0,
            };
          },
          async installPack(opts) {
            calls.push({ method: 'installPack', layer: opts.packLayer });
            if (opts.packLayer === 'extended') {
              extExists = true;
              return { installed: true, extendedInstalled: true, extendedDbPath: tmpExtPath };
            }
            coreExists = true;
            return { installed: true };
          },
          async cancelInstall() { return { cancelled: true }; },
          async removePack(opts) {
            calls.push({ method: 'removePack', layer: opts?.packLayer });
            if (opts?.packLayer === 'extended') {
              extExists = false;
              return { removed: true, availableBytes: 1_500_000_000 };
            }
            coreExists = false;
            extExists = false;
            return { removed: true, availableBytes: 1_500_000_000 };
          },
          async verifyInstalledPack() {
            return { installed: coreExists, extendedInstalled: extExists };
          },
          async getMemoryMetrics() {
            return { javaHeapUsedBytes: 0, javaHeapMaxBytes: 0, nativeHeapAllocatedBytes: 0, systemAvailMemBytes: 0, systemTotalMemBytes: 0, lowMemory: false };
          },
          async addListener() { return { remove: async () => {} }; },
        },
      });

      const status = await hausaPackService.refreshStatus();
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.extendedInstalled, false);

      // Install Extended -> then remove Extended only -> Core remains installed!
      const afterExtInstall = await hausaPackService.installExtendedPack();
      assert.strictEqual(afterExtInstall.extendedInstalled, true);
      assert.strictEqual(afterExtInstall.installed, true);

      const afterExtRemove = await hausaPackService.removeExtendedPack();
      assert.strictEqual(afterExtRemove.extendedInstalled, false);
      assert.strictEqual(afterExtRemove.installed, true, 'Removing Extended pack must leave Hausa Core installed');

      // Interrupted / SHA-256 tamper rejection preserves existing Core safely
      hausaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return { installed: false, dbPath: '', dbSizeBytes: 0, partialBytes: 262144, availableBytes: 500_000_000, inProgress: false };
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

      // Reversibility switch: disabling SQLite falls back cleanly to starter corpus
      setHausaSqliteIntegrationEnabled(false);
      assert.strictEqual(isHausaSqliteIntegrationEnabled(), false);
      const fallbackStarter = await searchHausaStandardUnified('sannu');
      assert.strictEqual(fallbackStarter.engineSource, 'starter-corpus');
      setHausaSqliteIntegrationEnabled(true);

      // Android uninstalled state returns explicit language_not_installed
      hausaSqliteRepo._injectExecutor(null);
      const uninstalled = await searchHausaStandardUnified('ruwa');
      assert.strictEqual(uninstalled.status, 'language_not_installed');
      assert.strictEqual(uninstalled.engineSource, 'sqlite-ha');

      // Other bundled language packs remain untouched & functional
      for (const [term, lang] of [
        ['omi', 'yo'],
        ['ndiyam', 'ff'],
        ['سلام', 'ar'],
        ['bonjour', 'fr'],
        ['水', 'zh'],
      ] as const) {
        const res = dictionaryDb.searchStandard(term, lang);
        assert.strictEqual(res.status, 'ok', `Starter search failed for ${lang}:${term}`);
      }
      const enHaMulti = dictionaryDb.searchMultilingual('water', 'en', 'ha');
      assert.strictEqual(enHaMulti.status, 'ok');
    });

    // H.6: Verify real built Schema v4 artifacts in /tmp/hausa_core_v050/
    const builtCorePath = '/tmp/hausa_core_v050/lexica_hausa_core.db';
    const builtExtPath = '/tmp/hausa_core_v050/lexica_hausa_extended.db';
    if (fs.existsSync(builtCorePath)) {
      await runAsyncTest('H.6 Full built Hausa Schema v4 Core & Extended SQLite DB verification (10,201 entries)', async () => {
        const db = createCompatDb(builtCorePath, true);
        const qc = db.prepare('PRAGMA quick_check;').all() as Array<Record<string, string>>;
        assert.strictEqual(Object.values(qc[0])[0], 'ok');

        const counts = db.prepare('SELECT COUNT(*) AS cnt FROM entries;').all() as Array<{ cnt: number }>;
        assert.strictEqual(counts[0].cnt, 10201);

        const missingDefs = db.prepare("SELECT COUNT(*) AS cnt FROM entries WHERE primary_definition IS NULL OR length(trim(primary_definition)) = 0;").all() as Array<{ cnt: number }>;
        assert.strictEqual(missingDefs[0].cnt, 0);

        const fakeDefs = db.prepare("SELECT COUNT(*) AS cnt FROM entries WHERE lower(trim(primary_definition)) IN ('hausa lexical entry.', 'hausa entry.', 'kalmar tana nufin');").all() as Array<{ cnt: number }>;
        assert.strictEqual(fakeDefs[0].cnt, 0, 'Zero fabricated placeholders allowed');

        const machineGen = db.prepare("SELECT COUNT(*) AS cnt FROM entries WHERE definition_type = 'machine_generated';").all() as Array<{ cnt: number }>;
        assert.strictEqual(machineGen[0].cnt, 0, 'Zero machine-generated definitions allowed');

        constwf: {
          const wfCounts = db.prepare('SELECT COUNT(*) AS cnt FROM word_forms;').all() as Array<{ cnt: number }>;
          assert.strictEqual(wfCounts[0].cnt, 5581);
          break constwf;
        }
        db.close();

        // Query real DB through HausaSqliteRepository
        const exec = new NodeSqliteExecutor(builtCorePath);
        await exec.open(builtCorePath);
        hausaSqliteRepo._injectExecutor(exec);
        hausaSqliteRepo._injectExtendedDbPathForTest(fs.existsSync(builtExtPath) ? builtExtPath : null);

        const realKofa = await searchHausaStandardUnified('kofa');
        assert.strictEqual(realKofa.status, 'ok');
        assert(realKofa.results.some((r) => r.entry.headword.toLowerCase() === 'ƙofa'));

        // Hooked vs plain distinction in production dataset
        const realKasaHooked = await searchHausaStandardUnified('ƙasa');
        assert.strictEqual(realKasaHooked.status, 'ok');
        assert(!realKasaHooked.results.some((r) => r.entry.headword.toLowerCase() === 'kasa'));

        const realRuwa = await searchHausaStandardUnified('ruwa');
        assert.strictEqual(realRuwa.status, 'ok');
        assert(realRuwa.results[0].senses.length >= 1);
        assert(realRuwa.results[0].entry.definitionHa && realRuwa.results[0].entry.definitionHa.length > 0);

        // English-to-Hausa lookup on real DB
        const enWater = await searchHausaStandardUnified('water');
        assert.strictEqual(enWater.status, 'ok');
        assert(enWater.results.some((r) => /ruwa|kogi|bado/i.test(r.entry.headword)));

        const enHouse = await searchHausaStandardUnified('house');
        assert.strictEqual(enHouse.status, 'ok');
        assert(enHouse.results.length >= 1);

        // Conflict review queue on real Extended DB
        if (fs.existsSync(builtExtPath)) {
          const queue = await hausaSqliteRepo.getConflictReviewQueue(25, 0);
          assert.strictEqual(queue.totalCount, 352);
          assert.strictEqual(queue.items.length, 25);
        }

        const bench = await hausaSqliteRepo.runBenchmark();
        assert.strictEqual(bench.totalEntriesVerified, 10201);
        assert(bench.exactHeadwordMs >= 0);

        await hausaSqliteRepo.closeConnection();
      });
    }
  } finally {
    setHausaSqliteIntegrationEnabled(true);
    hausaSqliteRepo._injectExecutor(null);
    hausaSqliteRepo._injectExtendedDbPathForTest(null);
    hausaPackService.resetTestingOverrides();
    hausaConflictReviewService.clearForTesting();
    if (fs.existsSync(tmpCorePath)) fs.unlinkSync(tmpCorePath);
    if (fs.existsSync(tmpExtPath)) fs.unlinkSync(tmpExtPath);
  }

  console.log('\n==============================================================');
  console.log(`HAUSA SCHEMA v4 INTEGRATION RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('==============================================================\n');
}

void main();
