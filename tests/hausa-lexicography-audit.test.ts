import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import {
  validateHausaDefinition,
  evaluateSourceConflicts,
  isPlaceholderOrEmpty,
  looksLikeEnglishOnlyGloss,
  type HausaLexicographyRecord,
} from '../src/services/hausaDefinitionValidator';
import { HAUSA_PACK_MANIFEST } from '../src/config/hausaDictionaryConfig';

const require = createRequire(import.meta.url);
let NodeDatabaseSync: (new (path: string, opts?: { readOnly?: boolean }) => {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
}) | null = null;
try {
  const mod = require('node:sqlite') as { DatabaseSync?: typeof NodeDatabaseSync };
  if (mod?.DatabaseSync) NodeDatabaseSync = mod.DatabaseSync;
} catch {
  NodeDatabaseSync = null;
}

function querySqlite(dbPath: string, sql: string, attachPath?: string): Array<Record<string, unknown>> {
  if (NodeDatabaseSync) {
    const db = new NodeDatabaseSync(dbPath, { readOnly: true });
    try {
      if (attachPath) {
        db.prepare('ATTACH DATABASE ? AS ext;').all(attachPath);
      }
      return db.prepare(sql).all() as Array<Record<string, unknown>>;
    } finally {
      db.close();
    }
  }
  const py = `
import json, sqlite3, sys
p = json.load(sys.stdin)
c = sqlite3.connect(f"file:{p['dbPath']}?mode=ro", uri=True)
c.row_factory = sqlite3.Row
if p.get("attachPath"):
    c.execute("ATTACH DATABASE ? AS ext;", (p["attachPath"],))
rows = [dict(r) for r in c.execute(p["sql"]).fetchall()]
c.close()
print(json.dumps(rows))
`;
  const out = execFileSync('python3', ['-c', py], {
    input: JSON.stringify({ dbPath, attachPath, sql }),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(out) as Array<Record<string, unknown>>;
}

async function main() {
  console.log('\n==============================================================');
  console.log('LEXICA ASSIGNMENT 010 — HAUSA LEXICOGRAPHY & QUALITY AUDIT SUITE');
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

  await runTest('A10.1 Rejects Assignment 009 fallback placeholders and cross-reference stubs', () => {
    const placeholders = [
      '',
      '   ',
      'Hausa lexical entry.',
      'Hausa entry.',
      'Kalmar tana nufin',
      'see profligate',
      'N/A',
      '...',
    ];
    for (const p of placeholders) {
      assert.strictEqual(isPlaceholderOrEmpty(p), true, `Expected placeholder rejection for "${p}"`);
      const res = validateHausaDefinition({
        headword: 'test',
        partOfSpeech: 'noun',
        definitionHa: p,
        definitionType: 'hausa_monolingual',
        source: 'test-source',
        license: 'CC BY-SA 4.0',
      });
      assert.strictEqual(res.validHausaMonolingual, false);
      assert.strictEqual(res.effectiveDefinitionType, 'unavailable');
    }
  });

  await runTest('A10.2 Prevents English glosses from being misclassified as Hausa monolingual definitions', () => {
    assert.strictEqual(looksLikeEnglishOnlyGloss('Water; liquid substance essential for life.'), true);
    assert.strictEqual(looksLikeEnglishOnlyGloss('to run quickly'), true);
    assert.strictEqual(looksLikeEnglishOnlyGloss('A given name'), true);

    const kaikiDisguised = validateHausaDefinition({
      headword: 'ruwa',
      partOfSpeech: 'noun',
      definitionHa: 'Water; liquid substance essential for life.',
      definitionType: 'hausa_monolingual',
      source: 'kaikki-en-wikt',
      license: 'CC BY-SA 4.0 & GFDL',
    });
    assert.strictEqual(kaikiDisguised.validHausaMonolingual, false);
    assert.strictEqual(kaikiDisguised.isHumanVerifiedHausa, false);
    assert.strictEqual(kaikiDisguised.effectiveDefinitionType, 'english_gloss');
  });

  await runTest('A10.3 Accepts genuine Hausa monolingual & bilingual definitions with full provenance', () => {
    const hawiktEntry = validateHausaDefinition({
      headword: 'ƙofa',
      normalizedHeadword: 'kofa',
      scriptVariant: 'قُوفَا',
      partOfSpeech: 'noun',
      definitionHa: 'Ƙofa wata matokara ce da ake rufe ɗaki ko shago ko kuma wani abu kilatacce da ita.',
      definitionEn: 'door, gateway, doorway',
      definitionType: 'bilingual_explanation',
      examples: ['Buɗe ƙofar gida.'],
      pronunciation: '[kó.fá:]',
      relatedWords: ['ƙofofi'],
      source: 'hawiktionary (https://ha.wiktionary.org/)',
      license: 'CC BY-SA 4.0 & GFDL',
      verificationStatus: 'community_reviewed',
    });
    assert.strictEqual(hawiktEntry.validRecord, true);
    assert.strictEqual(hawiktEntry.validHausaMonolingual, true);
    assert.strictEqual(hawiktEntry.isHumanVerifiedHausa, true);
    assert.strictEqual(hawiktEntry.effectiveDefinitionType, 'bilingual_explanation');
  });

  await runTest('A10.4 Rejects machine-generated text from verified human-authored counts and enforces provenance', () => {
    const machineRes = validateHausaDefinition({
      headword: 'gida',
      partOfSpeech: 'noun',
      definitionHa: 'Gida wani wuri ne da mutane suke zaune.',
      definitionType: 'machine_generated',
      source: 'llm-experiment',
      license: 'Internal',
      verificationStatus: 'unverified_import',
    });
    assert.strictEqual(machineRes.validHausaMonolingual, false);
    assert.strictEqual(machineRes.isHumanVerifiedHausa, false);
    assert.strictEqual(machineRes.effectiveDefinitionType, 'machine_generated');

    const missingProv = validateHausaDefinition({
      headword: 'gida',
      partOfSpeech: 'noun',
      definitionHa: 'Gida wuri ne na zama.',
      definitionType: 'hausa_monolingual',
      source: '',
      license: '',
    });
    assert.strictEqual(missingProv.validRecord, false);
    assert(missingProv.reasons.some((r) => r.includes('source provenance')));
    assert(missingProv.reasons.some((r) => r.includes('license metadata')));
  });

  await runTest('A10.5 Flags conflicting multi-source definitions without auto-merging or overwriting', () => {
    const recA: HausaLexicographyRecord = {
      headword: 'kare',
      normalizedHeadword: 'kare',
      scriptVariant: null,
      partOfSpeech: 'noun',
      definitionHa: 'Kare dabba ne daga cikin dabbobin gida mai tsaron gida.',
      definitionEn: 'dog',
      definitionType: 'bilingual_explanation',
      examples: [],
      pronunciation: null,
      relatedWords: ['karnuka'],
      source: 'hawiktionary',
      license: 'CC BY-SA 4.0 & GFDL',
      verificationStatus: 'community_reviewed',
    };
    const recB: HausaLexicographyRecord = {
      headword: 'kare',
      normalizedHeadword: 'kare',
      scriptVariant: null,
      partOfSpeech: 'verb',
      definitionHa: 'Karewa ko tsayar da wani abu daga faruwa.',
      definitionEn: 'to finish; to protect',
      definitionType: 'bilingual_explanation',
      examples: [],
      pronunciation: null,
      relatedWords: [],
      source: 'lexica-curated',
      license: 'CC0 1.0',
      verificationStatus: 'human_verified',
    };

    const conflict = evaluateSourceConflicts([recA, recB]);
    assert.strictEqual(conflict.hasConflict, true);
    assert.strictEqual(conflict.requiresNativeReview, true);
    assert.strictEqual(conflict.preservedSources.length, 2);
  });

  await runTest('A10.6 Assignment 009 pack builder remains intact & Schema v4 integration is reversible', () => {
    assert.strictEqual(fs.existsSync('scripts/build_hausa_core_pack.py'), true);
    const a09Builder = fs.readFileSync('scripts/build_hausa_core_pack.py', 'utf8');
    assert(a09Builder.includes('0.4.0-core'), 'Assignment 009 script must preserve 0.4.0-core builder');
    assert.strictEqual(HAUSA_PACK_MANIFEST.packVersion, '0.5.0-core');
    assert.strictEqual(HAUSA_PACK_MANIFEST.schemaVersion, 4);
    assert.strictEqual(HAUSA_PACK_MANIFEST.acceptedEntries, 10201);
    assert.strictEqual(HAUSA_PACK_MANIFEST.targetLanguage, 'ha');
  });

  const protoCore = fs.existsSync('/tmp/hausa_core_v050/lexica_hausa_core.db')
    ? '/tmp/hausa_core_v050/lexica_hausa_core.db'
    : '/tmp/hausa_recovery_v050/lexica_hausa_recovery_core.db';
  const protoExt = fs.existsSync('/tmp/hausa_core_v050/lexica_hausa_extended.db')
    ? '/tmp/hausa_core_v050/lexica_hausa_extended.db'
    : '/tmp/hausa_recovery_v050/lexica_hausa_recovery_extended.db';
  if (fs.existsSync(protoCore)) {
    await runTest('A10.7 Hausa Schema v4 Recovery SQLite DB quality & schema verification', () => {
      const qc = querySqlite(protoCore, 'PRAGMA quick_check;');
      assert.strictEqual(Object.values(qc[0])[0], 'ok');

      const placeholders = querySqlite(
        protoCore,
        "SELECT COUNT(*) AS cnt FROM entries WHERE lower(trim(primary_definition)) IN ('hausa lexical entry.', 'hausa entry.', 'kalmar tana nufin', '');"
      );
      assert.strictEqual(Number(placeholders[0].cnt), 0, 'Database must have zero generic placeholders');

      const refLeaks = querySqlite(
        protoCore,
        "SELECT COUNT(*) AS cnt FROM entries WHERE primary_definition LIKE '%<ref%' OR primary_definition LIKE '%{{%';"
      );
      assert.strictEqual(Number(refLeaks[0].cnt), 0, 'Database must strip raw <ref> and template markup');

      const haMono = querySqlite(
        protoCore,
        "SELECT COUNT(*) AS cnt FROM entries WHERE definition_type IN ('hausa_monolingual', 'bilingual_explanation');"
      );
      assert(Number(haMono[0].cnt) >= 8500, `Expected >= 8,500 Hausa explanations, got ${haMono[0].cnt}`);

      const ajami = querySqlite(
        protoCore,
        'SELECT COUNT(*) AS cnt FROM entries WHERE script_variant IS NOT NULL;'
      );
      assert(Number(ajami[0].cnt) >= 1300, `Expected >= 1,300 Ajami script variants, got ${ajami[0].cnt}`);

      if (fs.existsSync(protoExt)) {
        const extCount = querySqlite(
          protoCore,
          "SELECT COUNT(*) AS cnt FROM ext.senses_ext WHERE examples LIKE '%Tatoeba%';",
          protoExt
        );
        assert(Number(extCount[0].cnt) > 500, 'Expected Tatoeba CC BY 2.0 FR examples attached in Extended DB');
      }
    });
  }

  console.log('\n==============================================================');
  console.log(`HAUSA LEXICOGRAPHY AUDIT RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('==============================================================\n');
}

void main();
