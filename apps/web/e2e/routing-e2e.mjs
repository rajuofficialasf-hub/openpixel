// URL routing e2e: every page has its own shareable link and the
// browser back/forward buttons work.
//
// The script starts its own SPA-fallback server on :8325 via the
// shared spa-server.mjs (unknown paths serve index.html — the same
// rule public/_redirects gives Cloudflare Pages). python3
// -m http.server cannot serve deep links, so it is not enough here.
// No fixtures needed: routing is checked by page markers, not by
// conversions.
import { chromium } from 'playwright-core';
import { startSpaServer } from './spa-server.mjs';

const DIST = '/home/hatch/workspace/openpixel-engine/apps/web/dist';
const PORT = 8325;
const BASE = `http://127.0.0.1:${PORT}`;

const server = await startSpaServer({ dist: DIST, port: PORT });

const browser = await chromium.launch({
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
let fails = 0;
let total = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = () => page.evaluate(() => document.body.innerText);
const check = (name, ok, extra = '') => {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

try {
  // 1. Deep link /pdf loads the PDF picker directly.
  await page.goto(`${BASE}/pdf`, { waitUntil: 'networkidle' });
  await sleep(500);
  check(
    'deep link /pdf loads PDF picker',
    page.url() === `${BASE}/pdf` && (await page.locator('#pdf-heading').count()) > 0,
    `url=${page.url()}`,
  );

  // 1b. Deep link /pdf/merge loads the Merge tool page directly.
  await page.goto(`${BASE}/pdf/merge`, { waitUntil: 'networkidle' });
  await sleep(500);
  check(
    'deep link /pdf/merge loads Merge PDF page',
    page.url() === `${BASE}/pdf/merge` && (await bodyText()).includes('Merge PDF'),
    `url=${page.url()}`,
  );

  // 1c. Deep link /pdf/compress loads the Compress tool page directly.
  await page.goto(`${BASE}/pdf/compress`, { waitUntil: 'networkidle' });
  await sleep(500);
  check(
    'deep link /pdf/compress loads Compress PDF page',
    page.url() === `${BASE}/pdf/compress` && (await bodyText()).includes('Compress PDF'),
    `url=${page.url()}`,
  );

  // 1d. Unknown /pdf/* falls back to the /pdf picker, not home.
  // Same `page.url()` caveat as §6 below: the correction is a
  // load-time replaceState, so assert on `location.pathname`.
  await page.goto(`${BASE}/pdf/nope`, { waitUntil: 'networkidle' });
  await sleep(500);
  const pdfNopePath = await page.evaluate(() => window.location.pathname);
  check(
    'unknown /pdf/nope lands on PDF picker',
    pdfNopePath === '/pdf' && (await page.locator('#pdf-heading').count()) > 0,
    `pathname=${pdfNopePath} url=${page.url()}`,
  );

  // 2. Deep link /convert loads Convert.
  await page.goto(`${BASE}/convert`, { waitUntil: 'networkidle' });
  await sleep(500);
  check(
    'deep link /convert loads Convert page',
    page.url() === `${BASE}/convert` && (await bodyText()).includes('Convert one image'),
    `url=${page.url()}`,
  );

  // 3. Sidebar navigation pushes the URL; back returns; forward returns.
  await page.locator('#tab-pdf').click();
  await sleep(500);
  check(
    'sidebar PDF click pushes /pdf',
    page.url() === `${BASE}/pdf` && (await page.locator('#pdf-heading').count()) > 0,
    `url=${page.url()}`,
  );
  await page.goBack();
  await sleep(500);
  check(
    'browser back returns to Convert',
    page.url() === `${BASE}/convert` && (await bodyText()).includes('Convert one image'),
    `url=${page.url()}`,
  );
  await page.goForward();
  await sleep(500);
  check(
    'browser forward returns to PDF',
    page.url() === `${BASE}/pdf` && (await page.locator('#pdf-heading').count()) > 0,
    `url=${page.url()}`,
  );

  // 4. Refresh on /ocr stays on OCR.
  await page.goto(`${BASE}/ocr`, { waitUntil: 'networkidle' });
  await sleep(500);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(500);
  check(
    'refresh on /ocr stays on OCR',
    page.url() === `${BASE}/ocr` && (await bodyText()).includes('Text recognition (OCR)'),
    `url=${page.url()}`,
  );

  // 5. Sidebar navigation to Settings pushes /settings.
  await page.locator('#tab-settings').click();
  await sleep(500);
  check(
    'sidebar Settings click pushes /settings',
    page.url() === `${BASE}/settings` && (await bodyText()).includes('3D background'),
    `url=${page.url()}`,
  );

  // 6. Unknown path lands on home and the address bar is corrected.
  // NOTE (18 Nov 2026): assert on `location.pathname`, not
  // `page.url()` — the app corrects the bar with
  // `history.replaceState` during the initial load, and
  // Playwright's `page.url()` does not pick that up (it still
  // reports /nope while `pathname` is already `/`). Verified
  // identical on the pre-change build (6085488): same stale
  // `page.url()`, same correct `/` pathname — not a regression.
  await page.goto(`${BASE}/nope`, { waitUntil: 'networkidle' });
  await sleep(500);
  const nopePath = await page.evaluate(() => window.location.pathname);
  check(
    'unknown /nope lands on home',
    nopePath === '/' && (await bodyText()).includes('File tools that never upload your files'),
    `pathname=${nopePath} url=${page.url()}`,
  );

  check('no console/page errors during routing', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(`\nROUTING E2E: ${total - fails}/${total} passed`);
process.exit(fails ? 1 : 0);
