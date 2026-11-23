import type { ConflictSourceVersion, WordEntry } from '../types/dictionary';

export type ConflictReviewDecision =
  | 'pending'
  | 'keep_both'
  | 'prefer_source'
  | 'merged_verified'
  | 'needs_native_edit';

export type ConflictReviewerStatus =
  | 'conflict_flagged'
  | 'in_review'
  | 'approved_human_verified'
  | 'deferred';

export interface HausaConflictReviewRecord {
  entryId: string;
  headword: string;
  partOfSpeech: string;
  conflictingVersions: ConflictSourceVersion[];
  disagreementNature: string;
  reviewDecision: ConflictReviewDecision;
  reviewerStatus: ConflictReviewerStatus;
  reviewNotes: string;
  updatedAt: string;
}

const STORAGE_KEY = 'lexica_hausa_conflict_reviews_v4';

class HausaConflictReviewService {
  private memoryStore = new Map<string, HausaConflictReviewRecord>();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, HausaConflictReviewRecord>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && v.entryId && v.headword) {
          this.memoryStore.set(k, v);
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      const obj: Record<string, HausaConflictReviewRecord> = {};
      for (const [k, v] of this.memoryStore.entries()) {
        obj[k] = v;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Ignore storage quota errors
    }
  }

  public getReviewForEntry(entry: Pick<WordEntry, 'id' | 'headword' | 'partOfSpeech' | 'hasConflict' | 'conflictDetails'>): HausaConflictReviewRecord | null {
    this.ensureLoaded();
    const existing = this.memoryStore.get(entry.id);
    if (existing) return existing;
    if (!entry.hasConflict) return null;

    return {
      entryId: entry.id,
      headword: entry.headword,
      partOfSpeech: entry.partOfSpeech,
      conflictingVersions: entry.conflictDetails?.versions || [],
      disagreementNature:
        entry.conflictDetails?.disagreementNature ||
        'Cross-source Hausa explanations preserved separately pending native linguist review.',
      reviewDecision: 'pending',
      reviewerStatus: 'conflict_flagged',
      reviewNotes: '',
      updatedAt: '',
    };
  }

  public saveReviewDecision(input: {
    entryId: string;
    headword: string;
    partOfSpeech: string;
    conflictingVersions: ConflictSourceVersion[];
    disagreementNature: string;
    reviewDecision: ConflictReviewDecision;
    reviewerStatus: ConflictReviewerStatus;
    reviewNotes: string;
  }): HausaConflictReviewRecord {
    this.ensureLoaded();
    const record: HausaConflictReviewRecord = {
      entryId: input.entryId,
      headword: input.headword,
      partOfSpeech: input.partOfSpeech,
      conflictingVersions: input.conflictingVersions,
      disagreementNature: input.disagreementNature,
      reviewDecision: input.reviewDecision,
      reviewerStatus: input.reviewerStatus,
      reviewNotes: input.reviewNotes.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.memoryStore.set(record.entryId, record);
    this.persist();
    return record;
  }

  public getAllRecordedReviews(): HausaConflictReviewRecord[] {
    this.ensureLoaded();
    return Array.from(this.memoryStore.values());
  }

  public clearForTesting(): void {
    this.memoryStore.clear();
    this.loaded = true;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }
}

export const hausaConflictReviewService = new HausaConflictReviewService();
