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

## Verified results — Phase 5, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce. System setup first:
`sudo ./scripts/setup/ubuntu-24.04.sh` installs `libdav1d-dev`
(AVIF decode — the only system library Phase 3 needs). Note: during
Phase 5 verification the package had gone missing from this machine
(runtime `libdav1d7` 1.4.1 still present); test binaries failed to
link with `unable to find library -ldav1d` until it was restored
(`sudo apt-get install libdav1d-dev`, 1.4.1-1build1, exact match).
If a fresh checkout fails to link test binaries, run the setup
script first.

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **152 passed, 0 failed** (was 89):
  CLI 4 (new: metadata-policy flag resolution), codecs 25 (22 unit +
  3 adapter round-trip, unchanged), core 36 (30 unit + 6 integration;
  new: metadata read, policy strip vs preserve, orientation
  normalisation, GIF frames, TIFF pages, frame extraction,
  `to-srgb` + ICC-drop behaviour), formats 10 (unchanged), metadata
  47 (46 unit + 1 doctest — exif 5, extract 8, icc 7, orientation 7,
  frames 11, policy 8), pipeline 30 (29 unit + 1 doctest,
  unchanged). Phase 4's 89 tests still pass unchanged.
- `cargo clippy --workspace --all-targets -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification on real Pillow fixtures in `/tmp/p5`
  (not checked in): `exif.jpg` 64x48 (EXIF orientation 6, Canon
  EOS R50, 2026:11:15 10:30:00, GPS 23.81028,90.41250, sRGB ICC
  588 B) + `exif_xmp.jpg` (same + XMP), `orient_2..8.jpg`,
  `anim.gif` / `anim.webp` / `apng.png` (32x24, 3 frames, delays
  100/200/300 ms), `multi.tiff` (2 pages, grey 10/200),
  `adobe.jpg` (Adobe RGB ICC 604 B), `badexif.jpg` (garbage EXIF).
  - `metadata exif.jpg` reads orientation 6, Canon EOS R50, GPS,
    sRGB ICC; `info` shows orientation 6, exif/icc yes, xmp no.
  - JPEG-to-JPEG `--metadata preserve` round-trips EXIF + ICC +
    XMP and the output re-reads identically; JPEG-to-PNG preserves
    EXIF + ICC; default (strip) drops everything; JPEG-to-TIFF
    `--metadata preserve` warns and drops exif + icc with reasons.
  - Orientation 6 normalises 64x48 to 48x64 with the tag gone;
    orientations 2-8 all match Pillow `ImageOps.exif_transpose`
    (at most 2 of 3 072 pixels off by more than 12/255 -- JPEG
    re-encode noise at the fixture's hard quadrant edge, not a
    mapping error; dimensions exact), including 5 (transpose) vs
    7 (transverse).
  - `frames anim.gif` lists 3 frames, delays 100/200/300 ms, loop
    forever; `extract-frame --frame 1` gives green (0,255,0),
    `--frame 2` blue (0,0,255); `convert anim.gif flat.png` warns
    about the animated source and keeps frame 0 (red). `frames`
    on `anim.webp` / `apng.png` lists 3 frames each;
    `extract-frame apng.png --frame 1` fails cleanly with exit 1
    (frame info only). `frames multi.tiff` lists 2 pages;
    `extract-frame --frame 1` gives grey 200.
  - `convert adobe.jpg --to-srgb` changes pixels (mean R 125 to
    118) and drops the Adobe ICC; on the sRGB `exif.jpg` it is a
    no-op (mean unchanged). `--to-srgb --metadata preserve` on
    `adobe.jpg` converts the pixels and drops the ICC with a
    warning (the profile no longer describes the pixels).
  - `convert badexif.jpg` succeeds with a warning, no crash.
  - `--json` output parses.
- Bugs found and fixed during Phase 5: the CRC-32 test constant
  for "IEND" was wrong in the test (`0xAE42_6001`, implementation
  correct at `0xAE42_6082`); a TIFF page-count walk accepted an
  IFD claiming 65 280 entries in 3 bytes (now requires the IFD
  structure to fit in the file); GIF partial frames built via a
  bare `Frame` struct failed `MissingColorPalette` (must use
  `Frame::from_rgba`); tintbox zeroes alpha without
  `Flags::COPY_ALPHA` on RGBA transforms; combining `--to-srgb`
  with `--metadata preserve` used to keep the stale Adobe ICC
  (now dropped with a warning); `frames` labelled a multi-page
  TIFF "(animated)" (now "(multi-page)"); EXIF tag 0x013B (Artist)
  was mis-mapped to `software` -- 0x0131 is Software, 0x013B is
  now reported as `artist` (found by the `--json` output of the
  regenerated fixtures).

## Verified results — Phase 4, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce.

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **89 passed, 0 failed** (was 50):
  formats 10 (unchanged), codecs 25 (22 unit + 3 adapter
  round-trip, unchanged), core 21 (15 unit + 6 integration; new:
  `process` resize+grayscale+rotate combined with pixel checks,
  empty-pipeline == convert, `convert_with_pipeline` alias,
  `process_to_path`, bad pipeline writes no output, `decode_file`;
  integration: combined pipeline end-to-end with JPEG grey check,
  watermark + `PipelineSpec` order), pipeline 30 (29 unit + 1
  doctest — dimensions after every resize/fit/fill/pad/crop/
  thumbnail/rotate/flip, pixel checks for grayscale, brightness
  direction, flip mirroring, crop content, watermark presence and
  50% blending, flatten onto background, operation ordering,
  metadata survival, and errors for resize-to-0, out-of-bounds
  crop, oversize result, out-of-range values, oversize watermark),
  CLI 3 (parse helpers for dimensions/crop/`--op`/watermark
  position). Phase 3's 50 tests still pass unchanged.
- `cargo clippy --workspace -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification on a real 64×48 RGBA Pillow fixture
  (`/tmp`, not checked in): `process --resize 32x24` → `info`
  32×24; `--rotate 90` → 48×64; `--grayscale` to JPEG → all 3 072
  pixels grey (tolerance 2); combined `--resize 32x24 --grayscale
  --rotate 90` → 24×32 luma_alpha8; `--op crop:0,0,32,24 --op
  flip-h --op grayscale` → 32×24; `--watermark` logo → bottom-right
  pixel exactly (255,0,0); `--rotate 45` → 80×80 bounding box;
  `--thumbnail 16` → 16×12; `--pad 80x60` → 80×60; `--resize-fill
  32x32` → 32×32; `--flatten` to JPEG → rgb8; combined blur +
  sharpen + saturation 0 + contrast + brightness -0.1 + flip-v +
  rotate -45 → 80×80; `--json` output parses. Error cases exit 1
  with a clean typed message and no output file: crop out of
  bounds, resize 0, brightness 2.0, mixing `--op` with flags.
