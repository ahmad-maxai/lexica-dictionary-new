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

function escapeSqlLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
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
    this.fts5Supported = false;
    if (executor) {
      this.executor = executor;
      this.customExecutorInjected = true;
    } else {
      this.executor = new CapacitorSqliteExecutor();
      this.customExecutorInjected = false;
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
    await this.executor.close();
  }

  public async ensureOpen(explicitDbPath?: string): Promise<void> {
    if (!isEnglishSqliteIntegrationEnabled()) {
      throw new Error('English SQLite integration is disabled by feature flag.');
    }

    const status = englishPackService.getCachedStatus();
    const targetPath = explicitDbPath || this.executor.getDbPath() || status.dbPath;

    if (!targetPath) {
      throw new Error('English offline SQLite pack is not installed.');
    }

    if (this.executor.isOpen() && this.executor.getDbPath() === targetPath && this.cachedMeta) {
      return;
    }

    if (this.openPromise) {
      return this.openPromise;
    }

    this.openPromise = (async () => {
      const t0 = performance.now();
      await this.executor.open(targetPath);

      const metaRows = await this.executor.query<{ key: string; value: string }>(
        'SELECT key, value FROM metadata;'
      );
      const metaMap = new Map(metaRows.map((r) => [r.key, r.value]));

      const sourceRows = await this.executor.query<{
        name: string;
        license: string;
        attribution_text: string;
        source_url: string;
      }>('SELECT name, license, attribution_text, source_url FROM sources LIMIT 1;');
      const src = sourceRows[0];

      let ftsOk = false;
      try {
        await this.executor.query<{ entry_id: number }>(
          "SELECT entry_id FROM entries_fts WHERE entries_fts MATCH 'knowledge' LIMIT 1;"
        );
        ftsOk = true;
      } catch {
        ftsOk = false;
      }
      this.fts5Supported = ftsOk;

      this.cachedMeta = {
        datasetName: metaMap.get('dataset_name') || 'Lexica English Monolingual Dictionary',
        packVersion: metaMap.get('pack_version') || ENGLISH_PACK_MANIFEST.packVersion,
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

  public async getAvailableLetters(): Promise<string[]> {
    await this.ensureOpen();
    const rows = await this.executor.query<{ ch: string }>(
      "SELECT DISTINCT UPPER(SUBSTR(headword_lower, 1, 1)) AS ch FROM entries WHERE SUBSTR(headword_lower, 1, 1) BETWEEN 'a' AND 'z' ORDER BY ch ASC LIMIT 30;"
    );
    return rows.map((r) => r.ch).filter(Boolean);
  }

  public async getEntryById(entryId: string): Promise<WordEntry | null> {
    if (!entryId.startsWith('en-sqlite-')) return null;
    const numericId = Number(entryId.replace('en-sqlite-', ''));
    if (!Number.isInteger(numericId) || numericId <= 0) return null;

    await this.ensureOpen();
    const rows = await this.executor.query<SqlEntryRow>(
      'SELECT id, headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology, source_id FROM entries WHERE id = ? LIMIT 1;',
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
      `SELECT id, headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology, source_id FROM entries WHERE id IN (${placeholders});`,
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

      // 1. BROWSE MODE (bounded SQL pagination)
      if (!rawQuery) {
        const whereParts: string[] = [];
        const whereParams: unknown[] = [];

        if (posValues) {
          whereParts.push(`part_of_speech IN (${posValues.map(() => '?').join(',')})`);
          whereParams.push(...posValues);
        }
        if (letter) {
          whereParts.push("headword_lower LIKE ? ESCAPE '\\'");
          whereParams.push(`${escapeSqlLike(letter)}%`);
        }

        const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
        const countRows = await this.executor.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM entries ${whereSql};`,
          whereParams
        );
        const totalCount = Number(countRows[0]?.cnt || 0);

        const entryRows = await this.executor.query<SqlEntryRow>(
          `SELECT id, headword, headword_lower, part_of_speech, primary_ipa, all_ipas, audio_file, etymology, source_id
           FROM entries ${whereSql}
           ORDER BY headword_lower ASC, id ASC
           LIMIT ? OFFSET ?;`,
          [...whereParams, limit, offset]
        );

        const hydrated = await this.hydrateEntries(entryRows);
        const results: StandardSearchResult[] = hydrated.map((item) => ({
          ...item,
          matchedField: 'headword-normalized',
          matchedTerm: item.entry.headword,
          score: 10,
        }));

        return {
          status: 'browse',
          language: 'en',
          query: '',
          results,
          totalCount,
          hasMore: offset + results.length < totalCount,
          offset,
          limit,
          engineSource: 'sqlite-en',
        };
      }

      // 2. SEARCH MODE: Disjoint bounded tiers with exact offset/limit pagination
      const qLower = rawQuery.toLowerCase();
      const qPrefixLike = `${escapeSqlLike(qLower)}%`;
      const ftsQuery = this.fts5Supported ? buildFts5Query(rawQuery) : null;

      const posClause = posValues ? `AND e.part_of_speech IN (${posValues.map(() => '?').join(',')})` : '';
      const posParams = posValues || [];

      // Tier 1: Exact / case-insensitive headword match
      const exactCountRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM entries e WHERE e.headword_lower = ? ${posClause};`,
        [qLower, ...posParams]
      );
      const c1 = Number(exactCountRows[0]?.cnt || 0);

      // Tier 2: Prefix match (excluding exact)
      const prefixCountRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM entries e WHERE e.headword_lower LIKE ? ESCAPE '\\' AND e.headword_lower != ? ${posClause};`,
        [qPrefixLike, qLower, ...posParams]
      );
      const c2 = Number(prefixCountRows[0]?.cnt || 0);

      // Tier 3: Inflected word forms match (excluding exact & prefix headword matches)
      const formsCountRows = await this.executor.query<{ cnt: number }>(
        `SELECT COUNT(DISTINCT e.id) AS cnt
         FROM word_forms wf
         JOIN entries e ON e.id = wf.entry_id
         WHERE wf.form_lower = ?
           AND e.headword_lower != ?
           AND e.headword_lower NOT LIKE ? ESCAPE '\\'
           ${posClause};`,
        [qLower, qLower, qPrefixLike, ...posParams]
      );
      const c3 = Number(formsCountRows[0]?.cnt || 0);

      // Tier 4: FTS5 definition search (excluding exact, prefix, and form hits)
      let c4 = 0;
      if (ftsQuery) {
        const ftsCountRows = await this.executor.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt
           FROM entries_fts f
           JOIN entries e ON e.id = f.entry_id
           WHERE entries_fts MATCH ?
             AND e.headword_lower != ?
             AND e.headword_lower NOT LIKE ? ESCAPE '\\'
             AND NOT EXISTS (
               SELECT 1 FROM word_forms wf WHERE wf.entry_id = e.id AND wf.form_lower = ?
             )
             ${posClause};`,
          [ftsQuery, qLower, qPrefixLike, qLower, ...posParams]
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
          message: `No matching entry found for “${rawQuery}” in the offline English SQLite dictionary.`,
        };
      }

      type TierMatch = {
        row: SqlEntryRow;
        matchedField: StandardSearchResult['matchedField'];
        matchedTerm: string;
        score: number;
      };
      const matchedItems: TierMatch[] = [];

      const takeSlice = (tierStart: number, tierSize: number): { localOffset: number; localLimit: number } | null => {
        if (tierSize <= 0) return null;
        const pageEnd = offset + limit;
        const tierEnd = tierStart + tierSize;
        const overlapStart = Math.max(offset, tierStart);
        const overlapEnd = Math.min(pageEnd, tierEnd);
        if (overlapStart >= overlapEnd) return null;
        return {
          localOffset: overlapStart - tierStart,
          localLimit: overlapEnd - overlapStart,
        };
      };

      const s1 = takeSlice(0, c1);
      if (s1) {
        const rows = await this.executor.query<SqlEntryRow>(
          `SELECT e.id, e.headword, e.headword_lower, e.part_of_speech, e.primary_ipa, e.all_ipas, e.audio_file, e.etymology, e.source_id
           FROM entries e
           WHERE e.headword_lower = ? ${posClause}
           ORDER BY e.id ASC
           LIMIT ? OFFSET ?;`,
          [qLower, ...posParams, s1.localLimit, s1.localOffset]
        );
        for (const r of rows) {
          matchedItems.push({
            row: r,
            matchedField: r.headword === rawQuery ? 'headword-exact' : 'headword-normalized',
            matchedTerm: r.headword,
            score: r.headword === rawQuery ? 100 : 96,
          });
        }
      }

      const s2 = takeSlice(c1, c2);
      if (s2) {
        const rows = await this.executor.query<SqlEntryRow>(
          `SELECT e.id, e.headword, e.headword_lower, e.part_of_speech, e.primary_ipa, e.all_ipas, e.audio_file, e.etymology, e.source_id
           FROM entries e
           WHERE e.headword_lower LIKE ? ESCAPE '\\' AND e.headword_lower != ? ${posClause}
           ORDER BY length(e.headword_lower) ASC, e.headword_lower ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [qPrefixLike, qLower, ...posParams, s2.localLimit, s2.localOffset]
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
        const rows = await this.executor.query<SqlEntryRow & { matched_form: string }>(
          `SELECT e.id, e.headword, e.headword_lower, e.part_of_speech, e.primary_ipa, e.all_ipas, e.audio_file, e.etymology, e.source_id,
                  MIN(wf.form) AS matched_form
           FROM word_forms wf
           JOIN entries e ON e.id = wf.entry_id
           WHERE wf.form_lower = ?
             AND e.headword_lower != ?
             AND e.headword_lower NOT LIKE ? ESCAPE '\\'
             ${posClause}
           GROUP BY e.id
           ORDER BY e.headword_lower ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [qLower, qLower, qPrefixLike, ...posParams, s3.localLimit, s3.localOffset]
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
          `SELECT e.id, e.headword, e.headword_lower, e.part_of_speech, e.primary_ipa, e.all_ipas, e.audio_file, e.etymology, e.source_id
           FROM entries_fts f
           JOIN entries e ON e.id = f.entry_id
           WHERE entries_fts MATCH ?
             AND e.headword_lower != ?
             AND e.headword_lower NOT LIKE ? ESCAPE '\\'
             AND NOT EXISTS (
               SELECT 1 FROM word_forms wf WHERE wf.entry_id = e.id AND wf.form_lower = ?
             )
             ${posClause}
           ORDER BY bm25(entries_fts) ASC, e.id ASC
           LIMIT ? OFFSET ?;`,
          [ftsQuery, qLower, qPrefixLike, qLower, ...posParams, s4.localLimit, s4.localOffset]
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

    const [senseRows, formRows] = await Promise.all([
      this.executor.query<SqlSenseRow>(
        `SELECT id, entry_id, sense_number, definition, tags, examples, synonyms, antonyms
         FROM senses
         WHERE entry_id IN (${placeholders})
         ORDER BY entry_id ASC, sense_number ASC;`,
        entryIds
      ),
      this.executor.query<SqlWordFormRow>(
        `SELECT entry_id, form, form_lower, tags
         FROM word_forms
         WHERE entry_id IN (${placeholders})
         ORDER BY id ASC;`,
        entryIds
      ),
    ]);

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
      const allIpas = safeJsonParse<PronunciationVariant[]>(row.all_ipas, []);

      const synonymsSet = new Set<string>();
      const antonymsSet = new Set<string>();
      const allExamples: ExampleSentence[] = [];
      const allTags = new Set<string>();

      const mappedSenses: WordSense[] = rawSenses.map((s) => {
        const sTags = safeJsonParse<string[]>(s.tags, []);
        const sExamples = safeJsonParse<Array<{ text: string; ref?: string }>>(s.examples, []);
        const sSynonyms = safeJsonParse<string[]>(s.synonyms, []);
        const sAntonyms = safeJsonParse<string[]>(s.antonyms, []);

        for (const t of sTags) allTags.add(t);
        for (const syn of sSynonyms) {
          if (syn) synonymsSet.add(syn);
        }
        for (const ant of sAntonyms) {
          if (ant) antonymsSet.add(ant);
        }

        const mappedExamples: ExampleSentence[] = sExamples
          .filter((ex) => ex && ex.text)
          .map((ex) => ({
            sourceText: ex.text,
            targetText: '',
            culturalContext: ex.ref ? `Reference: ${ex.ref}` : undefined,
          }));
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

      const primaryDefinition = mappedSenses[0]?.definition || '';
      const entry: WordEntry = {
        id: entryStringId,
        sourceLang: 'en',
        headword: row.headword,
        ipa: row.primary_ipa || '',
        allIpas,
        isMonolingualSqlite: true,
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
        sourceAttribution:
          meta?.sourceName || ENGLISH_PACK_MANIFEST.attribution.sourceName,
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
