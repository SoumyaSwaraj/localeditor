/* Quick maker: labels and gift tags, a sheet of them with cut guides (V12). Generic label grids, no brands. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var ICONS = [
    { id: 'none', name: 'No icon' }, { id: 'heart', name: 'Heart' }, { id: 'star', name: 'Star' }, { id: 'leaf', name: 'Leaf' },
    { id: 'gift', name: 'Gift' }, { id: 'flower-2', name: 'Flower' }, { id: 'cookie', name: 'Cookie' }, { id: 'cherry', name: 'Fruit' },
    { id: 'book', name: 'Book' }, { id: 'pencil', name: 'Pencil' }, { id: 'snowflake', name: 'Snowflake' }, { id: 'sparkles', name: 'Sparkles' }
  ];
  /* A gift-tag outline: clipped top corners. */
  function tagPath(w, h, cut) {
    return 'M' + cut + ' 0H' + (w - cut) + 'L' + w + ' ' + cut + 'V' + h + 'H0V' + cut + 'Z';
  }
  function tagSvg(w, h, cut, fill, stroke, sw) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" preserveAspectRatio="none"><path d="' + tagPath(w, h, cut) + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '"' : '') + '/></svg>';
  }

  LE.makers.register({
    id: 'labels',
    name: 'Labels and gift tags',
    category: 'Print',
    summary: 'A sheet of labels for jars, books and school things, or gift tags with a punch hole.',
    keywords: ['labels', 'label sheet', 'gift tags', 'tags', 'jar labels', 'name labels', 'school labels', 'stickers', 'print', 'printable', 'pantry', 'jam'],
    sizes: ['a4', 'letter'],
    inputs: [
      { key: 'kind', label: 'Make', type: 'choice', default: 'labels', options: [{ id: 'labels', name: 'Labels' }, { id: 'tags', name: 'Gift tags' }] },
      { key: 'lines', label: 'Label text', type: 'list', max: 30, cellMax: 40, placeholder: 'Strawberry jam', hint: 'One label per line; the sheet repeats them to fill every space.' },
      { key: 'second', label: 'Second line', type: 'text', max: 48, placeholder: 'Homemade · June 2026' },
      { key: 'grid', label: 'Labels per sheet', type: 'choice', default: '21', options: [{ id: '8', name: '8 (2 × 4)' }, { id: '14', name: '14 (2 × 7)' }, { id: '21', name: '21 (3 × 7)' }, { id: '24', name: '24 (3 × 8)' }, { id: '30', name: '30 (3 × 10)' }, { id: '65', name: '65 (5 × 13)' }], hint: 'For labels. Gift tags come 9 to a sheet.' },
      { key: 'icon', label: 'Icon', type: 'choice', default: 'none', options: ICONS },
      { key: 'guides', label: 'Cut guides', type: 'toggle', default: true, hint: 'Crop marks and cut lines. Turn off for pre-cut label sheets.' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'clean', name: 'Clean' },
      { id: 'kraft', name: 'Kraft' },
      { id: 'pastel', name: 'Pastel' },
      { id: 'bold', name: 'Bold' },
      { id: 'ink', name: 'Ink saver' }
    ],
    sample: { values: { kind: 'labels', lines: ['Strawberry jam', 'Apricot jam', 'Lemon curd'], second: 'Homemade · June 2026', grid: '21', icon: 'cherry', guides: true } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, P = env.print, mm = P.mm;
      var style = env.style, th = P.theme(style === 'kraft' ? 'clean' : style, v.accent);
      if (style === 'kraft') { th.faint = '#D8B98E'; th.ink = '#3A2716'; th.muted = '#5A3F25'; th.accent = v.accent || '#7A4A22'; th.head = 'Libre Baskerville'; th.headWeight = 700; th.body = 'Kalam'; th.line = '#8A6440'; }
      var tags = v.kind === 'tags';
      var lines = v.lines && v.lines.length ? v.lines : [tags ? 'For you' : 'Label'];
      var page = env.page(th.bg), L = [], guides = [];
      var cells;
      if (tags) {
        cells = P.sheet(P.safe(12), { cols: 3, rows: 3, gx: mm(6), gy: mm(6) });
      } else {
        cells = P.labels(v.grid || '21') || P.labels('21');
      }
      var ink = th.ink;
      var small = Math.min(cells[0].w, cells[0].h) < mm(24);
      cells.forEach(function (c, i) {
        var text = lines[i % lines.length];
        var n = i + 1, pad = Math.max(mm(2.2), Math.min(c.w, c.h) * 0.09);
        var fill = style === 'ink' ? null : style === 'bold' ? (i % 3 === 0 ? th.accent : i % 3 === 1 ? th.accent3 : th.accent2) : style === 'pastel' ? [th.faint, '#FDF0F3', '#EEF8F5'][i % 3] : style === 'kraft' ? th.faint : null;
        var hole = null;
        if (tags) {
          var cut = Math.min(c.w * 0.22, mm(12));
          L.push(env.svg({ id: 'tag-' + n, name: 'Tag ' + n, x: c.x, y: c.y, w: c.w, h: c.h, markup: tagSvg(c.w, c.h, cut, fill || '#FFFFFF', fill ? null : (style === 'clean' ? th.accent : th.line), th.hair * 1.2) }));
          hole = { x: c.x + c.w / 2, y: c.y + mm(9), d: mm(5) };
          guides.push({ hole: hole });
        } else if (fill) {
          L.push(env.rect({ id: 'label-' + n, name: 'Label ' + n, x: c.x, y: c.y, w: c.w, h: c.h, radius: mm(small ? 1.5 : 2.5), fill: fill }));
        }
        var bg = fill || th.bg;
        var tInk = C.readable(bg, [ink, '#FFFFFF']);
        var inner = { x: c.x + pad, y: c.y + pad + (tags ? mm(14) : 0), w: c.w - 2 * pad, h: c.h - 2 * pad - (tags ? mm(14) : 0) };
        if (style === 'clean' && !tags) L.push(env.rect({ id: 'frame-' + n, name: 'Frame ' + n, x: c.x + pad * 0.45, y: c.y + pad * 0.45, w: c.w - pad * 0.9, h: c.h - pad * 0.9, radius: mm(1.5), fill: { type: 'none' }, stroke: { width: th.hair, color: C.ensure(th.accent, th.bg, 3) } }));
        if (style === 'ink' && !v.guides) L.push(env.rect({ id: 'frame-' + n, name: 'Outline ' + n, x: c.x, y: c.y, w: c.w, h: c.h, radius: mm(2), fill: { type: 'none' }, stroke: { width: th.hair, color: '#8C8C8C', dash: [mm(1), mm(1)] } }));
        var wide = inner.w / inner.h > 2.3;
        var iconId = v.icon && v.icon !== 'none' ? 'lucide:' + v.icon : '';
        var block = [];
        var iconSize = iconId ? Math.min(inner.h * (wide ? 0.62 : 0.3), inner.w * 0.3, mm(tags ? 16 : 14)) : 0;
        var tx = inner.x, tw = inner.w;
        var iconInk = style === 'bold' || style === 'ink' ? tInk : C.ensure(th.accent, bg, 3);
        if (iconId && wide) {
          L.push(env.icon(iconId, { id: 'icon-' + n, name: 'Icon ' + n, x: inner.x, y: inner.y + (inner.h - iconSize) / 2, w: iconSize, h: iconSize, color: iconInk, strokeWidth: 1.8 }));
          tx += iconSize + pad * 0.8; tw -= iconSize + pad * 0.8;
        } else if (iconId) {
          block.push(env.icon(iconId, { id: 'icon-' + n, name: 'Icon ' + n, x: inner.x + (inner.w - iconSize) / 2, y: 0, w: iconSize, h: iconSize, color: iconInk, strokeWidth: 1.8 }));
        }
        var align = wide && iconId ? 'left' : 'center';
        var hasSecond = !!v.second && inner.h > mm(9);
        var mainH = inner.h * (hasSecond ? 0.62 : 1) - (block.length ? iconSize + mm(1.5) : 0);
        var t1 = env.text({ id: 'text-' + n, name: 'Label text ' + n, text: text, x: tx, y: 0, w: tw, h: Math.max(mm(3), mainH), font: th.head, weight: th.headWeight, size: Math.min(mm(9), inner.h * 0.42), min: mm(2.4), maxLines: 3, lineHeight: 1.08, align: align, color: tInk });
        if (block.length) t1.y = block[0].y + iconSize + mm(1.5);
        block.push(t1);
        if (hasSecond) {
          var t2 = env.text({ id: 'second-' + n, name: 'Second line ' + n, text: v.second, x: tx, y: t1.y + t1.h + mm(0.8), w: tw, h: inner.h * 0.34, font: th.body, weight: style === 'kraft' ? 400 : 700, size: Math.min(mm(4), inner.h * 0.2), min: mm(1.9), maxLines: 2, lineHeight: 1.1, align: align, uppercase: style !== 'kraft', tracking: style !== 'kraft' ? 0.06 : 0, color: style === 'bold' ? tInk : C.ensure(th.muted, bg, 4.5) });
          block.push(t2);
        }
        env.place(block, inner, 'middle');
        L = L.concat(block);
      });
      if (v.guides !== false) L = P.cutMarks({ cells: cells, lines: !tags, color: style === 'ink' ? '#8C8C8C' : '#9A96A2' }).concat(L);
      if (tags) L = L.concat(P.cutMarks({ holes: guides.map(function (x) { return x.hole; }), name: 'Punch holes', id: 'punch-holes', color: style === 'ink' ? '#8C8C8C' : '#9A96A2' }));
      page.layers = L;
      return { name: (tags ? 'Gift tags' : 'Labels') + ' — ' + lines[0], pages: [page] };
    }
  });
})();
