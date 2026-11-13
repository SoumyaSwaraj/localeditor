'use strict';
/* Expert workspace, second pass (docs/EXPERT-UI.md): the Patch and Red-eye tools, the liquify freeze overlay, on-canvas handles
   generated from ui.handles, the grouped add-effect list and its search ranking, and deep links. Runs on the real registry. */
const cases = {};

async function studio(browser, base, o) {
  o = o || {};
  const w = o.w || 1440, hh = o.h || 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript((ls) => { try { localStorage.setItem('le-studio-coach', '"done"'); localStorage.setItem('le-expert-phone-note', '1'); Object.keys(ls).forEach((k) => { if (localStorage.getItem(k) == null) localStorage.setItem(k, ls[k]); }); } catch (e) {} }, o.ls || {});
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

/* ---------- Handles from ui.handles ---------- */
/* Adds an effect to the photo and selects it, as the add-effect list does. */
const addFx = (page, type, p) => page.evaluate(([t, pp]) => {
  const X = window.LE.expert, id = window.LEStudio.targetImage().id;
  X.doc.fx(id).forEach((e) => X.doc.removeFx(id, e.id, X.gesture()));
  const fxId = X.doc.addFx(id, t, { p: pp, append: true }, X.gesture());
  X.emit('fx-select', { layerId: id, type: t, fxId });
  return fxId;
}, [type, p || {}]);
const P = async (page) => (await fx(page))[0].p;
const hpos = (page, id) => page.evaluate((i) => { const g = document.querySelector('.xp-handles .xp-h-pt[data-id="' + i + '"] .xp-h-dot'); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
/* Drags a handle to a client position (or by a delta) and reports the undo steps it took. */
async function pull(page, h, id, to) {
  const a = await hpos(page, id);
  h.assert(a, 'handle ' + id + ' is on the canvas');
  const b = to.dx != null ? { x: a.x + to.dx, y: a.y + to.dy } : to;
  const u0 = await undoCount(page);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); await page.waitForTimeout(40);
  const draft = await page.evaluate(() => !!(window.LE.fx.interactive && window.LE.fx.interactive()));
  await page.mouse.move(b.x, b.y, { steps: 3 }); await page.waitForTimeout(40);
  await page.mouse.up(); await page.waitForTimeout(120);
  h.assert.equal(await undoCount(page) - u0, 1, 'one undo step for the drag of ' + id);
  return { from: a, to: b, draft };
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

cases['handles: point, ring, ellipse and band drag their parameters in one undo step each'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  const box = await page.evaluate(() => window.LE.expert.canvas._box(window.LEStudio.targetImage().id));
  const short = Math.min(box.w, box.h);
  h.assert.equal(await page.locator('.xp-handles .xp-h-pt').count(), 0, 'no handles before an effect is selected');
  /* point */
  await addFx(page, 'vignette', { amount: -40 });
  h.assert.equal(await page.locator('.xp-handles .xp-h-pt').count(), 1, 'vignette: one centre handle');
  let d = await pull(page, h, 'p:center', { dx: 60, dy: -30 });
  let p = await P(page);
  h.assert(near(p.center.x, 0.5 + 60 / box.w, 0.01) && near(p.center.y, 0.5 - 30 / box.h, 0.01), 'point: the centre follows the drag: ' + JSON.stringify(p.center));
  await page.evaluate(() => window.LEStudio.scene.undo());
  p = await P(page);
  h.assert(near(p.center ? p.center.x : 0.5, 0.5, 1e-6), 'undo puts the centre back in one step');
  /* ring */
  await addFx(page, 'sun-glow', { amount: 50, position: { x: 0.5, y: 0.5 }, size: 0.3 });
  d = await pull(page, h, '0:r', { dx: 40, dy: 0 });
  p = await P(page);
  h.assert(near(p.size, 0.3 + 40 / short, 0.02), 'ring: the rim sets the size: ' + p.size);
  await pull(page, h, 'p:position', { dx: -50, dy: 20 });
  p = await P(page);
  h.assert(near(p.position.x, 0.5 - 50 / box.w, 0.01), 'ring: the centre moves the position');
  h.assert(await page.locator('.xp-handles ellipse').count() === 1, 'the ring is drawn');
  /* ellipse */
  await addFx(page, 'iris-blur', { blur: 10, center: { x: 0.5, y: 0.5 }, rx: 0.2, ry: 0.2, angle: 0 });
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  d = await pull(page, h, '0:rx', { x: c.x, y: c.y - 90 });
  p = await P(page);
  h.assert(near(p.angle, 90, 1.5) && near(p.rx, 90 / box.w, 0.01), 'ellipse: the first axis handle turns and sizes it: ' + p.angle + ', ' + p.rx);
  d = await pull(page, h, '0:ry', { dx: 40, dy: 0 });
  p = await P(page);
  h.assert(near(p.ry, 0.2 + 40 / box.h, 0.012) && near(p.angle, 90, 1.5), 'ellipse: the second handle sets the other radius only: ' + p.ry);
  h.assert(d.draft, 'draft rendering is on while a handle is dragged');
  h.assert(!(await page.evaluate(() => window.LE.fx.interactive())), 'and off afterwards');
  /* band */
  await addFx(page, 'tilt-shift', { blur: 10, center: { x: 0.5, y: 0.5 }, angle: 0, focus: 0.1, transition: 0.2 });
  h.assert.equal(await page.locator('.xp-handles line').count(), 4, 'band: two focus lines and two transition lines');
  await pull(page, h, '0:h', { dx: 0, dy: 30 });
  p = await P(page);
  h.assert(near(p.focus, 0.1 + 30 / short, 0.012), 'band: the focus handle sets the half width: ' + p.focus);
  await pull(page, h, '0:f', { dx: 0, dy: -25 });
  p = await P(page);
  h.assert(near(p.transition, 0.2 + 25 / short, 0.012), 'band: the outer handle sets the transition: ' + p.transition);
  d = await pull(page, h, '0:a', { x: c.x + 80, y: c.y - 80 });
  p = await P(page);
  h.assert(near(p.angle, 45, 1.5), 'band: the arm sets the angle (counter-clockwise): ' + p.angle);
  /* Keyboard: arrows move a focused handle. */
  await page.evaluate(() => document.querySelector('.xp-handles .xp-h-pt[data-id="p:center"]').focus());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  p = await P(page);
  h.assert(near(p.center.x, 0.505, 0.001), 'arrow keys nudge a handle: ' + p.center.x);
  /* Hidden while a painting tool is active, back with Move. */
  await page.keyboard.press('b');
  await page.waitForTimeout(150);
  h.assert.equal(await page.locator('.xp-handles .xp-h-pt').count(), 0, 'handles hide while the brush is active');
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
  h.assert(await page.locator('.xp-handles .xp-h-pt').count() > 0, 'and come back with Move');
  h.assert.noErrors(page);
};

cases['handles: angle arm and direction line; touch targets; follow the develop panel'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  const box = await page.evaluate(() => window.LE.expert.canvas._box(window.LEStudio.targetImage().id));
  const zoom = await page.evaluate(() => window.LEStudio.scene.zoom());
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  /* angle arm on a point parameter */
  await addFx(page, 'light-leak', { amount: 40, position: { x: 0.5, y: 0.5 }, size: 0.4, angle: 0 });
  await pull(page, h, '1:a', { x: c.x, y: c.y + 100 });
  let p = await P(page);
  h.assert(near(p.angle, 90, 1.5), 'angle: the arm turns the parameter (clockwise here): ' + p.angle);
  /* direction + length */
  await addFx(page, 'motion-blur', { angle: 0, distance: 100 });
  await pull(page, h, '0:t', { x: c.x + 60, y: c.y - 60 });
  p = await P(page);
  h.assert(near(p.angle, 45, 1.5) && near(p.distance, 2 * Math.hypot(60, 60) / zoom, 4), 'line: direction and length from the tip: ' + p.angle + ', ' + p.distance + ' (zoom ' + zoom + ')');
  /* 44 px targets */
  const hit = await page.evaluate(() => { const r = document.querySelector('.xp-handles .xp-h-pt .xp-h-hit').getBoundingClientRect(); return Math.min(r.width, r.height); });
  h.assert(hit >= 44, 'handles have 44 px targets: ' + hit);
  /* The develop panel selects by touch of a control: handles follow, and leave with another layer's selection. */
  await addFx(page, 'vignette', { amount: -30 });
  await page.evaluate(() => window.LE.expert.emit('fx-select', null));
  h.assert.equal(await page.locator('.xp-handles .xp-h-pt').count(), 0, 'nothing selected, nothing shown');
  await page.evaluate(() => window.LE.expert.workspace.components().develop.open('Optics', true));
  await page.waitForTimeout(150);
  await page.locator('#xp-right .xp-fxpanel[data-fx="vignette"] [data-param="amount"] .xp-slider-track, #xp-right .xp-fxpanel[data-fx="vignette"] [data-param="amount"]').first().click();
  await page.waitForTimeout(150);
  h.assert.equal(await page.locator('.xp-handles .xp-h-pt[data-id="p:center"]').count(), 1, 'touching the effect in the develop panel shows its handles');
  h.assert.noErrors(page);
};

cases['handles: shadow tip, contact line and mesh'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  const box = await page.evaluate(() => window.LE.expert.canvas._box(window.LEStudio.targetImage().id));
  const zoom = await page.evaluate(() => window.LEStudio.scene.zoom());
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  let p;
  /* shadow tip */
  await addFx(page, 'cast-shadow', { opacity: 0, direction: 0, elevation: 45, ground: 0.5, height: 200, anchor: { x: 0.5, y: 0.5 } });
  await pull(page, h, '0:t', { x: c.x - 100, y: c.y + 50 });
  p = await P(page);
  const len = Math.hypot(100, 50 / 0.5) / zoom;
  h.assert(near(p.direction, 135, 2) && near(p.elevation, Math.atan2(200, len) * 180 / Math.PI, 1.5), 'shadow tip: direction and light elevation: ' + p.direction + ', ' + p.elevation);
  await pull(page, h, 'p:anchor', { dx: 30, dy: 0 });
  h.assert(near((await P(page)).anchor.x, 0.5 + 30 / box.w, 0.01), 'the contact point moves too');
  /* contact line and width */
  await addFx(page, 'floating-shadow', { opacity: 0, width: 200, anchor: { x: 0.5, y: 0.6 } });
  await pull(page, h, '0:t', { dx: 30, dy: 0 });
  h.assert(near((await P(page)).width, 200 + 60 / zoom, 6), 'floating shadow: the end of the contact line sets the width: ' + (await P(page)).width);
  await addFx(page, 'floor-reflection', { opacity: 0, anchor: { x: 0.5, y: 0.6 } });
  h.assert(await page.locator('.xp-handles line').count() === 1 && await page.locator('.xp-handles .xp-h-pt').count() === 1, 'floor reflection: a contact line through its anchor');
  await pull(page, h, 'p:anchor', { dx: 0, dy: 40 });
  h.assert(near((await P(page)).anchor.y, 0.6 + 40 / box.h, 0.01), 'and the line moves with it');
  /* mesh */
  await addFx(page, 'mesh-warp', {});
  h.assert.equal(await page.locator('.xp-handles .xp-h-pt').count(), 16, 'mesh: sixteen points');
  h.assert.equal(await page.locator('.xp-handles line').count(), 24, 'joined along rows and columns');
  const m0 = await page.evaluate(() => window.LE.fx.defaults('mesh-warp').p11), m12 = await page.evaluate(() => window.LE.fx.defaults('mesh-warp').p12);
  await pull(page, h, 'p:p11', { dx: 25, dy: 15 });
  p = await P(page);
  h.assert(near(p.p11.x, m0.x + 25 / box.w, 0.01) && near(p.p11.y, m0.y + 15 / box.h, 0.01) && (p.p12 === undefined || (p.p12.x === m12.x && p.p12.y === m12.y)), 'mesh: one point moves, the others stay: ' + JSON.stringify(p.p11));
  h.assert.noErrors(page);
};

/* ---------- Add-effect list ---------- */
cases['add-effect list: Common first, sections with headings, ranked search, ui.order inside a section'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  await expert(page);
  await page.locator('#xp-right .xp-lay-foot [data-act="fx"]').click();
  await page.waitForSelector('#sx-pop .xp-fxmenu [role="option"]');
  const groups = await page.evaluate(() => [].map.call(document.querySelectorAll('#sx-pop .xp-fxmenu-grp'), (g) => g.textContent));
  h.assert.equal(groups[0], 'Common', 'the curated group comes first');
  const want = await page.evaluate(() => window.LE.expert.sections());
  h.assert.equal(JSON.stringify(groups.slice(1)), JSON.stringify(want), 'then every section under its heading, in the develop panel order');
  const common = await page.evaluate(() => { const out = []; let n = document.querySelector('#sx-pop .xp-fxmenu-grp').nextElementSibling; while (n && n.getAttribute('role') === 'option') { out.push(n.getAttribute('data-id')); n = n.nextElementSibling; } return out; });
  h.assert(common.length >= 8 && common.length <= 16 && common[0] === 'exposure' && common.includes('curves') && common.includes('vignette'), 'a short curated list: ' + common.join(', '));
  const total = await page.locator('#sx-pop .xp-fxmenu [role="option"]').count();
  h.assert(total > 100 + common.length, 'the whole library is listed: ' + total);
  /* Search: rank is explicit (name before id, keywords, section, summary), ties keep the panel order. */
  const first = async (q) => { await page.locator('#sx-pop .xp-fxmenu input').fill(q); await page.waitForTimeout(60); return page.evaluate(() => [].map.call(document.querySelectorAll('#sx-pop .xp-fxmenu [role="option"]'), (b) => b.getAttribute('data-id'))); };
  let r = await first('curv');
  h.assert(r[0] === 'curves' && r.indexOf('tone-curve') > 0 && r.indexOf('hue-curves') > 0, '"curv" finds Curves first, then the other curve effects: ' + r.slice(0, 5).join(', '));
  h.assert.equal(await page.locator('#sx-pop .xp-fxmenu [aria-selected="true"]').getAttribute('data-id'), 'curves', 'and Enter would take it');
  r = await first('blur');
  h.assert(r.slice(0, 3).every((id) => /blur/.test(id)) && r.includes('soft-focus'), '"blur": effects named so first, then those that mention it: ' + r.slice(0, 6).join(', '));
  const optics = await page.evaluate(() => window.LE.expert.sectionTypes('Optics'));
  r = await first('optics');
  h.assert(optics.every((id) => r.includes(id)), 'a section name finds its effects');
  r = await first('shadow cast');
  h.assert.equal(r[0], 'cast-shadow', 'every word must match; word order does not matter');
  r = await first('surface blur filter');
  h.assert.equal(r[0], 'surface-blur', 'keywords (agent.like) are searched: ' + r.slice(0, 3).join(', '));
  r = await first('zzzz');
  h.assert(r.length === 0 && await page.locator('#sx-pop .xp-fxmenu .xp-note').count() === 1, 'no match says so');
  const same = await page.evaluate(() => { const X = window.LE.expert, a = X.fxSearch('glow').map((d) => d.id), b = X.fxSearch('glow', X.defs().slice().reverse()).map((d) => d.id); return [a[0], b[0], a.length === b.length]; });
  h.assert(same[0] === 'glow' && same[1] === 'glow' && same[2], 'the best match does not depend on the order of the list it is given: ' + same.join(', '));
  /* Two effects with the same name: the earlier registration wins a tie, whatever their ui.order (the list order differs). */
  const tie = await page.evaluate(() => { const X = window.LE.expert, mk = (id, order, reg) => ({ id, name: 'Curves', section: 'Curves', rank: 2, order: reg, ui: { order } }); return X.fxSearch('curv', [mk('late', 1, 9), mk('early', 50, 3)]).map((d) => d.id).join(); });
  h.assert.equal(tie, 'early,late', 'ties go by registration, not by ui.order');
  /* ui.order inside each section. */
  const bad = await page.evaluate(() => { const X = window.LE.expert, out = []; X.sections().forEach((s) => { const o = X.defs().filter((d) => d.section === s).map((d) => (d.ui && typeof d.ui.order === 'number') ? d.ui.order : 1e9); for (let i = 1; i < o.length; i++) if (o[i] < o[i - 1]) out.push(s); }); return out; });
  h.assert.equal(bad.length, 0, 'registrations are in ui.order inside every section: ' + bad.join(', '));
  /* Picking adds it, opens it and selects it. */
  await first('iris');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const e = await fx(page);
  h.assert(e.length === 1 && e[0].type === 'iris-blur', 'Enter adds the best match');
  h.assert(await page.locator('.xp-handles .xp-h-pt').count() >= 3, 'and its handles are on the canvas');
  h.assert.noErrors(page);
};

/* ---------- Deep links ---------- */
const xpOn = (page) => page.waitForFunction(() => window.LE.expert && window.LE.expert.active() && window.LE.expert.links);
cases['deep links: tab opens the pane on desktop and the tab on a phone; the saved mode is untouched'] = async ({ browser, base, h }) => {
  let page = await studio(browser, base, { query: '?mode=expert&tab=layers', ls: { 'le-expert-layout': JSON.stringify({ rightW: 340, split: 0.6, scopes: true, dev: true, lay: false }) } });
  await xpOn(page);
  await page.waitForTimeout(300);
  let r = await page.evaluate(() => ({ collapsed: document.querySelector('.xp-pane-lay').classList.contains('is-collapsed'), focus: !!document.activeElement.closest('.xp-pane-lay'), url: location.search, mode: localStorage.getItem('le-studio-mode') }));
  h.assert(!r.collapsed && r.focus, 'desktop: the Layers pane is expanded and focused: ' + JSON.stringify(r));
  h.assert.equal(r.url, '', 'the link is read once and removed from the address');
  h.assert(r.mode !== '"expert"' && r.mode !== 'expert', 'a link does not change the saved workspace: ' + r.mode);
  h.assert(await page.evaluate(() => window.LE.expert.workspace.show('mask') && window.LE.expert.workspace.components().develop.isOpen('Mask')), 'tab=mask opens the layer mask section');
  h.assert.noErrors(page);
  await page.context().close();
  for (const [tab, want] of [['scopes', { tab: 'scopes', mask: false }], ['mask', { tab: 'adjust', mask: true }], ['layers', { tab: 'layers', mask: false }], ['develop', { tab: 'adjust', mask: false }]]) {
    page = await studio(browser, base, { w: 390, h: 844, query: '?mode=expert&tab=' + tab });
    await xpOn(page);
    await page.waitForTimeout(300);
    r = await page.evaluate(() => ({ panel: window.LEStudio.S.panel, tab: window.LEStudio.S.panelOpts.tab, mask: !!window.LEStudio.S.panelOpts.mask }));
    h.assert(r.panel === 'expert' && r.tab === want.tab && r.mask === want.mask, 'phone: tab=' + tab + ' opens it: ' + JSON.stringify(r));
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['deep links: tool and add wait for the first photo; unknown values are ignored'] = async ({ browser, base, h }) => {
  let page = await studio(browser, base, { query: '?mode=expert&tool=patch&add=iris-blur', photo: false });
  await xpOn(page);
  await page.waitForTimeout(400);
  const toast = await page.evaluate(() => { const t = document.querySelector('#sx-toast, .sx-toast'); return t ? t.textContent : ''; });
  h.assert(/Iris blur/.test(toast) && /Open a photo/.test(toast), 'without a photo a one-line hint says what will happen: ' + toast);
  h.assert.equal(await page.evaluate(() => window.LE.expert.tools.active()), 'move', 'nothing is activated yet');
  const u0 = await undoCount(page);
  await photo(page);
  await page.waitForFunction(() => { const l = window.LEStudio.targetImage(); return l && (l.fx || []).length === 1; });
  await page.waitForTimeout(200);
  const e = await fx(page);
  h.assert(e[0].type === 'iris-blur', 'the effect is added when the first photo opens');
  h.assert.equal(await page.evaluate(() => window.LE.expert.tools.active()), 'patch', 'and the tool is active');
  h.assert(await page.evaluate(() => window.LE.expert.workspace.components().develop.isOpen('Optics')), 'its section is open in the develop panel');
  void u0;
  /* Every tool name, and an effect with a photo already open. */
  for (const t of ['heal', 'clone', 'patch', 'redeye', 'dodge', 'liquify', 'light', 'brush', 'gradient']) {
    await page.evaluate((tool) => { window.LE.expert.tools.activate('move'); return window.LE.expert.links({ tool }); }, t);
    await page.waitForTimeout(120);
    h.assert.equal(await page.evaluate(() => window.LE.expert.tools.active()), t, 'tool=' + t);
  }
  await page.evaluate(() => { window.LE.expert.tools.activate('move'); return window.LE.expert.links({ add: 'vignette' }); });
  await page.waitForTimeout(150);
  const u1 = await undoCount(page);
  h.assert((await fx(page)).map((x) => x.type).join() === 'iris-blur,vignette', 'add with a photo open adds at once');
  await page.evaluate(() => window.LEStudio.scene.undo());
  h.assert((await fx(page)).length === 1 && u1 - (await undoCount(page)) === 1, 'in one undo step');
  h.assert.noErrors(page);
  await page.context().close();
  page = await studio(browser, base, { query: '?mode=expert&tab=zzz&tool=nope&add=not-an-effect' });
  await xpOn(page);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ tool: window.LE.expert.tools.active(), fx: (window.LEStudio.targetImage().fx || []).length, url: location.search }));
  h.assert(r.tool === 'move' && r.fx === 0 && r.url === '', 'unknown values change nothing: ' + JSON.stringify(r));
  h.assert.noErrors(page);
};

cases['deep links: ?open=raw and ?open=hdr offer the file chooser after boot, in either workspace'] = async ({ browser, base, h }) => {
  for (const [q, label, mode] of [['?open=raw', 'Choose a photo', 'add'], ['?open=hdr', 'Choose photos', 'hdr'], ['?mode=expert&open=raw', 'Choose a photo', 'add']]) {
    const page = await studio(browser, base, { query: q, photo: false });
    await page.waitForTimeout(400);
    const btn = page.locator('.sx-toast-act', { hasText: label });
    h.assert(await btn.count(), q + ': a toast offers "' + label + '"');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn.click()]);
    h.assert(chooser, q + ': the action opens the file chooser');
    h.assert.equal(await page.evaluate(() => document.getElementById('sx-file').dataset.mode), mode, q + ': through the existing command');
    h.assert.equal(await page.evaluate(() => location.search), '', q + ': removed from the address');
    h.assert.equal(await page.evaluate(() => !!(window.LE.expert && window.LE.expert.active())), /mode=expert/.test(q), q + ': the workspace is the one the link asked for');
    h.assert.noErrors(page);
    await page.context().close();
  }
  const page = await studio(browser, base, { query: '?open=zzz', photo: false });
  await page.waitForTimeout(300);
  h.assert.equal(await page.locator('.sx-toast-act').count(), 0, 'an unknown ?open value is ignored');
  h.assert.noErrors(page);
};

module.exports = cases;