- Bugs found and fixed during Phase 4: image-rs `thumbnail` and
  `resize` upscale a smaller image, so `ResizeFit`/`Thumbnail`
  now guard against upscaling (and `output_dimensions` simulates
  the same rule); a derived `Default` for `Pipeline` set both
  limits to 0 and rejected every image, so `Default` is now
  hand-written to delegate to `new()`; clap rejected negative
  numbers (`--brightness -0.1`), so the `process` subcommand sets
  `allow_negative_numbers`; clippy's `large_enum_variant` on the
  `Process` CLI variant is allowed locally with a comment — boxing
  the `Vec` field is impossible because clap has no value parser
  for `Box<Vec<String>>`.

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
- Animation round-trips, metadata preservation, ICC handling — done
  in Phase 5 (see above). Still open: APNG / animated WebP frame
  extraction beyond frame 0, metadata preservation to targets
  other than JPEG/PNG, ICC conversion for non-RGB profiles and
  16-bit pixels, IPTC reading, > 64 KiB ICC chunking test.
- Corrupted-file corpus (`tests/corrupted-files/`) — folder exists,
  corpus to be added in Phase 9.

## Test fixtures

Integration fixtures are generated in-code (no binary fixtures checked
in yet) so the suite is reproducible from a clean checkout.
`tests/fixtures/` is reserved for checked-in real-world images in
later phases.
