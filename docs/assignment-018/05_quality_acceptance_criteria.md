# LEXICA — Assignment 018: Quality Acceptance Criteria

**Branch:** `feature/assignment-018-fulfulde-human-validation`
**Scope:** Explicit requirements for human validation and field acceptance.

---

## 1. Acceptance Requirements for Human Approval

An entry cannot be marked fully human-validated unless:
1. Evaluated by at least two independent qualified reviewers (where available).
2. At least one reviewer possesses native fluency in the entry's regional variety (e.g., Nigerian Adamawa).
3. Definition and example sentence are explicitly approved or corrected and approved.
4. English translation fidelity and dialect labels are verified.
5. Specialist fields (IPA, Adlam) are reviewed by qualified contributors or explicitly noted as `unverified`.

---

## 2. Field-Level Distinction Standards

- **Human-Approved Fields:** Definition (`definitionFf`), example sentence (`sourceText`), and dialect classification.
- **Automatically Checked Fields:** SQLite schema integrity, quick_check = `ok`, FTS5 index validity, and absence of English-only glosses.
- **Specialist Fields:** IPA and Adlam script variants.
- **Unresolved Disagreements:** Tracked separately in disagreement queues.
