'use strict';
/* Expert step X5, effect pack "develop" (assets/js/fx/le-fx-develop.js) and RAW / HDR layers (assets/js/raw/le-raw-layer.js,
   assets/js/raw/le-raw-studio.js). Every RAW is a synthetic DNG made in the page by tools/dng-synth (known truth, no network);
   every HDR bracket set is synthesised from a known radiance map. Goldens: tests/golden/fx/develop-*.png. */
const fx = require('./lib/fx');

const cases = {};
const TYPES = ['develop.basic', 'develop.detail', 'develop.lens', 'develop.tonemap'];
const SECTIONS = ['Light', 'Colour', 'Curves', 'Colour mixer', 'Colour grading', 'Detail', 'Optics', 'Geometry', 'Effects', 'Shadows & reflections', 'Compositing', 'Retouch'];

/* In-page helpers: a DNG File from the synthesiser, the RAW module, renders of RAW layers, HDR scenes and brackets. */
const PREP = `
  window.__dng = function (o) {
    o = o || {}; var S = LEDngSynth, W = o.W || 384, H = o.H || 256, sc = S.scene(W, H, o.kind || 'natural', { sigma: o.sigma == null ? 0.8 : o.sigma }), cam = S.cameraFor();
    var mos = S.mosaic(sc, Object.assign({ bits: 14, black: 256, white: 16383, cam: cam, headroom: o.headroom || 0.9, exposure: o.exposure || 1, noise: o.noise || null, seed: o.seed || 1 }));
    var bytes = S.writeDNG({ width: W, height: H, mosaic: mos, bits: 14, black: 256, white: 16383, cam: cam, compression: 'lj92', tile: [128, 128], shutter: o.shutter, iso: o.iso });
    return { file: new File([bytes], o.name || 'synthetic.dng', { type: '' }), sc: sc, bytes: bytes };
  };
  window.__raw = function () {
    if (window.LE.rawLayer) return LE.rawLayer.ready();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = '/assets/js/raw/le-raw-layer.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }).then(function () { return LE.rawLayer.ready(); });
  };
  window.__dev = function (layer, fxList, o) { /* the develop stage of a RAW/HDR layer, as the studio draws it */
    o = o || {}; var D = LE.fx.develop, l = JSON.parse(JSON.stringify(layer)); if (fxList) l.fx = fxList; var st = D.split(l.fx);
    return LE.rawLayer.provide(l, { preview: !!o.preview, targetMax: o.targetMax || 4000, entries: st.dev }).then(function (src) {
      return LE.fx.apply(src.source, { fx: D.inject(st.dev, src.ctx), box: src.box, tile: o.tile || 0 });
    });
  };
  window.__srgb = function (v) { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
  window.__truth = function (sc, k) { var c = document.createElement('canvas'); c.width = sc.w; c.height = sc.h; var x = c.getContext('2d'), id = x.createImageData(sc.w, sc.h); for (var i = 0; i < sc.w * sc.h; i++) { for (var j = 0; j < 3; j++) id.data[i * 4 + j] = Math.round(__srgb(sc.data[i * 3 + j] * (k || 1))); id.data[i * 4 + 3] = 255; } x.putImageData(id, 0, 0); return c; };
  window.__meanAbs = function (a, b) { var A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data, s = 0, n = 0; for (var i = 0; i < A.length; i += 4) { for (var j = 0; j < 3; j++) s += Math.abs(A[i + j] - B[i + j]); n += 3; } return s / n; };
  /* a smooth radiance map about 'stops' wide (lumpy light over the natural scene), and 8-bit exposures of it */
  window.__hdrScene = function (w, h, stops) {
    var sc = LEDngSynth.scene(w, h, 'natural', { sigma: 0.8 }), d = sc.data, out = new Float32Array(d.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var il = Math.pow(2, -stops / 2 + stops * (0.5 + 0.5 * Math.sin(x / w * 5.1 + 0.7) * Math.cos(y / h * 3.3 - 0.4))), o = (y * w + x) * 3; for (var c = 0; c < 3; c++) out[o + c] = d[o + c] * il; }
    return out;
  };
  window.__expose = function (T, w, h, ev, k0, seed) { var rnd = LEDngSynth.mulberry32(seed), out = new Uint8ClampedArray(w * h * 4), g = k0 * Math.pow(2, ev); for (var i = 0; i < w * h; i++) { for (var c = 0; c < 3; c++) out[i * 4 + c] = Math.round(__srgb(T[i * 3 + c] * g) + (rnd() - 0.5) * 1.2); out[i * 4 + 3] = 255; } return out; };
  window.__png = function (data, w, h, name) { var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0); return new Promise(function (res) { c.toBlob(function (b) { res(new File([b], name, { type: 'image/png' })); }, 'image/png'); }); };
  window.__median = function (T) { var a = []; for (var i = 1; i < T.length; i += 3) a.push(T[i]); a.sort(function (x, y) { return x - y; }); return a[a.length >> 1]; };
`;

async function page(browser, base, opts) {
  const pg = await fx.page(browser, base, opts);
  await pg.addScriptTag({ url: base + '/tools/dng-synth/dng-synth.js' });
  await pg.evaluate(PREP);
  return pg;
}
const png = (url) => Buffer.from(url.split(',')[1], 'base64');

