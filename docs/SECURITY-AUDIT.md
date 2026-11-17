# Security Audit — OpenPixel Engine (Phases 8–9)

Audit date: 16 Nov 2026. Auditor: Phase 9 subagent (code review of
every crate + CLI + web worker + Tauri commands, plus the new
cargo-fuzz targets — see `crates/openpixel-codecs/fuzz/`).
Scope: untrusted-input handling end to end. No findings here are
invented: each one names the file and the code that was read. The
baseline this audit builds on is `docs/SECURITY.md` (Phases 1–8);
items already recorded there are not repeated unless the audit
changed their status.

Severity scale: **High** — a crafted file can crash / OOM the
process or write outside the intended output; **Medium** — a crafted
file can exhaust memory/time well beyond the documented limits, or
bypass a documented limit; **Low** — defence-in-depth / local-trust
notes; **Accepted risk** — known, documented, not fixed in this
phase.

Phase 8 additions (18 Nov 2026, findings B1–B16) are in the
section directly below; the Phase 9 audit follows after them.

## Phase 8 audit (18 Nov 2026) — the new engines

Auditor: Phase 8 security-audit subagent. Scope: the engines that
landed since Phase 9 — `openpixel-pdf` (lopdf 0.47.0 parsing, PDFium
rendering, text extraction, redaction, signatures, sanitisation),
`openpixel-ocr` (Tesseract via tesseract-sys, searchable-PDF
generation), `openpixel-documents` (LibreOffice headless adapter),
the new `openpixel-wasm` exports (incl. `pdf_*`), and the 20 new
Tauri commands in `apps/desktop/src-tauri/src/pdf_commands.rs`
(reviewed; not modified — that tree belongs to another agent, see
B7b). Fixes commit: `cfc4a8d` ("Phase 8 security audit: fix
B1-B16 in the new PDF/OCR/documents/WASM/CLI surfaces").

Library facts the fixes rely on (lopdf 0.47.0, read from its
registry source): `Stream::decompressed_content()` is documented
unbounded; `decompressed_content_with_limit(n)` caps via
`take(limit+1)` per filter layer; `DEFAULT_MAX_DECOMPRESSED_SIZE`
is 256 MiB per stream at load. `Document::get_and_decode_page_content`
is unbounded; `get_page_content_with_limit` bounds the
concatenated total. Core limits:
`openpixel_core::security::MAX_FILE_SIZE_BYTES` = 100 MiB,
`MAX_PIXELS` = 100_000_000, `MAX_DIMENSION` = 16 384.

### B1 — High — Unbounded FlateDecode image decompression in compress

**Where:** `crates/openpixel-pdf/src/compress.rs` —
`recompress_one`, Flate branch. It called unbounded
`decompressed_content()` and only checked the length afterwards.

**Impact:** a small image stream expanding to hundreds of MiB
would be fully decompressed first — the same decompression-bomb
class as A1, on the PDF image path.

**Fix:** validate `w`/`h` against `MAX_DIMENSION`/`MAX_PIXELS`
first (u64 checked math), then
`decompressed_content_with_limit(expected)` where `expected =
w*h*channels`. Tests:
`compress::tests::flate_image_bomb_is_capped_not_decompressed`
(1x1 RGB image, 300 MiB zero bomb: skipped == 1,
recompressed == 0, output still valid) and
`flate_image_with_lying_dimensions_is_refused_before_decode`
(100 000 x 100 000 declared, 3-byte stream — refused before
any decode).

### B2 — High — Unbounded appearance-stream decompression in flatten

**Where:** `crates/openpixel-pdf/src/edit.rs` —
`flatten_annotation`.

**Fix:** `decompressed_content_with_limit
(MAX_APPEARANCE_DECOMPRESSED)` with new `pub(crate) const
MAX_APPEARANCE_DECOMPRESSED: usize = 16 * 1024 * 1024`
(appearance content is operators only; images are separate
XObjects, so 16 MiB is generous).

### B3 — High — Unbounded page-content decode via `decode_ops`

**Where:** `crates/openpixel-pdf/src/edit.rs` — `decode_ops`
used lopdf's unbounded `get_and_decode_page_content`.

**Fix:** `decode_ops` now takes `max_decompressed: usize` and
uses `doc.get_page_content_with_limit(page_id, max)` +
`Content::decode` instead. Call sites:
`crates/openpixel-pdf/src/redact.rs:304, 342` (pass
`self.config().max_file_size_bytes as usize`).

### B4 — High — Signature `/ByteRange` did not prove the file unchanged

**Where:** `crates/openpixel-pdf/src/sign.rs` —
`verify_one_signature`. The old check only required each range
to end inside the file, so a ByteRange excluding most of the
file still "verified" — the digest covered only the declared
ranges, and the rest of the file could be anything.

**Fix:** strict checked-arithmetic coverage — `off1 == 0`,
`off1+len1 <= off2`, `off2+len2 == file.len()`, and the gap
equals `/Contents` as written (hex: `2*len+2`, literal:
`len+2`). Known limitation: a literal-string `/Contents` with
escaped characters has a larger gap and will be reported
invalid — fail-closed; hex is what all known writers use.
Side effect: `signed_data` capacity is now bounded by file
length (was up to 2x file length).
Test: `sign::tests::verify_rejects_bytes_appended_after_signing`
(append `% trailing garbage…` to a validly signed PDF; old code
reported valid, new code invalid with a ByteRange warning).

### B5 — Medium — Cyclic `/Kids` infinite loop in signature collection

**Where:** `crates/openpixel-pdf/src/sign.rs` —
`collect_sig_dicts` had no visited set (unlike
`collect_field_ids` in `edit.rs`, which is cycle-safe).

**Fix:** `seen: HashSet<ObjectId>`; already-visited ids are
skipped. Test:
`sign::tests::verify_terminates_on_cyclic_acroform_fields`
(a field listing itself in `/Kids`, no `/V`; verify returns
with zero signatures).

### B6 — Medium — Sanitisation gaps (three, one file)

**Where:** `crates/openpixel-pdf/src/sanitize.rs`.

- **Inline AcroForm `/XFA` was missed by both detection and
  removal** (only the indirect/reference form was handled), so
  the post-check passed on a file that was not clean. Fix: new
  `catalog_subdict(doc, key)` helper resolving indirect or
  inline dicts, and `remove_xfa(doc)` handling both forms;
  `detect_threats` now uses it for `/Names` and `/AcroForm`.
- **`/OpenAction`: the old code flagged EVERY open action**, so
  sanitising a doc with a benign GoTo open action failed its own
  post-check. Fix: new `is_dangerous_open_action` (JavaScript,
  Launch, URI, GoToR, SubmitForm, ImportData); detection and
  removal now agree on that set. Plain GoTo / Named /
  SetOCGState are neither flagged nor removed. Per-object URI /
  SubmitForm actions are deliberately NOT removed (links/buttons
  only run on click).
- **Orphaned `/AA` dicts:** dropping the `/AA` key left the
  indirect dict object in the output bytes. Fix: when stripping
  `/AA` (catalog and per-object surviving dicts), the referenced
  dict id is added to the `delete` set.

Tests: `sanitize_removes_inline_acroform_xfa`,
`sanitize_keeps_benign_goto_open_action`,
`sanitize_removes_uri_open_action`,
`sanitize_deletes_indirect_aa_dicts_not_just_the_key`. The stale
comment in the zip-bomb test (which claimed unbounded
`decompressed_content()` was never called on engine paths) was
corrected — it is now true after B1/B2/B3.

### B7 — Medium — CLI reads files unbounded before engine validation

**Where:** `apps/cli/src/main.rs` — `read_pdf_bytes` did
`fs::read(path)` with no size check. Same class as Phase 9 A4,
which fixed only batch collection; single files were still read
whole before the engine's 100 MiB limit ever applied.

**Fix:** new `check_input_size` helper (metadata length vs
`MAX_FILE_SIZE_BYTES`) called before the read in
`read_pdf_bytes` (all PDF/doc/OCR-from-images paths), the
`discover` command, the `sign` key/cert PEM reads, and the
`verify-sign` trust-anchor reads. The engine re-validates the
bytes after the read, so a file that grows between the check
and the read is still refused.

**B7b — NOT FIXED, coordinator action:** Tauri `read_bytes`
(`apps/desktop/src-tauri/src/pdf_commands.rs:181-183`) has the
identical flaw, but the desktop tree is owned by another Phase 8
agent. Add the same metadata pre-check there.

### B8 — Medium — Render allocated in PDFium before the dimension check

**Where:** `crates/openpixel-pdf/src/render.rs` —
`render_to_images` rendered all pages, then checked
dimensions.

**Fix:** pre-check from `inspect` page sizes x scale (ceil)
against `MAX_DIMENSION` and `MAX_PIXELS` before calling
`render_to_images_inner`; the post-render check is kept as
defence in depth. `page_count` call replaced with `inspect`
(single parse). Test:
`render::tests::oversized_pages_are_refused_before_rendering`
(a 20 000 pt page is refused on the per-side limit at scale 1;
a 12 000 x 12 000 pt page fits per side but is 144 MP, over the
pixel limit).

### B9 — Medium — Unbounded accumulation across many streams

**Where:** `crates/openpixel-pdf/src/pages.rs` — `page_as_form`
capped each stream at `max_file_size_bytes` but not the total,
so a page with many content streams could sum past any sane
size. Same gap in `edit.rs` flatten (`flat_content`).

**Fix:** running total vs `max_decompressed`, error if
exceeded; per-page `flat_content` capped at
`self.config().max_file_size_bytes`.

### B10 — Medium — `from-images`: unvalidated page size, all images held in memory

**Where:** `crates/openpixel-pdf/src/images.rs` — `page_size`
flowed into the MediaBox unchecked (NaN / negative / huge),
and every image was decoded into a `decoded` vec before any
page was built (up to 10 000 images x 100 MP of RGB held at
once).

**Fix:** page size validated (finite, positive, at most
14 400 pt — the largest page PDF allows, 200 inches);
decode one image, embed it, drop it. Callers only ever pass
named sizes (A4 / Letter / A5) or `None`, so the validation is
defence-in-depth. Test asserts added to
`from_images_makes_a_real_two_page_pdf` (NaN, negative and
20 000 pt sizes refused).

### B11 — Low/Medium — NaN/±inf geometry written verbatim into content streams

**Where:** `crates/openpixel-pdf/src/edit.rs`,
`redact.rs`, `security.rs` (pdf crate). `<= 0` range checks
let NaN through (all NaN comparisons are false); `fmt_num`
formats NaN as `NaN`, inf as `inf` — invalid PDF that a strict
reader rejects, and a malformed-content-stream vector.

**Fix:** new `pub(crate) fn finite(v: f64, what: &str)` in
`edit.rs`, applied to Text (x, y), Image (x, y, w, h), Rect
(x, y, w, h, stroke_width), Line (x1, y1, x2, y2, width),
Circle (cx, cy, r, stroke_width), Highlight (x, y, w, h),
Draw (width + added negative-width rejection), Comment (x, y),
PageNumbers (size), HeaderFooter (size); `validate_text` now
checks size finiteness. `redact.rs`: finite checks for
`RectRedaction` x/y/width/height. `security.rs` (pdf crate):
watermark validates `grey` finite + 0.0..=1.0,
`angle_degrees` finite, `font_size` finite (the opacity range
check already rejected NaN). Tests:
`redact::tests::redact_rejects_nan_coordinates` (NaN x, inf
width rejected).

### B12 — Low/Medium — WASM boundary: untrusted lengths

**Where:** `crates/openpixel-wasm/src/lib.rs`.

- `js_array_of_bytes` did `Vec::with_capacity(arr.length())`
  from a JS-controlled length — a sparse array of length
  2^32-1 would try to pre-allocate ~96 GiB before the first
  element is even read. Fix: cap the pre-allocation at 1024
  (the vec still grows as needed).
- `Uint8Array::new_with_length(out.len() as u32)` at four
  sites (`pdf_process`, `pdf_compress`, `pdf_data_obj`,
  `result_object`) would silently truncate an output over 4 GiB
  and `copy_from` would then trap. Fix: new `uint8_array`
  helper returning an error over `u32::MAX`. The remaining
  `as u32` casts are counts (images/ops/pages, all ≤ 10 000) —
  bounded, safe.

Test: `sparse_js_array_does_not_preallocate`
(`wasm_bindgen_test`; a sparse array of length `u32::MAX`
fails on the first element, without allocating). Note: this
test needs the wasm runner — it does not run in the native
`cargo test` pass (see Verification below).

### B13 — Low — XML-invalid control chars in text exports

**Where:** `escape_xml` in `crates/openpixel-pdf/src/text.rs`
and `crates/openpixel-ocr/src/export.rs` did not strip
XML-invalid control characters (< 0x20 except tab/LF/CR) from
OCR/PDF text — one NUL in extracted text would make the whole
EPUB / DOCX / XLSX unparseable.

**Fix:** both implementations now drop forbidden control
characters (there is no XML 1.0 escape for them). Tests:
`text::tests::escape_xml_drops_forbidden_control_characters`
and `export::tests::exports_drop_control_characters_from_words`
(a NUL/BEL in recognised words is dropped and the DOCX/XLSX
stays valid).

### B14 — Low — `repair()` and `unlock()` skipped validation

**Where:** `crates/openpixel-pdf/src/sanitize.rs` (`repair`)
and `crates/openpixel-pdf/src/security.rs` (`unlock`) loaded
arbitrary bytes with no size limit.

**Fix:** file-size check (`> config.max_file_size_bytes` →
`InvalidPdf`) at the top of both. Note: `repair` still has no
page-count limit — a damaged file cannot be counted reliably;
load is bounded per stream by lopdf.

### B15 — Low — Quadratic page-list lookup in remove/duplicate

**Where:** `crates/openpixel-pdf/src/pages.rs` — `remove` and
`duplicate` used `pages.contains(p)` inside a loop over the
page count: O(count x list) CPU on a long caller-supplied page
list.

**Fix:** the list is converted to a `HashSet` once.

### B16 — Low — `searchable_pdf` had no page-count cap

**Where:** `crates/openpixel-ocr/src/tesseract.rs` —
`TesseractEngine::searchable_pdf` took an arbitrary slice, and
each page is a full Leptonica decode plus a Tesseract pass.

**Fix:** `MAX_SEARCHABLE_PAGES: usize = 10_000`, matching
`PdfConfig::max_pages`.

### Redaction appearance-stream leak — Medium (fixed in `cfc4a8d`)

**Where:** `crates/openpixel-pdf/src/redact.rs` —
`remove_intersecting_annotations` removed only the annotation
dict. lopdf writes every object, so the orphaned `/AP` stream
kept the redacted text in the output bytes — the redaction
removed the annotation but left the secret behind.

**Fix:** new `appearance_stream_ids` helper (walks `/AP`
/N, /R, /D incl. state sub-dicts), `referenced_elsewhere` +
`object_references` (shared appearance streams are kept);
AP streams are deleted when the annotation is removed. Test:
`redact_removes_annotation_appearance_streams_too` (distinct
secret `AP-SECRET-999` in the AP stream; asserts
`annotations_removed == 1` and the secret is absent from the
output bytes).

## Verified safe in Phase 8 (read, no change needed)

These were checked line by line and hold as documented:

- **TempWorkspace** (`crates/openpixel-security/src/workspace.rs`):
  prefix charset validation, unique
  `openpixel-{prefix}-{pid}-{n}` dirs, `file_path` rejects
  separators / `..` / absolute / NUL + `starts_with`
  defence-in-depth, drop removes the tree.
- **OCR language handling** (`crates/openpixel-ocr/src/engine.rs`):
  `OcrOptions::validate` restricts language names to ASCII
  alnum / `_` / `-` (no traversal into tessdata);
  `check_languages` verifies `{lang}.traineddata` exists.
- **OCR preprocessing** (`crates/openpixel-ocr/src/preprocess.rs`):
  no upscaling (grayscale / denoise / deskew / threshold only);
  pipeline dimension checks apply.
- **`format.rs` `zip_local_names` `.unwrap()`** (line 313) is
  guarded by the `pos + 30 <= bytes.len()` loop condition.
- **Page operations:** `extract` / `duplicate` output page
  counts are capped via `extract`'s `max_pages` check;
  `merge` / `insert` / `replace` check totals; `reorder`
  requires an exact permutation.
- **`PageCopier`** inserts into `map` before recursing
  (cycle-safe); `inherited_attribute` depth cap 32;
  `collect_name_tree_ids` has a visited set;
  `collect_field_ids` (edit.rs) has a cycle check.
- **`image_display_sizes`** uses
  `decompressed_content_with_limit` (per-stream bound).
- **WASM BigInt:** `process_to_size` takes u64 and the web UI
  (`apps/web/src/lib/wasm-engine.ts`) passes `BigInt(...)`;
  `pdf_compress` already emits f64 (Phase 3 fix).
- **LibreOffice adapter**
  (`crates/openpixel-documents/src/libreoffice.rs`): argv-based
  invocation, no shell — no command injection (`source_ext`
  comes from the fixed `DocumentFormat::id()` enum;
  `libreoffice_filter(target)` is a table lookup).
- **`zip.rs` / OCR `export.rs` u32/u16 truncations:**
  unreachable in practice (entry counts/sizes bounded by the
  100 MiB input and 10k pages).
- **`collect_sig_dicts`** was the only graph walk without cycle
  protection (fixed, B5).

## Accepted risks — Phase 8 additions (not fixed, deliberate)

### B-R1 — `rsa` 0.9.6 advisory (RUSTSEC-2023-0071, Marvin Attack, medium 5.9)

Upgrade blocked: `rsa` is pinned `=0.9.6` in the workspace
`Cargo.toml`, and 0.10 would cascade through the
`cms` / `der` / `spki` / `pkcs1` / `pkcs8` exact pins — a
dependency-stack migration, not a contained fix. Signing-only
use (no decryption oracle), local tool. `cargo audit` would
still fail on the two unmaintained advisories below regardless.

### B-R2 — Unmaintained advisories with no fixed upgrade

`chrono` 0.4.45 — RUSTSEC-2026-0543, unmaintained.
`paste` 1.0.15 — RUSTSEC-2024-0436, unmaintained (pre-existing;
fails on clean HEAD too).

### B-R3 — Load-time object-stream expansion (aggregate)

lopdf caps each object/xref stream at 256 MiB at load, but
there is no aggregate cap; a 100 MiB file could hold many
object streams. A central `load_with_options` wrapper would be
invasive — recorded, not fixed.

### B-R4 — LibreOffice adapter residuals

Timeout 120 s kills the direct child, but soffice-spawned
children may linger and the profile dir may then fail to delete
(ignored by `TempWorkspace` drop). `version()` uses `.output()`
with no timeout. The output file is read fully into memory
with no cap (bounded in practice by the 120 s timeout). Macro
execution relies on LibreOffice's default macro security (the
adapter does not change it).

