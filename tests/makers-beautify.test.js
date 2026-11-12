'use strict';
/* Screenshot and code beautifier (roadmap 2.8): valid documents, options change the right layers, the highlighter,
   paste into the form, "Hide something", remake in one undo step, phone sizes, nothing fetched from outside. */

async function studio(h, browser, base, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  page.outside = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) page.outside.push(u); });
  await page.waitForFunction(() => window.LEStudio && window.LEStudioMakers && window.LE.makers);
  await page.evaluate(() => LE.makers.ready());
  return page;
}
/* A 1280×800 "screenshot" canvas and a sample photo, keyed like the studio passes them. */
const images = (page) => page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
  const g = c.getContext('2d'); g.fillStyle = '#F2F4F7'; g.fillRect(0, 0, 1280, 800); g.fillStyle = '#2C7BE5'; g.fillRect(0, 0, 1280, 90); g.fillStyle = '#E94F37'; g.fillRect(80, 160, 500, 300);
  const b = await (await fetch('/assets/photos/collage/screen-01.jpg')).blob();
  const bm = await createImageBitmap(b); const s = document.createElement('canvas'); s.width = bm.width; s.height = bm.height; s.getContext('2d').drawImage(bm, 0, 0);
  window.__imgs = { shot1: c, 'sample:screen-01': s };
});
/* Lint with the open-format linter, and a write/read round trip through the .ledesign.json text. */
const lintIn = `async (pg) => {
  const assets = {};
  pg.layers.forEach((l) => { if (l.type === 'image' && l.src) assets[l.src] = { id: l.src, type: 'image/jpeg', name: l.src + '.jpg', width: 1280, height: 800 }; });
  const project = { name: 'Test', pages: [pg], assets, activePage: 0 };
  const warnings = LE.design.lint(project).filter((w) => w.kind !== 'missing-image');
  let roundTrip = null;
  try { const t = LE.design.stringify(project, { images: 'ids' }); const p = await LE.design.parse(t.text); roundTrip = { ok: p.ok, errors: p.errors.slice(0, 3), layers: p.project && p.project.pages[0].layers.length }; } catch (e) { roundTrip = { ok: false, errors: [e.message] }; }
  return { warnings, roundTrip, problems: LE.makers.check(pg) };
}`;

const cases = {};

cases['every style and size makes a valid document (open-format lint, round trip, maker check)'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await images(page);
  const r = await page.evaluate(async (lintSrc) => {
    const lint = eval(lintSrc);
    const out = [];
    const m = LE.makers.get('beautify');
    for (const st of m.styles) for (const sz of m.sizes) for (const mode of ['shot', 'code']) {
      const v = { mode, shot: 'shot1', code: 'const a = 1;\n// hi\nfunction f(x) { return x * 2; }', caption: 'New: a calmer home screen', title: 'app.js' };
      const b = await LE.makers.build('beautify', v, { style: st.id, size: sz.id, images: window.__imgs });
      const pg = b.pages[0];
      const L = await lint(pg);
      out.push({ key: st.id + '/' + sz.id + '/' + mode, w: pg.width, h: pg.height, sz, warnings: L.warnings.map((w) => w.kind + ' ' + w.message), rt: L.roundTrip, problems: L.problems.map((p) => p.kind + ' ' + p.message), maker: pg.maker });
    }
    return out;
  }, lintIn);
  h.assert(r.length === 5 * 4 * 2, 'built ' + r.length);
  r.forEach((x) => {
    h.assert(x.w === x.sz.w && x.h === x.sz.h, x.key + ' size');
    h.assert(!x.warnings.length, x.key + ' lint: ' + x.warnings.slice(0, 2).join(' | '));
    h.assert(x.rt && x.rt.ok && x.rt.layers > 0, x.key + ' round trip: ' + JSON.stringify(x.rt));
    h.assert(!x.problems.length, x.key + ' check: ' + x.problems.slice(0, 2).join(' | '));
    h.assert(x.maker && x.maker.id === 'beautify' && x.maker.values.mode, x.key + ' doc.maker');
  });
  h.assert.noErrors(page);
  h.assert(!page.outside.length, 'outside requests: ' + page.outside.slice(0, 3).join(', '));
};

