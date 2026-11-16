# API — internal engine API (Phase 1)

Applications use `openpixel_core::Engine`. They never import `image`
directly and never call a codec.

```rust
use openpixel_core::{Engine, EngineConfig, ConvertOptions, ImageFormat};
use std::path::Path;

let engine = Engine::new(EngineConfig::default());

// 1. Detect — from bytes, never from the extension
let format = engine.detect_format(&bytes);          // ImageFormat
let format = engine.detect_format_from_file(Path::new("in.png"))?;

// 2. Capabilities — generate UI options from this, never hard-code them
let caps = engine.get_capabilities();               // Vec<FormatCapability>
let cap  = engine.get_capability(ImageFormat::Avif); // Option<FormatCapability>

// 3. Info — format, dimensions, colour type, alpha, size, notes
let info = engine.get_image_info(Path::new("in.png"))?;

// 4. Convert — target is a typed format, not a string
let opts = ConvertOptions { quality: Some(85), background: [255,255,255], ..Default::default() };
let result = engine.convert(Path::new("in.png"), Path::new("out.jpg"),
                            ImageFormat::Jpeg, &opts)?;
// or infer the target from the output extension (source still by signature):
let result = engine.convert_to_path(Path::new("in.png"), Path::new("out.webp"), &opts)?;
```

## Types

- `ImageFormat` — enum; `id()`, `extensions()`, `mime_types()`, `from_name()`.
- `FormatCapability` — `format_id, extensions, mime_types, can_decode,
  can_encode, supports_alpha, supports_animation, supports_metadata,
  supports_icc, supports_multiple_frames, native_dependency, license,
  status, max_dimension`. Serializable to JSON (`--json`).
- `ImageInfo` — `format, width, height, color_type, has_alpha,
  file_size_bytes, is_animated, frame_count, note`, plus Phase 5:
  `orientation: Option<u8>`, `has_exif, has_icc, has_xmp: bool`.
- `ConvertOptions` — `quality: Option<u8>` (JPEG), `png_compression:
  Option<u8>` (0/1/2), `background: [u8;3]`, `preserve_metadata: bool`
  (legacy — maps to a `MetadataPolicy`, see Phase 5), plus Phase 5:
  `metadata_policy: Option<MetadataPolicy>`,
  `selected_frame: Option<u32>`, `convert_to_srgb: bool`.
- `ConvertResult` — `source_format, target_format, width, height,
  input_bytes, output_bytes, output_path`, plus Phase 5:
  `warnings: Vec<String>`, `metadata_preserved: Vec<String>`,
  `metadata_dropped: Vec<String>`,
  `orientation_applied: Option<String>`.
- `EngineConfig` — `max_file_size_bytes` (100 MiB), `max_pixels`
  (100 MP), `max_dimension` (16 384), `default_jpeg_quality` (85),
  `default_background` (white).
- `OpenPixelError` — typed errors: `NotFound, UnknownFormat,
  NotImplemented, EncodeUnsupported, Decode, Encode, LimitExceeded,
  InvalidArgument, UnsafePath, Io, Image`, plus Phase 5:
  `Metadata(String)`.

## Phase 2 — registry and discovery

```rust
use openpixel_core::{CodecRegistry, Engine, EngineConfig};
use openpixel_codecs::{Codec, Decoder, Encoder, DecodedImage, EncodeParams};
use openpixel_formats::ImageFormat;

// Capabilities come from the registry, not a hard-coded list:
let registry = CodecRegistry::default();          // 10 codecs + 11 planned
assert_eq!(registry.capabilities().len(), 21);
let engine = Engine::with_registry(EngineConfig::default(), registry);

// Discovery: signature wins; a lying extension is reported, not trusted:
let found = engine.discover_format(&bytes, Some("jpg"), None);
assert!(found.has_mismatch()); // a PNG named .jpg

// Adding a codec: implement Codec for your struct and register it.
// Registering for an existing format replaces that format's codec —
// that is how a Phase 3 native codec will supersede image-rs.
```

## Phase 6 — batch jobs

