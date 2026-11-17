# Web Application — OpenPixel Engine (Phase 7, draft — coordinator verifies)

Local-only React web app in `apps/web/` (React 19 + TypeScript + Vite
+ Material UI 7 + Three.js). There is no server component: the app is static
files, and every image operation runs in the browser. Files never
leave the device.

## How it works

```
User drops a file
  -> File API reads bytes locally
  -> src/lib/detect.ts sniffs magic bytes (1:1 port of the Rust
     detector in crates/openpixel-formats/src/format.rs)
  -> createImageBitmap / <img> decodes it (dimensions, preview)
  -> src/lib/convert.ts sends it to src/worker.ts (Web Worker)
  -> OffscreenCanvas draws it, convertToBlob encodes it
  -> result Blob -> object URL -> Download button
```

- **Conversion worker**: `new Worker(new URL('../worker.ts', import.meta.url))`
  in `convert.ts`. If the worker cannot be created or times out
  (120 s), conversion falls back to the main thread
  (`convertOnMainThread`, same canvas logic via a `<canvas>`
  element) rather than failing. The worker is bundled as its own
  chunk (`dist/assets/worker-*.js`).
- **Capability data**: `src/data/capabilities.json` is generated from
  the engine registry — see `apps/web/README.md` and
  `scripts/generate-capabilities.mjs`. The Formats tab, the output
  selectors and the tests all read this one file; nothing in the app
  hard-codes a format list. Regenerate after any registry change.
- **Settings**: `src/lib/settings.ts`, persisted in localStorage
  under `openpixel.settings.v1` (theme, language `en`/`bn` — stored
  preference, UI stays English until the Bengali strings land,
  default quality/format/background, metadata policy, batch workers
  1–4). No account. Activity history (My Files / Recent Files) is a
  separate store, `src/lib/activity.ts` (`openpixel.activity.v1`,
  names/sizes only, max 200 entries, recording switchable in
  Settings → Privacy).
- **Batch**: a small promise pool (up to `batchWorkers`, capped at 4
  in the browser — the CLI allows 8) converts files concurrently;
  per-file status/error; individual downloads plus a client-side zip
  (`jszip`) for "Download all". A failed file never stops the batch.
- **Theme**: MUI palette mode (`src/theme/theme.ts`), toggled by a header button
  and the Settings theme selector; `system` follows the OS. The `dark` class
  is still toggled on `<html>` — the e2e suite asserts on it, not because
  the theme needs it.
- **3D background**: `src/components/Background3D.tsx` — plain Three.js
  (no react-three-fiber), slow-floating brand-coloured particles and
  wireframe shapes on a fixed transparent canvas behind the app,
  lazy-loaded so it never blocks first paint. It respects
  `prefers-reduced-motion` (one static frame, no loop), pauses when the
  tab is hidden, and disposes everything on unmount. Toggled in
  Settings ("3D background", **off by default since the Phase 6 shell**,
  17 Nov 2026, persisted in localStorage as `show3dBackground`).
- **Accessibility**: labelled controls, sidebar navigation with
  `aria-current="page"` on the active item, `role="status"`/`role="alert"`
  live regions for progress and errors, visible `:focus-visible` outlines,
  keyboard operable drop zone (Enter/Space opens the picker).

## Design system

The look lives in one place so new workspaces reuse it instead of
reinventing it. Tailwind was removed entirely (16 Nov 2026 redesign)
— no Tailwind package, config, or directive remains anywhere in
`apps/web/`; MUI and Tailwind must not coexist in this app.

- **`src/theme/theme.ts`** — `getTheme(mode: 'light' | 'dark')`, the
  single source of truth. Palette (Studio Phase 6 tokens, 17 Nov 2026):
  primary `#3157D5` light / `#829BFF` dark, background `#F7F8FC` /
  `#0B1020`, surface `#FFFFFF` / `#121A2B`, text `#172033` / `#F1F5FB`,
  border `#E2E8F0` / `#26344D`; Inter (English) + Noto Sans Bengali,
  self-hosted via `@fontsource` (no Google Fonts CDN); breakpoints
  xs 0 / sm 600 / md 768 / lg 900 / xl 1200 / xxl 1536; `borderRadius`
  12 (card), 8 (button), 16 (dialog); input min-height 44; component
  overrides for Button / Tabs / Select / Slider / Table / Card / Alert /
  Drawer / AppBar / Breadcrumbs / Snackbar so every view looks
  consistent. Global rules that used to live in `src/index.css` (body
  font, visible `:focus-visible` outline, `color-scheme`) are
  `MuiCssBaseline` overrides here. `src/index.css` no longer exists.
