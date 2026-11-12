'use strict';
/* Export downloads (PNG/JPG/WebP/PDF), projects (autosave, reopen, .leproject round trip, versions, delete). */
const cases = {};

async function exportPage(browser, base, h, file) {
  const page = await h.openPhotoDesign(browser, base, 'desktop', file || h.PHOTO(0));
  return page;
}
async function download(page, h, format, scale) {
  await h.openPanel(page, 'export');
  await page.getByRole('button', { name: format, exact: true }).click();
  if (scale) await page.locator('.sx-chip', { hasText: new RegExp('^' + scale + '×') }).click();
  await page.waitForTimeout(150);
  return h.capture(page, () => page.locator('#sx-panel-body .btn-gold.btn-lg').click());
}

/* ---------- export ---------- */
cases['export PNG at 1x and 2x: a real PNG of the page size and double size'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  const d = await h.doc(page);
  const a = await download(page, h, 'PNG', '1');
  const ia = h.imageInfo(a.buf);
  h.assert(a.size > 2000 && /\.png$/.test(a.name), 'non-empty .png: ' + a.name + ' ' + a.size);
  h.assert(ia.type === 'png' && ia.w === d.width && ia.h === d.height, 'PNG dimensions ' + JSON.stringify(ia) + ' vs ' + d.width + 'x' + d.height);
  const b = await download(page, h, 'PNG', '2');
  const ib = h.imageInfo(b.buf);
  h.assert(ib.w === d.width * 2 && ib.h === d.height * 2, '2x PNG ' + JSON.stringify(ib));
  h.assert(b.size > a.size, '2x is larger on disk');
  h.assert.noErrors(page);
};
cases['export JPG: a real JPEG with the page dimensions'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  const d = await h.doc(page);
  const r = await download(page, h, 'JPG', '1');
  const i = h.imageInfo(r.buf);
  h.assert(/\.jpg$/.test(r.name), 'extension .jpg: ' + r.name);
  h.assert(i.type === 'jpeg' && i.w === d.width && i.h === d.height, 'JPEG ' + JSON.stringify(i));
  h.assert(r.size > 2000, 'non-empty');
};
cases['export WebP: a real WebP with the page dimensions'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  const d = await h.doc(page);
  const r = await download(page, h, 'WebP', '1');
  const i = h.imageInfo(r.buf);
  h.assert(/\.webp$/.test(r.name), 'extension .webp: ' + r.name);
  h.assert(i.type === 'webp' && i.w === d.width && i.h === d.height, 'WebP ' + JSON.stringify(i));
};
cases['export PDF: a one-page PDF whose page ratio matches the design'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  const d = await h.doc(page);
  const r = await download(page, h, 'PDF', '1');
  h.assert(/\.pdf$/.test(r.name) && r.buf.slice(0, 5).toString() === '%PDF-', 'PDF header, name ' + r.name);
  const info = await h.pdfRead(browser, base, r.buf);
  h.assert.equal(info.pages, 1, 'pages');
  const ratio = info.sizes[0][0] / info.sizes[0][1];
  h.assert(Math.abs(ratio - d.width / d.height) < 0.02, 'page ratio ' + ratio + ' vs ' + d.width / d.height);
};
cases['export a 3-page design as one PDF with 3 pages, and as a ZIP of images'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  await page.evaluate(() => { window.LEStudio.addPage(true); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.LEStudio.addPage(true); });
  await page.waitForTimeout(400);
  await h.openPanel(page, 'export');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await page.getByText(/All 3 pages/).click();
  const r = await h.capture(page, () => page.locator('#sx-panel-body .btn-gold.btn-lg').click(), 60000);
  const info = await h.pdfRead(browser, base, r.buf);
  h.assert.equal(info.pages, 3, 'PDF has 3 pages');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.getByText(/All 3 pages/).click();
  const z = await h.capture(page, () => page.locator('#sx-panel-body .btn-gold.btn-lg').click(), 60000);
  h.assert(/\.zip$/.test(z.name) && z.buf.slice(0, 2).toString() === 'PK', 'a zip: ' + z.name);
  h.assert((z.buf.toString('latin1').match(/-page-\d\.png/g) || []).length >= 3, 'three page images inside the zip');
};
cases['Ctrl+E opens the export panel and the estimate line shows size and weight'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 'e', { ctrl: true });
  await page.waitForSelector('#sx-panel:not([hidden])');
  await page.waitForFunction(() => /\d+ × \d+ px/.test(document.getElementById('sx-panel-body').innerText), null, { timeout: 8000 });
  const t = await page.innerText('#sx-panel-body');
  h.assert(/ESTIMATED/i.test(t) && /\d+ × \d+ px/.test(t), 'estimate shown: ' + t.slice(0, 140));
};
cases['the Download button in the header opens Export and a download works'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  await page.click('#sx-head .sx-download');
  await page.waitForSelector('#sx-panel-body .btn-gold.btn-lg');
  const r = await h.capture(page, () => page.locator('#sx-panel-body .btn-gold.btn-lg').click());
  h.assert(r.size > 1000, 'something downloaded');
};
cases['export file name field sets the downloaded name'] = async ({ browser, base, h }) => {
  const page = await exportPage(browser, base, h);
  await h.openPanel(page, 'export');
  await page.locator('#sx-panel-body input.sx-input[maxlength="80"]').fill('my launch post');
  const r = await h.capture(page, () => page.locator('#sx-panel-body .btn-gold.btn-lg').click());
  h.assert(/^my[-_ ]launch[-_ ]post\.png$/i.test(r.name), 'name ' + r.name);
};

