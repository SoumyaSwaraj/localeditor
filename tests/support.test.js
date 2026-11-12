'use strict';
/* Device support checks (S1): probes, the feature registry, verdict rules, the gate sheet, suggestions per
   operating system, badges and the /device-check/ page. */
const cases = {};

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_0; en_US)'
};
const AVAILABLE = {
  ios: ['Safari', 'Chrome', 'Edge', 'Firefox'], android: ['Chrome', 'Edge', 'Samsung Internet', 'Firefox'],
  windows: ['Chrome', 'Edge', 'Firefox'], mac: ['Safari', 'Chrome', 'Edge', 'Firefox'], linux: ['Chrome', 'Edge', 'Firefox']
};

async function ready(page) { await page.waitForFunction(() => window.LE && window.LE.support && window.LE.support.version); }
async function openAt(browser, base, h, url, viewport, opts) {
  const page = await h.open(browser, base, url || '/about/', viewport || 'desktop', opts);
  await ready(page);
  return page;
}

cases['probes answer true, false or null and never throw, even when APIs are deleted or throw'] = async ({ browser, base, h }) => {
  const page = await openAt(browser, base, h, '/about/', 'desktop');
  const ids = await page.evaluate(() => LE.support.caps());
  const need = ['wasm', 'wasm-simd', 'wasm-threads', 'worker', 'offscreen-canvas', 'compression-stream', 'web-share', 'web-share-files', 'clipboard-write-image', 'clipboard-read',
    'media-recorder', 'media-recorder-mp4', 'media-recorder-webm', 'canvas-capture-stream', 'webcodecs-video-encoder', 'camera', 'file-system-access', 'file-handling', 'launch-queue',
    'indexeddb', 'cache-storage', 'service-worker', 'persistent-storage', 'storage-estimate', 'eyedropper', 'webgpu', 'webgl2', 'canvas-max-area', 'createimagebitmap', 'avif-encode',
    'webp-encode', 'install-prompt', 'touch', 'pointer-fine', 'device-memory-4gb', 'cpu-cores', 'secure-context', 'in-app-browser', 'standalone'];
  need.forEach((id) => h.assert(ids.indexOf(id) >= 0, 'missing capability ' + id));
  const r = await page.evaluate(() => LE.support.probeAll().then((all) => ({ all, mc: LE.support.maxCanvas(), why: LE.support.why('wasm-threads') })));
  Object.keys(r.all).forEach((k) => h.assert(r.all[k] === true || r.all[k] === false || r.all[k] === null, k + ' gave ' + r.all[k]));
  h.assert.equal(r.all['wasm-threads'], false, 'the site is not cross-origin isolated');
  h.assert.equal(r.why, 'not-isolated', 'wasm-threads explains isolation');
  h.assert(r.mc.side >= 2048 && r.mc.area > 0, 'maxCanvas gives numbers');
  h.assert.noErrors(page);

  /* Delete or break the APIs before any script runs. */
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    const kill = (o, k) => { try { delete o[k]; } catch (e) {} try { Object.defineProperty(o, k, { value: undefined, configurable: true, writable: true }); } catch (e) {} };
    ['WebAssembly', 'OffscreenCanvas', 'CompressionStream', 'MediaRecorder', 'VideoEncoder', 'EyeDropper', 'ClipboardItem', 'showSaveFilePicker', 'createImageBitmap', 'Worker', 'indexedDB', 'caches'].forEach((k) => kill(window, k));
    const thrower = { get() { throw new Error('boom'); }, configurable: true };
    try { Object.defineProperty(Navigator.prototype, 'deviceMemory', thrower); } catch (e) {}
    try { Object.defineProperty(Navigator.prototype, 'storage', thrower); } catch (e) {}
    try { Object.defineProperty(Navigator.prototype, 'gpu', { get() { return { requestAdapter() { throw new Error('gpu boom'); } }; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(Navigator.prototype, 'canShare', { value() { throw new Error('share boom'); }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(Navigator.prototype, 'share', { value() {}, configurable: true }); } catch (e) {}
    HTMLCanvasElement.prototype.toDataURL = function () { throw new Error('tainted'); };
  });
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(base + '/about/', { waitUntil: 'networkidle' });
  await ready(p2);
  const r2 = await p2.evaluate(() => LE.support.probeAll().then((all) => ({ all, mem: (() => { try { return LE.support.memoryGB(); } catch (e) { return 'threw'; } })(), check: LE.support.checkAll().length })));
  Object.keys(r2.all).forEach((k) => h.assert(r2.all[k] === true || r2.all[k] === false || r2.all[k] === null, k + ' gave ' + r2.all[k]));
  ['wasm', 'offscreen-canvas', 'compression-stream', 'media-recorder', 'eyedropper', 'clipboard-write-image', 'worker', 'indexeddb', 'cache-storage', 'web-share-files'].forEach((k) => {
    h.assert.equal(r2.all[k], false, k + ' should be false once deleted');
  });
  h.assert(r2.all.webgpu !== true, 'a throwing adapter request is not reported as working');
  h.assert(r2.all['webp-encode'] !== true, 'a throwing encoder is not reported as working');
  h.assert(r2.check > 20, 'checks still run');
  h.assert(!errs.length, 'page errors: ' + errs.join(' | '));
};

cases['verdict rules: missing need, unknown need, wants, memory, success and failure'] = async ({ browser, base, h }) => {
  const page = await openAt(browser, base, h, '/about/', 'desktop');
  const r = await page.evaluate(() => {
    const S = LE.support;
    S.forget();
    S.define({ id: 't.need', name: 'Need test', group: 'tools', needs: ['eyedropper'], wants: [] });
    S.define({ id: 't.want', name: 'Want test', group: 'tools', needs: ['canvas-2d'], wants: ['eyedropper'] });
    S.define({ id: 't.null', name: 'Null test', group: 'tools', needs: ['webgpu'], wants: [] });
    S.define({ id: 't.degraded', name: 'Degraded test', group: 'tools', needs: ['eyedropper'], degraded: 'A simpler picker still works.' });
    S.define({ id: 't.mem', name: 'Detailed model', group: 'ai', needs: ['canvas-2d'], memoryMB: 1000 });
    S.define({ id: 't.ok', name: 'Fine', group: 'tools', needs: ['canvas-2d'] });
    S.override('eyedropper', false);
    S.override('webgpu', null);
    const out = {};
    ['t.need', 't.want', 't.null', 't.degraded', 't.mem', 't.ok'].forEach((id) => { out[id] = S.check(id); });
    S.reportSuccess('t.need');
    out.afterSuccess = S.check('t.need');
    S.reportFailure('t.ok', new Error('out of memory'));
    out.afterFail = S.check('t.ok');
    out.unknownFeature = S.check('t.nope');
    S.override('eyedropper'); S.override('webgpu');
    return out;
  });
  h.assert.equal(r['t.need'].status, 'unsupported');
  h.assert.equal(r['t.need'].canForce, false, 'a definitely missing API with no fallback cannot be forced');
  h.assert.equal(r['t.need'].missing[0], 'eyedropper');
  h.assert(/pick colours/.test(r['t.need'].reasons[0]) && !/EyeDropper/.test(r['t.need'].reasons.join(' ')), 'plain reason, no API name');
  h.assert.equal(r['t.want'].status, 'limited');
  h.assert.equal(r['t.want'].canForce, true);
  h.assert.equal(r['t.null'].status, 'unknown');
  h.assert.equal(r['t.null'].canForce, true, 'ambiguity never blocks');
  h.assert.equal(r['t.degraded'].status, 'unsupported');
  h.assert.equal(r['t.degraded'].canForce, true, 'a degraded path can be forced');
  h.assert.equal(r['t.ok'].status, 'ok');
  h.assert.equal(r['t.mem'].status, 'ok', 'a desktop with plenty of memory');
  h.assert.equal(r.afterSuccess.status, 'ok', 'a recorded success is ok');
  h.assert.equal(r.afterFail.status, 'limited');
  h.assert(/did not work last time/.test(r.afterFail.reasons[0]), 'a recorded failure warns');
  h.assert.equal(r.unknownFeature.status, 'unknown');

  /* Memory: low memory warns; unknown memory never blocks. */
  for (const [mem, ua] of [[2, UA.android], [undefined, UA.iphone], [undefined, UA.linux]]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', userAgent: ua });
    await ctx.addInitScript((m) => { Object.defineProperty(Navigator.prototype, 'deviceMemory', { get() { return m; }, configurable: true }); }, mem);
    const p = await ctx.newPage();
    await p.goto(base + '/about/', { waitUntil: 'networkidle' });
    await ready(p);
    const v = await p.evaluate(() => { LE.support.define({ id: 't.mem', name: 'Detailed model', group: 'ai', needs: ['canvas-2d'], memoryMB: 1000 }); return LE.support.check('t.mem'); });
    h.assert(v.status !== 'unsupported', 'memory never blocks (' + mem + ')');
    h.assert(v.canForce, 'memory verdicts can be forced');
    if (mem === 2) { h.assert.equal(v.status, 'limited'); h.assert(/may not have enough memory for the detailed model \(needs about 1 GB\)/i.test(v.reasons.join(' ')), v.reasons.join(' ')); }
    if (mem === undefined && ua === UA.iphone) h.assert.equal(v.status, 'unknown', 'unknown memory on a phone is ambiguity');
    if (mem === undefined && ua === UA.linux) h.assert.equal(v.status, 'ok', 'unknown memory on a computer is fine');
    await ctx.close();
  }
  h.assert.noErrors(page);
};

cases['definitions pushed before and after the module loads are both picked up'] = async ({ browser, base, h }) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    (window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push({ id: 'cutout.fast', name: 'Fast cut-out', group: 'On-device AI', needs: ['wasm', 'worker'], wants: ['wasm-simd'], memoryMB: 400, downloadMB: 7.1, note: 'Early' });
  });
  const page = await ctx.newPage();
  await page.goto(base + '/about/', { waitUntil: 'networkidle' });
  await ready(page);
  const r = await page.evaluate(() => {
    (window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push({ id: 'export.replay', name: 'Process replay', group: 'Sharing', needs: ['canvas-capture-stream', 'media-recorder'], wants: ['media-recorder-mp4'] });
    LE.support.define({ id: 'export.copy', name: 'Copy image (owner)', group: 'Sharing', needs: ['clipboard-write-image'] });
    return { fast: LE.support.get('cutout.fast'), replay: LE.support.get('export.replay'), copy: LE.support.get('export.copy').name, n: LE.support.features().length, check: LE.support.check('cutout.fast').status };
  });
  h.assert(r.fast && r.fast.note === 'Early' && r.fast.group === 'On-device AI', 'early definition kept');
  h.assert(r.replay && r.replay.needs.length === 2, 'late definition picked up');
  h.assert.equal(r.copy, 'Copy image (owner)', 'an owner definition replaces the built-in one');
  h.assert(['ok', 'limited'].indexOf(r.check) >= 0);
  /* A built-in definition never replaces an owner's. */
  const kept = await page.evaluate(() => { LE.support.define({ id: 'export.copy', name: 'Copy image (owner 2)', needs: [] }); return LE.support.get('export.copy').name; });
  h.assert.equal(kept, 'Copy image (owner 2)');
  await ctx.close();
};

cases['gate runs at once when ok, asks otherwise, and remembers "Try anyway"'] = async ({ browser, base, h }) => {
  const page = await openAt(browser, base, h, '/about/', 'phone');
  await page.evaluate(() => {
    LE.support.forget();
    LE.support.define({ id: 't.ok', name: 'Fine', needs: ['canvas-2d'] });
    LE.support.define({ id: 't.maybe', name: 'Maybe', needs: ['webgpu'] });
    LE.support.define({ id: 't.no', name: 'Never', needs: ['eyedropper'] });
    LE.support.override('webgpu', null);
    LE.support.override('eyedropper', false);
    window.ran = [];
  });
  /* ok: runs, no sheet. */
  const v = await page.evaluate(() => LE.support.gate('t.ok', { run: () => { ran.push('ok'); return 42; } }).then((x) => ({ x, sheet: !!document.querySelector('.ls-gate') })));
  h.assert.equal(v.x, 42); h.assert.equal(v.sheet, false, 'no sheet when ok');
  /* unknown: sheet; cancel does not run. */
  await page.evaluate(() => { window.cancelled = 0; window.p1 = LE.support.gate('t.maybe', { run: () => ran.push('maybe'), onCancel: () => { cancelled++; } }); });
  await page.waitForSelector('dialog.ls-gate[open]');
  h.assert(await page.isVisible('dialog.ls-gate [data-ls-run]'), 'Try anyway shown');
  await page.click('dialog.ls-gate [data-ls-cancel]');
  await page.evaluate(() => p1);
  h.assert.equal(await page.evaluate(() => ran.indexOf('maybe')), -1, 'cancel does not run');
  h.assert.equal(await page.evaluate(() => cancelled), 1, 'onCancel called');
  /* Try anyway runs, then is remembered for the session. */
  await page.evaluate(() => { window.p2 = LE.support.gate('t.maybe', { run: () => ran.push('maybe') }); });
  await page.waitForSelector('dialog.ls-gate[open]');
  await page.click('dialog.ls-gate [data-ls-run]');
  await page.evaluate(() => p2);
  h.assert(await page.evaluate(() => ran.indexOf('maybe') >= 0), 'Try anyway runs');
  const again = await page.evaluate(() => LE.support.gate('t.maybe', { run: () => ran.push('maybe2') }).then(() => ({ sheet: !!document.querySelector('dialog.ls-gate[open]'), ran: ran.indexOf('maybe2') >= 0, forced: LE.support.check('t.maybe').forced })));
  h.assert(again.ran && !again.sheet, 'remembered choice skips the sheet');
  h.assert.equal(again.forced, 'session');
  /* Definitely missing, no fallback: only OK, nothing runs. */
  await page.evaluate(() => { window.p3 = LE.support.gate('t.no', { run: () => ran.push('no') }); });
  await page.waitForSelector('dialog.ls-gate[open]');
  h.assert.equal(await page.$('dialog.ls-gate [data-ls-run]'), null, 'no Try anyway for a definite missing API');
  h.assert(await h.noOverflow(page));
  await page.click('dialog.ls-gate [data-ls-cancel]');
  await page.evaluate(() => p3);
  h.assert.equal(await page.evaluate(() => ran.indexOf('no')), -1);
  /* A failing forced run is recorded locally. */
  await page.evaluate(() => { LE.support.forget(); LE.support.override('webgpu', null); window.p4 = LE.support.gate('t.maybe', { run: () => { throw new Error('oom'); } }).catch(() => 'failed'); });
  await page.waitForSelector('dialog.ls-gate[open]');
  await page.check('dialog.ls-gate [data-ls-never]');
  await page.click('dialog.ls-gate [data-ls-run]');
  h.assert.equal(await page.evaluate(() => p4), 'failed');
  const after = await page.evaluate(() => ({ c: LE.support.check('t.maybe'), stored: JSON.parse(localStorage.getItem('le-support')) }));
  h.assert(/did not work last time/.test(after.c.reasons.join(' ')), 'failure remembered');
  h.assert(after.stored.never['t.maybe'], '"Don\'t ask again" stored on the device');
  h.assert.noErrors(page);
};

cases['suggestions only name browsers available on this operating system'] = async ({ browser, base, h }) => {
  const plan = [['iphone', 'ios'], ['iphoneChrome', 'ios'], ['android', 'android'], ['androidFirefox', 'android'], ['windows', 'windows'], ['mac', 'mac'], ['linux', 'linux'], ['instagram', 'ios']];
  for (const [ua, os] of plan) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', userAgent: UA[ua] });
    const page = await ctx.newPage();
    await page.goto(base + '/about/', { waitUntil: 'networkidle' });
    await ready(page);
    const r = await page.evaluate(() => {
      const S = LE.support;
      const caps = Object.keys(S.matrix);
      caps.forEach((c) => S.override(c, false));
      const out = S.checkAll().map((x) => ({ id: x.id, suggest: x.suggest }));
      caps.forEach((c) => S.override(c));
      S.override('eyedropper', false);
      const eye = S.check('studio.eyedropper');
      S.override('eyedropper', true);
      const fine = S.check('studio.eyedropper');
      S.override('eyedropper');
      return { out, env: S.env(), eye, fine };
    });
    h.assert.equal(r.env.os, os, ua + ' detected as ' + r.env.os);
    r.out.forEach((x) => x.suggest.forEach((s) => {
      if (s.browser) h.assert(AVAILABLE[os].indexOf(s.browser) >= 0, ua + ': ' + s.browser + ' is not available on ' + os + ' (' + x.id + ')');
      if (os === 'ios' && ua !== 'instagram') h.assert(!s.browser, 'never suggest another browser on iOS: ' + s.browser);
    }));
    h.assert.equal(r.fine.suggest.length, 0, 'nothing to suggest when it already works');
    if (os === 'windows') h.assert(r.eye.suggest.some((s) => s.browser === 'Edge'), 'Windows Chrome without eyedropper suggests Edge');
    if (os === 'ios') h.assert(r.eye.suggest.every((s) => !s.browser || ua === 'instagram'), 'iOS: works on a computer instead');
    if (os === 'linux') h.assert(!r.eye.suggest.some((s) => s.browser === 'Firefox' || s.browser === 'Safari'), 'no Firefox or Safari for the eyedropper');
    await ctx.close();
  }
};

cases['badges and annotate decorate data-le-feature elements without hiding them'] = async ({ browser, base, h }) => {
  const page = await openAt(browser, base, h, '/about/', 'desktop');
  const r = await page.evaluate(() => {
    LE.support.forget();
    LE.support.define({ id: 't.no', name: 'Never', needs: ['eyedropper'] });
    LE.support.override('eyedropper', false);
    const b = document.createElement('button');
    b.textContent = 'Pick'; b.setAttribute('data-le-feature', 't.no'); b.setAttribute('data-le-badge', '');
    window.clicks = 0;
    b.addEventListener('click', () => { clicks++; });
    document.querySelector('main').appendChild(b);
    LE.support.annotate(document);
    const desc = document.getElementById(b.getAttribute('aria-describedby').split(' ').pop());
    return { state: b.getAttribute('data-le-support'), visible: b.offsetParent !== null, desc: desc && desc.textContent, badge: b.querySelector('.ls-badge') && b.querySelector('.ls-badge').textContent, ok: LE.support.badge('studio.core').textContent };
  });
  h.assert.equal(r.state, 'unsupported');
  h.assert(r.visible, 'never hidden');
  h.assert(/Not available/.test(r.desc), 'aria description explains it');
  h.assert.equal(r.badge, 'Not available in this browser');
  h.assert.equal(r.ok, 'Runs well here');
  await page.click('[data-le-feature="t.no"]');
  await page.waitForSelector('dialog.ls-gate[open]');
  h.assert.equal(await page.evaluate(() => clicks), 0, 'tap explains instead of running');
  await page.click('dialog.ls-gate [data-ls-cancel]');
  h.assert.noErrors(page);
};

for (const vp of ['desktop', 'phone']) {
  cases['/device-check/ lists every feature with no errors, no outside requests and no sideways scroll (' + vp + ')'] = async ({ browser, base, h }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: vp === 'phone', hasTouch: vp === 'phone' });
    await ctx.addInitScript(() => { (window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push({ id: 'scan.camera', name: 'Scan with the camera', group: 'PDF studio', needs: ['camera'], wants: [] }); });
    const page = await ctx.newPage();
    const outside = [], errors = [];
    page.on('request', (rq) => { if (!rq.url().startsWith(base) && !/^(data|blob):/.test(rq.url())) outside.push(rq.url()); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/device-check/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.ls-device');
    const r = await page.evaluate(() => ({
      ids: LE.support.features().map((f) => f.id),
      rows: [].map.call(document.querySelectorAll('.ls-row'), (x) => x.getAttribute('data-feature')),
      groups: [].map.call(document.querySelectorAll('.ls-group h2'), (x) => x.textContent),
      title: document.title, desc: !!document.querySelector('meta[name="description"]'), canon: !!document.querySelector('link[rel="canonical"]'), h1: document.querySelectorAll('h1').length
    }));
    r.ids.forEach((id) => h.assert(r.rows.indexOf(id) >= 0, 'missing row ' + id));
    h.assert(r.rows.indexOf('scan.camera') >= 0, 'owner definition listed');
    ['Photo studio', 'PDF studio', 'Sharing', 'Offline and install', 'On-device AI', 'Tools'].forEach((g) => h.assert(r.groups.indexOf(g) >= 0, 'group ' + g));
    h.assert(r.desc && r.canon && r.h1 === 1 && /device/i.test(r.title), 'SEO basics');
    h.assert(await h.noOverflow(page), 'no sideways scroll');
    h.assert(!outside.length, 'outside requests: ' + outside.join(', '));
    h.assert(!errors.length, 'console errors: ' + errors.join(' | '));
    await ctx.close();
  };
}

cases['the copied report is plain text'] = async ({ browser, base, h }) => {
  const page = await openAt(browser, base, h, '/device-check/', 'desktop');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.waitForSelector('[data-ls-copy]');
  await page.click('[data-ls-copy]');
  await page.waitForTimeout(400);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const direct = await page.evaluate(() => LE.support.reportText());
  [text, direct].forEach((t) => {
    h.assert(/^LocalEditor device check/.test(t), 'starts with a title');
    h.assert(!/<[a-z][^>]*>/i.test(t), 'no markup');
    h.assert(/Browser: /.test(t) && /Photo studio/.test(t) && /\[ok\] /.test(t), 'has the device and features');
  });
  h.assert.noErrors(page);
};

cases['footer, storage manager and studio settings link to the device check'] = async ({ browser, base, h }) => {
  const page = await openAt(browser, base, h, '/about/', 'desktop');
  h.assert(await page.$('.site-footer a[href="../device-check/"]'), 'footer link');
  await page.waitForFunction(() => window.LEPwa);
  await page.evaluate(() => LEPwa.openStorage());
  await page.waitForSelector('.lp-storage a[href="../device-check/"]', { timeout: 8000 });
  const studio = await h.studioWithSample(browser, base, 'phone');
  await ready(studio);
  await h.openPanel(studio, 'settings');
  await studio.click('.ls-settings-row');
  await studio.waitForSelector('dialog.ls-sheet[open] .ls-row', { timeout: 8000 });
  h.assert(await h.noOverflow(studio));
  h.assert.noErrors(studio);
};

module.exports = cases;
