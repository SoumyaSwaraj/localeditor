/* Retouching pack (assets/js/fx/le-fx-retouch.js): frequency separation, detail bands, skin retouch by face area, dodge and
   burn, red-eye, healing / clone / patch, liquify, face-aware liquify and shape warp. See docs/FX-REFERENCE.md "Retouching".
   Face maps come from tests/fixtures/retouch/faces.json: LE.maps.face run once on the pool portraits (people-0x), packed. */
'use strict';
const fs = require('fs');
const path = require('path');
const fx = require('./lib/fx');
const FACES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'retouch', 'faces.json'), 'utf8'));
const IDS = ['frequency-separation', 'detail-bands', 'portrait-retouch', 'skin-smoothing', 'blemish-removal', 'under-eye', 'eye-enhance', 'teeth-whitening', 'lip-color', 'shine-reduction', 'face-contour', 'dodge-burn', 'red-eye', 'spot-heal', 'liquify', 'face-liquify', 'shape-warp'];
const cases = {};

async function open(browser, base) {
  const page = await fx.page(browser, base);
  await page.addScriptTag({ url: base + '/assets/js/le-maps.js' });
  return page;
}
/* A portrait crop through LE.fx.apply with the layer's face map. job: { photo, crop, size, fx | prep (source of (layer, R) => fx), tile } */
async function portrait(page, job) {
  const url = await page.evaluate(async (o) => {
    const img = await window.fxT.load('/assets/photos/collage/' + o.photo + '.jpg');
    const W = img.naturalWidth, H = img.naturalHeight, cr = o.crop;
    const k = o.size / Math.max(W * cr[2], H * cr[3]);
    const c = document.createElement('canvas'); c.width = Math.round(W * cr[2] * k); c.height = Math.round(H * cr[3] * k);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, W * cr[0], H * cr[1], W * cr[2], H * cr[3], 0, 0, c.width, c.height);
    const full = document.createElement('canvas'); full.width = W; full.height = H; full.getContext('2d').drawImage(img, 0, 0);
    const layer = { id: 'p', src: 'photo', w: c.width, h: c.height, crop: { x: cr[0], y: cr[1], w: cr[2], h: cr[3] }, maps: o.faces ? { face: o.faces } : undefined };
    const list = o.prep ? (new Function('layer', 'R', 'return (' + o.prep + ')(layer, R);'))(layer, window.LE.fx.retouch) : o.fx;
    return window.LE.fx.apply(c, { fx: list, layer, crop: cr, assets: (id) => id === 'photo' ? full : null, tile: o.tile || 0 }).toDataURL('image/png');
  }, job);
  return Buffer.from(url.split(',')[1], 'base64');
}
const P08 = { photo: 'people-08', crop: [0.17, 0.12, 0.43, 0.5], size: 256, faces: FACES['people-08'].faces.map((f) => f.packed) };
const P07 = { photo: 'people-07', crop: [0.32, 0.18, 0.4, 0.48], size: 256, faces: FACES['people-07'].faces.map((f) => f.packed) };

cases['registry: every retouch effect is registered with a complete schema, a valid section and an agent description'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const r = await page.evaluate((ids) => {
    const FX = window.LE.fx, d = FX.defs(), sections = ['Retouch', 'Geometry'];
    return ids.map((id) => {
      const e = d.find((x) => x.id === id);
      if (!e) return { id, missing: true };
      const bad = Object.keys(e.params).filter((k) => { const s = e.params[k]; return s.type === 'number' && !(s.default >= s.min && s.default <= s.max && s.step > 0); });
      return { id, section: sections.indexOf(e.ui.section) >= 0, summary: (e.agent.summary || '').length > 40, tips: (e.agent.tips || []).length >= 1, example: !!(e.agent.example && e.agent.example.type === id), bad, support: !!(window.LE.support && window.LE.support.get ? window.LE.support.get('fx.' + id) : true) };
    });
  }, IDS);
  for (const e of r) {
    h.assert(!e.missing, e.id + ' is registered');
    h.assert(e.section && e.summary && e.tips && e.example, e.id + ' has a section, summary, tips and example: ' + JSON.stringify(e));
    h.assert(!e.bad.length, e.id + ' number defaults inside their ranges: ' + e.bad);
  }
  h.assert.noErrors(page);
};

