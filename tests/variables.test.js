'use strict';
/* Template variables (roadmap 2.6): placeholders and pipes, the variable list, rename, round trips through the open
   format and projects, fill once in the studio (undo, export), lint, agents, lazy loading, phone sizes.
   Bulk create is in tests/bulk.test.js. */
const cases = {};

async function studio(browser, base, h, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.design && window.LE.varBoot);
  await page.evaluate(() => LE.varBoot.ready());
  return page;
}
const D = (pages, extra) => Object.assign({ format: 'localeditor-design', version: 1, name: 'V' }, extra || {}, { pages });

cases['placeholders and pipes: formats, unknown pipes literal, hostile input stays text'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(() => {
    const V = LE.variables;
    V.locale = 'en-US';
    const f = (t, v, o) => V.fillText(t, v, o).text;
    const out = {
      basic: f('Hello {{name}}!', { name: 'Ana' }),
      spaces: f('{{ name | upper }}', { name: 'ana' }),
      title: f('{{n|title}}', { n: "ana DE la cruz o'neil" }),
      num: f('{{c|number}} {{c|number:0}} {{c|number:2}}', { c: '1,234.567' }),
      cur: f('{{p|currency:INR}} {{q|currency:usd}}', { p: 899, q: '12.5' }),
      date: f('{{d|date:long}} · {{d|date:iso}} · {{d|date:year}} · {{e|date:short}}', { d: '12/11/2026', e: '2026-02-03' }),
      dflt: f('[{{x|default:—}}] [{{y|default:none}}]', { x: '' }),
      missingKeep: f('Hi {{who}}', {}),
      missingEmpty: f('Hi {{who}}.', {}, { missing: 'empty' }),
      counter: f('{{#}} of {{#total}}', { '#': 3, '#total': 40 }),
      unknown: V.fillText('{{a|shout}} {{a|currency:EURO}} {{a|date:fancy}}', { a: '5' }),
      notTokens: f('{{}} {{1abc}} {{a b}} {{{x}}}', { x: 'X' }),
      hostile: f('{{v}}', { v: '<img src=x onerror=alert(1)>{{v}}' }),
      formula: f('{{v}}', { v: '=HYPERLINK("http://x","y")' }),
      bool: f('{{b}}/{{c}}', { b: true, c: false }),
      nested: f('{{a}}', { a: '{{b}}', b: 'NO' }),
      long: f('{{a}}', { a: 'x'.repeat(5000) }).length,
      control: f('{{a}}', { a: 'a\u0000b\u0007c' }),
      tokens: V.tokens('A {{a}} B {{b|upper|default:x}} {{#}}').map((t) => t.key + ':' + t.pipes.map((p) => p.name).join('+')),
      toNumber: ['1.234,50', '₹ 1 200', '12%', '1,5', 'abc', '1,234'].map(V.toNumber),
      toDate: ['2026-11-12', '12/11/2026', '11/30/2026', '12 Nov 2026', 'Nov 12, 2026', '46338', '31/02/2026', 'soon'].map(V.toDate),
      hex: ['1f6feb', '#ABC', 'red', '#12345'].map(V.hexOf)
    };
    return out;
  });
  h.assert.equal(r.basic, 'Hello Ana!');
  h.assert.equal(r.spaces, 'ANA');
  h.assert.equal(r.title, "Ana De La Cruz O'Neil");
  h.assert.equal(r.num, '1,234.57 1,235 1,234.57', 'number shows up to 2 decimals unless asked');
  h.assert.equal(r.cur, '₹899 $12.50', 'currency: whole amounts drop .00');
  h.assert.equal(r.date, 'November 12, 2026 · 2026-11-12 · 2026 · 02/03/2026');
  h.assert.equal(r.dflt, '[—] [none]', 'default applies to empty and missing values');
  h.assert.equal(r.missingKeep, 'Hi {{who}}', 'a field without a value shows the token');
  h.assert.equal(r.missingEmpty, 'Hi .');
  h.assert.equal(r.counter, '3 of 40');
  h.assert.equal(r.unknown.text, '{{a|shout}} {{a|currency:EURO}} {{a|date:fancy}}', 'unknown pipes are drawn literally');
  h.assert.equal(r.unknown.unknown.length, 3, 'and reported');
  h.assert.equal(r.notTokens, '{{}} {{1abc}} {{a b}} {X}', 'non-fields stay text');
  h.assert.equal(r.hostile, '<img src=x onerror=alert(1)>{{v}}', 'values are text and never expanded again');
  h.assert.equal(r.formula, '=HYPERLINK("http://x","y")', 'formulas are never evaluated');
  h.assert.equal(r.bool, 'Yes/No');
  h.assert.equal(r.nested, '{{b}}');
  h.assert(r.long <= 4000, 'values are capped');
  h.assert.equal(r.control, 'abc', 'control characters are removed');
  h.assert.equal(r.tokens.join(' '), 'a: b:upper+default #:');
  h.assert.equal(JSON.stringify(r.toNumber), JSON.stringify([1234.5, 1200, 12, 1.5, null, 1234]), 'numbers as people type them: ' + JSON.stringify(r.toNumber));
  h.assert.equal(JSON.stringify(r.toDate), JSON.stringify(['2026-11-12', '2026-11-12', '2026-11-30', '2026-11-12', '2026-11-12', '2026-11-12', null, null]));
  h.assert.equal(JSON.stringify(r.hex), JSON.stringify(['#1F6FEB', '#AABBCC', null, null]));
  h.assert.noErrors(page);
};

