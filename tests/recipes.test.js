'use strict';
/* Recipes (.leworkflow): engine, validator, share links, studio panel, batch and the /recipes/ page. */
const cases = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function enginePage(browser, base, h) {
  const page = await h.open(browser, base, '/recipes/', 'desktop');
  await page.waitForFunction(() => window.LE && window.LE.recipes);
  return page;
}

cases['every built-in recipe validates and applies'] = async ({ browser, base, h }) => {
  const page = await enginePage(browser, base, h);
  const r = await page.evaluate(async () => {
    const out = { count: LE.recipes.builtins.length, bad: [], cats: {}, failed: [] };
    LE.recipes.selfCheck().forEach((c) => { if (!c.ok) out.bad.push(c.name + ': ' + c.errors.join('; ')); });
    const src = LE.fit(LE.sample('portrait'), 240);
    for (const wf of LE.recipes.builtins) {
      out.cats[wf.metadata.category] = 1;
      try {
        const res = await LE.recipes.apply(src, wf);
        if (!res.canvas || !res.canvas.width) out.failed.push(wf.metadata.id);
      } catch (e) { out.failed.push(wf.metadata.id + ' ' + e.message); }
    }
    out.ids = new Set(LE.recipes.builtins.map((w) => w.metadata.id)).size;
    return out;
  });
  h.assert(r.count >= 20, 'Expected 20+ built-ins, got ' + r.count);
  h.assert.equal(r.ids, r.count, 'Built-in ids must be unique');
  h.assert(!r.bad.length, 'Invalid built-in: ' + r.bad[0]);
  h.assert(!r.failed.length, 'Failed to apply: ' + r.failed[0]);
  ['portrait', 'product', 'food', 'landscape', 'film', 'bw', 'social', 'document'].forEach((c) => h.assert(r.cats[c], 'No built-in in ' + c));
  h.assert.noErrors(page);
};

cases['new operations change pixels and scale with strength'] = async ({ browser, base, h }) => {
  const page = await enginePage(browser, base, h);
  const r = await page.evaluate(async () => {
    const src = LE.fit(LE.sample('scene'), 160);
    const px = (c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return d / (a.length / 4); };
    const o = px(src);
    const out = {};
    for (const [op, params] of [['fade', { amount: 40 }], ['clarity', { value: 60 }], ['split-tone', { shadowHue: 200, shadowAmount: 50, highlightHue: 40, highlightAmount: 50, balance: 0 }]]) {
      const res = await LE.applySteps(src, [{ operation: op, parameters: params }]);
      out[op] = diff(o, px(res.canvas));
    }
    const wf = LE.recipes.builtins.find((w) => w.metadata.id === 'vintage-film');
    const lo = await LE.recipes.apply(src, wf, { strength: 20 });
    const hi = await LE.recipes.apply(src, wf, { strength: 100 });
    const zero = await LE.recipes.apply(src, wf, { strength: 0 });
    out.lo = diff(o, px(lo.canvas)); out.hi = diff(o, px(hi.canvas)); out.zero = diff(o, px(zero.canvas));
    return out;
  });
  h.assert(r.fade > 3 && r.clarity > 0.5 && r['split-tone'] > 3, 'New ops had no effect: ' + JSON.stringify(r));
  h.assert(r.hi > r.lo && r.lo > r.zero, 'Strength does not scale: ' + JSON.stringify(r));
  h.assert(r.zero < 1.5, 'Strength 0 should be near identity (grain aside): ' + r.zero);
};

