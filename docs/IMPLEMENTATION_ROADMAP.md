# Implementation Roadmap — OpenPixel Studio

**Date:** 16 November 2026
**Basis:** `docs/EXISTING_PROJECT_AUDIT.md`,
`docs/MIGRATION_PLAN.md` (repo HEAD `ba9cc1e`).
**Status:** Draft for joint planning with Raju. No phase starts
before its entry criteria are met and Raju approves the phase.
Each phase ends with tests, a build, a verification of existing
image features, documentation, and a report — per the prompt §18.

**Baselines at the start of this roadmap (16 Nov 2026, verified):**
Rust `cargo test --workspace` 205 passed; web `npm test` 49/49;
lint 0 warnings; web e2e 36/37 (one known keyboard flake);
no-WASM 9/9; resize e2e 16/16; live matrix 57/57;
CLI e2e exit 0; desktop backend 16/16; desktop npm 11.
Every phase below must keep these green (or improve them) —
a phase that regresses the image engine is not done.

---

## Phase 0 — Existing Project Audit

**Entry:** repo at `ba9cc1e`; read-only access; no code changes.
**Work:** inspect the workspace, crates, apps, docs, CI, SBOM;
verify candidate-library versions + licences; write the audit,
migration plan, and this roadmap.
**Exit criteria:**
- `docs/EXISTING_PROJECT_AUDIT.md`, `docs/MIGRATION_PLAN.md`,
  `docs/IMPLEMENTATION_ROADMAP.md` written and reviewed with Raju.
- Zero source files modified; docs left uncommitted for review.
- Open decisions (§7) listed, not decided unilaterally.
**Honest unknowns:** none in the audit itself — it describes what
exists. The unknowns live in the later phases.

## Phase 1 — Unified Core Architecture

**Entry:** Phase 0 reviewed; PDF library decision made (§7);
Raju approves starting.
**Work:**
- `ProcessingEngine` trait in `openpixel-core`
  (`validate/inspect/process/optimize/export/health_check`);
  image `Engine` implements it.
- Promote `openpixel-security`: temp-workspace isolation +
  auto-cleanup, processing timeouts, RSS cap (closes accepted
  risks A8/A9), PDF sanitisation rules (no JS execution).
- Promote `openpixel-api`: shared `/api/v1` types only (no server).
- Generalise `openpixel-jobs` to a job trait (image behaviour
  byte-identical).
- `openpixel-pdf` foundation: crate skeleton, `DocumentFormat`
  detection (PDF/Office/EPUB/RTF/TXT signatures), lopdf wired,
  merge + split smoke test on real files.
- Licence Registry started (`LICENSE_AUDIT.md`); CI gains a
  wasm32 build check + `cargo deny` (or equivalent).
**Exit criteria:**
- `cargo test --workspace` green (205 + new crate tests);
  web `npm test` green; lint/clippy/fmt clean; CLI e2e exit 0;
  wasm32 build green.
- Merge + split of a real multi-page PDF works via the new
  crate (test, not a demo).
- Licence Registry has a row for lopdf (+ PDFium if adopted).
**Done 16 Nov 2026 — all exit criteria met:**
- `cargo test --workspace` **245 passed, 0 failed** (205 + 40:
  pdf 12 + 4 integration, security 12, api 3, core +13, jobs
  +3); web `npm test` 49/49, lint 0; clippy `-D warnings`
  clean; `cargo fmt --check` clean; CLI e2e exit 0 (fixtures
  regenerated after a /tmp wipe — the script does not generate
  them itself); `cargo deny check licenses` ok; wasm32 checks
  green for `openpixel-wasm` **and** `openpixel-pdf`.
- Merge (3+2 → 5 pages, text verified in output) and split
  (ranges, single pages, re-merge) work on real lopdf-generated
  PDFs, cross-checked with `pdfinfo`.
