# OpenPixel Engine

Universal, local, cross-platform image conversion, processing and optimisation — **Phase 1 is done, Phases 2–9 are not.**

No external conversion API. No Cloudinary / Convertio / Imgix. No upload.
Processing is local, offline, and goes through one engine (`openpixel-core`)
that powers the CLI today and the web / desktop / WASM apps later.

## What Phase 1 actually does

- Detects the real format from file signatures (magic bytes) — never the extension
- Converts **JPEG / PNG / BMP / GIF / TIFF / WebP / TGA / ICO / PNM / QOI**
  (via `image-rs` 0.25, pure Rust — no native codec library yet)
- Reports honest capabilities for every format (`openpixel formats`,
  `openpixel capabilities avif`) — AVIF / HEIC / JXL / JPEG 2000 / SVG /
  EXR / RAW / PSD are **detected only, not converted** in Phase 1
- JPEG quality (1–100), PNG compression (fast / default / best),
  alpha flattening onto white / black / `#RRGGBB`
- Security limits: 100 MiB file, 100 MP pixels, 16 384 px per side,
  path-traversal rejection, output re-validation
- CLI: `info`, `convert`, `formats`, `capabilities`, `batch`
- GIF: first frame only. TIFF: first page only. Metadata (EXIF/ICC/XMP)
  is **not** copied to outputs yet.

## Quick start

```bash
# Install Rust (if needed) — https://rustup.rs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Build + test
./scripts/build/build.sh
./scripts/test/test.sh

# Use it
./target/release/openpixel info photo.jpg
./target/release/openpixel convert photo.png photo.webp --quality 85
./target/release/openpixel convert photo.png photo.jpg --background white
./target/release/openpixel formats
./target/release/openpixel capabilities avif
./target/release/openpixel batch ./input --format webp --quality 80
```

See `docs/BUILD.md` for the full instructions and `docs/CODECS.md` for the
honest format matrix.

## Layout

```
apps/cli/                  CLI (Phase 1 — the only app so far)
apps/web/  apps/desktop/   Placeholders — Phase 7 / Phase 8
crates/openpixel-core/     The engine: detection, registry, security, convert
crates/openpixel-*/        Stubs (lib.rs only) — implemented in later phases
docs/                      ARCHITECTURE, CODECS, API, SECURITY, BUILD, TESTING, ROADMAP
tests/                     Test-plan folders; runnable tests live in crates/*/tests/
```

## Status

Phase 1 — Foundation: **complete and test-verified** (see `docs/TESTING.md`
for the exact commands and results on this machine).
Phase 2 (Codec Registry hardening + more formats) is the next milestone.
**Do not start Phase 2 without approval** — per the master prompt, Phase 1
stops here for review.

## Licence

MIT OR Apache-2.0. Third-party licences: see `docs/CODECS.md` and
`native/licenses/` (Phase 3 adds the native codec files there).
