'use strict';
/* X6 relighting and depth effects (assets/js/fx/le-fx-relight.js) and the maps module (assets/js/le-maps.js).
   Synthetic depth scenes with analytic answers (a sphere on a plane), neutral defaults, preview against tiled export with small
   tiles, depth packing and edge-aware upsampling, face-preset placement from fixed landmarks, the light estimate, map.generate
   round trips with the models stubbed, and the maps module's "nothing before asked" and cache naming.
   One real-model smoke case runs only with RELIGHT_REAL=1 (the small depth model takes 5 to 30 s on a loaded machine).
   Goldens: tests/golden/fx/relight-*.png (FX_GOLDEN=create node tests/run.js fx-relight writes missing ones). */
const fx = require('./lib/fx');

const cases = {};
const EFFECTS = ['relight', 'rim-light', 'light-rays', 'depth-fog', 'catchlight'];

/* In the page: window.RL with a sphere-on-a-plane scene, the packed depth, and helpers. */
function helpers() {
  const RL = window.RL = {};
  /* Grey floor plane receding upwards (depth 0.2 at the top to 0.5 at the bottom) with a sphere of radius r px at (cx, cy):
     depth 0.75 at its rim rising to 1 at its centre. The photo is uniform (or two-tone), so the existing light is flat. */
  RL.scene = (W, H, o) => {
    o = o || {};
    const r = o.r || Math.round(Math.min(W, H) * 0.26), cx = W * 0.5, cy = H * 0.55;
    const img = document.createElement('canvas'); img.width = W; img.height = H;
    const x = img.getContext('2d'); x.fillStyle = o.bg || '#8a8a8a'; x.fillRect(0, 0, W, H);
    if (o.fg !== false) { x.fillStyle = o.fg || '#8a8a8a'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
    const dw = o.dw || W, dh = o.dh || H, depth = new Float32Array(dw * dh);
    for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) {
      const px = (i + 0.5) / dw * W, py = (j + 0.5) / dh * H;
      let d = 0.2 + 0.3 * py / H;
      const dx = (px - cx) / r, dy = (py - cy) / r, r2 = dx * dx + dy * dy;
      if (r2 < 1) d = Math.max(d, 0.75 + 0.25 * Math.sqrt(1 - r2));
      depth[j * dw + i] = d;
    }
    const dc = LE.maps.pack.depth({ depth, width: dw, height: dh });
    return { img, dc, r, cx, cy, layer: { maps: { depth: { asset: 'dep', model: 'synthetic', version: 1 } } }, assets: (id) => (id === 'dep' ? dc : null) };
  };
  RL.apply = (s, fxList, o) => LE.fx.apply(s.img, Object.assign({ fx: fxList, layer: s.layer, assets: s.assets }, o || {}));
  RL.px = (c, x, y) => Array.from(c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data);
  RL.lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  RL.same = (a, b) => { const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; let m = 0; for (let i = 0; i < da.length; i++) m = Math.max(m, Math.abs(da[i] - db[i])); return m; };
  /* A synthetic face: 478 landmarks of a frontal face centred at (cx, cy) with width fw (fractions of the image). */
  RL.face = (cx, cy, fw, image) => {
    const L = [];
    for (let i = 0; i < 478; i++) { const a = i / 478 * Math.PI * 2; L.push([cx + Math.cos(a) * fw * 0.5, cy + Math.sin(a) * fw * 0.65, 0]); }
    L[1] = [cx, cy + fw * 0.05, -0.05]; L[234] = [cx - fw * 0.5, cy, 0]; L[454] = [cx + fw * 0.5, cy, 0];
    L[33] = [cx - fw * 0.32, cy - fw * 0.12, 0]; L[263] = [cx + fw * 0.32, cy - fw * 0.12, 0];
    L[468] = [cx - fw * 0.2, cy - fw * 0.12, 0]; L[473] = [cx + fw * 0.2, cy - fw * 0.12, 0];
    L[469] = [cx - fw * 0.17, cy - fw * 0.12, 0]; L[471] = [cx - fw * 0.23, cy - fw * 0.12, 0];
    return LE.maps.pack.face({ landmarks: L, rotation: 0, score: 0.99, image: image || { width: 1000, height: 1000 }, model: 'fixture', version: 'maps-1' });
  };
}
async function page(browser, base, opts) {
  const pg = await fx.page(browser, base, opts);
  await pg.addScriptTag({ url: base + '/assets/js/le-maps.js' });
  await pg.addScriptTag({ content: '(' + helpers.toString() + ')()' });
  return pg;
}
function png(url) { return Buffer.from(url.split(',')[1], 'base64'); }