- `LICENSE_AUDIT.md` has rows for lopdf (MIT, `=0.47.0`) and
  PDFium (BSD-3-Clause, chromium/8152, sha256 on record).
- **PDFium prototype: WORKED.** The example rendered a real
  3-page PDF to three genuine PNGs (200×259 px, text visible).
  Two environment findings: the GitHub *API* is rate-limited
  for unauthenticated calls from the shared egress IP, so the
  prototype resolves the latest release via the
  `/releases/latest` HTML redirect; `tar` needs
  `--no-same-owner` in this container. PDFium is adopted for
  Phase 2 rendering (dynamic `libpdfium.so`, never committed).
- **Design decisions taken during implementation** (kept here
  so they are not re-derived): timeout enforced in the jobs
  pool, not in `Engine` methods (`&self` cannot move into a
  `'static` worker thread; `CodecRegistry` is not Clone);
  worker threads are detached on timeout, never killed;
  `openpixel-pdf` takes `openpixel-core` with
  `default-features = false` and `getrandom` with `wasm_js`
  so it builds for wasm32.
**Honest unknowns:** whether lopdf covers the page ops cleanly
on real-world PDFs (malformed files, object streams, encryption);
whether the `openpixel-jobs` generalisation stays small or
needs a redesign (prototype first, decide on evidence).
**Answers after Phase 1:** lopdf's `Document` API has no
built-in merge — the page-graph copier works on generated
PDFs, but real-world files (object streams, encryption,
annotations) are untested until Phase 2 fixtures arrive; the
jobs generalisation stayed additive and small (byte-identical
batch behaviour verified by CLI e2e §6).

## Phase 2 — Core PDF Features (first user-facing PDF)

**Entry:** Phase 1 exit green; PDFium-vs-lopdf rendering
decision made (prototype evidence from Phase 1).
**Work:** merge, split, rotate, extract/remove/reorder/
duplicate/insert/replace/reverse pages, booklet, N-up;
PDF info; PDF→PNG/JPG (PDFium render → pipeline → encode);
image→PDF (lopdf + pipeline); CLI `pdf` subcommand; web PDF
tab (pdf.js render; lopdf-WASM page ops where possible).
**Exit criteria:**
- CLI e2e gains a PDF section (merge/split/rotate/render
  on real fixtures, outputs re-verified with `pdfinfo`-style
  checks + image detection).
- Web PDF e2e green; live-site check on openpixel.pages.dev.
- PDF→image output is a genuine image at the requested
  dimensions (same verification discipline as the image
  matrix: `file` + `openpixel info`).
**Honest unknowns:** rendering quality/speed of PDFium on
complex pages; how many real-world PDFs lopdf refuses
(encrypted, malformed) and how those failures are reported;
PDF/A is out of scope here.
**Status: DONE 16 Nov 2026** (commit on `main`; see `docs/PDF.md`
for the full record). CLI e2e §10 green (every op re-verified
with `pdfinfo`, renders re-verified with `file` + `openpixel
info`); web PDF e2e 14/14 green (§2.20); `cargo test
--workspace` 260 passed; web `npm test` 62/62; clippy + fmt
clean; `cargo deny check licenses` green (ISC added for
libloading — see `deny.toml`).
**Answers after Phase 2:** PDFium renders generated text pages
and image pages at exact requested dimensions with visible text;
complex real-world pages are still untested. Encrypted PDFs fail
cleanly (`Encrypted`, no password support); malformed PDFs fail
cleanly with the lopdf message. Real-world files with object
streams/annotations were NOT exercised — only lopdf-generated
and image-based PDFs — so "how many real-world PDFs lopdf
refuses" stays partly open for Phase 3 fixtures. The Phase 1
copier bug (split/extract outputs containing excluded pages'
content as orphans, via `/Parent`) was found by a Phase 2 test
and fixed with a regression test. PDFium threading is a
single-worker design (one binding per process, upstream
constraint — see `docs/PDF.md`). PDF/A remains out of scope.

