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
import { HAUSA_PACK_MANIFEST, isHausaSqliteIntegrationEnabled } from '../config/hausaDictionaryConfig';
import { hausaPackService } from './hausaPackService';
import { TextNormalization } from './textNormalization';
import { SqlQueryExecutor } from './englishSqliteRepository';

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
      // Ignore if no stale connection existed
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
      // Ignore close errors
    }
  }

  public async query<T = Record<string, unknown>>(statement: string, values: unknown[] = []): Promise<T[]> {
    if (!this.openedPath) {
      throw new Error('Hausa SQLite connection is not open.');
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
  headword_norm?: string | null;
  part_of_speech: string;
  primary_ipa: string | null;
  primary_definition: string;
  source_id: number;
}

interface SqlWordFormRow {
  id: number;
  entry_id: number;
  form: string;
  form_norm: string | null;
}

interface SqlExtSenseRow {
  id: number;
  entry_id: number;
  sense_number: number;
  definition: string;
  examples: string | null;
  synonyms: string | null;
  antonyms: string | null;
}

interface SqlExtExtensionRow {
  entry_id: number;
  all_ipas: string | null;
  etymology: string | null;
}

export interface HausaSearchOptions {
  partOfSpeech?: string;
  letter?: string;
  limit?: number;
  offset?: number;
}

export interface HausaBenchmarkReport {
  timestamp: string;
  exactHeadwordMs: number;
  prefixQueryMs: number;
  ftsDefinitionMs: number;
  normalizedQueryMs: number;
  totalEntriesVerified: number;
  activeDbPath: string;
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

export class HausaSqliteRepository {
  private executor: SqlQueryExecutor = new CapacitorSqliteExecutor();
  private extendedDbAttached = false;
  private attachedExtPath: string | null = null;
  private extPathOverride: string | null | undefined = undefined;
  private cachedMetadata: {
    schemaVersion: number;
    packLayer: string;
    extendedAttached: boolean;
  } | null = null;

  public _injectExecutor(executor: SqlQueryExecutor | null): void {
    this.executor = executor || new CapacitorSqliteExecutor();
    this.extendedDbAttached = false;
    this.attachedExtPath = null;
    this.cachedMetadata = null;
  }

  public _injectExtendedDbPathForTest(extPath: string | null | undefined): void {
    this.extPathOverride = extPath;
    if (!extPath && this.extendedDbAttached) {
      void this.detachExtendedDatabase();
    }
  }

  public getExecutor(): SqlQueryExecutor {
    return this.executor;
  }

  public getCachedMetadata() {
    return this.cachedMetadata;
  }

  public async closeConnection(): Promise<void> {
    if (this.extendedDbAttached) {
      await this.detachExtendedDatabase();
    }
    await this.executor.close();
  }

  public isPackActive(): boolean {
    if (!isHausaSqliteIntegrationEnabled()) return false;
    return this.executor.isOpen() || hausaPackService.getCachedStatus().installed;
  }

  public async ensureConnection(): Promise<void> {
    const exec = this.getExecutor();
    if (!exec.isOpen()) {
      const status = await hausaPackService.ensureStatusLoaded();
      if (!status.installed || !status.dbPath) {
        throw new Error('Hausa SQLite dictionary pack is not installed.');
      }
      await exec.open(status.dbPath);
    }

    // Automatically attach optional Extended pack if present (unless explicitly disabled/nullified)
    const desiredExtPath =
      this.extPathOverride !== undefined
        ? this.extPathOverride
        : hausaPackService.getCachedStatus().extendedInstalled
          ? hausaPackService.getCachedStatus().extendedDbPath || null
          : null;

    if (desiredExtPath && (!this.extendedDbAttached || this.attachedExtPath !== desiredExtPath)) {
      await this.attachExtendedDatabaseInternal(desiredExtPath);
    } else if (!desiredExtPath && this.extendedDbAttached) {
      await this.detachExtendedDatabase();
    }

    if (!this.cachedMetadata) {
      try {
        const metaRows = await exec.query<{ key: string; value: string }>(
          `SELECT key, value FROM metadata WHERE key IN ('schema_version', 'pack_layer');`
        );
        const map = new Map(metaRows.map((r) => [r.key, r.value]));
        this.cachedMetadata = {
          schemaVersion: Number(map.get('schema_version') || 3),
          packLayer: map.get('pack_layer') || 'core',
          extendedAttached: this.extendedDbAttached,
        };
      } catch {
        this.cachedMetadata = {
          schemaVersion: 3,
          packLayer: 'core',
          extendedAttached: this.extendedDbAttached,
        };
      }
    } else {
      this.cachedMetadata.extendedAttached = this.extendedDbAttached;
    }
  }

  private async attachExtendedDatabaseInternal(extendedDbPath: string): Promise<boolean> {
    const exec = this.getExecutor();
    try {
      await exec.query(`ATTACH DATABASE ? AS ext;`, [extendedDbPath]);
      this.extendedDbAttached = true;
      this.attachedExtPath = extendedDbPath;
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already in use') || msg.includes('already exists')) {
        this.extendedDbAttached = true;
        this.attachedExtPath = extendedDbPath;
        return true;
      }
      this.extendedDbAttached = false;
      this.attachedExtPath = null;
      return false;
    }
  }

  public async attachExtendedDatabase(extendedDbPath: string): Promise<boolean> {
    await this.ensureConnection();
    const ok = await this.attachExtendedDatabaseInternal(extendedDbPath);
    if (this.cachedMetadata) {
      this.cachedMetadata.extendedAttached = ok;
    }
    return ok;
  }

  public async detachExtendedDatabase(): Promise<boolean> {
    if (!this.extendedDbAttached) return true;
    try {
      await this.getExecutor().query(`DETACH DATABASE ext;`);
    } catch {
      // Ignore detach errors
    } finally {
      this.extendedDbAttached = false;
      this.attachedExtPath = null;
      if (this.cachedMetadata) {
        this.cachedMetadata.extendedAttached = false;
      }
    }
    return true;
  }

  public isExtendedAttached(): boolean {
    return this.extendedDbAttached;
  }

  public async searchStandard(
    query: string,
    options: HausaSearchOptions = {}
  ): Promise<StandardSearchResponse> {
    const rawTrimmed = (query || '').trim();
    const queryLower = rawTrimmed.toLowerCase();
    const { soft: qSoft, deep: qDeep } = TextNormalization.normalizeLatin(rawTrimmed);
    const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const offset = Math.max(0, options.offset || 0);

    await this.ensureConnection();
    const exec = this.getExecutor();

    // 1. Browse / Filter Mode (empty query)
    if (!rawTrimmed) {
      return this.browseEntries(options, limit, offset);
    }

    // 2. Candidate collection
    const candidateMap = new Map<number, { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }>();

    // A. Exact headword lookup
    const exactRows = await exec.query<SqlEntryRow>(
      `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       WHERE e.headword_lower = ?;`,
      [queryLower]
    );
    for (const r of exactRows) {
      candidateMap.set(r.id, { score: 100, matchedField: 'headword-exact', matchedTerm: r.headword });
    }

    // B. Normalized headword lookup (hooked consonants ɓ, ɗ, ƙ, ƴ and tone marks)
    const normCandidates = Array.from(new Set([qSoft, qDeep].filter((v) => v && v.length > 0)));
    if (normCandidates.length > 0) {
      const ph = normCandidates.map(() => '?').join(',');
      const normRows = await exec.query<SqlEntryRow>(
        `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
         FROM entries e
         JOIN parts_of_speech p ON p.id = e.pos_id
         WHERE e.headword_norm IN (${ph}) OR e.headword_lower IN (${ph});`,
        [...normCandidates, ...normCandidates]
      );
      for (const r of normRows) {
        if (!candidateMap.has(r.id)) {
          candidateMap.set(r.id, { score: 94, matchedField: 'headword-normalized', matchedTerm: r.headword });
        }
      }
    }

    // C. Inflected word forms lookup
    const formCandidates = Array.from(new Set([queryLower, qSoft, qDeep].filter((v) => v && v.length > 0)));
    const wfPh = formCandidates.map(() => '?').join(',');
    const formRows = await exec.query<SqlWordFormRow>(
      `SELECT wf.entry_id, wf.form, wf.form_norm
       FROM word_forms wf
       WHERE wf.form IN (${wfPh}) OR (wf.form_norm IS NOT NULL AND wf.form_norm IN (${wfPh}));`,
      [...formCandidates, ...formCandidates]
    );
    for (const r of formRows) {
      if (!candidateMap.has(r.entry_id)) {
        candidateMap.set(r.entry_id, { score: 86, matchedField: 'morphology', matchedTerm: r.form });
      }
    }

    // D. Prefix lookup (when query length >= 2)
    if (queryLower.length >= 2) {
      const upperBound = computePrefixUpperBound(queryLower);
      if (upperBound) {
        const prefixRows = await this.executor.query<SqlEntryRow>(
          `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
           FROM entries e
           JOIN parts_of_speech p ON p.id = e.pos_id
           WHERE e.headword_lower >= ? AND e.headword_lower < ?
           LIMIT 50;`,
          [queryLower, upperBound]
        );
        for (const r of prefixRows) {
          if (!candidateMap.has(r.id)) {
            candidateMap.set(r.id, { score: 80, matchedField: 'headword-prefix', matchedTerm: r.headword });
          }
        }
      }
    }

    // E. FTS5 Definition Full-Text Search
    const ftsQuery = buildFts5Query(rawTrimmed);
    if (ftsQuery) {
      try {
        const ftsRows = await this.executor.query<{ rowid: number; headword: string }>(
          `SELECT rowid, headword FROM entries_fts WHERE entries_fts MATCH ? LIMIT 30;`,
          [ftsQuery]
        );
        for (const r of ftsRows) {
          if (!candidateMap.has(r.rowid)) {
            candidateMap.set(r.rowid, { score: 70, matchedField: 'definition', matchedTerm: r.headword });
          }
        }
      } catch {
        // Ignore FTS syntax errors
      }
    }

    if (candidateMap.size === 0) {
      return {
        status: 'not_found',
        language: 'ha',
        query: rawTrimmed,
        results: [],
        totalCount: 0,
        hasMore: false,
        offset,
        limit,
        engineSource: 'sqlite-ha',
        message: `No Hausa entries found matching "${rawTrimmed}".`,
      };
    }

    // Hydrate candidates
    const allCandidateIds = Array.from(candidateMap.keys());
    const hydratedResults = await this.hydrateEntries(allCandidateIds, candidateMap, options);

    // Apply pagination
    const totalCount = hydratedResults.length;
    const pagedResults = hydratedResults.slice(offset, offset + limit);

    return {
      status: 'ok',
      language: 'ha',
      query: rawTrimmed,
      results: pagedResults,
      totalCount,
      hasMore: offset + limit < totalCount,
      offset,
      limit,
      engineSource: 'sqlite-ha',
    };
  }

  private async browseEntries(
    options: HausaSearchOptions,
    limit: number,
    offset: number
  ): Promise<StandardSearchResponse> {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (options.partOfSpeech && options.partOfSpeech !== 'all') {
      whereClauses.push('p.name = ?');
      params.push(options.partOfSpeech.trim().toLowerCase());
    }

    if (options.letter && options.letter !== 'all') {
      const letterLower = options.letter.trim().toLowerCase();
      const upperBound = computePrefixUpperBound(letterLower);
      if (upperBound) {
        whereClauses.push('e.headword_lower >= ? AND e.headword_lower < ?');
        params.push(letterLower, upperBound);
      } else {
        whereClauses.push('e.headword_lower LIKE ?');
        params.push(`${letterLower}%`);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRows = await this.executor.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM entries e JOIN parts_of_speech p ON p.id = e.pos_id ${whereSql};`,
      params
    );
    const totalCount = countRows[0]?.total || 0;

    const pageRows = await this.executor.query<SqlEntryRow>(
      `SELECT e.id, e.headword, e.headword_lower, e.primary_ipa, e.primary_definition, p.name AS part_of_speech, e.source_id
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       ${whereSql}
       ORDER BY e.headword_lower ASC
       LIMIT ? OFFSET ?;`,
      [...params, limit, offset]
    );

    const matchMeta = new Map<number, { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }>();
    for (const r of pageRows) {
      matchMeta.set(r.id, { score: 100, matchedField: 'headword-exact', matchedTerm: r.headword });
    }

    const hydrated = await this.hydrateEntries(
      pageRows.map((r) => r.id),
      matchMeta,
      options
    );

    return {
      status: 'ok',
      language: 'ha',
      query: '',
      results: hydrated,
      totalCount,
      hasMore: offset + limit < totalCount,
      offset,
      limit,
      engineSource: 'sqlite-ha',
    };
  }

  private async hydrateEntries(
    entryIds: number[],
    candidateMap: Map<number, { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }>,
    options: HausaSearchOptions
  ): Promise<StandardSearchResult[]> {
    if (entryIds.length === 0) return [];

    const placeholders = entryIds.map(() => '?').join(',');
    const entryRows = await this.executor.query<SqlEntryRow>(
      `SELECT e.id, e.headword, e.headword_lower, e.primary_ipa, e.primary_definition, p.name AS part_of_speech, e.source_id
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       WHERE e.id IN (${placeholders});`,
      entryIds
    );

    // Fetch word forms
    const formsRows = await this.executor.query<SqlWordFormRow>(
      `SELECT wf.entry_id, wf.form, wf.form_norm
       FROM word_forms wf
       WHERE wf.entry_id IN (${placeholders});`,
      entryIds
    );
    const formsByEntry = new Map<number, MorphologicalForm[]>();
    for (const f of formsRows) {
      const list = formsByEntry.get(f.entry_id) || [];
      list.push({ form: f.form, label: 'variant' });
      formsByEntry.set(f.entry_id, list);
    }

    // Check optional Extended enrichment
    let extSensesByEntry = new Map<number, WordSense[]>();
    let extDataByEntry = new Map<number, { allIpas?: PronunciationVariant[]; etymology?: string }>();

    if (this.extendedDbAttached) {
      try {
        const extRows = await this.executor.query<SqlExtSenseRow>(
          `SELECT s.id, s.entry_id, s.sense_number, s.definition, s.examples, s.synonyms, s.antonyms
           FROM ext.senses_ext s
           WHERE s.entry_id IN (${placeholders})
           ORDER BY s.sense_number ASC;`,
          entryIds
        );
        for (const s of extRows) {
          const list = extSensesByEntry.get(s.entry_id) || [];
          const rawExamples = safeJsonParse<unknown[]>(s.examples, []);
          const exList: ExampleSentence[] = rawExamples
            .map((ex) => {
              if (typeof ex === 'string') {
                return { sourceText: ex, targetText: '' };
              }
              if (ex && typeof ex === 'object') {
                const obj = ex as { sourceText?: string; targetText?: string; targetTranslation?: string };
                return {
                  sourceText: obj.sourceText || '',
                  targetText: obj.targetText || obj.targetTranslation || '',
                };
              }
              return null;
            })
            .filter((x): x is ExampleSentence => x !== null && x.sourceText.length > 0);
          list.push({
            id: `ha-ext-sense-${s.id}`,
            entryId: `ha-${s.entry_id}`,
            senseNumber: s.sense_number,
            partOfSpeech: '',
            definition: s.definition,
            examples: exList,
            synonyms: safeJsonParse(s.synonyms, []),
            antonyms: safeJsonParse(s.antonyms, []),
            relatedWords: [],
          });
          extSensesByEntry.set(s.entry_id, list);
        }

        const extMetaRows = await this.executor.query<SqlExtExtensionRow>(
          `SELECT ee.entry_id, ee.all_ipas, ee.etymology
           FROM ext.entry_extensions ee
           WHERE ee.entry_id IN (${placeholders});`,
          entryIds
        );
        for (const m of extMetaRows) {
          const rawIpas = safeJsonParse<unknown[]>(m.all_ipas, []);
          const ipas: PronunciationVariant[] = rawIpas
            .map((item) => {
              if (typeof item === 'string') return { ipa: item, tags: [] };
              if (item && typeof item === 'object' && typeof (item as { ipa?: unknown }).ipa === 'string') {
                const obj = item as { ipa: string; tags?: string[] };
                return { ipa: obj.ipa, tags: Array.isArray(obj.tags) ? obj.tags : [] };
              }
              return null;
            })
            .filter((x): x is PronunciationVariant => x !== null);
          extDataByEntry.set(m.entry_id, {
            allIpas: ipas,
            etymology: m.etymology || undefined,
          });
        }
      } catch {
        // Fallback gracefully if Extended tables not available
      }
    }

    const results: StandardSearchResult[] = [];

    for (const row of entryRows) {
      const match = candidateMap.get(row.id) || { score: 50, matchedField: 'headword-exact' as const, matchedTerm: row.headword };

      // Filter by POS if requested
      if (options.partOfSpeech && options.partOfSpeech !== 'all') {
        if (row.part_of_speech.toLowerCase() !== options.partOfSpeech.trim().toLowerCase()) {
          continue;
        }
      }

      const forms = formsByEntry.get(row.id) || [];
      const extSenses = extSensesByEntry.get(row.id);
      const extMeta = extDataByEntry.get(row.id);

      const senses: WordSense[] =
        extSenses && extSenses.length > 0
          ? extSenses.map((s) => ({ ...s, partOfSpeech: s.partOfSpeech || row.part_of_speech }))
          : [
              {
                id: `ha-core-sense-${row.id}`,
                entryId: `ha-${row.id}`,
                senseNumber: 1,
                partOfSpeech: row.part_of_speech,
                definition: row.primary_definition,
                examples: [],
                synonyms: [],
                antonyms: [],
                relatedWords: [],
              },
            ];

      const isCoreOnly = !this.extendedDbAttached;
      const entry: WordEntry = {
        id: `ha-${row.id}`,
        sourceLang: 'ha',
        headword: row.headword,
        headwordScriptVariant: null,
        ipa: row.primary_ipa || '',
        allIpas: extMeta?.allIpas,
        isMonolingualSqlite: true,
        isCoreOnly,
        extendedInstalled: this.extendedDbAttached,
        audioPhoneticText: row.headword,
        partOfSpeech: row.part_of_speech,
        genderOrClass: undefined,
        dialect: 'Standard Hausa (Kano)',
        register: 'Standard vocabulary',
        rootWord: null,
        etymology: extMeta?.etymology,
        definition: row.primary_definition,
        definitionEn: row.primary_definition,
        culturalNote: undefined,
        translations: {},
        examples: senses[0]?.examples || [],
        synonyms: senses[0]?.synonyms || [],
        antonyms: senses[0]?.antonyms || [],
        verifiedOffline: true,
        verificationStatus: 'verified',
        sourceAttribution: HAUSA_PACK_MANIFEST.attribution.attributionText,
        tags: ['Hausa Core Pack', 'Offline SQLite'],
      };

      results.push({
        entry,
        senses,
        morphologicalForms: forms,
        score: match.score,
        matchedField: match.matchedField,
        matchedTerm: match.matchedTerm,
      });
    }

    // Sort descending by score, then alphabetically
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.headword.localeCompare(b.entry.headword, 'ha');
    });

    return results;
  }

  public async runBenchmark(): Promise<HausaBenchmarkReport> {
    await this.ensureConnection();

    // 1. Exact lookup
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT e.id FROM entries e WHERE e.headword_lower = 'ruwa';`);
    }
    const exactHeadwordMs = (performance.now() - t0) / 50;

    // 2. Prefix lookup
    const t1 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT e.id FROM entries e WHERE e.headword_lower >= 'bar' AND e.headword_lower < 'bas' LIMIT 20;`);
    }
    const prefixQueryMs = (performance.now() - t1) / 50;

    // 3. FTS5 full-text definition search
    const t2 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'water' LIMIT 20;`);
    }
    const ftsDefinitionMs = (performance.now() - t2) / 50;

    // 4. Normalized hooked consonant search
    const t3 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT e.id FROM entries e WHERE e.headword_norm = 'kofa' OR e.headword_lower = 'kofa';`);
    }
    const normalizedQueryMs = (performance.now() - t3) / 50;

    const countRows = await this.executor.query<{ total: number }>(`SELECT COUNT(*) AS total FROM entries;`);
    const totalEntries = countRows[0]?.total || 0;

    return {
      timestamp: new Date().toISOString(),
      exactHeadwordMs: Number(exactHeadwordMs.toFixed(3)),
      prefixQueryMs: Number(prefixQueryMs.toFixed(3)),
      ftsDefinitionMs: Number(ftsDefinitionMs.toFixed(3)),
      normalizedQueryMs: Number(normalizedQueryMs.toFixed(3)),
      totalEntriesVerified: totalEntries,
      activeDbPath: this.executor.getDbPath() || '',
    };
  }
}

export const hausaSqliteRepo = new HausaSqliteRepository();
