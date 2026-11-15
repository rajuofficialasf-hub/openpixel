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
| PNM/PBM/PGM/PPM (+PAM/P7, which image-rs writes for RGBA) | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |
| QOI | yes | yes | image-rs 0.25.10 | MIT OR Apache-2.0 |

\* GIF: first frame only in plain decode; full frame enumeration +
extraction in Phase 5 (see above). TIFF: first page only in plain
decode; page count + extraction in Phase 5. Animated WebP / APNG:
frame info in Phase 5, first frame only for decode.

`image-rs` 0.25.10 was chosen after checking crates.io on 15 Nov 2026:
actively maintained, pure Rust for these formats, no C toolchain beyond
the Rust compiler, dual MIT/Apache-2.0 licence. Its transitive
dependencies are the usual small Rust crates (byteorder, flate2/miniz,
jpeg-decoder, png, gif, tiff, etc.) — all permissive. A full SBOM
(`cargo tree` / `cargo audit`) is a Phase 9 task; Phase 1 pins exact
versions in `Cargo.lock`.

## Phase 2 — adapters

Each implemented format has one `ImageRsCodec` adapter behind the
`Codec` trait. The registry builds its capability list from the
registered adapters, so `openpixel formats` always reflects the
codecs actually present. A custom codec can be registered without
touching the engine (proven by a test codec in `registry.rs`).

## Phase 3 — native codecs (evaluated 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0)

Every candidate below was tried in this order and kept only if it
verifiably built and round-tripped on this machine. Versions are
pinned exactly in `Cargo.toml` / `Cargo.lock`.

| Format | Decode | Encode | How (pinned version) | Licence |
|---|---|---|---|---|
| SVG | yes (rasterise) | **no** — raster-to-vector is never supported | resvg 0.48.1 / usvg 0.48.1 + fontdb 0.24.0, pure Rust | MIT OR Apache-2.0 (corrected: older resvg was MPL-2.0; 0.48 is not) |
| AVIF | yes | yes (8-bit, stills) | image-rs 0.25.10 `avif` (ravif 0.13 / rav1e 0.8) + `avif-native` (dav1d 0.11 → system libdav1d 1.4.1, mp4parse 0.17) | BSD-3-Clause (ravif) / BSD-2-Clause (rav1e, dav1d) / MPL-2.0 (mp4parse) / MIT (dav1d bindings) |
| JPEG XL | yes | yes (**lossless only**) | jxl-oxide 0.12.6 (decode) + zune-jpegxl 0.5.2 / zune-core 0.5.3 (encode), pure Rust | MIT OR Apache-2.0 (jxl-oxide) / MIT OR Apache-2.0 OR Zlib (zune) |
| HDR | yes | yes | image-rs 0.25.10 `hdr` (pure Rust) | MIT OR Apache-2.0 |
| EXR | yes | yes | image-rs 0.25.10 `exr` → exr crate 1.74.3 (pure Rust) | BSD-3-Clause (exr crate) |
| JPEG 2000 | yes | yes (**lossless only**) | jpeg2k 0.11.0 → openjp2 0.7.2, a pure-Rust port of OpenJPEG — **no C library** | MIT (jpeg2k wrapper) / BSD-2-Clause (openjp2, same as upstream OpenJPEG) |

What each new codec actually does and does not do:

- **SVG** — rasterisation only. Scripts never execute (usvg parses
  static data); no external resources and no network
  (`Options::resources_dir` stays `None`, so `<image href>`,
  `@import` and external fonts are skipped, never fetched); parsing
  is from in-memory bytes only. A huge canvas is scaled down to fit
  16 384 px / 100 MP *before* any pixmap is allocated. Output is
  straight-alpha RGBA8 (tiny-skia's premultiplied pixels are
  un-premultiplied). Detection is a strict start-of-file sniff
  (optional BOM / `<?xml?>` / `<svg`), so HTML is never misdetected.
  Encode is `Unsupported` by design.
