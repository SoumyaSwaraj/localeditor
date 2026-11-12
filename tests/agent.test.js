'use strict';
/* Agent mode (G1): window.LEAgent, the typed console, #ops= links, the watching UI, interruptions and the headless switch.
   Asserts on the document and on API results; the watching UI is checked through its DOM. */
const cases = {};

const T = (extra) => Object.assign({ id: 'title', type: 'text', text: 'Launch day', font: 'Anton', size: 140, color: '#FFFFFF', x: 'center', y: 120, w: '86%', h: 260, fit: 'shrink', align: 'center' }, extra || {});
const BG = { op: 'page.background', background: '#14213D' };

async function ready(page) {
  await page.waitForFunction(() => window.LEAgent && window.LEStudio && LEAgent._internal.A.ready);
  await page.evaluate(() => { window.BG = { op: 'page.background', background: '#14213D' }; });
}
async function studio(browser, base, h, vp, url, opts) {
  const page = await h.open(browser, base, url || '/studio/', vp || 'desktop', opts);
  await ready(page);
  return page;
}
/* Starts a session the way a person would: the agent asks, the person taps Allow. */
async function session(browser, base, h, vp, opts) {
  const page = await studio(browser, base, h, vp, null, opts);
  const p = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'Testing agent mode' }));
  await page.click('.sxa-ask [data-yes]');
  const r = await p;
  h.assert(r.ok, 'begin failed: ' + JSON.stringify(r));
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  return page;
}
const api = (page, fn, arg) => page.evaluate(fn, arg);
const layersOf = (page) => page.evaluate(() => LEStudio.scene.toJSON().layers);
const undoDepth = (page) => page.evaluate(() => LEStudio.scene._hist.undo.length);
const tinyPng = (page, color) => page.evaluate((c) => { const cv = document.createElement('canvas'); cv.width = 8; cv.height = 6; const x = cv.getContext('2d'); x.fillStyle = c || '#c0392b'; x.fillRect(0, 0, 8, 6); return cv.toDataURL('image/png'); }, color);

cases['help() describes every method, operation and error code; version and protocol'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await api(page, () => ({ help: LEAgent.help(), version: LEAgent.version, protocol: LEAgent.protocol, codes: LEAgent.codes }));
  h.assert.equal(r.protocol, 1);
  h.assert(/^\d+\.\d+\.\d+$/.test(r.version), 'version');
  ['add', 'update', 'remove', 'reorder', 'group', 'ungroup', 'align', 'distribute', 'page.add', 'page.remove', 'page.resize', 'page.background', 'page.select', 'select', 'replace', 'make', 'recipe', 'collage', 'text.replace', 'image.fill'].forEach((op) => h.assert(r.help.operations[op], 'help is missing operation ' + op));
  ['invalid', 'conflict', 'interrupted', 'paused', 'no-session', 'consent', 'unsupported', 'too-large'].forEach((c) => { h.assert(r.help.errors[c], 'help is missing code ' + c); h.assert(r.codes.indexOf(c) >= 0, 'codes ' + c); });
  h.assert(r.help.happyPath.length >= 5 && r.help.channels.console && r.help.channels.headless && r.help.docs.guide, 'help sections');
  h.assert(JSON.stringify(r.help).length < 40000, 'help stays compact');
  h.assert.noErrors(page);
};

cases['consent: begin asks the person; state and apply are refused before; Not now and a pending answer are reported'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const before = await api(page, () => LEAgent.state());
  h.assert.equal(before.code, 'consent');
  const ap = await api(page, () => LEAgent.apply([{ op: 'page.background', background: '#000000' }]));
  h.assert.equal(ap.code, 'no-session');
  const pending = await api(page, () => LEAgent.begin({ name: 'Claude', task: 'Poster', wait: 300 }));
  h.assert.equal(pending.code, 'consent');
  h.assert(pending.consentPending, 'pending consent flagged');
  const text = await page.textContent('.sxa-ask');
  h.assert(/Claude/.test(text) && /Poster/.test(text), 'the sheet names the agent and the task: ' + text);
  const again = page.evaluate(() => LEAgent.begin({ name: 'Claude', task: 'Poster' }));
  await page.click('.sxa-ask [data-no]');
  const no = await again;
  h.assert.equal(no.code, 'consent');
  const yes = page.evaluate(() => LEAgent.begin({ name: 'Claude', task: 'Poster' }));
  await page.click('.sxa-ask [data-yes]');
  const ok = await yes;
  h.assert(ok.ok && ok.session.name === 'Claude', 'session started');
  h.assert(await page.isVisible('.sxa-bar'), 'banner shows');
  h.assert(/Claude is editing/.test(await page.textContent('.sxa-bar')), 'banner names the agent');
  h.assert.noErrors(page);
};

cases['?agent=1 shows the explanation once; turning it on lets begin start without a second sheet'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h, 'desktop', '/studio/?agent=1');
  await page.waitForSelector('.sxa-ask');
  const t = await page.textContent('.sxa-ask');
  h.assert(/An assistant can now change this design\. You can pause or take over at any time\. Nothing is uploaded\./.test(t), 'explanation text');
  await page.click('.sxa-ask [data-yes]');
  const r = await api(page, () => LEAgent.begin({ name: 'Cursor', task: 'Edit', wait: 2000 }));
  h.assert(r.ok, 'begin without a second sheet: ' + JSON.stringify(r).slice(0, 200));
  h.assert.equal(await page.$('.sxa-ask'), null);
  h.assert(/Turn off agent mode/.test(await page.innerHTML('.sxa-bar')), 'turning off is one tap away');
  h.assert.noErrors(page);
};