```rust
use openpixel_core::{ConvertOptions, Engine, EngineConfig, ImageFormat};
use openpixel_jobs::{JobManager, JobManagerConfig, JobStatus};
use std::path::PathBuf;
use std::sync::Arc;

let engine = Arc::new(Engine::new(EngineConfig::default()));
// Default workers = min(CPUs, 4); explicit counts clamp to 1..=8.
let manager = JobManager::for_engine(JobManagerConfig::default(), engine).unwrap();
let id = manager.submit(
    PathBuf::from("in.png"),
    PathBuf::from("out.webp"),
    ImageFormat::Webp,
    ConvertOptions::default(),
);
manager.wait_all(); // blocks until every job is Done / Failed / Cancelled
assert_eq!(manager.job(id).unwrap().status, JobStatus::Done);
let progress = manager.progress(); // total / queued / running / done / failed / cancelled / paused
let results = manager.results();   // per-file JobResult, in completion order
```

- `Job` — `id, input, output, target: ImageFormat, options:
  ConvertOptions, status: JobStatus`.
- `JobStatus` — `Queued, Running, Done, Failed, Cancelled,
  Paused`. `Paused` is queue-level: the manager was paused while
  the job was still queued. `is_terminal()` is true for `Done` /
  `Failed` / `Cancelled`.
- `JobResult` — `job_id, input, output, bytes` (output size, 0
  on failure), `duration_ms`, `error: Option<String>`,
  `status`. Cancelled jobs (never started) have no result.
- `BatchProgress` — `total, queued, running, done, failed,
  cancelled, paused`, plus `completed()` (`done + failed +
  cancelled`).
- `JobManager::new(config, work)` takes any `Arc<dyn Fn(&Job)
  -> Result<u64, String> + Send + Sync>` — that is how the unit
  tests inject a fake worker (sleep + peak-concurrency counter)
  without touching the engine. `for_engine` is the same pool
  with `Engine::convert` as the work function.
- `pause()` / `resume()` — queue-level only. A running job is
  never interrupted mid-call. `cancel(id)` returns `false` for a
  running job (it runs to completion) and for unknown ids.
  `cancel_all()` returns how many queued/paused jobs were
  cancelled. `retry_failed()` re-queues failed jobs and drops
  their old results; returns the count.
- `wait_all()` blocks until every job is terminal — paused jobs
  are not terminal, so `resume()` first or use
  `wait_timeout(Duration) -> bool`.
- `shutdown()` stops the workers and joins them (also called
  from `Drop`); jobs still queued are left unrun.
- Memory bound: at most `workers` images in RAM at once, each
  bounded by `EngineConfig` (100 MiB file / 100 MP / 16 384 px).
  Worst case `workers x 100 MP x 4 bytes` RGBA8; see
  `crates/openpixel-jobs/src/lib.rs` and `docs/BENCHMARKS.md`
  (measured peak RSS 70 MiB for the whole suite).
- `openpixel_jobs::default_workers()` — `min(available CPUs, 4)`,
  at least 1. `MAX_WORKERS` is 8. Peak/current RSS helpers:
  `peak_rss_bytes()` / `current_rss_bytes()` (Linux
  `/proc/self/status` `VmHWM` / `VmRSS`, `None` elsewhere).

## Phase 5 — metadata, animation, colour

```rust
use openpixel_core::{Engine, EngineConfig, ImageFormat, ConvertOptions,
    Metadata, MetadataPolicy, MetadataField, AnimationInfo};

// 1. Read metadata -- EXIF / ICC / XMP from the source bytes
let meta: Metadata = engine.read_metadata(input)?;
assert_eq!(meta.orientation, Some(6));
assert_eq!(meta.camera_make.as_deref(), Some("Canon"));
assert_eq!(meta.gps, Some((23.81028, 90.41250))); // (lat, lon) decimal
assert!(meta.has_icc());

// 2. Animation / multi-page info -- frame count, delays, loop count
let anim: AnimationInfo = engine.animation_info(input)?;
assert_eq!(anim.frame_count, 3);
assert_eq!(anim.frames[1].delay_ms, Some(200));
assert_eq!(anim.loop_count, Some(0)); // 0 = forever

// 3. Extract one frame / page -- GIF and TIFF fully; APNG/WebP frame 0 only
let result = engine.extract_frame_to_path(input, output, ImageFormat::Png, 1, &opts)?;

// 4. Convert with a metadata policy and/or sRGB conversion
let mut opts = ConvertOptions::default();
opts.metadata_policy = Some(MetadataPolicy::Preserve);
opts.convert_to_srgb = true;
let result = engine.convert(input, output, ImageFormat::Jpeg, &opts)?;
// result.warnings, result.metadata_preserved, result.metadata_dropped
// and result.orientation_applied tell you exactly what happened.
```

