import {
  WordEntry,
  LanguageCode,
  WordSense,
  MorphologicalForm,
  TranslationRelationship,
  StandardSearchResponse,
  MultilingualSearchResponse,
} from '../types/dictionary';
import { VERIFIED_SEED_ENTRIES } from '../data/seedDictionary';
import { DICTIONARY_ENTRIES as INITIAL_ENTRIES } from '../data/dictionaryData';
import { LEXICON_ENRICHMENTS, TRANSLATION_ANNOTATIONS } from '../data/lexiconEnrichment';
import {
  StandardDictionarySearch,
  StandardSearchOptions,
} from './standardDictionarySearch';
import {
  MultilingualDictionarySearch,
  MultilingualSearchOptions,
} from './multilingualDictionarySearch';

const DB_STORAGE_KEY = 'lexica_offline_database_v4';
const DB_VERSION_KEY = 'lexica_offline_database_version';
const DB_PACKS_KEY = 'lexica_installed_pack_flags_v4';
const CURRENT_DB_VERSION = '2026.4.0';

const ALL_LANGUAGES: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];

export interface LanguagePackStats {
  code: LanguageCode;
  loadedEntriesCount: number;
  sensesCount: number;
  translationRelationshipsCount: number;
  verifiedDirectedPairsCount: number;
  actualSizeBytes: number;
  actualSizeMb: number;
  isInstalled: boolean;
  isAvailableOffline: boolean;
  datasetVersion: string;
  sampleHeadwords: string[];
}

class LocalDictionaryDatabase {
  private entriesById: Map<string, WordEntry> = new Map();
  private sensesById: Map<string, WordSense> = new Map();
  private sensesByEntryId: Map<string, WordSense[]> = new Map();
  private morphologyByEntryId: Map<string, MorphologicalForm[]> = new Map();
  private translationLinks: TranslationRelationship[] = [];
  private translationLinksByEntryId: Map<string, TranslationRelationship[]> = new Map();
  private installedLanguages: Set<LanguageCode> = new Set(ALL_LANGUAGES);
  private isInitialized = false;

  constructor() {
    this.initializeDatabase();
  }

  public initializeDatabase(): void {
    this.loadInstalledPackFlags();

    if (typeof window === 'undefined') {
      this.seedAndIndexEntries();
      this.isInitialized = true;
      return;
    }

    try {
      const storedVersion = localStorage.getItem(DB_VERSION_KEY);
      const storedData = localStorage.getItem(DB_STORAGE_KEY);

      if (storedData && storedVersion === CURRENT_DB_VERSION) {
        const parsed: WordEntry[] = JSON.parse(storedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.buildRelationalIndexes(parsed);
          this.isInitialized = true;
          return;
        }
      }
    } catch (e) {
      console.warn('Error reading from localStorage database, re-seeding dataset', e);
    }

    this.seedAndIndexEntries();
    this.persistToStorage();
    this.isInitialized = true;
  }

  private loadInstalledPackFlags(): void {
    if (typeof window === 'undefined') {
      this.installedLanguages = new Set(ALL_LANGUAGES);
      return;
    }

    try {
      const rawFlags = localStorage.getItem(DB_PACKS_KEY);
      if (rawFlags) {
        const parsed = JSON.parse(rawFlags) as Partial<Record<LanguageCode, boolean>>;
        const nextSet = new Set<LanguageCode>();
        for (const code of ALL_LANGUAGES) {
          if (parsed[code] !== false) {
            nextSet.add(code);
          }
        }
        this.installedLanguages = nextSet;
        return;
      }

      // Migrate from user preferences if present
      const rawPrefs = localStorage.getItem('lexica_user_preferences');
      if (rawPrefs) {
        const prefs = JSON.parse(rawPrefs);
        if (prefs?.installedPacks) {
          const nextSet = new Set<LanguageCode>();
          for (const code of ALL_LANGUAGES) {
            if (prefs.installedPacks[code]?.installed !== false) {
              nextSet.add(code);
            }
          }
          this.installedLanguages = nextSet;
          return;
        }
      }
    } catch {
      // Fallback to all bundled packs active
    }

    this.installedLanguages = new Set(ALL_LANGUAGES);
  }

