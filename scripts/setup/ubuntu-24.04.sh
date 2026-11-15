#!/usr/bin/env bash
# OpenPixel Engine — Phase 3 native-codec setup for Ubuntu 24.04 (x86_64).
#
# Installs the ONE system library Phase 3 actually needs:
#   libdav1d-dev  — AV1 decoder used by AVIF decode (image crate
#                   `avif-native` feature -> dav1d-sys -> pkg-config
#                   `dav1d >= 1.3.0`). Ubuntu 24.04 ships 1.4.1.
#                   Runtime dependency is libdav1d7 (installed with it).
#
# Everything else in Phase 3 is pure Rust (no system library):
#   SVG      resvg/usvg            (crates.io)
#   AVIF enc ravif/rav1e           (crates.io)
#   JXL      jxl-oxide + zune-jpegxl (crates.io)
#   HDR/EXR  image-rs hdr/exr      (crates.io)
#   JPEG2000 jpeg2k/openjp2        (pure-Rust OpenJPEG port, crates.io)
#
# Deliberately NOT installed here:
#   libheif-dev — BLOCKED, see docs/CODECS.md "Phase 3 — HEIC/HEIF".
#     This VM image has libheif1 1.23.3-1 installed manually (no apt
#     source); Ubuntu's libheif-dev 1.17.6 requires libheif1 = 1.17.6
#     and apt refuses the mix ("held broken packages"). Downgrading
#     the runtime library would break the installed 1.23.3 plugins,
#     so HEIC/HEIF stays detection-only until a matching -dev package
#     is available. Do NOT force-install libheif-dev 1.17.6.
#   libjpeg-turbo / libwebp / libtiff -dev — NOT needed in Phase 3.
#     image-rs already decodes/encodes JPEG, WebP and TIFF in pure
#     Rust; C replacements would change performance only, with no new
#     format enabled. That is a Phase 6 benchmark decision, not a
#     Phase 3 dependency.
#
# Usage: sudo ./scripts/setup/ubuntu-24.04.sh
# Safe to re-run (apt install is idempotent).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root or with sudo: sudo $0" >&2
  exit 1
fi

apt-get update -qq
apt-get install -y -qq libdav1d-dev
echo "dav1d: $(pkg-config --modversion dav1d)"
echo "Phase 3 system setup done. Pure-Rust codecs need nothing else."
