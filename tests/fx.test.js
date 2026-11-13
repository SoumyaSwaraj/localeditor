'use strict';
/* Expert effect renderer (LE.fx, step X0a): registry, sanitisers, goldens, tiles, determinism, preview and export, the 8-bit
   path, context loss, memory, the studio seam (lazy loading, legacy pixel stability, undo, project and open-format round trips),
   document operations and analysis. Helpers: tests/lib/fx.js. Goldens: tests/golden/fx/ (FX_GOLDEN=update rewrites them). */
const fx = require('./lib/fx');

const cases = {};
const CARD = { card: [256, 192] };
const STARTER = ['exposure', 'contrast', 'highlights-shadows', 'levels', 'curves', 'white-balance', 'saturation', 'gaussian-blur', 'grain', 'drop-shadow'];

cases['registry: the starter set is registered, described and declared to LE.support'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, index = FX.describe(), full = FX.defs(), v0 = FX.version();
    const sameObjects = FX.describe('exposure') === FX.describe('exposure') && FX.defs() === full && FX.describe() === index;
    let frozen = false; try { 'use strict'; full[0].params.x = 1; frozen = !('x' in full[0].params); } catch (e) { frozen = true; }
    FX.register({ id: 'test-late', version: 1, params: {}, passes: function () {} });
    return {
      list: FX.list(), index, full, schema: FX.schema(), UI: FX.UI, defaults: FX.defaults('levels'), unknown: FX.get('nope'), none: FX.describe('nope'),
      one: FX.describe('gaussian-blur'), group: FX.describe({ group: 'light' }).map((e) => e.id), section: FX.describe({ section: 'Optics' }).map((e) => e.id), ids: FX.describe({ ids: ['grain', 'levels'] }).map((e) => e.id),
      sameObjects, frozen, moved: FX.version() > v0 && FX.describe().length === index.length + 1 && FX.defs() !== full,
      support: FX.list().filter((id) => (window.LE.support && window.LE.support.get ? !!window.LE.support.get('fx.' + id) : (window.LE_SUPPORT_DEFS || []).some((x) => x.id === 'fx.' + id))).map((id) => 'fx.' + id),
      sizes: { index: JSON.stringify(index).length, schema: JSON.stringify(FX.schema()).length, largest: full.map((e) => [JSON.stringify(e).length, e.id]).sort((a, b) => b[0] - a[0])[0] },
      hasFns: JSON.stringify(full).indexOf('function (') >= 0
    };
  });
  STARTER.forEach((id) => h.assert(r.list.indexOf(id) >= 0, 'missing effect ' + id));
  h.assert(r.unknown === null && r.none === null && r.defaults.gamma === 1 && r.defaults.inWhite === 1, 'defaults');
  /* The words of the ui grammar come from one exported constant, LE.fx.UI. */
  const UI = r.UI;
  r.full.forEach((e) => {
    h.assert(e.name && e.group && e.version >= 1 && UI.spaces.indexOf(e.space) >= 0, e.id + ' basics');
    h.assert(e.ui && e.ui.section && e.agent && e.agent.summary && e.agent.example && e.agent.example.type === e.id, e.id + ' needs ui and agent descriptors');
    h.assert(e.support.needs.indexOf('webgl2') >= 0, e.id + ' declares what a device needs');
    Object.keys(e.params).forEach((k) => h.assert(r.schema.paramTypes.indexOf(e.params[k].type) >= 0 && e.params[k].label, e.id + '.' + k));
    h.assert(UI.sections.indexOf(e.ui.section) >= 0, e.id + ' uses a workspace section name: ' + e.ui.section);
    (e.ui.controls || []).forEach((c) => {
      const has = (k) => !!e.params[k];
      const ok = typeof c === 'string' ? has(c) : c.heading ? true : c.action ? r.schema.actions.some((a) => a.id === c.action) : c.row ? c.row.every((k) => has(typeof k === 'string' ? k : k.param)) :
        c.control === 'mixer' ? Object.keys(c.rows || {}).every((row) => c.rows[row].every(has)) : UI.composite.indexOf(c.control) >= 0 ? (c.params || []).length > 0 && c.params.every(has) :
        has(c.param) && (!c.control || UI.controls.indexOf(c.control) >= 0);
      h.assert(ok, e.id + ' ui.controls follows docs/EXPERT-UI.md: ' + JSON.stringify(c));
    });
  });
  h.assert(r.one.spatial === true && r.full.find((e) => e.id === 'exposure').spatial === false, 'spatial flag');
  /* describe() is a compact index; detail is asked for by id, group or section. The caps are on the index and on any one effect. */
  h.assert(Array.isArray(r.index) && r.index.length === r.full.length && r.index.every((e) => e.id && e.name && e.group && e.section && e.summary && Object.keys(e).length === 5 && e.summary.length <= 140), 'describe() is an index of { id, name, group, section, summary }');
  h.assert(r.one.id === 'gaussian-blur' && r.one.params.radius.unit === 'px' && r.group.indexOf('exposure') >= 0 && r.group.indexOf('grain') < 0 && r.section.indexOf('gaussian-blur') >= 0 && r.section.indexOf('exposure') < 0 && r.ids.sort().join() === 'grain,levels', 'describe(id), describe({ group }), describe({ section }), describe({ ids })');
  h.assert(r.sizes.index < 60000 && r.sizes.index / r.index.length < 260, 'the index stays small: ' + r.sizes.index + ' characters for ' + r.index.length + ' effects');
  h.assert(r.sizes.largest[0] < 12000, 'no single effect description is over 12,000 characters: ' + r.sizes.largest);
  h.assert(r.sizes.schema < 6000, 'schema() stays small: ' + r.sizes.schema);
  h.assert(r.sameObjects && r.frozen && r.moved, 'descriptions are shared and frozen, and LE.fx.version() moves when the registry changes: ' + JSON.stringify([r.sameObjects, r.frozen, r.moved]));
  h.assert(r.schema.maskKinds.length === 9 && r.schema.blends.indexOf('soft-light') >= 0 && r.schema.mask.parts[0].feather === 0.25 && r.schema.limits.params === 48, 'schema() describes mask kinds, blends and limits');
  h.assert(!r.hasFns, 'descriptions are plain data');
  STARTER.forEach((id) => h.assert(r.support.indexOf('fx.' + id) >= 0, 'LE.support definition for ' + id));
  h.assert.noErrors(page);
};

cases['validate: schema clamps, drops and reports; unknown types never run'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx;
    const a = FX.validate({ type: 'exposure', p: { ev: 99, nope: 1, __proto__: { x: 1 } }, amount: 7, blend: 'explode', extra: 1 });
    const b = FX.validate({ type: 'rm-rf', p: {} });
    const c = FX.validate({ type: 'curves', p: { curve: { master: [[2, -1], [0.5, 'x']] } } });
    const c2 = FX.validate({ type: 'curves', p: { curve: [[0, 0.1], { x: 1, y: 0.9 }] } });
    const c3 = FX.validate({ type: 'curves', p: { curve: { g: new Array(500).fill([0.5, 0.5]) } } });
    FX.register({ id: 'test-shapes', version: 1, params: { w: { type: 'wheel' }, b: { type: 'bands' }, pt: { type: 'point' }, n: { type: 'number', min: 0, max: 1, ui: { gradient: 'hue' } } }, passes: function () {} });
    const sh = FX.validate({ type: 'test-shapes', p: { w: { h: 400, amount: 2, l: -3 }, b: [1, 2, 3, 4, 5, 6, 7, 800], pt: [0.25, 5] } });
    const sh2 = FX.validate({ type: 'test-shapes', p: { w: { h: 90, a: 0.5, l: 0.25 }, b: new Array(8).fill({ h: -10, s: 20, l: 300 }), pt: { x: 0.1, y: 0.2 } } });
    const shDef = [FX.defaults('test-shapes'), FX.describe('test-shapes').params.n.ui];
    const d = FX.validate({ type: 'drop-shadow', p: { color: 'javascript:alert(1)', x: Infinity, blur: NaN, opacity: '1' }, mask: { on: 'yes', invert: 1, parts: [{ kind: 'radial', rx: -5, feather: 9 }, { kind: 'evil' }, { kind: 'asset', asset: '../../etc' }] } });
    const res = FX.resolve([{ type: 'exposure', p: { ev: 1 } }, { type: 'not-registered', p: { a: 1 } }, { type: 'contrast', on: false }, { type: 'grain', amount: 0 }]);
    return { a, b, c, c2, c3, sh, sh2, shDef, d, resolved: res.entries.map((e) => e.type), skipped: res.skipped };
  });
  h.assert(r.a.ok && r.a.entry.p.ev === 5 && r.a.entry.amount === 1 && r.a.entry.blend === 'normal' && !('nope' in r.a.entry.p), 'clamped and cleaned');
  h.assert(r.a.warnings.some((w) => w.code === 'clamped') && r.a.warnings.some((w) => w.code === 'unknown-key'), 'warnings say what changed');
  h.assert(!r.b.ok && r.b.errors[0].code === 'unknown-type', 'unknown type is an error');
  h.assert(r.c.ok && JSON.stringify(r.c.entry.p.curve.master) === '[[0,0],[1,1]]' && r.c.warnings.some((w) => w.code === 'bad-value'), 'a broken curve falls back to the default');
  h.assert.equal(JSON.stringify(r.c2.entry.p.curve), JSON.stringify({ master: [[0, 0.1], [1, 0.9]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }), 'a bare list of points is the master curve');
  h.assert(r.c3.entry.p.curve.g.length === 64 && r.c3.warnings.some((w) => w.code === 'clamped'), 'curves are capped at 64 points');
  h.assert.equal(JSON.stringify(r.sh.entry.p), JSON.stringify({ w: { h: 40, a: 1, l: -1 }, b: [1, 2, 3, 4, 5, 6, 7, 100].map((v) => ({ h: 0, s: v, l: 0 })), pt: { x: 0.25, y: 2 }, n: 0 }), 'wheel { h, a, l }, bands of { h, s, l }, point { x, y }: older spellings are converted');
  h.assert.equal(JSON.stringify(r.sh2.entry.p.w) + JSON.stringify(r.sh2.entry.p.b[7]) + JSON.stringify(r.sh2.entry.p.pt), '{"h":90,"a":0.5,"l":0.25}{"h":-10,"s":20,"l":100}{"x":0.1,"y":0.2}', 'the kit shapes pass through, clamped to the schema range');
  h.assert(r.shDef[0].w.a === 0 && r.shDef[0].b.length === 8 && r.shDef[0].pt.x === 0.5 && r.shDef[1].gradient === 'hue', 'defaults use the same shapes; param ui hints are passed through');
  h.assert(r.d.ok && r.d.entry.p.color === '#000000' && r.d.entry.p.x === 0 && r.d.entry.p.blur === 16 && r.d.entry.p.opacity === 0.45, 'bad values take defaults');
  h.assert(r.d.entry.mask.parts.length === 1 && r.d.entry.mask.parts[0].rx === 0.0001 && r.d.entry.mask.parts[0].feather === 1 && r.d.entry.mask.on === true && r.d.entry.mask.invert === false, 'mask parts are clamped, unknown kinds and bad assets dropped: ' + JSON.stringify(r.d.entry.mask));
  h.assert.equal(r.resolved.join(), 'exposure', 'only valid, switched-on entries run');
  h.assert(r.skipped.length === 1 && r.skipped[0].type === 'not-registered', 'the unknown entry is reported');
};

