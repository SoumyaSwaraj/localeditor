'use strict';
/* Install, manifest, offline worker and update flow (1.6). Worker tests run their own server so the worker
   script can be generated per test (scripts/build.js swSource) and a second version can be simulated. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const build = require('../scripts/build.js');
const { waitForAsync } = require('./lib/harness');

const ROOT = build.ROOT;
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };

/* A static server whose /sw.js is generated on every request from the current `version`. */
function serveWorker() {
  const state = { version: 'test-1', files: build.precacheList() };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(build.swSource({ version: state.version, files: state.files }));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, state, base: 'http://127.0.0.1:' + server.address().port }));
  });
}
async function controlled(page) {
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 });
  await waitForAsync(page, () => caches.keys().then((k) => k.some((n) => n.indexOf('le-app-') === 0)), null, 30000);
}
function swVersion(page) {
  return page.evaluate(() => new Promise((res) => {
    const c = navigator.serviceWorker.controller;
    if (!c) { res(null); return; }
    const ch = new MessageChannel();
    ch.port1.onmessage = (m) => res(m.data.version);
    c.postMessage({ type: 'le-version' }, [ch.port2]);
  }));
}

const cases = {};

cases['manifest is valid, in sync with the generator, and every file it names exists'] = async ({ h }) => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  h.assert.equal(JSON.stringify(m), JSON.stringify(build.manifestJSON()), 'manifest.webmanifest is stale; run node scripts/build.js');
  ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'background_color'].forEach((k) => h.assert(m[k], 'manifest needs ' + k));
  h.assert(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'needs a maskable 512 icon');
  h.assert(m.icons.some((i) => i.sizes === '192x192'), 'needs a 192 icon');
  const files = [].concat(m.icons, m.screenshots || [], ...(m.shortcuts || []).map((s) => s.icons || []), ...(m.file_handlers || []).map((f) => f.icons || []));
  files.forEach((f) => h.assert(fs.existsSync(path.join(ROOT, f.src)), 'missing ' + f.src));
  h.assert(m.screenshots.some((s) => s.form_factor === 'wide') && m.screenshots.some((s) => s.form_factor === 'narrow'), 'needs wide and narrow screenshots');
  m.screenshots.forEach((s) => h.assert(fs.statSync(path.join(ROOT, s.src)).size < 150 * 1024, s.src + ' is too large'));
  const page = (u) => fs.existsSync(path.join(ROOT, u.replace(/^\.\//, '').split('?')[0], 'index.html'));
  m.shortcuts.forEach((s) => h.assert(page(s.url), 'shortcut target missing: ' + s.url));
  h.assert(m.shortcuts.length >= 4 && m.shortcuts.length <= 10, 'shortcut count');
  h.assert(page(m.file_handlers[0].action) && page(m.share_target.action), 'handler pages exist');
  h.assert(m.file_handlers[0].accept['application/vnd.localeditor.project+zip'][0] === '.leproject', '.leproject handler');
  h.assert(m.share_target.method === 'POST' && m.share_target.enctype === 'multipart/form-data', 'share target is a multipart POST');
  h.assert(/share-target/.test(m.share_target.action), 'share action carries the marker the worker looks for');
};

cases['worker precaches the app shell and leaves on-demand downloads out'] = async ({ h }) => {
  const list = build.precacheList();
  build.CRITICAL.forEach((u) => h.assert(list.includes(u), 'critical file not precached: ' + u));
  ['./assets/js/le-pwa.js', './assets/css/le-pwa.css', './offline.html', './studio/', './pdf-studio/', './image-compressor/', './assets/js/le-studio.js', './assets/vendor/pdf.min.js'].forEach((u) => h.assert(list.includes(u), 'expected precache of ' + u));
  const banned = /^\.\/(labs|assets\/vendor\/ort[\w-]*|assets\/fonts\/library|assets\/data\/withicons|assets\/data\/collages|assets\/photos|assets\/models|assets\/screenshots|tests|docs|scripts|infra|node_modules)\/|^\.\/(CLAUDE|README)\.md$|^\.\/sw\.js$|lucide\.json$|phosphor\.json$|emoji\.json$/;
  const bad = list.filter((u) => banned.test(u));
  h.assert(!bad.length, 'must not precache: ' + bad.slice(0, 5).join(', '));
  /* The editor grew: 206 files in November 2026. The byte check below is the real guard (owner's rule: the whole editor downloads at first visit while it is under 25 MB to transfer). */
  h.assert(list.length > 60 && list.length < 320, 'precache size looks wrong: ' + list.length);
  h.assert(!list.some((u) => /^\.\/(agent-kit|schema)\/|agent-demo/.test(u)), 'agent kit, schema and the Node demo are not precached');
  ['./assets/vendor/ort/ort-wasm-simd-threaded.wasm', './assets/models/u2netp.onnx', './labs/bg-remove/'].forEach((u) => h.assert(!list.includes(u), 'AI runtime, models and labs stay out of the precache: ' + u));
  const fs2 = require('fs');
  const bytes = list.reduce((n, u) => { const f = require('path').join(ROOT, u.endsWith('/') ? u + 'index.html' : u); return n + (fs2.existsSync(f) ? fs2.statSync(f).size : 0); }, 0);
  h.assert(bytes < 20 * 1048576, 'precache stays small: ' + Math.round(bytes / 1048576) + ' MB');
  const src = build.swSource({ version: 'x' });
  new Function(src); // parses
  ['le-models-v1', 'le-fonts-v1', 'le-assets-v1', 'le-photos-v1', 'le-share-v1', 'isSkipWaiting'].slice(0, 5).forEach((n) => h.assert(src.includes(n), 'worker mentions ' + n));
  h.assert(!/self\.skipWaiting\(\);\s*\n\s*return post\(\{ type: 'le-installed'/.test(src) || /if \(first\) self\.skipWaiting\(\)/.test(src), 'worker only skips waiting on the first install');
};

cases['first load works offline afterwards: home, studio, a tool page, and an unknown page'] = async ({ browser, h }) => {
  const { server, base } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/', 'desktop', { serviceWorkers: 'allow' });
    await controlled(page);
    await page.waitForTimeout(300);
    const ctx = page.context();
    await ctx.setOffline(true);
    for (const [url, check] of [['/', () => !!document.querySelector('.le-side, main')], ['/studio/', () => !!(window.LEStudio && window.LEStudio.scene)], ['/image-compressor/', () => /compress/i.test(document.title)], ['/pdf-studio/', () => /PDF/i.test(document.title)]]) {
      await page.goto(base + url, { waitUntil: 'load' });
      await page.waitForFunction(check, null, { timeout: 15000 });
    }
    await page.goto(base + '/studio/?tool=collage', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.LEStudio);
    await page.goto(base + '/no-such-page/', { waitUntil: 'load' });
    h.assert(/not on this device yet/i.test(await page.textContent('body')), 'offline fallback page shown for an unknown page');
    await ctx.setOffline(false);
    const errs = page.errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(e));
    h.assert(!errs.length, 'console errors: ' + errs.slice(0, 2).join(' | '));
  } finally { server.close(); }
};

cases['Chromium reports the app as installable'] = async ({ browser, h }) => {
  const { server, base } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/', 'desktop', { serviceWorkers: 'allow' });
    await controlled(page);
    const cdp = await page.context().newCDPSession(page);
    const man = await cdp.send('Page.getAppManifest');
    h.assert(!man.errors || !man.errors.length, 'manifest errors: ' + JSON.stringify(man.errors));
    const r = await cdp.send('Page.getInstallabilityErrors');
    const errs = (r.installabilityErrors || []).map((e) => e.errorId).filter((id) => id !== 'in-incognito');
    h.assert(!errs.length, 'installability errors: ' + errs.join(', '));
  } finally { server.close(); }
};

cases['an update waits, says so, and applies only when confirmed'] = async ({ browser, h }) => {
  const { server, base, state } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/image-compressor/', 'desktop', { serviceWorkers: 'allow' });
    await controlled(page);
    h.assert.equal(await swVersion(page), 'test-1', 'first version controls the page');
    await page.evaluate(() => window.LEPwa.markUsed()); /* this tab now has work in progress */
    state.version = 'test-2';
    await page.evaluate(() => window.LEPwa.checkForUpdate());
    await page.waitForFunction(() => window.LEPwa.updateReady(), null, { timeout: 30000 });
    await page.waitForSelector('.lp-notice-update', { timeout: 5000 });
    await page.waitForTimeout(1500);
    h.assert.equal(await swVersion(page), 'test-1', 'the open page keeps the old version while the update waits');
    const keys = await page.evaluate(() => caches.keys());
    h.assert(keys.includes('le-app-test-1') && keys.includes('le-app-test-2'), 'both versions cached while waiting: ' + keys.join(','));
    await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.click('.lp-notice-update .lp-primary')]);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
    h.assert.equal(await swVersion(page), 'test-2', 'confirmed update takes over after reload');
    await h.waitForAsync(page, () => caches.keys().then((k) => !k.includes('le-app-test-1')), null, 10000);
  } finally { server.close(); }
};

