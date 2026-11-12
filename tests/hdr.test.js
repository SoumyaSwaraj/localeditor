'use strict';
/* HDR lab (labs/hdr): brackets synthesised from a known high-dynamic-range scene, measured thresholds, no console errors. */
const cases = {};

const PREP = `
  window.__scene = function (w, h, stops) { // radiance map ~stops wide, lumpy illumination
    var sc = LEDngSynth.scene(w, h, 'natural', { sigma: 0.8 }), d = sc.data, out = new Float32Array(d.length), tab = new Float32Array(1024), rr = LEDngSynth.mulberry32(77), i;
    for (i = 0; i < 1024; i++) tab[i] = rr();
    var vn = function (x, y) { var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), g = function (a, b) { return tab[((b & 31) << 5) | (a & 31)]; }; return (g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx) * (1 - sy) + (g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx) * sy; };
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var n = 0.65 * vn(x / 90, y / 90) + 0.35 * vn(x / 35 + 7, y / 35 + 3), il = Math.pow(2, -stops * 0.55 + stops * n * 1.1), o = (y * w + x) * 3; for (var c = 0; c < 3; c++) out[o + c] = d[o + c] * il; }
    return out;
  };
  window.__median = function (T, i0) { var a = []; for (var i = 1; i < T.length; i += 3) a.push(T[i]); a.sort(function (x, y) { return x - y; }); return a[a.length >> 1]; };
  window.__expose = function (T, w, h, ev, k0, seed) { var H = LEHdr, rnd = LEDngSynth.mulberry32(seed), out = new Uint8ClampedArray(w * h * 4), g = k0 * Math.pow(2, ev); for (var i = 0; i < w * h; i++) { for (var c = 0; c < 3; c++) { var v = Math.min(1, T[i * 3 + c] * g); out[i * 4 + c] = Math.round(Math.max(0, Math.min(255, H.enc(v) * 255 + 0.8 * LEDngSynth.gauss(rnd) * (0.4 + 0.6 * Math.sqrt(v)))))} out[i * 4 + 3] = 255; } return { width: w, height: h, data: out, ev: ev }; };
  window.__shifted = function (T, w, h, dx, dy, deg) { var th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), cx = (w - 1) / 2, cy = (h - 1) / 2, out = new Float32Array(T.length); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var px = c * (x - cx) - s * (y - cy) + cx + dx, py = s * (x - cx) + c * (y - cy) + cy + dy; px = Math.max(0, Math.min(w - 1, px)); py = Math.max(0, Math.min(h - 1, py)); var x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = px - x0, fy = py - y0; for (var k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = (T[(y0 * w + x0) * 3 + k] * (1 - fx) + T[(y0 * w + x1) * 3 + k] * fx) * (1 - fy) + (T[(y1 * w + x0) * 3 + k] * (1 - fx) + T[(y1 * w + x1) * 3 + k] * fx) * fy; } return out; };
`;

async function lab(h, browser, base) {
  const page = await h.open(browser, base, '/labs/hdr/index.html', 'desktop');
  await page.waitForFunction(() => window.LEHdr && window.LE && LE.hdr && window.LEDngSynth);
  await page.evaluate(PREP);
  return page;
}