cases['validator rejects bad files and keeps 1.0 files working'] = async ({ browser, base, h }) => {
  const page = await enginePage(browser, base, h);
  const r = await page.evaluate(() => {
    const V = (x) => LE.recipes.validate(x);
    const ok = { format: 'localeditor-workflow', version: '1.0', metadata: { name: 'Old' }, steps: [{ operation: 'adjust', parameters: { exposure: 0.2, temperature: 10 } }, { operation: 'filter', parameters: { name: 'film', intensity: 80 } }] };
    const step = (s) => JSON.stringify({ format: 'localeditor-workflow', version: '1.0', steps: [s] });
    return {
      old: V(ok).ok && V(ok).workflow.version === '1.0',
      oldString: V(JSON.stringify(ok)).ok,
      v11: V(Object.assign({}, ok, { version: '1.1', steps: [{ operation: 'fade', parameters: { amount: 10 } }] })).workflow.version === '1.1',
      unknownOp: V(step({ operation: 'eval', parameters: {} })).ok,
      range: V(step({ operation: 'exposure', parameters: { value: 5 } })).ok,
      notNumber: V(step({ operation: 'contrast', parameters: { value: '12' } })).ok,
      proto: V('{"format":"localeditor-workflow","version":"1.0","steps":[{"operation":"contrast","parameters":{"__proto__":{"x":1},"value":1}}]}').ok,
      ctor: V('{"format":"localeditor-workflow","version":"1.0","constructor":{},"steps":[{"operation":"contrast","parameters":{"value":1}}]}').ok,
      prototype: V('{"format":"localeditor-workflow","version":"1.0","metadata":{"prototype":1},"steps":[{"operation":"contrast","parameters":{"value":1}}]}').ok,
      script: V({ format: 'localeditor-workflow', version: '1.0', metadata: { name: '<script>alert(1)</script>' }, steps: [{ operation: 'contrast', parameters: { value: 1 } }] }).ok,
      jsUrl: V({ format: 'localeditor-workflow', version: '1.0', metadata: { description: 'javascript:alert(1)' }, steps: [{ operation: 'contrast', parameters: { value: 1 } }] }).ok,
      handler: V(step({ operation: 'text', parameters: { text: '<img src=x onerror=alert(1)>' } })).ok,
      badColor: V(step({ operation: 'border', parameters: { color: 'url(http://x)' } })).ok,
      big: V('{"format":"localeditor-workflow","version":"1.0","pad":"' + 'x'.repeat(2100000) + '","steps":[]}').ok,
      newer: V(Object.assign({}, ok, { version: '2.0' })).errors[0],
      noSteps: V({ format: 'localeditor-workflow', version: '1.0', steps: [] }).ok,
      tooMany: V({ format: 'localeditor-workflow', version: '1.0', steps: Array.from({ length: 41 }, () => ({ operation: 'contrast', parameters: { value: 1 } })) }).ok,
      notJson: V('{nope').ok,
      wrongFormat: V({ format: 'something', version: '1.0', steps: [{ operation: 'contrast', parameters: { value: 1 } }] }).ok,
      unknownParam: V(step({ operation: 'contrast', parameters: { value: 1, zap: 2 } }))
    };
  });
  h.assert(r.old && r.oldString, 'A 1.0 file should still validate');
  h.assert(r.v11, 'Files using fade should be written as 1.1');
  ['unknownOp', 'range', 'notNumber', 'proto', 'ctor', 'prototype', 'script', 'jsUrl', 'handler', 'badColor', 'big', 'noSteps', 'tooMany', 'notJson', 'wrongFormat'].forEach((k) => h.assert(r[k] === false, k + ' should be rejected'));
  h.assert(/newer/.test(r.newer), 'Version 2 should ask for a newer app');
  h.assert(r.unknownParam.ok && r.unknownParam.warnings.length === 1 && !('zap' in r.unknownParam.workflow.steps[0].parameters), 'Unknown parameters are dropped with a warning');
};

