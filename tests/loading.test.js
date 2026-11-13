'use strict';
/* A light first load (docs/LOADING.md): budgets for what blocks the first paint of the photo studio, the PDF studio and the
   home page; nothing on the deferred list is requested before its trigger; each trigger loads its module (and its deps)
   and nothing else; deep links and documents load what they need; a failed load recovers on retry; the idle warm-up
   waits for the first interaction and stays off on metered connections; every deferred file is kept offline. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const build = require('../scripts/build.js');

const ROOT = build.ROOT;
const KB = 1024;
/* Budgets: gzip (level 9) of the scripts (not async) and stylesheets in the page's HTML. Defer scripts count: they run before
   the page is interactive. Measured 12 November 2026 (docs/LOADING.md): studio 208 KB JS + 42 KB CSS = 250 KB (it was
   551 + 72); PDF studio 242 + 41 = 283 KB (490 + 59); home 14 + 30 = 44 KB. Raise one only with a reason in docs/LOADING.md. */
const BUDGET = {
  'studio/index.html': { js: 201 * KB, css: 44 * KB, all: 242 * KB },   /* 13 Nov: measured 198.3 + 41.4 = 239.7 KB after le-studio-panels-more.js left the core (it was 215.6 + 42.8 = 258.4) */
  'pdf-studio/index.html': { js: 250 * KB, css: 44 * KB, all: 292 * KB },
  'index.html': { js: 20 * KB, css: 34 * KB, all: 90 * KB }
};

function tagsOf(page) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const dir = path.dirname(path.join(ROOT, page));
  const js = [], css = [];
  for (const m of html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)) if (!/\basync\b/.test(m[1] + m[3])) js.push(path.resolve(dir, m[2]));
  for (const m of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)) css.push(path.resolve(dir, m[1]));
  return { js, css };
}
const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length;
/* The loader maps: every LE.modules.defer({ id, src, css }) in them. */
function mapOf(file) {
  const text = fs.readFileSync(path.join(ROOT, 'assets/js', file), 'utf8');
  const out = [];
  for (const m of text.matchAll(/M\.defer\(\{ id: '([\w-]+)',([^\n]*)/g)) {
    const src = /src: JS \+ '([^']+)'/.exec(m[2]), css = /css: CSS \+ '([^']+)'/.exec(m[2]);
    out.push({ id: m[1], src: src && 'assets/js/' + src[1], css: css && 'assets/css/' + css[1] });
  }
  return out;
}
const STUDIO_MAP = mapOf('le-studio-lazy.js');
const PDF_MAP = mapOf('le-pdf-studio-lazy.js');
const deferredFiles = (map) => [].concat(...map.map((m) => [m.src, m.css].filter(Boolean)));

/* A page with the warm-up off (unless asked), the requests it makes, and console errors. */
async function openPage(browser, base, h, url, o) {
  o = o || {};
  const vp = h.VIEWPORTS[o.vp || 'desktop'];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript((o) => {
    if (!o.warm) window.LE_LOAD_NO_WARM = true;
    if (o.warmMs != null) window.LE_LOAD_WARM_MS = o.warmMs;
    if (o.saveData) Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true, effectiveType: '4g' }) });
  }, o);
  const page = await ctx.newPage();
  page.errors = [];
  page.reqs = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === base) page.reqs.push(u.pathname.slice(1)); });
  if (o.route) await o.route(page);
  await page.goto(base + url, { waitUntil: o.waitUntil || 'networkidle' });
  return page;
}
const studioReady = (page) => page.waitForFunction(() => window.LEStudio && window.LEStudio.scene && document.querySelector('.sx-size-card'));
const loadedIds = (page) => page.evaluate(() => LE.modules.list().filter((m) => m.loaded).map((m) => m.id).sort());
function newIds(before, after) { return after.filter((x) => before.indexOf(x) < 0).sort(); }

const cases = {};

/* ---------- Budgets ---------- */
Object.keys(BUDGET).forEach((page) => {
  cases['first-load budget: ' + page + ' blocking scripts and styles'] = async ({ h }) => {
    const { js, css } = tagsOf(page);
    const b = BUDGET[page];
    const j = js.reduce((s, f) => s + gz(f), 0), c = css.reduce((s, f) => s + gz(f), 0);
    const top = js.concat(css).map((f) => [path.relative(ROOT, f), gz(f)]).sort((x, y) => y[1] - x[1]).slice(0, 5).map((r) => r[0] + ' ' + Math.round(r[1] / KB) + ' KB').join(', ');
    const say = (what, v, max) => page + ' ' + what + ' is ' + (v / KB).toFixed(1) + ' KB gzip, over the ' + Math.round(max / KB) + ' KB budget. Defer a module (docs/LOADING.md). Largest: ' + top;
    h.assert(j <= b.js, say('JS', j, b.js));
    h.assert(c <= b.css, say('CSS', c, b.css));
    h.assert(j + c <= b.all, say('JS + CSS', j + c, b.all));
  };
});

