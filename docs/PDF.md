# PDF — Studio Phase 3: Conversion and Compression (16 Nov 2026)

First user-facing PDF support: page operations, PDF info, PDF→image
rendering (PDFium), image→PDF, a CLI `pdf` subcommand, a web PDF tab
(WASM page ops + pdf.js preview/render), and WASM exports. Phase 1
gave the foundation (`openpixel-pdf`: format detection, merge/split
via lopdf, the PDFium prototype); Phase 2 made it a product.
Phase 3 adds **compression** (screen/ebook/printer), **security**
(password protect, permissions, watermark), **text extraction**
(PDF→TXT/HTML/EPUB/DOCX via PDFium), and **document conversion**
via LibreOffice headless (CLI/desktop only), plus a conversion
registry that says honestly what runs where.

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
| **compress (screen/ebook/printer)** | `compress` | `compress` | yes (mode + strip metadata) | `pdf_compress` |
| **password protect (RC4-128)** | `protect` | `protect` | — (CLI/desktop) | — |
| **unlock** | `unlock` | `unlock` | — (CLI/desktop) | — |
| **text watermark** | `watermark` | `watermark` | — (CLI/desktop) | — |
| **extract text (PDFium)** | `extract_text` | `extract-text` | — (CLI/desktop) | — |
| **PDF→TXT/HTML/EPUB/DOCX (text-only)** | `text_to_*` | via `extract-text` | — (CLI/desktop) | — |
| **Office↔PDF (LibreOffice)** | `DocumentEngine::convert` | `doc convert` | — (CLI/desktop, honest note) | — |

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

## Honest limits (Phase 2, still true unless noted)

- **Page labels, outlines (bookmarks) and the Info dictionary are
  not carried over** by merge/split/page ops (Phase 1 known limit,
  still true). The output is a valid PDF with the right pages;
  document-level metadata beyond what `inspect` reads is dropped.
- **Encrypted PDFs fail cleanly** (`Encrypted` error) — no password
  support in this phase, never a crash, never a silent decrypt.
  Phase 3 adds password *protection* (`protect`/`unlock` below);
  opening an encrypted PDF still needs its password, and
  `unlock` is the only way in.
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
- **No form handling** — that is Phase 5.
- **Render scale is 0.25..=6.0** and rendered dimensions are capped
  at the image engine's 16,384 px limit.

## Compression (Phase 3)

`PdfEngine::compress(bytes, mode, options)` — two passes:

1. **Image pass.** Every embedded image XObject whose drawn size
   is known (found in a page content stream as `… cm /Name Do`)
   is downscaled to the mode's target DPI (Lanczos3) and
   re-encoded as JPEG at the mode's quality, via the image
   engine. Uncompressed (FlateDecode) RGB images are re-encoded
   as JPEG even when no downsampling is needed — that is where
   the big saving is for PDFs built from images (`pdf
   from-images` stores Flate RGB). An image that is already JPEG
   at or under its target size is left alone (re-encoding it
   would only lose quality). Skipped images (transparency
   `/SMask`, 1-bit masks, unsupported colour space/filter, no
   drawn size — e.g. drawn from inside a Form XObject) are
   counted with the reason recorded, never silently dropped.
   A FlateDecode image whose stream content is not actually
   compressed is skipped too: lopdf silently decodes such a
   stream to empty, so the pass treats "0 raw bytes" as a
   corrupt image rather than writing a blank one.
2. **Structure pass.** lopdf `Document::compress()` (Flate every
   stream that allows it), saved with object streams + xref
   streams at compression level 9. Optionally strips the `/Info`
   metadata dictionary.

Modes:

| Mode | Target DPI | JPEG quality | For |
|---|---|---|---|
| `screen` | 72 | 50 | on-screen viewing only |
| `ebook` | 150 | 75 | reading on a tablet/e-reader (default) |
| `printer` | 300 | 90 | print, keep the most detail |

