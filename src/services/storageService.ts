import { LanguageCode, UserPreferences, Collection, InstalledPack } from '../types/dictionary';
import { CURATED_COLLECTIONS } from '../data/curatedMetadata';
import { dictionaryDb } from './dictionaryDatabase';
import { packManager } from './packManager';

const STORAGE_KEYS = {
  PREFS: 'lexica_user_preferences',
  COLLECTIONS: 'lexica_custom_collections',
};

const ALL_LANGUAGES: LanguageCode[] = ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh'];

const DEFAULT_INSTALLED_PACKS: Record<LanguageCode, InstalledPack> = {
  en: { code: 'en', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
  ha: { code: 'ha', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
  yo: { code: 'yo', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
  ff: { code: 'ff', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
  ar: { code: 'ar', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
  fr: { code: 'fr', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
  zh: { code: 'zh', installed: true, version: '2026.6.0', sizeMb: 0, tier: 'core_starter', installState: 'core_only' },
};

const DEFAULT_PREFERENCES: UserPreferences = {
  hasCompletedOnboarding: false,
  interfaceLang: 'en',
  theme: 'light',
  dictionaryMode: 'standard',
  sourceLang: 'en',
  targetLang: 'ha',
  audioPronunciation: true,
  showPhonetics: true,
  installedPacks: DEFAULT_INSTALLED_PACKS,
  savedWordIds: ['word-lafiya-ha', 'word-ogbon-yo', 'word-peace-en'],
  recentSearches: [],
  quizStreak: 3,
  totalQuizzesTaken: 8,
  totalCardsReviewed: 24,
};

export const StorageService = {
  getPreferences(): UserPreferences {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PREFS);
      if (stored) {
        const parsed = JSON.parse(stored);
        const mergedPacks = { ...DEFAULT_INSTALLED_PACKS } as Record<LanguageCode, InstalledPack>;

        ALL_LANGUAGES.forEach((code) => {
          const parsedPack = parsed.installedPacks?.[code];
          mergedPacks[code] = {
            ...mergedPacks[code],
            ...(parsedPack || {}),
            installed: parsedPack ? Boolean(parsedPack.installed) : true,
          };
        });

        const LEGACY_MOCKS = ['Peace', 'Lafiya', 'Wisdom', 'صَبْر'];
        let activeSearches: string[] = Array.isArray(parsed.recentSearches) ? parsed.recentSearches : [];
        if (
          activeSearches.length === LEGACY_MOCKS.length &&
          activeSearches.every((item, idx) => item === LEGACY_MOCKS[idx])
        ) {
          activeSearches = [];
        }

        return {
          ...DEFAULT_PREFERENCES,
          ...parsed,
          recentSearches: activeSearches,
          dictionaryMode: parsed.dictionaryMode === 'multilingual' ? 'multilingual' : 'standard',
          installedPacks: mergedPacks,
        };
      }
    } catch {
      // LocalStorage error or private mode fallback
    }
    return DEFAULT_PREFERENCES;
  },

  async syncPacksFromSqlite(): Promise<Record<LanguageCode, InstalledPack>> {
    await dictionaryDb.initialize();
    const liveStats = await dictionaryDb.getLanguagePackStats();
    const packStates = await packManager.getPackStates();
    const prefs = this.getPreferences();
    const nextPacks = { ...prefs.installedPacks } as Record<LanguageCode, InstalledPack>;

    for (const code of ALL_LANGUAGES) {
      const st = packStates[code];
      const stat = liveStats[code];
      nextPacks[code] = {
        code,
        installed: stat.isInstalled,
        version: stat.datasetVersion,
        sizeMb: stat.actualSizeMb,
        tier: stat.tier,
        installState: st?.installState || (stat.isInstalled ? 'core_only' : 'not_installed'),
        entryCount: stat.loadedEntriesCount,
        downloadDate: st?.installedAt || prefs.installedPacks[code]?.downloadDate,
      };
    }

    this.savePreferences({ installedPacks: nextPacks });
    return nextPacks;
  },

  savePreferences(prefs: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences();
    const updated = { ...current, ...prefs };
    try {
      localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(updated));
    } catch (e) {
      console.warn('Unable to persist preferences to localStorage', e);
    }
    return updated;
  },

  getSavedWordIds(): string[] {
    return this.getPreferences().savedWordIds || [];
  },

  toggleSaveWord(wordId: string): boolean {
    const prefs = this.getPreferences();
    const exists = prefs.savedWordIds.includes(wordId);
    const updated = exists
      ? prefs.savedWordIds.filter((id) => id !== wordId)
      : [wordId, ...prefs.savedWordIds];
    this.savePreferences({ savedWordIds: updated });
    return !exists;
  },

  isWordSaved(wordId: string): boolean {
    return this.getSavedWordIds().includes(wordId);
  },

  addRecentSearch(term: string): void {
    if (!term || !term.trim()) return;
    const clean = term.trim();
    const prefs = this.getPreferences();
    const filtered = prefs.recentSearches.filter((s) => s.toLowerCase() !== clean.toLowerCase());
    const updated = [clean, ...filtered].slice(0, 10);
    this.savePreferences({ recentSearches: updated });
  },

  clearRecentSearches(): void {
    this.savePreferences({ recentSearches: [] });
  },

  getCollections(): Collection[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.COLLECTIONS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Ignore parse error
    }
    return CURATED_COLLECTIONS;
  },

  saveCollection(col: Collection): Collection[] {
    const list = this.getCollections();
    const exists = list.some((c) => c.id === col.id);
    const updated = exists ? list.map((c) => (c.id === col.id ? col : c)) : [...list, col];
    try {
      localStorage.setItem(STORAGE_KEYS.COLLECTIONS, JSON.stringify(updated));
    } catch {
      // Ignore quota issues
    }
    return updated;
  },

  async togglePackInstalled(code: LanguageCode): Promise<InstalledPack> {
    const isInstalled = await dictionaryDb.isLanguageInstalled(code);
    const nextState = !isInstalled;
    await dictionaryDb.setPackInstalled(code, nextState);
    const synced = await this.syncPacksFromSqlite();
    return synced[code];
  },

  recordQuizCompleted(score: number, total: number): void {
    const prefs = this.getPreferences();
    this.savePreferences({
      quizStreak: score >= total * 0.7 ? prefs.quizStreak + 1 : Math.max(1, prefs.quizStreak),
      totalQuizzesTaken: prefs.totalQuizzesTaken + 1,
    });
  },

  recordCardsReviewed(count: number): void {
    const prefs = this.getPreferences();
    this.savePreferences({
      totalCardsReviewed: prefs.totalCardsReviewed + count,
    });
  },
};