### B-R5 — PDFium render/text worker has no timeout (A8 class)

`reply_rx.recv()` blocks indefinitely. The CLI now kills the
whole conversion at the process level (see A8 update below),
but the in-process worker itself has no timeout.

### B-R6 — OCR has no timeout on Tesseract recognition (A8 class)

Leptonica/Tesseract are C parsers; their CVEs are out of scope
for this audit.

### B-R7 — Signature verification limits (fail-closed, documented)

`verify_cms_signature` always uses `VerifyingKey::<Sha256>`
even when the SignerInfo algorithm is SHA-384/512-with-RSA —
legit SHA-384/512 signatures are reported invalid, not a
bypass. Trust is one level only, documented. No CRL/OCSP/TSA;
ECDSA reported unsupported — documented.

### B-R8 — Sanitise scope limits

RichMedia / Sound / Movie / 3D annotations are not removed
(no script execution; media playback only). `/AF` associated
files are caught indirectly via Filespec dicts.
`name_tree_count` counts only top-level `/Names` and
undercounts `/Kids` subtrees (informational only).

### B-R9 — Redact documented limits (unchanged)

Form XObject text is not reached; vector-outline text has
nothing to remove; single-run search only; `/Info` metadata
is not redacted.

### B-R10 — RC4-128 protection