**Honesty rule (measured, not promised):** the outcome reports
input/output bytes and the images recompressed/skipped. When the
compressed file is *larger* than the input and no transformation
was requested, the **original bytes are returned** and the note
says so. A requested transformation (metadata strip) is always
returned, even when it costs bytes, and the outcome reports the
honest (possibly negative) saving.

**Measured results (16 Nov 2026, real CLI runs):**

| Input | Mode | Output | Saved |
|---|---|---|---|
| `photo.pdf` — 1 page, one 1024×768 Flate RGB image, 1,687,939 B | screen | 70,306 B | **95.8%** |
| same | ebook | 120,063 B | **92.9%** |
| same | printer | 260,116 B | **84.6%** |
| `test.pdf` — 4 pages, four tiny images, 3,315 B | ebook | 3,315 B (original kept) | **0.0%** — the JPEG re-encode of tiny images costs more than the Flate originals; the note says the compressed output (17,522 B) was not smaller |
| same | ebook + `--strip-metadata` | 17,522 B | **−428.6%** — the strip was requested, so the transformed file is returned with the honest negative saving |

Re-encoding a JPEG as a JPEG loses a little quality every time
(lossy → lossy); that is the price of the size. Font subsetting
is **not** done: lopdf exposes no API for subsetting fonts that
are already embedded, so it is not claimed. **Linearisation is
not offered**: lopdf 0.47's `SaveOptions.linearize` is never read
by its writer (verified by reading the lopdf source — the field
exists only in the options struct and in the linearisation
*reader*), so the option would be a fake. A linearised (fast-web-view)
writer needs qpdf or a future lopdf — recorded as a gap, not
shipped as a flag.

`optimize()` (the `ProcessingEngine` trait) now works: Lossless
= structure pass only, Balanced = ebook, Aggressive = screen.

## PDF security (Phase 3)

`protect` / `unlock` / `watermark` — CLI/desktop only (no WASM
export: passwords in a browser tab are a foot-gun, and the web
app never handles them).

- **Password protect** (`PdfEngine::protect`): RC4-128
  (lopdf `EncryptionVersion::V2`, revision 3, 128-bit key). Both
  a user password (opens the file) and an optional owner
  password (full rights) are set; at least one non-empty password
  is required. Permissions are three booleans — print, copy,
  modify — mapped onto lopdf's `Permissions` bitflags (the other
  bits stay at their defaults). The protected file verifies as
  encrypted afterwards (`pdfinfo` reports `Encrypted: yes`).
  Protecting an already-encrypted file is an error.
  **Honest limit: RC4-128 only.** lopdf 0.47's V4 (AES-128) needs
  caller-supplied crypt filters and V5/R5 needs a precomputed
  file encryption key — neither is wired up, so AES is not
  claimed. RC4 is weak by modern standards; it is what the
  library supports, and the docs say so rather than calling it
  "strong encryption".
- **Unlock** (`PdfEngine::unlock`): loads with the given password
  (user or owner), strips the `/Encrypt` marker, saves a clean
  file. Wrong password and not-encrypted inputs are clean errors.
  Implementation note (two lopdf behaviours, verified by probing):
  a password-less load of an encrypted file loads *only* the
  `/Encrypt` dictionary — decrypting that afterwards saves an
  almost-empty file. So `unlock` first loads password-less only
  to check `is_encrypted()`, then loads *with* the password
  (which decrypts all objects and strips the marker), then
  defensively drops any surviving `/Encrypt` entry without
  re-decrypting (RC4 is symmetric — re-decrypting corrupts).
- **Watermark** (`PdfEngine::watermark`): diagonal centred text
  on every page (Helvetica Type1, 48 pt, 25% opacity, 45°,
  mid-grey). Non-ASCII text becomes `?` (Type1 Helvetica has no
  Bengali/Arabic glyphs — stated, not hidden). The watermark is
  a content-stream addition, not a flattened render, so the
  text stays selectable and the file stays small.
