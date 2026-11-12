'use strict';
/* Homepage: clean console, no sideways scroll, one primary action, a working tool directory,
   dark ink on gold, and the shell entry points other engineers wire up. */
const cases = {};
const SIZES = ['desktop', 'phone', 'small'];
const GOLD_INK = 'rgb(42, 31, 10)'; /* #2A1F0A */

SIZES.forEach((vp) => {
  ['light', 'dark'].forEach((theme) => {
    cases[vp + ' ' + theme + ': no console errors, no sideways scroll'] = async ({ browser, base, h }) => {
      const page = await h.open(browser, base, '/', vp, { colorScheme: theme });
      await page.waitForTimeout(300);
      h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme, 'Theme follows the system');
      h.assert.noErrors(page);
      h.assert(await h.noOverflow(page), 'Page scrolls sideways');
      const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').map((i) => i.src));
      h.assert(!broken.length, 'Broken images: ' + broken.join(', '));
    };
  });
});

cases['primary call to action opens the studio'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'phone');
  const hero = await page.evaluate(() => {
    const golds = [...document.querySelectorAll('.hp-hero .btn-gold')];
    return { count: golds.length, href: golds[0] && golds[0].href, h1: document.querySelectorAll('h1').length };
  });
  h.assert.equal(hero.count, 1, 'One gold action in the hero');
  h.assert.equal(hero.href, base + '/studio/', 'Primary action links to the studio');
  h.assert.equal(hero.h1, 1, 'One h1');
  h.assert.noErrors(page);
};

cases['tool search and chips filter the directory'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'desktop');
  const visible = () => page.evaluate(() => [...document.querySelectorAll('[data-tool-dir] .hp-tool')].filter((a) => a.offsetParent !== null).map((a) => a.querySelector('b').textContent));
  const all = await visible();
  h.assert(all.length >= 30, 'Directory lists every tool, got ' + all.length);
  await page.fill('[data-dir-search]', 'merge');
  let shown = await visible();
  h.assert(shown.includes('Merge PDF'), 'Search finds Merge PDF');
  h.assert(shown.length < all.length && shown.length <= 4, 'Search narrows the list, got ' + shown.length);
  await page.fill('[data-dir-search]', 'zzzz no such tool');
  h.assert.equal((await visible()).length, 0, 'Nonsense matches nothing');
  h.assert(await page.isVisible('[data-dir-empty]'), 'Empty state shows');
  await page.fill('[data-dir-search]', '');
  await page.click('[data-dir-cat="pdf"]');
  shown = await visible();
  h.assert(shown.length === 8 && shown.includes('Split PDF'), 'PDF chip shows the 8 PDF tools, got ' + shown.length);
  h.assert.equal(await page.getAttribute('[data-dir-cat="pdf"]', 'aria-pressed'), 'true');
  h.assert.noErrors(page);
};

cases['gold buttons use dark ink in both themes'] = async ({ browser, base, h }) => {
  for (const theme of ['light', 'dark']) {
    const page = await h.open(browser, base, '/', 'desktop', { colorScheme: theme });
    const inks = await page.evaluate(() => [...document.querySelectorAll('.btn-gold')].filter((b) => b.offsetParent !== null).map((b) => getComputedStyle(b).color));
    h.assert(inks.length >= 2, 'Gold buttons found');
    inks.forEach((c) => h.assert.equal(c, GOLD_INK, theme + ' gold ink'));
    await page.context().close();
  }
};

cases['shell: menu, search, install and storage entry points'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'small');
  h.assert(await page.$('.le-side [data-le-install]'), 'Install entry in the menu');
  h.assert(await page.$('.le-side [data-le-storage]'), 'Storage entry in the menu');
  await page.click('.le-top [data-menu]');
  await page.waitForTimeout(400);
  h.assert(await page.isVisible('.le-side a[href="studio/"]'), 'Menu opens');
  const box = await page.locator('.le-side a.item').first().boundingBox();
  h.assert(box.height >= 44, 'Menu rows are at least 44px tall');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  h.assert(!(await page.isVisible('.le-side a[href="studio/"]')), 'Escape closes the menu');
  await page.click('.le-top [data-search]');
  await page.keyboard.type('split');
  h.assert(await page.isVisible('.le-dialog a[href="split-pdf/"]'), 'Search finds Split PDF');
  h.assert.noErrors(page);
};

module.exports = cases;
