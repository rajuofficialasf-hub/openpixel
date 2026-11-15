# OpenPixel Engine

Universal, local image conversion, processing and optimisation —
**Phases 1–8 complete and test-verified; Phase 9 (Production QA) is
implemented and awaiting coordinator review.**

No external conversion API. No Cloudinary / Convertio / Imgix. No upload.
Processing is local, offline, and goes through one engine (`openpixel-core`)
that powers the CLI, the web app and the desktop app.

## What it actually does

- Detects the real format from file signatures (magic bytes) — never the extension; `openpixel discover` also reports when the extension lies, and falls back to extension/MIME only as low-confidence discovery
- Dynamic codec registry: codecs register themselves via `Codec`/`Decoder`/`Encoder` traits; capabilities, `formats` output and conversion all follow the registry — adding a codec needs no engine change
- Converts **JPEG / PNG / BMP / GIF / TIFF / WebP / TGA / ICO / PNM / QOI**
  (via `image-rs` 0.25, pure Rust) **plus AVIF, JPEG XL, HDR, EXR and
  JPEG 2000** (Phase 3 native codecs — see `docs/CODECS.md`)
- **SVG rasterises to PNG / JPEG / WebP / …** (resvg, decode-only —
  never raster-to-vector; scripts and external resources disabled)
- Reports honest capabilities for every format (`openpixel formats`,
  `openpixel capabilities heic`) — HEIC / HEIF / APNG / RAW / PSD are
  still **detected only, not converted** (HEIC is blocked on a missing
  system `-dev` package — see `docs/CODECS.md`)
- JPEG quality (1–100), PNG compression (fast / default / best),
  AVIF quality (default 80), alpha flattening onto white / black / `#RRGGBB`
- JXL and JPEG 2000 encode **lossless only**; HDR/EXR decode clamps to
  8-bit SDR (the image note says so)
- **Processing pipeline** (`openpixel process`): resize / fit / fill /
  pad / crop / thumbnail, rotate (90/180/270 + arbitrary), flip,
  grayscale, brightness / contrast / saturation, blur, sharpen, image
  watermark, flatten
- **Metadata & animation** (`openpixel metadata`, `frames`,
  `extract-frame`): EXIF / ICC / XMP read from JPEG/PNG/TIFF/WebP,
  byte-exact preservation to JPEG/PNG targets (everything else drops
  with a recorded reason), EXIF orientation normalisation, ICC-to-sRGB
  conversion, GIF frame extraction with disposal compositing,
  multi-page TIFF extraction, APNG / animated WebP frame info
- **Batch & performance** (`openpixel batch --workers 1..=8`,
  `openpixel bench`): bounded worker pool, pause / resume / cancel /
  retry, per-file results; a failed file never stops the batch
- Security limits: 100 MiB file, 100 MP pixels, 16 384 px per side,
  path-traversal rejection, output re-validation; security audit,
  fuzz targets and SBOM in Phase 9 (see `docs/SECURITY-AUDIT.md`)
- CLI: `info`, `metadata`, `frames`, `extract-frame`, `convert`,
  `process`, `formats`, `capabilities`, `batch`, `discover`, `bench`
- **Web app** (`apps/web/`): React + TypeScript + Vite, local canvas
  conversion in a Web Worker (PNG/JPEG/WebP/BMP targets); WASM engine
  **not shipped** — the full engine does not compile to wasm32 here
  (`dav1d-sys` needs a wasm32 libdav1d sysroot; see `docs/WEB.md`)
- **Desktop app** (`apps/desktop/`): Tauri 2, native file dialogs,
  drag-and-drop, offline, Linux `.deb` + `.AppImage` built (see
  `docs/DESKTOP.md`); Windows/macOS installers not built (see
  `docs/BUILD.md` for cross-platform notes)

## Quick start