## Phase 3 — Conversion and Compression — DONE 16 Nov 2026

**Entry:** Phase 2 exit green; Office scope decision made (§7).
**Work:** PDF compression (Extreme / Recommended / Low —
original size, output size, saved size, percentage; never claim
smaller when larger); Office→PDF and PDF→Office via
LibreOffice headless (**desktop/server only** — the browser
shows an honest "needs desktop/server" state); PDF→Word/Excel
via the same adapter; font-substitution + error reporting.
**Exit criteria:**
- Compression benchmarks on real PDFs (size + quality notes);
  a compression that grows the file is reported as larger.
- Office round-trip fixtures green (DOCX/XLSX/PPTX → PDF);
  fidelity limits documented, not hidden.
- Browser honestly refuses Office conversion with a clear
  message (no fake UI).
**Honest unknowns:** LibreOffice fidelity on complex documents
(tables, fonts, tracked changes); conversion time on large
files (timeout policy from Phase 1 will be tested here);
LibreOffice's ~286 MB install size and its effect on the
desktop installer.

**Done 16 Nov 2026 — what actually shipped (parent brief is
authoritative where it differs from the plan above):**
- Compression modes are **screen / ebook / printer** (72/150/300
  DPI, JPEG q50/75/90), not Extreme/Recommended/Low — per the
  parent brief. Measured on a real photo PDF (1,687,939 B):
  screen → 70,306 B (95.8%), ebook → 120,063 B (92.9%),
  printer → 260,116 B (84.6%). A compression that would grow
  the file returns the original with a note (best-of rule).
- Password protect/unlock + watermark landed in **Phase 3**,
  not Phase 5 (parent brief scope): RC4-128 only — AES is not
  claimed (lopdf V4/V5 not wired up).
- **PDF→Excel is NOT supported** — the plan's "PDF→Word/Excel
  via the same adapter" was wrong for Excel: LibreOffice has no
  PDF→XLSX (or PDF→PPTX/ODT/RTF) export filter. PDF→TXT/EPUB/
  DOCX go via PDFium text extraction instead (text only, honest
  about layout limits). The engine refuses the unsupported pairs
  and names the alternatives.
- LibreOffice was already installed in this VM (24.2.7.2) — no
  apt install was needed. Fresh-profile-per-conversion rule
  (a shared profile produced a spurious failure); output-file
  existence is verified (exit code 0 is never trusted).
- Linearisation is NOT offered: lopdf 0.47's
  `SaveOptions.linearize` is never read by its writer (verified
  in the lopdf source) — offering it would be fake.
- Tests: `cargo test --workspace` green (see commit message for
  counts), web 64/64, CLI e2e §11, pdf-e2e 15/15.
  Full details: `docs/PDF.md` (Compression, Security, Text
  extraction, Document conversion sections).

## Phase 4 — OCR and Extraction — DONE 17 Nov 2026

**Entry:** Phase 2 exit green (OCR needs PDF page images);
Tesseract system-dependency plan for CI approved.
**Work:** English + Bengali OCR (Tesseract native, tesseract.js
web); image→text, scanned PDF→text, searchable PDF,
OCR→Word/Excel; preprocessing ops in the pipeline
(deskew/denoise/threshold); table/layout hooks;
Bengali + English benchmark dataset; confidence + bounding
boxes on every result.
**Exit criteria:**
- Benchmark dataset exists with honest accuracy numbers
  (per language, per document type) — never 100%.
- Searchable PDF is genuinely searchable (text layer verified).
- CI installs tesseract + leptonica on all three OSes.
**Honest unknowns:** Bengali conjunct accuracy on real scans;
table recognition quality (PaddleOCR may be needed later —
deferred, not promised); handwriting recognition is
"where supported" only.

