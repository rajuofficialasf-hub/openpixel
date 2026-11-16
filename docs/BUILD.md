# Build — OpenPixel Engine (Phase 1)

## Requirements

- Rust stable **1.100.0** (verified 15 Nov 2026 on Ubuntu 24.04, x86_64).
  Older stable toolchains may work; 1.100 is the pinned, tested one.
- A C compiler (`gcc`/`cc`) — needed by some transitive Rust crates.
- Phase 3 adds one C dependency, dav1d (AVIF decode), but it is
  built from source and linked statically — no system library.
  See "Native dependencies (Phase 3)" below. No libvips,
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

Phase 3 needs exactly one C library, dav1d (AVIF decode) — built
from source and linked statically, never taken from the system:

```bash
sudo ./scripts/setup/ubuntu-24.04.sh   # installs meson, ninja, nasm (dav1d build tools)
```

- `dav1d-sys` clones dav1d 1.5.0 from code.videolan.org and builds
  it with meson (`-Ddefault_library=static`). `.cargo/config.toml`
  forces this with `SYSTEM_DEPS_DAV1D_BUILD_INTERNAL=always`:
  the probe's default is to *never* build internally, so without
  the setting a machine with a system libdav1d would link it
  dynamically — and shipped binaries would fail to start on
  machines without it (verified 16 Nov 2026: the Windows
  installers did not even contain `dav1d.dll`). Build tools
  needed: meson (>= 0.49), ninja, nasm >= 2.14 on x86/x86_64,
  a C compiler, and network access to code.videolan.org on the
  first build (the clone lives in the build output dir afterwards,
  so later builds are offline). No system libdav1d is installed
  or used; do NOT install `libdav1d-dev`.
- Everything else in Phase 3 is pure Rust from crates.io — no other
  system library, no libheif, no libjxl, no OpenJPEG C library.
  (HEIC/HEIF is blocked on a missing matching `libheif-dev` —
  see `docs/CODECS.md`; do not force-install it.)
- The shipped binaries need no libdav1d at runtime: `ldd` on the
  Linux CLI binary shows no `libdav1d`, and the Windows binaries
  do not import `dav1d.dll` (both verified 16 Nov 2026).

## Cross-platform build notes (Phase 9)

Verified on **Linux x86_64, Ubuntu 24.04** only (see
`docs/TESTING.md` for the exact verification runs). Everything below
about Windows / macOS is **what is known and what would be needed —
not attempted, not claimed.** No Windows or macOS build was run in
any phase. Follow-up item 3 (16 Nov 2026) adds a GitHub Actions
workflow that builds them on real runners, records the
cross-compilation attempts that *can* be made on this VM, and
configures the Tauri bundle targets — Windows/macOS installers
are now produced by CI (runs 43832448184–43842730311, all 7 jobs
green); see the subsections below.

### What is portable by construction

- The engine, codecs, pipeline, metadata and jobs crates are pure
  Rust + `std` except for one C library, dav1d, which is built from source and statically linked (below). No
  platform-specific code exists in the engine except two Linux-only
  conveniences that degrade gracefully elsewhere:
  `openpixel-jobs` RSS helpers read `/proc/self/status` on Linux and
  return `None` on other platforms; the CLI bench reports peak RSS
  only on Linux.
- `Cargo.lock` pins every crate version exactly, so the same tree
  resolves on any platform.

### Linux (verified)

- Rust 1.100.0, meson + ninja + nasm (dav1d build tools — dav1d is
  built from source and statically linked; `scripts/setup/ubuntu-24.04.sh`),
  Node v24 / npm 10.9.4 for the web/desktop frontends.
- Desktop additionally needs WebKitGTK/GTK `-dev` packages; on this
  VM they cannot install via apt (`libzstd-dev` pin conflict — see
  `docs/DESKTOP.md`) and were worked around with a downloaded
  sysroot (`scripts/setup/fetch-tauri-sysroot.sh`).
- Outputs: CLI binary, web `dist/`, desktop `.deb` + `.AppImage`
  (the AppImage step needs FUSE; on this VM it was produced by
  running `linuxdeploy` by hand — see `docs/DESKTOP.md`).

### Linux (verified)