Strongest lopdf can create; documented as casual-opening
protection only.

### B-R11 — XLSX row limit

The 1,048,576-row limit could be exceeded by >1M words on one
image (extremely unlikely).

## A8/A9 status update (Phase 8 — landed by the parallel isolation agent)

A8 (no processing timeouts) and A9 (no RSS cap) are **closed for
CLI paths**: `openpixel-security::isolated::run_command_isolated`
spawns the work as a supervised child process and SIGKILLs it on
timeout or RSS breach (commits `dc915de`, `7826aaf`;
`docs/SECURITY.md` Phase 8 section; regression tests in
`crates/openpixel-security/src/isolated.rs` and
`crates/openpixel-jobs/src/manager.rs`).

Residual, honestly stated: desktop in-process calls and direct
`Engine::convert` still have no kill (`run_with_timeout`
detaches, it does not kill); the web app runs in-browser with
its own 120 s worker timeout. A deployment cap (`ulimit` /
cgroup) is still the real enforcement for a server.

## Fuzzing (Phase 8)

New target `fuzz_pdf`
(`crates/openpixel-codecs/fuzz/fuzz_targets/fuzz_pdf.rs`,
registered in `crates/openpixel-codecs/fuzz/Cargo.toml`):
feeds arbitrary bytes into `validate`, `page_count`,
`inspect`, `extract_text`, `compress`, `sanitize` and `redact`
(rect + text) — the parse-level PDF paths, which must degrade
to a typed error, never a panic. Rendering is not fuzzed (it
needs a libpdfium binary); signing is not fuzzed
(feature-gated; its CMS parsing is covered by unit tests).
Seed corpus `crates/openpixel-codecs/fuzz/corpus/fuzz_pdf/`:
`minimal.pdf` (hand-built 1-page PDF), `flate.pdf` (same page,
FlateDecode content stream), `truncated.pdf` (first half of
the minimal PDF).

