'use strict';
/* Background remover lab: the bundled u2netp model cuts a subject out of a pool photo, in a worker, with a clean console. */
const path = require('path');
const cases = {};

cases['lab loads nothing until asked'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/bg-remove/index.html', 'desktop');
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  h.assert(!urls.some((u) => /\.wasm|ort[.-]|bg-worker/.test(u)), 'Runtime fetched before the user asked: ' + urls.join(', '));
  h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), false, 'Model cache created before the user asked');
  h.assert.equal(await page.evaluate(() => !!(window.LE && LE.bgRemove && LE.bgRemove.models().length > 0)), true);
  h.assert.noErrors(page);
};

cases['u2netp removes the background of a photo'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/bg-remove/index.html', 'desktop');
  await page.setInputFiles('#file', path.join(h.ROOT, 'assets', 'photos', 'collage', 'arch-01.jpg'));
  await page.waitForFunction(() => !document.getElementById('go').disabled);
  await page.selectOption('#model', 'u2netp');
  await page.selectOption('#refine', 'guided');
  await page.click('#go');
  await page.waitForFunction(() => window.__bgDone || window.__bgError, null, { timeout: 80000 });
  h.assert(!(await page.evaluate(() => window.__bgError)), 'Run failed: ' + (await page.evaluate(() => window.__bgError)));
  const share = await page.evaluate(() => {
    const c = document.getElementById('out'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let clear = 0, solid = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] < 10) clear++; else if (d[i] > 245) solid++; }
    return { clear: clear / (d.length / 4), solid: solid / (d.length / 4), w: c.width };
  });
  h.assert(share.clear > 0.05, 'Expected transparent pixels, got ' + share.clear);
  h.assert(share.solid > 0.02, 'Expected opaque pixels, got ' + share.solid);
  h.assert(await page.evaluate(() => LE.bgRemove.isLoaded() === 'u2netp'));
  await page.evaluate(() => LE.bgRemove.unload());
  h.assert.equal(await page.evaluate(() => LE.bgRemove.isLoaded()), null);
  h.assert.noErrors(page);
};

module.exports = cases;
