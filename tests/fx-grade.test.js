/* Colour grading pack (assets/js/fx/le-fx-grade.js): registry, neutrality, CPU references against the shader, goldens, tiles,
   masks and adjustment layers, operations, LUT import/export, white balance, auto, skin helpers and presets. */
'use strict';
const fx = require('./lib/fx');

const GRADE = ['tone-curve', 'hue-curves', 'hsl', 'bw-mix', 'selective-color', 'selective-color-tones', 'channel-mixer', 'color-grading', 'lift-gamma-gain', 'cdl', 'color-balance', 'gradient-map', 'photo-filter', 'vibrance', 'skin-tone', 'calibration', 'temperature', 'lut'];
const CARD = { card: [256, 192] };

/* Representative, non-neutral settings for every effect: used for the CPU/GPU comparison and the goldens. */
const SAMPLES = {
  'tone-curve': [{ lights: 30, darks: -25, highlights: -20, shadows: 25, curve: { master: [[0, 0.05], [0.5, 0.52], [1, 0.95]], b: [[0, 0.08], [1, 0.92]] } }, { lights: 20, darks: -20, mode: 'luminosity', curve: { master: [[0, 0], [0.3, 0.22], [0.7, 0.8], [1, 1]], r: [[0, 0], [0.5, 0.56], [1, 1]] } }],
  'hue-curves': [{ hueHue: { master: [[0, 0.5], [0.45, 0.5], [0.6, 0.38], [0.75, 0.5], [1, 0.5]] }, hueSat: { master: [[0, 0.6], [0.3, 0.3], [0.6, 0.7], [1, 0.6]] }, hueLum: { master: [[0, 0.5], [0.6, 0.3], [1, 0.5]] }, lumSat: { master: [[0, 0.2], [0.4, 0.5], [1, 0.5]] }, satSat: { master: [[0, 0.5], [0.6, 0.5], [1, 0.4]] } }],
  hsl: [{ mixer: [{ h: 30, s: -40, l: 10 }, { h: 0, s: 30, l: 20 }, { h: -40, s: -60, l: 0 }, { h: 50, s: -50, l: -40 }, { h: -30, s: 40, l: -10 }, { h: -60, s: 30, l: -50 }, { h: 20, s: -30, l: 30 }, { h: 0, s: 60, l: -20 }] }],
  'bw-mix': [{ convert: true, reds: 110, yellows: 90, greens: -20, cyans: 30, blues: -50, magentas: 150, tintHue: 35, tint: 30 }],
  'selective-color': [{ redsC: -40, redsM: 20, redsY: 30, redsK: -20, yellowsC: 30, yellowsK: 25, greensM: 50, greensK: -30, cyansC: 40, cyansY: -40, bluesY: 30, bluesK: 40, magentasM: -50, magentasK: 10 }],
  'selective-color-tones': [{ method: 'relative', whitesY: -30, whitesK: 10, neutralsC: 20, neutralsY: -15, blacksC: 40, blacksK: -30 }, { method: 'absolute', whitesY: -20, whitesC: 10, neutralsM: 15, blacksC: 30, blacksK: 20 }],
  'channel-mixer': [{ rr: 120, rg: -10, rb: 5, gr: 10, gg: 80, gb: 10, br: -20, bg: 30, bb: 110, rc: 2, gc: 0, bc: 4 }, { monochrome: true, rr: 40, rg: 50, rb: 10 }],
  'color-grading': [{ shadows: { h: 195, a: 0.6, l: -0.3 }, midtones: { h: 90, a: 0.2, l: 0.2 }, highlights: { h: 35, a: 0.5, l: 0.2 }, global: { h: 300, a: 0.1, l: -0.2 }, balance: 30, blending: 80 }],
  'lift-gamma-gain': [{ lift: { h: 210, a: 0.3, l: 0.1 }, gamma: { h: 90, a: 0.2, l: 0.2 }, gain: { h: 35, a: 0.3, l: -0.2 }, offset: { h: 0, a: 0.1, l: 0.02 } }],
  cdl: [{ slopeR: 1.2, slopeG: 0.95, slopeB: 0.85, offsetR: 0.02, offsetG: -0.01, offsetB: 0.05, powerR: 0.9, powerG: 1.1, powerB: 1.3, saturation: 0.7 }],
  'color-balance': [{ shadowsCR: -40, shadowsYB: 50, midtonesMG: -30, highlightsCR: 40, highlightsYB: -40, preserve: true }, { shadowsCR: 30, midtonesYB: 40, highlightsMG: 20, preserve: false }],
  'gradient-map': [{ strength: 100, count: 3, color0: '#1b2440', pos0: 0, color1: '#f2c98a', pos1: 1, color2: '#b0503a', pos2: 0.45, interpolation: 'perceptual' }, { strength: 60, count: 2, color0: '#002233', color1: '#ffeecc', interpolation: 'rgb', reverse: true }],
  'photo-filter': [{ filter: 'warming-85', density: 60, preserve: true }, { filter: 'custom', color: '#2266ff', density: 45, preserve: false }],
  vibrance: [{ amount: 80, protect: 80 }, { amount: -70, protect: 0 }],
  'skin-tone': [{ hue: 40, saturation: -30, lightness: 30, uniformity: 80, evenness: 60, center: 125, width: 30, chroma: 0.1 }],
  calibration: [{ redHue: 60, redSat: -40, greenHue: -50, greenSat: 30, blueHue: -70, blueSat: 60, shadowsTint: 50 }],
  temperature: [{ temp: 3200, tint: 20, method: 'bradford' }, { temp: 9500, tint: -30, method: 'cat16' }],
  lut: [{ look: 'teal-orange', intensity: 80 }, { look: 'bleach-bypass', intensity: 100, input: 'linear' }]
};

