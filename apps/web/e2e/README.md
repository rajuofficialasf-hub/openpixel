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
node e2e/spa-server.mjs 8321   # SPA fallback — see below
```

> **Do NOT serve with `python3 -m http.server`.** The app is a
> single-page app: deep links (`/pdf`, `/formats`, …) must serve
> `index.html`, and python's server 404s them. That breaks any
> suite that reloads on a routed page (web-e2e reloads on
> `/formats` for the theme-persistence check — with python it
> "failed" and `#tab-settings` timed out, 17 Nov 2026). Use
> `apps/web/e2e/spa-server.mjs` instead — same fallback rule as
> `public/_redirects` on Cloudflare Pages. It also runs from
> `/tmp/op-e2e/pw/` (the copied scripts live there), but then the
> dist dir must be passed explicitly:
> `node spa-server.mjs 8321 /home/hatch/workspace/openpixel-engine/apps/web/dist`.
> routing-e2e.mjs starts its own instance on 8325 and needs no
> external server.

Fixtures live in `/tmp/op-e2e/cli/in/` and are wiped with /tmp —
regenerate them with Pillow + the CLI (17 Nov 2026 recipe):

```bash
python3 scripts/test/gen-web-fixtures.py   # rgba.png, photo.jpg, lying.jpg,
                                    # multi.tiff, checker-64.png, anim.gif,
                                    # notes.txt, corrupt.png, simple.svg,
                                    # hand-built minimal mini.psd
./target/release/openpixel convert /tmp/op-e2e/cli/in/checker-64.png /tmp/op-e2e/cli/in/checker-64.heic
./target/release/openpixel convert /tmp/op-e2e/cli/in/rgba.png /tmp/op-e2e/cli/in/sample.qoi
./target/debug/openpixel pdf from-images -o /tmp/op-e2e/pdf-in/doc4.pdf \
  /tmp/op-e2e/cli/in/rgba.png /tmp/op-e2e/cli/in/photo.jpg \
  /tmp/op-e2e/cli/in/checker-64.png /tmp/op-e2e/cli/in/rgba.png
./target/debug/openpixel pdf from-images -o /tmp/op-e2e/pdf-in/doc2.pdf \
  /tmp/op-e2e/cli/in/rgba.png /tmp/op-e2e/cli/in/photo.jpg
```

`scripts/test/cli-e2e.sh` does NOT generate these — it expects them
(and builds its §11 Office fixtures + §13 PDF fixtures inline).
The CLI run additionally needs `photo-2048.heic` (2048px noisy PNG
→ HEIC via the CLI), `doc2.pdf`/`doc3.pdf` in `cli/in/` (same
`pdf from-images` command, 2 and 3 pages), `test.svg` (copy of
`simple.svg`), the OCR crate fixtures copied in
(`crates/openpixel-ocr/tests/fixtures/eng-clean.png`,
`eng-clean.txt`, `ben-clean.png`, `ben-clean.txt`,
`eng-skewed.png`), and `python-pptx` installed
(`pip install --user --break-system-packages python-pptx` —
a VM reset removes it). A VM reset also wipes the Tesseract dev
provisioning — re-run `docs/OCR.md` §Provisioning before any
cargo build that touches `openpixel-ocr`.

## Run

```bash
node apps/web/e2e/web-e2e.mjs        # 37 checks, Chromium vs :8321
node apps/web/e2e/web-nowasm.mjs     # 9 checks, WASM-absent fallback vs :8322
node apps/web/e2e/resize-e2e.mjs     # 16 checks, Resize tab vs :8321
node apps/web/e2e/pdf-e2e.mjs        # 24 checks, PDF tab vs :8323
node apps/web/e2e/ocr-e2e.mjs        # 14 checks, OCR tab vs :8324
node apps/web/e2e/routing-e2e.mjs    # 9 checks, URL routing; starts its own SPA server on :8325
node apps/web/e2e/viewport-qa.mjs    # 27 checks: no horizontal overflow vs :8321 + PDF viewport-fit (empty/loaded at 1366x768 and 1440x900, 200-page PDF at 1440x900; needs /tmp/op-e2e/pdf-in/doc4.pdf and big200.pdf)
```

Serve `apps/web/dist` on port 8323 for the PDF run the same way
as 8321 above (`node apps/web/e2e/spa-server.mjs 8323` from the
repo root). Its fixtures are two real PDFs in
`/tmp/op-e2e/pdf-in/` (`doc4.pdf`, 4 pages; `doc2.pdf`, 2 pages),
generated with the debug CLI (`openpixel pdf from-images` on the
`/tmp/op-e2e/cli/in/` PNG/JPEG fixtures) — regenerate them with
those commands if `/tmp` was wiped. The Phase 5 Edit checks use
a third fixture, `text2.pdf` (2 pages of real text), which the
script builds itself in JS at startup (programmatically
computed xref offsets) — no regeneration needed.