cases['registry: four develop effects, described for agents and the workspace, declared to LE.support'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate((T) => {
    const FX = window.LE.fx, d = FX.describe().filter((e) => T.indexOf(e.id) >= 0);
    return { ids: d.map((e) => e.id), d, support: T.map((id) => (window.LE.support && window.LE.support.get ? !!window.LE.support.get('fx.' + id) : (window.LE_SUPPORT_DEFS || []).some((x) => x.id === 'fx.' + id))), json: JSON.stringify(d).length, fns: JSON.stringify(d).indexOf('function') >= 0, packs: FX.list().length };
  }, TYPES);
  h.assert.equal(r.ids.join(), TYPES.join(), 'registered');
  r.d.forEach((e) => {
    h.assert(SECTIONS.indexOf(e.ui.section) >= 0, e.id + ' section ' + e.ui.section);
    h.assert(e.agent.summary.length > 80 && e.agent.tips.length >= 4 && e.agent.example.type === e.id, e.id + ' agent description');
    h.assert(/backlit portrait/i.test(e.agent.tips.join(' ')) && /night city/i.test(e.agent.tips.join(' ')) && /high-iso/i.test(e.agent.tips.join(' ')), e.id + ' typical values per situation');
    Object.keys(e.params).forEach((k) => { const p = e.params[k]; h.assert(p.label && (p.type !== 'number' || (p.step > 0 && p.default >= p.min && p.default <= p.max)), e.id + '.' + k + ' schema'); });
    (e.ui.controls || []).forEach((c) => h.assert(typeof c === 'string' ? !!e.params[c] : (c.heading || !!e.params[c.param]), e.id + ' control ' + JSON.stringify(c)));
    h.assert(Object.keys(e.params).length <= 24, e.id + ' has at most 24 parameters');
  });
  h.assert(r.support.every(Boolean), 'LE.support definitions: ' + r.support);
  h.assert(!r.fns && r.json < 40000, 'plain data, ' + r.json + ' bytes');
  h.assert.noErrors(pg);
};

cases['neutral at default: every develop effect with default values changes nothing (card and float source)'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const none = await fx.render(pg, { card: [256, 192] });
  for (const t of TYPES) {
    const one = await fx.render(pg, { card: [256, 192], fx: [{ type: t, p: {} }] });
    await fx.same(pg, none, one, t + ' at default', { max: 1, over: 0 });
  }
  const f = await pg.evaluate((T) => {
    const w = 96, hh = 64, d = new Float32Array(w * hh * 3); for (let i = 0; i < d.length; i++) d[i] = Math.pow(2, -8 + 9 * ((i / 3 | 0) % w) / w) * [1, 0.8, 0.6][i % 3];
    const src = { data: d, width: w, height: hh, channels: 3, space: 'linear' };
    const a = window.LE.fx.apply(src, { fx: [] }).toDataURL(), out = {};
    T.forEach((t) => { out[t] = window.LE.fx.apply(src, { fx: [{ type: t, p: {} }] }).toDataURL(); });
    return { a, out };
  }, TYPES);
  for (const t of TYPES) await fx.same(pg, png(f.a), png(f.out[t]), t + ' at default on float data', { max: 1, over: 0 });
  h.assert.noErrors(pg);
};

