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
any phase. Follow-up item 3 (16 Nov 2026) adds a GitHub Actions
workflow that will build them on real runners, records the
cross-compilation attempts that *can* be made on this VM, and
configures the Tauri bundle targets — but no Windows/macOS
installer has been produced yet; see the subsections below.

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

### Linux (verified)

- Rust 1.100.0, `libdav1d-dev` 1.4.1 (AVIF decode — the only system
  library; `scripts/setup/ubuntu-24.04.sh`), Node v24 / npm 10.9.4
  for the web/desktop frontends.
- Desktop additionally needs WebKitGTK/GTK `-dev` packages; on this
  VM they cannot install via apt (`libzstd-dev` pin conflict — see
  `docs/DESKTOP.md`) and were worked around with a downloaded
  sysroot (`scripts/setup/fetch-tauri-sysroot.sh`). On a clean
  machine or CI runner the same packages install directly with apt
  — the sysroot is a workaround for this VM only, not a build
  requirement.
- Outputs: CLI binary, web `dist/`, desktop `.deb` + `.AppImage`
  (the AppImage step needs FUSE; on this VM it was produced by
  running `linuxdeploy` by hand — see `docs/DESKTOP.md`).

### CI workflow — GitHub Actions (follow-up item 3, 16 Nov 2026)

`.github/workflows/release.yml` ("Build") builds the CLI and the
Tauri desktop app on `ubuntu-24.04`, `windows-latest` and
`macos-latest`, plus the web app on Ubuntu. Triggers: push / PR to
`main`, and manual dispatch. It is build + `upload-artifact` only:
**no release is created, nothing is published, nothing is deployed.**
Artefacts (30-day retention): `openpixel-cli-<OS>-<arch>` (the CLI
binary), `openpixel-desktop-<OS>-<arch>` (the installers),
`openpixel-web-dist` (the web `dist/`).

- Pinned actions: `actions/checkout@v4`,
  `dtolnay/rust-toolchain@v1` (toolchain `1.100.0`, with
  `clippy, rustfmt`), `Swatinem/rust-cache@v2`,
  `actions/setup-node@v4` (Node 24),
  `actions/upload-artifact@v4`.
- Caching: cargo via `Swatinem/rust-cache@v2`; npm via
  `setup-node`'s `cache: npm` with `cache-dependency-path` per
  app (`apps/desktop/package-lock.json`,
  `apps/web/package-lock.json`).
- The workflow references only real jobs/steps in this repo: `cargo
  test --workspace`, `cargo build --release`, `cargo fmt --check`,
  `cargo clippy --workspace --all-targets -- -D warnings` (Linux
  only), `npm ci` / `npm test` / `npm run tauri build` in
  `apps/desktop` (the `tauri` script in its `package.json`), and
  `npm ci` / `npm test` / `npm run build` in `apps/web`.
- Per-platform system deps in CI:
  - Linux: `apt-get install -y libdav1d-dev` (CLI job) plus the
    standard Tauri 2 prerequisites `libwebkit2gtk-4.1-dev
    libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev
    libsoup-3.0-dev` (desktop job) — the exact list from
    `docs/DESKTOP.md`. No sysroot workaround on a clean runner.
  - Windows: `vcpkg install dav1d:x64-windows` (vcpkg is
    preinstalled on `windows-latest`; `VCPKG_INSTALLATION_ROOT`
    is set by the runner) with `PKG_CONFIG_PATH` pointed at
    vcpkg's `installed/x64-windows/lib/pkgconfig`, so `dav1d-sys`
    finds libdav1d via pkg-config. The MSVC C++ workload (linker)
    and the WebView2 runtime are preinstalled on the runner.
  - macOS: `brew install dav1d pkg-config` — Homebrew's dav1d
    provides the library and the `dav1d.pc` file `dav1d-sys`
    looks for. Xcode Command Line Tools are preinstalled on
    `macos-latest`.
- Validation: the YAML parses (`python3 -c "yaml.safe_load"`)
  and `actionlint` 1.7.7 (downloaded release binary — Go is not
  installed on this VM, so `cargo install actionlint` was not an
  option) reports no findings.
- **The workflow has never run.** It was added as a file only; no
  push to GitHub was made (local only, no new account, no cost).
  The first real Windows/macOS build happens when it runs on a
  GitHub runner or a real machine. The vcpkg / Homebrew dav1d
  routes above are the expected routes, not verified ones.

### Cross-compilation attempts on this VM (follow-up item 3, 16 Nov 2026)

