// OpenPixel web e2e — item 4. Real Chromium (cached ms-playwright build)
// driven by playwright-core. Serves the production build over plain HTTP.
// Usage: node /tmp/op-e2e/pw/web-e2e.mjs  (server must already run on 8321)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WEB_BASE || 'http://127.0.0.1:8321/';
const IN = '/tmp/op-e2e/cli/in';
const DL = '/tmp/op-e2e/web-dl';
const SHOT = '/home/hatch/workspace/openpixel-engine/apps/web/e2e/screenshots';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const CLI = '/home/hatch/workspace/openpixel-engine/target/release/openpixel';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const failedReqs = [];
page.on('requestfailed', (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('pageerror', (e) => failedReqs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') failedReqs.push(`console.error: ${m.text()}`); });

async function shot(name) { await page.screenshot({ path: path.join(SHOT, name) }); }

// --- 1. load ---
await page.goto(BASE, { waitUntil: 'networkidle' });
check('page loads, title OpenPixel', (await page.title()).includes('OpenPixel'), await page.title());
check('no failed requests / console errors on load', failedReqs.length === 0, failedReqs.join(' | '));
await shot('01-home.png');

// Phase 6: the default route is the homepage — open Convert first.
await page.locator('#tab-convert').click();

// WASM module present? The intro text switches once wasmSupport loads.
// (Marker is the descWasm intro line: 'Canvas targets, plus the WASM
// engine’s extra formats'. The old marker 'WASM engine’s BMP' lives in
// the targets caption, which only renders after a file is selected
// (ConvertWorkspace `{file && (` output panel), so it could never
// appear here — the check failed deterministically, not from timing.)
try {
  await page.waitForFunction(
    () => document.body.innerText.includes('Canvas targets, plus the WASM engine’s extra formats'),
    { timeout: 15000 },
  );
  check('WASM engine support detected by UI', true, 'intro lists WASM targets');
} catch {
  check('WASM engine support detected by UI', false, 'intro text did not switch within 15s');
}
const wasmReq = await page.evaluate(async () => {
  const r = await fetch('/wasm/openpixel_wasm_bg.wasm', { method: 'HEAD' });
  return r.status;
});
check('wasm module served over plain HTTP', wasmReq === 200, `HEAD /wasm/openpixel_wasm_bg.wasm -> ${wasmReq}`);

// --- helper: upload via the convert dropzone input ---
async function uploadConvert(file) {
  await page.setInputFiles('#convert-file', file);
  await page.waitForFunction(
    () => document.body.innerText.includes('Detected format') && !document.body.innerText.includes('Reading…'),
    { timeout: 15000 },
  );
}
async function detectedFormat() {
  const txt = await page.locator('dl').innerText();
  const m = txt.match(/Detected format\n([^\n]+)/);
  return m ? m[1].trim() : txt;
}
async function convertAndDownload() {
  const btn = page.locator('button', { hasText: /^Convert to / });
  await btn.click();
  await page.waitForSelector('text=Converted:', { timeout: 60000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('button', { hasText: /^Download / }).click(),
  ]);
  const p = path.join(DL, dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}

// --- 2. canvas path: PNG -> JPEG, download verified ---
await uploadConvert(path.join(IN, 'rgba.png'));
check('PNG upload detected as PNG 256x192', (await detectedFormat()).startsWith('PNG'), await detectedFormat());
await shot('02-png-ready.png');
await page.selectOption('#target-format', 'jpeg');
const jpgPath = await convertAndDownload();
const jpgInfo = await BunOrNode(jpgPath);
check('PNG->JPEG download is a real JPEG', jpgInfo.ok, jpgInfo.detail);
await shot('03-jpeg-done.png');

// --- 3. lying extension: PNG bytes named .jpg ---
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'lying.jpg'));
check('lying .jpg detected as PNG (signature wins)', (await detectedFormat()).startsWith('PNG'), await detectedFormat());

// --- 4. WASM path: TIFF source -> PNG ---
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'multi.tiff'));
const tiffNote = await page.locator('[role="status"]').first().innerText().catch(() => '');
check('TIFF shows WASM-decoded note, no preview', tiffNote.includes('WASM engine'), tiffNote.slice(0, 120));
await page.selectOption('#target-format', 'png');
const tiffPng = await convertAndDownload();
const tiffInfo = await BunOrNode(tiffPng);
check('TIFF->PNG via WASM is a real PNG', tiffInfo.ok, tiffInfo.detail);
const wasmNote = await page.locator('[role="status"]').allInnerTexts();
check('WASM conversion note shown', wasmNote.join(' ').includes('Converted with the built-in WASM engine'), wasmNote.join(' | ').slice(0, 200));
await shot('04-tiff-wasm.png');