**Done 17 Nov 2026 — what actually shipped:**
- **Native engine:** new crate `openpixel-ocr`, Tesseract 5.3.4
  via `tesseract-sys =0.6.3` behind the `native-ocr` feature
  (off by default, same pattern as `pdfium`). `OcrEngine`
  trait so a second engine can plug in later; Tesseract is
  the only implementation. PaddleOCR NOT in this phase
  (deferred per Raju's decision).
- **Preprocessing:** pipeline ops `Threshold` / `Denoise`
  (3×3 median) / `Deskew` (projection-profile, 0.25° steps);
  OCR modes none/light (default)/full. Also exposed as
  `openpixel process --op threshold:128 | denoise | deskew[:5]`.
- **Searchable PDF:** Tesseract's own PDF renderer (image +
  text layer with a proper ToUnicode map) — `pdftotext` finds
  the text, including Bengali. It OCRs the image as given (no
  preprocessing on that path — the renderer embeds the image
  it OCRs).
- **CLI:** `openpixel ocr` (txt/html/json) and `openpixel pdf
  ocr` (image or scanned PDF → searchable PDF, PDFium render
  first at `--scale`, default 3.0 = 216 DPI).
- **Web:** OCR tab with tesseract.js 7.0.0, fully self-hosted
  (worker + core + eng/ben traineddata from tessdata_fast,
  loaded on demand, no CDN at runtime); dist 11 → 20 MB,
  initial bundle +15 KB. ocr-e2e 14/14.
- **Accuracy (measured, tessdata_fast, Tesseract 5.3.4):**
  eng-clean CER 0.000, ben-clean CER 0.130 (Light) — conjunct
  words (স্টুডিও, জবাবদিহিতা) are the failure mode; deskew
  recovers +3° skew exactly (0.349 → 0.000). Full table:
  docs/OCR.md. Never 100% — the numbers are in the docs.
- **Encrypted `pdf info` fix** (Phase 3 follow-up): inspect
  reports `Encrypted: yes` + algorithm/revision/permissions
  from the `/Encrypt` dict without a password; page count is
  unknown (0 in JSON), not zero — lopdf loads no objects for
  an encrypted document waiting for its password.
- **Not done:** OCR→Word/Excel (the plan's item) — no
  converter was built; the OCR result types (words with
  bounding boxes) are the hook for it, but it is not a
  feature yet. Table/layout recognition also not done —
  words carry bounding boxes, no table detection. Handwriting
  is out of scope (printed text only), per the parent brief.
- **CI:** Linux apt installs tesseract + dev headers +
  eng/ben; macOS brew; Windows vcpkg (choco's tesseract was
  verified unusable for building — runtime DLLs only, no
  headers, no traineddata). The Windows CI path is validated
  by the CI run, not locally.
- **Provisioning gap (honest):** this VM cannot install
  `libtesseract-dev`/`libleptonica-dev` via apt (libzstd-dev
  conflict with the hatch-patched libzstd1) — headers were
  extracted from the -dev .debs into `/usr/local` with
  symlinks + pkg-config files; the VM reset wipes all of it.
  The CLI binary links libtesseract dynamically — same class
  of distribution gap as libpdfium (Phase 8 packaging).
- Tests: `cargo test --workspace` green (see commit message
  for counts), web 76/76, CLI e2e §12, ocr-e2e 14/14,
  pdf-e2e 15/15. Full details: `docs/OCR.md`.

## Phase 5 — Advanced Editing and Security — DONE 17 Nov 2026

**Entry:** Phase 2 exit green.
**Work:** PDF editor — overlay content (text/images/shapes/
highlight/draw/comments/watermark/page numbers/header-footer)
**distinguished in the UI** from editing existing text objects;
password protect/unlock (legally authorised, password
supplied); digital signatures + verification; redaction
(**real content removal, not black overlays**); flatten;
metadata editing; repair; sanitisation; embedded-file and
JavaScript inspection.
**Exit criteria:**
- Security tests green: malicious PDFs (JS, embedded files,
  malformed objects, ZIP bombs) handled without execution.
- Redaction verified: redacted text is absent from the file
  bytes, not merely covered.
- Signature verification tested with real certificates.
**Honest unknowns:** how far lopdf reaches for editing vs
where qpdf becomes necessary (defer the qpdf decision to
evidence from this phase); certificate-based signing UX.

**Done 17 Nov 2026 — what actually shipped:**
- **Overlay editor** (`crates/openpixel-pdf/src/edit.rs`):
  text, images, rect/line/circle, highlight, freehand draw,
  comments (`/Text` annotations), page numbers, header/footer.
  One content stream appended per touched page (overlays draw
  on top); shared font objects + one ExtGState per opacity.
  The UI and CLI state plainly that overlays are NEW content —
  existing text is never edited in place (lopdf cannot do that
  reliably). Non-ASCII text becomes `?` (WinAnsi, same rule as
  the Phase 3 watermark). Text watermark from Phase 3 reused
  (not duplicated).
- **Digital signatures** (`sign.rs`, feature `sign`, CLI/desktop
  only): real CMS/PKCS#7 detached signatures (SHA-256, RSA
  only) via the pure-Rust `cms` + `rsa` + `x509-cert` crates —
  no new licence (all MIT OR Apache-2.0, see
  `LICENSE_AUDIT.md`). Two-pass placeholder (8192-byte
  `/Contents`, then exactly-sized — no zero padding left).
  `verify_signatures` checks the digest over the ByteRange,
  the CMS signature over the signed attributes, the signing
  time against the cert validity, and self-signed certs;
  reports `valid` (crypto OK) vs `trusted` (signer IS an
  anchor or an anchor issued it) honestly. No CRL/OCSP, no
  TSA, ECDSA reported unsupported. Test certs are generated
  with `rcgen` (dev-dep only) + an `rsa`-generated key;
  the CLI e2e uses a real openssl self-signed certificate.