cases['sanitiser fuzz: hostile fx, masks and absurd parameters never crash, hang, pollute or allocate without bound'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  await page.evaluate(() => window.LE.fxBoot.load());
  const r = await page.evaluate(() => {
    const S = window.LE.Scene, FX = window.LE.fx, t0 = performance.now();
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const deep = (n) => (n ? { a: deep(n - 1), b: [deep(n - 1)] } : 'x'.repeat(5000));
    const junk = [null, undefined, 0, -1, NaN, Infinity, -Infinity, 1e308, '', 'x'.repeat(100000), true, [], {}, [[[[[[]]]]]], deep(8), () => 1, new Date(), /re/, JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}'),
      new Array(100000).fill(1), new Array(5000).fill({ kind: 'radial', rx: 1e9 }), { parts: new Array(5000).fill({ kind: 'luma', min: 'a', feather: 1e12 }) }, { quad: [[0, 0], [1e99, NaN], [1, 1], [0, 1]] }, { quad: 'x' }, { asset: '<img onerror=x>', version: -1e9 }];
    const pick = () => junk[Math.floor(rnd() * junk.length)];
    const types = FX.list().concat(['', 'constructor', '__proto__', 'x'.repeat(200), '<script>', 'gaussian-blur']);
    let maxLen = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const stack = rnd() < 0.2 ? pick() : new Array(Math.floor(rnd() * 60)).fill(0).map(() => ({ id: pick(), type: types[Math.floor(rnd() * types.length)], on: pick(), amount: pick(), blend: pick(), mask: pick(), p: rnd() < 0.5 ? pick() : { radius: pick(), ev: pick(), master: pick(), color: pick(), seed: pick(), __proto__: pick(), constructor: pick() } }));
      const src = { fx: stack, layerMask: pick(), mask: pick(), transform: pick(), retouch: pick(), maps: pick(), raw: pick() };
      const out = S.expertOf(src, {});
      const json = JSON.stringify(out);
      maxLen = Math.max(maxLen, json.length);
      if (out.fx && out.fx.length > 32) throw new Error('stack not capped');
      if (out.layerMask && out.layerMask.parts.length > 8) throw new Error('mask not capped');
      if (/"(__proto__|constructor|prototype)":/.test(json)) throw new Error('forbidden key survived: ' + json.slice(0, 200));
      (out.fx || []).forEach((e) => { FX.validate(e); n++; });
      FX.resolve(out.fx);
      FX.problems({ layers: [Object.assign({ id: 'a' }, out)] });
    }
    return { ms: performance.now() - t0, maxLen, n, polluted: ({}).polluted, protoKeys: Object.keys(Object.prototype).length };
  });
  h.assert(r.polluted === undefined && r.protoKeys === 0, 'Object.prototype was touched');
  h.assert(r.maxLen < 400000, 'sanitised expert data is bounded (' + r.maxLen + ' bytes)');
  h.assert(r.ms < 20000, 'sanitising took ' + Math.round(r.ms) + ' ms');
  h.assert.noErrors(page);
};

cases['absurd parameters: every control at its extreme still renders, bounded in size, memory and work'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  await page.evaluate(() => window.LE.fxBoot.load());
  const sizes = await page.evaluate(async () => {
    const FX = window.LE.fx, c = document.createElement('canvas'); c.width = 64; c.height = 48; c.getContext('2d').fillRect(10, 10, 30, 20);
    const out = [];
    FX.configure({ workMP: 3 });   /* the safety valve itself is under test: very wide stacks drop resolution instead of taking minutes */
    ['min', 'max'].forEach((end) => {
      const stack = FX.list().map((id) => { const d = FX.get(id), p = {}; Object.keys(d.params).forEach((k) => { const s = d.params[k]; if (s.type === 'number') p[k] = s[end]; if (s.type === 'seed') p[k] = 2147483647; }); return { type: id, p }; });
      const res = FX.apply(c, { fx: stack, mask: { invert: end === 'max', parts: [{ kind: 'luma', blur: 500 }, { kind: 'radial', rx: 8, ry: 0.0001, feather: 1 }, { kind: 'subject' }, { kind: 'depth' }, { kind: 'face', part: 'lips' }] } });
      out.push([res.width, res.height]);
    });
    const s = window.LEStudio.scene, id = s.layers()[0].id;
    s.update(id, { fx: [{ type: 'gaussian-blur', p: { radius: 1e9 } }, { type: 'no-such-effect', p: { a: [1, 2, 3] } }, { type: 'drop-shadow', p: { x: -1e9, y: 1e9, blur: 1e9 } }], layerMask: { parts: [{ kind: 'asset', asset: 'missing' }] }, transform: { quad: [[0, 0], [0, 0], [0, 0], [0, 0]] } });
    const png = await s.render(0.25);
    return { out, page: [png.width, png.height], kept: s.layer(id).fx.map((e) => e.type), mem: FX.status().memory, notes: Object.keys(FX.status().warnings) };
  });
  sizes.out.forEach((wh) => h.assert(wh[0] <= 64 + 2 * 2048 && wh[1] <= 48 + 2 * 2048 && wh[0] * wh[1] <= 2.1e6, 'output size is bounded: ' + wh));
  h.assert.equal(sizes.kept.join(), 'gaussian-blur,no-such-effect,drop-shadow', 'the unknown entry stays in the document');
  h.assert(sizes.notes.indexOf('work') >= 0, 'the work limit was reached and reported: ' + sizes.notes);
  h.assert(sizes.mem.bytes <= sizes.mem.budget * 1.5, 'GPU memory stays near the budget: ' + JSON.stringify(sizes.mem));
  h.assert.noErrors(page);
};

cases['goldens: the colour effects at 256 px'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const shots = {
    'exposure': [{ type: 'exposure', p: { ev: 1 } }],
    'contrast': [{ type: 'contrast', p: { amount: 45 } }],
    'highlights-shadows': [{ type: 'highlights-shadows', p: { highlights: -70, shadows: 60, whites: 20, blacks: -20 } }],
    'levels': [{ type: 'levels', p: { inBlack: 0.1, inWhite: 0.85, gamma: 1.3 } }],
    'curves': [{ type: 'curves', p: { curve: { master: [[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]], b: [[0, 0.12], [1, 0.88]] } } }],
    'white-balance': [{ type: 'white-balance', p: { temperature: 45, tint: -15 } }],
    'saturation': [{ type: 'saturation', p: { saturation: -30, vibrance: 80 } }]
  };
  for (const name of Object.keys(shots)) await fx.golden(page, name, await fx.render(page, Object.assign({ fx: shots[name] }, CARD)));
  h.assert.noErrors(page);
};

cases['goldens: blur, grain, a mixed stack, masks, a quad and a drop shadow at 256 px'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const shots = {
    'gaussian-blur': [{ type: 'gaussian-blur', p: { radius: 5 } }],
    'grain': [{ type: 'grain', p: { amount: 60, size: 2, color: 0.4, seed: 11 } }],
    'stack': [{ type: 'white-balance', p: { temperature: 20 } }, { type: 'exposure', p: { ev: 0.4 } }, { type: 'contrast', p: { amount: 20 }, amount: 0.6 }, { type: 'saturation', p: { vibrance: 40 }, blend: 'soft-light' }, { type: 'gaussian-blur', p: { radius: 3 }, mask: { parts: [{ kind: 'linear', x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.5 }] } }, { type: 'grain', p: { amount: 30 } }]
  };
  for (const name of Object.keys(shots)) await fx.golden(page, name, await fx.render(page, Object.assign({ fx: shots[name] }, CARD)));
  await fx.golden(page, 'drop-shadow', await fx.render(page, { card: [256, 192], alpha: true, fx: [{ type: 'drop-shadow', p: { x: 8, y: 10, blur: 6, opacity: 0.7, color: '#402060' } }], mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.48, ry: 0.48, feather: 0.08 }] } }));
  await fx.golden(page, 'mask-parts', await fx.render(page, Object.assign({ fx: [{ type: 'saturation', p: { saturation: -100 }, mask: { parts: [{ kind: 'color', h: 0, s: 0.75, l: 0.55, range: 0.12, soft: 0.1, invert: true }] } }], mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, feather: 0.3 }, { kind: 'luma', min: 0.9, max: 1, soft: 0.05, mode: 'subtract', blur: 2 }] } }, CARD)));
  await fx.golden(page, 'quad', await fx.render(page, Object.assign({ quad: [[30, 10], [240, 40], [250, 170], [10, 185]], fx: [{ type: 'contrast', p: { amount: 20 } }] }, CARD)));
  h.assert.noErrors(page);
};

cases['tiles: a blurred, grained image exports the same as one tile and as many'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const stack = [{ type: 'exposure', p: { ev: 0.3 } }, { type: 'gaussian-blur', p: { radius: 7 } }, { type: 'grain', p: { amount: 55, size: 1.3, seed: 5 } }];
  const one = await fx.render(page, { photo: 'arch-02', size: 420, fx: stack });
  const many = await fx.render(page, { photo: 'arch-02', size: 420, fx: stack, tile: 128 });
  const st = await page.evaluate(() => window.LE.fx.status().stats.tiles);
  h.assert(st >= 1 + 9, 'the second render really was tiled (' + st + ' tiles in total)');
  const d = await fx.same(page, one, many, 'blur + grain, one tile against many', { max: 1, over: 0 });
  h.assert(d.mean < 0.2, 'mean difference ' + d.mean);
  /* A wide blur (pyramid levels), a feathered luminance mask and a silhouette effect that draws outside the box. */
  const wide = [{ type: 'gaussian-blur', p: { radius: 30 }, mask: { parts: [{ kind: 'luma', min: 0.4, max: 1, soft: 0.1, blur: 5 }] } }, { type: 'contrast', p: { amount: 25 } }];
  await fx.same(page, await fx.render(page, { photo: 'arch-02', size: 420, fx: wide }), await fx.render(page, { photo: 'arch-02', size: 420, fx: wide, tile: 192 }), 'wide masked blur, one tile against many', { max: 2, over: 0.0005 });
  h.assert.noErrors(page);
};

