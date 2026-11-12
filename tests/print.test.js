'use strict';
/* Print set: paper sizes and doc.print, calendar date maths, cut marks as layers, label sheets, mini-zine imposition,
   catalogue tables and pagination (3 and 300 rows), multi-page makes, and PDF pages at the real paper size. */

const PHOTOS = ['travel-08', 'still-02', 'people-07', 'travel-07'];

async function studio(h, browser, base, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudioMakers && window.LE.makers);
  await page.evaluate(() => LE.makers.ready());
  return page;
}

const cases = {};

cases['paper sizes are 300 dpi, fit every device canvas, and built pages carry doc.print'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const P = LE.makers.PAPER, out = {};
    Object.keys(P).forEach((id) => { const s = LE.makers.paperSize(id); out[id] = [s.w, s.h, s.print.w, s.print.h, s.print.dpi]; });
    const b = await LE.makers.build('calendar', { month: '2', year: 2024 }, { size: 'letter', style: 'clean' });
    const prints = LE.makers.list().filter((m) => m.category === 'Print').map((m) => m.sizes.every((s) => s.print && s.w <= 4096 && s.h <= 4096 && s.w * s.h <= 16777216));
    return { out, print: b.pages[0].print, w: b.pages[0].width, h: b.pages[0].height, prints };
  });
  h.assert.equal(r.out.a4.join(), '2480,3508,210,297,300');
  h.assert.equal(r.out.letter.join(), '2550,3300,215.9,279.4,300');
  h.assert.equal(r.out.a5.join(), '1748,2480,148,210,300');
  h.assert.equal(r.out['photo-4x6'].join(), '1200,1800,101.6,152.4,300');
  h.assert.equal(r.out['a4-landscape'].join(), '3508,2480,297,210,300');
  h.assert.equal(JSON.stringify(r.print), JSON.stringify({ v: 1, paper: 'letter', w: 215.9, h: 279.4, dpi: 300 }));
  h.assert.equal(r.w + 'x' + r.h, '2550x3300');
  h.assert(r.prints.length >= 7 && r.prints.every(Boolean), 'every print size fits a 4096 px edge and 16.7 MP');
};

