# Existing Project Audit — OpenPixel Engine → OpenPixel Studio

**Date:** 16 November 2026
**Repo:** `~/workspace/openpixel-engine`, branch `main`, HEAD `ba9cc1e`
(Resize & Compress v1)
**Status:** Phase 0 audit. READ-ONLY inspection — no source code was
modified for this audit. Nothing in this document is a commitment to a
library choice; every candidate in §14 is a pre-check, not an adoption.
**Live product:** https://openpixel.pages.dev (Cloudflare Pages,
auto-deploys on push to `main`). Public repo:
https://github.com/rajuofficialasf-hub/openpixel

## 0. Method

Every claim below was read from the files at HEAD `ba9cc1e`: root
`Cargo.toml`, each crate's `Cargo.toml` + `src/lib.rs`, `apps/cli/src/main.rs`,
`apps/web/src/*`, `apps/desktop/src-tauri/src/commands.rs`,
`docs/*.md`, `.github/workflows/release.yml`, `scripts/test/cli-e2e.sh`,
`apps/web/e2e/*`, `sbom.json`, and the crates.io / npm / GitHub APIs
(for candidate-library versions and licences, checked 16 Nov 2026).
Test counts are quoted from `docs/TESTING.md` / `docs/E2E.md` and from
runs the coordinator performed on 16 Nov 2026; this audit ran no test
suite itself.

## 1. Architecture at a glance

One engine, many front-ends. Applications never call a codec directly.

```
Application layer
  React Web (apps/web) | Tauri Desktop (apps/desktop) | CLI (apps/cli) | WASM (crates/openpixel-wasm)
        \                    |                            |                    /
                    Unified Engine Interface — Engine (openpixel-core)
                                  |
                          openpixel-core
                            Format detection (magic bytes, openpixel-formats)
                            Codec registry (honest, runtime capability data)
                            Decoder / Encoder (openpixel-codecs)
                            Security layer (limits, path checks)
                            Processing pipeline (openpixel-pipeline)
                            Metadata / colour (openpixel-metadata)
                            Job manager (openpixel-jobs)
                                  |
                          Codec adapters
                            image-rs 0.25.10 (pure Rust)
                            resvg 0.48 / usvg 0.48 (SVG rasterise)
                            jxl-oxide 0.12.6 + zune-jpegxl 0.5.2 (JPEG XL)
                            jpeg2k 0.11.0 → openjp2 0.7.2 (JPEG 2000, pure Rust)
                            heifer 0.5.1 (HEIC/HEIF, pure Rust)
                            dav1d 1.5.0 built from source, statically linked (AVIF decode)
                            ravif 0.13 / rav1e 0.8 (AVIF encode)
                            gif 0.14.2 / tiff 0.11.3 / flate2 1.1.11 / tintbox 0.5.0
```

Workspace (root `Cargo.toml`, resolver 2, edition 2021, version 0.1.0,
licence MIT OR Apache-2.0):

| Member | Role |
|---|---|
| `crates/openpixel-formats` | Format identity, magic-byte detection, discovery, capability data |
| `crates/openpixel-codecs` | `Codec`/`Decoder`/`Encoder` traits, adapters, dynamic registry |
| `crates/openpixel-core` | `Engine` — the unified interface every front-end uses |
| `crates/openpixel-pipeline` | Composable resize/crop/rotate/colour/watermark operations |
| `crates/openpixel-metadata` | EXIF/ICC/XMP reading, metadata policies, frames, ICC→sRGB |
| `crates/openpixel-jobs` | Bounded worker pool: batch, pause/resume/cancel/retry |
| `crates/openpixel-wasm` | wasm-bindgen bindings (dav1d-free build) |
| `apps/cli` | `openpixel` binary |

Excluded from the workspace: `crates/openpixel-codecs/fuzz/`
(cargo-fuzz, own workspace, nightly + libfuzzer).
**Not workspace members, no `Cargo.toml` — stubs only** (see §9):
`crates/openpixel-color`, `crates/openpixel-security`,
`crates/openpixel-api` (each a one-file `lib.rs` doc comment).

Dependency discipline (enforced by convention, not tooling): every
version is pinned exactly (`=x.y.z`) in `[workspace.dependencies]`;
`Cargo.lock` is committed. Release profile: `opt-level = 3`,
`lto = "thin"`, `codegen-units = 1`.

## 2. Crate inventory

### 2.1 `openpixel-formats` — format identity (Phase 2)

- **Files:** `src/{lib,format,discovery,capability}.rs`. No dependencies
  except `serde`. 10 unit tests.
- **Public surface:** `ImageFormat` (21 variants — see §3),
  `detect_format` (magic bytes), `discover` (signature first,
  extension/MIME low-confidence fallback with mismatch reporting),
  `FormatCapability`, `Confidence`, `DetectionMethod`.
- **Reuse verdict — KEEP AS-IS, EXTEND.** This is the shared
  vocabulary every new engine must use. For Studio it needs new
  `ImageFormat`-style entries for documents: the natural home is a
  sibling type (e.g. `DocumentFormat` in a new `openpixel-documents`
  crate) reusing `discover()`'s signature-first design — do NOT
  widen `ImageFormat` to hold PDF/DOCX. `MAX_DIMENSION` (16,384 px)
  lives here and is re-exported by core.

