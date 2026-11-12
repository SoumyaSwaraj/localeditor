'use strict';
/* Effect pack X3 (assets/js/fx/le-fx-composite.js): shadows, reflections and compositing.
   Registry and schema, neutral at defaults, goldens, tiles and preview against export, CPU references for the core maths
   (projection, linear-light shadow multiply, Oklab transfer, edge shift, long-shadow length, mirror, blend formulas, blend-if),
   masks, adjustment layers, the draw-time (scene) effects in the studio, ops round trips and the agent helpers.
   Goldens: tests/golden/fx/composite-*.png (FX_GOLDEN=create node tests/run.js fx-composite writes missing ones). */
const fx = require('./lib/fx');

const IDS = ['cast-shadow', 'contact-shadow', 'floating-shadow', 'studio-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'edge-light', 'long-shadow',
  'floor-reflection', 'water-reflection', 'glass-reflection', 'refine-edge', 'match-color', 'ambient-light', 'light-wrap', 'blend-options', 'apply-image', 'displace', 'mesh-warp'];
const SCENE_ONLY = ['light-wrap', 'blend-options', 'apply-image', 'displace'];
const A = { x: 0.5, y: 0.925 };

/* In-page helpers: test subjects on transparency and a render that returns a PNG data URL. */
function helpers() {
  const T = window.cmpT = {};
  T.bottle = (w, h, fringe) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(w * 0.3, 0, w * 0.7, 0); g.addColorStop(0, '#7a1d12'); g.addColorStop(0.45, '#e8573a'); g.addColorStop(1, '#5a140c');
    x.fillStyle = g;
    const bx = w * 0.3, bw = w * 0.4, top = h * 0.35, base = h * 0.925;
    x.beginPath(); x.moveTo(bx, base); x.lineTo(bx, top + w * 0.08); x.quadraticCurveTo(bx, top, bx + bw * 0.3, top - h * 0.05); x.lineTo(bx + bw * 0.38, h * 0.12); x.lineTo(bx + bw * 0.62, h * 0.12); x.lineTo(bx + bw * 0.7, top - h * 0.05); x.quadraticCurveTo(bx + bw, top, bx + bw, top + w * 0.08); x.lineTo(bx + bw, base); x.closePath(); x.fill();
    x.fillStyle = '#20242a'; x.fillRect(bx + bw * 0.36, h * 0.07, bw * 0.28, h * 0.06);
    x.fillStyle = '#f3ead8'; x.fillRect(bx + bw * 0.08, h * 0.55, bw * 0.84, h * 0.2);
    if (fringe) { x.globalCompositeOperation = 'destination-over'; x.strokeStyle = 'rgba(40,200,60,0.6)'; x.lineWidth = 3; x.strokeRect(bx - 1, top, bw + 2, base - top); x.globalCompositeOperation = 'source-over'; }
    return c;
  };
  /* A cut-out mask as the background remover stores it: white where the subject is, transparent elsewhere. */
  T.mask = (w, h) => { const c = T.bottle(w, h), x = c.getContext('2d'); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); return c; };
  T.shape = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
  T.src = (o) => o.card ? window.fxT.card(o.card[0], o.card[1], !!o.alpha) : T.bottle(o.w || 120, o.h || 150, o.fringe);
  T.render = (o) => window.LE.fx.apply(T.src(o), { fx: o.fx || [], mask: o.mask || null, tile: o.tile || 0, scale: o.scale || 1 });
  T.alphaAt = (c, x, y) => c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
  T.px = (c, x, y) => Array.from(c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data);
}
async function page(browser, base, opts) {
  const pg = await fx.page(browser, base, opts);
  await pg.addScriptTag({ content: '(' + helpers.toString() + ')()' });
  return pg;
}
async function shot(pg, o) {
  const url = await pg.evaluate((o) => {
    const FX = window.LE.fx;
    if (o.interactive != null) FX.interactive(!!o.interactive);
    try { return window.cmpT.render(o).toDataURL('image/png'); } finally { if (o.interactive != null) FX.interactive(false); }
  }, o);
  return Buffer.from(url.split(',')[1], 'base64');
}
async function studio(h, browser, base) {
  const pg = await h.studioWithSample(browser, base, 'desktop');
  await pg.evaluate(() => window.LE.fxBoot.load());
  await pg.addScriptTag({ content: '(' + helpers.toString() + ')()' });
  return pg;
}

const cases = {};

