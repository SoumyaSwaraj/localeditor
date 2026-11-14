'use strict';
/* Expert effects through the agent API (LEAgent): the fx.*, mask.set, adjust.add and transform.set operations, analyze and catalog("fx").
   Each batch is one step of the person's undo history; layers and entries can be named. Headless pages render the effects too. */
const cases = {};

async function ready(page) { await page.waitForFunction(() => window.LEAgent && window.LEStudio && LEAgent._internal.A.ready); }
async function session(browser, base, h) {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['agentui']);
  await ready(page);
  const p = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'Grading a photo' }));
  await page.click('.sxa-ask [data-yes]');
  const r = await p;
  h.assert(r.ok, 'begin failed: ' + JSON.stringify(r));
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  return page;
}
/* A small photo with a horizon: something for exposure, a mask and statistics to act on. */
const photo = (page) => page.evaluate(() => {
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 64;
  const x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 96, 64);
  g.addColorStop(0, '#27405e'); g.addColorStop(0.5, '#b98d5a'); g.addColorStop(1, '#3d2a1c');
  x.fillStyle = g; x.fillRect(0, 0, 96, 64); x.fillStyle = '#e8e2d4'; x.fillRect(60, 10, 20, 14);
  return cv.toDataURL('image/png');
});
const stackOf = (page, id) => page.evaluate((id) => { const l = LEStudio.scene.toJSON().layers.find((x) => x.id === id); return l ? { fx: (l.fx || []).map((e) => ({ id: e.id, type: e.type, p: e.p, amount: e.amount, mask: e.mask || null })), layerMask: l.layerMask || null, quad: l.transform && l.transform.quad || null } : null; }, id);
const depth = (page) => page.evaluate(() => LEStudio.scene._hist.undo.length);
const HERO = (png) => ({ op: 'add', layer: { id: 'hero', name: 'Beach photo', type: 'image', src: png, x: 90, y: 90, w: 900, h: 600 } });

cases['an agent adds a grade stack to a photo, masks it, reorders and removes; names resolve; the person undoes it step by step'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await photo(page);
  let r = await page.evaluate((op) => LEAgent.apply([op]), HERO(png));
  h.assert(r.ok, 'photo added: ' + JSON.stringify(r).slice(0, 300));
  const d0 = await depth(page);

  /* One batch, three effects; the layer is named, not identified. */
  r = await page.evaluate(() => LEAgent.apply([
    { op: 'fx.add', layer: 'Beach photo', entry: { type: 'exposure', p: { ev: 0.5 } } },
    { op: 'fx.add', layer: 'Beach photo', entry: { type: 'contrast', p: { amount: 20 } } },
    { op: 'fx.add', layer: 'hero', entry: { type: 'gaussian-blur', p: { radius: 12 } } }
  ], { label: 'Grade the photo' }));
  h.assert(r.ok && r.applied === 3, 'three effects added: ' + JSON.stringify(r).slice(0, 400));
  h.assert(r.results.every((x) => x.layer === 'hero' && typeof x.id === 'string'), 'each result names the layer id and the new entry id: ' + JSON.stringify(r.results));
  let s = await stackOf(page, 'hero');
  h.assert.equal(s.fx.map((e) => e.type).join(), 'exposure,contrast,gaussian-blur');
  h.assert.equal(await depth(page) - d0, 1, 'a batch is one undo step');

  /* Mask one effect (named by type), then the layer; update by type; reorder; remove. One batch each. */
  r = await page.evaluate(() => LEAgent.apply([{ op: 'mask.set', layer: 'Beach photo', fx: 'gaussian-blur', mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0.5, invert: true }] } }]));
  h.assert(r.ok, 'mask.set on an entry: ' + JSON.stringify(r).slice(0, 300));
  r = await page.evaluate(() => LEAgent.apply([{ op: 'mask.set', layer: 'hero', mask: { parts: [{ kind: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 1 }] } }]));
  h.assert(r.ok, 'mask.set on the layer: ' + JSON.stringify(r).slice(0, 300));
  r = await page.evaluate(() => LEAgent.apply([{ op: 'fx.update', layer: 'hero', id: 'exposure', p: { ev: 0.25 }, amount: 0.8 }]));
  h.assert(r.ok, 'fx.update by type: ' + JSON.stringify(r).slice(0, 300));
  s = await stackOf(page, 'hero');
  h.assert(s.fx[2].mask && s.fx[2].mask.parts[0].kind === 'radial' && s.fx[2].mask.parts[0].invert === true, 'the blur carries its mask');
  h.assert(s.layerMask && s.layerMask.parts[0].kind === 'linear', 'the layer mask is set');
  h.assert(s.fx[0].p.ev === 0.25 && s.fx[0].amount === 0.8 && s.fx[1].p.amount === 20, 'update merged the parameters: ' + JSON.stringify(s.fx[0]));
  r = await page.evaluate(() => LEAgent.apply([{ op: 'fx.reorder', layer: 'hero', id: 'gaussian-blur', index: 0 }]));
  h.assert(r.ok, 'fx.reorder: ' + JSON.stringify(r).slice(0, 300));
  h.assert.equal((await stackOf(page, 'hero')).fx.map((e) => e.type).join(), 'gaussian-blur,exposure,contrast');
  r = await page.evaluate(() => LEAgent.apply([{ op: 'fx.remove', layer: 'hero', id: 'contrast' }]));
  h.assert(r.ok, 'fx.remove: ' + JSON.stringify(r).slice(0, 300));
  h.assert.equal((await stackOf(page, 'hero')).fx.map((e) => e.type).join(), 'gaussian-blur,exposure');
  h.assert.equal(await depth(page) - d0, 6, 'six batches, six undo steps');

  /* The effects are on screen: the picture differs from the same page with the stacks taken off. */
  const lit = await page.evaluate(async () => {
    const S = LEStudio.scene;
    const grab = (cv) => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const a = grab(await S.render(0.25));
    const doc = S.toJSON(); doc.layers.forEach((l) => { delete l.fx; delete l.layerMask; });
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px'; document.body.appendChild(host);
    const T = new LE.Scene({ el: host, width: doc.width, height: doc.height });
    Object.keys(S._assets).forEach((k) => { const r = S._assets[k]; if (r.image || r.canvas) T.addAsset(k, r.image || r.canvas); });
    T.load(doc);
    const b = grab(await T.render(0.25)); T.destroy(); host.remove();
    let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++;
    return n;
  });
  h.assert(lit > 2000, 'the stack changes the picture: ' + lit + ' pixels differ');

  /* The person steps back through it, one batch at a time, and forward again. */
  const back = [];
  for (let i = 0; i < 6; i++) { await page.evaluate(() => LEStudio.scene.undo()); const t = await stackOf(page, 'hero'); back.push(t.fx.map((e) => e.type).join() + (t.layerMask ? '+mask' : '') + (t.fx.some((e) => e.mask) ? '+fxmask' : '')); }
  h.assert.equal(back.join(' | '), 'gaussian-blur,exposure,contrast+mask+fxmask | exposure,contrast,gaussian-blur+mask+fxmask | exposure,contrast,gaussian-blur+mask+fxmask | exposure,contrast,gaussian-blur+fxmask | exposure,contrast,gaussian-blur | ');
  for (let i = 0; i < 6; i++) await page.evaluate(() => LEStudio.scene.redo());
  h.assert.equal((await stackOf(page, 'hero')).fx.map((e) => e.type).join(), 'gaussian-blur,exposure', 'redo brings it all back');
  h.assert.noErrors(page);
};

