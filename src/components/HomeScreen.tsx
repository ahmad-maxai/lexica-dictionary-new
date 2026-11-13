import React, { useState, useMemo, useRef } from 'react';
import {
  DictionaryMode,
  LanguageCode,
  WordEntry,
  StandardSearchResponse,
  MultilingualSearchResponse,
} from '../types/dictionary';
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
  BookOpen,
  Languages,
  AlertCircle,
} from 'lucide-react';

interface HomeScreenProps {
  interfaceLang: LanguageCode;
  dictionaryMode: DictionaryMode;
  onSetDictionaryMode: (mode: DictionaryMode) => void;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
  onNavigateToDictionary: (initialQuery?: string) => void;
  onNavigateToLibrary: () => void;
  onSelectWord: (word: WordEntry) => void;
  savedWordIds: string[];
  onToggleSave: (wordId: string) => void;
  recentSearches: string[];
  onOpenSettings: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  dictionaryMode,
  onSetDictionaryMode,
  sourceLang,
  targetLang,
  onSetLanguages,
  onNavigateToDictionary,
  onNavigateToLibrary,
  onSelectWord,
  savedWordIds,
  onToggleSave,
  recentSearches,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sourceMeta = LANGUAGES[sourceLang];
  const targetMeta = LANGUAGES[targetLang];

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

  // Engine 1: Standard Monolingual Search
  const standardResponse: StandardSearchResponse | null = useMemo(() => {
    if (dictionaryMode !== 'standard' || !searchQuery.trim()) return null;
    return dictionaryDb.searchStandard(searchQuery.trim(), sourceLang);
  }, [dictionaryMode, searchQuery, sourceLang]);

  // Engine 2: Multilingual Search
  const multilingualResponse: MultilingualSearchResponse | null = useMemo(() => {
    if (dictionaryMode !== 'multilingual' || !searchQuery.trim()) return null;
    return dictionaryDb.searchMultilingual(searchQuery.trim(), sourceLang, targetLang);
  }, [dictionaryMode, searchQuery, sourceLang, targetLang]);

  const activeResultCount =
    dictionaryMode === 'standard'
      ? standardResponse?.results.length || 0
      : multilingualResponse?.results.length || 0;

  // Cross-language detection when current search returns no results
  const crossLanguageMatch = useMemo(() => {
    if (!searchQuery.trim() || activeResultCount > 0) return null;
    const status = dictionaryMode === 'standard' ? standardResponse?.status : multilingualResponse?.status;
    if (status !== 'not_found') return null;

    const all = dictionaryDb.getAllEntries();
    const cleanQ = searchQuery.trim().toLowerCase();
    const otherEntry = all.find(
      (e) =>
        e.sourceLang !== sourceLang &&
        (e.headword.toLowerCase() === cleanQ || e.headword.toLowerCase().startsWith(cleanQ))
    );
    if (!otherEntry) return null;
    return {
      entry: otherEntry,
      lang: LANGUAGES[otherEntry.sourceLang],
    };
  }, [searchQuery, activeResultCount, dictionaryMode, standardResponse, multilingualResponse, sourceLang]);

  const languageShortcuts: Array<{ source: LanguageCode; target: LanguageCode; label: string }> = [
    { source: 'ha', target: 'en', label: 'Hausa ⇄ English' },
    { source: 'yo', target: 'en', label: 'Yoruba ⇄ English' },
    { source: 'ar', target: 'en', label: 'Arabic ⇄ English' },
    { source: 'ar', target: 'ha', label: 'العربية ⇄ Hausa' },
    { source: 'fr', target: 'en', label: 'Français ⇄ English' },
    { source: 'zh', target: 'en', label: '中文 ⇄ English' },
    { source: 'ff', target: 'en', label: 'Fulfulde ⇄ English' },
  ];

  const wotdEntry = useMemo(() => {
    return dictionaryDb.getEntryById(WORD_OF_THE_DAY?.id) || WORD_OF_THE_DAY;
  }, []);

  const isWordOfTheDaySaved = wotdEntry ? savedWordIds.includes(wotdEntry.id) : false;

