//! Windows main-thread stack reserve for the `openpixel` binary.
//!
//! The CLI's startup path (clap parsing + engine initialisation)
//! uses between 1 MiB and 2 MiB of main-thread stack in a debug
//! build — measured locally 17 Nov 2026 by running the debug binary
//! under `ulimit -s`: `--version` overflows at a 1 MiB stack and
//! passes at 2 MiB; the release binary is fine at 1 MiB. Windows
//! gives the main thread only 1 MiB by default (Linux gives 8 MiB),
//! so the debug binary overflowed its stack on every invocation on
//! Windows CI (all four `batch_cli` integration tests failed with
//! "thread 'main' has overflowed its stack", run 44031017970) even
//! though the same binary passes everywhere on Linux/macOS.
//!
//! This reserves 8 MiB for the main thread — the same as Linux's
//! default — via the MSVC linker's /STACK flag. It is a link-time
//! setting only; it changes no code and no behaviour besides the
//! stack size. It applies to the CLI binary (and its test
//! binaries); the desktop app and WASM builds are unaffected.

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        println!("cargo:rustc-link-arg=/STACK:8388608");
    }
}
