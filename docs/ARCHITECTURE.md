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

## Phase 9 — what changed (draft — coordinator verifies and commits)

- No new features and no public API changes. Production QA only:
  six security fixes in the engine/metadata/CLI (unbounded zlib
  decompression in PNG metadata, GIF canvas allocated before the
  limit check, TIFF page decoded before the limit check, CLI batch
  reading files without a size limit, unbounded GIF/APNG/WebP
  frame scans, engine `read_input` TOCTOU) — see
  `docs/SECURITY-AUDIT.md` for each finding, its severity and its
  disposition, including the accepted risks (no processing timeouts,
  no RSS cap, output-symlink following, input symlinks / special
  files, SVG complexity).
- `cargo-fuzz` targets for detection, decode and metadata under
  `crates/openpixel-codecs/fuzz/` (own workspace, excluded from the
  root workspace; needs nightly + libfuzzer). No engine code changed
  shape for fuzzing: `fuzz_decode` mirrors the engine's own
  dimensions-then-decode order and limits.
- Licence audit + SBOM: `sbom.json` (root workspace, 236
  components) and `apps/desktop/src-tauri/sbom.json` (570), generated
  by `scripts/release/generate-sbom.py` from `Cargo.lock`;
  `cargo audit` clean of vulnerabilities (see `docs/TESTING.md`).
  `native/licenses/` completed for the linked native codecs.
- Benchmarks re-run (see `docs/BENCHMARKS.md`): no
  code-attributable regression; AVIF is ~600x WebP and stays ravif
  speed 4 (a libavif encode path was considered and not pursued).
- Cross-platform notes in `docs/BUILD.md` (Linux verified;
  Windows/macOS not attempted) and CLI release packaging in
  `scripts/release/package-cli.sh`. Rust workspace: 176 tests
  (was 171).

## Phase 8 — what changed (draft — coordinator verifies and commits)

- `apps/desktop/` is now a real app (was an empty placeholder):
  Tauri 2.12.4 backend crate `openpixel-desktop` in `src-tauri/`
  (Rust, pinned exactly: `tauri =2.12.4`, `tauri-plugin-dialog
  =2.8.4`, `tauri-build =2.7.4`) + React 19 + TypeScript + Vite 8 +
  Tailwind CSS 3 frontend (same pinned versions as the web app, plus
  `@tauri-apps/api =2.12.4`, `@tauri-apps/plugin-dialog =2.8.4`,
  `@tauri-apps/cli =2.12.4`). No server anywhere: the backend calls
  `openpixel-core`'s `Engine` and `openpixel-jobs`' `JobManager`
  directly — the same code the CLI uses — and the frontend only sends
  file paths + options. Five tabs: Convert (native open-file dialog
  or window drag-and-drop, asset-protocol preview, engine info /
  metadata / frames, output from the live registry, quality /
  background / metadata controls, optional processing via
  `Engine::process`, frame extraction, native save dialog), Batch
  (file multi-pick + folder pick via `list_directory_images`,
  per-file target, worker pool 1–8, 500 ms progress polling,
  pause/resume/cancel-one/cancel-all/retry-failed), Formats
  (capability table read live from the registry on every launch —
  21 formats, never a hand-written list), Settings (theme, defaults,
  batch workers, reset, About with the offline statement and the log
  path), Logs (tail of the app log file + its path).
- The backend is deliberately **not** a root workspace member:
  `src-tauri/Cargo.toml` carries its own `[workspace]` table, so
  Tauri's GUI toolkit (WebKitGTK/GTK) and async runtime do not enter
  `cargo test --workspace`. The engine workspace is unchanged and
  green (171 tests, same as the Phase 7 baseline); the backend has
  its own lockfile and its own `cargo test` / `cargo clippy` /
  `cargo check` commands (see `docs/DESKTOP.md`).
- Logging is a std-only append-only file in the app data directory
  (`<app_data_dir>/logs/openpixel-desktop.log`, UTC timestamps, no
  date crate): every conversion, batch event and error is logged,
  and the Logs tab shows the tail.
