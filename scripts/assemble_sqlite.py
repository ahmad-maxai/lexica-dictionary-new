#!/usr/bin/env python3
"""
Builds verified, indexed, FTS5-enabled SQLite databases for Lexica:
  1. public/assets/databases/lexica_coreSQLite.db (bundled inside APK & web app)
  2. packs/lexica_pack_<lang>.sqlite.gz (standalone downloadable full language packs)
  3. packs/manifest.json + src/data/packManifest.ts
"""
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import time

SCHEMA_VERSION = 1

SCHEMA_STATEMENTS = [
    "PRAGMA foreign_keys = OFF;",
    """CREATE TABLE IF NOT EXISTS languages (
      code TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      native_name TEXT NOT NULL,
      native_script TEXT NOT NULL,
      script_name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('ltr', 'rtl')),
      speakers_count TEXT NOT NULL,
      accent_color TEXT NOT NULL
    );""",
    """CREATE TABLE IF NOT EXISTS dataset_sources (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      license TEXT NOT NULL,
      attribution_text TEXT NOT NULL,
      source_url TEXT,
      dataset_version TEXT NOT NULL
    );""",
    """CREATE TABLE IF NOT EXISTS language_packs (
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
    );""",
    """CREATE TABLE IF NOT EXISTS entries (
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
    );""",
    """CREATE TABLE IF NOT EXISTS senses (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      sense_number INTEGER NOT NULL,
      part_of_speech TEXT NOT NULL,
      definition TEXT NOT NULL,
      definition_en TEXT,
      register TEXT,
      usage_note TEXT,
      UNIQUE(entry_id, sense_number)
    );""",
    """CREATE TABLE IF NOT EXISTS examples (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      sense_id TEXT REFERENCES senses(id) ON DELETE CASCADE,
      source_text TEXT NOT NULL,
      target_text TEXT NOT NULL,
      literal_translation TEXT,
      cultural_context TEXT
    );""",
    """CREATE TABLE IF NOT EXISTS pronunciations (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      dialect TEXT,
      ipa TEXT NOT NULL,
      phonetic_text TEXT,
      tone_pattern TEXT,
      audio_asset_ref TEXT
    );""",
    """CREATE TABLE IF NOT EXISTS word_forms (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      form TEXT NOT NULL,
      form_norm_soft TEXT NOT NULL,
      form_norm_deep TEXT NOT NULL,
      grammatical_label TEXT NOT NULL,
      note TEXT
    );""",
    """CREATE TABLE IF NOT EXISTS lexical_relations (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      sense_id TEXT REFERENCES senses(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('synonym', 'antonym', 'related')),
      related_term TEXT NOT NULL,
      related_term_norm TEXT NOT NULL,
      target_entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL
    );""",
    """CREATE TABLE IF NOT EXISTS translation_links (
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
    );""",
    """CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
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
    );""",
]

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_entries_lang_headword ON entries(source_lang, headword);",
    "CREATE INDEX IF NOT EXISTS idx_entries_lang_soft ON entries(source_lang, headword_norm_soft);",
    "CREATE INDEX IF NOT EXISTS idx_entries_lang_deep ON entries(source_lang, headword_norm_deep);",
    "CREATE INDEX IF NOT EXISTS idx_entries_lang_vfold ON entries(source_lang, headword_vowel_fold);",
    "CREATE INDEX IF NOT EXISTS idx_entries_pinyin ON entries(source_lang, audio_phonetic_norm);",
    "CREATE INDEX IF NOT EXISTS idx_entries_root ON entries(source_lang, root_word_norm);",
    "CREATE INDEX IF NOT EXISTS idx_senses_entry ON senses(entry_id, sense_number);",
    "CREATE INDEX IF NOT EXISTS idx_forms_norm ON word_forms(form_norm_soft, form_norm_deep);",
    "CREATE INDEX IF NOT EXISTS idx_forms_entry ON word_forms(entry_id);",
    "CREATE INDEX IF NOT EXISTS idx_lexrel_entry ON lexical_relations(entry_id, relation_type);",
    "CREATE INDEX IF NOT EXISTS idx_lexrel_term ON lexical_relations(related_term_norm);",
    "CREATE INDEX IF NOT EXISTS idx_trans_src_pair ON translation_links(source_entry_id, target_lang);",
    "CREATE INDEX IF NOT EXISTS idx_trans_pair_target ON translation_links(source_lang, target_lang, target_headword_norm_soft);",
    "CREATE INDEX IF NOT EXISTS idx_trans_rev_lookup ON translation_links(target_lang, source_lang, target_headword_norm_soft);",
]


