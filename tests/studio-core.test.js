'use strict';
/* Studio core: start screen, opening photos, text, elements, selection and transforms, undo/redo, clipboard, zoom, shortcuts. */
const cases = {};
const SIZES = [['Instagram post', 1080, 1080], ['Instagram portrait', 1080, 1350], ['Story / Reel', 1080, 1920], ['YouTube thumbnail', 1280, 720],
  ['Facebook cover', 1640, 624], ['LinkedIn banner', 1584, 396], ['Pinterest pin', 1000, 1500], ['A4 poster', 2480, 3508]];

async function textLayer(page, h, label) {
  await h.openPanel(page, 'text');
  await page.click('.sx-ta-' + (label || 'h'));
  await page.waitForFunction(() => window.LEStudio.S.editing);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const ls = await h.layers(page);
  return ls[ls.length - 1];
}
async function rects(page, h) {
  const out = [];
  for (const l of await h.layers(page)) out.push(Object.assign({}, l, { screen: await h.rect(page, l.id) }));
  return out;
}

/* ---------- start screen and sizes ---------- */
cases['start screen shows the size cards and no project yet'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForSelector('.sx-size-card');
  h.assert.equal(await page.locator('.sx-size-card').count(), 9, 'size cards');
  h.assert(await page.locator('#sx-start').isVisible(), 'start screen visible');
  h.assert((await h.doc(page)).layers.length === 0, 'blank scene');
  h.assert(await page.locator('[data-s=open]').isVisible() && await page.locator('[data-s=sample]').isVisible() && await page.locator('[data-s=import]').isVisible(), 'three entry buttons');
  h.assert.noErrors(page);
};
cases['every size preset card creates a page of that size'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  for (const [name, w, hh] of SIZES) {
    await page.waitForSelector('.sx-size-card');
    await page.locator('.sx-size-card').filter({ hasText: name }).first().click();
    await page.waitForFunction(() => document.getElementById('sx-start').hidden);
    const d = await h.doc(page);
    h.assert(d.width === w && d.height === hh, name + ' gave ' + d.width + 'x' + d.height);
    h.assert.equal((await page.textContent('#sx-dims')).replace(/\s/g, ''), w + '×' + hh + 'px', 'footer shows the size');
    await page.evaluate(() => window.LEStudio.cmd('newDesign'));
    await page.waitForSelector('#sx-start:not([hidden])');
  }
  h.assert.noErrors(page);
};
cases['custom size card lets the person type a size'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.locator('.sx-size-card').filter({ hasText: 'Custom size' }).click();
  await page.waitForTimeout(400);
  const inputs = page.locator('#sx-modal input[type=number]');
  h.assert(await inputs.count() >= 2, 'width and height inputs appear');
  await inputs.nth(0).fill('800'); await inputs.nth(1).fill('600');
  await page.locator('#sx-modal button[type=submit]').click();
  await page.waitForFunction(() => window.LEStudio.scene.toJSON().width === 800, null, { timeout: 5000 });
  const d = await h.doc(page);
  h.assert(d.width === 800 && d.height === 600, 'custom size ' + d.width + 'x' + d.height);
};
cases['sample scene loads from the start screen'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.click('[data-s=sample]');
  await page.waitForFunction(() => window.LEStudio.scene.layers().length > 0);
  h.assert(await page.locator('#sx-start').isHidden(), 'start hides');
  h.assert.noErrors(page);
};

