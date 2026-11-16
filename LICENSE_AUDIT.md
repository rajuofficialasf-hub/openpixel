# Licence Audit — OpenPixel Studio

The licence registry for third-party components the Studio
engines link, bundle or download. Started in Studio Phase 1.
The full machine-readable inventory is `sbom.json` (root) — this
file is the human-readable record for the components that carry
licence risk: anything downloaded as a binary, anything with a
copyleft licence, and every new engine dependency added by the
Studio phases.

**Hard rule (master prompt): AGPL is a hard no.** No AGPL-licensed
component — library, binary, font, model or tool — may be added
to any OpenPixel build. `cargo deny` enforces this in CI
(`deny.toml`): AGPL/GPL/LGPL are denied. If a needed library is
only available under a copyleft licence, stop and bring the
choice to Raju instead of working around it.

## How to read a row

- **Version** — exact pinned version (`=` in `Cargo.toml`).
  A range is not a pin; do not record one.
- **Licence** — the SPDX expression from the component's own
  `Cargo.toml` / `package.json` / release page.
- **Linking** — static (compiled into our binary) or dynamic
  (loaded at runtime from a separate file). Static linking is
  where licence obligations bite hardest.
- **Redistribution** — what shipping the component obliges us to
  do (include the licence text, attribute, etc.).

## Phase 1 — PDF (lopdf + PDFium)

| Component | Version | Licence | Source | Linking | Redistribution |
|---|---|---|---|---|---|
| pdfjs-dist | `=6.5.438` | Apache-2.0 | npm / github.com/mozilla/pdf.js | Static — bundled into the web app | Browser PDF rendering (preview + PDF→image in the PDF tab); include the Apache-2.0 licence text in distributions |
| lopdf | `=0.47.0` | MIT | crates.io / github.com/J-F-Liu/lopdf | Static (Rust crate, compiled into `openpixel-pdf`) | Include the MIT licence text in distributions; no source disclosure required |
| pdfium-render | `=0.9.5` | MIT OR Apache-2.0 | crates.io / github.com/ajrcarey/pdfium-render | Static (Rust binding crate; the binding itself is MIT OR Apache-2.0) | Include the chosen licence text; no source disclosure required |
| PDFium (prebuilt binary, via pdfium-render) | chromium build **8152** (MAJOR=159, MINOR=0, BUILD=8152, PATCH=0) | BSD-3-Clause | github.com/bblanchon/pdfium-binaries — release `chromium/8152`, asset `pdfium-linux-x64.tgz` | **Dynamic** — `libpdfium.so` is loaded at runtime by `pdfium-render` (`Pdfium::bind_to_library`); it is NOT compiled into our binary and NOT committed to the repo | Include the BSD-3-Clause licence text (`licenses/pdfium.txt` in the archive) and the copyright notice in distributions that ship the binary; no source disclosure required |

## Phase 3 — Document conversion (LibreOffice headless)

| Component | Version | Licence | Source | Linking | Redistribution |
|---|---|---|---|---|---|
| LibreOffice (headless, system dependency — NOT bundled) | **24.2.7.2** (this VM, Ubuntu 24.04) | MPL-2.0 | libreoffice.org / Ubuntu package `libreoffice` | **External process** — `openpixel-documents` spawns `soffice --headless` (fresh profile per conversion, 120 s default timeout); no code is linked or embedded | Not shipped by OpenPixel. The user installs LibreOffice themselves (desktop/server); the CLI reports `doc formats` with the detected version, or an honest "not available" when it is absent. MPL-2.0 permits this use without source disclosure; the Office formats it reads/writes (OOXML, ODF) are the user's own documents. No conversion API is called — everything runs locally. |

## Phase 4 — OCR (Tesseract native + tesseract.js browser)

