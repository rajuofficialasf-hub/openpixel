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
- `format.rs` — `ImageFormat` enum, extensions/MIME, `detect_format()` (magic bytes).
- `capability.rs` — `FormatCapability` + `registry()`; the single source of truth the UI/CLI generate options from.
- `engine.rs` — `Engine`: `detect_format`, `get_image_info`, `convert`, `convert_to_path`, alpha flattening, output re-validation.
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
