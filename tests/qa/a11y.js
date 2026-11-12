/* QA accessibility pass (not part of the regression run): keyboard-only walk, Esc behaviour, missing names and roles, computed contrast in both themes.
 * Usage: node tests/qa/a11y.js   -> prints JSON for docs/QA-REPORT.md */
'use strict';
const h = require('../lib/harness');

const CONTRAST = () => {
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  function bgOf(el) {
    const stack = [];
    let gradient = null;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !gradient) { const g = cs.backgroundImage.match(/rgba?\([^)]+\)/g); if (g) gradient = g.map(parse); }
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    if (!stack.length || stack[stack.length - 1].a < 1) base = parse(getComputedStyle(document.documentElement).backgroundColor) || base;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return { bg: base, gradient };
  }
  const targets = [
    ['.sx-start h1', 'start headline'], ['.sx-start-inner p', 'start paragraph'], ['.sx-size-card b', 'size card title'], ['.sx-size-card small', 'size card subtitle'],
    ['.sx-hero-drop', 'start hint'], ['.sx-eyebrow', 'eyebrow'], ['[data-s=open]', 'gold primary'], ['[data-s=sample]', 'ghost button'],
    ['.sx-rail-btn .sx-rail-lb', 'rail label'], ['.sx-brand-txt em', 'brand sub'], ['#sx-name', 'design name'], ['.sx-save', 'save status'],
    ['.sx-download', 'download button'], ['.sx-footbtn', 'footer button'], ['.sx-panel-head h2, .sx-panel-head strong', 'panel title'], ['.sx-note', 'panel note'],
    ['.sx-sec h3', 'section title'], ['.sx-seg button', 'segmented control'], ['.sx-tb', 'toolbar button'], ['.sx-link', 'text link']
  ];
  const out = [];
  targets.forEach(([sel, label]) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent && (e.innerText || '').trim());
    if (!el) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); const { bg, gradient } = bgOf(el);
    const worst = (g) => { let w = 21; (g || [bg]).forEach((c) => { const b = c.a < 1 ? over(c, bg) : c; const f = over(fg, b); const l1 = lum(f), l2 = lum(b); w = Math.min(w, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)); }); return w; };
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    const r = worst(gradient);
    out.push({ label, sel, text: (el.innerText || '').trim().slice(0, 24), size, ratio: Math.round(r * 100) / 100, need, pass: r >= need, gradient: !!gradient });
  });
  return out;
};

async function describe(page) {
  return page.evaluate(() => {
    const a = document.activeElement; if (!a || a === document.body) return null;
    const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
    return { tag: a.tagName.toLowerCase(), id: a.id || '', cmd: a.dataset.cmd || a.dataset.panelBtn || '', name: (a.getAttribute('aria-label') || a.innerText || a.getAttribute('title') || a.value || '').trim().slice(0, 28), ring: !!ring, visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth, ow: cs.outlineWidth, ostyle: cs.outlineStyle, shadow: (cs.boxShadow || '').slice(0, 40) };
  });
}

