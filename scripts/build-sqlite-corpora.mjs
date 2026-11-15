import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

import { LANGUAGES } from '../src/data/languages';
import { VERIFIED_SEED_ENTRIES } from '../src/data/seedDictionary';
import { DICTIONARY_ENTRIES } from '../src/data/dictionaryData';
import { EXPANDED_DICTIONARY_ENTRIES } from '../src/data/expandedDictionary';
import { LEXICON_ENRICHMENTS, TRANSLATION_ANNOTATIONS } from '../src/data/lexiconEnrichment';
import { TextNormalization } from '../src/services/textNormalization';

const DATASET_VERSION = '2026.6.0';
const RAW_PACK_BASE_URL =
  'https://raw.githubusercontent.com/ahmad-maxai/lexica-dictionary-new/feature/lexica-sqlite-migration/packs';
const CDN_PACK_BASE_URL =
  'https://cdn.jsdelivr.net/gh/ahmad-maxai/lexica-dictionary-new@feature/lexica-sqlite-migration/packs';

const SOURCES_DIR = '/tmp/lexica-sources';
const BUILD_DIR = '/tmp/lexica-build';
fs.mkdirSync(BUILD_DIR, { recursive: true });

const LIMITS = {
  core: {
    ha: 1600,
    yo: 2400,
    ff: 1400,
    ar: 2000,
    fr: 2000,
    en: 2200,
    zh: 2200,
  },
  full: {
    ha: 3000,
    yo: 8500,
    ff: 2500,
    ar: 20000,
    fr: 25000,
    en: 25000,
    zh: 35000,
  },
};

const DATASET_SOURCES = [
  {
    id: 'src-lexica-curated',
    name: 'Lexica Curated Starter Corpus',
    license: 'CC BY-SA 4.0',
    attribution_text: 'Lexica Multilingual Lexicography Project',
    source_url: null,
    dataset_version: DATASET_VERSION,
  },
  {
    id: 'src-kaikki-wiktionary',
    name: 'Kaikki.org / English Wiktionary Contributors',
    license: 'CC BY-SA 4.0',
    attribution_text: 'Extracted from English Wiktionary via Kaikki.org (wiktextract)',
    source_url: 'https://kaikki.org/dictionary/',
    dataset_version: DATASET_VERSION,
  },
  {
    id: 'src-cc-cedict',
    name: 'MDBG CC-CEDICT Chinese-English Dictionary',
    license: 'CC BY-SA 4.0',
    attribution_text: 'CC-CEDICT community dictionary maintained by MDBG',
    source_url: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    dataset_version: DATASET_VERSION,
  },
  {
    id: 'src-iwaju-en-yo',
    name: 'IwajuAI English-Yoruba Dictionary',
    license: 'Apache-2.0',
    attribution_text: 'IwajuAI open-source English-Yoruba lexicon',
    source_url: 'https://huggingface.co/datasets/IwajuAI/English-Yoruba-Dictionary',
    dataset_version: DATASET_VERSION,
  },
];

// ============================================================================
// Normalization & Pinyin Helpers
// ============================================================================

const TONE_VOWEL_MAP = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

