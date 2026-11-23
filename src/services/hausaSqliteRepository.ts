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
import { HAUSA_PACK_MANIFEST, isHausaSqliteIntegrationEnabled } from '../config/hausaDictionaryConfig';
import { hausaPackService } from './hausaPackService';
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
  script_variant?: string | null;
  script_variant_norm?: string | null;
  part_of_speech: string;
  primary_ipa: string | null;
  audio_file?: string | null;
  dialect?: string | null;
  definition_ha?: string | null;
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
  definition_ha?: string | null;
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
const HOOKED_CONSONANT_REGEX = /[ɓɗƙƴƁƊƘƳ]/;
const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF]/;

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
  return 'https://creativecommons.org/licenses/by-sa/4.0/';
}

export class HausaSqliteRepository {
  private executor: SqlQueryExecutor = new CapacitorSqliteExecutor();
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

  public _injectExecutor(executor: SqlQueryExecutor | null): void {
    this.executor = executor || new CapacitorSqliteExecutor();
    this.extendedDbAttached = false;
    this.attachedExtPath = null;
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

  public isPackActive(): boolean {
    if (!isHausaSqliteIntegrationEnabled()) return false;
    return this.executor.isOpen() || hausaPackService.getCachedStatus().installed;
  }

  private getSchemaVersion(): number {
    return this.cachedMetadata?.schemaVersion || 3;
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
          `SELECT key, value FROM metadata WHERE key IN ('schema_version', 'pack_layer', 'dataset_version');`
        );
        const map = new Map(metaRows.map((r) => [r.key, r.value]));
        let schemaVer = Number(map.get('schema_version') || 3);
        // Probe for Schema v4 columns in case a v4 prototype database uses '4-proto'
        if (Number.isNaN(schemaVer) || schemaVer < 4) {
          const cols = await exec.query<{ name: string }>(`PRAGMA table_info(entries);`);
          if (cols.some((c) => c.name === 'definition_ha')) {
            schemaVer = 4;
          } else if (Number.isNaN(schemaVer)) {
            schemaVer = 3;
          }
        }
        this.cachedMetadata = {
          schemaVersion: schemaVer,
          packLayer: map.get('pack_layer') || 'core',
          datasetVersion: map.get('dataset_version') || HAUSA_PACK_MANIFEST.datasetVersion,
          extendedAttached: this.extendedDbAttached,
        };
      } catch {
        this.cachedMetadata = {
          schemaVersion: 3,
          packLayer: 'core',
          datasetVersion: HAUSA_PACK_MANIFEST.datasetVersion,
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

  public async getAvailableLetters(): Promise<string[]> {
    await this.ensureConnection();
    const rows = await this.executor.query<{ letter: string }>(
      `SELECT DISTINCT substr(headword_lower, 1, 1) AS letter
       FROM entries
       WHERE length(headword_lower) > 0
       ORDER BY letter ASC;`
    );
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.letter) continue;
      const upper = r.letter.toLocaleUpperCase('ha');
      if (/^[A-ZƁƊƘƳ]$/.test(upper)) {
        set.add(upper);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ha'));
  }

  public async getEntriesByIds(entryIds: string[]): Promise<WordEntry[]> {
    const numericIds = entryIds
      .filter((id) => id.startsWith('ha-') && !id.startsWith('ha-ext-'))
      .map((id) => Number(id.replace('ha-', '')))
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
    if (this.getSchemaVersion() < 4) {
      return { totalCount: 0, items: [] };
    }

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
          const entryId = `ha-${r.entry_id}`;
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
      definition_ha: string | null;
      definition_en: string | null;
      definition_type: string;
      verification_status: string;
      source_code: string;
      source_name: string;
      source_license: string;
    }>(
      `SELECT e.id, e.headword, p.name AS pos_name, e.definition_ha, e.definition_en,
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
      const entryId = `ha-${r.id}`;
      const saved = hausaConflictReviewService.getReviewForEntry({
        id: entryId,
        headword: r.headword,
        partOfSpeech: r.pos_name,
        hasConflict: true,
        conflictDetails: {
          disagreementNature:
            'Cross-source Hausa explanations flagged in Core database (attach Extended pack to view all competing definitions side-by-side).',
          versions: [
            {
              sourceCode: r.source_code,
              sourceName: r.source_name,
              license: r.source_license,
              definitionHa: r.definition_ha,
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
    options: HausaSearchOptions = {}
  ): Promise<StandardSearchResponse> {
    const rawTrimmed = (query || '').trim();
    const queryLower = rawTrimmed.toLowerCase();
    const hasHooked = HOOKED_CONSONANT_REGEX.test(rawTrimmed);
    const hasArabic = ARABIC_SCRIPT_REGEX.test(rawTrimmed);
    const { soft: qSoft, deep: qDeep } = TextNormalization.normalizeLatin(rawTrimmed);
    const qArabicNorm = hasArabic ? TextNormalization.normalizeArabic(rawTrimmed) : '';
    const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const offset = Math.max(0, options.offset || 0);

    await this.ensureConnection();
    const exec = this.getExecutor();
    const schemaVer = this.getSchemaVersion();

    // 1. Browse / Filter Mode (empty query)
    if (!rawTrimmed) {
      return this.browseEntries(options, limit, offset);
    }

    const candidateMap = new Map<
      number,
      { score: number; matchedField: StandardSearchResult['matchedField']; matchedTerm: string }
    >();

    // A. Exact headword lookup (distinguishes b/ɓ, d/ɗ, k/ƙ, y/ƴ)
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

    // Soft-normalized match (tone marks & apostrophes stripped, preserving hooked letters ɓ, ɗ, ƙ, ƴ)
    if (qSoft && qSoft !== queryLower) {
      const softRows = await exec.query<SqlEntryRow>(
        `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
         FROM entries e
         JOIN parts_of_speech p ON p.id = e.pos_id
         WHERE e.headword_lower = ?;`,
        [qSoft]
      );
      for (const r of softRows) {
        if (!candidateMap.has(r.id)) {
          candidateMap.set(r.id, { score: 97, matchedField: 'headword-normalized', matchedTerm: r.headword });
        }
      }
    }

    // B. Ajami Script Variant lookup (exact + Arabic diacritic-normalized)
    if (hasArabic && schemaVer >= 4) {
      const ajamiRows = await exec.query<SqlEntryRow>(
        `SELECT e.id, e.headword, e.script_variant, p.name AS part_of_speech
         FROM entries e
         JOIN parts_of_speech p ON p.id = e.pos_id
         WHERE e.script_variant = ? OR e.script_variant_norm = ?;`,
        [rawTrimmed, qArabicNorm || rawTrimmed]
      );
      for (const r of ajamiRows) {
        if (!candidateMap.has(r.id)) {
          candidateMap.set(r.id, {
            score: 96,
            matchedField: 'script-variant',
            matchedTerm: r.script_variant || r.headword,
          });
        }
      }
    }

    // C. ASCII Fallback for hooked letters ONLY when the user did NOT type hooked consonants.
    //    Ensures searching "kofa" finds "ƙofa", while searching "ƙasa" NEVER returns unrelated "kasa".
    if (!hasHooked && !hasArabic && qDeep) {
      const deepRows = await exec.query<SqlEntryRow>(
        `SELECT e.id, e.headword, e.headword_lower, p.name AS part_of_speech
         FROM entries e
         JOIN parts_of_speech p ON p.id = e.pos_id
         WHERE e.headword_norm = ?;`,
        [qDeep]
      );
      for (const r of deepRows) {
        if (!candidateMap.has(r.id)) {
          candidateMap.set(r.id, { score: 92, matchedField: 'headword-normalized', matchedTerm: r.headword });
        }
      }
    }

    // D. Inflected Word Forms & Variant Forms lookup (respecting hooked distinction)
    if (hasArabic) {
      const arabForms = Array.from(new Set([rawTrimmed, qArabicNorm].filter(Boolean)));
      const ph = arabForms.map(() => '?').join(',');
      const formRows = await exec.query<SqlWordFormRow>(
        `SELECT wf.entry_id, wf.form, wf.form_norm
         FROM word_forms wf
         WHERE wf.form IN (${ph}) OR (wf.form_norm IS NOT NULL AND wf.form_norm IN (${ph}));`,
        [...arabForms, ...arabForms]
      );
      for (const r of formRows) {
        if (!candidateMap.has(r.entry_id)) {
          candidateMap.set(r.entry_id, { score: 88, matchedField: 'script-variant', matchedTerm: r.form });
        }
      }
    } else if (hasHooked) {
      const hookedForms = Array.from(new Set([queryLower, qSoft].filter(Boolean)));
      const ph = hookedForms.map(() => '?').join(',');
      const formRows = await exec.query<SqlWordFormRow>(
        `SELECT wf.entry_id, wf.form, wf.form_norm
         FROM word_forms wf
         WHERE lower(wf.form) IN (${ph});`,
        hookedForms
      );
      for (const r of formRows) {
        if (!candidateMap.has(r.entry_id)) {
          candidateMap.set(r.entry_id, { score: 86, matchedField: 'morphology', matchedTerm: r.form });
        }
      }
    } else {
      const plainForms = Array.from(new Set([queryLower, qSoft, qDeep].filter(Boolean)));
      const ph = plainForms.map(() => '?').join(',');
      const formRows = await exec.query<SqlWordFormRow>(
        `SELECT wf.entry_id, wf.form, wf.form_norm
         FROM word_forms wf
         WHERE lower(wf.form) IN (${ph}) OR (wf.form_norm IS NOT NULL AND wf.form_norm IN (${ph}));`,
        [...plainForms, ...plainForms]
      );
      for (const r of formRows) {
        if (!candidateMap.has(r.entry_id)) {
          candidateMap.set(r.entry_id, { score: 85, matchedField: 'morphology', matchedTerm: r.form });
        }
      }
    }

    // E. Prefix lookup (when query length >= 2; hooked-aware via headword_lower)
    if (!hasArabic && queryLower.length >= 2) {
      const upperBound = computePrefixUpperBound(queryLower);
      if (upperBound) {
        const prefixRows = await exec.query<SqlEntryRow>(
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

    // F. English-to-Hausa gloss lookup (Schema v4) + FTS5 full-text definition search
    if (schemaVer >= 4 && !hasHooked && !hasArabic && queryLower.length >= 2) {
      try {
        const escaped = escapeSqlLike(queryLower);
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
           LIMIT 25;`,
          [queryLower, `${escaped};%`, `%; ${escaped}%`, `to ${escaped}%`]
        );
        for (const r of enRows) {
          if (!candidateMap.has(r.id)) {
            const enExact = r.definition_en.toLowerCase().trim() === queryLower;
            candidateMap.set(r.id, {
              score: enExact ? 78 : 74,
              matchedField: 'definition',
              matchedTerm: r.definition_en,
            });
          }
        }
      } catch {
        // Ignore if query fails
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

    const allCandidateIds = Array.from(candidateMap.keys());
    const hydratedResults = await this.hydrateEntries(allCandidateIds, candidateMap, options);

    const totalCount = hydratedResults.length;
    const pagedResults = hydratedResults.slice(offset, offset + limit);

    return {
      status: totalCount > 0 ? 'ok' : 'not_found',
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
    const totalCount = Number(countRows[0]?.total || 0);

    const pageRows = await this.executor.query<{ id: number; headword: string }>(
      `SELECT e.id, e.headword
       FROM entries e
       JOIN parts_of_speech p ON p.id = e.pos_id
       ${whereSql}
       ORDER BY e.headword_lower ASC, e.id ASC
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

    const schemaVer = this.getSchemaVersion();
    const placeholders = entryIds.map(() => '?').join(',');

    const entrySelectSql =
      schemaVer >= 4
        ? `SELECT e.id, e.headword, e.headword_lower, e.headword_norm, e.script_variant,
                  p.name AS part_of_speech, e.primary_ipa, e.audio_file, e.dialect,
                  e.definition_ha, e.definition_en, e.primary_definition,
                  e.definition_type, e.verification_status, e.has_conflict,
                  e.source_id, s.name AS source_name, s.license AS source_license,
                  s.attribution_text AS source_attribution, s.source_url AS source_url
           FROM entries e
           JOIN parts_of_speech p ON p.id = e.pos_id
           LEFT JOIN sources s ON s.id = e.source_id
           WHERE e.id IN (${placeholders});`
        : `SELECT e.id, e.headword, e.headword_lower, e.primary_ipa, e.primary_definition,
                  p.name AS part_of_speech, e.source_id,
                  s.name AS source_name, s.license AS source_license,
                  s.attribution_text AS source_attribution, s.source_url AS source_url
           FROM entries e
           JOIN parts_of_speech p ON p.id = e.pos_id
           LEFT JOIN sources s ON s.id = e.source_id
           WHERE e.id IN (${placeholders});`;

    const entryRows = await this.executor.query<SqlEntryRow>(entrySelectSql, entryIds);

    const formsRows = await this.executor.query<SqlWordFormRow>(
      `SELECT wf.entry_id, wf.form, wf.form_norm
       FROM word_forms wf
       WHERE wf.entry_id IN (${placeholders});`,
      entryIds
    );
    const formsByEntry = new Map<number, MorphologicalForm[]>();
    for (const f of formsRows) {
      const list = formsByEntry.get(f.entry_id) || [];
      const isAjami = ARABIC_SCRIPT_REGEX.test(f.form);
      list.push({ form: f.form, label: isAjami ? 'Ajami' : 'variant' });
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
        const extSenseSql =
          schemaVer >= 4
            ? `SELECT s.id, s.entry_id, s.sense_number, s.part_of_speech,
                      s.definition_ha, s.definition_en, s.definition_type,
                      s.source_id, s.verification_status, s.examples, s.synonyms, s.antonyms
               FROM ext.senses_ext s
               WHERE s.entry_id IN (${placeholders})
               ORDER BY s.sense_number ASC;`
            : `SELECT s.id, s.entry_id, s.sense_number, s.definition, s.examples, s.synonyms, s.antonyms
               FROM ext.senses_ext s
               WHERE s.entry_id IN (${placeholders})
               ORDER BY s.sense_number ASC;`;

        const extRows = await this.executor.query<SqlExtSenseRow>(extSenseSql, entryIds);
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
          const displayDef = (s.definition_ha || s.definition_en || s.definition || '').trim();
          list.push({
            id: `ha-ext-sense-${s.id}`,
            entryId: `ha-${s.entry_id}`,
            senseNumber: s.sense_number,
            partOfSpeech: s.part_of_speech || '',
            definition: displayDef,
            definitionHa: s.definition_ha ?? null,
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

        const extMetaSql =
          schemaVer >= 4
            ? `SELECT ee.entry_id, ee.all_ipas, ee.etymology, ee.audio_refs
               FROM ext.entry_extensions ee
               WHERE ee.entry_id IN (${placeholders});`
            : `SELECT ee.entry_id, ee.all_ipas, ee.etymology
               FROM ext.entry_extensions ee
               WHERE ee.entry_id IN (${placeholders});`;

        const extMetaRows = await this.executor.query<SqlExtExtensionRow>(extMetaSql, entryIds);
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

        if (schemaVer >= 4) {
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
            // Optional table on legacy Extended DBs
          }
        }
      } catch {
        // Fallback cleanly if Extended tables not available
      }
    }

    const results: StandardSearchResult[] = [];

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

      const resolvedDefHa = schemaVer >= 4 ? row.definition_ha ?? null : null;
      const resolvedDefEn = schemaVer >= 4 ? row.definition_en || '' : row.primary_definition;
      const resolvedDefType: WordEntry['definitionType'] =
        schemaVer >= 4
          ? row.definition_type ||
            (resolvedDefHa && resolvedDefEn
              ? 'bilingual_explanation'
              : resolvedDefHa
                ? 'hausa_monolingual'
                : 'english_gloss')
          : 'english_gloss';

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
                definitionHa: resolvedDefHa,
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
          if (!s.definitionHa && !s.definitionEn) continue;
          const k = `${s.sourceName || 'core'}::${s.definitionHa || s.definitionEn}`;
          if (seenKeys.has(k)) continue;
          seenKeys.add(k);
          distinctVersions.push({
            sourceCode: s.sourceName || 'core',
            sourceName: s.sourceName || row.source_name || 'Hausa Open Source',
            license: s.sourceLicense || row.source_license || 'CC BY-SA 4.0',
            definitionHa: s.definitionHa,
            definitionEn: s.definitionEn,
            definitionType: s.definitionType || resolvedDefType || 'hausa_monolingual',
            verificationStatus: s.verificationStatus || row.verification_status || 'conflict_flagged',
          });
        }
        conflictDetails = {
          disagreementNature: 'Cross-source Hausa explanations preserved separately pending native linguist review.',
          versions: distinctVersions,
        };
      }

      const sourceName = row.source_name || srcInfo?.name || HAUSA_PACK_MANIFEST.attribution.sourceName;
      const sourceLicense = row.source_license || srcInfo?.license || HAUSA_PACK_MANIFEST.attribution.license;
      const sourceUrl = row.source_url || srcInfo?.source_url || HAUSA_PACK_MANIFEST.attribution.sourceUrl;

      const isCoreOnly = !this.extendedDbAttached;
      const entry: WordEntry = {
        id: `ha-${row.id}`,
        sourceLang: 'ha',
        headword: row.headword,
        headwordScriptVariant: row.script_variant
          ? { label: 'Ajami (Arabic script)', text: row.script_variant }
          : null,
        ipa: row.primary_ipa || '',
        allIpas: extMeta?.allIpas,
        audioRefs: allAudioRefs.length > 0 ? allAudioRefs : undefined,
        isMonolingualSqlite: true,
        isCoreOnly,
        extendedInstalled: this.extendedDbAttached,
        audioPhoneticText: row.headword,
        partOfSpeech: row.part_of_speech,
        genderOrClass: undefined,
        dialect: row.dialect || 'Standard Hausa',
        register: 'Standard vocabulary',
        rootWord: null,
        etymology: extMeta?.etymology,
        definition: row.primary_definition,
        definitionHa: resolvedDefHa,
        definitionEn: resolvedDefEn,
        definitionType: resolvedDefType,
        culturalNote: undefined,
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
        sourceAttribution: row.source_attribution || `${sourceName}`,
        sourceUrl,
        license: sourceLicense,
        licenseUrl: getLicenseUrl(sourceLicense),
        datasetVersion: this.cachedMetadata?.datasetVersion || HAUSA_PACK_MANIFEST.datasetVersion,
        tags: ['Hausa Core Pack', 'Offline SQLite', `Schema v${schemaVer}`],
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
      else if (entry.definitionType === 'hausa_monolingual') rank += 3;
      else if (entry.definitionType === 'english_gloss') rank += 1;
      if (entry.sourceVerificationStatus === 'human_verified') rank += 2;
      else if (entry.sourceVerificationStatus === 'community_reviewed') rank += 1;
      return rank;
    };

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const rankDiff = defQualityRank(b.entry) - defQualityRank(a.entry);
      if (rankDiff !== 0) return rankDiff;
      return a.entry.headword.localeCompare(b.entry.headword, 'ha');
    });

    return results;
  }

  public async runBenchmark(): Promise<HausaBenchmarkReport> {
    await this.ensureConnection();

    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT e.id FROM entries e WHERE e.headword_lower = 'ruwa';`);
    }
    const exactHeadwordMs = (performance.now() - t0) / 50;

    const t1 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT e.id FROM entries e WHERE e.headword_lower >= 'bar' AND e.headword_lower < 'bas' LIMIT 20;`);
    }
    const prefixQueryMs = (performance.now() - t1) / 50;

    const t2 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'water' LIMIT 20;`);
    }
    const ftsDefinitionMs = (performance.now() - t2) / 50;

    const t3 = performance.now();
    for (let i = 0; i < 50; i++) {
      await this.executor.query(`SELECT e.id FROM entries e WHERE e.headword_norm = 'kofa' OR e.headword_lower = 'kofa';`);
    }
    const normalizedQueryMs = (performance.now() - t3) / 50;

    const countRows = await this.executor.query<{ total: number }>(`SELECT COUNT(*) AS total FROM entries;`);
    const totalEntries = Number(countRows[0]?.total || 0);

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

hausaPackService.setBeforeMutateDbHook(async () => {
  await hausaSqliteRepo.closeConnection();
});
