# Testing — OpenPixel Engine (Phase 1)

## Rule

A feature is complete only when implementation, tests, error handling
and documentation exist. Compiling is not completion.

## What runs in Phase 1

```bash
cargo test --workspace
```

- **Unit tests** (`crates/openpixel-core/src/…`, `#[cfg(test)]`):
  - `format.rs` — magic-byte detection for JPEG/PNG/BMP/GIF/TIFF/WebP,
    AVIF/HEIC/QOI/ICO/JXL; unknown for random/empty input; `from_name`
    case/dot handling.
  - `security.rs` — oversize file, huge dimensions, `..` paths,
    background parsing.
  - `engine.rs` — PNG round-trip (alpha preserved), PNG→JPEG (alpha
    flattened), JPEG→BMP/WebP/GIF/TIFF, unknown-format rejection,
    AVIF `NotImplemented`, missing-file `NotFound`.
- **Integration tests** (`crates/openpixel-core/tests/integration.rs`):
  - All 8 implemented formats round-trip from one RGBA fixture, with
    output re-detection matching the requested target.
  - Extension is not trusted (PNG named `.jpg` → detected as PNG).
  - Corrupted file (valid PNG signature + garbage) errors cleanly.
  - JPEG quality 20 vs 95 changes output size in the expected direction.

## Verified results — Phase 7, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0, Node v24.22.1 / npm 10.9.4

Web app in `apps/web/` (React 19.3.1 + TypeScript 7.0.2 + Vite 8.3.8
+ Tailwind CSS 3.4.17, all versions pinned exactly in
`package.json`; Vitest 3.2.4, jszip 3.10.1). No server anywhere.

- `npm run generate:capabilities` — writes 21 formats from
  `target/release/openpixel --json formats`; re-running it
  reproduces the checked-in `src/data/capabilities.json`
  byte-for-byte (`diff` clean). A first version of the script
  computed the repo root one level short (`apps/` instead of the
  repo root) and failed loudly with the missing-binary message —
  fixed to three levels up and re-verified.
- `npm test` — **17 passed, 0 failed** (2 files): `detect.test.ts`
  7 (JPEG/PNG/BMP/GIF/TIFF/WebP, AVIF/HEIC/HEIF/QOI/ICO/JXL,
  JPEG 2000/PNM/EXR/HDR, TGA header validation, SVG start-only
  sniff incl. HTML rejection, unknown/empty/truncated input),
  `capabilities.test.ts` 10 (21 formats, planned formats
  undecodable/unencodable, SVG decode-only, 16 implemented
  decodable, encodable/browser-encodable/CLI-only partitioning,
  alpha flattening, filenames/labels).
- `npm run build` — passes (`tsc -b && vite build`, 1.25 s):
  `dist/index.html` 0.63 kB, `dist/assets/index-*.css` 14.46 kB,
  `dist/assets/index-*.js` 362.26 kB (gzip 107.98 kB),
  `dist/assets/worker-*.js` 0.73 kB (the conversion worker is its
  own chunk). Two real build failures found and fixed on the way:
  a missing `bytes` field on the Convert result state, and the
  worker URL/import resolved against `src/lib/` instead of `src/`
  (`../worker.ts`, in both the type import and the `new Worker`
  URL). `npm run dev` starts (Vite ready in 255 ms) and serves
  the page at `http://localhost:5173/` (HTTP 200, correct title).
- Production build served locally (`python3 -m http.server` in
  `dist/`): `/` 200 (635 B), JS asset 200 (contains "OpenPixel"),
  worker asset 200.
- WASM attempt (evidence in `docs/WEB.md`): `rustup target add
  wasm32-unknown-unknown` installed; `cargo build -p
  openpixel-formats --target wasm32-unknown-unknown` succeeds
  (10.95 s, `libopenpixel_formats.rlib`); `cargo build -p
  openpixel-core --target wasm32-unknown-unknown` fails, exit 101
  — `dav1d-sys` 0.8.3 build script panics (pkg-config not
  configured for wasm32 cross-compilation, no wasm32 libdav1d
  sysroot). `wasm-pack` is not installed. No WASM module is
  shipped; the UI states this.
- Rust workspace unchanged and green: `cargo fmt --all` +
  `cargo fmt --check` pass, `cargo clippy --workspace
  --all-targets -- -D warnings` passes, `cargo test --workspace`
  **171 passed, 0 failed** (same as the Phase 6 baseline),
  `cargo build --release` succeeds.
- Manual browser checklist — NOT yet run in a real browser (no
  live-browser tooling in this subagent session); confirm before
  release: (1) drop a PNG, convert to JPEG/WebP/BMP and download —
  output re-detects as the target; (2) drop a JPEG, check the
  detected format ignores a lying extension (rename to `.png`);
  (3) batch of 3+ files incl. one unsupported (e.g. TIFF) — TIFF
  is skipped with a reason, the rest convert, zip downloads;
  (4) theme toggle light/dark/system persists across reload;
  (5) keyboard-only: tab to the drop zone, Enter opens the picker;
  (6) GIF converts as first frame only, with the note shown.

