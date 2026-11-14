'use strict';
/* The chart engine (LE.charts, docs/CHARTS.md): bars drawn to scale, nice ticks, stacked sums, pie angles, labels that never
   overlap, number formats, the "data to chart" suggestions, theme palettes under colour-vision simulation and label contrast,
   hostile data, round trips through the project and the open format, one undo step per redraw, and the agent operations. */
const cases = {};

async function lab(h, browser, base) {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['chartslib', 'design']);
  await page.waitForFunction(() => window.LE && LE.charts && LE.design && LE.design.parse);
  await page.evaluate(async () => { for (const t of LE.charts.themes()) await LE.charts.ready({ theme: t.id }); });
  return page;
}

cases['bars are drawn to scale: every length is its value × one constant, from zero; a cut axis is refused'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const C = LE.charts, out = [];
    const sets = [
      { type: 'bar', data: { columns: ['Room', 'Height'], rows: [['A', '70 feet'], ['B', '65 feet'], ['C', '64 feet'], ['D', '45 feet'], ['E', '24 feet']] }, options: { zero: false } },
      { type: 'bar', data: { columns: ['K', 'V'], rows: [['a', 1200000], ['b', 340000], ['c', -220000], ['d', 15000]] }, options: {} },
      { type: 'column', data: { columns: ['K', 'V', 'W'], rows: [['a', 12, 7], ['b', 30, 14], ['c', 3, 22], ['d', 18, 9]] }, options: {} },
      { type: 'column', data: { columns: ['K', 'V'], rows: [['a', 0.4], ['b', 0.25], ['c', 0.9]] }, options: { labelsAt: 'above' } },
      { type: 'bar', data: { columns: ['K', 'V'], rows: [['Seated for dinner', 620], ['With a dance floor', 450]] }, options: { labelsAt: 'above', labelPosition: 'inside', highlight: 'With a dance floor', gap: { from: 'Seated for dinner', to: 'With a dance floor', label: '{diff} fewer seats', note: '{percent} percent fewer than for dinner' } } },
      { type: 'lollipop', data: { columns: ['K', 'V'], rows: [['a', 12], ['b', 9.9], ['c', 4]] }, options: {} },
      { type: 'bullet', data: { columns: ['K', 'V', 'Target'], rows: [['a', 82, 75], ['b', 61, 80]] }, options: {} }
    ];
    for (const s of sets) for (const box of [{ x: 40, y: 30, w: 900, h: 560 }, { x: 0, y: 0, w: 340, h: 300 }, { x: 10, y: 10, w: 1500, h: 520 }]) {
      const res = C.render(Object.assign({ v: 1, theme: 'clean', map: {} }, s), box, { id: 'c' }), sc = res.info.scale;
      const bad = [];
      res.info.bars.forEach((b) => {
        const l = res.layers[b.i], len = sc.axis === 'x' ? l.w : l.h, want = Math.abs(b.v) * sc.k;
        if (want >= 1 && Math.abs(len - want) > 0.02) bad.push('length ' + len + ' ≠ ' + want);
        const start = sc.axis === 'x' ? (b.v >= 0 ? l.x : l.x + l.w) : (b.v >= 0 ? l.y + l.h : l.y);
        if (want >= 1 && Math.abs(start - sc.zero) > 0.02) bad.push('does not start at zero: ' + start + ' vs ' + sc.zero);
      });
      out.push({ type: s.type, w: box.w, bars: res.info.bars.length, k: sc.k, bad, notes: res.notes, texts: res.layers.filter((l) => l.type === 'text').map((l) => l.text), dashed: res.layers.filter((l) => l.stroke && l.stroke.dash).length });
    }
    return out;
  });
  r.forEach((x) => { h.assert(x.bars >= 2 && x.k > 0, x.type + ' has bars and a scale'); h.assert(!x.bad.length, x.type + ' @' + x.w + ': ' + x.bad.join('; ')); });
  h.assert(r[0].notes.some((n) => /always start at zero/.test(n)), 'zero: false on bars is refused with a note: ' + r[0].notes);
  const gap = r.filter((x) => x.texts.indexOf('170 fewer seats') >= 0)[0];
  h.assert(gap && gap.texts.indexOf('27 percent fewer than for dinner') >= 0 && gap.dashed === 1, 'the gap marker: a dashed box, the difference and the percent');
  h.assert(gap.texts.indexOf('620') >= 0 && gap.texts.indexOf('450') >= 0, 'direct value labels');
  h.assert.noErrors(page);
};

