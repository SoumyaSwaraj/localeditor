'use strict';
/* Redact tool (2.7): shape layers with `redact: { mode, amount, color }` that hide what is rendered beneath them,
   in the preview and in every export, plus "Apply permanently". */

/* Sample studio with a photo, and a line of text over it, at known places. Returns the page. */
async function setup(h, browser, base, vp) {
  const page = await h.studioWithSample(browser, base, vp || 'desktop');
  await page.evaluate(async () => {
    const c = window.LEStudio;
    c.scene.remove(c.scene.layers().filter((l) => l.type !== 'image').map((l) => l.id));
    const blob = await (await fetch('/assets/photos/collage/arch-02.jpg')).blob();
    const meta = await c.ingest(new File([blob], 'arch-02.jpg', { type: 'image/jpeg' }));
    c.scene.add({ type: 'image', src: meta.id, x: 600, y: 100, w: 500, h: 600, name: 'Street photo' });
    c.scene.add({ type: 'text', text: 'SECRET 4821 7730', x: 80, y: 520, w: 900, h: 120, size: 90, weight: 800, color: '#111111', font: 'Plus Jakarta Sans', name: 'Card number' });
    c.scene.select([]);
    window.__photo = meta.id;
  });
  await page.waitForTimeout(300);
  return page;
}
/* Renders the page at a scale and returns grey values of a rectangle (document units). */
function grab(page, scale, rect, opts) {
  return page.evaluate(async ([s, r, o]) => {
    const c = window.LEStudio;
    const cv = o && o.hidden ? await c.hiddenRender(c.scene.toJSON(), s) : await c.scene.render(s);
    const x = cv.getContext('2d');
    const d = x.getImageData(Math.round(r.x * s), Math.round(r.y * s), Math.round(r.w * s), Math.round(r.h * s));
    const g = [];
    for (let i = 0; i < d.data.length; i += 4) g.push(Math.round(0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2]));
    return { w: d.width, h: d.height, g };
  }, [scale, rect, opts || null]);
}
function diff(a, b) { let n = 0; for (let i = 0; i < a.g.length; i++) n += Math.abs(a.g[i] - b.g[i]); return n / a.g.length; }
/* High-frequency energy: mean absolute response of a 3×3 sharpening (Laplacian) kernel. */
function detail(a) {
  let e = 0, n = 0;
  for (let y = 1; y < a.h - 1; y++) for (let x = 1; x < a.w - 1; x++) {
    const i = y * a.w + x;
    e += Math.abs(4 * a.g[i] - a.g[i - 1] - a.g[i + 1] - a.g[i - a.w] - a.g[i + a.w]); n++;
  }
  return e / n;
}
/* Average length of runs of equal values along the middle row. */
function runLength(a) {
  const y = Math.floor(a.h / 2);
  let runs = 1;
  for (let x = 1; x < a.w; x++) if (a.g[y * a.w + x] !== a.g[y * a.w + x - 1]) runs++;
  return a.w / runs;
}
const TEXT = { x: 80, y: 520, w: 900, h: 120 };
const OUTSIDE = { x: 80, y: 60, w: 400, h: 300 };

const cases = {};