cases['develop.basic matches its CPU reference: tone curve, exposure, white balance, saturation, gamut compression'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const D = window.LE.fx.develop, w = 128, hh = 48, d = new Float32Array(w * hh * 3);
    /* rows: neutral ramp, saturated colours, out-of-gamut (negative) colours, all over 13 stops */
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const v = Math.pow(2, -10 + 13 * x / (w - 1)), band = Math.floor(y / 12), o = (y * w + x) * 3;
      const col = [[1, 1, 1], [1.0, 0.35, 0.12], [0.2, 0.9, 0.3], [1.3, -0.08, 0.45]][band];
      d[o] = v * col[0]; d[o + 1] = v * col[1]; d[o + 2] = v * col[2];
    }
    const src = { data: d, width: w, height: hh, channels: 3, space: 'linear' }, res = [];
    const sets = [
      { profile: 'standard' }, { profile: 'standard', exposure: 1.3, highlights: -60, shadows: 45 }, { profile: 'vivid', contrast: 40, whites: 30, blacks: -40, vibrance: 50 },
      { profile: 'none', wb: 'tungsten' }, { profile: 'neutral', wb: 'custom', temp: 4200, tint: 20, saturation: -40 }, { profile: 'mono', exposure: -0.7 }, { profile: 'flat', saturation: 30 }
    ];
    sets.forEach((p0) => {
      const p = Object.assign(window.LE.fx.defaults('develop.basic'), p0);
      const out = window.LE.fx.apply(src, { fx: [{ type: 'develop.basic', p }] }), px = out.getContext('2d').getImageData(0, 0, w, hh).data, plan = D.basicPlan(p);
      let max = 0, at = null;
      for (let i = 0; i < w * hh; i++) { const o = D.basicPixel([d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], plan); for (let c = 0; c < 3; c++) { const e = Math.abs(__srgb(o[c]) - px[i * 4 + c]); if (e > max) { max = e; at = [i % w, i / w | 0, c]; } } }
      res.push({ p: p0, max, at });
    });
    /* monotone and smooth: the standard curve over x, every control at its extremes */
    const mono = [];
    [{}, { highlights: -100 }, { highlights: 100 }, { shadows: 100 }, { shadows: -100 }, { whites: 100, blacks: -100 }, { contrast: 100 }, { contrast: -100 }, { exposure: 5 }].forEach((q) => {
      const T = D.toneTable(Object.assign({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }, q), 'standard').lut; let ok = true, jump = 0;
      for (let i = 1; i < T.length; i++) { if (T[i] < T[i - 1] - 1e-7) ok = false; jump = Math.max(jump, T[i] - T[i - 1]); }
      mono.push({ q, ok, jump });
    });
    /* tone values at a few stops (documented in the pack): middle grey stays at sRGB 118, +4 EV is not clipped */
    const T0 = D.toneTable({}, 'standard'), at = (ev) => Math.round(__srgb(D.toneAt(T0, 0.18 * Math.pow(2, ev))));
    return { res, mono, grey: at(0), m4: at(-4), p25: at(2.5), p4: at(4) };
  });
  r.res.forEach((x) => h.assert(x.max <= 3, 'GPU and CPU disagree for ' + JSON.stringify(x.p) + ': ' + x.max + ' at ' + x.at));
  r.mono.forEach((x) => h.assert(x.ok && x.jump < 0.02, 'tone curve monotone and smooth for ' + JSON.stringify(x.q) + ' (largest step ' + x.jump.toFixed(4) + ')'));
  h.assert(Math.abs(r.grey - 118) <= 2 && r.m4 >= 18 && r.m4 <= 32 && r.p25 >= 235 && r.p25 <= 252 && r.p4 < 255, 'standard curve: grey ' + r.grey + ', -4 EV ' + r.m4 + ', +2.5 EV ' + r.p25 + ', +4 EV ' + r.p4);
  h.assert.noErrors(pg);
};

cases['white balance: camera-matrix maths matches LE.raw.matrix, moves the right way, and the GPU applies it'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    await __raw();
    const t = __dng({ kind: 'chart', W: 480, H: 320, sigma: 0.7 });
    const res = await LE.raw.open(t.file), layer = res.layer, C = window.LERawCore, M = C.color.MAT, D = LE.fx.develop;
    const st = D.split(layer.fx), src = await LE.rawLayer.provide(layer, { preview: false, targetMax: 4000, entries: st.dev });
    const asM = LE.raw.matrix(layer.raw.color, 'as-shot', 'srgb').matrix, out = {};
    [['tungsten', 2850, 0], ['custom', 7500, 10], ['custom', 4300, -15]].forEach((q) => {
      const p = Object.assign(LE.fx.defaults('develop.basic'), { wb: q[0], temp: q[1], tint: q[2] });
      const W = src.ctx.wb(p), ref = M.mul(LE.raw.matrix(layer.raw.color, { temp: q[1], tint: q[2] }, 'srgb').matrix, M.inv(asM));
      const wv = M.vec(ref, [1, 1, 1]), y = 0.2126 * wv[0] + 0.7152 * wv[1] + 0.0722 * wv[2], refN = ref.map((v) => v / y);
      const grey = M.vec(W, [0.18, 0.18, 0.18]);
      out[q.join()] = { err: Math.max.apply(null, W.map((v, i) => Math.abs(v - refN[i]))), bMinusR: (grey[2] - grey[0]) / 0.18 };
    });
    /* as shot: the grey patches of the chart come out neutral; tungsten makes them blue; GPU = CPU on the chart's grey surround */
    const asShot = await __dev(layer, [{ type: 'develop.basic', p: { profile: 'none' } }]), tung = await __dev(layer, [{ type: 'develop.basic', p: { profile: 'none', wb: 'tungsten' } }]);
    const at = (cv) => { const p = cv.getContext('2d').getImageData(3, 3, 1, 1).data; return [p[0], p[1], p[2]]; };
    const p2 = Object.assign(LE.fx.defaults('develop.basic'), { profile: 'none', wb: 'tungsten' }), dev = D.inject([{ type: 'develop.basic', p: p2 }], src.ctx)[0];
    const cpu = D.basicPixel([src.source.data[3 * (3 * src.source.width + 3)], src.source.data[3 * (3 * src.source.width + 3) + 1], src.source.data[3 * (3 * src.source.width + 3) + 2]], D.basicPlan(dev.p)).map((v) => Math.round(__srgb(v)));
    return { out, neutral: at(asShot), tung: at(tung), cpu, asShot: layer.raw.asShot, auto: layer.raw.auto };
  });
  Object.keys(r.out).forEach((k) => h.assert(r.out[k].err < 1e-6, 'WB matrix for ' + k + ' differs from LE.raw.matrix by ' + r.out[k].err));
  h.assert(r.out['tungsten,2850,0'].bMinusR > 0.5 && r.out['custom,4300,-15'].bMinusR > 0.1 && r.out['custom,7500,10'].bMinusR < -0.05, 'lower kelvin cools, higher warms: ' + JSON.stringify(r.out));
  h.assert(Math.max(...r.neutral) - Math.min(...r.neutral) <= 3, 'as shot, the chart background is neutral: ' + r.neutral);
  h.assert(r.tung[2] > r.tung[0] + 25, 'tungsten makes daylight blue: ' + r.tung);
  h.assert(r.cpu.every((v, i) => Math.abs(v - r.tung[i]) <= 3), 'GPU ' + r.tung + ' vs CPU ' + r.cpu);
  h.assert(Math.abs(r.asShot.temp - 6504) < 80, 'as-shot temperature of the D65 chart: ' + r.asShot.temp);
  h.assert.noErrors(pg);
};

