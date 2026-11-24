#!/usr/bin/env python3
"""
LEXICA — Assignment 014: Yoruba Schema v4 Core + Extended SQLite Pack Builder

Replaces the fabricated Assignment 013 loop generator with a real open-licensed
Schema v4 pack builder ingesting verified Yoruba lexicographic sources:
  1. Lexica Curated Yoruba Corpus (CC0 1.0 / Lexica Project License)
  2. English Wiktionary Yoruba via Kaikki.org (CC BY-SA 4.0 & GFDL)
  3. Wikidata Lexemes Yoruba wd:Q34311 (CC0 1.0)
  4. Tatoeba Yoruba Sentence Corpus (CC BY 2.0 FR / CC BY 4.0)
  5. Yoruba Wiktionary yo.wiktionary.org (audited: Main Page only -> 0 entries imported)

Linguistic & Schema Guarantees:
  - Preserves Unicode NFC canonical headwords with High/Mid/Low tones and under-dots (ẹ, ọ, ṣ).
  - Never merges distinct tonal minimal pairs (e.g., ọ̀rọ̀ vs ọ́rọ́, igbá vs ìgbà vs ìgbá).
  - Separates yoruba_monolingual, bilingual_explanation, and english_gloss cleanly.
  - Preserves cross-source disagreements in ext.conflict_reviews without silent overwrites.
  - Emits exact SQLite Schema v4 tables compatible with EnglishPackInstallerPlugin.java.

Usage:
  python3 scripts/build_yoruba_schema_v4.py --out-dir .
"""

from __future__ import annotations

import argparse
import bz2
import gzip
import hashlib
import json
import re
import resource
import sqlite3
import subprocess
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

PACK_VERSION_CORE = "0.5.1-core"
PACK_VERSION_EXT = "0.5.1-extended"
DATASET_VERSION = "2026.11-yoruba-schema-v4-v0.5.1"
RELEASE_TAG = "prototype-yo-core-v0.5.1"
REPO_SLUG = "ahmad-maxai/lexica-dictionary-new"

SOURCES_METADATA = [
    (
        1,
        "lexica-curated-yo",
        "Lexica Curated Yoruba Corpus",
        "CC0 1.0 / Lexica Project License",
        "Curated and native-authored by the LEXICA Multilingual Lexicography Project.",
        "https://github.com/ahmad-maxai/lexica-dictionary-new",
        DATASET_VERSION,
    ),
    (
        2,
        "kaikki-en-wikt-yo",
        "English Wiktionary Yoruba via Kaikki.org",
        "CC BY-SA 4.0 & GFDL",
        "Copyright Wikimedia Contributors & Tatu Ylönen (Kaikki.org / Wiktextract). Licensed under CC BY-SA 4.0 & GFDL.",
        "https://kaikki.org/dictionary/Yoruba/",
        DATASET_VERSION,
    ),
    (
        3,
        "wikidata-q34311",
        "Wikidata Lexemes (Yoruba Q34311)",
        "CC0 1.0",
        "Public domain structured lexeme data from Wikidata contributors (CC0 1.0).",
        "https://www.wikidata.org/",
        DATASET_VERSION,
    ),
    (
        4,
        "tatoeba-yor",
        "Tatoeba Yoruba Sentence Corpus",
        "CC BY 2.0 FR",
        "Yoruba usage sentences contributed by Tatoeba Project contributors (CC BY 2.0 FR / CC BY 4.0).",
        "https://tatoeba.org/",
        DATASET_VERSION,
    ),
    (
        5,
        "yowiktionary",
        "Yoruba Wiktionary (yo.wiktionary.org)",
        "CC BY-SA 4.0 & GFDL",
        "Copyright Wikimedia Contributors (yo.wiktionary.org). Audited dump contains 1 mainspace page (Main Page only); 0 lexical entries imported.",
        "https://yo.wiktionary.org/",
        DATASET_VERSION,
    ),
]

PLACEHOLDER_PATTERNS = [
    re.compile(r"^yoruba lexical entry\.?$", re.I),
    re.compile(r"^yoruba entry\.?$", re.I),
    re.compile(r"^definition needed\.?$", re.I),
    re.compile(r"^n/?a\.?$", re.I),
    re.compile(r"^tbd\.?$", re.I),
    re.compile(r"^todo\.?$", re.I),
    re.compile(r"^see\s+[a-z0-9_-]+\.?$", re.I),
]

WHITESPACE_RE = re.compile(r"\s+")
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
ARABIC_HARAKAT_RE = re.compile(r"[\u064B-\u065F\u0670\u0640]")
YORUBA_DIACRITIC_RE = re.compile(r"[ẹọṣẸỌṢàáèéẹ̀ẹ́ìíòóọ̀ọ́ùúǹńm̀ḿ]")

ENGLISH_MARKERS = {
    "the", "a", "an", "of", "and", "or", "in", "on", "at", "for", "with", "from",
    "to", "by", "as", "into", "used", "material", "produce", "things", "substance",
    "liquid", "given", "name", "plural", "singular", "alternative", "form",
    "spelling", "variant", "person", "something", "that", "which", "who",
}
YORUBA_MARKERS = {
    "ni", "ti", "tí", "fún", "fun", "pé", "pe", "ohun", "orúkọ", "oruko",
    "kìí", "kii", "ṣe", "se", "bí", "bi", "láti", "lati", "ara", "jẹ́", "je",
    "tàbí", "tabi", "àti", "ati", "wà", "wa", "ọ̀rọ̀", "oro", "ẹni", "eni",
    "nǹkan", "nnkan", "gbogbo", "ilé", "ile", "omi", "àwọn", "awon", "ń",
}


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def normalize_arabic(text: str) -> str:
    if not text:
        return ""
    stripped = ARABIC_HARAKAT_RE.sub("", text)
    stripped = re.sub(r"[أإآٱ]", "ا", stripped)
    stripped = stripped.replace("ة", "ه").replace("ى", "ي")
    return stripped.strip()


