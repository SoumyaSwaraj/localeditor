'use strict';
/* The large background-remover options (assets/js/le-bgremove-pro.js) in the studio chooser: lazy loading, plain words,
 * grouping per device class, "not on this copy", large-download consent, free-space refusal, cancel, failure recovery.
 * The model files are not in the repository, so every request for assets/models/pro/* is answered by page.route here.
 * No test runs a real pro model: headless Chromium has only a software graphics adapter (SwiftShader, no fp16), on which
 * one 512 px run of the smallest model took about ten minutes (docs/research/background-remover-pro.md). */
const cases = {};
const PRO = ['birefnet-lite', 'birefnet', 'ben2'];
const JARGON = /BiRefNet|BEN2|fp16|int8|onnx|RAM|GB of memory|WebGPU|u2net|Swin/i;

/* gpu: 'f16' (graphics card with half precision), 'old' (no half precision), 'none' (no WebGPU). pro: 'present' | 'absent'. */
async function studio(browser, base, h, o) {
  o = Object.assign({ vp: 'desktop', gpu: 'f16', mem: 8, pro: 'present', open: false, space: null }, o || {});
  const V = h.VIEWPORTS[o.vp];
  const ctx = await browser.newContext({ viewport: { width: V.width, height: V.height }, isMobile: V.isMobile, hasTouch: V.hasTouch, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(({ gpu, mem, open }) => {
    try { localStorage.setItem('le-cutout-other', JSON.stringify(!!open)); } catch (e) { /* ignore */ }
    const adapter = gpu === 'none' ? undefined : { requestAdapter: async () => ({ features: new Set(gpu === 'f16' ? ['shader-f16'] : []), limits: {} }) };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: adapter });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => mem });
    if (navigator.storage && navigator.storage.estimate) {
      const real = navigator.storage.estimate.bind(navigator.storage);
      navigator.storage.estimate = () => (window.__space ? Promise.resolve(window.__space) : real());
    }
  }, { gpu: o.gpu, mem: o.mem, open: o.open });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.proHits = [];
  await page.route('**/assets/models/pro/**', async (route) => {
    const req = route.request();
    page.proHits.push(req.method() + ' ' + req.url().split('/').pop());
    if (page.onPro) return page.onPro(route);
    if (o.pro === 'absent') return route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' });
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: '' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene && window.LEStudioCutout);
  await page.evaluate(async () => {
    const b = await (await fetch('/assets/photos/collage/people-07.jpg')).blob();
    await LEStudio.newFromPhoto(new File([b], 'family.jpg', { type: 'image/jpeg' }));
    const l = LEStudio.scene.layers().find((x) => x.type === 'image');
    LEStudio.scene.select([l.id]);
  });
  await page.waitForTimeout(300);
  return page;
}
async function openOptions(page) {
  await page.evaluate(() => LEStudio.openPanel('cutout'));
  await page.waitForSelector('.sxc-go');
  await page.click('.sxc-other > summary');
  await page.waitForSelector('.sxc-ladder .sxc-opt', { timeout: 20000 });
  await page.waitForFunction((ids) => ids.every((id) => document.querySelector('.sxc-opt[data-model="' + id + '"]')), PRO, { timeout: 20000 });
}
/* Every card: id, group, visible text without the "About this option" details. */
function cards(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sxc-opt')].map((o) => {
    const t = o.cloneNode(true);
    t.querySelectorAll('.sxc-about').forEach((x) => x.remove());
    const group = o.closest('.sxc-ladder') ? 'ladder' : o.closest('.sxc-morechoices') ? 'more' : o.closest('.sxc-weak') ? 'weak' : o.closest('.sxc-missing') ? 'missing' : '?';
    return { id: o.dataset.model, group, text: t.textContent.replace(/\s+/g, ' ').trim(), name: o.querySelector('.sxc-ohead b').textContent,
      on: (o.querySelector('.sxc-pick[role="radio"]') || {}).getAttribute ? o.querySelector('.sxc-pick').getAttribute('aria-checked') : null, tryAnyway: /Try anyway/.test(o.textContent) };
  }));
}
const byGroup = (list, g) => list.filter((c) => c.group === g).map((c) => c.id);

