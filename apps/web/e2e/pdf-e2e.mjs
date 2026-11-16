// OpenPixel web e2e — PDF tab. Real Chromium (cached ms-playwright
// build) driven by playwright-core. Serves the production build over
// plain HTTP. Usage: node apps/web/e2e/pdf-e2e.mjs (server must
// already run on 8323, serving apps/web/dist with the WASM module).
// Checks: PDF tab renders; info shows the real page count/version/
// page sizes; pdf.js preview actually paints the selected page;
// PDF→PNG downloads a genuine PNG at the requested scale; merge
// (4+2 pages) downloads a real 6-page PDF; split downloads one
// real PDF per range; rotate and extract download real PDFs with
// the right page counts; compress downloads a real PDF that is no
// bigger than the input (with the measured sizes in the report);
// images→PDF builds a real PDF. Every downloaded file is verified
// with `file(1)` and the CLI (`openpixel pdf info` for PDFs,
// `openpixel info` for images).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WEB_BASE || 'http://127.0.0.1:8323/';
const IN = '/tmp/op-e2e/pdf-in';
const IMG_IN = '/tmp/op-e2e/cli/in';
const DL = '/tmp/op-e2e/pdf-dl';
const SHOT = '/home/hatch/workspace/openpixel-engine/apps/web/e2e/screenshots';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const CLI_IMG = '/home/hatch/workspace/openpixel-engine/target/release/openpixel';
const CLI_PDF = '/home/hatch/workspace/openpixel-engine/target/debug/openpixel';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// Minimal 2-page TEXT pdf (the doc4/doc2 fixtures are image-based, so
// text overlay + redaction need a real text layer). Built in JS with
// programmatically computed xref offsets — no python, no checked-in PDF.
// Page 1: "SECRET-123 is here. PUBLIC line."  Page 2: "Second page.
// SECRET-123 again." (same content as the CLI e2e §13 fixture).
function makeTextPdf() {
  const pages = ['SECRET-123 is here. PUBLIC line.', 'Second page. SECRET-123 again.'];
  const n = pages.length;
  const pageIds = pages.map((_, i) => 3 + 2 * i);
  const contentIds = pages.map((_, i) => 4 + 2 * i);
  const fontId = 3 + 2 * n;
  const infoId = fontId + 1;
  const objs = new Map();
  objs.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objs.set(2, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${n} >>`);
  pages.forEach((text, i) => {
    objs.set(pageIds[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`);
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    objs.set(contentIds[i], `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.set(infoId, '<< /Title (Test doc) /Author (OpenPixel test) >>');
  const chunks = [Buffer.from('%PDF-1.5\n')];
  const offsets = new Map();
  let pos = chunks[0].length;
  for (const oid of [...objs.keys()].sort((a, b) => a - b)) {
    offsets.set(oid, pos);
    const b = Buffer.from(`${oid} 0 obj\n${objs.get(oid)}\nendobj\n`);
    chunks.push(b);
    pos += b.length;
  }
  const xrefPos = pos;
  const maxId = Math.max(...objs.keys());
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let oid = 1; oid <= maxId; oid++) {
    xref += `${String(offsets.get(oid)).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}
fs.mkdirSync(IN, { recursive: true });
fs.writeFileSync(path.join(IN, 'text2.pdf'), makeTextPdf());

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const failedReqs = [];
page.on('requestfailed', (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('pageerror', (e) => failedReqs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') failedReqs.push(`console.error: ${m.text()}`); });

async function shot(name) { await page.screenshot({ path: path.join(SHOT, name) }); }

function verifyPdf(p, expectPages) {
  try {
    const f = execFileSync('file', ['-b', p], { encoding: 'utf8' }).trim();
    const info = execFileSync(CLI_PDF, ['pdf', 'info', p], { encoding: 'utf8' });
    const pages = Number((info.match(/^pages:\s+(\d+)/m) || [])[1]);
    const ok = f.includes('PDF document') && pages === expectPages;
    return { ok, detail: `${path.basename(p)}: file=${f} | pages=${pages} (want ${expectPages})` };
  } catch (e) {
    return { ok: false, detail: `${p}: verify failed: ${String(e.message).slice(0, 200)}` };
  }
}

function verifyImage(p, expectFormat, expectDims) {
  try {
    const f = execFileSync('file', ['-b', p], { encoding: 'utf8' }).trim();
    const info = execFileSync(CLI_IMG, ['info', p], { encoding: 'utf8' });
    const fmt = (info.match(/^format:\s+(\S+)/m) || [])[1];
    const dims = (info.match(/^size:\s+(\S+)/m) || [])[1];
    const size = fs.statSync(p).size;
    const ok = fmt === expectFormat && (!expectDims || dims === expectDims);
    return { ok, detail: `${path.basename(p)}: file=${f} | info format=${fmt} size=${dims} bytes=${size}` };
  } catch (e) {
    return { ok: false, detail: `${p}: verify failed: ${String(e.message).slice(0, 200)}` };
  }
}

async function waitStatus(text) {
  await page.waitForFunction(
    (t) => document.querySelector('#pdf-result-status')?.textContent.includes(t),
    text,
    { timeout: 60000 },
  );
}

async function downloadResult(index) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator(`#pdf-download-${index}`).click(),
  ]);
  const p = path.join(DL, dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}

// --- 1. load + PDF tab ---
await page.goto(BASE, { waitUntil: 'networkidle' });
check('page loads, title OpenPixel', (await page.title()).includes('OpenPixel'), await page.title());
await page.locator('#tab-pdf').click();
await page.waitForSelector('#panel-pdf', { timeout: 10000 });
check('PDF tab renders', (await page.locator('#pdf-heading').innerText()) === 'PDF tools');
await shot('21-pdf-tab.png');

// --- 2. upload doc4.pdf (4 pages: p1 256x192 pt) ---
await page.setInputFiles('#pdf-file', path.join(IN, 'doc4.pdf'));
await page.waitForSelector('#pdf-page-count', { timeout: 30000 });
const pageCount = await page.locator('#pdf-page-count').innerText();
check('info page count is just the number (no "Pages:" prefix)', pageCount.trim() === '4', pageCount);
const infoText = await page.locator('#pdf-info').innerText();
check('info shows version 1.5 and page sizes', infoText.includes('PDF 1.5') && infoText.includes('256 × 192 pt'), infoText.replace(/\n/g, ' | ').slice(0, 200));
// pdf.js preview: page 1 at the default 2x scale is 512x384 px.
// A broken worker would leave the canvas blank / dims unset.
await page.waitForSelector('#pdf-preview-dims', { timeout: 30000 });
const dims = await page.locator('#pdf-preview-dims').innerText();
const canvasSize = await page.evaluate(() => {
  const c = document.querySelector('#pdf-preview-canvas');
  return c ? `${c.width}x${c.height}` : 'no canvas';
});
check('pdf.js preview paints page 1 at 512x384 (2x scale)', dims.includes('512 × 384 px') && canvasSize === '512x384', `${dims} | canvas=${canvasSize}`);
await shot('22-pdf-loaded.png');

// --- 3. PDF -> PNG at 2x scale: genuine 512x384 PNG ---
const [pngDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('#pdf-render-download').click(),
]);
const pngPath = path.join(DL, pngDl.suggestedFilename());
await pngDl.saveAs(pngPath);
const pngInfo = verifyImage(pngPath, 'png', '512x384');
check('PDF page 1 renders to a genuine PNG 512x384', pngInfo.ok, pngInfo.detail);
await waitStatus('Rendered page 1 as PNG: 512 × 384 px');
check('render status line reports real dimensions', true, await page.locator('#pdf-result-status').innerText());

// --- 4. merge doc4 + doc2 -> 6 pages ---
await page.setInputFiles('#pdf-merge-file', path.join(IN, 'doc2.pdf'));
await page.locator('#pdf-merge-button').click();
await waitStatus('Merged PDF: 6 pages');
const mergedPath = await downloadResult(0);
const mergedInfo = verifyPdf(mergedPath, 6);
check('merge downloads a real 6-page PDF', mergedInfo.ok, mergedInfo.detail);

// --- 5. split 1-2,3-4 -> two 2-page PDFs ---
await page.fill('#pdf-split-ranges', '1-2,3-4');
await page.locator('#pdf-split-button').click();
await waitStatus('Split PDF: split into 2 documents (2 pages, 2 pages)');
const split1 = await downloadResult(0);
const split1Info = verifyPdf(split1, 2);
check('split part 1 is a real 2-page PDF', split1Info.ok, split1Info.detail);
const split2 = await downloadResult(1);
const split2Info = verifyPdf(split2, 2);
check('split part 2 is a real 2-page PDF', split2Info.ok, split2Info.detail);

// --- 6. rotate page 1 -> still 4 pages ---
await page.fill('#pdf-rotate-pages', '1');
await page.locator('#pdf-rotate-button').click();
await waitStatus('Rotated PDF: 4 pages');
const rotatedPath = await downloadResult(0);
const rotatedInfo = verifyPdf(rotatedPath, 4);
check('rotate downloads a real 4-page PDF', rotatedInfo.ok, rotatedInfo.detail);

// --- 7. extract pages 1,3 -> 2 pages ---
await page.fill('#pdf-extract-pages', '1,3');
await page.locator('#pdf-extract-button').click();
await waitStatus('Extracted PDF: 2 pages');
const extractedPath = await downloadResult(0);
const extractedInfo = verifyPdf(extractedPath, 2);
check('extract downloads a real 2-page PDF', extractedInfo.ok, extractedInfo.detail);

// --- 8. images -> PDF (2 images -> 2 pages) ---
await page.setInputFiles('#pdf-images-file', [path.join(IMG_IN, 'rgba.png'), path.join(IMG_IN, 'photo.jpg')]);
await page.locator('#pdf-from-images-button').click();
await waitStatus('Images to PDF: 2 pages');
const builtPath = await downloadResult(0);
const builtInfo = verifyPdf(builtPath, 2);
check('images to PDF builds a real 2-page PDF', builtInfo.ok, builtInfo.detail);

// --- 8b. compress (screen mode) -> still 4 pages, no bigger than the input ---
// doc4.pdf is built from images (Flate RGB), so screen mode must
// actually shrink it; the engine's best-of rule guarantees the
// result is never bigger than the input in any case.
await page.locator('#pdf-compress-mode').selectOption('screen');
await page.locator('#pdf-compress-button').click();
await waitStatus('Compressed PDF');
const compStatus = await page.locator('#pdf-result-status').innerText();
const compressedPath = await downloadResult(0);
const compressedInfo = verifyPdf(compressedPath, 4);
const compIn = fs.statSync(path.join(IN, 'doc4.pdf')).size;
const compOut = fs.statSync(compressedPath).size;
check(
  'compress downloads a real 4-page PDF no bigger than the input',
  compressedInfo.ok && compOut <= compIn,
  `${compressedInfo.detail} | ${compIn} -> ${compOut} bytes | status: ${compStatus}`,
);

// --- 8c-8j. Edit (Phase 5) on the text PDF: overlay, page numbers,
// redaction (byte-proof), metadata, threat check, sanitize, flatten,
// repair. The text PDF is uploaded fresh so the Edit card works on it.
function extractText(p) {
  const out = path.join(DL, `${path.basename(p, '.pdf')}.txt`);
  execFileSync(CLI_IMG, ['pdf', 'extract-text', p, '--output', out], { encoding: 'utf8' });
  return fs.readFileSync(out, 'utf8');
}
// The DropZone (#pdf-file) only renders when no file is loaded, so
// switch files with the "Choose a different file" button first.
await page.getByRole('button', { name: 'Choose a different file' }).click();
await page.waitForSelector('#pdf-file', { timeout: 10000 });
await page.setInputFiles('#pdf-file', path.join(IN, 'text2.pdf'));
await page.waitForSelector('#pdf-page-count', { timeout: 30000 });
check('text PDF uploads with 2 pages', (await page.locator('#pdf-page-count').innerText()).trim() === '2');

// --- 8c. add a text overlay: the overlay is extractable, original kept ---
await page.fill('#pdf-edit-text', 'DRAFT');
await page.locator('#pdf-edit-text-button').click();
await waitStatus('Edited PDF: 1 op');
const editedPath = await downloadResult(0);
const editedInfo = verifyPdf(editedPath, 2);
const editedText = editedInfo.ok ? extractText(editedPath) : '';
check(
  'add text downloads a real 2-page PDF with the overlay extractable',
  editedInfo.ok && editedText.includes('DRAFT') && editedText.includes('SECRET-123 is here'),
  `${editedInfo.detail} | text: ${editedText.replace(/\n/g, ' | ').slice(0, 160)}`,
);

// --- 8d. page numbers: "Page 1 of 2" appears in the text layer ---
// (A page-numbers op expands to one text op per page, so the status
// counts 2 ops on 2 pages.)
await page.locator('#pdf-edit-pagenum-button').click();
await waitStatus('Edited PDF: 2 ops on 2 pages');
const numberedPath = await downloadResult(0);
const numberedInfo = verifyPdf(numberedPath, 2);
const numberedText = numberedInfo.ok ? extractText(numberedPath) : '';
check(
  'page numbers downloads a real 2-page PDF with "Page 1 of 2"',
  numberedInfo.ok && numberedText.includes('Page 1 of 2'),
  `${numberedInfo.detail} | text: ${numberedText.replace(/\n/g, ' | ').slice(0, 160)}`,
);

// --- 8e. redact the secret by text: byte-proof (absent from the file
// bytes) AND absent from the text layer, while PUBLIC line survives ---
await page.fill('#pdf-redact-text', 'SECRET-123');
await page.locator('#pdf-redact-text-button').click();
await waitStatus('Redacted PDF: 2 runs, 20 characters removed');
const redactedPath = await downloadResult(0);
const redactedInfo = verifyPdf(redactedPath, 2);
const redactedBytes = redactedInfo.ok ? fs.readFileSync(redactedPath) : Buffer.alloc(0);
const redactedText = redactedInfo.ok ? extractText(redactedPath) : '';
check(
  'redact removes SECRET-123 from the file bytes and the text layer',
  redactedInfo.ok
    && !redactedBytes.includes(Buffer.from('SECRET-123'))
    && !redactedText.includes('SECRET-123')
    && redactedText.includes('PUBLIC line'),
  `${redactedInfo.detail} | text: ${redactedText.replace(/\n/g, ' | ').slice(0, 160)}`,
);

// --- 8f. metadata: title set, author cleared ---
await page.fill('#pdf-meta-title', 'Web edit title');
await page.fill('#pdf-meta-author', '');
await page.locator('#pdf-meta-button').click();
await waitStatus('Metadata PDF: title/author/subject/keywords updated');
const metaPath = await downloadResult(0);
const metaInfo = verifyPdf(metaPath, 2);
const metaOut = metaInfo.ok ? execFileSync(CLI_IMG, ['pdf', 'info', metaPath], { encoding: 'utf8' }) : '';
check(
  'metadata downloads a real 2-page PDF with the new title',
  metaInfo.ok && metaOut.includes('title:     Web edit title'),
  `${metaInfo.detail} | info: ${metaOut.replace(/\n/g, ' | ').slice(0, 160)}`,
);

// --- 8g. threat check on the clean text PDF: clean ---
await page.locator('#pdf-inspect-button').click();
await waitStatus('Threat check: clean');
check('threat check reports the clean text PDF as clean', true, await page.locator('#pdf-result-status').innerText());

// --- 8h. sanitize a clean PDF: nothing removed, file unchanged ---
// (The UI labels this "Cleaned PDF", not "Sanitized PDF".)
await page.locator('#pdf-sanitize-button').click();
await waitStatus('Cleaned PDF: nothing dangerous was found');
const cleanPath = await downloadResult(0);
const cleanInfo = verifyPdf(cleanPath, 2);
check('sanitize downloads a real 2-page PDF for a clean input', cleanInfo.ok, cleanInfo.detail);

// --- 8i. flatten: still a real 2-page PDF ---
await page.locator('#pdf-flatten-button').click();
await waitStatus('Flattened PDF');
const flatPath = await downloadResult(0);
const flatInfo = verifyPdf(flatPath, 2);
check('flatten downloads a real 2-page PDF', flatInfo.ok, flatInfo.detail);

// --- 8j. repair a healthy file: "as written", still a real 2-page PDF ---
await page.locator('#pdf-repair-button').click();
await waitStatus('Repaired PDF: cross-reference table read "as written"');
const repairedPath = await downloadResult(0);
const repairedInfo = verifyPdf(repairedPath, 2);
check('repair downloads a real 2-page PDF', repairedInfo.ok, repairedInfo.detail);

// --- 9. dark mode screenshot ---
await page.locator('button[aria-label="Switch to dark theme"]').click();
await page.waitForFunction(() => document.documentElement.classList.contains('dark'), null, { timeout: 10000 });
check('dark mode toggles on the PDF tab', await page.evaluate(() => document.documentElement.classList.contains('dark')));
await shot('23-pdf-dark.png');

console.log('\n--- failed requests/console errors ---');
console.log(failedReqs.length ? failedReqs.join('\n') : '(none)');
const fails = results.filter((r) => !r.ok).length;
console.log(`\nPDF E2E: ${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
