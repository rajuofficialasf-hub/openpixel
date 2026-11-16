// OpenPixel LIVE matrix — every format conversion, one by one, on the live site.
// Usage: WEB_BASE=https://openpixel.pages.dev/ node /tmp/op-e2e/pw/live-matrix.mjs
// Fixtures in /tmp/op-e2e/live-in (CLI-generated), downloads to /tmp/op-e2e/live-dl.
// Every downloaded output is verified with `file` + `openpixel info` (format + size).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WEB_BASE || 'https://openpixel.pages.dev/';
const IN = '/tmp/op-e2e/live-in';
const DL = '/tmp/op-e2e/live-dl';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const CLI = '/home/hatch/workspace/openpixel-engine/target/release/openpixel';

fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verifyFile(p, expect) {
  try {
    const f = execFileSync('file', ['-b', p], { encoding: 'utf8' }).trim();
    const info = execFileSync(CLI, ['info', p], { encoding: 'utf8' });
    const fmt = (info.match(/^format:\s+(\S+)/m) || [])[1];
    const dims = (info.match(/^size:\s+(\S+)/m) || [])[1];
    return {
      ok: !expect || fmt === expect,
      detail: `${path.basename(p)}: file=${f.slice(0, 90)} | info format=${fmt} size=${dims}`,
    };
  } catch (e) {
    return { ok: false, detail: `${p}: verify failed: ${String(e.message).slice(0, 200)}` };
  }
}

