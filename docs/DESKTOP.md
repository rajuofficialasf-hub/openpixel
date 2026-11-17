# Desktop Application — OpenPixel Engine (Phase 8, draft — coordinator verifies)

Tauri 2 desktop app in `apps/desktop/` (React 19 + TypeScript + Vite +
**MUI 7** frontend — the Tailwind CSS 3 frontend was replaced in
Studio Phase 7, see "MUI migration (Phase 7)" below — Rust backend
crate `openpixel-desktop` in `src-tauri/`). The backend calls
`openpixel-core`'s `Engine` and `openpixel-jobs`' `JobManager`
directly — the same code the CLI uses.
No conversion logic lives in the frontend and none is duplicated in
the backend: the frontend only sends file paths + options, the
backend only wraps engine calls. There is no server, no upload, no
account and no network request anywhere; the UI states the offline
mode in the header badge, in Settings / About and in the footer.

## Layout

```
apps/desktop/
  package.json            # frontend deps, all pinned exactly
  src/
    App.tsx               # tabs, theme, native drag-and-drop listener
    theme/theme.ts        # MUI design system (Phase 7 — copied from
                          #   apps/web/src/theme/theme.ts, same tokens)
    components/
      ConvertWorkspace.tsx  # pick/drop, preview, info/metadata/frames,
                            #   output + quality/background/metadata,
                            #   processing, frame extraction, save dialog
      BatchWorkspace.tsx    # file/folder pick, per-file target, worker pool,
                            #   progress polling, pause/resume/cancel/retry
      CapabilitiesTable.tsx # live registry table (21 formats)
      SettingsPanel.tsx     # theme, defaults, batch workers, About
      LogsView.tsx          # log tail + log file path
      DropZone.tsx          # picker button + visible drop target
      pdf/PdfWorkspace.tsx  # Phase 7: picker + 23 focused PDF/OCR/
                            #   document tool pages (see below)
    lib/
      tauri.ts            # typed invoke wrappers + pure path/format helpers
                          #   (Phase 7: PDF/OCR/document wrappers)
      settings.ts         # on-device settings (localStorage)
  src-tauri/
    Cargo.toml            # backend crate (its OWN workspace — see below)
                          #   Phase 7: [features] default=["native-ocr"]
    Cargo.lock            # backend lockfile
    tauri.conf.json       # window, CSP, bundle targets (deb, appimage)
    capabilities/default.json  # Tauri 2 permissions
    src/
      lib.rs              # Tauri builder: dialog plugin, state, commands
      commands.rs         # Tauri commands (thin Engine / JobManager wrappers)
      pdf_commands.rs     # Phase 7: 20 PDF/OCR/document commands
      logging.rs          # append-only log file (std only, no date crate)
```

## Why the backend is not a root workspace member

`apps/desktop/src-tauri/Cargo.toml` carries its own `[workspace]`
table on purpose. Tauri 2 pulls a GUI toolkit (WebKitGTK/GTK on
Linux) and an async runtime into the build; making it a root member
would make `cargo test --workspace` link the GUI libraries and
compile the whole Tauri tree for every engine test run. The engine
workspace therefore stays exactly as it was (171 tests, same
commands), and the backend has its own lockfile and its own commands:

```bash
# from apps/desktop/src-tauri/
cargo fmt --all && cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo check
```

## Tauri commands (src-tauri/src/commands.rs)

| Command | Engine call behind it |
|---|---|
| `app_info` | `Engine::get_capabilities` (count) + version + log path |
| `get_capabilities` | `Engine::get_capabilities` (live registry — 21 formats) |
| `get_image_info` | `Engine::get_image_info` |
| `read_metadata` | `Engine::read_metadata` |
| `list_frames` | `Engine::list_frames` |
| `list_directory_images` | directory scan, extension filtered by `ImageFormat::from_name` |
| `convert_file` | `Engine::convert` |
| `process_file` | `Engine::process` (resize-fit, rotate 90/180/270, flip, grayscale) |
| `extract_frame` | `Engine::extract_frame_to_path` |
| `start_batch` / `batch_progress` / `batch_jobs` / `batch_results` / `batch_pause` / `batch_resume` / `batch_cancel` / `batch_cancel_all` / `batch_retry_failed` | `JobManager::for_engine` (workers 1–8) + the manager's own methods |
| `read_logs` | tail of the log file |

