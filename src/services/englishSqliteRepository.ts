import { CapacitorSQLite } from '@capacitor-community/sqlite';
import {
  WordEntry,
  WordSense,
  MorphologicalForm,
  StandardSearchResult,
  StandardSearchResponse,
  ExampleSentence,
  PronunciationVariant,
} from '../types/dictionary';
import { ENGLISH_PACK_MANIFEST, isEnglishSqliteIntegrationEnabled } from '../config/englishDictionaryConfig';
import { englishPackService, type DeviceMemoryMetrics } from './englishPackService';
import { TextNormalization } from './textNormalization';

export interface SqlQueryExecutor {
  open(dbPath: string): Promise<void>;
  close(): Promise<void>;
  query<T = Record<string, unknown>>(statement: string, values?: unknown[]): Promise<T[]>;
  isOpen(): boolean;
  getDbPath(): string | null;
}

class CapacitorSqliteExecutor implements SqlQueryExecutor {
  private openedPath: string | null = null;

  public isOpen(): boolean {
    return this.openedPath !== null;
  }

  public getDbPath(): string | null {
    return this.openedPath;
  }

  public async open(dbPath: string): Promise<void> {
    if (this.openedPath === dbPath) return;
    if (this.openedPath) {
      await this.close();
    }
    try {
      await CapacitorSQLite.closeNCConnection({ databasePath: dbPath });
    } catch {
      // Ignore if no stale native connection existed
    }
    await CapacitorSQLite.createNCConnection({
      databasePath: dbPath,
      version: 1,
    });
    await CapacitorSQLite.open({
      database: dbPath,
      readonly: true,
    });
    this.openedPath = dbPath;
  }

  public async close(): Promise<void> {
    if (!this.openedPath) return;
    const pathToClose = this.openedPath;
    this.openedPath = null;
    try {
      await CapacitorSQLite.closeNCConnection({ databasePath: pathToClose });
    } catch {
      // Ignore close errors if connection was already torn down
    }
  }

  public async query<T = Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    if (!this.openedPath) {
      throw new Error('English SQLite connection is not open.');
    }
    const res = await CapacitorSQLite.query({
      database: this.openedPath,
      statement,
      values,
      readonly: true,
    });
    return (res.values || []) as T[];
  }
}

interface SqlEntryRow {
  id: number;
  headword: string;
  headword_lower: string;
  part_of_speech: string;
  primary_ipa: string | null;
  all_ipas: string | null;
  audio_file: string | null;
  etymology: string | null;
  source_id: string;
  primary_definition?: string | null;
  extra_senses_count?: number | null;
}

interface SqlSenseRow {
  id: number;
  entry_id: number;
  sense_number: number;
  definition: string;
  tags: string | null;
  examples: string | null;
  synonyms: string | null;
  antonyms: string | null;
}

interface SqlWordFormRow {
  entry_id: number;
  form: string;
  form_lower: string;
  tags: string | null;
}

export interface EnglishSqliteMetadata {
  datasetName: string;
  packVersion: string;
  schemaVersion: number;
  packLayer: 'core' | 'full';
  extendedAttached: boolean;
  acceptedEntries: number;
  distinctHeadwords: number;
  totalSenses: number;
  sourceName: string;
  sourceLicense: string;
  sourceAttribution: string;
  sourceUrl: string;
  fts5Supported: boolean;
}

export interface EnglishSearchOptions {
  partOfSpeech?: string;
  letter?: string;
  limit?: number;
  offset?: number;
}

export interface EnglishBenchmarkReport {
  platform: string;
  dbPath: string;
  coldOpenMs: number;
  warmOpenMs: number;
  exactLookupMs: Record<string, number>;
  prefixSearchMs: number;
  fts5SearchMs: number;
  paginatedSearchMs: number;
  repeated100QueriesAvgMs: number;
  repeated100QueriesP95Ms: number;
  memoryMetrics: DeviceMemoryMetrics | null;
  fts5Supported: boolean;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseAllIpas(raw: string | null | undefined): PronunciationVariant[] {
  const parsed = safeJsonParse<unknown[]>(raw, []);
  const out: PronunciationVariant[] = [];
  for (const item of parsed) {
    if (Array.isArray(item) && typeof item[0] === 'string') {
      out.push({
        ipa: item[0],
        tags: Array.isArray(item[1]) ? item[1].map(String) : [],
      });
    } else if (item && typeof item === 'object' && typeof (item as { ipa?: unknown }).ipa === 'string') {
      const obj = item as { ipa: string; tags?: unknown[] };
      out.push({
        ipa: obj.ipa,
        tags: Array.isArray(obj.tags) ? obj.tags.map(String) : [],
      });
    }
  }
  return out;
}

function parseSenseExamples(raw: string | null | undefined): ExampleSentence[] {
  const parsed = safeJsonParse<unknown[]>(raw, []);
  const out: ExampleSentence[] = [];
  for (const item of parsed) {
    if (Array.isArray(item) && typeof item[0] === 'string' && item[0]) {
      const ref = typeof item[1] === 'string' && item[1] ? item[1] : undefined;
      out.push({
        sourceText: item[0],
        targetText: '',
        culturalContext: ref ? `Reference: ${ref}` : undefined,
      });
    } else if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
      const obj = item as { text: string; ref?: string };
      if (obj.text) {
        out.push({
          sourceText: obj.text,
          targetText: '',
          culturalContext: obj.ref ? `Reference: ${obj.ref}` : undefined,
        });
      }
    }
  }
  return out;
}

function escapeSqlLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function computePrefixUpperBound(prefixLower: string): string | null {
  if (!prefixLower) return null;
  const lastCode = prefixLower.charCodeAt(prefixLower.length - 1);
  if (lastCode >= 0xffff) return null;
  return prefixLower.slice(0, -1) + String.fromCharCode(lastCode + 1);
}

