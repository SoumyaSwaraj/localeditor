'use strict';
/* Carousel maker: doc.carousel as plain data, undo/redo, .leproject round trip, add/remove slide, split, snapping, guides, entry points. */
const { dims, unzip, grab } = require('./export.test.js')._lib;

async function carouselWithContent(page) {
  return page.evaluate(() => {
    const c = window.LEStudio;
    LEStudioExport.carousel.newDesign(c, { w: 1080, h: 1350, slides: 3 });
    c.addShape('rect');
    const sh = c.scene.layers().slice(-1)[0];
    /* A bar that crosses the seam between slides 1 and 2. */
    c.scene.update(sh.id, { x: 800, y: 600, w: 400, h: 150, fill: { type: 'solid', color: '#7457F0' }, color: '#7457F0', rotation: 0 });
    c.addText({ text: 'Slide two', size: 60 });
    const tx = c.scene.layers().slice(-1)[0];
    c.scene.update(tx.id, { x: 1080 + 200, y: 200, rotation: 0 });
    return { bar: sh.id, text: tx.id };
  });
}

const cases = {};

cases['carousel lands in the doc as plain data and survives undo/redo'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const w0 = (await h.doc(page)).width;
  await page.evaluate(() => LEStudioExport.carousel.make(window.LEStudio, { slides: 3 }));
  let d = await h.doc(page);
  h.assert.equal(JSON.stringify(d.carousel), JSON.stringify({ v: 1, slides: 3, slideWidth: w0 }), 'carousel field');
  h.assert.equal(d.width, w0 * 3, 'page widened');
  await page.evaluate(() => window.LEStudio.scene.undo());
  d = await h.doc(page);
  h.assert(!d.carousel && d.width === w0, 'undo removes it');
  await page.evaluate(() => window.LEStudio.scene.redo());
  d = await h.doc(page);
  h.assert(d.carousel && d.carousel.slides === 3 && d.width === w0 * 3, 'redo restores it');
  /* Junk is refused by the sanitiser. */
  const junk = await page.evaluate(() => [LE.Scene.carouselOf({ slides: 'x' }), LE.Scene.carouselOf({ slides: 99, slideWidth: 500, evil: '<script>' }), LE.Scene.carouselOf([])]);
  h.assert(junk[0] === null && junk[2] === null && JSON.stringify(junk[1]) === '{"v":1,"slides":20,"slideWidth":500}', 'sanitised: ' + JSON.stringify(junk));
  h.assert.noErrors(page);
};

cases['carousel survives a .leproject round trip'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await carouselWithContent(page);
  const f = await grab(page, () => page.evaluate(() => window.LEStudio.exportProject()));
  h.assert(f.name.endsWith('.leproject'), 'project file');
  await page.evaluate(() => window.LEStudio.newDesign(500, 500, 'Other'));
  await page.setInputFiles('#sx-file-project', { name: f.name, mimeType: 'application/zip', buffer: f.buf });
  await page.waitForFunction(() => window.LEStudio.scene.toJSON().width === 3240, null, { timeout: 15000 });
  const d = await h.doc(page);
  h.assert.equal(JSON.stringify(d.carousel), '{"v":1,"slides":3,"slideWidth":1080}', 'carousel after import');
  h.assert.noErrors(page);
};

