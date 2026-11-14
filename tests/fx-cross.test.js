'use strict';
/* Cross-pack Expert tests: the effect packs (basic, develop, grade, creative, composite, retouch, relight) were each tested alone;
   these cases combine them. Stacks, one document with every effect, adjustment layers with masks over a cut-out, recipes over the
   person's own effects, the agent path, Simple and Expert mode, and the limits. Small images, deterministic, software GL. */
const fx = require('./lib/fx');

const cases = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* An entry at its documented example, with parameters nudged on top. */
const EX = (id, p) => ({ ex: id, p });
/* Five realistic stacks, three to five packs each. `swap` is a pair of positions that do not commute. */
const STACKS = {
  portrait: { card: [192, 144], swap: [1, 2], fx: [EX('frequency-separation'), EX('hsl'), EX('film-grain'), EX('rim-light')] },
  product: { card: [192, 144], alpha: true, swap: [0, 1], fx: [EX('contact-shadow'), EX('floor-reflection', { distance: 40 }), EX('tone-curve'), EX('smart-sharpen')] },
  landscape: { card: [192, 144], swap: [0, 2], fx: [EX('dehaze'), EX('tone-curve'), EX('vignette'), EX('hsl')] },
  film: { card: [192, 144], swap: [2, 3], fx: [EX('develop.basic'), EX('lift-gamma-gain'), EX('halation'), EX('film-grain'), EX('fade')] },
  night: { card: [192, 144], swap: [0, 3], fx: [EX('dodge-burn'), EX('cdl'), EX('light-leak'), EX('bloom'), EX('vignette')] }
};

/* The registry, in a page. Builds entries from the examples (with ids), in the page. */
async function fxPage(browser, base) {
  const pg = await fx.page(browser, base);
  await pg.evaluate(() => {
    window.xT = {
      entry: (spec, i) => { const d = window.LE.fx.defs().find((x) => x.id === spec.ex); if (!d) throw new Error('no effect ' + spec.ex); const e = JSON.parse(JSON.stringify(d.agent.example)); e.id = 'x' + i; if (spec.p) e.p = Object.assign({}, e.p, spec.p); return e; },
      src: (o) => window.fxT.card(o.card[0], o.card[1], !!o.alpha),
      sig: (c) => { const d = window.fxT.pixels(c).data; let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619); return h >>> 0; }
    };
  });
  return pg;
}

/* One render of a stack: { png, w, h }. */
async function stackShot(pg, o, entries, extra) {
  const url = await pg.evaluate(([o, entries, extra]) => {
    const T = window.xT, FX = window.LE.fx, src = T.src(o), fxs = entries.map((e, i) => e.type ? e : T.entry(e, i));
    return window.fxT.png(FX.apply(src, Object.assign({ fx: fxs }, extra || {})));
  }, [o, entries, extra || {}]);
  
  return Buffer.from(url.split(',')[1], 'base64');
}

cases['stacks: five realistic stacks across packs render clean; preview equals the tiled export; order matters; no entries gives the original back'] = async ({ browser, base, h }) => {
  const pg = await fxPage(browser, base);
  for (const name of Object.keys(STACKS)) {
    const S = STACKS[name];
    const whole = await stackShot(pg, S, S.fx);
    const tiled = await stackShot(pg, S, S.fx, { tile: 96 });
    const prev = await stackShot(pg, S, S.fx, { preview: true });
    await fx.same(pg, whole, tiled, name + ': whole against 96 px tiles', { max: 3, over: 0.005 });
    await fx.same(pg, whole, prev, name + ': preview against export', { max: 3, over: 0.005 });
    /* the stack changes the picture */
    const none = await stackShot(pg, S, []);
    const dNone = await fx.diff(pg, whole, none, 3);
    h.assert(dNone.sizeMismatch || dNone.over > 0.01, name + ': the stack is visible: ' + JSON.stringify(dNone));
    /* order matters */
    const sw = S.fx.slice(); const [a, b] = S.swap; const t = sw[a]; sw[a] = sw[b]; sw[b] = t;
    const swapped = await stackShot(pg, S, sw);
    const dSw = await fx.diff(pg, whole, swapped, 2);
    h.assert(dSw.sizeMismatch || dSw.over > 0.001, name + ': swapping entries ' + a + ' and ' + b + ' changes pixels: ' + JSON.stringify(dSw));
    /* removing all entries: the original pixels exactly; switched-off entries too */
    const orig = await pg.evaluate((S) => window.fxT.png(window.xT.src(S)), S);
    await fx.same(pg, Buffer.from(orig.split(',')[1], 'base64'), none, name + ': no entries is the original', { max: 0, over: 0 });
  }
  const off2 = await pg.evaluate((S) => {
    const e = S.fx.map((s, i) => Object.assign(window.xT.entry(s, i), { on: false }));
    return window.fxT.png(window.LE.fx.apply(window.xT.src(S), { fx: e }));
  }, STACKS.film);
  const orig2 = await pg.evaluate((S) => window.fxT.png(window.xT.src(S)), STACKS.film);
  await fx.same(pg, Buffer.from(orig2.split(',')[1], 'base64'), Buffer.from(off2.split(',')[1], 'base64'), 'every entry switched off is the original', { max: 0, over: 0 });
  h.assert.noErrors(pg);
};

