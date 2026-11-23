#!/usr/bin/env python3
"""
Lexica Assignment 011 — Hausa Schema v4 Core + Extended SQLite Pack Builder

Builds production Schema v4 offline Hausa Core + Extended SQLite packages
strictly from the 5 audited open-licensed sources WITHOUT modifying Assignment 009
(`scripts/build_hausa_core_pack.py`) or Assignment 008 (English):
  1. Lexica Curated Hausa Corpus (CC0 1.0 / Lexica Project License)
  2. Native Hausa Wiktionary (ha.wiktionary.org, CC BY-SA 4.0 & GFDL)
  3. Kaikki English-Wiktionary Hausa (CC BY-SA 4.0 & GFDL)
  4. Wikidata Lexemes wd:Q56475 (CC0 1.0)
  5. Tatoeba Hausa Sentence Corpus (CC BY 2.0 FR)

Zero data from Ƙamusun Hausa (CSNL/BUK) or unmodernized OCR/machine-generated text.

Usage:
  python3 scripts/build_hausa_schema_v4.py --out-dir /tmp/hausa_core_v050
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
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

PACK_VERSION_CORE = "0.5.0-core"
PACK_VERSION_EXT = "0.5.0-extended"
DATASET_VERSION = "2026.11-hausa-schema-v4-v0.5.0"
RELEASE_TAG = "prototype-ha-core-v0.5.0"
REPO_SLUG = "ahmad-maxai/lexica-dictionary-new"

SOURCES_METADATA = [
    (
        1,
        "lexica-curated",
        "Lexica Curated Hausa Corpus",
        "CC0 1.0 / Lexica Project License",
        "Curated and native-authored by the LEXICA Multilingual Lexicography Project.",
        "https://github.com/ahmad-maxai/lexica-dictionary-new",
        DATASET_VERSION,
    ),
    (
        2,
        "hawiktionary",
        "Hausa Wiktionary (ha.wiktionary.org)",
        "CC BY-SA 4.0 & GFDL",
        "Copyright Wikimedia Contributors (ha.wiktionary.org). Licensed under CC BY-SA 4.0 & GFDL.",
        "https://ha.wiktionary.org/",
        DATASET_VERSION,
    ),
    (
        3,
        "kaikki-en-wikt",
        "English Wiktionary Hausa via Kaikki.org",
        "CC BY-SA 4.0 & GFDL",
        "Copyright Wikimedia Contributors & Tatu Ylönen (Kaikki.org / Wiktextract). Licensed under CC BY-SA 4.0 & GFDL.",
        "https://kaikki.org/dictionary/Hausa/",
        DATASET_VERSION,
    ),
    (
        4,
        "wikidata-q56475",
        "Wikidata Lexemes (Hausa Q56475)",
        "CC0 1.0",
        "Public domain structured lexeme data from Wikidata contributors (CC0 1.0).",
        "https://www.wikidata.org/",
        DATASET_VERSION,
    ),
    (
        5,
        "tatoeba-hau",
        "Tatoeba Hausa Sentence Corpus",
        "CC BY 2.0 FR",
        "Example sentences contributed by Tatoeba Project contributors (CC BY 2.0 FR).",
        "https://tatoeba.org/",
        DATASET_VERSION,
    ),
]

PLACEHOLDER_PATTERNS = [
    re.compile(r"^hausa lexical entry\.?$", re.I),
    re.compile(r"^hausa entry\.?$", re.I),
    re.compile(r"^kalmar tana nufin\.?$", re.I),
    re.compile(r"^wannan kalma tana nufin\.?$", re.I),
    re.compile(r"^see\s+[a-z0-9_-]+\.?$", re.I),
]

POS_MAP_HA_TO_EN = {
    "suna": "noun",
    "aikatau": "verb",
    "siffa": "adjective",
    "bayanau": "adverb",
    "wakilin suna": "pronoun",
    "harafin gaba": "preposition",
    "mahaɗi": "conjunction",
    "mahadi": "conjunction",
    "motsin rai": "interjection",
    "sunan yanka": "proper noun",
    "lamba": "numeral",
    "kalma": "noun",
}

NON_HAUSA_SECTION_HEADERS = {
    "turanci", "larabci", "faransanci", "ispanish", "ispaniyanci", "jamusanci",
    "yarbanci", "inyamuranci", "fulatanci", "fotugal", "harshen portugal",
    "bolanci", "katafanci", "kanuri", "english", "french", "arabic",
    "german", "spanish", "yoruba", "igbo", "portuguese", "latin", "japanese",
}

WHITESPACE_RE = re.compile(r"\s+")
REF_TAG_RE = re.compile(r"<ref[^>]*>.*?</ref>|<ref[^/>]*/>|<references\s*/?>", re.S | re.I)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
FILE_LINK_RE = re.compile(r"\[\[(?:File|Image|Media|Fayil|Category|Rukuni):[^\]]*\]\]", re.I)
TEMPLATE_RE = re.compile(r"\{\{[^{}]*\}\}")
WIKILINK_PIPE_RE = re.compile(r"\[\[[^|\]]+\|([^\]]+)\]\]")
WIKILINK_PLAIN_RE = re.compile(r"\[\[([^\]]+)\]\]")
EXTLINK_RE = re.compile(r"\[https?://[^\s\]]+(?:\s+([^\]]+))?\]")
HOOKED_RE = re.compile(r"[ɓɗƙƴƁƊƘƳ]")
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
ARABIC_HARAKAT_RE = re.compile(r"[\u064B-\u065F\u0670\u0640]")

ENGLISH_MARKERS = {
    "the", "a", "an", "of", "and", "or", "in", "on", "at", "for", "with", "from",
    "to", "by", "as", "into", "substance", "liquid", "given", "name", "plural",
    "singular", "alternative", "form", "spelling", "variant", "person", "something",
}
HAUSA_MARKERS = {
    "ne", "ce", "na", "ta", "da", "ko", "mai", "masu", "wanda", "wadda", "wadanda",
    "waɗanda", "kalma", "kalmar", "abu", "abun", "wuri", "lokaci", "mutum", "mutane",
    "tana", "yana", "suna", "nufin", "kuma", "cikin", "don", "saboda", "kamar",
    "wani", "wata", "wasu", "daga", "irin", "yin", "samu", "sunan", "wacce", "abinda",
}


def normalize_arabic(text: str) -> str:
    if not text:
        return ""
    stripped = ARABIC_HARAKAT_RE.sub("", text)
    stripped = re.sub(r"[أإآٱ]", "ا", stripped)
    stripped = stripped.replace("ة", "ه").replace("ى", "ي")
    return stripped.strip()


def normalize_latin_soft(text: str) -> str:
    if not text:
        return ""
    nfd = unicodedata.normalize("NFD", text.lower())
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return re.sub(r"[’'ʽ‘`]", "", stripped).strip()


def normalize_latin_deep(text: str) -> str:
    soft = normalize_latin_soft(text)
    return (
        soft.replace("ɓ", "b")
        .replace("ɗ", "d")
        .replace("ƙ", "k")
        .replace("ƴ", "y")
        .replace("ŋ", "n")
        .replace("ɲ", "n")
    )


def strip_wikitext(raw: str) -> str:
    if not raw:
        return ""
    txt = COMMENT_RE.sub("", raw)
    txt = REF_TAG_RE.sub("", txt)
    txt = re.sub(r"<ref\b[^\n]*", "", txt, flags=re.I)
    txt = FILE_LINK_RE.sub("", txt)
    for _ in range(3):
        txt = TEMPLATE_RE.sub("", txt)
    txt = re.sub(r"\{\{[^}\n]*", "", txt)
    txt = WIKILINK_PIPE_RE.sub(r"\1", txt)
    txt = WIKILINK_PLAIN_RE.sub(r"\1", txt)
    txt = EXTLINK_RE.sub(lambda m: m.group(1) or "", txt)
    txt = txt.replace("'''", "").replace("''", "")
    txt = re.sub(r"<[^>]+>", " ", txt)
    txt = txt.replace("\u200e", "").replace("\u200f", "")
    return WHITESPACE_RE.sub(" ", txt).strip(" :;-–—•*")


def is_placeholder_or_empty(text: str | None) -> bool:
    if not text:
        return True
    t = WHITESPACE_RE.sub(" ", text).strip()
    if len(t) < 4 or not any(ch.isalnum() for ch in t):
        return True
    return any(p.match(t) for p in PLACEHOLDER_PATTERNS)


def looks_like_english_only(text: str) -> bool:
    t = WHITESPACE_RE.sub(" ", text or "").strip()
    if not t:
        return False
    if HOOKED_RE.search(t):
        return False
    tokens = [tok for tok in re.split(r"[^a-zɓɗƙƴ’']+", t.lower()) if tok]
    if not tokens:
        return False
    ha_hits = sum(1 for tok in tokens if tok in HAUSA_MARKERS)
    en_hits = sum(1 for tok in tokens if tok in ENGLISH_MARKERS)
    if re.match(r"^(to|a|an|the)\s+[a-z]{2,}\b", t.lower()) and ha_hits == 0:
        return True
    if en_hits > 0 and ha_hits == 0:
        return True
    return en_hits >= 2 and en_hits > ha_hits * 2


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
            "console.log(JSON.stringify([...VERIFIED_SEED_ENTRIES.filter(e=>e.sourceLang==='ha'),"
            "...DICTIONARY_ENTRIES.filter(e=>e.sourceLang==='ha')]));"
        ),
    ]
    out = subprocess.check_output(cmd)
    return json.loads(out.decode("utf-8"))


def parse_hawiktionary_page(title: str, raw_text: str) -> dict[str, Any] | None:
    if not raw_text or raw_text.lstrip().upper().startswith("#REDIRECT"):
        return None
    if title.startswith(("MediaWiki:", "Template:", "Category:", "Module:", "Samfuri:")):
        return None
    if ":" in title and not re.match(r"^[A-Za-zɓɗƙƴ]+:", title):
        return None

    l2_headers = [h.strip().lower() for h in re.findall(r"^==\s*([^=\n]+?)\s*==\s*$", raw_text, re.M)]
    section_text = raw_text
    if l2_headers:
        has_hausa_hdr = any(h in {"hausa", "harshen hausa"} for h in l2_headers)
        has_foreign_hdr = any(h in NON_HAUSA_SECTION_HEADERS or h.startswith("harshen ") for h in l2_headers)
        if has_foreign_hdr and not has_hausa_hdr:
            return None
        if has_hausa_hdr:
            m_ha = re.search(r"^==\s*(?:Hausa|Harshen Hausa)\s*==\s*$", raw_text, re.M | re.I)
            if m_ha:
                after = raw_text[m_ha.end():]
                m_next = re.search(
                    r"^==\s*(" + "|".join(re.escape(h) for h in NON_HAUSA_SECTION_HEADERS) + r")\s*==\s*$",
                    after,
                    re.M | re.I,
                )
                if m_next:
                    after_next = after[m_next.end():m_next.end() + 120]
                    if not re.search(r"===\s*(?:Suna|Aikatau|Siffa|Bayanau)\s*===", after_next, re.I):
                        section_text = after[:m_next.start()]
                    else:
                        section_text = after
                else:
                    section_text = after

    cleaned_block = COMMENT_RE.sub("", REF_TAG_RE.sub("", section_text))
    cleaned_block = FILE_LINK_RE.sub("", cleaned_block)

    pos = "noun"
    definitions: list[str] = []
    turanci_glosses: list[str] = []
    examples: list[dict[str, str]] = []
    forms: list[str] = []
    current_mode = "def"

    for raw_line in cleaned_block.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        h_match = re.match(r"^={2,5}\s*(.+?)\s*={2,5}$", line)
        bold_hdr_match = re.match(
            r"^'''\s*(Fassara|Misali|Misalai|Karin magana|Manazarta|Kalmomi masu kama|Suna|Aikatau|Siffa|Bayani|A wasu harsunan)\s*'''\s*:?$",
            line,
            re.I,
        )
        hdr = None
        if h_match:
            hdr = h_match.group(1).strip().lower()
        elif bold_hdr_match:
            hdr = bold_hdr_match.group(1).strip().lower()

        if hdr:
            if hdr in POS_MAP_HA_TO_EN:
                pos = POS_MAP_HA_TO_EN[hdr]
                current_mode = "def"
            elif "wasu harsun" in hdr or "fassara" in hdr or hdr == "translations":
                current_mode = "fassara"
            elif "misal" in hdr or "karin magana" in hdr:
                current_mode = "example"
            elif "manazarta" in hdr or "nasaba" in hdr or "haɗi" in hdr:
                current_mode = "ignore"
            elif hdr == "turanci":
                current_mode = "turanci_direct"
            else:
                current_mode = "def"
            continue

        if re.match(r"^'''\s*Fassara\s*'''", line, re.I):
            current_mode = "fassara"
            line = re.sub(r"^'''\s*Fassara\s*'''\s*:?", "", line, flags=re.I).strip()
            if not line:
                continue

        if current_mode == "turanci_direct":
            if not line.startswith(("=", "*", "#")) and len(line) < 60:
                en_clean = strip_wikitext(line)
                if not is_placeholder_or_empty(en_clean):
                    turanci_glosses.append(en_clean)
                continue

        if current_mode == "fassara" or re.match(r"^\*?\s*Turanci\s*:", line, re.I):
            m_en = re.match(r"^\*?\s*Turanci\s*:\s*(.+)$", line, re.I)
            if m_en:
                en_clean = strip_wikitext(m_en.group(1))
                if not is_placeholder_or_empty(en_clean):
                    turanci_glosses.append(en_clean)
                continue
            if not re.match(r"^\*?\s*[A-Za-zɓɗƙƴ]+\s*:", line):
                cand = strip_wikitext(line.lstrip("#*: "))
                if len(cand) >= 18 and not is_placeholder_or_empty(cand) and not looks_like_english_only(cand):
                    definitions.append(cand)
            continue

        if current_mode == "example":
            ex_clean = strip_wikitext(line.lstrip("*#: "))
            if len(ex_clean) >= 8 and not is_placeholder_or_empty(ex_clean):
                examples.append({"sourceText": ex_clean, "targetText": "", "attribution": "ha.wiktionary.org (CC BY-SA 4.0)"})
            continue

        if current_mode == "ignore":
            continue

        for pm in re.findall(r"(?:jam'i|j\.|jam’i)\s*'''\s*([^']+)\s*'''|'''jam'i'''\s+([A-Za-zɓɗƙƴƁƊƘƳāēīōūĀĒĪŌŪ'-]+)", line, re.I):
            form_cand = (pm[0] or pm[1] or "").strip(" .,;:")
            if form_cand and form_cand.lower() != title.lower():
                forms.append(form_cand)

        clean_line = strip_wikitext(line.lstrip("#*: "))
        if not clean_line or is_placeholder_or_empty(clean_line):
            continue
        if len(clean_line) < 10:
            continue
        if clean_line.lower() == title.lower():
            continue
        if looks_like_english_only(clean_line):
            turanci_glosses.append(clean_line)
            continue
        definitions.append(clean_line)

    if not definitions and not turanci_glosses:
        return None

    return {
        "headword": title,
        "pos": pos,
        "definitionsHa": definitions[:4],
        "definitionEn": "; ".join(dict.fromkeys(turanci_glosses)) if turanci_glosses else None,
        "examples": examples[:4],
        "forms": list(dict.fromkeys(forms)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build LEXICA Assignment 011 Schema v4 Hausa Core + Extended Packs")
    parser.add_argument("--out-dir", default="/tmp/hausa_core_v050")
    args = parser.parse_args()

    t_start = time.perf_counter()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    core_db = out_dir / "lexica_hausa_core.db"
    ext_db = out_dir / "lexica_hausa_extended.db"
    core_gz = out_dir / "lexica_hausa_core.db.gz"
    ext_gz = out_dir / "lexica_hausa_extended.db.gz"
    for p in [core_db, ext_db, core_gz, ext_gz]:
        if p.exists():
            p.unlink()

    # 1. Load Lexica Curated Seed (71 entries)
    curated = load_curated_entries()
    print(f"Loaded Lexica Curated entries: {len(curated)}")

    # 2. Load ha.wiktionary.org dump (CC BY-SA 4.0 & GFDL)
    hawikt_entries: dict[tuple[str, str], dict[str, Any]] = {}
    hawikt_xml = Path("/tmp/audit_sources/hawikt/hawiktionary-latest-pages-articles.xml.bz2")
    ns = {"mw": "http://www.mediawiki.org/xml/export-0.11/"}
    with bz2.open(hawikt_xml, "rt", encoding="utf-8") as f:
        for _ev, elem in ET.iterparse(f, events=("end",)):
            if elem.tag.endswith("page"):
                ns_el = elem.find("./mw:ns", ns)
                if ns_el is not None and ns_el.text == "0":
                    title = (elem.find("./mw:title", ns).text or "").strip()
                    rev_el = elem.find("./mw:revision/mw:text", ns)
                    raw_text = rev_el.text if rev_el is not None and rev_el.text else ""
                    parsed = parse_hawiktionary_page(title, raw_text)
                    if parsed:
                        key = (parsed["headword"].lower(), parsed["pos"])
                        if key not in hawikt_entries:
                            hawikt_entries[key] = parsed
                elem.clear()
    print(f"Parsed clean ha.wiktionary.org entries: {len(hawikt_entries)}")

    # 3. Load Kaikki EN-Wiktionary Hausa (CC BY-SA 4.0 & GFDL)
    kaikki_entries: dict[tuple[str, str], dict[str, Any]] = {}
    kaikki_by_hw: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with gzip.open("/tmp/kaikki_hausa.jsonl.gz", "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            w = (r.get("word") or "").strip()
            if not w:
                continue
            pos = (r.get("pos") or "noun").strip().lower()
            pos_norm = {
                "name": "proper noun",
                "adj": "adjective",
                "adv": "adverb",
                "intj": "interjection",
                "pron": "pronoun",
                "conj": "conjunction",
                "num": "numeral",
            }.get(pos, pos)

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

            forms = [frm["form"] for frm in (r.get("forms") or []) if frm.get("form") and frm["form"] != w]
            glosses = []
            synonyms = []
            antonyms = []
            examples = []
            for s in r.get("senses") or []:
                g = s.get("glosses") or s.get("raw_glosses") or []
                if g:
                    gloss_txt = "; ".join(g)
                    if not is_placeholder_or_empty(gloss_txt):
                        glosses.append(gloss_txt)
                for syn in s.get("synonyms") or []:
                    if isinstance(syn, dict) and syn.get("word"):
                        synonyms.append(syn["word"])
                for ant in s.get("antonyms") or []:
                    if isinstance(ant, dict) and ant.get("word"):
                        antonyms.append(ant["word"])
                for ex in s.get("examples") or []:
                    if isinstance(ex, dict) and ex.get("text") and len(ex["text"]) <= 180:
                        examples.append({
                            "sourceText": ex["text"],
                            "targetText": ex.get("english") or "",
                            "attribution": ex.get("ref") or "Kaikki EN-Wiktionary (CC BY-SA 4.0)",
                        })

            rec = {
                "headword": w,
                "pos": pos_norm,
                "primaryIpa": ipas[0]["ipa"] if ipas else None,
                "allIpas": ipas,
                "audioRefs": audio_refs,
                "dialect": dialect_note,
                "forms": list(dict.fromkeys(forms)),
                "glosses": glosses,
                "synonyms": list(dict.fromkeys(synonyms))[:8],
                "antonyms": list(dict.fromkeys(antonyms))[:6],
                "examples": examples[:3],
                "etymology": r.get("etymology_text"),
            }
            kaikki_by_hw[w.lower()].append(rec)
            key = (w.lower(), pos_norm)
            if key not in kaikki_entries:
                kaikki_entries[key] = rec
    print(f"Loaded Kaikki EN-Wiktionary records: {len(kaikki_entries)} keyed entries")

    # 4. Load Wikidata Q56475 (CC0 1.0)
    wd_by_hw: dict[str, dict[str, Any]] = {}
    wd_json = json.loads(Path("/tmp/audit_sources/wikidata/wikidata_ha_lexemes.json").read_text(encoding="utf-8"))
    by_lexeme: dict[str, dict[str, Any]] = defaultdict(lambda: {"latin": [], "ajami": [], "pos": "noun", "haGloss": [], "enGloss": []})
    for b in wd_json.get("results", {}).get("bindings", []):
        lid = b.get("lexeme", {}).get("value", "")
        if not lid:
            continue
        rec = by_lexeme[lid]
        lemma = (b.get("lemma", {}).get("value") or "").strip()
        llang = b.get("lemmaLang", {}).get("value", "")
        if lemma:
            if ARABIC_RE.search(lemma) or llang == "ha-arab":
                if lemma not in rec["ajami"]:
                    rec["ajami"].append(lemma)
            else:
                if lemma not in rec["latin"]:
                    rec["latin"].append(lemma)
        cat = (b.get("catLabel", {}).get("value") or "").strip().lower()
        if cat:
            rec["pos"] = cat
        gloss = (b.get("gloss", {}).get("value") or "").strip()
        glang = b.get("glossLang", {}).get("value", "")
        if gloss and not is_placeholder_or_empty(gloss):
            if glang == "ha" and gloss not in rec["haGloss"] and not looks_like_english_only(gloss):
                rec["haGloss"].append(gloss)
            elif glang == "en" and gloss not in rec["enGloss"]:
                rec["enGloss"].append(gloss)

    for _lid, rec in by_lexeme.items():
        if not rec["latin"]:
            continue
        hw = rec["latin"][0]
        key = hw.lower()
        existing = wd_by_hw.get(key)
        if not existing:
            wd_by_hw[key] = {
                "headword": hw,
                "pos": rec["pos"],
                "ajami": rec["ajami"][0] if rec["ajami"] else None,
                "allAjami": rec["ajami"],
                "haGloss": rec["haGloss"],
                "enGloss": rec["enGloss"],
            }
        else:
            if not existing["ajami"] and rec["ajami"]:
                existing["ajami"] = rec["ajami"][0]
            existing["allAjami"] = list(dict.fromkeys(existing["allAjami"] + rec["ajami"]))
            existing["haGloss"] = list(dict.fromkeys(existing["haGloss"] + rec["haGloss"]))
            existing["enGloss"] = list(dict.fromkeys(existing["enGloss"] + rec["enGloss"]))
    print(f"Loaded Wikidata Q56475 Latin headwords: {len(wd_by_hw)}")

    # 5. Merge approved sources conservatively WITHOUT silently overwriting conflicts
    all_keys: dict[tuple[str, str], dict[str, Any]] = {}

    def ensure_bucket(hw: str, pos: str) -> dict[str, Any]:
        k = (hw.lower(), pos)
        if k not in all_keys:
            all_keys[k] = {
                "headword": hw,
                "pos": pos,
                "script_variant": None,
                "all_ajami": [],
                "primary_ipa": None,
                "all_ipas": [],
                "audio_refs": [],
                "dialect": None,
                "etymology": None,
                "forms": [],
                "synonyms": [],
                "antonyms": [],
                "senses": [],  # (source_id, def_ha, def_en, def_type, verif_status, examples, synonyms, antonyms)
            }
        return all_keys[k]

    for e in curated:
        hw = e["headword"].strip()
        raw_pos = (e.get("partOfSpeech") or "noun").strip().lower()
        pos = re.sub(r"\s*\([^)]*\)", "", raw_pos).strip() or "noun"
        b = ensure_bucket(hw, pos)
        b["primary_ipa"] = e.get("ipa")
        if e.get("dialect"):
            b["dialect"] = e["dialect"]
        if e.get("etymology"):
            b["etymology"] = e["etymology"]
        if e.get("ipa"):
            b["all_ipas"].append({"ipa": e["ipa"], "tags": [b["dialect"]] if b["dialect"] else []})
        if e.get("headwordScriptVariant") and e["headwordScriptVariant"].get("text"):
            sv = e["headwordScriptVariant"]["text"]
            b["script_variant"] = sv
            b["all_ajami"].append(sv)
            b["forms"].append(sv)
        for mf in e.get("morphologicalForms") or []:
            if mf.get("form"):
                b["forms"].append(mf["form"])
        b["synonyms"].extend(e.get("synonyms") or [])
        b["antonyms"].extend(e.get("antonyms") or [])
        ex_list = [
            {
                "sourceText": ex.get("sourceText", ""),
                "targetText": ex.get("targetText", ""),
                "attribution": "Lexica Curated Corpus",
            }
            for ex in (e.get("examples") or [])
            if ex.get("sourceText")
        ]
        b["senses"].append((
            1,
            (e.get("definition") or "").strip() or None,
            (e.get("definitionEn") or "").strip() or None,
            "bilingual_explanation" if (e.get("definition") and e.get("definitionEn")) else "hausa_monolingual",
            "human_verified",
            ex_list,
            list(e.get("synonyms") or []),
            list(e.get("antonyms") or []),
        ))

    for (_hw_l, pos), hw_data in hawikt_entries.items():
        b = ensure_bucket(hw_data["headword"], pos)
        b["forms"].extend(hw_data["forms"])
        ha_defs = hw_data["definitionsHa"]
        en_gloss = hw_data["definitionEn"]
        if ha_defs:
            for idx_d, d_ha in enumerate(ha_defs):
                dtype = "bilingual_explanation" if (idx_d == 0 and en_gloss) else "hausa_monolingual"
                b["senses"].append((
                    2,
                    d_ha,
                    en_gloss if idx_d == 0 else None,
                    dtype,
                    "community_reviewed",
                    hw_data["examples"] if idx_d == 0 else [],
                    [],
                    [],
                ))
        elif en_gloss:
            b["senses"].append((2, None, en_gloss, "english_gloss", "community_reviewed", hw_data["examples"], [], []))

    for (_hw_l, pos), k_data in kaikki_entries.items():
        b = ensure_bucket(k_data["headword"], pos)
        if not b["primary_ipa"] and k_data["primaryIpa"]:
            b["primary_ipa"] = k_data["primaryIpa"]
        b["all_ipas"].extend(k_data["allIpas"])
        b["audio_refs"].extend(k_data["audioRefs"])
        if not b["dialect"] and k_data["dialect"]:
            b["dialect"] = k_data["dialect"]
        b["forms"].extend(k_data["forms"])
        b["synonyms"].extend(k_data["synonyms"])
        b["antonyms"].extend(k_data["antonyms"])
        if not b["etymology"] and k_data["etymology"]:
            b["etymology"] = k_data["etymology"]
        for idx_g, g in enumerate(k_data["glosses"][:3]):
            b["senses"].append((
                3,
                None,
                g,
                "english_gloss",
                "community_reviewed",
                k_data["examples"] if idx_g == 0 else [],
                k_data["synonyms"] if idx_g == 0 else [],
                k_data["antonyms"] if idx_g == 0 else [],
            ))

    # Cross-POS IPA & audio enrichment from Kaikki
    for (hw_l, _pos), b in all_keys.items():
        if hw_l in kaikki_by_hw:
            for k_rec in kaikki_by_hw[hw_l]:
                if not b["primary_ipa"] and k_rec["primaryIpa"]:
                    b["primary_ipa"] = k_rec["primaryIpa"]
                    b["all_ipas"].extend(k_rec["allIpas"])
                if not b["audio_refs"] and k_rec["audioRefs"]:
                    b["audio_refs"].extend(k_rec["audioRefs"])

    # Wikidata Q56475 Ajami + HA/EN glosses
    for hw_l, wd in wd_by_hw.items():
        matched_keys = [k for k in all_keys if k[0] == hw_l]
        if matched_keys:
            for k in matched_keys:
                if not all_keys[k]["script_variant"] and wd["ajami"]:
                    all_keys[k]["script_variant"] = wd["ajami"]
                all_keys[k]["all_ajami"].extend(wd["allAjami"])
                all_keys[k]["forms"].extend(wd["allAjami"])
        else:
            b = ensure_bucket(wd["headword"], wd["pos"])
            b["script_variant"] = wd["ajami"]
            b["all_ajami"].extend(wd["allAjami"])
            b["forms"].extend(wd["allAjami"])
            if wd["haGloss"]:
                for g in wd["haGloss"]:
                    b["senses"].append((
                        4,
                        g,
                        "; ".join(wd["enGloss"]) if wd["enGloss"] else None,
                        "bilingual_explanation" if wd["enGloss"] else "hausa_monolingual",
                        "community_reviewed",
                        [],
                        [],
                        [],
                    ))
            elif wd["enGloss"]:
                b["senses"].append((4, None, "; ".join(wd["enGloss"]), "english_gloss", "community_reviewed", [], [], []))

    # 6. Attach Tatoeba Hausa Corpus sentences (CC BY 2.0 FR)
    tatoeba_by_token: dict[str, list[dict[str, str]]] = defaultdict(list)
    valid_hw_tokens = {hw_l for (hw_l, _p) in all_keys if len(hw_l) >= 3 and " " not in hw_l}
    tatoeba_path = Path("/tmp/audit_sources/tatoeba/hau_sentences.tsv.bz2")
    if tatoeba_path.exists():
        with bz2.open(tatoeba_path, "rt", encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                sent = WHITESPACE_RE.sub(" ", parts[2]).strip()
                if len(sent) < 12 or len(sent) > 140:
                    continue
                toks = set(re.findall(r"[a-zɓɗƙƴ’']+", sent.lower()))
                for tok in toks & valid_hw_tokens:
                    if len(tatoeba_by_token[tok]) < 2:
                        tatoeba_by_token[tok].append({
                            "sourceText": sent,
                            "targetText": "",
                            "attribution": "Tatoeba Project (CC BY 2.0 FR)",
                        })

    final_records = [b for b in all_keys.values() if b["senses"]]
    final_records.sort(key=lambda r: (r["headword"].lower(), r["pos"]))
    print(f"Final Schema v4 Hausa Core entries: {len(final_records)}")

    # 7. Create Schema v4 Core + Extended SQLite Databases
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
            definition_ha TEXT,
            definition_en TEXT,
            primary_definition TEXT NOT NULL,
            definition_type TEXT NOT NULL CHECK(definition_type IN ('hausa_monolingual','english_gloss','bilingual_explanation','machine_generated','unavailable')),
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
            definition_ha,
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
            definition_ha TEXT,
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

    for idx, b in enumerate(final_records, start=1):
        hw = b["headword"]
        hw_l = hw.lower()
        distinct_hw.add(hw_l)
        hw_norm = normalize_latin_deep(hw_l)
        hw_norm_opt = None if hw_norm == hw_l else hw_norm
        pos_id = get_pos_id(b["pos"])

        ordered_senses = sorted(
            b["senses"],
            key=lambda s: (
                0 if s[4] == "human_verified" else (1 if s[0] == 2 and s[1] else (2 if s[1] else 3)),
                s[0],
            ),
        )
        best_src, best_ha, best_en, best_dtype, best_verif, _best_ex, _best_syn, _best_ant = ordered_senses[0]

        if best_ha and not best_en:
            en_cands = [s[2] for s in ordered_senses if s[2]]
            if en_cands:
                best_en = en_cands[0]
                best_dtype = "bilingual_explanation"

        # Detect cross-source disagreement without auto-overwriting
        src_ids = {s[0] for s in ordered_senses}
        ha_defs_unique = {normalize_latin_deep(s[1]) for s in ordered_senses if s[1]}
        has_conflict = 1 if len(ha_defs_unique) > 1 and len(src_ids) > 1 else 0
        if has_conflict:
            conflict_count += 1
            if best_verif == "community_reviewed":
                best_verif = "conflict_flagged"

        primary_def_display = best_ha if best_ha else (best_en or "")
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
                b["primary_ipa"], audio_file, b["dialect"], best_ha, best_en, primary_def_display,
                best_dtype, best_verif, has_conflict, best_src,
            ),
        )
        c_conn.execute(
            "INSERT INTO entries_fts(rowid, headword, definition_ha, definition_en, primary_definition) VALUES (?, ?, ?, ?, ?);",
            (idx, hw, best_ha or "", best_en or "", primary_def_display),
        )

        forms_to_insert: list[str] = list(dict.fromkeys(b["forms"]))
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
        for s_num, (s_src, s_ha, s_en, s_dtype, s_verif, s_exs, s_syns, s_ants) in enumerate(ordered_senses, start=1):
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
                    s_ha,
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

        # Deduplicate IPAs preserving order
        seen_ipa = set()
        dedup_ipas = []
        for item in b["all_ipas"]:
            key_i = (item["ipa"], tuple(item.get("tags") or []))
            if key_i not in seen_ipa:
                seen_ipa.add(key_i)
                dedup_ipas.append(item)

        if dedup_ipas or b["etymology"] or b["audio_refs"] or has_conflict:
            conflict_note = "Cross-source Hausa definitions preserved separately for native linguist review." if has_conflict else None
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
            for s_src, s_ha, s_en, s_dtype, s_verif, _s_ex, _s_syn, _s_ant in ordered_senses:
                if s_ha:
                    src_meta = source_lookup.get(s_src, {"code": "unknown", "name": "Unknown", "license": ""})
                    conflict_versions.append({
                        "sourceCode": src_meta["code"],
                        "sourceName": src_meta["name"],
                        "license": src_meta["license"],
                        "definitionHa": s_ha,
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
                    "Distinct Hausa explanations supplied across independent open sources.",
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

    ha_monolingual_total = def_type_counts["hausa_monolingual"] + def_type_counts["bilingual_explanation"]

    core_meta = [
        ("schema_version", "4"),
        ("pack_layer", "core"),
        ("pack_version", PACK_VERSION_CORE),
        ("dataset_version", DATASET_VERSION),
        ("accepted_entries", str(len(final_records))),
        ("distinct_headwords", str(len(distinct_hw))),
        ("total_senses", str(total_senses)),
        ("core_primary_senses", str(len(final_records))),
        ("total_word_forms", str(total_forms)),
        ("hausa_monolingual_count", str(def_type_counts["hausa_monolingual"])),
        ("bilingual_count", str(def_type_counts["bilingual_explanation"])),
        ("english_gloss_count", str(def_type_counts["english_gloss"])),
        ("conflict_count", str(conflict_count)),
    ]
    for k, v in core_meta:
        c_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    ext_meta = [
        ("schema_version", "4"),
        ("pack_layer", "extended"),
        ("pack_version", PACK_VERSION_EXT),
        ("dataset_version", DATASET_VERSION),
        ("total_senses", str(total_senses)),
        ("conflict_count", str(conflict_count)),
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
        c_conn.execute("SELECT id FROM entries WHERE headword_lower = 'ruwa';").fetchall()
    exact_ms = (time.perf_counter() - t0) / 100 * 1000

    t1 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_norm = 'kofa' OR headword_lower = 'kofa';").fetchall()
    norm_ms = (time.perf_counter() - t1) / 100 * 1000

    t2 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_lower >= 'bar' AND headword_lower < 'bas' LIMIT 20;").fetchall()
    prefix_ms = (time.perf_counter() - t2) / 100 * 1000

    t3 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'water' LIMIT 20;").fetchall()
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
        "packId": "ha-lexica-schema-v4",
        "targetLanguage": "ha",
        "format": "sqlite-gzip",
        "packLayer": "core",
        "schemaVersion": 4,
        "packVersion": PACK_VERSION_CORE,
        "datasetVersion": DATASET_VERSION,
        "releaseTag": RELEASE_TAG,
        "downloadUrl": f"https://github.com/{REPO_SLUG}/releases/download/{RELEASE_TAG}/lexica_hausa_core.db.gz",
        "compressedSizeBytes": core_comp_bytes,
        "compressedSha256": core_comp_sha,
        "uncompressedSizeBytes": core_uncomp_bytes,
        "uncompressedSha256": core_uncomp_sha,
        "acceptedEntries": len(final_records),
        "distinctHeadwords": len(distinct_hw),
        "totalSenses": total_senses,
        "corePrimarySenses": len(final_records),
        "totalWordForms": total_forms,
        "extendedCompanion": {
            "packId": "ha-lexica-schema-v4-extended",
            "packLayer": "extended",
            "schemaVersion": 4,
            "packVersion": PACK_VERSION_EXT,
            "optional": True,
            "autoDownload": False,
            "compressedSizeBytes": ext_comp_bytes,
            "compressedSha256": ext_comp_sha,
            "uncompressedSizeBytes": ext_uncomp_bytes,
            "uncompressedSha256": ext_uncomp_sha,
            "downloadUrl": f"https://github.com/{REPO_SLUG}/releases/download/{RELEASE_TAG}/lexica_hausa_extended.db.gz",
        },
        "attribution": {
            "sourceName": "Hausa Wiktionary, Kaikki EN-Wiktionary, Wikidata Q56475, Tatoeba & Lexica Curated Corpus",
            "license": "CC BY-SA 4.0 & GFDL; CC0 1.0; CC BY 2.0 FR",
            "attributionText": "Open-licensed Hausa lexicography compiled from Hausa Wiktionary (ha.wiktionary.org), English Wiktionary via Kaikki.org (CC BY-SA 4.0 & GFDL), Wikidata Q56475 (CC0 1.0), Tatoeba (CC BY 2.0 FR), and Lexica Curated Corpus.",
            "sourceUrl": "https://ha.wiktionary.org/",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        },
    }

    report = {
        "packId": "ha-lexica-schema-v4",
        "datasetVersion": DATASET_VERSION,
        "schemaVersion": 4,
        "quickCheckCore": qc_core,
        "quickCheckExtended": qc_ext,
        "totalEntries": len(final_records),
        "distinctHeadwords": len(distinct_hw),
        "totalSenses": total_senses,
        "wordFormsPreserved": total_forms,
        "entriesWithHausaMonolingualExplanation": ha_monolingual_total,
        "hausaMonolingualCoveragePercent": round(ha_monolingual_total / len(final_records) * 100, 2),
        "definitionTypeBreakdown": {
            "hausa_monolingual": def_type_counts["hausa_monolingual"],
            "bilingual_explanation": def_type_counts["bilingual_explanation"],
            "english_gloss": def_type_counts["english_gloss"],
            "machine_generated": 0,
            "unavailable": 0,
        },
        "verificationStatusBreakdown": dict(verif_counts),
        "sourceContributionPrimaryBreakdown": {
            "lexica-curated": source_counts[1],
            "hawiktionary": source_counts[2],
            "kaikki-en-wikt": source_counts[3],
            "wikidata-q56475": source_counts[4],
        },
        "entriesWithExamples": with_examples_count,
        "entriesWithIpa": with_ipa_count,
        "entriesWithAudioRefs": with_audio_count,
        "entriesWithAjamiScriptVariant": with_ajami_count,
        "entriesFlaggedWithSourceConflict": conflict_count,
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
            "normalizedHookedMs": round(norm_ms, 4),
            "prefixLookupMs": round(prefix_ms, 4),
            "ftsDefinitionMs": round(fts_ms, 4),
        },
        "buildRuntimeSeconds": round(time.perf_counter() - t_start, 2),
        "peakBuilderRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
    }

    (out_dir / "hausa_pack_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / "hausa_core_audit_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("\n--- MANIFEST ---")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
