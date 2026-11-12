'use strict';
/* Camera scan lab: find the page in a generated photo, move a corner, straighten, clean up as black and white, build a PDF.
 * Plain JS and canvas (no model, no download). The camera itself cannot be driven in headless Chromium, so the no-camera path is checked instead. */
const cases = {};

/* A dark desk with a slightly rotated, perspective-skewed sheet of paper carrying lines of text. Returns the PNG and the sheet's true corners. */
async function fixture(page) {
  return page.evaluate(() => {
    const W = 900, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2b2118'); g.addColorStop(1, '#4a3a2c');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const q = [[170, 150], [740, 110], [800, 1010], [120, 1060]];             /* TL TR BR BL */
    x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 28; x.shadowOffsetY = 10;
    x.fillStyle = '#f3efe6'; x.beginPath(); q.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); x.restore();
    x.fillStyle = '#222';
    for (let i = 0; i < 14; i++) {                                              /* text lines that follow the sheet's left and right edges */
      const t = 0.12 + i * 0.058, ax = q[0][0] + (q[3][0] - q[0][0]) * t + 50, ay = q[0][1] + (q[3][1] - q[0][1]) * t, bx = q[1][0] + (q[2][0] - q[1][0]) * t - 60, by = q[1][1] + (q[2][1] - q[1][1]) * t;
      x.save(); x.translate(ax, ay); x.rotate(Math.atan2(by - ay, bx - ax)); x.font = '20px "Liberation Serif", serif'; x.fillText('Invoice line ' + (i + 1) + ' total 1,250.00 paid in full', 0, 0); x.restore();
    }
    return { png: c.toDataURL('image/png').split(',')[1], corners: q, W, H };
  });
}

cases['finds the page, takes a corner drag, straightens and exports a PDF'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/scan/index.html', 'phone');
  const fx = await fixture(page);
  await page.setInputFiles('#fileAny', { name: 'desk.png', mimeType: 'image/png', buffer: Buffer.from(fx.png, 'base64') });
  await page.waitForFunction(() => window.__scanDetected, null, { timeout: 20000 });
  const det = await page.evaluate(() => window.__scanDetected);
  h.assert(det.found, 'The page outline was not found');
  const diag = Math.hypot(fx.W, fx.H);
  det.corners.forEach((c, i) => {
    const d = Math.hypot(c.x - fx.corners[i][0], c.y - fx.corners[i][1]) / diag;
    h.assert(d < 0.03, 'Corner ' + i + ' is ' + (d * 100).toFixed(1) + ' % of the diagonal from the truth');
  });
  /* drag the first corner 30 CSS px to the right: the handle must follow the pointer */
  const box = await page.locator('#editor').boundingBox(), k = box.width / fx.W;
  const sx = box.x + det.corners[0].x * k, sy = box.y + det.corners[0].y * k;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 30, sy + 4, { steps: 4 });
  h.assert.equal(await page.evaluate(() => !document.getElementById('loupe').classList.contains('hidden')), true, 'Magnifier not shown while dragging');
  await page.mouse.up();
  const moved = await page.evaluate(() => window.__scanCurrent().corners[0]);
  h.assert(Math.abs(moved.x - (det.corners[0].x + 30 / k)) < 12, 'Corner did not follow the drag: ' + JSON.stringify(moved));
  await page.click('#btnAuto');                                                 /* back to the detected corners */
  await page.click('#btnStraighten');
  await page.waitForFunction(() => window.__scanWarp, null, { timeout: 20000 });
  const w = await page.evaluate(() => window.__scanWarp);
  h.assert(/\d+x\d+/.test(w.size), 'No straightened size');
  await page.click('#modes button[data-mode="bw"]');
  const bw = await page.evaluate(() => {
    const c = document.getElementById('preview'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let black = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (v < 30) black++; else if (v > 225) white++; }
    const n = d.length / 4; return { black: black / n, white: white / n };
  });
  h.assert(bw.white > 0.8, 'Black and white page should be mostly paper white: ' + JSON.stringify(bw));
  h.assert(bw.black > 0.003 && bw.black < 0.2, 'Black and white page should have some ink: ' + JSON.stringify(bw));
  await page.click('#btnAdd');
  h.assert.equal(await page.evaluate(() => window.__scanPages), 1);
  await page.click('#btnPdf');
  await page.waitForFunction(() => window.__scanPdf || window.__scanError, null, { timeout: 30000 });
  h.assert(!(await page.evaluate(() => window.__scanError)), 'PDF failed: ' + (await page.evaluate(() => window.__scanError)));
  const pdf = await page.evaluate(async () => { const d = await PDFLib.PDFDocument.load(window.__scanPdfBytes); return Object.assign({ pages: d.getPageCount() }, window.__scanPdf); });
  h.assert.equal(pdf.pages, 1); h.assert.equal(pdf.head, '%PDF-'); h.assert(pdf.bytes > 800 && pdf.bytes < 400000, 'Unexpected PDF size ' + pdf.bytes);
  h.assert.noErrors(page);
};

cases['no camera: friendly message, photo picking still works'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/scan/index.html', 'phone');
  h.assert.equal(await page.evaluate(() => (window.LE_SUPPORT_DEFS || []).some((d) => d.id === 'scan.camera' && d.needs.includes('camera'))), true, 'Support declaration missing');
  await page.click('#btnCam');
  await page.waitForFunction(() => document.getElementById('err').textContent.length > 0 || !document.getElementById('vCamera').classList.contains('hidden'), null, { timeout: 15000 });
  const cameraShown = await page.evaluate(() => !document.getElementById('vCamera').classList.contains('hidden'));
  if (!cameraShown) h.assert(/camera/i.test(await page.textContent('#err')), 'Error text should mention the camera');
  const fx = await fixture(page);
  await page.setInputFiles('#fileAny', { name: 'desk.png', mimeType: 'image/png', buffer: Buffer.from(fx.png, 'base64') });
  await page.waitForFunction(() => window.__scanDetected, null, { timeout: 20000 });
  h.assert.equal(await page.evaluate(() => !document.getElementById('vEdit').classList.contains('hidden')), true);
  h.assert.noErrors(page);
};

module.exports = cases;
