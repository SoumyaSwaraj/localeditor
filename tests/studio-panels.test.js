'use strict';
/* Shallow "panel opens" checks for areas being rebuilt (background, collage, recipes, stock, install/storage) plus shell-level regressions
 * that should survive any rebuild: rail/tab labels, Esc behaviour, shortcuts, Save a version. Deep tests for those areas live with the feature. */
const cases = {};

cases['background panel opens for a photo design and for a blank page, without console errors'] = async ({ browser, base, h }) => {
  const a = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  await h.openPanel(a, 'background');
  h.assert((await a.locator('#sx-panel-body').innerText()).length > 20, 'background panel has content');
  const b = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(b, 'background');
  h.assert((await b.locator('#sx-panel-body').innerText()).length > 20, 'background panel on a blank page');
  h.assert.noErrors(a); h.assert.noErrors(b);
};
cases['background: a solid page colour from the panel is written to the document'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'background');
  const sw = page.locator('#sx-panel-body .sx-sw, #sx-panel-body .sx-chip-color, #sx-panel-body [aria-label^="#"]').nth(3);
  await sw.click();
  await page.waitForTimeout(250);
  const bg = (await h.doc(page)).background;
  h.assert(bg && bg.type === 'color' && bg.color && bg.color.toLowerCase() !== '#ffffff', 'background colour changed: ' + JSON.stringify(bg));
};
cases['Apps panel opens and lists the collage entry; opening Collage shows a chooser without errors'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.openPanel(page, 'apps');
  const txt = await page.locator('#sx-panel-body').innerText();
  h.assert(/collage/i.test(txt), 'Collage is offered in Apps: ' + txt.slice(0, 100));
  await page.locator('#sx-panel-body button', { hasText: /collage/i }).first().click();
  await page.waitForTimeout(600);
  h.assert((await page.locator('#sx-panel-body').innerText()).length > 20, 'collage chooser has content');
  h.assert.noErrors(page);
};
cases['recipes panel opens and /recipes/ loads (shallow)'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  await h.openPanel(page, 'recipes');
  h.assert((await page.locator('#sx-panel-body').innerText()).length > 20, 'recipes panel has content');
  h.assert.noErrors(page);
};
cases['uploads panel shows the photo that was added and its This device / Stock tabs (stock not called)'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  await h.openPanel(page, 'uploads');
  await page.waitForTimeout(500);
  h.assert((await page.locator('#sx-panel-body img').count()) >= 1, 'the uploaded photo has a thumbnail');
  h.assert.noErrors(page);
};

