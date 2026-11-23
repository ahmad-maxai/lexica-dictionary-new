import { Capacitor } from '@capacitor/core';
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
} from '../types/dictionary';
import { YORUBA_PACK_MANIFEST, isYorubaSqliteIntegrationEnabled } from '../config/yorubaDictionaryConfig';
import { yorubaPackService } from './yorubaPackService';
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
      // Ignore
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
      // Ignore
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

export class YorubaSqliteRepository {
  private executor: SqlQueryExecutor;
  private attachedExtPath: string | null = null;
  private activeCorePath: string | null = null;

  constructor(executor?: SqlQueryExecutor) {
    this.executor = executor || new CapacitorSqliteExecutor();
  }

  public isPackActive(): boolean {
    if (!isYorubaSqliteIntegrationEnabled()) return false;
    return this.executor.isOpen();
  }

  public async initialize(): Promise<boolean> {
    if (!isYorubaSqliteIntegrationEnabled()) return false;
    const status = await yorubaPackService.getStatus();
    if (!status.installed || !status.dbPath) {
      return false;
    }
    try {
      await this.executor.open(status.dbPath);
      this.activeCorePath = status.dbPath;

      if (status.extendedInstalled && status.extendedDbPath) {
        await this.attachExtendedCompanion(status.extendedDbPath);
      }
      return true;
    } catch {
      return false;
    }
  }