## Verified results — HEIC/HEIF follow-up, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

HEIC/HEIF moved from detection-only to full decode+encode via
pure-Rust `heifer` 0.5.1 (see `docs/CODECS.md` for the attempt log:
the libheif route stayed blocked on the `libheif1` 1.23.3-1 /
`libheif-dev` 1.17.6 mismatch, and the system `heif-enc` ships no
HEVC/AV1 encoder at all).

- `cargo fmt --all` + `cargo fmt --all -- --check` — pass.
- `cargo clippy --workspace --all-targets -- -D warnings` — passes.
- `cargo test --workspace` — **182 passed, 0 failed** (was 176):
  formats 10, codecs **28** (was 22: 6 new HEIC unit tests —
  round-trip, quality, Apple fixtures vs Apple reference, grid
  fixtures, HEIF brand encode, corrupted input) + 3 adapter
  round-trips (now including HEIC and HEIF), core **30** (the
  `rejects_unknown_format_and_unimplemented_heic` test now asserts
  PNG→HEIC *and* PNG→HEIF succeed, with output re-detecting as the
  target format), jobs 11, metadata 50, pipeline 29, CLI 5 + 4
  integration. One real clippy error was found and fixed during the
  work (`chunks_exact` with a constant size in a HEIF test —
  switched to `as_chunks`; `cargo test` had passed throughout
  because the lint only fires under clippy's `-D warnings`).
- `cargo build --release` — succeeds, binary
  `target/release/openpixel`.
- Manual CLI verification on a real Apple `sips`-encoded photo
  (`photo-2048.heic`, 2048×1536, grid 4×3): `info` reports heic
  2048×1536 rgb8; `discover` reports heic/Signature/High;
  `capabilities heic` and `capabilities heif` both report
  decode=yes / encode=yes; HEIC→PNG (55 438 → 2 071 716 bytes),
  HEIC→JPEG (→ 227 637 bytes), PNG→HEIC (2 071 716 → 45 537
  bytes), PNG→HEIF (→ 45 537 bytes, `file` reports "ISO Media,
  HEIF Image", `info` reports heif) and HEIF→PNG all succeed and
  re-detect correctly.
- Independent cross-checks: system libheif (`heif-info` 1.23.3)
  parses our HEIC output (2048×1536, 4:2:0, 8-bit, tiles 4×3)
  and our HEIF output (main brand `mif1`, compatible `mif1,
  heic`); `heif-convert` converts both back to PNG. Our decode
  of the Apple photo vs libheif's decode of the same file: MAE
  **0.323**. Apple fixtures vs Apple's own reference PNGs: MAE
  0.00–0.77. Heifer output verified genuine HEIC before any
  engine code was written (see `docs/CODECS.md`).
- Web: `src/data/capabilities.json` regenerated with
  `npm run generate:capabilities` (21 formats; only the HEIC and
  HEIF entries changed — `can_decode`/`can_encode` false→true,
  dependency `heifer 0.5.1`, licence MIT OR Apache-2.0).
- Bug found and fixed during this follow-up: the first version
  claimed HEIF encode=yes while heifer always writes the `heic`
  major brand, so the engine's output re-detection rejected
  PNG→HEIF ("wrote heic, expected heif"). `HeifCodec::encode`
  now rewrites the 4 `ftyp` major-brand bytes to `mif1`
  (`heic` stays a compatible brand); the rewritten file still
  parses in libheif and heifer, and the generic adapter
  round-trip test now enforces HEIF re-detection instead of
  skipping it.

## Verified results — Phase 9, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0, Node v24 / npm 10.9.4

Production QA. No new features except what QA required (six security
fixes, all with regression tests — see `docs/SECURITY-AUDIT.md`).

- `cargo fmt --all` + `cargo fmt --all -- --check` — pass.
- `cargo clippy --workspace --all-targets -- -D warnings` — passes.
- `cargo test --workspace` — **176 passed, 0 failed** (was 171):
  CLI 5 unit (new: batch skips oversize files without reading them)
  + 4 integration, codecs 22, core 30 unit + 6 integration, formats
  10, jobs 11, metadata **50** (was 47: new zlib-bomb tests,
  huge-GIF-canvas and huge-TIFF-page rejection tests), pipeline 29,
  + 3 doctests (jobs, metadata, pipeline). One failure was seen
  once during the Phase 9 run and is environmental, not a code
  failure: the `openpixel-metadata` doctest failed to link with
  `ld terminated with signal 7 [Bus error]` while `/tmp` (512 MiB
  tmpfs) was 100% full from two stale `cargo install` temp dirs
  (321 MiB + 183 MiB); after deleting them the same doctest passes,
  and the full suite then passes 176/176. The same failure mode is
  already documented from Phase 8 (the Tauri sysroot was moved out
  of `/tmp` for the same reason).
- `cargo build --release` — succeeds, binary
  `target/release/openpixel` (16 733 624 B).
- Web: `npm test` — **17 passed, 0 failed** (unchanged); `npm run
  build` passes (`dist/index.html` 0.63 kB, JS 362.29 kB, worker
  0.73 kB).
- Desktop frontend: `npm test` — **11 passed, 0 failed**
  (unchanged); `npm run build` passes (JS 257.58 kB).
- Desktop backend (own workspace, with the sysroot
  `PKG_CONFIG_PATH`): `cargo test` — **16 passed, 0 failed**
  (unchanged). The `.deb` / `.AppImage` were **not** rebuilt in
  Phase 9 (they already exist from Phase 8 and the task forbade a
  full Tauri rebuild unless cheap); the packaging script references
  them, it does not reproduce them.
- Fuzzing (new — `crates/openpixel-codecs/fuzz/`, cargo-fuzz 0.13.2
  + nightly 1.102.0, installed in Phase 9): three targets, all
  built clean (one unused-import warning fixed, not suppressed):
  `fuzz_detect` **3 091 305 runs in 61 s, 0 crashes**;
  `fuzz_metadata` **29 186 runs in 61 s, 0 crashes**;
  `fuzz_decode` **5 067 runs in 121 s, 0 crashes** (slower — each
  run can decode through dav1d / ravif / jxl-oxide). No artifacts
  were produced (`fuzz/artifacts/` empty). Seed corpus in
  `fuzz/corpus/<target>/` (PNG/JPEG/WebP/BMP/GIF incl. 3-frame
  animation, TIFF, SVG, truncated PNG, garbage). See
  `crates/openpixel-codecs/fuzz/README.md`.
- Licence audit + SBOM (new): `scripts/release/generate-sbom.py`
  (from `Cargo.lock` via `cargo metadata`) produced `sbom.json`
  (**236 components**: 7 local workspace packages + 229 crates.io
  packages) and `apps/desktop/src-tauri/sbom.json` (**570
  components**). **Zero components lack a licence field in either
  SBOM.** No copyleft-only licence: the only LGPL mention is
  `r-efi` (two versions, 5.3.0 and 6.0.0) with `MIT OR Apache-2.0
  OR LGPL-2.1-or-later` — the permissive options apply, so there is
  no copyleft obligation. Licence breakdown (root): MIT OR
  Apache-2.0 131, MIT 40, Apache-2.0 OR MIT 12, BSD-3-Clause 8,
  MIT/Apache-2.0 8, BSD-2-Clause 6, rest permissive (Zlib, MPL-2.0
  x1, 0BSD, CC0, Unlicense). `native/licenses/` completed in Phase
  9: added `ravif-BSD-3-Clause.txt`, `rav1e-BSD-2-Clause.txt`,
  `mp4parse-MPL-2.0.txt`, `exr-BSD-3-Clause.txt`,
  `tintbox-MIT.txt` (copied from the vendored crate sources).
- `cargo audit` (cargo-audit 0.23.0, installed in Phase 9 — the
  first install attempt timed out at 280 s mid-compile and the
  second failed when `/tmp` filled up; the successful install used
  `TMPDIR=$HOME/tmp-cargo-install` to keep its build dir out of the
  512 MiB `/tmp` tmpfs): root workspace — **0 vulnerabilities, 1
  warning** (`paste` 1.0.15 unmaintained, RUSTSEC-2024-0436, no
  fixed upgrade available; transitive proc-macro helper, no action
  available). Desktop backend — **0 vulnerabilities, 3 warnings**:
  the same `paste` warning, `proc-macro-error` 1.0.4 unmaintained
  (RUSTSEC-2024-0370, no fixed upgrade), and `glib` 0.18.5
  unsoundness in `VariantStrIter` (RUSTSEC-2024-0429, fixed in
  >=0.20.0 — upgrading means bumping the gtk-rs stack, which is
  future work, not a QA fix; the app does not use that iterator).
  The desktop run also printed transient crates.io timeouts for the
  yanked-check (`request could not be completed in the allotted
  timeframe`) — the advisory scan itself still ran over all 570
  dependencies.
- Benchmarks: re-run, see `docs/BENCHMARKS.md` ("run 3, Phase 9"):
  jpeg_decode 4.5 ms, png_encode 26.4 ms, webp_encode 16.5 ms,
  avif_encode 10 898.7 ms, tiff_large 120.7 ms, batch_12 30.1 ms,
  peak RSS 70.1 MiB. No code-attributable regression (see the
  regression note there; the host CPU model differs from Phase 6
  and the machine was loaded).
- Release packaging: `scripts/release/package-cli.sh` produces
  `dist/openpixel-0.1.0-linux-x86_64.tar.gz` (6 504 809 B — binary
  + README + LICENSE + docs + `sbom.json` + `native/licenses/`)
  with SHA-256 checksums (`dist/SHA256SUMS`). Verified by listing
  the tarball contents.
- Cross-platform: Linux verified (this run); Windows/macOS not
  attempted — see `docs/BUILD.md` for what each would need.
- Manual browser / desktop click-through checklists: still open
  (unchanged from Phases 7/8 — no live-browser or live-GUI tooling
  in this subagent session). Nothing in Phase 9 closes them.

## Verified results — Phase 8, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0, Node v24.22.1 / npm 10.9.4

Desktop app in `apps/desktop/` (Tauri 2.12.4 backend + React 19.3.1 +
TypeScript 7.0.2 + Vite 8.3.8 + Tailwind CSS 3.4.17 frontend; all
versions pinned exactly, including `@tauri-apps/api 2.12.4`,
`@tauri-apps/plugin-dialog 2.8.4`, `@tauri-apps/cli 2.12.4`). No
server anywhere; the backend calls `Engine` / `JobManager` directly.

- `npm test` — **11 passed, 0 failed** (2 files): `tauri.test.ts` 7
  (encodable-format filtering, decodable extensions, primary
  extension, labels, output paths incl. Windows separators,
  file/dir name splitting, byte formatting), `settings.test.ts` 4
  (defaults, round-trip, batch-worker clamp 1–8, quality clamp +
  bad-JSON fallback). Two real failures found and fixed on the way:
  a wrong sort expectation (`jpeg` sorts before `jpg`) and the
  settings tests needing jsdom for `localStorage` (the suite runs
  in jsdom, unlike the web app's node-only tests).
- `npm run build` — passes (`tsc -b && vite build`):
  `dist/index.html` 0.62 kB, `dist/assets/index-*.css` 12.76 kB,
  `dist/assets/index-*.js` 257.58 kB (gzip 77.82 kB). Three real
  build failures found and fixed on the way: an extra `)` in three
  checkbox handlers, an unused `settings` parameter in the options
  builder, and a `string` assigned to a `'strip' | 'preserve'`
  state. `npm run lint` (oxlint) — 0 warnings, 0 errors, 16 files.
- Backend (own workspace, `apps/desktop/src-tauri/`):
  `cargo fmt --all` + `cargo fmt --check` pass,
  `cargo clippy --all-targets -- -D warnings` passes,
  `cargo check` passes, `cargo test` — **16 passed, 0 failed**:
  logging 4 (UTC epoch + known date, log round-trip + tail, missing
  log reads empty), commands 12 (capabilities from the registry —
  21 formats, format parsing, option/pipeline validation, info /
  metadata / frames on a generated fixture, PNG→JPEG/WebP
  conversion with output re-detection, unencodable-target and
  missing-file rejection, resize-fit + grayscale processing, frame
  0 extraction + out-of-range rejection, a real 2-file batch via
  `JobManager` with 1 done / 1 failed, batch refusal rules,
  directory listing of decodable files only). Two real failures
  found and fixed on the way: `Metadata.has_exif` is a field, not a
  method, and a missing `&` on a `PathBuf`; clippy's
  `field_reassign_with_default` in two tests (rewritten as struct
  literals, not by weakening the lint).
- Rust workspace unchanged and green: `cargo fmt --all` +
  `cargo fmt --check` pass, `cargo clippy --workspace --all-targets
  -- -D warnings` passes, `cargo test --workspace` **171 passed, 0
  failed** (same as the Phase 7 baseline), `cargo build --release`
  succeeds (`target/release/openpixel`, 16 731 576 B).
- Capability match (manual check): `openpixel --json formats`
  lists 21 formats (16 decodable, 15 encodable); the backend test
  asserts 21 from `Engine::get_capabilities`, and the frontend
  fetches that same list live on every launch — the Formats tab and
  the output selectors cannot drift from the registry.
- Tauri build — **succeeds for the binary and the .deb; the
  .AppImage was produced by hand** (see below for the exact split):
  release binary `src-tauri/target/release/openpixel-desktop`
  (30 223 224 B, built in 15 m 41 s on first compile),
  `.deb` `src-tauri/target/release/bundle/deb/OpenPixel_0.1.0_amd64.deb`
  (9 665 496 B, package `open-pixel` 0.1.0, depends
  `libwebkit2gtk-4.1-0, libgtk-3-0`, icons at 4 sizes + desktop
  file inside), `.AppImage`
  `src-tauri/target/release/bundle/appimage/OpenPixel_0.1.0_amd64.AppImage`
  (80 046 584 B). Three real build failures found and fixed on the
  way: `core:asset:default` is not a permission in Tauri 2.12
  (removed — the asset protocol is covered by `core:default`); the
  hand-written icons lacked the PNG signature and were RGB, not
  RGBA (regenerated); the bundle category `Graphics & Design` is
  invalid (Tauri wants `Graphics and Design`); and the `bundle.icon`
  list was missing, so no icons were staged and the AppImage step
  panicked on "couldn't find a square icon" (added the list).
- `.deb` verified by installing it (`sudo dpkg -i`, package
  `open-pixel` 0.1.0, `/usr/bin/openpixel-desktop` present,
  `ldd` shows no missing libraries) and leaving it installed.
- App smoke test under Xvfb (no live-browser tooling in this
  session, so the app was run headless): `timeout 20 xvfb-run -a
  /usr/bin/openpixel-desktop` — the main process stayed alive with
  `WebKitNetworkProcess` and `WebKitWebProcess` children (the window
  and webview loaded), and the log file gained
  `2026-11-15T21:02:16Z [INFO] OpenPixel desktop started (offline mode)`.
  Only warnings were the Xvfb DRI3 software-rendering notices.
  No click-through of Convert/Batch/Formats/Settings/Logs was run
  in this environment (no live-GUI tooling for this subagent); the
  manual checklist below lists the flows to confirm on a real
  desktop before release.
- Environment findings during Phase 8 (all in `docs/DESKTOP.md`):
  the `-dev` packages for WebKitGTK/GTK cannot install via apt
  (`libzstd-dev` pins stock `libzstd1`, the image ships a
  Hatch-patched `+hatch1` build; downgrading a core library was
  refused) — the build used 104 downloaded -dev packages extracted
  into a sysroot at `~/.tauri-sysroot` with `PKG_CONFIG_PATH`;
  linking the backend test binary needed the runtime `.so.0`
  files copied into that sysroot (105 dangling `-dev` symlinks);
  the sysroot first lived in `/tmp` (512 MiB tmpfs) and starved the
  linker — the metadata doctest failed with `ld terminated with
  signal 7 [Bus error]` until the sysroot moved to `$HOME`
  (the doctest then passes in isolation, and the full suite is
  171/171 again — the failure was environmental, not a code
  failure); the AppImage step cannot run through `tauri build`
  here because the VM has no FUSE kernel module (`modprobe fuse`:
  module not found; `/dev/fuse` absent), so `linuxdeploy` was run
  by hand from its extracted AppImage (see `docs/DESKTOP.md`).
- Manual desktop checklist — NOT yet run on a real desktop (no
  live-GUI tooling in this subagent session); confirm before
  release: (1) launch the installed app, drop a PNG, convert to
  JPEG/WebP/TIFF and save via the native dialog — output
  re-detects as the target; (2) convert a JPEG with
  `--metadata preserve` equivalent (Preserve in the UI) to JPEG and
  confirm EXIF survives; (3) batch of 3+ files incl. one corrupt —
  corrupt fails with its error, the rest convert, pause/resume and
  retry-failed work; (4) Formats tab shows 21 formats with SVG
  decode-only and HEIC/HEIF/APNG/RAW/PSD unconvertible; (5) theme
  toggle light/dark/system persists across restart; (6) Logs tab
  shows the conversion lines and the log file path; (7) keyboard-only:
  tab to the drop zone, Enter opens the native picker; (8) drag a
  file onto the window from the file manager.

## Verified results — Phase 6, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce. System setup first:
`sudo ./scripts/setup/ubuntu-24.04.sh` (libdav1d-dev, as in Phase 5).

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **171 passed, 0 failed** (was 152):
  CLI 8 (4 unit, unchanged, + 4 integration: parallel batch with
  a corrupt file, sequential-vs-parallel agreement, `--workers 0`
  rejection, `bench --quick` table), codecs 25 (unchanged),
  core 36 (unchanged), formats 10 (unchanged), jobs **15 new**
  (11 unit + 1 doctest + 3 integration: bounded concurrency with
  a peak counter, pause/resume, cancel queued vs running,
  cancel-all, retry of a flaky job, failing file not aborting the
  batch, progress counts, wait-timeout on a paused queue;
  integration: 6 real images convert with 2 workers, 1 corrupt
  file fails while 4 succeed, over-limit job fails with
  `LimitExceeded`), metadata 47 (unchanged), pipeline 30
  (unchanged). Phase 5's 152 tests still pass unchanged.
- `cargo clippy --workspace --all-targets -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification on real Pillow fixtures in `/tmp/p6`
  (not checked in): 21 files — 9 PNG + 9 JPEG (800x600, random
  pixels), `photo.jpg` + `photo.png` (same stem), 1 corrupt PNG
  (valid signature + garbage).
  - `batch --format webp --quality 80 --workers 2` → `batch done:
    20 converted, 1 failed (2 workers)`; exit 0; corrupt file
    reported on stderr with its decode error; all 20 outputs
    exist; stem rule holds (`img0.webp` + `img0-png.webp`,
    `photo.webp` + `photo-png.webp`).
  - `batch --sequential` → same 20/1 with `(1 worker)`;
    `--json batch --workers 4` → same counts plus the failure
    list (`input` + `error`); `--workers 0` → exit 1 with
    `--workers must be 1..=8`.
  - `bench --iterations 3` (release) — see `docs/BENCHMARKS.md`
    for both runs: JPEG decode ~3 ms, PNG encode ~25 ms, WebP
    encode ~17 ms, AVIF encode ~9.3 s, large TIFF ~75–96 ms,
    12-file batch ~26–33 ms total (4 workers), peak RSS 70.2 MiB
    in both runs.
- Bugs / findings during Phase 6: a full `bench` run from the
  debug test binary took ~224 s (AVIF encode in debug), so the
  suite gained a `--quick` mode (small fixtures) and the CLI
  integration test uses it — debug timings are not comparable
  to release and the report says so. `clippy::manual_clamp`
  (`.min(4).max(1)` → `.clamp(1, 4)`) and `print_literal` in
  the bench table header were fixed in the code, not by
  weakening the lint config. `--pause-after N` was not added:
  in a non-interactive CLI run a paused queue has nothing to
  wait for except an immediate resume.

## Verified results — Phase 5, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce. System setup first:
`sudo ./scripts/setup/ubuntu-24.04.sh` installs `libdav1d-dev`
(AVIF decode — the only system library Phase 3 needs). Note: during
Phase 5 verification the package had gone missing from this machine
(runtime `libdav1d7` 1.4.1 still present); test binaries failed to
link with `unable to find library -ldav1d` until it was restored
(`sudo apt-get install libdav1d-dev`, 1.4.1-1build1, exact match).
If a fresh checkout fails to link test binaries, run the setup
script first.

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **152 passed, 0 failed** (was 89):
  CLI 4 (new: metadata-policy flag resolution), codecs 25 (22 unit +
  3 adapter round-trip, unchanged), core 36 (30 unit + 6 integration;
  new: metadata read, policy strip vs preserve, orientation
  normalisation, GIF frames, TIFF pages, frame extraction,
  `to-srgb` + ICC-drop behaviour), formats 10 (unchanged), metadata
  47 (46 unit + 1 doctest — exif 5, extract 8, icc 7, orientation 7,
  frames 11, policy 8), pipeline 30 (29 unit + 1 doctest,
  unchanged). Phase 4's 89 tests still pass unchanged.
- `cargo clippy --workspace --all-targets -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification on real Pillow fixtures in `/tmp/p5`
  (not checked in): `exif.jpg` 64x48 (EXIF orientation 6, Canon
  EOS R50, 2026:11:15 10:30:00, GPS 23.81028,90.41250, sRGB ICC
  588 B) + `exif_xmp.jpg` (same + XMP), `orient_2..8.jpg`,
  `anim.gif` / `anim.webp` / `apng.png` (32x24, 3 frames, delays
  100/200/300 ms), `multi.tiff` (2 pages, grey 10/200),
  `adobe.jpg` (Adobe RGB ICC 604 B), `badexif.jpg` (garbage EXIF).
  - `metadata exif.jpg` reads orientation 6, Canon EOS R50, GPS,
    sRGB ICC; `info` shows orientation 6, exif/icc yes, xmp no.
  - JPEG-to-JPEG `--metadata preserve` round-trips EXIF + ICC +
    XMP and the output re-reads identically; JPEG-to-PNG preserves
    EXIF + ICC; default (strip) drops everything; JPEG-to-TIFF
    `--metadata preserve` warns and drops exif + icc with reasons.
  - Orientation 6 normalises 64x48 to 48x64 with the tag gone;
    orientations 2-8 all match Pillow `ImageOps.exif_transpose`
    (at most 2 of 3 072 pixels off by more than 12/255 -- JPEG
    re-encode noise at the fixture's hard quadrant edge, not a
    mapping error; dimensions exact), including 5 (transpose) vs
    7 (transverse).
  - `frames anim.gif` lists 3 frames, delays 100/200/300 ms, loop
    forever; `extract-frame --frame 1` gives green (0,255,0),
    `--frame 2` blue (0,0,255); `convert anim.gif flat.png` warns
    about the animated source and keeps frame 0 (red). `frames`
    on `anim.webp` / `apng.png` lists 3 frames each;
    `extract-frame apng.png --frame 1` fails cleanly with exit 1
    (frame info only). `frames multi.tiff` lists 2 pages;
    `extract-frame --frame 1` gives grey 200.
  - `convert adobe.jpg --to-srgb` changes pixels (mean R 125 to
    118) and drops the Adobe ICC; on the sRGB `exif.jpg` it is a
    no-op (mean unchanged). `--to-srgb --metadata preserve` on
    `adobe.jpg` converts the pixels and drops the ICC with a
    warning (the profile no longer describes the pixels).
  - `convert badexif.jpg` succeeds with a warning, no crash.
  - `--json` output parses.
- Bugs found and fixed during Phase 5: the CRC-32 test constant
  for "IEND" was wrong in the test (`0xAE42_6001`, implementation
  correct at `0xAE42_6082`); a TIFF page-count walk accepted an
  IFD claiming 65 280 entries in 3 bytes (now requires the IFD
  structure to fit in the file); GIF partial frames built via a
  bare `Frame` struct failed `MissingColorPalette` (must use
  `Frame::from_rgba`); tintbox zeroes alpha without
  `Flags::COPY_ALPHA` on RGBA transforms; combining `--to-srgb`
  with `--metadata preserve` used to keep the stale Adobe ICC
  (now dropped with a warning); `frames` labelled a multi-page
  TIFF "(animated)" (now "(multi-page)"); EXIF tag 0x013B (Artist)
  was mis-mapped to `software` -- 0x0131 is Software, 0x013B is
  now reported as `artist` (found by the `--json` output of the
  regenerated fixtures).

## Verified results — Phase 4, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce.

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **89 passed, 0 failed** (was 50):
  formats 10 (unchanged), codecs 25 (22 unit + 3 adapter
  round-trip, unchanged), core 21 (15 unit + 6 integration; new:
  `process` resize+grayscale+rotate combined with pixel checks,
  empty-pipeline == convert, `convert_with_pipeline` alias,
  `process_to_path`, bad pipeline writes no output, `decode_file`;
  integration: combined pipeline end-to-end with JPEG grey check,
  watermark + `PipelineSpec` order), pipeline 30 (29 unit + 1
  doctest — dimensions after every resize/fit/fill/pad/crop/
  thumbnail/rotate/flip, pixel checks for grayscale, brightness
  direction, flip mirroring, crop content, watermark presence and
  50% blending, flatten onto background, operation ordering,
  metadata survival, and errors for resize-to-0, out-of-bounds
  crop, oversize result, out-of-range values, oversize watermark),
  CLI 3 (parse helpers for dimensions/crop/`--op`/watermark
  position). Phase 3's 50 tests still pass unchanged.
- `cargo clippy --workspace -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification on a real 64×48 RGBA Pillow fixture
  (`/tmp`, not checked in): `process --resize 32x24` → `info`
  32×24; `--rotate 90` → 48×64; `--grayscale` to JPEG → all 3 072
  pixels grey (tolerance 2); combined `--resize 32x24 --grayscale
  --rotate 90` → 24×32 luma_alpha8; `--op crop:0,0,32,24 --op
  flip-h --op grayscale` → 32×24; `--watermark` logo → bottom-right
  pixel exactly (255,0,0); `--rotate 45` → 80×80 bounding box;
  `--thumbnail 16` → 16×12; `--pad 80x60` → 80×60; `--resize-fill
  32x32` → 32×32; `--flatten` to JPEG → rgb8; combined blur +
  sharpen + saturation 0 + contrast + brightness -0.1 + flip-v +
  rotate -45 → 80×80; `--json` output parses. Error cases exit 1
  with a clean typed message and no output file: crop out of
  bounds, resize 0, brightness 2.0, mixing `--op` with flags.
- Bugs found and fixed during Phase 4: image-rs `thumbnail` and
  `resize` upscale a smaller image, so `ResizeFit`/`Thumbnail`
  now guard against upscaling (and `output_dimensions` simulates
  the same rule); a derived `Default` for `Pipeline` set both
  limits to 0 and rejected every image, so `Default` is now
  hand-written to delegate to `new()`; clap rejected negative
  numbers (`--brightness -0.1`), so the `process` subcommand sets
  `allow_negative_numbers`; clippy's `large_enum_variant` on the
  `Process` CLI variant is allowed locally with a comment — boxing
  the `Vec` field is impossible because clap has no value parser
  for `Box<Vec<String>>`.

## Verified results — Phase 3, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce. System setup first:
`sudo ./scripts/setup/ubuntu-24.04.sh` installs `libdav1d-dev`
(AVIF decode — the only system library Phase 3 needs).

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **50 passed, 0 failed**: formats 10
  (detection 6 incl. the new strict SVG sniff + discovery 4),
  codecs 25 (registry 3 + adapter round-trips 3 + new-codec unit
  tests 19: SVG 5, AVIF 3, JXL 3, HDR 3, EXR 2, JPEG 2000 3),
  core 15 (unit 11 incl. SVG→PNG + AVIF round-trip through the
  engine + integration 4). Phase 2's 29 tests still pass unchanged
  in behaviour except the two that named AVIF as unimplemented
  (now HEIC) and the registry counts (16 codecs, 5 planned).
- `cargo clippy --workspace -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification: `info`/`discover`/`convert` on real
  generated AVIF, JXL, EXR, HDR, JP2 and SVG files (see below);
  `formats` still lists 21 formats, now with 15 fully implemented
  (decode+encode) and SVG decode-only; `capabilities heic`
  correctly reports decode=no / encode=no.
  - One 64×48 RGBA Pillow fixture converted to all five new
    formats and back to PNG: round-trip MAE vs the original —
    AVIF 0.47 (lossy), JXL 0.00, EXR 0.00, JP2 0.00, HDR 0.00 on
    opaque pixels (the semi-transparent region flattens onto
    white by design, as documented).
  - Independent tools confirmed the outputs: `file(1)` reports
    "ISO Media, AVIF Image", "JPEG XL codestream", "OpenEXR image
    data", "Radiance HDR image data", "JPEG 2000 Part 1 (JP2)";
    `heif-info` (libheif) reads our AVIF as 64×48, YCbCr 4:4:4,
    8-bit, with alpha; real OpenJPEG `opj_decompress` decodes our
    JP2 byte-exact (0 mismatches in 12 288 bytes); Pillow reads
    our JP2 directly with exact pixels.
  - SVG: yellow background + blue circle rasterise to the exact
    expected pixels; a 100 000×100 000 SVG is scaled to
    10 000×10 000 by the pixel cap, not rejected; `discover` on an
    AVIF named `.jpg` reports avif/Signature/High with a mismatch
    warning; a truncated AVIF fails with a clean typed error
    (`UnexpectedEOF`), not a crash; `batch` converted 3 files
    (PNG, JPG, SVG) to AVIF with 0 failures; `convert x.png
    x.heic` fails cleanly with "cannot be encoded in this build
    (planned — detection only)".
- Bugs found and fixed during Phase 3: OpenJPEG's default 6
  resolutions need each side ≥ 32 px, so small images failed
  `start_compress` — the JP2 encoder now scales the resolution
  count to the image size; HDR decode always yields Rgba8 in
  Phase 3 (float → Rgba8), so the alpha-flatten test checks the
  flattened colour instead of `has_alpha`; a 100 000×100 000 SVG
  lands at 10 000×10 000 because the 100 MP pixel cap dominates
  the 16 384 px side cap.

## Verified results — Phase 2, 15 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce.

- `cargo build --release` — succeeds, binary `target/release/openpixel`.
- `cargo test --workspace` — **29 passed, 0 failed**: formats 9
  (detection 5 + discovery 4), codecs 6 (registry 3 + adapter
  round-trips 3), core 14 (unit 10 + integration 4). Phase 1's 17
  tests still pass unchanged in behaviour.
- `cargo clippy --workspace -- -D warnings` — passes.
  `cargo fmt --check` — passes.
- Manual CLI verification: `discover` on a PNG named `.jpg` reports
  format png, method Signature, confidence High, with a mismatch
  warning; `formats` still lists 21 formats from the dynamic
  registry; conversions unchanged from Phase 1.
- Bugs found and fixed during Phase 2: image-rs writes RGBA PNM as
  PAM (P7), which detection rejected — P7 is now recognised as PNM;
  `Decoder`/`Encoder` both defining `format()` was ambiguous, so
  the format is now reported once, on `Decoder`.

## Verified results — Phase 1, 15 Nov 2026, Ubuntu 24.04, Rust 1.100.0

Re-run `cargo test --workspace` to reproduce.

- `cargo build --release` — succeeds, binary `target/release/openpixel`
  (2.9 MB), no errors, no warnings after the final cleanup.
- `cargo test --workspace` — **17 passed, 0 failed**: 13 unit tests
  (format detection, security limits, engine round-trips) + 4
  integration tests (all-format round-trip, extension-not-trusted,
  corrupted-file, JPEG quality). Two real bugs were found and fixed
  during this run: TGA has no magic bytes (header sniff added +
  output validation exempted), and batch files sharing a stem
  (`photo.jpg` + `photo.png`) overwrote each other (now suffixed
  with the source extension).
- Manual CLI verification on a real 64×48 RGBA image (Pillow):
  `info` PNG (rgba8, alpha yes) and JPEG (rgb8, alpha no);
  PNG→WebP (171 → 206 bytes), PNG→JPEG white background
  (171 → 1 106 bytes), JPEG→BMP, JPEG→PNG — all re-detected by
  `info` and confirmed by `file(1)`; `formats` lists 21 formats
  with honest statuses; `capabilities avif` correctly reports
  decode=no / encode=no; AVIF conversion and a non-image file
  both fail with a clean typed error and exit code 1; `batch`
  converted 2 files, 0 failed.

## Not yet tested (later phases)

- Fuzz tests — **done in Phase 9** (`cargo-fuzz` on detection +
  decode + metadata; see "Verified results — Phase 9" above and
  `crates/openpixel-codecs/fuzz/README.md`). A longer fuzz run
  (hours, more seeds per format) is still future work.
- Large-image / memory benchmarks — done in Phase 6 (see
  `docs/BENCHMARKS.md`). Still open: APNG / animated WebP frame
  extraction beyond frame 0, metadata preservation to targets
  other than JPEG/PNG, ICC conversion for non-RGB profiles and
  16-bit pixels, IPTC reading, > 64 KiB ICC chunking test.
- Corrupted-file corpus (`tests/corrupted-files/`) — folder still
  exists but is empty; the Phase 9 fuzz seed corpus lives in
  `crates/openpixel-codecs/fuzz/corpus/` instead (small real files
  + truncated PNG + garbage). A checked-in corrupted-file corpus
  for the integration suite is still open.

## Test fixtures

Integration fixtures are generated in-code (no binary fixtures checked
in yet) so the suite is reproducible from a clean checkout.
`tests/fixtures/` is reserved for checked-in real-world images in
later phases. Exception: the HEIC/HEIF follow-up (16 Nov 2026)
checked in Apple `sips`-encoded HEIC fixtures under
`crates/openpixel-codecs/tests/fixtures/` (MIT OR Apache-2.0, see
its README for provenance) because the VM's `heif-enc` cannot
produce a HEIC file at all — there is no other local source of
real-world HEIC bytes.
