# PDF — Studio Phase 2: Core PDF Features (16 Nov 2026)

First user-facing PDF support: page operations, PDF info, PDF→image
rendering (PDFium), image→PDF, a CLI `pdf` subcommand, a web PDF tab
(WASM page ops + pdf.js preview/render), and WASM exports. Phase 1
gave the foundation (`openpixel-pdf`: format detection, merge/split
via lopdf, the PDFium prototype); this phase makes it a product.

## Capabilities

| Operation | Engine (`PdfEngine`) | CLI `openpixel pdf` | Web tab | WASM export |
|---|---|---|---|---|
| info (pages, sizes, metadata, encryption, version) | `inspect` | `info` | yes | `pdf_info` |
| merge | `merge` | `merge` | yes | `pdf_merge` |
| split by ranges | `split` | `split` | yes | `pdf_process` `{"kind":"split"}` |
| rotate 90/180/270 | `rotate` | `rotate` | yes | `pdf_process` |
| extract pages | `extract` | `extract` | yes | `pdf_process` |
| remove pages | `remove` | `remove` | yes | `pdf_process` |
| reorder pages | `reorder` | `reorder` | yes | `pdf_process` |
| duplicate pages | `duplicate` | `duplicate` | yes | `pdf_process` |
| insert pages | `insert` | `insert` | — (CLI/desktop) | — |
| replace a page | `replace` | `replace` | — (CLI/desktop) | — |
| reverse order | `reverse` | `reverse` | yes | `pdf_process` |
| booklet (saddle-stitch order) | `booklet` | `booklet` | yes | `pdf_process` |
| N-up layout | `nup` | `nup` | yes | `pdf_process` |
| render to PNG/JPG/WebP (PDFium) | `render_to_images` | `render` | — (pdf.js instead, see below) | — |
| image→PDF | `from_images` | `from-images` | yes | `pdf_from_images` |

All page numbers are **1-based** in the engine, the CLI and the
WASM JSON. Ranges are inclusive (`1-3` = pages 1, 2, 3).

## Page operations — semantics

- **rotate** adds to any existing `/Rotate` (a page already at 90°
  rotated by 90° ends at 180°). `--pages` omitted = all pages.
  Degrees must be 90, 180 or 270 (0 is accepted by the engine and
  is a no-op).
- **extract** keeps exactly the listed pages, in the given order;
  repeats are allowed (`extract --pages 3,1`).
- **remove** drops the listed pages. Removing every page is an
  error (a PDF with no pages is not a PDF).
- **reorder** must list every page exactly once; anything else is
  an error.
- **duplicate** copies each listed page right after itself.
- **insert** splices another document's pages **before** page N
  (`--at 2` inserts before page 2; `--at pages+1` appends).
- **replace** swaps one page for all pages of another document.
- **booklet** reorders pages for saddle-stitch printing and pads
  the document to a multiple of 4 pages with blank pages (a
  3-page document becomes 4; a 5-page document becomes 8).
- **N-up** lays source pages out on sheets as Form XObjects
  (`--cols 2 --rows 2` = 4 pages per sheet). The output sheet
  takes the first page's size.

Implementation: every op builds on the Phase 1 page-graph copier
(`copy_page_into` in `engine.rs`), which deep-copies each page
dictionary entry-by-entry — **skipping `/Parent`** — and reparents
the copy to the output Pages node. (A Phase 2 test caught the
Phase 1 bug: copying `/Parent` dragged the whole source Pages
tree, whose `/Kids` referenced every page, so split/extract
outputs contained the excluded pages' content streams as
unreachable orphans. Fixed with a regression test:
`split_does_not_leak_excluded_pages_text`.)

## Honest limits (Phase 2)

- **Page labels, outlines (bookmarks) and the Info dictionary are
  not carried over** by merge/split/page ops (Phase 1 known limit,
  still true). The output is a valid PDF with the right pages;
  document-level metadata beyond what `inspect` reads is dropped.
- **Encrypted PDFs fail cleanly** (`Encrypted` error) — no password
  support in this phase, never a crash, never a silent decrypt.
- **Malformed PDFs fail cleanly** with the lopdf error message.
- **N-up ignores a source page's `/Rotate`** (the form matrix
  translates the MediaBox origin but does not apply rotation).
  A rotated source page renders unrotated in its cell.