cases['decode -> develop: synthetic DNG, default rendering close to the scene, golden, preview = tiled export'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    await __raw();
    const t = __dng({}), res = await LE.raw.open(t.file);
    const def = await __dev(res.layer, null), tiled = await __dev(res.layer, null, { tile: 128 });
    const look = await __dev(res.layer, [{ type: 'develop.basic', p: { profile: 'landscape', highlights: -50, shadows: 30, vibrance: 20 } }, { type: 'develop.detail', p: { sharpen: 60, luminance: 30, color: 40, masking: 20 } }, { type: 'develop.lens', p: { vignette: 40, distortion: 20, defringePurple: 8 } }]);
    const lookTiled = await __dev(res.layer, [{ type: 'develop.basic', p: { profile: 'landscape', highlights: -50, shadows: 30, vibrance: 20 } }, { type: 'develop.detail', p: { sharpen: 60, luminance: 30, color: 40, masking: 20 } }, { type: 'develop.lens', p: { vignette: 40, distortion: 20, defringePurple: 8 } }], { tile: 128 });
    return { def: def.toDataURL('image/png'), tiled: tiled.toDataURL('image/png'), look: look.toDataURL('image/png'), lookTiled: lookTiled.toDataURL('image/png'), src: res.assets.src.canvas.toDataURL('image/png'), close: __meanAbs(def, __truth(t.sc, 0.9 * 2 ** 0)), w: def.width, layer: res.layer, info: res.info };
  });
  h.assert(r.close < 9, 'default development vs the scene encoded as sRGB (mean abs, 0-255): ' + r.close.toFixed(2));
  h.assert(r.layer.raw.kind === 'raw' && /^[a-f0-9]{64}$/.test(r.layer.raw.source.asset) && r.layer.raw.size.w === 384 && r.layer.fx[0].type === 'develop.basic', 'layer.raw: ' + JSON.stringify(r.layer.raw.source));
  h.assert(r.layer.fx[0].p.temp === Math.round(r.info.asShot.temp), 'the opener writes the as-shot white into develop.basic');
  await fx.golden(pg, 'develop-dng-default', png(r.def));
  await fx.golden(pg, 'develop-dng-look', png(r.look));
  await fx.same(pg, png(r.def), png(r.tiled), 'default development: whole vs 128-pixel tiles');
  await fx.same(pg, png(r.look), png(r.lookTiled), 'detail + lens + basic: whole vs tiles', { max: 2, over: 0.0005 });
  await fx.same(pg, png(r.def), png(r.src), 'the layer\'s 8-bit picture is the default development');
  h.assert.noErrors(pg);
};

cases['highlight recovery: reconstructing clipped channels beats clipping and leaving them, on known truth'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    await __raw();
    const t = __dng({ exposure: 2.2, name: 'bright.dng' }), res = await LE.raw.open(t.file), layer = res.layer, out = {};
    for (const rec of ['reconstruct', 'clip', 'off']) {
      const w = await LE.raw.work.get(layer, { recovery: rec, cap: 0 });
      /* luminance error in stops, and chroma error, where the truth is above sensor white */
      const T = t.sc.data, n = w.width * w.height, k = 0.9 * 2.2; let el = 0, ec = 0, cnt = 0;
      const toXY = (r, g, b) => { const X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = 0.0193 * r + 0.1192 * g + 0.9505 * b, s = X + Y + Z; return [X / s, Y / s, Y]; };
      for (let i = 0; i < n; i++) {
        const tr = T[i * 3] * k, tg = T[i * 3 + 1] * k, tb = T[i * 3 + 2] * k; if (Math.max(tr, tg, tb) < 1.15) continue;
        const a = toXY(tr, tg, tb), b = toXY(Math.max(1e-6, w.data[i * 3]), Math.max(1e-6, w.data[i * 3 + 1]), Math.max(1e-6, w.data[i * 3 + 2]));
        el += Math.abs(Math.log2(Math.max(b[2], 1e-6) / a[2])); ec += Math.hypot(a[0] - b[0], a[1] - b[1]); cnt++;
      }
      out[rec] = { lum: el / cnt, chroma: ec / cnt, n: cnt };
    }
    return { out, clipped: res.info.clipped };
  });
  const o = r.out;
  h.assert(o.reconstruct.n > 500 && r.clipped > 0.01, 'the test scene clips: ' + JSON.stringify(o.reconstruct) + ' ' + r.clipped);
  h.assert(o.reconstruct.lum < o.clip.lum * 0.8 && o.reconstruct.lum < o.off.lum, 'luminance error (EV): reconstruct ' + o.reconstruct.lum.toFixed(3) + ', clip ' + o.clip.lum.toFixed(3) + ', off ' + o.off.lum.toFixed(3));
  /* Honest bound: colour in the clipped areas is a known gap (see the X5 report); reconstruction must not be much worse than either baseline. */
  h.assert(o.reconstruct.chroma < Math.max(o.off.chroma, o.clip.chroma) * 1.35, 'chroma error: reconstruct ' + o.reconstruct.chroma.toFixed(4) + ', off ' + o.off.chroma.toFixed(4) + ', clip ' + o.clip.chroma.toFixed(4));
  h.assert.noErrors(pg);
};

