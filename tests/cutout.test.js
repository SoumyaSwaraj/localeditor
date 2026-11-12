'use strict';
/* Subject cut-out in the studio (ROADMAP 2.9): layer.cutout + a mask asset, brush, round trip, honest failures, lazy model. */
const cases = {};

async function studioWithPhoto(browser, base, h, viewport, photo) {
  const page = await h.open(browser, base, '/studio/', viewport || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene && window.LEStudioCutout);
  await page.evaluate(async (p) => {
    const b = await (await fetch('/assets/photos/collage/' + p + '.jpg')).blob();
    await LEStudio.newFromPhoto(new File([b], p + '.jpg', { type: 'image/jpeg' }));
    const l = LEStudio.scene.layers().find((x) => x.type === 'image');
    LEStudio.scene.select([l.id]);
  }, photo || 'arch-01');
  await page.waitForTimeout(300);
  return page;
}
const imageLayer = (page) => page.evaluate(() => LEStudio.scene.layers().find((x) => x.type === 'image'));
/* Alpha statistics of the exported image layer: corners, centre column and how many pixels are opaque. */
function alphaStats(page) {
  return page.evaluate(async () => {
    const l = LEStudio.scene.layers().find((x) => x.type === 'image');
    const c = await LEStudio.scene.exportLayer(l.id, 1);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    const a = (x, y) => d[(Math.min(H - 1, Math.round(y)) * W + Math.min(W - 1, Math.round(x))) * 4 + 3];
    let opaque = 0, sum = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 245) opaque++; sum += d[i]; }
    return { corners: [a(2, 2), a(W - 3, 2)], centre: a(W / 2, H / 2), opaque: opaque / (W * H), mean: sum / (W * H) / 255, W, H };
  });
}

cases['the model is not fetched until asked, then cached in le-models-v1'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  const AI = /\.onnx|\.wasm|\/vendor\/ort\/|le-bgremove/;
  h.assert(!before.some((u) => AI.test(u)), 'Fetched before asked: ' + before.filter((u) => AI.test(u)).join(', '));
  h.assert.equal(await page.evaluate(() => !!(window.LE.bgRemove)), false, 'Runtime loaded before asked');
  h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), false, 'Model cache exists before asked');
  await page.click('.sxc-tb');
  await page.waitForSelector('.sxc-go');
  const note = await page.waitForFunction(() => { const n = document.querySelector('.sxc-first'); return n && /once \(\d+ MB\)/.test(n.textContent) && n.textContent; });
  h.assert(/works offline/.test(await note.jsonValue()) && /stays on this device/.test(await note.jsonValue()), 'First-use sentence missing');
  h.assert.equal(await page.textContent('.sxc-go'), 'Download and remove');
  /* The chooser is data-driven, plain-worded and pre-selects one recommended option. */
  await page.click('.sxc-other > summary');
  const cards = await page.evaluate(() => [...document.querySelectorAll('.sxc-opt')].map((o) => ({ id: o.dataset.model, text: o.querySelector('.sxc-pick').textContent, on: o.querySelector('.sxc-pick').getAttribute('aria-checked') })));
  h.assert.equal(cards.length, await page.evaluate(() => LE.bgRemove.models().filter((m) => m.listed).length));
  h.assert(cards.every((c) => !/int8|u2net|onnx|RAM/i.test(c.text)), 'Jargon on a card: ' + cards.map((c) => c.text).join(' | '));
  h.assert(cards.every((c) => /\d+ MB, one time/.test(c.text) && /(Good|Better|Best)/.test(c.text)), 'Download line or quality missing');
  h.assert.equal(cards.filter((c) => /Recommended for you/.test(c.text)).length, 1);
  h.assert.equal(cards.filter((c) => c.on === 'true')[0].id, 'u2netp');
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  h.assert(!urls.some((u) => /\.onnx|\.wasm/.test(u)), 'Model fetched before the button was pressed');
  await page.click('.sxc-go');
  await page.waitForFunction(() => LEStudio.scene.layers().some((x) => x.cutout), null, { timeout: 60000 });
  const cached = await page.evaluate(async () => (await LE.bgRemove.cachedModels()).map((m) => m.id));
  h.assert(cached.indexOf('u2netp') >= 0, 'Model not cached: ' + cached.join(','));
  h.assert.noErrors(page);
};