cases['adjustment layers, perspective and precise errors; a failed operation changes nothing'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await photo(page);
  await page.evaluate((op) => LEAgent.apply([op, { op: 'add', layer: { id: 'label', type: 'text', text: 'Hello', x: 100, y: 760, size: 80 } }]), HERO(png));
  let r = await page.evaluate(() => LEAgent.apply([
    { op: 'adjust.add', fx: [{ type: 'saturation', p: { saturation: -40 } }], name: 'Muted', above: 'Beach photo' },
    { op: 'transform.set', layer: 'hero', quad: [[90, 130], [990, 90], [990, 690], [90, 650]] }
  ]));
  h.assert(r.ok && r.results[0].added && r.results[0].added.length === 1, 'adjust.add and transform.set: ' + JSON.stringify(r).slice(0, 400));
  const doc = await page.evaluate(() => LEStudio.scene.toJSON().layers.map((l) => ({ id: l.id, type: l.type, name: l.name, fx: (l.fx || []).map((e) => e.type), quad: l.transform && l.transform.quad })));
  h.assert.equal(doc.map((l) => l.type).join(), 'image,adjust,text', 'the adjustment layer sits just above the photo');
  h.assert(doc[1].name === 'Muted' && doc[1].fx.join() === 'saturation' && doc[0].quad && doc[0].quad.length === 4, 'adjust layer and quad: ' + JSON.stringify(doc));

  const before = await page.evaluate(() => JSON.stringify(LEStudio.scene.toJSON()));
  const bad = [];
  for (const ops of [
    [{ op: 'fx.add', layer: 'hero', entry: { type: 'no-such-effect' } }],
    [{ op: 'fx.add', layer: 'nobody', entry: { type: 'exposure' } }],
    [{ op: 'fx.add', entry: { type: 'exposure' } }],
    [{ op: 'fx.update', layer: 'hero', id: 'grain', p: { amount: 1 } }],
    [{ op: 'fx.add', layer: 'hero', entry: { type: 'exposure', p: { ev: 0.2 } } }, { op: 'fx.remove', layer: 'hero', id: 'missing' }]
  ]) bad.push(await page.evaluate((ops) => LEAgent.apply(ops), ops));
  bad.forEach((b, i) => h.assert(b.ok === false && b.code === 'invalid' && b.applied === 0 && b.errors[0].message.length > 10, 'bad batch ' + i + ' is refused with a reason: ' + JSON.stringify(b).slice(0, 300)));
  h.assert(/catalog\("fx"\)/.test(bad[0].errors[0].message), 'an unknown type points at the catalog: ' + bad[0].errors[0].message);
  h.assert(/\/ops\/0\/layer/.test(bad[1].errors[0].path) && /\/ops\/0\/layer/.test(bad[2].errors[0].path), 'the error path names the field: ' + bad[1].errors[0].path + ' ' + bad[2].errors[0].path);
  h.assert.equal(await page.evaluate(() => JSON.stringify(LEStudio.scene.toJSON())), before, 'refused batches change nothing');

  /* Two of a kind: the type alone is ambiguous and the message lists the ids. */
  await page.evaluate(() => LEAgent.apply([{ op: 'fx.add', layer: 'hero', entry: { type: 'exposure', p: { ev: 0.1 } } }, { op: 'fx.add', layer: 'hero', entry: { type: 'exposure', p: { ev: -0.1 } } }]));
  const amb = await page.evaluate(() => LEAgent.apply([{ op: 'fx.remove', layer: 'hero', id: 'exposure' }]));
  const ids = await page.evaluate(() => LEStudio.scene.toJSON().layers[0].fx.map((e) => e.id));
  h.assert(ids.length === 2 && amb.ok === false && ids.every((id) => amb.errors[0].message.indexOf(id) >= 0), 'ambiguous type lists the entry ids: ' + JSON.stringify(amb.errors));
  const byId = await page.evaluate((id) => LEAgent.apply([{ op: 'fx.remove', layer: 'hero', id }]), ids[0]);
  h.assert(byId.ok, 'removal by entry id');
  /* Resizing the page with its content carries pixel lengths along. */
  await page.evaluate(() => LEAgent.apply([{ op: 'fx.add', layer: 'hero', entry: { id: 'soft', type: 'gaussian-blur', p: { radius: 12 } } }]));
  const size0 = await page.evaluate(() => { const d = LEStudio.scene.toJSON(); return [d.width, d.height]; });
  const rs = await page.evaluate((sz) => LEAgent.apply([{ op: 'page.resize', width: sz[0] * 2, height: sz[1] * 2 }]), size0);
  const soft = await page.evaluate(() => LEStudio.scene.toJSON().layers[0].fx.find((e) => e.id === 'soft').p.radius);
  h.assert(rs.ok && soft === 24, 'page.resize with content doubles a 12 px blur: ' + soft + ' ' + JSON.stringify(rs).slice(0, 200));
  /* Typed commands reach the same operations. */
  const cmd = await page.evaluate(() => LEAgent.command({ op: 'fx.update', layer: 'hero', id: 'exposure', p: { ev: 0.3 } }));
  h.assert(cmd.ok, 'command() runs an expert operation: ' + JSON.stringify(cmd).slice(0, 200));
  h.assert.noErrors(page);
};

