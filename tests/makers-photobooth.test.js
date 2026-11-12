'use strict';
/* Photobooth strips (roadmap 2.10): print sizes and the two-on-a-sheet page, styles, the look on every frame, mirror,
   the camera with a fake stream (countdown, retake, saved unmirrored, stream stopped on close), camera denied and
   absent, remake in one undo step, phone sizes, nothing fetched from outside. */

async function studio(h, browser, base, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  page.outside = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) page.outside.push(u); });
  await page.waitForFunction(() => window.LEStudio && window.LEStudioMakers && window.LE.makers);
  await page.evaluate(() => LE.makers.ready());
  return page;
}
/* A fake camera: a canvas stream, red on the left and blue on the right, so a mirrored save is visible. */
function fakeCamera(page, mode) {
  return page.evaluate((mode) => {
    window.__streams = [];
    if (mode === 'absent') { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); return; }
    const md = navigator.mediaDevices || {};
    md.getUserMedia = (c) => {
      window.__asked = c;
      if (mode === 'denied') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
      const g = cv.getContext('2d');
      let t = 0;
      (function draw() { g.fillStyle = '#E02020'; g.fillRect(0, 0, 320, 480); g.fillStyle = '#2040E0'; g.fillRect(320, 0, 320, 480); g.fillStyle = '#FFFFFF'; g.fillRect((t++ * 7) % 600, 220, 40, 40); if (!window.__stopDraw) requestAnimationFrame(draw); })();
      const s = cv.captureStream(30);
      window.__streams.push(s);
      return Promise.resolve(s);
    };
    md.enumerateDevices = () => Promise.resolve([{ kind: 'videoinput', deviceId: 'a' }]);
  }, mode || 'ok');
}
const live = (page) => page.evaluate(() => (window.__streams || []).map((s) => s.getTracks().map((t) => t.readyState).join(',')));

const cases = {};

cases['sizes, styles and the print sheet make valid documents'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const out = [];
    const m = LE.makers.get('photobooth');
    for (const st of m.styles) for (const sz of m.sizes) for (const sheet of [false, true]) {
      const b = await LE.makers.build('photobooth', { caption: 'Saturday night', date: '2026-11-07', sheet }, { style: st.id, size: sz.id, today: '2026-11-12' });
      const pages = b.pages.map((pg) => {
        const assets = {};
        const lint = LE.design.lint({ name: 'x', pages: [pg], assets, activePage: 0 }).map((w) => w.kind + ' ' + w.message);
        return { w: pg.width, h: pg.height, print: pg.print, frames: pg.layers.filter((l) => l.type === 'image').length, slots: pg.layers.filter((l) => l.type === 'image' && l.slot && !l.src).length,
          cut: pg.layers.some((l) => l.id === 'cut'), lint, check: LE.makers.check(pg).map((p) => p.message), date: (pg.layers.find((l) => /^date/.test(l.id)) || {}).text };
      });
      out.push({ key: st.id + '/' + sz.id + '/' + sheet, sz: sz.id, sheet, pages, warn: b.warnings.filter((w) => w.kind === 'input').length });
    }
    return out;
  });
  const frames = { four: 4, three: 3, grid: 4, wide: 4 };
  r.forEach((x) => {
    const p0 = x.pages[0];
    h.assert(p0.print && p0.print.dpi === 300, x.key + ' print meta');
    h.assert.equal(p0.frames, frames[x.sz], x.key + ' frames');
    h.assert.equal(p0.slots, frames[x.sz], x.key + ' empty frames are labelled slots');
    if (x.sz === 'four' || x.sz === 'three') h.assert(p0.w === 600 && p0.h === 1800 && Math.abs(p0.print.w - 50.8) < 0.01 && Math.abs(p0.print.h - 152.4) < 0.01, x.key + ' 2 × 6 in');
    if (x.sz === 'grid') h.assert(p0.w === 1200 && p0.h === 1800, x.key + ' 4 × 6 in');
    if (x.sz === 'wide') h.assert(p0.w === 1800 && p0.h === 600, x.key + ' 6 × 2 in');
    if (x.sheet && x.sz !== 'grid') {
      const s = x.pages[1];
      h.assert(x.pages.length === 2 && s.frames === frames[x.sz] * 2 && s.cut, x.key + ' sheet with two copies and a cut line');
      h.assert(x.sz === 'wide' ? (s.w === 1800 && s.h === 1200) : (s.w === 1200 && s.h === 1800 && s.print.paper === 'photo-4x6'), x.key + ' sheet size');
    } else h.assert.equal(x.pages.length, 1, x.key + ' pages');
    if (x.sheet && x.sz === 'grid') h.assert(x.warn === 1, x.key + ' grid explains why there is no sheet');
    x.pages.forEach((p, i) => {
      h.assert(!p.lint.length, x.key + ' p' + i + ' lint: ' + p.lint.slice(0, 2).join(' | '));
      h.assert(!p.check.length, x.key + ' p' + i + ' check: ' + p.check.slice(0, 2).join(' | '));
    });
    h.assert(/2026/.test(p0.date || ''), x.key + ' date line');
  });
  h.assert.noErrors(page);
};