cases['registry: five effects with schema, ui, agent text and LE.support entries; ops round trip'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate((ids) => {
    const FX = LE.fx, d = FX.describe().filter((e) => ids.indexOf(e.id) >= 0);
    const doc = { layers: [{ id: 'p', type: 'image', src: 'a', x: 0, y: 0, w: 100, h: 80 }] };
    let s = FX.ops.apply(doc, { op: 'fx.add', layer: 'p', entry: { type: 'relight', p: { intensity: 9, position: { x: 0.2, y: 0.3 } } } });
    const added = s.ok, clamped = s.doc.layers[0].fx[0].p.intensity, id = s.id, warn = s.warnings.length;
    s = FX.ops.apply(s.doc, { op: 'fx.add', layer: 'p', entry: { type: 'depth-fog', p: { amount: 0.3 } } });
    s = FX.ops.apply(s.doc, { op: 'fx.update', layer: 'p', id, p: { type: 'spot', cone: 20 } });
    const upd = s.doc.layers[0].fx[0].p;
    s = FX.ops.apply(s.doc, { op: 'fx.reorder', layer: 'p', id, index: 1 });
    const order = s.doc.layers[0].fx.map((e) => e.type);
    s = FX.ops.apply(s.doc, { op: 'fx.remove', layer: 'p', id });
    return {
      d, n: d.length, added, clamped, warn, upd, order, after: s.doc.layers[0].fx.map((e) => e.type),
      support: ids.filter((i) => (window.LE_SUPPORT_DEFS || []).some((x) => x.id === 'fx.' + i) || (LE.support && LE.support.get && LE.support.get('fx.' + i))),
      helpers: ['presets', 'portrait', 'estimate', 'retime', 'depthGrade', 'backgroundDim', 'depth', 'kelvin'].filter((k) => !!FX.relight[k]),
      presets: FX.relight.presets.map((p) => p.id), json: JSON.stringify(d).length
    };
  }, EFFECTS);
  h.assert.equal(r.n, 5, 'five effects registered');
  r.d.forEach((e) => {
    h.assert(e.version >= 1 && e.space === 'linear' && e.agent.summary && e.agent.tips.length >= 2 && e.agent.example.type === e.id, e.id + ' agent text');
    h.assert(['Light', 'Effects'].indexOf(e.ui.section) >= 0, e.id + ' section');
    Object.keys(e.params).forEach((k) => { const p = e.params[k]; h.assert(p.label, e.id + '.' + k + ' label'); if (p.type === 'number') h.assert(p.default >= p.min && p.default <= p.max && p.step > 0, e.id + '.' + k + ' range'); });
    h.assert(Object.keys(e.params).length <= 24, e.id + ' has at most 24 parameters (the sanitiser limit)');
  });
  h.assert(r.added && r.clamped === 4 && r.warn >= 1, 'out-of-range intensity is clamped with a warning');
  h.assert(r.upd.type === 'spot' && r.upd.cone === 20 && r.upd.position.x === 0.2, 'update merges p');
  h.assert.equal(r.order.join(), 'depth-fog,relight');
  h.assert.equal(r.after.join(), 'depth-fog');
  h.assert.equal(r.support.length, 5, 'declared to LE.support');
  h.assert.equal(r.helpers.length, 8, 'helpers on LE.fx.relight');
  h.assert(r.presets.length === 8 && r.presets.indexOf('rembrandt') >= 0 && r.presets.indexOf('gel-pair') >= 0, 'eight portrait presets');
  h.assert(r.json < 30000, 'describe() of the pack stays compact: ' + r.json);
  h.assert.noErrors(pg);
};

cases['neutral: every effect at its defaults is pixel-identical to no effect, with a depth map present'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate((ids) => {
    const s = RL.scene(192, 144, { fg: '#c49a7a', bg: '#4d6a8c' }), plain = RL.apply(s, []);
    const out = {};
    ids.forEach((id) => { out[id] = RL.same(plain, RL.apply(s, [{ type: id, p: {} }])); });
    out.stack = RL.same(plain, RL.apply(s, ids.map((id) => ({ type: id, p: {} }))));
    return out;
  }, EFFECTS);
  Object.keys(r).forEach((k) => h.assert.equal(r[k], 0, k + ' at defaults changes pixels'));
  h.assert.noErrors(pg);
};

/* The core maths against a CPU reference: on a uniform grey photo the existing light is flat, so relit = grey · I · max(n·l, 0)
   (existing 0, no specular, no wrap, no shadow). Normals: analytic sphere height (z = (D − 1) · relief · W / 2) and the same slope cap. */
