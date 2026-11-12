/* Shared test harness: a static server on a free port, Chromium, and a few studio helpers. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.pdf': 'application/pdf'
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port }));
  });
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  small: { width: 360, height: 740, isMobile: true, hasTouch: true }
};

/* Opens a page with service workers blocked and console errors collected in page.errors. */
async function open(browser, base, url, viewport, opts) {
  const vp = VIEWPORTS[viewport || 'desktop'];
  const ctx = await browser.newContext(Object.assign({
    viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: 'light'
  }, opts || {}));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.goto(base + url, { waitUntil: 'networkidle' });
  return page;
}

/* Studio helpers. */
async function studioWithSample(browser, base, viewport, opts) {
  const page = await open(browser, base, '/studio/', viewport, opts);
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await page.evaluate(() => window.LEStudio.useSample());
  await page.waitForFunction(() => window.LEStudio.scene.layers().length > 0);
  await page.waitForTimeout(300);
  return page;
}
function openPanel(page, id, opts) {
  return page.evaluate(([i, o]) => window.LEStudio.openPanel(i, o || {}), [id, opts || null]).then(() => page.waitForTimeout(250));
}
function doc(page) { return page.evaluate(() => window.LEStudio.scene.toJSON()); }
/* No sideways scroll. A page whose layout viewport is wider than the device (mobile browsers widen the layout
   viewport to fit overflowing content, so scrollWidth <= innerWidth stays true) also counts as overflowing. */
async function noOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement, body = document.body;
    const device = Math.min(window.innerWidth, window.screen && window.screen.width ? window.screen.width : Infinity);
    const vv = window.visualViewport;
    const widest = Math.max(de.scrollWidth, body ? body.scrollWidth : 0, vv ? vv.width * (vv.scale || 1) : 0, window.innerWidth);
    return widest <= device + 1 && window.innerWidth <= device + 1;
  });
}