cases['radiance merge recovers a 10-stop scene from brackets, with or without exposure data'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const w = 256, hh = 192, T = __scene(w, hh, 10), k0 = 0.2 / __median(T), evs = [-4, -2, 0, 2, 4], frames = evs.map((e, i) => __expose(T, w, hh, e, k0, 10 + i));
    const err = (out, refEv, used) => { const e = []; for (let i = 0; i < w * hh; i++) { let ok = false; frames.forEach((f) => { const v = f.data[i * 4 + 1] / 255; if (v > 0.04 && v < 0.97) ok = true; }); if (!ok) continue; e.push(Math.abs(Math.log2(Math.max(1e-6, out.data[i * 3 + 1]) / Math.max(1e-6, T[i * 3 + 1] * k0 * Math.pow(2, refEv))))); } e.sort((a, b) => a - b); return { med: e[e.length >> 1], p95: e[Math.floor(e.length * 0.95)] }; };
    const three = [1, 2, 3].map((i) => frames[i]), withEv = LEHdr.merge(three, { mode: 'radiance', align: false }), noEv = LEHdr.merge(three.map((f) => ({ width: f.width, height: f.height, data: f.data })), { mode: 'radiance', align: false });
    const mid = frames[2], single = { data: new Float32Array(w * hh * 3) }; for (let i = 0; i < w * hh * 3; i++) single.data[i] = LEHdr.dec(mid.data[(i / 3 | 0) * 4 + i % 3] / 255);
    return { three: err(withEv, 0), noEv: err(noEv, 0), single: err(single, 0), est: noEv.meta.exposuresEV, source: noEv.meta.exposureSource, ref: withEv.meta.reference };
  });
  h.assert(r.three.med < 0.03 && r.three.p95 < 0.3, 'Three brackets: median ' + r.three.med.toFixed(3) + ' EV, p95 ' + r.three.p95.toFixed(2));
  h.assert(r.noEv.med < 0.04, 'Without metadata: median ' + r.noEv.med.toFixed(3) + ' EV; exposures ' + JSON.stringify(r.est));
  h.assert(/estimated/.test(r.source), 'Source of exposures should be reported: ' + r.source);
  h.assert(r.single.p95 > r.three.p95 * 2, 'The merge should clearly beat one frame in the tails: single p95 ' + r.single.p95.toFixed(2) + ' vs merge ' + r.three.p95.toFixed(2));
  h.assert.noErrors(page);
};

cases['alignment recovers shift and rotation across exposures, and says where it stops'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const w = 320, hh = 240, T = __scene(w, hh, 8), k0 = 0.2 / __median(T), ref = __expose(T, w, hh, 0, k0, 1), out = [];
    for (const [dx, dy, deg] of [[6, -4, 0], [-30, 18, 0], [0, 0, 2], [-13.7, 9.4, -1.7], [0, 0, 4.5]]) {
      const th = deg * Math.PI / 180, mv = __expose(__shifted(T, w, hh, dx, dy, deg), w, hh, 2, k0, 7), t = LEHdr.alignFrames([ref, mv], 0, { maxSide: 512, maxRotation: 3 })[1], c = Math.cos(t.theta), s = Math.sin(t.theta), cx = (w - 1) / 2, cy = (hh - 1) / 2;
      let worst = 0; for (const [px, py] of [[10, 10], [w - 10, 10], [10, hh - 10], [w - 10, hh - 10]]) { const ex = c * (px - t.dx - cx) + s * (py - t.dy - cy) + cx, ey = -s * (px - t.dx - cx) + c * (py - t.dy - cy) + cy, ct = Math.cos(th), st = Math.sin(th), tx = ct * (px - dx - cx) + st * (py - dy - cy) + cx, ty = -st * (px - dx - cx) + ct * (py - dy - cy) + cy; worst = Math.max(worst, Math.hypot(ex - tx, ey - ty)); }
      out.push({ dx, dy, deg, worst });
    }
    return out;
  });
  for (const c of r.slice(0, 4)) h.assert(c.worst <= 2, 'Shift ' + c.dx + ',' + c.dy + ' rotation ' + c.deg + ': corner error ' + c.worst.toFixed(2) + ' px');
  h.assert(r[4].worst > 2, 'A 4.5 degree rotation is outside the 3 degree search and should not be claimed as aligned');
  h.assert.noErrors(page);
};

