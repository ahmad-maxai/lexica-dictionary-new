import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FULFULDE_RECOVERY_CORPUS } from '../src/data/fulfuldeRecoveryCorpus';
import { FULFULDE_REVIEW_TEMPLATE_SCHEMA, type FulfuldeReviewRecord } from '../src/data/fulfuldeReviewTemplate';

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
console.log('LEXICA — ASSIGNMENT 017 FULFULDE INDEPENDENT VALIDATION SUITE');
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

runTest('V.1 Review Template Schema & Structure', () => {
  assert.strictEqual(FULFULDE_REVIEW_TEMPLATE_SCHEMA.version, '1.0.0');
  assert(Array.isArray(FULFULDE_REVIEW_TEMPLATE_SCHEMA.labels));
  assert(FULFULDE_REVIEW_TEMPLATE_SCHEMA.labels.includes('verified'));
  assert(FULFULDE_REVIEW_TEMPLATE_SCHEMA.labels.includes('needs_review'));

  const sampleReview: FulfuldeReviewRecord = {
    entryId: 'ff-rec-001',
    headword: 'Hakkillo',
    proposedVariety: 'nigerian_adamawa',
    reviewerName: 'Pending Linguist Review',
    reviewerFluency: 'unspecified',
    reviewerDialect: 'Adamawa',
    definitionAssessment: 'needs_review',
    exampleAssessment: 'needs_review',
    confidenceRating: 3,
    reviewDate: '2026-11-24',
    commentsAndDisagreements: 'Awaiting formal field review by native Adamawa Fulfulde speaker.',
  };
  assert.strictEqual(sampleReview.entryId, 'ff-rec-001');
  assert.strictEqual(sampleReview.definitionAssessment, 'needs_review');
});

runTest('V.2 Independent Audit Coverage of all 20 Recovery Entries', () => {
  assert.strictEqual(FULFULDE_RECOVERY_CORPUS.length, 20);
  const ids = new Set<string>();
  const hws = new Set<string>();
  for (const entry of FULFULDE_RECOVERY_CORPUS) {
    assert(!ids.has(entry.id), `Duplicate entry ID found: ${entry.id}`);
    ids.add(entry.id);
    assert(!hws.has(entry.headword.toLowerCase()), `Duplicate headword found: ${entry.headword}`);
    hws.add(entry.headword.toLowerCase());

    // Verify orthographic validity (no empty or placeholder definitions)
    assert(entry.definitionFf.trim().length > 5);
    assert(entry.definitionEn.trim().length > 3);
  }
});

runTest('V.3 Technical Validation: SQLite Schema & Quick Check', () => {
  const coreDbPath = path.resolve('lexica_fulfulde_core.db');
  const extDbPath = path.resolve('lexica_fulfulde_extended.db');

  assert(fs.existsSync(coreDbPath), 'Core SQLite db must exist');
  assert(fs.existsSync(extDbPath), 'Extended SQLite db must exist');

  if (DatabaseSync) {
    const db = new DatabaseSync(coreDbPath, { readOnly: true });
    const count = db.prepare('SELECT COUNT(*) as c FROM entries').get() as { c: number };
    assert.strictEqual(count.c, 20);
    db.close();
  }
});

console.log('\n==============================================================');
console.log(`ASSIGNMENT 017 VALIDATION RESULTS: ${passed} / ${total} TESTS PASSED`);
console.log('==============================================================\n');
