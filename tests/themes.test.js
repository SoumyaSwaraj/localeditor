'use strict';
/* Light and dark: console stays empty, the primary action's text meets WCAG AA (4.5:1) against its own background
   (computed style; .btn-gold is the old name of .btn-primary), the theme toggle flips and persists. */
const cases = {};
const h0 = require('./lib/harness');

const primaryInks = (page) => h0.inkContrast(page, '.btn-primary:not(:disabled), .btn-gold:not(:disabled)');
const wrong = (list) => list.filter((g) => g.ratio < 4.5);

['light', 'dark'].forEach((theme) => {
  cases[theme + ': home page has no console errors and a primary call to action'] = async ({ browser, base, h }) => {
    const page = await h.openTheme(browser, base, '/', 'desktop', theme);
    await page.waitForTimeout(400);
    h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme, 'theme applied');
    h.assert.noErrors(page);
    h.assert((await primaryInks(page)).length >= 1, 'a primary button exists on the home page');
  };
  cases[theme + ': home page primary buttons meet AA contrast (4.5:1) by computed style'] = async ({ browser, base, h }) => {
    const page = await h.openTheme(browser, base, '/', 'desktop', theme);
    await page.waitForTimeout(400);
    const g = await primaryInks(page);
    h.assert(g.length >= 1, 'a primary button exists on the home page');
    h.assert(wrong(g).length === 0, 'primary buttons under 4.5:1: ' + JSON.stringify(wrong(g)));
  };
  cases[theme + ': studio start screen and an open design have no console errors, primary buttons meet AA'] = async ({ browser, base, h }) => {
    const page = await h.openTheme(browser, base, '/studio/', 'desktop', theme);
    await page.waitForSelector('.sx-size-card');
    let g = await primaryInks(page);
    h.assert(g.length >= 1 && wrong(g).length === 0, 'start screen primary: ' + JSON.stringify(wrong(g)));
    await page.click('.sx-size-card');
    await page.waitForFunction(() => document.getElementById('sx-start').hidden);
    await h.addPhoto(page, h.PHOTO(0));
    for (const id of ['design', 'elements', 'text', 'adjust', 'filters', 'layers', 'projects', 'export']) {
      await h.openPanel(page, id);
      g = await primaryInks(page);
      h.assert(wrong(g).length === 0, id + ' panel primary buttons: ' + JSON.stringify(wrong(g)));
    }
    h.assert.noErrors(page);
  };
  cases[theme + ': studio dark/light surfaces: the workspace and panel backgrounds differ from the page text colour (readable)'] = async ({ browser, base, h }) => {
    const page = await h.openTheme(browser, base, '/studio/', 'desktop', theme);
    await page.waitForSelector('.sx-size-card');
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const r = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.sx-start h1')); const bg = getComputedStyle(document.body).backgroundColor; return { fg: s.color, bg }; });
    const L1 = lum(r.fg), L2 = lum(r.bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    h.assert(ratio >= 4.5, 'heading contrast ' + ratio.toFixed(2) + ' (' + r.fg + ' on ' + r.bg + ')');
    if (theme === 'dark') h.assert(lum(r.bg) < 0.2, 'dark theme has a dark body: ' + r.bg);
  };
  cases[theme + ': PDF studio, convert-to-pdf and a tool page load without errors, primary meets AA'] = async ({ browser, base, h }) => {
    for (const url of ['/pdf-studio/', '/convert-to-pdf/', '/json-formatter/']) {
      const page = await h.openTheme(browser, base, url, 'desktop', theme);
      await page.waitForTimeout(400);
      h.assert.noErrors(page);
      const g = await primaryInks(page);
      h.assert(wrong(g).length === 0, url + ' primary buttons: ' + JSON.stringify(wrong(g)));
      await page.context().close();
    }
  };
});

cases['theme toggle in the studio flips light/dark, repaints and remembers the choice after reload'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForSelector('.sx-size-card');
  await page.click('.sx-size-card');
  const t0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('#sx-head [data-theme-toggle]').first().click();
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg1 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  h.assert(t0 !== t1 && bg0 !== bg1, 'toggled: ' + t0 + ' -> ' + t1);
  await page.reload({ waitUntil: 'networkidle' });
  h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), t1, 'persisted after reload');
  h.assert.noErrors(page);
};
cases['dark studio: the scene workspace follows the theme (canvas pasteboard colour changes)'] = async ({ browser, base, h }) => {
  const a = await h.openTheme(browser, base, '/studio/', 'desktop', 'light');
  await a.waitForSelector('.sx-size-card'); await a.click('.sx-size-card');
  const wa = await a.evaluate(() => getComputedStyle(document.getElementById('sx-stage')).backgroundColor);
  const b = await h.openTheme(browser, base, '/studio/', 'desktop', 'dark');
  await b.waitForSelector('.sx-size-card'); await b.click('.sx-size-card');
  const wb = await b.evaluate(() => getComputedStyle(document.getElementById('sx-stage')).backgroundColor);
  h.assert(wa !== wb, 'stage background differs between themes: ' + wa + ' vs ' + wb);
};
module.exports = cases;