cases['tiles: a silhouette effect that draws outside the layer box is the same as one tile and as many'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const sh = { card: [360, 260], alpha: true, fx: [{ type: 'drop-shadow', p: { x: 9, y: 12, blur: 10 } }, { type: 'grain', p: { amount: 20 } }] };
  const one = await fx.render(page, sh), many = await fx.render(page, Object.assign({ tile: 128 }, sh));
  const d = await fx.same(page, one, many, 'drop shadow, one tile against many', { max: 2, over: 0.0005 });
  h.assert(d.width > 360 + 40 && d.height > 260 + 40, 'the output is larger than the layer: ' + d.width + '×' + d.height);
  h.assert.noErrors(page);
};

cases['determinism: repeated renders are identical and the seed changes only the grain'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const o = (seed) => Object.assign({ fx: [{ type: 'gaussian-blur', p: { radius: 2 } }, { type: 'grain', p: { amount: 50, seed } }] }, CARD);
  const a = await fx.render(page, o(3)), b = await fx.render(page, o(3)), c = await fx.render(page, o(4));
  await fx.same(page, a, b, 'two renders of one stack', { max: 0, over: 0 });
  const d = await fx.diff(page, a, c, 2);
  h.assert(d.over > 0.3 && d.mean < 25, 'another seed gives another pattern of the same strength: ' + JSON.stringify(d));
  /* Every control at its neutral value, through linear light and back, leaves the picture alone (one level of dither at most). */
  const src = await fx.render(page, Object.assign({ fx: [] }, CARD));
  const neutral = await page.evaluate(() => window.LE.fx.list().filter((id) => ['gaussian-blur', 'grain', 'drop-shadow'].indexOf(id) < 0).map((id) => ({ type: id, p: window.LE.fx.defaults(id) })));
  await fx.same(page, src, await fx.render(page, Object.assign({ fx: neutral }, CARD)), 'a neutral stack', { max: 1, over: 0 });
  await fx.same(page, src, await fx.render(page, Object.assign({ fx: [{ type: 'gaussian-blur', p: { radius: 0 } }, { type: 'grain', p: { amount: 0 } }, { type: 'exposure', p: { ev: 2 }, amount: 0 }] }, CARD)), 'zero-strength spatial effects', { max: 1, over: 0 });
  const srcNode = await page.evaluate(() => window.fxT.png(window.fxT.card(256, 192)));
  const d0 = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 0), [srcNode, fx.dataUrl(src)]);
  h.assert(d0.max === 0, 'an empty stack returns the source pixels exactly: ' + JSON.stringify(d0));
  /* A second page (fresh context, fresh caches) gives the same pixels. */
  const page2 = await fx.page(browser, base);
  await fx.same(page, a, await fx.render(page2, o(3)), 'a fresh context', { max: 0, over: 0 });
};

cases['preview and export agree: the same stack at half and full resolution'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const stack = [{ type: 'white-balance', p: { temperature: 25 } }, { type: 'gaussian-blur', p: { radius: 6 } }, { type: 'highlights-shadows', p: { shadows: 40 } }, { type: 'drop-shadow', p: { x: 6, y: 8, blur: 8 } }];
  const r = await page.evaluate(async (stack) => {
    const T = window.fxT, FX = window.LE.fx, full = T.card(512, 384, true), half = T.fit(full, 256);
    const big = FX.apply(full, { fx: stack, scale: 1 }), small = FX.apply(half, { fx: stack, scale: 0.5 });
    /* Lengths are document pixels: cut the layer box plus 20 document pixels out of each padded output and compare those. */
    const cut = (c, k) => { const o = document.createElement('canvas'); o.width = 296; o.height = 232; const x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; const m = 20 * k, pd = c._fx.padPx; x.drawImage(c, pd - m, pd - m, 512 * k + 2 * m, 384 * k + 2 * m, 0, 0, 296, 232); return o; };
    const down = cut(big, 1), smallCut = cut(small, 0.5);
    const g = FX.apply(full, { fx: [{ type: 'grain', p: { amount: 60, size: 2 } }], scale: 1 }), gs = FX.apply(half, { fx: [{ type: 'grain', p: { amount: 60, size: 2 } }], scale: 0.5 });
    const sd = (c) => { const d = T.pixels(c).data, w = c.width; let s = 0, n = 0; for (let y = 0; y < c.height; y++) for (let xx = 1; xx < w; xx++) { const i = (y * w + xx) * 4; if (d[i + 3] < 255 || d[i - 1] < 255) continue; const v = d[i + 1] - d[i - 3]; s += v * v; n++; } return Math.sqrt(s / Math.max(1, n)); };
    return { a: T.png(down), b: T.png(smallCut), big: [big.width, big.height, big._fx.pad], small: [small.width, small.height, small._fx.pad], grain: [sd(g), sd(gs)] };
  }, stack);
  h.assert(r.big[2] >= 20 && r.small[2] >= 20 && Math.abs(r.big[2] - r.small[2]) <= 12, 'the padding is the same in document pixels: ' + JSON.stringify([r.big, r.small]));
  const d = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 10), [r.a, r.b]);
  h.assert(d.mean < 2 && d.over < 0.04, 'half-resolution render against the downsampled full one: ' + JSON.stringify(d));
  h.assert(r.grain[1] > r.grain[0] * 0.5 && r.grain[1] < r.grain[0] * 2.5, 'grain has a similar strength at both sizes: ' + r.grain.map((v) => v.toFixed(1)));
};

cases['8-bit fallback: without float targets the picture matches and gradients are dithered, not banded'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const stack = [{ type: 'exposure', p: { ev: -1.5 } }, { type: 'gaussian-blur', p: { radius: 6 } }, { type: 'exposure', p: { ev: 1.5 } }, { type: 'contrast', p: { amount: 10 } }];
  const f = await fx.render(page, Object.assign({ fx: stack }, CARD));
  h.assert((await page.evaluate(() => window.LE.fx.status().float)) === true, 'the sandbox has float targets');
  const st = await page.evaluate(() => { window.LE.fx.configure({ eightBit: true }); return window.LE.fx.status(); });
  h.assert(st.available && st.float === false, '8-bit mode is on');
  const e = await fx.render(page, Object.assign({ fx: stack }, CARD));
  const d = await fx.diff(page, f, e, 6);
  h.assert(d.mean < 1.5 && d.over < 0.01, '8-bit against float: ' + JSON.stringify(d));
  /* Banding check on a smooth ramp pushed down three stops, blurred and pushed back up: the 8-bit path must keep nearly as
     many levels as the float path and must not grow wide flat steps (the 8-bit source itself steps every 10 pixels). */
  const ramp = () => page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 16; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#202020'); g.addColorStop(1, '#505050'); x.fillStyle = g; x.fillRect(0, 0, 512, 16);
    const out = window.LE.fx.apply(c, { fx: [{ type: 'exposure', p: { ev: -3 } }, { type: 'gaussian-blur', p: { radius: 1 } }, { type: 'exposure', p: { ev: 3 } }] });
    const d = out.getContext('2d').getImageData(0, 8, 512, 1).data; let longest = 0, cur = 1, levels = {}; const row = [];
    for (let i = 0; i < d.length; i += 4) { row.push(d[i]); if (!i) continue; levels[d[i]] = 1; if (d[i] === d[i - 4]) { cur++; longest = Math.max(longest, cur); } else cur = 1; }
    return { longest, levels: Object.keys(levels).length, row };
  });
  const run8 = await ramp();
  await page.evaluate(() => window.LE.fx.configure({ eightBit: false }));
  const runF = await ramp();
  const err = run8.row.reduce((a, v, i) => a + Math.abs(v - runF.row[i]), 0) / run8.row.length;
  h.assert(run8.levels >= runF.levels - 12 && run8.longest <= runF.longest + 6 && err < 2.5, 'dithered, not banded, in 8-bit mode: ' + JSON.stringify([run8.longest, run8.levels, runF.longest, runF.levels, err]));
  await page.evaluate(() => window.LE.fx.configure({ eightBit: false }));
  await fx.same(page, f, await fx.render(page, Object.assign({ fx: stack }, CARD)), 'back in float mode', { max: 0, over: 0 });
  h.assert.noErrors(page);
};

cases['context loss: a lost context falls back without throwing and the picture returns when it is restored'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const o = Object.assign({ fx: [{ type: 'exposure', p: { ev: 0.8 } }, { type: 'gaussian-blur', p: { radius: 4 } }, { type: 'curves', p: { curve: [[0, 0.1], [1, 0.9]] } }] }, CARD);
  const before = await fx.render(page, o);
  const lost = await page.evaluate(async () => {
    const FX = window.LE.fx, seen = [];
    FX.on((e) => seen.push(e));
    FX._lose();
    await new Promise((r) => setTimeout(r, 150));
    const c = window.fxT.card(256, 192);
    let threw = null, out = null;
    try { out = FX.apply(c, { fx: [{ type: 'exposure', p: { ev: 0.8 } }, { type: 'gaussian-blur', p: { radius: 4 } }] }); } catch (e) { threw = String(e.message); }
    return { seen, status: FX.status(), threw, fallback: out && out._fx && out._fx.fallback, size: out && [out.width, out.height], stamp: FX.stamp() };
  });
  h.assert(lost.seen.indexOf('lost') >= 0 && lost.status.lost === true && lost.status.available === false, 'the loss is noticed: ' + JSON.stringify(lost.seen));
  h.assert(lost.threw === null && lost.fallback === true && lost.size.join() === '256,192', 'rendering falls back instead of throwing: ' + JSON.stringify(lost));
  h.assert(/x/.test(lost.stamp), 'the cache stamp changes while the context is lost');
  const back = await page.evaluate(async () => {
    const FX = window.LE.fx, seen = [];
    FX.on((e) => seen.push(e));
    FX._restore();
    await new Promise((r) => setTimeout(r, 300));
    return { seen, status: FX.status() };
  });
  h.assert(back.seen.indexOf('restored') >= 0 && back.status.available === true && back.status.lost === false, 'the context came back: ' + JSON.stringify(back.seen));
  await fx.same(page, before, await fx.render(page, o), 'after the context was restored', { max: 0, over: 0 });
  h.assert(back.status.stats.lost === 1, 'one loss counted');
};