This Linux VM cannot natively produce Windows/macOS installers, and
no cross toolchain was installed. The targets were added with
rustup (`rustup target add x86_64-pc-windows-gnu
x86_64-apple-darwin aarch64-apple-darwin`) and the engine crates
were checked against them. Result: the **only** blocker is
`dav1d-sys` (the C AVIF decoder); the pure-Rust engine
cross-checks cleanly.

```bash
cargo check -p openpixel-core -p openpixel-codecs -p openpixel-formats \
  --target x86_64-pc-windows-gnu
# FAILS in the dav1d-sys build script (dav1d-sys 0.8.3, build.rs:82):
#   called `Result::unwrap()` on an `Err` value: PkgConfig(
#   pkg-config has not been configured to support cross-compilation.
#   Install a sysroot for the target platform and configure it via
#   PKG_CONFIG_SYSROOT_DIR and PKG_CONFIG_PATH, or install a
#   cross-compiling wrapper for pkg-config and set it via
#   PKG_CONFIG environment variable.)
cargo check -p openpixel-core -p openpixel-codecs -p openpixel-formats \
  --target x86_64-apple-darwin   # same dav1d-sys failure
cargo check -p openpixel-core -p openpixel-codecs -p openpixel-formats \
  --target aarch64-apple-darwin  # same dav1d-sys failure
```

Diagnostic — the dav1d-free build (the same feature gate the WASM
build uses) cross-checks on both targets, proving no engine code
is at fault:

```bash
cargo check -p openpixel-core -p openpixel-codecs -p openpixel-formats \
  --target x86_64-pc-windows-gnu --no-default-features
# Finished `dev` profile — openpixel-codecs, openpixel-pipeline,
# openpixel-metadata, openpixel-core all check (41.53 s)
cargo check -p openpixel-core -p openpixel-codecs -p openpixel-formats \
  --target x86_64-apple-darwin --no-default-features
# Finished `dev` profile (38.95 s)
```

So on a Windows/macOS machine (or CI runner) the build needs a
`libdav1d` for the target — the vcpkg / Homebrew routes in the CI
workflow above — and nothing else. No dubious cross toolchain was
installed on this VM to force the default-featured check through.

### macOS (not attempted — first build is CI or a real machine)

What is needed (see the CI workflow for the exact steps):
a Rust toolchain (rustup), Xcode Command Line Tools (C compiler
for `dav1d-sys` and other build scripts), and a `libdav1d` for the
target — `brew install dav1d` provides both the library and the
pkg-config file `dav1d-sys` looks for. The desktop app needs the
Tauri macOS prerequisites (Xcode) and bundle targets `dmg`/`app`,
which are now configured in `tauri.conf.json` (see below); the
`.icns` icon (`apps/desktop/src-tauri/icons/icon.icns`) was
generated 16 Nov 2026 with `npx @tauri-apps/cli icon
src-tauri/icons/icon.png` — only the `.icns` was kept, the
Android/iOS/Windows-Store icons that command also emits were
discarded. No macOS-specific code is expected: the engine has no
Linux-only calls except the RSS helpers noted above.

### Windows (not attempted — first build is CI or a real machine)

What is needed (see the CI workflow for the exact steps): a Rust
toolchain with the MSVC target (`rustup toolchain install
stable-x86_64-pc-windows-msvc` plus the Visual Studio Build Tools
C++ workload), and a `libdav1d` for `dav1d-sys` — the crate finds
it via pkg-config, so a vcpkg `dav1d:x64-windows` install with
`PKG_CONFIG_PATH` pointed at it is the expected route; the
alternative is building dav1d from source. The desktop app needs
WebView2 (Tauri's Windows webview — the runtime is normally
preinstalled on Windows 10/11; it is preinstalled on the
`windows-latest` runner) and bundle targets `msi`/`nsis`, which
are now configured in `tauri.conf.json` (see below). An
`icon.ico` for the Windows bundle already existed
(`apps/desktop/src-tauri/icons/icon.ico`). Paths: the engine uses
`std::path` throughout and the CLI/desktop tests cover
Windows-style separators only in a frontend helper test — no
Windows path handling has been exercised end to end. No
Windows-specific code is expected.

### Tauri bundle targets (follow-up item 3, 16 Nov 2026)

`apps/desktop/src-tauri/tauri.conf.json` `bundle.targets` was
`["deb", "appimage"]`; it is now
`["deb", "appimage", "msi", "nsis", "dmg", "app"]`, and the
`bundle.icon` list gained `icons/icon.icns` and `icons/icon.ico`.
Tauri builds only the targets for the current platform, so the
Linux build is unaffected — verified on this VM with
`npm run tauri build` (see `docs/TESTING.md`, follow-up item 3):
the `.deb` (and `.AppImage`, via the hand-run linuxdeploy step)
still build; no `.msi`/`.dmg` is attempted on Linux.

