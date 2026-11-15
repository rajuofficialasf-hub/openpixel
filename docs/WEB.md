# Web Application — OpenPixel Engine (Phase 7, draft — coordinator verifies)

Local-only React web app in `apps/web/` (React 19 + TypeScript + Vite
+ Tailwind CSS 3). There is no server component: the app is static
files, and every image operation runs in the browser. Files never
leave the device.

## How it works

```
User drops a file
  -> File API reads bytes locally
  -> src/lib/detect.ts sniffs magic bytes (1:1 port of the Rust
     detector in crates/openpixel-formats/src/format.rs)
  -> createImageBitmap / <img> decodes it (dimensions, preview)
  -> src/lib/convert.ts sends it to src/worker.ts (Web Worker)
  -> OffscreenCanvas draws it, convertToBlob encodes it
  -> result Blob -> object URL -> Download button
```

- **Conversion worker**: `new Worker(new URL('../worker.ts', import.meta.url))`
  in `convert.ts`. If the worker cannot be created or times out
  (120 s), conversion falls back to the main thread
  (`convertOnMainThread`, same canvas logic via a `<canvas>`
  element) rather than failing. The worker is bundled as its own
  chunk (`dist/assets/worker-*.js`).
- **Capability data**: `src/data/capabilities.json` is generated from
  the engine registry — see `apps/web/README.md` and
  `scripts/generate-capabilities.mjs`. The Formats tab, the output
  selectors and the tests all read this one file; nothing in the app
  hard-codes a format list. Regenerate after any registry change.
- **Settings**: `src/lib/settings.ts`, persisted in localStorage
  under `openpixel.settings.v1` (theme, default quality/format/
  background, metadata policy, batch workers 1–4). No account.
- **Batch**: a small promise pool (up to `batchWorkers`, capped at 4
  in the browser — the CLI allows 8) converts files concurrently;
  per-file status/error; individual downloads plus a client-side zip
  (`jszip`) for "Download all". A failed file never stops the batch.
- **Theme**: Tailwind `darkMode: 'class'`, toggled by a header button
  and the Settings theme selector; `system` follows the OS.
- **Accessibility**: labelled controls, `role="tablist"` tabs with
  `aria-selected`, `role="status"`/`role="alert"` live regions for
  progress and errors, visible `:focus-visible` outlines, keyboard
  operable drop zone (Enter/Space opens the picker).

## What converts where

| Path | Sources | Targets |
|---|---|---|
| Browser canvas (this app) | PNG, JPEG, WebP, GIF (first frame only), BMP, SVG (rasterised), AVIF (only if the browser decodes it) | PNG, JPEG, WebP, BMP |
| Native CLI / desktop app | All 16 engine formats (incl. TIFF, TGA, ICO, PNM, QOI, AVIF, JXL, HDR, EXR, JPEG 2000, SVG) | All 15 engine-encodable formats |

Not convertible anywhere yet: HEIC/HEIF, APNG, RAW, PSD (planned
in the engine, reported as such by the CLI and by this app).

Honest limits of the canvas path, all stated in the UI:

- Metadata is always stripped by a canvas round-trip (EXIF/ICC/XMP).
  "Preserve" in the metadata selector warns and still strips; the
  CLI (`--metadata preserve`) is the way to keep metadata, and only
  for JPEG/PNG targets.
- PNG compression (0/1/2) is accepted and recorded but the browser
  canvas encoder has no PNG compression knob — it does not change
  the in-browser output. The CLI honours it.
- JPEG quality applies to JPEG and WebP targets only; PNG/BMP ignore
  it (same rule as the engine).
- Animated GIF / animated WebP / multi-page TIFF: only the first
  frame/page converts in the browser (same as the engine's plain
  decode). Frame extraction needs the CLI (`openpixel extract-frame`).
- The browser enforces no engine security limits (100 MiB / 100 MP /
  16 384 px); a very large image is bounded only by tab memory.
  The CLI enforces the limits.

## WASM status — not available in this build

Attempted 16 Nov 2026, Rust 1.100.0, Ubuntu 24.04, x86_64:

1. `rustup target add wasm32-unknown-unknown` — installed
   successfully (now listed by `rustup target list --installed`).
2. `cargo build -p openpixel-formats --target wasm32-unknown-unknown`
   — **succeeds** (10.95 s). Magic-byte detection and the capability
   data are pure Rust with no C dependencies and compile to WASM.
   Artefact: `target/wasm32-unknown-unknown/debug/libopenpixel_formats.rlib`.
3. `cargo build -p openpixel-core --target wasm32-unknown-unknown`
   — **fails** (exit 101). `dav1d-sys` 0.8.3 (the AVIF decoder's C
   binding, pulled in via `image`'s `avif-native` feature) panics in
   its build script:
   `PkgConfig(pkg-config has not been configured to support
   cross-compilation. Install a sysroot for the target platform …)`.
   There is no wasm32 libdav1d sysroot on this machine, and building
   one is out of scope for this phase.
4. `wasm-pack` is **not installed** on this machine, so no
   wasm-bindgen packaging was attempted either.

Consequence: **no WASM module is shipped** in this build and none is
claimed. `src/lib/wasm.ts` records this outcome and the app's UI
(Convert tab, footer, Settings "About") states it in plain language.
The canvas path above is the real conversion path in this build.

What would unblock a WASM engine (future work, not this phase): a
wasm32 build of the engine with a dav1d-free feature set (e.g. AVIF
decode disabled or replaced), or a wasm32 libdav1d sysroot, plus
`wasm-pack` + `wasm-bindgen` bindings over the formats/core crates.
The formats crate already compiling to WASM is the first step, not
a finished WASM engine.

## Verification

See `docs/TESTING.md` ("Verified results — Phase 7"). Headline:
`npm run build` passes (tsc + Vite), `npm test` 17/17, dev server
starts, production build serves over plain HTTP (200 on `/` and on
the JS/worker assets), and the Rust workspace is unchanged green
(`cargo test --workspace` 171 passed, 0 failed). No browser-driven
end-to-end conversion was run in this environment (no live-browser
tooling for this subagent); the manual verification checklist in
`docs/TESTING.md` lists the conversion flows to confirm in a real
browser before release.
