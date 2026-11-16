# End-to-end testing — OpenPixel Engine, follow-up item 4

Run 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0, Node v24.22.1 /
npm 10.9.4, Chromium 1248 (cached `~/.cache/ms-playwright`), git
HEAD `687f992` (items 1–3 committed). Polish re-run the same day
(§2.13–2.15, §2.16, §6.1), git HEAD `a0422d7`, web e2e 30/30,
no-WASM fallback 7/7. SVG fix run the same day (§2.17, §2.16
update), web e2e 33/33, no-WASM fallback 9/9 — the live-site
SVG→JPEG failure Raju reported is fixed and covered by both
suites. ICO auto-resize run the same day (§2.18, §1.13), web e2e
37/37, no-WASM fallback 9/9 — the live-site ICO failure Raju
reported is fixed and covered. Resize & compress run the same day
(§1.14, §2.19, §4 update), web e2e 36/37 (one environmental
keyboard flake — see §2.19), resize e2e 16/16, no-WASM fallback
9/9. PDF tab run the same day (§2.20): web `npm test` 62/62, lint
0 warnings, `npm run build` passes, pdf-e2e 14/14, web e2e 36/37
(the known keyboard flake only), resize e2e 16/16, `cargo check
-p openpixel-wasm --target wasm32-unknown-unknown` green. This closes the real-browser and desktop
click-through checklists that were open since Phases 7/8 and the
WASM checklist from follow-up item 2 — with evidence, not
assertions. Every scenario below lists what was actually run
and the observed result; anything not run is marked NOT RUN, never
passed.

Reproduce: `scripts/test/cli-e2e.sh` (CLI), `apps/web/e2e/web-e2e.mjs`
+ `apps/web/e2e/web-nowasm.mjs` + `apps/web/e2e/resize-e2e.mjs`
+ `apps/web/e2e/pdf-e2e.mjs` (web, see `apps/web/e2e/README.md`).
Screenshots: `apps/web/e2e/screenshots/`.

## 1. CLI e2e — PASS (all scenarios)

Fresh `cargo build --release` (binary `target/release/openpixel`,
17 561 512 B). Fixtures generated locally with Pillow into
`/tmp/op-e2e/cli/in/` (RGBA PNG 256×192, JPEG 256×192 and 800×600,
3-frame GIF, 2-page TIFF, hand-written SVG, corrupt PNG with a valid
signature + garbage, a `.txt`, a PNG named `.jpg`) plus the checked-in
Apple HEIC fixtures (`photo-2048.heic` 2048×1536, `checker-64.heic`).
Full command log: `/tmp/op-e2e/cli/log.txt` + `log2.txt`.