cases['memory: a large export is tiled inside a small budget and the pool is given back'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base, { configure: { budgetMB: 48 } });
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx, T = window.fxT;
    const src = T.fit(await T.load('/assets/photos/collage/arch-02.jpg'));
    const big = document.createElement('canvas'); big.width = 1800; big.height = 1400;
    const x = big.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, big.width, big.height);
    const t0 = FX.status().stats.tiles;
    const out = FX.apply(big, { fx: [{ type: 'gaussian-blur', p: { radius: 12 } }, { type: 'grain', p: { amount: 30 } }, { type: 'exposure', p: { ev: 0.2 } }] });
    const st = FX.status();
    /* Seam check: the difference across every tile boundary must look like the difference one pixel away from it. */
    const d = out.getContext('2d').getImageData(0, 700, 1800, 1).data; let worst = 0;
    for (let i = 4; i < d.length - 4; i += 4) worst = Math.max(worst, Math.abs(d[i + 1] - d[i - 3]));
    FX.trim(true);
    return { size: [out.width, out.height], tiles: st.stats.tiles - t0, mem: st.memory, after: FX.status().memory, worst };
  });
  h.assert(r.size.join() === '1800,1400' && r.tiles >= 4, 'the export was tiled: ' + r.tiles + ' tiles');
  h.assert(r.mem.budget === 48 * 1048576 && r.mem.bytes <= r.mem.budget * 1.3, 'memory after the export is near the budget: ' + JSON.stringify(r.mem));
  h.assert(r.after.bytes < 2 * 1048576, 'trim(true) gives the memory back: ' + JSON.stringify(r.after));
  h.assert(r.worst < 60, 'no hard seam along a row (largest neighbour step ' + r.worst + ')');
};

cases['interactive: draft quality while dragging, full quality on release, stages reused between renders'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx, T = window.fxT, src = T.fit(await T.load('/assets/photos/collage/arch-01.jpg'), 900), events = [];
    FX.on((e) => events.push(e));
    const stack = (ev) => [{ type: 'gaussian-blur', p: { radius: 8 } }, { type: 'exposure', p: { ev } }];
    const full = FX.apply(src, { fx: stack(0.2), preview: true, key: 'k1' });
    const p0 = FX.status().stats.passes;
    FX.apply(src, { fx: stack(0.5), preview: true, key: 'k1' });        /* only the colour pass changed: the blur output is reused */
    const reuse = FX.status().stats.passes - p0, hits = FX.status().stats.cacheHits;
    FX.interactive(true);
    const draft = FX.apply(src, { fx: stack(0.2), preview: true, key: 'k1' });
    const stampDraft = FX.stamp();
    FX.interactive(false);
    const again = FX.apply(src, { fx: stack(0.2), preview: true, key: 'k1' });
    const exportSize = FX.apply(src, { fx: stack(0.2) });
    return { full: [full.width, full.height], draft: [draft.width, draft.height], again: T.png(again), fullPng: T.png(full), exp: T.png(exportSize), events, reuse, hits, stampDraft, stamp: FX.stamp() };
  });
  h.assert(r.draft[0] * 2 === r.full[0] || Math.abs(r.draft[0] * 2 - r.full[0]) <= 1, 'the draft is half resolution: ' + r.draft + ' against ' + r.full);
  h.assert.equal(r.events.join(), 'draft,refine', 'listeners hear draft and refine');
  h.assert(/d/.test(r.stampDraft) && !/d/.test(r.stamp), 'the cache stamp says draft');
  h.assert(r.hits >= 1 && r.reuse <= 2, 'the blur stage was reused: ' + r.reuse + ' passes for the second render');
  const d1 = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 0), [r.fullPng, r.again]);
  h.assert(d1.max === 0, 'refined render equals the first full render');
  const d2 = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 1), [r.fullPng, r.exp]);
  h.assert(d2.max <= 1, 'preview (cached stages) and export paths agree: ' + JSON.stringify(d2));
};

cases['analysis: the numbers an agent grades by are right on known pictures'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx;
    const flat = (col, w, hh) => { const c = document.createElement('canvas'); c.width = w || 64; c.height = hh || 64; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return c; };
    const grey = await FX.analyze(flat('#808080'));
    const white = await FX.analyze(flat('#ffffff'));
    const warm = flat('#b0a898'); const wctx = warm.getContext('2d'); wctx.fillStyle = '#d0c8b8'; wctx.fillRect(0, 0, 32, 64);
    const cast = await FX.analyze(warm);
    const fixed = await FX.analyze(FX.apply(warm, { fx: [{ type: 'white-balance', p: cast.whiteBalance.suggest }] }));
    const half = flat('#000000'); half.getContext('2d').fillStyle = '#ff0000'; half.getContext('2d').fillRect(32, 0, 32, 64);
    const region = await FX.analyze(half, { region: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    const whole = await FX.analyze(half);
    const photo = await window.fxT.load('/assets/photos/collage/arch-01.jpg');
    const sharp = await FX.analyze(photo);
    const soft = await FX.analyze(FX.apply(window.fxT.fit(photo), { fx: [{ type: 'gaussian-blur', p: { radius: 4 } }] }));
    const quick = FX.analyze({ source: flat('#808080'), kinds: ['histogram'] });
    return { quick: { sync: !!quick.histogram, l: quick.histogram && quick.histogram.l[128], sharp: quick.sharpness }, grey, white, cast: cast.whiteBalance, fixed: fixed.whiteBalance, region, whole, sharp: sharp.sharpness.laplacianVariance, soft: soft.sharpness.laplacianVariance, keys: Object.keys(sharp) };
  });
  ['histogram', 'percentiles', 'clipping', 'mean', 'median', 'whiteBalance', 'saturation', 'sharpness', 'hue'].forEach((k) => h.assert(r.keys.indexOf(k) >= 0, 'missing ' + k));
  h.assert(Math.abs(r.grey.mean.luma - 0.502) < 0.01 && r.grey.median.luma === r.grey.percentiles.luma.p50 && r.grey.clipping.highlights.any === 0 && r.grey.saturation.mean === 0, 'mid grey: ' + JSON.stringify(r.grey.mean));
  h.assert(Math.abs(r.grey.histogram.luma[128] - 1) < 1e-3 && r.grey.histogram.r.length === 256, 'histogram is a fraction per bin');
  h.assert(r.quick.sync && Math.abs(r.quick.l - 1) < 1e-3 && r.quick.sharp === null, 'the scopes form, analyze({ source, kinds }), answers at once with histogram.l: ' + JSON.stringify(r.quick));
  h.assert(r.white.clipping.highlights.all === 1 && r.white.clipping.shadows.any === 0 && r.white.percentiles.luma.p1 === 1, 'white clips');
  h.assert(r.cast.method === 'near-neutral' && r.cast.cast.rg > 1.03 && r.cast.cast.bg < 0.97 && r.cast.suggest.temperature < -3, 'a warm cast is measured and a cooler balance suggested: ' + JSON.stringify(r.cast));
  h.assert(Math.abs(r.fixed.cast.rg - 1) < 0.04 && Math.abs(r.fixed.cast.bg - 1) < 0.04, 'the suggested balance neutralises it: ' + JSON.stringify(r.fixed.cast));
  h.assert(Math.abs(r.region.hue.mean) < 1 || Math.abs(r.region.hue.mean - 360) < 1, 'region hue is red: ' + r.region.hue.mean);
  h.assert(r.region.mean.color === '#ff0000' && r.region.saturation.mean === 1 && Math.abs(r.whole.mean.r - 0.5) < 0.02, 'region against whole');
  h.assert(r.sharp > r.soft * 3, 'blur lowers the sharpness measure: ' + r.sharp + ' against ' + r.soft);
};

cases['ops: fx.add, fx.update, fx.remove, fx.reorder, mask.set, adjust.add and transform.set are pure and strict'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const O = window.LE.fx.ops, doc = { v: 1, width: 800, height: 600, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300 }, { id: 't', type: 'text', x: 0, y: 0, w: 100, h: 40 }] };
    const frozen = JSON.stringify(doc), log = {};
    let s = O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'exposure', p: { ev: 9 } } });
    log.add = { ok: s.ok, ev: s.doc.layers[0].fx[0].p.ev, warn: s.warnings.length, id: s.id };
    const id1 = s.id;
    s = O.apply(s.doc, { op: 'fx.add', layer: 'a', entry: { type: 'grain', id: id1 }, index: 0 });
    log.add2 = { ok: s.ok, order: s.doc.layers[0].fx.map((e) => e.type), unique: s.doc.layers[0].fx[0].id !== s.doc.layers[0].fx[1].id };
    const id2 = s.id;
    s = O.apply(s.doc, { op: 'fx.update', layer: 'a', id: id1, p: { ev: -1 }, amount: 0.5, blend: 'screen' });
    log.update = { ok: s.ok, e: s.doc.layers[0].fx[1] };
    s = O.apply(s.doc, { op: 'fx.reorder', layer: 'a', id: id1, index: 0 });
    log.reorder = s.doc.layers[0].fx.map((e) => e.type);
    s = O.apply(s.doc, { op: 'mask.set', layer: 'a', fx: id1, mask: { parts: [{ kind: 'linear' }] } });
    s = O.apply(s.doc, { op: 'mask.set', layer: 'a', mask: { parts: [{ kind: 'radial', feather: 0.2 }] } });
    log.mask = { ok: s.ok, entry: s.doc.layers[0].fx[0].mask.parts[0].kind, layer: s.doc.layers[0].layerMask.parts[0] };
    s = O.apply(s.doc, { op: 'mask.set', layer: 'a', mask: null });
    log.maskCleared = !('layerMask' in s.doc.layers[0]);
    s = O.apply(s.doc, { op: 'fx.remove', layer: 'a', id: id2 });
    s = O.apply(s.doc, { op: 'adjust.add', fx: [{ type: 'contrast', p: { amount: 10 } }], name: 'Grade', above: 'a', mask: { parts: [{ kind: 'luma', min: 0.5 }] } });
    log.adjust = { ok: s.ok, order: s.doc.layers.map((l) => l.type), layer: s.doc.layers[1] };
    s = O.apply(s.doc, { op: 'transform.set', layer: 'a', quad: [[10, 10], [300, 40], [320, 260], [0, 280]] });
    log.quad = { ok: s.ok, box: [s.doc.layers[0].x, s.doc.layers[0].y, s.doc.layers[0].w, s.doc.layers[0].h], quad: s.doc.layers[0].transform.quad };
    log.final = s.doc;
    log.bad = [
      O.apply(doc, { op: 'fx.add', layer: 'a', entry: { type: 'nope' } }), O.apply(doc, { op: 'fx.add', layer: 'zz', entry: { type: 'grain' } }), O.apply(doc, { op: 'explode' }),
      O.apply(doc, { op: 'fx.update', layer: 'a', id: 'none', p: {} }), O.apply(doc, { op: 'transform.set', layer: 'a', quad: [[0, 0], [10, 10], [10, 0], [0, 10]] }),
      O.apply(doc, { op: 'adjust.add', fx: [] }), O.apply(doc, { op: 'mask.set', layer: 'a', mask: { parts: 'x' } }), O.apply(null, { op: 'fx.add' }),
      O.apply(doc, { op: 'fx.add', layer: 'a', entry: JSON.parse('{"type":"grain","p":{"__proto__":{"x":1}}}') })
    ].map((x) => [x.ok, x.errors[0] && x.errors[0].code, x.doc === doc || x.doc === null]);
    log.pure = JSON.stringify(doc) === frozen;
    log.ops = O.list().map((x) => x.op);
    return log;
  });
  h.assert(r.add.ok && r.add.ev === 5 && r.add.warn === 1 && r.add.id, 'fx.add clamps with a warning');
  h.assert(r.add2.ok && r.add2.order.join() === 'grain,exposure' && r.add2.unique, 'index and unique ids');
  h.assert(r.update.ok && r.update.e.p.ev === -1 && r.update.e.amount === 0.5 && r.update.e.blend === 'screen', 'fx.update merges parameters');
  h.assert.equal(r.reorder.join(), 'exposure,grain', 'fx.reorder');
  h.assert(r.mask.ok && r.mask.entry === 'linear' && r.mask.layer.kind === 'radial' && r.mask.layer.rx === 0.3 && r.mask.layer.feather === 0.2 && r.maskCleared, 'mask.set fills defaults and clears');
  h.assert(r.adjust.ok && r.adjust.order.join() === 'image,adjust,text' && r.adjust.layer.w === 800 && r.adjust.layer.fx[0].p.pivot === 0.5 && r.adjust.layer.layerMask.parts[0].max === 1, 'adjust.add: ' + JSON.stringify(r.adjust.layer));
  h.assert(r.quad.ok && r.quad.box.join() === '0,10,320,270', 'transform.set moves the box to the quad: ' + r.quad.box);
  h.assert.equal(JSON.stringify(r.bad), JSON.stringify([[false, 'unknown-type', true], [false, 'no-layer', true], [false, 'unknown-op', true], [false, 'no-entry', true], [false, 'bad-quad', true], [false, 'bad-value', true], [false, 'bad-mask', true], [false, 'bad-doc', true], [false, 'forbidden-key', true]]), 'bad operations are refused and leave the document alone');
  h.assert(r.pure, 'the input document is never changed');
  h.assert.equal(r.ops.join(), 'fx.add,fx.update,fx.remove,fx.reorder,mask.set,adjust.add,transform.set', 'operation list');
  /* The result of the operations loads into a real scene unchanged. */
  const st = await h.studioWithSample(browser, base, 'desktop');
  await h.need(st, ['design']);
  const back = await st.evaluate((doc) => { const s = window.LEStudio.scene; s.load(doc); return s.toJSON(); }, r.final);
  h.assert.equal(JSON.stringify(back.layers.map((l) => [l.type, l.fx || null, l.layerMask || null, l.transform || null])), JSON.stringify(r.final.layers.map((l) => [l.type, l.fx || null, l.layerMask || null, l.transform || null])), 'LE.Scene keeps what the operations wrote');
};

