'use strict';
/* Recipes 2.0: Expert looks as shareable recipes (docs/FORMAT-WORKFLOW.md, "Version 2.0").
   assets/js/le-recipes-v2.js (the reader), assets/js/le-studio-recipes.js (apply, remove, save, batch), the recipes page. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LOOK = {
  format: 'localeditor-workflow', version: '2.0',
  metadata: { id: 'test-look', name: 'Test look', description: 'A warm fade.', author: 'Tests', category: 'film', tags: ['warm'] },
  parameters: [{ id: 'intensity', default: 80 }],
  fx: [
    { type: 'vibrance', amount: 0.5, p: { amount: 40 } },
    { type: 'tone-curve', p: { lights: 20, darks: -20 }, mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4 }] } }
  ]
};
async function studio(browser, base, h) {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, ['recipes']);
  await page.evaluate(() => { const S = window.LEStudio; const img = S.targetImage() || S.scene.toJSON().layers.filter((l) => l.type === 'image')[0]; S.scene.select([img.id]); window.__img = img.id; });
  return page;
}
const layer = (page) => page.evaluate(() => { const l = window.LEStudio.L(window.__img); return { fx: (l.fx || []).map((e) => ({ id: e.id, type: e.type, amount: e.amount })), marker: l.adjust && l.adjust.recipe ? { id: l.adjust.recipe.id, strength: l.adjust.recipe.strength } : null }; });
const undoDepth = (page) => page.evaluate(() => window.LEStudio.scene._hist.undo.length);

const cases = {};

cases['2.0 round trip: the reader normalises a look, writes it back the same, and 1.1 recipes are untouched'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/recipes/', 'desktop');
  const r = await page.evaluate((look) => {
    const R = window.LE.recipes, v = R.validate(JSON.stringify(look)), again = R.validate(R.stringify(v.workflow));
    const old = R.builtins[0], v1 = R.validate(JSON.parse(JSON.stringify(old)));
    const future = R.validate(Object.assign({}, look, { version: '3.0' }));
    return {
      ok: v.ok, errors: v.errors, version: v.workflow && v.workflow.version, min: v.workflow && v.workflow.compatibility.minimumEditorVersion, steps: v.workflow && v.workflow.steps.length,
      fx: v.workflow && v.workflow.fx, same: again.ok && JSON.stringify(again.workflow) === JSON.stringify(v.workflow), strength: v.workflow && v.workflow.parameters[0].default,
      v1ok: v1.ok, v1same: JSON.stringify(v1.workflow) === JSON.stringify(old), v1version: v1.workflow.version, v1fx: 'fx' in v1.workflow,
      future: future.ok ? '' : future.errors[0], builtins: window.LE.recipes2.builtins.length, cards: document.querySelectorAll('.rx-card .rx-xtag').length
    };
  }, LOOK);
  h.assert(r.ok, '2.0 look is accepted: ' + JSON.stringify(r.errors));
  h.assert.equal(r.version + ' ' + r.min + ' ' + r.steps + ' ' + r.strength, '2.0 2.0 0 80', 'written as 2.0, no steps needed, strength kept');
  h.assert.equal(JSON.stringify(r.fx[0]), JSON.stringify({ type: 'vibrance', on: true, amount: 0.5, blend: 'normal', mask: null, p: { amount: 40 } }), 'an entry in its normal form, without an id');
  h.assert.equal(r.fx[1].mask.parts[0].kind, 'radial', 'a mask part that resolves per photo is kept');
  h.assert(r.same, 'reading the written file gives the same recipe');
  h.assert(r.v1ok && r.v1same && !r.v1fx && /^1\./.test(r.v1version), '1.x recipes are read exactly as before');
  h.assert(/newer LocalEditor/.test(r.future), 'a major version above 2 is refused: ' + r.future);
  h.assert.equal(r.builtins, 8, 'eight built-in Expert looks');
  h.assert.equal(r.cards, 8, 'the recipes page tags them "Expert"');
  /* The example in the repository is valid and stays in step with the format. */
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/recipes/warm-fade-look.leworkflow'), 'utf8'));
  const ev = await page.evaluate((x) => { const v = window.LE.recipes.validate(x); return { ok: v.ok, errors: v.errors, same: v.ok && JSON.stringify(v.workflow) === JSON.stringify(x) }; }, ex);
  h.assert(ev.ok && ev.same, 'examples/recipes/warm-fade-look.leworkflow is a normalised 2.0 recipe: ' + JSON.stringify(ev.errors));
  h.assert.noErrors(page);
};

