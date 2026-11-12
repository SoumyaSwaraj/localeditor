/* Quick maker: a sheet of round and rounded stickers from short words or emoji, with cut guides (V12). */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var SETS = {
    bright: ['#FF6B4A', '#FFC23C', '#3DBB8A', '#3C8DEB', '#9B6BF2', '#FF7EB6'],
    pastel: ['#FFD6CC', '#FFEDB8', '#CDEFD9', '#CFE3FA', '#E3D7FA', '#FAD3E4'],
    retro: ['#F2E6CF', '#F2E6CF', '#F2E6CF'],
    mono: ['#111111', '#FFFFFF']
  };

  LE.makers.register({
    id: 'stickers',
    name: 'Sticker sheet',
    category: 'Print',
    summary: 'Short words and emoji as a sheet of round and rounded stickers with cut lines.',
    keywords: ['stickers', 'sticker sheet', 'reward stickers', 'emoji', 'planner stickers', 'kids', 'teacher', 'print', 'printable', 'well done', 'cut'],
    sizes: ['a4', 'letter'],
    inputs: [
      { key: 'items', label: 'Stickers', type: 'list', max: 24, cellMax: 24, placeholder: 'Well done!', hint: 'Short words or emoji, one per line. They repeat to fill the sheet.' },
      { key: 'shape', label: 'Shape', type: 'choice', default: 'mixed', options: [{ id: 'round', name: 'Round' }, { id: 'rounded', name: 'Rounded' }, { id: 'mixed', name: 'Mixed' }] },
      { key: 'size', label: 'Sticker size', type: 'choice', default: 'medium', options: [{ id: 'large', name: 'Large' }, { id: 'medium', name: 'Medium' }, { id: 'small', name: 'Small' }] },
      { key: 'repeat', label: 'Fill the sheet', type: 'toggle', default: true, hint: 'Repeat the stickers until the sheet is full.' },
      { key: 'guides', label: 'Cut guides', type: 'toggle', default: true },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'bright', name: 'Bright' },
      { id: 'pastel', name: 'Pastel' },
      { id: 'retro', name: 'Retro' },
      { id: 'mono', name: 'Black and white' },
      { id: 'ink', name: 'Ink saver' }
    ],
    sample: { values: { items: ['Well done!', 'Super star', '⭐', 'Great reading', 'Kind heart', '🌈', 'You did it!', 'Brilliant'], shape: 'mixed', size: 'medium', repeat: true, guides: true } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, P = env.print, mm = P.mm, style = env.style;
      var items = v.items && v.items.length ? v.items : ['Well done!'];
      var cols = v.size === 'large' ? 3 : v.size === 'small' ? 5 : 4;
      var S = P.safe(12), gap = mm(v.size === 'small' ? 5 : 6);
      var cw = (S.w - gap * (cols - 1)) / cols;
      var rows = Math.max(1, Math.floor((S.h + gap) / (cw + gap)));
      var count = v.repeat === false ? Math.min(items.length, cols * rows) : cols * rows;
      var cells = P.sheet({ x: S.x, y: S.y, w: S.w, h: S.h }, { cols: cols, rows: rows, w: cw, h: cw, gx: gap, gy: gap }).slice(0, count);
      if (v.repeat === false) { var shift = (S.h - (Math.ceil(count / cols) * (cw + gap) - gap)) / 2; cells = P.sheet({ x: S.x, y: S.y, w: S.w, h: S.h }, { cols: cols, rows: rows, w: cw, h: cw, gx: gap, gy: gap }).slice(0, count); cells.forEach(function (c) { c.y = Math.round(S.y + c.row * (cw + gap) + Math.max(0, shift)); }); }
      var page = env.page('#FFFFFF'), L = [], outlines = [];
      var set = SETS[style] || null;
      if (v.accent && (style === 'bright' || style === 'pastel')) set = [v.accent, C.tint(v.accent, style === 'pastel' ? 0.75 : 0.35), C.shade(v.accent, 0.2)].concat(set.slice(3));
      cells.forEach(function (c, i) {
        var n = i + 1, text = items[i % items.length];
        var round = v.shape === 'round' || (v.shape !== 'rounded' && (c.row + c.col) % 2 === 0);
        var sw = c.w, sh = round ? c.w : c.w * 0.72;
        var sx = c.x, sy = c.y + (c.h - sh) / 2;
        var fill, ink, stroke = null;
        if (style === 'bright' || style === 'pastel') { fill = set[i % set.length]; ink = C.readable(fill, style === 'pastel' ? ['#3A3346'] : ['#FFFFFF', '#1C1B22']); }
        else if (style === 'retro') { fill = '#F2E6CF'; ink = ['#B5452B', '#2F5D50', '#D08B1F', '#26406B'][i % 4]; ink = C.ensure(ink, fill, 4.5); stroke = { width: mm(1.1), color: '#2A211B' }; }
        else if (style === 'mono') { fill = i % 2 ? '#FFFFFF' : '#111111'; ink = i % 2 ? '#111111' : '#FFFFFF'; stroke = { width: mm(0.8), color: '#111111' }; }
        else { fill = '#FFFFFF'; ink = '#000000'; stroke = { width: mm(0.4), color: '#000000' }; }
        var radius = round ? 0 : Math.min(sw, sh) * 0.22;
        var spec = { id: 'sticker-' + n, name: 'Sticker ' + n, x: sx, y: sy, w: sw, h: sh, fill: fill, stroke: stroke };
        L.push(round ? env.ellipse(spec) : env.rect(Object.assign(spec, { radius: radius })));
        /* An inner ring (die-cut sticker look) for the coloured styles. */
        var ins = mm(2.2);
        if (style === 'bright' || style === 'pastel' || style === 'retro') {
          var ring = { id: 'ring-' + n, name: 'Ring ' + n, x: sx + ins, y: sy + ins, w: sw - 2 * ins, h: sh - 2 * ins, fill: { type: 'none' }, stroke: { width: mm(0.5), color: style === 'retro' ? C.rgba(ink, 0.6) : C.rgba(ink, 0.45), dash: style === 'retro' ? [mm(1.2), mm(1)] : null } };
          L.push(round ? env.ellipse(ring) : env.rect(Object.assign(ring, { radius: Math.max(0, radius - ins) })));
        }
        var emojiOnly = !/[A-Za-z0-9À-ɏ]/.test(text);
        var box = round ? { w: sw * 0.68, h: sh * 0.6 } : { w: sw * 0.8, h: sh * 0.66 };
        var font = style === 'retro' ? 'Righteous' : style === 'mono' ? 'Archivo Black' : style === 'pastel' ? 'Fraunces' : style === 'ink' ? 'Nunito' : 'Nunito';
        L.push(env.text({ id: 'text-' + n, name: 'Sticker text ' + n, text: text, x: sx + (sw - box.w) / 2, y: sy + (sh - box.h) / 2, w: box.w, h: box.h, valign: 'middle', align: 'center',
          font: font, weight: 700, size: emojiOnly ? box.h * 0.8 : Math.min(box.h * 0.42, mm(12)), min: mm(2.6), maxLines: 3, lineHeight: 1.05, uppercase: style === 'mono', color: ink, balance: false }));
        var off = mm(1.6);
        outlines.push({ x: sx - off, y: sy - off, w: sw + 2 * off, h: sh + 2 * off, shape: round ? 'ellipse' : 'rect', radius: round ? 0 : radius + off });
      });
      if (v.guides !== false) L = P.cutMarks({ outlines: outlines, color: '#9A96A2' }).concat(L);
      page.layers = L;
      return { name: 'Stickers — ' + items[0], pages: [page] };
    }
  });
})();
