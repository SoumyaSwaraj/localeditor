'use strict';
/* Every main page loads with an empty console and no sideways scroll, at desktop and phone sizes. */
const PAGES = ['/', '/studio/', '/recipes/', '/pdf-studio/', '/convert-to-pdf/', '/image-compressor/', '/about/'];
const cases = {};
['desktop', 'phone'].forEach((vp) => {
  PAGES.forEach((url) => {
    cases[vp + ' ' + url] = async ({ browser, base, h }) => {
      const page = await h.open(browser, base, url, vp);
      await page.waitForTimeout(300);
      h.assert.noErrors(page);
      h.assert(await h.noOverflow(page), 'Page scrolls sideways');
    };
  });
});
cases['studio opens the sample and every rail panel'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  for (const id of ['design', 'elements', 'text', 'uploads', 'draw', 'adjust', 'filters', 'background', 'layers', 'recipes', 'projects', 'apps']) {
    await h.openPanel(page, id);
    const empty = await page.evaluate(() => document.getElementById('sx-panel-body').children.length === 0);
    h.assert(!empty, 'Panel "' + id + '" rendered nothing');
  }
  h.assert.noErrors(page);
};
module.exports = cases;
