'use strict';
/* The Chart panel (docs/CHARTS.md): CSV and Excel in → a suggestion → a chart on the canvas; type, theme and highlight in one
   tap; editing the numbers; phones at 360 and 390 px; nothing fetched before the panel opens; the ways in; and the two
   reference posters made from data through the chart poster maker (saved as PNG to look at). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cases = {};
const FX = (n) => path.join(__dirname, 'fixtures', n);
const OUT = process.env.CHARTS_OUT || path.join(os.tmpdir(), 'localeditor-charts');

function watch(page, base) {
  page.urls = [];
  page.on('request', (r) => page.urls.push(r.url().replace(base, '')));
  page.saw = (re) => page.urls.some((u) => re.test(u));
}
async function studio(h, browser, base, vp) {
  const page = await h.newDesign(browser, base, vp || 'desktop', 'Instagram post');
  watch(page, base);
  return page;
}
const chartOf = (page) => page.evaluate(() => { const L = window.LEStudio.scene.layers(), g = L.find((l) => l.type === 'group' && l.chart); return g ? { id: g.id, chart: g.chart, kids: L.filter((l) => l.groupId === g.id).length, texts: L.filter((l) => l.groupId === g.id && l.type === 'text').map((l) => l.text) } : null; });
const openChart = async (page) => { await page.evaluate(() => window.LEStudio.openPanel('chart')); await page.waitForSelector('.cx-drop'); };
const pick = (page, file) => page.setInputFiles('.cx-drop input[type=file]', file);

cases['nothing is fetched before the panel opens; a design with a chart draws and exports without the chart code'] = async ({ browser, base, h }) => {
  /* make a chart in one studio… */
  const a = await studio(h, browser, base);
  h.assert(!a.saw(/le-charts\.js|le-studio-charts|studio-charts\.css|xlsx\.full/), 'no chart code before the panel is asked for: ' + a.urls.filter((u) => /chart/.test(u)));
  await openChart(a);
  h.assert(a.saw(/le-charts\.js/) && a.saw(/le-studio-charts\.js/) && a.saw(/studio-charts\.css/), 'the panel brings its own files');
  h.assert(!a.saw(/xlsx\.full/), 'the Excel reader waits for an Excel file');
  await a.click('.cx-card[data-type="donut"]');
  await a.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.chart));
  const doc = await a.evaluate(() => window.LEStudio.scene.toJSON());
  /* …and open it in another that has never loaded the chart code */
  const b = await studio(h, browser, base);
  await b.evaluate((d) => { window.LEStudio.replaceDoc(d, true); }, doc);
  await b.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.chart));
  const shot = await b.evaluate(async () => { const cv = await window.LEStudio.scene.render(0.25, { includeBackground: true }); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let blue = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 70 && d[i + 1] > 70 && d[i + 1] < 130 && d[i + 2] > 200) blue++; return blue; });
  h.assert(shot > 400, 'the donut is on the rendered page (' + shot + ' accent pixels)');
  h.assert(!b.saw(/le-charts\.js|le-studio-charts/), 'drawing and rendering a chart needs no chart code: ' + b.urls.filter((u) => /chart/.test(u)));
  /* selecting it offers "Edit chart"; that is what loads the panel */
  await b.evaluate(() => { const g = window.LEStudio.scene.layers().find((l) => l.chart); window.LEStudio.scene.select([g.id]); });
  await b.waitForSelector('[data-cmd="chart:edit"]');
  h.assert(!b.saw(/le-charts\.js/), 'the chip alone loads nothing');
  await b.click('[data-cmd="chart:edit"]');
  await b.waitForSelector('.cx-themes .cx-theme');
  h.assert.equal(await b.evaluate(() => window.LEStudio.S.panel), 'chart');
  h.assert(await b.locator('.cx-chip', { hasText: 'Search' }).count() > 0, 'the panel shows this chart: its rows can be highlighted');
  h.assert.noErrors(a); h.assert.noErrors(b);
};

