'use strict';
/* Background studio (1.2): photo backgrounds that can be fitted, framed, flipped, blurred, dimmed and adjusted. */

/* Studio with one text layer and a portrait photo as the background of the 1200 × 800 sample page. */
async function setup(h, browser, base, viewport) {
  const page = await h.studioWithSample(browser, base, viewport);
  await page.evaluate(async () => {
    const c = window.LEStudio;
    c.scene.remove(c.scene.layers().map((l) => l.id));
    c.addText({ text: 'Hello', size: 90 });
    c.scene.select([]);
    const blob = await (await fetch('/assets/photos/collage/arch-02.jpg')).blob();
    const meta = await c.ingest(new File([blob], 'arch-02.jpg', { type: 'image/jpeg' }));
    window.__photo = meta.id;
    window.LEStudioBackground.setPhoto(c, meta.id, { quiet: true });
  });
  await page.waitForTimeout(150);
  return page;
}
/* JSON with sorted keys, so field order does not matter. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
const bg = (page) => page.evaluate(() => window.LEStudio.scene.toJSON().background);
async function clickText(page, scope, text) {
  const ok = await page.evaluate(([sel, t]) => {
    const b = [...document.querySelectorAll(sel + ' button')].find((x) => x.textContent.trim() === t && x.offsetParent);
    if (b) b.click();
    return !!b;
  }, [scope, text]);
  if (!ok) throw new Error('No visible button "' + text + '" in ' + scope);
  await page.waitForTimeout(120);
}
/* Drives a panel slider like a person would: input events then change. */
async function setSlider(page, label, value) {
  const ok = await page.evaluate(([l, v]) => {
    const row = [...document.querySelectorAll('#sx-panel-body .sx-slider')].find((n) => n.querySelector('label').textContent.trim() === l);
    if (!row) return false;
    const input = row.querySelector('input[type=range]');
    input.dispatchEvent(new Event('pointerdown'));
    input.value = v;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    return true;
  }, [label, value]);
  if (!ok) throw new Error('No slider "' + label + '"');
  await page.waitForTimeout(80);
}
async function pageBox(page) { return page.evaluate(() => { const r = window.LEStudio.scene.pageRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }); }

const cases = {};

