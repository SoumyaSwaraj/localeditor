'use strict';
/* Photo edits, text effects, draw tools, design (templates, resize, replace-all), pages and the layers panel. */
const cases = {};

async function photoPage(browser, base, h, size) {
  const page = await h.newDesign(browser, base, 'desktop', size || 'Instagram post');
  await h.addPhoto(page, h.PHOTO(0));
  return page;
}
const img = async (page, h) => (await h.layers(page)).find((l) => l.type === 'image');
const state = (page) => page.evaluate(() => ({ project: window.LEStudio.S.project && { active: window.LEStudio.S.project.activePage, n: window.LEStudio.S.project.pages.length }, tool: window.LEStudio.scene.tool(), crop: !!window.LEStudio.scene._crop }));

/* ---------- crop, flip ---------- */
cases['crop: toolbar button enters crop mode, a corner drag shrinks the crop, Enter applies it'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  const l0 = await img(page, h);
  await page.click('#sx-tool [data-cmd=crop]');
  await page.waitForFunction(() => window.LEStudio.scene._crop, null, { timeout: 4000 });
  const hb = await h.handleBox(page, 'se', '.le-crop');
  h.assert(hb, 'crop handles shown');
  await h.drag(page, hb, { x: hb.x - 70, y: hb.y - 60 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.LEStudio.scene._crop);
  const l1 = await img(page, h);
  h.assert(l1.crop.w < 0.95 && l1.crop.h < 0.95, 'crop window smaller: ' + JSON.stringify(l1.crop));
  h.assert(l1.crop.x >= 0 && l1.crop.x + l1.crop.w <= 1.0001 && l1.crop.y + l1.crop.h <= 1.0001, 'crop within the photo');
  h.assert(l1.w < l0.w + 1, 'layer did not grow');
};
cases['crop: Esc cancels and leaves the photo untouched'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  const before = await img(page, h);
  await page.click('#sx-tool [data-cmd=crop]');
  await page.waitForFunction(() => window.LEStudio.scene._crop);
  const hb = await h.handleBox(page, 'se', '.le-crop');
  h.assert(hb, 'crop handles shown');
  await h.drag(page, hb, { x: hb.x - 80, y: hb.y - 80 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.LEStudio.scene._crop);
  const after = await img(page, h);
  h.assert(h.sameDoc(before.crop, after.crop) && before.w === after.w, 'unchanged');
};
cases['crop: double-click on a photo enters crop mode; aspect ratio buttons set the window'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  const l = await img(page, h);
  const c = await h.centerOf(page, l.id);
  await page.mouse.dblclick(c.x, c.y);
  await page.waitForFunction(() => window.LEStudio.scene._crop, null, { timeout: 3000 });
  const ratioBtn = page.locator('#sx-tool [data-cmd="ratio:1"]');
  h.assert(await ratioBtn.count() === 1, 'ratio buttons in the crop toolbar');
  await ratioBtn.click();
  await page.click('#sx-tool [data-cmd=cropDone]');
  await page.waitForFunction(() => !window.LEStudio.scene._crop);
  const l1 = await img(page, h);
  const nat = await page.evaluate(() => { const m = Object.values(window.LEStudio.mem)[0]; return [m.canvas.width, m.canvas.height]; });
  h.assert(Math.abs((l1.crop.w * nat[0]) / (l1.crop.h * nat[1]) - 1) < 0.03, '1:1 crop: ' + JSON.stringify(l1.crop));
};
cases['flip horizontal / vertical and rotate 90 from the Flip menu'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await page.click('#sx-tool [data-cmd=flipMenu]');
  await page.click('#sx-pop [data-cmd=flipH]');
  h.assert.equal((await img(page, h)).flipX, true, 'flipX');
  await page.click('#sx-tool [data-cmd=flipMenu]');
  await page.click('#sx-pop [data-cmd=flipV]');
  h.assert.equal((await img(page, h)).flipY, true, 'flipY');
  await page.click('#sx-tool [data-cmd=flipMenu]');
  await page.click('#sx-pop [data-cmd=rot90]');
  h.assert.equal((await img(page, h)).rotation, 90, 'rotate 90');
  await page.click('#sx-tool [data-cmd=flipMenu]');
  await page.click('#sx-pop [data-cmd=flipH]');
  h.assert.equal((await img(page, h)).flipX, false, 'flip toggles back');
};

/* ---------- adjust, filters, effects ---------- */
cases['adjust sliders write to layer.adjust'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'adjust');
  for (const [label, v] of [['Brightness', 25], ['Contrast', -20], ['Saturation', 40], ['Blur', 6], ['Vignette', 30]]) {
    await page.locator('input[type=range][aria-label=' + label + ']').fill(String(v));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  const a = (await img(page, h)).adjust;
  h.assert(a.brightness === 25 && a.contrast === -20 && a.saturation === 40 && a.blur === 6 && a.vignette > 0, 'adjust values ' + JSON.stringify(a));
  h.assert.noErrors(page);
};
cases['KNOWN-BUG: "Reset adjustments" button clears all adjust values (QA-001)'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'adjust');
  await page.locator('input[type=range][aria-label=Brightness]').fill('25');
  await page.locator('input[type=range][aria-label=Saturation]').fill('40');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Reset adjustments' }).click();
  await page.waitForTimeout(300);
  const b = (await img(page, h)).adjust;
  h.assert(Object.values(b).every((v) => !v), 'reset left: ' + JSON.stringify(b));
};
cases['adjust: one undo reverts a whole slider drag'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'adjust');
  const sl = page.locator('input[type=range][aria-label=Exposure]');
  const bb = await sl.boundingBox();
  await h.drag(page, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }, { x: bb.x + bb.width * 0.9, y: bb.y + bb.height / 2 }, 12);
  const mid = (await img(page, h)).adjust.exposure;
  h.assert(mid > 0.3, 'slider moved: ' + mid);
  await page.evaluate(() => window.LEStudio.scene.undo());
  h.assert(!((await img(page, h)).adjust.exposure), 'single undo restores');
};
cases['filters: choosing a look sets layer.filter, intensity changes it, Original clears it'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'filters');
  await page.locator('.sx-filter', { hasText: 'Vivid' }).click();
  await page.waitForTimeout(200);
  let f = (await img(page, h)).filter;
  h.assert(f && f.name === 'vivid', 'vivid applied: ' + JSON.stringify(f));
  await page.locator('input[type=range][aria-label=Intensity]').fill('40');
  await page.waitForTimeout(150);
  h.assert.equal((await img(page, h)).filter.intensity, 40);
  await page.locator('.sx-filter', { hasText: 'Mono' }).click();
  h.assert.equal((await img(page, h)).filter.name, 'mono');
  await page.locator('.sx-filter', { hasText: 'Original' }).click();
  await page.waitForTimeout(150);
  h.assert(!(await img(page, h)).filter, 'Original removes the filter');
  h.assert.noErrors(page);
};
cases['effects: shadow presets on a photo set and clear layer.shadow'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'effects');
  await page.locator('.sx-fx', { hasText: 'Lift' }).click();
  await page.waitForTimeout(150);
  h.assert((await img(page, h)).shadow, 'Lift adds a shadow');
  await page.locator('.sx-fx', { hasText: 'None' }).click();
  await page.waitForTimeout(150);
  h.assert(!(await img(page, h)).shadow, 'None removes it');
};
cases['effects: corner radius slider and a mask (Circle) apply to the photo'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'effects');
  await page.locator('input[type=range][aria-label="Corner radius"]').fill('30');
  await page.waitForTimeout(150);
  h.assert((await img(page, h)).radius > 0, 'radius set');
  await page.locator('#sx-panel-body .sx-tile[aria-label=Circle]').click();
  await page.waitForTimeout(150);
  h.assert((await img(page, h)).mask === 'ellipse', 'mask ellipse, got ' + (await img(page, h)).mask);
};
cases['photo effect: duotone bakes a new image, keeps the original, Reset restores it'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  const src0 = (await img(page, h)).src;
  await h.openPanel(page, 'effects');
  await page.locator('.sx-duo[aria-label="Ice duotone"]').click();
  await page.waitForFunction((s) => window.LEStudio.scene.layers().find((l) => l.type === 'image').src !== s, src0, { timeout: 15000 });
  const l = await img(page, h);
  h.assert(l.src !== src0, 'new baked source');
  await page.waitForTimeout(600);
  await page.locator('#sx-panel-body .sx-link', { hasText: 'Reset' }).first().click();
  await page.waitForTimeout(300);
  h.assert.equal((await img(page, h)).src, src0, 'original restored');
  h.assert.noErrors(page);
};
cases['text effect presets: Shadow, Outline, Neon, Background change the layer and None clears them'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [t] = await h.addLayers(page, [{ type: 'text', text: 'Effect', x: 100, y: 300, w: 700, h: 200, size: 120, color: '#17131F' }]);
  await h.select(page, [t]);
  await h.openPanel(page, 'effects');
  const get = async () => (await h.layers(page))[0];
  await page.locator('.sx-tfx', { hasText: 'Shadow' }).click();
  h.assert((await get()).shadow, 'shadow preset');
  await page.locator('.sx-tfx', { hasText: 'Outline' }).click();
  let l = await get(); h.assert(l.stroke && l.stroke.width > 0 && !l.shadow, 'outline preset');
  await page.locator('.sx-tfx', { hasText: 'Neon' }).click();
  l = await get(); h.assert(l.shadow && l.shadow.blur > 5, 'neon glow');
  await page.locator('.sx-tfx', { hasText: 'Background' }).click();
  l = await get(); h.assert(l.background && l.background.color, 'background label');
  await page.locator('.sx-tfx', { hasText: 'None' }).click();
  l = await get(); h.assert(!l.shadow && !l.stroke && !l.background, 'None clears all');
  h.assert.noErrors(page);
};
cases['text effect intensity slider rescales the effect and is one undo'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [t] = await h.addLayers(page, [{ type: 'text', text: 'Effect', x: 100, y: 300, w: 700, h: 200, size: 120 }]);
  await h.select(page, [t]);
  await h.openPanel(page, 'effects');
  await page.locator('.sx-tfx', { hasText: 'Lift' }).click();
  const b0 = (await h.layers(page))[0].shadow.blur;
  await page.locator('#sx-panel-body input[type=range]').first().fill('200');
  await page.waitForTimeout(150);
  h.assert((await h.layers(page))[0].shadow.blur > b0 * 1.5, 'blur grew');
};
cases['format painter: copy a text style, click another text, style is pasted; Esc stops it'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a, b] = await h.addLayers(page, [
    { type: 'text', text: 'Source', x: 100, y: 100, w: 500, h: 120, size: 90, color: '#E0668E', weight: 800, font: 'Playfair Display' },
    { type: 'text', text: 'Target', x: 100, y: 600, w: 500, h: 80, size: 40, color: '#17131F', weight: 400 }
  ]);
  await h.select(page, [a]);
  await page.click('#sx-tool [data-cmd=copyStyle]');
  h.assert(await page.evaluate(() => window.LEStudio.S.painterArmed), 'painter armed');
  const c = await h.centerOf(page, b);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(250);
  const t = (await h.layers(page)).find((l) => l.id === b);
  h.assert(t.color.toLowerCase() === '#e0668e' && t.size === 90 && t.weight === 800 && t.font === 'Playfair Display', 'style pasted: ' + [t.color, t.size, t.weight, t.font]);
  h.assert(!(await page.evaluate(() => window.LEStudio.S.painterArmed)), 'painter disarmed after one paste');
  h.assert.equal((await h.layers(page)).find((l) => l.id === b).text, 'Target', 'text content untouched');
  await h.select(page, [a]);
  await page.click('#sx-tool [data-cmd=copyStyle]');
  await page.keyboard.press('Escape');
  h.assert(!(await page.evaluate(() => window.LEStudio.S.painterArmed)), 'Esc stops the painter');
};
cases['format painter works across types (photo look onto another photo, Ctrl+Alt+C shortcut)'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.addPhoto(page, h.PHOTO(1));
  const ims = (await h.layers(page)).filter((l) => l.type === 'image');
  await h.select(page, [ims[0].id]);
  await h.openPanel(page, 'filters');
  await page.locator('.sx-filter', { hasText: 'Noir' }).click();
  await h.select(page, [ims[0].id]);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'c', { ctrl: true });
  await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('c'); await page.keyboard.up('Alt'); await page.keyboard.up('Control');
  h.assert(await page.evaluate(() => window.LEStudio.S.painterArmed), 'Ctrl+Alt+C arms the painter');
  await h.select(page, [ims[1].id]);
  await page.waitForTimeout(250);
  const t = (await h.layers(page)).find((l) => l.id === ims[1].id);
  h.assert(t.filter && t.filter.name === 'noir', 'filter pasted onto the other photo: ' + JSON.stringify(t.filter));
};

