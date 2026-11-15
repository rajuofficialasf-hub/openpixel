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
  (ravif encode + system dav1d decode — needs `libdav1d-dev`, see
  `scripts/setup/ubuntu-24.04.sh`), JPEG XL (jxl-oxide decode +
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
  still needs a real browser run.
- [ ] **Phase 8 — Desktop Application**: Tauri 2, native file picker,
  drag-and-drop, offline mode, installers (Windows/macOS/Linux).
- [ ] **Phase 9 — Production QA**: security audit, fuzz tests,
  cross-platform tests, licence audit + SBOM, performance testing,
  release packaging.

Each phase: small milestones, tests with every feature, stop-and-report
before the next phase. No phase claims a format it has not implemented
and tested.