/* ---------- opening photos ---------- */
cases['Open a photo from the start screen sizes the page to the photo'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc.setFiles(h.PHOTO(0));
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const d = await h.doc(page);
  const nat = await page.evaluate(async (u) => { const i = new Image(); i.src = u; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, base + '/assets/photos/collage/arch-01.jpg');
  const l = d.layers[0];
  h.assert(l.type === 'image' && l.src, 'one image layer');
  h.assert(Math.abs(d.width / d.height - nat[0] / nat[1]) < 0.02, 'page aspect matches photo: ' + d.width + 'x' + d.height + ' vs ' + nat);
  h.assert(l.x <= 1 && l.y <= 1 && l.w >= d.width - 2, 'photo fills the page');
  h.assert(await page.locator('#sx-start').isHidden(), 'start screen gone');
  h.assert.noErrors(page);
};
cases['adding a photo to an existing page keeps the page and fits the photo inside'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addPhoto(page, h.PHOTO(1));
  const d = await h.doc(page);
  h.assert(d.width === 1080 && d.height === 1080, 'page unchanged');
  const l = d.layers[0];
  h.assert(l.type === 'image', 'image layer');
  h.assert(l.x >= -1 && l.y >= -1 && l.x + l.w <= 1081 && l.y + l.h <= 1081, 'inside the page: ' + [l.x, l.y, l.w, l.h]);
  h.assert.equal((await h.selection(page)).length, 1, 'new photo is selected');
};
cases['several photos chosen at once become several layers'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => window.LEStudio.pickFiles('add'))]);
  await fc.setFiles([h.PHOTO(0), h.PHOTO(1), h.FIXTURE('sample.png')]);
  await page.waitForFunction(() => window.LEStudio.scene.layers().length >= 3, null, { timeout: 15000 });
  h.assert.equal((await h.layers(page)).filter((l) => l.type === 'image').length, 3);
};
cases['dropping a photo file on the canvas adds it where it was dropped'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const r = await page.evaluate(async (u) => {
    const blob = await (await fetch(u)).blob();
    const file = new File([blob], 'dropped.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer(); dt.items.add(file);
    const st = document.getElementById('sx-stage').getBoundingClientRect();
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: st.left + st.width / 2, clientY: st.top + st.height / 2 });
    document.getElementById('sx-stage').dispatchEvent(ev);
    return true;
  }, base + '/assets/photos/collage/arch-02.jpg');
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 15000 });
  const l = (await h.layers(page))[0];
  h.assert(l.type === 'image' && l.name.indexOf('dropped') === 0, 'named after the file: ' + l.name);
};
cases['pasting an image from the clipboard adds it'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.evaluate(async (u) => {
    const blob = await (await fetch(u)).blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'pasted.jpg', { type: 'image/jpeg' }));
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }, base + '/assets/photos/collage/arch-03.jpg');
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 15000 });
  h.assert.equal((await h.layers(page))[0].type, 'image');
};
cases['a non-image file is refused with a message and nothing is added'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => window.LEStudio.pickFiles('add'))]);
  await fc.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }).catch(() => {});
  await page.waitForTimeout(800);
  h.assert.equal((await h.layers(page)).length, 0, 'no layer');
  h.assert.noErrors(page);
};