cases['relight: Lambert shading of a sphere matches a CPU reference; shading follows the light'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const W = 256, H = 192, s = RL.scene(W, H, { r: 60 }), relief = 1.2, zs = relief * 0.5 * W, cap = 1.6;
    const p = { type: 'directional', position: { x: 1.0, y: 0.25 }, height: 0.5, intensity: 1, existing: 0, specular: 0, softness: 0, shadows: 0, temperature: 6500, relief, subject: false };
    const out = RL.apply(s, [{ type: 'relight', p }]);
    const L = (() => { const v = [(1.0 - 0.5) * W, (0.25 - 0.5) * H, 0.5 * W + 1e-3], l = Math.hypot(v[0], v[1], v[2]); return v.map((q) => q / l); })();
    const k = LE.fx.relight.kelvin(6500), grey = RL.lin(0x8a);
    const rows = [];
    [[0, 0], [0.4, 0], [-0.4, 0], [0, -0.4], [0, 0.4], [0.55, -0.3], [-0.55, 0.3]].forEach(([u, v]) => {
      const x = s.cx + u * s.r, y = s.cy + v * s.r, r2 = u * u + v * v;
      let gx = -zs * 0.25 * u / s.r / Math.sqrt(1 - r2), gy = -zs * 0.25 * v / s.r / Math.sqrt(1 - r2);   /* ∂z/∂x on the sphere, document px */
      const m = Math.hypot(gx, gy); if (m > 1e-6) { const q = Math.tanh(m / cap) * cap / m; gx *= q; gy *= q; }
      const n = [-gx, -gy, 1], nl = Math.hypot(n[0], n[1], n[2]), ndl = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
      const want = grey * ndl * k[1], got = RL.lin(RL.px(out, x, y)[1]);
      rows.push({ u, v, want, got });
    });
    const left = RL.lin(RL.px(out, s.cx - 0.5 * s.r, s.cy)[1]), right = RL.lin(RL.px(out, s.cx + 0.5 * s.r, s.cy)[1]);
    return { rows, left, right };
  });
  r.rows.forEach((q) => h.assert(Math.abs(q.got - q.want) < 0.035 + 0.12 * q.want, 'sphere at (' + q.u + ', ' + q.v + '): GPU ' + q.got.toFixed(3) + ' against CPU ' + q.want.toFixed(3)));
  h.assert(r.right > r.left * 1.5, 'the side facing the light is brighter: ' + r.right.toFixed(3) + ' vs ' + r.left.toFixed(3));
  h.assert.noErrors(pg);
};

/* Shadows: a sun from the right casts the sphere's shadow to the left on the plane, and from the left to the right; points the
   CPU ray march of the same height field calls lit or shadowed agree. */
cases['relight: depth shadows fall away from the light and agree with a CPU ray march'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const W = 256, H = 192, s = RL.scene(W, H, { r: 40 }), relief = 1.2, zs = relief * 0.5 * W;
    const run = (px) => RL.apply(s, [{ type: 'relight', p: { type: 'directional', position: { x: px, y: 0.55 }, height: 0.15, intensity: 1.5, existing: 0.3, shadows: 1, shadowLength: 150, softness: 0, specular: 0, relief, subject: false } }]);
    const fromRight = run(1.4), fromLeft = run(-0.4);
    const g = (c, x) => RL.px(c, x, s.cy)[1];
    /* CPU: march from a plane point toward the light; occluded if the height field rises above the ray. */
    const zAt = (x, y) => { const dx = (x - s.cx) / s.r, dy = (y - s.cy) / s.r, r2 = dx * dx + dy * dy; let d = 0.2 + 0.3 * y / H; if (r2 < 1) d = Math.max(d, 0.75 + 0.25 * Math.sqrt(1 - r2)); return (d - 1) * zs; };
    const Lv = [1.4 * W - W / 2, 0, 0.15 * W], ll = Math.hypot(Lv[0], Lv[2]), slope = Lv[2] / Math.abs(Lv[0]);
    const cpu = (x) => { const z0 = zAt(x, s.cy); for (let t = 1; t < 150; t += 0.5) if (zAt(x + t, s.cy) > z0 + slope * t + 1) return 0; return 1; };
    const xs = [s.cx - s.r - 10, s.cx - s.r - 40, s.cx - s.r - 140, s.cx + s.r + 10];
    return { right: xs.map((x) => ({ x, gpu: g(fromRight, x), cpu: cpu(x) })), left: [g(fromLeft, s.cx - s.r - 10), g(fromLeft, s.cx + s.r + 10)], ll };
  });
  const lit = r.right.filter((q) => q.cpu === 1).map((q) => q.gpu), dark = r.right.filter((q) => q.cpu === 0).map((q) => q.gpu);
  h.assert(lit.length && dark.length, 'the reference has lit and shadowed samples: ' + JSON.stringify(r.right));
  h.assert(Math.min.apply(null, lit) > Math.max.apply(null, dark) + 20, 'GPU shadows agree with the CPU march: ' + JSON.stringify(r.right));
  h.assert(r.left[1] < r.left[0] - 20, 'a light from the left throws the shadow to the right: ' + r.left);
  h.assert.noErrors(pg);
};

