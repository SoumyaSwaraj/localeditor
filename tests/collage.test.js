'use strict';
/* Collage builder, photo-slot interactions, the style catalogue and attribution. Asserts on the scene document. */

/* Ingests n pool photos (served locally) and builds a grid collage from them. Returns the asset ids. */
async function grid(page, n, opts) {
  return page.evaluate(async ([n, opts]) => {
    const c = window.LEStudio;
    const data = await LE.collage.photos();
    const ids = [];
    for (let i = 0; i < n; i++) {
      const p = data.photos[i * 3 % data.photos.length];
      const blob = await (await fetch('/' + p.file)).blob();
      const f = new File([blob], p.id + '.jpg', { type: 'image/jpeg' });
      f.source = { provider: 'pool', photographer: p.photographer, pageUrl: p.url, license: p.license, attribution: p.attribution };
      ids.push((await c.ingest(f)).id);
    }
    LEStudioCollage.createGrid(c, (opts && opts.empty) ? ids.map(() => '') : ids, opts || {});
    return ids;
  }, [n, opts || null]);
}
const slots = (d) => d.layers.filter((l) => l.type === 'image' && l.slot);
const undoLen = (page) => page.evaluate(() => window.LEStudio.scene._hist.undo.length);
async function cellCenter(page, sid) {
  return page.evaluate((sid) => {
    const c = window.LEStudio;
    const l = c.scene.layers().find((x) => x.slot && x.slot.id === sid);
    const r = c.scene.screenRect(l.id);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: l.id };
  }, sid);
}
/* Drives a ui.slider like a person: pointerdown, several inputs, change. */
async function slide(page, label, values) {
  await page.evaluate(([label, values]) => {
    const node = [...document.querySelectorAll('#sx-panel-body .sx-slider')].find((n) => n.querySelector('label').textContent === label);
    const input = node.querySelector('input');
    input.dispatchEvent(new Event('pointerdown'));
    values.forEach((v) => { input.value = v; input.dispatchEvent(new Event('input')); });
  }, [label, values]);
  await page.waitForTimeout(80);
  await page.evaluate((label) => {
    const node = [...document.querySelectorAll('#sx-panel-body .sx-slider')].find((n) => n.querySelector('label').textContent === label);
    node.querySelector('input').dispatchEvent(new Event('change'));
  }, label);
  await page.waitForTimeout(80);
}

const cases = {};

cases['builder makes N independent photo slots and stores its state in the document'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.openPanel(page, 'apps', { app: 'collage' });
  await grid(page, 6);
  await page.waitForTimeout(200);
  const d = await h.doc(page);
  const s = slots(d);
  h.assert.equal(s.length, 6, 'six slot layers');
  h.assert(s.every((l) => !l.groupId && l.src), 'cells are top-level and filled');
  h.assert(d.layers.every((l) => l.type !== 'group'), 'no groups');
  h.assert(d.collage && d.collage.v === 1 && d.collage.cells.length === 6 && d.collage.order.length === 6, 'collage meta');
  h.assert.equal(new Set(s.map((l) => l.slot.id)).size, 6, 'unique slot ids');
  h.assert.equal(d.width, 1080);
  /* Every cell sits inside the margin, with the default spacing between neighbours. */
  s.forEach((l) => h.assert(l.x >= 23.9 && l.y >= 23.9 && l.x + l.w <= 1056.1 && l.y + l.h <= 1056.1, 'inside margin'));
  const layouts = await page.evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map((n) => LE.collage.layouts(n, 1).length));
  h.assert(layouts[0] === 1 && layouts.slice(2).every((n) => n >= 8), 'layouts generated per count: ' + layouts);
  h.assert(await page.isVisible('.sx-cl-layouts'), 'tune view shows layouts');
  h.assert.noErrors(page);
};