cases['the look, mirror, caption and date line change the right layers'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const B = (v, o) => LE.makers.build('photobooth', v, Object.assign({ style: 'classic', size: 'four', today: '2026-11-12' }, o || {})).then((b) => b.pages[0]);
    const mono = await B({ look: 'mono' });
    const nat = await B({});
    const mir = await B({ mirror: true });
    const noDate = await B({ caption: 'Hi', dateLine: false });
    const today = await B({});
    const film = await B({ caption: 'Hi' }, { style: 'film' });
    const black = await B({ caption: 'Hi' }, { style: 'black' });
    const frames = (pg) => pg.layers.filter((l) => l.type === 'image');
    return {
      mono: frames(mono).map((l) => l.filter && l.filter.name), nat: frames(nat).map((l) => l.filter), presets: Object.keys(LE.presets.filters),
      mir: frames(mir).map((l) => l.flipX), unmir: frames(nat).map((l) => !!l.flipX),
      noDate: noDate.layers.some((l) => /^date/.test(l.id)), cap: (noDate.layers.find((l) => l.id === 'caption') || {}).text,
      today: (today.layers.find((l) => l.id === 'date') || {}).text,
      film: film.layers.filter((l) => /^sprockets/.test(l.id)).length, filmBg: film.background.color, blackBg: black.background.color
    };
  });
  h.assert(r.mono.every((n) => n === 'mono') && r.mono.length === 4 && r.presets.includes('mono'), 'one look on every frame, from LE.presets');
  h.assert(r.nat.every((f) => f === null), 'natural has no filter');
  h.assert(r.mir.every(Boolean) && r.unmir.every((x) => !x), 'mirror flips every frame');
  h.assert(!r.noDate && r.cap === 'Hi', 'date line off');
  h.assert.equal(r.today, '12 November 2026', 'empty date shows today');
  h.assert(r.film === 2, 'film edge has sprocket holes on both sides');
  h.assert(r.filmBg !== '#FFFFFF' && r.blackBg !== '#FFFFFF', 'dark styles');
};

cases['camera: countdown, all frames, retake one, saved the right way round, stream stopped'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await fakeCamera(page);
  await page.evaluate(() => LEStudioMakers.open('photobooth', { values: { caption: 'Booth' }, size: 'three' }));
  await page.waitForFunction(() => document.querySelector('.mkp-open') && document.querySelector('.mk-render'));
  await page.click('.mkp-open');
  await page.waitForFunction(() => { const v = document.querySelector('.mkp-video'); return v && v.videoWidth > 0; });
  const pre = await page.evaluate(() => ({ asked: window.__asked, mirror: document.querySelector('.mkp-video').classList.contains('is-mirror'), count: document.querySelector('.mkp-count').textContent }));
  h.assert(pre.asked.video && pre.asked.video.facingMode === 'user' && pre.asked.audio === false, 'asks for the front camera, no sound');
  h.assert(pre.mirror, 'front camera preview is mirrored');
  h.assert.equal(pre.count, 'Frame 1 of 3');
  await page.click('.mkp-shoot');
  await page.waitForFunction(() => /^[123]$/.test(document.querySelector('.mkp-num').textContent));
  await page.waitForFunction(() => document.querySelectorAll('.mkp-thumb canvas').length === 3 && !document.querySelector('.mkp-shoot').disabled, null, { timeout: 30000 });
  h.assert.equal(await page.evaluate(() => document.querySelector('.mkp-count').textContent), 'All 3 frames taken');
  /* Retake frame 2. */
  await page.click('.mkp-thumb:nth-child(2)');
  h.assert.equal(await page.evaluate(() => document.querySelector('.mkp-shoot').textContent), 'Retake frame 2');
  await page.click('.mkp-shoot');
  await page.waitForFunction(() => !document.querySelector('.mkp-shoot').disabled && document.querySelector('.mkp-shoot').textContent !== 'Retake frame 2', null, { timeout: 15000 });
  await page.click('.mkp-done');
  await page.waitForFunction(() => !document.querySelector('.mkp-cam') && (LEStudioMakers.form().values.photos || []).length === 3, null, { timeout: 15000 });
  const after = await page.evaluate(() => {
    const ids = LEStudioMakers.form().values.photos;
    const cv = LEStudio.mem[ids[0]].canvas;
    const px = cv.getContext('2d').getImageData(10, 10, 1, 1).data;
    return { ids, left: [px[0], px[1], px[2]], thumbs: document.querySelectorAll('.mk-field[data-key="photos"] .mk-ph').length };
  });
  h.assert(after.left[0] > 150 && after.left[2] < 100, 'saved unmirrored: left side is red ' + after.left);
  h.assert.equal(after.thumbs, 3, 'frames show in the form');
  h.assert((await live(page)).every((s) => s === 'ended'), 'stream stopped after Use these');
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker);
  const d = await h.doc(page);
  h.assert(d.layers.filter((l) => l.type === 'image' && l.src).length === 3, 'the strip uses the camera frames');
  h.assert.noErrors(page);
  h.assert(!page.outside.length, 'outside requests: ' + page.outside.join(', '));
};

