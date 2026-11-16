# Roadmap — OpenPixel Engine

- [x] **Phase 1 — Foundation** (this delivery): workspace, core types,
  error system, magic-byte detection, capability registry, JPEG/PNG/BMP/
  GIF/TIFF/WebP/TGA/ICO/PNM/QOI via image-rs, CLI (`info/convert/formats/
  capabilities/batch`), security limits, unit + integration tests, docs.
  (Approved 15 Nov 2026; Phase 2 followed.)
- [x] **Phase 2 — Codec Registry** (done 15 Nov 2026): `openpixel-formats`
  (format identity, magic-byte detection, discovery, capability data),
  `openpixel-codecs` (`Codec`/`Decoder`/`Encoder` traits, `ImageRsCodec`
  adapters for 10 formats, dynamic `CodecRegistry`, `DecodedImage`
  canonical type), engine refactored to the registry with an unchanged
  public API, new CLI `discover` command. 29 tests pass.
  (Phase 3 followed under the auto-run permission, 15 Nov 2026.)
- [x] **Phase 3 — Native Codecs** (done 16 Nov 2026, verified by
  coordinator): SVG rasterisation (resvg 0.48 / usvg 0.48,
  decode-only, scripts and external resources disabled), AVIF
  (ravif encode + dav1d decode, built from source and statically
  linked — see `scripts/setup/ubuntu-24.04.sh`), JPEG XL (jxl-oxide decode +
  zune-jpegxl lossless encode — the `image` crate 0.25.10 has no
  `jxl` feature), HDR + EXR (image-rs, clamped to 8-bit SDR in
  Phase 3, noted on the image), JPEG 2000 (jpeg2k/openjp2,
  pure-Rust OpenJPEG port — no C library). HEIC/HEIF stays
  detection-only: blocked because the VM's libheif1 1.23.3-1 has no
  matching `-dev` package (see `docs/CODECS.md`).
  50 tests pass (was 29).
- [x] **Phase 4 — Processing Pipeline** (done 16 Nov 2026, verified
  by coordinator): `openpixel-pipeline` crate (`Pipeline`,
  `Operation`, `PipelineSpec`, `PipelineError`), resize / fit /
  fill / pad / crop / thumbnail, rotate 90/180/270 + arbitrary,
  flip, grayscale, brightness/contrast/saturation, blur, sharpen,
  image watermark, background flatten; `Engine::process` /
  `convert_with_pipeline` / `process_to_path` + `ProcessOptions`;
  `openpixel process` CLI (canonical-order flags or repeatable
  `--op` for exact ordering); dependency versions pinned exactly.
  Text watermark intentionally not included (no bundled font).
  89 tests pass (was 50).
- [x] **Phase 5 — Metadata & Animation** (done 16 Nov 2026, verified
  by coordinator): `openpixel-metadata`
  crate — hand-written EXIF reader (orientation, make/model,
  date/time, GPS, DPI) + ICC/XMP detection from JPEG/PNG/TIFF/WebP;
  `MetadataPolicy` (Strip / Preserve / PreserveSelected /
  PreserveColorProfiles / NormalizeOrientation) wired into the
  engine with honest per-format preservation (JPEG + PNG only,
  everything else dropped with a recorded reason); orientation
  normalisation per EXIF 1-8 (Pillow `exif_transpose` mapping);
  GIF frame enumeration + extraction with disposal compositing,
  APNG / animated WebP frame info (frame 0 only), multi-page TIFF
  count + extraction; ICC-to-sRGB conversion via tintbox
  (pure-Rust LittleCMS reimplementation — `lcms2` C crate not
  used, see `docs/CODECS.md`); new CLI commands `metadata`,
  `frames`, `extract-frame`. 152 tests pass (was 89).