cases['spacing, margin, radius and border land in the doc as one undo step each'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.openPanel(page, 'apps', { app: 'collage' });
  await grid(page, 4);
  await page.waitForTimeout(300);
  for (const [label, vals, check] of [
    ['Between photos', [20, 30, 40], (d) => d.collage.spacing === 40],
    ['Outer margin', [10, 50, 60], (d) => d.collage.margin === 60],
    ['Corner radius', [12, 24], (d) => d.collage.radius === 24 && slots(d).every((l) => l.radius === 24)],
    ['Width', [4, 10], (d) => d.collage.border.width === 10 && slots(d).every((l) => l.border && l.border.width === 10)]
  ]) {
    const before = await h.doc(page);
    const n0 = await undoLen(page);
    await slide(page, label, vals);
    const d = await h.doc(page);
    h.assert(check(d), label + ' did not land: ' + JSON.stringify(d.collage));
    h.assert.equal(await undoLen(page), n0 + 1, label + ' undo steps');
    await page.evaluate(() => window.LEStudio.scene.undo());
    const back = await h.doc(page);
    h.assert.equal(JSON.stringify(back.collage), JSON.stringify(before.collage), label + ' undo restores meta');
    await page.evaluate(() => window.LEStudio.scene.redo());
  }
  const d = await h.doc(page);
  const s = slots(d).sort((a, b) => a.x - b.x || a.y - b.y);
  h.assert(Math.abs(s[0].x - 60) < 0.6, 'margin applied to geometry');
  const right = s.find((l) => l.x > s[0].x + 10 && Math.abs(l.y - s[0].y) < 1);
  h.assert(right && Math.abs(right.x - (s[0].x + s[0].w) - 40) < 0.6, 'spacing applied between cells');
  /* Background swatch: one click, one step, compatible with doc.background. */
  const n0 = await undoLen(page);
  await page.click('[aria-label="Background colour"] button[aria-label="#17131F"]');
  await page.waitForTimeout(150);
  h.assert.equal((await h.doc(page)).background.color, '#17131F');
  h.assert.equal(await undoLen(page), n0 + 1, 'background one step');
  h.assert.noErrors(page);
};

cases['shuffle, next layout, count and size keep the photos'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.openPanel(page, 'apps', { app: 'collage' });
  const ids = await grid(page, 5);
  await page.waitForTimeout(300);
  const srcs = (d) => slots(d).map((l) => l.src).sort().join();
  const want = ids.slice().sort().join();
  const first = (await h.doc(page)).collage.layout;
  await page.click('.sx-cl-act:has-text("Next layout")');
  await page.waitForTimeout(200);
  let d = await h.doc(page);
  h.assert(d.collage.layout !== first, 'layout changed');
  h.assert.equal(srcs(d), want, 'photos kept after layout change');
  const order = slots(d).map((l) => l.src).join();
  await page.click('.sx-cl-act:has-text("Shuffle")');
  await page.waitForTimeout(200);
  d = await h.doc(page);
  h.assert.equal(srcs(d), want, 'photos kept after shuffle');
  h.assert(slots(d).map((l) => l.src).join() !== order, 'shuffle moved photos');
  await page.click('.sx-cl-lay:nth-child(3)');
  await page.waitForTimeout(150);
  d = await h.doc(page);
  h.assert.equal(srcs(d), want, 'photos kept after picking a layout');
  await page.click('.sx-cl-asp:has-text("Story")');
  await page.waitForTimeout(200);
  d = await h.doc(page);
  h.assert(d.width === 1080 && d.height === 1920 && d.collage.aspect === '9:16', 'story size');
  h.assert(slots(d).every((l) => l.y + l.h <= 1920 && l.y >= 0), 'cells re-laid for the new size');
  await page.click('.sx-cl-countrow button[aria-label="More"]');
  await page.waitForTimeout(200);
  d = await h.doc(page);
  h.assert(slots(d).length === 6 && d.collage.order.length === 6 && slots(d).filter((l) => !l.src).length === 1, 'added an empty cell');
  await page.click('.sx-cl-countrow button[aria-label="Fewer"]');
  await page.waitForTimeout(200);
  d = await h.doc(page);
  h.assert.equal(srcs(d), want, 'removing a cell drops the empty one first');
  h.assert.noErrors(page);
};