cases['options change the right layers'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await images(page);
  const r = await page.evaluate(async () => {
    const B = (v, o) => LE.makers.build('beautify', Object.assign({ mode: 'shot', shot: 'shot1' }, v), Object.assign({ style: 'gradient', size: 'square', images: window.__imgs }, o || {})).then((b) => b.pages[0]);
    const ids = (pg) => pg.layers.map((l) => l.id);
    const L = (pg, id) => pg.layers.find((l) => l.id === id);
    const browserF = await B({ frame: 'browser', title: 'example.org' });
    const none = await B({ frame: 'none' });
    const phone = await B({ frame: 'phone' });
    const tablet = await B({ frame: 'tablet' });
    const desktop = await B({ frame: 'desktop', title: 'Notes' });
    const dark = await B({ frame: 'browser', theme: 'dark' });
    const round = await B({ frame: 'none', corners: 'round' });
    const square = await B({ frame: 'none', corners: 'square' });
    const flat = await B({ frame: 'none', shadow: 'none' });
    const deep = await B({ frame: 'none', shadow: 'deep' });
    const small = await B({ frame: 'none', padding: 'small' });
    const large = await B({ frame: 'none', padding: 'large' });
    const ocean = await B({ palette: 'ocean' });
    const own = await B({ color: '#2A9D8F' });
    const match = await B({}, { style: 'match' });
    const plain = await B({ palette: 'mint' }, { style: 'plain' });
    const glow = await B({}, { style: 'glow' });
    const dots = await B({}, { style: 'dots' });
    const cap = await B({ caption: 'Ship it' });
    return {
      browser: ids(browserF), address: L(browserF, 'address') && L(browserF, 'address').text,
      none: ids(none), noneShot: L(none, 'screenshot'),
      phone: ids(phone), phoneShot: L(phone, 'screenshot'), tablet: ids(tablet), desktopTitle: L(desktop, 'window-title') && L(desktop, 'window-title').text, desktopIds: ids(desktop),
      lightWin: L(browserF, 'window').fill.color, darkWin: L(dark, 'window').fill.color,
      round: L(round, 'screenshot').radius, square: L(square, 'screenshot').radius,
      flat: L(flat, 'screenshot').shadow, soft: L(none, 'screenshot').shadow, deep: ids(deep),
      smallW: L(small, 'screenshot').w, largeW: L(large, 'screenshot').w,
      dusk: JSON.stringify(browserF.background), ocean: JSON.stringify(ocean.background), own: JSON.stringify(own.background), match: JSON.stringify(match.background),
      plain: plain.background, glow: ids(glow), dots: ids(dots), cap: L(cap, 'headline'), capShot: L(cap, 'window').y, noCapShot: L(browserF, 'window').y,
      shotAspect: L(none, 'screenshot').w / L(none, 'screenshot').h, crop: L(none, 'screenshot').crop
    };
  });
  h.assert(r.browser.includes('address-bar') && r.browser.includes('nav') && r.browser.includes('window'), 'browser frame: ' + r.browser);
  h.assert.equal(r.address, 'example.org');
  h.assert(!r.none.includes('window') && r.noneShot && r.noneShot.slot, 'no frame: just the screenshot slot');
  h.assert(r.phone.includes('device') && r.phone.includes('camera') && !r.phone.includes('address-bar'), 'phone frame');
  h.assert(r.phoneShot.radius > 0, 'phone screen has round corners');
  h.assert(r.tablet.includes('device') && r.tablet.includes('camera'), 'tablet frame');
  h.assert(r.desktopTitle === 'Notes' && !r.desktopIds.includes('address-bar'), 'desktop window has a title, no address bar');
  h.assert(r.lightWin !== r.darkWin, 'window theme changes the chrome');
  h.assert(r.round > r.square && r.square === 0, 'corners: ' + r.round + ' / ' + r.square);
  h.assert(r.flat === null && r.soft && r.soft.blur > 0, 'shadow none / soft');
  h.assert(r.deep.some((id) => /ambient/.test(id)), 'deep shadow adds an ambient layer');
  h.assert(r.smallW > r.largeW, 'more space around makes the screenshot smaller');
  h.assert(r.dusk !== r.ocean && r.dusk !== r.own && r.match !== r.dusk, 'backdrop colours follow palette, own colour and the screenshot');
  h.assert(r.plain.type === 'color', 'plain is a solid backdrop');
  h.assert(r.glow.filter((id) => /^glow/.test(id)).length >= 3, 'soft glow has glow layers');
  h.assert(r.dots.includes('dots'), 'dot grid');
  h.assert(r.cap && r.cap.text === 'Ship it' && r.capShot > r.noCapShot, 'headline sits above and moves the window down');
  h.assert(Math.abs(r.shotAspect - 1.6) < 0.01 && r.crop.w === 1 && r.crop.h === 1, 'the screenshot keeps its shape, uncropped');
};

