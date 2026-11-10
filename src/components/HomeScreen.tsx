import React from 'react';
import { LanguageCode, WordEntry } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import { DICTIONARY_ENTRIES, WORD_OF_THE_DAY, CURATED_COLLECTIONS } from '../data/dictionaryData';
import { ArtworkBanner } from './ArtworkBanner';
import {
  Search,
  ArrowRightLeft,
  Volume2,
  Bookmark,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  History,
  Compass,
  Smartphone,
  HardDriveDownload,
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
  const sourceMeta = LANGUAGES[sourceLang];
  const targetMeta = LANGUAGES[targetLang];
  const interfaceMeta = LANGUAGES[interfaceLang];

  const isWordOfTheDaySaved = savedWordIds.includes(WORD_OF_THE_DAY.id);

  // Popular cross-language shortcuts
  const languageShortcuts: Array<{ source: LanguageCode; target: LanguageCode; label: string }> = [
    { source: 'ha', target: 'en', label: 'Hausa ⇄ English' },
    { source: 'yo', target: 'en', label: 'Yoruba ⇄ English' },
    { source: 'ff', target: 'fr', label: 'Fulfulde ⇄ Français' },
    { source: 'ar', target: 'ha', label: 'العربية ⇄ Hausa' },
    { source: 'zh', target: 'en', label: '中文 ⇄ English' },
    { source: 'fr', target: 'yo', label: 'Français ⇄ Yoruba' },
  ];

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Editorial Hero Artwork Banner */}
      <div className="relative">
        <ArtworkBanner language={sourceLang} variant="hero" />

        {/* Floating Top Info Overlay */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/15 text-white">
            <span className="w-2 h-2 rounded-full bg-[#7E9E88]" />
            <span className="text-xs font-semibold tracking-wide">
              {sourceMeta.name} ⇄ {targetMeta.name}
            </span>
          </div>

          <button
            onClick={onOpenSettings}
            className="text-xs font-medium bg-black/30 hover:bg-black/45 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15 text-white/90 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>UI: {interfaceMeta.name}</span>
          </button>
        </div>

        {/* Hero Title & Identity on Artwork */}
        <div className="absolute bottom-6 left-5 right-5 z-10 text-white">
          <div className="flex items-center gap-1.5 text-xs text-[#E5B59D] font-medium tracking-wider uppercase mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Autonomous Offline Lexicon</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-serif-editorial">
            Universal Multilingual Reference
          </h1>
          <p className="text-xs sm:text-sm text-white/80 max-w-md mt-0.5">
            42 directed language pairs linking African, Middle Eastern, Asian, and European languages.
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="px-4 sm:px-6 -mt-4 relative z-20 space-y-6">
        {/* Prominent Dictionary Search Bar (Acts as Fast-Lookup trigger) */}
        <div
          onClick={() => onNavigateToDictionary()}
          className="bg-white dark:bg-[#15231D] rounded-2xl p-3 sm:p-4 shadow-lg shadow-black/5 border border-slate-200/90 dark:border-slate-800 flex items-center gap-3.5 cursor-pointer hover:border-[#204031] dark:hover:border-[#7E9E88] transition-all group"
        >
          <div className="w-10 h-10 rounded-xl bg-[#EEF4F0] dark:bg-[#1E3328] text-[#204031] dark:text-[#7E9E88] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Search className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-400 font-medium">Search 48,000+ words, roots & phrases</div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
              Lookup in {sourceMeta.name} or {targetMeta.name}…
            </div>
          </div>

          <div className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            Press /
          </div>
        </div>

        {/* Quick Language Pair Shortcuts */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#345E4C] dark:text-[#7E9E88]" />
              <span>Language Shortcuts</span>
            </h2>
            <span className="text-[11px] text-slate-400">Instant Switch</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {languageShortcuts.map((pair, idx) => {
              const isActive = sourceLang === pair.source && targetLang === pair.target;
              return (
                <button
                  key={idx}
                  onClick={() => onSetLanguages(pair.source, pair.target)}
                  className={`text-xs font-medium px-3.5 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[#1B382B] text-white shadow-xs'
                      : 'bg-white dark:bg-[#15231D] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <span>{pair.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Word of the Day Feature Card */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#D97753]" />
              <span>Word of the Day</span>
            </h2>
            <div className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-3 h-3" />
              <span>Offline Verified</span>
            </div>
          </div>

          <div
            onClick={() => onSelectWord(WORD_OF_THE_DAY)}
            className="bg-white dark:bg-[#15231D] rounded-3xl p-5 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden group"
          >
            {/* Cultural background accent watermark */}
            <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 text-slate-100 dark:text-slate-900/30 font-arabic text-8xl font-bold select-none pointer-events-none">
              سلام
            </div>

            <div className="relative z-10">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#C47248] text-white">
                      HAUSA · {LANGUAGES.ha.name}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {WORD_OF_THE_DAY.ipa}
                    </span>
                  </div>

                  <h3 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 font-serif-editorial mt-1.5">
                    {WORD_OF_THE_DAY.headword}
                  </h3>

                  <div className="text-xs text-[#C47248] font-medium mt-0.5">
                    Ajami: {WORD_OF_THE_DAY.headwordScriptVariant?.text} · {WORD_OF_THE_DAY.partOfSpeech}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSave(WORD_OF_THE_DAY.id);
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

              <p className="text-sm text-slate-700 dark:text-slate-300 mt-3 leading-relaxed">
                {WORD_OF_THE_DAY.definition}
              </p>

              {/* Translation equivalents preview */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap gap-2 text-xs">
                <span className="text-slate-400">Translations:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  EN: Health & Peace
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  YO: Àlàáfíà
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 font-arabic">
                  AR: عَافِيَة
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-[#345E4C] dark:text-[#7E9E88] font-medium">
                <span>Explore full etymology & cultural idioms</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </div>

        {/* Recent Searches */}
        {recentSearches && recentSearches.length > 0 && (
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
                  onClick={() => onNavigateToDictionary(term)}
                  className="text-xs px-3 py-1.5 rounded-xl bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 cursor-pointer flex items-center gap-1.5"
                >
                  <Search className="w-3 h-3 text-slate-400" />
                  <span>{term}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Android Native APK On-Device GitHub Actions Banner */}
        <div className="bg-gradient-to-r from-[#EEF4F0] via-[#FAF8F5] to-[#EEF4F0] dark:from-[#13221A] dark:via-[#162720] dark:to-[#13221A] rounded-3xl p-5 border border-[#204031]/20 dark:border-[#7E9E88]/30 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-[#204031] dark:bg-[#7E9E88] text-white dark:text-[#122019] flex items-center justify-center shrink-0 shadow-xs">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#204031] text-white dark:bg-[#7E9E88] dark:text-[#122019]">
                    GITHUB ACTIONS CI/CD
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Native Android APK (Ready for Device)
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-lg leading-relaxed">
                  Compiled via GitHub Actions with Gradle &amp; JDK 21. Real native Android debug package with 100% offline multilingual dictionaries.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 w-full sm:w-auto">
              <a
                href="/lexica-debug.apk"
                download="lexica-debug.apk"
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#204031] hover:bg-[#162C22] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <HardDriveDownload className="w-4 h-4" />
                <span>Download APK (5.3 MB)</span>
              </a>

              <a
                href="https://github.com/ahmad-maxai/lexica-dictionary-new/actions/runs/42796366306"
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              >
                <span>GitHub Run</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Curated Daily Discoveries (Thematic Cultural Collections) */}
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
                className="bg-white dark:bg-[#15231D] p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#204031] transition-all cursor-pointer shadow-xs flex flex-col justify-between"
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
                  <span>{col.wordIds.length} Verified Entries</span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