cases['redact layer lands in the doc, survives undo / redo and a .leproject round trip'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base);
  const id = await page.evaluate(() => window.LEStudioPrivacy.add({ x: 70, y: 510, w: 920, h: 140 }, 'pixelate'));
  let l = (await h.doc(page)).layers.find((x) => x.id === id);
  h.assert(l && l.type === 'shape' && l.shape === 'rect', 'a plain shape layer');
  h.assert.equal(JSON.stringify(l.redact), JSON.stringify({ mode: 'pixelate', amount: 0, color: '#17131F' }), 'redact fields');
  await page.evaluate((i) => window.LEStudioPrivacy.set(i, { mode: 'blur', amount: 40 }), id);
  await page.evaluate((i) => window.LEStudio.scene.update(i, { redact: { amount: 99999, color: 'javascript:alert(1)', mode: 'evil' } }), id);
  l = (await h.doc(page)).layers.find((x) => x.id === id);
  h.assert.equal(JSON.stringify(l.redact), JSON.stringify({ mode: 'solid', amount: 500, color: '#17131F' }), 'bad values are sanitised');
  await page.evaluate(() => { window.LEStudio.scene.undo(); });
  l = (await h.doc(page)).layers.find((x) => x.id === id);
  h.assert.equal(l.redact.mode, 'blur', 'undo restores the previous redact settings');
  h.assert.equal(l.redact.amount, 40, 'undo restores the amount');
  await page.evaluate(() => { const s = window.LEStudio.scene; s.undo(); s.undo(); });
  h.assert(!(await h.doc(page)).layers.some((x) => x.id === id), 'undo removes the redaction');
  await page.evaluate(() => { const s = window.LEStudio.scene; s.redo(); s.redo(); });
  l = (await h.doc(page)).layers.find((x) => x.id === id);
  h.assert(l && l.redact.mode === 'blur', 'redo brings it back');
  /* Duplicate keeps it a redaction. */
  await page.evaluate((i) => { window.LEStudio.scene.select([i]); window.LEStudio.scene.duplicate([i]); }, id);
  h.assert.equal((await h.doc(page)).layers.filter((x) => x.redact).length, 2, 'duplicate is a redaction too');
  const rt = await page.evaluate(async () => {
    const c = window.LEStudio;
    c.syncProject();
    const blob = await LE.project.exportFile(c.S.project, {});
    const back = await LE.project.readFile(new File([blob], 'r.leproject'));
    const v = LE.project.validate({ schema: 'x', pages: [{ width: 10, height: 10, layers: [{ type: 'shape', redact: { mode: 'pixelate', amount: 12, color: '#ffffff', extra: '<script>' } }] }] });
    return { layers: back.project.pages[back.project.activePage].layers.filter((l) => l.redact).map((l) => l.redact), v: v.ok ? v.project.pages[0].layers[0].redact : v.errors };
  });
  h.assert.equal(JSON.stringify(rt.layers), JSON.stringify([{ mode: 'blur', amount: 40, color: '#17131F' }, { mode: 'blur', amount: 40, color: '#17131F' }]), 'redact survives .leproject export + import');
  h.assert.noErrors(page);
};

/* One case per mode, so none nears the 90 s limit on a loaded machine (the single case took 40 s alone). */
['solid', 'pixelate', 'blur'].forEach((mode) => {
cases['export pixels change inside the box and not outside, at preview and export scales (' + mode + ')'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base);
  const before = await grab(page, 1, TEXT);
  const outBefore = await grab(page, 1, OUTSIDE);
  {
    const id = await page.evaluate((m) => window.LEStudioPrivacy.add({ x: 70, y: 510, w: 920, h: 140 }, m), mode);
    for (const s of [0.5, 1, 2]) {
      const a = await grab(page, 1 * s, TEXT);
      const b = s === 1 ? before : await page.evaluate(() => null) || null;
      const ref = s === 1 ? before : await (async () => { await page.evaluate((i) => window.LEStudio.scene.update(i, { visible: false }), id); const r = await grab(page, s, TEXT); await page.evaluate((i) => window.LEStudio.scene.update(i, { visible: true }), id); return r; })();
      void b;
      h.assert(diff(a, ref) > 8, mode + ' @' + s + ': pixels inside the box change (' + diff(a, ref).toFixed(1) + ')');
      h.assert(detail(a) < detail(ref) * (mode === 'pixelate' ? 0.35 : 0.25), mode + ' @' + s + ': fine detail is destroyed (' + detail(a).toFixed(2) + ' vs ' + detail(ref).toFixed(2) + ')');
    }
    const out = await grab(page, 1, OUTSIDE);
    h.assert(diff(out, outBefore) < 0.5, mode + ': pixels outside the box are untouched');
    if (mode === 'solid') {
      const a = await grab(page, 1, { x: 100, y: 540, w: 800, h: 80 });
      h.assert(a.g.every((v) => Math.abs(v - a.g[0]) <= 1), 'solid: one flat colour');
    }
    /* The hidden scene used by multi-page PDF and every-size exports renders it too. */
    const hid = await grab(page, 1, TEXT, { hidden: true });
    h.assert(diff(hid, before) > 8 && detail(hid) < detail(before) * 0.25, mode + ': hidden-scene export (PDF pages) is redacted');
    await page.evaluate((i) => window.LEStudio.scene.remove([i]), id);
  }
  h.assert.noErrors(page);
};
});