  private persistPackFlags(): void {
    if (typeof window === 'undefined') return;
    try {
      const flags: Record<string, boolean> = {};
      for (const code of ALL_LANGUAGES) {
        flags[code] = this.installedLanguages.has(code);
      }
      localStorage.setItem(DB_PACKS_KEY, JSON.stringify(flags));
    } catch {
      // Ignore storage quota issues
    }
  }

  private seedAndIndexEntries(): void {
    const rawMap = new Map<string, WordEntry>();

    for (const entry of VERIFIED_SEED_ENTRIES) {
      rawMap.set(entry.id, entry);
    }

    for (const entry of INITIAL_ENTRIES) {
      const alreadyHas = Array.from(rawMap.values()).some(
        (e) =>
          e.sourceLang === entry.sourceLang &&
          e.headword.trim().toLowerCase() === entry.headword.trim().toLowerCase()
      );
      if (!rawMap.has(entry.id) && !alreadyHas) {
        rawMap.set(entry.id, entry);
      }
    }

    const enrichedList = Array.from(rawMap.values()).map((entry) => this.enrichEntry(entry));
    this.buildRelationalIndexes(enrichedList);
  }

  private enrichEntry(raw: WordEntry): WordEntry {
    const enrichment = LEXICON_ENRICHMENTS[raw.id];

    const synonyms = enrichment?.synonyms?.length ? enrichment.synonyms : raw.synonyms || [];
    const antonyms = enrichment?.antonyms?.length ? enrichment.antonyms : raw.antonyms || [];
    const relatedWords = enrichment?.relatedWords || raw.relatedWords || [];
    const morphologicalForms = enrichment?.morphologicalForms || raw.morphologicalForms || [];

    const senses: WordSense[] = enrichment?.senses?.length
      ? enrichment.senses.map((s, idx) => ({
          id: `${raw.id}#s${idx + 1}`,
          entryId: raw.id,
          senseNumber: idx + 1,
          partOfSpeech: s.partOfSpeech || raw.partOfSpeech,
          definition: s.definition,
          definitionEn: s.definitionEn || raw.definitionEn,
          register: s.register || raw.register,
          usageNote: s.usageNote || null,
          examples: s.examples?.length ? s.examples : idx === 0 ? raw.examples : [],
          synonyms: s.synonyms?.length ? s.synonyms : idx === 0 ? synonyms : [],
          antonyms: s.antonyms?.length ? s.antonyms : idx === 0 ? antonyms : [],
          relatedWords: s.relatedWords?.length ? s.relatedWords : idx === 0 ? relatedWords : [],
        }))
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

    return {
      ...raw,
      etymology: enrichment?.etymology || raw.etymology,
      culturalNote: enrichment?.culturalNote || raw.culturalNote,
      synonyms,
      antonyms,
      relatedWords,
      morphologicalForms,
      senses,
      license: raw.license || 'CC BY-SA 4.0 / Lexica Curated Starter Corpus',
      datasetVersion: CURRENT_DB_VERSION,
    };
  }

