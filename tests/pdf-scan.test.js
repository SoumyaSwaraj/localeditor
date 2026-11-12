'use strict';
/* D10 "Scan with camera" in the PDF studio (assets/js/le-pdf-scan.js). Headless Chromium has no camera, so a fake one is
 * installed before the page loads: getUserMedia returns a canvas stream showing a sheet of paper on a dark desk.
 * Covers: one tap from the start screen at phone size, camera capture, corner detection and dragging, straighten, clean-up
 * modes, a multi-page tray (photo picker, reorder, delete), Download PDF and Make PDF (into the studio), camera denied,
 * no camera API at all, scan then make searchable (D9), phone sizes, console. */
const cases = {};

/* A sheet on a desk. size: [W, H]; text lines follow the sheet; q = corners (TL TR BR BL) as fractions. */
const DESK = `function deskCanvas(W, H, q, lines, px) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2b2118'); g.addColorStop(1, '#4a3a2c'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const Q = q.map((p) => [p[0] * W, p[1] * H]);
  x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 24; x.shadowOffsetY = 8;
  x.fillStyle = '#f3efe6'; x.beginPath(); Q.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); x.restore();
  x.fillStyle = '#1d1d1d';
  lines.forEach((t, i) => {
    const f = 0.1 + i * (0.8 / Math.max(lines.length, 8));
    const ax = Q[0][0] + (Q[3][0] - Q[0][0]) * f + (Q[1][0] - Q[0][0]) * 0.08, ay = Q[0][1] + (Q[3][1] - Q[0][1]) * f + (Q[1][1] - Q[0][1]) * 0.08;
    const bx = Q[1][0] + (Q[2][0] - Q[1][0]) * f, by = Q[1][1] + (Q[2][1] - Q[1][1]) * f;
    x.save(); x.translate(ax, ay); x.rotate(Math.atan2(by - ay, bx - ax)); x.font = px + 'px "Liberation Serif", serif'; x.fillText(t, 0, 0); x.restore();
  });
  return c;
}`;
const CAM_Q = [[0.2, 0.12], [0.8, 0.1], [0.86, 0.9], [0.14, 0.88]];
const FAKE_CAMERA = `(() => {
  ${DESK}
  const src = deskCanvas(1280, 960, ${JSON.stringify(CAM_Q)}, Array.from({ length: 10 }, (_, i) => 'Camera line ' + (i + 1) + ' delivery note 88213'), 22);
  const md = navigator.mediaDevices || {};
  md.getUserMedia = async (c) => {
    window.__camAsked = (window.__camAsked || 0) + 1; window.__camConstraints = c;
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 960; const x = cv.getContext('2d'); let n = 0;
    const draw = () => { x.drawImage(src, 0, 0); x.fillStyle = 'rgba(0,0,0,' + (n++ % 2 ? 0.02 : 0) + ')'; x.fillRect(0, 0, 2, 2); };
    draw(); setInterval(draw, 100);
    return cv.captureStream(10);
  };
})();`;
const DENIED_CAMERA = `navigator.mediaDevices.getUserMedia = async () => { window.__camAsked = (window.__camAsked || 0) + 1; throw new DOMException('Permission denied', 'NotAllowedError'); };`;
const NO_CAMERA_API = `Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined, configurable: true });`;

async function openScanner(h, browser, base, viewport, init) {
  const vp = h.VIEWPORTS[viewport || 'phone'];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: 'light' });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.goto(base + '/pdf-studio/', { waitUntil: 'networkidle' });
  return page;
}
/* A desk photo as a PNG buffer (generated in the page). */
async function deskPhoto(page, W, H, q, lines, px) {
  const b64 = await page.evaluate(([src, W, H, q, lines, px]) => {
    const deskCanvas = new Function('return ' + src)();
    return deskCanvas(W, H, q, lines, px).toDataURL('image/png').split(',')[1];
  }, [DESK, W, H, q, lines, px]);
  return Buffer.from(b64, 'base64');
}
async function view(page) { return page.evaluate(() => document.querySelector('.psn-work').getAttribute('data-view')); }
async function addThroughEditor(page, h, mode) {
  await page.waitForSelector('.psn-work[data-view="corners"]', { timeout: 20000 });
  await page.click('[data-psn="next"]');
  await page.waitForSelector('.psn-work[data-view="clean"]', { timeout: 20000 });
  if (mode) { await page.click('.psn-mode[data-mode="' + mode + '"]'); await page.waitForFunction((m) => document.querySelector('.psn-mode[data-mode="' + m + '"]').getAttribute('aria-pressed') === 'true', mode); }
  await page.click('[data-psn="add"]');
}
async function targets(page, sel) {
  return page.evaluate((s) => [].slice.call(document.querySelectorAll(s)).filter((b) => b.offsetParent && !b.closest('[hidden]')).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }), sel);
}

