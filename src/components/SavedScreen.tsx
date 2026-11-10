import React, { useState } from 'react';
import { WordEntry, LanguageCode, Collection } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import { audioService } from '../services/audioService';
import {
  Bookmark,
  FolderPlus,
  History,
  Trash2,
  Volume2,
  ArrowRight,
  BookOpen,
  Plus,
  Sparkles,
  Check,
  X,
} from 'lucide-react';

interface SavedScreenProps {
  savedWordIds: string[];
  onToggleSave: (wordId: string) => void;
  onSelectWord: (word: WordEntry) => void;
  collections: Collection[];
  onSaveCollection: (collection: Collection) => void;
  recentSearches: string[];
  onClearRecentSearches: () => void;
  onNavigateToDictionary: (term?: string) => void;
  targetLang: LanguageCode;
}

export const SavedScreen: React.FC<SavedScreenProps> = ({
  savedWordIds,
  onToggleSave,
  onSelectWord,
  collections,
  onSaveCollection,
  recentSearches,
  onClearRecentSearches,
  onNavigateToDictionary,
  targetLang,
}) => {
  const [activeTab, setActiveTab] = useState<'words' | 'collections' | 'history'>('words');
  const [selectedLanguageFilter, setSelectedLanguageFilter] = useState<string>('all');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDesc, setNewCollectionDesc] = useState('');

  // Get full word objects for saved IDs
  const savedEntries = dictionaryDb.getAllEntries().filter((entry) => savedWordIds.includes(entry.id));

  const filteredSavedEntries = savedEntries.filter((entry) => {
    if (selectedLanguageFilter === 'all') return true;
    return entry.sourceLang === selectedLanguageFilter;
  });

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;

    const newCol: Collection = {
      id: `custom-col-${Date.now()}`,
      name: newCollectionName.trim(),
      description: newCollectionDesc.trim() || 'Custom user vocabulary collection.',
      iconName: 'Folder',
      wordIds: [...savedWordIds],
      isCustom: true,
      createdAt: Date.now(),
    };

    onSaveCollection(newCol);
    setNewCollectionName('');
    setNewCollectionDesc('');
    setIsCreatingCollection(false);
  };

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 max-w-3xl mx-auto px-4 sm:px-6 pt-6 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-serif-editorial text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Bookmark className="w-6 h-6 text-[#C47248] fill-current" />
            <span>Saved Lexicon</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Your offline bookmarks, curated folders, and query log.
          </p>
        </div>

        <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
          {savedWordIds.length} Saved Words
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200/60 dark:bg-[#162720] rounded-xl mb-6">
        <button
          onClick={() => setActiveTab('words')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'words'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          Bookmarked Words ({savedEntries.length})
        </button>
        <button
          onClick={() => setActiveTab('collections')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'collections'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          Collections ({collections.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          Lookup History
        </button>
      </div>

      {/* --- TAB 1: BOOKMARKED WORDS --- */}
      {activeTab === 'words' && (
        <div className="space-y-4">
          {/* Language Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setSelectedLanguageFilter('all')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                selectedLanguageFilter === 'all'
                  ? 'bg-[#1B382B] text-white'
                  : 'bg-white dark:bg-[#15231D] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
              }`}
            >
              All Languages
            </button>
            {Object.values(LANGUAGES).map((lang) => (
              <button
                key={lang.code}
                onClick={() => setSelectedLanguageFilter(lang.code)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  selectedLanguageFilter === lang.code
                    ? 'bg-[#1B382B] text-white'
                    : 'bg-white dark:bg-[#15231D] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                }`}
              >
                {lang.name}
              </button>
            ))}
          </div>

          {filteredSavedEntries.length > 0 ? (
            <div className="space-y-3">
              {filteredSavedEntries.map((entry) => {
                const sourceMeta = LANGUAGES[entry.sourceLang];
                const targetEquivalent = entry.translations[targetLang]?.[0];

                return (
                  <div
                    key={entry.id}
                    onClick={() => onSelectWord(entry)}
                    className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs transition-all cursor-pointer flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]">
                          {sourceMeta.code.toUpperCase()} · {sourceMeta.name}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">{entry.ipa}</span>
                      </div>

                      <div className="flex items-baseline gap-2">
                        <h3
                          className={`text-xl font-bold text-slate-900 dark:text-slate-50 ${
                            sourceMeta.direction === 'rtl' ? 'font-arabic' : 'font-serif-editorial'
                          }`}
                          dir={sourceMeta.direction}
                        >
                          {entry.headword}
                        </h3>

                        {entry.headwordScriptVariant && (
                          <span className="text-xs text-[#C47248] font-medium">
                            [{entry.headwordScriptVariant.text}]
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                        {entry.definition}
                      </p>

                      {targetEquivalent && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                          <span className="text-slate-400">Translation:</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {targetEquivalent.headword}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          audioService.speak(entry.headword, entry.sourceLang, entry.tonePattern);
                        }}
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Listen"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSave(entry.id);
                        }}
                        className="p-2 rounded-xl text-[#C47248] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                        title="Remove bookmark"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center bg-white dark:bg-[#15231D] rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
              <Bookmark className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No saved vocabulary in this filter
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1">
                Tap the bookmark icon on any dictionary word or search result to preserve it offline.
              </p>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2: COLLECTIONS --- */}
      {activeTab === 'collections' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Thematic and personalized study collections
            </span>
            <button
              onClick={() => setIsCreatingCollection(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1B382B] text-white flex items-center gap-1.5 hover:bg-[#142A20] cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Collection</span>
            </button>
          </div>

          {/* Create Collection Inline Form */}
          {isCreatingCollection && (
            <form
              onSubmit={handleCreateCollection}
              className="p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-[#204031] dark:border-[#7E9E88] shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Create Vocabulary Collection
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCreatingCollection(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Collection Name (e.g. Traditional Medicine & Botanicals)"
                  className="w-full h-10 px-3 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-[#204031]"
                  autoFocus
                />
              </div>

              <div>
                <textarea
                  value={newCollectionDesc}
                  onChange={(e) => setNewCollectionDesc(e.target.value)}
                  placeholder="Description or cultural notes…"
                  rows={2}
                  className="w-full p-3 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-[#204031]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreatingCollection(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newCollectionName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#1B382B] text-white hover:bg-[#142A20] disabled:opacity-50"
                >
                  Save Collection
                </button>
              </div>
            </form>
          )}

          {/* Collections List */}
          <div className="space-y-3">
            {collections.map((col) => (
              <div
                key={col.id}
                className="p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#D97753]" />
                      <span>{col.name}</span>
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      {col.wordIds.length} entries
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                    {col.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    {col.isCustom ? 'Custom User Folder' : 'Curated Editorial Set'}
                  </span>

                  <button
                    onClick={() => onNavigateToDictionary()}
                    className="text-xs font-semibold text-[#345E4C] dark:text-[#7E9E88] flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    <span>Browse Collection Words</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- TAB 3: SEARCH HISTORY --- */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Recent dictionary queries stored locally on your device
            </span>
            {recentSearches.length > 0 && (
              <button
                onClick={onClearRecentSearches}
                className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            )}
          </div>

          {recentSearches.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-[#15231D] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {recentSearches.map((term, idx) => (
                <div
                  key={idx}
                  onClick={() => onNavigateToDictionary(term)}
                  className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <History className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {term}
                    </span>
                  </div>

                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center bg-white dark:bg-[#15231D] rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
              <History className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No recent searches
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1">
                Searches you make in the dictionary will be listed here for rapid 1-tap re-lookup.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