cases['HDR merge: synthetic brackets against known radiance, through the 16-bit log asset; deghost with a moving block'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    await __raw();
    const w = 256, hh = 192, T = __hdrScene(w, hh, 10), k0 = 0.18 / __median(T), evs = [-2, 0, 2];
    const frames = evs.map((e, i) => __expose(T, w, hh, e, k0, 30 + i)), files = [];
    for (let i = 0; i < 3; i++) files.push(await __png(frames[i], w, hh, 'b' + i + '.png'));
    const progress = []; const res = await LE.hdr.mergeFiles(files, { align: false, deghost: 'off', onProgress: (p) => progress.push(p) });
    const back = await LE.hdr.decode(res.assets.hdr.blob);
    const errs = []; for (let i = 0; i < w * hh; i++) { let ok = false; frames.forEach((f) => { const v = f[i * 4 + 1] / 255; if (v > 0.04 && v < 0.97) ok = true; }); if (!ok) continue; const t = T[i * 3 + 1] * k0, m = back.data[i * 3 + 1]; if (t > 1e-4) errs.push(Math.abs(Math.log2(Math.max(m, 1e-9) / t))); }
    errs.sort((a, b) => a - b);
    /* the container is exact to 0.001 EV */
    const enc = await LE.hdr.encode({ width: 4, height: 1, data: new Float32Array([1e-4, 0.18, 1, 37.5, 2, 3, 0, 0.5, 1, 1, 1, 1]) }, {}), dec = await LE.hdr.decode(enc);
    const rt = Array.from(dec.data).map((v, i) => [1e-4, 0.18, 1, 37.5, 2, 3, 0, 0.5, 1, 1, 1, 1][i] ? Math.abs(Math.log2(v / [1e-4, 0.18, 1, 37.5, 2, 3, 0, 0.5, 1, 1, 1, 1][i])) : v);
    /* deghost: a bright block moves between frames */
    const mv = evs.map((e, i) => { const f = __expose(T, w, hh, e, k0, 50 + i); const x0 = 40 + i * 60; for (let y = 120; y < 160; y++) for (let x = x0; x < x0 + 40; x++) { const o = (y * w + x) * 4; f[o] = 230; f[o + 1] = 40; f[o + 2] = 40; } return f; });
    const mf = []; for (let i = 0; i < 3; i++) mf.push(await __png(mv[i], w, hh, 'm' + i + '.png'));
    const ghostErr = async (level) => {
      const g = await LE.hdr.mergeFiles(mf, { align: false, deghost: level, reference: 1 }), d = await LE.hdr.decode(g.assets.hdr.blob), e = [];
      for (let y = 124; y < 156; y++) for (const x0 of [44, 164]) for (let x = x0; x < x0 + 32; x++) { const i = y * w + x, t = T[i * 3 + 1] * k0; e.push(Math.abs(Math.log2(Math.max(d.data[i * 3 + 1], 1e-9) / t))); }
      return e.reduce((a, b) => a + b, 0) / e.length;
    };
    return { med: errs[errs.length >> 1], p95: errs[Math.floor(errs.length * 0.95)], n: errs.length, meta: res.info.meta, layer: res.layer, progress: progress.length, last: progress[progress.length - 1], bytes: res.assets.hdr.blob.size, rt, ghostOff: await ghostErr('off'), ghostHigh: await ghostErr('high') };
  });
  h.assert(r.n > 20000 && r.med < 0.05 && r.p95 < 0.35, 'radiance error: median ' + r.med.toFixed(3) + ' EV, p95 ' + r.p95.toFixed(3) + ' over ' + r.n + ' px');
  h.assert(/estimated/.test(r.meta.exposureSource) && Math.abs(r.meta.exposuresEV[0] + 2) < 0.1 && Math.abs(r.meta.exposuresEV[2] - 2) < 0.1, 'exposures estimated without metadata: ' + JSON.stringify(r.meta.exposuresEV));
  h.assert(r.rt.every((e) => e < 0.001), 'log16 container round trip: ' + r.rt);
  h.assert(r.layer.raw.kind === 'hdr' && r.layer.raw.source.encoding === 'le-log16' && r.layer.fx.some((e) => e.type === 'develop.tonemap'), 'HDR layer: ' + JSON.stringify(r.layer.raw.source));
  h.assert(r.progress >= 3 && r.last === 1, 'progress reported: ' + r.progress);
  h.assert(r.ghostHigh < r.ghostOff / 4, 'deghost: error where the block was in other frames ' + r.ghostOff.toFixed(3) + ' EV without, ' + r.ghostHigh.toFixed(3) + ' with');
  h.assert.noErrors(pg);
};