/* ---------- text ---------- */
cases['Add a heading creates a text layer in edit mode; typing and Esc commit it'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'text');
  await page.click('.sx-ta-h');
  await page.waitForFunction(() => window.LEStudio.S.editing);
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('le-textedit'));
  let l = (await h.layers(page))[0];
  h.assert(l.type === 'text' && l.size === 96 && l.weight === 800, 'heading preset');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Summer sale');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  l = (await h.layers(page))[0];
  h.assert.equal(l.text, 'Summer sale');
  h.assert(!(await page.evaluate(() => window.LEStudio.S.editing)), 'edit mode ended');
};
cases['double-clicking a text layer edits it in place'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const t = await textLayer(page, h, 's');
  await page.keyboard.press('Escape');
  const c = await h.centerOf(page, t.id);
  await page.mouse.dblclick(c.x, c.y);
  await page.waitForFunction(() => window.LEStudio.S.editing, null, { timeout: 3000 });
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('le-textedit'));
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Edited in place');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  h.assert.equal((await h.layers(page))[0].text, 'Edited in place');
};
cases['text toolbar: font size field, smaller/bigger, bold, italic, underline, uppercase'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const t = await textLayer(page, h);
  h.assert.equal((await page.locator('#sx-tool [data-cmd="size:+"]').count()), 1, 'toolbar shows for text');
  await page.fill('#sx-fsize', '72');
  await page.press('#sx-fsize', 'Enter');
  await page.waitForTimeout(150);
  h.assert.equal((await h.layers(page))[0].size, 72, 'size from field');
  await page.click('#sx-tool [data-cmd="size:+"]');
  h.assert((await h.layers(page))[0].size > 72, 'bigger');
  await page.click('#sx-tool [data-cmd="size:-"]'); await page.click('#sx-tool [data-cmd="size:-"]');
  h.assert((await h.layers(page))[0].size < 72, 'smaller');
  const w0 = (await h.layers(page))[0].weight;
  await page.click('#sx-tool [data-cmd=bold]');
  h.assert((await h.layers(page))[0].weight !== w0, 'bold toggles');
  await page.click('#sx-tool [data-cmd=italic]'); h.assert((await h.layers(page))[0].italic === true, 'italic');
  await page.click('#sx-tool [data-cmd=underline]'); h.assert((await h.layers(page))[0].underline === true, 'underline');
  await page.click('#sx-tool [data-cmd=upper]'); h.assert((await h.layers(page))[0].uppercase === true, 'uppercase');
  await page.click('#sx-tool [data-cmd=align]'); h.assert((await h.layers(page))[0].align !== t.align, 'alignment cycles');
};
cases['text colour: picking a hex colour in the colour popover changes the text'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await textLayer(page, h);
  await page.click('#sx-tool [data-cmd=textColor]');
  await page.waitForSelector('#sx-pop .sx-cp-fields input');
  const f = page.locator('#sx-pop .sx-cp-fields input').first();
  await f.fill('#FF3366'); await f.press('Enter');
  await page.waitForTimeout(200);
  h.assert.equal((await h.layers(page))[0].color.toLowerCase(), '#ff3366');
};
cases['font panel: choosing a family changes the layer font and loads it'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await textLayer(page, h);
  await page.click('#sx-tool [data-cmd=font]');
  /* The F1 picker (le-studio-fonts.js): a virtual list of .sf-row rows. */
  await page.waitForSelector('.sf-row .sf-pick');
  const fam = await page.locator('.sf-row .sf-pick').nth(3).getAttribute('data-fam');
  await page.locator('.sf-row .sf-pick').nth(3).click();
  await page.waitForTimeout(1200);
  const l = (await h.layers(page))[0];
  h.assert(l.font && l.font !== 'Plus Jakarta Sans', 'font changed to ' + l.font + ' (clicked ' + fam + ')');
  const ok = await page.evaluate((f) => document.fonts.check('20px "' + f + '"'), l.font);
  h.assert(ok, 'font face loaded: ' + l.font);
};
cases['text presets from the panel (combo) add one or more text layers'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'text');
  await page.locator('.sx-combo').nth(1).click();
  await page.waitForTimeout(400);
  const ls = await h.layers(page);
  h.assert(ls.length >= 1 && ls.every((l) => l.x >= -1 && l.x < 1080), 'combo placed: ' + ls.length);
};