async function studio(h, browser, base) {
  const pg = await h.studioWithSample(browser, base, 'desktop');
  await pg.evaluate(() => window.LE.fxBoot.load());
  await fx.attach(pg);
  return pg;
}
const canon = `(function c(v) { if (Array.isArray(v)) return '[' + v.map(c).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + c(v[k])).join(',') + '}'; return JSON.stringify(v); })`;

cases['every effect in one document: all entries survive save, .leproject and the open format with identical parameters; no warnings; ids unique'] = async ({ browser, base, h }) => {
  const pg = await studio(h, browser, base);
  const r = await pg.evaluate(async (canonSrc) => {
    const canon = (0, eval)(canonSrc), LE = window.LE, FX = LE.fx, c = window.LEStudio, s = c.scene, out = {};
    const defs = FX.defs();
    const layers = defs.map((d, i) => { const e = JSON.parse(JSON.stringify(d.agent.example)); e.id = 'e' + i; return { id: 'l' + i, type: 'shape', shape: 'rect', x: (i % 12) * 60, y: Math.floor(i / 12) * 60, w: 50, h: 50, fill: { type: 'solid', color: '#c08060' }, fx: [e] }; });
    s.load({ v: 1, width: 800, height: 700, background: { type: 'color', color: '#ffffff' }, layers });
    const doc = s.toJSON();
    out.count = defs.length;
    out.have = doc.layers.filter((l) => l.fx && l.fx.length === 1).length;
    out.lost = doc.layers.map((l, i) => (l.fx && l.fx[0] && l.fx[0].type === defs[i].id) ? null : defs[i].id).filter(Boolean);
    out.problems = FX.problems(doc);
    const want = doc.layers.map((l) => canon(l.fx));
    const ids = [].concat.apply([], doc.layers.map((l) => [l.id].concat((l.fx || []).map((e) => e.id))));
    out.uniq = new Set(ids).size === ids.length;
    c.syncProject();
    const project = c.S.project;
    const file = await LE.project.exportFile(project, {});
    const back = await LE.project.readFile(new File([file.blob || file], 'x.leproject'));
    out.projectBad = back.project.pages[0].layers.map((l, i) => canon(l.fx) === want[i] ? null : defs[i].id).filter(Boolean);
    const text = await LE.design.exportText(project, {});
    const parsed = await LE.design.parse(text.text, {});
    out.parseErrors = parsed && parsed.errors ? parsed.errors.slice(0, 3) : null;
    out.warnings = parsed && parsed.warnings ? parsed.warnings.slice(0, 5) : null;
    const sub = (a, b) => a === null || typeof a !== 'object' ? a === b : (b && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && Object.keys(a).every((k) => sub(a[k], b[k])));
    const layersOf = (r) => r && r.project ? r.project.pages[0].layers : null;
    out.designBad = layersOf(parsed) ? layersOf(parsed).map((l, i) => sub(doc.layers[i].fx, l.fx) ? null : defs[i].id).filter(Boolean) : 'no project';
    out.defaultsFilled = layersOf(parsed) && layersOf(parsed).some((l, i) => canon(l.fx) !== want[i]);
    const st = LE.design.stringify(parsed.project), again = await LE.design.parse(st.text || st, {});
    out.stringifyBad = layersOf(again) ? layersOf(again).map((l, i) => canon(l.fx) === canon(layersOf(parsed)[i].fx) ? null : defs[i].id).filter(Boolean) : 'no project';
    return out;
  }, canon);
  h.assert(r.count >= 110, 'the registry holds every pack: ' + r.count);
  h.assert.equal(r.have, r.count, 'one layer per effect, each with its entry');
  h.assert.equal(JSON.stringify(r.lost), '[]', 'no entry lost or retyped when the scene took it');
  h.assert.equal(JSON.stringify(r.problems), '[]', 'no validation warnings at the documented examples: ' + JSON.stringify(r.problems).slice(0, 600));
  h.assert(r.uniq, 'layer and entry ids are unique');
  h.assert.equal(JSON.stringify(r.projectBad), '[]', '.leproject round trip keeps every entry identical');
  h.assert(!r.parseErrors || !r.parseErrors.length, 'the open format reads it: ' + JSON.stringify(r.parseErrors));
  h.assert(!r.warnings || !r.warnings.length, 'no warnings from the open-format reader: ' + JSON.stringify(r.warnings));
  h.assert.equal(JSON.stringify(r.designBad), '[]', 'the open format keeps every entry value (it may add defaults)');
  h.assert.equal(JSON.stringify(r.stringifyBad), '[]', 'LE.design.stringify then parse again is stable');
  h.assert.noErrors(pg);
};

