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
async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

function assert(cond, message) { if (!cond) throw new Error(message || 'Assertion failed'); }
assert.equal = (a, b, message) => { if (a !== b) throw new Error((message || 'Expected equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };
assert.noErrors = (page, allow) => {
  const bad = page.errors.filter((e) => !(allow || []).some((re) => re.test(e)));
  if (bad.length) throw new Error('Console errors: ' + bad.slice(0, 3).join(' | '));
};

module.exports = { ROOT, serve, chromium, VIEWPORTS, open, studioWithSample, openPanel, doc, noOverflow, assert };
