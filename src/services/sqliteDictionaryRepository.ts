import {
  WordEntry,
  LanguageCode,
  WordSense,
  MorphologicalForm,
  TranslationRelationship,
  ExampleSentence,
  StandardSearchResponse,
  MultilingualSearchResponse,
  EquivalenceType,
} from '../types/dictionary';
import { TextNormalization } from './textNormalization';
import { sqliteManager, SqliteConnection, SqliteRow } from './sqliteAdapter';
import { packManager } from './packManager';
import {
  StandardDictionarySearch,
  StandardSearchOptions,
} from './standardDictionarySearch';
import {
  MultilingualDictionarySearch,
  MultilingualSearchOptions,
} from './multilingualDictionarySearch';
import { CURRENT_CORE_SCHEMA_AND_DATA_VERSION } from './sqliteAdapter';

const ALL_LANGUAGES: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];
const DEFAULT_CANDIDATE_LIMIT = 60;

export interface LanguagePackStats {
  code: LanguageCode;
  loadedEntriesCount: number;
  sensesCount: number;
  translationRelationshipsCount: number;
  verifiedDirectedPairsCount: number;
  actualSizeBytes: number;
  actualSizeMb: number;
  compressedSizeBytes: number;
  tier: 'core_starter' | 'full_pack';
  isInstalled: boolean;
  isAvailableOffline: boolean;
  datasetVersion: string;
  availableUpdateVersion?: string | null;
  sampleHeadwords: string[];
}

