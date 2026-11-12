'use strict';
/* Storage manager (1.6): categories, clearing, versions, free up space, limits, erase, quota warnings, memory guard. */

/* Loads the projects database helpers on any page and seeds designs, versions, photos and caches. */
async function seed(page, opts) {
  opts = opts || {};
  await page.addScriptTag({ url: '/assets/js/le-engine.js' });
  await page.addScriptTag({ url: '/assets/js/le-project.js' });
  return page.evaluate(async (o) => {
    const P = window.LE.project;
    const png = async (w, h, color) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',60%,50%)'; x.fillRect((i * 53) % w, (i * 97) % h, 9, 9); }
      return new Promise((r) => c.toBlob(r, 'image/png'));
    };
    const used = await P.putAsset({ blob: await png(400, 300, '#c63'), name: 'used.png', width: 400, height: 300 });
    const unused = await P.putAsset({ blob: await png(300, 200, '#36c'), name: 'unused.png', width: 300, height: 200 });
    /* Age the unused photo past the 10-minute grace period. */
    await new Promise((res) => {
      const r = indexedDB.open('le-projects', 1);
      r.onsuccess = () => {
        const t = r.result.transaction('assets', 'readwrite');
        const s = t.objectStore('assets');
        s.get(unused.id).onsuccess = (e) => { const a = e.target.result; a.createdAt = Date.now() - 3600e3; s.put(a); };
        t.oncomplete = () => { r.result.close(); res(); };
      };
    });
    const doc = P.create({ name: 'Summer sale', width: 1080, height: 1080 });
    doc.assets[used.id] = used;
    doc.pages[0].layers.push({ id: 'l1', type: 'image', src: used.id, x: 0, y: 0, w: 400, h: 300 });
    await P.save(doc, { created: true });
    for (let i = 0; i < (o.versions || 12); i++) await P.snapshot(doc.id, '');
    await P.snapshot(doc.id, 'Named by me');
    const put = async (cache, url, bytes, at) => {
      const c = await caches.open(cache);
      const h = { 'content-type': 'application/octet-stream', 'x-le-bytes': String(bytes) };
      if (at) h['x-le-at'] = String(at);
      await c.put(location.origin + url, new Response(new Uint8Array(bytes), { headers: h }));
    };
    const day = 864e5;
    await put('le-fonts-v1', '/assets/fonts/library/inter/inter-400-latin.woff2', 40000, Date.now());
    await put('le-assets-v1', '/assets/data/withicons/clay.json', 2e6, Date.now());
    await put('le-assets-v1', '/assets/data/withicons/glass.json', 1.5e6, Date.now() - 120 * day);
    await put('le-photos-v1', '/assets/photos/collage/p01.jpg', 90000, Date.now() - 2 * day);
    {
      const m = await caches.open('le-models-v1');
      await m.put(location.origin + '/assets/models/u2netp.onnx', new Response(new Uint8Array(3e6), { headers: { 'content-type': 'application/octet-stream', 'content-length': '3000000', 'x-le-model': 'u2netp' } }));
      await put('le-models-v1', '/assets/vendor/ort/ort-wasm-simd-threaded.wasm', 1e6, Date.now());
    }
    await put('le-app-202601010000', '/index.html', 30000, Date.now());
    await put('le-app-202611120000', '/index.html', 30000, Date.now());
    localStorage.setItem('le-stock-keys', JSON.stringify({ pixabay: 'abcd1234wxyz', pexels: 'zzzz9999' }));
    localStorage.setItem('le-theme', 'light');
    return { id: doc.id, used: used.id, unused: unused.id };
  }, opts);
}
const report = (page) => page.evaluate(() => window.LEPwa.report().then((r) => {
  const o = {};
  r.categories.forEach((c) => { o[c.id] = { bytes: c.bytes, count: c.count, items: c.items.length, keys: (c.keys || []).length }; });
  return o;
}));

const cases = {};

