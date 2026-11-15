# Desktop Application — OpenPixel Engine (Phase 8, draft — coordinator verifies)

Tauri 2 desktop app in `apps/desktop/` (React 19 + TypeScript + Vite +
Tailwind CSS 3 frontend, Rust backend crate `openpixel-desktop` in
`src-tauri/`). The backend calls `openpixel-core`'s `Engine` and
`openpixel-jobs`' `JobManager` directly — the same code the CLI uses.
No conversion logic lives in the frontend and none is duplicated in
the backend: the frontend only sends file paths + options, the
backend only wraps engine calls. There is no server, no upload, no
account and no network request anywhere; the UI states the offline
mode in the header badge, in Settings / About and in the footer.

## Layout

```
apps/desktop/
  package.json            # frontend deps, all pinned exactly
  src/
    App.tsx               # tabs, theme, native drag-and-drop listener
    components/
      ConvertWorkspace.tsx  # pick/drop, preview, info/metadata/frames,
                            #   output + quality/background/metadata,
                            #   processing, frame extraction, save dialog
      BatchWorkspace.tsx    # file/folder pick, per-file target, worker pool,
                            #   progress polling, pause/resume/cancel/retry
      CapabilitiesTable.tsx # live registry table (21 formats)
      SettingsPanel.tsx     # theme, defaults, batch workers, About
      LogsView.tsx          # log tail + log file path
      DropZone.tsx          # picker button + visible drop target
    lib/
      tauri.ts            # typed invoke wrappers + pure path/format helpers
      settings.ts         # on-device settings (localStorage)
  src-tauri/
    Cargo.toml            # backend crate (its OWN workspace — see below)
    Cargo.lock            # backend lockfile
    tauri.conf.json       # window, CSP, bundle targets (deb, appimage)
    capabilities/default.json  # Tauri 2 permissions
    src/
      lib.rs              # Tauri builder: dialog plugin, state, commands
      commands.rs         # Tauri commands (thin Engine / JobManager wrappers)
      logging.rs          # append-only log file (std only, no date crate)
```

## Why the backend is not a root workspace member

`apps/desktop/src-tauri/Cargo.toml` carries its own `[workspace]`
table on purpose. Tauri 2 pulls a GUI toolkit (WebKitGTK/GTK on
Linux) and an async runtime into the build; making it a root member
would make `cargo test --workspace` link the GUI libraries and
compile the whole Tauri tree for every engine test run. The engine
workspace therefore stays exactly as it was (171 tests, same
commands), and the backend has its own lockfile and its own commands:

```bash
# from apps/desktop/src-tauri/
cargo fmt --all && cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo check
```

## Tauri commands (src-tauri/src/commands.rs)

| Command | Engine call behind it |
|---|---|
| `app_info` | `Engine::get_capabilities` (count) + version + log path |
| `get_capabilities` | `Engine::get_capabilities` (live registry — 21 formats) |
| `get_image_info` | `Engine::get_image_info` |
| `read_metadata` | `Engine::read_metadata` |
| `list_frames` | `Engine::list_frames` |
| `list_directory_images` | directory scan, extension filtered by `ImageFormat::from_name` |
| `convert_file` | `Engine::convert` |
| `process_file` | `Engine::process` (resize-fit, rotate 90/180/270, flip, grayscale) |
| `extract_frame` | `Engine::extract_frame_to_path` |
| `start_batch` / `batch_progress` / `batch_jobs` / `batch_results` / `batch_pause` / `batch_resume` / `batch_cancel` / `batch_cancel_all` / `batch_retry_failed` | `JobManager::for_engine` (workers 1–8) + the manager's own methods |
| `read_logs` | tail of the log file |

Validation happens before the engine is called (`build_options` /
`build_pipeline` in `commands.rs`): quality 1–100, PNG compression
0–2, background `white` / `black` / `#RRGGBB` (via the engine's own
`parse_background`), metadata policy names via
`MetadataPolicy::from_name`, rotation only 90 / 180 / 270. Every
conversion and every error is appended to the log.

The `do_*` functions are the testable core (they take an `&Engine`
and return plain results); the `#[tauri::command]` wrappers only add
state lookup and logging. Batch state is one `JobManager` at a time
on `AppState`: a new batch is refused while the previous one still
has non-terminal jobs, and a finished batch is replaced (its manager
is shut down first).

## Features and their honest limits

- **Native file picker**: open file (filters from the decodable
  registry extensions) and open folder (native directory dialog +
  `list_directory_images`, non-recursive, decodable files only).
- **Drag-and-drop**: the window has `dragDropEnabled: true`; `App.tsx`
  listens for `tauri://drag-drop` — Convert takes the first dropped
  path, Batch takes all of them.
- **Preview**: `convertFileSrc` (asset protocol) shows the source
  image; formats the webview cannot render (e.g. TIFF) show a note
  that the info below comes from the engine, not from a failed load.
- **Conversion**: the full engine — all 15 encodable formats, not
  the web app's canvas subset. Quality applies to JPEG/WebP/AVIF
  only; metadata preservation is byte-exact for JPEG/PNG targets
  only (the result lists what was preserved and what was dropped);
  animated sources convert the first frame unless a frame is
  selected.
