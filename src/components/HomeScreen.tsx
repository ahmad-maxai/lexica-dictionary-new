import React, { useState, useMemo, useRef } from 'react';
import { LanguageCode, WordEntry } from '../types/dictionary';
import { LANGUAGES, LANGUAGE_LIST } from '../data/languages';
import { WORD_OF_THE_DAY, CURATED_COLLECTIONS } from '../data/dictionaryData';
import { dictionaryDb } from '../services/dictionaryDatabase';
import { audioService } from '../services/audioService';
import {
  Search,
  ArrowRightLeft,
  Volume2,
  Bookmark,
  Sparkles,
  ArrowRight,
  History,
  Compass,
  X,
  ChevronDown,
  Settings,
} from 'lucide-react';

interface HomeScreenProps {
  interfaceLang: LanguageCode;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
  onNavigateToDictionary: (initialQuery?: string) => void;
  onSelectWord: (word: WordEntry) => void;
  savedWordIds: string[];
  onToggleSave: (wordId: string) => void;
  recentSearches: string[];
  onOpenSettings: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  interfaceLang,
  sourceLang,
  targetLang,
  onSetLanguages,
  onNavigateToDictionary,
  onSelectWord,
  savedWordIds,
  onToggleSave,
  recentSearches,
  onOpenSettings,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sourceMeta = LANGUAGES[sourceLang];
  const targetMeta = LANGUAGES[targetLang];
  const interfaceMeta = LANGUAGES[interfaceLang];

