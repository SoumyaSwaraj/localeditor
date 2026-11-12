'use strict';
/* Three installable apps from one site (docs/INSTALL.md): "LocalEditor" (everything), "LocalEditor Design" and "LocalEditor PDF".
   Manifests, the install chooser, switching the manifest link (and navigating when a browser has no prompt), per-app offline
   parts in the worker and LE.downloads, the Settings rows, and a studio-only install offline. Worker cases run their own server
   so sw.js can be generated per test and a second version simulated. Set LE_SHOTS=dir to keep screenshots. */
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const build = require('../scripts/build.js');

const ROOT = build.ROOT;
const SHOTS = process.env.LE_SHOTS || '';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const APPS = ['suite', 'design', 'pdf'];
const FILES = build.APP_MANIFEST_FILES;

function serveWorker() {
  const state = { version: 'inst-1' };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(build.swSource({ version: state.version })); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': buf.length });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, state, base: 'http://127.0.0.1:' + server.address().port }));
  });
}
async function controlled(page) {
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
  await page.waitForFunction(() => caches.keys().then((k) => k.some((n) => n.indexOf('le-app-') === 0)), null, { timeout: 30000 });
}
async function until(page, fn, ms, msg, arg) {
  const end = Date.now() + (ms || 15000);
  for (;;) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    if (Date.now() > end) throw new Error('Timed out: ' + (msg || fn.toString().slice(0, 80)));
    await new Promise((r) => setTimeout(r, 400));
  }
}
async function ready(page) {
  await page.waitForFunction(() => window.LEPwa && window.LE && LE.downloads && LE.downloads.__real, null, { timeout: 15000 });
  await page.evaluate(() => LE.downloads.ready);
}
/* A stand-in for the browser's install prompt, as Chromium dispatches it. */
function fakePrompt(page, outcome) {
  return page.evaluate((o) => {
    window.__prompts = window.__prompts || [];
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompts.push(document.querySelector('link[rel=manifest]').getAttribute('href')); return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: o || 'accepted' });
    window.dispatchEvent(e);
  }, outcome);
}
async function shot(page, name) { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } }
const linked = (page) => page.evaluate(() => document.querySelector('link[rel=manifest]').getAttribute('href'));

const cases = {};

