import { CapacitorSQLite } from '@capacitor-community/sqlite';
import {
  WordEntry,
  WordSense,
  MorphologicalForm,
  StandardSearchResult,
  StandardSearchResponse,
  ExampleSentence,
  PronunciationVariant,
  VerifiedAudioRef,
  ConflictSourceVersion,
} from '../types/dictionary';
import { YORUBA_PACK_MANIFEST, isYorubaSqliteIntegrationEnabled } from '../config/yorubaDictionaryConfig';
import { yorubaPackService } from './yorubaPackService';
import { TextNormalization } from './textNormalization';
import { SqlQueryExecutor } from './englishSqliteRepository';
import { hausaConflictReviewService, type HausaConflictReviewRecord } from './hausaConflictReviewService';

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
      throw new Error('Yoruba SQLite connection is not open.');
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
  script_variant?: string | null;
  script_variant_norm?: string | null;
  part_of_speech: string;
  primary_ipa: string | null;
  audio_file?: string | null;
  dialect?: string | null;
  definition_yo?: string | null;
  definition_en?: string | null;
  primary_definition: string;
  definition_type?: WordEntry['definitionType'];
  verification_status?: WordEntry['sourceVerificationStatus'];
  has_conflict?: number;
  source_id: number;
  source_name?: string;
  source_license?: string;
  source_attribution?: string;
  source_url?: string;
}

interface SqlWordFormRow {
  id?: number;
  entry_id: number;
  form: string;
  form_norm: string | null;
}

interface SqlExtSenseRow {
  id: number;
  entry_id: number;
  sense_number: number;
  part_of_speech?: string | null;
  definition?: string | null;
  definition_yo?: string | null;
  definition_en?: string | null;
  definition_type?: WordSense['definitionType'];
  source_id?: number | null;
  verification_status?: string | null;
  examples: string | null;
  synonyms: string | null;
  antonyms: string | null;
}

interface SqlExtExtensionRow {
  entry_id: number;
  all_ipas: string | null;
  etymology: string | null;
  audio_refs?: string | null;
  conflict_notes?: string | null;
}

interface SqlSourceRow {
  id: number;
  code: string;
  name: string;
  license: string;
  attribution_text: string;
  source_url: string;
}

interface SqlConflictReviewRow {
  id: number;
  entry_id: number;
  headword: string;
  part_of_speech: string;
  conflicting_sources_json: string;
  disagreement_nature: string;
  review_decision: string;
  reviewer_status: string;
  review_notes: string | null;
}

export interface YorubaSearchOptions {
  strictDiacritics?: boolean;
  partOfSpeech?: string;
  letter?: string;
  limit?: number;
  offset?: number;
}

export interface YorubaBenchmarkReport {
  timestamp: string;
  exactHeadwordMs: number;
  prefixQueryMs: number;
  ftsDefinitionMs: number;
  normalizedQueryMs: number;
  totalEntriesVerified: number;
  activeDbPath: string;
}

export interface YorubaInstalledStats {
  acceptedEntries: number;
  distinctHeadwords: number;
  totalSenses: number;
  bilingualLinksCount: number;
  wordFormsCount: number;
  yorubaMonolingualCount: number;
  bilingualExplanationCount: number;
  englishGlossOnlyCount: number;
  conflictCount: number;
  extendedAttached: boolean;
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

function escapeSqlLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function getLicenseUrl(license: string): string {
  if (/CC0/i.test(license)) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (/CC BY 2\.0/i.test(license)) return 'https://creativecommons.org/licenses/by/2.0/fr/';
  if (/CC BY 4\.0/i.test(license)) return 'https://creativecommons.org/licenses/by/4.0/';
  return 'https://creativecommons.org/licenses/by-sa/4.0/';
}

export class YorubaSqliteRepository {
  private executor: SqlQueryExecutor;
  private extendedDbAttached = false;
  private attachedExtPath: string | null = null;
  private extPathOverride: string | null | undefined = undefined;
  private cachedMetadata: {
    schemaVersion: number;
    packLayer: string;
    datasetVersion: string;
    extendedAttached: boolean;
  } | null = null;
  private cachedSources = new Map<number, SqlSourceRow>();

  constructor(executor?: SqlQueryExecutor) {
    this.executor = executor || new CapacitorSqliteExecutor();
  }

  public _injectExecutor(executor: SqlQueryExecutor | null): void {
    this.executor = executor || new CapacitorSqliteExecutor();
    this.extendedDbAttached = false;
    this.attachedExtPath = null;
    this.extPathOverride = undefined;
    this.cachedMetadata = null;
    this.cachedSources.clear();
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
    this.cachedMetadata = null;
    this.cachedSources.clear();
  }

  public async close(): Promise<void> {
    await this.closeConnection();
  }

  public isPackActive(): boolean {
    if (!isYorubaSqliteIntegrationEnabled()) return false;
    return this.executor.isOpen() || yorubaPackService.getCachedStatus().installed;
  }