cases['studio: nothing under assets/js/fx/ loads until a document needs it, and the boot stub stays tiny'] = async ({ browser, base, h }) => {
  const fs = require('fs'), path = require('path');
  h.assert(fs.statSync(path.join(fx.ROOT, 'assets/js/le-fx-boot.js')).size < 2600, 'le-fx-boot.js is ' + fs.statSync(path.join(fx.ROOT, 'assets/js/le-fx-boot.js')).size + ' bytes');
  const build = require(path.join(fx.ROOT, 'scripts/build.js'));
  /* The renderer belongs to the expert pack (scripts/build.js decides whether that pack is saved with the basic one); the stub is basic. */
  const list = build.precacheList(), inPrecache = list.some((f) => f.indexOf('assets/js/fx/') >= 0);
  h.assert(list.indexOf('./assets/js/le-fx-boot.js') >= 0, 'the boot stub is precached');
  if (build.EXPERT && build.packDecision) h.assert(build.EXPERT.test('assets/js/fx/le-fx.js') && inPrecache === !!build.packDecision().expertWithBasic, 'fx/ follows the expert pack decision');
  else h.assert(!inPrecache, 'fx/ is on demand');
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  const fetched = () => page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/assets\/js\/fx\//.test(n)).map((n) => n.split('/').pop()));
  await page.evaluate(() => window.LEStudio.scene.render(0.25));
  h.assert.equal((await fetched()).join(), '', 'the simple studio fetched renderer files');
  h.assert(await page.evaluate(() => !window.LE.fx && !!window.LE.fxBoot && window.LE.fxBoot.needs(window.LEStudio.scene.toJSON()) === false), 'only the boot stub is present');
  await page.evaluate(() => { const s = window.LEStudio.scene; s.update(s.layers()[0].id, { fx: [{ type: 'exposure', p: { ev: 0.5 } }] }); });
  await page.waitForFunction(() => window.LE.fx && window.LE.fx.draw);
  /* Packs load beside the renderer; with several packs the last file can finish after draw() exists. */
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /\/assets\/js\/fx\/le-fx-basic\.js/.test(e.name)), null, { timeout: 20000 }).catch(() => {});
  const got = await fetched();
  ['le-fx.js', 'le-fx-gl.js', 'le-fx-basic.js'].forEach((f) => h.assert(got.indexOf(f) >= 0, f + ' loads on demand: ' + got));
  /* docs/FX-AUTHORING.md: the statistics code loads with the renderer when a registered effect declares needs: ['stats'] (dehaze does). */
  const statsAtLoad = await page.evaluate(() => window.LE.fx.list().some((id) => window.LE.fx.get(id).needs.indexOf('stats') >= 0));
  h.assert(statsAtLoad || got.indexOf('le-fx-analyze.js') < 0, 'analysis waits for its first call');
  await page.evaluate(() => window.LE.fx.analyze(window.LEStudio.scene));
  h.assert((await fetched()).indexOf('le-fx-analyze.js') >= 0, 'analysis loaded on first use');
  h.assert.noErrors(page);
};

cases['studio: documents without expert data draw exactly as before (sample scene and a collage)'] = async ({ browser, base, h }) => {
  for (const kind of ['sample', 'collage']) {
    const page = await h.studioWithSample(browser, base, 'desktop');
    await h.need(page, ['design']);
    await fx.attach(page);
    const withBoot = await fx.legacy(page, kind);
    h.assert(await page.evaluate(() => !window.LE.fx), kind + ': the renderer must not load for a legacy document');
    /* The same document with every seam switched off: LE.fxBoot is what all of them test for. */
    await page.evaluate(() => { delete window.LE.fxBoot; });
    const without = await fx.shot(page, 0.5);
    await fx.same(page, withBoot, without, kind + ': with the seam against without it', { max: 0, over: 0 });
    /* And against the picture the engine drew before this step existed (made from the previous commit's le-objects.js). */
    await fx.golden(page, 'legacy-' + kind, withBoot, { max: 1, over: 0.0005 });
    h.assert.noErrors(page);
  }
};

cases['studio: expert data draws on photos, text, groups and adjustment layers, in the preview and the export'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  const ids = await page.evaluate(() => {
    const s = window.LEStudio.scene, photo = s.layers()[0].id;
    s.update(photo, { fx: [{ type: 'white-balance', p: { temperature: 30 } }, { type: 'gaussian-blur', p: { radius: 6 }, mask: { parts: [{ kind: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5 }] } }] });
    const text = s.add({ type: 'text', text: 'Shadow', x: 120, y: 120, w: 500, h: 120, size: 96, color: '#ffffff', fx: [{ type: 'drop-shadow', p: { x: 8, y: 10, blur: 6, opacity: 0.9, color: '#000000' } }] });
    const a = s.add({ type: 'shape', shape: 'ellipse', x: 700, y: 420, w: 220, h: 220, fill: { type: 'solid', color: '#ff3366' } });
    const b = s.add({ type: 'shape', shape: 'rect', x: 820, y: 520, w: 220, h: 160, fill: { type: 'solid', color: '#33aaff' }, rotation: 12 });
    s.select([a, b]); const g = s.group();
    s.update(g, { fx: [{ type: 'gaussian-blur', p: { radius: 10 } }] });
    const adj = s.add({ type: 'adjust', name: 'B&W left', x: 0, y: 0, w: 600, h: 800, fx: [{ type: 'saturation', p: { saturation: -100 } }] });
    s.select([]);
    return { photo, text, g, adj, types: s.layers().map((l) => l.type) };
  });
  h.assert(ids.g && ids.types.indexOf('adjust') >= 0 && ids.types.indexOf('group') >= 0, 'layers were made: ' + ids.types);
  await page.waitForFunction(() => window.LE.fx && window.LE.fx.draw);
  await page.waitForTimeout(900);
  const probe = (png) => page.evaluate(async (url) => {
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = url; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (fx2, fy) => Array.from(x.getImageData(Math.round(fx2 * c.width), Math.round(fy * c.height), 1, 1).data);
    return { left: at(0.25, 0.9), right: at(0.75, 0.9), blurEdge: at(0.585, 0.65), groupCore: at(0.66, 0.66), w: c.width, h: c.height };
  }, fx.dataUrl(png));
  const big = await fx.shot(page, 0.5);
  const p = await probe(big);
  h.assert(Math.max(p.left[0], p.left[1], p.left[2]) - Math.min(p.left[0], p.left[1], p.left[2]) <= 2, 'the adjustment layer desaturates its box: ' + p.left);
  h.assert(Math.max(p.right[0], p.right[1], p.right[2]) - Math.min(p.right[0], p.right[1], p.right[2]) > 12, 'and leaves the rest alone: ' + p.right);
  /* The blurred group fades into the photo: a point just outside the ellipse's old edge is tinted by it. */
  const flat = await page.evaluate(async ([g]) => { const s = window.LEStudio.scene; const before = JSON.stringify(s.layer(g).fx); s.update(g, { fx: null }); const c = await s.render(0.5); s.undo(); return { url: c.toDataURL('image/png'), back: JSON.stringify(s.layer(g).fx) === before }; }, [ids.g]);
  h.assert(flat.back, 'undo restores the group stack');
  const p0 = await probe(Buffer.from(flat.url.split(',')[1], 'base64'));
  h.assert(Math.abs(p.blurEdge[0] - p0.blurEdge[0]) + Math.abs(p.blurEdge[1] - p0.blurEdge[1]) + Math.abs(p.blurEdge[2] - p0.blurEdge[2]) > 12, 'the group blur reaches outside the shapes: ' + p.blurEdge + ' against ' + p0.blurEdge);
  h.assert.noErrors(page);
};