- `Metadata` -- `orientation: Option<u8>`, `camera_make`,
  `camera_model`, `date_time: Option<String>`,
  `gps: Option<(f64, f64)>` (decimal latitude, longitude),
  `gps_altitude_m: Option<f64>`, `dpi: Option<(f64, f64)>`,
  `software: Option<String>` (EXIF tag 0x0131),
  `artist: Option<String>` (EXIF tag 0x013B),
  `icc: Option<IccProfile>` (`description`, `is_srgb`, `size_bytes`),
  `xmp: Option<String>` (raw packet), `has_exif()`, `has_icc()`,
  `has_xmp()`, `warnings: Vec<String>` (corrupt input is partial
  data + warnings, never a crash), `summary()`. Raw bytes are kept
  (`raw_exif_app1`, `raw_icc`, `raw_xmp`) so preservation is
  byte-exact. Never invented: a field is `None` when the source
  does not carry it.
- `MetadataPolicy` -- `Strip` (default), `Preserve`,
  `PreserveSelected { fields: Vec<MetadataField> }`,
  `PreserveColorProfiles`, `NormalizeOrientation`.
  `MetadataField` -- `Exif`, `Icc`, `Xmp`, `Gps`. `Gps` selects the
  whole EXIF block (GPS lives inside EXIF). `from_name()` parses
  CLI names: `preserve`, `strip`, `selected:exif,icc,xmp,gps`,
  `preserve-color-profiles`, `normalize-orientation`.
- `AnimationInfo` -- `format`, `frame_count`, `is_animated`,
  `is_multi_page`, `loop_count: Option<u32>` (`0` = forever,
  `None` = not a looping format), `frames: Vec<FrameInfo>`,
  `note`. `FrameInfo` -- `index`, `width`, `height`, `offset_x`,
  `offset_y`, `delay_ms: Option<u32>`, `disposal: Option<u8>`,
  `is_keyframe`.
- `MetadataError` (in `openpixel_metadata`, mapped onto
  `OpenPixelError::Metadata`) -- `InvalidInput`, `Unsupported`,
  `FrameOutOfRange { index, count }`, `NoFrames`, `Colour`.
- `ConvertOptions` (new in Phase 5) -- `metadata_policy:
  Option<MetadataPolicy>`, `selected_frame: Option<u32>`
  (convert only this frame/page; without it an animated source
  warns and keeps the first frame), `convert_to_srgb: bool`.
  `effective_policy()` maps the legacy `preserve_metadata` bool
  (`true` = `Preserve`, `false` = `Strip`); an explicit
  `metadata_policy` wins.
- `ConvertResult` (new in Phase 5) -- `warnings: Vec<String>`,
  `metadata_preserved: Vec<String>`, `metadata_dropped:
  Vec<String>`, `orientation_applied: Option<String>`.
- `ImageInfo` (new in Phase 5) -- `orientation: Option<u8>`,
  `has_exif: bool`, `has_icc: bool`, `has_xmp: bool`.