cases['a CSV file: what was read, cells to fix, ranked suggestions, a chart on the canvas; then type, theme, highlight and the numbers'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await openChart(page);
  await pick(page, FX('chart-sales.csv'));
  await page.waitForSelector('.cx-list .cx-card');
  const seen = await page.evaluate(() => ({ sum: document.querySelector('.cx-sum').textContent, bad: (document.querySelector('.cx-bad') || {}).textContent || '', cards: [...document.querySelectorAll('.cx-list .cx-card')].map((c) => c.getAttribute('data-type') + ': ' + c.querySelector('small').textContent) }));
  h.assert(/6 rows · 3 columns · chart-sales\.csv/.test(seen.sum) && /Month \(dates\), Sales \(numbers\), Returns \(numbers\)/.test(seen.sum), 'what was read, in words: ' + seen.sum);
  h.assert(/1 cell to check/.test(seen.bad) && /Row 4, Sales: “n\/a” is not a number/.test(seen.bad), 'the cell that is not a number is listed: ' + seen.bad);
  h.assert(/^line: 2 series over 6 months: lines compare the trends\./.test(seen.cards[0]) && seen.cards.length >= 4, 'ranked suggestions with reasons: ' + seen.cards.join(' | '));
  h.assert(!page.saw(/xlsx\.full/), 'a CSV does not load the Excel reader');
  await page.waitForFunction(() => document.querySelectorAll('.cx-list .cx-thumb canvas').length >= 3);   /* live thumbnails */
  /* Fix here: the grid opens on that cell */
  await page.click('.cx-bad .cx-fix');
  await page.waitForSelector('.cx-table .cx-cell.is-bad');
  h.assert.equal(await page.evaluate(() => document.querySelector('.cx-cell.is-bad').value), 'n/a');
  await page.fill('.cx-cell.is-bad', '1,500');
  await page.click('.cx-actions [data-a="done"]');
  await page.waitForSelector('.cx-list .cx-card');
  h.assert(!(await page.locator('.cx-bad').count()), 'nothing left to check');
  await page.click('.cx-list .cx-card >> nth=0');
  await page.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.chart));
  let g = await chartOf(page);
  h.assert(g.chart.type === 'line' && g.chart.data.rows.length === 6 && g.chart.data.rows[3][1] === '1,500' && g.kids > 20, 'the chart is on the canvas with the data: ' + JSON.stringify(g.chart.map));
  h.assert(g.texts.indexOf('Sales') >= 0 && g.texts.indexOf('Returns') >= 0, 'lines are labelled at their ends, not in a legend: ' + g.texts);
  /* type */
  await page.waitForSelector('.cx-grid .cx-card[data-type="column"]');
  await page.click('.cx-grid .cx-card[data-type="column"]');
  await page.waitForFunction(() => window.LEStudio.scene.layers().find((l) => l.chart).chart.type === 'column');
  /* theme */
  await page.click('.cx-theme[data-theme="dark"]');
  await page.waitForFunction(() => window.LEStudio.scene.layers().find((l) => l.chart).chart.theme === 'dark');
  /* highlight, one tap */
  await page.locator('.cx-chips .cx-chip', { hasText: 'Returns' }).first().click();
  await page.waitForFunction(() => window.LEStudio.scene.layers().find((l) => l.chart).chart.options.highlight === 'Returns');
  const fills = await page.evaluate(() => { const L = window.LEStudio.scene.layers(), g2 = L.find((l) => l.chart); return L.filter((l) => l.groupId === g2.id && l.type === 'shape' && /, /.test(l.name)).map((l) => l.name.split(',')[0] + ' ' + l.fill.color); });
  h.assert(fills.filter((f) => /^Returns #6CB6FF/i.test(f)).length === 6 && fills.filter((f) => /^Sales/.test(f)).every((f) => !/6CB6FF/i.test(f)), 'Returns in the accent, Sales recedes: ' + fills.slice(0, 4));
  /* the numbers */
  await page.evaluate(() => { window.LEStudioCharts.state().tab = 'data'; window.LEStudio.renderPanel(true); });
  await page.click('[data-a="edit"]');
  await page.waitForSelector('.cx-table tbody tr');
  await page.fill('.cx-table tbody tr:nth-child(1) td:nth-child(2) input', '2,400');
  await page.click('.cx-actions [data-a="done"]');
  await page.waitForFunction(() => window.LEStudio.scene.layers().find((l) => l.chart).chart.data.rows[0][1] === '2,400');
  g = await chartOf(page);
  h.assert(g.chart.type === 'column' && g.chart.theme === 'dark' && g.chart.options.highlight === 'Returns', 'type, theme and highlight are kept when the numbers change');
  /* words */
  await page.evaluate(() => { window.LEStudioCharts.state().tab = 'text'; window.LEStudio.renderPanel(true); });
  await page.fill('.cx-field input >> nth=0', 'Sales and returns, first half');
  await page.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.type === 'text' && l.text === 'Sales and returns, first half'));
  h.assert(/Sales and returns, first half/.test(await page.evaluate(() => document.querySelector('.cx-alt').textContent)), 'the sentence about the chart follows');
  h.assert.noErrors(page);
};