/* ---------- projects ---------- */
async function projectPage(browser, base, h) {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(1));
  await h.addLayers(page, [{ type: 'text', text: 'Saved text', x: 40, y: 40, w: 300, h: 80, size: 50, color: '#E0668E' }]);
  await page.waitForTimeout(300);
  return page;
}
cases['autosave: a project appears in the list, and reloading the page restores the same document'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  const before = await h.doc(page);
  const list = await h.savedProjects(page);
  h.assert.equal(list.length, 1, 'one saved project');
  h.assert(list[0].width === before.width && list[0].height === before.height && list[0].pages === 1, 'ledger entry ' + JSON.stringify(list[0]));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.S.project, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  h.assert(h.sameDoc(before, await h.doc(page)), 'document identical after reload');
  h.assert(await page.locator('#sx-start').isHidden(), 'start screen skipped');
  h.assert.noErrors(page);
};
cases['the start screen lists saved designs and clicking one reopens it identically'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  const before = await h.doc(page);
  await h.savedProjects(page);
  await page.evaluate(() => window.LEStudio.cmd('newDesign'));
  await page.waitForSelector('#sx-start:not([hidden])');
  await page.waitForSelector('.sx-start-recent:not([hidden]) .sx-proj-row button', { timeout: 8000 });
  await page.locator('.sx-proj-row button').first().click();
  await page.waitForFunction(() => document.getElementById('sx-start').hidden);
  await page.waitForTimeout(700);
  h.assert(h.sameDoc(before, await h.doc(page)), 'identical after reopening from the list');
};
cases['Your designs panel: duplicate a design'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  await h.savedProjects(page);
  await h.openPanel(page, 'projects');
  await page.click('.sx-proj-more');
  await page.locator('#sx-pop button', { hasText: 'Duplicate' }).click();
  await page.waitForTimeout(800);
  h.assert.equal((await page.evaluate(() => window.LE.project.list())).length, 2, 'two projects after duplicate');
};
cases['.leproject export then import gives back the same document'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  const before = await h.doc(page);
  await h.openPanel(page, 'projects');
  const f = await h.capture(page, () => page.getByRole('button', { name: 'Export this design' }).click());
  h.assert(/\.leproject$/.test(f.name) && f.buf.slice(0, 2).toString() === 'PK', 'a zip named .leproject: ' + f.name);
  h.assert(f.size > 2000, 'non-empty');
  // start from a clean state, then import the file through the real chooser
  await page.evaluate(() => window.LEStudio.cmd('newDesign'));
  await page.waitForSelector('#sx-start:not([hidden])');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=import]')]);
  await fc.setFiles({ name: f.name, mimeType: 'application/zip', buffer: f.buf });
  await page.waitForFunction(() => window.LEStudio.S.project && window.LEStudio.scene.layers().length === 2, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const after = await h.doc(page);
  h.assert(h.sameDoc(before, after), 'round trip equals the original: ' + JSON.stringify(after).slice(0, 200));
  h.assert.noErrors(page);
};
cases['version history: save a version, change the design, restore it'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  const v1 = await h.doc(page);
  await h.openPanel(page, 'history');
  await page.locator('input[aria-label="Version name"]').fill('Before the big change');
  await page.getByRole('button', { name: 'Save version' }).click();
  await page.waitForSelector('.sx-version:has-text("Before the big change")', { timeout: 8000 });
  await h.addLayers(page, [{ type: 'shape', shape: 'ellipse', x: 200, y: 200, w: 200, h: 200 }]);
  h.assert.equal((await h.doc(page)).layers.length, 3, 'changed after the snapshot');
  await page.locator('.sx-version', { hasText: 'Before the big change' }).click();
  await page.waitForSelector('#sx-bar [data-cmd=versionRestore]', { timeout: 8000 });
  h.assert.equal((await h.doc(page)).layers.length, 2, 'preview shows the old version');
  await page.click('#sx-bar [data-cmd=versionRestore]');
  await page.waitForTimeout(800);
  const now = await h.doc(page);
  h.assert(h.sameDoc(v1, now), 'restored document equals the version');
};
cases['version preview Cancel returns to the current design untouched'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  await h.openPanel(page, 'history');
  await page.getByRole('button', { name: 'Save version' }).click();
  await page.waitForSelector('.sx-version', { timeout: 8000 });
  await h.addLayers(page, [{ type: 'shape', shape: 'ellipse', x: 200, y: 200, w: 200, h: 200 }]);
  const cur = await h.doc(page);
  await page.locator('.sx-version').first().click();
  await page.waitForSelector('#sx-bar [data-cmd=versionCancel]', { timeout: 8000 });
  await page.click('#sx-bar [data-cmd=versionCancel]');
  await page.waitForTimeout(500);
  h.assert(h.sameDoc(cur, await h.doc(page)), 'cancel keeps the current document');
};
cases['delete a design from Your designs removes it from the list'] = async ({ browser, base, h }) => {
  const page = await projectPage(browser, base, h);
  await h.savedProjects(page);
  await h.openPanel(page, 'projects');
  await page.click('.sx-proj-more');
  await page.locator('#sx-pop button', { hasText: 'Delete' }).click();
  const confirm = page.locator('#sx-modal button', { hasText: /Delete/ });
  await confirm.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => confirm.first().click(), () => {});
  await page.waitForFunction(() => window.LE.project.list().then((l) => l.length === 0), null, { timeout: 8000 });
  h.assert.equal((await page.evaluate(() => window.LE.project.list())).length, 0, 'gone from the ledger');
};
cases['import of a corrupt .leproject shows a message and does not crash the studio'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=import]')]);
  await fc.setFiles({ name: 'broken.leproject', mimeType: 'application/zip', buffer: Buffer.from('this is not a zip file at all') });
  await page.waitForTimeout(1200);
  h.assert(await page.evaluate(() => !!window.LEStudio.scene), 'studio still alive');
  const t = await page.textContent('#sx-toast');
  h.assert(t && t.trim().length > 0, 'a message is shown: ' + t);
  h.assert(!(await page.evaluate(() => window.LEStudio.S.project)), 'no half-open project');
};

