import React, { useState, useEffect } from 'react';
import { LanguageCode, WordEntry, Collection } from './types/dictionary';
import { StorageService } from './services/storageService';
import { dictionaryDb } from './services/dictionaryDatabase';
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

  // Synchronize dark mode class on <html>
  useEffect(() => {
    const isDark = preferences.theme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [preferences.theme]);

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
            sourceLang={preferences.sourceLang}
            targetLang={preferences.targetLang}
            onSetLanguages={handleSetLanguages}
            onNavigateToDictionary={handleNavigateToDictionary}
            onSelectWord={(word) => setSelectedWord(word)}
            savedWordIds={preferences.savedWordIds}
            onToggleSave={handleToggleSaveWord}
            recentSearches={preferences.recentSearches}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {currentTab === 'dictionary' && (
          <DictionaryScreen
            sourceLang={preferences.sourceLang}
            targetLang={preferences.targetLang}
            onSetLanguages={handleSetLanguages}
            onSelectWord={(word) => setSelectedWord(word)}
            savedWordIds={preferences.savedWordIds}
            onToggleSave={handleToggleSaveWord}
            initialQuery={dictionaryInitialQuery}
            onRecordSearch={handleRecordSearch}
          />
        )}

        {currentTab === 'learn' && (
          <LearnScreen
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
            savedWordIds={preferences.savedWordIds}
            onToggleSave={handleToggleSaveWord}
            onSelectWord={(word) => setSelectedWord(word)}
            collections={collections}
            onSaveCollection={handleSaveCollection}
            recentSearches={preferences.recentSearches}
            onClearRecentSearches={handleClearRecentSearches}
            onNavigateToDictionary={handleNavigateToDictionary}
            targetLang={preferences.targetLang}
          />
        )}

        {currentTab === 'library' && (
          <LanguageLibraryScreen
            installedPacks={preferences.installedPacks}
            onTogglePack={handleTogglePack}
            onSetLanguages={handleSetLanguages}
          />
        )}
      </main>

      {/* Word Detail Modal */}
      {selectedWord && (
        <WordDetailModal
          word={selectedWord}
          targetLang={preferences.targetLang}
          isSaved={preferences.savedWordIds.includes(selectedWord.id)}
          onToggleSave={handleToggleSaveWord}
          onClose={() => setSelectedWord(null)}
          onSelectWordById={(id) => {
            const found = dictionaryDb.getEntryById(id);
            if (found) setSelectedWord(found);
          }}
          onSetLanguages={(src, tgt) => {
            handleSetLanguages(src, tgt);
            setSelectedWord(null);
            setCurrentTab('dictionary');
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
