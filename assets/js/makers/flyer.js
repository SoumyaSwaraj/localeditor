/* Quick maker: flyers. A headline, a line under it, up to three points, when and where, a call to action, a photo and
   an optional QR code. A5, A4 and US Letter for print, and a 4:5 size for social. A flyer is one design, not a run. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    clean: { bg: '#FFFFFF', ink: '#15171C', muted: '#555B66', accent: '#2450D8', head: 'Plus Jakarta Sans', headW: 800, body: 'Inter', photo: 'top' },
    bold: { bg: '#D8402B', ink: '#FFFFFF', muted: '#FFE7E0', accent: '#16131C', head: 'Anton', headW: 400, caps: 1, headK: 1.3, body: 'Work Sans', photo: 'mid' },
    poster: { bg: '#15171D', ink: '#FFFFFF', muted: '#D4D0C8', accent: '#F2C46D', head: 'Bebas Neue', headW: 400, caps: 1, headK: 1.45, body: 'Inter', photo: 'full' },
    editorial: { bg: '#F6F1E8', ink: '#22201C', muted: '#5F5A52', accent: '#9B2C2C', head: 'Playfair Display', headW: 800, body: 'Lora', photo: 'mid', centre: 1 },
    minimal: { bg: '#FFFFFF', ink: '#111111', muted: '#555555', accent: '#111111', head: 'Inter Tight', headW: 800, headK: 1.1, body: 'Inter', photo: 'none' },
    bright: { bg: '#FFD23F', ink: '#1F1A2E', muted: '#3D3650', accent: '#1F1A2E', head: 'Fredoka', headW: 700, body: 'Nunito', photo: 'circle' }
  };

  function go(K) {
    M.register({
      id: 'flyer',
      name: 'Flyer',
      category: 'Business',
      summary: 'A flyer with a headline, three points, when and where, and a QR code, for print or social.',
      keywords: ['flyer', 'leaflet', 'poster', 'handout', 'event flyer', 'sale', 'open day', 'class', 'notice', 'a5', 'print'],
      sizes: [K.paper('a5', 'A5'), K.paper('a4', 'A4'), K.paper('letter', 'Letter'), { id: 'portrait', name: 'Social 4:5', w: 1080, h: 1350 }],
      inputs: [
        { key: 'headline', label: 'Headline', type: 'text', required: true, max: 50, placeholder: 'Summer pottery classes' },
        { key: 'subline', label: 'Line under it', type: 'text', max: 90, placeholder: 'Six relaxed evenings for complete beginners' },
        { key: 'points', label: 'Up to three points', type: 'list', max: 3, cellMax: 56, placeholder: 'All clay and tools included' },
        { key: 'when', label: 'When', type: 'text', max: 60, placeholder: 'Tuesdays from 3 June, 6.30 pm' },
        { key: 'where', label: 'Where', type: 'text', max: 60, placeholder: 'The Kiln Room, 5 Mill Lane' },
        { key: 'cta', label: 'Call to action', type: 'text', max: 32, placeholder: 'Book your place' },
        { key: 'contact', label: 'Contact line', type: 'text', max: 60, placeholder: 'hello@kilnroom.example · 020 7946 0155' },
        { key: 'link', label: 'Link for a QR code', type: 'text', max: 300, placeholder: 'https://…', hint: 'Leave empty for no code. Nothing is looked up.' },
        { key: 'photo', label: 'Photo', type: 'photo' },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'clean', name: 'Clean' }, { id: 'bold', name: 'Bold' }, { id: 'poster', name: 'Photo poster' }, { id: 'editorial', name: 'Editorial' }, { id: 'minimal', name: 'Minimal' }, { id: 'bright', name: 'Bright' }],
      sample: { values: { headline: 'Summer pottery classes', subline: 'Six relaxed evenings for complete beginners', points: ['All clay and tools included', 'Small groups of eight', 'Take home everything you make'],
        when: 'Tuesdays from 3 June, 6.30 pm', where: 'The Kiln Room, 5 Mill Lane', cta: 'Book your place', contact: 'hello@kilnroom.example · 020 7946 0155', link: 'https://kilnroom.example/classes', photo: 'sample:still-02' } },
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, style = env.style;
        var T = Object.assign({}, S[style] || S.clean);
        if (v.accent) { if (style === 'bold' || style === 'bright') T.bg = v.accent; else T.accent = v.accent; }
        var u = W / 100, m = 8 * u, bg = T.bg, L = [], page = env.page(bg), hk = T.headK || 1, al = T.centre ? 'center' : 'left';
        var mode = T.photo, box = { x: m, y: m, w: W - 2 * m, h: H - 2 * m }, panel = bg;
        if (style === 'minimal' && v.photo) mode = 'top';
        if (mode === 'top') {
          var ph = H * 0.36;
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: ph, label: 'Your photo' }));
          box = { x: m, y: ph + 6 * u, w: W - 2 * m, h: H - ph - 6 * u - m };
        } else if (mode === 'full') {
          var py = H * 0.42;
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: py + 2, label: 'Your photo' }));
          L.push(env.rect({ id: 'panel', name: 'Panel', x: 0, y: py, w: W, h: H - py, fill: bg }));
          L.push(env.rect({ id: 'panel-line', name: 'Accent line', x: 0, y: py, w: W, h: 1 * u, fill: T.accent }));
          box = { x: m, y: py + 6.5 * u, w: W - 2 * m, h: H - py - 6.5 * u - m };
        } else if (mode === 'circle') {
          var d = 40 * u;
          L.push(env.ellipse({ id: 'blob', name: 'Circle', x: W - d * 0.86 - 2 * u, y: -d * 0.16 - 2 * u, w: d + 4 * u, h: d + 4 * u, fill: C.mix(bg, '#FFFFFF', 0.55) }));
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: W - d * 0.86, y: -d * 0.16, w: d, h: d, mask: 'ellipse', label: 'Your photo' }));
        }
        var ink = C.readable(panel, [T.ink, '#16131C', '#FFFFFF']), muted = C.readable(panel, [T.muted, ink]), acc = C.ensure(T.accent, panel, 4.5), onAcc = C.readable(acc, ['#FFFFFF', '#16131C']);
        var headW = mode === 'circle' ? box.w * 0.6 : box.w, qr = v.link ? K.link(v.link) : '', q = qr ? 22 * u : 0;
        if (qr.length > 160) env.warn('input', 'This link is long, so the code is dense and harder to scan from paper. A shorter link works better.', 'link');
        var points = (v.points || []).filter(Boolean).slice(0, 3);
        var top = [
          { id: 'headline', name: 'Headline', text: v.headline, font: T.head, weight: T.headW, size: 11.5 * u * hk, min: 5 * u, maxLines: 3, lineHeight: T.caps ? 0.98 : 1.04, uppercase: !!T.caps, tracking: T.caps ? 0.01 : -0.015, color: ink, gap: 2.6 * u, w: headW, balance: !!T.centre, input: 'headline' },
          v.subline ? { id: 'subline', name: 'Line under the headline', text: v.subline, font: T.body, weight: 400, size: 4.1 * u, min: 2.8 * u, maxLines: 3, lineHeight: 1.3, color: muted, gap: 5 * u, w: mode === 'circle' ? box.w * 0.62 : Math.min(box.w, 78 * u), balance: !!T.centre, input: 'subline' } : null,
          mode === 'mid' ? { h: H * (points.length ? 0.24 : 0.3), gap: 5 * u, make: function (x, y, w, h) { return env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: x, y: y, w: w, h: h, radius: style === 'bold' ? 0 : 1.2 * u, label: 'Your photo' }); } } : null
        ].concat(points.map(function (p, i) {
          return { id: 'point-' + (i + 1), name: 'Point ' + (i + 1), text: p, font: T.body, weight: 700, size: 3.5 * u, min: 2.6 * u, maxLines: 2, lineHeight: 1.25, color: ink, gap: 1.7 * u, dx: T.centre ? 0 : 5 * u, w: T.centre ? box.w : box.w - 5 * u, input: 'points' };
        }));
        function foot(x, w) {
          var tw = q ? w - q - 5 * u : w, tx = x, yy = 0, a = T.centre && !q ? 'center' : 'left', rows = [];
          [['When', v.when, 'when'], ['Where', v.where, 'where']].forEach(function (r) {
            if (!r[1]) return;
            var lab = env.text({ id: r[2] + '-label', name: r[0] + ' label', text: r[0], x: tx, y: yy, w: tw, font: T.body, weight: 700, size: 2.1 * u, min: 1.7 * u, maxLines: 1, uppercase: true, tracking: 0.16, align: a, color: acc });
            var val = env.text({ id: r[2], name: r[0], text: r[1], x: tx, y: yy + lab.h + 0.2 * u, w: tw, font: T.body, weight: 700, size: 3.5 * u, min: 2.4 * u, maxLines: 2, lineHeight: 1.2, align: a, color: ink });
            rows.push(lab, val); yy = val.y + val.h + 2.2 * u;
          });
          if (v.cta) {
            var ct = env.fit({ text: v.cta, font: T.body, weight: 700, size: 3.6 * u, min: 2.4 * u, maxLines: 1, w: tw - 8 * u });
            var bw = Math.min(tw, ct.textWidth + 8.5 * u), bh = 8.4 * u, bx = a === 'center' ? tx + (tw - bw) / 2 : tx;
            yy += 1 * u;
            rows.push(env.rect({ id: 'cta-bg', name: 'Button', x: bx, y: yy, w: bw, h: bh, radius: style === 'bold' || style === 'poster' || style === 'minimal' ? 0 : bh / 2, fill: acc }));
            rows.push(env.text({ id: 'cta', name: 'Call to action', text: v.cta, x: bx + 4 * u, y: yy, w: bw - 8 * u, h: bh, font: T.body, weight: 700, size: 3.6 * u, min: 2.4 * u, maxLines: 1, align: 'center', valign: 'middle', color: onAcc }));
            yy += bh + 2.4 * u;
          }
          if (v.contact) { var cl = env.text({ id: 'contact', name: 'Contact line', text: v.contact, x: tx, y: yy, w: tw, font: T.body, weight: 400, size: 2.7 * u, min: 2 * u, maxLines: 2, lineHeight: 1.3, align: a, color: muted }); rows.push(cl); yy = cl.y + cl.h; }
          return { rows: rows, h: yy };
        }
        var F = foot(box.x, box.w), footH = Math.max(F.h, q ? q + 4 * u : 0), by = box.y + box.h;
        F.rows.forEach(function (l) { l.y += by - F.h; });
        if (q) {
          F.rows = F.rows.concat(K.qrTile(env, qr, box.x + box.w - q, by - q - 3.4 * u, q, { stroke: C.contrast('#FFFFFF', panel) < 1.4 ? C.mix(panel, ink, 0.25) : null }));
          F.rows.push(env.text({ id: 'qr-caption', name: 'Code caption', text: 'Scan for details', x: box.x + box.w - q - 4 * u, y: by - 2.6 * u, w: q + 4 * u, font: T.body, weight: 700, size: 1.9 * u, min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.12, align: 'right', color: muted }));
        }
        var parts = K.stack(env, { x: box.x, y: box.y, w: box.w, h: box.h - footH - (footH ? 5 * u : 0) }, top, { align: al, valign: 'top', minScale: 0.5, clip: true }).layers.concat(F.rows);
        if (!T.centre) parts.filter(function (l) { return /^point-\d+$/.test(l.id); }).forEach(function (l, i) { L.push(env.rect({ id: 'bullet-' + (i + 1), name: 'Bullet ' + (i + 1), x: box.x, y: l.y + l.size * 0.42, w: 2.2 * u, h: 2.2 * u, radius: style === 'bright' ? 1.1 * u : 0, fill: acc })); });
        page.layers = L.concat(parts);
        return { name: 'Flyer — ' + v.headline, pages: [page] };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