cases['drag a photo onto another cell to swap; frames stay'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await grid(page, 4);
  await page.evaluate(() => LEStudioCollage.tune(window.LEStudio, { radius: 30, border: { width: 6, color: '#FFFFFF' } }));
  await page.waitForTimeout(300);
  const before = await h.doc(page);
  const [a, b] = before.collage.order;
  const A = await cellCenter(page, a), B = await cellCenter(page, b);
  const n0 = await undoLen(page);
  await page.mouse.move(A.x, A.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(A.x + (B.x - A.x) * i / 8, A.y + (B.y - A.y) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await h.doc(page);
  const la0 = before.layers.find((l) => l.id === A.id), lb0 = before.layers.find((l) => l.id === B.id);
  const la = after.layers.find((l) => l.id === A.id), lb = after.layers.find((l) => l.id === B.id);
  h.assert(la.src === lb0.src && lb.src === la0.src, 'photos swapped');
  h.assert(la.x === la0.x && la.y === la0.y && lb.x === lb0.x, 'frames stayed put');
  h.assert(la.radius === 30 && la.border.width === 6, 'frame style kept');
  h.assert.equal(await page.evaluate(() => LEStudioCollage.drift(window.LEStudio)), 0, 'no drift after swap');
  h.assert.equal(await undoLen(page), n0 + 1, 'swap is one undo step');
  /* API form used by agents. */
  h.assert(await page.evaluate(([x, y]) => window.LEStudio.scene.swapSlots(x, y), [A.id, B.id]), 'swapSlots');
  h.assert.equal((await h.doc(page)).layers.find((l) => l.id === A.id).src, la0.src, 'swapped back');
  h.assert.noErrors(page);
};

cases['double-click a cell to pan and zoom inside it; only the crop changes'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await grid(page, 2);
  await page.evaluate(() => LEStudioCollage.tune(window.LEStudio, { radius: 40 }));
  await page.waitForTimeout(300);
  const d0 = await h.doc(page);
  const sid = d0.collage.order[0];
  const P0 = await cellCenter(page, sid);
  const l0 = d0.layers.find((l) => l.id === P0.id);
  await page.mouse.dblclick(P0.x, P0.y);
  await page.waitForTimeout(150);
  h.assert.equal(await page.evaluate(() => window.LEStudio.scene.tool()), 'crop', 'crop mode');
  h.assert(await page.evaluate(() => document.querySelector('.le-crop').classList.contains('is-pan')), 'pan crop for slots');
  h.assert(await page.isVisible('#sx-tool [data-cmd="cellZoom:in"]'), 'slot crop toolbar');
  await page.mouse.move(P0.x, P0.y);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  let l = (await h.doc(page)).layers.find((x) => x.id === P0.id);
  h.assert(l.crop.w < l0.crop.w * 0.8, 'wheel zoomed in: ' + l.crop.w);
  const mid = l.crop;
  await page.mouse.move(P0.x, P0.y);
  await page.mouse.down();
  await page.mouse.move(P0.x + 40, P0.y + 30, { steps: 5 });
  await page.mouse.up();
  l = (await h.doc(page)).layers.find((x) => x.id === P0.id);
  h.assert(l.crop.x < mid.x && Math.abs(l.crop.w - mid.w) < 1e-9, 'drag panned the photo');
  h.assert(l.x === l0.x && l.y === l0.y && l.w === l0.w && l.h === l0.h && l.radius === 40, 'frame unchanged');
  const n0 = await undoLen(page);
  const out = await page.evaluate(() => { const r = window.LEStudio.E.sceneEl.getBoundingClientRect(); return { x: r.left + 12, y: r.bottom - 12 }; });
  await page.mouse.click(out.x, out.y);
  await page.waitForTimeout(100);
  h.assert.equal(await page.evaluate(() => window.LEStudio.scene.tool()), 'select', 'tap outside ends crop');
  h.assert.equal(await undoLen(page), n0 + 1, 'crop is one undo step');
  /* Zoom out past cover is clamped: the photo always fills its cell. */
  await page.evaluate((id) => window.LEStudio.scene.zoomSlot(id, 0.01), P0.id);
  l = (await h.doc(page)).layers.find((x) => x.id === P0.id);
  h.assert(Math.abs(Math.max(l.crop.w, l.crop.h) - 1) < 1e-6, 'zoom out stops at cover');
  h.assert.noErrors(page);
};

cases['double-click on a cell still crops when the page background is a photo'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const ids = await grid(page, 2);
  await page.evaluate((src) => window.LEStudio.scene.setBackground({ type: 'image', src: src, fit: 'cover', color: '#ffffff' }), ids[1]);
  await page.waitForTimeout(200);
  const P0 = await cellCenter(page, (await h.doc(page)).collage.order[0]);
  await page.mouse.dblclick(P0.x, P0.y);
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => window.LEStudio.scene.tool()), 'crop', 'cell crop wins');
  h.assert.noErrors(page);
};