cases['adjustment layer with a radial mask over a cut-out photo with silhouette effects: the grade stays in its mask, the shadow stays outside the subject'] = async ({ browser, base, h }) => {
  const pg = await studio(h, browser, base);
  const r = await pg.evaluate(async () => {
    const FX = window.LE.fx, s = window.LEStudio.scene, out = {};
    const mk = (w, hh, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; draw(c.getContext('2d')); return c; };
    const photo = mk(200, 200, (x) => { x.fillStyle = '#c08060'; x.fillRect(0, 0, 200, 200); });
    const mask = mk(200, 200, (x) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(100, 100, 50, 0, 7); x.fill(); });
    s.addAsset('xc-photo', photo); s.addAsset('xc-mask', mask);
    const base = { v: 1, width: 600, height: 300, background: { type: 'color', color: '#e8e8e8' } };
    const subject = (fxs) => ({ id: 'subject', type: 'image', src: 'xc-photo', x: 50, y: 50, w: 200, h: 200, cutout: { asset: 'xc-mask' }, fx: fxs });
    const SH = [{ id: 'sh', type: 'drop-shadow', p: { color: '#000000', opacity: 1, x: 30, y: 0, blur: 2 } }];
    const adj = { id: 'adj', type: 'adjust', x: 0, y: 0, w: 600, h: 300, fx: [{ id: 'g1', type: 'hsl', p: { mixer: [{ h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }, { h: 0, s: -100, l: 0 }] } }, { id: 'g2', type: 'temperature', p: { temp: 3200 } }],
      layerMask: { on: true, invert: false, parts: [{ kind: 'radial', cx: 0.25, cy: 0.5, rx: 0.1, ry: 0.2, feather: 0.1 }] } };
    const px = async (x, y) => { const c = await s.render(1); return Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3); };
    const load = (layers) => s.load(Object.assign({ layers }, base));
    out.drawDrop = FX.get('drop-shadow') ? Object.keys(FX.get('drop-shadow').params) : null;
    load([subject([])]);
    out.plain = { inside: await px(150, 150), shadow: await px(215, 150), bg: await px(450, 150), corner: await px(70, 70) };
    load([subject(SH)]);
    out.shadowed = { inside: await px(150, 150), shadow: await px(215, 150), bg: await px(450, 150), corner: await px(70, 70), behind: await px(120, 150) };
    load([subject(SH), adj]);
    out.adjusted = { inside: await px(150, 150), shadow: await px(215, 150), bg: await px(450, 150), outsideMask: await px(300, 150), edge: await px(255, 280) };
    load([subject([]), Object.assign({}, adj, { visible: false })]);
    out.hidden = { inside: await px(150, 150) };
    out.problems = FX.problems(s.toJSON());
    return out;
  });
  const d = (a, b) => Math.max.apply(null, a.map((v, i) => Math.abs(v - b[i])));
  h.assert(d(r.plain.inside, r.shadowed.inside) <= 2, 'the shadow does not cover the subject: ' + r.plain.inside + ' vs ' + r.shadowed.inside);
  h.assert(d(r.plain.corner, r.shadowed.corner) <= 2, 'and does not touch the transparent cut-out corner of the layer: ' + r.shadowed.corner);
  h.assert(r.shadowed.shadow[0] < r.plain.shadow[0] - 40, 'the shadow falls beside the subject: ' + r.plain.shadow + ' to ' + r.shadowed.shadow);
  h.assert(d(r.plain.bg, r.shadowed.bg) <= 2, 'far from the subject nothing changes: ' + r.shadowed.bg);
  /* the adjustment layer: inside its mask (centre 150,150 is inside: cx .25 of 600) the subject is greyed and warmed */
  h.assert(d(r.adjusted.inside, r.shadowed.inside) > 25, 'the grade acts inside the mask: ' + r.shadowed.inside + ' to ' + r.adjusted.inside);
  h.assert(d(r.adjusted.outsideMask, [232, 232, 232]) <= 2 && d(r.adjusted.bg, r.shadowed.bg) <= 2, 'and does not act outside it: ' + r.adjusted.outsideMask + ' ' + r.adjusted.bg);
  h.assert(d(r.adjusted.edge, [232, 232, 232]) <= 2, 'the page far below the mask is untouched: ' + r.adjusted.edge);
  h.assert(r.problems.length === 0, 'no warnings: ' + JSON.stringify(r.problems));
  h.assert.noErrors(pg);
};

