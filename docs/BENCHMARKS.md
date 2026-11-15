# Benchmarks — OpenPixel Engine (Phase 6)

Measured numbers from this machine, not estimates. Re-run with
`scripts/test/bench.sh [N]` (default 3 iterations) — it rebuilds
the release binary, prints the hardware, and runs
`openpixel bench --iterations N`.

## Hardware & build (16 Nov 2026)

- CPU: AMD EPYC 9D25 126-Core Processor (this VM sees 4 CPUs, `nproc` = 4)
- RAM: 7.7 GiB total (`free -h`)
- OS: Linux x86_64, Ubuntu 24.04
- Rust: rustc 1.100.0
- Build: release (`opt-level = 3`, thin LTO, `codegen-units = 1` —
  see the workspace `Cargo.toml`)
- **Caveat:** this is a shared VM (1.5 vCPU quota in the sandbox).
  Numbers vary run to run — the batch row especially (14–68 ms
  across iterations) — so treat them as an order of magnitude,
  not a datasheet. AVIF is the exception: it is stable at ~9.3 s
  in both runs, so that number is solid.

## Method

`openpixel bench` generates its own fixtures in a temp dir (a
gradient, so every codec sees the same pixels) and deletes them
afterwards. Every row runs N times and reports mean / min / max.

- `jpeg_decode` — `Engine::decode_file` on a 1024x768 JPEG.
- `png_encode` — convert PNG -> PNG (includes the decode; the
  engine has no encode-only entry point, so every "encode" row is
  a full convert — the labels say so).
- `webp_encode` — convert PNG -> WebP, quality 80, 1024x768.
- `avif_encode` — convert PNG -> AVIF, quality 80 (ravif, speed
  4), 1024x768.
- `tiff_large` — convert a 2048x1536 TIFF -> PNG.
- `batch_12` — 12 files (6 PNG + 6 JPEG, 512x384) -> WebP through
  `JobManager` with 4 workers; total time and mean per file.
- Peak memory is the process peak RSS (`VmHWM` from
  `/proc/self/status`), read by the bench itself — `/usr/bin/time`
  is not installed on this VM, so there is no external
  measurement to compare against. `openpixel bench --quick` uses
  small fixtures (256x192 base, 4-file batch) for a smoke run;
  its timings are not comparable to a full run.

## Results — run 1, 16 Nov 2026 (`scripts/test/bench.sh 3`)

| operation | mean ms | min ms | max ms | what was measured |
|---|---|---|---|---|
| jpeg_decode | 3.1 | 2.5 | 4.5 | decode_file, 1024x768 JPEG |
| png_encode | 24.6 | 23.2 | 26.9 | convert PNG->PNG (incl. decode), 1024x768 |
| webp_encode | 16.7 | 16.0 | 17.4 | convert PNG->WebP q80 (incl. decode), 1024x768 |
| avif_encode | 9328.2 | 9285.6 | 9405.8 | convert PNG->AVIF q80 (incl. decode), 1024x768 |
| tiff_large | 96.2 | 70.9 | 119.8 | convert TIFF->PNG (incl. decode), 2048x1536 |
| batch_12 | 32.7 | 14.1 | 68.2 | 12 files (512x384) -> WebP, 4 workers; total ms |
| batch_12_per_file | 2.7 | 1.2 | 5.7 | mean ms per file (total / 12) |

RSS: start 5.3 MiB, end 46.3 MiB, peak **70.2 MiB**.

## Results — run 2, 16 Nov 2026 (`openpixel bench --iterations 3`, same binary)

| operation | mean ms | min ms | max ms |
|---|---|---|---|
| jpeg_decode | 3.6 | 2.5 | 5.7 |
| png_encode | 25.4 | 24.0 | 26.7 |
| webp_encode | 18.1 | 16.0 | 21.4 |
| avif_encode | 9277.0 | 9249.2 | 9323.9 |
| tiff_large | 74.6 | 67.5 | 85.7 |
| batch_12 | 26.0 | 16.1 | 45.4 |
| batch_12_per_file | 2.2 | 1.3 | 3.8 |

RSS: start 5.2 MiB, end 46.4 MiB, peak **70.2 MiB** (identical
to run 1 — the peak is set by the AVIF encode + fixture buffers,
not by run-to-run noise).