/* ---------- The maps: files exist, are not also tags, and are kept offline in the right app part ---------- */
cases['deferred modules exist, are not also blocking, and are in their studio\'s offline part'] = async ({ h }) => {
  const { parts } = build.appParts();
  const partOf = {};
  Object.keys(parts).forEach((p) => parts[p].forEach((r) => { partOf[r.u.replace(/^\.\//, '')] = p; }));
  const pre = build.precacheList();
  [['studio/index.html', STUDIO_MAP, 'design'], ['pdf-studio/index.html', PDF_MAP, 'pdf']].forEach(([page, map, part]) => {
    h.assert(map.length >= 6, page + ': the map lists its modules');
    const { js, css } = tagsOf(page);
    const tags = js.concat(css).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    deferredFiles(map).forEach((f) => {
      h.assert(fs.existsSync(path.join(ROOT, f)), 'missing ' + f);
      h.assert(tags.indexOf(f) < 0, page + ': deferred and a tag at once: ' + f);
      h.assert(pre.includes('./' + f), 'deferred file is not in the first download: ' + f);
      h.assert(partOf[f] === part || partOf[f] === 'core', f + ' is in the "' + partOf[f] + '" part, so an installed ' + part + ' app would not keep it offline');
    });
  });
  h.assert(tagsOf('studio/index.html').js.some((f) => /le-load\.js$/.test(f)) && tagsOf('pdf-studio/index.html').js.some((f) => /le-load\.js$/.test(f)), 'both studios load the loader');
};

/* ---------- Before the first interaction ---------- */
cases['studio: nothing deferred is requested before its trigger; few requests before it is interactive'] = async ({ browser, base, h }) => {
  const page = await openPage(browser, base, h, '/studio/', { waitUntil: 'load' });
  await studioReady(page);
  const atReady = page.reqs.length;
  await page.waitForTimeout(1500);
  const early = deferredFiles(STUDIO_MAP).filter((f) => page.reqs.indexOf(f) >= 0);
  /* The start screen's makers row is the one deferred view on screen: it loads once the studio is interactive and idle. */
  const allowed = ['assets/js/le-makers.js', 'assets/js/le-studio-makers.js', 'assets/css/studio-makers.css', 'assets/js/le-fonts.js', 'assets/js/le-fonts-originals.js', 'assets/js/le-assets.js'];
  h.assert(!early.filter((f) => allowed.indexOf(f) < 0).length, 'requested without a trigger: ' + early.filter((f) => allowed.indexOf(f) < 0).join(', '));
  h.assert(atReady <= 24, 'requests before the studio is interactive: ' + atReady + ' (' + page.reqs.slice(0, atReady).join(', ') + ')');
  h.assert(!page.reqs.some((f) => /^assets\/vendor\//.test(f)), 'no vendor library on the first paint: ' + page.reqs.filter((f) => /vendor/.test(f)).join(', '));
  h.assert(await page.$('.mk-start'), 'the makers row (skeleton or cards) is on the start screen');
  await page.waitForSelector('.mk-start .mk-row-cards > :not(.skel)', { timeout: 15000 });
  h.assert(!(await page.$('.mk-start.le-load-stub')), 'the skeleton row was replaced, not doubled');
  h.assert.equal(await page.$$eval('.mk-start', (n) => n.length), 1, 'one makers row');
  h.assert.noErrors(page);
};

cases['PDF studio: Protect, Bulk, Office, Docs, Scan and Read text are not requested before use; their entry points are drawn'] = async ({ browser, base, h }) => {
  const page = await openPage(browser, base, h, '/pdf-studio/');
  await page.waitForTimeout(800);
  const early = deferredFiles(PDF_MAP).filter((f) => page.reqs.indexOf(f) >= 0);
  h.assert(!early.length, 'requested without a trigger: ' + early.join(', '));
  h.assert(!page.reqs.some((f) => /^assets\/vendor\//.test(f)), 'no PDF library before a PDF opens: ' + page.reqs.filter((f) => /vendor/.test(f)).join(', '));
  const ui = await page.evaluate(() => ({ rail: [...document.querySelectorAll('#ps-rail [data-panel]')].map((b) => b.getAttribute('data-panel')).join(','), entries: ['.pb-entry', '.po-entry', '.pd-entry', '[data-psn-open]'].map((s) => !!document.querySelector(s)) }));
  h.assert.equal(ui.rail, 'pages,edit,sign,forms,tools,security,convert,bulk,docs,scan,export', 'rail tabs in their usual order');
  h.assert(ui.entries.every(Boolean), 'start-screen links are there: ' + ui.entries);
  /* A link is styled before its module arrives (no unstyled flash). */
  h.assert.equal(await page.$eval('.pb-entry', (b) => getComputedStyle(b).borderTopStyle), 'dashed', 'start-screen link styled');
  /* Opening Bulk from its link loads exactly Bulk. */
  const before = await loadedIds(page);
  await page.click('.pb-entry');
  await page.waitForSelector('.ps-pane[data-pane="bulk"] .pb-job');
  h.assert.equal(JSON.stringify(newIds(before, await loadedIds(page))), JSON.stringify(['bulk']), 'Bulk and nothing else');
  /* The Protect tab loads Protect and swaps in its own tab. */
  await page.evaluate(() => PS.addFiles([new File([new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'])], 'a.pdf', { type: 'application/pdf' })]));
  await page.waitForFunction(() => PS.S.pages.length > 0, null, { timeout: 20000 });
  await page.click('#ps-rail [data-panel="security"]');
  await page.waitForSelector('.sec-pane', { timeout: 15000 });
  h.assert(!(await page.$('#ps-rail [data-le-stub="security"]')), 'the module\'s own tab replaced the stand-in');
  h.assert.equal(await page.$$eval('#ps-rail [data-panel="security"]', (n) => n.length), 1, 'one Protect tab');
  h.assert.noErrors(page, [/Warning|Invalid|Indexing/i]);
};

cases['home: no late stylesheet shifts the layout; install and storage code load after the first paint'] = async ({ browser, base, h }) => {
  const page = await openPage(browser, base, h, '/', { waitUntil: 'commit' });
  await page.waitForLoadState('load');
  await page.waitForFunction(() => window.LEPwa && window.LE && LE.downloads && LE.support, null, { timeout: 15000 });
  const cls = await page.evaluate(() => new Promise((r) => { let v = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) v += e.value; })).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => r(v), 300); }));
  h.assert(cls < 0.02, 'layout shift on the home page: ' + cls);
  h.assert(!page.reqs.some((f) => /^assets\/js\/le-(studio|pdf)/.test(f)), 'no studio code on the home page');
  h.assert.noErrors(page);
};

/* le-pwa.js keeps install state, the worker and update safety; the storage manager and the install chooser (le-pwa-more.js)
   arrive on first use. The housekeeping pass (every 6 hours, when idle) is the only other thing that asks for them. */
cases['home: the storage manager and the install chooser are not requested before use; Storage and Install app load them'] = async ({ browser, base, h }) => {
  const page = await openPage(browser, base, h, '/', { waitUntil: 'load', route: (p) => p.addInitScript(() => { try { localStorage.setItem('le-pwa', JSON.stringify({ enforcedAt: Date.now() })); } catch (e) {} }) });
  await page.waitForFunction(() => window.LEPwa && LEPwa.openStorage && LEPwa.updateReady, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  h.assert(page.reqs.indexOf('assets/js/le-pwa-more.js') < 0, 'le-pwa-more.js was requested before anyone asked for storage or install');
  h.assert.equal(await page.evaluate(() => typeof LEPwa.update + ' ' + typeof LEPwa.registerEditor + ' ' + LEPwa.updateReady()), 'function function false', 'updates and editors are in the always part');
  await page.evaluate(() => LEPwa.openStorage());
  h.assert(await page.$('dialog.lp-storage[open]'), 'Storage opened once its code arrived');
  h.assert(page.reqs.indexOf('assets/js/le-pwa-more.js') >= 0, 'and it came from le-pwa-more.js');
  await page.evaluate(() => LEPwa.closeStorage());
  const r = await page.evaluate(() => LEPwa.report());
  h.assert(r && Array.isArray(r.categories), 'LEPwa.report() answers as before');
  const how = await page.evaluate(() => LEPwa.install());
  h.assert(how === 'chooser' && (await page.$('dialog.lp-choose[open]')), 'Install app opens the chooser: ' + how);
  h.assert.equal(await page.$$eval('script[src$="le-pwa-more.js"]', (n) => n.length), 1, 'loaded once');
  h.assert.noErrors(page);
};

/* ---------- Triggers: each loads its module (and deps) and nothing else ---------- */
cases['studio triggers: a panel, a command, the first selection and Download each load exactly their modules'] = async ({ browser, base, h }) => {
  const page = await openPage(browser, base, h, '/studio/');
  await studioReady(page);
  await page.waitForTimeout(1200); /* the start screen's makers row */
  let before = await loadedIds(page);
  h.assert(await page.evaluate(() => { LEStudio.openPanel('recipes'); return !!document.querySelector('#sx-panel-body .le-load-wait .skel') && !document.getElementById('sx-panel').hidden; }), 'the panel frame shows a skeleton at once');
  await page.waitForSelector('#sx-panel-body .sxr-foot, #sx-panel-body .sxr-body, #sx-panel-body [class^="sxr-"]', { timeout: 15000 });
  h.assert.equal(JSON.stringify(newIds(before, await loadedIds(page))), JSON.stringify(['recipes']), 'Recipes and nothing else');
  /* A new design, then the first selection: the selection tools (and their libraries) arrive; the toolbar is redrawn. */
  await page.evaluate(() => LEStudio.closePanel());
  await page.evaluate(() => LEStudio.newDesign(1080, 1080, 'Test'));
  await page.waitForTimeout(300);
  before = await loadedIds(page);
  await page.evaluate(() => { const id = LEStudio.addShape ? LEStudio.addShape('rect') : null; if (id) LEStudio.scene.select([id]); });
  await page.waitForFunction(() => ['tools', 'collage', 'cutout', 'privacy', 'background'].every((id) => LE.modules.loaded(id)), null, { timeout: 20000 });
  const sel = newIds(before, await loadedIds(page));
  h.assert(sel.indexOf('export') < 0 && sel.indexOf('design') < 0 && sel.indexOf('agent') < 0 && sel.indexOf('makers') < 0, 'a selection does not load Download, design files, agent mode or makers: ' + sel);
  /* A command from a deferred module (File → Agent mode…): it loads agent mode, then runs. */
  before = await loadedIds(page);
  await page.evaluate(() => LEStudio.cmd('agentMode'));
  await page.waitForFunction(() => LE.modules.loaded('agentui') && window.LEAgent && !LEAgent.__leStub, null, { timeout: 20000 });
  h.assert.equal(JSON.stringify(newIds(before, await loadedIds(page))), JSON.stringify(['agent', 'agentui', 'design']), 'agent mode and what it needs (makers came with the start screen)');
  await page.evaluate(() => { LEStudio.closePop(); LEStudio.closeModal && LEStudio.closeModal(); });
  /* Download: the panel and ctx.exportImage wait for the module once. */
  before = await loadedIds(page);
  await page.evaluate(() => LEStudio.openPanel('export'));
  await page.waitForFunction(() => LE.modules.loaded('export') && !document.querySelector('#sx-panel-body .le-load-wait'), null, { timeout: 15000 });
  h.assert.equal(JSON.stringify(newIds(before, await loadedIds(page))), JSON.stringify(['export']), 'Download and nothing else');
  h.assert.noErrors(page);
};

cases['studio deep links and documents load what they need before they are used'] = async ({ browser, base, h }) => {
  /* ?make= opens the maker form. */
  let page = await openPage(browser, base, h, '/studio/?make=quote');
  await page.waitForFunction(() => window.LEStudioMakers && LEStudioMakers.form && LEStudioMakers.form(), null, { timeout: 20000 });
  h.assert(await page.evaluate(() => LE.modules.loaded('makers')), 'makers loaded for ?make=');
  await page.context().close();
  /* ?tool=cutout opens through the placeholder; ?agent=1 loads agent mode; #d= template links load design files. */
  page = await openPage(browser, base, h, '/studio/?tool=recipes');
  await page.waitForFunction(() => LE.modules.loaded('recipes') && LEStudio.S.panel === 'recipes', null, { timeout: 15000 });
  await page.context().close();
  page = await openPage(browser, base, h, '/studio/?agent=1');
  await page.waitForFunction(() => LE.modules.loaded('agentui') && window.LEAgent && !LEAgent.__leStub, null, { timeout: 20000 });
  await page.context().close();
  /* A saved design with a collage slot, a cut-out, a redaction and a maker page: restored with those modules already there. */
  page = await openPage(browser, base, h, '/studio/');
  await studioReady(page);
  await page.evaluate(async () => {
    const c = LEStudio;
    c.newDesign(800, 800, 'Features');
    await new Promise((r) => setTimeout(r, 200));
    c.addLayers([
      { type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: { type: 'solid', color: '#cccccc' }, redact: { mode: 'solid' } },
      { type: 'text', text: 'Hello', x: 200, y: 200, w: 300, h: 80, size: 48 }
    ]);
    c.scene._doc.maker = { id: 'quote', values: { quote: 'Hi' }, style: 'classic', size: 'square' };
    c.syncProject();
    await c.saveNow();
    window.__savedMaker = !!(c.S.project.pages[0] && c.S.project.pages[0].maker);
  });
  const id = await page.evaluate(() => LEStudio.S.project.id);
  h.assert(await page.evaluate(() => window.__savedMaker), 'the maker page was saved (test setup)');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction((pid) => window.LEStudio && LEStudio.S.project && LEStudio.S.project.id === pid, id, { timeout: 20000 });
  const got = await page.evaluate(() => ({ privacy: LE.modules.loaded('privacy'), makers: LE.modules.loaded('makers'), fonts: LE.modules.loaded('fontorig'), recipes: LE.modules.loaded('recipes') }));
  h.assert(got.privacy && got.makers && got.fonts, 'the document\'s modules were there when it opened: ' + JSON.stringify(got));
  h.assert(!got.recipes, 'and nothing it does not use');
  h.assert.noErrors(page);
};

cases['a module that fails to download shows plain words and Try again, and loads on retry (no cached failure)'] = async ({ browser, base, h }) => {
  let fail = true;
  const page = await openPage(browser, base, h, '/studio/', { route: (p) => p.route('**/assets/js/le-studio-recipes.js', (r) => (fail ? r.abort() : r.continue())) });
  await studioReady(page);
  await page.evaluate(() => LEStudio.openPanel('recipes'));
  await page.waitForSelector('#sx-panel-body .le-load-retry', { timeout: 15000 });
  h.assert(/Check your connection|offline/.test(await page.textContent('#sx-panel-body')), 'says what happened in plain words');
  h.assert.equal(await page.evaluate(() => LE.modules.state('recipes')), 'error');
  fail = false;
  await page.click('#sx-panel-body .le-load-retry');
  await page.waitForFunction(() => LE.modules.loaded('recipes') && !document.querySelector('#sx-panel-body .le-load-wait'), null, { timeout: 15000 });
  h.assert(!(await page.$('#sx-panel-body .le-load-error')), 'the real panel replaced the error');
  h.assert.equal(await page.$$eval('script[src$="le-studio-recipes.js"]', (n) => n.length), 1, 'one script tag (the failed one was removed)');
  /* LE.lazy retries too. */
  const lazy = await page.evaluate(async () => {
    const src = '../tests/fixtures/le-load-missing-' + Date.now() + '.js';
    const a = await LE.lazy(src).then(() => 'ok', () => 'failed');
    const p1 = LE.lazy(src), p2 = LE.lazy(src);
    return { a, retried: p1 === p2 };
  });
  h.assert(lazy.a === 'failed' && lazy.retried, 'LE.lazy does not keep a failure: ' + JSON.stringify(lazy));
  h.assert.noErrors(page, [/Failed to load resource|ERR_FAILED|Could not load/]);
};

/* ---------- Warm-up ---------- */
cases['warm-up: starts after the first interaction, most-used first; never on a data-saver connection'] = async ({ browser, base, h }) => {
  let page = await openPage(browser, base, h, '/studio/', { warm: true, warmMs: 60000 });
  await studioReady(page);
  await page.waitForTimeout(1500);
  const quiet = await page.evaluate(() => LE.modules.warmStatus());
  h.assert(!quiet.running, 'nothing warms before the first interaction: ' + JSON.stringify(quiet));
  await page.evaluate(() => { try { localStorage.setItem('le-downloads-usage', JSON.stringify({ f: { 'studio.redact': { n: 9, first: Date.now(), last: Date.now() } } })); } catch (e) {} });
  h.assert.equal((await page.evaluate(() => LE.modules.warmStatus().order))[0], 'privacy', 'usage signals put the most-used module first');
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => ['export', 'fonts', 'tools'].every((id) => LE.modules.loaded(id)), null, { timeout: 30000 });
  h.assert(!(await page.evaluate(() => LE.modules.loaded('agent'))), 'agent mode is never warmed');
  await page.context().close();
  page = await openPage(browser, base, h, '/studio/', { warm: true, warmMs: 200, saveData: true });
  await studioReady(page);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => LE.modules.warmStatus());
  h.assert.equal(st.skipped, 'metered', 'data saver: no warm-up');
  h.assert(!(await page.evaluate(() => LE.modules.loaded('export'))), 'nothing downloaded in the background');
  h.assert.noErrors(page);
};

/* ---------- The mechanism, with a fixture module ---------- */
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
