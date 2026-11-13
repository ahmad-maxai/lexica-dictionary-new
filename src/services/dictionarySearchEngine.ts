import { WordEntry, LanguageCode, TranslationEquivalent } from '../types/dictionary';

export interface SearchMatchResult {
  entry: WordEntry;
  score: number;
  matchedField: 'headword-exact' | 'headword-normalized' | 'headword-prefix' | 'script-variant' | 'translation-exact' | 'translation-partial' | 'pinyin' | 'definition';
  matchedTerm: string;
  targetTranslation?: TranslationEquivalent;
}

export class MultilingualSearchEngine {
  /**
   * Normalizes Arabic text by:
   * 1. Removing Harakat (Tashkeel diacritics: Fathah, Dammah, Kasrah, Sukun, Tanwin, Shaddah, etc.)
   * 2. Removing Tatweel / Kashida
   * 3. Normalizing Alef variants (أ, إ, آ, ٱ) -> ا
   * 4. Normalizing Ta Marbuta (ة) -> ه
   * 5. Normalizing Alef Maksura (ى) -> ي
   */
  public static normalizeArabic(text: string): string {
    if (!text) return '';
    return text
      // Remove Harakat (Tashkeel) and Tatweel
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      // Normalize Alef forms
      .replace(/[أإآٱ]/g, 'ا')
      // Normalize Ta Marbuta
      .replace(/ة/g, 'ه')
      // Normalize Alef Maksura
      .replace(/ى/g, 'ي')
      .trim();
  }

  /**
   * Normalizes Latin-based African languages (Yoruba, Hausa, Fulfulde) and European (English, French):
   * Provides:
   * - Soft normalization (strips standard accents while preserving essential letters)
   * - Deep normalization (converts hooked letters ɓ, ɗ, ƙ, ƴ, and Yoruba sub-dots ẹ, ọ, ṣ for keyboard fallback)
   */
  public static normalizeLatin(text: string): { soft: string; deep: string; vowelFold: string } {
    if (!text) return { soft: '', deep: '', vowelFold: '' };

    // Soft: Lowercase and strip standard combining accents
    const soft = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’'ʽ‘`]/g, '')
      .trim();

    // Deep: Also convert hooked consonants and sub-dot variants to standard ASCII
    const deep = soft
      .replace(/[ɓƁ]/g, 'b')
      .replace(/[ɗƊ]/g, 'd')
      .replace(/[ƙƘ]/g, 'k')
      .replace(/[ƴƳ]/g, 'y')
      .replace(/[ŋŊ]/g, 'n')
      .replace(/[ɲƝ]/g, 'n')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae');

    // Vowel fold: collapses long duplicate vowels e.g. aa -> a, ee -> e (vital for Yoruba/Hausa/Fulfulde orthographic variations)
    const vowelFold = deep.replace(/([aeiou])\1+/gi, '$1');

    return { soft, deep, vowelFold };
  }