cases['cut-out stores a mask asset, is transparent outside and toggles back to the original'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  const undoBefore = await page.evaluate(() => LEStudio.scene._hist.undo.length);
  const res = await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  h.assert(res && res.asset, 'No result');
  const l = await imageLayer(page);
  h.assert(l.cutout && l.cutout.asset === res.asset && l.cutout.enabled === true && l.cutout.model === 'u2netp', 'cutout field: ' + JSON.stringify(l.cutout));
  h.assert.equal(l.cutout.version, 1);
  const meta = await page.evaluate((id) => LEStudio.S.project.assets[id], res.asset);
  h.assert(meta && meta.type === 'image/png' && /^background-removal-mask/.test(meta.name), 'Mask asset meta: ' + JSON.stringify(meta));
  h.assert.equal(await page.evaluate(() => LEStudio.scene._hist.undo.length) - undoBefore, 1, 'Cut-out should be one undo step');
  const cut = await alphaStats(page);
  h.assert(cut.corners.every((a) => a < 10), 'Corners should be transparent: ' + cut.corners);
  h.assert(cut.centre > 240, 'Centre should be opaque: ' + cut.centre);
  h.assert(cut.opaque > 0.15 && cut.opaque < 0.85, 'Opaque share ' + cut.opaque);
  await page.evaluate(() => { const x = LEStudio.one(); LEStudio.patch(x.id, { cutout: { enabled: false } }); });
  const orig = await alphaStats(page);
  h.assert(orig.corners.every((a) => a === 255) && orig.opaque > 0.99, 'Original not restored: ' + JSON.stringify(orig));
  await page.evaluate(() => { const x = LEStudio.one(); LEStudio.patch(x.id, { cutout: { enabled: true } }); });
  /* Feather and outline land in the document and change the render. */
  await page.evaluate(() => { const x = LEStudio.one(); LEStudio.patch(x.id, { cutout: { outline: { width: 12, color: '#ffffff' } } }); });
  const ol = await alphaStats(page);
  h.assert(ol.opaque > cut.opaque + 0.02, 'Outline should add opaque pixels: ' + cut.opaque + ' -> ' + ol.opaque);
  await page.evaluate(() => { const x = LEStudio.one(); LEStudio.patch(x.id, { cutout: { outline: null, feather: 12 } }); });
  const fe = await alphaStats(page);
  h.assert(fe.opaque < cut.opaque - 0.005, 'Feather should soften the edge: ' + cut.opaque + ' -> ' + fe.opaque);
  const doc = await imageLayer(page);
  h.assert.equal(doc.cutout.feather, 12);
  h.assert.equal(doc.cutout.outline, null);
  /* Undo all the way back removes the field; the photo is untouched. */
  await page.evaluate(() => { while (LEStudio.scene.layers().find((x) => x.type === 'image').cutout && LEStudio.scene.canUndo()) LEStudio.scene.undo(); });
  h.assert(!(await imageLayer(page)).cutout, 'Undo should remove the cut-out');
  h.assert.noErrors(page);
};

cases['the shadow follows the subject, and backdrops are normal layers'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  const r = await page.evaluate(async () => {
    const l = LEStudio.one();
    LEStudio.patch(l.id, { shadow: { color: 'rgba(0,0,0,.9)', blur: 0, x: 30, y: 0 } });
    const c = await LEStudio.scene.render(1, { includeBackground: false });
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const a = (x, y) => d[(Math.round(y) * c.width + Math.round(x)) * 4 + 3];
    /* top-left corner of the photo box: outside the subject, so no shadow there when the shadow follows the alpha */
    const before = LEStudio.scene._hist.undo.length;
    const made = LEStudioCutout.putOn(l.id, 'blur');
    const layers = LEStudio.scene.layers();
    return { corner: a(l.x + 3, l.y + 3), steps: LEStudio.scene._hist.undo.length - before, backdrop: layers.find((x) => x.id === made), order: layers.map((x) => x.id).indexOf(made) < layers.map((x) => x.id).indexOf(l.id) };
  });
  h.assert(r.corner < 10, 'Shadow should follow the cut-out, not the photo box: alpha ' + r.corner);
  h.assert.equal(r.steps, 1, 'Backdrop should be one undo step');
  h.assert(r.backdrop && r.backdrop.type === 'image' && !r.backdrop.cutout && r.backdrop.adjust.blur > 0, 'Blurred backdrop: ' + JSON.stringify(r.backdrop && r.backdrop.adjust));
  h.assert(r.order, 'Backdrop should sit behind the subject');
  h.assert.noErrors(page);
};

