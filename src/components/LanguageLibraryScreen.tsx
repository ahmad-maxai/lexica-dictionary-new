import React, { useState, useEffect, useRef } from 'react';
import { LanguageCode, InstalledPack } from '../types/dictionary';
import { exportOfflineBackup, importOfflineBackup } from '../services/backupService';
import { LANGUAGE_LIST } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import { ENGLISH_PACK_MANIFEST, isEnglishSqliteIntegrationEnabled } from '../config/englishDictionaryConfig';
import {
  englishPackService,
  type EnglishPackStatus,
  type PackInstallProgress,
} from '../services/englishPackService';
import {
  englishSqliteRepo,
  type EnglishBenchmarkReport,
} from '../services/englishSqliteRepository';
import { HAUSA_PACK_MANIFEST, isHausaSqliteIntegrationEnabled } from '../config/hausaDictionaryConfig';
import { hausaPackService, type HausaPackStatus } from '../services/hausaPackService';
import { hausaSqliteRepo, type HausaBenchmarkReport } from '../services/hausaSqliteRepository';
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
  AlertCircle,
  Pause,
  ShieldCheck,
  Trash2,
  Gauge,
  Archive,
  Upload,
  Download,
} from 'lucide-react';

interface LanguageLibraryScreenProps {
  interfaceLang: LanguageCode;
  installedPacks: Record<LanguageCode, InstalledPack>;
  onTogglePack: (code: LanguageCode) => void;
  onSetLanguages: (source: LanguageCode, target: LanguageCode) => void;
  onPreferencesUpdated?: () => void;
}