Seed corpus `crates/openpixel-codecs/fuzz/corpus/fuzz_pdf/`:
`minimal.pdf` (hand-built 1-page PDF), `flate.pdf` (same page,
FlateDecode content stream), `truncated.pdf` (first half of
the minimal PDF). The corpus dir is git-ignored (same as the
Phase 9 seeds — present on disk, not committed).

Outcome (18 Nov 2026, this VM): **5 283 runs in 61 s, 0
crashes** (`cargo +nightly fuzz run fuzz_pdf --
-max_total_time=60`; final line `#5283 DONE cov: 5455 ft:
12458 corp: 629/287Kb`, `Done 5283 runs in 61 second(s)`).
`fuzz/artifacts/fuzz_pdf/` is empty. Build note: on a small VM
(6 GiB RAM, 1.5 shared CPUs) the first build attempt was
OOM-killed (SIGKILL on the ASan-instrumented `lopdf` compile);
rebuild with `CARGO_BUILD_JOBS=1` — see the fuzz README. One
real bug was found by the build itself: the target first called
`compress(data, &CompressOptions::default())`, but the method
takes `(bytes, CompressMode, CompressOptions)` — fixed to
`CompressMode::Ebook` before the run.

OCR inputs were NOT fuzzed: Tesseract needs traineddata plus a
C harness, out of scope for this pass.

