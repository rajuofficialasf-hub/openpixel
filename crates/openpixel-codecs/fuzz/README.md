# Fuzzing — OpenPixel Engine (Phase 9)

`cargo-fuzz` targets for the three places untrusted bytes enter the
engine. All three targets assert the same contract: **any input must
degrade to a typed error, never a panic, abort, or unbounded
allocation.**

| Target | What it fuzzes |
|---|---|
| `fuzz_detect` | `detect_format` + `discover` (magic-byte sniffing, the security boundary) |
| `fuzz_decode` | detect → `dimensions()` → `decode()` through the registry, in the engine's own order and with the engine's limits (16 384 px / side, 100 MP) applied before decoding |
| `fuzz_metadata` | `extract_metadata` (EXIF/ICC/XMP), `animation_info`, GIF frame + TIFF page extraction |

## Prerequisites

- `cargo-fuzz` (`cargo install cargo-fuzz`) and a **nightly** Rust
  toolchain (`rustup toolchain install nightly`). Stable cannot
  build libfuzzer targets. Both were installed on this machine in
  Phase 9 (cargo-fuzz 0.13.2, nightly 1.102.0).
- dav1d build tools (meson, ninja, nasm — same as the normal
  build; see `scripts/setup/ubuntu-24.04.sh`).

## Run

```bash
cd crates/openpixel-codecs
cargo +nightly fuzz run fuzz_detect -- -max_total_time=60
cargo +nightly fuzz run fuzz_decode -- -max_total_time=300
cargo +nightly fuzz run fuzz_metadata -- -max_total_time=300
```

Each run prints executions, coverage and any crash. A crash is saved
under `fuzz/artifacts/<target>/` — minimise it (`cargo +nightly fuzz
cmin <target>`), add a regression test for the minimised input, fix,
then re-run the target against the artifact (`cargo +nightly fuzz run
<target> fuzz/artifacts/<target>/crash-<hash>`).

Seed corpus: `fuzz/corpus/<target>/` holds small real files (PNG,
JPEG, WebP, BMP, GIF incl. a 3-frame animation, TIFF, SVG, a
truncated PNG, garbage). Add a seed whenever a new format or parser
lands — the fuzzer mutates from these.

## Notes

- `fuzz_decode` applies the engine dimension limits itself before
  calling `decode()`: a codec that allocated straight from an
  unchecked header would otherwise OOM on a crafted header, and the
  target would report the *engine's* missing pre-check rather than a
  codec bug. The pre-check is part of the contract being fuzzed.
- The fuzz crate (`fuzz/Cargo.toml`) is its own workspace and is
  excluded from the root workspace (`exclude` in the root
  `Cargo.toml`), so `cargo test --workspace` never builds it.
- `cargo fuzz` needs network only the first time (to fetch
  `libfuzzer-sys`); afterwards it builds offline from `Cargo.lock`.
- No-timeout rule: the fuzzer runs single-threaded per target by
  default; use `-jobs=N` to parallelise on a bigger machine.