def init_db(db_path: str, languages: list, sources: list) -> sqlite3.Connection:
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -64000;")
    for stmt in SCHEMA_STATEMENTS:
        conn.execute(stmt)
    conn.executemany(
        """INSERT INTO languages(code, name, native_name, native_script, script_name, direction, speakers_count, accent_color)
           VALUES (:code, :name, :native_name, :native_script, :script_name, :direction, :speakers_count, :accent_color);""",
        languages,
    )
    conn.executemany(
        """INSERT INTO dataset_sources(id, name, license, attribution_text, source_url, dataset_version)
           VALUES (:id, :name, :license, :attribution_text, :source_url, :dataset_version);""",
        sources,
    )
    return conn


def insert_entries_ndjson(conn: sqlite3.Connection, ndjson_path: str, pack_id_map: dict, version: str):
    now_ms = int(time.time() * 1000)
    langs_seen = set()
    # Pre-seed placeholder language_packs rows (counts updated at end)
    for lang_code, (pack_id, tier, db_name) in pack_id_map.items():
        langs_seen.add(lang_code)
        conn.execute(
            """INSERT OR IGNORE INTO language_packs(
              pack_id, lang_code, tier, pack_version, schema_version, install_state,
              db_file_name, size_bytes, compressed_size_bytes, entry_count, sense_count, translation_count,
              installed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'installed', ?, 0, 0, 0, 0, 0, ?, ?);""",
            (pack_id, lang_code, tier, version, SCHEMA_VERSION, db_name, now_ms, now_ms),
        )

    entry_rows = []
    sense_rows = []
    example_rows = []
    pron_rows = []
    form_rows = []
    lexrel_rows = []
    trans_rows = []
    fts_rows = []

    def flush():
        def clean_val(v):
            if isinstance(v, str):
                return v.encode("utf-8", "replace").decode("utf-8")
            return v

        def clean_rows(rows):
            return [tuple(clean_val(x) for x in r) for r in rows]

        if entry_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO entries(
                  id, source_lang, headword, headword_norm_soft, headword_norm_deep, headword_vowel_fold,
                  headword_script_variant, headword_script_label, part_of_speech, gender_or_class, dialect,
                  register, etymology, root_word, root_word_norm, tone_pattern, cultural_note, primary_ipa,
                  audio_phonetic_text, audio_phonetic_norm, pack_id, source_id, verification_status
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);""",
                clean_rows(entry_rows),
            )
            entry_rows.clear()
        if sense_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO senses(
                  id, entry_id, sense_number, part_of_speech, definition, definition_en, register, usage_note
                ) VALUES (?,?,?,?,?,?,?,?);""",
                clean_rows(sense_rows),
            )
            sense_rows.clear()
        if example_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO examples(
                  id, entry_id, sense_id, source_text, target_text, literal_translation, cultural_context
                ) VALUES (?,?,?,?,?,?,?);""",
                clean_rows(example_rows),
            )
            example_rows.clear()
        if pron_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO pronunciations(
                  id, entry_id, dialect, ipa, phonetic_text, tone_pattern, audio_asset_ref
                ) VALUES (?,?,?,?,?,?,?);""",
                clean_rows(pron_rows),
            )
            pron_rows.clear()
        if form_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO word_forms(
                  id, entry_id, form, form_norm_soft, form_norm_deep, grammatical_label, note
                ) VALUES (?,?,?,?,?,?,?);""",
                clean_rows(form_rows),
            )
            form_rows.clear()
        if lexrel_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO lexical_relations(
                  id, entry_id, sense_id, relation_type, related_term, related_term_norm, target_entry_id
                ) VALUES (?,?,?,?,?,?,?);""",
                clean_rows(lexrel_rows),
            )
            lexrel_rows.clear()
        if trans_rows:
            conn.executemany(
                """INSERT OR IGNORE INTO translation_links(
                  id, source_entry_id, source_sense_id, source_lang, target_lang, target_entry_id, target_sense_id,
                  target_headword, target_headword_norm_soft, target_headword_norm_deep,
                  target_transliteration, target_transliteration_norm, target_script_variant,
                  target_part_of_speech, target_definition, equivalence_type, contextual_note, register, source_id
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);""",
                clean_rows(trans_rows),
            )
            trans_rows.clear()
        if fts_rows:
            conn.executemany(
                """INSERT INTO entries_fts(
                  entry_id, source_lang, headword, headword_norm_soft, headword_norm_deep,
                  audio_phonetic_norm, forms_text, synonyms_text, definitions_text
                ) VALUES (?,?,?,?,?,?,?,?,?);""",
                clean_rows(fts_rows),
            )
            fts_rows.clear()

    with open(ndjson_path, "r", encoding="utf-8", errors="replace") as fh:
        for idx, line in enumerate(fh):
            if not line.strip():
                continue
            item = json.loads(line)
            lang = item["source_lang"]
            pack_id = pack_id_map[lang][0]
            eid = item["id"]

            entry_rows.append((
                eid,
                lang,
                item["headword"],
                item["headword_norm_soft"],
                item["headword_norm_deep"],
                item["headword_vowel_fold"],
                item.get("headword_script_variant"),
                item.get("headword_script_label"),
                item["part_of_speech"],
                item.get("gender_or_class"),
                item.get("dialect"),
                item.get("register"),
                item.get("etymology"),
                item.get("root_word"),
                item.get("root_word_norm"),
                item.get("tone_pattern"),
                item.get("cultural_note"),
                item.get("primary_ipa", ""),
                item.get("audio_phonetic_text"),
                item.get("audio_phonetic_norm", ""),
                pack_id,
                item["source_id"],
                item.get("verification_status", "verified"),
            ))

            def_texts = []
            for s in item.get("senses", []):
                sense_rows.append((
                    s["id"],
                    eid,
                    s["sense_number"],
                    s["part_of_speech"],
                    s["definition"],
                    s.get("definition_en"),
                    s.get("register"),
                    s.get("usage_note"),
                ))
                def_texts.append(s["definition"])
                if s.get("definition_en") and s["definition_en"] != s["definition"]:
                    def_texts.append(s["definition_en"])

            for ex in item.get("examples", []):
                example_rows.append((
                    ex["id"],
                    eid,
                    ex.get("sense_id"),
                    ex["source_text"],
                    ex["target_text"],
                    ex.get("literal_translation"),
                    ex.get("cultural_context"),
                ))

            if item.get("primary_ipa"):
                pron_rows.append((
                    f"{eid}#p1",
                    eid,
                    item.get("dialect"),
                    item["primary_ipa"],
                    item.get("audio_phonetic_text"),
                    item.get("tone_pattern"),
                    None,
                ))

            form_texts = []
            if item.get("headword_script_variant"):
                form_texts.append(item["headword_script_variant"])
            for wf in item.get("word_forms", []):
                form_rows.append((
                    wf["id"],
                    eid,
                    wf["form"],
                    wf["form_norm_soft"],
                    wf["form_norm_deep"],
                    wf["grammatical_label"],
                    wf.get("note"),
                ))
                form_texts.append(wf["form"])
                form_texts.append(wf["form_norm_soft"])

            syn_texts = []
            for lr in item.get("lexical_relations", []):
                lexrel_rows.append((
                    lr["id"],
                    eid,
                    lr.get("sense_id"),
                    lr["relation_type"],
                    lr["related_term"],
                    lr["related_term_norm"],
                    None,
                ))
                if lr["relation_type"] in ("synonym", "related"):
                    syn_texts.append(lr["related_term"])

            for tr in item.get("translation_links", []):
                trans_rows.append((
                    tr["id"],
                    eid,
                    tr["source_sense_id"],
                    lang,
                    tr["target_lang"],
                    tr.get("target_entry_id"),
                    tr.get("target_sense_id"),
                    tr["target_headword"],
                    tr["target_headword_norm_soft"],
                    tr["target_headword_norm_deep"],
                    tr.get("target_transliteration"),
                    tr.get("target_transliteration_norm", ""),
                    tr.get("target_script_variant"),
                    tr["target_part_of_speech"],
                    tr["target_definition"],
                    tr["equivalence_type"],
                    tr.get("contextual_note"),
                    tr.get("register"),
                    tr.get("source_id", item["source_id"]),
                ))

            fts_rows.append((
                eid,
                lang,
                item["headword"],
                item["headword_norm_soft"],
                item["headword_norm_deep"],
                item.get("audio_phonetic_norm", ""),
                " ".join(form_texts),
                " ".join(syn_texts),
                " ".join(def_texts),
            ))

            if len(entry_rows) >= 2000:
                flush()

    flush()