cases['neutral: every effect at its defaults is pixel-identical to no effect'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const none = await portrait(page, Object.assign({}, P08, { fx: [] }));
  for (const id of IDS) {
    const png = await portrait(page, Object.assign({}, P08, { fx: [{ type: id }] }));
    await fx.same(page, none, png, id + ' at defaults', { max: 0, over: 0 });
  }
  const card0 = await fx.render(page, { card: [256, 192], fx: [] });
  const card1 = await fx.render(page, { card: [256, 192], fx: IDS.map((t) => ({ type: t })) });
  await fx.same(page, card0, card1, 'the whole pack at defaults on the test card', { max: 0, over: 0 });
  h.assert.noErrors(page);
};

const GOLD = {
  'retouch-freqsep': { fx: [{ type: 'frequency-separation', p: { radius: 2, smooth: 60, smoothRadius: 6, evenColor: 40, texture: -20, lowArea: 'face' } }] },
  'retouch-freqsep-high': { fx: [{ type: 'frequency-separation', p: { radius: 2, view: 'high', method: 'edge' } }] },
  'retouch-bands': { fx: [{ type: 'detail-bands', p: { scale: 1, b1: 30, b4: -60, b5: -60, area: 'face' } }] },
  'retouch-portrait': { fx: [{ type: 'portrait-retouch', p: { smoothness: 60, texture: -10, blemishes: 60, eyes: 50, teeth: 50, lips: 25, shine: 50, contour: 30, size: 2.5 } }] },
  'retouch-skinmask': { fx: [{ type: 'portrait-retouch', p: { view: 'skin', size: 2.5 } }] },
  'retouch-dodge-burn': { fx: [{ type: 'dodge-burn', p: { mode: 'dodge', exposure: 60, range: 'midtones' }, mask: { parts: [{ kind: 'radial', cx: 0.62, cy: 0.35, rx: 0.15, ry: 0.2, feather: 0.6 }] } }, { type: 'dodge-burn', p: { mode: 'burn', exposure: 60, range: 'all' }, mask: { parts: [{ kind: 'radial', cx: 0.25, cy: 0.5, rx: 0.15, ry: 0.2, feather: 0.6 }] } }] },
  'retouch-heal-clone': { prep: '(layer, R) => { let p = LE.fx.defaults("spot-heal"); p = R.spots.add(p, { kind: "heal", r: 0.035, hardness: 0.3, dx: 0.12, dy: 0.05, points: [[0.62, 0.3]] }); p = R.spots.add(p, { kind: "clone", r: 0.03, hardness: 0.8, dx: -0.3, dy: 0, points: [[0.75, 0.75], [0.85, 0.8]] }); p = R.spots.add(p, { kind: "heal-polygon", r: 0.01, dx: 0, dy: -0.15, points: [[0.2, 0.7], [0.32, 0.68], [0.3, 0.82], [0.18, 0.8]] }); return [{ type: "spot-heal", p }]; }' },
  'retouch-liquify': { prep: '(layer, R) => { let p = LE.fx.defaults("liquify"); p = R.liquify.add(p, { tool: "forward", size: 0.08, pressure: 1, points: [[0.3, 0.5], [0.34, 0.52], [0.38, 0.54]] }); p = R.liquify.add(p, { tool: "bloat", size: 0.06, pressure: 1, points: Array(6).fill([0.62, 0.33]) }); p = R.liquify.add(p, { tool: "twirl-cw", size: 0.1, pressure: 1, points: Array(5).fill([0.8, 0.8]) }); return [{ type: "liquify", p }]; }' },
  'retouch-face-liquify': { prep: '(layer, R) => [{ type: "face-liquify", p: Object.assign({ jawline: -15, eyeSize: 12, smile: 15, noseWidth: -10 }, R.face.rig(layer, 1)) }]' },
  'retouch-shape-warp': { fx: [{ type: 'shape-warp', p: { mode: 'squeeze', amount: -40, center: { x: 0.5, y: 0.7 }, rx: 0.3, ry: 0.2 } }, { type: 'shape-warp', p: { mode: 'scale', amount: 40, center: { x: 0.25, y: 0.35 }, rx: 0.1, ry: 0.1 } }] }
};
cases['goldens: representative settings on a portrait at 256 px'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const none = await portrait(page, Object.assign({}, P08, { fx: [] }));
  for (const name of Object.keys(GOLD)) {
    const png = await portrait(page, Object.assign({}, P08, GOLD[name]));
    const d = await fx.diff(page, none, png);
    h.assert(d.max > 8, name + ' changes the picture (max ' + d.max + ')');
    await fx.golden(page, name, png);
  }
  h.assert.noErrors(page);
};