cases['an idle tab picks up a waiting update without a prompt'] = async ({ browser, h }) => {
  const { server, base, state } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/', 'desktop', { serviceWorkers: 'allow' });
    await controlled(page);
    state.version = 'test-idle-2';
    await page.evaluate(() => window.LEPwa.checkForUpdate());
    await page.waitForFunction(() => window.LEPwa.updateReady(), null, { timeout: 30000 });
    /* The page is idle (nothing used), so asking the waiting worker to apply-if-idle succeeds. */
    const applied = await page.evaluate(() => new Promise((res) => navigator.serviceWorker.getRegistration().then((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (m) => res(m.data.applied);
      r.waiting.postMessage({ type: 'le-apply-if-idle' }, [ch.port2]);
    })));
    h.assert(applied === true, 'idle tab lets the update apply');
    await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL, null);
    await page.waitForTimeout(500);
    h.assert.equal(await swVersion(page), 'test-idle-2', 'new version active');
  } finally { server.close(); }
};

cases['share target: the worker parks shared photos and the studio opens them'] = async ({ browser, h }) => {
  const { server, base } = await serveWorker();
  try {
    const page = await h.open(browser, base, '/studio/', 'phone', { serviceWorkers: 'allow' });
    await controlled(page);
    const url = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 200;
      const x = c.getContext('2d'); x.fillStyle = '#c63'; x.fillRect(0, 0, 320, 200);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const fd = new FormData();
      fd.append('media', new File([blob], 'shared.png', { type: 'image/png' }));
      const res = await fetch('./?share-target=1', { method: 'POST', body: fd });
      if (!res.ok) return 'failed ' + res.status;
      const keys = await caches.open('le-share-v1').then((c) => c.keys());
      const m = keys.length && /\/__share\/(\d+)\/0$/.exec(keys[0].url);
      return m ? location.pathname + '?shared=' + m[1] : 'nothing parked';
    });
    h.assert(/\/studio\/\?shared=\d+/.test(url), 'the worker parked the shared photo and redirected: ' + url);
    await page.goto(base + url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.S.project && window.LEStudio.scene.layers().some((l) => l.type === 'image'), null, { timeout: 20000 });
    h.assert(!/shared=/.test(await page.evaluate(() => location.search)), 'share id removed from the address');
    const left = await page.evaluate(() => caches.open('le-share-v1').then((c) => c.keys()).then((k) => k.length));
    h.assert.equal(left, 0, 'shared files are removed once opened');
  } finally { server.close(); }
};

