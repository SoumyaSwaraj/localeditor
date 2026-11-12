'use strict';
/* Creative effects pack (X2, assets/js/fx/le-fx-creative.js): schema and descriptors, neutral defaults, goldens, tiles and
   preview/export, masks and adjustment layers, document operations, named looks, and numeric checks of each effect's core
   maths against CPU references. Helpers: tests/lib/fx.js. Goldens: tests/golden/fx/creative-*.png (FX_GOLDEN=create writes
   missing ones, FX_GOLDEN=update rewrites them; look at them before committing). */
const fx = require('./lib/fx');

const cases = {};
const CARD = { card: [256, 192] };
const SECTIONS = ['Light', 'Colour', 'Curves', 'Colour mixer', 'Colour grading', 'Detail', 'Optics', 'Geometry', 'Effects', 'Shadows & reflections', 'Compositing', 'Retouch'];
/* Settings for goldens and tile checks, sized for 256–420 px test pictures (agent examples are tuned for full-size photos). */
const SHOT = {
  'film-grain': { amount: 60, size: 1.5, roughness: 60, color: 40, seed: 3 },
  'halation': { amount: 60, threshold: 0.7, radius: 6 },
  'bloom': { amount: 50, threshold: 0.7, radius: 30 },
  'glow': { amount: 50, threshold: 0.6, radius: 12, color: '#ff7ad9' },
  'light-leak': { amount: 60, position: { x: 0.95, y: 0.2 }, size: 0.6, seed: 4 },
  'dust-scratches': { amount: 80, dust: 70, size: 2, hairs: 50, scratches: 60, seed: 2 },
  'fade': { amount: 80, black: '#2a2420', whites: 0.92, desaturate: 20 },
  'cross-process': { preset: 'slide-in-negative', amount: 80 },
  'chromatic-aberration': { redCyan: 80, blueYellow: -60, shift: 2, angle: 30 },
  'vignette': { amount: -60, midpoint: 35, feather: 50, roundness: 30, center: { x: 0.45, y: 0.5 } },
  'lens-distortion': { amount: 70 },
  'anamorphic-streaks': { amount: 70, threshold: 0.7, length: 200 },
  'lens-flare': { amount: 70, position: { x: 0.3, y: 0.25 }, size: 1.2, seed: 2 },
  'lens-blur': { radius: 8, blades: 6, curvature: 30, highlights: 50, threshold: 0.8, catsEye: 40 },
  'tilt-shift': { blur: 8, center: { x: 0.5, y: 0.55 }, focus: 0.08, transition: 0.2 },
  'iris-blur': { blur: 8, center: { x: 0.6, y: 0.5 }, rx: 0.25, ry: 0.3, transition: 0.4 },
  'motion-blur': { angle: 20, distance: 24 },
  'box-blur': { radius: 6 },
  'radial-blur': { amount: 30, mode: 'zoom', center: { x: 0.55, y: 0.5 } },
  'surface-blur': { radius: 6, threshold: 25 },
  'soft-focus': { amount: 60, style: 'orton', radius: 10 },
  'sharpen': { amount: 150, radius: 1.2, masking: 20 },
  'smart-sharpen': { amount: 150, radius: 1.2, remove: 'lens', noise: 10 },
  'clarity': { amount: 60, radius: 20 },
  'texture': { amount: 80 },
  'dehaze': { amount: 50 },
  'noise-reduction': { luminance: 60, color: 60 },
  'high-pass': { amount: 100, radius: 3, mode: 'overlay' },
  'duotone': { amount: 100, tones: '3' },
  'halftone': { amount: 100, style: 'cmyk', size: 6 },
  'pixelate': { size: 10 },
  'posterize': { levels: 5 },
  'threshold': { amount: 100, level: 0.45 },
  'glitch': { split: 4, blocks: 60, blockSize: 12, scanlines: 50, seed: 5 },
  'emboss': { amount: 100, height: 2 },
  'edge-glow': { amount: 100, width: 1.2, brightness: 60 },
  'oil-paint': { radius: 4, sharpness: 70 },
  'sketch': { amount: 100, radius: 3 },
  'texture-overlay': { amount: 80, style: 'canvas', scale: 0.8 },
  'frosted-glass': { amount: 5, grain: 1 },
  'sun-rays': { amount: 70, position: { x: 0.75, y: 0.75 }, threshold: 0.6, length: 40 },
  'haze': { amount: 60, source: 'gradient', horizon: 0.3 },
  'color-wash': { amount: 70, style: 'linear', color: '#ff8a3c', color2: '#2a5cff', mode: 'soft-light' },
  'sun-glow': { amount: 70, position: { x: 0.75, y: 0.75 }, size: 0.4 }
};
const ids = () => Object.keys(SHOT).concat(['depth-blur']);

/* In the page: a packed 16-bit depth map (red high byte, green low byte, near = 1), nearest at the left edge. */
function depthCanvas(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'), id = x.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) { const v = Math.round((1 - fn(i / (w - 1), y / (h - 1))) * 65535), k = (y * w + i) * 4; id.data[k] = v >> 8; id.data[k + 1] = v & 255; id.data[k + 3] = 255; }
  x.putImageData(id, 0, 0);
  return c;
}