cases['HDR merge from RAW brackets uses exposure metadata and stays in camera space; cancel works'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    await __raw();
    const shutter = [[1, 500], [1, 125], [1, 30]], expo = [0.25, 1, 4.2667];
    const files = shutter.map((s, i) => __dng({ W: 256, H: 192, shutter: s, exposure: expo[i] * 0.8, name: 'r' + i + '.dng', noise: { gain: 0.6, read: 2 }, seed: 3 + i }).file);
    const res = await LE.hdr.mergeFiles(files, { align: false, deghost: 'off' });
    const c = new AbortController(), p = LE.hdr.mergeFiles(files, { signal: c.signal }); setTimeout(() => c.abort(), 30);
    let cancelled = false; try { await p; } catch (e) { cancelled = e.name === 'AbortError'; }
    const img = await __dev(res.layer, null);
    return { meta: res.info.meta, space: res.info.space, color: !!res.layer.raw.color, cancelled, img: img.toDataURL('image/png') };
  });
  h.assert(r.meta.exposureSource === 'metadata' && Math.abs(r.meta.exposuresEV[0] + 2) < 0.01 && Math.abs(r.meta.exposuresEV[2] - 2.059) < 0.02, 'exposures from metadata: ' + JSON.stringify(r.meta.exposuresEV));
  h.assert(r.space === 'camera' && r.color, 'merged in camera space with the reference frame\'s colour data');
  h.assert(r.cancelled, 'an aborted merge rejects with AbortError');
  await fx.golden(pg, 'develop-hdr-raw-default', png(r.img), { max: 4, over: 0.003 });
  h.assert.noErrors(pg);
};

cases['tone mapping: goldens for local, fusion and global; halos stay small; tiles match'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    const w = 320, hh = 208, T = __hdrScene(w, hh, 12), k0 = 0.18 / __median(T), d = new Float32Array(T.length);
    for (let i = 0; i < d.length; i++) d[i] = T[i] * k0;
    /* a 10-stop step edge for the halo measure */
    const E = new Float32Array(w * hh * 3); for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) E[(y * w + x) * 3 + c] = x < w / 2 ? 0.02 : 20;
    const src = { data: d, width: w, height: hh, channels: 3, space: 'linear' }, edge = { data: E, width: w, height: hh, channels: 3, space: 'linear' }, out = {};
    const basic = { type: 'develop.basic', p: { profile: 'standard' } };
    for (const m of ['local', 'fusion', 'global']) {
      const fxl = [{ type: 'develop.tonemap', p: { method: m, strength: 60, detail: 20, highlights: -20, shadows: 20, halo: 60 } }, basic];
      out[m] = LE.fx.apply(src, { fx: fxl }).toDataURL('image/png');
      out[m + 'Tiled'] = LE.fx.apply(src, { fx: fxl, tile: 128 }).toDataURL('image/png');
    }
    out.none = LE.fx.apply(src, { fx: [basic] }).toDataURL('image/png');
    const halo = (fxl) => { const c = LE.fx.apply(edge, { fx: fxl }), p = c.getContext('2d').getImageData(0, hh / 2, w, 1).data, row = []; for (let x = 0; x < w; x++) row.push(p[x * 4 + 1]); const farD = row[10], farB = row[w - 10]; let dev = 0; for (let x = w / 2 - 30; x < w / 2 + 30; x++) if (x !== w / 2 && x !== w / 2 - 1) dev = Math.max(dev, x < w / 2 ? Math.abs(row[x] - farD) : Math.abs(row[x] - farB)); return { dev, farD, farB }; };
    out.halo = halo([{ type: 'develop.tonemap', p: { method: 'local', strength: 70, halo: 80 } }, basic]);
    out.haloLow = halo([{ type: 'develop.tonemap', p: { method: 'local', strength: 70, halo: 0 } }, basic]);
    return out;
  });
  for (const m of ['local', 'fusion', 'global']) {
    await fx.golden(pg, 'develop-tonemap-' + m, png(r[m]));
    await fx.same(pg, png(r[m]), png(r[m + 'Tiled']), 'tone map ' + m + ': whole vs tiles', { max: 2, over: 0.001 });
  }
  const dn = await fx.diff(pg, png(r.none), png(r.local));
  h.assert(dn.mean > 4, 'local tone mapping changes the picture: ' + dn.mean);
  h.assert(r.halo.dev <= 26 && r.halo.farB > r.halo.farD + 60, 'halo at a 10-stop edge with halo control 80: ' + JSON.stringify(r.halo));
  h.assert.noErrors(pg);
};