def finalize_db(conn: sqlite3.Connection, db_path: str, pack_id_map: dict):
    # Remove any child rows whose parent entry/sense was deduplicated away by INSERT OR IGNORE
    conn.execute("DELETE FROM senses WHERE entry_id NOT IN (SELECT id FROM entries);")
    conn.execute("DELETE FROM examples WHERE entry_id NOT IN (SELECT id FROM entries);")
    conn.execute("DELETE FROM pronunciations WHERE entry_id NOT IN (SELECT id FROM entries);")
    conn.execute("DELETE FROM word_forms WHERE entry_id NOT IN (SELECT id FROM entries);")
    conn.execute("DELETE FROM lexical_relations WHERE entry_id NOT IN (SELECT id FROM entries);")
    conn.execute(
        """DELETE FROM translation_links
           WHERE source_entry_id NOT IN (SELECT id FROM entries)
              OR source_sense_id NOT IN (SELECT id FROM senses);"""
    )
    conn.execute("DELETE FROM entries_fts WHERE entry_id NOT IN (SELECT id FROM entries);")

    # Nullify target_entry_id / target_sense_id where referenced row does not live inside this DB
    conn.execute(
        """UPDATE translation_links
           SET target_entry_id = NULL, target_sense_id = NULL
           WHERE target_entry_id IS NOT NULL
             AND target_entry_id NOT IN (SELECT id FROM entries);"""
    )
    conn.execute(
        """UPDATE translation_links
           SET target_sense_id = NULL
           WHERE target_sense_id IS NOT NULL
             AND target_sense_id NOT IN (SELECT id FROM senses);"""
    )

    for stmt in INDEX_STATEMENTS:
        conn.execute(stmt)

    for lang_code, (pack_id, _, _) in pack_id_map.items():
        ec = conn.execute("SELECT COUNT(*) FROM entries WHERE source_lang = ?;", (lang_code,)).fetchone()[0]
        sc = conn.execute(
            "SELECT COUNT(*) FROM senses s JOIN entries e ON e.id = s.entry_id WHERE e.source_lang = ?;",
            (lang_code,),
        ).fetchone()[0]
        tc = conn.execute(
            "SELECT COUNT(*) FROM translation_links WHERE source_lang = ?;",
            (lang_code,),
        ).fetchone()[0]
        conn.execute(
            """UPDATE language_packs
               SET entry_count = ?, sense_count = ?, translation_count = ?
               WHERE pack_id = ?;""",
            (ec, sc, tc, pack_id),
        )

    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON;")
    fk_errors = conn.execute("PRAGMA foreign_key_check;").fetchall()
    if fk_errors:
        raise RuntimeError(f"Foreign key violations in {db_path}: {fk_errors[:5]}")
    conn.execute("ANALYZE;")
    conn.execute("VACUUM;")
    qc = conn.execute("PRAGMA quick_check;").fetchone()[0]
    if str(qc).lower() != "ok":
        raise RuntimeError(f"SQLite quick_check failed for {db_path}: {qc}")
    conn.close()

    size_bytes = os.path.getsize(db_path)
    # Write accurate size_bytes into language_packs cleanly
    conn2 = sqlite3.connect(db_path)
    conn2.execute("UPDATE language_packs SET size_bytes = ?;", (size_bytes,))
    conn2.commit()
    conn2.close()
    return size_bytes


