import React, { useState } from 'react';
import { WordEntry, LanguageCode, Collection } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import { audioService } from '../services/audioService';
import {
  getUiCopy,
  formatText,
  getLangName,
  getLocalizedCollection,
} from '../i18n';
import {
  Bookmark,
  History,
  Trash2,
  Volume2,
  ArrowRight,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';

interface SavedScreenProps {
  interfaceLang: LanguageCode;
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
  interfaceLang,
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

  const copy = getUiCopy(interfaceLang);

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
      description: newCollectionDesc.trim() || copy.saved.defaultCollectionDesc,
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
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-serif-editorial text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Bookmark className="w-6 h-6 text-[#C47248] fill-current shrink-0" />
            <span>{copy.saved.title}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {copy.saved.subtitle}
          </p>
        </div>

        <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
          {formatText(copy.saved.savedWordsCount, { count: savedWordIds.length })}
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
          {formatText(copy.saved.bookmarkedWordsTab, { count: savedEntries.length })}
        </button>
        <button
          onClick={() => setActiveTab('collections')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'collections'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          {formatText(copy.saved.collectionsTab, { count: collections.length })}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          {copy.saved.historyTab}
        </button>
      </div>

      {/* --- TAB 1: BOOKMARKED WORDS --- */}
      {activeTab === 'words' && (
        <div className="space-y-4">
          {/* Language Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setSelectedLanguageFilter('all')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                selectedLanguageFilter === 'all'
                  ? 'bg-[#1B382B] text-white'
                  : 'bg-white dark:bg-[#15231D] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
              }`}
            >
              {copy.saved.allLanguages}
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
                {getLangName(lang.code, interfaceLang)}
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
                          {sourceMeta.code.toUpperCase()} · {getLangName(sourceMeta.code, interfaceLang)}
                        </span>
                        <span dir="ltr" className="text-xs text-slate-500 font-mono">{entry.ipa}</span>
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
                          <span className="text-slate-400">{copy.saved.translationPrefix}</span>
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
                        title={copy.common.listen}
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
                        title={copy.saved.removeBookmark}
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
                {copy.saved.noSavedTitle}
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1">
                {copy.saved.noSavedDesc}
              </p>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2: COLLECTIONS --- */}
      {activeTab === 'collections' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {copy.saved.collectionsSubtitle}
            </span>
            <button
              onClick={() => setIsCreatingCollection(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1B382B] text-white flex items-center gap-1.5 hover:bg-[#142A20] cursor-pointer shadow-xs shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{copy.saved.newCollection}</span>
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
                  {copy.saved.createCollectionTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCreatingCollection(false)}
                  className="text-slate-400 hover:text-slate-600"
                  title={copy.common.close}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder={copy.saved.collectionNamePlaceholder}
                  className="w-full h-10 px-3 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-[#204031]"
                  autoFocus
                />
              </div>

              <div>
                <textarea
                  value={newCollectionDesc}
                  onChange={(e) => setNewCollectionDesc(e.target.value)}
                  placeholder={copy.saved.collectionDescPlaceholder}
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
                  {copy.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!newCollectionName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#1B382B] text-white hover:bg-[#142A20] disabled:opacity-50"
                >
                  {copy.saved.saveCollection}
                </button>
              </div>
            </form>
          )}

          {/* Collections List */}
          <div className="space-y-3">
            {collections.map((col) => {
              const localizedCol = getLocalizedCollection(col, interfaceLang);
              return (
                <div
                  key={col.id}
                  className="p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#D97753]" />
                        <span>{localizedCol.name}</span>
                      </h3>
                      <span className="text-xs font-mono text-slate-500">
                        {formatText(copy.saved.entriesCount, { count: col.wordIds.length })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                      {localizedCol.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      {col.isCustom ? copy.saved.customUserFolder : copy.saved.curatedEditorialSet}
                    </span>

                    <button
                      onClick={() => onNavigateToDictionary()}
                      className="text-xs font-semibold text-[#345E4C] dark:text-[#7E9E88] flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <span>{copy.saved.browseCollectionWords}</span>
                      <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- TAB 3: SEARCH HISTORY --- */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {copy.saved.historySubtitle}
            </span>
            {recentSearches.length > 0 && (
              <button
                onClick={onClearRecentSearches}
                className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{copy.saved.clearHistory}</span>
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

                  <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center bg-white dark:bg-[#15231D] rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
              <History className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {copy.saved.noRecentSearches}
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1">
                {copy.saved.noRecentSearchesDesc}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