cases['model: detection, definitions, rename everywhere, keys from labels'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(() => {
    const V = LE.variables;
    const pages = [
      { values: { name: 'Ana', photo_x: 'a' }, layers: [{ id: 't', type: 'text', text: 'Dear {{name|title}}, {{price|currency:INR}} on {{when|date:long}}' }, { id: 'i', type: 'image', bind: { content: 'photo' } }, { id: 's', type: 'shape', bind: { color: 'brand', show: '!hidden' } }] },
      { layers: [{ id: 't2', type: 'text', text: '{{name}} again' }, { id: 'q', type: 'svg', bind: { content: 'url' } }] }
    ];
    const defs = V.definitions({ pages, meta: { studio: { variables: [{ key: 'name', label: 'Full name', type: 'text', required: true }, { key: 'old', label: 'Old' }] } } });
    const n = V.renamePages(pages, 'name', 'first_name');
    return {
      defs: defs.map((d) => d.key + ':' + d.type + ':' + (d.label || '') + ':' + d.uses.length + (d.unused ? ':unused' : '') + (d.required ? ':req' : '')),
      n, t: pages[0].layers[0].text, t2: pages[1].layers[0].text, v: Object.keys(pages[0].values).join(','),
      neg: (() => { const p = [{ layers: [{ id: 'x', type: 'shape', bind: { show: '!vip' } }] }]; V.renamePages(p, 'vip', 'gold'); return p[0].layers[0].bind.show; })(),
      key: [V.keyFrom('First name', []), V.keyFrom('First name', ['first_name']), V.keyFrom('123 go', []), V.keyFrom('Ünïcödé!', [])]
    };
  });
  h.assert.equal(r.defs.join(' | '), 'name:text:Full name:2:req | old:text:Old:0:unused | price:number:Price:1 | when:date:When:1 | photo:image:Photo:1 | brand:colour:Brand:1 | hidden:boolean:Hidden:1 | url:url:Url:1');
  h.assert.equal(r.n, 2);
  h.assert.equal(r.t, 'Dear {{first_name|title}}, {{price|currency:INR}} on {{when|date:long}}', 'pipes are kept');
  h.assert.equal(r.t2, '{{first_name}} again');
  h.assert.equal(r.v, 'first_name,photo_x', 'values follow the rename');
  h.assert.equal(r.neg, '!gold');
  h.assert.equal(r.key.join(' '), 'first_name first_name_2 f_123_go unicode');
  h.assert.noErrors(page);
};