/* In the page: a 64×64 image holding 16 levels per channel (every colour of a coarse cube), for exhaustive comparisons. */
function cubeImage() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d'), d = x.createImageData(64, 64);
  for (let i = 0; i < 4096; i++) { const r = i % 16, g = (i >> 4) % 16, b = i >> 8; d.data[i * 4] = r * 17; d.data[i * 4 + 1] = g * 17; d.data[i * 4 + 2] = b * 17; d.data[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  return c;
}

/* Renders sources through one entry on the GPU and through the CPU reference; returns the worst and mean difference (0–255). */
async function compare(page, entry) {
  return page.evaluate(([e, cubeSrc]) => {
    const FX = window.LE.fx, G = FX.grade, T = window.fxT;
    const cube = (new Function('return (' + cubeSrc + ')()'))();
    const v = FX.validate(e).entry, def = FX.get(v.type), f = G.ref[v.type](v.p);
    const lin = FX.math.srgbToLinear, dsp = FX.math.linearToSrgb;
    let max = 0, sum = 0, n = 0, at = null;
    [cube, T.card(128, 96)].forEach((src) => {
      const a = T.pixels(src).data, b = T.pixels(FX.apply(src, { fx: [v] })).data;
      for (let i = 0; i < a.length; i += 4) {
        let c = [a[i] / 255, a[i + 1] / 255, a[i + 2] / 255];
        if (f) {
          if (def.space === 'linear') c = c.map(lin);
          c = f(c);
          if (def.space === 'linear') c = c.map(dsp);
        }
        for (let k = 0; k < 3; k++) {
          const want = Math.round(Math.min(1, Math.max(0, c[k])) * 255), d = Math.abs(want - b[i + k]);
          sum += d; n++;
          if (d > max) { max = d; at = { in: [a[i], a[i + 1], a[i + 2]], gpu: [b[i], b[i + 1], b[i + 2]], cpu: c.map((q) => Math.round(q * 2550) / 10) }; }
        }
      }
    });
    return { max, mean: sum / n, at };
  }, [entry, cubeImage.toString()]);
}

const cases = {};

cases['registry: every grading effect is registered, described for agents, within the limits, and declared to LE.support'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate((ids) => {
    const FX = window.LE.fx, d = FX.defs();
    return ids.map((id) => {
      const e = d.find((x) => x.id === id);
      if (!e) return { id, missing: true };
      const ex = FX.validate(e.agent.example);
      return { id, params: Object.keys(e.params).length, section: e.ui.section, spatial: e.spatial, summary: (e.agent.summary || '').length, tips: (e.agent.tips || []).length, exOk: ex.ok && ex.warnings.length === 0, warn: ex.warnings, support: !!(window.LE.support && window.LE.support.get && window.LE.support.get('fx.' + id)), json: JSON.stringify(e).length, ref: typeof FX.grade.ref[id] === 'function',
        controls: (e.ui.controls || []).every((c) => typeof c === 'string' ? !!e.params[c] : (c.heading || c.action || c.control === 'wheels' || c.control === 'mixer' || !!e.params[c.param])) };
    }).concat([{ total: JSON.stringify(d).length, grade: JSON.stringify(d.filter((x) => ids.indexOf(x.id) >= 0)).length }]);
  }, GRADE);
  const total = r.pop();
  r.forEach((e) => {
    h.assert(!e.missing, e.id + ' is registered');
    h.assert(e.params <= 48, e.id + ' has at most 48 parameters (the document sanitiser keeps 48 keys): ' + e.params);
    h.assert(['Light', 'Colour', 'Curves', 'Colour mixer', 'Colour grading'].indexOf(e.section) >= 0, e.id + ' section ' + e.section);
    h.assert(e.spatial === false, e.id + ' is a colour operation, not spatial');
    h.assert(e.summary > 60 && e.tips >= 3, e.id + ' has an agent summary and recipes');
    h.assert(e.exOk, e.id + ' example validates cleanly: ' + JSON.stringify(e.warn));
    h.assert(e.support, e.id + ' is declared to LE.support');
    h.assert(e.ref, e.id + ' has a CPU reference');
    h.assert(e.controls, e.id + ' ui.controls names real params');
  });
  h.assert(total.grade < 60000, 'the pack\'s full registrations stay reasonable: ' + total.grade);
  h.assert.noErrors(page);
};

cases['neutral: every grading effect at its defaults leaves the picture exactly alone, alone and all together'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const src = await fx.render(page, Object.assign({ fx: [] }, CARD));
  for (const id of GRADE) {
    const out = await fx.render(page, Object.assign({ fx: [{ type: id, p: {} }] }, CARD));
    await fx.same(page, src, out, id + ' at defaults', { max: 0, over: 0 });
  }
  const all = await fx.render(page, Object.assign({ fx: GRADE.map((id) => ({ type: id, p: {} })) }, CARD));
  await fx.same(page, src, all, 'the whole pack at defaults', { max: 0, over: 0 });
  const photo = { photo: 'people-02', size: 200 };
  await fx.same(page, await fx.render(page, Object.assign({ fx: [] }, photo)), await fx.render(page, Object.assign({ fx: GRADE.map((id) => ({ type: id, p: {} })) }, photo)), 'a photo at defaults', { max: 0, over: 0 });
  h.assert.noErrors(page);
};

cases['maths: the shader matches the CPU reference for every effect (every colour of a 16-level cube and the test card)'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const report = [];
  for (const id of GRADE) {
    for (const p of SAMPLES[id]) {
      const d = await compare(page, { type: id, p });
      report.push(id + ' ' + d.max + '/' + d.mean.toFixed(3));
      h.assert(d.max <= 3 && d.mean < 0.6, id + ' ' + JSON.stringify(p).slice(0, 80) + ': GPU and CPU differ by ' + d.max + ' (mean ' + d.mean.toFixed(3) + ') at ' + JSON.stringify(d.at));
    }
  }
  console.log('       ' + report.join(', '));
  h.assert.noErrors(page);
};

cases['goldens: one representative setting per effect on the test card, and presets on photos'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  for (const id of GRADE) await fx.golden(page, 'grade-' + id, await fx.render(page, Object.assign({ fx: [{ type: id, p: SAMPLES[id][0] }] }, CARD)));
  const presets = await page.evaluate(() => window.LE.fx.grade.presets.map((p) => p.id));
  h.assert(presets.length >= 10 && presets.length <= 12, 'ten to twelve named presets: ' + presets.length);
  for (const [preset, photo] of [['teal-orange', 'travel-03'], ['warm-portrait', 'people-02'], ['noir', 'street-02'], ['clean-product-white', 'still-02']]) {
    const list = await page.evaluate((id) => window.LE.fx.grade.preset(id), preset);
    await fx.golden(page, 'grade-preset-' + preset, await fx.render(page, { photo, size: 192, fx: list }));
  }
  h.assert.noErrors(page);
};

cases['tiles and resolution: a full grade is the same as one tile and as many, and in the half-resolution preview'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const stack = GRADE.map((id) => ({ type: id, p: SAMPLES[id][0], amount: 0.35 }));
  const o = { photo: 'people-03', size: 420, fx: stack };
  const one = await fx.render(page, o), many = await fx.render(page, Object.assign({ tile: 192 }, o));
  await fx.same(page, one, many, 'the whole pack, one tile against many', { max: 1, over: 0 });
  const passes = await page.evaluate((s) => {
    const FX = window.LE.fx, c = window.fxT.card(300, 200);
    FX.profile(true); FX.apply(c, { fx: s }); const prof = FX.profile(false) || [];
    return { n: prof.length, labels: prof.map((q) => q.label) };
  }, stack);
  h.assert(passes.n <= 2 && passes.labels.filter((l) => /^color\(/.test(l)).length === 1, 'eighteen grading effects fuse into one colour pass: ' + JSON.stringify(passes));
  h.assert.noErrors(page);
};

cases['masks and adjustment layers: an effect mask, a layer mask and an adjustment layer limit a grade to where they say'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT, src = T.card(200, 100), e = { type: 'color-grading', p: { global: { h: 200, a: 0.6, l: -0.3 } } };
    const px = (c) => T.pixels(c).data, full = px(FX.apply(src, { fx: [e] })), none = px(src);
    const lin = { parts: [{ kind: 'linear', x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.5, feather: 0 }] };
    const withMask = px(FX.apply(src, { fx: [Object.assign({ mask: lin }, e)] })), withLayer = px(FX.apply(src, { fx: [e], mask: lin }));
    function worst(a, b, x0, x1) { let m = 0; for (let y = 0; y < 100; y++) for (let x = x0; x < x1; x++) { const i = (y * 200 + x) * 4; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a[i + k] - b[i + k])); } return m; }
    let alphaRight = 0; for (let y = 0; y < 100; y++) for (let x = 142; x < 200; x++) alphaRight = Math.max(alphaRight, withLayer[(y * 200 + x) * 4 + 3]);
    return { maskLeft: worst(withMask, full, 0, 58), maskRight: worst(withMask, none, 142, 200), layerLeft: worst(withLayer, full, 0, 58), alphaRight, differs: worst(full, none, 0, 200) };
  });
  h.assert(r.differs > 30, 'the grade is visible: ' + r.differs);
  h.assert(r.maskLeft <= 1 && r.maskRight <= 1, 'an effect mask: full grade at its start, none past its end: ' + JSON.stringify(r));
  h.assert(r.layerLeft <= 1 && r.alphaRight === 0, 'through a layer mask the graded layer shows where the mask is on and is hidden where it is off: ' + JSON.stringify(r));

  const st = await h.studioWithSample(browser, base, 'desktop');
  await st.evaluate(() => window.LE.fxBoot.load());
  const s = await st.evaluate(async () => {
    const FX = window.LE.fx, sc = window.LEStudio.scene, G = FX.grade;
    sc.load({ v: 1, width: 400, height: 200, background: { type: 'color', color: '#ffffff' }, layers: [
      { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 200, fill: { type: 'solid', color: '#c08060' } },
      { id: 'b', type: 'shape', shape: 'rect', x: 200, y: 0, w: 200, h: 200, fill: { type: 'solid', color: '#c08060' } },
      { id: 'warm', type: 'adjust', x: 0, y: 0, w: 200, h: 200, fx: [{ type: 'temperature', p: { temp: 3200 } }, { type: 'bw-mix', p: { convert: true }, amount: 0.5 }] }
    ] });
    const c = await sc.render(1), x = c.getContext('2d'), at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data).slice(0, 3);
    const want = G.compile([{ type: 'temperature', p: { temp: 3200 } }, { type: 'bw-mix', p: { convert: true }, amount: 0.5 }]).fn([0xc0 / 255, 0x80 / 255, 0x60 / 255]).map((v) => Math.round(v * 255));
    return { inside: at(100, 100), outside: at(300, 100), want };
  });
  h.assert(s.inside.every((v, k) => Math.abs(v - s.want[k]) <= 2), 'the adjustment layer grades what is under its box like the CPU reference: ' + s.inside + ' vs ' + s.want);
  h.assert.equal(s.outside.join(), '192,128,96', 'and leaves the rest of the page alone');
  h.assert.noErrors(st);
};