cases['refine brush erases and restores the mask, and commits one undo step'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  const first = (await imageLayer(page)).cutout.asset;
  const undoBefore = await page.evaluate(() => LEStudio.scene._hist.undo.length);
  const centre = await page.evaluate(() => { const l = LEStudio.one(); return [l.x + l.w / 2, l.y + l.h / 2, l.x + 6, l.y + 6]; });
  h.assert(await page.evaluate(() => LEStudioCutout.refine()), 'Refine did not start');
  await page.waitForSelector('.sxc-brush');
  h.assert(await page.evaluate(() => document.querySelector('[data-cmd="cutDone"]') !== null), 'Brush toolbar missing');
  /* Erase a stroke through the middle, restore the top-left corner. */
  await page.evaluate((c) => {
    LEStudioCutout.brush.stroke([[c[0] - 30, c[1]], [c[0] + 30, c[1]]], { mode: 'erase', size: 60, hard: true });
    LEStudioCutout.brush.stroke([[c[2], c[3]], [c[2] + 4, c[3] + 4]], { mode: 'restore', size: 40, hard: true });
  }, centre);
  h.assert.equal((await page.evaluate(() => LEStudioCutout.state().brush.undo)), 2);
  await page.evaluate(() => LEStudioCutout.brush.undo());
  await page.evaluate(() => LEStudioCutout.brush.redo());
  h.assert.equal(await page.evaluate(() => LEStudio.scene._hist.undo.length), undoBefore, 'Brush strokes should not touch history until Done');
  await page.evaluate(() => LEStudioCutout.brush.done());
  await page.waitForFunction((a) => LEStudio.scene.layers().find((x) => x.type === 'image').cutout.asset !== a, first);
  const l = await imageLayer(page);
  h.assert(l.cutout.asset !== first && /^[a-f0-9]{64}$/.test(l.cutout.asset), 'New mask asset expected');
  h.assert.equal(await page.evaluate(() => LEStudio.scene._hist.undo.length) - undoBefore, 1, 'Refine should be one undo step');
  const st = await alphaStats(page);
  h.assert(st.centre < 10, 'Erased centre should be transparent: ' + st.centre);
  h.assert(st.corners[0] > 200, 'Restored corner should be opaque: ' + st.corners[0]);
  h.assert(!(await page.$('.sxc-brush')), 'Overlay should be gone');
  await page.evaluate(() => LEStudio.scene.undo());
  h.assert.equal((await imageLayer(page)).cutout.asset, first, 'Undo should bring back the first mask');
  h.assert.noErrors(page);
};

cases['.leproject round trip keeps the cut-out and its mask'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  await page.evaluate(() => { const l = LEStudio.one(); LEStudio.patch(l.id, { cutout: { feather: 3, outline: { width: 9, color: '#ff4d6d' } } }); });
  const r = await page.evaluate(async () => {
    LEStudio.syncProject();
    const blob = await LE.project.exportFile(LEStudio.S.project);
    const back = await LE.project.readFile(new File([blob], 'x.leproject'));
    const layer = back.project.pages[0].layers.find((x) => x.type === 'image');
    /* Open it as a new design and check the render still has transparency. */
    const p = await LE.project.importFile(new File([blob], 'x.leproject'));
    await LEStudio.openProject(p.id);
    await new Promise((res) => setTimeout(res, 400));
    const l2 = LEStudio.scene.layers().find((x) => x.type === 'image');
    const c = await LEStudio.scene.exportLayer(l2.id, 1);
    const a = c.getContext('2d').getImageData(1, 1, 1, 1).data[3];
    return { cutout: layer.cutout, hasMask: !!back.blobs[layer.cutout.asset], maskType: back.project.assets[layer.cutout.asset].type, corner: a, opened: l2.cutout, warnings: back.warnings };
  });
  h.assert(r.hasMask && r.maskType === 'image/png', 'Mask missing from the file');
  h.assert.equal(r.cutout.feather, 3);
  h.assert.equal(r.cutout.outline.width, 9);
  h.assert.equal(r.cutout.outline.color, '#ff4d6d');
  h.assert(r.opened && r.opened.asset === r.cutout.asset, 'Opened design lost the cut-out');
  h.assert(r.corner < 10, 'Re-opened design is not transparent at the corner: ' + r.corner);
  h.assert.equal(r.warnings.length, 0, 'Warnings: ' + r.warnings.join(' | '));
  /* The sanitiser drops a cut-out whose mask is missing, with a plain warning. */
  const bad = await page.evaluate(() => {
    const p = JSON.parse(JSON.stringify(LEStudio.S.project));
    const l = p.pages[0].layers.find((x) => x.type === 'image');
    l.cutout = { asset: 'f'.repeat(64), feather: 999, outline: { width: 5, color: 'javascript:alert(1)' } };
    const v = LE.project.validate(p);
    return { cut: v.project.pages[0].layers.find((x) => x.type === 'image').cutout || null, errors: v.errors };
  });
  h.assert.equal(bad.cut, null);
  h.assert(bad.errors.some((e) => /mask/.test(e)), 'Expected a mask warning');
  h.assert.noErrors(page);
};

