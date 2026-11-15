# Codecs — dependency & licence assessment (Phase 1)

## Rule

No codec is bundled without checking its licence, maintenance status and
build requirements. No format is advertised as supported until it is
implemented, tested and documented. The registry (`capability.rs`) is the
runtime expression of this table — run `openpixel formats` to see it live.

## Phase 1 — what is actually wired

| Format | Decode | Encode | How | Licence |
|---|---|---|---|---|
| JPEG | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| PNG | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| BMP | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| GIF | yes* | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| TIFF | yes* | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| WebP | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| TGA | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| ICO | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| PNM/PBM/PGM/PPM | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| QOI | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |

\* GIF: first frame only. TIFF: first page only. Animated WebP / APNG:
not decoded as animation in Phase 1.

`image-rs` 0.25.10 was chosen after checking crates.io on 15 Nov 2026:
actively maintained, pure Rust for these formats, no C toolchain beyond
the Rust compiler, dual MIT/Apache-2.0 licence. Its transitive
dependencies are the usual small Rust crates (byteorder, flate2/miniz,
jpeg-decoder, png, gif, tiff, etc.) — all permissive. A full SBOM
(`cargo tree` / `cargo audit`) is a Phase 9 task; Phase 1 pins exact
versions in `Cargo.lock`.

## Detected only in Phase 1 (NOT convertible — do not claim otherwise)

| Format | Signature detected | Planned implementation | Licence / risk |
|---|---|---|---|
| AVIF | `ftypavif/avis` | libavif or `ravif` (Rust) — Phase 3 | libavif BSD-2-Clause; patent: AV1 patent pool — review before shipping |
| HEIC / HEIF | `ftypheic/mif1` | libheif — Phase 3 | **LGPL-3.0** — dynamic linking / licence compliance needed; HEVC patents — review |
| JPEG XL | `FF 0A` / JXL box | libjxl — Phase 3 | BSD-3-Clause |
| JPEG 2000 | `jP  ` box | OpenJPEG — Phase 3 | BSD-2-Clause |
| SVG | — (not sniffed; XML ambiguity) | resvg, rasterisation only — Phase 3 | MPL-2.0; scripts/external resources disabled by design |
| EXR | `v/1\x01` | OpenEXR — Phase 3/D | BSD-3-Clause |
| HDR | `#?RADIANCE` | image-rs hdr — Phase 3 | MIT OR Apache-2.0 |
| APNG | — (PNG signature) | image-rs apng — Phase 5 | MIT OR Apache-2.0 |
| RAW (CR2/CR3/NEF/ARW/DNG) | — | LibRaw, preview/flattened only — Phase D | LGPL-2.1/CDDL; CR3 needs extra work |
| PSD/PSB | — | Flattened preview only, TBD — Phase D | TBD — do not promise layer access |

## Evaluated and NOT integrated in Phase 1

- **libvips** — strong for large-image streaming/tiled processing and
  memory use. Deferred: needs a system install per OS, would block the
  first verified build. Re-evaluate in Phase 3/6; if adopted it sits
  *behind* the codec-adapter trait, not as a second engine.
- **libjpeg-turbo / libpng / libwebp (C)** — faster than pure Rust in
  places, but add C build complexity. The pure-Rust decoders in
  image-rs are the Phase 1 baseline; native C codecs are a Phase 3
  performance decision, measured against benchmarks, not assumed.
- **libtiff (C)** — same reasoning; image-rs TIFF covers Phase 1.
- **OpenJPEG / libjxl / libavif / libheif** — needed for the formats
  above; each needs a per-platform install story (`scripts/setup/`,
  `native/build/`) before it can be a default dependency.

## Format-specific options (Phase 1)

- JPEG: quality 1–100, default 85. No alpha — alpha is flattened onto
  the `--background` colour (white default).
- PNG: compression 0=fast / 1=default / 2=best. Alpha preserved.
- WebP / BMP / GIF / TIFF / TGA / ICO / PNM / QOI: no quality knob in
  Phase 1 — the CLI accepts `--quality` only where it applies and
  ignores it elsewhere (documented, not silently misapplied to PNG).

## PDF

PDF is **not** an image codec. If added later it will be a separate
document-rendering adapter with page selection and rasterisation —
never listed as a normal format in the registry.
