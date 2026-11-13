'use strict';
/* Expert workspace, second pass (docs/EXPERT-UI.md): the Patch and Red-eye tools, the liquify freeze overlay, on-canvas handles
   generated from ui.handles, the grouped add-effect list and its search ranking, and deep links. Runs on the real registry. */
const cases = {};

async function studio(browser, base, o) {
  o = o || {};
  const w = o.w || 1440, hh = o.h || 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('le-studio-coach', '"done"'); localStorage.setItem('le-expert-phone-note', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(15000);
  await page.goto(base + '/studio/' + (o.query || ''), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await page.evaluate(() => { ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((c) => window.LE.support && window.LE.support.override(c, true)); });
  if (o.photo !== false) await photo(page);
  return page;
}
async function photo(page) {
  await page.evaluate(async () => {
    const r = await fetch('/assets/photos/collage/arch-02.jpg');
    await window.LEStudio.newFromPhoto(new File([await r.blob()], 'arch.jpg', { type: 'image/jpeg' }));
  });
  await page.waitForTimeout(300);
}
async function expert(page) {
  await page.evaluate(() => window.LEStudio.mode('expert'));
  await page.waitForFunction(() => window.LE.expert && window.LE.expert.active());
  await page.evaluate(() => window.LE.fxBoot.load());
  await page.waitForTimeout(300);
}
const undoCount = (page) => page.evaluate(() => window.LEStudio.scene._hist.undo.length);
const fx = (page) => page.evaluate(() => { const l = window.LEStudio.targetImage(); return window.LEStudio.scene.layer(l.id).fx || []; });
/* Client position of a point given in fractions of the photo's box. */
const at = (page, x, y) => page.evaluate(([fx, fy]) => { const b = window.LE.expert.canvas._box(window.LEStudio.targetImage().id); return { x: b.x + b.w * fx, y: b.y + b.h * fy }; }, [x, y]);
async function drag(page, pts, o) {
  o = o || {};
  let p = await at(page, pts[0][0], pts[0][1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) { p = await at(page, pts[i][0], pts[i][1]); await page.mouse.move(p.x, p.y, { steps: o.steps || 4 }); await page.waitForTimeout(20); }
  if (o.hold) await o.hold();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/* ---------- Patch and Red-eye ---------- */
cases['patch: lasso, drag to the source, one polygon record and one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  h.assert(await page.locator('#xp-strip [data-tool="patch"]').count() && await page.locator('#xp-strip [data-tool="redeye"]').count(), 'Patch and Red-eye are in the tool strip');
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => window.LE.expert.tools.active()), 'patch', 'P activates Patch');
  const u0 = await undoCount(page);
  await drag(page, [[0.3, 0.3], [0.45, 0.3], [0.45, 0.45], [0.3, 0.45], [0.3, 0.32]]);
  h.assert(await page.locator('.xp-tool-svg polygon').count(), 'the lasso closes into an outline');
  h.assert.equal(await undoCount(page), u0, 'drawing the outline changes nothing in the document');
  let mid = null;
  await drag(page, [[0.37, 0.37], [0.47, 0.37], [0.57, 0.37]], { hold: async () => {
    await page.waitForTimeout(80);
    mid = await page.evaluate(() => ({ undo: window.LEStudio.scene._hist.undo.length, n: (window.LEStudio.targetImage().fx || []).length, ghost: document.querySelectorAll('.xp-tool-svg polygon').length }));
  } });
  h.assert(mid.n === 1 && mid.undo === u0 + 1 && mid.ghost === 2, 'the record is written while dragging, in one step, with the source outline shown: ' + JSON.stringify(mid));
  const recs = await page.evaluate(() => { const l = window.LEStudio.targetImage(), e = l.fx.filter((x) => x.type === 'spot-heal')[0]; return window.LE.fx.retouch.spots.read(e.p); });
  h.assert(recs.length === 1 && recs[0].kind === 'heal-polygon' && recs[0].points.length >= 4, 'one heal polygon stored: ' + JSON.stringify(recs).slice(0, 200));
  h.assert(Math.abs(recs[0].dx - 0.2) < 0.01 && Math.abs(recs[0].dy) < 0.01, 'the offset is the drag: ' + recs[0].dx + ', ' + recs[0].dy);
  const xs = recs[0].points.map((q) => q[0]), ys = recs[0].points.map((q) => q[1]);
  h.assert(Math.abs(Math.min(...xs) - 0.3) < 0.01 && Math.abs(Math.max(...xs) - 0.45) < 0.01 && Math.abs(Math.max(...ys) - 0.45) < 0.01, 'the polygon is where it was drawn');
  h.assert.equal(await undoCount(page), u0 + 1, 'one undo step for the whole patch');
  await page.evaluate(() => window.LEStudio.scene.undo());
  h.assert.equal((await fx(page)).length, 0, 'undo removes the patch in one step');
  /* Copy mode, corner by corner. */
  await page.locator('#sx-tool .xp-opts .xp-seg button', { hasText: 'Copy' }).click();
  for (const q of [[0.6, 0.6], [0.7, 0.6], [0.7, 0.7], [0.6, 0.7], [0.6, 0.6]]) { const p = await at(page, q[0], q[1]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(40); }
  await drag(page, [[0.65, 0.65], [0.65, 0.55], [0.65, 0.45]]);
  const r2 = await page.evaluate(() => window.LE.fx.retouch.spots.read(window.LEStudio.targetImage().fx[0].p));
  h.assert(r2.length === 1 && r2[0].kind === 'clone-polygon' && r2[0].points.length === 4 && Math.abs(r2[0].dy + 0.2) < 0.01, 'clicked corners make a copy polygon: ' + JSON.stringify(r2).slice(0, 200));
  h.assert.noErrors(page);
};

cases['red-eye: a tap and a box fill one entry, sizes follow the options, undo per eye'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => window.LE.expert.tools.active()), 'redeye', 'R activates Red-eye');
  const u0 = await undoCount(page);
  let p = await at(page, 0.4, 0.4);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  let e = await fx(page);
  h.assert(e.length === 1 && e[0].type === 'red-eye' && Math.abs(e[0].p.eye1.x - 0.4) < 0.005 && Math.abs(e[0].p.eye1.y - 0.4) < 0.005 && e[0].p.radius === 12 && e[0].p.darken === 50, 'a tap places the first eye with the options bar values: ' + JSON.stringify(e[0] && e[0].p));
  p = await at(page, 0.6, 0.4);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  e = await fx(page);
  h.assert(e.length === 1 && Math.abs(e[0].p.eye2.x - 0.6) < 0.005, 'the second tap fills the second eye of the same entry');
  h.assert.equal(await undoCount(page), u0 + 2, 'one undo step per eye');
  /* A box: centre and size from the drag; a different size starts a new entry. */
  const zoom = await page.evaluate(() => window.LEStudio.scene.zoom());
  const a = await at(page, 0.5, 0.7);
  await page.mouse.move(a.x - 20, a.y - 20); await page.mouse.down(); await page.mouse.move(a.x, a.y, { steps: 3 }); await page.mouse.move(a.x + 20, a.y + 20, { steps: 3 }); await page.mouse.up();
  await page.waitForTimeout(100);
  e = await fx(page);
  h.assert(e.length === 2 && Math.abs(e[1].p.eye1.x - 0.5) < 0.01 && Math.abs(e[1].p.eye1.y - 0.7) < 0.01 && Math.abs(e[1].p.radius - 20 / zoom) < 1, 'a box sets centre and pupil size: ' + JSON.stringify(e[1] && e[1].p) + ' zoom ' + zoom);
  await page.evaluate(() => window.LEStudio.scene.undo());
  h.assert.equal((await fx(page)).length, 1, 'undo removes that eye only');
  h.assert.noErrors(page);
};

/* ---------- Liquify freeze overlay ---------- */
cases['liquify: the freeze overlay follows the mesh, clears with thaw and is gone when off'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  await page.evaluate(() => { localStorage.removeItem('le-expert-liquify'); window.LE.expert.tools.activate('liquify'); });
  await page.waitForTimeout(300);
  const ov = () => page.evaluate(() => { const c = document.querySelector('.xp-freeze-ov'); return c ? { n: Number(c.getAttribute('data-frozen')), w: c.getBoundingClientRect().width } : null; });
  h.assert.equal(await ov(), null, 'no overlay element with the warp tool and the toggle off');
  const sel = page.locator('#sx-tool .xp-opts .xp-choice select');
  await sel.selectOption({ label: 'Freeze mask' });
  await page.waitForTimeout(100);
  let o = await ov();
  h.assert(o && o.n === 0 && o.w > 100, 'the overlay appears with the freeze tool, empty and over the photo: ' + JSON.stringify(o));
  let mid = null;
  await drag(page, [[0.4, 0.4], [0.5, 0.4], [0.6, 0.4]], { hold: async () => { await page.waitForTimeout(150); mid = await ov(); } });
  h.assert(mid && mid.n > 0, 'the frozen area shows while the stroke is still down: ' + JSON.stringify(mid));
  const frozen = (await ov()).n;
  const px = await page.evaluate(() => { const c = document.querySelector('.xp-freeze-ov'), d = c.getContext('2d').getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.4), 1, 1).data, e = c.getContext('2d').getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.8), 1, 1).data; return { on: [d[0], d[3]], off: e[3] }; });
  h.assert(px.on[0] > 200 && px.on[1] > 40 && px.off === 0, 'red where the stroke went, clear elsewhere: ' + JSON.stringify(px));
  await sel.selectOption({ label: 'Thaw mask' });
  await drag(page, [[0.4, 0.4], [0.5, 0.4], [0.6, 0.4]], { hold: async () => { await page.waitForTimeout(700); } });
  o = await ov();
  h.assert(o && o.n < frozen, 'thaw clears it: ' + frozen + ' → ' + (o && o.n));
  await sel.selectOption({ label: 'Forward warp' });
  await page.waitForTimeout(80);
  h.assert.equal(await ov(), null, 'gone with a warp tool');
  await page.locator('#sx-tool [data-liq-mask]').click();
  await page.waitForTimeout(80);
  h.assert(await ov(), '"Show mask" brings it back with any tool');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  h.assert.equal(await ov(), null, 'gone when the tool is left');
  h.assert.noErrors(page);
};

module.exports = cases;
