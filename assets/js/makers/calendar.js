/* Quick maker: monthly calendar and weekly planner to print (V12). Dates come from LE.makers.date (leap years, week start). */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var MONTHS = LE.makers.date.months;

  /* Grid lines as one graphic: outer box, rows and columns. */
  function gridSvg(w, h, xs, ys, color, width, outer) {
    var d = '';
    xs.forEach(function (x) { d += 'M' + x.toFixed(1) + ' 0V' + h.toFixed(1); });
    ys.forEach(function (y) { d += 'M0 ' + y.toFixed(1) + 'H' + w.toFixed(1); });
    if (outer) d += 'M0 0H' + w.toFixed(1) + 'V' + h.toFixed(1) + 'H0Z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"/></svg>';
  }
  function ruled(w, h, step, color, width, dash) {
    var d = '';
    for (var y = step; y < h - 1; y += step) d += 'M0 ' + y.toFixed(1) + 'H' + w.toFixed(1);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" preserveAspectRatio="none"><path d="' + (d || 'M0 0') + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>';
  }

  LE.makers.register({
    id: 'calendar',
    name: 'Calendar and planner',
    category: 'Print',
    summary: 'A month to hang on the fridge, or a week to plan, ready to print.',
    keywords: ['calendar', 'month', 'planner', 'weekly planner', 'week', 'print', 'printable', 'schedule', 'family', 'school', 'a4', 'letter'],
    sizes: ['a4', 'letter', 'a4-landscape', 'letter-landscape'],
    inputs: [
      { key: 'kind', label: 'Make', type: 'choice', default: 'month', options: [{ id: 'month', name: 'Month' }, { id: 'week', name: 'Week planner' }] },
      { key: 'month', label: 'Month', type: 'choice', default: '1', options: MONTHS.map(function (n, i) { return { id: String(i + 1), name: n }; }) },
      { key: 'year', label: 'Year', type: 'number', min: 1900, max: 2200, step: 1 },
      { key: 'week', label: 'Week of', type: 'date', hint: 'For the week planner: any day in that week. Empty: the first week of the month.' },
      { key: 'weekStart', label: 'Weeks start on', type: 'choice', default: 'mon', options: [{ id: 'mon', name: 'Monday' }, { id: 'sun', name: 'Sunday' }] },
      { key: 'title', label: 'Title', type: 'text', max: 40, placeholder: 'The Okafor family' },
      { key: 'events', label: 'Days to mark', type: 'list', columns: ['Day', 'Note'], max: 12, cellMax: 28, placeholder: '14' },
      { key: 'notes', label: 'Notes column', type: 'toggle', default: true },
      { key: 'photo', label: 'Photo', type: 'photo', hint: 'Shown by the Photo style.' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'clean', name: 'Clean' },
      { id: 'friendly', name: 'Friendly' },
      { id: 'photo', name: 'Photo' },
      { id: 'bold', name: 'Bold' },
      { id: 'ink', name: 'Ink saver' }
    ],
    sample: { values: {
      kind: 'month', month: '12', year: 2026, weekStart: 'mon', title: 'The Okafor family', notes: true, photo: 'sample:garden-02',
      events: [['5', 'Swimming gala'], ['12', 'Grandma visits'], ['18', 'Last day of term'], ['24', 'Bake the pies'], ['25', 'Christmas Day'], ['31', 'Fireworks']]
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, D = env.date, P = env.print, mm = P.mm;
      var style = env.style, th = P.theme(style === 'photo' ? 'clean' : style, v.accent);
      var land = W > H;
      var ws = v.weekStart === 'sun' ? 0 : 1;
      var year = v.year || D.parse(env.today).y, month = Number(v.month) || 1;
      var page = env.page(th.bg), L = [];
      var S = P.safe(land ? 11 : 12);
      var ink = th.ink, muted = th.muted, acc = th.inkSaver ? th.ink : th.accent;
      var accInk = C.ensure(acc, th.bg, 4.5);
      var notes = v.notes !== false;
      var marks = {};
      (v.events || []).forEach(function (r) {
        var d = parseInt(String(r[0]).replace(/^\d{4}-\d{2}-/, ''), 10);
        if (d >= 1 && d <= 31 && r[1]) (marks[d] = marks[d] || []).push(r[1]);
      });
      var hf = th.head, bf = th.body, hw = th.headWeight;

      /* Header: title (small, above), the period (large), and a kicker. Returns the y below it. */
      function header(box, big, small, kicker, onDark) {
        var col = onDark || ink, y = box.y, out = [];
        if (small) { var t = env.text({ id: 'title', name: 'Title', text: small, x: box.x, y: y, w: box.w, font: bf, weight: 700, size: mm(5), min: mm(3.2), maxLines: 1, uppercase: true, tracking: 0.12, color: onDark || accInk }); out.push(t); y = t.y + t.h + mm(1.5); }
        var b = env.text({ id: 'period', name: 'Month', text: big, x: box.x, y: y, w: box.w * (kicker ? 0.72 : 1), font: hf, weight: hw, size: mm(land ? 17 : 19), min: mm(9), maxLines: 1, lineHeight: 1.05, color: col });
        out.push(b);
        if (kicker) {
          var yl = env.text({ id: 'year', name: 'Year', text: kicker, x: box.x + box.w * 0.72, y: 0, w: box.w * 0.28, font: hf, weight: hw, size: mm(land ? 9 : 10), min: mm(5), maxLines: 1, align: 'right', color: onDark || (th.inkSaver ? ink : accInk) });
          /* Sit the year on the month's baseline (both fonts descend about a fifth of their size). */
          yl.y = Math.round(b.y + b.h - b.size * 0.25 - (yl.h - yl.size * 0.25));
          out.push(yl);
        }
        L = L.concat(out);
        return b.y + b.h;
      }
      function notesBox(box) {
        var out = [];
        if (!th.inkSaver && th.faint) out.push(env.rect({ id: 'notes-bg', name: 'Notes background', x: box.x, y: box.y, w: box.w, h: box.h, radius: th.r, fill: th.faint }));
        else out.push(env.rect({ id: 'notes-bg', name: 'Notes box', x: box.x, y: box.y, w: box.w, h: box.h, radius: th.r, fill: { type: 'none' }, stroke: { width: th.hair, color: th.line } }));
        var t = env.text({ id: 'notes-title', name: 'Notes heading', text: 'Notes', x: box.x + mm(4), y: box.y + mm(3.5), w: box.w - mm(8), font: hf, weight: hw, size: mm(5.5), min: mm(4), maxLines: 1, color: ink });
        out.push(t);
        var top = t.y + t.h + mm(2), lh = mm(8.5);
        var rh = box.y + box.h - mm(4) - top;
        if (rh > lh) out.push(env.svg({ id: 'notes-lines', name: 'Notes lines', x: box.x + mm(4), y: top, w: box.w - mm(8), h: rh, markup: ruled(box.w - mm(8), rh, lh, th.inkSaver ? '#9A9A9A' : th.line, th.hair) }));
        L = L.concat(out);
      }

      if (v.kind !== 'week') {
        var grid = D.monthGrid(year, month, ws);
        var top = S.y;
        if (style === 'photo') {
          var phH = Math.round(H * (land ? 0.38 : 0.36));
          if (land) {
            L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: Math.round(W * 0.36), h: H, label: 'Add a photo for the month' }));
            S = { x: Math.round(W * 0.36) + mm(10), y: S.y, w: W - Math.round(W * 0.36) - mm(10) - mm(11), h: S.h };
          } else {
            L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: phH, label: 'Add a photo for the month' }));
            S = { x: S.x, y: phH + mm(8), w: S.w, h: H - phH - mm(8) - mm(12) };
          }
          top = S.y;
        } else if (style === 'bold') {
          var bandH = mm(land ? 30 : 36);
          L.push(env.rect({ id: 'band', name: 'Header band', x: 0, y: 0, w: W, h: bandH + S.y, fill: acc }));
          top = S.y;
        }
        var area = { x: S.x, y: top, w: S.w, h: S.h - (top - S.y) };
        var notesW = notes && land ? Math.round(area.w * 0.24) : 0, notesH = notes && !land ? mm(42) : 0;
        var hdrInk = style === 'bold' ? C.readable(acc, [ink, '#FFFFFF']) : null;
        var y = header({ x: area.x, y: area.y, w: area.w - notesW - (notesW ? mm(6) : 0) }, MONTHS[month - 1], v.title, String(year), hdrInk);
        y += style === 'bold' ? mm(10) : mm(6);
        var gx = area.x, gw = area.w - notesW - (notesW ? mm(6) : 0);
        var names = D.weekdays(ws, gw / 7 > mm(30) ? 'dddd' : 'ddd');
        var dayH = mm(9);
        if (style === 'friendly' && !th.inkSaver) L.push(env.rect({ id: 'weekday-band', name: 'Weekday band', x: gx, y: y, w: gw, h: dayH, radius: th.r, fill: acc }));
        var dayInk = style === 'friendly' ? C.readable(acc, ['#FFFFFF', ink]) : muted;
        names.forEach(function (n, i) {
          L.push(env.text({ id: 'weekday-' + (i + 1), name: n, text: n, x: gx + i * gw / 7, y: y, w: gw / 7, h: dayH, valign: 'middle', font: bf, weight: 700, size: mm(3.6), min: mm(2.4), maxLines: 1, uppercase: true, tracking: 0.08, align: 'center', color: dayInk }));
        });
        y += dayH + mm(2);
        var gh = area.y + area.h - notesH - (notesH ? mm(6) : 0) - y;
        var rows = grid.length, cw = gw / 7, ch = gh / rows;
        var radius = style === 'friendly' ? th.r : 0;
        /* Cells: friendly and pastel draw soft tiles; the others draw ruled lines. */
        if (style === 'friendly') {
          grid.forEach(function (wk, r) { wk.forEach(function (d, c) {
            if (!d.inMonth) return;
            L.push(env.rect({ id: 'cell', name: 'Day ' + d.d, x: gx + c * cw + mm(0.8), y: y + r * ch + mm(0.8), w: cw - mm(1.6), h: ch - mm(1.6), radius: radius, fill: th.faint }));
          }); });
        } else {
          var xs = [], ys = [];
          for (var i = 1; i < 7; i++) xs.push(i * cw);
          for (var j = 1; j < rows; j++) ys.push(j * ch);
          L.push(env.svg({ id: 'grid', name: 'Calendar grid', x: gx, y: y, w: gw, h: gh, markup: gridSvg(gw, gh, xs, ys, style === 'bold' ? ink : th.line, style === 'bold' ? mm(0.5) : th.hair, true) }));
        }
        var today = D.parse(env.today);
        grid.forEach(function (wk, r) {
          wk.forEach(function (d, c) {
            var cx = gx + c * cw, cy = y + r * ch;
            if (!d.inMonth) return;
            var weekend = (D.weekday(d) === 0 || D.weekday(d) === 6);
            var numCol = weekend && !th.inkSaver && style !== 'bold' ? accInk : ink;
            var n = env.text({ id: 'day-' + d.iso, name: 'Day ' + d.d, text: String(d.d), x: cx + mm(2.2), y: cy + mm(1.6), w: cw - mm(4.4), font: style === 'bold' || style === 'clean' || style === 'photo' ? hf : bf, weight: 700, size: mm(land ? 5 : 5.6), min: mm(3), maxLines: 1, color: numCol });
            L.push(n);
            if (marks[d.d]) {
              var ny = n.y + n.h + mm(0.6);
              var room = cy + ch - mm(1.6) - ny;
              if (room > mm(3)) {
                L.push(env.text({ id: 'note-' + d.d, name: 'Note ' + d.d, text: marks[d.d].join(' · '), x: cx + mm(2.2), y: ny, w: cw - mm(4.4), h: room, font: bf, weight: 400, size: mm(3.1), min: mm(1.9), lineHeight: 1.15, color: ink }));
              }
            }
          });
        });
        if (notesW) notesBox({ x: area.x + area.w - notesW, y: area.y, w: notesW, h: area.h });
        if (notesH) notesBox({ x: area.x, y: area.y + area.h - notesH, w: area.w, h: notesH });
        page.layers = L;
        return { name: 'Calendar — ' + MONTHS[month - 1] + ' ' + year, pages: [page] };
      }

      /* Week planner. */
      var start = v.week ? D.weekOf(v.week, ws) : D.weekOf({ y: year, m: month, d: 1 }, ws);
      var days = [];
      for (var k = 0; k < 7; k++) days.push(D.addDays(start, k));
      var end = days[6];
      var range = start.m === end.m ? start.d + '–' + end.d + ' ' + MONTHS[start.m - 1] : start.d + ' ' + MONTHS[start.m - 1].slice(0, 3) + ' – ' + end.d + ' ' + MONTHS[end.m - 1].slice(0, 3);
      var yr = start.y === end.y ? String(start.y) : start.y + '/' + String(end.y).slice(-2);
      var top2 = S.y;
      if (style === 'photo') {
        var pH = mm(land ? 0 : 52);
        if (land) { L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: Math.round(W * 0.26), h: H, label: 'Add a photo' })); S = { x: Math.round(W * 0.26) + mm(9), y: S.y, w: W - Math.round(W * 0.26) - mm(9) - mm(11), h: S.h }; }
        else { L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: pH, label: 'Add a photo' })); S = { x: S.x, y: pH + mm(7), w: S.w, h: H - pH - mm(7) - mm(12) }; }
        top2 = S.y;
      } else if (style === 'bold') {
        L.push(env.rect({ id: 'band', name: 'Header band', x: 0, y: 0, w: W, h: S.y + mm(land ? 27 : 31), fill: acc }));
      }
      var hInk = style === 'bold' ? C.readable(acc, [ink, '#FFFFFF']) : null;
      var yy = header({ x: S.x, y: top2, w: S.w }, range, v.title || 'This week', yr, hInk) + (style === 'bold' ? mm(10) : mm(6));
      var area2 = { x: S.x, y: yy, w: S.w, h: S.y + S.h - yy };
      var boxes;
      if (land) {
        boxes = env.grid(area2, 8, 4, mm(4));
      } else {
        var colW = notes ? Math.round(area2.w * 0.3) : 0;
        boxes = env.grid({ x: area2.x, y: area2.y, w: area2.w - (colW ? colW + mm(5) : 0), h: area2.h }, 7, 1, mm(2.5));
        if (colW) boxes.push({ x: area2.x + area2.w - colW, y: area2.y, w: colW, h: area2.h });
      }
      days.forEach(function (d, i) {
        var b = boxes[i];
        var fill = th.inkSaver || !th.faint ? null : (style === 'friendly' || style === 'pastel') ? th.faint : null;
        L.push(env.rect({ id: 'day-box', name: D.format(d, 'dddd') + ' box', x: b.x, y: b.y, w: b.w, h: b.h, radius: th.r, fill: fill || { type: 'none' }, stroke: fill ? null : { width: style === 'bold' ? mm(0.5) : th.hair, color: style === 'bold' ? ink : th.line } }));
        var lab = land ? { x: b.x + mm(3.5), y: b.y + mm(3), w: b.w - mm(7) } : { x: b.x + mm(3.5), y: b.y + mm(2.5), w: Math.min(mm(42), b.w * 0.3) };
        var dn = env.text({ id: 'dayname-' + (i + 1), name: D.format(d, 'dddd'), text: D.format(d, 'dddd'), x: lab.x, y: lab.y, w: lab.w, font: hf, weight: hw, size: mm(5.2), min: mm(3.2), maxLines: 1, color: (D.weekday(d) === 0 || D.weekday(d) === 6) && !th.inkSaver ? accInk : ink });
        L.push(dn);
        var dd = env.text({ id: 'date-' + (i + 1), name: 'Date ' + (i + 1), text: D.format(d, 'D MMMM'), x: lab.x, y: dn.y + dn.h, w: lab.w, font: bf, weight: 400, size: mm(3.6), min: mm(2.6), maxLines: 1, color: muted });
        L.push(dd);
        var mk = d.m === month || true ? marks[d.d] : null;
        var lineTop = land ? dd.y + dd.h + mm(3) : b.y + mm(3);
        var lx = land ? b.x + mm(3.5) : lab.x + lab.w + mm(4), lw = land ? b.w - mm(7) : b.x + b.w - mm(3.5) - lx;
        if (mk) {
          var nt = env.text({ id: 'note-' + (i + 1), name: 'Note ' + (i + 1), text: mk.join(' · '), x: lx, y: lineTop, w: lw, h: mm(12), font: bf, weight: 700, size: mm(3.6), min: mm(2.4), maxLines: 2, color: th.inkSaver ? ink : accInk });
          L.push(nt);
          lineTop = nt.y + nt.h + mm(1);
        }
        var lh2 = b.y + b.h - mm(2.5) - lineTop;
        if (lh2 > mm(8)) L.push(env.svg({ id: 'lines-' + (i + 1), name: 'Lines ' + (i + 1), x: lx, y: lineTop, w: lw, h: lh2, markup: ruled(lw, lh2, mm(7.5), th.line, th.hair, th.inkSaver ? '6 6' : '') }));
      });
      if (boxes[7] && (notes || land)) notesBox(boxes[7]);
      page.layers = L;
      return { name: 'Week planner — ' + range + ' ' + yr, pages: [page] };
    }
  });
})();
