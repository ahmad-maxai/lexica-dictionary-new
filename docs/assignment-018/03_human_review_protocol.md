# LEXICA — Assignment 018: Human Review Protocol and Disagreement Handling

**Branch:** `feature/assignment-018-fulfulde-human-validation`
**Scope:** Protocol for recording independent reviews, preserving regional variants, and adjudicating disagreements.

---

## 1. Multi-Reviewer Independence Protocol

1. **Independent Evaluation:** Where multiple reviewers are available, entries receive at least two independent reviews without prior visibility of each other's notes.
2. **Adamawa Prioritization:** Nigerian Adamawa entries are prioritized for review by native Adamawa speakers.
3. **Recording Disagreements:** When reviewers suggest conflicting definitions or spellings:
   - Both opinions are preserved in `DisagreementRecord`.
   - The nature of the disagreement is classified (`dialectal`, `semantic`, `orthographic`, `grammatical`).
   - Regional variants are retained rather than erased.
   - Unresolved items are marked `disputed` for expert adjudication.
