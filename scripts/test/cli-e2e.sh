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
echo "=== 11. pdf compression / security / text extraction + doc conversion (Studio Phase 3) ==="
# Office fixtures, generated inline (python-docx / openpyxl /
# python-pptx are installed in this VM; no checked-in Office files).
python3 - "$IN" <<'PYEOF'
import sys
from docx import Document as Docx
from openpyxl import Workbook
from pptx import Presentation
d = sys.argv[1]
doc = Docx()
doc.add_heading('OpenPixel Test Document', 0)
doc.add_paragraph('This is a test paragraph with bold and italic text.')
p = doc.add_paragraph(); r = p.add_run('Bold run. '); r.bold = True
r = p.add_run('Italic run.'); r.italic = True
t = doc.add_table(rows=2, cols=2); t.cell(0,0).text='Name'; t.cell(0,1).text='Value'
t.cell(1,0).text='Alpha'; t.cell(1,1).text='42'
doc.add_page_break(); doc.add_paragraph('Second page of the test document.')
doc.save(f'{d}/test.docx')
wb = Workbook(); ws = wb.active; ws['A1']='Name'; ws['B1']='Qty'; ws['C1']='Price'
ws.append(['Apple', 10, 1.5]); ws.append(['Banana', 20, 0.75])
wb.save(f'{d}/test.xlsx')
prs = Presentation(); s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = 'OpenPixel Slides'; s.placeholders[1].text = 'First slide body.'
s2 = prs.slides.add_slide(prs.slide_layouts[1]); s2.shapes.title.text = 'Second Slide'
prs.save(f'{d}/test.pptx')
open(f'{d}/test.txt','w').write('Hello from a plain text file.\nSecond line here.\n')
open(f'{d}/test.csv','w').write('Name,Qty,Price\nApple,10,1.5\nBanana,20,0.75\n')
open(f'{d}/test.html','w').write('<!doctype html><html><body><h1>Test Page</h1><ul><li>One</li><li>Two</li></ul></body></html>\n')
open(f'{d}/test.rtf','w').write(r'{\rtf1\ansi {\b Bold RTF} and plain text.\par}' + '\n')
PYEOF
# --- 11a. compression: doc3.pdf has a 1024x768 photo page (Flate RGB) ---
# Screen must shrink it a lot; every mode keeps 3 pages; screen <= ebook <= printer.
run "$BIN" pdf compress "$IN/doc3.pdf" "$OUT/pdf-comp-screen.pdf" --mode screen
pdfinfo "$OUT/pdf-comp-screen.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: compressed doc3 should have 3 pages"; exit 1; }
[ "$(stat -c%s "$OUT/pdf-comp-screen.pdf")" -lt "$(stat -c%s "$IN/doc3.pdf")" ] || { echo "FAIL: screen compression should shrink doc3.pdf"; exit 1; }
run "$BIN" pdf compress "$IN/doc3.pdf" "$OUT/pdf-comp-ebook.pdf" --mode ebook
run "$BIN" pdf compress "$IN/doc3.pdf" "$OUT/pdf-comp-printer.pdf" --mode printer
pdfinfo "$OUT/pdf-comp-printer.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: printer compression page count"; exit 1; }
[ "$(stat -c%s "$OUT/pdf-comp-screen.pdf")" -le "$(stat -c%s "$OUT/pdf-comp-ebook.pdf")" ] || { echo "FAIL: screen should be <= ebook"; exit 1; }
[ "$(stat -c%s "$OUT/pdf-comp-ebook.pdf")" -le "$(stat -c%s "$OUT/pdf-comp-printer.pdf")" ] || { echo "FAIL: ebook should be <= printer"; exit 1; }
echo "compression sizes: input=$(stat -c%s "$IN/doc3.pdf") screen=$(stat -c%s "$OUT/pdf-comp-screen.pdf") ebook=$(stat -c%s "$OUT/pdf-comp-ebook.pdf") printer=$(stat -c%s "$OUT/pdf-comp-printer.pdf")"
# --- 11b. security: protect -> encrypted, unlock -> clean, wrong password fails ---
run "$BIN" pdf protect "$IN/doc3.pdf" "$OUT/pdf-prot.pdf" --user-password user123 --owner-password owner456 --no-print --no-copy
pdfinfo -upw user123 "$OUT/pdf-prot.pdf" | grep -Eq "Encrypted:\s+yes" || { echo "FAIL: protected PDF should report Encrypted: yes"; exit 1; }
pdfinfo -upw user123 "$OUT/pdf-prot.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: protected PDF page count"; exit 1; }
pdfinfo -upw user123 "$OUT/pdf-prot.pdf" | grep -q "print:no" || { echo "FAIL: protected PDF should forbid printing"; exit 1; }
pdfinfo -upw user123 "$OUT/pdf-prot.pdf" | grep -q "algorithm:RC4" || { echo "FAIL: protection should be RC4-128"; exit 1; }
run "$BIN" pdf unlock "$OUT/pdf-prot.pdf" "$OUT/pdf-unlocked.pdf" --password user123
pdfinfo "$OUT/pdf-unlocked.pdf" | grep -Eq "Encrypted:\s+no" || { echo "FAIL: unlocked PDF should report Encrypted: no"; exit 1; }
pdfinfo "$OUT/pdf-unlocked.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: unlocked page count"; exit 1; }
"$BIN" pdf unlock "$OUT/pdf-prot.pdf" "$OUT/x.pdf" --password wrongpw > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: unlock with a wrong password should exit 1"; exit 1; }
"$BIN" pdf protect "$IN/doc3.pdf" "$OUT/x.pdf" > /dev/null 2>&1
[ $? -eq 2 ] || { echo "FAIL: protect without a password should exit 2 (clap)"; exit 1; }
# --- 11c. watermark ---
run "$BIN" pdf watermark "$IN/doc3.pdf" "$OUT/pdf-wm.pdf" --text CONFIDENTIAL
pdfinfo "$OUT/pdf-wm.pdf" | grep -Eq "Pages:\s+3" || { echo "FAIL: watermarked page count"; exit 1; }
grep -aq "CONFIDENTIAL" "$OUT/pdf-wm.pdf" || { echo "FAIL: watermark text should be in the content stream"; exit 1; }
# --- 11d. doc formats registry (human + JSON) ---
run "$BIN" doc formats
"$BIN" doc formats --json > "$OUT/doc-formats.json"
python3 - "$OUT/doc-formats.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['libreoffice'].startswith('LibreOffice '), d['libreoffice']
assert d['pdf_text_extraction'] is True
pairs = {(c['source'], c['target']) for c in d['conversions']}
assert ('docx', 'pdf') in pairs and ('pdf', 'txt') in pairs, pairs
assert ('pdf', 'xlsx') not in pairs and ('pptx', 'txt') not in pairs, pairs
assert all(c['runs_where'] == 'cli_desktop' for c in d['conversions'])
print('doc formats --json: registry OK,', len(pairs), 'rows')
PYEOF
# --- 11e. Office -> PDF (LibreOffice), text verified with pdftotext ---
run "$BIN" doc convert "$IN/test.docx" --to pdf -o "$OUT/doc.pdf"
pdfinfo "$OUT/doc.pdf" | grep -Eq "Pages:\s+2" || { echo "FAIL: docx->pdf should have 2 pages"; exit 1; }
pdftotext "$OUT/doc.pdf" - | grep -q "OpenPixel Test Document" || { echo "FAIL: docx->pdf text"; exit 1; }
run "$BIN" doc convert "$IN/test.xlsx" --to pdf -o "$OUT/xlsx.pdf"
pdfinfo "$OUT/xlsx.pdf" | grep -Eq "Pages:\s+1" || { echo "FAIL: xlsx->pdf page count"; exit 1; }
pdftotext "$OUT/xlsx.pdf" - | grep -q "Apple" || { echo "FAIL: xlsx->pdf text"; exit 1; }
run "$BIN" doc convert "$IN/test.pptx" --to pdf -o "$OUT/pptx.pdf"
pdfinfo "$OUT/pptx.pdf" | grep -Eq "Pages:\s+2" || { echo "FAIL: pptx->pdf should have 2 slides"; exit 1; }
pdftotext "$OUT/pptx.pdf" - | grep -q "OpenPixel Slides" || { echo "FAIL: pptx->pdf text"; exit 1; }
run "$BIN" doc convert "$IN/test.txt" --to pdf -o "$OUT/txt.pdf"
pdfinfo "$OUT/txt.pdf" | grep -Eq "Pages:\s+1" || { echo "FAIL: txt->pdf page count"; exit 1; }
run "$BIN" doc convert "$IN/test.csv" --to pdf -o "$OUT/csv.pdf"
pdftotext "$OUT/csv.pdf" - | grep -q "Apple" || { echo "FAIL: csv->pdf text"; exit 1; }
run "$BIN" doc convert "$IN/test.html" --to pdf -o "$OUT/html.pdf"
pdftotext "$OUT/html.pdf" - | grep -q "Test Page" || { echo "FAIL: html->pdf text"; exit 1; }
run "$BIN" doc convert "$IN/test.rtf" --to pdf -o "$OUT/rtf.pdf"
pdfinfo "$OUT/rtf.pdf" | grep -Eq "Pages:\s+1" || { echo "FAIL: rtf->pdf page count"; exit 1; }
# Office -> Office / text
run "$BIN" doc convert "$IN/test.xlsx" --to csv -o "$OUT/back.csv"
grep -q "Apple,10,1.5" "$OUT/back.csv" || { echo "FAIL: xlsx->csv round-trip"; exit 1; }
run "$BIN" doc convert "$IN/test.docx" --to txt -o "$OUT/doc.txt"
grep -q "OpenPixel Test Document" "$OUT/doc.txt" || { echo "FAIL: docx->txt text"; exit 1; }
# --- 11f. text extraction (PDFium) in all four formats ---
run "$BIN" pdf extract-text "$OUT/doc.pdf" -o "$OUT/doc-extracted.txt" --format txt
grep -q "OpenPixel Test Document" "$OUT/doc-extracted.txt" || { echo "FAIL: extract-text txt"; exit 1; }
run "$BIN" pdf extract-text "$OUT/doc.pdf" -o "$OUT/doc-extracted.html" --format html
grep -q "OpenPixel Test Document" "$OUT/doc-extracted.html" || { echo "FAIL: extract-text html"; exit 1; }
run "$BIN" pdf extract-text "$OUT/doc.pdf" -o "$OUT/doc-extracted.epub" --format epub
unzip -p "$OUT/doc-extracted.epub" OEBPS/chapter-1.xhtml | grep -q "OpenPixel Test Document" || { echo "FAIL: extract-text epub chapter"; exit 1; }
run "$BIN" pdf extract-text "$OUT/doc.pdf" -o "$OUT/doc-extracted.docx" --format docx
unzip -p "$OUT/doc-extracted.docx" word/document.xml | grep -q "OpenPixel Test Document" || { echo "FAIL: extract-text docx"; exit 1; }
# docx round-trip: pdf->docx -> LibreOffice -> pdf, text survives
run "$BIN" doc convert "$OUT/doc-extracted.docx" --to pdf -o "$OUT/doc-rt.pdf"
pdftotext "$OUT/doc-rt.pdf" - | grep -q "OpenPixel Test Document" || { echo "FAIL: docx round-trip text"; exit 1; }
# pdf->txt via `doc convert` (PdfText engine)
run "$BIN" doc convert "$OUT/doc.pdf" --to txt -o "$OUT/doc-via-doc.txt"
grep -q "OpenPixel Test Document" "$OUT/doc-via-doc.txt" || { echo "FAIL: doc convert pdf->txt"; exit 1; }
# --- 11g. honest refusals (exit 1, with the alternatives named) ---
"$BIN" doc convert "$OUT/doc.pdf" --to xlsx -o "$OUT/x.xlsx" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf->xlsx should exit 1"; exit 1; }
"$BIN" doc convert "$IN/test.pptx" --to txt -o "$OUT/x.txt" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pptx->txt should exit 1"; exit 1; }
echo "=== 12. OCR (Studio Phase 4): native Tesseract ==="
# Fixtures are the committed Rust accuracy fixtures
# (crates/openpixel-ocr/tests/fixtures/) — known text, so the
# error rates below are measured against ground truth, not vibes.
OCR_FIX="$HOME/workspace/openpixel-engine/crates/openpixel-ocr/tests/fixtures"
cp "$OCR_FIX/eng-clean.png" "$OCR_FIX/ben-clean.png" "$OCR_FIX/eng-skewed.png" "$OCR_FIX/eng-noisy.png" "$IN/"
cp "$OCR_FIX/eng-clean.txt" "$OCR_FIX/ben-clean.txt" "$IN/"
# CER/WER helper: python3 reads <got> + <truth> and prints the
# rates; exits 1 when over the given ceilings.
cer() { python3 - "$1" "$2" "$3" "$4" <<'PYEOF'
import sys
def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (ca != cb))
        prev = cur
    return prev[len(b)]
