import React, { useState, useMemo, useRef, useEffect } from 'react';
import { LanguageCode, WordEntry } from '../types/dictionary';
import { LANGUAGES, LANGUAGE_LIST } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import {
  Search,
  ArrowRightLeft,
  Volume2,
  Bookmark,
  Sparkles,
  Filter,
  X,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
} from 'lucide-react';
import { audioService } from '../services/audioService';

interface DictionaryScreenProps {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
  onSelectWord: (word: WordEntry) => void;
  savedWordIds: string[];
  onToggleSave: (wordId: string) => void;
  initialQuery?: string;
  onRecordSearch: (term: string) => void;
}

export const DictionaryScreen: React.FC<DictionaryScreenProps> = ({
  sourceLang,
  targetLang,
  onSetLanguages,
  onSelectWord,
  savedWordIds,
  onToggleSave,
  initialQuery = '',
  onRecordSearch,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedPartOfSpeech, setSelectedPartOfSpeech] = useState<string>('all');
  const [selectedDialect, setSelectedDialect] = useState<string>('all');
  const [selectedLetter, setSelectedLetter] = useState<string>('all');
  const [isSwapping, setIsSwapping] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    setSelectedLetter('all');
  }, [sourceLang]);

  const sourceMeta = LANGUAGES[sourceLang];
  const targetMeta = LANGUAGES[targetLang];

  const handleSwapLanguages = () => {
    setIsSwapping(true);
    setTimeout(() => {
      onSetLanguages(targetLang, sourceLang);
      setIsSwapping(false);
    }, 180);
  };

  const handleInsertChar = (char: string) => {
    setQuery((prev) => prev + char);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const handleClearQuery = () => {
    setQuery('');
    setSelectedLetter('all');
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onRecordSearch(query.trim());
    }
  };

  // Letters available in the current source language dataset
  const availableLetters = useMemo(() => {
    const entries = dictionaryDb.getEntriesByLanguage(sourceLang);
    const letters = new Set<string>();
    for (const e of entries) {
      const cleanH = e.headword.replace(/^['"‘“\s]+/, '');
      if (cleanH.length > 0) {
        const first = cleanH.charAt(0).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (first && first.trim()) letters.add(first);
      }
    }
    return Array.from(letters).sort((a, b) => a.localeCompare(b));
  }, [sourceLang]);

  // Filter dictionary entries using robust MultilingualSearchEngine & dictionaryDb
  const filteredEntries = useMemo(() => {
    let results = dictionaryDb.search(query, sourceLang, targetLang, selectedPartOfSpeech);
    if (!query.trim() && selectedLetter !== 'all') {
      results = results.filter((e) => {
        const cleanH = e.headword.replace(/^['"‘“\s]+/, '');
        const first = cleanH.charAt(0).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return first === selectedLetter;
      });
    }
    return results;
  }, [query, sourceLang, targetLang, selectedPartOfSpeech, selectedLetter]);

  // Cross-language detection: check if the query exists in another language pack
  const crossLanguageMatch = useMemo(() => {
    if (!query.trim() || filteredEntries.length > 0) return null;
    const all = dictionaryDb.getAllEntries();
    const cleanQ = query.trim().toLowerCase();
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
  }, [query, filteredEntries, sourceLang]);

  // Check language pack availability
  const sourcePackCount = useMemo(() => {
    return dictionaryDb.getEntriesByLanguage(sourceLang).length;
  }, [sourceLang]);

  const partsOfSpeech = ['all', 'noun', 'verb', 'adjective', 'phrase'];

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Language Direction Control Bar */}
      <div className="bg-[#FAF8F5]/90 dark:bg-[#122019]/90 px-4 sm:px-6 py-3 border-b border-slate-200/80 dark:border-slate-800 transition-colors">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          {/* Source Language Picker */}
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Source Language
            </label>
            <div className="relative">
              <select
                value={sourceLang}
                onChange={(e) => onSetLanguages(e.target.value as LanguageCode, targetLang)}
                className="w-full h-11 pl-3 pr-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
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
              onClick={handleSwapLanguages}
              className={`w-11 h-11 rounded-xl bg-[#EEF4F0] dark:bg-[#1E3328] text-[#204031] dark:text-[#7E9E88] border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-[#E0EBE4] active:scale-95 transition-all cursor-pointer shadow-xs ${
                isSwapping ? 'rotate-180 duration-200' : ''
              }`}
              title="Swap source and target languages"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Target Language Picker */}
          <div className="flex-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Target Language
            </label>
            <div className="relative">
              <select
                value={targetLang}
                onChange={(e) => onSetLanguages(sourceLang, e.target.value as LanguageCode)}
                className="w-full h-11 pl-3 pr-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
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
      </div>

      {/* Main Search Bar & Diacritic Keyboard Strip */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 space-y-3">
        <form onSubmit={handleSearchSubmit} className="relative">
          <div className="relative flex items-center">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${sourceMeta.name} or ${targetMeta.name} (e.g., ${sourceMeta.sampleGreeting.word})…`}
              className={`w-full h-13 pl-12 pr-12 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#204031] dark:focus:border-[#7E9E88] shadow-sm transition-all ${
                sourceMeta.direction === 'rtl' ? 'font-arabic' : 'font-sans'
              }`}
              dir={sourceMeta.direction === 'rtl' && !query ? 'ltr' : undefined}
            />

            {query && (
              <button
                type="button"
                onClick={handleClearQuery}
                className="absolute right-3.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>

        {/* Specialized Diacritic Quick Insertion Bar */}
        {sourceMeta.specialChars && sourceMeta.specialChars.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1">
              {sourceMeta.code.toUpperCase()} Diacritics:
            </span>
            {sourceMeta.specialChars.map((char, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleInsertChar(char)}
                className="min-w-[32px] h-8 px-2 rounded-lg bg-white dark:bg-[#162720] border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-[#204031] dark:hover:border-[#7E9E88] transition-all cursor-pointer flex items-center justify-center shrink-0 active:scale-95"
              >
                {char}
              </button>
            ))}
          </div>
        )}

        {/* Filter Controls (Parts of speech & Dialects) */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            {partsOfSpeech.map((pos) => {
              const isActive = selectedPartOfSpeech === pos;
              return (
                <button
                  key={pos}
                  onClick={() => setSelectedPartOfSpeech(pos)}
                  className={`text-xs capitalize px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#1B382B] text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {pos === 'all' ? 'All Classes' : pos}
                </button>
              );
            })}
          </div>

          <div className="text-xs text-slate-500 shrink-0">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
          </div>
        </div>

        {/* Alphabet Browse Bar (when browsing without search query) */}
        {!query.trim() && availableLetters.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1.5 scrollbar-none text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1">
              Browse A–Z:
            </span>
            <button
              type="button"
              onClick={() => setSelectedLetter('all')}
              className={`h-7 px-2.5 rounded-lg font-semibold transition-all shrink-0 cursor-pointer ${
                selectedLetter === 'all'
                  ? 'bg-[#204031] text-white'
                  : 'bg-white dark:bg-[#162720] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              All
            </button>
            {availableLetters.map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => setSelectedLetter(letter)}
                className={`min-w-[28px] h-7 px-1.5 rounded-lg font-semibold transition-all shrink-0 cursor-pointer ${
                  selectedLetter === letter
                    ? 'bg-[#204031] text-white shadow-xs'
                    : 'bg-white dark:bg-[#162720] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-[#204031]'
                }`}
              >
                {letter}
              </button>
            ))}
          </div>
        )}

        {/* Results List */}
        <div className="space-y-3 pt-2">
          {filteredEntries.length > 0 ? (
            filteredEntries.map((entry) => {
              const isSaved = savedWordIds.includes(entry.id);
              const isDirectSource = entry.sourceLang === sourceLang;
              const targetEquivalents = isDirectSource
                ? entry.translations[targetLang] || []
                : entry.translations[sourceLang] || [];
              const equivalentLabel = isDirectSource
                ? `${targetMeta.name} Equivalent:`
                : `${sourceMeta.name} Equivalent:`;
              const equivalentDirection = isDirectSource ? targetMeta.direction : sourceMeta.direction;
              const entrySourceMeta = LANGUAGES[entry.sourceLang];

              return (
                <div
                  key={entry.id}
                  onClick={() => onSelectWord(entry)}
                  className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer group"
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
                          className={`text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50 ${
                            entrySourceMeta.direction === 'rtl'
                              ? 'font-arabic text-right'
                              : 'font-serif-editorial'
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

                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1.5 line-clamp-2 leading-relaxed">
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

                  {/* Target Language Translation Banner */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">
                        {equivalentLabel}
                      </span>
                      {targetEquivalents.length > 0 ? (
                        <span
                          className={`font-semibold text-slate-900 dark:text-slate-100 ${
                            equivalentDirection === 'rtl' ? 'font-arabic text-sm' : ''
                          }`}
                          dir={equivalentDirection}
                        >
                          {targetEquivalents[0].headword}
                          {targetEquivalents[0].transliteration && (
                            <span className="font-normal font-mono text-slate-500 ml-1">
                              [{targetEquivalents[0].transliteration}]
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">
                          Pack verified in {entrySourceMeta.name}
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      <span>View entry</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 px-4 text-center rounded-2xl bg-white dark:bg-[#15231D] border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
              <Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              {sourcePackCount === 0 ? (
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    No dictionary entries installed for {sourceMeta.name}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                    The {sourceMeta.name} pack is currently empty. Please switch to another source language.
                  </p>
                </div>
              ) : (
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Word not found for “{query}”
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                    No matching entry in {sourceMeta.name} → {targetMeta.name}. Check spelling or try a root form without diacritics.
                  </p>
                </div>
              )}

              {crossLanguageMatch && (
                <div className="mt-3 p-3.5 rounded-xl bg-[#EEF4F0] dark:bg-[#182C22] border border-[#204031]/20 max-w-md mx-auto text-left flex items-center justify-between gap-3">
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
                      setQuery(crossLanguageMatch.entry.headword);
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
      </div>
    </div>
  );
};
