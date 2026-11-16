# OpenPixel — Web Application (Phase 7)

React + TypeScript + Vite + Material UI 7 + Three.js. Single-page app, no server:
every file is processed locally in the browser, nothing is uploaded
anywhere. Design system: `src/theme/theme.ts` (see docs/WEB.md).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build -> dist/
npm run preview  # serve the production build locally
npm test         # vitest — pure-helper unit tests
npm run generate:capabilities   # regenerate src/data/capabilities.json from the engine
```

All dependency versions are pinned exactly in `package.json`
(no caret/tilde ranges).

## What it does

Four tabs, all real operations — no decorative controls:

- **Convert** — drag-and-drop or file picker, local preview, format
  detected from magic bytes (not the extension), dimensions from the
  browser decoder, output format selector (only formats the browser
  can encode), JPEG/WebP quality slider, PNG compression selector,
  background colour for alpha flattening, metadata-policy selector,
  Convert and Download buttons, loading / error / success states.
- **Batch** — file list with thumbnails, per-file source/target
  format, status and per-file errors; converts up to 4 files at once
  (configurable in Settings); individual downloads, plus
  "Download all as .zip" (client-side, via jszip). A failed file
  never stops the batch.
- **Formats** — the capability dashboard: all 21 engine formats from
  the registry, with an honest "In browser" column.
- **Settings** — theme (system/light/dark), default quality, default
  output format, default background colour, batch concurrency,
  reset/clear (both work).

## What converts where (honest)

In-browser, via canvas in a Web Worker (`src/worker.ts`, with a
main-thread fallback if the worker cannot start):

| | Sources | Targets |
|---|---|---|
| Browser (canvas) | PNG, JPEG, WebP, GIF (first frame), BMP, SVG (rasterised), AVIF (only if the browser decodes it) | PNG, JPEG, WebP, BMP |

Everything else the engine supports — TIFF, TGA, ICO, PNM, QOI,
AVIF/JXL/HDR/EXR/JPEG 2000 encode, HEIC/HEIF, RAW, PSD — needs the
native CLI (`openpixel convert`) or the desktop app. The UI says so
wherever those formats appear instead of offering a broken button.

Canvas conversion always strips metadata (EXIF/ICC/XMP): the
metadata selector says so, and "Preserve" warns that the CLI is
needed to keep metadata.

## Capability data — generated, never hand-written

`src/data/capabilities.json` is generated from the Rust registry by
`scripts/generate-capabilities.mjs`, which runs
`../../target/release/openpixel --json formats` (build the CLI first
with `cargo build --release`) and refuses to write the file if the
binary is missing, the output is not JSON, or the list has fewer
than 21 entries / missing fields. Regenerate it whenever the engine
registry changes. Verified 16 Nov 2026: regeneration reproduces the
checked-in file byte-for-byte.

## WASM status — not available in this build

See `docs/WEB.md` for the full evidence. Short version: the
`wasm32-unknown-unknown` target is installed and
`openpixel-formats` (pure Rust detection) builds to WASM, but the
full engine does not — `dav1d-sys` (the AVIF decoder's C binding)
fails its build script because pkg-config is not configured for
wasm32 cross-compilation and there is no wasm32 libdav1d sysroot
here. `wasm-pack` is not installed. No WASM module is shipped and
the UI states this plainly.

## Tests

`npm test` — 17 tests (Vitest, node environment): magic-byte
detection mirroring the Rust detector, and capability filtering /
format-option generation from the generated data. The build itself
(`npm run build`) is the render smoke test; manual verification
(checklist in `docs/TESTING.md`) covers serving the production
build and the real conversion flows in a browser.