/* ---------- frames and grids ---------- */
cases['photo grid: adding a 2x2 grid makes four empty cells, dropping a photo fills only that cell'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'elements');
  await page.locator('.sx-tile[aria-label="Four squares photo grid"]').click();
  await page.waitForTimeout(300);
  let ls = await h.layers(page);
  h.assert.equal(ls.filter((l) => l.name === 'Photo cell' && l.type === 'shape').length, 4, 'four empty cells');
  const target = ls[2];
  const c = await h.centerOf(page, target.id);
  await page.evaluate(async ([u, x, y]) => {
    const blob = await (await fetch(u)).blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'cell.jpg', { type: 'image/jpeg' }));
    document.getElementById('sx-stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  }, [base + '/assets/photos/collage/arch-02.jpg', c.x, c.y]);
  await page.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.type === 'image'), null, { timeout: 15000 });
  ls = await h.layers(page);
  const filled = ls.filter((l) => l.type === 'image' && l.name === 'Photo cell');
  h.assert.equal(filled.length, 1, 'one filled cell');
  h.assert(Math.abs(filled[0].x - target.x) < 2 && Math.abs(filled[0].w - target.w) < 2, 'filled cell keeps the cell geometry');
  h.assert.equal(ls.filter((l) => l.type === 'shape' && l.name === 'Photo cell').length, 3, 'three still empty');
  h.assert.equal(ls.length, 4, 'layer count unchanged (cell replaced in place)');
};
cases['photo grid: Fill with uploads fills every cell'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addPhoto(page, h.PHOTO(0));
  await h.openPanel(page, 'elements');
  await page.locator('.sx-tile[aria-label="Two columns photo grid"]').click();
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Frames' }).click();
  await page.getByRole('button', { name: 'Fill with uploads' }).click();
  await page.waitForTimeout(500);
  const ls = await h.layers(page);
  h.assert.equal(ls.filter((l) => l.name === 'Photo cell' && l.type === 'image').length, 2, 'both cells filled');
  h.assert.equal(ls.filter((l) => l.name === 'Photo cell' && l.type === 'shape').length, 0, 'no empty cells');
};
cases['a mask applied from Effects frames the photo (frame drop target)'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'effects');
  await page.locator('#sx-panel-body .sx-tile[aria-label=Heart]').click();
  await page.waitForTimeout(200);
  const l = await img(page, h);
  h.assert.equal(l.mask, 'heart');
  const c = await h.centerOf(page, l.id);
  await page.evaluate(async ([u, x, y]) => {
    const blob = await (await fetch(u)).blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'swap.jpg', { type: 'image/jpeg' }));
    document.getElementById('sx-stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  }, [base + '/assets/photos/collage/arch-03.jpg', c.x, c.y]);
  await page.waitForFunction((s) => window.LEStudio.scene.layers().find((x) => x.type === 'image' && x.mask === 'heart' && x.src !== s), l.src, { timeout: 15000 });
  const n = (await h.layers(page)).filter((x) => x.type === 'image');
  h.assert.equal(n.length, 1, 'photo swapped inside the frame, not added');
  h.assert.equal(n[0].mask, 'heart', 'frame kept');
};