cases['strength is safe by default and scales with export size'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base);
  const id = await page.evaluate(() => window.LEStudioPrivacy.add({ x: 70, y: 510, w: 920, h: 140 }, 'pixelate'));
  const k = await page.evaluate((i) => LE.Scene.redactSize(window.LEStudio.scene.layer(i)), id);
  h.assert(k >= 140 / 10 && k >= 12, 'automatic block size is coarse: ' + k);
  h.assert(k >= 90 * 0.3, 'blocks are a sizeable part of the text height: ' + k + ' vs 90 px text');
  const at1 = await grab(page, 1, { x: 80, y: 520, w: 880, h: 120 });
  const at2 = await grab(page, 2, { x: 80, y: 520, w: 880, h: 120 });
  const r1 = runLength(at1), r2 = runLength(at2);
  h.assert(r1 > k * 0.6, 'pixel blocks at 1×: ' + r1.toFixed(1) + ' vs ' + k);
  h.assert(r2 / r1 > 1.6 && r2 / r1 < 2.4, 'block size doubles at 2× export: ' + r1.toFixed(1) + ' → ' + r2.toFixed(1));
  /* A user cannot weaken it below the floor. */
  await page.evaluate((i) => window.LEStudio.scene.update(i, { redact: { mode: 'pixelate', amount: 1, color: '#17131F' } }), id);
  const kf = await page.evaluate((i) => LE.Scene.redactSize(window.LEStudio.scene.layer(i)), id);
  h.assert(kf >= 14, 'floor keeps blocks at least a tenth of the box: ' + kf);
  await page.evaluate((i) => window.LEStudio.scene.update(i, { redact: { mode: 'blur', amount: 0, color: '#17131F' } }), id);
  const kb = await page.evaluate((i) => LE.Scene.redactSize(window.LEStudio.scene.layer(i)), id);
  h.assert(kb >= 140 / 4, 'automatic blur radius is strong: ' + kb);
  /* Sharpening the blurred export does not bring the text back: detail stays far below the original. */
  const b1 = await grab(page, 1, TEXT), b2 = await grab(page, 2, TEXT);
  await page.evaluate((i) => window.LEStudio.scene.update(i, { visible: false }), id);
  const o1 = await grab(page, 1, TEXT), o2 = await grab(page, 2, TEXT);
  h.assert(detail(b1) < detail(o1) * 0.15 && detail(b2) < detail(o2) * 0.15, 'blurred text keeps under 15% of its original detail at 1× and 2×: ' + [detail(b1), detail(o1), detail(b2), detail(o2)].map((v) => v.toFixed(2)));
  h.assert.noErrors(page);
};

cases['Apply permanently bakes the photo, drops the original from the project, one undo step'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base);
  const box = { x: 700, y: 200, w: 260, h: 200 };
  await page.evaluate((b) => window.LEStudioPrivacy.add(b, 'pixelate'), box);
  const photoBox = { x: 720, y: 220, w: 220, h: 160 };
  const shown = await grab(page, 1, photoBox);
  const r = await page.evaluate(async () => {
    const c = window.LEStudio;
    const street = c.scene.layers().find((l) => l.name === 'Street photo');
    const before = street.src;
    const plan = window.LEStudioPrivacy.plan();
    const undoN = c.scene._hist.undo.length;
    const res = await window.LEStudioPrivacy.bake();
    const after = c.scene.layers().find((l) => l.name === 'Street photo').src;
    c.syncProject();
    const ids = LE.project.assetIds(c.S.project);
    return { before, after, plan, res, streetId: street.id, inAssets: !!c.S.project.assets[before], inIds: ids.indexOf(before) >= 0, newIn: ids.indexOf(after) >= 0, steps: c.scene._hist.undo.length - undoN };
  });
  h.assert(r.plan.photos.indexOf(r.streetId) >= 0, 'the photo under the box is found');
  h.assert(r.res.baked === r.plan.photos.length && r.after !== r.before, 'the photo now points at a new asset');
  h.assert(!r.inAssets && !r.inIds, 'the original photo is no longer part of the project');
  h.assert(r.newIn, 'the redacted copy is');
  h.assert.equal(r.steps, 1, 'one undo step');
  /* The new asset itself is redacted: hide the redaction layer and the photo still shows blocks. */
  await page.evaluate(() => { const c = window.LEStudio; c.scene.layers().filter((l) => l.redact).forEach((l) => c.scene.update(l.id, { visible: false })); });
  const baked = await grab(page, 1, photoBox);
  await page.evaluate(() => { const c = window.LEStudio; c.scene.layers().filter((l) => l.redact).forEach((l) => c.scene.update(l.id, { visible: true })); });
  h.assert(diff(baked, shown) < 25, 'the baked photo looks like the redacted preview (' + diff(baked, shown).toFixed(1) + ')');
  const unredacted = await page.evaluate(async () => {
    const c = window.LEStudio;
    c.scene.undo(); c.scene.undo(); c.scene.undo();
    return { src: c.scene.layers().find((l) => l.name === 'Street photo').src, back: !!c.S.project.assets[c.scene.layers().find((l) => l.name === 'Street photo').src] };
  });
  h.assert(unredacted.src === r.before && unredacted.back, 'undo brings the original back into the project');
  h.assert(detail(baked) < detail(await (async () => { await page.evaluate(() => { const c = window.LEStudio; c.scene.layers().filter((l) => l.redact).forEach((l) => c.scene.update(l.id, { visible: false })); }); return grab(page, 1, photoBox); })()) * 0.5, 'baked area has lost its detail');
  h.assert.noErrors(page);
};

