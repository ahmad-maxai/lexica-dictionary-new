#!/usr/bin/env python3
"""
LEXICA — Assignment 015: Isolated Fulfulde Schema v4 Core + Extended Prototype Builder

ISOLATED RESEARCH PROTOTYPE ONLY (does NOT modify production app UI, configs, or packs).
Ingests audited open-licensed Fulfulde sources:
  1. Lexica Curated Fulfulde Starter Corpus (CC0 1.0 / Lexica Project License)
  2. English Wiktionary Fula via Kaikki.org (CC BY-SA 4.0 & GFDL)
  3. Wikidata Lexemes Fula wd:Q33454 (CC0 1.0)
  4. Tatoeba Pulaar Sentence Corpus (CC BY 2.0 FR / CC BY 4.0)
  5. Wikimedia Fula Wiktionary / Incubator audit record (0 entries imported)

Linguistic & Orthographic Guarantees:
  - Primary Orthographic Standard: UNESCO Bamako (1966) & Nigerian NERDC Fulfulde Latin
    alphabet (ɓ, ɗ, ƴ, ŋ, ɲ, prenasalized mb/nd/ng/nj, doubled vowel length aa/ee/ii/oo/uu).
  - Preserves regional & orthographic variants (Adamawa/Nigerian, Pulaar, Pular, Maasina,
    plus Adlam script variants where present) as labelled forms rather than silent merges.
  - Detects and flags Wikidata non-standard Czech d-caron/stroke artifacts (ď/đ -> ɗ) and
    cross-source disagreements in ext.conflict_reviews.
  - Separates fulfulde_monolingual, bilingual_explanation, and english_gloss cleanly.
  - Emits isolated Core + Extended SQLite Schema v4 databases, GZIP archives, SHA-256
    checksums, PRAGMA quick_check, and JSON feasibility report.

Usage:
  python3 scripts/build_fulfulde_prototype_v4.py --out-dir /tmp/fulfulde_prototype_v4
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sqlite3
import subprocess
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

PACK_VERSION_CORE = "0.1.0-proto-core"
PACK_VERSION_EXT = "0.1.0-proto-extended"
DATASET_VERSION = "2026.11-fulfulde-audit-proto-v4"

SOURCES_METADATA = [
    (
        1,
        "lexica-curated-ff",
        "Lexica Curated Fulfulde Starter Corpus",
        "CC0 1.0 / Lexica Project License",
        "Curated starter corpus authored for the LEXICA Multilingual Lexicography Project.",
        "https://github.com/ahmad-maxai/lexica-dictionary-new",
        DATASET_VERSION,
    ),
    (
        2,
        "kaikki-en-wikt-ff",
        "English Wiktionary Fula via Kaikki.org",
        "CC BY-SA 4.0 & GFDL",
        "Copyright Wikimedia Contributors & Tatu Ylönen (Kaikki.org / Wiktextract). Licensed under CC BY-SA 4.0 & GFDL.",
        "https://kaikki.org/dictionary/Fula/",
        DATASET_VERSION,
    ),
    (
        3,
        "wikidata-q33454",
        "Wikidata Lexemes (Fula Q33454)",
        "CC0 1.0",
        "Public domain structured lexeme data from Wikidata contributors (CC0 1.0).",
        "https://www.wikidata.org/wiki/Wikidata:Lexicographical_data",
        DATASET_VERSION,
    ),
    (
        4,
        "tatoeba-fuc",
        "Tatoeba Pulaar Sentence Corpus (fuc)",
        "CC BY 2.0 FR / CC BY 4.0",
        "Pulaar example sentences contributed by Tatoeba Project contributors (CC BY 2.0 FR).",
        "https://tatoeba.org/",
        DATASET_VERSION,
    ),
    (
        5,
        "ff-wiktionary-incubator",
        "Fula Wiktionary & Wikimedia Incubator Audit",
        "CC BY-SA 4.0 & GFDL",
        "ff.wiktionary.org is closed/non-existent; Incubator Wt/fuf holds 3 pages (0 Nigerian Fulfulde); 0 entries imported.",
        "https://incubator.wikimedia.org/wiki/Wt/fuf",
        DATASET_VERSION,
    ),
]

PLACEHOLDER_PATTERNS = [
    re.compile(r"^fulfulde lexical entry\.?$", re.I),
    re.compile(r"^fulfulde entry\.?$", re.I),
    re.compile(r"^fula entry\.?$", re.I),
    re.compile(r"^definition needed\.?$", re.I),
    re.compile(r"^n/?a\.?$", re.I),
    re.compile(r"^tbd\.?$", re.I),
    re.compile(r"^todo\.?$", re.I),
    re.compile(r"^(the|a|an|of|to|in|same as)$", re.I),
    re.compile(r"^(see|cf\.|alt\.)\s+.+$", re.I),
]

WHITESPACE_RE = re.compile(r"\s+")
ADLAM_RE = re.compile(r"[\U0001E900-\U0001E95F]")
FULFULDE_SPECIAL_RE = re.compile(r"[ɓɗƴŋɲñƁƊƳŊƝÑ]")
NON_STD_D_RE = re.compile(r"[ďđĎĐ]")

FULFULDE_MARKERS = {
    "ko", "nde", "nder", "e", "mo", "be", "ɓe", "ngol", "ngal", "ngel",
    "kal", "dam", "ɗam", "dum", "ɗum", "hono", "walla", "ngam", "gila",
    "dow", "les", "yeeso", "caggal", "neɗɗo", "neddo", "huunde", "hunde",
    "konngol", "firti", "waɗi", "wadi", "wonande", "fof", "fuu", "kala",
    "maa", "mum", "mun", "pulaaku",
}

ENGLISH_MARKERS = {
    "the", "a", "an", "of", "and", "or", "in", "on", "at", "for", "with",
    "from", "to", "by", "as", "into", "is", "are", "was", "were", "used",
    "kind", "type", "person", "something", "anything", "which", "that",
    "who", "plural", "singular", "abbreviation", "abriviation", "variant",
    "alternative", "mind", "intelligence", "caution", "prudence",
}


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def normalize_fulfulde_exact(text: str) -> str:
    return nfc(text).strip().lower()


def normalize_fulfulde_flexible(text: str) -> str:
    """Fold hooked letters, regional variants, and ď/đ artifacts to ASCII search keys."""
    if not text:
        return ""
    s = nfc(text).strip().lower()
    s = (
        s.replace("ɓ", "b")
        .replace("ɗ", "d")
        .replace("ď", "d")
        .replace("đ", "d")
        .replace("ƴ", "y")
        .replace("ŋ", "n")
        .replace("ɲ", "ny")
        .replace("ñ", "ny")
    )
    nfd = unicodedata.normalize("NFD", s)
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return re.sub(r"[’'ʼ‘`]", "", stripped).strip()


def canonicalize_bamako_nerdc(text: str) -> str:
    """Convert non-standard ď/đ substitution artifacts to canonical implosive ɗ."""
    return nfc(text).replace("ď", "ɗ").replace("Ď", "Ɗ").replace("đ", "ɗ").replace("Đ", "Ɗ")


def is_placeholder_or_empty(text: str | None) -> bool:
    if not text:
        return True
    t = WHITESPACE_RE.sub(" ", text).strip()
    if len(t) < 2 or not any(ch.isalnum() for ch in t):
        return True
    return any(p.match(t) for p in PLACEHOLDER_PATTERNS)


def looks_like_english_only(text: str | None) -> bool:
    t = WHITESPACE_RE.sub(" ", text or "").strip()
    if not t:
        return False
    if FULFULDE_SPECIAL_RE.search(t):
        return False
    tokens = [tok for tok in re.split(r"[^a-zA-Zɓɗƴŋɲñ’']+", t.lower()) if tok]
    if not tokens:
        return False
    ff_hits = sum(1 for tok in tokens if tok in FULFULDE_MARKERS)
    en_hits = sum(1 for tok in tokens if tok in ENGLISH_MARKERS)
    if re.match(r"^(to|a|an|the|used|one who|he who|she who|plural of)\s+[a-z]{2,}\b", t.lower()) and ff_hits == 0:
        return True
    if en_hits > 0 and ff_hits == 0:
        return True
    return len(tokens) >= 3 and ff_hits == 0 and bool(re.match(r"^[a-z\s,;().'/-]+$", t, re.I))


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


def load_curated_ff_entries() -> list[dict[str, Any]]:
    cmd = [
        "npx", "tsx", "-e",
        (
            "import { VERIFIED_SEED_ENTRIES } from './src/data/seedDictionary';"
            "import { DICTIONARY_ENTRIES } from './src/data/dictionaryData';"
            "console.log(JSON.stringify([...VERIFIED_SEED_ENTRIES.filter(e=>e.sourceLang==='ff'),"
            "...DICTIONARY_ENTRIES.filter(e=>e.sourceLang==='ff')]));"
        ),
    ]
    out = subprocess.check_output(cmd)
    return json.loads(out.decode("utf-8"))


def load_tatoeba_fuc() -> dict[str, list[dict[str, str]]]:
    p = Path("/tmp/fulfulde_audit/tatoeba_fuc.json")
    if not p.exists():
        return {}
    items = json.loads(p.read_text(encoding="utf-8"))
    by_token: dict[str, list[dict[str, str]]] = defaultdict(list)
    for item in items:
        sent = nfc(WHITESPACE_RE.sub(" ", item.get("text") or "").strip())
        if not sent:
            continue
        en_text = ""
        for grp in item.get("translations") or []:
            sub = grp if isinstance(grp, list) else [grp]
            for tr in sub:
                if tr.get("lang") == "eng" and tr.get("text"):
                    en_text = WHITESPACE_RE.sub(" ", tr["text"]).strip()
                    break
            if en_text:
                break
        for tok in set(re.findall(r"[^\W\d_]{2,}", sent.lower(), re.UNICODE)):
            tok_norm = normalize_fulfulde_flexible(tok)
            if len(by_token[tok_norm]) < 2:
                by_token[tok_norm].append({
                    "sourceText": sent,
                    "targetText": en_text,
                    "attribution": "Tatoeba Project (fuc · CC BY 2.0 FR)",
                })
    return by_token


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Isolated LEXICA Fulfulde Schema v4 Core + Extended Prototype")
    parser.add_argument("--out-dir", default="/tmp/fulfulde_prototype_v4")
    args = parser.parse_args()

    t_start = time.perf_counter()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    core_db = out_dir / "lexica_fulfulde_core_proto.db"
    ext_db = out_dir / "lexica_fulfulde_extended_proto.db"
    core_gz = out_dir / "lexica_fulfulde_core_proto.db.gz"
    ext_gz = out_dir / "lexica_fulfulde_extended_proto.db.gz"
    manifest_path = out_dir / "fulfulde_prototype_manifest.json"
    for p in [core_db, ext_db, core_gz, ext_gz, manifest_path]:
        if p.exists():
            p.unlink()

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
        "plura": "plural",
        "character": "letter",
    }

    # 1. Curated starter entries
    curated = load_curated_ff_entries()
    print(f"Loaded Lexica Curated Fulfulde starter entries: {len(curated)}")

    # 2. Kaikki.org Fula extract (CC BY-SA 4.0 & GFDL)
    kaikki_path = Path("/tmp/fulfulde_audit/kaikki_fula.jsonl")
    if not kaikki_path.exists():
        raise FileNotFoundError(f"Missing Kaikki Fula extract: {kaikki_path}")

    kaikki_entries: dict[tuple[str, str], dict[str, Any]] = {}
    kaikki_raw_count = 0
    kaikki_skipped_empty = 0

    with open(kaikki_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            kaikki_raw_count += 1
            r = json.loads(line)
            hw = nfc((r.get("word") or "").strip())
            if not hw:
                continue

            pos_raw = (r.get("pos") or "noun").strip().lower()
            pos_norm = pos_normalize_map.get(pos_raw, pos_raw)

            row_tags = set(r.get("tags") or [])
            sense_tags = set()
            ipas = []
            for s in r.get("sounds") or []:
                if s.get("ipa"):
                    ipas.append({"ipa": s["ipa"], "tags": s.get("tags") or ([s["note"]] if s.get("note") else [])})

            forms = []
            adlam_variants = []
            if ADLAM_RE.search(hw):
                adlam_variants.append(hw)
            for frm in r.get("forms") or []:
                fv = nfc((frm.get("form") or "").strip())
                if not fv or fv == hw:
                    continue
                if ADLAM_RE.search(fv):
                    adlam_variants.append(fv)
                forms.append(fv)

            glosses = []
            synonyms = []
            antonyms = []
            examples = []
            for s in r.get("senses") or []:
                sense_tags.update(s.get("tags") or [])
                gs = s.get("glosses") or s.get("raw_glosses") or []
                if gs:
                    gtxt = WHITESPACE_RE.sub(" ", "; ".join(gs)).strip()
                    if not is_placeholder_or_empty(gtxt):
                        glosses.append(gtxt)
                for syn in s.get("synonyms") or []:
                    if isinstance(syn, dict) and syn.get("word"):
                        synonyms.append(nfc(syn["word"]))
                for ant in s.get("antonyms") or []:
                    if isinstance(ant, dict) and ant.get("word"):
                        antonyms.append(nfc(ant["word"]))
                for ex in s.get("examples") or []:
                    if isinstance(ex, dict) and ex.get("text") and len(ex["text"]) <= 220:
                        examples.append({
                            "sourceText": nfc(ex["text"].strip()),
                            "targetText": (ex.get("english") or ex.get("translation") or "").strip(),
                            "attribution": ex.get("ref") or "Kaikki EN-Wiktionary Fula (CC BY-SA 4.0)",
                        })

            if not glosses:
                kaikki_skipped_empty += 1
                continue

            all_tags = row_tags | sense_tags
            varieties = []
            if "Pular" in all_tags:
                varieties.append("Pular (Futa Jallon)")
            if "Pulaar" in all_tags:
                varieties.append("Pulaar (Futa Tooro)")
            dialect_label = ", ".join(varieties) if varieties else "Pan-Fulfulde"

            rec = {
                "headword": hw,
                "pos": pos_norm,
                "primaryIpa": ipas[0]["ipa"] if ipas else None,
                "allIpas": ipas,
                "dialect": dialect_label,
                "adlamVariants": list(dict.fromkeys(adlam_variants)),
                "forms": list(dict.fromkeys(forms)),
                "glosses": list(dict.fromkeys(glosses)),
                "synonyms": list(dict.fromkeys(synonyms))[:8],
                "antonyms": list(dict.fromkeys(antonyms))[:6],
                "examples": examples[:4],
                "etymology": r.get("etymology_text"),
            }
            key = (normalize_fulfulde_exact(hw), pos_norm)
            if key not in kaikki_entries:
                kaikki_entries[key] = rec
            else:
                ex_rec = kaikki_entries[key]
                ex_rec["glosses"] = list(dict.fromkeys(ex_rec["glosses"] + rec["glosses"]))
                ex_rec["forms"] = list(dict.fromkeys(ex_rec["forms"] + rec["forms"]))
                ex_rec["adlamVariants"] = list(dict.fromkeys(ex_rec["adlamVariants"] + rec["adlamVariants"]))
                ex_rec["allIpas"].extend(rec["allIpas"])
                if not ex_rec["primaryIpa"] and rec["primaryIpa"]:
                    ex_rec["primaryIpa"] = rec["primaryIpa"]
                if rec["dialect"] != "Pan-Fulfulde" and rec["dialect"] not in ex_rec["dialect"]:
                    ex_rec["dialect"] = (
                        rec["dialect"]
                        if ex_rec["dialect"] == "Pan-Fulfulde"
                        else f"{ex_rec['dialect']}; {rec['dialect']}"
                    )

    print(f"Loaded Kaikki Fula usable entries: {len(kaikki_entries)} (skipped empty: {kaikki_skipped_empty})")

    # 3. Wikidata Lexemes wd:Q33454 (CC0 1.0)
    wd_full_path = Path("/tmp/fulfulde_audit/wikidata_q33454_full.json")
    wd_entries: dict[tuple[str, str], dict[str, Any]] = {}
    wd_rejected_no_gloss = 0
    wd_rejected_junk_or_reversed = 0
    wd_normalized_artifacts = 0

    if wd_full_path.exists():
        wd_raw = json.loads(wd_full_path.read_text(encoding="utf-8"))
        for _lid, item in wd_raw.items():
            raw_lemma = nfc((item.get("lemma") or "").strip())
            if not raw_lemma or is_placeholder_or_empty(raw_lemma):
                wd_rejected_junk_or_reversed += 1
                continue

            pos_raw = (item.get("pos") or "noun").strip().lower()
            pos_norm = pos_normalize_map.get(pos_raw, pos_raw)

            en_glosses: list[str] = []
            ff_glosses: list[str] = []
            for glang, gval in item.get("glosses") or []:
                g = nfc((gval or "").strip())
                if is_placeholder_or_empty(g):
                    continue
                if glang.startswith("en") and g not in en_glosses:
                    en_glosses.append(g)
                elif glang == "ff" and g not in ff_glosses:
                    ff_glosses.append(g)

            if not en_glosses and not ff_glosses:
                wd_rejected_no_gloss += 1
                continue

            # Detect reversed English-lemma entries (e.g. lemma="Visitor", gloss ff="Kodo"; lemma="Be", gloss ff="nanndude")
            if ff_glosses and not en_glosses and (
                looks_like_english_only(raw_lemma) or raw_lemma.lower() in {"be", "visitor", "do", "go"}
            ):
                wd_rejected_junk_or_reversed += 1
                continue

            # Repair Czech ď/đ substitution artifacts into canonical Bamako/NERDC ɗ while preserving original as variant form
            has_artifact = bool(NON_STD_D_RE.search(raw_lemma))
            hw = canonicalize_bamako_nerdc(raw_lemma) if has_artifact else raw_lemma
            forms = [raw_lemma] if has_artifact and raw_lemma != hw else []
            if has_artifact:
                wd_normalized_artifacts += 1

            # Filter ff_glosses that are actually English-only
            verified_ff = [g for g in ff_glosses if not looks_like_english_only(g)]
            fallback_en = [g for g in ff_glosses if looks_like_english_only(g)]
            all_en = list(dict.fromkeys(en_glosses + fallback_en))

            if not verified_ff and not all_en:
                wd_rejected_no_gloss += 1
                continue

            key = (normalize_fulfulde_exact(hw), pos_norm)
            if key not in wd_entries:
                wd_entries[key] = {
                    "headword": hw,
                    "pos": pos_norm,
                    "forms": forms,
                    "ffGlosses": verified_ff,
                    "enGlosses": all_en,
                    "hadArtifact": has_artifact,
                }
            else:
                ex_w = wd_entries[key]
                ex_w["forms"] = list(dict.fromkeys(ex_w["forms"] + forms))
                ex_w["ffGlosses"] = list(dict.fromkeys(ex_w["ffGlosses"] + verified_ff))
                ex_w["enGlosses"] = list(dict.fromkeys(ex_w["enGlosses"] + all_en))
                ex_w["hadArtifact"] = ex_w["hadArtifact"] or has_artifact

    print(
        f"Loaded Wikidata Q33454 usable entries: {len(wd_entries)} "
        f"(rejected no-gloss: {wd_rejected_no_gloss}, junk/reversed: {wd_rejected_junk_or_reversed}, "
        f"ď/đ->ɗ normalized: {wd_normalized_artifacts})"
    )

    # 4. Merge sources cleanly without dropping regional/orthographic variants
    all_keys: dict[tuple[str, str], dict[str, Any]] = {}

    def ensure_bucket(hw: str, pos: str) -> dict[str, Any]:
        hw_nfc = nfc(hw.strip())
        k = (normalize_fulfulde_exact(hw_nfc), pos)
        if k not in all_keys:
            all_keys[k] = {
                "headword": hw_nfc,
                "pos": pos,
                "script_variant": None,
                "primary_ipa": None,
                "all_ipas": [],
                "dialect": "Pan-Fulfulde",
                "etymology": None,
                "forms": [],
                "synonyms": [],
                "antonyms": [],
                "had_orthography_artifact": False,
                "senses": [],
            }
        return all_keys[k]

    for e in curated:
        hw = nfc(e["headword"].strip())
        raw_pos = (e.get("partOfSpeech") or "noun").strip().lower()
        pos = re.sub(r"\s*\([^)]*\)", "", raw_pos).strip() or "noun"
        pos = pos_normalize_map.get(pos, pos)
        b = ensure_bucket(hw, pos)
        if e.get("ipa") and not b["primary_ipa"]:
            b["primary_ipa"] = e.get("ipa")
            b["all_ipas"].append({"ipa": e["ipa"], "tags": [e.get("dialect") or "Pan-Fulfulde"]})
        if e.get("dialect"):
            b["dialect"] = e["dialect"]
        if e.get("etymology") and not b["etymology"]:
            b["etymology"] = e["etymology"]
        if e.get("headwordScriptVariant") and e["headwordScriptVariant"].get("text"):
            sv = nfc(e["headwordScriptVariant"]["text"])
            b["script_variant"] = sv
            b["forms"].append(sv)
        for mf in e.get("morphologicalForms") or []:
            if mf.get("form"):
                b["forms"].append(nfc(mf["form"]))
        b["synonyms"].extend(e.get("synonyms") or [])
        b["antonyms"].extend(e.get("antonyms") or [])
        # Filter out synthetic/templated placeholder examples ("— standard usage.")
        ex_list = [
            {
                "sourceText": nfc(ex.get("sourceText", "")),
                "targetText": ex.get("targetText", ""),
                "attribution": "Lexica Curated Fulfulde Corpus",
            }
            for ex in (e.get("examples") or [])
            if ex.get("sourceText") and "standard usage." not in ex.get("sourceText", "")
        ]
        def_ff = nfc((e.get("definition") or "").strip()) or None
        def_en = (e.get("definitionEn") or "").strip() or None
        if def_ff and looks_like_english_only(def_ff):
            if not def_en:
                def_en = def_ff
            def_ff = None
        if not def_ff and not def_en:
            continue
        dtype = (
            "bilingual_explanation"
            if (def_ff and def_en)
            else ("fulfulde_monolingual" if def_ff else "english_gloss")
        )
        b["senses"].append((
            1,
            def_ff,
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
        if b["dialect"] == "Pan-Fulfulde" and k_data["dialect"] != "Pan-Fulfulde":
            b["dialect"] = k_data["dialect"]
        if not b["script_variant"] and k_data["adlamVariants"]:
            b["script_variant"] = k_data["adlamVariants"][0]
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

    for (_hw_l, pos), w_data in wd_entries.items():
        b = ensure_bucket(w_data["headword"], pos)
        b["forms"].extend(w_data["forms"])
        if w_data["hadArtifact"]:
            b["had_orthography_artifact"] = True
        if w_data["ffGlosses"]:
            for idx_f, fg in enumerate(w_data["ffGlosses"]):
                en_join = "; ".join(w_data["enGlosses"]) if (idx_f == 0 and w_data["enGlosses"]) else None
                b["senses"].append((
                    3,
                    fg,
                    en_join,
                    "bilingual_explanation" if en_join else "fulfulde_monolingual",
                    "community_reviewed",
                    [],
                    [],
                    [],
                ))
        elif w_data["enGlosses"]:
            b["senses"].append((
                3,
                None,
                "; ".join(w_data["enGlosses"][:4]),
                "english_gloss",
                "community_reviewed",
                [],
                [],
                [],
            ))

    tatoeba_by_token = load_tatoeba_fuc()
    final_records = [b for b in all_keys.values() if b["senses"]]
    final_records.sort(key=lambda r: (r["headword"].lower(), r["pos"]))
    print(f"Final Schema v4 Fulfulde Prototype entries: {len(final_records)}")

    # 5. Build Schema v4 Core + Extended SQLite databases
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
            definition_ff TEXT,
            definition_en TEXT,
            primary_definition TEXT NOT NULL,
            definition_type TEXT NOT NULL CHECK(definition_type IN ('fulfulde_monolingual','english_gloss','bilingual_explanation','machine_generated','unavailable')),
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
            definition_ff,
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
            definition_ff TEXT,
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
    dialect_counts = Counter()
    distinct_hw = set()
    conflict_count = 0
    conflict_review_id = 1
    with_examples_count = 0
    with_ipa_count = 0
    with_adlam_count = 0
    total_forms = 0
    total_senses = 0
    wf_id = 1
    sense_id = 1

    # Diagnostic tracking for regional/orthographic pairs sharing ASCII skeleton
    flexible_groups: dict[str, set[str]] = defaultdict(set)

    for idx, b in enumerate(final_records, start=1):
        hw = b["headword"]
        hw_l = normalize_fulfulde_exact(hw)
        distinct_hw.add(hw_l)
        hw_norm = normalize_fulfulde_flexible(hw_l)
        flexible_groups[hw_norm].add(hw_l)
        hw_norm_opt = None if hw_norm == hw_l else hw_norm
        pos_id = get_pos_id(b["pos"])
        dialect_counts[b["dialect"]] += 1

        ordered_senses = sorted(
            b["senses"],
            key=lambda s: (
                0 if s[4] == "human_verified" else (1 if s[1] else 2),
                s[0],
            ),
        )
        best_src, best_ff, best_en, best_dtype, best_verif, _bex, _bsyn, _bant = ordered_senses[0]

        if best_ff and not best_en:
            en_cands = [s[2] for s in ordered_senses if s[2]]
            if en_cands:
                best_en = en_cands[0]
                best_dtype = "bilingual_explanation"
        elif best_en and not best_ff:
            ff_cands = [s[1] for s in ordered_senses if s[1]]
            if ff_cands:
                best_ff = ff_cands[0]
                best_dtype = "bilingual_explanation"

        src_ids = {s[0] for s in ordered_senses}
        ff_defs_unique = {normalize_fulfulde_flexible(s[1]) for s in ordered_senses if s[1]}
        en_defs_unique = {normalize_fulfulde_flexible(s[2]) for s in ordered_senses if s[2]}
        has_conflict = 1 if (len(src_ids) > 1 and (len(ff_defs_unique) > 1 or len(en_defs_unique) > 1)) or b["had_orthography_artifact"] else 0
        if has_conflict:
            conflict_count += 1
            if best_verif == "community_reviewed":
                best_verif = "conflict_flagged"

        primary_def_display = best_ff if best_ff else (best_en or "")
        sv = b["script_variant"]
        if b["primary_ipa"]:
            with_ipa_count += 1
        if sv:
            with_adlam_count += 1

        def_type_counts[best_dtype] += 1
        source_counts[best_src] += 1
        verif_counts[best_verif] += 1

        c_conn.execute(
            "INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (
                idx, hw, hw_l, hw_norm_opt, sv, None, pos_id,
                b["primary_ipa"], None, b["dialect"], best_ff, best_en, primary_def_display,
                best_dtype, best_verif, has_conflict, best_src,
            ),
        )
        c_conn.execute(
            "INSERT INTO entries_fts(rowid, headword, definition_ff, definition_en, primary_definition) VALUES (?, ?, ?, ?, ?);",
            (idx, hw, best_ff or "", best_en or "", primary_def_display),
        )

        forms_to_insert = list(dict.fromkeys(b["forms"]))
        for frm in forms_to_insert:
            fl = normalize_fulfulde_exact(frm)
            fn = normalize_fulfulde_flexible(fl)
            c_conn.execute("INSERT INTO word_forms VALUES (?, ?, ?, ?);", (wf_id, idx, frm, None if fn == fl else fn))
            wf_id += 1
            total_forms += 1

        tat_exs = tatoeba_by_token.get(hw_norm, [])
        entry_had_ex = False
        for s_num, (s_src, s_ff, s_en, s_dtype, s_verif, s_exs, s_syns, s_ants) in enumerate(ordered_senses, start=1):
            merged_ex = list(s_exs)
            if s_num == 1 and tat_exs:
                existing_txts = {ex.get("sourceText") for ex in merged_ex}
                for tex in tat_exs:
                    if tex["sourceText"] not in existing_txts:
                        merged_ex.append(tex)
            if merged_ex:
                entry_had_ex = True
            syn_list = list(dict.fromkeys(s_syns if s_num > 1 else (s_syns + b["synonyms"])))[:8]
            ant_list = list(dict.fromkeys(s_ants if s_num > 1 else (s_ants + b["antonyms"])))[:6]
            e_conn.execute(
                "INSERT INTO senses_ext VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                (
                    sense_id, idx, s_num, b["pos"], s_ff, s_en, s_dtype, s_src, s_verif,
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
            ki = (item["ipa"], tuple(item.get("tags") or []))
            if ki not in seen_ipa:
                seen_ipa.add(ki)
                dedup_ipas.append(item)

        if dedup_ipas or b["etymology"] or has_conflict:
            note = (
                "Non-standard Czech ď/đ artifact normalized to Bamako/NERDC ɗ; original form preserved in word_forms."
                if b["had_orthography_artifact"]
                else ("Cross-source glosses preserved separately for native Fulfulde review." if has_conflict else None)
            )
            e_conn.execute(
                "INSERT INTO entry_extensions VALUES (?, ?, ?, ?, ?);",
                (idx, json.dumps(dedup_ipas, ensure_ascii=False), b["etymology"], None, note),
            )

        if has_conflict:
            conflict_versions = []
            for s_src, s_ff, s_en, s_dtype, s_verif, _ex, _syn, _ant in ordered_senses:
                sm = source_lookup.get(s_src, {"code": "unknown", "name": "Unknown", "license": ""})
                conflict_versions.append({
                    "sourceCode": sm["code"],
                    "sourceName": sm["name"],
                    "license": sm["license"],
                    "definitionFf": s_ff,
                    "definitionEn": s_en,
                    "definitionType": s_dtype,
                    "verificationStatus": s_verif,
                })
            nature = (
                "Orthographic ď/đ artifact normalized to ɗ; cross-source review recommended."
                if b["had_orthography_artifact"]
                else "Cross-source definitions supplied across independent open sources."
            )
            e_conn.execute(
                "INSERT INTO conflict_reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
                (
                    conflict_review_id, idx, hw, b["pos"],
                    json.dumps(conflict_versions, ensure_ascii=False),
                    nature, "pending", "conflict_flagged", None,
                ),
            )
            conflict_review_id += 1

    c_conn.execute("CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);")
    c_conn.execute("CREATE INDEX idx_entries_headword_norm ON entries(headword_norm) WHERE headword_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_entries_def_type ON entries(definition_type);")
    c_conn.execute("CREATE INDEX idx_word_forms_form ON word_forms(form);")
    c_conn.execute("CREATE INDEX idx_word_forms_form_norm ON word_forms(form_norm) WHERE form_norm IS NOT NULL;")
    c_conn.execute("CREATE INDEX idx_word_forms_entry_id ON word_forms(entry_id);")

    sql_entries = int(c_conn.execute("SELECT COUNT(*) FROM entries;").fetchone()[0])
    sql_distinct_hw = int(c_conn.execute("SELECT COUNT(DISTINCT headword_lower) FROM entries;").fetchone()[0])
    sql_word_forms = int(c_conn.execute("SELECT COUNT(*) FROM word_forms;").fetchone()[0])
    sql_total_senses = int(e_conn.execute("SELECT COUNT(*) FROM senses_ext;").fetchone()[0])
    sql_conflicts = int(e_conn.execute("SELECT COUNT(*) FROM conflict_reviews;").fetchone()[0])
    orthographic_variant_sets = sum(1 for v in flexible_groups.values() if len(v) > 1)

    for k, v in [
        ("pack_id", "ff-lexica-schema-v4-proto"),
        ("schema_version", "4"),
        ("pack_layer", "core-prototype"),
        ("pack_version", PACK_VERSION_CORE),
        ("dataset_version", DATASET_VERSION),
        ("primary_orthography", "UNESCO Bamako (1966) / NERDC Nigerian Fulfulde Latin"),
        ("accepted_entries", str(sql_entries)),
        ("distinct_headwords", str(sql_distinct_hw)),
        ("total_senses", str(sql_total_senses)),
        ("total_word_forms", str(sql_word_forms)),
        ("fulfulde_monolingual_count", str(def_type_counts["fulfulde_monolingual"])),
        ("bilingual_count", str(def_type_counts["bilingual_explanation"])),
        ("english_gloss_count", str(def_type_counts["english_gloss"])),
        ("conflict_count", str(sql_conflicts)),
    ]:
        c_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    for k, v in [
        ("pack_id", "ff-lexica-schema-v4-extended-proto"),
        ("schema_version", "4"),
        ("pack_layer", "extended-prototype"),
        ("pack_version", PACK_VERSION_EXT),
        ("dataset_version", DATASET_VERSION),
        ("total_senses", str(sql_total_senses)),
        ("conflict_count", str(sql_conflicts)),
    ]:
        e_conn.execute("INSERT INTO metadata VALUES (?, ?);", (k, v))

    c_conn.commit()
    e_conn.commit()

    qc_core = c_conn.execute("PRAGMA quick_check;").fetchone()[0]
    qc_ext = e_conn.execute("PRAGMA quick_check;").fetchone()[0]

    # Exact vs flexible search benchmarks
    t0 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_lower = 'suudu';").fetchall()
    exact_ms = (time.perf_counter() - t0) / 100 * 1000

    t1 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT id FROM entries WHERE headword_norm = 'cuudi' OR headword_lower = 'cuuɗi';").fetchall()
    flex_ms = (time.perf_counter() - t1) / 100 * 1000

    t2 = time.perf_counter()
    for _ in range(100):
        c_conn.execute("SELECT rowid FROM entries_fts WHERE entries_fts MATCH 'water' LIMIT 20;").fetchall()
    fts_ms = (time.perf_counter() - t2) / 100 * 1000

    c_conn.close()
    e_conn.close()

    gzip_file(core_db, core_gz)
    gzip_file(ext_db, ext_gz)

    manifest = {
        "packId": "ff-lexica-schema-v4-proto",
        "prototypeOnly": True,
        "targetLanguage": "ff",
        "primaryOrthography": "UNESCO Bamako (1966) / NERDC Nigerian Fulfulde Latin (ɓ, ɗ, ƴ, ŋ, ɲ, doubled long vowels)",
        "schemaVersion": 4,
        "packVersion": PACK_VERSION_CORE,
        "datasetVersion": DATASET_VERSION,
        "core": {
            "filename": core_gz.name,
            "compressedSizeBytes": core_gz.stat().st_size,
            "compressedSha256": sha256_file(core_gz),
            "uncompressedSizeBytes": core_db.stat().st_size,
            "uncompressedSha256": sha256_file(core_db),
            "sqliteQuickCheck": qc_core,
        },
        "extended": {
            "filename": ext_gz.name,
            "compressedSizeBytes": ext_gz.stat().st_size,
            "compressedSha256": sha256_file(ext_gz),
            "uncompressedSizeBytes": ext_db.stat().st_size,
            "uncompressedSha256": sha256_file(ext_db),
            "sqliteQuickCheck": qc_ext,
        },
        "statistics": {
            "acceptedEntries": sql_entries,
            "distinctHeadwords": sql_distinct_hw,
            "totalSenses": sql_total_senses,
            "totalWordForms": sql_word_forms,
            "entriesWithExamples": with_examples_count,
            "entriesWithIpa": with_ipa_count,
            "entriesWithAdlamVariant": with_adlam_count,
            "orthographicVariantSets": orthographic_variant_sets,
            "conflictCount": sql_conflicts,
            "wikidataDCaronNormalized": wd_normalized_artifacts,
            "definitionTypes": dict(def_type_counts),
            "bySource": {source_lookup[k]["code"]: v for k, v in source_counts.items()},
            "byDialectLabel": dict(dialect_counts),
            "byVerificationStatus": dict(verif_counts),
        },
        "benchmarksMs": {
            "exactHeadwordLookup": round(exact_ms, 4),
            "flexibleOrthographyLookup": round(flex_ms, 4),
            "fts5GlossMatch": round(fts_ms, 4),
        },
        "sources": [
            {
                "code": s[1],
                "name": s[2],
                "license": s[3],
                "attributionText": s[4],
                "sourceUrl": s[5],
            }
            for s in SOURCES_METADATA
        ],
        "buildElapsedSeconds": round(time.perf_counter() - t_start, 2),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