cases['ops: grading entries round-trip through fx.add, fx.update, fx.reorder and fx.remove; presets become operations'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate((ids) => {
    const FX = window.LE.fx, O = FX.ops, out = [];
    let doc = { v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }] };
    const made = [];
    ids.forEach((id) => { const s = O.apply(doc, { op: 'fx.add', layer: 'a', entry: FX.defs().find((d) => d.id === id).agent.example }); out.push([id, s.ok, s.warnings.length]); doc = s.doc; made.push(s.id); });
    let s = O.apply(doc, { op: 'fx.update', layer: 'a', id: made[0], p: { lights: 999 } });
    const clamped = s.doc.layers[0].fx[0].p.lights; doc = s.doc;
    s = O.apply(doc, { op: 'fx.update', layer: 'a', id: made[7], p: { shadows: { h: 10, a: 5, l: 0 } } });
    const wheel = s.doc.layers[0].fx[7].p.shadows; doc = s.doc;
    s = O.apply(doc, { op: 'fx.reorder', layer: 'a', id: made[17], index: 0 }); doc = s.doc;
    const first = doc.layers[0].fx[0].type;
    made.forEach((id) => { doc = O.apply(doc, { op: 'fx.remove', layer: 'a', id }).doc; });
    const ops = FX.grade.presetOps('a', 'teal-orange');
    let d2 = { v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }] };
    ops.forEach((op) => { d2 = O.apply(d2, op).doc; });
    return { out, clamped, wheel, first, left: (doc.layers[0].fx || []).length, preset: d2.layers[0].fx.map((e) => e.type), presetsOk: FX.grade.presets.every((p) => p.fx.every((e) => FX.validate(e).ok && FX.validate(e).warnings.length === 0)) };
  }, GRADE);
  r.out.forEach((o) => h.assert(o[1] && o[2] === 0, o[0] + ' adds cleanly from its agent example'));
  h.assert(r.clamped === 100, 'out-of-range values are clamped: ' + r.clamped);
  h.assert(r.wheel.a === 1 && r.wheel.h === 10, 'wheel values are clamped to their shape: ' + JSON.stringify(r.wheel));
  h.assert(r.first === 'lut' && r.left === 0, 'reorder and remove');
  h.assert(r.preset.join() === 'color-grading,hsl,tone-curve' && r.presetsOk, 'presets are valid data and become operations: ' + r.preset);
  h.assert.noErrors(page);
};

