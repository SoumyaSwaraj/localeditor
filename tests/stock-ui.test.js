'use strict';
/* Stock photo UI (Uploads → Stock photos, the replace sheet, the keys sheet) against mocked providers. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'X-Ratelimit-Limit, X-Ratelimit-Remaining, Retry-After'
};

async function jpeg(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const x = c.getContext('2d'); x.fillStyle = '#7f9fb5'; x.fillRect(0, 0, 640, 480); x.fillStyle = '#e2b15a'; x.fillRect(120, 90, 300, 220);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}
function ovPage(page, total) {
  const results = [];
  for (let i = 0; i < 20 && (page - 1) * 20 + i < total; i++) {
    const n = (page - 1) * 20 + i;
    results.push({ id: 'ov-' + n, title: 'Photo ' + n, url: 'https://api.openverse.org/img/' + n + '.jpg', thumbnail: 'https://api.openverse.org/thumb/' + n + '.jpg', creator: 'Maker ' + n, license: 'by', width: 640, height: 480, foreign_landing_url: 'https://example.org/p/' + n, attribution: '"Photo ' + n + '" by Maker ' + n + ' is licensed under CC BY 2.0.', mature: false });
  }
  return JSON.stringify({ result_count: total, page_count: Math.ceil(total / 20), page, results });
}
/* Studio with every stock host mocked. cfg: { keys, ov: { status, total }, pexels: { status } }. */
async function setup(browser, base, h, viewport, cfg) {
  cfg = cfg || {};
  const page = await h.studioWithSample(browser, base, viewport || 'desktop');
  await h.need(page, ['stock', 'collage']);
  const img = await jpeg(page);
  const st = { calls: [], ov: Object.assign({ status: 200, total: 60 }, cfg.ov || {}), pexels: Object.assign({ status: 200 }, cfg.pexels || {}), abort: false };
  await page.route(/^https:\/\/(api\.openverse\.org|pixabay\.com|api\.pexels\.com|images\.pexels\.com|api\.unsplash\.com|images\.unsplash\.com)\//, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    st.calls.push({ host: url.hostname, path: url.pathname, q: url.searchParams, method: req.method() });
    if (st.abort) return route.abort('failed');
    const json = (status, body, extra) => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body), headers: Object.assign({}, CORS, extra || {}) });
    if (url.pathname === '/v1/images/') {
      if (st.ov.status !== 200) return json(st.ov.status, { detail: 'Request was throttled.' }, { 'retry-after': '30' });
      return json(200, ovPage(Number(url.searchParams.get('page') || 1), st.ov.total));
    }
    if (url.pathname === '/v1/auth_tokens/register/') return json(201, { client_id: 'CLIENTID-abcd1234', client_secret: 'SECRET-zz9876', name: 'LocalEditor on this device', msg: 'Check your email for a verification link.' });
    if (url.pathname === '/v1/auth_tokens/token/') return json(200, { access_token: 'TOKEN-xyz', token_type: 'Bearer', expires_in: 36000, scope: 'read write' });
    if (url.pathname === '/v1/rate_limit/') return json(200, { requests_this_minute: 3, requests_today: 12, rate_limit_model: 'standard', verified: true });
    if (url.hostname === 'api.pexels.com') {
      if (st.pexels.status !== 200) return json(st.pexels.status, { error: 'Rate limit exceeded' }, { 'retry-after': '60' });
      return json(200, { total_results: 1, photos: [{ id: 1, width: 640, height: 480, url: 'https://www.pexels.com/photo/1/', photographer: 'Pex Person', src: { medium: 'https://images.pexels.com/m.jpg', large2x: 'https://images.pexels.com/l.jpg' } }] });
    }
    if (url.hostname === 'pixabay.com' && url.pathname === '/api/') return json(200, { total: 1, totalHits: 1, hits: [{ id: 7, webformatURL: 'https://pixabay.com/get/w.jpg', largeImageURL: 'https://pixabay.com/get/l.jpg', imageWidth: 640, imageHeight: 480, user: 'Pixa Person', pageURL: 'https://pixabay.com/photos/7/' }] });
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: img, headers: CORS });
  });
  await page.evaluate((k) => { localStorage.removeItem('le-stock-provider'); LE.stock.setKeys(k); }, cfg.keys || { pixabay: '', pexels: '', unsplash: '' });
  return { page, st };
}
const searches = (st, host) => st.calls.filter((c) => c.host === host && /\/v1\/images\/$|\/api\/$|\/search/.test(c.path));
async function openStock(page, h, provider) {
  if (provider) await page.evaluate((p) => localStorage.setItem('le-stock-provider', p), provider);
  await h.openPanel(page, 'uploads', { tab: 'stock' });
}

const cases = {};

