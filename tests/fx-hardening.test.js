'use strict';
/* LE.fx hardening: upload state, data parameters, oklab space, actions, data assets, the draw-time cache, exportLayer, pixel
   rescale, g.whole, the cut-out order, shared blurs, the working rectangle of small pictures and the face part names. */
const fx = require('./lib/fx');
const cases = {};

const px = (page, expr) => page.evaluate(expr);

cases['uploads: 3D and four-channel 1D tables arrive as written, also after a canvas upload'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT;
    FX.register({ id: 'test-lut4', version: 1, space: 'display', params: {}, passes: (g) => g.pass('uniform sampler2D u_l; vec4 fx(){ vec4 t = texture(u_l, vec2(v_uv.x, 0.5)); return vec4(t.rgb * t.a * 4.0, 1.0); }', { u_l: g.lut1d([0.8, 0.4, 0.2, 0.25, 0.8, 0.4, 0.2, 0.25], 4) }) });
    const cube = []; for (let b = 0; b < 2; b++) for (let gg = 0; gg < 2; gg++) for (let rr = 0; rr < 2; rr++) cube.push(1 - rr, gg, b * 0.5);
    FX.register({ id: 'test-lut3', version: 1, space: 'display', params: {}, passes: (g) => g.pass('uniform highp sampler3D u_c; vec4 fx(){ vec4 s = src(v_uv); return vec4(texture(u_c, s.rgb * 0.5 + 0.25).rgb, 1.0); }', { u_c: g.lut3d(cube, 2) }) });
    const at = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    const flat = document.createElement('canvas'); flat.width = flat.height = 32; const x = flat.getContext('2d'); x.fillStyle = 'rgb(255,0,255)'; x.fillRect(0, 0, 32, 32);
    FX.apply(T.card(64, 64, true), { fx: [{ type: 'exposure', p: { ev: 0.1 } }] });   /* a canvas upload first: it sets the unpack state */
    const a = at(FX.apply(flat, { fx: [{ type: 'test-lut4' }] }), 16, 16);
    const b = at(FX.apply(flat, { fx: [{ type: 'test-lut3' }] }), 16, 16);
    let err = 0; const gl = document.createElement('canvas').getContext('webgl2'); if (gl) err = gl.getError();
    return { a, b, err, warnings: FX.status().warnings };
  });
  /* With alpha 0.25 premultiplied on upload, rgb would arrive as 0.2, 0.1, 0.05 and this would read 51, 26, 13. */
  h.assert(Math.abs(r.a[0] - 204) <= 2 && Math.abs(r.a[1] - 102) <= 2 && Math.abs(r.a[2] - 51) <= 2, 'a four-channel 1D table keeps its colour and alpha apart: ' + r.a);
  /* Magenta (1, 0, 1) through the cube: r → 1 − r = 0, g stays 0, b → 0.5. */
  h.assert(r.b[0] <= 2 && r.b[1] <= 2 && Math.abs(r.b[2] - 128) <= 2, 'a 3D table uploads and samples: ' + r.b);
  h.assert.noErrors(page);
};

cases['data parameters: bounded number lists, validated twice, hashed for cache keys; the packed-curve form still reads'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => window.LE.fxBoot.load());
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, s = window.LEStudio.scene;
    FX.register({ id: 'test-data', version: 1, space: 'display', params: { pts: { type: 'data', max: 600, legacy: { prefix: 'd', params: 2 } }, wide: { type: 'data', max: 99999, range: [-1, 1], step: 0.01 }, n: { type: 'number', min: 0, max: 1 } }, passes: function () {} });
    const def = FX.describe('test-data');
    const clean = []; for (let i = 0; i < 300; i++) clean.push(Math.round(i / 300 * 10000) / 10000);
    const v1 = FX.validate({ type: 'test-data', p: { pts: clean } });
    const dirty = []; for (let i = 0; i < 700; i++) dirty.push(i % 7 === 0 ? 'x' : i % 5 === 0 ? 9 : i / 700 + 0.00001234);
    const v2 = FX.validate({ type: 'test-data', p: { pts: dirty, wide: [0.123456, -4, NaN, 0.5] } });
    const v3 = FX.validate({ type: 'test-data', p: { pts: 'nope' } });
    /* The first retouch pack's encoding: values ride as the y of curve points, the first the count / 10000. */
    const vals = [0.25, 0.5, 0.75, 0.125, 1, 0], all = [vals.length / 10000].concat(vals), old = {};
    ['d0', 'd1'].forEach((k, ki) => { old[k] = {}; ['master', 'r', 'g', 'b'].forEach((ch, c) => { const from = (ki * 4 + c) * 64, pts = []; for (let j = 0; j < 64 && from + j < all.length; j++) pts.push([j / 100, all[from + j]]); old[k][ch] = pts.length > 1 ? pts : [[0, 0], [1, 1]]; }); });
    const v4 = FX.validate({ type: 'test-data', p: old });
    /* Keys: a long list stands in as its hash; equal content, equal key; a changed number, another key. */
    const k1 = FX.keyOf([{ type: 'test-data', p: { pts: clean } }]), k2 = FX.keyOf([{ type: 'test-data', p: { pts: clean.slice() } }]), other = clean.slice(); other[150] = 0.9999;
    const k3 = FX.keyOf([{ type: 'test-data', p: { pts: other } }]);
    /* Through the scene: 4096 numbers survive, more are cut, anything else in a long list becomes 0, and one layer holds 16384. */
    const big = []; for (let i = 0; i < 5000; i++) big.push(i % 100 / 100);
    const id = s.add({ type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: { type: 'solid', color: '#ff0000' }, fx: [{ type: 'test-data', p: { pts: big, wide: big.map((x, i) => i === 3 ? 'evil' : i === 4 ? { a: 1 } : x) } }] });
    const kept = s.layer(id).fx[0].p;
    const many = []; for (let i = 0; i < 6; i++) many.push({ type: 'test-data', p: { pts: big.slice(0, 4000) } });
    const id2 = s.add({ type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: { type: 'solid', color: '#ff0000' }, fx: many });
    const lens = s.layer(id2).fx.map((e) => e.p.pts.length);
    const json = JSON.stringify(s.toJSON());
    return { def: def.params, schema: FX.schema().paramTypes, v1same: v1.entry.p.pts === clean, v1w: v1.warnings.length, v2: { n: v2.entry.p.pts.length, first: v2.entry.p.pts.slice(0, 8), wide: v2.entry.p.wide, w: v2.warnings.map((w) => w.code) }, v3: { pts: v3.entry.p.pts, w: v3.warnings.map((w) => w.code) }, v4: { pts: v4.entry.p.pts, w: v4.warnings },
      keys: [k1.length, k1 === k2, k1 !== k3, /#300\./.test(k1)], kept: [kept.pts.length, kept.wide.length, kept.wide[3], kept.wide[4], kept.wide[5]], lens, proto: json.indexOf('__proto__') < 0 };
  });
  h.assert(r.schema.indexOf('data') >= 0 && r.def.pts.max === 600 && r.def.pts.range.join() === '0,1' && r.def.pts.step === 0.0001 && r.def.wide.max === 4096, 'the type is described and its length capped at 4096: ' + JSON.stringify(r.def.wide));
  h.assert(r.v1same && r.v1w === 0, 'a clean list is kept as the same object');
  h.assert(r.v2.n === 600 && r.v2.first[0] === 0 && r.v2.first[1] === 0.0014 && r.v2.first[5] === 1 && r.v2.w.indexOf('clamped') >= 0, 'a dirty list is cut, clamped and quantised: ' + JSON.stringify(r.v2.first));
  h.assert.equal(r.v2.wide.join(), '0.12,-1,-1,0.5', 'range and step apply');
  h.assert(r.v3.pts.length === 0 && r.v3.w.indexOf('bad-value') >= 0, 'anything but a list falls back to empty');
  h.assert.equal(r.v4.pts.join(), '0.25,0.5,0.75,0.125,1,0', 'the packed-curve form of the first retouch pack is read');
  h.assert(r.v4.w.length === 0, 'without warnings about the old keys: ' + JSON.stringify(r.v4.w));
  h.assert(r.keys[0] < 200 && r.keys[1] && r.keys[2] && r.keys[3], 'cache keys carry the content hash, not the numbers: ' + r.keys);
  h.assert.equal(r.kept.join(), '4096,4096,0,0,0.05', 'the scene keeps 4096 numbers and nothing else');
  h.assert.equal(r.lens.join(), '4000,4000,4000,4000,0,0', 'one layer holds 16384 numbers; a list that does not fit is left out whole');
  h.assert.noErrors(page);
};

