import React from 'react';
import { LanguageCode } from '../types/dictionary';
import { LANGUAGE_LIST } from '../data/languages';
import { getUiCopy, getLangName } from '../i18n';
import {
  X,
  Globe2,
  Moon,
  Sun,
  Check,
  RotateCcw,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  interfaceLang: LanguageCode;
  onSelectInterfaceLang: (code: LanguageCode) => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: (theme: 'light' | 'dark') => void;
  audioPronunciation: boolean;
  onToggleAudio: () => void;
  showPhonetics: boolean;
  onTogglePhonetics: () => void;
  onResetOnboarding: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  interfaceLang,
  onSelectInterfaceLang,
  theme,
  onToggleTheme,
  audioPronunciation,
  onToggleAudio,
  showPhonetics,
  onTogglePhonetics,
  onResetOnboarding,
}) => {
  if (!isOpen) return null;

  const copy = getUiCopy(interfaceLang);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[#FAF8F5] dark:bg-[#122019] rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between shrink-0 bg-[#F4EFE6] dark:bg-[#162720]">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>{copy.settings.title}</span>
          </h2>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
            title={copy.common.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800 dark:text-slate-200 text-xs sm:text-sm">
          {/* Default Interface Language */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2 flex items-center gap-1.5">
              <Globe2 className="w-4 h-4 text-[#345E4C] dark:text-[#7E9E88]" />
              <span>{copy.settings.defaultInterfaceLang}</span>
            </label>
            <p className="text-xs text-slate-500 mb-3">
              {copy.settings.interfaceLangDesc}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LANGUAGE_LIST.map((lang) => {
                const isSelected = interfaceLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => onSelectInterfaceLang(lang.code)}
                    className={`p-3 rounded-xl border text-start flex items-center justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#204031] bg-[#EEF4F0] dark:bg-[#1F372C] dark:border-[#7E9E88]'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#162720] hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {getLangName(lang.code, interfaceLang)}
                      </div>
                      <div
                        className={`text-xs text-slate-500 ${
                          lang.direction === 'rtl' ? 'font-arabic' : ''
                        }`}
                        dir={lang.direction}
                      >
                        {lang.nativeScript}
                      </div>
                    </div>

                    {isSelected && <Check className="w-4 h-4 text-[#204031] dark:text-[#7E9E88]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Theme Switcher */}
          <div className="pt-4 border-t border-slate-200/60 dark:border-slate-800/60">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
              {copy.settings.displayTheme}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onToggleTheme('light')}
                className={`p-3 rounded-xl border flex items-center justify-center gap-2 cursor-pointer font-medium ${
                  theme === 'light'
                    ? 'border-[#204031] bg-white text-slate-900 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#162720] text-slate-600 dark:text-slate-400'
                }`}
              >
                <Sun className="w-4 h-4 text-amber-500" />
                <span>{copy.settings.lightTheme}</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleTheme('dark')}
                className={`p-3 rounded-xl border flex items-center justify-center gap-2 cursor-pointer font-medium ${
                  theme === 'dark'
                    ? 'border-[#7E9E88] bg-[#1F372C] text-white shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#162720] text-slate-600 dark:text-slate-400'
                }`}
              >
                <Moon className="w-4 h-4 text-emerald-400" />
                <span>{copy.settings.darkTheme}</span>
              </button>
            </div>
          </div>

          {/* Pronunciation & Phonetics Options */}
          <div className="pt-4 border-t border-slate-200/60 dark:border-slate-800/60 space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
              {copy.settings.audioAndPhonetics}
            </label>

            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-[#162720] border border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {copy.settings.audioPronunciation}
                </div>
                <div className="text-xs text-slate-500">
                  {copy.settings.audioPronunciationDesc}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleAudio}
                dir="ltr"
                className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                  audioPronunciation ? 'bg-[#204031] dark:bg-[#7E9E88]' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                    audioPronunciation ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-[#162720] border border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {copy.settings.ipaTranscriptions}
                </div>
                <div className="text-xs text-slate-500">
                  {copy.settings.ipaTranscriptionsDesc}
                </div>
              </div>
              <button
                type="button"
                onClick={onTogglePhonetics}
                dir="ltr"
                className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                  showPhonetics ? 'bg-[#204031] dark:bg-[#7E9E88]' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
                    showPhonetics ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Reset Onboarding Walkthrough */}
          <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <button
              type="button"
              onClick={onResetOnboarding}
              className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{copy.settings.resetOnboarding}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