cases['pro options load only when the options are opened, and speak plainly'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  await page.evaluate(() => LEStudio.openPanel('cutout'));
  await page.waitForSelector('.sxc-go');
  await page.waitForTimeout(800);
  const early = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /le-bgremove-pro|models\/pro|ort-webgpu/.test(u)));
  h.assert.equal(early.length + page.proHits.length, 0, 'Requested before the options were opened: ' + early.concat(page.proHits).join(', '));
  h.assert.equal(await page.evaluate(() => !!(window.LE.bgRemovePro)), false, 'Pro registry loaded too early');
  await page.click('.sxc-other > summary');
  await page.waitForFunction(() => document.querySelector('.sxc-opt[data-model="birefnet"]'), null, { timeout: 20000 });
  const list = await cards(page);
  h.assert.equal(list.length, 6, 'All six options reachable: ' + list.map((c) => c.id).join(','));
  list.forEach((c) => h.assert(!JARGON.test(c.text), 'Jargon on a card: ' + c.text));
  h.assert.equal(byGroup(list, 'ladder').join(','), 'u2netp,birefnet-lite,birefnet', 'Desktop ladder');
  h.assert.equal(list.filter((c) => c.group === 'ladder').map((c) => c.name).join(','), 'Quick,Better,Best');
  h.assert.equal(byGroup(list, 'more').sort().join(','), 'ben2,u2net-int8,u2net_human_seg-int8');
  h.assert.equal(list.filter((c) => /Recommended for this device/.test(c.text)).length, 1, 'One recommendation');
  h.assert.equal(list.filter((c) => c.on === 'true').map((c) => c.id).join(','), 'u2netp', 'Recommended option pre-selected');
  const lite = list.find((c) => c.id === 'birefnet-lite');
  h.assert(/Large one-time download \(about \d+ MB\)\. Best on Wi-Fi\. Stays on this device and works offline\./.test(lite.text), 'Download line: ' + lite.text);
  h.assert(/hair and fine edges/.test(lite.text), 'Purpose line: ' + lite.text);
  /* Technical facts stay behind "About this option". */
  const about = await page.evaluate(() => document.querySelector('.sxc-opt[data-model="birefnet"] .sxc-about').textContent);
  h.assert(/BiRefNet/.test(about) && /MIT/.test(about) && /bytes/.test(about), 'About: ' + about);
  /* Only HEAD probes so far: no model bytes until the person confirms. */
  h.assert(page.proHits.every((x) => /^HEAD /.test(x)), 'Model bytes fetched: ' + page.proHits.join(', '));
  h.assert.noErrors(page);
};

