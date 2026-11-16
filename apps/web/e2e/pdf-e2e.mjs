// OpenPixel web e2e — PDF tab. Real Chromium (cached ms-playwright
// build) driven by playwright-core. Serves the production build over
// plain HTTP. Usage: node apps/web/e2e/pdf-e2e.mjs (server must
// already run on 8323, serving apps/web/dist with the WASM module).
// Checks: PDF tab renders; info shows the real page count/version/
// page sizes; pdf.js preview actually paints the selected page;
// PDF→PNG downloads a genuine PNG at the requested scale; merge
// (4+2 pages) downloads a real 6-page PDF; split downloads one
// real PDF per range; rotate and extract download real PDFs with
// the right page counts; images→PDF builds a real PDF. Every
// downloaded file is verified with `file(1)` and the CLI
// (`openpixel pdf info` for PDFs, `openpixel info` for images).
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
check('info shows Pages: 4', pageCount.includes('Pages: 4'), pageCount);
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