- **N-up output sheets take the first page's size**; pages of
  mixed sizes are scaled into uniform cells.
- **image→PDF flattens alpha onto white** (DeviceRGB, no SMask).
  One page per image; page size is the image's own size in points
  (1 px = 1 pt) unless a named size is given (A4 595×842,
  Letter 612×792, A5 420×595) — the image is fitted inside,
  aspect preserved, centred.
- **PDF/A is out of scope** — nothing in this phase claims it.
- **No text extraction, no form handling, no compression** — those
  are Phases 3–5. `optimize()` still says so honestly.
- **Render scale is 0.25..=6.0** and rendered dimensions are capped
  at the image engine's 16,384 px limit.

## PDF→image rendering (PDFium)

`PdfEngine::render_to_images(bytes, pages, scale)` renders pages
with PDFium (1.0 = 72 DPI, 2.0 = 144 DPI) and returns RGBA8
`DecodedImage`s, which the CLI encodes with the normal image
engine (`Engine::encode_decoded` — the same shared encode tail as
`convert`, so the ICO 256×256 auto-resize and quality defaults
apply).

### Threading — a real upstream constraint, handled honestly

pdfium-render promotes the library bindings into a global
`OnceCell`: PDFium allows exactly **one binding per process**,
and a `Pdfium` handle is `!Send`. So all rendering runs on a
**single dedicated worker thread** that owns the one `Pdfium`
(`crates/openpixel-pdf/src/render.rs`, `mod worker`); callers
send jobs over a channel and wait for the result. Any thread may
request a render; the worker serialises them. The worker lives
for the process lifetime (detached). A future jobs-pool render
path reuses this worker — it does not need a second binding.

### Provisioning libpdfium — dev, CI, distribution

The binary is **never compiled in and never committed**. It is
loaded at runtime, in this order:

1. `OPENPIXEL_PDFIUM_PATH` (a file),
2. `OPENPIXEL_PDFIUM_DIR` (a directory holding the library),
3. next to the current executable (so a release tarball can ship
   `libpdfium.so` beside the `openpixel` binary),