cases['lists every category with sizes, counts and its own actions'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/image-compressor/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  await seed(page);
  const r = await report(page);
  ['app', 'fonts', 'packs', 'photos', 'models', 'projects', 'versions', 'unused', 'settings'].forEach((id) => h.assert(r[id], 'category ' + id));
  ['app', 'fonts', 'packs', 'photos', 'models', 'projects', 'versions', 'unused', 'settings'].forEach((id) => h.assert(r[id].bytes > 0, id + ' has a size'));
  h.assert.equal(r.packs.count, 2, 'two icon packs');
  h.assert.equal(r.models.count, 2, 'the background model and the shared AI engine');
  h.assert.equal(r.projects.count, 1, 'one design');
  h.assert.equal(r.versions.count, 13, 'thirteen versions');
  h.assert.equal(r.unused.count, 1, 'one unused image');
  h.assert.equal(r.settings.keys, 2, 'two API keys listed individually');
  await page.evaluate(() => window.LEPwa.openStorage());
  await page.waitForSelector('dialog.lp-storage .lp-cats');
  h.assert.equal(await page.$$eval('.lp-cat', (l) => l.length), 9, 'nine categories shown');
  const txt = await page.textContent('dialog.lp-storage');
  ['App files', 'Fonts', 'Icon and graphic packs', 'AI models', 'Your designs', 'Version history', 'Unused images', 'Settings and keys', 'Summer sale', 'Free up space', 'Keep my work safe'].forEach((s) => h.assert(txt.includes(s), 'shows "' + s + '"'));
  h.assert(!/service worker|indexeddb|cache storage/i.test(txt), 'no jargon in the UI');
  /* AI models are listed per model, each with its own remove button. */
  await page.click('.lp-cat[data-cat=models] summary');
  h.assert(/Background remover \(fast\)/.test(await page.textContent('.lp-cat[data-cat=models]')), 'model named for people');
  const before = await page.evaluate(() => caches.open('le-models-v1').then((c) => c.keys()).then((k) => k.length));
  await page.click('.lp-cat[data-cat=models] .lp-items li:has-text("Background remover") [data-lp-item]');
  await page.waitForFunction((n) => caches.open('le-models-v1').then((c) => c.keys()).then((k) => k.length === n - 1), before);
  h.assert(!(await page.evaluate(() => caches.open('le-models-v1').then((c) => c.match(location.origin + '/assets/models/u2netp.onnx')))), 'model removed, engine kept');
  /* Clear one API key on its own. */
  await page.click('.lp-cat[data-cat=settings] summary');
  await page.click('[data-lp-key=pixabay]');
  await page.waitForTimeout(400);
  const keys = await page.evaluate(() => JSON.parse(localStorage.getItem('le-stock-keys')));
  h.assert(!keys.pixabay && keys.pexels === 'zzzz9999', 'only the Pixabay key was cleared');
  h.assert.noErrors(page);
};

cases['clears a cache category from the UI after a confirmation'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'phone');
  await page.waitForFunction(() => window.LEPwa);
  await seed(page);
  await page.evaluate(() => window.LEPwa.openStorage());
  await page.waitForSelector('.lp-cats');
  await page.click('.lp-cat[data-cat=packs] summary');
  await page.click('[data-lp-clear=packs]');
  await page.waitForSelector('dialog.lp-confirm[open]');
  await page.click('dialog.lp-confirm [data-yes]');
  await page.waitForFunction(() => caches.open('le-assets-v1').then((c) => c.keys()).then((k) => k.length === 0));
  const r = await report(page);
  h.assert.equal(r.packs.bytes, 0, 'packs cleared');
  h.assert(r.fonts.bytes > 0 && r.models.bytes > 0, 'other categories untouched');
  h.assert(await h.noOverflow(page), 'no sideways scroll at phone width');
  h.assert.noErrors(page);
};