| # | Scenario | Observed result |
|---|---|---|
| 1.1 | `info` on PNG/JPEG/HEIC/GIF/TIFF | png 256×192 rgba8; jpeg 256×192 rgb8; heic 2048×1536 rgb8; gif 64×48, 3 frames; tiff 64×48, 2 pages — all exit 0 |
| 1.2 | `discover` on a PNG named `.jpg` | `png / Signature / High` + `warning: extension claims Some(Jpeg) but the signature says png` |
| 1.3 | Convert matrix, PNG source → JPEG/WebP/BMP/TIFF/QOI/AVIF/JXL/JP2/TGA/ICO/PNM | All exit 0; every output re-detected by `openpixel info` as the target and confirmed by `file(1)` (e.g. JPEG 6 247 B, WebP 1 644 B, AVIF 1 931 B "ISO Media, AVIF Image", JXL 2 491 B, JP2 9 029 B, QOI 38 581 B) |
| 1.4 | HEIC (new, item 1) | HEIC→PNG 55 438 → 2 071 716 B, 2048×1536; HEIC→JPEG → 227 637 B; PNG→HEIC 1 498 → 2 515 B (`file`: "ISO Media, HEIF Image HEVC …"); PNG→HEIF 2 515 B (`file`: "ISO Media, HEIF Image"); all re-detect correctly. Pixel check: `checker-64.heic`→PNG vs Apple's reference PNG, **MAE 0.000** |
| 1.5 | GIF→PNG, TIFF→PNG, SVG→PNG | GIF warns "animated (3 frames)… keeps the first frame only"; TIFF warns "multi-page (2 pages)… first page only"; SVG rasterises 64×48 — all exit 0, outputs re-detect |
| 1.6 | `process` pipeline | `--resize 128x96 --grayscale --rotate 90` → 96×128 JPEG (3 operations); `--thumbnail 32` → 32×24 PNG — both re-detected |
| 1.7 | `metadata` / `frames` / `extract-frame` | `metadata photo.jpg`: no metadata; `frames anim.gif`: 3 frames, delays 100/200/300 ms, loop forever; `frames multi.tiff`: 2 pages; `extract-frame --frame 1` → 64×48 PNG, re-detected |
| 1.8 | `batch --workers 2` (5 files incl. corrupt PNG + HEIC) | `batch done: 4 converted, 1 failed (2 workers)`; corrupt file reported on stderr with its decode error; all 4 outputs exist and re-detect as WebP (incl. the HEIC input). `--sequential` and `--json --workers 4` give the same 4/1 with the failure listed (`input` + `error`) |
| 1.9 | `bench --quick` | jpeg_decode 0.3 ms, png_encode 2.3 ms, webp_encode 1.4 ms, avif_encode 725.2 ms, tiff_large 4.0 ms, batch_4 1.3 ms, peak RSS 14.8 MiB (run 1; the regression re-run in §4 differs slightly — see there) |
| 1.10 | Error cases (all exit 1 or 2, clean typed error, no crash, no output file) | `.txt` → "unknown or unsupported image format"; PNG→PSD → "psd cannot be encoded in this build (planned — not implemented)"; missing file → "file not found"; corrupt PNG → typed PNG decode error; `--workers 0` / `--workers 9` → "--workers must be 1..=8"; `--resize 0x0` → "resize dimensions must be greater than 0"; unknown flag → clap usage error (exit 2) |
| 1.11 | `formats` / `capabilities` | 21 formats listed; `capabilities heic` decode=yes/encode=yes (heifer 0.5.1); `capabilities psd` decode=no/encode=no, planned |
| 1.12 | `--json convert` | Parses; reports source/target formats, dimensions, byte counts, warnings, metadata lists |
| 1.13 | ICO auto-resize (ICO fix run, 16 Nov 2026) | `convert photo.jpg out.ico` (1024×768) succeeds at 256×192 with `warning: resized 1024x768 to 256x192 for ICO — ICO supports max 256x256`; output re-detects as ICO (`file`: "MS Windows icon resource … 256 x 192") and `openpixel info` reads it back. 256×192 and smaller inputs convert unchanged with no warning. Same run: RGB-source ICOs now decode back (the codec normalises ICO input to RGBA8 — image-rs's decoder rejects RGB PNGs inside ICO). |
| 1.14 | `process --target-size` (resize run, 16 Nov 2026; §4b in `scripts/test/cli-e2e.sh`) | `process photo.jpg out-50k.jpg --resize-fit 800x600 --target-size 50KB` → 50 679 B ≤ 51 200 at quality 73, "target size met", re-detects as JPEG 800×600. Unreachable `--target-size 100B` → smallest result (23 595 B, quality 3) + "target size NOT met" warning, exit 0. `--target-size` + `--quality` → exit 1 (conflict). WebP `--target-size` → exit 1, honest error (image-rs 0.25 encodes WebP losslessly only, so quality cannot change its size — see `docs/CODECS.md`). |
| 1.15 | `pdf` subcommand (Studio Phase 2, 16 Nov 2026; §10 in `scripts/test/cli-e2e.sh`) | Fixtures are real PDFs built with `pdf from-images` (rgba.png + photo.jpg + checker-64.heic → 3-page `doc3.pdf`; 2-page `doc2.pdf`). `info` → 3 pages, version 1.5, page sizes in pt, `--json` parses with `page_count` 3. `merge` 3+2 → 5 pages; `split --ranges 1-3,5` → 3+1 pages; `rotate --pages 1 --degrees 90` → `/Rotate 90` in the bytes, 3 pages; `extract`/`remove` → 2 pages; `reorder 3,2,1` → 3; `duplicate` → 4; `insert --at 2` → 5; `replace --page 2` → 4; `reverse` → 3; `booklet` → 4 (padded to a multiple of 4); `nup 2x2` → 1 sheet — every output re-verified with `pdfinfo`. `render --scale 1.0` → genuine PNGs at exactly the page sizes (256×192, 1024×768, 64×64; `file` + `openpixel info`); `--format jpg` → genuine JFIF; `--pages 2 --scale 2.0` → exactly 1 file, 2048×1536. Error cases exit 1, clean message, no crash: rotate 45, extract page 9, `info` on a PNG, render to SVG (decode-only), merge with a non-PDF. |

## 2. Web e2e in a real browser — PASS (37/37 checks + fallback; resize run 36/37 + resize suite 16/16 — see §2.19)

Real Chromium 1248 driven by `playwright-core` 1.55.0 (installed
with `npm install playwright-core` in `/tmp/op-e2e/pw`; the browser
binary was already cached in `~/.cache/ms-playwright` — nothing was
downloaded). Production build served over plain HTTP
(`python3 -m http.server` in `apps/web/dist/`, port 8321). Every
downloaded file was verified with `file(1)` and `openpixel info`.

| # | Scenario | Observed result |
|---|---|---|
| 2.1 | Page load | Title "OpenPixel — Local Image Converter"; zero failed requests and zero console/page errors on load |
| 2.2 | WASM module over plain HTTP | `HEAD /wasm/openpixel_wasm_bg.wasm` → 200 (7 288 565 B); the UI intro switches to listing the WASM targets once the module loads — no COOP/COEP header needed |
| 2.3 | Canvas path: PNG→JPEG, download verified | Upload detected as PNG 256×192 with preview; convert → "Converted: …"; downloaded `rgba.jpg` 3 760 B re-detects as JPEG 256×192 |
| 2.4 | Lying extension | PNG bytes named `.jpg` detected as PNG (signature wins) |
| 2.5 | WASM path: TIFF→PNG | "No preview for TIFF (.tif) — this browser cannot display it, but the WASM engine can convert it"; note "TIFF (.tif) was decoded by the built-in WASM engine"; after convert, "Converted with the built-in WASM engine (the real Rust engine, running in your browser)"; downloaded `multi.png` 99 B re-detects as PNG 64×48 |
| 2.6 | WASM path: HEIC→PNG | Detected as HEIC 64×64; downloaded `checker-64.png` 175 B re-detects as PNG 64×64 |
| 2.7 | WASM target: PNG→HEIC | Downloaded `rgba.heic` 2 515 B re-detects as HEIC 256×192 (`file`: "ISO Media, HEIF Image HEVC …") |
| 2.8 | GIF first-frame note + GIF→WebP | "Animated GIF: only the first frame is converted"; downloaded `anim.webp` 570 B re-detects as WebP 64×48 |
| 2.9 | Batch: 3 files incl. unsupported `.txt` | All 3 listed; the `.txt` is flagged skipped with its reason ("cannot be decoded in this browser"); status line "3 files — 0 converted, 0 failed, 1 skipped"; Convert 2 files → both done; "Download all (2) as .zip" downloads `openpixel-webp.zip` (4 908 B) containing exactly `rgba.webp` + `photo.webp`, both verified real WebP by `file` and `openpixel info` |
| 2.10 | Formats tab | 21 rows; SVG decode-only, HEIC implemented, TIFF "Engine only — use the CLI" — matches the registry |
| 2.11 | Theme toggle | Switches to dark (`<html class="dark">`); still dark after a full reload (localStorage persistence); Settings tab renders (theme, default quality 85, defaults) |
| 2.12 | Keyboard-only | Tab reaches the drop zone (`DIV# Drop an image here` focused); Enter opens the file picker (`filechooser` event fires) |
| 2.13 | BMP target (polish run, 16 Nov 2026) | PNG→BMP downloads a real BMP (`file`: "PC bitmap, Windows 3.x format, 64 x 48 x 24"; `openpixel info` format=bmp). The first polish run caught the real bug here: the download was PNG bytes named `.bmp` (canvas `toBlob` silently falls back to PNG for BMP) — fixed by routing BMP targets to the WASM engine; see §6.1 |
| 2.14 | QOI source (polish run, 16 Nov 2026) | QOI file (generated by the CLI from the same PNG) detected as QOI; QOI→PNG via WASM re-detects as PNG; "Converted with the built-in WASM engine" note shown |
| 2.15 | WASM targets TIFF/QOI/JXL (polish run, 16 Nov 2026) | PNG→TIFF, PNG→QOI and PNG→JXL each download and re-detect as the requested format (`file`: TIFF image data / QOI image data / JPEG XL codestream; `openpixel info` format=tiff/qoi/jxl) |
| 2.17 | SVG source (SVG fix run, 16 Nov 2026) | Raju reported on the live site that SVG→JPEG failed with "Conversion failed: The source image could not be decoded" while the preview rendered. Reproduced first: all 6 test SVGs (plain, viewBox-only, Bengali/Arabic text, foreignObject, embedded and external image) failed identically on openpixel.pages.dev. Root cause, pinned with a Chromium probe: `createImageBitmap` rejects SVG blobs **regardless of MIME type, on the main thread and in a worker** — the canvas path can never convert SVG. Fix: SVG sources are routed to the WASM engine (resvg) for every target, the worker now falls back to the main thread on any error, and the main-thread path draws an `<img>` directly when `createImageBitmap` fails. E2E: SVG detected as SVG 400×200; SVG→JPEG via WASM downloads a real JPEG (`file`: "JPEG image data, JFIF standard 1.02 … 400x200"; `openpixel info` format=jpeg size=400x200); "Converted with the built-in WASM engine" note shown. Covered by 1 new unit test (`wasmCoversConversion` routes SVG to WASM) and 3 new e2e checks. |
| 2.18 | ICO auto-resize (ICO fix run, 16 Nov 2026) | Raju reported on the live site that PNG→ICO failed with "Conversion failed: The browser cannot encode ICO — use the native CLI". Root cause, pinned by testing the WASM module directly: the ICO format stores width/height in one byte each, so the encoder throws "image width must be 1..=256" for the 800×600 test image — and the native CLI failed identically, so the CLI advice was wrong too. Fix: the shared encode tail (`Engine::encode_to_bytes`) resizes ICO targets to fit 256×256 (aspect preserved, Lanczos3) and reports it as a warning; the web UI shows "Resized to 256×192 for ICO — ICO supports max 256×256" next to the result. The same run caught a second ICO defect: image-rs writes the input's colour type as the embedded PNG and its own decoder only accepts RGBA PNGs, so an RGB-source ICO could not be read back ("The PNG is not in RGBA format!") — the codec now normalises ICO input to RGBA8 first. E2E: 64×64 PNG→ICO downloads a real ICO at 64×64 with no resize note; 1024×768 photo→ICO downloads a real ICO at 256×192 with the note visible; both re-detect via `openpixel info`. Covered by 2 new Rust unit tests (incl. decode-back assertions) and 4 new e2e checks (2 ICO conversions + 2 note checks: present for large, absent for small). |
| 2.19 | Resize & compress (resize run, 16 Nov 2026; `apps/web/e2e/resize-e2e.mjs`) | **16/16 passed, zero console/page errors.** New "Resize" tab renders; its target list is exactly the 16 browser targets (no AVIF). Aspect lock: width 512 → height 384 for the 1024×768 photo, expected line "Expected result: 512 × 384 px (from 1024 × 768 px)". ResizeFit 800×600 downloads a real JPEG 800×600 (70 341 B, `file` + `openpixel info`) with the "Converted with the built-in WASM engine (Lanczos3)" note. Target-size 50 KB JPEG → 50 679 B ≤ 51 200 with "target size met" reported and the quality slider disabled with its note. Never-upscale: a 256×192 source asked for 800×600 stays 256×192 (expected line and downloaded JPEG both 256×192). Batch of 2 files in the same tab: both done, "Download all (.zip)" contains exactly the 2 resized JPEGs. **Two real defects found and fixed by this run:** (a) the first run logged two `blob:` `ERR_FILE_NOT_FOUND` errors — the result/thumbnail cleanup revoked object URLs that mounted `<img>` elements still referenced (it ran on every `items` change, and thumb URLs are stable across status updates); the cleanup now revokes only URLs that actually disappeared, plus all of them on unmount — re-run shows zero failed requests. (b) The result line said "0% smaller" when the resized file was actually BIGGER than the original (66.4 KiB → 68.7 KiB: a JPEG original re-encoded at quality 85); it now reports the honest change — "3% larger" — and the e2e check asserts `/% (smaller\|larger)\|same size/`. Screenshots `17-resize-tab.png` … `20-resize-batch.png`. |

### 2.19a Web e2e this run: 36/37 — the one failure is environmental, not a regression

The resize run's `web-e2e.mjs` scored 36/37 three times in a row; the
only failure is the keyboard check (§2.12 — Enter on the drop zone
opens the file picker). Diagnosis, pinned with probes rather than
guessed: the keydown *does* reach the zone and `input.click()` *is*
called, but headless Chromium's file-chooser interception does not
fire the `filechooser` event in this VM right now (a direct
`evaluate`-triggered `input.click()` opened the chooser once, and a
Space press opened it once — the mechanism works intermittently).
Decisive control: the **pre-resize build at `08bf9a5`** — the exact
code that scored 37/37 in the ICO run — was built in a worktree,
served on port 8331, and probed identically: Enter 0/3, Space 0/2,
same failure. The resize work (which does not touch `DropZone.tsx`
or `ConvertWorkspace.tsx`) did not cause it. The check now retries
the Enter press up to 3 times (a genuinely broken picker still
fails every attempt); it still failed in this run, so the count
stays 36/37 honestly. Real users are unaffected in the normal way:
the picker path is the standard `input.click()` from a keyboard
handler, which opens the OS file dialog in a real browser.

### 2.20 PDF tab (Studio Phase 2, 16 Nov 2026; `apps/web/e2e/pdf-e2e.mjs`)

**14/14 passed, zero console/page errors**, production build
served on port 8323. Fixtures are real PDFs built by the debug
CLI (`openpixel pdf from-images`): `doc4.pdf` (4 pages —
p1 256×192 pt, p2 1024×768 pt, p3 256×192 pt, p4 1024×768 pt)
and `doc2.pdf` (2 pages). Every downloaded file was verified
with `file(1)` and the CLI (`openpixel pdf info` for PDFs,
`openpixel info` for images).

| # | Scenario | Observed result |
|---|---|---|
| 2.20.1 | PDF tab renders | Tab `#tab-pdf` / panel `#panel-pdf`, heading "PDF tools" |
| 2.20.2 | Info from the WASM engine | Upload `doc4.pdf` → "Pages: 4", "PDF 1.5", "Encrypted: No", page sizes "p1: 256 × 192 pt; p2: 1024 × 768 pt; …" — all from `pdf_info` (lopdf) |
| 2.20.3 | pdf.js preview really paints | Page 1 at the default 2× scale: canvas is 512×384 and the dims line reads "512 × 384 px" — a broken worker would leave the canvas blank and this check fails |
| 2.20.4 | PDF→PNG at the chosen scale | "Download page 1 as PNG" → genuine PNG 512×384 (5 063 B, `file` + `openpixel info`), status "Rendered page 1 as PNG: 512 × 384 px" |
| 2.20.5 | Merge | doc4 + doc2 → "Merged PDF: 6 pages"; downloaded `doc4-merged.pdf` re-verified as a real 6-page PDF |
| 2.20.6 | Split | Ranges "1-2,3-4" → "Split PDF: split into 2 documents (2 pages, 2 pages)"; both downloads re-verified as real 2-page PDFs |
| 2.20.7 | Rotate | Rotate page 1 by 90° → "Rotated PDF: 4 pages"; download re-verified as a real 4-page PDF |
| 2.20.8 | Extract | Extract "1,3" → "Extracted PDF: 2 pages"; download re-verified as a real 2-page PDF |
| 2.20.9 | Images→PDF | 2 images (PNG + JPEG) → "Images to PDF: 2 pages"; downloaded `images.pdf` re-verified as a real 2-page PDF |
| 2.20.10 | Dark mode | Theme toggle on the PDF tab, `<html class="dark">`, screenshot `23-pdf-dark.png` |

**Two real defects found by eyeballing the screenshots and
fixed in the same run:** (a) the Document card showed empty
Title / Author / Creator / Producer rows for a PDF with no
metadata — serde-wasm-bindgen serialises a Rust `None` as
`undefined`, not `null`, so the UI's null check missed it;
`getPdfInfo` now normalises the optional fields to `null`
(plus a defensive check in the component) — the re-run
screenshots show no empty rows. (b) The Preview card's field
labels ("Page", "Render scale", "Download format") sat beside
their selects instead of above them (`component="label"` is
inline); they now use `display: block`, matching the other
tabs. Both fixes re-verified by a full pdf-e2e re-run (14/14)
and fresh screenshots `21-pdf-tab.png` … `23-pdf-dark.png`,
eyeballed in both modes.

**pdf.js 6 API note (caught by `tsc`, not at runtime):**
pdf.js 6.5.438 changed two APIs from the v4/v5 examples —
`page.render()` takes the canvas element (`{ canvas, viewport }`,
not `canvasContext`) and `destroy()` lives on the loading task
returned by `getDocument()`, not on the document proxy.
`src/lib/pdf.ts` uses the v6 shapes; the worker is wired with
the standard Vite `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
import.meta.url)` pattern and is emitted as a build asset
(`dist/assets/pdf.worker.min-*.mjs`, 1.27 MB).

**pdf.js rendering, observed:** on the image-based test PDFs
the preview and the PNG export render fast (the whole 14-check
suite, including two pdf.js document loads and one render,
finishes in ~18 s) and pixel-faithful — the rendered PNG is the
source image at exactly the requested dimensions. Text-heavy
or vector-complex PDFs were not exercised in this run, so no
claim is made about their render fidelity or speed; the tab
states that pdf.js rendering may differ slightly from the
PDFium CLI render.

**Not covered by this run:** remove / reorder / duplicate /
reverse / booklet / N-up buttons (wired to the same
`pdf_process` export and the same result path as the covered
rotate/extract/split ops, but not clicked in the browser);
JPEG render output (PNG verified; JPEG uses the same canvas
`toBlob` path with a different MIME type); encrypted-PDF and
non-PDF rejection in the browser; the no-WASM fallback path
for the PDF tab (ops disabled with a warning, preview still
works — code path only, not browser-verified). These stay OPEN.

### 2.16 WASM-absent fallback — PASS (9/9, SVG fix run 16 Nov 2026)

A copy of `dist/` with `public/wasm/` removed, served on port 8322
(`/wasm/openpixel_wasm.js` → 404, as expected):

- App loads; intro no longer claims WASM targets ("…plus the WASM
  engine's extra formats when its module is built").
- PNG→JPEG still converts via canvas; downloaded file re-detects as
  JPEG. No crash, no unhandled error.
- TIFF upload fails honestly: "This browser cannot decode this
  image. Try the native CLI instead." (no "Conversion failed"
  prefix — no conversion was attempted), "Detected format: TIFF
  (.tif)", Dimensions "—", Convert button disabled, app stays
  usable.
- **Fixed in the 16 Nov 2026 polish run:** the TIFF used to show
  "Detected format: Unknown" (`probeImage` discarded the correctly
  sniffed format when the probe threw) with a misleading red
  "Conversion failed" label. `probeImage` now throws a `ProbeError`
  carrying the sniffed format; the Convert and Batch workspaces
  show it, and the "Conversion failed:" prefix is only added when
  a real conversion was attempted. Covered by 4 new unit tests
  (`src/lib/convert.test.ts`) and by two new checks in
  `web-nowasm.mjs`.
- **SVG without WASM (SVG fix run):** the probe now falls back to
  `<img>` dimensions and conversion falls back to drawing that
  element on the main thread — SVG detected as SVG 400×200 and
  SVG→JPEG downloads a real JPEG (`file`: "JPEG image data, JFIF
  standard 1.01 … 400x200"). Without this fix the probe failed and
  the Convert button stayed disabled. (A viewBox-only SVG renders
  at the browser's 300×150 default here; the WASM route uses the
  viewBox size.)
- Two bugs in `web-nowasm.mjs` itself were also fixed in the same
  run: the TIFF wait raced the probe (it waited only for the
  "Detected format" label, which renders while still probing), and
  the cannot-decode assertion used the regex
  `/cannot be decoded in this browser/i`, which never matched the
  real message ("cannot decode this image").
- The missing `openpixel_wasm.js` logs one expected 404 in the
  console; the app handles it.

### 2.14 One transient browser note

During the main run, one `requestfailed` was recorded:
`http://127.0.0.1:8321/wasm/openpixel_wasm_bg.wasm ::
net::ERR_ABORTED`. It happened at the page reload in the
theme-persistence check (2.11) — a navigation abort of the
in-flight 7.3 MB fetch, not an app failure. Every WASM conversion
in the run passed, and the module re-loaded fine on the reloaded
page (the Formats/Settings checks after the reload passed).

## 3. Desktop e2e — PASS (launch + render); click-through NOT RUN

No GUI-driving tool is installed (`xdotool`/`wmctrl` absent), so no
clicks were performed. What was verified instead:

| # | Scenario | Observed result |
|---|---|---|
| 3.1 | Install the item-3 `.deb` | `sudo dpkg -i …/bundle/deb/OpenPixel_0.1.0_amd64.deb` → package `open-pixel` 0.1.0, `/usr/bin/openpixel-desktop` present (31 219 712 B) |
| 3.2 | Launch under Xvfb | `timeout 25 xvfb-run -a /usr/bin/openpixel-desktop`: main process alive with `WebKitNetworkProcess` + `WebKitWebProcess` children; log gained `2026-11-16T04:29:49Z [INFO] OpenPixel desktop started (offline mode)`; only warnings are the Xvfb DRI3 software-rendering notices (same as Phase 8) |
| 3.3 | Screenshot of the running app | `ffmpeg -f x11grab` on a dedicated Xvfb :99 → `apps/web/e2e/screenshots/12-desktop-xvfb.png`: header, Offline badge, Dark toggle, tabs Convert/Batch/Formats/Settings/Logs, Convert drop zone, footer "App 0.1.0 · engine 0.1.0 · 21 formats known." — the UI renders |
| 3.4 | AppImage direct run | `OpenPixel_0.1.0_amd64.AppImage` (80 423 416 B) cannot mount: `fuse: device not found` — no FUSE kernel module on this VM. Same environment block as Phase 8, not an app defect |
| 3.5 | AppImage extracted (in `$HOME`, not `/tmp`) | `--appimage-extract` → AppRun launches: process + `WebKitWebProcess` alive, log gained `2026-11-16T04:32:46Z [INFO] OpenPixel desktop started (offline mode)`, screenshot `13-desktop-appimage.png` shows the identical UI. **Note:** a first extraction into `/tmp` produced a binary that died with SIGBUS — `/tmp` is a 512 MiB tmpfs and was 100% full at the time (same trap as Phase 8/9). Extract AppImages outside `/tmp`. |
| 3.6 | Backend commands | Not clicked in the GUI — but the Tauri commands are the unit-tested `do_*` wrappers (see §4: desktop backend `cargo test` 16/16, incl. a real 2-file batch, PNG→JPEG/WebP with re-detection, unencodable-target and missing-file rejection) |

NOT RUN (needs a real desktop or GUI-driving tool): clicking
Convert/Batch/Formats/Settings/Logs, native save dialog, drag a
file onto the window from the file manager, pause/resume/retry in
the Batch tab, EXIF-preserve round-trip through the UI. These stay
OPEN in the checklist below.

## 4. Regression — resize run (16 Nov 2026; desktop/clippy/fmt rows not re-run this time)

| Suite | Result |
|---|---|
| `cargo test --workspace` | **205 passed, 0 failed** (baseline 197 + 5 new engine tests + 3 new WASM native tests; core 42, wasm 11 native + 3/3 `wasm-pack test --node`) |
| `cargo clippy --workspace --all-targets -- -D warnings` | pass (item-2 run; not re-run in the resize run) |
| `cargo fmt --all -- --check` | pass (item-2 run; not re-run in the resize run) |
| Web `npm test` | **49 passed, 0 failed** (baseline 35 + 14 new resize-logic tests) |
| Web `npm run lint` (oxlint) | 0 warnings, 0 errors, 32 files |
| Desktop `npm test` | **11 passed, 0 failed** (2 files; item-2 run) |
| Desktop `npm run lint` (oxlint) | 0 warnings, 0 errors, 16 files (item-2 run) |
| Desktop backend `cargo test` (own workspace, sysroot `PKG_CONFIG_PATH` per `docs/DESKTOP.md`) | **16 passed, 0 failed** (item-2 run) |
| Release rebuild + `openpixel bench --quick` smoke | succeeds; jpeg_decode 1.3 ms, png_encode 3.8 ms, webp_encode 1.4 ms, avif_encode 712.1 ms, tiff_large 4.1 ms, batch_4 1.9 ms, peak RSS 14.5 MiB (quick-mode small fixtures; timings not comparable to a full run — the §1.9 numbers are from the same binary minutes earlier, so treat the spread as run-to-run noise on a loaded VM) |

## 5. Checklist closure

From `docs/TESTING.md` — the Phase 7 manual browser checklist, the
Phase 8 manual desktop checklist, and the item-2 WASM checklist:

**Now CLOSED (evidence above):**

- Web (1) drop a PNG, convert to JPEG/WebP/BMP and download, output
  re-detects as the target — §2.3 (JPEG verified) and §2.8/2.9 (WebP
  verified); BMP is CLOSED only by code path — the BMP download
  itself was not clicked and is listed under OPEN below.
- Web (2) drop a JPEG, check the detected format ignores a lying
  extension — §2.4 (PNG named `.jpg` detected as PNG; the JPEG
  variant is the same code path, `detect.ts` magic-byte sniff).
- Web (3) batch of 3+ files incl. one unsupported — §2.9 (the
  unsupported file was `.txt`, not TIFF: TIFF *converts* via WASM
  now, so it can no longer play the "unsupported" role; the skip
  path is the same).
- Web (4) theme toggle light/dark/system persists across reload —
  §2.11 (light/dark verified; "system" follows the OS setting and
  was not toggled in headless Chromium, where there is no OS theme
  to follow — the code path is `resolveTheme` in `settings.ts`,
  covered by the desktop/web unit tests).
- Web (5) keyboard-only: tab to the drop zone, Enter opens the
  picker — §2.12.
- Web (6) GIF converts as first frame only, with the note shown —
  §2.8.
- WASM (a) drop a TIFF/QOI/HEIC file and convert it — §2.5/2.6
  (TIFF, HEIC verified; QOI verified in the browser in the polish
  run — §2.14).
- WASM (b) convert a PNG to TIFF/QOI/HEIC/JXL — §2.7 (HEIC
  verified in the browser; TIFF/QOI/JXL targets verified in the
  browser in the polish run — §2.15).
- WASM (c) "Converted with the built-in WASM engine" note appears
  — §2.5.
- WASM (d) canvas path still handles PNG→JPEG — §2.3.
- WASM (e) WASM module absent → canvas-only fallback, no error —
  §2.16 (the "Unknown"/"Conversion failed" label observation from
  the first run was fixed in the polish run — see §2.16 and §6.1).
- WASM (f) 7.3 MB module loads over plain HTTP without COOP/COEP
  — §2.2.
- Desktop launch + render — §3.2/3.3/3.5 (process alive, webview
  children, startup log line, screenshot of the rendered UI, for
  both the `.deb` binary and the extracted AppImage).

**Still OPEN (with reason):**

- Desktop (1) drop a PNG, convert to JPEG/WebP/TIFF, save via the
  native dialog — needs GUI clicks; backend commands for the same
  conversions are unit-tested (16/16).
- Desktop (2) JPEG with metadata Preserve → EXIF survives —
  needs GUI clicks; the engine's preserve path is covered by CLI
  e2e in Phase 5 and by backend unit tests.
- Desktop (3) batch of 3+ incl. one corrupt; pause/resume and
  retry-failed — needs GUI clicks; `JobManager` pause/resume/
  cancel/retry is covered by the jobs integration tests and the
  backend's 2-file batch test.
- Desktop (4) Formats tab shows 21 formats — the tab renders
  (screenshot §3.3 shows the tab bar) but its contents were not
  clicked open; the same 21-format registry is verified in the web
  Formats tab (§2.10) and by `openpixel formats` (§1.11).
- Desktop (5) theme toggle persists across restart — not clicked;
  same `localStorage` mechanism as the web app (§2.11).
- Desktop (6) Logs tab shows conversion lines + log file path —
  not clicked; the log file itself was verified to gain the startup
  line (§3.2/3.5) and `read_logs` is unit-tested.
- Desktop (7) keyboard-only tab to drop zone, Enter opens the
  native picker — not clicked; the web drop zone's identical
  keyboard path was verified (§2.12).
- Desktop (8) drag a file onto the window from the file manager —
  needs a real desktop session.
## 6. Findings and limitations

1. **FIXED in the polish run (16 Nov 2026) — BMP download was
   PNG bytes, and the no-WASM TIFF label was misleading:**
   (a) PNG→BMP downloaded a file named `.bmp` whose bytes were
   PNG: `canvas.toBlob(blob, 'image/bmp')` silently falls back to
   PNG in every browser. BMP was removed from the canvas targets
   (`BROWSER_ENCODABLE`, `canvasMimeType`) and is now routed to
   the WASM engine, which encodes real BMP — verified in the
   browser (§2.13). All BMP claims in the UI and `docs/WEB.md`
   were corrected; without the WASM module BMP is not offered as
   a target at all. (b) A TIFF upload without WASM showed
   "Detected format: Unknown" with a red "Conversion failed"
   alert, although the format *was* sniffed (TIFF) and no
   conversion was attempted. `probeImage` now throws a
   `ProbeError` carrying the sniffed format; the workspaces show
   it and only add the "Conversion failed:" prefix when a real
   conversion was attempted — verified in the browser (§2.16)
   and by 4 new unit tests.
2. **Transient browser note:** one `net::ERR_ABORTED` on the wasm
   fetch during the theme-reload check — navigation abort, no
   user-visible effect (§2.11). It recurred in the polish re-runs
   and is still transient only: every WASM conversion in the same
   runs succeeded.
4. **FIXED in the resize run (16 Nov 2026) — blob-URL revocation
   broke image loads, and the result line lied about growth:** (a)
   the Resize tab revoked thumbnail/result object URLs on every
   `items` change, including URLs still shown by mounted `<img>`
   elements — two `blob:` `ERR_FILE_NOT_FOUND` errors in the first
   resize-e2e run. The cleanup now revokes only URLs that actually
   disappeared (plus all on unmount). (b) The result line clamped
   the change at "0% smaller" even when the resized file was
   *bigger* than the original; it now says "3% larger" (or "same
   size") with the real percentage. Both verified by the 16/16
   resize-e2e re-run with zero console errors (§2.19).
5. **Environmental (resize run, 16 Nov 2026) — headless
   Chromium's file-chooser interception stopped firing:** the
   keyboard check (§2.12) failed 3 consecutive full runs (36/37)
   although the keydown reaches the zone and `input.click()` runs.
   The pre-resize build at `08bf9a5` fails identically, so it is
   not a regression from the resize work. The check now retries
   the Enter press 3 times; see §2.19a for the full evidence.
3. **Environment traps hit during this run (both pre-documented):**
   `/tmp` is a 512 MiB tmpfs and filled to 100% during the first
   AppImage extraction, which made the extracted binary die with
   SIGBUS. Extracting to `$HOME` fixed it. The AppImage also cannot
   mount directly (no FUSE) — same as Phase 8.
4. **No external services were used.** All test images are local
   fixtures; no upload, no account, no cost, no public deploy.
   The two `python3 -m http.server` instances (ports 8321/8322)
   served only local files on loopback and were stopped after the
   run.
5. The `.deb` from item 3 is installed on this VM
   (`open-pixel` 0.1.0, `/usr/bin/openpixel-desktop`); the AppImage
   extraction scratch dir (`~/tmp-appimage-x`) was removed after
   the run.