- `OpenPixelError` gains `Metadata(String)`.
- `NormalizeOrientation` applies the EXIF 1-8 transform at decode
  time (before the user's pipeline) and reports it in
  `orientation_applied`; the orientation tag is gone from the
  output because the pixels are already rotated. Mapping is
  Pillow's `exif_transpose`: 1 none, 2 flip-h, 3 rotate 180,
  4 flip-v, 5 rotate-90 + flip-h, 6 rotate 90 clockwise,
  7 flip-h + rotate-90, 8 rotate 270.
- `convert_to_srgb` converts RGB8/RGBA8 pixels from the embedded
  ICC profile to sRGB (tintbox, relative colorimetric). A profile
  that is already sRGB is a no-op; a non-RGB profile errors
  honestly; a failed transform warns and keeps the original
  pixels. When the pixels actually change, the source ICC profile
  is dropped even under `Preserve` -- it no longer describes the
  pixels -- with a warning.

### Per-format metadata preservation matrix (Phase 5)

`--metadata preserve` (or `selected:...`) on `convert` /
`process` / `extract-frame`. Anything not listed as preserved is
recorded in `metadata_dropped` with a reason and printed as a
warning by the CLI.

| Target | EXIF | ICC | XMP | Notes |
|---|---|---|---|---|
| JPEG | preserved (APP1) | preserved (APP2, chunked) | preserved (APP1) | Byte-exact re-insertion after SOI. |
| PNG | preserved (`eXIf`) | preserved (`iCCP`, zlib) | preserved (`iTXt`) | Chunks inserted right after IHDR. |
| TIFF | dropped | dropped | dropped | image-rs TIFF encoder has no metadata injection point in Phase 5. |
| WebP | dropped | dropped | dropped | Would need a VP8X remux; not done in Phase 5. |
| GIF | dropped | dropped | dropped | GIF has no EXIF/ICC/XMP container in this build. |
| BMP / TGA / ICO / PNM / QOI / AVIF / JXL / JP2 / HDR / EXR / SVG | dropped | dropped | dropped | No metadata container support in Phase 5. |

Source reading (what `openpixel metadata` sees): JPEG (APP1 EXIF,
APP2 ICC, APP1 XMP), PNG (`eXIf`, `iCCP`, `iTXt`/`tEXt`/`zTXt`,
`pHYs` DPI), TIFF (IFD0 EXIF/ICC), WebP (`EXIF`, `ICCP`, `XMP `).
Other formats report no metadata, never invented metadata.

### Animation support (Phase 5)

| Source | Frame info | Frame extraction |
|---|---|---|
| GIF | full (count, per-frame delay, disposal, loop count) | full, with disposal compositing |
| APNG | full (acTL/fcTL) | frame 0 only; later frames are an honest error |
| Animated WebP | full (VP8X/ANMF) | frame 0 only; later frames are an honest error |
| Multi-page TIFF | page count + dimensions | full (all pages) |
| Anything else | single frame | frame 0 only; `--frame N>0` is `InvalidArgument` |

Converting an animated/multi-page source without `--frame`
warns (`source is animated (N frames); converting to a static
image keeps the first frame only`) and keeps frame 0.

## Phase 4 — processing pipeline

```rust
use openpixel_core::{Engine, EngineConfig, ImageFormat, Operation, Pipeline, ProcessOptions, ConvertOptions};

let engine = Engine::new(EngineConfig::default());
let pipeline = Pipeline::from_operations(vec![
    Operation::ResizeFit { width: 800, height: 600 },
    Operation::Grayscale,
    Operation::Rotate90,
]);
let opts = ProcessOptions::new(ConvertOptions::default(), pipeline);
let result = engine.process(input, output, ImageFormat::Jpeg, &opts)?;
// Alias with the convert-style name:
let result = engine.convert_with_pipeline(input, output, ImageFormat::Jpeg, &opts)?;
// Or infer the target from the output extension:
let result = engine.process_to_path(input, output, &opts)?;
// Decode a file to a DecodedImage (e.g. to load a watermark):
let img = engine.decode_file(watermark_path)?;
```

- `ProcessOptions` — `{ convert: ConvertOptions, pipeline: Pipeline }`.
  An empty pipeline behaves exactly like `convert`.
- Byte-in / byte-out variants for the WASM bindings (no filesystem):
  `engine.process_bytes(bytes, target, &opts)` returns
  `(ConvertResult, Vec<u8>)` — the same pipeline as `process`, and
  the entry point the web Resize tab uses.
- Target-size search (16 Nov 2026): `engine.process_to_size_bytes
  (bytes, target, &opts, target_bytes)` returns
  `(TargetSizeOutcome, Vec<u8>)`, and the file variant
  `engine.process_to_size(input, output, &opts, target_bytes)`
  infers the target from the output extension and writes the file.
  `TargetSizeOutcome` is `{ result: ConvertResult, quality_used:
  Option<u8>, target_met: bool }`. The source is decoded and the
  pipeline applied once; a binary search over quality 1..=100 (at
  most 7 encodes) then finds the highest quality whose output fits
  the target — every attempt encodes from the same decoded image,
  never from a compressed output. When nothing fits, the smallest
  result is returned with `target_met: false` and a warning, never
  a silent overshoot. Only JPEG, AVIF, HEIC and HEIF have a quality
  knob to search; PNG tries best compression (`quality_used:
  None`); WebP is excluded — image-rs 0.25 encodes WebP losslessly
  only, so quality does not change its size — and every other
  format returns an honest error instead of a pretended fit.
  CLI: `openpixel process in.jpg out.jpg --target-size 200KB`
  (also `1.5MB`, `2GB`, plain bytes); `--target-size` cannot be
  combined with `--quality`.
- `PipelineSpec` — the flag-style builder: one optional field per
  operation, assembled in canonical order (see below). `spec.build()`
  returns a `Pipeline`.
- `PipelineError` — typed: `InvalidArgument` (crop out of bounds,
  resize to 0, value out of range, watermark does not fit) vs
  `LimitExceeded` (result over 16 384 px / 100 MP). The engine maps
  it onto `OpenPixelError`; a failed `process` writes no output.
- Value ranges: brightness `-1.0..=1.0`, contrast `-1.0..=1.0`,
  saturation `0.0..=2.0` (0 = greyscale, 1 = unchanged, 2 = double),
  blur/sharpen sigma `0 < sigma <= 100`, sharpen threshold
  `0..=255`, watermark opacity `0.0..=1.0`. Resize dimensions must
  be `> 0` and within the limits. `ResizeFit` and `Thumbnail` never
  upscale; `Resize` / `ResizeFill` / `Pad` produce the exact box.
  Arbitrary rotation fills uncovered corners with the background
  colour and returns the bounding box of the rotated image.
  There is no text watermark in Phase 4 (no bundled font, no new
  system dependency) — `Operation::Watermark` overlays a second
  image (e.g. a PNG logo) at a corner/centre with opacity.

### Operation order

Canonical order (individual CLI flags, `PipelineSpec::build`):
decode -> resize / resize-fit / resize-fill / pad / crop /
thumbnail -> rotate / flip -> grayscale / brightness / contrast /
saturation / blur / sharpen -> watermark -> flatten -> encode.
A hand-built `Pipeline`, and the CLI's repeatable `--op` flag,
apply operations in exactly the order given instead; `--op`
cannot be combined with individual operation flags.

## CLI (the Phase 2 application of this API)

```
openpixel info <input>
openpixel metadata <input>
openpixel frames <input>
openpixel extract-frame <input> <output> [--frame N] [--quality N] [--png-compression N] [--background ...] [--metadata <policy>] [--preserve-metadata] [--to-srgb]
openpixel discover <input>
openpixel convert <input> <output> [--quality 1-100] [--png-compression 0|1|2] [--background white|black|#RRGGBB] [--metadata <policy>] [--preserve-metadata] [--frame N] [--to-srgb]
openpixel process <input> <output> [--quality N] [--target-size 200KB] [--png-compression N] [--background ...] [--metadata <policy>] [--preserve-metadata] [--frame N] [--to-srgb]
    [--resize 800x600] [--resize-fit 800x600] [--resize-fill 800x600]
    [--pad 800x600 --pad-color white] [--crop 10,20,400,300] [--thumbnail 256]
    [--rotate 90] [--rotate-background white] [--flip-h] [--flip-v] [--grayscale]
    [--brightness -1..1] [--contrast -1..1] [--saturation 0..2]
    [--blur 2.0] [--sharpen 1.0 --sharpen-threshold 0]
    [--watermark logo.png --watermark-position bottom-right --watermark-opacity 0.5 --watermark-margin 8]
    [--flatten]
    [--op resize:800x600 --op grayscale --op rotate:90]   # exact order, repeatable; not mixable with the flags above
openpixel formats
openpixel capabilities <format>
openpixel batch <dir> --format <fmt> [--quality N] [--out-dir <dir>] [--workers 1..=8] [--sequential]
openpixel bench [--iterations N] [--quick]
openpixel pdf info <input>
openpixel pdf merge <a.pdf> <b.pdf>... -o <out.pdf>
openpixel pdf split <input> --ranges 1-3,5-7 [--out-dir <dir>]
openpixel pdf rotate <input> <output> [--pages 1,3] --degrees 90|180|270
openpixel pdf extract <input> <output> --pages 1,3,5
openpixel pdf remove <input> <output> --pages 2
openpixel pdf reorder <input> <output> --order 3,1,2
openpixel pdf duplicate <input> <output> --pages 1
openpixel pdf insert <input> <other.pdf> <output> --at 2
openpixel pdf replace <input> <replacement.pdf> <output> --page 2
openpixel pdf reverse <input> <output>
openpixel pdf booklet <input> <output>
openpixel pdf nup <input> <output> [--cols 2] [--rows 2]
openpixel pdf render <input> [--out-dir <dir>] [--pages 1,3] [--format png] [--scale 2.0] [--quality 85]
openpixel pdf from-images <img1> <img2>... -o <out.pdf> [--page-size A4|Letter|A5]
openpixel pdf compress <input> <output> [--mode screen|ebook|printer] [--strip-metadata]
openpixel pdf protect <input> <output> --user-password <pw> [--owner-password <pw>] [--no-print] [--no-copy] [--no-modify]
openpixel pdf unlock <input> <output> --password <pw>
openpixel pdf watermark <input> <output> --text <text> [--font-size 48] [--opacity 0.25] [--angle 45]
openpixel pdf extract-text <input> [-o <out>] [--pages 1,3] [--format txt|html|epub|docx]
openpixel doc convert <input> --to <fmt> [-o <out>] [--timeout-secs 120]
openpixel doc formats [--json]
openpixel --json <any command>     # JSON output
openpixel --quiet / --verbose      # log level
```

Exit codes: 0 success, 1 any error (with `error: …` on stderr unless `--quiet`).

## Studio Phase 2 — PDF engine API (`openpixel-pdf`)

`PdfEngine` (config: `PdfConfig { max_pages: 10_000,
max_file_size_bytes: 100 MiB }`). All page numbers are 1-based;
ranges are inclusive. Full semantics and limits: `docs/PDF.md`.

```rust
// Inspect
engine.validate(bytes) -> Result<()>                       // %PDF- signature + parseable
engine.inspect(bytes) -> Result<PdfInfo>                   // page_count, version, title/author/creator/producer, encrypted, page_sizes (pt)
// Page operations — each returns a new PDF as bytes
engine.merge(documents: &[Vec<u8>]) -> Result<Vec<u8>>
engine.split(bytes, ranges: &[(u32, u32)]) -> Result<Vec<Vec<u8>>>
engine.rotate(bytes, pages: Option<&[u32]>, degrees: u16) -> Result<Vec<u8>>   // 90/180/270
engine.extract(bytes, pages: &[u32]) -> Result<Vec<u8>>
engine.remove(bytes, pages: &[u32]) -> Result<Vec<u8>>
engine.reorder(bytes, order: &[u32]) -> Result<Vec<u8>>    // every page exactly once
engine.duplicate(bytes, pages: &[u32]) -> Result<Vec<u8>>
engine.insert(bytes, at: u32, documents: &[Vec<u8>]) -> Result<Vec<u8>>  // before page `at`
engine.replace(bytes, page: u32, replacement: &[u8]) -> Result<Vec<u8>>
engine.reverse(bytes) -> Result<Vec<u8>>
engine.booklet(bytes) -> Result<Vec<u8>>                   // pads to a multiple of 4
engine.nup(bytes, cols: u32, rows: u32) -> Result<Vec<u8>>
// Render (optional `pdfium` feature — without it, a clear NotImplemented error)
engine.render_to_images(bytes, pages: Option<&[u32]>, scale: f32) -> Result<Vec<RenderedPage>>
//   scale 0.25..=6.0 (1.0 = 72 DPI); RenderedPage { page: u32, image: DecodedImage (RGBA8) }
// Image -> PDF
engine.from_images(images: &[Vec<u8>], page_size: Option<(f64, f64)>) -> Result<Vec<u8>>
//   named_page_size("A4" | "Letter" | "A5") -> Option<(f64, f64)>
// Compression (Phase 3) — returns the output bytes and the measured outcome
engine.compress(bytes, mode: CompressMode, options: CompressOptions) -> Result<(Vec<u8>, CompressOutcome)>
//   CompressMode::Screen (72 DPI, JPEG q50) | Ebook (150 DPI, q75) | Printer (300 DPI, q90)
//   CompressOptions { strip_metadata: bool, images: bool } (default: no strip, images on)
//   CompressOutcome { mode, input_bytes, output_bytes, compressed_bytes, saved_bytes, saved_percent,
//     images_total, images_recompressed, images_skipped, skipped_reasons, metadata_stripped, note }
//   Best-of rule: when the compressed file is larger and no transformation was requested,
//   the ORIGINAL bytes are returned with a note — never a bigger file labelled "compressed".
// Security (Phase 3) — RC4-128 only (lopdf V2); AES is NOT claimed, see docs/PDF.md
engine.protect(bytes, user_password, owner_password, permissions: PdfPermissions) -> Result<Vec<u8>>
//   PdfPermissions { print, copy, modify } (default: all true)
// engine.unlock(bytes, password) -> Result<Vec<u8>>   // user or owner password; wrong password = error
// engine.watermark(bytes, text, WatermarkOptions { font_size, opacity, angle_degrees, grey }) -> Result<Vec<u8>>
// Text extraction (Phase 3, optional `pdfium` feature — without it, a clear NotImplemented error)
engine.extract_text(bytes, pages: Option<&[u32]>) -> Result<Vec<PageText>>
//   PageText { page: u32, text: String, lines: Vec<TextLine> }; TextLine { text, x, y_top, width, height } (pt, top-left origin)
//   text_to_txt(pages) -> String | text_to_html(pages) -> String
//   text_to_epub(pages, title) -> Vec<u8>   // EPUB 3, mimetype first + stored, one chapter per page
//   text_to_docx(pages) -> Vec<u8>          // minimal OOXML, one paragraph per line
// Document detection (signature-first, never the extension)
discover_document(bytes, extension, mime) -> DocumentDiscovery  // DocumentFormat::Pdf | Office | ...
```

`PdfError`: `InvalidPdf(String)` (not a PDF, bad page/range,
bad degrees/scale, empty input), `Encrypted`, `PageOutOfRange`,
`InvalidRange`, `Lopdf(String)`, `Io`, `NotImplemented(String)`
(missing libpdfium, unimplemented op). Encrypted/malformed PDFs
fail cleanly — never a crash.

### WASM exports (`openpixel-wasm`, `pdfium` off — pure Rust lopdf)

```js
pdf_info(bytes) -> PdfInfo                          // { page_count, version, title, author, creator, producer, encrypted, page_sizes }
pdf_process(bytes, ops_json) -> Uint8Array[]        // ops: {"kind":"split","ranges":[[1,3],[5,7]]}
                                                    //   | {"kind":"rotate","pages":[1,3],"degrees":90} (pages optional = all, degrees default 90)
                                                    //   | {"kind":"extract"|"remove"|"duplicate","pages":[...]}
                                                    //   | {"kind":"reorder","order":[3,1,2]}
                                                    //   | {"kind":"reverse"} | {"kind":"booklet"}
                                                    //   | {"kind":"nup","cols":2,"rows":2}
pdf_merge(documents: Uint8Array[]) -> Uint8Array
pdf_from_images(images: Uint8Array[], page_size?: "A4"|"Letter"|"A5") -> Uint8Array
pdf_compress(bytes, options_json) -> { data, input_bytes, output_bytes, saved_bytes, saved_percent, images_recompressed, images_skipped, note }
//   options_json: {"mode":"screen"|"ebook"|"printer","strip_metadata":bool}
//   No linearise option: lopdf ignores it (see docs/PDF.md) — offering it would be fake.
// No render export: PDFium cannot run in the browser — the web UI
// renders PDF pages with pdf.js instead.
// No protect/unlock/watermark/extract-text exports: native-only
// (PDFium / passwords stay in the CLI/desktop).
```

## Studio Phase 3 — Document conversion API (`openpixel-documents`, `openpixel-formats`, `openpixel-api`)

The conversion registry is the single source of truth for what
converts to what, with which engine, and where it runs
(`crates/openpixel-formats/src/conversion.rs`, 31 rows). The API
types mirror it exactly (`openpixel-api::list_document_conversions()`).

```rust
// Registry row (openpixel-formats)
DocumentConversion { source: &'static str, target: &'static str,
  engine: ConversionEngine,           // LibreOffice | PdfText
  runs_where: RunsWhere,              // CliDesktop (every row — nothing runs in the browser)
  fidelity: &'static str }            // what actually survives, in plain words
find_conversion(source, target) -> Option<&DocumentConversion>
conversion_targets(source) -> Vec<&'static str>   // what a source CAN convert to (used in refusal messages)
libreoffice_filter(target) -> Option<&'static str> // the LibreOffice --convert-to filter name, or None

// Engine (openpixel-documents) — implements ProcessingEngine
DocumentEngine::new() -> Self
engine.convert(bytes, target: &str, options: DocumentOptions) -> Result<Vec<u8>>
//   DocumentOptions { source_hint: Option<String>, timeout_secs: u64 } (default: no hint, 120 s)
//   Detects the source (signature-first; OLE2 legacy formats need the extension as the hint),
//   looks up the registry row, routes LibreOffice rows to `soffice --headless`
//   (fresh profile, output verified to exist — exit code 0 is never trusted)
//   and PdfText rows to PDFium text extraction + the text_to_* builders.
//   No row -> UnsupportedConversion, naming the targets the source CAN convert to.
//   Encrypted PDFs are refused by the engine before LibreOffice ever sees them.
DocumentError: NotAvailable (no LibreOffice / no PDFium) | UnsupportedConversion { src, dst, reason }
  | ConversionFailed { src, dst, detail } | Timeout(u64) | UnknownFormat | Pdf | Core | Security | Io

// API types (openpixel-api — JSON-serialisable mirrors for a future server)
DocumentConversion { source: String, target: String, engine: String, runs_where: String, fidelity: String }
DocumentConvertRequest { target_format: String, timeout_secs: Option<u64> }
DocumentConvertResponse { output_file_id: String, source_format: String, target_format: String,
  engine: String, input_bytes: u64, output_bytes: u64, fidelity: String }
```

### `Engine::encode_decoded` (image engine, Phase 2)

```rust
engine.encode_decoded(image: &DecodedImage, target: ImageFormat, options: &ConvertOptions)
    -> Result<(ConvertResult, Vec<u8>)>
```

Encodes an already-decoded image (e.g. a PDF page rendered by
PDFium) through the same shared encode tail as `convert_bytes`
(ICO 256×256 auto-resize, quality defaults, output validation).
No source metadata is carried; `ConvertResult::source_format`
is `Unknown` (a rendered page has no image format).

## Stability note

This is a Phase 1 internal API. `ConvertOptions` and `ImageInfo` may gain
fields in later phases (Phase 5 already added the metadata policy,
frame selection and sRGB conversion fields). The
`Engine` method names above are the intended stable surface; codec
details will stay behind it.