cases['Expert looks over a layer that already has the person\'s effects: every built-in look adds after them, and removing it leaves them exactly as they were'] = async ({ browser, base, h }) => {
  const pg = await h.studioWithSample(browser, base, 'desktop');
  await h.need(pg, ['recipes']);
  const r = await pg.evaluate(async () => {
    const S = window.LEStudio, FX = await window.LE.fxBoot.load(), out = { looks: [], bad: [] };
    const img = S.targetImage() || S.scene.toJSON().layers.filter((l) => l.type === 'image')[0];
    S.scene.select([img.id]);
    const mine = ['exposure', 'vignette', 'film-grain'].map((t, i) => { const e = FX.validate(JSON.parse(JSON.stringify(FX.defs().find((d) => d.id === t).agent.example))).entry; e.id = 'mine' + i; return e; });
    mine[1].mask = { on: true, invert: false, parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, feather: 0.3 }] };
    S.patch(img.id, { fx: mine });
    if (!S.L(img.id).fx) throw new Error('no fx after patch: ' + JSON.stringify(Object.keys(S.L(img.id))) + ' ' + typeof S.patch + ' ' + typeof mine[0]);
    const own = () => JSON.stringify(S.L(img.id).fx.filter((e) => !/^rcp\./.test(e.id)));
    const before = own(), depth = () => S.scene._hist.undo.length;
    for (const b of window.LE.recipes2.builtins) {
      const wf = b, id = wf.metadata.id, d0 = depth();
      await window.LEStudioRecipes.apply(S, img.id, wf, 100, { maps: false });
      const fxs = S.L(img.id).fx; if (!fxs) throw new Error('fx gone after apply of ' + id + ' ' + JSON.stringify(Object.keys(S.L(img.id))));
      const ids = fxs.map((e) => e.id);
      const row = { id, n: fxs.length, d: depth() - d0, firstThree: JSON.stringify(fxs.slice(0, 3).map((e) => e.id)), mineSame: own() === before, tail: ids.slice(3).every((x) => /^rcp\.\d+$/.test(x)) };
      await window.LEStudioRecipes.apply(S, img.id, wf, 40, { maps: false });
      row.restrength = own() === before && S.L(img.id).fx.length === fxs.length;
      await window.LEStudioRecipes.remove(S, img.id);
      row.removed = own() === before && S.L(img.id).fx.length === 3;
      row.marker = !!(S.L(img.id).adjust && S.L(img.id).adjust.recipe);
      out.looks.push(row);
    }
    /* a layer already at the 32-entry limit: the look adds nothing, never overwrites, and removing it does not eat the person's entries */
    const full = []; for (let i = 0; i < 32; i++) { const e = FX.validate({ type: 'contrast', p: { amount: i + 1 } }).entry; e.id = 'u' + i; full.push(e); }
    S.patch(img.id, { fx: full });
    const f0 = JSON.stringify(S.L(img.id).fx), wf0 = window.LE.recipes2.builtins[0];
    await window.LEStudioRecipes.apply(S, img.id, wf0, 100, { maps: false });
    out.fullAfterApply = JSON.stringify(S.L(img.id).fx) === f0 ? 'same' : S.L(img.id).fx.length + ' entries';
    await window.LEStudioRecipes.remove(S, img.id);
    out.fullAfterRemove = JSON.stringify(S.L(img.id).fx) === f0 ? 'same' : S.L(img.id).fx.length + ' entries';
    return out;
  });
  h.assert(r.looks.length === 8, 'eight built-in looks were tried: ' + r.looks.length);
  r.looks.forEach((l) => {
    h.assert(l.mineSame && l.firstThree === '["mine0","mine1","mine2"]', l.id + ': the person\'s entries stay first and unchanged: ' + JSON.stringify(l));
    h.assert(l.n > 3 && l.tail && l.d === 1, l.id + ': the look adds its entries as rcp.N in one undo step: ' + JSON.stringify(l));
    h.assert(l.restrength && l.removed && !l.marker, l.id + ': changing strength and removing leave the person\'s effects exactly as they were: ' + JSON.stringify(l));
  });
  h.assert.equal(r.fullAfterApply, 'same', 'a layer at 32 entries takes no look entries');
  h.assert.equal(r.fullAfterRemove, 'same', 'and removing the look does not touch them');
  h.assert.noErrors(pg);
};