cases['calendar date maths: leap years, week starts, six-week months, weeks across years'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const D = LE.makers.date;
    const sum = (y, m, ws) => { const g = D.monthGrid(y, m, ws); return { rows: g.length, lead: g[0].findIndex((d) => d.inMonth), days: g.flat().filter((d) => d.inMonth).length, last: g[g.length - 1].filter((d) => d.inMonth).length }; };
    const cal = await LE.makers.build('calendar', { kind: 'month', month: '2', year: 2024, weekStart: 'mon' }, { size: 'a4', style: 'clean' });
    const L = cal.pages[0].layers;
    const x = (iso) => { const l = L.find((q) => q.id === 'day-' + iso); return l ? l.x : null; };
    const wk = await LE.makers.build('calendar', { kind: 'week', week: '2026-01-01', weekStart: 'mon' }, { size: 'a4', style: 'clean' });
    const wkSun = await LE.makers.build('calendar', { kind: 'week', week: '2026-01-01', weekStart: 'sun' }, { size: 'a4-landscape', style: 'friendly' });
    return {
      feb24: sum(2024, 2, 1), feb23: sum(2023, 2, 1), feb24sun: sum(2024, 2, 0), sep24sun: sum(2024, 9, 0), mar25: sum(2025, 3, 1), feb15: sum(2015, 2, 0),
      feb1900: D.daysIn(1900, 2), feb2000: D.daysIn(2000, 2),
      thuCol: x('2024-02-01') > x('2024-02-29') - 1 && x('2024-02-29') === x('2024-02-01'), mon5: x('2024-02-05') < x('2024-02-01'),
      has29: !!L.find((q) => q.id === 'day-2024-02-29'), no30: !L.find((q) => q.id === 'day-2024-02-30'),
      weekOf: D.iso(D.weekOf('2026-01-01', 1)), weekOfSun: D.iso(D.weekOf('2026-01-01', 0)), wkName: wk.name, wkSunName: wkSun.name,
      weekdays: D.weekdays(0, 'ddd').join(','), wd: D.weekday('2024-02-29'),
      problems: LE.makers.check(cal.pages[0]).length + LE.makers.check(wk.pages[0]).length + LE.makers.check(wkSun.pages[0]).length
    };
  });
  h.assert.equal(JSON.stringify(r.feb24), JSON.stringify({ rows: 5, lead: 3, days: 29, last: 4 }), 'Feb 2024 starts on Thursday, 29 days');
  h.assert.equal(r.feb23.days, 28);
  h.assert.equal(r.feb24sun.lead, 4, 'Sunday-first weeks move Thursday to column 5');
  h.assert.equal(r.sep24sun.lead, 0, '1 Sep 2024 is a Sunday');
  h.assert.equal(r.mar25.rows, 6, 'March 2025 (Monday weeks) needs six rows');
  h.assert.equal(r.feb15.rows, 4, 'Feb 2015 (Sunday weeks) fits four rows exactly');
  h.assert.equal(r.feb1900, 28, '1900 is not a leap year');
  h.assert.equal(r.feb2000, 29, '2000 is a leap year');
  h.assert(r.thuCol && r.mon5 && r.has29 && r.no30, 'days sit in their weekday columns');
  h.assert.equal(r.weekOf, '2025-12-29');
  h.assert.equal(r.weekOfSun, '2025-12-28');
  h.assert(/29 Dec – 4 Jan 2025\/26/.test(r.wkName), r.wkName);
  h.assert(/28 Dec – 3 Jan/.test(r.wkSunName), r.wkSunName);
  h.assert.equal(r.weekdays, 'Sun,Mon,Tue,Wed,Thu,Fri,Sat');
  h.assert.equal(r.wd, 4);
  h.assert.equal(r.problems, 0);
};

cases['cut marks are a named group of ordinary layers around every cell edge, and the toggle removes them'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const on = await LE.makers.build('labels', { lines: ['Jam'], grid: '21' }, { size: 'a4', style: 'clean' });
    const off = await LE.makers.build('labels', { lines: ['Jam'], grid: '21', guides: false }, { size: 'a4', style: 'clean' });
    const tags = await LE.makers.build('labels', { kind: 'tags', lines: ['For you'] }, { size: 'letter', style: 'kraft' });
    const pg = on.pages[0], L = pg.layers;
    const g = L.find((l) => l.type === 'group' && l.name === 'Cut marks');
    const members = L.filter((l) => g && l.groupId === g.id);
    const labels = L.filter((l) => /^text-\d+$/.test(l.id));
    const cells = LE.makers.labelGrid('a4', 21);
    const mm = 300 / 25.4;
    const crop = members.filter((l) => /^Crop marks/.test(l.name));
    const svgTicks = crop.reduce((n, l) => n + (l.svg.match(/M/g) || []).length, 0);
    const inPage = members.every((l) => l.x >= 0 && l.y >= 0 && l.x + l.w <= pg.width && l.y + l.h <= pg.height);
    const firstIdx = L.indexOf(members[0]), designIdx = L.findIndex((l) => /^text-/.test(l.id));
    const tg = tags.pages[0].layers;
    const holes = tg.filter((l) => l.type === 'shape' && /^Punch hole/.test(l.name));
    const holeGroup = tg.find((l) => l.type === 'group' && l.name === 'Punch holes');
    return {
      group: !!g, kinds: members.map((l) => l.type + ':' + l.name.replace(/^Crop marks \w+$/, 'Crop marks')).filter((v, i, a) => a.indexOf(v) === i).sort().join('|'),
      labels: labels.length, ticks: svgTicks, inPage, under: firstIdx < designIdx, cell: [cells.cols, cells.rows, cells.w, cells.h].join(),
      offGroup: off.pages[0].layers.some((l) => l.type === 'group'), holes: holes.length, holeGroup: !!holeGroup && holes.every((x) => x.groupId === holeGroup.id),
      holesOnTop: tg.indexOf(holes[0]) > tg.findIndex((l) => /^Tag /.test(l.name)),
      problems: LE.makers.check(pg).length + LE.makers.check(tags.pages[0]).length,
      labelW: Math.round(L.find((l) => l.id === 'frame-1').w / mm * 10) / 10
    };
  });
  h.assert(r.group, 'Cut marks group');
  h.assert(/svg:Crop marks/.test(r.kinds) && /svg:Cut lines/.test(r.kinds), r.kinds);
  h.assert.equal(r.labels, 21);
  h.assert.equal(r.cell, '3,7,63.5,38.1');
  /* 3 columns with gutters: 6 distinct x edges top and bottom; 8 y edges left and right (no row gutter). */
  h.assert.equal(r.ticks, 6 * 2 + 8 * 2, 'one tick per cell edge per side');
  h.assert(r.inPage, 'marks stay on the sheet');
  h.assert(r.under, 'guides sit under the design');
  h.assert(!r.offGroup, 'toggle off: no guides');
  h.assert.equal(r.holes, 9, 'nine tags, nine punch holes');
  h.assert(r.holeGroup && r.holesOnTop, 'punch holes grouped, above the tags');
  h.assert.equal(r.problems, 0);
};