cases['tiles: spatial retouch effects export the same in one tile and in many'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  for (const name of ['retouch-freqsep', 'retouch-bands', 'retouch-portrait', 'retouch-heal-clone', 'retouch-liquify', 'retouch-face-liquify', 'retouch-shape-warp']) {
    const big = Object.assign({}, P07, GOLD[name], { size: 400 });
    const one = await portrait(page, big);
    const many = await portrait(page, Object.assign({}, big, { tile: 192 }));
    await fx.same(page, one, many, name + ' tiled at 192', { max: 3, over: 0.0005 });
  }
  h.assert.noErrors(page);
};

cases['masks: an entry mask, a layer mask and an adjustment layer each limit the effect'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, c = window.fxT.card(256, 192);
    const px = (cv, x, y) => Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data);
    const base0 = FX.apply(c, { fx: [] });
    const db = { type: 'dodge-burn', p: { mode: 'dodge', exposure: 100, range: 'all' } };
    const half = { parts: [{ kind: 'linear', x0: 0.45, y0: 0.5, x1: 0.55, y1: 0.5, feather: 0 }] };
    const em = FX.apply(c, { fx: [Object.assign({ mask: half }, db)] });
    const lm = FX.apply(c, { fx: [{ type: 'detail-bands', p: { b2: 100, b3: 100 } }], mask: half });
    return { em: [px(base0, 30, 150), px(em, 30, 150), px(base0, 230, 150), px(em, 230, 150)], lm: [px(lm, 230, 160), px(base0, 64, 150), px(lm, 64, 150)] };
  });
  h.assert(r.em[1][0] > r.em[0][0] + 20, 'dodge acts inside its entry mask: ' + r.em[0] + ' → ' + r.em[1]);
  h.assert.equal(r.em[3].join(), r.em[2].join(), 'and not outside it');
  h.assert(r.lm[0][3] === 0 && r.lm[2][3] === 255 && r.lm[2].join() !== r.lm[1].join(), 'a layer mask shows the detail-banded layer only where it selects: ' + JSON.stringify(r.lm));
  /* Adjustment layer in the studio: a dodge-and-burn layer from R.ops dodges only where its mask is painted (here: a radial part). */
  const sp = await h.studioWithSample(browser, base, 'desktop');
  await sp.evaluate(() => window.LE.fxBoot.load());
  const st = await sp.evaluate(async () => {
    const s = window.LEStudio.scene, FX = window.LE.fx, R = FX.retouch;
    const op = R.ops.dodgeBurnLayer(s.toJSON(), { exposure: 100 });
    const res = FX.ops.apply(s.toJSON(), op);
    const adj = res.doc.layers.find((l) => l.type === 'adjust');
    adj.fx[0].mask.parts.push({ kind: 'radial', mode: 'add', cx: 0.3, cy: 0.5, rx: 0.15, ry: 0.15, feather: 0.2, density: 1 });
    const before = await s.render(0.25);
    s.add(adj);
    await new Promise((r) => setTimeout(r, 600));
    const after = await s.render(0.25);
    const L = (cv, fx2, fy) => { const d = cv.getContext('2d').getImageData(Math.round(fx2 * cv.width), Math.round(fy * cv.height), 1, 1).data; return d[0] + d[1] + d[2]; };
    return { ok: res.ok, n: adj.fx.length, inA: L(before, 0.3, 0.5), inB: L(after, 0.3, 0.5), outA: L(before, 0.8, 0.5), outB: L(after, 0.8, 0.5) };
  });
  h.assert(st.ok && st.n === 2, 'dodgeBurnLayer makes an adjustment layer with two entries');
  h.assert(st.inB > st.inA + 15, 'the adjustment layer dodges inside the painted area: ' + st.inA + ' → ' + st.inB);
  h.assert(Math.abs(st.outB - st.outA) <= 3, 'and nothing outside it: ' + st.outA + ' → ' + st.outB);
  h.assert.noErrors(page);
};