cases['deghosting removes a moving subject in both modes'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const w = 256, hh = 192, T = __scene(w, hh, 10), k0 = 0.2 / __median(T), evs = [-2, 0, 2], pos = [[70, 130], [120, 130], [170, 130]], rad = 14, res = {};
    const withObj = (cx, cy) => { const o = new Float32Array(T); for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) < rad) { const i = (y * w + x) * 3; o[i] = 0.9; o[i + 1] = 0.2; o[i + 2] = 0.1; } return o; };
    const dirty = evs.map((e, i) => __expose(withObj(pos[i][0], pos[i][1]), w, hh, e, k0, 30 + i)), clean = evs.map((e, i) => __expose(T, w, hh, e, k0, 30 + i));
    const region = []; for (const i of [0, 2]) for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - pos[i][0], y - pos[i][1]) < rad && Math.hypot(x - pos[1][0], y - pos[1][1]) >= rad + 2) region.push(y * w + x);
    for (const mode of ['radiance', 'fusion']) {
      const refOut = LEHdr.merge(clean, { mode, align: false });
      for (const dg of [false, true]) { const o = LEHdr.merge(dirty, { mode, align: false, deghost: dg }); let s = 0; region.forEach((i) => { s += mode === 'radiance' ? Math.abs(Math.log2(Math.max(1e-6, o.data[i * 3 + 1]) / Math.max(1e-6, refOut.data[i * 3 + 1]))) : Math.abs(LEHdr.enc(o.data[i * 3 + 1]) - LEHdr.enc(refOut.data[i * 3 + 1])); }); res[mode + (dg ? 'On' : 'Off')] = s / region.length; }
    }
    return res;
  });
  h.assert(r.radianceOff > 0.3 && r.radianceOn < r.radianceOff / 3, 'Radiance ghost error: off ' + r.radianceOff.toFixed(3) + ' EV, on ' + r.radianceOn.toFixed(3));
  h.assert(r.fusionOn < r.fusionOff * 0.8 && r.fusionOn < 0.04, 'Fusion ghost error: off ' + r.fusionOff.toFixed(3) + ', on ' + r.fusionOn.toFixed(3));
  h.assert.noErrors(page);
};

cases['exposure fusion keeps highlights and shadows; local tone mapping has fewer halos than a blurred base'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(async () => {
    const w = 256, hh = 192, T = __scene(w, hh, 10), k0 = 0.2 / __median(T), frames = [-2, 0, 2].map((e, i) => __expose(T, w, hh, e, k0, 5 + i));
    const f = LEHdr.merge(frames, { mode: 'fusion', align: false }); let clip = 0, blk = 0, c1 = 0, b1 = 0;
    for (let i = 0; i < w * hh; i++) { const v = LEHdr.enc(f.data[i * 3 + 1]); if (v > 0.985) clip++; if (v < 0.02) blk++; const m = frames[1].data[i * 4 + 1] / 255; if (m > 0.985) c1++; if (m < 0.02) b1++; }
    // async worker path: same size, aborts cleanly
    const viaWorker = await LE.hdr.merge(frames, { mode: 'fusion', align: false });
    const ac = new AbortController(); const p = LE.hdr.merge(frames, { mode: 'radiance', signal: ac.signal }); ac.abort(); let aborted = false; try { await p; } catch (e) { aborted = e.name === 'AbortError'; }
    // halo test on a 10-stop step
    const W = 240, Hh = 120, step = new Float32Array(W * Hh * 3); for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const v = x < W / 2 ? 0.05 : 40; for (let c = 0; c < 3; c++) step[(y * W + x) * 3 + c] = v * (1 + 0.02 * Math.sin(x * 0.7 + y * 0.3)); }
    const halo = {}; for (const m of ['gaussian', 'local']) { const tm = LEHdr.toneMap({ width: W, height: Hh, data: step }, { method: m, strength: 0.9 }), row = (x) => tm.data[(60 * W + x) * 3 + 1], dark = row(40), bright = row(W - 40); let d = 0; for (let x = W / 2 - 30; x < W / 2; x++) d = Math.max(d, Math.abs(row(x) - dark) / Math.max(1e-4, dark)); for (let x = W / 2; x < W / 2 + 30; x++) d = Math.max(d, Math.abs(bright - row(x)) / Math.max(1e-4, bright)); halo[m] = d; }
    return { clip: clip / (w * hh), blk: blk / (w * hh), c1: c1 / (w * hh), workerSame: viaWorker.width === f.width && Math.abs(viaWorker.data[1000] - f.data[1000]) < 1e-6, aborted, halo, ms: f.meta.times.total };
  });
  h.assert(r.clip < 0.05 && r.clip < r.c1 / 3, 'Fusion clipped share ' + (100 * r.clip).toFixed(2) + '% vs middle frame ' + (100 * r.c1).toFixed(2) + '%');
  h.assert(r.workerSame, 'LE.hdr.merge (Worker) should match LEHdr.merge'); h.assert(r.aborted, 'Aborting a merge should reject with AbortError');
  h.assert(r.halo.local < r.halo.gaussian / 4, 'Halo: guided base ' + (100 * r.halo.local).toFixed(0) + '% vs blurred base ' + (100 * r.halo.gaussian).toFixed(0) + '%');
  h.assert.noErrors(page);
};

module.exports = cases;