cases['hostile 2.0 recipes are refused; unknown effects and painted masks are inert and reported'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (look) => {
    const R = window.LE.recipes, R2 = window.LE.recipes2, mk = (fx, extra) => Object.assign({}, look, { fx }, extra || {});
    const bad = {
      script: mk([{ type: 'vibrance', p: { amount: '<script>alert(1)</script>' } }]),
      handler: mk([{ type: 'vibrance', p: { note: 'x onload=alert(1)' } }]),
      proto: JSON.parse('{"format":"localeditor-workflow","version":"2.0","fx":[{"type":"vibrance","p":{"__proto__":{"x":1}}}]}'),
      ctor: mk([{ type: 'vibrance', p: { constructor: { prototype: 1 } } }]),
      url: mk([{ type: 'vibrance', p: { lut: 'data:text/html;base64,PHNjcmlwdD4=' } }]),
      image: mk([{ type: 'vibrance', p: { lut: 'data:image/png;base64,AAAA' } }]),
      type: mk([{ type: 'Vibrance()', p: {} }]),
      amount: mk([{ type: 'vibrance', amount: 7, p: {} }]),
      many: mk(new Array(33).fill({ type: 'vibrance', p: {} })),
      deep: mk([{ type: 'vibrance', p: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }]),
      long: mk([{ type: 'vibrance', p: { s: new Array(200).join('x') } }]),
      nan: mk([{ type: 'vibrance', p: { amount: null, list: [1, 'x', {}] }, mask: { parts: [{ kind: 'radial', cx: 'left' }] } }]),
      maskKind: mk([{ type: 'vibrance', p: {}, mask: { parts: [{ kind: 'shader' }] } }]),
      empty: mk([])
    };
    const out = {};
    Object.keys(bad).forEach((k) => { const v = R.validate(bad[k]); out[k] = v.ok ? 'ACCEPTED' : v.errors[0]; });
    /* Unknown effect type and a painted mask: accepted as data, never drawn. */
    const v = R.validate(mk([{ type: 'vibrance', p: { amount: 30, evil: 'x' }, mask: { parts: [{ kind: 'asset', asset: 'abc' }, { kind: 'luma', min: 0.5, max: 1 }] } }, { type: 'future-effect', p: { power: 9 } }, { type: 'vibrance', p: { amount: 99999 } }]));
    const FX = await window.LE.fxBoot.load();
    const res = v.ok ? R2.resolve(v.workflow, FX) : null;
    window.__polluted = ({}).x;
    return { out, ok: v.ok, warnings: v.warnings, kept: v.ok && v.workflow.fx.map((e) => e.type), parts: v.ok && v.workflow.fx[0].mask.parts.map((p) => p.kind), entries: res && res.entries.map((e) => e.type), inert: res && res.inert, notes: res && res.notes, evil: res && ('evil' in res.entries[0].p), clamped: res && res.entries[1].p.amount, polluted: window.__polluted };
  }, LOOK);
  Object.keys(r.out).forEach((k) => h.assert(r.out[k] !== 'ACCEPTED', 'hostile recipe "' + k + '" was accepted'));
  h.assert(r.ok, 'a recipe with an unknown effect is still read');
  h.assert.equal(JSON.stringify(r.kept), JSON.stringify(['vibrance', 'future-effect', 'vibrance']), 'the unknown entry stays in the file');
  h.assert.equal(JSON.stringify(r.parts), JSON.stringify(['luma']), 'the painted mask part is dropped');
  h.assert(r.warnings.some((w) => /painted mask/i.test(w)), 'with a note: ' + JSON.stringify(r.warnings));
  h.assert.equal(JSON.stringify(r.entries), JSON.stringify(['vibrance', 'vibrance']), 'the registry lets only known effects through');
  h.assert(r.inert.length === 1 && r.inert[0].type === 'future-effect' && r.notes.some((n) => /future-effect/.test(n) && /left out/.test(n)), 'the unknown effect is reported: ' + JSON.stringify(r.notes));
  h.assert(!r.evil && r.clamped <= 100, 'unknown settings are dropped and values clamped by the effect\'s schema (' + r.clamped + ')');
  h.assert(r.polluted === undefined, 'no prototype pollution');
  /* Applying it adds only the known entries. */
  const applied = await page.evaluate(async (look) => {
    const wf = window.LE.recipes.validate(Object.assign({}, look, { fx: [{ type: 'vibrance', p: { amount: 30 } }, { type: 'future-effect', p: { power: 9 } }] })).workflow;
    const res = await window.LEStudioRecipes.apply(window.LEStudio, window.__img, wf);
    return { notes: res.notes, types: window.LEStudio.L(window.__img).fx.map((e) => e.type) };
  }, LOOK);
  h.assert.equal(JSON.stringify(applied.types), JSON.stringify(['vibrance']), 'an unknown effect never reaches the layer');
  h.assert(applied.notes.some((n) => /left out/.test(n)), 'and the person is told');
  h.assert.noErrors(page);
};