- **`src/components/layout/AppShell.tsx` is the shared shell** (Studio
  Phase 6) — AppBar header (logo, global tool search, theme toggle,
  Help, local-profile menu), sidebar (permanent Drawer ≥ lg, 248px,
  collapsible to 72px, temporary drawer on mobile), breadcrumbs,
  `Container maxWidth 1440px` content, footer. The default route is
  the homepage (`home`); the dashboard is its own route (`overview`).
  A new tool plugs in as one more entry in `src/lib/routes.ts`
  (`TOOLS` + `NAV_GROUPS` + `ROUTE_TITLES`) and its component under
  `src/components/`. It gets the theme, the header/footer and the
  breadcrumb behaviour for free.
- **Shared components** (`src/components/`): `DropZone` (drag-and-drop
  + keyboard-operable file picker, reused by Convert and Batch),
  `Background3D` (see above), `ToolCard` (one card for the homepage
  and the All Tools directory — web / CLI-only with exact command /
  coming-soon states), `ToolPageHeader` (the shared tool-page title +
  description pattern), `EditorShell` (two-column editor layout:
  preview left, tools right), `PdfThumbnails` (real pdf.js page
  thumbnails for the PDF editor rail). Conversion logic stays in
  `src/lib/` and is UI-agnostic — a new workspace calls the same
  `probeImage` / `convertImage` / `useWasmSupport` helpers.
- **Hard UI contracts** (the Playwright e2e suites depend on these —
  keep them or update `apps/web/e2e/` to match): the default route is
  the homepage — suites click a nav item first (`#tab-convert`,
  `#tab-resize`, `#tab-pdf`, `#tab-ocr`, `#tab-batch`,
  `#tab-formats`, `#tab-settings`, `#tab-tools`); `#convert-file`
  file input; `#target-format` is a real native `<select>` (MUI
  `Select` with the `native` prop); panel ids `#panel-<route>`
  (`#panel-formats`, `#panel-settings`, …); `role="status"` for
  conversion notes, `role="alert"` for errors; button texts "Choose a
  different file", "Convert to …", "Download …", "Download all (2) as
  .zip"; drop-zone text "Drop an image here" with Tab-focus +
  Enter-to-open behaviour; theme toggle aria-labels "Switch to dark
  theme" / "Switch to light theme"; "WASM engine" note texts
  unchanged.

## App shell and navigation (Studio Phase 6, 17 Nov 2026)

Routes (`src/lib/routes.ts`, `RouteId`): `home` (homepage, default),
`overview` (workspace dashboard), `tools` (All Tools), `convert`,
`resize`, `pdf` (PDF tools picker), `ocr`, `batch`, `formats`, `files`
(My Files), `recent` (Recent Files), `settings`, `help`, plus one
route per PDF tool under `/pdf/*`: `pdf-merge`, `pdf-split`,
`pdf-rotate`, `pdf-extract`, `pdf-remove`, `pdf-reorder`,
`pdf-duplicate`, `pdf-reverse`, `pdf-booklet`, `pdf-n-up`,
`pdf-compress`, `pdf-edit`, `pdf-redact`, `pdf-metadata`,
`pdf-sanitize`, `pdf-flatten`, `pdf-repair`, `pdf-pdf-to-image`,
`pdf-images-to-pdf`, `pdf-extract-text` (33 routes total). The sidebar groups are
Workspace (Overview / My Files / Recent Files), Tools (All Tools /
Convert Image / Resize Image / PDF Tools / OCR / Batch Convert /
Formats), Account (Settings / Help Center).

- **Homepage** (`src/components/HomePage.tsx`): hero, upload area,
  popular tools, categories, how-it-works, benefits, privacy
  section. The upload area sniffs the file (PDF magic bytes, then
  `detectFileFormat`) and routes it with the file handed over:
  image → Convert, several images → Batch, PDF → the PDF Tools
  picker (`/pdf`). Office documents and unknown files get an honest notice naming
  the CLI route — never a dead end.
- **All Tools** (`src/components/ToolsDirectory.tsx`): search,
  category filter, popular, recently used (from the local activity
  store), sort. Every entry carries a status — `web` (opens the
  tool), `cli-only` (dialog with the exact verified command +
  Copy), `coming-soon` (non-clickable, clearly labelled). The
  registry is `TOOLS` in `src/lib/routes.ts`; see
  `docs/DESIGN_NOTES.md` §10 for the inventory it is built from.
- **Workspace** (`src/components/Workspace.tsx`): dashboard
  ("Welcome back" + overview cards + recent files table + activity
  timeline + storage), My Files (grid/list, search, type filter,
  sort, star, remove), Recent Files (table). All three read only
  the local activity store; empty states are honest — no invented
  files. Recording a success happens in each workspace
  (`recordActivity()` in Convert / Resize / Batch / OCR; each PDF
  tool records once per produced result set via the shared
  `usePdfFile` hook, keyed on the tool's route id so the Tools
  directory "recently used" entry opens the exact tool page).
