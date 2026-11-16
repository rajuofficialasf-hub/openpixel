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
| Browser canvas (this app) | PNG, JPEG, WebP, GIF (first frame only), BMP, SVG (rasterised), AVIF (only if the browser decodes it) | PNG, JPEG, WebP |
| WASM engine (this app, when built — see below) | Everything the canvas path handles, plus TIFF, QOI, HEIC, HEIF, JXL, JPEG 2000, ICO, PNM, TGA, EXR, HDR | Everything the canvas path handles, plus BMP, TIFF, QOI, HEIC, HEIF, JXL, JPEG 2000, ICO, PNM, TGA, GIF |
| Native CLI / desktop app | All 16 engine formats (incl. TIFF, TGA, ICO, PNM, QOI, AVIF, JXL, HDR, EXR, JPEG 2000, SVG) | All 15 engine-encodable formats |

Not convertible anywhere yet: APNG, RAW, PSD (planned in the
engine, reported as such by the CLI and by this app). HEIC/HEIF
convert natively and in WASM since follow-up item 1 (16 Nov 2026).

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
- BMP is decodable by the canvas but NOT encodable by it:
  `canvas.toBlob(blob, 'image/bmp')` silently returns PNG, so a
  "BMP" download used to be PNG bytes named `.bmp` (caught by the
  web e2e on 16 Nov 2026). BMP targets are routed to the WASM
  engine instead; without the WASM module BMP is not offered as a
  target at all.
- Animated GIF / animated WebP / multi-page TIFF: only the first
  frame/page converts in the browser (same as the engine's plain
  decode). Frame extraction needs the CLI (`openpixel extract-frame`).
- The browser enforces no engine security limits (100 MiB / 100 MP /
  16 384 px); a very large image is bounded only by tab memory.
  The CLI enforces the limits.

## WASM status — shipped (follow-up item 2, 16 Nov 2026)

The real Rust engine runs in this browser. What changed since
Phase 7:

1. **Feature-gating.** The AVIF codec is the only one with a C
   dependency — dav1d decode via `image`'s `avif-native` feature
   (`dav1d-sys` 0.8.3, whose build script panics on wasm32). It is
   now behind the `native-avif` cargo feature on
   `openpixel-codecs` (on by default; re-exported by
   `openpixel-core`). A wasm32 build turns it off
   (`--no-default-features` on `openpixel-core`, propagated with
   `default-features = false` on every `openpixel-codecs`
   dependency so feature unification cannot switch it back on).
   The registry then reports AVIF as unavailable (planned entry,
   reason in `status`) instead of dropping it or claiming it
   works. Everything else in the dependency tree builds for
   wasm32 as-is — checked empirically, crate by crate: ravif,
   resvg/usvg, jxl-oxide, zune-jpegxl, jpeg2k, heifer, image-rs
   (jpeg/png/bmp/gif/tiff/webp/tga/ico/pnm/qoi/avif-encode/hdr/exr),
   tintbox, gif, tiff, flate2. No other gating or workaround was
   needed. `cargo build -p openpixel-formats -p openpixel-codecs
   -p openpixel-core --target wasm32-unknown-unknown
   --no-default-features` succeeds (3m 31s first build).
2. **The bindings.** `crates/openpixel-wasm` (wasm-bindgen
   0.2.130, serde-wasm-bindgen 0.6.5) exposes `detect` /
   `discover` / `info` / `capabilities` / `supported_formats` /
   `convert(bytes, target, quality?, background?)` / `version`
   over the engine's byte-based API (`Engine::decode_bytes` /
   `get_image_info_bytes` / `convert_bytes` — added in this
   change; the file-based engine API is unchanged and the native
   build still runs all codecs including AVIF). The module is
   stateless (one fresh `Engine` per call), byte-in / byte-out,
   no filesystem, no network, no upload. Errors are plain
   strings on the JS side.
3. **Packaging.** `wasm-pack` 0.15.1 (installed with
   `cargo install wasm-pack --locked`; `rustup target add
   wasm32-unknown-unknown` was already installed). Build with
   `npm run build:wasm` from `apps/web` — wasm-pack
   `--target web --release` into `apps/web/public/wasm/`
   (`openpixel_wasm.js` 14.5 kB + `openpixel_wasm_bg.wasm`
   7,288,565 bytes after `wasm-opt`, plus `.d.ts`). The first
   `wasm-pack` run failed downloading binaryen (transient);
   `wasm-opt` 130 was installed from the binaryen release
   tarball to `~/.cargo/bin/wasm-opt` and the rebuild found it
   there and succeeded. The generated package is git-ignored
   (`public/wasm/.gitignore` contains `*`): a checkout that
   never ran `build:wasm` has no module and the app runs the
   canvas path only, exactly as before.