function numericSyllableToPinyin(rawSyl) {
  let syl = rawSyl.replace(/u:/gi, 'ü').replace(/v/g, 'ü');
  const m = syl.match(/^([a-züA-ZÜ]+)([1-5])$/);
  if (!m) return syl;
  const base = m[1];
  const tone = Number(m[2]);
  if (tone === 5) return base;
  const lower = base.toLowerCase();
  let targetIdx = -1;
  if (lower.includes('a')) targetIdx = lower.indexOf('a');
  else if (lower.includes('e')) targetIdx = lower.indexOf('e');
  else if (lower.includes('ou')) targetIdx = lower.indexOf('o');
  else {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouü'.includes(lower[i])) {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx < 0) return base;
  const ch = lower[targetIdx];
  const mapped = TONE_VOWEL_MAP[ch]?.[tone - 1];
  if (!mapped) return base;
  const isUpper = base[targetIdx] !== ch;
  const finalCh = isUpper ? mapped.toUpperCase() : mapped;
  return base.slice(0, targetIdx) + finalCh + base.slice(targetIdx + 1);
}

function convertCedictPinyin(numPinyin) {
  return numPinyin
    .trim()
    .split(/\s+/)
    .map((s) => numericSyllableToPinyin(s))
    .join(' ');
}

function normFields(headword, lang, phonetic = '') {
  if (lang === 'ar') {
    const ar = TextNormalization.normalizeArabic(headword);
    return { soft: ar, deep: ar, vowelFold: ar, phoneticNorm: '' };
  }
  const lat = TextNormalization.normalizeLatin(headword);
  const pNorm = lang === 'zh' && phonetic ? TextNormalization.normalizePinyin(phonetic) : '';
  return {
    soft: lat.soft,
    deep: lat.deep,
    vowelFold: lat.vowelFold,
    phoneticNorm: pNorm,
  };
}

function cleanPos(pos) {
  if (!pos) return 'noun';
  const p = String(pos).trim().toLowerCase();
  if (p === 'adj' || p === 'adjective') return 'adjective';
  if (p === 'adv' || p === 'adverb') return 'adverb';
  if (p === 'prep' || p === 'preposition') return 'preposition';
  if (p === 'conj' || p === 'conjunction') return 'conjunction';
  if (p === 'pron' || p === 'pronoun') return 'pronoun';
  if (p === 'intj' || p === 'interjection') return 'interjection';
  if (p === 'proverb' || p === 'idiom' || p === 'phrase') return 'phrase';
  if (p === 'num' || p === 'numeral') return 'numeral';
  return p.slice(0, 40) || 'noun';
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u0600-\u06ff\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

let autoIdCounter = 0;
function makeEntryId(lang, prefix, headword, pos) {
  autoIdCounter++;
  const hPart = slug(headword) || 'w';
  return `${prefix}-${lang}-${hPart}-${slug(pos)}-${autoIdCounter}`;
}

function normalizeTextForCmp(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ɓƁ]/g, 'b')
    .replace(/[ɗƊ]/g, 'd')
    .replace(/[ƙƘ]/g, 'k')
    .replace(/[ƴƳ]/g, 'y')
    .replace(/[’'`\-\s]/g, '')
    .toLowerCase();
}

function extractRootFromEtymology(text) {
  if (!text) return null;
  const m = text.match(/root\s+([\u0600-\u06ff\s\-]{3,16})/i);
  return m ? m[1].trim() : null;
}

// Strict check for clean English single/two-word lexical equivalent from Wiktionary gloss
function extractShortEnglishEquivalent(gloss) {
  if (!gloss) return null;
  const clean = gloss
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(to|a|an|the)\s+/i, '')
    .split(/[;,]/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length < 2 || clean.length > 30) return null;
  if (!/^[a-zA-Z][a-zA-Z\s\-']*$/.test(clean)) return null;
  const words = clean.split(/\s+/);
  if (words.length > 2) return null;
  if (/^(plural|alternative|inflection|synonym|antonym|diminutive|form|used|referring|pertaining|having|being)\b/i.test(clean)) {
    return null;
  }
  return clean;
}

// ============================================================================
// Step 1: Load Curated Starter Corpus (preserving every existing ID & link)
// ============================================================================

function loadCuratedEntries() {
  const rawMap = new Map();
  const seenKey = new Set();

  const pushRaw = (entry) => {
    const k = `${entry.sourceLang}:${entry.headword.trim().toLowerCase()}`;
    if (!rawMap.has(entry.id) && !seenKey.has(k)) {
      rawMap.set(entry.id, entry);
      seenKey.add(k);
    }
  };

  for (const e of VERIFIED_SEED_ENTRIES) pushRaw(e);
  for (const e of EXPANDED_DICTIONARY_ENTRIES) pushRaw(e);
  for (const e of DICTIONARY_ENTRIES) pushRaw(e);

  const lookupByLangHead = new Map();
  for (const entry of rawMap.values()) {
    lookupByLangHead.set(`${entry.sourceLang}:${entry.headword.trim().toLowerCase()}`, entry);
  }

  const normalized = [];
  for (const raw of rawMap.values()) {
    const enrichment = LEXICON_ENRICHMENTS[raw.id];
    const synonyms = enrichment?.synonyms?.length ? enrichment.synonyms : raw.synonyms || [];
    const antonyms = enrichment?.antonyms?.length ? enrichment.antonyms : raw.antonyms || [];
    const relatedWords = enrichment?.relatedWords || raw.relatedWords || [];
    const morphologicalForms = enrichment?.morphologicalForms || raw.morphologicalForms || [];
    const etymology = enrichment?.etymology || raw.etymology || null;
    const culturalNote = enrichment?.culturalNote || raw.culturalNote || null;

    const nf = normFields(raw.headword, raw.sourceLang, raw.audioPhoneticText || '');
    const rootWord = raw.rootWord || null;
    const rootNorm = rootWord ? TextNormalization.normalizeArabic(rootWord).replace(/[\s\-]/g, '') : null;

    const senses = (enrichment?.senses?.length
      ? enrichment.senses.map((s, idx) => ({
          id: `${raw.id}#s${idx + 1}`,
          sense_number: idx + 1,
          part_of_speech: cleanPos(s.partOfSpeech || raw.partOfSpeech),
          definition: s.definition,
          definition_en: s.definitionEn || raw.definitionEn || s.definition,
          register: s.register || raw.register || null,
          usage_note: s.usageNote || null,
          examples: s.examples?.length ? s.examples : idx === 0 ? raw.examples || [] : [],
        }))
      : [
          {
            id: `${raw.id}#s1`,
            sense_number: 1,
            part_of_speech: cleanPos(raw.partOfSpeech),
            definition: raw.definition || raw.definitionEn || '',
            definition_en: raw.definitionEn || raw.definition || '',
            register: raw.register || null,
            usage_note: null,
            examples: raw.examples || [],
          },
        ]
    ).filter((s) => s.definition);

    if (senses.length === 0) continue;

    const examples = [];
    let exIdx = 0;
    for (const s of senses) {
      for (const ex of s.examples || []) {
        exIdx++;
        examples.push({
          id: `${raw.id}#ex${exIdx}`,
          sense_id: s.id,
          source_text: ex.sourceText,
          target_text: ex.targetText,
          literal_translation: ex.literalTranslation || null,
          cultural_context: ex.culturalContext || null,
        });
      }
    }

    const word_forms = morphologicalForms.map((m, idx) => {
      const mnf = normFields(m.form, raw.sourceLang);
      return {
        id: `${raw.id}#wf${idx + 1}`,
        form: m.form,
        form_norm_soft: mnf.soft,
        form_norm_deep: mnf.deep,
        grammatical_label: m.label || 'form',
        note: m.note || null,
      };
    });

    const lexical_relations = [];
    let lrIdx = 0;
    for (const syn of synonyms) {
      lrIdx++;
      lexical_relations.push({
        id: `${raw.id}#lr${lrIdx}`,
        relation_type: 'synonym',
        related_term: syn,
        related_term_norm: normFields(syn, raw.sourceLang).soft,
      });
    }
    for (const ant of antonyms) {
      lrIdx++;
      lexical_relations.push({
        id: `${raw.id}#lr${lrIdx}`,
        relation_type: 'antonym',
        related_term: ant,
        related_term_norm: normFields(ant, raw.sourceLang).soft,
      });
    }
    for (const rel of relatedWords) {
      lrIdx++;
      lexical_relations.push({
        id: `${raw.id}#lr${lrIdx}`,
        relation_type: 'related',
        related_term: rel,
        related_term_norm: normFields(rel, raw.sourceLang).soft,
      });
    }

    const translation_links = [];
    const seenTrans = new Set();
    for (const [tLang, equivs] of Object.entries(raw.translations || {})) {
      for (let i = 0; i < (equivs || []).length; i++) {
        const eq = equivs[i];
        if (!eq?.headword) continue;
        const eqType = eq.equivalenceType || TRANSLATION_ANNOTATIONS[`${raw.sourceLang}->${tLang}:${eq.headword}`]?.equivalenceType || 'literal';
        const dedup = `${senses[0].id}|${tLang}|${eq.headword}|${eqType}`;
        if (seenTrans.has(dedup)) continue;
        seenTrans.add(dedup);
        const tnf = normFields(eq.headword, tLang, eq.transliteration || '');
        const tEntry = lookupByLangHead.get(`${tLang}:${eq.headword.trim().toLowerCase()}`);
        translation_links.push({
          id: `${raw.id}->${tLang}#${i + 1}`,
          source_sense_id: eq.sourceSenseId && senses.some((s) => s.id === eq.sourceSenseId) ? eq.sourceSenseId : senses[0].id,
          target_lang: tLang,
          target_entry_id: tEntry?.id || null,
          target_sense_id: eq.targetSenseId || (tEntry ? `${tEntry.id}#s1` : null),
          target_headword: eq.headword,
          target_headword_norm_soft: tnf.soft,
          target_headword_norm_deep: tnf.deep,
          target_transliteration: eq.transliteration || null,
          target_transliteration_norm: tLang === 'zh' && eq.transliteration ? TextNormalization.normalizePinyin(eq.transliteration) : '',
          target_script_variant: eq.scriptVariant || null,
          target_part_of_speech: cleanPos(eq.partOfSpeech || raw.partOfSpeech),
          target_definition: eq.definition || '',
          equivalence_type: eqType,
          contextual_note: eq.contextualNote || TRANSLATION_ANNOTATIONS[`${raw.sourceLang}->${tLang}:${eq.headword}`]?.contextualNote || null,
          register: eq.register || null,
          source_id: 'src-lexica-curated',
        });
      }
    }

    normalized.push({
      id: raw.id,
      source_lang: raw.sourceLang,
      headword: raw.headword.trim(),
      headword_norm_soft: nf.soft,
      headword_norm_deep: nf.deep,
      headword_vowel_fold: nf.vowelFold,
      headword_script_variant: raw.headwordScriptVariant?.text || null,
      headword_script_label: raw.headwordScriptVariant?.label || null,
      part_of_speech: cleanPos(raw.partOfSpeech),
      gender_or_class: raw.genderOrClass || null,
      dialect: raw.dialect || null,
      register: raw.register || null,
      etymology,
      root_word: rootWord,
      root_word_norm: rootNorm,
      tone_pattern: raw.tonePattern || null,
      cultural_note: culturalNote,
      primary_ipa: raw.ipa || '',
      audio_phonetic_text: raw.audioPhoneticText || null,
      audio_phonetic_norm: nf.phoneticNorm,
      source_id: 'src-lexica-curated',
      verification_status: raw.verificationStatus || 'verified',
      senses,
      examples,
      word_forms,
      lexical_relations,
      translation_links,
      _score: 1000000, // always keep curated entries in core + full
    });
  }

  return normalized;
}

// ============================================================================
// Step 2: Kaikki Parser Helper & English Cross-Language Scan
// ============================================================================

function parseKaikkiRecord(d, lang) {
  if (!d?.word || !Array.isArray(d.senses) || d.senses.length === 0) return null;
  const rawPos = String(d.pos || 'noun').toLowerCase();
  if (['character', 'symbol', 'letter', 'punct', 'punctuation', 'combining form'].includes(rawPos)) {
    return null;
  }

  const realSenses = [];
  for (const s of d.senses) {
    if (s.tags?.includes('form-of') || s.tags?.includes('alt-of')) continue;
    const gList = s.glosses?.length ? s.glosses : s.raw_glosses || [];
    const defText = String(gList[gList.length - 1] || '').trim();
    if (!defText) continue;
    if (/^(alternative (form|spelling) of|plural of|inflection of|synonym of|obsolete form of|misspelling of)\b/i.test(defText)) {
      continue;
    }
    realSenses.push({
      def: defText,
      tags: s.tags || [],
      examples: (s.examples || [])
        .filter((ex) => ex.text && (ex.english || ex.translation) && ex.text.length < 220)
        .slice(0, 2)
        .map((ex) => ({
          source_text: String(ex.text).trim(),
          target_text: String(ex.english || ex.translation || '').trim(),
          literal_translation: ex.literal_meaning ? String(ex.literal_meaning).trim() : null,
          cultural_context: ex.ref ? String(ex.ref).slice(0, 120) : null,
        })),
      synonyms: (s.synonyms || []).map((x) => x.word).filter(Boolean),
      antonyms: (s.antonyms || []).map((x) => x.word).filter(Boolean),
    });
  }

  if (realSenses.length === 0) return null;

  // Resolve clean canonical form if tonal / vocalized matches same underlying word
  let headword = String(d.word).trim();
  const extraForms = [];
  let genderOrClass = null;

  const canonicalObj = (d.forms || []).find(
    (f) => f.form && f.tags?.includes('canonical') && !f.tags?.includes('table-tags')
  );
  if (canonicalObj) {
    let canText = String(canonicalObj.form).trim();
    // Fula class markers appended like "hello ngo" -> word="hello", class="ngo"
    if (lang === 'ff' && canText.startsWith(headword + ' ')) {
      const parts = canText.split(/\s+/);
      if (parts.length === 2 && parts[1].length <= 5) {
        genderOrClass = `class ${parts[1]}`;
        canText = parts[0];
      }
    }
    if (lang === 'yo') {
      if (normalizeTextForCmp(canText) === normalizeTextForCmp(headword) && canText !== headword) {
        extraForms.push({ form: headword, label: 'unmarked spelling' });
        headword = canText;
      }
    } else if (lang === 'ar') {
      const cleanCan = canText.replace(/\+/g, '').trim();
      if (
        TextNormalization.normalizeArabic(cleanCan) === TextNormalization.normalizeArabic(headword) &&
        cleanCan !== headword &&
        !/\s/.test(cleanCan)
      ) {
        extraForms.push({ form: headword, label: 'unvocalized' });
        headword = cleanCan;
      }
    } else if (lang === 'ha') {
      if (normalizeTextForCmp(canText) === normalizeTextForCmp(headword) && canText !== headword) {
        extraForms.push({ form: canText, label: 'tonal marking' });
      }
    }
  }

  // Filter out pure template forms
  const formSet = new Set();
  for (const ef of extraForms) {
    formSet.add(ef.form);
  }
  for (const f of d.forms || []) {
    if (!f.form) continue;
    if (f.tags?.some((t) => ['table-tags', 'inflection-template', 'canonical', 'class', 'romanization'].includes(t))) {
      continue;
    }
    const ft = String(f.form).trim();
    if (!ft || ft === 'no-table-tags' || ft.length > 60 || formSet.has(ft) || ft === headword) continue;
    formSet.add(ft);
    const label = (f.tags || []).filter((t) => t !== 'error-unrecognized-form').slice(0, 2).join(' ') || 'inflected';
    extraForms.push({ form: ft, label });
    if (extraForms.length >= 6) break;
  }

  let primaryIpa = '';
  let dialect = null;
  if (Array.isArray(d.sounds)) {
    const ipaSound = d.sounds.find((s) => s.ipa);
    if (ipaSound) {
      primaryIpa = String(ipaSound.ipa).trim();
      if (ipaSound.note) dialect = String(ipaSound.note).slice(0, 80);
    }
  }
  if (!dialect) {
    const tagDialects = (d.senses[0]?.tags || []).filter((t) =>
      ['Kano', 'Sokoto', 'Pulaar', 'Pular', 'Adamawa', 'MSA'].includes(t)
    );
    if (tagDialects.length > 0) dialect = tagDialects.join(', ');
  }

  let etymology = d.etymology_text ? String(d.etymology_text).trim() : null;
  if (etymology && (etymology === '.' || etymology.length < 3)) etymology = null;
  if (etymology && etymology.length > 350) etymology = etymology.slice(0, 347) + '…';

  const rootWord = lang === 'ar' ? extractRootFromEtymology(etymology) : null;

  const syns = Array.from(new Set(realSenses.flatMap((s) => s.synonyms))).slice(0, 6);
  const ants = Array.from(new Set(realSenses.flatMap((s) => s.antonyms))).slice(0, 6);
  const pos = cleanPos(rawPos);
  const nf = normFields(headword, lang);

  // Quality/richness score for selecting core vs full pack
  const score =
    (realSenses.length > 1 ? 30 : 0) +
    realSenses.length * 10 +
    (primaryIpa ? 20 : 0) +
    extraForms.length * 5 +
    realSenses.reduce((acc, s) => acc + s.examples.length * 15, 0) +
    (etymology ? 8 : 0) +
    (headword.includes(' ') ? -12 : 10) +
    (headword.startsWith('-') ? -25 : 0);

  return {
    headword,
    canonicalRaw: canonicalObj?.form || '',
    pos,
    nf,
    genderOrClass,
    dialect,
    etymology,
    rootWord,
    primaryIpa,
    realSenses: realSenses.slice(0, 5),
    extraForms,
    syns,
    ants,
    translationsRaw: d.translations || [],
    score,
  };
}

function finalizeEntryRecord(parsed, id, lang, sourceId, packEnLinks = []) {
  const senses = parsed.realSenses.map((s, idx) => ({
    id: `${id}#s${idx + 1}`,
    sense_number: idx + 1,
    part_of_speech: parsed.pos,
    definition: s.def,
    definition_en: s.def,
    register: null,
    usage_note: null,
  }));

  const examples = [];
  let exIdx = 0;
  parsed.realSenses.forEach((s, idx) => {
    for (const ex of s.examples) {
      exIdx++;
      examples.push({
        id: `${id}#ex${exIdx}`,
        sense_id: `${id}#s${idx + 1}`,
        source_text: ex.source_text,
        target_text: ex.target_text,
        literal_translation: ex.literal_translation,
        cultural_context: ex.cultural_context,
      });
    }
  });

  const word_forms = parsed.extraForms.map((f, idx) => {
    const fnf = normFields(f.form, lang);
    return {
      id: `${id}#wf${idx + 1}`,
      form: f.form,
      form_norm_soft: fnf.soft,
      form_norm_deep: fnf.deep,
      grammatical_label: f.label,
      note: null,
    };
  });

  const lexical_relations = [];
  let lrIdx = 0;
  for (const syn of parsed.syns) {
    lrIdx++;
    lexical_relations.push({
      id: `${id}#lr${lrIdx}`,
      relation_type: 'synonym',
      related_term: syn,
      related_term_norm: normFields(syn, lang).soft,
    });
  }
  for (const ant of parsed.ants) {
    lrIdx++;
    lexical_relations.push({
      id: `${id}#lr${lrIdx}`,
      relation_type: 'antonym',
      related_term: ant,
      related_term_norm: normFields(ant, lang).soft,
    });
  }

  return {
    id,
    source_lang: lang,
    headword: parsed.headword,
    headword_norm_soft: parsed.nf.soft,
    headword_norm_deep: parsed.nf.deep,
    headword_vowel_fold: parsed.nf.vowelFold,
    headword_script_variant: null,
    headword_script_label: null,
    part_of_speech: parsed.pos,
    gender_or_class: parsed.genderOrClass,
    dialect: parsed.dialect,
    register: null,
    etymology: parsed.etymology,
    root_word: parsed.rootWord,
    root_word_norm: parsed.rootWord ? TextNormalization.normalizeArabic(parsed.rootWord).replace(/[\s\-]/g, '') : null,
    tone_pattern: null,
    cultural_note: null,
    primary_ipa: parsed.primaryIpa,
    audio_phonetic_text: null,
    audio_phonetic_norm: '',
    source_id: sourceId,
    verification_status: 'verified',
    senses,
    examples,
    word_forms,
    lexical_relations,
    translation_links: packEnLinks,
    _score: parsed.score,
  };
}

// ============================================================================
// Step 3: Stream & Build Full Datasets
// ============================================================================

async function scanEnglishAndSelect() {
  console.log('[1/5] Streaming English Kaikki JSONL.gz (selecting entries + extracting cross-language links)...');
  const curated = loadCuratedEntries();
  const curatedByLang = { en: [], ha: [], yo: [], ff: [], ar: [], fr: [], zh: [] };
  const curatedKeys = new Set();
  const curatedHeadwordToId = new Map();

  for (const e of curated) {
    curatedByLang[e.source_lang].push(e);
    curatedKeys.add(`${e.source_lang}|${e.headword.toLowerCase()}|${e.part_of_speech}`);
    curatedHeadwordToId.set(`${e.source_lang}|${normFields(e.headword, e.source_lang).soft}`, e.id);
  }

  const priorityTargetWords = {
    ha: new Set(),
    yo: new Set(),
    ff: new Set(),
    ar: new Set(),
    fr: new Set(),
    zh: new Set(),
  };
  // reverseWiktLinks: targetLang -> normSoft(targetWord) -> Array<{ enWord, enPos, enDef, targetWord, roman, senseIdx }>
  const reverseWiktLinks = {
    ha: new Map(),
    yo: new Map(),
    ff: new Map(),
    ar: new Map(),
    fr: new Map(),
    zh: new Map(),
  };

  const enCandidates = [];
  const seenEnKeys = new Set();
  const MAX_EN_POOL = 32000;

  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(SOURCES_DIR, 'English.jsonl.gz')).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  const DIALECT_SKIP_ZH = ['Dungan', 'Cantonese', 'Hokkien', 'Min Nan', 'Hakka', 'Wu', 'Teochew', 'Gan', 'Xiang'];

  for await (const line of rl) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d.word || !d.senses?.length) continue;

    // Extract cross-language translations even before length pruning
    const extractedTrans = [];
    if (Array.isArray(d.translations) && d.translations.length > 0) {
      for (const t of d.translations) {
        const c = t.code;
        const tLangName = t.lang || '';
        let tLang = null;
        if (c === 'ha' || tLangName === 'Hausa') tLang = 'ha';
        else if (c === 'yo' || tLangName === 'Yoruba') tLang = 'yo';
        else if (c === 'ff' || tLangName === 'Fula') tLang = 'ff';
        else if (c === 'ar' || tLangName === 'Arabic') tLang = 'ar';
        else if (c === 'fr' || tLangName === 'French') tLang = 'fr';
        else if (c === 'zh' || c === 'cmn' || tLangName === 'Mandarin' || tLangName === 'Chinese') tLang = 'zh';
        if (!tLang || !t.word) continue;

        let tWord = String(t.word).trim();
        if (!tWord || tWord.length > 60) continue;
        if (tLang === 'zh') {
          if (t.tags?.some((tg) => DIALECT_SKIP_ZH.includes(tg))) continue;
          if (/[а-яА-Я]/.test(tWord)) continue; // skip Dungan Cyrillic
          // Kaikki often writes "傳統 / 传统" -> take Simplified if slash separated
          if (tWord.includes('/')) {
            const parts = tWord.split('/').map((x) => x.trim()).filter((x) => /[\u4e00-\u9fff]/.test(x));
            if (parts.length > 1) tWord = parts[parts.length - 1];
            else if (parts.length === 1) tWord = parts[0];
          }
          if (!/[\u4e00-\u9fff]/.test(tWord)) continue;
        }
        if (tLang === 'ar') {
          if (t.tags?.some((tg) => tg.includes('Egyptian') || tg.includes('Hijazi') || tg.includes('Moroccan') || tg.includes('Gulf'))) {
            continue;
          }
        }

        extractedTrans.push({
          tLang,
          tWord,
          roman: t.roman ? String(t.roman).trim() : null,
          senseHint: t.sense ? String(t.sense).trim() : '',
          note: t.tags?.length ? t.tags.slice(0, 2).join(', ') : null,
        });
      }
    }

    // Filter standard English entry quality
    const parsed = parseKaikkiRecord(d, 'en');
    if (!parsed) continue;
    const key = `en|${parsed.headword.toLowerCase()}|${parsed.pos}`;
    if (curatedKeys.has(key) || seenEnKeys.has(key)) continue;

    // Prioritize entries with African translations, AR/FR/ZH translations, or strong richness
    const hasAfricanTrans = extractedTrans.some((t) => t.tLang === 'ha' || t.tLang === 'yo' || t.tLang === 'ff');
    const hasMajorTrans = extractedTrans.length > 0;
    const enPriorityBoost =
      (hasAfricanTrans ? 5000 : 0) +
      (hasMajorTrans ? 800 : 0) +
      Math.min(extractedTrans.length * 40, 400);

    const totalScore = parsed.score + enPriorityBoost;
    if (totalScore < 45 && !hasMajorTrans) continue;
    seenEnKeys.add(key);

    // Record priority targets & reverse links
    for (const tr of extractedTrans) {
      const nfT = normFields(tr.tWord, tr.tLang, tr.roman || '');
      priorityTargetWords[tr.tLang].add(nfT.soft);
      if (reverseWiktLinks[tr.tLang].size < 50000) {
        const bucket = reverseWiktLinks[tr.tLang].get(nfT.soft) || [];
        if (bucket.length < 4) {
          bucket.push({
            enWord: parsed.headword,
            enPos: parsed.pos,
            enDef: parsed.realSenses[0].def,
            tWord: tr.tWord,
            roman: tr.roman,
          });
          reverseWiktLinks[tr.tLang].set(nfT.soft, bucket);
        }
      }
    }

    const eid = makeEntryId('en', 'kaikki', parsed.headword, parsed.pos);
    const entry = finalizeEntryRecord(parsed, eid, 'en', 'src-kaikki-wiktionary', []);
    entry._score = totalScore;

    // Attach matched English->Target translation links per sense
    const seenT = new Set();
    const tLinks = [];
    for (const tr of extractedTrans) {
      let matchedSenseIdx = 0;
      if (tr.senseHint) {
        const hintWords = tr.senseHint.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        let bestOverlap = 0;
        entry.senses.forEach((s, idx) => {
          const defLower = s.definition.toLowerCase();
          let overlap = 0;
          for (const hw of hintWords) if (defLower.includes(hw)) overlap++;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            matchedSenseIdx = idx;
          }
        });
      }
      const srcSense = entry.senses[matchedSenseIdx];
      const dedupKey = `${srcSense.id}|${tr.tLang}|${tr.tWord}`;
      if (seenT.has(dedupKey)) continue;
      seenT.add(dedupKey);
      const tnf = normFields(tr.tWord, tr.tLang, tr.roman || '');
      tLinks.push({
        id: `${eid}->${tr.tLang}#${tLinks.length + 1}`,
        source_sense_id: srcSense.id,
        target_lang: tr.tLang,
        target_entry_id: null,
        target_sense_id: null,
        target_headword: tr.tWord,
        target_headword_norm_soft: tnf.soft,
        target_headword_norm_deep: tnf.deep,
        target_transliteration: tr.roman,
        target_transliteration_norm: tr.tLang === 'zh' && tr.roman ? TextNormalization.normalizePinyin(tr.roman) : '',
        target_script_variant: null,
        target_part_of_speech: parsed.pos,
        target_definition: srcSense.definition,
        equivalence_type: 'literal',
        contextual_note: tr.note,
        register: null,
        source_id: 'src-kaikki-wiktionary',
      });
      if (tLinks.length >= 24) break;
    }
    entry.translation_links = tLinks;
    enCandidates.push(entry);

    if (enCandidates.length > MAX_EN_POOL * 2) {
      enCandidates.sort((a, b) => b._score - a._score);
      enCandidates.length = MAX_EN_POOL;
    }
  }

  enCandidates.sort((a, b) => b._score - a._score);
  const fullEn = [...curatedByLang.en, ...enCandidates].slice(0, LIMITS.full.en);
  const coreEn = [...curatedByLang.en, ...enCandidates.slice(0, LIMITS.core.en - curatedByLang.en.length)];

  // Build quick EN lookup map for target linking
  const enLookup = new Map();
  for (const e of fullEn) {
    enLookup.set(e.headword.toLowerCase(), e);
  }

  console.log(`   -> English selected: core=${coreEn.length}, full=${fullEn.length}`);
  return {
    curatedByLang,
    curatedKeys,
    priorityTargetWords,
    reverseWiktLinks,
    coreEn,
    fullEn,
    enLookup,
  };
}