cases['device classes: ladder, folds and "Try anyway" follow what the device can run'] = async ({ browser, base, h }) => {
  /* A computer without WebGPU: pro options folded under "Needs a more powerful device", no Try anyway (it cannot run). */
  let page = await studio(browser, base, h, { gpu: 'none' });
  await openOptions(page);
  let list = await cards(page);
  h.assert.equal(byGroup(list, 'ladder').join(','), 'u2netp,u2net-int8', 'No-GPU ladder');
  h.assert.equal(byGroup(list, 'weak').sort().join(','), 'ben2,birefnet,birefnet-lite');
  list.filter((c) => c.group === 'weak').forEach((c) => {
    h.assert(/Needs a computer with a recent graphics card/.test(c.text), 'Weak line: ' + c.text);
    h.assert(!c.tryAnyway, 'Try anyway offered for a certain no: ' + c.id);
  });
  h.assert(await page.evaluate(() => !document.querySelector('.sxc-weak').open), 'The fold starts closed');
  await page.context().close();

  /* A graphics card without half precision: the same fold. */
  page = await studio(browser, base, h, { gpu: 'old' });
  await openOptions(page);
  list = await cards(page);
  h.assert.equal(byGroup(list, 'weak').sort().join(','), 'ben2,birefnet,birefnet-lite', 'Old GPU');
  h.assert(/too old/.test(await page.evaluate(() => document.querySelector('.sxc-opt[data-model="birefnet"] .sxc-about').textContent)), 'Reason in About');
  await page.context().close();

  /* A 4 GB phone with a modern graphics chip: the small large option runs, the big ones are folded with Try anyway. */
  page = await studio(browser, base, h, { vp: 'small', mem: 4 });
  await openOptions(page);
  list = await cards(page);
  h.assert.equal(byGroup(list, 'ladder')[0], 'u2netp');
  const weak = list.filter((c) => c.group === 'weak');
  h.assert(weak.some((c) => c.id === 'birefnet'), 'Best detail should be folded on a 4 GB phone: ' + JSON.stringify(list.map((c) => [c.id, c.group])));
  weak.forEach((c) => h.assert(c.tryAnyway && /May be too much for this phone/.test(c.text), 'Weak on phone: ' + c.text));
  h.assert.equal(await page.evaluate(() => LEStudioCutout.state().recommended), 'u2netp');
  h.assert(await h.noOverflow(page), 'Sideways scroll at 360 px');
  const small = await page.evaluate(() => [...document.querySelectorAll('.sxc-pick[role="radio"], .sxc-fold > summary, .sxc-other > summary, .sxc-link')]
    .filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().height)).filter((hh) => hh < 44));
  h.assert.equal(small.length, 0, 'Targets under 44 px: ' + small.join(','));
  h.assert.noErrors(page);
};

cases['a copy of the app without the large files says so instead of failing'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h, { pro: 'absent' });
  await openOptions(page);
  const list = await cards(page);
  h.assert.equal(byGroup(list, 'missing').sort().join(','), 'ben2,birefnet,birefnet-lite');
  list.filter((c) => c.group === 'missing').forEach((c) => {
    h.assert(/Not available on this copy of the app/.test(c.text) && !c.tryAnyway && c.on === null, 'Missing card: ' + JSON.stringify(c));
  });
  h.assert.equal(byGroup(list, 'ladder').join(','), 'u2netp,u2net-int8');
  h.assert(page.proHits.every((x) => /^HEAD /.test(x)), 'Only HEAD probes: ' + page.proHits.join(', '));
  h.assert.noErrors(page);
};

