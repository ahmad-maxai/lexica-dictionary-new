import { MorphologicalForm, EquivalenceType, ExampleSentence } from '../types/dictionary';

export interface SenseEnrichment {
  partOfSpeech?: string;
  definition: string;
  definitionEn?: string;
  register?: string;
  usageNote?: string;
  examples?: ExampleSentence[];
  synonyms?: string[];
  antonyms?: string[];
  relatedWords?: string[];
}

export interface EntryEnrichment {
  senses?: SenseEnrichment[];
  morphologicalForms?: MorphologicalForm[];
  synonyms?: string[];
  antonyms?: string[];
  relatedWords?: string[];
  examples?: ExampleSentence[];
  etymology?: string;
  culturalNote?: string;
}

export interface TranslationLinkAnnotation {
  equivalenceType: EquivalenceType;
  contextualNote: string;
}

/**
 * Curated linguistic enrichments (multiple senses, morphological forms,
 * synonyms, antonyms, related words, and authentic usage examples)
 * keyed by entry ID.
 */
export const LEXICON_ENRICHMENTS: Record<string, EntryEnrichment> = {
  // ========================
  // ENGLISH
  // ========================
  'en-water': {
    etymology: 'From Old English wæter, Proto-Germanic *watōr, cognate with Latin unda and Greek hydōr.',
    morphologicalForms: [
      { form: 'waters', label: 'plural / 3rd-person verb', note: 'bodies of water or applies water to' },
      { form: 'watered', label: 'past tense / participle' },
      { form: 'watering', label: 'present participle / gerund' },
      { form: 'watery', label: 'adjective derivative' },
    ],
    synonyms: ['H2O', 'aqua', 'moisture', 'freshwater'],
    antonyms: ['drought', 'aridity', 'dryness'],
    relatedWords: ['river', 'rain', 'drink', 'ocean', 'well'],
    senses: [
      {
        partOfSpeech: 'noun',
        definition: 'A colorless, transparent, odorless liquid that forms the seas, lakes, rivers, and rain, and is essential for all living organisms.',
        register: 'Standard',
        examples: [
          {
            sourceText: 'Clean drinking water is essential for community health.',
            targetText: 'Clean water sustains life across every household.',
          },
        ],
        synonyms: ['aqua', 'freshwater', 'drinking water'],
        relatedWords: ['rain', 'river', 'drink'],
      },
      {
        partOfSpeech: 'verb',
        definition: 'To pour or sprinkle water over plants, soil, or animals to encourage growth or give drink.',
        register: 'Everyday',
        usageNote: 'Transitive verb: "to water the garden".',
        examples: [
          {
            sourceText: 'We water the courtyard trees every morning before sunrise.',
            targetText: 'Irrigation keeps the saplings thriving.',
          },
        ],
        synonyms: ['irrigate', 'sprinkle', 'hydrate'],
        antonyms: ['parch', 'dry out'],
      },
    ],
  },
  'en-peace': {
    morphologicalForms: [
      { form: 'peaces', label: 'plural (rare)' },
      { form: 'peaceful', label: 'adjective derivative' },
      { form: 'peacefully', label: 'adverb derivative' },
      { form: 'peacemaker', label: 'compound noun' },
    ],
    synonyms: ['serenity', 'tranquility', 'harmony', 'accord', 'amity'],
    antonyms: ['war', 'conflict', 'strife', 'turmoil'],
    relatedWords: ['goodness', 'patience', 'welcome'],
    senses: [
      {
        partOfSpeech: 'noun',
        definition: 'Freedom from civil disturbance, strife, or war; a state of social harmony and treaty.',
        register: 'Formal & General',
        examples: [
          {
            sourceText: 'The neighboring towns lived together in lasting peace.',
            targetText: 'Communal harmony preserved trade and kinship.',
          },
        ],
        synonyms: ['accord', 'truce', 'harmony'],
        antonyms: ['war', 'hostility', 'conflict'],
      },
      {
        partOfSpeech: 'noun',
        definition: 'Inner mental or spiritual calm and freedom from anxiety.',
        register: 'Literary & Reflective',
        usageNote: 'Often used in the idiom "peace of mind".',
        examples: [
          {
            sourceText: 'Patience brings peace of mind during difficult seasons.',
            targetText: 'Inner tranquility sustains wisdom.',
          },
        ],
        synonyms: ['serenity', 'calmness', 'repose'],
        antonyms: ['agitation', 'anxiety'],
      },
    ],
  },
  'en-house': {
    morphologicalForms: [
      { form: 'houses', label: 'plural noun / 3rd-person verb' },
      { form: 'housed', label: 'past tense' },
      { form: 'housing', label: 'noun / present participle' },
    ],
    synonyms: ['home', 'dwelling', 'residence', 'abode', 'domicile'],
    antonyms: ['outdoors', 'wilderness'],
    relatedWords: ['door', 'room', 'family', 'shelter'],
    senses: [
      {
        partOfSpeech: 'noun',
        definition: 'A building constructed for human habitation, especially by one family or household.',
        examples: [
          {
            sourceText: 'Guests are always greeted warmly at the door of our house.',
            targetText: 'Hospitality begins at the threshold of the home.',
          },
        ],
        synonyms: ['residence', 'dwelling', 'home'],
      },
      {
        partOfSpeech: 'noun',
        definition: 'A family lineage, dynasty, or household as a social unit.',
        register: 'Formal / Literary',
        examples: [
          {
            sourceText: 'The elders of the house gathered to welcome the travelers.',
            targetText: 'The household elders met in council.',
          },
        ],
        synonyms: ['household', 'lineage', 'clan'],
      },
    ],
  },
  'en-heart': {
    morphologicalForms: [
      { form: 'hearts', label: 'plural' },
      { form: 'heartfelt', label: 'adjective compound' },
      { form: 'hearty', label: 'adjective derivative' },
    ],
    synonyms: ['core', 'soul', 'compassion', 'center'],
    antonyms: ['indifference', 'periphery'],
    relatedWords: ['love', 'goodness', 'head', 'hand'],
    senses: [
      {
        partOfSpeech: 'noun',
        definition: 'The hollow muscular organ that pumps blood through the circulatory system.',
        examples: [
          {
            sourceText: 'Regular walking strengthens the heart and lungs.',
            targetText: 'Cardiovascular health relies on movement.',
          },
        ],
        synonyms: ['cardiac organ'],
      },
      {
        partOfSpeech: 'noun',
        definition: 'The emotional or moral center of a person; seat of affection, courage, and sincerity.',
        examples: [
          {
            sourceText: 'She spoke from the heart with patience and honesty.',
            targetText: 'Sincere speech moves listeners.',
          },
        ],
        synonyms: ['soul', 'spirit', 'affection', 'core'],
        antonyms: ['coldness', 'apathy'],
      },
    ],
  },
  'en-good': {
    morphologicalForms: [
      { form: 'better', label: 'comparative adjective' },
      { form: 'best', label: 'superlative adjective' },
      { form: 'goods', label: 'plural noun (merchandise)' },
      { form: 'goodness', label: 'noun derivative' },
    ],
    synonyms: ['fine', 'virtuous', 'beneficial', 'worthy', 'excellent'],
    antonyms: ['bad', 'evil', 'harmful', 'poor'],
    relatedWords: ['goodness', 'wisdom', 'peace'],
    senses: [
      {
        partOfSpeech: 'adjective',
        definition: 'Of high quality, satisfactory, or favorable to well-being.',
        examples: [
          {
            sourceText: 'Good rains early in the season promise an abundant harvest.',
            targetText: 'Favorable rainfall supports crops.',
          },
        ],
        synonyms: ['fine', 'excellent', 'wholesome'],
        antonyms: ['bad', 'inferior'],
      },
      {
        partOfSpeech: 'adjective',
        definition: 'Morally upright, kind, and benevolent toward others.',
        examples: [
          {
            sourceText: 'A good neighbor shares bread and greets everyone kindly.',
            targetText: 'Moral character shows in daily kindness.',
          },
        ],
        synonyms: ['virtuous', 'kind', 'honorable'],
        antonyms: ['wicked', 'cruel'],
      },
    ],
  },
  'en-goodness': {
    morphologicalForms: [
      { form: 'good', label: 'root adjective' },
      { form: 'goodnesses', label: 'plural (rare)' },
    ],
    synonyms: ['virtue', 'benevolence', 'kindness', 'integrity', 'rectitude'],
    antonyms: ['malice', 'wickedness', 'cruelty'],
    relatedWords: ['good', 'wisdom', 'patience', 'peace'],
    senses: [
      {
        partOfSpeech: 'noun',
        definition: 'The quality of being morally upright, benevolent, generous, and constructive.',
        examples: [
          {
            sourceText: 'True goodness is measured by quiet acts of service.',
            targetText: 'Virtue appears in selfless kindness.',
          },
        ],
        synonyms: ['virtue', 'benevolence', 'kindness'],
        antonyms: ['malice', 'wickedness'],
      },
    ],
  },
  'en-man': {
    morphologicalForms: [
      { form: 'men', label: 'irregular plural' },
      { form: "man's", label: 'possessive singular' },
      { form: 'manned', label: 'past tense verb' },
    ],
    synonyms: ['gentleman', 'adult male', 'person'],
    antonyms: ['woman', 'boy'],
    relatedWords: ['person', 'woman', 'father', 'brother'],
  },
  'en-woman': {
    morphologicalForms: [
      { form: 'women', label: 'irregular plural' },
      { form: 'womanhood', label: 'abstract noun' },
    ],
    synonyms: ['lady', 'adult female'],
    antonyms: ['man', 'girl'],
    relatedWords: ['person', 'mother', 'sister'],
  },
  'en-child': {
    morphologicalForms: [
      { form: 'children', label: 'irregular plural' },
      { form: 'childhood', label: 'noun derivative' },
    ],
    synonyms: ['youngster', 'youth', 'offspring', 'kid'],
    antonyms: ['adult', 'elder'],
    relatedWords: ['father', 'mother', 'family'],
  },
  'en-foot': {
    morphologicalForms: [
      { form: 'feet', label: 'irregular plural' },
      { form: 'footed', label: 'adjective / verb' },
    ],
    synonyms: ['paw', 'base', 'step'],
    relatedWords: ['hand', 'head', 'go'],
  },
  'en-go': {
    morphologicalForms: [
      { form: 'goes', label: '3rd-person singular' },
      { form: 'went', label: 'irregular past tense' },
      { form: 'gone', label: 'past participle' },
      { form: 'going', label: 'present participle' },
    ],
    synonyms: ['depart', 'travel', 'proceed', 'walk', 'move'],
    antonyms: ['come', 'arrive', 'stay', 'remain'],
    relatedWords: ['come', 'foot'],
    senses: [
      {
        partOfSpeech: 'verb',
        definition: 'To move or travel from one place to another.',
        examples: [
          {
            sourceText: 'Every morning the traders go to the central market.',
            targetText: 'Travel and movement begin at dawn.',
          },
        ],
        synonyms: ['travel', 'depart', 'proceed'],
        antonyms: ['stay', 'arrive'],
      },
    ],
  },
  'en-come': {
    morphologicalForms: [
      { form: 'comes', label: '3rd-person singular' },
      { form: 'came', label: 'irregular past tense' },
      { form: 'coming', label: 'present participle' },
    ],
    synonyms: ['arrive', 'approach', 'reach'],
    antonyms: ['go', 'depart', 'leave'],
    relatedWords: ['go', 'welcome'],
  },
  'en-eat': {
    morphologicalForms: [
      { form: 'eats', label: '3rd-person singular' },
      { form: 'ate', label: 'irregular past tense' },
      { form: 'eaten', label: 'past participle' },
      { form: 'eating', label: 'present participle' },
    ],
    synonyms: ['consume', 'dine', 'feast', 'partake'],
    antonyms: ['fast', 'starve'],
    relatedWords: ['food', 'bread', 'rice', 'meat', 'drink'],
  },
  'en-drink': {
    morphologicalForms: [
      { form: 'drinks', label: 'plural / 3rd-person' },
      { form: 'drank', label: 'irregular past tense' },
      { form: 'drunk', label: 'past participle' },
      { form: 'drinking', label: 'present participle' },
    ],
    synonyms: ['sip', 'imbibe', 'beverage'],
    relatedWords: ['water', 'milk', 'eat'],
  },
  'en-see': {
    morphologicalForms: [
      { form: 'sees', label: '3rd-person singular' },
      { form: 'saw', label: 'irregular past tense' },
      { form: 'seen', label: 'past participle' },
      { form: 'seeing', label: 'present participle' },
    ],
    synonyms: ['behold', 'observe', 'perceive', 'understand', 'witness'],
    antonyms: ['overlook', 'ignore'],
    relatedWords: ['eye', 'know'],
    senses: [
      {
        partOfSpeech: 'verb',
        definition: 'To perceive with the eyes; to look at or witness visually.',
        synonyms: ['observe', 'spot', 'witness'],
      },
      {
        partOfSpeech: 'verb',
        definition: 'To understand or grasp the truth of a matter mentally.',
        usageNote: 'As in "I see what you mean".',
        synonyms: ['comprehend', 'grasp', 'realize'],
      },
    ],
  },
  'en-know': {
    morphologicalForms: [
      { form: 'knows', label: '3rd-person singular' },
      { form: 'knew', label: 'irregular past tense' },
      { form: 'known', label: 'past participle' },
      { form: 'knowing', label: 'present participle' },
    ],
    synonyms: ['understand', 'comprehend', 'recognize'],
    antonyms: ['ignore', 'forget'],
    relatedWords: ['knowledge', 'wisdom', 'book'],
  },
  'en-speak': {
    morphologicalForms: [
      { form: 'speaks', label: '3rd-person singular' },
      { form: 'spoke', label: 'irregular past tense' },
      { form: 'spoken', label: 'past participle' },
      { form: 'speaking', label: 'present participle' },
    ],
    synonyms: ['talk', 'converse', 'utter', 'articulate'],
    antonyms: ['listen', 'keep silent'],
    relatedWords: ['mouth', 'ear'],
  },
  'en-knowledge': {
    morphologicalForms: [
      { form: 'know', label: 'root verb' },
      { form: 'knowledgeable', label: 'adjective derivative' },
    ],
    synonyms: ['learning', 'scholarship', 'erudition', 'understanding'],
    antonyms: ['ignorance'],
    relatedWords: ['wisdom', 'book', 'know'],
  },
  'en-wisdom': {
    morphologicalForms: [
      { form: 'wise', label: 'adjective root' },
      { form: 'wisely', label: 'adverb derivative' },
    ],
    synonyms: ['sagacity', 'insight', 'prudence', 'discernment'],
    antonyms: ['folly', 'foolishness'],
    relatedWords: ['knowledge', 'patience', 'goodness'],
  },
  'en-patience': {
    morphologicalForms: [
      { form: 'patient', label: 'adjective derivative' },
      { form: 'patiently', label: 'adverb derivative' },
    ],
    synonyms: ['endurance', 'forbearance', 'perseverance', 'composure'],
    antonyms: ['impatience', 'haste', 'anger'],
    relatedWords: ['peace', 'wisdom', 'goodness'],
  },
  'en-book': {
    morphologicalForms: [
      { form: 'books', label: 'plural noun / 3rd-person verb' },
      { form: 'booked', label: 'past tense verb' },
    ],
    synonyms: ['volume', 'tome', 'text', 'manuscript'],
    relatedWords: ['knowledge', 'wisdom'],
    senses: [
      {
        partOfSpeech: 'noun',
        definition: 'A written or printed work consisting of pages bound together along one edge.',
        synonyms: ['volume', 'text', 'publication'],
      },
      {
        partOfSpeech: 'verb',
        definition: 'To reserve accommodation, transport, or a time slot in advance.',
        synonyms: ['reserve', 'schedule'],
      },
    ],
  },
  'en-fire': {
    morphologicalForms: [
      { form: 'fires', label: 'plural' },
      { form: 'fiery', label: 'adjective derivative' },
    ],
    synonyms: ['flame', 'blaze', 'ember', 'hearth'],
    antonyms: ['water', 'ice'],
    relatedWords: ['hot', 'sun'],
  },
  'en-day': {
    morphologicalForms: [
      { form: 'days', label: 'plural' },
      { form: 'daily', label: 'adjective / adverb' },
    ],
    synonyms: ['daylight', 'daytime', 'date'],
    antonyms: ['night'],
    relatedWords: ['sun', 'night'],
  },
  'en-night': {
    morphologicalForms: [
      { form: 'nights', label: 'plural' },
      { form: 'nightly', label: 'adjective / adverb' },
    ],
    synonyms: ['nighttime', 'evening', 'darkness'],
    antonyms: ['day', 'daylight'],
    relatedWords: ['moon', 'sleep', 'day'],
  },

  // ========================
  // HAUSA
  // ========================
  'ha-water': {
    morphologicalForms: [
      { form: 'ruwaye', label: 'plural' },
      { form: 'ruwan sha', label: 'compound (drinking water)' },
    ],
    synonyms: ['ruwan sha', 'rafi'],
    antonyms: ['ƙishi', 'fari'],
    relatedWords: ['ruwan sama', 'sha', 'kogi'],
    senses: [
      {
        partOfSpeech: 'noun (masc.)',
        definition: 'Sinadari mai ruwa-ruwa marar launi ko wari wanda ke raya dukkan halittu.',
        definitionEn: 'Clear liquid essential for life, drinking, agriculture, and cleansing.',
        examples: [
          {
            sourceText: 'Ruwa mai tsafta yana kāre lafiyar jiki.',
            targetText: 'Clean water protects physical health.',
          },
        ],
        synonyms: ['ruwan sha'],
      },
    ],
  },
  'ha-house': {
    morphologicalForms: [
      { form: 'gidaje', label: 'plural' },
      { form: 'maigida', label: 'compound (head of household)' },
      { form: 'uwargida', label: 'compound (mistress of the house)' },
    ],
    synonyms: ['muhalli', 'wurin zama', 'mazauni'],
    relatedWords: ['ƙofa', 'ɗaki', 'uba', 'uwa'],
    senses: [
      {
        partOfSpeech: 'noun (masc.)',
        definition: 'Gini ko muhalli na zama da iyali ke rayuwa a ciki.',
        definitionEn: 'A dwelling structure or compound where a household resides.',
        examples: [
          {
            sourceText: 'Barka da zuwa gidanmu, ga ruwa ku sha.',
            targetText: 'Welcome to our home; please have some water.',
          },
        ],
        synonyms: ['muhalli', 'mazauni'],
      },
      {
        partOfSpeech: 'noun (masc.)',
        definition: 'Iyali ko zuriyar da ke zaune tare a ƙarƙashin shugaba guda.',
        definitionEn: 'Extended family or lineage sharing a compound.',
        synonyms: ['iyali', 'zuriya'],
      },
    ],
  },
  'ha-door': {
    morphologicalForms: [
      { form: 'ƙofofi', label: 'plural' },
    ],
    synonyms: ['mashiga', 'ƙofar shiga'],
    relatedWords: ['gida', 'ɗaki'],
  },
  'ha-person': {
    morphologicalForms: [
      { form: 'mutane', label: 'irregular plural' },
      { form: 'mutunci', label: 'abstract noun (dignity)' },
    ],
    synonyms: ['ɗan adam', 'bil’adama'],
    relatedWords: ['namiji', 'mace', 'aboki'],
  },
  'ha-man': {
    morphologicalForms: [
      { form: 'maza', label: 'irregular plural' },
      { form: 'mazaje', label: 'plural (respectful/collective)' },
    ],
    antonyms: ['mace'],
    relatedWords: ['mutum', 'uba', 'ɗan’uwa'],
  },
  'ha-woman': {
    morphologicalForms: [
      { form: 'mata', label: 'irregular plural' },
    ],
    antonyms: ['namiji'],
    relatedWords: ['mutum', 'uwa', '’yar’uwa'],
  },
  'ha-child': {
    morphologicalForms: [
      { form: 'yara', label: 'plural' },
      { form: 'yarinta', label: 'noun (childhood)' },
    ],
    synonyms: ['ɗa', 'jariri'],
    antonyms: ['tsoho', 'babba'],
  },
  'ha-friend': {
    morphologicalForms: [
      { form: 'abokai', label: 'plural' },
      { form: 'abokantaka', label: 'noun (friendship)' },
    ],
    synonyms: ['amini', 'abokin zama'],
    antonyms: ['maƙiyi'],
  },
  'ha-goodness': {
    morphologicalForms: [
      { form: 'alherai', label: 'plural' },
    ],
    synonyms: ['kyautatawa', 'karamci', 'alheri', 'jin ƙai'],
    antonyms: ['sharri', 'mugunta'],
    relatedWords: ['haƙuri', 'hikima', 'salama'],
  },
  'ha-patience': {
    morphologicalForms: [
      { form: 'mai haƙuri', label: 'agentive adjective' },
    ],
    synonyms: ['juriya', 'ƙarfin hali', 'dauriya'],
    antonyms: ['gaggawa', 'fushi'],
    relatedWords: ['hikima', 'alheri', 'lafiya'],
  },
  'ha-book': {
    morphologicalForms: [
      { form: 'littattafai', label: 'plural' },
    ],
    synonyms: ['kundi', 'takarda'],
    relatedWords: ['ilimi', 'hikima'],
  },
  'ha-peace': {
    morphologicalForms: [
      { form: 'zaman lafiya', label: 'collocation (peaceful coexistence)' },
    ],
    synonyms: ['lafiya', 'kwanciyar hankali', 'sulhu', 'zaman lafiya'],
    antonyms: ['rikici', 'yaƙi', 'fitina'],
    relatedWords: ['haƙuri', 'alheri'],
  },
  'word-lafiya-ha': {
    morphologicalForms: [
      { form: 'lafiya lau', label: 'idiomatic intensifier' },
      { form: 'lafiyayye', label: 'adjective (healthy/sound)' },
    ],
    synonyms: ['salama', 'ƙoshin lafiya', 'kwanciyar hankali'],
    antonyms: ['rashin lafiya', 'cuta', 'rikici'],
    relatedWords: ['haƙuri', 'alheri'],
  },
  'word-karfin-hali-ha': {
    synonyms: ['juriya', 'jarumta', 'haƙuri', 'dauriya'],
    antonyms: ['tsoro', 'kasala'],
    relatedWords: ['haƙuri', 'hikima'],
  },

  // ========================
  // YORUBA
  // ========================
  'yo-water': {
    morphologicalForms: [
      { form: 'omi mímu', label: 'compound (drinking water)' },
      { form: 'omi òjò', label: 'compound (rainwater)' },
    ],
    synonyms: ['omi tútù', 'omi òjò'],
    antonyms: ['ọ̀dá'],
    relatedWords: ['odò', 'òjò', 'mu'],
  },
  'yo-peace': {
    morphologicalForms: [
      { form: 'àlàáfíà ara', label: 'collocation (bodily health)' },
      { form: 'alàáfíà ọkàn', label: 'collocation (peace of mind)' },
    ],
    synonyms: ['ìfọ̀kànbalẹ̀', 'ìtùnú', 'ìrọ̀rùn'],
    antonyms: ['ìjà', 'wàhálà', 'ogun'],
    relatedWords: ['sùúrù', 'ọgbọ́n'],
  },
  'yo-wisdom': {
    morphologicalForms: [
      { form: 'ọlọ́gbọ́n', label: 'agentive (wise person)' },
      { form: 'gbọ́n', label: 'verb root (to be wise)' },
    ],
    synonyms: ['ìmọ̀', 'òye', 'làákàyè'],
    antonyms: ['òmùgọ̀', 'àìgbọ́n'],
    relatedWords: ['ìmọ̀', 'sùúrù'],
  },
  'yo-house': {
    morphologicalForms: [
      { form: 'àwọn ilé', label: 'plural phrase' },
      { form: 'agbo ilé', label: 'compound (family compound)' },
    ],
    synonyms: ['ibùgbé', 'agbo ilé'],
    relatedWords: ['ilẹ̀kùn', 'yàrá', 'bàbá', 'ìyá'],
  },
  'yo-heart': {
    morphologicalForms: [
      { form: 'ọkàn rere', label: 'collocation (kind heart)' },
    ],
    synonyms: ['inú', 'ẹ̀mí', 'ìfọ̀kàntán'],
    relatedWords: ['ìfẹ́', 'àlàáfíà'],
  },
  'yo-patience': {
    morphologicalForms: [
      { form: 'onísùúrù', label: 'agentive (patient person)' },
    ],
    synonyms: ['ìfaradà', 'ìtẹríba', 'ìfọ̀kànbalẹ̀'],
    antonyms: ['ìbínú', 'kánjú'],
    relatedWords: ['ọgbọ́n', 'àlàáfíà'],
  },

  // ========================
  // FULFULDE
  // ========================
  'ff-water': {
    morphologicalForms: [
      { form: 'ndiyam njaram', label: 'compound (drinking water)' },
      { form: 'ndiyam toɓo', label: 'compound (rainwater)' },
    ],
    synonyms: ['maayo', 'toɓo'],
    antonyms: ['yooro'],
    relatedWords: ['yarude', 'maayo', 'toɓo'],
  },
  'ff-peace': {
    morphologicalForms: [
      { form: 'jam tan', label: 'greeting response (peace only)' },
      { form: 'kisal', label: 'related noun (safety)' },
    ],
    synonyms: ['kisal', 'deƴƴere', 'jam e kisal'],
    antonyms: ['fitina', 'konu'],
    relatedWords: ['muñal', 'moƴƴere'],
  },
  'ff-house': {
    morphologicalForms: [
      { form: 'cuuɗi', label: 'plural (class ɗi)' },
    ],
    synonyms: ['hoɗorde', 'wuro'],
    relatedWords: ['dammbugal', 'wuro'],
  },
  'ff-door': {
    morphologicalForms: [
      { form: 'dammbuɗe', label: 'plural (class ɗe)' },
    ],
    relatedWords: ['suudu', 'wuro'],
  },
  'ff-heart': {
    morphologicalForms: [
      { form: 'ɓerɗe', label: 'plural (class ɗe)' },
    ],
    synonyms: ['hakkille', 'ruuhu'],
    relatedWords: ['yiɗde', 'muñal'],
  },
  'ff-patience': {
    morphologicalForms: [
      { form: 'muñɗo', label: 'participle (patient person)' },
    ],
    synonyms: ['deƴƴere', 'tiiɗnaare'],
    antonyms: ['tikke', 'jaawɗo'],
    relatedWords: ['hakkille', 'jam'],
  },
  'ff-wisdom': {
    morphologicalForms: [
      { form: 'hakkilanteejo', label: 'agentive (wise person)' },
    ],
    synonyms: ['gandal', 'miijo', 'peeje'],
    relatedWords: ['gandal', 'muñal'],
  },

  // ========================
  // ARABIC
  // ========================
  'ar-water': {
    morphologicalForms: [
      { form: 'مِيَاه', label: 'broken plural' },
      { form: 'أَمْوَاه', label: 'broken plural (classical)' },
      { form: 'مَائِيّ', label: 'nisba adjective (aquatic)' },
    ],
    synonyms: ['شَرَاب', 'نَبْع', 'غَيْث'],
    antonyms: ['جَفَاف', 'عَطَش', 'قَحْط'],
    relatedWords: ['نَهْر', 'مَطَر', 'شَرِبَ'],
    senses: [
      {
        partOfSpeech: 'noun (masc.)',
        definition: 'السائل الشفاف الذي لا لون له ولا رائحة، وهو أصل ونماء كل كائن حي.',
        definitionEn: 'Transparent, odorless liquid sustaining all life.',
        examples: [
          {
            sourceText: 'وَجَعَلْنَا مِنَ الْمَاءِ كُلَّ شَيْءٍ حَيٍّ.',
            targetText: 'And We made from water every living thing.',
          },
        ],
        synonyms: ['نَبْع', 'غَيْث'],
      },
      {
        partOfSpeech: 'noun (masc.)',
        definition: 'المورد السائل أو النداوة والحياة في الشيء (كماء الوجه أي الحياء).',
        definitionEn: 'Freshness, vitality, or essence (figurative usage).',
        usageNote: 'يُستعمل مجازياً في عبارة "ماء الوجه" بمعنى العِفَّة والوقار.',
        synonyms: ['نَضَارَة', 'حَيَوِيَّة'],
      },
    ],
  },
  'ar-peace': {
    morphologicalForms: [
      { form: 'سِلْم', label: 'masdar / cognate' },
      { form: 'سَلَامَة', label: 'abstract noun (safety)' },
      { form: 'مُسَالَمَة', label: 'verbal noun (peacefulness)' },
    ],
    synonyms: ['أَمَان', 'سِلْم', 'وِئَام', 'طُمَأْنِينَة'],
    antonyms: ['حَرْب', 'نِزَاع', 'صِرَاع'],
    relatedWords: ['صَبْر', 'خَيْرٌ', 'حِكْمَة'],
  },
  'ar-goodness': {
    morphologicalForms: [
      { form: 'خَيْرَات', label: 'plural (blessings/wealth)' },
      { form: 'أَخْيَار', label: 'broken plural (virtuous people)' },
      { form: 'خَيِّر', label: 'adjective (benevolent)' },
    ],
    synonyms: ['بِرّ', 'إِحْسَان', 'فَضْل', 'صَلَاح'],
    antonyms: ['شَرّ', 'أَذًى', 'سُوء'],
    relatedWords: ['حِكْمَة', 'سَلَام', 'صَبْر'],
    senses: [
      {
        partOfSpeech: 'noun (masc.)',
        definition: 'كل ما فيه نفع وصلاح وسعادة للناس، ونقيض الشر والأذى.',
        definitionEn: 'Moral goodness, benevolence, and righteous deeds.',
        examples: [
          {
            sourceText: 'فعل الخير يجمع القلوب ويبني المجتمعات.',
            targetText: 'Doing good unites hearts and builds communities.',
          },
        ],
        synonyms: ['إِحْسَان', 'بِرّ', 'صَلَاح'],
        antonyms: ['شَرّ', 'سُوء'],
      },
      {
        partOfSpeech: 'noun / elative',
        definition: 'الأفضل والأصلح من كل شيء، أو ما يفيض من الرزق والبركة.',
        definitionEn: 'The best / blessing / prosperity (comparative or noun sense).',
        usageNote: 'يأتي اسم تفضيل بمعنى "أفضل"، مثل: الصدق خيرٌ من الكذب.',
        synonyms: ['أَفْضَل', 'نِعْمَة', 'بَرَكَة'],
      },
    ],
  },
  'ar-house': {
    morphologicalForms: [
      { form: 'بُيُوت', label: 'broken plural' },
      { form: 'مَنَازِل', label: 'broken plural (منزل)' },
      { form: 'أَبْيَات', label: 'plural (verses of poetry)' },
    ],
    synonyms: ['مَنْزِل', 'دَار', 'مَسْكَن', 'مَأْوَى'],
    relatedWords: ['بَاب', 'غُرْفَة', 'أَب', 'أُمّ'],
  },
  'ar-door': {
    morphologicalForms: [
      { form: 'أَبْوَاب', label: 'broken plural' },
      { form: 'بَوَّابَة', label: 'augmented noun (gate)' },
    ],
    synonyms: ['مَدْخَل', 'بَوَّابَة'],
    relatedWords: ['بَيْت', 'غُرْفَة'],
  },
  'ar-heart': {
    morphologicalForms: [
      { form: 'قُلُوب', label: 'broken plural' },
      { form: 'قَلْبِيّ', label: 'adjective (cardiac/cordial)' },
    ],
    synonyms: ['فُؤَاد', 'لُبّ', 'صَدْر'],
    relatedWords: ['حُبّ', 'خَيْرٌ'],
  },
  'ar-knowledge': {
    morphologicalForms: [
      { form: 'عُلُوم', label: 'broken plural' },
      { form: 'عَالِم', label: 'active participle (scholar)' },
      { form: 'مَعْلُوم', label: 'passive participle (known)' },
    ],
    synonyms: ['مَعْرِفَة', 'دِرَايَة', 'فَهْم'],
    antonyms: ['جَهْل'],
    relatedWords: ['حِكْمَة', 'كِتَاب'],
  },
  'ar-wisdom': {
    morphologicalForms: [
      { form: 'حِكَم', label: 'plural (maxims of wisdom)' },
      { form: 'حَكِيم', label: 'adjective / noun (sage)' },
    ],
    synonyms: ['بَصِيرَة', 'رَشَاد', 'تَدَبُّر'],
    antonyms: ['سَفَه', 'طَيْش'],
    relatedWords: ['عِلْم', 'صَبْر'],
  },
  'ar-patience': {
    morphologicalForms: [
      { form: 'صَابِر', label: 'active participle (patient)' },
      { form: 'صَبُور', label: 'intensive adjective' },
    ],
    synonyms: ['تَحَمُّل', 'أَنَاة', 'حِلْم', 'جَلَد'],
    antonyms: ['جَزَع', 'عَجَلَة', 'غَضَب'],
    relatedWords: ['حِكْمَة', 'سَلَام'],
  },
  'ar-book': {
    morphologicalForms: [
      { form: 'كُتُب', label: 'broken plural' },
      { form: 'كَاتِب', label: 'active participle (writer)' },
      { form: 'مَكْتَبَة', label: 'noun of place (library)' },
    ],
    synonyms: ['مُؤَلَّف', 'مَجَلَّد', 'سِفْر'],
    relatedWords: ['عِلْم', 'حِكْمَة'],
  },

  // ========================
  // FRENCH
  // ========================
  'fr-water': {
    morphologicalForms: [
      { form: 'eaux', label: 'plural (eaux minérales)' },
    ],
    synonyms: ['liquide', 'onde', 'eau potable'],
    antonyms: ['sécheresse'],
    relatedWords: ['rivière', 'pluie', 'boire'],
  },
  'fr-peace': {
    synonyms: ['concorde', 'sérénité', 'tranquillité', 'harmonie', 'calme'],
    antonyms: ['guerre', 'conflit', 'discorde'],
    relatedWords: ['patience', 'sagesse', 'bonté'],
  },
  'fr-heart': {
    morphologicalForms: [
      { form: 'cœurs', label: 'plural' },
      { form: 'cordial', label: 'adjective derivative' },
    ],
    synonyms: ['âme', 'courage', 'affection', 'centre'],
    relatedWords: ['amour', 'bonté'],
  },
  'fr-eye': {
    morphologicalForms: [
      { form: 'yeux', label: 'irregular plural' },
    ],
    synonyms: ['regard', 'prunelle'],
    relatedWords: ['voir', 'tête'],
  },
  'fr-go': {
    morphologicalForms: [
      { form: 'vais', label: '1st sg. present' },
      { form: 'vas', label: '2nd sg. present' },
      { form: 'va', label: '3rd sg. present' },
      { form: 'allons', label: '1st pl. present' },
      { form: 'allez', label: '2nd pl. present' },
      { form: 'vont', label: '3rd pl. present' },
    ],
    synonyms: ['se rendre', 'partir', 'marcher', 'voyager'],
    antonyms: ['venir', 'rester'],
    relatedWords: ['venir'],
  },
  'fr-good': {
    morphologicalForms: [
      { form: 'bonne', label: 'feminine singular' },
      { form: 'bons', label: 'masculine plural' },
      { form: 'bonnes', label: 'feminine plural' },
      { form: 'meilleur', label: 'comparative' },
    ],
    synonyms: ['bienveillant', 'agréable', 'juste', 'excellent'],
    antonyms: ['mauvais', 'méchant'],
    relatedWords: ['bonté'],
  },
  'fr-goodness': {
    synonyms: ['bienveillance', 'générosité', 'douceur', 'vertu'],
    antonyms: ['méchanceté', 'cruauté'],
    relatedWords: ['bon', 'sagesse', 'patience'],
  },
  'fr-house': {
    morphologicalForms: [
      { form: 'maisons', label: 'plural' },
    ],
    synonyms: ['foyer', 'demeure', 'logis', 'habitation'],
    relatedWords: ['porte', 'chambre'],
  },

  // ========================
  // CHINESE (MANDARIN)
  // ========================
  'zh-water': {
    morphologicalForms: [
      { form: '喝水', label: 'verb-object (drink water)' },
      { form: '水源', label: 'compound (water source)' },
      { form: '清水', label: 'compound (clear water)' },
    ],
    synonyms: ['清水', '水源', '江河'],
    antonyms: ['干旱', '火焰'],
    relatedWords: ['河', '雨', '喝'],
  },
  'zh-peace': {
    morphologicalForms: [
      { form: '和平共处', label: 'idiom (peaceful coexistence)' },
      { form: '平安', label: 'near-synonym (safe and sound)' },
    ],
    synonyms: ['平安', '和谐', '安宁', '太平'],
    antonyms: ['战争', '冲突', '动乱'],
    relatedWords: ['善', '耐心', '智慧'],
  },
  'zh-goodness': {
    morphologicalForms: [
      { form: '善良', label: 'compound (kind-hearted)' },
      { form: '行善', label: 'verb-object (do good deeds)' },
      { form: '善意', label: 'compound (goodwill)' },
    ],
    synonyms: ['善良', '美德', '仁爱', '德行'],
    antonyms: ['恶', '邪恶'],
    relatedWords: ['好', '智慧', '耐心'],
  },
  'zh-heart': {
    morphologicalForms: [
      { form: '心脏', label: 'anatomical compound' },
      { form: '心灵', label: 'spiritual/emotional compound' },
      { form: '内心', label: 'inner heart/mind' },
    ],
    synonyms: ['心灵', '内心', '心脏'],
    relatedWords: ['爱', '善'],
  },
  'zh-house': {
    morphologicalForms: [
      { form: '家人', label: 'compound (family members)' },
      { form: '家园', label: 'compound (homeland/hearth)' },
    ],
    synonyms: ['房屋', '住宅', '家庭', '居所'],
    relatedWords: ['门', '房间'],
  },
  'zh-wisdom': {
    morphologicalForms: [
      { form: '明智', label: 'adjective (wise/sensible)' },
      { form: '才智', label: 'compound (talent and wisdom)' },
    ],
    synonyms: ['才智', '明智', '聪慧', '睿智'],
    antonyms: ['愚昧'],
    relatedWords: ['知识', '善', '耐心'],
  },
};

