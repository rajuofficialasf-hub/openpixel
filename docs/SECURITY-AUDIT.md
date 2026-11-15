# Security Audit — OpenPixel Engine (Phase 9)

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

### A9 — No RSS / cgroup cap

Pixel limits bound decoded buffers, but there is no OS-level memory
cap. Worst case is `workers x 100 MP x 4 bytes` = 1.6 GiB at the
default 4 workers; measured peak RSS for the whole bench suite is
70 MiB (`docs/BENCHMARKS.md`). For very large images, run with
`--workers 1`. A deployment cap (`ulimit` / cgroup) is a deployment
decision, not an engine default.

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