cases['share links round-trip and reject tampering'] = async ({ browser, base, h }) => {
  const page = await enginePage(browser, base, h);
  const r = await page.evaluate(async () => {
    const out = {};
    for (const wf of LE.recipes.builtins.slice(0, 6)) {
      const link = await LE.recipes.encodeLink(wf);
      const back = await LE.recipes.decodeLink(link.url);
      if (!back.ok || JSON.stringify(back.workflow) !== JSON.stringify(wf)) out.mismatch = wf.metadata.id;
      out.max = Math.max(out.max || 0, link.url.length);
      out.compressed = link.compressed;
    }
    const plain = await LE.recipes.encodeLink(LE.recipes.builtins[0], { compress: false });
    out.plain = (await LE.recipes.decodeLink(plain.fragment)).ok && plain.payload[0] === 'j';
    const link = await LE.recipes.encodeLink(LE.recipes.builtins[0]);
    const p = link.payload;
    out.flip = (await LE.recipes.decodeLink('#r=' + p.slice(0, 20) + (p[20] === 'A' ? 'B' : 'A') + p.slice(21))).ok;
    out.cut = (await LE.recipes.decodeLink('#r=' + p.slice(0, p.length - 30))).ok;
    out.junk = (await LE.recipes.decodeLink('#r=zzzz')).ok;
    out.tag = (await LE.recipes.decodeLink('#r=q' + p.slice(1))).ok;
    const evil = { format: 'localeditor-workflow', version: '1.0', steps: [{ operation: 'exec', parameters: {} }] };
    const bytes = new TextEncoder().encode(JSON.stringify(evil));
    const b64 = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    out.evil = (await LE.recipes.decodeLink('#r=j' + b64)).ok;
    const long = 'j' + 'A'.repeat(7000);
    out.long = (await LE.recipes.decodeLink('#r=' + long)).ok;
    return out;
  });
  h.assert(!r.mismatch, 'Round trip changed ' + r.mismatch);
  h.assert(r.compressed, 'Chromium should use CompressionStream');
  h.assert(r.plain, 'Plain (uncompressed) links should decode');
  h.assert(r.max < 2000, 'Links should stay short, got ' + r.max);
  ['flip', 'cut', 'junk', 'tag', 'evil', 'long'].forEach((k) => h.assert(r[k] === false, 'Tampered link accepted: ' + k));
};

cases['save look, edit, export and import round trip'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const S = window.LEStudio;
    const img = S.targetImage();
    S.patch(img.id, { adjust: { exposure: 0.2, contrast: 14, warmth: 10, fade: 12, splitShadowAmount: 20, splitShadowHue: 200 }, filter: { name: 'film', intensity: 60 } });
    S.openPanel('recipes');
    await new Promise((r) => setTimeout(r, 300));
    [...document.querySelectorAll('.sxr-foot button')].find((b) => /Save this look/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 300));
    const name = document.querySelector('.sxr-form input');
    name.value = 'Test Look'; name.dispatchEvent(new Event('input'));
    const steps = [...document.querySelectorAll('.sxr-step')].map((li) => li.querySelector('b').textContent);
    // turn off the first step, move the last one up with the accessible control
    const first = document.querySelector('.sxr-step input[type=checkbox]');
    first.checked = false; first.dispatchEvent(new Event('change'));
    const rows = document.querySelectorAll('.sxr-step');
    rows[rows.length - 1].querySelector('.sxr-step-main').click();
    await new Promise((r) => setTimeout(r, 100));
    const last = document.querySelectorAll('.sxr-step')[rows.length - 1];
    last.querySelector('.sxr-up').click();
    const order = [...document.querySelectorAll('.sxr-step')].map((li) => li.querySelector('b').textContent);
    // add a step from the list
    const sel = document.querySelector('.sxr-add select');
    sel.value = 'grain'; sel.dispatchEvent(new Event('change'));
    [...document.querySelectorAll('.sxr-edit-actions button')].find((b) => /Save/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 300));
    const saved = LE.userRecipes.all().find((w) => w.metadata.name === 'Test Look');
    const text = LE.recipes.stringify(saved);
    const back = LE.recipes.validate(text);
    const link = await LE.recipes.encodeLink(saved);
    const fromLink = await LE.recipes.decodeLink(link.url);
    return { steps, order, saved: !!saved, firstOff: saved && saved.steps[0].enabled === false, hasGrain: saved && saved.steps.some((s) => s.operation === 'grain'),
      identical: back.ok && JSON.stringify(back.workflow) === JSON.stringify(saved), linkIdentical: fromLink.ok && JSON.stringify(fromLink.workflow) === JSON.stringify(saved),
      ops: saved && saved.steps.map((s) => s.operation) };
  });
  h.assert(r.saved, 'Recipe was not saved');
  h.assert(r.steps.length >= 5, 'Look should become several steps: ' + r.steps.join(','));
  h.assert(r.order[r.order.length - 2] === r.steps[r.steps.length - 1], 'Up did not move the step');
  h.assert(r.firstOff, 'Toggled step should be off');
  h.assert(r.hasGrain, 'Added step missing');
  h.assert(r.identical, 'Export → import changed the recipe');
  h.assert(r.linkIdentical, 'Link round trip changed the recipe');
  h.assert(r.ops.indexOf('fade') >= 0 && r.ops.indexOf('split-tone') >= 0 && r.ops.indexOf('filter') >= 0, 'Captured ops: ' + r.ops);
  h.assert.noErrors(page);
};

