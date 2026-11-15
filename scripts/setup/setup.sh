#!/usr/bin/env bash
# Phase 1: nothing to install beyond Rust itself.
# Native codecs (Phase 3) will add per-platform setup here.
set -euo pipefail
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust not found. Install from https://rustup.rs, then re-run."
  exit 1
fi
echo "Rust: $(rustc --version)"
echo "Phase 1 needs no system image libraries."