cases['add and remove slide keep content in place; split gives N slide images that meet at the seams'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const ids = await carouselWithContent(page);
  const x = async (id) => (await h.doc(page)).layers.find((l) => l.id === id).x;
  const t0 = await x(ids.text), b0 = await x(ids.bar);
  await page.evaluate(() => LEStudioExport.carousel.addSlide(window.LEStudio, 1));
  let d = await h.doc(page);
  h.assert(d.width === 4320 && d.carousel.slides === 4, 'four slides');
  h.assert.equal(await x(ids.text), t0 + 1080, 'slide-2 text moved with its slide');
  h.assert.equal(await x(ids.bar), b0, 'slide-1 bar stayed');
  await page.evaluate(() => LEStudioExport.carousel.removeSlide(window.LEStudio, 1));
  d = await h.doc(page);
  h.assert(d.width === 3240 && d.carousel.slides === 3, 'back to three');
  h.assert.equal(await x(ids.text), t0, 'text back in place');
  h.assert.equal(d.layers.length, 2, 'nothing lost from an empty slide');
  /* Add at the end via the panel; remove it with its own button. */
  await h.openPanel(page, 'export', { tab: 'slides' });
  await page.click('.sxe-slide-add');
  h.assert.equal((await h.doc(page)).carousel.slides, 4, 'panel add');
  await page.click('.sxe-slide-x[aria-label="Remove slide 4"]');
  h.assert.equal((await h.doc(page)).carousel.slides, 3, 'panel remove');
  const before = JSON.stringify(await h.doc(page));
  const r = await page.evaluate(async () => {
    const items = await LEStudioExport.carousel.split(window.LEStudio, { format: 'png' });
    const out = [];
    for (const it of items) {
      const bmp = await createImageBitmap(it.blob);
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const x = cv.getContext('2d'); x.drawImage(bmp, 0, 0);
      out.push({ name: it.name, w: bmp.width, h: bmp.height, left: Array.from(x.getImageData(0, 675, 1, 1).data), right: Array.from(x.getImageData(bmp.width - 1, 675, 1, 1).data) });
    }
    return out;
  });
  h.assert.equal(r.length, 3, 'three slides');
  h.assert(r.every((s, i) => s.w === 1080 && s.h === 1350 && s.name === 'instagram-carousel-slide-0' + (i + 1) + '.png'), 'slide sizes and names ' + JSON.stringify(r.map((s) => s.name + s.w)));
  const near = (a, b) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < 6);
  h.assert(near(r[0].right, [0x74, 0x57, 0xF0]) && near(r[1].left, [0x74, 0x57, 0xF0]), 'the bar continues across the seam: ' + r[0].right + ' / ' + r[1].left);
  h.assert(!near(r[2].left, [0x74, 0x57, 0xF0]), 'slide 3 has no bar');
  /* Narrow devices render in bands; the result is the same. */
  const banded = await page.evaluate(async () => {
    const t = LE.device.tier; LE.device.tier = () => 'older';
    try { return (await LEStudioExport.carousel.split(window.LEStudio, { format: 'jpeg' })).map((i) => i.width + 'x' + i.height); } finally { LE.device.tier = t; }
  });
  h.assert.equal(banded.join(), '1080x1350,1080x1350,1080x1350', 'banded split');
  h.assert.equal(JSON.stringify(await h.doc(page)), before, 'split leaves the doc alone');
  /* Download zip from the panel. */
  await h.openPanel(page, 'export', { tab: 'slides' });
  const z = await grab(page, () => page.click('#sx-panel-body [data-act="download"]'));
  const files = unzip(z.buf);
  h.assert.equal(files.map((f) => f.name + ':' + dims(f.data).w).join(), 'instagram-carousel-slide-01.jpg:1080,instagram-carousel-slide-02.jpg:1080,instagram-carousel-slide-03.jpg:1080');
  h.assert.noErrors(page);
};

cases['slide edges snap, guides are drawn, strip jumps between slides, swipe preview opens'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await carouselWithContent(page);
  const snap = await page.evaluate(() => { const s = window.LEStudio.scene; s.zoomTo(1); return s._snapRect({ x: 1077, y: 40, w: 100, h: 50 }, []).x; });
  h.assert.equal(snap, 1080, 'left edge snaps to the slide edge');
  await page.evaluate(() => window.LEStudio.fit());
  await page.waitForTimeout(300);
  const guide = await page.evaluate(() => {
    const a = window.LEStudio.artboard(972);
    const x = a.getContext('2d');
    const k = a.width / 3240;
    let purple = 0;
    for (let y = 20; y < a.height - 20; y += 4) {
      const p = x.getImageData(Math.round(2160 * k) - 2, y, 5, 1).data;
      for (let i = 0; i < p.length; i += 4) if (p[i + 2] - p[i] > 40 && p[i + 2] - p[i + 1] > 40) { purple++; break; }
    }
    return purple;
  });
  h.assert(guide > 5, 'dashed slide guide drawn on the canvas at x = 2160 (' + guide + ')');
  h.assert(await page.isVisible('.sxe-strip'), 'slide strip visible');
  const before = await page.evaluate(() => window.LEStudio.scene.view());
  await page.click('.sxe-strip [data-slide="2"]');
  const after = await page.evaluate(() => window.LEStudio.scene.view());
  h.assert(after.zoom > before.zoom && after.panX < before.panX, 'zoomed to slide 3');
  h.assert.equal(await page.getAttribute('.sxe-strip [data-slide="2"]', 'aria-current'), 'true');
  await h.openPanel(page, 'export', { tab: 'slides' });
  await page.click('#sx-panel-body .sxe-row:has-text("Swipe preview")');
  await page.waitForSelector('.sxe-swipe-slide img');
  h.assert.equal(await page.locator('.sxe-swipe-slide img').count(), 3, 'three slides in the preview');
  h.assert.noErrors(page);
};

cases['Design → Resize offers the Instagram carousel start; multi-page designs export as numbered slides'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'phone');
  await h.openPanel(page, 'design', { tab: 'sizes' });
  await page.click('.sxe-car-start');
  await page.waitForTimeout(300);
  const d = await h.doc(page);
  h.assert(d.width === 3240 && d.height === 1350 && d.carousel.slides === 3, 'new carousel');
  h.assert(await page.isVisible('#sx-panel-body .sxe-slides'), 'slides tab opened');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  await page.evaluate(() => { const c = window.LEStudio; c.newDesign(600, 600, 'Deck'); c.addPage(); c.addPage(); c.openPanel('export', { tab: 'slides' }); });
  await page.waitForTimeout(300);
  const z = await grab(page, () => page.click('#sx-panel-body [data-act="download"]'));
  h.assert.equal(unzip(z.buf).map((f) => f.name).join(), 'deck-01.jpg,deck-02.jpg,deck-03.jpg', 'numbered slides');
  h.assert.noErrors(page);
};

module.exports = cases;
