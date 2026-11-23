import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { YORUBA_PACK_MANIFEST, validateYorubaPackManifest } from '../src/config/yorubaDictionaryConfig';
import { yorubaSqliteRepo, YorubaSqliteRepository } from '../src/services/yorubaSqliteRepository';
import { evaluateYorubaConflicts, normalizeYorubaKey } from '../src/services/yorubaDefinitionValidator';

const require = createRequire(import.meta.url);
let NodeDatabaseSync: (new (path: string, opts?: { readOnly?: boolean }) => {
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
  close(): void;
}) | null = null;

try {
  const mod = require('node:sqlite') as { DatabaseSync?: typeof NodeDatabaseSync };
  if (mod?.DatabaseSync) NodeDatabaseSync = mod.DatabaseSync;
} catch {
  NodeDatabaseSync = null;
}

class NodeSqliteExecutor {
  private db: InstanceType<NonNullable<typeof NodeDatabaseSync>> | null = null;
  private dbPath: string | null = null;

  public isOpen(): boolean {
    return this.db !== null;
  }

  public getDbPath(): string | null {
    return this.dbPath;
  }

  public async open(dbPath: string): Promise<void> {
    if (!NodeDatabaseSync) throw new Error('node:sqlite DatabaseSync not available.');
    this.db = new NodeDatabaseSync(dbPath, { readOnly: true });
    this.dbPath = dbPath;
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.dbPath = null;
  }

  public async query<T = Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not open.');
    const stmt = this.db.prepare(statement);
    return stmt.all(...values) as T[];
  }
}

async function main() {
  console.log('\n==============================================================');
  console.log('LEXICA YORUBA SCHEMA v4 INTEGRATION & VERIFICATION TEST SUITE');
  console.log('==============================================================\n');

  let passed = 0;
  let total = 0;

  async function runTest(name: string, fn: () => Promise<void> | void) {
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

  await runTest('Y.1 Schema v4 Manifest & Dual-Pack Validation', () => {
    const val = validateYorubaPackManifest(YORUBA_PACK_MANIFEST);
    assert.strictEqual(val.valid, true, val.message);
    assert.strictEqual(YORUBA_PACK_MANIFEST.targetLanguage, 'yo');
    assert.strictEqual(YORUBA_PACK_MANIFEST.schemaVersion, 4);
    assert.ok(YORUBA_PACK_MANIFEST.extendedCompanion);
    assert.strictEqual(YORUBA_PACK_MANIFEST.extendedCompanion.packLayer, 'extended');
  });

  await runTest('Y.2 Tone & Under-dot Preservation & Minimum Pair Separation', () => {
    const w1 = 'ọ̀rọ̀'; // low-low
    const w2 = 'ọ́rọ́'; // high-high
    assert.notStrictEqual(normalizeYorubaKey(w1, true), normalizeYorubaKey(w2, true));
    
    // Check built files exist
    assert.strictEqual(fs.existsSync('lexica_yoruba_core.db'), true);
    assert.strictEqual(fs.existsSync('lexica_yoruba_extended.db'), true);
    assert.strictEqual(fs.existsSync('lexica_yoruba_core.db.gz'), true);
    assert.strictEqual(fs.existsSync('lexica_yoruba_extended.db.gz'), true);
  });

  await runTest('Y.3 SQLite Database Integrity & Quick Check', () => {
    if (!NodeDatabaseSync) {
      console.log('Skipping node:sqlite quick_check (Node < 22.5)');
      return;
    }
    const dbCore = new NodeDatabaseSync('lexica_yoruba_core.db', { readOnly: true });
    const resCore = dbCore.prepare('PRAGMA quick_check;').all();
    dbCore.close();
    assert.strictEqual((resCore[0] as { quick_check: string }).quick_check, 'ok');

    const dbExt = new NodeDatabaseSync('lexica_yoruba_extended.db', { readOnly: true });
    const resExt = dbExt.prepare('PRAGMA quick_check;').all();
    dbExt.close();
    assert.strictEqual((resExt[0] as { quick_check: string }).quick_check, 'ok');
  });

  await runTest('Y.4 Core-only and Extended Attachment Integration via Repository', async () => {
    const repo = new YorubaSqliteRepository(new NodeSqliteExecutor() as unknown as import('../src/services/englishSqliteRepository').SqlQueryExecutor);
    const nodeExec = repo['executor'] as unknown as NodeSqliteExecutor;
    await nodeExec.open('lexica_yoruba_core.db');
    repo['activeCorePath'] = 'lexica_yoruba_core.db';

    // Verify core standalone query
    const entry = await repo.getEntryById('yo-sqlite-1');
    assert.ok(entry);
    assert.strictEqual(entry.headword, 'ilé');

    // Attach extended companion
    const attached = await repo.attachExtendedCompanion('lexica_yoruba_extended.db');
    assert.strictEqual(attached, true);

    const fullEntry = await repo.getEntryById('yo-sqlite-3');
    assert.ok(fullEntry);
    assert.ok(fullEntry.senses && fullEntry.senses.length > 0);

    await repo.close();
  });

  await runTest('Y.5 Duplicate and Conflict Review Queue Verification', () => {
    const records = [
      {
        headword: 'ọ̀rọ̀',
        partOfSpeech: 'noun',
        definitionYo: 'Ọ̀rọ̀ túmọ̀ sí ohun tí a sọ.',
        definitionType: 'yoruba_monolingual' as const,
        source: 'yo.wiktionary.org',
        license: 'CC BY-SA 4.0',
      },
      {
        headword: 'ọ̀rọ̀',
        partOfSpeech: 'noun',
        definitionYo: 'Ọ̀rọ̀ ni ọ̀rọ̀ sísọ.',
        definitionType: 'yoruba_monolingual' as const,
        source: 'Academic Corpus 2024',
        license: 'CC BY 4.0',
      },
    ];
    const conflicts = evaluateYorubaConflicts(records);
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].conflictType, 'tonal_variant');
  });

  console.log(`\n==============================================================`);
  console.log(`RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log(`==============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