cases['three manifests: valid, distinct, generated, in scope, every icon exists'] = async ({ h }) => {
  const all = {};
  APPS.forEach((a) => {
    const disk = JSON.parse(fs.readFileSync(path.join(ROOT, FILES[a]), 'utf8'));
    h.assert.equal(JSON.stringify(disk), JSON.stringify(build.appManifestJSON(a)), FILES[a] + ' is stale; run node scripts/build.js');
    all[a] = disk;
  });
  h.assert.equal(JSON.stringify(all.suite), JSON.stringify(build.manifestJSON()), 'the suite manifest is the one installed copies already have');
  const ids = APPS.map((a) => all[a].id);
  h.assert.equal(new Set(ids).size, 3, 'distinct ids: ' + ids.join(', '));
  h.assert.equal(JSON.stringify(ids), JSON.stringify(['/', '/studio/', '/pdf-studio/']), 'stable ids (never change them: an installed app is known by its id)');
  const names = APPS.map((a) => all[a].name);
  h.assert.equal(new Set(names).size, 3, 'distinct names');
  APPS.forEach((a) => {
    const m = all[a];
    ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'background_color', 'description'].forEach((k) => h.assert(m[k], a + ' needs ' + k));
    h.assert(m.short_name.length <= 12, a + ': the home-screen name fits in 12 characters: ' + m.short_name);
    const site = 'https://localeditor.net/';
    const scope = new URL(m.scope, site).href;
    const start = new URL(m.start_url, site).href;
    h.assert(start.indexOf(scope) === 0, a + ': start_url inside scope');
    h.assert(new URL(m.id, start).href.indexOf(site) === 0, a + ': id on this site');
    const files = [].concat(m.icons, m.screenshots || [], ...(m.shortcuts || []).map((s) => s.icons || []), ...(m.file_handlers || []).map((f) => f.icons || []));
    files.forEach((f) => h.assert(fs.existsSync(path.join(ROOT, f.src)), a + ': missing ' + f.src));
    h.assert(m.icons.some((i) => i.purpose === 'maskable') && m.icons.some((i) => i.sizes === '512x512'), a + ': icons');
    (m.shortcuts || []).forEach((s) => {
      h.assert(new URL(s.url, site).href.indexOf(scope) === 0, a + ': shortcut inside scope: ' + s.url);
      h.assert(fs.existsSync(path.join(ROOT, new URL(s.url, site).pathname, 'index.html')), a + ': shortcut page exists: ' + s.url);
    });
    (m.file_handlers || []).forEach((f) => h.assert(new URL(f.action, site).href.indexOf(scope) === 0, a + ': file handler inside scope'));
    if (m.share_target) h.assert(new URL(m.share_target.action, site).href.indexOf(scope) === 0 && /share-target/.test(m.share_target.action) && m.share_target.method === 'POST', a + ': share target inside scope');
  });
  /* Each studio opens only what it handles. */
  const exts = (m) => [].concat(...(m.file_handlers || []).map((f) => [].concat(...Object.values(f.accept))));
  h.assert(['.leproject', '.ledesign.json', '.leworkflow', '.png', '.jpg'].every((x) => exts(all.design).includes(x)) && !exts(all.design).includes('.pdf'), 'design opens images and design files, not PDFs');
  h.assert(['.pdf', '.lepdfworkflow'].every((x) => exts(all.pdf).includes(x)) && !exts(all.pdf).some((x) => /\.(png|jpg|leproject)$/.test(x)), 'PDF opens PDFs and PDF workflows only');
  h.assert(/app=design/.test(all.design.start_url) && /app=pdf/.test(all.pdf.start_url), 'start pages say which app opened them');
  /* Shipped and served like the suite manifest. */
  const deploy = fs.readFileSync(path.join(ROOT, 'scripts/deploy.sh'), 'utf8');
  h.assert(/application\/manifest\+json" "manifest\.webmanifest" "manifest-\*\.webmanifest"/.test(deploy), 'deploy.sh uploads the new manifests with their content type');
  h.assert(build.precacheList().includes('./' + FILES.design) && build.precacheList().includes('./' + FILES.pdf), 'the manifests are kept offline');
};

cases['Chromium accepts each manifest and fires a fresh install prompt when the link switches'] = async ({ h }) => {
  const { server, base } = await serveWorker();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-install-'));
  const ctx = await h.chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: ['--bypass-app-banner-engagement-checks'] });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.addInitScript(() => { window.__bip = []; window.addEventListener('beforeinstallprompt', () => window.__bip.push(document.querySelector('link[rel=manifest]').getAttribute('href'))); });
    await page.goto(base + '/studio/', { waitUntil: 'load' });
    await controlled(page);
    const cdp = await ctx.newCDPSession(page);
    for (const a of ['design', 'pdf', 'suite']) {
      const before = await page.evaluate(() => window.__bip.length);
      await page.evaluate((app) => LEPwa.linkManifest(app), a);
      await until(page, (x) => window.__bip.slice(x[1]).some((u) => u.indexOf(x[0]) >= 0), 10000, 'a fresh prompt for ' + a, [FILES[a], before]);
      const man = await cdp.send('Page.getAppManifest');
      h.assert(man.url.endsWith('/' + FILES[a]) && !(man.errors || []).length, a + ': manifest read without errors: ' + JSON.stringify(man.errors));
      const inst = await cdp.send('Page.getInstallabilityErrors');
      h.assert(!(inst.installabilityErrors || []).length, a + ': installable: ' + JSON.stringify(inst.installabilityErrors));
    }
    /* Installing for real (CDP stands in for the browser dialog): the id each app gets, and the files each one opens. */
    await page.evaluate(() => LEPwa.linkManifest('design'));
    await page.waitForTimeout(800);
    await cdp.send('PWA.install', { manifestId: base + '/studio/' });
    const os1 = await cdp.send('PWA.getOsAppState', { manifestId: base + '/studio/' });
    const accepts = [].concat(...os1.fileHandlers.map((f) => f.accepts.map((x) => x.fileExtensions).flat()));
    h.assert(accepts.includes('.ledesign.json') && accepts.includes('.leproject') && !accepts.includes('.pdf'), 'LocalEditor Design installed under its own id with its own file types: ' + accepts.join(' '));
    const missing = await cdp.send('PWA.getOsAppState', { manifestId: base + '/' }).then(() => 'installed', (e) => e.message);
    h.assert(/Unknown/.test(missing), 'installing the Design app does not install the suite');
  } finally { await ctx.close(); server.close(); }
};