cases['photo background: panel fit modes, rotate, flip, blur, dim, adjust land in the document'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base, 'desktop');
  await h.openPanel(page, 'background');
  h.assert(await page.evaluate(() => !!document.querySelector('.sxb-hero')), 'Photo tab opens with the current-background card');
  let b = await bg(page);
  h.assert.equal(b.type, 'image');
  h.assert.equal(b.fit, 'cover');
  for (const [label, fit] of [['Fit', 'contain'], ['Stretch', 'fill'], ['Tile', 'tile'], ['Fill', 'cover']]) {
    await clickText(page, '.sxb-fits', label);
    await page.waitForTimeout(300);
    h.assert.equal((await bg(page)).fit, fit, 'Fit ' + label);
  }
  await page.evaluate(() => document.querySelector('[data-bgq="1"]').click());
  await page.evaluate(() => document.querySelector('[data-bgq="2"]').click());
  await page.evaluate(() => document.querySelector('[data-bgq="3"]').click());
  b = await bg(page);
  h.assert.equal(b.rotation, 90, 'rotate right');
  h.assert.equal(b.flipX, true, 'mirror');
  h.assert.equal(b.flipY, true, 'flip');
  await page.evaluate(() => document.querySelector('[data-bgq="0"]').click());
  h.assert.equal((await bg(page)).rotation, 0, 'rotate left');
  await page.waitForTimeout(300);
  await setSlider(page, 'Blur', 12);
  await setSlider(page, 'Dim', 40);
  await setSlider(page, 'Transparency', 25);
  await setSlider(page, 'Brightness', 30);
  await setSlider(page, 'Saturation', -50);
  b = await bg(page);
  h.assert.equal(b.blur, 12, 'blur');
  h.assert.equal(b.dim.amount, 0.4, 'dim amount');
  h.assert.equal(b.dim.color, '#000000', 'dim colour');
  h.assert.equal(b.opacity, 0.75, 'opacity');
  h.assert.equal(b.adjust.brightness, 30, 'brightness');
  h.assert.equal(b.adjust.saturation, -50, 'saturation');
  /* One undo step per slider gesture. */
  await page.evaluate(() => window.LEStudio.scene.undo());
  h.assert.equal((await bg(page)).adjust.saturation || 0, 0, 'undo removes only the last slider gesture');
  h.assert.equal((await bg(page)).adjust.brightness, 30, 'earlier gesture kept');
  await page.evaluate(() => window.LEStudio.scene.redo());
  h.assert.equal((await bg(page)).adjust.saturation, -50, 'redo');
  /* Filter look. */
  await page.evaluate(() => [...document.querySelectorAll('.sxb-filters .sx-filter')].find((x) => x.textContent.trim() === 'Mono').click());
  h.assert.equal((await bg(page)).filter.name, 'mono', 'filter');
  /* Pixel sanity: the export shows a dimmed, desaturated photo, not the white base. */
  const px = await page.evaluate(async () => {
    const cv = await window.LEStudio.scene.render(0.25, { includeBackground: true });
    const d = cv.getContext('2d').getImageData(10, 10, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  h.assert(px[0] < 200 && Math.abs(px[0] - px[1]) < 12 && Math.abs(px[1] - px[2]) < 12, 'Export pixel looks dimmed and grey: ' + px);
  h.assert.noErrors(page);
};

cases['edit mode: double-click enters, drag pans, wheel zooms, one undo step, Esc cancels'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base, 'desktop');
  const box = await pageBox(page);
  await page.mouse.dblclick(box.left + 40, box.top + 40);
  await page.waitForTimeout(200);
  h.assert(await page.evaluate(() => window.LEStudioBackground.editing()), 'Double-click on empty page area opens edit mode');
  h.assert(await page.evaluate(() => !!document.querySelector('.sxb-bar [data-bgx="done"]')), 'Edit bar with Done is shown');
  const undoBefore = await page.evaluate(() => window.LEStudio.scene._hist.undo.length);
  /* Drag down: a portrait photo on a landscape page has room to move vertically, none horizontally. */
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 5 });
  await page.mouse.move(cx + 120, cy + 90, { steps: 5 });
  await page.mouse.up();
  let s = await page.evaluate(() => window.LEStudioBackground.session());
  h.assert(s.current.y > 0.05, 'Dragging down moves the photo down: y=' + s.current.y);
  h.assert.equal(s.current.x, 0, 'Fill keeps the page covered: no sideways room');
  h.assert.equal(s.undo, 1, 'One local step per drag');
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  s = await page.evaluate(() => window.LEStudioBackground.session());
  h.assert(s.current.scale > 1.2, 'Wheel zooms in: ' + s.current.scale);
  /* Keyboard nudge, then local undo of the nudge. */
  const yBefore = s.current.y;
  await page.keyboard.press('ArrowUp');
  s = await page.evaluate(() => window.LEStudioBackground.session());
  h.assert(s.current.y < yBefore, 'Arrow nudges');
  await page.keyboard.press('Control+z');
  s = await page.evaluate(() => window.LEStudioBackground.session());
  h.assert(Math.abs(s.current.y - yBefore) < 1e-6, 'Ctrl+Z undoes inside edit mode');
  /* Done commits a single undo step. */
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  h.assert(!(await page.evaluate(() => window.LEStudioBackground.editing())), 'Enter closes edit mode');
  const done = await bg(page);
  h.assert(done.scale > 1.2 && done.y !== 0, 'Framing committed to doc.background');
  h.assert.equal(await page.evaluate(() => window.LEStudio.scene._hist.undo.length), undoBefore + 1, 'Exactly one undo step for the session');
  await page.evaluate(() => window.LEStudio.scene.undo());
  const undone = await bg(page);
  h.assert(!undone.scale || undone.scale === 1, 'Undo restores the old framing');
  await page.evaluate(() => window.LEStudio.scene.redo());
  /* Esc cancels. */
  await page.evaluate(() => window.LEStudio.cmd('bgEdit'));
  await page.waitForTimeout(100);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 200, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  h.assert(!(await page.evaluate(() => window.LEStudioBackground.editing())), 'Esc closes edit mode');
  const after = await bg(page);
  h.assert.equal(JSON.stringify(after), JSON.stringify(done), 'Esc leaves the background as it was');
  /* Toolbar item with nothing selected. */
  h.assert(await page.evaluate(() => !!document.querySelector('#sx-tool [data-cmd="bgEdit"]')), 'Toolbar has Edit background');
  h.assert.noErrors(page);
};

