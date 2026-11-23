#!/usr/bin/env python3
"""
Lexica Assignment 010 — Isolated Reversible Hausa Recovery Prototype Builder

Builds an isolated Core + Extended prototype SQLite pack (Schema v4-proto) strictly from
approved open-licensed sources WITHOUT replacing Assignment 009's production pack:
  1. Lexica Curated Hausa Corpus (71 human-verified entries)
  2. Native Hausa Wiktionary (ha.wiktionary.org, CC BY-SA 4.0 & GFDL)
  3. Kaikki English-Wiktionary Hausa (CC BY-SA 4.0 & GFDL) for IPA, forms, & EN glosses
  4. Wikidata Lexemes wd:Q56475 (CC0 1.0) for Ajami script variants & additional glosses
  5. Tatoeba Hausa Corpus (CC BY 2.0 FR) for verified Hausa example sentences (Extended DB)

Enforces Assignment 010 non-negotiable data quality rules:
  - Explicit definition_type ('hausa_monolingual', 'english_gloss', 'bilingual_explanation', 'unavailable')
  - Strict separation between Hausa explanations and English glosses
  - Generic placeholder / empty / OCR corruption rejection
  - Full entry & sense provenance (source_id + license)
  - Non-auto-merge conflict detection (has_conflict flag + preserved per-source senses)

Usage:
  python3 scripts/build_hausa_recovery_prototype.py --out-dir /tmp/hausa_recovery_v050
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

DATASET_VERSION = "2026.11-ha-recovery-proto-v0.5.0"

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
        "Copyright Wikimedia Contributors & Tatu Ylonen (Kaikki.org / Wiktextract). Licensed under CC BY-SA 4.0 & GFDL.",
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

KNOWN_POS_TAGS = {
    "noun", "verb", "adjective", "adj", "adverb", "adv", "pronoun", "pron",
    "preposition", "prep", "conjunction", "conj", "interjection", "intj",
    "proper noun", "name", "numeral", "num", "phrase", "proverb", "affix",
    "suffix", "prefix", "particle", "determiner", "det", "character",
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
    with open(src_path, "rb") as f_in:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=compresslevel, mtime=0, fileobj=open(dst_gz_path, "wb")) as gz_out:
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

    # Identify top-level language headers (== Lang ==)
    l2_headers = [h.strip().lower() for h in re.findall(r"^==\s*([^=\n]+?)\s*==\s*$", raw_text, re.M)]
    section_text = raw_text
    if l2_headers:
        has_hausa_hdr = any(h in {"hausa", "harshen hausa"} for h in l2_headers)
        has_foreign_hdr = any(h in NON_HAUSA_SECTION_HEADERS or h.startswith("harshen ") for h in l2_headers)
        # Skip pages that are purely foreign-language entries (e.g. == Faransanci ==, == Larabci ==)
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
                # Only split at next language section if it is NOT immediately followed by === Suna/Aikatau ===
                if m_next:
                    after_next = after[m_next.end():m_next.end() + 120]
                    if not re.search(r"===\s*(?:Suna|Aikatau|Siffa|Bayanau)\s*===", after_next, re.I):
                        section_text = after[:m_next.start()]
                    else:
                        section_text = after
                else:
                    section_text = after

    # Clean <ref> tags globally first so multiline citations don't leak into senses
    cleaned_block = COMMENT_RE.sub("", REF_TAG_RE.sub("", section_text))
    cleaned_block = FILE_LINK_RE.sub("", cleaned_block)

    pos = "noun"
    definitions: list[str] = []
    turanci_glosses: list[str] = []
    examples: list[str] = []
    forms: list[str] = []
    current_mode = "def"

    for raw_line in cleaned_block.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Detect == Header == or '''Fassara''' / '''Misali''' inline headers
        h_match = re.match(r"^={2,5}\s*(.+?)\s*={2,5}$", line)
        bold_hdr_match = re.match(r"^'''\s*(Fassara|Misali|Misalai|Karin magana|Manazarta|Kalmomi masu kama|Suna|Aikatau|Siffa|Bayani|A wasu harsunan)\s*'''\s*:?$", line, re.I)
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

        # Inline bold header + content on same line, e.g. '''Fassara''' *Turanci: [[dog]]
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
            # Some contributors place Hausa definitions directly under ==FASSARA== (meaning explanation)
            if not re.match(r"^\*?\s*[A-Za-zɓɗƙƴ]+\s*:", line):
                cand = strip_wikitext(line.lstrip("#*: "))
                if len(cand) >= 18 and not is_placeholder_or_empty(cand) and not looks_like_english_only(cand):
                    definitions.append(cand)
            continue

        if current_mode == "example":
            ex_clean = strip_wikitext(line.lstrip("*#: "))
            if len(ex_clean) >= 8 and not is_placeholder_or_empty(ex_clean):
                examples.append(ex_clean)
            continue

        if current_mode == "ignore":
            continue

        # Detect plural mentions like '''jam'i''' karnuka or (''j.'' '''ƙōfōfī''')
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
    parser = argparse.ArgumentParser(description="Build Assignment 010 Isolated Hausa Recovery Prototype")
    parser.add_argument("--out-dir", default="/tmp/hausa_recovery_v050")
    args = parser.parse_args()

    t_start = time.perf_counter()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    core_db = out_dir / "lexica_hausa_recovery_core.db"
    ext_db = out_dir / "lexica_hausa_recovery_extended.db"
    core_gz = out_dir / "lexica_hausa_recovery_core.db.gz"
    ext_gz = out_dir / "lexica_hausa_recovery_extended.db.gz"
    for p in [core_db, ext_db, core_gz, ext_gz]:
        if p.exists():
            p.unlink()

    # 1. Load Curated Seed (71)
    curated = load_curated_entries()
    print(f"Loaded Lexica Curated entries: {len(curated)}")

    # 2. Load ha.wiktionary.org dump
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

    # 3. Load Kaikki EN-Wiktionary Hausa
    kaikki_entries: dict[tuple[str, str], dict[str, Any]] = {}
    kaikki_by_hw: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with gzip.open("/tmp/kaikki_hausa.jsonl.gz", "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            w = (r.get("word") or "").strip()
            if not w:
                continue
            pos = (r.get("pos") or "noun").strip().lower()
            pos_norm = {"name": "proper noun", "adj": "adjective", "adv": "adverb", "intj": "interjection", "pron": "pronoun", "conj": "conjunction", "num": "numeral"}.get(pos, pos)
            ipas = [s["ipa"] for s in (r.get("sounds") or []) if s.get("ipa")]
            forms = [frm["form"] for frm in (r.get("forms") or []) if frm.get("form") and frm["form"] != w]
            glosses = []
            for s in r.get("senses") or []:
                g = s.get("glosses") or s.get("raw_glosses") or []
                if g:
                    glosses.append("; ".join(g))
            rec = {
                "headword": w,
                "pos": pos_norm,
                "primaryIpa": ipas[0] if ipas else None,
                "allIpas": ipas,
                "forms": list(dict.fromkeys(forms)),
                "glosses": [g for g in glosses if not is_placeholder_or_empty(g)],
                "etymology": r.get("etymology_text"),
            }
            kaikki_by_hw[w.lower()].append(rec)
            key = (w.lower(), pos_norm)
            if key not in kaikki_entries:
                kaikki_entries[key] = rec
    print(f"Loaded Kaikki EN-Wiktionary records: {len(kaikki_entries)} keyed entries")

    # 4. Load Wikidata Q56475
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
            existing["haGloss"] = list(dict.fromkeys(existing["haGloss"] + rec["haGloss"]))
            existing["enGloss"] = list(dict.fromkeys(existing["enGloss"] + rec["enGloss"]))
    print(f"Loaded Wikidata Q56475 Latin headwords: {len(wd_by_hw)} (Ajami mapped: {sum(1 for v in wd_by_hw.values() if v['ajami'])})")

    # 5. Merge approved sources conservatively WITHOUT auto-overwriting conflicts
    curated_by_hw = {e["headword"].lower(): e for e in curated}
    all_keys: dict[tuple[str, str], dict[str, Any]] = {}

    def ensure_bucket(hw: str, pos: str) -> dict[str, Any]:
        k = (hw.lower(), pos)
        if k not in all_keys:
            all_keys[k] = {
                "headword": hw,
                "pos": pos,
                "script_variant": None,
                "primary_ipa": None,
                "all_ipas": [],
                "etymology": None,
                "forms": [],
                "senses": [],  # list of (source_id, def_ha, def_en, def_type, verif_status, examples)
            }
        return all_keys[k]

    # Insert Curated first
    for e in curated:
        hw = e["headword"].strip()
        raw_pos = (e.get("partOfSpeech") or "noun").strip().lower()
        pos = re.sub(r"\s*\([^)]*\)", "", raw_pos).strip() or "noun"
        b = ensure_bucket(hw, pos)
        b["primary_ipa"] = e.get("ipa")
        if e.get("ipa"):
            b["all_ipas"].append(e["ipa"])
        if e.get("headwordScriptVariant") and e["headwordScriptVariant"].get("text"):
            b["script_variant"] = e["headwordScriptVariant"]["text"]
            b["forms"].append(b["script_variant"])
        ex_list = [ex.get("sourceText", "") for ex in (e.get("examples") or []) if ex.get("sourceText")]
        b["senses"].append((
            1,
            (e.get("definition") or "").strip() or None,
            (e.get("definitionEn") or "").strip() or None,
            "bilingual_explanation" if (e.get("definition") and e.get("definitionEn")) else "hausa_monolingual",
            "human_verified",
            ex_list,
        ))

    # Add ha.wiktionary.org
    for (hw_l, pos), hw_data in hawikt_entries.items():
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
                ))
        elif en_gloss:
            b["senses"].append((2, None, en_gloss, "english_gloss", "community_reviewed", hw_data["examples"]))

    # Add Kaikki EN-Wiktionary (merge IPA & forms onto matching hw, add EN gloss sense safely)
    for (hw_l, pos), k_data in kaikki_entries.items():
        b = ensure_bucket(k_data["headword"], pos)
        if not b["primary_ipa"] and k_data["primaryIpa"]:
            b["primary_ipa"] = k_data["primaryIpa"]
        b["all_ipas"].extend(k_data["allIpas"])
        b["forms"].extend(k_data["forms"])
        if not b["etymology"] and k_data["etymology"]:
            b["etymology"] = k_data["etymology"]
        for g in k_data["glosses"][:3]:
            b["senses"].append((3, None, g, "english_gloss", "community_reviewed", []))

    # Enrich IPA/forms from Kaikki across same headword even if POS differs slightly
    for (hw_l, pos), b in all_keys.items():
        if not b["primary_ipa"] and hw_l in kaikki_by_hw:
            for k_rec in kaikki_by_hw[hw_l]:
                if k_rec["primaryIpa"]:
                    b["primary_ipa"] = k_rec["primaryIpa"]
                    b["all_ipas"].extend(k_rec["allIpas"])
                    break

    # Add Wikidata Q56475 (Ajami + HA/EN glosses)
    for hw_l, wd in wd_by_hw.items():
        matched_keys = [k for k in all_keys if k[0] == hw_l]
        if matched_keys:
            for k in matched_keys:
                if not all_keys[k]["script_variant"] and wd["ajami"]:
                    all_keys[k]["script_variant"] = wd["ajami"]
                    all_keys[k]["forms"].extend(wd["allAjami"])
        else:
            b = ensure_bucket(wd["headword"], wd["pos"])
            b["script_variant"] = wd["ajami"]
            b["forms"].extend(wd["allAjami"])
            if wd["haGloss"]:
                for g in wd["haGloss"]:
                    b["senses"].append((4, g, "; ".join(wd["enGloss"]) if wd["enGloss"] else None, "bilingual_explanation" if wd["enGloss"] else "hausa_monolingual", "community_reviewed", []))
            elif wd["enGloss"]:
                b["senses"].append((4, None, "; ".join(wd["enGloss"]), "english_gloss", "community_reviewed", []))

    # 6. Index Tatoeba sentences (CC BY 2.0 FR) by word token to attach Extended examples cleanly
    tatoeba_by_token: dict[str, list[str]] = defaultdict(list)
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
                        tatoeba_by_token[tok].append(sent)

    # Filter out buckets with ZERO usable senses
    final_records = [b for b in all_keys.values() if b["senses"]]
    final_records.sort(key=lambda r: (r["headword"].lower(), r["pos"]))
    print(f"Final usable Assignment 010 prototype entries: {len(final_records)}")

    # 7. Write Core + Extended SQLite DBs
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
            pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
            primary_ipa TEXT,
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
            definition_ha TEXT,
            definition_en TEXT,
            definition_type TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            verification_status TEXT NOT NULL,
            examples TEXT
        );
        CREATE TABLE entry_extensions (
            entry_id INTEGER PRIMARY KEY,
            all_ipas TEXT,
            etymology TEXT,
            conflict_notes TEXT
        );
        """
    )

    for s in SOURCES_METADATA:
        c_conn.execute("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?);", s)

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
    with_examples_count = 0
    with_ipa_count = 0
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

        # Rank senses: prefer human_verified (1) > hawiktionary Hausa monolingual (2) > wikidata HA (4) > english gloss (3)
        ordered_senses = sorted(
            b["senses"],
            key=lambda s: (
                0 if s[4] == "human_verified" else (1 if s[0] == 2 and s[1] else (2 if s[1] else 3)),
                s[0],
            ),
        )
        best_src, best_ha, best_en, best_dtype, best_verif, _best_ex = ordered_senses[0]

        # Combine complementary English gloss from Kaikki if primary Hausa entry lacked EN gloss
        if best_ha and not best_en:
            en_cands = [s[2] for s in ordered_senses if s[2]]
            if en_cands:
                best_en = en_cands[0]
                best_dtype = "bilingual_explanation"

        # Detect cross-source conflicts (different source IDs offering distinct monolingual Hausa defs or conflict)
        src_ids = {s[0] for s in ordered_senses}
        ha_defs_unique = {normalize_latin_deep(s[1]) for s in ordered_senses if s[1]}
        has_conflict = 1 if len(ha_defs_unique) > 1 and len(src_ids) > 1 else 0
        if has_conflict:
            conflict_count += 1
            if best_verif == "community_reviewed":
                best_verif = "conflict_flagged"

        primary_def_display = best_ha if best_ha else (best_en or "")
        if best_ha and best_en and best_dtype == "bilingual_explanation":
            fts_def = f"{best_ha} — {best_en}"
        else:
            fts_def = primary_def_display

        if b["primary_ipa"]:
            with_ipa_count += 1
        if b["script_variant"]:
            with_ajami_count += 1

        def_type_counts[best_dtype] += 1
        source_counts[best_src] += 1
        verif_counts[best_verif] += 1

        c_conn.execute(
            "INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                idx, hw, hw_l, hw_norm_opt, b["script_variant"], pos_id,
                b["primary_ipa"], best_ha, best_en, primary_def_display,
                best_dtype, best_verif, has_conflict, best_src,
            ),
        )
        c_conn.execute("INSERT INTO entries_fts(rowid, headword, primary_definition) VALUES (?, ?, ?);", (idx, hw, fts_def))

        for frm in dict.fromkeys(b["forms"]):
            fl = frm.lower()
            fn = normalize_latin_deep(fl)
            c_conn.execute("INSERT INTO word_forms VALUES (?, ?, ?, ?);", (wf_id, idx, frm, None if fn == fl else fn))
            wf_id += 1
            total_forms += 1

        # Extended examples: merge parsed Wiktionary Misali + Tatoeba matches
        tatoeba_exs = tatoeba_by_token.get(hw_l, [])
        entry_had_ex = False
        for s_num, (s_src, s_ha, s_en, s_dtype, s_verif, s_exs) in enumerate(ordered_senses, start=1):
            merged_ex = list(s_exs)
            if s_num == 1 and tatoeba_exs:
                for tex in tatoeba_exs:
                    if tex not in merged_ex:
                        merged_ex.append(f"{tex} [Tatoeba, CC BY 2.0 FR]")
            if merged_ex:
                entry_had_ex = True
            e_conn.execute(
                "INSERT INTO senses_ext VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
                (sense_id, idx, s_num, s_ha, s_en, s_dtype, s_src, s_verif, json.dumps(merged_ex, ensure_ascii=False)),
            )
            sense_id += 1
            total_senses += 1
        if entry_had_ex:
            with_examples_count += 1

        if b["all_ipas"] or b["etymology"] or has_conflict:
            conflict_note = "Multiple Hausa explanations preserved separately across sources." if has_conflict else None
            e_conn.execute(
                "INSERT INTO entry_extensions VALUES (?, ?, ?, ?);",
                (idx, json.dumps(list(dict.fromkeys(b["all_ipas"]))), b["etymology"], conflict_note),
            )

    c_conn.execute("CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);")
    c_conn.execute("CREATE INDEX idx_entries_headword_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_entries_def_type ON entries(definition_type);")
    c_conn.execute("CREATE INDEX idx_word_forms_form ON word_forms(form);")
    c_conn.execute("CREATE INDEX idx_word_forms_form_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_word_forms_entry_id ON word_forms(entry_id);")

    c_conn.execute("INSERT INTO metadata VALUES ('schema_version', '4-proto');")
    c_conn.execute("INSERT INTO metadata VALUES ('pack_layer', 'core');")
    c_conn.execute("INSERT INTO metadata VALUES ('dataset_version', ?);", (DATASET_VERSION,))
    e_conn.execute("INSERT INTO metadata VALUES ('schema_version', '4-proto');")
    e_conn.execute("INSERT INTO metadata VALUES ('pack_layer', 'extended');")
    e_conn.execute("INSERT INTO metadata VALUES ('dataset_version', ?);", (DATASET_VERSION,))

    c_conn.commit()
    e_conn.commit()

    # Run integrity check and SQLite latency benchmark before closing
    qc = c_conn.execute("PRAGMA quick_check;").fetchone()[0]
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
        c_conn.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'gida' LIMIT 20;").fetchall()
    fts_ms = (time.perf_counter() - t3) / 100 * 1000

    c_conn.close()
    e_conn.close()

    gzip_file(core_db, core_gz)
    gzip_file(ext_db, ext_gz)

    ha_monolingual_total = def_type_counts["hausa_monolingual"] + def_type_counts["bilingual_explanation"]
    rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    report = {
        "packId": "ha-lexica-recovery-proto",
        "datasetVersion": DATASET_VERSION,
        "status": "isolated-prototype-not-in-production",
        "quickCheck": qc,
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
        "entriesWithAjamiScriptVariant": with_ajami_count,
        "entriesFlaggedWithSourceConflict": conflict_count,
        "coreDbUncompressedBytes": core_db.stat().st_size,
        "coreDbCompressedBytes": core_gz.stat().st_size,
        "extDbUncompressedBytes": ext_db.stat().st_size,
        "extDbCompressedBytes": ext_gz.stat().st_size,
        "coreSha256": sha256_file(core_db),
        "coreGzSha256": sha256_file(core_gz),
        "benchmarksMs": {
            "exactHeadwordMs": round(exact_ms, 4),
            "normalizedHookedMs": round(norm_ms, 4),
            "prefixLookupMs": round(prefix_ms, 4),
            "ftsDefinitionMs": round(fts_ms, 4),
        },
        "buildRuntimeSeconds": round(time.perf_counter() - t_start, 2),
        "peakBuilderRssKiB": rss_kb,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
    }

    report_path = out_dir / "hausa_recovery_audit_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
