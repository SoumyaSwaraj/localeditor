/* Quick maker: palette poster (V1). Colours are taken from the photo on the device with LE.palette. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var FALLBACK = ['#2E2A26', '#5E4B3C', '#8A6F55', '#B79C7C', '#D9C6A8', '#EFE6D6', '#7E8C78'];

  LE.makers.register({
    id: 'palette',
    name: 'Palette poster',
    category: 'Photo',
    summary: 'The colours of a photo, as a poster with hex codes.',
    keywords: ['palette', 'colours', 'colors', 'hex', 'swatches', 'trip', 'mood', 'aesthetic', 'colour palette'],
    inputs: [
      { key: 'photo', label: 'Photo', type: 'photo', required: true },
      { key: 'title', label: 'Title', type: 'text', max: 40, placeholder: 'Lisbon, 2026' },
      { key: 'subtitle', label: 'Subtitle', type: 'text', max: 60, placeholder: 'Colours of the trip' },
      { key: 'count', label: 'Colours', type: 'choice', default: '6', options: [{ id: '5', name: '5' }, { id: '6', name: '6' }, { id: '7', name: '7' }] },
      { key: 'names', label: 'Colour names', type: 'toggle', default: true }
    ],
    styles: [
      { id: 'bars', name: 'Bars' },
      { id: 'grid', name: 'Grid' },
      { id: 'circles', name: 'Circles' },
      { id: 'chips', name: 'Paint chips' },
      { id: 'stripes', name: 'Stripes' }
    ],
    sample: { values: { photo: 'sample:travel-07', title: 'Low tide', subtitle: 'Colours of an evening walk', count: '6', names: true } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color;
      var n = Number(v.count) || 6;
      var cols = (v.photo && env.palette(v.photo, n)) || FALLBACK.slice(0, n);
      if (cols.length < n) cols = cols.concat(FALLBACK.slice(cols.length, n));
      var names = v.names !== false;
      var top = env.tall ? 200 : 80, bottom = env.tall ? 260 : 80, M = 80;
      var L = [], page;
      var light = cols[cols.length - 1], dark = cols[0];
      function label(i, x, y, w, ink, size, align) {
        var out = [env.text({ id: 'hex-' + (i + 1), name: 'Hex ' + (i + 1), text: cols[i], x: x, y: y, w: w, font: 'JetBrains Mono', weight: 700, size: size, min: size * 0.6, maxLines: 1, align: align || 'left', color: ink })];
        if (names) out.push(env.text({ id: 'name-' + (i + 1), name: 'Colour name ' + (i + 1), text: env.colorName(cols[i]), x: x, y: out[0].y + out[0].h + 2, w: w, font: 'Inter', weight: 400, size: size * 0.9, min: size * 0.55, maxLines: 1, align: align || 'left', color: ink }));
        return out;
      }
      function titles(x, y, w, ink, align, size) {
        var out = [];
        if (v.title) out.push(env.text({ id: 'title', name: 'Title', text: v.title, x: x, y: y, w: w, font: 'Fraunces', weight: 700, size: size, min: size * 0.5, maxLines: 2, lineHeight: 1.05, align: align, color: ink, balance: true }));
        if (v.subtitle) out.push(env.text({ id: 'subtitle', name: 'Subtitle', text: v.subtitle, x: x, y: out.length ? out[0].y + out[0].h + 10 : y, w: w, font: 'Inter', weight: 400, size: size * 0.42, min: 20, maxLines: 2, align: align, color: ink }));
        return out;
      }
      function tH(list) { return list.length ? Math.max.apply(null, list.map(function (l) { return l.y + l.h; })) - list[0].y : 0; }

      if (env.style === 'bars') {
        var paper = '#FAF8F4', ink = '#1A1720';
        page = env.page(paper);
        var t = titles(M, top, W - 2 * M, ink, 'left', 72);
        var th = t.length ? tH(t) + 40 : 0;
        var barH = Math.round((H - top - bottom - th) * (env.tall ? 0.36 : 0.34));
        var phH = H - top - bottom - th - barH - 24;
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: M, y: top + th, w: W - 2 * M, h: phH, label: 'Add a photo' }));
        var bars = env.split({ x: M, y: top + th + phH + 24, w: W - 2 * M, h: barH }, cols.map(function () { return 1; }), 0);
        L = L.concat(t);
        bars.forEach(function (b, i) {
          L.push(env.rect({ id: 'swatch-' + (i + 1), name: 'Swatch ' + (i + 1), x: b.x, y: b.y, w: b.w, h: b.h, fill: cols[i] }));
          var lab = label(i, b.x + 12, 0, b.w - 24, C.readable(cols[i]), Math.min(24, b.w / 7.2));
          env.place(lab, { x: 0, y: b.y + 14, w: 1, h: b.h - 28 }, 'bottom');
          L = L.concat(lab);
        });
      } else if (env.style === 'grid') {
        var bgc = '#FFFFFF', ink2 = '#16131C';
        page = env.page(bgc);
        var ph2 = Math.round(H * (env.tall ? 0.42 : env.square ? 0.46 : 0.46));
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: ph2, label: 'Add a photo' }));
        var ga = { x: M, y: ph2 + 48, w: W - 2 * M, h: H - ph2 - 48 - bottom };
        var t2 = titles(ga.x, ga.y, ga.w, ink2, 'left', 56);
        var th2 = t2.length ? tH(t2) + 32 : 0;
        L = L.concat(t2);
        var gc = env.tall ? 2 : (n > 6 ? 4 : 3);
        var cells = env.grid({ x: ga.x, y: ga.y + th2, w: ga.w, h: ga.h - th2 }, n, gc, 16);
        cells.forEach(function (c, i) {
          var sw = Math.min(c.h * 0.62, c.w);
          L.push(env.rect({ id: 'swatch-' + (i + 1), name: 'Swatch ' + (i + 1), x: c.x, y: c.y, w: c.w, h: c.h - (names ? 62 : 36), radius: 14, fill: cols[i] }));
          L = L.concat(label(i, c.x, c.y + c.h - (names ? 56 : 30), c.w, ink2, Math.min(22, c.w / 8)));
        });
      } else if (env.style === 'circles') {
        var bg3 = C.mix(dark, '#111111', 0.55), ink3 = C.readable(bg3, ['#FAF6EE']);
        page = env.page(bg3);
        var cw = W - 2 * M;
        var ph3 = Math.round(Math.min(cw * (env.square ? 0.62 : 1.0), (H - top - bottom) * 0.55));
        var pw3 = env.square ? Math.round(ph3 * 1.25) : cw;
        var photo3 = env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: (W - pw3) / 2, y: 0, w: pw3, h: ph3, radius: 24, label: 'Add a photo' });
        var d = Math.min(150, Math.floor((cw + 18 * (n - 1)) / n));
        var rowW = d * n - 18 * (n - 1);
        var circ = [], labs = [];
        cols.forEach(function (c, i) {
          var x = (W - rowW) / 2 + i * (d - 18);
          circ.push(env.ellipse({ id: 'swatch-' + (i + 1), name: 'Swatch ' + (i + 1), x: x, y: ph3 + 56, w: d, h: d, fill: c, stroke: { width: 6, color: bg3 } }));
        });
        var lw = cw / n;
        cols.forEach(function (c, i) { labs = labs.concat(label(i, M + i * lw, ph3 + 56 + d + 24, lw - 6, ink3, Math.min(20, lw / 6.6), 'center')); });
        var t3 = titles(M, 0, cw, ink3, 'center', 64);
        var blk = [photo3].concat(circ, labs);
        if (t3.length) { var by = Math.max.apply(null, labs.map(function (l) { return l.y + l.h; })) + 56; t3.forEach(function (l) { l.y += by; }); }
        blk = blk.concat(t3);
        env.place(blk, { x: 0, y: top, w: W, h: H - top - bottom }, 'middle');
        L = L.concat(blk);
      } else if (env.style === 'chips') {
        var wall = '#EDEAE4', ink4 = '#1E1B22';
        page = env.page(wall);
        var t4 = titles(M, top, W - 2 * M, ink4, 'center', 64);
        var th4 = t4.length ? tH(t4) + 40 : 0;
        L = L.concat(t4);
        var phH4 = Math.round((H - top - bottom - th4) * (env.tall ? 0.42 : 0.44));
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: M, y: top + th4, w: W - 2 * M, h: phH4, radius: 8, label: 'Add a photo' }));
        var area4 = { x: M, y: top + th4 + phH4 + 32, w: W - 2 * M, h: H - bottom - (top + th4 + phH4 + 32) };
        var perRow = env.tall ? 3 : n > 6 ? 4 : n;
        if (!env.tall && n > 5 && env.square) perRow = Math.ceil(n / 2);
        var chips = env.grid(area4, n, perRow, 18);
        chips.forEach(function (c, i) {
          L.push(env.rect({ id: 'chip-' + (i + 1), name: 'Chip ' + (i + 1), x: c.x, y: c.y, w: c.w, h: c.h, radius: 6, fill: '#FFFFFF', shadow: { color: 'rgba(0,0,0,.10)', blur: 16, x: 0, y: 6 } }));
          var lh = names ? Math.min(78, c.h * 0.36) : Math.min(46, c.h * 0.26);
          L.push(env.rect({ id: 'swatch-' + (i + 1), name: 'Swatch ' + (i + 1), x: c.x + 10, y: c.y + 10, w: c.w - 20, h: c.h - 20 - lh, radius: 3, fill: cols[i] }));
          var lb = label(i, c.x + 14, 0, c.w - 28, ink4, Math.min(20, (c.w - 28) / 7.4));
          env.place(lb, { x: 0, y: c.y + c.h - lh - 4, w: 1, h: lh - 4 }, 'middle');
          L = L.concat(lb);
        });
      } else {
        var cream = '#F6F1E8', ink5 = '#1A1720';
        page = env.page(cream);
        var split = env.tall ? null : 0.58;
        if (split) {
          var pw5 = Math.round(W * split);
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: pw5, h: H, label: 'Add a photo' }));
          var t5 = titles(pw5 + 48, top, W - pw5 - 48 - 56, ink5, 'left', 48);
          var th5 = t5.length ? tH(t5) + 36 : 0;
          L = L.concat(t5);
          var st = env.split({ x: pw5, y: top + th5, w: W - pw5, h: H - top - bottom - th5 }, cols.map(function () { return 1; }), 0, true);
          st.forEach(function (b, i) {
            L.push(env.rect({ id: 'swatch-' + (i + 1), name: 'Swatch ' + (i + 1), x: b.x, y: b.y, w: b.w, h: b.h, fill: cols[i] }));
            var lb5 = label(i, b.x + 28, 0, b.w - 56, C.readable(cols[i]), Math.min(22, b.h / 3.2));
            env.place(lb5, { x: 0, y: b.y, w: 1, h: b.h }, 'middle');
            L = L.concat(lb5);
          });
        } else {
          var phH5 = Math.round(H * 0.5);
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: phH5, label: 'Add a photo' }));
          var t6 = titles(M, phH5 + 48, W - 2 * M, ink5, 'left', 60);
          var th6 = t6.length ? tH(t6) + 40 : 0;
          L = L.concat(t6);
          var st2 = env.split({ x: 0, y: phH5 + 48 + th6, w: W, h: H - bottom - (phH5 + 48 + th6) + 40 }, cols.map(function () { return 1; }), 0, true);
          st2.forEach(function (b, i) {
            L.push(env.rect({ id: 'swatch-' + (i + 1), name: 'Swatch ' + (i + 1), x: b.x, y: b.y, w: b.w, h: b.h, fill: cols[i] }));
            var lb6 = label(i, M, 0, W - 2 * M, C.readable(cols[i]), Math.min(24, b.h / 3.4));
            env.place(lb6, { x: 0, y: b.y, w: 1, h: b.h }, 'middle');
            L = L.concat(lb6);
          });
        }
      }
      page.layers = L;
      return { name: 'Palette' + (v.title ? ' — ' + v.title : ''), pages: [page] };
    }
  });
})();