cases['masks, adjustment layers and LE.fx.ops work with develop effects'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const plain = await fx.render(pg, { card: [256, 192] });
  const masked = await fx.render(pg, { card: [256, 192], fx: [{ type: 'develop.basic', p: { exposure: 1.5 }, mask: { parts: [{ kind: 'linear', x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.5, feather: 0 }] } }] });
  const r = await pg.evaluate(async ([a, b]) => {
    const A = await fxT.load(a), B = await fxT.load(b), pa = fxT.pixels(fxT.fit(A)).data, pb = fxT.pixels(fxT.fit(B)).data, w = A.naturalWidth;
    const px = (p, x, y) => p[(y * w + x) * 4 + 1];
    const O = LE.fx.ops, doc = { v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }] };
    let s = O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'develop.basic', p: { exposure: 9, profile: 'vivid' } } }); const id = s.id, clamped = s.doc.layers[0].fx[0].p.exposure;
    s = O.apply(s.doc, { op: 'fx.add', layer: 'a', entry: { type: 'develop.detail', p: { sharpen: 40 } } });
    s = O.apply(s.doc, { op: 'fx.update', layer: 'a', id, p: { shadows: 30 } }); const upd = s.doc.layers[0].fx[0].p;
    s = O.apply(s.doc, { op: 'fx.reorder', layer: 'a', id, index: 1 }); const order = s.doc.layers[0].fx.map((e) => e.type);
    s = O.apply(s.doc, { op: 'adjust.add', fx: [{ type: 'develop.tonemap', p: { strength: 40 } }] }); const adj = s.doc.layers[s.doc.layers.length - 1];
    s = O.apply(s.doc, { op: 'fx.remove', layer: 'a', id }); const left = s.doc.layers[0].fx.map((e) => e.type);
    const bad = O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'develop.nope' } });
    return { left: px(pb, 30, 100) - px(pa, 30, 100), right: px(pb, 220, 100) - px(pa, 220, 100), clamped, upd, order, adj: { type: adj.type, fx: adj.fx[0].type }, left2: left, bad: bad.ok };
  }, ['data:image/png;base64,' + plain.toString('base64'), 'data:image/png;base64,' + masked.toString('base64')]);
  h.assert(r.left > 20 && Math.abs(r.right) <= 1, 'entry mask: brighter left (' + r.left + '), unchanged right (' + r.right + ')');
  h.assert(r.clamped === 5 && r.upd.shadows === 30 && r.upd.exposure === 5 && r.order.join() === 'develop.detail,develop.basic' && r.adj.type === 'adjust' && r.adj.fx === 'develop.tonemap' && r.left2.join() === 'develop.detail' && r.bad === false, 'ops round trip: ' + JSON.stringify(r));
  /* an adjustment layer with develop.basic in the studio */
  const st = await h.studioWithSample(browser, base, 'desktop');
  await fx.attach(st);
  const before = await fx.shot(st, 0.25);
  await st.evaluate(() => { const s = window.LEStudio.scene; s.add({ type: 'adjust', name: 'Develop', fx: [{ type: 'develop.basic', p: { exposure: 1 } }] }); });
  await st.waitForTimeout(1500);
  await st.evaluate(() => window.LEStudio.scene.render(0.25));
  const after = await fx.shot(st, 0.25);
  const d = await fx.diff(st, before, after);
  h.assert(d.mean > 8, 'an adjustment layer with develop.basic changes the page: mean ' + d.mean);
  h.assert.noErrors(pg); h.assert.noErrors(st);
};

cases['studio: RAW opens as a photo layer, nothing is fetched before, save/load and .leproject round trip keep layer.raw and its assets'] = async ({ browser, base, h }) => {
  const pg = await h.open(browser, base, '/studio/', 'desktop');
  await pg.waitForFunction(() => window.LEStudio && window.LE.rawStudio);
  const early = await pg.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /\/raw\/|raw-decoder|\.wasm|hdr|\/fx\//.test(u)));
  h.assert(early.length === 1 && /le-raw-studio\.js$/.test(early[0]), 'only the small studio hook loads up front: ' + early.join(', '));
  h.assert(await pg.evaluate(() => document.getElementById('sx-file').accept.indexOf('.nef') >= 0 && document.getElementById('sx-file').accept.indexOf('.dng') >= 0), 'the photo chooser accepts RAW files');
  await pg.addScriptTag({ url: base + '/tools/dng-synth/dng-synth.js' });
  await pg.evaluate(PREP);
  await fx.attach(pg);
  const r = await pg.evaluate(async () => {
    const c = window.LEStudio, t = __dng({ W: 480, H: 320 });
    const ids = await LE.rawStudio.open([t.file]);
    const l = c.L(ids[0]); await new Promise((res) => setTimeout(res, 2500));
    const shot1 = (await c.scene.render(0.5)).toDataURL('image/png');
    await c.saveNow();
    const pid = c.S.project.id, rawId = l.raw.source.asset;
    const blob = await LE.project.exportFile(c.S.project);
    const imported = await LE.project.importFile(new File([blob], 'x.leproject'), { replace: true });
    const il = imported.pages[0].layers.find((x) => x.raw);
    const stored = await LE.project.getAsset(rawId), back = await LE.raw.unwrap(stored);
    const same = back.bytes.byteLength === t.bytes.length && new Uint8Array(back.bytes).every((v, i) => v === t.bytes[i]);
    /* reopen in a fresh studio state: the layer draws from its float source again (the working copy is rebuilt or restored) */
    LE.rawLayer.mem.bytes = {};
    await c.openProject(imported.id);
    await new Promise((res) => setTimeout(res, 3500));
    const shot2 = (await c.scene.render(0.5)).toDataURL('image/png');
    const dl = c.scene.layers().find((x) => x.raw);
    /* and it is still developed from the RAW: a develop change after reopening re-renders from the decoded data */
    const fx2 = JSON.parse(JSON.stringify(dl.fx)); fx2[0].p.exposure = 1; c.scene.update(dl.id, { fx: fx2 });
    await new Promise((res) => setTimeout(res, 3000));
    const shot3 = (await c.scene.render(0.5)).toDataURL('image/png');
    return { shot3, layer: { fx: l.fx.map((e) => e.type), raw: l.raw.kind, assets: Object.keys(c.S.project.assets).length }, il: il && { kind: il.raw.kind, asset: il.raw.source.asset === rawId, fx: il.fx.map((e) => e.type), color: !!il.raw.color.colorMatrix2 }, assetsInFile: Object.keys(imported.assets).includes(rawId), same, shot1, shot2, dl: !!dl, dev: Object.keys(c.scene._assets).some((k) => /^le-dev:/.test(k)), keys: Object.keys(c.scene._assets).map((k) => k.slice(0, 24)), fxs: dl && dl.fx.map((e) => e.type) };
  });
  h.assert(r.layer.raw === 'raw' && r.layer.fx.join() === 'develop.basic,develop.detail', 'RAW layer in the studio: ' + JSON.stringify(r.layer));
  h.assert(r.il && r.il.kind === 'raw' && r.il.asset && r.il.color && r.il.fx[0] === 'develop.basic', 'layer.raw survives .leproject: ' + JSON.stringify(r.il));
  h.assert(r.assetsInFile && r.same, 'the original RAW travels in the project file, byte for byte');
  h.assert(r.dl && r.fxs[0] === 'develop.basic', 'after reopening the RAW layer is back: ' + JSON.stringify(r.fxs));
  await fx.same(pg, png(r.shot1), png(r.shot2), 'the same picture before and after the round trip', { max: 3, over: 0.002 });
  const d3 = await fx.diff(pg, png(r.shot2), png(r.shot3));
  h.assert(d3.mean > 10, 'exposure +1 after reopening brightens the picture: mean ' + d3.mean);
  h.assert.noErrors(pg);
};

