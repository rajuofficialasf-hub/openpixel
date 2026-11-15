# Third-party licences — Phase 3 native codecs

Full licence texts for the native codecs live here. The Rust crates
themselves are dual/triple-licensed as listed; the underlying C
libraries keep their own licences. Nothing here changes the
workspace licence (MIT OR Apache-2.0).

| Codec | What is used | Licence | File(s) |
|---|---|---|---|
| AVIF decode | system `libdav1d` 1.4.1 (C library, via `dav1d-sys`) | **BSD-2-Clause** (the C library) | `libdav1d-DEBIAN-copyright.txt` (Debian copyright file for the installed package; contains the BSD-2-Clause text) |
| AVIF decode | `dav1d` Rust bindings 0.11 | MIT | `dav1d-rs-MIT.txt` |
| AVIF encode | `ravif` 0.13 / `rav1e` 0.8 | BSD-3-Clause (ravif) / BSD-2-Clause (rav1e) | `ravif-BSD-3-Clause.txt`, `rav1e-BSD-2-Clause.txt` (copied from the vendored crate sources in Phase 9) |
| AVIF decode | `mp4parse` 0.17 (AVIF container parsing) | MPL-2.0 | `mp4parse-MPL-2.0.txt` (copied from the vendored crate source in Phase 9) |
| SVG | `resvg` 0.48.1 / `usvg` 0.48.1 | **MIT OR Apache-2.0** (corrected in Phase 3 — older resvg was MPL-2.0; 0.48 is not) | `resvg-usvg-MIT.txt`, `resvg-usvg-Apache-2.0.txt` |
| JXL decode | `jxl-oxide` 0.12 | MIT OR Apache-2.0 | crates.io |
| JXL encode | `zune-jpegxl` 0.5 | MIT OR Apache-2.0 OR Zlib | `zune-jpegxl-Zlib.txt` (Zlib text; MIT/Apache texts are the standard ones) |
| JPEG 2000 | `jpeg2k` 0.11 (thin wrapper) / `openjp2` 0.7 (pure-Rust port of OpenJPEG) | MIT (jpeg2k wrapper); **BSD-2-Clause** (openjp2 port, same as upstream OpenJPEG) | `jpeg2k-MIT.txt`, `openjp2-BSD-2-Clause.txt` |
| HDR / EXR | `image-rs` 0.25 + `exr` 1.74 | MIT OR Apache-2.0 (image-rs); **BSD-3-Clause** (exr crate) | `exr-BSD-3-Clause.txt` (copied from the vendored crate source in Phase 9) |
| ICC-to-sRGB | `tintbox` 0.5.0 (pure-Rust LittleCMS reimplementation) | MIT | `tintbox-MIT.txt` (copied from the vendored crate source in Phase 9) |

## Not integrated (no licence files needed)

- **libheif (LGPL-3.0)** — HEIC/HEIF is blocked in Phase 3 (see
  `docs/CODECS.md`): the system `libheif1` is 1.23.3-1 with no
  matching `-dev` package, so no libheif code is linked at all.
  If it is integrated later, its LGPL-3.0 text and the dynamic-linking
  compliance note belong here first.
- **libjxl (BSD-3-Clause), libjpeg-turbo, libwebp, libtiff** — not
  used in Phase 3 (see `docs/CODECS.md` for why).