### What is still NOT done (Windows/macOS)

- **No Windows or macOS installer has been produced anywhere.**
  The CI workflow has never run; the first real build happens on
  a GitHub runner or a real Windows/macOS machine.
- The vcpkg dav1d route (Windows) and Homebrew dav1d route
  (macOS) are expected, not verified — a first CI run may still
  fail on pkg-config paths, the MSVC linker, or the AppImage
  FUSE note (Linux: the `.AppImage` step needs FUSE at bundle
  time; the workflow's build step fails loudly if it is missing,
  and the artifact upload uses `if-no-files-found: warn` so a
  missing AppImage does not hide a successful `.deb`).
- `scripts/release/package-cli.sh` is Linux-only (hardcoded
  `TRIPLE=linux-x86_64`, tar.gz): the CI uploads the raw CLI
  binary per OS instead. A cross-platform packaging script is
  future work.
- No Windows path handling has been exercised end to end, and no
  real-browser / desktop click-through has been done on any
  platform (see item 4).

### WASM (shipped — follow-up item 2, 16 Nov 2026; see `docs/WEB.md`)

The engine builds to `wasm32-unknown-unknown` as a **dav1d-free**
build. The AVIF codec is the only one with a C dependency
(`dav1d-sys` via `image`'s `avif-native` feature), so it is gated
behind the `native-avif` cargo feature on `openpixel-codecs`
(on by default; `openpixel-core` re-exports it as its own
`native-avif` feature). A wasm32 build uses
`--no-default-features`, which drops `AvifCodec` from the registry
— the registry then lists AVIF as unavailable (planned entry with
the reason in `status`) instead of silently dropping it. Every
other codec is pure Rust and builds for wasm32, including ravif
(AVIF encode — unused without the codec), resvg, jxl-oxide,
jpeg2k and heifer; verified with
`cargo build -p openpixel-formats -p openpixel-codecs -p openpixel-core --target wasm32-unknown-unknown --no-default-features`.

`crates/openpixel-wasm` (wasm-bindgen 0.2.130, wasm-pack 0.15.1)
exposes detect / discover / info / capabilities /
supported_formats / convert / version over the byte-based engine
API (`Engine::decode_bytes` / `get_image_info_bytes` /
`convert_bytes`, added for this — the file-based engine is
unchanged). Build it with `npm run build:wasm` from `apps/web`
(wasm-pack `--target web --release` into `apps/web/public/wasm/`;
needs `wasm-opt` from binaryen for the optimisation step —
wasm-pack downloads it, or finds a `wasm-opt` on `PATH`; the
first download attempt here failed transiently, the retry found
the `~/.cargo/bin/wasm-opt` installed from the binaryen release).
The generated package is git-ignored (`public/wasm/.gitignore`
contains `*`); a checkout without it runs the canvas path only.
Native behaviour is unchanged: `cargo test --workspace` and
`cargo build --release` still run with all native codecs
(including AVIF).

### Release packaging

- CLI: `scripts/release/package-cli.sh [VERSION]` builds the release
  binary and produces `dist/openpixel-<version>-linux-x86_64.tar.gz`
  (binary + README + LICENSE + docs + `sbom.json` +
  `native/licenses/`) with SHA-256 checksums.
- Desktop: `.deb` / `.AppImage` from `npm run tauri build` (Linux
  only, see `docs/DESKTOP.md`); not rebuilt by the CLI packaging
  script. `tauri.conf.json` now also lists `msi`/`nsis` (Windows)
  and `dmg`/`app` (macOS) bundle targets, built by the CI workflow
  on those runners — no installer has been produced yet (see
  "What is still NOT done" above).
- `scripts/release/package-cli.sh` is Linux-only (hardcoded
  `TRIPLE=linux-x86_64`); the CI workflow uploads the raw CLI
  binary per OS instead.
- SBOM: `scripts/release/generate-sbom.py` (root workspace →
  `sbom.json`; desktop backend → `apps/desktop/src-tauri/sbom.json`).

## Troubleshooting

- `rustc: command not found` — source `$HOME/.cargo/env` or reopen the shell.
- `cargo build` fails on network — first build needs crates.io; check
  connectivity, then retry. `Cargo.lock` pins every version.
- Slow first build — normal; `image-rs` and its dependencies take a few
  minutes on a first compile. Later builds are incremental.
