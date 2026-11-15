import {
  LanguageCode,
  MorphologicalForm,
  MultilingualSearchResponse,
  MultilingualSearchResult,
  MultilingualSenseMatch,
  TranslationRelationship,
  WordEntry,
  WordSense,
} from '../types/dictionary';
import { TextNormalization } from './textNormalization';
import { StandardDictionarySearch } from './standardDictionarySearch';

export interface MultilingualSearchContext {
  entries: WordEntry[];
  entriesById: Map<string, WordEntry>;
  sensesById: Map<string, WordSense>;
  sensesByEntryId: Map<string, WordSense[]>;
  morphologyByEntryId: Map<string, MorphologicalForm[]>;
  translationLinksByEntryId: Map<string, TranslationRelationship[]>;
  isLanguageInstalled: (lang: LanguageCode) => boolean;
}

export interface MultilingualSearchOptions {
  partOfSpeech?: string;
  letter?: string;
}

/**
 * ENGINE 2: MULTILINGUAL DICTIONARY SEARCH
 * Connects individual word senses across supported source and target languages
 * using explicit TranslationRelationship records (never fabricating links).
 */
export class MultilingualDictionarySearch {
  private static matchSourceTerm(
    entry: WordEntry,
    morphologicalForms: MorphologicalForm[],
    rawQuery: string
  ): {
    score: number;
    matchedField: MultilingualSearchResult['matchedField'];
    matchedTerm: string;
  } | null {
    const queryLower = rawQuery.toLowerCase();
    const lang = entry.sourceLang;

    // 1. Arabic
    if (lang === 'ar') {
      const normQ = TextNormalization.normalizeArabic(rawQuery);
      const normH = TextNormalization.normalizeArabic(entry.headword);
      if (entry.headword === rawQuery) {
        return { score: 100, matchedField: 'headword-exact', matchedTerm: entry.headword };
      }
      if (normH === normQ) {
        return { score: 95, matchedField: 'headword-normalized', matchedTerm: entry.headword };
      }
      if (normH.startsWith(normQ)) {
        return { score: 85, matchedField: 'headword-prefix', matchedTerm: entry.headword };
      }
      if (normH.includes(normQ)) {
        return { score: 75, matchedField: 'headword-normalized', matchedTerm: entry.headword };
      }
      if (entry.rootWord) {
        const normRoot = TextNormalization.normalizeArabic(entry.rootWord).replace(/[\s\-]/g, '');
        const cleanQ = normQ.replace(/[\s\-]/g, '');
        if (cleanQ && (normRoot === cleanQ || normRoot.includes(cleanQ))) {
          return { score: 70, matchedField: 'script-variant', matchedTerm: entry.rootWord };
        }
      }
    }

    // 2. Chinese (Hanzi & Pinyin)
    if (lang === 'zh') {
      const normPinyinQ = TextNormalization.normalizePinyin(rawQuery);
      if (entry.headword === rawQuery) {
        return { score: 100, matchedField: 'headword-exact', matchedTerm: entry.headword };
      }
      if (entry.headwordScriptVariant?.text && entry.headwordScriptVariant.text === rawQuery) {
        return { score: 98, matchedField: 'script-variant', matchedTerm: entry.headwordScriptVariant.text };
      }
      if (entry.headword.includes(rawQuery) || entry.headwordScriptVariant?.text?.includes(rawQuery)) {
        return { score: 80, matchedField: 'headword-prefix', matchedTerm: entry.headword };
      }
      if (entry.audioPhoneticText && normPinyinQ) {
        const normPinyinE = TextNormalization.normalizePinyin(entry.audioPhoneticText);
        if (normPinyinE === normPinyinQ) {
          return { score: 90, matchedField: 'pinyin', matchedTerm: entry.audioPhoneticText };
        }
        if (normPinyinE.includes(normPinyinQ)) {
          return { score: 82, matchedField: 'pinyin', matchedTerm: entry.audioPhoneticText };
        }
      }
    }

    // 3. Latin orthographies
    const { soft: qSoft, deep: qDeep, vowelFold: qFold } = TextNormalization.normalizeLatin(rawQuery);
    const { soft: hSoft, deep: hDeep, vowelFold: hFold } = TextNormalization.normalizeLatin(entry.headword);

    if (entry.headword.toLowerCase() === queryLower) {
      return { score: 100, matchedField: 'headword-exact', matchedTerm: entry.headword };
    }
    if (qSoft && hSoft === qSoft) {
      return { score: 95, matchedField: 'headword-normalized', matchedTerm: entry.headword };
    }
    if (qDeep && hDeep === qDeep) {
      return { score: 90, matchedField: 'headword-normalized', matchedTerm: entry.headword };
    }
    if (hFold && qFold && hFold === qFold) {
      return { score: 88, matchedField: 'headword-normalized', matchedTerm: entry.headword };
    }
    if (
      (qSoft && hSoft.startsWith(qSoft)) ||
      (qDeep && hDeep.startsWith(qDeep)) ||
      (hFold && qFold && hFold.startsWith(qFold))
    ) {
      return { score: 80, matchedField: 'headword-prefix', matchedTerm: entry.headword };
    }
    if (
      (qSoft && hSoft.includes(qSoft)) ||
      (qDeep && hDeep.includes(qDeep)) ||
      (hFold && qFold && hFold.includes(qFold))
    ) {
      return { score: 70, matchedField: 'headword-normalized', matchedTerm: entry.headword };
    }

    // 4. Script variants (Ajami, Adlam)
    if (entry.headwordScriptVariant?.text) {
      const scriptText = entry.headwordScriptVariant.text;
      const normScriptAr = TextNormalization.normalizeArabic(scriptText);
      const normQueryAr = TextNormalization.normalizeArabic(rawQuery);
      if (scriptText === rawQuery || (normQueryAr && normScriptAr && normScriptAr.includes(normQueryAr))) {
        return { score: 85, matchedField: 'script-variant', matchedTerm: scriptText };
      }
    }

    // 5. Morphology
    for (const morph of morphologicalForms) {
      const { soft: mSoft, deep: mDeep } = TextNormalization.normalizeLatin(morph.form);
      const normMAr = TextNormalization.normalizeArabic(morph.form);
      const normQAr = TextNormalization.normalizeArabic(rawQuery);
      if (
        morph.form.toLowerCase() === queryLower ||
        (lang === 'ar' && normQAr && normMAr === normQAr) ||
        (qSoft && mSoft === qSoft) ||
        (qDeep && mDeep === qDeep)
      ) {
        return { score: 86, matchedField: 'morphology', matchedTerm: `${morph.form} (${morph.label})` };
      }
    }

    return null;
  }