cases['mini zine imposition: each page in its panel, top row turned 180°'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const panels = LE.makers.print.zine(3508, 2480);
    const vals = { title: 'Our street', photos: [], pages: ['two', 'three', 'four', 'five', 'six', 'seven'], back: 'The back' };
    const z = await LE.makers.build('zine', vals, { size: 'a4-landscape', style: 'classic' });
    const L = z.pages[0].layers;
    const where = (id) => { const l = L.find((q) => q.id === id); const cx = l.x + l.w / 2, cy = l.y + l.h / 2; return { col: Math.floor(cx / (3508 / 4)), row: Math.floor(cy / (2480 / 2)), rot: l.rotation }; };
    const words = {};
    for (let n = 2; n <= 7; n++) words[n] = where('words-' + n);
    const folds = L.find((l) => l.name === 'Fold lines'), cut = L.find((l) => l.name === 'Cut here');
    return { panels: panels.map((p) => [p.page, p.x, p.y, p.rotation].join(':')), title: where('title'), back: where('back'), words, folds: !!folds, cut: cut && [Math.round(cut.x), Math.round(cut.y), Math.round(cut.w)].join(), problems: LE.makers.check(z.pages[0]).length };
  });
  h.assert.equal(r.panels.join(' '), '1:2631:1240:0 2:2631:0:180 3:1754:0:180 4:877:0:180 5:0:0:180 6:0:1240:0 7:877:1240:0 8:1754:1240:0');
  h.assert.equal(JSON.stringify(r.title), JSON.stringify({ col: 3, row: 1, rot: 0 }), 'front cover bottom right, upright');
  h.assert.equal(JSON.stringify(r.back), JSON.stringify({ col: 2, row: 1, rot: 0 }), 'back cover next to it');
  const expect = { 2: [3, 0, 180], 3: [2, 0, 180], 4: [1, 0, 180], 5: [0, 0, 180], 6: [0, 1, 0], 7: [1, 1, 0] };
  Object.keys(expect).forEach((n) => h.assert.equal([r.words[n].col, r.words[n].row, r.words[n].rot].join(), expect[n].join(), 'page ' + n));
  h.assert(r.folds, 'fold lines');
  h.assert(/^\d+,1240,\d+$/.test(r.cut) || /^\d+,123\d,\d+$/.test(r.cut), 'the cut runs along the middle: ' + r.cut);
  h.assert.equal(r.problems, 0);
};

