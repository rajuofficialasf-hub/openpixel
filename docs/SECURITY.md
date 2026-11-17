# Security — OpenPixel Engine (Phase 1)

Image input is untrusted input. Treat every file as hostile until proven otherwise.

## Enforced in Phase 1

- **Never trust the extension.** Detection is by magic bytes
  (`format.rs::detect_format`). A PNG named `.jpg` is reported as PNG
  (integration test `extension_is_not_trusted_for_source`).
- **File-size limit:** 100 MiB (`MAX_FILE_SIZE_BYTES`), checked before reading.
- **Pixel-count limit:** 100 MP (`MAX_PIXELS`) — decompression-bomb guard,
  checked after header decode and before pixel work.
- **Dimension limit:** 16 384 px per side (`MAX_DIMENSION`).
- **Path traversal:** output paths containing `..` or NUL are rejected
  (`security::validate_output_path`). Callers must still join outputs
  under their own directory.
- **Output validation:** after encoding, the output bytes are re-detected
  and must match the requested target format before the file is written.
- **Corrupted input:** a valid signature followed by garbage fails with a
  typed `Decode` error, not a panic (integration test
  `corrupted_file_is_an_error_not_a_crash`).
- **No execution:** uploaded / input content is never executed, never
  passed to a shell, never loaded as code.
- **No network:** Phase 1 makes no network calls. No upload, no external API.

## Phase 8 — Process isolation: true timeout-kill and RSS enforcement

Phase 1 closed accepted risks A8 (processing timeouts) and A9 (RSS
cap) only halfway: a thread timeout **detaches** the worker on
timeout (it keeps running, holding its memory) and the RSS check
is only a **pre-flight** refusal to start. Phase 8 closes both for
real on the CLI paths, where the work runs in a child process the
parent can kill (`openpixel-security::isolated`, regression-tested
in `crates/openpixel-security/src/isolated.rs` and
`crates/openpixel-jobs/src/manager.rs`).

### What is now truly enforced