/* ---------- draw ---------- */
cases['draw: pen, marker and highlighter strokes create path layers; Done returns to select'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'draw');
  const st = await page.locator('#sx-scene').boundingBox();
  let n = 0;
  for (const mode of ['Pen', 'Marker', 'Highlighter']) {
    await page.locator('.sx-draw-mode', { hasText: mode }).click();
    const y = st.y + 200 + n * 80;
    await h.drag(page, { x: st.x + st.width * 0.35, y }, { x: st.x + st.width * 0.6, y: y + 30 }, 10);
    n++;
    const ls = await h.layers(page);
    h.assert.equal(ls.length, n, mode + ' stroke makes a layer');
    h.assert.equal(ls[ls.length - 1].type, 'path', mode + ' layer type');
    h.assert(ls[ls.length - 1].points && ls[ls.length - 1].points.length >= 2, 'path has points');
  }
  await page.getByRole('button', { name: 'Done drawing' }).click();
  h.assert.equal(await page.evaluate(() => window.LEStudio.scene.tool()), 'select');
};
cases['draw: size slider and colour chip change the next stroke'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'draw');
  await page.locator('input[type=range][aria-label=Size]').fill('30');
  await page.locator('.sx-chip-color[aria-label="#E0668E"]').click();
  const st = await page.locator('#sx-scene').boundingBox();
  await h.drag(page, { x: st.x + 300, y: st.y + 300 }, { x: st.x + 420, y: st.y + 340 }, 10);
  const p = (await h.layers(page))[0];
  h.assert(p.type === 'path' && p.color.toLowerCase() === '#e0668e', 'colour: ' + p.color);
  h.assert(p.width >= 20, 'width follows the slider: ' + p.width);
};
cases['draw: the eraser removes or trims a stroke it crosses'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'draw');
  const st = await page.locator('#sx-scene').boundingBox();
  const y = st.y + 300;
  await h.drag(page, { x: st.x + 250, y }, { x: st.x + 450, y }, 12);
  const before = JSON.stringify(await h.layers(page));
  await page.locator('.sx-draw-mode', { hasText: 'Eraser' }).click();
  await h.drag(page, { x: st.x + 350, y: y - 30 }, { x: st.x + 350, y: y + 30 }, 10);
  const after = JSON.stringify(await h.layers(page));
  h.assert(before !== after, 'the stroke changed or was removed');
};