cases['one tap from the phone start screen; nothing heavy is fetched'] = async ({ browser, base, h }) => {
  const page = await openScanner(h, browser, base, 'phone', FAKE_CAMERA);
  const tile = await page.$('.ps-empty .psn-start');
  h.assert(tile, 'no Scan with camera tile on the start screen');
  const box = await tile.boundingBox();
  h.assert(box && box.y + box.height <= 844 && box.height >= 44, 'tile not reachable without scrolling at 390x844: ' + JSON.stringify(box));
  await tile.click();
  await page.waitForSelector('.psn-work:not([hidden])');
  h.assert.equal(await view(page), 'start');
  h.assert.equal(await page.evaluate(() => window.__camAsked || 0), 0, 'camera asked before the person tapped Take a photo');
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /\/tesseract\/|traineddata|opencv/i.test(u)));
  h.assert.equal(urls.length, 0, 'fetched: ' + urls.join(', '));
  h.assert.equal(await page.evaluate(() => (window.LE_SUPPORT_DEFS || []).some((d) => d.id === 'scan.camera' && d.needs.indexOf('camera') >= 0)), true, 'support declaration');
  h.assert(await h.noOverflow(page), 'sideways scroll');
  h.assert.noErrors(page);
};

cases['camera capture, corners found and dragged, two pages with the photo picker, reorder, delete, Download PDF and Make PDF'] = async ({ browser, base, h }) => {
  const page = await openScanner(h, browser, base, 'phone', FAKE_CAMERA);
  await page.click('.ps-empty .psn-start');
  await page.click('[data-psn="camera"]');
  await page.waitForFunction(() => PS.scan.state.camOn, null, { timeout: 15000 });
  const cons = await page.evaluate(() => JSON.stringify(window.__camConstraints));
  h.assert(/environment/.test(cons), 'should ask for the back camera: ' + cons);
  await page.waitForFunction(() => !document.querySelector('[data-psn="shoot"]').disabled);
  await page.click('[data-psn="shoot"]');
  await page.waitForSelector('.psn-work[data-view="corners"]', { timeout: 20000 });
  h.assert.equal(await page.evaluate(() => !!(document.querySelector('video') && document.querySelector('video').srcObject)), false, 'camera still on after the photo');
  const det = await page.evaluate(() => ({ c: PS.scan.state.cur.corners, w: PS.scan.state.cur.canvas.width, h: PS.scan.state.cur.canvas.height, found: PS.scan.state.cur.found }));
  h.assert(det.found, 'page not found in the camera photo');
  const diag = Math.hypot(det.w, det.h);
  det.c.forEach((p, i) => { const e = Math.hypot(p.x - [0.2, 0.8, 0.86, 0.14][i] * det.w, p.y - [0.12, 0.1, 0.9, 0.88][i] * det.h) / diag; h.assert(e < 0.03, 'corner ' + i + ' off by ' + (e * 100).toFixed(1) + ' % of the diagonal'); });
  /* drag the top-left corner 30 px right with a touch-like pointer; the magnifier shows while dragging */
  const ebox = await page.locator('.psn-editor').boundingBox(), k = ebox.width / det.w;
  const sx = ebox.x + det.c[0].x * k, sy = ebox.y + det.c[0].y * k;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 30, sy + 4, { steps: 4 });
  h.assert.equal(await page.evaluate(() => !document.querySelector('.psn-loupe').hidden), true, 'no magnifier while dragging');
  await page.mouse.up();
  const moved = await page.evaluate(() => PS.scan.state.cur.corners[0]);
  h.assert(Math.abs(moved.x - (det.c[0].x + 30 / k)) < 12, 'corner did not follow the drag');
  await page.click('[data-psn="auto"]');                                 /* back to the detected outline */
  await page.click('[data-psn="next"]');
  await page.waitForSelector('.psn-work[data-view="clean"]', { timeout: 20000 });
  await page.click('.psn-mode[data-mode="bw"]');
  await page.waitForFunction(() => PS.scan.state.cur.mode === 'bw' && document.querySelector('.psn-mode[data-mode="bw"]').getAttribute('aria-pressed') === 'true');
  const bw = await page.evaluate(() => { const c = PS.scan.state.cur.result, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let b = 0, w = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 30) b++; else if (d[i] > 225) w++; } return { b: b / (d.length / 4), w: w / (d.length / 4) }; });
  h.assert(bw.w > 0.8 && bw.b > 0.003 && bw.b < 0.2, 'Document mode should be black ink on white: ' + JSON.stringify(bw));
  await page.click('[data-psn="add"]');
  await page.waitForSelector('.psn-work[data-view="tray"]');
  /* second page from the photo picker, colour boost */
  const photo = await deskPhoto(page, 900, 1200, [[0.19, 0.12], [0.82, 0.09], [0.89, 0.84], [0.13, 0.88]], Array.from({ length: 12 }, (_, i) => 'Picked line ' + (i + 1)), 22);
  await page.setInputFiles('[data-psn-input="pick"]', { name: 'desk.png', mimeType: 'image/png', buffer: photo });
  await addThroughEditor(page, h, 'whiten');
  await page.waitForFunction(() => PS.scan.state.pages.length === 2 && document.querySelector('.psn-work').getAttribute('data-view') === 'tray');
  const modes = await page.evaluate(() => PS.scan.state.pages.map((p) => p.mode));
  h.assert.equal(JSON.stringify(modes), '["bw","whiten"]');
  /* memory: finished pages are compressed files, not canvases */
  h.assert.equal(await page.evaluate(() => PS.scan.state.pages.every((p) => p.out instanceof Blob && !p.canvas && p.out.size < 1500000)), true, 'pages should be kept as compressed files');
  /* reorder: move page 2 earlier */
  await page.click('.psn-page[data-i="1"] [data-psn-move="up"]');
  h.assert.equal(JSON.stringify(await page.evaluate(() => PS.scan.state.pages.map((p) => p.mode))), '["whiten","bw"]', 'reorder');
  /* a third page, then delete it */
  await page.setInputFiles('[data-psn-input="pick"]', { name: 'desk2.png', mimeType: 'image/png', buffer: photo });
  await addThroughEditor(page, h, 'gray');
  await page.waitForFunction(() => PS.scan.state.pages.length === 3);
  await page.waitForSelector('.psn-work[data-view="tray"]');
  await page.click('.psn-page[data-i="2"] [data-psn-page="delete"]');
  h.assert.equal(await page.evaluate(() => PS.scan.state.pages.length), 2, 'delete');
  h.assert(await h.noOverflow(page), 'tray scrolls sideways');
  const small = (await targets(page, '.psn-work button')).filter((t) => t.w < 44 || t.h < 44);
  h.assert(!small.length, 'targets under 44 px: ' + JSON.stringify(small));
  /* Download PDF: two pages; the black-and-white page is a 1-bit image */
  const dl = await h.capture(page, () => page.click('[data-psn="download"]'));
  h.assert(/^Scan .*\.pdf$/.test(dl.name), 'file name ' + dl.name);
  const read = await h.pdfRead(browser, base, dl.buf);
  h.assert.equal(read.pages, 2, 'downloaded PDF pages');
  h.assert(dl.size < 900000, 'PDF too large: ' + dl.size);
  h.assert(/BitsPerComponent 1/.test(dl.buf.toString('latin1')), 'the Document page should be stored as 1 bit per pixel');
  /* Make PDF: opens in the studio and clears the scan */
  await page.click('[data-psn="make"]');
  await page.waitForFunction(() => PS.S.pages.length === 2, null, { timeout: 30000 });
  h.assert.equal(await page.evaluate(() => document.querySelector('.psn-work').hidden && PS.scan.state.pages.length === 0), true, 'workbench should close and release the pages');
  h.assert.noErrors(page);
};