cases['ops and data: agent operations round-trip through LE.fx.ops (add, update, reorder, remove) and the packed records'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const r = await page.evaluate((faces) => {
    const FX = window.LE.fx, R = FX.retouch, O = FX.ops;
    let doc = { width: 1000, height: 800, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 1000, h: 800, maps: { face: faces } }] };
    const out = {};
    let s = O.apply(doc, R.ops.heal(doc, 'a', { x: 0.4, y: 0.3, r: 0.01, source: { dx: 0.05, dy: 0 } })); out.add = s.ok; doc = s.doc;
    s = O.apply(doc, R.ops.clone(doc, 'a', { points: [[0.1, 0.1], [0.2, 0.15], [0.3, 0.1]], r: 0.02, dx: 0.1, dy: 0.2 })); out.update = s.ok && s.doc.layers[0].fx.length === 1; doc = s.doc;
    const recs = R.spots.read(doc.layers[0].fx[0].p);
    out.recs = recs.map((q) => [q.kind, q.points.length, Math.round(q.dx * 1000) / 1000, Math.round(q.points[0][0] * 1e4) / 1e4]);
    s = O.apply(doc, R.ops.liquify(doc, 'a', { tool: 'forward', points: [[0.5, 0.5], [0.52, 0.5]], size: 0.05 })); doc = s.doc;
    s = O.apply(doc, R.ops.face(doc, 'a', { jawline: -8 }, { face: 1 })); out.face = s.ok; doc = s.doc;
    out.rig = R.face.readRig(doc.layers[0].fx[2].p).length;
    s = O.apply(doc, { op: 'fx.reorder', layer: 'a', id: doc.layers[0].fx[2].id, index: 0 }); out.reorder = s.ok && s.doc.layers[0].fx[0].type === 'face-liquify'; doc = s.doc;
    s = O.apply(doc, { op: 'fx.remove', layer: 'a', id: doc.layers[0].fx[0].id }); out.remove = s.ok && s.doc.layers[0].fx.length === 2; doc = s.doc;
    out.liq = R.liquify.read(doc.layers[0].fx[1].p).map((q) => [q.tool, q.points.length]);
    /* The scene sanitiser keeps the data slots intact. */
    const json = JSON.parse(JSON.stringify(doc));
    out.same = JSON.stringify(R.spots.read(json.layers[0].fx[0].p)) === JSON.stringify(recs);
    /* Capacity: records past the cap are refused, not corrupted. */
    let p = FX.defaults('spot-heal'); for (let i = 0; i < 300; i++) p = R.spots.add(p, { kind: 'heal', r: 0.01, x: (i % 30) / 30, y: Math.floor(i / 30) / 12 });
    out.cap = R.spots.read(p).length; out.used = R.spots.used(p);
    out.v = FX.validate({ type: 'spot-heal', p }).ok;
    out.dbl = R.ops.dodgeBurnLayer(doc).op;
    out.redeye = R.ops.redEye(doc, 'a', { face: 1 }).entry.p.radius > 0;
    return out;
  }, FACES['people-08'].faces.map((f) => f.packed));
  h.assert(r.add && r.update, 'heal adds the entry, clone updates it');
  h.assert.equal(JSON.stringify(r.recs), JSON.stringify([['heal', 1, 0.05, 0.4], ['clone', 3, 0.1, 0.1]]), 'records read back quantised to 1e-4');
  h.assert(r.face && r.rig === 28, 'face op fills a 28-point rig: ' + r.rig);
  h.assert(r.reorder && r.remove, 'reorder and remove');
  h.assert.equal(JSON.stringify(r.liq), JSON.stringify([['forward', 2]]), 'liquify stroke stored');
  h.assert(r.same, 'records survive JSON');
  h.assert(r.cap > 150 && r.cap <= 256 && r.used <= 1 && r.v, 'cap: ' + r.cap + ' spots, ' + r.used);
  h.assert.equal(r.dbl, 'adjust.add');
  h.assert(r.redeye, 'red-eye from the face map');
  h.assert.noErrors(page);
};