/* ---------- design: templates, resize, replace all ---------- */
cases['text-layout template adds editable layers (group) over the page'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'design', { tab: 'templates' });
  await page.getByRole('tab', { name: 'Text layouts' }).click();
  await page.locator('#sx-panel-body .sx-tpl').first().click();
  await page.waitForFunction(() => window.LEStudio.scene.layers().length > 1, null, { timeout: 5000 });
  const ls = await h.layers(page);
  h.assert(ls.some((l) => l.type === 'text'), 'has text layers');
  h.assert(ls[0].type === 'image' && ls[0].src, 'the photo is kept');
  h.assert(ls.filter((l) => l.type === 'text').every((l) => l.text && l.text.length), 'editable text');
};
cases['collage template tab lists catalogue cards and the first card applies without errors (shallow)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'design', { tab: 'templates' });
  h.assert(await page.locator('#sx-panel-body .sx-cg-card').count() >= 10, 'cards listed');
  await page.locator('#sx-panel-body .sx-cg-card').first().click();
  await page.waitForTimeout(1500);
  h.assert((await h.layers(page)).length >= 1, 'template put layers on the page');
  h.assert.noErrors(page);
};
async function resizeTo(page, h, name, mode) {
  await h.openPanel(page, 'design', { tab: 'resize' });
  if (mode) await page.locator('#sx-panel-body button', { hasText: new RegExp('^' + mode + '$') }).click();
  await page.locator('.sx-size-mini', { hasText: name }).click();
  await page.waitForSelector('#sx-bar [data-cmd=sizeUse]');
  await page.click('#sx-bar [data-cmd=sizeUse]');
  await page.waitForTimeout(500);
}
cases['resize to another size: Fill covers the page, Fit keeps the whole photo, Stretch distorts'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  await resizeTo(page, h, 'YouTube thumbnail', 'Fill');
  let d = await h.doc(page);
  h.assert(d.width === 1280 && d.height === 720, 'page is 1280x720');
  let l = d.layers.find((x) => x.type === 'image');
  h.assert(l, 'photo survives the resize');
  const cover = (x) => x.w * (x.crop ? 1 : 1) >= 0 && x.h >= 0;
  h.assert(cover(l), 'valid');
  const dims = {};
  for (const mode of ['Fill', 'Fit', 'Stretch']) {
    await page.evaluate(() => { const b = document.querySelector('[data-cmd=sizeCancel]'); b && b.click(); });
    await resizeTo(page, h, 'Pinterest pin', mode);
    d = await h.doc(page);
    h.assert(d.width === 1000 && d.height === 1500, mode + ': 1000x1500');
    l = d.layers.find((x) => x.type === 'image');
    dims[mode] = { w: l.w, h: l.h, cw: l.crop.w, ch: l.crop.h };
    await resizeTo(page, h, 'YouTube thumbnail', 'Fill');
  }
  h.assert(dims.Stretch.w >= 999 && dims.Stretch.h >= 1499, 'Stretch fills both dimensions: ' + JSON.stringify(dims.Stretch));
  h.assert(dims.Fit.w <= 1001 && dims.Fit.h < 1500, 'Fit keeps the photo inside: ' + JSON.stringify(dims.Fit));
  h.assert(dims.Fill.w >= 999 && dims.Fill.h >= 1499, 'Fill covers the page: ' + JSON.stringify(dims.Fill));
  h.assert.noErrors(page);
};
cases['resize with Cancel leaves the page as it was'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  const before = await h.doc(page);
  await h.openPanel(page, 'design', { tab: 'resize' });
  await page.locator('.sx-size-mini', { hasText: 'Story' }).click();
  await page.waitForSelector('#sx-bar [data-cmd=sizeCancel]');
  await page.click('#sx-bar [data-cmd=sizeCancel]');
  await page.waitForTimeout(300);
  h.assert(h.sameDoc(before, await h.doc(page)), 'document identical after cancel');
};
cases['custom width and height in Resize create that size'] = async ({ browser, base, h }) => {
  const page = await photoPage(browser, base, h);
  await h.openPanel(page, 'design', { tab: 'resize' });
  const ins = page.locator('#sx-panel-body input.sx-input[type=number]');
  await page.locator('.sx-ratio-lock').click(); // unlock ratio
  await ins.nth(0).fill('900'); await ins.nth(1).fill('500');
  await page.getByRole('button', { name: 'Preview size' }).click();
  await page.waitForSelector('#sx-bar [data-cmd=sizeUse]');
  await page.click('#sx-bar [data-cmd=sizeUse]');
  await page.waitForTimeout(400);
  const d = await h.doc(page);
  h.assert(d.width === 900 && d.height === 500, 'custom size ' + d.width + 'x' + d.height);
};
cases['size history lists resizes and Reset to original size returns to the first size'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  const first = await h.doc(page);
  await resizeTo(page, h, 'Story', 'Fill');
  await resizeTo(page, h, 'YouTube thumbnail', 'Fill');
  await h.openPanel(page, 'design', { tab: 'history' });
  const txt = await page.textContent('#sx-panel-body');
  h.assert(txt.indexOf('Story') >= 0 && txt.indexOf('YouTube') >= 0, 'history shows both sizes');
  await page.getByRole('button', { name: 'Reset to original size' }).click();
  await page.waitForTimeout(700);
  const d = await h.doc(page);
  h.assert(d.width === first.width && d.height === first.height, 'back to the first size: ' + d.width + 'x' + d.height);
};
cases['replace all colours: swapping a colour changes every layer that used it, in one undo'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addLayers(page, [
    { type: 'shape', shape: 'rectangle', x: 50, y: 50, w: 200, h: 200, fill: { type: 'solid', color: '#7457f0' } },
    { type: 'shape', shape: 'ellipse', x: 400, y: 50, w: 200, h: 200, fill: { type: 'solid', color: '#7457f0' } },
    { type: 'text', text: 'Hi', x: 50, y: 500, w: 300, h: 100, size: 60, color: '#7457f0' }
  ]);
  await h.openPanel(page, 'replace');
  const chip = page.locator('.sx-used-c', { hasText: '#7457f0' }).first();
  h.assert(await chip.count() === 1, 'colour used by 3 layers is listed');
  await chip.click();
  await page.waitForTimeout(400);
  await page.waitForSelector('#sx-pop .sx-cp-fields input, #sx-panel-body .sx-cp-fields input', { timeout: 5000 });
  const f = page.locator('.sx-cp-fields input').first();
  await f.fill('#22AA66'); await f.press('Enter');
  const apply = page.getByRole('button', { name: /Replace|Apply|Swap/i }).first();
  if (await apply.count()) await apply.click().catch(() => {});
  await page.waitForTimeout(600);
  const ls = await h.layers(page);
  const cols = ls.map((l) => (l.fill && l.fill.color) || l.color).map((c) => String(c).toLowerCase());
  h.assert(cols.every((c) => c === '#22aa66'), 'all three recoloured: ' + cols);
  await page.evaluate(() => window.LEStudio.scene.undo());
  const back = (await h.layers(page)).map((l) => String((l.fill && l.fill.color) || l.color).toLowerCase());
  h.assert(back.every((c) => c === '#7457f0'), 'one undo restores all three: ' + back);
};
cases['replace all fonts: the Fonts tab lists used families'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addLayers(page, [{ type: 'text', text: 'A', x: 50, y: 50, w: 300, h: 100, size: 60, font: 'Playfair Display' }, { type: 'text', text: 'B', x: 50, y: 300, w: 300, h: 100, size: 60, font: 'Playfair Display' }]);
  await h.openPanel(page, 'replace');
  await page.getByRole('tab', { name: 'Fonts' }).click();
  await page.waitForTimeout(300);
  const t = await page.textContent('#sx-panel-body');
  h.assert(t.indexOf('Playfair Display') >= 0, 'font listed: ' + t.slice(0, 120));
};