cases['nice axis ticks cover the data with round steps; number formats keep units, currency and percent'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const C = LE.charts, bad = [];
    let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 400; i++) {
      const a = (rnd() - 0.3) * Math.pow(10, Math.floor(rnd() * 9) - 3), b = a + rnd() * Math.pow(10, Math.floor(rnd() * 9) - 3), n = 2 + Math.floor(rnd() * 6), t = C.ticks(a, b, n);
      const m = t.step / Math.pow(10, Math.floor(Math.log10(t.step) + 1e-9));
      if (!(t.min <= a + 1e-9 * Math.abs(a) && t.max >= b - 1e-9 * Math.abs(b))) bad.push('range ' + a + '..' + b + ' → ' + t.min + '..' + t.max);
      if ([1, 2, 2.5, 5, 10].every((v) => Math.abs(m - v) > 1e-6)) bad.push('step ' + t.step);
      if (t.ticks.length < 2 || t.ticks.length > 14) bad.push('count ' + t.ticks.length + ' for ' + a + '..' + b);
      if (t.ticks.some((v, j) => j && Math.abs(v - t.ticks[j - 1] - t.step) > t.step * 1e-6)) bad.push('uneven ' + t.ticks);
    }
    const f = C.format, n = C.number;
    return { bad, t97: C.ticks(0, 97, 5).ticks, t0: C.ticks(0, 0).ticks,
      fmt: [f(1200, {}, true), f(1234567.5, { pre: '$' }), f(0.5, { suf: '%', dec: 1 }), f(-42, { suf: 'feet' }), f(1500000, {}, true), f(999, {}, true), f(2.5e9, { pre: '€' }, true), f(1e21, {}), f(NaN, {}), f(12.5, { suf: 'kg', dec: 1 })],
      num: [n('1,200'), n('$1,234.50'), n('45%'), n('70 feet'), n('(300)'), n('−12'), n('1.234,56'), n('12,5'), n('1.2K'), n('$3M'), n('=1+1'), n('n/a'), n(''), n('2024-01-05'), n('1e3'), n('+7')],
      kinds: C.analyse({ columns: ['Month', 'Sales', 'Share', 'Cost', 'Day', 'Note'], rows: [['Jan', '1,200', '12%', '$40.50', '2024-01-05', 'ok'], ['Feb', '1,350', '15%', '$52.00', '2024-02-05', 'fine'], ['Mar', 'n/a', '9%', '$31.25', '2024-03-05', 'ok'], ['Apr', '900', '4%', '$1.00', '2024-04-05', 'ok'], ['May', '950', '6%', '$2.00', '2024-05-05', 'fine'], ['Jun', '990', '8%', '$3.00', '2024-06-05', 'ok']] }).map((a) => a.kind + (a.bad.length ? '!' + a.bad.join(',') : '') + (a.pre || a.suf ? ':' + a.pre + a.suf : '')),
      dates: ['2024-03-01', '03/15/2024', '15 Mar 2024', 'Mar 2024', 'Q2 2024', 'Tuesday', 'Sept', '2024', 'hello', '31/02/2024'].map((s) => { const d = C.date(s); return d ? d.g : null; }) };
  });
  h.assert(!r.bad.length, 'ticks: ' + r.bad.slice(0, 5).join(' | '));
  h.assert.equal(r.t97.join(), '0,20,40,60,80,100');
  h.assert(r.t0.length >= 2, 'a flat range still gets an axis');
  h.assert.equal(r.fmt.join(' | '), '1.2K | $1,234,568 | 0.5% | −42 feet | 1.5M | 999 | €2.5B | 1.0e21 | – | 12.5 kg');
  h.assert.equal(JSON.stringify(r.num), JSON.stringify([1200, 1234.5, 45, 70, -300, -12, 1234.56, 12.5, 1200, 3000000, null, null, null, null, 1000, 7]));
  h.assert.equal(r.kinds.join(' '), 'date number!2 percent:% currency:$ date category');
  h.assert.equal(JSON.stringify(r.dates), JSON.stringify(['day', 'day', 'day', 'month', 'quarter', 'name', 'name', 'year', null, null]));
};

cases['stacked bars add up; pie and donut angles sum to 360°; small slices fold into Other'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const C = LE.charts, data = { columns: ['Q', 'North', 'South', 'East'], rows: [['Q1', 12, 30, 8], ['Q2', 18, 22, 14], ['Q3', 25, 5, 30], ['Q4', 9, 41, 11]] }, out = { stacks: [], pies: [] };
    for (const type of ['bar', 'column']) for (const mode of ['stacked', 'percent']) {
      const res = C.render({ v: 1, type, data, map: {}, theme: 'clean', options: { mode } }, { x: 0, y: 0, w: 900, h: 560 }, { id: 'c' }), sc = res.info.scale, by = {};
      res.info.bars.forEach((b) => { const l = res.layers[b.i]; by[b.cat] = (by[b.cat] || 0) + (sc.axis === 'x' ? l.w : l.h); });
      data.rows.forEach((row) => { const total = mode === 'percent' ? 100 : row[1] + row[2] + row[3]; out.stacks.push({ id: type + '/' + mode + '/' + row[0], got: by[row[0]], want: total * sc.k }); });
    }
    const slices = (n) => ({ columns: ['Part', 'Value'], rows: Array.from({ length: n }, (_, i) => ['Part ' + (i + 1), Math.round(1000 / (i + 1))]) });
    for (const type of ['pie', 'donut']) for (const n of [1, 2, 5, 9, 16]) for (const w of [900, 320]) {
      const res = C.render({ v: 1, type, data: slices(n), map: {}, theme: 'clean', options: {} }, { x: 0, y: 0, w, h: w * 0.62 }, { id: 'c' });
      out.pies.push({ id: type + n + '@' + w, sum: res.info.angles.reduce((a, b) => a + b, 0), n: res.info.angles.length, other: res.layers.some((l) => l.type === 'text' && l.text === 'Other'), notes: res.notes });
    }
    return out;
  });
  r.stacks.forEach((s) => h.assert(Math.abs(s.got - s.want) < 0.05, s.id + ' sums to ' + s.got + ', expected ' + s.want));
  r.pies.forEach((p) => h.assert(Math.abs(p.sum - 360) < 0.01, p.id + ' angles sum to ' + p.sum));
  const p16 = r.pies.filter((p) => p.id === 'pie16@900')[0];
  h.assert(p16.n === 9 && p16.other && p16.notes.some((n) => /Other/.test(n)), '16 slices become 8 and Other, with a note: ' + JSON.stringify(p16));
};