## Audit tool outputs (Phase 8)

- `cargo audit`: **exit 1**. Three items: `rsa` 0.9.6 —
  RUSTSEC-2023-0071 (Marvin Attack, medium 5.9, fix: upgrade
  to >= 0.10.0); `chrono` 0.4.45 — RUSTSEC-2026-0543
  (unmaintained, no fixed upgrade available); `paste` 1.0.15 —
  RUSTSEC-2024-0436 (unmaintained, no fixed upgrade available).
  The run also showed many `error: couldn't check if the
  package is yanked: registry: request could not be completed
  in the allotted timeframe` lines — registry timeout noise
  from the shared egress IP; the advisory DB itself was
  present. Full output saved at the time under
  `/tmp/sec-audit/cargo-audit.txt` (ephemeral `/tmp`).
- `cargo deny check licenses`: **exit 0, "licenses ok"**. CI
  (`.github/workflows/release.yml`, job "wasm-and-licenses")
  runs only `cargo deny check licenses` — there is no
  advisories job, so an advisories check is not required.

## Verification (Phase 8)

- `cargo test --workspace`: **374 passed, 0 failed** (baseline
  340/340; +34 includes this audit's 14 new tests — 2 compress,
  2 redact, 4 sanitize, 2 sign, 1 render, 1 text, 1 OCR
  export, 1 WASM — and the parallel agents' isolation /
  libpdfium tests). Per-crate counts from `--list`:
  openpixel-pdf 83 (79 lib with pdfium+sign features unified
  by the workspace + 4 merge_split), openpixel-ocr 14,
  openpixel-documents 11, openpixel-wasm 20, openpixel-core 55,
  openpixel-codecs 31, openpixel-metadata 50,
  openpixel-pipeline 34, openpixel-security 23, openpixel-jobs
  21, openpixel-formats 14, openpixel-api 4, openpixel CLI 14.
- `cargo fmt` clean; `cargo clippy -p openpixel-pdf -p
  openpixel-ocr -p openpixel-documents -p openpixel-wasm
  --all-targets` clean (no errors; only pre-existing warnings
  elsewhere). `cargo check -p openpixel` (CLI) and `cargo check
  -p openpixel-wasm --target wasm32-unknown-unknown` clean.