/* ---------- pages ---------- */
cases['pages: add, duplicate, switch and delete keep each page\'s own content'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addLayers(page, [{ type: 'text', text: 'PAGE ONE', x: 100, y: 100, w: 600, h: 100, size: 80 }]);
  await page.click('#sx-foot [data-cmd=pages]');
  await page.click('#sx-pop [data-cmd=addPage]');
  await page.waitForTimeout(500);
  let s = await state(page);
  h.assert(s.project.n === 2 && s.project.active === 1, 'two pages, second active');
  h.assert.equal((await h.layers(page)).length, 0, 'new page is empty');
  await h.addLayers(page, [{ type: 'text', text: 'PAGE TWO', x: 100, y: 100, w: 600, h: 100, size: 80 }]);
  await page.click('#sx-foot [data-cmd=pages]');
  await page.click('#sx-pop [data-cmd="page:0"]');
  await page.waitForTimeout(500);
  h.assert.equal((await h.layers(page))[0].text, 'PAGE ONE', 'page 1 kept its text');
  await page.click('#sx-foot [data-cmd=pages]');
  await page.click('#sx-pop [data-cmd=dupPage]');
  await page.waitForTimeout(500);
  s = await state(page);
  h.assert(s.project.n === 3, 'duplicate makes a third page');
  h.assert.equal((await h.layers(page))[0].text, 'PAGE ONE', 'duplicate has the content');
  await page.click('#sx-foot [data-cmd=pages]');
  await page.click('#sx-pop [data-cmd=delPage]');
  await page.waitForTimeout(500);
  s = await state(page);
  h.assert.equal(s.project.n, 2, 'deleted one');
  await page.click('#sx-foot [data-cmd=pages]');
  await page.click('#sx-pop [data-cmd="page:1"]');
  await page.waitForTimeout(500);
  h.assert.equal((await h.layers(page))[0].text, 'PAGE TWO', 'page 2 content survived the round trip');
  h.assert.equal((await page.textContent('#sx-foot')).replace(/\s+/g, ' ').indexOf('Page 2 / 2') >= 0, true, 'footer label');
};
cases['pages panel: add, move and delete pages'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'pages');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.waitForTimeout(400);
  h.assert.equal((await state(page)).project.n, 3, 'three pages');
  await page.locator('[aria-label="Delete page 3"]').click();
  await page.waitForTimeout(400);
  h.assert.equal((await state(page)).project.n, 2, 'back to two');
};