cases['oklab: fused colour operations can work in Oklab; neighbours convert once; the helpers match the reference'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, M = FX.math, T = window.fxT;
    /* Lightness × k and chroma × c, written against (L, a, b). */
    FX.register({ id: 'test-ok-a', version: 1, space: 'oklab', params: { k: { type: 'number', min: 0, max: 2, default: 1 } }, passes: (g, p) => { g.color('uniform float $k; vec3 $fx(vec3 c){ c.x *= $k; return c; }', { k: p.k }); } });
    FX.register({ id: 'test-ok-b', version: 1, space: 'oklab', params: { c: { type: 'number', min: 0, max: 2, default: 1 } }, passes: (g, p) => { g.color('uniform float $c; vec3 $fx(vec3 c){ c.yz *= $c; return c; }', { c: p.c }); } });
    FX.register({ id: 'test-ok-mixed', version: 1, space: 'linear', params: {}, passes: (g) => { g.color('vec3 $fx(vec3 c){ return c * 0.5; }'); g.color('vec3 $fx(vec3 c){ return fx_oklch_inv(fx_oklch(c)); }', {}, { space: 'oklab' }); } });
    const src = document.createElement('canvas'); src.width = 4; src.height = 1; const x = src.getContext('2d');
    const cols = [[200, 60, 40], [40, 160, 220], [128, 128, 128], [250, 240, 30]];
    cols.forEach((c, i) => { x.fillStyle = 'rgb(' + c.join(',') + ')'; x.fillRect(i, 0, 1, 1); });
    const read = (c) => Array.from(c.getContext('2d').getImageData(0, 0, 4, 1).data);
    const stats = () => FX.status().stats.passes;
    const p0 = stats();
    const one = read(FX.apply(src, { fx: [{ type: 'test-ok-a', p: { k: 0.8 } }] }));
    const p1 = stats();
    const two = read(FX.apply(src, { fx: [{ type: 'test-ok-a', p: { k: 0.8 } }, { type: 'test-ok-b', p: { c: 1.4 } }] }));
    const p2 = stats();
    const mixed = read(FX.apply(src, { fx: [{ type: 'test-ok-mixed' }] }));
    const ref = cols.map((c) => {
      const lab = M.oklab(c.map((v) => M.srgbToLinear(v / 255)));
      const lin = M.oklabInv([lab[0] * 0.8, lab[1] * 1.4, lab[2] * 1.4]);
      return lin.map((v) => Math.round(Math.min(1, Math.max(0, M.linearToSrgb(Math.min(1, Math.max(0, v))))) * 255));
    });
    const half = cols.map((c) => c.map((v) => Math.round(M.linearToSrgb(M.srgbToLinear(v / 255) * 0.5) * 255)));
    const rt = M.oklabInv(M.oklab([0.2, 0.5, 0.9]));
    return { one, two, mixed, ref, half, passes: [p1 - p0, p2 - p1], rt };
  });
  const worst = (got, want) => { let m = 0; want.forEach((c, i) => c.forEach((v, k) => { m = Math.max(m, Math.abs(got[i * 4 + k] - v)); })); return m; };
  h.assert(worst(r.two, r.ref) <= 2, 'two Oklab effects equal the JavaScript reference: ' + r.two + ' against ' + JSON.stringify(r.ref));
  h.assert.equal(r.passes[0], r.passes[1], 'the second Oklab effect joins the same pass: ' + r.passes);
  h.assert(worst(r.mixed, r.half) <= 2, 'an operation may choose its own space, and Oklch there and back is the identity: ' + r.mixed + ' against ' + JSON.stringify(r.half));
  h.assert(Math.abs(r.rt[0] - 0.2) < 1e-4 && Math.abs(r.rt[1] - 0.5) < 1e-4 && Math.abs(r.rt[2] - 0.9) < 1e-4, 'LE.fx.math.oklab and oklabInv are inverses');
  h.assert.noErrors(page);
};