- **Processing**: resize-fit (never upscales), grayscale, rotate
  90/180/270, flip. Arbitrary rotation is an engine operation but is
  not exposed in this UI yet.
- **Batch**: worker pool 1–8 (default 4, from Settings), live
  progress polling (500 ms), per-file status + error, pause (queue
  only — a running decode/encode is never interrupted, same rule as
  the CLI), resume, cancel-one (queued only), cancel-all-queued,
  retry-failed. A failed file never stops the batch.
- **Formats view**: the capability table is read from the engine on
  every launch — it cannot drift from `openpixel formats`.
- **Settings**: theme, default quality/format/background/metadata
  policy, batch workers, reset. Persisted in localStorage under
  `openpixel.desktop.settings.v1`.
- **Logging**: `openpixel-desktop.log` under the app data directory
  (`<app_data_dir>/logs/` on Linux: `~/.local/share/dev.openpixel.desktop/logs/`),
  UTC timestamps, one line per conversion / batch event / error. The
  Logs tab shows the tail (default 200 lines) and the path.
- **Offline**: no network code at all. The CSP in
  `tauri.conf.json` is `default-src 'self'` plus the asset protocol
  for local previews.

## What is not in this build

- Windows / macOS installers — Linux `.deb` + `.AppImage` only (see
  "Build" below). Cross-platform bundles need those toolchains.
- Arbitrary rotation in the UI (engine supports it; UI exposes
  90/180/270 only).
- In-app update checks (offline by design).
- An `.icns` icon for macOS (Linux bundles do not need it).

## Build

### System libraries (Ubuntu 24.04)

Tauri 2 on Linux needs WebKitGTK + GTK + a few companions. The
runtime libraries install cleanly; the **-dev packages do not** on
this VM — see "The libzstd-dev block" below for the exact failure
and the workaround that produced the build.

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libgtk-3-dev libsoup-3.0-dev
```

### Frontend

```bash
cd apps/desktop
npm install
npm test          # vitest: settings + format helpers
npm run build     # tsc + vite -> dist/
```

### Backend (own workspace)

```bash
cd apps/desktop/src-tauri
cargo fmt --all && cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo check
```

### Full desktop build (installers)

```bash
cd apps/desktop
npm run tauri build
# -> src-tauri/target/release/bundle/deb/openpixel_0.1.0_amd64.deb
# -> src-tauri/target/release/bundle/appimage/openpixel_0.1.0_amd64.AppImage
```

On this VM the `.deb` builds through `tauri build` but the
`.AppImage` step cannot run inside `tauri build` (no FUSE kernel
module — see `docs/DESKTOP.md`); the AppImage was produced by
running the extracted `linuxdeploy` by hand, same output, same
name. On a machine with FUSE, plain `npm run tauri build` produces
both bundles with no workaround.

Dev mode: `npm run tauri dev` (Vite on http://localhost:1420).

## The libzstd-dev block (this VM, 16 Nov 2026)

`apt-get install libwebkit2gtk-4.1-dev` (and `libgtk-3-dev`,
`librsvg2-dev`, `libappindicator3-dev`) fails with held broken
packages:

```
libzstd-dev : Depends: libzstd1 (= 1.5.5+dfsg2-2build1.1)
but 1.5.5+dfsg2-2build1.1+hatch1 is to be installed
```

The VM image ships `libzstd1` as a Hatch-patched build
(`1.5.5+dfsg2-2build1.1+hatch1`, priority 100 from dpkg status),
while Ubuntu's `libzstd-dev` pins the stock version exactly.
Downgrading `libzstd1` to stock was **not** done: it is linked by
systemd, apt, curl, libsystemd and others, and the patched build is
presumably intentional in this image — downgrading a core library
to unblock a -dev package is out of scope for this phase.

What installed cleanly via apt: `patchelf` 0.18.0, `libsoup-3.0-dev`
3.4.4, and the **runtime** libraries `libwebkit2gtk-4.1-0` 2.52.6,
`libjavascriptcoregtk-4.1-0` 2.52.6, `libappindicator3-1`
12.10.1+20.10.20200706.1-0ubuntu5, `librsvg2-2` 2.58.0
(`libgtk-3-0t64` 3.24.41 was already present).

### Workaround used for the build (headers without installing)

The -dev packages were downloaded (not installed) and extracted
into a sysroot under ~/.tauri-sysroot, and pkg-config was pointed at it — no system
library was downgraded or replaced:

```bash
# 104 -dev packages: the five direct ones plus their -dev / gir1.2-*
# dependency closure (BFS over `apt-cache depends`, keeping only
# *-dev and gir1.2-*), 27.9 MB of .debs.
mkdir -p ~/.tauri-debs ~/.tauri-sysroot
cd ~/.tauri-debs
apt-get download libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  libgtk-3-dev librsvg2-dev libappindicator3-dev <... closure ...>
for deb in *.deb; do dpkg-deb -x "$deb" ~/.tauri-sysroot; done
find ~/.tauri-sysroot -name '*.pc' \
  -exec sed -i 's|^prefix=/usr$|prefix=$HOME/.tauri-sysroot/usr|' {} +
