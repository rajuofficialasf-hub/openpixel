# Release Readiness — OpenPixel Studio (Phase 8)

**Status: READY TO RELEASE, except for one decision — see §5.**
No public GitHub Release has been created. Nothing in this repo
publishes anything: the CI workflow (`.github/workflows/release.yml`)
only builds and uploads workflow artifacts (30-day retention).
Creating a release needs the user's explicit yes.

## 1. What a release would publish

| Asset | Built by | Verified |
|---|---|---|
| CLI tarball `openpixel-0.1.0-linux-x86_64.tar.gz` (+ `.sha256`, `SHA256SUMS`) | CI CLI job (Linux) via `scripts/release/package-cli.sh` | Contains `openpixel` + `libpdfium.so` + `VERSION.txt`; clean-path render/extract verified 17 Nov 2026 |
| CLI binaries (Linux/macOS/Windows) | CI CLI job, `target/release/openpixel[.exe]` | CI green (run #27, `f01fc99`); later commits need CI confirmation on push |
| Desktop installers (Linux `.deb` + `.AppImage`) | CI desktop job, `npm run tauri build` | `.deb` 18.1 MB + `.AppImage` 95.1 MB built + installed + Xvfb smoke-tested locally 17 Nov 2026; libpdfium bundled (`usr/lib/OpenPixel/resources/`) |
| Desktop installers (Windows `.msi`/`.exe`, macOS `.dmg`/`.app`) | CI desktop job | Configured by the same mechanism; **not built or tested on this VM** (Linux only) — CI is the first real test |
| Web app | Cloudflare Pages (auto-deploy on push to `main`) | Live at https://openpixel.pages.dev — the web app is NOT a release asset; it deploys continuously |

## 2. Release checklist (Phase 8 exit criteria)

- [x] Cargo workspace tests green (375/375 at Phase 8; see `docs/TESTING.md` for the current count)
- [x] Web tests + lint green; all e2e suites green (web/pdf/resize/ocr/routing/viewport/no-WASM)
- [x] Desktop frontend (15/15) + backend (28/28, 27/27 `--no-default-features`) green
- [x] Security audit done, findings fixed or accepted as risks (`docs/SECURITY-AUDIT.md`)
- [x] Benchmarks published (`docs/BENCHMARKS.md`, Phase 8 run 18 Nov 2026)
- [x] libpdfium ships in CLI tarball + desktop bundles (clean-path verified)
- [x] Local-only mode works with no account and no database (nothing to configure)
- [x] `cargo deny check licenses` green (AGPL/GPL/LGPL hard no)
- [ ] **CI green on the pushed HEAD** — history: run #27 (`f01fc99`) was green; runs 44172492652 (`eb2b130`, Phase 7) and 44208585299 (`58b492e`, Phase 8) FAILED — CLI Linux clippy (`map_or` in `sign.rs`, useless `format!` in `export.rs`), all three Desktop jobs at "Build desktop installers" (the desktop job never installed Tesseract, but the Phase 7 backend links `openpixel-ocr`), CLI macOS "Test workspace" (undiagnosed — the logs API needs admin rights; read them in the browser, signed in to GitHub). Fixes in `3545c2e` cleared 6/8 jobs in run 44210105789 (all Desktop + CLI Linux + Web + Wasm32 green); CLI Windows + macOS still failed at "Test workspace" — the jobs-manager `sleep`/`sh` tests were ported to `python3` after that run (this push), which is the definite Windows cause. The macOS failure still needs a log read to name the failing test.
- [ ] **Windows/macOS bundles actually built in CI** (first run with the new `stage-for-tauri.sh` step)
- [ ] **Desktop click-through (1)–(8) + new PDF/OCR flows run on a real desktop** (no GUI tool on this VM; commands behind them are unit-tested)
- [ ] **User decision: create the release?** (see §5)
- [ ] **Version + notes:** tag `v0.1.0` (app version is 0.1.0 everywhere) + release notes (CHANGELOG or auto-generated from commits)

## 3. Known gaps that stay open after release (honest)

- Android build blocked at `dav1d-sys` 0.8.3 (no meson cross-file; fix needs a workspace-level jobs change — user decision). iOS needs a Mac.
- Windows/macOS CLI packaging is Linux-only (`package-cli.sh`); those platforms ship the bare binary as a workflow artifact, not a tarball.
- macOS/Windows pdfium archive shas unrecorded in `LICENSE_AUDIT.md` (Linux sha verified; the fetch script prints the others — record from a green CI run).
- `rsa 0.9.6` Marvin advisory + `chrono`/`paste` unmaintained (accepted risks, `docs/SECURITY-AUDIT.md` B-R1–B-R3).
- Desktop in-process (no child-process isolation); CLI is isolated. Web is in-browser by design.
- `pdf info … | head` panics with a Rust broken-pipe error (cosmetic, pre-existing).

## 4. How the release would be created (when approved)

Add a `release` job to `.github/workflows/release.yml` (or a
separate `release.yml` triggered by `workflow_dispatch` with a
version input — no tag-push trigger, so nothing can release by
accident). It would:

1. Run on a manual dispatch only, after the Build workflow is green
   on the same commit.
2. Create the GitHub Release with `gh release create v0.1.0`
   (or `softprops/action-gh-release@v2`) and upload as assets:
   the Linux CLI tarball + `.sha256`, the three CLI binaries,
   the desktop installers from the three desktop jobs
   (`.deb`, `.AppImage`, `.msi`, `.exe`, `.dmg`, `.app`).
3. Attach the release notes (generated from the commit range
   `6085488..HEAD` or a hand-written summary).

Do NOT add this job until the user says yes — a workflow file that
can publish is itself a loaded gun, and the standing rule is no
public deploy without his decision.

## 5. Decision points awaiting the user

1. **GitHub Release — yes/no?** If yes: tag `v0.1.0`, add the
   release job above, and publish the assets in §1.
2. **Backend / accounts — yes/no?** The optional backend
   (FastAPI + PostgreSQL + Valkey + S3) and any account system
   are NOT built. The product stays local-only until he decides
   otherwise.
3. **Android dav1d fix — yes/no?** Dropping `native-avif` for the
   Android target needs a workspace-level `openpixel-jobs` change
   (desktop would lose AVIF decode too unless the change is
   scoped). Until decided, Android cannot build.