cases['apply and remove are one undo step each; strength scales every entry; the person\'s own effects survive'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  /* The person's own effect is there first. */
  await page.evaluate(async () => { const FX = await window.LE.fxBoot.load(); const e = FX.validate({ type: 'contrast', p: { amount: 10 } }).entry; e.id = 'mine1'; window.LEStudio.patch(window.__img, { fx: [e] }); });
  const d0 = await undoDepth(page);
  const res = await page.evaluate((look) => window.LEStudioRecipes.apply(window.LEStudio, window.__img, window.LE.recipes.validate(look).workflow), LOOK);
  let l = await layer(page);
  h.assert.equal(await undoDepth(page), d0 + 1, 'applying is one undo step');
  h.assert.equal(JSON.stringify(l.fx.map((e) => e.id)), JSON.stringify(['mine1', 'rcp.0', 'rcp.1']), 'the recipe\'s entries are added as a group after the person\'s own');
  h.assert(l.marker && l.marker.id === 'test-look' && l.marker.strength === 80, 'the applied recipe is recorded on the photo: ' + JSON.stringify(l.marker));
  h.assert.equal(l.fx[1].amount + ' ' + l.fx[2].amount, '0.4 0.8', 'strength 80 scales each entry\'s own amount (0.5 and 1)');
  h.assert.equal(res.entries, 2);
  /* Strength 50, then 0, then back: amounts follow, nothing else moves. */
  await page.evaluate((look) => window.LEStudioRecipes.apply(window.LEStudio, window.__img, window.LE.recipes.validate(look).workflow, 50), LOOK);
  l = await layer(page);
  h.assert.equal(l.fx[1].amount + ' ' + l.fx[2].amount + ' ' + l.fx.length + ' ' + l.marker.strength, '0.25 0.5 3 50', 'strength 50');
  /* The pixels follow strength: the look at 100 differs more from the photo than at 30. */
  const diff = await page.evaluate(async (look) => {
    const FX = await window.LE.fxBoot.load(), R2 = window.LE.recipes2, wf = window.LE.recipes.validate(look).workflow, entries = R2.resolve(wf, FX).entries;
    const src = document.createElement('canvas'); src.width = 64; src.height = 64;
    const g = src.getContext('2d'); const gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#804020'); gr.addColorStop(1, '#30a0c0'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const px = (cv) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').drawImage(cv, 0, 0); return c.getContext('2d').getImageData(0, 0, 64, 64).data; };
    const base = px(src), d = (s) => { const o = px(FX.apply(src, { fx: R2.scale(entries, s) })); let t = 0; for (let i = 0; i < o.length; i += 4) t += Math.abs(o[i] - base[i]) + Math.abs(o[i + 1] - base[i + 1]) + Math.abs(o[i + 2] - base[i + 2]); return t; };
    return { zero: d(0), low: d(30), full: d(100) };
  }, LOOK);
  h.assert(diff.zero === 0 && diff.low > 0 && diff.full > diff.low * 1.5, 'strength scales the drawn result: ' + JSON.stringify(diff));
  /* Remove: exactly the recipe's entries go, in one step; undo brings them back in one step. */
  const d1 = await undoDepth(page);
  await page.evaluate(() => window.LEStudioRecipes.remove(window.LEStudio, window.__img));
  l = await layer(page);
  h.assert.equal(await undoDepth(page), d1 + 1, 'removing is one undo step');
  h.assert.equal(JSON.stringify(l.fx.map((e) => e.id)) + ' ' + JSON.stringify(l.marker), '["mine1"] null', 'only the recipe\'s entries and its marker are gone');
  await page.evaluate(() => window.LEStudio.cmd('undo'));
  l = await layer(page);
  h.assert.equal(l.fx.length + ' ' + (l.marker && l.marker.id), '3 test-look', 'one undo restores the whole look');
  /* A 1.1 recipe over an Expert look replaces its entries; removing that one leaves the photo as it was. */
  await page.evaluate(() => window.LEStudioRecipes.apply(window.LEStudio, window.__img, window.LE.recipes.builtins[0]));
  l = await layer(page);
  h.assert.equal(JSON.stringify(l.fx.map((e) => e.id)) + ' ' + l.marker.id, '["mine1"] ' + (await page.evaluate(() => window.LE.recipes.builtins[0].metadata.id)), '1.1 recipes work as before and take the look\'s place');
  h.assert.noErrors(page);
};

