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
echo "=== 10. pdf (Studio Phase 2) ==="
# Fixtures: real PDFs built from the image fixtures (no checked-in PDFs).
run "$BIN" pdf from-images "$IN/rgba.png" "$IN/photo.jpg" "$IN/checker-64.heic" -o "$IN/doc3.pdf"
run "$BIN" pdf from-images "$IN/photo.jpg" "$IN/rgba.png" -o "$IN/doc2.pdf"
run "$BIN" pdf info "$IN/doc3.pdf"
"$BIN" pdf info "$IN/doc3.pdf" | grep -Eq "pages:\s+3" || { echo "FAIL: doc3.pdf should have 3 pages"; exit 1; }
pdfinfo "$IN/doc3.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: pdfinfo doc3.pdf"; exit 1; }
"$BIN" --json pdf info "$IN/doc3.pdf" | grep -Eq '"page_count": 3' || { echo "FAIL: --json pdf info"; exit 1; }
# merge 3+2 = 5
run "$BIN" pdf merge "$IN/doc3.pdf" "$IN/doc2.pdf" -o "$OUT/pdf-merged.pdf"
pdfinfo "$OUT/pdf-merged.pdf" | grep -Eq "Pages:\s+5" || { echo "FAIL: merged should have 5 pages"; exit 1; }
# split 1-3,5 -> 3 + 1 pages
run "$BIN" pdf split "$OUT/pdf-merged.pdf" --ranges 1-3,5 --out-dir "$OUT/pdf-split"
pdfinfo "$OUT/pdf-split/pdf-merged-part1.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: split part1"; exit 1; }
pdfinfo "$OUT/pdf-split/pdf-merged-part2.pdf" | grep -Eq "Pages:\s+1" || { echo "FAIL: split part2"; exit 1; }
# page ops (each re-verified with pdfinfo)
run "$BIN" pdf rotate "$IN/doc3.pdf" "$OUT/pdf-rot.pdf" --pages 1 --degrees 90
grep -aq "/Rotate 90" "$OUT/pdf-rot.pdf" || { echo "FAIL: rotated page should carry /Rotate 90"; exit 1; }
pdfinfo "$OUT/pdf-rot.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: rot page count"; exit 1; }
run "$BIN" pdf extract "$IN/doc3.pdf" "$OUT/pdf-ext.pdf" --pages 2,3
pdfinfo "$OUT/pdf-ext.pdf" | grep -Eq "Pages:\s+2" || { echo "FAIL: extract"; exit 1; }
run "$BIN" pdf remove "$IN/doc3.pdf" "$OUT/pdf-rem.pdf" --pages 2
pdfinfo "$OUT/pdf-rem.pdf" | grep -Eq "Pages:\s+2" || { echo "FAIL: remove"; exit 1; }
run "$BIN" pdf reorder "$IN/doc3.pdf" "$OUT/pdf-reo.pdf" --order 3,2,1
pdfinfo "$OUT/pdf-reo.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: reorder"; exit 1; }
run "$BIN" pdf duplicate "$IN/doc3.pdf" "$OUT/pdf-dup.pdf" --pages 1
pdfinfo "$OUT/pdf-dup.pdf" | grep -Eq "Pages:\s+4" || { echo "FAIL: duplicate"; exit 1; }
run "$BIN" pdf insert "$IN/doc3.pdf" "$IN/doc2.pdf" "$OUT/pdf-ins.pdf" --at 2
pdfinfo "$OUT/pdf-ins.pdf" | grep -Eq "Pages:\s+5" || { echo "FAIL: insert"; exit 1; }
run "$BIN" pdf replace "$IN/doc3.pdf" "$IN/doc2.pdf" "$OUT/pdf-rep.pdf" --page 2
pdfinfo "$OUT/pdf-rep.pdf" | grep -Eq "Pages:\s+4" || { echo "FAIL: replace"; exit 1; }
run "$BIN" pdf reverse "$IN/doc3.pdf" "$OUT/pdf-rev.pdf"
pdfinfo "$OUT/pdf-rev.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: reverse"; exit 1; }
run "$BIN" pdf booklet "$IN/doc3.pdf" "$OUT/pdf-book.pdf"
pdfinfo "$OUT/pdf-book.pdf" | grep -Eq "Pages:\s+4" || { echo "FAIL: booklet pads to 4"; exit 1; }
run "$BIN" pdf nup "$IN/doc3.pdf" "$OUT/pdf-nup.pdf" --cols 2 --rows 2
pdfinfo "$OUT/pdf-nup.pdf" | grep -Eq "Pages:\s+1" || { echo "FAIL: nup 2x2 of 3 pages is 1 sheet"; exit 1; }
# render: PDF -> genuine PNG/JPG at the requested dimensions (scale 1.0 = 72 DPI).
# doc3 pages are 256x192, 1024x768, 64x64 pt (from-images uses each image's own size).
run "$BIN" pdf render "$IN/doc3.pdf" --scale 1.0 --out-dir "$OUT/pdf-pages"
for spec in "doc3-p1.png:256x192" "doc3-p2.png:1024x768" "doc3-p3.png:64x64"; do
  f="${spec%%:*}"; dims="${spec##*:}"
  file "$OUT/pdf-pages/$f" | grep -q "PNG image data, ${dims%%x*} x ${dims##*x}" || { echo "FAIL: $f is not a genuine ${dims} PNG"; file "$OUT/pdf-pages/$f"; exit 1; }
  "$BIN" info "$OUT/pdf-pages/$f" | grep -Eq "size:\s+${dims%%x*}x${dims##*x}" || { echo "FAIL: $f info dimensions"; exit 1; }
