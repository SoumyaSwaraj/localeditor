'use strict';
/* Cross-module wiring added at integration (12 November 2026): device-support gates on starts that existed before
   LE.support, the toolbar-add hook from several modules, and photo pickers that never offer working masks. */
const cases = {};

const ready = (page) => page.waitForFunction(() => window.LE && LE.support && LE.support.version);

cases['toolbar-add: every module contributes to the photo toolbar (redact and a second module)'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => {
    const hooks = window.LEStudioPanels._hooks;
    (hooks['toolbar-add'] = hooks['toolbar-add'] || []).push((c, kind) => (kind === 'image' ? '<button type="button" class="sx-tb" data-cmd="wiringTest" aria-label="Wiring test">W</button>' : ''));
    const c = window.LEStudio;
    const img = c.scene.layers().find((l) => l.type === 'image');
    c.scene.select([img.id]);
    c.renderToolbar();
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ redact: !!document.querySelector('#sx-tool [data-cmd="redactStart"]'), mine: !!document.querySelector('#sx-tool [data-cmd="wiringTest"]') }));
  h.assert(r.redact, 'the redact module still adds its button');
  h.assert(r.mine, 'a second module adds its button too');
  h.assert.noErrors(page);
};

cases['photo pickers never offer a cut-out mask (ctx.isUserPhoto; collage builder and stock-free uploads)'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async () => {
    const c = window.LEStudio;
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    cv.getContext('2d').fillRect(0, 0, 64, 64);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    const mask = await LE.project.putAsset({ blob, name: 'background-removal-mask.png', type: 'image/png', width: 64, height: 64 });
    c.mem[mask.id] = { meta: mask, canvas: cv }; c.scene.addAsset(mask.id, cv); c.S.project.assets[mask.id] = mask;
    /* A mask that does not follow the naming convention is still recognised by its use in layer.cutout. */
    const cv2 = document.createElement('canvas'); cv2.width = 32; cv2.height = 32; cv2.getContext('2d').fillRect(0, 0, 9, 9);
    const blob2 = await new Promise((res) => cv2.toBlob(res, 'image/png'));
    const odd = await LE.project.putAsset({ blob: blob2, name: 'edge.png', type: 'image/png', width: 32, height: 32 });
    c.mem[odd.id] = { meta: odd, canvas: cv2 }; c.scene.addAsset(odd.id, cv2); c.S.project.assets[odd.id] = odd;
    const img = c.scene.layers().find((l) => l.type === 'image');
    c.scene.update(img.id, { cutout: { asset: odd.id, model: 'manual', enabled: true } });
    const photos = Object.keys(c.S.project.assets).filter((id) => c.isUserPhoto(id));
    c.openPanel('apps', { app: 'collage' });
    await new Promise((res) => setTimeout(res, 600));
    const tiles = [...document.querySelectorAll('#sx-panel-body .sx-cl-ptile')].map((t) => t.getAttribute('data-id'));
    return { mask: mask.id, odd: odd.id, photo: img.src, photos, tiles };
  });
  h.assert(r.photos.includes(r.photo), 'the real photo is a user photo');
  h.assert(!r.photos.includes(r.mask), 'a background-* mask is not');
  h.assert(!r.photos.includes(r.odd), 'an asset used as layer.cutout.asset is not');
  h.assert(r.tiles.length > 0, 'the collage picker shows photos');
  h.assert(!r.tiles.includes(r.mask) && !r.tiles.includes(r.odd), 'the collage picker shows no mask: ' + JSON.stringify(r.tiles));
  h.assert.noErrors(page);
};

cases['large photo: invisible when ok; when not, LE.support explains and "Not now" leaves nothing behind'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 6000, 4000);
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await ready(page);
  /* Not ok: a device that cannot hold very large canvases. */
  await page.evaluate(() => { LE.support.forget(); LE.support.override('canvas-max-area', false); });
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc.setFiles(file);
  await page.waitForSelector('dialog.ls-gate[open]', { timeout: 30000 });
  h.assert(/large photo/i.test(await page.textContent('dialog.ls-gate h2')), 'titled for the large photo');
  await page.click('dialog.ls-gate [data-ls-cancel]');
  await page.waitForTimeout(600);
  h.assert(!(await page.evaluate(() => window.LEStudio.S.project)), 'nothing opened');
  h.assert.equal(await page.evaluate(() => Object.keys(window.LEStudio.S.mem).length), 0, 'no photo kept in memory');
  /* Ok again: it opens with no sheet, and the success is remembered. */
  await page.evaluate(() => LE.support.override('canvas-max-area'));
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc2.setFiles(file);
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1, null, { timeout: 40000 });
  h.assert.equal(await page.$('dialog.ls-gate[open]'), null, 'no sheet when ok');
  const hist = await page.evaluate(() => LE.support.history('studio.large-photos'));
  h.assert(hist && hist.ok, 'success recorded');
  h.assert.noErrors(page);
};