cases['CPU references: liquify mesh, dodge curve, red-eye, frequency split and automatic spot source'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, R = FX.retouch, W = 256, H = 256, M = FX.math;
    /* A coordinate picture: red = x, green = y. The warped output tells where each pixel was sampled. */
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const id = x.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = (j * W + i) * 4; id.data[k] = i; id.data[k + 1] = j; id.data[k + 2] = 128; id.data[k + 3] = 255; }
    x.putImageData(id, 0, 0);
    let p = FX.defaults('liquify');
    p = R.liquify.add(p, { tool: 'bloat', size: 0.15, pressure: 1, points: Array(10).fill([0.5, 0.5]) });
    p = R.liquify.add(p, { tool: 'forward', size: 0.12, pressure: 1, points: [[0.2, 0.75], [0.26, 0.75]] });
    const m = R.liquify.mesh(R.liquify.read(p), W, H);
    const od = FX.apply(c, { fx: [{ type: 'liquify', p }] }).getContext('2d').getImageData(0, 0, W, H).data;
    let worst = 0, moved = 0;
    for (let j = 8; j < H - 8; j += 6) for (let i = 8; i < W - 8; i += 6) {
      const k = (j * W + i) * 4, d = R.liquify.sample(m, i + 0.5, j + 0.5);
      if (Math.hypot(d[0], d[1]) > 1) moved++;
      worst = Math.max(worst, Math.abs(od[k] - (i + d[0])), Math.abs(od[k + 1] - (j + d[1])));
    }
    /* Dodge with protect tones on a grey ramp: y = kx / (1 + (k − 1)x) in linear light, k = 2^(exposure). */
    const g = document.createElement('canvas'); g.width = 256; g.height = 1; const gx = g.getContext('2d');
    for (let i = 0; i < 256; i++) { gx.fillStyle = 'rgb(' + i + ',' + i + ',' + i + ')'; gx.fillRect(i, 0, 1, 1); }
    const dd = FX.apply(g, { fx: [{ type: 'dodge-burn', p: { mode: 'dodge', exposure: 50, range: 'all', protect: true } }] }).getContext('2d').getImageData(0, 0, 256, 1).data;
    let dodge = 0; const kk = Math.pow(2, 0.5);
    for (let i = 0; i < 256; i += 5) { const xl = M.srgbToLinear(i / 255), y = kk * xl / (1 + (kk - 1) * xl); dodge = Math.max(dodge, Math.abs(dd[i * 4] - M.linearToSrgb(y) * 255)); }
    /* Red-eye: a red disc turns neutral and dark; skin-coloured pixels next to it do not change. */
    const e = document.createElement('canvas'); e.width = 64; e.height = 64; const ex = e.getContext('2d'); ex.fillStyle = 'rgb(200,140,110)'; ex.fillRect(0, 0, 64, 64); ex.fillStyle = 'rgb(200,30,30)'; ex.beginPath(); ex.arc(32, 32, 6, 0, 7); ex.fill();
    const ed = FX.apply(e, { fx: [{ type: 'red-eye', p: { eye1: { x: 0.5, y: 0.5 }, radius: 12, darken: 50 } }] }).getContext('2d');
    const pupil = Array.from(ed.getImageData(32, 32, 1, 1).data), skin = Array.from(ed.getImageData(40, 32, 1, 1).data);
    /* Frequency split: texture −100 on the card equals the low band alone, which is a Gaussian (compare with gaussian-blur in display space). */
    const card = window.fxT.card(192, 128);
    const low = FX.apply(card, { fx: [{ type: 'frequency-separation', p: { radius: 3, view: 'low' } }] });
    const tex0 = FX.apply(card, { fx: [{ type: 'frequency-separation', p: { radius: 3, texture: -100 } }] });
    const a1 = low.getContext('2d').getImageData(0, 0, 192, 128).data, a2 = tex0.getContext('2d').getImageData(0, 0, 192, 128).data;
    let split = 0; for (let i = 0; i < a1.length; i += 4) split = Math.max(split, Math.abs(a1[i] - a2[i]), Math.abs(a1[i + 1] - a2[i + 1]));
    /* Automatic source: a dark spot on a smooth ramp next to a textured area picks a source on the smooth side at a matching tone. */
    const s = document.createElement('canvas'); s.width = 200; s.height = 200; const sx = s.getContext('2d');
    const grd = sx.createLinearGradient(0, 0, 0, 200); grd.addColorStop(0, '#d0a080'); grd.addColorStop(1, '#704830'); sx.fillStyle = grd; sx.fillRect(0, 0, 200, 200);
    for (let i = 0; i < 400; i++) { sx.fillStyle = i % 2 ? '#000' : '#fff'; sx.fillRect(130 + (i * 37) % 70, (i * 53) % 200, 3, 3); }
    sx.fillStyle = '#301000'; sx.beginPath(); sx.arc(60, 100, 6, 0, 7); sx.fill();
    const src = R.suggestSource(s, { x: 0.3, y: 0.5, r: 0.04 });
    return { worst, moved, dodge, pupil, skin, split, src };
  });
  h.assert(r.moved > 20, 'the strokes moved the mesh (' + r.moved + ' samples)');
  h.assert(r.worst <= 1.6, 'GPU warp matches the CPU mesh within 1.6 px: ' + r.worst);
  h.assert(r.dodge <= 2.5, 'dodge with protect tones follows its curve: ' + r.dodge);
  h.assert(Math.abs(r.pupil[0] - r.pupil[1]) < 25 && r.pupil[0] < 120, 'red pupil neutralised and darkened: ' + r.pupil);
  h.assert(r.skin[0] === 200 && r.skin[1] === 140, 'skin next to it unchanged: ' + r.skin);
  h.assert(r.split <= 1, 'texture −100 is exactly the low band: ' + r.split);
  h.assert(Math.abs(r.src.dy) < 0.06 && r.src.dx < 0.25 && (r.src.dx < 0 || r.src.dx * 200 + 60 < 125), 'automatic source stays on the smooth ramp at the same height: ' + JSON.stringify(r.src));
  h.assert.noErrors(page);
};