cases['LUTs: .cube files are parsed defensively, stored by content hash, interpolated tetrahedrally, and a grade exports as a .cube'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx, G = FX.grade, T = window.fxT;
    function cube(n, f, head) { const L = (head || []).concat(['LUT_3D_SIZE ' + n]); for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) { const o = f([r / (n - 1), g / (n - 1), b / (n - 1)]); L.push(o.map((v) => v.toFixed(6)).join(' ')); } return L.join('\n'); }
    const out = {};
    const id17 = cube(17, (c) => c, ['# identity', 'TITLE "Identity 17"']);
    const p = G.parseCube(id17); out.parsed = [p.kind, p.size3, p.title, p.data3.length];
    const bad = {
      keyword: 'LUT_3D_SIZE 2\nEVAL alert(1)\n' + '0 0 0\n'.repeat(8), number: 'LUT_3D_SIZE 2\n' + '0 0 0x10\n'.repeat(8), count: 'LUT_3D_SIZE 2\n0 0 0\n', big: 'LUT_3D_SIZE 129\n', none: '0 0 0\n',
      inf: 'LUT_3D_SIZE 2\n' + '1e999 0 0\n'.repeat(8), domain: 'LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n' + '0 0 0\n'.repeat(8), after: 'LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(8) + 'TITLE "x"\n', proto: 'LUT_3D_SIZE 2\n__proto__ 1\n', huge: 'x'.repeat(16 * 1024 * 1024 + 1)
    };
    out.refused = Object.keys(bad).filter((k) => { try { G.parseCube(bad[k]); return false; } catch (e) { return true; } });
    const oneD = G.parseCube('LUT_1D_SIZE 3\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n0.25 0.5 0.75\n1 1 1\n'); out.oneD = [oneD.kind, oneD.size1];
    const shaper = G.parseCube('LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n0 0 0\n1 1 1\n' + cube(2, (c) => [1 - c[0], 1 - c[1], 1 - c[2]]).split('\n').slice(1).join('\n')); out.shaper = [shaper.kind, shaper.size1, shaper.size3];
    /* A known, strongly non-linear LUT: compare the shader's tetrahedral lookup with the CPU one on every colour of the card. */
    const warp = cube(9, (c) => [Math.pow(c[0], 0.6) * 0.9 + c[2] * 0.1, c[1] * c[1], 0.2 + 0.6 * c[2] * c[0]], ['TITLE "warp"']);
    const imp = await G.importCube(warp, 'warp.cube'); out.id = imp.id;
    const src = T.card(160, 120), a = T.pixels(src).data, b = T.pixels(FX.apply(src, { fx: [{ type: 'lut', p: { lut: imp.id } }] })).data, f = G.ref.lut(FX.validate({ type: 'lut', p: { lut: imp.id } }).entry.p);
    let mx = 0; for (let i = 0; i < a.length; i += 4) { const o = f([a[i] / 255, a[i + 1] / 255, a[i + 2] / 255]); for (let k = 0; k < 3; k++) mx = Math.max(mx, Math.abs(Math.round(Math.min(1, Math.max(0, o[k])) * 255) - b[i + k])); }
    out.gpuVsCpu = mx;
    /* Tetrahedral interpolation reproduces any linear map exactly (trilinear does too, but tetrahedral also keeps the grey axis on the diagonal). */
    const affine = G.parseCube(cube(5, (c) => [0.1 + 0.8 * c[0], 0.3 * c[0] + 0.7 * c[1], 0.5 * c[2] + 0.25]));
    let te = 0; for (let k = 0; k < 200; k++) { const c = [Math.random(), Math.random(), Math.random()], o = G.tetra(affine.data3, 5, c), w = [0.1 + 0.8 * c[0], 0.3 * c[0] + 0.7 * c[1], 0.5 * c[2] + 0.25]; te = Math.max(te, Math.abs(o[0] - w[0]), Math.abs(o[1] - w[1]), Math.abs(o[2] - w[2])); }
    out.tetraErr = te;
    /* Export: a colour stack → .cube 33³ → parse → apply as a LUT ≈ the stack itself. Entries a LUT cannot hold are reported. */
    const stack = [{ type: 'temperature', p: { temp: 5200, tint: 6 } }, { type: 'tone-curve', p: { lights: 20, darks: -15 } }, { type: 'color-grading', p: { shadows: { h: 200, a: 0.3, l: 0 }, highlights: { h: 40, a: 0.25, l: 0 } } }, { type: 'hsl', p: { mixer: [{ h: 0, s: 0, l: 0 }, { h: 0, s: 20, l: 0 }, { h: 0, s: 0, l: 0 }, { h: 30, s: -40, l: 0 }, { h: 0, s: 0, l: 0 }, { h: 0, s: 0, l: -20 }, { h: 0, s: 0, l: 0 }, { h: 0, s: 0, l: 0 }] } }, { type: 'exposure', p: { ev: 0.2 } }, { type: 'gaussian-blur', p: { radius: 3 } }, { type: 'vibrance', p: { amount: 30 }, mask: { parts: [{ kind: 'luma', min: 0.5 }] } }];
    const ex = G.exportCube(stack, { title: 'Test grade' });
    out.export = { lines: ex.text.split('\n').length, skipped: ex.skipped.map((q) => q.type + ':' + q.reason), used: ex.used };
    const back = await G.importCube(ex.text);
    const direct = T.pixels(FX.apply(src, { fx: stack.slice(0, 5) })).data, viaLut = T.pixels(FX.apply(src, { fx: [{ type: 'lut', p: { lut: back.id } }] })).data;
    let em = 0, es = 0; for (let i = 0; i < direct.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(direct[i + k] - viaLut[i + k]); em = Math.max(em, d); es += d; }
    out.roundTrip = { max: em, mean: es / (direct.length * 0.75) };
    /* Hex ids like the project store's, and the asset reference is found by LE.fx.assetsOf. */
    out.assets = FX.assetsOf({ fx: [{ type: 'lut', p: { lut: imp.id } }] });
    return out;
  });
  h.assert.equal(r.parsed.join(), '3d,17,Identity 17,14739', 'a 3D cube with title and comments');
  h.assert.equal(r.refused.sort().join(), 'after,big,count,domain,huge,inf,keyword,none,number,proto', 'hostile or malformed files are refused');
  h.assert.equal(r.oneD.join() + '|' + r.shaper.join(), '1d,3|shaper+3d,2,2', '1D and shaper + 3D files');
  h.assert(/^[0-9a-f]{64}$/.test(r.id), 'stored under a 64-hex content hash: ' + r.id);
  h.assert(r.gpuVsCpu <= 1, 'the shader\'s tetrahedral lookup matches the CPU one: ' + r.gpuVsCpu);
  h.assert(r.tetraErr < 1e-6, 'tetrahedral interpolation is exact on an affine map: ' + r.tetraErr);
  h.assert(r.export.lines === 33 * 33 * 33 + 6 && r.export.skipped.join() === 'gaussian-blur:not a per-pixel colour effect,vibrance:has a mask', 'export bakes 33³ and reports what it cannot hold: ' + JSON.stringify(r.export));
  h.assert(r.roundTrip.max <= 6 && r.roundTrip.mean < 0.8, 'the exported LUT reproduces the grade: ' + JSON.stringify(r.roundTrip));
  h.assert(r.assets.indexOf(r.id) >= 0, 'LE.fx.assetsOf lists the LUT asset');
  h.assert.noErrors(page);
};