cases['layer to background to layer keeps crop, adjust and filter'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base, 'desktop');
  const res = await page.evaluate(() => {
    const c = window.LEStudio;
    c.scene.setBackground({ type: 'color', color: '#123456' });
    const id = c.scene.add({ type: 'image', src: window.__photo, x: 100, y: 100, w: 300, h: 200, crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.4 }, adjust: { brightness: 25, contrast: -10, warmth: 15 }, filter: { name: 'film', intensity: 70 }, flipX: true, opacity: 0.9 });
    c.scene.select([id]);
    const undo0 = c.scene._hist.undo.length;
    c.setAsBackground();
    const b = c.scene.toJSON().background;
    const layersAfter = c.scene.layers().length;
    const undo1 = c.scene._hist.undo.length;
    const newId = window.LEStudioBackground.detach(c);
    const l = c.scene.layer(newId);
    const layers = c.scene.layers();
    return { b, layersAfter, steps: undo1 - undo0, l, back: layers[0].id === newId, bg2: c.scene.toJSON().background };
  });
  h.assert.equal(res.b.type, 'image');
  h.assert.equal(JSON.stringify(res.b.crop), JSON.stringify({ x: 0.1, y: 0.2, w: 0.8, h: 0.4 }), 'crop carried to background');
  h.assert.equal(res.b.adjust.brightness, 25);
  h.assert.equal(res.b.adjust.warmth, 15);
  h.assert.equal(res.b.filter.name, 'film');
  h.assert.equal(res.b.flipX, true);
  h.assert.equal(res.b.opacity, 0.9);
  h.assert.equal(res.b.color, '#123456', 'base colour kept from the old background');
  h.assert.equal(res.layersAfter, 1, 'layer removed when it becomes the background');
  h.assert.equal(res.steps, 1, 'one undo step');
  h.assert.equal(JSON.stringify(res.l.crop), JSON.stringify({ x: 0.1, y: 0.2, w: 0.8, h: 0.4 }), 'crop carried back to the layer');
  h.assert.equal(res.l.adjust.contrast, -10);
  h.assert.equal(res.l.filter.intensity, 70);
  h.assert.equal(res.l.flipX, true);
  h.assert(res.back, 'detached photo sits at the back');
  h.assert.equal(res.bg2.type, 'color');
  h.assert.equal(res.bg2.color, '#123456');
  h.assert.noErrors(page);
};

cases['.leproject round trip keeps every background field; pages keep their own background'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base, 'desktop');
  const out = await page.evaluate(async () => {
    const c = window.LEStudio;
    const full = { type: 'image', src: window.__photo, color: '#fafafa', fit: 'tile', crop: { x: 0.05, y: 0.1, w: 0.9, h: 0.8 }, x: 0.12, y: -0.08, scale: 1.4, rotation: 90, flipX: true, flipY: false, opacity: 0.8, blur: 6, dim: { color: '#102030', amount: 0.3 }, adjust: { brightness: 10, contrast: 5, saturation: -20, warmth: 12 }, filter: { name: 'vintage', intensity: 60 }, tile: { size: 0.3, gap: 0.02 } };
    c.scene.setBackground(full);
    c.addPage(false);
    await new Promise((r) => setTimeout(r, 100));
    c.scene.setBackground({ type: 'color', color: '#ff0000' });
    c.switchPage(0);
    await new Promise((r) => setTimeout(r, 100));
    const page0 = c.scene.toJSON().background;
    c.syncProject();
    const blob = await LE.project.exportFile(c.S.project, {});
    const p = await LE.project.importFile(new File([blob], 'round.leproject'));
    return { full, page0, imported: p.pages.map((pg) => pg.background) };
  });
  h.assert.equal(canon(out.page0), canon(out.full), 'page 1 keeps its photo background after switching pages');
  h.assert.equal(canon(out.imported[0]), canon(out.full), 'every field survives .leproject export + import');
  h.assert.equal(out.imported[1].color, '#ff0000', 'page 2 keeps its own background');
  h.assert.noErrors(page);
};