/* Text boxes measured here, independently of the engine: the drawn width of each line with the real font. */
const measureAll = () => {
  window.__ink = (layers) => {
    const cv = document.createElement('canvas').getContext('2d'), out = [];
    layers.forEach((l, i) => {
      if (l.type !== 'text' || l.visible === false) return;
      cv.font = 'normal ' + l.weight + ' ' + l.size + 'px ' + LE.Scene.fontFamily(l.font);
      const lines = String(l.uppercase ? l.text.toUpperCase() : l.text).split('\n'), lh = l.size * l.lineHeight;
      const w = Math.max(...lines.map((s) => LE.Scene.textWidth(cv, s, l.letterSpacing || 0)));
      const x = l.align === 'center' ? l.x + (l.w - w) / 2 : l.align === 'right' ? l.x + l.w - w : l.x;
      out.push({ i, text: l.text, rot: l.rotation || 0, wide: w > l.w + 0.5, x0: x, x1: x + w, y0: l.y + (lh - l.size) / 2 + l.size * 0.1, y1: l.y + lines.length * lh - (lh - l.size) / 2 - l.size * 0.1, size: l.size, cx: l.x + l.w / 2, cy: l.y + l.h / 2, lw: l.w });
    });
    return out;
  };
  window.__overlaps = (layers) => {
    const t = window.__ink(layers), bad = [];
    t.forEach((a) => { if (a.wide) bad.push('wider than its box: ' + a.text); });
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const a = t[i], b = t[j];
      if (a.rot || b.rot) {
        if (a.rot && b.rot) { const an = a.rot * Math.PI / 180, d = Math.abs((a.cx - b.cx) * -Math.sin(an) + (a.cy - b.cy) * Math.cos(an)); if (d < Math.min(a.size, b.size) * 0.85) bad.push('turned labels touch: ' + a.text + ' / ' + b.text); }
        continue;
      }
      if (a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5) bad.push(a.text.replace(/\n/g, ' ') + ' ⨯ ' + b.text.replace(/\n/g, ' '));
    }
    return bad;
  };
};

cases['labels never overlap: every type at its defaults in three sizes, and crowded data'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  await page.evaluate(measureAll);
  const r = await page.evaluate(() => {
    const C = LE.charts, out = [], boxes = [{ x: 0, y: 0, w: 900, h: 560 }, { x: 0, y: 0, w: 330, h: 300 }, { x: 0, y: 0, w: 1600, h: 620 }, { x: 0, y: 0, w: 520, h: 900 }];
    const long = ['Metropolitan Club Great Hall', 'Cipriani marble entrance', 'A very long label that has to be shortened somewhere', 'Short', 'North-west regional office', 'Ünïcödé łabel ✓', 'x'];
    const many = (n, k) => ({ columns: ['Name'].concat(Array.from({ length: k }, (_, j) => 'Series ' + (j + 1))), rows: Array.from({ length: n }, (_, i) => [long[i % long.length] + ' ' + (i + 1)].concat(Array.from({ length: k }, (_, j) => Math.round(1000 + 900 * Math.sin(i * 0.7 + j) + 37 * j)))) });
    const crowded = [
      { type: 'bar', data: many(40, 1) }, { type: 'column', data: many(30, 1) }, { type: 'column', data: many(12, 4) }, { type: 'bar', data: many(8, 5), options: { mode: 'stacked' } },
      { type: 'line', data: many(60, 8) }, { type: 'area', data: many(24, 5), options: { mode: 'stacked' } }, { type: 'pie', data: many(15, 1) }, { type: 'donut', data: many(7, 1), options: { fold: false } },
      { type: 'scatter', data: { columns: ['Name', 'X', 'Y'], rows: Array.from({ length: 60 }, (_, i) => [long[i % 7] + i, 50 + (i * 37) % 23, 40 + (i * 53) % 19]) }, map: { category: 0, x: 1, y: 2 } },
      { type: 'waterfall', data: many(14, 1) }, { type: 'funnel', data: many(9, 1) }, { type: 'radar', data: many(12, 4) }, { type: 'lollipop', data: many(25, 1) }, { type: 'slope', data: many(14, 2) },
      { type: 'heatmap', data: many(20, 8) }, { type: 'treemap', data: many(30, 1) }, { type: 'stat', data: many(8, 2) }, { type: 'sparkline', data: many(12, 9) }, { type: 'table', data: many(30, 6) }, { type: 'combo', data: many(18, 3) }, { type: 'bullet', data: many(10, 2) }, { type: 'gauge', data: many(6, 1) }, { type: 'pictogram', data: many(8, 1) }
    ];
    const run = (chart, id) => boxes.forEach((box) => {
      const res = C.render(chart, box, { id: 'c' }), bad = window.__overlaps(res.layers);
      const off = res.layers.filter((l) => l.type === 'text' && !l.rotation && (l.x + l.w < box.x - 2 || l.x > box.x + box.w + 2 || l.y < box.y - 2 || l.y + l.h > box.y + box.h + 2)).map((l) => l.text);
      if (bad.length || off.length) out.push(id + ' @' + box.w + '×' + box.h + ': ' + bad.slice(0, 3).join(' | ') + (off.length ? ' off the box: ' + off.slice(0, 3).join(', ') : ''));
    });
    C.types().forEach((t) => run(Object.assign(C.sample(t.id), { options: Object.assign({ title: 'A title that says what the chart shows', subtitle: 'A line under it', source: 'Source: somewhere', note: 'A note' }, C.sample(t.id).options) }), t.id));
    crowded.forEach((c, i) => run(Object.assign({ v: 1, theme: 'paper', map: {}, options: {} }, c), 'crowded ' + c.type + ' #' + i));
    return out;
  });
  h.assert(!r.length, r.length + ' charts with touching labels: ' + r.slice(0, 12).join(' ;; '));
};