cases['code mode: the highlighter and one aligned text layer per colour'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const H = LE.makers.highlight;
    const cls = (code, lang, word) => { const out = []; H(code, lang).lines.forEach((ln) => ln.forEach((t) => { if (t.t.trim() === word) out.push(t.c); })); return out[0]; };
    const js = 'function greet(name) {\n  // hello\n  const n = 42;\n  return `Hi ${name}`;\n}';
    const det = {
      js: H(js).lang, py: H('def add(a, b):\n    return a + b\n\nprint(add(1, 2))').lang, html: H('<div class="a">Hi</div>').lang,
      json: H('{"a": 1, "b": [true, null]}').lang, sql: H('SELECT name FROM users WHERE id = 3;').lang, css: H('.card {\n  color: red;\n}').lang,
      sh: H('#!/bin/bash\necho "$HOME"').lang, go: H('package main\n\nfunc main() {}').lang, rust: H('fn main() {\n  let mut x = 1;\n}').lang
    };
    const tok = {
      fn: cls(js, 'js', 'function'), name: cls(js, 'js', 'greet'), comment: cls(js, 'js', '// hello'), num: cls(js, 'js', '42'), str: cls(js, 'js', '`Hi ${name}`'),
      pyKw: cls('def add(a):\n  return a', 'py', 'def'), pyCom: cls('x = 1  # note', 'py', '# note'),
      tag: cls('<div class="a">Hi</div>', 'html', 'div'), attr: cls('<div class="a">Hi</div>', 'html', 'class'), aval: cls('<div class="a">Hi</div>', 'html', '"a"'),
      key: cls('{"a": 1}', 'json', '"a"'), sqlKw: cls('select x from t', 'sql', 'select'), cssProp: cls('.a {\n  color: red;\n}', 'css', 'color')
    };
    const lines = H('a\n\n  b').lines.length;
    const b = await LE.makers.build('beautify', { mode: 'code', code: js, title: 'greet.js', theme: 'dark' }, { style: 'gradient', size: 'square' });
    const pg = b.pages[0];
    const code = pg.layers.filter((l) => /^code-/.test(l.id));
    const nums = pg.layers.find((l) => l.id === 'line-numbers');
    const grp = pg.layers.find((l) => l.id === 'code' && l.type === 'group');
    const b2 = await LE.makers.build('beautify', { mode: 'code', code: js, numbers: false, frame: 'none' }, { style: 'gradient', size: 'square' });
    const light = await LE.makers.build('beautify', { mode: 'code', code: js, theme: 'light' }, { style: 'gradient', size: 'square' });
    const long = await LE.makers.build('beautify', { mode: 'code', code: Array.from({ length: 40 }, (_, i) => '    const value' + i + ' = compute(' + 'x'.repeat(30) + ', ' + i + '); // a long line that wraps around the window').join('\n').slice(0, 2000) }, { style: 'plain', size: 'story' });
    const planes = code.map((l) => ({ id: l.id, x: l.x, y: l.y, size: l.size, lh: l.lineHeight, font: l.font, text: l.text, groupId: l.groupId, color: l.color }));
    return { det, tok, lines, planes, nums: nums && nums.text, grp: !!grp, title: (pg.layers.find((l) => l.id === 'window-title') || {}).text,
      noNums: !b2.pages[0].layers.some((l) => l.id === 'line-numbers'), noBar: !b2.pages[0].layers.some((l) => l.id === 'window-title' || l.id === 'title-rule'),
      lightBg: light.pages[0].layers.find((l) => l.id === 'window').fill.color, darkBg: pg.layers.find((l) => l.id === 'window').fill.color,
      problems: LE.makers.check(pg).concat(LE.makers.check(light.pages[0]), LE.makers.check(long.pages[0])).map((p) => p.message), longPlanes: long.pages[0].layers.filter((l) => /^code-/.test(l.id)).length };
  });
  h.assert.equal(JSON.stringify(r.det), JSON.stringify({ js: 'js', py: 'py', html: 'html', json: 'json', sql: 'sql', css: 'css', sh: 'sh', go: 'go', rust: 'rust' }), 'language detection');
  h.assert.equal(JSON.stringify(r.tok), JSON.stringify({ fn: 'keyword', name: 'func', comment: 'comment', num: 'number', str: 'string', pyKw: 'keyword', pyCom: 'comment', tag: 'keyword', attr: 'func', aval: 'string', key: 'func', sqlKw: 'keyword', cssProp: 'func' }), 'token classes');
  h.assert.equal(r.lines, 3, 'blank lines are kept');
  h.assert(r.planes.length >= 5, 'one layer per colour: ' + r.planes.map((p) => p.id));
  const p0 = r.planes[0];
  h.assert(r.planes.every((p) => p.x === p0.x && p.y === p0.y && p.size === p0.size && p.lh === p0.lh && p.font === 'JetBrains Mono'), 'colour layers share one grid');
  h.assert(r.planes.every((p) => p.groupId === 'code') && r.grp, 'grouped as Code');
  h.assert(new Set(r.planes.map((p) => p.color)).size === r.planes.length, 'each colour layer has its own colour');
  /* Columns line up: in each layer, a character sits at the same column as in the source line. */
  const kw = r.planes.find((p) => p.id === 'code-keyword').text.split('\n');
  h.assert(kw[0] === '​function', 'keyword row 1: ' + JSON.stringify(kw[0]));
  h.assert(kw[2] === '​  const', 'indent kept: ' + JSON.stringify(kw[2]));
  const nm = r.planes.find((p) => p.id === 'code-func').text.split('\n')[0];
  h.assert(nm === '​         greet', 'name at column 9: ' + JSON.stringify(nm));
  h.assert.equal(r.nums, '1\n2\n3\n4\n5');
  h.assert(r.title === 'greet.js', 'window title');
  h.assert(r.noNums && r.noBar, 'line numbers off and no title bar');
  h.assert(r.lightBg !== r.darkBg, 'light and dark themes');
  h.assert(r.longPlanes >= 3, 'long code still builds');
  h.assert(!r.problems.length, 'check: ' + r.problems.slice(0, 3).join(' | '));
};