async function tiles(browser, base, h, stacks) {
  const pg = await page(browser, base);
  for (const k of Object.keys(stacks)) {
    const r = await pg.evaluate((st) => {
      const s = RL.scene(256, 160, { fg: '#d0b090', bg: '#607890' });
      const a = RL.apply(s, st), b = RL.apply(s, st, { tile: 128 });
      return [a.toDataURL(), b.toDataURL()];
    }, stacks[k]);
    await fx.same(pg, png(r[0]), png(r[1]), k + ' tiled against whole', { max: 3, over: 0.001 });
  }
  h.assert.noErrors(pg);
}
cases['tiles: relight (spot, pattern, shadows, AO, soften) is seam-free with 128 px tiles'] = ({ browser, base, h }) => tiles(browser, base, h, {
  relight: [{ type: 'relight', p: { type: 'spot', position: { x: 0.2, y: 0.1 }, aim: { x: 0.5, y: 0.6 }, intensity: 1.5, existing: 0.6, soften: 0.3, ao: 0.6, shadowLength: 60, pattern: 'leaves' } }]
});
cases['tiles: rim light, light rays, depth fog and catchlights are seam-free with 128 px tiles'] = ({ browser, base, h }) => tiles(browser, base, h, {
  rim: [{ type: 'rim-light', p: { angle: 120, intensity: 2 } }],
  rays: [{ type: 'light-rays', p: { intensity: 1.5, threshold: 0.3, length: 160, depth: 0 } }],
  fog: [{ type: 'depth-fog', p: { amount: 0.7, ground: 0.5 } }],
  catch: [{ type: 'catchlight', p: { intensity: 1, size: 6 } }]
});

cases['goldens: representative settings on the synthetic scene'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const G = {
    'point': [{ type: 'relight', p: { type: 'point', position: { x: 0.15, y: 0.2 }, height: 0.4, intensity: 1.5, existing: 0.5, temperature: 4200 } }],
    'spot-window': [{ type: 'relight', p: { type: 'spot', position: { x: 0.5, y: 0 }, aim: { x: 0.5, y: 0.6 }, height: 0.6, cone: 30, intensity: 2, existing: 0.4, pattern: 'window' } }],
    'soften-ao': [{ type: 'relight', p: { intensity: 0, soften: 0.6, ao: 0.8 } }],
    'rim-light': [{ type: 'rim-light', p: { angle: 135, intensity: 2.5, temperature: 8000 } }],
    'depth-fog': [{ type: 'depth-fog', p: { amount: 0.8, ground: 0.4 } }],
    'light-rays': [{ type: 'light-rays', p: { intensity: 2, threshold: 0.4, source: { x: 0.5, y: 0.05 }, depth: 0.3 } }]
  };
  for (const name of Object.keys(G)) {
    const url = await pg.evaluate((st) => RL.apply(RL.scene(256, 192, { fg: '#d0b090', bg: '#6a7f96' }), st).toDataURL(), G[name]);
    await fx.golden(pg, 'relight-' + name, png(url));
  }
  h.assert.noErrors(pg);
};

/* Edge-aware upsampling: a depth step on a coarse grid (32 x 24) that sits between grid cells, under a photo whose colour edge is
   at x = 101. The refined depth (seen through a hard depth-fog split) must switch within a few pixels of the colour edge. */
cases['depth: packing is lossless and the joint bilateral refinement snaps the depth edge to the photo edge'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const W = 256, H = 192, img = document.createElement('canvas'); img.width = W; img.height = H;
    const x = img.getContext('2d'); x.fillStyle = '#d8c0a0'; x.fillRect(0, 0, 101, H); x.fillStyle = '#304860'; x.fillRect(101, 0, W - 101, H);
    const dw = 32, dh = 24, depth = new Float32Array(dw * dh);
    for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) depth[j * dw + i] = (i + 0.5) / dw * W < 101 ? 0.9 : 0.2;
    const dc = LE.maps.pack.depth({ depth, width: dw, height: dh }), back = LE.maps.unpack.depth(dc);
    let err = 0; for (let i = 0; i < depth.length; i++) err = Math.max(err, Math.abs(back.depth[i] - depth[i]));
    const s = { img, layer: { maps: { depth: { asset: 'd' } } }, assets: () => dc };
    const fog = (draft) => { LE.fx.interactive(!!draft); try { return RL.apply(s, [{ type: 'depth-fog', p: { amount: 1, start: 0.45, end: 0.47, color: '#ff00ff', desaturate: 0 } }]); } finally { LE.fx.interactive(false); } };
    const row = (c) => { const w = c.width, k = W / w, d = c.getContext('2d').getImageData(0, Math.round(c.height / 2), w, 1).data, out = []; for (let i = 0; i < w; i++) out.push(d[i * 4 + 1] < 40 && d[i * 4] > 200 ? 1 : 0); return { out, k }; };
    const edgeOf = (rw) => { let first = -1; for (let i = 0; i < rw.out.length; i++) if (rw.out[i]) { first = i; break; } return first * rw.k; };
    const refined = row(fog(false));
    return { err, refinedEdge: edgeOf(refined) };
  });
  h.assert(r.err < 2e-5, '16-bit depth packing is lossless: ' + r.err);
  h.assert(Math.abs(r.refinedEdge - 101) <= 3, 'refined depth edge sits on the photo edge (x = 101): ' + r.refinedEdge);
  h.assert.noErrors(pg);
};