cases['pinch inside a cell on touch zooms the photo, not the page'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'phone');
  await grid(page, 2);
  await page.waitForTimeout(300);
  const d0 = await h.doc(page);
  const P0 = await cellCenter(page, d0.collage.order[0]);
  await page.evaluate((id) => window.LEStudio.startCrop(id), P0.id);
  const zoom0 = await page.evaluate(() => window.LEStudio.scene.zoom());
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: P0.x - d, y: P0.y, id: 1 }, { x: P0.x + d, y: P0.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
  for (const d of [30, 45, 60, 75]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  const l = (await h.doc(page)).layers.find((x) => x.id === P0.id);
  const l0 = d0.layers.find((x) => x.id === P0.id);
  h.assert(l.crop.w < l0.crop.w * 0.6, 'pinch zoomed the photo: ' + l.crop.w + ' vs ' + l0.crop.w);
  h.assert.equal(await page.evaluate(() => window.LEStudio.scene.zoom()), zoom0, 'page zoom unchanged');
  h.assert(l.w === l0.w && l.x === l0.x, 'frame unchanged');
  h.assert.noErrors(page);
};

cases['replacing a cell keeps mask, radius, border, rotation and shadow'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const ids = await grid(page, 3);
  const res = await page.evaluate(async (ids) => {
    const c = window.LEStudio;
    const l = c.scene.layers().filter((x) => x.slot)[0];
    c.scene.update(l.id, { mask: 'heart', radius: 18, border: { width: 7, color: '#E2B15A' }, rotation: 4, shadow: { color: 'rgba(0,0,0,.3)', blur: 10, x: 0, y: 4 } });
    c.scene.select([l.id]);
    const before = c.L(l.id);
    const sample = c.scene.layers().find((x) => x.type === 'image' && !x.slot);
    await c.replaceImage(ids[2] === l.src ? ids[0] : ids[2]);
    return { before: before, after: c.L(l.id), mem: c.mem[c.L(l.id).src].canvas.width / c.mem[c.L(l.id).src].canvas.height, sample: !!sample };
  }, ids);
  const a = res.after, b = res.before;
  h.assert(a.src !== b.src, 'photo replaced');
  ['mask', 'radius', 'rotation', 'x', 'y', 'w', 'h'].forEach((k) => h.assert.equal(a[k], b[k], k + ' kept'));
  h.assert.equal(JSON.stringify(a.border), JSON.stringify(b.border), 'border kept');
  h.assert.equal(JSON.stringify(a.shadow), JSON.stringify(b.shadow), 'shadow kept');
  h.assert.equal(JSON.stringify(a.slot), JSON.stringify(b.slot), 'slot kept');
  const shown = (a.crop.w * res.mem) / a.crop.h;
  h.assert(Math.abs(shown - a.w / a.h) < 0.02, 'cover crop for the new aspect');
  /* Dropping a file on a cell replaces just that cell. */
  const r2 = await page.evaluate(async () => {
    const c = window.LEStudio;
    const cells = c.scene.layers().filter((x) => x.slot);
    const target = cells[1];
    const r = c.scene.screenRect(target.id);
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200;
    cv.getContext('2d').fillRect(0, 0, 300, 200);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
    c.E.stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt }));
    await new Promise((ok) => setTimeout(ok, 800));
    const after = c.scene.layers().filter((x) => x.slot);
    return { changed: after.filter((x, i) => x.src !== cells[i].src).map((x) => x.id), target: target.id, count: c.scene.layers().length - cells.length };
  });
  h.assert.equal(r2.changed.join(), r2.target, 'only the dropped-on cell changed');
  h.assert.noErrors(page);
};