cases['registry: every creative effect has a complete schema, workspace descriptor and agent description'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, CR = FX.creative, d = FX.describe().filter((e) => CR.ids.indexOf(e.id) >= 0);
    const ex = d.map((e) => ({ id: e.id, v: FX.validate(e.agent.example) }));
    const presets = Object.keys(CR.presets).map((k) => ({ k, name: CR.presets[k].name, summary: CR.presets[k].summary, v: CR.look(k).map((en) => FX.validate(en)) }));
    return { d, ex, presets, ids: CR.ids, support: CR.ids.filter((id) => window.LE.support && window.LE.support.get ? !!window.LE.support.get('fx.' + id) : true), json: JSON.stringify(d).length };
  });
  h.assert(r.ids.length >= 44, 'the pack registers its effects: ' + r.ids.length);
  ids().forEach((id) => h.assert(r.ids.indexOf(id) >= 0, 'missing ' + id));
  r.d.forEach((e) => {
    h.assert(e.name && e.version >= 1 && (e.space === 'linear' || e.space === 'display'), e.id + ' basics');
    h.assert(SECTIONS.indexOf(e.ui.section) >= 0 && typeof e.ui.order === 'number', e.id + ' section ' + e.ui.section);
    h.assert(e.agent.summary.length > 40 && e.agent.tips.length >= 1 && e.agent.like && e.agent.example.type === e.id, e.id + ' agent description');
    h.assert(!/photoshop|lightroom|adobe|capture one|affinity|davinci|instagram/i.test(e.name + e.agent.summary + JSON.stringify(e.params)), e.id + ' has no product names in user-facing text');
    Object.keys(e.params).forEach((k) => {
      const s = e.params[k];
      h.assert(s.label, e.id + '.' + k + ' label');
      if (s.type === 'number') h.assert(s.min < s.max && s.default >= s.min && s.default <= s.max && s.step > 0, e.id + '.' + k + ' range ' + JSON.stringify(s));
      if (s.type === 'choice') h.assert(s.options.some((o) => (o.value || o) === s.default), e.id + '.' + k + ' default option');
    });
    const used = {};
    (e.ui.controls || []).forEach((c) => {
      if (typeof c === 'string') { h.assert(!!e.params[c], e.id + ' control ' + c); used[c] = 1; return; }
      if (c.heading) return;
      h.assert(!!e.params[c.param], e.id + ' control ' + JSON.stringify(c)); used[c.param] = 1;
      Object.keys(c.when || {}).forEach((k) => { const want = [].concat(c.when[k]), s = e.params[k]; h.assert(s && want.every((v) => s.options.some((o) => (o.value || o) === v)), e.id + ' when ' + JSON.stringify(c.when)); });
    });
    Object.keys(e.params).forEach((k) => h.assert(used[k], e.id + ' lists every parameter in ui.controls (' + k + ')'));
    if (/position|center|start/.test(Object.keys(e.params).join())) h.assert(Object.keys(e.params).some((k) => e.params[k].type === 'point'), e.id + ' positions are point values');
  });
  r.ex.forEach((x) => h.assert(x.v.ok && x.v.warnings.length === 0, x.id + ' example validates cleanly: ' + JSON.stringify(x.v.warnings)));
  h.assert(r.presets.length >= 10 && r.presets.length <= 12, 'ten to twelve named looks: ' + r.presets.length);
  r.presets.forEach((p) => {
    h.assert(p.name && p.summary && p.v.length >= 3, p.k + ' look is described');
    p.v.forEach((v) => h.assert(v.ok && v.warnings.length === 0, p.k + ': ' + JSON.stringify(v.warnings.concat(v.errors))));
  });
  h.assert(r.support.length === r.ids.length, 'every effect is declared to LE.support');
  h.assert(r.json < 2500 * r.d.length, 'descriptors stay compact: ' + r.json);
  h.assert.noErrors(page);
};

cases['neutral: every effect at its defaults leaves the picture untouched, alone and all together'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT, out = {};
    const cmp = (a, b) => { const x = T.pixels(a).data, y = T.pixels(b).data; let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i])); return m; };
    [false, true].forEach((alpha) => {
      const src = T.card(256, 192, alpha);
      FX.creative.ids.forEach((id) => { out[id + (alpha ? '+alpha' : '')] = cmp(src, FX.apply(src, { fx: [{ type: id, p: FX.defaults(id) }] })); });
      out['all' + (alpha ? '+alpha' : '')] = cmp(src, FX.apply(src, { fx: FX.creative.ids.map((id) => ({ type: id, p: FX.defaults(id) })) }));
      out['zero amount' + (alpha ? '+alpha' : '')] = cmp(src, FX.apply(src, { fx: FX.creative.ids.map((id) => ({ type: id, p: FX.get(id).agent.example.p, amount: 0 })).slice(0, 30) }));
    });
    return out;
  });
  Object.keys(r).forEach((k) => h.assert(r[k] <= 1, k + ' at default values changes the picture by ' + r[k] + ' levels'));
  h.assert.noErrors(page);
};

async function goldens(page, list) {
  for (const id of list) await fx.golden(page, 'creative-' + id, await fx.render(page, Object.assign({ fx: [{ type: id, p: SHOT[id] }] }, CARD)));
}
cases['goldens 1/3: film, analog and optics at 256 px'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  await goldens(page, Object.keys(SHOT).slice(0, 14));
  h.assert.noErrors(page);
};
cases['goldens 2/3: blur gallery and detail at 256 px (depth blur with a depth map)'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  await goldens(page, Object.keys(SHOT).slice(14, 29));
  const url = await page.evaluate((dc) => {
    const FX = window.LE.fx, depth = eval('(' + dc + ')')(64, 48, (x, y) => (y > 0.55 ? 0.15 : 0.85));
    const out = FX.apply(window.fxT.card(256, 192), { fx: [{ type: 'depth-blur', p: { radius: 8, focus: 0.15, range: 0.1, highlights: 40 } }], layer: { maps: { depth: { asset: 'd', model: 'test', version: 1 } } }, assets: (id) => (id === 'd' ? depth : null) });
    return window.fxT.png(out);
  }, depthCanvas.toString());
  await fx.golden(page, 'creative-depth-blur', Buffer.from(url.split(',')[1], 'base64'));
  h.assert.noErrors(page);
};
cases['goldens 3/3: stylise and atmosphere at 256 px'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  await goldens(page, Object.keys(SHOT).slice(29));
  h.assert.noErrors(page);
};