/**
 * Contextual & Equivalence Distinction Annotations for Multilingual Pairs
 * Distinguishes literal translations from contextual, cultural, or idiomatic equivalents.
 */
export const TRANSLATION_ANNOTATIONS: Record<string, TranslationLinkAnnotation> = {
  'en->ha:Lafiya': {
    equivalenceType: 'contextual',
    contextualNote: 'Means bodily health, peace, and well-being together; also used as an everyday greeting.',
  },
  'en->ha:Salama / Lafiya': {
    equivalenceType: 'literal',
    contextualNote: 'Salama denotes formal peace/accord; Lafiya adds personal health and security.',
  },
  'en->yo:Àlàáfíà': {
    equivalenceType: 'contextual',
    contextualNote: 'Encompasses social peace, sound health, and inner serenity simultaneously.',
  },
  'en->ff:Jam': {
    equivalenceType: 'contextual',
    contextualNote: 'Traditional Fulani pastoral term signifying wellness of family, hearth, and herd.',
  },
  'ha->en:Courage / Fortitude': {
    equivalenceType: 'idiomatic',
    contextualNote: 'Idiomatic expression literally meaning "strength of character" (ƙarfin hali).',
  },
  'en->ar:خَيْرٌ': {
    equivalenceType: 'contextual',
    contextualNote: 'Covers both moral virtue/charity and material/spiritual blessing.',
  },
  'en->zh:善': {
    equivalenceType: 'literal',
    contextualNote: 'Classical root character for moral goodness and benevolence (shàn).',
  },
};