- Rust 1.100.0, meson + ninja + nasm (dav1d build tools — dav1d is
  built from source and statically linked; `scripts/setup/ubuntu-24.04.sh`),
  Node v24 / npm 10.9.4 for the web/desktop frontends.
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
- Per-platform system deps in CI (dav1d is built from source and
  linked statically on all three — see `.cargo/config.toml`):
  - Linux: `apt-get install -y meson ninja-build nasm pkg-config`
    (CLI job) plus the standard Tauri 2 prerequisites
    `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
    patchelf libgtk-3-dev libsoup-3.0-dev` (desktop job) — the
    exact list from `docs/DESKTOP.md`. No sysroot workaround on a
    clean runner.
  - Windows: `choco install nasm ninja -y` plus `python -m pip
    install meson` (dav1d build tools; MSVC and the WebView2
    runtime are preinstalled on the runner). meson must come from
    pip, not choco: choco's meson MSI only updates the registry
    PATH, which later steps do not see — run 43850509466 failed
    on "meson failed: program not found" despite a successful
    choco install of meson 1.12.1. No vcpkg, no pkg-config, no
    DLL handling — the old dynamic-link route failed three CI
    runs in a row (missing pkg-config, empty
    `VCPKG_INSTALLATION_ROOT`, DLL not on PATH) and produced
    installers without `dav1d.dll`.
  - macOS: `brew install meson ninja nasm pkg-config`. Xcode
    Command Line Tools are preinstalled on `macos-latest`.
- Validation: the YAML parses (`python3 -c "yaml.safe_load"`)
  and `actionlint` 1.7.7 (downloaded release binary — Go is not
  installed on this VM, so `cargo install actionlint` was not an
  option) reports no findings.
- The workflow has run repeatedly since the 16 Nov 2026 push to
  GitHub (runs 43832448184–43842730311): all 7 jobs pass on
  Ubuntu/Windows/macOS, and all 7 artifacts are uploaded
  (CLI + desktop installers + web dist). The dav1d build-tool
  routes above are the verified ones; the old vcpkg / Homebrew
  libdav1d routes are retired (see the workflow header comment).

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

So on a Windows/macOS machine (or CI runner) the build needs the
dav1d build tools for the target — the meson / ninja / nasm routes
in the CI workflow above — and nothing else. No dubious cross
toolchain was installed on this VM to force the default-featured
check through.

> NOTE (16 Nov 2026): the `dav1d-sys` failure quoted above
> predates the static-link change — with
> `SYSTEM_DEPS_DAV1D_BUILD_INTERNAL=always` the probe no longer
> uses pkg-config at all, so a cross-check today would fail later,
> inside the vendored meson build (no cross C compiler
> configured). This subsection has not been re-verified since.

### macOS (CI builds pass since 16 Nov 2026 — run 43842730311)

What is needed (see the CI workflow for the exact steps):
a Rust toolchain (rustup), Xcode Command Line Tools (C compiler
for `dav1d-sys` and other build scripts), and the dav1d build
tools — `brew install meson ninja nasm pkg-config` (dav1d itself
is built from source and statically linked; no `libdav1d` is
installed). The desktop app needs the
Tauri macOS prerequisites (Xcode) and bundle targets `dmg`/`app`,
which are now configured in `tauri.conf.json` (see below); the
`.icns` icon (`apps/desktop/src-tauri/icons/icon.icns`) was
generated 16 Nov 2026 with `npx @tauri-apps/cli icon
src-tauri/icons/icon.png` — only the `.icns` was kept, the
Android/iOS/Windows-Store icons that command also emits were
discarded. No macOS-specific code is expected: the engine has no
Linux-only calls except the RSS helpers noted above.

### Windows (CI builds pass since 16 Nov 2026 — run 43842730311)

What is needed (see the CI workflow for the exact steps): a Rust
toolchain with the MSVC target (`rustup toolchain install
stable-x86_64-pc-windows-msvc` plus the Visual Studio Build Tools
C++ workload), and the dav1d build tools — `choco install nasm
meson ninja -y` (dav1d itself is built from source and statically
linked; the old vcpkg `dav1d:x64-windows` + `PKG_CONFIG_PATH`
route is retired — it failed three CI runs and produced
installers without `dav1d.dll`). The desktop app needs
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

- Windows/macOS installers ARE produced by CI now (run
  43842730311, all 7 jobs green) — but the pre-static-link
  installers lacked `dav1d.dll`, so they would fail to start on
  a fresh machine. The static-link fix (16 Nov 2026) is awaiting
  its first CI run; the new artifacts must be re-verified
  (`objdump` must show no `dav1d.dll` import) before anyone is
  told the installers are ready.
- The AppImage FUSE note still stands (Linux: the `.AppImage`
  step needs FUSE at bundle time; the workflow's build step
  fails loudly if it is missing, and the artifact upload uses
  `if-no-files-found: warn` so a missing AppImage does not hide
  a successful `.deb`).
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