cases['trims version history to the last N per design and keeps named versions'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  const s = await seed(page, { versions: 12 });
  const res = await page.evaluate(() => window.LEPwa.trimVersions(5));
  h.assert.equal(res.count, 7, 'seven automatic versions removed');
  const left = await page.evaluate((id) => window.LE.project.versions(id).then((v) => ({ n: v.length, named: v.filter((x) => x.kind === 'checkpoint').length })), s.id);
  h.assert.equal(left.n, 6, 'five automatic + one named remain');
  h.assert.equal(left.named, 1, 'the named version is kept');
};

cases['free up space previews, then removes only safe things'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  const s = await seed(page);
  await page.evaluate(() => window.LEPwa.setLimits({ versions: 5, packDays: 60 }));
  const plan = await page.evaluate(() => window.LEPwa.plan().then((p) => ({ ids: p.items.map((i) => i.id), bytes: p.bytes })));
  ['unused', 'versions', 'packs', 'app-old'].forEach((id) => h.assert(plan.ids.includes(id), 'plan includes ' + id + ': ' + plan.ids));
  h.assert(plan.bytes > 1.5e6, 'plan shows how much it frees');
  await page.evaluate(() => window.LEPwa.openStorage());
  await page.click('[data-lp-free]');
  await page.waitForSelector('.lp-plan [data-go]');
  h.assert(/Free about/.test(await page.textContent('.lp-plan')), 'preview shown before anything is removed');
  h.assert.equal(await page.$$eval('.lp-storage .lp-primary', (l) => l.filter((b) => b.offsetParent).length), 1, 'one gold action while the preview is open');
  await page.click('.lp-plan [data-go]');
  await page.waitForFunction(() => !document.querySelector('.lp-plan'), null, { timeout: 15000 });
  const after = await page.evaluate(async (ids) => ({
    projects: (await window.LE.project.list()).length,
    unused: !!(await window.LE.project.assetRecord(ids.unused)),
    used: !!(await window.LE.project.assetRecord(ids.used)),
    glass: !!(await caches.open('le-assets-v1').then((c) => c.match(location.origin + '/assets/data/withicons/glass.json'))),
    clay: !!(await caches.open('le-assets-v1').then((c) => c.match(location.origin + '/assets/data/withicons/clay.json'))),
    model: !!(await caches.open('le-models-v1').then((c) => c.match(location.origin + '/assets/models/u2netp.onnx'))),
    versions: (await window.LE.project.versions(ids.id)).length
  }), s);
  h.assert(after.projects === 1 && after.used, 'the design and its photo stay');
  h.assert(!after.unused, 'unused photo removed');
  h.assert(!after.glass && after.clay, 'only the stale icon pack removed');
  h.assert(after.model, 'AI model kept');
  h.assert.equal(after.versions, 6, 'versions trimmed to 5 automatic + 1 named');
  h.assert.noErrors(page);
};

cases['limits are enforced automatically: least-used downloads go first'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  const kept = await page.evaluate(async () => {
    const c = await caches.open('le-photos-v1');
    for (let i = 0; i < 6; i++) {
      await c.put(location.origin + '/assets/photos/collage/p' + i + '.jpg', new Response(new Uint8Array(6 * 1048576), { headers: { 'x-le-bytes': String(6 * 1048576), 'x-le-at': String(Date.now() - (10 - i) * 864e5) } }));
    }
    window.LEPwa.setLimits({ budgetMB: 25 });
    await window.LEPwa.enforceLimits();
    return (await c.keys()).map((k) => k.url.split('/').pop());
  });
  h.assert.equal(kept.length, 4, '24 MB of 36 MB kept under a 25 MB budget');
  h.assert(!kept.includes('p0.jpg') && !kept.includes('p1.jpg') && kept.includes('p5.jpg'), 'the oldest went first: ' + kept);
  const d = await page.evaluate(() => window.LEPwa.limits());
  h.assert(d.versions > 0 && d.packDays >= 0 && d.budgetMB === 25, 'limits persisted');
};

