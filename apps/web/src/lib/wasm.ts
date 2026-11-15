/**
 * WASM status — the honest outcome of the Phase 7 WASM attempt
 * (see docs/WEB.md for the full evidence).
 *
 * Attempted 16 Nov 2026, Rust 1.100.0:
 * - `rustup target add wasm32-unknown-unknown` — installed.
 * - `cargo build -p openpixel-formats --target wasm32-unknown-unknown`
 *   — SUCCEEDS: magic-byte detection and the capability data compile
 *   to WASM (pure Rust, no C dependencies).
 * - `cargo build -p openpixel-core --target wasm32-unknown-unknown`
 *   — FAILS: `dav1d-sys` (the AVIF decoder's C binding) panics in
 *   its build script — pkg-config is not configured for
 *   cross-compilation to wasm32, and there is no wasm32 libdav1d
 *   sysroot on this machine. The full engine therefore cannot be
 *   built to WASM here, and no WASM module is shipped in this build.
 * - `wasm-pack` is not installed on this machine.
 *
 * Consequence: this build converts with the canvas path only. The UI
 * states this plainly instead of pretending a WASM engine exists.
 * When the engine gains a wasm32 build (e.g. a dav1d-free feature
 * set), flip `available` to true and wire the module in here.
 */
export const WASM_STATUS = {
  available: false,
  detail:
    'WASM processing is not available in this build: the full Rust engine does not compile to ' +
    'wasm32 here (its AVIF decoder needs the native libdav1d C library, which has no wasm32 ' +
    'build). Format detection alone does compile to WASM. Full conversion — AVIF, JXL, SVG, ' +
    'EXR, TIFF and the rest — needs the native CLI or desktop app.',
} as const