  /**
   * Normalizes Chinese Pinyin: strips tone marks (ā -> a, é -> e) and numeric tones (1-4)
   */
  public static normalizePinyin(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[1-4]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  /**
   * Unified multilingual search indexer and query matcher
   */
  public static matchesQuery(
    entry: WordEntry,
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode
  ): SearchMatchResult | null {
    const rawQuery = query.trim();
    if (!rawQuery) {
      // Return default match if target translation is available
      const targetTrans = entry.translations[targetLang]?.[0];
      return {
        entry,
        score: 10,
        matchedField: 'headword-normalized',
        matchedTerm: entry.headword,
        targetTranslation: targetTrans,
      };
    }

    const queryLower = rawQuery.toLowerCase();
    const targetTransList = entry.translations[targetLang] || [];
    const primaryTargetTrans = targetTransList[0];

    // ==========================================
    // 1. ARABIC MATCHING
    // ==========================================
    if (sourceLang === 'ar' || entry.sourceLang === 'ar') {
      const normQueryAr = this.normalizeArabic(rawQuery);
      const normHeadwordAr = this.normalizeArabic(entry.headword);

      // Exact raw Arabic match (with or without Tashkeel)
      if (entry.headword === rawQuery) {
        return {
          entry,
          score: 100,
          matchedField: 'headword-exact',
          matchedTerm: entry.headword,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Normalized Arabic headword match
      if (normHeadwordAr === normQueryAr) {
        return {
          entry,
          score: 95,
          matchedField: 'headword-normalized',
          matchedTerm: entry.headword,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Prefix match in Arabic
      if (normHeadwordAr.startsWith(normQueryAr)) {
        return {
          entry,
          score: 85,
          matchedField: 'headword-prefix',
          matchedTerm: entry.headword,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Substring match in Arabic
      if (normHeadwordAr.includes(normQueryAr)) {
        return {
          entry,
          score: 75,
          matchedField: 'headword-normalized',
          matchedTerm: entry.headword,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Root word match in Arabic (e.g. خ-ي-ر or خ ي ر)
      if (entry.rootWord) {
        const normRoot = this.normalizeArabic(entry.rootWord).replace(/[\s\-]/g, '');
        const cleanQueryRoot = normQueryAr.replace(/[\s\-]/g, '');
        if (normRoot === cleanQueryRoot || normRoot.includes(cleanQueryRoot)) {
          return {
            entry,
            score: 70,
            matchedField: 'script-variant',
            matchedTerm: entry.rootWord,
            targetTranslation: primaryTargetTrans,
          };
        }
      }
    }

    // ==========================================
    // 2. CHINESE (HANZI & PINYIN) MATCHING
    // ==========================================
    if (sourceLang === 'zh' || entry.sourceLang === 'zh') {
      const normPinyinQuery = this.normalizePinyin(rawQuery);

      // Exact Hanzi match (Simplified)
      if (entry.headword === rawQuery) {
        return {
          entry,
          score: 100,
          matchedField: 'headword-exact',
          matchedTerm: entry.headword,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Traditional character match
      if (entry.headwordScriptVariant?.text && entry.headwordScriptVariant.text === rawQuery) {
        return {
          entry,
          score: 98,
          matchedField: 'script-variant',
          matchedTerm: entry.headwordScriptVariant.text,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Substring Hanzi match
      if (entry.headword.includes(rawQuery) || (entry.headwordScriptVariant?.text?.includes(rawQuery))) {
        return {
          entry,
          score: 80,
          matchedField: 'headword-prefix',
          matchedTerm: entry.headword,
          targetTranslation: primaryTargetTrans,
        };
      }

      // Pinyin match (e.g., xuéxí or xuexi or xue2xi2)
      if (entry.audioPhoneticText) {
        const normPinyinEntry = this.normalizePinyin(entry.audioPhoneticText);
        if (normPinyinEntry === normPinyinQuery || normPinyinEntry.includes(normPinyinQuery)) {
          return {
            entry,
            score: 85,
            matchedField: 'pinyin',
            matchedTerm: entry.audioPhoneticText,
            targetTranslation: primaryTargetTrans,
          };
        }
      }
    }

    // ==========================================
    // 3. LATIN (ENGLISH, HAUSA, YORUBA, FULFULDE, FRENCH) MATCHING
    // ==========================================
    const { soft: querySoft, deep: queryDeep, vowelFold: queryVowelFold } = this.normalizeLatin(rawQuery);
    const { soft: headwordSoft, deep: headwordDeep, vowelFold: headwordVowelFold } = this.normalizeLatin(entry.headword);

    // Exact headword match (with exact tone marks and hooked letters)
    if (entry.headword.toLowerCase() === queryLower) {
      return {
        entry,
        score: 100,
        matchedField: 'headword-exact',
        matchedTerm: entry.headword,
        targetTranslation: primaryTargetTrans,
      };
    }

    // Soft normalized match (accents removed e.g. ogbon -> Ọgbọ́n)
    if (headwordSoft === querySoft) {
      return {
        entry,
        score: 95,
        matchedField: 'headword-normalized',
        matchedTerm: entry.headword,
        targetTranslation: primaryTargetTrans,
      };
    }

    // Deep match (hooked letters converted e.g. kofa -> Ƙofa, munyal -> Muñal)
    if (headwordDeep === queryDeep) {
      return {
        entry,
        score: 90,
        matchedField: 'headword-normalized',
        matchedTerm: entry.headword,
        targetTranslation: primaryTargetTrans,
      };
    }

    // Vowel fold match (collapses duplicate long vowels e.g. alaafia -> alafia)
    if (headwordVowelFold && queryVowelFold && headwordVowelFold === queryVowelFold) {
      return {
        entry,
        score: 88,
        matchedField: 'headword-normalized',
        matchedTerm: entry.headword,
        targetTranslation: primaryTargetTrans,
      };
    }

    // Headword starts-with prefix
    if (
      headwordSoft.startsWith(querySoft) ||
      headwordDeep.startsWith(queryDeep) ||
      (headwordVowelFold && queryVowelFold && headwordVowelFold.startsWith(queryVowelFold))
    ) {
      return {
        entry,
        score: 80,
        matchedField: 'headword-prefix',
        matchedTerm: entry.headword,
        targetTranslation: primaryTargetTrans,
      };
    }

    // Substring match
    if (
      headwordSoft.includes(querySoft) ||
      headwordDeep.includes(queryDeep) ||
      (headwordVowelFold && queryVowelFold && headwordVowelFold.includes(queryVowelFold))
    ) {
      return {
        entry,
        score: 70,
        matchedField: 'headword-normalized',
        matchedTerm: entry.headword,
        targetTranslation: primaryTargetTrans,
      };
    }

    // Script variant (e.g. Ajami for Hausa: لافيا, Traditional for Chinese)
    if (entry.headwordScriptVariant?.text) {
      const scriptText = entry.headwordScriptVariant.text;
      const normScriptAr = this.normalizeArabic(scriptText);
      const normQueryAr = this.normalizeArabic(rawQuery);

      if (scriptText === rawQuery || (normScriptAr && normScriptAr.includes(normQueryAr))) {
        return {
          entry,
          score: 85,
          matchedField: 'script-variant',
          matchedTerm: scriptText,
          targetTranslation: primaryTargetTrans,
        };
      }
    }

    // ==========================================
    // 4. TARGET TRANSLATION MATCH IN ACTIVE PAIR
    // (User searched for target word e.g. searching "Alheri" while in ar -> ha)
    // ==========================================
    for (const trans of targetTransList) {
      const transHeadword = trans.headword;
      const { soft: transSoft, deep: transDeep } = this.normalizeLatin(transHeadword);
      const normTransAr = this.normalizeArabic(transHeadword);
      const normQueryAr = this.normalizeArabic(rawQuery);

      if (
        transHeadword.toLowerCase() === queryLower ||
        (normTransAr && normTransAr === normQueryAr) ||
        transSoft === querySoft ||
        transDeep === queryDeep
      ) {
        return {
          entry,
          score: 90,
          matchedField: 'translation-exact',
          matchedTerm: transHeadword,
          targetTranslation: trans,
        };
      }

      if (
        transSoft.includes(querySoft) ||
        transDeep.includes(queryDeep) ||
        (normTransAr && normTransAr.includes(normQueryAr))
      ) {
        return {
          entry,
          score: 65,
          matchedField: 'translation-partial',
          matchedTerm: transHeadword,
          targetTranslation: trans,
        };
      }
    }

    // ==========================================
    // 5. WHOLE-WORD DEFINITION FALLBACK (ONLY IF QUERY IS >= 4 CHARS)
    // ==========================================
    // Note: We use strict word boundary regex to prevent substring contamination
    // (e.g. searching 'house' must not match 'household head' in Father, and 'lafiya' must not match 'Abinci')
    if (rawQuery.length >= 4) {
      const escapedQuery = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordBoundaryRegex = new RegExp(`(^|\\s|[.,!?;:()"])${escapedQuery}($|\\s|[.,!?;:()"])`, 'i');
      if (wordBoundaryRegex.test(entry.definition) || (entry.definitionEn && wordBoundaryRegex.test(entry.definitionEn))) {
        return {
          entry,
          score: 30, // Low fallback score so headwords and translations always precede
          matchedField: 'definition',
          matchedTerm: entry.definition,
          targetTranslation: primaryTargetTrans,
        };
      }
    }

    return null;
  }

  /**
   * Filters and ranks dictionary entries for a directed language pair (sourceLang -> targetLang).
   * STRICT GUARANTEE: Never mixes unrelated language pairs!
   */
  public static search(
    entries: WordEntry[],
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    partOfSpeech: string = 'all'
  ): WordEntry[] {
    const rawQuery = query.trim();

    // BROWSE MODE: If query is empty, return direct source language entries sorted alphabetically
    if (!rawQuery) {
      const browseList = entries.filter((e) => {
        if (partOfSpeech !== 'all' && !e.partOfSpeech.toLowerCase().includes(partOfSpeech.toLowerCase())) {
          return false;
        }
        return e.sourceLang === sourceLang && !!e.translations[targetLang]?.length;
      });

      browseList.sort((a, b) => a.headword.localeCompare(b.headword));
      return browseList;
    }

    const matches: SearchMatchResult[] = [];
    const seenConcepts = new Set<string>();

    for (const entry of entries) {
      // Rule 1: Part of speech filter
      if (partOfSpeech !== 'all' && !entry.partOfSpeech.toLowerCase().includes(partOfSpeech.toLowerCase())) {
        continue;
      }

      // Rule 2: Strict Language Pair constraint:
      // Entry must either be from sourceLang with a translation into targetLang,
      // OR if entry is from targetLang, it must have a translation into sourceLang (cross-bidirectional pair)
      const isDirectSource = entry.sourceLang === sourceLang;
      const hasTargetTranslation = !!entry.translations[targetLang]?.length;

      // Unrelated pairs check:
      if (!isDirectSource && !(entry.sourceLang === targetLang && !!entry.translations[sourceLang]?.length)) {
        continue;
      }

      // Check match
      const match = this.matchesQuery(entry, query, sourceLang, targetLang);
      if (match) {
        // If entry is from targetLang, prioritize direct source entries unless targetLang was an exact match
        if (!isDirectSource) {
          if (match.score < 95) {
            match.score -= 10;
          }
        }
        matches.push(match);
      }
    }

    // Filter out definition matches if direct headword/translation matches exist
    const hasStrongMatches = matches.some((m) => m.score >= 70);
    const filteredMatches = hasStrongMatches
      ? matches.filter((m) => m.matchedField !== 'definition')
      : matches;

    // Sort by highest score descending
    filteredMatches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // If scores equal, prefer direct source language entry
      if (a.entry.sourceLang === sourceLang && b.entry.sourceLang !== sourceLang) return -1;
      if (b.entry.sourceLang === sourceLang && a.entry.sourceLang !== sourceLang) return 1;
      return a.entry.headword.localeCompare(b.entry.headword);
    });

    // Deduplicate: if an entry has score >= 80, avoid showing its reverse counterpart
    const results: WordEntry[] = [];
    const seenHeadwords = new Set<string>();

    for (const m of filteredMatches) {
      const normH = m.entry.headword.toLowerCase().replace(/[\s\-\/]/g, '');
      if (seenHeadwords.has(normH)) continue;
      seenHeadwords.add(normH);
      results.push(m.entry);
    }

    return results;
  }
}