cases['catalogue: table input, column matching, prices, photos by file name, 3 and 300 rows paginate'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const T = LE.makers.table, M = LE.makers.catalogueMoney;
    const grid = T.parse('Product,Cost,Notes,Section,Image,SKU\n"Mug, large",18,"Says ""hi""",Cups,mug.jpg,A1\nBowl,22.5,,Bowls,,A2');
    const cols = LE.makers.get('catalogue').inputs.find((i) => i.key === 'items').columns;
    const match = T.match(cols, grid);
    const rows = T.rows(cols, grid, match, 300).rows;
    const many = [];
    for (let i = 0; i < 300; i++) many.push(['Item number ' + (i + 1), String(10 + i), i % 3 ? 'A short description of item ' + (i + 1) : '', 'Group ' + (1 + Math.floor(i / 40)), '', 'C' + i]);
    const ok = LE.makers.validate('catalogue', { business: 'Shop', items: many });
    const tooMany = LE.makers.validate('catalogue', { business: 'Shop', items: many.concat([['One more', '1']]) });
    const tooLong = LE.makers.validate('catalogue', { business: 'Shop', items: [['x'.repeat(61), '1']] });
    const packed = ok.values.items;
    const meta = LE.Scene.makerOf({ id: 'catalogue', values: ok.values });
    const round = T.unpack(meta.values.items, 6);
    const count = async (kind, items, size) => {
      const b = await LE.makers.build('catalogue', { kind, business: 'Shop', items, cover: true }, { size: size || 'a4', style: 'clean' });
      const names = [];
      let problems = 0;
      b.pages.forEach((p) => { problems += LE.makers.check(p).length; p.layers.forEach((l) => { if (l.id.indexOf('name') === 0 && /^Item number/.test(l.text)) names.push(l.text); }); });
      return { pages: b.pages.length, names: names.length, unique: new Set(names).size, problems, warn: b.warnings.length, sizes: b.pages.every((p) => p.print && p.print.paper === (size || 'a4')) };
    };
    const three = await count('catalogue', many.slice(0, 3));
    const cat300 = await count('catalogue', many);
    const list300 = await count('pricelist', many, 'letter');
    const menu300 = await count('menu', many, 'a5');
    const ph = await LE.makers.build('catalogue', { business: 'Shop', items: [['Mug', '1', '', '', 'still-02.jpg'], ['Cup', '2', '', '', 'travel-08'], ['Bowl', '3', '', '', 'nothing.png']], photos: ['sample:travel-08', 'sample:still-02'] }, { size: 'a4', style: 'clean', names: { 'sample:travel-08': 'travel-08.jpg', 'sample:still-02': 'still-02.jpg' } });
    const slots = ph.pages[1].layers.filter((l) => l.type === 'image').map((l) => l.src);
    return {
      header: match.header, map: cols.map((c) => match.map[c.key]).join(), rows: rows.map((x) => x.join('|')),
      ok: ok.ok, chunks: packed.length, maxChunk: Math.max.apply(null, packed.map((s) => s.length)), tooMany: tooMany.ok, tooLong: tooLong.ok, round: round.length === 300 && round[299][0] === 'Item number 300',
      three, cat300, list300, menu300, slots,
      money: [M('18', 'gbp'), M('1234.5', 'usd'), M('1.234,50', 'eur'), M('1,234', 'plain'), M('about 5', 'gbp'), M('£4', 'usd'), M('12', 'as'), M('-3', 'gbp')]
    };
  });
  h.assert(r.header, 'header row found');
  h.assert.equal(r.map, '0,1,2,3,4,5', 'Product/Cost/Notes/Section/Image/SKU matched by alias');
  h.assert.equal(r.rows[0], 'Mug, large|18|Says "hi"|Cups|mug.jpg|A1');
  h.assert.equal(r.rows[1], 'Bowl|22.5||Bowls||A2');
  h.assert(r.ok && r.chunks > 1 && r.chunks <= 40 && r.maxChunk <= 2000, 'packed into ' + r.chunks + ' chunks');
  h.assert(r.round, '300 rows survive doc.maker sanitising');
  h.assert(r.tooMany === false && r.tooLong === false, 'over the limits is rejected');
  h.assert.equal(r.three.pages, 2, '3 rows: cover and one page');
  h.assert.equal(r.three.names, 3);
  [['cat300', r.cat300], ['list300', r.list300], ['menu300', r.menu300]].forEach(([n, c]) => {
    h.assert.equal(c.names, 300, n + ' shows every row');
    h.assert.equal(c.unique, 300, n + ' shows every row once');
    h.assert.equal(c.problems, 0, n + ' problems');
    h.assert(c.sizes, n + ' print meta');
    h.assert(c.pages > 3 && c.pages <= 50, n + ' pages ' + c.pages);
  });
  h.assert.equal(r.slots.join(), 'sample:still-02,sample:travel-08,', 'photos matched by file name, unmatched stays an empty slot');
  h.assert.equal(r.money.join('|'), '£18.00|$1,234.50|1.234,50 €|1,234.00|about 5|£4|12|−£3.00');
};

