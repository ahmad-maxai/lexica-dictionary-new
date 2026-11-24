import React, { useEffect, useState } from 'react';
import {
  X,
  ShieldCheck,
  Scale,
  AlertTriangle,
  ExternalLink,
  Check,
  Database,
  ChevronRight,
} from 'lucide-react';
import { HAUSA_PACK_MANIFEST } from '../config/hausaDictionaryConfig';
import { YORUBA_PACK_MANIFEST } from '../config/yorubaDictionaryConfig';
import { hausaSqliteRepo } from '../services/hausaSqliteRepository';
import { yorubaSqliteRepo } from '../services/yorubaSqliteRepository';
import {
  hausaConflictReviewService,
  type ConflictReviewDecision,
  type ConflictReviewerStatus,
  type HausaConflictReviewRecord,
} from '../services/hausaConflictReviewService';
import type { WordEntry } from '../types/dictionary';

interface HausaAttributionAndReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'sources' | 'conflicts';
  focusEntry?: WordEntry | null;
  language?: 'ha' | 'yo';
}

const DECISION_OPTIONS: Array<{ value: ConflictReviewDecision; label: string }> = [
  { value: 'pending', label: 'Pending review' },
  { value: 'keep_both', label: 'Preserve both senses separately' },
  { value: 'prefer_source', label: 'Prefer primary source explanation' },
  { value: 'merged_verified', label: 'Human-verified combined entry' },
  { value: 'needs_native_edit', label: 'Needs native Hausa linguist rewrite' },
];

const STATUS_OPTIONS: Array<{ value: ConflictReviewerStatus; label: string }> = [
  { value: 'conflict_flagged', label: 'conflict_flagged' },
  { value: 'in_review', label: 'in_review' },
  { value: 'approved_human_verified', label: 'approved_human_verified' },
  { value: 'deferred', label: 'deferred' },
];

