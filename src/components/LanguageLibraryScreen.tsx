import React, { useState, useEffect, useCallback } from 'react';
import {
  LanguageCode,
  InstalledPack,
  PackDownloadProgress,
  PackManifestItem,
} from '../types/dictionary';
import { LANGUAGE_LIST } from '../data/languages';
import { dictionaryDb, LanguagePackStats } from '../services/dictionaryDatabase';
import { packManager, PackRuntimeState } from '../services/packManager';
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
  Trash2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';

interface LanguageLibraryScreenProps {
  interfaceLang: LanguageCode;
  installedPacks: Record<LanguageCode, InstalledPack>;
  onTogglePack: (code: LanguageCode) => void;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
  onPacksUpdated?: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const LanguageLibraryScreen: React.FC<LanguageLibraryScreenProps> = ({
  interfaceLang,
  installedPacks,
  onTogglePack,
  onPacksUpdated,
}) => {
  const [expandedLang, setExpandedLang] = useState<LanguageCode | null>('ha');
  const [liveStats, setLiveStats] = useState<Record<LanguageCode, LanguagePackStats> | null>(null);
  const [packStates, setPackStates] = useState<Record<LanguageCode, PackRuntimeState> | null>(null);
  const [progressByLang, setProgressByLang] = useState<
    Partial<Record<LanguageCode, PackDownloadProgress>>
  >({});
  const [actionBusyLang, setActionBusyLang] = useState<LanguageCode | null>(null);
  const [errorByLang, setErrorByLang] = useState<Partial<Record<LanguageCode, string>>>({});

  const copy = getUiCopy(interfaceLang);
  const content = getContentCopy(interfaceLang);

  const manifestMap: Partial<Record<LanguageCode, PackManifestItem>> = {};
  for (const item of packManager.getAllManifestItems()) {
    manifestMap[item.langCode] = item;
  }

  const refreshPackData = useCallback(async () => {
    try {
      const [stats, states] = await Promise.all([
        dictionaryDb.getLanguagePackStats(),
        packManager.getPackStates(),
      ]);
      setLiveStats(stats);
      setPackStates(states);
    } catch {
      // Keep previous snapshot if transient read error occurs
    }
  }, []);

  useEffect(() => {
    refreshPackData();
  }, [refreshPackData, installedPacks]);

  useEffect(() => {
    return packManager.subscribe((progress) => {
      setProgressByLang((prev) => ({
        ...prev,
        [progress.langCode]: progress,
      }));
      if (progress.errorMessage) {
        setErrorByLang((prev) => ({
          ...prev,
          [progress.langCode]: progress.errorMessage,
        }));
      }
      if (
        progress.state === 'installed' ||
        progress.state === 'core_only' ||
        progress.state === 'not_installed' ||
        progress.state === 'incomplete'
      ) {
        refreshPackData();
        onPacksUpdated?.();
      }
    });
  }, [refreshPackData, onPacksUpdated]);

  const statsList = liveStats ? Object.values(liveStats) : [];
  const totalInstalledBytes = statsList.reduce(
    (sum, stat) => (stat.isInstalled ? sum + stat.actualSizeBytes : sum),
    0
  );
  const totalInstalledMb = totalInstalledBytes / (1024 * 1024);
  const installedCount = statsList.filter((s) => s.isInstalled).length;
  const totalActiveEntries = statsList.reduce((sum, s) => sum + s.loadedEntriesCount, 0);

  const handleToggleStarterActive = async (code: LanguageCode) => {
    setActionBusyLang(code);
    setErrorByLang((prev) => ({ ...prev, [code]: undefined }));
    try {
      await onTogglePack(code);
      await refreshPackData();
    } catch (err) {
      setErrorByLang((prev) => ({
        ...prev,
        [code]: err instanceof Error ? err.message : 'Unable to update language state',
      }));
    } finally {
      setActionBusyLang(null);
    }
  };

  const handleDownloadFullPack = async (code: LanguageCode) => {
    setErrorByLang((prev) => ({ ...prev, [code]: undefined }));
    try {
      await packManager.downloadAndInstallPack(code);
      await refreshPackData();
      onPacksUpdated?.();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setErrorByLang((prev) => ({
          ...prev,
          [code]: err instanceof Error ? err.message : 'Download failed',
        }));
      }
      await refreshPackData();
    }
  };

  const handleCancelDownload = (code: LanguageCode) => {
    packManager.cancelDownload(code);
  };