cases['analyze and catalog("fx"): numbers to grade by, a compact index, one effect in full; help lists the operations'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await photo(page);
  await page.evaluate((op) => LEAgent.apply([op]), HERO(png));
  const r = await page.evaluate(async () => ({
    layer: await LEAgent.analyze('Beach photo'), pageStats: await LEAgent.analyze(), viaCommand: await LEAgent.command({ op: 'analyze', target: 'hero' }), missing: await LEAgent.analyze('nobody'),
    index: await LEAgent.catalog('fx'), search: await LEAgent.catalog('fx', 'blur'), one: await LEAgent.catalog('fx', 'exposure'), schema: await LEAgent.catalog('fx', 'schema'), actions: await LEAgent.catalog('fx', 'actions'),
    fonts: await LEAgent.catalog('fonts', 'anton'), help: LEAgent.help()
  }));
  h.assert(r.layer.ok && r.layer.target === 'hero' && r.layer.stats && r.layer.stats.histogram && r.layer.stats.percentiles, 'analyze(layer name): ' + JSON.stringify(r.layer).slice(0, 300));
  h.assert(r.pageStats.ok && r.pageStats.target === 'page' && r.viaCommand.ok && r.viaCommand.target === 'hero', 'analyze() of the page and through command()');
  h.assert(r.missing.ok === false && /No layer/.test(r.missing.message), 'analyze of a missing layer: ' + r.missing.message);
  h.assert(JSON.stringify(r.layer).length < 20000, 'analysis stays compact: ' + JSON.stringify(r.layer).length);
  h.assert(r.index.ok && r.index.total >= 20 && r.index.items.every((e) => e.id && e.summary && !e.params) && JSON.stringify(r.index).length < 16000, 'catalog("fx") is a paged index: ' + r.index.total + ', ' + JSON.stringify(r.index).length + ' characters');
  h.assert(r.search.items.length >= 1 && r.search.items.length < r.index.total && r.search.items.some((e) => e.id === 'gaussian-blur'), 'catalog("fx", "blur") searches');
  h.assert(r.one.effect && r.one.effect.id === 'exposure' && r.one.effect.params.ev && r.one.effect.agent.example.type === 'exposure', 'catalog("fx", id) gives one effect in full');
  h.assert(r.schema.schema.blends.length > 5 && r.schema.schema.maskKinds.length === 9 && Array.isArray(r.actions.actions), 'schema and actions');
  h.assert(r.fonts.ok && r.fonts.kind === 'fonts', 'the other catalogs are untouched');
  ['fx.add', 'fx.update', 'fx.remove', 'fx.reorder', 'mask.set', 'adjust.add', 'transform.set'].forEach((op) => h.assert(r.help.operations[op] && r.help.operations[op].example.op === op, 'help lists ' + op));
  h.assert(JSON.stringify(r.help).length < 40000, 'help stays compact: ' + JSON.stringify(r.help).length);
  h.assert.noErrors(page);
};