cases['masks and adjustment layers: an entry mask limits relight; the layer mask and an adjustment layer apply'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const s = RL.scene(200, 150, { fg: '#c09070', bg: '#506070' });
    const e = { type: 'relight', p: { type: 'point', position: { x: 0.5, y: 0.2 }, intensity: 2, existing: 0.5 } };
    const plain = RL.apply(s, []), whole = RL.apply(s, [e]);
    const masked = RL.apply(s, [Object.assign({}, e, { mask: { parts: [{ kind: 'linear', x0: 0, y0: 0, x1: 0.4, y1: 0, feather: 0 }] } })]);
    const lmask = RL.apply(s, [e], { mask: { parts: [{ kind: 'radial', cx: 0.85, cy: 0.5, rx: 0.1, ry: 0.1, feather: 0.1 }] } });
    return { leftChanged: RL.px(masked, 10, 75)[0] !== RL.px(plain, 10, 75)[0],
      right: [RL.px(masked, 190, 75), RL.px(plain, 190, 75), RL.px(whole, 190, 75)], lm: [RL.px(lmask, 10, 10), RL.px(plain, 10, 10)] };
  });
  h.assert(r.leftChanged, 'the masked entry changes the left side');
  h.assert(r.right[0].every((v, i) => Math.abs(v - r.right[1][i]) <= 2) && r.right[2].some((v, i) => Math.abs(v - r.right[1][i]) > 6), 'and leaves the right side alone: ' + JSON.stringify(r.right));
  h.assert.equal(r.lm[0][3], 0, 'outside the layer mask the layer is transparent');
  /* Adjustment layer in the studio: catchlights (no maps needed) on an adjustment layer change the page under it. */
  const st = await h.studioWithSample(browser, base, 'desktop');
  await fx.attach(st);
  const a = await fx.shot(st, 0.25);
  await st.evaluate(async () => {
    await LE.fxBoot.load();
    const s = window.LEStudio.scene, l = s.layers()[0];
    s.add({ type: 'adjust', fx: [{ type: 'catchlight', p: { intensity: 2, size: 30, left: { x: 0.3, y: 0.3 }, right: { x: 0.7, y: 0.3 } } }], x: l.x, y: l.y, w: l.w, h: l.h });
  });
  await st.waitForTimeout(400);
  const b = await fx.shot(st, 0.25);
  const d = await fx.diff(st, a, b);
  h.assert(d.max > 40, 'an adjustment layer with catchlights changes the page: ' + JSON.stringify(d));
  h.assert.noErrors(st);
};

cases['portrait presets: lights are placed from fixed face landmarks'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const face = RL.face(0.5, 0.4, 0.3);
    const doc = { layers: [{ id: 'p', type: 'image', src: 'a', x: 0, y: 0, w: 1000, h: 1000, maps: { depth: { asset: 'd' }, face: [face] }, fx: [{ id: 'old', type: 'relight', p: {} }] }] };
    const P = LE.fx.relight, out = {};
    ['studio-key', 'rembrandt', 'butterfly', 'split', 'rim', 'golden-hour', 'softbox', 'gel-pair'].forEach((id) => {
      const res = P.portrait(doc, 'p', id, { catchlights: true });
      out[id] = { ok: res.ok, ops: res.ops, warnings: res.warnings, face: res.face };
    });
    const applied = LE.fx.ops.apply(doc, out.rembrandt.ops[0]).ok && out.rembrandt.ops.slice(1).reduce((d, op) => { const q = LE.fx.ops.apply(d.doc, op); return q.ok ? q : { doc: d.doc, bad: q }; }, { doc: LE.fx.ops.apply(doc, out.rembrandt.ops[0]).doc });
    const none = P.portrait({ layers: [{ id: 'q', type: 'image', w: 100, h: 100 }] }, 'q', 'rembrandt');
    return { out, applied: !!applied && !applied.bad, types: applied.doc.layers[0].fx.map((e) => e.type), none: none.warnings.map((w) => w.code) };
  });
  const key = (id) => r.out[id].ops.filter((o) => o.op === 'fx.add' && o.entry.type === 'relight')[0].entry.p;
  const f = r.out.rembrandt.face;
  h.assert(Math.abs(f.center.x - 0.5) < 0.01 && Math.abs(f.center.y - 0.4) < 0.02 && Math.abs(f.yaw) < 3, 'face centre and yaw from the landmarks: ' + JSON.stringify(f));
  h.assert(r.out.rembrandt.ops[0].op === 'fx.remove' && r.out.rembrandt.ops[0].id === 'old', 'replaces earlier light entries');
  const rb = key('rembrandt'), bf = key('butterfly'), sp = key('split');
  h.assert(rb.position.x < 0.45 && rb.position.y < 0.35 && rb.height > 0.1, 'Rembrandt: key high on the left, in front: ' + JSON.stringify(rb));
  h.assert(Math.abs(bf.position.x - 0.5) < 0.01 && bf.position.y < 0.3, 'Butterfly: key straight above the face: ' + JSON.stringify(bf));
  h.assert(sp.position.x < 0.0 && Math.abs(sp.position.y - 0.4) < 0.1 && sp.height < 0.05, 'Split: key at the side, level, not in front: ' + JSON.stringify(sp));
  const gel = r.out['gel-pair'].ops.filter((o) => o.entry && o.entry.type === 'relight').map((o) => o.entry.p);
  h.assert(gel.length === 2 && gel[0].position.x < 0.5 && gel[1].position.x > 0.5 && gel[1].existing === 1, 'gel pair: two lights on opposite sides, base settings on the first only');
  const rims = r.out.rim.ops.filter((o) => o.entry && o.entry.type === 'rim-light').map((o) => o.entry.p.angle);
  h.assert(rims.join() === '160,20', 'rim preset: back lights from upper left and upper right: ' + rims);
  const cl = r.out.rembrandt.ops.filter((o) => o.entry && o.entry.type === 'catchlight')[0];
  h.assert(cl && Math.abs(cl.entry.p.left.x - 0.44) < 0.01 && Math.abs(cl.entry.p.right.x - 0.56) < 0.01 && cl.entry.p.clock > 90 && cl.entry.p.clock < 180, 'catchlights on the irises, at the key light\'s clock position: ' + JSON.stringify(cl && cl.entry.p));
  h.assert(r.applied && r.types.indexOf('relight') >= 0 && r.types.indexOf('old') < 0, 'the ops apply through LE.fx.ops: ' + r.types);
  h.assert(r.none.indexOf('no-face') >= 0 && r.none.indexOf('no-depth') >= 0, 'missing maps are reported');
  h.assert.noErrors(pg);
};