def normalize_tone_insensitive(text: str) -> str:
    """Strips tone marks (acute/grave/macron) while preserving under-dots (ẹ, ọ, ṣ)."""
    if not text:
        return ""
    nfd = unicodedata.normalize("NFD", text.lower())
    no_tones = "".join(ch for ch in nfd if ch not in ("\u0300", "\u0301", "\u0304", "\u0302", "\u030c"))
    return unicodedata.normalize("NFC", no_tones).strip()


def normalize_latin_deep(text: str) -> str:
    """Strips all combining marks (tones + under-dots) and apostrophes for ASCII search."""
    if not text:
        return ""
    nfd = unicodedata.normalize("NFD", text.lower())
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return re.sub(r"[’'ʽ‘`]", "", stripped).strip()


def is_placeholder_or_empty(text: str | None) -> bool:
    if not text:
        return True
    t = WHITESPACE_RE.sub(" ", text).strip()
    if len(t) < 3 or not any(ch.isalnum() for ch in t):
        return True
    return any(p.match(t) for p in PLACEHOLDER_PATTERNS)


def looks_like_english_only(text: str) -> bool:
    t = WHITESPACE_RE.sub(" ", text or "").strip()
    if not t:
        return False
    if YORUBA_DIACRITIC_RE.search(t):
        return False
    tokens = [tok for tok in re.split(r"[^a-zA-Z’']+", t.lower()) if tok]
    if not tokens:
        return False
    yo_hits = sum(1 for tok in tokens if tok in YORUBA_MARKERS)
    en_hits = sum(1 for tok in tokens if tok in ENGLISH_MARKERS)
    if re.match(r"^(to|a|an|the|used)\s+[a-z]{2,}\b", t.lower()) and yo_hits == 0:
        return True
    if en_hits > 0 and yo_hits == 0:
        return True
    return en_hits >= 2 and en_hits > yo_hits * 2


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def gzip_file(src_path: Path, dst_gz_path: Path, compresslevel: int = 9) -> None:
    if dst_gz_path.exists():
        dst_gz_path.unlink()
    with open(src_path, "rb") as f_in, open(dst_gz_path, "wb") as raw_out:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=compresslevel, mtime=0, fileobj=raw_out) as gz_out:
            while True:
                chunk = f_in.read(1024 * 1024)
                if not chunk:
                    break
                gz_out.write(chunk)


def load_curated_entries() -> list[dict[str, Any]]:
    cmd = [
        "npx", "tsx", "-e",
        (
            "import { VERIFIED_SEED_ENTRIES } from './src/data/seedDictionary';"
            "import { DICTIONARY_ENTRIES } from './src/data/dictionaryData';"
            "console.log(JSON.stringify([...VERIFIED_SEED_ENTRIES.filter(e=>e.sourceLang==='yo'),"
            "...DICTIONARY_ENTRIES.filter(e=>e.sourceLang==='yo')]));"
        ),
    ]
    out = subprocess.check_output(cmd)
    return json.loads(out.decode("utf-8"))