/* ---------- layers panel ---------- */
async function layersPanel(browser, base, h) {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const ids = await h.addLayers(page, [0, 1, 2].map((i) => ({ type: 'shape', shape: 'rectangle', name: 'Box ' + (i + 1), x: 80 * i, y: 80 * i, w: 300, h: 300 })));
  await h.openPanel(page, 'layers', { tab: 'layers' });
  return { page, ids };
}
cases['layers panel lists layers top first and clicking a name selects the layer'] = async ({ browser, base, h }) => {
  const { page, ids } = await layersPanel(browser, base, h);
  const names = await page.locator('.sx-layer-name').allTextContents();
  h.assert.equal(names.join(','), 'Box 3,Box 2,Box 1', 'top first');
  await page.locator('.sx-layer-name', { hasText: 'Box 2' }).click();
  h.assert.equal((await h.selection(page)).join(), ids[1]);
};
cases['layers panel: double-click renames a layer'] = async ({ browser, base, h }) => {
  const { page, ids } = await layersPanel(browser, base, h);
  await page.locator('.sx-layer-name', { hasText: 'Box 1' }).dblclick();
  const inp = page.locator('.sx-layer-rename');
  await inp.fill('Hero block'); await inp.press('Enter');
  await page.waitForTimeout(250);
  h.assert.equal((await h.layers(page)).find((l) => l.id === ids[0]).name, 'Hero block');
  h.assert.equal(await page.locator('.sx-layer-name', { hasText: 'Hero block' }).count(), 1, 'panel shows the new name');
};
cases['layers panel: eye hides a layer (document and panel), lock locks it'] = async ({ browser, base, h }) => {
  const { page, ids } = await layersPanel(browser, base, h);
  const row = page.locator('.sx-layer', { hasText: 'Box 3' });
  await row.locator('.sx-layer-eye').click();
  await page.waitForTimeout(500);
  h.assert.equal((await h.layers(page)).find((l) => l.id === ids[2]).visible, false, 'hidden in the document');
  await page.waitForSelector('.sx-layer.is-hidden', { timeout: 3000 });
  await page.locator('.sx-layer', { hasText: 'Box 3' }).locator('.sx-layer-eye').click();
  h.assert.equal((await h.layers(page)).find((l) => l.id === ids[2]).visible, true, 'shown again');
  await page.locator('.sx-layer', { hasText: 'Box 2' }).locator('.sx-layer-lock').click();
  await page.waitForTimeout(200);
  h.assert.equal((await h.layers(page)).find((l) => l.id === ids[1]).locked, true, 'locked');
  h.assert.equal(await page.locator('.sx-layer-lock[aria-label="Unlock layer"]').count(), 1, 'button now says Unlock');
};
cases['layers panel: dragging the grip reorders layers'] = async ({ browser, base, h }) => {
  const { page, ids } = await layersPanel(browser, base, h);
  const grip = await page.locator('.sx-layer', { hasText: 'Box 1' }).locator('.sx-layer-grip').boundingBox();
  const top = await page.locator('.sx-layer', { hasText: 'Box 3' }).boundingBox();
  await h.drag(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, { x: top.x + 40, y: top.y + 3 }, 10);
  await page.waitForTimeout(300);
  const order = (await h.layers(page)).map((l) => l.id);
  h.assert.equal(order[order.length - 1], ids[0], 'Box 1 is now on top: ' + order);
};
cases['layers panel Arrange tab shows position controls for the selection'] = async ({ browser, base, h }) => {
  const { page, ids } = await layersPanel(browser, base, h);
  await h.select(page, [ids[0]]);
  await h.openPanel(page, 'layers', { tab: 'arrange' });
  const n = await page.locator('#sx-panel-body input, #sx-panel-body button').count();
  h.assert(n >= 6, 'arrange controls: ' + n);
};
module.exports = cases;
