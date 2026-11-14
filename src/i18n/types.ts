import { LanguageCode, SearchStatus, QuizQuestion } from '../types/dictionary';

export interface UiCopy {
  common: {
    appName: string;
    offlineBadge: string;
    listen: string;
    pronounce: string;
    saveWord: string;
    saved: string;
    savedToCollection: string;
    close: string;
    cancel: string;
    details: string;
    viewEntry: string;
    all: string;
    loading: string;
    standardBadge: string;
    clearSearch: string;
  };
  nav: {
    home: string;
    dictionary: string;
    learn: string;
    saved: string;
    library: string;
    changeInterfaceLang: string;
    switchToLight: string;
    switchToDark: string;
    openSettings: string;
  };
  onboarding: {
    chooseTitle: string;
    subtitle: string;
    enterDictionary: string;
    offlineFootnote: string;
    pronounceTitle: string;
  };
  modes: {
    standard: string;
    multilingual: string;
  };
  search: {
    dictionaryLanguage: string;
    sourceLanguage: string;
    targetLanguage: string;
    swapLanguages: string;
    swapSourceTarget: string;
    quickPairs: string;
    homeStandardPlaceholder: string; // {lang}
    homeMultilingualPlaceholder: string; // {src}, {tgt}
    dictStandardPlaceholder: string; // {lang}, {sample}
    dictMultilingualPlaceholder: string; // {src}, {tgt}, {sample}
    dictionarySubtitle: string; // {lang}
    matchSingular: string;
    matchPlural: string;
    entrySingular: string;
    entryPlural: string;
    diacriticsLabel: string; // {code}
    allClasses: string;
    browseAZ: string;
    formLabel: string;
    synonymMatchLabel: string;
    synonymShortLabel: string;
    formsPrefix: string;
    synonymsPrefix: string;
    reverseMatch: string;
    moreSenseSingular: string;
    moreSensePlural: string;
    recentLookups: string;
    wordOfTheDay: string;
    exploreSenses: string;
    culturalCollections: string;
    curatedConcepts: string; // {count}
  };
  statuses: {
    language_not_installed_title: string;
    language_not_installed_desc: string;
    invalid_pair_home_title: string;
    invalid_pair_dict_title: string;
    invalid_pair_desc: string;
    no_definition_title: string;
    no_definition_desc: string;
    no_translation_title: string; // {target}
    no_translation_desc: string; // {source}, {target}
    not_found_home_standard: string; // {source}
    not_found_home_multilingual: string; // {source}, {target}
    not_found_dict: string; // {query}
    not_found_desc: string; // {query}
    browse_empty_title: string; // {source}
    browse_empty_desc: string;
    error_title: string;
    error_desc: string;
    openLanguageLibrary: string;
    viewInStandardDict: string; // {lang}
    switchToStandardDict: string; // {lang}
    foundInAnotherLang: string;
    existsInLang: string; // {word}, {lang}
    switchToLang: string; // {lang}
  };
  learn: {
    title: string;
    subtitle: string;
    dayUnit: string;
    streakLabel: string;
    reviewedLabel: string;
    spacedFlashcards: string;
    diacriticQuiz: string;
    noPacksActive: string;
    cardOf: string; // {current}, {total}
    tapToReveal: string;
    flipToSeeTranslation: string; // {target}
    translationHeading: string; // {target}
    culturalInsight: string;
    previous: string;
    showTerm: string;
    showMeaning: string;
    nextCard: string;
    questionOf: string; // {current}, {total}
    scoreLabel: string; // {score}, {answered}
    hintPrefix: string;
    linguisticRationale: string;
    checkAnswer: string;
    nextQuestion: string;
    completeQuiz: string;
    sessionCompleted: string;
    quizScoreSummary: string; // {score}, {total}
    retakeQuiz: string;
    reviewFlashcards: string;
  };
  saved: {
    title: string;
    subtitle: string;
    savedWordsCount: string; // {count}
    bookmarkedWordsTab: string; // {count}
    collectionsTab: string; // {count}
    historyTab: string;
    allLanguages: string;
    translationPrefix: string;
    removeBookmark: string;
    noSavedTitle: string;
    noSavedDesc: string;
    collectionsSubtitle: string;
    newCollection: string;
    createCollectionTitle: string;
    collectionNamePlaceholder: string;
    collectionDescPlaceholder: string;
    defaultCollectionDesc: string;
    saveCollection: string;
    entriesCount: string; // {count}
    customUserFolder: string;
    curatedEditorialSet: string;
    browseCollectionWords: string;
    historySubtitle: string;
    clearHistory: string;
    noRecentSearches: string;
    noRecentSearchesDesc: string;
  };
  library: {
    title: string;
    subtitle: string;
    localDataSummary: string; // {mb}, {entries}, {active}
    speakersLabel: string;
    entriesInline: string; // {entries}, {senses}
    notInstalledStatus: string;
    updating: string;
    installed: string;
    installPack: string;
    entriesBox: string;
    wordSensesBox: string;
    translationLinksBox: string;
    culturalScopePrefix: string;
    dialectsHeader: string; // {count}
    preservedChars: string;
  };
  wordDetail: {
    copyCitation: string;
    tonePrefix: string;
    usagePrefix: string;
    noDefinitionDataset: string;
    morphologicalForms: string;
    crossLangRelationships: string;
    linkedSenseSingular: string; // {count}
    linkedSensePlural: string; // {count}
    selectedTarget: string;
    explorePair: string;
    sensePrefix: string; // {num}
    contextPrefix: string;
    noCrossLangLinks: string;
    exampleSentencesTitle: string;
    etymologyLoreTitle: string;
    linguisticRoot: string;
    synonyms: string;
    antonyms: string;
    relatedWords: string;
    sourcePrefix: string;
  };
  settings: {
    title: string;
    defaultInterfaceLang: string;
    interfaceLangDesc: string;
    displayTheme: string;
    lightTheme: string;
    darkTheme: string;
    audioAndPhonetics: string;
    audioPronunciation: string;
    audioPronunciationDesc: string;
    ipaTranscriptions: string;
    ipaTranscriptionsDesc: string;
    resetOnboarding: string;
  };
}

export interface LocalizedContentCopy {
  langNames: Record<LanguageCode, string>;
  scriptNames: Record<LanguageCode, string>;
  scriptShortNames: Record<LanguageCode, string>;
  speakersCounts: Record<LanguageCode, string>;
  culturalHeritage: Record<LanguageCode, string>;
  greetingMeanings: Record<LanguageCode, string>;
  posLabels: {
    noun: string;
    verb: string;
    adjective: string;
    phrase: string;
    greeting: string;
    idiomaticNounPhrase: string;
    verbNoun: string;
    nounAdjective: string;
    other: string;
  };
  equivalenceLabels: {
    literal: string;
    contextual: string;
    idiomatic: string;
    'near-equivalent'?: string;
    [key: string]: string | undefined;
  };
  wotdNotes: {
    definition: string;
  };
  collections: Record<string, { name: string; description: string }>;
  quizQuestions: QuizQuestion[];
}

export type StatusKey = Exclude<SearchStatus, 'ok' | 'browse'>;