def load_tatoeba_yoruba() -> dict[str, list[dict[str, str]]]:
    yor_path = Path("/tmp/audit_sources_yo/tatoeba/yor_sentences.tsv.bz2")
    links_path = Path("/tmp/audit_sources_yo/tatoeba/yor-eng_links.tsv.bz2")
    eng_path = Path("/tmp/audit_sources_yo/tatoeba/eng_sentences.tsv.bz2")

    if not yor_path.exists():
        return {}

    yor_sents: dict[str, str] = {}
    with bz2.open(yor_path, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3:
                sid = parts[0].strip()
                sent = nfc(WHITESPACE_RE.sub(" ", parts[2]).strip())
                if 8 <= len(sent) <= 180:
                    yor_sents[sid] = sent

    eng_ids_needed: set[str] = set()
    yor_to_eng_id: dict[str, str] = {}
    if links_path.exists():
        with bz2.open(links_path, "rt", encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 2 and parts[0] in yor_sents:
                    yor_to_eng_id[parts[0]] = parts[1]
                    eng_ids_needed.add(parts[1])

    eng_sents: dict[str, str] = {}
    if eng_path.exists() and eng_ids_needed:
        with bz2.open(eng_path, "rt", encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 3 and parts[0] in eng_ids_needed:
                    eng_sents[parts[0]] = WHITESPACE_RE.sub(" ", parts[2]).strip()
                    if len(eng_sents) >= len(eng_ids_needed):
                        break

    by_token: dict[str, list[dict[str, str]]] = defaultdict(list)
    for yid, sent in yor_sents.items():
        en_text = eng_sents.get(yor_to_eng_id.get(yid, ""), "")
        tokens = set(re.findall(r"[^\W\d_]{2,}", sent.lower(), re.UNICODE))
        for tok in tokens:
            tok_nfc = nfc(tok)
            if len(by_token[tok_nfc]) < 2:
                by_token[tok_nfc].append({
                    "sourceText": sent,
                    "targetText": en_text,
                    "attribution": "Tatoeba Project (CC BY 2.0 FR)",
                })
    return by_token


def main() -> None:
    parser = argparse.ArgumentParser(description="Build LEXICA Assignment 014 Schema v4 Yoruba Core + Extended Packs")
    parser.add_argument("--out-dir", default=".")
    args = parser.parse_args()

    t_start = time.perf_counter()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    core_db = out_dir / "lexica_yoruba_core.db"
    ext_db = out_dir / "lexica_yoruba_extended.db"
    core_gz = out_dir / "lexica_yoruba_core.db.gz"
    ext_gz = out_dir / "lexica_yoruba_extended.db.gz"
    for p in [core_db, ext_db, core_gz, ext_gz]:
        if p.exists():
            p.unlink()

    # 1. Load Lexica Curated Yoruba Corpus
    curated = load_curated_entries()
    print(f"Loaded Lexica Curated Yoruba entries: {len(curated)}")

    # 2. Load Kaikki EN-Wiktionary Yoruba (CC BY-SA 4.0 & GFDL)
    kaikki_path = Path("/tmp/audit_sources_yo/kaikki/kaikki_yoruba.jsonl")
    if not kaikki_path.exists():
        raise FileNotFoundError(f"Missing Kaikki Yoruba source: {kaikki_path}")

    kaikki_entries: dict[tuple[str, str], dict[str, Any]] = {}
    kaikki_by_hw: dict[str, list[dict[str, Any]]] = defaultdict(list)

    pos_normalize_map = {
        "name": "proper noun",
        "adj": "adjective",
        "adv": "adverb",
        "intj": "interjection",
        "pron": "pronoun",
        "conj": "conjunction",
        "num": "numeral",
        "prep": "preposition",
        "det": "determiner",
        "particle": "particle",
    }

    with open(kaikki_path, "r", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            bare_word = nfc((r.get("word") or "").strip())
            if not bare_word:
                continue

            # CRITICAL: Recover canonical tone-marked headword so tonal minimal pairs never collapse
            canonical_forms = [
                nfc(frm["form"].strip())
                for frm in (r.get("forms") or [])
                if "canonical" in (frm.get("tags") or []) and frm.get("form")
            ]
            hw = canonical_forms[0] if canonical_forms else bare_word
            if not hw:
                continue

            pos_raw = (r.get("pos") or "noun").strip().lower()
            pos_norm = pos_normalize_map.get(pos_raw, pos_raw)

            ipas = []
            audio_refs = []
            dialect_note = None
            for s in r.get("sounds") or []:
                if s.get("ipa"):
                    ipas.append({"ipa": s["ipa"], "tags": s.get("tags") or ([s["note"]] if s.get("note") else [])})
                if not dialect_note and s.get("note"):
                    dialect_note = s["note"]
                if s.get("audio"):
                    audio_refs.append({
                        "file": s["audio"],
                        "oggUrl": s.get("ogg_url"),
                        "mp3Url": s.get("mp3_url"),
                        "license": "Wikimedia Commons (CC BY-SA)",
                    })

            forms = []
            ajami_variants = []
            if bare_word.lower() != hw.lower():
                forms.append(bare_word)
            for frm in r.get("forms") or []:
                fv = nfc((frm.get("form") or "").strip())
                if not fv or fv == hw:
                    continue
                if ARABIC_RE.search(fv):
                    ajami_variants.append(fv)
                forms.append(fv)

            glosses = []
            synonyms = []
            antonyms = []
            examples = []
            for s in r.get("senses") or []:
                g = s.get("glosses") or s.get("raw_glosses") or []
                if g:
                    gloss_txt = WHITESPACE_RE.sub(" ", "; ".join(g)).strip()
                    if not is_placeholder_or_empty(gloss_txt):
                        glosses.append(gloss_txt)
                for syn in s.get("synonyms") or []:
                    if isinstance(syn, dict) and syn.get("word"):
                        synonyms.append(nfc(syn["word"]))
                for ant in s.get("antonyms") or []:
                    if isinstance(ant, dict) and ant.get("word"):
                        antonyms.append(nfc(ant["word"]))
                for ex in s.get("examples") or []:
                    if isinstance(ex, dict) and ex.get("text") and len(ex["text"]) <= 200:
                        examples.append({
                            "sourceText": nfc(ex["text"].strip()),
                            "targetText": (ex.get("english") or ex.get("translation") or "").strip(),
                            "attribution": ex.get("ref") or "Kaikki EN-Wiktionary (CC BY-SA 4.0)",
                        })

            if not glosses:
                continue

            rec = {
                "headword": hw,
                "pos": pos_norm,
                "primaryIpa": ipas[0]["ipa"] if ipas else None,
                "allIpas": ipas,
                "audioRefs": audio_refs,
                "dialect": dialect_note,
                "ajamiVariants": list(dict.fromkeys(ajami_variants)),
                "forms": list(dict.fromkeys(forms)),
                "glosses": list(dict.fromkeys(glosses)),
                "synonyms": list(dict.fromkeys(synonyms))[:8],
                "antonyms": list(dict.fromkeys(antonyms))[:6],
                "examples": examples[:4],
                "etymology": r.get("etymology_text"),
            }
            hw_key = hw.lower()
            kaikki_by_hw[hw_key].append(rec)
            key = (hw_key, pos_norm)
            if key not in kaikki_entries:
                kaikki_entries[key] = rec
            else:
                existing = kaikki_entries[key]
                existing["glosses"] = list(dict.fromkeys(existing["glosses"] + rec["glosses"]))
                existing["forms"] = list(dict.fromkeys(existing["forms"] + rec["forms"]))
                existing["ajamiVariants"] = list(dict.fromkeys(existing["ajamiVariants"] + rec["ajamiVariants"]))
                existing["allIpas"].extend(rec["allIpas"])
                existing["audioRefs"].extend(rec["audioRefs"])
                existing["synonyms"] = list(dict.fromkeys(existing["synonyms"] + rec["synonyms"]))[:8]
                existing["antonyms"] = list(dict.fromkeys(existing["antonyms"] + rec["antonyms"]))[:6]
                if len(existing["examples"]) < 4:
                    existing["examples"] = (existing["examples"] + rec["examples"])[:4]
                if not existing["etymology"] and rec["etymology"]:
                    existing["etymology"] = rec["etymology"]
                if not existing["primaryIpa"] and rec["primaryIpa"]:
                    existing["primaryIpa"] = rec["primaryIpa"]
    print(f"Loaded Kaikki EN-Wiktionary Yoruba keyed entries: {len(kaikki_entries)}")

    # 3. Load Wikidata Lexemes Q34311 (CC0 1.0)
    wd_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    wd_path = Path("/tmp/audit_sources_yo/wikidata/wikidata_yo_lexemes.json")
    if wd_path.exists():
        wd_json = json.loads(wd_path.read_text(encoding="utf-8"))
        by_lexeme: dict[str, dict[str, Any]] = defaultdict(lambda: {"lemmas": [], "pos": "noun", "yoGloss": [], "enGloss": []})
        for b in wd_json.get("results", {}).get("bindings", []):
            lid = b.get("lexeme", {}).get("value", "")
            if not lid:
                continue
            rec = by_lexeme[lid]
            lemma = nfc((b.get("lemma", {}).get("value") or "").strip())
            if lemma and lemma not in rec["lemmas"]:
                rec["lemmas"].append(lemma)
            cat = (b.get("catLabel", {}).get("value") or "").strip().lower()
            if cat:
                rec["pos"] = pos_normalize_map.get(cat, cat)
            gloss = nfc((b.get("gloss", {}).get("value") or "").strip())
            glang = b.get("glossLang", {}).get("value", "")
            if gloss and not is_placeholder_or_empty(gloss):
                if glang == "yo" and not looks_like_english_only(gloss):
                    if gloss not in rec["yoGloss"]:
                        rec["yoGloss"].append(gloss)
                elif (glang == "en" or looks_like_english_only(gloss)) and gloss not in rec["enGloss"]:
                    rec["enGloss"].append(gloss)

        for _lid, rec in by_lexeme.items():
            if not rec["lemmas"] or (not rec["yoGloss"] and not rec["enGloss"]):
                continue
            hw = rec["lemmas"][0]
            # Normalize ALL-CAPS Wikidata lemmas like 'ÈKÙRỌ́' to lowercase/titlecase cleanly if all upper
            if hw.isupper() and len(hw) > 1:
                hw = hw.lower()
            key = (hw.lower(), rec["pos"])
            existing = wd_by_key.get(key)
            if not existing:
                wd_by_key[key] = {
                    "headword": hw,
                    "pos": rec["pos"],
                    "forms": rec["lemmas"][1:],
                    "yoGloss": rec["yoGloss"],
                    "enGloss": rec["enGloss"],
                }
            else:
                existing["forms"] = list(dict.fromkeys(existing["forms"] + rec["lemmas"][1:]))
                existing["yoGloss"] = list(dict.fromkeys(existing["yoGloss"] + rec["yoGloss"]))
                existing["enGloss"] = list(dict.fromkeys(existing["enGloss"] + rec["enGloss"]))
    print(f"Loaded Wikidata Q34311 usable keyed entries: {len(wd_by_key)}")

    # 4. Merge approved sources conservatively WITHOUT collapsing tonal minimal pairs
    all_keys: dict[tuple[str, str], dict[str, Any]] = {}

    def ensure_bucket(hw: str, pos: str) -> dict[str, Any]:
        hw_nfc = nfc(hw.strip())
        k = (hw_nfc.lower(), pos)
        if k not in all_keys:
            all_keys[k] = {
                "headword": hw_nfc,
                "pos": pos,
                "script_variant": None,
                "primary_ipa": None,
                "all_ipas": [],
                "audio_refs": [],
                "dialect": None,
                "etymology": None,
                "forms": [],
                "synonyms": [],
                "antonyms": [],
                "senses": [],  # (source_id, def_yo, def_en, def_type, verif_status, examples, synonyms, antonyms)
            }
        return all_keys[k]

    for e in curated:
        hw = nfc(e["headword"].strip())
        raw_pos = (e.get("partOfSpeech") or "noun").strip().lower()
        pos = re.sub(r"\s*\([^)]*\)", "", raw_pos).strip() or "noun"
        b = ensure_bucket(hw, pos)
        if e.get("ipa") and not b["primary_ipa"]:
            b["primary_ipa"] = e.get("ipa")
        if e.get("dialect") and not b["dialect"]:
            b["dialect"] = e.get("dialect")
        if e.get("etymology") and not b["etymology"]:
            b["etymology"] = e.get("etymology")
        if e.get("ipa"):
            b["all_ipas"].append({"ipa": e["ipa"], "tags": [b["dialect"]] if b["dialect"] else []})
        if e.get("headwordScriptVariant") and e["headwordScriptVariant"].get("text"):
            sv = nfc(e["headwordScriptVariant"]["text"])
            b["script_variant"] = sv
            b["forms"].append(sv)
        for mf in e.get("morphologicalForms") or []:
            if mf.get("form"):
                b["forms"].append(nfc(mf["form"]))
        b["synonyms"].extend(e.get("synonyms") or [])
        b["antonyms"].extend(e.get("antonyms") or [])
        ex_list = [
            {
                "sourceText": nfc(ex.get("sourceText", "")),
                "targetText": ex.get("targetText", ""),
                "attribution": "Lexica Curated Yoruba Corpus",
            }
            for ex in (e.get("examples") or [])
            if ex.get("sourceText")
        ]
        def_yo = nfc((e.get("definition") or "").strip()) or None
        def_en = (e.get("definitionEn") or "").strip() or None
        if def_yo and looks_like_english_only(def_yo):
            if not def_en:
                def_en = def_yo
            def_yo = None
        dtype = (
            "bilingual_explanation"
            if (def_yo and def_en)
            else ("yoruba_monolingual" if def_yo else "english_gloss")
        )
        b["senses"].append((
            1,
            def_yo,
            def_en,
            dtype,
            "human_verified",
            ex_list,
            list(e.get("synonyms") or []),
            list(e.get("antonyms") or []),
        ))

    for (_hw_l, pos), k_data in kaikki_entries.items():
        b = ensure_bucket(k_data["headword"], pos)
        if not b["primary_ipa"] and k_data["primaryIpa"]:
            b["primary_ipa"] = k_data["primaryIpa"]
        b["all_ipas"].extend(k_data["allIpas"])
        b["audio_refs"].extend(k_data["audioRefs"])
        if not b["dialect"] and k_data["dialect"]:
            b["dialect"] = k_data["dialect"]
        if not b["script_variant"] and k_data["ajamiVariants"]:
            b["script_variant"] = k_data["ajamiVariants"][0]
        b["forms"].extend(k_data["forms"])
        b["synonyms"].extend(k_data["synonyms"])
        b["antonyms"].extend(k_data["antonyms"])
        if not b["etymology"] and k_data["etymology"]:
            b["etymology"] = k_data["etymology"]
        for idx_g, g in enumerate(k_data["glosses"][:4]):
            b["senses"].append((
                2,
                None,
                g,
                "english_gloss",
                "community_reviewed",
                k_data["examples"] if idx_g == 0 else [],
                k_data["synonyms"] if idx_g == 0 else [],
                k_data["antonyms"] if idx_g == 0 else [],
            ))

    for (_hw_l, pos), wd in wd_by_key.items():
        b = ensure_bucket(wd["headword"], pos)
        b["forms"].extend(wd["forms"])
        if wd["yoGloss"]:
            for idx_y, g in enumerate(wd["yoGloss"]):
                en_join = "; ".join(wd["enGloss"]) if (idx_y == 0 and wd["enGloss"]) else None
                b["senses"].append((
                    3,
                    g,
                    en_join,
                    "bilingual_explanation" if en_join else "yoruba_monolingual",
                    "community_reviewed",
                    [],
                    [],
                    [],
                ))
        elif wd["enGloss"]:
            b["senses"].append((
                3,
                None,
                "; ".join(wd["enGloss"]),
                "english_gloss",
                "community_reviewed",
                [],
                [],
                [],
            ))

    # Cross-POS IPA enrichment from Kaikki
    for (hw_l, _pos), b in all_keys.items():
        if hw_l in kaikki_by_hw:
            for k_rec in kaikki_by_hw[hw_l]:
                if not b["primary_ipa"] and k_rec["primaryIpa"]:
                    b["primary_ipa"] = k_rec["primaryIpa"]
                    b["all_ipas"].extend(k_rec["allIpas"])
                if not b["audio_refs"] and k_rec["audioRefs"]:
                    b["audio_refs"].extend(k_rec["audioRefs"])

    # 5. Load Tatoeba Yoruba Sentences (CC BY 2.0 FR)
    tatoeba_by_token = load_tatoeba_yoruba()
    print(f"Loaded Tatoeba Yoruba token-example buckets: {len(tatoeba_by_token)}")

    final_records = [b for b in all_keys.values() if b["senses"]]
    final_records.sort(key=lambda r: (r["headword"].lower(), r["pos"]))
    print(f"Final Schema v4 Yoruba Core entries: {len(final_records)}")

    # 6. Build Core + Extended Schema v4 SQLite Databases
    c_conn = sqlite3.connect(str(core_db))
    c_conn.executescript(
        """
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;

        CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            license TEXT NOT NULL,
            attribution_text TEXT NOT NULL,
            source_url TEXT NOT NULL,
            dataset_version TEXT NOT NULL
        );
        CREATE TABLE parts_of_speech (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            headword TEXT NOT NULL,
            headword_lower TEXT NOT NULL,
            headword_norm TEXT,
            script_variant TEXT,
            script_variant_norm TEXT,
            pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
            primary_ipa TEXT,
            audio_file TEXT,
            dialect TEXT,
            definition_yo TEXT,
            definition_en TEXT,
            primary_definition TEXT NOT NULL,
            definition_type TEXT NOT NULL CHECK(definition_type IN ('yoruba_monolingual','english_gloss','bilingual_explanation','machine_generated','unavailable')),
            verification_status TEXT NOT NULL CHECK(verification_status IN ('human_verified','community_reviewed','unverified_import','conflict_flagged','rejected')),
            has_conflict INTEGER NOT NULL DEFAULT 0,
            source_id INTEGER NOT NULL REFERENCES sources(id)
        );
        CREATE TABLE word_forms (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id),
            form TEXT NOT NULL,
            form_norm TEXT
        );
        CREATE VIRTUAL TABLE entries_fts USING fts5(
            headword,
            definition_yo,
            definition_en,
            primary_definition,
            content='',
            detail=none,
            tokenize = 'unicode61 remove_diacritics 1'
        );
        """
    )

    e_conn = sqlite3.connect(str(ext_db))
    e_conn.executescript(
        """
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;

        CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE senses_ext (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL,
            sense_number INTEGER NOT NULL,
            part_of_speech TEXT NOT NULL,
            definition_yo TEXT,
            definition_en TEXT,
            definition_type TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            verification_status TEXT NOT NULL,
            examples TEXT,
            synonyms TEXT,
            antonyms TEXT
        );
        CREATE TABLE entry_extensions (
            entry_id INTEGER PRIMARY KEY,
            all_ipas TEXT,
            etymology TEXT,
            audio_refs TEXT,
            conflict_notes TEXT
        );
        CREATE TABLE conflict_reviews (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL,
            headword TEXT NOT NULL,
            part_of_speech TEXT NOT NULL,
            conflicting_sources_json TEXT NOT NULL,
            disagreement_nature TEXT NOT NULL,
            review_decision TEXT NOT NULL DEFAULT 'pending',
            reviewer_status TEXT NOT NULL DEFAULT 'conflict_flagged',
            review_notes TEXT
        );
        """
    )

    for s in SOURCES_METADATA:
        c_conn.execute("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?);", s)
    source_lookup = {s[0]: {"code": s[1], "name": s[2], "license": s[3]} for s in SOURCES_METADATA}

    pos_cache: dict[str, int] = {}

    def get_pos_id(pos_name: str) -> int:
        pn = pos_name if len(pos_name) <= 40 else "other"
        if pn not in pos_cache:
            cur = c_conn.execute("INSERT INTO parts_of_speech (name) VALUES (?);", (pn,))
            pos_cache[pn] = int(cur.lastrowid)
        return pos_cache[pn]

    def_type_counts = Counter()
    source_counts = Counter()
    verif_counts = Counter()
    distinct_hw = set()
    conflict_count = 0
    conflict_review_id = 1
    with_examples_count = 0
    with_ipa_count = 0
    with_audio_count = 0
    with_ajami_count = 0
    total_forms = 0
    total_senses = 0
    wf_id = 1
    sense_id = 1

    # Also track tonal minimal-pair ambiguity counts (diagnostic)
    tone_folded_groups: dict[str, set[str]] = defaultdict(set)

    for idx, b in enumerate(final_records, start=1):
        hw = b["headword"]
        hw_l = hw.lower()
        distinct_hw.add(hw_l)
        tone_folded_groups[normalize_tone_insensitive(hw_l)].add(hw_l)

        hw_norm = normalize_latin_deep(hw_l)
        hw_norm_opt = None if hw_norm == hw_l else hw_norm
        pos_id = get_pos_id(b["pos"])

        # Rank human-verified & Yoruba-explained senses highest for primary display
        ordered_senses = sorted(
            b["senses"],
            key=lambda s: (
                0 if s[4] == "human_verified" else (1 if s[1] else 2),
                s[0],
            ),
        )
        best_src, best_yo, best_en, best_dtype, best_verif, _best_ex, _best_syn, _best_ant = ordered_senses[0]

        if best_yo and not best_en:
            en_cands = [s[2] for s in ordered_senses if s[2]]
            if en_cands:
                best_en = en_cands[0]
                best_dtype = "bilingual_explanation"
        elif best_en and not best_yo:
            yo_cands = [s[1] for s in ordered_senses if s[1]]
            if yo_cands:
                best_yo = yo_cands[0]
                best_dtype = "bilingual_explanation"

        # Detect cross-source disagreements (either Yoruba defs or English glosses across >1 source)
        src_ids = {s[0] for s in ordered_senses}
        yo_defs_unique = {normalize_latin_deep(s[1]) for s in ordered_senses if s[1]}
        en_defs_unique = {normalize_latin_deep(s[2]) for s in ordered_senses if s[2]}
        has_conflict = 1 if len(src_ids) > 1 and (len(yo_defs_unique) > 1 or len(en_defs_unique) > 1) else 0
        if has_conflict:
            conflict_count += 1
            if best_verif == "community_reviewed":
                best_verif = "conflict_flagged"

        primary_def_display = best_yo if best_yo else (best_en or "")
        sv = b["script_variant"]
        sv_norm = normalize_arabic(sv) if sv else None
        if sv_norm == sv:
            sv_norm = None

        audio_file = b["audio_refs"][0]["file"] if b["audio_refs"] else None
        if b["primary_ipa"]:
            with_ipa_count += 1
        if audio_file:
            with_audio_count += 1
        if sv:
            with_ajami_count += 1

        def_type_counts[best_dtype] += 1
        source_counts[best_src] += 1
        verif_counts[best_verif] += 1

        c_conn.execute(
            "INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                idx, hw, hw_l, hw_norm_opt, sv, sv_norm, pos_id,
                b["primary_ipa"], audio_file, b["dialect"], best_yo, best_en, primary_def_display,
                best_dtype, best_verif, has_conflict, best_src,
            ),
        )
        c_conn.execute(
            "INSERT INTO entries_fts(rowid, headword, definition_yo, definition_en, primary_definition) VALUES (?, ?, ?, ?, ?);",
            (idx, hw, best_yo or "", best_en or "", primary_def_display),
        )

        # Ensure tone-stripped form is searchable via word_forms when distinct
        forms_to_insert: list[str] = list(dict.fromkeys(b["forms"]))
        tone_folded_hw = normalize_tone_insensitive(hw_l)
        if tone_folded_hw != hw_l and tone_folded_hw not in [f.lower() for f in forms_to_insert]:
            forms_to_insert.append(tone_folded_hw)

        for frm in forms_to_insert:
            if ARABIC_RE.search(frm):
                fn = normalize_arabic(frm)
                c_conn.execute("INSERT INTO word_forms VALUES (?, ?, ?, ?);", (wf_id, idx, frm, None if fn == frm else fn))
            else:
                fl = frm.lower()
                fn = normalize_latin_deep(fl)
                c_conn.execute("INSERT INTO word_forms VALUES (?, ?, ?, ?);", (wf_id, idx, frm, None if fn == fl else fn))
            wf_id += 1
            total_forms += 1

        tatoeba_exs = tatoeba_by_token.get(hw_l, [])
        entry_had_ex = False
        for s_num, (s_src, s_yo, s_en, s_dtype, s_verif, s_exs, s_syns, s_ants) in enumerate(ordered_senses, start=1):
            merged_ex = list(s_exs)
            if s_num == 1 and tatoeba_exs:
                existing_texts = {ex.get("sourceText") for ex in merged_ex}
                for tex in tatoeba_exs:
                    if tex["sourceText"] not in existing_texts:
                        merged_ex.append(tex)
            if merged_ex:
                entry_had_ex = True
            syn_list = list(dict.fromkeys(s_syns if s_num > 1 else (s_syns + b["synonyms"])))[:8]
            ant_list = list(dict.fromkeys(s_ants if s_num > 1 else (s_ants + b["antonyms"])))[:6]
            e_conn.execute(
                "INSERT INTO senses_ext VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                (
                    sense_id,
                    idx,
                    s_num,
                    b["pos"],
                    s_yo,
                    s_en,
                    s_dtype,
                    s_src,
                    s_verif,
                    json.dumps(merged_ex, ensure_ascii=False),
                    json.dumps(syn_list, ensure_ascii=False),
                    json.dumps(ant_list, ensure_ascii=False),
                ),
            )
            sense_id += 1
            total_senses += 1

        if entry_had_ex:
            with_examples_count += 1

        seen_ipa = set()
        dedup_ipas = []
        for item in b["all_ipas"]:
            key_i = (item["ipa"], tuple(item.get("tags") or []))
            if key_i not in seen_ipa:
                seen_ipa.add(key_i)
                dedup_ipas.append(item)

        if dedup_ipas or b["etymology"] or b["audio_refs"] or has_conflict:
            conflict_note = "Cross-source Yoruba/English glosses preserved separately for native linguist review." if has_conflict else None
            e_conn.execute(
                "INSERT INTO entry_extensions VALUES (?, ?, ?, ?, ?);",
                (
                    idx,
                    json.dumps(dedup_ipas, ensure_ascii=False),
                    b["etymology"],
                    json.dumps(b["audio_refs"], ensure_ascii=False) if b["audio_refs"] else None,
                    conflict_note,
                ),
            )

        if has_conflict:
            conflict_versions = []
            for s_src, s_yo, s_en, s_dtype, s_verif, _s_ex, _s_syn, _s_ant in ordered_senses:
                src_meta = source_lookup.get(s_src, {"code": "unknown", "name": "Unknown", "license": ""})
                conflict_versions.append({
                    "sourceCode": src_meta["code"],
                    "sourceName": src_meta["name"],
                    "license": src_meta["license"],
                    "definitionYo": s_yo,
                    "definitionEn": s_en,
                    "definitionType": s_dtype,
                    "verificationStatus": s_verif,
                })
            e_conn.execute(
                "INSERT INTO conflict_reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
                (
                    conflict_review_id,
                    idx,
                    hw,
                    b["pos"],
                    json.dumps(conflict_versions, ensure_ascii=False),
                    "Cross-source Yoruba/English definitions supplied across independent open sources.",
                    "pending",
                    "conflict_flagged",
                    None,
                ),
            )
            conflict_review_id += 1

    c_conn.execute("CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);")
    c_conn.execute("CREATE INDEX idx_entries_headword_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_entries_script_variant ON entries(script_variant) WHERE script_variant IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_entries_script_variant_norm ON entries(script_variant_norm) WHERE script_variant_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_entries_def_type ON entries(definition_type);")
    c_conn.execute("CREATE INDEX idx_word_forms_form ON word_forms(form);")
    c_conn.execute("CREATE INDEX idx_word_forms_form_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_word_forms_entry_id ON word_forms(entry_id);")

    # Re-verify counts directly via SQL queries before inserting metadata
    sql_entries = int(c_conn.execute("SELECT COUNT(*) FROM entries;").fetchone()[0])
    sql_distinct_hw = int(c_conn.execute("SELECT COUNT(DISTINCT headword_lower) FROM entries;").fetchone()[0])
    sql_word_forms = int(c_conn.execute("SELECT COUNT(*) FROM word_forms;").fetchone()[0])
    sql_total_senses = int(e_conn.execute("SELECT COUNT(*) FROM senses_ext;").fetchone()[0])
    sql_conflicts = int(e_conn.execute("SELECT COUNT(*) FROM conflict_reviews;").fetchone()[0])

    yo_monolingual_total = def_type_counts["yoruba_monolingual"] + def_type_counts["bilingual_explanation"]
    tonal_minimal_pair_sets = sum(1 for v in tone_folded_groups.values() if len(v) > 1)

    core_meta = [
        ("pack_id", "yo-lexica-schema-v4"),
        ("schema_version", "4"),
        ("pack_layer", "core"),
        ("pack_version", PACK_VERSION_CORE),
        ("dataset_version", DATASET_VERSION),
        ("accepted_entries", str(sql_entries)),
        ("distinct_headwords", str(sql_distinct_hw)),
        ("total_senses", str(sql_total_senses)),
        ("core_primary_senses", str(sql_entries)),
        ("total_word_forms", str(sql_word_forms)),
        ("yoruba_monolingual_count", str(def_type_counts["yoruba_monolingual"])),
        ("bilingual_count", str(def_type_counts["bilingual_explanation"])),
        ("english_gloss_count", str(def_type_counts["english_gloss"])),
        ("conflict_count", str(sql_conflicts)),
    ]
    for k, v in core_meta:
        c_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    ext_meta = [
        ("pack_id", "yo-lexica-schema-v4-extended"),
        ("schema_version", "4"),
        ("pack_layer", "extended"),
        ("pack_version", PACK_VERSION_EXT),
        ("dataset_version", DATASET_VERSION),
        ("total_senses", str(sql_total_senses)),
        ("conflict_count", str(sql_conflicts)),
    ]
    for k, v in ext_meta:
        e_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    c_conn.commit()
    e_conn.commit()

    qc_core = c_conn.execute("PRAGMA quick_check;").fetchone()[0]
    qc_ext = e_conn.execute("PRAGMA quick_check;").fetchone()[0]

    # Run SQLite query latency benchmarks before closing
    t0 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_lower = 'ilé';").fetchall()
    exact_ms = (time.perf_counter() - t0) / 100 * 1000

    t1 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_norm = 'oro' OR headword_lower = 'ọ̀rọ̀';").fetchall()
    norm_ms = (time.perf_counter() - t1) / 100 * 1000

    t2 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_lower >= 'igb' AND headword_lower < 'igc' LIMIT 20;").fetchall()
    prefix_ms = (time.perf_counter() - t2) / 100 * 1000

    t3 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'house' LIMIT 20;").fetchall()
    fts_ms = (time.perf_counter() - t3) / 100 * 1000

    c_conn.close()
    e_conn.close()

    gzip_file(core_db, core_gz)
    gzip_file(ext_db, ext_gz)

    core_uncomp_bytes = core_db.stat().st_size
    core_comp_bytes = core_gz.stat().st_size
    core_uncomp_sha = sha256_file(core_db)
    core_comp_sha = sha256_file(core_gz)

    ext_uncomp_bytes = ext_db.stat().st_size
    ext_comp_bytes = ext_gz.stat().st_size
    ext_uncomp_sha = sha256_file(ext_db)
    ext_comp_sha = sha256_file(ext_gz)

    manifest = {
        "packId": "yo-lexica-schema-v4",
        "targetLanguage": "yo",
        "format": "sqlite-gzip",
        "packLayer": "core",
        "schemaVersion": 4,
        "packVersion": PACK_VERSION_CORE,
        "datasetVersion": DATASET_VERSION,
        "releaseTag": RELEASE_TAG,
        "downloadUrl": f"https://github.com/{REPO_SLUG}/releases/download/{RELEASE_TAG}/lexica_yoruba_core.db.gz",
        "compressedSizeBytes": core_comp_bytes,
        "compressedSha256": core_comp_sha,
        "uncompressedSizeBytes": core_uncomp_bytes,
        "uncompressedSha256": core_uncomp_sha,
        "acceptedEntries": sql_entries,
        "distinctHeadwords": sql_distinct_hw,
        "totalSenses": sql_total_senses,
        "corePrimarySenses": sql_entries,
        "totalWordForms": sql_word_forms,
        "yorubaMonolingualCount": def_type_counts["yoruba_monolingual"],
        "bilingualExplanationCount": def_type_counts["bilingual_explanation"],
        "englishGlossOnlyCount": def_type_counts["english_gloss"],
        "conflictCount": sql_conflicts,
        "extendedCompanion": {
            "packId": "yo-lexica-schema-v4-extended",
            "packLayer": "extended",
            "schemaVersion": 4,
            "packVersion": PACK_VERSION_EXT,
            "optional": True,
            "autoDownload": False,
            "compressedSizeBytes": ext_comp_bytes,
            "compressedSha256": ext_comp_sha,
            "uncompressedSizeBytes": ext_uncomp_bytes,
            "uncompressedSha256": ext_uncomp_sha,
            "downloadUrl": f"https://github.com/{REPO_SLUG}/releases/download/{RELEASE_TAG}/lexica_yoruba_extended.db.gz",
        },
        "attribution": {
            "sourceName": "Kaikki EN-Wiktionary Yoruba, Wikidata Q34311, Tatoeba & Lexica Curated Corpus",
            "license": "CC BY-SA 4.0 & GFDL; CC0 1.0; CC BY 2.0 FR",
            "attributionText": "Open-licensed Yoruba lexicography compiled from English Wiktionary via Kaikki.org (CC BY-SA 4.0 & GFDL), Wikidata Lexemes Q34311 (CC0 1.0), Tatoeba Yoruba Corpus (CC BY 2.0 FR), and Lexica Curated Corpus.",
            "sourceUrl": "https://kaikki.org/dictionary/Yoruba/",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        },
    }

    report = {
        "packId": "yo-lexica-schema-v4",
        "datasetVersion": DATASET_VERSION,
        "schemaVersion": 4,
        "quickCheckCore": qc_core,
        "quickCheckExtended": qc_ext,
        "totalEntries": sql_entries,
        "distinctHeadwords": sql_distinct_hw,
        "totalSenses": sql_total_senses,
        "wordFormsPreserved": sql_word_forms,
        "tonalMinimalPairGroups": tonal_minimal_pair_sets,
        "entriesWithYorubaExplanation": yo_monolingual_total,
        "yorubaExplanationCoveragePercent": round(yo_monolingual_total / max(1, sql_entries) * 100, 2),
        "definitionTypeBreakdown": {
            "yoruba_monolingual": def_type_counts["yoruba_monolingual"],
            "bilingual_explanation": def_type_counts["bilingual_explanation"],
            "english_gloss": def_type_counts["english_gloss"],
            "machine_generated": 0,
            "unavailable": 0,
        },
        "verificationStatusBreakdown": dict(verif_counts),
        "sourceContributionPrimaryBreakdown": {
            "lexica-curated-yo": source_counts[1],
            "kaikki-en-wikt-yo": source_counts[2],
            "wikidata-q34311": source_counts[3],
            "yowiktionary": 0,
        },
        "entriesWithExamples": with_examples_count,
        "entriesWithIpa": with_ipa_count,
        "entriesWithAudioRefs": with_audio_count,
        "entriesWithAjamiScriptVariant": with_ajami_count,
        "entriesFlaggedWithSourceConflict": sql_conflicts,
        "coreDbUncompressedBytes": core_uncomp_bytes,
        "coreDbCompressedBytes": core_comp_bytes,
        "coreCompressionRatio": round(core_comp_bytes / core_uncomp_bytes, 4),
        "extDbUncompressedBytes": ext_uncomp_bytes,
        "extDbCompressedBytes": ext_comp_bytes,
        "extCompressionRatio": round(ext_comp_bytes / ext_uncomp_bytes, 4),
        "coreSha256": core_uncomp_sha,
        "coreGzSha256": core_comp_sha,
        "extSha256": ext_uncomp_sha,
        "extGzSha256": ext_comp_sha,
        "benchmarksMs": {
            "exactHeadwordMs": round(exact_ms, 4),
            "normalizedToneFoldedMs": round(norm_ms, 4),
            "prefixLookupMs": round(prefix_ms, 4),
            "ftsDefinitionMs": round(fts_ms, 4),
        },
        "buildRuntimeSeconds": round(time.perf_counter() - t_start, 2),
        "peakBuilderRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
    }

    (out_dir / "yoruba_pack_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out_dir / "yoruba_core_audit_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("\n--- MANIFEST ---")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