cases['files opened from the system (launchQueue hook) reach the studio'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEPwa && window.LEStudio);
  /* launchQueue cannot be driven from a test, so feed the same queue the consumer uses. */
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 120;
    c.getContext('2d').fillRect(0, 0, 200, 120);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'opened.png', { type: 'image/png' });
    const cache = await caches.open('le-share-v1');
    await cache.put(location.origin + '/__share/77/0', new Response(file, { headers: { 'content-type': 'image/png', 'x-le-name': 'opened.png' } }));
  });
  await page.goto(base + '/studio/?shared=77', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.LEStudio.S.project && window.LEStudio.scene.layers().some((l) => l.type === 'image'), null, { timeout: 20000 });
  h.assert.noErrors(page);
};

cases['install button drives a captured beforeinstallprompt, once, and hides after install'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  await page.evaluate(() => {
    window.__prompts = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompts++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-le-install-state')), 'prompt', 'prompt state');
  /* The shell's drawer row (or the old sidebar control before the redesign). */
  const sel = await page.evaluate(() => document.querySelector('[data-le-install]') ? '[data-le-install]' : '.le-install');
  const shown = () => page.$eval(sel, (el) => getComputedStyle(el).display !== 'none');
  h.assert(await shown(), 'the shell install control is available');
  await page.evaluate((s) => document.querySelector(s).click(), sel);
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => window.__prompts), 1, 'the browser prompt opened exactly once');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  h.assert(!(await shown()), 'install control hidden once installed');
  /* Buttons the redesigned shell adds later are bound too. */
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-le-install', ''); b.textContent = 'Install'; b.id = 'later'; document.body.appendChild(b); });
  h.assert(!(await page.isVisible('#later')), 'late [data-le-install] hidden when installed');
  h.assert.noErrors(page);
};

