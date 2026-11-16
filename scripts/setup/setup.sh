#!/usr/bin/env bash
# Phase 3: Rust itself, plus the dav1d build tools (meson, ninja,
# nasm — dav1d is built from source and statically linked, for
# AVIF decode). On Ubuntu 24.04 run the platform script:
#   sudo ./scripts/setup/ubuntu-24.04.sh
# It is safe to re-run. See docs/CODECS.md for why nothing else
# (notably libheif-dev) is installed.
set -euo pipefail
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust not found. Install from https://rustup.rs, then re-run."
  exit 1
fi
echo "Rust: $(rustc --version)"
if pkg-config --exists dav1d 2>/dev/null; then
  echo "dav1d: $(pkg-config --modversion dav1d) (AVIF decode OK)"
else
  echo "dav1d NOT found — AVIF decode will not build."
  echo "On Ubuntu 24.04: sudo ./scripts/setup/ubuntu-24.04.sh"
fi