cases['reopening the panel restores controls from the doc; project round trip keeps it'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await grid(page, 4);
  await page.evaluate(() => LEStudioCollage.tune(window.LEStudio, { spacing: 33, margin: 70, radius: 21, border: { width: 9, color: '#17131F' } }));
  await page.evaluate(() => LEStudioCollage.setLayout(window.LEStudio, 'h-l-62'));
  await page.evaluate(() => { window.LEStudio.closePanel(); });
  await h.openPanel(page, 'apps', { app: 'collage' });
  const vals = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#sx-panel-body .sx-slider').forEach((n) => { out[n.querySelector('label').textContent] = Number(n.querySelector('input').value); });
    out.layout = document.querySelectorAll('.sx-cl-lay[aria-selected="true"]').length;
    out.border = document.querySelector('[aria-label="Border colour"] [aria-pressed="true"]').getAttribute('aria-label');
    return out;
  });
  h.assert(vals['Between photos'] === 33 && vals['Outer margin'] === 70 && vals['Corner radius'] === 21 && vals.Width === 9, 'sliders from doc: ' + JSON.stringify(vals));
  h.assert(vals.layout === 1 && vals.border === '#17131F', 'layout and border colour from doc');
  /* Moving a cell by hand degrades gracefully: banner + re-apply. */
  await page.evaluate(() => { const c = window.LEStudio; const l = c.scene.layers().find((x) => x.slot); c.scene.update(l.id, { x: l.x + 80 }); });
  await page.waitForTimeout(250);
  h.assert(await page.isVisible('.sx-cl-banner.is-warn'), 'drift banner');
  await page.click('.sx-cl-banner.is-warn button');
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => LEStudioCollage.drift(window.LEStudio)), 0, 're-applied');
  /* Save → export → import keeps doc.collage and the source fields (photographerUrl too). */
  const rt = await page.evaluate(async () => {
    const c = window.LEStudio;
    const l = c.scene.layers().find((x) => x.slot);
    c.S.project.assets[l.src].source = Object.assign({}, c.S.project.assets[l.src].source, { photographerUrl: 'https://unsplash.com/@someone?utm_source=localeditor&utm_medium=referral' });
    c.syncProject();
    const blob = await LE.project.exportFile(c.S.project);
    const back = await LE.project.readFile(new File([blob], 'x.leproject'));
    const page = back.project.pages[back.project.activePage];
    return { collage: page.collage, live: c.scene.collage(), src: back.project.assets[l.src].source };
  });
  h.assert.equal(JSON.stringify(rt.collage), JSON.stringify(rt.live), 'collage survives .leproject');
  h.assert(/unsplash\.com\/@someone/.test(rt.src.photographerUrl || ''), 'photographerUrl survives .leproject');
  h.assert.noErrors(page);
};

cases['every style pack loads and every template applies'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const res = await page.evaluate(async () => {
    const c = window.LEStudio;
    const idx = await LE.collage.index();
    const bad = [];
    let n = 0, attached = {};
    for (const s of idx.styles) {
      const pack = await LE.collage.loadStyle(s.id);
      if (!pack || pack.templates.length !== s.count) bad.push(s.id + ' count');
      if (s.group === 'style') attached[s.id] = pack.templates.length;
      for (const t of pack.templates) {
        c.scene.load(LE.Scene.blank(1080, 1080));
        await LEStudioCollage.applyTemplate(c, t, { fill: 'empty' });
        const d = c.scene.toJSON();
        const got = d.layers.filter((l) => l.slot).length;
        if (got !== t.slots.length || d.width !== t.w || d.height !== t.h || !d.collage || d.collage.template !== t.id) bad.push(t.id);
        n++;
      }
    }
    return { n, bad, attached, templates: idx.templates.length };
  });
  h.assert.equal(res.bad.length, 0, 'failed: ' + res.bad.slice(0, 5).join(','));
  h.assert.equal(res.n, res.templates, 'applied every template');
  h.assert(Object.keys(res.attached).length === 21 && Object.values(res.attached).every((k) => k >= 8 && k <= 12), 'reference styles have 8–12 variations');
  /* A real fill from the pool. */
  const filled = await page.evaluate(async () => {
    const c = window.LEStudio;
    c.scene.load(LE.Scene.blank(1080, 1080));
    const pack = await LE.collage.loadStyle('coquette');
    await LEStudioCollage.applyTemplate(c, pack.templates[0], {});
    return c.scene.layers().filter((l) => l.slot && l.src).length;
  });
  h.assert(filled >= 3, 'pool filled the slots');
  h.assert.noErrors(page);
};