- **PDF tools (per-tool pages, 17 Nov 2026):** `/pdf` is the
  picker — a grid of tool cards (web tools first, then CLI-only
  with the exact command, then Coming Soon). A PDF uploaded on
  the picker travels with the user to the picked tool (except
  Images to PDF, which takes images, never a PDF). Every tool
  page shares one shell (`PdfToolPage` in
  `src/components/pdf/shared.tsx` + the `usePdfFile` hook in
  `src/components/pdf/usePdfFile.ts`): breadcrumb, title, one
  short description, upload area, file list, settings panel, ONE
  prominent primary action, processing states, result state
  (output name/format/size, download). The tool pages are
  `src/components/pdf/{PageOpsTools,CompressTool,MergeTool,
  ImagesToPdfTool,PdfToImageTool,ExtractTextTool,CleanUpTools,
  EditTool,PdfPicker}.tsx`. Extract text is a real web tool
  (pdf.js `getTextContent`, TXT download + on-screen text);
  EPUB/DOCX export stays CLI-only. Threat inspection is not a
  standalone tool — it lives on the Clean up page
  (`/pdf/sanitize`) as the "Check for threats" step before
  "Remove threats".
- **Editors**: the Edit PDF tool (`/pdf/edit`) is a 3-panel editor — thumbnails rail
  (`PdfThumbnails`, real pdf.js renders, max 12, click to jump),
  center preview + info, tools on the right (text overlays,
  highlights, page numbers, headers/footers). The image editor (Convert) uses the shared
  `EditorShell` (preview left, tools right); Resize/Batch keep
  their multi-item list layouts. No fake undo/redo anywhere.
- **PDF viewport-fit (17 Nov 2026):** on desktop (≥900px) every
  PDF tool page is a viewport-height workspace — the shell
  (`AppShell` `fitViewport`, all `pdf-*` routes) fills exactly
  `100dvh` below the AppBar, the footer is hidden on these
  routes, the page itself never scrolls, and tool content scrolls
  inside its own container when taller than the viewport (e.g.
  Merge at 1366×768). On the Edit page each of the three columns
  (thumbnails / center / operations, ids `pdf-thumbs-panel` /
  `pdf-center-panel` / `pdf-ops-panel`) scrolls internally. The
  header is one compact line (breadcrumb + "PDF tools", no long
  description); the preview canvas caps at
  `clamp(200px, calc(100dvh - 470px), 420px)`. The empty state
  fits too (compact DropZones — `compact` prop on `DropZone`).
  Below lg the pages keep their normal stacked scrolling layout.
  Three flexbox gotchas found while building it: (1) a stretched
  Grid row sizes to its tallest item, so Grid items need explicit
  `height: 100%` on lg; (2) MUI Card has `overflow: hidden`,
  which zeroes the automatic minimum size of flex items, so
  column children need `flexShrink: 0` or the cards squash;
  (3) absolutely-positioned hidden file inputs (`#pdf-merge-file`,
  DropZone inputs) escape their scroll container and stretch the
  document — they need a positioned ancestor (the Merge card's
  Stack and the DropZone root are `position: relative`).
- **Settings** (Phase 6 additions): Language (EN/BN preference),
  Privacy (activity recording toggle + clear history), Storage
  (history size, WASM engine status). No auth pages — there is no
  auth backend.
- **Header gotcha (found by the viewport QA, 17 Nov 2026):** MUI
  `Button` defaults to `justify-content: center`, so when the logo
  button shrank below its content width on a 360px screen the
  centered wordmark overflowed LEFT and its icon covered the
  hamburger — the drawer could not be opened. Fixed with
  `justifyContent: 'flex-start'` on the logo button and the
  wordmark hidden below `sm` (icon only on phones).

## What converts where

| Path | Sources | Targets |
|---|---|---|
| Browser canvas (this app) | PNG, JPEG, WebP, GIF (first frame only), BMP, AVIF (only if the browser decodes it) | PNG, JPEG, WebP |
| WASM engine (this app, when built — see below) | Everything the canvas path handles, plus SVG (rasterised with resvg), TIFF, QOI, HEIC, HEIF, JXL, JPEG 2000, ICO, PNM, TGA, EXR, HDR | Everything the canvas path handles, plus BMP, TIFF, QOI, HEIC, HEIF, JXL, JPEG 2000, ICO, PNM, TGA, GIF |
| Native CLI / desktop app | All 16 engine formats (incl. TIFF, TGA, ICO, PNM, QOI, AVIF, JXL, HDR, EXR, JPEG 2000, SVG) | All 15 engine-encodable formats |

Not convertible anywhere yet: APNG, RAW, PSD (planned in the
engine, reported as such by the CLI and by this app). HEIC/HEIF
convert natively and in WASM since follow-up item 1 (16 Nov 2026).

Honest limits of the canvas path, all stated in the UI:

