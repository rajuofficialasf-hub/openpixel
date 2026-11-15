# Build — OpenPixel Engine (Phase 1)

## Requirements

- Rust stable **1.100.0** (verified 15 Nov 2026 on Ubuntu 24.04, x86_64).
  Older stable toolchains may work; 1.100 is the pinned, tested one.
- A C compiler (`gcc`/`cc`) — needed by some transitive Rust crates.
- No system image libraries in Phase 1. No libvips, no libjpeg-turbo,
  no Python. If `cargo build` asks for a system library, something is
  wrong — report it instead of installing one.
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

## Native dependencies (Phase 3 — not needed now)

When libavif / libheif / libjxl / OpenJPEG / resvg / LibRaw are wired
in, per-platform setup scripts go in `scripts/setup/` and build notes
in `native/build/`, with licence files in `native/licenses/`. Do not
install any of them for Phase 1 — the build does not need them and the
registry correctly reports those formats as not implemented.

## Troubleshooting

- `rustc: command not found` — source `$HOME/.cargo/env` or reopen the shell.
- `cargo build` fails on network — first build needs crates.io; check
  connectivity, then retry. `Cargo.lock` pins every version.
- Slow first build — normal; `image-rs` and its dependencies take a few
  minutes on a first compile. Later builds are incremental.