cases['catalogue search and filters, and Design → Templates'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.openPanel(page, 'apps', { app: 'collage' });
  await page.click('.sx-cl-tabs button:has-text("Styles")');
  await page.waitForSelector('.sx-cg-card');
  const styleCards = await page.locator('.sx-cg-card').count();
  h.assert(styleCards >= 40, 'style cards: ' + styleCards);
  await page.click('.sx-cg-card:has-text("Coquette")');
  await page.waitForFunction(() => document.querySelectorAll('.sx-cg-card').length >= 8);
  h.assert(await page.locator('.sx-cg-card .sx-cg-slot').count() > 20, 'variations show slot art');
  await page.click('.sx-cg-head button');
  await page.click('.sx-cg-chip:has-text("Landscape")');
  await page.click('.sx-cg-chip:has-text("4–6")');
  await page.waitForTimeout(100);
  const ok = await page.evaluate(() => [...document.querySelectorAll('.sx-cg-card small')].every((s) => { const m = /(\d+) photos? · (\d+)×(\d+)/.exec(s.textContent); return m && +m[1] >= 4 && +m[1] <= 6 && +m[2] > +m[3]; }));
  h.assert(ok, 'filters respected');
  await page.fill('.sx-cg-search input', 'polaroid');
  await page.waitForTimeout(250);
  const meta = await page.textContent('.sx-cg-meta');
  h.assert(/\d+ collage/.test(meta), 'search result count');
  await h.openPanel(page, 'design', { tab: 'templates' });
  await page.waitForSelector('.sx-cg-card');
  h.assert(await page.locator('.sx-cg-card').count() >= 10, 'design templates show featured collages');
  h.assert.noErrors(page);
};

cases['attribution line and credits for sourced photos'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await grid(page, 3);
  await page.waitForTimeout(200);
  const P0 = await cellCenter(page, (await h.doc(page)).collage.order[0]);
  await page.mouse.click(P0.x, P0.y);
  await page.waitForTimeout(150);
  h.assert(await page.isVisible('.sx-attr'), 'attribution visible');
  const txt = await page.textContent('.sx-attr');
  h.assert(/CC|Public|BY/i.test(txt), 'licence shown: ' + txt);
  await page.click('.sx-attr-btn');
  await page.waitForSelector('.sx-credits-list li');
  h.assert.equal(await page.locator('.sx-credits-list li').count(), 3, 'three credits');
  const text = await page.inputValue('.sx-credits-text');
  h.assert(text.split('\n').length === 3 && /licensed|CC/i.test(text), 'copyable credits');
  await page.evaluate(() => window.LEStudio.closeModal());
  /* An unsourced photo has no attribution line. */
  await page.evaluate(() => {
    const c = window.LEStudio;
    const own = Object.keys(c.mem).find((id) => !(c.mem[id].meta && c.mem[id].meta.source));
    c.scene.select([c.placeImage(own)]);
  });
  await page.waitForTimeout(100);
  h.assert(!(await page.isVisible('.sx-attr')), 'no line for own photo');
  h.assert.noErrors(page);
};

['phone', 'small'].forEach((vp) => {
  cases['phone flow at ' + vp + ': build, tap an empty cell, no sideways scroll'] = async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, vp);
    await h.openPanel(page, 'apps', { app: 'collage' });
    h.assert(await h.noOverflow(page), 'start view overflow');
    await page.click('.sx-cl-sources button:has-text("Samples")');
    await page.waitForFunction(() => document.querySelectorAll('.sx-cl-ptile[aria-pressed="true"]').length >= 4, null, { timeout: 30000 });
    await page.click('.sx-cl-go');
    await page.waitForSelector('.sx-cl-layouts');
    h.assert(await h.noOverflow(page), 'tune view overflow');
    const small = await page.evaluate(() => [...document.querySelectorAll('.sx-cl-act, .sx-cl-step button, .sx-cl-asp, .sx-cl-sw')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 36)).length);
    h.assert.equal(small, 0, 'touch targets');
    await page.click('.sx-cl-countrow button[aria-label="More"]');
    await page.waitForTimeout(250);
    await page.evaluate(() => window.LEStudio.closePanel());
    await page.waitForTimeout(250);
    const empty = await page.evaluate(() => { const c = window.LEStudio; const l = c.scene.layers().find((x) => x.slot && !x.src); const r = c.scene.screenRect(l.id); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(empty.x, empty.y);
    await page.waitForSelector('.sx-rep-root', { timeout: 3000 });
    h.assert(await h.noOverflow(page), 'picker overflow');
    await page.evaluate(() => window.LEStudio.closeModal());
    const full = await page.evaluate(() => { const c = window.LEStudio; const l = c.scene.layers().find((x) => x.slot && x.src); const r = c.scene.screenRect(l.id); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(full.x, full.y);
    await page.waitForTimeout(200);
    h.assert(await page.isVisible('.sx-rep-chip[data-mode="touch"] [data-act="replace"]'), 'touch Replace affordance');
    h.assert(await page.isVisible('.sx-rep-chip [data-act="move"]'), 'touch Reframe affordance');
    h.assert.noErrors(page);
  };
});

module.exports = cases;