async function importKaikkiLanguage(lang, filename, isGzip, ctx) {
  console.log(`[2/5] Importing Kaikki ${lang} (${filename})...`);
  const { curatedByLang, curatedKeys, priorityTargetWords, reverseWiktLinks, enLookup } = ctx;
  const curated = curatedByLang[lang];

  const stream = isGzip
    ? fs.createReadStream(path.join(SOURCES_DIR, filename)).pipe(zlib.createGunzip())
    : fs.createReadStream(path.join(SOURCES_DIR, filename));
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const pool = [];
  const seenKeys = new Set();
  const maxPool = LIMITS.full[lang] * 2;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = parseKaikkiRecord(d, lang);
    if (!parsed) continue;

    let hw = parsed.headword;
    let key = `${lang}|${hw.toLowerCase()}|${parsed.pos}`;
    if (curatedKeys.has(key)) continue;

    // Do not silently drop tonal homographs in Hausa if canonical differs
    if (seenKeys.has(key) && parsed.canonicalRaw && parsed.canonicalRaw !== hw && !parsed.canonicalRaw.includes(' ')) {
      hw = parsed.canonicalRaw;
      parsed.headword = hw;
      parsed.nf = normFields(hw, lang);
      key = `${lang}|${hw.toLowerCase()}|${parsed.pos}`;
    }
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const priorityBoost = priorityTargetWords[lang]?.has(parsed.nf.soft) ? 2000 : 0;
    const reverseMatches = reverseWiktLinks[lang]?.get(parsed.nf.soft) || [];
    const eid = makeEntryId(lang, 'kaikki', parsed.headword, parsed.pos);
    const links = [];
    const seenEnLink = new Set();

    // 1. Reverse links verified from Wiktionary EN->lang
    for (const rm of reverseMatches) {
      const targetKey = rm.enWord.toLowerCase();
      if (seenEnLink.has(targetKey)) continue;
      seenEnLink.add(targetKey);
      const targetEn = enLookup.get(targetKey);
      const enf = normFields(rm.enWord, 'en');
      links.push({
        id: `${eid}->en#${links.length + 1}`,
        source_sense_id: `${eid}#s1`,
        target_lang: 'en',
        target_entry_id: targetEn?.id || null,
        target_sense_id: targetEn?.senses?.[0]?.id || null,
        target_headword: rm.enWord,
        target_headword_norm_soft: enf.soft,
        target_headword_norm_deep: enf.deep,
        target_transliteration: null,
        target_transliteration_norm: '',
        target_script_variant: null,
        target_part_of_speech: rm.enPos || parsed.pos,
        target_definition: rm.enDef,
        equivalence_type: 'literal',
        contextual_note: null,
        register: null,
        source_id: 'src-kaikki-wiktionary',
      });
    }

    // 2. Concise lexical English glosses matching actual English entries in our DB
    parsed.realSenses.slice(0, 3).forEach((s, idx) => {
      const eqEn = extractShortEnglishEquivalent(s.def);
      if (eqEn) {
        const targetKey = eqEn.toLowerCase();
        if (!seenEnLink.has(targetKey)) {
          const targetEn = enLookup.get(targetKey);
          if (targetEn) {
            seenEnLink.add(targetKey);
            const enf = normFields(targetEn.headword, 'en');
            links.push({
              id: `${eid}->en#${links.length + 1}`,
              source_sense_id: `${eid}#s${idx + 1}`,
              target_lang: 'en',
              target_entry_id: targetEn.id,
              target_sense_id: targetEn.senses[0].id,
              target_headword: targetEn.headword,
              target_headword_norm_soft: enf.soft,
              target_headword_norm_deep: enf.deep,
              target_transliteration: null,
              target_transliteration_norm: '',
              target_script_variant: null,
              target_part_of_speech: targetEn.part_of_speech,
              target_definition: targetEn.senses[0].definition,
              equivalence_type: 'literal',
              contextual_note: null,
              register: null,
              source_id: 'src-kaikki-wiktionary',
            });
          }
        }
      }
    });

    const entry = finalizeEntryRecord(parsed, eid, lang, 'src-kaikki-wiktionary', links);
    entry._score = parsed.score + priorityBoost + links.length * 25;
    pool.push(entry);

    if (pool.length > maxPool * 2) {
      pool.sort((a, b) => b._score - a._score);
      pool.length = maxPool;
    }
  }

  pool.sort((a, b) => b._score - a._score);
  const full = [...curated, ...pool].slice(0, LIMITS.full[lang]);
  const core = [...curated, ...pool.slice(0, Math.max(0, LIMITS.core[lang] - curated.length))];

  console.log(`   -> [${lang}] core=${core.length}, full=${full.length}`);
  return { core, full, seenKeys };
}