cases['format: variables, values, bindings, overflow and print round-trip byte-stable; projects keep them'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (text) => {
    const a = await LE.design.parse(text);
    if (!a.ok) return { errors: a.errors };
    const t1 = LE.design.stringify(a.project).text;
    const b = await LE.design.parse(t1);
    const t2 = LE.design.stringify(b.project).text;
    const P = a.project;
    const v = LE.project.validate(JSON.parse(JSON.stringify(P)));
    const bad = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, values: { 'a b': 1 }, variables: [{ key: 'x', type: 'money' }], pages: [{ width: 100, height: 100, values: { n: { o: 1 } }, layers: [{ id: 't', type: 'text', text: 'x', overflow: 'squash', bind: { content: 'x' } }] }] }));
    const scr = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, values: { n: '<script>alert(1)</script>' }, pages: [{ width: 100, height: 100, layers: [] }] }));
    return {
      t1, stable: t1 === t2, vars: P.meta.studio.variables, values: P.pages.map((p) => p.values), l: P.pages[0].layers.map((l) => [l.id, l.bind || null, l.overflow || null, l.minSize || null]),
      print: P.pages[0].print, kept: v.ok && JSON.stringify(v.project.pages.map((p) => p.values)) === JSON.stringify(P.pages.map((p) => p.values)) && JSON.stringify(v.project.pages[0].layers.map((l) => l.bind || null)) === JSON.stringify(P.pages[0].layers.map((l) => l.bind || null)) && JSON.stringify(v.project.meta.studio.variables) === JSON.stringify(P.meta.studio.variables),
      bad: bad.errors.map((e) => e.path), scr: scr.ok
    };
  }, JSON.stringify(D([
    { id: 'a', width: 1000, height: 600, print: { paper: 'a4', w: 210, h: 297, dpi: 300 }, layers: [
      { id: 'title', type: 'text', text: 'Hi {{name|upper}}', x: 10, y: 10, w: 500, h: 80, size: 60, fit: 'shrink' },
      { id: 'band', type: 'shape', shape: 'rect', fill: '{{brand}}', x: 0, y: 500, w: 1000, h: 100 },
      { id: 'pic', type: 'image', slot: true, bind: 'photo', x: 600, y: 10, w: 300, h: 300 },
      { id: 'tag', type: 'text', text: 'VIP', bind: { show: 'vip' }, overflow: 'ellipsis', minSize: 12, x: 10, y: 200, w: 200, h: 40 }
    ] },
    { id: 'b', width: 1000, height: 600, values: { name: 'Bo', vip: false }, layers: [{ id: 't2', type: 'text', text: '{{name}}', x: 0, y: 0, w: 400, h: 60 }] }
  ], {
    variables: [{ name: 'name', label: 'Name', type: 'text', required: true, sample: 'Ana' }, { key: 'brand', type: 'color', default: '#112233' }, { key: 'vip', type: 'boolean' }, { key: 'photo', type: 'image' }],
    values: { name: 'Ana', brand: '#FF0000', vip: true }
  })));
  h.assert(!r.errors, 'parse failed: ' + JSON.stringify(r.errors));
  h.assert(r.stable, 'byte-stable on a second round trip');
  h.assert.equal(JSON.stringify(r.vars), JSON.stringify([{ key: 'name', label: 'Name', type: 'text', sample: 'Ana', required: true }, { key: 'brand', label: 'brand', type: 'colour', default: '#112233' }, { key: 'vip', label: 'vip', type: 'boolean' }, { key: 'photo', label: 'photo', type: 'image' }]), 'variables: ' + JSON.stringify(r.vars));
  h.assert.equal(JSON.stringify(r.values), JSON.stringify([{ name: 'Ana', brand: '#FF0000', vip: true }, { name: 'Bo', brand: '#FF0000', vip: false }]), 'top-level values fill every page; page values win');
  h.assert.equal(JSON.stringify(r.l), JSON.stringify([['title', null, 'shrink', null], ['band', { color: 'brand' }, null, null], ['pic', { content: 'photo' }, null, null], ['tag', { show: 'vip' }, 'ellipsis', 12]]), 'layers: ' + JSON.stringify(r.l));
  h.assert(r.print && r.print.paper === 'a4' && r.print.w === 210, 'page print size read');
  h.assert(/"values": \{/.test(r.t1) && /"bind": \{ "color": "brand" \}/.test(r.t1) && /"overflow": "shrink"/.test(r.t1) && /"print": \{/.test(r.t1), 'written: ' + r.t1.slice(0, 600));
  h.assert(r.kept, 'LE.project.validate (the .leproject gate) keeps values, bindings and the variable list');
  ['/values/a b', '/variables/0/type', '/pages/0/values/n', '/pages/0/layers/0/overflow', '/pages/0/layers/0/bind/content'].forEach((p) => h.assert(r.bad.includes(p), 'error at ' + p + ': ' + JSON.stringify(r.bad)));
  h.assert(!r.scr, 'markup in a value is refused like any string');
  h.assert.noErrors(page);
};

cases['template links carry variables and values'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const a = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, variables: [{ key: 'name', required: true }], values: { name: 'Ana' }, pages: [{ width: 400, height: 200, layers: [{ id: 't', type: 'text', text: 'To {{name}}', x: 0, y: 0, w: 400, h: 60 }] }] }));
    const link = await LE.design.toLink(a.project, {});
    const b = await LE.design.fromLink(link.url);
    return { ok: b.ok, vars: b.project.meta.studio.variables, values: b.project.pages[0].values, text: b.project.pages[0].layers[0].text };
  });
  h.assert(r.ok, 'link opens');
  h.assert.equal(r.vars[0].key, 'name');
  h.assert.equal(JSON.stringify(r.values), JSON.stringify({ name: 'Ana' }));
  h.assert.equal(r.text, 'To {{name}}', 'the template text travels unfilled');
  h.assert.noErrors(page);
};