cases['camera: "Save mirrored" keeps the mirror image; closing the maker stops the camera'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await fakeCamera(page);
  await page.evaluate(() => LEStudioMakers.open('photobooth', { size: 'three' }));
  await page.waitForFunction(() => document.querySelector('.mkp-open'));
  await page.click('.mkp-open');
  await page.waitForFunction(() => { const v = document.querySelector('.mkp-video'); return v && v.videoWidth > 0; });
  await page.check('.mkp-mirror input');
  await page.click('.mkp-shoot');
  await page.waitForFunction(() => document.querySelectorAll('.mkp-thumb canvas').length >= 1, null, { timeout: 15000 });
  /* Close the whole maker in the middle of the countdown for frame 2. */
  await page.evaluate(() => LEStudioMakers.close());
  await page.waitForTimeout(200);
  h.assert(!(await page.$('.mkp-cam')), 'camera panel gone');
  h.assert((await live(page)).every((s) => s === 'ended'), 'stream stopped when the maker closed');
  /* Mirrored save, checked on a fresh run. */
  await page.evaluate(() => LEStudioMakers.open('photobooth', { size: 'three' }));
  await page.waitForFunction(() => document.querySelector('.mkp-open'));
  await page.click('.mkp-open');
  await page.waitForFunction(() => { const v = document.querySelector('.mkp-video'); return v && v.videoWidth > 0; });
  await page.check('.mkp-mirror input');
  await page.click('.mkp-shoot');
  await page.waitForFunction(() => document.querySelectorAll('.mkp-thumb canvas').length >= 1, null, { timeout: 15000 });
  await page.click('.mkp-x');
  await page.waitForTimeout(200);
  h.assert((await live(page)).every((s) => s === 'ended'), 'stream stopped with the close button');
  await page.click('.mkp-open');
  await page.waitForFunction(() => { const v = document.querySelector('.mkp-video'); return v && v.videoWidth > 0; });
  await page.check('.mkp-mirror input');
  await page.click('.mkp-shoot');
  await page.waitForFunction(() => document.querySelectorAll('.mkp-thumb canvas').length >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(100);
  await page.click('.mkp-done', { force: true });
  await page.waitForFunction(() => !document.querySelector('.mkp-cam') && (LEStudioMakers.form().values.photos || []).length >= 1, null, { timeout: 15000 });
  const left = await page.evaluate(() => { const id = LEStudioMakers.form().values.photos[0]; const px = LEStudio.mem[id].canvas.getContext('2d').getImageData(10, 10, 1, 1).data; return [px[0], px[1], px[2]]; });
  h.assert(left[2] > 150 && left[0] < 100, 'saved mirrored: left side is blue ' + left);
  await page.evaluate(() => LEStudioMakers.close());
  h.assert((await live(page)).every((s) => s === 'ended'), 'every stream ended');
  h.assert.noErrors(page);
};

cases['camera denied or absent: a clear message and the photo picker still works'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await fakeCamera(page, 'denied');
  await page.evaluate(() => LEStudioMakers.open('photobooth', { values: { caption: 'No camera' } }));
  await page.waitForFunction(() => document.querySelector('.mkp-open'));
  await page.click('.mkp-open');
  await page.waitForFunction(() => /not allowed/.test(document.querySelector('.mkp-note').textContent));
  h.assert(!(await page.$('.mkp-cam')), 'no camera panel left open');
  h.assert(await page.$('.mk-field[data-key="photos"] .mk-use'), 'photo picker is there');
  await page.click('.mk-field[data-key="photos"] .mk-use');
  await page.waitForSelector('.mk-picker .mk-device');
  await page.evaluate(() => LEStudioMakers.close());
  await page.context().close();

  const p2 = await studio(h, browser, base);
  await fakeCamera(p2, 'absent');
  await p2.evaluate(() => LEStudioMakers.open('photobooth'));
  await p2.waitForFunction(() => document.querySelector('.mkp-open'));
  const r = await p2.evaluate(() => ({ disabled: document.querySelector('.mkp-open').disabled, note: document.querySelector('.mkp-note').textContent }));
  h.assert(r.disabled && /cannot use a camera/.test(r.note), 'no camera: ' + JSON.stringify(r));
  h.assert.noErrors(p2);
};

cases['remake is one undo step, including the print sheet'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(() => LEStudioMakers.open('photobooth', { values: { caption: 'One', date: '2026-11-07' }, size: 'four' }));
  await page.waitForFunction(() => document.querySelector('.mk-render'));
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker);
  await page.waitForTimeout(300);
  const before = await h.doc(page);
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForFunction(() => LEStudioMakers.form());
  await page.evaluate(() => { const F = LEStudioMakers.form(); F.values.caption = 'Two'; F.values.sheet = true; F.style = 'pastel'; });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker.values.caption === 'Two');
  await page.waitForTimeout(300);
  const pages = await page.evaluate(() => { LEStudio.syncProject(); return LEStudio.S.project.pages.map((p) => p.width + 'x' + p.height); });
  h.assert.equal(pages.join(','), '600x1800,1200x1800', 'strip and sheet');
  await page.evaluate(() => LEStudio.scene.undo());
  await page.waitForTimeout(300);
  const undone = await h.doc(page);
  const pages2 = await page.evaluate(() => { LEStudio.syncProject(); return LEStudio.S.project.pages.length; });
  h.assert(undone.maker.values.caption === 'One' && JSON.stringify(undone.layers) === JSON.stringify(before.layers), 'one undo restores the strip');
  h.assert.equal(pages2, 1, 'and removes the sheet');
  h.assert.noErrors(page);
};