```bash
# Install Rust (if needed) — https://rustup.rs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Phase 3 needs one system library (AVIF decode): libdav1d-dev
sudo ./scripts/setup/ubuntu-24.04.sh

# Build + test
./scripts/build/build.sh
./scripts/test/test.sh

# Use it
./target/release/openpixel info photo.jpg
./target/release/openpixel convert photo.png photo.webp --quality 85
./target/release/openpixel convert photo.png photo.jpg --background white
./target/release/openpixel convert drawing.svg drawing.png
./target/release/openpixel convert photo.png photo.avif --quality 80
./target/release/openpixel process photo.png out.jpg --resize-fit 800x600 --grayscale
./target/release/openpixel metadata photo.jpg
./target/release/openpixel frames anim.gif
./target/release/openpixel formats
./target/release/openpixel capabilities avif
./target/release/openpixel discover photo.jpg
./target/release/openpixel batch ./input --format webp --quality 80
```

See `docs/BUILD.md` for the full instructions (including
cross-platform notes) and `docs/CODECS.md` for the honest format matrix.

## Layout

```
apps/cli/                  CLI (Phase 1)
apps/web/                  Web app (Phase 7 — React/Vite, local canvas conversion)
apps/desktop/              Desktop app (Phase 8 — Tauri 2, own workspace)
crates/openpixel-core/     The engine over the registry: security, convert, process
crates/openpixel-formats/  Format identity, detection, discovery, capability data
crates/openpixel-codecs/   Codec traits, image-rs + native Phase 3 adapters, dynamic registry
crates/openpixel-pipeline/ Processing pipeline (Phase 4)
crates/openpixel-metadata/ EXIF/ICC/XMP, animation, colour (Phase 5)
crates/openpixel-jobs/     Bounded batch worker pool (Phase 6)
crates/openpixel-codecs/fuzz/  cargo-fuzz targets (Phase 9)
docs/                      ARCHITECTURE, CODECS, API, SECURITY, SECURITY-AUDIT,
                           BUILD, TESTING, BENCHMARKS, ROADMAP, WEB, DESKTOP
scripts/release/           SBOM generator + CLI packaging (Phase 9)
sbom.json                  CycloneDX SBOM, root workspace (Phase 9)
tests/                     Test-plan folders; runnable tests live in crates/*/tests/
```

## Status

- Phase 1 — Foundation: **complete** (17 tests).
- Phase 2 — Codec Registry: **complete** (29 tests).
- Phase 3 — Native Codecs (SVG, AVIF, JXL, HDR, EXR, JPEG 2000):
  **complete** (50 tests). HEIC/HEIF stays detection-only (blocked,
  see `docs/CODECS.md`).
- Phase 4 — Processing Pipeline: **complete** (89 tests).
- Phase 5 — Metadata & Animation: **complete** (152 tests).
- Phase 6 — Batch & Performance: **complete** (171 tests).
- Phase 7 — Web Application: **complete** (Rust 171 tests unchanged;
  web `npm test` 17 passed; WASM not shipped).
- Phase 8 — Desktop Application: **complete** (Rust 171 tests
  unchanged; desktop `npm test` 11 passed; backend `cargo test` 16
  passed; Linux `.deb` + `.AppImage` built).
- Phase 9 — Production QA: **implemented, awaiting coordinator
  review — do not mark it done until the coordinator has reviewed
  it.** Security audit (6 findings fixed), cargo-fuzz targets,
  licence audit + SBOM, benchmark re-run, cross-platform notes,
  release packaging. Final counts: Rust workspace **176 tests**
  (see `docs/TESTING.md`).

Known limitations (full list in `docs/ROADMAP.md` and
`docs/SECURITY-AUDIT.md`): HEIC/HEIF detection-only; no processing
timeouts; APNG / animated WebP frame extraction beyond frame 0;
metadata preservation to JPEG/PNG targets only; WASM engine not
shipped; Windows/macOS installers not built; manual browser /
desktop click-through checklists still open.

## Licence

MIT OR Apache-2.0. Third-party licences: see `docs/CODECS.md` and
`native/licenses/` (complete texts for the linked native codecs).
SBOM: `sbom.json` (root workspace) and
`apps/desktop/src-tauri/sbom.json` (desktop backend).