cases['headless: a design with effects loads, takes expert operations, and exports with them applied'] = async ({ browser, base, h }) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { window.LE_AGENT_HEADLESS = true; });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
  await ready(page);
  const png = await photo(page);
  const r = await page.evaluate(async (png) => {
    const mean = async (url) => { const im = new Image(); im.src = url; await im.decode(); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const x = cv.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const design = (fx) => ({ format: 'localeditor-design', version: 1, name: 'Graded', pages: [{ width: 600, height: 400, background: '#000000', layers: [Object.assign({ id: 'hero', type: 'image', src: png, x: 0, y: 0, w: 600, h: 400 }, fx ? { fx } : {})] }] });
    await LEAgent.load(design());
    const plain = await mean((await LEAgent.export({ format: 'png' })).dataUrl);
    const loaded = await LEAgent.load(design([{ type: 'exposure', p: { ev: 1 } }]));
    const fromFile = await mean((await LEAgent.export({ format: 'png' })).dataUrl);
    const ap = await LEAgent.apply([{ op: 'fx.update', layer: 'hero', id: 'exposure', p: { ev: -1.5 } }, { op: 'fx.add', layer: 'hero', entry: { type: 'saturation', p: { saturation: -100 } } }]);
    const exported = await LEAgent.export({ format: 'png' });
    const afterOps = await mean(exported.dataUrl);
    const saved = await LEAgent.save({ images: 'embed' });
    return { loaded: loaded.ok, plain, fromFile, ap, afterOps, saved: saved.text, status: window.LE.fx.status() };
  }, png);
  h.assert(r.loaded && r.ap.ok, 'load and apply: ' + JSON.stringify(r.ap).slice(0, 300));
  h.assert(r.fromFile > r.plain * 1.3, 'effects in a loaded design are rendered in the export: ' + r.plain.toFixed(1) + ' to ' + r.fromFile.toFixed(1));
  h.assert(r.afterOps < r.plain * 0.7, 'effects applied by operations are rendered in the export: ' + r.plain.toFixed(1) + ' to ' + r.afterOps.toFixed(1));
  h.assert(r.status.available, 'the renderer is up on the headless page');
  const out = JSON.parse(r.saved);
  h.assert(out.pages[0].layers[0].fx.length === 2 && out.pages[0].layers[0].fx[0].type === 'exposure' && out.pages[0].layers[0].fx[0].p.ev === -1.5, 'the saved design carries the stack: ' + JSON.stringify(out.pages[0].layers[0].fx));
  h.assert(page.errors.length === 0, page.errors.join('\n'));
  await ctx.close();
};

cases['end to end: a photo is cut out, staged as a product with one helper call, graded with a preset and exported; undo walks back'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await photo(page);
  await page.evaluate((op) => LEAgent.apply([{ op: 'page.background', background: '#f2efe8' }, op]), HERO(png));
  const mean = (url) => page.evaluate(async (u) => { const im = new Image(); im.src = u; await im.decode(); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const x = cv.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, cv.width, cv.height).data; let n = 0, sum = 0; for (let i = 0; i < d.length; i += 4) { sum += d[i] + d[i + 1] + d[i + 2]; n++; } return sum / n / 3; }, url);
  /* The cut-out model is stubbed: its result is a disc mask stored on the layer, as the background remover leaves it. */
  await page.evaluate(() => { const m = document.createElement('canvas'); m.width = 96; m.height = 64; const x = m.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.ellipse(48, 30, 30, 24, 0, 0, 7); x.fill(); LEStudio.scene.addAsset('stub-cutout', m); LEStudio.scene.update('hero', { cutout: { asset: 'stub-cutout', feather: 1 } }); });
  const d0 = await depth(page);
  const before = await mean((await page.evaluate(() => LEAgent.export({ format: 'png', scale: 0.5 }))).dataUrl);
  const staged = await page.evaluate(() => LEAgent.apply([{ op: 'fx.call', layer: 'Beach photo', name: 'composite.stage', args: { preset: 'soft-table-reflection' } }], { label: 'Stage the product' }));
  h.assert(staged.ok && staged.results[0].applied >= 2, 'composite.stage answered with operations and they were applied: ' + JSON.stringify(staged).slice(0, 400));
  const presetId = await page.evaluate(() => LE.fx.grade.presets[0].id);
  const graded = await page.evaluate((id) => LEAgent.apply([{ op: 'fx.call', layer: 'hero', name: 'grade.preset', args: { id } }]), presetId);
  h.assert(graded.ok && graded.results[0].applied >= 1, 'grade.preset: ' + JSON.stringify(graded).slice(0, 300));
  const s2 = await stackOf(page, 'hero');
  const types = s2.fx.map((e) => e.type);
  h.assert(types.length >= 3 && types.some((t) => /shadow|reflection/.test(t)), 'the layer carries shadows or a reflection and the grade: ' + types.join());
  const after = await mean((await page.evaluate(() => LEAgent.export({ format: 'png', scale: 0.5 }))).dataUrl);
  h.assert(Math.abs(after - before) > 0.5, 'the export changed: ' + before.toFixed(2) + ' to ' + after.toFixed(2));
  h.assert.equal(await depth(page) - d0, 2, 'two batches, two undo steps');
  await page.evaluate(() => LEStudio.scene.undo());
  const s1 = await stackOf(page, 'hero');
  await page.evaluate(() => LEStudio.scene.undo());
  const s0 = await stackOf(page, 'hero');
  h.assert(s1.fx.length < s2.fx.length && s1.fx.length >= 2 && s0.fx.length === 0, 'undo walks back through the grade, then the staging: ' + [s2.fx.length, s1.fx.length, s0.fx.length]);
  h.assert.noErrors(page);
};