  private static matchTargetRelationship(
    rel: TranslationRelationship,
    rawQuery: string
  ): { score: number; matchedField: 'translation-exact' | 'translation-partial'; matchedTerm: string } | null {
    const queryLower = rawQuery.toLowerCase();
    const tHead = rel.targetHeadword;
    const { soft: tSoft, deep: tDeep } = TextNormalization.normalizeLatin(tHead);
    const { soft: qSoft, deep: qDeep } = TextNormalization.normalizeLatin(rawQuery);
    const normTAr = TextNormalization.normalizeArabic(tHead);
    const normQAr = TextNormalization.normalizeArabic(rawQuery);

    if (
      tHead.toLowerCase() === queryLower ||
      (normTAr && normQAr && normTAr === normQAr) ||
      (qSoft && tSoft === qSoft) ||
      (qDeep && tDeep === qDeep) ||
      (rel.targetLang === 'zh' && rel.transliteration && TextNormalization.normalizePinyin(rel.transliteration) === TextNormalization.normalizePinyin(rawQuery))
    ) {
      return { score: 90, matchedField: 'translation-exact', matchedTerm: tHead };
    }

    if (
      (qSoft && tSoft.includes(qSoft)) ||
      (qDeep && tDeep.includes(qDeep)) ||
      (normTAr && normQAr && normTAr.includes(normQAr)) ||
      (rel.targetLang === 'zh' && tHead.includes(rawQuery))
    ) {
      return { score: 65, matchedField: 'translation-partial', matchedTerm: tHead };
    }

    return null;
  }