/* One rectangle against many (tile 128 forces seams through the picture), and the cached preview path against the tiled export. */
async function tiles(page, h, list) {
  for (const id of list) {
    const o = { photo: 'street-03', size: 420, fx: [{ type: id, p: SHOT[id] }] };
    const one = await fx.render(page, Object.assign({ preview: true, key: 'creative-' + id }, o));
    const many = await fx.render(page, Object.assign({ tile: id === 'sun-rays' ? 256 : 128 }, o));
    await fx.same(page, one, many, id + ': preview (one rectangle) against a tiled export', { max: 2, over: 0.0005 });
  }
  const st = await page.evaluate(() => window.LE.fx.status().stats.tiles);
  h.assert(st > list.length * 4, 'the exports were really tiled (' + st + ' tiles)');
}
const TILE_GROUPS = [
  ['film and analog', ['film-grain', 'halation', 'bloom', 'glow', 'light-leak', 'dust-scratches']],
  ['optics', ['chromatic-aberration', 'vignette', 'lens-distortion', 'anamorphic-streaks', 'lens-flare']],
  ['lens and field blurs', ['lens-blur', 'tilt-shift', 'iris-blur', 'soft-focus']],
  ['directional and edge-preserving blurs', ['motion-blur', 'box-blur', 'radial-blur', 'surface-blur']],
  ['sharpening', ['sharpen', 'smart-sharpen', 'high-pass']],
  ['local contrast and haze', ['clarity', 'texture', 'dehaze', 'noise-reduction']],
  ['stylise', ['halftone', 'pixelate', 'glitch', 'emboss', 'edge-glow', 'sketch']],
  ['textures and atmosphere', ['texture-overlay', 'frosted-glass', 'haze']],
  ['oil paint', ['oil-paint']],
  ['sun rays (a very long reach: each tile carries most of the picture)', ['sun-rays']]
];
TILE_GROUPS.forEach((gr, i) => {
  cases['tiles ' + (i + 1) + '/' + (TILE_GROUPS.length + 1) + ': ' + gr[0] + ' are seamless and match the preview'] = async ({ browser, base, h }) => {
    const page = await fx.page(browser, base);
    await tiles(page, h, gr[1]);
    h.assert.noErrors(page);
  };
});
cases['tiles ' + (TILE_GROUPS.length + 1) + '/' + (TILE_GROUPS.length + 1) + ': depth blur reads its depth map through the tiles'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate((dc) => {
    const FX = window.LE.fx, T = window.fxT, depth = eval('(' + dc + ')')(80, 60, (x) => x);
    const src = T.card(420, 300), o = { fx: [{ type: 'depth-blur', p: { radius: 10, focus: 0.1, range: 0.1 } }], layer: { maps: { depth: { asset: 'd' } } }, assets: (id) => (id === 'd' ? depth : null) };
    return [T.png(FX.apply(src, o)), T.png(FX.apply(src, Object.assign({ tile: 128 }, o)))];
  }, depthCanvas.toString());
  await fx.same(page, Buffer.from(r[0].split(',')[1], 'base64'), Buffer.from(r[1].split(',')[1], 'base64'), 'depth-blur: one rectangle against tiles', { max: 2, over: 0.0005 });
  h.assert.noErrors(page);
};

cases['preview and export agree across scales; draft while dragging stays close; seeds are deterministic'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate((shot) => {
    const FX = window.LE.fx, T = window.fxT, full = T.card(512, 384), half = T.fit(full, 256), out = {};
    ['bloom', 'lens-blur', 'clarity', 'vignette', 'lens-flare', 'sun-rays', 'motion-blur', 'dehaze'].forEach((id) => {
      const st = [{ type: id, p: shot[id] }];
      const big = FX.apply(full, { fx: st, scale: 1 }), small = FX.apply(half, { fx: st, scale: 0.5 });
      out[id] = [T.png(T.fit(big, 256)), T.png(small)];
    });
    FX.interactive(true);
    const dr = FX.apply(full, { fx: [{ type: 'lens-blur', p: shot['lens-blur'] }], preview: true, key: 'drag' });
    FX.interactive(false);
    const fu = FX.apply(full, { fx: [{ type: 'lens-blur', p: shot['lens-blur'] }], preview: true, key: 'drag' });
    out.draft = [T.png(dr), T.png(fu)];
    const seeded = ['film-grain', 'light-leak', 'dust-scratches', 'lens-flare', 'glitch', 'texture-overlay', 'frosted-glass'];
    out.seeds = seeded.map((id) => {
      const a = Object.assign({}, shot[id], { seed: 11 }), b = Object.assign({}, shot[id], { seed: 12 });
      return [id, T.png(FX.apply(half, { fx: [{ type: id, p: a }] })), T.png(FX.apply(half, { fx: [{ type: id, p: a }] })), T.png(FX.apply(half, { fx: [{ type: id, p: b }] }))];
    });
    return out;
  }, SHOT);
  for (const id of ['bloom', 'lens-blur', 'clarity', 'vignette', 'lens-flare', 'sun-rays', 'motion-blur', 'dehaze']) {
    const d = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 12), r[id]);
    /* Sun rays come from a quarter-resolution bright pass, so their fine structure differs a little more between scales. */
    h.assert(d.mean < (id === 'sun-rays' ? 4.5 : 3) && d.over < (id === 'sun-rays' ? 0.1 : 0.06), id + ': half-resolution render against the downsampled full one: ' + JSON.stringify(d));
  }
  const dd = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 16), r.draft);
  h.assert(dd.mean < 4 && dd.over < 0.08, 'the draft while dragging is close to the refined picture: ' + JSON.stringify(dd));
  for (const s of r.seeds) {
    const same = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 0), [s[1], s[2]]);
    const other = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 2), [s[1], s[3]]);
    h.assert(same.max === 0, s[0] + ' renders identically twice');
    h.assert(other.over > 0.001, s[0] + ': another seed gives another pattern ' + JSON.stringify(other));
  }
  h.assert.noErrors(page);
};

