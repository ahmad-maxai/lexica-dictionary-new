# LEXICA — Assignment 018: Privacy, Consent and Ethics

**Branch:** `feature/assignment-018-fulfulde-human-validation`
**Scope:** Reviewer consent statement, anonymization, and GDPR/privacy compliance.

---

## 1. Reviewer Consent Statement

> **Participant Consent Notice — LEXICA Lexicography Project**
> - **What is collected:** Pseudonymous reviewer ID, self-assessed fluency, dialect, and linguistic feedback. No phone numbers, home addresses, or government identifiers are collected.
> - **Purpose:** To evaluate and improve digital Fulfulde dictionary definitions and regional accuracy.
> - **Publication & Anonymization:** Individual reviewer identities remain strictly confidential and are never published in public dictionary releases. Only anonymized aggregate feedback and linguistic corrections are incorporated.
> - **Voluntary Participation:** Participation is entirely voluntary. Reviewers may decline to answer optional background questions or request removal of their pseudonymous profile data at any time by contacting project maintainers.

---

## 2. Technical Data Separation

- Reviewer profile records (`ReviewerProfile`) and evaluation notes (`EntryReviewRecord`) are stored in isolated evaluation files (`fulfuldeHumanReviewSchema.ts`) separate from production dictionary database tables (`entries`, `senses_ext`), ensuring zero exposure of contributor profiles in published app bundles.