cases['fill once: Make this a field, type a value, the template stays, undo, export renders the values'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await page.addStyleTag({ content: '.sx-coach{display:none!important}' });
  await h.addLayers(page, [{ type: 'text', id: 'hello', text: 'Hello Ana', x: 100, y: 200, w: 880, h: 130, size: 100, font: 'Inter', color: '#111111' }]);
  await h.select(page, ['hello']);
  await page.evaluate(() => LE.modules.need('variables'));
  await h.openPanel(page, 'fields');
  await page.waitForSelector('.vx-make');
  await page.click('.vx-make');
  await page.waitForSelector('.vx-field textarea');
  let d = await h.doc(page);
  const key = Object.keys(d.values || {})[0];
  h.assert.equal(d.layers[0].text, '{{' + key + '}}', 'the text became a field');
  h.assert.equal(d.values[key], 'Hello Ana', 'and its value keeps what it said');
  const before = await page.evaluate(() => LEStudio.scene.render(0.25).then((c) => c.toDataURL()));
  await page.fill('.vx-field textarea', 'Bartholomew Montgomery-Smithson the Third');
  await page.locator('.vx-field textarea').blur();
  await page.waitForTimeout(300);
  d = await h.doc(page);
  h.assert.equal(d.layers[0].text, '{{' + key + '}}', 'filling never changes the layer');
  h.assert.equal(d.values[key], 'Bartholomew Montgomery-Smithson the Third');
  const fit = await page.evaluate(() => { const sc = LEStudio.scene; const l = sc._doc.layers[0]; const f = sc._filled(l); return { size: f.size, text: f.text }; });
  h.assert(fit.size < 100 && fit.size >= 40, 'long text shrinks to fit its box: ' + fit.size);
  const after = await page.evaluate(() => LEStudio.scene.render(0.25).then((c) => c.toDataURL()));
  h.assert(before !== after, 'export renders the new value');
  await page.evaluate(() => LEStudio.scene.undo());
  d = await h.doc(page);
  h.assert.equal(d.values[key], 'Hello Ana', 'one undo brings the previous value back');
  await page.click('[data-a=reset]');
  d = await h.doc(page);
  h.assert(!d.values, 'Reset to template clears the values');
  await page.evaluate(() => LEStudio.scene.undo());
  d = await h.doc(page);
  h.assert(d.values && d.values[key] === 'Hello Ana', 'reset is undoable');
  await page.evaluate(() => LEStudio.saveNow());
  const saved = await page.evaluate(() => LEStudio.S.project.pages[0].values);
  h.assert(saved && saved[key] === 'Hello Ana', 'saved with the project');
  h.assert.noErrors(page);
};