- **SVG is not a canvas source.** `createImageBitmap` rejects every
  SVG blob ("The source image could not be decoded") — verified
  16 Nov 2026 on the live site, where all six test SVGs (plain,
  viewBox-only, Bengali/Arabic text, foreignObject, embedded and
  external image) failed in the worker while the `<img>` preview
  rendered them. SVG is therefore routed to the WASM engine (resvg)
  for every target, including PNG/JPEG/WebP. Without the WASM
  module, the probe reads dimensions from an `<img>` and conversion
  falls back to drawing that element on the main thread (a
  viewBox-only SVG then renders at the browser's 300×150 default
  instead of its viewBox size). The preview is an `<img>` and is
  unaffected either way.
- Metadata is always stripped by a canvas round-trip (EXIF/ICC/XMP).
  "Preserve" in the metadata selector warns and still strips; the
  CLI (`--metadata preserve`) is the way to keep metadata, and only
  for JPEG/PNG targets.
- PNG compression (0/1/2) is accepted and recorded but the browser
  canvas encoder has no PNG compression knob — it does not change
  the in-browser output. The CLI honours it.
- JPEG quality applies to JPEG and WebP targets only; PNG/BMP ignore
  it (same rule as the engine).
- BMP is decodable by the canvas but NOT encodable by it:
  `canvas.toBlob(blob, 'image/bmp')` silently returns PNG, so a
  "BMP" download used to be PNG bytes named `.bmp` (caught by the
  web e2e on 16 Nov 2026). BMP targets are routed to the WASM
  engine instead; without the WASM module BMP is not offered as a
  target at all.
- Animated GIF / animated WebP / multi-page TIFF: only the first
  frame/page converts in the browser (same as the engine's plain
  decode). Frame extraction needs the CLI (`openpixel extract-frame`).
- The browser enforces no engine security limits (100 MiB / 100 MP /
  16 384 px); a very large image is bounded only by tab memory.
  The CLI enforces the limits.

## Resize & compress — Resize tab (16 Nov 2026)

A fifth tab next to Convert: change dimensions and shrink file
size without losing quality. Upload one image for a detailed
before/after preview, or several to resize them all with the same
settings (per-file download, plus a .zip of all results).

- **Modes:** Fit (aspect preserved, never stretches), Fill (scale +
  centre-crop to the exact size), Pad (fit + pad with the
  background colour to the exact size), Exact (stretch — warns that
  it distorts). Presets: Full HD 1920×1080, HD 1280×720, 800×600,
  512×512, 256×256, Passport 300×400, Custom. Width/Height inputs
  with an aspect-ratio lock (default on) and an expected-result
  line, so never-upscale clamping is visible before running.
- **Quality rules:** the resize runs through the real engine
  (Lanczos3) via the WASM module — `process` / `process_to_size`
  in `crates/openpixel-wasm` — and always from the original file,
  never a re-compressed copy. Never-upscale is on by default
  (ResizeFit semantics); the "Allow upscaling" toggle warns that
  upscaling adds no detail. A JPEG source re-encoded to a lossy
  target warns that some quality will be lost.
- **Target size ("compress to X KB"):** an optional target (e.g.
  "200 KB") runs the engine's binary search over quality and
  returns the highest quality that fits, reporting the quality
  used and whether the target was met. When the target cannot be
  met, the smallest result is kept with a warning. The quality
  slider is disabled while a target size is set.
- **Honest limits:** target size works for JPEG, HEIC and HEIF
  (quality search) and PNG (best compression). It does **not**
  work for WebP — the engine's WebP encoder is lossless-only, so
  quality does not change its size; the UI says so and disables
  the combination instead of faking a fit. AVIF is not offered as
  a resize target (the WASM engine cannot encode it). Without the
  WASM module, plain resize falls back to the canvas (bilinear,
  PNG/JPEG/WebP only) and target size is not offered at all; the
  result says which engine ran. In-browser resize always strips
  EXIF/ICC/XMP (CLI `--metadata preserve` keeps it, JPEG/PNG
  only). Last-used mode / preset / quality / format persist in
  `openpixel.settings.v1`.
- **Tests:** `apps/web/src/lib/resize.test.ts` (14 unit tests:
  target-size parsing, aspect math, clamping); Rust tests for
  `process_bytes` / `process_to_size_bytes` in openpixel-core and
  the WASM bindings in openpixel-wasm (incl. `wasm-pack test
  --node`); e2e in `apps/web/e2e/resize-e2e.mjs` (see docs/E2E.md
  §2.19). The same run re-checked the baselines: web e2e 36/37
  (the one failure is the known keyboard file-chooser flake,
  §2.19a — not a regression) and resize e2e 16/16. New PDF tab
  (`apps/web/e2e/pdf-e2e.mjs`, 31/31 — see docs/E2E.md §2.25),
  incl. the compress check and the fixed page-count label.

## PDF tools — PDF tab (Studio Phase 2, extended Phases 3 + 5, 17 Nov 2026)

A sixth tab next to Resize: work with PDFs entirely in the browser.
Upload one PDF for info, preview and page operations, or build a
PDF from images — no upload, no server.