cases['data to chart: suggestions for eight table shapes, ranked, mapped, each with a reason'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const C = LE.charts, S = (t) => C.suggest(t), months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const shapes = {
      months: { columns: ['Month', 'Sales'], rows: months.map((m, i) => [m, 100 + i * 13]) },
      categories: { columns: ['Room', 'Height'], rows: [['Hall', '70 feet'], ['Entrance', '65 feet'], ['Ballroom', '64 feet'], ['Lounge', '24 feet']] },
      shares: { columns: ['Spending', 'Share'], rows: [['Rent', '38%'], ['Food', '22%'], ['Transport', '14%'], ['Savings', '12%'], ['Fun', '14%']] },
      multiSeries: { columns: ['Year', 'Solar', 'Wind', 'Hydro'], rows: [[2019, 12, 30, 44], [2020, 18, 36, 45], [2021, 27, 41, 44], [2022, 39, 49, 46]] },
      twoNumbers: { columns: ['Hours', 'Score'], rows: Array.from({ length: 12 }, (_, i) => [i + 1, 50 + i * 4]) },
      oneColumn: { columns: ['Minutes'], rows: Array.from({ length: 40 }, (_, i) => [20 + (i * 7) % 31]) },
      long: { columns: ['Month', 'Region', 'Sales'], rows: months.slice(0, 6).flatMap((m, i) => [[m, 'North', 10 + i], [m, 'South', 20 - i], [m, 'East', 5 + 2 * i]]) },
      target: { columns: ['Team', 'Sales', 'Target'], rows: [['North', 82, 75], ['South', 61, 80], ['East', 74, 70]] },
      funnel: { columns: ['Stage', 'People'], rows: [['Visited', 12000], ['Signed up', 4200], ['Trial', 1900], ['Paid', 640]] },
      beforeAfter: { columns: ['Subject', '2019', '2024'], rows: [['Maths', 61, 72], ['Reading', 70, 68], ['Science', 58, 75]] },
      wide: { columns: ['Team', 'a', 'b', 'c', 'd', 'e', 'f'], rows: ['Red', 'Blue', 'Green', 'Gold', 'Grey'].map((d, i) => [d, 1 + i, 2, 3 * i, 4, 5, 6 - i]) },
      words: { columns: ['Name', 'Colour'], rows: [['a', 'red'], ['b', 'blue'], ['c', 'red'], ['d', 'red']] },
      headerless: [[1, 10], [2, 14], [3, 9], [4, 20]],
      one: { columns: ['Goal', 'Reached'], rows: [['Fundraising', '72%']] },
      gains: { columns: ['Step', 'Change'], rows: [['Sales', 1200], ['Returns', -150], ['Wages', -310], ['Other', 90]] }
    };
    const out = {};
    Object.keys(shapes).forEach((k) => {
      const list = S(shapes[k]);
      out[k] = { types: list.map((x) => x.type + (x.options.mode ? ':' + x.options.mode : '')), why: list[0].why, map: list[0].map, sorted: list.every((x, i) => !i || x.score <= list[i - 1].score), reasons: list.every((x) => typeof x.why === 'string' && x.why.length > 12 && x.why.length < 170),
        draws: list.every((x) => C.render({ v: 1, type: x.type, data: C.fromTable(shapes[k]), map: x.map, theme: 'clean', options: x.options }, { x: 0, y: 0, w: 600, h: 400 }, {}).layers.length > 3) };
    });
    out.cols = C.fromTable(shapes.headerless).columns;
    return out;
  });
  const first = (k, t) => h.assert(r[k].types[0] === t, k + ': expected ' + t + ' first, got ' + r[k].types.join(', '));
  first('months', 'line'); first('categories', 'bar'); first('shares', 'donut'); first('multiSeries', 'line'); first('twoNumbers', 'scatter'); first('oneColumn', 'histogram');
  first('long', 'line'); first('target', 'bullet'); first('funnel', 'funnel'); first('beforeAfter', 'slope'); first('wide', 'heatmap'); first('words', 'bar'); first('one', 'stat'); first('gains', 'waterfall');
  h.assert(/12 months of one number: a line shows the trend/.test(r.months.why), 'a plain reason: ' + r.months.why);
  h.assert(r.long.map.group === 1 && r.long.map.category === 0, 'the long table is pivoted by Region: ' + JSON.stringify(r.long.map));
  h.assert(r.target.map.target === 2, 'the target column is found');
  h.assert.equal(r.cols.join(), 'Column 1,Column 2');
  Object.keys(r).forEach((k) => { if (k === 'cols') return; h.assert(r[k].sorted && r[k].reasons && r[k].draws, k + ': ranked, each with a reason, each draws ' + JSON.stringify(r[k])); h.assert(r[k].types.indexOf('table') >= 0, k + ' offers a table too'); });
};

