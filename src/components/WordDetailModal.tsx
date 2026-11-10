import React, { useState } from 'react';
import { WordEntry, LanguageCode } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import { audioService } from '../services/audioService';
import {
  X,
  Volume2,
  Bookmark,
  Share2,
  Check,
  BookOpen,
  ArrowRight,
  Globe2,
  Sparkles,
  ShieldCheck,
  Copy,
} from 'lucide-react';

interface WordDetailModalProps {
  word: WordEntry | null;
  targetLang: LanguageCode;
  isSaved: boolean;
  onToggleSave: (wordId: string) => void;
  onClose: () => void;
  onSelectWordById?: (wordId: string) => void;
  onSetLanguages?: (source: LanguageCode, target: LanguageCode) => void;
}

export const WordDetailModal: React.FC<WordDetailModalProps> = ({
  word,
  targetLang,
  isSaved,
  onToggleSave,
  onClose,
  onSetLanguages,
}) => {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!word) return null;

  const sourceMeta = LANGUAGES[word.sourceLang];
  const targetMeta = LANGUAGES[targetLang];

  const handlePlayAudio = async () => {
    setIsPlayingAudio(true);
    await audioService.speak(word.headword, word.sourceLang, word.tonePattern);
    setIsPlayingAudio(false);
  };

  const handleCopyCitation = () => {
    const citation = `${word.headword} (${sourceMeta.name}) ${word.ipa} - ${word.definition}`;
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(citation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl max-h-[92vh] bg-[#FAF8F5] dark:bg-[#122019] rounded-t-[32px] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200/80 dark:border-slate-800 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between shrink-0 bg-[#F4EFE6] dark:bg-[#162720]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#204031] text-white">
              {sourceMeta.code.toUpperCase()}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              {sourceMeta.name}
            </span>
            {word.dialect && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                  {word.dialect}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopyCitation}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Copy citation"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>

            <button
              onClick={() => onToggleSave(word.id)}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                isSaved
                  ? 'text-[#C47248] bg-[#FAF2ED] dark:bg-[#301F17]'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800'
              }`}
              title={isSaved ? 'Saved to collection' : 'Save word'}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="px-6 py-6 overflow-y-auto space-y-6 flex-1 text-slate-800 dark:text-slate-200">
          {/* Main Headword Area */}
          <div className="bg-white dark:bg-[#172B22] p-5 rounded-2xl border border-slate-200/70 dark:border-slate-800 shadow-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <h1
                    className={`text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 ${
                      sourceMeta.direction === 'rtl' ? 'font-arabic text-right' : 'font-serif-editorial'
                    }`}
                    dir={sourceMeta.direction}
                  >
                    {word.headword}
                  </h1>

                  <button
                    onClick={handlePlayAudio}
                    disabled={isPlayingAudio}
                    className="p-2.5 rounded-full bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88] hover:bg-[#E0EBE4] transition-all active:scale-95 cursor-pointer shadow-xs"
                    title="Pronounce word"
                  >
                    <Volume2 className={`w-4 h-4 ${isPlayingAudio ? 'animate-pulse text-[#C47248]' : ''}`} />
                  </button>
                </div>

                {/* Script Variant or Tone Scheme */}
                {word.headwordScriptVariant && (
                  <div className="text-xs text-[#C47248] dark:text-[#E28D70] font-medium mt-1">
                    <span className="opacity-80">{word.headwordScriptVariant.label}:</span>{' '}
                    <span className="font-semibold">{word.headwordScriptVariant.text}</span>
                  </div>
                )}
              </div>

              {/* Verified Offline Pill */}
              <div className="flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-2.5 py-1 rounded-full">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Offline Verified</span>
              </div>
            </div>

            {/* Pronunciation & Grammatical Metadata */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <span className="font-mono bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
                {word.ipa}
              </span>
              <span>·</span>
              <span className="italic font-medium text-slate-800 dark:text-slate-200">{word.partOfSpeech}</span>
              {word.genderOrClass && (
                <>
                  <span>·</span>
                  <span>{word.genderOrClass}</span>
                </>
              )}
              {word.register && (
                <>
                  <span>·</span>
                  <span className="text-[#345E4C] dark:text-[#7E9E88]">{word.register}</span>
                </>
              )}
            </div>

            {/* Core Definition */}
            <div className="mt-4">
              <div className="text-sm sm:text-base leading-relaxed text-slate-800 dark:text-slate-200 font-sans">
                {word.definition}
              </div>
            </div>
          </div>

          {/* Cross-Language Translation Equivalents (All 7 Languages Supported) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-[#345E4C] dark:text-[#7E9E88]" />
                <span>Multilingual Translation Equivalents</span>
              </h2>
              <span className="text-[11px] text-slate-400">All-to-All Directional Pairs</span>
            </div>

            <div className="space-y-2">
              {Object.entries(word.translations).map(([langKey, equivalents]) => {
                const targetCode = langKey as LanguageCode;
                const langMeta = LANGUAGES[targetCode];
                if (!langMeta || !equivalents || equivalents.length === 0) return null;

                const isCurrentTarget = targetCode === targetLang;

                return (
                  <div
                    key={langKey}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      isCurrentTarget
                        ? 'bg-[#F2F7F4] dark:bg-[#1A3125] border-[#204031] dark:border-[#7E9E88] shadow-xs'
                        : 'bg-white dark:bg-[#162720] border-slate-200/80 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                          style={{ backgroundColor: langMeta.accentColor }}
                        >
                          {langMeta.code.toUpperCase()}
                        </span>
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {langMeta.name}
                        </span>
                        {isCurrentTarget && (
                          <span className="text-[10px] font-medium bg-[#204031] text-white px-1.5 py-0.5 rounded">
                            Active Target
                          </span>
                        )}
                      </div>

                      {onSetLanguages && (
                        <button
                          onClick={() => onSetLanguages(word.sourceLang, targetCode)}
                          className="text-[11px] text-[#345E4C] dark:text-[#7E9E88] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>Explore Pair</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {equivalents.map((eq, idx) => (
                      <div key={idx} className="mt-1">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 ${
                              langMeta.direction === 'rtl' ? 'font-arabic' : 'font-serif-editorial'
                            }`}
                            dir={langMeta.direction}
                          >
                            {eq.headword}
                          </span>
                          {eq.transliteration && (
                            <span className="text-xs text-slate-500 font-mono">
                              [{eq.transliteration}]
                            </span>
                          )}
                          {eq.scriptVariant && (
                            <span className="text-[11px] text-[#C47248] dark:text-[#E28D70]">
                              · {eq.scriptVariant}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                          {eq.definition}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Example Sentences */}
          {word.examples && word.examples.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-[#345E4C] dark:text-[#7E9E88]" />
                <span>Example Sentences & Cultural Context</span>
              </h2>

              <div className="space-y-2.5">
                {word.examples.map((ex, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-2xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800"
                  >
                    <div
                      className={`text-sm font-medium text-slate-900 dark:text-slate-100 ${
                        sourceMeta.direction === 'rtl' ? 'font-arabic text-right' : 'font-sans'
                      }`}
                      dir={sourceMeta.direction}
                    >
                      “{ex.sourceText}”
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">
                      “{ex.targetText}”
                    </div>

                    {ex.culturalContext && (
                      <div className="text-[11px] text-[#C47248] dark:text-[#E28D70] mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 shrink-0" />
                        <span>Cultural Note: {ex.culturalContext}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Etymology, Cultural Notes & Roots */}
          {(word.etymology || word.rootWord || word.culturalNote) && (
            <div className="p-4 rounded-2xl bg-[#F0EBE1] dark:bg-[#182A22] border border-[#E2D8C6] dark:border-slate-800 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#345E4C] dark:text-[#7E9E88]">
                Etymology & Cultural Lore
              </h3>

              {word.rootWord && (
                <div className="text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Linguistic Root: </span>
                  <span className="font-mono text-[#C47248] dark:text-[#E28D70] font-medium">{word.rootWord}</span>
                </div>
              )}

              {word.etymology && (
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {word.etymology}
                </p>
              )}

              {word.culturalNote && (
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed pt-1 border-t border-black/5 dark:border-white/5">
                  <span className="font-semibold">Context: </span>
                  {word.culturalNote}
                </p>
              )}
            </div>
          )}

          {/* Synonyms & Antonyms */}
          {(word.synonyms.length > 0 || word.antonyms.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {word.synonyms.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Synonyms</div>
                  <div className="flex flex-wrap gap-1.5">
                    {word.synonyms.map((s, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {word.antonyms.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">Antonyms</div>
                  <div className="flex flex-wrap gap-1.5">
                    {word.antonyms.map((a, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-100 dark:border-rose-900/40"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