cases['registry: every effect is registered with a complete schema, ui and agent descriptor, and the helpers exist'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate((ids) => {
    const FX = window.LE.fx, C = FX.composite, d = FX.describe().filter((e) => ids.indexOf(e.id) >= 0);
    const ex = d.map((e) => { const v = FX.validate(e.agent.example); return { id: e.id, ok: v.ok, clamped: v.warnings.filter((w) => w.code !== 'unknown-key').map((w) => w.path + ' ' + w.code) }; });
    return { list: C.list(), d, ex, api: ['contact', 'match', 'matchNoise', 'quadFromPlane', 'shadowFromVanishing', 'stage', 'presets', 'blendModes', 'blend', 'blendIf', 'transfer', 'meshIdentity', 'meshCylinder', 'planeAspect'].filter((k) => !C[k]), json: JSON.stringify(d).length, sch: FX.schema().paramTypes };
  }, IDS);
  h.assert.equal(r.list.slice().sort().join(), IDS.slice().sort().join(), 'the pack registers exactly its effects');
  const SECTIONS = ['Light', 'Colour', 'Curves', 'Colour mixer', 'Colour grading', 'Detail', 'Optics', 'Geometry', 'Effects', 'Shadows & reflections', 'Compositing', 'Retouch'];
  r.d.forEach((e) => {
    h.assert(e.version >= 1 && e.name && (e.space === 'linear' || e.space === 'display'), e.id + ' basics');
    h.assert(SECTIONS.indexOf(e.ui.section) >= 0, e.id + ' section ' + e.ui.section);
    h.assert(e.agent.summary && e.agent.tips.length >= 1 && e.agent.example.type === e.id, e.id + ' agent descriptor');
    h.assert(e.support.needs.indexOf('webgl2') >= 0, e.id + ' support');
    Object.keys(e.params).forEach((k) => { const s = e.params[k]; h.assert(r.sch.indexOf(s.type) >= 0 && s.label, e.id + '.' + k); if (s.type === 'number') h.assert(s.default >= s.min && s.default <= s.max && s.step > 0, e.id + '.' + k + ' range'); });
    (e.ui.controls || []).forEach((c) => h.assert(typeof c === 'string' ? !!e.params[c] : (c.heading || !!e.params[c.param] || (c.control === 'line' && c.params.every((p) => e.params[p]))), e.id + ' control ' + JSON.stringify(c)));
  });
  r.ex.forEach((x) => h.assert(x.ok && !x.clamped.length, 'the agent example of ' + x.id + ' is valid as written: ' + x.clamped));
  h.assert(!r.api.length, 'LE.fx.composite helpers missing: ' + r.api);
  h.assert(r.json < 70000, 'the pack describes itself in ' + r.json + ' bytes');
  h.assert.noErrors(pg);
};

cases['neutral: every effect at its defaults is pixel-identical to no effect and grows nothing'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  for (const src of [{ w: 120, h: 150 }, { card: [128, 96], alpha: true }]) {
    const none = await shot(pg, Object.assign({ fx: [] }, src));
    for (const id of IDS) {
      const one = await shot(pg, Object.assign({ fx: [{ type: id }] }, src));
      await fx.same(pg, none, one, id + ' at defaults', { max: 1, over: 0 });
    }
    const all = await pg.evaluate((ids) => ids.map((id) => ({ type: id, p: window.LE.fx.defaults(id) })), IDS);
    await fx.same(pg, none, await shot(pg, Object.assign({ fx: all }, src)), 'the whole pack at defaults', { max: 1, over: 0 });
  }
  const grow = await pg.evaluate((ids) => ids.map((id) => { const d = window.LE.fx.get(id), p = window.LE.fx.defaults(id); return [id, d.grow ? d.grow(p, 1) : 0, d.radius(p, 1)]; }).filter((x) => x[1] || x[2]), IDS);
  h.assert(!grow.length, 'no grow or radius at defaults: ' + JSON.stringify(grow));
  h.assert.noErrors(pg);
};

const GOLD = {
  'cast-shadow': [{ type: 'cast-shadow', p: { opacity: 0.65, direction: 320, elevation: 40, blurNear: 1, blurFar: 12, height: 130, anchor: A } }],
  'cast-shadow-toward': [{ type: 'cast-shadow', p: { opacity: 0.6, direction: 60, elevation: 40, blurNear: 1, blurFar: 10, height: 130, perspective: 0.5, anchor: A, color: '#203050', clip: true, clipY: 0.95, clipSoft: 1 } }],
  'contact-shadow': [{ type: 'contact-shadow', p: { opacity: 0.9, distance: 6, softness: 3, anchor: A } }],
  'floating-shadow': [{ type: 'floating-shadow', p: { opacity: 0.6, height: 20, width: 60, anchor: A } }],
  'studio-shadow': [{ type: 'studio-shadow', p: { opacity: 0.5, angle: 110, distance: 8, size: 10, layers: 3, noise: 0.2, seed: 3 } }],
  'inner-shadow': [{ type: 'inner-shadow', p: { opacity: 0.8, distance: 4, size: 4 } }],
  'glows': [{ type: 'outer-glow', p: { opacity: 0.9, size: 8, color: '#40a0ff' } }, { type: 'inner-glow', p: { opacity: 0.5, size: 5 } }],
  'edge-light': [{ type: 'edge-light', p: { intensity: 1.5, angle: 140, width: 3, softness: 2 } }],
  'long-shadow': [{ type: 'long-shadow', p: { opacity: 0.4, angle: 135, length: 60, fade: 0.5, color: '#1d3557', receive: 'normal' } }],
  'floor-reflection': [{ type: 'floor-reflection', p: { opacity: 0.5, distance: 80, roughness: 0.3, ripple: 0.3, waveSize: 8, anchor: A } }],
  'water-reflection': [{ type: 'water-reflection', p: { opacity: 0.7, distance: 120, anchor: A, seed: 5 } }],
  'glass-reflection': [{ type: 'glass-reflection', p: { amount: 0.5, bands: 3, seed: 2 } }],
  'refine-edge': [{ type: 'refine-edge', p: { smooth: 1, shift: -1, decontaminate: 1, defringe: 3 } }],
  'colour': [{ type: 'match-color', p: { strength: 80, srcL: 0.55, dstL: 0.62, dstB: 0.05, scaleL: 0.8 } }, { type: 'ambient-light', p: { amount: 0.3, color: '#7fb0ff', fill: 0.2 } }],
  'mesh-warp': [{ type: 'mesh-warp', p: { size: 150, p01: { x: 0.333, y: -0.08 }, p02: { x: 0.667, y: -0.08 }, p31: { x: 0.333, y: 1.08 }, p32: { x: 0.667, y: 1.08 } } }]
};
cases['goldens: shadows, glows and layer styles at 120 × 150'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  for (const n of ['cast-shadow', 'cast-shadow-toward', 'contact-shadow', 'floating-shadow', 'studio-shadow', 'inner-shadow', 'glows', 'edge-light', 'long-shadow']) await fx.golden(pg, 'composite-' + n, await shot(pg, { fx: GOLD[n], fringe: false }));
  h.assert.noErrors(pg);
};
cases['goldens: reflections, edges, colour and the mesh at 120 × 150'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  for (const n of ['floor-reflection', 'water-reflection', 'glass-reflection', 'colour', 'mesh-warp']) await fx.golden(pg, 'composite-' + n, await shot(pg, { fx: GOLD[n] }));
  await fx.golden(pg, 'composite-refine-edge', await shot(pg, { fx: GOLD['refine-edge'], fringe: true }));
  h.assert.noErrors(pg);
};