cases['every operation is one undo step and round-trips through state()'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = await tinyPng(page);
  const steps = [
    [[BG], (d) => d.pages[0].background.color === '#14213D'],
    [[{ op: 'add', layer: T() }], (d) => d.pages[0].layers.some((l) => l.id === 'title')],
    [[{ op: 'add', layers: [{ id: 'a', type: 'shape', shape: 'rectangle', fill: '#E0B354', x: 40, y: 700, w: 100, h: 100 }, { id: 'b', type: 'shape', shape: 'ellipse', fill: '#E0668E', x: 300, y: 720, w: 100, h: 100 }, { id: 'c', type: 'shape', shape: 'star', fill: '#17A37A', x: 900, y: 740, w: 100, h: 100 }] }], (d) => d.pages[0].layers.length === 4],
    [[{ op: 'update', id: 'title', set: { color: '#FFF3E2', size: 120 } }], (d) => d.pages[0].layers.find((l) => l.id === 'title').color === '#FFF3E2'],
    [[{ op: 'reorder', id: 'a', to: 'front' }], (d) => d.pages[0].layers[d.pages[0].layers.length - 1].id === 'a'],
    [[{ op: 'align', ids: ['a', 'b', 'c'], edge: 'top', relativeTo: 'selection' }], (d) => d.pages[0].layers.filter((l) => 'abc'.includes(l.id)).every((l) => l.y === 700)],
    [[{ op: 'distribute', ids: ['a', 'b', 'c'], axis: 'h' }], (d) => Math.abs(d.pages[0].layers.find((l) => l.id === 'b').x - 470) < 1],
    [[{ op: 'group', ids: ['a', 'b'], groupId: 'ab', name: 'Pair' }], (d) => d.pages[0].layers.some((l) => l.id === 'ab' && l.type === 'group')],
    [[{ op: 'update', id: 'ab', set: { y: 600 } }], (d) => d.pages[0].layers.find((l) => l.id === 'a').y === 600],
    [[{ op: 'ungroup', id: 'ab' }], (d) => !d.pages[0].layers.some((l) => l.id === 'ab')],
    [[{ op: 'remove', id: 'c' }], (d) => !d.pages[0].layers.some((l) => l.id === 'c')],
    [[{ op: 'add', layer: { id: 'hero', type: 'image', slot: true, x: 140, y: 380, w: 800, h: 200 } }], (d) => d.pages[0].layers.some((l) => l.id === 'hero' && l.slot)],
    [[{ op: 'image.fill', id: 'hero', src: png }], (d) => /^[a-f0-9]{64}$/.test(d.pages[0].layers.find((l) => l.id === 'hero').src)],
    [[{ op: 'recipe', id: 'hero', recipe: 'golden-hour', strength: 80 }], (d) => d.pages[0].layers.find((l) => l.id === 'hero').recipe.id === 'golden-hour'],
    [[{ op: 'text.replace', find: 'Launch', replace: 'Ship' }], (d) => d.pages[0].layers.find((l) => l.id === 'title').text === 'Ship day'],
    [[{ op: 'page.resize', width: 1080, height: 1350 }], (d) => d.pages[0].height === 1350],
    [[{ op: 'rename', name: 'Launch post' }, { op: 'select', ids: ['title'] }], (d) => d.name === 'Launch post']
  ];
  for (const [ops, okFn] of steps) {
    const d0 = await undoDepth(page);
    const r = await api(page, (o) => LEAgent.apply(o, { label: 'step' }), ops);
    h.assert(r.ok, 'apply ' + ops[0].op + ': ' + JSON.stringify(r.errors || r.message));
    const st = await api(page, () => LEAgent.state());
    h.assert(okFn(st.design), 'state() reflects ' + ops[0].op + ': ' + JSON.stringify(st.design.pages[0]).slice(0, 400));
    const d1 = await undoDepth(page);
    if (ops[0].op !== 'rename') h.assert.equal(d1 - d0, 1, 'undo steps for ' + ops[0].op);
  }
  h.assert.equal(JSON.stringify(await page.evaluate(() => LEStudio.scene.selection())), '["title"]');
  /* Ctrl+Z on the last visual batch restores the step before it. */
  await page.evaluate(() => LEStudio.scene.undo());
  const back = await api(page, () => LEAgent.state());
  h.assert.equal(back.design.pages[0].height, 1080, 'undo of page.resize');
  /* Page structure: add, select, remove, replace, collage, make. */
  let r = await api(page, () => LEAgent.apply([{ op: 'page.add', id: 'slide-2', background: '#FFF3E2', layers: [{ id: 'cap', type: 'text', text: 'Two', x: 'center', y: 'center', color: '#17131F' }] }]));
  h.assert(r.ok, 'page.add ' + JSON.stringify(r.errors));
  let st = await api(page, () => LEAgent.state());
  h.assert(st.pages.length === 2 && st.page === 1 && st.pages[1].id === 'slide-2', 'page.add makes the new page current');
  r = await api(page, () => LEAgent.apply([{ op: 'page.select', page: 0 }]));
  st = await api(page, () => LEAgent.state());
  h.assert.equal(st.page, 0);
  r = await api(page, () => LEAgent.apply([{ op: 'page.remove', page: 'slide-2' }]));
  st = await api(page, () => LEAgent.state());
  h.assert.equal(st.pages.length, 1);
  r = await api(page, () => LEAgent.apply([{ op: 'replace', page: 0, design: { pages: [{ width: 1080, height: 1080, background: '#FFFFFF', layers: [{ id: 'p1', type: 'image', slot: true, x: 0, y: 0, w: 50, h: 50 }, { id: 'p2', type: 'image', slot: true, x: 0, y: 0, w: 50, h: 50 }, { id: 'p3', type: 'image', slot: true, x: 0, y: 0, w: 50, h: 50 }] }] } }, { op: 'collage', layout: 'r-1.2', spacing: 12, margin: 30 }]));
  h.assert(r.ok, 'replace + collage ' + JSON.stringify(r.errors));
  st = await api(page, () => LEAgent.state());
  const pg = st.design.pages[0];
  h.assert(pg.collage && pg.layers.filter((l) => l.slot).length === 3 && pg.layers.every((l) => l.w > 100), 'collage laid out: ' + JSON.stringify(pg).slice(0, 300));
  r = await api(page, () => LEAgent.apply([{ op: 'make', maker: 'quote', values: { quote: 'Ship small, ship often.', author: 'The team' } }]));
  h.assert(r.ok, 'make ' + JSON.stringify(r.errors || r.message));
  st = await api(page, () => LEAgent.state());
  h.assert(st.design.pages[0].layers.some((l) => l.type === 'text' && /Ship small/.test(l.text)), 'maker page');
  const feed = await page.evaluate(() => LEAgent._internal.feed().length);
  h.assert(feed >= 20, 'every batch is in the activity feed: ' + feed);
  h.assert.noErrors(page);
};