  private buildRelationalIndexes(entries: WordEntry[]): void {
    this.entriesById.clear();
    this.sensesById.clear();
    this.sensesByEntryId.clear();
    this.morphologyByEntryId.clear();
    this.translationLinks = [];
    this.translationLinksByEntryId.clear();

    // First pass: register entries, senses, and morphology
    const headwordLookup = new Map<string, WordEntry>();
    for (const entry of entries) {
      const normalizedEntry = entry.senses?.length ? entry : this.enrichEntry(entry);
      this.entriesById.set(normalizedEntry.id, normalizedEntry);
      headwordLookup.set(
        `${normalizedEntry.sourceLang}:${normalizedEntry.headword.trim().toLowerCase()}`,
        normalizedEntry
      );

      const entrySenses = normalizedEntry.senses || [];
      this.sensesByEntryId.set(normalizedEntry.id, entrySenses);
      for (const s of entrySenses) {
        this.sensesById.set(s.id, s);
      }

      this.morphologyByEntryId.set(normalizedEntry.id, normalizedEntry.morphologicalForms || []);
    }

    // Second pass: build independent sense-to-sense TranslationRelationship records
    for (const entry of this.entriesById.values()) {
      const entrySenses = this.sensesByEntryId.get(entry.id) || [];
      const primarySenseId = entrySenses[0]?.id || `${entry.id}#s1`;
      const linksForEntry: TranslationRelationship[] = [];

      for (const [tLang, equivList] of Object.entries(entry.translations || {})) {
        const targetLang = tLang as LanguageCode;
        if (!equivList || equivList.length === 0) continue;

        for (let idx = 0; idx < equivList.length; idx++) {
          const eq = equivList[idx];
          const targetEntry = headwordLookup.get(
            `${targetLang}:${eq.headword.trim().toLowerCase()}`
          );
          const targetSenses = targetEntry ? this.sensesByEntryId.get(targetEntry.id) : undefined;
          const annotationKey = `${entry.sourceLang}->${targetLang}:${eq.headword}`;
          const annotation = TRANSLATION_ANNOTATIONS[annotationKey];

          const rel: TranslationRelationship = {
            id: `${entry.id}->${targetLang}#${idx + 1}`,
            sourceSenseId: eq.sourceSenseId || primarySenseId,
            sourceEntryId: entry.id,
            sourceLang: entry.sourceLang,
            targetSenseId: eq.targetSenseId || targetSenses?.[0]?.id || null,
            targetEntryId: targetEntry?.id || null,
            targetLang,
            targetHeadword: eq.headword,
            transliteration: eq.transliteration || null,
            scriptVariant: eq.scriptVariant || null,
            partOfSpeech: eq.partOfSpeech,
            targetDefinition: eq.definition,
            equivalenceType: eq.equivalenceType || annotation?.equivalenceType || 'literal',
            contextualNote: eq.contextualNote || annotation?.contextualNote || null,
            register: eq.register || null,
            sourceAttribution: entry.sourceAttribution || 'Lexica Core Corpus',
          };

          this.translationLinks.push(rel);
          linksForEntry.push(rel);
        }
      }

      this.translationLinksByEntryId.set(entry.id, linksForEntry);
    }
  }