### 2.2 `openpixel-codecs` — codec adapters + registry (Phases 2–3, HEIC follow-up)

- **Files:** `src/{lib,traits,types,registry,planned,image_rs,avif,svg,jxl,jpeg2000,hdr,exr,heic,error,float}.rs`.
  ~28 unit tests + `tests/adapter_roundtrip.rs` + Apple `sips`
  fixtures in `tests/fixtures/`.
- **Public surface:** `Codec` / `Decoder` / `Encoder` traits,
  `DecodedImage` (canonical pixel buffer), `EncodeParams`,
  `PixelFormat`, `CodecRegistry`, per-format codecs
  (`ImageRsCodec`, `AvifCodec`, `SvgCodec`, `JxlCodec`,
  `Jpeg2000Codec`, `HdrCodec`, `ExrCodec`, `HeicCodec`,
  `HeifCodec`), `planned_capabilities()` (APNG, RAW, PSD — see §3).
- **Feature flag:** `native-avif` (default on) gates dav1d; with it
  off, AVIF appears as a planned entry with a reason. This is the
  pattern to copy for every native-only capability in Studio
  (PDFium, Tesseract, LibreOffice): a feature flag + an honest
  planned entry, never a silent absence.
- **Reuse verdict — KEEP, EXTEND BY ANALOGY.** The `Codec` trait
  shape (validate → decode → encode, typed errors) is the template
  for a PDF engine's page/operator model, but PDF is not an image
  codec: do NOT force PDF into `CodecRegistry`. The registry stays
  image-only; Studio adds a parallel `PdfEngine` / `OcrEngine`
  behind the same `Engine`-style façade.

### 2.3 `openpixel-core` — the unified `Engine` (Phases 1–2, 4–5, Resize v1)

- **Files:** `src/{lib,engine,image,error,security}.rs` (engine.rs
  ~2,000 lines). 40 unit tests in engine.rs + 6 integration tests.
- **Public surface:** `Engine` (`convert`, `convert_bytes`,
  `process_bytes`, `process_to_size_bytes`, `process_to_size`,
  `process_to_path`, `info`, `discover`, `metadata`, `frames`,
  `extract_frame`, `read_input`/`write_output_file`),
  `ConvertOptions` / `ConvertResult` / `ImageInfo` /
  `ProcessOptions` / `TargetSizeOutcome`, `EngineConfig`
  (limits, default JPEG quality 85, default background white),
  `OpenPixelError` (typed errors).
- **Security (enforced in-engine):** 100 MiB file cap, 100 MP pixel
  cap, 16,384 px per side, path-traversal rejection (`..`, NUL).
  See §6.
- **Reuse verdict — KEEP AS THE PATTERN, DO NOT WIDEN.**
  `Engine` is the image engine. Studio's PDF/OCR/document engines
  get their own engine types that reuse `EngineConfig`,
  `OpenPixelError`, `read_input`, and the security limits —
  by depending on `openpixel-core`, not by stuffing PDF methods
  into `Engine`.

### 2.4 `openpixel-pipeline` — processing operations (Phase 4, Resize v1)

- **Files:** `src/{lib,operation,pipeline,spec,error}.rs`. 29 unit tests.
- **Public surface:** `Pipeline`, `Operation`, `PipelineSpec`,
  `WatermarkSpec`, `MAX_DIMENSION`, `MAX_PIXELS`.
- **Operations (all Lanczos3 for resampling):** `Resize` (exact),
  `ResizeFit` (aspect preserved, never upscales), `ResizeFill`
  (scale + centre-crop), `Pad`, `Crop`, `Thumbnail`,
  `Rotate90/180/270`, `RotateArbitrary`, `FlipHorizontal/Vertical`,
  `Grayscale`, `Brightness`, `Contrast`, `Saturation`, `Blur`,
  `Sharpen`, `Watermark` (image overlay only — text watermark was
  deliberately dropped: no bundleable font), `Flatten`.
- **Reuse verdict — KEEP AS-IS.** The pipeline is exactly what PDF
  rasterisation needs: "render PDF page → `DecodedImage` → apply
  `Pipeline` → encode" is the PDF→image path with zero new
  image code. `PipelineSpec` (serialisable op list) is the model
  for a future PDF op list (rotate pages, crop pages).

### 2.5 `openpixel-metadata` — EXIF/ICC/XMP + frames (Phase 5)

- **Files:** `src/{lib,exif,extract,frames,icc,orientation,policy,types,error}.rs`.
  ~50 unit tests.
- **Public surface:** hand-written std-only EXIF reader
  (orientation, make/model, date/time, GPS, DPI),
  `extract_metadata`, `MetadataPolicy` (Strip / Preserve /
  PreserveSelected / PreserveColorProfiles /
  NormalizeOrientation), `apply_policy`, `png_crc32`,
  `PreservationReport`, GIF frame enumeration + extraction
  (disposal compositing), APNG/animated-WebP frame info,
  multi-page TIFF count + extraction, `parse_icc`,
  `convert_to_srgb` (tintbox 0.5.0, pure-Rust LittleCMS
  reimplementation), `normalize_orientation` (EXIF 1–8).