  const handleUninstallFullPack = async (code: LanguageCode) => {
    setActionBusyLang(code);
    setErrorByLang((prev) => ({ ...prev, [code]: undefined }));
    try {
      await packManager.uninstallPack(code, 'revert_to_starter');
      await refreshPackData();
      onPacksUpdated?.();
    } catch (err) {
      setErrorByLang((prev) => ({
        ...prev,
        [code]: err instanceof Error ? err.message : 'Failed to remove offline pack',
      }));
    } finally {
      setActionBusyLang(null);
    }
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
          const stat = liveStats?.[lang.code];
          const runtime = packStates?.[lang.code];
          const manifest = manifestMap[lang.code];
          const progress = progressByLang[lang.code];
          const errorMsg = errorByLang[lang.code];
          const fallbackPack = installedPacks[lang.code];

          const isInstalled = stat ? stat.isInstalled : fallbackPack?.installed ?? true;
          const isFullPackInstalled =
            runtime?.tier === 'full_pack' && runtime?.installState === 'installed';
          const isDownloading =
            progress?.state === 'downloading' || runtime?.installState === 'downloading';
          const isVerifying =
            progress?.state === 'verifying' || runtime?.installState === 'verifying';
          const isBusy = actionBusyLang === lang.code;
          const hasUpdate = Boolean(runtime?.availableUpdateVersion);

          const entryCount = stat?.loadedEntriesCount ?? 0;
          const senseCount = stat?.sensesCount ?? 0;
          const transCount = stat?.translationRelationshipsCount ?? 0;
          const sizeBytes = stat?.actualSizeBytes ?? 0;
          const packVersion = runtime?.version || stat?.datasetVersion || fallbackPack?.version || '2026.6.0';
          const isExpanded = expandedLang === lang.code;

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
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                        {getLangName(lang.code, interfaceLang)}
                      </h3>
                      <span dir="ltr" className="text-xs font-mono text-slate-500">
                        v{packVersion}
                      </span>
                      {isFullPackInstalled && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60">
                          Full Offline
                        </span>
                      )}
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
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-end hidden sm:block me-1">
                    <div dir="ltr" className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                      {formatBytes(sizeBytes)}
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
                            entries: entryCount,
                            senses: senseCount,
                          })
                        : copy.library.notInstalledStatus}
                    </div>
                  </div>

                  {/* Download / Cancel / Update Full Pack Control */}
                  {manifest && (isDownloading || isVerifying) ? (
                    <button
                      type="button"
                      disabled={isVerifying}
                      onClick={() => handleCancelDownload(lang.code)}
                      className="h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/70 cursor-pointer hover:bg-amber-100 transition-all"
                    >
                      {isVerifying ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Verifying…</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          <span>
                            {copy.common.cancel} ({progress?.percent ?? 0}%)
                          </span>
                        </>
                      )}
                    </button>
                  ) : manifest && (!isFullPackInstalled || hasUpdate) ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDownloadFullPack(lang.code)}
                      className="h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-[#1B382B] text-white hover:bg-[#142A20] transition-all cursor-pointer shadow-xs"
                    >
                      <HardDriveDownload className="w-3.5 h-3.5" />
                      <span>
                        {hasUpdate
                          ? `Update (${formatBytes(manifest.compressedSizeBytes)})`
                          : manifest.entryCount > entryCount
                          ? `Full Pack · ${formatBytes(manifest.compressedSizeBytes)}`
                          : copy.library.installPack}
                      </span>
                    </button>
                  ) : null}

                  {/* Uninstall Full Pack (reverts cleanly to bundled starter DB) */}
                  {isFullPackInstalled && !isDownloading && !isVerifying && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleUninstallFullPack(lang.code)}
                      title="Remove downloaded pack"
                      className="h-10 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Uninstall</span>
                    </button>
                  )}

                  {/* Active Language Search Toggle */}
                  {!isDownloading && !isVerifying && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleToggleStarterActive(lang.code)}
                      className={`h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                        isInstalled
                          ? 'bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88] hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600'
                          : 'bg-[#1B382B] text-white hover:bg-[#142A20]'
                      }`}
                    >
                      {isBusy ? (
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
                  )}

                  <button
                    type="button"
                    onClick={() => setExpandedLang(isExpanded ? null : lang.code)}
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Streaming Download / Verification Progress Bar */}
              {(isDownloading || isVerifying) && progress && (
                <div className="px-5 pb-4 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                    <span>
                      {isVerifying
                        ? 'Verifying checksum & SQLite index…'
                        : `Downloading offline dictionary pack… ${progress.percent}%`}
                    </span>
                    <span dir="ltr">
                      {formatBytes(progress.receivedBytes)} / {formatBytes(progress.totalBytes)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-150 ${
                        isVerifying ? 'bg-amber-500 animate-pulse' : 'bg-[#204031] dark:bg-[#7E9E88]'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(4, progress.percent))}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Recoverable Error Notice */}
              {errorMsg && (
                <div className="mx-5 mb-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{errorMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorByLang((prev) => ({ ...prev, [lang.code]: undefined }))}
                    className="text-[11px] font-semibold underline shrink-0 cursor-pointer"
                  >
                    {copy.common.close}
                  </button>
                </div>
              )}

              {/* Expanded Linguistic Specification */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-4 animate-in fade-in duration-200">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {entryCount.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.entriesBox}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {senseCount.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.wordSensesBox}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {transCount.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.translationLinksBox}</div>
                    </div>
                  </div>

                  {/* Full Pack Upgrade Details & Attribution */}
                  {manifest && (
                    <div className="p-3.5 rounded-2xl bg-[#EEF4F0]/70 dark:bg-[#172B22] border border-[#204031]/15 dark:border-slate-800 text-xs space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#204031] dark:text-[#7E9E88]" />
                          <span>
                            {isFullPackInstalled
                              ? `Full offline vocabulary installed (${formatBytes(runtime?.sizeBytes || manifest.sizeBytes)})`
                              : `Expandable offline pack: ${manifest.entryCount.toLocaleString()} entries (${formatBytes(manifest.compressedSizeBytes)} download)`}
                          </span>
                        </span>
                      </div>
                      {manifest.sources && manifest.sources.length > 0 && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          Sources & Licences:{' '}
                          {manifest.sources.map((s) => `${s.name} (${s.license})`).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}

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