- **Encryption `/ID` fix:** lopdf's R4 key derivation mixes in
  the trailer `/ID`; documents without one (all lopdf-generated
  fixtures) fail `protect` with a decryption error. `protect`
  generates two 16-byte hex IDs first when the trailer has none.
  Real-world PDFs normally already carry an `/ID`.

## Text extraction (Phase 3)

`PdfEngine::extract_text(bytes, pages)` — PDFium text extraction
(`PdfPage::text()`, segments grouped into lines by vertical
centre, tolerance `max(height) * 0.6`, a space when the gap
exceeds 2 pt, lines top-to-bottom, segments left-to-right;
coordinates are top-left origin in points). Needs the `pdfium`
cargo feature and a libpdfium at runtime — without either, the
error says so honestly and names `fetch-pdfium.sh`. The web app
does not extract text (no PDFium in the browser).

From the extracted text the engine builds four formats
(`crates/openpixel-pdf/src/text.rs`):

| Format | Builder | Notes |
|---|---|---|
| TXT | `text_to_txt` | `--- Page N ---` headers, one line per line |
| HTML | `text_to_html` | semantic, lines indented by their x position |
| EPUB | `text_to_epub` | EPUB 3, mimetype first + stored, one chapter per page, nav |
| DOCX | `text_to_docx` | minimal OOXML, one paragraph per line |

**Honest limits:** text only — fonts, images, tables and the
original layout are NOT preserved. The EPUB/DOCX are reflowable
documents built from the extracted lines, not a faithful copy
of the PDF. Segments closer than 2 pt are joined without a
space, so adjacent bold/italic runs on one line can run
together in the output ("Bold run.Italic run."). Scanned
(image-only) PDFs have no text to extract; that is Phase 4
(OCR), not this. A PDF→DOCX round-trips through LibreOffice
back to PDF with the text intact (verified in the CLI e2e §11).

## Document conversion — LibreOffice headless (Phase 3)

`openpixel-documents` (`DocumentEngine`) converts Office and
document formats through LibreOffice headless, **desktop/server
only** — LibreOffice cannot run in a browser (no WASM), so the
web app shows an honest "CLI/desktop only" note and no fake
conversion UI. The full matrix lives in
`crates/openpixel-formats/src/conversion.rs` (31 rows) and is
mirrored in `openpixel-api` types; `openpixel doc formats`
prints it with the detected LibreOffice version.