cases['actions: buttons are declared in the registry and answer with operations; the document never carries code'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx;
    FX.actions.register({ id: 'test.double', label: 'Double it', needs: ['stats'], summary: 'Doubles the exposure.', run: (ctx) => ({ p: { ev: (ctx.entry.p.ev || 0) * 2 }, message: 'Doubled.' }) });
    FX.actions.register({ id: 'test.stack', label: 'Stack', run: () => ({ fx: [{ type: 'exposure', p: { ev: 0.3 } }, { type: 'grain', p: { amount: 10 } }] }) });
    FX.actions.register({ id: 'test.later', label: 'Later', kind: 'import', accept: '.txt', run: (ctx) => Promise.resolve({ download: { name: 'a.txt', text: ctx.text.toUpperCase(), type: 'text/plain' } }) });
    FX.actions.register({ id: 'test.throws', label: 'Throws', run: () => { throw new Error('boom'); } });
    let bad = []; [{ id: 'Bad Id', run: () => 0 }, { id: 'test.norun' }, { id: '__proto__', run: () => 0 }].forEach((d) => { try { FX.actions.register(d); bad.push('accepted'); } catch (e) { bad.push('refused'); } });
    const layer = { id: 'L1', fx: [{ id: 'e1', type: 'exposure', p: { ev: 0.5 } }] };
    const a = await FX.actions.run('test.double', { layer, entry: layer.fx[0], stack: layer.fx });
    const b = await FX.actions.run('test.stack', { layer, entry: layer.fx[0], stack: layer.fx });
    const c = await FX.actions.run('test.later', { layer, text: 'abc' });
    const d = await FX.actions.run('test.throws', { layer });
    const e = await FX.actions.run('nope', { layer });
    const auto = await FX.actions.run('grade.auto', { layer, stack: layer.fx, stats: await FX.analyze((() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96; const x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 128, 96); g.addColorStop(0, 'rgb(70,58,36)'); g.addColorStop(1, 'rgb(170,150,108)'); x.fillStyle = g; x.fillRect(0, 0, 128, 96); return cv; })()) });
    const list = FX.actions.list();
    const levels = FX.describe('levels').ui.controls.filter((x) => x && x.action);
    return { a, b, c, d, e, auto, bad, listed: list.filter((x) => /^test\./.test(x.id)), plain: JSON.stringify(list).indexOf('function') < 0, levels, schema: FX.schema().actions.length === list.length };
  });
  h.assert(r.a.ok && r.a.ops.length === 1 && r.a.ops[0].op === 'fx.update' && r.a.ops[0].layer === 'L1' && r.a.ops[0].id === 'e1' && r.a.ops[0].p.ev === 1 && r.a.message === 'Doubled.', 'a result with p updates the entry: ' + JSON.stringify(r.a));
  h.assert(r.b.ok && r.b.ops.length === 2 && r.b.ops[0].op === 'fx.update' && r.b.ops[0].id === 'e1' && r.b.ops[1].op === 'fx.add' && r.b.ops[1].entry.type === 'grain', 'a result with fx updates what is there and adds the rest: ' + JSON.stringify(r.b.ops));
  h.assert(r.c.ok && r.c.download.text === 'ABC' && r.c.ops.length === 0, 'promises and downloads: ' + JSON.stringify(r.c));
  h.assert(r.d.ok === false && /boom/.test(r.d.message) && r.e.ok === false, 'a failing or unknown action answers with a message');
  h.assert(r.auto.ok && r.auto.ops.length >= 1 && r.auto.ops.every((o) => /^fx\.(add|update)$/.test(o.op) && o.layer === 'L1'), 'the grading pack\'s auto answers with operations: ' + JSON.stringify(r.auto).slice(0, 300));
  h.assert.equal(r.bad.join(), 'refused,refused,refused', 'registrations are checked');
  h.assert(r.listed.length === 4 && r.listed.every((x) => x.id && x.label && x.kind && !x.run) && r.plain && r.schema, 'actions are listed as plain data: ' + JSON.stringify(r.listed));
  h.assert(r.levels.length === 1 && r.levels[0].action === 'grade.auto', 'an effect\'s ui names its actions');
  h.assert.noErrors(page);
};

cases['workspace: an action button applies its result as one undo step; a curve can hide its channel tabs'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const LE = window.LE, c = window.LEStudio, s = c.scene;
    const FX = await LE.fxBoot.load();
    FX.register({ id: 'test-one-curve', name: 'One curve', version: 1, space: 'display', params: { curve: { type: 'curve', label: 'Curve', ui: { channels: false } }, ev: { type: 'number', min: -5, max: 5, default: 0, label: 'EV' } }, ui: { section: 'Light', controls: ['curve', 'ev', { action: 'test.bump', label: 'Bump it' }] }, passes: function () {} });
    FX.actions.register({ id: 'test.bump', label: 'Bump', run: (ctx) => ({ p: { ev: 1.5 }, message: 'Bumped.' }) });
    const id = s.layers()[0].id;
    s.update(id, { fx: [{ id: 'e1', type: 'test-one-curve', p: {} }] });
    s.select([id]);
    ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((cap) => LE.support && LE.support.override(cap, true));
    c.mode('expert');
    for (let i = 0; i < 100 && !(LE.expert && LE.expert.active && LE.expert.active()); i++) await new Promise((res) => setTimeout(res, 50));
    await new Promise((res) => setTimeout(res, 300));
    LE.expert.workspace.components().develop.open('Light', true);
    await new Promise((res) => setTimeout(res, 200));
    const root = document.querySelector('#xp-right');
    const btn = root.querySelector('.xp-action[data-action="test.bump"]');
    const d0 = s._hist.undo.length;
    const tabs = root.querySelectorAll('[data-param="curve"] .xp-curve-ch, .xp-curve .xp-curve-ch').length, curves = root.querySelectorAll('.xp-curve').length;
    if (btn) btn.click();
    await new Promise((res) => setTimeout(res, 400));
    return { found: !!btn, label: btn ? btn.textContent.trim() : '', ev: s.layer(id).fx[0].p.ev, steps: s._hist.undo.length - d0, tabs, curves, sections: [LE.expert.SECTIONS.join('|'), FX.UI.sections.join('|')] };
  });
  h.assert(r.found && r.label === 'Bump it', 'the action is drawn as a button with its label: ' + JSON.stringify(r));
  h.assert(r.ev === 1.5 && r.steps === 1, 'one click, one undo step: ' + JSON.stringify(r));
  h.assert.equal(r.sections[0], r.sections[1], 'the workspace and the registry name the same sections, in the same order (LE.fx.UI is the source)');
  h.assert(r.curves >= 1 && r.tabs === 0, 'ui.channels false hides the channel tabs: ' + r.curves + ' curve(s), ' + r.tabs + ' with tabs');
  h.assert.noErrors(page);
};