cases['large download: asks first, refuses without space, cancel keeps nothing, a failed run recovers'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  await openOptions(page);
  const BYTES = 60000000;
  await page.evaluate((bytes) => {
    LE.bgRemove.register({ id: 'fake-pro', label: 'Test large', bestFor: 'Best for testing', level: 'best', rank: 99, quality: 3, speed: 'slow', tier: 'pro', runtime: 'wasm',
      supportId: 'cutout.fake-pro', path: 'assets/models/pro/fake.onnx', bytes: bytes, memoryMB: 800, warmup: false, about: { model: 'Test' } });
  }, BYTES);
  const url = await page.evaluate(() => LE.bgRemove.model('fake-pro').url);
  const hasEntry = () => page.evaluate(async (u) => !!(await (await caches.open('le-models-v1')).match(u)), url);

  /* 1. Not enough free space: refused before any byte is fetched, with a plain message. */
  await page.evaluate(() => { window.__space = { quota: 100e6, usage: 90e6 }; });
  page.proHits.length = 0;
  await page.evaluate(() => LEStudioCutout.run(null, { model: 'fake-pro' }));
  h.assert.equal(await page.evaluate(() => (LEStudioCutout.state().error || {}).code), 'quota');
  await page.waitForSelector('.sxc-alert');
  h.assert(/Not enough free space/.test(await page.textContent('.sxc-alert')), 'Space message');
  h.assert(!page.proHits.some((x) => /^GET fake/.test(x)), 'Fetched despite no space');

  /* 2. With space: a confirmation first, still nothing fetched. */
  await page.evaluate(() => { window.__space = { quota: 10e9, usage: 1e9 }; });
  await page.evaluate(() => LEStudioCutout.run(null, { model: 'fake-pro' }));
  await page.waitForSelector('.sxc-confirm');
  const ask = await page.textContent('.sxc-confirm');
  h.assert(/Large one-time download \(about 6\d MB\)/.test(ask) && /Best on Wi-Fi/.test(ask) && /nothing half-finished is kept/.test(ask), 'Confirm text: ' + ask);
  h.assert(!JARGON.test(ask), 'Jargon in the question: ' + ask);
  h.assert(!page.proHits.some((x) => /^GET fake/.test(x)), 'Fetched before consent');
  await page.click('.sxc-confirm-no');
  h.assert(!(await page.$('.sxc-confirm')), 'Not now closes the question');

  /* 3. Cancel while downloading: nothing in the cache, design unchanged. */
  let release;
  const held = new Promise((r) => { release = r; });
  page.onPro = async (route) => {
    if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: '' });
    await held;
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(BYTES, 7) }).catch(() => {});
  };
  await page.evaluate(() => LEStudioCutout.run(null, { model: 'fake-pro' }));
  await page.click('.sxc-confirm-go');
  await page.waitForFunction(() => LEStudioCutout.state().running);
  await page.waitForTimeout(400);
  await page.evaluate(() => LEStudioCutout.cancel());
  release();
  await page.waitForFunction(() => !LEStudioCutout.state().running);
  await page.waitForTimeout(500);
  h.assert.equal(await hasEntry(), false, 'A cancelled download left a cache entry');
  h.assert(!(await page.evaluate(() => LEStudio.scene.layers().some((x) => x.cutout))), 'Cancel changed the design');
  h.assert(!(await page.evaluate(() => LE.support.history('cutout.fake-pro') && LE.support.history('cutout.fake-pro').fail)), 'Cancel was recorded as a device failure');

  /* 4. Full download (with progress) of a file the engine cannot run: plain message, worker gone, failure recorded. */
  page.onPro = (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(BYTES, 7) });
  await page.evaluate(() => { window.__stages = []; window.__t = setInterval(() => { const s = LEStudioCutout.state(); if (s.stage) window.__stages.push(s.stage); }, 5); });
  await page.evaluate(() => LEStudioCutout.run(null, { model: 'fake-pro', confirmed: true, quiet: true }));
  const r = await page.evaluate(() => { clearInterval(window.__t); return { st: LEStudioCutout.state(), stages: window.__stages, loaded: LE.bgRemove.isLoaded(), hist: LE.support.history('cutout.fake-pro') }; });
  h.assert(['engine', 'memory'].indexOf(r.st.error && r.st.error.code) >= 0, 'Error code: ' + JSON.stringify(r.st.error));
  h.assert.equal(r.loaded, null, 'The engine should be unloaded after a failure');
  h.assert(r.hist && r.hist.fail, 'Failure not recorded: ' + JSON.stringify(r.hist));
  h.assert(r.stages.some((s) => /Downloading · \d+ of 60 MB/.test(s)), 'No download progress: ' + [...new Set(r.stages)].join(' | '));
  h.assert.equal(await hasEntry(), true, 'A complete download should stay on the device');
  h.assert.equal(await page.evaluate(async (u) => +(await (await caches.open('le-models-v1')).match(u)).headers.get('content-length'), url), BYTES);
  await page.waitForSelector('.sxc-alert');
  h.assert(/Nothing was changed/.test(await page.textContent('.sxc-alert')), 'Plain failure message');
  /* After a failure the device check says so; "Remove from this device" frees the space. */
  h.assert(await page.evaluate(() => LE.bgRemove.remove('fake-pro')), 'Remove');
  h.assert.equal(await hasEntry(), false);
  h.assert.noErrors(page);
};

module.exports = cases;