cases['studio: the preview canvas, a half-size export and a full-size export show the same picture'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  await page.evaluate(() => {
    const s = window.LEStudio.scene, photo = s.layers()[0].id;
    s.update(photo, { fx: [{ type: 'white-balance', p: { temperature: 30 } }, { type: 'gaussian-blur', p: { radius: 6 }, mask: { parts: [{ kind: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5 }] } }] });
    s.add({ type: 'text', text: 'Shadow', x: 120, y: 120, w: 500, h: 120, size: 96, color: '#ffffff', fx: [{ type: 'drop-shadow', p: { x: 8, y: 10, blur: 6, opacity: 0.9, color: '#000000' } }] });
    s.add({ type: 'adjust', name: 'B&W left', x: 0, y: 0, w: 600, h: 800, fx: [{ type: 'saturation', p: { saturation: -100 } }] });
    s.select([]);
  });
  await page.waitForFunction(() => window.LE.fx && window.LE.fx.draw);
  await page.waitForTimeout(900);
  const big = await fx.shot(page, 0.5), small = await fx.shot(page, 0.25);
  /* Export at two sizes shows the same picture. */
  await fx.attach(page);
  const down = await page.evaluate(async (a) => { const c = window.fxT.fit(await window.fxT.load(a), 300); return c.toDataURL('image/png'); }, fx.dataUrl(big));
  const d = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 12), [down, fx.dataUrl(small)]);
  h.assert(d.mean < 2.5 && d.over < 0.03, 'export at 0.25 against export at 0.5 scaled down: ' + JSON.stringify(d));
  /* The preview canvas shows the same thing as the export (compare a centre crop of the page area). */
  const prev = await page.evaluate(() => {
    const s = window.LEStudio.scene;
    const cv = document.querySelector('canvas.le-view'), z = s._zoom * s._dpr, x0 = s._panX * s._dpr, y0 = s._panY * s._dpr, doc = s.toJSON();
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(cv, x0, y0, doc.width * z, doc.height * z, 0, 0, 300, 200);
    return c.toDataURL('image/png');
  });
  const ex = await page.evaluate(async () => { const c0 = await window.LEStudio.scene.render(0.5); const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c0, 0, 0, 300, 200); return c.toDataURL('image/png'); });
  const dv = await page.evaluate(([a, b]) => window.fxT.diff(a, b, 16), [prev, ex]);
  h.assert(dv.mean < 4 && dv.over < 0.06, 'the preview canvas against the export: ' + JSON.stringify(dv));
  h.assert.noErrors(page);
};

cases['studio: undo, redo, project and open-format round trips keep expert data and refuse hostile data'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  const r = await page.evaluate(async () => {
    const LE = window.LE, s = window.LEStudio.scene, id = s.layers()[0].id, out = {};
    const fxv = [{ id: 'e1', type: 'exposure', p: { ev: 0.5 } }, { id: 'e2', type: 'future-effect', p: { strength: 3, list: [1, 2, 3] }, amount: 0.5 }];
    const mask = { parts: [{ kind: 'radial', cx: 0.4, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0.2 }] };
    s.update(id, { fx: fxv, layerMask: mask, transform: { quad: [[100, 50], [1100, 100], [1150, 700], [60, 760]] }, raw: { profile: 'neutral', wb: { temp: 5200, tint: 4 }, exposure: 0.3 }, maps: { depth: { asset: 'd'.repeat(64), model: 'depth-s', version: 2 } } });
    const adj = s.add({ type: 'adjust', fx: [{ id: 'c1', type: 'contrast', p: { amount: 20 } }], clip: true });
    const snap = s.toJSON();
    out.stored = snap.layers.map((l) => [l.type, (l.fx || []).map((e) => e.type), !!l.layerMask, !!l.transform, !!l.raw, !!l.maps, l.clip]);
    s.undo(); out.undo1 = s.toJSON().layers.length;
    s.undo(); out.undo2 = !!s.toJSON().layers[0].fx;
    s.redo(); s.redo(); out.redo = JSON.stringify(s.toJSON()) === JSON.stringify(snap);
    /* A mask given as an object on a photo is the layer mask; the frame shape keeps its string. */
    s.update(id, { mask: 'ellipse' }); s.update(id, { mask: { parts: [{ kind: 'linear', x0: 0, y0: 0, x1: 1, y1: 1 }] } });
    out.alias = [s.layer(id).mask, s.layer(id).layerMask.parts[0].kind];
    s.update(id, { mask: 'none', layerMask: mask });
    /* .leproject sanitiser */
    const project = LE.project.create({ name: 'fx', pages: [s.toJSON()] });
    const hostile = JSON.parse(JSON.stringify(project));
    hostile.pages[0].layers[0].fx.push({ type: 'grain', p: { amount: 20, evil: '<script>', deep: { a: { b: { c: { d: { e: 1 } } } } } }, onload: 'x', mask: { parts: new Array(50).fill({ kind: 'luma' }) } });
    hostile.pages[0].layers[0].fx.push({ type: 'BAD TYPE', p: {} }, 'nope', null);
    hostile.pages[0].layers[0].retouch = { asset: '../../x', version: 2 };
    hostile.pages[0].layers.push({ id: 'adj2', type: 'adjust', x: 0, y: 0, w: 10, h: 10, fx: new Array(100).fill({ type: 'exposure', p: { ev: 1 } }) });
    const v = LE.project.validate(JSON.stringify(hostile));
    out.project = { ok: v.ok, layers: v.project ? v.project.pages[0].layers.map((l) => [l.type, (l.fx || []).length, l.clip]) : null, grain: v.project ? v.project.pages[0].layers[0].fx[2] : null, retouch: v.project ? v.project.pages[0].layers[0].retouch : 0, same: v.project ? JSON.stringify(v.project.pages[0].layers[0].fx.slice(0, 2)) === JSON.stringify(s.layer(id).fx) : false };
    out.protoRefused = LE.project.validate(JSON.stringify(project).replace('"fx":[', '"fx":[{"type":"grain","p":{"__proto__":{"x":1}}},')).ok === false;
    out.assetIds = LE.project.assetIds(project).indexOf('d'.repeat(64)) >= 0;
    /* open format */
    const text = LE.design.stringify(project, { images: 'ids' }).text;
    out.designText = text.length;
    const parsed = await LE.design.parse(text);
    out.design = { ok: parsed.ok, errors: (parsed.errors || []).slice(0, 3), warnings: (parsed.warnings || []).map((w) => w.kind) };
    if (parsed.ok) {
      const pl = parsed.project.pages[0].layers;
      out.design.layers = pl.map((l) => [l.type, (l.fx || []).map((e) => e.type + ':' + e.id), !!l.layerMask, !!l.transform, l.clip]);
      out.design.p = pl[0].fx[1].p; out.design.quad = pl[0].transform.quad; out.design.raw = pl[0].raw; out.design.maps = pl[0].maps;
      const text2 = LE.design.stringify(parsed.project, { images: 'ids' }).text;
      out.design.stable = text2 === LE.design.stringify((await LE.design.parse(text2)).project, { images: 'ids' }).text;
    }
    const agent = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 400, height: 300, layers: [
      { type: 'shape', shape: 'rectangle', x: 0, y: 0, w: 400, h: 300, fill: '#336699', fx: [{ type: 'exposure', p: { ev: 40, zzz: 1 } }, { type: 'made-up', p: {} }], layerMask: { parts: [{ kind: 'radial', rx: 99 }] } },
      { type: 'adjust', fx: [{ type: 'grain', p: { amount: 10 } }] }
    ] }] }));
    out.agent = { ok: agent.ok, errors: (agent.errors || []).slice(0, 2), codes: (agent.warnings || []).map((w) => w.kind), ev: agent.ok ? agent.project.pages[0].layers[0].fx[0].p.ev : null, adj: agent.ok ? agent.project.pages[0].layers[1] : null, kept: agent.ok ? agent.project.pages[0].layers[0].fx.map((e) => e.type) : null };
    const bad = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 400, height: 300, layers: [{ type: 'text', text: 'a', x: 0, y: 0, fx: { not: 'a list' }, transform: { quad: [[0, 0]] } }] }] }));
    out.bad = { ok: bad.ok, paths: (bad.errors || []).map((e) => e.path) };
    return out;
  });
  h.assert.equal(JSON.stringify(r.stored), JSON.stringify([['image', ['exposure', 'future-effect'], true, true, true, true, undefined], ['adjust', ['contrast'], false, false, false, false, true]]), 'the scene stores expert fields');
  h.assert(r.undo1 === 1 && r.undo2 === false && r.redo === true, 'undo and redo: ' + JSON.stringify([r.undo1, r.undo2, r.redo]));
  h.assert.equal(r.alias.join(), 'ellipse,linear', 'mask string and mask object live side by side');
  h.assert(r.project.ok && r.project.same, 'the project sanitiser keeps valid expert data as it is');
  h.assert.equal(JSON.stringify(r.project.layers), JSON.stringify([['image', 3, undefined], ['adjust', 1, true], ['adjust', 32, false]]), 'bad entries are dropped and stacks capped');
  h.assert(r.project.grain.p.amount === 20 && !('onload' in r.project.grain) && r.project.grain.mask.parts.length === 8 && r.project.grain.p.evil === 'script', 'entry fields are cleaned: ' + JSON.stringify(r.project.grain).slice(0, 300));
  h.assert(r.project.retouch === undefined && r.protoRefused && r.assetIds, 'bad asset ids are refused, forbidden keys reject the file, map assets are kept alive');
  h.assert(r.design.ok, 'the open format reads what it wrote: ' + JSON.stringify(r.design.errors));
  h.assert.equal(JSON.stringify(r.design.layers), JSON.stringify([['image', ['exposure:e1', 'future-effect:e2'], true, true, undefined], ['adjust', ['contrast:c1'], false, false, true]]), 'open-format round trip');
  h.assert(r.design.p.strength === 3 && r.design.quad[1][0] === 1100 && r.design.raw.wb.temp === 5200 && r.design.maps.depth.model === 'depth-s' && r.design.stable, 'unknown effects, the quad, raw and maps survive, and a second round trip is byte-stable');
  h.assert(r.design.warnings.indexOf('unknown-type') >= 0, 'the unknown effect is reported');
  h.assert(r.agent.ok && r.agent.ev === 5 && r.agent.codes.indexOf('clamped') >= 0 && r.agent.codes.indexOf('unknown-key') >= 0 && r.agent.codes.indexOf('unknown-type') >= 0, 'an agent-written file is checked against the registry: ' + JSON.stringify(r.agent));
  h.assert(r.agent.adj.type === 'adjust' && r.agent.adj.w === 400 && r.agent.adj.h === 300 && r.agent.kept.join() === 'exposure,made-up', 'adjustment layers default to the page');
  h.assert(!r.bad.ok && r.bad.paths.some((p) => /\/fx$/.test(p)) && r.bad.paths.some((p) => /transform/.test(p)), 'malformed expert fields are errors with a path: ' + JSON.stringify(r.bad));
  h.assert.noErrors(page);
};