cases['invalid batches change nothing and return precise errors; partial applies the rest'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }]), T());
  const snap = JSON.stringify(await layersOf(page));
  const rev0 = await page.evaluate(() => LEAgent.rev);
  const bad = [
    [[{ op: 'explode' }], 'invalid', /Unknown operation/, '/ops/0/op'],
    [[{ op: 'add', layer: { type: 'video', x: 0 } }], 'invalid', /type/i, null],
    [[{ op: 'update', id: 'title', set: { text: '<img src=x onerror=alert(1)>' } }], 'invalid', /HTML|script/, '/ops/0/set/text'],
    [[{ op: 'update', id: 'title', set: { text: 'javascript:alert(1)' } }], 'invalid', /script/, '/ops/0/set/text'],
    [[{ op: 'update', id: 'nope', set: { color: '#000000' } }], 'invalid', /No layer “nope”/, '/ops/0/id'],
    [[{ op: 'update', id: 'title', set: { opacity: 'half' } }], 'invalid', /opacity|number/i, '/ops/0/set/opacity'],
    [[{ op: 'add', layer: T() }], 'invalid', /already used/, '/ops/0/layer/id'],
    [[{ op: 'image.fill', id: 'title', src: 'data:image/png;base64,AAAA' }], 'invalid', /image layer/, '/ops/0/id']
  ];
  for (const [ops, code, msg, path] of bad) {
    const r = await api(page, (o) => LEAgent.apply(o), ops);
    h.assert(!r.ok && r.code === code, 'expected ' + code + ' for ' + JSON.stringify(ops).slice(0, 80) + ': ' + JSON.stringify(r).slice(0, 300));
    const e = (r.errors || [])[0] || {};
    h.assert(msg.test(e.message || r.message), 'message for ' + JSON.stringify(ops).slice(0, 60) + ': ' + (e.message || r.message));
    if (path) h.assert.equal(e.path, path, 'path for ' + JSON.stringify(ops).slice(0, 60));
    h.assert.equal(r.applied, 0);
  }
  const proto = await api(page, () => LEAgent.apply('[{"op":"update","id":"title","set":{"__proto__":{"x":1}}}]'));
  h.assert(!proto.ok && /not allowed/.test(proto.message), 'forbidden key: ' + JSON.stringify(proto).slice(0, 200));
  const stale = await api(page, (r) => LEAgent.apply([BG], { ifRev: r - 1 }), rev0);
  h.assert(!stale.ok && stale.code === 'conflict' && Array.isArray(stale.changes) && stale.changes.length >= 1, 'stale ifRev: ' + JSON.stringify(stale).slice(0, 300));
  h.assert.equal(JSON.stringify(await layersOf(page)), snap, 'nothing changed');
  h.assert.equal(await page.evaluate(() => LEAgent.rev), rev0, 'rev unchanged');
  const part = await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { color: '#E0B354' } }, { op: 'remove', id: 'ghost' }], { partial: true }));
  h.assert(part.ok && part.applied === 1 && part.errors.length === 1 && part.errors[0].op === 1, 'partial: ' + JSON.stringify(part).slice(0, 300));
  const all = await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { color: '#E0B354' } }, { op: 'remove', id: 'ghost' }]));
  h.assert(!all.ok && all.applied === 0, 'not partial by default');
  h.assert.noErrors(page);
};

cases['shorthand resolves: positions, percentages, shrink-to-fit, icons, fills'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const r = await api(page, () => LEAgent.apply([
    { op: 'add', layer: { id: 'long', type: 'text', text: 'A very long headline that cannot fit at this size', size: 400, x: 'center', y: 'bottom', w: '50%', h: 200, fit: 'shrink' } },
    { op: 'add', layer: { id: 'sun', type: 'icon', icon: 'lucide:sun', color: '#17131F', x: 'right', y: 'top', w: 100 } },
    { op: 'add', layer: { id: 'box', type: 'shape', shape: 'rect', fill: '#E0B354', x: '10%', y: '25%', w: '20%', h: 50 } }
  ]));
  h.assert(r.ok, JSON.stringify(r.errors));
  const L = await layersOf(page);
  const long = L.find((l) => l.id === 'long'), sun = L.find((l) => l.id === 'sun'), box = L.find((l) => l.id === 'box');
  h.assert(Math.abs(long.x - 270) < 1 && Math.abs(long.y + long.h - 1080) < 1 && long.w === 540, 'center / bottom / 50%: ' + JSON.stringify([long.x, long.y, long.w, long.h]));
  h.assert(long.size < 400 && long.size > 20, 'shrink: ' + long.size);
  h.assert(sun.type === 'svg' && sun.assetId === 'lucide:sun' && sun.h === 100 && Math.abs(sun.x - 980) < 1 && sun.y === 0, 'icon shorthand: ' + JSON.stringify(sun).slice(0, 200));
  h.assert(box.fill.type === 'solid' && box.fill.color === '#E0B354' && box.x === 108 && box.y === 270 && box.w === 216, 'fill and percentages: ' + JSON.stringify(box).slice(0, 200));
  h.assert.noErrors(page);
};

cases['find, catalog and check behave; check fixes clear the problems'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, () => LEAgent.apply([
    { op: 'page.background', background: '#FFFFFF' },
    { op: 'add', layer: { id: 'headline', type: 'text', text: 'Big news today', size: 150, color: '#F4F4F4', x: 'center', y: 100, w: '80%' } },
    { op: 'add', layer: { id: 'small', type: 'text', text: 'Small print that is far too long for this little box', size: 60, x: 100, y: 600, w: 300, h: 60, color: '#17131F' } },
    { op: 'add', layer: { id: 'p1', type: 'image', slot: true, x: 0, y: 800, w: 200, h: 200 } },
    { op: 'add', layer: { id: 'p2', type: 'image', slot: true, x: 300, y: 800, w: 200, h: 200 } },
    { op: 'add', layer: { id: 'lost', type: 'shape', shape: 'rectangle', fill: '#000000', x: 2000, y: 0, w: 100, h: 100 } }
  ]));
  const f1 = await api(page, () => LEAgent.find('the title'));
  h.assert(f1.count === 1 && f1.layers[0].id === 'headline', 'the title: ' + JSON.stringify(f1.layers));
  const f2 = await api(page, () => LEAgent.find('all photos'));
  h.assert.equal(f2.layers.map((l) => l.id).join(), 'p1,p2');
  const f3 = await api(page, () => LEAgent.find({ type: 'text', text: 'print' }));
  h.assert.equal(f3.layers.map((l) => l.id).join(), 'small');
  const cat = await api(page, async () => ({
    fonts: await LEAgent.catalog('fonts'), serif: await LEAgent.catalog('fonts', 'serif'), icons: await LEAgent.catalog('icons', 'star', { limit: 5 }),
    shapes: await LEAgent.catalog('shapes'), recipes: await LEAgent.catalog('recipes', 'golden'), makers: await LEAgent.catalog('makers'),
    layouts: await LEAgent.catalog('collages', '4'), sizes: await LEAgent.catalog('sizes', 'story'), bad: await LEAgent.catalog('rockets')
  }));
  h.assert(cat.fonts.total >= 40 && cat.serif.items.length >= 5, 'fonts');
  h.assert(cat.icons.items.length === 5 && cat.icons.items[0].id.indexOf(':star') > 0 && cat.icons.next === 5, 'icons paged: ' + JSON.stringify(cat.icons).slice(0, 200));
  h.assert(cat.shapes.items.some((s) => s.id === 'star'), 'shapes');
  h.assert(cat.recipes.items[0].id === 'golden-hour', 'recipes');
  h.assert(cat.makers.items.some((m) => m.id === 'quote' && m.inputs.length), 'makers');
  h.assert(cat.layouts.items.length > 2 && cat.layouts.items[0].cells === 4, 'layouts');
  h.assert(cat.sizes.items.some((s) => s.width === 1080 && s.height === 1920), 'sizes');
  h.assert(!cat.bad.ok && cat.bad.code === 'invalid', 'unknown catalog');
  const chk = await api(page, () => LEAgent.check());
  const kinds = chk.problems.map((p) => p.kind + ':' + p.layer).sort();
  h.assert(kinds.includes('low-contrast:headline') && kinds.includes('overflow:small') && kinds.includes('off-page:lost'), 'problems: ' + kinds.join(' '));
  h.assert(chk.problems.every((p) => !p.layer || p.fix), 'each layer problem has a fix');
  const fixed = await api(page, (ps) => LEAgent.apply(ps.map((p) => p.fix).filter(Boolean), { label: 'Fix problems' }), chk.problems);
  h.assert(fixed.ok, 'fixes apply: ' + JSON.stringify(fixed.errors));
  const again = await api(page, () => LEAgent.check());
  h.assert(again.clean, 'clean after fixes: ' + JSON.stringify(again.problems));
  h.assert.noErrors(page);
};

