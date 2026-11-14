import { CapacitorSQLite, capSQLiteSet } from '@capacitor-community/sqlite';
import { LanguageCode } from '../types/dictionary';
import { TextNormalization } from '../services/textNormalization';
import { LEXICA_CORE_SCHEMA_STATEMENTS, LEXICA_SQLITE_SCHEMA_VERSION } from './schema';

export interface PocSampleRecord {
  id: string;
  sourceLang: LanguageCode;
  headword: string;
  ipa: string;
  audioPhoneticText: string | null;
  partOfSpeech: string;
  definition: string;
  definitionEn: string;
  examples: Array<{ sourceText: string; targetText: string }>;
  synonyms: string[];
  forms: Array<{ form: string; label: string }>;
}

export interface PocSearchTestResult {
  language: LanguageCode;
  query: string;
  matchedHeadwords: string[];
  ftsMatched: boolean;
  passed: boolean;
}

export interface CapacitorSqlitePocReport {
  databaseName: string;
  schemaVersion: number;
  fts5Verified: boolean;
  insertedCount: number;
  persistedCountAfterReopen: number;
  languageTests: PocSearchTestResult[];
  allPassed: boolean;
}

const POC_DB_NAME = 'lexica_phase1_poc';

export const POC_VERIFIED_SAMPLES: PocSampleRecord[] = [
  {
    id: 'en-hello',
    sourceLang: 'en',
    headword: 'Hello',
    ipa: '/hɛˈloʊ/',
    audioPhoneticText: 'Hello',
    partOfSpeech: 'greeting',
    definition: 'A universal friendly greeting upon meeting.',
    definitionEn: 'A universal friendly greeting upon meeting.',
    examples: [{ sourceText: 'Hello, welcome to our library.', targetText: 'Hello, welcome to our library.' }],
    synonyms: ['greetings', 'hi'],
    forms: [{ form: 'hellos', label: 'plural' }],
  },
  {
    id: 'ha-hello',
    sourceLang: 'ha',
    headword: 'Sannu',
    ipa: '/sàn.núː/',
    audioPhoneticText: 'Sannu',
    partOfSpeech: 'greeting',
    definition: 'Gaisuwar yau da kullum da ake yi wa mutum yayin haduwa.',
    definitionEn: 'Everyday respectful greeting upon meeting someone.',
    examples: [{ sourceText: 'Sannu da zuwa gida.', targetText: 'Welcome home.' }],
    synonyms: ['barka'],
    forms: [{ form: 'sannunku', label: 'plural address' }],
  },
  {
    id: 'yo-earth',
    sourceLang: 'yo',
    headword: 'Ilẹ̀',
    ipa: '/ī.lɛ̀/',
    audioPhoneticText: 'Ilẹ̀',
    partOfSpeech: 'noun',
    definition: 'Ayé tí a ń gbé; erupẹ tí a ń tẹ̀.',
    definitionEn: 'The earth we inhabit; ground, soil, land.',
    examples: [{ sourceText: 'Ilẹ̀ Yorùbá ní ilẹ̀ àlàáfíà.', targetText: 'Yorubaland is a land of peace.' }],
    synonyms: ['ayé', 'ilẹ̀-ayé'],
    forms: [{ form: 'ilẹ̀-ìbílẹ̀', label: 'compound' }],
  },
  {
    id: 'ff-peace',
    sourceLang: 'ff',
    headword: 'Jam',
    ipa: '/d͡ʒam/',
    audioPhoneticText: 'Jam',
    partOfSpeech: 'noun',
    definition: 'Kisal, sellal, e deƴƴere nde alaa fitina.',
    definitionEn: 'Peace, wellness, safety, and serenity without conflict.',
    examples: [{ sourceText: 'Jam tan woni.', targetText: 'There is only peace.' }],
    synonyms: ['deeƴre', 'kisal'],
    forms: [{ form: 'jam-jam', label: 'emphatic' }],
  },
  {
    id: 'ff-water',
    sourceLang: 'ff',
    headword: 'Ndiyam',
    ipa: '/ndi.jam/',
    audioPhoneticText: 'Ndiyam',
    partOfSpeech: 'noun',
    definition: 'Ndiyam laaɓɗam ɗam nguurndam e daabaaji fof ɗaɓɓi.',
    definitionEn: 'Pure water that all living beings depend upon.',
    examples: [{ sourceText: 'Ndiyam ko nguurndam.', targetText: 'Water is life.' }],
    synonyms: ['ndiyam-laaɓɗam'],
    forms: [{ form: 'ndiyamji', label: 'augmentative' }],
  },
  {
    id: 'ar-goodness',
    sourceLang: 'ar',
    headword: 'خَيْرٌ',
    ipa: '/xajr/',
    audioPhoneticText: 'خَيْرٌ',
    partOfSpeech: 'noun',
    definition: 'كل ما فيه نفع وصلاح وسعادة للناس، ونقيض الشر والأذى.',
    definitionEn: 'Goodness, virtue, benefit, and moral welfare.',
    examples: [{ sourceText: 'صَنَعَ خَيْرًا كَثِيرًا.', targetText: 'He did great good.' }],
    synonyms: ['صَلَاحٌ', 'بِرٌّ'],
    forms: [{ form: 'خَيْرَاتٌ', label: 'plural' }],
  },
  {
    id: 'fr-hello',
    sourceLang: 'fr',
    headword: 'Bonjour',
    ipa: '/bɔ̃.ʒuʁ/',
    audioPhoneticText: 'Bonjour',
    partOfSpeech: 'greeting',
    definition: 'Formule polie de salutation employée le jour.',
    definitionEn: 'Polite daytime greeting used upon meeting.',
    examples: [{ sourceText: 'Bonjour, comment allez-vous ?', targetText: 'Hello, how are you?' }],
    synonyms: ['salut'],
    forms: [{ form: 'bonjours', label: 'plural' }],
  },
  {
    id: 'zh-hello',
    sourceLang: 'zh',
    headword: '你好',
    ipa: '/nǐ.xàʊ/',
    audioPhoneticText: 'nǐ hǎo',
    partOfSpeech: 'greeting',
    definition: '与人相见时最常用的礼貌问候语。',
    definitionEn: 'The most common polite greeting when meeting someone.',
    examples: [{ sourceText: '你好，很高兴认识你。', targetText: 'Hello, nice to meet you.' }],
    synonyms: ['您好'],
    forms: [{ form: '你们好', label: 'plural' }],
  },
];