cases['Simple mode: a built-in Expert look from the Recipes panel loads the renderer on demand and can be removed'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  h.assert(!(await page.evaluate(() => !!(window.LE.fx && window.LE.fx.apply))), 'the renderer is not loaded before a look is used (test setup)');
  await page.evaluate(() => window.LEStudio.openPanel('recipes'));
  await page.waitForSelector('.sxr-card[data-id="x-teal-orange"] .sxr-tag');
  await page.click('.sxr-card[data-id="x-teal-orange"] .sxr-card-main');
  await page.waitForFunction(() => { const l = window.LEStudio.L(window.__img); return l && (l.fx || []).length > 0 && l.adjust && l.adjust.recipe; }, null, { timeout: 30000 });
  const got = await page.evaluate(() => { const l = window.LEStudio.L(window.__img), P = window.LE.fx.grade.presets.filter((p) => p.id === 'teal-orange')[0]; return { types: l.fx.map((e) => e.type), preset: P.fx.map((e) => e.type), ids: l.fx.every((e) => /^rcp\./.test(e.id)), amount: l.fx[0].amount, marker: l.adjust.recipe.id }; });
  h.assert.equal(JSON.stringify(got.types), JSON.stringify(got.preset), 'the entries are the grade pack\'s own preset');
  h.assert(got.ids && got.amount === 0.85 && got.marker === 'x-teal-orange', 'grouped, at the look\'s strength: ' + JSON.stringify(got));
  await page.waitForSelector('.sxr-applied');
  await page.click('.sxr-applied .sxr-row button');
  await page.waitForFunction(() => { const l = window.LEStudio.L(window.__img); return !(l.fx || []).length && !(l.adjust && l.adjust.recipe); });
  h.assert.noErrors(page);
};