cases['camera denied: a plain explanation, photo picking still works'] = async ({ browser, base, h }) => {
  const page = await openScanner(h, browser, base, 'phone', DENIED_CAMERA);
  await page.click('.ps-empty .psn-start');
  await page.click('[data-psn="camera"]');
  await page.waitForFunction(() => document.querySelector('.psn-work').getAttribute('data-view') === 'start' && /blocked/.test(document.querySelector('.psn-msg').textContent), null, { timeout: 10000 });
  h.assert(/choose photos/i.test(await page.textContent('.psn-msg')), 'should point to choosing photos: ' + await page.textContent('.psn-msg'));
  const photo = await deskPhoto(page, 900, 1200, [[0.19, 0.12], [0.82, 0.09], [0.89, 0.84], [0.13, 0.88]], ['Denied camera page'], 26);
  await page.setInputFiles('[data-psn-input="pick"]', { name: 'desk.png', mimeType: 'image/png', buffer: photo });
  await addThroughEditor(page, h, null);
  await page.waitForFunction(() => PS.scan.state.pages.length === 1);
  h.assert.noErrors(page);
};

cases['no camera API: Take a photo opens the photo chooser instead'] = async ({ browser, base, h }) => {
  const page = await openScanner(h, browser, base, 'phone', NO_CAMERA_API);
  await page.click('.ps-empty .psn-start');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click('[data-psn="camera"]')]);
  h.assert(chooser, 'no file chooser');
  const photo = await deskPhoto(page, 900, 1200, [[0.19, 0.12], [0.82, 0.09], [0.89, 0.84], [0.13, 0.88]], ['No camera page'], 26);
  await chooser.setFiles({ name: 'desk.png', mimeType: 'image/png', buffer: photo });
  await addThroughEditor(page, h, null);
  await page.waitForFunction(() => PS.scan.state.pages.length === 1);
  h.assert.noErrors(page);
};