  public async ensureConnection(): Promise<void> {
    const exec = this.getExecutor();
    if (!exec.isOpen()) {
      const status = await yorubaPackService.ensureStatusLoaded();
      if (!status.installed || !status.dbPath) {
        throw new Error('Yoruba SQLite dictionary pack is not installed.');
      }
      await exec.open(status.dbPath);
    }

    const desiredExtPath =
      this.extPathOverride !== undefined
        ? this.extPathOverride
        : yorubaPackService.getCachedStatus().extendedInstalled
          ? yorubaPackService.getCachedStatus().extendedDbPath || null
          : null;

    if (desiredExtPath && (!this.extendedDbAttached || this.attachedExtPath !== desiredExtPath)) {
      await this.attachExtendedDatabaseInternal(desiredExtPath);
    } else if (!desiredExtPath && this.extendedDbAttached) {
      await this.detachExtendedDatabase();
    }

    if (!this.cachedMetadata) {
      try {
        const metaRows = await exec.query<{ key: string; value: string }>(
          `SELECT key, value FROM metadata WHERE key IN ('schema_version', 'pack_layer', 'dataset_version');`
        );
        const map = new Map(metaRows.map((r) => [r.key, r.value]));
        const schemaVer = Number(map.get('schema_version') || 4);
        this.cachedMetadata = {
          schemaVersion: Number.isNaN(schemaVer) ? 4 : schemaVer,
          packLayer: map.get('pack_layer') || 'core',
          datasetVersion: map.get('dataset_version') || YORUBA_PACK_MANIFEST.datasetVersion,
          extendedAttached: this.extendedDbAttached,
        };
      } catch {
        this.cachedMetadata = {
          schemaVersion: 4,
          packLayer: 'core',
          datasetVersion: YORUBA_PACK_MANIFEST.datasetVersion,
          extendedAttached: this.extendedDbAttached,
        };
      }
    } else {
      this.cachedMetadata.extendedAttached = this.extendedDbAttached;
    }

    if (this.cachedSources.size === 0) {
      try {
        const srcRows = await exec.query<SqlSourceRow>(
          `SELECT id, code, name, license, attribution_text, source_url FROM sources;`
        );
        for (const s of srcRows) {
          this.cachedSources.set(s.id, s);
        }
      } catch {
        // Fallback if sources table unavailable
      }
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
    this.extPathOverride = extendedDbPath;
    await this.ensureConnection();
    const ok = await this.attachExtendedDatabaseInternal(extendedDbPath);
    if (this.cachedMetadata) {
      this.cachedMetadata.extendedAttached = ok;
    }
    return ok;
  }

  public async attachExtendedCompanion(extendedDbPath: string): Promise<boolean> {
    return this.attachExtendedDatabase(extendedDbPath);
  }

  public async detachExtendedDatabase(): Promise<boolean> {
    this.extPathOverride = null;
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

  public async detachExtendedCompanion(): Promise<void> {
    await this.detachExtendedDatabase();
  }

  public isExtendedAttached(): boolean {
    return this.extendedDbAttached;
  }

  public async getInstalledStats(): Promise<YorubaInstalledStats> {
    await this.ensureConnection();
    const coreRow = (
      await this.executor.query<{
        accepted_entries: number;
        distinct_headwords: number;
        bilingual_links: number;
        yo_mono: number;
        bilingual_exp: number;
        en_gloss: number;
        conflict_cnt: number;
      }>(
        `SELECT
           COUNT(*) AS accepted_entries,
           COUNT(DISTINCT headword_lower) AS distinct_headwords,
           SUM(CASE WHEN definition_en IS NOT NULL AND length(trim(definition_en)) > 0 THEN 1 ELSE 0 END) AS bilingual_links,
           SUM(CASE WHEN definition_type = 'yoruba_monolingual' THEN 1 ELSE 0 END) AS yo_mono,
           SUM(CASE WHEN definition_type = 'bilingual_explanation' THEN 1 ELSE 0 END) AS bilingual_exp,
           SUM(CASE WHEN definition_type = 'english_gloss' THEN 1 ELSE 0 END) AS en_gloss,
           SUM(CASE WHEN has_conflict = 1 THEN 1 ELSE 0 END) AS conflict_cnt
         FROM entries;`
      )
    )[0];

    const wfRow = (await this.executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM word_forms;`))[0];
    const acceptedEntries = Number(coreRow?.accepted_entries || 0);
    let totalSenses = acceptedEntries;

    if (this.extendedDbAttached) {
      try {
        const extRow = (
          await this.executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ext.senses_ext;`)
        )[0];
        if (extRow && Number(extRow.cnt) > 0) {
          totalSenses = Number(extRow.cnt);
        }
      } catch {
        // Fallback to Core count if Extended senses table unavailable
      }
    }