cases['themes: palettes stay apart under colour-vision simulation; every label reaches 4.5:1 on what is behind it'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const C = LE.charts, K = C.color, out = { themes: [], pal: [], low: [], fonts: [] }, known = {};
    LE.fonts.list().forEach((f) => { known[f.family] = f.weights; });
    const brand = { name: 'Acme', colors: [{ role: 'primary', value: '#14213D' }, { role: 'accent', value: '#FCA311' }, { role: 'secondary', value: '#FCA720' }, { role: 'background', value: '#FFFFFF' }, { role: 'text', value: '#111111' }], fonts: { heading: 'Fraunces', body: 'Inter' } };
    const all = C.themes().concat([C.theme('brand', { brand }), C.theme('brand', { brand: { colors: ['#0B132B', '#5BC0BE', '#6FFFE9'], fonts: ['Sora'] } })]);
    all.forEach((t, ti) => {
      out.themes.push(t.id);
      const p = t.palette;
      if (p.length < 8) out.pal.push(t.id + ': only ' + p.length + ' colours');
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) for (const kind of ['', 'protan', 'deutan', 'tritan']) {
        const d = K.distance(p[i], p[j], kind), min = kind === 'tritan' ? 4.9 : 7;
        if (d < min) out.pal.push(t.id + ' ' + (kind || 'normal') + ' ' + p[i] + ' / ' + p[j] + ' = ' + d.toFixed(1));
      }
      [['ink', 7], ['muted', 4.5], ['accentInk', 4.5]].forEach((q) => { if (K.contrast(t[q[0]], t.card) < q[1]) out.low.push(t.id + ' ' + q[0] + ' on card ' + K.contrast(t[q[0]], t.card).toFixed(2)); });
      [[t.head, t.hw], [t.body, 400], [t.body, t.vw]].forEach((f) => { if (!known[f[0]] || known[f[0]].indexOf(f[1]) < 0) out.fonts.push(t.id + ': ' + f.join(' ')); });
      const ctx = ti >= C.themes().length ? { id: 'c', brand: ti === C.themes().length ? brand : { colors: ['#0B132B', '#5BC0BE', '#6FFFE9'], fonts: ['Sora'] } } : { id: 'c' };
      C.types().forEach((ty) => [{}, { card: false }].forEach((extra) => {
        const chart = C.sample(ty.id, t.id);
        Object.assign(chart.options, extra, { title: 'Title', source: 'Source', note: 'Note' });
        const res = C.render(chart, { x: 0, y: 0, w: 800, h: 520 }, Object.assign({ background: extra.card === false ? '#101010' : undefined }, ctx));
        const base = extra.card === false ? '#101010' : res.theme.card;
        res.info.texts.forEach((x) => {
          const l = res.layers[x.i], cx = (x.box.x0 + x.box.x1) / 2, cy = (x.box.y0 + x.box.y1) / 2;
          /* what is really behind it: the last opaque rectangle drawn before it that covers its middle */
          let under = base;
          for (let k = 0; k < x.i; k++) { const s = res.layers[k]; if (s.type === 'shape' && (s.shape === 'rect' || s.shape === 'rounded-rectangle') && s.fill && s.fill.type === 'solid' && (s.opacity == null || s.opacity === 1) && cx > s.x && cx < s.x + s.w && cy > s.y && cy < s.y + s.h) under = s.fill.color; }
          const lowDeclared = K.contrast(l.color, x.on) < 4.5, lowSeen = !l.rotation && K.contrast(l.color, under) < 4.5 && K.contrast(x.on, under) > 1.02;
          if (lowDeclared || (lowSeen && x.on === base)) out.low.push(t.id + '/' + ty.id + (extra.card === false ? '/no card' : '') + ' "' + l.text.slice(0, 20) + '" ' + l.color + ' on ' + (lowDeclared ? x.on : under));
        });
      }));
    });
    return out;
  });
  h.assert(r.themes.length >= 10 && ['clean', 'paper', 'dark', 'contrast', 'mono', 'pastel', 'grey', 'brand'].every((t) => r.themes.indexOf(t) >= 0), 'at least eight themes: ' + r.themes);
  h.assert(!r.pal.length, 'palettes too close: ' + r.pal.slice(0, 10).join(' ;; '));
  h.assert(!r.fonts.length, 'fonts not in the library: ' + r.fonts.join('; '));
  h.assert(!r.low.length, r.low.length + ' labels under 4.5:1: ' + r.low.slice(0, 12).join(' ;; '));
};

