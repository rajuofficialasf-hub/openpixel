#!/usr/bin/env bash
# Stage the pinned libpdfium into the Tauri bundle resources dir
# (Phase 8 libpdfium distribution).
#
# The desktop app ships libpdfium as a Tauri `bundle.resources`
# entry, so an installed app renders PDFs with no manual fetching.
# This script fetches the library first (via fetch-pdfium.sh, which
# verifies the pinned sha256 on Linux) when it is not already in
# target/pdfium/, then copies the platform library into
# apps/desktop/src-tauri/resources/ — the dir tauri.conf.json
# bundles with `"resources": ["resources/*"]`.
#
# The staged file is NEVER committed: it is a fetched binary, and
# apps/desktop/src-tauri/resources/libpdfium.* is gitignored. CI
# runs this script before `npm run tauri build` on every OS; local
# builds must run it too (or the bundle ships without the library
# and PDF render / text extraction fail honestly at runtime).
#
# Usage:
#   scripts/pdfium/stage-for-tauri.sh
# Output:
#   apps/desktop/src-tauri/resources/libpdfium.so   (Linux)
#   apps/desktop/src-tauri/resources/libpdfium.dylib (macOS)
#   apps/desktop/src-tauri/resources/pdfium.dll      (Windows)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$REPO_ROOT/scripts/pdfium/fetch-pdfium.sh"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
    Linux-x86_64)  LIB="libpdfium.so" ;;
    Darwin-x86_64|Darwin-arm64) LIB="libpdfium.dylib" ;;
    MINGW64_NT-*-x86_64|MSYS_NT-*-x86_64|CYGWIN_NT-*-x86_64) LIB="pdfium.dll" ;;
    *) echo "error: unsupported platform '$OS-$ARCH' for Tauri staging (see fetch-pdfium.sh)." >&2; exit 1 ;;
esac

SRC="$REPO_ROOT/target/pdfium/$LIB"
DEST_DIR="$REPO_ROOT/apps/desktop/src-tauri/resources"
if [ ! -f "$SRC" ]; then
    echo "error: $SRC missing after fetch — fetch-pdfium.sh did not produce it." >&2
    exit 1
fi
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST_DIR/$LIB"
echo "staged libpdfium for Tauri: $DEST_DIR/$LIB ($(stat -c%s "$DEST_DIR/$LIB" 2>/dev/null || stat -f%z "$DEST_DIR/$LIB") bytes)"
echo "tauri.conf.json bundles it as a resource; the resolver finds it via the Tauri resource dir (see docs/PDF.md)."
