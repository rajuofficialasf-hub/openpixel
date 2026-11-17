#!/usr/bin/env bash
# Release packaging for the OpenPixel CLI (Phase 9).
# Builds the release binary, stages it with the docs and licence
# files, and produces a versioned tarball + SHA-256 checksums.
#
# Usage: scripts/release/package-cli.sh [VERSION]
#   VERSION defaults to the workspace version in Cargo.toml (0.1.0).
# Output: dist/openpixel-<version>-linux-x86_64.tar.gz
#         dist/openpixel-<version>-linux-x86_64.tar.gz.sha256
#         dist/SHA256SUMS
#
# The tarball ships libpdfium.so BESIDE the `openpixel` binary, so
# a fresh extraction renders PDFs and extracts text with no manual
# fetching (the resolver's beside-the-binary step — see
# docs/PDF.md). The library itself is never committed: this script
# fetches it with the pinned scripts/pdfium/fetch-pdfium.sh
# (sha256-verified on Linux) when it is not already in
# target/pdfium/, then copies it into the staging dir.
# The desktop .deb / .AppImage are built by the Tauri bundle step
# (see docs/DESKTOP.md); this script packages the CLI only and does
# not rebuild them.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.cargo/bin:$PATH"

VERSION="${1:-$(grep -m1 '^version' Cargo.toml | sed 's/.*"\(.*\)".*/\1/')}"
# The workspace version lives in [workspace.package]; fall back to the
# CLI package version if the grep above caught something else.
if [ -z "$VERSION" ]; then VERSION="0.1.0"; fi
TRIPLE="linux-x86_64"
DIST="dist"
STAGE="$DIST/openpixel-$VERSION-$TRIPLE"

echo "== build release CLI =="
cargo build --release -q
test -x target/release/openpixel

echo "== stage $STAGE =="
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp target/release/openpixel "$STAGE/openpixel"
# Phase 8: ship libpdfium beside the binary. Fetch the pinned
# library first when the dev cache is empty (a no-op when it is
# already cached); the binary itself is never committed.
bash scripts/pdfium/fetch-pdfium.sh
LIB="libpdfium.so"
case "$(uname -s)" in
    Darwin) LIB="libpdfium.dylib" ;;
    MINGW64_NT-*|MSYS_NT-*|CYGWIN_NT-*) LIB="pdfium.dll" ;;
esac
test -f "target/pdfium/$LIB" || { echo "error: target/pdfium/$LIB missing after fetch" >&2; exit 1; }
cp "target/pdfium/$LIB" "$STAGE/$LIB"
echo "bundled $LIB beside the binary ($(stat -c%s "$STAGE/$LIB" 2>/dev/null || stat -f%z "$STAGE/$LIB") bytes)"
cp README.md LICENSE "$STAGE/"
cp docs/ARCHITECTURE.md docs/API.md docs/CODECS.md docs/SECURITY.md \
   docs/SECURITY-AUDIT.md docs/TESTING.md docs/BENCHMARKS.md \
   docs/ROADMAP.md docs/BUILD.md "$STAGE/" 2>/dev/null || true
cp sbom.json "$STAGE/" 2>/dev/null || echo "(no sbom.json yet — run scripts/release/generate-sbom.py first)"
cp -r native/licenses "$STAGE/native-licenses"
cat > "$STAGE/VERSION.txt" <<EOF
OpenPixel Engine $VERSION ($TRIPLE)
Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Rust: $(rustc --version)
Binary: openpixel (CLI)
Bundled: $LIB beside the binary (libpdfium, bblanchon/pdfium-binaries
chromium/8152 — see docs/PDF.md; no manual fetching needed for
`pdf render` / `pdf extract-text`).
EOF

echo "== tarball + checksums =="
mkdir -p "$DIST"
TARBALL="$DIST/openpixel-$VERSION-$TRIPLE.tar.gz"
tar -czf "$TARBALL" -C "$DIST" "openpixel-$VERSION-$TRIPLE"
(cd "$DIST" && sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256")
(cd "$DIST" && sha256sum "openpixel-$VERSION-$TRIPLE.tar.gz" > SHA256SUMS)
rm -rf "$STAGE"
ls -la "$TARBALL" "$TARBALL.sha256"
echo "done: $TARBALL"
