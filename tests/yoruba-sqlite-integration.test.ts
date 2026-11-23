import assert from 'node:assert';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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

if (process.env.FORCE_NO_NODE_SQLITE === '1') {
  NodeDatabaseSync = null;
}

function querySqlitePython<T = unknown>(dbPath: string, sql: string, params: unknown[] = [], attachPath?: string | null): T[] {
  const py = `
import json, sqlite3, sys
payload = json.load(sys.stdin)
db_path = payload["dbPath"]
attach_path = payload.get("attachPath")
sql_text = payload.get("sql", "").strip()
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
if attach_path:
    conn.execute("ATTACH DATABASE ? AS ext;", (attach_path,))
try:
    cur = conn.execute(sql_text, payload.get("params", []))
    rows = [dict(r) for r in cur.fetchall()]
    print(json.dumps(rows))
finally:
    conn.close()
`;
  const out = execFileSync('python3', ['-c', py], {
    input: JSON.stringify({ dbPath, attachPath, sql, params }),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(out) as T[];
}

class NodeSqliteExecutor {
  private db: InstanceType<NonNullable<typeof NodeDatabaseSync>> | null = null;
  private dbPath: string | null = null;
  private attachedPath: string | null = null;

  public isOpen(): boolean {
    return this.db !== null || this.dbPath !== null;
  }

  public getDbPath(): string | null {
    return this.dbPath;
  }

  public async open(dbPath: string): Promise<void> {
    if (NodeDatabaseSync) {
      this.db = new NodeDatabaseSync(dbPath, { readOnly: true });
    }
    this.dbPath = dbPath;
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.dbPath = null;
    this.attachedPath = null;
  }

  public async query<T = Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    if (!this.isOpen() || !this.dbPath) throw new Error('Database not open.');
    const upper = statement.trim().toUpperCase();
    if (upper.startsWith('ATTACH') && values[0]) {
      this.attachedPath = String(values[0]);
      if (this.db) {
        this.db.prepare(statement).all(...values);
      }
      return [] as T[];
    }
    if (upper.startsWith('DETACH')) {
      this.attachedPath = null;
      if (this.db) {
        try { this.db.prepare(statement).all(...values); } catch { /* ignore */ }
      }
      return [] as T[];
    }
    if (this.db) {
      const stmt = this.db.prepare(statement);
      return stmt.all(...values) as T[];
    }
    return querySqlitePython<T>(this.dbPath, statement, values, this.attachedPath);
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
    if (NodeDatabaseSync) {
      const dbCore = new NodeDatabaseSync('lexica_yoruba_core.db', { readOnly: true });
      const resCore = dbCore.prepare('PRAGMA quick_check;').all();
      dbCore.close();
      assert.strictEqual((resCore[0] as { quick_check: string }).quick_check, 'ok');

      const dbExt = new NodeDatabaseSync('lexica_yoruba_extended.db', { readOnly: true });
      const resExt = dbExt.prepare('PRAGMA quick_check;').all();
      dbExt.close();
      assert.strictEqual((resExt[0] as { quick_check: string }).quick_check, 'ok');
    } else {
      const resCore = querySqlitePython<{ quick_check: string }>('lexica_yoruba_core.db', 'PRAGMA quick_check;');
      assert.strictEqual(resCore[0].quick_check, 'ok');
      const resExt = querySqlitePython<{ quick_check: string }>('lexica_yoruba_extended.db', 'PRAGMA quick_check;');
      assert.strictEqual(resExt[0].quick_check, 'ok');
    }
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
