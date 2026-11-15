# Architecture — OpenPixel Engine (Phase 1)

## Principle

One engine, many front-ends. Applications never call a codec directly.

```
Application Layer
  React Web (Phase 7) | Tauri Desktop (Phase 8) | CLI (Phase 1) | WASM (Phase 7)
        \                    |                      |               /
                    Unified Engine Interface  —  Engine (openpixel-core)
                                  |
                          OpenPixel Core (Phase 1)
                            Format Detection  (magic bytes, format.rs)
                            Codec Registry    (capability.rs — honest, runtime)
                            Decoder / Encoder (image-rs adapters, engine.rs)
                            Security Layer    (security.rs — limits, path checks)
                            Processing Pipeline (Phase 4)
                            Metadata / Colour (Phase 5 — openpixel-metadata)
                            Job Manager       (stub — Phase 6)
                                  |
                          Codec Adapters
                            image-rs 0.25 (pure Rust, Phase 1)
                            libjpeg-turbo / libwebp / libavif / libheif /
                            libtiff / libjxl / OpenJPEG / resvg / LibRaw
                            (evaluated in CODECS.md, wired in Phase 3)
```

## Phase 5 — what changed

- `openpixel-metadata` is now a real workspace member (was a stub):
  a hand-written, bounds-checked, std-only TIFF IFD parser reads
  EXIF (orientation, camera make/model, date/time, GPS, DPI) from
  JPEG APP1, PNG `eXIf`, TIFF IFD0 and WebP `EXIF` chunks; ICC
  presence/description from JPEG APP2, PNG `iCCP`, TIFF and WebP
  `ICCP`; XMP presence/raw string from JPEG APP1, PNG `iTXt`/
  `tEXt`/`zTXt`, WebP `XMP `. The typed result is `Metadata`
  (raw APP1/ICC/XMP bytes kept alongside the parsed fields, so
  preservation is byte-exact -- nothing is re-serialised from
  parsed values). Corrupt metadata never crashes a conversion:
  the parser returns partial data plus `warnings` and the engine
  carries them through to `ConvertResult`.
- `MetadataPolicy` -- `Strip` (default), `Preserve`,
  `PreserveSelected { fields }`, `PreserveColorProfiles`,
  `NormalizeOrientation` -- parsed from CLI `--metadata <name>`
  (`preserve`, `strip`, `selected:exif,icc,xmp,gps`,
  `preserve-color-profiles`, `normalize-orientation`).
  `ConvertOptions` gains `metadata_policy: Option<MetadataPolicy>`
  (explicit policy wins over the legacy `preserve_metadata` bool),
  `selected_frame: Option<u32>` and `convert_to_srgb: bool`.
  `ConvertResult` gains `warnings`, `metadata_preserved`,
  `metadata_dropped` and `orientation_applied`; `ImageInfo`
  gains `orientation`, `has_exif`, `has_icc`, `has_xmp`.
- Preservation is byte-level splicing in the engine *after*
  encoding (the `Codec` trait is unchanged): JPEG gets APP1 EXIF /
  APP2 ICC (chunked at 65 519 B payload or less) / APP1 XMP after
  SOI; PNG gets `eXIf` / `iCCP` (zlib) / `iTXt` chunks right after
  IHDR (CRC-32 IEEE computed in-crate). Every other target
  honestly drops metadata with a reason recorded in
  `metadata_dropped` and printed by the CLI as a warning --
  never a silent claim of success. GPS lives inside EXIF, so
  selecting `Gps` preserves the whole EXIF block.
- Orientation normalisation (`NormalizeOrientation`) maps EXIF
  1-8 to pipeline operations exactly as Pillow's
  `ImageOps.exif_transpose` (5 = rotate-90 + flip-h, 6 = rotate
  90 degrees clockwise, 7 = flip-h + rotate-90, 8 = rotate 270),
  applied at decode time before the user's pipeline, and reports
  the applied transform. Verified against Pillow for
  orientations 2-8 (at most 2 of 3 072 pixels off by more than
  12/255 -- JPEG re-encode noise at the fixture's hard edge;
  dimensions exact).