cases['tiles: projected shadows, reflections and edge work are seamless with small tiles; renders are deterministic'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const stacks = {
    cast: GOLD['cast-shadow'], toward: GOLD['cast-shadow-toward'], reflection: GOLD['floor-reflection'], water: GOLD['water-reflection'],
    styles: [{ type: 'refine-edge', p: { smooth: 1, shift: 1, decontaminate: 0.5 } }, GOLD['contact-shadow'][0], GOLD['studio-shadow'][0], GOLD['long-shadow'][0]],
    mesh: GOLD['mesh-warp']
  };
  const small = (e) => JSON.parse(JSON.stringify(e).replace(/"height":130/g, '"height":90').replace(/"distance":80/g, '"distance":50').replace(/"distance":120/g, '"distance":60'));
  for (const k of Object.keys(stacks)) {
    const st0 = { fx: small(stacks[k]), w: 80, h: 100 };
    const one = await shot(pg, st0), many = await shot(pg, Object.assign({ tile: 128 }, st0));
    const st = await pg.evaluate(() => window.LE.fx.status().stats.tiles);
    await fx.same(pg, one, many, k + ': one rectangle against 128-pixel tiles', { max: 2, over: 0.0005 });
    await fx.same(pg, one, await shot(pg, st0), k + ': a second render', { max: 0, over: 0 });
    h.assert(st > 2, 'tiled for real (' + st + ')');
  }
  h.assert.noErrors(pg);
};

cases['preview and export agree, and draft rendering stays close'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const stack = [{ type: 'floor-reflection', p: Object.assign({}, GOLD['floor-reflection'][0].p, { distance: 50, ripple: 0 }) }, GOLD['contact-shadow'][0], { type: 'cast-shadow', p: Object.assign({}, GOLD['cast-shadow'][0].p, { height: 130, blurFar: 10 }) }];
  const r = await pg.evaluate((stack) => {
    const T = window.cmpT, FX = window.LE.fx, full = T.bottle(120, 150), half = window.fxT.fit(full, 75);
    const big = FX.apply(full, { fx: stack, scale: 1 }), small = FX.apply(half, { fx: stack, scale: 0.5 });
    /* Lengths are document pixels: compare the layer box plus 40 document pixels around it. */
    const cut = (c, k) => { const o = document.createElement('canvas'); o.width = 80; o.height = 95; const x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; const m = 20 * k, pd = c._fx.padPx; x.drawImage(c, pd - m, pd - m, 120 * k + 2 * m, 150 * k + 2 * m, 0, 0, 80, 95); return o.toDataURL(); };
    FX.interactive(true);
    const draft = FX.apply(full, { fx: stack, scale: 1, preview: true });
    FX.interactive(false);
    return { a: cut(big, 1), b: cut(small, 0.5), d: cut(draft, 1), pads: [big._fx.pad, small._fx.pad] };
  }, stack);
  h.assert(Math.abs(r.pads[0] - r.pads[1]) <= 8, 'padding in document pixels: ' + r.pads);
  const d = await pg.evaluate(([a, b]) => window.fxT.diff(a, b, 12), [r.a, r.b]);
  h.assert(d.mean < 2.5 && d.over < 0.06, 'half resolution (a 60 × 75 bottle) against full: ' + JSON.stringify(d));
  const dd = await pg.evaluate(([a, b]) => window.fxT.diff(a, b, 16), [r.a, r.d]);
  h.assert(dd.mean < 3 && dd.over < 0.06, 'draft against full: ' + JSON.stringify(dd));
  h.assert.noErrors(pg);
};