## Results — run 3 (Phase 9 re-run), 16 Nov 2026 (`scripts/test/bench.sh 3`)

| operation | mean ms | min ms | max ms |
|---|---|---|---|
| jpeg_decode | 4.5 | 2.8 | 7.7 |
| png_encode | 26.4 | 24.9 | 27.5 |
| webp_encode | 16.5 | 15.7 | 17.5 |
| avif_encode | 10898.7 | 10574.8 | 11257.6 |
| tiff_large | 120.7 | 98.7 | 151.1 |
| batch_12 | 30.1 | 19.5 | 50.9 |
| batch_12_per_file | 2.5 | 1.6 | 4.2 |

RSS: start 5.2 MiB, end 46.0 MiB, peak **70.1 MiB**.

Hardware this run: CPU reported as AMD EPYC 9D64 88-Core Processor
(Phase 6 runs reported 9D25 — the shared VM host changed between
phases), `nproc` = 4, RAM 7.7 GiB, Rust 1.100.0, release build
(same profile). Only 385 MiB of RAM was free when the run started
(the machine was heavily loaded by other tenants), so treat the
absolute numbers with the usual shared-VM caution.

### Regression check vs Phase 6

No code in the conversion paths changed in Phase 9 (only security
pre-checks that run before decode, and metadata caps), so no
regression was expected — and none is attributable to the code:

- `jpeg_decode` 4.5 ms vs 3.1/3.6, `png_encode` 26.4 vs 24.6/25.4,
  `tiff_large` 120.7 vs 96.2/74.6: slower, but within the run-to-run
  spread already seen in Phase 6 (e.g. `tiff_large` ranged
  67.5–119.8 ms across its own two runs) and on a busier host with a
  different CPU model — noise, not a regression.
- `avif_encode` 10.9 s vs 9.3 s (~17% slower): same story — AVIF
  was stable at ~9.3 s in both Phase 6 runs on the quieter host;
  the Phase 9 host was loaded. The headline stands: AVIF encode is
  still ~600x WebP encode on this machine.
- `webp_encode` 16.5 ms and `batch_12` 30.1 ms are inside the Phase 6
  ranges; peak RSS 70.1 MiB is identical to Phase 6 (70.2 MiB).

## What the numbers say

- **AVIF encode is ~500x slower than WebP encode** on this
  machine (9.3 s vs ~17 ms for the same 1024x768 image, ravif
  speed 4). It dominates any batch that targets AVIF: a
  12-file AVIF batch would take ~28 s of wall time even with 4
  workers (12 x 9.3 s / 4), while the same batch to WebP takes
  ~30 ms. That is the single most important performance fact in
  this codebase, and it is why
  the batch default target in examples is WebP, not AVIF.
  (Whether a faster AVIF encoder — e.g. a native libavif
  encode path — is worth it was a Phase 9 decision: **not pursued
  in Phase 9**. No faster encoder was adopted; AVIF stays ravif
  speed 4, and the Phase 9 re-run confirms the cost (10.9 s on a
  loaded host). A libavif encode path remains future work.)
- **WebP is the fastest lossy target** here (~17 ms incl.
  decode); PNG encode (~25 ms) is close behind.
- **The batch pool works:** 12 files in ~26–33 ms total with 4
  workers is ~2–3 ms per file — the pool overhead (thread
  wakeup, result recording) is invisible next to codec time
  for these small files. The min/max spread (14–68 ms) is
  shared-VM scheduling noise, not pool overhead: the same
  spread does not appear in the single-op rows.
- **Peak RSS 70 MiB** for the whole suite (fixtures up to
  2048x1536 + one AVIF encode in flight) is far below the
  theoretical bound (4 workers x 100 MP x 4 bytes = 1.6 GiB).
  The bound is a worst case for 100 MP images, not a typical
  one — see `crates/openpixel-jobs/src/lib.rs` for the
  reasoning, and run with `--workers 1` for very large images.
- **Debug builds are not comparable:** the debug test binary
  took ~224 s for a single full bench run (AVIF in debug), vs
  ~28 s for 3 release iterations. That is why the CLI
  integration test uses `bench --quick`, and why
  `scripts/test/bench.sh` always builds release first.