cases['a photo with no clear subject gets a kind message and no change'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'nature-01');
  const before = JSON.stringify(await h.doc(page));
  const assetsBefore = await page.evaluate(() => Object.keys(LEStudio.S.project.assets).length);
  await page.evaluate(() => LEStudio.openPanel('cutout'));
  const res = await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  h.assert.equal(res, null);
  const st = await page.evaluate(() => LEStudioCutout.state());
  h.assert(st.error && st.error.code === 'no-subject', 'Expected no-subject, got ' + JSON.stringify(st.error));
  h.assert.equal(JSON.stringify(await h.doc(page)), before, 'Document changed');
  h.assert.equal(await page.evaluate(() => Object.keys(LEStudio.S.project.assets).length), assetsBefore, 'A mask was stored');
  const text = await page.textContent('#sx-panel-body');
  h.assert(/No clear subject found/.test(text) && /Nothing was changed/.test(text), 'Kind message missing');
  h.assert(await page.$('.sxc-alert button'), 'Expected a way forward (brush)');
  h.assert.noErrors(page);
};

cases['cancel mid-run leaves the document untouched'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'people-07');
  const before = JSON.stringify(await h.doc(page));
  await page.evaluate(() => { LEStudio.openPanel('cutout'); window.__p = LEStudioCutout.run(null, { quiet: true }); });
  await page.waitForFunction(() => LEStudioCutout.state().running && /Finding|Starting|Loading|Downloading/.test(LEStudioCutout.state().stage || ''));
  await page.waitForSelector('#sxc-progress');
  await page.click('#sx-panel-body .btn:has-text("Cancel")');
  const res = await page.evaluate(() => window.__p);
  h.assert.equal(res, null);
  h.assert.equal(await page.evaluate(() => LEStudioCutout.state().running), false);
  h.assert.equal(JSON.stringify(await h.doc(page)), before, 'Document changed after cancel');
  h.assert.equal(await page.evaluate(() => Object.keys(LEStudio.S.project.assets).filter((id) => /mask/.test(LEStudio.S.project.assets[id].name)).length), 0);
  /* A second run after cancelling works (the worker restarts from Cache Storage). */
  const again = await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  h.assert(again && again.asset, 'Run after cancel failed');
  h.assert.noErrors(page);
};

cases['download failure and out-of-memory are explained, nothing changes'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  await page.route('**/assets/models/u2netp.onnx', (r) => r.abort('internetdisconnected'));
  const before = JSON.stringify(await h.doc(page));
  await page.evaluate(() => LEStudio.openPanel('cutout'));
  await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  h.assert.equal((await page.evaluate(() => LEStudioCutout.state().error || {})).code, 'download');
  h.assert(/Download did not finish/.test(await page.textContent('#sx-panel-body')), 'Download message missing');
  h.assert.equal(JSON.stringify(await h.doc(page)), before);
  /* Simulated out-of-memory from the engine (both tries). */
  await page.evaluate(() => { LE.bgRemove.cutout = () => Promise.reject(Object.assign(new Error('out of memory'), { code: 'memory' })); });
  await page.evaluate(() => LEStudioCutout.run(null, { quiet: true }));
  h.assert.equal((await page.evaluate(() => LEStudioCutout.state().error || {})).code, 'memory');
  h.assert(/Not enough memory/.test(await page.textContent('#sx-panel-body')), 'Memory message missing');
  h.assert.equal(JSON.stringify(await h.doc(page)), before);
  h.assert.noErrors(page, [/ERR_INTERNET_DISCONNECTED|Failed to load resource/]);
};

