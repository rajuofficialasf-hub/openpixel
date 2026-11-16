// WASM-absent fallback check — item 4. Serves a copy of dist/ with public/wasm removed.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:8322/';
const IN = '/tmp/op-e2e/cli/in';
const DL = '/tmp/op-e2e/web-dl';
const SHOT = '/home/hatch/workspace/openpixel-engine/apps/web/e2e/screenshots';
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 2000));
const intro = await page.locator('section').first().innerText();
check('no-WASM build: intro does NOT claim WASM targets', !intro.includes('WASM engine’s TIFF'), intro.slice(0, 160).replace(/\n/g, ' | '));
check('no-WASM build: intro mentions canvas-only fallback', /canvas|WASM engine’s extra formats when its module is built/i.test(intro), intro.slice(0, 200).replace(/\n/g, ' | '));
await page.screenshot({ path: path.join(SHOT, '10-nowasm-home.png') });

// canvas path still works: PNG -> JPEG
await page.setInputFiles('#convert-file', path.join(IN, 'rgba.png'));
await page.waitForFunction(() => document.body.innerText.includes('Detected format'), { timeout: 15000 });
await page.selectOption('#target-format', 'jpeg');
await page.locator('button', { hasText: /^Convert to / }).click();
await page.waitForSelector('text=Converted:', { timeout: 60000 });
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('button', { hasText: /^Download / }).click(),
]);
const p = path.join(DL, 'nowasm-' + dl.suggestedFilename());
await dl.saveAs(p);
const f = execFileSync('file', ['-b', p], { encoding: 'utf8' }).trim();
check('no-WASM build: PNG->JPEG still converts (canvas)', f.startsWith('JPEG image data'), `${path.basename(p)}: ${f}`);

// TIFF without WASM: honest "cannot decode" note, convert disabled
await page.locator('button', { hasText: 'Choose a different file' }).click();
await page.setInputFiles('#convert-file', path.join(IN, 'multi.tiff'));
// Wait for the probe to FINISH, not just for the panel to appear:
// "Detected format" renders while status is still 'probing' (as
// "Reading…"), so waiting only for that label races the probe and
// reads the page before the error/format land (flaky pre-fix).
await page.waitForFunction(() => document.body.innerText.includes('cannot decode this image'), { timeout: 15000 });
const bodyText = await page.locator('section').first().innerText();
check('no-WASM build: TIFF shows cannot-decode note', /cannot decode this image/i.test(bodyText), bodyText.slice(0, 300).replace(/\n/g, ' | '));
// Polish (16 Nov 2026): the sniffed format must still be shown and
// the alert must not claim a conversion failed — none was attempted.
check('no-WASM build: TIFF detected format shown, not "Unknown"', /Detected format\nTIFF/.test(bodyText), bodyText.slice(0, 300).replace(/\n/g, ' | '));
check('no-WASM build: no misleading "Conversion failed" label', !bodyText.includes('Conversion failed'), bodyText.slice(0, 300).replace(/\n/g, ' | '));
const convertDisabled = await page.locator('button', { hasText: /^Convert to / }).isDisabled();
check('no-WASM build: Convert button disabled for TIFF', convertDisabled);
await page.screenshot({ path: path.join(SHOT, '11-nowasm-tiff.png') });

// SVG without WASM (16 Nov 2026): the probe falls back to <img>
// dimensions and conversion falls back to the main-thread <img>
// draw — so SVG->JPEG works even with no WASM module. Regression
// for the live-site SVG failure: without this, the probe failed
// and the Convert button stayed disabled.
const svgPath = path.join(IN, 'simple.svg');
if (!fs.existsSync(svgPath)) {
  fs.writeFileSync(
    svgPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
  <rect width="400" height="200" fill="#0e7a5f"/>
  <text x="200" y="110" font-family="sans-serif" font-size="42" fill="#fff" text-anchor="middle">Hello SVG</text>
</svg>
`,
  );
}
await page.locator('button', { hasText: 'Choose a different file' }).click();
await page.setInputFiles('#convert-file', svgPath);
await page.waitForFunction(
  () => document.body.innerText.includes('Detected format') && !document.body.innerText.includes('Reading…'),
  { timeout: 15000 },
);
const svgDetected = await page.locator('dl').innerText();
check('no-WASM build: SVG detected as SVG', /SVG/.test(svgDetected), svgDetected.replace(/\n/g, ' | ').slice(0, 200));
await page.selectOption('#target-format', 'jpeg');
await page.locator('button', { hasText: /^Convert to / }).click();
await page.waitForSelector('text=Converted:', { timeout: 60000 });
const [dlSvg] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('button', { hasText: /^Download / }).click(),
]);
const pSvg = path.join(DL, 'nowasm-' + dlSvg.suggestedFilename());
await dlSvg.saveAs(pSvg);
const fSvg = execFileSync('file', ['-b', pSvg], { encoding: 'utf8' }).trim();
check('no-WASM build: SVG->JPEG converts via <img> fallback', fSvg.startsWith('JPEG image data'), `${path.basename(pSvg)}: ${fSvg}`);
await page.screenshot({ path: path.join(SHOT, '12-nowasm-svg.png') });

console.log('\npage/console errors:', errs.length ? errs.join('\n') : '(none)');
const fails = results.filter((r) => !r.ok).length;
console.log(`NO-WASM FALLBACK: ${results.length - fails}/${results.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