  public async attachExtendedCompanion(extDbPath: string): Promise<boolean> {
    try {
      const exec = this.executor as CapacitorSqliteExecutor;
      if (typeof exec.query === 'function' && exec.isOpen()) {
        try {
          await exec.query('DETACH DATABASE ext;');
        } catch {
          // Ignore if not attached
        }
        await exec.query(`ATTACH DATABASE ? AS ext;`, [extDbPath]);
        this.attachedExtPath = extDbPath;
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  public async detachExtendedCompanion(): Promise<void> {
    try {
      const exec = this.executor as CapacitorSqliteExecutor;
      if (typeof exec.query === 'function' && exec.isOpen()) {
        await exec.query('DETACH DATABASE ext;');
      }
    } catch {
      // Ignore
    }
    this.attachedExtPath = null;
  }

  public async close(): Promise<void> {
    await this.detachExtendedCompanion();
    await this.executor.close();
    this.activeCorePath = null;
  }

  private mapRowToWordEntry(row: SqlEntryRow, senses: WordSense[] = [], extRow?: SqlExtExtensionRow): WordEntry {
    const wordId = `yo-sqlite-${row.id}`;
    let ipaVariants: PronunciationVariant[] = [];
    if (extRow?.all_ipas) {
      try {
        const parsed = JSON.parse(extRow.all_ipas) as string[];
        ipaVariants = parsed.map((ipa) => ({ ipa, tags: [row.dialect || 'Standard'] }));
      } catch {
        // Fallback
      }
    }
    if (ipaVariants.length === 0 && row.primary_ipa) {
      ipaVariants.push({ ipa: row.primary_ipa, tags: [row.dialect || 'Standard'] });
    }

    let audioRefs: VerifiedAudioRef[] = [];
    if (extRow?.audio_refs) {
      try {
        audioRefs = JSON.parse(extRow.audio_refs) as VerifiedAudioRef[];
      } catch {
        // Fallback
      }
    } else if (row.audio_file) {
      audioRefs.push({
        file: row.audio_file,
        license: row.source_license || 'CC BY-SA 4.0',
      });
    }

    const defaultSense: WordSense = {
      id: `${wordId}-sense-1`,
      entryId: wordId,
      senseNumber: 1,
      partOfSpeech: row.part_of_speech || 'noun',
      definition: row.primary_definition,
      definitionEn: row.definition_en || undefined,
      definitionType: 'hausa_monolingual',
      examples: [],
      synonyms: [],
      antonyms: [],
      relatedWords: [],
    };

    const resolvedSenses = senses.length > 0 ? senses : [defaultSense];

    return {
      id: wordId,
      sourceLang: 'yo',
      headword: row.headword,
      ipa: row.primary_ipa || '',
      allIpas: ipaVariants,
      audioRefs,
      isMonolingualSqlite: true,
      partOfSpeech: row.part_of_speech || 'noun',
      dialect: row.dialect || 'Standard',
      etymology: extRow?.etymology || undefined,
      definition: row.primary_definition,
      definitionEn: row.definition_en || row.primary_definition,
      definitionType: 'hausa_monolingual',
      senses: resolvedSenses,
      examples: resolvedSenses[0]?.examples || [],
      synonyms: resolvedSenses[0]?.synonyms || [],
      antonyms: resolvedSenses[0]?.antonyms || [],
      translations: {},
      verifiedOffline: true,
      sourceVerificationStatus: row.verification_status || 'community_reviewed',
      hasConflict: Boolean(row.has_conflict),
      sourceAttribution: row.source_name || YORUBA_PACK_MANIFEST.attribution.sourceName,
      sourceUrl: row.source_url || YORUBA_PACK_MANIFEST.attribution.sourceUrl,
      license: row.source_license || YORUBA_PACK_MANIFEST.attribution.license,
      tags: ['yoruba', 'sqlite-v4'],
    };
  }

  public async getEntryById(id: string): Promise<WordEntry | null> {
    if (!this.isPackActive()) return null;
    const match = id.match(/^yo-sqlite-(\d+)$/);
    if (!match) return null;
    const numericId = parseInt(match[1], 10);

    const sql = `
      SELECT e.*, s.code as source_code, s.name as source_name, s.license as source_license,
             s.attribution_text as source_attribution, s.source_url as source_url
      FROM entries e
      JOIN sources s ON e.source_id = s.id
      WHERE e.id = ?;
    `;
    const rows = await this.executor.query<SqlEntryRow>(sql, [numericId]);
    if (rows.length === 0) return null;
    const row = rows[0];

    let senses: WordSense[] = [];
    let extRow: SqlExtExtensionRow | undefined;
    const wordId = `yo-sqlite-${numericId}`;

    if (this.attachedExtPath) {
      try {
        const senseRows = await this.executor.query<SqlExtSenseRow>(
          `SELECT * FROM ext.senses WHERE entry_id = ? ORDER BY sense_number ASC;`,
          [numericId]
        );
        senses = senseRows.map((sr) => ({
          id: `${wordId}-sense-${sr.sense_number}`,
          entryId: wordId,
          senseNumber: sr.sense_number,
          partOfSpeech: sr.part_of_speech || row.part_of_speech,
          definition: sr.definition || sr.definition_yo || sr.definition_en || '',
          definitionEn: sr.definition_en || undefined,
          definitionType: 'hausa_monolingual',
          examples: sr.examples ? (JSON.parse(sr.examples) as string[]).map(ex => ({ sourceText: ex, targetText: '' })) : [],
          synonyms: sr.synonyms ? (JSON.parse(sr.synonyms) as string[]) : [],
          antonyms: sr.antonyms ? (JSON.parse(sr.antonyms) as string[]) : [],
          relatedWords: [],
        }));

        const extRows = await this.executor.query<SqlExtExtensionRow>(
          `SELECT * FROM ext.extensions WHERE entry_id = ?;`,
          [numericId]
        );
        if (extRows.length > 0) {
          extRow = extRows[0];
        }
      } catch {
        // Ignore
      }
    }

    return this.mapRowToWordEntry(row, senses, extRow);
  }

  public async getEntriesByIds(ids: string[]): Promise<WordEntry[]> {
    const results: WordEntry[] = [];
    for (const id of ids) {
      const entry = await this.getEntryById(id);
      if (entry) results.push(entry);
    }
    return results;
  }

  public async searchStandard(
    query: string,
    options: {
      strictDiacritics?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<StandardSearchResponse> {
    if (!this.isPackActive()) {
      return {
        status: 'language_not_installed',
        language: 'yo',
        query,
        results: [],
        totalCount: 0,
        limit: options.limit || 20,
        offset: options.offset || 0,
        engineSource: 'sqlite-ha',
      };
    }

    const trimmed = query.trim();
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let sql = '';
    let params: unknown[] = [];

    if (!trimmed) {
      sql = `
        SELECT e.*, s.code as source_code, s.name as source_name, s.license as source_license,
               s.attribution_text as source_attribution, s.source_url as source_url
        FROM entries e
        JOIN sources s ON e.source_id = s.id
        ORDER BY e.id ASC
        LIMIT ? OFFSET ?;
      `;
      params = [limit, offset];
    } else {
      const normQuery = TextNormalization.normalizeLatin(trimmed).soft;
      sql = `
        SELECT e.*, s.code as source_code, s.name as source_name, s.license as source_license,
               s.attribution_text as source_attribution, s.source_url as source_url
        FROM entries_fts fts
        JOIN entries e ON fts.rowid = e.id
        JOIN sources s ON e.source_id = s.id
        WHERE entries_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?;
      `;
      params = [`"${normQuery}"*`, limit, offset];
    }

    const rows = await this.executor.query<SqlEntryRow>(sql, params);
    const results: StandardSearchResult[] = [];

    for (const row of rows) {
      const entry = this.mapRowToWordEntry(row);
      results.push({
        entry,
        senses: entry.senses || [],
        morphologicalForms: [],
        matchedField: trimmed ? 'headword-exact' : 'definition',
        matchedTerm: trimmed,
        score: 1.0,
      });
    }

    return {
      status: results.length > 0 ? 'ok' : 'not_found',
      language: 'yo',
      query,
      results,
      totalCount: results.length,
      limit,
      offset,
      engineSource: 'sqlite-ha',
    };
  }
}

export const yorubaSqliteRepo = new YorubaSqliteRepository();
