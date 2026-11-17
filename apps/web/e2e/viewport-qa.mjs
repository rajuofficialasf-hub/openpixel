// Phase 6 viewport QA: no horizontal overflow at the prompt's
// viewport list (360x800, 768x1024, 1440x900) on Home, All Tools,
// Convert, PDF tab (3-panel) and Settings. Screenshots to
// apps/web/e2e/screenshots/ for the report.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.WEB_BASE || 'http://127.0.0.1:8321/';
const SHOT = '/home/hatch/workspace/openpixel-engine/apps/web/e2e/screenshots';
fs.mkdirSync(SHOT, { recursive: true });

const VIEWPORTS = [
  { width: 360, height: 800, name: '360x800' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 1440, height: 900, name: '1440x900' },
];
const ROUTES = [
  { tab: null, name: 'home' },
  { tab: '#tab-tools', name: 'tools' },
  { tab: '#tab-convert', name: 'convert' },
  { tab: '#tab-pdf', name: 'pdf' },
  { tab: '#tab-settings', name: 'settings' },
];

const browser = await chromium.launch({
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--no-sandbox'],
});
let fails = 0;
let total = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  for (const route of ROUTES) {
    total++;
    if (route.tab) {
      // Below the lg breakpoint the sidebar is a drawer — open it first.
      const hamburger = page.locator('button[aria-label="Open navigation menu"]');
      if (await hamburger.count()) {
        await hamburger.first().click();
        await new Promise((r) => setTimeout(r, 400));
      }
      await page.locator(route.tab).click();
    }
    await new Promise((r) => setTimeout(r, 700));
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const ok = overflow.scrollWidth <= overflow.innerWidth + 1;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${vp.name} ${route.name}: scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}${errs.length ? ` | console/page errors: ${errs.join('; ')}` : ''}`);
    await page.screenshot({ path: path.join(SHOT, `p6-${vp.name}-${route.name}.png`) });
  }
  await ctx.close();
}
// --- PDF viewport-fit contract (user report, 17 Nov 2026): the PDF
// page must fit the viewport on desktop — no page-level vertical
// scroll — with each of the three columns scrolling internally.
// Empty state and loaded state, at 1366x768 and 1440x900, plus a
// 200-page PDF at 1440x900 (12 thumbnails + 188 numbered buttons
// in the rail, 200 options in the page selector).
const FIT_VIEWPORTS = [
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1440, height: 900, name: '1440x900' },
];
const PDF_IN = '/tmp/op-e2e/pdf-in/doc4.pdf';
const BIG_PDF = '/tmp/op-e2e/pdf-in/big200.pdf';
async function fitCheck(page, vp, label) {
  const m = await page.evaluate(() => {
    const panel = (id) => {
      const el = document.querySelector(id);
      return el ? { sh: el.scrollHeight, ch: el.clientHeight } : null;
    };
    return {
      docScroll: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      ops: panel('#pdf-ops-panel'),
      center: panel('#pdf-center-panel'),
      thumbs: panel('#pdf-thumbs-panel'),
      footer: Boolean(document.querySelector('footer')),
    };
  });
  const fits = m.docScroll <= m.innerH + 1;
  total++; if (!fits) fails++;
  console.log(`${fits ? 'PASS' : 'FAIL'}  ${vp.name} pdf ${label}: docScrollHeight=${m.docScroll} innerHeight=${m.innerH}${m.footer ? ' | footer present (should be hidden in fit mode)' : ''}`);
  if (m.ops) {
    const scrollable = m.ops.sh > m.ops.ch;
    total++; if (!scrollable) fails++;
    console.log(`${scrollable ? 'PASS' : 'FAIL'}  ${vp.name} pdf ${label}: ops panel internally scrollable scrollHeight=${m.ops.sh} clientHeight=${m.ops.ch}`);
  }
  if (m.center) {
    const scrollable = m.center.sh > m.center.ch;
    total++; if (!scrollable) fails++;
    console.log(`${scrollable ? 'PASS' : 'FAIL'}  ${vp.name} pdf ${label}: center panel internally scrollable scrollHeight=${m.center.sh} clientHeight=${m.center.ch}`);
  }
  return m;
}
for (const vp of FIT_VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  // Deep link (needs the SPA server — plain http.server 404s it).
  await page.goto(`${BASE}pdf`, { waitUntil: 'networkidle' });
  await new Promise((r) => setTimeout(r, 700));
  await fitCheck(page, vp, 'empty');
  await page.setInputFiles('#pdf-file', PDF_IN);
  await page.waitForSelector('#pdf-page-count', { timeout: 30000 });
  await page.waitForSelector('#pdf-preview-dims', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await fitCheck(page, vp, 'loaded doc4');
  await page.screenshot({ path: path.join(SHOT, `p6-fit-${vp.name}-pdf.png`) });
  if (vp.width === 1440) {
    // 200-page stress: rail, selector and ops must all stay inside
    // the viewport.
    await page.getByRole('button', { name: 'Choose a different file' }).click();
    await page.waitForSelector('#pdf-file', { timeout: 10000 });
    await page.setInputFiles('#pdf-file', BIG_PDF);
    await page.waitForFunction(() => document.querySelector('#pdf-page-count')?.textContent.trim() === '200', null, { timeout: 60000 });
    await page.waitForSelector('#pdf-preview-dims', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
    const m = await fitCheck(page, vp, 'loaded big200');
    const thumbsScrollable = m.thumbs && m.thumbs.sh > m.thumbs.ch;
    total++; if (!thumbsScrollable) fails++;
    console.log(`${thumbsScrollable ? 'PASS' : 'FAIL'}  ${vp.name} pdf loaded big200: thumbs rail internally scrollable scrollHeight=${m.thumbs?.sh} clientHeight=${m.thumbs?.ch}`);
    await page.screenshot({ path: path.join(SHOT, `p6-fit-${vp.name}-pdf-200p.png`) });
  }
  if (errs.length) {
    total++; fails++;
    console.log(`FAIL  ${vp.name} pdf fit: console/page errors: ${errs.join('; ')}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\nVIEWPORT QA: ${total - fails}/${total} passed`);
process.exit(fails ? 1 : 0);
