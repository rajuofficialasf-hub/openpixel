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