Validation happens before the engine is called (`build_options` /
`build_pipeline` in `commands.rs`): quality 1–100, PNG compression
0–2, background `white` / `black` / `#RRGGBB` (via the engine's own
`parse_background`), metadata policy names via
`MetadataPolicy::from_name`, rotation only 90 / 180 / 270. Every
conversion and every error is appended to the log.

The `do_*` functions are the testable core (they take an `&Engine`
and return plain results); the `#[tauri::command]` wrappers only add
state lookup and logging. Batch state is one `JobManager` at a time
on `AppState`: a new batch is refused while the previous one still
has non-terminal jobs, and a finished batch is replaced (its manager
is shut down first).

## MUI migration (Phase 7, 17 Nov 2026)

The desktop frontend moved from Tailwind CSS 3 to the web app's MUI
design system (commit `1b911ac`), so the desktop and the web app now
share one look instead of two parallel ones.

What changed:

- `src/theme/theme.ts` — the design system, **copied from
  `apps/web/src/theme/theme.ts`** (same tokens, kept independent —
  do not import across apps). Source of the tokens: the Studio
  master design prompt §5–7, adopted in Studio Phase 6: primary
  `#3157D5` (light) / `#829BFF` (dark), secondary slate `#64748B`,
  background `#F7F8FC` (light) / `#0B1020` (dark), 8px spacing
  scale, 12px card radius, Inter + Noto Sans Bengali self-hosted
  via `@fontsource` (imported in `main.tsx`, no webfont CDN).
  `App.tsx` still toggles the `dark` class on `<html>` because the
  web e2e suite asserts on it, not because the theme needs it.
- `tailwind.config.js` and `postcss.config.js` **deleted**;
  `tailwindcss` / `autoprefixer` / `postcss` removed from
  `package.json`. Added (all pinned exactly): `@mui/material` +
  `@mui/icons-material` 7.3.11, `@emotion/react` 11.14.0,
  `@emotion/styled` 11.14.1, `@fontsource/inter` +
  `@fontsource/noto-sans-bengali` 5.3.0.
- Every tab was rewritten in MUI (`App.tsx`, `ConvertWorkspace`,
  `BatchWorkspace`, `CapabilitiesTable`, `SettingsPanel`,
  `LogsView`, `DropZone`): same element ids / labels and the same
  behaviour, so the existing tests and flows did not change — the
  offline badge and the "no server, no account" statements are
  kept. Nothing in `src/components/` hard-codes a brand colour or
  a hex value: colours come from `theme.palette`, `sx`, or the
  component overrides in `theme.ts`.
- The desktop keeps its own `index.css` (10 lines — font imports
  and the root layout only); all component styling is MUI `sx` /
  theme overrides.

## PDF / OCR / document commands (Phase 7, `src-tauri/src/pdf_commands.rs`)

Twenty new Tauri commands (commit `441019f`), same pattern as
`commands.rs`: the `do_*` functions are the testable core (bytes in
/ bytes or outcomes out, no Tauri state) and the `#[tauri::command]`
wrappers only add file I/O, state lookup and logging. The backend
calls `openpixel-pdf` / `openpixel-ocr` / `openpixel-documents`
directly — no conversion logic lives in the frontend.

