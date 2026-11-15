import { LanguageCode, UserPreferences, Collection, InstalledPack } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import { CURATED_COLLECTIONS } from '../data/dictionaryData';
import { dictionaryDb } from './dictionaryDatabase';

const STORAGE_KEYS = {
  PREFS: 'lexica_user_preferences',
  SAVED_WORDS: 'lexica_saved_words',
  RECENT_SEARCHES: 'lexica_recent_searches',
  COLLECTIONS: 'lexica_custom_collections',
  INSTALLED_PACKS: 'lexica_installed_packs',
  FLASHCARD_PROGRESS: 'lexica_flashcard_progress',
};

const DEFAULT_INSTALLED_PACKS: Record<LanguageCode, InstalledPack> = {
  en: { code: 'en', installed: true, version: '2026.4.0', sizeMb: 0.24, downloadDate: Date.now() },
  ha: { code: 'ha', installed: true, version: '2026.4.0', sizeMb: 0.24, downloadDate: Date.now() },
  yo: { code: 'yo', installed: true, version: '2026.4.0', sizeMb: 0.24, downloadDate: Date.now() },
  ff: { code: 'ff', installed: true, version: '2026.4.0', sizeMb: 0.24, downloadDate: Date.now() },
  ar: { code: 'ar', installed: true, version: '2026.4.0', sizeMb: 0.25, downloadDate: Date.now() },
  fr: { code: 'fr', installed: true, version: '2026.4.0', sizeMb: 0.24, downloadDate: Date.now() },
  zh: { code: 'zh', installed: true, version: '2026.4.0', sizeMb: 0.25, downloadDate: Date.now() },
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
        const liveStats = dictionaryDb.getLanguagePackStats();
        const mergedPacks = { ...DEFAULT_INSTALLED_PACKS } as Record<LanguageCode, InstalledPack>;

        (Object.keys(mergedPacks) as LanguageCode[]).forEach((code) => {
          const parsedPack = parsed.installedPacks?.[code];
          const isInstalled = parsedPack ? Boolean(parsedPack.installed) : true;
          mergedPacks[code] = {
            ...mergedPacks[code],
            ...(parsedPack || {}),
            installed: isInstalled,
            version: liveStats[code]?.datasetVersion || '2026.4.0',
            sizeMb: liveStats[code]?.actualSizeMb || LANGUAGES[code].packSizeMb,
          };
          dictionaryDb.setPackInstalled(code, isInstalled);
        });

        // Filter out legacy pre-seeded mock searches if present
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
    } catch {}
    return CURATED_COLLECTIONS;
  },

  saveCollection(col: Collection): Collection[] {
    const list = this.getCollections();
    const exists = list.some((c) => c.id === col.id);
    const updated = exists ? list.map((c) => (c.id === col.id ? col : c)) : [...list, col];
    try {
      localStorage.setItem(STORAGE_KEYS.COLLECTIONS, JSON.stringify(updated));
    } catch {}
    return updated;
  },

  togglePackInstalled(code: LanguageCode): InstalledPack {
    const prefs = this.getPreferences();
    const liveStats = dictionaryDb.getLanguagePackStats();
    const currentPack = prefs.installedPacks[code] || {
      code,
      installed: false,
      version: '2026.4.0',
      sizeMb: liveStats[code]?.actualSizeMb || LANGUAGES[code].packSizeMb,
    };

    const newInstalledState = !currentPack.installed;
    dictionaryDb.setPackInstalled(code, newInstalledState);

    const updatedStats = dictionaryDb.getLanguagePackStats()[code];
    const updatedPack: InstalledPack = {
      ...currentPack,
      installed: newInstalledState,
      version: updatedStats?.datasetVersion || '2026.4.0',
      sizeMb: updatedStats?.actualSizeMb || LANGUAGES[code].packSizeMb,
      downloadDate: newInstalledState ? Date.now() : undefined,
    };

    const updatedPacks = {
      ...prefs.installedPacks,
      [code]: updatedPack,
    };

    this.savePreferences({ installedPacks: updatedPacks });
    return updatedPack;
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