- Offline is stated in the header badge, in Settings / About and in
  the footer, and the CSP in `tauri.conf.json` is `default-src
  'self'` plus the asset protocol for local previews.
- Full build on this VM: see `docs/DESKTOP.md` — the `-dev`
  packages for WebKitGTK/GTK are blocked by a `libzstd-dev` pin
  conflict (the image's `libzstd1` is a Hatch-patched build), so the
  build used a downloaded -dev sysroot under `/tmp` with
  `PKG_CONFIG_PATH`; no system library was downgraded. The produced
  `.deb` / `.AppImage` link only the runtime libraries, which are
  ordinary apt packages.
- Tests: backend `cargo test` (command-core tests over the real
  engine + a real `JobManager` batch) and frontend `npm test`
  (Vitest: settings + format helpers); `npm run build` (tsc + Vite)
  passes. See `docs/TESTING.md` for the exact counts and the Tauri
  build outcome.

## Phase 7 — what changed (draft — coordinator verifies and commits)

- `apps/web/` is now a real app (was an empty placeholder): React 19
  + TypeScript + Vite 8 + Tailwind CSS 3, single-page, no server —
  static files only, all processing local in the browser. Four tabs:
  Convert (drag-and-drop + picker, preview, magic-byte detection,
  output selector, quality/background/metadata controls, download),
  Batch (thumbnails, per-file status/errors, up-to-4 concurrent via
  a promise pool, individual downloads + client-side zip via jszip),
  Formats (capability dashboard), Settings (theme, defaults, batch
  concurrency, reset/clear). Light + dark theme, responsive,
  labelled controls, keyboard-operable drop zone, live regions.
- Capability data is generated, never hand-written:
  `apps/web/src/data/capabilities.json` (21 formats) comes from
  `openpixel --json formats` via
  `apps/web/scripts/generate-capabilities.mjs` (`npm run
  generate:capabilities`), which refuses to write on a missing
  binary, bad JSON, or a short/malformed list. Regeneration was
  verified byte-identical on 16 Nov 2026.
- Conversion is canvas-based in a Web Worker (`src/worker.ts` —
  `createImageBitmap` decode, `OffscreenCanvas.convertToBlob`
  encode, bundled as its own chunk) with a main-thread fallback if
  the worker cannot start. Honest scope: sources PNG/JPEG/WebP/GIF
  (first frame)/BMP/SVG/AVIF (browser-dependent), targets
  PNG/JPEG/WebP/BMP only. Metadata is always stripped by a canvas
  round-trip and the UI says so; PNG compression is accepted but
  has no effect in the browser (no canvas knob) and the UI says so.
  Detection in the browser (`src/lib/detect.ts`) is a 1:1 port of
  the Rust `detect_format` signature table.
- WASM: **not available in this build.** The `wasm32` target is
  installed and `openpixel-formats` builds to wasm32, but the full
  engine does not — `dav1d-sys` (AVIF decode) fails its build
  script: pkg-config is not configured for wasm32
  cross-compilation and there is no wasm32 libdav1d sysroot here;
  `wasm-pack` is not installed. No WASM module is shipped and the
  UI states this plainly (see `docs/WEB.md` for the evidence).
- Tests: `npm test` — 17 Vitest tests (magic-byte detection +
  capability filtering / format-option generation). `npm run build`
  (tsc + Vite) passes; the production build serves over plain HTTP.
  The Rust workspace is unchanged: 171 tests pass (was 171).
  Dependency versions are pinned exactly in `apps/web/package.json`.

## Phase 6 — what changed (draft — coordinator verifies and commits)

- `openpixel-jobs` is now a real workspace member (was a stub):
  `JobManager` + a bounded worker pool (`std::thread` + `Mutex` +
  `Condvar`, no async runtime, no new external crates).
  `Job { id, input, output, target, options, status }`,
  `JobStatus { Queued, Running, Done, Failed, Cancelled, Paused }`,
  per-file `JobResult { job_id, input, output, bytes, duration_ms,
  error, status }`, `BatchProgress` counts, `JobManagerConfig {
  workers }`. The work function is a plain `Fn(&Job) ->
  Result<u64, String>`; `JobManager::for_engine` wires it to
  `Engine::convert`, so the engine's limits are enforced inside
  every worker (a job over the limits fails with `LimitExceeded`,
  never a crash, never a stopped batch).
- Concurrency bound: a fixed number of worker threads (default
  `min(available CPUs, 4)`, clamped 1..=8), each running at most
  one job at a time — so at most `workers` full-resolution images
  are ever in RAM. Worst case is `workers x 100 MP x 4 bytes`
  (RGBA8) = 1.6 GiB at the default of 4; measured peak RSS for
  the whole bench suite is 70 MiB (see `docs/BENCHMARKS.md`).
- Pause / resume / cancel / retry, honestly scoped: `pause()`
  pauses the queue (queued jobs become `Paused` and do not
  start); a running decode/encode is never interrupted mid-call.
  `resume()` re-queues paused jobs. `cancel(id)` cancels a queued
  or paused job and returns `false` for a running one; `cancel_all()`
  cancels every queued/paused job. `retry_failed()` re-queues
  failed jobs (old results dropped); whether the retry succeeds is
  up to the work function. A failed job is recorded in its
  `JobResult` and never aborts the batch.
- CLI: `batch` gains `--workers N` (1..=8) and `--sequential`
  (the Phase 1 one-by-one loop, kept as the fallback for
  `--workers 1`); both paths share the same input collection
  and stem-collision rule, and both report converted/failed +
  the failure list (`--json` included). New `openpixel bench`
  command (`--iterations N`, `--quick` for a small-fixture smoke
  run) prints the benchmark table with peak RSS. `scripts/test/
  bench.sh` rebuilds release and runs it.
- Benchmarks (real, this VM — see `docs/BENCHMARKS.md` for both
  runs): JPEG decode ~3 ms, PNG encode ~25 ms, WebP encode
  ~17 ms, AVIF encode ~9.3 s (ravif speed 4 — ~500x WebP),
  large TIFF (2048x1536) ~75–96 ms, 12-file batch ~26–33 ms
  total with 4 workers. Debug builds are not comparable (a full
  debug bench run took ~224 s); the CLI test uses `--quick`.
- Dependency versions pinned exactly (`=`), as before: no new
  external crate entered the tree in Phase 6 — `openpixel-jobs`
  uses only `openpixel-core` / `openpixel-formats` / `thiserror` /
  `serde`, and the CLI's `bench` fixture generation reuses the
  already-pinned `image` 0.25.10. `Cargo.lock` changed only by
  the new `openpixel-jobs` package entry.
- 171 tests pass (was 152).

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
- `scripts/setup/ubuntu-24.04.sh`: installs meson, ninja, nasm —
  the dav1d build tools (dav1d is built from source and statically
  linked; no system library). `native/licenses/` holds the
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
| Synchronous, sequential conversion | No worker pool yet; bounded concurrency is a Phase 6 job. Batch is sequential in Phase 1. | Phase 6 — done: `openpixel-jobs` pool, `--workers` / `--sequential` on `batch` |

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
- `openpixel-jobs/src/` — `JobManager` / `JobManagerConfig` /
  `Job` / `JobStatus` / `JobResult` / `BatchProgress` /
  `JobError` (Phase 6, see above), plus `peak_rss_bytes` /
  `current_rss_bytes` (`/proc/self/status`, Linux).
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

Missing after Phase 6 (honest): streaming/tiled large-image
processing, processing timeouts (a pathological file can still
take a long time inside one worker — Phase 6 bounds how many
run at once, it does not time them out); APNG / animated
WebP frame extraction beyond frame 0; metadata preservation to
targets other than JPEG/PNG; ICC conversion for non-RGB profiles
and 16-bit pixels; IPTC reading (XMP/EXIF/ICC only in Phase 5).
All are roadmapped, none are claimed.

## Cross-platform

Phase 1 builds on Linux x86_64 (verified here). The code uses only
`std` + pure-Rust crates, so Windows/macOS/Linux builds need no
platform-specific code yet. Native codecs in Phase 3 will add
per-platform setup scripts under `scripts/setup/` and `native/build/`.