- **Info:** page count, PDF version, metadata (title / author /
  creator / producer), encryption flag, and the effective page
  size in points per page — from the WASM engine's `pdf_info`
  (lopdf `inspect`). Without the WASM module the page count falls
  back to pdf.js, so the tab still shows it. (Phase 3 fix: the
  info row used to read "Pages | Pages: 4" — the value carried
  its own "Pages:" prefix. It now shows just the number.)
- **Page operations (all real WASM calls):** merge with a second
  PDF (`pdf_merge`), split by ranges (`pdf_process` split — one
  output document per range, each with its own download), rotate
  (90/180/270, selected pages or all), extract, remove, reorder
  (must list every page exactly once), duplicate, reverse,
  booklet imposition, N-up (1–4 columns × 1–4 rows). Every
  operation's result is re-checked with `pdf_info` and the status
  line reports the real page count ("Merged PDF: 6 pages"). Page
  lists accept "1,3" and "1-3" forms; invalid input is rejected
  with a message before any engine call.
- **Images to PDF:** `pdf_from_images` — one page per image, in
  order, at the image's own size in points or on an A4 / Letter /
  A5 page.
- **Compress (Phase 3):** `pdf_compress` — screen (72 DPI, JPEG
  q50) / ebook (150 DPI, q75) / printer (300 DPI, q90), plus an
  optional metadata strip. The status line reports the measured
  sizes ("Compressed PDF: 1,687,939 → 70,306 bytes (95.8%
  smaller, 1 image recompressed)"), and when a mode cannot shrink
  the file the original is kept and the note says so. Same engine
  as the CLI, same best-of rule.
- **Edit (Phase 5):** overlay ops via WASM (`pdf_edit`) — add
  text (page, X/Y, size, colour, font), shapes (rectangle /
  line / circle, fill + stroke), highlight, page numbers
  ("Page {n} of {total}", position + format), header/footer,
  and comments (sticky-note annotations). Image overlay is
  offered through the same card (upload an image, place it on
  the page). The card says plainly that overlays are NEW
  content layered on the page — existing text is never edited
  in place. **Redaction (Phase 5):** `pdf_redact` — redact by
  text or by rectangle; the text is really removed from the
  content stream, not covered with a black box (the e2e
  byte-proves it). **Flatten / metadata / repair / sanitise /
  threat check (Phase 5):** `pdf_flatten`, `pdf_set_metadata`
  (blank fields are left unchanged), `pdf_repair`,
  `pdf_sanitize` ("Cleaned PDF"), `pdf_inspect` (threat check:
  JavaScript / embedded files / launch actions / auto-actions,
  listed, never executed). **Signatures stay CLI/desktop-only:**
  signing needs a private key, which must never be uploaded to
  a web page — the tab says so and points to `openpixel pdf
  sign` / `pdf verify-sign`.
- **Office documents (Phase 3, honest state):** Word, Excel and
  PowerPoint files cannot be converted in the browser — the
  conversion runs LibreOffice headless, which cannot run in
  WASM. The PDF tab states this in its bottom note and points
  to the CLI (`openpixel doc convert`); there is no fake Office
  upload or disabled button pretending the feature exists.
- **Preview and PDF→image:** rendered with **pdf.js**
  (`pdfjs-dist` 6.5.438, Apache-2.0 — see `LICENSE_AUDIT.md`),
  not PDFium: PDFium needs a native libpdfium binary, which
  cannot load in the browser, and there is no WASM render export.
  The preview renders the selected page to a `<canvas>` at a
  1×/1.5×/2× scale (1× = 72 dpi) with the bundled
  `pdf.worker.min.mjs` worker; "Download page N as PNG/JPEG"
  renders the same page to a canvas and downloads it at the
  chosen scale. A render that fails is a visible error, never a
  silently blank canvas.
- **Honest limits, stated in the tab:** insert and replace pages
  have no WASM export — they need the native CLI or desktop app
  (`openpixel pdf insert` / `openpixel pdf replace`); PDFium
  rendering is CLI/desktop-only (`openpixel pdf render`), and the
  pdf.js render may look slightly different from it on very
  complex pages. Encrypted PDFs cannot be opened in the browser
  (the engine refuses them); use the CLI. Password protect,
  unlock and watermark are CLI/desktop-only (no WASM export —
  see `docs/PDF.md`). Text extraction IS a web tool
  (`/pdf/extract-text`, pdf.js `getTextContent`, TXT download);
  only EPUB/DOCX export stays CLI-only. Digital signatures are
  CLI/desktop-only (a private key must never be uploaded).
  Without the WASM module, page operations are disabled with a
  warning, while preview and PDF→image still work.