cases['masks and adjustment layers: an entry mask, a layer mask and an adjustment layer in the studio'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT, src = T.card(256, 192);
    const px = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    const masked = FX.apply(src, { fx: [{ type: 'lens-blur', p: { radius: 10 }, mask: { parts: [{ kind: 'linear', x0: 0.55, y0: 0.5, x1: 0.45, y1: 0.5, feather: 0 }] } }] });
    const lm = FX.apply(src, { fx: [{ type: 'duotone', p: { amount: 100 } }], mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, feather: 0.01 }] } });
    return { blurL: [px(src, 30, 160), px(masked, 30, 160)], blurR: [px(src, 203, 118), px(masked, 203, 118)], inside: px(lm, 128, 96), outside: px(lm, 10, 10) };
  });
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  h.assert(dist(r.blurL[0], r.blurL[1]) <= 1, 'an entry mask keeps the left side sharp: ' + JSON.stringify(r.blurL));
  h.assert(dist(r.blurR[0], r.blurR[1]) > 4, 'and blurs the right: ' + JSON.stringify(r.blurR));
  h.assert(r.inside[3] === 255 && r.outside[3] === 0, 'the layer mask cuts the result: ' + JSON.stringify([r.inside, r.outside]));
  /* In the studio: an adjustment layer over the left half carrying a colour and a spatial effect, over a photo with its own entry. */
  const st = await h.studioWithSample(browser, base, 'desktop');
  const adj = await st.evaluate(() => {
    const s = window.LEStudio.scene, photo = s.layers()[0].id;
    s.update(photo, { fx: [{ type: 'vignette', p: { amount: -60, midpoint: 20 } }] });
    const a = s.add({ type: 'adjust', name: 'Look', x: 0, y: 0, w: 600, h: 800, fx: [{ type: 'duotone', p: { amount: 100 } }, { type: 'lens-blur', p: { radius: 6 } }] });
    s.select([]);
    return a;
  });
  await st.waitForFunction(() => window.LE.fx && window.LE.fx.draw);
  await st.waitForTimeout(900);
  await fx.attach(st);
  const grab = () => st.evaluate(async () => {
    const c = await window.LEStudio.scene.render(0.5), x = c.getContext('2d'), doc = window.LEStudio.scene.toJSON();
    const at = (a, b) => Array.from(x.getImageData(Math.round(a * c.width), Math.round(b * c.height), 1, 1).data);
    return { left: at(0.15, 0.5), right: at(0.85, 0.5), adj: doc.layers.filter((l) => l.type === 'adjust').map((l) => l.fx.map((e) => e.type)) };
  });
  const withAdj = await grab();
  await st.evaluate((id) => window.LEStudio.scene.update(id, { visible: false }), adj);
  const without = await grab();
  h.assert(JSON.stringify(withAdj.adj) === '[["duotone","lens-blur"]]', 'the adjustment layer keeps its stack: ' + JSON.stringify(withAdj.adj));
  h.assert(dist(withAdj.left, without.left) > 6, 'the adjustment layer changes what is under it: ' + JSON.stringify([withAdj.left, without.left]));
  h.assert(dist(withAdj.right, without.right) <= 1, 'and nothing outside its box: ' + JSON.stringify([withAdj.right, without.right]));
  h.assert.noErrors(page);
  h.assert.noErrors(st);
};

cases['ops: creative entries go through fx.add, fx.update, fx.reorder, fx.remove and adjust.add, clamped by the schema'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const O = window.LE.fx.ops, doc = { v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }] }, log = {};
    let s = O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'lens-flare', p: { amount: 500, position: { x: 0.2, y: 9 } } } });
    log.add = { ok: s.ok, p: s.doc.layers[0].fx[0].p, warn: s.warnings.map((w) => w.code) };
    const a = s.id;
    s = O.apply(s.doc, { op: 'fx.add', layer: 'a', entry: { type: 'film-grain', p: { amount: 30 } } });
    const b = s.id;
    s = O.apply(s.doc, { op: 'fx.update', layer: 'a', id: a, p: { ghosts: 10, seed: 4 }, blend: 'screen', amount: 0.5 });
    log.update = s.doc.layers[0].fx[0];
    s = O.apply(s.doc, { op: 'fx.reorder', layer: 'a', id: b, index: 0 });
    log.order = s.doc.layers[0].fx.map((e) => e.type);
    s = O.apply(s.doc, { op: 'fx.remove', layer: 'a', id: a });
    log.removed = s.doc.layers[0].fx.map((e) => e.type);
    s = O.apply(s.doc, { op: 'adjust.add', fx: window.LE.fx.creative.look('35mm-print'), name: '35 mm print' });
    log.look = { ok: s.ok, n: s.doc.layers[1] && s.doc.layers[1].fx.length, warn: s.warnings.length };
    log.bad = O.apply(s.doc, { op: 'fx.add', layer: 'a', entry: { type: 'lens-flare', p: { __proto__: { x: 1 }, color: 'url(evil)' } } });
    log.untouched = JSON.stringify(doc) === JSON.stringify({ v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }] });
    return log;
  });
  h.assert(r.add.ok && r.add.p.amount === 100 && r.add.p.position.y === 2 && r.add.warn.indexOf('clamped') >= 0, 'values are clamped with a warning: ' + JSON.stringify(r.add));
  h.assert(r.update.p.ghosts === 10 && r.update.p.seed === 4 && r.update.p.amount === 100 && r.update.blend === 'screen' && r.update.amount === 0.5, 'update merges parameters: ' + JSON.stringify(r.update));
  h.assert.equal(r.order.join(), 'film-grain,lens-flare', 'reorder');
  h.assert.equal(r.removed.join(), 'film-grain', 'remove');
  h.assert(r.look.ok && r.look.n === 6 && r.look.warn === 0, 'a named look becomes an adjustment layer: ' + JSON.stringify(r.look));
  h.assert(r.bad.ok && r.bad.doc.layers[0].fx.slice(-1)[0].p.color === '#ffe2b8', 'a hostile colour takes the default');
  h.assert(r.untouched, 'operations never change the input document');
  h.assert.noErrors(page);
};