cases['photo book: varied pages with page numbers; a multi-page make lands as pages and remakes in place'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const b = await LE.makers.build('photobook', LE.makers.get('photobook').sample.values, { size: 'a5', style: 'classic' });
    const kinds = b.pages.map((p) => p.layers.filter((l) => l.type === 'image').length);
    const folios = b.pages.map((p) => (p.layers.find((l) => l.name === 'Page number') || {}).text || '');
    await LEStudioMakers.open('photobook', { values: { title: 'Trip', pages: '8' }, size: 'square-20' });
    await new Promise((res) => setTimeout(res, 400));
    await LEStudioMakers.make();
    await new Promise((res) => setTimeout(res, 300));
    const c = LEStudio;
    c.syncProject();
    const made = c.S.project.pages.map((p) => [p.maker && p.maker.id, p.print && p.print.paper, p.width]);
    /* Remake from page 3 with 12 pages: the run is replaced, grown to 12. */
    c.switchPage(2);
    await LEStudioMakers.edit();
    await new Promise((res) => setTimeout(res, 300));
    LEStudioMakers.form().values.pages = '12';
    LEStudioMakers.form().values.title = 'Trip, again';
    await LEStudioMakers.make();
    await new Promise((res) => setTimeout(res, 300));
    c.syncProject();
    const remade = c.S.project.pages.map((p) => p.maker && p.maker.values.title);
    return { n: b.pages.length, kinds, folios, problems: b.pages.reduce((a, p) => a + LE.makers.check(p).length, 0), made, remade, active: c.S.project.activePage };
  });
  h.assert.equal(r.n, 12);
  h.assert(new Set(r.kinds.slice(1, -1)).size >= 3, 'inside pages vary: ' + r.kinds.join(','));
  h.assert.equal(r.folios[0], '', 'no number on the cover');
  h.assert.equal(r.folios[2], '3');
  h.assert.equal(r.problems, 0);
  h.assert.equal(r.made.length, 8, 'eight pages made');
  h.assert(r.made.every((m) => m[0] === 'photobook' && m[1] === 'square-20' && m[2] === 2362), JSON.stringify(r.made[0]));
  h.assert.equal(r.remade.length, 12, 'remake grew the run to 12 pages');
  h.assert(r.remade.every((t) => t === 'Trip, again'), 'every page remade');
  h.assert.equal(r.active, 0);
  h.assert.noErrors(page);
};

