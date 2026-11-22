# LEXICA — Assignment 007: Dictionary Compression & Architecture Benchmark

**Repository:** `https://github.com/ahmad-maxai/lexica-dictionary-new`  
**Branch:** `feature/assignment-007-dictionary-benchmark`  

---

## Overview

This directory contains the complete research, prototyping scripts, benchmark results, and architectural documentation for **LEXICA Assignment 007** (Dictionary Compression & Architecture Benchmark).

### Documentation Index

1. [Baseline Audit](BASELINE_AUDIT.md) — Comprehensive storage audit of the 75,000-entry English dictionary (`v0.3.0` SQLite v2 baseline), analyzing page structures, B-tree amplification, and index bloat drivers.
2. [Architecture Comparison](ARCHITECTURE_COMPARISON.md) — Rigorous comparative analysis across 4 architectures: Optimized SQLite (A1), Sharded JSONL (B), Custom Binary `.lxcbin` (C), and Layered SQLite (D).
3. [Compression Benchmark](COMPRESSION_BENCHMARK.md) — Cross-algorithm compression benchmark evaluating GZIP, Zstandard, Brotli, and LZMA, including decompression CPU and peak memory costs on mobile hardware.
4. [Performance Benchmark](PERFORMANCE_BENCHMARK.md) — Cold-start and warm prefix search latency, FTS5 full-text query latency, and RAM footprints.
5. [Multilingual Compatibility](MULTILINGUAL_COMPATIBILITY.md) — Linguistic and structural evaluation across all 7 Lexica languages: English (`en`), Hausa (`ha`), Yoruba (`yo`), Fulfulde (`ff`), Arabic (`ar`), French (`fr`), and Chinese (`zh`).
6. [Dataset Licensing & Provenance](DATASET_LICENSING.md) — Provenance tracking, CC BY-SA 4.0 and GFDL compliance, and offline redistribution guidelines.
7. [Final Recommendation](FINAL_RECOMMENDATION.md) — Definitive production recommendation: **Architecture D (Layered Core + Extended SQLite Packs)**.
8. [Benchmark Results JSON](benchmark-results.json) — Structured, machine-readable metrics from all benchmark runs.

### Companion Code & Scripts

All benchmark harnesses and prototype generators are preserved in `scripts/assignment_007/`:
- `scripts/assignment_007/baseline_audit.py`
- `scripts/assignment_007/build_prototypes.py`
- `scripts/assignment_007/compression_benchmark.py`
- `scripts/assignment_007/performance_and_integrity_benchmark.py`