cases['estimate: light direction, softness and colour of a lit sphere'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(() => {
    const W = 160, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), im = x.createImageData(W, H), m = document.createElement('canvas'); m.width = W; m.height = H;
    const mx = m.getContext('2d'); mx.fillStyle = '#fff'; mx.beginPath(); mx.arc(80, 80, 60, 0, 7); mx.fill();
    const run = (L, tint) => {
      const l = Math.hypot(L[0], L[1], L[2]); L = L.map((v) => v / l);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = (i + 0.5 - 80) / 60, v = -(j + 0.5 - 80) / 60, r2 = u * u + v * v, k = (j * W + i) * 4;
        let s = 0.03; if (r2 < 1) s += 0.7 * Math.max(0, u * L[0] + v * L[1] + Math.sqrt(1 - r2) * L[2]);
        const enc = (q) => Math.round(255 * (q <= 0.0031308 ? q * 12.92 : 1.055 * Math.pow(q, 1 / 2.4) - 0.055));
        im.data[k] = enc(Math.min(1, s * tint[0])); im.data[k + 1] = enc(Math.min(1, s * tint[1])); im.data[k + 2] = enc(Math.min(1, s * tint[2])); im.data[k + 3] = 255;
      }
      x.putImageData(im, 0, 0);
      return LE.fx.relight.estimate(c, { mask: m });
    };
    return { ul: run([-1, 1, 0.8], [1, 0.62, 0.3]), r: run([1, 0, 0.3], [0.8, 0.9, 1.1]) };
  });
  h.assert(r.ul.ok && Math.abs(r.ul.azimuth - 135) <= 25, 'upper-left light found: ' + JSON.stringify(r.ul));
  h.assert(/upper left/.test(r.ul.words) && /warm/.test(r.ul.words) && r.ul.temperature < 4300, 'described as upper left and warm: ' + r.ul.words + ' ' + r.ul.temperature);
  h.assert(Math.abs(r.r.azimuth) <= 25 && /right/.test(r.r.words) && r.r.temperature > 6500, 'a cool light from the right: ' + JSON.stringify(r.r));
  h.assert(r.ul.suggest && r.ul.suggest.position.x < 0.5 && r.ul.suggest.position.y < 0.5, 'suggests a relight on the same side');
  h.assert.noErrors(pg);
};

cases['maps module: nothing is fetched before a call asks; model bytes are cached under their id in le-models-v1'] = async ({ browser, base, h }) => {
  const pg = await h.open(browser, base, '/404.html', 'desktop');
  await pg.addScriptTag({ url: base + '/assets/js/le-maps.js' });
  const before = await pg.evaluate(async () => ({ urls: performance.getEntriesByType('resource').map((r) => r.name), cache: await caches.has('le-models-v1'), api: ['depth', 'depthMap', 'normals', 'faces', 'face', 'segments', 'faceMask', 'unpack', 'ops', 'prefetch', 'ep'].filter((k) => !LE.maps[k]) }));
  h.assert(!before.urls.some((u) => /\.wasm|\.onnx|\/ort[.\/-]|maps-worker/.test(u)), 'nothing fetched: ' + before.urls.join(', '));
  h.assert.equal(before.cache, false, 'no model cache before asking');
  h.assert.equal(before.api.join(), '', 'API present');
  const r = await pg.evaluate(async () => {
    const asked = [];
    LE.downloads = { request: (o) => { asked.push(o); return Promise.resolve({ ok: true, why: 'auto' }); }, track: () => ({ progress() {}, done() {}, fail() {} }) };
    LE.maps.register({ id: 'test-tiny', kind: 'depth', tier: 'eval', label: 'Test map', bestFor: 'tests', files: { depth: { path: 'assets/js/le-maps-worker.js', bytes: 1 } } });
    const p = await LE.maps.prefetch('test-tiny');
    const c = await caches.open('le-models-v1'), keys = await c.keys(), hit = await c.match(keys[0]);
    const listed = await LE.maps.cachedModels();
    const again = await LE.maps.prefetch('test-tiny');
    const removed = await LE.maps.remove('test-tiny');
    return { p, header: hit.headers.get('x-le-model'), url: keys[0].url, listed: listed.map((x) => x.id), asked: asked.map((a) => a.kind + ':' + a.id), again: again.cached, removed, ep: LE.maps.ep('depth') };
  });
  h.assert(r.header === 'test-tiny' && /le-maps-worker\.js$/.test(r.url), 'stored with x-le-model: ' + JSON.stringify(r));
  h.assert(r.listed.indexOf('test-tiny') >= 0, 'cachedModels lists it for the storage manager');
  h.assert.equal(r.asked.join(), 'model:test-tiny', 'the download went through LE.downloads once, as a model');
  h.assert(r.again === true && r.removed === true, 'second time from the cache; remove clears it');
  h.assert.equal(r.ep, 'wasm', 'WebAssembly by default, as the remover');
  h.assert.noErrors(pg);
};