done
run "$BIN" pdf render "$IN/doc3.pdf" --scale 1.0 --format jpg --quality 80 --out-dir "$OUT/pdf-pages-jpg"
file "$OUT/pdf-pages-jpg/doc3-p1.jpg" | grep -q "JPEG image data" || { echo "FAIL: rendered JPG is not genuine JPEG"; exit 1; }
"$BIN" info "$OUT/pdf-pages-jpg/doc3-p1.jpg" | grep -Eq "size:\s+256x192" || { echo "FAIL: rendered JPG dimensions"; exit 1; }
# render a single page only, at scale 2.0 (144 DPI): photo.jpg page is 1024x768 pt -> 2048x1536 px.
run "$BIN" pdf render "$IN/doc3.pdf" --pages 2 --scale 2.0 --out-dir "$OUT/pdf-pages-one"
[ "$(ls "$OUT/pdf-pages-one" | wc -l)" -eq 1 ] || { echo "FAIL: single-page render should write exactly 1 file"; exit 1; }
"$BIN" info "$OUT/pdf-pages-one/doc3-p2.png" | grep -Eq "size:\s+2048x1536" || { echo "FAIL: scale 2.0 render should be 2048x1536"; exit 1; }
echo "=== 10b. pdf error cases (expect exit 1, clean error, no crash) ==="
"$BIN" pdf rotate "$IN/doc3.pdf" "$OUT/x.pdf" --degrees 45 > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: rotate 45 should exit 1"; exit 1; }
"$BIN" pdf extract "$IN/doc3.pdf" "$OUT/x.pdf" --pages 9 > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: extract page 9 should exit 1"; exit 1; }
"$BIN" pdf info "$IN/rgba.png" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf info on a PNG should exit 1"; exit 1; }
"$BIN" pdf render "$IN/doc3.pdf" --format svg --out-dir "$OUT/x" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: render to SVG (decode-only) should exit 1"; exit 1; }
"$BIN" pdf merge "$IN/doc3.pdf" "$IN/rgba.png" -o "$OUT/x.pdf" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: merge with a non-PDF should exit 1"; exit 1; }
echo "=== DONE ==="
ls -la "$OUT" | head -50
