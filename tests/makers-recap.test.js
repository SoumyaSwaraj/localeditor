'use strict';
/* Recap collages (roadmap 2.10): 4–30 photos in every style and size, layouts that adapt to count and orientation
   (the collage engine where it fits), the date range text, ordering by capture date read on the device, remake in
   one undo step, phone sizes, nothing fetched from outside. */

async function studio(h, browser, base, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  page.outside = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) page.outside.push(u); });
  await page.waitForFunction(() => window.LEStudio && window.LEStudioMakers && window.LE.makers);
  await page.evaluate(() => LE.makers.ready());
  return page;
}
/* Portrait (p0…) and landscape (l0…) canvases as stand-in photos. */
const fakePhotos = (page) => page.evaluate(() => {
  window.__imgs = {};
  for (let i = 0; i < 30; i++) for (const k of ['p', 'l']) {
    const c = document.createElement('canvas'); c.width = k === 'p' ? 600 : 900; c.height = k === 'p' ? 900 : 600;
    const g = c.getContext('2d'); g.fillStyle = 'hsl(' + (i * 37) + ',60%,55%)'; g.fillRect(0, 0, c.width, c.height);
    window.__imgs[k + i] = c;
  }
});

const cases = {};

cases['4 to 30 photos in every style and size make valid documents'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await fakePhotos(page);
  const r = await page.evaluate(async () => {
    const out = [];
    const m = LE.makers.get('recap');
    for (const st of m.styles) for (const sz of m.sizes) for (const n of [1, 4, 7, 12, 21, 30]) {
      const photos = Array.from({ length: n }, (_, i) => (i % 3 ? 'l' : 'p') + i);
      const b = await LE.makers.build('recap', { photos, title: 'Coast to coast', from: '2026-10-03', to: '2026-10-11', stats: '9 days · 4 towns' }, { style: st.id, size: sz.id, images: window.__imgs });
      const pg = b.pages[0];
      const assets = {};
      photos.forEach((p) => { assets[p] = { id: p, type: 'image/jpeg', name: p + '.jpg', width: 900, height: 600 }; });
      const lint = LE.design.lint({ name: 'x', pages: [pg], assets, activePage: 0 }).map((w) => w.kind + ' ' + w.message);
      const imgs = pg.layers.filter((l) => l.type === 'image');
      const inside = imgs.every((l) => l.x >= -2 && l.y >= -2 && l.x + l.w <= pg.width + 2 && l.y + l.h <= pg.height + 2);
      /* Photos (unrotated) never overlap one another. */
      let overlap = false;
      if (st.id !== 'prints') for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) {
        const a = imgs[i], c = imgs[j];
        if (a.x + a.w - 1 > c.x && c.x + c.w - 1 > a.x && a.y + a.h - 1 > c.y && c.y + c.h - 1 > a.y) overlap = true;
      }
      const story = sz.id === 'story' ? pg.layers.filter((l) => l.type === 'text').every((l) => l.y >= 220 && l.y + l.h <= 1920 - 280) : true;
      out.push({ key: st.id + '/' + sz.id + '/' + n, n, imgs: imgs.length, filled: imgs.filter((l) => l.src).length, inside, overlap, story, lint, check: LE.makers.check(pg).map((p) => p.message) });
    }
    return out;
  });
  r.forEach((x) => {
    h.assert.equal(x.imgs, Math.max(4, x.n), x.key + ' photo slots');
    h.assert.equal(x.filled, x.n, x.key + ' photos placed');
    h.assert(x.inside && !x.overlap, x.key + ' photos inside the page, not overlapping');
    h.assert(x.story, x.key + ' story keeps words clear of app chrome');
    h.assert(!x.lint.length, x.key + ' lint: ' + x.lint.slice(0, 2).join(' | '));
    h.assert(!x.check.length, x.key + ' check: ' + x.check.slice(0, 2).join(' | '));
  });
  h.assert.noErrors(page);
};