- **Honest limits (documented in CODECS.md):** byte-level metadata
  preservation is JPEG + PNG only; everything else drops metadata
  with a recorded reason. IPTC is not read. APNG/animated WebP:
  frame info only.
- **Reuse verdict — KEEP, EXTEND FOR PDF.** PDF metadata (Info
  dictionary, XMP stream) is a different container but the same
  policy vocabulary: `MetadataPolicy` + `PreservationReport`
  should be reused by `openpixel-pdf` for metadata strip/edit,
  not re-invented.

### 2.6 `openpixel-jobs` — batch worker pool (Phase 6)

- **Files:** `src/{lib,manager,types,error}.rs` + `tests/batch_integration.rs`.
  14 unit tests.
- **Public surface:** `JobManager`, bounded pool (default
  `min(CPUs, 4)`, max 8, `std::thread` only), pause/resume/
  cancel/retry, per-file results, a failed file never stops the
  batch, engine limits enforced per job.
- **Reuse verdict — KEEP, GENERALISE.** This is the shared batch
  infrastructure the prompt's §7 asks for — but it is currently
  image-typed (it drives `openpixel-core`). Phase 1 must
  generalise it to a job type parameter (or a `Job` trait) so PDF
  merge/split and OCR jobs run in the same pool, with the same
  progress/cancel/retry semantics. Do not build a second pool.

### 2.7 `openpixel-wasm` — browser engine (follow-up 2, Resize v1)

- **Files:** `src/lib.rs` (crate-type `cdylib` + `rlib`).
  11 unit tests + `wasm-pack test --node` 3/3.
- **Public surface (JS exports):** `detect`, `discover`, `info`,
  `capabilities`, `supported_formats`, `convert`, `process`,
  `process_to_size`, `version`. Ops are passed as a JSON string
  (`serde_wasm_bindgen` panics on native targets, so the string
  form keeps them unit-testable). The generated `.d.ts` types
  `target_bytes` as `bigint`.
- **Build:** `npm run build:wasm` (wasm-pack 0.15.1, wasm-bindgen
  0.2.130) → `apps/web/public/wasm/` (~7.35 MB after wasm-opt),
  **committed to git** (force-added) so Cloudflare Pages serves it.
  dav1d-free: AVIF is not in the WASM build at all.
- **Reuse verdict — KEEP, EXTEND CAUTIOUSLY.** `process` /
  `process_to_size` are the exact seam for browser-side PDF-page
  rasterisation *if* a WASM PDF renderer ever lands — but no PDF
  library in §14 runs fully in WASM except pdf.js (rendering
  only). The WASM crate must stay dav1d-free-shaped: native-only
  engines stay behind feature flags and never break the wasm32
  build. A broken `npm run build:wasm` blocks the whole web
  deploy, so any new native dependency must be proven wasm-safe
  or feature-gated before it is added to a shared crate.

### 2.8 Stubs — `openpixel-color`, `openpixel-security`, `openpixel-api`

