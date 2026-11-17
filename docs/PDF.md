# PDF — Studio Phases 2–5: Page ops, Compression, Editing and Security (17 Nov 2026)

First user-facing PDF support: page operations, PDF info, PDF→image
rendering (PDFium), image→PDF, a CLI `pdf` subcommand, a web PDF tab
(WASM page ops + pdf.js preview/render), and WASM exports. Phase 1
gave the foundation (`openpixel-pdf`: format detection, merge/split
via lopdf, the PDFium prototype); Phase 2 made it a product.
Phase 3 adds **compression** (screen/ebook/printer), **security**
(password protect, permissions, watermark), **text extraction**
(PDF→TXT/HTML/EPUB/DOCX via PDFium), and **document conversion**
via LibreOffice headless (CLI/desktop only), plus a conversion
registry that says honestly what runs where. Phase 4 adds **OCR**
(see `docs/OCR.md`). Phase 5 adds **editing and security**:
overlay editor (text/images/shapes/highlight/draw/comments/page
numbers/header-footer), **real digital signatures** (sign + verify,
CMS/PKCS#7), **real redaction** (text removed from the content
stream, byte-verified), flatten, metadata editing, repair and
sanitisation (JavaScript/embedded files/launch actions removed).

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
| **overlay editor (text/image/shapes/highlight/draw/comments/page numbers/header-footer)** | `edit` | `edit` | yes (text, shapes, highlight, page numbers, header/footer, comment) | `pdf_edit` |
| **digital signature (sign)** | `sign` | `sign` | — (CLI/desktop, needs a private key) | — |
| **signature verification** | `verify_signatures` | `verify-sign` | — (CLI/desktop) | — |
| **redaction (real content removal)** | `redact` | `redact` | yes (text + rect) | `pdf_redact` |
| **flatten (annotations/form fields into page content)** | `flatten` | `flatten` | yes | `pdf_flatten` |
| **metadata editing (Title/Author/Subject/Keywords)** | `set_metadata` | `set-metadata` | yes | `pdf_set_metadata` |
| **repair (rebuild xref)** | `repair` | `repair` | yes | `pdf_repair` |
| **sanitisation (strip JS/embedded files/launch/auto-actions)** | `sanitize` | `sanitize` | yes | `pdf_sanitize` |
| **threat inspection (JS/embedded files/launch/auto-actions)** | `inspect_threats` | `inspect` | yes | `pdf_inspect` |

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
- **Encrypted PDFs fail cleanly** (`Encrypted` error) for every
  operation that needs the content — no password support in
  this phase, never a crash, never a silent decrypt. Phase 3
  adds password *protection* (`protect`/`unlock` below);
  opening an encrypted PDF still needs its password, and
  `unlock` is the only way in. **Exception, Phase 4:** `pdf
  info` no longer errors on an encrypted PDF — it reports
  `Encrypted: yes` with the algorithm (from `/V`), revision and
  the permission bits (print/modify/copy/annotate, from `/P`),
  read from the `/Encrypt` dictionary without a password, and
  `pages: unknown (encrypted)`. The page count is genuinely
  unknowable without the password: lopdf loads no objects for an
  encrypted document waiting for its password, so `page_count`
  is 0 in JSON and `page_sizes` is empty — unknown, not zero.
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
- **No form handling in Phases 2–4** — Phase 5 adds flatten
  (annotations/form fields into page content); interactive form
  filling is still not a feature.
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

## Editing and security (Phase 5)

### Overlay editor — NEW content, never in-place text editing

`PdfEngine::edit(bytes, ops, images)` appends one content stream
per touched page **after** the existing content, so overlays draw
on top. The UI and the CLI say this plainly: **overlays are new
content layered on the page; existing text objects are never
edited in place** — lopdf cannot do that reliably, and OpenPixel
never claims to.

Ops (`OverlayOp`, serde-tagged `kind`):

- `text` — text at (x, y) in points (origin bottom-left), size,
  colour, one of six standard fonts (helvetica, helvetica-bold,
  helvetica-oblique, helvetica-bold-oblique, times-roman,
  courier). WinAnsi only: non-ASCII characters become `?`
  (same rule as the Phase 3 watermark).