cases['draft: dragging renders the heavy skin effects quickly and refines on release'] = async ({ browser, base, h }) => {
  const page = await open(browser, base);
  const full = await portrait(page, Object.assign({}, P08, GOLD['retouch-portrait']));
  await page.evaluate(() => window.LE.fx.interactive(true));
  const draft = await portrait(page, Object.assign({}, P08, GOLD['retouch-portrait']));
  await page.evaluate(() => window.LE.fx.interactive(false));
  const again = await portrait(page, Object.assign({}, P08, GOLD['retouch-portrait']));
  const d = await fx.diff(page, full, draft);
  h.assert(d.mean < 6, 'the draft is close to the full render (mean ' + d.mean + ')');
  await fx.same(page, full, again, 'refined render after release', { max: 0, over: 0 });
  h.assert.noErrors(page);
};

/* ---------- Interface: the retouch tools in the Expert workspace ---------- */
async function studio(browser, base, o) {
  o = o || {};
  const w = o.w || 1440, hh = o.h || 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('le-studio-coach', '"done"'); } catch (e) {} });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await page.evaluate(async () => { const b = await (await fetch('/assets/photos/collage/people-07.jpg')).blob(); await window.LEStudio.newFromPhoto(new File([b], 'p.jpg', { type: 'image/jpeg' })); });
  await page.evaluate(() => { ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((c) => window.LE.support && window.LE.support.override(c, true)); });
  await page.evaluate(() => window.LEStudio.mode('expert'));
  await page.waitForFunction(() => window.LE.expert && window.LE.expert.active() && window.LE.expert.tools.get('heal') && !window.LE.expert.tools.get('heal').placeholder);
  await page.evaluate(() => window.LE.fxBoot.load());
  await page.waitForTimeout(300);
  return page;
}
async function stage(page) { return page.evaluate(() => { const r = document.querySelector('canvas.le-view').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }); }
const entries = (page) => page.evaluate(() => { const l = window.LEStudio.targetImage(); return (window.LEStudio.scene.layer(l.id).fx || []).map((e) => ({ type: e.type, p: e.p, mask: e.mask })); });
const undos = (page) => page.evaluate(() => window.LEStudio.scene._hist.undo.length);