cases['Expert mode: Save look as a recipe; share link and file round-trip; a link that is too long says to use the file'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const S = window.LEStudio, FX = await window.LE.fxBoot.load(), R = window.LE.recipes;
    const a = FX.validate({ type: 'vibrance', amount: 0.6, p: { amount: 35 } }).entry, b = FX.validate({ type: 'tone-curve', p: { lights: 12 }, mask: { parts: [{ kind: 'asset', asset: 'painted1' }, { kind: 'linear', x0: 0, y0: 0, x1: 0, y1: 1 }] } }).entry, off = FX.validate({ type: 'contrast', on: false, p: { amount: 50 } }).entry;
    S.patch(window.__img, { fx: [a, b, off] });
    const saved = await window.LEStudioRecipes.saveLook(S, window.__img, { name: 'Soft evening', strength: 70, silent: true });
    const mine = window.LE.userRecipes.get(saved.metadata.id);
    const link = await R.encodeLink(mine), back = await R.decodeLink(link.url);
    const file = R.validate(R.stringify(mine));
    /* Too long for a link: many large curves. */
    const big = JSON.parse(JSON.stringify(mine));
    big.fx = []; for (let i = 0; i < 30; i++) big.fx.push({ type: 'tone-curve', p: { curve: { master: Array.from({ length: 60 }, (x, j) => [j / 59, Math.round(((j / 59) + Math.sin(i * 7 + j * 13) * 0.004) * 1e6) / 1e6]) } } });
    const bigOk = R.validate(big).ok, long = await R.encodeLink(big).then((l) => 'LINK ' + l.url.length, (e) => e.message);
    return { id: saved.metadata.id, version: mine.version, types: mine.fx.map((e) => e.type), ids: mine.fx.some((e) => 'id' in e), parts: mine.fx[1].mask.parts.map((p) => p.kind), strength: mine.parameters[0].default, amount: mine.fx[0].amount,
      link: link.url.length, linkOk: /\/recipes\/#r=[zj]/.test(link.url), back: back.ok && JSON.stringify(back.workflow) === JSON.stringify(mine), file: file.ok && JSON.stringify(file.workflow) === JSON.stringify(mine), bigOk, long };
  });
  h.assert.equal(r.version + ' ' + JSON.stringify(r.types) + ' ' + r.strength + ' ' + r.amount, '2.0 ["vibrance","tone-curve"] 70 0.6', 'saved as 2.0 from the switched-on entries, with its strength; entry amounts are kept');
  h.assert(!r.ids && JSON.stringify(r.parts) === '["linear"]', 'ids and the painted mask are left out: ' + JSON.stringify(r.parts));
  h.assert(r.linkOk && r.link < 6200 && r.back, 'the share link carries the look and reads back the same (' + r.link + ' characters)');
  h.assert(r.file, 'the .leworkflow file reads back the same');
  h.assert(r.bigOk && /too large for a link/.test(r.long) && /\.leworkflow file/.test(r.long), 'a look too large for a link says to share the file: ' + r.long);
  /* The Expert panel has the button, and the dialog shows a preview and saves. */
  await page.evaluate(() => window.LEStudio.closePanel && window.LEStudio.closePanel());
  await page.evaluate(() => { window.LEStudioRecipes.saveLook(window.LEStudio, window.__img).then((s) => { window.__saved2 = s && s.metadata.id; }); });
  await page.waitForSelector('.sxr-savelook [data-go]');
  await page.waitForFunction(() => { const i = document.querySelector('.sxr-savelook-art img'); return i && /^data:image\/jpeg/.test(i.getAttribute('src') || ''); }, null, { timeout: 15000 });
  await page.fill('#sxr-look-name', 'Evening two');
  await page.click('.sxr-savelook [data-go]');
  await page.waitForFunction(() => !!window.__saved2);
  h.assert.equal(await page.evaluate(() => window.LE.userRecipes.get(window.__saved2).metadata.name), 'Evening two', 'the dialog saves under the name given');
  h.assert(/data-xp-save-look/.test(fs.readFileSync(path.join(ROOT, 'assets/js/expert/panel.js'), 'utf8')), 'the Expert panel offers "Save look as a recipe"');
  /* The shared link opens on the recipes page with an Expert tag and offers the studio. */
  const url = await page.evaluate(() => window.LE.recipes.encodeLink(window.LE.userRecipes.get(window.__saved2), { base: location.origin + '/recipes/' }).then((l) => l.url));
  const rp = await h.open(browser, base, url.replace(base, ''), 'phone');
  await rp.waitForSelector('#rx-shared-open', { state: 'attached' });
  h.assert(/Expert look/.test(await rp.textContent('#rx-shared')), 'the shared look is announced as an Expert look');
  await rp.waitForSelector('#rx-d-studio');   /* a shared link opens its preview */
  h.assert(await rp.$('.rx-xnote') && !(await rp.$('#rx-d-result')) && (await rp.$$eval('.rx-steps li', (n) => n.length)) === 2, 'the detail lists its effects and points to the studio');
  await h.noOverflow(rp);
  /* Open in studio: the look rides beside the photo and is applied there after the same checks. */
  await Promise.all([rp.waitForURL(/\/studio\/\?tool=recipes/, { timeout: 30000 }), rp.click('#rx-d-studio')]);
  await rp.waitForFunction(() => { const S = window.LEStudio, l = S && S.targetImage && S.targetImage(); return l && (l.fx || []).length === 2 && l.adjust && l.adjust.recipe && /^rcp\./.test(l.fx[0].id); }, null, { timeout: 45000 });
  h.assert.equal(await rp.evaluate(() => sessionStorage.getItem('le-recipe-v2')), null, 'the handed-over look is taken once');
  h.assert.noErrors(rp);
  h.assert.noErrors(page);
};