- CLI e2e `scripts/test/cli-e2e.sh`: **exit 0** (18 Nov 2026,
  release binary built from the fixed tree, all 14 sections
  §1–§14, `=== DONE ===`, zero `FAIL` lines, 132 `exit=0`
  commands). The 8 nonzero exits in the log are the expected
  error cases in §8 / §10b / §13i (missing/corrupt inputs,
  bad flags, bad `--op` JSON — all exit 1/2 with a clean typed
  error, no crash). Two runs before the clean pass: the first
  aborted at §10 (missing HEIC fixtures after the `/tmp`
  wipe — regenerated from the checked-in codec fixtures);
  the second aborted at §13a (`pdf render` needs libpdfium,
  which was not discoverable — staged by copying the
  libpdfium agent's `apps/desktop/src-tauri/resources/
  libpdfium.so` next to the release binary, a documented
  discovery location; smoke-tested first). The e2e's PDF
  sections (§10–§13) exercise the fixed paths end to end:
  compress modes, protect/unlock, watermark, extract-text in
  all four formats, OCR incl. searchable PDF, edit/redact
  (byte-proof secret removal), sign/verify incl. tamper,
  flatten, repair, inspect/sanitize of the malicious fixture.
- The WASM `wasm_bindgen_test` for B12
  (`sparse_js_array_does_not_preallocate`) does **not** run
  in the native `cargo test` pass — it needs the wasm runner
  (`wasm-pack test` / node). It compiles under
  `cargo check -p openpixel-wasm --target
  wasm32-unknown-unknown`; it was not executed on this VM.
- Environment note: a VM reset mid-audit wiped `/tmp`
  (fixtures, saved audit outputs) and the Tesseract
  provisioning; both were regenerated/re-provisioned per
  `docs/OCR.md` §Provisioning before the final verification
  runs. The `cargo audit` / `cargo deny` outputs above were
  re-run after the reset and are identical to the pre-reset
  run.

## Phase 9 audit (16 Nov 2026)

Audit date: 16 Nov 2026. Auditor: Phase 9 subagent (code review of
every crate + CLI + web worker + Tauri commands, plus the new
cargo-fuzz targets — see `crates/openpixel-codecs/fuzz/`).
Scope: untrusted-input handling end to end. No findings here are
invented: each one names the file and the code that was read. The
baseline this audit builds on is `docs/SECURITY.md` (Phases 1–8);
items already recorded there are not repeated unless the audit
changed their status.

Severity scale: **High** — a crafted file can crash / OOM the
process or write outside the intended output; **Medium** — a crafted
file can exhaust memory/time well beyond the documented limits, or
bypass a documented limit; **Low** — defence-in-depth / local-trust
notes; **Accepted risk** — known, documented, not fixed in this
phase.

## Fixed in Phase 9

### A1 — High — Unbounded zlib decompression in PNG metadata (decompression bomb)

**Where:** `crates/openpixel-metadata/src/extract.rs` —
`parse_png_iccp`, `parse_png_text_xmp` (`zTXt` and compressed `iTXt`
branches). All three called `ZlibDecoder::read_to_end` into a plain
`Vec` with no cap.

**Impact:** a PNG chunk is bounded by the 100 MiB file limit, but
zlib expansion is ~1000x, so a few-KiB compressed chunk (e.g. 20 MiB
of zeros, ~20 KiB compressed) would expand toward tens of GiB and
OOM/abort the process. The metadata path runs on *every* conversion
(`Engine::convert` calls `extract_metadata` first), so any PNG
triggered it — not just `openpixel metadata`.

**Fix:** `read_decompressed_capped()` — `decoder.take(16 MiB + 1)`,
drop the block with a warning when it expands past 16 MiB (real ICC
profiles are a few hundred KiB; XMP packets far smaller). Tests:
`extract::tests::iccp_zlib_bomb_is_dropped_not_decompressed`,
`ztxt_zlib_bomb_is_dropped_not_decompressed` (20 MiB zero-bombs).

### A2 — High — GIF frame extraction allocated the canvas before any limit check

**Where:** `crates/openpixel-metadata/src/frames.rs` —
`extract_gif_frame` did `vec![0u8; (width * height * 4)]` straight
from the GIF header. The GIF header allows 65 535 x 65 535, i.e. a
~17 GiB RGBA allocation. The engine's `check_dimensions` runs only
*after* `decode_selected_frame` returns, so it never saw the
allocation.

**Fix:** the canvas pixel count is checked against the 100 MP limit
before allocating; over-limit headers are a typed `InvalidInput`
error. Test: `frames::tests::huge_gif_canvas_is_rejected_before_allocation`.

### A3 — Medium — TIFF page decode allocated pixels before any limit check

**Where:** `crates/openpixel-metadata/src/frames.rs` —
`extract_tiff_page` called `decoder.read_image()` with no dimension
check; a page header claiming e.g. 100 000 x 100 000 would make the
`tiff` decoder allocate a multi-gigabyte buffer first. (The normal
convert path is safe — the engine calls `codec.dimensions()` and
checks it before decoding; only the frame-extraction path skipped
it.)

**Fix:** dimensions are checked after `decoder.dimensions()` and
before `read_image()` (16 384 px / side, 100 MP, same as the
engine). Test: `frames::tests::huge_tiff_page_is_rejected_before_decode`.

### A4 — Medium — CLI batch read files without any size limit

**Where:** `apps/cli/src/main.rs` — `collect_batch_inputs` did
`fs::read(&input)` on every file in the directory to detect its
format, *before* the engine ever saw the file. The engine's 100 MiB
limit therefore never applied to batch inputs: a multi-gigabyte
file in the batch directory was loaded into memory whole.

**Fix:** `fs::metadata` length is checked first; files over
`MAX_FILE_SIZE_BYTES` are reported as batch failures and never
read. Test:
`tests::batch_collection_skips_oversize_files_without_reading`
(sparse 101 MiB file — never read, still sparse afterwards).

### A5 — Medium — Unbounded frame scans (GIF / APNG / animated WebP)

**Where:** `crates/openpixel-metadata/src/frames.rs` —
`gif_animation` pushed one `FrameInfo` per frame with no cap, and
`apng_info` / `webp_animation_info` pushed one per `fcTL` / `ANMF`
chunk with no cap. A 100 MiB file can carry millions of tiny frames
/ chunks, growing the vec (and the scan time) without bound.

**Fix:** scans stop at 100 000 frames (`MAX_SCANNED_FRAMES`) with a
note in the `AnimationInfo`; APNG additionally never records more
frames than `acTL` declared. `extract_gif_frame` also stops
scanning past the cap instead of walking an unbounded frame list
for a huge index.

### A6 — Low — Engine `read_input` TOCTOU on file size

**Where:** `crates/openpixel-core/src/engine.rs` — `read_input`
checked `fs::metadata` length, then `fs::read`. A file that grew
between the two calls (or a symlink whose target reports a
different size) could be read past the limit.

**Fix:** the byte length is re-checked after the read; over-limit
reads are rejected with `LimitExceeded`.

## Verified safe (read, no change needed)

These were checked line by line and hold as documented:

- **Magic-byte detection** (`crates/openpixel-formats/src/format.rs`):
  every branch is length-guarded (`bytes.len() >= N` before slicing);
  the SVG sniff is start-anchored and rejects unterminated `<?xml`;
  TGA sniff requires a consistent header (type, depth, non-zero
  dimensions). No panics on empty/truncated input (covered by unit
  tests and now by `fuzz_detect`).
- **EXIF / TIFF IFD parser** (`crates/openpixel-metadata/src/exif.rs`):
  all reads go through `TiffReader::{u16,u32}_at` / `.get(..)` with
  `checked_add`; entry counts are capped (`with_capacity(count.min(256))`,
  truncated entries skipped with warnings); GPS rationals check
  divide-by-zero; coordinates range-checked. Corrupt EXIF degrades
  to warnings, never a panic.
- **JPEG / PNG / WebP chunk scans** (`extract.rs`): segment/chunk
  lengths are bounds-checked with `checked_add` and `bytes.get(..)`;
  truncated segments end the scan with a warning. ICC APP2 chunk
  indices are validated (`chunk_no` 1..=`chunk_total`, `chunk_total`
  ≤ 255 by construction — a `u8`), so the reassembly vec cannot be
  abused beyond 255 slots.
- **ICC parser** (`crates/openpixel-metadata/src/icc.rs`): tag-table
  offsets use `checked_add` / `.get(..)`; `parse_icc` requires the
  `acsp` signature; `convert_to_srgb` allocates exactly the (already
  limit-checked) image size.
- **SVG** (`crates/openpixel-codecs/src/svg.rs`): scripts never
  execute (usvg parses static data); `resources_dir` stays `None`
  so `<image href>`, `@import` and external fonts are never fetched
  and there is no network or file access from the document; the
  canvas is scaled to 16 384 px / 100 MP *before* the pixmap is
  allocated. `load_system_fonts()` reads local system font files
  only — that is usvg's documented behaviour for `<text>`.
- **Pipeline** (`crates/openpixel-pipeline/src/pipeline.rs`,
  `operation.rs`): `Pipeline::apply` validates the whole pipeline
  against simulated dimensions *before* touching pixels, and
  re-checks after every operation; pad/rotate canvas allocations
  happen only after validation. `rotated_dimensions` is
  overflow-checked.
- **Jobs** (`crates/openpixel-jobs/src/manager.rs`): worker count
  is clamped to 1..=8 (`MAX_WORKERS`); at most `workers` images are
  ever decoded at once; the queue holds paths, not pixels, so
  submitting many jobs cannot balloon RAM beyond the per-worker
  bound (a job's pixels are freed when it finishes). `pause` /
  `cancel` never interrupt a running decode.
- **Path handling** (`crates/openpixel-core/src/security.rs`):
  `validate_output_path` rejects `..` components and NUL bytes, and
  `encode_and_write` calls it before writing; the CLI batch output
  names are built from the input file stem + a fixed target
  extension, so a hostile filename cannot inject a path (a stem of
  `..` is impossible — `file_stem` of `..` is `None` → `"out"`).
  `create_dir_all` is only called on the caller-supplied output
  parent.
- **Web worker** (`apps/web/src/worker.ts`, `src/lib/convert.ts`):
  no `eval`, no `innerHTML` with file data, no network; the worker
  has a 120 s timeout with a main-thread fallback; `flattenBackground`
  flows into `ctx.fillStyle` only (an invalid colour is ignored by
  the canvas, not executed). The browser enforces no engine limits
  — already documented in `docs/WEB.md`.
- **Tauri commands** (`apps/desktop/src-tauri/src/commands.rs`):
  all numeric/option inputs are validated before the engine is
  called (`build_options` / `build_pipeline`: quality 1–100, PNG
  compression 0–2, background via the engine's parser, rotation
  90/180/270 only, workers clamped 1–8, `read_logs` line count
  clamped 1–1000); the commands are thin wrappers over the same
  engine calls the CLI uses, so engine limits apply. `list_directory_images`
  is non-recursive and extension-filtered; it lists paths the local
  user already chose — there is no remote caller, so path arguments
  are a local-trust boundary, not an injection surface (see A7).
- **No shell, no `unsafe`, no network:** `grep` over all Rust and
  TypeScript sources finds no `unsafe` block, no `Command::new` /
  shell invocation, and no network call in the engine, CLI, web app
  or desktop backend. The only network in the repo is the browser
  fetching nothing (static files) and cargo fetching crates at build
  time.
- **Decoders:** the engine always calls `codec.dimensions()` and
  checks it against the limits before `decode()` — except the two
  frame-extraction paths fixed in A2/A3. `image-rs` decoders are
  otherwise bounded by that pre-check.

## Accepted risks (not fixed — documented, deliberate)

### A7 — Output paths may be absolute, and `fs::write` follows symlinks

`validate_output_path` rejects `..` but deliberately allows
absolute paths (the CLI and desktop app are local tools: the user
chooses where the output goes, and an absolute output path is a
normal use). Likewise, if the output path itself is a symlink, the
write follows it. Overwriting a file the user pointed at is the
tool's job; there is no sandbox boundary to violate because the
invoking user already owns both sides. A future server mode would
need an output-root jail — that mode does not exist.

### A8 — No processing timeouts

A pathological file can still take a long time inside one
decode/encode call (notably AVIF encode, ~9.3 s for 1024x768 — see
`docs/BENCHMARKS.md`). Phase 6 bounds *how many* such jobs run at
once (workers 1–8), it does not time them out, and neither the CLI
nor the desktop app kills a running job. Fixing this properly needs
worker isolation (a child process that can be killed) — out of
scope for a QA phase; it remains the top item for a future
hardening pass. The web worker is the exception: it has a 120 s
timeout (see above).

**Mitigated in Studio Phase 1 (16 Nov 2026) — partial, not a
full fix.** `openpixel-security::run_with_timeout` enforces a
wall-clock limit (default 300 s, `EngineConfig::processing_timeout`)
wherever a `'static` closure exists: the jobs pool
(`JobManager::for_engine` reads the engine's timeout) and any
custom `JobHandler`. On timeout the caller gets a `TimedOut`
error, but the worker thread is **detached, not killed** — a
thread cannot be killed safely in-process, so a pathological
decode keeps running in the background until it finishes. True
kill needs process isolation (Phase 8 backend). Direct
`Engine::convert` calls still have no timeout (the `&self`
borrow cannot move into a worker thread); the RSS pre-flight
check below is what bounds those. Status: A8 is mitigated for
batch jobs, open for single synchronous calls.

### A9 — No RSS / cgroup cap

Pixel limits bound decoded buffers, but there is no OS-level memory
cap. Worst case is `workers x 100 MP x 4 bytes` = 1.6 GiB at the
default 4 workers; measured peak RSS for the whole bench suite is
70 MiB (`docs/BENCHMARKS.md`). For very large images, run with
`--workers 1`. A deployment cap (`ulimit` / cgroup) is a deployment
decision, not an engine default.

**Mitigated in Studio Phase 1 (16 Nov 2026) — partial.** `Engine`
now runs an RSS pre-flight check (`check_resource_limits`, default
cap 2 GiB, `EngineConfig::max_rss_bytes`) at the top of every
convert/process call, and `openpixel-security` exposes
`current_rss_bytes` / `peak_rss_bytes` (Linux `/proc/self/status`;
a no-op elsewhere). This is a *pre-flight* check, not a hard
cgroup: a single decode can still grow past the cap mid-call, and
the check reads the process-wide RSS, so concurrent workers share
the budget. A deployment cap (`ulimit` / cgroup) is still the
real enforcement for a server. Status: A9 is mitigated for the
common case, open as a hard guarantee.

### A10 — Input symlinks and special files

`read_input` follows symlinks (a symlinked input is read like the
file it points at) and `fs::metadata` reports 0 bytes for procfs /
pipe-like inputs, so the pre-read size check does not bound them;
the post-read re-check (A6) bounds regular files, and a FIFO input
would block the read instead. This is a local CLI: the user names
their own input. Not fixed — a server mode would need to reject
non-regular files explicitly.

### A11 — SVG complexity (no element-count / nesting cap)

usvg parses the whole document before rasterisation, and a deeply
nested or element-dense SVG (still under 100 MiB) can be slow to
parse — same class as A8 (no timeouts). Scripts, external
resources and network are disabled (see "Verified safe"), so the
exposure is CPU time only, bounded by the single decode call.

### A12 — Metadata privacy is policy, not automatic

`Preserve` byte-copies EXIF (including GPS) into JPEG/PNG outputs
by design; the default is `Strip`. The web app always strips
(canvas round-trip). Operators who preserve metadata should know
the output carries the source's GPS — the CLI prints what was
preserved (`metadata_preserved` in the result).

## Fuzzing (Phase 9)

Three `cargo-fuzz` targets under `crates/openpixel-codecs/fuzz/`
(`fuzz_detect`, `fuzz_decode`, `fuzz_metadata`) — see
`crates/openpixel-codecs/fuzz/README.md` for the run commands.
Outcome of the Phase 9 runs: recorded in `docs/TESTING.md`
("Verified results — Phase 9").

## Licence / SBOM

Licence audit outcome: `sbom.json` (root workspace, 236 components)
and `apps/desktop/src-tauri/sbom.json` (desktop backend, 570
components), generated by `scripts/release/generate-sbom.py` from
`Cargo.lock` via `cargo metadata`. No component lacks a licence
field; no copyleft-only licence is present (the only LGPL mention
is `r-efi`'s `MIT OR Apache-2.0 OR LGPL-2.1-or-later`, where the
permissive options apply). Native licences in `native/licenses/`
were completed in Phase 9 (ravif, rav1e, mp4parse, exr, tintbox
texts added from the vendored crate sources). `cargo audit` outcome:
recorded in `docs/TESTING.md` ("Verified results — Phase 9").