export function normalizeForSqlite(text: string, lang: LanguageCode): {
  soft: string;
  deep: string;
  vowelFold: string;
  pinyinNorm: string;
} {
  if (lang === 'ar') {
    const ar = TextNormalization.normalizeArabic(text);
    return { soft: ar, deep: ar, vowelFold: ar, pinyinNorm: '' };
  }
  if (lang === 'zh') {
    const py = TextNormalization.normalizePinyin(text);
    return { soft: text.trim(), deep: text.trim(), vowelFold: text.trim(), pinyinNorm: py };
  }
  const lat = TextNormalization.normalizeLatin(text);
  return { ...lat, pinyinNorm: '' };
}

/**
 * Isolated Capacitor 7 SQLite Proof of Concept.
 * Designed to execute inside Android WebView via @capacitor-community/sqlite@7.0.3.
 * Does NOT touch LocalDictionaryDatabase or production search engines.
 */
export async function runCapacitorSqlitePoc(): Promise<CapacitorSqlitePocReport> {
  // 1. Create and open persistent database connection
  await CapacitorSQLite.createConnection({
    database: POC_DB_NAME,
    version: LEXICA_SQLITE_SCHEMA_VERSION,
    encrypted: false,
    mode: 'no-encryption',
    readonly: false,
  });
  await CapacitorSQLite.open({ database: POC_DB_NAME, readonly: false });
  let fts5Verified = false;

  try {
    // 2. Execute relational schema + FTS5 DDL
    await CapacitorSQLite.execute({
      database: POC_DB_NAME,
      statements: LEXICA_CORE_SCHEMA_STATEMENTS.join('\n'),
      transaction: true,
    });

    // 3. Explicitly verify FTS5 virtual table exists (never silently substitute)
    const ftsCheck = await CapacitorSQLite.query({
      database: POC_DB_NAME,
      statement: `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'entries_fts';`,
      values: [],
    });
    const ftsSql = String(ftsCheck.values?.[0]?.sql ?? '');
    fts5Verified = ftsSql.toLowerCase().includes('using fts5');
    if (!fts5Verified) {
      throw new Error('SQLite FTS5 virtual table verification failed: entries_fts is missing or not FTS5.');
    }

    // 4. Transactional insert for all 7 supported languages
    const insertSet: capSQLiteSet[] = [
      {
        statement: `INSERT OR REPLACE INTO languages(code, name, native_name, native_script, script_name, direction, speakers_count, accent_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        values: [
          ['en', 'English', 'English', 'English', 'Latin', 'ltr', '1.5+ Billion', '#345E4C'],
          ['ha', 'Hausa', 'Harshen Hausa', 'Harshen Hausa', 'Boko & Ajami', 'ltr', '85+ Million', '#C47248'],
          ['yo', 'Yoruba', 'Èdè Yorùbá', 'Èdè Yorùbá', 'Yoruba Latin', 'ltr', '55+ Million', '#204031'],
          ['ff', 'Fulfulde', 'Pulaar / Fulfulde', 'Fulfulde', 'Latin & Adlam', 'ltr', '40+ Million', '#7B4B3A'],
          ['ar', 'Arabic', 'العَرَبِيَّةُ', 'العَرَبِيَّةُ', 'Arabic Script', 'rtl', '420+ Million', '#2B5B4E'],
          ['fr', 'French', 'Français', 'Français', 'Latin', 'ltr', '320+ Million', '#3B4D6B'],
          ['zh', 'Chinese', '中文', '中文', 'Han Characters', 'ltr', '1.1+ Billion', '#8B3A3A'],
        ],
      },
    ];

    for (const rec of POC_VERIFIED_SAMPLES) {
      const norm = normalizeForSqlite(rec.headword, rec.sourceLang);
      const pyNorm = rec.audioPhoneticText ? TextNormalization.normalizePinyin(rec.audioPhoneticText) : '';
      insertSet.push({
        statement: `INSERT OR REPLACE INTO entries(id, source_lang, headword, headword_norm_soft, headword_norm_deep, headword_vowel_fold, part_of_speech, primary_ipa, audio_phonetic_text, audio_phonetic_norm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        values: [
          rec.id,
          rec.sourceLang,
          rec.headword,
          norm.soft,
          norm.deep,
          norm.vowelFold,
          rec.partOfSpeech,
          rec.ipa,
          rec.audioPhoneticText,
          pyNorm,
        ],
      });
      insertSet.push({
        statement: `INSERT OR REPLACE INTO senses(id, entry_id, sense_number, part_of_speech, definition, definition_en) VALUES (?, ?, 1, ?, ?, ?);`,
        values: [`${rec.id}#s1`, rec.id, rec.partOfSpeech, rec.definition, rec.definitionEn],
      });
      insertSet.push({
        statement: `DELETE FROM entries_fts WHERE entry_id = ?;`,
        values: [rec.id],
      });
      insertSet.push({
        statement: `INSERT INTO entries_fts(entry_id, source_lang, headword, headword_norm_soft, headword_norm_deep, audio_phonetic_norm, forms_text, synonyms_text, definitions_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        values: [
          rec.id,
          rec.sourceLang,
          rec.headword,
          norm.soft,
          norm.deep,
          pyNorm,
          rec.forms.map((f) => f.form).join(' '),
          rec.synonyms.join(' '),
          `${rec.definition} ${rec.definitionEn}`,
        ],
      });
    }

    await CapacitorSQLite.executeSet({
      database: POC_DB_NAME,
      set: insertSet,
      transaction: true,
    });
  } finally {
    // 5. Close database & connection cleanly to simulate app restart
    await CapacitorSQLite.close({ database: POC_DB_NAME }).catch(() => {});
    await CapacitorSQLite.closeConnection({ database: POC_DB_NAME }).catch(() => {});
  }

  // 6. Reopen fresh connection and verify persistence & FTS5 queries
  await CapacitorSQLite.createConnection({
    database: POC_DB_NAME,
    version: LEXICA_SQLITE_SCHEMA_VERSION,
    encrypted: false,
    mode: 'no-encryption',
    readonly: true,
  });
  await CapacitorSQLite.open({ database: POC_DB_NAME, readonly: true });

  try {
    const countRes = await CapacitorSQLite.query({
      database: POC_DB_NAME,
      statement: `SELECT COUNT(*) AS cnt FROM entries;`,
      values: [],
    });
    const persistedCountAfterReopen = Number(countRes.values?.[0]?.cnt ?? 0);

    const probes: Array<{ language: LanguageCode; query: string }> = [
      { language: 'en', query: 'hello' },
      { language: 'ha', query: 'sannu' },
      { language: 'yo', query: 'ilẹ̀' },
      { language: 'ff', query: 'jam' },
      { language: 'ar', query: 'خير' },
      { language: 'fr', query: 'bonjour' },
      { language: 'zh', query: '你好' },
    ];

    const languageTests: PocSearchTestResult[] = [];
    for (const probe of probes) {
      const norm = normalizeForSqlite(probe.query, probe.language);
      const ftsToken = norm.soft.replace(/["*]/g, '');
      const res = await CapacitorSQLite.query({
        database: POC_DB_NAME,
        statement: `
          SELECT e.headword
          FROM entries_fts f
          JOIN entries e ON e.id = f.entry_id
          WHERE e.source_lang = ?
            AND entries_fts MATCH ?
          LIMIT 10;
        `,
        values: [probe.language, `"${ftsToken}"*`],
      });
      const matchedHeadwords = (res.values || []).map((row) => String(row.headword));
      languageTests.push({
        language: probe.language,
        query: probe.query,
        matchedHeadwords,
        ftsMatched: matchedHeadwords.length > 0,
        passed: matchedHeadwords.length > 0,
      });
    }

    return {
      databaseName: POC_DB_NAME,
      schemaVersion: LEXICA_SQLITE_SCHEMA_VERSION,
      fts5Verified,
      insertedCount: POC_VERIFIED_SAMPLES.length,
      persistedCountAfterReopen,
      languageTests,
      allPassed: fts5Verified && persistedCountAfterReopen === POC_VERIFIED_SAMPLES.length && languageTests.every((t) => t.passed),
    };
  } finally {
    await CapacitorSQLite.close({ database: POC_DB_NAME }).catch(() => {});
    await CapacitorSQLite.closeConnection({ database: POC_DB_NAME }).catch(() => {});
  }
}