cases['removing an Expert look keeps the person\'s own entry even when its id reads rcp.N'] = async ({ browser, base, h }) => {
  const pg = await h.studioWithSample(browser, base, 'desktop');
  await h.need(pg, ['recipes']);
  const r = await pg.evaluate(async () => {
    const S = window.LEStudio, FX = await window.LE.fxBoot.load();
    const img = S.targetImage() || S.scene.toJSON().layers.filter((l) => l.type === 'image')[0];
    S.scene.select([img.id]);
    const odd = FX.validate({ type: 'contrast', p: { amount: 33 } }).entry; odd.id = 'rcp.0';   /* an agent or a pasted layer may carry any id */
    S.patch(img.id, { fx: [odd] });
    const wf = window.LE.recipes2.builtins[0];
    await window.LEStudioRecipes.apply(S, img.id, wf, 100, { maps: false });
    await window.LEStudioRecipes.remove(S, img.id);
    return (S.L(img.id).fx || []).map((e) => e.type + ':' + (e.p && e.p.amount)).join();
  });
  h.assert.equal(r, 'contrast:33', 'the person\'s own entry survives apply and remove (it is given another id)');
};

/* ---- the agent ---- */
async function agentReady(h, browser, base) {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['agentui']);
  await page.waitForFunction(() => window.LEAgent && window.LEStudio && LEAgent._internal.A.ready);
  const p = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'Cross-pack look' }));
  await page.click('.sxa-ask [data-yes]');
  const res = await p;
  h.assert(res.ok, 'begin failed: ' + JSON.stringify(res));
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  return page;
}

