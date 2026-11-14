/* Shared helpers for the print and identity makers (certificate, business card, ID badge, letterhead, voucher, ticket,
   loyalty card, menu, flyer, CV, greeting card). Not a maker: it registers nothing. Maker files load in any order, so a
   maker that needs the kit registers through it: `if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);`.
   See docs/MAKERS.md. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers, DPI = 300;
  function r2(n) { return Math.round(n * 100) / 100; }
  function px(mm) { return Math.round(mm / 25.4 * DPI); }

  /* A size given in millimetres, at 300 dpi, with its doc.print. bleed (mm) is added on every side. */
  function size(id, name, w, h, bleed) {
    bleed = bleed || 0;
    return { id: id, name: name, w: px(w + 2 * bleed), h: px(h + 2 * bleed), print: { paper: id, w: r2(w + 2 * bleed), h: r2(h + 2 * bleed), dpi: DPI } };
  }
  /* A paper size from LE.makers.PAPER under a shorter button name. */
  function paper(id, name) { var p = M.paperSize(id); p.name = name || p.name; return p; }

  /* ---------- Template fields ---------- */
  /* Turns a fitted text layer into a field: {{key}} drawn from the page's values, shrinking to this box for longer
     values. With fallback the token carries the text as its default, so a list without that column keeps the words. */
  function field(layer, key, vals, o) {
    o = o || {};
    var val = String(layer.text == null ? '' : layer.text).trim();
    if (!val) return layer;
    var keep = o.fallback && val.length <= 180 && !/[{}|]/.test(val);
    vals[key] = val;
    layer.text = '{{' + key + (keep ? '|default:' + val : '') + '}}';
    layer.overflow = 'shrink';
    layer.minSize = r2(Math.min(layer.size, o.min || layer.size * 0.5));
    return layer;
  }
  /* Binds a QR layer or a photo slot to a field, so a list can fill it row by row. */
  function bind(layer, key, fit) {
    if (layer) layer.bind = fit ? { content: key, fit: fit } : { content: key };
    return layer;
  }

  /* ---------- Layout ---------- */
  /* Stacks items top to bottom inside box and scales them down together until they fit.
     Items: text specs for env.text ({ text, size, min, gap, w, field, fallback, input, … }) or blocks
     ({ h, gap, fixed, make(x, y, w, h, s) → layer(s), drawn with y from 0 }). Falsy items and empty texts are skipped.
     o: { align, valign (top | middle | bottom), minScale, values (collects field values), scale }.
     Returns { layers, h, top, bottom, s }. When even the smallest scale is too tall, the longest text's input is flagged. */
  function stack(env, box, items, o) {
    o = o || {};
    items = items.filter(function (it) { return it && (it.make || (it.text != null && String(it.text).trim() !== '')); });
    var s = o.scale || 1, minS = o.minScale || 0.5, out = null;
    function run(s, last) {
      var y = 0, L = [], gap = 0, rows = [];
      items.forEach(function (it) {
        gap = (it.gap || 0) * s;
        if (it.make) {
          var bh = it.fixed ? it.h : it.h * s;
          [].concat(it.make(box.x, y, box.w, bh, s) || []).forEach(function (l) { if (l) L.push(l); });
          y += bh + gap;
          return;
        }
        var w = Math.min(box.w, it.w || box.w), al = it.align || o.align || 'left';
        var spec = Object.assign({}, it, { x: box.x + (al === 'center' ? (box.w - w) / 2 : al === 'right' ? box.w - w : 0) + (it.dx || 0), y: y, w: w,
          size: it.size * s, min: Math.min(it.size * s, it.min || it.size * 0.55), align: al, balance: !!(last && it.balance && !it.field) });
        delete spec.h;
        var l = env.text(spec);
        if (last && it.field && o.values) field(l, it.field, o.values, { fallback: it.fallback, min: spec.min * 0.8 });
        L.push(l);
        rows.push({ it: it, lines: Math.round(l.h / (l.size * (l.lineHeight || 1.2))) });
        y += l.h + gap;
      });
      return { layers: L, h: y - gap, rows: rows };
    }
    for (var i = 0; i < 24; i++) {
      out = run(s, false);
      if (out.h <= box.h || s <= minS) break;
      s = Math.max(minS, s * Math.max(0.8, Math.min(0.95, box.h / out.h)));
    }
    out = run(s, true);
    if (out.h > box.h + 2) {
      var worst = out.rows.filter(function (r) { return r.it.input; }).sort(function (a, b) { return b.lines - a.lines; })[0];
      env.warn('input', 'There is more text than this size holds. Shorten this, or choose a larger size.', worst ? worst.it.input : '');
    }
    var top = box.y + (o.valign === 'middle' ? Math.max(0, (box.h - out.h) / 2) : o.valign === 'bottom' ? Math.max(0, box.h - out.h) : 0);
    out.layers.forEach(function (l) { l.y = r2(l.y + top); });
    return { layers: out.layers, h: out.h, top: top, bottom: top + out.h, s: s };
  }
  /* A logo in a box without cropping it: the slot takes the picture's shape when the picture is known. */
  function logo(env, id, box, o) {
    o = o || {};
    if (!id) return null;
    var s = env.imageSize(id), w = box.w, h = box.h;
    if (s) { var k = Math.min(box.w / s.w, box.h / s.h); w = s.w * k; h = s.h * k; }
    var x = o.align === 'center' ? box.x + (box.w - w) / 2 : o.align === 'right' ? box.x + box.w - w : box.x;
    var y = o.valign === 'top' ? box.y : o.valign === 'bottom' ? box.y + box.h - h : box.y + (box.h - h) / 2;
    return env.photo({ id: o.id || 'logo', name: o.name || 'Logo', src: id, x: x, y: y, w: w, h: h, label: 'Logo', radius: o.radius || 0 });
  }
  function initials(name, n) {
    var w = String(name || '').replace(/[^\p{L}\p{N}\s&-]/gu, ' ').split(/[\s-]+/).filter(function (x) { return x && x !== '&'; });
    return w.slice(0, n || 2).map(function (x) { return Array.from(x)[0].toUpperCase(); }).join('');
  }

  /* ---------- Decorations as one SVG layer each ---------- */
  function starPath(cx, cy, R, r, n) {
    var d = '';
    for (var i = 0; i < n * 2; i++) {
      var a = Math.PI * i / n - Math.PI / 2, q = i % 2 ? r : R;
      d += (i ? 'L' : 'M') + r2(cx + q * Math.cos(a)) + ' ' + r2(cy + q * Math.sin(a));
    }
    return d + 'Z';
  }
  /* A rosette seal, with ribbon tails when ribbon is set. color: the seal; mark: the rings and the star on it. */
  function seal(color, mark, ribbon, tail) {
    var bumps = '', n = 26;
    for (var i = 0; i < n; i++) { var a = 2 * Math.PI * i / n; bumps += '<circle cx="' + r2(50 + 43 * Math.cos(a)) + '" cy="' + r2(50 + 43 * Math.sin(a)) + '" r="5.6"/>'; }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ' + (ribbon ? 140 : 100) + '">' +
      (ribbon ? '<path d="M30 70L18 138l17-11 12 13 8-58zM70 70l12 68-17-11-12 13-8-58z" fill="' + (tail || color) + '"/>' : '') +
      '<g fill="' + color + '">' + bumps + '<circle cx="50" cy="50" r="43"/></g>' +
      '<circle cx="50" cy="50" r="35" fill="none" stroke="' + mark + '" stroke-width="1.3"/>' +
      '<circle cx="50" cy="50" r="31" fill="none" stroke="' + mark + '" stroke-width="0.8" stroke-dasharray="0.9 2.3"/>' +
      '<path d="' + starPath(50, 50, 17, 7.2, 5) + '" fill="' + mark + '"/></svg>';
  }

  /* ---------- Bleed, trim and print sheets ---------- */
  /* Crop marks for a page that carries bleed: short ticks in the four corners of the bleed, on the trim lines, clear
     of the finished piece. With guides, dashed trim and safe-area outlines as a second group to hide before printing. */
  function trimMarks(env, bleed, o) {
    o = o || {};
    var W = o.w || env.W, H = o.h || env.H, g = Math.max(2, bleed * 0.2), segs = [];
    [bleed, W - bleed].forEach(function (x) { segs.push([x, 0, x, bleed - g], [x, H - bleed + g, x, H]); });
    [bleed, H - bleed].forEach(function (y) { segs.push([0, y, bleed - g, y], [W - bleed + g, y, W, y]); });
    var out = env.print.cutMarks({ cuts: segs, name: 'Crop marks', id: o.id || 'crop-marks', color: o.color || '#1A1A1A', width: Math.max(1.5, bleed * 0.05) });
    if (o.guides) {
      var safe = o.safe == null ? bleed : o.safe;
      out = out.concat(env.print.cutMarks({ name: 'Trim and safe guides', id: (o.id || 'crop-marks') + '-guides', color: o.guideColor || '#E0338A',
        outlines: [{ x: bleed, y: bleed, w: W - 2 * bleed, h: H - 2 * bleed }, { x: bleed + safe, y: bleed + safe, w: W - 2 * (bleed + safe), h: H - 2 * (bleed + safe) }] }));
    }
    return out;
  }
  /* Pieces n-up on a sheet (pure): trim boxes centred on the paper, a gutter between them, a margin for the printer and
     the crop marks. Tries the sheet upright and turned, and keeps the one that holds more. Sizes in px. */
  function fitGrid(pw, ph, cw, ch, gap, margin) {
    var cols = Math.max(1, Math.floor((pw - 2 * margin + gap) / (cw + gap))), rows = Math.max(1, Math.floor((ph - 2 * margin + gap) / (ch + gap)));
    return { cols: cols, rows: rows, w: pw, h: ph, cells: M.print.sheet({ x: 0, y: 0, w: pw, h: ph }, { cols: cols, rows: rows, w: cw, h: ch, gx: gap, gy: gap }) };
  }
  function grid(paperId, cw, ch, gap, margin) {
    var p = M.paperSize(paperId), a = fitGrid(p.w, p.h, cw, ch, gap, margin), b = fitGrid(p.h, p.w, cw, ch, gap, margin);
    var g = b.cells.length > a.cells.length ? b : a;
    g.landscape = g === b;
    g.paper = g.landscape ? paperId + '-landscape' : paperId;
    /* Turn the sheet over like a page and a piece at x lands at width − x: where each back goes. */
    g.back = g.cells.map(function (c) { return Object.assign({}, c, { x: r2(g.w - c.x - c.w), col: g.cols - 1 - c.col }); });
    g.flip = g.landscape ? 'short' : 'long';
    return g;
  }
  /* A print-sheet page: o { paper: 'a4' | 'letter', trim: { w, h } px, bleed px, draw(x, y, i) → the layers of one piece
     with its bleed at x, y, back, title }. Crop marks sit outside the bleed; a line in the margin says how to print. */
  function sheet(env, o) {
    var mm = env.print.mm, bleed = o.bleed || 0;
    var g = grid(o.paper, o.trim.w, o.trim.h, o.gap != null ? o.gap : 2 * bleed, mm(o.margin || 14));
    var page = env.page('#FFFFFF', { paper: g.paper }), L = [];
    (o.back ? g.back : g.cells).forEach(function (c, i) { L = L.concat(o.draw(c.x - bleed, c.y - bleed, i) || []); });
    L = L.concat(env.print.cutMarks({ cells: g.cells, page: { w: g.w, h: g.h }, gap: bleed ? r2(bleed / mm(1)) + 0.8 : 1.5, len: 3.5, name: 'Cut marks', id: 'sheet-marks' }));
    var note = (o.title || 'Print sheet') + ' · ' + g.cells.length + ' to a sheet · print at 100% (actual size)' +
      (o.duplex ? (o.back ? ' · back: print on the reverse, flipping on the ' + g.flip + ' edge' : ' · front') : '');
    L.push(env.text({ id: 'sheet-note', name: 'Print note', text: note, x: mm(14), y: mm(3.6), w: g.w - mm(28), h: mm(3.2), font: 'Inter', weight: 400, size: mm(2.4), min: mm(1.8), maxLines: 1, color: '#55525E' }));
    page.layers = L;
    return page;
  }

  /* ---------- A contact card for a QR code (vCard 3.0), pure ---------- */
  function vesc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1').trim(); }
  function vcard(v) {
    v = v || {};
    var name = String(v.name || '').trim();
    if (!name) return '';
    var parts = name.split(/\s+/), last = parts.length > 1 ? parts.pop() : '', first = parts.join(' ');
    var out = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + vesc(last) + ';' + vesc(first) + ';;;', 'FN:' + vesc(name)];
    if (v.company) out.push('ORG:' + vesc(v.company));
    if (v.role) out.push('TITLE:' + vesc(v.role));
    if (v.phone) out.push('TEL;TYPE=CELL:' + vesc(v.phone));
    if (v.email) out.push('EMAIL:' + vesc(v.email));
    if (v.site) out.push('URL:' + vesc(v.site));
    if (v.address) out.push('ADR:;;' + vesc(v.address) + ';;;;');
    out.push('END:VCARD');
    return out.join('\n');
  }

  /* ---------- "Make one for each row of a list" ---------- */
  function csv(rows) {
    return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n') + '\n';
  }
  /* Opens Create many on the design just made, with the maker's example list loaded and its columns matched. */
  function openMany(c, rows) {
    c.openPanel('bulk');
    var tries = 0;
    (function wait() {
      var X = window.LEStudioVariables, V = LE.variables, b = X && X.bulk && X.bulk(), p = c.S && c.S.project;
      if (!(b && V && V.parseCSV && p && b.project === p.id && b.page === p.activePage)) { if (++tries < 100) setTimeout(wait, 100); return; }
      c.syncProject();
      b.table = V.parseCSV(csv(rows), { source: 'example' });
      b.rows = null; b.done = null; b.preview = 0; b.fixed = {};
      b.mapping = V.automap(b.table.columns, V.definitions(p));
      b.step = 'match';
      c.renderPanel(true);
      c.toast('An example list is loaded. Go back to Your list to paste or choose your own.', { ms: 6000 });
    })();
  }
  /* A maker's ui hook: adds the button next to Make it. rows: the example list, first row the column names. */
  function manyUi(rows) {
    return function (form, api) {
      var foot = form.node && form.node.querySelector('.mk-foot');
      if (!foot || !form.c) return null;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost mk-many';
      b.textContent = 'Make one for each row of a list';
      b.title = 'Makes this design, then opens Create many: paste a list, or choose a CSV or Excel file.';
      foot.insertBefore(b, foot.querySelector('.mk-cancel'));
      b.onclick = function () {
        var c = form.c;
        b.disabled = true;
        Promise.resolve(api.make()).then(function (pg) { if (pg) openMany(c, rows); else b.disabled = false; });
      };
      return function () { b.remove(); };
    };
  }
  /* Registers a maker's example list (for the form button, the tests and the sample CSV on its page). */
  function many(id, rows) {
    M.lists = M.lists || {};
    M.lists[id] = rows;
    return function (form, api) { return manyUi(rows)(form, api); };
  }

  M.kit = { px: px, size: size, paper: paper, field: field, bind: bind, stack: stack, logo: logo, initials: initials, starPath: starPath, seal: seal,
    trimMarks: trimMarks, grid: grid, sheet: sheet, vcard: vcard, csv: csv, openMany: openMany, manyUi: manyUi, many: many };
  M.vcardPayload = vcard;
  /* Makers that arrived first wait in M.kitWait (see the two lines at the foot of each file). */
  (M.kitWait || []).splice(0).forEach(function (fn) { fn(M.kit); });
})();