cases['LUTs in the studio: an asset in the project store is read in the background and the picture redraws with it'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => window.LE.fxBoot.load());
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx, G = FX.grade, sc = window.LEStudio.scene;
    const L = ['LUT_3D_SIZE 2']; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) L.push([1 - r, 1 - g, 1 - b].join(' '));
    const imp = await G.importCube(L.join('\n'), 'invert.cube');
    delete G.luts[imp.id]; if (window.LE.expert && window.LE.expert.luts) delete window.LE.expert.luts[imp.id];
    sc.load({ v: 1, width: 200, height: 100, background: { type: 'color', color: '#ffffff' }, layers: [
      { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, fill: { type: 'solid', color: '#204060' } },
      { id: 'inv', type: 'adjust', fx: [{ type: 'lut', p: { lut: imp.id } }] }] });
    const px = async () => { const c = await sc.render(1); return Array.from(c.getContext('2d').getImageData(100, 50, 1, 1).data).slice(0, 3); };
    const first = await px();
    for (let i = 0; i < 40 && !G.luts[imp.id]; i++) await new Promise((res) => setTimeout(res, 50));
    await new Promise((res) => setTimeout(res, 100));
    return { first, later: await px(), stored: !!(await window.LE.project.getAsset(imp.id)), id: imp.id };
  });
  h.assert(r.stored && /^[0-9a-f]{64}$/.test(r.id), 'the LUT is a project asset');
  h.assert.equal(r.later.join(), '223,191,159', 'once read, the LUT applies (an inverting cube): ' + r.later + ' (first frame ' + r.first + ')');
  h.assert.noErrors(page);
};

