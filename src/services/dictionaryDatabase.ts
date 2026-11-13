import { WordEntry, LanguageCode, TranslationEquivalent } from '../types/dictionary';
import { VERIFIED_SEED_ENTRIES } from '../data/seedDictionary';
import { DICTIONARY_ENTRIES as INITIAL_ENTRIES } from '../data/dictionaryData';
import { MultilingualSearchEngine } from './dictionarySearchEngine';

const DB_STORAGE_KEY = 'lexica_offline_database_v3';
const DB_VERSION_KEY = 'lexica_offline_database_version';
const CURRENT_DB_VERSION = '2026.3.0';

export interface LanguagePackStats {
  code: LanguageCode;
  loadedEntriesCount: number;
  verifiedDirectedPairsCount: number;
  isAvailableOffline: boolean;
  sampleHeadwords: string[];
}

class LocalDictionaryDatabase {
  private inMemoryCache: Map<string, WordEntry> = new Map();
  private isInitialized = false;

  constructor() {
    this.initializeDatabase();
  }

  /**
   * Initializes local database from persistent storage or seeds verified starter dataset.
   */
  public initializeDatabase(): void {
    if (typeof window === 'undefined') {
      this.seedInitialEntries();
      this.isInitialized = true;
      return;
    }

    try {
      const storedVersion = localStorage.getItem(DB_VERSION_KEY);
      const storedData = localStorage.getItem(DB_STORAGE_KEY);

      if (storedData && storedVersion === CURRENT_DB_VERSION) {
        const parsed: WordEntry[] = JSON.parse(storedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.inMemoryCache.clear();
          for (const entry of parsed) {
            this.inMemoryCache.set(entry.id, entry);
          }
          this.isInitialized = true;
          return;
        }
      }
    } catch (e) {
      console.warn('Error reading from localStorage database, re-seeding verified data', e);
    }

    // Seed default dataset
    this.seedInitialEntries();
    this.persistToStorage();
    this.isInitialized = true;
  }

  private seedInitialEntries(): void {
    this.inMemoryCache.clear();

    // 1. Load verified seed entries first (highest priority)
    for (const entry of VERIFIED_SEED_ENTRIES) {
      this.inMemoryCache.set(entry.id, entry);
    }

    // 2. Load complementary initial entries if not already present by ID or headword
    for (const entry of INITIAL_ENTRIES) {
      const alreadyHas = Array.from(this.inMemoryCache.values()).some(
        (e) =>
          e.sourceLang === entry.sourceLang &&
          e.headword.trim().toLowerCase() === entry.headword.trim().toLowerCase()
      );
      if (!this.inMemoryCache.has(entry.id) && !alreadyHas) {
        this.inMemoryCache.set(entry.id, entry);
      }
    }
  }

  public persistToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const allEntries = Array.from(this.inMemoryCache.values());
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(allEntries));
      localStorage.setItem(DB_VERSION_KEY, CURRENT_DB_VERSION);
    } catch (e) {
      console.warn('Unable to persist dictionary database to localStorage', e);
    }
  }

  public getAllEntries(): WordEntry[] {
    if (!this.isInitialized) this.initializeDatabase();
    return Array.from(this.inMemoryCache.values());
  }

  public getEntryById(id: string): WordEntry | null {
    if (!this.isInitialized) this.initializeDatabase();
    return this.inMemoryCache.get(id) || null;
  }

  public getEntriesByLanguage(lang: LanguageCode): WordEntry[] {
    return this.getAllEntries().filter((e) => e.sourceLang === lang);
  }

  /**
   * Multilingual Search with strict pair filtering and Unicode/diacritic normalization
   */
  public search(
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    partOfSpeech: string = 'all'
  ): WordEntry[] {
    if (!this.isInitialized) this.initializeDatabase();
    const all = this.getAllEntries();
    return MultilingualSearchEngine.search(all, query, sourceLang, targetLang, partOfSpeech);
  }

  /**
   * Reports live diagnostic stats per language pack
   */
  public getLanguagePackStats(): Record<LanguageCode, LanguagePackStats> {
    const all = this.getAllEntries();
    const languages: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];

    const stats: Partial<Record<LanguageCode, LanguagePackStats>> = {};

    for (const code of languages) {
      const langEntries = all.filter((e) => e.sourceLang === code);
      const targetPairs = new Set<LanguageCode>();

      for (const e of langEntries) {
        for (const [tCode, list] of Object.entries(e.translations)) {
          if (list && list.length > 0) {
            targetPairs.add(tCode as LanguageCode);
          }
        }
      }

      stats[code] = {
        code,
        loadedEntriesCount: langEntries.length,
        verifiedDirectedPairsCount: targetPairs.size,
        isAvailableOffline: langEntries.length > 0,
        sampleHeadwords: langEntries.slice(0, 3).map((e) => e.headword),
      };
    }

    return stats as Record<LanguageCode, LanguagePackStats>;
  }

  /**
   * Resets database back to factory verified seed data
   */
  public resetToVerifiedSeed(): void {
    this.seedInitialEntries();
    this.persistToStorage();
  }
}

export const dictionaryDb = new LocalDictionaryDatabase();
