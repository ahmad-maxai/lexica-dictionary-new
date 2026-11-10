import React, { useState } from 'react';
import { LanguageCode, InstalledPack } from '../types/dictionary';
import { LANGUAGES, LANGUAGE_LIST } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import {
  Layers,
  HardDriveDownload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Globe2,
  Sparkles,
} from 'lucide-react';

interface LanguageLibraryScreenProps {
  installedPacks: Record<LanguageCode, InstalledPack>;
  onTogglePack: (code: LanguageCode) => void;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
}

export const LanguageLibraryScreen: React.FC<LanguageLibraryScreenProps> = ({
  installedPacks,
  onTogglePack,
  onSetLanguages,
}) => {
  const [expandedLang, setExpandedLang] = useState<LanguageCode | null>('ha');
  const [downloadingCode, setDownloadingCode] = useState<LanguageCode | null>(null);

  // Compute total offline storage utilized
  const totalInstalledSize = Object.entries(installedPacks).reduce((sum, [code, pack]) => {
    if (pack.installed) {
      return sum + (LANGUAGES[code as LanguageCode]?.packSizeMb || 0);
    }
    return sum;
  }, 0);

  const installedCount = Object.values(installedPacks).filter((p) => p.installed).length;

  const handleDownloadToggle = (code: LanguageCode) => {
    setDownloadingCode(code);
    setTimeout(() => {
      onTogglePack(code);
      setDownloadingCode(null);
    }, 600);
  };

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 max-w-3xl mx-auto px-4 sm:px-6 pt-6 transition-colors">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-serif-editorial text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Layers className="w-6 h-6 text-[#204031] dark:text-[#7E9E88]" />
            <span>Language Pack Library</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Modular offline dictionary packs, dialect registers, and orthographic profiles.
          </p>
        </div>

        {/* Storage Summary */}
        <div className="flex items-center gap-2 bg-white dark:bg-[#15231D] px-3.5 py-2 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <div className="text-slate-700 dark:text-slate-300">
            <span className="font-bold tabular-nums">{totalInstalledSize.toFixed(1)} MB</span> Offline Storage
            <span className="text-slate-400 ml-1">({installedCount}/7 Packs Active)</span>
          </div>
        </div>
      </div>

      {/* Language Packs List */}
      <div className="space-y-4">
        {LANGUAGE_LIST.map((lang) => {
          const pack = installedPacks[lang.code] || {
            code: lang.code,
            installed: false,
            version: '2026.1',
            sizeMb: lang.packSizeMb,
          };

          const isExpanded = expandedLang === lang.code;
          const isDownloading = downloadingCode === lang.code;

          return (
            <div
              key={lang.code}
              className={`rounded-3xl border transition-all overflow-hidden ${
                pack.installed
                  ? 'bg-white dark:bg-[#15231D] border-slate-200/90 dark:border-slate-800 shadow-xs'
                  : 'bg-slate-50/80 dark:bg-[#131F19]/80 border-dashed border-slate-200 dark:border-slate-800/80 opacity-90'
              }`}
            >
              {/* Main Pack Bar */}
              <div className="p-5 flex flex-wrap items-center justify-between gap-4">
                <div
                  className="flex items-center gap-3.5 flex-1 min-w-[200px] cursor-pointer"
                  onClick={() => setExpandedLang(isExpanded ? null : lang.code)}
                >
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-bold text-sm shadow-xs"
                    style={{
                      backgroundColor: lang.accentColor,
                      color: '#FFFFFF',
                    }}
                  >
                    {lang.code.toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                        {lang.name}
                      </h3>
                      <span className="text-xs font-mono text-slate-500">
                        v{pack.version}
                      </span>
                    </div>

                    <div
                      className={`text-xs text-slate-600 dark:text-slate-400 truncate ${
                        lang.direction === 'rtl' ? 'font-arabic' : 'font-sans'
                      }`}
                      dir={lang.direction}
                    >
                      {lang.nativeScript} · {lang.speakersCount} Speakers
                    </div>
                  </div>
                </div>

                {/* Status & Pack Actions */}
                <div className="flex items-center gap-2.5">
                  <div className="text-right hidden sm:block">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                      {lang.packSizeMb} MB
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                      {dictionaryDb.getEntriesByLanguage(lang.code).length} Verified Local
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => handleDownloadToggle(lang.code)}
                    className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                      pack.installed
                        ? 'bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88] hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600'
                        : 'bg-[#1B382B] text-white hover:bg-[#142A20]'
                    }`}
                  >
                    {isDownloading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Updating…</span>
                      </>
                    ) : pack.installed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Installed</span>
                      </>
                    ) : (
                      <>
                        <HardDriveDownload className="w-3.5 h-3.5" />
                        <span>Install Pack</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpandedLang(isExpanded ? null : lang.code)}
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded Linguistic Specification */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-4 animate-in fade-in duration-200">
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span className="font-bold text-slate-900 dark:text-slate-100">Cultural & Historical Scope: </span>
                    {lang.culturalHeritage}
                  </div>

                  {/* Dialect and Orthography Breakdown */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Dialectal Varieties & Orthographic Scripts ({lang.dialects.length})
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {lang.dialects.map((dialect) => (
                        <div
                          key={dialect.id}
                          className="p-3 rounded-xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800 flex items-start justify-between gap-2"
                        >
                          <div>
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {dialect.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {dialect.region}
                            </div>
                          </div>
                          {dialect.isStandard && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#204031] text-white">
                              Standard
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Special Linguistic Characters Supported */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Preserved Orthographic Characters
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {lang.specialChars.map((ch, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-mono font-medium text-slate-800 dark:text-slate-200"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
