import React, { useState, useEffect } from 'react';
import { DictionaryMode, LanguageCode, WordEntry, Collection } from './types/dictionary';
import { StorageService } from './services/storageService';
import { dictionaryDb } from './services/dictionaryDatabase';
import { englishPackService } from './services/englishPackService';
import { englishSqliteRepo } from './services/englishSqliteRepository';
import { hausaPackService } from './services/hausaPackService';
import { hausaSqliteRepo } from './services/hausaSqliteRepository';
import { yorubaPackService } from './services/yorubaPackService';
import { yorubaSqliteRepo } from './services/yorubaSqliteRepository';
import { OnboardingScreen } from './components/OnboardingScreen';
import { Navigation, NavigationTab } from './components/Navigation';
import { HomeScreen } from './components/HomeScreen';
import { DictionaryScreen } from './components/DictionaryScreen';
import { LearnScreen } from './components/LearnScreen';
import { SavedScreen } from './components/SavedScreen';
import { LanguageLibraryScreen } from './components/LanguageLibraryScreen';
import { WordDetailModal } from './components/WordDetailModal';
import { SettingsModal } from './components/SettingsModal';

export default function App() {
  const [preferences, setPreferences] = useState(() => StorageService.getPreferences());
  const [currentTab, setCurrentTab] = useState<NavigationTab>('home');
  const [selectedWord, setSelectedWord] = useState<WordEntry | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [dictionaryInitialQuery, setDictionaryInitialQuery] = useState('');
  const [collections, setCollections] = useState<Collection[]>(() => StorageService.getCollections());
  const [savedSqliteEntries, setSavedSqliteEntries] = useState<WordEntry[]>([]);
  const [englishPackVersionTick, setEnglishPackVersionTick] = useState(0);
  const [hausaPackVersionTick, setHausaPackVersionTick] = useState(0);
  const [yorubaPackVersionTick, setYorubaPackVersionTick] = useState(0);

  useEffect(() => {
    const unsubEn = englishPackService.subscribeStatus(() => {
      setEnglishPackVersionTick((t) => t + 1);
    });
    const unsubHa = hausaPackService.subscribeStatus(() => {
      setHausaPackVersionTick((t) => t + 1);
    });
    const unsubYo = yorubaPackService.subscribeStatus(() => {
      setYorubaPackVersionTick((t) => t + 1);
    });
    void englishPackService.refreshStatus();
    void hausaPackService.refreshStatus();
    void yorubaPackService.refreshStatus();
    return () => {
      unsubEn();
      unsubHa();
      unsubYo();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const enIds = preferences.savedWordIds.filter((id) => id.startsWith('en-sqlite-'));
    const haIds = preferences.savedWordIds.filter((id) => /^ha-\d+$/.test(id));
    const yoIds = preferences.savedWordIds.filter((id) => /^yo-sqlite-\d+$/.test(id));
    const promises: Promise<WordEntry[]>[] = [];

    if (enIds.length > 0 && englishSqliteRepo.isPackActive()) {
      promises.push(englishSqliteRepo.getEntriesByIds(enIds).catch(() => []));
    }
    if (haIds.length > 0 && hausaSqliteRepo.isPackActive()) {
      promises.push(hausaSqliteRepo.getEntriesByIds(haIds).catch(() => []));
    }
    if (yoIds.length > 0 && yorubaSqliteRepo.isPackActive()) {
      promises.push(yorubaSqliteRepo.getEntriesByIds(yoIds).catch(() => []));
    }

    if (promises.length === 0) {
      setSavedSqliteEntries([]);
      return;
    }

    Promise.all(promises)
      .then((groups) => {
        if (!cancelled) {
          setSavedSqliteEntries(groups.flat());
        }
      })
      .catch(() => {
        if (!cancelled) setSavedSqliteEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [preferences.savedWordIds, englishPackVersionTick, hausaPackVersionTick, yorubaPackVersionTick]);

  // Synchronize dark mode class, theme color, document language & RTL/LTR direction
  useEffect(() => {
    const isDark = preferences.theme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', isDark ? '#0E1713' : '#FAF8F5');
    }
  }, [preferences.theme]);

  useEffect(() => {
    if (!preferences.hasCompletedOnboarding) return;
    document.documentElement.lang = preferences.interfaceLang;
    document.documentElement.dir = preferences.interfaceLang === 'ar' ? 'rtl' : 'ltr';
  }, [preferences.interfaceLang, preferences.hasCompletedOnboarding]);

  // Handle Onboarding Completion
  const handleCompleteOnboarding = (chosenLang: LanguageCode) => {
    const updated = StorageService.savePreferences({
      hasCompletedOnboarding: true,
      interfaceLang: chosenLang,
      sourceLang: chosenLang === 'en' ? 'en' : chosenLang,
      targetLang: chosenLang === 'en' ? 'ha' : 'en',
    });
    setPreferences(updated);
  };

  const handleSelectTab = (tab: NavigationTab) => {
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSetDictionaryMode = (dictionaryMode: DictionaryMode) => {
    const updated = StorageService.savePreferences({ dictionaryMode });
    setPreferences(updated);
  };

  const handleSetLanguages = (source: LanguageCode, target: LanguageCode) => {
    const updated = StorageService.savePreferences({
      sourceLang: source,
      targetLang: target,
    });
    setPreferences(updated);
  };

  const handleNavigateToDictionary = (initialQuery?: string) => {
    setDictionaryInitialQuery(initialQuery || '');
    setCurrentTab('dictionary');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleSaveWord = (wordId: string) => {
    StorageService.toggleSaveWord(wordId);
    setPreferences(StorageService.getPreferences());
  };

  const handleToggleTheme = (theme: 'light' | 'dark') => {
    const updated = StorageService.savePreferences({ theme });
    setPreferences(updated);
  };

  const handleSelectInterfaceLang = (code: LanguageCode) => {
    const updated = StorageService.savePreferences({ interfaceLang: code });
    setPreferences(updated);
  };

  const handleToggleAudio = () => {
    const updated = StorageService.savePreferences({
      audioPronunciation: !preferences.audioPronunciation,
    });
    setPreferences(updated);
  };

  const handleTogglePhonetics = () => {
    const updated = StorageService.savePreferences({
      showPhonetics: !preferences.showPhonetics,
    });
    setPreferences(updated);
  };

  const handleResetOnboarding = () => {
    const updated = StorageService.savePreferences({
      hasCompletedOnboarding: false,
    });
    setPreferences(updated);
    setIsSettingsOpen(false);
  };

  const handleTogglePack = (code: LanguageCode) => {
    StorageService.togglePackInstalled(code);
    setPreferences(StorageService.getPreferences());
  };

  const handlePreferencesUpdated = () => {
    setPreferences(StorageService.getPreferences());
    setCollections(StorageService.getCollections());
  };

  const handleSaveCollection = (collection: Collection) => {
    const updated = StorageService.saveCollection(collection);
    setCollections(updated);
  };

  const handleRecordSearch = (term: string) => {
    StorageService.addRecentSearch(term);
    setPreferences(StorageService.getPreferences());
  };

  const handleClearRecentSearches = () => {
    StorageService.clearRecentSearches();
    setPreferences(StorageService.getPreferences());
  };

  const handleRecordQuiz = (score: number, total: number) => {
    StorageService.recordQuizCompleted(score, total);
    setPreferences(StorageService.getPreferences());
  };

  const handleRecordCardsReviewed = (count: number) => {
    StorageService.recordCardsReviewed(count);
    setPreferences(StorageService.getPreferences());
  };

  // If user hasn't completed first-launch welcome screen, show onboarding
  if (!preferences.hasCompletedOnboarding) {
    return <OnboardingScreen onComplete={handleCompleteOnboarding} />;
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] dark:bg-[#0E1713] text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* Top Application Navigation */}
      <Navigation
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        interfaceLang={preferences.interfaceLang}
        onOpenSettings={() => setIsSettingsOpen(true)}
        theme={preferences.theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 w-full max-w-7xl mx-auto">
        {currentTab === 'home' && (
          <HomeScreen
            interfaceLang={preferences.interfaceLang}
            dictionaryMode={preferences.dictionaryMode}
            onSetDictionaryMode={handleSetDictionaryMode}
            sourceLang={preferences.sourceLang}
            targetLang={preferences.targetLang}
            onSetLanguages={handleSetLanguages}
            onNavigateToDictionary={handleNavigateToDictionary}
            onNavigateToLibrary={() => handleSelectTab('library')}
            onSelectWord={(word) => setSelectedWord(word)}
            savedWordIds={preferences.savedWordIds}
            onToggleSave={handleToggleSaveWord}
            recentSearches={preferences.recentSearches}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onRecordSearch={handleRecordSearch}
          />
        )}

        {currentTab === 'dictionary' && (
          <DictionaryScreen
            interfaceLang={preferences.interfaceLang}
            dictionaryMode={preferences.dictionaryMode}
            onSetDictionaryMode={handleSetDictionaryMode}
            sourceLang={preferences.sourceLang}
            targetLang={preferences.targetLang}
            onSetLanguages={handleSetLanguages}
            onNavigateToLibrary={() => handleSelectTab('library')}
            onSelectWord={(word) => setSelectedWord(word)}
            savedWordIds={preferences.savedWordIds}
            onToggleSave={handleToggleSaveWord}
            initialQuery={dictionaryInitialQuery}
            onRecordSearch={handleRecordSearch}
          />
        )}

        {currentTab === 'learn' && (
          <LearnScreen
            interfaceLang={preferences.interfaceLang}
            sourceLang={preferences.sourceLang}
            targetLang={preferences.targetLang}
            quizStreak={preferences.quizStreak}
            totalQuizzesTaken={preferences.totalQuizzesTaken}
            totalCardsReviewed={preferences.totalCardsReviewed}
            onRecordQuiz={handleRecordQuiz}
            onRecordCardsReviewed={handleRecordCardsReviewed}
          />
        )}

        {currentTab === 'saved' && (
          <SavedScreen
            interfaceLang={preferences.interfaceLang}
            savedWordIds={preferences.savedWordIds}
            onToggleSave={handleToggleSaveWord}
            onSelectWord={(word) => setSelectedWord(word)}
            collections={collections}
            onSaveCollection={handleSaveCollection}
            recentSearches={preferences.recentSearches}
            onClearRecentSearches={handleClearRecentSearches}
            onNavigateToDictionary={handleNavigateToDictionary}
            targetLang={preferences.targetLang}
            extraEntries={savedSqliteEntries}
          />
        )}

        {currentTab === 'library' && (
          <LanguageLibraryScreen
            interfaceLang={preferences.interfaceLang}
            installedPacks={preferences.installedPacks}
            onTogglePack={handleTogglePack}
            onSetLanguages={handleSetLanguages}
            onPreferencesUpdated={handlePreferencesUpdated}
          />
        )}
      </main>

      {/* Word Detail Modal */}
      {selectedWord && (
        <WordDetailModal
          word={selectedWord}
          interfaceLang={preferences.interfaceLang}
          dictionaryMode={preferences.dictionaryMode}
          targetLang={preferences.targetLang}
          isSaved={preferences.savedWordIds.includes(selectedWord.id)}
          onToggleSave={handleToggleSaveWord}
          onClose={() => setSelectedWord(null)}
          onSelectWordById={(id) => {
            if (id.startsWith('en-sqlite-')) {
              void englishSqliteRepo.getEntryById(id).then((found) => {
                if (found) setSelectedWord(found);
              });
              return;
            }
            if (/^ha-\d+$/.test(id)) {
              void hausaSqliteRepo.getEntriesByIds([id]).then((found) => {
                if (found[0]) setSelectedWord(found[0]);
              });
              return;
            }
            if (/^yo-sqlite-\d+$/.test(id)) {
              void yorubaSqliteRepo.getEntryById(id).then((found) => {
                if (found) setSelectedWord(found);
              });
              return;
            }
            const found = dictionaryDb.getEntryById(id);
            if (found) setSelectedWord(found);
          }}
          onSetLanguages={(src, tgt) => {
            handleSetLanguages(src, tgt);
            handleSetDictionaryMode('multilingual');
            setSelectedWord(null);
            setCurrentTab('dictionary');
          }}
          onSearchRelated={(term, lang) => {
            handleSetLanguages(lang, preferences.targetLang);
            handleSetDictionaryMode('standard');
            setSelectedWord(null);
            handleNavigateToDictionary(term);
          }}
        />
      )}

      {/* Settings & Interface Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        interfaceLang={preferences.interfaceLang}
        onSelectInterfaceLang={handleSelectInterfaceLang}
        theme={preferences.theme}
        onToggleTheme={handleToggleTheme}
        audioPronunciation={preferences.audioPronunciation}
        onToggleAudio={handleToggleAudio}
        showPhonetics={preferences.showPhonetics}
        onTogglePhonetics={handleTogglePhonetics}
        onResetOnboarding={handleResetOnboarding}
      />
    </div>
  );
}