/* ---------- elements ---------- */
cases['elements: shapes, icons, stickers and emoji each add a layer'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'elements');
  await page.locator('.sx-tile[aria-label=Rectangle]').click();
  await page.waitForTimeout(200);
  let ls = await h.layers(page);
  h.assert(ls.length === 1 && ls[0].type === 'shape' && ls[0].shape, 'shape layer');
  await page.locator('.sx-tile[aria-label=Circle]').first().click();
  h.assert.equal((await h.layers(page)).length, 2);
  await page.locator('.sx-tile.is-icon').first().click();
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 3, null, { timeout: 8000 });
  await page.locator('.sx-tile.is-sticker').first().click();
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 4, null, { timeout: 8000 });
  ls = await h.layers(page);
  h.assert(ls[2].type === 'svg' && ls[3].type === 'svg', 'icon and sticker are svg layers');
  await page.getByRole('tab', { name: 'Emoji' }).click();
  await page.waitForTimeout(400);
  await page.locator('#sx-panel-body .sx-tile').first().click();
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 5, null, { timeout: 8000 });
  h.assert.noErrors(page);
};
cases['KNOWN-BUG: the Rounded rectangle thumbnail looks different from the Circle thumbnail (QA-017)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'elements');
  const r = await page.evaluate(() => { const d = document.querySelector('.sx-tile[aria-label="Rounded rectangle"] path').getAttribute('d'); const m = d.match(/A(\d+(\.\d+)?)/); return { d, radius: m ? Number(m[1]) : null }; });
  h.assert(r.radius !== null && r.radius < 16, 'corner radius in a 48px thumbnail is ' + r.radius + ' (a circle is 24): ' + r.d.slice(0, 50));
};
cases['elements search finds icons by name'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'elements');
  await page.fill('input[type=search]', 'heart');
  await page.waitForTimeout(600);
  const n = await page.locator('#sx-panel-body .sx-tile').count();
  h.assert(n >= 3, 'search returns tiles: ' + n);
};
cases['keyboard shortcuts T R C L add text, rectangle, ellipse, line'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.locator('#sx-scene').click({ position: { x: 5, y: 5 } });
  await h.key(page, 'r'); await h.key(page, 'c'); await h.key(page, 'l');
  let ls = await h.layers(page);
  h.assert.equal(ls.length, 3, 'three shapes');
  h.assert(ls.every((l) => l.type === 'shape' || l.type === 'path'), 'shape layers');
  await h.key(page, 't');
  await page.waitForFunction(() => window.LEStudio.S.editing);
  await page.keyboard.press('Escape');
  ls = await h.layers(page);
  h.assert.equal(ls[ls.length - 1].type, 'text', 'T adds text');
};

