# LEXICA — Assignment 017: Human Review Framework

**Branch:** `feature/assignment-017-fulfulde-validation`
**Scope:** Establishment of a structured review framework and machine-readable schema for fluent Fulfulde speakers.

---

## 1. Review Framework Overview

To enable rigorous linguistic validation by native speakers and professional linguists, LEXICA introduces a machine-readable review template (`src/data/fulfuldeReviewTemplate.ts`).

### Review Record Schema
Each review record captures:
- `entryId`: Unique entry identifier (e.g., `ff-rec-001`).
- `headword`: Target headword.
- `proposedVariety`: Dialect classification (`nigerian_adamawa`, `pulaar_futa_tooro`, etc.).
- `reviewerName`: Name of evaluating scholar or native speaker.
- `reviewerFluency`: `native_speaker` | `professional_linguist` | `advanced_learner` | `unspecified`.
- `reviewerDialect`: Reviewer's native variety.
- `definitionAssessment`: `verified` | `needs_review` | `incorrect` | `unverified`.
- `exampleAssessment`: `verified` | `needs_review` | `incorrect` | `unverified`.
- `orthographyCorrections`: Optional spelling adjustments.
- `ipaCorrections`: Optional IPA refinements.
- `adlamCorrections`: Optional Adlam script refinements.
- `confidenceRating`: Integer score from 1 to 5.
- `reviewDate`: ISO date string.
- `commentsAndDisagreements`: Qualitative feedback notes.

---

## 2. Current Validation Status

- **Automated Validation:** Completed successfully across all 20 entries (Schema v4 SQLite checks, quick_check = `ok`, FTS5 search verification).
- **Human Review Status:** Awaiting formal field deployment with native Adamawa Fulfulde speakers. Therefore, entries are conservatively classified as `academic_verified` / `community_reviewed` pending active field review.