  const currentStatus =
    dictionaryMode === 'standard' ? standardResponse?.status : multilingualResponse?.status;
  const currentMessage =
    dictionaryMode === 'standard' ? standardResponse?.message : multilingualResponse?.message;

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 transition-colors max-w-4xl mx-auto px-4 sm:px-6 pt-3 space-y-4">
      {/* 1. ENGINE MODE SWITCHER (Standard Monolingual vs Multilingual) */}
      <div
        role="tablist"
        aria-label="Dictionary Mode"
        className="grid grid-cols-2 p-1 rounded-2xl bg-[#EFECE5] dark:bg-[#13201A] border border-slate-200/80 dark:border-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={dictionaryMode === 'standard'}
          onClick={() => onSetDictionaryMode('standard')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            dictionaryMode === 'standard'
              ? 'bg-[#1B382B] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          <BookOpen className="w-4 h-4 shrink-0" />
          <span>Standard Dictionary</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={dictionaryMode === 'multilingual'}
          onClick={() => onSetDictionaryMode('multilingual')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            dictionaryMode === 'multilingual'
              ? 'bg-[#1B382B] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          <Languages className="w-4 h-4 shrink-0" />
          <span>Multilingual Dictionary</span>
        </button>
      </div>

      {/* 2. PRIMARY PROMINENT SEARCH FIELD */}
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
            placeholder={
              dictionaryMode === 'standard'
                ? `Search ${sourceMeta.name} definitions & forms…`
                : `Search ${sourceMeta.name} → ${targetMeta.name}…`
            }
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

      {/* 3. LANGUAGE SELECTOR(S) */}
      {dictionaryMode === 'standard' ? (
        <div className="bg-[#FAF8F5] dark:bg-[#13201A] p-2.5 sm:p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
            Dictionary Language
          </label>
          <div className="relative">
            <select
              value={sourceLang}
              onChange={(e) => onSetLanguages(e.target.value as LanguageCode, targetLang)}
              className="w-full h-10 pl-3 pr-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
            >
              {LANGUAGE_LIST.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} — {lang.nativeName} ({lang.code.toUpperCase()})
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* 4. LIVE SEARCH RESULTS */}
      {searchQuery.trim() !== '' && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>
              {dictionaryMode === 'standard' ? `${sourceMeta.name} Dictionary` : `${sourceMeta.name} → ${targetMeta.name}`} · “
              <strong className="text-slate-800 dark:text-slate-200">{searchQuery}</strong>”
            </span>
            <span>
              {activeResultCount} {activeResultCount === 1 ? 'match' : 'matches'}
            </span>
          </div>

          {/* STANDARD DICTIONARY RESULTS */}
          {dictionaryMode === 'standard' && standardResponse && standardResponse.results.length > 0 && (
            <div className="space-y-3">
              {standardResponse.results.map((item) => {
                const { entry, senses, morphologicalForms, matchedField, matchedTerm } = item;
                const isSaved = savedWordIds.includes(entry.id);
                const entryMeta = LANGUAGES[entry.sourceLang];

                return (
                  <div
                    key={entry.id}
                    onClick={() => onSelectWord(entry)}
                    className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]">
                            {entryMeta.code.toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {entry.ipa}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-xs italic text-slate-600 dark:text-slate-400">
                            {entry.partOfSpeech}
                          </span>
                          {matchedField === 'morphology' && (
                            <span className="text-[11px] text-[#C47248] dark:text-[#E28D70] font-medium">
                              · form: {matchedTerm}
                            </span>
                          )}
                          {matchedField === 'synonym' && (
                            <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium">
                              · synonym match: {matchedTerm}
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline gap-2.5">
                          <h3
                            className={`text-xl font-bold text-slate-900 dark:text-slate-50 ${
                              entryMeta.direction === 'rtl' ? 'font-arabic text-right' : 'font-serif-editorial'
                            }`}
                            dir={entryMeta.direction}
                          >
                            {entry.headword}
                          </h3>
                          {entry.headwordScriptVariant && (
                            <span className="text-xs text-[#C47248] dark:text-[#E28D70] font-medium">
                              [{entry.headwordScriptVariant.text}]
                            </span>
                          )}
                        </div>

                        <div className="mt-2 space-y-1">
                          {senses.slice(0, 2).map((sense) => (
                            <p
                              key={sense.id}
                              className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed"
                            >
                              {senses.length > 1 && (
                                <span className="font-semibold text-[#345E4C] dark:text-[#7E9E88] mr-1.5">
                                  {sense.senseNumber}.
                                </span>
                              )}
                              {sense.definition}
                            </p>
                          ))}
                        </div>

                        {(morphologicalForms.length > 0 || entry.synonyms.length > 0) && (
                          <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                            {morphologicalForms.length > 0 && (
                              <span>
                                Forms:{' '}
                                <span className="text-slate-800 dark:text-slate-200 font-medium">
                                  {morphologicalForms
                                    .slice(0, 2)
                                    .map((m) => `${m.form} (${m.label})`)
                                    .join(', ')}
                                </span>
                              </span>
                            )}
                            {entry.synonyms.length > 0 && (
                              <span>
                                Synonyms:{' '}
                                <span className="text-slate-800 dark:text-slate-200 font-medium">
                                  {entry.synonyms.slice(0, 3).join(', ')}
                                </span>
                              </span>
                            )}
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
                  </div>
                );
              })}
            </div>
          )}

          {/* MULTILINGUAL DICTIONARY RESULTS */}
          {dictionaryMode === 'multilingual' && multilingualResponse && multilingualResponse.results.length > 0 && (
            <div className="space-y-3">
              {multilingualResponse.results.map((item) => {
                const { entry, senseMatches, isReverseLookup } = item;
                const isSaved = savedWordIds.includes(entry.id);
                const entrySourceMeta = LANGUAGES[entry.sourceLang];
                const primaryMatch = senseMatches[0];
                const rel = primaryMatch?.relationship;
                const relTargetMeta = rel ? LANGUAGES[rel.targetLang] : targetMeta;

                return (
                  <div
                    key={entry.id}
                    onClick={() => onSelectWord(entry)}
                    className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
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
                          {isReverseLookup && (
                            <span className="text-[11px] font-medium text-[#C47248] dark:text-[#E28D70]">
                              · reverse match
                            </span>
                          )}
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
                          {primaryMatch?.sourceSense.definition || entry.definition}
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

                    {/* Sense-level Translation Relationship Strip */}
                    {rel && (
                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-slate-400">
                            {relTargetMeta.name} ({rel.equivalenceType}):
                          </span>
                          <span
                            className={`font-semibold text-slate-900 dark:text-slate-100 ${
                              relTargetMeta.direction === 'rtl' ? 'font-arabic text-sm' : ''
                            }`}
                            dir={relTargetMeta.direction}
                          >
                            {rel.targetHeadword}
                          </span>
                          {rel.transliteration && (
                            <span className="font-mono text-slate-500">[{rel.transliteration}]</span>
                          )}
                          {senseMatches.length > 1 && (
                            <span className="text-[11px] text-slate-400">
                              +{senseMatches.length - 1} more sense{senseMatches.length - 1 > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>

                        <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium flex items-center gap-1 shrink-0">
                          <span>Details</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* EXPLICIT EMPTY / ERROR STATES */}
          {activeResultCount === 0 && currentStatus && currentStatus !== 'ok' && currentStatus !== 'browse' && (
            <div className="py-8 px-4 text-center rounded-2xl bg-white dark:bg-[#15231D] border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
              {currentStatus === 'language_not_installed' || currentStatus === 'error' ? (
                <AlertCircle className="w-7 h-7 text-[#C47248] mx-auto" />
              ) : (
                <Search className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
              )}

              <div>
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {currentStatus === 'language_not_installed' && 'Language pack not installed'}
                  {currentStatus === 'invalid_pair' && 'Select two different languages'}
                  {currentStatus === 'no_definition' && 'No definition available'}
                  {currentStatus === 'no_translation' &&
                    `No translation available in ${targetMeta.name}`}
                  {currentStatus === 'not_found' &&
                    (dictionaryMode === 'standard'
                      ? `Word not found in ${sourceMeta.name}`
                      : `Word not found in ${sourceMeta.name} → ${targetMeta.name}`)}
                  {currentStatus === 'error' && 'Search failed'}
                </h4>

                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                  {currentMessage || `No matching record found for “${searchQuery}”.`}
                </p>
              </div>

              {currentStatus === 'language_not_installed' && (
                <button
                  type="button"
                  onClick={onNavigateToLibrary}
                  className="px-4 py-2 rounded-xl bg-[#1B382B] text-white text-xs font-semibold cursor-pointer hover:bg-[#142A20] transition-all"
                >
                  Open Language Library
                </button>
              )}

              {(currentStatus === 'invalid_pair' ||
                (currentStatus === 'no_translation' &&
                  multilingualResponse?.existsInStandardDictionary)) && (
                <button
                  type="button"
                  onClick={() => onSetDictionaryMode('standard')}
                  className="px-4 py-2 rounded-xl bg-[#1B382B] text-white text-xs font-semibold cursor-pointer hover:bg-[#142A20] transition-all"
                >
                  View in {sourceMeta.name} Standard Dictionary
                </button>
              )}

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
              <span>Explore senses, forms, and language connections</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      )}

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