- **Tests:** `apps/web/src/lib/pdf.test.ts` (18 unit tests:
  page-list / range / reorder parsing, page-size formatting,
  output names, WASM-wrapper null fallback incl. `pdfCompress`
  and the Phase 5 wrappers (`pdfEdit`, `pdfRedact`,
  `pdfFlatten`, `pdfSetMetadata`, `pdfSanitize`, `pdfRepair`,
  `pdfInspect`), hex colour parsing, compress modes); e2e in
  `apps/web/e2e/pdf-e2e.mjs` (31 checks — see docs/E2E.md
  §2.25).

## OCR — OCR tab (Studio Phase 4, 17 Nov 2026)

A seventh tab after PDF: read the text out of a photo or scan,
entirely in the browser. Upload one image; the tab recognises
printed text with **tesseract.js 7.0.0** (Tesseract compiled to
WebAssembly) — never presented as the native CLI engine.

- **Self-hosted, on demand.** The worker
  (`public/tesseract/worker.min.js`), the LSTM-only core
  (`public/tesseract/tesseract-core-lstm.wasm.js` — the WASM
  binary is embedded as base64 inside it) and the language data
  (`public/tessdata/eng.traineddata`, `ben.traineddata`,
  tessdata_fast) are committed to the repo and served from the
  site itself; all three tesseract.js default CDN paths are
  overridden, `gzip: false`, `cacheMethod: 'none'`,
  `workerBlobURL: false`. Nothing OCR-related is fetched before
  the user runs OCR — the library itself is a lazy chunk (17 KB)
  loaded only on Run. Measured: `dist` 11 MB → 20 MB; initial
  bundle +15 KB; on-demand files 8.6 MiB (worker + core + eng +
  ben). `apps/web/e2e/ocr-e2e.mjs` fails the run if any request
  leaves the local origin.
- **Controls:** language picker (English default — the copy
  explains to add Bengali only when the image has Bengali text;
  each language loads its own file on first use), page-layout
  select (Auto / Single block / Single line → PSM 3/6/7),
  "Enhance image" checkbox (grayscale + contrast via a canvas
  pixel loop; the copy warns it can hurt clean images). The
  result shows the text, mean confidence, word count, duration,
  language and the engine label "tesseract.js (browser)", with
  Copy text and Download .txt.
- **Honest limits, stated in the tab:** browser OCR is slower
  than the native CLI, its accuracy can differ, and it has no
  pipeline preprocessing — for large batches or the best
  accuracy use the native CLI (`openpixel ocr`). Handwriting is
  out of scope — printed text only. Browser OCR returns text
  only; searchable PDFs are CLI/desktop-only (`openpixel pdf
  ocr`). Measured on the same fixtures as the native engine:
  eng-clean exact (94.0%, 30 words); ben-clean line 1 exact
  (85.0%, 16 words) but lines 2–3 have errors with tessdata_fast
  — see docs/OCR.md.
- **Tests:** `apps/web/src/lib/ocr.test.ts` (12 unit tests:
  language/PSM parsing, result shaping); e2e in
  `apps/web/e2e/ocr-e2e.mjs` (14/14 — see docs/E2E.md §2.21).

## WASM status — shipped (follow-up item 2, 16 Nov 2026)

The real Rust engine runs in this browser. What changed since
Phase 7:

1. **Feature-gating.** The AVIF codec is the only one with a C
   dependency — dav1d decode via `image`'s `avif-native` feature
   (`dav1d-sys` 0.8.3, whose build script panics on wasm32). It is
   now behind the `native-avif` cargo feature on
   `openpixel-codecs` (on by default; re-exported by
   `openpixel-core`). A wasm32 build turns it off
   (`--no-default-features` on `openpixel-core`, propagated with
   `default-features = false` on every `openpixel-codecs`
   dependency so feature unification cannot switch it back on).
   The registry then reports AVIF as unavailable (planned entry,
   reason in `status`) instead of dropping it or claiming it
   works. Everything else in the dependency tree builds for
   wasm32 as-is — checked empirically, crate by crate: ravif,
   resvg/usvg, jxl-oxide, zune-jpegxl, jpeg2k, heifer, image-rs
   (jpeg/png/bmp/gif/tiff/webp/tga/ico/pnm/qoi/avif-encode/hdr/exr),
   tintbox, gif, tiff, flate2. No other gating or workaround was
   needed. `cargo build -p openpixel-formats -p openpixel-codecs
   -p openpixel-core --target wasm32-unknown-unknown
   --no-default-features` succeeds (3m 31s first build).
