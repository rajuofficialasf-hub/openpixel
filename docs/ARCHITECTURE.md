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
                            Processing Pipeline (stub — Phase 4)
                            Metadata / Colour (stubs — Phase 5)
                            Job Manager       (stub — Phase 6)
                                  |
                          Codec Adapters
                            image-rs 0.25 (pure Rust, Phase 1)
                            libjpeg-turbo / libwebp / libavif / libheif /
                            libtiff / libjxl / OpenJPEG / resvg / LibRaw
                            (evaluated in CODECS.md, wired in Phase 3)
```

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
- `openpixel-core/src/engine.rs` — `Engine`: `detect_format`, `discover_format`, `get_image_info`, `convert`, `convert_to_path`, output re-validation. Alpha flattening moved into the codec.
- `image.rs` — `ImageInfo`, `ConvertOptions`, `ConvertResult` (typed API, no codec details leak out).
- `security.rs` — `EngineConfig` + limits (`MAX_FILE_SIZE_BYTES` 100 MiB, `MAX_PIXELS` 100 MP, `MAX_DIMENSION` 16384), path validation, background-colour parsing.
- `error.rs` — `OpenPixelError` (thiserror): typed, no silent failures.

## Pipeline (Phase 1, implemented)

```
INPUT -> signature detect -> size/dimension limits -> decode
  -> canonical DynamicImage -> flatten alpha if target lacks it
  -> encode (format-specific: JPEG quality / PNG compression)
  -> re-detect output bytes -> write file -> OUTPUT
```

Missing in Phase 1 (honest): resize/crop/rotate/flip, watermark, colour
management, metadata copy, animation frames beyond the first, streaming/
tiled large-image processing, timeouts, job cancellation. All are
roadmapped, none are claimed.

## Cross-platform

Phase 1 builds on Linux x86_64 (verified here). The code uses only
`std` + pure-Rust crates, so Windows/macOS/Linux builds need no
platform-specific code yet. Native codecs in Phase 3 will add
per-platform setup scripts under `scripts/setup/` and `native/build/`.