cases['white balance: the picker neutralises a sampled cast, Kelvin is monotone, and auto fixes a cast picture'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx, G = FX.grade, T = window.fxT, out = {};
    /* A grey lit by 3200 K and by 9000 K light (simulated with the inverse adaptation), then picked and corrected. */
    out.picks = [[3200, 0], [4500, 25], [9000, -20], [6504, 0]].map(([K, tint]) => {
      const lit = G.kelvinMatrix(K, tint);   /* adaptation from K → D65; its inverse applied to grey makes the cast */
      const inv = FX.quad.invert(lit), grey = [0.18, 0.18, 0.18], cast = [inv[0] * 0.18 + inv[1] * 0.18 + inv[2] * 0.18, inv[3] * 0.18 + inv[4] * 0.18 + inv[5] * 0.18, inv[6] * 0.18 + inv[7] * 0.18 + inv[8] * 0.18];
      const pick = G.whiteBalanceFrom(cast), m = G.kelvinMatrix(pick.temp, pick.tint), fixed = [0, 1, 2].map((k) => m[k * 3] * cast[0] + m[k * 3 + 1] * cast[1] + m[k * 3 + 2] * cast[2]);
      return { K, tint, pick, spread: Math.max(...fixed) / Math.min(...fixed) - 1, grey: grey[0] };
    });
    /* Monotone: lower temperature always makes a grey bluer (b/r rises). */
    let last = -1, mono = true;
    for (let K = 2000; K <= 15000; K += 250) { const m = G.kelvinMatrix(K, 0); const br = (m[6] + m[7] + m[8]) / (m[0] + m[1] + m[2]); if (last >= 0 && br > last + 1e-9) mono = false; last = br; }
    out.mono = mono;
    out.methods = ['bradford', 'cat16', 'von-kries'].map((k) => { const m = G.kelvinMatrix(3200, 0, k); return Math.round((m[6] + m[7] + m[8]) / (m[0] + m[1] + m[2]) * 1000) / 1000; });
    /* Auto: a warm-cast card is analysed and the suggested entries neutralise it. */
    const card = T.card(256, 192), cast = FX.apply(card, { fx: [{ type: 'temperature', p: { temp: 9000, tint: 10 } }] });
    const st = await FX.analyze(cast), auto = G.auto(st);
    const fixed = await FX.analyze(FX.apply(cast, { fx: auto.fx })), orig = await FX.analyze(card);
    out.auto = { fx: auto.fx, before: st.whiteBalance.cast, after: fixed.whiteBalance.cast, orig: orig.whiteBalance.cast };
    /* Auto tone stretches a flat picture. */
    const flat = FX.apply(card, { fx: [{ type: 'levels', p: { outBlack: 0.15, outWhite: 0.8 } }] });
    const ts = await FX.analyze(flat), tone = G.auto.tone(ts), after = await FX.analyze(FX.apply(flat, { fx: [tone.entry] }));
    out.tone = { entry: tone.entry.p, before: [ts.percentiles.luma.p1, ts.percentiles.luma.p99], after: [after.percentiles.luma.p1, after.percentiles.luma.p99] };
    out.none = G.auto.tone(orig);
    return out;
  });
  r.picks.forEach((q) => h.assert(q.spread < 0.01, 'picker neutralises a ' + q.K + ' K / tint ' + q.tint + ' cast: ' + JSON.stringify(q)));
  r.picks.forEach((q) => h.assert(Math.abs(q.pick.temp - q.K) <= 60 && Math.abs(q.pick.tint - q.tint) <= 1.5, 'and reads the light back: ' + JSON.stringify(q.pick) + ' for ' + q.K + '/' + q.tint));
  h.assert(r.mono, 'temperature is monotone');
  h.assert(r.methods.every((v) => v > 1.2) && new Set(r.methods).size >= 2, 'all three adaptations cool a 3200 K setting, differently: ' + r.methods);
  h.assert(r.auto.fx[0].type === 'temperature' && Math.abs(r.auto.after.rg - r.auto.orig.rg) < Math.abs(r.auto.before.rg - r.auto.orig.rg) / 2, 'auto white balance removes most of a cast: ' + JSON.stringify(r.auto));
  h.assert(r.tone.after[0] < r.tone.before[0] - 0.08 && r.tone.after[1] > r.tone.before[1] + 0.08, 'auto tone stretches a flat picture: ' + JSON.stringify(r.tone));
  h.assert.noErrors(page);
};