2. **The bindings.** `crates/openpixel-wasm` (wasm-bindgen
   0.2.130, serde-wasm-bindgen 0.6.5) exposes `detect` /
   `discover` / `info` / `capabilities` / `supported_formats` /
   `convert(bytes, target, quality?, background?)` / `version`
   over the engine's byte-based API (`Engine::decode_bytes` /
   `get_image_info_bytes` / `convert_bytes` — added in this
   change; the file-based engine API is unchanged and the native
   build still runs all codecs including AVIF). Studio Phase 2
   adds the PDF exports `pdf_info` / `pdf_process` / `pdf_merge`
   / `pdf_from_images` over `openpixel-pdf` (lopdf) — same
   stateless byte-in / byte-out shape; there is deliberately no
   render export (PDFium cannot run in WASM — the web UI renders
   with pdf.js, see the PDF tab section above). The module is
   stateless (one fresh `Engine` per call), byte-in / byte-out,
   no filesystem, no network, no upload. Errors are plain
   strings on the JS side.
3. **Packaging.** `wasm-pack` 0.15.1 (installed with
   `cargo install wasm-pack --locked`; `rustup target add
   wasm32-unknown-unknown` was already installed). Build with
   `npm run build:wasm` from `apps/web` — wasm-pack
   `--target web --release` into `apps/web/public/wasm/`
   (`openpixel_wasm.js` 14.5 kB + `openpixel_wasm_bg.wasm`
   7,288,565 bytes after `wasm-opt`, plus `.d.ts`). The first
   `wasm-pack` run failed downloading binaryen (transient);
   `wasm-opt` 130 was installed from the binaryen release
   tarball to `~/.cargo/bin/wasm-opt` and the rebuild found it
   there and succeeded. The generated package is git-ignored
   (`public/wasm/.gitignore` contains `*`): a checkout that
   never ran `build:wasm` has no module and the app runs the
   canvas path only, exactly as before.
4. **UI wiring** (`src/lib/wasm-engine.ts`, `src/lib/convert.ts`,
   `ConvertWorkspace`, `BatchWorkspace`). The module loads
   lazily, once, via a `@vite-ignore` dynamic import of
   `/wasm/openpixel_wasm.js` — Vite must not fail the app build
   over a generated file that may be absent. `convertImage`
   tries WASM first **only** for conversions the canvas path
   cannot do at all (a source the browser cannot decode, or a
   target the canvas cannot encode); everything the canvas
   handles stays on the worker (non-blocking — WASM runs
   synchronously on the calling thread). If the module is absent
   or the engine rejects the conversion, the canvas path runs
   and errors honestly. `probeImage` falls back to WASM `info()`
   when `createImageBitmap` fails (TIFF / QOI / HEIC …), and the
   format selectors offer the WASM engine's extra targets once
   its support list has loaded. The result reports which engine
   did the work (`engine: 'wasm' | 'canvas'`), and the UI notes
   WASM conversions. WASM conversions strip metadata, like the
   canvas path (the binding always uses the strip policy) —
   the Preserve warning covers both.
5. **Verified in a real WASM runtime** (Node 24, no browser
   tooling in this session): `wasm-pack test --node` runs the
   in-wasm tests — 2/2 pass (PNG → JPEG/WebP with re-detection
   as the target, AVIF honestly unavailable, 21 capabilities).
   The standalone script
   `crates/openpixel-wasm/scripts/verify-node.mjs` imports the
   built `--target nodejs` package as a JS consumer would and
   converts the real 64×64 fixture PNG to JPEG, WebP, PNG,
   TIFF, QOI, HEIC and JXL — 17/17 checks pass, every output
   re-detected as its target. The production build serves the
   module (`vite preview`: `/` 200, `/wasm/openpixel_wasm.js`
   200, `/wasm/openpixel_wasm_bg.wasm` 200).

Honest limits of the WASM path, all stated in the UI:

- AVIF is not available in WASM (no wasm32 libdav1d). The
  engine reports it as unavailable; the UI never offers it as
  a WASM conversion, and AVIF sources still need the browser
  itself or the native CLI.
- No preview for WASM-only sources (TIFF, QOI, …): the browser
  cannot display them, so the UI shows the dimensions and a
  note instead of a broken image.
- Metadata is always stripped by a WASM conversion (same as the
  canvas path). "Preserve" warns and still strips; the CLI
  (`--metadata preserve`) is the way to keep metadata, and only
  for JPEG/PNG targets.
- The browser enforces no engine security limits on the canvas
  path, but the WASM path does enforce them: the byte API runs
  the same `check_file_size` / `check_dimensions` as the file
  API (100 MiB / 100 MP / 16 384 px).
- The module is ~7.3 MB (optimised) — the first load fetches
  it; after that it is cached like any other asset. A dev
  (unoptimised) build is ~9.2 MB.
- No real-browser click-through has been run in this session
  (no Chromium/Playwright here): the WASM conversion flows in
  the UI are verified at the module level (Node) and at build
  level (tsc + Vite + vitest), and the manual browser checklist
  in `docs/TESTING.md` lists the flows to confirm in a real
  browser before release.

## Verification