cases['legacy image background renders as before'] = async ({ browser, base, h }) => {
  const page = await setup(h, browser, base, 'desktop');
  const out = await page.evaluate(async () => {
    const c = window.LEStudio;
    const legacy = { type: 'image', src: window.__photo, fit: 'contain', color: '#ff0000' };
    const d = c.scene.toJSON();
    d.background = legacy;
    d.layers = [];
    c.scene.load(d);
    const kept = c.scene.toJSON().background;
    const cv = await c.scene.render(0.5);
    const x = cv.getContext('2d');
    const side = x.getImageData(5, cv.height / 2, 1, 1).data;
    const mid = x.getImageData(cv.width / 2, cv.height / 2, 1, 1).data;
    /* The old renderer: fill colour, then the photo contained and centred. */
    const ref = document.createElement('canvas');
    ref.width = cv.width; ref.height = cv.height;
    const r = ref.getContext('2d');
    r.fillStyle = '#ff0000'; r.fillRect(0, 0, ref.width, ref.height);
    const img = c.mem[window.__photo].canvas;
    const s = Math.min(ref.width / img.width, ref.height / img.height);
    r.drawImage(img, (ref.width - img.width * s) / 2, (ref.height - img.height * s) / 2, img.width * s, img.height * s);
    const a = x.getImageData(0, 0, cv.width, cv.height).data, b = r.getImageData(0, 0, cv.width, cv.height).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return { kept, side: [side[0], side[1], side[2]], mid: [mid[0], mid[1], mid[2]], meanDiff: diff / (a.length / 4) / 3 };
  });
  h.assert.equal(canon(out.kept), canon({ type: 'image', src: out.kept.src, fit: 'contain', color: '#ff0000' }), 'legacy document is not rewritten');
  h.assert(out.side[0] > 240 && out.side[1] < 20, 'contain shows the base colour at the sides');
  h.assert(!(out.mid[0] > 240 && out.mid[1] < 20), 'photo in the middle');
  h.assert(out.meanDiff < 2, 'matches the old renderer (mean diff ' + out.meanDiff.toFixed(2) + ')');
  h.assert.noErrors(page);
};

['phone', 'small'].forEach((vp) => {
  cases[vp + ': sheet controls work, edit mode pans with one finger, no sideways scroll'] = async ({ browser, base, h }) => {
    const page = await setup(h, browser, base, vp);
    await h.openPanel(page, 'background');
    h.assert(await h.noOverflow(page), 'No sideways scroll with the sheet open');
    await clickText(page, '.sxb-fits', 'Fit');
    h.assert.equal((await bg(page)).fit, 'contain', 'Fit from the sheet');
    await clickText(page, '.sxb-fits', 'Fill');
    const small = await page.evaluate(() => [...document.querySelectorAll('.sxb-hero-act button, .sxb-quick button, .sxb-fits button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.height)]; }).filter((x) => x[1] < 32));
    h.assert(!small.length, 'Sheet targets are large enough: ' + JSON.stringify(small));
    await page.evaluate(() => document.querySelector('.sxb-edit-btn').click());
    await page.waitForTimeout(300);
    h.assert(await page.evaluate(() => window.LEStudioBackground.editing()), 'Edit mode opens from the sheet');
    h.assert(await page.evaluate(() => document.getElementById('sx-panel').hidden || !document.getElementById('sx').classList.contains('has-panel')), 'Sheet gets out of the way');
    const targets = await page.evaluate(() => [...document.querySelectorAll('.sxb-bar button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    h.assert(targets.length >= 6 && Math.min.apply(null, targets) >= 44, 'Bar buttons are 44px: ' + targets);
    h.assert(await h.noOverflow(page), 'No sideways scroll in edit mode');
    /* One-finger pan with touch pointer events. */
    const box = await pageBox(page);
    await page.evaluate(([x, y]) => {
      const ov = document.querySelector('.sxb-edit');
      const ev = (type, cx, cy) => ov.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true }));
      ev('pointerdown', x, y); ev('pointermove', x, y + 20); ev('pointermove', x, y + 60); ev('pointerup', x, y + 60);
    }, [box.left + box.width / 2, box.top + box.height / 2]);
    let s = await page.evaluate(() => window.LEStudioBackground.session());
    h.assert(s.current.y > 0, 'one-finger drag pans: ' + s.current.y);
    /* Two-finger pinch zooms. */
    await page.evaluate(([x, y]) => {
      const ov = document.querySelector('.sxb-edit');
      const ev = (type, id, cx, cy) => ov.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: cx, clientY: cy }));
      ev('pointerdown', 1, x - 20, y); ev('pointerdown', 2, x + 20, y);
      ev('pointermove', 1, x - 60, y); ev('pointermove', 2, x + 60, y);
      ev('pointerup', 1, x - 60, y); ev('pointerup', 2, x + 60, y);
    }, [box.left + box.width / 2, box.top + box.height / 2]);
    s = await page.evaluate(() => window.LEStudioBackground.session());
    h.assert(s.current.scale > 1.5, 'pinch zooms: ' + s.current.scale);
    await page.evaluate(() => document.querySelector('.sxb-bar [data-bgx="done"]').click());
    await page.waitForTimeout(300);
    const b = await bg(page);
    h.assert(b.scale > 1.5 && b.y !== 0, 'Done commits the phone framing');
    h.assert(await h.noOverflow(page), 'No sideways scroll after editing');
    h.assert.noErrors(page);
  };
});

module.exports = cases;
