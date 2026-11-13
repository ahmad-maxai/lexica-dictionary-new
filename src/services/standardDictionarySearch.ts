import {
  LanguageCode,
  MorphologicalForm,
  StandardSearchResponse,
  StandardSearchResult,
  WordEntry,
  WordSense,
} from '../types/dictionary';
import { TextNormalization } from './textNormalization';

export interface StandardSearchContext {
  entries: WordEntry[];
  sensesByEntryId: Map<string, WordSense[]>;
  morphologyByEntryId: Map<string, MorphologicalForm[]>;
  isLanguageInstalled: (lang: LanguageCode) => boolean;
}

export interface StandardSearchOptions {
  partOfSpeech?: string;
  letter?: string;
}

/**
 * ENGINE 1: STANDARD MONOLINGUAL DICTIONARY SEARCH
 * Operates strictly within a single language without requiring any target language.
 */
export class StandardDictionarySearch {
  private static matchEntry(
    entry: WordEntry,
    senses: WordSense[],
    morphologicalForms: MorphologicalForm[],
    rawQuery: string,
    language: LanguageCode
  ): StandardSearchResult | null {
    const queryLower = rawQuery.toLowerCase();

    const makeResult = (
      score: number,
      matchedField: StandardSearchResult['matchedField'],
      matchedTerm: string
    ): StandardSearchResult => ({
      entry,
      senses,
      morphologicalForms,
      matchedField,
      matchedTerm,
      score,
    });

    // 1. Arabic Script & Root Matching
    if (language === 'ar') {
      const normQueryAr = TextNormalization.normalizeArabic(rawQuery);
      const normHeadwordAr = TextNormalization.normalizeArabic(entry.headword);

      if (entry.headword === rawQuery) {
        return makeResult(100, 'headword-exact', entry.headword);
      }
      if (normHeadwordAr === normQueryAr) {
        return makeResult(95, 'headword-normalized', entry.headword);
      }
      if (normHeadwordAr.startsWith(normQueryAr)) {
        return makeResult(85, 'headword-prefix', entry.headword);
      }
      if (normHeadwordAr.includes(normQueryAr)) {
        return makeResult(75, 'headword-normalized', entry.headword);
      }
      if (entry.rootWord) {
        const normRoot = TextNormalization.normalizeArabic(entry.rootWord).replace(/[\s\-]/g, '');
        const cleanQueryRoot = normQueryAr.replace(/[\s\-]/g, '');
        if (cleanQueryRoot && (normRoot === cleanQueryRoot || normRoot.includes(cleanQueryRoot))) {
          return makeResult(72, 'script-variant', entry.rootWord);
        }
      }
    }

    // 2. Chinese Hanzi (Simplified & Traditional) & Pinyin Matching
    if (language === 'zh') {
      const normPinyinQuery = TextNormalization.normalizePinyin(rawQuery);

      if (entry.headword === rawQuery) {
        return makeResult(100, 'headword-exact', entry.headword);
      }
      if (entry.headwordScriptVariant?.text && entry.headwordScriptVariant.text === rawQuery) {
        return makeResult(98, 'script-variant', entry.headwordScriptVariant.text);
      }
      if (
        entry.headword.includes(rawQuery) ||
        entry.headwordScriptVariant?.text?.includes(rawQuery)
      ) {
        return makeResult(82, 'headword-prefix', entry.headword);
      }
      if (entry.audioPhoneticText && normPinyinQuery) {
        const normPinyinEntry = TextNormalization.normalizePinyin(entry.audioPhoneticText);
        if (normPinyinEntry === normPinyinQuery) {
          return makeResult(92, 'pinyin', entry.audioPhoneticText);
        }
        if (normPinyinEntry.includes(normPinyinQuery)) {
          return makeResult(80, 'pinyin', entry.audioPhoneticText);
        }
      }
    }

    // 3. Latin Orthographies (English, Hausa, Yoruba, Fulfulde, French)
    const { soft: querySoft, deep: queryDeep, vowelFold: queryVowelFold } =
      TextNormalization.normalizeLatin(rawQuery);
    const { soft: headwordSoft, deep: headwordDeep, vowelFold: headwordVowelFold } =
      TextNormalization.normalizeLatin(entry.headword);

    if (entry.headword.toLowerCase() === queryLower) {
      return makeResult(100, 'headword-exact', entry.headword);
    }
    if (querySoft && headwordSoft === querySoft) {
      return makeResult(95, 'headword-normalized', entry.headword);
    }
    if (queryDeep && headwordDeep === queryDeep) {
      return makeResult(90, 'headword-normalized', entry.headword);
    }
    if (headwordVowelFold && queryVowelFold && headwordVowelFold === queryVowelFold) {
      return makeResult(88, 'headword-normalized', entry.headword);
    }
    if (
      (querySoft && headwordSoft.startsWith(querySoft)) ||
      (queryDeep && headwordDeep.startsWith(queryDeep)) ||
      (headwordVowelFold && queryVowelFold && headwordVowelFold.startsWith(queryVowelFold))
    ) {
      return makeResult(82, 'headword-prefix', entry.headword);
    }
    if (
      (querySoft && headwordSoft.includes(querySoft)) ||
      (queryDeep && headwordDeep.includes(queryDeep)) ||
      (headwordVowelFold && queryVowelFold && headwordVowelFold.includes(queryVowelFold))
    ) {
      return makeResult(72, 'headword-normalized', entry.headword);
    }

    // 4. Script Variant (Ajami, Adlam, Traditional Chinese)
    if (entry.headwordScriptVariant?.text) {
      const scriptText = entry.headwordScriptVariant.text;
      const normScriptAr = TextNormalization.normalizeArabic(scriptText);
      const normQueryAr = TextNormalization.normalizeArabic(rawQuery);
      if (
        scriptText === rawQuery ||
        (normQueryAr && normScriptAr && normScriptAr.includes(normQueryAr))
      ) {
        return makeResult(85, 'script-variant', scriptText);
      }
    }

    // 5. Inflected & Morphological Forms (plurals, past tense, broken plurals, derivatives)
    for (const morph of morphologicalForms) {
      const normMorphAr = TextNormalization.normalizeArabic(morph.form);
      const normQueryAr = TextNormalization.normalizeArabic(rawQuery);
      const { soft: morphSoft, deep: morphDeep } = TextNormalization.normalizeLatin(morph.form);

      if (
        morph.form.toLowerCase() === queryLower ||
        (language === 'ar' && normQueryAr && normMorphAr === normQueryAr) ||
        (querySoft && morphSoft === querySoft) ||
        (queryDeep && morphDeep === queryDeep)
      ) {
        return makeResult(88, 'morphology', `${morph.form} (${morph.label})`);
      }

      if (
        (language === 'ar' && normQueryAr && normMorphAr.startsWith(normQueryAr)) ||
        (querySoft && morphSoft.startsWith(querySoft)) ||
        (language === 'zh' && morph.form.includes(rawQuery))
      ) {
        return makeResult(76, 'morphology', `${morph.form} (${morph.label})`);
      }
    }

    // 6. Synonyms & Related Words across senses
    const allSynonyms = new Set<string>([
      ...(entry.synonyms || []),
      ...(entry.relatedWords || []),
      ...senses.flatMap((s) => [...s.synonyms, ...s.relatedWords]),
    ]);

    for (const syn of allSynonyms) {
      const { soft: synSoft, deep: synDeep } = TextNormalization.normalizeLatin(syn);
      const normSynAr = TextNormalization.normalizeArabic(syn);
      const normQueryAr = TextNormalization.normalizeArabic(rawQuery);
      if (
        syn.toLowerCase() === queryLower ||
        (language === 'ar' && normQueryAr && normSynAr === normQueryAr) ||
        (querySoft && synSoft === querySoft) ||
        (queryDeep && synDeep === queryDeep) ||
        (language === 'zh' && syn === rawQuery)
      ) {
        return makeResult(62, 'synonym', syn);
      }
    }

    // 7. Strict whole-word definition fallback
    for (const sense of senses) {
      if (
        TextNormalization.containsWholeWord(sense.definition, rawQuery) ||
        TextNormalization.containsWholeWord(sense.definitionEn, rawQuery)
      ) {
        return makeResult(30, 'definition', sense.definition);
      }
    }

    return null;
  }