- **Timeout-kill.** `convert`, `process` (including
  `--target-size`) and `batch` run each conversion in a child
  process — the `openpixel` binary re-executed as the hidden
  `__isolated-work` subcommand, fed one JSON job spec on stdin.
  When the job passes `EngineConfig::processing_timeout`
  (default 300 s), the parent kills the child (SIGKILL on Unix)
  and reaps it. The caller gets an error naming the timeout
  ("processing timed out after 300s — child process \<pid\> was
  killed"), the job is recorded `Failed`, and the batch carries
  on. Nothing keeps running in the background.
- **RSS enforcement.** While the child runs, the parent polls its
  resident memory (Linux `/proc/<pid>/status`, every 25 ms) and
  kills it over `EngineConfig::max_rss_bytes` (default 2 GiB).
  The error names the observed RSS and the cap ("child process
  \<pid\> resident memory … bytes exceeds the RSS cap of …
  bytes — child process was killed"). A job that blows the cap
  fails loudly; it never silently continues.
- **Atomic output.** The worker encodes to memory, writes a temp
  file (`<output>.openpixel-tmp`, same directory) and renames it
  to the final path. A kill mid-write leaves only the temp file —
  never a partial output — and the parent removes the temp file
  after a kill. A successful conversion is never reported with a
  partial file on disk.
- **Exit codes and JSON are unchanged.** A killed job is an error
  result, not a crash: single conversions exit 1 with the limit
  named on stderr; batch reports the file in `failures` (text and
  `--json` `BatchSummary`) and exits 0 for the batch as a whole,
  exactly as for any other failed file.
- **Operator knobs (environment only, no flags):**
  `OPENPIXEL_PROCESSING_TIMEOUT_SECS` (per-conversion timeout),
  `OPENPIXEL_MAX_RSS_MB` (per-conversion RSS cap),
  `OPENPIXEL_NO_ISOLATION=1` (debug escape hatch — runs
  in-process with the old detach-on-timeout behaviour; do not
  use it to "fix" a timeout, raise the timeout instead). An
  unreadable value warns on stderr and falls back to the default.

### Per-surface table — read this before claiming enforcement

| Surface | Timeout | RSS cap | Mechanism |
|---|---|---|---|
| CLI `convert` / `process` / `batch` (Linux) | kill | kill | Child process, `/proc` polling |
| CLI `convert` / `process` / `batch` (Windows/macOS) | kill | **not enforced** | Child process; no `/proc` to read — the cap is accepted and ignored, never claimed |
| CLI `info` / `metadata` / `frames` / `extract-frame` / `ocr` / `pdf` / `doc` | — | — | In-process, as before (fast reads or their own engines) |
| CLI `bench` | — | — | In-process by design (it measures the engine) |
| Desktop app | detach only | pre-flight only | Same engines in-process via `JobManager::for_engine`; no child process yet |
| Web app (WASM) | — | — | In-browser by design: the engine runs in a Web Worker, there are no child processes; the tab's own memory limits apply |

`openpixel-jobs` offers both pools: `new_isolated` /
`for_engine_isolated` (child process, true kill) and the classic
`new` / `for_engine` (in-process, thread timeout, detach).
The desktop app still uses the in-process pool; switching it to
an isolated pool is future work, not done in Phase 8.

### Remaining accepted risks

- **Sampled RSS, not continuous.** The monitor polls every
  25 ms. A spike that allocates and frees between two polls can
  be missed, and a process that exhausts memory faster than one
  poll can be OOM-killed before the monitor sees it. The
  file-size / pixel / dimension limits remain the first line of
  defence; this is the second. A cgroup / `ulimit` cap is still
  the answer for a hard deployment-wide ceiling. (With a very
  small cap — below the worker's own ~19 MiB startup footprint —
  the worker's pre-flight check refuses the job before the
  parent's monitor ever sees it; either way the job fails and
  names the cap.)
- **Only the direct child is killed.** The worker never spawns
  grandchildren (pure engine, no subprocesses), so a kill always
  ends the work — but the supervisor does not kill a process
  group, and a child that did spawn grandchildren would orphan
  them.
- **Cancel still cannot stop a running job.** `JobManager::cancel`
  only cancels queued / paused jobs, in both pools. The timeout
  and RSS cap are the kill paths for a running isolated job.
- **RSS is Linux-only.** On Windows/macOS the CLI enforces the
  timeout kill but not the RSS cap (see the table). Do not
  report an RSS cap as enforced on those platforms.
- **Timeout is per job, not per batch.** A batch of many slow
  files can still take a long time in total; each file is
  individually bounded.

## Not yet enforced (honest gaps — Phases 5–9)

- **Processing timeouts:** Phase 1 conversions are synchronous with no
  timeout. A pathological file can take a long time. Phase 6 added a
  thread timeout (detach-on-timeout) in the jobs pool; Phase 8 added
  a true timeout-**kill** for the CLI paths (`convert` / `process` /
  `batch` run each conversion in a supervised child process — see
  "Phase 8 — Process isolation" above). In-process callers
  (desktop app, WASM) still use the thread timeout only.
- **Memory limits (RSS):** pixel-count limits bound the decoded buffer.
  Phase 6 bounds concurrency instead of capping RSS: at most
  `workers` images are decoded at once (default 4), each bounded by
  `EngineConfig`, so worst-case live pixel data is `workers x
  100 MP x 4 bytes` — see `docs/BENCHMARKS.md` (measured peak RSS
  70 MiB for the whole bench suite). For very large images, run
  with `--workers 1`. Phase 8 enforces the RSS cap for real on
  the CLI paths (Linux only — the parent kills a child over
  `max_rss_bytes`; see "Phase 8 — Process isolation" above).
  A `ulimit` / cgroup cap for server mode is still not set — that
  remains a deployment decision, not an engine default.
- **Fuzz testing:** done in Phase 9 — three `cargo-fuzz` targets
  (`fuzz_detect`, `fuzz_decode`, `fuzz_metadata` under
  `crates/openpixel-codecs/fuzz/`), 3.1 M + 29 k + 5 k runs, 0
  crashes (see `docs/TESTING.md`, "Verified results — Phase 9").
  The audit also fixed six findings the fuzz targets now cover
  (see `docs/SECURITY-AUDIT.md`).
- **SVG:** implemented in Phase 3 (resvg): scripts never execute,
  external resources and network are disabled (`resources_dir`
  stays `None`), and huge canvases are scaled to the limits before
  rasterisation. Re-audited in Phase 9 (see
  `docs/SECURITY-AUDIT.md`); a complexity cap (element count /
  nesting) is still an accepted risk (A11).
- **Metadata:** EXIF/ICC/XMP are not copied in Phase 1, so no metadata
  leaks through outputs *by accident* — but GPS stripping as a *policy*
  (preserve / strip / selected) is a Phase 5 feature.
- **Native-library CVEs:** Phase 3 added one C library
  (dav1d 1.5.0, built from source and statically linked, AVIF
  decode). Phase 9 added `cargo audit`
  + the SBOM (`sbom.json`, `scripts/release/generate-sbom.py`) and
  completed the native licence texts in `native/licenses/`; see
  `docs/TESTING.md` ("Verified results — Phase 9") for the audit
  outcome. Re-run `cargo audit` after any dependency change.
- **Temporary files:** Phase 1 writes only the final output (no temp
  files). Temp-dir isolation + cleanup is specified for the batch/job
  work in Phase 6.

## Reporting

Security issues in the engine: do not open a public issue with a
proof-of-concept for an unpatched decoder flaw — report it privately
to the maintainers first (contact to be added when the repo is public).