cases['an Excel workbook: the reader loads only now, a sheet picker, a chart from the chosen sheet; paste and typing work too'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await openChart(page);
  h.assert(!page.saw(/xlsx\.full/), 'no Excel reader yet');
  await pick(page, FX('chart-rooms.xlsx'));
  await page.waitForSelector('.cx-list .cx-card');
  h.assert(page.saw(/xlsx\.full/), 'the Excel reader came with the Excel file');
  h.assert(!page.urls.some((u) => /^https?:/.test(u)), 'nothing from another host: ' + page.urls.filter((u) => /^https?:/.test(u)));
  let seen = await page.evaluate(() => ({ sum: document.querySelector('.cx-sum').textContent, sheets: [...document.querySelectorAll('.cx-field select option')].map((o) => o.value), first: document.querySelector('.cx-list .cx-card').getAttribute('data-type') }));
  h.assert(/3 rows · 2 columns/.test(seen.sum) && seen.sheets.join() === 'Rooms,Growth' && seen.first === 'bar', 'the first sheet, and a picker for the others: ' + JSON.stringify(seen));
  await page.selectOption('.cx-field select', 'Growth');
  await page.waitForFunction(() => /4 rows · 3 columns/.test(document.querySelector('.cx-sum').textContent));
  seen = await page.evaluate(() => ({ first: document.querySelector('.cx-list .cx-card').getAttribute('data-type'), why: document.querySelector('.cx-list .cx-card small').textContent }));
  h.assert(seen.first === 'line' && /2 series over 4 years/.test(seen.why), 'years across: a line first: ' + JSON.stringify(seen));
  await page.click('.cx-list .cx-card >> nth=0');
  await page.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.chart));
  const g = await chartOf(page);
  h.assert(g.chart.data.columns.join() === 'Year,Visitors,Members' && g.chart.data.rows[3].join() === '2024,8300,790', 'the sheet\'s cells are the chart\'s data: ' + JSON.stringify(g.chart.data.rows[3]));
  /* a second chart from pasted cells */
  await page.click('.cx-foot .btn');
  await page.waitForSelector('#cx-paste');
  await page.fill('#cx-paste', 'Fruit\tKilos\nApples\t12\nPears\t7\nPlums\t3');
  await page.waitForSelector('.cx-list .cx-card');
  h.assert(/3 rows · 2 columns/.test(await page.evaluate(() => document.querySelector('.cx-sum').textContent)), 'pasted cells are read');
  /* and one typed in */
  await page.click('[data-a="over"]');
  await page.click('[data-a="type"]');
  await page.waitForSelector('.cx-table');
  const cells = page.locator('.cx-table tbody .cx-cell');
  for (const [i, v] of [['0', 'North'], ['1', '40'], ['2', 'South'], ['3', '25']]) await cells.nth(Number(i)).fill(v);
  await page.click('.cx-actions [data-a="done"]');
  await page.waitForSelector('.cx-list .cx-card');
  await page.click('.cx-list .cx-card[data-type="bar"]');
  await page.waitForFunction(() => window.LEStudio.scene.layers().filter((l) => l.chart).length === 2);
  const two = await page.evaluate(() => window.LEStudio.scene.layers().filter((l) => l.chart).map((l) => l.id + ':' + l.chart.data.rows.length));
  h.assert.equal(two.join(), 'chart:4,chart-2:2');
  h.assert.noErrors(page);
};