function buildFts5Query(rawQuery: string): string | null {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .map((tok) => tok.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((tok) => tok.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.map((tok) => `"${tok}"*`).join(' AND ');
}

function expandPartOfSpeechFilter(pos: string | undefined): string[] | null {
  if (!pos || pos === 'all') return null;
  const p = pos.trim().toLowerCase();
  if (p === 'adjective' || p === 'adj') return ['adj', 'adjective'];
  if (p === 'adverb' || p === 'adv') return ['adv', 'adverb'];
  if (p === 'phrase') return ['phrase', 'prep_phrase', 'proverb'];
  if (p === 'preposition' || p === 'prep') return ['prep', 'preposition'];
  if (p === 'pronoun' || p === 'pron') return ['pron', 'pronoun'];
  if (p === 'conjunction' || p === 'conj') return ['conj', 'conjunction'];
  if (p === 'interjection' || p === 'intj') return ['intj', 'interjection'];
  if (p === 'determiner' || p === 'det') return ['det', 'determiner'];
  return [p];
}

function formatPrimaryDialect(allIpas: PronunciationVariant[], primaryIpa: string | null): string | null {
  if (!primaryIpa || allIpas.length === 0) return null;
  const matched = allIpas.find((item) => item.ipa === primaryIpa) || allIpas[0];
  if (!matched || !Array.isArray(matched.tags) || matched.tags.length === 0) return null;
  return matched.tags.map((tag) => tag.replace(/-/g, ' ')).join(', ');
}

export class EnglishSqliteRepository {
  private executor: SqlQueryExecutor = new CapacitorSqliteExecutor();
  private customExecutorInjected = false;
  private openPromise: Promise<void> | null = null;
  private cachedMeta: EnglishSqliteMetadata | null = null;
  private schemaVersion = 1;
  private isCoreLayer = false;
  private hasHeadwordNormCol = false;
  private hasFormNormCol = false;
  private extendedDbPath: string | null = null;
  private extendedAttached = false;
  private fts5Supported = false;
  private lastColdOpenMs: number | null = null;
  private lastWarmOpenMs: number | null = null;

  constructor() {
    englishPackService.setBeforeMutateDbHook(async () => {
      await this.closeConnection();
    });
  }

  public setExecutorForTest(executor: SqlQueryExecutor | null): void {
    this.openPromise = null;
    this.cachedMeta = null;
    this.schemaVersion = 1;
    this.isCoreLayer = false;
    this.hasHeadwordNormCol = false;
    this.hasFormNormCol = false;
    this.extendedDbPath = null;
    this.extendedAttached = false;
    this.fts5Supported = false;
    if (executor) {
      this.executor = executor;
      this.customExecutorInjected = true;
    } else {
      this.executor = new CapacitorSqliteExecutor();
      this.customExecutorInjected = false;
    }
  }

  public setExtendedDbPathForTest(extendedPath: string | null): void {
    this.extendedDbPath = extendedPath;
    if ('setAttachPath' in this.executor && typeof (this.executor as { setAttachPath: unknown }).setAttachPath === 'function') {
      (this.executor as { setAttachPath: (p: string | null) => void }).setAttachPath(extendedPath);
    }
  }

  public isPackActive(): boolean {
    if (!isEnglishSqliteIntegrationEnabled()) return false;
    if (this.customExecutorInjected) {
      return this.executor.isOpen() || Boolean(this.executor.getDbPath());
    }
    return englishPackService.isNativeAndroid() && englishPackService.getCachedStatus().installed;
  }

  public async closeConnection(): Promise<void> {
    this.openPromise = null;
    this.cachedMeta = null;
    this.extendedAttached = false;
    await this.executor.close();
  }

  public async ensureOpen(explicitPath?: string): Promise<void> {
    if (this.executor.isOpen() && this.cachedMeta) return;
    if (this.openPromise) {
      await this.openPromise;
      return;
    }
    this.openPromise = (async () => {
      const t0 = performance.now();
      let targetPath = explicitPath || this.executor.getDbPath() || '';
      let detectedExtPath = this.extendedDbPath;
      if (!targetPath) {
        const status = await englishPackService.ensureStatusLoaded();
        if (!status.installed || !status.dbPath) {
          throw new Error('English offline SQLite database is not installed.');
        }
        targetPath = status.dbPath;
        if (!detectedExtPath && status.extendedInstalled && status.extendedDbPath) {
          detectedExtPath = status.extendedDbPath;
        }
      }

      await this.executor.open(targetPath);

      // Constrain page cache (~2 MB) and temp store for low-RAM Android Go compatibility
      try {
        await this.executor.query('PRAGMA cache_size = -2000;');
        await this.executor.query('PRAGMA temp_store = FILE;');
      } catch {
        // Ignore if test executor rejects PRAGMA adjustments
      }

      const [metaRows, sourceRows, posTableCheck, sensesTableCheck, entryColsInfo, wfColsInfo] = await Promise.all([
        this.executor.query<{ key: string; value: string }>('SELECT key, value FROM metadata;'),
        this.executor.query<{
          name: string;
          license: string;
          attribution_text: string;
          source_url: string;
        }>('SELECT name, license, attribution_text, source_url FROM sources LIMIT 1;'),
        this.executor.query<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='parts_of_speech';"
        ),
        this.executor.query<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='senses';"
        ),
        this.executor.query<{ name: string }>('PRAGMA table_info(entries);'),
        this.executor.query<{ name: string }>('PRAGMA table_info(word_forms);'),
      ]);

      const metaMap = new Map<string, string>();
      for (const r of metaRows) {
        metaMap.set(r.key, r.value);
      }

      const hasPosTable = Number(posTableCheck[0]?.cnt || 0) > 0;
      const hasSensesTable = Number(sensesTableCheck[0]?.cnt || 0) > 0;
      const entryColNames = new Set(entryColsInfo.map((c) => c.name));
      const wfColNames = new Set(wfColsInfo.map((c) => c.name));
      const metaSchemaVer = Number(metaMap.get('schema_version') || 0);
      const isCorePack =
        metaMap.get('pack_layer') === 'core' ||
        (hasPosTable && !hasSensesTable && entryColNames.has('primary_definition'));

      if (metaSchemaVer >= 3 || isCorePack) {
        this.schemaVersion = 3;
        this.isCoreLayer = isCorePack;
      } else if (hasPosTable || metaSchemaVer >= 2) {
        this.schemaVersion = 2;
        this.isCoreLayer = false;
      } else {
        this.schemaVersion = 1;
        this.isCoreLayer = false;
      }

      this.hasHeadwordNormCol = entryColNames.has('headword_norm');
      this.hasFormNormCol = wfColNames.has('form_norm');

      // Optional Extended database attachment (never required for Core functionality)
      this.extendedAttached = false;
      if (this.isCoreLayer && detectedExtPath) {
        try {
          if ('setAttachPath' in this.executor && typeof (this.executor as { setAttachPath: unknown }).setAttachPath === 'function') {
            (this.executor as { setAttachPath: (p: string | null) => void }).setAttachPath(detectedExtPath);
          }
          try {
            await this.executor.query('ATTACH DATABASE ? AS ext;', [detectedExtPath]);
          } catch (attachErr) {
            if (!String(attachErr).includes('already in use')) {
              throw attachErr;
            }
          }
          const extCheck = await this.executor.query<{ cnt: number }>(
            "SELECT COUNT(*) AS cnt FROM ext.sqlite_master WHERE type='table' AND name='senses_ext';"
          );
          this.extendedAttached = Number(extCheck[0]?.cnt || 0) > 0;
        } catch (err) {
          this.extendedAttached = false;
          if ('setAttachPath' in this.executor && typeof (this.executor as { setAttachPath: unknown }).setAttachPath === 'function') {
            (this.executor as { setAttachPath: (p: string | null) => void }).setAttachPath(null);
          }
        }
      } else {
        if ('setAttachPath' in this.executor && typeof (this.executor as { setAttachPath: unknown }).setAttachPath === 'function') {
          (this.executor as { setAttachPath: (p: string | null) => void }).setAttachPath(null);
        }
        try {
          await this.executor.query('DETACH DATABASE ext;');
        } catch {
          // Ignore if ext was not attached
        }
      }

      const src = sourceRows[0];
      let ftsOk = false;
      try {
        await this.executor.query(
          "SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'knowledge' LIMIT 1;"
        );
        ftsOk = true;
      } catch {
        ftsOk = false;
      }
      this.fts5Supported = ftsOk;

      this.cachedMeta = {
        datasetName: metaMap.get('dataset_name') || 'Lexica English Monolingual Dictionary',
        packVersion: metaMap.get('pack_version') || ENGLISH_PACK_MANIFEST.packVersion,
        schemaVersion: this.schemaVersion,
        packLayer: this.isCoreLayer ? 'core' : 'full',
        extendedAttached: this.extendedAttached,
        acceptedEntries: Number(metaMap.get('accepted_entries') || 0),
        distinctHeadwords: Number(metaMap.get('distinct_headwords') || 0),
        totalSenses: Number(metaMap.get('total_senses') || 0),
        sourceName: src?.name || ENGLISH_PACK_MANIFEST.attribution.sourceName,
        sourceLicense: src?.license || metaMap.get('source_license') || ENGLISH_PACK_MANIFEST.attribution.license,
        sourceAttribution:
          src?.attribution_text ||
          metaMap.get('source_attribution') ||
          ENGLISH_PACK_MANIFEST.attribution.attributionText,
        sourceUrl: src?.source_url || ENGLISH_PACK_MANIFEST.attribution.sourceUrl,
        fts5Supported: ftsOk,
      };

      const elapsed = Math.round((performance.now() - t0) * 100) / 100;
      if (this.lastColdOpenMs === null) {
        this.lastColdOpenMs = elapsed;
      } else {
        this.lastWarmOpenMs = elapsed;
      }
    })();

    try {
      await this.openPromise;
    } finally {
      this.openPromise = null;
    }
  }

  public getCachedMetadata(): EnglishSqliteMetadata | null {
    return this.cachedMeta;
  }

  private getEntrySelectColumns(): string {
    if (this.schemaVersion >= 3 && this.isCoreLayer) {
      if (this.extendedAttached) {
        return `e.id, COALESCE(e.headword, e.headword_lower) AS headword, e.headword_lower,
                pos.name AS part_of_speech, e.primary_ipa, pr.all_ipas,
                af.filename AS audio_file, et.text AS etymology, src.code AS source_id,
                e.primary_definition, e.extra_senses_count`;
      }
      return `e.id, COALESCE(e.headword, e.headword_lower) AS headword, e.headword_lower,
              pos.name AS part_of_speech, e.primary_ipa, NULL AS all_ipas,
              NULL AS audio_file, NULL AS etymology, src.code AS source_id,
              e.primary_definition, e.extra_senses_count`;
    }
    if (this.schemaVersion >= 2) {
      return `e.id, COALESCE(e.headword, e.headword_lower) AS headword, e.headword_lower,
              pos.name AS part_of_speech, e.primary_ipa, pr.all_ipas,
              af.filename AS audio_file, et.text AS etymology, src.code AS source_id`;
    }
    return `e.id, e.headword, e.headword_lower, e.part_of_speech,
            e.primary_ipa, e.all_ipas, e.audio_file, e.etymology, e.source_id`;
  }

  private getEntryJoins(): string {
    if (this.schemaVersion >= 3 && this.isCoreLayer) {
      if (this.extendedAttached) {
        return `JOIN parts_of_speech pos ON pos.id = e.pos_id
                LEFT JOIN ext.entry_extensions ex ON ex.entry_id = e.id
                LEFT JOIN ext.pronunciations pr ON pr.id = ex.pronunciation_id
                LEFT JOIN ext.audio_files af ON af.id = ex.audio_id
                LEFT JOIN ext.etymologies et ON et.id = ex.etymology_id
                JOIN sources src ON src.id = e.source_id`;
      }
      return `JOIN parts_of_speech pos ON pos.id = e.pos_id
              JOIN sources src ON src.id = e.source_id`;
    }
    if (this.schemaVersion >= 2) {
      return `JOIN parts_of_speech pos ON pos.id = e.pos_id
              LEFT JOIN pronunciations pr ON pr.id = e.pronunciation_id
              LEFT JOIN audio_files af ON af.id = e.audio_id
              LEFT JOIN etymologies et ON et.id = e.etymology_id
              JOIN sources src ON src.id = e.source_id`;
    }
    return '';
  }

  private getPosColumnExpr(): string {
    return this.schemaVersion >= 2 ? 'pos.name' : 'e.part_of_speech';
  }

  private buildColumnPrefixCondition(columnExpr: string, prefixLower: string): { sql: string; params: unknown[] } {
    const upper = computePrefixUpperBound(prefixLower);
    if (upper) {
      return {
        sql: `(${columnExpr} >= ? AND ${columnExpr} < ?)`,
        params: [prefixLower, upper],
      };
    }
    return {
      sql: `${columnExpr} LIKE ? ESCAPE '\\'`,
      params: [`${escapeSqlLike(prefixLower)}%`],
    };
  }

  private buildPrefixCondition(prefixLower: string): { sql: string; params: unknown[] } {
    return this.buildColumnPrefixCondition('e.headword_lower', prefixLower);
  }

  private buildExactHeadwordCondition(qLower: string, qNorm: string): { sql: string; params: unknown[] } {
    if (!this.hasHeadwordNormCol) {
      return { sql: 'e.headword_lower = ?', params: [qLower] };
    }
    if (qNorm && qNorm !== qLower) {
      return {
        sql: '(e.headword_lower = ? OR e.headword_norm = ? OR e.headword_lower = ?)',
        params: [qLower, qNorm, qNorm],
      };
    }
    return {
      sql: '(e.headword_lower = ? OR e.headword_norm = ?)',
      params: [qLower, qLower],
    };
  }

  private buildNotExactHeadwordCondition(qLower: string, qNorm: string): { sql: string; params: unknown[] } {
    if (!this.hasHeadwordNormCol) {
      return { sql: 'e.headword_lower != ?', params: [qLower] };
    }
    if (qNorm && qNorm !== qLower) {
      return {
        sql: '(e.headword_lower != ? AND (e.headword_norm IS NULL OR e.headword_norm != ?) AND e.headword_lower != ?)',
        params: [qLower, qNorm, qNorm],
      };
    }
    return {
      sql: '(e.headword_lower != ? AND (e.headword_norm IS NULL OR e.headword_norm != ?))',
      params: [qLower, qLower],
    };
  }

  private buildSearchPrefixCondition(qLower: string, qNorm: string): { sql: string; params: unknown[] } {
    const base = this.buildColumnPrefixCondition('e.headword_lower', qLower);
    if (!this.hasHeadwordNormCol || qNorm.length < 2) {
      return base;
    }
    const normCond = this.buildColumnPrefixCondition('e.headword_norm', qNorm);
    if (qNorm !== qLower) {
      const foldedLower = this.buildColumnPrefixCondition('e.headword_lower', qNorm);
      return {
        sql: `(${base.sql} OR ${foldedLower.sql} OR ${normCond.sql})`,
        params: [...base.params, ...foldedLower.params, ...normCond.params],
      };
    }
    return {
      sql: `(${base.sql} OR ${normCond.sql})`,
      params: [...base.params, ...normCond.params],
    };
  }

  private buildNotSearchPrefixCondition(qLower: string, qNorm: string): { sql: string; params: unknown[] } {
    const base = this.buildColumnPrefixCondition('e.headword_lower', qLower);
    if (!this.hasHeadwordNormCol || qNorm.length < 2) {
      return { sql: `NOT ${base.sql}`, params: base.params };
    }
    const normCond = this.buildColumnPrefixCondition('e.headword_norm', qNorm);
    if (qNorm !== qLower) {
      const foldedLower = this.buildColumnPrefixCondition('e.headword_lower', qNorm);
      return {
        sql: `(NOT ${base.sql} AND NOT ${foldedLower.sql} AND (e.headword_norm IS NULL OR NOT ${normCond.sql}))`,
        params: [...base.params, ...foldedLower.params, ...normCond.params],
      };
    }
    return {
      sql: `(NOT ${base.sql} AND (e.headword_norm IS NULL OR NOT ${normCond.sql}))`,
      params: [...base.params, ...normCond.params],
    };
  }

  private buildWordFormExactCondition(qLower: string, qNorm: string): { sql: string; params: unknown[] } {
    if (!this.hasFormNormCol) {
      return { sql: 'wf.form_lower = ?', params: [qLower] };
    }
    if (qNorm && qNorm !== qLower) {
      return {
        sql: '(wf.form_lower = ? OR wf.form_norm = ? OR wf.form_lower = ?)',
        params: [qLower, qNorm, qNorm],
      };
    }
    return {
      sql: '(wf.form_lower = ? OR wf.form_norm = ?)',
      params: [qLower, qLower],
    };
  }

  public async getAvailableLetters(): Promise<string[]> {
    await this.ensureOpen();
    const rows = await this.executor.query<{ ch: string }>(
      "SELECT DISTINCT UPPER(SUBSTR(headword_lower, 1, 1)) AS ch FROM entries WHERE headword_lower >= 'a' AND headword_lower < '{' ORDER BY ch ASC LIMIT 30;"
    );
    return rows.map((r) => r.ch).filter(Boolean);
  }

  public async getEntryById(entryId: string): Promise<WordEntry | null> {
    if (!entryId.startsWith('en-sqlite-')) return null;
    const numericId = Number(entryId.replace('en-sqlite-', ''));
    if (!Number.isInteger(numericId) || numericId <= 0) return null;

    await this.ensureOpen();
    const rows = await this.executor.query<SqlEntryRow>(
      `SELECT ${this.getEntrySelectColumns()} FROM entries e ${this.getEntryJoins()} WHERE e.id = ? LIMIT 1;`,
      [numericId]
    );
    if (rows.length === 0) return null;
    const hydrated = await this.hydrateEntries(rows);
    return hydrated[0]?.entry || null;
  }

  public async getEntriesByIds(entryIds: string[]): Promise<WordEntry[]> {
    const numericIds = entryIds
      .filter((id) => id.startsWith('en-sqlite-'))
      .map((id) => Number(id.replace('en-sqlite-', '')))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (numericIds.length === 0) return [];

    await this.ensureOpen();
    const placeholders = numericIds.map(() => '?').join(',');
    const rows = await this.executor.query<SqlEntryRow>(
      `SELECT ${this.getEntrySelectColumns()} FROM entries e ${this.getEntryJoins()} WHERE e.id IN (${placeholders});`,
      numericIds
    );
    const hydrated = await this.hydrateEntries(rows);
    return hydrated.map((h) => h.entry);
  }

  public async searchStandard(
    query: string,
    options: EnglishSearchOptions = {}
  ): Promise<StandardSearchResponse> {
    const rawQuery = (query || '').trim();
    const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const offset = Math.max(0, options.offset || 0);
    const posValues = expandPartOfSpeechFilter(options.partOfSpeech);
    const letter = options.letter && options.letter !== 'all' ? options.letter.toLowerCase() : null;

    try {
      await this.ensureOpen();
      const entryCols = this.getEntrySelectColumns();
      const entryJoins = this.getEntryJoins();
      const posExpr = this.getPosColumnExpr();

      // 1. BROWSE MODE (bounded SQL pagination)
      if (!rawQuery) {
        const whereParts: string[] = [];
        const whereParams: unknown[] = [];
        if (posValues) {
          whereParts.push(`${posExpr} IN (${posValues.map(() => '?').join(',')})`);
          whereParams.push(...posValues);
        }
        if (letter) {
          const pref = this.buildPrefixCondition(letter);
          whereParts.push(pref.sql);
          whereParams.push(...pref.params);
        }
        const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
        const countJoin = this.schemaVersion >= 2 && posValues ? 'JOIN parts_of_speech pos ON pos.id = e.pos_id' : '';
        const countRows = await this.executor.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM entries e ${countJoin} ${whereSql};`,
          whereParams
        );
        const totalCount = Number(countRows[0]?.cnt || 0);

        const entryRows = await this.executor.query<SqlEntryRow>(
          `SELECT ${entryCols}
           FROM entries e ${entryJoins} ${whereSql}
           ORDER BY e.headword_lower ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [...whereParams, limit, offset]
        );

        const hydrated = await this.hydrateEntries(entryRows);
        const results: StandardSearchResult[] = hydrated.map((h) => ({
          ...h,
          matchedField: 'headword-exact',
          matchedTerm: h.entry.headword,
          score: 100,
        }));

        return {
          status: 'browse',
          language: 'en',
          query: rawQuery,
          results,
          totalCount,
          hasMore: offset + results.length < totalCount,
          offset,
          limit,
          engineSource: 'sqlite-en',
        };
      }

      // 2. SEARCH MODE: Exact/Normalized -> Prefix -> Word Forms -> FTS5 Definition Search
      const qLower = rawQuery.toLowerCase();
      const qNorm = TextNormalization.normalizeLatin(rawQuery).soft || qLower;
      const exactCond = this.buildExactHeadwordCondition(qLower, qNorm);
      const notExactCond = this.buildNotExactHeadwordCondition(qLower, qNorm);
      const prefCond = this.buildSearchPrefixCondition(qLower, qNorm);
      const notPrefCond = this.buildNotSearchPrefixCondition(qLower, qNorm);
      const wfExactCond = this.buildWordFormExactCondition(qLower, qNorm);

      const posClause = posValues ? `AND ${posExpr} IN (${posValues.map(() => '?').join(',')})` : '';
      const posParams = posValues || [];
      const posJoinOnly = this.schemaVersion >= 2 && posValues ? 'JOIN parts_of_speech pos ON pos.id = e.pos_id' : '';
      const ftsJoinCond = this.schemaVersion >= 2 ? 'e.id = f.rowid' : 'e.id = f.entry_id';

      const exactCountRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM entries e ${posJoinOnly} WHERE ${exactCond.sql} ${posClause};`,
        [...exactCond.params, ...posParams]
      );
      const c1 = Number(exactCountRows[0]?.cnt || 0);

      const prefixCountRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM entries e ${posJoinOnly} WHERE ${prefCond.sql} AND ${notExactCond.sql} ${posClause};`,
        [...prefCond.params, ...notExactCond.params, ...posParams]
      );
      const c2 = Number(prefixCountRows[0]?.cnt || 0);

      const formsCountRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(DISTINCT e.id) AS cnt
         FROM word_forms wf
         JOIN entries e ON e.id = wf.entry_id
         ${posJoinOnly}
         WHERE ${wfExactCond.sql}
           AND ${notExactCond.sql}
           AND ${notPrefCond.sql}
           ${posClause};`,
        [...wfExactCond.params, ...notExactCond.params, ...notPrefCond.params, ...posParams]
      );
      const c3 = Number(formsCountRows[0]?.cnt || 0);

      const ftsQuery = this.fts5Supported ? buildFts5Query(rawQuery) : null;
      let c4 = 0;
      if (ftsQuery) {
        const ftsCountRows = await this.executor.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt
           FROM entries_fts f
           JOIN entries e ON ${ftsJoinCond}
           ${posJoinOnly}
           WHERE entries_fts MATCH ?
             AND ${notExactCond.sql}
             AND ${notPrefCond.sql}
             AND NOT EXISTS (
               SELECT 1 FROM word_forms wf WHERE wf.entry_id = e.id AND ${wfExactCond.sql}
             )
             ${posClause};`,
          [ftsQuery, ...notExactCond.params, ...notPrefCond.params, ...wfExactCond.params, ...posParams]
        );
        c4 = Number(ftsCountRows[0]?.cnt || 0);
      }

      const totalCount = c1 + c2 + c3 + c4;
      if (totalCount === 0) {
        return {
          status: 'not_found',
          language: 'en',
          query: rawQuery,
          results: [],
          totalCount: 0,
          hasMore: false,
          offset,
          limit,
          engineSource: 'sqlite-en',
          message: `No English entries matched "${rawQuery}" in the offline dictionary.`,
        };
      }

      const matchedItems: Array<{
        row: SqlEntryRow;
        matchedField: StandardSearchResult['matchedField'];
        matchedTerm: string;
        score: number;
      }> = [];

      const takeSlice = (tierStart: number, tierCount: number): { localOffset: number; localLimit: number } | null => {
        if (tierCount <= 0) return null;
        const winStart = offset;
        const winEnd = offset + limit;
        const tierEnd = tierStart + tierCount;
        const overlapStart = Math.max(winStart, tierStart);
        const overlapEnd = Math.min(winEnd, tierEnd);
        if (overlapStart >= overlapEnd) return null;
        return {
          localOffset: overlapStart - tierStart,
          localLimit: overlapEnd - overlapStart,
        };
      };

      const s1 = takeSlice(0, c1);
      if (s1) {
        const rows = await this.executor.query<SqlEntryRow>(
          `SELECT ${entryCols}
           FROM entries e ${entryJoins}
           WHERE ${exactCond.sql} ${posClause}
           ORDER BY CASE WHEN e.headword_lower = ? THEN 0 ELSE 1 END, e.id ASC
           LIMIT ? OFFSET ?;`,
          [...exactCond.params, ...posParams, qLower, s1.localLimit, s1.localOffset]
        );
        for (const r of rows) {
          const isCaseExact = r.headword === rawQuery;
          const isLowerExact = r.headword_lower === qLower;
          matchedItems.push({
            row: r,
            matchedField: isCaseExact ? 'headword-exact' : 'headword-normalized',
            matchedTerm: r.headword,
            score: isCaseExact ? 100 : isLowerExact ? 96 : 94,
          });
        }
      }

      const s2 = takeSlice(c1, c2);
      if (s2) {
        const rows = await this.executor.query<SqlEntryRow>(
          `SELECT ${entryCols}
           FROM entries e ${entryJoins}
           WHERE ${prefCond.sql} AND ${notExactCond.sql} ${posClause}
           ORDER BY length(e.headword_lower) ASC, e.headword_lower ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [...prefCond.params, ...notExactCond.params, ...posParams, s2.localLimit, s2.localOffset]
        );
        for (const r of rows) {
          matchedItems.push({
            row: r,
            matchedField: 'headword-prefix',
            matchedTerm: r.headword,
            score: 88,
          });
        }
      }

      const s3 = takeSlice(c1 + c2, c3);
      if (s3) {
        const wfFormExpr = this.schemaVersion >= 2 ? 'COALESCE(wf.form, wf.form_lower)' : 'wf.form';
        const rows = await this.executor.query<SqlEntryRow & { matched_form: string }>(
          `SELECT ${entryCols},
                  MIN(${wfFormExpr}) AS matched_form
           FROM word_forms wf
           JOIN entries e ON e.id = wf.entry_id
           ${entryJoins}
           WHERE ${wfExactCond.sql}
             AND ${notExactCond.sql}
             AND ${notPrefCond.sql}
             ${posClause}
           GROUP BY e.id
           ORDER BY e.headword_lower ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [...wfExactCond.params, ...notExactCond.params, ...notPrefCond.params, ...posParams, s3.localLimit, s3.localOffset]
        );
        for (const r of rows) {
          matchedItems.push({
            row: r,
            matchedField: 'morphology',
            matchedTerm: r.matched_form || rawQuery,
            score: 82,
          });
        }
      }

      const s4 = ftsQuery ? takeSlice(c1 + c2 + c3, c4) : null;
      if (s4 && ftsQuery) {
        const rows = await this.executor.query<SqlEntryRow>(
          `SELECT ${entryCols}
           FROM entries_fts f
           JOIN entries e ON ${ftsJoinCond}
           ${entryJoins}
           WHERE entries_fts MATCH ?
             AND ${notExactCond.sql}
             AND ${notPrefCond.sql}
             AND NOT EXISTS (
               SELECT 1 FROM word_forms wf WHERE wf.entry_id = e.id AND ${wfExactCond.sql}
             )
             ${posClause}
           ORDER BY bm25(entries_fts) ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [ftsQuery, ...notExactCond.params, ...notPrefCond.params, ...wfExactCond.params, ...posParams, s4.localLimit, s4.localOffset]
        );
        for (const r of rows) {
          matchedItems.push({
            row: r,
            matchedField: 'definition',
            matchedTerm: rawQuery,
            score: 62,
          });
        }
      }

      const hydrated = await this.hydrateEntries(matchedItems.map((m) => m.row));
      const hydratedById = new Map(hydrated.map((h) => [h.entry.id, h]));

      const results: StandardSearchResult[] = matchedItems
        .map((m) => {
          const item = hydratedById.get(`en-sqlite-${m.row.id}`);
          if (!item) return null;
          return {
            ...item,
            matchedField: m.matchedField,
            matchedTerm: m.matchedTerm,
            score: m.score,
          };
        })
        .filter((item): item is StandardSearchResult => item !== null);

      return {
        status: 'ok',
        language: 'en',
        query: rawQuery,
        results,
        totalCount,
        hasMore: offset + results.length < totalCount,
        offset,
        limit,
        engineSource: 'sqlite-en',
      };
    } catch (err) {
      return {
        status: 'error',
        language: 'en',
        query: rawQuery,
        results: [],
        totalCount: 0,
        hasMore: false,
        offset,
        limit,
        engineSource: 'sqlite-en',
        message: err instanceof Error ? err.message : 'Unable to query offline English SQLite database.',
      };
    }
  }

  private async hydrateEntries(
    entryRows: SqlEntryRow[]
  ): Promise<Array<{ entry: WordEntry; senses: WordSense[]; morphologicalForms: MorphologicalForm[] }>> {
    if (entryRows.length === 0) return [];
    const entryIds = entryRows.map((r) => r.id);
    const placeholders = entryIds.map(() => '?').join(',');

    const formsSql =
      this.schemaVersion >= 3 && this.isCoreLayer
        ? `SELECT wf.entry_id, COALESCE(wf.form, wf.form_lower) AS form, wf.form_lower, NULL AS tags
           FROM word_forms wf
           WHERE wf.entry_id IN (${placeholders})
           ORDER BY wf.id ASC;`
        : this.schemaVersion >= 2
          ? `SELECT wf.entry_id, COALESCE(wf.form, wf.form_lower) AS form, wf.form_lower, ts.tags_json AS tags
             FROM word_forms wf
             LEFT JOIN tag_sets ts ON ts.id = wf.tags_id
             WHERE wf.entry_id IN (${placeholders})
             ORDER BY wf.id ASC;`
          : `SELECT entry_id, form, form_lower, tags
             FROM word_forms
             WHERE entry_id IN (${placeholders})
             ORDER BY id ASC;`;

    let senseRows: SqlSenseRow[] = [];
    let formRows: SqlWordFormRow[] = [];

    if (this.schemaVersion >= 3 && this.isCoreLayer && !this.extendedAttached) {
      formRows = await this.executor.query<SqlWordFormRow>(formsSql, entryIds);
    } else if (this.schemaVersion >= 3 && this.isCoreLayer && this.extendedAttached) {
      const extSensesSql = `
        SELECT s.id, s.entry_id, s.sense_number,
               COALESCE(s.definition, e.primary_definition) AS definition,
               ts.tags_json AS tags, s.examples, s.synonyms, s.antonyms
        FROM ext.senses_ext s
        JOIN entries e ON e.id = s.entry_id
        LEFT JOIN ext.tag_sets ts ON ts.id = s.tags_id
        WHERE s.entry_id IN (${placeholders})
        ORDER BY s.entry_id ASC, s.sense_number ASC;`;
      [senseRows, formRows] = await Promise.all([
        this.executor.query<SqlSenseRow>(extSensesSql, entryIds),
        this.executor.query<SqlWordFormRow>(formsSql, entryIds),
      ]);
    } else {
      const sensesSql =
        this.schemaVersion >= 2
          ? `SELECT s.id, s.entry_id, s.sense_number, s.definition, ts.tags_json AS tags, s.examples, s.synonyms, s.antonyms
             FROM senses s
             LEFT JOIN tag_sets ts ON ts.id = s.tags_id
             WHERE s.entry_id IN (${placeholders})
             ORDER BY s.entry_id ASC, s.sense_number ASC;`
          : `SELECT id, entry_id, sense_number, definition, tags, examples, synonyms, antonyms
             FROM senses
             WHERE entry_id IN (${placeholders})
             ORDER BY entry_id ASC, sense_number ASC;`;
      [senseRows, formRows] = await Promise.all([
        this.executor.query<SqlSenseRow>(sensesSql, entryIds),
        this.executor.query<SqlWordFormRow>(formsSql, entryIds),
      ]);
    }

    const sensesByEntryId = new Map<number, SqlSenseRow[]>();
    for (const s of senseRows) {
      const list = sensesByEntryId.get(s.entry_id) || [];
      list.push(s);
      sensesByEntryId.set(s.entry_id, list);
    }

    const formsByEntryId = new Map<number, SqlWordFormRow[]>();
    for (const wf of formRows) {
      const list = formsByEntryId.get(wf.entry_id) || [];
      list.push(wf);
      formsByEntryId.set(wf.entry_id, list);
    }

    const meta = this.cachedMeta;

    return entryRows.map((row) => {
      const entryStringId = `en-sqlite-${row.id}`;
      const rawSenses = sensesByEntryId.get(row.id) || [];
      const rawForms = formsByEntryId.get(row.id) || [];
      const allIpas = parseAllIpas(row.all_ipas);

      const synonymsSet = new Set<string>();
      const antonymsSet = new Set<string>();
      const allExamples: ExampleSentence[] = [];
      const allTags = new Set<string>();

      let mappedSenses: WordSense[];
      if (this.schemaVersion >= 3 && this.isCoreLayer && rawSenses.length === 0) {
        const coreDef = row.primary_definition || '';
        mappedSenses = coreDef
          ? [
              {
                id: `${entryStringId}#s1`,
                entryId: entryStringId,
                senseNumber: 1,
                partOfSpeech: row.part_of_speech,
                definition: coreDef,
                definitionEn: coreDef,
                register: null,
                examples: [],
                synonyms: [],
                antonyms: [],
                relatedWords: [],
              },
            ]
          : [];
      } else {
        mappedSenses = rawSenses.map((s) => {
          const sTags = safeJsonParse<string[]>(s.tags, []);
          const mappedExamples = parseSenseExamples(s.examples);
          const sSynonyms = safeJsonParse<string[]>(s.synonyms, []);
          const sAntonyms = safeJsonParse<string[]>(s.antonyms, []);

          for (const t of sTags) allTags.add(t);
          for (const syn of sSynonyms) {
            if (syn) synonymsSet.add(syn);
          }
          for (const ant of sAntonyms) {
            if (ant) antonymsSet.add(ant);
          }
          for (const ex of mappedExamples) {
            if (allExamples.length < 8) {
              allExamples.push(ex);
            }
          }

          return {
            id: `${entryStringId}#s${s.sense_number}`,
            entryId: entryStringId,
            senseNumber: s.sense_number,
            partOfSpeech: row.part_of_speech,
            definition: s.definition,
            definitionEn: s.definition,
            register: sTags.length > 0 ? sTags.slice(0, 3).join(', ') : null,
            examples: mappedExamples,
            synonyms: sSynonyms,
            antonyms: sAntonyms,
            relatedWords: [],
          };
        });
      }

      const mappedForms: MorphologicalForm[] = [];
      const seenFormKeys = new Set<string>();
      for (const wf of rawForms) {
        const label = safeJsonParse<string[]>(wf.tags, []).join(', ') || 'inflected form';
        const dedupeKey = `${wf.form_lower}::${label}`;
        if (seenFormKeys.has(dedupeKey)) continue;
        seenFormKeys.add(dedupeKey);
        mappedForms.push({
          form: wf.form,
          label,
        });
      }

      const primaryDefinition = row.primary_definition || mappedSenses[0]?.definition || '';
      const extraSensesCount = Number(row.extra_senses_count || Math.max(0, mappedSenses.length - 1));
      const entry: WordEntry = {
        id: entryStringId,
        sourceLang: 'en',
        headword: row.headword,
        ipa: row.primary_ipa || '',
        allIpas,
        isMonolingualSqlite: true,
        isCoreOnly: this.isCoreLayer && !this.extendedAttached,
        extraSensesCount,
        extendedInstalled: !this.isCoreLayer || this.extendedAttached,
        partOfSpeech: row.part_of_speech,
        dialect: formatPrimaryDialect(allIpas, row.primary_ipa),
        etymology: row.etymology || null,
        definition: primaryDefinition,
        definitionEn: primaryDefinition,
        senses: mappedSenses,
        morphologicalForms: mappedForms,
        translations: {},
        examples: allExamples,
        synonyms: Array.from(synonymsSet),
        antonyms: Array.from(antonymsSet),
        verifiedOffline: true,
        verificationStatus: 'verified',
        sourceAttribution: meta?.sourceName || ENGLISH_PACK_MANIFEST.attribution.sourceName,
        license: meta?.sourceLicense || ENGLISH_PACK_MANIFEST.attribution.license,
        datasetVersion: meta?.packVersion || ENGLISH_PACK_MANIFEST.packVersion,
        tags: Array.from(allTags),
      };

      return {
        entry,
        senses: mappedSenses,
        morphologicalForms: mappedForms,
      };
    });
  }

  public async runBenchmark(): Promise<EnglishBenchmarkReport> {
    await this.closeConnection();
    const status = englishPackService.getCachedStatus();
    const targetPath = this.executor.getDbPath() || status.dbPath;

    const coldStart = performance.now();
    await this.ensureOpen(targetPath);
    const coldOpenMs = Math.round((performance.now() - coldStart) * 100) / 100;

    const warmStart = performance.now();
    await this.ensureOpen(targetPath);
    const warmOpenMs = Math.round((performance.now() - warmStart) * 100) / 100;

    const targets = [
      'epistemology',
      'photosynthesis',
      'serendipity',
      'ubiquitous',
      'dictionary',
      'run',
      'light',
    ];
    const exactLookupMs: Record<string, number> = {};
    for (const w of targets) {
      const t0 = performance.now();
      await this.searchStandard(w, { limit: 20, offset: 0 });
      exactLookupMs[w] = Math.round((performance.now() - t0) * 100) / 100;
    }

    const tp0 = performance.now();
    await this.searchStandard('epistem', { limit: 20, offset: 0 });
    const prefixSearchMs = Math.round((performance.now() - tp0) * 100) / 100;

    const tf0 = performance.now();
    await this.searchStandard('knowledge branch', { limit: 20, offset: 0 });
    const fts5SearchMs = Math.round((performance.now() - tf0) * 100) / 100;

    const tpg0 = performance.now();
    await this.searchStandard('', { limit: 20, offset: 40 });
    const paginatedSearchMs = Math.round((performance.now() - tpg0) * 100) / 100;

    const loopTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const w = targets[i % targets.length];
      const q0 = performance.now();
      await this.searchStandard(w, { limit: 10, offset: 0 });
      loopTimes.push(performance.now() - q0);
    }
    const sorted = [...loopTimes].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    const memoryMetrics = await englishPackService.getMemoryMetrics();

    return {
      platform: englishPackService.getPlatform(),
      dbPath: targetPath,
      coldOpenMs,
      warmOpenMs,
      exactLookupMs,
      prefixSearchMs,
      fts5SearchMs,
      paginatedSearchMs,
      repeated100QueriesAvgMs: Math.round(avg * 100) / 100,
      repeated100QueriesP95Ms: Math.round(p95 * 100) / 100,
      memoryMetrics,
      fts5Supported: this.fts5Supported,
    };
  }
}

export const englishSqliteRepo = new EnglishSqliteRepository();
