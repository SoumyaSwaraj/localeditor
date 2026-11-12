/* Quick maker: receipt-style list (V4), plus ticket and ledger variants. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  /* Paper with torn (zig-zag) top and bottom edges, as one stretchable graphic. */
  function tornPaper(w, h, color, tooth) {
    var t = tooth, n = Math.max(6, Math.round(w / (t * 2))), step = w / n, d = 'M0 ' + t;
    for (var i = 0; i < n; i++) d += 'L' + (i * step + step / 2).toFixed(1) + ' 0L' + ((i + 1) * step).toFixed(1) + ' ' + t;
    d += 'L' + w + ' ' + (h - t);
    for (var j = n; j > 0; j--) d += 'L' + (j * step - step / 2).toFixed(1) + ' ' + h + 'L' + ((j - 1) * step).toFixed(1) + ' ' + (h - t);
    d += 'Z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '" fill="' + color + '"/></svg>';
  }
  /* Decorative bars drawn from rectangles (not a scannable code). */
  function bars(env, w, h, color, key) {
    var x = 0, out = '', i = 0, s = 0;
    for (var c = 0; c < key.length; c++) s = (s * 31 + key.charCodeAt(c)) >>> 0;
    while (x < w) {
      s = (s * 1103515245 + 12345) >>> 0;
      var bw = 2 + (s >>> 16) % 4 * 2;
      if (i % 2 === 0 && x + bw <= w) out += '<rect x="' + x + '" y="0" width="' + bw + '" height="' + h + '" fill="' + color + '"/>';
      x += bw + (i % 2 ? 0 : 3);
      i++;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + out + '</svg>';
  }

  LE.makers.register({
    id: 'receipt',
    name: 'Receipt list',
    category: 'Social',
    summary: 'A year, a trip or a week as a receipt, a ticket or a ledger.',
    keywords: ['receipt', 'list', 'year in review', 'recap', 'ticket', 'ledger', 'trip', 'wrapped', 'stats'],
    inputs: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 32, placeholder: 'My 2026' },
      { key: 'subtitle', label: 'Subtitle', type: 'text', max: 48, placeholder: 'A year, itemised' },
      { key: 'items', label: 'Lines', type: 'list', columns: ['Item', 'Value'], max: 15, cellMax: 36, placeholder: 'Coffees' },
      { key: 'totalLabel', label: 'Total label', type: 'text', max: 20, placeholder: 'Total' },
      { key: 'total', label: 'Total', type: 'text', max: 24, placeholder: '1 great year' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'footer', label: 'Footer', type: 'text', max: 80, placeholder: 'Thank you, come again' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'receipt', name: 'Receipt' },
      { id: 'bright', name: 'Receipt, bright' },
      { id: 'ticket', name: 'Ticket' },
      { id: 'ledger', name: 'Ledger' }
    ],
    sample: { values: {
      title: 'My 2026', subtitle: 'A year, itemised',
      items: [['Cities visited', '7'], ['Books finished', '23'], ['Coffees', '412'], ['Sunrises seen', '9'], ['New friends', '5'], ['Times I said yes', 'plenty']],
      totalLabel: 'Total', total: '1 good year', date: '2026-12-31', footer: 'Thank you, come again'
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color;
      var top = env.tall ? 210 : 72, bottom = env.tall ? 260 : 72;
      var items = v.items || [['Item', '1']];
      var style = env.style;
      var dateTxt = v.date ? env.date.format(v.date, style === 'ledger' ? 'D MMMM YYYY' : 'DD/MM/YYYY') : '';
      var totalLabel = v.totalLabel || 'Total';
      var page, L = [];

      /* Rows of item (left, up to 2 lines) and value (right), all at one size. */
      function rows(y, x, w, u, o) {
        var out = [];
        var size = u * (o.scale || 1);
        var valW = 0;
        items.forEach(function (r) {
          if (!r[1]) return;
          var f = env.fit({ text: r[1], font: o.valueFont || o.font, weight: o.valueWeight || o.weight, size: size, min: size, w: 100000 });
          valW = Math.max(valW, f.textWidth);
        });
        valW = Math.min(Math.ceil(valW) + 2, w * 0.45);
        var gap = size * 1.2;
        items.forEach(function (r, i) {
          var it = env.text({ id: 'item-' + (i + 1), name: 'Line ' + (i + 1), text: r[0] || ' ', x: x, y: y, w: Math.max(40, w - valW - gap), font: o.font, weight: o.weight, size: size, min: size, lineHeight: o.lh || 1.3, uppercase: o.upper, color: o.ink });
          out.push(it);
          if (r[1]) out.push(env.text({ id: 'value-' + (i + 1), name: 'Value ' + (i + 1), text: r[1], x: x + w - valW, y: y, w: valW, font: o.valueFont || o.font, weight: o.valueWeight || o.weight, size: size, min: size * 0.6, lineHeight: o.lh || 1.3, align: 'right', maxLines: 1, uppercase: o.upper, color: o.valueInk || o.ink }));
          if (o.rule) out.push(o.rule(it.y + it.h + size * 0.12, i));
          y = it.y + it.h + size * (o.rowGap == null ? 0.35 : o.rowGap);
        });
        return { layers: out, y: y };
      }
      function compose(fn, maxH) {
        var u = fn.base, res = null;
        for (var i = 0; i < 8; i++) {
          res = fn(u);
          if (res.h <= maxH) break;
          u = u * Math.max(0.6, Math.min(0.97, maxH / res.h));
        }
        return res;
      }

      if (style === 'receipt' || style === 'bright') {
        var bright = style === 'bright';
        var bg = bright ? (v.accent || '#FF6B4A') : (v.accent ? C.shade(v.accent, 0.72) : '#26252C');
        page = env.page(bright ? { type: 'gradient', kind: 'linear', angle: 135, colors: [C.tint(bg, 0.1), C.shade(bg, 0.12)] } : bg);
        var paperC = bright ? '#FFFFFF' : '#FBFAF5', ink = '#24222A';
        var font = bright ? 'IBM Plex Mono' : 'Space Mono';
        var pw = Math.round(W * (env.tall ? 0.78 : env.square ? 0.62 : 0.7));
        var px = Math.round((W - pw) / 2), pad = Math.round(pw * 0.09), tooth = 14;
        var maxH = H - top - bottom;
        var build = function (u) {
          var out = [], x = px + pad, w = pw - 2 * pad, y = tooth + u * 1.6;
          function sep() { out.push(env.line({ id: 'rule', name: 'Dashed rule', x: x, y: y, w: w, width: 2, dash: [u * 0.45, u * 0.35], color: '#6E6A76' })); y += u * 1.1; }
          var t = env.text({ id: 'title', name: 'Title', text: v.title, x: x, y: y, w: w, font: font, weight: 700, size: u * 2.2, min: u * 1.1, maxLines: 2, uppercase: true, align: 'center', tracking: 0.04, color: bright ? C.ensure(bg, paperC, 4.5) : ink, balance: true });
          out.push(t); y = t.y + t.h + u * 0.4;
          if (v.subtitle) { var s = env.text({ id: 'subtitle', name: 'Subtitle', text: v.subtitle, x: x, y: y, w: w, font: font, weight: 400, size: u * 0.95, min: u * 0.7, maxLines: 2, align: 'center', color: '#4A4652' }); out.push(s); y = s.y + s.h + u * 0.3; }
          if (dateTxt) { var d = env.text({ id: 'date', name: 'Date', text: dateTxt + '   No. ' + ('000' + (env.seed % 9000 + 1000)).slice(-4), x: x, y: y, w: w, font: font, weight: 400, size: u * 0.85, min: u * 0.6, maxLines: 1, align: 'center', color: '#4A4652' }); out.push(d); y = d.y + d.h; }
          y += u * 0.9; sep();
          var r = rows(y, x, w, u, { font: font, weight: 400, ink: ink, lh: 1.3 });
          out = out.concat(r.layers); y = r.y + u * 0.5; sep();
          var tl = env.text({ id: 'total-label', name: 'Total label', text: totalLabel, x: x, y: y, w: w * 0.45, font: font, weight: 700, size: u * 1.25, min: u * 0.8, maxLines: 1, uppercase: true, color: ink });
          out.push(tl);
          if (v.total) out.push(env.text({ id: 'total', name: 'Total', text: v.total, x: x + w * 0.45, y: y, w: w * 0.55, font: font, weight: 700, size: u * 1.25, min: u * 0.7, maxLines: 2, align: 'right', color: ink }));
          y = Math.max.apply(null, out.slice(-2).map(function (l) { return l.y + l.h; })) + u * 0.6; sep();
          if (v.footer) { var f = env.text({ id: 'footer', name: 'Footer', text: v.footer, x: x, y: y, w: w, font: font, weight: 400, size: u * 0.9, min: u * 0.65, maxLines: 3, align: 'center', uppercase: true, tracking: 0.04, color: ink, balance: true }); out.push(f); y = f.y + f.h + u * 0.9; }
          out.push(env.svg({ id: 'barcode', name: 'Barcode decoration', markup: bars(env, Math.round(w * 0.8), Math.round(u * 2.6), ink, v.title), x: x + w * 0.1, y: y, w: Math.round(w * 0.8), h: Math.round(u * 2.6) }));
          y += u * 2.6 + u * 1.6 + tooth;
          return { layers: out, h: y };
        };
        build.base = Math.round(pw / (env.tall ? 21 : 24));
        var res = compose(build, maxH);
        var py = Math.round(top + (maxH - res.h) / 2);
        L.push(env.svg({ id: 'paper', name: 'Receipt paper', markup: tornPaper(pw, Math.round(res.h), paperC, tooth), color: null, x: px, y: py, w: pw, h: Math.round(res.h), shadow: { color: 'rgba(0,0,0,.28)', blur: 40, x: 0, y: 16 } }));
        res.layers.forEach(function (l) { l.y += py; });
        L = L.concat(res.layers);
      } else if (style === 'ticket') {
        var navy = v.accent ? C.shade(v.accent, 0.55) : '#1F2A44';
        page = env.page(navy);
        var card = '#F5E6C8', tink = '#1F2A44', tacc = C.ensure(v.accent || '#C8432B', card, 4.5);
        var tw = W - 2 * (env.tall ? 90 : 80), tx = (W - tw) / 2, tpad = 64;
        var tb = function (u) {
          var out = [], x = tx + tpad, w = tw - 2 * tpad, y = tpad;
          out.push(env.text({ id: 'admit', name: 'Kicker', text: v.subtitle || 'Admit one', x: x, y: y, w: w, font: 'Space Grotesk', weight: 700, size: u * 0.9, min: u * 0.6, maxLines: 2, uppercase: true, tracking: 0.2, color: tacc }));
          y = out[0].y + out[0].h + u * 0.3;
          var t = env.text({ id: 'title', name: 'Title', text: v.title, x: x, y: y, w: w, font: 'Bebas Neue', weight: 400, size: u * 4.4, min: u * 2, maxLines: 2, lineHeight: 0.95, color: tink });
          out.push(t); y = t.y + t.h + u * 0.9;
          out.push(env.line({ id: 'rule', name: 'Rule', x: x, y: y, w: w, width: 3, color: tink })); y += u * 1.1;
          var r = rows(y, x, w, u, { font: 'Space Grotesk', weight: 400, valueWeight: 700, ink: tink, lh: 1.25, rowGap: 0.45 });
          out = out.concat(r.layers); y = r.y + u * 0.6;
          out.push(env.line({ id: 'rule', name: 'Rule', x: x, y: y, w: w, width: 3, color: tink })); y += u * 0.9;
          var tl = env.text({ id: 'total-label', name: 'Total label', text: totalLabel, x: x, y: y, w: w * 0.45, font: 'Bebas Neue', weight: 400, size: u * 1.9, min: u, maxLines: 1, color: tink });
          out.push(tl);
          if (v.total) out.push(env.text({ id: 'total', name: 'Total', text: v.total, x: x + w * 0.4, y: y, w: w * 0.6, font: 'Bebas Neue', weight: 400, size: u * 1.9, min: u, maxLines: 2, align: 'right', color: tacc }));
          y = Math.max.apply(null, out.slice(-2).map(function (l) { return l.y + l.h; })) + tpad * 0.8;
          var stubY = y;
          y += tpad * 0.8;
          var sl = [];
          if (dateTxt) sl.push(env.text({ id: 'date', name: 'Date', text: dateTxt, x: x, y: y, w: w * 0.5, font: 'Space Grotesk', weight: 700, size: u * 0.95, min: u * 0.7, maxLines: 1, tracking: 0.08, color: tink }));
          if (v.footer) sl.push(env.text({ id: 'footer', name: 'Footer', text: v.footer, x: x, y: y + (dateTxt ? u * 1.5 : 0), w: w * 0.56, font: 'Space Grotesk', weight: 400, size: u * 0.8, min: u * 0.6, maxLines: 3, color: '#3B4560' }));
          var bw = Math.round(w * 0.38), bh = Math.round(u * 2.4);
          sl.push(env.svg({ id: 'barcode', name: 'Barcode decoration', markup: bars(env, bw, bh, tink, v.title + 't'), x: x + w - bw, y: y, w: bw, h: bh }));
          out = out.concat(sl);
          y = Math.max.apply(null, sl.map(function (l) { return l.y + l.h; })) + tpad;
          return { layers: out, h: y, stubY: stubY };
        };
        tb.base = Math.round(tw / 26);
        var tr = compose(tb, H - top - bottom);
        var ty = Math.round(top + (H - top - bottom - tr.h) / 2);
        L.push(env.rect({ id: 'ticket', name: 'Ticket card', x: tx, y: ty, w: tw, h: Math.round(tr.h), radius: 28, fill: card, shadow: { color: 'rgba(0,0,0,.3)', blur: 40, x: 0, y: 16 } }));
        var notch = 56, sy = ty + tr.stubY;
        L.push(env.ellipse({ id: 'notch-left', name: 'Notch', x: tx - notch / 2, y: sy - notch / 2, w: notch, h: notch, fill: navy }));
        L.push(env.ellipse({ id: 'notch-right', name: 'Notch', x: tx + tw - notch / 2, y: sy - notch / 2, w: notch, h: notch, fill: navy }));
        L.push(env.line({ id: 'perforation', name: 'Perforation', x: tx + notch / 2 + 12, y: sy - 1.5, w: tw - notch - 24, width: 3, dash: [10, 10], color: '#B9A47E' }));
        tr.layers.forEach(function (l) { l.y += ty; });
        L = L.concat(tr.layers);
      } else {
        /* Ledger: ruled paper, a red margin, handwritten entries. */
        var paper = '#F7F2E5', blue = '#1E2B5C', red = '#B3303A', rule = '#B8C7DE';
        page = env.page(paper);
        var mx = env.tall ? 110 : 96, lx = mx + 70;
        L.push(env.rect({ id: 'margin', name: 'Margin line', x: lx - 36, y: 0, w: 3, h: H, fill: red }));
        var lb = function (u) {
          var out = [], x = lx, w = W - lx - mx, y = 0;
          var t = env.text({ id: 'title', name: 'Title', text: v.title, x: x, y: y, w: w, font: 'Libre Baskerville', weight: 700, size: u * 2.3, min: u * 1.2, maxLines: 2, lineHeight: 1.12, color: blue });
          out.push(t); y = t.y + t.h + u * 0.3;
          var meta = [v.subtitle, dateTxt].filter(Boolean).join(' · ');
          if (meta) { var mt = env.text({ id: 'subtitle', name: 'Subtitle', text: meta, x: x, y: y, w: w, font: 'Libre Baskerville', italic: true, weight: 400, size: u * 0.85, min: u * 0.6, maxLines: 2, color: '#4B5878' }); out.push(mt); y = mt.y + mt.h; }
          y += u * 1.1;
          out.push(env.line({ id: 'rule', name: 'Double rule', x: lx - 34, y: y, w: W - lx + 34, width: 2, color: blue })); y += u * 0.9;
          var r = rows(y, x, w, u, { font: 'Kalam', weight: 400, ink: blue, lh: 1.25, rowGap: 0.3,
            rule: function (ry, i) { return env.line({ id: 'rule', name: 'Ruled line', x: 0, y: ry, w: W, width: 2, color: rule }); } });
          out = out.concat(r.layers); y = r.y + u * 0.5;
          var tl = env.text({ id: 'total-label', name: 'Total label', text: totalLabel, x: x, y: y, w: w * 0.45, font: 'Libre Baskerville', weight: 700, size: u * 1.1, min: u * 0.7, maxLines: 1, uppercase: true, tracking: 0.08, color: blue });
          out.push(tl);
          var tv = v.total ? env.text({ id: 'total', name: 'Total', text: v.total, x: x + w * 0.4, y: y - u * 0.15, w: w * 0.6, font: 'Kalam', weight: 700, size: u * 1.4, min: u * 0.8, maxLines: 2, align: 'right', color: red }) : null;
          if (tv) {
            out.push(tv);
            var uy = tv.y + tv.h + 4;
            out.push(env.line({ id: 'underline', name: 'Underline', x: tv.x, y: uy, w: tv.w, width: 3, color: red }));
            out.push(env.line({ id: 'underline', name: 'Underline', x: tv.x, y: uy + 9, w: tv.w, width: 3, color: red }));
            y = uy + 9;
          } else y = tl.y + tl.h;
          if (v.footer) { y += u * 1.4; var f = env.text({ id: 'footer', name: 'Footer', text: v.footer, x: x, y: y, w: w, font: 'Kalam', weight: 400, size: u, min: u * 0.7, maxLines: 3, color: '#4B5878' }); out.push(f); y = f.y + f.h; }
          return { layers: out, h: y };
        };
        lb.base = Math.round((W - lx - mx) / 19);
        var lr = compose(lb, H - top - bottom);
        var ly = Math.round(top + (H - top - bottom - lr.h) / 2);
        lr.layers.forEach(function (l) { l.y += ly; });
        L = L.concat(lr.layers);
      }
      page.layers = L;
      return { name: 'Receipt — ' + v.title, pages: [page] };
    }
  });
})();