- [x] **Phase 6 — Batch & Performance** (done 16 Nov 2026, verified
  by coordinator): `openpixel-jobs`
  crate (`JobManager` + bounded worker pool, default
  `min(CPUs, 4)` workers capped at 8, `std::thread` only),
  pause/resume/cancel/retry with honest mid-call limits, per-file
  results, error recovery (a failed file never stops the batch),
  engine limits enforced per job (`LimitExceeded`, not a crash);
  `openpixel batch --workers N` / `--sequential` (old sequential
  batch kept as fallback) and `openpixel bench` (`--quick` smoke
  mode); `scripts/test/bench.sh`; real benchmark numbers in
  `docs/BENCHMARKS.md` (AVIF encode ~9.3 s vs WebP ~17 ms for
  1024x768 — the headline result). 171 tests pass (was 152).
  `--pause-after N` was deliberately not added: in a
  non-interactive CLI run there is nothing useful to do with a
  paused queue except resume it immediately.
- [x] **Phase 7 — Web Application** (done 16 Nov 2026, verified by
  coordinator): React +
  TypeScript + Vite + Tailwind, conversion + batch UI, settings,
  capability dashboard generated from the engine registry
  (`openpixel --json formats`); real local canvas conversion in a
  Web Worker for PNG/JPEG/WebP/BMP (GIF first frame, SVG, AVIF
  sources where the browser decodes them); WASM **not** available in
  this build — the full engine does not compile to wasm32 here
  (`dav1d-sys` needs a wasm32 libdav1d sysroot that does not exist;
  only `openpixel-formats` builds to wasm32), so no WASM module is
  shipped and the UI says so (see `docs/WEB.md`). Full conversion
  (TIFF, AVIF, JXL, SVG, EXR, …) still needs the native CLI /
  desktop app. `npm test` 17 passed; `npm run build` passes;
  Rust workspace unchanged at 171 tests. See `docs/TESTING.md` for
  the verification results and the manual browser checklist that
  still needs a real browser run. (WASM itself landed later as
  follow-up item 2, 16 Nov 2026 — see Follow-ups below.)
- [x] **Phase 8 — Desktop Application** (done 16 Nov 2026, verified
  by coordinator): Tauri 2, native file picker, drag-and-drop, offline mode,
  installers (Windows/macOS/Linux). Delivered as `apps/desktop/`:
  Tauri 2.12.4 backend over `openpixel-core` / `openpixel-jobs` +
  React/Vite/Tailwind frontend; Convert / Batch / Formats / Settings /
  Logs tabs; capability list read live from the engine registry
  (21 formats); application log file in the app data dir. Linux
  `.deb` + `.AppImage` build verified on this VM (see
  `docs/DESKTOP.md` for the `libzstd-dev` sysroot workaround and for
  what is still missing: Windows/macOS installers, arbitrary rotation
  in the UI). Rust workspace unchanged at 171 tests; backend has its
  own test suite (see `docs/TESTING.md`).
- [x] **Phase 9 — Production QA** (done 16 Nov 2026, verified by
  coordinator):
  security audit over the whole codebase (6 findings fixed: unbounded
  zlib decompression in PNG metadata, GIF canvas allocated before the
  limit check, TIFF page decoded before the limit check, CLI batch
  reading files without a size limit, unbounded GIF/APNG/WebP frame
  scans, engine `read_input` TOCTOU — see `docs/SECURITY-AUDIT.md`;
  no timeouts and no RSS cap remain accepted risks), cargo-fuzz
  targets for detection + decode + metadata
  (`crates/openpixel-codecs/fuzz/`, nightly + libfuzzer), licence
  audit + CycloneDX SBOMs (`sbom.json`, 236 components;
  `apps/desktop/src-tauri/sbom.json`, 570 components; native licence
  texts completed in `native/licenses/`), benchmark re-run (see
  `docs/BENCHMARKS.md`), cross-platform build notes
  (`docs/BUILD.md` — Linux verified, Windows/macOS not attempted),
  release packaging (`scripts/release/package-cli.sh`,
  `scripts/release/generate-sbom.py`). Rust workspace 176 tests
  (was 171); web `npm test` 17 passed, desktop `npm test` 11 passed,
  desktop backend `cargo test` 16 passed (see `docs/TESTING.md` for
  the full Phase 9 verification table).