cases['entry points: Elements card, photo toolbar Redact, draw a box, redaction toolbar and panel'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base);
  await h.openPanel(page, 'elements');
  h.assert(await page.evaluate(() => !!document.querySelector('#sx-panel-body .sxp-entry .sxp-mode[data-mode="solid"]')), 'Elements panel offers Redact');
  await page.evaluate(() => { const c = window.LEStudio; c.closePanel(); c.scene.select([c.scene.layers().find((l) => l.type === 'image').id]); });
  await page.waitForTimeout(300);
  await page.click('#sx-tool [data-cmd="redactStart"]');
  h.assert(await page.evaluate(() => window.LEStudioPrivacy.drawing()), 'Redact on the photo toolbar starts drawing');
  const pr = await page.evaluate(() => { const r = window.LEStudio.scene.pageRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const d = await h.doc(page);
  await page.mouse.move(pr.l + pr.w * 0.1, pr.t + pr.h * 0.2);
  await page.mouse.down();
  await page.mouse.move(pr.l + pr.w * 0.4, pr.t + pr.h * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const l = (await h.doc(page)).layers.find((x) => x.redact);
  h.assert(l, 'drawing a box adds a redaction');
  h.assert(Math.abs(l.x - d.width * 0.1) < d.width * 0.02 && Math.abs(l.w - d.width * 0.3) < d.width * 0.03, 'the box lands where it was drawn: ' + [l.x, l.y, l.w, l.h]);
  h.assert(await page.evaluate(() => !!document.querySelector('#sx-tool [data-cmd="redactMode:pixelate"]')), 'a selected redaction has its own toolbar');
  await page.click('#sx-tool [data-cmd="redactMode:pixelate"]');
  h.assert.equal((await h.doc(page)).layers.find((x) => x.redact).redact.mode, 'pixelate', 'mode switch from the toolbar');
  await page.click('#sx-tool [data-cmd="redactPanel"]');
  await page.waitForTimeout(250);
  const panel = await page.evaluate(() => ({ text: document.getElementById('sx-panel-body').textContent, bake: !!document.querySelector('#sx-panel-body .sxp-bake:not(:disabled)') }));
  h.assert(/safer/.test(panel.text) && /project still has the original/i.test(panel.text), 'panel recommends Box for text and is honest about the project file');
  h.assert(panel.bake, 'Apply permanently is offered when a photo is underneath');
  await page.click('#sx-panel-body .sxp-bake');
  await page.waitForTimeout(200);
  h.assert(await page.evaluate(() => /removes the original/.test(document.getElementById('sx-modal').textContent)), 'Apply permanently asks first, with a clear warning');
  await page.keyboard.press('Escape');
  h.assert.noErrors(page);
};

cases['phone 360: draw a redaction, toolbar and panel, no sideways scroll'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base, 'small');
  await h.openPanel(page, 'elements');
  await page.tap('#sx-panel-body .sxp-entry .sxp-mode[data-mode="blur"]');
  await page.waitForTimeout(250);
  h.assert(await page.evaluate(() => window.LEStudioPrivacy.drawing()), 'tapping Blur starts drawing');
  const hint = await page.evaluate(() => { const r = document.querySelector('.sxp-draw-hint .btn').getBoundingClientRect(); return [r.height, r.right <= innerWidth]; });
  h.assert(hint[1], 'Cancel is on screen');
  const pr = await page.evaluate(() => { const r = window.LEStudio.scene.pageRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  await page.tap('.sxp-draw', { position: { x: Math.round(pr.l + pr.w / 2), y: Math.round(pr.t + pr.h / 2) - await page.evaluate(() => document.querySelector('.sxp-draw').getBoundingClientRect().top) } });
  await page.waitForTimeout(300);
  const l = (await h.doc(page)).layers.find((x) => x.redact);
  h.assert(l && l.redact.mode === 'blur', 'a tap drops a default blur box');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  await h.openPanel(page, 'redact');
  const small = await page.evaluate(() => [...document.querySelectorAll('#sx-panel-body .sxp-mode, #sx-panel-body .sxp-bake, #sx-panel-body .sxp-ink')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height).filter((v) => v < 44));
  h.assert.equal(small.length, 0, '44px targets in the panel');
  h.assert(await h.noOverflow(page), 'no sideways scroll with the panel open');
  h.assert.noErrors(page);
};

module.exports = cases;