- **Redaction** (`redact.rs`): REAL content removal — the text
  is deleted from the content stream (old streams replaced +
  deleted when uniquely referenced), a black cover rect is
  drawn over the area, intersecting annotations are removed,
  and a self-check fails loudly if the rebuilt ops are not
  exactly the original minus the removed characters.
  Byte-proof in the CLI e2e (§13b) and the pdf-e2e (§2.20.14):
  `grep` finds no trace of the secret in the output bytes or
  the text layer. Limits (documented): Form XObject text is
  not reached (cover still hides it visually), vector-outline
  text has no text to remove, positions are estimated, search
  is within one run, `/Info` is not redacted (use
  `set-metadata`).
- **Flatten** (`edit.rs`): appearance streams inlined into
  page content (rect/bbox/matrix transform, resource merge
  with rename-on-collision); `/AcroForm` + field dicts
  removed. An annotation WITHOUT an appearance stream is
  counted as dropped with a warning — never faked as
  flattened (the CLI e2e asserts "0 flattened, 1 dropped"
  for a plain comment).
- **Metadata / repair / sanitisation / inspection**
  (`edit.rs`, `sanitize.rs`): `set_metadata` (empty string
  clears, omitted leaves unchanged); `repair` (lenient load +
  fresh save, reports `as written` / `offset corrected` /
  `reconstructed`); `sanitize` (removes JS/launch/auto-actions,
  embedded files, XFA, sweeps orphan references, re-inspects
  the output and fails loudly if anything dangerous survives);
  `inspect_threats` (structural, never executes anything).
  ZIP-bomb test: 300 MiB of zeros in a Flate stream is refused
  by the decompression limit (`decompressed_content()` itself
  is unbounded — never call it on untrusted input).
- **CLI:** `pdf edit` / `redact` / `sign` / `verify-sign` /
  `flatten` / `set-metadata` / `repair` / `sanitize` /
  `inspect` (clap derive, `--json` where sensible, honest
  errors, exit 1).