export const LanguageLibraryScreen: React.FC<LanguageLibraryScreenProps> = ({
  interfaceLang,
  installedPacks,
  onTogglePack,
  onPreferencesUpdated,
}) => {
  const [expandedLang, setExpandedLang] = useState<LanguageCode | null>('en');
  const [downloadingCode, setDownloadingCode] = useState<LanguageCode | null>(null);
  const [englishStatus, setEnglishStatus] = useState<EnglishPackStatus>(() =>
    englishPackService.getCachedStatus()
  );
  const [englishProgress, setEnglishProgress] = useState<PackInstallProgress>(() =>
    englishPackService.getCachedProgress()
  );
  const [englishActionError, setEnglishActionError] = useState<string | null>(null);
  const [englishVerifyMsg, setEnglishVerifyMsg] = useState<string | null>(null);
  const [benchmarkReport, setBenchmarkReport] = useState<EnglishBenchmarkReport | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState(false);

  const [hausaStatus, setHausaStatus] = useState<HausaPackStatus>(() =>
    hausaPackService.getCachedStatus()
  );
  const [hausaProgress, setHausaProgress] = useState<PackInstallProgress>(() =>
    hausaPackService.getCachedProgress()
  );
  const [hausaActionError, setHausaActionError] = useState<string | null>(null);
  const [hausaVerifyMsg, setHausaVerifyMsg] = useState<string | null>(null);
  const [hausaBenchmarkReport, setHausaBenchmarkReport] = useState<HausaBenchmarkReport | null>(null);
  const [isRunningHausaBenchmark, setIsRunningHausaBenchmark] = useState(false);

  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [backupStatusMsg, setBackupStatusMsg] = useState<string | null>(null);
  const [backupErrorMsg, setBackupErrorMsg] = useState<string | null>(null);
  const [needsConflictReplace, setNeedsConflictReplace] = useState(false);
  const [pendingWebBackupFile, setPendingWebBackupFile] = useState<File | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsubStatusEn = englishPackService.subscribeStatus(setEnglishStatus);
    const unsubProgressEn = englishPackService.subscribeProgress(setEnglishProgress);
    const unsubStatusHa = hausaPackService.subscribeStatus(setHausaStatus);
    const unsubProgressHa = hausaPackService.subscribeProgress(setHausaProgress);
    void englishPackService.refreshStatus();
    void hausaPackService.refreshStatus();
    return () => {
      unsubStatusEn();
      unsubProgressEn();
      unsubStatusHa();
      unsubProgressHa();
    };
  }, []);

  const copy = getUiCopy(interfaceLang);
  const content = getContentCopy(interfaceLang);

  const liveStats = dictionaryDb.getLanguagePackStats();
  const sqliteEnEnabled = isEnglishSqliteIntegrationEnabled();
  const sqliteHaEnabled = isHausaSqliteIntegrationEnabled();
  const isNativeAndroid = englishPackService.isNativeAndroid();
  const useSqliteEnglishCard = sqliteEnEnabled && (isNativeAndroid || englishStatus.installed);
  const useSqliteHausaCard = sqliteHaEnabled && (isNativeAndroid || hausaStatus.installed);

  const totalInstalledBytes = Object.values(liveStats).reduce((sum, stat) => {
    if (stat.code === 'en' && useSqliteEnglishCard) {
      return englishStatus.installed
        ? sum + (englishStatus.dbSizeBytes || ENGLISH_PACK_MANIFEST.uncompressedSizeBytes)
        : sum;
    }
    if (stat.code === 'ha' && useSqliteHausaCard) {
      return hausaStatus.installed
        ? sum + (hausaStatus.dbSizeBytes || HAUSA_PACK_MANIFEST.uncompressedSizeBytes)
        : sum;
    }
    return stat.isInstalled ? sum + stat.actualSizeBytes : sum;
  }, 0);
  const totalInstalledMb = totalInstalledBytes / (1024 * 1024);

  const installedCount = Object.values(liveStats).filter((s) => {
    if (s.code === 'en' && useSqliteEnglishCard) {
      return englishStatus.installed;
    }
    if (s.code === 'ha' && useSqliteHausaCard) {
      return hausaStatus.installed;
    }
    return s.isInstalled;
  }).length;

  const totalActiveEntries = Object.values(liveStats).reduce((sum, s) => {
    if (s.code === 'en' && useSqliteEnglishCard) {
      return englishStatus.installed
        ? sum + (englishStatus.acceptedEntries || ENGLISH_PACK_MANIFEST.acceptedEntries)
        : sum;
    }
    if (s.code === 'ha' && useSqliteHausaCard) {
      return hausaStatus.installed
        ? sum + (hausaStatus.acceptedEntries || HAUSA_PACK_MANIFEST.acceptedEntries)
        : sum;
    }
    return sum + s.loadedEntriesCount;
  }, 0);

  const handleInstallOrResumeEnglish = async () => {
    setEnglishActionError(null);
    setEnglishVerifyMsg(null);
    setDownloadingCode('en');
    try {
      await englishPackService.installEnglishPack();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'DOWNLOAD_CANCELLED') {
        setEnglishActionError(
          err instanceof Error ? err.message : 'Unable to install offline English SQLite pack.'
        );
      }
    } finally {
      setDownloadingCode(null);
    }
  };

  const handleRemoveEnglish = async () => {
    setEnglishActionError(null);
    setEnglishVerifyMsg(null);
    setBenchmarkReport(null);
    setDownloadingCode('en');
    try {
      await englishPackService.removeEnglishPack();
    } catch (err) {
      setEnglishActionError(err instanceof Error ? err.message : 'Unable to remove English pack.');
    } finally {
      setDownloadingCode(null);
    }
  };

  const handleVerifyEnglish = async () => {
    setEnglishActionError(null);
    setEnglishVerifyMsg(null);
    try {
      const verified = await englishPackService.verifyInstalledPack();
      setEnglishVerifyMsg(
        `SQLite quick_check OK · ${(verified.acceptedEntries || ENGLISH_PACK_MANIFEST.acceptedEntries).toLocaleString()} entries verified.`
      );
    } catch (err) {
      setEnglishActionError(err instanceof Error ? err.message : 'Integrity verification failed.');
    }
  };

  const handleRunEnglishBenchmark = async () => {
    setEnglishActionError(null);
    setIsRunningBenchmark(true);
    try {
      const report = await englishSqliteRepo.runBenchmark();
      setBenchmarkReport(report);
    } catch (err) {
      setEnglishActionError(err instanceof Error ? err.message : 'Benchmark failed.');
    } finally {
      setIsRunningBenchmark(false);
    }
  };

  const handleInstallOrResumeHausa = async () => {
    setHausaActionError(null);
    setHausaVerifyMsg(null);
    setDownloadingCode('ha');
    try {
      await hausaPackService.installPack();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'DOWNLOAD_CANCELLED') {
        setHausaActionError(
          err instanceof Error ? err.message : 'Unable to install offline Hausa SQLite pack.'
        );
      }
    } finally {
      setDownloadingCode(null);
    }
  };

  const handleRemoveHausa = async () => {
    setHausaActionError(null);
    setHausaVerifyMsg(null);
    setHausaBenchmarkReport(null);
    setDownloadingCode('ha');
    try {
      await hausaPackService.removePack();
    } catch (err) {
      setHausaActionError(err instanceof Error ? err.message : 'Unable to remove Hausa pack.');
    } finally {
      setDownloadingCode(null);
    }
  };

  const handleVerifyHausa = async () => {
    setHausaActionError(null);
    setHausaVerifyMsg(null);
    try {
      const verified = await hausaPackService.verifyInstalledPack();
      setHausaVerifyMsg(
        `SQLite quick_check OK · ${(verified.acceptedEntries || HAUSA_PACK_MANIFEST.acceptedEntries).toLocaleString()} entries verified.`
      );
    } catch (err) {
      setHausaActionError(err instanceof Error ? err.message : 'Integrity verification failed.');
    }
  };

  const handleRunHausaBenchmark = async () => {
    setHausaActionError(null);
    setIsRunningHausaBenchmark(true);
    try {
      const report = await hausaSqliteRepo.runBenchmark();
      setHausaBenchmarkReport(report);
    } catch (err) {
      setHausaActionError(err instanceof Error ? err.message : 'Benchmark failed.');
    } finally {
      setIsRunningHausaBenchmark(false);
    }
  };

  const handleExportBackup = async () => {
    setBackupErrorMsg(null);
    setBackupStatusMsg(null);
    setNeedsConflictReplace(false);
    setIsBackupBusy(true);
    try {
      const summary = await exportOfflineBackup({ includeEnglishPack: englishStatus.installed });
      const sizeText = summary.includesEnglishSqlite
        ? `${(summary.englishDbBytes / (1024 * 1024)).toFixed(2)} MiB SQLite + 6 bundled packs`
        : '6 bundled language packs & saved study data';
      setBackupStatusMsg(
        `Offline backup saved (${sizeText}). SHA-256 checksum recorded in archive manifest.`
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'BACKUP_CANCELLED') {
        setBackupErrorMsg(err instanceof Error ? err.message : 'Failed to export offline backup.');
      }
    } finally {
      setIsBackupBusy(false);
    }
  };

  const runRestoreFromBackup = async (replaceExisting: boolean, webFile?: File) => {
    setBackupErrorMsg(null);
    setBackupStatusMsg(null);
    setIsBackupBusy(true);
    try {
      const summary = await importOfflineBackup({ replaceExisting, webFile });
      setNeedsConflictReplace(false);
      setPendingWebBackupFile(null);
      onPreferencesUpdated?.();
      const enDetail = summary.includesEnglishSqlite
        ? ` + English SQLite v${summary.englishDatasetVersion} (${summary.englishEntriesCount.toLocaleString()} entries)`
        : '';
      setBackupStatusMsg(
        `Restored ${summary.restoredPackCount} pack state(s), ${summary.restoredSavedWordsCount} saved words, and ${summary.restoredCollectionsCount} collections offline${enDetail}.`
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'BACKUP_CANCELLED') {
        return;
      }
      if (code === 'BACKUP_DUPLICATE_PACK' || code === 'BACKUP_CONFLICT_EXISTS') {
        setNeedsConflictReplace(true);
        if (webFile) {
          setPendingWebBackupFile(webFile);
        }
      } else {
        setNeedsConflictReplace(false);
      }
      setBackupErrorMsg(err instanceof Error ? err.message : 'Failed to restore backup archive.');
    } finally {
      setIsBackupBusy(false);
    }
  };

  const handleRestoreBackupClick = () => {
    if (isNativeAndroid) {
      void runRestoreFromBackup(false);
      return;
    }
    backupFileInputRef.current?.click();
  };

  const handleWebBackupFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void runRestoreFromBackup(false, file);
  };

  const isBackupProgressStage =
    englishProgress.stage === 'exporting_backup' ||
    englishProgress.stage === 'reading_backup' ||
    englishProgress.stage === 'verifying_backup' ||
    englishProgress.stage === 'restoring_backup';

  const handleDownloadToggle = (code: LanguageCode) => {
    if (code === 'en' && useSqliteEnglishCard) {
      if (englishStatus.installed) {
        void handleRemoveEnglish();
      } else {
        void handleInstallOrResumeEnglish();
      }
      return;
    }
    if (code === 'ha' && useSqliteHausaCard) {
      if (hausaStatus.installed) {
        void handleRemoveHausa();
      } else {
        void handleInstallOrResumeHausa();
      }
      return;
    }
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
          const isEnglishSqliteCard = lang.code === 'en' && useSqliteEnglishCard;
          const isHausaSqliteCard = lang.code === 'ha' && useSqliteHausaCard;
          const pack = installedPacks[lang.code] || {
            code: lang.code,
            installed: stat.isInstalled,
            version: stat.datasetVersion,
            sizeMb: stat.actualSizeMb,
          };
          const isInstalled = isEnglishSqliteCard
            ? englishStatus.installed
            : isHausaSqliteCard
            ? hausaStatus.installed
            : stat.isInstalled;
          const displayVersion = isEnglishSqliteCard
            ? englishStatus.datasetVersion || ENGLISH_PACK_MANIFEST.packVersion
            : isHausaSqliteCard
            ? hausaStatus.datasetVersion || HAUSA_PACK_MANIFEST.packVersion
            : pack.version;
          const isEnglishCoreLayer =
            isEnglishSqliteCard &&
            (englishStatus.packLayer !== 'full' || ENGLISH_PACK_MANIFEST.packLayer === 'core') &&
            !englishStatus.extendedInstalled;
          const displayEntries = isEnglishSqliteCard
            ? isInstalled
              ? englishStatus.acceptedEntries || ENGLISH_PACK_MANIFEST.acceptedEntries
              : ENGLISH_PACK_MANIFEST.acceptedEntries
            : isHausaSqliteCard
            ? isInstalled
              ? hausaStatus.acceptedEntries || HAUSA_PACK_MANIFEST.acceptedEntries
              : HAUSA_PACK_MANIFEST.acceptedEntries
            : stat.loadedEntriesCount;
          const displaySenses = isEnglishSqliteCard
            ? isEnglishCoreLayer
              ? englishStatus.corePrimarySenses ||
                ENGLISH_PACK_MANIFEST.corePrimarySenses ||
                ENGLISH_PACK_MANIFEST.acceptedEntries
              : isInstalled
                ? englishStatus.totalSenses || ENGLISH_PACK_MANIFEST.totalSenses
                : ENGLISH_PACK_MANIFEST.totalSenses
            : isHausaSqliteCard
            ? isInstalled
              ? hausaStatus.totalSenses || HAUSA_PACK_MANIFEST.totalSenses
              : HAUSA_PACK_MANIFEST.totalSenses
            : stat.sensesCount;

          const isExpanded = expandedLang === lang.code;
          const isDownloading =
            downloadingCode === lang.code ||
            (isEnglishSqliteCard && englishStatus.inProgress) ||
            (isHausaSqliteCard && hausaStatus.inProgress);
          const kbSize = Math.round(stat.actualSizeBytes / 1024);
          const enCompressedMb = (ENGLISH_PACK_MANIFEST.compressedSizeBytes / (1024 * 1024)).toFixed(2);
          const enUncompressedMb = (
            (isInstalled && englishStatus.dbSizeBytes
              ? englishStatus.dbSizeBytes
              : ENGLISH_PACK_MANIFEST.uncompressedSizeBytes) /
            (1024 * 1024)
          ).toFixed(2);
          const haCompressedKb = (HAUSA_PACK_MANIFEST.compressedSizeBytes / 1024).toFixed(0);
          const haUncompressedKb = (
            (isInstalled && hausaStatus.dbSizeBytes
              ? hausaStatus.dbSizeBytes
              : HAUSA_PACK_MANIFEST.uncompressedSizeBytes) / 1024
          ).toFixed(0);
          const hasPartialResume = isEnglishSqliteCard && !isInstalled && englishStatus.partialBytes > 0;

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
                        v{displayVersion}
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
                      {isEnglishSqliteCard
                        ? isInstalled
                          ? `${enUncompressedMb} MB offline`
                          : `${enCompressedMb} MB download · ${enUncompressedMb} MB offline`
                        : isHausaSqliteCard
                        ? isInstalled
                          ? `${haUncompressedKb} KB offline`
                          : `${haCompressedKb} KB download · ${haUncompressedKb} KB offline`
                        : `${kbSize} KB (${stat.actualSizeMb.toFixed(2)} MB)`}
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
                            entries: displayEntries.toLocaleString(),
                            senses: displaySenses.toLocaleString(),
                          })
                        : isEnglishSqliteCard
                          ? hasPartialResume
                            ? `Paused (${(englishStatus.partialBytes / (1024 * 1024)).toFixed(1)} MB saved)`
                            : copy.library.notInstalledStatus
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
                        <span>
                          {hasPartialResume
                            ? `Resume (${enCompressedMb} MB)`
                            : isEnglishSqliteCard
                              ? `Install (${enCompressedMb} MB)`
                              : isHausaSqliteCard
                              ? `Install (${haCompressedKb} KB)`
                              : copy.library.installPack}
                        </span>
                      </>
                    )}
                  </button>

                  {isEnglishSqliteCard && isDownloading && (
                    <button
                      type="button"
                      onClick={() => void englishPackService.pauseOrCancelInstall()}
                      className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Pause download"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </button>
                  )}

                  {isHausaSqliteCard && isDownloading && (
                    <button
                      type="button"
                      onClick={() => void hausaPackService.cancelInstall()}
                      className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                      title="Cancel download"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Cancel</span>
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

              {/* English SQLite Download / Extraction Progress & Error Strip */}
              {isEnglishSqliteCard && (isDownloading || englishActionError || englishStatus.error) && (
                <div className="px-5 pb-4 space-y-2">
                  {isDownloading && (
                    <div className="p-3 rounded-2xl bg-[#EEF4F0] dark:bg-[#172B22] border border-[#204031]/20 dark:border-[#7E9E88]/30 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-medium text-[#204031] dark:text-[#7E9E88]">
                        <span>{englishProgress.message || copy.library.updating}</span>
                        <span dir="ltr" className="font-mono tabular-nums">
                          {englishProgress.percent}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-white dark:bg-[#101C16] overflow-hidden">
                        <div
                          className="h-full bg-[#204031] dark:bg-[#7E9E88] transition-all duration-200"
                          style={{ width: `${Math.max(4, Math.min(100, englishProgress.percent))}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums" dir="ltr">
                        {(englishProgress.processedBytes / (1024 * 1024)).toFixed(1)} MB /{' '}
                        {(englishProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB
                      </div>
                    </div>
                  )}

                  {(englishActionError || englishStatus.error) && (
                    <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex items-start justify-between gap-2 text-xs text-rose-800 dark:text-rose-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                        <span>{englishActionError || englishStatus.error}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleInstallOrResumeEnglish()}
                        className="px-2.5 py-1 rounded-lg bg-rose-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Hausa SQLite Download / Extraction Progress & Error Strip */}
              {isHausaSqliteCard && (isDownloading || hausaActionError || hausaStatus.error) && (
                <div className="px-5 pb-4 space-y-2">
                  {isDownloading && (
                    <div className="p-3 rounded-2xl bg-[#EEF4F0] dark:bg-[#172B22] border border-[#204031]/20 dark:border-[#7E9E88]/30 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-medium text-[#204031] dark:text-[#7E9E88]">
                        <span>{hausaProgress.message || copy.library.updating}</span>
                        <span dir="ltr" className="font-mono tabular-nums">
                          {hausaProgress.percent}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-white dark:bg-[#101C16] overflow-hidden">
                        <div
                          className="h-full bg-[#204031] dark:bg-[#7E9E88] transition-all duration-200"
                          style={{ width: `${Math.max(4, Math.min(100, hausaProgress.percent))}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums" dir="ltr">
                        {(hausaProgress.processedBytes / 1024).toFixed(0)} KB /{' '}
                        {(hausaProgress.totalBytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                  )}

                  {(hausaActionError || hausaStatus.error) && (
                    <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 flex items-start justify-between gap-2 text-xs text-rose-800 dark:text-rose-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                        <span>{hausaActionError || hausaStatus.error}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleInstallOrResumeHausa()}
                        className="px-2.5 py-1 rounded-lg bg-rose-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Expanded Linguistic Specification */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-4 animate-in fade-in duration-200">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {displayEntries.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-500">{copy.library.entriesBox}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#172B22] border border-slate-200/60 dark:border-slate-800">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {displaySenses.toLocaleString()}
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

                  {isEnglishSqliteCard && (
                    <div className="p-3.5 rounded-2xl bg-[#F4EFE6] dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800 space-y-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100">
                            {ENGLISH_PACK_MANIFEST.attribution.sourceName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {ENGLISH_PACK_MANIFEST.attribution.license} · Pack v{ENGLISH_PACK_MANIFEST.packVersion} ·{' '}
                            {ENGLISH_PACK_MANIFEST.distinctHeadwords.toLocaleString()} headwords ·{' '}
                            {(ENGLISH_PACK_MANIFEST.totalWordForms || 134837).toLocaleString()} word forms
                          </div>
                        </div>
                        {englishStatus.availableBytes > 0 && (
                          <span dir="ltr" className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            Free storage: {(englishStatus.availableBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                          </span>
                        )}
                      </div>

                      {ENGLISH_PACK_MANIFEST.extendedCompanion && (
                        <div className="p-2.5 rounded-xl bg-white/80 dark:bg-[#101C16]/80 border border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            Optional Extended Enrichment ({(ENGLISH_PACK_MANIFEST.extendedCompanion.uncompressedSizeBytes / (1024 * 1024)).toFixed(2)} MB):
                          </span>{' '}
                          {englishStatus.extendedInstalled
                            ? 'Installed — secondary senses, examples & etymologies active.'
                            : 'Not installed (optional). Core offline dictionary remains complete for exact, prefix, inflection & definition search without downloading Extended data.'}
                        </div>
                      )}

                      {isInstalled && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleVerifyEnglish()}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#1F372C] border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-[#204031] dark:text-[#7E9E88] flex items-center gap-1.5 cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Verify SQLite</span>
                          </button>

                          <button
                            type="button"
                            disabled={isRunningBenchmark}
                            onClick={() => void handleRunEnglishBenchmark()}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#1F372C] border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-[#204031] dark:text-[#7E9E88] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            <Gauge className="w-3.5 h-3.5" />
                            <span>{isRunningBenchmark ? 'Running Benchmark...' : 'Run Device Benchmark'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleRemoveEnglish()}
                            className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-[11px] font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5 cursor-pointer ms-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove Pack</span>
                          </button>
                        </div>
                      )}

                      {englishVerifyMsg && (
                        <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          {englishVerifyMsg}
                        </div>
                      )}

                      {benchmarkReport && (
                        <div className="p-2.5 rounded-xl bg-white dark:bg-[#101C16] border border-slate-200/80 dark:border-slate-800 text-[11px] font-mono space-y-1 text-slate-700 dark:text-slate-300" dir="ltr">
                          <div>Cold Open: {benchmarkReport.coldOpenMs} ms | Warm Open: {benchmarkReport.warmOpenMs} ms | FTS5: {benchmarkReport.fts5Supported ? 'YES' : 'NO'}</div>
                          <div>Prefix: {benchmarkReport.prefixSearchMs} ms | FTS5 Search: {benchmarkReport.fts5SearchMs} ms | Pagination: {benchmarkReport.paginatedSearchMs} ms</div>
                          <div>100-Query Loop: avg {benchmarkReport.repeated100QueriesAvgMs} ms | p95 {benchmarkReport.repeated100QueriesP95Ms} ms</div>
                          {benchmarkReport.memoryMetrics && (
                            <div>
                              Java Heap: {(benchmarkReport.memoryMetrics.javaHeapUsedBytes / (1024 * 1024)).toFixed(1)} MB | Native Heap: {(benchmarkReport.memoryMetrics.nativeHeapAllocatedBytes / (1024 * 1024)).toFixed(1)} MB
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {isHausaSqliteCard && (
                    <div className="p-3.5 rounded-2xl bg-[#F4EFE6] dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800 space-y-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100">
                            {HAUSA_PACK_MANIFEST.attribution.sourceName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {HAUSA_PACK_MANIFEST.attribution.license} · Pack v{HAUSA_PACK_MANIFEST.packVersion} ·{' '}
                            {HAUSA_PACK_MANIFEST.distinctHeadwords.toLocaleString()} headwords ·{' '}
                            {HAUSA_PACK_MANIFEST.totalWordForms?.toLocaleString()} word forms
                          </div>
                        </div>
                        {hausaStatus.availableBytes > 0 && (
                          <span dir="ltr" className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            Free storage: {(hausaStatus.availableBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                          </span>
                        )}
                      </div>

                      {HAUSA_PACK_MANIFEST.extendedCompanion && (
                        <div className="p-2.5 rounded-xl bg-white/80 dark:bg-[#101C16]/80 border border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            Optional Extended Enrichment ({(HAUSA_PACK_MANIFEST.extendedCompanion.uncompressedSizeBytes / 1024).toFixed(0)} KB):
                          </span>{' '}
                          {hausaStatus.extendedInstalled
                            ? 'Installed — secondary senses, examples & etymologies active.'
                            : 'Not installed (optional). Core offline dictionary remains complete for exact, prefix, inflection & definition search without downloading Extended data.'}
                        </div>
                      )}

                      {isInstalled && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleVerifyHausa()}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#1F372C] border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-[#204031] dark:text-[#7E9E88] flex items-center gap-1.5 cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Verify SQLite</span>
                          </button>

                          <button
                            type="button"
                            disabled={isRunningHausaBenchmark}
                            onClick={() => void handleRunHausaBenchmark()}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#1F372C] border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-[#204031] dark:text-[#7E9E88] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            <Gauge className="w-3.5 h-3.5" />
                            <span>{isRunningHausaBenchmark ? 'Running Benchmark...' : 'Run Device Benchmark'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleRemoveHausa()}
                            className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-[11px] font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5 cursor-pointer ms-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove Pack</span>
                          </button>
                        </div>
                      )}

                      {hausaVerifyMsg && (
                        <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          {hausaVerifyMsg}
                        </div>
                      )}

                      {hausaBenchmarkReport && (
                        <div className="p-2.5 rounded-xl bg-white dark:bg-[#101C16] border border-slate-200/80 dark:border-slate-800 text-[11px] font-mono space-y-1 text-slate-700 dark:text-slate-300" dir="ltr">
                          <div>Exact: {hausaBenchmarkReport.exactHeadwordMs} ms | Prefix: {hausaBenchmarkReport.prefixQueryMs} ms</div>
                          <div>FTS5: {hausaBenchmarkReport.ftsDefinitionMs} ms | Normalized: {hausaBenchmarkReport.normalizedQueryMs} ms</div>
                          <div>Entries verified: {hausaBenchmarkReport.totalEntriesVerified.toLocaleString()}</div>
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

      {/* Offline Backup & Recovery (Storage Access Framework / Local File) */}
      <section className="mt-6 rounded-3xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 shadow-xs p-5 space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#204031] dark:text-[#7E9E88]" />
              <span>Offline Backup &amp; Recovery</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Export or restore installed dictionary packs, saved vocabulary, and collections to device storage without an internet connection.
            </p>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]">
            {isNativeAndroid ? '.lexicabackup (SAF)' : '.lexicabackup.json'}
          </span>
        </div>

        <input
          ref={backupFileInputRef}
          type="file"
          accept=".json,.lexicabackup.json,application/json"
          className="hidden"
          onChange={handleWebBackupFileSelected}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isBackupBusy || englishStatus.inProgress}
            onClick={() => void handleExportBackup()}
            className="h-10 px-4 rounded-xl bg-[#1B382B] hover:bg-[#142A20] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isBackupBusy ? 'Working...' : 'Export Backup'}</span>
          </button>

          <button
            type="button"
            disabled={isBackupBusy || englishStatus.inProgress}
            onClick={handleRestoreBackupClick}
            className="h-10 px-4 rounded-xl bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88] border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Restore Backup</span>
          </button>
        </div>

        {isBackupProgressStage && isBackupBusy && (
          <div className="p-3 rounded-2xl bg-[#EEF4F0] dark:bg-[#172B22] border border-[#204031]/20 dark:border-[#7E9E88]/30 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-[#204031] dark:text-[#7E9E88]">
              <span>{englishProgress.message}</span>
              <span dir="ltr" className="font-mono tabular-nums">
                {englishProgress.percent}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white dark:bg-[#101C16] overflow-hidden">
              <div
                className="h-full bg-[#204031] dark:bg-[#7E9E88] transition-all duration-200"
                style={{ width: `${Math.max(4, Math.min(100, englishProgress.percent))}%` }}
              />
            </div>
          </div>
        )}

        {backupStatusMsg && (
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-800 dark:text-emerald-200">
            {backupStatusMsg}
          </div>
        )}

        {backupErrorMsg && (
          <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 space-y-2 text-xs text-rose-800 dark:text-rose-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>{backupErrorMsg}</span>
            </div>
            {needsConflictReplace && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isBackupBusy}
                  onClick={() => void runRestoreFromBackup(true, pendingWebBackupFile || undefined)}
                  className="px-3 py-1.5 rounded-lg bg-rose-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                >
                  Overwrite Existing &amp; Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNeedsConflictReplace(false);
                    setBackupErrorMsg(null);
                    setPendingWebBackupFile(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#15231D] border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Keep Current
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
