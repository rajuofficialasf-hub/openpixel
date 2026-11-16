#!/bin/bash
# Fetch a PINNED prebuilt libpdfium into <repo>/target/pdfium/
# (a dev-convenience cache — build output, gitignored, never
# committed). The binary is loaded at runtime by `pdfium-render`
# (`Pdfium::bind_to_library`); nothing in this repo downloads it
# automatically, and no build links against it.
#
# Pinned release: bblanchon/pdfium-binaries, tag chromium/8152
# (PDFium 159.0.8152.0) — the release recorded in LICENSE_AUDIT.md.
# This script NEVER fetches "latest": a floating PDFium would
# change render output under us without a review.
#
# Usage:
#   scripts/pdfium/fetch-pdfium.sh [--force] [--dir DIR]
#   --force  re-download even when the library is already cached
#   --dir    destination directory (default: <repo>/target/pdfium)
#
# Verification: on Linux the downloaded archive's sha256 is checked
# against the value recorded in LICENSE_AUDIT.md and the script
# fails loudly on mismatch. The macOS/Windows archives have no
# recorded sha yet — the script prints the downloaded sha256 and
# asks the operator to record it in LICENSE_AUDIT.md before
# relying on it. (Download goes through the normal environment
# proxy, the same way cargo fetches crates.)
#
# How the library is used after fetching:
#   - `openpixel pdf render ...` finds it in ./target/pdfium
#     when run from the repo root (dev path), or
#   - set OPENPIXEL_PDFIUM_PATH to the library file, or
#   - place it next to the `openpixel` binary (release tarballs
#     ship it that way). See docs/PDF.md.
set -euo pipefail

TAG="chromium/8152"
LINUX_SHA256="384ab5c51882408a143a21f9c14dcd2caf1f75280ae41c554d0489b46c3dba9f"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$REPO_ROOT/target/pdfium"
FORCE=0

while [ $# -gt 0 ]; do
    case "$1" in
        --force) FORCE=1; shift ;;
        --dir) DEST="$2"; shift 2 ;;
        --dir=*) DEST="${1#--dir=}"; shift ;;
        -h|--help)
            echo "Usage: $0 [--force] [--dir DIR]"
            echo "Fetches pinned libpdfium (bblanchon/pdfium-binaries, tag $TAG) into DIR (default: <repo>/target/pdfium)."
            exit 0
            ;;
        *) echo "error: unknown argument '$1' (use --help)" >&2; exit 1 ;;
    esac
done

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS-$ARCH" in
    Linux-x86_64)  ASSET="pdfium-linux-x64.tgz"; LIB="libpdfium.so" ;;
    Darwin-x86_64) ASSET="pdfium-mac-x64.tgz";   LIB="libpdfium.dylib" ;;
    Darwin-arm64)  ASSET="pdfium-mac-arm64.tgz"; LIB="libpdfium.dylib" ;;
    MINGW64_NT-*-x86_64|MSYS_NT-*-x86_64|CYGWIN_NT-*-x86_64)
                   ASSET="pdfium-win-x64.tgz";   LIB="pdfium.dll" ;;
    *) echo "error: unsupported platform '$OS-$ARCH' — this script covers Linux x86_64, macOS x86_64/arm64 and Windows x86_64 only." >&2
       echo "For another platform, download the matching asset from https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F8152 manually and set OPENPIXEL_PDFIUM_PATH to the library." >&2
       exit 1 ;;
esac

mkdir -p "$DEST"
if [ "$FORCE" -eq 0 ] && [ -f "$DEST/$LIB" ]; then
    echo "libpdfium already cached at $DEST/$LIB (use --force to re-download)."
    exit 0
fi

URL="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8152/$ASSET"
# NOTE: the tag in the URL is percent-encoded (chromium%2F8152);
# the release page URL is .../releases/tag/chromium/8152.
TGZ="$DEST/$ASSET"
echo "downloading: $URL"
curl -fsSL -o "$TGZ" "$URL"
echo "downloaded: $TGZ ($(stat -c%s "$TGZ" 2>/dev/null || stat -f%z "$TGZ") bytes)"

SHA="$(sha256sum "$TGZ" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$TGZ" | cut -d' ' -f1)"
echo "sha256: $SHA"
if [ "$ASSET" = "pdfium-linux-x64.tgz" ]; then
    if [ "$SHA" != "$LINUX_SHA256" ]; then
        echo "error: sha256 mismatch for $ASSET" >&2
        echo "  expected (LICENSE_AUDIT.md): $LINUX_SHA256" >&2
        echo "  got:                         $SHA" >&2
        echo "The download may be corrupted or tampered with — not using it." >&2
        rm -f "$TGZ"
        exit 1
    fi
    echo "sha256 verified against LICENSE_AUDIT.md."
else
    echo "NOTE: no sha256 is recorded for $ASSET in LICENSE_AUDIT.md yet."
    echo "Record this value there before relying on the binary:"
    echo "  $ASSET  $SHA"
fi

echo "extracting to $DEST ..."
tar --no-same-owner -xzf "$TGZ" -C "$DEST"
# The archive lays the library out under lib/ (Linux/macOS) or
# bin/ (Windows); move it to the top of the cache dir, where
# `Pdfium::bind_to_library` / the render path look for it.
for candidate in "$DEST/lib/$LIB" "$DEST/bin/$LIB" "$DEST/$LIB"; do
    if [ -f "$candidate" ]; then
        if [ "$candidate" != "$DEST/$LIB" ]; then
            mv "$candidate" "$DEST/$LIB"
        fi
        break
    fi
done
if [ ! -f "$DEST/$LIB" ]; then
    echo "error: archive did not contain $LIB under lib/, bin/ or the top level." >&2
    echo "Archive contents:" >&2
    tar -tzf "$TGZ" | head -n 30 >&2
    exit 1
fi
echo "libpdfium ready at $DEST/$LIB"
echo "Use it with: OPENPIXEL_PDFIUM_PATH=$DEST/$LIB openpixel pdf render input.pdf"