cases['remote images ask the person, naming the host; no means nothing changes'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = Buffer.from((await tinyPng(page, '#2F6BFF')).split(',')[1], 'base64');
  let fetched = 0;
  await page.context().route('https://images.example.org/**', (route) => { fetched++; route.fulfill({ status: 200, contentType: 'image/png', body: png }); });
  await api(page, () => LEAgent.apply([{ op: 'add', layer: { id: 'hero', type: 'image', slot: true, x: 0, y: 0, w: 400, h: 300 } }]));
  const snap = JSON.stringify(await layersOf(page));
  const p1 = page.evaluate(() => LEAgent.apply([{ op: 'image.fill', id: 'hero', src: 'https://images.example.org/a.png' }]));
  await page.waitForSelector('.sxa-ask');
  h.assert(/images\.example\.org/.test(await page.textContent('.sxa-ask')), 'the sheet names the host');
  h.assert.equal(fetched, 0, 'nothing fetched before consent');
  await page.click('.sxa-ask [data-no]');
  const r1 = await p1;
  h.assert(!r1.ok && r1.code === 'consent' && r1.errors[0].host === 'images.example.org', 'declined: ' + JSON.stringify(r1).slice(0, 300));
  h.assert.equal(JSON.stringify(await layersOf(page)), snap);
  h.assert.equal(fetched, 0);
  const r2 = await api(page, () => LEAgent.apply([{ op: 'image.fill', id: 'hero', src: 'https://images.example.org/b.png' }]));
  h.assert(!r2.ok && r2.code === 'consent', 'a declined host is remembered for the session');
  h.assert.noErrors(page);
};

cases['remote image allowed by the person is downloaded once and placed'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  const png = Buffer.from((await tinyPng(page, '#17A37A')).split(',')[1], 'base64');
  await page.context().route('https://cdn.example.net/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await api(page, () => LEAgent.apply([{ op: 'add', layer: { id: 'hero', type: 'image', slot: true, x: 0, y: 0, w: 400, h: 300 } }]));
  const p = page.evaluate(() => LEAgent.apply([{ op: 'image.fill', id: 'hero', src: 'https://cdn.example.net/x.png' }]));
  await page.waitForSelector('.sxa-ask');
  await page.click('.sxa-ask [data-yes]');
  const r = await p;
  h.assert(r.ok, JSON.stringify(r).slice(0, 300));
  const hero = (await layersOf(page)).find((l) => l.id === 'hero');
  h.assert(/^[a-f0-9]{64}$/.test(hero.src), 'placed');
  h.assert.noErrors(page);
};

cases['pause queues batches; resume applies them in order; paused calls return at once'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }]), T());
  await page.click('.sxa-bar [data-act="pause"]');
  const t0 = Date.now();
  const q1 = await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { text: 'One' } }], { label: 'first' }));
  const q2 = await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { text: 'Two' } }], { label: 'second' }));
  h.assert(Date.now() - t0 < 3000, 'paused calls return promptly');
  h.assert(q1.queued && q1.paused && q1.code === 'paused' && q2.position === 2, 'queued: ' + JSON.stringify(q2).slice(0, 200));
  const st = await api(page, () => LEAgent.state());
  h.assert(st.paused && st.queued === 2, 'state says paused');
  h.assert.equal((await layersOf(page))[0].text, 'Launch day', 'nothing applied while paused');
  const rej = await api(page, () => LEAgent.apply([BG], { whenPaused: 'reject' }));
  h.assert.equal(rej.code, 'paused');
  h.assert(/is paused/.test(await page.textContent('.sxa-bar')), 'banner says paused');
  await page.click('.sxa-bar [data-act="resume"]');
  await page.waitForFunction(() => !LEAgent._internal.A.queue.length && !LEAgent._internal.A.running);
  h.assert.equal((await layersOf(page))[0].text, 'Two', 'applied in order');
  const res = await api(page, (id) => LEAgent.result(id), q1.batch);
  h.assert(res.ok && res.applied === 1, 'result() of a queued batch');
  h.assert(res.pending.results.some((x) => x.batch === q2.batch && x.ok), 'pending.results reports the other queued outcome: ' + JSON.stringify(res.pending));
  const labels = await page.evaluate(() => LEAgent._internal.feed().map((e) => e.label));
  h.assert.equal(labels.slice(-2).join(), 'first,second');
  h.assert.noErrors(page);
};