- `image` — an image (any decodable format) embedded as a
  FlateDecode RGB XObject at (x, y, width, height); alpha is
  flattened to white, like `from_images`.
- `rect` / `line` / `circle` — shapes with fill and/or stroke
  colours and a stroke width.
- `highlight` — a translucent rectangle (opacity 0..1) behind
  text; drawn as a filled rect with an ExtGState.
- `draw` — a freehand stroke (a polyline through the given
  points).
- `comment` — a `/Text` annotation (a sticky note), not page
  content; it carries text + author and opens in a PDF reader.
- `page_numbers` — "Page {n} of {total}" (customisable format
  with `{n}` / `{total}`) on the listed pages, at the bottom
  centre/right or top centre/right.
- `header_footer` — a header line and/or a footer line on the
  listed pages.

Shared font objects (F1..F6) and one ExtGState per opacity are
created once per document, not once per op. `EditOutcome`
reports `ops_applied`, `pages_touched`, `comments_added` and
warnings. An empty op list is an error.

### Digital signatures — real CMS/PKCS#7, RSA only

`PdfEngine::sign(bytes, key_pem, cert_pem, options)` (feature
`sign`, CLI/desktop only) creates a detached PKCS#7 signature
(`SubFilter adbe.pkcs7.detached`) with a SHA-256 digest, built
with the pure-Rust `cms` crate (builder API) + `rsa` + `x509-cert`.
The key is read from a PKCS#8 or PKCS#1 PEM file; the cert from
PEM or DER. **Two-pass placeholder:** pass 1 writes an 8192-byte
`/Contents` placeholder, the CMS DER length is measured, then
pass 2 writes an exactly-sized placeholder (no zero padding left
behind). The `/ByteRange` is patched in place so the signature
covers everything except the `/Contents` itself.

`PdfEngine::verify_signatures(bytes, trust_anchors)` walks
`/AcroForm /Fields` for `/FT /Sig` fields and, per signature,
checks: (1) the message digest matches the signed byte ranges
(tamper detection — one changed byte fails this), (2) the CMS
signature verifies with the signer's certificate over the signed
attributes, (3) the signing time falls inside the certificate's
validity window (else it is checked against now), (4) a
self-signed certificate's own signature verifies. The report is
honest: `valid` = the cryptography checks out; `trusted` = the
signer IS a supplied trust anchor, or an anchor issued it (one
level). `valid: yes, trusted: no` is the normal result for a
self-signed certificate verified without its anchor — it is not
an error.

**How a real user supplies a certificate:** generate a key + a
self-signed certificate with `openssl req -x509 -newkey rsa:2048
-keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=Your
Name"`, then `openpixel pdf sign in.pdf out.pdf --key key.pem
--cert cert.pem`. A certificate from a real CA works the same
way — pass the CA's certificate with `--trust` at verify time.
The test fixtures use a throwaway self-signed certificate
generated with `openssl` inside the e2e run (never a checked-in
private key).

**Honest limits:** RSA only — an ECDSA certificate is reported
as unsupported, never silently accepted. No revocation checking
(CRL/OCSP), no timestamp authority (TSA), no long-term validation
(LTV). A signature whose CMS is malformed is reported `valid:
false` with reasons, never a panic. Signatures are
CLI/desktop-only: a private key must never be uploaded to a web
page, and the WASM build has no signing export.

### Redaction — real content removal, not a black box

`PdfEngine::redact(bytes, redactions)` removes the text from the
content stream **and** the text layer, then draws a black cover
rect over the area so the gap is visible. A black rectangle over
live text is NOT redaction and is never offered as one.

- `RectRedaction {page, x, y, width, height}` — every glyph whose
  box strictly overlaps the rectangle is removed (a glyph merely
  touching the edge is kept).
- `TextRedaction {page, text}` — the text is searched (within a
  single content-stream run) and becomes a rect redaction.

