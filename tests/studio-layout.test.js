'use strict';
/* Desktop layout at the sizes people really have: 1440x900, 1366x768, 1280x720, 1280x560 (HANDOFF: never checked below 1024 wide x 900). */
const cases = {};
const SIZES = [[1440, 900], [1366, 768], [1280, 720], [1280, 560]];

async function studioAt(browser, base, h, w, hh) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(12000);
  await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sx-size-card');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc.setFiles(h.PHOTO(0));
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1);
  await page.waitForTimeout(400);
  return page;
}
const clipped = (page, sel) => page.evaluate((s) => { const box = document.querySelector(s).getBoundingClientRect(); return [...document.querySelectorAll(s + ' button')].filter((b) => b.offsetParent).filter((b) => { const r = b.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1; }).map((b) => b.dataset.cmd || b.dataset.panelBtn); }, sel);

SIZES.forEach(([w, hh]) => {
  const tag = w + 'x' + hh;
  cases[tag + ': shell fits the window (no page scroll), header and footer are complete, canvas stage has room'] = async ({ browser, base, h }) => {
    const page = await studioAt(browser, base, h, w, hh);
    for (const id of ['design', 'text', 'export', 'layers']) {
      await h.openPanel(page, id);
      const m = await page.evaluate(() => ({ ox: document.documentElement.scrollWidth - innerWidth, oy: document.documentElement.scrollHeight - innerHeight, stage: document.getElementById('sx-stage').getBoundingClientRect().height, stageW: document.getElementById('sx-stage').getBoundingClientRect().width }));
      h.assert(m.ox <= 1 && m.oy <= 1, id + ' panel: page scrolls (' + m.ox + ',' + m.oy + ')');
      h.assert(m.stage >= 300 && m.stageW >= 500, id + ' panel: canvas stage is ' + Math.round(m.stageW) + 'x' + Math.round(m.stage));
    }
    h.assert.equal((await clipped(page, '#sx-head')).length, 0, 'header buttons clipped');
    h.assert.equal((await clipped(page, '#sx-foot')).length, 0, 'footer buttons clipped');
    h.assert.noErrors(page);
  };
  cases[tag + ': the start screen scrolls to the size cards and the primary action is above the fold'] = async ({ browser, base, h }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: hh }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.sx-size-card');
    const m = await page.evaluate(() => ({ open: document.querySelector('[data-s=open]').getBoundingClientRect().bottom, vh: innerHeight, sc: getComputedStyle(document.getElementById('sx-start')).overflowY }));
    h.assert(m.open <= m.vh, 'Open a photo is visible without scrolling: bottom ' + Math.round(m.open) + ' of ' + m.vh);
    await page.locator('.sx-size-card').last().scrollIntoViewIfNeeded();
    h.assert(await page.locator('.sx-size-card').last().isVisible(), 'last size card reachable');
  };
  cases[tag + ': panel contents scroll inside the panel and the panel never exceeds the window'] = async ({ browser, base, h }) => {
    const page = await studioAt(browser, base, h, w, hh);
    await h.openPanel(page, 'design', { tab: 'resize' });
    /* Let the panel finish opening (its slide-in transform can overshoot the window for a frame under load). */
    await page.waitForFunction(() => document.getElementById('sx-panel').getBoundingClientRect().bottom <= innerHeight + 1, null, { timeout: 3000 }).catch(() => {});
    const m = await page.evaluate(() => { const p = document.getElementById('sx-panel').getBoundingClientRect(); const b = document.getElementById('sx-panel-body'); return { bottom: p.bottom, vh: innerHeight, scrolls: b.scrollHeight > b.clientHeight, ov: getComputedStyle(b).overflowY }; });
    h.assert(m.bottom <= m.vh + 1, 'panel bottom ' + m.bottom + ' > ' + m.vh);
    h.assert(!m.scrolls || /auto|scroll/.test(m.ov), 'long panel content scrolls');
  };
});

cases['1440x900 with text selected and a panel open, every toolbar button (lock, duplicate, delete) is visible without scrolling (QA-012)'] = async ({ browser, base, h }) => {
  const page = await studioAt(browser, base, h, 1440, 900);
  const [t] = await h.addLayers(page, [{ type: 'text', text: 'Hello', x: 60, y: 60, w: 300, h: 90, size: 60 }]);
  await h.select(page, [t]);
  await h.openPanel(page, 'text');
  const c = await clipped(page, '#sx-tool');
  h.assert(c.length === 0, 'toolbar buttons beyond the toolbar edge: ' + c);
  for (const cmd of ['lock', 'dup', 'del', 'more']) h.assert(await page.locator('#sx-tool [data-cmd=' + cmd + ']').isVisible(), cmd + ' is visible in the toolbar');
};
cases['1366x768 and 1280x720 show every rail tool, including Apps (Collage) and Projects, without scrolling the rail (QA-013)'] = async ({ browser, base, h }) => {
  for (const [w, hh] of [[1366, 768], [1280, 720]]) {
    const page = await studioAt(browser, base, h, w, hh);
    const c = await page.evaluate(() => [...document.querySelectorAll('#sx-rail button')].filter((b) => b.getBoundingClientRect().bottom > innerHeight).map((b) => b.dataset.panelBtn));
    h.assert(c.length === 0, w + 'x' + hh + ': rail tools below the fold: ' + c);
    await page.context().close();
  }
};
cases['1280x720 the Download button of the Export panel is visible without scrolling the panel (QA-014)'] = async ({ browser, base, h }) => {
  const page = await studioAt(browser, base, h, 1280, 720);
  await h.openPanel(page, 'export');
  const ok = await page.evaluate(() => { const b = document.querySelector('#sx-panel-body [data-act="download"], #sx-panel-body .btn-gold.btn-lg').getBoundingClientRect(); return b.bottom <= innerHeight; });
  h.assert(ok, 'Download button is below the fold');
};
module.exports = cases;