cases['studio: retouch overlay and a subject mask come from assets; a quad keeps its shape when the box moves'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  const r = await page.evaluate(async () => {
    const s = window.LEStudio.scene, id = s.layers()[0].id, L = s.layer(id), src = s._assets[L.src];
    await src.ready;
    const node = src.canvas || src.image, W = node.naturalWidth || node.width, H = node.naturalHeight || node.height;
    const mk = (draw) => { const c = document.createElement('canvas'); c.width = W; c.height = H; draw(c.getContext('2d')); return c; };
    s.addAsset('retouch-1', mk((x) => { x.fillStyle = '#ff00ff'; x.fillRect(W * 0.4, H * 0.4, W * 0.2, H * 0.2); }));
    s.addAsset('mask-1', mk((x) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(W / 2, H / 2, H * 0.4, 0, 7); x.fill(); }));
    const at = async (fx2, fy) => { const c = await s.render(0.5); return Array.from(c.getContext('2d').getImageData(Math.round(fx2 * c.width), Math.round(fy * c.height), 1, 1).data); };
    const out = {};
    s.update(id, { retouch: { asset: 'retouch-1', version: 1 } });
    out.retouch = await at(0.5, 0.5);
    s.update(id, { retouch: null, cutout: { asset: 'mask-1', enabled: false }, fx: [{ type: 'saturation', p: { saturation: -100 }, mask: { parts: [{ kind: 'subject', invert: true }] } }] });
    out.inside = await at(0.5, 0.75); out.outside = await at(0.03, 0.9);
    s.update(id, { cutout: { asset: 'mask-1', enabled: true, feather: 0 }, fx: [{ type: 'drop-shadow', p: { x: 0, y: 0, blur: 0, spread: 0, opacity: 1, color: '#00ff00' } }] });
    out.cutIn = await at(0.5, 0.75); out.cutOut = await at(0.03, 0.9);
    s.update(id, { cutout: null, fx: null });
    const res = window.LE.fx.ops.apply(s.toJSON(), { op: 'transform.set', layer: id, quad: [[100, 100], [1100, 0], [1100, 800], [100, 700]] });
    s.load(res.doc);
    out.quadCorner = await at(0.12, 0.03); out.quadInside = await at(0.5, 0.5); out.corners = window.LE.fx.quad.corners(s.layer(id));
    s.update(id, { x: 0, w: 600 });
    out.moved = window.LE.fx.quad.corners(s.layer(id)); out.movedCorner = await at(0.03, 0.03); out.movedInside = await at(0.25, 0.5); out.movedEmpty = await at(0.75, 0.5);
    out.hit = [s.hitTest(300, 400), s.hitTest(900, 400)];
    return out;
  });
  h.assert(r.retouch[0] > 240 && r.retouch[1] < 30 && r.retouch[2] > 240, 'the retouch overlay is drawn over the photo: ' + r.retouch);
  const spread = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  h.assert(spread(r.inside) > 12 && spread(r.outside) <= 2, 'a subject mask limits an effect without cutting out: ' + r.inside + ' / ' + r.outside);
  h.assert(r.cutIn[3] === 255 && spread(r.cutIn) > 12 && r.cutOut[0] === 255 && r.cutOut[1] === 255, 'the cut-out removes the surround after the effects: ' + r.cutIn + ' / ' + r.cutOut);
  h.assert(r.quadCorner.join() === '255,255,255,255' && r.quadInside[3] === 255 && spread(r.quadInside) > 3, 'the quad leaves its corner empty: ' + r.quadCorner + ' / ' + r.quadInside);
  h.assert.equal(JSON.stringify(r.corners), JSON.stringify([[100, 100], [1100, 0], [1100, 800], [100, 700]]), 'corners on the page');
  h.assert.equal(JSON.stringify(r.moved), JSON.stringify([[0, 100], [600, 0], [600, 800], [0, 700]]), 'the quad follows the box');
  h.assert(r.movedCorner.join() === '255,255,255,255' && spread(r.movedInside) > 3 && r.movedEmpty.join() === '255,255,255,255', 'and draws there');
  h.assert(r.hit[0] && r.hit[1] === null, 'hit-testing uses the bounding box');
  h.assert.noErrors(page);
};

cases['draw time: an effect can read the scene behind its layer; a clipped adjustment touches only the layer below'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  await page.evaluate(() => window.LE.fxBoot.load());
  const r = await page.evaluate(async () => {
    const FX = window.LE.fx, s = window.LEStudio.scene;
    /* A test-only effect: inside the layer's silhouette, show the scene behind it inverted. */
    FX.register({
      id: 'test-invert-behind', name: 'Invert behind', version: 1, space: 'display', needs: ['scene'], params: {},
      passes: function (g) { return g.pass('uniform sampler2D u_sc; vec4 fx(){ vec4 s = src(v_uv); vec3 b = texture(u_sc, v_uv).rgb; return vec4((1.0 - b) * s.a, s.a); }', { u_sc: g.scene() }); }
    });
    s.load({ v: 1, width: 400, height: 300, background: { type: 'color', color: '#ffffff' }, layers: [
      { id: 'red', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 300, fill: { type: 'solid', color: '#ff0000' } },
      { id: 'lens', type: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100, fill: { type: 'solid', color: '#00ff00' }, fx: [{ type: 'test-invert-behind' }] },
      { id: 'blue', type: 'shape', shape: 'rect', x: 20, y: 220, w: 100, h: 60, fill: { type: 'solid', color: '#2040ff' } },
      { id: 'grey', type: 'adjust', clip: true, fx: [{ type: 'saturation', p: { saturation: -100 } }] },
      { id: 'pink', type: 'shape', shape: 'rect', x: 280, y: 220, w: 100, h: 60, fill: { type: 'solid', color: '#ff40c0' } }
    ] });
    const c = await s.render(1), x = c.getContext('2d'), at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data);
    return { overRed: at(150, 150), overWhite: at(250, 150), red: at(50, 50), blue: at(70, 250), pink: at(330, 250), redBelow: at(10, 250), status: FX.status().warnings };
  });
  h.assert.equal(r.overRed.join(), '0,255,255,255', 'the lens shows the inverted red behind it');
  h.assert.equal(r.overWhite.join(), '0,0,0,255', 'and the inverted page colour');
  h.assert.equal(r.red.join(), '255,0,0,255', 'the scene itself is untouched');
  h.assert(r.blue[0] === r.blue[1] && r.blue[1] === r.blue[2] && r.blue[0] > 40, 'the clipped adjustment desaturates the layer below: ' + r.blue);
  h.assert.equal(r.pink.join(), '255,64,192,255', 'not the layer above');
  h.assert.equal(r.redBelow.join(), '255,0,0,255', 'and not the rest of the page');
  h.assert.noErrors(page);
};

cases['colour: Display-P3 output keeps colours sRGB would clip, where the browser supports it'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const FX = window.LE.fx, c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const x = c.getContext('2d'); x.fillStyle = '#f02010'; x.fillRect(0, 0, 32, 32);
    const stack = [{ type: 'saturation', p: { saturation: 100 } }];
    const srgb = FX.apply(c, { fx: stack }), p3 = FX.apply(c, { fx: stack, colorSpace: 'display-p3' });
    const attrs = p3.getContext('2d').getContextAttributes ? p3.getContext('2d').getContextAttributes() : {};
    const a = Array.from(srgb.getContext('2d').getImageData(16, 16, 1, 1).data), b = Array.from(p3.getContext('2d').getImageData(16, 16, 1, 1).data);
    return { supported: FX.status().p3, space: attrs.colorSpace || 'srgb', a, b, again: Array.from(FX.apply(c, { fx: stack }).getContext('2d').getImageData(16, 16, 1, 1).data) };
  });
  h.assert.equal(r.again.join(), r.a.join(), 'asking for P3 once does not change later sRGB renders');
  if (r.supported && r.space === 'display-p3') {
    /* Pushed past the sRGB gamut: sRGB clips green to 0, P3 still has room. */
    h.assert(r.a[1] === 0 && r.a[2] === 0 && r.a.join() !== r.b.join() && r.b[0] > 200, 'the P3 canvas holds a colour sRGB clips: sRGB ' + r.a + ', P3 ' + r.b);
  } else h.assert(r.a.join() === r.b.join(), 'without P3 the output is the sRGB one');
  h.assert.noErrors(page);
};