cases['agent: one batch adds effects from four packs, a helper call and a mask; one undo restores the document exactly'] = async ({ browser, base, h }) => {
  const page = await agentReady(h, browser, base);
  const png = await page.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 96; cv.height = 64; const x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 96, 64); g.addColorStop(0, '#27405e'); g.addColorStop(1, '#b98d5a'); x.fillStyle = g; x.fillRect(0, 0, 96, 64); return cv.toDataURL('image/png'); });
  const preset = await page.evaluate(async () => { const FX = await LE.fxBoot.load(); return FX.grade.presets[0].id; });
  let r = await page.evaluate((src) => LEAgent.apply([{ op: 'add', layer: { id: 'hero', name: 'Hero', type: 'image', src, x: 90, y: 90, w: 900, h: 600 } }]), png);
  h.assert(r.ok, 'photo added: ' + JSON.stringify(r).slice(0, 300));
  const snap = () => page.evaluate(() => JSON.stringify(LEStudio.scene.toJSON()));
  const before = await snap(), d0 = await page.evaluate(() => LEStudio.scene._hist.undo.length);
  r = await page.evaluate((id) => LEAgent.apply([
    { op: 'fx.add', layer: 'Hero', entry: { type: 'develop.basic', p: { exposure: 0.3 } } },
    { op: 'fx.add', layer: 'Hero', entry: { type: 'hsl', p: { mixer: [{ h: 10, s: 20, l: 0 }] } } },
    { op: 'fx.add', layer: 'Hero', entry: { type: 'film-grain', p: { amount: 30 } } },
    { op: 'fx.add', layer: 'Hero', entry: { type: 'frequency-separation', p: {} } },
    { op: 'fx.call', layer: 'Hero', name: 'grade.preset', args: { id } },
    { op: 'mask.set', layer: 'Hero', fx: 'film-grain', mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, feather: 0.4 }] } }
  ], { label: 'Cross-pack look' }), preset);
  h.assert(r.ok, 'the batch applied: ' + JSON.stringify(r).slice(0, 600));
  const after = await page.evaluate(() => LEStudio.scene.toJSON().layers.find((l) => l.id === 'hero').fx.map((e) => e.type + (e.mask ? '+mask' : '')));
  h.assert(after.length >= 5 && after.indexOf('film-grain+mask') >= 0, 'four packs plus the helper arrived with the mask: ' + after.join());
  h.assert.equal(await page.evaluate(() => LEStudio.scene._hist.undo.length) - d0, 1, 'the batch is one undo step');
  await page.evaluate(() => LEStudio.scene.undo());
  h.assert.equal(await snap(), before, 'undo restores the document exactly');
  await page.evaluate(() => LEStudio.scene.redo());
  const again = await page.evaluate(() => LEStudio.scene.toJSON().layers.find((l) => l.id === 'hero').fx.map((e) => e.type + (e.mask ? '+mask' : '')));
  h.assert.equal(again.join(), after.join(), 'redo brings the whole batch back');
  h.assert.noErrors(page);
};

cases['Simple and Expert: an Expert design opens in Simple with the same pixels, Simple edits keep the expert data, and Expert shows the stack intact'] = async ({ browser, base, h }) => {
  const pg = await studio(h, browser, base);
  const set = await pg.evaluate(async (canonSrc) => {
    const FX = window.LE.fx, S = window.LEStudio, s = S.scene, canon = (0, eval)(canonSrc);
    const first = s.layers()[0];
    const ex = (t, p) => FX.validate({ type: t, p: p || {} }).entry;
    const mine = [ex('exposure', { ev: 0.4 }), ex('hsl', { mixer: [{ h: 20, s: -30, l: 0 }] }), ex('film-grain', { amount: 25 }), ex('vignette', { amount: -40 })].map((e, i) => Object.assign(e, { id: 'm' + i }));
    s.update(first.id, { fx: mine });
    s.add({ id: 'adj', type: 'adjust', x: 0, y: 0, w: first.w, h: first.h, fx: [Object.assign(ex('temperature', { temp: 3800 }), { id: 'a0' })], layerMask: { on: true, invert: false, parts: [{ kind: 'linear', x0: 0, y0: 0, x1: 1, y1: 0, feather: 0.5 }] } });
    s.add({ id: 'clipped', type: 'shape', shape: 'ellipse', x: first.x + 40, y: first.y + 40, w: 300, h: 200, fill: { type: 'solid', color: '#3050c0' }, clip: true, opacity: 0.6, blend: 'multiply' });
    s.select([]);
    window.__first = first.id;
    return { id: first.id, canon: canon(s.toJSON().layers.map((l) => ({ id: l.id, fx: l.fx || null, clip: l.clip || null, mask: l.layerMask || null, type: l.type }))) };
  }, canon);
  const shot = (k) => fx.shot(pg, k);
  await pg.evaluate(() => window.LEStudio.mode('expert'));
  const expertPx = await shot(0.25);
  await pg.evaluate(() => window.LEStudio.mode('simple'));
  const simplePx = await shot(0.25);
  await fx.same(pg, expertPx, simplePx, 'Expert and Simple draw the same design', { max: 2, over: 0 });
  const state = (canonSrc) => pg.evaluate((src) => { const canon = (0, eval)(src); return canon(window.LEStudio.scene.toJSON().layers.map((l) => ({ id: l.id, fx: l.fx || null, clip: l.clip || null, mask: l.layerMask || null, type: l.type }))); }, canonSrc);
  h.assert.equal(await state(canon), set.canon, 'opening in Simple changes no expert data');
  /* legacy edits made in Simple */
  await pg.evaluate(() => { const S = window.LEStudio, filters = Object.keys((window.LE.presets && window.LE.presets.filters) || {}); S.patch(window.__first, { adjust: { brightness: 25, contrast: 15 }, filter: filters.length ? { name: filters[0], intensity: 70 } : null }); });
  const edited = await shot(0.25);
  const dEdit = await fx.diff(pg, simplePx, edited, 3);
  h.assert(dEdit.sizeMismatch || dEdit.over > 0.01, 'the Simple edits are visible: ' + JSON.stringify(dEdit));
  h.assert.equal(await state(canon), set.canon, 'a brightness slider and a filter in Simple drop no effect, adjustment layer, mask or clip');
  const legacy = await pg.evaluate(() => { const l = window.LEStudio.scene.layer(window.__first); return [l.adjust && l.adjust.brightness, l.filter && l.filter.name || null]; });
  h.assert.equal(legacy[0], 25, 'the slider value is kept');
  await pg.evaluate(() => window.LEStudio.mode('expert'));
  h.assert.equal(await state(canon), set.canon, 'switching back to Expert shows the stack intact');
  const expertAfter = await shot(0.25);
  await fx.same(pg, edited, expertAfter, 'Expert draws what Simple drew after the edits', { max: 2, over: 0 });
  h.assert.noErrors(pg);
};