- [x] **HEIC/HEIF follow-up** (done 16 Nov 2026, verified by
  coordinator): HEIC/HEIF moved from detection-only to full
  decode+encode via pure-Rust `heifer` 0.5.1 — no libheif, no C
  library, MIT OR Apache-2.0. The libheif route stayed blocked
  (installed `libheif1` 1.23.3-1 has no matching `-dev`; the
  system `heif-enc` ships no HEVC/AV1 encoder at all), and a
  vendored libheif source build was not attempted because the
  pure-Rust route superseded it. Proven against Apple
  `sips`-encoded fixtures (MAE 0.00–0.77 vs Apple's reference
  decode) and cross-checked with system libheif (`heif-info` /
  `heif-convert` read our output). Registry now 18 codecs /
  3 planned (APNG, RAW, PSD), 17 decode+encode, 21 capabilities.
  Rust workspace 182 tests (was 176). See `docs/CODECS.md` and
  `docs/TESTING.md`.

## Follow-ups (approved 16 Nov 2026 — HEIC, WASM and Windows/macOS builds done; E2E still open)

- [x] **WASM engine** (dav1d-free build so the web app can convert
  natively) — done 16 Nov 2026 (follow-up item 2): `native-avif`
  cargo feature gates the dav1d AVIF codec off for wasm32 (on by
  default natively); `openpixel-core` + `openpixel-codecs` build for
  `wasm32-unknown-unknown`; `crates/openpixel-wasm` exposes
  detect / info / convert via wasm-bindgen (wasm-pack 0.15.1);
  the web app loads it lazily and uses it for conversions the
  canvas cannot do (TIFF / QOI / HEIC / JXL / JPEG 2000 / ICO /
  PNM / TGA / GIF targets and sources), with canvas fallback.
  AVIF is honestly unavailable in WASM (no wasm32 libdav1d) and
  the engine reports it as such. Verified in Node: `wasm-pack
  test --node` 2/2 and a standalone script converting a real PNG
  to 7 formats with re-detection. Rust workspace 195 tests (was
  182); web `npm test` 28 passed (was 17). See `docs/WEB.md` and
  `docs/TESTING.md`. Still open: a real-browser click-through of
  the WASM conversion flows (no browser tooling in this session).
- [x] **Windows/macOS builds** (CI + installers) — done 16 Nov 2026
  (follow-up item 3): `.github/workflows/release.yml` ("Build")
  builds the CLI and the Tauri desktop app on `ubuntu-24.04`,
  `windows-latest` and `macos-latest` plus the web app on Ubuntu
  (push/PR to `main`, manual dispatch; build + `upload-artifact`
  only — no release is created, nothing is published). Pinned
  actions (`actions/checkout@v4`, `dtolnay/rust-toolchain@v1`
  with toolchain 1.100.0, `Swatinem/rust-cache@v2`,
  `actions/setup-node@v4`, `actions/upload-artifact@v4`);
  per-platform dav1d via apt (Linux), vcpkg (Windows) and
  Homebrew (macOS). YAML parses and `actionlint` 1.7.7 reports no
  findings. `tauri.conf.json` bundle targets are now `deb`,
  `appimage`, `msi`, `nsis`, `dmg`, `app`, with a generated
  `icons/icon.icns` for macOS; the Linux `.deb` + `.AppImage`
  still build with the new config. Cross-compiles attempted on
  this VM: `cargo check` for `x86_64-pc-windows-gnu`,
  `x86_64-apple-darwin` and `aarch64-apple-darwin` all fail only
  at `dav1d-sys` (pkg-config not configured for
  cross-compilation); the dav1d-free `--no-default-features`
  check passes on Windows and macOS targets. **Still open: no
  Windows/macOS installer has been produced — the workflow has
  never run; the first real build happens on a GitHub runner or
  a real machine.** See `docs/BUILD.md` and `docs/TESTING.md`.
- [ ] **Full end-to-end testing** (real browser + desktop
  click-through).

Each phase: small milestones, tests with every feature, stop-and-report
before the next phase. No phase claims a format it has not implemented
and tested.
