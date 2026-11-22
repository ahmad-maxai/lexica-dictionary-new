# LEXICA — Assignment 007: Multilingual Compatibility Assessment

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  

---

## 1. Scope: All 7 LEXICA Languages

As defined in `src/data/languages.ts` and `src/services/textNormalization.ts`, LEXICA supports seven languages across distinct scripts, orthographic diacritics, and morphologies:

| Code | Language | Script(s) & Orthography | Direction | Key Indexing / Storage Challenges |
| :--- | :--- | :--- | :--- | :--- |
| `en` | **English** | Latin (`en-GB`, `en-US`, `en-NG`) | `LTR` | Large inflection volume (`134,837` forms per `75k` entries), multi-POS homographs, extensive etymologies. |
| `ha` | **Hausa** | Boko (Latin w/ `ɓ, ɗ, ƙ, ƴ`, macrons) & Ajami (Arabic) | `LTR` / `RTL` | Dual-script support (Boko + Ajami), hooked consonants requiring `soft`/`deep` folding for search. |
| `yo` | **Yoruba** | Latin with underdots (`ẹ, ọ, ṣ`) & tone diacritics (`á, à, ā`) | `LTR` | Unicode NFD/NFC tone stripping for fuzzy search while preserving exact diacritics in storage. |
| `ff` | **Fulfulde** | Latin (`ɓ, ɗ, ŋ, ɲ, ƴ`) & Adlam (`𞤀𞤣𞤤𞤢𞤥`) | `LTR` / `RTL` | 25+ noun classes, initial consonant mutation, optional Adlam Unicode block (`U+1E900–U+1E95F`). |
| `ar` | **Arabic** | Arabic script (`Naskh` / `Thuluth`) with Tashkeel | `RTL` | Harakat diacritic stripping (`normalizeArabic`), Alef/Ta-Marbuta/Alef-Maksura folding, triliteral root lookup. |
| `fr` | **French** | Latin with accents & ligatures (`œ, æ, ç, é, è`) | `LTR` | Ligature folding (`œ -> oe`, `æ -> ae`), reflexive/conjugated verb forms. |
| `zh` | **Chinese** | Hanzi (Simplified & Traditional) + tonal Pinyin | `LTR` | No whitespace word boundaries in Hanzi; requires character/n-gram indexing alongside tone-stripped Pinyin. |

---

## 2. Architectural Compatibility Evaluation

### Why Architecture D (Layered SQLite) Succeeds Across All 7 Languages

1. **Full UTF-8 & Dual-Script Storage:**  
   SQLite stores UTF-8 natively across BMP and supplementary Unicode planes (including Adlam `U+1E900+` for Fulfulde and CJK extensions for Chinese) without custom binary encoding traps.
2. **Script-Aware FTS5 & Normalized Search Columns:**  
   - For **Latin + Diacritics (`en`, `ha`, `yo`, `ff`, `fr`)**, FTS5's built-in `unicode61 remove_diacritics 1` handles accent-insensitive matching automatically (`Àlàáfíà` <-> `alafia`), while an optional compact `search_norm` column in `word_forms` can store deep-folded hooked consonants (`ɓ -> b`, `ƙ -> k`, `œ -> oe`) matching `TextNormalization.normalizeLatin()`.
   - For **Arabic (`ar`)**, storing a Tashkeel/Alef-normalized key (`TextNormalization.normalizeArabic`) in `entries.headword_lower` (or `word_forms`) enables instant B-tree prefix and exact search regardless of vowel marks, while preserving full vocalized headwords for display.
   - For **Chinese (`zh`)**, space-separated character bigrams / Pinyin tokens can be indexed directly into FTS5 `entries_fts` (`content=''`, `detail=none`) so `MATCH` finds Hanzi substrings and Pinyin queries without needing a heavy external segmentation engine on mobile.
3. **Independent Per-Language Modular Packs:**  
   With **Architecture D**, each language ships its own compact `core_<lang>.db` + optional `extended_<lang>.db` pair. Users install only the Core packs they need (typically a few MiB compressed) and can `ATTACH` any pair of language databases on demand without loading everything into JavaScript RAM.

---

## 3. Why Custom Binary (`.lxcbin`) & Letter Shards Struggled for Multilingual Use

- **Architecture B (27 Letter Shards `a..z + _other`):** Fails immediately for Arabic, Chinese, and Adlam Fulfulde because non-ASCII scripts all collapse into the single `_other` bucket, destroying shard balance.
- **Architecture C (`.lxcbin`):** Assumes ASCII-centric token regex `[a-z0-9]+` for its inverted index and requires re-implementing Unicode NFD normalization, CJK bigram splitting, and RTL root indexing inside custom binary search code across TypeScript/Java/Kotlin.
