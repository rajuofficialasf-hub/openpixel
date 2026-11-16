/**
 * WASM status — the outcome of the follow-up item 2 WASM work
 * (16 Nov 2026, see docs/WEB.md for the full evidence).
 *
 * The real Rust engine now compiles to `wasm32-unknown-unknown` as
 * a dav1d-free build (`openpixel-wasm`, feature `native-avif` off)
 * and is packaged with wasm-pack into `public/wasm/` by
 * `npm run build:wasm`. The app loads it lazily
 * (`src/lib/wasm-engine.ts`); when the module is present, TIFF /
 * QOI / HEIC / HEIF / JXL / JPEG 2000 / ICO / PNM / TGA / EXR / HDR
 * sources and TIFF / QOI / HEIC / HEIF / JXL / JPEG 2000 / ICO /
 * PNM / TGA / GIF targets convert with the real engine in the
 * browser. AVIF is still NOT available in WASM — its decoder needs
 * the native libdav1d C library, which has no wasm32 build — and
 * the engine reports it as unavailable instead of claiming it
 * works. Conversions the canvas path already handles stay on the
 * canvas (worker, non-blocking).
 *
 * When the module is absent (a checkout that never ran
 * `build:wasm`), the app works exactly as before: canvas-only
 * conversion, and the extra formats report themselves as needing
 * the native CLI. Nothing here promises a module that is not
 * actually shipped — `wasm-engine.ts` is the runtime truth, this
 * constant is only the human-readable summary shown in the footer.
 */
export const WASM_STATUS = {
  available: true,
  detail:
    'WASM engine: the real Rust engine runs in this browser for TIFF, QOI, HEIC, JXL, JPEG 2000, ' +
    'ICO, PNM, TGA and GIF (when built with `npm run build:wasm`); AVIF is not available in WASM ' +
    '(it needs the native libdav1d library) and still needs the native CLI.',
} as const