Serve `apps/web/dist` on port 8324 for the OCR run the same way.
Its fixtures are the Rust crate's accuracy fixtures
(`crates/openpixel-ocr/tests/fixtures/eng-clean.png`,
`ben-clean.png`) — no generation needed, they are committed.

For the fallback run, serve a copy of `dist/` with `public/wasm/`
removed on port 8322 first:

```bash
rm -rf /tmp/op-e2e/web-nowasm && cp -r apps/web/dist /tmp/op-e2e/web-nowasm
rm -rf /tmp/op-e2e/web-nowasm/wasm
node apps/web/e2e/spa-server.mjs 8322 /tmp/op-e2e/web-nowasm
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

`resize-e2e.mjs` — the Resize tab (16 Nov 2026): tab renders with
exactly the 16 browser targets (no AVIF); aspect lock 512→384 on a
1024×768 photo; ResizeFit 800×600 downloads a real JPEG 800×600
with the WASM/Lanczos3 note; target-size 50 KB JPEG fits (≤ 51 200
B) with "target size met" and the quality slider disabled;
never-upscale clamps a 256×192 source asked for 800×600; batch of
2 files with the zip verified to contain 2 resized JPEGs. The
result line reports the honest change ("3% larger" when a
re-encode grows the file — see docs/E2E.md §2.19). Screenshots
`17-resize-tab.png` … `20-resize-batch.png`.

`pdf-e2e.mjs` — the PDF tab, Studio Phase 2 (16 Nov 2026; see
docs/E2E.md §2.20), extended Phase 3: tab renders; a real 4-page
PDF uploads and its info shows the true page count (just the
number — the "Pages | Pages: 4" duplication is fixed), version
and page sizes; pdf.js preview actually paints page 1 (canvas
512×384 at the default 2× scale — a broken worker would leave it
blank); PDF→PNG downloads a genuine PNG at the requested
dimensions (`file` + `openpixel info`); merge (4+2 pages)
downloads a real 6-page PDF; split downloads one real PDF per
range; rotate and extract download real PDFs with the right page
counts; compress (screen mode) downloads a real 4-page PDF no
bigger than the input, with the measured sizes in the status
line; images→PDF builds a real 2-page PDF; dark-mode screenshot.
Screenshots `21-pdf-tab.png` … `23-pdf-dark.png`.

`ocr-e2e.mjs` — the OCR tab, Studio Phase 4 (17 Nov 2026; see
docs/E2E.md §2.21): tab renders; no worker / core / traineddata
file is fetched before the user runs OCR (on-demand loading);
the English accuracy fixture recognises to the known words with
mean confidence shown (94.0%, 30 words); the recognised text
downloads as a real .txt; the Bengali fixture recognises line 1
exactly (85.0%, 16 words — lines 2–3 have errors with
tessdata_fast, see docs/OCR.md); no request leaves the local
origin (any CDN fetch fails the run); zero console/page errors.
Screenshots `24-ocr-tab.png` … `26-ocr-dark.png`.

`routing-e2e.mjs` — URL routing (17 Nov 2026; see docs/E2E.md
§2.23): deep links `/pdf` and `/convert` load directly; sidebar
navigation pushes the URL; browser back/forward change the page;
refresh on `/ocr` stays on OCR; sidebar Settings click pushes
`/settings`; unknown `/nope` lands on home with the URL corrected
to `/`. Starts its own SPA-fallback server on :8325 — no external
server needed, no fixtures.

`viewport-qa.mjs` — no horizontal overflow at 360×800 / 768×1024 /
1440×900 on Home, All Tools, Convert, PDF tab and Settings.

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

## Live matrix (`live-matrix.mjs`) — every format on the deployed site

Tests all 16 browser targets (from PNG) and all 18 decodable sources
(to PNG) against the LIVE site (default `https://openpixel.pages.dev/`),
one by one, verifying each downloaded output with `file` + `openpixel
info`. Also checks the lying-extension case, PSD detection-only, and
that AVIF is not offered as a browser target. 57 checks; first full run
16 Nov 2026: **57/57 passed**.

Run from this VM (the local Chromium cannot complete the egress proxy's
auth flow, so it goes through the loopback forward proxy, which adds the
preemptive auth from its own env — start both in the SAME exec, the
token rotates per exec session):

```
cd apps/web/e2e
(node egress-proxy.mjs > /tmp/op-e2e/egress-proxy.log 2>&1 &)
node live-matrix.mjs
```

Fixtures are CLI-generated into `/tmp/op-e2e/live-in` (regenerate with
`openpixel convert` from `rgba.png`/`checker-64.png` if `/tmp` was
wiped). Results are written to `/tmp/op-e2e/live-matrix-results.json`.
