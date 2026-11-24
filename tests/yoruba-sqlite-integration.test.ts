import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  YORUBA_PACK_MANIFEST,
  validateYorubaPackManifest,
  isYorubaSqliteIntegrationEnabled,
  setYorubaSqliteIntegrationEnabled,
} from '../src/config/yorubaDictionaryConfig';
import {
  yorubaPackService,
  YorubaPackInstallError,
} from '../src/services/yorubaPackService';
import { yorubaSqliteRepo, YorubaSqliteRepository } from '../src/services/yorubaSqliteRepository';
import { searchYorubaStandardUnified } from '../src/services/yorubaSearchCoordinator';
import { evaluateYorubaConflicts, normalizeYorubaKey } from '../src/services/yorubaDefinitionValidator';
import { dictionaryDb } from '../src/services/dictionaryDatabase';
import { TextNormalization } from '../src/services/textNormalization';

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

function querySqlitePython<T = unknown>(
  dbPath: string,
  sql: string,
  params: unknown[] = [],
  attachPath?: string | null
): T[] {
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

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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
        try {
          this.db.prepare(statement).all(...values);
        } catch {
          // ignore
        }
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

  try {
    await runTest('Y.1 Schema v4 Manifest & Dual-Pack Validation', () => {
      const val = validateYorubaPackManifest(YORUBA_PACK_MANIFEST);
      assert.strictEqual(val.valid, true, val.message);
      assert.strictEqual(YORUBA_PACK_MANIFEST.targetLanguage, 'yo');
      assert.strictEqual(YORUBA_PACK_MANIFEST.schemaVersion, 4);
      assert.strictEqual(YORUBA_PACK_MANIFEST.releaseTag, 'prototype-yo-core-v0.5.1');
      assert.ok(YORUBA_PACK_MANIFEST.extendedCompanion);
      assert.strictEqual(YORUBA_PACK_MANIFEST.extendedCompanion.packLayer, 'extended');
      assert.strictEqual(YORUBA_PACK_MANIFEST.acceptedEntries, 5804);
      assert.strictEqual(YORUBA_PACK_MANIFEST.distinctHeadwords, 5542);
      assert.strictEqual(YORUBA_PACK_MANIFEST.totalSenses, 8024);
    });

    await runTest('Y.2 Tone & Under-dot Preservation & Minimum Pair Separation', () => {
      const w1 = 'ọ̀rọ̀'; // low-low
      const w2 = 'ọ́rọ́'; // high-high
      assert.notStrictEqual(normalizeYorubaKey(w1, true), normalizeYorubaKey(w2, true));

      const norm1 = TextNormalization.normalizeYoruba('Ọ̀rọ̀');
      const norm2 = TextNormalization.normalizeYoruba('Ọ́rọ́');
      assert.notStrictEqual(norm1.exact, norm2.exact);
      assert.strictEqual(norm1.toneInsensitive, 'ọrọ');
      assert.strictEqual(norm1.ascii, 'oro');
      assert.strictEqual(norm1.hasToneMarks, true);
      assert.strictEqual(norm1.hasUnderDots, true);

      // Check built files exist and match manifest sizes & SHA-256 hashes
      assert.strictEqual(fs.existsSync('lexica_yoruba_core.db'), true);
      assert.strictEqual(fs.existsSync('lexica_yoruba_extended.db'), true);
      assert.strictEqual(fs.existsSync('lexica_yoruba_core.db.gz'), true);
      assert.strictEqual(fs.existsSync('lexica_yoruba_extended.db.gz'), true);

      assert.strictEqual(fs.statSync('lexica_yoruba_core.db').size, YORUBA_PACK_MANIFEST.uncompressedSizeBytes);
      assert.strictEqual(fs.statSync('lexica_yoruba_core.db.gz').size, YORUBA_PACK_MANIFEST.compressedSizeBytes);
      assert.strictEqual(sha256File('lexica_yoruba_core.db'), YORUBA_PACK_MANIFEST.uncompressedSha256);
      assert.strictEqual(sha256File('lexica_yoruba_core.db.gz'), YORUBA_PACK_MANIFEST.compressedSha256);

      assert.strictEqual(
        fs.statSync('lexica_yoruba_extended.db').size,
        YORUBA_PACK_MANIFEST.extendedCompanion!.uncompressedSizeBytes
      );
      assert.strictEqual(
        fs.statSync('lexica_yoruba_extended.db.gz').size,
        YORUBA_PACK_MANIFEST.extendedCompanion!.compressedSizeBytes
      );
      assert.strictEqual(
        sha256File('lexica_yoruba_extended.db'),
        YORUBA_PACK_MANIFEST.extendedCompanion!.uncompressedSha256
      );
      assert.strictEqual(
        sha256File('lexica_yoruba_extended.db.gz'),
        YORUBA_PACK_MANIFEST.extendedCompanion!.compressedSha256
      );
    });

    await runTest('Y.3 SQLite Database Integrity, Clean Entry Counts & Zero Cloned/Fake Rows', () => {
      const qcCore = querySqlitePython<{ quick_check: string }>('lexica_yoruba_core.db', 'PRAGMA quick_check;');
      assert.strictEqual(qcCore[0].quick_check, 'ok');
      const qcExt = querySqlitePython<{ quick_check: string }>('lexica_yoruba_extended.db', 'PRAGMA quick_check;');
      assert.strictEqual(qcExt[0].quick_check, 'ok');

      const counts = querySqlitePython<{ cnt: number; dist: number; max_id: number }>(
        'lexica_yoruba_core.db',
        'SELECT COUNT(*) AS cnt, COUNT(DISTINCT headword_lower) AS dist, MAX(id) AS max_id FROM entries;'
      )[0];
      assert.strictEqual(counts.cnt, 5804);
      assert.strictEqual(counts.dist, 5542);
      assert.notStrictEqual(counts.cnt, 70, 'Must never revert to 70-entry starter corpus');

      const clonedSuffixRows = querySqlitePython<{ cnt: number }>(
        'lexica_yoruba_core.db',
        "SELECT COUNT(*) AS cnt FROM entries WHERE headword GLOB '*_[0-9]*';"
      )[0];
      assert.strictEqual(clonedSuffixRows.cnt, 0, 'Cloned _N synthetic entries must be completely absent');

      const machineGen = querySqlitePython<{ cnt: number }>(
        'lexica_yoruba_core.db',
        "SELECT COUNT(*) AS cnt FROM entries WHERE definition_type = 'machine_generated';"
      )[0];
      assert.strictEqual(machineGen.cnt, 0);

      const extCounts = querySqlitePython<{ senses: number; exts: number; conflicts: number }>(
        'lexica_yoruba_extended.db',
        'SELECT (SELECT COUNT(*) FROM senses_ext) AS senses, (SELECT COUNT(*) FROM entry_extensions) AS exts, (SELECT COUNT(*) FROM conflict_reviews) AS conflicts;'
      )[0];
      assert.strictEqual(extCounts.senses, 8024);
      assert.strictEqual(extCounts.exts, 5578);
      assert.strictEqual(extCounts.conflicts, 75);
    });

    await runTest('Y.4 Core Standalone, Extended Attachment & Live Repository Stats Verification', async () => {
      const repo = new YorubaSqliteRepository(
        new NodeSqliteExecutor() as unknown as import('../src/services/englishSqliteRepository').SqlQueryExecutor
      );
      const nodeExec = repo['executor'] as unknown as NodeSqliteExecutor;
      await nodeExec.open('lexica_yoruba_core.db');

      // Core standalone search & live stats (no Extended attached yet)
      const coreStats = await repo.getInstalledStats();
      assert.strictEqual(coreStats.acceptedEntries, 5804);
      assert.strictEqual(coreStats.distinctHeadwords, 5542);
      assert.strictEqual(coreStats.totalSenses, 5804);
      assert.strictEqual(coreStats.bilingualLinksCount, 5790);
      assert.strictEqual(coreStats.extendedAttached, false);

      const ileCoreSearch = await repo.searchStandard('ilé', { strictDiacritics: true });
      assert.strictEqual(ileCoreSearch.status, 'ok');
      assert.strictEqual(ileCoreSearch.engineSource, 'sqlite-yo');
      assert.ok(ileCoreSearch.results.length >= 1);
      const ileId = ileCoreSearch.results[0].entry.id;

      const ileCoreEntry = await repo.getEntryById(ileId);
      assert.ok(ileCoreEntry);
      assert.strictEqual(ileCoreEntry.headword.toLowerCase(), 'ilé');
      assert.strictEqual(ileCoreEntry.isCoreOnly, true);
      assert.ok(ileCoreEntry.definitionYo && ileCoreEntry.definitionYo.length > 0);
      assert.ok(ileCoreEntry.definitionEn && ileCoreEntry.definitionEn.length > 0);

      // Attach extended companion -> totalSenses upgrades live from 5804 -> 8024
      const attached = await repo.attachExtendedCompanion('lexica_yoruba_extended.db');
      assert.strictEqual(attached, true);

      const extStats = await repo.getInstalledStats();
      assert.strictEqual(extStats.acceptedEntries, 5804);
      assert.strictEqual(extStats.totalSenses, 8024);
      assert.strictEqual(extStats.extendedAttached, true);

      const fullEntry = await repo.getEntryById(ileId);
      assert.ok(fullEntry);
      assert.strictEqual(fullEntry.extendedInstalled, true);
      assert.ok(fullEntry.senses && fullEntry.senses.length >= 1);

      // Conflict review queue reads real 75 Extended conflicts
      const queue = await repo.getConflictReviewQueue(20, 0);
      assert.strictEqual(queue.totalCount, 75);
      assert.strictEqual(queue.items.length, 20);

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

    await runTest('Y.6 Tonal Minimum-Pair Isolation vs Flexible Tone/ASCII Search in Production DB', async () => {
      const exec = new NodeSqliteExecutor();
      await exec.open('lexica_yoruba_core.db');
      yorubaSqliteRepo._injectExecutor(exec);
      yorubaSqliteRepo._injectExtendedDbPathForTest('lexica_yoruba_extended.db');

      // Exact tone search for igbá (calabash) vs igbà (time/period)
      const strictIgbaHigh = await yorubaSqliteRepo.searchStandard('igbá', { strictDiacritics: true });
      assert.strictEqual(strictIgbaHigh.status, 'ok');
      assert.ok(strictIgbaHigh.results.some((r) => r.entry.headword.toLowerCase() === 'igbá'));
      assert.ok(
        !strictIgbaHigh.results.some((r) => r.entry.headword.toLowerCase() === 'igbà'),
        'Exact tone search for igbá must not match igbà'
      );

      // Flexible / tone-insensitive search for "oro" returns distinct tonal entries separately
      const flexOro = await yorubaSqliteRepo.searchStandard('oro', { strictDiacritics: false, limit: 25 });
      assert.strictEqual(flexOro.status, 'ok');
      const headwords = new Set(flexOro.results.map((r) => r.entry.headword.toLowerCase()));
      assert.ok(headwords.has('ọ̀rọ̀') || headwords.has('oró') || headwords.has('orò'));

      // English gloss / FTS5 lookup works offline
      const liquidRes = await yorubaSqliteRepo.searchStandard('liquid', { limit: 10 });
      assert.strictEqual(liquidRes.status, 'ok');
      assert.ok(liquidRes.results.some((r) => r.entry.headword.toLowerCase() === 'omi'));

      const waterRes = await yorubaSqliteRepo.searchStandard('water', { limit: 10 });
      assert.strictEqual(waterRes.status, 'ok');
      assert.ok(waterRes.results.some((r) => /adágún|momi|mumi|kànga/i.test(r.entry.headword)));

      const bench = await yorubaSqliteRepo.runBenchmark();
      assert.strictEqual(bench.totalEntriesVerified, 5804);

      await yorubaSqliteRepo.closeConnection();
      yorubaSqliteRepo._injectExecutor(null);
      yorubaSqliteRepo._injectExtendedDbPathForTest(null);
    });

    await runTest('Y.7 Runtime Repair: Corrupt/0-row DB Guard, Android No-Starter-Fallback & Extended Lifecycle', async () => {
      yorubaPackService.resetTestingOverrides();
      yorubaSqliteRepo._injectExecutor(null);

      // Simulate broken/0-entry Android bridge response -> must be rejected to installed=false with 0 counts
      yorubaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return {
              installed: true,
              dbPath: '/data/user/0/com.lexica.dictionary/files/lexica_yorubaSQLite.db',
              acceptedEntries: 0,
              distinctHeadwords: 0,
              totalSenses: 0,
            };
          },
          async installPack() {
            throw new Error('Not expected');
          },
          async cancelInstall() {
            return { cancelled: true };
          },
          async removePack() {
            return { removed: true, availableBytes: 500_000_000 };
          },
          async verifyInstalledPack() {
            return { installed: false, acceptedEntries: 0 };
          },
          async getMemoryMetrics() {
            return {
              javaHeapUsedBytes: 0,
              javaHeapMaxBytes: 0,
              nativeHeapAllocatedBytes: 0,
              systemAvailMemBytes: 0,
              systemTotalMemBytes: 0,
              lowMemory: false,
            };
          },
          async addListener() {
            return { remove: async () => {} };
          },
        },
      });

      const rejectedStatus = await yorubaPackService.refreshStatus();
      assert.strictEqual(rejectedStatus.installed, false, '0-row DB response must never appear installed');
      assert.strictEqual(rejectedStatus.acceptedEntries, 0);
      assert.strictEqual(rejectedStatus.totalSenses, 0);

      // Android uninstalled state MUST return explicit language_not_installed (NEVER 70-entry starter corpus)
      const uninstalledSearch = await searchYorubaStandardUnified('ilé');
      assert.strictEqual(uninstalledSearch.status, 'language_not_installed');
      assert.strictEqual(uninstalledSearch.engineSource, 'sqlite-yo');
      assert.strictEqual(uninstalledSearch.results.length, 0);

      // Simulate valid Android Core + Extended install/remove lifecycle
      let coreInstalled = true;
      let extInstalled = false;
      yorubaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return {
              installed: coreInstalled,
              dbPath: coreInstalled ? 'lexica_yoruba_core.db' : '',
              dbSizeBytes: coreInstalled ? YORUBA_PACK_MANIFEST.uncompressedSizeBytes : 0,
              partialBytes: 0,
              availableBytes: 1_500_000_000,
              inProgress: false,
              datasetVersion: YORUBA_PACK_MANIFEST.packVersion,
              schemaVersion: 4,
              packLayer: 'core',
              acceptedEntries: coreInstalled ? YORUBA_PACK_MANIFEST.acceptedEntries : 0,
              distinctHeadwords: coreInstalled ? YORUBA_PACK_MANIFEST.distinctHeadwords : 0,
              totalSenses: coreInstalled
                ? extInstalled
                  ? YORUBA_PACK_MANIFEST.totalSenses
                  : YORUBA_PACK_MANIFEST.corePrimarySenses
                : 0,
              corePrimarySenses: coreInstalled ? YORUBA_PACK_MANIFEST.corePrimarySenses : 0,
              totalWordForms: coreInstalled ? YORUBA_PACK_MANIFEST.totalWordForms : 0,
              extendedInstalled: extInstalled,
              extendedDbPath: extInstalled ? 'lexica_yoruba_extended.db' : '',
              extendedDbSizeBytes: extInstalled
                ? YORUBA_PACK_MANIFEST.extendedCompanion!.uncompressedSizeBytes
                : 0,
            };
          },
          async installPack(opts) {
            if (opts.packLayer === 'extended') {
              extInstalled = true;
              return {
                installed: true,
                dbPath: 'lexica_yoruba_core.db',
                acceptedEntries: YORUBA_PACK_MANIFEST.acceptedEntries,
                totalSenses: YORUBA_PACK_MANIFEST.totalSenses,
                extendedInstalled: true,
                extendedDbPath: 'lexica_yoruba_extended.db',
              };
            }
            coreInstalled = true;
            return {
              installed: true,
              dbPath: 'lexica_yoruba_core.db',
              acceptedEntries: YORUBA_PACK_MANIFEST.acceptedEntries,
            };
          },
          async cancelInstall() {
            return { cancelled: true };
          },
          async removePack(opts) {
            if (opts?.packLayer === 'extended') {
              extInstalled = false;
              return { removed: true, availableBytes: 1_500_000_000 };
            }
            coreInstalled = false;
            extInstalled = false;
            return { removed: true, availableBytes: 1_500_000_000 };
          },
          async verifyInstalledPack() {
            return {
              installed: coreInstalled,
              dbPath: coreInstalled ? 'lexica_yoruba_core.db' : '',
              acceptedEntries: coreInstalled ? YORUBA_PACK_MANIFEST.acceptedEntries : 0,
              extendedInstalled: extInstalled,
            };
          },
          async getMemoryMetrics() {
            return {
              javaHeapUsedBytes: 0,
              javaHeapMaxBytes: 0,
              nativeHeapAllocatedBytes: 0,
              systemAvailMemBytes: 0,
              systemTotalMemBytes: 0,
              lowMemory: false,
            };
          },
          async addListener() {
            return { remove: async () => {} };
          },
        },
      });

      const coreStatus = await yorubaPackService.refreshStatus();
      assert.strictEqual(coreStatus.installed, true);
      assert.strictEqual(coreStatus.acceptedEntries, 5804);
      assert.strictEqual(coreStatus.extendedInstalled, false);

      const extStatus = await yorubaPackService.installExtendedPack();
      assert.strictEqual(extStatus.installed, true);
      assert.strictEqual(extStatus.extendedInstalled, true);
      assert.strictEqual(extStatus.totalSenses, 8024);

      const afterRemoveExt = await yorubaPackService.removeExtendedPack();
      assert.strictEqual(afterRemoveExt.installed, true, 'Removing Extended must keep Yoruba Core installed');
      assert.strictEqual(afterRemoveExt.extendedInstalled, false);

      // Integrity failure throws YorubaPackInstallError cleanly
      yorubaPackService.setTestingOverrides({
        platform: 'android',
        nativeBridge: {
          async getPackStatus() {
            return { installed: false, acceptedEntries: 0 };
          },
          async installPack() {
            throw new Error('CHECKSUM_MISMATCH_COMPRESSED');
          },
          async cancelInstall() {
            return { cancelled: true };
          },
          async removePack() {
            return { removed: true, availableBytes: 500_000_000 };
          },
          async verifyInstalledPack() {
            throw new Error('NOT_INSTALLED');
          },
          async getMemoryMetrics() {
            return {
              javaHeapUsedBytes: 0,
              javaHeapMaxBytes: 0,
              nativeHeapAllocatedBytes: 0,
              systemAvailMemBytes: 0,
              systemTotalMemBytes: 0,
              lowMemory: false,
            };
          },
          async addListener() {
            return { remove: async () => {} };
          },
        },
      });
      await assert.rejects(
        () => yorubaPackService.installPack(),
        (err: unknown) => err instanceof YorubaPackInstallError && err.code === 'INSTALL_FAILED'
      );

      // Reversibility switch falls back to starter corpus cleanly when disabled
      setYorubaSqliteIntegrationEnabled(false);
      assert.strictEqual(isYorubaSqliteIntegrationEnabled(), false);
      const fallback = await searchYorubaStandardUnified('omi');
      assert.strictEqual(fallback.engineSource, 'starter-corpus');
      setYorubaSqliteIntegrationEnabled(true);

      // Existing English/Hausa/Fulfulde/Arabic/French/Chinese starter lookups remain unaffected
      const enYoMulti = dictionaryDb.searchMultilingual('water', 'en', 'yo');
      assert.strictEqual(enYoMulti.status, 'ok');
    });
  } finally {
    setYorubaSqliteIntegrationEnabled(true);
    yorubaSqliteRepo._injectExecutor(null);
    yorubaSqliteRepo._injectExtendedDbPathForTest(null);
    yorubaPackService.resetTestingOverrides();
  }

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
