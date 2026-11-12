'use strict';
/* Layer shadows scale with the export scale and the preview zoom (canvas shadowBlur and shadowOffset are in pixels
   and ignore the transform, so they used to be the wrong size at anything but 1x). */
const cases = {};

const DOC = {
  v: 1, width: 400, height: 300, background: { type: 'color', color: '#ffffff' },
  layers: [{ id: 'sq', type: 'shape', shape: 'rectangle', x: 100, y: 80, w: 120, h: 90, fill: { type: 'solid', color: '#000000' },
    shadow: { color: 'rgba(255,0,0,1)', blur: 12, x: 40, y: 30 } }]
};

/* Renders DOC at each scale, brings the result back to 1x, and compares it with the 1x render. */
cases['a shadow is the same size relative to the page at 0.5x, 1x and 2x export'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.hiddenRender);
  const r = await page.evaluate(async (doc) => {
    const c = window.LEStudio;
    const at1 = (cv) => { const o = document.createElement('canvas'); o.width = doc.width; o.height = doc.height; const x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, doc.width, doc.height); return x.getImageData(0, 0, doc.width, doc.height).data; };
    const ref = at1(await c.hiddenRender(doc, 1));
    const out = {};
    /* Where the offset shadow alone shows: right of and below the square, inside the shifted box. */
    const red = (d, x, y) => { const i = (y * doc.width + x) * 4; return d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90; };
    out.ref = { inShadow: red(ref, 235, 185), beyond: red(ref, 280, 230) };
    for (const s of [0.5, 2]) {
      const cv = await c.hiddenRender(doc, s);
      const d = at1(cv);
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { sum += Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2]); n++; }
      out[s] = { size: cv.width + 'x' + cv.height, meanDiff: sum / n / 3, inShadow: red(d, 235, 185), beyond: red(d, 280, 230) };
    }
    return out;
  }, DOC);
  h.assert(r.ref.inShadow && !r.ref.beyond, '1x: shadow where the document puts it ' + JSON.stringify(r.ref));
  for (const s of ['0.5', '2']) {
    h.assert.equal(r[s].size, s === '2' ? '800x600' : '200x150', s + 'x size');
    h.assert(r[s].inShadow && !r[s].beyond, s + 'x: shadow offset scales with the page ' + JSON.stringify(r[s]));
    h.assert(r[s].meanDiff < 2.5, s + 'x matches 1x after resampling (mean channel difference ' + r[s].meanDiff.toFixed(2) + ')');
  }
  h.assert.noErrors(page);
};

cases['the preview shadow follows the zoom'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  const r = await page.evaluate(async (doc) => {
    const c = window.LEStudio;
    c.newDesign(doc.width, doc.height, 'Shadow');
    c.scene.load ? c.scene.load(doc) : c.replaceDoc(doc, false);
    const probe = async (zoom) => {
      c.scene.setZoom ? c.scene.setZoom(zoom) : (c.scene._zoom = zoom);
      c.scene._draw();
      const cv = c.scene._canvas, x = cv.getContext('2d');
      const z = c.scene._zoom, dpr = c.scene._dpr, px = c.scene._panX, py = c.scene._panY;
      const at = (dx, dy) => { const d = x.getImageData(Math.round((dx * z + px) * dpr), Math.round((dy * z + py) * dpr), 1, 1).data; return d[0] > 200 && d[1] < 90 && d[2] < 90; };
      return { z, inShadow: at(235, 185), beyond: at(280, 230) };
    };
    return [await probe(0.5), await probe(1), await probe(2)];
  }, DOC);
  r.forEach((p) => h.assert(p.inShadow && !p.beyond, 'zoom ' + p.z + ': shadow where the document puts it ' + JSON.stringify(p)));
  h.assert.noErrors(page);
};

module.exports = cases;