cases['data assets: text stays text in the scene, loads for g.asset, and travels in .leproject and .ledesign.json'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const LE = window.LE, c = window.LEStudio, s = c.scene;
    const FX = await LE.fxBoot.load();
    const L = ['TITLE "Swap"', 'LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let rr = 0; rr < 2; rr++) L.push([b, g, rr].join(' '));
    const text = L.join('\n') + '\n';
    const meta = await FX.grade.importCube(text, 'swap.cube');
    const id = s.layers()[0].id;
    s.update(id, { fx: [{ id: 'look', type: 'lut', p: { lut: meta.id } }] });
    /* The scene keeps a text blob as it is: no picture decode, no error. */
    let decodeError = null;
    const key = s.addAsset('note-asset', new Blob(['hello'], { type: 'text/plain' }));
    const rec = s._assets[key];
    try { await rec.ready; } catch (e) { decodeError = String(e.message); }
    /* g.asset: null until loaded, then the text; the renderer is told to draw again. */
    FX.data.put('mem-1', 'abc');
    const got = FX.data('mem-1');
    c.syncProject();
    const project = c.S.project;
    if (!project) return { fail: 'no project' };
    const ids = LE.project.assetIds(project);
    /* .leproject */
    const file = await LE.project.exportFile(project, {});
    const blob = file.blob || file;
    const back = await LE.project.readFile(new File([blob], 'x.leproject'));
    if (!back || !back.project) return { fail: 'readFile' };
    const dataIds = Object.keys(back.project.data || {});
    const backText = back.data && back.data[meta.id] ? await back.data[meta.id].text() : null;
    /* .ledesign.json with everything embedded */
    const out = await LE.design.exportText(project, { images: 'embed' });
    const hasData = /"lut": "data:text\/plain;base64,/.test(out.text);
    const parsed = await LE.design.parse(out.text, {});
    if (!parsed || !parsed.project) return { fail: 'parse: ' + JSON.stringify(parsed && parsed.errors).slice(0, 400), hasData, text: out.text.slice(0, 300) };
    const layer = parsed.project.pages[0].layers.find((l) => Array.isArray(l.fx) && l.fx.length);
    const lutId = layer ? layer.fx[0].p.lut : null;
    const stored = lutId ? await LE.project.getAsset(lutId) : null;
    const storedText = stored ? await stored.text() : null;
    /* Embedded data is only accepted where a LUT parameter is, and only as text. */
    const evil = JSON.parse(out.text);
    const el = evil.pages[0].layers.find((l) => Array.isArray(l.fx) && l.fx.length);
    el.fx = [{ type: 'lut', p: { lut: 'data:text/html;base64,PHNjcmlwdD4=' } }];
    const html = await LE.design.parse(JSON.stringify(evil), {});
    el.fx = [{ type: 'lut', p: { lut: 'data:image/png;base64,QUJD' } }, { type: 'exposure', p: { ev: 'data:text/plain;base64,QUJD' } }];
    const p2 = await LE.design.parse(JSON.stringify(evil), {});
    if (!p2 || !p2.project) return { fail: 'parse 2: ' + JSON.stringify(p2 && p2.errors).slice(0, 500) };
    const l2 = p2.project.pages[0].layers.find((l) => Array.isArray(l.fx) && l.fx.length);
    return { meta: !!meta.id, inIds: ids.indexOf(meta.id) >= 0, blobKept: !!rec.blob && !rec.image, decodeError, got: got && got.text, dataIds, same: dataIds[0] === meta.id, backText: backText === text, hasData, lutId, sameId: lutId === meta.id, storedText: storedText === text,
      evil: l2.fx.map((e) => e.p), html: html.ok, warned: p2.warnings.filter((w) => w.kind === 'bad-data').length, bytes: out.text.length };
  });
  h.assert(!r.fail, 'round trip: ' + JSON.stringify(r).slice(0, 600));
  h.assert(r.meta && r.inIds, 'the LUT is a project asset the pages refer to');
  h.assert(r.blobKept && r.decodeError === null, 'a text blob is not decoded as a picture: ' + r.decodeError);
  h.assert.equal(r.got, 'abc', 'LE.fx.data holds loaded text for g.asset');
  h.assert(r.same && r.backText, '.leproject carries the data asset and it reads back byte for byte: ' + JSON.stringify(r.dataIds));
  h.assert(r.hasData && r.sameId && r.storedText, 'the open format embeds it as data and reading stores it again under the same id: ' + JSON.stringify([r.hasData, r.sameId, r.storedText]));
  h.assert(r.html === false, 'a file with HTML in a data: URI is refused whole');
  h.assert(r.evil[0].lut === null && typeof r.evil[1].ev === 'number' && r.warned >= 2, 'data that is not text, or not in a LUT parameter, is left out with a note: ' + JSON.stringify(r.evil) + ' ' + r.warned);
  h.assert.noErrors(page);
};

cases['draw time: adjustment layers are cached until something beneath, the stack or the view changes'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const LE = window.LE, c = window.LEStudio, s = c.scene;
    const FX = await LE.fxBoot.load();
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const adj = s.add({ type: 'adjust', fx: [{ id: 'sat', type: 'saturation', p: { saturation: -100 } }] });
    s.select([]);
    const hits = () => FX.status().stats.drawHits || 0, passes = () => FX.status().stats.passes;
    const redraw = async () => { s._mark(); s._draw && s._draw(); await frame(); };
    await redraw(); await redraw();
    const h0 = hits(), p0 = passes();
    await redraw(); await redraw(); await redraw();
    const still = [hits() - h0, passes() - p0];
    const first = s.layers()[0];
    const h1 = hits(), p1 = passes();
    s.update(first.id, { opacity: 0.5 }); await redraw();
    const beneath = [hits() - h1, passes() - p1];
    const h2 = hits(), p2 = passes();
    s.update(adj, { fx: [{ id: 'sat', type: 'saturation', p: { saturation: -50 } }] }); await redraw();
    const stack = [hits() - h2, passes() - p2];
    const h3 = hits();
    await redraw(); await redraw();
    const again = hits() - h3;
    const st = FX.status();
    const grey = (() => { const cv = s._canvas || document.querySelector('.stage canvas, canvas'); return !!cv; })();
    return { still, beneath, stack, again, mem: st.memory, grey };
  });
  h.assert(r.still[0] >= 3 && r.still[1] === 0, 'redraws with nothing changed come from the cache: ' + r.still);
  h.assert(r.beneath[1] > 0, 'a change beneath renders again: ' + r.beneath);
  h.assert(r.stack[1] > 0, 'a change to the stack renders again: ' + r.stack);
  h.assert(r.again >= 2, 'and is cached again: ' + r.again);
  h.assert(r.mem.drawCacheBytes > 0 && r.mem.drawCacheBytes <= Math.min(r.mem.budget / 8, 96 * 1048576), 'the cache lives inside the memory budget: ' + JSON.stringify(r.mem));
  h.assert.noErrors(page);
};