cases['provider chips come from LE.stock.providers(), with needs-key states and credit lines'] = async ({ browser, base, h }) => {
  const { page, st } = await setup(browser, base, h);
  await openStock(page, h, 'openverse');
  await page.waitForSelector('.sx-stock-hit');
  const chips = await page.$$eval('.sx-stock-prov', (b) => b.map((x) => [x.dataset.provider, x.dataset.status, !!x.querySelector('.sx-stock-badge')]));
  const list = await page.evaluate(() => LE.stock.providers().map((p) => p.id));
  h.assert.equal(chips.map((c) => c[0]).join(), list.join(), 'one chip per provider, in order');
  chips.forEach((c) => { if (c[0] !== 'openverse') h.assert(c[1] === 'needs-key' && c[2], c[0] + ' shows needs-key'); });
  h.assert(/Openverse/.test(await page.textContent('.sx-stock-credit')), 'credit line from creditText');
  await page.click('.sx-stock-prov[data-provider="unsplash"]');
  await page.waitForSelector('.sx-stock-state .sx-stock-key[data-provider="unsplash"]');
  h.assert(/Access Key/.test(await page.textContent('.sx-stock-state')), 'key label from provider metadata');
  h.assert.equal(searches(st, 'api.unsplash.com').length, 0, 'no search without a key');
  /* Saving a key in place unlocks the provider and searches. */
  await page.click('.sx-stock-prov[data-provider="pixabay"]');
  await page.fill('.sx-stock-state .sx-stock-key[data-provider="pixabay"] input', 'PIXKEY-12345678');
  await page.click('.sx-stock-state .sx-stock-key[data-provider="pixabay"] button[type="submit"]');
  await page.waitForSelector('.sx-stock-hit');
  h.assert.equal(await page.getAttribute('.sx-stock-prov[data-provider="pixabay"]', 'data-status'), 'ok');
  h.assert(searches(st, 'pixabay.com').length >= 1, 'pixabay searched');
  h.assert(!(await page.content()).includes('PIXKEY-12345678'), 'key never rendered in full');
  h.assert.noErrors(page);
};

cases['search paginates on scroll with skeletons, then imports onto the canvas'] = async ({ browser, base, h }) => {
  const { page, st } = await setup(browser, base, h);
  await openStock(page, h, 'openverse');
  await page.waitForFunction(() => document.querySelectorAll('.sx-stock-hit').length === 20);
  await page.locator('.sx-stock-morebtn').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('.sx-stock-hit').length === 40, null, { timeout: 8000 });
  const pages = searches(st, 'api.openverse.org').map((c) => c.q.get('page'));
  h.assert(pages.includes('1') && pages.includes('2'), 'pages requested: ' + pages);
  /* Orientation filter reaches the API. */
  await page.click('.sx-stock-orient button:has-text("Portrait")');
  await page.waitForFunction(() => document.querySelectorAll('.sx-stock-hit').length === 20);
  h.assert(searches(st, 'api.openverse.org').some((c) => c.q.get('aspect_ratio') === 'tall'), 'orientation sent');
  const n0 = (await h.doc(page)).layers.length;
  await page.click('.sx-stock-hit >> nth=0');
  await page.waitForFunction((n) => window.LEStudio.scene.layers().length === n + 1, n0, { timeout: 8000 });
  const res = await page.evaluate(() => { const c = window.LEStudio; const l = c.scene.layers().slice(-1)[0]; return { type: l.type, src: l.src, source: c.S.project.assets[l.src].source }; });
  h.assert(res.type === 'image' && res.src, 'new image layer');
  h.assert(res.source && res.source.provider === 'openverse' && /Maker/.test(res.source.photographer), 'source stored on the asset');
  await page.evaluate(() => { const c = window.LEStudio; c.scene.select([c.scene.layers().slice(-1)[0].id]); });
  await page.waitForTimeout(150);
  h.assert(/Maker/.test(await page.textContent('.sx-attr')), 'attribution line for the stock photo');
  h.assert.noErrors(page);
};

cases['a stock hit replaces just the selected slot'] = async ({ browser, base, h }) => {
  const { page } = await setup(browser, base, h);
  await page.evaluate(() => LEStudioCollage.createGrid(window.LEStudio, ['', '', '']));
  await page.waitForTimeout(200);
  const target = await page.evaluate(() => { const c = window.LEStudio; const l = c.scene.layers().filter((x) => x.slot)[1]; const r = c.scene.screenRect(l.id); return { id: l.id, x: r.left + r.width / 2, y: r.top + r.height / 2, w: l.w, h: l.h, slot: l.slot }; });
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.sx-rep-root');
  await page.click('.sx-rep-tabs button:has-text("Stock photos")');
  await page.waitForSelector('.sx-rep-root .sx-stock-hit');
  await page.click('.sx-rep-root .sx-stock-hit >> nth=2');
  await page.waitForFunction((id) => window.LEStudio.L(id).src, target.id, { timeout: 8000 });
  const d = await h.doc(page);
  const cells = d.layers.filter((l) => l.slot);
  h.assert.equal(cells.filter((l) => l.src).length, 1, 'only one cell filled');
  const l = cells.find((x) => x.id === target.id);
  h.assert(l.w === target.w && l.h === target.h && l.slot.id === target.slot.id, 'frame and slot kept');
  h.assert(await page.isHidden('.sx-rep-root'), 'sheet closed');
  h.assert.noErrors(page);
};