| Component | Version | Licence | Source | Linking | Redistribution |
|---|---|---|---|---|---|
| Tesseract (native OCR engine) | **5.3.4** (this VM, Ubuntu 24.04; CI: same major via apt/brew/vcpkg) | Apache-2.0 | tesseract-ocr.github.io / Ubuntu package `tesseract-ocr`, Homebrew `tesseract`, vcpkg `tesseract` | **Dynamic** — `libtesseract.so.5` is linked at build time by `tesseract-sys` and loaded at runtime; it is NOT compiled into our binary and NOT committed to the repo | Not shipped by OpenPixel yet (packaging gap, Phase 8 — see docs/OCR.md). The user installs Tesseract themselves; the `ocr` commands fail with install instructions when it is absent. Apache-2.0 permits this use without source disclosure. |
| Leptonica (image library Tesseract uses) | **1.82.0** (this VM) | BSD-2-Clause | leptonica.org / Ubuntu package `libleptonica-dev` (headers) + `liblept.so.5` (runtime) | **Dynamic** — `liblept.so.5`, same as Tesseract above | Same as Tesseract above. |
| tesseract-sys (Rust binding) | `=0.6.3` | MIT | crates.io / github.com/ccouzens/tesseract-sys | Static (Rust crate, compiled into `openpixel-ocr`) | Include the MIT licence text in distributions; no source disclosure required |
| leptonica-sys (Rust binding) | `=0.4.9` | MIT | crates.io / github.com/ccouzens/leptonica-sys | Static (Rust crate, compiled into `openpixel-ocr`) | Include the MIT licence text in distributions; no source disclosure required |
| tesseract.js (browser OCR) | `=7.0.0` | Apache-2.0 | npm / github.com/naptha/tesseract.js | Static — bundled into the web app (worker + core WASM self-hosted under `apps/web/public/`) | Include the Apache-2.0 licence text in distributions; no source disclosure required |
| tessdata_fast language data (eng, ben) | `tessdata_fast` main (17 Nov 2026); `ben.traineddata` 855,841 B | Apache-2.0 | github.com/tesseract-ocr/tessdata_fast | **Data, not code** — downloaded at provisioning time (native) / served from `apps/web/public/tessdata/` (browser); never committed to the repo except as the two files under `public/` | Apache-2.0 data; attribute the Tesseract project. No model is uploaded anywhere and no text leaves the machine. |

### Tesseract provisioning (verified 17 Nov 2026)

- **This VM:** `apt install tesseract-ocr tesseract-ocr-eng
  tesseract-ocr-ben` works, but `libtesseract-dev` +
  `libleptonica-dev` cannot install (the `libzstd-dev` /
  hatch-patched `libzstd1` conflict — see docs/OCR.md). The
  headers were extracted from the downloaded -dev .debs into
  `/usr/local/include/` with unversioned `.so` symlinks +
  pkg-config files in `/usr/local/lib/pkgconfig/`. **The VM reset
  wipes all of this** — re-run the provisioning after a reset.
- **Windows CI:** choco's tesseract is NOT usable for building —
  the package ships only runtime DLLs (no headers, no import
  library, no traineddata at all; verified by extracting the
  5.5.3 installer). CI uses vcpkg (`tesseract:x64-windows`)
  instead — see `.github/workflows/release.yml`.
- **No new licence was added to `deny.toml`** for Phase 4:
  Apache-2.0 and BSD-2-Clause were already allowed, and
  `cargo deny check licenses` is green. The copyleft bar is
  unchanged.

### LibreOffice provisioning (verified 16 Nov 2026)

- The Phase 3 brief expected an `apt` install (~286 MB). It
  was **already installed in this VM** (24.2.7.2, `/usr/bin/soffice`)
  — no install was needed, and no package was added. The
  adapter discovers it via `OPENPIXEL_SOFFICE_PATH`, then
  `soffice`, then `libreoffice` on `PATH`; `doc formats` prints
  the detected version, and every conversion that needs it fails
  honestly when it is absent.