async function openForm(page, values) {
  await page.evaluate((v) => LEStudioMakers.open('beautify', v ? { values: v } : {}), values || null);
  await page.waitForFunction(() => document.querySelector('.mk-render') && document.querySelector('.mkb-bar'));
}

cases['paste a screenshot or code into the form'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await openForm(page, { mode: 'shot', palette: 'ocean' });
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 600; c.getContext('2d').fillStyle = '#336699'; c.getContext('2d').fillRect(0, 0, 900, 600);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.querySelector('.mk-sheet').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForFunction(() => { const F = LEStudioMakers.form(); return F && F.values.shot && !/^sample:/.test(F.values.shot); });
  const shot = await page.evaluate(() => LEStudioMakers.form().values);
  h.assert(shot.mode === 'shot' && shot.palette === 'ocean', 'pasted image becomes the screenshot, other choices kept');
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'SELECT * FROM t;');
    document.querySelector('.mk-sheet').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForFunction(() => LEStudioMakers.form().values.mode === 'code');
  const code = await page.evaluate(() => ({ v: LEStudioMakers.form().values, area: document.querySelector('#mk-code').value }));
  h.assert(code.v.code === 'SELECT * FROM t;' && code.area === 'SELECT * FROM t;', 'pasted text becomes the code');
  /* Typing into a field pastes normally. */
  const typed = await page.evaluate(() => {
    const i = document.querySelector('.mk-field[data-key="title"] input'); i.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', 'x.sql');
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    i.dispatchEvent(e);
    return { prevented: e.defaultPrevented, code: LEStudioMakers.form().values.code };
  });
  h.assert(!typed.prevented && typed.code === 'SELECT * FROM t;', 'paste into a text field is left alone: ' + JSON.stringify(typed));
  await page.evaluate(() => LEStudioMakers.close());
  h.assert.noErrors(page);
};