function enrichYorubaWithIwaju(yoFull, yoSeenKeys, ctx) {
  console.log('[3/5] Integrating Apache-2.0 IwajuAI English-Yoruba Dictionary...');
  const csvPath = path.join(SOURCES_DIR, 'iwaju_en_yo.csv');
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1);
  const { enLookup, fullEn, coreEn } = ctx;

  // Map existing entries by normalized headword so we add links cleanly without fabricating duplicates
  const yoBySoft = new Map();
  for (const e of yoFull) {
    if (!yoBySoft.has(e.headword_norm_soft)) yoBySoft.set(e.headword_norm_soft, e);
  }

  let addedYo = 0;
  let addedLinks = 0;

  // Simple CSV 3-column parser respecting quotes
  const parseCsvLine = (line) => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols;
  };

  const posCodeToPos = (rawPos) => {
    const m = rawPos.match(/'([^']+)'/);
    const code = m ? m[1].split('/')[0] : 'n';
    if (code === 'v') return 'verb';
    if (code === 'adj') return 'adjective';
    if (code === 'adv') return 'adverb';
    if (code === 'prep') return 'preposition';
    if (code === 'conj') return 'conjunction';
    return 'noun';
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const enWord = cols[0].trim();
    const pos = posCodeToPos(cols[1]);
    const yoRaw = cols[2].trim();

    if (!enWord || enWord.length < 2 || !/^[a-zA-Z][a-zA-Z\s\-']*$/.test(enWord)) continue;
    if (/formatting|progress/i.test(enWord) || /formatting|progress/i.test(yoRaw)) continue;
    if (!yoRaw || yoRaw.startsWith(')') || yoRaw.includes('[')) continue;

    const yoEquivs = yoRaw
      .split(',')
      .map((s) => s.replace(/\([^)]*\)/g, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 45 && !/^[\W\d]+$/.test(s));

    if (yoEquivs.length === 0) continue;

    const enEntry = enLookup.get(enWord.toLowerCase());

    for (const yoWord of yoEquivs.slice(0, 3)) {
      const ynf = normFields(yoWord, 'yo');
      if (!ynf.soft) continue;

      // Add link to existing EN entry if present
      if (enEntry) {
        const dup = enEntry.translation_links.some(
          (l) => l.target_lang === 'yo' && l.target_headword_norm_soft === ynf.soft
        );
        if (!dup && enEntry.translation_links.length < 30) {
          enEntry.translation_links.push({
            id: `${enEntry.id}->yo#${enEntry.translation_links.length + 1}`,
            source_sense_id: enEntry.senses[0].id,
            target_lang: 'yo',
            target_entry_id: yoBySoft.get(ynf.soft)?.id || null,
            target_sense_id: null,
            target_headword: yoWord,
            target_headword_norm_soft: ynf.soft,
            target_headword_norm_deep: ynf.deep,
            target_transliteration: null,
            target_transliteration_norm: '',
            target_script_variant: null,
            target_part_of_speech: pos,
            target_definition: enEntry.senses[0].definition,
            equivalence_type: 'literal',
            contextual_note: null,
            register: null,
            source_id: 'src-iwaju-en-yo',
          });
          addedLinks++;
        }
      }

      // Add new Yoruba headword to Full Pack if not already in Kaikki/Curated
      const yoKey = `yo|${yoWord.toLowerCase()}|${pos}`;
      if (!yoSeenKeys.has(yoKey) && !yoBySoft.has(ynf.soft) && yoFull.length < LIMITS.full.yo) {
        yoSeenKeys.add(yoKey);
        const yid = makeEntryId('yo', 'iwaju', yoWord, pos);
        const enf = normFields(enWord, 'en');
        const newEntry = {
          id: yid,
          source_lang: 'yo',
          headword: yoWord,
          headword_norm_soft: ynf.soft,
          headword_norm_deep: ynf.deep,
          headword_vowel_fold: ynf.vowelFold,
          headword_script_variant: null,
          headword_script_label: null,
          part_of_speech: pos,
          gender_or_class: null,
          dialect: null,
          register: null,
          etymology: null,
          root_word: null,
          root_word_norm: null,
          tone_pattern: null,
          cultural_note: null,
          primary_ipa: '',
          audio_phonetic_text: null,
          audio_phonetic_norm: '',
          source_id: 'src-iwaju-en-yo',
          verification_status: 'verified',
          senses: [
            {
              id: `${yid}#s1`,
              sense_number: 1,
              part_of_speech: pos,
              definition: enEntry ? `${enWord}: ${enEntry.senses[0].definition}` : enWord,
              definition_en: enWord,
              register: null,
              usage_note: null,
            },
          ],
          examples: [],
          word_forms: [],
          lexical_relations: [],
          translation_links: [
            {
              id: `${yid}->en#1`,
              source_sense_id: `${yid}#s1`,
              target_lang: 'en',
              target_entry_id: enEntry?.id || null,
              target_sense_id: enEntry?.senses?.[0]?.id || null,
              target_headword: enWord,
              target_headword_norm_soft: enf.soft,
              target_headword_norm_deep: enf.deep,
              target_transliteration: null,
              target_transliteration_norm: '',
              target_script_variant: null,
              target_part_of_speech: pos,
              target_definition: enEntry ? enEntry.senses[0].definition : enWord,
              equivalence_type: 'literal',
              contextual_note: null,
              register: null,
              source_id: 'src-iwaju-en-yo',
            },
          ],
          _score: 25,
        };
        yoFull.push(newEntry);
        yoBySoft.set(ynf.soft, newEntry);
        addedYo++;
      }
    }
  }
  console.log(`   -> IwajuAI added ${addedYo} unique Yoruba entries & ${addedLinks} EN->YO links`);
}