cases['batch: a 2.0 look runs on two photos through the existing batch flow'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (look) => {
    const mk = (c1, c2, name) => new Promise((res) => { const cv = document.createElement('canvas'); cv.width = 120; cv.height = 80; const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 120, 80); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 120, 80); cv.toBlob((b) => res(new File([b], name, { type: 'image/png' })), 'image/png'); });
    const files = [await mk('#804020', '#30a0c0', 'one.png'), await mk('#208040', '#c03060', 'two.png')];
    const wf = window.LE.recipes.validate(look).workflow;
    const run = async (w) => { const job = await window.LEStudioRecipes.batchWith(window.LEStudio, files, w, { format: 'png' }); const res = await job.done; return { count: res.count, failed: res.failed.length, names: res.names, size: res.zip ? res.zip.size : 0 }; };
    const plain = await run(Object.assign({}, window.LE.recipes.builtins[0]));
    const fx = await run(wf);
    /* The pixels of a batch photo carry the look: compare one photo with and without it. */
    const one = async (cfg) => { const j = window.LEStudioRecipes.runBatch([files[0]], Object.assign({ steps: [], max: 2048, format: 'png', quality: 1, label: 't' }, cfg)); const res = await j.done; return res.zip.size; };
    const FX = await window.LE.fxBoot.load();
    const sizes = [await one({}), await one({ fx: window.LE.recipes2.scale(window.LE.recipes2.resolve(wf, FX).entries, 100) })];
    return { plain, fx, sizes };
  }, LOOK);
  h.assert.equal(r.fx.count + ' ' + r.fx.failed, '2 0', 'both photos came out: ' + JSON.stringify(r.fx));
  h.assert(r.fx.names.every((n) => /test-look\.png$/.test(n)), 'named after the look: ' + r.fx.names);
  h.assert.equal(r.plain.count, 2, '1.1 batch is unchanged');
  h.assert(r.sizes[0] !== r.sizes[1], 'the look changes the batch result (zip sizes ' + r.sizes + ')');
  h.assert.noErrors(page);
};

module.exports = cases;
