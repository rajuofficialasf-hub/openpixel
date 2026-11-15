# Testing — OpenPixel Engine (Phase 1)

## Rule

A feature is complete only when implementation, tests, error handling
and documentation exist. Compiling is not completion.

## What runs in Phase 1

```bash
cargo test --workspace
```

- **Unit tests** (`crates/openpixel-core/src/…`, `#[cfg(test)]`):
  - `format.rs` — magic-byte detection for JPEG/PNG/BMP/GIF/TIFF/WebP,
    AVIF/HEIC/QOI/ICO/JXL; unknown for random/empty input; `from_name`
    case/dot handling.
  - `security.rs` — oversize file, huge dimensions, `..` paths,
    background parsing.
  - `engine.rs` — PNG round-trip (alpha preserved), PNG→JPEG (alpha
    flattened), JPEG→BMP/WebP/GIF/TIFF, unknown-format rejection,
    AVIF `NotImplemented`, missing-file `NotFound`.
- **Integration tests** (`crates/openpixel-core/tests/integration.rs`):
  - All 8 implemented formats round-trip from one RGBA fixture, with
    output re-detection matching the requested target.
  - Extension is not trusted (PNG named `.jpg` → detected as PNG).
  - Corrupted file (valid PNG signature + garbage) errors cleanly.
  - JPEG quality 20 vs 95 changes output size in the expected direction.

## Verified results — Phase 3, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce. System setup first:
`sudo ./scripts/setup/ubuntu-24.04.sh` installs `libdav1d-dev`
(AVIF decode — the only system library Phase 3 needs).

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **50 passed, 0 failed**: formats 10
  (detection 6 incl. the new strict SVG sniff + discovery 4),
  codecs 25 (registry 3 + adapter round-trips 3 + new-codec unit
  tests 19: SVG 5, AVIF 3, JXL 3, HDR 3, EXR 2, JPEG 2000 3),
  core 15 (unit 11 incl. SVG→PNG + AVIF round-trip through the
  engine + integration 4). Phase 2's 29 tests still pass unchanged
  in behaviour except the two that named AVIF as unimplemented
  (now HEIC) and the registry counts (16 codecs, 5 planned).
- `cargo clippy --workspace -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification: `info`/`discover`/`convert` on real
  generated AVIF, JXL, EXR, HDR, JP2 and SVG files (see below);
  `formats` still lists 21 formats, now with 15 fully implemented
  (decode+encode) and SVG decode-only; `capabilities heic`
  correctly reports decode=no / encode=no.
  - One 64×48 RGBA Pillow fixture converted to all five new
    formats and back to PNG: round-trip MAE vs the original —
    AVIF 0.47 (lossy), JXL 0.00, EXR 0.00, JP2 0.00, HDR 0.00 on
    opaque pixels (the semi-transparent region flattens onto
    white by design, as documented).
  - Independent tools confirmed the outputs: `file(1)` reports
    "ISO Media, AVIF Image", "JPEG XL codestream", "OpenEXR image
    data", "Radiance HDR image data", "JPEG 2000 Part 1 (JP2)";
    `heif-info` (libheif) reads our AVIF as 64×48, YCbCr 4:4:4,
    8-bit, with alpha; real OpenJPEG `opj_decompress` decodes our
    JP2 byte-exact (0 mismatches in 12 288 bytes); Pillow reads
    our JP2 directly with exact pixels.
  - SVG: yellow background + blue circle rasterise to the exact
    expected pixels; a 100 000×100 000 SVG is scaled to
    10 000×10 000 by the pixel cap, not rejected; `discover` on an
    AVIF named `.jpg` reports avif/Signature/High with a mismatch
    warning; a truncated AVIF fails with a clean typed error
    (`UnexpectedEOF`), not a crash; `batch` converted 3 files
    (PNG, JPG, SVG) to AVIF with 0 failures; `convert x.png
    x.heic` fails cleanly with "cannot be encoded in this build
    (planned — detection only)".
- Bugs found and fixed during Phase 3: OpenJPEG's default 6
  resolutions need each side ≥ 32 px, so small images failed
  `start_compress` — the JP2 encoder now scales the resolution
  count to the image size; HDR decode always yields Rgba8 in
  Phase 3 (float → Rgba8), so the alpha-flatten test checks the
  flattened colour instead of `has_alpha`; a 100 000×100 000 SVG
  lands at 10 000×10 000 because the 100 MP pixel cap dominates
  the 16 384 px side cap.

## Verified results — Phase 2, 15 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce.

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **29 passed, 0 failed**: formats 9
  (detection 5 + discovery 4), codecs 6 (registry 3 + adapter
  round-trips 3), core 14 (unit 10 + integration 4). Phase 1's 17
  tests still pass unchanged in behaviour.
- `cargo clippy --workspace -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification: `discover` on a PNG named `.jpg` reports
  format png, method Signature, confidence High, with a mismatch
  warning; `formats` still lists 21 formats from the dynamic
  registry; conversions unchanged from Phase 1.
- Bugs found and fixed during Phase 2: image-rs writes RGBA PNM as
  PAM (P7), which detection rejected — P7 is now recognised as PNM;
  `Decoder`/`Encoder` both defining `format()` was ambiguous, so
  the format is now reported once, on `Decoder`.

## Verified results — Phase 1, 15 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce.

- `cargo build --release` — succeeds, binary `target/release/openpixel`
  (2.9 MB), no errors, no warnings after the final cleanup.
- `cargo test --workspace` — **17 passed, 0 failed**: 13 unit tests
  (format detection, security limits, engine round-trips) + 4
  integration tests (all-format round-trip, extension-not-trusted,
  corrupted-file, JPEG quality). Two real bugs were found and fixed
  during this run: TGA has no magic bytes (header sniff added +
  output validation exempted), and batch files sharing a stem
  (`photo.jpg` + `photo.png`) overwrote each other (now suffixed
  with the source extension).
- Manual CLI verification on a real 64×48 RGBA image (Pillow):
  `info` PNG (rgba8, alpha yes) and JPEG (rgb8, alpha no);
  PNG→WebP (171 → 206 bytes), PNG→JPEG white background
  (171 → 1 106 bytes), JPEG→BMP, JPEG→PNG — all re-detected by
  `info` and confirmed by `file(1)`; `formats` lists 21 formats
  with honest statuses; `capabilities avif` correctly reports
  decode=no / encode=no; AVIF conversion and a non-image file
  both fail with a clean typed error and exit code 1; `batch`
  converted 2 files, 0 failed.

## Not yet tested (later phases)

- Fuzz tests (`cargo-fuzz` on detection + decode) — Phase 9.
- Large-image / memory benchmarks — Phase 6.
- Cross-platform (Windows/macOS) — Phase 9; Phase 1 code is pure Rust
  + `std`, so no platform-specific test exists yet.
- Animation round-trips, metadata preservation, ICC handling — Phases 5.
- Corrupted-file corpus (`tests/corrupted-files/`) — folder exists,
  corpus to be added in Phase 9.

## Test fixtures

Integration fixtures are generated in-code (no binary fixtures checked
in yet) so the suite is reproducible from a clean checkout.
`tests/fixtures/` is reserved for checked-in real-world images in
later phases.