- **Web:** Edit card in the PDF tab (overlay ops + redaction
  via WASM `pdf_edit` / `pdf_redact` / `pdf_flatten` /
  `pdf_set_metadata` / `pdf_repair` / `pdf_sanitize` /
  `pdf_inspect`; WASM rebuilt to 8.37 MB). Signatures stay
  CLI/desktop-only with an honest reason (a private key must
  never be uploaded). pdf-e2e 24/24 (8 new Edit checks).
- **lopdf vs qpdf — resolved with evidence:** every exit
  criterion passed on lopdf 0.47.0; no lopdf wall was hit, so
  **qpdf was not added**. The known lopdf gaps (no in-place
  text editing, no Form XObject redaction, no AES, no
  linearisation, no font subsetting) are documented in
  `docs/PDF.md` rather than worked around with a second
  library.
- **Not done:** OCR→Word/Excel is still not built (Phase 4
  item, unchanged). Interactive form filling is not a feature
  (flatten only).
- **Environment note:** the VM was reset mid-phase — the
  Tesseract provisioning (`/usr/local` headers + pkg-config +
  `.so` symlinks), the libarchive/libcurl dev symlinks and
  python-pptx were wiped. Re-provisioned per `docs/OCR.md`
  (now also recording the libarchive/libcurl symlinks, which
  rust-lld needs in `/usr/lib/x86_64-linux-gnu`, not just
  `/usr/local/lib`) and the fixtures regenerated before the
  final runs.
- Tests: `cargo test --workspace` **336/336** (pdf crate
  `--features sign,pdfium` 66 lib + 4 integration), web
  **79/79**, lint 0, clippy `-D warnings` clean, fmt clean,
  `cargo deny check licenses` green, wasm32 green, CLI e2e
  exit 0 (§13), pdf-e2e 24/24, web e2e 36/37 (known keyboard
  flake only), resize e2e 16/16, ocr-e2e 14/14, no-WASM 9/9.
  Full details: `docs/PDF.md`, `docs/E2E.md` (§1.18, §2.20).

## Phase 6 — Unified Frontend — DONE 17 Nov 2026

**Entry:** Phases 2–4 exit green (there must be real tools to
unify); desktop Tailwind decision made (§7).
**Work:** one Studio site — homepage (hero, tool search,
popular tools, categories, batch, privacy section),
All Tools directory, reusable processing workspace,
Image + PDF + Document + OCR tabs, local/server mode
selection (no silent uploads — always show where processing
happens), Recent Files, Settings. Desktop frontend migrated
to the shared MUI theme if decision (a) was taken.
**Built (commits `0c044ff` steps 1–2, `7d38f6f` steps 3–9, plus
the logo-centering fix):** prompt tokens in `theme.ts` (Inter +
Noto Sans Bengali via @fontsource); AppShell (header + 248px
collapsible sidebar / mobile drawer, global search, breadcrumbs,
footer); homepage with sniff-and-route upload; All Tools with
search/filter/sort and an honest web / CLI-only / coming-soon
inventory; ToolPageHeader + EditorShell shared patterns;
workspace dashboard + My Files + Recent Files from a local
activity store (names/sizes only, never contents, honest empty
states); PDF editor as a 3-panel layout with real pdf.js
thumbnails; Settings gains Language (EN/BN prep), Privacy
(activity toggle + clear) and Storage (history size, WASM
status). No auth pages (no backend). Desktop migration stays
Phase 7.
**Exit criteria — verified 17 Nov 2026:**
- Web e2e covers every tool tab; live-site matrix re-run
  (image matrix + new PDF matrix).
  - cargo test --workspace: **336/336**; web npm test **79/79**;
    lint **0 warnings, 0 errors**; CLI e2e exit 0, **0 FAILs**.
  - web-e2e **36/37** (only the known keyboard-focus
    environmental flake), resize-e2e **16/16**, pdf-e2e **24/24**,
    ocr-e2e **14/14**, no-WASM **9/9**, viewport QA **15/15**
    (360×800 / 768×1024 / 1440×900, no horizontal overflow).
  - Live matrix on openpixel.pages.dev: **57/57**, zero console
    errors; live home screenshot confirms the new shell deployed.