cases['helpers, maps, RAW and template fields through the agent: fx.call is allow-listed; map.generate, raw.*, catalog("raw"), variables and appearance answer'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await photo(page);
  await page.evaluate((op) => LEAgent.apply([op, { op: 'add', layer: { id: 'label', type: 'text', text: 'Hello {{name}}', x: 100, y: 760, size: 80 } }]), HERO(png));
  await page.addScriptTag({ url: base + '/tools/dng-synth/dng-synth.js' });
  const r = await page.evaluate(async () => {
    const one = (op) => Promise.race([LEAgent.apply([op]), new Promise((res) => setTimeout(() => res({ ok: false, timedOut: op.op + ' ' + (op.name || '') }), 20000))]);
    const out = {};
    const step = (label, pr) => Promise.race([pr, new Promise((res, rej) => setTimeout(() => rej(new Error('stuck at ' + label)), 20000))]);
    out.unknown = await one({ op: 'fx.call', layer: 'hero', name: 'constructor' });
    out.noName = await one({ op: 'fx.call', layer: 'hero' });
    out.look = await one({ op: 'fx.call', layer: 'hero', name: 'creative.look', args: { id: Object.keys(LE.fx.creative.presets)[0] } });
    out.badLook = await one({ op: 'fx.call', layer: 'hero', name: 'creative.look', args: { id: 'nope' } });
    out.heal = await one({ op: 'fx.call', layer: 'hero', name: 'retouch.heal', args: { x: 0.4, y: 0.5, r: 0.03 } });
    out.estimate = await one({ op: 'fx.call', layer: 'hero', name: 'relight.estimate' });
    out.auto = await one({ op: 'fx.call', layer: 'hero', name: 'grade.auto' });
    out.actions = (await step('catalog actions', LEAgent.catalog('fx', 'actions'))).actions.filter((a) => a.kind === 'call').map((a) => a.id);
    /* map.generate with the model stubbed: the op stores what the maps module answers. */
    if (!LE.maps) await step('maps module', LE.lazy(new URL('../assets/js/le-maps.js', location.href).href));
    const run0 = LE.maps.ops.run;
    LE.maps.ops.run = async (op, o) => { const c = document.createElement('canvas'); c.width = 32; c.height = 24; c.getContext('2d').fillRect(0, 0, 32, 24); const img = await o.image(o.layer); const id = await o.store(c, 'depth.png'); return { ok: true, kind: op.kind, layer: o.layer.id, asset: id, maps: { depth: { asset: id, width: 32, height: 24, model: 'stub', version: 1 } }, info: { image: !!img } }; };
    out.map = await one({ op: 'map.generate', layer: 'Beach photo', kind: 'depth' });
    LE.maps.ops.run = async () => ({ ok: false, code: 'unsupported', message: 'This device cannot make this map.', canForce: true });
    out.mapNo = await one({ op: 'map.generate', layer: 'hero', kind: 'faces' });
    LE.maps.ops.run = run0;
    out.maps = LEStudio.scene.layer('hero').maps;
    out.mapAsset = !!(out.maps && out.maps.depth && LEStudio.scene._assets[out.maps.depth.asset]);
    /* RAW: a synthetic DNG in, a developed layer out; settings and auto tone are ordinary operations. */
    const S = LEDngSynth, sc = S.scene(256, 192, 'natural', { sigma: 0.8 }), cam = S.cameraFor();
    const mos = S.mosaic(sc, { bits: 14, black: 256, white: 16383, cam, headroom: 0.9 });
    const bytes = S.writeDNG({ width: 256, height: 192, mosaic: mos, bits: 14, black: 256, white: 16383, cam, compression: 'lj92', tile: [128, 128] });
    out.ref = LEAgent.file(new File([bytes], 'synthetic.dng', { type: 'image/x-adobe-dng' }));
    out.raw = await one({ op: 'raw.open', file: out.ref, id: 'dng' });
    const L = () => LEStudio.scene.layer('dng');
    out.rawLayer = L() ? { raw: !!L().raw, fx: (L().fx || []).map((e) => e.type), w: L().w } : null;
    out.cat = await step('catalog raw', LEAgent.catalog('raw'));
    out.settings = await one({ op: 'raw.settings', layer: 'dng', preset: out.cat.ok && out.cat.presets[0] ? out.cat.presets[0].id : 'x' });
    out.notRaw = await one({ op: 'raw.settings', layer: 'hero', preset: 'x' });
    out.tone = await one({ op: 'raw.autoTone', layer: 'dng' });
    out.hdrBad = await one({ op: 'hdr.merge', files: ['only-one.jpg'] });
    /* Template fields and the appearance in state(). */
    out.vars = await one({ op: 'variables.set', variables: [{ key: 'name', label: 'Name' }] });
    out.vals = await one({ op: 'values.set', values: { name: 'Ana' } });
    const st = await step('state', LEAgent.state());
    out.appearance = 'appearance' in st; out.stateOk = st.ok !== false;
    const help = LEAgent.help();
    out.help = ['fx.call', 'map.generate', 'raw.open', 'hdr.merge', 'raw.settings', 'raw.autoTone', 'variables.set', 'values.set', 'bulk.create'].filter((k) => !help.operations[k]);
    out.helpSize = JSON.stringify(help).length;
    return out;
  });
  h.assert(r.unknown.ok === false && /No helper named/.test(r.unknown.errors[0].message) && r.noName.ok === false, 'only registered helpers can be called: ' + JSON.stringify(r.unknown.errors).slice(0, 200));
  h.assert(r.look.ok && r.look.results[0].applied >= 1 && r.badLook.ok === false && /Known:/.test(r.badLook.errors[0].message), 'creative.look: ' + JSON.stringify([r.look.results, r.badLook.errors]).slice(0, 300));
  h.assert(r.heal.ok && r.heal.results[0].applied === 1, 'retouch.heal: ' + JSON.stringify(r.heal).slice(0, 300));
  h.assert(r.estimate.ok && r.estimate.results[0].applied === 0 && r.estimate.results[0].data && typeof r.estimate.results[0].data.azimuth === 'number', 'relight.estimate answers with data and changes nothing: ' + JSON.stringify(r.estimate).slice(0, 300));
  h.assert(r.auto.ok, 'a button action is callable too (grade.auto): ' + JSON.stringify(r.auto).slice(0, 200));
  ['grade.preset', 'creative.look', 'composite.stage', 'composite.match', 'retouch.heal', 'retouch.liquify', 'relight.portrait', 'relight.retime', 'relight.estimate'].forEach((id) => h.assert(r.actions.indexOf(id) >= 0, 'helper listed: ' + id));
  h.assert(r.map.ok && r.maps && r.maps.depth.model === 'stub' && r.mapAsset && r.map.results[0].info.image === true, 'map.generate stores the map and its asset: ' + JSON.stringify(r.map).slice(0, 300));
  h.assert(r.mapNo.ok === false && r.mapNo.code === 'unsupported', 'an unsupported device is reported: ' + JSON.stringify(r.mapNo).slice(0, 200));
  h.assert(r.raw.ok && r.rawLayer && r.rawLayer.raw && r.rawLayer.fx.indexOf('develop.basic') >= 0, 'raw.open adds a developed layer: ' + JSON.stringify([r.raw, r.rawLayer]).slice(0, 400));
  h.assert(r.cat.ok && r.cat.formats && r.cat.presets.length >= 1, 'catalog("raw"): ' + JSON.stringify(r.cat).slice(0, 200));
  h.assert(r.settings.ok && r.notRaw.ok === false && /not a RAW/.test(r.notRaw.errors[0].message), 'raw.settings: ' + JSON.stringify([r.settings, r.notRaw.errors]).slice(0, 300));
  h.assert(r.tone.ok && typeof r.tone.results[0].values.exposure === 'number', 'raw.autoTone: ' + JSON.stringify(r.tone).slice(0, 300));
  h.assert(r.hdrBad.ok === false && /2 to 9/.test(r.hdrBad.errors[0].message), 'hdr.merge checks its files');
  h.assert(r.vars.ok && r.vals.ok, 'variables.set and values.set: ' + JSON.stringify([r.vars, r.vals]).slice(0, 300));
  /* docs/VARIABLES.md: a batch of template-field operations is named for what it does, not for the layers it touched */
  h.assert.equal(r.vars.summary, 'Define fields', 'variables.set is summarised in the person\'s words');
  h.assert.equal(r.vals.summary, 'Fill in fields', 'values.set is summarised in the person\'s words');
  h.assert(r.appearance && r.stateOk, 'state() carries appearance');
  h.assert(r.help.length === 0 && r.helpSize < 48000, 'help lists the new operations: missing ' + r.help + ', size ' + r.helpSize);
  h.assert.noErrors(page);
};