/* ---------- Numeric checks against CPU references ---------- */
cases['maths 1/3: vignette, film grain, chromatic aberration, lens distortion against CPU references'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, M = FX.math, CR = FX.creative, out = {};
    const flat = (w, hh, css) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.fillStyle = css; x.fillRect(0, 0, w, hh); return c; };
    const data = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    /* Vignette, highlight priority: out = in · 2^(2·a·v) in linear light, v = CR.vignetteShape. */
    const W = 200, H = 120, g = flat(W, H, 'rgb(150,150,150)'), lin = M.srgbToLinear(150 / 255);
    out.vig = [];
    [{ amount: -60, midpoint: 30, feather: 40, roundness: 0 }, { amount: -40, midpoint: 50, feather: 20, roundness: 60 }, { amount: 50, midpoint: 20, feather: 60, roundness: -70 }].forEach((pp) => {
      const p = Object.assign(FX.defaults('vignette'), pp, { center: { x: 0.4, y: 0.55 } }), d = data(FX.apply(g, { fx: [{ type: 'vignette', p }] }));
      [[5, 5], [100, 60], [190, 110], [30, 90], [150, 20]].forEach((q) => {
        const v = CR.vignetteShape((q[0] + 0.5) / W, (q[1] + 0.5) / H, p, W / H), want = Math.round(M.linearToSrgb(Math.min(1, lin * Math.pow(2, 2 * p.amount / 100 * v))) * 255);
        out.vig.push([d[(q[1] * W + q[0]) * 4], want]);
      });
    });
    /* Film grain: density noise is zero-mean (log ratio), monochrome at colour 0, and weaker in the highlights. */
    const gstat = (css, color) => { const s = flat(256, 256, css), d = data(FX.apply(s, { fx: [{ type: 'film-grain', p: { amount: 80, size: 1.2, color, seed: 5 } }] })), b = data(s); let m = 0, v = 0, mono = 0; const n = 256 * 256;
      for (let i = 0; i < d.length; i += 4) { const l = Math.log(M.srgbToLinear(Math.max(d[i + 1], 1) / 255) / M.srgbToLinear(b[i + 1] / 255)); m += l; v += l * l; mono = Math.max(mono, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 2] - d[i + 1])); }
      return { mean: m / n, sd: Math.sqrt(v / n - (m / n) * (m / n)), mono }; };
    out.grainMid = gstat('rgb(120,120,120)', 0); out.grainHi = gstat('rgb(245,245,245)', 0); out.grainColor = gstat('rgb(120,120,120)', 60);
    /* Chromatic aberration: a white dot near a corner; the red channel's centroid moves outward by CR.caDisplacement. */
    const dot = flat(240, 160, '#000'); dot.getContext('2d').fillStyle = '#fff'; dot.getContext('2d').fillRect(198, 128, 4, 4);
    const ca = data(FX.apply(dot, { fx: [{ type: 'chromatic-aberration', p: Object.assign(FX.defaults('chromatic-aberration'), { redCyan: 100, blueYellow: -100, falloff: 2 }) }] }));
    const cen = (ch) => { let sx = 0, sy = 0, s = 0; for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) { const v = M.srgbToLinear(ca[(y * 240 + x) * 4 + ch] / 255); sx += v * x; sy += v * y; s += v; } return [sx / s, sy / s]; };
    const R = Math.hypot(120, 80), rr = Math.hypot(200 - 120, 130 - 80), k = 0.012, want = CR.caDisplacement(rr, R, k, 2) * 1.0;
    out.ca = { red: cen(0), green: cen(1), blue: cen(2), want, dir: [(200 - 120) / rr, (130 - 80) / rr] };
    /* Lens distortion: on a horizontal ramp the output at P shows the ramp value of the source point S(P). */
    const ramp = document.createElement('canvas'); ramp.width = 256; ramp.height = 128; const rx = ramp.getContext('2d'), rg = rx.createLinearGradient(0, 0, 256, 0); rg.addColorStop(0, '#000'); rg.addColorStop(1, '#fff'); rx.fillStyle = rg; rx.fillRect(0, 0, 256, 128);
    const p = Object.assign(FX.defaults('lens-distortion'), { amount: 80, edges: 'extend' }), kk = -0.8 * 0.3, s = 1, dd = data(FX.apply(ramp, { fx: [{ type: 'lens-distortion', p }] })), Rf = Math.hypot(128, 64);
    out.dist = [[20, 30], [230, 100], [128, 10], [60, 120]].map((q) => {
      const px = q[0] + 0.5, py = q[1] + 0.5, r = Math.hypot(px - 128, py - 64) / Rf, f = s * (1 + kk * Math.pow(s * r, 2)), sxp = 128 + (px - 128) * f;
      const srcVal = Math.round(255 * Math.max(0, Math.min(1, (sxp - 0.5) / 255)));
      return [dd[(q[1] * 256 + q[0]) * 4], srcVal];
    });
    out.scale = CR.distortScale(0.3);
    return out;
  });
  r.vig.forEach((v) => h.assert(Math.abs(v[0] - v[1]) <= 2, 'vignette pixel ' + v[0] + ' against the CPU reference ' + v[1]));
  h.assert(Math.abs(r.grainMid.mean) < 0.01 && r.grainMid.sd > 0.05, 'grain is zero-mean density noise: ' + JSON.stringify(r.grainMid));
  h.assert(r.grainHi.sd < r.grainMid.sd * 0.7, 'and weaker in the highlights: ' + r.grainHi.sd.toFixed(3) + ' against ' + r.grainMid.sd.toFixed(3));
  h.assert(r.grainMid.mono <= 1 && r.grainColor.mono > 8, 'monochrome at colour 0, dye clouds above it: ' + r.grainMid.mono + ', ' + r.grainColor.mono);
  const along = (c) => (c[0] - r.ca.green[0]) * r.ca.dir[0] + (c[1] - r.ca.green[1]) * r.ca.dir[1];
  h.assert(Math.abs(along(r.ca.red) - r.ca.want) < 0.6 && Math.abs(along(r.ca.blue) + r.ca.want) < 0.6, 'red and blue move by the modelled displacement (' + r.ca.want.toFixed(2) + ' px): ' + along(r.ca.red).toFixed(2) + ', ' + along(r.ca.blue).toFixed(2));
  r.dist.forEach((v) => h.assert(Math.abs(v[0] - v[1]) <= 3, 'lens distortion samples the modelled source point: ' + v));
  h.assert(Math.abs(r.scale * (1 + 0.3 * r.scale * r.scale) - 1) < 1e-6, 'auto scale solves s(1 + k s²) = 1');
  h.assert.noErrors(page);
};