The old content streams are replaced and deleted from the
document when uniquely referenced (a shared-stream refcount
guard keeps streams other pages still use). Annotations
intersecting a redaction rect are removed. **Self-check:** the
rebuilt ops must contain exactly the original characters minus
the removed ones, or the whole operation fails loudly instead of
shipping a fake redaction. The output is re-parsed before it is
returned.

**Verify it yourself:** `grep -a "SECRET-123" redacted.pdf`
must print nothing, and `openpixel pdf extract-text
redacted.pdf` must not contain the secret either. The CLI e2e
§13 does exactly this (byte-proof + text-layer proof).

**Honest limits:** text inside Form XObjects is not reached
(the cover rect still hides it visually, but the bytes remain —
the module docs say so); vector-outline text has no text to
remove; character positions are estimated (font size × 0.5
width, like the watermark); search works within one run only;
`/Info` metadata is not redacted — use `set-metadata` for that.

### Flatten, metadata, repair, sanitisation, inspection

- **`flatten`** inlines each annotation's appearance stream into
  the page content (with its rect/bbox/matrix transform and a
  resource merge that renames on collision) and removes
  `/AcroForm` + field dictionaries. An annotation **without** an
  appearance stream cannot be rendered into content, so it is
  counted as dropped with a warning — the CLI prints
  `0 annotation(s) flattened, 1 dropped` for a plain comment
  rather than pretending it was flattened.
- **`set_metadata`** writes Title/Author/Subject/Keywords into
  `/Info` (creating it if missing). Passing an empty string
  clears that field; omitting it leaves it unchanged. At least
  one field is required.
- **`repair`** loads leniently and re-saves; `RepairOutcome`
  reports `as written` (healthy), `offset corrected` or
  `reconstructed` (damaged xref, rebuilt from object offsets).
  An unparseable file is an honest error, never a silent empty
  PDF.
- **`sanitize`** removes JavaScript actions, launch actions,
  auto-actions (`/OpenAction`, `/AA`), embedded files
  (`/EmbeddedFiles`, `/Filespec` + their streams) and XFA forms,
  then sweeps every reference to the deleted objects out of the
  surviving document and re-inspects the output — if anything
  dangerous survives, it fails loudly instead of returning a
  half-clean file. A GoTo `/OpenAction` (a plain page jump) is
  kept. The document stays openable (the e2e checks the
  sanitised file with `pdfinfo`).
- **`inspect_threats`** lists JavaScript, embedded files, launch
  actions and auto-actions as present/absent (with names where
  known) **without executing anything** — it is a structural
  walk of the catalog and object dictionaries. The Phase 1
  byte-scan (`openpixel-security`) is the same detection at the
  raw-bytes level; `inspect_threats` is the structural one.

### lopdf vs qpdf — the honest unknown, resolved with evidence

Phase 5 was built entirely on lopdf 0.47.0 and every exit
criterion passed on it: overlays, signatures, redaction,
flatten, repair and sanitisation all work. No lopdf wall was
hit that blocks any criterion, so **qpdf was not added** (it is
a C++ FFI dependency and would change the build). The known
lopdf gaps that remain are the ones listed above (no in-place
text editing, no Form XObject redaction, no AES encryption,
no linearisation, no font subsetting) — each is documented
rather than worked around with a second library.

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
loaded at runtime, in this order
(`crates/openpixel-pdf/src/render.rs`, `resolve_pdfium_library`):

1. `OPENPIXEL_PDFIUM_PATH` (a file),
2. `OPENPIXEL_PDFIUM_DIR` (a directory holding the library),
3. next to the current executable (so a release tarball can ship
   `libpdfium.so` beside the `openpixel` binary),
4. the Tauri resource directory (desktop bundle only — see
   "Distribution" below),
