'use strict';
/* LE.stock with every provider endpoint mocked through page.route (the real APIs are not reachable from the sandbox). */
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'stock');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

const KEYS = { pixabay: 'PIXKEY-9f3a1c77', pexels: 'PEXKEY-4b21d0aa', unsplash: 'UNSKEY-77ce02b1' };
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'X-Ratelimit-Limit, X-Ratelimit-Remaining, Retry-After'
};

async function jpegBuffer(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#7457f0'; x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#f4d7a1'; x.fillRect(100, 100, 400, 300);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/* Opens the studio (it loads le-engine.js + le-stock.js) and mocks every provider host. */
async function setup(browser, base, h, cfg) {
  cfg = cfg || {};
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LE && window.LE.stock);
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.text()));
  page.on('pageerror', (e) => page.logs.push(e.message));
  const jpeg = await jpegBuffer(page);
  const state = {
    calls: [],
    unsplash: { status: 200, headers: { 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '49' }, body: fixture('unsplash-search.json') },
    download: { status: 200, abort: false },
    pixabay: { status: 200, body: fixture('pixabay-search.json') },
    pexels: { status: 200, body: fixture('pexels-search.json') },
    openverse: { status: 200, body: fixture('openverse-search.json') }
  };
  Object.assign(state.unsplash, cfg.unsplash || {});
  Object.assign(state.download, cfg.download || {});
  const json = (route, status, body, extra) => route.fulfill({
    status, contentType: 'application/json', body, headers: Object.assign({}, CORS, extra || {})
  });
  await page.route(/^https:\/\/(api\.unsplash\.com|images\.unsplash\.com|pixabay\.com|api\.pexels\.com|images\.pexels\.com|api\.openverse\.org|upload\.wikimedia\.org|commons\.wikimedia\.org)\//, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    state.calls.push({ url: req.url(), host: url.hostname, path: url.pathname, query: url.searchParams, headers: req.headers() });
    if (url.hostname === 'api.unsplash.com' && url.pathname === '/search/photos') {
      return json(route, state.unsplash.status, state.unsplash.body, state.unsplash.headers);
    }
    if (url.hostname === 'api.unsplash.com' && /\/download$/.test(url.pathname)) {
      if (state.download.abort) return route.abort('failed');
      return json(route, state.download.status, JSON.stringify({ url: 'https://images.unsplash.com/photo-x' }));
    }
    if (url.hostname === 'pixabay.com' && url.pathname === '/api/') return json(route, state.pixabay.status, state.pixabay.body);
    if (url.hostname === 'api.pexels.com') return json(route, state.pexels.status, state.pexels.body);
    if (url.hostname === 'api.openverse.org' && url.pathname === '/v1/images/') return json(route, state.openverse.status, state.openverse.body);
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg, headers: CORS });
  });
  await page.evaluate((k) => { window.LE.stock.setKeys(k); }, cfg.keys || KEYS);
  state.searches = (host) => state.calls.filter((c) => c.host === host && !/\/download$/.test(c.path) && /search|\/api\/|\/v1\/images\/$/.test(c.path));
  state.downloads = () => state.calls.filter((c) => /\/download$/.test(c.path));
  return { page, state };
}

const stockOf = (page, fn, arg) => page.evaluate(fn, arg);

