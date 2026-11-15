# Roadmap — OpenPixel Engine

- [x] **Phase 1 — Foundation** (this delivery): workspace, core types,
  error system, magic-byte detection, capability registry, JPEG/PNG/BMP/
  GIF/TIFF/WebP/TGA/ICO/PNM/QOI via image-rs, CLI (`info/convert/formats/
  capabilities/batch`), security limits, unit + integration tests, docs.
  **Stop here for approval before Phase 2.**
- [ ] **Phase 2 — Codec Registry**: codec traits, dynamic registry,
  format discovery, adapter architecture; harden JPEG/PNG/WebP/BMP/GIF/TIFF.
- [ ] **Phase 3 — Native Codecs**: libjpeg-turbo, libwebp, libavif,
  libheif, libtiff; evaluate libjxl + OpenJPEG; SVG rasterisation (resvg).
- [ ] **Phase 4 — Processing Pipeline**: resize, crop, rotate, flip,
  fit/fill/pad, thumbnail, grayscale, brightness/contrast/saturation,
  blur, sharpen, watermark, background colour.
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