- Animation: `AnimationInfo` / `FrameInfo` (index, size, offset,
  delay, disposal, loop count). GIF is fully enumerated and
  extractable via the `gif` crate, with disposal compositing
  (Background clears the frame rect, Previous restores a
  snapshot, Keep/Any is a no-op) so extracted frames are the
  composited canvas, not the raw partial rect. APNG and animated
  WebP give frame info only (acTL/fcTL, VP8X/ANMF) -- only frame 0
  decodes; extracting a later frame is an honest
  `NotImplemented` error, never a silent first-frame
  substitution. Multi-page TIFF: page count via a bounded
  IFD-chain walk (10 000-page cap, cycle guard) and page
  extraction via the `tiff` crate. Converting an animated or
  multi-page source to a static target warns unless a frame was
  explicitly selected (`--frame N`).
- Colour: ICC-to-sRGB conversion is real, via `tintbox` 0.5.0 (a
  pure-Rust LittleCMS reimplementation, bit-identical to lcms2
  by differential testing -- see CODECS.md for why the `lcms2`
  C crate was not used). RGB8/RGBA8 only, relative colorimetric;
  a non-RGB profile is an honest error, sRGB-to-sRGB is a no-op,
  and a failed transform warns and keeps the original pixels.
  When `--to-srgb` actually changes the pixels, the source ICC
  profile is dropped even under `Preserve` (it no longer
  describes the pixels) with a warning saying so.
- New engine methods: `read_metadata`, `animation_info`,
  `list_frames` (alias), `extract_frame`, `extract_frame_to_path`,
  `read_decode_frame` / `decode_selected_frame` (GIF/TIFF full,
  APNG/WebP frame > 0 gives `NotImplemented`, anything else gives
  `InvalidArgument`). New CLI commands: `openpixel metadata`,
  `openpixel frames`, `openpixel extract-frame`; `convert` /
  `process` gain `--metadata`, `--preserve-metadata`, `--frame`,
  `--to-srgb`; `info` prints orientation and exif/icc/xmp.
  152 tests pass (was 89).
- Dependency versions pinned exactly (`=` in the workspace
  `Cargo.toml`): new in Phase 5 are `gif` 0.14.2, `tiff`
  0.11.3, `flate2` 1.1.11, `tintbox` 0.5.0 -- all already
  transitive dependencies of image-rs 0.25.10 at those exact
  versions (already in `Cargo.lock`), so no new crate entered
  the tree except `tintbox` and its small pure-Rust deps.
- Environment note found during Phase 5 verification: the
  `dav1d-sys` build (Phase 3) emits `-ldav1d` at link time, so
  test binaries only link when `libdav1d-dev` is installed.
  The package had gone missing from this machine (the runtime
  `libdav1d7` 1.4.1 was still present); it was restored with
  `sudo apt-get install libdav1d-dev` (1.4.1-1build1, exact
  match, one package, nothing else touched). If a fresh checkout
  fails to link test binaries with `unable to find library
  -ldav1d`, run `scripts/setup/ubuntu-24.04.sh` first.

## Phase 4 — what changed

- `openpixel-pipeline` is now a real workspace member (was a stub):
  `Pipeline` (ordered `Operation` list, applied in order),
  `Operation` (resize / resize-fit / resize-fill / pad / crop /
  thumbnail / rotate 90·180·270 / arbitrary rotate / flip /
  grayscale / brightness / contrast / saturation / blur / sharpen /
  image watermark / flatten), `PipelineSpec` (the flag-style
  builder that assembles operations in canonical order) and
  `PipelineError` (typed: invalid argument vs limit exceeded).
  The pipeline is pure — no file I/O, no codec knowledge. It
  validates the whole pipeline against simulated dimensions before
  touching pixels, so a crop that is only out of bounds after a
  resize is still caught up front. Limits mirror the engine
  (16 384 px / 100 MP). Operations use image-rs `imageops` via
  `DynamicImage` where it exists (resize, rotate, flip, blur,
  grayscale, brightness, contrast, sharpen); saturation, pad, image
  watermark and arbitrary rotation are hand-rolled RGBA8 pixel
  loops. Two image-rs behaviours are corrected, not inherited:
  `thumbnail` and `resize` upscale a smaller image, but
  `ResizeFit` / `Thumbnail` never upscale here. Text watermarks
  are intentionally absent: no bundled font, no new system
  dependency — use the image watermark with a PNG logo.
- `openpixel-core`: `Engine::process` /
  `Engine::convert_with_pipeline` (alias) /
  `Engine::process_to_path` (target from output extension) and
  `ProcessOptions { convert, pipeline }`; an empty pipeline
  behaves exactly like `convert`. `Engine::decode_file` is new
  (the CLI loads watermark images through it). `convert` and
  `process` share one encode-and-write tail, including output
  re-detection.
