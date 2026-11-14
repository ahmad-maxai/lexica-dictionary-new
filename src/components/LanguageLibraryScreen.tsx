import React, { useState } from 'react';
import { LanguageCode, InstalledPack } from '../types/dictionary';
import { LANGUAGE_LIST } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import {
  getUiCopy,
  getContentCopy,
  formatText,
  getLangName,
} from '../i18n';
import {
  Layers,
  HardDriveDownload,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Database,
} from 'lucide-react';

interface LanguageLibraryScreenProps {
  interfaceLang: LanguageCode;
  installedPacks: Record<LanguageCode, InstalledPack>;
  onTogglePack: (code: LanguageCode) => void;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
}

export const LanguageLibraryScreen: React.FC<LanguageLibraryScreenProps> = ({
  interfaceLang,
  installedPacks,
  onTogglePack,
}) => {
  const [expandedLang, setExpandedLang] = useState<LanguageCode | null>('ha');
  const [downloadingCode, setDownloadingCode] = useState<LanguageCode | null>(null);

  const copy = getUiCopy(interfaceLang);
  const content = getContentCopy(interfaceLang);

  const liveStats = dictionaryDb.getLanguagePackStats();

  const totalInstalledBytes = Object.values(liveStats).reduce((sum, stat) => {
    return stat.isInstalled ? sum + stat.actualSizeBytes : sum;
  }, 0);
  const totalInstalledMb = totalInstalledBytes / (1024 * 1024);

  const installedCount = Object.values(liveStats).filter((s) => s.isInstalled).length;
  const totalActiveEntries = Object.values(liveStats).reduce(
    (sum, s) => sum + s.loadedEntriesCount,
    0
  );

  const handleDownloadToggle = (code: LanguageCode) => {
    setDownloadingCode(code);
    setTimeout(() => {
      onTogglePack(code);
      setDownloadingCode(null);
    }, 250);
  };

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 max-w-3xl mx-auto px-4 sm:px-6 pt-6 transition-colors">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-serif-editorial text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Layers className="w-6 h-6 text-[#204031] dark:text-[#7E9E88]" />
            <span>{copy.library.title}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {copy.library.subtitle}
          </p>
        </div>

        {/* Real Storage & Record Summary */}
        <div className="flex items-center gap-2 bg-white dark:bg-[#15231D] px-3.5 py-2 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
          <Database className="w-4 h-4 text-[#345E4C] dark:text-[#7E9E88]" />
          <div className="text-slate-700 dark:text-slate-300 tabular-nums">
            {formatText(copy.library.localDataSummary, {
              mb: totalInstalledMb.toFixed(2),
              entries: totalActiveEntries,
              active: installedCount,
            })}
          </div>
        </div>
      </div>

      {/* Language Packs List */}
      <div className="space-y-4">
        {LANGUAGE_LIST.map((lang) => {
          const stat = liveStats[lang.code];
          const pack = installedPacks[lang.code] || {
            code: lang.code,
            installed: stat.isInstalled,
            version: stat.datasetVersion,
            sizeMb: stat.actualSizeMb,
          };
          const isInstalled = stat.isInstalled;

          const isExpanded = expandedLang === lang.code;
          const isDownloading = downloadingCode === lang.code;
          const kbSize = Math.round(stat.actualSizeBytes / 1024);

          return (
            <div
              key={lang.code}
              className={`rounded-3xl border transition-all overflow-hidden ${
                isInstalled
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
                        {getLangName(lang.code, interfaceLang)}
                      </h3>
                      <span dir="ltr" className="text-xs font-mono text-slate-500">
                        v{pack.version}
                      </span>
                    </div>

                    <div
                      className={`text-xs text-slate-600 dark:text-slate-400 truncate ${
                        lang.direction === 'rtl' ? 'font-arabic' : 'font-sans'
                      }`}
                    >
                      {lang.nativeScript} · {content.speakersCounts[lang.code] || lang.speakersCount}{' '}
                      {copy.library.speakersLabel}
                    </div>
                  </div>
                </div>

                {/* Status & Pack Actions */}
                <div className="flex items-center gap-2.5">
                  <div className="text-end hidden sm:block">
                    <div dir="ltr" className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                      {kbSize} KB ({stat.actualSizeMb.toFixed(2)} MB)
                    </div>
                    <div
                      className={`text-[11px] font-medium tabular-nums ${
                        isInstalled
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {isInstalled
                        ? formatText(copy.library.entriesInline, {
                            entries: stat.loadedEntriesCount,
                            senses: stat.sensesCount,
                          })
                        : copy.library.notInstalledStatus}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => handleDownloadToggle(lang.code)}
                    className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                      isInstalled
                        ? 'bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88] hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600'
                        : 'bg-[#1B382B] text-white hover:bg-[#142A20]'
                    }`}
                  >
                    {isDownloading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{copy.library.updating}</span>
                      </>
                    ) : isInstalled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{copy.library.installed}</span>
                      </>
                    ) : (
                      <>
                        <HardDriveDownload className="w-3.5 h-3.5" />
                        <span>{copy.library.installPack}</span>
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
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {stat.loadedEntriesCount}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.entriesBox}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {stat.sensesCount}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.wordSensesBox}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {stat.translationRelationshipsCount}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.translationLinksBox}</div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {copy.library.culturalScopePrefix}{' '}
                    </span>
                    {content.culturalHeritage[lang.code] || lang.culturalHeritage}
                  </div>

                  {/* Dialect and Orthography Breakdown */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                      {formatText(copy.library.dialectsHeader, { count: lang.dialects.length })}
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
                              {copy.common.standardBadge}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Special Linguistic Characters Supported */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      {copy.library.preservedChars}
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
