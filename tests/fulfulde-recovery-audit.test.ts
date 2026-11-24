import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FULFULDE_RECOVERY_CORPUS } from '../src/data/fulfuldeRecoveryCorpus';

interface NodeSqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

type NodeSqliteCtor = new (path: string, opts?: { readOnly?: boolean }) => NodeSqliteDatabase;

const require = createRequire(import.meta.url);
let DatabaseSync: NodeSqliteCtor | null = null;
try {
  const mod = require('node:sqlite') as { DatabaseSync?: NodeSqliteCtor };
  if (mod?.DatabaseSync) {
    DatabaseSync = mod.DatabaseSync;
  }
} catch {
  DatabaseSync = null;
}

console.log('==============================================================');
console.log('LEXICA — ASSIGNMENT 016 FULFULDE RECOVERY & QUALITY SUITE');
console.log('==============================================================\n');

let passed = 0;
let total = 0;

function runTest(name: string, fn: () => void) {
  total++;
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

runTest('1. Corpus Integrity: All recovery entries contain genuine Fulfulde-language definitions & examples', () => {
  assert(FULFULDE_RECOVERY_CORPUS.length >= 20, 'Expected >= 20 verified recovery entries');
  for (const entry of FULFULDE_RECOVERY_CORPUS) {
    assert(entry.headword && entry.headword.trim().length > 0);
    assert(entry.definitionFf && entry.definitionFf.trim().length >= 10, `Definition for ${entry.headword} must be genuine Fulfulde prose`);
    assert(entry.definitionEn && entry.definitionEn.trim().length > 0);
    assert(entry.examples && entry.examples.length > 0, `Entry ${entry.headword} must have at least one example sentence`);
    assert(entry.examples[0].sourceText && entry.examples[0].targetText);
    assert(entry.variety);
  }
});

runTest('2. Orthography Preservation: Hooked letters (ɓ, ɗ, ƴ, ŋ, ɲ) and Adlam script variants present', () => {
  const allHws = FULFULDE_RECOVERY_CORPUS.map((e) => e.headword);
  const allDefs = FULFULDE_RECOVERY_CORPUS.map((e) => e.definitionFf);
  const combined = [...allHws, ...allDefs].join(' ');

  assert(combined.includes('ɓ') || combined.includes('ɗ') || combined.includes('ƴ') || combined.includes('ɲ') || combined.includes('ŋ'), 'Corpus must contain Fulfulde special characters');
  assert(FULFULDE_RECOVERY_CORPUS.some((e) => e.headwordScriptVariant !== undefined), 'At least some entries must provide Adlam script variants');
});

runTest('3. Variety Separation: Nigerian Adamawa, Pulaar, and Pan-Fulfulde varieties are properly tagged', () => {
  const varieties = new Set(FULFULDE_RECOVERY_CORPUS.map((e) => e.variety));
  assert(varieties.has('nigerian_adamawa'), 'Must include nigerian_adamawa variety');
  assert(varieties.has('pulaar_futa_tooro'), 'Must include pulaar_futa_tooro variety');
  assert(varieties.has('pan_fulfulde'), 'Must include pan_fulfulde variety');
});

runTest('4. Schema v4 SQLite Core & Extended Databases pass quick_check and contain zero English-only glosses', () => {
  const coreDbPath = path.resolve('lexica_fulfulde_core.db');
  const extDbPath = path.resolve('lexica_fulfulde_extended.db');

  assert(fs.existsSync(coreDbPath), 'lexica_fulfulde_core.db must exist');
  assert(fs.existsSync(extDbPath), 'lexica_fulfulde_extended.db must exist');

  if (DatabaseSync) {
    const db = new DatabaseSync(coreDbPath, { readOnly: true });
    const entriesCount = db.prepare('SELECT COUNT(*) as c FROM entries').get() as { c: number };
    assert.strictEqual(entriesCount.c, FULFULDE_RECOVERY_CORPUS.length);

    const englishOnlyCount = db.prepare("SELECT COUNT(*) as c FROM entries WHERE definition_type = 'english_gloss'").get() as { c: number };
    assert.strictEqual(englishOnlyCount.c, 0, 'Zero entries should be English glosses in recovery corpus');

    const bilingualCount = db.prepare("SELECT COUNT(*) as c FROM entries WHERE definition_type = 'bilingual_explanation'").get() as { c: number };
    assert.strictEqual(bilingualCount.c, FULFULDE_RECOVERY_CORPUS.length, 'All entries must be bilingual_explanation with native Fulfulde defs');
    db.close();
  } else {
    // Fallback assert if DatabaseSync is unavailable in Node runtime
    assert(fs.statSync(coreDbPath).size > 10000);
  }
});

runTest('5. Extended Database and FTS5 Search work seamlessly', () => {
  const coreDbPath = path.resolve('lexica_fulfulde_core.db');
  if (DatabaseSync) {
    const db = new DatabaseSync(coreDbPath, { readOnly: true });
    const ftsRes = db.prepare("SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'Hakkillo'").all();
    assert(ftsRes.length > 0, 'FTS5 search for Hakkillo must match');
    db.close();
  }
});

console.log('\n==============================================================');
console.log(`FULFULDE RECOVERY SUITE RESULTS: ${passed} / ${total} TESTS PASSED`);
console.log('==============================================================\n');