cases['form and camera at 390 and 360 px: no sideways scroll, 44px targets'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studio(h, browser, base, vp);
    await fakeCamera(page);
    await page.evaluate(() => LEStudio.openPanel('apps', { app: 'make' }));
    await page.waitForFunction(() => document.querySelectorAll('.mk-grid .mk-card').length === LE.makers.list().length);
    await page.evaluate(() => { const i = document.querySelector('.mk-search input'); i.value = 'photo booth'; i.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => { const t = document.querySelector('.mk-card[data-maker="photobooth"] .mk-thumb'); return t && t.classList.contains('is-ready'); }, null, { timeout: 30000 });
    await page.click('.mk-card[data-maker="photobooth"]');
    await page.waitForFunction(() => document.querySelector('.mk-render') && document.querySelector('.mkp-open'));
    await page.waitForTimeout(400);
    const targets = () => page.evaluate(() => [...document.querySelectorAll('.mk-sheet button, .mk-sheet input:not([type=checkbox]), .mk-sheet select')]
      .filter((n) => n.offsetParent && Math.round(n.getBoundingClientRect().height) < 40 && !n.classList.contains('mk-ph-x')).map((n) => n.className || n.tagName));
    h.assert(await h.noOverflow(page), vp + ' form overflow');
    h.assert(!(await targets()).length, vp + ' small targets: ' + (await targets()).join(','));
    await page.click('.mkp-open');
    await page.waitForFunction(() => { const v = document.querySelector('.mkp-video'); return v && v.videoWidth > 0; });
    h.assert(await h.noOverflow(page), vp + ' camera overflow');
    h.assert(!(await targets()).length, vp + ' camera small targets: ' + (await targets()).join(','));
    const fits = await page.evaluate(() => { const r = document.querySelector('.mkp-done').getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; });
    h.assert(fits, vp + ' camera buttons on screen');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    h.assert(!(await page.$('.mkp-cam')) && (await page.$('.mk-sheet')), 'Escape closes the camera, not the maker');
    h.assert((await live(page)).every((s) => s === 'ended'), 'stream stopped');
    h.assert.noErrors(page);
    h.assert(!page.outside.length, 'outside requests');
    await page.context().close();
  }
};

module.exports = cases;