function importCedict(ctx) {
  console.log('[4/5] Parsing MDBG CC-CEDICT Mandarin Chinese corpus...');
  const { curatedByLang, curatedKeys, priorityTargetWords, enLookup } = ctx;
  const curated = curatedByLang.zh;

  const raw = zlib.gunzipSync(fs.readFileSync(path.join(SOURCES_DIR, 'cedict.txt.gz'))).toString('utf8');
  const lines = raw.split(/\r?\n/);

  const pool = [];
  const seenKeys = new Set();

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/);
    if (!m) continue;
    const trad = m[1].trim();
    const simp = m[2].trim();
    const numPinyin = m[3].trim();
    const rawGlossBlock = m[4].trim();

    if (!/^[\u4e00-\u9fff]+$/.test(simp)) continue;
    if (simp.length > 4) continue; // keep clean lexical words & idioms, skip long encyclopedic phrases

    const glosses = rawGlossBlock
      .split('/')
      .map((g) => g.trim())
      .filter(
        (g) =>
          g.length > 0 &&
          !/^CL:/i.test(g) &&
          !/^variant of /i.test(g) &&
          !/^old variant of /i.test(g) &&
          !/^see /i.test(g) &&
          !/^surname /i.test(g) &&
          !/^(erhua variant|Japanese variant)/i.test(g)
      )
      .slice(0, 5);

    if (glosses.length === 0) continue;

    const key = `zh|${simp}|noun`;
    if (curatedKeys.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const tonePinyin = convertCedictPinyin(numPinyin);
    const barePinyin = TextNormalization.normalizePinyin(tonePinyin);
    const eid = makeEntryId('zh', 'cedict', simp, 'word');

    const senses = glosses.map((g, idx) => ({
      id: `${eid}#s${idx + 1}`,
      sense_number: idx + 1,
      part_of_speech: g.startsWith('to ') ? 'verb' : 'noun',
      definition: g,
      definition_en: g,
      register: null,
      usage_note: null,
    }));

    // Build genuine sense-level zh -> en links
    const links = [];
    const seenEn = new Set();
    senses.forEach((s) => {
      const eqEn = extractShortEnglishEquivalent(s.definition);
      if (eqEn && !seenEn.has(eqEn.toLowerCase())) {
        seenEn.add(eqEn.toLowerCase());
        const targetEn = enLookup.get(eqEn.toLowerCase());
        const enf = normFields(eqEn, 'en');
        links.push({
          id: `${eid}->en#${links.length + 1}`,
          source_sense_id: s.id,
          target_lang: 'en',
          target_entry_id: targetEn?.id || null,
          target_sense_id: targetEn?.senses?.[0]?.id || null,
          target_headword: targetEn?.headword || eqEn,
          target_headword_norm_soft: enf.soft,
          target_headword_norm_deep: enf.deep,
          target_transliteration: null,
          target_transliteration_norm: '',
          target_script_variant: null,
          target_part_of_speech: s.part_of_speech,
          target_definition: targetEn ? targetEn.senses[0].definition : s.definition,
          equivalence_type: 'literal',
          contextual_note: null,
          register: null,
          source_id: 'src-cc-cedict',
        });
      }
    });

    const isPriority = priorityTargetWords.zh.has(simp);
    const score =
      (isPriority ? 2000 : 0) +
      (simp.length === 1 ? 80 : simp.length === 2 ? 60 : simp.length === 3 ? 20 : 10) +
      senses.length * 10 +
      links.length * 15;

    const forms = [];
    if (trad !== simp) {
      forms.push({
        id: `${eid}#wf1`,
        form: trad,
        form_norm_soft: trad,
        form_norm_deep: trad,
        grammatical_label: 'traditional script',
        note: null,
      });
    }

    pool.push({
      id: eid,
      source_lang: 'zh',
      headword: simp,
      headword_norm_soft: simp,
      headword_norm_deep: simp,
      headword_vowel_fold: simp,
      headword_script_variant: trad !== simp ? trad : null,
      headword_script_label: trad !== simp ? 'Traditional' : null,
      part_of_speech: senses[0].part_of_speech,
      gender_or_class: null,
      dialect: 'Standard Mandarin',
      register: null,
      etymology: null,
      root_word: null,
      root_word_norm: null,
      tone_pattern: null,
      cultural_note: null,
      primary_ipa: '',
      audio_phonetic_text: tonePinyin,
      audio_phonetic_norm: barePinyin,
      source_id: 'src-cc-cedict',
      verification_status: 'verified',
      senses,
      examples: [],
      word_forms: forms,
      lexical_relations: [],
      translation_links: links,
      _score: score,
    });
  }

  pool.sort((a, b) => b._score - a._score);
  const full = [...curated, ...pool].slice(0, LIMITS.full.zh);
  const core = [...curated, ...pool.slice(0, LIMITS.core.zh - curated.length)];

  console.log(`   -> [zh] core=${core.length}, full=${full.length}`);
  return { core, full };
}