async function names(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0;
    const nameOf = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') && (document.getElementById(e.getAttribute('aria-labelledby')) || {}).innerText || e.innerText || e.getAttribute('title') || e.getAttribute('alt') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('placeholder') || '').trim();
    const res = { unnamedButtons: [], unnamedInputs: [], imgNoAlt: [], badAriaLabel: [], pressedAndLabelToggle: [], dialogsWithoutLabel: [], tabsWithoutPanelRole: 0, landmarks: [] };
    document.querySelectorAll('button, [role=button]').forEach((e) => { if (vis(e) && !nameOf(e)) res.unnamedButtons.push(e.className.toString().slice(0, 40) + ' ' + (e.dataset.cmd || '')); });
    document.querySelectorAll('input, select, textarea').forEach((e) => { if (vis(e) && e.type !== 'hidden' && !nameOf(e)) res.unnamedInputs.push(e.type + ' ' + e.className.toString().slice(0, 30)); });
    document.querySelectorAll('img').forEach((e) => { if (!e.hasAttribute('alt')) res.imgNoAlt.push(e.src.slice(-30)); });
    document.querySelectorAll('[aria-label]').forEach((e) => { if (/[<>]/.test(e.getAttribute('aria-label'))) res.badAriaLabel.push(e.getAttribute('aria-label')); });
    document.querySelectorAll('[aria-pressed][aria-label]').forEach((e) => { if (/^(Show|Hide|Lock|Unlock)\b/.test(e.getAttribute('aria-label'))) res.pressedAndLabelToggle.push(e.getAttribute('aria-label') + ' pressed=' + e.getAttribute('aria-pressed')); });
    document.querySelectorAll('[role=dialog]').forEach((e) => { if (!e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')) res.dialogsWithoutLabel.push(e.className); });
    res.tabsWithoutPanelRole = [...document.querySelectorAll('[role=tab]')].filter((t) => !t.getAttribute('aria-controls')).length;
    document.querySelectorAll('header, nav, main, aside, footer, [role=main], [role=navigation], [role=toolbar]').forEach((e) => res.landmarks.push(e.tagName.toLowerCase() + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : '')));
    res.canvasRole = [...document.querySelectorAll('canvas')].map((c) => (c.getAttribute('role') || '') + '/' + (c.getAttribute('aria-label') || '')).slice(0, 3);
    res.sceneFocusable = (document.getElementById('sx-scene').querySelector('[tabindex]') || document.getElementById('sx-scene')).getAttribute('tabindex');
    res.sceneLabel = ((document.querySelector('.le-scene') || {}).getAttribute || (() => null)).call(document.querySelector('.le-scene') || document.body, 'aria-label');
    return res;
  });
}

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const out = {};
  /* keyboard walk */
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.addLayers(page, [{ type: 'text', text: 'Hello', x: 100, y: 100, w: 500, h: 140, size: 90 }]);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await page.mouse.click(2, 2);
  const seq = [];
  for (let i = 0; i < 70; i++) { await page.keyboard.press('Tab'); const d = await describe(page); seq.push(d); }
  out.tabOrder = seq.filter(Boolean).map((d) => (d.cmd || d.id || d.tag) + ':' + d.name + (d.ring ? '' : ' [NO RING]') + (d.visible ? '' : ' [OFFSCREEN]'));
  out.noRing = seq.filter((d) => d && !d.ring).length;
  const uniq = new Set(seq.filter(Boolean).map((d) => d.tag + d.id + d.cmd + d.name));
  out.uniqueStops = uniq.size;
  /* reverse tab and reaching the canvas */
  await page.evaluate(() => document.getElementById('sx-scene') && document.querySelector('.le-scene') && document.querySelector('.le-scene').focus());
  out.sceneFocusable = await page.evaluate(() => document.activeElement && document.activeElement.className);
  /* Esc behaviour */
  const esc = {};
  await page.click('#sx-head [data-cmd=fileMenu]'); await page.waitForTimeout(200);
  esc.fileMenuOpen = await page.evaluate(() => !document.getElementById('sx-pop').hidden);
  esc.focusInsideMenu = await page.evaluate(() => document.getElementById('sx-pop').contains(document.activeElement));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  esc.fileMenuClosedByEsc = await page.evaluate(() => document.getElementById('sx-pop').hidden);
  esc.focusAfterMenu = (await describe(page) || {}).name || 'body';
  await h.openPanel(page, 'elements');
  await page.evaluate(() => document.querySelector('#sx-panel-body input').focus());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  esc.panelClosedByEscFromInput = await page.evaluate(() => document.getElementById('sx-panel').hidden);
  await page.keyboard.press('?'); await page.waitForTimeout(300);
  esc.shortcutsModalOpen = await page.evaluate(() => !document.getElementById('sx-modal').hidden);
  esc.modalFocusInside = await page.evaluate(() => document.getElementById('sx-modal').contains(document.activeElement));
  const tabs = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); tabs.push(await page.evaluate(() => document.getElementById('sx-modal').contains(document.activeElement))); }
  esc.modalTrapsFocus = tabs.every(Boolean);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  esc.modalClosedByEsc = await page.evaluate(() => document.getElementById('sx-modal').hidden);
  esc.focusAfterModal = (await describe(page) || {}).name || 'body';
  out.esc = esc;
  /* names and roles */
  await h.openPanel(page, 'layers', { tab: 'layers' });
  out.names = await names(page);
  for (const id of ['design', 'text', 'adjust', 'export', 'projects']) { await h.openPanel(page, id); const n = await names(page); out['names_' + id] = { unnamedButtons: n.unnamedButtons, unnamedInputs: n.unnamedInputs, imgNoAlt: n.imgNoAlt.length }; }
  await page.close();
  /* contrast */
  out.contrast = {};
  for (const theme of ['light', 'dark']) {
    const p = await h.openTheme(browser, base, '/studio/', 'desktop', theme);
    await p.waitForSelector('.sx-size-card');
    const start = await p.evaluate(CONTRAST);
    await p.locator('.sx-size-card').first().click();
    await p.waitForTimeout(300);
    await h.addLayers(p, [{ type: 'text', text: 'Hello', x: 100, y: 100, w: 500, h: 140, size: 90 }]);
    await h.select(p, (await h.layers(p)).map((l) => l.id));
    await h.openPanel(p, 'text');
    const edit = await p.evaluate(CONTRAST);
    out.contrast[theme] = { start: start.filter((x) => !x.pass), startAll: start.length, edit: edit.filter((x) => !x.pass), editAll: edit.length, sample: start.concat(edit).slice(0, 40).map((x) => x.label + ' ' + x.ratio) };
    await p.context().close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})();