- Each is a single `lib.rs` doc comment ("stub for a later phase.
  Not a workspace member"). No `Cargo.toml`, no code, no tests.
- **Reuse verdict — PROMOTE, DON'T DELETE.** These names were
  reserved by the original plan and the Studio prompt's §11
  expects them. Phase 1 gives them real `Cargo.toml` files:
  `openpixel-security` becomes the shared file-validation /
  sandbox / limits crate (promoting `core::security` plus the
  Phase 9 audit findings); `openpixel-api` becomes the shared
  API types for the optional backend; `openpixel-color` becomes
  ICC / colour-space handling (promoting `metadata::icc`).
  The ROADMAP.md pointers to "when this crate is implemented"
  are the only existing spec for them — write the real spec in
  Phase 1, don't guess.

## 3. Format capabilities — honest status (from `docs/CODECS.md`)

17 formats decode + encode; 3 planned; 2 detection-only. Registry
reports 21 capabilities. Nothing here is claimed beyond what the
code does.

| Format | Decode | Encode | Notes |
|---|---|---|---|
| JPEG, PNG, BMP, GIF, TIFF, WebP, TGA, ICO, PNM, QOI | yes | yes | image-rs 0.25.10 |
| SVG | yes (rasterise) | no | resvg 0.48.1 — raster-to-vector never supported |
| AVIF | yes | yes (8-bit stills) | ravif encode + dav1d decode (static); **not in WASM** |
| JPEG XL | yes | yes (lossless only) | jxl-oxide decode + zune-jpegxl encode |
| HDR, EXR | yes | yes | clamped to 8-bit SDR |
| JPEG 2000 | yes | yes (lossless only) | jpeg2k/openjp2, pure Rust, no C library |
| HEIC, HEIF | yes | yes (lossy YCbCr 4:2:0) | heifer 0.5.1, pure Rust; still images only; HEVC-coded items only |
| APNG | detection | no (planned) | frame info only via metadata |
| RAW | detection | no (planned, LibRaw — LGPL-2.1/CDDL) | flattened preview only, TBD |
| PSD | detection | no (planned) | flattened preview only, TBD |

**Honest limits that Studio inherits and must not regress:**
- WebP encode is lossless-only (image-rs 0.25.10): quality does
  not change WebP size — target-size search honestly refuses WebP.
- ICO caps at 256×256 (auto-resize with warning, commit `a9392e7`).
- JPEG size is not strictly monotonic at qualities 1–3.
- HEIC/HEIF: **HEVC patent note** — review before commercial
  shipping (recorded in CODECS.md).
- `native/licenses/` holds licence texts for the linked native
  codecs (resvg, zune-jpegxl, dav1d, openjp2, jpeg2k, ravif,
  rav1e, mp4parse, exr, tintbox).

## 4. Shared infrastructure that already exists (prompt §7)

| Prompt §7 module | Current state | Reuse |
|---|---|---|
| File Detection | `openpixel-formats::discover` (magic bytes first) | Direct — extend with document signatures (PDF `%PDF`, ZIP-based Office, …) |
| File Validation | `core::security` limits + typed errors | Direct — add PDF/Office-specific validation in the new crates |
| File Metadata | `openpixel-metadata` (EXIF/ICC/XMP, policies) | Direct — PDF Info/XMP reuses the policy vocabulary |
| Processing Pipeline | `openpixel-pipeline` (ops, Lanczos3) | Direct — PDF rasterisation feeds it |
| Job Management / Batch / Queue | `openpixel-jobs` (bounded pool, pause/resume/cancel/retry) | Generalise to non-image jobs (Phase 1) |
| Progress / Cancellation / Retry | Same pool + CLI `--json` progress | Reuse; web currently polls via its own workspace state |
| Error Handling | `OpenPixelError` / `CodecError` / `PipelineError` / `MetadataError`, typed, no panics on bad input | Direct — new crates add their own typed error enums in the same style |
| Temporary Workspace | Ad-hoc (`tempfile` in dev-deps; CLI writes outputs next to inputs) | **Gap — no shared temp-workspace module.** Phase 1 must add one (isolated, auto-cleanup) before Office/PDF work |
| Resource Management | Engine limits only (file/pixels/dimension) | **Gap — no timeouts, no RSS cap (accepted risks A8/A9)** |
| Security Validation | Signature + size + path checks; Phase 9 audit fixes | Extend with PDF/Office rules (see §6) |
| Logging / Monitoring | Desktop has a log file + Logs tab; CLI `--verbose` | **Gap — no shared logging/monitoring crate; no backend yet** |
| File Storage | None (local files only) | Backend-only concern (Phase 8) |

The prompt's `ProcessingEngine` contract (`validate / inspect /
process / optimize / export / health_check`) does **not** exist as a
trait yet. `Engine` is the de-facto contract for images. Phase 1
writes the trait once, in `openpixel-core`, and both the image
`Engine` and the new engines implement it — no second contract.

## 5. Frontend — web app (`apps/web`)

- **Stack:** React 19.3.1 + TypeScript 7.0.2 + Vite 8.3.8,
  Vitest 3.2.4, oxlint 1.93.0, jszip 3.10.1 (batch zip).
  **Material UI 7.3.11 + Emotion, Three.js 0.187** — see the
  Tailwind conflict, §13.
- **Tabs (App.tsx):** Convert, Resize, Batch, Formats, Settings.
  `TabId` + `tab-*` / `panel-*` ids are e2e contracts (see §11).
- **Design system:** `src/theme/theme.ts` — `getTheme(mode)`,
  single source of truth. Brand blue #2563eb, teal secondary
  #0d9488, slate neutrals, system font stack (no webfont),
  borderRadius 12, component overrides, `:focus-visible` outline.
  `App.tsx` is the shared shell (header + theme toggle + tabs);
  `Background3D.tsx` is a lazy-loaded Three.js backdrop
  (~350 particles + 6 wireframe icosahedra, reduced-motion aware,
  pauses when hidden, Settings toggle `show3dBackground`).
  The theme file's own header says: *"the PDF workspace next"*
  plugs into this layout — that is the intended Studio seam.
- **Conversion routing (`src/lib/`):** `convert.ts`
  (`probeImage` / `convertImage`, `ProbeError` carrying the
  sniffed format), `wasm-engine.ts` (`wasmCoversConversion`,
  `CANVAS_UNDECODABLE = ['svg']`, `processWithWasm` /
  `processToSizeWithWasm`), `capabilities.ts`
  (`BROWSER_DECODABLE`, `BROWSER_ENCODABLE = ['png','jpeg','webp']`,
  `canvasMimeType`), `detect.ts`, `settings.ts`
  (`openpixel.settings.v1`: theme, default quality 85, default
  format, `show3dBackground`, resize settings), `resize.ts` /
  `resize-convert.ts` (pure size math, target-size parsing —
  binary KB/MB units).
- **Worker:** `src/worker.ts` — canvas conversion in a Web Worker;
  main-thread `<img>` fallback for SVG rasterisation.
- **Capability data:** `src/data/capabilities.json` (21 formats),
  generated by `npm run generate:capabilities` from
  `target/release/openpixel --json formats` — reproducible
  byte-for-byte. **The web app never hand-writes a format list.**
  Studio's PDF/document tools must follow the same rule: a
  generated capability file from the engine registry, not a
  hand-written table.
- **What the web app can and cannot do (Cloudflare Pages, static
  SPA, all processing client-side):** 16 browser targets, batch
  max 4, Resize + target-size, Formats, Settings, dark mode.
  NOT available: AVIF encode, metadata preservation (web always
  strips; preserve is CLI-only, JPEG+PNG), frame/page extraction
  (first frame/page only), batch >4, bench, JSON output, scripting.
- **Tests:** web `npm test` 49/49 (5 files); e2e
  `apps/web/e2e/` — `web-e2e.mjs` 36/37 (one known keyboard
  flake, §9), `web-nowasm.mjs` 9/9, `resize-e2e.mjs` 16/16,
  `live-matrix.mjs` 57/57 against the live site (16 Nov 2026).
  Screenshots in `apps/web/e2e/screenshots/`.

## 6. Security posture (Phases 1, 5, 9)

- **Enforced:** 100 MiB file cap, 100 MP pixel cap, 16,384 px/side,
  `..`/NUL path rejection, signature-first detection (extension
  never trusted), typed errors on corrupt input, bounded zlib
  decompression in PNG metadata, GIF canvas allocated only after
  the limit check, TIFF page decoded only after the limit check,
  CLI batch reads with a size limit, bounded GIF/APNG/WebP frame
  scans, `read_input` TOCTOU fix. cargo-fuzz targets for
  detection/decode/metadata (nightly + libfuzzer, 0 crashes in
  Phase 9). `cargo audit` 0 vulnerabilities (Phase 9).
  SBOMs: root `sbom.json` (240 components — `docs/ARCHITECTURE.md`
  still says 236, stale), `apps/desktop/src-tauri/sbom.json` (570).
- **Accepted risks (documented, deliberate — `docs/SECURITY-AUDIT.md`
  §A8/A9 and others):** **no processing timeouts**; **no RSS /
  cgroup cap**; output-symlink following; input symlinks /
  special files; SVG complexity. These matter more for Studio:
  PDF and Office files are larger, slower, and more hostile than
  images — Phase 1 must close the timeout/RSS gap for the new
  engines at least, and the PDF parser must never execute
  embedded JavaScript (a hard rule from the prompt §14).
- **Prompt §14 controls not yet present:** malware scanning,
  isolated workers, CPU/memory/time limits, temp-workspace
  isolation, non-root containers, read-only input mounts,
  network-disabled workers, short-lived download URLs, automatic
  file deletion, rate limiting, auth, audit logs, TLS, storage
  encryption. Almost all of these are backend/Phase 8 concerns;
  the local-only product needs the subset that applies to local
  files (timeouts, RSS cap, temp isolation, safe redaction).

## 7. Desktop (`apps/desktop`) and CLI (`apps/cli`)

- **Desktop:** Tauri 2.12.4 backend (`src-tauri/`, crate
  `openpixel-desktop`) calling `openpixel-core` + `openpixel-jobs`
  directly — the same code the CLI uses. 19 `#[tauri::command]`
  annotations in `src-tauri/src/commands.rs` (app_info,
  capabilities, image info, metadata, frames, directory listing,
  convert, process, extract-frame, batch start/progress/pause/
  resume/cancel/retry). Frontend: React 19 + TS + Vite, tabs
  Convert / Batch / Formats / Settings / Logs, log file in the
  app data dir. Linux `.deb` + `.AppImage` built and installed
  on this VM; Windows `.msi`/NSIS + macOS `.dmg`/`.app` via CI.
  **Desktop frontend still uses Tailwind CSS 3.4.17**
  (`tailwind.config.js`, `postcss.config.js`, `@tailwind` in
  `index.css`) — it was NOT part of the 16 Nov MUI migration.
  That is a second, smaller Tailwind remnant (see §13).
  Desktop backend `cargo test` 16/16; desktop `npm test` 11.
  **Desktop click-through (1)–(8) still not run** — no
  GUI-driving tool on this VM; the Tauri commands behind them
  are unit-tested.
- **CLI:** `apps/cli/src/main.rs` (1,428 lines), clap derive.
  Commands: `info`, `metadata`, `frames`, `extract-frame`,
  `convert` (incl. `--target-size` via `process`), `discover`,
  `capabilities`, `formats`, `batch` (`--workers`, `--sequential`),
  `bench`, `process` (canonical-order flags or repeatable `--op`;
  `--resize/--resize-fit/--resize-fill/--pad/--crop`,
  `--quality`, `--png-compression`, `--background`, `--metadata`,
  `--target-size`, `--frame`, `--to-srgb`). `--json/--quiet/--verbose`
  global flags. CLI e2e `scripts/test/cli-e2e.sh` (§1–9 incl.
  §3c ICO, §4b target-size) exits 0.
- **CI (`.github/workflows/release.yml`, "Build"):** jobs `cli`,
  `desktop`, `web` on ubuntu-24.04 / windows-latest /
  macOS-latest; push/PR to `main` + `workflow_dispatch`;
  build + `upload-artifact` only (30-day retention, no release/
  publish/deploy). dav1d is built statically on every platform
  (`.cargo/config.toml`: `SYSTEM_DEPS_DAV1D_BUILD_INTERNAL =
  "always"`; meson + ninja + nasm + pkg-config on Windows via
  choco/pip, MSVC via `msvc-dev-cmd`, `CC=cl`). Last verified
  all-green runs: 43860662054 (static dav1d) and 43862902972
  (SVG fix). CI status of the two latest pushes (`23fa5a3`
  redesign, `a9392e7` ICO fix, `ba9cc1e` resize) was not
  re-checked in this audit.
- **Release artefacts:** `dist/openpixel-0.1.0-linux-x86_64.tar.gz`
  + `SHA256SUMS`. No GitHub Release has been created (CI
  artefacts expire after 30 days) — noted as an open option,
  not a defect.

## 8. Platform × engine capability matrix (today)

| Capability | CLI (native) | Desktop (Tauri) | Web (Pages) | WASM |
|---|---|---|---|---|
| Image decode/encode (16 targets) | yes | yes | yes (canvas + WASM) | yes, except AVIF |
| AVIF | yes (ravif + dav1d) | yes | source only (browser decode) / target NO | NO (no wasm32 libdav1d) |
| SVG | yes (resvg) | yes | yes (WASM resvg / `<img>`) | yes |
| HEIC/HEIF | yes (heifer) | yes | yes (WASM heifer) | yes |
| Metadata preserve | JPEG+PNG only | JPEG+PNG only | strips always | strips |
| Pipeline (resize/process) | yes | yes | yes (Resize tab, WASM) | yes (`process`) |
| Target-size search | yes (`--target-size`) | no UI | yes | yes (`process_to_size`) |
| Batch >4 workers | yes (≤8) | yes (≤8) | max 4 | n/a |
| Frames/pages | yes | yes | first frame only | first frame only |
| PDF / Office / OCR | **no** | **no** | **no** | **no** |
| Mobile (Android/iOS) | n/a | n/a | n/a (responsive web only) | n/a |
| Self-hosted backend | n/a | n/a | n/a | n/a |

Studio must extend this matrix, not replace it: every new
operation gets a row (local / desktop / web / WASM / server),
and "no" is a legitimate, honest cell.

## 9. Technical debt (ranked)

1. **No processing timeouts, no RSS cap** (accepted risks A8/A9).
   A hostile file can hang or exhaust memory. Must be closed
   before PDF/Office work, which is slower and heavier.
2. **Three stub crates with no spec** (`openpixel-color`,
   `openpixel-security`, `openpixel-api`). Only a doc comment and
   a ROADMAP pointer each.
3. **No shared temp-workspace module.** CLI writes next to inputs;
   nothing isolates or auto-cleans intermediate files — a
   prerequisite for Office conversion (LibreOffice writes many
   temp files) and for safe PDF work.
4. **Desktop frontend still on Tailwind** while the web app is on
   MUI (§13). Two design systems in one product.
5. **Desktop click-through (1)–(8) never run.** Only unit tests
   behind the UI.
6. **Web e2e keyboard flake.** Enter on the drop zone does not
   open the file chooser in this VM's headless Chromium (36/37);
   proven not a regression (pre-resize build fails identically);
   real users unaffected. Still: the suite is not 37/37.
7. **Docs staleness.** `docs/ROADMAP.md` phase entries are frozen
   at delivery time (Phase 7 still says "Tailwind", Phase 3 still
   says HEIC is detection-only, Phase 9 says 176 tests / SBOM 236).
   `docs/ARCHITECTURE.md` says SBOM 236 (actual 240) and still
   carries "Phase 9 — what changed (draft)". `docs/TESTING.md`
   baselines stop at 195 Rust tests (actual 205). The docs are
   accurate where they were updated (CODECS, WEB, E2E) and stale
   where they were not. Phase 0 should add a "last verified"
   stamp discipline, not a rewrite.
8. **`tests/` directory is empty.** All real tests live in
   `crates/*/tests`, `apps/*/e2e`, and `scripts/test/`. Either
   populate it or remove it in Phase 1 — an empty directory
   invites confusion about where tests belong.
9. **HEVC patent note (HEIC/HEIF).** Review before commercial
   shipping. Unchanged by Studio, but the new PDF engine must
   not add a second patent-encumbered codec without the same
   review.
10. **WebP lossless-only encode; JXL/JPEG 2000 lossless-only
    encode; ICO 256×256 cap.** All honest and documented — but
    any Studio feature that assumes "quality slider works for
    every format" will be wrong. The capability registry is the
    guard; keep using it.
11. **`native/` directory is licences + empty `build/` + `codecs/`
    subdirs.** No build logic lives there; the dav1d build is
    driven by `.cargo/config.toml` + CI steps. If Studio adds
    C/C++ FFI (qpdf, Tesseract, PDFium), `native/` is the
    intended home — currently it is only a licence drawer.
12. **No `backend/`, `packages/`, `adapters/`, `apps/android|ios/`
    directories.** Expected — they do not exist yet. Do not
    create them empty in Phase 0.

## 10. What must remain unchanged

- **Image engine behaviour:** all 21 format capabilities, the
  Lanczos3 pipeline, ICO auto-resize, target-size semantics,
  metadata policy outcomes, security limits. Any Studio change
  that alters a conversion result is a breaking change and needs
  a regression test first.
- **CLI surface:** command names, flags, `--json` shapes,
  exit codes. `openpixel convert/process/batch/bench` are
  scripted by users and by `scripts/test/cli-e2e.sh`.
- **WASM JS exports:** `detect`, `discover`, `info`,
  `capabilities`, `supported_formats`, `convert`, `process`,
  `process_to_size`, `version` — names and shapes. The web app
  and any future consumer depend on them.
- **Web e2e selectors:** `#convert-file`, `#target-format`
  (native `<select>`), `#tab-*` / `#panel-*`, `role="status"` /
  `role="alert"`, button and drop-zone texts. The e2e suite is
  the contract.
- **Public URLs and deploy:** https://openpixel.pages.dev,
  Cloudflare Pages auto-deploy on push to `main`, repo
  `rajuofficialasf-hub/openpixel`, branch `main`.
- **Design decisions:** MUI design system (`theme.ts`),
  custom CSS variables, mobile-first, Bengali UI, local-first
  privacy (files never leave the device in the web app),
  exact version pinning, SBOM + licence audit discipline.

## 11. Integration points for the new engines

| New engine | Best seam in the existing code |
|---|---|
| PDF engine | `openpixel-formats::discover` + new `DocumentFormat` (PDF `%PDF` signature); `openpixel-pipeline` for rasterised pages; `openpixel-metadata` policy vocabulary for Info/XMP; `openpixel-jobs` (generalised) for merge/split batch; `Engine`-style façade in a new `openpixel-pdf` crate |
| PDF rendering in browser | pdf.js (`pdfjs-dist`) for view/render; NO native PDF library runs in WASM — the web PDF tools render with pdf.js and do page ops via a WASM build of the PDF crate *only if* the chosen library compiles to wasm32 (lopdf does; PDFium does not) |
| OCR engine | Image preprocess via `openpixel-pipeline` (deskew/denoise/grayscale/threshold as new `Operation`s); Tesseract behind a `native-ocr` feature flag; results as a new `OcrResult` type with bounding boxes + confidence, mirroring `Metadata` |
| Document conversion | `adapters/office/` (LibreOffice headless subprocess, desktop/server only) behind the same `ProcessingEngine` trait; font-substitution + error reporting as typed errors |
| File security | Promote stub `openpixel-security`: file validation, temp-workspace isolation, timeouts/RSS (closing A8/A9), PDF sanitisation rules, password handling |
| Unified frontend | `App.tsx` shell + `theme.ts` + `settings.ts` (`openpixel.settings.v1`): new tool tabs plug in like Resize did; `capabilities.json` generation extended to PDF/document/OCR capabilities |
| Self-hosted backend | Promote stub `openpixel-api`: shared API types (`/api/v1`), job types reused from `openpixel-jobs`; backend is a new `backend/` tree, never a modification of the web app |
| Mobile | No existing code. Tauri Mobile is the only route that reuses the Rust engine; native Kotlin/Swift apps would need a separate SDK. Last phase for a reason. |

## 12. Dependency map (what the engine is built on)

Pinned exact versions (root `Cargo.toml`): image-rs 0.25.10,
thiserror 2.0.21, serde 1.0.229, serde_json 1.0.154, clap 4.6.7,
resvg/usvg 0.48.1, fontdb 0.24.0, jxl-oxide 0.12.6,
zune-jpegxl 0.5.2, zune-core 0.5.3, jpeg2k 0.11.0, heifer 0.5.1,
wasm-bindgen 0.2.130, serde-wasm-bindgen 0.6.5, gif 0.14.2,
tiff 0.11.3, flate2 1.1.11, tintbox 0.5.0, tempfile 3.27.0
(dev), wasm-bindgen-test 0.3.80 (dev). Web: React 19.3.1,
@mui/material 7.3.11, three 0.187, jszip 3.10.1, Vite 8.3.8,
TypeScript 7.0.2, Vitest 3.2.4. Desktop: Tauri 2.12.4,
tauri-plugin-dialog 2.8.4, Tailwind 3.4.17 (desktop only).
CI: Rust 1.100.0, Node 24.22.1. Licence posture: everything
above is MIT / Apache-2.0 / BSD / Zlib / MPL-2.0 (mp4parse only,
inside dav1d's AVIF path) — see `docs/CODECS.md` and
`native/licenses/`.

## 13. FLAG — Tailwind vs Material UI conflict (explicit)

**The master prompt's §8 says "Tailwind CSS" for the frontend.
That is superseded and must not be followed.**

- On 16 Nov 2026 the web app was migrated from Tailwind CSS to
  **Material UI 7.3.11 + Three.js** (commit `23fa5a3`), on
  Raju's own decision ("Material UI আর Three.js দিয়ে সুন্দর
  অ্যানিমেশন দিয়ে প্রফেশনাল লুক দাও"). Tailwind was removed
  completely from `apps/web/` — no package, config, or directive
  remains; `docs/WEB.md` records "MUI and Tailwind must not
  coexist in this app".
- The single design system is `apps/web/src/theme/theme.ts`
  (`getTheme(mode)`), and `App.tsx` is the shared shell the PDF
  workspace is meant to plug into (the theme file says so).
- **Recommendation: KEEP MUI.** The unified Studio frontend
  reuses `theme.ts` and the `App.tsx` shell; every new tool tab
  (PDF, OCR, Documents) is a MUI workspace like Resize was.
  Record "Tailwind" in the prompt as superseded — do not
  re-add it to the web app.
- **Remnant:** the desktop frontend still uses Tailwind 3.4.17
  (it was never migrated). Phase 6/7 must decide: migrate the
  desktop frontend to the shared MUI theme (preferred — one
  design system, and the prompt's §10 wants one cohesive
  product), or keep desktop Tailwind and accept two design
  systems. Do not start the migration silently; it is a
  Raju decision (see Migration Plan, open decisions).

## 14. Licence pre-check — candidate libraries for Studio

Checked 16 Nov 2026 against crates.io / npm / GitHub. "Pin" is the
exact version to pin if adopted. "WASM" means the library can run
in the browser build. Nothing here is adopted yet.

| Library | Pin | Licence (verified) | WASM | Verdict |
|---|---|---|---|---|
| **lopdf** (Rust, pure) | `=0.47.0` | MIT | **yes** (pure Rust, no C) | **Preferred for native PDF manipulation** (merge/split/rotate/pages, metadata, Info/XMP). No renderer — needs a separate rasteriser for PDF→image. |
| **pdfium-render** (Rust binding) | `=0.9.5` | MIT OR Apache-2.0 (binding crate); PDFium itself BSD-3-Clause | **no** | Renderer of choice for native PDF→image / text extraction. BUT: needs a PDFium binary — the crate downloads prebuilt binaries by default. Redistribution + binary provenance must be recorded in the licence registry before adoption; a vendored build is the alternative. |
| **qpdf** (C++, FFI) | v12.4.2 (GitHub latest) | Apache-2.0 | **no** | Strong for structural PDF work (linearise, repair, object streams, encryption). C++ FFI = new `native/` build complexity + CI matrix work. Only if lopdf proves insufficient. |
| **pdf.js** (`pdfjs-dist`, JS) | `=6.5.438` | Apache-2.0 | **yes — browser-native** | **Browser PDF rendering/viewing.** The only full PDF renderer that runs in the web app. Page ops still need a Rust/WASM engine beside it. |
| **Tesseract** (`tesseract-sys =0.6.3` + system tesseract/leptonica) | tesseract-sys `=0.6.3` (MIT binding); Tesseract Apache-2.0; Leptonica BSD-2-Clause | Apache-2.0 / BSD-2-Clause | **no** (native only) | **Preferred native OCR.** Bengali `ben.traineddata` exists in `tessdata_fast` (855,841 bytes, verified via GitHub API 200). System tesseract + leptonica are a build-time dependency on every platform (apt/brew/choco) — CI matrix work. |
| **tesseract.js** (JS/WASM) | `=7.0.0` | Apache-2.0 | **yes — WASM in browser** | **Browser OCR.** Slower than native, loads `ben`/`eng` traineddata from the app's own assets. The only OCR that runs in the web app. Accuracy claims must stay honest (never 100%). |
| **LibreOffice headless** | 26.8.3 (TDF, 12 Nov 2026) | MPL-2.0 | **no** | **Office conversion, desktop/server only.** ~286 MB install, subprocess-based, imperfect layout fidelity — never promise perfect formatting. No WASM, no browser. |
| **Ghostscript** | — | **AGPL-3.0** | no | **DO NOT USE.** AGPL copyleft is incompatible with the project's commercial-use licence posture. Flagged, not adopted, not to be re-proposed without a full licence review. |
| **PaddleOCR** | — | Apache-2.0 | no (needs ONNX Runtime) | Possible later OCR alternative (better tables/handwriting). Heavier than Tesseract, model files to ship. Defer — Tesseract first. |
| **OpenCV** | — | Apache-2.0 | no | Only if OCR preprocessing outgrows `openpixel-pipeline` (deskew/denoise). Defer — pipeline first. |
| **libvips** | — | LGPL-2.1 | no | Not needed: image-rs + pipeline already cover the image side. Do not add. |

**WASM honesty rule for Studio (from this table):** no PDF/OCR
library runs fully in WASM except pdf.js (rendering) and
tesseract.js (OCR). Native PDF work (lopdf/PDFium/qpdf) is
CLI/desktop/server. The capability matrix (§8) must say so for
every operation — the browser gets pdf.js + WASM where possible,
and an honest "needs the desktop app / server" elsewhere. Never
fake a browser PDF feature with a UI-only implementation.

## 15. Audit conclusion

The image engine is complete, tested, and honestly documented. The
reusable core for Studio is real: format detection, the codec
registry pattern, the Lanczos3 pipeline, the metadata policy
vocabulary, the jobs pool, the security limits, the WASM export
shape, the MUI theme + `App.tsx` shell, and the generated
capability data. The gaps are also real and specific: no PDF/OCR/
Office code at all; three stub crates; no temp workspace; no
timeouts/RSS cap; no shared `ProcessingEngine` trait; no backend;
no mobile code; desktop still on Tailwind; docs partly stale.

The correct next step is the Migration Plan (`docs/MIGRATION_PLAN.md`)
and the Roadmap (`docs/IMPLEMENTATION_ROADMAP.md`) — then joint
planning with Raju before any Phase 1 code. No restructuring in
Phase 0, per the prompt.