See `docs/TESTING.md` ("Verified results — Phase 7" and "Verified
results — WASM engine, follow-up item 2"). Headline after item 2:
`npm run build` passes (tsc + Vite), `npm test` 28/28, dev server
starts, production build serves over plain HTTP (200 on `/`, on
the JS/worker assets, and on `/wasm/openpixel_wasm.js` +
`/wasm/openpixel_wasm_bg.wasm`), and the Rust workspace is green
(`cargo test --workspace` 195 passed, 0 failed). No browser-driven
end-to-end conversion was run in this environment (no live-browser
tooling for this subagent); the manual verification checklist in
`docs/TESTING.md` lists the conversion flows to confirm in a real
browser before release.

## Deploy to Cloudflare Pages

The web app is a fully static Vite SPA: no server, no backend, no
account. Conversion runs entirely in the visitor's browser (canvas +
the WASM engine), so files never leave the device even when hosted.

**WASM files are committed to git.** `apps/web/public/wasm/` is
generated by `npm run build:wasm` (wasm-pack) and would normally be
git-ignored, but Cloudflare Pages builds from GitHub and has no Rust
toolchain, so the generated package (7 MB) is force-added to the
repo. Regenerate it with `npm run build:wasm` after any engine
change and commit the result; the app loads it lazily on first use.

**Pages project settings** (Dashboard → Workers & Pages → Create →
Pages → Connect to Git):

- Repository: `rajuofficialasf-hub/openpixel`, branch `main`
- Framework preset: Vite (or None — the commands below are what
  matter)
- Root directory: `apps/web`
- Build command: `npm run build`
- Build output directory: `dist`

No environment variables are needed. After the first deploy the site
is live at `https://<project>.pages.dev`; a custom domain can be
added under the project's Custom domains tab.

**URL routing.** Every page has its own shareable link — clean
history-API URLs, no router dependency (`src/lib/routes.ts`
`ROUTE_PATHS`, `App.tsx` reads the path on load, `navigate()`
pushes, `popstate` drives back/forward):

| Path | Page | Path | Page |
| --- | --- | --- | --- |
| `/` | Home | `/ocr` | OCR |
| `/overview` | Workspace Overview | `/batch` | Batch Convert |
| `/tools` | All Tools | `/formats` | Formats |
| `/convert` | Convert Image | `/files` | My Files |
| `/resize` | Resize Image | `/recent` | Recent Files |
| `/pdf` | PDF Tools (picker) | `/settings` | Settings |
| `/pdf/merge` | Merge PDF | `/pdf/compress` | Compress PDF |
| `/pdf/split` | Split PDF | `/pdf/edit` | Edit PDF |
| `/pdf/rotate` | Rotate PDF Pages | `/pdf/redact` | Redact PDF |
| `/pdf/extract` | Extract PDF Pages | `/pdf/metadata` | Edit PDF Metadata |
| `/pdf/remove` | Remove PDF Pages | `/pdf/sanitize` | Clean Up PDF |
| `/pdf/reorder` | Reorder PDF Pages | `/pdf/flatten` | Flatten PDF |
| `/pdf/duplicate` | Duplicate PDF Pages | `/pdf/repair` | Repair PDF |
| `/pdf/reverse` | Reverse PDF Pages | `/pdf/pdf-to-image` | PDF to Image |
| `/pdf/booklet` | PDF Booklet | `/pdf/images-to-pdf` | Images to PDF |
| `/pdf/n-up` | N-up PDF | `/pdf/extract-text` | Extract PDF Text |
| | | `/help` | Help Center |

An unknown path renders the home page and the address bar is
corrected to `/` — there is no 404 page. An unknown `/pdf/*`
path falls back to the PDF picker (`/pdf`), not home.

Deep links work because `apps/web/public/_redirects` (copied to
`dist/` by the build) tells Pages to serve `index.html` for every
path:

```
/* /index.html 200
```

Local e2e servers must
provide the same fallback: use `apps/web/e2e/spa-server.mjs`
(`node apps/web/e2e/spa-server.mjs 8321`), NOT
`python3 -m http.server`, which 404s deep links and breaks any
suite that reloads on a routed page (web-e2e reloads on
`/formats`).

**What the hosted app can and cannot do** (see also
`apps/web/src/lib/capabilities.ts`): conversion covers PNG, JPEG,
WebP (canvas) plus BMP, TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM,
TGA and GIF (WASM engine). The PDF tab runs in the browser too:
page operations (merge, split, rotate, extract, remove, reorder,
duplicate, reverse, booklet, N-up, images→PDF) via the WASM
engine, and preview / PDF→PNG/JPEG via pdf.js. AVIF conversion,
metadata preservation, image processing (resize/crop/filters/
watermark) and frame/page extraction are CLI/desktop-only and are
not in the web app; PDF insert/replace and PDFium rendering are
CLI/desktop-only as well.
**ICO:** the format caps at 256×256, so a larger image is auto-resized
to fit (aspect preserved) and the UI shows a note — "Resized to
256×192 for ICO — ICO supports max 256×256" — next to the result;
the CLI prints the same as a warning.