cases['maths: the cast shadow lands where the projection says, the linear multiply is right, the Oklab transfer matches the CPU'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const T = window.cmpT, FX = window.LE.fx, C = FX.composite, M = FX.math;
    /* A pole 4 px wide standing at (50, 180) on a 100 × 200 box; light from the left at 45°, shadow along azimuth 30°. */
    /* A pole 12 px wide standing at (50, 180) on a 100 × 200 box; the shadow at azimuth φ lands at O + h·(cos φ, 0.3·sin φ)/tan 45°. */
    const pole = T.shape(100, 200, (x) => { x.fillStyle = '#000'; x.fillRect(44, 40, 12, 140); });
    const probe = [], subj = [];
    [90, 60].forEach((dir) => {
      const p = { opacity: 1, direction: dir, elevation: 45, ground: 0.3, perspective: 0, blurNear: 0, blurFar: 0, fade: 0, height: 140, anchor: { x: 0.5, y: 0.9 }, receive: 'normal', only: true };
      const out = FX.apply(pole, { fx: [{ type: 'cast-shadow', p }] }), pad = out._fx.padPx;
      const ax = Math.cos(dir * Math.PI / 180), ay = 0.3 * Math.sin(dir * Math.PI / 180);
      /* On the projected point, and 14 px to either side across the stripe (the pole is 12 px wide). */
      [20, 60, 100].forEach((hh) => { const X = 50 + hh * ax, Y = 180 + hh * ay; probe.push([dir, hh, T.alphaAt(out, pad + X, pad + Y), T.alphaAt(out, pad + X - 14, pad + Y), T.alphaAt(out, pad + X + 14, pad + Y)]); });
      subj.push(T.alphaAt(out, pad + 50, pad + 100));
    });
    const subjGone = Math.max.apply(null, subj);
    /* Linear multiply: a flat shadow of strength 0.5 (floating shadow at height 0, core 0) over three greys. */
    const sq = T.shape(200, 200, (x) => { x.fillStyle = '#888'; x.fillRect(90, 90, 20, 20); });
    const sh = FX.apply(sq, { fx: [{ type: 'floating-shadow', p: { opacity: 0.5, height: 0, width: 160, aspect: 1, softness: 0, core: 0, anchor: { x: 0.5, y: 0.5 }, only: true } }] });
    const lin = [0.15, 0.45, 0.85].map((g) => {
      const c = T.shape(sh.width, sh.height, (x, w, hh) => { x.fillStyle = 'rgb(' + [g, g, g].map((v) => Math.round(v * 255)) + ')'; x.fillRect(0, 0, w, hh); x.drawImage(sh, 0, 0); });
      const got = T.px(c, sh.width / 2, sh.height / 2)[0] / 255, want = M.linearToSrgb(M.srgbToLinear(Math.round(g * 255) / 255) * 0.5);
      return [g, got, want];
    });
    const tint = T.shape(sh.width, sh.height, (x, w, hh) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(FX.apply(sq, { fx: [{ type: 'floating-shadow', p: { opacity: 0.6, height: 0, width: 160, aspect: 1, softness: 0, core: 0, color: '#3060c0', anchor: { x: 0.5, y: 0.5 }, only: true } }] }), 0, 0); });
    const tc = M.parseColor('#3060c0'), tw = T.px(tint, sh.width / 2, sh.height / 2).slice(0, 3).map((v) => v / 255), tWant = [0, 1, 2].map((i) => M.linearToSrgb(1 - 0.6 * (1 - M.srgbToLinear(tc[i]))));
    /* Oklab transfer: patches through the shader against C.transfer. */
    const cols = ['#20324f', '#c98d5a', '#e23b3b', '#3bbf5a', '#f4e9d8', '#777777'];
    const pat = T.shape(cols.length * 8, 8, (x) => cols.forEach((c, i) => { x.fillStyle = c; x.fillRect(i * 8, 0, 8, 8); }));
    const mp = { strength: 85, luminance: 70, color: 100, srcL: 0.55, srcA: 0.01, srcB: 0.02, dstL: 0.62, dstA: -0.01, dstB: 0.06, scaleL: 0.8, scaleA: 1.2, scaleB: 0.9 };
    const mo = FX.apply(pat, { fx: [{ type: 'match-color', p: mp }] });
    const err = cols.map((c, i) => { const q = M.parseColor(c), want = C.transfer(q.slice(0, 3).map(M.srgbToLinear), mp).map((v) => M.clamp(M.linearToSrgb(v), 0, 1) * 255), got = T.px(mo, i * 8 + 4, 4); return Math.max.apply(null, want.map((v, k) => Math.abs(v - got[k]))); });
    return { probe, subjGone, lin, tw, tWant, err };
  });
  r.probe.forEach((p) => h.assert(p[2] > 240 && p[3] < 15 && p[4] < 15, 'the shadow of the point at height ' + p[1] + ' (azimuth ' + p[0] + ') is at its projection and not beside it: ' + p));
  h.assert(r.subjGone === 0, 'shadow-only output leaves the subject out');
  r.lin.forEach((x) => h.assert(Math.abs(x[1] - x[2]) < 0.025, 'a 50 % shadow is a linear-light multiply by 0.5 over grey ' + x[0] + ': ' + x[1].toFixed(3) + ' against ' + x[2].toFixed(3)));
  r.tw.forEach((v, i) => h.assert(Math.abs(v - r.tWant[i]) < 0.02, 'a tinted shadow multiplies white by the tint in linear light: ' + r.tw + ' / ' + r.tWant));
  h.assert(Math.max.apply(null, r.err) <= 2, 'match-color equals the CPU Oklab transfer: ' + r.err);
  h.assert.noErrors(pg);
};

