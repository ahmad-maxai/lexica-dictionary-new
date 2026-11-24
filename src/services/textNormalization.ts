/**
 * Shared Unicode and Script Normalization Utilities
 * Used independently by both StandardDictionarySearch and MultilingualDictionarySearch.
 */
export class TextNormalization {
  /**
   * Normalizes Arabic text:
   * - Removes Harakat (Tashkeel diacritics) and Tatweel / Kashida
   * - Normalizes Alef variants (أ, إ, آ, ٱ) -> ا
   * - Normalizes Ta Marbuta (ة) -> ه
   * - Normalizes Alef Maksura (ى) -> ي
   */
  public static normalizeArabic(text: string): string {
    if (!text) return '';
    return text
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .trim();
  }

  /**
   * Normalizes Latin-based African & European scripts (English, Hausa, Yoruba, Fulfulde, French):
   * - soft: lowercase + accent/tone mark stripping + apostrophe removal (preserves hooked letters)
   * - deep: additionally maps hooked consonants (ɓ, ɗ, ƙ, ƴ, ŋ, ɲ) and ligatures (œ, æ) to ASCII
   * - vowelFold: collapses duplicate long vowels (aa -> a, ee -> e)
   */
  public static normalizeLatin(text: string): { soft: string; deep: string; vowelFold: string } {
    if (!text) return { soft: '', deep: '', vowelFold: '' };

    const soft = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’'ʽ‘`]/g, '')
      .trim();

    const deep = soft
      .replace(/[ɓƁ]/g, 'b')
      .replace(/[ɗƊ]/g, 'd')
      .replace(/[ƙƘ]/g, 'k')
      .replace(/[ƴƳ]/g, 'y')
      .replace(/[ŋŊ]/g, 'n')
      .replace(/[ɲƝ]/g, 'n')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae');

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
   * Normalizes Yoruba orthography in three distinct tiers:
   * - exact: NFC lowercase preserving all tone marks (à, á, è, é, ẹ̀, ẹ́, ọ̀, ọ́, ǹ, ń, etc.) and under-dots (ẹ, ọ, ṣ)
   * - toneInsensitive: strips High/Low tone marks while preserving under-dots (ẹ, ọ, ṣ)
   * - ascii: strips both tone marks and under-dots to plain ASCII (e, o, s)
   */
  public static normalizeYoruba(text: string): {
    exact: string;
    toneInsensitive: string;
    ascii: string;
    hasToneMarks: boolean;
    hasUnderDots: boolean;
  } {
    if (!text) {
      return {
        exact: '',
        toneInsensitive: '',
        ascii: '',
        hasToneMarks: false,
        hasUnderDots: false,
      };
    }
    const exact = text.normalize('NFC').toLowerCase().trim();
    const decomposed = exact.normalize('NFD');
    const hasToneMarks = /[\u0300\u0301\u0302\u0304\u030C]/.test(decomposed);
    const hasUnderDots = /\u0323/.test(decomposed) || /[ẹọṣ]/.test(exact);

    const toneInsensitive = decomposed
      .replace(/[\u0300\u0301\u0302\u0304\u030C]/g, '')
      .normalize('NFC')
      .trim();

    const ascii = decomposed
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’'ʽ‘`]/g, '')
      .normalize('NFC')
      .trim();

    return { exact, toneInsensitive, ascii, hasToneMarks, hasUnderDots };
  }

  /**
   * Checks whether a candidate string contains query as a whole word (boundary-safe).
   */
  public static containsWholeWord(text: string | null | undefined, query: string): boolean {
    if (!text || query.trim().length < 4) return false;
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[.,!?;:()"])${escaped}($|\\s|[.,!?;:()"])`, 'i');
    return regex.test(text);
  }
}
