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

## Not yet enforced (honest gaps — Phases 5–9)

- **Processing timeouts:** Phase 1 conversions are synchronous with no
  timeout. A pathological file can take a long time. Timeouts + worker
  isolation land with the Job Manager (Phase 6).
- **Memory limits (RSS):** pixel-count limits bound the decoded buffer,
  but there is no OS-level RSS cap yet. Phase 6 bounds concurrency
  instead of capping RSS: at most `workers` images are decoded at
  once (default 4), each bounded by `EngineConfig`, so worst-case
  live pixel data is `workers x 100 MP x 4 bytes` — see
  `docs/BENCHMARKS.md` (measured peak RSS 70 MiB for the whole
  bench suite). For very large images, run with `--workers 1`.
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