cases['map.generate: depth, faces and segments round trip into layer.maps (models stubbed); unsupported needs force'] = async ({ browser, base, h }) => {
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    const M = LE.maps, real = { depthMap: M.depthMap, faces: M.faces, segments: M.segments, support: M.support };
    const s = RL.scene(64, 48);
    M.depthMap = async () => ({ canvas: s.dc, result: { timings: { wallMs: 1 } }, entry: { width: 64, height: 48, orientation: 'near=1', model: 'depth-small', version: 'maps-1', refined: false } });
    M.faces = async () => ({ faces: [RL.face(0.5, 0.4, 0.3)], image: { width: 64, height: 48 } });
    M.segments = async () => { const n = 64 * 48, P = { person: new Uint8Array(n).fill(200), hair: new Uint8Array(n).fill(30), skin: new Uint8Array(n).fill(90), clothes: new Uint8Array(n).fill(60) }; return { width: 64, height: 48, planes: P, model: 'face-parts', version: 'maps-1' }; };
    M.support = async () => ({ status: 'ok' });
    const stored = {};
    const o = { image: async () => s.img, store: async (canvas, name) => { const id = (name.replace(/\W/g, '') + '0'.repeat(64)).slice(0, 64); stored[id] = canvas; return id; } };
    let doc = { layers: [{ id: 'p', type: 'image', src: 'x', x: 0, y: 0, w: 64, h: 48 }] };
    const a = await M.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'depth' }, o); doc = a.doc;
    const b = await M.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'faces' }, o); doc = b.doc;
    const c = await M.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'segments' }, o); doc = c.doc;
    const maps = doc.layers[0].maps, seg = M.unpack.segments(stored[maps.segments.asset], stored[maps.segments.clothes.asset]);
    const problems = LE.fx.problems ? LE.fx.problems({ layers: [Object.assign({}, doc.layers[0], { fx: [{ type: 'exposure', p: {}, mask: { parts: [{ kind: 'depth' }, { kind: 'face', part: 'skin' }] } }] })] }) : [];
    M.support = async () => ({ status: 'unsupported', reasons: ['No WebAssembly here.'], canForce: true });
    const refused = await M.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'depth' }, o);
    const forced = await M.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'depth', force: true }, o);
    const bad = await M.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'normals' }, o);
    Object.assign(M, real);
    const faceLen = JSON.stringify(maps.face).length;
    const unpacked = M.unpack.face(maps.face[0]);
    return { ok: [a.ok, b.ok, c.ok], depth: maps.depth, faces: maps.face.length, faceLen, seg: [seg.planes.person[5], seg.planes.hair[5], seg.planes.skin[5], seg.planes.clothes[5]], segMeta: maps.segments,
      untouched: !a.doc || a.doc !== doc, problems: (problems || []).map((p) => p.code), refused: [refused.ok, refused.code, refused.canForce], forced: forced.ok, bad: bad.code,
      list: M.ops.list()[0].op, parts: Object.keys(unpacked.parts).length };
  });
  h.assert.equal(r.ok.join(), 'true,true,true');
  h.assert(r.depth.asset && r.depth.asset.length === 64 && r.depth.model === 'depth-small' && r.depth.orientation === 'near=1' && r.depth.width === 64, 'layer.maps.depth as the contract says: ' + JSON.stringify(r.depth));
  h.assert(r.faces === 1 && r.faceLen < 6000 && r.parts >= 6, 'faces stored packed (' + r.faceLen + ' chars) and unpack to parts');
  h.assert.equal(r.seg.join(), '200,30,90,60', 'segments pack losslessly into an opaque RGB asset and a clothes asset');
  h.assert(r.segMeta.clothes && r.segMeta.clothes.asset, 'segments entry');
  h.assert(r.problems.indexOf('missing-map') < 0, 'depth and face masks find their maps: ' + r.problems);
  h.assert(r.refused[0] === false && r.refused[1] === 'unsupported' && r.refused[2] === true && r.forced === true, 'unsupported refuses with canForce; force runs: ' + r.refused);
  h.assert.equal(r.bad, 'invalid');
  h.assert.equal(r.list, 'map.generate');
  h.assert.noErrors(pg);
};

