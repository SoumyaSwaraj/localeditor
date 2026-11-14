/* Quick maker: chart poster (docs/CHARTS.md). An eyebrow line, a plain-sentence headline, a chart drawn to scale on a card,
   an optional note panel, a source line and a small wordmark. The chart is a chart group (layer.chart) made by LE.charts,
   so "Edit chart" works on it afterwards; every bar and label is an ordinary layer. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var STYLES = [{ id: 'paper', name: 'Paper' }, { id: 'clean', name: 'Clean' }, { id: 'dark', name: 'Dark' }, { id: 'mono', name: 'One accent' }, { id: 'vivid', name: 'Bold' }, { id: 'grey', name: 'Print grey' }];

  LE.makers.register({
    id: 'chartposter',
    name: 'Chart poster',
    category: 'Business',
    summary: 'A headline, a chart drawn to scale, a note and a source line.',
    keywords: ['chart', 'graph', 'bar chart', 'data', 'statistics', 'numbers', 'infographic', 'report', 'comparison', 'slide'],
    needs: ['assets/js/le-charts.js'],
    sizes: [{ id: 'wide', name: 'Wide', w: 1600, h: 1000 }, 'square', 'portrait', { id: 'slide', name: 'Slide 16:9', w: 1920, h: 1080 }],
    inputs: [
      { key: 'eyebrow', label: 'Small line above', type: 'text', max: 60, placeholder: 'How high the ceilings are' },
      { key: 'headline', label: 'Headline', type: 'text', required: true, max: 110, placeholder: 'Only three of the eight rooms list a ceiling height', hint: 'Say what the numbers show, in one plain sentence.' },
      { key: 'data', label: 'Numbers', type: 'list', columns: ['Label', 'Value'], max: 12, cellMax: 40, hint: 'One row per bar. Units are kept: 70 feet, $12, 45%.' },
      { key: 'chart', label: 'Chart', type: 'choice', default: 'bar', options: [{ id: 'bar', name: 'Bars' }, { id: 'column', name: 'Columns' }, { id: 'line', name: 'Line' }, { id: 'donut', name: 'Donut' }] },
      { key: 'highlight', label: 'Highlight', type: 'text', max: 40, hint: 'The label of the one row to show in colour. Empty: the first row.' },
      { key: 'inside', label: 'Numbers inside the bars', type: 'toggle' },
      { key: 'gap', label: 'Show the gap between the first two rows', type: 'toggle' },
      { key: 'gapLabel', label: 'Words in the gap', type: 'text', max: 40, placeholder: '{diff} fewer seats', hint: '{diff} and {percent} are filled in.' },
      { key: 'gapNote', label: 'Line under the gap', type: 'text', max: 60, placeholder: '{percent} percent fewer than for dinner' },
      { key: 'noteTitle', label: 'Note: first line', type: 'text', max: 60 },
      { key: 'note', label: 'Note: second line', type: 'text', max: 140 },
      { key: 'source', label: 'Source line', type: 'text', max: 170, placeholder: 'Source: where the numbers come from. The bars are drawn to scale.' },
      { key: 'wordmark', label: 'Your name or brand', type: 'text', max: 30 }
    ],
    styles: STYLES,
    sample: { values: {
      eyebrow: 'How high the ceilings are', headline: 'Only three of the eight rooms list a ceiling height',
      data: [['Grand hall', '70 feet'], ['Marble entrance', '65 feet'], ['Ballroom', '64 feet'], ['Great hall', '45 feet'], ['West lounge', '24 feet']],
      chart: 'bar', noteTitle: 'The other five don\'t list a ceiling height', note: 'Ask how high the ceiling is when you tour.',
      source: 'Sources: the rooms\' own websites, read on October 9, 2026. The bars are drawn to scale.', wordmark: 'Your name'
    } },
    build: function (v, env) {
      var C = LE.charts, W = env.W, H = env.H;
      if (!C) { var blank = env.page('#FFFFFF'); blank.layers = [env.text({ id: 'headline', name: 'Headline', text: v.headline, x: 64, y: 64, w: W - 128, h: 300, font: 'Inter', weight: 700, size: 54, min: 28 })]; env.warn('input', 'The chart maker could not be loaded.', 'data'); return { name: 'Chart poster', pages: [blank] }; }
      var T = C.theme(env.style), u = Math.max(0.72, Math.min(W / 1600, H / 900)), M = Math.round(Math.max(48, 64 * u)), L = [], page = env.page(T.page), accentInk = env.color.ensure(T.accent, T.page, 4.5), muted = env.color.ensure(T.muted, T.page, 4.5);
      var top = env.tall ? 230 : M + 8 * u, bottom = env.tall ? 290 : M * 0.72, x = M, w = W - 2 * M, y = top;
      var rows = (v.data || []).filter(function (r) { return r && String(r[0] || '').trim() && String(r[1] == null ? '' : r[1]).trim(); });
      var chart = { v: 1, type: v.chart || 'bar', data: { columns: ['Label', 'Value'], rows: rows.map(function (r) { return [String(r[0]).trim(), String(r[1]).trim()]; }) }, map: { category: 0, series: [1] }, theme: env.style, options: {} };
      var hi = String(v.highlight || '').trim() || (rows[0] ? String(rows[0][0]).trim() : '');
      if (hi && chart.type !== 'line') chart.options.highlight = hi;
      if (chart.type === 'bar') { chart.options.labelsAt = 'above'; if (v.inside) chart.options.labelPosition = 'inside'; }
      if (v.gap && rows.length >= 2 && (chart.type === 'bar' || chart.type === 'column')) { chart.options.gap = { from: String(rows[0][0]).trim(), to: String(rows[1][0]).trim() }; if (v.gapLabel) chart.options.gap.label = v.gapLabel; if (v.gapNote) chart.options.gap.note = v.gapNote; }
      /* the chart's fonts are measured too: let the pipeline load them */
      C.fonts(chart).forEach(function (f) { env.fit({ text: '0', font: f[0], weight: f[1], size: 20, w: 200 }); });

      if (v.eyebrow) {
        var eb = env.text({ id: 'eyebrow', name: 'Eyebrow', text: v.eyebrow, x: x, y: y, w: w, font: T.body, weight: 500, size: Math.round(Math.max(18, 24 * u)), min: 14, maxLines: 2, uppercase: true, tracking: 0.18, color: accentInk });
        L.push(eb); y = eb.y + eb.h + 6 * u;
      }
      var hl = env.text({ id: 'headline', name: 'Headline', text: v.headline, x: x, y: y, w: w, h: Math.max(120, H * 0.24), font: T.head, weight: T.hw, size: Math.round(Math.max(44, 54 * u)), min: 28, lineHeight: 1.12, color: T.ink });
      L.push(hl); y = hl.y + hl.h + 30 * u;

      /* from the bottom up: source line and wordmark, then the note panel; the chart card takes what is left */
      var foot = H - bottom, srcSize = Math.round(Math.max(15, 18 * u));
      if (v.wordmark || v.source) {
        var wm = v.wordmark ? env.fit({ text: v.wordmark, font: T.body, weight: 700, size: Math.round(Math.max(18, 22 * u)), w: w * 0.4, maxLines: 1 }) : null, wmW = wm ? Math.ceil(wm.textWidth || wm.width) + 8 : 0;
        var src = v.source ? env.text({ id: 'source', name: 'Source', text: v.source, x: x, y: 0, w: w - (wmW ? wmW + 32 * u : 0), font: T.body, weight: 400, size: srcSize, min: 12, maxLines: 3, lineHeight: 1.3, color: muted }) : null;
        var fh = Math.max(src ? src.h : 0, wm ? wm.height : 0);
        if (src) { src.y = foot - fh + (fh - src.h) / 2; L.push(src); }
        if (wm) L.push(env.text({ id: 'wordmark', name: 'Wordmark', text: v.wordmark, x: x + w - wmW, y: foot - fh, w: wmW, h: fh, valign: 'middle', align: 'right', font: T.body, weight: 700, size: wm.size, min: 12, maxLines: 1, color: accentInk }));
        foot -= fh + 26 * u;
      }
      if (v.noteTitle || v.note) {
        var pad = Math.round(36 * u), ink = env.color.readable(T.panel, ['#FFFFFF', T.ink]), soft = env.color.ensure(env.color.mix(ink, T.panel, 0.25), T.panel, 4.5), parts = [], ph = pad * 2;
        if (v.noteTitle) { var nt = env.text({ id: 'note-title', name: 'Note title', text: v.noteTitle, x: x + pad, y: 0, w: w - pad * 2, font: T.head, weight: T.hw, size: Math.round(Math.max(30, 40 * u)), min: 20, maxLines: 2, lineHeight: 1.15, color: ink }); parts.push(nt); ph += nt.h; }
        if (v.note) { var nb = env.text({ id: 'note', name: 'Note', text: v.note, x: x + pad, y: 0, w: w - pad * 2, font: T.body, weight: 300, size: Math.round(Math.max(24, 32 * u)), min: 18, maxLines: 3, lineHeight: 1.25, color: soft }); parts.push(nb); ph += nb.h + (v.noteTitle ? 12 * u : 0); }
        var py = foot - ph, ty = py + pad;
        L.push(env.rect({ id: 'panel', name: 'Note panel', x: x, y: py, w: w, h: ph, radius: Math.round(T.cardRadius * u), fill: T.panel }));
        parts.forEach(function (p, i) { p.y = ty; ty += p.h + 12 * u; L.push(p); });
        foot = py - 30 * u;
      }
      var box = { x: x, y: Math.round(y), w: w, h: Math.max(160, Math.round(foot - y)) };
      var res = C.render(chart, box, { id: 'chart' });
      res.notes.forEach(function (n) { env.warn('input', n, 'data'); });
      if (!rows.length) env.warn('input', 'Add at least one row: a label and a number.', 'data');
      page.layers = L.concat(res.layers, [C.groupLayer('chart', 'Chart', box, C.sanitize(chart))]);
      return { name: 'Chart — ' + String(v.headline || 'poster').slice(0, 60), pages: [page] };
    }
  });
})();