cases['skin and bands: the skin mask helper selects skin, skin-tone evens it, and targeted bands follow a picked colour'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, G = FX.grade, T = window.fxT;
    const skin = ['#f3e7db', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#e0ac8c', '#c68863', '#8d5524', '#ffdbac', '#f1c27d', '#e0ac69', '#d99a7c', '#b5765a', '#6b4231'];
    const other = ['#808080', '#ffffff', '#101010', '#4f7a28', '#2e6b3a', '#6fa8dc', '#3366cc', '#7a3fb0', '#ff8800', '#ffcc00', '#2bb5b5', '#c0c0c0', '#cc2233'];
    function sel(cols) {
      const c = document.createElement('canvas'); c.width = cols.length; c.height = 1; const x = c.getContext('2d');
      cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(i, 0, 1, 1); });
      /* The renderer's own colour mask: exposure −10 stops where the mask is on, so the selection is 1 − out/in. */
      const a = T.pixels(c).data, b = T.pixels(FX.apply(c, { fx: [{ type: 'exposure', p: { ev: -10 }, mask: G.skinMask() }] })).data;
      return cols.map((col, i) => { const k = [0, 1, 2].reduce((m, q) => Math.max(m, a[i * 4 + q]), 0) || 1; return 1 - Math.max(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]) / k; });
    }
    const s = sel(skin), o = sel(other);
    /* skin-tone uniformity pulls a spread of skin hues together on the vectorscope. */
    const ang = (c) => G.skinWeight(c).angle, f = G.ref['skin-tone'](FX.validate({ type: 'skin-tone', p: { uniformity: 80 } }).entry.p);
    const hs = skin.map((x) => FX.math.parseColor(x).slice(0, 3)), spread = (l) => Math.max(...l) - Math.min(...l);
    const before = hs.map(ang).filter((a, i) => G.skinWeight(hs[i]).weight > 0.5), after = hs.filter((c) => G.skinWeight(c).weight > 0.5).map((c) => ang(f(c)));
    const blue = G.targetBands('#3366cc'), orange = G.targetBands([0.9, 0.55, 0.3]), grey = G.targetBands('#808080');
    const moved = orange.apply(null, 's', 20);
    return { skin: s, other: o, before: spread(before), after: spread(after), n: before.length, blue: blue.weights, orange: orange.weights, grey: grey.bands.reduce((a, b) => a + b, 0), moved: moved.map((b) => b.s) };
  });
  const sMin = Math.min(...r.skin), oMax = Math.max(...r.other);
  h.assert(r.skin.filter((v) => v > 0.5).length >= 13, 'the skin mask selects skin from very light to deep: ' + r.skin.map((v) => v.toFixed(2)));
  h.assert(r.other.filter((v) => v < 0.25).length >= 11, 'and mostly not greys, foliage, sky or saturated colours: ' + r.other.map((v) => v.toFixed(2)) + ' (min skin ' + sMin.toFixed(2) + ', max other ' + oMax.toFixed(2) + ')');
  h.assert(r.after < r.before * 0.6 && r.n >= 8, 'uniformity pulls skin hues together: ' + r.before.toFixed(1) + '° → ' + r.after.toFixed(1) + '°');
  h.assert(r.blue.blue > 0.7 && r.orange.orange > 0.5 && r.grey === 0, 'targeted bands follow the picked colour: ' + JSON.stringify([r.blue, r.orange]));
  h.assert(r.moved[1] > 10 && r.moved[5] === 0, 'and apply the change to those bands: ' + r.moved);
  h.assert.noErrors(page);
};

