// OpenPixel web e2e — OCR tab. Real Chromium (cached ms-playwright
// build) driven by playwright-core. Serves the production build over
// plain HTTP. Usage: node apps/web/e2e/ocr-e2e.mjs (server must
// already run on 8324, serving apps/web/dist with the self-hosted
// tesseract.js worker + core in public/tesseract/ and the language
// data in public/tessdata/).
// Checks: OCR tab renders; nothing OCR-related is fetched before the
// user runs OCR (no worker/core/traineddata at page load or tab
// open); a real rendered-text PNG (the Rust crate's eng-clean.png
// fixture) recognises to the known words with a mean confidence
// shown; the recognised text downloads as a real .txt; Bengali
// (ben-clean.png) recognises with the ben language data; zero
// console/page errors; and NO request leaves the local origin —
// any CDN fetch fails the run.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WEB_BASE || 'http://127.0.0.1:8324/';
const ORIGIN = new URL(BASE).origin;
const FIX = '/home/hatch/workspace/openpixel-engine/crates/openpixel-ocr/tests/fixtures';
const DL = '/tmp/op-e2e/ocr-dl';
const SHOT = '/home/hatch/workspace/openpixel-engine/apps/web/e2e/screenshots';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';

fs.mkdirSync(DL, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const failedReqs = [];
const requests = [];
let ranOcr = false;
page.on('request', (r) => requests.push({ url: r.url(), beforeRun: !ranOcr }));
page.on('requestfailed', (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('pageerror', (e) => failedReqs.push(`pageerror: ${e.message}`));
// Tesseract logs "Estimating resolution as <dpi>" via console.error
// when an image carries no DPI metadata (both fixtures) — engine
// chatter, not an app error. Anything else in console.error fails.
page.on('console', (m) => {
  if (m.type() === 'error' && !/^Estimating resolution as \d+$/.test(m.text())) {
    failedReqs.push(`console.error: ${m.text()}`);
  }
});

async function shot(name) { await page.screenshot({ path: path.join(SHOT, name) }); }

async function runOcrAndWait() {
  ranOcr = true;
  await page.locator('#ocr-run-button').click();
  await page.waitForSelector('#ocr-result', { timeout: 180000 });
}

const ocrRequests = (beforeRun) =>
  requests.filter((r) => r.beforeRun === beforeRun && (/\/tesseract\//.test(r.url) || /\/tessdata\//.test(r.url)));

// --- 1. load + OCR tab ---
await page.goto(BASE, { waitUntil: 'networkidle' });
check('page loads, title OpenPixel', (await page.title()).includes('OpenPixel'), await page.title());
await page.locator('#tab-ocr').click();
await page.waitForSelector('#panel-ocr', { timeout: 10000 });
check('OCR tab renders', (await page.locator('#ocr-heading').innerText()) === 'Text recognition (OCR)');
check(
  'honest capability note names tesseract.js and the native CLI',
  (await page.locator('#panel-ocr').innerText()).includes('tesseract.js') &&
    (await page.locator('#panel-ocr').innerText()).includes('openpixel ocr'),
);
await shot('24-ocr-tab.png');

// --- 2. upload eng-clean.png — nothing OCR-related fetched yet ---
await page.setInputFiles('#ocr-file', path.join(FIX, 'eng-clean.png'));
await page.waitForSelector('#ocr-preview', { timeout: 10000 });
check(
  'no worker/core/traineddata fetched before Run OCR (on-demand loading)',
  ocrRequests(true).length === 0,
  ocrRequests(true).map((r) => r.url).join(', ') || '(none)',
);

// --- 3. run OCR (English, default) on the known fixture ---
await runOcrAndWait();
const engText = await page.locator('#ocr-text').innerText();
const engStats = await page.locator('#ocr-stats').innerText();
check(
  'English fixture recognises the known words',
  /quick/i.test(engText) && /brown/i.test(engText) && /fox/i.test(engText),
  engText.replace(/\n/g, ' | ').slice(0, 200),
);
check(
  'result shows mean confidence, word count, duration and the browser engine label',
  engStats.includes('Mean confidence:') && engStats.includes('%') &&
    engStats.includes('words') && engStats.includes('tesseract.js (browser)'),
  engStats,
);
const confMatch = engStats.match(/Mean confidence:\s*([\d.]+)%/);
check(
  'mean confidence parses as a number in 0–100',
  confMatch !== null && Number(confMatch[1]) >= 0 && Number(confMatch[1]) <= 100,
  engStats,
);
await page.locator('#ocr-result').scrollIntoViewIfNeeded();
await shot('25-ocr-result.png');

// --- 4. download the recognised text ---
const [txtDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('#ocr-download-button').click(),
]);
const txtPath = path.join(DL, txtDl.suggestedFilename());
await txtDl.saveAs(txtPath);
const txtContent = fs.readFileSync(txtPath, 'utf8');
check(
  'Download .txt contains the recognised text',
  txtDl.suggestedFilename().endsWith('-ocr.txt') && /quick/i.test(txtContent),
  `${txtDl.suggestedFilename()} (${txtContent.length} chars)`,
);

// --- 5. Bengali: same tab, switch language, ben-clean.png ---
await page.locator('button', { hasText: 'Choose a different image' }).click();
await page.setInputFiles('#ocr-file', path.join(FIX, 'ben-clean.png'));
await page.waitForSelector('#ocr-preview', { timeout: 10000 });
await page.locator('#ocr-language').selectOption('ben');
await runOcrAndWait();
const benText = await page.locator('#ocr-text').innerText();
const benStats = await page.locator('#ocr-stats').innerText();
check(
  'Bengali fixture recognises the known Bengali words',
  benText.includes('ঢাকায়') && benText.includes('আমি'),
  benText.replace(/\n/g, ' | ').slice(0, 200),
);
check('Bengali result labels the language Bengali', benStats.includes('Bengali'), benStats);

// --- 6. dark mode screenshot ---
await page.locator('button[aria-label="Switch to dark theme"]').click();
await page.waitForFunction(() => document.documentElement.classList.contains('dark'), null, { timeout: 10000 });
check('dark mode toggles on the OCR tab', await page.evaluate(() => document.documentElement.classList.contains('dark')));
await page.locator('#ocr-result').scrollIntoViewIfNeeded();
await shot('26-ocr-dark.png');

// --- 7. no request left the local origin (no CDN fetch) ---
const external = requests.filter(
  (r) => !r.url.startsWith(ORIGIN) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'),
);
check(
  'no request leaves the local origin (no CDN fetch)',
  external.length === 0,
  external.map((r) => r.url).join(', ') || `(${requests.length} requests, all local)`,
);
check(
  'OCR files were fetched from this site (worker + core + traineddata)',
  requests.some((r) => r.url.includes('/tesseract/worker.min.js')) &&
    requests.some((r) => r.url.includes('/tesseract/tesseract-core-lstm.wasm.js')) &&
    requests.some((r) => r.url.includes('/tessdata/eng.traineddata')) &&
    requests.some((r) => r.url.includes('/tessdata/ben.traineddata')),
  ocrRequests(false).map((r) => path.basename(r.url)).join(', '),
);

console.log('\n--- failed requests/console errors ---');
console.log(failedReqs.length ? failedReqs.join('\n') : '(none)');
check('zero console errors / page errors / failed requests', failedReqs.length === 0, failedReqs.join('; ') || '(none)');
const fails = results.filter((r) => !r.ok).length;
console.log(`\nOCR E2E: ${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