cases['bindings: photo, colour, show / hide and QR draw from values'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const mk = (w, hh, col) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, w, hh); return c; };
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;width:64px;height:64px'; document.body.appendChild(host);
    const sc = new LE.Scene({ el: host, width: 400, height: 400 });
    sc.addAsset('red', mk(300, 100, '#ff0000'));
    sc.load({ width: 400, height: 400, background: { type: 'color', color: '#ffffff' }, values: { photo: 'red', brand: '#00ff00', vip: 'no', url: 'https://example.org/x' }, layers: [
      { id: 'pic', type: 'image', src: '', x: 0, y: 0, w: 200, h: 200, crop: { x: 0, y: 0, w: 1, h: 1 }, bind: { content: 'photo' } },
      { id: 'band', type: 'shape', shape: 'rect', x: 200, y: 0, w: 200, h: 200, fill: { type: 'solid', color: '#0000ff' }, bind: { color: 'brand' } },
      { id: 'vip', type: 'shape', shape: 'rect', x: 0, y: 200, w: 200, h: 200, fill: { type: 'solid', color: '#000000' }, bind: { show: 'vip' } },
      { id: 'qr', type: 'svg', name: 'QR code', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#FFFFFF"/><path d="M1 1h1v1h-1z" fill="#000000"/></svg>', x: 220, y: 220, w: 160, h: 160, bind: { content: 'url' } }
    ] });
    const cv = await sc.render(1);
    const x = cv.getContext('2d');
    const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data).slice(0, 3).join(',');
    const pic = sc._filled(sc._doc.layers[0]);
    const qr = sc._filled(sc._doc.layers[3]);
    let dark = 0; const d = x.getImageData(220, 220, 160, 160).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) dark++;
    return { pic: px(100, 100), band: px(300, 100), vip: px(100, 300), crop: pic.crop, qrDark: dark, qrLen: qr.svg.length, tpl: sc.toJSON().layers.map((l) => l.src || (l.fill && l.fill.color) || '') };
  });
  h.assert.equal(r.pic, '255,0,0', 'photo slot filled from the value');
  h.assert(Math.abs(r.crop.w - 1 / 3) < 0.01 && Math.abs(r.crop.x - 1 / 3) < 0.01, 'cover crop around the centre: ' + JSON.stringify(r.crop));
  h.assert.equal(r.band, '0,255,0', 'colour bound');
  h.assert.equal(r.vip, '255,255,255', 'hidden when the yes / no value is no');
  h.assert(r.qrDark > 2000 && r.qrLen > 1000, 'a real QR code was drawn for the row: ' + r.qrDark);
  h.assert.equal(r.tpl.join(','), ',#0000ff,#000000,', 'the template layers are unchanged');
  h.assert.noErrors(page);
};

cases['lint: unknown pipes and filled-in overflow are reported'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const w = await page.evaluate(async () => {
    const a = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, values: { n: 'An extremely long name that cannot possibly fit in this tiny box at all' }, pages: [{ width: 400, height: 200, layers: [
      { id: 't', type: 'text', text: '{{n|wobble}}', x: 0, y: 0, w: 300, h: 40 },
      { id: 'u', type: 'text', text: '{{n}}', x: 0, y: 60, w: 120, h: 30, size: 40, minSize: 30 }
    ] }] }));
    return a.warnings.map((x) => x.kind + ':' + (x.layer || ''));
  });
  h.assert(w.includes('unknown-pipe:t'), 'unknown pipe: ' + w.join(' '));
  h.assert(w.includes('overflow:u'), 'overflow with the filled value: ' + w.join(' '));
  h.assert.noErrors(page);
};

