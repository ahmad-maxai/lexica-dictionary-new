export type LanguageCode = 'en' | 'ha' | 'yo' | 'ff' | 'ar' | 'fr' | 'zh';

export type TextDirection = 'ltr' | 'rtl';

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
  accentColor: string; // Tailored color matching the cultural motif
  lightSurfaceColor: string;
  darkSurfaceColor: string;
  dialects: DialectOption[];
  packSizeMb: number;
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

export interface TranslationEquivalent {
  targetLang: LanguageCode;
  headword: string;
  transliteration?: string;
  scriptVariant?: string; // e.g., Traditional for Chinese, Ajami for Hausa
  partOfSpeech: string;
  definition: string;
  register?: string; // Formal, Colloquial, Literary, Poetic
  verifiedOffline: boolean;
}

export interface WordEntry {
  id: string;
  sourceLang: LanguageCode;
  headword: string;
  headwordScriptVariant?: {
    label: string;
    text: string;
  };
  ipa: string;
  audioPhoneticText?: string;
  partOfSpeech: string;
  genderOrClass?: string; // e.g. "masculine", "feminine", "noun class"
  dialect?: string;
  register?: string;
  etymology?: string;
  rootWord?: string; // e.g., Arabic tri-consonantal root or Proto-Bantu/Afroasiatic
  tonePattern?: string; // Yoruba, Hausa, Chinese tones
  definition: string;
  definitionEn: string;
  culturalNote?: string;
  translations: Partial<Record<LanguageCode, TranslationEquivalent[]>>;
  examples: ExampleSentence[];
  synonyms: string[];
  antonyms: string[];
  verifiedOffline: boolean;
  verificationStatus?: 'verified' | 'provisional' | 'review_required';
  sourceAttribution?: string;
  tags: string[];
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