  public static search(
    context: StandardSearchContext,
    query: string,
    language: LanguageCode,
    options: StandardSearchOptions = {}
  ): StandardSearchResponse {
    try {
      const { entries, sensesByEntryId, morphologyByEntryId, isLanguageInstalled } = context;
      const partOfSpeech = options.partOfSpeech || 'all';
      const letter = options.letter || 'all';
      const rawQuery = (query || '').trim();

      const languageEntries = entries.filter((e) => e.sourceLang === language);

      if (!isLanguageInstalled(language) || languageEntries.length === 0) {
        return {
          status: 'language_not_installed',
          language,
          query: rawQuery,
          results: [],
          message: `The ${language.toUpperCase()} standard dictionary dataset is not installed or contains no records.`,
        };
      }

      // Filter by part of speech
      const posFiltered = languageEntries.filter((entry) => {
        if (partOfSpeech === 'all') return true;
        const entrySenses = sensesByEntryId.get(entry.id) || [];
        return (
          entry.partOfSpeech.toLowerCase().includes(partOfSpeech.toLowerCase()) ||
          entrySenses.some((s) => s.partOfSpeech.toLowerCase().includes(partOfSpeech.toLowerCase()))
        );
      });

      // BROWSE MODE when query is empty
      if (!rawQuery) {
        const browseEntries = posFiltered
          .filter((entry) => {
            if (letter === 'all') return true;
            const cleanH = entry.headword.replace(/^['"‘“\s]+/, '');
            const first = cleanH
              .charAt(0)
              .toUpperCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '');
            return first === letter;
          })
          .sort((a, b) => a.headword.localeCompare(b.headword));

        const results: StandardSearchResult[] = browseEntries.map((entry) => ({
          entry,
          senses: sensesByEntryId.get(entry.id) || [],
          morphologicalForms: morphologyByEntryId.get(entry.id) || [],
          matchedField: 'headword-normalized',
          matchedTerm: entry.headword,
          score: 10,
        }));

        return {
          status: 'browse',
          language,
          query: '',
          results,
        };
      }

      // SEARCH MODE
      const matches: StandardSearchResult[] = [];
      for (const entry of posFiltered) {
        const senses = sensesByEntryId.get(entry.id) || [];
        const morphologicalForms = morphologyByEntryId.get(entry.id) || [];
        const match = this.matchEntry(entry, senses, morphologicalForms, rawQuery, language);
        if (match) {
          matches.push(match);
        }
      }

      if (matches.length === 0) {
        return {
          status: 'not_found',
          language,
          query: rawQuery,
          results: [],
          message: `No matching entry found for “${rawQuery}” in the ${language.toUpperCase()} dictionary.`,
        };
      }

      // Suppress low-relevance definition matches when headword/morphology matches exist
      const hasStrong = matches.some((m) => m.score >= 60);
      const ranked = (hasStrong ? matches.filter((m) => m.matchedField !== 'definition') : matches).sort(
        (a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.entry.headword.localeCompare(b.entry.headword);
        }
      );

      // Verify definitions exist on matched entries
      const withDefinitions = ranked.filter(
        (r) => r.senses.some((s) => s.definition && s.definition.trim().length > 0) || Boolean(r.entry.definition?.trim())
      );

      if (withDefinitions.length === 0) {
        return {
          status: 'no_definition',
          language,
          query: rawQuery,
          results: ranked,
          message: `Headword “${rawQuery}” exists, but no definition is available in the current dataset.`,
        };
      }

      return {
        status: 'ok',
        language,
        query: rawQuery,
        results: withDefinitions,
      };
    } catch (err) {
      return {
        status: 'error',
        language,
        query: query || '',
        results: [],
        message: err instanceof Error ? err.message : 'Unexpected standard dictionary search error.',
      };
    }
  }
}
