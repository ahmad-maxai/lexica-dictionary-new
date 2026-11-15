import { WordEntry, Collection } from '../types/dictionary';

export const WORD_OF_THE_DAY_ID = 'word-lafiya-ha';

export const WORD_OF_THE_DAY_FALLBACK: WordEntry = {
  id: 'word-lafiya-ha',
  sourceLang: 'ha',
  headword: 'Lafiya',
  headwordScriptVariant: { label: 'Ajami Script', text: 'لَافِيَا' },
  ipa: '/làː.fí.yàː/',
  audioPhoneticText: 'La-fi-ya',
  partOfSpeech: 'noun',
  genderOrClass: 'feminine',
  dialect: 'Standard Kano (Kananci)',
  register: 'Core Daily Lexicon',
  etymology: 'Borrowed through trans-Saharan cultural contact from Arabic al-ʿāfiyah (العَافِيَة, health/well-being).',
  definition: 'Good health, soundness of body and spirit, safety, peaceful coexistence.',
  definitionEn: 'Good health, peace, safety, complete well-being.',
  culturalNote:
    'In Hausa culture, asking "Ina lafiya?" (Where is health/peace?) is the paramount greeting before any transaction or discussion begins.',
  verifiedOffline: true,
  tags: ['Greetings', 'Health', 'Cultural Pillars'],
  translations: {},
  examples: [],
  synonyms: ['ƙoshin lafiya', 'salama', 'nutsuwa', 'kwanciyar hankali'],
  antonyms: ['rashin lafiya', 'fitina', 'tashin hankali'],
};

export const CURATED_COLLECTIONS: Collection[] = [
  {
    id: 'col-core-virtues',
    name: 'Moral Virtues & Character',
    description:
      'Foundational expressions of peace, wisdom, patience, and fortitude across African, Asian, and European idioms.',
    iconName: 'Sparkles',
    wordIds: [
      'word-peace-en',
      'word-lafiya-ha',
      'word-ogbon-yo',
      'word-hakkillo-ff',
      'word-hikmah-ar',
      'word-sabr-ar',
      'word-karfin-hali-ha',
    ],
    createdAt: 1740000000000,
  },
  {
    id: 'col-greetings-welcome',
    name: 'Sacred Greetings & Hospitality',
    description:
      'How traditional cultures honor visitors, welcome guests, and wish peace upon arrival.',
    iconName: 'HeartHandshake',
    wordIds: ['word-peace-en', 'word-lafiya-ha', 'word-hospitalite-fr', 'word-study-zh'],
    createdAt: 1740000001000,
  },
  {
    id: 'col-journey-trade',
    name: 'Trans-Saharan & Silk Roads',
    description: 'Lexicon of caravan journeys, sojourns, study, and linguistic exchange.',
    iconName: 'Compass',
    wordIds: ['word-irin-ajo-yo', 'word-study-zh', 'word-karfin-hali-ha'],
    createdAt: 1740000002000,
  },
];