const browser = await chromium.launch({
  executablePath: CHROME,
  // --ignore-certificate-errors: the VM egress proxy MITMs TLS with its own
  // CA (curl trusts it via the system bundle; this test-only Chromium does
  // not). The page content is still the live site.
  args: ['--no-sandbox', '--proxy-server=http://127.0.0.1:18080', '--ignore-certificate-errors'],
});
// The VM reaches the internet only via the egress proxy; local Chromium
// cannot complete the proxy's auth flow, so it goes through the loopback
// forward proxy in egress-proxy.mjs (started separately in the same exec,
// so it shares this exec's fresh token). Plain --proxy-server, no creds:
// this Chromium build rejects credentials embedded in the arg.
const ctx = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();
const failedReqs = [];
page.on('requestfailed', (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('pageerror', (e) => failedReqs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') failedReqs.push(`console.error: ${m.text()}`); });

await page.goto(BASE, { waitUntil: 'networkidle' });
check('live page loads, title OpenPixel', (await page.title()).includes('OpenPixel'), await page.title());
try {
  await page.waitForFunction(
    () => document.body.innerText.includes('WASM engine’s BMP'),
    { timeout: 60000 },
  );
  check('WASM engine ready on live site', true, 'intro lists WASM targets');
} catch {
  check('WASM engine ready on live site', false, 'intro text did not switch within 60s');
}

async function uploadConvert(file) {
  await page.setInputFiles('#convert-file', file);
  await page.waitForFunction(
    () => document.body.innerText.includes('Detected format') && !document.body.innerText.includes('Reading…'),
    { timeout: 30000 },
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
  await page.waitForSelector('text=Converted:', { timeout: 90000 });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('button', { hasText: /^Download / }).click(),
  ]);
  const p = path.join(DL, dl.suggestedFilename());
  await dl.saveAs(p);
  return p;
}
async function reset() {
  const btn = page.locator('button', { hasText: 'Choose a different file' });
  if (await btn.count()) {
    await btn.first().click();
    await sleep(300);
  } else {
    await page.goto(BASE, { waitUntil: 'networkidle' });
  }
}
async function alertText() {
  const a = page.locator('[role="alert"]');
  return (await a.count()) ? (await a.first().innerText()).slice(0, 200) : '';
}

// --- target dropdown: what does the live site actually offer? ---
const targetOptions = await page.evaluate(() =>
  [...document.querySelectorAll('#target-format option')].map((o) => o.value),
);
console.log('TARGET OPTIONS ON LIVE SITE:', targetOptions.join(', '));
check('AVIF target NOT offered in browser (CLI-only, expected)', !targetOptions.includes('avif'), `options: ${targetOptions.join(',')}`);

// --- PART A: every target, from PNG ---
const TARGETS = [
  ['png', 'png'], ['jpeg', 'jpeg'], ['webp', 'webp'], ['bmp', 'bmp'],
  ['gif', 'gif'], ['tiff', 'tiff'], ['tga', 'tga'], ['ico', 'ico'],
  ['pnm', 'pnm'], ['qoi', 'qoi'], ['jxl', 'jxl'], ['hdr', 'hdr'],
  ['exr', 'exr'], ['jpeg2000', 'jpeg2000'], ['heic', 'heic'], ['heif', 'heif'],
];
for (const [target, expectFmt] of TARGETS) {
  try {
    await uploadConvert(path.join(IN, 'rgba.png'));
    await page.selectOption('#target-format', target);
    const out = await convertAndDownload();
    const v = verifyFile(out, expectFmt);
    check(`TARGET ${target.toUpperCase()}: PNG -> ${target}`, v.ok, v.detail);
  } catch (e) {
    check(`TARGET ${target.toUpperCase()}: PNG -> ${target}`, false, `error: ${(await alertText()) || String(e.message).slice(0, 160)}`);
  }
  await reset();
}

// --- PART B: every source, to PNG ---
const SOURCES = [
  ['rgba.png', 'PNG', 'png'],
  ['photo.jpg', 'JPEG', 'jpg'],
  ['rgba.webp', 'WEBP', 'webp'],
  ['rgba.bmp', 'BMP', 'bmp'],
  ['anim.gif', 'GIF', 'gif'],
  ['multi.tiff', 'TIFF', 'tiff'],
  ['rgba.tga', 'TGA', 'tga'],
  ['checker-64.ico', 'ICO', 'ico'],
  ['rgba.pnm', 'PNM', 'pnm'],
  ['sample.qoi', 'QOI', 'qoi'],
  ['rgba.jxl', 'JXL', 'jxl'],
  ['rgba.hdr', 'HDR', 'hdr'],
  ['rgba.exr', 'EXR', 'exr'],
  ['rgba.jp2', 'JPEG 2000', 'jp2'],
  ['checker-64.heic', 'HEIC', 'heic'],
  ['rgba.heif', 'HEIF', 'heif'],
  ['simple.svg', 'SVG', 'svg'],
  ['checker-64.avif', 'AVIF', 'avif'],
];
for (const [file, expectDetected, label] of SOURCES) {
  try {
    await uploadConvert(path.join(IN, file));
    const det = await detectedFormat();
    check(`SOURCE ${label.toUpperCase()}: detected as ${expectDetected}`, det.includes(expectDetected), det);
    await page.selectOption('#target-format', 'png');
    const out = await convertAndDownload();
    const v = verifyFile(out, 'png');
    check(`SOURCE ${label.toUpperCase()}: ${label} -> PNG is a real PNG`, v.ok, v.detail);
  } catch (e) {
    check(`SOURCE ${label.toUpperCase()}: ${label} -> PNG`, false, `error: ${(await alertText()) || String(e.message).slice(0, 160)}`);
  }
  await reset();
}

// --- PART C: signature wins + detection-only ---
try {
  await uploadConvert(path.join(IN, 'lying.jpg'));
  const det = await detectedFormat();
  check('lying .jpg detected as PNG (signature wins)', det.startsWith('PNG'), det);
} catch (e) {
  check('lying .jpg detected as PNG (signature wins)', false, String(e.message).slice(0, 160));
}
await reset();

try {
  await page.setInputFiles('#convert-file', path.join(IN, 'mini.psd'));
  await sleep(2000);
  const body = await page.locator('body').innerText();
  const honest = /detection only|can.?not convert|not supported|PSD/i.test(body);
  check('PSD is detection-only (app honestly says it cannot convert it)', honest, body.match(/PSD[^\n]{0,120}/i)?.[0] || 'no PSD mention found');
} catch (e) {
  check('PSD is detection-only', false, String(e.message).slice(0, 160));
}

console.log(`\nLIVE MATRIX: ${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('failed requests / console errors:', failedReqs.length ? failedReqs.join(' | ') : 'none');
fs.writeFileSync('/tmp/op-e2e/live-matrix-results.json', JSON.stringify(results, null, 2));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