/* The command line takes the same operations (through LE.link.applyOps in a headless page) and renders the effects. */
cases['command line: fx operations are applied to the file, the render shows them, catalog fx lists and describes'] = async ({ h }) => {
  const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
  const BIN = path.join(__dirname, '..', 'tools', 'le-cli', 'bin', 'localeditor.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-cli-fx-'));
  fs.mkdirSync(path.join(dir, 'tmp'));
  const run = (args, input, binary) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [BIN].concat(args), { cwd: dir, env: Object.assign({}, process.env, { LE_BROWSER: require('playwright').chromium.executablePath(), TMPDIR: path.join(dir, 'tmp'), LE_NO_OPEN: '1' }), stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    c.stdout.on('data', (d) => out.push(d)); c.stderr.on('data', (d) => err.push(d));
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('localeditor ' + args.join(' ') + ' timed out')); }, 110000);
    c.on('close', (code) => { clearTimeout(timer); const stdout = Buffer.concat(out); let json = null; try { json = JSON.parse(stdout.toString('utf8')); } catch (e) { /* not JSON */ } resolve({ code, stdout: binary ? stdout : stdout.toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), json }); });
    c.stdin.end(input || '');
  });
  const mean = (png) => { const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })(); if (!PNG) return null; const im = PNG.sync.read(png); let sum = 0; for (let i = 0; i < im.data.length; i += 4) sum += im.data[i] + im.data[i + 1] + im.data[i + 2]; return sum / (im.data.length / 4) / 3; };
  try {
    const f = 'graded.ledesign.json';
    let r = await run(['new', f, '--size', '400x300', '--json']);
    h.assert.equal(r.code, 0, 'new: ' + r.stderr);
    r = await run(['apply', f, '-', '--json'], JSON.stringify([{ op: 'page.background', background: '#000000' }, { op: 'add', layer: { id: 'block', type: 'shape', shape: 'rectangle', fill: '#808080', x: 0, y: 0, w: 400, h: 300 } }]));
    h.assert.equal(r.code, 0, 'apply shapes: ' + r.stdout.slice(0, 300) + r.stderr);
    r = await run(['render', f, '-o', 'before.png']);
    h.assert.equal(r.code, 0, 'render: ' + r.stderr);
    r = await run(['apply', f, '-', '--json'], JSON.stringify([
      { op: 'fx.add', layer: 'block', entry: { type: 'exposure', p: { ev: 1 } } },
      { op: 'fx.add', layer: 'block', entry: { type: 'contrast', p: { amount: 10 } } },
      { op: 'fx.update', layer: 'block', id: 'contrast', p: { amount: 0 } },
      { op: 'mask.set', layer: 'block', fx: 'exposure', mask: { parts: [{ kind: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, feather: 0 }] } }
    ]));
    h.assert.equal(r.code, 0, 'apply fx: ' + r.stdout.slice(0, 600) + r.stderr);
    h.assert(r.json.written && r.json.applied === 4, 'four expert operations applied and written: ' + JSON.stringify(r.json).slice(0, 300));
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const block = doc.pages[0].layers.find((l) => l.id === 'block');
    h.assert(Array.isArray(block.fx) && block.fx.length === 2 && block.fx[0].type === 'exposure' && block.fx[0].p.ev === 1 && block.fx[0].mask && block.fx[1].p.amount === 0, 'the file carries the stack: ' + JSON.stringify(block.fx).slice(0, 400));
    r = await run(['render', f, '-o', 'after.png']);
    h.assert.equal(r.code, 0, 'render with effects: ' + r.stderr);
    const a = fs.readFileSync(path.join(dir, 'before.png')), b = fs.readFileSync(path.join(dir, 'after.png'));
    h.assert(a.length > 100 && b.length > 100 && !a.equals(b), 'the render changed');
    const ma = mean(a), mb = mean(b);
    if (ma != null) h.assert(mb > ma * 1.15, 'the render is brighter with the exposure effect: ' + ma + ' to ' + mb);
    r = await run(['apply', f, '-', '--json'], JSON.stringify([{ op: 'fx.add', layer: 'block', entry: { type: 'no-such-effect' } }]));
    h.assert(r.code === 1 && /Unknown effect type/.test(r.stdout + r.stderr), 'an unknown effect is refused: ' + (r.stdout + r.stderr).slice(0, 300));
    r = await run(['apply', f, '-', '--json'], JSON.stringify([{ op: 'fx.call', layer: 'block', name: 'creative.look', args: { id: 'faded-summer' } }]));
    h.assert(r.code === 0 && r.json.written, 'fx.call on the command line: ' + (r.stdout + r.stderr).slice(0, 400));
    h.assert(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).pages[0].layers.find((l) => l.id === 'block').fx.length > 2, 'the helper\'s entries are in the file');
    r = await run(['apply', f, '-', '--json'], JSON.stringify([{ op: 'map.generate', layer: 'block', kind: 'depth' }]));
    h.assert(r.code === 1 && /agent mode/.test(r.stdout + r.stderr), 'operations that need the open app say so: ' + (r.stdout + r.stderr).slice(0, 300));
    /* page.resize: lengths in document pixels (a blur radius, a mask blur) follow the content, as in the studio */
    const before = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).pages[0];
    r = await run(['apply', f, '-', '--json'], JSON.stringify([
      { op: 'fx.add', layer: 'block', entry: { id: 'soft', type: 'gaussian-blur', p: { radius: 6 }, mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, blur: 10 }] } } },
      { op: 'page.resize', width: before.width * 2, height: before.height * 2 }
    ]));
    h.assert(r.code === 0 && r.json.written, 'resize with effects: ' + (r.stdout + r.stderr).slice(0, 400));
    const grown = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).pages[0], soft = grown.layers.find((l) => l.id === 'block').fx.find((e) => e.id === 'soft');
    const b0 = before.layers.find((l) => l.id === 'block'), b1 = grown.layers.find((l) => l.id === 'block');
    h.assert(grown.width === before.width * 2 && Math.abs(b1.w - b0.w * 2) < 0.01, 'the page and the layer doubled');
    h.assert(soft.p.radius === 12 && soft.mask.parts[0].blur === 20 && soft.mask.parts[0].rx === 0.3, 'px parameters and mask blurs doubled, fractions stayed: ' + JSON.stringify(soft));
    r = await run(['apply', f, '-', '--json'], JSON.stringify([{ op: 'fx.update', layer: 'block', id: 'soft', p: {} }, { op: 'page.resize', width: before.width, height: before.height, scaleContent: false }]));
    h.assert(r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).pages[0].layers.find((l) => l.id === 'block').fx.find((e) => e.id === 'soft').p.radius === 12, 'without scaleContent the effect keeps its lengths');
    r = await run(['catalog', 'fx', '--json']);
    h.assert(r.code === 0 && r.json.items.length >= 20 && r.json.items.every((e) => e.id && e.summary), 'catalog fx lists the index: ' + r.stdout.slice(0, 200));
    r = await run(['catalog', 'fx', 'exposure', '--json']);
    h.assert(r.code === 0 && r.json.effect && r.json.effect.params.ev.max === 5, 'catalog fx exposure describes one effect: ' + r.stdout.slice(0, 200));
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
};

