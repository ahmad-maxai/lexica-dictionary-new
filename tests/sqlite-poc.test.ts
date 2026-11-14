/// <reference types="node" />
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { LEXICA_CORE_SCHEMA_STATEMENTS, LEXICA_SQLITE_SCHEMA_VERSION } from '../src/sqlite-poc/schema';
import { POC_VERIFIED_SAMPLES, normalizeForSqlite } from '../src/sqlite-poc/capacitorSqlitePoc';
import { TextNormalization } from '../src/services/textNormalization';

const POC_DB_PATH = path.resolve(process.cwd(), 'tmp', 'lexica_poc.sqlite');

function removeIfExists(filePath: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(filePath + suffix)) {
      fs.unlinkSync(filePath + suffix);
    }
  }
}

console.log('==============================================================');
console.log('LEXICA PHASE 1 — REAL SQLITE + FTS5 PROOF OF CONCEPT TEST');
console.log('==============================================================');

fs.mkdirSync(path.dirname(POC_DB_PATH), { recursive: true });
removeIfExists(POC_DB_PATH);

// 1. Create persistent SQLite database file & apply schema
const db = new DatabaseSync(POC_DB_PATH);
for (const ddl of LEXICA_CORE_SCHEMA_STATEMENTS) {
  db.exec(ddl);
}