  public persistToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const allEntries = Array.from(this.entriesById.values());
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(allEntries));
      localStorage.setItem(DB_VERSION_KEY, CURRENT_DB_VERSION);
    } catch (e) {
      console.warn('Unable to persist dictionary database to localStorage', e);
    }
  }

  public isLanguageInstalled(lang: LanguageCode): boolean {
    if (!this.isInitialized) this.initializeDatabase();
    return this.installedLanguages.has(lang);
  }

  public setPackInstalled(lang: LanguageCode, installed: boolean): void {
    if (!this.isInitialized) this.initializeDatabase();
    if (installed) {
      this.installedLanguages.add(lang);
    } else {
      this.installedLanguages.delete(lang);
    }
    this.persistPackFlags();
  }

  public getAllEntries(): WordEntry[] {
    if (!this.isInitialized) this.initializeDatabase();
    return Array.from(this.entriesById.values()).filter((e) =>
      this.installedLanguages.has(e.sourceLang)
    );
  }

  public getAllRawEntries(): WordEntry[] {
    if (!this.isInitialized) this.initializeDatabase();
    return Array.from(this.entriesById.values());
  }

  public getEntryById(id: string): WordEntry | null {
    if (!this.isInitialized) this.initializeDatabase();
    return this.entriesById.get(id) || null;
  }

  public getEntrySenses(entryId: string): WordSense[] {
    if (!this.isInitialized) this.initializeDatabase();
    return this.sensesByEntryId.get(entryId) || [];
  }

  public getEntryMorphology(entryId: string): MorphologicalForm[] {
    if (!this.isInitialized) this.initializeDatabase();
    return this.morphologyByEntryId.get(entryId) || [];
  }

  public getEntryTranslationLinks(entryId: string): TranslationRelationship[] {
    if (!this.isInitialized) this.initializeDatabase();
    return this.translationLinksByEntryId.get(entryId) || [];
  }

  public getTotalTranslationRelationshipsCount(): number {
    if (!this.isInitialized) this.initializeDatabase();
    return this.translationLinks.filter(
      (r) => this.installedLanguages.has(r.sourceLang) && this.installedLanguages.has(r.targetLang)
    ).length;
  }

  public getEntriesByLanguage(lang: LanguageCode): WordEntry[] {
    if (!this.isInitialized) this.initializeDatabase();
    if (!this.installedLanguages.has(lang)) return [];
    return Array.from(this.entriesById.values()).filter((e) => e.sourceLang === lang);
  }

  /**
   * ENGINE 1: Standard Monolingual Search (no target language required)
   */
  public searchStandard(
    query: string,
    language: LanguageCode,
    options?: StandardSearchOptions
  ): StandardSearchResponse {
    if (!this.isInitialized) this.initializeDatabase();
    return StandardDictionarySearch.search(
      {
        entries: Array.from(this.entriesById.values()),
        sensesByEntryId: this.sensesByEntryId,
        morphologyByEntryId: this.morphologyByEntryId,
        isLanguageInstalled: (code) => this.installedLanguages.has(code),
      },
      query,
      language,
      options
    );
  }

  /**
   * ENGINE 2: Multilingual Search (requires source and target languages)
   */
  public searchMultilingual(
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    options?: MultilingualSearchOptions
  ): MultilingualSearchResponse {
    if (!this.isInitialized) this.initializeDatabase();
    return MultilingualDictionarySearch.search(
      {
        entries: Array.from(this.entriesById.values()),
        entriesById: this.entriesById,
        sensesById: this.sensesById,
        sensesByEntryId: this.sensesByEntryId,
        morphologyByEntryId: this.morphologyByEntryId,
        translationLinksByEntryId: this.translationLinksByEntryId,
        isLanguageInstalled: (code) => this.installedLanguages.has(code),
      },
      query,
      sourceLang,
      targetLang,
      options
    );
  }

  /**
   * Backward-compatible search helper returning flat WordEntry[]
   */
  public search(
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    partOfSpeech: string = 'all'
  ): WordEntry[] {
    if (sourceLang === targetLang) {
      return this.searchStandard(query, sourceLang, { partOfSpeech }).results.map((r) => r.entry);
    }
    return this.searchMultilingual(query, sourceLang, targetLang, { partOfSpeech }).results.map(
      (r) => r.entry
    );
  }

  /**
   * Reports real live dataset stats computed directly from stored records (no hardcoded fictions)
   */
  public getLanguagePackStats(): Record<LanguageCode, LanguagePackStats> {
    if (!this.isInitialized) this.initializeDatabase();
    const allRaw = Array.from(this.entriesById.values());
    const stats: Partial<Record<LanguageCode, LanguagePackStats>> = {};

    for (const code of ALL_LANGUAGES) {
      const langEntries = allRaw.filter((e) => e.sourceLang === code);
      const isInstalled = this.installedLanguages.has(code);
      const activeEntries = isInstalled ? langEntries : [];

      let sensesCount = 0;
      let relCount = 0;
      const targetPairs = new Set<LanguageCode>();

      for (const e of activeEntries) {
        sensesCount += (this.sensesByEntryId.get(e.id) || []).length;
        const links = (this.translationLinksByEntryId.get(e.id) || []).filter((l) =>
          this.installedLanguages.has(l.targetLang)
        );
        relCount += links.length;
        for (const l of links) {
          targetPairs.add(l.targetLang);
        }
      }

      const serializedBytes = new Blob([JSON.stringify(langEntries)]).size;
      const sizeMb = Number((serializedBytes / (1024 * 1024)).toFixed(2));

      stats[code] = {
        code,
        loadedEntriesCount: activeEntries.length,
        sensesCount,
        translationRelationshipsCount: relCount,
        verifiedDirectedPairsCount: targetPairs.size,
        actualSizeBytes: serializedBytes,
        actualSizeMb: sizeMb,
        isInstalled,
        isAvailableOffline: isInstalled && activeEntries.length > 0,
        datasetVersion: CURRENT_DB_VERSION,
        sampleHeadwords: activeEntries.slice(0, 3).map((e) => e.headword),
      };
    }

    return stats as Record<LanguageCode, LanguagePackStats>;
  }

  /**
   * Register/update an entry dynamically (e.g., for testing unlinked monolingual words)
   */
  public upsertEntry(entry: WordEntry): void {
    if (!this.isInitialized) this.initializeDatabase();
    const current = Array.from(this.entriesById.values()).filter((e) => e.id !== entry.id);
    current.push(this.enrichEntry(entry));
    this.buildRelationalIndexes(current);
  }

  public removeEntry(entryId: string): void {
    if (!this.isInitialized) this.initializeDatabase();
    const current = Array.from(this.entriesById.values()).filter((e) => e.id !== entryId);
    this.buildRelationalIndexes(current);
  }

  public resetToVerifiedSeed(): void {
    this.installedLanguages = new Set(ALL_LANGUAGES);
    this.persistPackFlags();
    this.seedAndIndexEntries();
    this.persistToStorage();
  }
}

export const dictionaryDb = new LocalDictionaryDatabase();