cases['hostile data is handled with a plain note and no hang: huge, negative, NaN, empty, formulas as text, 10,000 rows'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const C = LE.charts, t0 = performance.now(), out = { bad: [], notes: {} };
    const big = { columns: ['City', 'Amount'], rows: Array.from({ length: 10000 }, (_, i) => ['City ' + (i % 37), String(i)]) };
    const uniq = { columns: ['Id', 'Amount', 'Other'], rows: Array.from({ length: 10000 }, (_, i) => ['id-' + i, i, i * 2]) };
    const fb = C.fit(C.fromTable(big)), fu = C.fit(C.fromTable(uniq));
    out.fit = { big: fb.data.rows.length, bigNote: fb.note, bigSum: fb.data.rows[0][1], uniq: fu.data.rows.length * 3, uniqNote: fu.note };
    const sets = {
      huge: { columns: ['K', 'V'], rows: [['a', 1e308], ['b', 1e21], ['c', 5], ['d', -1e300]] },
      negatives: { columns: ['K', 'V', 'W'], rows: [['a', -5, -1], ['b', -50, -20], ['c', -0.001, -3]] },
      nan: { columns: ['K', 'V'], rows: [['a', NaN], ['b', Infinity], ['c', 'NaN'], ['d', '-Infinity'], ['e', 3]] },
      empty: { columns: [], rows: [] },
      noRows: { columns: ['K', 'V'], rows: [] },
      blanks: { columns: ['K', 'V'], rows: [['', ''], ['a', ''], ['', 4]] },
      formulas: { columns: ['K', 'V'], rows: [['=SUM(A1:A9)', '=1+1'], ['=cmd|\' /C calc\'!A0', '@SUM(1)'], ['+1+1', '-2-3'], ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'], ['ok', 7]] },
      zeros: { columns: ['K', 'V'], rows: [['a', 0], ['b', 0]] },
      one: { columns: ['K', 'V'], rows: [['a', 42]] },
      sampled: fu.data, summed: fb.data,
      wide: { columns: ['K'].concat(Array.from({ length: 59 }, (_, i) => 'c' + i)), rows: Array.from({ length: 80 }, (_, i) => ['r' + i].concat(Array.from({ length: 59 }, (_, j) => i * j))) }
    };
    Object.keys(sets).forEach((name) => C.types().forEach((ty) => {
      let res;
      try { res = C.render({ v: 1, type: ty.id, data: sets[name], map: {}, theme: 'clean', options: {} }, { x: 0, y: 0, w: 800, h: 500 }, { id: 'c' }); } catch (e) { out.bad.push(name + '/' + ty.id + ' threw ' + e.message); return; }
      if (res.layers.length > C.CAP.layers) out.bad.push(name + '/' + ty.id + ' ' + res.layers.length + ' layers');
      res.layers.forEach((l) => { if (![l.x, l.y, l.w, l.h].every((v) => typeof v === 'number' && isFinite(v)) || !(l.w > 0 && l.h > 0)) out.bad.push(name + '/' + ty.id + ' bad box on ' + l.name + ' ' + [l.x, l.y, l.w, l.h]); if (l.type === 'text' && /NaN|Infinity|undefined/.test(l.text) && !/NaN|Infinity/.test(JSON.stringify(sets[name].rows))) out.bad.push(name + '/' + ty.id + ' text ' + l.text); });
      if (ty.id === 'bar') out.notes[name] = { notes: res.notes, texts: res.layers.filter((l) => l.type === 'text').map((l) => l.text), summary: C.summary({ type: 'bar', data: sets[name] }) };
      try { C.summary({ type: ty.id, data: sets[name] }); C.suggest(sets[name]); } catch (e) { out.bad.push(name + '/' + ty.id + ' summary or suggest threw ' + e.message); }
    }));
    const dirty = C.sanitize({ type: 'bar', data: { columns: ['a', 'b'], rows: [['x', 1]] }, map: JSON.parse('{"__proto__":{"polluted":1},"category":0,"constructor":{"x":1}}'), options: JSON.parse('{"title":"ok","prototype":1,"fn":"function(){}","deep":{"a":{"b":{"c":{"d":{"e":1}}}}}}'), theme: '../x', extra: 1 });
    out.dirty = { keys: Object.keys(dirty).join(), map: JSON.stringify(dirty.map), theme: dirty.theme, polluted: ({}).polluted === undefined, deep: JSON.stringify(dirty.options.deep) };
    out.capped = LE.Scene.chartOf({ type: 'bar', data: { columns: ['a', 'b'], rows: Array.from({ length: 9000 }, (_, i) => ['r' + i, i]) } }).data.rows.length;
    out.none = [C.sanitize(null), C.sanitize({ type: 'Bad Type' }), LE.Scene.chartOf({ type: '<script>' })];
    out.ms = Math.round(performance.now() - t0);
    return out;
  });
  h.assert(!r.bad.length, r.bad.length + ' problems: ' + r.bad.slice(0, 10).join(' ;; '));
  h.assert(r.ms < 30000, 'all of it in ' + r.ms + ' ms');
  h.assert(r.fit.big === 37 && /10,000 rows were added up by City into 37/.test(r.fit.bigNote), 'repeated labels are added up, with a note: ' + JSON.stringify(r.fit));
  h.assert(r.fit.uniq <= 5000 && /Every \d+\w+ row is used/.test(r.fit.uniqNote), 'unique rows are sampled, with a note: ' + r.fit.uniqNote);
  h.assert(r.notes.formulas.texts.indexOf('=SUM(A1:A9)') >= 0 && r.notes.formulas.texts.indexOf('2') < 0, 'a formula is shown as the text it is, never worked out: ' + r.notes.formulas.texts);
  h.assert(r.notes.formulas.notes.some((n) => /No column of numbers was found/.test(n)), 'a column of formulas is not a column of numbers, and the chart says so: ' + r.notes.formulas.notes);
  h.assert(r.notes.nan.notes.some((n) => /not a number|No column of numbers/.test(n)) && r.notes.empty.notes.length && r.notes.noRows.notes.length, 'NaN and empty tables get a note: ' + JSON.stringify([r.notes.nan.notes, r.notes.empty.notes, r.notes.noRows.notes]));
  h.assert(/1\.0e21/.test(r.notes.huge.texts.join(' ')) && r.notes.huge.notes.some((n) => /numbers? (is|are) too large to draw/.test(n)), 'huge numbers are written in a short form; the unthinkable ones are left out with a note: ' + r.notes.huge.texts + ' / ' + r.notes.huge.notes);
  h.assert.equal(r.dirty.keys, 'v,type,data,map,theme,options');
  h.assert(r.dirty.polluted && !/constructor|__proto__|polluted/.test(r.dirty.map) && r.dirty.theme === 'clean', 'forbidden keys and odd theme names are dropped: ' + JSON.stringify(r.dirty));
  h.assert(r.capped === 2500 && r.none.every((x) => x === null), 'a document keeps at most 5,000 cells; things that are not charts are refused');
};