- New CLI command: `openpixel process` — individual flags in
  canonical order, or repeatable `--op` for exact user ordering
  (the two styles cannot be mixed). 89 tests pass (was 50).
- Dependency versions are now pinned exactly (`=` in the
  workspace `Cargo.toml`): image 0.25.10, thiserror 2.0.21,
  serde 1.0.229, serde_json 1.0.154, clap 4.6.7. `Cargo.lock`
  changed only by the new `openpixel-pipeline` package entry —
  no version drifted.

## Phase 3 — what changed

- `openpixel-formats`: strict start-of-file SVG sniff (BOM /
  whitespace / optional `<?xml?>` / `<svg`); HTML is never
  misdetected. No other format changes.
- `openpixel-codecs`: six new adapters — `SvgCodec` (resvg/usvg,
  decode-only), `AvifCodec` (ravif encode + system dav1d decode),
  `JxlCodec` (jxl-oxide decode + zune-jpegxl lossless encode),
  `HdrCodec` / `ExrCodec` (image-rs, 8-bit SDR with a clamp note),
  `Jpeg2000Codec` (jpeg2k/openjp2, pure-Rust OpenJPEG port).
  `CodecRegistry::with_defaults()` registers all 16 codecs; the
  planned list shrinks 11 → 5 (HEIC/HEIF, APNG, RAW, PSD).
  A shared `float.rs` holds the HDR/EXR float helpers and the
  honest clamp note. The engine and CLI needed no changes — the
  registry and the SVG sniff carry the whole feature.
- `scripts/setup/ubuntu-24.04.sh`: installs `libdav1d-dev`, the one
  system library Phase 3 needs. `native/licenses/` holds the
  third-party licence texts.
- One design fix found by testing: OpenJPEG's default 6
  resolutions need each side ≥ 32 px, so the JP2 encoder scales
  the resolution count to the image size.

## Phase 2 — what changed

- `openpixel-formats`: `ImageFormat`, magic-byte detection, `discover()`
  (signature → extension/MIME fallback, mismatch reporting),
  `FormatCapability` data. Pure — no codec dependency.
- `openpixel-codecs`: `Decoder` / `Encoder` / `Codec` traits,
  `ImageRsCodec` (one adapter per format, image-rs 0.25),
  `CodecRegistry` (register / replace / remove; capabilities built
  from registered codecs + 11 planned entries), `DecodedImage`
  (canonical `width, height, PixelFormat, data`) and `EncodeParams`.
  A native codec is a second struct implementing `Codec` for the
  same format — registering it replaces the pure-Rust adapter.
- `openpixel-core`: `Engine` now owns a `CodecRegistry`
  (`Engine::with_registry` injects a custom one for tests / native
  codecs). It holds no format list and calls no codec directly.
  Its public API (`detect_format`, `get_image_info`, `convert`,
  `convert_to_path`, `get_capabilities`) is unchanged from Phase 1.
- New CLI command: `openpixel discover <file>` — signature vs
  extension, with a warning on mismatch.
- One design fix found by the compiler: `Decoder` and `Encoder`
  both defining `format()` was ambiguous, so the format is reported
  once, on `Decoder` — a codec is one format, and its two sides
  can never disagree about which one.

## Phase 1 decisions (with reasons)

| Decision | Reason | Revisit when |
|---|---|---|
| `image-rs 0.25.10` as the only codec | Pure Rust, no C build, no system libs; builds on any machine with `cargo`. Lets Phase 1 prove detection, registry, security and CLI end-to-end. | Phase 3 — native codecs for speed / AVIF / HEIC / JXL |
| No libvips in Phase 1 | libvips needs a system install and varies by OS; it would block the first verified build. Its streaming/tiled advantage matters for large images (Phase 6), not for proving the pipeline. | Phase 3/6 evaluation |
| `DynamicImage` as canonical representation | image-rs already owns it; Phase 1 avoids inventing a second pixel buffer. Explicit RGB8/RGBA8/RGB16 etc. are surfaced via `ImageInfo.color_type`. | Phase 4 — a dedicated canonical struct with frames, ICC and metadata refs |
| No Python runtime | Per the master prompt. The engine is Rust only. | Never |
| Workspace members = core + CLI only | The other 9 crates exist as `src/lib.rs` stubs so the repo shape is visible, but they are not compiled yet — no fake completeness. | Their phase (see ROADMAP.md) |
| Synchronous, sequential conversion | No worker pool yet; bounded concurrency is a Phase 6 job. Batch is sequential in Phase 1. | Phase 6 |

