'use strict';
/* QA-015: local photos keep their original pixels up to a device-class ceiling; export renders from the original. */
const cases = {};

/* A fresh studio page with the device tier and perf mode forced before the photo is chosen. */
async function studio(browser, base, h, o) {
  const page = await h.open(browser, base, '/studio/', 'desktop', {});
  page.setDefaultTimeout(20000);
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await page.evaluate((o) => {
    if (o.tier) window.LE.device.tier = () => o.tier;
    try { localStorage.setItem('le-perf', o.mode || 'auto'); } catch (e) {}
  }, o || {});
  return page;
}
async function openPhoto(page, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc.setFiles(file);
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 40000 });
  await page.waitForTimeout(400);
}
const asset = (page) => page.evaluate(async () => {
  const S = window.LEStudio.S, id = Object.keys(S.project.assets)[0];
  const rec = await window.LE.project.assetRecord(id);
  return { meta: S.project.assets[id], mem: [S.mem[id].canvas.width, S.mem[id].canvas.height], bytes: rec.blob.size, type: rec.blob.type };
});
async function exportAt(page, h, scale) {
  await h.openPanel(page, 'export');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.locator('.sx-chip', { hasText: new RegExp('^' + scale + '×') }).click();
  await page.waitForTimeout(150);
  return h.capture(page, () => page.locator('#sx-panel-body .btn-gold.btn-lg').click());
}
const toasts = (page) => page.evaluate(() => (document.body.innerText.match(/This photo was[^.]*\./g) || []));