// ============================================================================
// Step 4: Write NDJSON & Invoke assemble_sqlite.py
// ============================================================================

async function main() {
  const enCtx = await scanEnglishAndSelect();

  const ha = await importKaikkiLanguage('ha', 'Hausa.jsonl', false, enCtx);
  const yo = await importKaikkiLanguage('yo', 'Yoruba.jsonl', false, enCtx);
  const ff = await importKaikkiLanguage('ff', 'Fula.jsonl', false, enCtx);
  const ar = await importKaikkiLanguage('ar', 'Arabic.jsonl.gz', true, enCtx);
  const fr = await importKaikkiLanguage('fr', 'French.jsonl', false, enCtx);
  const zh = importCedict(enCtx);

  enrichYorubaWithIwaju(yo.full, yo.seenKeys, enCtx);

  const byLang = {
    en: { core: enCtx.coreEn, full: enCtx.fullEn },
    ha: { core: ha.core, full: ha.full },
    yo: { core: yo.core, full: yo.full },
    ff: { core: ff.core, full: ff.full },
    ar: { core: ar.core, full: ar.full },
    fr: { core: fr.core, full: fr.full },
    zh: { core: zh.core, full: zh.full },
  };

  // Resolve target_entry_id across core DB before writing NDJSON
  const coreIdByLangSoft = new Map();
  for (const lang of Object.keys(byLang)) {
    for (const e of byLang[lang].core) {
      coreIdByLangSoft.set(`${lang}|${e.headword_norm_soft}`, e.id);
    }
  }

  const writeNdjson = (entries, filePath) => {
    const ws = fs.createWriteStream(filePath, { encoding: 'utf8' });
    for (const e of entries) {
      const clean = { ...e };
      delete clean._score;
      clean.translation_links = clean.translation_links.map((l) => {
        const resolvedId = l.target_entry_id || coreIdByLangSoft.get(`${l.target_lang}|${l.target_headword_norm_soft}`) || null;
        return {
          ...l,
          target_entry_id: resolvedId,
          target_sense_id: l.target_sense_id || (resolvedId ? `${resolvedId}#s1` : null),
        };
      });
      ws.write(JSON.stringify(clean) + '\n');
    }
    return new Promise((res) => ws.end(res));
  };

  const coreNdjsonPath = path.join(BUILD_DIR, 'core.ndjson');
  const allCore = Object.values(byLang).flatMap((v) => v.core);
  await writeNdjson(allCore, coreNdjsonPath);

  const packSpecs = [];
  for (const lang of ['en', 'ha', 'yo', 'ff', 'ar', 'fr', 'zh']) {
    const ndjsonPath = path.join(BUILD_DIR, `pack_${lang}.ndjson`);
    await writeNdjson(byLang[lang].full, ndjsonPath);
    packSpecs.push({
      lang,
      ndjson: ndjsonPath,
      db_out: path.join(BUILD_DIR, `lexica_pack_${lang}.db`),
      gz_out: path.resolve(process.cwd(), 'packs', `lexica_pack_${lang}.sqlite.gz`),
    });
  }

  const languagesMeta = Object.values(LANGUAGES).map((l) => ({
    code: l.code,
    name: l.name,
    native_name: l.nativeName,
    native_script: l.nativeScript,
    script_name: l.scriptName,
    direction: l.direction,
    speakers_count: l.speakersCount,
    accent_color: l.accentColor,
  }));

  const metaJsonPath = path.join(BUILD_DIR, 'build_meta.json');
  const summaryOutPath = path.join(BUILD_DIR, 'summary.json');

  fs.writeFileSync(
    metaJsonPath,
    JSON.stringify(
      {
        version: DATASET_VERSION,
        languages: languagesMeta,
        sources: DATASET_SOURCES,
        core_ndjson: coreNdjsonPath,
        core_db_out: path.resolve(process.cwd(), 'public/assets/databases/lexica_coreSQLite.db'),
        packs: packSpecs,
        summary_out: summaryOutPath,
      },
      null,
      2
    )
  );

  console.log('[5/5] Assembling & FTS5-indexing SQLite databases...');
  execFileSync('python3', ['scripts/assemble_sqlite.py', metaJsonPath], { stdio: 'inherit' });

  const summary = JSON.parse(fs.readFileSync(summaryOutPath, 'utf8'));
  const manifestItems = summary.packs.map((p) => ({
    packId: p.packId,
    langCode: p.langCode,
    tier: p.tier,
    version: p.version,
    schemaVersion: p.schemaVersion ?? summary.schemaVersion,
    dbFileName: p.dbFileName ?? `lexica_pack_${p.langCode}SQLite.db`,
    compressedFileName: p.compressedFileName ?? p.fileName,
    downloadUrl: `${RAW_PACK_BASE_URL}/${p.fileName}`,
    fallbackDownloadUrl: `${CDN_PACK_BASE_URL}/${p.fileName}`,
    sizeBytes: p.sizeBytes,
    compressedSizeBytes: p.compressedSizeBytes,
    sha256Checksum: p.sha256Checksum,
    entryCount: p.entryCount,
    senseCount: p.senseCount,
    translationCount: p.translationCount,
    sources: p.sources,
  }));

  fs.writeFileSync(
    path.resolve(process.cwd(), 'packs/manifest.json'),
    JSON.stringify(
      {
        version: summary.version,
        schemaVersion: summary.schemaVersion,
        coreSizeBytes: summary.coreSizeBytes,
        coreStats: summary.coreStats,
        packs: manifestItems,
      },
      null,
      2
    )
  );

  const tsContent = `// AUTO-GENERATED by scripts/build-sqlite-corpora.mjs — DO NOT EDIT MANUALLY
import type { LanguageCode, PackManifestItem } from '../types/dictionary';

export const BUNDLED_CORE_VERSION = ${JSON.stringify(summary.version)};
export const BUNDLED_CORE_SIZE_BYTES = ${summary.coreSizeBytes};
export const BUNDLED_CORE_STATS: Record<LanguageCode, { entryCount: number; senseCount: number; translationCount: number }> = ${JSON.stringify(summary.coreStats, null, 2)};

export const PACK_MANIFEST_ITEMS: PackManifestItem[] = ${JSON.stringify(manifestItems, null, 2)};
`;
  fs.writeFileSync(path.resolve(process.cwd(), 'src/data/packManifest.ts'), tsContent);

  console.log('\n=== CORPUS BUILD COMPLETE ===');
  console.log(`Core SQLite DB: ${(summary.coreSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log('Core stats:', summary.coreStats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