cases['keys sheet masks secrets and runs the Openverse register → verify → token flow'] = async ({ browser, base, h }) => {
  const { page, st } = await setup(browser, base, h, 'desktop', { keys: { pexels: 'PEXKEY-aaaa5678', pixabay: '', unsplash: '' } });
  await openStock(page, h, 'openverse');
  await page.click('.sx-stock-keysbtn');
  await page.waitForSelector('.sx-stock-keys');
  const keysText = await page.textContent('.sx-stock-keys');
  h.assert(/••••5678/.test(keysText) && !/PEXKEY/.test(keysText), 'last four only');
  const rows = await page.$$eval('.sx-stock-keys .sx-stock-key', (r) => r.map((x) => x.dataset.provider));
  h.assert(['pixabay', 'pexels', 'openverse', 'unsplash'].every((p) => rows.includes(p)), 'a row for every provider: ' + rows);
  await page.fill('.sx-stock-ov input[name="email"]', 'me@example.com');
  await page.click('.sx-stock-ov button[type="submit"]');
  await page.waitForSelector('.sx-stock-ov .sx-stock-verify');
  h.assert(/••••1234/.test(await page.textContent('.sx-stock-ov')), 'client id masked');
  h.assert(!(await page.content()).includes('SECRET-zz9876'), 'secret never shown');
  await page.click('.sx-stock-ov button:has-text("connect")');
  await page.waitForSelector('.sx-stock-ov li.is-done:nth-child(3)');
  await page.waitForFunction(() => /requests/.test((document.querySelector('.sx-stock-ov .sx-stock-quota') || {}).textContent || ''));
  h.assert(st.calls.some((c) => c.path === '/v1/auth_tokens/token/') && st.calls.some((c) => c.path === '/v1/rate_limit/'), 'token then quota');
  await page.click('.sx-stock-ov button:has-text("Forget")');
  await page.waitForSelector('.sx-stock-ov input[name="email"]');
  h.assert.noErrors(page);
};

cases['empty, rate-limited and unreachable states'] = async ({ browser, base, h }) => {
  const { page, st } = await setup(browser, base, h, 'desktop', { keys: { pexels: 'PEXKEY-aaaa5678' }, pexels: { status: 429 } });
  st.ov.total = 0;
  await openStock(page, h, 'openverse');
  await page.waitForSelector('.sx-stock-state');
  h.assert(/No photos/.test(await page.textContent('.sx-stock-state')), 'empty state');
  await page.click('.sx-stock-prov[data-provider="pexels"]');
  await page.waitForSelector('.sx-stock-state:has-text("rest")');
  h.assert(await page.isVisible('.sx-stock-state button:has-text("Try Openverse")'), 'suggests another source');
  st.abort = true;
  await page.click('.sx-stock-prov[data-provider="openverse"]');
  await page.waitForSelector('.sx-stock-state:has-text("Could not reach")');
  st.abort = false;
  st.ov.total = 30;
  await page.click('.sx-stock-state button:has-text("Try again")');
  await page.waitForSelector('.sx-stock-hit');
  h.assert.noErrors(page, [/Failed to load resource/, /429/]);
};

['phone', 'small'].forEach((vp) => {
  cases['stock sheet at ' + vp + ' has no sideways scroll'] = async ({ browser, base, h }) => {
    const { page } = await setup(browser, base, h, vp);
    await openStock(page, h, 'openverse');
    await page.waitForSelector('.sx-stock-hit');
    h.assert(await h.noOverflow(page), 'overflow');
    await page.click('.sx-stock-keysbtn');
    await page.waitForSelector('.sx-stock-keys');
    h.assert(await h.noOverflow(page), 'keys overflow');
    const wide = await page.evaluate(() => [...document.querySelectorAll('#sx-panel-body *')].filter((n) => n.getBoundingClientRect().right > window.innerWidth + 1).map((n) => n.className).slice(0, 3));
    h.assert.equal(wide.length, 0, 'nothing past the edge: ' + wide);
    h.assert.noErrors(page);
  };
});

module.exports = cases;