cases['the chooser: three choices with sizes, suite recommended, no sideways scroll at 360 px and desktop, light and dark'] = async ({ browser, base, h }) => {
  for (const [vp, theme] of [['small', 'light'], ['small', 'dark'], ['desktop', 'light'], ['desktop', 'dark']]) {
    const page = await h.openTheme(browser, base, '/', vp, theme);
    await ready(page);
    await fakePrompt(page);
    await page.evaluate(() => LEPwa.install());
    await page.waitForSelector('dialog.lp-choose[open]');
    await page.waitForFunction(() => /MB/.test(document.querySelector('[data-lp-size="pdf"]').textContent));
    const t = await page.textContent('dialog.lp-choose');
    ['Everything', 'Recommended', 'Design studio only', 'PDF studio only', 'LE Design', 'LE PDF'].forEach((w) => h.assert(t.includes(w), vp + ' ' + theme + ': ' + w));
    h.assert((t.match(/About [\d.]+ MB on this device/g) || []).length === 3, 'a size for each choice: ' + t);
    h.assert(!/PWA|manifest|service worker|scope|cache/i.test(t), 'plain words only');
    h.assert.equal(await page.$eval('dialog.lp-choose input:checked', (i) => i.value), 'suite', 'the suite is pre-selected outside the studios');
    h.assert(await h.noOverflow(page), vp + ': no sideways scroll');
    const box = await page.$eval('dialog.lp-choose', (d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
    h.assert(box.l >= 0 && box.r <= box.w + 1, 'sheet fits the screen');
    const small = await page.$$eval('dialog.lp-choose button, dialog.lp-choose label.lp-app', (l) => l.filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim()));
    h.assert(!small.length, 'targets of 44 px: ' + small.join(', '));
    const ink = await h.inkContrast(page, 'dialog.lp-choose [data-lp-go]');
    h.assert(ink.length && ink[0].ratio >= 4.5, 'Install button text contrast ' + JSON.stringify(ink));
    await shot(page, 'install-chooser-' + (vp === 'small' ? '360' : 'desktop') + '-' + theme);
    h.assert.noErrors(page);
    await page.context().close();
  }
  for (const [url, want] of [['/studio/', 'design'], ['/pdf-studio/', 'pdf']]) {
    const page = await h.open(browser, base, url, 'desktop');
    await ready(page);
    await page.evaluate(() => LEPwa.install());
    await page.waitForSelector('dialog.lp-choose[open]');
    h.assert.equal(await page.$eval('dialog.lp-choose input:checked', (i) => i.value), want, url + ' pre-selects its own studio');
    await page.context().close();
  }
};

cases['choosing each app links its manifest and fires the prompt for it; the page goes back to the suite after'] = async ({ browser, base, h }) => {
  for (const [url, app] of [['/', 'suite'], ['/studio/', 'design'], ['/pdf-studio/', 'pdf'], ['/', 'design']]) {
    const page = await h.open(browser, base, url, 'desktop');
    await ready(page);
    /* Chromium sends a fresh prompt each time the link changes (checked in the case above): stand in for it. */
    await page.evaluate(() => { new MutationObserver(() => setTimeout(() => window.__reprompt && window.__reprompt(), 50)).observe(document.querySelector('link[rel=manifest]'), { attributes: true }); });
    await page.exposeFunction('__reprompt', () => fakePrompt(page));
    await fakePrompt(page);
    await page.evaluate(() => LEPwa.install());
    await page.waitForSelector('dialog.lp-choose[open]');
    await page.check('dialog.lp-choose input[value="' + app + '"]');
    await page.click('dialog.lp-choose [data-lp-go]');
    await until(page, () => (window.__prompts || []).length === 1, 8000, 'one prompt');
    const fired = await page.evaluate(() => window.__prompts[0]);
    h.assert(fired.endsWith(FILES[app]), url + ' → ' + app + ': the prompt fired with ' + fired + ' linked');
    await page.waitForSelector('dialog.lp-choose', { state: 'detached', timeout: 5000 });
    h.assert((await linked(page)).endsWith(FILES.suite), 'the page offers the suite again afterwards');
    await until(page, () => LE.downloads.keep().chosen, 5000, 'choice stored');
    const s = await page.evaluate(() => ({ apps: LEPwa.installedApps(), keep: LE.downloads.keep() }));
    h.assert(s.apps.includes(app), 'remembered as installed: ' + JSON.stringify(s));
    h.assert.equal(s.keep.keep.join(), app === 'suite' ? 'design,pdf,tools' : app, 'what is kept offline follows the app');
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['without an install prompt (Safari): a studio chosen elsewhere opens its page, keeps the choice and shows the steps there'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'small', { userAgent: IOS });
  await ready(page);
  await page.evaluate(() => LEPwa.install());
  await page.waitForSelector('dialog.lp-choose[open]');
  h.assert(/Add to Home Screen/.test(await page.textContent('dialog.lp-choose')), 'steps for Safari shown with the choices');
  await page.check('dialog.lp-choose input[value="design"]');
  h.assert(/Open the design studio/.test(await page.textContent('dialog.lp-choose [data-lp-go]')), 'offers to go to the design studio first');
  await Promise.all([page.waitForURL(/\/studio\//), page.click('dialog.lp-choose [data-lp-go]')]);
  await ready(page);
  await page.waitForSelector('dialog.lp-choose[open]');
  h.assert.equal(await page.$eval('dialog.lp-choose input:checked', (i) => i.value), 'design', 'the choice survived the trip');
  h.assert((await linked(page)).endsWith(FILES.design), 'the studio page now links LocalEditor Design, before Add to Home Screen');
  h.assert.equal(await page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-title"]').content), 'LE Design', 'home-screen title');
  h.assert(!/install=/.test(page.url()), 'the address is clean: ' + page.url());
  const t = await page.textContent('dialog.lp-choose');
  h.assert(/Add LocalEditor Design to your Home Screen|Add to Home Screen/.test(t) && /Share/.test(t), 'steps name the app: ' + t.slice(0, 200));
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  await shot(page, 'install-ios-design-steps-360');
  await page.click('dialog.lp-choose [data-lp-close].lp-btn');
  h.assert((await linked(page)).endsWith(FILES.design), 'Safari keeps the chosen link after the sheet closes');
  h.assert.noErrors(page);
};

cases['Firefox desktop: told honestly; no install entries, no nudge'] = async ({ browser, base, h }) => {
  const ff = await h.open(browser, base, '/studio/?install=design', 'desktop', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' });
  await ready(ff);
  h.assert.equal(await ff.evaluate(() => LEPwa.canInstall()), false, 'nothing to offer');
  await ff.waitForSelector('dialog.lp-choose[open]');
  h.assert(/Firefox cannot install web apps/.test(await ff.textContent('dialog.lp-choose')), 'says so');
  h.assert.noErrors(ff);
};

cases['per-app precache lists: the app shell, and not the other studio'] = async ({ h }) => {
  const parts = build.partsJSON();
  const pdfOnly = parts.parts.pdf.files, designOnly = parts.parts.design.files, core = parts.parts.core.files;
  const all = [].concat(...Object.values(parts.parts).map((p) => p.files));
  h.assert.equal(new Set(all).size, all.length, 'every file in exactly one part');
  const universe = build.precacheList().filter((u) => u !== './assets/data/packs.json');
  h.assert.equal(JSON.stringify(all.slice().sort()), JSON.stringify(universe.slice().sort()), 'the four parts are the whole first download, nothing more or less');
  const suite = build.precacheListFor('suite');
  h.assert.equal(JSON.stringify(suite), JSON.stringify(build.precacheList()), 'the suite (and a browser visit) download exactly what they did before');
  const d = build.precacheListFor('design'), p = build.precacheListFor('pdf');
  ['./studio/', './assets/js/le-studio.js', './assets/css/studio.css', './assets/js/le-objects.js', './assets/js/app.js', './assets/js/le-pwa.js', './offline.html', './', './manifest-design.webmanifest'].forEach((u) => h.assert(d.includes(u), 'design keeps ' + u));
  ['./pdf-studio/', './assets/js/le-pdf-studio.js', './assets/css/pdf-studio.css', './assets/js/le-pdf.js', './assets/vendor/pdf.worker.min.js', './assets/vendor/mammoth.browser.min.js', './assets/js/app.js', './offline.html', './manifest-pdf.webmanifest'].forEach((u) => h.assert(p.includes(u), 'PDF keeps ' + u));
  ['./pdf-studio/', './assets/js/le-pdf-studio.js', './assets/js/le-pdf-office.js', './assets/vendor/mammoth.browser.min.js', './merge-pdf/'].forEach((u) => h.assert(!d.includes(u), 'design leaves out ' + u));
  ['./studio/', './assets/js/le-studio.js', './assets/js/le-studio-panels.js', './assets/css/studio.css', './assets/js/le-makers.js', './image-compressor/'].forEach((u) => h.assert(!p.includes(u), 'PDF leaves out ' + u));
  h.assert(build.CRITICAL.filter((u) => u !== './studio/').every((u) => core.includes(u)), 'every critical file but the studio page is shared');
  h.assert(designOnly.length && pdfOnly.length && d.length < suite.length && p.length < suite.length, 'both studios are smaller than the suite');
  const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/packs.json'), 'utf8'));
  h.assert(pk.parts && pk.apps && pk.apps.design.parts.join() === 'core,design' && pk.apps.pdf.parts.join() === 'core,pdf', 'packs.json lists the parts and apps');
  ['core', 'design', 'pdf', 'tools'].forEach((id) => h.assert(Math.abs(pk.parts[id].transfer - parts.parts[id].transfer) <= Math.max(256 * 1024, parts.parts[id].transfer * 0.05), 'packs.json part ' + id + ' is stale: run node scripts/build.js'));
  h.assert(pk.apps.suite.transfer === pk.parts.core.transfer + pk.parts.design.transfer + pk.parts.pdf.transfer + pk.parts.tools.transfer, 'the suite is the four parts');
};

cases['a Design-only install works offline for the studio, a PDF link degrades politely, and the choice survives an update'] = async ({ browser, h }) => {
  const { server, state, base } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/studio/', 'desktop', { serviceWorkers: 'allow' });
    await controlled(page);
    await ready(page);
    /* Installed on its own (as appinstalled reports it): the PDF studio and the tools leave this device; the studio stays. */
    await page.evaluate(() => LE.downloads.chooseApp('design'));
    const k = await page.evaluate(async () => ({ keep: LE.downloads.keep(), marker: await (await caches.open('le-packs-v1')).match(location.origin + '/__packs/app').then((r) => r && r.json()) }));
    h.assert(k.keep.keep.join() === 'design' && k.marker && k.marker.keep.join() === 'design', 'kept where the worker reads it: ' + JSON.stringify(k));
    const gone = await page.evaluate(async () => [!!(await caches.match(location.origin + '/pdf-studio/')), !!(await caches.match(location.origin + '/assets/js/le-pdf-studio.js')), !!(await caches.match(location.origin + '/assets/js/le-studio.js'))]);
    h.assert(!gone[0] && !gone[1] && gone[2], 'PDF studio files removed, design studio kept: ' + gone);
    /* A new version downloads only the shared files and the design studio. */
    state.version = 'inst-2';
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await until(page, async () => { const ks = await caches.keys(); if (!ks.includes('le-app-inst-2')) return false; const c = await caches.open('le-app-inst-2'); return (await c.keys()).length > 50; }, 30000, 'the next version downloaded');
    await page.waitForTimeout(1500);
    const v2 = await page.evaluate(async () => { const c = await caches.open('le-app-inst-2'); const ks = (await c.keys()).map((r) => new URL(r.url).pathname); return { n: ks.length, studio: ks.includes('/studio/'), studioJs: ks.includes('/assets/js/le-studio.js'), pdf: ks.includes('/pdf-studio/'), pdfJs: ks.includes('/assets/js/le-pdf-office.js'), tool: ks.includes('/merge-pdf/') }; });
    h.assert(v2.studio && v2.studioJs && !v2.pdf && !v2.pdfJs && !v2.tool, 'the update follows the choice: ' + JSON.stringify(v2));
    /* Apply the update (no work open), reload, then go offline. */
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.waiting && r.waiting.postMessage({ type: 'le-skip-waiting' })));
    await until(page, async () => { const c = navigator.serviceWorker.controller; return c && /sw\.js/.test(c.scriptURL) && (await caches.keys()).indexOf('le-app-inst-1') < 0; }, 20000, 'the new version took over');
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    h.assert.equal(await page.evaluate(() => LE.downloads.keep().keep.join()), 'design', 'the choice survives the update');
    await page.context().setOffline(true);
    await page.goto(base + '/studio/?app=design', { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.LEStudio && window.LEStudio.scene), null, { timeout: 20000 });
    await page.goto(base + '/pdf-studio/', { waitUntil: 'load' });
    const t = await page.textContent('body');
    h.assert(/not on this device yet/i.test(t) && /The PDF studio is not kept offline on this device/.test(t), 'the PDF studio says politely that it is not kept here: ' + t.slice(0, 300));
    h.assert(await page.evaluate(() => [...document.querySelectorAll('#le-off-links li')].filter((li) => !li.hidden).every((li) => !/PDF studio|Merge PDF/.test(li.textContent))), 'links to pages that are not here are hidden');
    await page.context().setOffline(false);
    /* Online, a page that is not kept is saved as it is used. */
    await page.goto(base + '/merge-pdf/', { waitUntil: 'load' });
    await until(page, async () => !!(await caches.match(location.origin + '/merge-pdf/')), 8000, 'kept as used');
  } finally { server.close(); }
};

cases['Settings shows what is installed and kept, adds a studio and removes its offline files'] = async ({ browser, h }) => {
  const { server, base } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/studio/', 'small', { serviceWorkers: 'allow' });
    await controlled(page);
    await ready(page);
    /* LocalEditor Design was installed on this device (what the chooser records when the browser says so). */
    await page.evaluate(() => { localStorage.setItem('le-pwa', JSON.stringify({ apps: { design: Date.now() }, installedAt: Date.now(), offlineAt: 1 })); return LE.downloads.chooseApp('design'); });
    await page.evaluate(() => LEPwa.openStorage());
    await page.waitForSelector('[data-lp-downloads] [data-ld-part="pdf"]', { timeout: 15000 });
    let txt = await page.textContent('[data-lp-downloads]');
    h.assert(/Installed: Design studio only/.test(txt), 'says what is installed: ' + txt.slice(0, 200));
    h.assert(/Shared app files/.test(txt) && /PDF studio/.test(txt) && /Works online; saved as you use it/.test(txt), 'each part with its state');
    h.assert(/Design studio only/.test(await page.textContent('.lp-dl')), 'This device: installed row');
    h.assert(await h.noOverflow(page), 'no sideways scroll at 360 px');
    await page.$eval('[data-lp-downloads]', (el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, 'install-storage-parts-360');
    /* Add the PDF studio. */
    await page.click('[data-lp-downloads] [data-ld-part-add="pdf"]');
    await until(page, () => LE.downloads.parts().find((p) => p.id === 'pdf').state === 'done' && !!document.querySelector('[data-ld-part="pdf"][data-state="done"]'), 30000, 'PDF studio downloaded');
    h.assert(await page.evaluate(async () => !!(await caches.match(location.origin + '/assets/js/le-pdf-studio.js'))), 'its files are on the device');
    h.assert.equal(await page.evaluate(() => LE.downloads.keep().keep.join()), 'design,pdf', 'and kept from now on');
    /* Remove the PDF studio's offline files again (two taps, like the packs). */
    await page.click('[data-lp-downloads] [data-ld-part-rm="pdf"]');
    await page.click('[data-lp-downloads] [data-ld-part-rm="pdf"]');
    await until(page, async () => !(await caches.match(location.origin + '/assets/js/le-pdf-studio.js')) && LE.downloads.keep().keep.join() === 'design', 15000, 'removed');
    /* Keep everything: back to the suite's behaviour (no marker). */
    await page.click('[data-lp-downloads] [data-ld-part-all]');
    await until(page, async () => LE.downloads.keep().all && !(await (await caches.open('le-packs-v1')).match(location.origin + '/__packs/app')), 15000, 'everything kept');
    txt = await page.textContent('[data-lp-downloads]');
    h.assert(!/PWA|manifest|service worker|precache/i.test(txt), 'plain words');
    h.assert.noErrors(page);
  } finally { server.close(); }
};

cases['a PDF and a PDF workflow opened with LocalEditor PDF reach the PDF studio'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/pdf-studio/', 'desktop');
  await page.waitForFunction(() => window.LEPwa && window.PS && PS.addFiles);
  const pdf = fs.readFileSync(path.join(ROOT, 'tests/fixtures/pdf-office/contract-v1.pdf')).toString('base64');
  /* The same queue the system's file launch and the share sheet fill (launchQueue cannot be driven from a test). */
  await page.evaluate(async (b64) => {
    const c = await caches.open('le-share-v1');
    const bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
    await c.put(location.origin + '/__share/91/0', new Response(new Blob([bytes], { type: 'application/pdf' }), { headers: { 'content-type': 'application/pdf', 'x-le-name': 'contract.pdf' } }));
    const wf = JSON.stringify({ format: 'localeditor-pdf-workflow', version: '1.0', metadata: { name: 'Number it' }, steps: [{ operation: 'page-numbers' }] });
    await c.put(location.origin + '/__share/91/1', new Response(new Blob([wf], { type: 'application/json' }), { headers: { 'content-type': 'application/json', 'x-le-name': 'number-it.lepdfworkflow' } }));
  }, pdf);
  await page.goto(base + '/pdf-studio/?shared=91&app=pdf', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.PS && PS.S && PS.S.pages.length === 3, null, { timeout: 20000 });
  await page.waitForFunction(() => /Imported “Number it”/.test(document.body.textContent), null, { timeout: 10000 });
  h.assert(!/shared=/.test(page.url()), 'share id removed from the address');
  h.assert.noErrors(page);
};

cases['inside LocalEditor Design, a link to the PDF studio opens outside the app, never a dead end'] =async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/?app=design', 'desktop');
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => /display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q);
    window.__opened = [];
    window.open = (u, t) => { window.__opened.push([u, t]); return {}; };
  });
  await page.reload({ waitUntil: 'networkidle' });
  await ready(page);
  h.assert.equal(await page.evaluate(() => LEPwa.currentApp()), 'design', 'this window knows it is LocalEditor Design');
  h.assert.equal(await page.evaluate(() => LEPwa.canInstall()), false, 'no install entries inside an installed app');
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '../pdf-studio/'; a.id = 'x-pdf'; a.textContent = 'Edit a PDF'; a.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147483647'; document.body.appendChild(a); const b = a.cloneNode(true); b.id = 'x-in'; b.href = './?tool=collage'; b.style.top = '260px'; document.body.appendChild(b); });
  await page.click('#x-pdf');
  const opened = await page.evaluate(() => window.__opened);
  h.assert(opened.length === 1 && /\/pdf-studio\/$/.test(opened[0][0]) && opened[0][1] === '_blank', 'opens in a new window (the suite or PDF app when installed, else the browser): ' + JSON.stringify(opened));
  h.assert(/\/studio\//.test(page.url()), 'the design window stays in the studio');
  await page.evaluate(() => { document.getElementById('x-in').addEventListener('click', (e) => { window.__inside = !e.defaultPrevented; e.preventDefault(); }); });
  await page.click('#x-in');
  h.assert(await page.evaluate(() => window.__inside === true && window.__opened.length === 1), 'links inside the studio are left alone');
  h.assert.noErrors(page);
};

module.exports = cases;
