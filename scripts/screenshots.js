#!/usr/bin/env node
/* Captures the install-dialog screenshots and the app-shortcut icons referenced by manifest.webmanifest.
   Run from the repo root:  node scripts/screenshots.js   then   node scripts/build.js
   Uses the preinstalled Playwright Chromium and the test harness's static server. Output is WebP (screenshots)
   and PNG (96px shortcut icons), encoded by Chromium itself so nothing else needs installing. */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('../tests/lib/harness');

const OUT = path.join(h.ROOT, 'assets', 'screenshots');
const ICONS = path.join(h.ROOT, 'assets', 'icons', 'shortcuts');

/* Shortcut glyphs, drawn on the brand gold tile. Paths match the shell icons in app.js. */
const GLYPHS = {
  studio: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  collage: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
  pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="m9.5 17 4.8-4.8a1.3 1.3 0 0 1 1.8 1.8L11.3 18.8 9 19.3z"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  protect: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'
};

async function encode(page, pngBuffer, type, quality) {
  const b64 = await page.evaluate(async ([data, t, q]) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const url = c.toDataURL(t, q);
    return url.slice(url.indexOf(',') + 1);
  }, [pngBuffer.toString('base64'), type, quality]);
  return Buffer.from(b64, 'base64');
}

async function capture(browser, base, url, vp, scale, prep) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: scale, isMobile: vp.width < 600, hasTouch: vp.width < 600, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('le-theme', 'light'); localStorage.setItem('le-pwa', JSON.stringify({ offlineAt: 1, snoozes: 9 })); } catch (e) {} });
  await page.goto(base + url, { waitUntil: 'networkidle' });
  if (prep) await prep(page);
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: '.lp-notice,.toast,.sx-toast{display:none!important}' });
  const png = await page.screenshot();
  return { page, ctx, png };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(ICONS, { recursive: true });
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const studio = async (page) => {
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
    /* A real collage from the bundled photo pool, as a fresh design at the template size. */
    await page.evaluate(async (id) => {
      const c = window.LEStudio;
      const pack = await window.LE.collage.loadStyle(id.replace(/-\d+$/, ''));
      const tpl = (pack.templates || []).find((t) => t.id === id) || pack.templates[0];
      await window.LEStudioCollage.applyTemplate(c, tpl, {});
      c.scene.select([]);
      c.closePanel && c.closePanel();
    }, page.viewportSize().width < 600 ? 'scrapbook-03' : 'scrapbook-05').catch((e) => console.warn('collage skipped:', e.message));
    await page.waitForTimeout(2500);
  };
  const shots = [
    ['studio-narrow', '/studio/', { width: 390, height: 844 }, 2, studio],
    ['home-narrow', '/', { width: 390, height: 844 }, 2, null],
    ['studio-wide', '/studio/', { width: 1440, height: 900 }, 1, studio],
    ['home-wide', '/', { width: 1440, height: 900 }, 1, null]
  ];
  for (const [name, url, vp, scale, prep] of shots) {
    const { page, ctx, png } = await capture(browser, base, url, vp, scale, prep);
    const webp = await encode(page, png, 'image/webp', 0.72);
    fs.writeFileSync(path.join(OUT, name + '.webp'), webp);
    console.log(name + '.webp', vp.width * scale + 'x' + vp.height * scale, Math.round(webp.length / 1024) + ' KB');
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 96, height: 96 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    await page.setContent('<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F8E3AE"/><stop offset=".55" stop-color="#E2B15A"/><stop offset="1" stop-color="#B9832F"/></linearGradient></defs>' +
      '<rect width="96" height="96" rx="26" fill="url(#g)"/><g transform="translate(24 24) scale(2)" fill="none" stroke="#2A1F0A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</g></svg></body></html>');
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 96, height: 96 } });
    fs.writeFileSync(path.join(ICONS, name + '-96.png'), png);
    console.log('shortcuts/' + name + '-96.png', Math.round(png.length / 1024 * 10) / 10 + ' KB');
  }
  await browser.close();
  server.close();
})().catch((err) => { console.error(err); process.exit(1); });
