#!/bin/bash
# OpenPixel CLI e2e — item 4. Run from repo root. Logs to /tmp/op-e2e/cli/log.txt
set -u
BIN="$HOME/workspace/openpixel-engine/target/release/openpixel"
IN=/tmp/op-e2e/cli/in
OUT=/tmp/op-e2e/cli/out
LOG=/tmp/op-e2e/cli/log.txt
rm -rf "$OUT"; mkdir -p "$OUT"
exec > >(tee "$LOG") 2>&1
run() { echo "### \$ $*"; "$@"; echo "exit=$?"; echo; }
echo "=== 1. info ==="
run "$BIN" info "$IN/rgba.png"
run "$BIN" info "$IN/photo.jpg"
run "$BIN" info "$IN/photo-2048.heic"
run "$BIN" info "$IN/anim.gif"
run "$BIN" info "$IN/multi.tiff"
run "$BIN" info "$IN/lying.jpg"
echo "=== 2. discover (lying extension) ==="
run "$BIN" discover "$IN/lying.jpg"
run "$BIN" discover "$IN/photo-2048.heic"
echo "=== 3. convert matrix (each re-detected with info + file) ==="
conv() { # $1 src $2 target-ext $3 extra args...
  local src="$1" ext="$2"; shift 2
  local base; base=$(basename "$src" | sed 's/\.[^.]*$//')
  run "$BIN" convert "$src" "$OUT/${base}.${ext}" "$@"
  run "$BIN" info "$OUT/${base}.${ext}"
  file "$OUT/${base}.${ext}"
  echo
}
conv "$IN/rgba.png" jpg
conv "$IN/rgba.png" webp
conv "$IN/rgba.png" bmp
conv "$IN/rgba.png" tiff
conv "$IN/rgba.png" qoi
conv "$IN/rgba.png" avif
conv "$IN/rgba.png" jxl
conv "$IN/rgba.png" jp2
conv "$IN/rgba.png" tga
conv "$IN/rgba.png" ico
echo "=== 3c. ICO auto-resize (16 Nov 2026): format caps at 256x256 ==="
# photo.jpg is 1024x768: must succeed at 256x192 with a resize warning,
# never fail with "image width must be 1..=256" (the live-site bug).
conv "$IN/photo.jpg" ico
conv "$IN/rgba.png" pnm
conv "$IN/photo.jpg" png
conv "$IN/photo-2048.heic" png
conv "$IN/photo-2048.heic" jpg
conv "$IN/rgba.png" heic
conv "$IN/rgba.png" heif
conv "$IN/anim.gif" png
conv "$IN/multi.tiff" png
echo "=== 3b. SVG fixture ==="
printf '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="yellow"/><circle cx="32" cy="24" r="16" fill="blue"/></svg>' > "$IN/test.svg"
conv "$IN/test.svg" png
echo "=== 4. process pipeline ==="
run "$BIN" process "$IN/rgba.png" "$OUT/proc-resize.jpg" --resize 128x96 --grayscale --rotate 90
run "$BIN" info "$OUT/proc-resize.jpg"
run "$BIN" process "$IN/rgba.png" "$OUT/proc-thumb.png" --thumbnail 32
run "$BIN" info "$OUT/proc-thumb.png"
echo "=== 4b. process --target-size (16 Nov 2026) ==="
# 50 KB target, resized to 800x600: must fit in 50 KiB as a real 800x600 JPEG.
run "$BIN" process "$IN/photo.jpg" "$OUT/proc-50k.jpg" --resize-fit 800x600 --target-size 50KB
run "$BIN" info "$OUT/proc-50k.jpg"
[ "$(stat -c%s "$OUT/proc-50k.jpg")" -le 51200 ] || { echo "FAIL: proc-50k.jpg over 50 KiB"; exit 1; }
"$BIN" info "$OUT/proc-50k.jpg" | grep -Eq "size:\s+800x600" || { echo "FAIL: proc-50k.jpg not 800x600"; exit 1; }
# Unreachable target: smallest result + warning, exit 0 (never a silent overshoot).
"$BIN" process "$IN/photo.jpg" "$OUT/proc-tiny.jpg" --target-size 100B > /tmp/op-e2e/cli/tiny.log 2>&1
[ $? -eq 0 ] || { echo "FAIL: unreachable --target-size should exit 0"; exit 1; }
grep -q "target size NOT met" /tmp/op-e2e/cli/tiny.log || { echo "FAIL: unreachable --target-size should warn"; exit 1; }
# --target-size conflicts with --quality (exit 1).
"$BIN" process "$IN/photo.jpg" "$OUT/x.jpg" --target-size 50KB --quality 80 > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: --target-size --quality should exit 1"; exit 1; }
# WebP refuses target-size honestly — image-rs encodes WebP losslessly only (exit 1).
"$BIN" process "$IN/photo.jpg" "$OUT/x.webp" --target-size 50KB > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: WebP --target-size should exit 1"; exit 1; }
echo "=== 5. metadata / frames / extract-frame ==="
run "$BIN" metadata "$IN/photo.jpg"
run "$BIN" frames "$IN/anim.gif"
run "$BIN" frames "$IN/multi.tiff"
run "$BIN" extract-frame "$IN/anim.gif" "$OUT/frame1.png" --frame 1
run "$BIN" info "$OUT/frame1.png"
echo "=== 6. batch (workers, incl. corrupt file) ==="
mkdir -p "$IN/batch" && cp "$IN/rgba.png" "$IN/photo.jpg" "$IN/anim.gif" "$IN/corrupt.png" "$IN/checker-64.heic" "$IN/batch/"
run "$BIN" batch "$IN/batch" --format webp --quality 80 --workers 2 --out-dir "$OUT/batch"
ls -la "$OUT/batch"
for f in "$OUT/batch"/*; do "$BIN" info "$f" | head -1; done
echo "=== 7. bench --quick ==="
run "$BIN" bench --quick
echo "=== 8. error cases (expect exit 1, clean typed error, no crash) ==="
run "$BIN" convert "$IN/notes.txt" "$OUT/x.png"
run "$BIN" convert "$IN/rgba.png" "$OUT/x.psd"
run "$BIN" convert "$IN/missing.png" "$OUT/x.png"
run "$BIN" info "$IN/corrupt.png"
run "$BIN" convert "$IN/corrupt.png" "$OUT/x.png"
run "$BIN" batch "$IN/batch" "$OUT/batch2" --format webp --workers 0
run "$BIN" process "$IN/rgba.png" "$OUT/x.png" --resize 0x0
run "$BIN" convert "$IN/rgba.png" "$OUT/x.png" --bogus-flag
run "$BIN" capabilities psd
run "$BIN" capabilities heic
echo "=== 9. formats list ==="
run "$BIN" formats
echo "=== DONE ==="
ls -la "$OUT" | head -50
