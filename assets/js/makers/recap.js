/* Quick maker: recap collages (2.10). "My week / month / year / trip" from 4 to 30 photos: a title, a date range and an
   optional line of stats the person types, over a layout that adapts to how many photos there are and which way they
   face. Grid and big-first layouts come from the collage engine (LE.collage.layouts), picked by how little each photo
   has to be cropped; fitted rows and the contact sheet are laid out here. In the studio form, photos are put in the
   order they were taken (read on the device from each photo's capture date) and the date range is suggested from them. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var MK = LE.makers;

  var PERIODS = [{ id: 'week', name: 'Week' }, { id: 'month', name: 'Month' }, { id: 'year', name: 'Year' }, { id: 'trip', name: 'Trip' }];
  var DEFAULT_TITLE = { week: 'My week', month: 'This month', year: 'My year', trip: 'The trip' };
  var MIN_SLOTS = 4;

  /* "3 – 9 November 2026", "28 Oct – 3 Nov 2026", "30 Dec 2025 – 2 Jan 2026"; one date alone is written in full. */
  function rangeText(D, from, to, period) {
    if (from && to && from > to) { var t = from; from = to; to = t; }
    if (!from && !to) return '';
    if (!from || !to || from === to) return D.format(from || to, period === 'year' ? 'YYYY' : 'D MMMM YYYY');
    var a = D.parse(from), b = D.parse(to);
    if (period === 'year') return a.y === b.y ? String(a.y) : a.y + ' – ' + b.y;
    if (period === 'month' && a.y === b.y && a.m === b.m && a.d === 1 && b.d === D.daysIn(b.y, b.m)) return D.format(from, 'MMMM YYYY');
    if (a.y === b.y && a.m === b.m) return a.d + ' – ' + D.format(to, 'D MMMM YYYY');
    if (a.y === b.y) return D.format(from, 'D MMM') + ' – ' + D.format(to, 'D MMM YYYY');
    return D.format(from, 'D MMM YYYY') + ' – ' + D.format(to, 'D MMM YYYY');
  }
  MK.recapRange = function (from, to, period) { return rangeText(MK.date, from, to, period); };

  /* Splits n photos (aspect ratios ar[]) into rows of even height that fill width w; returns the best row count. */
  function justified(ar, w, h, gap) {
    var n = ar.length, best = null;
    for (var R = 1; R <= Math.min(n, 8); R++) {
      var total = ar.reduce(function (a, x) { return a + x; }, 0), target = total / R;
      var rows = [], cur = [], sum = 0;
      for (var i = 0; i < n; i++) {
        cur.push(i); sum += ar[i];
        var left = n - i - 1, rowsLeft = R - rows.length - 1;
        if (rowsLeft > 0 && (sum >= target * 0.92 || left === rowsLeft)) { rows.push(cur); cur = []; sum = 0; }
      }
      if (cur.length) rows.push(cur);
      var hh = rows.reduce(function (a, r) { var s = r.reduce(function (q, k) { return q + ar[k]; }, 0); return a + (w - gap * (r.length - 1)) / s; }, 0) + gap * (rows.length - 1);
      var fill = hh <= h ? hh / h : h / hh * 0.85;
      if (!best || fill > best.fill) best = { rows: rows, height: hh, fill: fill };
    }
    return best;
  }

  MK.register({
    id: 'recap',
    name: 'Recap collage',
    category: 'Photo',
    summary: 'My week, month, year or trip: up to 30 photos, a title, the dates and a line of stats.',
    keywords: ['recap', 'collage', 'week', 'month', 'year', 'trip', 'dump', 'photo dump', 'highlights', 'memories', 'review', 'travel', 'grid', 'moodboard', 'year in review'],
    inputs: [
      { key: 'photos', label: 'Photos', type: 'photos', max: 30, required: true, hint: 'Four to thirty. They are put in the order they were taken when the photos know.' },
      { key: 'period', label: 'A recap of', type: 'choice', options: PERIODS, default: 'week' },
      { key: 'title', label: 'Title', type: 'text', max: 40, placeholder: 'My week' },
      { key: 'from', label: 'From', type: 'date', hint: 'Suggested from the photos' },
      { key: 'to', label: 'To', type: 'date' },
      { key: 'stats', label: 'Stats line', type: 'text', max: 70, placeholder: '12 hikes · 3 cities · 1 sunburn' },
      { key: 'order', label: 'Order', type: 'choice', options: [{ id: 'taken', name: 'By date taken' }, { id: 'picked', name: 'As picked' }], default: 'taken' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'clean', name: 'Clean grid' },
      { id: 'bold', name: 'Big title' },
      { id: 'rows', name: 'Fitted rows' },
      { id: 'prints', name: 'Prints' },
      { id: 'film', name: 'Contact sheet' }
    ],
    sample: { values: {
      photos: ['sample:travel-01', 'sample:travel-03', 'sample:nature-01', 'sample:people-08', 'sample:still-02', 'sample:travel-05', 'sample:sky-02', 'sample:street-02', 'sample:garden-03', 'sample:travel-07'],
      period: 'trip', title: 'Coast to coast', from: '2026-10-03', to: '2026-10-11', stats: '9 days · 4 towns · 212 km on foot', order: 'taken'
    } },
    ui: ui,
    build: build
  });

  function build(v, env) {
    var W = env.W, H = env.H, C = env.color, u = Math.min(W, H) / 100, style = env.style;
    var photos = (v.photos || []).slice(0, 30);
    var n = Math.max(MIN_SLOTS, photos.length);
    var ar = [];
    for (var i = 0; i < n; i++) { var s = photos[i] ? env.imageSize(photos[i]) : null; ar.push(s ? Math.max(0.4, Math.min(2.6, s.w / s.h)) : (i % 3 === 1 ? 0.8 : 1.33)); }
    var period = v.period || 'week';
    var title = v.title || DEFAULT_TITLE[period];
    var when = rangeText(env.date, v.from, v.to, period);
    var accent = v.accent || null;
    var top = env.tall ? 220 : 0, bottom = env.tall ? 280 : 0;
    var M = Math.round((style === 'film' ? 5 : 6) * u);
    var safe = { x: M, y: top + M, w: W - 2 * M, h: H - top - bottom - 2 * M };
    var T = {
      clean: { bg: '#FAF8F4', ink: '#17171A', sub: '#5E5A55', head: 'Fraunces', hw: 700, size: 9.4, gap: 1.1, radius: 1.1 },
      bold: { bg: accent ? C.shade(accent, 0.55) : '#141416', ink: '#FFFFFF', sub: '#C9C9CF', head: 'Anton', hw: 400, size: 15, upper: true, gap: 0.9, radius: 0 },
      rows: { bg: '#EFEAE1', ink: '#1F1C18', sub: '#5D564C', head: 'DM Serif Display', hw: 400, size: 9.6, gap: 1, radius: 0.5 },
      prints: { bg: accent ? C.tint(accent, 0.72) : '#E7DDCF', ink: '#2A2320', sub: '#5A4E45', head: 'Caveat', hw: 700, size: 12, gap: 0, radius: 0 },
      film: { bg: '#121110', ink: '#F1ECE4', sub: '#E9A35B', head: 'Space Mono', hw: 700, size: 6.4, upper: true, gap: 1.1, radius: 0 }
    }[style] || null;
    var page = env.page(T.bg), L = [];
    var ink = C.ensure(T.ink, T.bg, 4.6), sub = C.ensure(accent && style !== 'bold' && style !== 'prints' ? accent : T.sub, T.bg, 4.6);
    var center = style === 'rows' || style === 'prints' || style === 'film';

    /* ---- Words: eyebrow (dates), title, stats ---- */
    var words = [];
    var titleL = env.text({ id: 'title', name: 'Title', text: title, x: safe.x, y: safe.y, w: safe.w, font: T.head, weight: T.hw, uppercase: !!T.upper,
      size: T.size * u * (env.size.id === 'square' ? 0.9 : 1), min: 4 * u, maxLines: 2, lineHeight: T.upper ? 0.98 : 1.04, tracking: T.upper ? (style === 'film' ? 0.08 : 0.005) : -0.02, align: center ? 'center' : 'left', balance: true, color: ink });
    var dateL = when ? env.text({ id: 'dates', name: 'Dates', text: when, x: safe.x, y: 0, w: safe.w, font: style === 'film' ? 'Space Mono' : 'Inter', weight: style === 'bold' ? 700 : 600, uppercase: style !== 'prints',
      size: 2.5 * u, min: 1.8 * u, maxLines: 1, tracking: 0.12, align: center ? 'center' : 'left', color: sub }) : null;
    var statsL = v.stats ? env.text({ id: 'stats', name: 'Stats', text: v.stats, x: safe.x, y: 0, w: safe.w, font: style === 'film' ? 'Space Mono' : style === 'prints' ? 'Caveat' : 'Inter', weight: style === 'prints' ? 700 : 500,
      size: (style === 'prints' ? 4.6 : 3) * u, min: 2 * u, maxLines: 2, lineHeight: 1.3, align: center ? 'center' : 'left', balance: true, color: style === 'bold' ? ink : C.ensure(T.sub, T.bg, 4.6) }) : null;
    /* Big title: words at the bottom, photos above. Others: words on top. */
    var y = safe.y;
    if (dateL) { dateL.y = y; words.push(dateL); y += dateL.h + 1.2 * u; }
    titleL.y = y; words.push(titleL); y += titleL.h;
    if (statsL) { statsL.y = y + 1.4 * u; words.push(statsL); y = statsL.y + statsL.h; }
    var blockH = y - safe.y, gapToPhotos = 4 * u;
    var area;
    if (style === 'bold') {
      var dy = safe.y + safe.h - blockH - (safe.y);
      words.forEach(function (l) { l.y = Math.round(l.y + dy); });
      area = { x: safe.x, y: safe.y, w: safe.w, h: safe.h - blockH - gapToPhotos };
    } else area = { x: safe.x, y: safe.y + blockH + gapToPhotos, w: safe.w, h: safe.h - blockH - gapToPhotos };
    if (area.h < safe.h * 0.35) area.h = safe.h * 0.35;

    /* ---- Photos ---- */
    var gap = Math.round(T.gap * u), rad = Math.round(T.radius * u);
    function slot(i, r, extra) {
      return env.photo(Object.assign({ id: 'photo', name: 'Photo ' + (i + 1), src: photos[i], x: r.x, y: r.y, w: r.w, h: r.h, radius: rad, label: 'Photo ' + (i + 1), slot: 'photo' + (i + 1) }, extra || {}));
    }
    function cellsToRects(cells, box, g) {
      var e = 1e-3;
      return cells.map(function (c) {
        var x0 = box.x + c[0] * box.w + (c[0] > e ? g / 2 : 0), y0 = box.y + c[1] * box.h + (c[1] > e ? g / 2 : 0);
        var x1 = box.x + (c[0] + c[2]) * box.w - (c[0] + c[2] < 1 - e ? g / 2 : 0), y1 = box.y + (c[1] + c[3]) * box.h - (c[1] + c[3] < 1 - e ? g / 2 : 0);
        return { x: x0, y: y0, w: Math.max(8, x1 - x0), h: Math.max(8, y1 - y0) };
      });
    }
    /* Best collage layout for these photos: least total crop, the engine's own ranking breaking ties. */
    function collageCells(box, which) {
      var C2 = LE.collage;
      if (!C2 || !C2.layouts || n > (C2.MAX_CELLS || 20)) return null;
      var list = C2.layouts(n, box.w / box.h).filter(function (l) { return which.test(l.id); });
      if (!list.length) return null;
      var best = null;
      list.forEach(function (l, rank) {
        var cost = rank * 0.04;
        l.cells.forEach(function (c, i) { var car = (c[2] * box.w) / (c[3] * box.h); cost += Math.abs(Math.log(car / ar[i])); });
        cost /= n;
        if (!best || cost < best.cost) best = { cost: cost, cells: l.cells, id: l.id };
      });
      return best;
    }
    function rowsLayout(box, g) {
      var J = justified(ar, box.w, box.h, g);
      var scale = J.height > box.h ? box.h / J.height : 1;
      var wTot = box.w * scale, yy = box.y + (box.h - J.height * scale) / 2, out = [];
      J.rows.forEach(function (r) {
        var sum = r.reduce(function (q, k) { return q + ar[k]; }, 0);
        var rh = (wTot - g * (r.length - 1)) / sum, xx = box.x + (box.w - wTot) / 2;
        r.forEach(function (k) { out[k] = { x: xx, y: yy, w: ar[k] * rh, h: rh }; xx += ar[k] * rh + g; });
        yy += rh + g;
      });
      return out;
    }
    var rects;
    if (style === 'clean' || style === 'bold') {
      var pick = collageCells(area, style === 'bold' ? /^(h|m)-/ : /^[rc]-/) || collageCells(area, /./);
      rects = pick ? cellsToRects(pick.cells, area, gap) : rowsLayout(area, gap);
      rects.forEach(function (r, i) { L.push(slot(i, r)); });
    } else if (style === 'rows') {
      rects = rowsLayout(area, gap);
      rects.forEach(function (r, i) { L.push(slot(i, r)); });
    } else if (style === 'film') {
      /* Contact sheet: even 3:2 frames, numbered, edge to edge. */
      var cols = 1, best = 0;
      for (var cc = 1; cc <= 6; cc++) {
        var rr = Math.ceil(n / cc), fw = (area.w - (cc - 1) * gap) / cc, fh = fw / 1.5 + 2.6 * u;
        var sc = Math.min(1, area.h / (rr * fh + (rr - 1) * gap));
        var cover = fw * sc * fw / 1.5 * sc * n;
        if (cover > best) { best = cover; cols = cc; }
      }
      var rowsN = Math.ceil(n / cols), fW = (area.w - (cols - 1) * gap) / cols, lab = 2.6 * u;
      var k2 = Math.min(1, area.h / (rowsN * (fW / 1.5 + lab) + (rowsN - 1) * gap));
      fW *= k2;
      var fH = fW / 1.5, gw = cols * fW + (cols - 1) * gap, gh = rowsN * (fH + lab * k2) + (rowsN - 1) * gap;
      var x0 = area.x + (area.w - gw) / 2, y0 = area.y + (area.h - gh) / 2;
      for (var f = 0; f < n; f++) {
        var col = f % cols, row = Math.floor(f / cols);
        var rx = x0 + col * (fW + gap), ry = y0 + row * (fH + lab * k2 + gap);
        L.push(slot(f, { x: rx, y: ry, w: fW, h: fH }));
        L.push(env.text({ id: 'frame-number', name: 'Frame number ' + (f + 1), text: (f + 1) + 'A', x: rx, y: ry + fH + 0.35 * u * k2, w: fW, font: 'Space Mono', weight: 700, size: Math.max(1.4 * u * k2, 12), min: 10, maxLines: 1, align: 'left', color: C.ensure('#E9A35B', T.bg, 4.6) }));
      }
    } else {
      /* Prints: white-bordered cards on the grid the engine likes best, each turned a little. */
      var pk = collageCells(area, /^[rc]-/);
      var cells = pk ? cellsToRects(pk.cells, area, gap) : rowsLayout(area, 2 * u);
      cells.forEach(function (r, i) {
        var bw = Math.max(6, Math.min(r.w, r.h) * 0.06), bb = bw * 2.6;
        var cw = r.w * 0.92, ch = r.h * 0.92;
        var inner = { w: cw - 2 * bw, h: ch - bw - bb };
        if (inner.w < 10 || inner.h < 10) inner = { w: cw, h: ch };
        var cx = r.x + (r.w - cw) / 2, cy = r.y + (r.h - ch) / 2;
        var rot = Math.round(((env.random() - 0.5) * (n > 12 ? 5 : 8)) * 10) / 10;
        L.push(env.rect({ id: 'print', name: 'Print ' + (i + 1), x: cx, y: cy, w: cw, h: ch, fill: '#FFFFFF', rotation: rot, shadow: { color: 'rgba(40,30,20,0.22)', blur: Math.max(4, bw * 1.4), x: 0, y: Math.max(2, bw * 0.4) } }));
        /* The photo turns about the card's centre, so it is placed where the card's turn would put it. */
        var px = cx + bw, py = cy + bw, pcx = px + inner.w / 2, pcy = py + inner.h / 2, ccx = cx + cw / 2, ccy = cy + ch / 2;
        var a = rot * Math.PI / 180, dx = pcx - ccx, dy2 = pcy - ccy;
        var nx = ccx + dx * Math.cos(a) - dy2 * Math.sin(a), ny = ccy + dx * Math.sin(a) + dy2 * Math.cos(a);
        L.push(slot(i, { x: nx - inner.w / 2, y: ny - inner.h / 2, w: inner.w, h: inner.h }, { rotation: rot }));
      });
    }
    page.layers = L.concat(words);
    return { name: 'Recap — ' + title, pages: [page] };
  }

  /* ---------- In the studio form: order by capture date and suggest the date range ---------- */
  function ui(F, api) {
    var c = F.c;
    if (!c || !F.node || !LE.exif) return null;
    var dates = {}, last = '', alive = true, busy = false;
    function dateOf(id) {
      if (Object.prototype.hasOwnProperty.call(dates, id)) return Promise.resolve(dates[id]);
      if (/^sample:/.test(id) || !LE.project || !LE.project.assetRecord) { dates[id] = ''; return Promise.resolve(''); }
      return LE.project.assetRecord(id).then(function (rec) { return rec && rec.blob ? LE.exif(rec.blob) : null; }).then(function (info) {
        var m = info && info.date && /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(info.date);
        dates[id] = m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + (m[4] || '12') + ':' + (m[5] || '00') + ':' + (m[6] || '00') : '';
        return dates[id];
      }).catch(function () { dates[id] = ''; return ''; });
    }
    function check() {
      if (!alive || busy) return;
      var list = (F.values.photos || []).slice();
      var key = list.join(',') + '|' + (F.values.order || 'taken');
      if (key === last || !list.length) { last = key; return; }
      last = key;
      busy = true;
      Promise.all(list.map(dateOf)).then(function (ds) {
        busy = false;
        if (!alive) return;
        var known = ds.filter(Boolean).sort();
        var changed = false;
        if ((F.values.order || 'taken') === 'taken' && known.length) {
          /* Stable sort: photos without a date keep their place relative to each other, after the dated ones. */
          var idx = list.map(function (id, i) { return { id: id, d: ds[i], i: i }; });
          idx.sort(function (a, b) { if (a.d && b.d) return a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i; if (a.d) return -1; if (b.d) return 1; return a.i - b.i; });
          var sorted = idx.map(function (x) { return x.id; });
          if (sorted.join(',') !== list.join(',')) { F.values.photos = sorted; changed = true; }
        }
        if (known.length && !F.values.from && !F.values.to) {
          F.values.from = known[0].slice(0, 10);
          F.values.to = known[known.length - 1].slice(0, 10);
          changed = true;
        }
        last = (F.values.photos || []).join(',') + '|' + (F.values.order || 'taken');
        if (changed) api.refresh();
      });
    }
    /* The photos field redraws itself when photos are added, removed or reordered; watch for that. */
    var mo = new MutationObserver(function () { check(); });
    mo.observe(F.form, { childList: true, subtree: true });
    function soon() { setTimeout(check, 0); }
    F.form.addEventListener('click', soon);
    F.form.addEventListener('change', soon);
    check();
    return function () { alive = false; mo.disconnect(); F.form.removeEventListener('click', soon); F.form.removeEventListener('change', soon); };
  }
})();
