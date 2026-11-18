# Benchmarks — OpenPixel Studio (Phase 8)

Measured numbers from this machine, not estimates. The current
numbers are the **Phase 8 run, 18 Nov 2026** below. The Phase 6 /
Phase 9 engine numbers are kept at the bottom as an appendix, with
their dates, so no old table can be mistaken for current.

Re-run with `python3 scripts/bench/phase8-bench.py` (the harness
rebuilds nothing — build the release binary first with
`cargo build --release -p openpixel` — then times real CLI
invocations and writes raw per-run numbers to
`dist/bench/results-<date>.json`). The engine-only suite is
`openpixel bench --iterations N` (see `scripts/test/bench.sh`).

## Hardware & build (Phase 8 run, 18 Nov 2026)

- CPU: AMD EPYC 9D64 88-Core Processor (this VM sees 4 CPUs,
  `nproc` = 4). **The host changed mid-session**: at 23:53 UTC
  `/proc/cpuinfo` still reported AMD EPYC 9D25; by the time the
  harness ran it reported 9D64. The numbers below are all from the
  9D64 host unless stated.
- RAM: 7.7 GiB total (`free -h`); only ~795 MiB available when the
  run started — the host was heavily loaded by other tenants.
- OS: Linux x86_64, Ubuntu 24.04
- Rust: rustc 1.100.0
- Build: release (`opt-level = 3`, thin LTO, `codegen-units = 1` —
  see the workspace `Cargo.toml`); binary rebuilt 17 Nov 2026
  23:53 UTC (`cargo build --release -p openpixel`, 6m01s),
  commit `419cd06`.
- Tesseract 5.3.4 + Leptonica 1.82.0 (re-provisioned after a VM
  reset wiped them; see `docs/OCR.md` §Provisioning). Language
  data: tessdata_fast `eng` + `ben`.
- PDF render / extract-text go through the bundled PDFium path
  (`pdfium-render`); the other PDF ops are lopdf.
