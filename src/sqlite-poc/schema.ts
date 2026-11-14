/**
 * LEXICA — PHASE 1: PROPOSED PRODUCTION SQLITE + FTS5 SCHEMA
 * Isolated proof-of-concept and target relational schema definition.
 * Does NOT modify or replace the active LocalDictionaryDatabase in Phase 1.
 */

export const LEXICA_SQLITE_SCHEMA_VERSION = 1;

export const LEXICA_CORE_SCHEMA_STATEMENTS: string[] = [
  `PRAGMA foreign_keys = ON;`,

  // 1. Supported Languages Metadata
  `CREATE TABLE IF NOT EXISTS languages (
    code TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    native_name TEXT NOT NULL,
    native_script TEXT NOT NULL,
    script_name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('ltr', 'rtl')),
    speakers_count TEXT NOT NULL,
    accent_color TEXT NOT NULL
  );`,

  // 2. Dataset Sources & License Attribution
  `CREATE TABLE IF NOT EXISTS dataset_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution_text TEXT NOT NULL,
    source_url TEXT,
    dataset_version TEXT NOT NULL
  );`,

  // 3. Hybrid Language Pack Registry (Core APK Starter + 7 Downloadable Packs)
  `CREATE TABLE IF NOT EXISTS language_packs (
    pack_id TEXT PRIMARY KEY NOT NULL,
    lang_code TEXT NOT NULL REFERENCES languages(code),
    tier TEXT NOT NULL CHECK (tier IN ('core_starter', 'full_pack')),
    pack_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    install_state TEXT NOT NULL CHECK (
      install_state IN ('installed', 'downloading', 'verifying', 'incomplete', 'not_installed')
    ),
    db_file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    compressed_size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256_checksum TEXT,
    entry_count INTEGER NOT NULL DEFAULT 0,
    sense_count INTEGER NOT NULL DEFAULT 0,
    translation_count INTEGER NOT NULL DEFAULT 0,
    installed_at INTEGER,
    updated_at INTEGER
  );`,

  // 4. Dictionary Headword Entries
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY NOT NULL,
    source_lang TEXT NOT NULL REFERENCES languages(code),
    headword TEXT NOT NULL,
    headword_norm_soft TEXT NOT NULL,
    headword_norm_deep TEXT NOT NULL,
    headword_vowel_fold TEXT NOT NULL,
    headword_script_variant TEXT,
    headword_script_label TEXT,
    part_of_speech TEXT NOT NULL,
    gender_or_class TEXT,
    dialect TEXT,
    register TEXT,
    etymology TEXT,
    root_word TEXT,
    root_word_norm TEXT,
    tone_pattern TEXT,
    cultural_note TEXT,
    primary_ipa TEXT,
    audio_phonetic_text TEXT,
    audio_phonetic_norm TEXT,
    pack_id TEXT REFERENCES language_packs(pack_id),
    source_id TEXT REFERENCES dataset_sources(id),
    verification_status TEXT NOT NULL DEFAULT 'verified',
    UNIQUE(source_lang, headword, part_of_speech)
  );`,

  // 5. Word Senses & Definitions (1 Entry -> N Senses)
  `CREATE TABLE IF NOT EXISTS senses (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    sense_number INTEGER NOT NULL,
    part_of_speech TEXT NOT NULL,
    definition TEXT NOT NULL,
    definition_en TEXT,
    register TEXT,
    usage_note TEXT,
    UNIQUE(entry_id, sense_number)
  );`,

  // 6. Contextual Example Sentences
  `CREATE TABLE IF NOT EXISTS examples (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    sense_id TEXT REFERENCES senses(id) ON DELETE CASCADE,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    literal_translation TEXT,
    cultural_context TEXT
  );`,

  // 7. Phonetic & Dialectal Pronunciations
  `CREATE TABLE IF NOT EXISTS pronunciations (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    dialect TEXT,
    ipa TEXT NOT NULL,
    phonetic_text TEXT,
    tone_pattern TEXT,
    audio_asset_ref TEXT
  );`,

  // 8. Morphological & Inflected Word Forms
  `CREATE TABLE IF NOT EXISTS word_forms (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    form TEXT NOT NULL,
    form_norm_soft TEXT NOT NULL,
    form_norm_deep TEXT NOT NULL,
    grammatical_label TEXT NOT NULL,
    note TEXT
  );`,

  // 9. Monolingual Lexical Relations (Synonyms, Antonyms, Related Words)
  `CREATE TABLE IF NOT EXISTS lexical_relations (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    sense_id TEXT REFERENCES senses(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('synonym', 'antonym', 'related')),
    related_term TEXT NOT NULL,
    related_term_norm TEXT NOT NULL,
    target_entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL
  );`,

  // 10. Sense-Level Cross-Language Translation Relationships
  `CREATE TABLE IF NOT EXISTS translation_links (
    id TEXT PRIMARY KEY NOT NULL,
    source_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    source_sense_id TEXT NOT NULL REFERENCES senses(id) ON DELETE CASCADE,
    source_lang TEXT NOT NULL REFERENCES languages(code),
    target_lang TEXT NOT NULL REFERENCES languages(code),
    target_entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
    target_sense_id TEXT REFERENCES senses(id) ON DELETE SET NULL,
    target_headword TEXT NOT NULL,
    target_headword_norm_soft TEXT NOT NULL,
    target_headword_norm_deep TEXT NOT NULL,
    target_transliteration TEXT,
    target_transliteration_norm TEXT,
    target_script_variant TEXT,
    target_part_of_speech TEXT NOT NULL,
    target_definition TEXT NOT NULL,
    equivalence_type TEXT NOT NULL CHECK (
      equivalence_type IN ('literal', 'contextual', 'idiomatic', 'near-equivalent')
    ),
    contextual_note TEXT,
    register TEXT,
    source_id TEXT REFERENCES dataset_sources(id),
    UNIQUE(source_sense_id, target_lang, target_headword, equivalence_type)
  );`,

  // Indexes for fast Standard & Multilingual B-Tree Lookups
  `CREATE INDEX IF NOT EXISTS idx_entries_lang_headword ON entries(source_lang, headword);`,
  `CREATE INDEX IF NOT EXISTS idx_entries_lang_soft ON entries(source_lang, headword_norm_soft);`,
  `CREATE INDEX IF NOT EXISTS idx_entries_lang_deep ON entries(source_lang, headword_norm_deep);`,
  `CREATE INDEX IF NOT EXISTS idx_entries_lang_vfold ON entries(source_lang, headword_vowel_fold);`,
  `CREATE INDEX IF NOT EXISTS idx_entries_pinyin ON entries(source_lang, audio_phonetic_norm);`,
  `CREATE INDEX IF NOT EXISTS idx_entries_root ON entries(source_lang, root_word_norm);`,
  `CREATE INDEX IF NOT EXISTS idx_senses_entry ON senses(entry_id, sense_number);`,
  `CREATE INDEX IF NOT EXISTS idx_forms_norm ON word_forms(form_norm_soft, form_norm_deep);`,
  `CREATE INDEX IF NOT EXISTS idx_forms_entry ON word_forms(entry_id);`,
  `CREATE INDEX IF NOT EXISTS idx_lexrel_entry ON lexical_relations(entry_id, relation_type);`,
  `CREATE INDEX IF NOT EXISTS idx_lexrel_term ON lexical_relations(related_term_norm);`,
  `CREATE INDEX IF NOT EXISTS idx_trans_src_pair ON translation_links(source_entry_id, target_lang);`,
  `CREATE INDEX IF NOT EXISTS idx_trans_pair_target ON translation_links(source_lang, target_lang, target_headword_norm_soft);`,
  `CREATE INDEX IF NOT EXISTS idx_trans_rev_lookup ON translation_links(target_lang, source_lang, target_headword_norm_soft);`,

  // 11. FTS5 Full-Text Search Virtual Table (preserving exact diacritics + indexed normalized columns)
  `CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    entry_id UNINDEXED,
    source_lang UNINDEXED,
    headword,
    headword_norm_soft,
    headword_norm_deep,
    audio_phonetic_norm,
    forms_text,
    synonyms_text,
    definitions_text,
    tokenize = 'unicode61 remove_diacritics 0'
  );`,
];