- Desktop/server only by design: LibreOffice cannot run in a
  browser (no WASM), so Office conversions are CLI/desktop-only
  and the web app says so (see `docs/WEB.md`).
- Conversion quality is LibreOffice's, not ours: fidelity
  results per format are recorded in `docs/PDF.md` §Document
  conversion. Perfect formatting preservation is never promised.

### PDFium provenance (verified 16 Nov 2026)

- Downloaded by the Phase 1 prototype
  (`crates/openpixel-pdf/examples/pdfium_render.rs`, feature
  `pdfium`) from
  `https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8152/pdfium-linux-x64.tgz`
  through the normal egress proxy. The GitHub **API** is
  rate-limited for unauthenticated calls from the shared egress
  IP, so the prototype resolves the latest release via the
  `/releases/latest` HTML redirect instead — no API quota used.
- SHA-256 of the downloaded archive:
  `384ab5c51882408a143a21f9c14dcd2caf1f75280ae41c554d0489b46c3dba9f`
- The archive also bundles third-party code inside PDFium
  (freetype, harfbuzz, libjpeg-turbo, libpng, zlib, ICU, lcms,
  abseil, …); their licence texts ship in the archive's
  `licenses/` directory. When PDFium is shipped in a Studio
  installer, that whole `licenses/` directory (or at least
  `pdfium.txt` plus the bundled components' texts) must go with
  it. The binary is **not** committed to the repo and **not**
  shipped by the web app — it lives in `target/pdfium/` (build
  output, gitignored) and in desktop installs only.
- `pdfium-render`'s own Rust dependencies (bitflags, bytemuck,
  bytes, chrono, itertools, log, maybe-owned, once_cell,
  utf16string, libloading, image 0.23/0.24/0.25) are all
  permissive (MIT/Apache-2.0, plus ISC for `libloading` 0.9.1 —
  the dynamic loader pdfium-render uses; ISC is MIT-equivalent
  permissive, see `deny.toml`); they are covered by `cargo deny`
  and the SBOM, not listed individually here.
- Status: **prototype verified** — the example rendered a real
  3-page PDF to three genuine PNGs (200×259 px, text visible)
  on 16 Nov 2026. Full render support lands in Phase 2.

### lopdf notes

- Pure Rust, no native code, WASM-safe in principle.
- Phase 1 uses it for parse / merge / split / inspect only.
  It does not render pages and does not extract text by itself
  (text extraction is Phase 4/5 work on top of it).
- No built-in merge/append: `openpixel-pdf` implements merge
  and split as an object-graph copy on top of lopdf's
  `Document` API.

## Earlier components (pre-Studio, recorded for completeness)

The image engine's licences are in `sbom.json` (240 components
at last count). The ones that matter for the record:

- `image-rs` 0.25.x and its decoders — MIT / Apache-2.0.
- `dav1d-sys` / dav1d 1.5.0 — **BSD-2-Clause**, built from
  source and statically linked (`SYSTEM_DEPS_DAV1D_BUILD_INTERNAL=always`).
  The dav1d licence text is in the dav1d source tree; a static
  link means the text must be included in distributions.
- `heifer` 0.5.1 (HEIC/HEIF, pure Rust) — MIT / Apache-2.0.
  **HEVC patent note (standing):** HEIC encoding uses HEVC;
  review patent/licensing before any commercial shipping.
- `resvg` 0.48 (SVG) — MPL-2.0. Permissive for our use; keep
  the licence text in distributions.

## Adding a component

1. Record it here with the exact version, licence, source,
   linking and redistribution notes — before the code that uses
   it is merged.
2. Add the pin to `Cargo.toml` (`=` version) and to
   `docs/EXISTING_PROJECT_AUDIT.md` §14 if it is a Studio-phase
   dependency.
3. Run `cargo deny check` locally; CI runs it on every push.
4. If the licence is copyleft (GPL/LGPL/AGPL) or unclear — stop,
   do not add it, and bring the choice to Raju.