// 2. Verify FTS5 availability explicitly (no silent fallback)
const ftsMeta = db
  .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'entries_fts';`)
  .get() as { name: string; sql: string } | undefined;

assert.ok(ftsMeta, 'entries_fts virtual table must exist');
assert.ok(
  ftsMeta.sql.toLowerCase().includes('using fts5'),
  `Expected FTS5 virtual table, got: ${ftsMeta.sql}`
);
console.log('✅ PASS: 1. Database created and FTS5 virtual table verified');

// 3. Seed languages, dataset source, pack registry, entries, senses, forms, relations & FTS5 inside a transaction
db.exec('BEGIN IMMEDIATE;');
try {
  const insertLang = db.prepare(
    `INSERT INTO languages(code, name, native_name, native_script, script_name, direction, speakers_count, accent_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
  );
  const langRows: Array<[string, string, string, string, string, string, string, string]> = [
    ['en', 'English', 'English', 'English', 'Latin', 'ltr', '1.5+ Billion', '#345E4C'],
    ['ha', 'Hausa', 'Harshen Hausa', 'هَرْشَن هَوْسَ / Harshen Hausa', 'Boko & Ajami', 'ltr', '85+ Million', '#C47248'],
    ['yo', 'Yoruba', 'Èdè Yorùbá', 'Èdè Yorùbá', 'Yoruba Latin', 'ltr', '55+ Million', '#204031'],
    ['ff', 'Fulfulde', 'Pulaar / Fulfulde', 'Fulfulde / 𞤆𞤵𞤤𞤢𞤪', 'Latin & Adlam', 'ltr', '40+ Million', '#7B4B3A'],
    ['ar', 'Arabic', 'العَرَبِيَّةُ', 'العَرَبِيَّةُ', 'Arabic Script', 'rtl', '420+ Million', '#2B5B4E'],
    ['fr', 'French', 'Français', 'Français', 'Latin', 'ltr', '320+ Million', '#3B4D6B'],
    ['zh', 'Chinese (Mandarin)', '中文（普通话）', '中文 / 漢語', 'Han Characters', 'ltr', '1.1+ Billion', '#8B3A3A'],
  ];
  for (const row of langRows) insertLang.run(...row);

  db.prepare(
    `INSERT INTO dataset_sources(id, name, license, attribution_text, source_url, dataset_version) VALUES (?, ?, ?, ?, ?, ?);`
  ).run(
    'src-lexica-starter',
    'Lexica Verified Starter Corpus',
    'CC BY-SA 4.0',
    'Lexica Phase 1 Verified Core',
    null,
    '2026.4.0'
  );

  db.prepare(
    `INSERT INTO language_packs(pack_id, lang_code, tier, pack_version, schema_version, install_state, db_file_name, size_bytes, entry_count, sense_count, translation_count, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
  ).run(
    'core-starter-en',
    'en',
    'core_starter',
    '2026.4.0',
    LEXICA_SQLITE_SCHEMA_VERSION,
    'installed',
    'lexica_poc.sqlite',
    0,
    POC_VERIFIED_SAMPLES.length,
    POC_VERIFIED_SAMPLES.length,
    3,
    Date.now()
  );

  const insertEntry = db.prepare(`
    INSERT INTO entries(
      id, source_lang, headword, headword_norm_soft, headword_norm_deep, headword_vowel_fold,
      part_of_speech, primary_ipa, audio_phonetic_text, audio_phonetic_norm, pack_id, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  const insertSense = db.prepare(`
    INSERT INTO senses(id, entry_id, sense_number, part_of_speech, definition, definition_en)
    VALUES (?, ?, 1, ?, ?, ?);
  `);
  const insertExample = db.prepare(`
    INSERT INTO examples(id, entry_id, sense_id, source_text, target_text)
    VALUES (?, ?, ?, ?, ?);
  `);
  const insertPron = db.prepare(`
    INSERT INTO pronunciations(id, entry_id, ipa, phonetic_text)
    VALUES (?, ?, ?, ?);
  `);
  const insertForm = db.prepare(`
    INSERT INTO word_forms(id, entry_id, form, form_norm_soft, form_norm_deep, grammatical_label)
    VALUES (?, ?, ?, ?, ?, ?);
  `);
  const insertRel = db.prepare(`
    INSERT INTO lexical_relations(id, entry_id, sense_id, relation_type, related_term, related_term_norm)
    VALUES (?, ?, ?, 'synonym', ?, ?);
  `);
  const insertFts = db.prepare(`
    INSERT INTO entries_fts(
      entry_id, source_lang, headword, headword_norm_soft, headword_norm_deep,
      audio_phonetic_norm, forms_text, synonyms_text, definitions_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  for (const rec of POC_VERIFIED_SAMPLES) {
    const norm = normalizeForSqlite(rec.headword, rec.sourceLang);
    const pyNorm = rec.audioPhoneticText ? TextNormalization.normalizePinyin(rec.audioPhoneticText) : '';
    const senseId = `${rec.id}#s1`;

    insertEntry.run(
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
      'core-starter-en',
      'src-lexica-starter'
    );
    insertSense.run(senseId, rec.id, rec.partOfSpeech, rec.definition, rec.definitionEn);
    rec.examples.forEach((ex, i) => {
      insertExample.run(`${rec.id}#ex${i + 1}`, rec.id, senseId, ex.sourceText, ex.targetText);
    });
    insertPron.run(`${rec.id}#pron1`, rec.id, rec.ipa, rec.audioPhoneticText);
    rec.forms.forEach((fm, i) => {
      const fNorm = normalizeForSqlite(fm.form, rec.sourceLang);
      insertForm.run(`${rec.id}#f${i + 1}`, rec.id, fm.form, fNorm.soft, fNorm.deep, fm.label);
    });
    rec.synonyms.forEach((syn, i) => {
      const sNorm = normalizeForSqlite(syn, rec.sourceLang);
      insertRel.run(`${rec.id}#syn${i + 1}`, rec.id, senseId, syn, sNorm.soft);
    });
    insertFts.run(
      rec.id,
      rec.sourceLang,
      rec.headword,
      norm.soft,
      norm.deep,
      pyNorm,
      rec.forms.map((f) => f.form).join(' '),
      rec.synonyms.join(' '),
      `${rec.definition} ${rec.definitionEn}`
    );
  }

  // Sense-level translation links (e.g., en-hello#s1 -> ha-hello, fr-hello, zh-hello)
  const insertTrans = db.prepare(`
    INSERT INTO translation_links(
      id, source_entry_id, source_sense_id, source_lang, target_lang, target_entry_id, target_sense_id,
      target_headword, target_headword_norm_soft, target_headword_norm_deep,
      target_transliteration, target_transliteration_norm, target_part_of_speech, target_definition,
      equivalence_type, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  insertTrans.run(
    'tr-en-ha-hello',
    'en-hello',
    'en-hello#s1',
    'en',
    'ha',
    'ha-hello',
    'ha-hello#s1',
    'Sannu',
    'sannu',
    'sannu',
    null,
    null,
    'greeting',
    'Gaisuwar yau da kullum da ake yi wa mutum yayin haduwa.',
    'literal',
    'src-lexica-starter'
  );
  insertTrans.run(
    'tr-en-fr-hello',
    'en-hello',
    'en-hello#s1',
    'en',
    'fr',
    'fr-hello',
    'fr-hello#s1',
    'Bonjour',
    'bonjour',
    'bonjour',
    null,
    null,
    'greeting',
    'Formule polie de salutation employée le jour.',
    'literal',
    'src-lexica-starter'
  );
  insertTrans.run(
    'tr-en-zh-hello',
    'en-hello',
    'en-hello#s1',
    'en',
    'zh',
    'zh-hello',
    'zh-hello#s1',
    '你好',
    '你好',
    '你好',
    'nǐ hǎo',
    'nihao',
    'greeting',
    '与人相见时最常用的礼貌问候语。',
    'literal',
    'src-lexica-starter'
  );

  db.exec('COMMIT;');
} catch (err) {
  db.exec('ROLLBACK;');
  throw err;
}
console.log(`✅ PASS: 2. Transactionally inserted ${POC_VERIFIED_SAMPLES.length} verified samples across 7 languages`);

// Helper to query FTS5 + B-tree normalized index
function searchPoc(term: string, lang: 'en' | 'ha' | 'yo' | 'ff' | 'ar' | 'fr' | 'zh') {
  const norm = normalizeForSqlite(term, lang);
  const ftsQuery =
    lang === 'zh' && norm.pinyinNorm && /^[a-z0-9\s]+$/i.test(term.trim())
      ? `audio_phonetic_norm:"${norm.pinyinNorm}"*`
      : `"${norm.soft.replace(/["*]/g, '')}"*`;

  return db
    .prepare(`
      SELECT e.id, e.source_lang, e.headword, s.definition
      FROM entries_fts f
      JOIN entries e ON e.id = f.entry_id
      JOIN senses s ON s.entry_id = e.id AND s.sense_number = 1
      WHERE e.source_lang = ?
        AND entries_fts MATCH ?
      ORDER BY bm25(entries_fts)
      LIMIT 10;
    `)
    .all(lang, ftsQuery) as Array<{ id: string; source_lang: string; headword: string; definition: string }>;
}