def main():
    meta_path = sys.argv[1]
    with open(meta_path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)

    version = meta["version"]
    languages = meta["languages"]
    sources = meta["sources"]
    core_ndjson = meta["core_ndjson"]
    core_db_out = meta["core_db_out"]
    pack_specs = meta["packs"]  # list of {lang, ndjson, db_out, gz_out}

    os.makedirs(os.path.dirname(core_db_out), exist_ok=True)
    core_pack_map = {
        lang["code"]: (f"core-{lang['code']}", "core_starter", "lexica_coreSQLite.db")
        for lang in languages
    }

    print(f"[assemble_sqlite] Building core DB: {core_db_out}")
    core_conn = init_db(core_db_out, languages, sources)
    insert_entries_ndjson(core_conn, core_ndjson, core_pack_map, version)
    core_size = finalize_db(core_conn, core_db_out, core_pack_map)

    # Read per-language stats from core
    core_ro = sqlite3.connect(core_db_out)
    core_stats = {}
    for row in core_ro.execute(
        "SELECT lang_code, entry_count, sense_count, translation_count FROM language_packs;"
    ):
        core_stats[row[0]] = {
            "entryCount": row[1],
            "senseCount": row[2],
            "translationCount": row[3],
        }
    core_ro.close()
    print(f"[assemble_sqlite] Core DB ready: {core_size / (1024*1024):.2f} MB ({core_size} bytes)")

    manifest_packs = []
    for spec in pack_specs:
        lang = spec["lang"]
        pack_db = spec["db_out"]
        pack_gz = spec["gz_out"]
        os.makedirs(os.path.dirname(pack_gz), exist_ok=True)

        pack_map = {
            lang: (f"pack-{lang}-v{version}", "full_pack", f"lexica_pack_{lang}SQLite.db")
        }
        print(f"[assemble_sqlite] Building full pack [{lang}]: {pack_gz}")
        pconn = init_db(pack_db, languages, sources)
        insert_entries_ndjson(pconn, spec["ndjson"], pack_map, version)
        uncompressed_size = finalize_db(pconn, pack_db, pack_map)

        with open(pack_db, "rb") as src_f, open(pack_gz, "wb") as gz_raw:
            with gzip.GzipFile(fileobj=gz_raw, mode="wb", mtime=0, compresslevel=9) as gz_f:
                shutil.copyfileobj(src_f, gz_f)

        with open(pack_gz, "rb") as f_gz:
            gz_bytes = f_gz.read()
        sha256 = hashlib.sha256(gz_bytes).hexdigest()
        compressed_size = len(gz_bytes)

        ro = sqlite3.connect(pack_db)
        row = ro.execute(
            "SELECT entry_count, sense_count, translation_count FROM language_packs WHERE lang_code = ?;",
            (lang,),
        ).fetchone()
        # Distinct sources referenced by this pack
        src_objs = [
            {"name": r[0], "license": r[1], **({"url": r[2]} if r[2] else {})}
            for r in ro.execute(
                "SELECT DISTINCT ds.name, ds.license, ds.source_url FROM dataset_sources ds JOIN entries e ON e.source_id = ds.id WHERE e.source_lang = ?;",
                (lang,),
            ).fetchall()
        ]
        ro.close()

        # Remove uncompressed pack .db (keep only .sqlite.gz in packs/)
        os.remove(pack_db)

        item = {
            "packId": f"pack-{lang}-v{version}",
            "langCode": lang,
            "version": version,
            "schemaVersion": SCHEMA_VERSION,
            "tier": "full_pack",
            "dbFileName": f"lexica_pack_{lang}SQLite.db",
            "compressedFileName": f"lexica_pack_{lang}.sqlite.gz",
            "entryCount": int(row[0]),
            "senseCount": int(row[1]),
            "translationCount": int(row[2]),
            "sizeBytes": int(uncompressed_size),
            "compressedSizeBytes": int(compressed_size),
            "sha256Checksum": sha256,
            "fileName": f"lexica_pack_{lang}.sqlite.gz",
            "sources": src_objs,
        }
        manifest_packs.append(item)
        print(
            f"  -> [{lang}] entries={item['entryCount']} senses={item['senseCount']} trans={item['translationCount']} "
            f"raw={uncompressed_size/(1024*1024):.2f}MB gz={compressed_size/1024:.1f}KB sha={sha256[:12]}"
        )

    summary = {
        "version": version,
        "schemaVersion": SCHEMA_VERSION,
        "coreSizeBytes": core_size,
        "coreStats": core_stats,
        "packs": manifest_packs,
    }
    summary_path = meta["summary_out"]
    with open(summary_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)


if __name__ == "__main__":
    main()