cases['layouts adapt to orientation and count, using the collage engine'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await fakePhotos(page);
  const r = await page.evaluate(async () => {
    const shape = async (prefix, n, style) => {
      const b = await LE.makers.build('recap', { photos: Array.from({ length: n }, (_, i) => prefix + i) }, { style, size: 'portrait', images: window.__imgs });
      const imgs = b.pages[0].layers.filter((l) => l.type === 'image');
      const crop = imgs.reduce((a, l) => a + Math.abs(Math.log((l.w / l.h) / (prefix === 'p' ? 2 / 3 : 1.5))), 0) / imgs.length;
      return { cellAR: imgs.reduce((a, l) => a + l.w / l.h, 0) / imgs.length, crop, area: imgs.reduce((a, l) => a + l.w * l.h, 0) / imgs.length };
    };
    const engine = (n) => LE.collage.layouts(n, 1).map((l) => l.id);
    return {
      cleanP: await shape('p', 6, 'clean'), cleanL: await shape('l', 6, 'clean'),
      rowsP: await shape('p', 9, 'rows'), rowsL: await shape('l', 9, 'rows'),
      few: await shape('l', 4, 'clean'), many: await shape('l', 16, 'clean'), lots: await shape('l', 30, 'clean'),
      hasEngine: !!(LE.collage && LE.collage.layouts), engine6: engine(6).length
    };
  });
  h.assert(r.hasEngine && r.engine6 > 3, 'collage engine is there');
  h.assert(r.cleanP.cellAR < r.cleanL.cellAR, 'portrait photos get taller cells: ' + r.cleanP.cellAR.toFixed(2) + ' vs ' + r.cleanL.cellAR.toFixed(2));
  h.assert(r.cleanP.crop < 0.5 && r.cleanL.crop < 0.5, 'little cropping: ' + r.cleanP.crop.toFixed(2) + ', ' + r.cleanL.crop.toFixed(2));
  h.assert(r.rowsP.crop < 0.02 && r.rowsL.crop < 0.02, 'fitted rows keep each photo’s shape');
  h.assert(r.few.area > r.many.area && r.many.area > r.lots.area, 'more photos, smaller cells: ' + [r.few.area, r.many.area, r.lots.area].map(Math.round));
};

cases['date range and title read naturally'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const R = LE.makers.recapRange;
    const b = (v) => LE.makers.build('recap', Object.assign({ photos: ['a1'] }, v), { style: 'clean' }).then((x) => x.pages[0].layers);
    const t = (L, id) => (L.find((l) => l.id === id) || {}).text;
    const week = await b({ period: 'week' }), trip = await b({ period: 'trip', title: 'Lisbon', stats: '3 days · 41 km' }), year = await b({ period: 'year', from: '2026-01-01', to: '2026-12-31' });
    return {
      sameMonth: R('2026-11-03', '2026-11-09', 'week'), sameYear: R('2026-10-28', '2026-11-03', 'week'), across: R('2025-12-30', '2026-01-02', 'trip'),
      swapped: R('2026-11-09', '2026-11-03', 'week'), one: R('2026-11-03', '', 'week'), month: R('2026-02-01', '2026-02-28', 'month'), year: R('2026-01-01', '2026-12-31', 'year'), none: R('', '', 'week'),
      weekTitle: t(week, 'title'), tripTitle: t(trip, 'title'), stats: t(trip, 'stats'), yearDates: t(year, 'dates'), noDates: week.some((l) => l.id === 'dates')
    };
  });
  h.assert.equal(r.sameMonth, '3 – 9 November 2026');
  h.assert.equal(r.sameYear, '28 Oct – 3 Nov 2026');
  h.assert.equal(r.across, '30 Dec 2025 – 2 Jan 2026');
  h.assert.equal(r.swapped, '3 – 9 November 2026');
  h.assert.equal(r.one, '3 November 2026');
  h.assert.equal(r.month, 'February 2026');
  h.assert.equal(r.year, '2026');
  h.assert.equal(r.none, '');
  h.assert.equal(r.weekTitle, 'My week');
  h.assert.equal(r.tripTitle, 'Lisbon');
  h.assert.equal(r.stats, '3 days · 41 km');
  h.assert.equal(r.yearDates, '2026');
  h.assert(!r.noDates, 'no dates, no date line');
};