- No tool is UI-only: every button maps to a real engine call
  (CLI-only tools show the exact verified command; unbuilt tools
  are labelled Coming Soon and are not clickable).
- Existing Convert/Resize/Batch flows unchanged (selectors green).
**Honest unknowns (resolved):** Recent Files storage decision —
localStorage (`openpixel.activity.v1`, max 200 entries), not
IndexedDB; the homepage/tool directory work was design work, as
scoped.

## Phase 7 — Desktop and Mobile

**Entry:** Phase 6 exit green; all engines stable.
**Work:** Tauri integration of PDF/OCR/document engines
(same commands pattern as today); Android/iOS via Tauri
Mobile (shared Rust engine); native Kotlin/Swift only if
Tauri Mobile proves insufficient; offline processing;
per-platform capability checks (the matrix from the audit §8,
extended).
**Exit criteria:**
- Desktop installers build on Linux/Windows/macOS in CI.
- Mobile build validation passes (at least one platform).
- Desktop click-through (1)–(8) finally run, plus new
  PDF/OCR click-throughs (or the gap is accepted explicitly).
**Honest unknowns:** Tauri Mobile maturity for this workload;
camera/file-picker/share-sheet behaviour per OS; whether
mobile OCR/PDF performance is acceptable on device.

## Phase 8 — Production

**Entry:** Phases 6–7 exit green.
**Work:** security audit over the new engines; load +
performance benchmarks (large PDFs, batch OCR, concurrent
jobs, memory); cross-platform QA; Docker deployment for the
**optional** backend (FastAPI + PostgreSQL + Valkey +
S3-compatible storage; workers run the same Rust engines);
monitoring; docs; release automation (GitHub Release for
permanent download links, if decided).
**Exit criteria:**
- Security audit clean or with documented accepted risks
  (same discipline as Phase 9).
- Benchmarks published in `docs/BENCHMARKS.md`.
- Local-only mode still works with no account and no database.
- Release checklist green.
**Honest unknowns:** backend load characteristics (no
production traffic data yet); whether the backend stays
optional-only or grows an account system (Raju decision,
not in this roadmap).

---

## 7. Open decisions for Raju (before Phase 1)

1. **Frontend stack — desktop:** (a) migrate desktop to MUI
   (recommended, one design system) or (b) keep desktop on
   Tailwind. The web app stays MUI either way; the prompt's
   "Tailwind" is recorded as superseded.
2. **PDF library:** lopdf + PDFium as proposed, or lopdf-only
   first with PDFium added in Phase 2 on evidence. (qpdf stays
   deferred.)
3. **Office scope:** full Office↔PDF both ways in Phase 3,
   or Office→PDF only first.
4. **Backend/mobile timing:** confirm both stay last
   (Phases 7–8), and confirm the backend stays optional.
5. **CI/releases:** keep 30-day CI artefact retention, or
   create a GitHub Release for permanent download links.
6. **OCR ambition:** Tesseract first (proposed), or invest in
   PaddleOCR from the start for better tables/handwriting.

**Decided by Raju, 16 Nov 2026 ~21:12:** (1) desktop → MUI;
(2) PDF library → lopdf + PDFium, both; (3) Office scope →
both directions in Phase 3; (4) backend/mobile stay last,
backend optional; (5) CI/releases → not decided, keep 30-day
retention for now; (6) OCR → architect's call: **Tesseract
first**, PaddleOCR deferred.

## 8. How progress is reported

At the end of every phase: tests run, build run, existing image
features verified, new functionality verified, documentation
updated, and a report to Raju covering completed features,
remaining work, and known limitations. A feature is complete
only when implementation, tests, error handling, and
documentation exist — compiling is not completion.