cases['tools: heal (click, automatic source) and clone (Alt-click source, stroke); one stroke is one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  const b = await stage(page);
  const at = (fx2, fy) => [b.x + b.w * fx2, b.y + b.h * fy];
  /* Heal: a click heals a spot with an automatic source. */
  await page.keyboard.press('j');
  await page.waitForTimeout(400);
  h.assert.equal(await page.evaluate(() => window.LE.expert.tools.active()), 'heal', 'J activates Heal');
  let u0 = await undos(page);
  const [hx, hy] = at(0.5, 0.45);
  await page.mouse.click(hx, hy);
  await page.waitForTimeout(400);
  let e = await entries(page);
  let recs = await page.evaluate((p) => window.LE.fx.retouch.spots.read(p), e.find((x) => x.type === 'spot-heal').p);
  h.assert(recs.length === 1 && recs[0].kind === 'heal' && Math.abs(recs[0].points[0][0] - 0.5) < 0.05, 'a click stores one heal record: ' + JSON.stringify(recs));
  h.assert.equal(await undos(page), u0 + 1, 'one undo step');
  /* ] makes the brush bigger. */
  const s0 = await page.evaluate(() => window.LE.expert.lsGet('le-expert-spot', { size: 40 }).size);
  await page.keyboard.press(']');
  await page.waitForTimeout(100);
  h.assert(await page.evaluate(() => window.LE.expert.lsGet('le-expert-spot', { size: 40 }).size) > s0, '] enlarges the heal brush');
  /* Clone: Alt-click sets the source, a drag paints one record with that offset. */
  await page.keyboard.press('s');
  await page.waitForTimeout(300);
  const [sx, sy] = at(0.3, 0.3);
  await page.keyboard.down('Alt'); await page.mouse.click(sx, sy); await page.keyboard.up('Alt');
  u0 = await undos(page);
  const [cx, cy] = at(0.6, 0.6);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy + 10, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  e = await entries(page);
  recs = await page.evaluate((p) => window.LE.fx.retouch.spots.read(p), e.find((x) => x.type === 'spot-heal').p);
  h.assert(recs.length === 2 && recs[1].kind === 'clone' && recs[1].dx < -0.2 && recs[1].dy < -0.2, 'clone stroke with the Alt-click offset: ' + JSON.stringify(recs[1]));
  h.assert.equal(await undos(page), u0 + 1, 'one undo step for the clone stroke');
  h.assert.noErrors(page);
};