cases['the table field reads pasted cells and maps columns'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(() => LEStudioMakers.open('catalogue'));
  await page.waitForSelector('.mk-table textarea');
  await page.fill('.mk-table textarea', 'Item\tPrice each\tDetails\nTea\t3\tA pot for one\nCake\t4.5\tLemon drizzle');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    rows: LEStudioMakers.form().values.items, selects: document.querySelectorAll('.mk-map select').length,
    name: document.querySelector('.mk-map select').value, note: document.querySelector('.mk-table .mk-hint').textContent
  }));
  h.assert.equal(JSON.stringify(r.rows), JSON.stringify([['Tea', '3', 'A pot for one', '', '', ''], ['Cake', '4.5', 'Lemon drizzle', '', '', '']]));
  h.assert.equal(r.selects, 6);
  h.assert.equal(r.name, '0');
  h.assert(/2 rows/.test(r.note), r.note);
  /* Remap: price from "What it is" just to see the mapping drive the rows. */
  await page.selectOption('.mk-map label:nth-child(2) select', '2');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => LEStudioMakers.form().values.items[0][1]);
  h.assert.equal(after, 'A pot for one');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  h.assert.noErrors(page);
};

cases['PDF pages have the paper size in points at 100%, and doc.print survives undo and .leproject'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(async () => {
    await LEStudioMakers.open('calendar', { size: 'a4', style: 'clean', values: { month: '3', year: 2027 } });
    await new Promise((res) => setTimeout(res, 300));
    await LEStudioMakers.make();
  });
  await page.waitForFunction(() => LEStudio.scene.toJSON().print);
  /* A Letter page and a plain social page in the same design. */
  await page.evaluate(async () => {
    await LEStudioMakers.open('labels', { size: 'letter' });
    await new Promise((res) => setTimeout(res, 300));
    await LEStudioMakers.make();
    await new Promise((res) => setTimeout(res, 300));
    await LEStudioMakers.open('quote', { size: 'square' });
    await new Promise((res) => setTimeout(res, 300));
    await LEStudioMakers.make();
    await new Promise((res) => setTimeout(res, 300));
  });
  const meta = await page.evaluate(async () => {
    const c = LEStudio;
    c.switchPage(0);
    const id = c.scene.layers().find((l) => l.type === 'text').id;
    c.scene.update(id, { x: 10 });
    c.scene.undo();
    c.scene.redo();
    const after = c.scene.toJSON().print;
    c.syncProject();
    const blob = await LE.project.exportFile(c.S.project, {});
    const p = await LE.project.importFile(new File([blob], 'x.leproject'));
    return { after, imported: p.pages.map((x) => x.print ? x.print.paper : '-').join(), pages: c.S.project.pages.length };
  });
  h.assert(meta.after && meta.after.paper === 'a4', 'doc.print through undo/redo');
  h.assert.equal(meta.imported, 'a4,letter,-', '.leproject keeps doc.print');
  const dl = await h.capture(page, () => page.evaluate(() => LEStudio.exportImage({ format: 'pdf', pages: 'all', name: 'print-test' })), 60000);
  const info = await h.pdfRead(browser, base, dl.buf);
  h.assert.equal(info.pages, 3);
  h.assert.equal(info.sizes[0].join('x'), '595x842', 'A4 page is 210 × 297 mm');
  h.assert.equal(info.sizes[1].join('x'), '612x792', 'Letter page is 8.5 × 11 in');
  h.assert.equal(info.sizes[2].join('x'), '810x810', 'a social page keeps 96 dpi (1080 px = 810 pt)');
  /* The export panel says so, and offers Print. */
  await page.evaluate(() => { LEStudio.switchPage(0); LEStudio.S.exportOpts.format = 'pdf'; LEStudio.openPanel('export', { tab: 'image' }); });
  await page.waitForTimeout(400);
  const ui = await page.evaluate(() => ({ note: document.querySelector('.sx-panel-body, .sxe-body').textContent, print: !!document.querySelector('[data-act="print"]') }));
  h.assert(/A4, 210 × 297 mm, at 100% scale/.test(ui.note), 'print-ready note');
  h.assert(ui.print, 'Print action');
  h.assert.noErrors(page);
};

module.exports = cases;