cases['maths: edge shift, long-shadow length, the mirror and the mesh identity'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const T = window.cmpT, FX = window.LE.fx, C = FX.composite;
    const disc = T.shape(120, 120, (x) => { x.fillStyle = '#c04020'; x.beginPath(); x.arc(60, 60, 40, 0, 7); x.fill(); });
    const radius = (c) => { const pad = c._fx.padPx, d = c.getContext('2d').getImageData(0, pad + 60, c.width, 1).data; let last = -1; for (let i = 0; i < c.width; i++) if (d[i * 4 + 3] >= 128) last = i; return last + 1 - pad - 60; };
    const rs = [-5, 0, 5].map((s) => radius(FX.apply(disc, { fx: [{ type: 'refine-edge', p: { shift: s, smooth: s ? 0 : 2 } }] })));
    const inside = T.px(FX.apply(disc, { fx: [{ type: 'refine-edge', p: { shift: -3, smooth: 1 } }] }), 60, 60);
    /* Shift out takes the colour of the interior, not black. */
    const grown = FX.apply(disc, { fx: [{ type: 'refine-edge', p: { shift: 5 } }] }), gp = T.px(grown, grown._fx.padPx + 60 + 43, grown._fx.padPx + 60);
    const sq = T.shape(100, 100, (x) => { x.fillStyle = '#000'; x.fillRect(40, 40, 10, 10); });
    const ls = FX.apply(sq, { fx: [{ type: 'long-shadow', p: { opacity: 1, angle: 0, length: 30, receive: 'normal', only: true } }] }), lp = ls._fx.padPx;
    const len = [T.alphaAt(ls, lp + 40 - 28, lp + 45), T.alphaAt(ls, lp + 40 - 33, lp + 45), T.alphaAt(ls, lp + 52, lp + 45)];
    const bands = T.shape(60, 100, (x) => { ['#d02020', '#20a040', '#2040d0', '#e0c020'].forEach((c, i) => { x.fillStyle = c; x.fillRect(0, 50 + i * 10, 60, 10); }); });
    const rf = FX.apply(bands, { fx: [{ type: 'floor-reflection', p: { opacity: 1, distance: 2000, blur: 0, roughness: 0, fresnel: 0, anchor: { x: 0.5, y: 0.9 }, only: true } }] }), rp = rf._fx.padPx;
    const mirror = [5, 15, 25].map((d) => [T.px(bands, 30, 90 - d), T.px(rf, rp + 30, rp + 90 + d)]);
    const id = FX.apply(disc, { fx: [{ type: 'mesh-warp', p: Object.assign(C.meshIdentity(), { size: 120, p11: { x: 0.3334, y: 0.3333 } }) }] });
    const bez = C.bezierPatch(Object.values(C.meshCylinder(0.1)).map((q) => [q.x, q.y]), 0.5, 0);
    return { rs, inside, gp, len, mirror, idSame: window.fxT.png(id) === window.fxT.png(disc) || null, idPx: [T.px(id, id._fx.padPx + 60, id._fx.padPx + 60), T.px(disc, 60, 60), T.px(id, id._fx.padPx + 21, id._fx.padPx + 60), T.px(disc, 21, 60)], bez };
  });
  h.assert(Math.abs(r.rs[1] - 40) <= 1 && Math.abs(r.rs[0] - 35) <= 1.2 && Math.abs(r.rs[2] - 45) <= 1.2, 'shift edge moves the 50 % contour by the shift: ' + r.rs);
  h.assert(r.inside[3] === 255, 'the interior stays opaque after a negative shift: ' + r.inside);
  h.assert(r.gp[3] > 200 && r.gp[0] > 120 && r.gp[1] < 100, 'grown edge takes the interior colour: ' + r.gp);
  h.assert(r.len[0] > 240 && r.len[1] < 10 && r.len[2] < 10, 'a 30 px long shadow ends at 30 px, on the far side of the light: ' + r.len);
  r.mirror.forEach((m) => h.assert(m[0].slice(0, 3).every((v, i) => Math.abs(v - m[1][i]) <= 4), 'the reflection mirrors about the contact line: ' + JSON.stringify(m)));
  h.assert(r.idPx[0].every((v, i) => Math.abs(v - r.idPx[1][i]) <= 1) && r.idPx[2].every((v, i) => Math.abs(v - r.idPx[3][i]) <= 2), 'a near-identity net leaves the picture in place: ' + JSON.stringify(r.idPx));
  h.assert(r.bez[1] < -0.09, 'the cylinder net bulges the top edge: ' + r.bez);
  h.assert.noErrors(pg);
};

