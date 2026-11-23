# Assignment 012 — Report 4: Definition Validation Report

## 1. Overview
The Yoruba definition validation pipeline (`yorubaDefinitionValidator.ts`) enforces strict quality control to guarantee that no unverified machine translations or English glosses are misclassified as authentic Yoruba monolingual definitions.

---

## 2. Validation Rules & Classifications

- **`yoruba_monolingual`**: Requires genuine Yoruba explanatory prose. Automatically rejected and reclassified if it contains English vocabulary patterns or is an empty/placeholder string.
- **`bilingual_explanation`**: Requires both Yoruba definition prose and English translation.
- **`english_gloss`**: Reserved for entries where only English translation is available.
- **`machine_generated`**: Tagged and excluded from verified human-authored statistics unless explicitly reviewed by a human lexicographer.
- **`unavailable`**: Assigned to empty stubs, circular cross-references, or placeholders.

---

## 3. Test Verification
The automated test suite (`tests/yoruba-lexicography-audit.test.ts`) verifies:
1. Rejection of placeholders (`N/A`, `todo`, empty strings).
2. Prevention of English gloss misclassification.
3. Acceptance of genuine Yoruba definitions with full provenance.
4. Correct handling of tonal minimum pairs and under-dots.