cases['masks: the shader agrees with the workspace reference (LE.expert.evalMask), part by part and combined'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['design']);
  await fx.attach(page);
  const r = await page.evaluate(async () => {
    const LE = window.LE, T = window.fxT;
    await LE.fxBoot.load();
    await LE.lazy(new URL('/assets/js/expert/expert.js', location.href).href);
    await LE.expert.load();
    const X = LE.expert, FX = LE.fx, W = 160, H = 120, card = T.card(W, H), px = card.getContext('2d').getImageData(0, 0, W, H).data;
    const brush = document.createElement('canvas'); brush.width = W; brush.height = H;
    const bx = brush.getContext('2d'); bx.strokeStyle = '#fff'; bx.lineWidth = 26; bx.lineCap = 'round'; bx.filter = 'blur(3px)'; bx.beginPath(); bx.moveTo(20, 30); bx.lineTo(120, 90); bx.stroke();
    const masks = {
      linear: { parts: [{ kind: 'linear', x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.7, feather: 0 }] },
      'linear eased': { parts: [{ kind: 'linear', x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.9, feather: 1 }] },
      'linear default feather': { parts: [{ kind: 'linear', x0: 0.9, y0: 0.5, x1: 0.1, y1: 0.5 }] },
      radial: { parts: [{ kind: 'radial', cx: 0.45, cy: 0.55, rx: 0.35, ry: 0.2, rotation: 30, feather: 0.4 }] },
      'radial inverted, dense': { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.4, feather: 0.6, invert: true, density: 0.7 }] },
      luma: { parts: [{ kind: 'luma', min: 0.3, max: 0.7, soft: 0.1 }] },
      color: { parts: [{ kind: 'color', h: 220, s: 0.7, l: 0.55, range: 0.2, soft: 0.15 }] },
      asset: { parts: [{ kind: 'asset', asset: 'brush-1' }] },
      'add, subtract, intersect': { parts: [{ kind: 'radial', cx: 0.3, cy: 0.5, rx: 0.3, ry: 0.4, feather: 0.3 }, { kind: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, feather: 0.5, mode: 'add' }, { kind: 'luma', min: 0.6, max: 1, soft: 0.1, mode: 'subtract' }, { kind: 'asset', asset: 'brush-1', mode: 'intersect', invert: true }] },
      'first part intersects': { parts: [{ kind: 'linear', x0: 0, y0: 0, x1: 1, y1: 1, feather: 0.3, mode: 'intersect' }, { kind: 'radial', cx: 0.6, cy: 0.4, rx: 0.5, ry: 0.5, feather: 0.5, mode: 'intersect' }] },
      'first part subtracts': { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0.3, mode: 'subtract' }] }
    };
    const out = {};
    Object.keys(masks).forEach((name) => {
      const ref = X.evalMask(masks[name], { w: W, h: H, pixels: px, assets: { 'brush-1': brush }, cutout: null });
      const got = FX.apply(card, { fx: [{ type: 'exposure', p: { ev: 0 } }], mask: masks[name], assets: (id) => (id === 'brush-1' ? brush : null) });
      const a = got.getContext('2d').getImageData(0, 0, W, H).data; let max = 0, sum = 0, over = 0, refSum = 0;
      for (let i = 0; i < W * H; i++) { const d = Math.abs(a[i * 4 + 3] / 255 - ref[i]); max = Math.max(max, d); sum += d; refSum += ref[i]; if (d > 0.03) over++; }
      out[name] = { max: Math.round(max * 1000) / 1000, mean: Math.round(sum / (W * H) * 10000) / 10000, over: over / (W * H), cover: Math.round(refSum / (W * H) * 100) / 100 };
    });
    /* Mask-level switches (the reference has none): off means no mask, invert flips the result; an empty inverted mask hides everything. */
    const alphaAt = (m, x, y) => FX.apply(card, { fx: [{ type: 'exposure', p: { ev: 0 } }], mask: m }).getContext('2d').getImageData(x, y, 1, 1).data[3];
    const lin = { kind: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, feather: 0 };
    out.switches = [alphaAt({ parts: [lin] }, 8, 60), alphaAt({ invert: true, parts: [lin] }, 8, 60), alphaAt({ on: false, parts: [lin] }, 150, 60), alphaAt({ invert: true, parts: [] }, 80, 60), alphaAt({ parts: [] }, 80, 60)];
    out.MASK = X.doc && X.doc.MASK;
    return out;
  });
  const sw = r.switches; delete r.switches; const MASK = r.MASK; delete r.MASK;
  Object.keys(r).forEach((name) => {
    h.assert(r[name].mean < 0.006 && r[name].over < 0.01 && r[name].max < 0.2, 'mask "' + name + '" against the reference: ' + JSON.stringify(r[name]));
  });
  h.assert(r['first part subtracts'].cover === 0 && r.radial.cover > 0.05 && r.linear.cover > 0.2, 'the reference itself is not trivial: ' + JSON.stringify([r['first part subtracts'].cover, r.radial.cover, r.linear.cover]));
  h.assert(sw[0] > 240 && sw[1] < 15 && sw[2] === 255 && sw[3] === 0 && sw[4] === 255, 'mask-level on and invert: ' + sw);
  h.assert(MASK === undefined || MASK === 'layerMask', 'the workspace writes the layer mask where the renderer reads it: ' + MASK);
  h.assert.noErrors(page);
};

cases['curves: the lookup table the shader uses is LE.curves, sample for sample, and loads without the workspace'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const LE = window.LE, FX = LE.fx, C = LE.curves, pts = [[0, 0.05], [0.2, 0.12], [0.5, 0.62], [0.8, 0.9], [1, 0.97]];
    const table = FX.math.curveTable(FX.validate({ type: 'curves', p: { curve: pts } }).entry.p.curve, 256), ref = C.sample(pts, 256), lut = C.lut(pts, 256);
    let exact = 0, lutSame = 0;
    for (let i = 0; i < 256; i++) { if (table[i * 3] === ref[i] && table[i * 3 + 1] === ref[i] && table[i * 3 + 2] === ref[i]) exact++; if (Math.round(table[i * 3] * 255) === lut[i]) lutSame++; }
    /* Channel curves compose with the master through the same functions. */
    const two = FX.math.curveTable({ master: pts, r: [[0, 0.1], [1, 0.8]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, 256), fm = C.monotone(pts), fr = C.monotone([[0, 0.1], [1, 0.8]]);
    let comp = 0; for (let i = 0; i < 256; i++) if (Math.abs(two[i * 3] - fm(fr(i / 255))) < 1e-6) comp++;
    /* And through the GPU: a grey ramp of every 8-bit level. */
    const c = document.createElement('canvas'); c.width = 256; c.height = 4; const x = c.getContext('2d'), id = x.createImageData(256, 4);
    for (let i = 0; i < 256 * 4; i++) { const v = i % 256; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    const d = FX.apply(c, { fx: [{ type: 'curves', p: { curve: { master: pts } } }] }).getContext('2d').getImageData(0, 1, 256, 1).data;
    let worst = 0; for (let i = 0; i < 256; i++) worst = Math.max(worst, Math.abs(d[i * 4] - lut[i]));
    return { exact, lutSame, comp, worst, workspace: !!LE.expert, version: C.version };
  });
  h.assert(r.workspace === false && r.version >= 1, 'LE.curves is there without the workspace');
  h.assert.equal(r.exact, 256, 'a master-only table equals LE.curves.sample');
  h.assert.equal(r.lutSame, 256, 'and LE.curves.lut once rounded to 8 bits');
  h.assert.equal(r.comp, 256, 'channel then master');
  h.assert(r.worst <= 1, 'the rendered ramp follows LE.curves.lut within one level (dither): ' + r.worst);
};

cases['float sources and maps: typed-array pixels render and tile; depth and face masks resolve from the packed maps'] = async ({ browser, base, h }) => {
  const page = await fx.page(browser, base);
  const r = await page.evaluate(() => {
    const LE = window.LE, FX = LE.fx, M = FX.math, W = 160, H = 96, out = {};
    /* What a RAW decode hands over: linear float RGB, top row first. */
    const f = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, v = x / (W - 1); f[i] = v; f[i + 1] = v * 0.5; f[i + 2] = y / (H - 1); }
    const src = { data: f, width: W, height: H, channels: 3, space: 'linear' };
    const px = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    const want = (x, y, k) => [x / (W - 1) * k, x / (W - 1) * 0.5 * k, y / (H - 1) * k].map((v) => Math.round(M.linearToSrgb(Math.min(1, v)) * 255));
    const plain = FX.apply(src, { fx: [] }), bright = FX.apply(src, { fx: [{ type: 'exposure', p: { ev: 1 } }] });
    out.plain = [px(plain, 40, 20), want(40, 20, 1), px(plain, 150, 90), want(150, 90, 1)];
    out.bright = [px(bright, 40, 20), want(40, 20, 2)];
    const stack = [{ type: 'gaussian-blur', p: { radius: 3 } }, { type: 'contrast', p: { amount: 20 } }];
    const one = FX.apply(src, { fx: stack }), many = FX.apply(src, { fx: stack, tile: 64 });
    const a = one.getContext('2d').getImageData(0, 0, W, H).data, b = many.getContext('2d').getImageData(0, 0, W, H).data; let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    out.tiles = worst;
    const u16 = new Uint16Array(W * H * 4); for (let i = 0; i < W * H; i++) { u16[i * 4] = 65535; u16[i * 4 + 1] = 32768; u16[i * 4 + 2] = 0; u16[i * 4 + 3] = 65535; }
    out.u16 = px(FX.apply({ data: u16, width: W, height: H, channels: 4, space: 'display' }, { fx: [] }), 10, 10);
    /* Depth: 16 bits packed as red (high byte) and green (low byte), near = 1. Nearest on the left here. */
    const dc = document.createElement('canvas'); dc.width = 64; dc.height = 32; const dx = dc.getContext('2d'), did = dx.createImageData(64, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) { const v = Math.round((1 - x / 63) * 65535), i = (y * 64 + x) * 4; did.data[i] = v >> 8; did.data[i + 1] = v & 255; did.data[i + 3] = 255; }
    dx.putImageData(did, 0, 0);
    const white = document.createElement('canvas'); white.width = W; white.height = H; white.getContext('2d').fillStyle = '#fff'; white.getContext('2d').fillRect(0, 0, W, H);
    const assets = (id) => (id === 'depth-1' ? dc : null);
    const near = FX.apply(white, { fx: [{ type: 'exposure', p: { ev: 0 } }], mask: { parts: [{ kind: 'depth', near: 0, far: 0.4, soft: 0.05 }] }, layer: { maps: { depth: { asset: 'depth-1', model: 'x', version: 1 } } }, assets });
    out.depth = [px(near, 10, 48)[3], px(near, 60, 48)[3], px(near, 100, 48)[3], px(near, 150, 48)[3]];
    out.noDepth = px(FX.apply(white, { fx: [{ type: 'exposure', p: { ev: 0 } }], mask: { parts: [{ kind: 'depth', near: 0, far: 0.4 }] }, layer: {} }), 150, 48)[3];
    /* Face: LE.maps.faceMask(face, part, w, h) draws the part; a stand-in here with the same call shape. */
    LE.maps = { faceMask: (face, part, w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.fillStyle = '#fff'; const q = face.parts[part]; if (q) x.fillRect(q[0] * w, q[1] * hh, q[2] * w, q[3] * hh); return c; } };
    const face = FX.apply(white, { fx: [{ type: 'exposure', p: { ev: 0 } }], mask: { parts: [{ kind: 'face', part: 'lips' }] }, layer: { maps: { face: { parts: { lips: [0.25, 0.5, 0.5, 0.25] } } } } });
    out.face = [px(face, 80, 60)[3], px(face, 80, 20)[3], px(face, 10, 60)[3]];
    delete LE.maps;
    return out;
  });
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  h.assert(near(r.plain[0].slice(0, 3), r.plain[1]) && near(r.plain[2].slice(0, 3), r.plain[3]), 'linear float pixels come out display-encoded: ' + JSON.stringify(r.plain));
  h.assert(near(r.bright[0].slice(0, 3), r.bright[1]), 'effects run on them in linear light: ' + JSON.stringify(r.bright));
  h.assert(r.tiles <= 1, 'a float source tiles without seams (largest difference ' + r.tiles + ')');
  h.assert(near(r.u16.slice(0, 3), [255, 128, 0]), '16-bit integer data is accepted: ' + r.u16);
  h.assert(r.depth[0] > 240 && r.depth[1] > 200 && r.depth[2] < 15 && r.depth[3] === 0, 'a depth mask selects the near part of the packed map: ' + r.depth);
  h.assert(r.noDepth === 255, 'without a map it selects everything, like the reference');
  h.assert(r.face[0] === 255 && r.face[1] === 0 && r.face[2] === 0, 'a face mask is drawn by LE.maps.faceMask: ' + r.face);
  h.assert.noErrors(page);
};

module.exports = cases;