cases['scan, then make it searchable: the PDF in the studio has text'] = async ({ browser, base, h }) => {
  const page = await openScanner(h, browser, base, 'desktop', FAKE_CAMERA);
  await page.click('.ps-empty .psn-start');
  const lines = ['Scanned receipt from the office', 'Invoice 5523 paid by card', 'Thank you for shopping locally', 'Keep this copy for your records'];
  const photo = await deskPhoto(page, 1500, 2000, [[0.12, 0.08], [0.88, 0.07], [0.9, 0.93], [0.1, 0.94]], lines, 46);
  await page.setInputFiles('[data-psn-input="pick"]', { name: 'receipt.png', mimeType: 'image/png', buffer: photo });
  await addThroughEditor(page, h, 'bw');
  await page.waitForSelector('.psn-work[data-view="tray"]');
  await page.click('.psn-ocr');
  h.assert.equal(await page.evaluate(() => PS.scan.state.searchable), true, 'toggle');
  await page.click('[data-psn="make"]');
  await page.waitForFunction(() => PS.S.pages.length === 1, null, { timeout: 80000 });
  const text = await page.evaluate(() => PS.ocr.allText());
  ['Invoice', '5523', 'receipt'].forEach((w) => h.assert(text.indexOf(w) >= 0, 'missing "' + w + '" in the scanned PDF text: ' + text.length + ' chars'));
  h.assert.equal(await page.evaluate(() => LE.ocr.isLoaded()), null, 'engine left loaded');
  h.assert.noErrors(page);
};

cases['phone 360: every scanner view fits without sideways scroll'] = async ({ browser, base, h }) => {
  const page = await openScanner(h, browser, base, 'small', FAKE_CAMERA);
  await page.click('.ps-empty .psn-start');
  h.assert(await h.noOverflow(page), 'start');
  await page.click('[data-psn="camera"]');
  await page.waitForFunction(() => PS.scan.state.camOn && !document.querySelector('[data-psn="shoot"]').disabled, null, { timeout: 15000 });
  h.assert(await h.noOverflow(page), 'camera');
  const shoot = (await targets(page, '.psn-cambar button'));
  h.assert(shoot.every((t) => t.w >= 44 && t.h >= 44), 'camera targets: ' + JSON.stringify(shoot));
  await page.click('[data-psn="shoot"]');
  await page.waitForSelector('.psn-work[data-view="corners"]', { timeout: 20000 });
  h.assert(await h.noOverflow(page), 'corners');
  const tools = await targets(page, '.psn-tools button, .psn-acts button');
  h.assert(tools.every((t) => t.w >= 44 && t.h >= 44), 'corner targets: ' + JSON.stringify(tools));
  const tb = await page.evaluate(() => { const r = document.querySelector('.psn-tools').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
  h.assert(tb, 'corner tools spill over the edge');
  await page.click('[data-psn="next"]');
  await page.waitForSelector('.psn-work[data-view="clean"]', { timeout: 20000 });
  h.assert(await h.noOverflow(page), 'clean');
  const modes = await targets(page, '.psn-mode');
  h.assert(modes.length === 4 && modes.every((t) => t.h >= 44), 'mode targets: ' + JSON.stringify(modes));
  await page.click('[data-psn="add"]');
  await page.waitForSelector('.psn-work[data-view="tray"]');
  h.assert(await h.noOverflow(page), 'tray');
  h.assert.noErrors(page);
};

module.exports = cases;
