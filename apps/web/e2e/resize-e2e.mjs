// OpenPixel web e2e — Resize tab. Real Chromium (cached ms-playwright
// build) driven by playwright-core. Serves the production build over
// plain HTTP. Usage: node apps/web/e2e/resize-e2e.mjs (server must
// already run on 8321, serving apps/web/dist with the WASM module).
// Checks: Resize tab renders; aspect lock; ResizeFit 800x600 is a
// genuine JPEG at exact dimensions; target-size 50 KB JPEG fits;
// never-upscale clamps a small source; batch resize + zip download.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WEB_BASE || 'http://127.0.0.1:8321/';
const IN = '/tmp/op-e2e/cli/in';
const DL = '/tmp/op-e2e/resize-dl';
const SHOT = '/home/hatch/workspace/openpixel-engine/apps/web/e2e/screenshots';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const CLI = '/home/hatch/workspace/openpixel-engine/target/release/openpixel';

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

function verify(p, expectFormat, expectDims) {
  try {
    const f = execFileSync('file', ['-b', p], { encoding: 'utf8' }).trim();
    const info = execFileSync(CLI, ['info', p], { encoding: 'utf8' });
    const fmt = (info.match(/^format:\s+(\S+)/m) || [])[1];
    const dims = (info.match(/^size:\s+(\S+)/m) || [])[1];
    const size = fs.statSync(p).size;
    const ok = fmt === expectFormat && (!expectDims || dims === expectDims);
    return { ok, detail: `${path.basename(p)}: file=${f} | info format=${fmt} size=${dims} bytes=${size}` };
  } catch (e) {
    return { ok: false, detail: `${p}: verify failed: ${String(e.message).slice(0, 200)}` };
  }
}

async function uploadResize(files) {
  await page.setInputFiles('#resize-file', files);
  await page.waitForFunction(
    () => document.body.innerText.includes('Expected result:') || document.body.innerText.includes('cannot be decoded'),
    { timeout: 15000 },
  );
}

async function resizeAndDownload() {
  await page.locator('#resize-button').click();
  await page.waitForSelector('text=Resized:', { timeout: 60000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#resize-download').click(),
  ]);
  const p = path.join(DL, dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}

// --- 1. load + Resize tab ---
await page.goto(BASE, { waitUntil: 'networkidle' });
check('page loads, title OpenPixel', (await page.title()).includes('OpenPixel'), await page.title());
await page.locator('#tab-resize').click();
await page.waitForSelector('#panel-resize', { timeout: 10000 });
check('Resize tab renders', (await page.locator('#resize-heading').innerText()) === 'Resize & compress');
await shot('17-resize-tab.png');

// --- 2. upload photo.jpg (1024x768), check targets + aspect lock ---
await uploadResize(path.join(IN, 'photo.jpg'));
const targetOpts = await page.evaluate(() =>
  [...document.querySelectorAll('#resize-target-format option')].map((o) => o.value),
);
check('resize targets are the 16 browser targets, no AVIF', targetOpts.length === 16 && !targetOpts.includes('avif'), targetOpts.join(', '));
await page.fill('#resize-width', '512');
const heightAfterLock = await page.inputValue('#resize-height');
check('aspect lock: width 512 -> height 384 (1024x768)', heightAfterLock === '384', `height=${heightAfterLock}`);
const expected = await page.locator('#resize-expected').innerText();
check('expected result shows 512x384', expected.includes('512 × 384'), expected);

// --- 3. ResizeFit 800x600 -> genuine JPEG at exact dimensions ---
await page.fill('#resize-width', '800');
check('aspect lock: width 800 -> height 600', (await page.inputValue('#resize-height')) === '600');
const fitPath = await resizeAndDownload();
const fitInfo = verify(fitPath, 'jpeg', '800x600');
check('photo ResizeFit 800x600 is a real JPEG 800x600', fitInfo.ok, fitInfo.detail);
const resizedLine = await page.locator('text=Resized:').first().innerText();
check('result line shows the real size change', /% (smaller|larger)|same size/.test(resizedLine), resizedLine);
const engineNote = await page.locator('text=WASM engine (Lanczos3)').count();
check('WASM engine (Lanczos3) note shown', engineNote > 0);
await shot('18-resize-done.png');

// --- 4. target size 50 KB JPEG ---
await page.locator('button', { hasText: 'Resize again with different settings' }).click();
await page.fill('#resize-target-size', '50 KB');
const qualityNote = await page.locator('text=Disabled — the target-size search picks the quality.').count();
check('quality slider disabled with note when target size is set', qualityNote > 0);
const sizedPath = await resizeAndDownload();
const sizedSize = fs.statSync(sizedPath).size;
const sizedInfo = verify(sizedPath, 'jpeg', '800x600');
check('target-size 50 KB JPEG fits (<= 51200 bytes)', sizedSize <= 51200 && sizedInfo.ok, `${sizedInfo.detail}`);
const metLine = await page.locator('text=target size met').count();
check('target size met is reported', metLine > 0);
await shot('19-resize-target-size.png');

// --- 5. never-upscale guard: 256x192 source asked for 800x600 stays 256x192 ---
await page.locator('button', { hasText: 'Choose different files' }).click();
await uploadResize(path.join(IN, 'rgba.png'));
await page.fill('#resize-width', '800');
const smallExpected = await page.locator('#resize-expected').innerText();
check('never-upscale clamps: expected stays 256x192', smallExpected.includes('256 × 192'), smallExpected);
const smallPath = await resizeAndDownload();
const smallInfo = verify(smallPath, 'jpeg', '256x192');
check('small source is not upscaled (256x192 JPEG)', smallInfo.ok, smallInfo.detail);

// --- 6. batch: two files, same settings, zip download ---
await page.locator('button', { hasText: 'Choose different files' }).click();
await uploadResize([path.join(IN, 'rgba.png'), path.join(IN, 'photo.jpg')]);
await page.locator('#resize-button').click();
await page.waitForSelector('#resize-download-all', { timeout: 60000 });
const doneChips = await page.locator('text=done').count();
check('batch: both files done', doneChips >= 2, `done chips=${doneChips}`);
const [zipDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('#resize-download-all').click(),
]);
const zipPath = path.join(DL, zipDl.suggestedFilename());
await zipDl.saveAs(zipPath);
const zipList = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
const zipEntries = (zipList.match(/\.jpg/g) || []).length;
check('batch zip contains 2 JPEGs', zipPath.endsWith('.zip') && zipEntries >= 2, zipList.split('\n').slice(3, 6).join(' | '));
await shot('20-resize-batch.png');

console.log('\n--- failed requests/console errors ---');
console.log(failedReqs.length ? failedReqs.join('\n') : '(none)');
const fails = results.filter((r) => !r.ok).length;
console.log(`\nRESIZE E2E: ${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
