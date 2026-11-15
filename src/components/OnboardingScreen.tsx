import React, { useState, useEffect } from 'react';
import { LanguageCode } from '../types/dictionary';
import { LANGUAGES, LANGUAGE_LIST } from '../data/languages';
import { ArtworkBanner } from './ArtworkBanner';
import { Check, Globe2, BookOpen, Sparkles, Volume2 } from 'lucide-react';
import { audioService } from '../services/audioService';
import { getUiCopy, getContentCopy, getLangName } from '../i18n';

interface OnboardingScreenProps {
  onComplete: (selectedLanguage: LanguageCode) => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const [selectedLang, setSelectedLang] = useState<LanguageCode>('en');
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);

  const currentMeta = LANGUAGES[selectedLang];
  const copy = getUiCopy(selectedLang);
  const content = getContentCopy(selectedLang);

  useEffect(() => {
    document.documentElement.lang = selectedLang;
    document.documentElement.dir = selectedLang === 'ar' ? 'rtl' : 'ltr';
  }, [selectedLang]);

  const handleSelectLanguage = (code: LanguageCode) => {
    setSelectedLang(code);
  };

  const handlePlayGreeting = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlayingAudio(true);
    await audioService.speak(currentMeta.sampleGreeting.word, selectedLang);
    setIsPlayingAudio(false);
  };

  const handleContinue = () => {
    onComplete(selectedLang);
  };

  return (
    <div
      dir={selectedLang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#142E23] flex flex-col justify-between text-slate-900 transition-colors duration-300"
    >
      {/* Top half: Abstract artistic heritage artwork inspired by the design reference */}
      <div className="relative w-full">
        <ArtworkBanner language={selectedLang} variant="onboarding" />

        {/* Top Floating App Identity */}
        <div className="absolute top-6 left-0 right-0 px-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5 bg-black/30 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 text-white">
            <BookOpen className="w-4 h-4 text-[#7E9E88]" />
            <span className="font-serif-editorial text-sm font-medium tracking-wide">
              {copy.common.appName}
            </span>
          </div>

          <div className="text-xs text-white/70 bg-black/20 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
            {copy.common.offlineBadge}
          </div>
        </div>

        {/* Dynamic Cultural Quote / Greeting Preview Overlay */}
        <div className="absolute bottom-6 left-6 right-6 text-white z-10 pointer-events-auto">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[11px] font-medium tracking-wider uppercase text-[#E5B59D]">
              {getLangName(selectedLang, selectedLang)} · {content.scriptNames[selectedLang]}
            </span>

            <button
              onClick={handlePlayGreeting}
              disabled={isPlayingAudio}
              className="flex items-center gap-1.5 text-xs text-white/90 hover:text-white bg-white/15 hover:bg-white/25 backdrop-blur-md px-2.5 py-1 rounded-full transition-all active:scale-95 cursor-pointer"
              title={copy.onboarding.pronounceTitle}
            >
              <Volume2 className={`w-3.5 h-3.5 ${isPlayingAudio ? 'animate-pulse text-[#E59882]' : ''}`} />
              <span>{copy.common.pronounce}</span>
            </button>
          </div>

          <div
            className={`text-2xl sm:text-3xl font-bold tracking-tight text-white ${
              currentMeta.direction === 'rtl' ? 'font-arabic text-right' : 'font-serif-editorial'
            }`}
            dir={currentMeta.direction}
          >
            {currentMeta.sampleGreeting.word}
          </div>

          <div className="text-xs text-white/80 mt-1 flex flex-wrap items-center gap-2 font-mono">
            <span dir="ltr">{currentMeta.sampleGreeting.transcription}</span>
            <span>·</span>
            <span className="font-sans italic">{content.greetingMeanings[selectedLang]}</span>
          </div>
        </div>
      </div>

      {/* Bottom Half: Warm ivory rounded sheet container */}
      <div className="relative flex-1 bg-[#FAF8F5] dark:bg-[#14231C] rounded-t-[36px] shadow-2xl px-5 sm:px-8 pt-6 pb-8 -mt-5 flex flex-col justify-between border-t border-white/20 transition-colors">
        <div>
          {/* Header Zone */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{copy.onboarding.chooseTitle}</span>
              </h1>
              <Globe2 className="w-5 h-5 text-[#345E4C] dark:text-[#7E9E88]" />
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {copy.onboarding.subtitle}
            </p>
          </div>

          {/* Language Selection Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[38vh] sm:max-h-[42vh] overflow-y-auto pr-1">
            {LANGUAGE_LIST.map((lang) => {
              const isSelected = selectedLang === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleSelectLanguage(lang.code)}
                  className={`relative text-start p-3.5 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-3 cursor-pointer ${
                    isSelected
                      ? 'border-[#204031] bg-[#EEF4F0] dark:bg-[#1D3227] dark:border-[#7E9E88] shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#192A22] hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Cultural Initial Stamp */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold shadow-xs"
                      style={{
                        backgroundColor: isSelected ? lang.accentColor : '#E7ECE9',
                        color: isSelected ? '#FFFFFF' : '#2A4336',
                      }}
                    >
                      {lang.code.toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {getLangName(lang.code, selectedLang)}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {content.scriptShortNames[lang.code]}
                        </span>
                      </div>

                      <div
                        className={`text-xs text-slate-700 dark:text-slate-300 truncate mt-0.5 ${
                          lang.direction === 'rtl' ? 'font-arabic font-medium' : 'font-sans'
                        }`}
                        dir={lang.direction}
                      >
                        {lang.nativeScript}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center">
                    {isSelected ? (
                      <div className="w-6 h-6 rounded-full bg-[#204031] dark:bg-[#7E9E88] text-white flex items-center justify-center shadow-xs">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border border-slate-300 dark:border-slate-700" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Language Cultural Heritage Note */}
          <div className="mt-4 p-3 rounded-xl bg-slate-100/70 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-[#D97753] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {getLangName(selectedLang, selectedLang)}:{' '}
              </span>
              {content.culturalHeritage[selectedLang]}
            </div>
          </div>
        </div>

        {/* Bottom Action Area */}
        <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={handleContinue}
            className="w-full h-13 rounded-2xl bg-[#1B382B] hover:bg-[#142A20] active:scale-[0.99] text-[#FAF8F5] font-semibold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-[#1B382B]/20 transition-all cursor-pointer"
          >
            <span>{copy.onboarding.enterDictionary}</span>
          </button>

          <p className="text-center text-[11px] text-slate-500 dark:text-slate-400 mt-2.5">
            {copy.onboarding.offlineFootnote}
          </p>
        </div>
      </div>
    </div>
  );
};
