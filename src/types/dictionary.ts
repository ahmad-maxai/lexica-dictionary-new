export type LanguageCode = 'en' | 'ha' | 'yo' | 'ff' | 'ar' | 'fr' | 'zh';

export type TextDirection = 'ltr' | 'rtl';

export type DictionaryMode = 'standard' | 'multilingual';

export type EquivalenceType = 'literal' | 'contextual' | 'idiomatic' | 'near-equivalent';

export type SearchStatus =
  | 'ok'
  | 'browse'
  | 'not_found'
  | 'no_definition'
  | 'no_translation'
  | 'language_not_installed'
  | 'invalid_pair'
  | 'error';

export interface DialectOption {
  id: string;
  name: string;
  region: string;
  isStandard?: boolean;
}

export interface LanguageMeta {
  code: LanguageCode;
  name: string;
  nativeName: string;
  nativeScript: string;
  scriptName: string;
  direction: TextDirection;
  speakersCount: string;
  culturalHeritage: string;
  accentColor: string;
  lightSurfaceColor: string;
  darkSurfaceColor: string;
  dialects: DialectOption[];
  /** Approximate serialized local dataset size in KB/MB (computed dynamically at runtime by dictionaryDb) */
  packSizeMb: number;
  /** Number of entries in the bundled starter dataset */
  offlineEntriesCount: number;
  sampleGreeting: {
    word: string;
    transcription: string;
    meaning: string;
  };
  specialChars: string[];
}

export interface ExampleSentence {
  sourceText: string;
  targetText: string;
  literalTranslation?: string;
  culturalContext?: string;
}

export interface MorphologicalForm {
  form: string;
  label: string; // e.g., "plural", "past tense", "broken plural", "feminine", "adverbial"
  note?: string;
}

export interface WordSense {
  id: string; // e.g., "en-peace#s1"
  entryId: string; // e.g., "en-peace"
  senseNumber: number;
  partOfSpeech: string;
  definition: string;
  definitionEn?: string;
  register?: string | null;
  usageNote?: string | null;
  examples: ExampleSentence[];
  synonyms: string[];
  antonyms: string[];
  relatedWords: string[];
}

export interface TranslationRelationship {
  id: string;
  sourceSenseId: string;
  sourceEntryId: string;
  sourceLang: LanguageCode;
  targetSenseId?: string | null;
  targetEntryId?: string | null;
  targetLang: LanguageCode;
  targetHeadword: string;
  transliteration?: string | null;
  scriptVariant?: string | null;
  partOfSpeech: string;
  targetDefinition: string;
  equivalenceType: EquivalenceType;
  contextualNote?: string | null;
  register?: string | null;
  sourceAttribution?: string | null;
}

export interface TranslationEquivalent {
  targetLang: LanguageCode;
  headword: string;
  transliteration?: string | null;
  scriptVariant?: string | null; // e.g., Traditional for Chinese, Ajami for Hausa
  partOfSpeech: string;
  definition: string;
  register?: string | null; // Formal, Colloquial, Literary, Poetic
  equivalenceType?: EquivalenceType;
  contextualNote?: string | null;
  sourceSenseId?: string;
  targetSenseId?: string;
  verifiedOffline: boolean;
}

export interface WordEntry {
  id: string;
  sourceLang: LanguageCode;
  headword: string;
  headwordScriptVariant?: {
    label: string;
    text: string;
  } | null;
  ipa: string;
  audioPhoneticText?: string | null;
  partOfSpeech: string;
  genderOrClass?: string | null; // e.g. "masculine", "feminine", "noun class"
  dialect?: string | null;
  register?: string | null;
  etymology?: string | null;
  rootWord?: string | null; // e.g., Arabic tri-consonantal root
  tonePattern?: string | null; // Yoruba, Hausa, Chinese tones
  definition: string;
  definitionEn: string;
  culturalNote?: string | null;
  /** Structured sense list (populated in shared database layer) */
  senses?: WordSense[];
  /** Inflected and morphological variants */
  morphologicalForms?: MorphologicalForm[];
  relatedWords?: string[];
  translations: Partial<Record<LanguageCode, TranslationEquivalent[]>>;
  examples: ExampleSentence[];
  synonyms: string[];
  antonyms: string[];
  verifiedOffline: boolean;
  verificationStatus?: 'verified' | 'provisional' | 'review_required';
  sourceAttribution?: string | null;
  license?: string | null;
  datasetVersion?: string | null;
  tags: string[];
}

export interface StandardSearchResult {
  entry: WordEntry;
  senses: WordSense[];
  morphologicalForms: MorphologicalForm[];
  matchedField:
    | 'headword-exact'
    | 'headword-normalized'
    | 'headword-prefix'
    | 'script-variant'
    | 'pinyin'
    | 'morphology'
    | 'synonym'
    | 'definition';
  matchedTerm: string;
  score: number;
}

export interface StandardSearchResponse {
  status: SearchStatus;
  language: LanguageCode;
  query: string;
  results: StandardSearchResult[];
  message?: string;
}

export interface MultilingualSenseMatch {
  sourceSense: WordSense;
  relationship: TranslationRelationship;
  targetEntry?: WordEntry | null;
}

export interface MultilingualSearchResult {
  entry: WordEntry;
  matchedField:
    | 'headword-exact'
    | 'headword-normalized'
    | 'headword-prefix'
    | 'script-variant'
    | 'pinyin'
    | 'morphology'
    | 'translation-exact'
    | 'translation-partial'
    | 'definition';
  matchedTerm: string;
  isReverseLookup: boolean;
  score: number;
  senseMatches: MultilingualSenseMatch[];
}

export interface MultilingualSearchResponse {
  status: SearchStatus;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  query: string;
  results: MultilingualSearchResult[];
  /** True when the word exists in sourceLang Standard Dictionary even though targetLang translation links are absent */
  existsInStandardDictionary?: boolean;
  message?: string;
}

export interface Flashcard {
  id: string;
  wordId: string;
  sourceWord: string;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  targetWord: string;
  ipa: string;
  partOfSpeech: string;
  exampleSentence: string;
  masteryLevel: number; // 0 to 5
  lastReviewed?: number;
}

export interface QuizQuestion {
  id: string;
  type: 'meaning' | 'diacritic' | 'translation' | 'spelling';
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  prompt: string;
  question: string;
  phoneticHint?: string;
  correctAnswer: string;
  options: string[];
  explanation: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  iconName: string;
  wordIds: string[];
  isCustom?: boolean;
  createdAt: number;
}

export interface InstalledPack {
  code: LanguageCode;
  installed: boolean;
  version: string;
  sizeMb: number;
  downloadDate?: number;
  lastUpdated?: number;
}

export interface UserPreferences {
  hasCompletedOnboarding: boolean;
  interfaceLang: LanguageCode;
  theme: 'light' | 'dark' | 'system';
  dictionaryMode: DictionaryMode;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  audioPronunciation: boolean;
  showPhonetics: boolean;
  installedPacks: Record<LanguageCode, InstalledPack>;
  savedWordIds: string[];
  recentSearches: string[];
  quizStreak: number;
  totalQuizzesTaken: number;
  totalCardsReviewed: number;
}
