import { WordEntry, LanguageCode, TranslationEquivalent } from '../types/dictionary';
import { TextNormalization } from './textNormalization';
import { StandardDictionarySearch } from './standardDictionarySearch';
import { MultilingualDictionarySearch } from './multilingualDictionarySearch';

export interface SearchMatchResult {
  entry: WordEntry;
  score: number;
  matchedField:
    | 'headword-exact'
    | 'headword-normalized'
    | 'headword-prefix'
    | 'script-variant'
    | 'translation-exact'
    | 'translation-partial'
    | 'pinyin'
    | 'definition';
  matchedTerm: string;
  targetTranslation?: TranslationEquivalent;
}

/**
 * Compatibility facade delegating normalization to shared TextNormalization
 * and routing searches through the two independent engines (StandardDictionarySearch & MultilingualDictionarySearch).
 */
export class MultilingualSearchEngine {
  public static normalizeArabic(text: string): string {
    return TextNormalization.normalizeArabic(text);
  }

  public static normalizeLatin(text: string): { soft: string; deep: string; vowelFold: string } {
    return TextNormalization.normalizeLatin(text);
  }

  public static normalizePinyin(text: string): string {
    return TextNormalization.normalizePinyin(text);
  }

  public static search(
    entries: WordEntry[],
    query: string,
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    partOfSpeech: string = 'all'
  ): WordEntry[] {
    const sensesByEntryId = new Map(entries.map((e) => [e.id, e.senses || []]));
    const morphologyByEntryId = new Map(entries.map((e) => [e.id, e.morphologicalForms || []]));

    if (sourceLang === targetLang) {
      return StandardDictionarySearch.search(
        {
          entries,
          sensesByEntryId,
          morphologyByEntryId,
          isLanguageInstalled: () => true,
        },
        query,
        sourceLang,
        { partOfSpeech }
      ).results.map((r) => r.entry);
    }

    const entriesById = new Map(entries.map((e) => [e.id, e]));
    const sensesById = new Map(entries.flatMap((e) => (e.senses || []).map((s) => [s.id, s] as const)));
    const translationLinksByEntryId = new Map(
      entries.map((e) => {
        const links = Object.entries(e.translations || {}).flatMap(([tLang, eqs]) =>
          (eqs || []).map((eq, idx) => ({
            id: `${e.id}->${tLang}#${idx + 1}`,
            sourceSenseId: eq.sourceSenseId || `${e.id}#s1`,
            sourceEntryId: e.id,
            sourceLang: e.sourceLang,
            targetSenseId: eq.targetSenseId || null,
            targetEntryId: null,
            targetLang: tLang as LanguageCode,
            targetHeadword: eq.headword,
            transliteration: eq.transliteration || null,
            scriptVariant: eq.scriptVariant || null,
            partOfSpeech: eq.partOfSpeech,
            targetDefinition: eq.definition,
            equivalenceType: eq.equivalenceType || ('literal' as const),
            contextualNote: eq.contextualNote || null,
            register: eq.register || null,
            sourceAttribution: e.sourceAttribution || null,
          }))
        );
        return [e.id, links] as const;
      })
    );

    return MultilingualDictionarySearch.search(
      {
        entries,
        entriesById,
        sensesById,
        sensesByEntryId,
        morphologyByEntryId,
        translationLinksByEntryId,
        isLanguageInstalled: () => true,
      },
      query,
      sourceLang,
      targetLang,
      { partOfSpeech }
    ).results.map((r) => r.entry);
  }
}