['desktop', 'phone'].forEach((vp) => {
  cases['studio apply, strength, remove and undo (' + vp + ')'] = async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, vp);
    await h.openPanel(page, 'recipes');
    await page.waitForFunction(() => document.querySelectorAll('.sxr-card.has-art').length >= 4, null, { timeout: 15000 });
    const before = await h.doc(page);
    const img0 = before.layers.find((l) => l.type === 'image');
    await page.click('.sxr-card[data-id="golden-hour"] .sxr-card-main');
    await wait(300);
    let d = await h.doc(page);
    let img = d.layers.find((l) => l.id === img0.id);
    h.assert(img.adjust.recipe && img.adjust.recipe.id === 'golden-hour', 'Recipe marker missing');
    h.assert(img.adjust.warmth > 0, 'Warmth not applied');
    const warm1 = img.adjust.warmth;
    // strength slider on the applied card
    await page.evaluate(() => { const s = document.querySelector('.sxr-applied input[type=range]'); s.value = 30; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
    await wait(200);
    d = await h.doc(page);
    img = d.layers.find((l) => l.id === img0.id);
    h.assert(img.adjust.warmth < warm1 && img.adjust.recipe.strength === 30, 'Strength did not lower the look');
    // apply + strength is one undo step
    await page.evaluate(() => window.LEStudio.cmd('undo'));
    await wait(200);
    d = await h.doc(page);
    img = d.layers.find((l) => l.id === img0.id);
    h.assert(!img.adjust.recipe && !img.adjust.warmth, 'Undo should remove the whole recipe in one step');
    await page.evaluate(() => window.LEStudio.cmd('redo'));
    // a manual edit survives Remove
    await page.evaluate((id) => { const S = window.LEStudio; const l = S.L(id); S.patch(id, { adjust: Object.assign({}, l.adjust, { contrast: (l.adjust.contrast || 0) + 5 }) }); }, img0.id);
    await h.openPanel(page, 'recipes');
    await wait(500);
    await page.click('.sxr-applied button:has-text("Remove")');
    await wait(200);
    d = await h.doc(page);
    img = d.layers.find((l) => l.id === img0.id);
    h.assert(!img.adjust.recipe && !img.adjust.warmth && !img.adjust.splitHighlightAmount, 'Remove left recipe values: ' + JSON.stringify(img.adjust));
    h.assert(Math.abs((img.adjust.contrast || 0) - 5) < 0.01, 'Manual edit lost on Remove');
    h.assert(await h.noOverflow(page), 'Studio scrolls sideways');
    h.assert.noErrors(page);
  };
});