async function lightUi({ browser, base, h }, vp) {
  {
    const st = await h.studioWithSample(browser, base, vp);
    await st.evaluate(() => { ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((c) => window.LE.support && window.LE.support.override(c, true)); });
    await st.evaluate(() => window.LEStudio.mode('expert'));
    await st.waitForFunction(() => window.LE.expert && window.LE.expert.active());
    await st.waitForTimeout(250);
    const r = await st.evaluate(async () => {
      const c = window.LEStudio;
      await LE.fxBoot.load();
      for (let i = 0; i < 80 && !(LE.expert.tools.get && LE.expert.tools.get('light')); i++) await new Promise((res) => setTimeout(res, 25));
      const l = c.scene.layers().find((x) => x.type === 'image');
      c.scene.select([l.id]);
      LE.expert.doc.addFx(l.id, 'relight', { p: { intensity: 1, type: 'spot', quality: 'draft', shadows: 0, subject: false }, append: true }, LE.expert.gesture());
      LE.expert.tools.activate('light');
      await new Promise((res) => setTimeout(res, 100));
      const pts = Array.from(document.querySelectorAll('.xp-h-pt')).map((g) => g.getAttribute('aria-label'));
      const hit = document.querySelector('.xp-h-pt .xp-h-hit'), rr = hit ? hit.getBoundingClientRect() : null;
      return { reg: !!LE.expert.tools.get('light'), key: LE.expert.tools.get('light').key, pts, rect: rr && { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2, w: rr.width }, id: l.id, opts: !!document.querySelector('.xp-light-diag') };
    });
    h.assert(r.reg && r.key === 'K', vp + ': tool registered with K');
    h.assert(r.pts.indexOf('Light 1') >= 0 && r.pts.indexOf('Light 1 aim') >= 0, vp + ': position and aim handles: ' + r.pts);
    if (vp === 'phone') h.assert(r.rect.w >= 44, 'touch target 44 px: ' + r.rect.w);
    const before = await st.evaluate((id) => JSON.stringify(LE.expert.doc.fx(id)[LE.expert.doc.fx(id).length - 1].p.position), r.id);
    if (vp === 'phone') { await st.focus('.xp-h-pt'); await st.keyboard.press('Shift+ArrowRight'); }
    else { await st.mouse.move(r.rect.x, r.rect.y); await st.mouse.down(); await st.mouse.move(r.rect.x + 20, r.rect.y + 15, { steps: 4 }); await st.mouse.up(); }
    const after = await st.evaluate((id) => { const f = LE.expert.doc.fx(id); return JSON.stringify(f[f.length - 1].p.position); }, r.id);
    h.assert(after !== before, vp + ': dragging moves the light: ' + before + ' -> ' + after);
    await st.evaluate(() => window.LEStudio.scene.undo && window.LEStudio.scene.undo());
    const undone = await st.evaluate((id) => { const f = LE.expert.doc.fx(id); return JSON.stringify(f[f.length - 1].p.position); }, r.id);
    h.assert.equal(undone, before, vp + ': one undo restores the light');
    if (vp === 'desktop') h.assert(r.opts, 'options bar shows the lighting diagram');
    await h.noOverflow(st);
    h.assert.noErrors(st);
    await st.context().close();
  }
}
cases['interface: the Light tool registers, shows handles for a light, and a drag is one undo step (desktop)'] = (a) => lightUi(a, 'desktop');
cases['interface: the Light tool at 390 px: 44 px handles, keyboard moves the light, no sideways scroll'] = (a) => lightUi(a, 'phone');

cases['real model (RELIGHT_REAL=1): map.generate makes a depth map for a pool photo and relight uses it'] = async ({ browser, base, h }) => {
  if (!process.env.RELIGHT_REAL) return;
  const pg = await page(browser, base);
  const r = await pg.evaluate(async () => {
    const img = await window.fxT.load('/assets/photos/collage/people-08.jpg'), src = window.fxT.fit(img, 320), stored = {};
    let doc = { layers: [{ id: 'p', type: 'image', src: 'x', x: 0, y: 0, w: src.width, h: src.height }] };
    const g = await LE.maps.ops.apply(doc, { op: 'map.generate', layer: 'p', kind: 'depth', maxSide: 266 }, { image: async () => img, store: async (c) => { stored.d = c; return 'd'.repeat(64); }, confirmed: true });
    const layer = g.doc.layers[0], plain = LE.fx.apply(src, { fx: [] });
    const lit = LE.fx.apply(src, { fx: [{ type: 'relight', p: { intensity: 1.5, existing: 0.6 } }], layer, assets: () => stored.d });
    return { ok: g.ok, d: layer.maps.depth, diff: RL.same(plain, lit), cached: await LE.maps.isCached('depth-small') };
  });
  h.assert(r.ok && r.d.width % 14 === 0 && r.diff > 20 && r.cached, 'real depth map made, stored and used: ' + JSON.stringify(r));
  h.assert.noErrors(pg);
};

module.exports = cases;
