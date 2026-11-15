#!/usr/bin/env bash
# Phase 6 benchmark runner: builds the release binary, runs
# `openpixel bench`, and prints the hardware the numbers were
# measured on. Usage: scripts/test/bench.sh [--iterations N]
# (default 3). Results are printed to stdout — copy the table into
# docs/BENCHMARKS.md with the date; the script appends nothing
# itself, so no stale numbers can be mistaken for fresh ones.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.cargo/bin:$PATH"

ITERATIONS="${1:-3}"
if [[ "${1:-}" == "--iterations" ]]; then
    ITERATIONS="${2:-3}"
fi

echo "== hardware =="
grep -m1 "model name" /proc/cpuinfo
echo "cpus: $(nproc)"
free -h | head -2
echo "rustc: $(rustc --version)"
echo "build: release (opt-level 3, thin LTO, codegen-units 1 — see Cargo.toml)"
echo

echo "== build =="
cargo build --release -q
echo

echo "== bench ($ITERATIONS iterations) =="
./target/release/openpixel bench --iterations "$ITERATIONS"