cases['Hide something makes the design and opens the redact panel on the screenshot'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await openForm(page);
  await page.click('.mkb-hide');
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker && LEStudio.S.panel === 'redact', null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ sel: LEStudio.scene.selection ? LEStudio.scene.selection() : [], layers: LEStudio.scene.toJSON().layers.filter((l) => l.type === 'image').map((l) => l.id) }));
  h.assert(r.layers.length === 1, 'one screenshot');
  h.assert(JSON.stringify(r.sel).includes(r.layers[0]), 'screenshot selected: ' + JSON.stringify(r.sel));
  h.assert.noErrors(page);
};

cases['remake is one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await openForm(page, { mode: 'code', code: 'let a = 1;', frame: 'browser' });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker);
  await page.waitForTimeout(300);
  const before = await h.doc(page);
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForFunction(() => LEStudioMakers.form());
  await page.evaluate(() => { const F = LEStudioMakers.form(); F.values.code = 'let b = 2;\nlet c = 3;'; F.values.theme = 'dark'; F.style = 'glow'; });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker.style === 'glow');
  await page.waitForTimeout(300);
  const after = await h.doc(page);
  h.assert(after.maker.values.code === 'let b = 2;\nlet c = 3;' && after.maker.values.theme === 'dark', 'remade with the new values');
  h.assert(after.layers.some((l) => /^glow/.test(l.id)), 'new style layers');
  await page.evaluate(() => LEStudio.scene.undo());
  await page.waitForTimeout(200);
  const undone = await h.doc(page);
  h.assert(JSON.stringify(undone.layers) === JSON.stringify(before.layers) && undone.maker.style === before.maker.style && undone.maker.values.code === 'let a = 1;', 'one undo restores the previous make');
  await page.evaluate(() => LEStudio.scene.redo());
  await page.waitForTimeout(200);
  h.assert((await h.doc(page)).maker.style === 'glow', 'redo');
  h.assert.noErrors(page);
};

cases['form at 390 and 360 px: no sideways scroll, 44px targets, in the gallery and search'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studio(h, browser, base, vp);
    await page.evaluate(() => LEStudio.openPanel('apps', { app: 'make' }));
    await page.waitForFunction(() => document.querySelectorAll('.mk-grid .mk-card').length === LE.makers.list().length);
    await page.evaluate(() => { const i = document.querySelector('.mk-search input'); i.value = 'browser window'; i.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(300);
    const found = await page.evaluate(() => [...document.querySelectorAll('.mk-grid .mk-card')].map((n) => n.getAttribute('data-maker')));
    h.assert(found.includes('beautify'), 'search finds it: ' + found);
    await page.waitForFunction(() => { const t = document.querySelector('.mk-card[data-maker="beautify"] .mk-thumb'); return t && t.classList.contains('is-ready'); }, null, { timeout: 30000 });
    await page.click('.mk-card[data-maker="beautify"]');
    await page.waitForFunction(() => document.querySelector('.mk-render') && document.querySelector('.mkb-bar'));
    await page.waitForTimeout(300);
    h.assert(await h.noOverflow(page), vp + ' form overflow');
    const small = await page.evaluate(() => [...document.querySelectorAll('.mk-sheet button, .mk-sheet input:not([type=checkbox]), .mk-sheet select')]
      .filter((n) => n.offsetParent && Math.round(n.getBoundingClientRect().height) < 40 && !n.classList.contains('mk-ph-x') /* shared photo-remove chip, studio-makers.css */).map((n) => n.className || n.tagName));
    h.assert(!small.length, 'small targets: ' + small.slice(0, 4).join(','));
    h.assert.noErrors(page);
    h.assert(!page.outside.length, 'outside requests: ' + page.outside.slice(0, 3).join(', '));
    await page.context().close();
  }
};

module.exports = cases;