cases['helpers end to end: hdr.merge on two synthetic brackets, composite.match, relight.portrait and relight.retime through fx.call'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await photo(page);
  await page.evaluate((op) => LEAgent.apply([op]), HERO(png));
  const r = await page.evaluate(async () => {
    const one = (op) => Promise.race([LEAgent.apply([op]), new Promise((res) => setTimeout(() => res({ ok: false, timedOut: op.op + ' ' + (op.name || '') }), 60000))]);
    const out = {}, s = LEStudio.scene, types = (id) => ((s.layer(id) || {}).fx || []).map((e) => e.type);
    /* Two brackets of one scene: radiance from 0.01 (left) to 4 (right) under a checker of ±0.3 stops, exposed 4 stops apart as 8-bit pictures. */
    const W = 240, H = 160, srgb = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
    const frame = async (ev) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), id = x.createImageData(W, H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const rad = 0.01 * Math.pow(400, i / (W - 1)) * (0.8 + 0.4 * ((Math.floor(i / 12) + Math.floor(j / 12)) % 2)), k = (j * W + i) * 4, g = rad * Math.pow(2, ev);
        id.data[k] = srgb(g * 1.05); id.data[k + 1] = srgb(g); id.data[k + 2] = srgb(g * 0.9); id.data[k + 3] = 255;
      }
      x.putImageData(id, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      return LEAgent.file(new File([blob], 'bracket' + (ev < 0 ? 'm' : 'p') + Math.abs(ev) + '.png', { type: 'image/png' }));
    };
    const dark = await frame(-2), bright = await frame(2);
    out.refs = [dark, bright];
    const u0 = s._hist.undo.length;
    out.hdr = await one({ op: 'hdr.merge', files: [dark.ref || dark, bright.ref || bright], id: 'hdr', deghost: 'off', w: 480, x: 20, y: 20 });
    out.hdrUndo = s._hist.undo.length - u0;
    const L = s.layer('hdr');
    out.hdrLayer = L ? { kind: L.raw && L.raw.kind, frames: L.raw && L.raw.merge && L.raw.merge.frames, fx: types('hdr'), w: L.w, h: L.h, src: !!L.src } : null;
    if (L) {
      const c = await s.render(1), x = c.getContext('2d'), at = (fx, fy) => x.getImageData(Math.round(20 + fx * L.w), Math.round(20 + fy * L.h), 1, 1).data[1];
      /* both ends of the range hold detail: the checker is visible in the darkest and the brightest tenth (neighbouring 12-pixel cells) */
      out.hdrPx = { darkA: at(0.075, 0.5), darkB: at(0.125, 0.5), brightA: at(0.875, 0.5), brightB: at(0.925, 0.5), mid: at(0.5, 0.5) };
      out.eightBit = Object.keys(s._assets).filter((k) => k.indexOf('le-dev:') === 0).length;
      out.float = LE.fx.status().float;
    }
    /* composite.match: the hero takes on the page's colour statistics */
    out.match = await one({ op: 'fx.call', layer: 'hero', name: 'composite.match', args: { strength: 80 } });
    out.matchFx = (s.layer('hero').fx || []).filter((e) => e.type === 'match-color').map((e) => ({ strength: e.p.strength, src: e.p.srcL, dst: e.p.dstL }));
    /* relight.portrait and relight.retime: no face or depth map here, so they say so and still place the lights */
    const preset = LE.fx.relight.presets[0].id;
    out.portrait = await one({ op: 'fx.call', layer: 'hero', name: 'relight.portrait', args: { preset } });
    out.afterPortrait = types('hero');
    out.badPreset = await one({ op: 'fx.call', layer: 'hero', name: 'relight.portrait', args: { preset: 'nope' } });
    out.retime = await one({ op: 'fx.call', layer: 'hero', name: 'relight.retime', args: { when: 'golden' } });
    out.afterRetime = types('hero');
    out.badWhen = await one({ op: 'fx.call', layer: 'hero', name: 'relight.retime', args: { when: 'teatime' } });
    out.afterBad = types('hero').length;
    const c2 = await s.render(0.5);
    out.rendered = c2.width > 0;
    out.problems = LE.fx.problems(s.toJSON()).length;
    return out;
  });
  h.assert(r.hdr.ok && r.hdrUndo === 1, 'hdr.merge adds the merged layer in one undo step: ' + JSON.stringify(r.hdr).slice(0, 400));
  h.assert(r.hdrLayer && r.hdrLayer.kind === 'hdr' && r.hdrLayer.frames === 2 && r.hdrLayer.w === 480 && r.hdrLayer.src, 'an HDR layer from two frames, placed as asked: ' + JSON.stringify(r.hdrLayer));
  h.assert(r.hdrLayer.fx.indexOf('develop.tonemap') >= 0 && r.hdrLayer.fx.indexOf('develop.basic') >= 0, 'it opens with tone mapping and develop: ' + r.hdrLayer.fx);
  h.assert(Math.abs(r.hdrPx.darkA - r.hdrPx.darkB) >= 3 && Math.abs(r.hdrPx.brightA - r.hdrPx.brightB) >= 3, 'detail at both ends of the range (the checker shows): ' + JSON.stringify(r.hdrPx));
  h.assert(r.hdrPx.darkA < r.hdrPx.mid && r.hdrPx.mid < r.hdrPx.brightB && r.hdrPx.brightB < 255, 'tones stay in order and unclipped: ' + JSON.stringify(r.hdrPx));
  if (r.float) h.assert.equal(r.eightBit, 0, 'the layer is drawn from its float source (no 8-bit stand-in)');
  h.assert(r.match.ok && r.matchFx.length === 1 && r.matchFx[0].strength === 80 && r.matchFx[0].src !== r.matchFx[0].dst, 'composite.match adds one measured match-color entry: ' + JSON.stringify([r.match, r.matchFx]).slice(0, 400));
  h.assert(r.portrait.ok && r.afterPortrait.indexOf('relight') >= 0, 'relight.portrait places lights: ' + JSON.stringify(r.portrait).slice(0, 300) + ' ' + r.afterPortrait);
  h.assert(/No face map/.test(r.portrait.results[0].message || '') && /depth map/.test(r.portrait.results[0].message || ''), 'and says in words that the face and depth maps are missing: ' + JSON.stringify(r.portrait.results[0]).slice(0, 500));
  h.assert(r.badPreset.ok === false && /preset/i.test(r.badPreset.errors[0].message), 'an unknown preset is refused in words: ' + JSON.stringify(r.badPreset.errors));
  h.assert(r.retime.ok && ['white-balance', 'exposure', 'saturation'].every((t) => r.afterRetime.indexOf(t) >= 0) && r.afterRetime.length > r.afterPortrait.length, 'relight.retime adds its grade and light: ' + r.afterRetime);
  h.assert(r.badWhen.ok === false && /golden/.test(r.badWhen.errors[0].message) && r.afterBad === r.afterRetime.length, 'an unknown time of day is refused and changes nothing: ' + JSON.stringify(r.badWhen.errors));
  h.assert(r.rendered && r.problems === 0, 'the page still renders and the registry has no complaints (' + r.problems + ')');
  h.assert.noErrors(page);
};

module.exports = cases;