/* large photos */
cases['a large (4000x3000) photo opens, keeps its shape and exports as a valid PNG'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 4000, 3000);
  const page = await h.openPhotoDesign(browser, base, 'desktop', file);
  const d = await h.doc(page);
  h.assert(d.width >= 1000 && d.width / d.height > 1.3 && d.width / d.height < 1.36, 'page keeps the 4:3 shape: ' + d.width + 'x' + d.height);
  const r = await download(page, h, 'PNG', '1');
  const i = h.imageInfo(r.buf);
  h.assert(i.type === 'png' && i.w === d.width && i.h === d.height, 'export matches the page ' + JSON.stringify(i));
  h.assert.noErrors(page);
};
cases['KNOWN-BUG: a 4000x3000 photo exported at 1x keeps its original pixel size (QA-015: it is cut to 2400x1800 on opening)'] = async ({ browser, base, h }) => {
  const file = await h.makeJpeg(browser, base, 4000, 3000);
  const page = await h.openPhotoDesign(browser, base, 'desktop', file);
  const r = await download(page, h, 'PNG', '1');
  const i = h.imageInfo(r.buf);
  h.assert(i.w >= 4000 && i.h >= 3000, 'exported ' + i.w + 'x' + i.h + ' from a 4000x3000 original');
};
module.exports = cases;