  const handleSwap = () => {
    setIsSwapping(true);
    setTimeout(() => {
      onSetLanguages(targetLang, sourceLang);
      setIsSwapping(false);
    }, 180);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // Perform live search when the user types directly on the Home Screen
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return dictionaryDb.search(searchQuery.trim(), sourceLang, targetLang);
  }, [searchQuery, sourceLang, targetLang]);

  // Cross-language detection: check if the query exists in another language pack
  const crossLanguageMatch = useMemo(() => {
    if (!searchQuery.trim() || searchResults.length > 0) return null;
    const all = dictionaryDb.getAllEntries();
    const cleanQ = searchQuery.trim().toLowerCase();
    const otherEntry = all.find(
      (e) =>
        e.sourceLang !== sourceLang &&
        (e.headword.toLowerCase() === cleanQ ||
          e.headword.toLowerCase().startsWith(cleanQ))
    );
    if (!otherEntry) return null;
    return {
      entry: otherEntry,
      lang: LANGUAGES[otherEntry.sourceLang],
    };
  }, [searchQuery, searchResults, sourceLang]);

  // Popular cross-language shortcuts
  const languageShortcuts: Array<{ source: LanguageCode; target: LanguageCode; label: string }> = [
    { source: 'ha', target: 'en', label: 'Hausa ⇄ English' },
    { source: 'yo', target: 'en', label: 'Yoruba ⇄ English' },
    { source: 'ar', target: 'en', label: 'Arabic ⇄ English' },
    { source: 'ar', target: 'ha', label: 'العربية ⇄ Hausa' },
    { source: 'fr', target: 'en', label: 'Français ⇄ English' },
    { source: 'zh', target: 'en', label: '中文 ⇄ English' },
    { source: 'ff', target: 'en', label: 'Fulfulde ⇄ English' },
  ];

  // Resolve Word of the Day safely from local database or fallback
  const wotdEntry = useMemo(() => {
    return dictionaryDb.getEntryById(WORD_OF_THE_DAY?.id) || WORD_OF_THE_DAY;
  }, []);

  const isWordOfTheDaySaved = wotdEntry ? savedWordIds.includes(wotdEntry.id) : false;

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 transition-colors max-w-4xl mx-auto px-4 sm:px-6 pt-3 space-y-4">
      {/* 1. PRIMARY PROMINENT SEARCH FIELD (Main Visual Action) */}
      <div className="bg-white dark:bg-[#15231D] rounded-2xl p-2 sm:p-2.5 shadow-md shadow-black/5 border-2 border-[#204031]/20 dark:border-[#7E9E88]/30 focus-within:border-[#204031] dark:focus-within:border-[#7E9E88] transition-all">
        <div className="relative flex items-center">
          <div className="w-10 h-10 rounded-xl bg-[#EEF4F0] dark:bg-[#1E3328] text-[#204031] dark:text-[#7E9E88] flex items-center justify-center shrink-0 ml-1">
            <Search className="w-5 h-5" />
          </div>

          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter a word to search..."
            className="w-full h-12 sm:h-14 px-3.5 text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 bg-transparent focus:outline-none"
            dir={sourceMeta.direction === 'rtl' && !searchQuery ? 'ltr' : undefined}
          />

          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 mr-1 transition-colors cursor-pointer"
              title="Clear search"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* 3. SOURCE & TARGET LANGUAGE SELECTORS */}
      <div className="bg-[#FAF8F5] dark:bg-[#13201A] p-2.5 sm:p-3 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shadow-xs">
        {/* Source Language Picker */}
        <div className="flex-1 relative">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
            Source Language
          </label>
          <div className="relative">
            <select
              value={sourceLang}
              onChange={(e) => onSetLanguages(e.target.value as LanguageCode, targetLang)}
              className="w-full h-10 pl-3 pr-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
            >
              {LANGUAGE_LIST.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code.toUpperCase()})
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Swap Button */}
        <div className="shrink-0 pt-4">
          <button
            type="button"
            onClick={handleSwap}
            className={`w-10 h-10 rounded-xl bg-white dark:bg-[#1E3328] text-[#204031] dark:text-[#7E9E88] border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-[#EEF4F0] active:scale-95 transition-all cursor-pointer shadow-xs ${
              isSwapping ? 'rotate-180 duration-200' : ''
            }`}
            title="Swap languages"
          >
            <ArrowRightLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Target Language Picker */}
        <div className="flex-1 relative">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
            Target Language
          </label>
          <div className="relative">
            <select
              value={targetLang}
              onChange={(e) => onSetLanguages(sourceLang, e.target.value as LanguageCode)}
              className="w-full h-10 pl-3 pr-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
            >
              {LANGUAGE_LIST.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code.toUpperCase()})
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Quick Language Pair Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 mr-1">
          Quick pairs:
        </span>
        {languageShortcuts.map((pair, idx) => {
          const isActive = sourceLang === pair.source && targetLang === pair.target;
          return (
            <button
              key={idx}
              onClick={() => onSetLanguages(pair.source, pair.target)}
              className={`text-xs font-medium px-3 py-1.5 rounded-xl whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[#1B382B] text-white shadow-xs'
                  : 'bg-white dark:bg-[#15231D] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              {pair.label}
            </button>
          );
        })}
      </div>

      {/* 4. LIVE SEARCH RESULTS (Immediately Below Search Field) */}
      {searchQuery.trim() !== '' && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              Search Results for “<strong className="text-slate-800 dark:text-slate-200">{searchQuery}</strong>”
            </span>
            <span>{searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}</span>
          </div>

          {searchResults.length > 0 ? (
            <div className="space-y-3">
              {searchResults.map((entry) => {
                const isSaved = savedWordIds.includes(entry.id);
                const isDirectSource = entry.sourceLang === sourceLang;
                const targetEquivalents = isDirectSource
                  ? entry.translations[targetLang] || []
                  : entry.translations[sourceLang] || [];
                const entrySourceMeta = LANGUAGES[entry.sourceLang];

                return (
                  <div
                    key={entry.id}
                    onClick={() => onSelectWord(entry)}
                    className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]">
                            {entrySourceMeta.code.toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {entry.ipa}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-xs italic text-slate-600 dark:text-slate-400">
                            {entry.partOfSpeech}
                          </span>
                        </div>

                        <div className="flex items-baseline gap-2.5">
                          <h3
                            className={`text-xl font-bold text-slate-900 dark:text-slate-50 ${
                              entrySourceMeta.direction === 'rtl' ? 'font-arabic text-right' : 'font-serif-editorial'
                            }`}
                            dir={entrySourceMeta.direction}
                          >
                            {entry.headword}
                          </h3>

                          {entry.headwordScriptVariant && (
                            <span className="text-xs text-[#C47248] dark:text-[#E28D70] font-medium">
                              [{entry.headwordScriptVariant.text}]
                            </span>
                          )}
                        </div>

                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                          {entry.definition}
                        </p>
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
                          className={`p-2 rounded-xl transition-colors ${
                            isSaved
                              ? 'text-[#C47248] bg-[#FAF2ED] dark:bg-[#301F17]'
                              : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                          title={isSaved ? 'Saved' : 'Save word'}
                        >
                          <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    </div>

                    {/* Equivalent Translation Strip */}
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">
                          {targetMeta.name} Equivalent:
                        </span>
                        {targetEquivalents.length > 0 ? (
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {targetEquivalents[0].headword}
                            {targetEquivalents[0].transliteration && (
                              <span className="font-normal font-mono text-slate-500 ml-1">
                                [{targetEquivalents[0].transliteration}]
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No direct translation found</span>
                        )}
                      </div>

                      <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        <span>Details</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 px-4 text-center rounded-2xl bg-white dark:bg-[#15231D] border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
              <Search className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
              <div>
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Word not found in {sourceMeta.name} → {targetMeta.name}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                  No verified entry for “{searchQuery}” in the current language pair.
                </p>
              </div>

              {/* Cross-language suggestion if word exists in another language */}
              {crossLanguageMatch && (
                <div className="mt-3 p-3 rounded-xl bg-[#EEF4F0] dark:bg-[#182C22] border border-[#204031]/20 max-w-md mx-auto text-left flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-[#204031] dark:text-[#7E9E88] uppercase tracking-wider block">
                      Found in another language
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      “{crossLanguageMatch.entry.headword}” exists in {crossLanguageMatch.lang.name}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      onSetLanguages(crossLanguageMatch.entry.sourceLang, targetLang);
                      setSearchQuery(crossLanguageMatch.entry.headword);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#204031] text-white text-xs font-semibold shrink-0 cursor-pointer hover:bg-[#152B21] transition-all"
                  >
                    Switch to {crossLanguageMatch.lang.name}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. SECONDARY FEATURES (Recent searches, Word of the Day, Collections) */}
      {/* Recent Searches */}
      {recentSearches && recentSearches.length > 0 && searchQuery.trim() === '' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-400" />
              <span>Recent Lookups</span>
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {recentSearches.map((term, idx) => (
              <button
                key={idx}
                onClick={() => setSearchQuery(term)}
                className="text-xs px-3 py-1.5 rounded-xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 cursor-pointer flex items-center gap-1.5 transition-all shadow-2xs"
              >
                <Search className="w-3 h-3 text-slate-400" />
                <span>{term}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Word of the Day Feature Card */}
      {wotdEntry && searchQuery.trim() === '' && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#D97753]" />
              <span>Word of the Day</span>
            </h2>
          </div>

          <div
            onClick={() => onSelectWord(wotdEntry)}
            className="bg-white dark:bg-[#15231D] rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#FAF2ED] dark:bg-[#2B1B14] text-[#C47248] uppercase">
                    {LANGUAGES[wotdEntry.sourceLang]?.name}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">{wotdEntry.ipa}</span>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="text-xs italic text-slate-600 dark:text-slate-400">
                    {wotdEntry.partOfSpeech}
                  </span>
                </div>

                <div className="flex items-baseline gap-3">
                  <h3 className="font-serif-editorial text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50 group-hover:text-[#204031] dark:group-hover:text-[#7E9E88] transition-colors">
                    {wotdEntry.headword}
                  </h3>
                  {wotdEntry.headwordScriptVariant && (
                    <span className="text-xs text-[#C47248] dark:text-[#E28D70] font-medium">
                      [{wotdEntry.headwordScriptVariant.text}]
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    audioService.speak(wotdEntry.headword, wotdEntry.sourceLang, wotdEntry.tonePattern);
                  }}
                  className="p-2.5 rounded-full text-slate-400 hover:text-slate-600 bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
                  title="Pronounce"
                >
                  <Volume2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSave(wotdEntry.id);
                  }}
                  className={`p-2.5 rounded-full transition-colors cursor-pointer ${
                    isWordOfTheDaySaved
                      ? 'text-[#C47248] bg-[#FAF2ED] dark:bg-[#301F17]'
                      : 'text-slate-400 hover:text-slate-600 bg-slate-100 dark:bg-slate-800'
                  }`}
                  title={isWordOfTheDaySaved ? 'Saved' : 'Save word'}
                >
                  <Bookmark className={`w-4 h-4 ${isWordOfTheDaySaved ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-300 mt-2.5 leading-relaxed">
              {wotdEntry.definition}
            </p>

            <div className="mt-3.5 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-[#345E4C] dark:text-[#7E9E88] font-medium">
              <span>Explore etymology and multilingual connections</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      )}

      {/* Curated Cultural Collections */}
      {searchQuery.trim() === '' && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-[#345E4C] dark:text-[#7E9E88]" />
              <span>Cultural Vocabulary Collections</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CURATED_COLLECTIONS.map((col) => (
              <div
                key={col.id}
                onClick={() => onNavigateToDictionary()}
                className="bg-white dark:bg-[#15231D] p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] transition-all cursor-pointer shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {col.name}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {col.description}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium">
                  <span>{col.wordIds.length} Curated Concepts</span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