export PKG_CONFIG_PATH=$HOME/.tauri-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:$HOME/.tauri-sysroot/usr/share/pkgconfig
pkg-config --modversion webkit2gtk-4.1 javascriptcoregtk-4.1 gtk+-3.0 \
  libsoup-3.0 librsvg-2.0 appindicator3-0.1
# -> 2.52.6 / 2.52.6 / 3.24.41 / 3.4.4 / 2.58.0 / 12.10.0
```

The full recipe (the BFS script) is checked in as
`scripts/setup/fetch-tauri-sysroot.sh`. The sysroot itself lives at
`~/.tauri-sysroot` (moved out of `/tmp`: `/tmp` is a 512 MiB tmpfs
and the 340 MiB sysroot left too little room for the linker — the
metadata doctest failed with `ld terminated with signal 7 [Bus
error]` until the sysroot moved; see `docs/TESTING.md`). **The proper fix
for a fresh machine is to resolve the `libzstd1` pin** (either the
stock `libzstd-dev` accepts the Hatch build, or the image pins a
matching -dev package) and then install the -dev packages normally
— after that, `npm run tauri build` needs no `PKG_CONFIG_PATH`.
The produced `.deb` / `.AppImage` do not depend on the sysroot:
they link the runtime libraries, which are ordinary apt packages.

## Verification

(See `docs/TESTING.md` for the full Phase 8 results table.)

Headline, 16 Nov 2026, Ubuntu 24.04, Rust 1.100.0, Node v24.22.1 /
npm 10.9.4:

- Frontend: `npm test` **11 passed, 0 failed**; `npm run build`
  passes (`dist/index.html` 0.62 kB, JS 257.58 kB); `npm run lint`
  (oxlint) 0 warnings, 0 errors.
- Backend (own workspace): `cargo fmt --all` + `--check` pass,
  `cargo clippy --all-targets -- -D warnings` passes, `cargo check`
  passes, `cargo test` **16 passed, 0 failed**.
- Root workspace unchanged and green: `cargo test --workspace`
  **171 passed, 0 failed**, clippy passes, `cargo build --release`
  succeeds.
- Capability match: `openpixel --json formats` = 21 formats (16
  decodable, 15 encodable); the backend test asserts 21 and the
  frontend fetches the list live — no drift is possible.
- Tauri build: release binary `src-tauri/target/release/openpixel-desktop`
  (30 223 224 B) + `.deb`
  `src-tauri/target/release/bundle/deb/OpenPixel_0.1.0_amd64.deb`
  (9 665 496 B) built by `npm run tauri build`; the `.deb` was
  installed (`open-pixel` 0.1.0, `/usr/bin/openpixel-desktop`,
  `ldd` clean) and the app smoke-tested under Xvfb (main process +
  WebKitNetworkProcess + WebKitWebProcess alive, startup line in
  the log). The `.AppImage`
  `src-tauri/target/release/bundle/appimage/OpenPixel_0.1.0_amd64.AppImage`
  (80 046 584 B) was produced by running the extracted
  `linuxdeploy` by hand (see below) — `tauri build` itself cannot
  finish the AppImage step on this VM.
- AppImage via `tauri build`: **blocked by the environment, not by
  the app.** `linuxdeploy` is itself an AppImage and needs FUSE to
  mount; this VM has no FUSE kernel module (`modprobe fuse`:
  `Module fuse not found in directory
  /lib/modules/7.0.0-44-generic`; `/dev/fuse` absent), and
  `libfuse2t64` 2.9.9 (installed via apt) does not change that.
  Workaround used: extract the cached tools and run them directly
  (nothing in the repo was changed for this):

  ```bash
  mkdir -p ~/.tauri-tools && cd ~/.tauri-tools
  cp ~/.cache/tauri/linuxdeploy-07333c6-x86_64.AppImage ./ld.AppImage
  cp ~/.cache/tauri/linuxdeploy-plugin-appimage.AppImage ./plugin.AppImage
  ./ld.AppImage --appimage-extract >/dev/null 2>&1 && mv squashfs-root ld-extracted
  ./plugin.AppImage --appimage-extract >/dev/null 2>&1 && mv squashfs-root plugin-extracted
  cd apps/desktop/src-tauri/target/release/bundle/appimage
  PATH="$HOME/.tauri-tools/plugin-extracted/usr/bin:$HOME/.tauri-tools/ld-extracted/usr/bin:$PATH" \
    "$HOME/.tauri-tools/ld-extracted/usr/bin/linuxdeploy" \
    --appdir OpenPixel.AppDir --output appimage
  # -> OpenPixel-x86_64.AppImage (80 046 584 B), renamed to
  #    OpenPixel_0.1.0_amd64.AppImage to match Tauri's naming.
  ```

  Note: the first manual attempt used `--plugin appimage`, which
  is wrong — the AppImage plugin is an *output* plugin
  (`--output appimage`). On a machine with FUSE, plain
  `npm run tauri build` produces both bundles with no workaround.