cases['exportLayer, pixel rescale and the layer box: effects on any layer export alone; px parameters follow a resize; radius sees the box'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const LE = window.LE, c = window.LEStudio, s = c.scene;
    const FX = await LE.fxBoot.load();
    const seen = [];
    FX.register({ id: 'test-invert', version: 1, space: 'display', params: {}, passes: (g) => { g.color('vec3 $fx(vec3 c){ return 1.0 - c; }'); } });
    FX.register({ id: 'test-box', version: 1, space: 'display', params: {}, radius: (p, scale, box) => { seen.push(box ? [box.w, box.h, scale] : null); return 0; }, passes: (g) => { g.color('vec3 $fx(vec3 c){ return c; }'); } });
    const id = s.add({ type: 'shape', shape: 'rect', x: 300, y: 200, w: 200, h: 100, rotation: 20, fill: { type: 'solid', color: '#ff0000' }, fx: [{ id: 'inv', type: 'test-invert' }, { id: 'bx', type: 'test-box' }] });
    const plain = s.add({ type: 'shape', shape: 'rect', x: 300, y: 400, w: 200, h: 100, fill: { type: 'solid', color: '#ff0000' } });
    const at = (cv, x, y) => Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data);
    const a = await s.exportLayer(id, { scale: 1 }), b = await s.exportLayer(plain, { scale: 1 });
    const ca = a.canvas || a, cb = b.canvas || b;
    /* px parameters and mask blurs follow a resize of the design; the rest stay. */
    const L = { id: 'x', fx: [{ id: 'b', type: 'gaussian-blur', p: { radius: 10 }, mask: { parts: [{ kind: 'radial', blur: 8, rx: 0.3 }] } }, { id: 'e', type: 'exposure', p: { ev: 1 } }, { id: 'big', type: 'gaussian-blur', p: { radius: 200 } }], layerMask: { parts: [{ kind: 'linear', blur: 4 }] } };
    const changed = FX.rescale(L, 2);
    const viaBoot = { id: 'y', fx: [{ id: 'b', type: 'gaussian-blur', p: { radius: 10 } }] };
    LE.fxBoot.rescale(viaBoot, 0.5);
    return { a: at(ca, Math.round(ca.width / 2), Math.round(ca.height / 2)), b: at(cb, Math.round(cb.width / 2), Math.round(cb.height / 2)), size: [ca.width, ca.height, cb.width, cb.height], box: seen.filter(Boolean).slice(-1)[0], nulls: seen.filter((x) => !x).length,
      rescaled: [L.fx[0].p.radius, L.fx[0].mask.parts[0].blur, L.fx[0].mask.parts[0].rx, L.fx[1].p.ev, L.fx[2].p.radius, L.layerMask.parts[0].blur, changed], boot: viaBoot.fx[0].p.radius };
  });
  h.assert.equal(r.b.join(), '255,0,0,255', 'a plain layer exports as before');
  h.assert.equal(r.a.join(), '0,255,255,255', 'a shape with effects exports with them: ' + r.a);
  h.assert(r.size[0] === r.size[2] && r.size[1] === r.size[3], 'at the same size (the result is cut at the box): ' + r.size);
  h.assert(r.box && r.box[0] === 200 && r.box[1] === 100 && r.nulls === 0, 'radius(p, scale, box) is given the layer box in document pixels: ' + JSON.stringify(r.box) + ', without: ' + r.nulls);
  h.assert.equal(r.rescaled.join(), '20,16,0.3,1,250,8,true', 'px parameters and mask blurs scale (inside their ranges), nothing else');
  h.assert.equal(r.boot, 5, 'LE.fxBoot.rescale is the scene\'s way in');
  h.assert.noErrors(page);
};

cases['g.whole: a low-resolution copy of the whole input is the same for every tile'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  await page.evaluate(() => {
    const FX = window.LE.fx;
    /* Mixes each pixel with the far side of the picture: impossible inside a tile's reach, exact through g.whole. */
    FX.register({ id: 'test-far', version: 1, space: 'display', params: {}, passes: (g) => { const w = g.whole({ maxSide: 256 }); return w ? g.pass('uniform sampler2D u_w; vec4 fx(){ vec2 b = boxUV(); vec4 far = texture(u_w, vec2(1.0 - b.x, 1.0 - b.y)); return mix(src(v_uv), far, 0.5); }', { u_w: w }) : g.source; } });
  });
  const stack = [{ type: 'exposure', p: { ev: 0.3 } }, { type: 'test-far' }];
  const one = await fx.render(page, { card: [1100, 700], fx: stack });
  const tiled = await fx.render(page, { card: [1100, 700], fx: stack, tile: 256 });
  const d = await fx.same(page, one, tiled, 'g.whole across tiles', { max: 2, over: 0.001 });
  const plain = await fx.render(page, { card: [1100, 700], fx: [{ type: 'exposure', p: { ev: 0.3 } }] });
  const moved = await fx.diff(page, one, plain, 8);
  h.assert(moved.over > 0.3, 'the effect does something: ' + JSON.stringify(moved));
  h.assert(d.max <= 2, 'tiles agree: ' + JSON.stringify(d));
  h.assert.noErrors(page);
};