for (const vp of ['small', 'phone']) {
  cases['on a ' + (vp === 'small' ? '360' : '390') + ' px phone every control is at least 44 px and nothing scrolls sideways'] = async ({ browser, base, h }) => {
    const page = await studio(h, browser, base, vp);
    await openChart(page);
    const audit = (label) => page.evaluate((label) => {
      const body = window.LEStudio.E.panelBody, bad = [];
      body.querySelectorAll('button, select, textarea, input:not([type=file]):not([type=checkbox]), label.btn, label.sx-toggle').forEach((n) => { const r = n.getBoundingClientRect(); if (!r.width || !r.height) return; if (r.height < 43.5 || r.width < 43.5) bad.push(label + ': ' + (n.textContent || n.getAttribute('aria-label') || n.className).trim().slice(0, 24) + ' ' + Math.round(r.width) + '×' + Math.round(r.height)); if (r.right > innerWidth + 1 || r.left < -1) bad.push(label + ': off screen ' + (n.textContent || n.className).trim().slice(0, 24)); });
      if (body.scrollWidth > body.clientWidth + 1) bad.push(label + ': the panel scrolls sideways');
      return bad;
    }, label);
    let bad = await audit('start');
    h.assert(await h.noOverflow(page), 'start: no sideways scroll');
    await pick(page, FX('chart-sales.csv'));
    await page.waitForSelector('.cx-list .cx-card');
    bad = bad.concat(await audit('suggest'));
    await page.click('.cx-bad .cx-fix');
    await page.waitForSelector('.cx-table');
    bad = bad.concat(await audit('grid'));
    const cardRows = await page.evaluate(() => { const tr = document.querySelector('.cx-table tbody tr'), td = tr.querySelector('td'); return { tr: getComputedStyle(tr).display, label: getComputedStyle(td, '::before').content, w: tr.getBoundingClientRect().width }; });
    h.assert(cardRows.tr === 'grid' && /Month/.test(cardRows.label) && cardRows.w <= 390, 'on a phone each row is a card with its column names: ' + JSON.stringify(cardRows));
    await page.click('.cx-actions [data-a="done"]');
    await page.waitForSelector('.cx-list .cx-card');
    await page.click('.cx-list .cx-card >> nth=0');
    await page.waitForSelector('.cx-themes .cx-theme');
    for (const tab of ['chart', 'data', 'text']) {
      await page.evaluate((t) => { window.LEStudioCharts.state().tab = t; window.LEStudio.renderPanel(true); }, tab);
      bad = bad.concat(await audit(tab));
    }
    h.assert(!bad.length, bad.length + ' controls: ' + bad.slice(0, 8).join(' ;; '));
    h.assert(await h.noOverflow(page), 'no sideways scroll with the chart panel open');
    h.assert((await chartOf(page)).kids > 10, 'the chart is on the canvas');
    h.assert.noErrors(page);
  };
}