cases['maths 2/3: blurs, sharpen, clarity, dehaze, haze and noise reduction against CPU references'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate((dc) => {
    const FX = window.LE.fx, M = FX.math, CR = FX.creative, out = {};
    const canvas = (w, hh, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); draw(x); return c; };
    const data = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const ext = (d, w, hh, ch) => { let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + ch] > 3) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x1 - x0 + 1, y1 - y0 + 1]; };
    /* A 3 × 3 white dot on mid-grey: a lens blur spreads it into a disc of radius R and keeps its energy (linear light). */
    /* A 5 × 5 white dot on black: a lens blur spreads it into a disc of radius R and keeps its energy (linear light). */
    const dot = canvas(256, 192, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 256, 192); x.fillStyle = '#fff'; x.fillRect(126, 94, 5, 5); });
    const energy = (c) => { const d = data(c); let s = 0; for (let i = 0; i < d.length; i += 4) s += M.srgbToLinear(d[i + 1] / 255); return s; };
    const e0 = energy(dot);
    out.lens = [8, 20].map((R) => { const c = FX.apply(dot, { fx: [{ type: 'lens-blur', p: Object.assign(FX.defaults('lens-blur'), { radius: R, curvature: 100 }) }] }); return { R, ext: ext(data(c), 256, 192, 1), e: energy(c) / e0 }; });
    const mb = data(FX.apply(canvas(256, 64, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#fff'; x.fillRect(127, 31, 2, 2); }), { fx: [{ type: 'motion-blur', p: { angle: 0, distance: 60 } }] }));
    out.motion = ext(mb, 256, 64, 0);
    /* Unsharp mask on a step edge, halo suppression off: out = L + amount·(L − G_σ ⊛ L); CPU Gaussian of the same σ. */
    const step = canvas(64, 16, (x) => { x.fillStyle = 'rgb(64,64,64)'; x.fillRect(0, 0, 32, 16); x.fillStyle = 'rgb(192,192,192)'; x.fillRect(32, 0, 32, 16); });
    const sh = data(FX.apply(step, { fx: [{ type: 'sharpen', p: { amount: 100, radius: 1.5, threshold: 0, masking: 0, halo: 0 } }] }));
    const sg = 1.5, kr = Math.ceil(sg * 3), wts = []; let ws = 0; for (let i = -kr; i <= kr; i++) { wts.push(Math.exp(-0.5 * i * i / (sg * sg))); ws += wts[wts.length - 1]; }
    const L = (x) => (x < 32 ? 64 : 192) / 255;
    out.usm = [28, 30, 31, 32, 33, 35].map((x) => { let b = 0; for (let i = -kr; i <= kr; i++) b += L(Math.min(63, Math.max(0, x + i))) * wts[i + kr] / ws; return [sh[(8 * 64 + x) * 4], Math.round(Math.min(1, Math.max(0, L(x) + (L(x) - b))) * 255)]; });
    const shh = data(FX.apply(step, { fx: [{ type: 'sharpen', p: { amount: 300, radius: 1.5, halo: 100 } }] }));
    out.halo = [Math.min.apply(null, [28, 29, 30, 31].map((x) => shh[(8 * 64 + x) * 4])), Math.max.apply(null, [32, 33, 34, 35].map((x) => shh[(8 * 64 + x) * 4]))];
    /* Clarity: a flat picture is unchanged; local contrast of a texture rises with +, falls with −; hue is kept. */
    const tex = canvas(160, 120, (x) => { for (let y = 0; y < 120; y += 8) for (let i = 0; i < 160; i += 8) { x.fillStyle = ((i + y) / 8) % 2 ? 'rgb(150,110,90)' : 'rgb(110,80,64)'; x.fillRect(i, y, 8, 8); } });
    const sd = (d) => { let m = 0, v = 0, n = 0; for (let y = 30; y < 90; y++) for (let x = 30; x < 130; x++) { const g = d[(y * 160 + x) * 4 + 1]; m += g; v += g * g; n++; } return Math.sqrt(v / n - (m / n) * (m / n)); };
    const dt = data(tex);
    const cp = data(FX.apply(tex, { fx: [{ type: 'clarity', p: { amount: 80, radius: 20 } }] })), cn = data(FX.apply(tex, { fx: [{ type: 'clarity', p: { amount: -80, radius: 20 } }] }));
    out.clarity = { before: sd(dt), plus: sd(cp), minus: sd(cn), hue: [dt[(60 * 160 + 60) * 4] / dt[(60 * 160 + 60) * 4 + 2], cp[(60 * 160 + 60) * 4] / cp[(60 * 160 + 60) * 4 + 2]] };
    const fl = canvas(96, 64, (x) => { x.fillStyle = 'rgb(120,140,90)'; x.fillRect(0, 0, 96, 64); });
    out.clarityFlat = Array.from(data(FX.apply(fl, { fx: [{ type: 'clarity', p: { amount: 100, radius: 10 } }, { type: 'texture', p: { amount: 100 } }] })).slice(4000, 4004));
    out.guided = CR.guidedAB(0.5, 0.26, 0.01);
    /* Dehaze: a bright haze half and a darker half; inside the dark half the result is the dark-channel-prior recovery with A from
       the 99th percentiles and q = min(c / A), CR.dehazePixel. */
    const hz = canvas(640, 120, (x) => { x.fillStyle = 'rgb(204,209,217)'; x.fillRect(0, 0, 320, 120); x.fillStyle = 'rgb(77,89,102)'; x.fillRect(320, 0, 320, 120); });
    out.dehaze = [0.5, -0.5].map((k) => { const d = data(FX.apply(hz, { fx: [{ type: 'dehaze', p: { amount: k * 100 } }] })), A = [204, 209, 217].map((v) => v / 255), c = [77, 89, 102].map((v) => v / 255), q = Math.min(c[0] / A[0], c[1] / A[1], c[2] / A[2]); return [Array.from(d.slice((60 * 640 + 560) * 4, (60 * 640 + 560) * 4 + 3)), CR.dehazePixel(c, A, q, k).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255))]; });
    /* Haze, even distance: Koschmieder with d = 1 in linear light. */
    const hp = FX.defaults('haze'); hp.amount = 50; hp.source = 'flat';
    const hd = data(FX.apply(fl, { fx: [{ type: 'haze', p: hp }] })), A2 = M.parseColor(hp.color).slice(0, 3).map(M.srgbToLinear);
    out.haze = [Array.from(hd.slice(0, 3)), CR.hazePixel([120, 140, 90].map((v) => M.srgbToLinear(v / 255)), A2, 1, 1).map((v) => Math.round(M.linearToSrgb(v) * 255))];
    /* Haze from a depth map: near half clear, far half fogged; no map → nothing. */
    const depth = eval('(' + dc + ')')(48, 32, (x) => (x < 0.5 ? 0 : 1)), hp2 = Object.assign({}, hp, { source: 'depth' });
    const hdd = data(FX.apply(fl, { fx: [{ type: 'haze', p: hp2 }], layer: { maps: { depth: { asset: 'd' } } }, assets: (id) => (id === 'd' ? depth : null) }));
    out.hazeDepth = [Array.from(hdd.slice((32 * 96 + 10) * 4, (32 * 96 + 10) * 4 + 3)), Array.from(hdd.slice((32 * 96 + 86) * 4, (32 * 96 + 86) * 4 + 3)), Array.from(data(FX.apply(fl, { fx: [{ type: 'haze', p: hp2 }] })).slice(0, 3))];
    /* Noise reduction: noise falls, a strong edge keeps its contrast. */
    let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const noisy = canvas(128, 64, (x) => { const id = x.createImageData(128, 64); for (let y = 0; y < 64; y++) for (let i = 0; i < 128; i++) { const b = i < 64 ? 70 : 180, k = (y * 128 + i) * 4; id.data[k] = b + (rnd() - 0.5) * 40; id.data[k + 1] = b + (rnd() - 0.5) * 40; id.data[k + 2] = b + (rnd() - 0.5) * 40; id.data[k + 3] = 255; } x.putImageData(id, 0, 0); });
    const nd = data(FX.apply(noisy, { fx: [{ type: 'noise-reduction', p: { luminance: 80, detail: 0, color: 80 } }] })), n0 = data(noisy);
    const noiseOf = (d) => { let v = 0, n = 0; for (let y = 10; y < 54; y++) for (let x = 10; x < 54; x++) { const k = (y * 128 + x) * 4, l = (d[k] + d[k + 1] + d[k + 2]) / 3, c = d[k] - d[k + 2]; v += (l - 70) * (l - 70) + c * c; n++; } return Math.sqrt(v / n); };
    const edge = (d) => { let a = 0, b = 0; for (let y = 10; y < 54; y++) { a += d[(y * 128 + 60) * 4 + 1]; b += d[(y * 128 + 67) * 4 + 1]; } return (b - a) / 44; };
    out.nr = { before: noiseOf(n0), after: noiseOf(nd), edge0: edge(n0), edge1: edge(nd) };
    return out;
  }, depthCanvas.toString());
  r.lens.forEach((l) => {
    h.assert(Math.abs(l.ext[0] - (2 * l.R + 5)) <= Math.max(3, l.R * 0.25) && Math.abs(l.ext[1] - (2 * l.R + 5)) <= Math.max(3, l.R * 0.25), 'lens blur spreads a point into a disc of radius ' + l.R + ': ' + l.ext);
    h.assert(Math.abs(l.e - 1) < 0.08, 'and keeps its light: ' + l.e.toFixed(3));
  });
  h.assert(Math.abs(r.motion[0] - 62) <= 4 && r.motion[1] <= 4, 'motion blur draws a line as long as the distance: ' + r.motion);
  r.usm.forEach((v) => h.assert(Math.abs(v[0] - v[1]) <= 4, 'unsharp mask on a step against the CPU reference: ' + v));
  h.assert(r.halo[0] >= 60 && r.halo[1] <= 197, 'halo suppression keeps the result near the local range: ' + r.halo);
  h.assert(r.clarity.plus > r.clarity.before * 1.08 && r.clarity.minus < r.clarity.before * 0.92, 'clarity raises and lowers local contrast: ' + JSON.stringify(r.clarity));
  h.assert(Math.abs(r.clarity.hue[0] - r.clarity.hue[1]) < 0.06, 'and keeps the hue: ' + r.clarity.hue);
  h.assert(Math.abs(r.clarityFlat[0] - 120) <= 1 && Math.abs(r.clarityFlat[1] - 140) <= 1, 'a flat picture is left alone: ' + r.clarityFlat);
  h.assert(Math.abs(r.guided[0] - 0.01 / 0.02) < 1e-9 && Math.abs(r.guided[1] - 0.25) < 1e-9, 'guided filter coefficients');
  r.dehaze.forEach((v) => h.assert(v[0].every((x, i) => Math.abs(x - v[1][i]) <= 5), 'dehaze inside a flat region against the CPU reference: ' + JSON.stringify(v)));
  h.assert(r.haze[0].every((x, i) => Math.abs(x - r.haze[1][i]) <= 1), 'haze follows the exponential law: ' + JSON.stringify(r.haze));
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  h.assert(near(r.hazeDepth[0], [120, 140, 90]) && r.hazeDepth[1][0] > 140 && near(r.hazeDepth[2], [120, 140, 90]), 'depth haze fogs the far half only, and nothing without a map: ' + JSON.stringify(r.hazeDepth));
  h.assert(r.nr.after < r.nr.before * 0.5 && r.nr.edge1 > r.nr.edge0 * 0.9, 'noise reduction halves the noise and keeps the edge: ' + JSON.stringify(r.nr));
  h.assert.noErrors(page);
};