/* JPEGs with a capture date (DateTimeOriginal), written with the privacy module's own TIFF writer. */
async function datedPhotos(page, dates) {
  return page.evaluate(async (dates) => {
    if (!LE.privacy) await LE.lazy('../assets/js/le-privacy.js');
    const ids = [];
    for (let i = 0; i < dates.length; i++) {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = 'hsl(' + i * 70 + ',60%,50%)'; g.fillRect(0, 0, 400, 300);
      const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
      let parts = [jpg];
      if (dates[i]) {
        const tiff = LE.privacy.tiffWriter({ taken: dates[i] });
        const head = new Uint8Array(10); const len = 2 + 6 + tiff.length;
        head.set([0xFF, 0xE1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
        parts = [jpg.slice(0, 2), head, tiff, jpg.slice(2)];
      }
      const meta = await LEStudio.ingest(new File(parts, 'p' + i + '.jpg', { type: 'image/jpeg' }));
      ids.push(meta.id);
    }
    return ids;
  }, dates);
}

cases['photos are put in the order they were taken and the dates are suggested'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const ids = await datedPhotos(page, ['2026:10:09 18:00:00', '2026:10:03 08:30:00', '', '2026:10:05 12:00:00', '2026:10:11 09:00:00']);
  await page.evaluate((ids) => LEStudioMakers.open('recap', { values: { photos: ids, period: 'trip', title: 'Trip' } }), ids);
  await page.waitForFunction((first) => { const F = LEStudioMakers.form(); return F && F.values.photos[0] !== first && F.values.from; }, ids[0], { timeout: 15000 });
  const v = await page.evaluate(() => LEStudioMakers.form().values);
  h.assert.equal(v.photos.join(','), [ids[1], ids[3], ids[0], ids[4], ids[2]].join(','), 'by date taken, undated last');
  h.assert(v.from === '2026-10-03' && v.to === '2026-10-11', 'date range suggested: ' + v.from + ' – ' + v.to);
  const shown = await page.evaluate(() => ({ from: document.querySelector('.mk-field[data-key="from"] input').value, n: document.querySelectorAll('.mk-field[data-key="photos"] .mk-ph').length }));
  h.assert(shown.from === '2026-10-03' && shown.n === 5, 'form shows the new order and dates');
  await page.evaluate(() => LEStudioMakers.close());

  /* "As picked" keeps the order; dates the person typed are kept. */
  await page.evaluate((ids) => LEStudioMakers.open('recap', { values: { photos: ids, order: 'picked', from: '2026-01-01', to: '2026-01-02' } }), ids);
  await page.waitForTimeout(1500);
  const v2 = await page.evaluate(() => LEStudioMakers.form().values);
  h.assert(v2.photos.join(',') === ids.join(',') && v2.from === '2026-01-01', 'as picked, typed dates kept');
  await page.evaluate(() => LEStudioMakers.close());
  h.assert.noErrors(page);
  h.assert(!page.outside.length, 'outside requests: ' + page.outside.join(', '));
};

cases['remake is one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(() => LEStudioMakers.open('recap', { values: { photos: ['sample:travel-01', 'sample:travel-03', 'sample:nature-01', 'sample:sky-02'], title: 'Before', order: 'picked' } }));
  await page.waitForFunction(() => document.querySelector('.mk-render'));
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const before = await h.doc(page);
  h.assert(before.maker.values.photos.every((p) => !/^sample:/.test(p)), 'sample photos became assets');
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForFunction(() => LEStudioMakers.form());
  await page.evaluate(() => { const F = LEStudioMakers.form(); F.values.title = 'After'; F.style = 'film'; });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker.style === 'film');
  await page.waitForTimeout(300);
  h.assert((await h.doc(page)).layers.some((l) => l.id === 'title' && l.text === 'After'), 'remade');
  await page.evaluate(() => LEStudio.scene.undo());
  await page.waitForTimeout(200);
  const undone = await h.doc(page);
  h.assert(undone.maker.style === 'clean' && JSON.stringify(undone.layers) === JSON.stringify(before.layers), 'one undo restores it');
  h.assert.noErrors(page);
};

cases['form at 390 and 360 px: no sideways scroll, 44px targets'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studio(h, browser, base, vp);
    await page.evaluate(() => LEStudio.openPanel('apps', { app: 'make' }));
    await page.waitForFunction(() => document.querySelectorAll('.mk-grid .mk-card').length === LE.makers.list().length);
    await page.evaluate(() => { const i = document.querySelector('.mk-search input'); i.value = 'year in review'; i.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => { const t = document.querySelector('.mk-card[data-maker="recap"] .mk-thumb'); return t && t.classList.contains('is-ready'); }, null, { timeout: 30000 });
    await page.click('.mk-card[data-maker="recap"]');
    await page.waitForFunction(() => document.querySelector('.mk-render'));
    await page.waitForTimeout(300);
    h.assert(await h.noOverflow(page), vp + ' form overflow');
    const small = await page.evaluate(() => [...document.querySelectorAll('.mk-sheet button, .mk-sheet input:not([type=checkbox]), .mk-sheet select')]
      .filter((n) => n.offsetParent && n.getBoundingClientRect().height < 40 && !n.classList.contains('mk-ph-x')).map((n) => n.className || n.tagName));
    h.assert(!small.length, 'small targets: ' + small.slice(0, 4).join(','));
    h.assert.noErrors(page);
    h.assert(!page.outside.length, 'outside requests');
    await page.context().close();
  }
};

module.exports = cases;