cases['multi-page PDF export runs straight through when ok; PDF studio open explains a limit, then Continue opens'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await ready(page);
  await page.evaluate(() => { LE.support.forget(); window.LEStudio.addPage(true); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { Object.assign(window.LEStudio.S.exportOpts, { format: 'pdf', pages: 'all', scale: 1 }); window.LEStudio.openPanel('export', { tab: 'image' }); });
  await page.waitForTimeout(250);
  const f = await h.capture(page, () => page.click('#sx-panel-body .sxe-actions [data-act="download"]'), 40000);
  h.assert(f.buf.slice(0, 5).toString() === '%PDF-', 'a PDF');
  h.assert.equal((await h.pdfRead(browser, base, f.buf)).pages, 2, 'both pages');
  h.assert.equal(await page.$('dialog.ls-gate[open]'), null, 'no sheet');
  h.assert(await page.evaluate(() => (LE.support.history('studio.pdf-export') || {}).ok), 'PDF export success recorded');
  await page.evaluate(() => window.LEStudio.lsSet('le-studio-export', { format: 'png', quality: 0.92, scale: 1, transparent: false, pages: 'current' }));
  h.assert.noErrors(page);

  const ps = await h.open(browser, base, '/pdf-studio/', 'desktop');
  await ready(ps);
  /* Limited (no background workers): the sheet explains, Continue opens the file. */
  await ps.evaluate(() => { LE.support.forget(); LE.support.override('worker', false); });
  const [fc] = await Promise.all([ps.waitForEvent('filechooser'), ps.locator('button', { hasText: 'Open a PDF' }).first().click()]);
  await fc.setFiles(h.FIXTURE('sample.pdf'));
  await ps.waitForSelector('dialog.ls-gate[open]', { timeout: 15000 });
  await ps.click('dialog.ls-gate [data-ls-run]');
  await ps.waitForSelector('.ps-save', { state: 'visible', timeout: 20000 });
  h.assert(await ps.evaluate(() => (LE.support.history('pdf.open') || {}).ok), 'PDF open success recorded');
  await ps.evaluate(() => LE.support.override('worker'));
  h.assert.noErrors(ps);
};

cases['phone 360 px: the remover is icon-only, so Filters stays on the photo toolbar'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'small');
  await page.evaluate(() => {
    const c = window.LEStudio;
    const img = c.scene.layers().find((l) => l.type === 'image');
    c.scene.select([img.id]);
    c.renderToolbar();
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const vis = (sel) => { const b = document.querySelector('#sx-tool ' + sel); return !!(b && !b.hidden && b.offsetParent && b.getBoundingClientRect().right <= innerWidth + 1); };
    const cut = document.querySelector('#sx-tool .sxc-tb');
    return { filters: vis('[data-cmd="filters"]'), cut: vis('.sxc-tb'), text: cut ? cut.textContent.trim() : null, label: cut && cut.getAttribute('aria-label') };
  });
  h.assert(r.filters, 'Filters is on the toolbar at 360 px: ' + JSON.stringify(r));
  h.assert(r.cut && r.text === '' && /Remove background/.test(r.label), 'remover button is icon-only with its name in aria-label: ' + JSON.stringify(r));
  h.assert.noErrors(page);
};

cases['first-run coach marks never show while agent mode is on'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.waitForSelector('.sx-coach.is-on', { timeout: 8000 });
  /* Agent mode turns on (?agent=1 → the person allows): the visible mark goes, and no later mark appears. */
  await page.evaluate(() => { const done = LEAgent.begin({ name: 'Test agent', task: 'Coach check', wait: 4000 }); window.__begin = done; });
  await page.waitForSelector('.sxa-ask [data-yes], .sxa-sheet [data-yes], [data-yes]', { timeout: 8000 });
  await page.click('[data-yes]');
  await page.evaluate(() => window.__begin);
  await page.waitForFunction(() => document.documentElement.classList.contains('sxa-on'), null, { timeout: 8000 });
  await page.waitForTimeout(300);
  h.assert.equal(await page.locator('.sx-coach.is-on').count(), 0, 'the mark is hidden when agent mode turns on');
  const shown = await page.evaluate(async () => { for (const i of [0, 1, 2]) window.LEStudio.coach(i); await new Promise((r) => setTimeout(r, 400)); return document.querySelectorAll('.sx-coach.is-on').length; });
  h.assert.equal(shown, 0, 'no coach mark while agent mode is on');
  h.assert.noErrors(page);
};

cases['agent page ids live on the pages: they survive the person deleting and reordering pages in the studio'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.waitForFunction(() => window.LEAgent && window.LEStudio && window.LEStudio.S.project);
  await page.evaluate(() => window.LEStudio.coach('off'));
  const p = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'Page ids' }));
  await page.click('.sxa-ask [data-yes]');
  h.assert((await p).ok, 'session started');
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  const r = await page.evaluate(() => LEAgent.apply([{ op: 'page.add', id: 'two', layers: [] }, { op: 'page.add', id: 'three', layers: [] }]));
  h.assert(r.ok, 'pages added: ' + JSON.stringify(r.errors));
  const ids = () => page.evaluate(async () => (await LEAgent.state()).pages.map((x) => x.id || '-').join(','));
  const start = await ids();
  h.assert(/two,three$/.test(start), 'ids after add: ' + start);
  /* The person deletes the first page and moves "three" to the front in the studio. */
  await page.evaluate(() => { const c = window.LEStudio, pr = c.S.project; c.deletePage(0); c.syncProject(); const pg = pr.pages.splice(1, 1)[0]; pr.pages.splice(0, 0, pg); c.loadPage(0); c.syncProject(); });
  h.assert.equal(await ids(), 'three,two', 'ids follow their pages');
  const saved = await page.evaluate(() => JSON.parse(LE.design.stringify(window.LEStudio.S.project).text).pages.map((x) => x.id || '-').join(','));
  h.assert.equal(saved, 'three,two', 'and are written to the design file');
  h.assert.noErrors(page);
};

module.exports = cases;