cases['the person editing mid-batch auto-pauses the agent; no operation lands inside their gesture'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }]), T());
  await page.evaluate(() => LEAgent._person.setSpeed('slow'));
  const p1 = page.evaluate(() => LEAgent.apply([{ op: 'add', layer: { id: 'a', type: 'shape', shape: 'rectangle', fill: '#E0B354', x: 100, y: 700, w: 100, h: 100 } }]));
  await page.waitForFunction(() => LEAgent._internal.A.running);
  const p2 = page.evaluate(() => LEAgent.apply([{ op: 'add', layer: { id: 'b', type: 'shape', shape: 'ellipse', fill: '#E0668E', x: 400, y: 700, w: 100, h: 100 } }]));
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => { const r = LEStudio.E.sceneEl.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  const mid = await page.evaluate(() => ({ paused: LEAgent._internal.A.paused, reason: LEAgent._internal.A.pauseReason, ids: LEStudio.scene.toJSON().layers.map((l) => l.id), opacity: LEStudio.scene.toJSON().layers.map((l) => l.opacity) }));
  h.assert(mid.paused && mid.reason === 'person-editing', 'auto-paused: ' + JSON.stringify(mid));
  h.assert(mid.ids.includes('a') && !mid.ids.includes('b'), 'the batch in flight was whole, the next one waits: ' + mid.ids);
  h.assert(mid.opacity.every((o) => o === 1), 'the animation ended on the committed values');
  await page.mouse.up();
  const r1 = await p1, r2 = await p2;
  h.assert(r1.ok && r2.queued && r2.reason === 'person-editing', 'second batch queued: ' + JSON.stringify(r2).slice(0, 200));
  h.assert(/You’re editing — Test agent is waiting/.test(await page.textContent('.sxa-bar')), 'banner explains the wait');
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  await page.click('.sxa-bar [data-act="resume"]');
  await page.waitForFunction(() => LEStudio.scene.toJSON().layers.some((l) => l.id === 'b'));
  h.assert.noErrors(page);
};

cases['Stop cancels the queue; the next call is interrupted with a fresh state'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }]), T());
  await page.click('.sxa-bar [data-act="pause"]');
  const q = page.evaluate(() => LEAgent.apply([{ op: 'update', id: 'title', set: { text: 'Never' } }]));
  await q;
  await page.click('.sxa-bar .sxa-wide-only[data-act="stop"]');
  const res = await api(page, (id) => LEAgent.result(id), (await q).batch);
  h.assert(!res.ok && res.code === 'interrupted', 'queued batch interrupted: ' + JSON.stringify(res).slice(0, 200));
  const next = await api(page, () => LEAgent.apply([BG]));
  h.assert(!next.ok && next.code === 'interrupted' && next.reason === 'The person stopped the session' && next.state && next.state.design, 'interrupted with state: ' + JSON.stringify(next).slice(0, 200));
  h.assert.equal((await layersOf(page))[0].text, 'Launch day');
  const after = await api(page, () => LEAgent.apply([BG]));
  h.assert(after.ok, 'the session continues after re-planning');
  h.assert.noErrors(page);
};

cases['Take over ends the session; the next call is refused with a readable reason'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, () => LEAgent.apply([BG]));
  await page.click('.sxa-bar [data-act="takeover"]');
  const r = await api(page, () => LEAgent.apply([{ op: 'page.background', background: '#000000' }]));
  h.assert(!r.ok && r.code === 'no-session' && r.reason === 'taken-over' && /took over/.test(r.message), JSON.stringify(r).slice(0, 300));
  const again = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'again', wait: 3000 }));
  await page.waitForSelector('.sxa-ask');
  await page.click('.sxa-ask [data-no]');
  h.assert.equal((await again).code, 'consent', 'after take over the person is asked again');
  h.assert.noErrors(page);
};

cases['undo this change: selective when sound, otherwise back to here; undo everything'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }], { label: 'title' }), T());
  await api(page, () => LEAgent.apply([{ op: 'add', layer: { id: 'badge', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 800, y: 800, w: 200, h: 200 } }], { label: 'badge' }));
  await api(page, () => LEAgent.apply([BG], { label: 'bg' }));
  const ids = await page.evaluate(() => LEAgent._internal.feed().map((e) => e.id));
  const sel = await page.evaluate((id) => LEAgent._person.undoInfo(id), ids[1]);
  h.assert(sel.selective, 'badge can be undone on its own');
  await page.evaluate(() => LEStudio.openPanel('agent'));
  await page.click('.sxa-entry[data-entry="' + ids[1] + '"] [data-undo]');
  await page.waitForFunction(() => !LEStudio.scene.toJSON().layers.some((l) => l.id === 'badge'));
  let d = await page.evaluate(() => LEStudio.scene.toJSON());
  h.assert(d.layers.some((l) => l.id === 'title') && d.background.color === '#14213D', 'only the badge went away');
  await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { color: '#E0B354' } }], { label: 'recolour' }));
  const info = await page.evaluate((id) => LEAgent._person.undoInfo(id), ids[0]);
  h.assert(!info.selective && info.later >= 2, 'title was edited later, so not selective: ' + JSON.stringify(info));
  await page.click('.sxa-entry[data-entry="' + ids[0] + '"] [data-undo]');
  await page.waitForSelector('.sxa-confirm');
  h.assert(/Undo back to here/.test(await page.textContent('.sxa-confirm')), 'honest confirm');
  await page.click('.sxa-confirm [data-tohere]');
  await page.waitForFunction(() => !LEStudio.scene.toJSON().layers.length);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }], { label: 'again' }), T({ id: 't2' }));
  await api(page, () => LEAgent.apply([BG], { label: 'bg2' }));
  const all = await page.evaluate(() => LEAgent._person.undoSession(LEAgent._internal.session().id));
  h.assert(all.ok, 'undo everything');
  d = await page.evaluate(() => LEStudio.scene.toJSON());
  h.assert(!d.layers.length && d.background.color === '#ffffff', 'everything the agent did is gone: ' + JSON.stringify(d).slice(0, 200));
  h.assert.noErrors(page);
};