| Command | Engine call behind it |
|---|---|
| `get_desktop_capabilities` | Runtime probe, not an engine call: `TesseractEngine::new()` + `available_languages()` (Tesseract, compile-time feature `native-ocr` — see "Android notes"), `LibreOffice::discover()` + `version()` (LibreOffice), `pdfium_present` is always false in this build (the `pdfium` feature is off — see below) |
| `pdf_info` | `PdfEngine::inspect` |
| `pdf_inspect` | `PdfEngine::inspect_threats` (JavaScript, embedded files, auto-actions) |
| `pdf_merge` | `PdfEngine::merge` + `page_count` on the result |
| `pdf_split` | `PdfEngine::split` (page ranges) + `page_count` per part |
| `pdf_page_op` | One command, eight ops, all on `PdfEngine`: `extract`, `remove`, `reorder`, `duplicate`, `reverse`, `booklet`, `nup`, plus rotate (90/180/270) — the frontend exposes each op as its own tool page |
| `pdf_compress` | `PdfEngine::compress` (`CompressMode`, downsamples embedded images, never returns a larger file as "compressed") |
| `pdf_edit` | `PdfEngine::edit` (text overlays, page numbers, header/footer; existing text is never edited in place) |
| `pdf_redact` | `PdfEngine::redact` (really removes the text from the file bytes) |
| `pdf_flatten` | `PdfEngine::flatten` (annotations rendered into page content) |
| `pdf_set_metadata` | `PdfEngine::set_metadata` (title, author, subject, keywords) |
| `pdf_sanitize` | `PdfEngine::sanitize` (strips JavaScript / embedded files / auto-actions) |
| `pdf_repair` | `PdfEngine::repair` (damaged cross-reference table) |
| `pdf_extract_text` | `PdfEngine::extract_text` + `PdfEngine::text_to_txt` / `text_to_html` / `text_to_epub` / `text_to_docx` — **needs libpdfium, fails honestly in this build** |
| `pdf_from_images` | `PdfEngine::from_images` (one page per image) + `Engine::decode_bytes` per input image |
| `pdf_to_images` | `PdfEngine::render_to_images` + `Engine::convert` per rendered page — **needs libpdfium, fails honestly in this build** |
| `ocr_recognize` | `Engine::decode_bytes` then `TesseractEngine::recognize` (cfg-gated on `native-ocr` — with the feature off it returns the honest "OCR is not available in this build" error) |
| `pdf_ocr_searchable` | `TesseractEngine::searchable_pdf` over `SearchablePage`s (cfg-gated the same way; PDF inputs also need libpdfium rendering first) |
| `doc_convert` | `DocumentEngine::convert` (LibreOffice when present; the PDF-text path for txt→pdf; honest error when neither applies) |
| `doc_formats` | `DOCUMENT_CONVERSIONS` registry from `openpixel-formats` (no engine call) |

Honesty rules, carried over from the CLI (see the module docs in
`pdf_commands.rs`):

- `openpixel-pdf` is built **without** the `pdfium` feature, so
  `pdf_extract_text` and `pdf_to_images` (and PDF-input
  `pdf_ocr_searchable`) return the engine's clear "needs libpdfium"
  error — never an empty result. Phase 8 ships the libpdfium
  binary.
- Tesseract and LibreOffice are **runtime probes, never
  compile-time claims**: `get_desktop_capabilities` reports what
  this machine actually has right now (see "Capability matrix"
  below), and the UI shows the matching warning on the tools that
  need them instead of letting the command fail silently.

Frontend wrappers for all twenty live in `src/lib/tauri.ts`
(`fetchDesktopCapabilities`, `fetchPdfInfo`, `fetchPdfThreats`,
`pdfMerge`, `pdfSplit`, `pdfPageOp`, `pdfCompress`, `pdfEdit`,
`pdfRedact`, `pdfFlatten`, `pdfSetMetadata`, `pdfSanitize`,
`pdfRepair`, `pdfExtractText`, `pdfFromImages`, `pdfToImages`,
`ocrRecognize`, `pdfOcrSearchable`, `docConvert`,
`fetchDocFormats`) plus pure helpers `parsePageList`,
`parseRanges`, `clampPages` (vitest: `src/lib/pdf.test.ts`).

## Desktop PDF UI (Phase 7)

The PDF tab (`src/components/pdf/PdfWorkspace.tsx`, 1255 lines)
follows the web app's per-tool pattern (one focused page per tool —
never all operations of a category crammed onto one page): the user
first picks a tool from the picker grid, then only that tool's page
shows — upload, settings, one primary action, result + download.
The picker holds **23 tools** in three groups:

- **PDF (20):** Merge, Split, Rotate pages, Extract pages, Remove
  pages, Reorder pages, Duplicate pages, Reverse order, Booklet
  imposition, N-up layout, Compress, Edit (add content), Redact,
  Edit metadata, Sanitize / inspect, Flatten, Repair, Extract text,
  Images to PDF, PDF to images.
- **OCR (2):** OCR an image, Searchable PDF.
- **Documents (1):** Convert document.

Notes:

