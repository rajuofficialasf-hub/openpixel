# OpenPixel — Desktop Application (Phase 8)

Tauri 2 desktop app over the native Rust engine (`openpixel-core` /
`openpixel-jobs`). No server, no uploads, no account: every conversion
runs on this machine through the same `Engine` the CLI uses.

## Layout

```
apps/desktop/
  package.json            # React 19 + Vite + Tailwind frontend (pinned exact)
  src/                    # frontend: Convert / Batch / Formats / Settings / Logs
    lib/tauri.ts          # typed invoke wrappers + pure path/format helpers
    lib/settings.ts       # on-device settings (localStorage)
  src-tauri/
    Cargo.toml            # backend crate `openpixel-desktop` (own workspace, see below)
    tauri.conf.json       # app config: window, CSP, bundle targets (deb, appimage)
    capabilities/         # Tauri 2 permissions (core + dialog + asset protocol)
    src/
      lib.rs              # Tauri builder: dialog plugin, state, invoke handler
      commands.rs         # Tauri commands — thin wrappers over Engine / JobManager
      logging.rs          # append-only log file (no external crate)
```

## Why the backend is not a root workspace member

`src-tauri/Cargo.toml` carries its own `[workspace]` table. Tauri 2
pulls a GUI toolkit (WebKitGTK/GTK on Linux) and an async runtime
into the build; making it a root member would make
`cargo test --workspace` link the GUI libraries and compile the whole
Tauri tree for every engine test run. The engine workspace stays
green on its own; the backend has its own lockfile and commands (see
below). No conversion logic is duplicated: the frontend only sends
paths + options, the backend only calls `Engine` / `JobManager`.

## Features (all real, no decorative controls)

- **Convert**: native open-file dialog (filters from the engine
  registry) or drag-and-drop onto the window; preview via the asset
  protocol; source info from `Engine::get_image_info` plus metadata
  (`read_metadata`) and frames (`list_frames`); output format from
  the live registry (encodable formats only); quality / background /
  metadata-policy controls; optional processing (resize-fit,
  grayscale, rotate 90/180/270, flip) via `Engine::process`; frame
  extraction for animated GIF / multi-page TIFF; save via the native
  save dialog; result shows bytes, warnings, metadata preserved /
  dropped and orientation applied.
- **Batch**: add files (native multi-select dialog), add a whole
  folder (native directory dialog + `list_directory_images`), per-file
  target, output folder, worker pool 1–8 via `JobManager::for_engine`,
  live progress polling, per-file status + error, pause / resume /
  cancel-one / cancel-all / retry-failed. A failed file never stops
  the batch.
- **Formats**: capability table read live from the engine registry
  on every launch (21 formats) — never a hand-written list.
- **Settings**: theme (light / dark / system), default quality /
  format / background / metadata policy, batch workers 1–8, reset.
  About section states the offline mode and the log file path.
- **Logs**: tail of the application log (`read_logs`) plus its path.
- **Offline**: stated in the header badge, in Settings / About and
  in the footer. The app makes no network requests.

## Build / run

System setup (Ubuntu 24.04 — see `docs/DESKTOP.md` for the full
story, including the `libzstd-dev` pin conflict on this VM):

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libgtk-3-dev libsoup-3.0-dev
```

Frontend + backend checks:

```bash
cd apps/desktop
npm install
npm test          # vitest: settings + format helpers
npm run build     # tsc + vite
```

Backend (own workspace — run from `apps/desktop/src-tauri`):

```bash
cargo fmt --all && cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo check
```

Full desktop build (produces `.deb` + `.AppImage` under
`src-tauri/target/release/bundle/` — on this VM the AppImage step
needs the manual `linuxdeploy` run documented in
`docs/DESKTOP.md`, because the VM has no FUSE kernel module):

```bash
cd apps/desktop
npm run tauri build
```

Dev mode:

```bash
cd apps/desktop
npm run tauri dev
```

## What is not in this build

- Installers for Windows / macOS (Linux `.deb` + `.AppImage` only;
  cross-platform builds need those toolchains — see
  `docs/DESKTOP.md`).
- Arbitrary rotation (only 90 / 180 / 270 in the UI; the engine
  supports arbitrary angles — a later step can expose it).
- In-app update checks (offline by design).