function assert(cond, message) { if (!cond) throw new Error(message || 'Assertion failed'); }
assert.equal = (a, b, message) => { if (a !== b) throw new Error((message || 'Expected equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };
assert.noErrors = (page, allow) => {
  const bad = page.errors.filter((e) => !(allow || []).some((re) => re.test(e)));
  if (bad.length) throw new Error('Console errors: ' + bad.slice(0, 3).join(' | '));
};

/* ---- Additive helpers (QA suite). Existing exports above are unchanged. ---- */
const FIXTURE = (name) => path.join(ROOT, 'scripts', 'fixtures', name);
const PHOTO = (n) => path.join(ROOT, 'assets', 'photos', 'collage', ['arch-01', 'arch-02', 'arch-03'][(n || 0) % 3] + '.jpg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A blank design made the way a person does: click a size card on the start screen. size = card title or index. */
async function newDesign(browser, base, viewport, size, opts) {
  const page = await open(browser, base, '/studio/', viewport, opts);
  page.setDefaultTimeout(12000);
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await page.waitForSelector('.sx-size-card');
  const cards = page.locator('.sx-size-card');
  if (typeof size === 'string') await cards.filter({ hasText: size }).first().click();
  else await cards.nth(size || 0).click();
  await page.waitForFunction(() => document.getElementById('sx-start').hidden);
  await page.waitForTimeout(250);
  return page;
}
/* Writes a generated photo-like JPEG (noise + shapes, so the size is realistic) to the OS temp dir and returns its path. */
async function makeJpeg(browser, base, w, hgt, name) {
  const os = require('os');
  const ctx = await browser.newContext();
  try {
    const pg = await ctx.newPage();
    await pg.goto(base + '/404.html');
    const b64 = await pg.evaluate(async ([W, H]) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      for (let i = 0; i < 300; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,' + (30 + i % 40) + '%)'; x.fillRect((i * 97) % W, (i * 53) % H, W / 10 + (i % 7) * 40, H / 10 + (i % 5) * 50); }
      const id = x.getImageData(0, 0, W, H), d = id.data; let seed = 12345;
      for (let i = 0; i < d.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const n = ((seed >> 16) & 31) - 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      x.putImageData(id, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); return btoa(s);
    }, [w, hgt]);
    const file = path.join(os.tmpdir(), name || ('qa-' + w + 'x' + hgt + '.jpg'));
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return file;
  } finally { await ctx.close(); }
}
/* Like open() but with the site theme preset ('light' | 'dark') before any script runs. */
async function openTheme(browser, base, url, viewport, theme, opts) {
  const vp = VIEWPORTS[viewport || 'desktop'];
  const ctx = await browser.newContext(Object.assign({
    viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: theme === 'dark' ? 'dark' : 'light'
  }, opts || {}));
  await ctx.addInitScript((t) => { try { localStorage.setItem('le-theme', t); localStorage.setItem('it-theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.goto(base + url, { waitUntil: 'networkidle' });
  return page;
}
/* A design started the way most people start: "Open a photo" on the start screen (the photo becomes the base photo, so Resize offers Fill/Fit/Stretch). */
async function openPhotoDesign(browser, base, viewport, file, opts) {
  const page = await open(browser, base, '/studio/', viewport, opts);
  page.setDefaultTimeout(12000);
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc.setFiles(file || PHOTO(0));
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  return page;
}
/* Adds a photo through the real file chooser (cmd addPhoto). Resolves once the layer exists. */
async function addPhoto(page, file) {
  const before = (await doc(page)).layers.length;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => window.LEStudio.pickFiles('add'))]);
  await fc.setFiles(file || PHOTO(0));
  await page.waitForFunction((n) => window.LEStudio.scene.layers().length > n, before, { timeout: 15000 });
  await page.waitForTimeout(300);
}
const layers = (page) => page.evaluate(() => window.LEStudio.scene.layers());
const selection = (page) => page.evaluate(() => window.LEStudio.scene.selection());
const select = (page, ids) => page.evaluate((i) => window.LEStudio.scene.select(i), ids);
const click = (page, sel) => page.locator(sel).first().click();
/* Add layers straight into the scene (fast set-up for tests that are not about adding). Returns the new ids. */
async function addLayers(page, list) {
  return page.evaluate((l) => l.map((x) => { const L = window.LEStudio.scene.add(x); return (L && L.id) || (window.LEStudio.scene.layers().slice(-1)[0] || {}).id; }), list);
}
/* Screen rectangle of a layer, and a point inside it. */
const rect = (page, id) => page.evaluate((i) => window.LEStudio.scene.screenRect(i), id);
async function centerOf(page, id) { const r = await rect(page, id); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
async function handleBox(page, name, root) {
  return page.evaluate(([n, rt]) => { const e = document.querySelector((rt || '.le-sel') + ' [data-h="' + n + '"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, [name, root || null]);
}
/* Real mouse drag in steps. */
async function drag(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: steps || 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
/* Real touch drag (CDP touch events). */
async function touchDrag(page, from, to, steps) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
  const n = steps || 8;
  for (let i = 1; i <= n; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => {});
  await page.waitForTimeout(100);
}
/* Run an action that triggers a download; resolves { name, buf, size }. */
async function capture(page, action, timeout) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: timeout || 30000 }), action()]);
  const p = await dl.path();
  const buf = fs.readFileSync(p);
  return { name: dl.suggestedFilename(), buf, size: buf.length };
}
/* Image / PDF sniffers for downloaded buffers. */
function imageInfo(buf) {
  if (buf.length > 24 && buf.slice(1, 4).toString() === 'PNG') return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { type: 'jpeg' };
  }
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    const f = buf.slice(12, 16).toString();
    if (f === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (f === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    return { type: 'webp' };
  }
  return { type: 'unknown' };
}
function pdfInfo(buf) {
  const txt = buf.toString('latin1');
  const pages = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return { isPdf: txt.startsWith('%PDF-'), pages, size: buf.length };
}
/* Real PDF inspection with the site's own pdf.js: { pages, sizes:[[w,h] in points], text } (page text of the first pages). */
async function pdfRead(browser, base, buf) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await page.goto(base + '/404.html');
    await page.addScriptTag({ url: base + '/assets/vendor/pdf.min.js' });
    return await page.evaluate(async ([b64, root]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = root + '/assets/vendor/pdf.worker.min.js';
      const bin = atob(b64); const data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
      const sizes = []; let text = '';
      for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
        const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 }); sizes.push([Math.round(vp.width), Math.round(vp.height)]);
        const tc = await pg.getTextContent(); text += tc.items.map((x) => x.str).join(' ') + '\n';
      }
      return { pages: doc.numPages, sizes, text };
    }, [buf.toString('base64'), base]);
  } finally { await ctx.close(); }
}
/* Fire a synthetic pointer sequence on an element's centre (for controls that listen to pointer events). */
async function key(page, k, mods) {
  const m = mods || {};
  if (m.ctrl) await page.keyboard.down('Control');
  if (m.shift) await page.keyboard.down('Shift');
  await page.keyboard.press(k);
  if (m.shift) await page.keyboard.up('Shift');
  if (m.ctrl) await page.keyboard.up('Control');
  await page.waitForTimeout(60);
}
/* Wait for the studio autosave to land in IndexedDB, then return the saved project list. */
async function savedProjects(page) {
  await page.evaluate(() => window.LEStudio.saveNow());
  return page.evaluate(() => window.LE.project.list());
}
/* page.waitForFunction does NOT await a Promise: a predicate returning one passes at once (a pending Promise is
   truthy). Use this for async conditions: polls fn in the page, awaiting it, until it resolves truthy. */
async function waitForAsync(page, fn, arg, timeout) {
  const end = Date.now() + (timeout || 10000);
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() > end) throw new Error('waitForAsync: timed out after ' + (timeout || 10000) + 'ms');
    await sleep(100);
  }
}
/* WCAG contrast of each visible element's computed text colour against its own (or nearest painted ancestor's)
   background. Returns [{ text, color, bg, ratio }]. Used for the rule "the primary action's text meets AA (4.5:1)". */
async function inkContrast(page, selector) {
  return page.evaluate((sel) => {
    const parse = (c) => { const m = (c || '').match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length < 4 || c[3] > 0.5) return c; } return [255, 255, 255]; };
    return [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map((e) => {
      const fg = parse(getComputedStyle(e).color), bg = bgOf(e);
      const a = lum(fg), b = lum(bg);
      return { text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 24), color: getComputedStyle(e).color, bg: 'rgb(' + bg.slice(0, 3).join(', ') + ')', ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
    });
  }, selector);
}
/* Compare two scene docs ignoring nothing but ids order: returns true when identical JSON. */
const sameDoc = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = {
  ROOT, serve, chromium, VIEWPORTS, open, studioWithSample, openPanel, doc, noOverflow, assert,
  FIXTURE, PHOTO, sleep, makeJpeg, openTheme, newDesign, openPhotoDesign, addPhoto, layers, selection, select, click, addLayers, rect, centerOf, handleBox,
  drag, touchDrag, capture, imageInfo, pdfInfo, pdfRead, key, savedProjects, sameDoc, inkContrast, waitForAsync
};