- The eight page operations (rotate / extract / remove / reorder /
  duplicate / reverse / booklet / n-up) share the single
  `pdf_page_op` backend command; each is its own picker card and
  its own focused page in the UI.
- The two `needsPdfium` tools (Extract text, PDF to images) show
  the warning *"Rendering and text extraction need libpdfium, which
  this build does not ship yet (Phase 8). Running this tool will
  fail with that explanation — it never returns a fake result."*
- The OCR tools show the Tesseract version and installed languages
  from `get_desktop_capabilities` when present, and an install
  hint when absent; the document tool shows the same for
  LibreOffice.
- Drag-and-drop into the PDF tab appends dropped PDF/image paths
  to the open tool's file list (`droppedPaths` from `App.tsx`).
- **Not in the desktop PDF UI:** the web's PDF Edit undo/redo
  (Phase 7 web item) was not ported — the desktop Edit tool applies
  overlays in one shot with no undo stack. The web's Bengali UI
  strings were also not ported — the desktop UI stays English
  (the Noto Sans Bengali font is bundled for text content).

## Capability matrix — runtime probes

`get_desktop_capabilities` returns `DesktopCapabilities`, reported
honestly per machine — the UI and the tests read it, nothing is
claimed at compile time:

| Field | What it reports | This VM (17–18 Nov 2026) |
|---|---|---|
| `pdfium_present` | The `pdfium` feature is compiled in **and** a libpdfium binary was found | `false` — feature off by design; Phase 8 ships the binary |
| `tesseract_present` | `TesseractEngine::new()` succeeded (feature `native-ocr` on **and** libtesseract + tessdata installed) | `true` — Tesseract 5.3.4, languages `eng`, `ben` (and `osd`) |
| `tesseract_version` | `TesseractEngine::version()` | `"5.3.4"` |
| `tesseract_languages` | `TesseractEngine::available_languages()` | `["ben", "eng", "osd"]` (order as returned) |
| `libreoffice_present` | `LibreOffice::discover()` found an install | `true` — LibreOffice 24.2.7.2 |
| `libreoffice_version` | `LibreOffice::version()` | `"24.2.7.2"` |

With `native-ocr` off (the Android path) the probe reports
`tesseract_present: false`, `version: None`, `languages: []`, and
the two OCR commands return the honest "OCR is not available in
this build" error — never a panic, never a fake result (backend
test `ocr_commands_fail_honestly_without_the_feature`).

The format capability table (`get_capabilities`, 21 formats) is
unchanged by Phase 7 and is still read from the engine on every
launch.

## Android notes (Phase 7 — mobile validation findings, DECISIONS for the user)

The desktop agent does not own the Android build; this section
records what the mobile-validation agent found, so the decisions
are in one place.

- **dav1d-sys blocker — DECISION NEEDED, do not fix silently.**
  `tauri android build` fails at `dav1d-sys` 0.8.3: it has no meson
  cross-file for the Android target, so the dav1d C build cannot
  run. The failure is **not** in the desktop crate: an experiment
  with desktop-only dependencies still failed, because Cargo
  feature unification re-enables `native-avif` (via
  `openpixel-jobs` → `openpixel-core` defaults) for every consumer
  in the same resolve — including the desktop crate's own
  `default-features = false` on `openpixel-core`, which on its own
  changes nothing while any other dependency still enables the
  core defaults. Removing dav1d for Android needs a **workspace-level
  jobs change** (a way for the Android build to resolve
  `openpixel-jobs` without the core's default features — e.g. a
  `no-avif` feature on `openpixel-jobs` that the Android target
  selects, or splitting the AVIF default out of the core). That
  change was **not** made here: it touches the shared engine
  workspace and the CLI, and it is the user's call. Until it is
  made, Android builds fail at `dav1d-sys` regardless of what the
  desktop crate does.
- **API 37 template note.** Tauri 2.12.4's generated Android
  project targets the then-unreleased Android API 37. The
  generated project in this checkout (`src-tauri/gen/android/`,
  gitignored — `apps/desktop/.gitignore`) was edited to
  `compileSdk = 36` / `targetSdk = 36` (`minSdk = 24`,
  `applicationId = "dev.openpixel.desktop"`). Because `gen/` is
  not committed, a fresh `tauri android init` regenerates API 37
  and the 37→36 edit has to be re-applied.