got = open(sys.argv[1], encoding='utf-8').read().strip()
truth = open(sys.argv[2], encoding='utf-8').read().strip()
c = lev(list(truth), list(got)) / max(len(truth), 1)
w = lev(truth.split(), got.split()) / max(len(truth.split()), 1)
print(f"CER={c:.3f} WER={w:.3f} (ceilings CER<{sys.argv[3]} WER<{sys.argv[4]})")
sys.exit(0 if c < float(sys.argv[3]) and w < float(sys.argv[4]) else 1)
PYEOF
}
# --- 12a. ocr txt: clean English is exact, confidence printed ---
run "$BIN" ocr "$IN/eng-clean.png" -o "$OUT/eng.txt"
grep -q "The quick brown fox jumps over the lazy dog." "$OUT/eng.txt" || { echo "FAIL: ocr eng line 1"; exit 1; }
grep -q "OpenPixel Studio reads scanned documents" "$OUT/eng.txt" || { echo "FAIL: ocr eng line 2"; exit 1; }
cer "$OUT/eng.txt" "$IN/eng-clean.txt" 0.01 0.01 || { echo "FAIL: ocr eng-clean accuracy"; exit 1; }
# --- 12b. ocr txt: Bengali (conjunct words are the hard part — see docs/OCR.md) ---
run "$BIN" ocr "$IN/ben-clean.png" --lang ben -o "$OUT/ben.txt"
grep -q "ঢাকায়" "$OUT/ben.txt" || { echo "FAIL: ocr ben line 1"; exit 1; }
grep -q "স্বচ্ছতা" "$OUT/ben.txt" || { echo "FAIL: ocr ben line 3"; exit 1; }
cer "$OUT/ben.txt" "$IN/ben-clean.txt" 0.20 0.25 || { echo "FAIL: ocr ben-clean accuracy"; exit 1; }
# --- 12c. ocr --format json: words + boxes + confidence ---
run "$BIN" ocr "$IN/eng-clean.png" --format json -o "$OUT/eng.json"
python3 - "$OUT/eng.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['language'] == 'eng', d['language']
assert len(d['words']) == 30, len(d['words'])
assert d['mean_confidence'] > 90, d['mean_confidence']
assert 'OpenPixel Studio' in d['text'], d['text'][:80]
assert all(set(w) >= {'text', 'confidence', 'x', 'y', 'width', 'height'} for w in d['words'])
print(f"ocr json: {len(d['words'])} words, mean confidence {d['mean_confidence']:.1f}%, engine {d['engine']}")
PYEOF
# --- 12d. ocr --format html: word spans with bboxes ---
run "$BIN" ocr "$IN/eng-clean.png" --format html -o "$OUT/eng.html"
grep -q '<span class="ocr_word" title="bbox' "$OUT/eng.html" || { echo "FAIL: ocr html word spans"; exit 1; }
# Words are separate spans, so "OpenPixel Studio" never appears as
# one literal string — check the two words individually.
grep -q '>OpenPixel</span>' "$OUT/eng.html" || { echo "FAIL: ocr html text (OpenPixel)"; exit 1; }
grep -q '>Studio</span>' "$OUT/eng.html" || { echo "FAIL: ocr html text (Studio)"; exit 1; }
# --- 12e. ocr --preprocess full recovers a +3 degree skew ---
run "$BIN" ocr "$IN/eng-skewed.png" --preprocess none -o "$OUT/skew-none.txt"
run "$BIN" ocr "$IN/eng-skewed.png" --preprocess full -o "$OUT/skew-full.txt"
echo "skewed page baseline (no preprocessing — the uncorrected error):"
cer "$OUT/skew-none.txt" "$IN/eng-clean.txt" 0.99 0.99
echo "skewed page with --preprocess full (deskew must recover it):"
cer "$OUT/skew-full.txt" "$IN/eng-clean.txt" 0.01 0.01 || { echo "FAIL: ocr deskew should recover the skewed page"; exit 1; }
# --- 12f. pdf ocr: scanned PDF -> searchable PDF, text findable with pdftotext ---
run "$BIN" pdf from-images "$IN/eng-clean.png" "$IN/ben-clean.png" -o "$OUT/ocr-scan.pdf"
run "$BIN" pdf ocr "$OUT/ocr-scan.pdf" "$OUT/ocr-searchable.pdf" --lang eng+ben
pdfinfo "$OUT/ocr-searchable.pdf" | grep -Eq "Pages:\s+2" || { echo "FAIL: searchable PDF page count"; exit 1; }
pdftotext "$OUT/ocr-searchable.pdf" - | grep -q "OpenPixel Studio reads scanned documents" || { echo "FAIL: searchable PDF English text layer"; exit 1; }
pdftotext "$OUT/ocr-searchable.pdf" - | grep -q "ঢাকায়" || { echo "FAIL: searchable PDF Bengali text layer"; exit 1; }
pdfinfo "$OUT/ocr-searchable.pdf" | grep -q "Producer:.*Tesseract" || { echo "FAIL: searchable PDF producer should be Tesseract"; exit 1; }
# --- 12g. pdf ocr on a single image ---
run "$BIN" pdf ocr "$IN/eng-clean.png" "$OUT/ocr-one.pdf"
pdfinfo "$OUT/ocr-one.pdf" | grep -Eq "Pages:\s+1" || { echo "FAIL: single-image searchable PDF page count"; exit 1; }
pdftotext "$OUT/ocr-one.pdf" - | grep -q "quick brown fox" || { echo "FAIL: single-image text layer"; exit 1; }
# --- 12h. pdf info on an encrypted PDF reports encryption (Phase 4 fix) ---
run "$BIN" pdf protect "$IN/doc3.pdf" "$OUT/ocr-locked.pdf" --user-password user123 --no-print --no-copy
run "$BIN" pdf info "$OUT/ocr-locked.pdf"
"$BIN" pdf info "$OUT/ocr-locked.pdf" | grep -q "encrypted: yes" || { echo "FAIL: pdf info should report encrypted: yes"; exit 1; }
"$BIN" pdf info "$OUT/ocr-locked.pdf" | grep -q "algorithm: RC4-128" || { echo "FAIL: pdf info should report RC4-128"; exit 1; }
"$BIN" pdf info "$OUT/ocr-locked.pdf" | grep -q "pages:.*unknown (encrypted)" || { echo "FAIL: pdf info should say the page count is unknown"; exit 1; }
"$BIN" pdf info "$OUT/ocr-locked.pdf" | grep -q "print:no" || { echo "FAIL: pdf info should report print forbidden"; exit 1; }
"$BIN" --json pdf info "$OUT/ocr-locked.pdf" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['encrypted'] and d['encryption']['algorithm']=='RC4-128' and d['page_count']==0, d" || { echo "FAIL: pdf info --json encryption object"; exit 1; }
# --- 12i. ocr error cases (exit 1, clean error, no crash) ---
"$BIN" ocr "$OUT/ocr-scan.pdf" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: ocr on a PDF input should exit 1"; exit 1; }
"$BIN" ocr "$IN/eng-clean.png" --lang xx > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: ocr with an unknown language should exit 1"; exit 1; }
"$BIN" ocr "$IN/eng-clean.png" --psm 14 > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: ocr --psm 14 should exit 1"; exit 1; }
"$BIN" ocr "$IN/eng-clean.png" --preprocess bogus > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: ocr --preprocess bogus should exit 1"; exit 1; }
# --- 12j. process --op deskew/denoise cleans a scan before pdf ocr (Phase 4 ops) ---
run "$BIN" process "$IN/eng-skewed.png" "$OUT/skew-cleaned.png" --op deskew --op denoise
run "$BIN" ocr "$OUT/skew-cleaned.png" --preprocess none -o "$OUT/skew-cleaned.txt"
echo "skewed page cleaned with --op deskew --op denoise, then ocr with no preprocessing:"
cer "$OUT/skew-cleaned.txt" "$IN/eng-clean.txt" 0.02 0.10 || { echo "FAIL: --op deskew should recover the skewed page"; exit 1; }
"$BIN" process "$IN/eng-clean.png" "$OUT/threshold.png" --op threshold:128 > /dev/null 2>&1 || { echo "FAIL: --op threshold:128 should work"; exit 1; }
"$BIN" process "$IN/eng-clean.png" "$OUT/bad.png" --op bogus > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: --op bogus should exit 1"; exit 1; }
echo "=== 13. pdf editing + signatures + redaction + sanitisation (Studio Phase 5) ==="
# Fixtures: a 2-page TEXT pdf (overlays must be visible when rendered,
# redaction needs real text) and a malicious PDF (JS + embedded file +
# Launch), both built inline with python — no checked-in PDFs, no
# external tool. The xref is computed programmatically.
python3 - "$IN" <<'PYEOF'
import sys
out = sys.argv[1]
def build_pdf(pages_text, malicious=False):
    objs = {}
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    if malicious:
        objs[1] = b"<< /Type /Catalog /Pages 2 0 R /OpenAction 7 0 R /Names 8 0 R >>"
    n = len(pages_text)
    page_ids = [3 + 2*i for i in range(n)]
    content_ids = [4 + 2*i for i in range(n)]
    # The malicious fixture's extra objects use ids 5,7-12, so its
    # font/info live at 20/21 instead of colliding with them.
    font_id = 20 if malicious else 3 + 2*n
    info_id = 21 if malicious else font_id + 1
    objs[2] = ("<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join(f"{p} 0 R" for p in page_ids), n)).encode()
    for i, text in enumerate(pages_text):
        annots = b" /Annots [9 0 R]" if (malicious and i == 0) else b""
        objs[page_ids[i]] = f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_ids[i]} 0 R{annots.decode()} >>".encode()
        stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET".encode()
        objs[content_ids[i]] = b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
    objs[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objs[info_id] = b"<< /Title (Test doc) /Author (OpenPixel test) >>"
    if malicious:
        objs[5] = b"<< /Type /Filespec /F (evil.txt) /EF << /F 10 0 R >> >>"
        objs[7] = b"<< /S /JavaScript /JS (app.alert('pwned');) >>"
        objs[8] = b"<< /EmbeddedFiles << /Names [(evil.txt) 5 0 R] >> >>"
        objs[9] = b"<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /A 11 0 R >>"
        objs[10] = b"<< /Length 4 >>\nstream\nevil\nendstream"
        objs[11] = b"<< /S /Launch /Win << /F (cmd.exe) >> >>"
        objs[12] = b"<< /Title (Malicious doc) >>"
        del objs[info_id]
    data = bytearray(b"%PDF-1.5\n")
    offsets = {}
    for oid in sorted(objs):
        offsets[oid] = len(data)
        data += f"{oid} 0 obj\n".encode() + objs[oid] + b"\nendobj\n"
    xref_pos = len(data)
    max_id = max(objs)
    data += f"xref\n0 {max_id+1}\n".encode() + b"0000000000 65535 f \n"
    for oid in range(1, max_id+1):
        # Unused ids (the malicious fixture skips 6 and 13-19) are free entries.
        if oid in offsets:
            data += f"{offsets[oid]:010d} 00000 n \n".encode()
        else:
            data += b"0000000000 65535 f \n"
    info_ref = 12 if malicious else info_id
    data += f"trailer\n<< /Size {max_id+1} /Root 1 0 R /Info {info_ref} 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    return bytes(data)
open(f"{out}/text2.pdf", "wb").write(build_pdf(["SECRET-123 is here. PUBLIC line.", "Second page. SECRET-123 again."]))
open(f"{out}/malicious.pdf", "wb").write(build_pdf(["Hello malicious"], malicious=True))
print("fixtures written")
PYEOF
# --- 13a. edit: text + page numbers + header/footer + rect + comment + image ---
run "$BIN" pdf edit "$IN/text2.pdf" "$OUT/edit.pdf" --text "DRAFT" --page 1 --x 72 --y 750 --size 18 --color "#ff0000" --page-numbers --header "Confidential" --footer "Page footer"
run "$BIN" pdf edit "$OUT/edit.pdf" "$OUT/edit2.pdf" --op '{"kind":"rect","page":1,"x":72,"y":650,"width":200,"height":30,"fill":{"r":1,"g":0.9,"b":0},"stroke":null,"stroke_width":1}' --op '{"kind":"comment","page":2,"x":100,"y":700,"text":"Review this page","author":"Raju"}' --image "$IN/checker-64.heic" --page 1 --x 400 --y 600
pdfinfo "$OUT/edit2.pdf" | grep -Eq "Pages:\\s+2" || { echo "FAIL: edited PDF page count"; exit 1; }
# The overlay is visible when rendered (a genuine PNG) and the text is extractable.
run "$BIN" pdf render "$OUT/edit2.pdf" --scale 1.0 --out-dir "$OUT/edit-pages"
file "$OUT/edit-pages/edit2-p1.png" | grep -q "PNG image data, 612 x 792" || { echo "FAIL: rendered edited page is not a genuine 612x792 PNG"; exit 1; }
run "$BIN" pdf extract-text "$OUT/edit2.pdf" --output "$OUT/edit2.txt"
grep -q "DRAFT" "$OUT/edit2.txt" || { echo "FAIL: overlay text DRAFT should be extractable"; exit 1; }
grep -q "Page 1 of 2" "$OUT/edit2.txt" || { echo "FAIL: page number should be extractable"; exit 1; }
grep -q "Confidential" "$OUT/edit2.txt" || { echo "FAIL: header should be extractable"; exit 1; }
grep -q "SECRET-123 is here" "$OUT/edit2.txt" || { echo "FAIL: edit must keep the original text"; exit 1; }
# --- 13b. redact --text: byte-proof (the secret is gone from the file bytes) ---
run "$BIN" pdf redact "$IN/text2.pdf" "$OUT/redacted.pdf" --text "SECRET-123"
grep -a -q "SECRET-123" "$OUT/redacted.pdf" && { echo "FAIL: SECRET-123 still in the redacted file bytes"; exit 1; }
grep -a -q "PUBLIC line" "$OUT/redacted.pdf" || { echo "FAIL: PUBLIC line should survive redaction"; exit 1; }
pdfinfo "$OUT/redacted.pdf" | grep -Eq "Pages:\\s+2" || { echo "FAIL: redacted PDF page count"; exit 1; }
run "$BIN" pdf extract-text "$OUT/redacted.pdf" --output "$OUT/redacted.txt"
grep -q "SECRET-123" "$OUT/redacted.txt" && { echo "FAIL: SECRET-123 still in the redacted text layer"; exit 1; }
grep -q "PUBLIC line" "$OUT/redacted.txt" || { echo "FAIL: PUBLIC line should survive in the text layer"; exit 1; }
# --- 13c. redact --rect: the text inside the rectangle is gone, the rest survives ---
# The rect is only on page 1, so page 2's SECRET-123 legitimately
# remains — the check is per page, via the extracted text layer.
run "$BIN" pdf redact "$IN/text2.pdf" "$OUT/redacted-rect.pdf" --rect "72,700,120,30" --page 1
run "$BIN" pdf extract-text "$OUT/redacted-rect.pdf" --output "$OUT/redacted-rect.txt"
grep -q "SECRET-123 is here" "$OUT/redacted-rect.txt" && { echo "FAIL: page 1 SECRET-123 should be gone after rect redaction"; exit 1; }
grep -q "SECRET-123 again" "$OUT/redacted-rect.txt" || { echo "FAIL: page 2 SECRET-123 should survive rect redaction on page 1"; exit 1; }
grep -q "PUBLIC line" "$OUT/redacted-rect.txt" || { echo "FAIL: PUBLIC line should survive rect redaction"; exit 1; }
# --- 13d. sign -> verify round-trip on a real (openssl) certificate ---
openssl req -x509 -newkey rsa:2048 -keyout "$OUT/test-key.pem" -out "$OUT/test-cert.pem" -days 365 -nodes -subj "/CN=OpenPixel Test Signer/O=OpenPixel Test" 2>/dev/null || { echo "FAIL: openssl could not make a test certificate"; exit 1; }
run "$BIN" pdf sign "$IN/text2.pdf" "$OUT/signed.pdf" --key "$OUT/test-key.pem" --cert "$OUT/test-cert.pem" --reason "Test signature" --location "Dhaka"
pdfinfo "$OUT/signed.pdf" | grep -Eq "Pages:\\s+2" || { echo "FAIL: signed PDF page count"; exit 1; }
"$BIN" pdf verify-sign "$OUT/signed.pdf" --trust "$OUT/test-cert.pem" | grep -q "valid: yes, trusted: yes" || { echo "FAIL: signature should verify valid + trusted with its anchor"; exit 1; }
"$BIN" pdf verify-sign "$OUT/signed.pdf" | grep -q "valid: yes, trusted: no" || { echo "FAIL: signature should be valid but untrusted without an anchor"; exit 1; }
"$BIN" pdf verify-sign "$IN/text2.pdf" | grep -q "no signatures" || { echo "FAIL: unsigned PDF should report no signatures"; exit 1; }
# Tamper: flip one byte of page content — the digest must no longer match.
python3 - "$OUT/signed.pdf" "$OUT/tampered.pdf" <<'PYEOF'
import sys
data = bytearray(open(sys.argv[1], 'rb').read())
i = data.find(b'SECRET-123')
data[i] = ord('X')
open(sys.argv[2], 'wb').write(bytes(data))
PYEOF
"$BIN" pdf verify-sign "$OUT/tampered.pdf" --trust "$OUT/test-cert.pem" | grep -q "valid: no" || { echo "FAIL: tampered PDF should verify invalid"; exit 1; }
"$BIN" pdf verify-sign "$OUT/tampered.pdf" --trust "$OUT/test-cert.pem" | grep -q "DOES NOT match" || { echo "FAIL: tamper should be reported as a digest mismatch"; exit 1; }
# --- 13e. flatten: the comment added by edit has no appearance stream,
# so flatten honestly DROPS it (with a warning) instead of pretending
# to render it into the page — 0 flattened, 1 dropped.
run "$BIN" pdf flatten "$OUT/edit2.pdf" "$OUT/flat.pdf"
pdfinfo "$OUT/flat.pdf" | grep -Eq "Pages:\\s+2" || { echo "FAIL: flattened PDF page count"; exit 1; }
"$BIN" pdf flatten "$OUT/edit2.pdf" "$OUT/flat2.pdf" | grep -q "0 annotation(s) flattened, 1 dropped" || { echo "FAIL: flatten should report 0 flattened, 1 dropped"; exit 1; }
# --- 13f. set-metadata: title set, author cleared with an empty string ---
run "$BIN" pdf set-metadata "$IN/text2.pdf" "$OUT/meta.pdf" --title "New title" --author ""
"$BIN" pdf info "$OUT/meta.pdf" | grep -q "title:     New title" || { echo "FAIL: metadata title should be set"; exit 1; }
"$BIN" pdf info "$OUT/meta.pdf" | grep -q "author:" && { echo "FAIL: metadata author should be cleared"; exit 1; }
# --- 13g. repair: a healthy file reads "as written"; a broken xref is reconstructed ---
run "$BIN" pdf repair "$IN/text2.pdf" "$OUT/repaired.pdf"
"$BIN" pdf repair "$IN/text2.pdf" "$OUT/repaired2.pdf" | grep -q "recovery: as written" || { echo "FAIL: healthy file should repair as written"; exit 1; }
python3 - "$IN/text2.pdf" "$OUT/broken.pdf" <<'PYEOF'
import sys, re
data = open(sys.argv[1], 'rb').read()
m = re.search(rb'startxref\n(\d+)\n', data)
data = data[:m.start(1)] + b'0' * len(m.group(1)) + data[m.end(1):]
open(sys.argv[2], 'wb').write(data)
PYEOF
run "$BIN" pdf repair "$OUT/broken.pdf" "$OUT/repaired-broken.pdf"
"$BIN" pdf repair "$OUT/broken.pdf" "$OUT/repaired-broken2.pdf" | grep -q "recovery: reconstructed" || { echo "FAIL: broken xref should be reconstructed"; exit 1; }
pdfinfo "$OUT/repaired-broken.pdf" | grep -Eq "Pages:\\s+2" || { echo "FAIL: repaired broken PDF page count"; exit 1; }
# --- 13h. inspect + sanitize: the malicious fixture, before and after ---
run "$BIN" pdf inspect "$IN/malicious.pdf"
"$BIN" pdf inspect "$IN/malicious.pdf" | grep -q "javascript:    PRESENT" || { echo "FAIL: inspect should report JavaScript present"; exit 1; }
"$BIN" pdf inspect "$IN/malicious.pdf" | grep -q "embedded files: PRESENT" || { echo "FAIL: inspect should report embedded files present"; exit 1; }
"$BIN" pdf inspect "$IN/malicious.pdf" | grep -q "launch actions: PRESENT" || { echo "FAIL: inspect should report launch actions present"; exit 1; }
"$BIN" pdf inspect "$IN/malicious.pdf" | grep -q "auto actions:   PRESENT" || { echo "FAIL: inspect should report auto actions present"; exit 1; }
run "$BIN" pdf sanitize "$IN/malicious.pdf" "$OUT/clean.pdf"
for marker in "/JavaScript" "/Launch" "/EmbeddedFiles" "app.alert" "evil.txt" "cmd.exe"; do
  grep -a -q "$marker" "$OUT/clean.pdf" && { echo "FAIL: $marker still in the sanitized file bytes"; exit 1; }
done
"$BIN" pdf inspect "$OUT/clean.pdf" | grep -q "javascript:    absent" || { echo "FAIL: sanitized PDF should report JavaScript absent"; exit 1; }
"$BIN" pdf inspect "$OUT/clean.pdf" | grep -q "embedded files: absent" || { echo "FAIL: sanitized PDF should report embedded files absent"; exit 1; }
pdfinfo "$OUT/clean.pdf" | grep -Eq "Pages:\\s+1" || { echo "FAIL: sanitized PDF should still open with 1 page"; exit 1; }
# --- 13i. error cases (exit 1, clean error, no crash) ---
"$BIN" pdf edit "$IN/text2.pdf" "$OUT/x.pdf" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf edit with no ops should exit 1"; exit 1; }
"$BIN" pdf redact "$IN/text2.pdf" "$OUT/x.pdf" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf redact with no redactions should exit 1"; exit 1; }
"$BIN" pdf edit "$IN/text2.pdf" "$OUT/x.pdf" --op 'not json' > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf edit with bad --op JSON should exit 1"; exit 1; }
"$BIN" pdf sign "$IN/text2.pdf" "$OUT/x.pdf" --key "$IN/text2.pdf" --cert "$OUT/test-cert.pem" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf sign with a bad key should exit 1"; exit 1; }
"$BIN" pdf set-metadata "$IN/text2.pdf" "$OUT/x.pdf" > /dev/null 2>&1
[ $? -eq 1 ] || { echo "FAIL: pdf set-metadata with no fields should exit 1"; exit 1; }
echo "=== 14. process isolation (Phase 8): RSS kill, no partial output, escape hatch ==="
# A 16 MiB RSS cap is below any real conversion's footprint, so the
# supervised child must be killed and the error must name the cap.
# No output file and no temp file may be left behind.
OPENPIXEL_MAX_RSS_MB=16 "$BIN" convert "$IN/rgba.png" "$OUT/rss-killed.jpg" > /tmp/op-e2e/cli/rss.log 2>&1
[ $? -eq 1 ] || { echo "FAIL: convert under a 16 MiB RSS cap should exit 1"; exit 1; }
grep -q "RSS cap" /tmp/op-e2e/cli/rss.log || { echo "FAIL: RSS kill should name the cap"; exit 1; }
grep -q "killed" /tmp/op-e2e/cli/rss.log || { echo "FAIL: RSS kill should say the child was killed"; exit 1; }
[ ! -e "$OUT/rss-killed.jpg" ] || { echo "FAIL: RSS-killed convert must not leave an output file"; exit 1; }
[ ! -e "$OUT/rss-killed.jpg.openpixel-tmp" ] || { echo "FAIL: RSS-killed convert must not leave a temp file"; exit 1; }
# Same cap through process (not just convert).
OPENPIXEL_MAX_RSS_MB=16 "$BIN" process "$IN/rgba.png" "$OUT/rss-killed2.png" --resize 128x96 > /tmp/op-e2e/cli/rss2.log 2>&1
[ $? -eq 1 ] || { echo "FAIL: process under a 16 MiB RSS cap should exit 1"; exit 1; }
grep -q "RSS cap" /tmp/op-e2e/cli/rss2.log || { echo "FAIL: process RSS kill should name the cap"; exit 1; }
[ ! -e "$OUT/rss-killed2.png" ] || { echo "FAIL: RSS-killed process must not leave an output file"; exit 1; }
# The escape hatch: with isolation off, the same cap is ignored and
# the conversion succeeds in-process (old behaviour, debug only).
OPENPIXEL_NO_ISOLATION=1 OPENPIXEL_MAX_RSS_MB=16 "$BIN" convert "$IN/rgba.png" "$OUT/rss-noiso.jpg" > /tmp/op-e2e/cli/noiso.log 2>&1
[ $? -eq 0 ] || { echo "FAIL: NO_ISOLATION convert should succeed despite the RSS cap"; exit 1; }
[ -s "$OUT/rss-noiso.jpg" ] || { echo "FAIL: NO_ISOLATION convert should write an output file"; exit 1; }
# Batch under the cap, both paths: every real file fails with the RSS
# cap named, the batch still reports (exit 0 for the batch run) and
# no output files are left behind. $IN/batch has 5 files (4 images +
# corrupt.png, which fails on decode either way).
OPENPIXEL_MAX_RSS_MB=16 "$BIN" batch "$IN/batch" --format webp --workers 1 --out-dir "$OUT/batch-rss" --json > /tmp/op-e2e/cli/rss-batch.json 2>&1
[ $? -eq 0 ] || { echo "FAIL: sequential RSS-capped batch should still exit 0"; exit 1; }
grep -q '"failed": 5' /tmp/op-e2e/cli/rss-batch.json || { echo "FAIL: sequential RSS-capped batch should fail all 5 files"; exit 1; }
grep -q "RSS cap" /tmp/op-e2e/cli/rss-batch.json || { echo "FAIL: sequential batch failures should name the RSS cap"; exit 1; }
[ -z "$(ls -A "$OUT/batch-rss" 2>/dev/null)" ] || { echo "FAIL: sequential RSS-capped batch must not leave outputs"; exit 1; }
OPENPIXEL_MAX_RSS_MB=16 "$BIN" batch "$IN/batch" --format webp --workers 2 --out-dir "$OUT/batch-rss2" --json > /tmp/op-e2e/cli/rss-batch2.json 2>&1
[ $? -eq 0 ] || { echo "FAIL: parallel RSS-capped batch should still exit 0"; exit 1; }
grep -q '"failed": 5' /tmp/op-e2e/cli/rss-batch2.json || { echo "FAIL: parallel RSS-capped batch should fail all 5 files"; exit 1; }
grep -q "RSS cap" /tmp/op-e2e/cli/rss-batch2.json || { echo "FAIL: parallel batch failures should name the RSS cap"; exit 1; }
[ -z "$(ls -A "$OUT/batch-rss2" 2>/dev/null)" ] || { echo "FAIL: parallel RSS-capped batch must not leave outputs"; exit 1; }
echo "=== DONE ==="
ls -la "$OUT" | head -50