cases['masks: an entry mask limits a silhouette effect; the layer mask shapes what casts the shadow'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const T = window.cmpT, FX = window.LE.fx;
    const pole = T.shape(100, 200, (x) => { x.fillStyle = '#000'; x.fillRect(44, 40, 12, 140); });
    const p = { opacity: 1, direction: 90, elevation: 45, ground: 0.3, perspective: 0, blurNear: 0, blurFar: 0, fade: 0, height: 140, anchor: { x: 0.5, y: 0.9 }, receive: 'normal' };
    const at = (c, X, Y) => T.alphaAt(c, c._fx.padPx + X, c._fx.padPx + Y);
    /* Direction 90: the shadow falls toward the camera, a stripe from y = 180 to 180 + 0.3 × 140 = 222. */
    const plain = FX.apply(pole, { fx: [{ type: 'cast-shadow', p }] });
    const masked = FX.apply(pole, { fx: [{ type: 'cast-shadow', p, mask: { parts: [{ kind: 'linear', x0: 0.5, y0: 0.97, x1: 0.5, y1: 1.0, feather: 0 }] } }] });
    const lmask = FX.apply(pole, { fx: [{ type: 'cast-shadow', p }], mask: { parts: [{ kind: 'linear', x0: 0.5, y0: 0.6, x1: 0.5, y1: 0.55, feather: 0 }] } });
    return { plain: [at(plain, 50, 186), at(plain, 50, 215)], masked: [at(masked, 50, 186), at(masked, 50, 215), at(masked, 50, 120)], lmask: [at(lmask, 50, 190), at(lmask, 50, 215), at(lmask, 50, 60)] };
  });
  h.assert(r.plain[0] > 240 && r.plain[1] > 240, 'the shadow falls toward the camera: ' + r.plain);
  h.assert(r.masked[0] > 150 && r.masked[1] < 60 && r.masked[2] === 255, 'an entry mask keeps the effect inside it (and the subject): ' + r.masked);
  h.assert(r.lmask[0] > 150 && r.lmask[1] < 30 && r.lmask[2] === 0, 'the layer mask hides the top of the pole, so its far shadow goes too: ' + r.lmask);
  h.assert.noErrors(pg);
};

cases['studio: blend modes and blend-if match the CPU formulas at draw time; light wrap, apply image, displace and an adjustment layer work'] = async ({ browser, base, h }) => {
  const pg = await studio(h, browser, base);
  const MODES = ['multiply', 'linear-burn', 'color-burn', 'screen', 'linear-dodge', 'overlay', 'soft-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity', 'darker-color', 'lighter-color'];
  const r = await pg.evaluate(async (MODES) => {
    const FX = window.LE.fx, C = FX.composite, s = window.LEStudio.scene, out = {};
    const B = '#5a8cc8', S = '#d0602a', b = FX.math.parseColor(B).slice(0, 3), sv = FX.math.parseColor(S).slice(0, 3);
    const load = (top, extra) => s.load({ v: 1, width: 200, height: 100, background: { type: 'color', color: '#ffffff' }, layers: [
      { id: 'bg', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, fill: { type: 'linear', angle: 0, colors: ['#000000', '#ffffff'] } },
      { id: 'flat', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, fill: { type: 'solid', color: B } },
      Object.assign({ id: 'top', type: 'shape', shape: 'rect', x: 20, y: 20, w: 160, h: 60, fill: { type: 'solid', color: S } }, top)
    ].concat(extra || []) });
    const px = async (x, y) => { const c = await s.render(1); return Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data); };
    out.modes = [];
    for (const m of MODES) {
      load({ fx: [{ type: 'blend-options', p: { mode: m } }] });
      out.modes.push([m, await px(50, 50), C.blend(m, b, sv).map((v) => Math.round(FX.math.clamp(v, 0, 1) * 255))]);
    }
    /* Blend-if on the underlying layer: the gradient backdrop on the right half; the layer shows only where the backdrop is darker than 100–140. */
    const xs = [104, 120, 130, 160];
    load({ visible: false });
    const bd = []; for (const x of xs) bd.push(await px(x, 50));
    load({ fx: [{ type: 'blend-options', p: { underHi0: 100, underHi1: 140 } }] });
    out.bif = [];
    for (let i = 0; i < xs.length; i++) { const got = await px(xs[i], 50), g = bd[i][0], w = C.blendIf(g / 255, 0, 0, 100, 140); out.bif.push([got[0], Math.round(g + (208 - g) * w), g]); }
    load({ fx: [{ type: 'blend-options', p: { fill: 40 } }] });
    out.fill = await px(50, 50);
    load({ fx: [{ type: 'apply-image', p: { opacity: 1, source: 'backdrop', channel: 'luma', mode: 'multiply' } }] });
    out.apply = [await px(150, 50), await px(195, 50), await px(25, 50)];
    load({ fill: { type: 'solid', color: '#202020' }, fx: [{ type: 'light-wrap', p: { amount: 1, width: 6, blur: 6 } }] });
    out.wrap = [await px(178, 50), await px(100, 50)];
    load({ fx: [{ type: 'displace', p: { x: 15, y: 0, map: 'backdrop', smooth: 0 } }] });
    out.disp = [await px(22, 50), await px(178, 50)];
    /* An adjustment layer carrying a colour effect of this pack over a flat colour. */
    const mp = { strength: 100, srcL: 0.5, dstL: 0.7, dstB: 0.05 };
    load({}, [{ id: 'adj', type: 'adjust', fx: [{ type: 'match-color', p: mp }] }]);
    const full = Object.assign(FX.defaults('match-color'), mp), want = C.transfer(b.map(FX.math.srgbToLinear), full).map((v) => Math.round(FX.math.clamp(FX.math.linearToSrgb(v), 0, 1) * 255));
    out.adj = [await px(10, 10), want];
    return out;
  }, MODES);
  r.modes.forEach((m) => h.assert(m[1].slice(0, 3).every((v, i) => Math.abs(v - m[2][i]) <= 3), m[0] + ' at draw time ' + m[1] + ' against the formula ' + m[2]));
  r.bif.forEach((b) => h.assert(Math.abs(b[0] - b[1]) <= 4, 'blend-if on the underlying luminance (got, expected, backdrop): ' + JSON.stringify(r.bif)));
  h.assert(Math.abs(r.fill[0] - Math.round(0.4 * 208 + 0.6 * 90)) <= 3, 'fill 40 % mixes the layer in at 40 %: ' + r.fill);
  h.assert(r.apply[0][0] < r.apply[1][0] && r.apply[2][0] < 120, 'apply image multiplies by the backdrop luminance: ' + JSON.stringify(r.apply));
  h.assert(r.wrap[0][0] > r.wrap[1][0] + 25, 'light wrap brightens the edge against the bright backdrop: ' + JSON.stringify(r.wrap));
  h.assert(JSON.stringify(r.disp[0]) !== JSON.stringify(r.disp[1]) || r.disp[0][3] < 255, 'displace moves pixels by the backdrop: ' + JSON.stringify(r.disp));
  h.assert(r.adj[0].slice(0, 3).every((v, i) => Math.abs(v - r.adj[1][i]) <= 3), 'match-color on an adjustment layer: ' + JSON.stringify(r.adj));
  h.assert.noErrors(pg);
};

