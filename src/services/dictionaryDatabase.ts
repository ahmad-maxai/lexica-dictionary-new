import {
  WordEntry,
  LanguageCode,
  WordSense,
  MorphologicalForm,
  TranslationRelationship,
  StandardSearchResponse,
  MultilingualSearchResponse,
} from '../types/dictionary';
import {
  StandardSearchOptions,
} from './standardDictionarySearch';
import {
  MultilingualSearchOptions,
} from './multilingualDictionarySearch';
import {
  sqliteRepository,
  LanguagePackStats,
} from './sqliteDictionaryRepository';
import { packManager } from './packManager';

export type { LanguagePackStats };

/**
 * Production SQLite + FTS5 Dictionary Database Facade.
 * Connects both Standard and Multilingual search engines directly to
 * bundled core SQLite (`lexica_coreSQLite.db`) and installed offline packs.
 */
class ProductionSqliteDictionaryDatabase {
  public async initialize(): Promise<void> {
    await sqliteRepository.initialize();
  }

  public isInitialized(): boolean {
    return sqliteRepository.isInitialized();
  }

  public async isLanguageInstalled(lang: LanguageCode): Promise<boolean> {
    return sqliteRepository.isLanguageActive(lang);
  }

  public async setPackInstalled(lang: LanguageCode, installed: boolean): Promise<void> {
    await sqliteRepository.initialize();
    await packManager.setLanguageActiveState(lang, installed);
  }

  public async getEntryById(id: string): Promise<WordEntry | null> {
    return sqliteRepository.getEntryById(id);
  }

  public async getEntriesByIds(ids: string[]): Promise<WordEntry[]> {
    return sqliteRepository.getEntriesByIds(ids);
  }

  public async getEntryDetails(entryId: string): Promise<{
    entry: WordEntry | null;
    senses: WordSense[];
    morphologicalForms: MorphologicalForm[];
    translationLinks: TranslationRelationship[];
  }> {
    return sqliteRepository.getEntryDetails(entryId);
  }

  public async getEntrySenses(entryId: string): Promise<WordSense[]> {
    const details = await sqliteRepository.getEntryDetails(entryId);
    return details.senses;
  }

  public async getEntryMorphology(entryId: string): Promise<MorphologicalForm[]> {
    const details = await sqliteRepository.getEntryDetails(entryId);
    return details.morphologicalForms;
  }

  public async getEntryTranslationLinks(entryId: string): Promise<TranslationRelationship[]> {
    const details = await sqliteRepository.getEntryDetails(entryId);
    return details.translationLinks;
  }

  public async getAvailableLetters(lang: LanguageCode): Promise<string[]> {
    return sqliteRepository.getAvailableLetters(lang);
  }

  public async getSampleEntries(options: { lang?: LanguageCode; limit?: number } = {}): Promise<WordEntry[]> {
    return sqliteRepository.getSampleEntries(options);
  }

  public async getEntriesByLanguage(lang: LanguageCode, limit: number = 60): Promise<WordEntry[]> {
    return sqliteRepository.getSampleEntries({ lang, limit });
  }

  public async findCrossLanguageHint(
    query: string,
    excludeLang: LanguageCode
  ): Promise<{ entry: WordEntry; lang: LanguageCode } | null> {
    return sqliteRepository.findCrossLanguageHint(query, excludeLang);
  }

  public async getTotalTranslationRelationshipsCount(): Promise<number> {
    return sqliteRepository.getTotalTranslationRelationshipsCount();
  }

  /**
   * ENGINE A: Standard Monolingual Search (SQLite B-tree + FTS5)
   */
  public async searchStandard(
    query: string,
    language: LanguageCode,
    options?: StandardSearchOptions
  ): Promise<StandardSearchResponse> {
    return sqliteRepository.searchStandard(query, language, options);
  }

  /**
   * ENGINE B: Multilingual Sense-Linked Search (SQLite B-tree + FTS5)
   */
  public async searchMultilingual(
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    options?: MultilingualSearchOptions
  ): Promise<MultilingualSearchResponse> {
    return sqliteRepository.searchMultilingual(query, sourceLang, targetLang, options);
  }

  /**
   * Live dataset stats queried directly from SQLite registries and active pack DBs
   */
  public async getLanguagePackStats(): Promise<Record<LanguageCode, LanguagePackStats>> {
    return sqliteRepository.getLanguagePackStats();
  }

  public async upsertEntry(entry: WordEntry): Promise<void> {
    await sqliteRepository.initialize();
    sqliteRepository.upsertOverlayEntry(entry);
  }

  public async removeEntry(entryId: string): Promise<void> {
    await sqliteRepository.initialize();
    sqliteRepository.removeOverlayEntry(entryId);
  }
}

export const dictionaryDb = new ProductionSqliteDictionaryDatabase();