cases['limits: 32 entries on a layer, a 48-parameter effect at its extremes and the document caps answer with a validation result, never a crash or a hang'] = async ({ browser, base, h }) => {
  const pg = await studio(h, browser, base);
  const r = await pg.evaluate(async () => {
    const FX = window.LE.fx, LE = window.LE, S = window.LEStudio, s = S.scene, out = { time: {} };
    const t = (k, f) => { const t0 = performance.now(); try { return f(); } finally { out.time[k] = Math.round(performance.now() - t0); } };
    const ent = (type, p) => ({ type, p: p || {} });
    /* 1. 32 entries */
    const id = s.layers()[0].id;
    const ents = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(Object.assign(FX.validate(ent('contrast', { amount: i % 50 })).entry, { id: 'c' + i })); return a; };
    s.update(id, { fx: ents(32) });
    out.kept32 = (s.layer(id).fx || []).length;
    s.update(id, { fx: ents(40) });
    out.kept40 = (s.layer(id).fx || []).length;
    const doc32 = { v: 1, width: 400, height: 300, layers: [{ id: 'a', type: 'image', x: 0, y: 0, w: 400, h: 300, fx: ents(32) }] };
    out.add33 = t('add33', () => { const r = FX.ops.apply(doc32, { op: 'fx.add', layer: 'a', entry: ent('exposure', { ev: 1 }) }); return { ok: r.ok, error: r.errors && r.errors.length ? JSON.stringify(r.errors[0]) : null, len: r.doc && r.doc.layers[0].fx.length }; });
    out.render32 = t('render32', () => { const c = document.createElement('canvas'); c.width = c.height = 48; c.getContext('2d').fillRect(0, 0, 48, 48); return FX.apply(c, { fx: ents(32) }).width; });
    /* 2. the widest effect, every number at its minimum and then its maximum */
    const defs = FX.defs().slice().sort((a, b) => Object.keys(b.params).length - Object.keys(a.params).length);
    const wide = defs[0]; out.wide = [wide.id, Object.keys(wide.params).length];
    const extreme = (which) => { const p = {}; Object.keys(wide.params).forEach((k) => { const d = wide.params[k]; if (d.type === 'number') p[k] = which === 'min' ? d.min : d.max; }); return p; };
    out.extremes = ['min', 'max'].map((w) => t('ext-' + w, () => { const v = FX.validate({ type: wide.id, p: extreme(w) }); const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#a06040'; x.fillRect(0, 0, 48, 48); x.fillStyle = '#fff'; x.fillRect(10, 10, 20, 20); const o = FX.apply(c, { fx: [v.entry] }); return { ok: !!o && o.width > 0, warnings: (v.warnings || []).length }; }));
    /* more than 48 parameters on one entry, hostile keys, long strings */
    const many = {}; for (let i = 0; i < 80; i++) many['k' + i] = i;
    const rs = s.add({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 50, h: 50, fx: [{ id: 'many', type: 'contrast', p: Object.assign({ amount: 10 }, many) }, { id: 'long', type: 'contrast', p: { amount: 5, note: 'x'.repeat(500) } }] });
    out.manyKeys = Object.keys((s.layer(rs.id || rs).fx[0] || {}).p || {}).length;
    /* 3. list and document caps */
    const dataParam = FX.defs().map((d) => [d.id, Object.keys(d.params).filter((k) => d.params[k].type === 'data')]).filter((x) => x[1].length)[0];
    out.dataParam = dataParam || null;
    if (dataParam) {
      const big = { id: 'big', type: dataParam[0], p: {} }; big.p[dataParam[1][0]] = new Array(5000).fill(0.5);
      const l = s.add({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 50, h: 50, fx: [big] });
      const got = s.layer(l.id || l).fx; out.bigList = got && got[0] && got[0].p ? (Array.isArray(got[0].p[dataParam[1][0]]) ? got[0].p[dataParam[1][0]].length : typeof got[0].p[dataParam[1][0]]) : 'entry gone';
    }
    const parts = []; for (let i = 0; i < 12; i++) parts.push({ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.1 + i / 100, ry: 0.1 });
    const lm = s.add({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 50, h: 50, layerMask: { on: true, parts } });
    out.maskParts = (s.layer(lm.id || lm).layerMask || { parts: [] }).parts.length;
    /* a design too large for its cap is refused by the reader with a message */
    const huge = JSON.stringify({ format: 'localeditor-design', version: '1.0', pad: 'x'.repeat(13 * 1024 * 1024) });
    out.huge = await (async () => { const t0 = performance.now(); try { const p = await LE.design.parse(huge, {}); return { ok: !!(p && p.project), errors: (p && p.errors || []).map(String).slice(0, 1), ms: Math.round(performance.now() - t0) }; } catch (e) { return { threw: String(e && e.message || e), ms: Math.round(performance.now() - t0) }; } })();
    const proto = '{"format":"localeditor-design","version":"1.0","__proto__":{"x":1},"pages":[]}';
    out.proto = await (async () => { try { const p = await LE.design.parse(proto, {}); return { ok: !!(p && p.project), errors: (p && p.errors || []).length }; } catch (e) { return { threw: String(e && e.message || e) }; } })();
    return out;
  });
  h.assert(r.kept32 === 32, '32 entries are allowed: ' + r.kept32);
  h.assert(r.kept40 <= 32, 'more than 32 are not kept: ' + r.kept40);
  h.assert(r.add33.ok === false && r.add33.error, 'adding a 33rd entry answers with a reason: ' + JSON.stringify(r.add33));
  h.assert(r.time.render32 < 15000, '32 entries render in ' + r.time.render32 + ' ms');
  r.extremes.forEach((e, i) => h.assert(e.ok, 'the widest effect (' + r.wide + ') draws at its ' + ['minimum', 'maximum'][i]));
  h.assert(r.time['ext-min'] < 15000 && r.time['ext-max'] < 15000, 'and does not hang: ' + JSON.stringify(r.time));
  h.assert(r.manyKeys <= 48, 'an entry with 80 keys is cut to the 48-key limit: ' + r.manyKeys);
  h.assert(r.bigList === 'entry gone' || r.bigList === 'undefined' || r.bigList <= 4096, 'a list over 4,096 numbers is left out: ' + r.bigList);
  h.assert(r.maskParts <= 8, 'a mask keeps at most 8 parts: ' + r.maskParts);
  h.assert(!r.huge.threw && !r.huge.ok && r.huge.errors.length, 'a design over 12 MB is refused with a message: ' + JSON.stringify(r.huge));
  h.assert(!r.proto.threw && !r.proto.ok, 'a file with __proto__ is refused as a whole: ' + JSON.stringify(r.proto));
  h.assert.noErrors(pg);
};

module.exports = cases;