## Module map — `crates/openpixel-core/src/`

- `lib.rs` — public surface: `Engine`, `ImageFormat`, `FormatCapability`, errors, options.
- `openpixel-formats/src/format.rs` — `ImageFormat` enum, extensions/MIME, `detect_format()` (magic bytes), `from_mime()`.
- `openpixel-formats/src/discovery.rs` — `discover()`: signature first, extension/MIME low-confidence fallback, mismatch flag.
- `openpixel-formats/src/capability.rs` — `FormatCapability` data only.
- `openpixel-codecs/src/traits.rs` — `Decoder` / `Encoder` / `Codec`.
- `openpixel-codecs/src/image_rs.rs` — `ImageRsCodec` adapters + the only `image`-crate format mapping.
- `openpixel-codecs/src/registry.rs` — `CodecRegistry`: the single source of truth the UI/CLI generate options from.
- `openpixel-codecs/src/types.rs` — `DecodedImage`, `PixelFormat`, `EncodeParams`.
- `openpixel-core/src/engine.rs` — `Engine`: `detect_format`, `discover_format`, `get_image_info`, `convert`, `convert_to_path`, output re-validation. Alpha flattening moved into the codec. Phase 4 adds `decode_file`, `process`, `convert_with_pipeline`, `process_to_path`, sharing one encode-and-write tail with `convert`.
- `openpixel-pipeline/src/` — `Pipeline` / `Operation` /
  `PipelineSpec` / `PipelineError` (Phase 4, see above).
- `openpixel-metadata/src/` — `Metadata` / `MetadataPolicy` /
  `MetadataField` / `AnimationInfo` / `FrameInfo` / `MetadataError`
  (Phase 5, see above): `exif.rs` (TIFF IFD parser),
  `extract.rs` (JPEG/PNG/TIFF/WebP chunk scans), `icc.rs`
  (profile parsing + tintbox sRGB conversion), `frames.rs` (GIF /
  APNG / WebP / TIFF frame and page handling), `orientation.rs`
  (EXIF 1-8 to pipeline operations), `policy.rs` (JPEG/PNG
  byte-level preservation splicing + CRC-32).
- `image.rs` — `ImageInfo`, `ConvertOptions`, `ConvertResult` (typed API, no codec details leak out). Phase 4 adds `ProcessOptions { convert, pipeline }`. Phase 5 adds metadata policy, frame selection and sRGB conversion to `ConvertOptions`, and warnings / preserved / dropped / orientation-applied to `ConvertResult`.
- `security.rs` — `EngineConfig` + limits (`MAX_FILE_SIZE_BYTES` 100 MiB, `MAX_PIXELS` 100 MP, `MAX_DIMENSION` 16384), path validation, background-colour parsing.
- `error.rs` — `OpenPixelError` (thiserror): typed, no silent failures.

## Pipeline (Phase 1, implemented)

```
INPUT -> signature detect -> size/dimension limits -> decode
  -> canonical DynamicImage -> flatten alpha if target lacks it
  -> encode (format-specific: JPEG quality / PNG compression)
  -> re-detect output bytes -> write file -> OUTPUT
```

Phase 4 inserts a processing step between decode and encode
(`Engine::process`): decode -> pipeline (operations in order,
validated up front against simulated dimensions) -> encode.
Canonical operation order for the flag-style CLI (and for
`PipelineSpec::build`): resize / resize-fit / resize-fill / pad /
crop / thumbnail -> rotate / flip -> grayscale / brightness /
contrast / saturation / blur / sharpen -> watermark -> flatten.
The repeatable `--op` CLI flag (and a hand-built `Pipeline`)
applies operations in exactly the order given instead.

Missing after Phase 5 (honest): streaming/tiled large-image
processing, timeouts, job cancellation (Phase 6); APNG / animated
WebP frame extraction beyond frame 0; metadata preservation to
targets other than JPEG/PNG; ICC conversion for non-RGB profiles
and 16-bit pixels; IPTC reading (XMP/EXIF/ICC only in Phase 5).
All are roadmapped, none are claimed.

## Cross-platform

Phase 1 builds on Linux x86_64 (verified here). The code uses only
`std` + pure-Rust crates, so Windows/macOS/Linux builds need no
platform-specific code yet. Native codecs in Phase 3 will add
per-platform setup scripts under `scripts/setup/` and `native/build/`.