cases['ways in: Elements, Apps and ?tool=chart open the Chart panel; every type can be tried in one tap'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(() => window.LEStudio.openPanel('elements'));
  await page.click('.sx-el-chart');
  await page.waitForSelector('.cx-drop');
  h.assert.equal(await page.evaluate(() => window.LEStudio.S.panel), 'chart');
  await page.evaluate(() => window.LEStudio.openPanel('apps'));
  await page.locator('.sx-app', { hasText: 'Chart' }).click();
  await page.waitForSelector('.cx-drop');
  h.assert.equal(await page.evaluate(() => window.LEStudio.S.panel), 'chart');
  const types = await page.evaluate(() => [...document.querySelectorAll('.cx-grid .cx-card')].map((c) => c.getAttribute('data-type')));
  h.assert(types.length === 23, 'the empty state offers all ' + types.length + ' types with example data');
  await page.waitForFunction(() => document.querySelectorAll('.cx-grid .cx-thumb canvas').length === 23, null, { timeout: 30000 });
  /* one tap each, on fresh pages of one design: every sample lands as an editable group */
  const made = await page.evaluate(async (types) => {
    const out = [];
    for (const t of types) {
      const res = LE.charts.ops.apply({ v: 1, width: 1080, height: 1080, background: { type: 'color', color: '#ffffff' }, layers: [] }, Object.assign({ op: 'chart.add' }, LE.charts.sample(t)));
      out.push(t + ':' + (res.ok ? res.layers : res.errors[0].message));
    }
    return out;
  }, types);
  h.assert(made.every((m) => Number(m.split(':')[1]) >= 4), 'every type draws from its sample: ' + made.join(' '));
  const deep = await h.open(browser, base, '/studio/?tool=chart', 'desktop');
  await deep.waitForFunction(() => window.LEStudio && window.LEStudio.S.panel === 'chart');
  await deep.waitForSelector('.cx-drop');
  h.assert.noErrors(page); h.assert.noErrors(deep);
};

