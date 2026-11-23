# Assignment 012 — Report 5: Duplicate and Conflict Report

## 1. Introduction
Merging data from multiple open-source repositories (Yoruba Wiktionary, Kaikki, and Wikidata) introduces duplication risks and lexical conflicts, particularly concerning tone marks and spelling variations.

---

## 2. Duplicate Detection & Resolution
- **Exact Duplicates:** Entries sharing identical headword, part of speech, and definition text from the same source are deduplicated automatically.
- **Cross-Source Overlaps:** When Wiktionary and Kaikki provide overlapping entries, source provenance arrays are merged without discarding alternate citation paths.

---

## 3. Tonal & Cross-Source Conflicts
- Words differing only by tone marks (e.g., *ọ̀rọ̀* vs. *ọ́rọ́*) are treated as **distinct lexical entries** rather than duplicates.
- Where different sources provide conflicting definitions for the exact same tonal headword, the conflict evaluator flags the entry (`conflictType: 'tonal_variant'`) and queues it for human review (`resolutionStatus: 'flagged_for_review'`), preventing silent auto-merging or data corruption.