cases['erase everything (double confirmation) leaves this browser empty'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  await seed(page);
  await page.evaluate(() => window.LEPwa.openStorage());
  await page.waitForSelector('[data-lp-erase]');
  await page.click('[data-lp-erase]');
  await page.click('dialog.lp-confirm [data-yes]');
  await page.waitForSelector('dialog.lp-confirm input');
  h.assert(await page.$eval('dialog.lp-confirm [data-yes]', (b) => b.disabled), 'second step needs typing');
  await page.fill('dialog.lp-confirm input', 'erase');
  await Promise.all([page.waitForURL(/erased=1/, { timeout: 15000 }), page.click('dialog.lp-confirm [data-yes]')]);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !indexedDB.databases || indexedDB.databases().then((l) => !l.some((d) => d.name === 'le-projects')), null, { timeout: 5000 }).catch(() => {});
  const left = await page.evaluate(async () => ({
    caches: await caches.keys(),
    ls: Object.keys(localStorage),
    dbs: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []
  }));
  h.assert.equal(left.caches.length, 0, 'no caches: ' + left.caches);
  h.assert.equal(left.ls.length, 0, 'no settings: ' + left.ls);
  h.assert(!left.dbs.includes('le-projects'), 'designs database deleted: ' + left.dbs);
  h.assert.noErrors(page);
};

cases['a storage-full error shows a clear warning; other errors do not'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'phone');
  await page.waitForFunction(() => window.LEPwa);
  h.assert.equal(await page.evaluate(() => window.LEPwa.reportQuotaError(new Error('Network down'))), false, 'ignores other errors');
  h.assert.equal(await page.evaluate(() => window.LEPwa.reportQuotaError(new DOMException('full', 'QuotaExceededError'))), true, 'recognises a quota error');
  await page.waitForSelector('.lp-notice-quota');
  await page.click('.lp-notice-quota .lp-primary');
  await page.waitForSelector('.lp-plan');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  h.assert.noErrors(page);
};

cases['storage opens from the shell, a deep link, and the studio settings'] = async ({ browser, base, h }) => {
  let page = await h.open(browser, base, '/?storage=1', 'phone');
  await page.waitForSelector('dialog.lp-storage[open]');
  page = await h.open(browser, base, '/merge-pdf/#storage', 'desktop', { colorScheme: 'dark' });
  await page.waitForSelector('dialog.lp-storage[open]');
  page = await h.open(browser, base, '/', 'desktop');
  await page.waitForFunction(() => window.LEPwa);
  const shell = await page.$('[data-le-storage]');
  if (shell) {
    await page.evaluate(() => document.querySelector('[data-le-storage]').click());
    await page.waitForSelector('dialog.lp-storage[open]');
  }
  const studio = await h.studioWithSample(browser, base, 'desktop');
  await h.openPanel(studio, 'settings');
  await studio.click('text=Manage all storage on this device');
  await studio.waitForSelector('dialog.lp-storage[open]');
  await studio.waitForSelector('.lp-cat[data-cat=projects]');
  h.assert(/Photo studio/.test(await studio.textContent('.lp-dl')), 'memory readout lists the studio');
  h.assert.noErrors(studio);
};

cases['memory guard lets studio bitmaps go in the background and redraws on return'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.waitForFunction(() => window.LEPwa && Object.keys(window.LEStudio.scene._imageCache || {}).length > 0, null, { timeout: 10000 });
  await page.evaluate(() => window.LEPwa.releaseMemory());
  h.assert.equal(await page.evaluate(() => Object.keys(window.LEStudio.scene._imageCache).length), 0, 'bitmaps released');
  await page.evaluate(() => window.LEPwa.restoreMemory());
  await page.waitForFunction(() => Object.keys(window.LEStudio.scene._imageCache).length > 0, null, { timeout: 10000 });
  const m = await page.evaluate(() => window.LEPwa.memory());
  h.assert(m.editors.some((e) => e.name === 'Photo studio' && e.stats && e.stats.photos >= 1), 'studio reports its image memory');
  h.assert.noErrors(page);
};

module.exports = cases;
