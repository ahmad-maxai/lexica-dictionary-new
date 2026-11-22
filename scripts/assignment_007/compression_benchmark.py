#!/usr/bin/env python3
"""
Assignment 007 — Phase 3: Real Compression & Extraction Benchmark
Measures uncompressed, GZIP (-6), Zstandard (Node v22 zlib), Brotli (Node v22 zlib q=5),
and LZMA (on D-Core to demonstrate mobile CPU/memory trade-offs) across all architectures.
"""

from __future__ import annotations

import gc
import gzip
import io
import json
import lzma
import subprocess
import tarfile
import time
import tracemalloc
from pathlib import Path
from typing import Any

ROOT = Path("/tmp/lexica_a007")
OUT_JSON = ROOT / "compression_results.json"


def tar_subpaths_bytes(dir_path: Path, subdirs: list[str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for sub in subdirs:
            for p in sorted((dir_path / sub).rglob("*")):
                if p.is_file():
                    tf.add(p, arcname=str(p.relative_to(dir_path)))
    return buf.getvalue()


def node_compress(raw_bytes: bytes, algo: str) -> tuple[int, float, float]:
    """Use Node v22 built-in zlib for zstd and brotli."""
    script = r"""
const zlib = require('zlib');
const fs = require('fs');
const algo = process.argv[1];
const data = fs.readFileSync(0);
const t0 = performance.now();
let comp;
if (algo === 'zstd') {
  comp = zlib.zstdCompressSync(data);
} else if (algo === 'brotli') {
  comp = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
} else {
  comp = zlib.gzipSync(data, { level: 6 });
}
const compMs = performance.now() - t0;
const t1 = performance.now();
if (algo === 'zstd') {
  zlib.zstdDecompressSync(comp);
} else if (algo === 'brotli') {
  zlib.brotliDecompressSync(comp);
} else {
  zlib.gunzipSync(comp);
}
const decompMs = performance.now() - t1;
process.stdout.write(JSON.stringify({ bytes: comp.length, comp_ms: compMs, decomp_ms: decompMs }));
"""
    res = subprocess.run(
        ["node", "-e", script, algo],
        input=raw_bytes,
        capture_output=True,
        check=True,
    )
    info = json.loads(res.stdout.decode("utf-8"))
    return int(info["bytes"]), round(info["comp_ms"] / 1000.0, 3), round(info["decomp_ms"] / 1000.0, 3)


def benchmark_payload(label: str, raw_bytes: bytes, include_lzma: bool = False) -> dict[str, Any]:
    raw_len = len(raw_bytes)

    # GZIP -6 (Python streaming)
    t0 = time.perf_counter()
    gz_buf = gzip.compress(raw_bytes, compresslevel=6)
    gz_comp_s = round(time.perf_counter() - t0, 3)

    tracemalloc.start()
    t1 = time.perf_counter()
    with gzip.GzipFile(fileobj=io.BytesIO(gz_buf), mode="rb") as gf:
        while gf.read(65536):
            pass
    gz_decomp_s = round(time.perf_counter() - t1, 3)
    gz_peak_kb = round(tracemalloc.get_traced_memory()[1] / 1024.0, 2)
    tracemalloc.stop()
    gz_len = len(gz_buf)
    del gz_buf

    # Zstd & Brotli via Node v22
    zstd_len, zstd_comp_s, zstd_decomp_s = node_compress(raw_bytes, "zstd")
    br_len, br_comp_s, br_decomp_s = node_compress(raw_bytes, "brotli")

    lzma_len = None
    lzma_comp_s = None
    lzma_decomp_s = None
    if include_lzma:
        t2 = time.perf_counter()
        lz_buf = lzma.compress(raw_bytes, preset=1)
        lzma_comp_s = round(time.perf_counter() - t2, 3)
        t3 = time.perf_counter()
        _ = lzma.decompress(lz_buf)
        lzma_decomp_s = round(time.perf_counter() - t3, 3)
        lzma_len = len(lz_buf)
        del lz_buf

    return {
        "label": label,
        "uncompressed_bytes": raw_len,
        "uncompressed_mib": round(raw_len / 1048576.0, 2),
        "gzip_6_bytes": gz_len,
        "gzip_6_mib": round(gz_len / 1048576.0, 2),
        "gzip_compress_s": gz_comp_s,
        "gzip_extract_s": gz_decomp_s,
        "gzip_extract_peak_kb": gz_peak_kb,
        "zstd_bytes": zstd_len,
        "zstd_mib": round(zstd_len / 1048576.0, 2),
        "zstd_compress_s": zstd_comp_s,
        "zstd_extract_s": zstd_decomp_s,
        "brotli_q5_bytes": br_len,
        "brotli_q5_mib": round(br_len / 1048576.0, 2),
        "brotli_compress_s": br_comp_s,
        "brotli_extract_s": br_decomp_s,
        "lzma_p1_bytes": lzma_len,
        "lzma_p1_mib": round(lzma_len / 1048576.0, 2) if lzma_len else None,
        "lzma_compress_s": lzma_comp_s,
        "lzma_extract_s": lzma_decomp_s,
    }


def main() -> None:
    specs = [
        ("a0_v020", "A0 Baseline SQLite v1 (v0.2.0)", lambda: Path("/tmp/lexica_en_v020.db").read_bytes(), False),
        ("a0_v030", "A0 Optimized SQLite v2 (v0.3.0)", lambda: Path("/tmp/lexica_english_v030.db").read_bytes(), False),
        ("a1_v3", "A1 Optimized SQLite v3", lambda: (ROOT / "arch_a1_sqlite_v3.db").read_bytes(), False),
        ("b_jsonl_tar", "B JSONL Shards + Indexes (tar)", lambda: tar_subpaths_bytes(ROOT / "arch_b_shards", ["jsonl", "indexes"]), False),
        ("c_lxcbin", "C Compact Binary (.lxcbin)", lambda: (ROOT / "arch_c_compact.lxcbin").read_bytes(), False),
        ("d_core", "D Layered Core SQLite", lambda: (ROOT / "arch_d_core.db").read_bytes(), True),
        ("d_extended", "D Layered Extended SQLite", lambda: (ROOT / "arch_d_extended.db").read_bytes(), False),
    ]
    results = {}
    for key, label, loader, do_lzma in specs:
        print(f"Benchmarking compression for {label}...", flush=True)
        raw = loader()
        results[key] = benchmark_payload(label, raw, include_lzma=do_lzma)
        del raw
        gc.collect()
        OUT_JSON.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
