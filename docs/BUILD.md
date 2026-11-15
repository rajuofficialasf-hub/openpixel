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

## Troubleshooting

- `rustc: command not found` — source `$HOME/.cargo/env` or reopen the shell.
- `cargo build` fails on network — first build needs crates.io; check
  connectivity, then retry. `Cargo.lock` pins every version.
- Slow first build — normal; `image-rs` and its dependencies take a few
  minutes on a first compile. Later builds are incremental.