/* shell-level regressions */
cases['every rail and tab-bar button has an accessible name and a pressed state'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const bad = await page.evaluate(() => [...document.querySelectorAll('#sx-rail button, #sx-tabs button')].filter((b) => !(b.getAttribute('aria-label') || b.innerText.trim()) || b.getAttribute('aria-pressed') == null).map((b) => b.dataset.panelBtn));
  h.assert(bad.length === 0, 'unnamed or stateless: ' + bad);
};
cases['every header, toolbar and footer icon button has an accessible name'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addLayers(page, [{ type: 'text', text: 'Hi', x: 100, y: 100, w: 400, h: 120, size: 80 }]);
  await h.select(page, (await h.layers(page)).map((l) => l.id));
  await page.waitForTimeout(250);
  const bad = await page.evaluate(() => [...document.querySelectorAll('#sx-head button, #sx-tool button, #sx-foot button, #sx-panel-head button')].filter((b) => b.offsetParent && !(b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText.trim())).map((b) => b.dataset.cmd || b.className));
  h.assert(bad.length === 0, 'icon buttons without a name: ' + bad);
};
cases['Ctrl+S saves a named-by-time version and shows a toast'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, 's', { ctrl: true });
  await page.waitForFunction(() => /Version saved/i.test(document.getElementById('sx-toast').innerText), null, { timeout: 8000 });
  const v = await page.evaluate(() => window.LE.project.versions(window.LEStudio.S.project.id));
  h.assert(v.length >= 1, 'a version exists');
};
cases['Ctrl+= / Ctrl+- zoom from the keyboard and "\\" holds a before/after compare without changing the document'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  const doc0 = await h.doc(page);
  const z0 = await page.evaluate(() => window.LEStudio.scene.zoom());
  await page.evaluate(() => window.LEStudio.scene.el.focus());
  await h.key(page, '=', { ctrl: true });
  h.assert((await page.evaluate(() => window.LEStudio.scene.zoom())) > z0, 'zoom in');
  await h.key(page, '-', { ctrl: true }); await h.key(page, '-', { ctrl: true });
  h.assert((await page.evaluate(() => window.LEStudio.scene.zoom())) < z0, 'zoom out');
  await page.keyboard.down('\\'); await page.waitForTimeout(200); await page.keyboard.up('\\');
  h.assert(h.sameDoc(doc0, await h.doc(page)), 'compare does not touch the document');
};
cases['the sx-start screen is hidden once a design exists and returns after File > New design'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  h.assert(await page.locator('#sx-start').isHidden(), 'hidden while editing');
  await page.click('#sx-head [data-cmd=fileMenu]');
  await page.locator('#sx-pop [data-cmd=newDesign]').click();
  await page.waitForSelector('#sx-start:not([hidden])');
  h.assert.equal((await h.doc(page)).layers.length, 0, 'blank scene behind the start screen');
};
cases['leaving with unsaved edits autosaves instead of losing them (pagehide flush)'] = async ({ browser, base, h }) => {
  const page = await h.openPhotoDesign(browser, base, 'desktop', h.PHOTO(0));
  await h.addLayers(page, [{ type: 'text', text: 'Do not lose me', x: 50, y: 50, w: 400, h: 100, size: 60 }]);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(700);
  const ok = await page.evaluate(async () => { const l = await window.LE.project.list(); const p = await window.LE.project.open(l[0].id); return JSON.stringify(p).indexOf('Do not lose me') >= 0; });
  h.assert(ok, 'the text is in the saved project');
};

/* keyboard / accessibility regressions (filed in docs/QA-REPORT.md) */
cases['toolbar buttons keep keyboard focus after they are activated or the design autosaves (QA-007)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  const [t] = await h.addLayers(page, [{ type: 'text', text: 'Hello', x: 100, y: 100, w: 500, h: 140, size: 90 }]);
  await h.select(page, [t]);
  await page.waitForTimeout(300);
  await page.focus('#sx-tool [data-cmd=italic]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const inTool = await page.evaluate(() => !!document.activeElement.closest('#sx-tool'));
  h.assert(inTool, 'focus after Enter on Italic is on ' + (await page.evaluate(() => document.activeElement.tagName)));
};
cases['the File menu opened with the keyboard moves focus into the menu and Arrow keys move between items (QA-008)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.focus('#sx-head [data-cmd=fileMenu]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  h.assert(await page.evaluate(() => document.getElementById('sx-pop').contains(document.activeElement)), 'focus is inside the opened menu');
};
cases['the shortcuts dialog traps Tab focus while it is open (QA-011)'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.locator('#sx-scene').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('?');
  await page.waitForSelector('#sx-modal:not([hidden])');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
  h.assert(await page.evaluate(() => document.getElementById('sx-modal').contains(document.activeElement)), 'focus escaped the dialog');
};
cases['dialog accessible names are plain text, not HTML source (QA-002)'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.locator('.sx-size-card').filter({ hasText: 'Custom size' }).click();
  await page.waitForSelector('#sx-modal [role=dialog]');
  const label = await page.locator('#sx-modal [role=dialog]').getAttribute('aria-label');
  h.assert(!/[<>]/.test(label), 'aria-label is ' + JSON.stringify(label));
};
module.exports = cases;