function escapeFtsTerm(raw: string): string {
  // Extract alphanumeric/Unicode word tokens cleanly so FTS5 MATCH never syntax-errors
  const cleaned = raw
    .replace(/["*^():{}\[\]\\/+\-!~@#$%&=?<>|;,.،؟]/g, ' ')
    .trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(/\s+/).filter(Boolean).slice(0, 4);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' ');
}

function normalizeQueryForms(query: string, lang: LanguageCode): {
  raw: string;
  soft: string;
  deep: string;
  vowelFold: string;
  arabic: string;
  pinyin: string;
} {
  const raw = query.trim();
  const latin = TextNormalization.normalizeLatin(raw);
  const arabic = TextNormalization.normalizeArabic(raw);
  const pinyin = lang === 'zh' ? TextNormalization.normalizePinyin(raw) : '';
  return {
    raw,
    soft: lang === 'ar' ? arabic : latin.soft,
    deep: lang === 'ar' ? arabic : latin.deep,
    vowelFold: lang === 'ar' ? arabic : latin.vowelFold,
    arabic,
    pinyin,
  };
}

export class SqliteDictionaryRepository {
  private overlayEntries: Map<string, WordEntry> = new Map();
  private removedIds: Set<string> = new Set();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  public async initialize(): Promise<void> {
    if (this.initialized && sqliteManager.hasActiveConnections()) return;
    if (!sqliteManager.hasActiveConnections()) {
      this.initialized = false;
      this.initPromise = null;
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await sqliteManager.ensureInitialized();
        await packManager.initializeAndRecover();
        this.initialized = true;
      })().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    await this.initPromise;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public async isLanguageActive(lang: LanguageCode): Promise<boolean> {
    await this.initialize();
    const states = await packManager.getPackStates();
    const st = states[lang];
    return Boolean(st && (st.installState === 'installed' || st.installState === 'core_only'));
  }

  private getConnectionForLanguage(lang: LanguageCode): SqliteConnection {
    return sqliteManager.getPackConnection(lang) || sqliteManager.getCoreConnection();
  }

  public upsertOverlayEntry(entry: WordEntry): void {
    this.removedIds.delete(entry.id);
    this.overlayEntries.set(entry.id, entry);
  }

  public removeOverlayEntry(entryId: string): void {
    this.overlayEntries.delete(entryId);
    this.removedIds.add(entryId);
  }

  public async getLanguagePackStats(): Promise<Record<LanguageCode, LanguagePackStats>> {
    await this.initialize();
    const packStates = await packManager.getPackStates();
    const core = sqliteManager.getCoreConnection();
    const result: Partial<Record<LanguageCode, LanguagePackStats>> = {};

    for (const code of ALL_LANGUAGES) {
      const state = packStates[code];
      const isActive =
        state?.installState === 'installed' || state?.installState === 'core_only';
      const conn = this.getConnectionForLanguage(code);

      let loadedEntriesCount = 0;
      let sensesCount = 0;
      let relCount = 0;
      let verifiedPairs = 0;
      let sampleHeadwords: string[] = [];

      if (isActive) {
        const counts = await conn.query<{
          entries_cnt: number;
          senses_cnt: number;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM entries WHERE source_lang = ?) AS entries_cnt,
             (SELECT COUNT(*) FROM senses s JOIN entries e ON e.id = s.entry_id WHERE e.source_lang = ?) AS senses_cnt;`,
          [code, code]
        );
        loadedEntriesCount = Number(counts[0]?.entries_cnt ?? state?.entryCount ?? 0);
        sensesCount = Number(counts[0]?.senses_cnt ?? state?.senseCount ?? 0);

        const activeLangs = ALL_LANGUAGES.filter((l) => {
          const st = packStates[l];
          return st && (st.installState === 'installed' || st.installState === 'core_only');
        });
        if (activeLangs.length > 0) {
          const placeholders = activeLangs.map(() => '?').join(', ');
          const relRow = await conn.query<{ rel_cnt: number; pair_cnt: number }>(
            `SELECT COUNT(*) AS rel_cnt, COUNT(DISTINCT target_lang) AS pair_cnt
             FROM translation_links
             WHERE source_lang = ? AND target_lang IN (${placeholders});`,
            [code, ...activeLangs]
          );
          relCount = Number(relRow[0]?.rel_cnt ?? 0);
          verifiedPairs = Number(relRow[0]?.pair_cnt ?? 0);
        }

        const sampleRows = await conn.query<{ headword: string }>(
          `SELECT headword FROM entries WHERE source_lang = ? LIMIT 3;`,
          [code]
        );
        sampleHeadwords = sampleRows.map((r) => String(r.headword));
      }

      // Compute proportional or actual SQLite byte size cleanly without guessing
      let actualSizeBytes = state?.sizeBytes || 0;
      if (isActive && actualSizeBytes <= 0 && conn === core) {
        // Estimate core slice size if core state didn't record byte size
        const totalCoreEntriesRows = await core.query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM entries;`);
        const totalCoreEntries = Math.max(1, Number(totalCoreEntriesRows[0]?.cnt ?? 1));
        const pageRows = await core.query<{ page_count: number }>(`PRAGMA page_count;`);
        const pageSizeRows = await core.query<{ page_size: number }>(`PRAGMA page_size;`);
        const totalDbBytes =
          Number(pageRows[0]?.page_count ?? 0) * Number(pageSizeRows[0]?.page_size ?? 4096);
        actualSizeBytes = Math.round((totalDbBytes * loadedEntriesCount) / totalCoreEntries);
      }

      const actualSizeMb = Number((actualSizeBytes / (1024 * 1024)).toFixed(2));
      result[code] = {
        code,
        loadedEntriesCount,
        sensesCount,
        translationRelationshipsCount: relCount,
        verifiedDirectedPairsCount: verifiedPairs,
        actualSizeBytes: isActive ? actualSizeBytes : 0,
        actualSizeMb: isActive ? actualSizeMb : 0,
        compressedSizeBytes: state?.compressedSizeBytes || 0,
        tier: state?.tier || 'core_starter',
        isInstalled: isActive,
        isAvailableOffline: isActive && loadedEntriesCount > 0,
        datasetVersion: state?.version || CURRENT_CORE_SCHEMA_AND_DATA_VERSION,
        availableUpdateVersion: state?.availableUpdateVersion || null,
        sampleHeadwords,
      };
    }

    return result as Record<LanguageCode, LanguagePackStats>;
  }

  public async getTotalTranslationRelationshipsCount(): Promise<number> {
    await this.initialize();
    const packStates = await packManager.getPackStates();
    const activeLangs = ALL_LANGUAGES.filter((l) => {
      const st = packStates[l];
      return st && (st.installState === 'installed' || st.installState === 'core_only');
    });
    if (activeLangs.length === 0) return 0;

    const placeholders = activeLangs.map(() => '?').join(', ');
    let total = 0;
    for (const lang of activeLangs) {
      const conn = this.getConnectionForLanguage(lang);
      const rows = await conn.query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM translation_links WHERE source_lang = ? AND target_lang IN (${placeholders});`,
        [lang, ...activeLangs]
      );
      total += Number(rows[0]?.cnt ?? 0);
    }
    return total;
  }

  public async getAvailableLetters(lang: LanguageCode): Promise<string[]> {
    await this.initialize();
    if (!(await this.isLanguageActive(lang))) return [];
    const conn = this.getConnectionForLanguage(lang);
    const rows = await conn.query<{ headword: string }>(
      `SELECT headword FROM entries WHERE source_lang = ? ORDER BY headword LIMIT 500;`,
      [lang]
    );
    const letters = new Set<string>();
    for (const row of rows) {
      const cleanH = String(row.headword).replace(/^['"‘“\s]+/, '');
      if (cleanH.length > 0) {
        const first = cleanH
          .charAt(0)
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        if (first && first.trim()) letters.add(first);
      }
    }
    return Array.from(letters).sort((a, b) => a.localeCompare(b));
  }

  public async getSampleEntries(options: {
    lang?: LanguageCode;
    limit?: number;
  } = {}): Promise<WordEntry[]> {
    await this.initialize();
    const limit = options.limit ?? 30;
    if (options.lang) {
      if (!(await this.isLanguageActive(options.lang))) return [];
      const conn = this.getConnectionForLanguage(options.lang);
      const idRows = await conn.query<{ id: string }>(
        `SELECT id FROM entries WHERE source_lang = ? LIMIT ?;`,
        [options.lang, limit]
      );
      const hydrated = await this.hydrateEntriesByIds(
        conn,
        idRows.map((r) => String(r.id))
      );
      return Array.from(hydrated.entriesById.values());
    }

    const perLangLimit = Math.max(4, Math.ceil(limit / ALL_LANGUAGES.length));
    const collected: WordEntry[] = [];
    for (const code of ALL_LANGUAGES) {
      if (!(await this.isLanguageActive(code))) continue;
      const conn = this.getConnectionForLanguage(code);
      const idRows = await conn.query<{ id: string }>(
        `SELECT id FROM entries WHERE source_lang = ? LIMIT ?;`,
        [code, perLangLimit]
      );
      const hydrated = await this.hydrateEntriesByIds(
        conn,
        idRows.map((r) => String(r.id))
      );
      collected.push(...hydrated.entriesById.values());
    }
    return collected.slice(0, limit);
  }

  public async getEntriesByIds(ids: string[]): Promise<WordEntry[]> {
    await this.initialize();
    if (ids.length === 0) return [];
    const result: WordEntry[] = [];
    const seen = new Set<string>();

    for (const id of ids) {
      if (this.overlayEntries.has(id)) {
        result.push(this.overlayEntries.get(id)!);
        seen.add(id);
      }
    }

    const remainingIds = ids.filter((id) => !seen.has(id) && !this.removedIds.has(id));
    if (remainingIds.length === 0) return result;

    // Query active connections (core + any open packs)
    const connections = new Set<SqliteConnection>([sqliteManager.getCoreConnection()]);
    for (const code of ALL_LANGUAGES) {
      const packConn = sqliteManager.getPackConnection(code);
      if (packConn) connections.add(packConn);
    }

    for (const conn of connections) {
      const stillMissing = remainingIds.filter((id) => !seen.has(id));
      if (stillMissing.length === 0) break;
      const hydrated = await this.hydrateEntriesByIds(conn, stillMissing);
      for (const entry of hydrated.entriesById.values()) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id);
          result.push(entry);
        }
      }
    }

    return result;
  }

  public async getEntryById(id: string): Promise<WordEntry | null> {
    if (!id) return null;
    const found = await this.getEntriesByIds([id]);
    return found[0] || null;
  }

  public async getEntryDetails(id: string): Promise<{
    entry: WordEntry | null;
    senses: WordSense[];
    morphologicalForms: MorphologicalForm[];
    translationLinks: TranslationRelationship[];
  }> {
    await this.initialize();
    if (!id || this.removedIds.has(id)) {
      return { entry: null, senses: [], morphologicalForms: [], translationLinks: [] };
    }
    if (this.overlayEntries.has(id)) {
      const ctx = {
        entriesById: new Map<string, WordEntry>(),
        sensesById: new Map<string, WordSense>(),
        sensesByEntryId: new Map<string, WordSense[]>(),
        morphologyByEntryId: new Map<string, MorphologicalForm[]>(),
        translationLinksByEntryId: new Map<string, TranslationRelationship[]>(),
      };
      this.mergeOverlayIntoContext(ctx, ALL_LANGUAGES);
      return {
        entry: ctx.entriesById.get(id) || null,
        senses: ctx.sensesByEntryId.get(id) || [],
        morphologicalForms: ctx.morphologyByEntryId.get(id) || [],
        translationLinks: ctx.translationLinksByEntryId.get(id) || [],
      };
    }

    const connections = new Set<SqliteConnection>([sqliteManager.getCoreConnection()]);
    for (const code of ALL_LANGUAGES) {
      const packConn = sqliteManager.getPackConnection(code);
      if (packConn) connections.add(packConn);
    }

    for (const conn of connections) {
      const hydrated = await this.hydrateEntriesByIds(conn, [id]);
      const entry = hydrated.entriesById.get(id);
      if (entry) {
        return {
          entry,
          senses: hydrated.sensesByEntryId.get(id) || [],
          morphologicalForms: hydrated.morphologyByEntryId.get(id) || [],
          translationLinks: hydrated.translationLinksByEntryId.get(id) || [],
        };
      }
    }

    return { entry: null, senses: [], morphologicalForms: [], translationLinks: [] };
  }

  public async findCrossLanguageHint(
    query: string,
    excludeLang: LanguageCode
  ): Promise<{ entry: WordEntry; lang: LanguageCode } | null> {
    await this.initialize();
    const cleanQ = query.trim();
    if (!cleanQ) return null;
    const norm = normalizeQueryForms(cleanQ, 'en');

    for (const code of ALL_LANGUAGES) {
      if (code === excludeLang) continue;
      if (!(await this.isLanguageActive(code))) continue;
      const conn = this.getConnectionForLanguage(code);
      const qNorm = normalizeQueryForms(cleanQ, code);
      const rows = await conn.query<{ id: string }>(
        `SELECT id FROM entries
         WHERE source_lang = ?
           AND (
             headword = ? COLLATE NOCASE
             OR headword_norm_soft = ?
             OR headword_norm_deep = ?
             OR headword_norm_soft LIKE ?
           )
         LIMIT 1;`,
        [code, cleanQ, qNorm.soft, qNorm.deep, `${norm.soft}%`]
      );
      if (rows[0]?.id) {
        const hydrated = await this.hydrateEntriesByIds(conn, [String(rows[0].id)]);
        const entry = hydrated.entriesById.get(String(rows[0].id));
        if (entry) return { entry, lang: code };
      }
    }
    return null;
  }

  /**
   * Fetch up to `limit` matching candidate entry IDs in `lang` using SQLite B-tree indexes + FTS5
   */
  private async queryStandardCandidateIds(
    conn: SqliteConnection,
    query: string,
    lang: LanguageCode,
    options: StandardSearchOptions = {},
    limit: number = DEFAULT_CANDIDATE_LIMIT
  ): Promise<string[]> {
    const raw = query.trim();
    const posFilter = options.partOfSpeech && options.partOfSpeech !== 'all'
      ? `%${options.partOfSpeech.toLowerCase()}%`
      : null;

    // Browse mode when query is empty
    if (!raw) {
      const letter = options.letter && options.letter !== 'all' ? options.letter : null;
      const conditions: string[] = ['e.source_lang = ?'];
      const params: Array<string | number | null> = [lang];

      if (posFilter) {
        conditions.push(
          `(LOWER(e.part_of_speech) LIKE ? OR EXISTS (SELECT 1 FROM senses s WHERE s.entry_id = e.id AND LOWER(s.part_of_speech) LIKE ?))`
        );
        params.push(posFilter, posFilter);
      }

      if (letter) {
        const lowerL = letter.toLowerCase();
        conditions.push(`(e.headword_norm_deep LIKE ? OR UPPER(SUBSTR(e.headword, 1, 1)) = ?)`);
        params.push(`${lowerL}%`, letter.toUpperCase());
      }

      params.push(limit);
      const rows = await conn.query<{ id: string }>(
        `SELECT e.id FROM entries e
         WHERE ${conditions.join(' AND ')}
         ORDER BY e.headword COLLATE NOCASE ASC
         LIMIT ?;`,
        params
      );
      return rows.map((r) => String(r.id));
    }

    const norm = normalizeQueryForms(raw, lang);
    const orderedIds: string[] = [];
    const seen = new Set<string>();

    const pushRows = (rows: Array<{ id: string }>) => {
      for (const r of rows) {
        const id = String(r.id);
        if (!seen.has(id) && !this.removedIds.has(id)) {
          seen.add(id);
          orderedIds.push(id);
        }
      }
    };

    // Tier 1: Exact, soft-normalized, deep-normalized, vowelFold, Pinyin, or Root B-tree lookups
    const exactParams: Array<string | number | null> = [
      lang,
      raw,
      norm.soft,
      norm.deep,
      norm.vowelFold,
      raw,
      norm.pinyin || '__lexica_no_pinyin__',
      norm.arabic.replace(/[\s\-]/g, '') || '__lexica_no_root__',
    ];
    pushRows(
      await conn.query<{ id: string }>(
        `SELECT id FROM entries
         WHERE source_lang = ?
           AND (
             headword = ? COLLATE NOCASE
             OR headword_norm_soft = ?
             OR headword_norm_deep = ?
             OR headword_vowel_fold = ?
             OR headword_script_variant = ?
             OR (audio_phonetic_norm != '' AND audio_phonetic_norm = ?)
             OR (root_word_norm != '' AND root_word_norm = ?)
           )
         LIMIT ?;`,
        [...exactParams, limit]
      )
    );

    // Tier 2: Inflected forms & lexical relations exact/prefix matches
    if (orderedIds.length < limit) {
      pushRows(
        await conn.query<{ id: string }>(
          `SELECT DISTINCT wf.entry_id AS id
           FROM word_forms wf
           JOIN entries e ON e.id = wf.entry_id
           WHERE e.source_lang = ?
             AND (
               wf.form_norm_soft = ?
               OR wf.form_norm_deep = ?
               OR wf.form_norm_soft LIKE ?
             )
           LIMIT ?;`,
          [lang, norm.soft, norm.deep, `${norm.soft}%`, limit]
        )
      );

      pushRows(
        await conn.query<{ id: string }>(
          `SELECT DISTINCT lr.entry_id AS id
           FROM lexical_relations lr
           JOIN entries e ON e.id = lr.entry_id
           WHERE e.source_lang = ?
             AND (lr.related_term_norm = ? OR lr.related_term_norm = ?)
           LIMIT ?;`,
          [lang, norm.soft, norm.deep, limit]
        )
      );
    }

    // Tier 3: B-tree prefix & substring matches (including Chinese Hanzi/Pinyin & Arabic partial)
    if (orderedIds.length < limit) {
      if (lang === 'zh') {
        pushRows(
          await conn.query<{ id: string }>(
            `SELECT id FROM entries
             WHERE source_lang = 'zh'
               AND (
                 headword LIKE ?
                 OR headword_script_variant LIKE ?
                 OR (audio_phonetic_norm != '' AND audio_phonetic_norm LIKE ?)
               )
             LIMIT ?;`,
            [`%${raw}%`, `%${raw}%`, norm.pinyin ? `%${norm.pinyin}%` : '__no__', limit]
          )
        );
      } else {
        pushRows(
          await conn.query<{ id: string }>(
            `SELECT id FROM entries
             WHERE source_lang = ?
               AND (
                 headword_norm_soft LIKE ?
                 OR headword_norm_deep LIKE ?
                 OR headword_vowel_fold LIKE ?
               )
             LIMIT ?;`,
            [lang, `${norm.soft}%`, `${norm.deep}%`, `${norm.vowelFold}%`, limit]
          )
        );
      }
    }

    // Tier 4: FTS5 Full-Text Index Search across headword, forms, synonyms, and definitions
    if (orderedIds.length < limit) {
      const ftsSoft = escapeFtsTerm(norm.soft);
      const ftsRaw = escapeFtsTerm(raw);
      const ftsQuery =
        ftsSoft && ftsRaw && ftsSoft !== ftsRaw ? `(${ftsRaw}) OR (${ftsSoft})` : ftsSoft || ftsRaw;

      if (ftsQuery) {
        try {
          pushRows(
            await conn.query<{ id: string }>(
              `SELECT entry_id AS id
               FROM entries_fts
               WHERE source_lang = ?
                 AND entries_fts MATCH ?
               ORDER BY bm25(entries_fts)
               LIMIT ?;`,
              [lang, ftsQuery, limit]
            )
          );
        } catch {
          // Safe fallback if unusual query punctuation reaches FTS5
        }
      }
    }

    return orderedIds.slice(0, limit);
  }

  /**
   * Fetch candidate entry IDs across both source->target and reverse target->source pairs
   */
  private async queryMultilingualCandidateIds(
    sourceConn: SqliteConnection,
    targetConn: SqliteConnection,
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    options: MultilingualSearchOptions = {},
    limit: number = DEFAULT_CANDIDATE_LIMIT
  ): Promise<{ sourceIds: string[]; targetIds: string[] }> {
    const raw = query.trim();

    if (!raw) {
      const conditions = [
        'e.source_lang = ?',
        'EXISTS (SELECT 1 FROM translation_links tl WHERE tl.source_entry_id = e.id AND tl.target_lang = ?)',
      ];
      const params: Array<string | number | null> = [sourceLang, targetLang];
      if (options.partOfSpeech && options.partOfSpeech !== 'all') {
        conditions.push('LOWER(e.part_of_speech) LIKE ?');
        params.push(`%${options.partOfSpeech.toLowerCase()}%`);
      }
      if (options.letter && options.letter !== 'all') {
        conditions.push(
          `(e.headword_norm_deep LIKE ? OR UPPER(SUBSTR(e.headword, 1, 1)) = ?)`
        );
        params.push(`${options.letter.toLowerCase()}%`, options.letter.toUpperCase());
      }
      params.push(limit);

      const rows = await sourceConn.query<{ id: string }>(
        `SELECT e.id FROM entries e
         WHERE ${conditions.join(' AND ')}
         ORDER BY e.headword COLLATE NOCASE ASC
         LIMIT ?;`,
        params
      );
      return { sourceIds: rows.map((r) => String(r.id)), targetIds: [] };
    }

    // 1. Candidates in sourceLang having links -> targetLang matching query
    const stdSourceIds = await this.queryStandardCandidateIds(
      sourceConn,
      raw,
      sourceLang,
      { partOfSpeech: options.partOfSpeech },
      limit
    );

    // 2. Also match translation_links directly on sourceLang entries whose target_headword matches query (reverse lookup while in source->target)
    const targetNorm = normalizeQueryForms(raw, targetLang);
    const reverseSourceRows = await sourceConn.query<{ id: string }>(
      `SELECT DISTINCT tl.source_entry_id AS id
       FROM translation_links tl
       WHERE tl.source_lang = ?
         AND tl.target_lang = ?
         AND (
           tl.target_headword = ? COLLATE NOCASE
           OR tl.target_headword_norm_soft = ?
           OR tl.target_headword_norm_deep = ?
           OR tl.target_headword_norm_soft LIKE ?
           OR (tl.target_transliteration_norm != '' AND tl.target_transliteration_norm = ?)
         )
       LIMIT ?;`,
      [
        sourceLang,
        targetLang,
        raw,
        targetNorm.soft,
        targetNorm.deep,
        `${targetNorm.soft}%`,
        targetNorm.pinyin || '__no__',
        limit,
      ]
    );

    const sourceIds = Array.from(
      new Set([...stdSourceIds, ...reverseSourceRows.map((r) => String(r.id))])
    ).slice(0, limit);

    // 3. Candidates in targetLang having links -> sourceLang matching query (direct B-tree + FTS5)
    const sourceNorm = normalizeQueryForms(raw, sourceLang);
    const [targetStdIds, reverseTargetRows] = await Promise.all([
      this.queryStandardCandidateIds(
        targetConn,
        raw,
        targetLang,
        { partOfSpeech: options.partOfSpeech },
        Math.max(20, Math.floor(limit / 2))
      ),
      targetConn.query<{ id: string }>(
        `SELECT DISTINCT tl.source_entry_id AS id
         FROM translation_links tl
         WHERE tl.source_lang = ?
           AND tl.target_lang = ?
           AND (
             tl.target_headword = ? COLLATE NOCASE
             OR tl.target_headword_norm_soft = ?
             OR tl.target_headword_norm_deep = ?
             OR tl.target_headword_norm_soft LIKE ?
           )
         LIMIT ?;`,
        [
          targetLang,
          sourceLang,
          raw,
          sourceNorm.soft,
          sourceNorm.deep,
          `${sourceNorm.soft}%`,
          Math.max(20, Math.floor(limit / 2)),
        ]
      ),
    ]);

    const targetIds = Array.from(
      new Set([...targetStdIds, ...reverseTargetRows.map((r) => String(r.id))])
    ).slice(0, limit);

    return { sourceIds, targetIds };
  }

  /**
   * Hydrate only matched candidate IDs into WordEntry + senses + morphology + translation links.
   * Never loads unrequested entries into JavaScript heap.
   */
  private async hydrateEntriesByIds(
    conn: SqliteConnection,
    ids: string[]
  ): Promise<{
    entriesById: Map<string, WordEntry>;
    sensesById: Map<string, WordSense>;
    sensesByEntryId: Map<string, WordSense[]>;
    morphologyByEntryId: Map<string, MorphologicalForm[]>;
    translationLinksByEntryId: Map<string, TranslationRelationship[]>;
  }> {
    const entriesById = new Map<string, WordEntry>();
    const sensesById = new Map<string, WordSense>();
    const sensesByEntryId = new Map<string, WordSense[]>();
    const morphologyByEntryId = new Map<string, MorphologicalForm[]>();
    const translationLinksByEntryId = new Map<string, TranslationRelationship[]>();

    const cleanIds = Array.from(new Set(ids)).filter((id) => !this.removedIds.has(id));
    if (cleanIds.length === 0) {
      return {
        entriesById,
        sensesById,
        sensesByEntryId,
        morphologyByEntryId,
        translationLinksByEntryId,
      };
    }

    const placeholders = cleanIds.map(() => '?').join(', ');

    const [entryRows, senseRows, exampleRows, formRows, relRows, transRows] = await Promise.all([
      conn.query<SqliteRow>(
        `SELECT e.*, ds.name AS src_name, ds.license AS src_license, ds.source_url AS src_url, ds.dataset_version AS src_version
         FROM entries e
         LEFT JOIN dataset_sources ds ON ds.id = e.source_id
         WHERE e.id IN (${placeholders});`,
        cleanIds
      ),
      conn.query<SqliteRow>(
        `SELECT * FROM senses WHERE entry_id IN (${placeholders}) ORDER BY entry_id, sense_number ASC;`,
        cleanIds
      ),
      conn.query<SqliteRow>(
        `SELECT * FROM examples WHERE entry_id IN (${placeholders});`,
        cleanIds
      ),
      conn.query<SqliteRow>(
        `SELECT * FROM word_forms WHERE entry_id IN (${placeholders});`,
        cleanIds
      ),
      conn.query<SqliteRow>(
        `SELECT * FROM lexical_relations WHERE entry_id IN (${placeholders});`,
        cleanIds
      ),
      conn.query<SqliteRow>(
        `SELECT tl.*, ds.name AS src_name
         FROM translation_links tl
         LEFT JOIN dataset_sources ds ON ds.id = tl.source_id
         WHERE tl.source_entry_id IN (${placeholders});`,
        cleanIds
      ),
    ]);

    const examplesByEntry = new Map<string, ExampleSentence[]>();
    const examplesBySense = new Map<string, ExampleSentence[]>();
    for (const ex of exampleRows) {
      const item: ExampleSentence = {
        sourceText: String(ex.source_text || ''),
        targetText: String(ex.target_text || ''),
        literalTranslation: ex.literal_translation ? String(ex.literal_translation) : undefined,
        culturalContext: ex.cultural_context ? String(ex.cultural_context) : undefined,
      };
      const eid = String(ex.entry_id);
      if (!examplesByEntry.has(eid)) examplesByEntry.set(eid, []);
      examplesByEntry.get(eid)!.push(item);

      if (ex.sense_id) {
        const sid = String(ex.sense_id);
        if (!examplesBySense.has(sid)) examplesBySense.set(sid, []);
        examplesBySense.get(sid)!.push(item);
      }
    }

    const synonymsByEntry = new Map<string, string[]>();
    const antonymsByEntry = new Map<string, string[]>();
    const relatedByEntry = new Map<string, string[]>();
    for (const lr of relRows) {
      const eid = String(lr.entry_id);
      const term = String(lr.related_term);
      const rtype = String(lr.relation_type);
      if (rtype === 'synonym') {
        if (!synonymsByEntry.has(eid)) synonymsByEntry.set(eid, []);
        synonymsByEntry.get(eid)!.push(term);
      } else if (rtype === 'antonym') {
        if (!antonymsByEntry.has(eid)) antonymsByEntry.set(eid, []);
        antonymsByEntry.get(eid)!.push(term);
      } else {
        if (!relatedByEntry.has(eid)) relatedByEntry.set(eid, []);
        relatedByEntry.get(eid)!.push(term);
      }
    }

    for (const f of formRows) {
      const eid = String(f.entry_id);
      if (!morphologyByEntryId.has(eid)) morphologyByEntryId.set(eid, []);
      morphologyByEntryId.get(eid)!.push({
        form: String(f.form),
        label: String(f.grammatical_label || 'form'),
        note: f.note ? String(f.note) : undefined,
      });
    }

    for (const s of senseRows) {
      const eid = String(s.entry_id);
      const sid = String(s.id);
      const sense: WordSense = {
        id: sid,
        entryId: eid,
        senseNumber: Number(s.sense_number || 1),
        partOfSpeech: String(s.part_of_speech || ''),
        definition: String(s.definition || ''),
        definitionEn: s.definition_en ? String(s.definition_en) : undefined,
        register: s.register ? String(s.register) : null,
        usageNote: s.usage_note ? String(s.usage_note) : null,
        examples: examplesBySense.get(sid) || [],
        synonyms: synonymsByEntry.get(eid) || [],
        antonyms: antonymsByEntry.get(eid) || [],
        relatedWords: relatedByEntry.get(eid) || [],
      };
      sensesById.set(sid, sense);
      if (!sensesByEntryId.has(eid)) sensesByEntryId.set(eid, []);
      sensesByEntryId.get(eid)!.push(sense);
    }

    for (const tr of transRows) {
      const eid = String(tr.source_entry_id);
      const rel: TranslationRelationship = {
        id: String(tr.id),
        sourceSenseId: String(tr.source_sense_id),
        sourceEntryId: eid,
        sourceLang: String(tr.source_lang) as LanguageCode,
        targetSenseId: tr.target_sense_id ? String(tr.target_sense_id) : null,
        targetEntryId: tr.target_entry_id ? String(tr.target_entry_id) : null,
        targetLang: String(tr.target_lang) as LanguageCode,
        targetHeadword: String(tr.target_headword),
        transliteration: tr.target_transliteration ? String(tr.target_transliteration) : null,
        scriptVariant: tr.target_script_variant ? String(tr.target_script_variant) : null,
        partOfSpeech: String(tr.target_part_of_speech || ''),
        targetDefinition: String(tr.target_definition || ''),
        equivalenceType: (tr.equivalence_type as EquivalenceType) || 'literal',
        contextualNote: tr.contextual_note ? String(tr.contextual_note) : null,
        register: tr.register ? String(tr.register) : null,
        sourceAttribution: tr.src_name ? String(tr.src_name) : null,
      };
      if (!translationLinksByEntryId.has(eid)) translationLinksByEntryId.set(eid, []);
      translationLinksByEntryId.get(eid)!.push(rel);
    }

    for (const row of entryRows) {
      const id = String(row.id);
      const entrySenses = sensesByEntryId.get(id) || [];
      const entryMorphs = morphologyByEntryId.get(id) || [];
      const entryLinks = translationLinksByEntryId.get(id) || [];

      const translations: WordEntry['translations'] = {};
      for (const link of entryLinks) {
        if (!translations[link.targetLang]) translations[link.targetLang] = [];
        translations[link.targetLang]!.push({
          targetLang: link.targetLang,
          headword: link.targetHeadword,
          transliteration: link.transliteration,
          scriptVariant: link.scriptVariant,
          partOfSpeech: link.partOfSpeech,
          definition: link.targetDefinition,
          register: link.register,
          equivalenceType: link.equivalenceType,
          contextualNote: link.contextualNote,
          sourceSenseId: link.sourceSenseId,
          targetSenseId: link.targetSenseId || undefined,
          verifiedOffline: true,
        });
      }

      const entry: WordEntry = {
        id,
        sourceLang: String(row.source_lang) as LanguageCode,
        headword: String(row.headword),
        headwordScriptVariant: row.headword_script_variant
          ? {
              label: String(row.headword_script_label || 'Variant'),
              text: String(row.headword_script_variant),
            }
          : null,
        ipa: String(row.primary_ipa || ''),
        audioPhoneticText: row.audio_phonetic_text ? String(row.audio_phonetic_text) : null,
        partOfSpeech: String(row.part_of_speech || 'noun'),
        genderOrClass: row.gender_or_class ? String(row.gender_or_class) : null,
        dialect: row.dialect ? String(row.dialect) : null,
        register: row.register ? String(row.register) : null,
        etymology: row.etymology ? String(row.etymology) : null,
        rootWord: row.root_word ? String(row.root_word) : null,
        tonePattern: row.tone_pattern ? String(row.tone_pattern) : null,
        definition: entrySenses[0]?.definition || '',
        definitionEn: entrySenses[0]?.definitionEn || entrySenses[0]?.definition || '',
        culturalNote: row.cultural_note ? String(row.cultural_note) : null,
        senses: entrySenses,
        morphologicalForms: entryMorphs,
        relatedWords: relatedByEntry.get(id) || [],
        translations,
        examples: examplesByEntry.get(id) || [],
        synonyms: synonymsByEntry.get(id) || [],
        antonyms: antonymsByEntry.get(id) || [],
        verifiedOffline: row.verification_status === 'verified',
        verificationStatus: (row.verification_status as WordEntry['verificationStatus']) || 'verified',
        sourceAttribution: row.src_name ? String(row.src_name) : 'Lexica Open Corpus',
        license: row.src_license ? String(row.src_license) : 'CC BY-SA 4.0',
        datasetVersion: row.src_version
          ? String(row.src_version)
          : CURRENT_CORE_SCHEMA_AND_DATA_VERSION,
        packId: row.pack_id ? String(row.pack_id) : undefined,
        sourceUrl: row.src_url ? String(row.src_url) : null,
        tags: [],
      };

      entriesById.set(id, entry);
      if (!morphologyByEntryId.has(id)) morphologyByEntryId.set(id, []);
      if (!translationLinksByEntryId.has(id)) translationLinksByEntryId.set(id, []);
    }

    return {
      entriesById,
      sensesById,
      sensesByEntryId,
      morphologyByEntryId,
      translationLinksByEntryId,
    };
  }

  private mergeOverlayIntoContext(
    context: {
      entriesById: Map<string, WordEntry>;
      sensesById: Map<string, WordSense>;
      sensesByEntryId: Map<string, WordSense[]>;
      morphologyByEntryId: Map<string, MorphologicalForm[]>;
      translationLinksByEntryId: Map<string, TranslationRelationship[]>;
    },
    allowedLangs: LanguageCode[]
  ): void {
    for (const raw of this.overlayEntries.values()) {
      if (!allowedLangs.includes(raw.sourceLang)) continue;
      if (this.removedIds.has(raw.id)) continue;

      const synonyms = raw.synonyms || [];
      const antonyms = raw.antonyms || [];
      const relatedWords = raw.relatedWords || [];
      const morphologicalForms = raw.morphologicalForms || [];
      const senses: WordSense[] = raw.senses?.length
        ? raw.senses
        : [
            {
              id: `${raw.id}#s1`,
              entryId: raw.id,
              senseNumber: 1,
              partOfSpeech: raw.partOfSpeech,
              definition: raw.definition,
              definitionEn: raw.definitionEn,
              register: raw.register,
              examples: raw.examples || [],
              synonyms,
              antonyms,
              relatedWords,
            },
          ];

      const enriched: WordEntry = { ...raw, senses, morphologicalForms, synonyms, antonyms, relatedWords };
      context.entriesById.set(raw.id, enriched);
      context.sensesByEntryId.set(raw.id, senses);
      senses.forEach((s) => context.sensesById.set(s.id, s));
      context.morphologyByEntryId.set(raw.id, morphologicalForms);

      const links: TranslationRelationship[] = [];
      for (const [tLang, equivList] of Object.entries(raw.translations || {})) {
        const targetLang = tLang as LanguageCode;
        for (let idx = 0; idx < (equivList || []).length; idx++) {
          const eq = equivList![idx];
          links.push({
            id: `${raw.id}->${targetLang}#${idx + 1}`,
            sourceSenseId: eq.sourceSenseId || senses[0].id,
            sourceEntryId: raw.id,
            sourceLang: raw.sourceLang,
            targetLang,
            targetHeadword: eq.headword,
            transliteration: eq.transliteration || null,
            scriptVariant: eq.scriptVariant || null,
            partOfSpeech: eq.partOfSpeech,
            targetDefinition: eq.definition,
            equivalenceType: eq.equivalenceType || 'literal',
            contextualNote: eq.contextualNote || null,
            register: eq.register || null,
            sourceAttribution: raw.sourceAttribution || null,
          });
        }
      }
      context.translationLinksByEntryId.set(raw.id, links);
    }
  }

  /**
   * ENGINE A: Standard Monolingual Dictionary Search (SQLite + FTS5)
   */
  public async searchStandard(
    query: string,
    language: LanguageCode,
    options: StandardSearchOptions = {}
  ): Promise<StandardSearchResponse> {
    await this.initialize();
    const isInstalled = await this.isLanguageActive(language);
    if (!isInstalled) {
      return {
        status: 'language_not_installed',
        language,
        query: (query || '').trim(),
        results: [],
        message: `The ${language.toUpperCase()} dictionary pack is not installed.`,
      };
    }

    const conn = this.getConnectionForLanguage(language);
    const candidateIds = await this.queryStandardCandidateIds(
      conn,
      query,
      language,
      options,
      DEFAULT_CANDIDATE_LIMIT
    );
    const hydrated = await this.hydrateEntriesByIds(conn, candidateIds);
    this.mergeOverlayIntoContext(hydrated, [language]);

    return StandardDictionarySearch.search(
      {
        entries: Array.from(hydrated.entriesById.values()),
        sensesByEntryId: hydrated.sensesByEntryId,
        morphologyByEntryId: hydrated.morphologyByEntryId,
        isLanguageInstalled: () => true,
      },
      query,
      language,
      options
    );
  }

  /**
   * ENGINE B: Multilingual Sense-Linked Dictionary Search (SQLite + FTS5)
   */
  public async searchMultilingual(
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    options: MultilingualSearchOptions = {}
  ): Promise<MultilingualSearchResponse> {
    await this.initialize();
    const rawQuery = (query || '').trim();

    if (sourceLang === targetLang) {
      return {
        status: 'invalid_pair',
        sourceLang,
        targetLang,
        query: rawQuery,
        results: [],
        message:
          'Source and target languages must be different in Multilingual mode. Switch to Standard Dictionary for single-language lookups.',
      };
    }

    const [srcActive, tgtActive] = await Promise.all([
      this.isLanguageActive(sourceLang),
      this.isLanguageActive(targetLang),
    ]);
    if (!srcActive || !tgtActive) {
      const missing: string[] = [];
      if (!srcActive) missing.push(sourceLang.toUpperCase());
      if (!tgtActive) missing.push(targetLang.toUpperCase());
      return {
        status: 'language_not_installed',
        sourceLang,
        targetLang,
        query: rawQuery,
        results: [],
        message: `Required language pack not installed: ${missing.join(', ')}. Install it in Library to enable this translation pair.`,
      };
    }

    const sourceConn = this.getConnectionForLanguage(sourceLang);
    const targetConn = this.getConnectionForLanguage(targetLang);

    const { sourceIds, targetIds } = await this.queryMultilingualCandidateIds(
      sourceConn,
      targetConn,
      rawQuery,
      sourceLang,
      targetLang,
      options,
      DEFAULT_CANDIDATE_LIMIT
    );

    const [srcHydrated, tgtHydrated] = await Promise.all([
      this.hydrateEntriesByIds(sourceConn, sourceIds),
      sourceConn === targetConn
        ? this.hydrateEntriesByIds(sourceConn, targetIds)
        : this.hydrateEntriesByIds(targetConn, targetIds),
    ]);

    // Merge both hydrated contexts
    const merged = {
      entriesById: new Map([...srcHydrated.entriesById, ...tgtHydrated.entriesById]),
      sensesById: new Map([...srcHydrated.sensesById, ...tgtHydrated.sensesById]),
      sensesByEntryId: new Map([...srcHydrated.sensesByEntryId, ...tgtHydrated.sensesByEntryId]),
      morphologyByEntryId: new Map([
        ...srcHydrated.morphologyByEntryId,
        ...tgtHydrated.morphologyByEntryId,
      ]),
      translationLinksByEntryId: new Map([
        ...srcHydrated.translationLinksByEntryId,
        ...tgtHydrated.translationLinksByEntryId,
      ]),
    };

    // Hydrate linked target entries when present so targetEntry is populated
    const missingTargetIds: string[] = [];
    for (const rels of merged.translationLinksByEntryId.values()) {
      for (const rel of rels) {
        if (rel.targetEntryId && !merged.entriesById.has(rel.targetEntryId)) {
          missingTargetIds.push(rel.targetEntryId);
        }
      }
    }
    if (missingTargetIds.length > 0) {
      const extraTgt = await this.hydrateEntriesByIds(targetConn, missingTargetIds.slice(0, 40));
      for (const [k, v] of extraTgt.entriesById) merged.entriesById.set(k, v);
      for (const [k, v] of extraTgt.sensesById) merged.sensesById.set(k, v);
      for (const [k, v] of extraTgt.sensesByEntryId) merged.sensesByEntryId.set(k, v);
    }

    this.mergeOverlayIntoContext(merged, [sourceLang, targetLang]);

    const response = MultilingualDictionarySearch.search(
      {
        entries: Array.from(merged.entriesById.values()),
        entriesById: merged.entriesById,
        sensesById: merged.sensesById,
        sensesByEntryId: merged.sensesByEntryId,
        morphologyByEntryId: merged.morphologyByEntryId,
        translationLinksByEntryId: merged.translationLinksByEntryId,
        isLanguageInstalled: () => true,
      },
      rawQuery,
      sourceLang,
      targetLang,
      options
    );

    if (response.status === 'not_found' && rawQuery) {
      // Check if word exists monolingually in sourceLang Standard Dictionary
      const stdCheck = await this.searchStandard(rawQuery, sourceLang, {
        partOfSpeech: options.partOfSpeech,
      });
      if (stdCheck.status === 'ok' && stdCheck.results.length > 0) {
        return {
          status: 'no_translation',
          sourceLang,
          targetLang,
          query: rawQuery,
          results: [],
          existsInStandardDictionary: true,
          message: `“${stdCheck.results[0].entry.headword}” exists in the ${sourceLang.toUpperCase()} Standard Dictionary, but has no verified translation relationship to ${targetLang.toUpperCase()} yet.`,
        };
      }
    }

    return response;
  }
}

export const sqliteRepository = new SqliteDictionaryRepository();
