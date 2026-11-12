/* QA measurement script (not part of the regression run): load cost of / and /studio/, and long tasks when adding a 4000x3000 photo.
 * Usage: node tests/qa/perf.js   (prints JSON; numbers go into docs/QA-REPORT.md) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const h = require('../lib/harness');

async function load(browser, base, url, throttle) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const reqs = [];
  page.on('response', async (res) => {
    try {
      const buf = await res.body();
      const u = new URL(res.url());
      const txt = /\.(js|css|html|json|svg|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/');
      reqs.push({ url: u.pathname, bytes: buf.length, gzip: txt ? zlib.gzipSync(buf).length : buf.length, type: res.headers()['content-type'] || '' });
    } catch (e) { /* redirects */ }
  });
  await page.addInitScript(() => {
    window.__long = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  });
  const t0 = Date.now();
  await page.goto(base + url, { waitUntil: 'load' });
  const tLoad = Date.now() - t0;
  let tInteractive;
  if (url === '/studio/') {
    await page.waitForSelector('.sx-size-card');
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
    tInteractive = Date.now() - t0;
  } else {
    await page.waitForSelector('.btn-gold');
    tInteractive = Date.now() - t0;
  }
  await page.waitForLoadState('networkidle');
  const tIdle = Date.now() - t0;
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round((p.find((x) => x.name === 'first-contentful-paint') || {}).startTime || 0), long: window.__long }; });
  await ctx.close();
  reqs.sort((a, b) => b.bytes - a.bytes);
  const total = reqs.reduce((s, r) => s + r.bytes, 0), gz = reqs.reduce((s, r) => s + r.gzip, 0);
  const by = {};
  reqs.forEach((r) => { const k = /\.js$/.test(r.url) ? 'js' : /\.css$/.test(r.url) ? 'css' : /\.(woff2?|ttf)$/.test(r.url) ? 'font' : /\.(png|jpe?g|webp|svg)$/.test(r.url) ? 'img' : /\.json$/.test(r.url) ? 'json' : 'html/other'; by[k] = (by[k] || 0) + r.bytes; });
  return { url, throttle: throttle || 1, requests: reqs.length, totalKB: Math.round(total / 1024), gzipKB: Math.round(gz / 1024), byKind: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round(v / 1024)])), tLoad, tInteractive, tIdle, nav, top: reqs.slice(0, 8).map((r) => r.url + ' ' + Math.round(r.bytes / 1024) + 'KB (gzip ' + Math.round(r.gzip / 1024) + ')') };
}

async function bigPhoto(browser, base, throttle) {
  const ctx0 = await browser.newContext();
  const pg = await ctx0.newPage();
  await pg.goto(base + '/404.html');
  const b64 = await pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d');
    for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,' + (30 + i % 40) + '%)'; x.fillRect((i * 97) % 4000, (i * 53) % 3000, 400 + (i % 7) * 60, 300 + (i % 5) * 70); }
    const g = x.createLinearGradient(0, 0, 4000, 3000); g.addColorStop(0, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(0,0,0,.3)'); x.fillStyle = g; x.fillRect(0, 0, 4000, 3000);
    const id = x.getImageData(0, 0, 4000, 3000), d = id.data; let seed = 12345; for (let i = 0; i < d.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const n = ((seed >> 16) & 31) - 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(id, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); return btoa(s);
  });
  await ctx0.close();
  const file = path.join(os.tmpdir(), 'qa-4000x3000.jpg');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  const out = { fileKB: Math.round(fs.statSync(file).size / 1024) };
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  if (throttle) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.evaluate(() => { window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] }); });
  const t0 = Date.now();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => window.LEStudio.pickFiles('add'))]);
  await fc.setFiles(file);
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 60000 });
  out.layerAfterMs = Date.now() - t0;
  await page.waitForTimeout(2500);
  const long = await page.evaluate(() => window.__long);
  out.longTasks = long.length; out.longTaskTotalMs = long.reduce((s, x) => s + x[1], 0); out.longest = long.reduce((m, x) => Math.max(m, x[1]), 0); out.long = long.slice(0, 12);
  out.mem = await page.evaluate(() => { const m = Object.values(window.LEStudio.mem)[0]; return m ? { w: m.canvas.width, h: m.canvas.height } : null; });
  out.heapMB = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const t1 = Date.now();
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), (async () => { await h.openPanel(page, 'export'); await page.locator('#sx-panel-body .btn-gold.btn-lg').click(); })()]);
  out.exportMs = Date.now() - t1;
  out.exportKB = Math.round(fs.statSync(await d.path()).size / 1024);
  return out;
}

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const res = { home: [], studio: [] };
  for (const thr of process.env.PERF_BIG_ONLY ? [] : [0, 4]) {
    res.home.push(await load(browser, base, '/', thr));
    res.studio.push(await load(browser, base, '/studio/', thr));
  }
  res.bigPhoto = await bigPhoto(browser, base, 0);
  res.bigPhoto4x = await bigPhoto(browser, base, 4);
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); server.close();
})();
