# Web e2e — real-browser checks (follow-up item 4, 16 Nov 2026)

Playwright scripts that drive the production build in the real
Chromium already cached on this machine
(`~/.cache/ms-playwright/chromium-1248/`). No browser is installed
by these scripts and no page is faked: every conversion downloads
a real file whose bytes are re-detected with `file(1)` and the
CLI's own `openpixel info`.

## Setup

```bash
# one-off: playwright-core only (the browser binary is already cached)
mkdir -p /tmp/op-e2e/pw && cd /tmp/op-e2e/pw
npm install playwright-core@1.55.0 --no-audit --no-fund

# build + serve the production web app (from the repo root)
cd apps/web && npm run build
cd dist && python3 -m http.server 8321 --bind 127.0.0.1
```

Fixtures are generated on the fly by `scripts/test/cli-e2e.sh`
(Pillow) into `/tmp/op-e2e/cli/in/` — run that first, or copy any
real PNG/JPEG/TIFF/HEIC/GIF into that directory with the same names.

## Run

```bash
node apps/web/e2e/web-e2e.mjs        # 37 checks, Chromium vs :8321
node apps/web/e2e/web-nowasm.mjs     # 9 checks, WASM-absent fallback vs :8322
```

For the fallback run, serve a copy of `dist/` with `public/wasm/`
removed on port 8322 first:

```bash
rm -rf /tmp/op-e2e/web-nowasm && cp -r apps/web/dist /tmp/op-e2e/web-nowasm
rm -rf /tmp/op-e2e/web-nowasm/wasm
cd /tmp/op-e2e/web-nowasm && python3 -m http.server 8322 --bind 127.0.0.1
```

## What each script checks

`web-e2e.mjs` — page load with zero failed requests/console errors;
WASM module served over plain HTTP and detected by the UI; PNG→JPEG
via canvas with the downloaded bytes re-detected as JPEG; a PNG
named `.jpg` detected as PNG (signature wins); TIFF→PNG and
HEIC→PNG via the WASM engine with the "Converted with the built-in
WASM engine" note; PNG→HEIC via WASM re-detected as HEIC;
PNG→BMP via the WASM engine re-detected as a real BMP (the canvas
cannot encode BMP — see below); QOI source → PNG via WASM;
PNG→TIFF/QOI/JXL via WASM, each re-detected; ICO via WASM — 64×64
PNG→ICO re-detected as a real ICO with no resize note, and a
1024×768 photo→ICO auto-resized to 256×192 (ICO caps at 256×256)
with the "Resized to 256×192 for ICO" note shown (see docs/E2E.md
§2.18); SVG→JPEG via the WASM
engine (resvg — `createImageBitmap` rejects SVG blobs, so the
canvas path can never convert SVG; see docs/E2E.md §2.17); GIF
first-frame note + GIF→WebP; batch of 3 files incl. an unsupported
`.txt` (skipped with a reason) with the downloaded zip verified to
contain 2 real WebP files; Formats tab lists 21 formats; theme
toggle light/dark persists across reload; keyboard-only Tab to the
drop zone + Enter opens the file picker. Screenshots land in
`screenshots/` (`01-home.png` … `09-settings-dark.png`,
`14-polish-qoi.png`, `15-svg-wasm.png`, `16-ico-resize.png`).

`web-nowasm.mjs` — with `public/wasm/` removed: the app loads and
the intro no longer claims WASM targets; PNG→JPEG still converts
via canvas; SVG→JPEG still converts via the `<img>` fallback
(probe reads dimensions from the element); a TIFF upload fails
honestly ("This browser cannot decode this image. Try the native
CLI instead.") with the sniffed format still shown ("Detected
format: TIFF"), no misleading "Conversion failed" label, and
Convert disabled — no crash. The missing `openpixel_wasm.js` logs
one expected 404 in the console. Screenshots `10-nowasm-home.png`,
`11-nowasm-tiff.png`, `12-nowasm-svg.png`.

## Known notes (see docs/E2E.md)

- One `net::ERR_ABORTED` for `openpixel_wasm_bg.wasm` was observed
  once during the main run — a navigation abort while the page was
  reloaded for the theme-persistence check, not an app failure
  (every WASM conversion in the run passed).
- BMP is a WASM target, not a canvas target: `canvas.toBlob` with
  `image/bmp` silently returns PNG, so a "BMP" download used to be
  PNG bytes named `.bmp` (caught by the polish run on 16 Nov 2026
  and fixed by routing BMP to the WASM engine). Without the WASM
  module BMP is not offered as a target at all.
- The no-WASM TIFF label/format issue ("Detected format: Unknown"
  + misleading "Conversion failed") was fixed in the same polish
  run: `probeImage` now throws a `ProbeError` carrying the sniffed
  format.
