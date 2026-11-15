import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  DictionaryMode,
  LanguageCode,
  WordEntry,
  StandardSearchResponse,
  MultilingualSearchResponse,
} from '../types/dictionary';
import { LANGUAGES, LANGUAGE_LIST } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import {
  getUiCopy,
  formatText,
  getLangName,
  getLocalizedPos,
  getLocalizedEquivalence,
} from '../i18n';
import {
  Search,
  ArrowRightLeft,
  Volume2,
  Bookmark,
  X,
  ChevronDown,
  ArrowRight,
  BookOpen,
  Languages,
  AlertCircle,
} from 'lucide-react';
import { audioService } from '../services/audioService';

interface DictionaryScreenProps {
  interfaceLang: LanguageCode;
  dictionaryMode: DictionaryMode;
  onSetDictionaryMode: (mode: DictionaryMode) => void;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
  onNavigateToLibrary: () => void;
  onSelectWord: (word: WordEntry) => void;
  savedWordIds: string[];
  onToggleSave: (wordId: string) => void;
  initialQuery?: string;
  onRecordSearch: (term: string) => void;
}

export const DictionaryScreen: React.FC<DictionaryScreenProps> = ({
  interfaceLang,
  dictionaryMode,
  onSetDictionaryMode,
  sourceLang,
  targetLang,
  onSetLanguages,
  onNavigateToLibrary,
  onSelectWord,
  savedWordIds,
  onToggleSave,
  initialQuery = '',
  onRecordSearch,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedPartOfSpeech, setSelectedPartOfSpeech] = useState<string>('all');
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
  }, [sourceLang, dictionaryMode]);

  const copy = getUiCopy(interfaceLang);
  const sourceMeta = LANGUAGES[sourceLang];
  const sourceName = getLangName(sourceLang, interfaceLang);
  const targetName = getLangName(targetLang, interfaceLang);

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

  // Execute Engine 1 (Standard) OR Engine 2 (Multilingual)
  const standardResponse: StandardSearchResponse | null = useMemo(() => {
    if (dictionaryMode !== 'standard') return null;
    return dictionaryDb.searchStandard(query, sourceLang, {
      partOfSpeech: selectedPartOfSpeech,
      letter: selectedLetter,
    });
  }, [dictionaryMode, query, sourceLang, selectedPartOfSpeech, selectedLetter]);

  const multilingualResponse: MultilingualSearchResponse | null = useMemo(() => {
    if (dictionaryMode !== 'multilingual') return null;
    return dictionaryDb.searchMultilingual(query, sourceLang, targetLang, {
      partOfSpeech: selectedPartOfSpeech,
      letter: selectedLetter,
    });
  }, [dictionaryMode, query, sourceLang, targetLang, selectedPartOfSpeech, selectedLetter]);

  const activeCount =
    dictionaryMode === 'standard'
      ? standardResponse?.results.length || 0
      : multilingualResponse?.results.length || 0;

  const activeStatus =
    dictionaryMode === 'standard' ? standardResponse?.status : multilingualResponse?.status;

  // Cross-language suggestion when current search yields not_found
  const crossLanguageMatch = useMemo(() => {
    if (!query.trim() || activeCount > 0 || activeStatus !== 'not_found') return null;
    const all = dictionaryDb.getAllEntries();
    const cleanQ = query.trim().toLowerCase();
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
  }, [query, activeCount, activeStatus, sourceLang]);

  const partsOfSpeech = ['all', 'noun', 'verb', 'adjective', 'phrase'];

  const getLocalizedStatusCopy = () => {
    switch (activeStatus) {
      case 'language_not_installed':
        return {
          title: copy.statuses.language_not_installed_title,
          desc: copy.statuses.language_not_installed_desc,
        };
      case 'invalid_pair':
        return {
          title: copy.statuses.invalid_pair_dict_title,
          desc: copy.statuses.invalid_pair_desc,
        };
      case 'no_definition':
        return {
          title: copy.statuses.no_definition_title,
          desc: copy.statuses.no_definition_desc,
        };
      case 'no_translation':
        return {
          title: formatText(copy.statuses.no_translation_title, { target: targetName }),
          desc: formatText(copy.statuses.no_translation_desc, {
            source: sourceName,
            target: targetName,
          }),
        };
      case 'not_found':
        return {
          title: formatText(copy.statuses.not_found_dict, { query }),
          desc: formatText(copy.statuses.not_found_desc, { query }),
        };
      case 'error':
        return {
          title: copy.statuses.error_title,
          desc: copy.statuses.error_desc,
        };
      case 'browse':
      default:
        return {
          title: formatText(copy.statuses.browse_empty_title, { source: sourceName }),
          desc: copy.statuses.browse_empty_desc,
        };
    }
  };

  const localizedStatus = getLocalizedStatusCopy();

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Mode & Language Control Bar */}
      <div className="bg-[#FAF8F5]/90 dark:bg-[#122019]/90 px-4 sm:px-6 py-3 border-b border-slate-200/80 dark:border-slate-800 transition-colors">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Engine Mode Switcher */}
          <div
            role="tablist"
            aria-label={copy.modes.standard}
            className="grid grid-cols-2 p-1 rounded-xl bg-[#EFECE5] dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800"
          >
            <button
              type="button"
              role="tab"
              aria-selected={dictionaryMode === 'standard'}
              onClick={() => onSetDictionaryMode('standard')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dictionaryMode === 'standard'
                  ? 'bg-[#1B382B] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>{copy.modes.standard}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={dictionaryMode === 'multilingual'}
              onClick={() => onSetDictionaryMode('multilingual')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dictionaryMode === 'multilingual'
                  ? 'bg-[#1B382B] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Languages className="w-3.5 h-3.5 shrink-0" />
              <span>{copy.modes.multilingual}</span>
            </button>
          </div>

          {/* Language Selector(s) */}
          {dictionaryMode === 'standard' ? (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                {copy.search.dictionaryLanguage}
              </label>
              <div className="relative">
                <select
                  value={sourceLang}
                  onChange={(e) => onSetLanguages(e.target.value as LanguageCode, targetLang)}
                  className="w-full h-11 ps-3 pe-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
                >
                  {LANGUAGE_LIST.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {getLangName(lang.code, interfaceLang)} — {lang.nativeName} ({lang.code.toUpperCase()})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {/* Source Language Picker */}
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  {copy.search.sourceLanguage}
                </label>
                <div className="relative">
                  <select
                    value={sourceLang}
                    onChange={(e) => onSetLanguages(e.target.value as LanguageCode, targetLang)}
                    className="w-full h-11 ps-3 pe-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
                  >
                    {LANGUAGE_LIST.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {getLangName(lang.code, interfaceLang)} ({lang.code.toUpperCase()})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                  title={copy.search.swapSourceTarget}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
              </div>

              {/* Target Language Picker */}
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  {copy.search.targetLanguage}
                </label>
                <div className="relative">
                  <select
                    value={targetLang}
                    onChange={(e) => onSetLanguages(sourceLang, e.target.value as LanguageCode)}
                    className="w-full h-11 ps-3 pe-8 rounded-xl bg-white dark:bg-[#172B22] border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#204031]"
                  >
                    {LANGUAGE_LIST.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {getLangName(lang.code, interfaceLang)} ({lang.code.toUpperCase()})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Search Bar & Diacritic Keyboard Strip */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 space-y-3">
        <form onSubmit={handleSearchSubmit} className="relative">
          <div className="relative flex items-center">
            <Search className="w-5 h-5 text-slate-400 absolute start-4 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                dictionaryMode === 'standard'
                  ? formatText(copy.search.dictStandardPlaceholder, {
                      lang: sourceName,
                      sample: sourceMeta.sampleGreeting.word,
                    })
                  : formatText(copy.search.dictMultilingualPlaceholder, {
                      src: sourceName,
                      tgt: targetName,
                      sample: sourceMeta.sampleGreeting.word,
                    })
              }
              className={`w-full h-13 ps-12 pe-12 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 text-sm sm:text-base font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#204031] dark:focus:border-[#7E9E88] shadow-sm transition-all ${
                sourceMeta.direction === 'rtl' ? 'font-arabic' : 'font-sans'
              }`}
              dir={!query ? (interfaceLang === 'ar' ? 'rtl' : 'ltr') : sourceMeta.direction}
            />

            {query && (
              <button
                type="button"
                onClick={handleClearQuery}
                className="absolute end-3.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title={copy.common.clearSearch}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>

        {/* Specialized Diacritic Quick Insertion Bar */}
        {sourceMeta.specialChars && sourceMeta.specialChars.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 me-1">
              {formatText(copy.search.diacriticsLabel, { code: sourceMeta.code.toUpperCase() })}
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

        {/* Filter Controls */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
            {partsOfSpeech.map((pos) => {
              const isActive = selectedPartOfSpeech === pos;
              return (
                <button
                  key={pos}
                  onClick={() => setSelectedPartOfSpeech(pos)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#1B382B] text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {pos === 'all' ? copy.search.allClasses : getLocalizedPos(pos, interfaceLang)}
                </button>
              );
            })}
          </div>

          <div className="text-xs text-slate-500 shrink-0 tabular-nums">
            {activeCount} {activeCount === 1 ? copy.search.entrySingular : copy.search.entryPlural}
          </div>
        </div>

        {/* Alphabet Browse Bar */}
        {!query.trim() && availableLetters.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1.5 scrollbar-none text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 me-1">
              {copy.search.browseAZ}
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
              {copy.common.all}
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
          {/* STANDARD ENGINE RESULTS */}
          {dictionaryMode === 'standard' && standardResponse && standardResponse.results.length > 0 && (
            standardResponse.results.map((item) => {
              const { entry, senses, morphologicalForms, matchedField, matchedTerm } = item;
              const isSaved = savedWordIds.includes(entry.id);
              const entryMeta = LANGUAGES[entry.sourceLang];

              return (
                <div
                  key={entry.id}
                  onClick={() => onSelectWord(entry)}
                  className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]">
                          {entryMeta.code.toUpperCase()}
                        </span>
                        <span dir="ltr" className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {entry.ipa}
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="text-xs italic text-slate-600 dark:text-slate-400">
                          {getLocalizedPos(entry.partOfSpeech, interfaceLang)}
                        </span>
                        {matchedField === 'morphology' && (
                          <span className="text-[11px] text-[#C47248] dark:text-[#E28D70] font-medium">
                            {copy.search.formLabel} {matchedTerm}
                          </span>
                        )}
                        {matchedField === 'synonym' && (
                          <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium">
                            {copy.search.synonymShortLabel} {matchedTerm}
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-2.5">
                        <h3
                          className={`text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-50 ${
                            entryMeta.direction === 'rtl'
                              ? 'font-arabic text-right'
                              : 'font-serif-editorial'
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
                              <span className="font-semibold text-[#345E4C] dark:text-[#7E9E88] me-1.5">
                                {sense.senseNumber}.
                              </span>
                            )}
                            {sense.definition}
                          </p>
                        ))}
                      </div>
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
                        className={`p-2 rounded-xl transition-colors ${
                          isSaved
                            ? 'text-[#C47248] bg-[#FAF2ED] dark:bg-[#301F17]'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                        title={isSaved ? copy.common.saved : copy.common.saveWord}
                      >
                        <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Monolingual Metadata Footer (Forms, Synonyms, Detail Link) */}
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 dark:text-slate-400">
                      {morphologicalForms.length > 0 && (
                        <span>
                          {copy.search.formsPrefix}{' '}
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
                          {copy.search.synonymsPrefix}{' '}
                          <span className="text-slate-800 dark:text-slate-200 font-medium">
                            {entry.synonyms.slice(0, 3).join(', ')}
                          </span>
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium flex items-center gap-1 ms-auto">
                      <span>{copy.common.viewEntry}</span>
                      <ArrowRight className="w-3 h-3 rtl:rotate-180" />
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {/* MULTILINGUAL ENGINE RESULTS */}
          {dictionaryMode === 'multilingual' && multilingualResponse && multilingualResponse.results.length > 0 && (
            multilingualResponse.results.map((item) => {
              const { entry, senseMatches, isReverseLookup } = item;
              const isSaved = savedWordIds.includes(entry.id);
              const entrySourceMeta = LANGUAGES[entry.sourceLang];
              const primaryMatch = senseMatches[0];
              const rel = primaryMatch?.relationship;
              const relTargetMeta = rel ? LANGUAGES[rel.targetLang] : LANGUAGES[targetLang];

              return (
                <div
                  key={entry.id}
                  onClick={() => onSelectWord(entry)}
                  className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 hover:border-[#204031] dark:hover:border-[#7E9E88] shadow-xs hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]">
                          {entrySourceMeta.code.toUpperCase()}
                        </span>
                        <span dir="ltr" className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {entry.ipa}
                        </span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="text-xs italic text-slate-600 dark:text-slate-400">
                          {getLocalizedPos(entry.partOfSpeech, interfaceLang)}
                        </span>
                        {isReverseLookup && (
                          <span className="text-[11px] font-medium text-[#C47248] dark:text-[#E28D70]">
                            {copy.search.reverseMatch}
                          </span>
                        )}
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
                        className={`p-2 rounded-xl transition-colors ${
                          isSaved
                            ? 'text-[#C47248] bg-[#FAF2ED] dark:bg-[#301F17]'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                        title={isSaved ? copy.common.saved : copy.common.saveWord}
                      >
                        <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Target Language Sense Translation Banner */}
                  {rel && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                        <span className="text-slate-400">
                          {getLangName(relTargetMeta.code, interfaceLang)} (
                          {getLocalizedEquivalence(rel.equivalenceType, interfaceLang)}):
                        </span>
                        <span
                          className={`font-semibold text-slate-900 dark:text-slate-100 ${
                            relTargetMeta.direction === 'rtl' ? 'font-arabic text-sm' : ''
                          }`}
                          dir={relTargetMeta.direction}
                        >
                          {rel.targetHeadword}
                          {rel.transliteration && (
                            <span dir="ltr" className="font-normal font-mono text-slate-500 ms-1">
                              [{rel.transliteration}]
                            </span>
                          )}
                        </span>
                        {rel.contextualNote && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            — {rel.contextualNote}
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] font-medium flex items-center gap-1 shrink-0 group-hover:translate-x-0.5 transition-transform">
                        <span>{copy.common.viewEntry}</span>
                        <ArrowRight className="w-3 h-3 rtl:rotate-180" />
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* EMPTY / FAILURE STATE */}
          {activeCount === 0 && (
            <div className="py-12 px-4 text-center rounded-2xl bg-white dark:bg-[#15231D] border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
              {activeStatus === 'language_not_installed' || activeStatus === 'error' ? (
                <AlertCircle className="w-8 h-8 text-[#C47248] mx-auto" />
              ) : (
                <Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              )}

              <div>
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {localizedStatus.title}
                </h4>

                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                  {localizedStatus.desc}
                </p>
              </div>

              {activeStatus === 'language_not_installed' && (
                <button
                  type="button"
                  onClick={onNavigateToLibrary}
                  className="px-4 py-2 rounded-xl bg-[#1B382B] text-white text-xs font-semibold cursor-pointer hover:bg-[#142A20] transition-all"
                >
                  {copy.statuses.openLanguageLibrary}
                </button>
              )}

              {(activeStatus === 'invalid_pair' ||
                (activeStatus === 'no_translation' &&
                  multilingualResponse?.existsInStandardDictionary)) && (
                <button
                  type="button"
                  onClick={() => onSetDictionaryMode('standard')}
                  className="px-4 py-2 rounded-xl bg-[#1B382B] text-white text-xs font-semibold cursor-pointer hover:bg-[#142A20] transition-all"
                >
                  {formatText(copy.statuses.switchToStandardDict, { lang: sourceName })}
                </button>
              )}

              {crossLanguageMatch && (
                <div className="mt-3 p-3.5 rounded-xl bg-[#EEF4F0] dark:bg-[#182C22] border border-[#204031]/20 max-w-md mx-auto text-start flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-[#204031] dark:text-[#7E9E88] uppercase tracking-wider block">
                      {copy.statuses.foundInAnotherLang}
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {formatText(copy.statuses.existsInLang, {
                        word: crossLanguageMatch.entry.headword,
                        lang: getLangName(crossLanguageMatch.lang.code, interfaceLang),
                      })}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      onSetLanguages(crossLanguageMatch.entry.sourceLang, targetLang);
                      setQuery(crossLanguageMatch.entry.headword);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#204031] text-white text-xs font-semibold shrink-0 cursor-pointer hover:bg-[#152B21] transition-all"
                  >
                    {formatText(copy.statuses.switchToLang, {
                      lang: getLangName(crossLanguageMatch.lang.code, interfaceLang),
                    })}
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
