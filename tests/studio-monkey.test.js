'use strict';
/* Seeded random action sequences: whatever the order of commands, the studio must not throw, log errors or write non-finite numbers into the document. */
const cases = {};
async function run(browser, base, h, seed, vp, steps) {
  const page = await h.openPhotoDesign(browser, base, vp, h.PHOTO(seed % 3));
  const p = page;
  let s = seed * 7919;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 8) % n; };
  const failures = [];
  const ops = [
    ['addText', () => p.evaluate(() => window.LEStudio.addText({ text: 'T' + Math.random(), size: 50 }))],
    ['addShape', () => p.evaluate(() => window.LEStudio.addShape(['rectangle', 'ellipse', 'triangle', 'star'][Math.floor(Math.random() * 4)]))],
    ['undo', () => p.evaluate(() => window.LEStudio.scene.undo())],
    ['redo', () => p.evaluate(() => window.LEStudio.scene.redo())],
    ['selectAll', () => p.evaluate(() => window.LEStudio.scene.select(window.LEStudio.scene.layers().map((l) => l.id)))],
    ['selectOne', () => p.evaluate(() => { const l = window.LEStudio.scene.layers(); if (l.length) window.LEStudio.scene.select([l[Math.floor(Math.random() * l.length)].id]); })],
    ['group', () => p.evaluate(() => window.LEStudio.cmd('group'))],
    ['ungroup', () => p.evaluate(() => window.LEStudio.cmd('ungroup'))],
    ['dup', () => p.evaluate(() => window.LEStudio.cmd('dup'))],
    ['del', () => p.evaluate(() => window.LEStudio.cmd('del'))],
    ['flipH', () => p.evaluate(() => window.LEStudio.cmd('flipH'))],
    ['rot90', () => p.evaluate(() => window.LEStudio.cmd('rot90'))],
    ['alignL', () => p.evaluate(() => window.LEStudio.cmd('align2:left'))],
    ['order', () => p.evaluate(() => window.LEStudio.cmd('order:back'))],
    ['lock', () => p.evaluate(() => window.LEStudio.cmd('lock'))],
    ['panel', () => p.evaluate(() => window.LEStudio.openPanel(['design', 'elements', 'text', 'adjust', 'filters', 'layers', 'effects', 'export', 'projects', 'background'][Math.floor(Math.random() * 10)], {}))],
    ['closePanel', () => p.evaluate(() => window.LEStudio.closePanel())],
    ['zoom', () => p.evaluate(() => window.LEStudio.cmd(Math.random() > 0.5 ? 'zoomIn' : 'zoomOut'))],
    ['fit', () => p.evaluate(() => window.LEStudio.cmd('fit'))],
    ['addPage', () => p.evaluate(() => window.LEStudio.addPage(Math.random() > 0.5))],
    ['switchPage', () => p.evaluate(() => { const n = window.LEStudio.S.project.pages.length; window.LEStudio.switchPage(Math.floor(Math.random() * n)); })],
    ['delPage', () => p.evaluate(() => { const S = window.LEStudio.S; if (S.project.pages.length > 1) window.LEStudio.deletePage(S.project.activePage); })],
    ['crop', () => p.evaluate(() => window.LEStudio.cmd('crop'))],
    ['esc', () => p.keyboard.press('Escape')],
    ['resize', () => p.evaluate(() => window.LEStudio.scene.resizePage(600 + Math.floor(Math.random() * 800), 600 + Math.floor(Math.random() * 800)))]
  ];
  for (let i = 0; i < steps; i++) {
    const [name, fn] = ops[rnd(ops.length)];
    try { await fn(); } catch (e) { failures.push(name + ': ' + e.message.split('\n')[0].slice(0, 80)); }
    await p.waitForTimeout(30);
  }
  await p.waitForTimeout(800);
  const bad = await p.evaluate(() => { const d = window.LEStudio.scene.toJSON(); const walk = (o) => { for (const k in o) { const v = o[k]; if (typeof v === 'number' && !isFinite(v)) return k; if (v && typeof v === 'object') { const r = walk(v); if (r) return r; } } return null; }; return walk(d); });
  h.assert(failures.length === 0, 'commands threw: ' + failures.slice(0, 3).join(' | '));
  h.assert(!bad, 'non-finite number in the document at ' + bad);
  h.assert.noErrors(page);
}
cases['random commands (seed 1, desktop, 70 steps) never throw or corrupt the document'] = ({ browser, base, h }) => run(browser, base, h, 1, 'desktop', 70);
cases['random commands (seed 2, desktop, 70 steps) never throw or corrupt the document'] = ({ browser, base, h }) => run(browser, base, h, 2, 'desktop', 70);
cases['random commands (seed 3, phone, 70 steps) never throw or corrupt the document'] = ({ browser, base, h }) => run(browser, base, h, 3, 'phone', 70);
module.exports = cases;
