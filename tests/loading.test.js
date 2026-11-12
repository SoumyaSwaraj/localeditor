'use strict';
/* First load of the photo studio (docs/LOADING.md): a budget for the scripts that block the first paint, deferred
   modules that still load and keep every extension point working. Panels and deep links are covered by deep-links,
   shell and smoke; run them after changing what is deferred. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const build = require('../scripts/build.js');

const ROOT = build.ROOT;
/* The budget: gzip bytes of the <script src> tags in studio/index.html that are neither async nor deferred.
   Measured 432 KB on 12 November 2026 after deferring le-stock.js (442 KB before). Raise it only with a reason in docs/LOADING.md. */
const BUDGET_GZIP = 480 * 1024;
const BUDGET_RAW = 1800 * 1024;

function studioScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'studio/index.html'), 'utf8');
  const blocking = [], deferred = [];
  for (const m of html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)) {
    if (/\b(async|defer)\b/.test(m[1] + m[3])) continue;
    blocking.push(path.resolve(ROOT, 'studio', m[2]));
  }
  for (const m of html.matchAll(/LE\.modules\.defer\(\{[^}]*?src:\s*'([^']+)'/g)) deferred.push(path.resolve(ROOT, 'studio', m[1]));
  return { blocking, deferred };
}

const cases = {};

cases['KNOWN-BUG: studio blocking scripts stay within the first-load budget (L1: 496 KB gzip against a 480 KB budget after agent mode, makers and fonts merged; modules must be deferred per docs/LOADING.md)'] = async ({ h }) => {
  const { blocking } = studioScripts();
  let raw = 0, gz = 0;
  const rows = blocking.map((f) => { const b = fs.readFileSync(f); const g = zlib.gzipSync(b, { level: 9 }).length; raw += b.length; gz += g; return [path.relative(ROOT, f), g]; });
  const top = rows.sort((a, b) => b[1] - a[1]).slice(0, 5).map((r) => r[0] + ' ' + Math.round(r[1] / 1024) + ' KB').join(', ');
  h.assert(gz <= BUDGET_GZIP, 'studio blocking scripts are ' + Math.round(gz / 1024) + ' KB gzip, over the ' + Math.round(BUDGET_GZIP / 1024) + ' KB budget. Defer a module that only renders on demand (docs/LOADING.md). Largest: ' + top);
  h.assert(raw <= BUDGET_RAW, 'studio blocking scripts are ' + Math.round(raw / 1024) + ' KB raw, over the ' + Math.round(BUDGET_RAW / 1024) + ' KB budget. Largest: ' + top);
};

cases['deferred modules exist, are not also blocking, and stay offline'] = async ({ h }) => {
  const { blocking, deferred } = studioScripts();
  h.assert(deferred.length >= 1, 'at least one module is deferred');
  const pre = build.precacheList();
  deferred.forEach((f) => {
    h.assert(fs.existsSync(f), 'missing ' + f);
    h.assert(!blocking.includes(f), 'deferred and blocking at once: ' + f);
    h.assert(pre.includes('./' + path.relative(ROOT, f).split(path.sep).join('/')), 'deferred module still downloads on the first visit: ' + f);
  });
  h.assert(blocking.some((f) => /le-load\.js$/.test(f)), 'the loader is a blocking script, before the modules it defers');
};

cases['deferred modules load after the first paint and in order; stock search still works'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && LE.modules && LE.modules.list().every((m) => m.loaded), null, { timeout: 15000 });
  const r = await page.evaluate(() => ({ list: LE.modules.list(), providers: LE.stock && LE.stock.providers ? LE.stock.providers().length : 0, tags: [].slice.call(document.querySelectorAll('script[data-le-deferred]')).map((s) => s.getAttribute('src')) }));
  h.assert(r.providers > 0, 'LE.stock is there for the collage photo search');
  h.assert.equal(JSON.stringify(r.tags), JSON.stringify(r.list.map((m) => m.src)), 'loaded once each, in declaration order');
  await page.evaluate(() => LEStudio.openTool ? LEStudio.openTool('collage') : LEStudio.openPanel('apps', { app: 'collage' }));
  await page.waitForTimeout(400);
  h.assert.noErrors(page);
};

cases['a panel registered by a deferred module opens through its placeholder; init hooks, rail and queued handlers work'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene && window.LE && LE.modules);
  await page.route('**/tests/fixtures/le-load-panel.js', async (route) => { await new Promise((r) => setTimeout(r, 600)); route.continue(); });
  await page.evaluate(() => {
    LE.modules.defer({ id: 'loadtest', src: '../tests/fixtures/le-load-panel.js', panels: { loadtest: 'Load test' }, wrap: { apps: (o) => o.app === 'loadtest' }, queue: 'onLoadTestFile' });
    LEStudio.openPanel('loadtest');
    LEStudio.S.onLoadTestFile('early.leworkflow');
  });
  h.assert(/Opening/.test(await page.textContent('#sx-panel-body')), 'placeholder shows while the module downloads');
  await page.waitForSelector('#sx-panel-body .le-load-real', { timeout: 10000 });
  const r = await page.evaluate(() => ({ init: window.__loadTestInit, ctx: window.__loadTestCtx, files: window.__loadTestFiles, rail: !!document.querySelector('[data-panel-btn="loadtest"]') }));
  h.assert.equal(r.init, 1, 'the module\'s init hook ran once');
  h.assert(r.ctx, 'with the studio context');
  h.assert.equal(JSON.stringify(r.files), JSON.stringify(['early.leworkflow']), 'a handler called before the module arrived is replayed');
  h.assert(r.rail, 'the rail was redrawn with the module\'s entry');
  await page.evaluate(() => LEStudio.openPanel('apps', { app: 'loadtest' }));
  await page.waitForSelector('#sx-panel-body .le-load-app');
  await page.evaluate(() => LEStudio.openPanel('apps'));
  h.assert(!(await page.$('#sx-panel-body .le-load-app')), 'the rest of the Apps panel is untouched');
  h.assert.noErrors(page);
};

module.exports = cases;