cases['camera RAW without the decoder module: a plain message, no console error, nothing half-made'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  await pg.route(/raw-decoder/, (route) => route.fulfill({ status: 404, body: 'missing' }));
  const r = await pg.evaluate(async () => {
    await __raw();
    /* a TIFF-based file named .nef (not a DNG): the built-in reader routes it to the camera module, which is absent here */
    const t = __dng({}), u = new Uint8Array(t.bytes); const fake = new File([u], 'camera.nef');
    const pr = await LE.raw.probe(fake);
    let msg = null, code = null; try { await LE.raw.open(new File([new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0])], 'camera.cr2')); } catch (e) { msg = e.message; code = e.code; }
    return { decoder: pr.decoder, msg, code, formats: LE.raw.formats().length, cr3: LE.raw.formats().some((f) => f.ext === 'cr3' && f.decoder === 'camera') };
  });
  h.assert(r.msg && !/undefined|TypeError|stack/.test(r.msg) && /Camera RAW support|DNG/.test(r.msg), 'plain message: ' + r.msg);
  h.assert(r.formats >= 20 && r.cr3, 'formats listed from the decoder table: ' + r.formats);
  h.assert.noErrors(pg, [/404|Failed to load resource/]);
};

cases['settings copy/paste, presets and auto tone are plain data'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    await __raw();
    const t = __dng({ exposure: 0.35 }), res = await LE.raw.open(t.file), l = res.layer;
    l.fx[0].p.exposure = 0.8; l.fx[0].p.m0 = 2;
    const s = LE.raw.settings.copy(l), json = JSON.stringify(s);
    const other = { fx: [{ id: 'x', type: 'curves', p: {} }, { id: 'y', type: 'develop.basic', p: { wb: 'custom', temp: 3000, tint: 0 } }] };
    const patch = LE.raw.settings.paste(other, s, { whiteBalance: false });
    const id = LE.raw.presets.save('My look', s), list = LE.raw.presets.list(), mine = LE.raw.presets.get(id); LE.raw.presets.remove(id);
    const auto = await LE.raw.autoTone(l);
    return { json, hasHidden: /"m0"/.test(json), patch: patch.fx.map((e) => e.type + ':' + (e.p.wb || '') + ':' + (e.p.temp || '')), builtIn: list.filter((x) => x.builtIn).map((x) => x.id), mine: !!mine, auto };
  });
  h.assert(!r.hasHidden && /develop-settings/.test(r.json), 'copied settings carry no injected values: ' + r.json.slice(0, 200));
  h.assert(r.patch.some((x) => x.indexOf('develop.basic:custom:3000') === 0) && r.patch.some((x) => x.indexOf('develop.detail') === 0) && r.patch[r.patch.length - 1].indexOf('curves') === 0, 'paste keeps the target white balance and other effects: ' + r.patch);
  ['backlit-portrait', 'night-city', 'high-iso-indoor', 'hdr-natural', 'hdr-look'].forEach((id) => h.assert(r.builtIn.includes(id), 'preset ' + id));
  h.assert(r.mine, 'user presets saved and read back');
  h.assert(r.auto.exposure > 0.5 && r.auto.exposure < 2.5, 'auto tone brightens an underexposed RAW: ' + JSON.stringify(r.auto));
  h.assert.noErrors(pg);
};

module.exports = cases;