cases['notes: the person pins one, the agent reads and resolves it, it survives .leproject export and import'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([BG, { op: 'add', layer: t }]), T());
  await page.click('.sxa-bar [data-act="more"]');
  await page.click('.sxa-bar [data-act="pinnote"]');
  const pt = await page.evaluate(() => { const l = LEStudio.scene.screenRect('title'); return { x: l.left + l.width / 2, y: l.top + l.height / 2 }; });
  await page.mouse.click(pt.x, pt.y);
  await page.fill('#sxa-note-text', 'make this warmer');
  await page.click('.sxa-noteedit button[type="submit"]');
  await page.waitForSelector('.sxa-pin');
  const r = await api(page, () => LEAgent.state());
  h.assert(r.pending.notes.length === 1 && r.pending.notes[0].text === 'make this warmer' && r.pending.notes[0].layer === 'title', 'note delivered on the next call: ' + JSON.stringify(r.pending));
  const r2 = await api(page, () => LEAgent.state());
  h.assert(!r2.pending.notes.length && r2.pending.openNotes === 1, 'delivered once');
  await page.fill('#sxa-quick', 'wrong logo');
  await page.press('#sxa-quick', 'Enter');
  const evNote = await api(page, () => new Promise((res) => { const off = LEAgent.on('note', (n) => { off(); res(n); }); LEAgent._person.addNote({ text: 'via event', x: 10, y: 10 }); }));
  h.assert.equal(evNote.text, 'via event');
  const list = await api(page, () => LEAgent.notes({ status: 'open' }));
  h.assert.equal(list.notes.length, 3);
  const id = list.notes[0].id;
  const done = await api(page, (i) => LEAgent.resolveNote(i, 'Warmed it up'), id);
  h.assert(done.ok && done.note.status === 'done' && done.note.reply === 'Warmed it up', 'resolved');
  await page.waitForSelector('.sxa-pin.is-done');
  const round = await page.evaluate(async () => {
    LEStudio.syncProject();
    const blob = await LE.project.exportFile(LEStudio.S.project, {});
    const p = await LE.project.importFile(new File([blob], 'x.leproject'));
    return p.meta.studio.notes;
  });
  h.assert(round.length === 3 && round.some((n) => n.status === 'done' && n.reply === 'Warmed it up' && n.layer === 'title'), 'notes survive .leproject: ' + JSON.stringify(round));
  const bad = await page.evaluate(() => LE.project.validate({ schema: LE.project.SCHEMA, v: 1, pages: [{ width: 10, height: 10, layers: [] }], meta: { studio: { notes: [{ id: 'n1', text: '<b>x</b>', status: 'weird', page: 99 }, { id: '../x', text: 'y' }, { id: 'n2', text: '' }] } } }).project.meta.studio.notes);
  h.assert(bad.length === 1 && bad[0].text === 'bx/b' && bad[0].page === 49 && bad[0].status === 'open', 'notes are sanitised: ' + JSON.stringify(bad));
  h.assert.noErrors(page);
};

cases['the person’s concurrent edit wins, is reported, and conflicting operations are refused by layer'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }, { op: 'add', layer: { id: 'badge', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 800, y: 800, w: 200, h: 200 } }]), T());
  await api(page, () => LEAgent.state());
  const from = await page.evaluate(() => { const r = LEStudio.scene.screenRect('badge'); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await h.drag(page, from, { x: from.x - 120, y: from.y - 60 });
  await page.waitForTimeout(500);
  const moved = (await layersOf(page)).find((l) => l.id === 'badge');
  h.assert(moved.x < 800, 'the person moved the badge');
  const r = await api(page, () => LEAgent.apply([{ op: 'update', id: 'badge', set: { x: 820, y: 820 } }, { op: 'update', id: 'title', set: { color: '#E0B354' } }]));
  h.assert(!r.ok && r.code === 'conflict' && r.errors[0].layer === 'badge' && /moved/.test(r.errors[0].message), 'conflict names the layer: ' + JSON.stringify(r).slice(0, 400));
  h.assert(r.pending.changes.some((c) => c.by === 'person' && c.layers.some((l) => l.id === 'badge' && l.change === 'moved')), 'the person’s edit is reported');
  h.assert.equal((await layersOf(page)).find((l) => l.id === 'badge').x, moved.x, 'their edit is kept');
  const ok = await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { color: '#E0B354' } }]));
  h.assert(ok.ok, 'after reading the change, other layers can be edited');
  await page.evaluate(() => LEStudio.scene.remove(['title']));
  await page.waitForTimeout(450);
  const gone = await api(page, () => LEAgent.apply([{ op: 'update', id: 'title', set: { size: 90 } }]));
  h.assert(gone.code === 'conflict' && /deleted/.test(gone.errors[0].message), 'deleted target: ' + JSON.stringify(gone).slice(0, 300));
  h.assert.noErrors(page);
};

cases['console channel: click, type and read give the same results as the API'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h, 'desktop', '/studio/?agent=console');
  await page.click('.sxa-ask [data-yes]');
  await page.waitForSelector('#sxa-cmd');
  const run = async (cmd) => {
    await page.fill('textarea[aria-label], #sxa-cmd', cmd);
    await page.getByRole('button', { name: 'Run' }).click();
    await page.waitForFunction(() => { const r = document.getElementById('sxa-result'); return r && r.textContent !== 'Running…'; });
    return JSON.parse(await page.getByLabel('Agent result').textContent());
  };
  h.assert.equal(await page.getByRole('log').count(), 1, 'one role=log region');
  const help = await run('{"op":"help"}');
  h.assert(help.operations && help.operations.add, 'help over the console');
  const b = await run('{"op":"begin","name":"Console agent","task":"Type only"}');
  h.assert(b.ok && b.session.name === 'Console agent', 'begin over the console');
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  const a = await run(JSON.stringify({ op: 'apply', ops: [BG, { op: 'add', layer: T() }], label: 'console batch' }));
  h.assert(a.ok && a.applied === 2 && a.summary, 'apply over the console: ' + JSON.stringify(a).slice(0, 200));
  const viaConsole = await run('{"op":"state"}');
  const viaApi = await api(page, () => LEAgent.state());
  h.assert.equal(JSON.stringify(viaConsole.design), JSON.stringify(viaApi.design), 'same design');
  const bad = await run('{"op":"apply","ops":[{"op":"explode"}]}');
  const badApi = await api(page, () => LEAgent.apply([{ op: 'explode' }]));
  h.assert.equal(JSON.stringify(bad.errors), JSON.stringify(badApi.errors), 'same errors');
  const one = await run('{"op":"update","id":"title","set":{"color":"#E0B354"}}');
  h.assert(one.ok, 'a single operation is accepted as a command');
  const junk = await run('not json');
  h.assert(!junk.ok && junk.code === 'invalid', 'bad JSON explained');
  h.assert.noErrors(page);
};