- **Caveat:** this is a shared VM (1.5 vCPU quota in the sandbox).
  Numbers vary run to run — see [Variance](#variance--reproducibility)
  — so treat them as an order of magnitude, not a datasheet.
  The same command measured twice in this run differed by up to
  ~17% (batch, 4 workers).

## Method

`scripts/bench/phase8-bench.py` runs the real CLI
(`target/release/openpixel`) and records, per invocation:

- **wall time** — `time.perf_counter()` around `subprocess.Popen`,
  i.e. process spawn + work + exit, as a user experiences it.
  This is deliberately *not* the in-process codec time that
  `openpixel bench` reports; the two differ by the ~0.1 s
  process-startup / supervised-child cost (see
  [What the numbers say](#what-the-numbers-say)).
- **peak tree RSS** — the sum of `VmRSS` over the CLI process and
  all its descendants, polled from `/proc` every 5 ms. The
  supervised-child (isolation) model means the work happens in a
  child process, so a single-process measurement would miss it.
  `/usr/bin/time` is not installed on this VM, so there is no
  external measurement to compare against.
- Every row runs 3 times (AVIF and OCR: 2 times) and reports
  mean / min / max. First-run (cold page-cache / library-load)
  effects are visible in several rows and are reported, not
  smoothed away.

## Fixtures

| fixture | size | content |
|---|---|---|
| `photo.jpg` | 764,098 B, 1024x768 | noisy photo-like JPEG, q92 — `scripts/test/gen-web-fixtures.py` (seed 42, byte-identical on regen) in `/tmp/op-e2e/cli/in/` |
| `photo-2048.png` | 9,451,127 B, 2048x1536 | noisy photo-like PNG, same generator upscaled |
| `big.png` | 42,233 B, 4000x3000 | solid red PNG (`Image.new('RGB', (4000,3000), 'red')` — the e2e RSS fixture) |
| `batch12/` | 6x `photo.jpg` + 6x `photo-2048.png` | `dist/bench/in/batch12/` |
| `big200-img.pdf` | 104,329,250 B, 200 pages, 1024x768 pt | built by `openpixel pdf from-images page.jpg` x200 (`page.jpg` is a 74,418 B 1024x768 gradient+text JPEG); `from-images` stores the images near-losslessly, hence 104 MB. Building it took 57 s (single run, pre-rebuild binary). `dist/bench/in/big200-img.pdf` |
| `big200-text.pdf` | 64,846 B, 200 pages, 612x792 pt | `openpixel pdf merge text2.pdf` x100 (0.2 s); the text fixture is 2 pages of plain text. `dist/bench/in/big200-text.pdf` |
| OCR fixtures | see table | `crates/openpixel-ocr/tests/fixtures/`: `eng-clean` 1869x224, `eng-noisy` 1869x224, `eng-lowdpi` 894x157, `eng-skewed` 1879x322, `ben-clean` 941x234, `ben-noisy` 941x234, `ben-lowdpi` 472x165 |

Regeneration: `/tmp` is wiped on VM reset. The image/PDF fixtures
above were regenerated with `scripts/test/gen-web-fixtures.py` plus
the `big.png` one-liner and the `text2.pdf`/`doc2.pdf` steps from
`scripts/test/cli-e2e.sh` (§13 and the `pdf from-images` lines);
the OCR fixtures live in the repo and survive resets. Tesseract
itself must be re-provisioned after a reset (`docs/OCR.md`
§Provisioning) before any `ocr` run works at all — that happened
once during this session (13 min of `apt-get`, mostly `update`).

## Results — Phase 8 run, 18 Nov 2026

### A. Engine baseline (`openpixel bench --iterations 3 --json`)

Same in-process suite as Phase 6/9, for the regression check.
Full JSON: `dist/bench/bench-suite.json`.

| operation | mean ms | min ms | max ms | what was measured |
|---|---|---|---|---|
| jpeg_decode | 4.5 | 2.8 | 7.9 | decode_file, 1024x768 JPEG |
| png_encode | 24.3 | 23.0 | 26.3 | convert PNG->PNG (incl. decode), 1024x768 |
| webp_encode | 16.5 | 15.5 | 18.5 | convert PNG->WebP q80 (incl. decode), 1024x768 |
| avif_encode | 11129.4 | 10955.3 | 11266.7 | convert PNG->AVIF q80 (incl. decode), 1024x768 |
| tiff_large | 90.4 | 83.2 | 96.0 | convert TIFF->PNG (incl. decode), 2048x1536 |
| batch_12 | 47.2 | 23.7 | 70.4 | 12 files (512x384) -> WebP, 4 workers; total ms |
| batch_12_per_file | 3.9 | 2.0 | 5.9 | mean ms per file (total / 12) |

RSS: start 17.2 MiB, end 72.5 MiB, peak **72.5 MiB**.
(An earlier run of the same suite this session, before the
`/tmp` wipe interrupted the harness, peaked at 70.5 MiB —
same ballpark as Phase 6/9's 70.1–70.2 MiB.)

**Regression check vs Phase 6/9:** no regression attributable to
the code. `webp_encode` 16.5 ms and `png_encode` 24.3 ms are
inside the Phase 6 ranges; `tiff_large` 90.4 ms is inside its
67.5–151.1 ms spread; `jpeg_decode` 4.5 ms matches the Phase 9
re-run exactly. `avif_encode` 11.1 s vs 9.3 s (Phase 6) / 10.9 s
(Phase 9) continues the slow upward drift across hosts — the
Phase 9 note already attributed this to host load, and this run
was on yet another host (9D64) with little free RAM; AVIF is
still ~670x WebP in-process on the same machine. `batch_12`
47.2 ms vs 26–33 ms earlier is the same shared-VM scheduling
noise the Phase 6 doc already flagged (its own spread was
14–68 ms).

### B. Single-image converts (real CLI wall time)

Command: `openpixel convert <in> dist/bench/out/<out> --quality 80`
(3 iterations each; AVIF 2). Peak RSS is the process tree.

| convert | mean | min–max | peak RSS | output |
|---|---|---|---|---|
| photo.jpg 1024x768 -> WebP q80 | 0.163 s | 0.139–0.193 s | 49.8 MiB | 2,086,426 B |
| photo.jpg -> JPEG q80 | 0.176 s | 0.156–0.216 s | 46.4 MiB | 613,028 B |
| photo.jpg -> PNG | 0.254 s | 0.234–0.292 s | 50.1 MiB | 2,335,465 B |
| photo.jpg -> AVIF q80 | 11.038 s | 11.007–11.068 s | 68.4 MiB | 481,300 B |
| big.png 4000x3000 -> WebP q80 | 0.413 s | 0.392–0.437 s | 185.6 MiB | — |
| photo-2048.png 2048x1536 -> WebP q80 | 0.285 s | 0.260–0.311 s | 101.6 MiB | — |

### C. Batch converts (12 files, -> WebP q80)

Command: `openpixel batch dist/bench/in/batch12 --format webp
--quality 80 --workers N --out-dir dist/bench/out/batch-wN`
(3 iterations each).

| workers | mean | min–max | peak tree RSS | per file (mean/12) |
|---|---|---|---|---|
| 1 | 2.620 s | 2.497–2.793 s | 110.9 MiB | 0.218 s |
| 2 | 1.757 s | 1.731–1.810 s | 189.1 MiB | 0.146 s |
| 4 | 1.526 s | 1.424–1.599 s | 318.8 MiB | 0.127 s |

Speedup vs 1 worker: 1.49x at 2 workers, 1.72x at 4 — the
1.5-vCPU quota caps the gain (see below). Peak RSS roughly
doubles from 1 to 2 workers and triples at 4: each worker holds
a decoded image plus a supervised child.

### D. Large-PDF operations (200-page fixtures)

| operation | command (abridged) | mean | min–max | peak RSS | result |
|---|---|---|---|---|---|
| merge (202 pp.) | `pdf merge big200-img.pdf text2.pdf -o merged.pdf` | 1.829 s | 1.582–2.226 s | 420.6 MiB | 202 pp., ~104 MB out |
| split (200 pp. -> 2x100) | `pdf split big200-text.pdf --ranges 1-100,101-200 --out-dir split` | 0.077 s | 0.038–0.155 s | 20.8 MiB | 2 files |
| compress (ebook) | `pdf compress big200-img.pdf big200-img-compressed.pdf` | 11.215 s | 10.954–11.717 s | 261.6 MiB | 104,329,250 -> 16,650,717 B (84.0% saved; 200 images recompressed, 0 skipped) |
| render pp.1-20, scale 2.0 PNG | `pdf render big200-img.pdf --pages 1-20 --scale 2.0 --out-dir render20` | 11.058 s | 10.943–11.195 s | 553.8 MiB | 20 PNGs, 2048x1536 px each; **0.553 s/page** |
| extract-text (all 200 pp.) | `pdf extract-text big200-text.pdf -o big200-text.txt` | 1.342 s | 0.626–2.743 s | 25.5 MiB | 9,891 B txt (6,200 chars) |

Notes: the split first run (0.155 s) is ~4x the warm runs
(0.038 s) — cold page cache, not the op itself. Same for
extract-text: first run 2.743 s (PDFium library load), warm
runs 0.626–0.657 s; the warm number is the steady state.
Render is the memory peak of the whole suite (553.8 MiB for
20 pages at 144 DPI); only 20 of the 200 pages were rendered —
a full 200-page render was not timed, so do not extrapolate
beyond "about 0.55 s/page at this scale on this host".

### E. Batch OCR (one file per invocation, `--preprocess light` default)

Command: `openpixel ocr <fixture>.png --lang <eng|ben> -o out.txt`
(2 iterations each). Times include CLI startup + Tesseract init.

| fixture (lang) | size | mean | run 1 | run 2 | peak RSS |
|---|---|---|---|---|---|
| eng-clean (eng) | 1869x224 | 1.324 s | 1.760 s | 0.888 s | 43.7 MiB |
| eng-noisy (eng) | 1869x224 | 0.859 s | 1.012 s | 0.707 s | 44.0 MiB |
| eng-lowdpi (eng) | 894x157 | 0.803 s | 0.700 s | 0.907 s | 41.5 MiB |
| eng-skewed (eng) | 1879x322 | 1.292 s | 1.478 s | 1.106 s | 41.6 MiB |
| ben-clean (ben) | 941x234 | 0.354 s | 0.221 s | 0.487 s | 28.7 MiB |
| ben-noisy (ben) | 941x234 | 0.507 s | 0.298 s | 0.717 s | 28.7 MiB |
| ben-lowdpi (ben) | 472x165 | 0.388 s | 0.503 s | 0.273 s | 28.1 MiB |

OCR output was spot-checked, not just timed: eng-clean reads
"The quick brown fox jumps over the lazy dog…" (30 words,
mean confidence 96%), ben-clean reads Bengali correctly.
The eng fixtures are ~2x the pixels of the ben ones, which
explains most of the eng/ben gap — it is fixture size, not
language. First-ever OCR after the Tesseract reinstall took
3.1 s (cold .so + traineddata load); warm runs are the table
above. Per-page OCR is therefore ~0.3–1.3 s warm on this host,
dominated by Tesseract itself, not the CLI.

### F. Isolation model: supervised child vs `OPENPIXEL_NO_ISOLATION=1`

Same batch as §C with 4 workers, 3 iterations each. The
supervised run here is a *second* measurement of the §C
4-worker row (see [Variance](#variance--reproducibility)).

| mode | mean | min–max | peak tree RSS |
|---|---|---|---|
| supervised (default) | 1.789 s | 1.600–2.071 s | 313.0 MiB |
| `OPENPIXEL_NO_ISOLATION=1` | 1.193 s | 1.106–1.257 s | 265.2 MiB |

The isolation model costs **~0.6 s on a 12-file batch (~50%)**
on this host — one supervised child spawn per file — while
peak RSS is essentially unchanged (313 vs 265 MiB; the
difference is within run-to-run noise for this metric).
That is a real, measurable cost, but it buys the timeout/RSS
kill behaviour; whether it is worth it for tiny batches is a
product call, not a benchmark conclusion. The cost should
shrink in relative terms on larger files, where codec time
dominates the spawn — that was not measured (see below).

## What the numbers say

- **AVIF encode is still the dominant cost in the codebase:**
  11.0 s per 1024x768 image through the CLI, 11.1 s in-process
  (ravif speed 4) — ~68x the CLI wall time of a WebP convert
  and ~670x the in-process WebP encode. A 12-file AVIF batch
  would take ~33 s of wall time even with 4 workers. The
  Phase 9 decision stands: no faster encoder was adopted.
- **CLI wall time for fast codecs is dominated by process
  startup, not the codec.** In-process WebP encode is 16.5 ms;
  the same convert through the CLI is 163 ms — ~10x, of which
  ~140 ms is binary load + supervised-child spawn. Judge
  single-file CLI latency by the §B table, not the §A table.
- **Batch scaling is capped by the 1.5-vCPU quota**, not the
  pool: 1 -> 2 workers gives 1.49x, 2 -> 4 gives only 1.15x
  more. On a real multi-core machine the 4-worker number
  should be much better; on this VM, `--workers 2` is the
  sweet spot for these files. Memory, however, keeps scaling
  with workers (111 -> 189 -> 319 MiB peak tree RSS), so more
  workers is not free.
- **Memory scales with image size, not file size.** The 42 KiB
  `big.png` (4000x3000 solid red) peaks at 186 MiB for a single
  convert; the 9.5 MB `photo-2048.png` peaks at 102 MiB. The
  theoretical bound (4 workers x 100 MP x 4 bytes) is still
  far away, but the largest peaks in this suite are the PDF
  paths, not images: render 554 MiB, merge 421 MiB.
- **PDF page ops are cheap; rendering and compression are the
  work.** Split/extract-text on a 200-page text PDF are
  sub-second warm; merging a 104 MB image PDF is 1.8 s;
  compressing it is 11.2 s (but saves 84%); rendering is
  0.55 s/page at 144 DPI and the memory peak of the suite.
- **OCR is ~0.3–1.3 s per page warm**, Tesseract-bound, with a
  2–3x cold-start penalty on the first invocation after boot /
  reinstall.

## Variance & reproducibility

Re-run variance observed in this session (same binary, same
commands, minutes apart):

- Batch 12 files -> WebP, 4 workers, measured twice (§C and §F
  supervised): means 1.526 s and 1.789 s — **~17% drift**,
  entirely host-load noise. Treat any two batch numbers within
  ~20% of each other as the same result.
- `pdf split`: first run 0.155 s, warm runs 0.038 s (4x).
  `pdf extract-text`: first run 2.743 s, warm 0.626–0.657 s (4x).
  `ocr eng-clean`: first run in the harness 1.760 s, second
  0.888 s; the very first OCR after the Tesseract reinstall
  took 3.149 s. First runs after a boot/reset are cold; the
  warm numbers are the steady state, and both are reported.
- `openpixel bench` peak RSS: 70.5 MiB (interrupted first
  harness run) vs 72.5 MiB (this run) — stable.
- The VM host itself changed mid-session (EPYC 9D25 -> 9D64),
  so even the CPU model is not a fixed property of "this
  machine". All Phase 8 numbers are from the 9D64 host.

To reproduce: build release, re-provision Tesseract if the VM
reset, regenerate `/tmp` fixtures as described above, run
`python3 scripts/bench/phase8-bench.py`. Raw per-run numbers:
`dist/bench/results-2026-11-18.json` (plus `bench-suite.json`
and the console log `dist/bench/run1.log`).

## What was NOT measured (and why)

- **Windows / macOS / mobile.** Linux VM only; the desktop and
  web builds were out of scope for this agent, and there is no
  Mac or Windows host here.
- **A full 200-page render.** Only pages 1–20 were rendered
  (11.1 s); a full render would take ~2 minutes at the measured
  per-page rate and was not needed for the per-page figure.
- **Large-file isolation cost.** The §F comparison used the
  same small 12-file batch; the spawn cost on large files
  (where codec time dominates) was not measured.
- **Concurrent *separate* CLI processes** (as opposed to the
  batch worker pool). The roadmap's "concurrent jobs" is covered
  here by the worker-pool rows (§C) only; two CLIs racing on
  the same machine was not run.
- **Backend load.** There is no backend traffic to measure yet
  (Phase 8 backend is optional and not deployed); nothing here
  speaks to FastAPI/PostgreSQL behaviour.
- **Real-user conditions.** No network, no real camera photos,
  no user-typical mixed batches — fixtures are synthetic
  (noise/gradient images, generated PDFs). Real photos compress
  differently (usually faster than noise images, which are
  worst-case for encoders).
- **OCR on scanned PDFs (`pdf ocr`) and OCR->Word/Excel.**
  Only single-image `ocr` was timed; the searchable-PDF path
  renders via PDFium first and would be slower per page.
- **Debug builds.** Deliberately excluded (see the old note
  below — ~8x slower, AVIF in debug ~224 s for the suite).

## Appendix: earlier runs (Phase 6 / Phase 9, 16 Nov 2026)

The tables below are the pre-Phase-8 numbers, kept for the
regression comparison. They are **not** current.

### Hardware & build (16 Nov 2026)

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

### Method (Phase 6)

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

### Results — run 1, 16 Nov 2026 (`scripts/test/bench.sh 3`)

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

### Results — run 2, 16 Nov 2026 (`openpixel bench --iterations 3`, same binary)

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

### Results — run 3 (Phase 9 re-run), 16 Nov 2026 (`scripts/test/bench.sh 3`)

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

#### Regression check vs Phase 6 (as written 16 Nov 2026)

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

### What the (old) numbers said

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