cases['cut-out: with effects the cut-out comes first, so a blur never pulls removed background back in'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const LE = window.LE, c = window.LEStudio, s = c.scene;
    await LE.fxBoot.load();
    /* A red disc on pure green; the cut-out keeps the disc. */
    const pic = document.createElement('canvas'); pic.width = 400; pic.height = 400; const x = pic.getContext('2d');
    x.fillStyle = '#00ff00'; x.fillRect(0, 0, 400, 400); x.fillStyle = '#ff0000'; x.beginPath(); x.arc(200, 200, 140, 0, 7); x.fill();   /* wider than the mask: its own soft edge stays outside */
    const m = document.createElement('canvas'); m.width = 400; m.height = 400; const mx = m.getContext('2d');
    mx.fillStyle = '#fff'; mx.beginPath(); mx.arc(200, 200, 120, 0, 7); mx.fill();
    s.addAsset('disc', pic); s.addAsset('disc-mask', m);
    s.load({ v: 1, width: 400, height: 400, background: { type: 'color', color: '#000000' }, layers: [
      { id: 'cut', type: 'image', src: 'disc', x: 0, y: 0, w: 400, h: 400, cutout: { asset: 'disc-mask', feather: 0 }, fx: [{ type: 'gaussian-blur', p: { radius: 14 } }] }
    ] });
    const cv = await s.render(1), d = cv.getContext('2d').getImageData(0, 0, 400, 400).data;
    let green = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) { green = Math.max(green, d[i + 1]); red = Math.max(red, d[i]); }
    const at = (px, py) => Array.from(d.slice((py * 400 + px) * 4, (py * 400 + px) * 4 + 4));
    return { green, red, centre: at(200, 200), edge: at(200, 82), outside: at(200, 60), far: at(20, 20) };
  });
  h.assert(r.green <= 2, 'no green anywhere: the stack never saw the removed background (most green ' + r.green + ')');
  h.assert(r.centre[0] >= 250 && r.far.slice(0, 3).join() === '0,0,0', 'the subject is there and the page shows around it');
  h.assert(r.edge[0] > 60 && r.edge[0] < 220 && r.outside[0] > 2 && r.outside[0] < 120, 'the blur softens the cut edge itself, inside and out: ' + r.edge + ' / ' + r.outside);
  h.assert.noErrors(page);
};

cases['shared blurs and small pictures: one blur per input and radius inside a run; a tiny picture under a very wide stack stays tiny'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT;
    /* Asks for the same blur three times and two more radii of the same input (as a band split does). */
    FX.register({ id: 'test-bands', version: 1, space: 'linear', params: {}, radius: (p, s) => FX.math.blurReach(24 * s),
      passes: (g) => { const a = g.blur(6), b = g.blur(6), c = g.blur(6), d = g.blur(12), e = g.blur(24); const out = g.pass('uniform sampler2D u_a, u_b, u_c, u_d, u_e; vec4 fx(){ return (texture(u_a, v_uv) + texture(u_b, v_uv) + texture(u_c, v_uv)) / 3.0 * 0.5 + texture(u_d, v_uv) * 0.25 + texture(u_e, v_uv) * 0.25; }', { u_a: a, u_b: b, u_c: c, u_d: d, u_e: e }); [a, b, c, d, e].forEach((x) => g.release(x)); return out; } });
    const src = T.card(512, 384), stack = [{ type: 'test-bands' }];
    const count = () => FX.status().stats.passes;
    let p = count(); const shared = T.png(FX.apply(src, { fx: stack })); const withShare = count() - p; const hits = FX.status().stats.shared;
    FX.configure({ shareBlur: false });
    p = count(); const alone = T.png(FX.apply(src, { fx: stack })); const without = count() - p;
    FX.configure({ shareBlur: true });
    /* 64 pixels under a stack that reads thousands. */
    const tiny = T.card(64, 64), wide = [{ type: 'gaussian-blur', p: { radius: 250 } }, { type: 'gaussian-blur', p: { radius: 250 } }, { type: 'gaussian-blur', p: { radius: 250 } }];
    FX.profile(true);
    const out = FX.apply(tiny, { fx: wide });
    const prof = FX.profile(false) || [];
    const side = prof.reduce((m, q) => Math.max(m, q.w, q.h), 0);
    const mid = Array.from(out.getContext('2d').getImageData(32, 32, 1, 1).data);
    return { shared, alone, withShare, without, hits, side, n: prof.length, size: [out.width, out.height], mid };
  });
  const d = await fx.diff(page, Buffer.from(r.shared.split(',')[1], 'base64'), Buffer.from(r.alone.split(',')[1], 'base64'), 0);
  h.assert(d.max === 0, 'sharing changes no pixel: ' + JSON.stringify(d));
  h.assert(r.withShare < r.without && r.hits >= 2, 'fewer passes with sharing: ' + r.withShare + ' against ' + r.without + ' (' + r.hits + ' shared)');
  h.assert(r.side > 0 && r.side <= 512, 'a 64-pixel picture is worked on in a rectangle of at most 512 pixels, whatever the stack reads: ' + r.side);
  h.assert(r.size.join() === '64,64' && r.mid[3] === 255, 'and still renders: ' + r.size + ' ' + r.mid);
  h.assert.noErrors(page);
};

cases['face masks: part names are hyphenated in documents, LE.maps names are accepted, and the renderer asks LE.maps in its own words'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT, asked = [];
    const a = FX.cleanMask({ parts: [{ kind: 'face', part: 'underEyes' }, { kind: 'face', part: 'under-eyes' }, { kind: 'face', part: 'innerMouth' }, { kind: 'face', part: 'nose' }] });
    window.LE.maps = { faceMask: (face, part, w, hh) => { asked.push(part); const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); if (face.parts[part]) { x.fillStyle = '#fff'; x.fillRect(0, 0, w / 2, hh); } return c; } };
    FX.register({ id: 'test-invert', version: 1, space: 'display', params: {}, passes: (g) => { g.color('vec3 $fx(vec3 c){ return 1.0 - c; }'); } });
    const src = T.card(128, 96), layer = { id: 'p', maps: { face: { parts: { underEyes: { rings: [] } } } } };
    const out = FX.apply(src, { fx: [{ type: 'test-invert', mask: { parts: [{ kind: 'face', part: 'under-eyes' }] } }], layer });
    const base = src.getContext('2d').getImageData(0, 0, 128, 96).data, got = out.getContext('2d').getImageData(0, 0, 128, 96).data;
    const changed = (x, y) => { const i = (y * 128 + x) * 4; return Math.abs(base[i] - got[i]) + Math.abs(base[i + 1] - got[i + 1]) + Math.abs(base[i + 2] - got[i + 2]) > 30; };
    delete window.LE.maps;
    return { parts: a.mask.parts.map((p) => p.part), warnings: a.warnings.map((w) => w.code), asked, left: changed(20, 60), right: changed(110, 60), schema: FX.schema().faceParts };
  });
  h.assert.equal(r.parts.join(), 'under-eyes,under-eyes,inner-mouth', 'both spellings are read, the hyphenated one is stored, unknown parts are left out');
  h.assert(r.schema.indexOf('under-eyes') >= 0 && r.schema.indexOf('inner-mouth') >= 0 && r.schema.indexOf('underEyes') < 0, 'schema() lists the stored names');
  h.assert(r.asked.length >= 1 && r.asked.every((p) => p === 'underEyes'), 'LE.maps is asked for underEyes: ' + r.asked);
  h.assert(r.left && !r.right, 'and the mask selects that area: ' + r.left + ' ' + r.right);
  h.assert.noErrors(page);
};

