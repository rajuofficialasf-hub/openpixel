# Build — OpenPixel Engine (Phase 1)

## Requirements

- Rust stable **1.100.0** (verified 15 Nov 2026 on Ubuntu 24.04, x86_64).
  Older stable toolchains may work; 1.100 is the pinned, tested one.
- A C compiler (`gcc`/`cc`) — needed by some transitive Rust crates.
- Phase 3 adds one system image library: `libdav1d-dev` (AVIF
  decode). See "Native dependencies (Phase 3)" below. No libvips,
  no Python. If `cargo build` asks for any other system library,
  something is wrong — report it instead of installing one.
- Internet for the first `cargo build` (crates.io). After that, builds
  are offline from `~/.cargo` + `Cargo.lock`.

## Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
rustc --version   # rustc 1.100.0
cargo --version   # cargo 1.100.0
```

On this machine Rust was *not* pre-installed; rustup installed it during
Phase 1 (see the test report in TESTING.md).

## Build & test

```bash
cd openpixel-engine
./scripts/build/build.sh    # cargo build --release
./scripts/test/test.sh      # cargo test --workspace
# or directly:
cargo build --release
cargo test --workspace
cargo clippy --workspace -- -D warnings   # when clippy is available
cargo fmt --check
```

## Run the CLI

```bash
./target/release/openpixel info photo.jpg
./target/release/openpixel convert photo.png photo.webp --quality 85
./target/release/openpixel formats
```

## Native dependencies (Phase 3)

Phase 3 needs exactly one system library:

```bash
sudo ./scripts/setup/ubuntu-24.04.sh   # installs libdav1d-dev (AVIF decode)
```

- `libdav1d-dev` ≥ 1.3.0 (Ubuntu 24.04 ships 1.4.1) — AVIF decode
  only. The build fails at `dav1d-sys` with a pkg-config error if
  it is missing; the error names the package. Runtime needs
  `libdav1d7`, which comes with the `-dev` package.
- Everything else in Phase 3 is pure Rust from crates.io — no other
  system library, no libheif, no libjxl, no OpenJPEG C library.
  (HEIC/HEIF is blocked on a missing matching `libheif-dev` —
  see `docs/CODECS.md`; do not force-install it.)
- The build still works fully offline after the first build
  (`~/.cargo` + `Cargo.lock`), except that the final binary links
  `libdav1d` dynamically at runtime.

## Cross-platform build notes (Phase 9)

Verified on **Linux x86_64, Ubuntu 24.04** only (see
`docs/TESTING.md` for the exact verification runs). Everything below
about Windows / macOS is **what is known and what would be needed —
not attempted, not claimed.** No Windows or macOS build was run in
any phase.

### What is portable by construction

- The engine, codecs, pipeline, metadata and jobs crates are pure
  Rust + `std` except for one system C library (below). No
  platform-specific code exists in the engine except two Linux-only
  conveniences that degrade gracefully elsewhere:
  `openpixel-jobs` RSS helpers read `/proc/self/status` on Linux and
  return `None` on other platforms; the CLI bench reports peak RSS
  only on Linux.
- `Cargo.lock` pins every crate version exactly, so the same tree
  resolves on any platform.

### Linux (verified)

- Rust 1.100.0, `libdav1d-dev` 1.4.1 (AVIF decode — the only system
  library; `scripts/setup/ubuntu-24.04.sh`), Node v24 / npm 10.9.4
  for the web/desktop frontends.
- Desktop additionally needs WebKitGTK/GTK `-dev` packages; on this
  VM they cannot install via apt (`libzstd-dev` pin conflict — see
  `docs/DESKTOP.md`) and were worked around with a downloaded
  sysroot (`scripts/setup/fetch-tauri-sysroot.sh`).
- Outputs: CLI binary, web `dist/`, desktop `.deb` + `.AppImage`
  (the AppImage step needs FUSE; on this VM it was produced by
  running `linuxdeploy` by hand — see `docs/DESKTOP.md`).

### macOS (not attempted)

What would be needed: a Rust toolchain (rustup), Xcode Command Line
Tools (C compiler for `dav1d-sys` and other build scripts), and a
`libdav1d` for the target — Homebrew's `dav1d` package provides both
the library and the pkg-config file `dav1d-sys` looks for, so
`brew install dav1d` is the expected one-liner (not verified). The
desktop app would additionally need the Tauri macOS prerequisites
(Xcode, `tauri.conf.json` bundle targets `dmg`/`app` — currently
only `deb`/`appimage` are configured) and an `.icns` icon (not
present — Linux bundles do not need one). No macOS-specific code is
expected: the engine has no Linux-only calls except the RSS helpers
noted above.

### Windows (not attempted)

What would be needed: a Rust toolchain with the MSVC target
(`rustup toolchain install stable-x86_64-pc-windows-msvc` plus the
Visual Studio Build Tools C++ workload), and a `libdav1d` for
`dav1d-sys` — the crate finds it via pkg-config, so a vcpkg
`dav1d:x64-windows` install with `PKG_CONFIG_PATH` pointed at it is
the expected route (not verified); the alternative is building
dav1d from source. The desktop app would additionally need
WebView2 (Tauri's Windows webview — the runtime is normally
preinstalled on Windows 10/11) and `tauri.conf.json` bundle targets
`msi`/`nsis` (not configured). Paths: the engine uses `std::path`
throughout and the CLI/desktop tests cover Windows-style separators
only in a frontend helper test — no Windows path handling has been
exercised end to end. No Windows-specific code is expected.

### WASM (not shipped — see `docs/WEB.md`)

`openpixel-formats` builds to `wasm32-unknown-unknown`; the full
engine does not (`dav1d-sys` needs a wasm32 libdav1d sysroot that
does not exist here). A wasm32 engine build would need either a
dav1d-free feature set or that sysroot, plus `wasm-pack`.

### Release packaging

- CLI: `scripts/release/package-cli.sh [VERSION]` builds the release
  binary and produces `dist/openpixel-<version>-linux-x86_64.tar.gz`
  (binary + README + LICENSE + docs + `sbom.json` +
  `native/licenses/`) with SHA-256 checksums.
- Desktop: `.deb` / `.AppImage` from `npm run tauri build` (Linux
  only, see `docs/DESKTOP.md`); not rebuilt by the CLI packaging
  script.
- SBOM: `scripts/release/generate-sbom.py` (root workspace →
  `sbom.json`; desktop backend → `apps/desktop/src-tauri/sbom.json`).

## Troubleshooting

- `rustc: command not found` — source `$HOME/.cargo/env` or reopen the shell.
- `cargo build` fails on network — first build needs crates.io; check
  connectivity, then retry. `Cargo.lock` pins every version.
- Slow first build — normal; `image-rs` and its dependencies take a few
  minutes on a first compile. Later builds are incremental.