export const HausaAttributionAndReviewModal: React.FC<HausaAttributionAndReviewModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'sources',
  focusEntry = null,
  language = 'ha',
}) => {
  const isYoruba = language === 'yo';
  const manifest = isYoruba ? YORUBA_PACK_MANIFEST : HAUSA_PACK_MANIFEST;
  const langLabel = isYoruba ? 'Yoruba' : 'Hausa';
  const [activeTab, setActiveTab] = useState<'sources' | 'conflicts'>(initialTab);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueItems, setQueueItems] = useState<HausaConflictReviewRecord[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<ConflictReviewDecision>('pending');
  const [statusDraft, setStatusDraft] = useState<ConflictReviewerStatus>('conflict_flagged');
  const [notesDraft, setNotesDraft] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'conflicts') return;
    let cancelled = false;

    const loadQueue = async () => {
      setIsLoadingQueue(true);
      try {
        const repoActive = isYoruba ? yorubaSqliteRepo.isPackActive() : hausaSqliteRepo.isPackActive();
        if (repoActive) {
          const res = isYoruba
            ? await yorubaSqliteRepo.getConflictReviewQueue(40, 0)
            : await hausaSqliteRepo.getConflictReviewQueue(40, 0);
          if (!cancelled) {
            setQueueTotal(res.totalCount);
            setQueueItems(res.items);
            const initial =
              (focusEntry && res.items.find((i) => i.entryId === focusEntry.id)) || res.items[0] || null;
            if (initial) {
              setSelectedEntryId(initial.entryId);
              setDecisionDraft(initial.reviewDecision);
              setStatusDraft(initial.reviewerStatus);
              setNotesDraft(initial.reviewNotes);
            }
          }
        } else {
          const recorded = hausaConflictReviewService
            .getAllRecordedReviews()
            .filter((r) => (isYoruba ? r.entryId.startsWith('yo-') : r.entryId.startsWith('ha-')));
          const focusRec = focusEntry ? hausaConflictReviewService.getReviewForEntry(focusEntry) : null;
          const merged = focusRec
            ? [focusRec, ...recorded.filter((r) => r.entryId !== focusRec.entryId)]
            : recorded;
          if (!cancelled) {
            setQueueTotal(merged.length);
            setQueueItems(merged);
            const initial = merged[0] || null;
            if (initial) {
              setSelectedEntryId(initial.entryId);
              setDecisionDraft(initial.reviewDecision);
              setStatusDraft(initial.reviewerStatus);
              setNotesDraft(initial.reviewNotes);
            }
          }
        }
      } catch {
        if (!cancelled) {
          const recorded = hausaConflictReviewService
            .getAllRecordedReviews()
            .filter((r) => (isYoruba ? r.entryId.startsWith('yo-') : r.entryId.startsWith('ha-')));
          setQueueTotal(recorded.length);
          setQueueItems(recorded);
        }
      } finally {
        if (!cancelled) setIsLoadingQueue(false);
      }
    };

    void loadQueue();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, focusEntry, isYoruba]);

  if (!isOpen) return null;

  const selectedItem = queueItems.find((item) => item.entryId === selectedEntryId) || queueItems[0] || null;

  const handleSelectQueueItem = (item: HausaConflictReviewRecord) => {
    setSelectedEntryId(item.entryId);
    setDecisionDraft(item.reviewDecision);
    setStatusDraft(item.reviewerStatus);
    setNotesDraft(item.reviewNotes);
    setSavedNotice(null);
  };

  const handleSaveDecision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    const saved = hausaConflictReviewService.saveReviewDecision({
      entryId: selectedItem.entryId,
      headword: selectedItem.headword,
      partOfSpeech: selectedItem.partOfSpeech,
      conflictingVersions: selectedItem.conflictingVersions,
      disagreementNature: selectedItem.disagreementNature,
      reviewDecision: decisionDraft,
      reviewerStatus: statusDraft,
      reviewNotes: notesDraft,
    });
    setQueueItems((prev) => prev.map((it) => (it.entryId === saved.entryId ? saved : it)));
    setSavedNotice(`Saved QA decision for "${saved.headword}". Original source records remain preserved.`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-[#FAF8F5] dark:bg-[#122019] rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 bg-[#F4EFE6] dark:bg-[#162720] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Scale className="w-4 h-4 text-[#204031] dark:text-[#7E9E88]" />
              <span>{langLabel} Pack Attribution &amp; QA Review</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Schema v{manifest.schemaVersion} · {manifest.acceptedEntries.toLocaleString()} entries ·{' '}
              {isYoruba
                ? `${(YORUBA_PACK_MANIFEST.yorubaMonolingualCount || 0) + (YORUBA_PACK_MANIFEST.bilingualExplanationCount || 0)} with Yoruba explanations`
                : `${(HAUSA_PACK_MANIFEST.hausaMonolingualCount || 0) + (HAUSA_PACK_MANIFEST.bilingualExplanationCount || 0)} with Hausa explanations`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-6 pt-3 pb-2 border-b border-slate-200/60 dark:border-slate-800/60 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('sources')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'sources'
                ? 'bg-[#1B382B] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Sources &amp; Licensing ({manifest.sourceAttributions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('conflicts')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'conflicts'
                ? 'bg-[#1B382B] text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              Conflict Review Queue ({(queueTotal || manifest.conflictCount || 0).toLocaleString()})
            </span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {activeTab === 'sources' ? (
            <>
              <div className="p-3.5 rounded-2xl bg-[#EEF4F0] dark:bg-[#172B22] border border-[#204031]/20 dark:border-[#7E9E88]/30 space-y-1.5">
                <div className="font-bold text-[#204031] dark:text-[#7E9E88] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>License Separation &amp; Share-Alike Compliance</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  {manifest.appVsDataLicensingNote}
                </p>
                {!isYoruba && (
                  <p className="text-[11px] font-medium text-[#C47248] dark:text-[#E28D70] pt-1">
                    {HAUSA_PACK_MANIFEST.kamusunHausaStatusNote}
                  </p>
                )}
              </div>

              <div className="space-y-2.5">
                {manifest.sourceAttributions.map((src) => (
                  <div
                    key={src.code}
                    className="p-3.5 rounded-2xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800 space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {src.sourceName}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          src.shareAlikeRequired
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/50'
                            : 'bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88]'
                        }`}
                      >
                        {src.license}
                        {src.shareAlikeRequired ? ' · Share-Alike' : ''}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{src.role}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{src.attributionText}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
                      {typeof src.entriesIncludedCount === 'number' && (
                        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                          Primary entries: {src.entriesIncludedCount.toLocaleString()}
                        </span>
                      )}
                      <div className="flex items-center gap-3 ms-auto">
                        <a
                          href={src.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#345E4C] dark:text-[#7E9E88] hover:underline flex items-center gap-1"
                        >
                          <span>Source</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <a
                          href={src.licenseUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#345E4C] dark:text-[#7E9E88] hover:underline flex items-center gap-1"
                        >
                          <span>License Text</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-2xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 leading-relaxed">
                Conflicting {langLabel} definitions across open sources are{' '}
                <strong className="text-slate-900 dark:text-slate-100">preserved separately</strong> without silent
                auto-merging. Reviewers can inspect competing source definitions and record local QA status.
              </div>

              {isLoadingQueue ? (
                <div className="py-8 text-center text-slate-500">Loading flagged entries...</div>
              ) : queueItems.length === 0 ? (
                <div className="p-5 rounded-2xl bg-white dark:bg-[#162720] border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
                  <Database className="w-6 h-6 text-slate-400 mx-auto" />
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    No active SQLite conflict queue loaded
                  </div>
                  <p className="text-slate-500 dark:text-slate-400">
                    Install the {langLabel} Core &amp; Extended packs in Language Library to inspect all{' '}
                    {manifest.conflictCount?.toLocaleString()} flagged multi-source entries offline.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  {/* Left Queue List */}
                  <div className="sm:col-span-2 space-y-1.5 max-h-80 overflow-y-auto pe-1">
                    {queueItems.map((item) => {
                      const isSel = selectedItem?.entryId === item.entryId;
                      return (
                        <button
                          key={item.entryId}
                          type="button"
                          onClick={() => handleSelectQueueItem(item)}
                          className={`w-full p-2.5 rounded-xl border text-start flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                            isSel
                              ? 'bg-[#EEF4F0] dark:bg-[#1F372C] border-[#204031] dark:border-[#7E9E88]'
                              : 'bg-white dark:bg-[#162720] border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                              {item.headword}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {item.partOfSpeech} · {item.reviewerStatus}
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      );
                    })}
                  </div>

                  {/* Right Review Workbench */}
                  {selectedItem && (
                    <div className="sm:col-span-3 p-4 rounded-2xl bg-white dark:bg-[#162720] border border-slate-200/80 dark:border-slate-800 space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {selectedItem.headword}
                          </h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                            {selectedItem.reviewerStatus}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{selectedItem.disagreementNature}</p>
                      </div>

                      <div className="space-y-2 max-h-44 overflow-y-auto">
                        {selectedItem.conflictingVersions.map((ver, idx) => (
                          <div
                            key={`${ver.sourceCode}-${idx}`}
                            className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#111D18] border border-slate-200/70 dark:border-slate-800 space-y-1"
                          >
                            <div className="flex items-center justify-between text-[10px] font-semibold text-[#345E4C] dark:text-[#7E9E88]">
                              <span>{ver.sourceName}</span>
                              <span>{ver.license}</span>
                            </div>
                            {ver.definitionHa && (
                              <p className="text-xs text-slate-800 dark:text-slate-200">
                                <strong className="font-semibold">HA:</strong> {ver.definitionHa}
                              </p>
                            )}
                            {ver.definitionYo && (
                              <p className="text-xs text-slate-800 dark:text-slate-200">
                                <strong className="font-semibold">YO:</strong> {ver.definitionYo}
                              </p>
                            )}
                            {ver.definitionEn && (
                              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                <strong className="font-semibold">EN:</strong> {ver.definitionEn}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      <form onSubmit={handleSaveDecision} className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                              Resolution Decision
                            </label>
                            <select
                              value={decisionDraft}
                              onChange={(e) => setDecisionDraft(e.target.value as ConflictReviewDecision)}
                              className="w-full h-9 px-2 rounded-lg bg-slate-50 dark:bg-[#111D18] border border-slate-200 dark:border-slate-700 text-xs"
                            >
                              {DECISION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                              Verification Status
                            </label>
                            <select
                              value={statusDraft}
                              onChange={(e) => setStatusDraft(e.target.value as ConflictReviewerStatus)}
                              className="w-full h-9 px-2 rounded-lg bg-slate-50 dark:bg-[#111D18] border border-slate-200 dark:border-slate-700 text-xs"
                            >
                              {STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                            Reviewer Notes
                          </label>
                          <textarea
                            rows={2}
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            placeholder="Record dialect, orthography or sense rationale..."
                            className="w-full p-2 rounded-lg bg-slate-50 dark:bg-[#111D18] border border-slate-200 dark:border-slate-700 text-xs"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="submit"
                            className="px-3.5 py-2 rounded-xl bg-[#1B382B] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-[#142A20]"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Save QA Decision</span>
                          </button>
                          {savedNotice && (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
                              {savedNotice}
                            </span>
                          )}
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