cases['sliders: every grading slider changes the picture smoothly and in one direction'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, G = FX.grade, out = [];
    const probes = [[0.8, 0.45, 0.3], [0.3, 0.5, 0.75], [0.5, 0.5, 0.5], [0.15, 0.2, 0.1], [0.92, 0.9, 0.85]];
    /* For each number slider: walk it from default to max, measure how a probe colour moves. Steps must be small (smooth) and,
       projected on the first step's direction, never go back (monotone). */
    const skip = { 'gradient-map': 1, lut: 1, 'bw-mix': 1 };
    FX.defs().filter((d) => G.ref[d.id] && d.id.indexOf('-') !== 0 && !skip[d.id] && ['exposure', 'contrast', 'highlights-shadows', 'levels', 'curves', 'white-balance', 'saturation'].indexOf(d.id) < 0).forEach((d) => {
      Object.keys(d.params).filter((k) => d.params[k].type === 'number' && !/^(split|center|width|chroma|pos|count)/.test(k)).forEach((k) => {
        const s = d.params[k], steps = 24, base = FX.defaults(d.id);
        if (d.id === 'gradient-map') base.strength = 100;
        let spike = 0, back = 0;
        probes.forEach((c) => {
          let prev = null, dir = null; const lens = [];
          for (let i = 0; i <= steps; i++) {
            const p = Object.assign({}, base); p[k] = s.default + (s.max - s.default) * i / steps;
            const f = G.ref[d.id](FX.validate({ type: d.id, p }).entry.p), o = f ? f(c) : c;
            if (prev) {
              const v = [o[0] - prev[0], o[1] - prev[1], o[2] - prev[2]], len = Math.hypot(v[0], v[1], v[2]);
              lens.push(len);
              if (!dir && len > 1e-5) dir = v.map((x) => x / len);
              if (dir) back = Math.min(back, v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]);
            }
            prev = o;
          }
          /* A spike: one step much longer than both neighbours (a jump or a kink); gradual curvature and clamping are fine. */
          for (let i = 0; i < lens.length; i++) spike = Math.max(spike, lens[i] - 2.5 * Math.max(i > 0 ? lens[i - 1] : 0, i < lens.length - 1 ? lens[i + 1] : 0));
        });
        out.push({ id: d.id + '.' + k, spike, back });
      });
    });
    return out;
  });
  const bad = r.filter((q) => q.spike > 0.004 || q.back < -0.01);
  h.assert(r.length > 60, 'sliders were walked: ' + r.length);
  h.assert(!bad.length, 'smooth and monotone: ' + JSON.stringify(bad.slice(0, 6)));
};

cases['workspace: the develop panel builds every grading effect from its registration and writes the document'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const warns = [];
  page.on('console', (m) => { if (m.type() === 'warning' && /LE\.expert/.test(m.text())) warns.push(m.text()); });
  await page.evaluate(() => { ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((c) => window.LE.support && window.LE.support.override(c, true)); });
  await page.evaluate(() => window.LE.fxBoot.load());
  await page.evaluate(() => window.LEStudio.mode('expert'));
  await page.waitForFunction(() => window.LE.expert && window.LE.expert.active() && window.LE.expert.panel);
  const r = await page.evaluate((ids) => {
    const X = window.LE.expert, FX = window.LE.fx, sc = window.LEStudio.scene, layer = sc.layers()[0].id, out = {};
    ids.forEach((id) => {
      const def = FX.defs().find((d) => d.id === id), B = X.panel.bindFirst(def, () => layer), pn = X.panel.build(def, B);
      out[id] = { controls: pn.items.length, notes: pn.el.querySelectorAll('.xp-note').length };
      pn.destroy();
    });
    const cg = FX.defs().find((d) => d.id === 'color-grading'), B = X.panel.bindFirst(cg, () => layer);
    B.write('shadows', { h: 200, a: 0.3, l: 0 }, 'k1', false);
    out.written = (sc.layer(layer).fx || []).map((e) => e.type + ':' + JSON.stringify(e.p.shadows));
    return out;
  }, GRADE);
  GRADE.forEach((id) => h.assert(r[id].controls > 0 && r[id].notes === 0, id + ' builds its controls: ' + JSON.stringify(r[id])));
  h.assert(r.written.some((s) => /^color-grading:.*"h":200/.test(s)), 'a wheel write creates the entry: ' + r.written);
  h.assert(!warns.length, 'no panel warnings: ' + warns.join(' | '));
};

module.exports = cases;