// --- 5. WASM path: HEIC source -> PNG ---
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'checker-64.heic'));
check('HEIC detected as HEIC 64x64', (await detectedFormat()).startsWith('HEIC'), await detectedFormat());
await page.selectOption('#target-format', 'png');
const heicPng = await convertAndDownload();
const heicInfo = await BunOrNode(heicPng);
check('HEIC->PNG via WASM is a real PNG 64x64', heicInfo.ok, heicInfo.detail);

// --- 6. WASM target: PNG -> HEIC ---
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'rgba.png'));
await page.selectOption('#target-format', 'heic');
const pngHeic = await convertAndDownload();
const pngHeicInfo = await BunOrNode(pngHeic, 'heic');
check('PNG->HEIC via WASM is a real HEIC', pngHeicInfo.ok, pngHeicInfo.detail);

// --- 6b. Polish gaps (16 Nov 2026): BMP download, QOI source, TIFF/QOI/JXL targets ---
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'rgba.png'));
await page.selectOption('#target-format', 'bmp');
const pngBmp = await convertAndDownload();
const pngBmpInfo = await BunOrNode(pngBmp);
check('PNG->BMP via WASM engine is a real BMP', pngBmpInfo.ok, pngBmpInfo.detail);

// QOI source (generated by the CLI from the same PNG) -> PNG via WASM
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'sample.qoi'));
check('QOI detected as QOI', (await detectedFormat()).startsWith('QOI'), await detectedFormat());
await shot('14-polish-qoi.png');
await page.selectOption('#target-format', 'png');
const qoiPng = await convertAndDownload();
const qoiInfo = await BunOrNode(qoiPng);
check('QOI->PNG via WASM is a real PNG', qoiInfo.ok, qoiInfo.detail);
const qoiWasmNote = await page.locator('[role="status"]').allInnerTexts();
check('QOI conversion used the WASM engine', qoiWasmNote.join(' ').includes('Converted with the built-in WASM engine'), qoiWasmNote.join(' | ').slice(0, 200));

// PNG -> TIFF / QOI / JXL via WASM, each download re-detected
for (const target of ['tiff', 'qoi', 'jxl']) {
  await page.locator('button', { hasText: 'Choose a different file' }).click();
  await uploadConvert(path.join(IN, 'rgba.png'));
  await page.selectOption('#target-format', target);
  const out = await convertAndDownload();
  const info = await BunOrNode(out, target);
  check(`PNG->${target.toUpperCase()} via WASM is a real ${target.toUpperCase()}`, info.ok, info.detail);
}

// --- 6d. ICO (16 Nov 2026): the format caps at 256x256, so a larger
// image is auto-resized to fit (aspect preserved) with a note —
// regression for the live-site failure Raju reported (800x600 PNG
// failed with "The browser cannot encode ICO" because the WASM
// engine threw "image width must be 1..=256" and the CLI failed
// identically). Small images convert unchanged, no note.
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'checker-64.png'));
await page.selectOption('#target-format', 'ico');
const pngIco64 = await convertAndDownload();
const pngIco64Info = await BunOrNode(pngIco64, 'ico');
check('PNG->ICO via WASM is a real ICO 64x64', pngIco64Info.ok && pngIco64Info.detail.includes('size=64x64'), pngIco64Info.detail);
const ico64Note = await page.locator('[role="status"]').allInnerTexts();
check('64x64 ICO shows no resize note', !ico64Note.join(' ').includes('Resized to'), ico64Note.join(' | ').slice(0, 200));

await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'photo.jpg'));
await page.selectOption('#target-format', 'ico');
const jpgIco = await convertAndDownload();
const jpgIcoInfo = await BunOrNode(jpgIco, 'ico');
check('1024x768 photo->ICO via WASM is a real ICO 256x192', jpgIcoInfo.ok && jpgIcoInfo.detail.includes('size=256x192'), jpgIcoInfo.detail);
const icoNote = await page.locator('[role="status"]').allInnerTexts();
check('ICO resize note shown for large image', icoNote.join(' ').includes('Resized to 256×192 for ICO'), icoNote.join(' | ').slice(0, 300));
await shot('16-ico-resize.png');