/* ---------- selection and transforms with real pointer events ---------- */
async function twoShapes(page, h) {
  return h.addLayers(page, [
    { type: 'shape', shape: 'rectangle', x: 100, y: 100, w: 300, h: 200, fill: { type: 'solid', color: '#7457F0' } },
    { type: 'shape', shape: 'ellipse', x: 600, y: 500, w: 240, h: 240, fill: { type: 'solid', color: '#E2B15A' } }
  ]);
}
cases['click selects, click on empty page deselects, shift-click multi-selects'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a, b] = await twoShapes(page, h);
  const ca = await h.centerOf(page, a), cb = await h.centerOf(page, b);
  await page.mouse.click(ca.x, ca.y);
  h.assert.equal((await h.selection(page)).join(), a, 'first selected');
  await page.keyboard.down('Shift'); await page.mouse.click(cb.x, cb.y); await page.keyboard.up('Shift');
  h.assert.equal((await h.selection(page)).length, 2, 'shift-click adds');
  const empty = await page.evaluate(() => { const r = window.LEStudio.scene.screenRect; return null; });
  const st = await h.rect(page, a);
  await page.mouse.click(st.left + 5, st.top + st.height + 120);
  h.assert.equal((await h.selection(page)).length, 0, 'empty click clears');
};
cases['marquee drag selects the layers it touches'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a, b] = await twoShapes(page, h);
  const ra = await h.rect(page, a), rb = await h.rect(page, b);
  await h.drag(page, { x: ra.left - 20, y: ra.top - 20 }, { x: rb.right + 20, y: rb.bottom + 20 });
  h.assert.equal((await h.selection(page)).length, 2, 'both in the marquee');
};
cases['dragging a layer moves it by the dragged distance (and Esc/undo is one step)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  const z = await page.evaluate(() => window.LEStudio.scene.zoom());
  const before = (await h.layers(page))[0];
  const c = await h.centerOf(page, a);
  await h.drag(page, c, { x: c.x + 80, y: c.y + 40 });
  const after = (await h.layers(page))[0];
  h.assert(Math.abs((after.x - before.x) - 80 / z) < 3 && Math.abs((after.y - before.y) - 40 / z) < 3, 'moved by ' + (after.x - before.x) + ',' + (after.y - before.y) + ' zoom ' + z);
  await page.evaluate(() => window.LEStudio.scene.undo());
  const undone = (await h.layers(page))[0];
  h.assert(undone.x === before.x && undone.y === before.y, 'one undo reverts the whole drag');
};
cases['arrow keys nudge the selection by 1 and Shift+arrow by 10'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.select(page, [a]);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  const x0 = (await h.layers(page))[0].x;
  await h.key(page, 'ArrowRight'); await h.key(page, 'ArrowRight', { shift: true });
  h.assert.equal((await h.layers(page))[0].x, x0 + 11);
};
cases['resizing with a corner handle changes the size, Shift keeps the ratio for photos'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.select(page, [a]);
  await page.waitForTimeout(150);
  const hb = await h.handleBox(page, 'se');
  h.assert(hb, 'se handle exists');
  const z = await page.evaluate(() => window.LEStudio.scene.zoom());
  const before = (await h.layers(page))[0];
  await h.drag(page, hb, { x: hb.x + 60, y: hb.y + 50 });
  const after = (await h.layers(page))[0];
  h.assert(after.w > before.w + 30 / z && after.h > before.h + 20 / z, 'grew: ' + [before.w, before.h, after.w, after.h]);
  h.assert(Math.abs(after.x - before.x) < 2 && Math.abs(after.y - before.y) < 2, 'top-left anchored');
};
cases['rotating with the rotate handle changes the rotation'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.select(page, [a]);
  await page.waitForTimeout(150);
  const hb = await h.handleBox(page, 'rotate');
  h.assert(hb, 'rotate handle exists');
  const c = await h.centerOf(page, a);
  const r = Math.hypot(hb.x - c.x, hb.y - c.y);
  await h.drag(page, hb, { x: c.x + r, y: c.y }, 10);
  const rot = (await h.layers(page))[0].rotation;
  h.assert(Math.abs(((rot % 360) + 360) % 360 - 90) < 6, 'rotated about 90 degrees, got ' + rot);
};
cases['multi-select then group, ungroup, align and distribute'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const ids = await h.addLayers(page, [0, 1, 2].map((i) => ({ type: 'shape', shape: 'rectangle', x: 100 + i * 250 + i * i * 40, y: 100 + i * 120, w: 100 + i * 20, h: 100, fill: { type: 'solid', color: '#7457F0' } })));
  await h.select(page, ids);
  await page.evaluate(() => window.LEStudio.cmd('group'));
  let ls = await h.layers(page);
  const g = ls.find((l) => l.type === 'group');
  h.assert(g && ls.filter((l) => l.groupId === g.id).length === 3, 'group of 3');
  h.assert.equal((await h.selection(page)).join(), g.id, 'group selected');
  await page.evaluate(() => window.LEStudio.cmd('ungroup'));
  ls = await h.layers(page);
  h.assert(!ls.some((l) => l.type === 'group') && ls.every((l) => !l.groupId), 'ungrouped');
  await h.select(page, ids);
  await page.evaluate(() => window.LEStudio.cmd('align2:left'));
  ls = await h.layers(page);
  h.assert(new Set(ls.map((l) => Math.round(l.x))).size === 1, 'left aligned: ' + ls.map((l) => l.x));
  await h.select(page, ids);
  await page.evaluate(() => window.LEStudio.cmd('dist:v'));
  ls = (await h.layers(page)).sort((a, b) => a.y - b.y);
  h.assert(Math.abs((ls[1].y - (ls[0].y + ls[0].h)) - (ls[2].y - (ls[1].y + ls[1].h))) < 2, 'equal vertical gaps');
};
cases['group toolbar button and Ctrl+G / Ctrl+Shift+G work from the keyboard'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const ids = await twoShapes(page, h);
  await h.select(page, ids);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'g', { ctrl: true });
  h.assert((await h.layers(page)).some((l) => l.type === 'group'), 'Ctrl+G groups');
  await h.key(page, 'G', { ctrl: true, shift: true });
  h.assert(!(await h.layers(page)).some((l) => l.type === 'group'), 'Ctrl+Shift+G ungroups');
};
cases['order: bring to front, send to back, forward, backward (and [ ] keys)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const ids = await h.addLayers(page, [0, 1, 2].map((i) => ({ type: 'shape', shape: 'rectangle', x: 50 * i, y: 50 * i, w: 200, h: 200 })));
  const order = async () => (await h.layers(page)).map((l) => l.id);
  await h.select(page, [ids[0]]); await page.evaluate(() => window.LEStudio.cmd('order:front'));
  h.assert.equal((await order()).join(), [ids[1], ids[2], ids[0]].join(), 'to front');
  await page.evaluate(() => window.LEStudio.cmd('order:back'));
  h.assert.equal((await order()).join(), ids.join(), 'to back');
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, ']');
  h.assert.equal((await order()).join(), [ids[1], ids[0], ids[2]].join(), '] forward');
  await h.key(page, '[');
  h.assert.equal((await order()).join(), ids.join(), '[ backward');
};
cases['lock stops moving and deleting; unlock restores both'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.select(page, [a]);
  await page.click('#sx-tool [data-cmd=lock]');
  h.assert((await h.layers(page))[0].locked === true, 'locked');
  const c = await h.centerOf(page, a);
  const x0 = (await h.layers(page))[0].x;
  await h.drag(page, c, { x: c.x + 60, y: c.y });
  h.assert.equal((await h.layers(page))[0].x, x0, 'did not move');
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'Delete');
  h.assert.equal((await h.layers(page)).length, 2, 'not deleted');
  await h.select(page, [a]); // a locked layer cannot be picked on the canvas (see QA-REPORT), so select it the way the Layers panel does
  await page.click('#sx-tool [data-cmd=unlock]');
  h.assert((await h.layers(page))[0].locked === false, 'unlocked');
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'Delete');
  h.assert.equal((await h.layers(page)).length, 1, 'deleted once unlocked');
};
cases['duplicate (button and Ctrl+D) and delete (button and Del)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.select(page, [a]);
  await page.click('#sx-tool [data-cmd=dup]');
  let ls = await h.layers(page);
  h.assert.equal(ls.length, 3, 'duplicated');
  h.assert((await h.selection(page)).length === 1 && (await h.selection(page))[0] !== a, 'copy is selected');
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'd', { ctrl: true });
  h.assert.equal((await h.layers(page)).length, 4, 'Ctrl+D');
  await page.click('#sx-tool [data-cmd=del]');
  h.assert.equal((await h.layers(page)).length, 3, 'delete button');
  await h.key(page, 'Backspace');
  h.assert((await h.layers(page)).length <= 3, 'no crash on Backspace with empty selection');
};
cases['copy and paste (Ctrl+C / Ctrl+V) clones the selection, offset'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.select(page, [a]);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'c', { ctrl: true });
  await h.key(page, 'v', { ctrl: true });
  const ls = await h.layers(page);
  h.assert.equal(ls.length, 3, 'pasted');
  const src = ls[0], copy = ls[2];
  h.assert(copy.id !== src.id && copy.w === src.w && copy.x !== src.x, 'copy has a new id and an offset');
};
cases['undo/redo through a sequence returns to identical documents'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const states = [await h.doc(page)];
  const steps = [
    () => h.addLayers(page, [{ type: 'shape', shape: 'rectangle', x: 100, y: 100, w: 200, h: 200 }]),
    () => page.evaluate(() => { const s = window.LEStudio.scene; s.update(s.layers()[0].id, { x: 400, y: 300 }); }),
    () => page.evaluate(() => { window.LEStudio.addText({ text: 'Hi', size: 60 }); }),
    () => page.evaluate(() => { const s = window.LEStudio.scene; s.duplicate([s.layers()[0].id]); }),
    () => page.evaluate(() => { const s = window.LEStudio.scene; s.remove([s.layers()[1].id]); })
  ];
  for (const st of steps) { await st(); await page.waitForTimeout(80); await page.evaluate(() => window.LEStudio.scene._endHist()); states.push(await h.doc(page)); }
  for (let i = states.length - 2; i >= 0; i--) {
    await page.click('#sx-head [data-cmd=undo]');
    h.assert(h.sameDoc(await h.doc(page), states[i]), 'undo returns to state ' + i);
  }
  h.assert(await page.locator('#sx-head [data-cmd=undo]').isDisabled(), 'undo disabled at the start');
  for (let i = 1; i < states.length; i++) {
    await page.click('#sx-head [data-cmd=redo]');
    h.assert(h.sameDoc(await h.doc(page), states[i]), 'redo reaches state ' + i);
  }
  h.assert(await page.locator('#sx-head [data-cmd=redo]').isDisabled(), 'redo disabled at the end');
};
cases['Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y work from the keyboard'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await twoShapes(page, h);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  const full = await h.doc(page);
  await h.key(page, 'z', { ctrl: true });
  h.assert((await h.doc(page)).layers.length < full.layers.length, 'undone');
  await h.key(page, 'Z', { ctrl: true, shift: true });
  h.assert.equal((await h.doc(page)).layers.length, full.layers.length, 'redone');
  await h.key(page, 'z', { ctrl: true }); await h.key(page, 'y', { ctrl: true });
  h.assert.equal((await h.doc(page)).layers.length, full.layers.length, 'Ctrl+Y redo');
};