cases['phone: one tap, refine with the brush, no sideways scroll at 360 px'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'small', 'people-07');
  await page.tap('.sxc-tb');
  await page.waitForSelector('.sxc-go');
  await page.waitForTimeout(500);
  h.assert(await h.noOverflow(page), 'Sideways scroll on the intro');
  const go = await page.$('.sxc-go');
  const gb = await go.boundingBox();
  h.assert(gb.height >= 44 && gb.y + gb.height <= 740, 'Gold button should be visible and 44px: ' + JSON.stringify(gb));
  await page.tap('.sxc-go');
  await page.waitForFunction(() => LEStudio.scene.layers().some((x) => x.cutout), null, { timeout: 60000 });
  await page.waitForSelector('.sxc-refine');
  h.assert(await h.noOverflow(page), 'Sideways scroll after the cut-out');
  await page.tap('.sxc-refine');
  await page.waitForSelector('.sxc-brush');
  const bar = await page.evaluate(() => {
    const t = document.getElementById('sx-tool');
    const btns = [...t.querySelectorAll('button, input')].filter((b) => b.offsetParent);
    const done = document.querySelector('.sxc-brushbar [data-cmd="cutDone"]').getBoundingClientRect();
    return { over: t.scrollWidth - t.clientWidth, small: btns.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.getAttribute('aria-label')), done: { w: done.width, h: done.height, right: done.right } };
  });
  h.assert(bar.over <= 1, 'Brush toolbar overflows by ' + bar.over + 'px');
  h.assert(bar.done.h >= 44 && bar.done.right <= 360, 'Done not reachable: ' + JSON.stringify(bar.done));
  /* A finger stroke across the photo erases; Done commits. */
  const box = await page.evaluate(() => { const r = LEStudio.scene.screenRect(LEStudio.one().id); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const client = await page.context().newCDPSession(page);
  const tp = (type, pts) => client.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await tp('touchStart', [{ x: box.x - 40, y: box.y }]);
  for (let i = 1; i <= 8; i++) await tp('touchMove', [{ x: box.x - 40 + i * 10, y: box.y }]);
  await tp('touchEnd', []);
  h.assert((await page.evaluate(() => LEStudioCutout.state().brush.undo)) >= 1, 'Touch stroke not recorded');
  /* Two fingers zoom instead of painting. */
  const z0 = await page.evaluate(() => LEStudio.scene.view().zoom);
  await tp('touchStart', [{ x: box.x - 30, y: box.y, id: 1 }, { x: box.x + 30, y: box.y, id: 2 }]);
  await tp('touchMove', [{ x: box.x - 70, y: box.y, id: 1 }, { x: box.x + 70, y: box.y, id: 2 }]);
  await tp('touchEnd', []);
  h.assert((await page.evaluate(() => LEStudio.scene.view().zoom)) > z0 * 1.3, 'Pinch did not zoom');
  h.assert.equal(await page.evaluate(() => LEStudioCutout.state().brush.undo), 1, 'Pinch should not paint');
  await page.tap('.sxc-brushbar [data-cmd="cutDone"]');
  await page.waitForFunction(() => !document.querySelector('.sxc-brush'));
  h.assert(await h.noOverflow(page), 'Sideways scroll after refine');
  h.assert.noErrors(page);
};

cases['a second file can add options to the chooser through the registry'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'arch-01');
  await page.evaluate(() => {
    (window.LE_BGREMOVE_MODELS = window.LE_BGREMOVE_MODELS || []).push({ id: 'test-pro', label: 'Finest edges', bestFor: 'Best for hair and fur', quality: 3, speed: 'slow', downloadMB: 120,
      example: '', supportId: 'cutout.test-pro', tier: 'pro', runtime: 'webgpu', path: 'assets/models/none.onnx', bytes: 120000000, memoryMB: 2500, about: { model: 'Test model', licence: 'MIT' } });
    LEStudio.openPanel('cutout');
  });
  await page.click('.sxc-other > summary');
  await page.waitForSelector('.sxc-opt[data-model="test-pro"]');
  const r = await page.evaluate(() => ({
    text: document.querySelector('.sxc-opt[data-model="test-pro"]').textContent,
    rec: LEStudioCutout.state().recommended,
    defs: (window.LE_SUPPORT_DEFS || []).filter((d) => /^cutout\./.test(d.id)).map((d) => d.id)
  }));
  h.assert(/Finest edges/.test(r.text) && /Best for hair and fur/.test(r.text) && /Takes a while/.test(r.text) && /123 MB, one time|120 MB, one time/.test(r.text), 'Card text: ' + r.text);
  h.assert.equal(r.rec, 'u2netp');
  h.assert(['cutout.fast', 'cutout.detailed', 'cutout.people', 'cutout.test-pro'].every((id) => r.defs.indexOf(id) >= 0), 'Support defs: ' + r.defs.join(','));
  h.assert.noErrors(page);
};

module.exports = cases;
