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
  but there is no OS-level RSS cap yet. Add `ulimit` / cgroup guidance
  for server mode in Phase 6.
- **Fuzz testing:** not yet run. `cargo-fuzz` targets for `detect_format`
  and the decode path are a Phase 9 requirement.
- **SVG:** not implemented. When resvg lands (Phase 3), scripts and
  external resources must be disabled and network access denied by
  default — design constraint, not an afterthought.
- **Metadata:** EXIF/ICC/XMP are not copied in Phase 1, so no metadata
  leaks through outputs *by accident* — but GPS stripping as a *policy*
  (preserve / strip / selected) is a Phase 5 feature.
- **Native-library CVEs:** Phase 1 has no C codec, so there is nothing
  to monitor yet. When libavif/libheif/libjxl land (Phase 3), add
  `cargo audit` + native CVE monitoring and record versions in
  `native/licenses/`.
- **Temporary files:** Phase 1 writes only the final output (no temp
  files). Temp-dir isolation + cleanup is specified for the batch/job
  work in Phase 6.

## Reporting

Security issues in the engine: do not open a public issue with a
proof-of-concept for an unpatched decoder flaw — report it privately
to the maintainers first (contact to be added when the repo is public).
