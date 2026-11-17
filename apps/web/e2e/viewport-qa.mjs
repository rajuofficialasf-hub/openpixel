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
await browser.close();
console.log(`\nVIEWPORT QA: ${total - fails}/${total} passed`);
process.exit(fails ? 1 : 0);