How it works: the adapter (`libreoffice.rs`) discovers `soffice`
(`OPENPIXEL_SOFFICE_PATH`, then `soffice`, then `libreoffice`
on `PATH`), runs each conversion in a **fresh user profile**
(a shared profile across rapid sequential conversions once
produced a spurious "no output" failure), captures stdout/stderr
to log files (no pipe deadlock), polls every 50 ms, kills on
timeout (default 120 s), and — critically — **verifies the
output file exists and is non-empty**. LibreOffice headless
exits 0 even when a conversion is unsupported ("Error: no export
filter … found, aborting." in the log, no file written), so the
exit code is never trusted; the log's error lines are surfaced.

**Fidelity results (LibreOffice 24.2.7.2, measured 16 Nov 2026,
CLI e2e §11 fixtures — reproducible via
`scripts/test/cli-e2e.sh`):**

| Conversion | Result | Fidelity observed |
|---|---|---|
| docx → pdf | ✓ 29,216 B, 2 pages | heading, bold/italic, table survive; text intact via pdftotext |
| xlsx → pdf | ✓ 8,104 B, 1 page | table intact |
| pptx → pdf | ✓ 14,485 B, 2 slides | slides render |
| txt → pdf | ✓ 9,481 B, 1 page | text intact |
| csv → pdf | ✓ 10,259 B, 1 page | renders as a table |
| html → pdf | ✓ 16,577 B, 1 page | list bullets survive |
| rtf → pdf | ✓ 14,272 B, 1 page | text intact |
| odt → pdf | ✓ 29,664 B, 2 pages | same as docx source |
| ods → pdf | ✓ 8,742 B, 1 page | table intact |
| odp → pdf | ✓ 14,948 B, 2 pages | slides render |
| docx → odt / txt / rtf / html | ✓ | text survives; formatting lost in txt |
| xlsx → ods / csv / html | ✓ | csv is byte-exact back (`Name,Qty,Price …`) |
| pptx → odp | ✓ | slides survive |
| odt → docx | ✓ 8,622 B | round-trips |
| ods → xlsx | ✓ 5,922 B | round-trips |
| odp → pptx | ✓ 42,732 B | round-trips |
| html → docx | ✓ 8,622 B | needs a fresh profile (first attempt with a shared profile failed) |
| csv → xlsx | ✓ 5,596 B | table survives |
| txt → docx | ✓ 5,002 B | text survives |
| pdf → html | ✓ 728 B (LibreOffice) | text survives, bold/italic roughly preserved, exact layout does not |
| pdf → txt / epub / docx | ✓ (PDFium text extraction) | text only, one section per page (txt) / one chapter per page (epub) / one paragraph per line (docx); fonts, images, tables, layout NOT preserved |
| pdf → xlsx / pptx / odt / rtf | ✗ **not supported** | LibreOffice has no export filter for these from PDF; the engine refuses them honestly and names what the source *can* convert to |
| pptx → txt | ✗ **not supported** | no export filter; refused honestly |

**Never promised:** perfect formatting preservation. LibreOffice
re-renders the document; complex formatting may shift. The
fidelity column above is what was actually observed on the test
fixtures, not a guarantee for arbitrary documents. OLE2 legacy
formats (`.doc`/`.xls`/`.ppt`) are detected by magic bytes
(`D0 CF 11 E0 …`) but the bytes alone cannot tell doc/xls/ppt
apart — the caller must pass the extension as the source hint.

**Provisioning:** LibreOffice was already installed in this VM
(24.2.7.2) — no `apt` install was needed. `LICENSE_AUDIT.md`
records the MPL-2.0 row (system dependency, not bundled).

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
| Encrypted PDFs | fails cleanly (lopdf) | fails cleanly (lopdf); `pdf unlock` is the way in |
| PDF compress (screen/ebook/printer) | yes — WASM (`pdf_compress`), same engine, same best-of rule | yes |
| Password protect / unlock / watermark | **no** — passwords and native-only ops stay in the CLI/desktop | yes |
| Text extraction (PDF→TXT/HTML/EPUB/DOCX) | **no** — needs PDFium (native) | yes (needs libpdfium) |
| Office↔PDF conversion | **no** — LibreOffice cannot run in a browser; the PDF tab says so plainly | yes (`openpixel doc convert`) |

The browser render path (pdf.js) and the native render path
(PDFium) are different rasterisers: same pages, possibly slightly
different pixels (fonts, anti-aliasing). The web UI never claims
its render is PDFium output.

## WASM exports (Phase 2 + 3)

In `crates/openpixel-wasm` (dav1d-free build, `pdfium` feature
**off** — the PDF exports are pure Rust lopdf):

- `pdf_info(bytes)` → `PdfInfo` JS object.
- `pdf_process(bytes, ops_json)` → `Uint8Array[]`, one per output
  document (one per range for split). Ops JSON: see
  `docs/API.md` (PDF section) or the doc comment on the export.
- `pdf_merge(documents)` — JS array of `Uint8Array` → one PDF.
- `pdf_from_images(images, page_size?)` — JS array of
  `Uint8Array` → one PDF.
- `pdf_compress(bytes, options_json)` → `{ data, input_bytes,
  output_bytes, saved_bytes, saved_percent, images_recompressed,
  images_skipped, note }`. Options JSON:
  `{"mode":"screen"|"ebook"|"printer","strip_metadata":bool}`.
  No linearise option exists (lopdf ignores it — see
  Compression above). **BigInt rule (caught by pdf-e2e, not by
  the unit tests):** the byte counts are emitted as JS numbers
  (f64), never as `JsValue::from(u64/i64)` — the latter arrives
  in JS as a BigInt, and the UI's `formatBytes` divides it,
  which throws "Cannot mix BigInt and other types" at runtime.
  The TS wrapper also coerces with `Number()` as defence.
  Any future export that returns a size must do the same.

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
openpixel pdf compress <input> <output> [--mode screen|ebook|printer] [--strip-metadata]
openpixel pdf protect <input> <output> --user-password <pw> [--owner-password <pw>] [--no-print] [--no-copy] [--no-modify]
openpixel pdf unlock <input> <output> --password <pw>
openpixel pdf watermark <input> <output> --text <text> [--font-size 48] [--opacity 0.25] [--angle 45]
openpixel pdf extract-text <input> [-o <out>] [--pages 1,3] [--format txt|html|epub|docx]
openpixel doc convert <input> --to <pdf|docx|xlsx|...> [-o <out>] [--timeout-secs 120]
openpixel doc formats [--json]
```

Passwords are command-line arguments — use `protect`/`unlock`
only on your own machine, never in shared shell history you
care about. `doc convert` takes the source format from the
input file's extension (OLE2 `.doc`/`.xls`/`.ppt` need it);
`--to` is the target extension without a dot.

Page lists accept `1,3,5` and ranges `1-3,5`. `--json` prints a
machine-readable summary for every command. Exit codes: 0
success, 1 any error (`error: …` on stderr unless `--quiet`).
Split/render default `--out-dir` is `<input-stem>-split` /
`<input-stem>-pages` next to the input; split parts are named
`<stem>-part1.pdf`, renders `<stem>-p1.png`.

## Testing

- `cargo test -p openpixel-pdf` (33 lib + 4 integration, no
  feature) and `--features pdfium` (37 lib + 4 integration):
  page ops (incl. the no-leak regression test), render (visible
  text, dimensions, N-up quadrants, from-images round-trip),
  the no-feature honest-error test, compression (screen shrinks
  a photo PDF, Flate images recompressed even without
  downsampling, printer keeps more, text-PDF honest report,
  metadata strip), security (protect/unlock round-trip,
  permission bits read back from `/Encrypt`, watermark render
  check), text extraction (real text + layout, EPUB/DOCX
  exports verified by unzipping).
- `cargo test -p openpixel-documents` (11 tests): registry
  lookups, honest unsupported pairs, OLE2 + hint, real
  LibreOffice conversions (docx→pdf, txt→pdf, pdf→html),
  PDFium-gated text routes, zero-timeout kill.
- `cargo test -p openpixel-formats` (14 tests) and
  `cargo test -p openpixel-api` (4 tests): the 31-row conversion
  registry, honest gaps absent, API mirror of the registry.
- `cargo test -p openpixel-wasm` (15 tests, incl. the
  `pdf_compress` export test) + `cargo check -p openpixel-wasm
  --target wasm32-unknown-unknown` + `cargo check
  -p openpixel-pdf --target wasm32-unknown-unknown`.
- CLI e2e `scripts/test/cli-e2e.sh` §10 (Phase 2) + **§11
  (Phase 3)**: compression sizes measured on a real photo PDF
  in all three modes, protect/unlock round-trip with pdfinfo
  encryption checks, watermark, extract-text in all four
  formats (docx round-trips back through LibreOffice),
  LibreOffice conversions across the matrix with pdftotext
  verification, honest refusals (pdf→xlsx, pptx→txt) exit 1.
- Web e2e `apps/web/e2e/pdf-e2e.mjs` (15 checks): upload a real
  PDF, info shown (page count is just the number — the
  "Pages | Pages: 4" duplication is fixed), merge/split works,
  PDF→PNG is a genuine image at the requested dimensions,
  compress downloads a real PDF no bigger than the input.
