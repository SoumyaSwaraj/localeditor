/* QA desktop layout check (not part of the regression run): 1440x900, 1366x768, 1280x720, 1280x560 (and 1024x600 as a stress case).
 * Prints layout measurements and writes screenshots. Usage: node tests/qa/desktop-walk.js [outDir] */
'use strict';
const path = require('path');
const fs = require('fs');
const h = require('../lib/harness');
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/qa';
fs.mkdirSync(OUT, { recursive: true });
const SIZES = [[1440, 900], [1366, 768], [1280, 720], [1280, 560], [1024, 600]];

async function measure(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) }; };
    const rail = q('#sx-rail'); const railBtns = [...rail.querySelectorAll('button')];
    const hiddenRail = railBtns.filter((b) => { const x = b.getBoundingClientRect(); return x.bottom > innerHeight + 1 || x.top < 0; }).map((b) => b.dataset.panelBtn);
    const tool = q('#sx-tool');
    const toolBtns = [...tool.querySelectorAll('button')].filter((b) => b.offsetParent);
    const clippedTool = toolBtns.filter((b) => { const x = b.getBoundingClientRect(); const t = tool.getBoundingClientRect(); return x.right > t.right + 1 || x.left < t.left - 1; }).map((b) => b.dataset.cmd);
    const head = q('#sx-head'); const headBtns = [...head.querySelectorAll('button')].filter((b) => b.offsetParent);
    const clippedHead = headBtns.filter((b) => { const x = b.getBoundingClientRect(); return x.right > innerWidth + 1; }).map((b) => b.dataset.cmd);
    const panel = q('#sx-panel'); const pb = q('#sx-panel-body');
    const foot = q('#sx-foot'); const footBtns = [...foot.querySelectorAll('button')].filter((b) => b.offsetParent);
    const clippedFoot = footBtns.filter((b) => { const x = b.getBoundingClientRect(); return x.right > innerWidth + 1 || x.bottom > innerHeight + 1; }).map((b) => b.dataset.cmd);
    const stage = q('#sx-stage');
    const small = [...document.querySelectorAll('#sx-head button, #sx-tool button, #sx-foot button, #sx-rail button')].filter((b) => b.offsetParent).filter((b) => { const x = b.getBoundingClientRect(); return x.width < 36 || x.height < 36; }).map((b) => (b.dataset.cmd || b.dataset.panelBtn) + ':' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    return {
      vw: innerWidth, vh: innerHeight, overflowX: document.documentElement.scrollWidth - innerWidth, overflowY: document.documentElement.scrollHeight - innerHeight,
      rail: r(rail), railScroll: rail.scrollHeight - rail.clientHeight, hiddenRail, toolbar: r(tool), toolbarScroll: tool.scrollWidth - tool.clientWidth, clippedTool,
      head: r(head), clippedHead, panel: panel.hidden ? null : r(panel), panelBodyScroll: pb ? pb.scrollHeight - pb.clientHeight : null, foot: r(foot), clippedFoot,
      stage: r(stage), small
    };
  });
}

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  for (const [w, hh] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hh }, serviceWorkers: 'block', colorScheme: 'light' });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
    await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.sx-size-card');
    const tag = w + 'x' + hh;
    await page.screenshot({ path: path.join(OUT, 'desk-' + tag + '-0-start.png') });
    const start = await page.evaluate(() => { const s = document.getElementById('sx-start'); const first = document.querySelector('.sx-start-inner'); const open = document.querySelector('[data-s=open]').getBoundingClientRect(); const cards = document.querySelector('.sx-size-row'); const cr = cards && cards.getBoundingClientRect(); return { scrollH: s.scrollHeight, clientH: s.clientHeight, openBtnBottom: Math.round(open.bottom), cardsTop: cr && Math.round(cr.top), vh: innerHeight, canScroll: getComputedStyle(s).overflowY }; });
    console.log(tag, 'start screen', JSON.stringify(start));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
    await fc.setFiles(h.PHOTO(0));
    await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'desk-' + tag + '-1-photo.png') });
    console.log(tag, 'photo selected, no panel', JSON.stringify(await measure(page)));
    await h.openPanel(page, 'design', { tab: 'resize' });
    await page.screenshot({ path: path.join(OUT, 'desk-' + tag + '-2-design.png') });
    console.log(tag, 'design panel', JSON.stringify(await measure(page)));
    await h.openPanel(page, 'adjust');
    await page.screenshot({ path: path.join(OUT, 'desk-' + tag + '-3-adjust.png') });
    await h.addLayers(page, [{ type: 'text', text: 'Hello', x: 60, y: 60, w: 300, h: 90, size: 60 }]);
    await h.select(page, [(await h.layers(page)).slice(-1)[0].id]);
    await h.openPanel(page, 'text');
    await page.screenshot({ path: path.join(OUT, 'desk-' + tag + '-4-text.png') });
    const m = await measure(page);
    console.log(tag, 'text selected + text panel', JSON.stringify({ clippedTool: m.clippedTool, toolbarScroll: m.toolbarScroll, clippedHead: m.clippedHead, clippedFoot: m.clippedFoot, stage: m.stage, small: m.small }));
    await h.openPanel(page, 'export');
    await page.screenshot({ path: path.join(OUT, 'desk-' + tag + '-5-export.png') });
    const ex = await page.evaluate(() => { const b = document.querySelector('#sx-panel-body .btn-gold.btn-lg'); const r = b && b.getBoundingClientRect(); const pb = document.getElementById('sx-panel-body').getBoundingClientRect(); return { downloadBtnBottom: r && Math.round(r.bottom), panelBottom: Math.round(pb.bottom), vh: innerHeight, visibleWithoutScroll: r && r.bottom <= pb.bottom }; });
    console.log(tag, 'export panel', JSON.stringify(ex));
    console.log(tag, 'console errors', page.errors.length);
    await ctx.close();
  }
  await browser.close(); server.close();
})();