const POSTERS = {
  'poster-1': { eyebrow: 'How high the ceilings are', headline: 'Only three of the eight venues list a ceiling height', chart: 'bar',
    data: [['Gotham Hall', '70 feet'], ['Cipriani marble entrance', '65 feet'], ['Cipriani ballroom', '64 feet'], ['Metropolitan Club Great Hall', '45 feet'], ['Metropolitan Club West Lounge', '24 feet']],
    noteTitle: 'The other five don\'t list a ceiling height', note: 'Ask how high the ceiling is when you tour.',
    source: 'Sources: the Gotham Hall, Cipriani Events and Metropolitan Club websites, read on October 9, 2026. The bars are drawn to scale.', wordmark: 'ReloomVR' },
  'poster-2': { eyebrow: 'Seating at Gotham Hall', headline: 'A dance floor means 170 fewer seats at Gotham Hall', chart: 'bar',
    data: [['Seated for dinner', '620'], ['With a dance floor', '450']], highlight: 'With a dance floor', inside: true, gap: true,
    gapLabel: '{diff} fewer seats', gapNote: '{percent} percent fewer than for dinner',
    source: 'Source: Gotham Hall\'s questions page, read on October 9, 2026. The bars are drawn to scale.', wordmark: 'ReloomVR' }
};
cases['the two reference posters are made from data by the chart poster maker, to scale, and saved as PNG'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['makers']);
  fs.mkdirSync(OUT, { recursive: true });
  const out = {};
  for (const name of Object.keys(POSTERS)) {
    const r = await page.evaluate(async (values) => {
      await LE.makers.ready();
      const v = LE.makers.validate('chartposter', values), b = await LE.makers.build('chartposter', values, { style: 'paper', size: 'wide' }), pg = b.pages[0];
      const cv = await LE.makers.renderPage(pg, { scale: 1 }), g = pg.layers.find((l) => l.type === 'group' && l.chart), kids = pg.layers.filter((l) => l.groupId === g.id);
      return { ok: v.ok, errors: v.errors, url: cv.toDataURL('image/png'), w: cv.width, h: cv.height, check: LE.makers.check(pg).map((c) => c.kind + ': ' + c.message), warnings: b.warnings, maker: pg.maker && pg.maker.id,
        texts: pg.layers.filter((l) => l.type === 'text').map((l) => l.text), bars: kids.filter((l) => l.type === 'shape' && /^(Gotham|Cipriani|Metropolitan|Seated|With)/.test(l.name)).map((l) => ({ name: l.name, w: l.w, x: l.x, fill: l.fill.color })),
        dashed: kids.filter((l) => l.stroke && l.stroke.dash).map((l) => ({ x: l.x, w: l.w })), fonts: [...new Set(pg.layers.filter((l) => l.type === 'text').map((l) => l.font))], bg: pg.background.color, chart: g.chart };
    }, POSTERS[name]);
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.url.split(',')[1], 'base64'));
    out[name] = r;
    h.assert(r.ok && !r.check.length && !r.warnings.length && r.maker === 'chartposter', name + ' is clean: ' + JSON.stringify([r.errors, r.check, r.warnings]));
    h.assert(r.w === 1600 && r.h === 1000 && /^#FCF4E6$/i.test(r.bg), name + ' is a 1600 × 1000 paper page');
    const values = POSTERS[name].data.map((d) => parseFloat(d[1])), k = r.bars[0].w / values[0];
    r.bars.forEach((b, i) => h.assert(Math.abs(b.w - values[i] * k) < 0.02 && Math.abs(b.x - r.bars[0].x) < 0.02, name + ': ' + b.name + ' is drawn to scale (' + b.w + ' for ' + values[i] + ')'));
    h.assert(r.bars.filter((b) => /^#FF7A00$/i.test(b.fill)).length === 1 && r.bars.filter((b) => /^#41414D$/i.test(b.fill)).length === r.bars.length - 1, name + ': one bar in orange, the rest in slate');
    h.assert(r.fonts.sort().join() === 'Lato,Lexend', name + ' uses the two shipped families: ' + r.fonts);
  }
  const p1 = out['poster-1'], p2 = out['poster-2'];
  ['How high the ceilings are', 'Only three of the eight venues list a ceiling height', 'Gotham Hall', '70 feet', '24 feet', 'The other five don\'t list a ceiling height', 'Ask how high the ceiling is when you tour.', 'ReloomVR'].forEach((t) => h.assert(p1.texts.indexOf(t) >= 0, 'poster 1 says "' + t + '": ' + p1.texts.join(' | ')));
  ['620', '450', '170 fewer seats', '27 percent fewer than for dinner', 'With a dance floor'].forEach((t) => h.assert(p2.texts.indexOf(t) >= 0, 'poster 2 says "' + t + '": ' + p2.texts.join(' | ')));
  h.assert(p2.dashed.length === 1 && Math.abs(p2.dashed[0].x + p2.dashed[0].w - (p2.bars[0].x + p2.bars[0].w)) < 0.5, 'the gap box ends where the longer bar ends');
  /* through the form: ?make=chartposter makes it, and the chart on the page can be edited afterwards */
  const form = await h.open(browser, base, '/studio/?make=chartposter', 'desktop');
  await form.waitForSelector('.mk-make', { timeout: 20000 });
  await form.click('.mk-make');
  await form.waitForFunction(() => window.LEStudio.scene && window.LEStudio.scene.layers().some((l) => l.chart), null, { timeout: 20000 });
  await form.evaluate(() => { const g = window.LEStudio.scene.layers().find((l) => l.chart); window.LEStudio.scene.select([g.id]); });
  await form.waitForSelector('[data-cmd="chart:edit"]');
  h.assert.noErrors(page); h.assert.noErrors(form);
};

module.exports = cases;