cases['round trip: a chart survives the project sanitiser and the open format; a file with only the data gets its layers'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(async () => {
    const C = LE.charts, chart = C.sample('line', 'paper');
    chart.options.title = 'Orders, this year and last'; chart.options.annotations = [{ type: 'line', value: 200, label: 'Target' }];
    const add = C.ops.apply({ v: 1, width: 1080, height: 1080, background: { type: 'color', color: '#ffffff' }, layers: [] }, { op: 'chart.add', type: chart.type, data: chart.data, theme: chart.theme, options: chart.options });
    const project = { schema: LE.project.SCHEMA, v: LE.project.VERSION, name: 'Chart', kind: 'design', pages: [add.doc], activePage: 0, assets: {}, meta: { app: '2.0', studio: {} } };
    const v = LE.project.validate(project), g1 = v.project.pages[0].layers.find((l) => l.type === 'group');
    const text = LE.design.stringify(v.project, { images: 'none' }).text, back = await LE.design.parse(text);
    const g2 = back.ok ? back.project.pages[0].layers.find((l) => l.type === 'group') : null;
    /* a design file as an agent writes it: only the group and its data */
    const bare = await LE.design.parse({ format: 'localeditor-design', version: 1, pages: [{ width: 1200, height: 800, background: '#FCF4E6', layers: [{ id: 'sales', type: 'group', x: 60, y: 80, w: 1080, h: 640, chart: { type: 'bar', theme: 'paper', data: { columns: ['Room', 'Seats'], rows: [['Hall', 620], ['Lounge', 450]] }, options: { highlight: 'Hall' } } }] }] });
    const bl = bare.ok ? bare.project.pages[0].layers : [];
    const cv = bare.ok ? await (async () => { const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;width:64px;height:64px'; document.body.appendChild(host); const sc = new LE.Scene({ el: host, width: 1200, height: 800 }); sc.load(bare.project.pages[0]); const c = await sc.render(0.25, { includeBackground: true }); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let orange = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 90 && d[i + 1] < 150 && d[i + 2] < 40) orange++; const again = sc.toJSON().layers.find((l) => l.type === 'group'); sc.destroy(); host.remove(); return { orange, kept: !!(again && again.chart) }; })() : null;
    const badChart = await LE.design.parse({ format: 'localeditor-design', version: 1, pages: [{ width: 800, height: 600, layers: [{ id: 'g', type: 'group', x: 0, y: 0, w: 400, h: 300, chart: 'bar' }] }] });
    return { ok: add.ok, kids: add.layers, same1: JSON.stringify(g1.chart) === JSON.stringify(C.sanitize(chart)), errs: v.errors, kids1: v.project.pages[0].layers.filter((l) => l.groupId === g1.id).length,
      back: back.ok, backErr: (back.errors || []).slice(0, 3), same2: g2 && JSON.stringify(g2.chart) === JSON.stringify(g1.chart), kids2: back.ok ? back.project.pages[0].layers.filter((l) => l.groupId === g2.id).length : 0, hasChart: /"chart"\s*:\s*\{/.test(text),
      polyKept: back.ok && back.project.pages[0].layers.filter((l) => l.shape === 'polyline').every((l) => l.params.points.length >= 2), warn: (back.warnings || []).filter((w) => w.kind !== 'default-size').map((w) => w.kind + ': ' + w.message).slice(0, 4),
      bare: bare.ok, bareErr: (bare.errors || []).slice(0, 3), bareKids: bl.filter((l) => l.groupId === 'sales').length, bareTexts: bl.filter((l) => l.type === 'text').map((l) => l.text), bareBars: bl.filter((l) => l.groupId === 'sales' && l.type === 'shape' && l.fill && /^#FF7A00$/i.test(l.fill.color || '')).length, cv, badChart: badChart.ok, badMsg: (badChart.errors[0] || {}).message };
  });
  h.assert(r.ok && r.kids > 20 && r.same1 && r.kids1 === r.kids, 'the project keeps the chart and its ' + r.kids + ' layers: ' + JSON.stringify(r.errs));
  h.assert(r.back && r.hasChart && r.same2 && r.kids2 === r.kids && r.polyKept, 'the open format writes and reads it back: ' + JSON.stringify({ err: r.backErr, kids2: r.kids2, same2: r.same2 }));
  h.assert(!r.warn.length, 'no warnings on the way back: ' + r.warn.join(' | '));
  h.assert(r.bare && r.bareKids >= 7 && r.bareTexts.indexOf('Hall') >= 0 && r.bareTexts.indexOf('620') >= 0 && r.bareBars === 1, 'a chart group with only data is drawn when the file is read: ' + JSON.stringify({ e: r.bareErr, k: r.bareKids, t: r.bareTexts, b: r.bareBars }));
  h.assert(r.cv && r.cv.orange > 300 && r.cv.kept, 'and it draws with no chart code involved: ' + JSON.stringify(r.cv));
  h.assert(!r.badChart && /chart is an object/.test(r.badMsg), 'a chart that is not an object is refused: ' + r.badMsg);
};

cases['in the studio a redraw is one undo step; hand edits are replaced and the panel says so once; a resized group reflows'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await h.need(page, ['charts']);
  const depth = () => page.evaluate(() => LEStudio.scene._hist.undo.length);
  const group = () => page.evaluate(() => { const L = LEStudio.scene.layers(), g = L.find((l) => l.type === 'group' && l.chart); return g ? { id: g.id, chart: g.chart, w: g.w, h: g.h, x: g.x, kids: L.filter((l) => l.groupId === g.id).length, texts: L.filter((l) => l.groupId === g.id && l.type === 'text').map((l) => l.text), fills: L.filter((l) => l.groupId === g.id && l.type === 'shape').map((l) => l.fill && l.fill.color) } : null; });
  const d0 = await depth();
  await page.evaluate(() => { LEStudio.openPanel('chart'); LEStudioCharts.add(LE.charts.sample('bar')); });
  await page.waitForFunction(() => LEStudio.scene.layers().some((l) => l.chart));
  const g1 = await group();
  h.assert.equal(await depth(), d0 + 1);
  h.assert(g1.kids === 16 && g1.texts.indexOf('70 feet') >= 0, 'the chart is ordinary layers in a group: ' + JSON.stringify(g1.texts));
  await page.waitForSelector('.cx-chips .cx-chip');
  /* one tap: highlight another row */
  await page.locator('.cx-chips .cx-chip', { hasText: 'Ballroom' }).first().click();
  await page.waitForFunction(() => { const g = LEStudio.scene.layers().find((l) => l.chart); return g && g.chart.options.highlight === 'Ballroom'; });
  h.assert.equal(await depth(), d0 + 2);
  const g2 = await group();
  h.assert(g2.kids === g1.kids && g2.fills.filter((c) => /2563EB/i.test(c)).length === 1 && g2.w === g1.w && g2.x === g1.x, 'redrawn inside the same box, one bar in the accent');
  /* a hand edit to one label, then a theme change: the edit is replaced, and the panel says so */
  await page.evaluate(() => { const L = LEStudio.scene.layers(), t = L.find((l) => l.groupId && l.type === 'text' && l.text === '70 feet'); LEStudio.scene.update(t.id, { text: 'SEVENTY' }); });
  const d3 = await depth();
  await page.click('.cx-theme[data-theme="paper"]');
  await page.waitForFunction(() => { const g = LEStudio.scene.layers().find((l) => l.chart); return g && g.chart.theme === 'paper'; });
  const g3 = await group();
  h.assert.equal(await depth(), d3 + 1);
  h.assert(g3.texts.indexOf('SEVENTY') < 0 && g3.texts.indexOf('70 feet') >= 0, 'the hand edit was replaced');
  await page.waitForFunction(() => /redraws it from its data/.test(document.body.textContent));
  /* undo brings the hand edit back; redo the theme */
  await page.evaluate(() => LEStudio.scene.undo());
  h.assert((await group()).texts.indexOf('SEVENTY') >= 0 && (await group()).chart.theme === 'clean', 'one undo: the chart as it was, hand edit and all');
  await page.evaluate(() => LEStudio.scene.redo());
  h.assert.equal((await group()).chart.theme, 'paper');
  /* a smaller box: the next redraw lays the chart out again for it */
  const small = await page.evaluate(async () => { const g = LEStudio.scene.layers().find((l) => l.chart), doc = LEStudio.scene.toJSON(), q = doc.layers.find((l) => l.id === g.id); q.w = 420; q.h = 300; const r = LE.charts.regenerate(doc, g.id, {}); return { n: r.layers.filter((l) => l.groupId === g.id).length, inside: r.layers.filter((l) => l.groupId === g.id).every((l) => l.x >= q.x - 1 && l.x + l.w <= q.x + 421 && l.y >= q.y - 1 && l.y + l.h <= q.y + 301), size: Math.max(...r.layers.filter((l) => l.type === 'text').map((l) => l.size)) }; });
  h.assert(small.inside && small.size < 22, 'the same chart in a 420 × 300 box fits it, with smaller text: ' + JSON.stringify(small));
  h.assert.noErrors(page);
};

cases['agents: chart.add, chart.update and chart.data are one undo step per batch; catalog("charts"); the file path'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await h.need(page, ['agentui', 'link']);
  await page.waitForFunction(() => window.LEAgent && window.LEStudio && LEAgent._internal.A.ready);
  const p = page.evaluate(() => LEAgent.begin({ name: 'Test agent', task: 'Charting' }));
  await page.click('.sxa-ask [data-yes]');
  h.assert((await p).ok, 'begin');
  await page.evaluate(() => LEAgent._person.setSpeed('instant'));
  const depth = () => page.evaluate(() => LEStudio.scene._hist.undo.length);
  const d0 = await depth();
  let r = await page.evaluate(() => LEAgent.apply([{ op: 'chart.add', id: 'seats', data: { columns: ['Room', 'Seats'], rows: [['Hall', 620], ['Lounge', 450], ['Terrace', 180]] }, theme: 'paper', options: { title: 'Seats by room' } }]));
  h.assert(r.ok, 'chart.add: ' + JSON.stringify(r).slice(0, 400));
  const res0 = r.results[0];
  h.assert(/Bar chart of Seats by Room, 3 bars\. Highest: Hall, 620/.test(res0.summary || (res0.result && res0.result.summary) || JSON.stringify(r)), 'the type is chosen from the data and described in a sentence: ' + JSON.stringify(res0).slice(0, 300));
  h.assert.equal(await depth(), d0 + 1);
  r = await page.evaluate(() => LEAgent.apply([{ op: 'chart.update', layer: 'seats', type: 'column', options: { highlight: 'Lounge', sort: null } }, { op: 'chart.data', layer: 'seats', csv: 'Room,Seats\nHall,640\nLounge,455\nRoof,90' }]));
  h.assert(r.ok, 'update + data: ' + JSON.stringify(r).slice(0, 400));
  h.assert.equal(await depth(), d0 + 2);
  const g = await page.evaluate(() => { const L = LEStudio.scene.layers(), q = L.find((l) => l.id === 'seats'); return { chart: q.chart, texts: L.filter((l) => l.groupId === 'seats' && l.type === 'text').map((l) => l.text) }; });
  h.assert(g.chart.type === 'column' && g.chart.options.highlight === 'Lounge' && g.chart.data.rows[2][0] === 'Roof' && g.texts.indexOf('640') >= 0 && g.texts.indexOf('Roof') >= 0, 'the chart was redrawn from the new data: ' + JSON.stringify(g.texts));
  r = await page.evaluate(() => LEAgent.apply([{ op: 'chart.add', type: 'spiral', data: { columns: ['a'], rows: [[1]] } }]));
  h.assert(!r.ok && /Unknown chart type .{1,3}spiral.*See catalog\(.{1,3}charts/.test(JSON.stringify(r)), 'a wrong type is refused with the list: ' + JSON.stringify(r).slice(0, 300));
  const cat = await page.evaluate(() => LEAgent.catalog('charts'));
  h.assert(cat.ok && cat.types.length === 23 && cat.themes.length === 9 && cat.operations['chart.add'] && /highlight/.test(cat.options), 'catalog("charts") lists types, options and themes');
  const help = await page.evaluate(() => LEAgent.help());
  h.assert(help.operations['chart.add'] && help.operations['chart.update'] && help.operations['chart.data'], 'help names the operations');
  await page.evaluate(() => LEStudio.scene.undo());
  h.assert.equal(await page.evaluate(() => LEStudio.scene.layers().find((l) => l.id === 'seats').chart.type), 'bar');
  /* the file path (command line, live link): the operation changes the data in the design file; reading it draws the layers */
  const file = await page.evaluate(async () => {
    const doc = { format: 'localeditor-design', version: 1, pages: [{ width: 1080, height: 1080, layers: [] }] };
    const a = LE.link.applyOps(doc, [{ op: 'chart.add', id: 'c1', type: 'donut', data: { columns: ['Part', 'Share'], rows: [['A', 60], ['B', 40]] } }, { op: 'chart.update', layer: 'c1', theme: 'dark' }]);
    const L = a.ok ? a.doc.pages[0].layers : [], read = a.ok ? await LE.design.parse(a.doc) : null;
    return { ok: a.ok, err: a.errors, layers: L.length, keys: L[0] ? Object.keys(L[0]).join() : '', theme: L[0] && L[0].chart.theme, read: read && read.ok, kids: read && read.ok ? read.project.pages[0].layers.filter((l) => l.groupId === 'c1').length : 0, rerr: read ? read.errors.slice(0, 2) : null };
  });
  h.assert(file.ok && file.layers === 1 && file.keys === 'id,type,name,x,y,w,h,chart' && file.theme === 'dark', 'in a design file the chart is one group with its data: ' + JSON.stringify(file));
  h.assert(file.read && file.kids > 5, 'reading the file draws its layers: ' + JSON.stringify(file));
  h.assert.noErrors(page);
};

module.exports = cases;