cases['tools: dodge and burn paint maps (X swaps), liquify strokes, each stroke one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base);
  const b = await stage(page);
  const at = (fx2, fy) => [b.x + b.w * fx2, b.y + b.h * fy];
  let u0, e;
  /* Dodge and burn: a stroke paints the dodge entry's mask; X swaps to burn. */
  await page.keyboard.press('o');
  await page.waitForTimeout(400);
  u0 = await undos(page);
  const [dx, dy] = at(0.4, 0.5);
  await page.mouse.move(dx, dy); await page.mouse.down(); await page.mouse.move(dx + 60, dy, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  await page.keyboard.press('x');
  await page.waitForTimeout(200);
  await page.mouse.move(dx, dy + 40); await page.mouse.down(); await page.mouse.move(dx + 60, dy + 40, { steps: 8 }); await page.mouse.up();
  /* Each stroke is stored as a PNG asset first (asynchronous): wait for both maps. */
  await page.waitForFunction(() => { const l = window.LEStudio.targetImage(); return (window.LEStudio.scene.layer(l.id).fx || []).filter((e) => e.type === 'dodge-burn' && e.mask && e.mask.parts.some((q) => q.kind === 'asset')).length === 2; }, null, { timeout: 30000 }).catch(() => {});
  e = await entries(page);
  const db = e.filter((x) => x.type === 'dodge-burn');
  h.assert(db.length === 2 && db[0].p.mode === 'dodge' && db[1].p.mode === 'burn' && db.every((x) => x.mask.parts.some((q) => q.kind === 'asset')), 'dodge and burn entries with painted maps: ' + JSON.stringify(db.map((x) => [x.p.mode, x.mask.parts.map((q) => q.kind)])));
  h.assert.equal(await undos(page), u0 + 2, 'two strokes, two undo steps');
  /* Liquify: a drag stores one forward-warp stroke; the whole drag is one undo step. */
  await page.evaluate(() => window.LE.expert.tools.activate('liquify'));
  await page.waitForTimeout(400);
  u0 = await undos(page);
  const [lx, ly] = at(0.5, 0.5);
  await page.mouse.move(lx, ly); await page.mouse.down(); await page.mouse.move(lx + 40, ly, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(500);
  e = await entries(page);
  const liq = await page.evaluate((p) => window.LE.fx.retouch.liquify.read(p), e.find((x) => x.type === 'liquify').p);
  h.assert(liq.length === 1 && liq[0].tool === 'forward' && liq[0].points.length >= 2, 'one forward-warp stroke: ' + JSON.stringify(liq.map((q) => [q.tool, q.points.length])));
  h.assert.equal(await undos(page), u0 + 1, 'the drag is one undo step');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  h.assert(!(await entries(page)).some((x) => x.type === 'liquify'), 'undo removes the stroke');
  h.assert.noErrors(page);
};

cases['tools at 390 px: heal works with a tap, the options fit, no sideways scroll'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, { w: 390, h: 844 });
  await page.evaluate(() => window.LE.expert.tools.activate('heal'));
  await page.waitForTimeout(400);
  const b = await stage(page);
  await page.touchscreen.tap(b.x + b.w * 0.5, b.y + b.h * 0.45);
  await page.waitForTimeout(500);
  const e = await entries(page);
  h.assert(e.some((x) => x.type === 'spot-heal'), 'a tap heals');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  h.assert.noErrors(page);
};

module.exports = cases;