- **cfg-gating of `native-ocr` (done, verified).** The desktop
  backend crate now has `[features] default = ["native-ocr"]`,
  `native-ocr = ["openpixel-ocr/native-ocr"]`, and
  `openpixel-core` with `default-features = false` (see the NOTE
  in `apps/desktop/src-tauri/Cargo.toml` — the AVIF note above).
  In `pdf_commands.rs` every use of `TesseractEngine` /
  `SearchablePage` is cfg-gated: the imports, the capability probe,
  and the two touch points (`recognize_with_tesseract`,
  `searchable_pdf_bytes`), each with a `#[cfg(not(feature =
  "native-ocr"))]` stub returning the honest error. Verified both
  ways from `apps/desktop/src-tauri/`: `cargo check` (default
  features) and `cargo check --no-default-features` both pass, and
  `cargo test --no-default-features` passes (27 tests, including
  `ocr_commands_fail_honestly_without_the_feature` and
  `capabilities_report_no_tesseract_without_the_feature`). The
  host-side `--no-default-features` check is the verification for
  the gating half — the full `tauri android build` was **not**
  re-run (it still fails at dav1d-sys, see above).
- **AVIF decode survives the `default-features = false` change.**
  Verified, not just trusted from the NOTE: `cargo tree -e
  features` shows `openpixel-core feature "native-avif"` enabled
  in the desktop build (unification via `openpixel-jobs`), and the
  backend test `avif_roundtrip_still_works_after_core_default_features_off`
  (in `commands.rs`) encodes a fixture PNG to AVIF and decodes it
  back through the desktop `Engine` — it passes. The desktop keeps
  AVIF decode; Android keeps failing at dav1d-sys for the same
  reason.

## Features and their honest limits

- **Native file picker**: open file (filters from the decodable
  registry extensions) and open folder (native directory dialog +
  `list_directory_images`, non-recursive, decodable files only).
- **Drag-and-drop**: the window has `dragDropEnabled: true`; `App.tsx`
  listens for `tauri://drag-drop` — Convert takes the first dropped
  path, Batch takes all of them.
- **Preview**: `convertFileSrc` (asset protocol) shows the source
  image; formats the webview cannot render (e.g. TIFF) show a note
  that the info below comes from the engine, not from a failed load.
- **Conversion**: the full engine — all 15 encodable formats, not
  the web app's canvas subset. Quality applies to JPEG/WebP/AVIF
  only; metadata preservation is byte-exact for JPEG/PNG targets
  only (the result lists what was preserved and what was dropped);
  animated sources convert the first frame unless a frame is
  selected.
- **Processing**: resize-fit (never upscales), grayscale, rotate
  90/180/270, flip. Arbitrary rotation is an engine operation but is
  not exposed in this UI yet.
- **Batch**: worker pool 1–8 (default 4, from Settings), live
  progress polling (500 ms), per-file status + error, pause (queue
  only — a running decode/encode is never interrupted, same rule as
  the CLI), resume, cancel-one (queued only), cancel-all-queued,
  retry-failed. A failed file never stops the batch.
- **Formats view**: the capability table is read from the engine on
  every launch — it cannot drift from `openpixel formats`.
- **Settings**: theme, default quality/format/background/metadata
  policy, batch workers, reset. Persisted in localStorage under
  `openpixel.desktop.settings.v1`.
- **Logging**: `openpixel-desktop.log` under the app data directory
  (`<app_data_dir>/logs/` on Linux: `~/.local/share/dev.openpixel.desktop/logs/`),
  UTC timestamps, one line per conversion / batch event / error. The
  Logs tab shows the tail (default 200 lines) and the path.
- **Offline**: no network code at all. The CSP in
  `tauri.conf.json` is `default-src 'self'` plus the asset protocol
  for local previews.

## What is not in this build

- Windows / macOS installers — Linux `.deb` + `.AppImage` only (see
  "Build" below). Cross-platform bundles need those toolchains.
- Arbitrary rotation in the UI (engine supports it; UI exposes
  90/180/270 only).
- In-app update checks (offline by design).
- An `.icns` icon for macOS (Linux bundles do not need it).

