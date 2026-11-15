#!/usr/bin/env bash
# Fetch Tauri 2 system -dev packages WITHOUT installing them, and
# extract them into a sysroot pkg-config can point at.
#
# Why this exists: on this VM image, `libwebkit2gtk-4.1-dev` cannot be
# installed via apt — `libzstd-dev` pins stock `libzstd1`, but the
# image ships a Hatch-patched `libzstd1` (+hatch1). Downgrading a core
# library was refused, so the headers are used from a sysroot instead.
# The proper fix on a fresh machine is to resolve the libzstd1 pin
# and install the -dev packages normally; then no sysroot is needed.
#
# Usage:
#   ./scripts/setup/fetch-tauri-sysroot.sh [SYSROOT_DIR]   # default ~/.tauri-sysroot
#   export PKG_CONFIG_PATH="$SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig:$SYSROOT/usr/share/pkgconfig"
#   cd apps/desktop/src-tauri && cargo test
set -euo pipefail
SYSROOT="${1:-$HOME/.tauri-sysroot}"
DEBS_DIR="${TAURI_DEBS_DIR:-$HOME/.tauri-debs}"
mkdir -p "$DEBS_DIR" "$SYSROOT"
cd "$DEBS_DIR"
seed="libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libgtk-3-dev librsvg2-dev libappindicator3-dev"
declare -A seen
queue=($seed)
for p in "${queue[@]}"; do seen[$p]=1; done
# BFS over Depends, keeping only *-dev and gir1.2-* packages.
for round in 1 2 3 4 5 6; do
  added=0
  for p in "${queue[@]}"; do
    deps=$(apt-cache depends "$p" 2>/dev/null | grep -E "^\s+Depends:" | awk '{print $2}' || true)
    for d in $deps; do
      case "$d" in
        *-dev|gir1.2-*) ;;
        *) continue ;;
      esac
      if [ -z "${seen[$d]:-}" ]; then seen[$d]=1; queue+=("$d"); added=1; fi
    done
  done
  [ "$added" = 0 ] && break
done
echo "DEV PACKAGES (${#queue[@]}): ${queue[*]}"
apt-get download "${queue[@]}"
ls *.deb | wc -l
for deb in *.deb; do dpkg-deb -x "$deb" "$SYSROOT"; done
# Re-point .pc files at the sysroot (they ship prefix=/usr).
find "$SYSROOT" -name '*.pc' -exec sed -i "s|^prefix=/usr$|prefix=$SYSROOT/usr|" {} +
echo "Sysroot ready at $SYSROOT"
echo "Export: PKG_CONFIG_PATH=$SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig:$SYSROOT/usr/share/pkgconfig"