module.exports = {
  'providers() metadata is complete for all four providers': async ({ browser, base, h }) => {
    const { page } = await setup(browser, base, h, { keys: {} });
    const list = await stockOf(page, () => LE.stock.providers());
    h.assert.equal(list.map((p) => p.id).join(','), 'pixabay,pexels,openverse,unsplash');
    const strs = ['id', 'name', 'keyLabel', 'keyHelpUrl', 'keyHint', 'creditText', 'creditUrl', 'termsUrl', 'status'];
    list.forEach((p) => {
      strs.forEach((k) => h.assert(typeof p[k] === 'string' && p[k], p.id + ' missing ' + k));
      h.assert(typeof p.needsKey === 'boolean' && typeof p.hasKey === 'boolean', p.id + ' booleans');
      h.assert(/^https:\/\//.test(p.keyHelpUrl) && /^https:\/\//.test(p.creditUrl) && /^https:\/\//.test(p.termsUrl), p.id + ' urls');
      h.assert(p.supports && p.supports.orientation === true && p.supports.page === true, p.id + ' supports');
      h.assert(['ok', 'needs-key', 'rate-limited', 'error'].indexOf(p.status) >= 0, p.id + ' status ' + p.status);
    });
    const by = {}; list.forEach((p) => { by[p.id] = p; });
    h.assert.equal(by.openverse.needsKey, false);
    h.assert.equal(by.openverse.status, 'ok');
    ['pixabay', 'pexels', 'unsplash'].forEach((id) => {
      h.assert.equal(by[id].needsKey, true);
      h.assert.equal(by[id].hasKey, false);
      h.assert.equal(by[id].status, 'needs-key');
    });
    h.assert.equal(by.unsplash.keyLabel, 'Access Key');
    h.assert(/Pexels/.test(by.pexels.creditText), 'Pexels credit text');
    h.assert(by.unsplash.creditUrl.indexOf('utm_source=localeditor') > 0, 'Unsplash credit link has UTM');
    await page.evaluate((k) => LE.stock.setKeys(k), KEYS);
    const after = await stockOf(page, () => LE.stock.providers());
    after.filter((p) => p.needsKey).forEach((p) => { h.assert(p.hasKey && p.status === 'ok', p.id + ' should be ok with a key'); });
    // Existing fields still resolve.
    h.assert(await page.evaluate(() => ['keys', 'setKeys', 'search', 'registerOpenverse', 'tokenOpenverse', 'rateLimit', 'sizedImportUrl', 'fetchBlob', 'compress', 'importHit', 'quota'].every((f) => typeof LE.stock[f] === 'function')), 'API surface');
  },

  'search normalises Pixabay, Pexels and Openverse': async ({ browser, base, h }) => {
    const { page, state } = await setup(browser, base, h);
    const px = await stockOf(page, () => LE.stock.search('flower', { provider: 'pixabay' }));
    h.assert.equal(px.hits.length, 1);
    const a = px.hits[0];
    h.assert.equal(a.provider, 'pixabay');
    h.assert.equal(a.id, '195893');
    h.assert.equal(a.thumb, 'https://pixabay.com/get/g1a2b3c4d5e6f_640.jpg');
    h.assert.equal(a.importUrl, 'https://pixabay.com/get/g1a2b3c4d5e6f_1280.jpg');
    h.assert.equal(a.photographer, 'Josch13');
    h.assert.equal(a.license, 'Pixabay Content License');
    h.assert.equal(a.attribution, 'Photo by Josch13 on Pixabay');
    h.assert.equal(a.filesize, 1853070);
    h.assert.equal(px.total, 500);
    const pe = await stockOf(page, () => LE.stock.search('rock', { provider: 'pexels' }));
    const b = pe.hits[0];
    h.assert.equal(b.provider, 'pexels');
    h.assert(/h=350$/.test(b.thumb) && /dpr=2/.test(b.importUrl), 'pexels thumb/import');
    h.assert(b.importUrl.indexOf('original') < 0, 'never src.original');
    h.assert.equal(b.attribution, 'Photo by Joey Farina on Pexels');
    h.assert.equal(b.license, 'Pexels License');
    h.assert.equal(pe.total, 8000);
    const pexCall = state.calls.find((c) => c.host === 'api.pexels.com');
    h.assert.equal(pexCall.headers.authorization, KEYS.pexels);
    const ov = await stockOf(page, () => LE.stock.search('cat', { provider: 'openverse' }));
    h.assert.equal(ov.hits.length, 1, 'mature result dropped');
    const c = ov.hits[0];
    h.assert.equal(c.provider, 'openverse');
    h.assert.equal(c.license, 'by-sa');
    h.assert.equal(c.filesize, 8000000);
    h.assert(/Alvesgaspar/.test(c.attribution), 'openverse attribution');
    h.assert.equal(ov.total, 10000);
    ['id', 'provider', 'thumb', 'importUrl', 'w', 'h', 'photographer', 'pageUrl', 'license', 'attribution', 'filesize'].forEach((k) => {
      h.assert(k in a && k in b && k in c, 'shape key ' + k);
    });
  },

  'Unsplash search: request, auth header and normalised hits': async ({ browser, base, h }) => {
    const { page, state } = await setup(browser, base, h);
    const res = await stockOf(page, () => LE.stock.search('lake', { provider: 'unsplash', page: 2, orientation: 'horizontal' }));
    const calls = state.calls.filter((c) => c.path === '/search/photos');
    h.assert.equal(calls.length, 1);
    const q = calls[0].query;
    h.assert.equal(calls[0].host, 'api.unsplash.com');
    h.assert.equal(q.get('query'), 'lake');
    h.assert.equal(q.get('page'), '2');
    h.assert.equal(q.get('per_page'), '20');
    h.assert.equal(q.get('orientation'), 'landscape');
    h.assert.equal(q.get('content_filter'), 'high');
    h.assert.equal(calls[0].headers.authorization, 'Client-ID ' + KEYS.unsplash);
    h.assert.equal(calls[0].headers['accept-version'], 'v1');
    h.assert(calls[0].url.indexOf(KEYS.unsplash) < 0, 'key must not be in the URL');
    h.assert.equal(res.hits.length, 2);
    h.assert.equal(res.total, 133);
    h.assert.equal(res.page, 2);
    const hit = res.hits[0];
    h.assert.equal(hit.provider, 'unsplash');
    h.assert.equal(hit.id, 'eOLpJytrbsQ');
    h.assert(/w=400/.test(hit.thumb) && hit.thumb.indexOf('images.unsplash.com') > 0, 'thumb is urls.small');
    h.assert.equal(hit.w, 4000);
    h.assert.equal(hit.h, 2667);
    h.assert.equal(hit.photographer, 'Ada Lovelace');
    h.assert.equal(hit.license, 'Unsplash License');
    h.assert.equal(hit.attribution, 'Photo by Ada Lovelace on Unsplash');
    h.assert.equal(hit.pageUrl, 'https://unsplash.com/photos/a-mountain-lake-at-sunrise-eOLpJytrbsQ?utm_source=localeditor&utm_medium=referral');
    h.assert.equal(hit.photographerUrl, 'https://unsplash.com/@ada_lens?utm_source=localeditor&utm_medium=referral');
    h.assert(/^https:\/\/api\.unsplash\.com\/photos\/eOLpJytrbsQ\/download/.test(hit.downloadLocation), 'downloadLocation kept');
    h.assert.equal(hit.filesize, null);
    const imp = new URL(hit.importUrl);
    h.assert.equal(imp.searchParams.get('w'), String(await page.evaluate(() => LE.perf && LE.perf.previewMax ? LE.perf.previewMax() : 1600)));
    h.assert.equal(imp.searchParams.get('fit'), 'max');
    h.assert.equal(imp.searchParams.get('q'), '80');
    h.assert.equal(imp.searchParams.get('fm'), 'jpg');
    h.assert(imp.searchParams.get('ixid'), 'ixid kept');
    h.assert(imp.searchParams.get('crop') === null, 'no crop param');
    const r2 = await stockOf(page, () => LE.stock.search('lake', { provider: 'unsplash', orientation: 'square', perPage: 99 }));
    const last = state.calls.filter((c) => c.path === '/search/photos').pop();
    h.assert.equal(last.query.get('orientation'), 'squarish');
    h.assert.equal(last.query.get('per_page'), '30');
    h.assert(r2.hits.length === 2, 'second search');
  },

  'sizedImportUrl handles Unsplash': async ({ browser, base, h }) => {
    const { page } = await setup(browser, base, h);
    const out = await page.evaluate(() => {
      const raw = 'https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.0.3';
      return {
        a: LE.stock.sizedImportUrl({ provider: 'unsplash', importUrl: raw }, 1200),
        b: LE.stock.sizedImportUrl({ provider: 'unsplash', importUrl: raw + '&w=9000&q=99&fm=png&crop=entropy&dpr=2' }, 800),
        c: LE.stock.sizedImportUrl({ importUrl: raw }, 640),
        d: LE.stock.sizedImportUrl({ provider: 'unsplash', importUrl: 'https://images.unsplash.com/photo-2' }, 500)
      };
    });
    const u = (s) => new URL(s);
    h.assert.equal(u(out.a).searchParams.get('w'), '1200');
    h.assert.equal(u(out.a).searchParams.get('fit'), 'max');
    h.assert.equal(u(out.a).searchParams.get('q'), '80');
    h.assert.equal(u(out.a).searchParams.get('fm'), 'jpg');
    h.assert.equal(u(out.a).searchParams.get('ixid'), 'abc');
    h.assert.equal(u(out.b).searchParams.get('w'), '800');
    h.assert.equal(u(out.b).searchParams.getAll('w').length, 1);
    h.assert.equal(u(out.b).searchParams.get('q'), '80');
    h.assert.equal(u(out.b).searchParams.get('fm'), 'jpg');
    h.assert(u(out.b).searchParams.get('crop') === null && u(out.b).searchParams.get('dpr') === null, 'stale params removed');
    h.assert.equal(u(out.c).searchParams.get('w'), '640', 'recognised by host without provider');
    h.assert.equal(u(out.d).searchParams.get('w'), '500');
  },

  'importHit pings Unsplash download_location exactly once': async ({ browser, base, h }) => {
    const { page, state } = await setup(browser, base, h);
    const res = await stockOf(page, () => LE.stock.search('lake', { provider: 'unsplash' }));
    h.assert.equal(state.downloads().length, 0, 'searching does not ping');
    const out = await page.evaluate((hit) => LE.stock.importHit(hit).then((r) => ({ type: r.type, w: r.width, source: r.source, size: r.blob.size })), res.hits[0]);
    await page.waitForTimeout(300);
    h.assert(out.size > 0 && out.w > 0, 'imported a file');
    h.assert.equal(out.source.provider, 'unsplash');
    h.assert.equal(out.source.attribution, 'Photo by Ada Lovelace on Unsplash');
    const pings = state.downloads();
    h.assert.equal(pings.length, 1, 'exactly one ping');
    h.assert.equal(pings[0].url, res.hits[0].downloadLocation);
    h.assert.equal(pings[0].headers.authorization, 'Client-ID ' + KEYS.unsplash);
    h.assert.equal(pings[0].headers['accept-version'], 'v1');
    const img = state.calls.find((c) => c.host === 'images.unsplash.com');
    h.assert(img && img.query.get('fit') === 'max' && img.query.get('w'), 'import used the sized raw URL');
    // Other providers never ping.
    const pex = await stockOf(page, () => LE.stock.search('rock', { provider: 'pexels' }));
    await page.evaluate((hit) => LE.stock.importHit(hit), pex.hits[0]);
    await page.waitForTimeout(200);
    h.assert.equal(state.downloads().length, 1, 'no ping for pexels');
  },

  'a failing download ping does not break the import': async ({ browser, base, h }) => {
    const { page, state } = await setup(browser, base, h, { download: { abort: true } });
    const res = await stockOf(page, () => LE.stock.search('lake', { provider: 'unsplash' }));
    const out = await page.evaluate((hit) => LE.stock.importHit(hit).then((r) => r.blob.size), res.hits[0]);
    await page.waitForTimeout(300);
    h.assert(out > 0, 'import still resolved');
    h.assert.equal(state.downloads().length, 1);
    state.download.abort = false;
    state.download.status = 500;
    const out2 = await page.evaluate((hit) => LE.stock.importHit(hit).then((r) => r.blob.size), res.hits[1]);
    await page.waitForTimeout(200);
    h.assert(out2 > 0, 'import resolved on a 500 ping');
    // A tampered downloadLocation must never receive the key.
    const before = state.calls.length;
    await page.evaluate((hit) => LE.stock.importHit(Object.assign({}, hit, { downloadLocation: 'https://evil.example/steal' })), res.hits[0]);
    await page.waitForTimeout(200);
    h.assert(!state.calls.slice(before).some((c) => c.host === 'evil.example'), 'no ping to a foreign host');
  },

  '401 puts the provider in needs-key and clears the saved key': async ({ browser, base, h }) => {
    for (const id of ['unsplash', 'pexels']) {
      const { page, state } = await setup(browser, base, h);
      state[id].status = 401;
      if (id === 'unsplash') state.unsplash.body = JSON.stringify({ errors: ['OAuth error: The access token is invalid'] });
      const err = await page.evaluate((p) => LE.stock.search('x', { provider: p }).then(() => null, (e) => ({ status: e.status, provider: e.provider, message: e.message })), id);
      h.assert(err && err.status === 401 && err.provider === id, id + ' rejects with status 401');
      const meta = await page.evaluate((p) => LE.stock.providers().filter((x) => x.id === p)[0], id);
      h.assert.equal(meta.status, 'needs-key');
      h.assert.equal(meta.hasKey, false);
      h.assert.equal(await page.evaluate((p) => LE.stock.keys()[p], id), '');
    }
    // Unsplash 403 without rate-limit signals is also a bad key.
    const { page, state } = await setup(browser, base, h, { unsplash: { status: 403, headers: { 'x-ratelimit-remaining': '31' }, body: '{"errors":["Forbidden"]}' } });
    const err = await page.evaluate(() => LE.stock.search('x', { provider: 'unsplash' }).then(() => null, (e) => e.status));
    h.assert.equal(err, 401);
    h.assert.equal((await page.evaluate(() => LE.stock.providers().filter((x) => x.id === 'unsplash')[0])).status, 'needs-key');
    h.assert(state.calls.length === 1, 'one request');
  },

  'rate limit puts Unsplash in backoff without more requests': async ({ browser, base, h }) => {
    const variants = [
      { name: '403 remaining 0', unsplash: { status: 403, headers: { 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '0' }, body: 'Rate Limit Exceeded' } },
      { name: '403 body only', unsplash: { status: 403, headers: {}, body: '{"errors":["Rate Limit Exceeded"]}' } },
      { name: '429 retry-after', unsplash: { status: 429, headers: { 'retry-after': '120' }, body: '{}' } }
    ];
    for (const v of variants) {
      const { page, state } = await setup(browser, base, h, { unsplash: v.unsplash });
      const e1 = await page.evaluate(() => LE.stock.search('x', { provider: 'unsplash' }).then(() => null, (e) => ({ status: e.status, retry: e.retryAfter })));
      h.assert(e1 && e1.status === 429 && e1.retry > 0, v.name + ': 429 with retryAfter');
      const meta = await page.evaluate(() => LE.stock.providers().filter((x) => x.id === 'unsplash')[0]);
      h.assert.equal(meta.status, 'rate-limited', v.name);
      h.assert.equal(meta.hasKey, true, v.name + ': key kept');
      h.assert.equal(await page.evaluate(() => LE.stock.keys().unsplash), KEYS.unsplash, v.name + ': key kept in storage');
      if (v.unsplash.headers['retry-after']) h.assert.equal(e1.retry, 120);
      const n = state.calls.length;
      const e2 = await page.evaluate(() => LE.stock.search('x', { provider: 'unsplash' }).then(() => null, (e) => ({ status: e.status, message: e.message })));
      h.assert(e2 && e2.status === 429, v.name + ': guarded');
      h.assert.equal(state.calls.length, n, v.name + ': no network while cooling down');
      // Other providers are unaffected.
      const ok = await page.evaluate(() => LE.stock.search('rock', { provider: 'pexels' }).then((r) => r.hits.length));
      h.assert.equal(ok, 1);
    }
  },

  'quota() exposes Unsplash X-Ratelimit headers': async ({ browser, base, h }) => {
    const { page } = await setup(browser, base, h);
    h.assert.equal(await page.evaluate(() => LE.stock.quota('unsplash')), null);
    await page.evaluate(() => LE.stock.search('lake', { provider: 'unsplash' }));
    const q = await page.evaluate(() => LE.stock.quota('unsplash'));
    h.assert.equal(q.limit, 50);
    h.assert.equal(q.remaining, 49);
    h.assert(q.at > 0, 'timestamp');
    const res = await page.evaluate(() => LE.stock.search('lake', { provider: 'unsplash' }));
    h.assert(res.limit && res.limit['x-ratelimit-remaining'] === '49', 'search result carries limit headers');
  },

  'keys never reach the console or error messages': async ({ browser, base, h }) => {
    const { page, state } = await setup(browser, base, h);
    const errors = [];
    const attempt = async (provider, mutate) => {
      if (mutate) mutate();
      const msg = await page.evaluate((p) => LE.stock.search('x', { provider: p }).then(() => '', (e) => String(e && e.message) + ' ' + String(e && e.stack || '')), provider);
      errors.push(msg);
    };
    await page.evaluate(() => LE.stock.search('lake', { provider: 'unsplash' }));
    await page.evaluate(() => LE.stock.search('flower', { provider: 'pixabay' }));
    await page.evaluate(() => LE.stock.search('rock', { provider: 'pexels' }));
    const hit = (await page.evaluate(() => LE.stock.search('lake', { provider: 'unsplash' }))).hits[0];
    await page.evaluate((x) => LE.stock.importHit(x), hit);
    state.pixabay.status = 401; state.pixabay.body = '{"error":"[ERROR 400] Invalid key"}';
    await attempt('pixabay');
    state.pexels.status = 401;
    await attempt('pexels');
    state.unsplash.status = 403; state.unsplash.headers = { 'x-ratelimit-remaining': '0' }; state.unsplash.body = 'Rate Limit Exceeded';
    await attempt('unsplash');
    await page.evaluate((k) => LE.stock.setKeys(k), KEYS);
    state.unsplash.status = 500; state.unsplash.body = '{}';
    await attempt('unsplash');
    state.pexels.status = 500; state.pexels.body = '{}';
    await attempt('pexels');
    state.download.abort = true;
    await page.evaluate((x) => LE.stock.importHit(x), hit);
    await page.waitForTimeout(300);
    const text = errors.join('\n') + '\n' + page.logs.join('\n');
    Object.keys(KEYS).forEach((k) => h.assert(text.indexOf(KEYS[k]) < 0, k + ' key leaked into console or an error message'));
    h.assert(errors.every((m) => m.trim().length > 3), 'errors carried a readable message');
  },

  'search without a key rejects with the re-enter signal for Unsplash': async ({ browser, base, h }) => {
    const { page, state } = await setup(browser, base, h, { keys: {} });
    const err = await page.evaluate(() => LE.stock.search('x', { provider: 'unsplash' }).then(() => null, (e) => ({ status: e.status, provider: e.provider })));
    h.assert(err && err.status === 401 && err.provider === 'unsplash', 'missing key -> 401');
    h.assert.equal(state.calls.length, 0, 'no request without a key');
    const empty = await page.evaluate(() => LE.stock.search('  ', { provider: 'unsplash' }).then(() => '', (e) => e.message));
    h.assert(/search term/i.test(empty), 'empty query rejected');
  }
};
