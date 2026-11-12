/* Screenshot a local HTML specimen with Chromium (the renderer users will see).
   Usage: node tools/typefoundry/shoot.js page.html out.png [width] [deviceScaleFactor]
   Prints any console messages (OTS font rejections show up there). Build-time only. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [src, out, width, dpr] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width || 1400), height: 800 }, deviceScaleFactor: Number(dpr || 1) });
  page.on('console', (m) => console.log('console:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto('file://' + path.resolve(src));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