  private static buildSenseMatches(
    entry: WordEntry,
    pairTargetLang: LanguageCode,
    context: MultilingualSearchContext
  ): MultilingualSenseMatch[] {
    const senses = context.sensesByEntryId.get(entry.id) || [];
    const rels = (context.translationLinksByEntryId.get(entry.id) || []).filter(
      (r) => r.targetLang === pairTargetLang
    );

    const senseMatches: MultilingualSenseMatch[] = [];
    for (const rel of rels) {
      const sourceSense =
        context.sensesById.get(rel.sourceSenseId) ||
        senses[0] || {
          id: `${entry.id}#s1`,
          entryId: entry.id,
          senseNumber: 1,
          partOfSpeech: entry.partOfSpeech,
          definition: entry.definition,
          definitionEn: entry.definitionEn,
          register: entry.register,
          examples: entry.examples,
          synonyms: entry.synonyms,
          antonyms: entry.antonyms,
          relatedWords: entry.relatedWords || [],
        };
      const targetEntry = rel.targetEntryId ? context.entriesById.get(rel.targetEntryId) || null : null;
      senseMatches.push({
        sourceSense,
        relationship: rel,
        targetEntry,
      });
    }

    return senseMatches;
  }

  public static search(
    context: MultilingualSearchContext,
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    options: MultilingualSearchOptions = {}
  ): MultilingualSearchResponse {
    try {
      const rawQuery = (query || '').trim();
      const partOfSpeech = options.partOfSpeech || 'all';
      const letter = options.letter || 'all';

      if (sourceLang === targetLang) {
        return {
          status: 'invalid_pair',
          sourceLang,
          targetLang,
          query: rawQuery,
          results: [],
          message: 'Source and target languages must be different in Multilingual mode. Switch to Standard Dictionary for single-language lookups.',
        };
      }

      const sourceEntries = context.entries.filter((e) => e.sourceLang === sourceLang);
      const targetEntries = context.entries.filter((e) => e.sourceLang === targetLang);

      const missingPacks: LanguageCode[] = [];
      if (!context.isLanguageInstalled(sourceLang) || sourceEntries.length === 0) {
        missingPacks.push(sourceLang);
      }
      if (!context.isLanguageInstalled(targetLang) || targetEntries.length === 0) {
        missingPacks.push(targetLang);
      }

      if (missingPacks.length > 0) {
        return {
          status: 'language_not_installed',
          sourceLang,
          targetLang,
          query: rawQuery,
          results: [],
          message: `Required language dataset not installed: ${missingPacks.map((c) => c.toUpperCase()).join(', ')}. Install it in Library to enable this translation pair.`,
        };
      }

      // BROWSE MODE (empty query)
      if (!rawQuery) {
        const browseResults: MultilingualSearchResult[] = [];
        const sortedSource = [...sourceEntries].sort((a, b) => a.headword.localeCompare(b.headword));

        for (const entry of sortedSource) {
          if (partOfSpeech !== 'all' && !entry.partOfSpeech.toLowerCase().includes(partOfSpeech.toLowerCase())) {
            continue;
          }
          if (letter !== 'all') {
            const cleanH = entry.headword.replace(/^['"‘“\s]+/, '');
            const first = cleanH
              .charAt(0)
              .toUpperCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '');
            if (first !== letter) continue;
          }

          const senseMatches = this.buildSenseMatches(entry, targetLang, context);
          if (senseMatches.length === 0) continue;

          browseResults.push({
            entry,
            matchedField: 'headword-normalized',
            matchedTerm: entry.headword,
            isReverseLookup: false,
            score: 10,
            senseMatches,
          });
        }

        return {
          status: 'browse',
          sourceLang,
          targetLang,
          query: '',
          results: browseResults,
        };
      }

      // SEARCH MODE
      const rawMatches: MultilingualSearchResult[] = [];

      for (const entry of context.entries) {
        if (partOfSpeech !== 'all' && !entry.partOfSpeech.toLowerCase().includes(partOfSpeech.toLowerCase())) {
          continue;
        }

        const isDirectSource = entry.sourceLang === sourceLang;
        const isReverseTarget = entry.sourceLang === targetLang;
        if (!isDirectSource && !isReverseTarget) continue;

        const pairOtherLang = isDirectSource ? targetLang : sourceLang;
        const senseMatches = this.buildSenseMatches(entry, pairOtherLang, context);
        if (senseMatches.length === 0) continue;

        const morphs = context.morphologyByEntryId.get(entry.id) || [];
        const sourceMatch = this.matchSourceTerm(entry, morphs, rawQuery);

        if (sourceMatch) {
          rawMatches.push({
            entry,
            matchedField: sourceMatch.matchedField,
            matchedTerm: sourceMatch.matchedTerm,
            isReverseLookup: !isDirectSource,
            score: isDirectSource ? sourceMatch.score : Math.max(50, sourceMatch.score - 10),
            senseMatches,
          });
          continue;
        }

        // Check translation target headwords on this entry
        let bestRelMatch: {
          score: number;
          matchedField: 'translation-exact' | 'translation-partial';
          matchedTerm: string;
        } | null = null;
        for (const sm of senseMatches) {
          const m = this.matchTargetRelationship(sm.relationship, rawQuery);
          if (m && (!bestRelMatch || m.score > bestRelMatch.score)) {
            bestRelMatch = m;
          }
        }

        if (bestRelMatch) {
          rawMatches.push({
            entry,
            matchedField: bestRelMatch.matchedField,
            matchedTerm: bestRelMatch.matchedTerm,
            isReverseLookup: isDirectSource, // Typed target word while on source->target
            score: isDirectSource ? bestRelMatch.score : Math.max(45, bestRelMatch.score - 10),
            senseMatches,
          });
          continue;
        }

        // Strict whole-word definition fallback
        const senses = context.sensesByEntryId.get(entry.id) || [];
        const defHit = senses.find(
          (s) =>
            TextNormalization.containsWholeWord(s.definition, rawQuery) ||
            TextNormalization.containsWholeWord(s.definitionEn, rawQuery)
        );
        if (defHit) {
          rawMatches.push({
            entry,
            matchedField: 'definition',
            matchedTerm: defHit.definition,
            isReverseLookup: !isDirectSource,
            score: 30,
            senseMatches,
          });
        }
      }

      if (rawMatches.length === 0) {
        // Check whether the word actually exists in the source Standard Dictionary without translations to targetLang
        const stdCheck = StandardDictionarySearch.search(
          {
            entries: context.entries,
            sensesByEntryId: context.sensesByEntryId,
            morphologyByEntryId: context.morphologyByEntryId,
            isLanguageInstalled: context.isLanguageInstalled,
          },
          rawQuery,
          sourceLang,
          { partOfSpeech }
        );

        const existsInStandard = stdCheck.status === 'ok' && stdCheck.results.length > 0;
        if (existsInStandard) {
          return {
            status: 'no_translation',
            sourceLang,
            targetLang,
            query: rawQuery,
            results: [],
            existsInStandardDictionary: true,
            message: `“${stdCheck.results[0].entry.headword}” exists in the ${sourceLang.toUpperCase()} Standard Dictionary, but has no verified translation relationship to ${targetLang.toUpperCase()} yet.`,
          };
        }

        return {
          status: 'not_found',
          sourceLang,
          targetLang,
          query: rawQuery,
          results: [],
          existsInStandardDictionary: false,
          message: `No matching entry found for “${rawQuery}” in ${sourceLang.toUpperCase()} ↔ ${targetLang.toUpperCase()}.`,
        };
      }

      // Suppress weak definition matches when stronger matches exist
      const hasStrong = rawMatches.some((m) => m.score >= 65);
      const filtered = hasStrong ? rawMatches.filter((m) => m.matchedField !== 'definition') : rawMatches;

      filtered.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.entry.sourceLang === sourceLang && b.entry.sourceLang !== sourceLang) return -1;
        if (b.entry.sourceLang === sourceLang && a.entry.sourceLang !== sourceLang) return 1;
        return a.entry.headword.localeCompare(b.entry.headword);
      });

      // Deduplicate by normalized headword while preserving reverse-lookup fallback
      const deduped: MultilingualSearchResult[] = [];
      const seenHeadwords = new Set<string>();
      for (const item of filtered) {
        const key = item.entry.headword.toLowerCase().replace(/[\s\-\/]/g, '');
        if (seenHeadwords.has(key)) continue;
        seenHeadwords.add(key);
        deduped.push(item);
      }

      return {
        status: 'ok',
        sourceLang,
        targetLang,
        query: rawQuery,
        results: deduped,
      };
    } catch (err) {
      return {
        status: 'error',
        sourceLang,
        targetLang,
        query: query || '',
        results: [],
        message: err instanceof Error ? err.message : 'Unexpected multilingual search error.',
      };
    }
  }
}