cases['ops and agent helpers: round trip, contact, stage, match, noise, plane placement, vanishing-point direction'] = async ({ browser, base, h }) => {
  const pg = await studio(h, browser, base);
  const r = await pg.evaluate(async () => {
    const FX = window.LE.fx, C = FX.composite, O = FX.ops, T = window.cmpT, out = {};
    /* Ops round trip. */
    const doc = { v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }] };
    let s = O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'cast-shadow', p: { opacity: 0.6, direction: 9999 } } });
    const c1 = s.id; out.add = [s.ok, s.doc.layers[0].fx[0].p.direction, s.warnings.length];
    s = O.apply(s.doc, { op: 'fx.add', layer: 'a', entry: { type: 'floor-reflection', p: { opacity: 0.3 } } });
    const r1 = s.id;
    s = O.apply(s.doc, { op: 'fx.update', layer: 'a', id: c1, p: { elevation: 50, anchor: { x: 0.4, y: 0.9 } } });
    out.update = s.ok && s.doc.layers[0].fx[0].p.elevation === 50 && s.doc.layers[0].fx[0].p.opacity === 0.6 && s.doc.layers[0].fx[0].p.anchor.x === 0.4;
    s = O.apply(s.doc, { op: 'fx.reorder', layer: 'a', id: r1, index: 0 });
    out.order = s.doc.layers[0].fx.map((e) => e.type).join();
    s = O.apply(s.doc, { op: 'fx.remove', layer: 'a', id: c1 }); s = O.apply(s.doc, { op: 'fx.remove', layer: 'a', id: r1 });
    out.removed = !s.doc.layers[0].fx;
    out.badBlend = O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'blend-options', p: { mode: 'explode' } } }).doc.layers[0].fx[0].p.mode;
    /* Contact on a subject with a known base. */
    const bot = T.bottle(200, 300);
    out.contact = C.contact(bot);
    /* Stage a preset on the studio's photo with a cut-out of the same bottle shape. */
    /* A small photo (a flat card) with a bottle-shaped cut-out mask, 160 × 240 on the page. */
    const sc = window.LEStudio.scene, L = sc.layers()[0];
    sc.addAsset('photo-1', T.shape(160, 240, (x) => { x.fillStyle = '#c85a3a'; x.fillRect(0, 0, 160, 240); x.fillStyle = '#7fbf6a'; x.fillRect(0, 0, 160, 20); }));
    sc.addAsset('cut-1', T.mask(160, 240));
    sc.update(L.id, { src: 'photo-1', crop: null, cutout: { asset: 'cut-1' }, x: 40, y: 40, w: 160, h: 240 });
    const before = await sc.render(1);
    out.presets = Object.keys(C.presets).map((id) => {
      const st = C.stage(sc, L.id, id);
      let d = sc.toJSON(), ok = st.ok;
      st.ops.forEach((op) => { const res = O.apply(d, op); ok = ok && res.ok && !res.warnings.length; d = res.doc; });
      return [id, ok, st.ops.length, st.geometry.anchor];
    });
    let d2 = sc.toJSON();
    C.stage(sc, L.id, 'soft-table-reflection').ops.forEach((op) => { d2 = O.apply(d2, op).doc; });
    sc.load(d2);
    const after = await sc.render(1), Lb = sc.layers()[0];
    /* Mean brightness of the ground band just under the subject (the contact shadow and the reflection live there). */
    const below = (c) => { const d = c.getContext('2d').getImageData(Math.round(Lb.x + Lb.w * 0.35), Math.round(Lb.y + Lb.h * 0.926), Math.round(Lb.w * 0.3), Math.round(Lb.h * 0.03)).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    out.stageRender = [below(before), below(after)];
    out.restage = C.stage(sc, Lb.id, 'floating', { replace: true }).ops.map((o) => o.op + ':' + (o.entry ? o.entry.type : ''));
    /* Match: a reddish subject toward a bluish, darker target. */
    const mk = (col, w) => T.shape(w || 40, w || 40, (x, ww, hh) => { const g = x.createLinearGradient(0, 0, ww, 0); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); x.fillStyle = g; x.fillRect(0, 0, ww, hh); });
    const mt = C.match.sync(mk(['#c08070', '#f0c0b0']), mk(['#304060', '#6080b0']));
    out.match = mt.p; out.wb = mt.whiteBalance; out.matchAsync = (await C.match(mk(['#c08070', '#f0c0b0']), mk(['#304060', '#6080b0']))).p.dstL === mt.p.dstL;
    const noisy = T.shape(64, 64, (x) => { const im = x.createImageData(64, 64); let sd = 9; for (let i = 0; i < im.data.length; i += 4) { sd = (sd * 1103515245 + 12345) & 0x7fffffff; const v = 128 + ((sd % 41) - 20); im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); });
    const flat = T.shape(64, 64, (x) => { x.fillStyle = '#808080'; x.fillRect(0, 0, 64, 64); });
    out.noise = C.matchNoise(flat, noisy);
    out.noiseBack = C.matchNoise(noisy, flat);
    /* A frontal rectangle 2:1 and a 1:1 layer, contained: a centred square. */
    out.plane = C.quadFromPlane([[100, 100], [300, 100], [300, 200], [100, 200]], { layerAspect: 1, fit: 'contain', layer: 'a' });
    out.planeAspect = C.planeAspect([[100, 100], [300, 100], [300, 200], [100, 200]], { w: 400, h: 300 });
    const pers = [[120, 60], [300, 90], [300, 210], [120, 240]];
    out.persp = C.quadFromPlane(pers, { fit: 'stretch' }).quad;
    out.vp = [C.shadowFromVanishing({ vanish: { x: 900, y: 100 }, contact: { x: 400, y: 400 }, ground: 0.3 }), C.shadowFromVanishing({ foot: { x: 100, y: 400 }, contact: { x: 400, y: 400 } })];
    return out;
  });
  h.assert(r.add[0] && r.add[1] === 360 && r.add[2] === 1, 'fx.add clamps the angle with a warning: ' + r.add);
  h.assert(r.update && r.order === 'floor-reflection,cast-shadow' && r.removed, 'update merges, reorder, remove');
  h.assert(r.badBlend === 'normal', 'an unknown blend mode falls back to normal');
  const ct = r.contact;
  h.assert(Math.abs(ct.y - 0.925) < 0.01 && Math.abs(ct.x - 0.5) < 0.01 && Math.abs(ct.left - 0.3) < 0.02 && Math.abs(ct.right - 0.7) < 0.02 && Math.abs(ct.top - 0.07) < 0.02, 'contact finds the base of the bottle: ' + JSON.stringify(ct));
  r.presets.forEach((p) => h.assert(p[1] && p[2] >= 2 && Math.abs(p[3].y - 0.925) < 0.02, 'preset ' + p[0] + ' stages valid ops at the measured contact: ' + JSON.stringify(p)));
  h.assert(r.stageRender[1] < r.stageRender[0] - 6, 'the staged shot darkens the ground under the subject: ' + JSON.stringify(r.stageRender));
  h.assert(r.restage[0].indexOf('fx.remove') === 0 && r.restage.filter((x) => x.indexOf('fx.remove') === 0).length === 4, 'replace removes the earlier pack entries first: ' + r.restage);
  h.assert(r.match.dstL < r.match.srcL && r.match.dstB < r.match.srcB && r.match.dstA < r.match.srcA && r.wb.temperature < 0 && r.matchAsync, 'match reads a darker, cooler target: ' + JSON.stringify([r.match, r.wb]));
  h.assert(r.noise.grain && r.noise.grain.p.amount > 5 && !r.noise.blur && !r.noiseBack.grain, 'matchNoise adds grain to the clean subject and none to the noisy one: ' + JSON.stringify(r.noise.grain) + ' ' + JSON.stringify(r.noiseBack));
  h.assert.equal(JSON.stringify(r.plane.quad), JSON.stringify([[150, 100], [250, 100], [250, 200], [150, 200]]), 'contain puts a square in the middle of a 2:1 surface');
  h.assert(r.plane.op.op === 'transform.set' && Math.abs(r.planeAspect - 2) < 0.01, 'and returns a transform.set op; the aspect of a frontal plane is its side ratio: ' + r.planeAspect);
  h.assert.equal(JSON.stringify(r.persp), JSON.stringify([[120, 60], [300, 90], [300, 210], [120, 240]]), 'stretch maps the corners exactly');
  h.assert(r.vp[0].direction > 270 && r.vp[0].direction < 360 && r.vp[1].direction === 0, 'shadow directions from a vanishing point and from a lamp foot: ' + JSON.stringify(r.vp));
  h.assert.noErrors(pg);
};

module.exports = cases;