cases['maps as inputs: g.map gives depth, subject, face and segments at full precision; the segment mask kind; the cut-out is read the legacy way'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT, seen = {};
    const flat = (w, hh, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; paint(c.getContext('2d'), w, hh); return c; };
    /* A 16-bit depth ramp (high byte in red, low byte in green), near = 1 at the right. */
    const depth = flat(256, 4, (x, w, hh) => { const im = x.createImageData(w, hh); for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { const v = Math.round(i / (w - 1) * 65535), k = (j * w + i) * 4; im.data[k] = v >> 8; im.data[k + 1] = v & 255; im.data[k + 3] = 255; } x.putImageData(im, 0, 0); });
    /* Segments: person on the left half (red), hair in the top-left quarter (green), skin nowhere; clothes bottom-left. */
    const seg = flat(64, 64, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 32, 64); x.fillStyle = '#ffff00'; x.fillRect(0, 0, 32, 32); });
    const clothes = flat(64, 64, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(0, 32, 32, 32); });
    /* A cut-out mask with transparency and a colour: the mask is its alpha, not its colour. */
    const cut = flat(64, 64, (x) => { x.fillStyle = 'rgba(20, 40, 200, 1)'; x.fillRect(0, 0, 32, 64); });
    const assets = { d: depth, s: seg, c: clothes, k: cut };
    const layer = { id: 'p', maps: { depth: { asset: 'd' }, segments: { asset: 's', clothes: { asset: 'c' } } }, cutout: { asset: 'k' } };
    FX.register({ id: 'test-map', version: 1, space: 'display', params: { kind: { type: 'choice', options: ['depth', 'subject', 'segments', 'face'] } },
      passes: (g, p) => { const m = g.map(p.kind, { part: 'skin' }), again = g.map(p.kind, { part: 'skin' }); seen[p.kind] = { missing: !!m.missing, same: m === again }; return g.pass('uniform sampler2D u_m; vec4 fx(){ vec4 m = texture(u_m, v_uv); return vec4(m.rgb, 1.0) * 0.5 + vec4(vec3(m.a), 1.0) * 0.5; }', { u_m: m }); } });
    const src = flat(256, 64, (x) => { x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 64); });
    const row = (c, y) => { const d = c.getContext('2d').getImageData(0, y, c.width, 1).data, out = []; for (let i = 0; i < d.length; i += 4) out.push(d[i]); return out; };
    const at = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    const opt = { layer, assets: (id) => assets[id] || null };
    const dep = FX.apply(src, Object.assign({ fx: [{ type: 'test-map', p: { kind: 'depth' } }] }, opt));
    const ramp = row(dep, 32); let mono = true, steps = 0; for (let i = 1; i < ramp.length; i++) { if (ramp[i] < ramp[i - 1]) mono = false; if (ramp[i] !== ramp[i - 1]) steps++; }
    const sub = FX.apply(src, Object.assign({ fx: [{ type: 'test-map', p: { kind: 'subject' } }] }, opt));
    const sg = FX.apply(src, Object.assign({ fx: [{ type: 'test-map', p: { kind: 'segments' } }] }, opt));
    const none = FX.apply(src, { fx: [{ type: 'test-map', p: { kind: 'depth' } }, { type: 'test-map', p: { kind: 'segments' } }], layer: { id: 'q' } });
    /* The segment mask kind and the subject kind, as masks on an effect. */
    FX.register({ id: 'test-white', version: 1, space: 'display', params: {}, passes: (g) => { g.color('vec3 $fx(vec3 c){ return vec3(1.0); }'); } });
    const m = (part) => FX.apply(src, Object.assign({ fx: [{ type: 'test-white', mask: { parts: [part] } }] }, opt));
    const person = m({ kind: 'segment', class: 'person' }), bg = m({ kind: 'segment', class: 'background' }), cl = m({ kind: 'segment', class: 'clothes' }), subj = m({ kind: 'subject' });
    const bad = FX.cleanMask({ parts: [{ kind: 'segment', class: 'dog' }, { kind: 'segment', class: 'hair' }] });
    return { ramp: [ramp[0], ramp[128], ramp[255], mono, steps], seen, sub: [at(sub, 40, 32)[0], at(sub, 200, 32)[0]], sg: [at(sg, 40, 10), at(sg, 40, 50), at(sg, 200, 32)], none: at(none, 100, 32), missing: seen,
      person: [at(person, 40, 32)[0], at(person, 200, 32)[0]], bg: [at(bg, 40, 32)[0], at(bg, 200, 32)[0]], cl: [at(cl, 40, 10)[0], at(cl, 40, 50)[0]], subj: [at(subj, 40, 32)[0], at(subj, 200, 32)[0]],
      bad: bad.mask.parts.map((q) => q.class), kinds: FX.schema().maskKinds.map((k) => k.kind), segs: FX.schema().segments, warned: JSON.stringify(FX.status().warnings) };
  });
  /* The test effect shows value × 0.5 + alpha × 0.5; the depth handle has alpha 1. */
  h.assert(Math.abs(r.ramp[0] - 128) <= 1 && Math.abs(r.ramp[1] - 191) <= 2 && r.ramp[2] === 255 && r.ramp[3] && r.ramp[4] >= 100, 'depth arrives as stored, monotonic, without the steps of a mask round trip: ' + r.ramp);
  h.assert(r.seen.depth.same && r.seen.segments.same, 'a map is computed once per run');
  h.assert(r.sub[0] === 255 && Math.abs(r.sub[1] - 128) <= 1, 'the subject map is the cut-out\'s alpha whatever its colour: ' + r.sub);
  h.assert(Math.abs(r.sg[0][0] - 128) <= 1 && Math.abs(r.sg[0][1] - 128) <= 1 && r.sg[0][2] <= 1 && r.sg[1][0] === 255 && Math.abs(r.sg[1][1] - 128) <= 1 && r.sg[2][0] <= 1, 'segments carry person, hair, skin and clothes: ' + JSON.stringify(r.sg));
  h.assert(r.person[0] === 255 && r.person[1] < 140 && r.bg[0] < 140 && r.bg[1] === 255 && r.cl[0] < 140 && r.cl[1] === 255, 'the segment mask kind selects a class: ' + JSON.stringify([r.person, r.bg, r.cl]));
  h.assert(r.subj[0] === 255 && r.subj[1] < 140, 'a coloured cut-out mask with transparency selects by its alpha, as the simple studio does: ' + r.subj);
  h.assert(!/depth|segment/.test(r.warned), 'a missing map raises no warning through g.map: ' + r.warned);
  h.assert.equal(r.bad.join(), 'hair', 'unknown classes are left out');
  h.assert(r.kinds.indexOf('segment') >= 0 && r.segs.join() === 'person,hair,skin,clothes,background', 'schema() lists the kind and its classes');
  h.assert.noErrors(page);
};