4. the system library,
5. `./target/pdfium` (dev cache),
6. the workspace `target/pdfium` (compile-time path, so
   `cargo test` finds it whatever the test binary's CWD is).

Fetch it with the pinned script (never "latest"):

```
scripts/pdfium/fetch-pdfium.sh [--force] [--dir DIR]
```

Pinned to **bblanchon/pdfium-binaries, tag `chromium/8152`**
(PDFium 159.0.8152.0), Linux x64 sha256
`384ab5c51882408a143a21f9c14dcd2caf1f75280ae41c554d0489b46c3dba9f`
(verified against the downloaded archive; the script checks it
and fails loudly on mismatch). macOS (x64/arm64) and Windows
(x64) assets exist at the same tag; their shas are not recorded
yet — the script prints the downloaded sha256 and asks the
operator to record it in `LICENSE_AUDIT.md`. Full provenance is
in `LICENSE_AUDIT.md` (PDFium section).

When nothing is found, render fails with a clear
`NotImplemented` error that names the script and the env var —
never a fake image. Without the `pdfium` cargo feature the
same error is returned (the crate builds without any PDFium
dependency at all).

**Distribution (not solved in this phase, stated plainly):**
there is no installer step that ships libpdfium yet. The CLI
`pdf render` command works wherever the operator places the
library (see the resolution order above); a desktop release
that bundles it is Phase 7/8 work. The web app never ships it
— the browser has no use for a native binary (see below).

### Render verification

The render tests render real lopdf-generated PDFs and assert
visible text (dark pixels > 0 — an all-white render is a silent
failure, not a render), exact dimensions at scale 1.0/2.0, and
that `from_images` output and N-up sheets really render (all
four N-up quadrants must contain text). The CLI e2e (§10) renders
a 3-page fixture PDF to PNG and JPG and re-verifies each output
with `file` + `openpixel info`.

## Image→PDF

`PdfEngine::from_images(images, page_size)` decodes each image
with the image engine (PNG/JPEG/WebP/HEIC/… — anything it
decodes), embeds it as a FlateDecode RGB image XObject (flate2,
pre-compressed streams are left alone — lopdf only compresses
streams when `Document::compress()` is explicitly called), one
page per image, in order. Verified by rendering the result back
through PDFium in the tests.

## Browser vs CLI/desktop — the honest split

| Capability | Browser (web tab) | CLI / desktop |
|---|---|---|
| Page ops (merge/split/rotate/…/N-up) | yes — real lopdf in WASM (`pdf_process`, `pdf_merge`) | yes — same engine |
| image→PDF | yes — WASM (`pdf_from_images`) | yes |
| PDF info | yes — WASM (`pdf_info`) | yes |
| Page preview | yes — **pdf.js** renders the page to canvas | yes — PDFium (native) |
| PDF→image file (PNG/JPG) | yes — **pdf.js** render → canvas → download | yes — **PDFium** render → image engine encode |
| PDFium render | **no** — PDFium is a native binary, it cannot load in the browser | yes (needs libpdfium, see above) |
| Encrypted PDFs | fails cleanly (lopdf) | fails cleanly (lopdf) |

The browser render path (pdf.js) and the native render path
(PDFium) are different rasterisers: same pages, possibly slightly
different pixels (fonts, anti-aliasing). The web UI never claims
its render is PDFium output.

## WASM exports (Phase 2)

In `crates/openpixel-wasm` (dav1d-free build, `pdfium` feature
**off** — the PDF exports are pure Rust lopdf):

- `pdf_info(bytes)` → `PdfInfo` JS object.
- `pdf_process(bytes, ops_json)` → `Uint8Array[]`, one per output
  document (one per range for split). Ops JSON: see
  `docs/API.md` (PDF section) or the doc comment on the export.
- `pdf_merge(documents)` — JS array of `Uint8Array` → one PDF.
- `pdf_from_images(images, page_size?)` — JS array of
  `Uint8Array` → one PDF.

## CLI reference

```
openpixel pdf info <input> [--json]
openpixel pdf merge <a.pdf> <b.pdf>... -o <out.pdf>
openpixel pdf split <input> --ranges 1-3,5-7 [--out-dir <dir>]
openpixel pdf rotate <input> <output> [--pages 1,3] --degrees 90|180|270
openpixel pdf extract <input> <output> --pages 1,3,5
openpixel pdf remove <input> <output> --pages 2
openpixel pdf reorder <input> <output> --order 3,1,2
openpixel pdf duplicate <input> <output> --pages 1
openpixel pdf insert <input> <other.pdf> <output> --at 2
openpixel pdf replace <input> <replacement.pdf> <output> --page 2
openpixel pdf reverse <input> <output>
openpixel pdf booklet <input> <output>
openpixel pdf nup <input> <output> [--cols 2] [--rows 2]
openpixel pdf render <input> [--out-dir <dir>] [--pages 1,3] [--format png] [--scale 2.0] [--quality 85]
openpixel pdf from-images <img1> <img2>... -o <out.pdf> [--page-size A4|Letter|A5]
```

Page lists accept `1,3,5` and ranges `1-3,5`. `--json` prints a
machine-readable summary for every command. Exit codes: 0
success, 1 any error (`error: …` on stderr unless `--quiet`).
Split/render default `--out-dir` is `<input-stem>-split` /
`<input-stem>-pages` next to the input; split parts are named
`<stem>-part1.pdf`, renders `<stem>-p1.png`.

## Testing

- `cargo test -p openpixel-pdf` (21 lib + 4 integration, no
  feature) and `--features pdfium` (23 lib + 4 integration):
  page ops (incl. the no-leak regression test), render (visible
  text, dimensions, N-up quadrants, from-images round-trip),
  the no-feature honest-error test.
- `cargo test -p openpixel-wasm` (14 tests, incl. 3 PDF export
  tests) + `cargo check -p openpixel-wasm --target
  wasm32-unknown-unknown` + `cargo check -p openpixel-pdf
  --target wasm32-unknown-unknown`.
- CLI e2e `scripts/test/cli-e2e.sh` §10: fixtures built with
  `from-images`, every op re-verified with `pdfinfo`, renders
  re-verified with `file` + `openpixel info`, error cases exit 1.
- Web e2e `apps/web/e2e/pdf-e2e.mjs`: upload a real PDF, info
  shown, merge/split works, PDF→PNG is a genuine image at the
  requested dimensions.