cases['agents: variables.set and values.set on a working copy'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const err = (code, message, path) => Object.assign(new Error(message), { code, path });
    const W = { pages: [{ width: 100, height: 100, layers: [{ id: 't', type: 'text', text: '{{name}} {{price|number}}' }] }], studio: { variables: null, pageIds: [''] }, assets: {}, blobs: {}, pagesTouched: {}, replacedPages: {} };
    const A = LE.variables.agent;
    const a = await A.op('variables.set', W, { variables: [{ key: 'name', label: 'Name', required: true }, { key: 'price', type: 'number' }] }, '/ops/0', err);
    const b = await A.op('values.set', W, { values: { name: 'Ana', price: '1.234,5' } }, '/ops/1', err);
    let bad = null;
    try { await A.op('values.set', W, { values: { price: 'lots' } }, '/ops/2', err); } catch (e) { bad = e.path + ' ' + e.code; }
    let bad2 = null;
    try { await A.op('variables.set', W, { variables: [{ key: 'bad key' }] }, '/ops/3', err); } catch (e) { bad2 = e.path; }
    const c = await A.op('variables.set', W, { rename: { from: 'name', to: 'full_name' } }, '/ops/4', err);
    return { a, b, values: W.pages[0].values, bad, bad2, text: W.pages[0].layers[0].text, vars: W.studio.variables.map((v) => v.key), c: c.variables.map((v) => v.key) };
  });
  h.assert.equal(r.a.variables.map((v) => v.key + ':' + v.used).join(','), 'name:1,price:1');
  h.assert.equal(JSON.stringify(r.values), JSON.stringify({ full_name: 'Ana', price: 1234.5 }), 'values coerced by type and renamed: ' + JSON.stringify(r.values));
  h.assert.equal(r.bad, '/ops/2/values/price invalid', 'a wrong type is an error with a pointer');
  h.assert.equal(r.bad2, '/ops/3/variables/0/key');
  h.assert.equal(r.text, '{{full_name}} {{price|number}}');
  h.assert.equal(r.vars.join(','), 'full_name,price');
  h.assert.noErrors(page);
};

cases['loading: nothing extra on first load; the filler, SheetJS and the QR encoder load only when needed'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  const urls = [];
  page.on('request', (q) => urls.push(q.url()));
  await page.waitForFunction(() => window.LEStudio && window.LE && LE.modules);
  await page.waitForFunction(() => LE.modules.loaded('variables'), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const seen = (re) => urls.some((u) => re.test(u));
  h.assert(!seen(/le-variables\.js/), 'le-variables.js is not fetched on a plain load');
  h.assert(!seen(/xlsx\.full|jszip|qrcode\.js|templates\/fields\.json/), 'no spreadsheet reader, zip library, QR encoder or templates: ' + urls.filter((u) => /vendor|data/.test(u)).join(' '));
  await h.openPanel(page, 'fields');
  await page.waitForSelector('.vx-body');
  h.assert(seen(/le-variables\.js/), 'Fields loads the filler');
  h.assert(!seen(/xlsx\.full/), 'still no SheetJS');
  /* A saved design with values loads the filler before its fields are drawn. */
  const r = await page.evaluate(async () => {
    const before = !!LE.variables;
    return { before };
  });
  h.assert(r.before);
  h.assert.noErrors(page);
};

cases['a design with values opens filled (the boot hook loads the filler before drawing fields)'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.design);
  const r = await page.evaluate(async () => {
    const was = !!LE.variables;
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;width:64px;height:64px'; document.body.appendChild(host);
    const sc = new LE.Scene({ el: host, width: 300, height: 100 });
    sc.load({ width: 300, height: 100, background: { type: 'color', color: '#ffffff' }, values: { n: 'X' }, layers: [{ id: 't', type: 'text', text: '{{n}}', x: 0, y: 0, w: 300, h: 100, size: 80, color: '#000000' }] });
    const cv = await sc.render(1);
    return { was, now: !!LE.variables, filled: sc._filled(sc._doc.layers[0]).text };
  });
  h.assert.equal(r.now, true, 'loaded by the render');
  h.assert.equal(r.filled, 'X');
  h.assert.noErrors(page);
};

for (const vp of ['phone', 'small']) {
  cases['phone ' + vp + ': Fields from a ready template, 44 px targets, no sideways scroll'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 0);
    await page.addStyleTag({ content: '.sx-coach{display:none!important}' });
    await page.evaluate(() => LE.modules.need('variables'));
    await page.evaluate(() => LEStudioVariables.useTemplate('certificate'));
    await page.waitForSelector('.vx-field');
    await page.waitForTimeout(400);
    h.assert(await h.noOverflow(page), 'no sideways scroll');
    const small = await page.evaluate(() => [...document.querySelectorAll('#sx-panel-body button, #sx-panel-body input:not([type=file]):not([type=checkbox]), #sx-panel-body textarea, #sx-panel-body select')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().height)));
    h.assert(!small.length, 'controls under 44 px: ' + small.join(' '));
    await page.fill('.vx-field textarea', 'Ana');
    await page.waitForTimeout(200);
    const d = await h.doc(page);
    h.assert.equal(d.values.name, 'Ana');
    h.assert.noErrors(page);
  };
}

module.exports = cases;