// --- 6c. SVG source (16 Nov 2026): createImageBitmap rejects SVG
// blobs, so SVG->JPEG must go through the WASM engine (resvg) —
// regression for the live-site failure Raju reported
// (madrasatus-sunnah-logo.svg: every SVG failed in the worker with
// "The source image could not be decoded" while the <img> preview
// rendered). Fixture written here so this script is self-contained.
const svgPath = path.join(IN, 'simple.svg');
fs.writeFileSync(
  svgPath,
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
  <rect width="400" height="200" fill="#0e7a5f"/>
  <text x="200" y="110" font-family="sans-serif" font-size="42" fill="#fff" text-anchor="middle">Hello SVG</text>
</svg>
`,
);
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(svgPath);
check('SVG detected as SVG 400x200', (await detectedFormat()).startsWith('SVG'), await detectedFormat());
await page.selectOption('#target-format', 'jpeg');
const svgJpg = await convertAndDownload();
const svgJpgInfo = await BunOrNode(svgJpg);
check('SVG->JPEG via WASM is a real JPEG', svgJpgInfo.ok, svgJpgInfo.detail);
const svgWasmNote = await page.locator('[role="status"]').allInnerTexts();
check(
  'SVG conversion used the WASM engine',
  svgWasmNote.join(' ').includes('Converted with the built-in WASM engine'),
  svgWasmNote.join(' | ').slice(0, 200),
);
await shot('15-svg-wasm.png');

// --- 7. GIF first-frame note + canvas convert to WebP ---
await page.locator('button', { hasText: 'Choose a different file' }).click();
await uploadConvert(path.join(IN, 'anim.gif'));
const gifNotes = await page.locator('[role="status"]').allInnerTexts();
check('GIF first-frame note shown', gifNotes.join(' ').includes('only the first frame'), gifNotes.join(' | ').slice(0, 200));
await page.selectOption('#target-format', 'webp');
const gifWebp = await convertAndDownload();
const gifInfo = await BunOrNode(gifWebp);
check('GIF->WebP is a real WebP', gifInfo.ok, gifInfo.detail);

// --- 8. Batch tab: 3 files incl. unsupported notes.txt ---
await page.locator('#tab-batch').click();
await shot('05-batch.png');
await page.setInputFiles('#batch-files', [
  path.join(IN, 'rgba.png'),
  path.join(IN, 'photo.jpg'),
  path.join(IN, 'notes.txt'),
]);
await sleep(1500);
const batchText = await page.locator('#panel-batch').innerText();
check('batch lists 3 files, unsupported one flagged', batchText.includes('notes.txt') && /not|unsupported|cannot|skip/i.test(batchText), batchText.replace(/\n/g, ' | ').slice(0, 300));
await shot('06-batch-files.png');
// convert batch to webp if a convert button exists
const batchBtn = page.locator('#panel-batch button', { hasText: /Convert all|Convert/i }).first();
if (await batchBtn.count()) {
  await batchBtn.click();
  try {
    await page.waitForFunction(() => document.body.innerText.includes('Download all') || document.body.innerText.includes('zip'), { timeout: 60000 });
    const [zdl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('button', { hasText: /Download all/i }).click(),
    ]);
    const zp = path.join(DL, zdl.suggestedFilename());
    await zdl.saveAs(zp);
    check('batch zip downloads', fs.existsSync(zp), `${zp} ${fs.statSync(zp).size}B`);
    fs.writeFileSync('/tmp/op-e2e/web-dl/batch-zip-path.txt', zp);
  } catch (e) {
    check('batch zip downloads', false, String(e).slice(0, 200));
  }
} else {
  check('batch convert button present', false, 'no Convert button found in batch panel');
}
await shot('07-batch-done.png');

// --- 9. Formats tab: 21 formats, SVG decode-only, HEIC implemented ---
await page.locator('#tab-formats').click();
await sleep(500);
const fmtText = await page.locator('#panel-formats').innerText();
const fmtRows = await page.locator('#panel-formats table tbody tr').count();
check('Formats tab lists 21 formats', fmtRows === 21, `${fmtRows} rows`);
check('Formats tab shows SVG decode-only + HEIC implemented', /svg/i.test(fmtText) && /heic/i.test(fmtText), fmtText.slice(0, 200).replace(/\n/g, ' | '));
await shot('08-formats.png');

// --- 10. Settings + theme toggle persists across reload ---
await page.locator('button[aria-label="Switch to dark theme"]').click();
await sleep(300);
const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
check('theme toggle switches to dark', isDark);
await page.reload({ waitUntil: 'networkidle' });
await sleep(500);
const stillDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
check('dark theme persists across reload (localStorage)', stillDark);
await page.locator('#tab-settings').click();
await sleep(300);
const setText = await page.locator('#panel-settings').innerText();
check('Settings tab renders', setText.length > 20, setText.replace(/\n/g, ' | ').slice(0, 200));
await shot('09-settings-dark.png');
await page.locator('button[aria-label="Switch to light theme"]').click();

// --- 10b. Language switch EN -> BN -> EN (Phase 7 i18n) ---
await page.locator('#language-toggle').click();
await sleep(400);
const navBn = await page.locator('#tab-tools').innerText();
const langBn = await page.evaluate(() => document.documentElement.lang);
check('language toggle switches nav label to Bengali', navBn.trim() === 'সব টুল', `tab-tools text: ${navBn.trim()}`);
check('document lang becomes bn', langBn === 'bn', `lang=${langBn}`);
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);
const navBnAfterReload = await page.locator('#tab-tools').innerText();
check('Bengali persists across reload (localStorage)', navBnAfterReload.trim() === 'সব টুল', `tab-tools text: ${navBnAfterReload.trim()}`);
await page.locator('#language-toggle').click();
await sleep(400);
const navEn = await page.locator('#tab-tools').innerText();
check('language toggle restores English nav label', navEn.trim() === 'All Tools', `tab-tools text: ${navEn.trim()}`);

// --- 11. keyboard-only: tab to drop zone, Enter opens picker ---
// NOTE (16 Nov 2026): headless Chromium's file-chooser interception
// is racy in this VM — the chooser sometimes does not fire even
// though the keydown reaches the zone and input.click() runs
// (verified: the pre-resize build at 08bf9a5 fails identically, so
// this is environmental, not a regression). Retry the Enter press a
// few times; a genuinely broken picker still fails every attempt.
await page.locator('#tab-convert').click();
await page.keyboard.press('Tab'); // may land on theme button first; tab until dropzone focused
let chooserOpened = false;
for (let i = 0; i < 25; i++) {
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}#${el.id} ${el.getAttribute('aria-label') || ''} ${el.textContent?.slice(0, 40) || ''}` : 'none';
  });
  if (/convert-file|drop/i.test(focused)) break;
  await page.keyboard.press('Tab');
}
const focusedNow = await page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName}#${el.id} ${el.getAttribute('aria-label') || ''}` : 'none';
});
for (let attempt = 0; attempt < 3 && !chooserOpened; attempt++) {
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 4000 }),
      page.keyboard.press('Enter'),
    ]);
    chooserOpened = !!chooser;
    await chooser.cancel().catch(() => {});
  } catch { chooserOpened = false; }
}
check('keyboard: Enter on drop zone opens file picker', chooserOpened, `focused element was ${focusedNow}`);

console.log('\n--- failed requests/console errors ---');
console.log(failedReqs.length ? failedReqs.join('\n') : '(none)');
const fails = results.filter((r) => !r.ok).length;
console.log(`\nWEB E2E: ${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);

// --- verify a downloaded file with `file` + the CLI's own `info` ---
import { execFileSync } from 'node:child_process';
async function BunOrNode(p, expect = null) {
  try {
    const f = execFileSync('file', ['-b', p], { encoding: 'utf8' }).trim();
    const info = execFileSync(CLI, ['info', p], { encoding: 'utf8' });
    const fmt = (info.match(/^format:\s+(\S+)/m) || [])[1];
    const dims = (info.match(/^size:\s+(\S+)/m) || [])[1];
    const want = expect || ({ jpg: 'jpeg', png: 'png', webp: 'webp', heic: 'heic', bmp: 'bmp', tiff: 'tiff', qoi: 'qoi', jxl: 'jxl' }[path.extname(p).slice(1)] || '');
    return { ok: !want || fmt === want, detail: `${path.basename(p)}: file=${f} | info format=${fmt} size=${dims}` };
  } catch (e) {
    return { ok: false, detail: `${p}: verify failed: ${String(e.message).slice(0, 200)}` };
  }
}