cases['maths 3/3: bloom energy, depth blur, field blurs and the stylise effects against CPU references'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate((dc) => {
    const FX = window.LE.fx, M = FX.math, CR = FX.creative, T = window.fxT, out = {};
    const canvas = (w, hh, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); draw(x); return c; };
    const data = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    /* Bloom: the light added is amount/50 × the light above the threshold (normalised levels), knee 0. */
    const spot = canvas(256, 256, (x) => { x.fillStyle = 'rgb(20,20,20)'; x.fillRect(0, 0, 256, 256); x.fillStyle = 'rgb(203,203,203)'; x.fillRect(120, 120, 16, 16); });
    const sum = (d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += M.srgbToLinear(d[i + 1] / 255); return s; };
    const s0 = sum(data(spot)), b = data(FX.apply(spot, { fx: [{ type: 'bloom', p: { amount: 25, threshold: 0.1, knee: 0, radius: 24 } }] }));
    let clipped = 0; for (let i = 0; i < b.length; i += 4) if (b[i + 1] === 255) clipped++;
    out.bloom = { added: sum(b) - s0, want: 25 / 50 * 256 * (M.srgbToLinear(203 / 255) - 0.1), clipped };
    /* Depth blur: nearest half in focus stays sharp, far half blurs; a missing map leaves the picture alone. */
    const card = T.card(256, 192), dep = eval('(' + dc + ')')(64, 48, (x, y) => (y < 0.5 ? 0.9 : 0.1)), lay = { maps: { depth: { asset: 'd' } } }, as = (id) => (id === 'd' ? dep : null);
    const p = Object.assign(FX.defaults('depth-blur'), { radius: 10, focus: 0.1, range: 0.1 });
    const db = data(FX.apply(card, { fx: [{ type: 'depth-blur', p }], layer: lay, assets: as })), c0 = data(card);
    const diffRows = (a, bb, y0, y1) => { let m = 0; for (let y = y0; y < y1; y++) for (let x = 20; x < 236; x++) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a[(y * 256 + x) * 4 + k] - bb[(y * 256 + x) * 4 + k])); return m; };
    out.depth = { sharp: diffRows(db, c0, 130, 180), blurred: diffRows(db, c0, 10, 70), missing: diffRows(data(FX.apply(card, { fx: [{ type: 'depth-blur', p }] })), c0, 0, 192) };
    out.depthInv = [0, 0.2, 0.5, 0.8, 1].map((d) => CR.depthFromMask(d * d * (3 - 2 * d)));
    /* Tilt-shift: rows inside the focus band are untouched, rows far from it are blurred; CR.tiltT is the position function. */
    const ts = data(FX.apply(card, { fx: [{ type: 'tilt-shift', p: { blur: 8, center: { x: 0.5, y: 0.75 }, angle: 0, focus: 0.05, transition: 0.15 } }] }));
    out.tilt = { band: diffRows(ts, c0, 140, 148), far: diffRows(ts, c0, 50, 60), t: [CR.tiltT(0, 5, 0, 192, 0.05, 0.15), CR.tiltT(0, 100, 0, 192, 0.05, 0.15)] };
    /* Posterize and threshold: exact levels. Duotone: the ends of a grey ramp take the two colours. */
    const ramp = canvas(256, 4, (x) => { for (let i = 0; i < 256; i++) { x.fillStyle = 'rgb(' + i + ',' + i + ',' + i + ')'; x.fillRect(i, 0, 1, 4); } });
    const po = data(FX.apply(ramp, { fx: [{ type: 'posterize', p: { levels: 4 } }] })), th = data(FX.apply(ramp, { fx: [{ type: 'threshold', p: { amount: 100, level: 0.5, softness: 0 } }] }));
    out.post = [0, 40, 100, 128, 200, 255].map((i) => [po[i * 4], Math.round(Math.round(i / 255 * 3) / 3 * 255)]);
    out.thr = [100, 120, 135, 160].map((i) => [th[i * 4], i / 255 >= 0.5 ? 255 : 0]);
    const du = data(FX.apply(ramp, { fx: [{ type: 'duotone', p: { amount: 100, shadows: '#204060', highlights: '#f0d0a0' } }] }));
    out.duo = [Array.from(du.slice(0, 3)), Array.from(du.slice(255 * 4, 255 * 4 + 3))];
    /* Halftone: ink coverage over many cells equals 1 − luminance (an amplitude-modulated screen). */
    out.half = [64, 128, 192].map((v) => { const f = canvas(240, 240, (x) => { x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.fillRect(0, 0, 240, 240); }); const d = data(FX.apply(f, { fx: [{ type: 'halftone', p: { amount: 100, style: 'dot', size: 12, softness: 0, ink: '#000000', paper: '#ffffff' } }] })); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i + 1] / 255; return [s / (d.length / 4), v / 255]; });
    /* Pixelate: every cell is flat and holds the average of the source under it. */
    const px = data(FX.apply(card, { fx: [{ type: 'pixelate', p: { size: 16 } }] }));
    let flatWorst = 0, avgWorst = 0;
    for (let cy = 0; cy < 12; cy++) for (let cx = 0; cx < 16; cx++) { const v0 = px[((cy * 16 + 8) * 256 + cx * 16 + 8) * 4 + 1]; let s = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const k = ((cy * 16 + y) * 256 + cx * 16 + x) * 4 + 1; flatWorst = Math.max(flatWorst, Math.abs(px[k] - v0)); s += c0[k]; } avgWorst = Math.max(avgWorst, Math.abs(v0 - s / 256)); }
    out.pix = { flatWorst, avgWorst };
    /* Flare and light leak follow their position: the centroid of the added light moves with the point. */
    const black = canvas(256, 192, (x) => { x.fillStyle = '#101010'; x.fillRect(0, 0, 256, 192); });
    const centroid = (id, pos) => { const p2 = Object.assign(FX.defaults(id), { amount: 80, position: pos }); const d = data(FX.apply(black, { fx: [{ type: id, p: p2 }] })); let sx = 0, sy = 0, s = 0; for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) { const v = Math.max(0, d[(y * 256 + x) * 4 + 1] - 16); sx += v * x; sy += v * y; s += v; } return [sx / s / 256, sy / s / 192]; };
    out.leak = [centroid('light-leak', { x: 0.2, y: 0.3 }), centroid('light-leak', { x: 0.8, y: 0.7 })];
    out.glow = [centroid('sun-glow', { x: 0.2, y: 0.3 }), centroid('sun-glow', { x: 0.8, y: 0.7 })];
    return out;
  }, depthCanvas.toString());
  h.assert(Math.abs(r.bloom.added / r.bloom.want - 1) < 0.1 && r.bloom.clipped === 0, 'bloom adds amount/50 × the light above the threshold: ' + JSON.stringify(r.bloom));
  h.assert(r.depth.sharp <= 2 && r.depth.blurred > 20 && r.depth.missing <= 1, 'depth blur: in-focus part sharp, far part blurred, no map no change: ' + JSON.stringify(r.depth));
  r.depthInv.forEach((v, i) => h.assert(Math.abs(v - [0, 0.2, 0.5, 0.8, 1][i]) < 1e-6, 'the depth read-back inverts the mask curve'));
  h.assert(r.tilt.band <= 2 && r.tilt.far > 20 && r.tilt.t[0] === 0 && r.tilt.t[1] === 1, 'tilt-shift keeps the band and blurs far rows: ' + JSON.stringify(r.tilt));
  r.post.forEach((v) => h.assert(Math.abs(v[0] - v[1]) <= 1, 'posterize level ' + v));
  r.thr.forEach((v) => h.assert(v[0] === v[1], 'threshold ' + v));
  h.assert(Math.abs(r.duo[0][0] - 0x20) <= 2 && Math.abs(r.duo[0][2] - 0x60) <= 2 && Math.abs(r.duo[1][0] - 0xf0) <= 2 && Math.abs(r.duo[1][2] - 0xa0) <= 2, 'duotone ends: ' + JSON.stringify(r.duo));
  r.half.forEach((v) => h.assert(Math.abs(v[0] - v[1]) < 0.06, 'halftone coverage ' + v[0].toFixed(3) + ' for tone ' + v[1].toFixed(3)));
  h.assert(r.pix.flatWorst <= 1 && r.pix.avgWorst <= 3, 'pixelate cells are flat averages: ' + JSON.stringify(r.pix));
  h.assert(r.leak[1][0] - r.leak[0][0] > 0.2 && r.leak[1][1] - r.leak[0][1] > 0.08, 'the light leak follows its position: ' + JSON.stringify(r.leak));
  h.assert(Math.abs(r.glow[0][0] - 0.2) < 0.12 && Math.abs(r.glow[1][1] - 0.7) < 0.12, 'the sun glow is centred on its position: ' + JSON.stringify(r.glow));
  h.assert.noErrors(page);
};

module.exports = cases;
