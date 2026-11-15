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
- [ ] **Phase 5 — Metadata & Animation**: EXIF/IPTC/XMP/ICC/DPI/
  orientation, metadata policies, colour management (LittleCMS),
  GIF/APNG/animated WebP frames, multi-page TIFF.
- [ ] **Phase 6 — Batch & Performance**: job manager, worker pool,
  bounded concurrency, memory limits, benchmarks, cancellation,
  retry, error recovery.
- [ ] **Phase 7 — Web Application**: React + TypeScript + Vite +
  Tailwind, WASM worker processing, conversion + batch UI, settings.
- [ ] **Phase 8 — Desktop Application**: Tauri 2, native file picker,
  drag-and-drop, offline mode, installers (Windows/macOS/Linux).
- [ ] **Phase 9 — Production QA**: security audit, fuzz tests,
  cross-platform tests, licence audit + SBOM, performance testing,
  release packaging.

Each phase: small milestones, tests with every feature, stop-and-report
before the next phase. No phase claims a format it has not implemented
and tested.