cases['silhouette stage: g.subject is the layer as it entered the stage, g.whole works there, and both ignore earlier silhouette entries'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  await page.evaluate(() => {
    const FX = window.LE.fx;
    /* Paints everything outside the silhouette red (a stand-in for a shadow or a reflection). */
    FX.register({ id: 'test-fill-out', version: 1, space: 'display', needs: ['alpha'], params: {}, grow: () => 0, passes: (g) => g.pass('vec4 fx(){ vec4 s = src(v_uv); return s + vec4(1.0, 0.0, 0.0, 1.0) * (1.0 - s.a); }') });
    /* Shows what it is told the subject is: white where g.subject has alpha; blue where the reduced whole has alpha instead. */
    FX.register({ id: 'test-show-subject', version: 1, space: 'display', needs: ['alpha'], params: { whole: { type: 'bool', default: false } }, grow: () => 0,
      passes: (g, p) => p.whole ? g.pass('uniform sampler2D u_w; vec4 fx(){ float a = texture(u_w, boxUV()).a; return vec4(0.0, 0.0, a, 1.0); }', { u_w: g.whole({ maxSide: 128 }) }) : g.pass('uniform sampler2D u_s; vec4 fx(){ float a = texture(u_s, v_uv).a; return vec4(a, a, a, 1.0); }', { u_s: g.subject() }) });
  });
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, T = window.fxT;
    const src = T.card(256, 192, true);   /* a transparent disc near the top left */
    const at = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    const hole = [Math.round(256 * 0.2), Math.round(192 * 0.3)], solid = [200, 150];
    const a = FX.apply(src, { fx: [{ type: 'test-fill-out' }, { type: 'test-show-subject' }] });
    const b = FX.apply(src, { fx: [{ type: 'test-fill-out' }, { type: 'test-show-subject', p: { whole: true } }] });
    const tiled = FX.apply(T.card(1100, 700, true), { fx: [{ type: 'test-fill-out' }, { type: 'test-show-subject', p: { whole: true } }], tile: 256 });
    return { a: [at(a, hole[0], hole[1]), at(a, solid[0], solid[1])], b: [at(b, hole[0], hole[1]), at(b, solid[0], solid[1])], tiled: [at(tiled, Math.round(1100 * 0.2), Math.round(700 * 0.3)), at(tiled, 900, 600)] };
  });
  h.assert(r.a[0][0] <= 2 && r.a[1][0] === 255, 'g.subject still has the hole the first silhouette entry painted over: ' + JSON.stringify(r.a));
  h.assert(r.b[0][2] <= 2 && r.b[1][2] === 255 && r.b[1][0] === 0, 'g.whole in the silhouette stage is the layer as it entered the stage: ' + JSON.stringify(r.b));
  h.assert(r.tiled[0][2] <= 2 && r.tiled[1][2] === 255, 'and the same in every tile: ' + JSON.stringify(r.tiled));
  h.assert.noErrors(page);
};

cases['workspace: the Shadows and reflections section opens with the five staging presets; one tap stages the product in one undo step'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const LE = window.LE, c = window.LEStudio, s = c.scene;
    const FX = await LE.fxBoot.load();
    const id = s.layers()[0].id;
    s.select([id]);
    ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((cap) => LE.support && LE.support.override(cap, true));
    c.mode('expert');
    for (let i = 0; i < 100 && !(LE.expert && LE.expert.active && LE.expert.active()); i++) await new Promise((res) => setTimeout(res, 50));
    await new Promise((res) => setTimeout(res, 300));
    LE.expert.workspace.components().develop.open('Shadows & reflections', true);
    await new Promise((res) => setTimeout(res, 300));
    const btns = Array.from(document.querySelectorAll('#xp-right .xp-action[data-action="composite.stage"]'));
    const d0 = s._hist.undo.length;
    const hit = btns.find((b) => b.dataset.preset === 'soft-table-reflection');
    if (hit) hit.click();
    await new Promise((res) => setTimeout(res, 600));
    return { presets: btns.map((b) => b.dataset.preset), labels: btns.map((b) => b.textContent.trim()), known: Object.keys(FX.composite.presets), names: Object.keys(FX.composite.presets).map((k) => FX.composite.presets[k].name), fx: (s.layer(id).fx || []).map((e) => e.type), steps: s._hist.undo.length - d0 };
  });
  h.assert.equal(r.presets.join(), r.known.join(), 'one button per staging preset');
  h.assert.equal(r.labels.join(), r.names.join(), 'labelled with the preset names');
  h.assert(r.fx.length >= 2 && r.steps === 1, 'one tap applies the preset as one undo step: ' + JSON.stringify(r.fx) + ', steps ' + r.steps);
  h.assert.noErrors(page);
};

module.exports = cases;