cases['readable outline matches the document; data-le-layer targets select layers'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([BG, { op: 'add', layer: t }, { op: 'add', layer: { id: 'badge', name: 'Badge', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 800, y: 800, w: 200, h: 200 } }]), T());
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => [...document.querySelectorAll('.sxa-outline li')].map((li) => [li.getAttribute('data-le-layer'), li.textContent]));
  const doc = await layersOf(page);
  h.assert.equal(out.map((o) => o[0]).join(), doc.map((l) => l.id).join(), 'one item per layer, back to front');
  h.assert(/Launch day/.test(out[0][1]) && /x \d+, y \d+, \d+ × \d+/.test(out[0][1]), 'text and position: ' + out[0][1]);
  h.assert(/navy/i.test(await page.textContent('.sxa-outline-meta')), 'page summary');
  await page.click('.sxa-hits [data-le-layer="badge"]');
  h.assert.equal(JSON.stringify(await page.evaluate(() => LEStudio.scene.selection())), '["badge"]');
  await page.waitForFunction(() => document.querySelector('.le-sel').getAttribute('data-le-layer') === 'badge');
  await page.getByRole('button', { name: /^title, text/ }).click();
  h.assert.equal(JSON.stringify(await page.evaluate(() => LEStudio.scene.selection())), '["title"]');
  h.assert.noErrors(page);
};

cases['reduced motion: changes are highlighted without moving anything'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h, 'desktop', { reducedMotion: 'reduce' });
  await api(page, (t) => LEAgent.apply([{ op: 'add', layer: t }]), T());
  await page.evaluate(() => LEAgent._person.setSpeed('slow'));
  const samples = await page.evaluate(async () => {
    const out = [];
    const p = LEAgent.apply([{ op: 'update', id: 'title', set: { y: 600 } }, { op: 'add', layer: { id: 'n', type: 'shape', shape: 'rectangle', fill: '#000', x: 0, y: 0, w: 50, h: 50 } }]);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const L = LEStudio.scene._find('title'), N = LEStudio.scene._find('n');
      out.push([L && L.y, N && N.opacity]);
    }
    await p;
    return { out, rings: document.querySelectorAll('.sxa-ring').length };
  });
  h.assert(samples.out.every((s) => s[0] === null || s[0] === 600) && samples.out.every((s) => s[1] == null || s[1] === 1), 'no travel or fade: ' + JSON.stringify(samples.out));
  h.assert(samples.rings > 0, 'highlights still shown');
  h.assert.noErrors(page);
};

cases['#ops= link applies only after the person confirms; Cancel changes nothing'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const link = await api(page, (ops) => LEAgent.toLink(ops, { name: 'Link agent', task: 'Make a navy card' }), [BG, { op: 'add', layer: T({ text: 'From a link' }) }]);
  h.assert(link.ok && /\?agent=1#ops=[zj]/.test(link.url), link.url);
  const p2 = await h.open(browser, base, link.url.replace(/^https?:\/\/[^/]+/, ''), 'desktop');
  await ready(p2);
  await p2.waitForSelector('.sxa-ask');
  if (/Turn on agent mode/.test(await p2.textContent('.sxa-ask'))) await p2.click('.sxa-ask [data-no]');
  await p2.waitForFunction(() => /Apply these changes|sent/.test((document.querySelector('.sxa-ask') || {}).textContent || ''));
  const sheet = await p2.textContent('.sxa-ask');
  h.assert(/Link agent/.test(sheet) && /Make a navy card/.test(sheet) && /Add text “From a link”/.test(sheet) && /Change the background/.test(sheet), 'the sheet shows what will change: ' + sheet);
  h.assert.equal(await p2.evaluate(() => !!LEStudio.S.project && LEStudio.scene.toJSON().layers.length), false, 'nothing before confirm');
  await p2.click('.sxa-ask [data-yes]');
  await p2.waitForFunction(() => LEStudio.S.project && LEStudio.scene.toJSON().layers.some((l) => l.text === 'From a link'));
  h.assert(!/#ops=/.test(await p2.evaluate(() => location.href)), 'the link is cleared from the address bar');
  const feed = await p2.evaluate(() => LEAgent._internal.feed());
  h.assert(feed.length === 1 && feed[0].source === 'link', 'shown in the feed as a link batch');
  const p3 = await h.open(browser, base, link.url.replace(/^https?:\/\/[^/]+/, '').replace('?agent=1', ''), 'desktop');
  await ready(p3);
  await p3.waitForSelector('.sxa-ask');
  await p3.click('.sxa-ask [data-no]');
  await p3.waitForTimeout(300);
  h.assert.equal(await p3.evaluate(() => !!LEStudio.S.project && LEStudio.scene.toJSON().layers.length), false, 'Cancel changes nothing');
  h.assert.noErrors(p2);
};

cases['applyExternal (live link / bridge) shows in the feed and obeys pause'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await api(page, () => LEAgent.applyExternal({ format: 'localeditor-design', version: 1, name: 'From disk', pages: [{ width: 800, height: 600, background: '#FFF3E2', layers: [{ id: 't', type: 'text', text: 'Hello', x: 'center', y: 'center' }] }] }, { source: 'le-link', name: 'design.ledesign.json' }));
  h.assert(r.ok, JSON.stringify(r).slice(0, 300));
  h.assert.equal(await page.evaluate(() => LEStudio.scene.toJSON().width), 800);
  await page.evaluate(() => LEAgent._person.pause());
  const q = await api(page, () => LEAgent.applyExternal([{ op: 'update', id: 't', set: { text: 'Later' } }], { source: 'le-link' }));
  h.assert(q.queued && q.paused, 'queued while paused');
  await page.evaluate(() => LEAgent._person.resume());
  await page.waitForFunction(() => LEStudio.scene.toJSON().layers[0].text === 'Later');
  const feed = await page.evaluate(() => LEAgent._internal.feed());
  h.assert(feed.length === 2 && feed[0].source === 'le-link' && feed[0].agent === 'design.ledesign.json', 'feed: ' + JSON.stringify(feed).slice(0, 200));
  h.assert.noErrors(page);
};

cases['reload mid-session: changes and notes persist, the session is ended, the next call says no-session'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([BG, { op: 'add', layer: t }]), T());
  await page.evaluate(() => LEAgent._person.addNote({ text: 'keep me', x: 10, y: 10 }));
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await ready(page);
  await page.waitForFunction(() => LEStudio.S.project);
  const r = await api(page, () => LEAgent.state());
  h.assert(!r.ok && r.code === 'no-session' && r.reason === 'reload' && typeof r.rev === 'number' && r.rev >= 1, JSON.stringify(r).slice(0, 300));
  const d = await page.evaluate(() => ({ layers: LEStudio.scene.toJSON().layers.map((l) => l.id), notes: (LEStudio.S.project.meta.studio.notes || []).map((n) => n.text) }));
  h.assert(d.layers.includes('title') && d.notes.includes('keep me'), 'committed work and notes are saved: ' + JSON.stringify(d));
  h.assert.noErrors(page);
};

cases['headless switch: no consent sheet, no UI, load and save round trip, nothing saved to the person’s designs'] = async ({ browser, base, h }) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => { window.LE_AGENT_HEADLESS = true; });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
  await ready(page);
  const png = await tinyPng(page);
  const r = await page.evaluate(async (png) => {
    const t0 = performance.now();
    const loaded = await LEAgent.load({ format: 'localeditor-design', version: 1, name: 'CLI design', pages: [{ width: 1080, height: 1080, background: '#14213D', layers: [{ id: 'title', type: 'text', text: 'Headless', color: '#FFFFFF', x: 'center', y: 100 }, { id: 'hero', type: 'image', src: png, x: 0, y: 300, w: 400, h: 300 }] }] });
    const ap = await LEAgent.apply([{ op: 'update', id: 'title', set: { size: 90 } }]);
    const saved = await LEAgent.save({ images: 'embed' });
    const paths = await LEAgent.save({ images: 'paths' });
    await new Promise((r) => setTimeout(r, 1200));
    return { loaded, ap, saved, paths, ms: performance.now() - t0, list: await LE.project.list(), ui: !!document.querySelector('.sxa-bar, .sxa-ask'), json: JSON.stringify(loaded).length };
  }, png);
  h.assert(r.loaded.ok && r.loaded.design.name === 'CLI design', 'load: ' + JSON.stringify(r.loaded).slice(0, 200));
  h.assert(r.ap.ok, 'apply');
  h.assert(/"size": 90/.test(r.saved.text) && /data:image\/png;base64/.test(r.saved.text), 'save embeds');
  h.assert(r.paths.assets.length === 1 && /^data:image\/png/.test(r.paths.assets[0].dataUrl) && /assets\//.test(r.paths.assets[0].path), 'save paths: ' + JSON.stringify(r.paths.assets).slice(0, 200));
  h.assert(!r.ui, 'no watching UI in headless mode');
  h.assert.equal(r.list.length, 0, 'nothing saved to the person’s designs');
  h.assert(r.ms < 8000, 'fast: ' + r.ms);
  h.assert(page.errors.length === 0, page.errors.join('\n'));
  await ctx.close();
};