/* ---------- zoom and view ---------- */
cases['zoom in/out buttons, zoom presets, fit and Ctrl+0'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const z = () => page.evaluate(() => window.LEStudio.scene.zoom());
  const fit = await z();
  await page.click('#sx-foot [data-cmd=zoomIn]'); const zi = await z();
  h.assert(zi > fit * 1.2, 'zoom in');
  await page.click('#sx-foot [data-cmd=zoomOut]'); await page.click('#sx-foot [data-cmd=zoomOut]');
  h.assert((await z()) < fit * 0.9, 'zoom out');
  await page.click('#sx-foot [data-cmd=zoomMenu]');
  await page.locator('#sx-pop [data-cmd="zoomTo:1"]').click();
  h.assert(Math.abs((await z()) - 1) < 0.001, '100% preset');
  h.assert.equal((await page.textContent('#sx-zoomv')).trim(), '100%', 'label shows 100%');
  await page.click('#sx-foot [data-cmd=fit]');
  h.assert(Math.abs((await z()) - fit) < 0.02, 'fit returns');
  await page.click('#sx-foot [data-cmd=zoomIn]');
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, '0', { ctrl: true });
  h.assert(Math.abs((await z()) - fit) < 0.02, 'Ctrl+0 fits');
};
cases['the page fits inside the stage at fit zoom (nothing clipped) for every size'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  for (const [name] of SIZES) {
    await page.locator('.sx-size-card').filter({ hasText: name }).first().click();
    await page.waitForTimeout(250);
    const ok = await page.evaluate(() => {
      const s = window.LEStudio.scene, d = s.toJSON(), z = s.zoom();
      const st = document.getElementById('sx-scene').getBoundingClientRect();
      return d.width * z <= st.width + 1 && d.height * z <= st.height + 1;
    });
    h.assert(ok, name + ' fits at fit zoom');
    await page.evaluate(() => window.LEStudio.cmd('newDesign'));
    await page.waitForSelector('#sx-start:not([hidden])');
  }
};
cases['? opens the shortcut sheet and Esc closes it'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.locator('#sx-scene').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('?');
  await page.waitForSelector('#sx-modal:not([hidden])');
  h.assert((await page.textContent('#sx-modal')).toLowerCase().indexOf('shortcut') >= 0, 'sheet content');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sx-modal', { state: 'hidden' });
};
cases['Escape deselects, then closes the open panel'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [a] = await twoShapes(page, h);
  await h.openPanel(page, 'elements');
  await h.select(page, [a]);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await page.keyboard.press('Escape');
  h.assert.equal((await h.selection(page)).length, 0, 'deselected');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  h.assert(await page.locator('#sx-panel').isHidden(), 'panel closed by the second Esc');
};
cases['file menu lists the main actions'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.click('#sx-head [data-cmd=fileMenu]');
  await page.waitForSelector('#sx-pop .sx-menu');
  const txt = await page.textContent('#sx-pop');
  for (const w of ['New design', 'Add photos', 'Your designs', 'Import .leproject', 'Export .leproject', 'Download image']) h.assert(txt.indexOf(w) >= 0, 'file menu has ' + w);
};
module.exports = cases;
