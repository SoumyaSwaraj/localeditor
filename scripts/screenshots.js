#!/usr/bin/env node
/* Captures the install-dialog screenshots, and draws the brand icons (icon-192/512, maskable-512, favicon-32,
   og.png) and the app-shortcut icons referenced by manifest.webmanifest, all from assets/icons/icon.svg and
   maskable.svg (the single source of the mark).
   Run from the repo root:  node scripts/screenshots.js [--icons-only]   then   node scripts/build.js
   Uses the preinstalled Playwright Chromium and the test harness's static server. Output is WebP (screenshots)
   and PNG (96px shortcut icons), encoded by Chromium itself so nothing else needs installing. */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('../tests/lib/harness');

const OUT = path.join(h.ROOT, 'assets', 'screenshots');
const ICONS = path.join(h.ROOT, 'assets', 'icons', 'shortcuts');

/* Shortcut glyphs, drawn in white on the brand Lapis tile. Paths match the shell icons in app.js. */
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

const TILE = '<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3589ED"/><stop offset="1" stop-color="#0369DA"/></linearGradient></defs>';

/* Renders an SVG file (or markup) to a PNG of the given size, transparent outside the shape. */
async function svgPng(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent('<html><body style="margin:0;background:transparent">' + svg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') + '</body></html>');
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

async function brandIcons(browser, base) {
  const ROOTI = path.join(h.ROOT, 'assets', 'icons');
  const icon = fs.readFileSync(path.join(ROOTI, 'icon.svg'), 'utf8');
  const mask = fs.readFileSync(path.join(ROOTI, 'maskable.svg'), 'utf8');
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [file, svg, size] of [['icon-192.png', icon, 192], ['icon-512.png', icon, 512], ['maskable-512.png', mask, 512], ['favicon-32.png', icon, 32]]) {
    const png = await svgPng(page, svg, size);
    fs.writeFileSync(path.join(ROOTI, file), png);
    console.log(file, Math.round(png.length / 1024 * 10) / 10 + ' KB');
  }
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    const png = await svgPng(page, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' + TILE +
      '<path d="M48 0C9.6 0 0 9.6 0 48s9.6 48 48 48 48-9.6 48-48S86.4 0 48 0z" fill="url(#t)"/><g transform="translate(24 24) scale(2)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</g></svg>', 96);
    fs.writeFileSync(path.join(ICONS, name + '-96.png'), png);
    console.log('shortcuts/' + name + '-96.png', Math.round(png.length / 1024 * 10) / 10 + ' KB');
  }
  /* Social card: the real homepage words on a neutral ground, with the mark. Fonts come from the site. */
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(base + '/404.html').catch(() => {});
  await page.setContent(`<html><head><style>
    @font-face { font-family: J; src: url(${base}/assets/fonts/jakarta-latin.woff2); font-weight: 400 800; }
    @font-face { font-family: S; font-style: italic; src: url(${base}/assets/fonts/instrument-serif-italic.woff2); }
    body { margin: 0; width: 1200px; height: 630px; background: #F5F5F7; font-family: system-ui, J; color: #1D1D1F; display: grid; grid-template-columns: 1fr 360px; overflow: hidden; }
    .copy { padding: 96px 0 0 88px; }
    .brand { display: flex; align-items: center; gap: 18px; font: 720 34px J; letter-spacing: -0.035em; }
    .brand svg { width: 64px; height: 64px; }
    h1 { margin: 84px 0 30px; font: 700 74px/1.02 system-ui, J; letter-spacing: -0.035em; }
    h1 em { font: inherit; font-style: normal; color: #6E6E73; }
    p { margin: 0; font: 600 25px J; color: #525252; display: flex; gap: 26px; }
    p span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #14874E; margin: 0 10px 3px 0; }
    .art { position: relative; background: #E6E6E6; }
    .art img { position: absolute; left: 44px; top: 70px; width: 272px; height: 340px; object-fit: cover; box-shadow: 0 30px 60px -24px rgba(0,0,0,.45); }
    .sel { position: absolute; left: 64px; top: 300px; width: 232px; padding: 6px 8px; outline: 2px solid #3589ED; color: #fff; font: italic 400 38px/0.95 S; text-shadow: 0 2px 16px rgba(0,0,0,.4); }
    .dl { position: absolute; left: 44px; top: 448px; height: 56px; padding: 0 30px; border-radius: 99px; background: #0369DA; color: #fff; font: 700 22px J; display: flex; align-items: center; }
  </style></head><body><div class="copy"><div class="brand">${icon.replace(/<title>.*?<\/title>/, '')}LocalEditor</div>
    <h1>The design studio<br>that <em>stays on your device.</em></h1><p><span>Free</span><span>No account</span><span>Works offline</span></p></div>
    <div class="art"><img src="${base}/assets/img/home/people-08.webp" alt=""><i class="sel">Long light, good friends.</i><span class="dl">Download</span></div></body></html>`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  const og = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(ROOTI, 'og.png'), og);
  console.log('og.png', Math.round(og.length / 1024) + ' KB');
  await ctx.close();
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
  if (process.argv.includes('--icons-only')) { await brandIcons(browser, base); await browser.close(); server.close(); return; }
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
  await brandIcons(browser, base);
  await browser.close();
  server.close();
})().catch((err) => { console.error(err); process.exit(1); });