## Build

### System libraries (Ubuntu 24.04)

Tauri 2 on Linux needs WebKitGTK + GTK + a few companions. The
runtime libraries install cleanly; the **-dev packages do not** on
this VM — see "The libzstd-dev block" below for the exact failure
and the workaround that produced the build.

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libgtk-3-dev libsoup-3.0-dev
```

### Frontend

```bash
cd apps/desktop
npm install
npm test          # vitest: settings + format helpers
npm run build     # tsc + vite -> dist/
```

### Backend (own workspace)

```bash
cd apps/desktop/src-tauri
cargo fmt --all && cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo check
```

### Full desktop build (installers)

```bash
cd apps/desktop
npm run tauri build
# -> src-tauri/target/release/bundle/deb/openpixel_0.1.0_amd64.deb
# -> src-tauri/target/release/bundle/appimage/openpixel_0.1.0_amd64.AppImage
```

On this VM the `.deb` builds through `tauri build` but the
`.AppImage` step cannot run inside `tauri build` (no FUSE kernel
module — see `docs/DESKTOP.md`); the AppImage was produced by
running the extracted `linuxdeploy` by hand, same output, same
name. On a machine with FUSE, plain `npm run tauri build` produces
both bundles with no workaround.

Dev mode: `npm run tauri dev` (Vite on http://localhost:1420).

## The libzstd-dev block (this VM, 16 Nov 2026)

`apt-get install libwebkit2gtk-4.1-dev` (and `libgtk-3-dev`,
`librsvg2-dev`, `libappindicator3-dev`) fails with held broken
packages:

```
libzstd-dev : Depends: libzstd1 (= 1.5.5+dfsg2-2build1.1)
but 1.5.5+dfsg2-2build1.1+hatch1 is to be installed
```

The VM image ships `libzstd1` as a Hatch-patched build
(`1.5.5+dfsg2-2build1.1+hatch1`, priority 100 from dpkg status),
while Ubuntu's `libzstd-dev` pins the stock version exactly.
Downgrading `libzstd1` to stock was **not** done: it is linked by
systemd, apt, curl, libsystemd and others, and the patched build is
presumably intentional in this image — downgrading a core library
to unblock a -dev package is out of scope for this phase.

What installed cleanly via apt: `patchelf` 0.18.0, `libsoup-3.0-dev`
3.4.4, and the **runtime** libraries `libwebkit2gtk-4.1-0` 2.52.6,
`libjavascriptcoregtk-4.1-0` 2.52.6, `libappindicator3-1`
12.10.1+20.10.20200706.1-0ubuntu5, `librsvg2-2` 2.58.0
(`libgtk-3-0t64` 3.24.41 was already present).

### Workaround used for the build (headers without installing)

The -dev packages were downloaded (not installed) and extracted
into a sysroot under ~/.tauri-sysroot, and pkg-config was pointed at it — no system
library was downgraded or replaced:

```bash
# 104 -dev packages: the five direct ones plus their -dev / gir1.2-*
# dependency closure (BFS over `apt-cache depends`, keeping only
# *-dev and gir1.2-*), 27.9 MB of .debs.
mkdir -p ~/.tauri-debs ~/.tauri-sysroot
cd ~/.tauri-debs
apt-get download libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  libgtk-3-dev librsvg2-dev libappindicator3-dev <... closure ...>
for deb in *.deb; do dpkg-deb -x "$deb" ~/.tauri-sysroot; done
find ~/.tauri-sysroot -name '*.pc' \
  -exec sed -i 's|^prefix=/usr$|prefix=$HOME/.tauri-sysroot/usr|' {} +
export PKG_CONFIG_PATH=$HOME/.tauri-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:$HOME/.tauri-sysroot/usr/share/pkgconfig
pkg-config --modversion webkit2gtk-4.1 javascriptcoregtk-4.1 gtk+-3.0 \
  libsoup-3.0 librsvg-2.0 appindicator3-0.1