- **AVIF** — still images only; animated AVIF decodes the first
  frame. Encode is 8-bit (ravif `BitDepth::Eight`), speed 4
  (ravif's default), quality from `--quality` (default 80).
  Decode needs the **system C library libdav1d** (`libdav1d-dev`
  at build time, `libdav1d7` at runtime — install with
  `scripts/setup/ubuntu-24.04.sh`). It is the only Phase 3 codec
  with a C dependency, and it is dynamically linked.
- **JPEG XL** — the `image` crate 0.25.10 has **no `jxl` feature**,
  so JXL does not come from image-rs at all: decode is `jxl-oxide`
  (first frame only for animation; CMYK is rejected honestly — no
  canonical CMYK representation exists yet), encode is
  `zune-jpegxl`, a lossless-only proof-of-concept encoder that
  writes a raw codestream (`FF 0A`). `--quality` is ignored for JXL
  encode, never silently reinterpreted. 8- and 16-bit RGB/RGBA/Luma
  round-trip; Luma+alpha is widened to RGBA8 on encode.
- **HDR / EXR** — decoded to 8-bit SDR in Phase 3: the canonical
  `DecodedImage` has no float pixel format yet, so values above 1.0
  are clamped and the result carries a `note` saying so. Encode
  scales 8-bit data to 0.0–1.0 float. HDR has no alpha (flattened
  onto the background, like JPEG); EXR preserves alpha (Rgba32F).
  A full float pipeline is a later phase, not a hidden loss.
- **JPEG 2000** — `jpeg2k` 0.11 dropped the `openjpeg-sys` backend
  entirely, so this format needed **no C library and no apt
  package**. Encode is lossless (single layer, one tile) as a JP2
  container. One real bug found while testing: OpenJPEG's default
  of 6 resolutions requires each side to be ≥ 32 px, so small
  images failed `start_compress`; the encoder now scales the
  resolution count to the image size.

### Phase 3 — tried and NOT integrated (honest blocks)

- **HEIC / HEIF (libheif, LGPL-3.0) — blocked, stays
  detection-only.** `libheif-rs` 3.0.0 exists and would work, but
  it needs `libheif-dev` to build against, and this machine cannot
  provide it: the installed runtime `libheif1` is **1.23.3-1,
  installed manually (no apt source)**, while Ubuntu 24.04's
  `libheif-dev` is 1.17.6 and requires `libheif1 = 1.17.6` — apt
  refuses the mix ("held broken packages"). Downgrading the runtime
  library would break the installed 1.23.3 plugins, so it was not
  done. The `embedded-libheif` feature (vendored C++ build) was
  not attempted: it would duplicate the system library and drag in
  a cmake + codec-plugin build for one format. Revisit when a
  matching `-dev` package is available, or when the VM image
  provides one. No HEIC code is linked; the registry still reports
  `planned — detection only`.
- **libjxl (C) — not needed.** JXL is covered in pure Rust by
  jxl-oxide + zune-jpegxl (above). The C library would add a
  system dependency for no new capability.
- **libjpeg-turbo / libwebp / libtiff (C) — evaluated, not
  integrated.** They enable no new format: image-rs already
  decodes/encodes JPEG, WebP and TIFF in pure Rust. Swapping in C
  bindings would change performance only, at the cost of a C build
  per platform — that is a Phase 6 benchmark decision, to be
  measured before it is made, not assumed in Phase 3.

## Phase 5 — metadata, animation, colour (evaluated 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0)

New pinned dependencies (workspace `Cargo.toml`, exact `=`):
`gif` 0.14.2, `tiff` 0.11.3, `flate2` 1.1.11, `tintbox` 0.5.0.
The first three were already transitive dependencies of image-rs
0.25.10 at those exact versions (already in `Cargo.lock`), so the
only genuinely new crate in the tree is `tintbox` plus its small
pure-Rust dependencies. All four are MIT OR Apache-2.0 (tintbox:
MIT). No C library, no system package, no account, no cost.

| Capability | How (Phase 5) | Licence |
|---|---|---|
| EXIF read (JPEG/PNG/TIFF/WebP) | hand-written std-only TIFF IFD parser in `openpixel-metadata/src/exif.rs` (bounds-checked, partial data + warnings on corrupt input) | n/a (own code) |
| ICC read + preserve | byte-level: JPEG APP2 / PNG `iCCP` / TIFF / WebP `ICCP`; `parse_icc` requires the `acsp` signature at offset 36 | n/a (own code) |
| XMP read + preserve | raw packet extraction: JPEG APP1 / PNG `iTXt`/`tEXt`/`zTXt` / WebP `XMP ` | n/a (own code) |
| GIF frames | `gif` 0.14.2 — full enumeration + extraction with disposal compositing | MIT OR Apache-2.0 |
| TIFF pages | `tiff` 0.11.3 — page count + extraction | MIT OR Apache-2.0 |
| PNG `iCCP` decompression | `flate2` 1.1.11 (zlib) | MIT OR Apache-2.0 |
| ICC-to-sRGB conversion | `tintbox` 0.5.0 — pure-Rust LittleCMS reimplementation | MIT |

### Phase 5 — evaluated and NOT used (honest blocks)

- **`kamadak-exif` 0.6.2 / `exif` (MIT OR Apache-2.0, pure Rust)
  — evaluated, not used.** It parses EXIF well, but it does not
  supply the raw APP1/chunk bytes that preservation needs, and
  adopting it would leave two EXIF implementations in the crate
  (the parser for reading, a second one for byte preservation).
  One hand-written parser serves both jobs.
- **`img-parts` 0.3 (MIT OR Apache-2.0) — evaluated, not used.**
  Same reason: it models image parts but does not hand back the
  raw bytes in the form the JPEG/PNG splicer needs, and it would
  still need a TIFF IFD parser for the EXIF fields.
- **`lcms2` crate (MIT, wraps the C LittleCMS library) — evaluated,
  not used.** It needs the `liblcms2-dev` headers at build time;
  this machine has only the runtime `liblcms2.so.2`, no headers
  (`/usr/include/lcms*` absent; apt candidate for `liblcms2-dev`
  is 2.14-2ubuntu0.1). Adding a system build dependency for one
  transform was rejected in favour of `tintbox` (above), which
  claims bit-identical results to lcms2 by differential testing
  and was verified to build and transform here. Fallback if
  tintbox ever becomes unmaintained: `lcms2` + `liblcms2-dev`
  (apt 2.14); the `convert_to_srgb` API does not change.
- **IPTC — not read in Phase 5.** EXIF/ICC/XMP only; IPTC
  reading is a later phase, not a hidden gap in the reader.

### Phase 5 — what each format actually does

- **JPEG** — reads EXIF (APP1), ICC (APP2, multi-chunk
  reassembly), XMP (APP1); preserves all three byte-exact on
  `Preserve` (APP1 EXIF / APP2 ICC chunked at 65 519 B payload /
  APP1 XMP after SOI). ICC profiles over 64 KiB are chunked by
  the splicer, but no unit test covers a real > 64 KiB profile
  (test profiles are ~600 B) — the chunking code path is
  exercised only with small profiles.
- **PNG** — reads `eXIf`, `iCCP` (zlib), `iTXt`/`tEXt`/`zTXt`
  XMP, `pHYs` DPI; preserves EXIF/ICC/XMP (`eXIf` / `iCCP` /
  `iTXt` after IHDR, CRC-32 IEEE). APNG frame info is read
  (acTL/fcTL) but only frame 0 decodes.
- **GIF** — full frame enumeration (count, per-frame delay,
  disposal, loop count) and extraction with disposal compositing.
  Plain decode still yields the first frame only.
- **TIFF** — page count via a bounded IFD-chain walk and page
  extraction (U8/U16 Gray/RGB/RGBA/GrayA; Gray16 widened to
  Rgb16; CMYK / palette-16 / float are honest errors). Metadata
  preservation to TIFF targets is dropped (no injection point
  in the image-rs encoder); reading EXIF/ICC from TIFF sources
  works.
- **WebP** — reads `EXIF` / `ICCP` / `XMP ` chunks and animated
  frame info (VP8X/ANMF); only frame 0 decodes; preservation to
  WebP targets is dropped (would need a VP8X remux).
- **BMP / TGA / ICO / PNM / QOI / AVIF / JXL / JP2 / HDR / EXR /
  SVG** — no metadata reading or preservation in Phase 5; the
  engine reports no metadata for them, never invented metadata.
  Converting *from* these formats never warns about dropped
  metadata (there was none to drop).

## Detected only in Phase 2 (NOT convertible — do not claim otherwise)

Six of these were implemented in Phase 3 (see the table above);
the rows below are updated to say so. What is still only detected:

| Format | Signature detected | Planned implementation | Licence / risk |
|---|---|---|---|
| AVIF | `ftypavif/avis` | **implemented in Phase 3** (ravif + dav1d) | see Phase 3 table |
| HEIC / HEIF | `ftypheic/mif1` | libheif — **blocked in Phase 3** (no matching `-dev` package; see above) | **LGPL-3.0** — dynamic linking / licence compliance needed; HEVC patents — review |
| JPEG XL | `FF 0A` / JXL box | **implemented in Phase 3** (jxl-oxide + zune-jpegxl) | see Phase 3 table |
| JPEG 2000 | `jP  ` box | **implemented in Phase 3** (jpeg2k/openjp2, pure Rust) | see Phase 3 table |
| SVG | strict start-of-file sniff (Phase 3) | **implemented in Phase 3** (resvg, rasterisation only) | see Phase 3 table |
| EXR | `v/1\x01` | **implemented in Phase 3** (image-rs exr) | see Phase 3 table |
| HDR | `#?RADIANCE` | **implemented in Phase 3** (image-rs hdr) | see Phase 3 table |
| APNG | — (PNG signature) | frame info in Phase 5 (acTL/fcTL); frame 0 decodes, later frames are an honest error | MIT OR Apache-2.0 |
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

## Format-specific options (Phase 3 additions)

- AVIF: quality 1–100, default 80 (ravif); speed is fixed at 4.
  Alpha preserved. Animated AVIF: first frame only.
- JPEG XL: **lossless only** — `--quality` is accepted by the CLI but
  ignored by the encoder, and the codec documents that; it is never
  silently reinterpreted as a lossy setting.
- JPEG 2000: **lossless only** — same rule as JXL.
- HDR: no quality knob; alpha is flattened onto `--background`.
- EXR: no quality knob; alpha preserved.
- SVG: decode-only — there is no `--quality` or encode path at all;
  `convert x.svg y.png` rasterises at the SVG's intrinsic size
  (scaled down only past 16 384 px / 100 MP).

## PDF

PDF is **not** an image codec. If added later it will be a separate
document-rendering adapter with page selection and rasterisation —
never listed as a normal format in the registry.