cases['a 4000x3000 photo is stored at 4000x3000 and exports 4000x3000 at 1x'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 4000, 3000);
  const page = await studio(browser, base, h, { tier: 'desktop' });
  await openPhoto(page, file);
  const a = await asset(page);
  h.assert(a.meta.width === 4000 && a.meta.height === 3000, 'asset meta ' + a.meta.width + 'x' + a.meta.height);
  h.assert(a.mem[0] === 4000, 'decoded canvas kept');
  const d = await h.doc(page);
  h.assert(d.width === 4000 && d.height === 3000, 'page ' + d.width + 'x' + d.height);
  const r = await exportAt(page, h, '1');
  const i = h.imageInfo(r.buf);
  h.assert(i.type === 'png' && i.w === 4000 && i.h === 3000, 'export ' + JSON.stringify(i));
  h.assert((await toasts(page)).length === 0, 'no resize notice for a photo under the ceiling');
  h.assert.noErrors(page);
};
cases['a photo over the device ceiling is reduced to the ceiling and the person is told'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 7000, 2000);
  const page = await studio(browser, base, h, { tier: 'modern' });
  await openPhoto(page, file);
  const a = await asset(page);
  h.assert(a.meta.width === 6000 && a.meta.height === Math.round(2000 * 6000 / 7000), 'reduced to 6000 wide: ' + a.meta.width + 'x' + a.meta.height);
  const t = await toasts(page);
  h.assert(t.length === 1 && /reduced to 6000 px wide to fit this device/.test(t[0]), 'honest notice: ' + JSON.stringify(t));
  h.assert.noErrors(page);
};
cases['older devices cap at 4096 and desktop keeps 5000'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 5000, 1000);
  const page = await studio(browser, base, h, { tier: 'older' });
  await openPhoto(page, file);
  h.assert((await asset(page)).meta.width === 4096, 'older tier: 4096');
  const p2 = await studio(browser, base, h, { tier: 'desktop' });
  await openPhoto(p2, file);
  h.assert((await asset(p2)).meta.width === 5000, 'desktop keeps 5000');
};
cases['saver mode keeps the aggressive rules (long edge over previewMax x 1.4 is cut to previewMax)'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 4000, 3000);
  const page = await studio(browser, base, h, { tier: 'desktop', mode: 'saver' });
  await openPhoto(page, file);
  const a = await asset(page);
  const pm = await page.evaluate(() => window.LE.perf.previewMax());
  h.assert(pm === 1000 && a.meta.width === pm, 'saver reduced to ' + a.meta.width + ' (previewMax ' + pm + ')');
  h.assert((await toasts(page)).length === 1, 'one notice');
};
cases['quality mode raises the ceiling one class'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 7000, 1000);
  const page = await studio(browser, base, h, { tier: 'modern', mode: 'quality' });
  await openPhoto(page, file);
  h.assert((await asset(page)).meta.width === 7000, 'modern + quality keeps 7000 (desktop class 8000)');
  const p2 = await studio(browser, base, h, { tier: 'modern', mode: 'auto' });
  await openPhoto(p2, file);
  h.assert((await asset(p2)).meta.width === 6000, 'modern + auto cuts to 6000');
};
cases['preview bitmaps stay within previewMax while the original stays full size'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 6000, 4000);
  const page = await studio(browser, base, h, { tier: 'desktop' });
  await openPhoto(page, file);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const sc = window.LEStudio.scene, pm = window.LE.perf.previewMax();
    const caches = Object.keys(sc._imageCache || {}).map((k) => sc._imageCache[k].canvas).filter(Boolean);
    return { pm, max: Math.max.apply(null, caches.map((c) => Math.max(c.width, c.height)).concat([0])), n: caches.length, view: Math.max(sc._canvas.width, sc._canvas.height) };
  });
  h.assert(r.n >= 1 && r.max <= r.pm, 'preview bitmap ' + r.max + ' <= ' + r.pm);
  h.assert(r.view <= r.pm, 'view canvas within previewMax');
  h.assert((await asset(page)).meta.width === 6000, 'original kept');
};
cases['.leproject round trip keeps the original pixel size'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 4000, 3000);
  const page = await studio(browser, base, h, { tier: 'desktop' });
  await openPhoto(page, file);
  const out = await page.evaluate(async () => {
    const p = window.LEStudio.S.project;
    const blob = await window.LE.project.exportFile(p, {});
    const back = await window.LE.project.importFile(new File([blob], 'big.leproject'));
    const proj = Array.isArray(back) ? back[0] : back;
    const id = Object.keys(proj.assets)[0];
    const rec = await window.LE.project.assetRecord(id);
    const bm = await createImageBitmap(rec.blob);
    return { w: bm.width, h: bm.height, zip: blob.size };
  });
  h.assert(out.w === 4000 && out.h === 3000, 'asset after import ' + out.w + 'x' + out.h);
  h.assert(out.zip < 80 * 1024 * 1024, 'zip size ' + out.zip);
};
cases['a file over 25 MB is re-encoded at the same pixel size, not shrunk'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h, { tier: 'desktop' });
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 7000; c.height = 4500;
    const x = c.getContext('2d'); const id = x.createImageData(7000, 4500); let s = 7;
    for (let i = 0; i < id.data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; id.data[i] = i % 4 === 3 ? 255 : (s >> 16) & 255; }
    x.putImageData(id, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'noise.png', { type: 'image/png' });
    const meta = await window.LEStudio.ingest(file);
    return { in: blob.size, w: meta.width, h: meta.height, out: meta.bytes, type: meta.type };
  });
  h.assert(r.in > 25 * 1024 * 1024, 'fixture is over 25 MB: ' + r.in);
  h.assert(r.w === 7000 && r.h === 4500, 'pixel size kept ' + r.w + 'x' + r.h);
  h.assert(r.out < r.in, 'file got smaller: ' + r.in + ' -> ' + r.out);
};
cases['an 8000x6000 photo (48 MP) stays 8000x6000 on desktop and exports at full size, not blank'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 8000, 6000);
  const page = await studio(browser, base, h, { tier: 'desktop' });
  await openPhoto(page, file);
  const a = await asset(page);
  h.assert(a.meta.width === 8000 && a.meta.height === 6000, 'stored ' + a.meta.width + 'x' + a.meta.height);
  const r = await page.evaluate(async () => {
    const blob = await window.LEStudio.exportImage({ format: 'jpeg', dryRun: true, scale: 1 });
    const bm = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { w: bm.width, h: bm.height, avg: s / 256 / 3, maxScale: window.LEStudio.maxScale() };
  });
  h.assert(r.w === 8000 && r.h === 6000, 'export ' + r.w + 'x' + r.h);
  h.assert(r.avg > 10 && r.avg < 245, 'export is not blank (avg ' + r.avg + ')');
  h.assert(r.maxScale >= 1 && r.maxScale < 2.1, 'maxScale reflects the area limit: ' + r.maxScale);
};
module.exports = cases;