cases['batch from a recipe card makes a zip with every photo'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.openPanel(page, 'recipes');
  await page.click('.sxr-card[data-id="noir"] .sxr-more');
  await page.click('.sxr-menu-item:has-text("many photos")');
  await wait(200);
  const dl = page.waitForEvent('download', { timeout: 20000 });
  const r = await page.evaluate(async () => {
    const files = [];
    for (let i = 0; i < 5; i++) {
      const c = document.createElement('canvas'); c.width = 120 + i; c.height = 80;
      c.getContext('2d').fillStyle = 'hsl(' + i * 60 + ',70%,50%)'; c.getContext('2d').fillRect(0, 0, c.width, c.height);
      files.push(new File([await new Promise((res) => c.toBlob(res, 'image/png'))], 'shot-' + i + '.png', { type: 'image/png' }));
    }
    files.push(new File(['broken'], 'broken.jpg', { type: 'image/jpeg' }));
    window.LEStudio.S.onBatchFiles(files);
    for (let t = 0; t < 100; t++) { const b = window.LEStudioRecipes.lastBatch(); if (b && b.result) break; await new Promise((res) => setTimeout(res, 100)); }
    const res = window.LEStudioRecipes.lastBatch().result;
    const bytes = new Uint8Array(await res.zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    return { count: res.count, failed: res.failed, names: res.names, entries: view.getUint16(eocd + 10, true), sig: view.getUint32(eocd, true) === 0x06054b50, select: document.querySelector('.sxr-batch select').value };
  });
  const download = await dl;
  h.assert.equal(r.select, 'r:noir', 'Batch should open on the chosen recipe');
  h.assert.equal(r.count, 5, 'Photos in zip');
  h.assert.equal(r.entries, 5, 'Zip entries');
  h.assert(r.sig, 'Zip end record missing');
  h.assert(r.failed.length === 1, 'The broken file should be skipped');
  h.assert(/\.zip$/.test(download.suggestedFilename()), 'Download is not a zip');
  h.assert.noErrors(page);
};

['desktop', 'phone', 'small'].forEach((vp) => {
  cases['/recipes/ renders with previews (' + vp + ')'] = async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/recipes/', vp);
    await page.waitForFunction(() => document.querySelectorAll('.rx-card.is-ready').length >= 2, null, { timeout: 20000 });
    h.assert(await page.evaluate(() => document.querySelectorAll('#rx-grid .rx-card').length >= 20), 'Library is missing cards');
    await page.click('#rx-grid .rx-card .rx-card-btn');
    await page.waitForSelector('#rx-detail:not([hidden]) .rx-steps li');
    await wait(400);
    h.assert(await h.noOverflow(page), 'Page scrolls sideways with the detail open');
    await page.keyboard.press('Escape');
    h.assert(await page.evaluate(() => document.getElementById('rx-detail').hidden), 'Escape should close the detail');
    h.assert(await h.noOverflow(page), 'Page scrolls sideways');
    h.assert.noErrors(page);
  };
});

cases['/recipes/ opens a #r= share link and saves it'] = async ({ browser, base, h }) => {
  const page = await enginePage(browser, base, h);
  const url = await page.evaluate(async () => {
    const wf = JSON.parse(JSON.stringify(LE.recipes.builtins.find((w) => w.metadata.id === 'pastel-dream')));
    wf.metadata.id = 'friends-pastel'; wf.metadata.name = 'Friend’s Pastel'; wf.metadata.author = 'Sam';
    return (await LE.recipes.encodeLink(wf)).url;
  });
  const p2 = await h.open(browser, base, url.replace(/^https?:\/\/[^/]+/, ''), 'phone');
  await p2.waitForSelector('#rx-detail:not([hidden]) .rx-banner');
  h.assert(/Friend’s Pastel/.test(await p2.textContent('#rx-d-title')), 'Shared recipe not shown');
  await p2.click('#rx-d-save');
  await wait(200);
  h.assert(await p2.evaluate(() => !!LE.userRecipes.get('friends-pastel')), 'Shared recipe not saved');
  h.assert(await h.noOverflow(p2), 'Page scrolls sideways');
  h.assert.noErrors(p2);
  const bad = await h.open(browser, base, '/recipes/#r=zAAAAgarbage', 'desktop');
  await bad.waitForSelector('#rx-shared.is-bad');
  h.assert(await bad.evaluate(() => document.getElementById('rx-detail').hidden), 'A broken link must not open a recipe');
  h.assert.noErrors(bad);
};

module.exports = cases;