cases['nothing in agent mode makes a cross-origin request'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h, 'desktop', '/studio/?agent=1');
  const outside = [];
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) outside.push(u); });
  await page.click('.sxa-ask [data-yes]');
  await api(page, () => LEAgent.begin({ name: 'Net agent', task: 'stay local' }));
  await page.evaluate(() => LEAgent._person.setSpeed('normal'));
  await api(page, (t) => LEAgent.apply([BG, { op: 'add', layer: t }, { op: 'add', layer: { id: 'i', type: 'icon', icon: 'lucide:rocket', x: 20, y: 20, w: 80 } }]), T());
  await api(page, async () => { await LEAgent.state({ image: true }); await LEAgent.check(); await LEAgent.catalog('icons', 'star'); await LEAgent.catalog('makers'); await LEAgent.export({ format: 'png', scale: 0.25 }); await LEAgent.end({ summary: 'done' }); });
  h.assert.equal(outside.join('\n'), '', 'cross-origin requests');
  h.assert.noErrors(page);
};

cases['state({ image }) and export() return data URLs; end() shows the summary'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h);
  await api(page, (t) => LEAgent.apply([BG, { op: 'add', layer: t }]), T());
  const r = await api(page, async () => ({ st: await LEAgent.state({ image: 256 }), ex: await LEAgent.export({ format: 'jpeg', scale: 0.5 }) }));
  h.assert(/^data:image\/png;base64,/.test(r.st.image), 'state image');
  h.assert(/^data:image\/jpeg;base64,/.test(r.ex.dataUrl) && r.ex.width === 540, 'export: ' + JSON.stringify(Object.assign({}, r.ex, { dataUrl: (r.ex.dataUrl || '').slice(0, 30) })));
  const e = await api(page, () => LEAgent.end({ summary: 'Made a launch post' }));
  h.assert(e.ok && e.ended, 'end');
  await page.waitForFunction(() => /Made a launch post/.test(document.querySelector('.sxa-bar').textContent));
  h.assert.noErrors(page);
};

cases['phone: banner fits 360 px with 44 px targets, no sideways scroll, panel tabs work'] = async ({ browser, base, h }) => {
  const page = await session(browser, base, h, 'small');
  await api(page, (t) => LEAgent.apply([BG, { op: 'add', layer: t }]), T());
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  const small = await page.evaluate(() => [...document.querySelectorAll('.sxa-bar button, .sxa-pin')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.getAttribute('data-act') || b.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }).filter((x) => x[1] < 44 || x[2] < 44));
  h.assert(!small.length, 'small targets: ' + JSON.stringify(small));
  const bar = await page.evaluate(() => { const r = document.querySelector('.sxa-bar').getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
  h.assert(bar[0] >= 0 && bar[1] <= bar[2], 'banner inside the screen: ' + bar);
  await page.click('.sxa-bar [data-act="more"]');
  h.assert(await page.isVisible('#sxa-quick'), 'note field on phone');
  h.assert(await h.noOverflow(page), 'no sideways scroll with the controls open');
  await page.click('.sxa-bar [data-act="feed"]');
  await page.waitForSelector('.sxa-tabs');
  await page.click('#sxa-tab-console');
  h.assert(await page.isVisible('#sxa-cmd'), 'console on phone');
  h.assert(await h.noOverflow(page), 'no sideways scroll with the panel open');
  h.assert.noErrors(page);
};

cases['dark theme: banner and panel use tokens (readable text)'] = async ({ browser, base, h }) => {
  const page = await h.openTheme(browser, base, '/studio/', 'desktop', 'dark');
  await ready(page);
  const p = page.evaluate(() => LEAgent.begin({ name: 'Dark agent', task: 'Night mode' }));
  await page.click('.sxa-ask [data-yes]');
  await p;
  const c = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.sxa-bar')); const t = getComputedStyle(document.querySelector('.sxa-who strong')); return [s.backgroundColor, t.color]; });
  h.assert(c[0] !== 'rgb(255, 255, 255)' && /rgb\(2[0-9]{2}/.test(c[1]), 'dark banner: ' + c);
  h.assert.noErrors(page);
};

module.exports = cases;