5. the system library,
6. `./target/pdfium` (dev cache),
7. the workspace `target/pdfium` (compile-time path, so
   `cargo test` finds it whatever the test binary's CWD is).

Env vars still win over everything else: setting
`OPENPIXEL_PDFIUM_PATH` on a machine with a bundled library makes
the resolver use that file instead.

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

### Distribution (Phase 8 — solved)

**CLI tarball.** `scripts/release/package-cli.sh` fetches the
pinned library (a no-op when `target/pdfium/` is already cached)
and copies it into the tarball **beside the `openpixel` binary**,
so a fresh extraction renders PDFs and extracts text with no
manual fetching and no `target/pdfium` present (resolution step
3). The tarball contents:

```
openpixel-0.1.0-linux-x86_64/
  openpixel          # CLI
  libpdfium.so       # beside the binary
  VERSION.txt        # notes the bundled library + its provenance
  README.md LICENSE docs/... sbom.json native-licenses/
```

CI packages the same tarball in the `cli` job
(`.github/workflows/release.yml`, Linux only) and uploads it as
the `openpixel-cli-tarball-*` artifact alongside the bare binary.

**Desktop bundle.** The Tauri app ships the library as a
`bundle.resources` entry (`apps/desktop/src-tauri/tauri.conf.json`,
`"resources": ["resources/*"]`). Before the build,
`scripts/pdfium/stage-for-tauri.sh` fetches the pinned library
and copies the platform file into
`apps/desktop/src-tauri/resources/` (`libpdfium.so` /
`libpdfium.dylib` / `pdfium.dll` — gitignored, never committed);
CI runs that script before `npm run tauri build` on every OS.
Tauri places resources in the app's resource dir, which on Linux
is **not** beside the binary — the resolver's step 4 covers it:

| Bundle | Binary | Bundled library |
|---|---|---|
| Linux `.deb` | `/usr/bin/openpixel-desktop` | `/usr/lib/openpixel-desktop/libpdfium.so` |
| Linux `.AppImage` | `$APPDIR/usr/bin/openpixel-desktop` | `$APPDIR/usr/lib/openpixel-desktop/libpdfium.so` |
| Windows `.msi` / NSIS | `openpixel-desktop.exe` | beside the exe (the Windows resource dir *is* the exe dir) |
| macOS `.dmg` / `.app` | `Contents/MacOS/OpenPixel` | `Contents/Resources/libpdfium.dylib` |

The desktop backend builds `openpixel-pdf` **with** the `pdfium`
feature (`apps/desktop/src-tauri/Cargo.toml`), so
`pdf_extract_text`, `pdf_to_images` and PDF-input
`pdf_ocr_searchable` work out of the box in the installed app;
`get_desktop_capabilities` reports `pdfium_present: true` when
the bundled library resolves. If the resource is missing anyway
(a build that skipped the staging step), those commands fail
with the honest "needs libpdfium" error — never an empty result.

**Web app.** Never ships it — the browser has no use for a
native binary (see below).

### Verifying a fresh install

Simulate a machine that never had the library: move the dev
cache aside and unset the env vars, then run the installed /
extracted binary — never from the repo root with the cache in
place, or the dev-cache steps (6–7) will mask a missing bundle.

```bash
# CLI tarball (Linux):
mv target/pdfium target/pdfium.hidden   # restore it afterwards!
env -u OPENPIXEL_PDFIUM_PATH -u OPENPIXEL_PDFIUM_DIR \
  /tmp/openpixel-0.1.0-linux-x86_64/openpixel pdf info fixture.pdf
env -u OPENPIXEL_PDFIUM_PATH -u OPENPIXEL_PDFIUM_DIR \
  /tmp/openpixel-0.1.0-linux-x86_64/openpixel pdf render fixture.pdf --out-dir /tmp/render/
env -u OPENPIXEL_PDFIUM_PATH -u OPENPIXEL_PDFIUM_DIR \
  /tmp/openpixel-0.1.0-linux-x86_64/openpixel pdf extract-text fixture.pdf
mv target/pdfium.hidden target/pdfium   # restore!
```

All three must succeed with no manual fetching. The negative
check: remove the bundled library (`rm
/tmp/openpixel-0.1.0-linux-x86_64/libpdfium.so`) and re-run
`pdf render` — it must fail with the `NotImplemented` error
naming libpdfium, exit non-zero, no crash, no silent wrong
result. For the desktop, the same check is `dpkg-deb -c` on the
`.deb` (the library must be at
`usr/lib/openpixel-desktop/libpdfium.so`) plus installing it and
confirming the app launches under Xvfb; the resolver's
resource-dir candidates are unit-tested in
`crates/openpixel-pdf/src/render.rs`
(`tauri_resource_candidates_cover_deb_appimage_and_macos_layouts`).

Honest limits of this phase: the Windows (`.msi`/NSIS) and
macOS (`.dmg`/`.app`) bundles are configured by the same
mechanism but were **not** built or tested here (Linux VM only)
— the resource-dir layout for those platforms comes from the
Tauri 2.12 docs and the resolver's unit tests, not from a real
bundle. The macOS/Windows archive shas are still unrecorded in
`LICENSE_AUDIT.md` (see "Provisioning" above).

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
| Encrypted PDFs | refused — the tab cannot open them; the engine's `pdf_info` reports `Encrypted: yes` + algorithm/permissions, page count unknown | refused by content ops; `pdf info` reports encryption status (Phase 4); `pdf unlock` is the way in |
| PDF compress (screen/ebook/printer) | yes — WASM (`pdf_compress`), same engine, same best-of rule | yes |
| Password protect / unlock / watermark | **no** — passwords and native-only ops stay in the CLI/desktop | yes |
| Text extraction (PDF→TXT/HTML/EPUB/DOCX) | **no** — needs PDFium (native) | yes (needs libpdfium) |
| Office↔PDF conversion | **no** — LibreOffice cannot run in a browser; the PDF tab says so plainly | yes (`openpixel doc convert`) |
| Overlay editor | yes — WASM (`pdf_edit`): text, shapes, highlight, page numbers, header/footer, comment; image overlay via file upload | yes |
| Redaction | yes — WASM (`pdf_redact`): text + rect, real removal | yes |
| Flatten / metadata / repair / sanitise / threat check | yes — WASM (`pdf_flatten`, `pdf_set_metadata`, `pdf_repair`, `pdf_sanitize`, `pdf_inspect`) | yes |
| Digital signatures | **no** — a private key must never be uploaded to a web page; signing and verification stay in the CLI/desktop, with the reason shown in the tab | yes (`pdf sign` / `pdf verify-sign`) |

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

## WASM exports (Phase 5)

Pure lopdf, no signing export (a private key must never enter
the browser):

- `pdf_edit(bytes, ops_json, images)` → `{ data, ops_applied,
  pages_touched, comments_added, warnings }`. Ops JSON: an
  array of `OverlayOp` (`kind`: `text` | `image` | `rect` |
  `line` | `circle` | `highlight` | `draw` | `comment` |
  `page_numbers` | `header_footer`); `images` is a JS array of
  `Uint8Array`, one per image op, in order.
- `pdf_redact(bytes, redactions_json)` → `{ data,
  pages_touched, runs_removed, characters_removed,
  annotations_removed, redacted_texts, warnings }`.
  Redactions JSON: `{"kind":"text","page":null,"text":"…"}` or
  `{"kind":"rect","page":1,"x":72,"y":700,"width":120,"height":30}`.
- `pdf_flatten(bytes)` → `{ data, annotations_flattened,
  annotations_dropped, form_fields_removed, warnings }`.
- `pdf_set_metadata(bytes, metadata_json)` → `Uint8Array`.
  `{"title":"…","author":"","subject":null,"keywords":null}` —
  `""` clears, `null` leaves unchanged.
- `pdf_sanitize(bytes)` → `{ data, javascript_removed,
  embedded_files_removed, launch_actions_removed,
  auto_actions_removed, warnings }`.
- `pdf_repair(bytes)` → `{ data, recovery, warnings }`.
  `recovery` is `"as written"` | `"offset corrected"` |
  `"reconstructed"` | `"recovered"`.
- `pdf_inspect(bytes)` → the `PdfThreats` object: `javascript`,
  `embedded_files`, `launch_actions`, `auto_actions` (arrays of
  what was found — action descriptions / file names, empty when
  absent) and `warnings`. Clean = all four arrays empty (the
  Rust `is_clean()` check; the TS wrapper computes it the same
  way).

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
openpixel pdf edit <input> <output> [--text <text> --page 1 --x 72 --y 700 --size 14 --color #000000 --font helvetica] [--op '<json>' ...] [--image <img> --page 1 --x 72 --y 600] [--page-numbers] [--header <text>] [--footer <text>]
openpixel pdf redact <input> <output> [--text <text> ...] [--rect x,y,w,h --page 1 ...]
openpixel pdf sign <input> <output> --key <key.pem> --cert <cert.pem> [--reason <text>] [--location <text>] [--contact <text>]
openpixel pdf verify-sign <input> [--trust <cert.pem> ...] [--json]
openpixel pdf flatten <input> <output>
openpixel pdf set-metadata <input> <output> [--title <text>] [--author <text>] [--subject <text>] [--keywords <text>]
openpixel pdf repair <input> <output>
openpixel pdf sanitize <input> <output>
openpixel pdf inspect <input> [--json]
openpixel doc convert <input> --to <pdf|docx|xlsx|...> [-o <out>] [--timeout-secs 120]
openpixel doc formats [--json]
```

`edit --op` takes a JSON overlay op (`{"kind":"text","page":1,
"x":72,"y":700,"text":"DRAFT","size":14,"color":{"r":0,"g":0,"b":0},
"font":"helvetica"}` — `kind` is `text` | `image` | `rect` |
`line` | `circle` | `highlight` | `draw` | `comment` |
`page_numbers` | `header_footer`; see `docs/API.md`). `--image`
embeds the file at `--x/--y` (default 72/600, 200×150 pt);
`--text`/`--page-numbers`/`--header`/`--footer` are shortcuts
for the common ops. `redact --text` searches all pages unless
`--page` is given; `--rect x,y,w,h` needs `--page`. `sign`
needs a PEM private key + certificate (see the Phase 5 section
above for how to make one with `openssl`). `set-metadata`
clears a field with an empty string (`--author ""`).

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
- Web e2e `apps/web/e2e/pdf-e2e.mjs` (23 checks): upload a real
  PDF, info shown (page count is just the number — the
  "Pages | Pages: 4" duplication is fixed), merge/split works,
  PDF→PNG is a genuine image at the requested dimensions,
  compress downloads a real PDF no bigger than the input,
  **Phase 5**: add-text overlay (extractable, original kept),
  page numbers ("Page 1 of 2" in the text layer), redact by text
  (byte-proof: `SECRET-123` absent from the file bytes and the
  text layer, `PUBLIC line` survives), metadata (new title),
  threat check (clean), sanitize (clean input, nothing removed),
  flatten and repair (real PDFs, "as written").
- `cargo test -p openpixel-pdf --features sign,pdfium` (Phase 5):
  editor (text/shapes/page-numbers/header-footer/image/comment,
  bad-input rejections), redaction (rect + text-search, partial
  overlap, byte-proof, shared-stream guard), signatures
  (sign→verify round-trip, tamper detection, PKCS#1 key,
  garbage CMS, untrusted without an anchor), sanitisation
  (JS/embedded file/launch removed, byte-proof, idempotent,
  orphan-object sweep), repair (broken xref reconstructed,
  healthy file "as written"), ZIP-bomb (300 MiB of zeros in a
  Flate stream is refused by the decompression limit).
- CLI e2e `scripts/test/cli-e2e.sh` **§13 (Phase 5)**: edit on a
  real 2-page text PDF (overlay visible when rendered, text
  extractable), redact `--text` + `--rect` (byte-proof),
  sign→verify round-trip on a real openssl certificate
  (valid+trusted with the anchor, valid+untrusted without,
  invalid after one tampered byte), flatten (a comment without
  an appearance is honestly dropped, not flattened),
  set-metadata (title set, author cleared), repair (healthy "as
  written", broken xref reconstructed), inspect + sanitize on a
  malicious fixture (JS + embedded file + Launch: all gone from
  the bytes, file still opens), error cases (no ops, bad JSON,
  bad key, no metadata fields → exit 1).