    return {
      acceptedEntries,
      distinctHeadwords: Number(coreRow?.distinct_headwords || 0),
      totalSenses,
      bilingualLinksCount: Number(coreRow?.bilingual_links || 0),
      wordFormsCount: Number(wfRow?.cnt || 0),
      yorubaMonolingualCount: Number(coreRow?.yo_mono || 0),
      bilingualExplanationCount: Number(coreRow?.bilingual_exp || 0),
      englishGlossOnlyCount: Number(coreRow?.en_gloss || 0),
      conflictCount: Number(coreRow?.conflict_cnt || 0),
      extendedAttached: this.extendedDbAttached,
    };
  }

  public async getAvailableLetters(): Promise<string[]> {
    await this.ensureConnection();
    const rows = await this.executor.query<{ letter: string }>(
      `SELECT DISTINCT substr(headword_norm, 1, 1) AS letter
       FROM entries
       WHERE length(headword_norm) > 0
       ORDER BY letter ASC;`
    );
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.letter) continue;
      const upper = r.letter.toLocaleUpperCase('yo');
      if (/^[A-ZẸỌṢ]$/.test(upper)) {
        set.add(upper);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'yo'));
  }

  public async getEntryById(id: string): Promise<WordEntry | null> {
    const match = id.match(/^yo-sqlite-(\d+)$/);
    if (!match) return null;
    const items = await this.getEntriesByIds([id]);
    return items[0] || null;
  }

  public async getEntriesByIds(entryIds: string[]): Promise<WordEntry[]> {
    const numericIds = entryIds
      .map((id) => {
        const m = id.match(/^yo-sqlite-(\d+)$/);
        return m ? Number(m[1]) : 0;
      })
      .filter((n) => Number.isInteger(n) && n > 0);
    if (numericIds.length === 0) return [];

    await this.ensureConnection();
    const candidateMap = new Map<
      number,
      { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }
    >();
    for (const id of numericIds) {
      candidateMap.set(id, { score: 100, matchedField: 'headword-exact', matchedTerm: '' });
    }
    const hydrated = await this.hydrateEntries(numericIds, candidateMap, {});
    return hydrated.map((h) => h.entry);
  }

  public async getConflictReviewQueue(limit = 50, offset = 0): Promise<{
    totalCount: number;
    items: HausaConflictReviewRecord[];
  }> {
    await this.ensureConnection();

    if (this.extendedDbAttached) {
      try {
        const countRows = await this.executor.query<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM ext.conflict_reviews;`
        );
        const totalCount = Number(countRows[0]?.cnt || 0);
        const rows = await this.executor.query<SqlConflictReviewRow>(
          `SELECT id, entry_id, headword, part_of_speech, conflicting_sources_json,
                  disagreement_nature, review_decision, reviewer_status, review_notes
           FROM ext.conflict_reviews
           ORDER BY headword ASC
           LIMIT ? OFFSET ?;`,
          [limit, offset]
        );
        const items = rows.map((r) => {
          const entryId = `yo-sqlite-${r.entry_id}`;
          const saved = hausaConflictReviewService.getReviewForEntry({
            id: entryId,
            headword: r.headword,
            partOfSpeech: r.part_of_speech,
            hasConflict: true,
            conflictDetails: {
              disagreementNature: r.disagreement_nature,
              versions: safeJsonParse<ConflictSourceVersion[]>(r.conflicting_sources_json, []),
            },
          });
          return (
            saved || {
              entryId,
              headword: r.headword,
              partOfSpeech: r.part_of_speech,
              conflictingVersions: safeJsonParse<ConflictSourceVersion[]>(r.conflicting_sources_json, []),
              disagreementNature: r.disagreement_nature,
              reviewDecision: (r.review_decision as HausaConflictReviewRecord['reviewDecision']) || 'pending',
              reviewerStatus: (r.reviewer_status as HausaConflictReviewRecord['reviewerStatus']) || 'conflict_flagged',
              reviewNotes: r.review_notes || '',
              updatedAt: '',
            }
          );
        });
        return { totalCount, items };
      } catch {
        // Fallback to Core entries with has_conflict = 1
      }
    }

    const countRows = await this.executor.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM entries WHERE has_conflict = 1;`
    );
    const totalCount = Number(countRows[0]?.cnt || 0);
    const coreRows = await this.executor.query<{
      id: number;
      headword: string;
      pos_name: string;
      definition_yo: string | null;
      definition_en: string | null;
      definition_type: string;
      verification_status: string;
      source_code: string;
      source_name: string;
      source_license: string;
    }>(
      `SELECT e.id, e.headword, p.name AS pos_name, e.definition_yo, e.definition_en,
              e.definition_type, e.verification_status,
              s.code AS source_code, s.name AS source_name, s.license AS source_license
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       JOIN sources s ON s.id = e.source_id
       WHERE e.has_conflict = 1
       ORDER BY e.headword_lower ASC
       LIMIT ? OFFSET ?;`,
      [limit, offset]
    );

    const items: HausaConflictReviewRecord[] = coreRows.map((r) => {
      const entryId = `yo-sqlite-${r.id}`;
      const saved = hausaConflictReviewService.getReviewForEntry({
        id: entryId,
        headword: r.headword,
        partOfSpeech: r.pos_name,
        hasConflict: true,
        conflictDetails: {
          disagreementNature:
            'Cross-source Yoruba definitions preserved separately in Core database (attach Extended pack to inspect all competing senses side-by-side).',
          versions: [
            {
              sourceCode: r.source_code,
              sourceName: r.source_name,
              license: r.source_license,
              definitionYo: r.definition_yo,
              definitionEn: r.definition_en,
              definitionType: r.definition_type,
              verificationStatus: r.verification_status,
            },
          ],
        },
      });
      return saved!;
    });

    return { totalCount, items };
  }

  public async searchStandard(
    query: string,
    options: YorubaSearchOptions = {}
  ): Promise<StandardSearchResponse> {
    if (!this.isPackActive()) {
      return {
        status: 'language_not_installed',
        language: 'yo',
        query: (query || '').trim(),
        results: [],
        totalCount: 0,
        hasMore: false,
        limit: options.limit || DEFAULT_PAGE_LIMIT,
        offset: options.offset || 0,
        engineSource: 'sqlite-yo',
      };
    }

    const rawTrimmed = (query || '').trim();
    const norm = TextNormalization.normalizeYoruba(rawTrimmed);
    const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const offset = Math.max(0, options.offset || 0);
    const strictDiacritics = Boolean(options.strictDiacritics);

    await this.ensureConnection();
    const exec = this.getExecutor();

    // 1. Browse / Filter Mode
    if (!rawTrimmed) {
      return this.browseEntries(options, limit, offset);
    }

    const candidateMap = new Map<
      number,
      { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }
    >();

    // A. Exact NFC tonal + under-dot lookup (strict tone match, highest rank)
    const exactRows = await exec.query<SqlEntryRow>(
      `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       WHERE e.headword_lower = ?;`,
      [norm.exact]
    );
    for (const r of exactRows) {
      candidateMap.set(r.id, { score: 100, matchedField: 'headword-exact', matchedTerm: r.headword });
    }

    // Strict diacritic mode: ONLY return exact tonal/under-dot matches & exact word forms
    if (strictDiacritics) {
      const formRows = await exec.query<SqlWordFormRow>(
        `SELECT wf.entry_id, wf.form, wf.form_norm
         FROM word_forms wf
         WHERE lower(wf.form) = ?;`,
        [norm.exact]
      );
      for (const r of formRows) {
        if (!candidateMap.has(r.entry_id)) {
          candidateMap.set(r.entry_id, { score: 94, matchedField: 'morphology', matchedTerm: r.form });
        }
      }

      if (norm.exact.length >= 2) {
        const upperBound = computePrefixUpperBound(norm.exact);
        if (upperBound) {
          const prefixRows = await exec.query<SqlEntryRow>(
            `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
             FROM entries e
             JOIN parts_of_speech p ON p.id = e.pos_id
             WHERE e.headword_lower >= ? AND e.headword_lower < ?
             LIMIT 40;`,
            [norm.exact, upperBound]
          );
          for (const r of prefixRows) {
            if (!candidateMap.has(r.id)) {
              candidateMap.set(r.id, { score: 84, matchedField: 'headword-prefix', matchedTerm: r.headword });
            }
          }
        }
      }
    } else {
      // Flexible mode: preserve all tonal variants as distinct results while folding query tiers

      // B. Tone-insensitive lookup when query omitted tones or queried plain/under-dot base
      if (norm.ascii) {
        const normRows = await exec.query<SqlEntryRow>(
          `SELECT e.id, e.headword, e.headword_lower, e.dialect, p.name AS part_of_speech
           FROM entries e
           JOIN parts_of_speech p ON p.id = e.pos_id
           WHERE e.headword_norm = ?;`,
          [norm.ascii]
        );
        for (const r of normRows) {
          if (!candidateMap.has(r.id)) {
            const candidateNorm = TextNormalization.normalizeYoruba(r.headword);
            if (norm.hasUnderDots && candidateNorm.toneInsensitive === norm.toneInsensitive) {
              candidateMap.set(r.id, { score: 96, matchedField: 'headword-normalized', matchedTerm: r.headword });
            } else if (!norm.hasToneMarks && !norm.hasUnderDots) {
              candidateMap.set(r.id, { score: 92, matchedField: 'headword-normalized', matchedTerm: r.headword });
            } else if (!norm.hasToneMarks && candidateNorm.toneInsensitive === norm.toneInsensitive) {
              candidateMap.set(r.id, { score: 95, matchedField: 'headword-normalized', matchedTerm: r.headword });
            }
          }
        }
      }

      // C. Word forms lookup (morphological & alternate tonal/orthographic forms)
      const wfCandidates = Array.from(new Set([norm.exact, norm.toneInsensitive, norm.ascii].filter(Boolean)));
      if (wfCandidates.length > 0) {
        const ph = wfCandidates.map(() => '?').join(',');
        const formRows = await exec.query<SqlWordFormRow>(
          `SELECT wf.entry_id, wf.form, wf.form_norm
           FROM word_forms wf
           WHERE lower(wf.form) IN (${ph}) OR (wf.form_norm IS NOT NULL AND wf.form_norm IN (${ph}));`,
          [...wfCandidates, ...wfCandidates]
        );
        for (const r of formRows) {
          if (!candidateMap.has(r.entry_id)) {
            const exactForm = r.form.normalize('NFC').toLowerCase() === norm.exact;
            candidateMap.set(r.entry_id, {
              score: exactForm ? 89 : 85,
              matchedField: 'morphology',
              matchedTerm: r.form,
            });
          }
        }
      }

      // D. Prefix lookup (exact tonal prefix first, then ASCII-normalized prefix if no tone marks typed)
      if (norm.exact.length >= 2) {
        const upperBound = computePrefixUpperBound(norm.exact);
        if (upperBound) {
          const prefixRows = await exec.query<SqlEntryRow>(
            `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
             FROM entries e
             JOIN parts_of_speech p ON p.id = e.pos_id
             WHERE e.headword_lower >= ? AND e.headword_lower < ?
             LIMIT 40;`,
            [norm.exact, upperBound]
          );
          for (const r of prefixRows) {
            if (!candidateMap.has(r.id)) {
              candidateMap.set(r.id, { score: 82, matchedField: 'headword-prefix', matchedTerm: r.headword });
            }
          }
        }
      }

      if (!norm.hasToneMarks && !norm.hasUnderDots && norm.ascii.length >= 2) {
        const asciiUpper = computePrefixUpperBound(norm.ascii);
        if (asciiUpper) {
          const asciiPrefixRows = await exec.query<SqlEntryRow>(
            `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
             FROM entries e
             JOIN parts_of_speech p ON p.id = e.pos_id
             WHERE e.headword_norm >= ? AND e.headword_norm < ?
             LIMIT 40;`,
            [norm.ascii, asciiUpper]
          );
          for (const r of asciiPrefixRows) {
            if (!candidateMap.has(r.id)) {
              candidateMap.set(r.id, { score: 79, matchedField: 'headword-prefix', matchedTerm: r.headword });
            }
          }
        }
      }

      // E. English-to-Yoruba gloss lookup + FTS5 full-text search
      if (!norm.hasToneMarks && !norm.hasUnderDots && norm.exact.length >= 2) {
        try {
          const escaped = escapeSqlLike(norm.exact);
          const enRows = await exec.query<{ id: number; headword: string; definition_en: string }>(
            `SELECT id, headword, definition_en
             FROM entries
             WHERE definition_en IS NOT NULL
               AND (
                 lower(definition_en) = ?
                 OR lower(definition_en) LIKE ? ESCAPE '\\'
                 OR lower(definition_en) LIKE ? ESCAPE '\\'
                 OR lower(definition_en) LIKE ? ESCAPE '\\'
               )
             LIMIT 30;`,
            [norm.exact, `${escaped};%`, `%; ${escaped}%`, `to ${escaped}%`]
          );
          for (const r of enRows) {
            if (!candidateMap.has(r.id)) {
              const enExact = r.definition_en.toLowerCase().trim() === norm.exact;
              candidateMap.set(r.id, {
                score: enExact ? 77 : 73,
                matchedField: 'definition',
                matchedTerm: r.definition_en,
              });
            }
          }
        } catch {
          // Ignore LIKE failure
        }
      }

      const ftsQuery = buildFts5Query(rawTrimmed);
      if (ftsQuery) {
        try {
          const ftsRows = await exec.query<{ rowid: number; headword: string }>(
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
    }

    if (candidateMap.size === 0) {
      return {
        status: 'not_found',
        language: 'yo',
        query: rawTrimmed,
        results: [],
        totalCount: 0,
        hasMore: false,
        offset,
        limit,
        engineSource: 'sqlite-yo',
        message: strictDiacritics
          ? `No exact tonal/under-dot Yoruba entries found matching "${rawTrimmed}". Disable strict diacritics to search tone-insensitively.`
          : `No Yoruba entries found matching "${rawTrimmed}".`,
      };
    }

    const allCandidateIds = Array.from(candidateMap.keys());
    const hydratedResults = await this.hydrateEntries(allCandidateIds, candidateMap, options);

    const totalCount = hydratedResults.length;
    const pagedResults = hydratedResults.slice(offset, offset + limit);

    return {
      status: totalCount > 0 ? 'ok' : 'not_found',
      language: 'yo',
      query: rawTrimmed,
      results: pagedResults,
      totalCount,
      hasMore: offset + limit < totalCount,
      offset,
      limit,
      engineSource: 'sqlite-yo',
    };
  }

  private async browseEntries(
    options: YorubaSearchOptions,
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
      const letterLower = options.letter.trim().toLocaleLowerCase('yo');
      const upperBound = computePrefixUpperBound(letterLower);
      if (upperBound) {
        whereClauses.push('e.headword_norm >= ? AND e.headword_norm < ?');
        params.push(letterLower, upperBound);
      } else {
        whereClauses.push('e.headword_norm LIKE ?');
        params.push(`${letterLower}%`);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRows = await this.executor.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM entries e JOIN parts_of_speech p ON p.id = e.pos_id ${whereSql};`,
      params
    );
    const totalCount = Number(countRows[0]?.total || 0);

    const pageRows = await this.executor.query<{ id: number; headword: string }>(
      `SELECT e.id, e.headword
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       ${whereSql}
       ORDER BY e.headword_norm ASC, e.headword_lower ASC, e.id ASC
       LIMIT ? OFFSET ?;`,
      [...params, limit, offset]
    );

    const matchMeta = new Map<
      number,
      { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }
    >();
    for (const r of pageRows) {
      matchMeta.set(r.id, { score: 100, matchedField: 'headword-exact', matchedTerm: r.headword });
    }

    const hydrated = await this.hydrateEntries(
      pageRows.map((r) => r.id),
      matchMeta,
      options
    );

    return {
      status: hydrated.length > 0 ? 'ok' : 'not_found',
      language: 'yo',
      query: '',
      results: hydrated,
      totalCount,
      hasMore: offset + limit < totalCount,
      offset,
      limit,
      engineSource: 'sqlite-yo',
    };
  }

  private async hydrateEntries(
    entryIds: number[],
    candidateMap: Map<number, { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }>,
    options: YorubaSearchOptions
  ): Promise<StandardSearchResult[]> {
    if (entryIds.length === 0) return [];

    const placeholders = entryIds.map(() => '?').join(',');
    const entryRows = await this.executor.query<SqlEntryRow>(
      `SELECT e.id, e.headword, e.headword_lower, e.headword_norm, e.script_variant,
              p.name AS part_of_speech, e.primary_ipa, e.audio_file, e.dialect,
              e.definition_yo, e.definition_en, e.primary_definition,
              e.definition_type, e.verification_status, e.has_conflict,
              e.source_id, s.name AS source_name, s.license AS source_license,
              s.attribution_text AS source_attribution, s.source_url AS source_url
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       LEFT JOIN sources s ON s.id = e.source_id
       WHERE e.id IN (${placeholders});`,
      entryIds
    );

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

    const extSensesByEntry = new Map<number, WordSense[]>();
    const extDataByEntry = new Map<
      number,
      {
        allIpas?: PronunciationVariant[];
        etymology?: string;
        audioRefs?: VerifiedAudioRef[];
      }
    >();
    const extConflictsByEntry = new Map<
      number,
      { disagreementNature: string; versions: ConflictSourceVersion[] }
    >();

    if (this.extendedDbAttached) {
      try {
        const extRows = await this.executor.query<SqlExtSenseRow>(
          `SELECT s.id, s.entry_id, s.sense_number, s.part_of_speech,
                  s.definition_yo, s.definition_en, s.definition_type,
                  s.source_id, s.verification_status, s.examples, s.synonyms, s.antonyms
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
                const obj = ex as {
                  sourceText?: string;
                  targetText?: string;
                  targetTranslation?: string;
                  attribution?: string;
                };
                return {
                  sourceText: obj.sourceText || '',
                  targetText: obj.targetText || obj.targetTranslation || '',
                  culturalContext: obj.attribution || undefined,
                };
              }
              return null;
            })
            .filter((x): x is ExampleSentence => x !== null && x.sourceText.length > 0);

          const srcInfo = s.source_id ? this.cachedSources.get(s.source_id) : undefined;
          const displayDef = (s.definition_yo || s.definition_en || s.definition || '').trim();
          list.push({
            id: `yo-ext-sense-${s.id}`,
            entryId: `yo-sqlite-${s.entry_id}`,
            senseNumber: s.sense_number,
            partOfSpeech: s.part_of_speech || '',
            definition: displayDef,
            definitionYo: s.definition_yo ?? null,
            definitionEn: s.definition_en ?? null,
            definitionType: s.definition_type,
            sourceName: srcInfo?.name,
            sourceLicense: srcInfo?.license,
            sourceUrl: srcInfo?.source_url,
            verificationStatus: s.verification_status || undefined,
            examples: exList,
            synonyms: safeJsonParse<string[]>(s.synonyms, []),
            antonyms: safeJsonParse<string[]>(s.antonyms, []),
            relatedWords: [],
          });
          extSensesByEntry.set(s.entry_id, list);
        }

        const extMetaRows = await this.executor.query<SqlExtExtensionRow>(
          `SELECT ee.entry_id, ee.all_ipas, ee.etymology, ee.audio_refs
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
                const obj = item as { ipa: string; tags?: unknown[] };
                return {
                  ipa: obj.ipa,
                  tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
                };
              }
              return null;
            })
            .filter((x): x is PronunciationVariant => x !== null);
          const audioRefs = safeJsonParse<VerifiedAudioRef[]>(m.audio_refs, []);
          extDataByEntry.set(m.entry_id, {
            allIpas: ipas,
            etymology: m.etymology || undefined,
            audioRefs: audioRefs.length > 0 ? audioRefs : undefined,
          });
        }

        try {
          const confRows = await this.executor.query<SqlConflictReviewRow>(
            `SELECT cr.id, cr.entry_id, cr.headword, cr.part_of_speech,
                    cr.conflicting_sources_json, cr.disagreement_nature,
                    cr.review_decision, cr.reviewer_status, cr.review_notes
             FROM ext.conflict_reviews cr
             WHERE cr.entry_id IN (${placeholders});`,
            entryIds
          );
          for (const c of confRows) {
            extConflictsByEntry.set(c.entry_id, {
              disagreementNature: c.disagreement_nature,
              versions: safeJsonParse<ConflictSourceVersion[]>(c.conflicting_sources_json, []),
            });
          }
        } catch {
          // Optional table
        }
      } catch {
        // Fallback cleanly if Extended tables not attached
      }
    }

    const results: StandardSearchResult[] = [];
    const schemaVer = this.cachedMetadata?.schemaVersion || 4;

    for (const row of entryRows) {
      const match = candidateMap.get(row.id) || {
        score: 50,
        matchedField: 'headword-exact' as const,
        matchedTerm: row.headword,
      };

      if (options.partOfSpeech && options.partOfSpeech !== 'all') {
        if (row.part_of_speech.toLowerCase() !== options.partOfSpeech.trim().toLowerCase()) {
          continue;
        }
      }

      const forms = formsByEntry.get(row.id) || [];
      const extSenses = extSensesByEntry.get(row.id);
      const extMeta = extDataByEntry.get(row.id);
      const srcInfo = row.source_id ? this.cachedSources.get(row.source_id) : undefined;

      const resolvedDefYo = row.definition_yo ?? null;
      const resolvedDefEn = row.definition_en || '';
      const resolvedDefType: WordEntry['definitionType'] =
        row.definition_type ||
        (resolvedDefYo && resolvedDefEn
          ? 'bilingual_explanation'
          : resolvedDefYo
            ? 'yoruba_monolingual'
            : 'english_gloss');

      const wordId = `yo-sqlite-${row.id}`;
      const senses: WordSense[] =
        extSenses && extSenses.length > 0
          ? extSenses.map((s) => ({ ...s, partOfSpeech: s.partOfSpeech || row.part_of_speech }))
          : [
              {
                id: `yo-core-sense-${row.id}`,
                entryId: wordId,
                senseNumber: 1,
                partOfSpeech: row.part_of_speech,
                definition: row.primary_definition,
                definitionYo: resolvedDefYo,
                definitionEn: resolvedDefEn || null,
                definitionType: resolvedDefType,
                sourceName: row.source_name || srcInfo?.name,
                sourceLicense: row.source_license || srcInfo?.license,
                sourceUrl: row.source_url || srcInfo?.source_url,
                verificationStatus: row.verification_status,
                examples: [],
                synonyms: [],
                antonyms: [],
                relatedWords: [],
              },
            ];

      const mergedExamples = senses.flatMap((s) => s.examples);
      const mergedSynonyms = Array.from(new Set(senses.flatMap((s) => s.synonyms)));
      const mergedAntonyms = Array.from(new Set(senses.flatMap((s) => s.antonyms)));

      const allAudioRefs: VerifiedAudioRef[] =
        extMeta?.audioRefs && extMeta.audioRefs.length > 0
          ? extMeta.audioRefs
          : row.audio_file
            ? [{ file: row.audio_file, license: 'Wikimedia Commons (CC BY-SA)' }]
            : [];

      const hasConflict = Boolean(row.has_conflict);
      let conflictDetails = extConflictsByEntry.get(row.id) || null;
      if (hasConflict && !conflictDetails) {
        const distinctVersions: ConflictSourceVersion[] = [];
        const seenKeys = new Set<string>();
        for (const s of senses) {
          if (!s.definitionYo && !s.definitionEn) continue;
          const k = `${s.sourceName || 'core'}::${s.definitionYo || s.definitionEn}`;
          if (seenKeys.has(k)) continue;
          seenKeys.add(k);
          distinctVersions.push({
            sourceCode: s.sourceName || 'core',
            sourceName: s.sourceName || row.source_name || 'Yoruba Open Source',
            license: s.sourceLicense || row.source_license || 'CC BY-SA 4.0',
            definitionYo: s.definitionYo,
            definitionEn: s.definitionEn,
            definitionType: s.definitionType || resolvedDefType || 'bilingual_explanation',
            verificationStatus: s.verificationStatus || row.verification_status || 'conflict_flagged',
          });
        }
        conflictDetails = {
          disagreementNature: 'Cross-source Yoruba definitions preserved separately pending linguist review.',
          versions: distinctVersions,
        };
      }

      const sourceName = row.source_name || srcInfo?.name || YORUBA_PACK_MANIFEST.attribution.sourceName;
      const sourceLicense = row.source_license || srcInfo?.license || YORUBA_PACK_MANIFEST.attribution.license;
      const sourceUrl = row.source_url || srcInfo?.source_url || YORUBA_PACK_MANIFEST.attribution.sourceUrl;

      const entry: WordEntry = {
        id: wordId,
        sourceLang: 'yo',
        headword: row.headword,
        headwordScriptVariant: row.script_variant
          ? { label: 'Orthographic / Ajami variant', text: row.script_variant }
          : null,
        ipa: row.primary_ipa || '',
        allIpas: extMeta?.allIpas,
        audioRefs: allAudioRefs.length > 0 ? allAudioRefs : undefined,
        isMonolingualSqlite: true,
        isCoreOnly: !this.extendedDbAttached,
        extendedInstalled: this.extendedDbAttached,
        audioPhoneticText: row.headword,
        partOfSpeech: row.part_of_speech,
        dialect: row.dialect || 'Standard Yoruba',
        register: 'Standard vocabulary',
        etymology: extMeta?.etymology,
        definition: row.primary_definition,
        definitionYo: resolvedDefYo,
        definitionEn: resolvedDefEn || row.primary_definition,
        definitionType: resolvedDefType,
        senses,
        morphologicalForms: forms,
        translations: {},
        examples: mergedExamples,
        synonyms: mergedSynonyms,
        antonyms: mergedAntonyms,
        verifiedOffline: true,
        verificationStatus:
          row.verification_status === 'conflict_flagged'
            ? 'review_required'
            : row.verification_status === 'unverified_import'
              ? 'provisional'
              : 'verified',
        sourceVerificationStatus: row.verification_status || 'community_reviewed',
        hasConflict,
        conflictDetails,
        sourceAttribution: row.source_attribution || sourceName,
        sourceUrl,
        license: sourceLicense,
        licenseUrl: getLicenseUrl(sourceLicense),
        datasetVersion: this.cachedMetadata?.datasetVersion || YORUBA_PACK_MANIFEST.datasetVersion,
        tags: ['Yoruba Core Pack', 'Offline SQLite', `Schema v${schemaVer}`],
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

    const defQualityRank = (entry: WordEntry): number => {
      let rank = 0;
      if (entry.definitionType === 'bilingual_explanation') rank += 4;
      else if (entry.definitionType === 'yoruba_monolingual') rank += 3;
      else if (entry.definitionType === 'english_gloss') rank += 1;
      if (entry.ipa) rank += 1;
      return rank;
    };

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const qDiff = defQualityRank(b.entry) - defQualityRank(a.entry);
      if (qDiff !== 0) return qDiff;
      return a.entry.headword.localeCompare(b.entry.headword, 'yo');
    });

    return results;
  }

  public async runBenchmark(): Promise<YorubaBenchmarkReport> {
    await this.ensureConnection();

    const t0 = performance.now();
    await this.searchStandard('ọ̀rọ̀', { strictDiacritics: true, limit: 10 });
    const exactHeadwordMs = Number((performance.now() - t0).toFixed(2));

    const t1 = performance.now();
    await this.searchStandard('igb', { limit: 20 });
    const prefixQueryMs = Number((performance.now() - t1).toFixed(2));

    const t2 = performance.now();
    await this.searchStandard('water', { limit: 20 });
    const ftsDefinitionMs = Number((performance.now() - t2).toFixed(2));

    const t3 = performance.now();
    await this.searchStandard('oro', { limit: 20 });
    const normalizedQueryMs = Number((performance.now() - t3).toFixed(2));

    const countRows = await this.executor.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM entries;`);
    const totalEntriesVerified = Number(countRows[0]?.cnt || 0);

    return {
      timestamp: new Date().toISOString(),
      exactHeadwordMs,
      prefixQueryMs,
      ftsDefinitionMs,
      normalizedQueryMs,
      totalEntriesVerified,
      activeDbPath: this.executor.getDbPath() || yorubaPackService.getCachedStatus().dbPath,
    };
  }
}

export const yorubaSqliteRepo = new YorubaSqliteRepository();

yorubaPackService.setBeforeMutateDbHook(async () => {
  await yorubaSqliteRepo.closeConnection();
});
