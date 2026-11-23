# Assignment 012 — Report 7: Recommended Yoruba Core/Extended Architecture

## 1. Architectural Alignment
Yoruba integration will adopt LEXICA's proven Schema v4 architecture:
- **Core Database (`lexica_yoruba_core.db`)**: Contains high-frequency lemmas, primary parts of speech, verified Yoruba monolingual definitions, and normalized search keys. Designed for instant offline startup and lightweight installation.
- **Extended Database (`lexica_yoruba_extended.db`)**: Contains advanced multi-senses, example sentences, IPA pronunciations, audio reference paths, and conflict review queues. Installs as an optional companion pack.

---

## 2. Search & Tone-Aware Matching Strategy
- **Primary Search Index:** FTS5 virtual table indexing normalized headwords (tone-insensitive for broad lookup) while retaining exact diacritics in the payload table for tone-accurate rendering.
- **Tone Discrimination:** Exact match prioritizes tonal accuracy (distinguishing *ọ̀rọ̀* from *ọ́rọ́*), while fuzzy/prefix search provides fallback suggestions.

---

## 3. Attribution & Manifest
A dedicated `yoruba_pack_manifest.json` will track SHA-256 checksums, uncompressed sizes, compressed sizes, and CC BY-SA 4.0 license attributions.