// 4. Test all 7 required languages + Unicode/orthographic variants
const testCases: Array<{
  label: string;
  lang: 'en' | 'ha' | 'yo' | 'ff' | 'ar' | 'fr' | 'zh';
  query: string;
  expectedHeadword: string;
}> = [
  { label: 'English', lang: 'en', query: 'hello', expectedHeadword: 'Hello' },
  { label: 'Hausa', lang: 'ha', query: 'sannu', expectedHeadword: 'Sannu' },
  { label: 'Yoruba (diacritics)', lang: 'yo', query: 'ilẹ̀', expectedHeadword: 'Ilẹ̀' },
  { label: 'Yoruba (ASCII fallback)', lang: 'yo', query: 'ile', expectedHeadword: 'Ilẹ̀' },
  { label: 'Fulfulde (Jam)', lang: 'ff', query: 'jam', expectedHeadword: 'Jam' },
  { label: 'Fulfulde (Ndiyam)', lang: 'ff', query: 'ndiyam', expectedHeadword: 'Ndiyam' },
  { label: 'Arabic (unvocalized)', lang: 'ar', query: 'خير', expectedHeadword: 'خَيْرٌ' },
  { label: 'Arabic (vocalized)', lang: 'ar', query: 'خَيْرٌ', expectedHeadword: 'خَيْرٌ' },
  { label: 'French', lang: 'fr', query: 'bonjour', expectedHeadword: 'Bonjour' },
  { label: 'Chinese (Hanzi)', lang: 'zh', query: '你好', expectedHeadword: '你好' },
  { label: 'Chinese (Pinyin)', lang: 'zh', query: 'ni hao', expectedHeadword: '你好' },
];