4. **UI wiring** (`src/lib/wasm-engine.ts`, `src/lib/convert.ts`,
   `ConvertWorkspace`, `BatchWorkspace`). The module loads
   lazily, once, via a `@vite-ignore` dynamic import of
   `/wasm/openpixel_wasm.js` — Vite must not fail the app build
   over a generated file that may be absent. `convertImage`
   tries WASM first **only** for conversions the canvas path
   cannot do at all (a source the browser cannot decode, or a
   target the canvas cannot encode); everything the canvas
   handles stays on the worker (non-blocking — WASM runs
   synchronously on the calling thread). If the module is absent
   or the engine rejects the conversion, the canvas path runs
   and errors honestly. `probeImage` falls back to WASM `info()`
   when `createImageBitmap` fails (TIFF / QOI / HEIC …), and the
   format selectors offer the WASM engine's extra targets once
   its support list has loaded. The result reports which engine
   did the work (`engine: 'wasm' | 'canvas'`), and the UI notes
   WASM conversions. WASM conversions strip metadata, like the
   canvas path (the binding always uses the strip policy) —
   the Preserve warning covers both.
5. **Verified in a real WASM runtime** (Node 24, no browser
   tooling in this session): `wasm-pack test --node` runs the
   in-wasm tests — 2/2 pass (PNG → JPEG/WebP with re-detection
   as the target, AVIF honestly unavailable, 21 capabilities).
   The standalone script
   `crates/openpixel-wasm/scripts/verify-node.mjs` imports the
   built `--target nodejs` package as a JS consumer would and
   converts the real 64×64 fixture PNG to JPEG, WebP, PNG,
   TIFF, QOI, HEIC and JXL — 17/17 checks pass, every output
   re-detected as its target. The production build serves the
   module (`vite preview`: `/` 200, `/wasm/openpixel_wasm.js`
   200, `/wasm/openpixel_wasm_bg.wasm` 200).

Honest limits of the WASM path, all stated in the UI:

- AVIF is not available in WASM (no wasm32 libdav1d). The
  engine reports it as unavailable; the UI never offers it as
  a WASM conversion, and AVIF sources still need the browser
  itself or the native CLI.
- No preview for WASM-only sources (TIFF, QOI, …): the browser
  cannot display them, so the UI shows the dimensions and a
  note instead of a broken image.
- Metadata is always stripped by a WASM conversion (same as the
  canvas path). "Preserve" warns and still strips; the CLI
  (`--metadata preserve`) is the way to keep metadata, and only
  for JPEG/PNG targets.
- The browser enforces no engine security limits on the canvas
  path, but the WASM path does enforce them: the byte API runs
  the same `check_file_size` / `check_dimensions` as the file
  API (100 MiB / 100 MP / 16 384 px).
- The module is ~7.3 MB (optimised) — the first load fetches
  it; after that it is cached like any other asset. A dev
  (unoptimised) build is ~9.2 MB.
- No real-browser click-through has been run in this session
  (no Chromium/Playwright here): the WASM conversion flows in
  the UI are verified at the module level (Node) and at build
  level (tsc + Vite + vitest), and the manual browser checklist
  in `docs/TESTING.md` lists the flows to confirm in a real
  browser before release.

## Verification

See `docs/TESTING.md` ("Verified results — Phase 7" and "Verified
results — WASM engine, follow-up item 2"). Headline after item 2:
`npm run build` passes (tsc + Vite), `npm test` 28/28, dev server
starts, production build serves over plain HTTP (200 on `/`, on
the JS/worker assets, and on `/wasm/openpixel_wasm.js` +
`/wasm/openpixel_wasm_bg.wasm`), and the Rust workspace is green
(`cargo test --workspace` 195 passed, 0 failed). No browser-driven
end-to-end conversion was run in this environment (no live-browser
tooling for this subagent); the manual verification checklist in
`docs/TESTING.md` lists the conversion flows to confirm in a real
browser before release.