# -> 2.52.6 / 2.52.6 / 3.24.41 / 3.4.4 / 2.58.0 / 12.10.0
```

The full recipe (the BFS script) is checked in as
`scripts/setup/fetch-tauri-sysroot.sh`. The sysroot itself lives at
`~/.tauri-sysroot` (moved out of `/tmp`: `/tmp` is a 512 MiB tmpfs
and the 340 MiB sysroot left too little room for the linker — the
metadata doctest failed with `ld terminated with signal 7 [Bus
error]` until the sysroot moved; see `docs/TESTING.md`). **The proper fix
for a fresh machine is to resolve the `libzstd1` pin** (either the
stock `libzstd-dev` accepts the Hatch build, or the image pins a
matching -dev package) and then install the -dev packages normally
— after that, `npm run tauri build` needs no `PKG_CONFIG_PATH`.
The produced `.deb` / `.AppImage` do not depend on the sysroot:
they link the runtime libraries, which are ordinary apt packages.

## Verification

(See `docs/TESTING.md` for the full Phase 8 results table.)

Headline, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0, Node v24.22.1 /
npm 10.9.4:

- Frontend: `npm test` **11 passed, 0 failed**; `npm run build`
  passes (`dist/index.html` 0.62 kB, JS 257.58 kB); `npm run lint`
  (oxlint) 0 warnings, 0 errors.
- Backend (own workspace): `cargo fmt --all` + `--check` pass,
  `cargo clippy --all-targets -- -D warnings` passes, `cargo check`
  passes, `cargo test` **16 passed, 0 failed**.
- Root workspace unchanged and green: `cargo test --workspace`
  **171 passed, 0 failed**, clippy passes, `cargo build --release`
  succeeds.
- Capability match: `openpixel --json formats` = 21 formats (16
  decodable, 15 encodable); the backend test asserts 21 and the
  frontend fetches the list live — no drift is possible.
- Tauri build: release binary `src-tauri/target/release/openpixel-desktop`
  (30 223 224 B) + `.deb`
  `src-tauri/target/release/bundle/deb/OpenPixel_0.1.0_amd64.deb`
  (9 665 496 B) built by `npm run tauri build`; the `.deb` was
  installed (`open-pixel` 0.1.0, `/usr/bin/openpixel-desktop`,
  `ldd` clean) and the app smoke-tested under Xvfb (main process +
  WebKitNetworkProcess + WebKitWebProcess alive, startup line in
  the log). The `.AppImage`
  `src-tauri/target/release/bundle/appimage/OpenPixel_0.1.0_amd64.AppImage`
  (80 046 584 B) was produced by running the extracted
  `linuxdeploy` by hand (see below) — `tauri build` itself cannot
  finish the AppImage step on this VM.
- AppImage via `tauri build`: **blocked by the environment, not by
  the app.** `linuxdeploy` is itself an AppImage and needs FUSE to
  mount; this VM has no FUSE kernel module (`modprobe fuse`:
  `Module fuse not found in directory
  /lib/modules/7.0.0-44-generic`; `/dev/fuse` absent), and
  `libfuse2t64` 2.9.9 (installed via apt) does not change that.
  Workaround used: extract the cached tools and run them directly
  (nothing in the repo was changed for this):

  ```bash
  mkdir -p ~/.tauri-tools && cd ~/.tauri-tools
  cp ~/.cache/tauri/linuxdeploy-07333c6-x86_64.AppImage ./ld.AppImage
  cp ~/.cache/tauri/linuxdeploy-plugin-appimage.AppImage ./plugin.AppImage
  ./ld.AppImage --appimage-extract >/dev/null 2>&1 && mv squashfs-root ld-extracted
  ./plugin.AppImage --appimage-extract >/dev/null 2>&1 && mv squashfs-root plugin-extracted
  cd apps/desktop/src-tauri/target/release/bundle/appimage
  PATH="$HOME/.tauri-tools/plugin-extracted/usr/bin:$HOME/.tauri-tools/ld-extracted/usr/bin:$PATH" \
    "$HOME/.tauri-tools/ld-extracted/usr/bin/linuxdeploy" \
    --appdir OpenPixel.AppDir --output appimage
  # -> OpenPixel-x86_64.AppImage (80 046 584 B), renamed to
  #    OpenPixel_0.1.0_amd64.AppImage to match Tauri's naming.
  ```

  Note: the first manual attempt used `--plugin appimage`, which
  is wrong — the AppImage plugin is an *output* plugin
  (`--output appimage`). On a machine with FUSE, plain
  `npm run tauri build` produces both bundles with no workaround.

### Phase 7 desktop verification (18 Nov 2026, Rust 1.100.0, Node v24.22.1 / npm 10.9.4)

The interrupted Phase 7 desktop agent's work, verified and finished
by a follow-up pass (commit `Desktop Phase 7: Android-path
cfg-gating + docs`):

- Frontend: `npm test` **15 passed, 0 failed** (3 files:
  `settings.test.ts` 4, `tauri.test.ts` 7, `pdf.test.ts` 4);
  `npm run build` passes (JS 579.75 kB, gzip 172.88 kB; CSS
  12.99 kB); `npm run lint` (oxlint) **0 warnings, 0 errors**
  (17 files, 96 rules).
- Backend (own workspace, from `apps/desktop/src-tauri/`):
  `cargo fmt --all -- --check` passes, `cargo clippy
  --all-targets -- -D warnings` passes, `cargo check` passes,
  `cargo check --no-default-features` passes (the Android path —
  proves the `native-ocr` cfg-gating compiles without Tesseract
  exports), `cargo test` **28 passed, 0 failed** (was 16 in
  Phase 8 — the new PDF/OCR/document tests plus the AVIF
  roundtrip test), `cargo test --no-default-features` **27
  passed, 0 failed** (including
  `ocr_commands_fail_honestly_without_the_feature`).
- Root workspace unchanged and green: `cargo test --workspace`
  **340 passed, 0 failed** across 34 suites.
- AVIF decode confirmed in the desktop build (not just from the
  Cargo.toml NOTE): `cargo tree -e features` shows
  `openpixel-core feature "native-avif"` enabled via unification
  through `openpixel-jobs`, and the backend test
  `avif_roundtrip_still_works_after_core_default_features_off`
  encodes a fixture PNG to AVIF and decodes it back through the
  desktop `Engine` — passes.
- Tauri build: release binary
  `src-tauri/target/release/openpixel-desktop` (37 856 168 B) +
  `.deb`
  `src-tauri/target/release/bundle/deb/OpenPixel_0.1.0_amd64.deb`
  (13 343 380 B) built by `npm run tauri build` (18m 52s);
  the `.deb` was installed (`open-pixel` 0.1.0,
  `/usr/bin/openpixel-desktop`, `ldd` clean) and the app
  smoke-tested under Xvfb (main process +
  WebKitNetworkProcess + WebKitWebProcess alive at 12 s, startup
  line `2026-11-17T20:26:52Z [INFO] OpenPixel desktop started
  (offline mode)` in the log; only the expected Xvfb DRI3
  software-rendering warnings). The `.AppImage`
  `src-tauri/target/release/bundle/appimage/OpenPixel_0.1.0_amd64.AppImage`
  (90 970 616 B) was again produced by running the extracted
  `linuxdeploy` by hand — `tauri build` itself failed the
  AppImage step with `failed to run linuxdeploy` (no FUSE on
  this VM, same as Phase 8).
- Tesseract provisioning had been wiped by a VM reset
  (`/usr/local/include/tesseract`, `.pc` files and symlinks
  gone; the apt packages themselves survived). Re-provisioned
  per `docs/OCR.md` §Provisioning before building (headers +
  `tesseract.pc`/`lept.pc` + symlinks, `pkg-config
  --modversion tesseract lept` → 5.3.4 / 1.82.0).
- Click-through gap — STILL OPEN, same as Phase 8: no
  display/GUI tool exists in this VM, so no clicks were
  performed. The desktop click-through items (1)–(8) from
  `docs/TESTING.md` (convert + save via native dialog, EXIF
  preserve, batch with a corrupt file + pause/resume/retry,
  Formats tab, theme persistence, Logs tab, keyboard-only
  picker, drag-and-drop onto the window) are unrun, and so are
  the new Phase 7 PDF/OCR flows (picker → one focused tool page
  → run → download, for each of the 23 tools; the honest-error
  paths for the two `needsPdfium` tools; OCR with eng+ben; a
  LibreOffice document conversion). What is needed is a real
  desktop with a display and a GUI-driving tool — the Tauri
  commands behind all of it are unit-tested (backend cargo
  test 28/28).