for (const tc of testCases) {
  const rows = searchPoc(tc.query, tc.lang);
  assert.ok(rows.length > 0, `Expected FTS5 results for ${tc.label} ("${tc.query}")`);
  assert.equal(rows[0].headword, tc.expectedHeadword, `Expected ${tc.expectedHeadword} for ${tc.label}`);
  console.log(`✅ PASS: 3. ${tc.label} search "${tc.query}" -> "${rows[0].headword}" (${rows[0].id})`);
}

// Verify sense-level Multilingual translation link query
const transRows = db
  .prepare(`
    SELECT e.headword AS source_headword, s.definition AS source_def, t.target_lang, t.target_headword, t.equivalence_type
    FROM entries e
    JOIN senses s ON s.entry_id = e.id
    JOIN translation_links t ON t.source_sense_id = s.id
    WHERE e.id = 'en-hello' AND t.target_lang = 'zh';
  `)
  .all() as Array<{ source_headword: string; target_headword: string; equivalence_type: string }>;
assert.equal(transRows.length, 1);
assert.equal(transRows[0].target_headword, '你好');
console.log(`✅ PASS: 4. Sense-level Multilingual JOIN ("Hello" -> "${transRows[0].target_headword}", ${transRows[0].equivalence_type})`);

// 5. Close database completely
db.close();
console.log('✅ PASS: 5. Closed SQLite database handle cleanly');

// 6. Verify persistence & search in a SEPARATE child Node process (simulating full app restart)
const restartCheckScript = `
  import assert from 'node:assert/strict';
  import { DatabaseSync } from 'node:sqlite';
  const reopened = new DatabaseSync(${JSON.stringify(POC_DB_PATH)}, { readOnly: true });
  const total = reopened.prepare('SELECT COUNT(*) AS cnt FROM entries').get();
  assert.equal(total.cnt, ${POC_VERIFIED_SAMPLES.length});

  const probes = [
    ['en', 'hello', 'Hello'],
    ['ha', 'sannu', 'Sannu'],
    ['yo', 'ile', 'Ilẹ̀'],
    ['ff', 'ndiyam', 'Ndiyam'],
    ['ar', 'خير', 'خَيْرٌ'],
    ['fr', 'bonjour', 'Bonjour'],
    ['zh', '你好', '你好'],
  ];
  for (const [lang, q, expected] of probes) {
    const row = reopened.prepare(
      'SELECT e.headword FROM entries_fts f JOIN entries e ON e.id = f.entry_id WHERE e.source_lang = ? AND entries_fts MATCH ? LIMIT 1'
    ).get(lang, '"' + q + '"*');
    assert.ok(row && row.headword === expected, 'Restart persistence failed for ' + lang + ':' + q);
  }
  reopened.close();
  console.log('RESTART_PERSISTENCE_VERIFIED:' + total.cnt);
`;

const restartOut = execFileSync(process.execPath, ['--input-type=module', '-e', restartCheckScript], {
  encoding: 'utf8',
});
assert.ok(restartOut.includes(`RESTART_PERSISTENCE_VERIFIED:${POC_VERIFIED_SAMPLES.length}`));

const fileStat = fs.statSync(POC_DB_PATH);
console.log(`✅ PASS: 6. Reopened in fresh process — all ${POC_VERIFIED_SAMPLES.length} entries & 7-language FTS5 queries persisted (${fileStat.size} bytes on disk)`);
console.log('==============================================================');
console.log('SQLITE + FTS5 PROOF OF CONCEPT: ALL CHECKS PASSED');
console.log('==============================================================');