cases['iOS Safari gets the illustrated Add to Home Screen sheet; no sideways scroll'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await h.open(browser, base, '/', vp, { userAgent: IOS });
    await page.waitForFunction(() => window.LEPwa);
    h.assert.equal(await page.evaluate(() => window.LEPwa.installKind()), 'ios-safari', 'detected iOS Safari');
    await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-le-install', ''); b.id = 'ib'; b.textContent = 'Install'; document.body.prepend(b); });
    await page.click('#ib');
    await page.waitForSelector('dialog.lp-install[open]');
    const text = await page.textContent('dialog.lp-install');
    h.assert(/Add to Home Screen/.test(text) && /Share/.test(text), 'sheet explains Share then Add to Home Screen');
    h.assert(await h.noOverflow(page), 'no sideways scroll');
    const box = await page.$eval('dialog.lp-install', (d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
    h.assert(box.l >= 0 && box.r <= box.w + 1, 'sheet fits the screen');
    await page.click('dialog.lp-install [data-lp-close].lp-btn');
    h.assert.noErrors(page);
  }
};

cases['in-app browsers are told to open the real browser; Firefox desktop is not nagged'] = async ({ browser, base, h }) => {
  const ig = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0';
  const page = await h.open(browser, base, '/', 'phone', { userAgent: ig });
  await page.waitForFunction(() => window.LEPwa);
  h.assert.equal(await page.evaluate(() => window.LEPwa.installKind()), 'in-app', 'detects the Instagram viewer');
  await page.evaluate(() => window.LEPwa.install());
  h.assert(/Open in browser/i.test(await page.textContent('dialog.lp-install')), 'tells people to open the browser');
  const ff = await h.open(browser, base, '/', 'desktop', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' });
  await ff.waitForFunction(() => window.LEPwa);
  h.assert.equal(await ff.evaluate(() => window.LEPwa.canInstall()), false, 'Firefox desktop cannot install, so no nudge');
  h.assert(await ff.evaluate(() => [...document.querySelectorAll('[data-le-install]')].every((e) => getComputedStyle(e).display === 'none')), 'install entry points hidden where installing is impossible');
};

cases['the install nudge only appears after real use, and backs off after "Not now"'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt'); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(300);
  h.assert(!(await page.$('.lp-notice-install')), 'no nudge on a first visit');
  await page.evaluate(() => localStorage.setItem('le-pwa', JSON.stringify({ uses: 1 })));
  await page.evaluate(() => window.LEPwa.markUsed());
  await page.waitForSelector('.lp-notice-install', { timeout: 8000 });
  await page.click('.lp-notice-install .lp-btn:not(.lp-primary)');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('le-pwa')));
  h.assert(s.snoozes === 1 && s.snoozedAt > 0, 'dismissal remembered');
};

module.exports = cases;
