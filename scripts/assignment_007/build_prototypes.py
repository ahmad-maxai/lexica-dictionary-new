#!/usr/bin/env python3
"""
Assignment 007 — Phase 2: Prototype Builder
Builds four architectures (A1: Optimized SQLite v3, B: Sharded JSONL, C: Compact Binary .lxcbin, D: Layered Core+Extended SQLite)
from the canonical 75,000-entry English dictionary database.
"""

from __future__ import annotations

import collections
import json
import os
import re
import shutil
import sqlite3
import struct
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

SRC_DB = Path("/tmp/lexica_english_v030.db")
OUT_ROOT = Path("/tmp/lexica_a007")

TOKEN_RE = re.compile(r"[a-z0-9]+")


def load_canonical_dataset(src_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    metadata = dict(conn.execute("SELECT key, value FROM metadata").fetchall())
    sources = [
        dict(zip([d[0] for d in conn.execute("SELECT * FROM sources").description], r))
        for r in conn.execute("SELECT * FROM sources").fetchall()
    ]

    entries = []
    for r in conn.execute(
        """
        SELECT e.id, e.headword_lower, e.headword, p.name, e.primary_ipa,
               pr.all_ipas, au.filename, et.text, e.source_id
        FROM entries e
        JOIN parts_of_speech p ON p.id = e.pos_id
        LEFT JOIN pronunciations pr ON pr.id = e.pronunciation_id
        LEFT JOIN audio_files au ON au.id = e.audio_id
        LEFT JOIN etymologies et ON et.id = e.etymology_id
        ORDER BY e.id
        """
    ):
        entries.append(
            {
                "id": r[0],
                "headword_lower": r[1],
                "headword": r[2] if r[2] is not None else r[1],
                "pos": r[3],
                "primary_ipa": r[4],
                "all_ipas": r[5],
                "audio_file": r[6],
                "etymology": r[7],
                "source_id": r[8],
            }
        )

    senses_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in conn.execute(
        """
        SELECT s.entry_id, s.sense_number, s.definition, ts.tags_json, s.examples, s.synonyms, s.antonyms
        FROM senses s
        LEFT JOIN tag_sets ts ON ts.id = s.tags_id
        ORDER BY s.entry_id, s.sense_number, s.id
        """
    ):
        senses_by_entry[r[0]].append(
            {
                "sense_number": r[1],
                "definition": r[2],
                "tags": r[3],
                "examples": r[4],
                "synonyms": r[5],
                "antonyms": r[6],
            }
        )

    forms_by_entry: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in conn.execute(
        """
        SELECT wf.entry_id, wf.form_lower, wf.form, ts.tags_json
        FROM word_forms wf
        LEFT JOIN tag_sets ts ON ts.id = wf.tags_id
        ORDER BY wf.entry_id, wf.id
        """
    ):
        forms_by_entry[r[0]].append(
            {
                "form_lower": r[1],
                "form": r[2] if r[2] is not None else r[1],
                "tags": r[3],
            }
        )

    conn.close()
    return {
        "metadata": metadata,
        "sources": sources,
        "entries": entries,
        "senses_by_entry": senses_by_entry,
        "forms_by_entry": forms_by_entry,
    }


def build_arch_a1_sqlite_v3(data: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    t0 = time.perf_counter()
    db_path = out_dir / "arch_a1_sqlite_v3.db"
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        PRAGMA page_size = 16384;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = ON;

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
        CREATE TABLE parts_of_speech (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE tag_sets (id INTEGER PRIMARY KEY, tags_json TEXT NOT NULL);
        CREATE TABLE pronunciations (id INTEGER PRIMARY KEY, all_ipas TEXT NOT NULL);
        CREATE TABLE etymologies (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
        CREATE TABLE audio_files (id INTEGER PRIMARY KEY, filename TEXT NOT NULL);
        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            headword_lower TEXT NOT NULL,
            headword TEXT,
            pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
            primary_ipa TEXT,
            pronunciation_id INTEGER REFERENCES pronunciations(id),
            audio_id INTEGER REFERENCES audio_files(id),
            etymology_id INTEGER REFERENCES etymologies(id),
            source_id INTEGER NOT NULL REFERENCES sources(id)
        );
        CREATE TABLE senses (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            sense_number INTEGER NOT NULL,
            definition TEXT NOT NULL,
            tags_id INTEGER REFERENCES tag_sets(id),
            examples TEXT,
            synonyms TEXT,
            antonyms TEXT
        );
        CREATE TABLE word_forms (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            form_lower TEXT NOT NULL,
            form TEXT,
            tags_id INTEGER REFERENCES tag_sets(id)
        );
        CREATE VIRTUAL TABLE entries_fts USING fts5(
            headword,
            definitions_text,
            content='',
            detail=none,
            tokenize = 'unicode61 remove_diacritics 1'
        );
        """
    )

    for k, v in data["metadata"].items():
        val = "3" if k == "schema_version" else v
        conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?);", (k, val))

    for s in data["sources"]:
        conn.execute(
            "INSERT INTO sources (id, code, name, license, attribution_text, source_url, dataset_version) VALUES (?, ?, ?, ?, ?, ?, ?);",
            (s["id"], s["code"], s["name"], s["license"], s["attribution_text"], s["source_url"], s["dataset_version"]),
        )

    pos_ids: dict[str, int] = {}
    for name in sorted({e["pos"] for e in data["entries"]}):
        cur = conn.execute("INSERT INTO parts_of_speech (name) VALUES (?);", (name,))
        pos_ids[name] = cur.lastrowid

    tag_ids: dict[str, int] = {}
    pron_ids: dict[str, int] = {}
    etym_ids: dict[str, int] = {}
    audio_ids: dict[str, int] = {}

    def intern(table: str, col: str, cache: dict[str, int], val: str | None) -> int | None:
        if val is None:
            return None
        hit = cache.get(val)
        if hit is not None:
            return hit
        cur = conn.execute(f"INSERT INTO {table} ({col}) VALUES (?);", (val,))
        cache[val] = cur.lastrowid
        return cur.lastrowid

    for e in data["entries"]:
        eid = e["id"]
        hw_opt = None if e["headword"] == e["headword_lower"] else e["headword"]
        p_id = intern("pronunciations", "all_ipas", pron_ids, e["all_ipas"])
        a_id = intern("audio_files", "filename", audio_ids, e["audio_file"])
        et_id = intern("etymologies", "text", etym_ids, e["etymology"])
        conn.execute(
            "INSERT INTO entries (id, headword_lower, headword, pos_id, primary_ipa, pronunciation_id, audio_id, etymology_id, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (eid, e["headword_lower"], hw_opt, pos_ids[e["pos"]], e["primary_ipa"], p_id, a_id, et_id, e["source_id"]),
        )
        defs_for_fts = []
        for s in data["senses_by_entry"][eid]:
            t_id = intern("tag_sets", "tags_json", tag_ids, s["tags"])
            conn.execute(
                "INSERT INTO senses (entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?);",
                (eid, s["sense_number"], s["definition"], t_id, s["examples"], s["synonyms"], s["antonyms"]),
            )
            defs_for_fts.append(s["definition"])
        for wf in data["forms_by_entry"][eid]:
            f_opt = None if wf["form"] == wf["form_lower"] else wf["form"]
            ft_id = intern("tag_sets", "tags_json", tag_ids, wf["tags"])
            conn.execute(
                "INSERT INTO word_forms (entry_id, form_lower, form, tags_id) VALUES (?, ?, ?, ?);",
                (eid, wf["form_lower"], f_opt, ft_id),
            )
        conn.execute(
            "INSERT INTO entries_fts (rowid, headword, definitions_text) VALUES (?, ?, ?);",
            (eid, e["headword"], " | ".join(defs_for_fts)),
        )

    conn.executescript(
        """
        CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);
        CREATE INDEX idx_senses_entry_id ON senses(entry_id, sense_number);
        CREATE INDEX idx_word_forms_lower ON word_forms(form_lower);
        CREATE INDEX idx_word_forms_entry_id ON word_forms(entry_id);
        ANALYZE;
        VACUUM;
        """
    )
    conn.close()
    return {
        "name": "Architecture A1: Optimized SQLite v3 (inline + detail=none FTS5)",
        "path": str(db_path),
        "bytes": db_path.stat().st_size,
        "build_seconds": round(time.perf_counter() - t0, 3),
    }


def shard_bucket(word_lower: str) -> str:
    if not word_lower:
        return "_other"
    ch = word_lower[0]
    return ch if "a" <= ch <= "z" else "_other"


def build_arch_b_shards(data: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    t0 = time.perf_counter()
    shard_root = out_dir / "arch_b_shards"
    if shard_root.exists():
        shutil.rmtree(shard_root)
    jsonl_dir = shard_root / "jsonl"
    compact_dir = shard_root / "compact_json"
    jsonl_dir.mkdir(parents=True)
    compact_dir.mkdir(parents=True)

    buckets: dict[str, list[list[Any]]] = defaultdict(list)
    form_buckets: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))
    token_to_buckets: dict[str, set[str]] = defaultdict(set)

    for e in data["entries"]:
        eid = e["id"]
        b = shard_bucket(e["headword_lower"])
        hw_opt = None if e["headword"] == e["headword_lower"] else e["headword"]
        senses_packed = []
        for s in data["senses_by_entry"][eid]:
            senses_packed.append(
                [
                    s["sense_number"],
                    s["definition"],
                    json.loads(s["tags"]) if s["tags"] else None,
                    json.loads(s["examples"]) if s["examples"] else None,
                    json.loads(s["synonyms"]) if s["synonyms"] else None,
                    json.loads(s["antonyms"]) if s["antonyms"] else None,
                ]
            )
            for tok in TOKEN_RE.findall(s["definition"].lower()):
                if len(tok) >= 2:
                    token_to_buckets[tok].add(b)
        for tok in TOKEN_RE.findall(e["headword_lower"]):
            if len(tok) >= 2:
                token_to_buckets[tok].add(b)

        forms_packed = []
        for wf in data["forms_by_entry"][eid]:
            f_opt = None if wf["form"] == wf["form_lower"] else wf["form"]
            forms_packed.append(
                [wf["form_lower"], f_opt, json.loads(wf["tags"]) if wf["tags"] else None]
            )
            fb = shard_bucket(wf["form_lower"])
            form_buckets[fb][wf["form_lower"]].append([b, eid])

        buckets[b].append(
            [
                eid,
                e["headword_lower"],
                hw_opt,
                e["pos"],
                e["primary_ipa"],
                json.loads(e["all_ipas"]) if e["all_ipas"] else None,
                e["audio_file"],
                e["etymology"],
                senses_packed,
                forms_packed,
            ]
        )

    total_jsonl_bytes = 0
    total_compact_bytes = 0
    shard_counts: dict[str, int] = {}
    for b, records in sorted(buckets.items()):
        records.sort(key=lambda r: (r[1], r[0]))
        shard_counts[b] = len(records)
        jp = jsonl_dir / f"{b}.jsonl"
        with open(jp, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
        total_jsonl_bytes += jp.stat().st_size

        cp = compact_dir / f"{b}.json"
        cp.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        total_compact_bytes += cp.stat().st_size

    aux_dir = shard_root / "indexes"
    aux_dir.mkdir(parents=True)
    form_idx_bytes = 0
    for fb, fmap in sorted(form_buckets.items()):
        fp = aux_dir / f"forms_{fb}.json"
        fp.write_text(json.dumps(fmap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        form_idx_bytes += fp.stat().st_size

    tok_map_serializable = {tok: sorted(bs) for tok, bs in token_to_buckets.items()}
    tok_p = aux_dir / "token_buckets.json"
    tok_p.write_text(json.dumps(tok_map_serializable, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tok_idx_bytes = tok_p.stat().st_size

    return {
        "name": "Architecture B: Initial-Letter JSON / JSONL Shards (27 shards)",
        "root": str(shard_root),
        "shard_count": len(buckets),
        "jsonl_shards_bytes": total_jsonl_bytes,
        "compact_json_shards_bytes": total_compact_bytes,
        "form_indexes_bytes": form_idx_bytes,
        "token_buckets_index_bytes": tok_idx_bytes,
        "total_jsonl_with_indexes_bytes": total_jsonl_bytes + form_idx_bytes + tok_idx_bytes,
        "total_compact_with_indexes_bytes": total_compact_bytes + form_idx_bytes + tok_idx_bytes,
        "max_shard_entries": max(shard_counts.values()),
        "min_shard_entries": min(shard_counts.values()),
        "build_seconds": round(time.perf_counter() - t0, 3),
    }


def encode_uvarint(value: int) -> bytes:
    out = bytearray()
    while True:
        to_write = value & 0x7F
        value >>= 7
        if value:
            out.append(to_write | 0x80)
        else:
            out.append(to_write)
            break
    return bytes(out)


def encode_str(s: str | None) -> bytes:
    if s is None:
        return encode_uvarint(0)
    b = s.encode("utf-8")
    return encode_uvarint(len(b)) + b


def build_arch_c_binary(data: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    t0 = time.perf_counter()
    bin_path = out_dir / "arch_c_compact.lxcbin"
    if bin_path.exists():
        bin_path.unlink()

    pos_list: list[str] = []
    pos_idx: dict[str, int] = {}
    tag_list: list[str] = []
    tag_idx: dict[str, int] = {}
    pron_list: list[str] = []
    pron_idx: dict[str, int] = {}
    audio_list: list[str] = []
    audio_idx: dict[str, int] = {}
    etym_list: list[str] = []
    etym_idx: dict[str, int] = {}

    def pool_id(lst: list[str], idx_map: dict[str, int], val: str | None) -> int:
        if val is None:
            return 0
        hit = idx_map.get(val)
        if hit is not None:
            return hit
        new_id = len(lst) + 1
        lst.append(val)
        idx_map[val] = new_id
        return new_id

    entries_blob = bytearray()
    entry_offsets: list[int] = []

    hw_to_entry_ids: dict[str, list[int]] = defaultdict(list)
    wf_to_items: dict[str, list[tuple[int, str | None, int]]] = defaultdict(list)
    token_to_eids: dict[str, list[int]] = defaultdict(list)

    for e in data["entries"]:
        eid = e["id"]
        entry_offsets.append(len(entries_blob))
        hw_to_entry_ids[e["headword_lower"]].append(eid)

        p_id = pool_id(pos_list, pos_idx, e["pos"])
        pr_id = pool_id(pron_list, pron_idx, e["all_ipas"])
        au_id = pool_id(audio_list, audio_idx, e["audio_file"])
        et_id = pool_id(etym_list, etym_idx, e["etymology"])

        hw_diff = e["headword"] != e["headword_lower"]
        flags = 0
        if hw_diff:
            flags |= 1
        if e["primary_ipa"]:
            flags |= 2
        entries_blob.append(flags)
        entries_blob.extend(encode_str(e["headword_lower"]))
        if hw_diff:
            entries_blob.extend(encode_str(e["headword"]))
        entries_blob.extend(encode_uvarint(p_id))
        if e["primary_ipa"]:
            entries_blob.extend(encode_str(e["primary_ipa"]))
        entries_blob.extend(encode_uvarint(pr_id))
        entries_blob.extend(encode_uvarint(au_id))
        entries_blob.extend(encode_uvarint(et_id))

        senses = data["senses_by_entry"][eid]
        entries_blob.extend(encode_uvarint(len(senses)))
        seen_toks: set[str] = set()
        for tok in TOKEN_RE.findall(e["headword_lower"]):
            if len(tok) >= 2:
                seen_toks.add(tok)

        for s in senses:
            entries_blob.extend(encode_uvarint(s["sense_number"]))
            t_id = pool_id(tag_list, tag_idx, s["tags"])
            entries_blob.extend(encode_uvarint(t_id))
            entries_blob.extend(encode_str(s["definition"]))
            s_flags = 0
            if s["examples"]:
                s_flags |= 1
            if s["synonyms"]:
                s_flags |= 2
            if s["antonyms"]:
                s_flags |= 4
            entries_blob.append(s_flags)
            if s["examples"]:
                entries_blob.extend(encode_str(s["examples"]))
            if s["synonyms"]:
                entries_blob.extend(encode_str(s["synonyms"]))
            if s["antonyms"]:
                entries_blob.extend(encode_str(s["antonyms"]))
            for tok in TOKEN_RE.findall(s["definition"].lower()):
                if len(tok) >= 2:
                    seen_toks.add(tok)

        forms = data["forms_by_entry"][eid]
        entries_blob.extend(encode_uvarint(len(forms)))
        for wf in forms:
            ft_id = pool_id(tag_list, tag_idx, wf["tags"])
            wf_diff = wf["form"] != wf["form_lower"]
            entries_blob.append(1 if wf_diff else 0)
            entries_blob.extend(encode_str(wf["form_lower"]))
            if wf_diff:
                entries_blob.extend(encode_str(wf["form"]))
            entries_blob.extend(encode_uvarint(ft_id))
            wf_to_items[wf["form_lower"]].append((eid, wf["form"] if wf_diff else None, ft_id))

        for tok in seen_toks:
            token_to_eids[tok].append(eid)

    strings_blob = bytearray()
    for pool in (pos_list, tag_list, pron_list, audio_list, etym_list):
        strings_blob.extend(encode_uvarint(len(pool)))
        for item in pool:
            strings_blob.extend(encode_str(item))

    offsets_blob = struct.pack(f"<{len(entry_offsets)}I", *entry_offsets)

    def build_front_coded_blocks(sorted_keys: list[str], payload_fn, block_size: int) -> tuple[bytes, bytes]:
        blocks_blob = bytearray()
        dir_entries: list[tuple[str, int, int]] = []
        for i in range(0, len(sorted_keys), block_size):
            chunk = sorted_keys[i : i + block_size]
            b_start = len(blocks_blob)
            blocks_blob.extend(encode_uvarint(len(chunk)))
            prev_bytes = b""
            for k in chunk:
                k_bytes = k.encode("utf-8")
                shared = 0
                limit = min(len(prev_bytes), len(k_bytes))
                while shared < limit and prev_bytes[shared] == k_bytes[shared]:
                    shared += 1
                suffix = k_bytes[shared:]
                blocks_blob.extend(encode_uvarint(shared))
                blocks_blob.extend(encode_uvarint(len(suffix)))
                blocks_blob.extend(suffix)
                blocks_blob.extend(payload_fn(k))
                prev_bytes = k_bytes
            dir_entries.append((chunk[0], b_start, len(blocks_blob) - b_start))

        dir_blob = bytearray()
        dir_blob.extend(struct.pack("<I", len(dir_entries)))
        for first_k, rel_off, blen in dir_entries:
            dir_blob.extend(encode_str(first_k))
            dir_blob.extend(struct.pack("<II", rel_off, blen))
        return bytes(dir_blob), bytes(blocks_blob)

    sorted_hws = sorted(hw_to_entry_ids.keys())
    hw_dir_blob, hw_blocks_blob = build_front_coded_blocks(
        sorted_hws,
        lambda k: encode_uvarint(len(hw_to_entry_ids[k])) + b"".join(encode_uvarint(eid) for eid in hw_to_entry_ids[k]),
        block_size=32,
    )

    sorted_wfs = sorted(wf_to_items.keys())
    wf_dir_blob, wf_blocks_blob = build_front_coded_blocks(
        sorted_wfs,
        lambda k: encode_uvarint(len(wf_to_items[k])) + b"".join(encode_uvarint(item[0]) for item in wf_to_items[k]),
        block_size=64,
    )

    sorted_toks = sorted(token_to_eids.keys())

    def encode_postings(tok: str) -> bytes:
        eids = sorted(set(token_to_eids[tok]))
        out = bytearray(encode_uvarint(len(eids)))
        prev = 0
        for eid in eids:
            out.extend(encode_uvarint(eid - prev))
            prev = eid
        return bytes(out)

    inv_dir_blob, inv_blocks_blob = build_front_coded_blocks(sorted_toks, encode_postings, block_size=64)

    header_size = struct.calcsize("<4sHHIIQQQQQQQQQ")
    off_strings = header_size
    off_offsets = off_strings + len(strings_blob)
    off_entries = off_offsets + len(offsets_blob)
    off_hw_dir = off_entries + len(entries_blob)
    off_hw_blocks = off_hw_dir + len(hw_dir_blob)
    off_wf_dir = off_hw_blocks + len(hw_blocks_blob)
    off_wf_blocks = off_wf_dir + len(wf_dir_blob)
    off_inv_dir = off_wf_blocks + len(wf_blocks_blob)
    off_inv_blocks = off_inv_dir + len(inv_dir_blob)

    header = struct.pack(
        "<4sHHIIQQQQQQQQQ",
        b"LXCB",
        1,
        0,
        len(data["entries"]),
        len(sorted_hws),
        off_strings,
        off_offsets,
        off_entries,
        off_hw_dir,
        off_hw_blocks,
        off_wf_dir,
        off_wf_blocks,
        off_inv_dir,
        off_inv_blocks,
    )
    assert len(header) == header_size

    with open(bin_path, "wb") as f:
        f.write(header)
        f.write(strings_blob)
        f.write(offsets_blob)
        f.write(entries_blob)
        f.write(hw_dir_blob)
        f.write(hw_blocks_blob)
        f.write(wf_dir_blob)
        f.write(wf_blocks_blob)
        f.write(inv_dir_blob)
        f.write(inv_blocks_blob)

    return {
        "name": "Architecture C: Compact Binary (.lxcbin front-coded + string pools + varint postings)",
        "path": str(bin_path),
        "bytes": bin_path.stat().st_size,
        "section_bytes": {
            "header": header_size,
            "string_pools": len(strings_blob),
            "entry_offsets": len(offsets_blob),
            "entries_blob": len(entries_blob),
            "headword_dir": len(hw_dir_blob),
            "headword_blocks": len(hw_blocks_blob),
            "wordform_dir": len(wf_dir_blob),
            "wordform_blocks": len(wf_blocks_blob),
            "inverted_idx_dir": len(inv_dir_blob),
            "inverted_idx_blocks": len(inv_blocks_blob),
        },
        "build_seconds": round(time.perf_counter() - t0, 3),
    }


def build_arch_d_layered(data: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    t0 = time.perf_counter()
    core_path = out_dir / "arch_d_core.db"
    ext_path = out_dir / "arch_d_extended.db"
    if core_path.exists():
        core_path.unlink()
    if ext_path.exists():
        ext_path.unlink()

    c_conn = sqlite3.connect(str(core_path))
    c_conn.executescript(
        """
        PRAGMA page_size = 16384;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = ON;

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
        CREATE TABLE parts_of_speech (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            headword_lower TEXT NOT NULL,
            headword TEXT,
            pos_id INTEGER NOT NULL REFERENCES parts_of_speech(id),
            primary_ipa TEXT,
            primary_definition TEXT NOT NULL,
            extra_senses_count INTEGER NOT NULL DEFAULT 0,
            source_id INTEGER NOT NULL REFERENCES sources(id)
        );
        CREATE TABLE word_forms (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            form_lower TEXT NOT NULL,
            form TEXT
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
    for k, v in data["metadata"].items():
        val = "0.3.0-core" if k == "pack_version" else v
        c_conn.execute("INSERT INTO metadata (key, value) VALUES (?, ?);", (k, val))
    for s in data["sources"]:
        c_conn.execute(
            "INSERT INTO sources (id, code, name, license, attribution_text, source_url, dataset_version) VALUES (?, ?, ?, ?, ?, ?, ?);",
            (s["id"], s["code"], s["name"], s["license"], s["attribution_text"], s["source_url"], s["dataset_version"]),
        )
    pos_ids: dict[str, int] = {}
    for name in sorted({e["pos"] for e in data["entries"]}):
        cur = c_conn.execute("INSERT INTO parts_of_speech (name) VALUES (?);", (name,))
        pos_ids[name] = cur.lastrowid

    for e in data["entries"]:
        eid = e["id"]
        senses = data["senses_by_entry"][eid]
        primary_def = senses[0]["definition"] if senses else ""
        extra_cnt = max(0, len(senses) - 1)
        hw_opt = None if e["headword"] == e["headword_lower"] else e["headword"]
        c_conn.execute(
            "INSERT INTO entries (id, headword_lower, headword, pos_id, primary_ipa, primary_definition, extra_senses_count, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            (eid, e["headword_lower"], hw_opt, pos_ids[e["pos"]], e["primary_ipa"], primary_def, extra_cnt, e["source_id"]),
        )
        for wf in data["forms_by_entry"][eid]:
            f_opt = None if wf["form"] == wf["form_lower"] else wf["form"]
            c_conn.execute(
                "INSERT INTO word_forms (entry_id, form_lower, form) VALUES (?, ?, ?);",
                (eid, wf["form_lower"], f_opt),
            )
        c_conn.execute(
            "INSERT INTO entries_fts (rowid, headword, primary_definition) VALUES (?, ?, ?);",
            (eid, e["headword"], primary_def),
        )

    c_conn.executescript(
        """
        CREATE INDEX idx_core_entries_hw_lower ON entries(headword_lower);
        CREATE INDEX idx_core_wf_lower ON word_forms(form_lower);
        CREATE INDEX idx_core_wf_entry_id ON word_forms(entry_id);
        ANALYZE;
        VACUUM;
        """
    )
    c_conn.close()

    e_conn = sqlite3.connect(str(ext_path))
    e_conn.executescript(
        """
        PRAGMA page_size = 16384;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = ON;

        CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE tag_sets (id INTEGER PRIMARY KEY, tags_json TEXT NOT NULL);
        CREATE TABLE pronunciations (id INTEGER PRIMARY KEY, all_ipas TEXT NOT NULL);
        CREATE TABLE etymologies (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
        CREATE TABLE audio_files (id INTEGER PRIMARY KEY, filename TEXT NOT NULL);
        CREATE TABLE entry_extensions (
            entry_id INTEGER PRIMARY KEY,
            pronunciation_id INTEGER REFERENCES pronunciations(id),
            audio_id INTEGER REFERENCES audio_files(id),
            etymology_id INTEGER REFERENCES etymologies(id)
        );
        CREATE TABLE senses_ext (
            id INTEGER PRIMARY KEY,
            entry_id INTEGER NOT NULL,
            sense_number INTEGER NOT NULL,
            definition TEXT,
            tags_id INTEGER REFERENCES tag_sets(id),
            examples TEXT,
            synonyms TEXT,
            antonyms TEXT
        );
        CREATE TABLE word_form_tags (
            form_index INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tags_id INTEGER NOT NULL REFERENCES tag_sets(id),
            PRIMARY KEY (entry_id, form_index)
        ) WITHOUT ROWID;
        """
    )
    e_conn.execute("INSERT INTO metadata (key, value) VALUES ('pack_version', '0.3.0-extended');")
    e_conn.execute("INSERT INTO metadata (key, value) VALUES ('core_compatible_version', '0.3.0-core');")

    tag_ids: dict[str, int] = {}
    pron_ids: dict[str, int] = {}
    etym_ids: dict[str, int] = {}
    audio_ids: dict[str, int] = {}

    def intern_e(table: str, col: str, cache: dict[str, int], val: str | None) -> int | None:
        if val is None:
            return None
        hit = cache.get(val)
        if hit is not None:
            return hit
        cur = e_conn.execute(f"INSERT INTO {table} ({col}) VALUES (?);", (val,))
        cache[val] = cur.lastrowid
        return cur.lastrowid

    for e in data["entries"]:
        eid = e["id"]
        pr_id = intern_e("pronunciations", "all_ipas", pron_ids, e["all_ipas"])
        au_id = intern_e("audio_files", "filename", audio_ids, e["audio_file"])
        et_id = intern_e("etymologies", "text", etym_ids, e["etymology"])
        if pr_id or au_id or et_id:
            e_conn.execute(
                "INSERT INTO entry_extensions (entry_id, pronunciation_id, audio_id, etymology_id) VALUES (?, ?, ?, ?);",
                (eid, pr_id, au_id, et_id),
            )
        for s in data["senses_by_entry"][eid]:
            t_id = intern_e("tag_sets", "tags_json", tag_ids, s["tags"])
            def_opt = None if s["sense_number"] == 1 else s["definition"]
            if def_opt is not None or t_id is not None or s["examples"] or s["synonyms"] or s["antonyms"]:
                e_conn.execute(
                    "INSERT INTO senses_ext (entry_id, sense_number, definition, tags_id, examples, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (eid, s["sense_number"], def_opt, t_id, s["examples"], s["synonyms"], s["antonyms"]),
                )
        for idx, wf in enumerate(data["forms_by_entry"][eid]):
            ft_id = intern_e("tag_sets", "tags_json", tag_ids, wf["tags"])
            if ft_id is not None:
                e_conn.execute(
                    "INSERT INTO word_form_tags (entry_id, form_index, tags_id) VALUES (?, ?, ?);",
                    (eid, idx, ft_id),
                )

    e_conn.executescript(
        """
        CREATE INDEX idx_senses_ext_entry ON senses_ext(entry_id, sense_number);
        ANALYZE;
        VACUUM;
        """
    )
    e_conn.close()

    return {
        "name": "Architecture D: Layered Core + Extended SQLite Packs",
        "core_path": str(core_path),
        "core_bytes": core_path.stat().st_size,
        "extended_path": str(ext_path),
        "extended_bytes": ext_path.stat().st_size,
        "combined_bytes": core_path.stat().st_size + ext_path.stat().st_size,
        "build_seconds": round(time.perf_counter() - t0, 3),
    }


def main() -> None:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    print("Loading canonical 75,000-entry English dataset from v0.3.0...")
    t0 = time.perf_counter()
    data = load_canonical_dataset(SRC_DB)
    print(f"Loaded {len(data['entries'])} entries in {time.perf_counter() - t0:.2f}s")

    manifest = {
        "source_db": str(SRC_DB),
        "source_bytes": SRC_DB.stat().st_size,
        "arch_a1": build_arch_a1_sqlite_v3(data, OUT_ROOT),
        "arch_b": build_arch_b_shards(data, OUT_ROOT),
        "arch_c": build_arch_c_binary(data, OUT_ROOT),
        "arch_d": build_arch_d_layered(data, OUT_ROOT),
    }
    (OUT_ROOT / "prototypes_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
