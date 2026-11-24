# LEXICA — Assignment 017: Technical Validation Report

**Branch:** `feature/assignment-017-fulfulde-validation`
**Scope:** Technical verification of Schema v4 SQLite databases, FTS5 search, and regression tests.

---

## 1. Technical Audit Results

- **SQLite Schema Compliance:** Both `lexica_fulfulde_core.db` and `lexica_fulfulde_extended.db` adhere strictly to Schema v4 specification.
- **Integrity Check:** `PRAGMA quick_check;` returned **`ok`** for both databases.
- **Entry & Sense Counts:** Exactly 20 entries and 20 senses; zero duplicate headwords or missing definitions.
- **FTS5 Search:** Successfully indexes and retrieves entries matching search queries (verified for *Hakkillo*, *Muñal*, etc.).
- **Special Character Search:** Queries incorporating `ɓ`, `ɗ`, `ƴ`, `ŋ`, and `ɲ` resolve correctly via flexible normalization and exact indexing.
- **Automated Regression Tests:** `tests/fulfulde-validation.test.ts` and `tests/fulfulde-recovery-audit.test.ts` passed successfully (`5 / 5` and `5 / 5` assertions passed).
