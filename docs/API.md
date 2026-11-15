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
  file_size_bytes, is_animated, frame_count, note`.
- `ConvertOptions` — `quality: Option<u8>` (JPEG), `png_compression:
  Option<u8>` (0/1/2), `background: [u8;3]`, `preserve_metadata: bool`
  (accepted, not yet honoured — see CODECS.md).
- `ConvertResult` — `source_format, target_format, width, height,
  input_bytes, output_bytes, output_path`.
- `EngineConfig` — `max_file_size_bytes` (100 MiB), `max_pixels`
  (100 MP), `max_dimension` (16 384), `default_jpeg_quality` (85),
  `default_background` (white).
- `OpenPixelError` — typed errors: `NotFound, UnknownFormat,
  NotImplemented, EncodeUnsupported, Decode, Encode, LimitExceeded,
  InvalidArgument, UnsafePath, Io, Image`.

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

## CLI (the Phase 2 application of this API)

```
openpixel info <input>
openpixel discover <input>
openpixel convert <input> <output> [--quality 1-100] [--png-compression 0|1|2] [--background white|black|#RRGGBB]
openpixel formats
openpixel capabilities <format>
openpixel batch <dir> --format <fmt> [--quality N] [--out-dir <dir>]
openpixel --json <any command>     # JSON output
openpixel --quiet / --verbose      # log level
```

Exit codes: 0 success, 1 any error (with `error: …` on stderr unless `--quiet`).

## Stability note

This is a Phase 1 internal API. `ConvertOptions` and `ImageInfo` may gain
fields in later phases (resize, metadata policy, frame selection). The
`Engine` method names above are the intended stable surface; codec
details will stay behind it.
