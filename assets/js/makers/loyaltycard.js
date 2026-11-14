/* Quick maker: loyalty stamp cards. Business-card size with bleed, a front with the business name and a back with
   5, 8 or 10 stamp slots and the reward. The holder's name and the card number are fields for Create many. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    cafe: { bg: '#F5EDE0', ink: '#3A2618', muted: '#6B5140', accent: '#B4532A', head: 'DM Serif Display', headW: 400, body: 'DM Sans', back: 'bg' },
    fresh: { bg: '#FFFFFF', ink: '#14301F', muted: '#4B6253', accent: '#177A4C', head: 'Plus Jakarta Sans', headW: 800, body: 'Plus Jakarta Sans', back: 'accent' },
    bold: { bg: '#16131C', ink: '#FFFFFF', muted: '#CFCBD8', accent: '#FFD23F', head: 'Archivo Black', headW: 400, caps: 1, headK: 0.86, body: 'Archivo', back: 'bg' },
    soft: { bg: '#FBEFF2', ink: '#3B2A38', muted: '#6C5767', accent: '#B8477A', head: 'Fraunces', headW: 700, body: 'Nunito', back: 'bg' }
  };
  var ICONS = [{ id: 'number', name: 'Numbers' }, { id: 'coffee', name: 'Cup' }, { id: 'star', name: 'Star' }, { id: 'heart', name: 'Heart' }, { id: 'scissors', name: 'Scissors' }, { id: 'paw-print', name: 'Paw' }, { id: 'pizza', name: 'Pizza' }];
  var LIST = [['name', 'no'], ['Amara Okafor', '0001'], ['Daniel Kim', '0002'], ['Fatima Al-Sayed', '0003'], ['George Papadopoulos', '0004'], ['Hye-jin Park', '0005'], ['Ibrahim Diallo', '0006'],
    ['Julia Nowak', '0007'], ['Kofi Boateng', '0008'], ['Lucía Hernández', '0009'], ['Mohammed Rahman', '0010'], ['Nadia Petrenko', '0011'], ['Oluwaseun Adeyemi-Williams', '0012']];

  function go(K) {
    M.register({
      id: 'loyaltycard',
      name: 'Loyalty card',
      category: 'Business',
      summary: 'A stamp card with 5, 8 or 10 stamps and a reward, front and back, with a print sheet.',
      keywords: ['loyalty card', 'stamp card', 'punch card', 'reward card', 'coffee card', 'cafe', 'salon', 'shop', 'buy 9 get 1 free', 'print'],
      sizes: [K.size('card-85x55', '85×55', 85, 55, 3), K.size('card-us', '3.5×2 in', 88.9, 50.8, 3.175)],
      maxPages: 4,
      inputs: [
        { key: 'business', label: 'Business', type: 'text', required: true, max: 36, placeholder: 'Harbour Coffee' },
        { key: 'tagline', label: 'Line under it', type: 'text', max: 50, placeholder: 'Roasted here every morning' },
        { key: 'stamps', label: 'Stamps', type: 'choice', default: '10', options: [{ id: '5', name: '5' }, { id: '8', name: '8' }, { id: '10', name: '10' }] },
        { key: 'reward', label: 'Reward', type: 'text', max: 60, placeholder: 'Your 10th coffee is free' },
        { key: 'icon', label: 'Stamp slots show', type: 'choice', default: 'number', options: ICONS },
        { key: 'contact', label: 'Address or website', type: 'text', max: 60, placeholder: '8 Quay Street · harbourcoffee.example' },
        { key: 'holder', label: 'Holder’s name', type: 'text', max: 40, hint: 'Leave empty for a line to write on. For named cards from a list, use the button below.' },
        { key: 'number', label: 'Card number', type: 'text', max: 12 },
        { key: 'logo', label: 'Logo', type: 'photo' },
        { key: 'paper', label: 'Print sheets', type: 'choice', default: 'none', options: [{ id: 'none', name: 'None' }, { id: 'a4', name: 'A4' }, { id: 'letter', name: 'US Letter' }] },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'cafe', name: 'Café' }, { id: 'fresh', name: 'Fresh' }, { id: 'bold', name: 'Bold' }, { id: 'soft', name: 'Soft' }],
      sample: { values: { business: 'Harbour Coffee', tagline: 'Roasted here every morning', stamps: '10', reward: 'Your 10th coffee is free', icon: 'coffee', contact: '8 Quay Street · harbourcoffee.example', paper: 'none' } },
      ui: K.many('loyaltycard', LIST, { holder: 0, number: 1 }),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, mm = env.print.mm, style = env.style;
        var T = Object.assign({}, S[style] || S.cafe);
        if (v.accent) T.accent = v.accent;
        var b = mm(env.size.id === 'card-us' ? 3.175 : 3), pad = mm(5), hk = T.headK || 1;
        var inner = { x: b + pad, y: b + pad, w: W - 2 * (b + pad), h: H - 2 * (b + pad) };
        var n = Math.max(5, Math.min(10, parseInt(v.stamps, 10) || 10));
        var reward = v.reward || 'Collect ' + n + ' stamps for a reward';

        function side(isBack) {
          var bg = isBack && T.back === 'accent' ? T.accent : T.bg, vals = {}, L = [];
          var ink = C.readable(bg, [T.ink, '#FFFFFF']), muted = C.readable(bg, [T.muted, ink]), acc = C.ensure(isBack && T.back === 'accent' ? ink : T.accent, bg, 4.5);
          if (!isBack) {
            if (style === 'fresh') L.push(env.rect({ id: 'band', name: 'Colour band', x: 0, y: H - b - mm(9), w: W, h: b + mm(9), fill: T.accent }));
            if (style === 'bold') L.push(env.rect({ id: 'band', name: 'Accent line', x: inner.x, y: inner.y, w: mm(12), h: mm(1.2), fill: acc }));
            var foot = style === 'fresh' ? C.readable(T.accent, ['#FFFFFF', T.ink]) : muted;
            L = L.concat(K.column(env, style === 'fresh' ? { x: inner.x, y: inner.y, w: inner.w, h: H - b - mm(9) - inner.y - mm(2) } : inner, style === 'bold' || style === 'fresh' ? 'left' : 'center', {
              mid: [
                v.logo ? { h: mm(12), fixed: true, gap: mm(2), make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: style === 'bold' || style === 'fresh' ? 'left' : 'center' }); } } : null,
                { id: 'business', name: 'Business', text: v.business, font: T.head, weight: T.headW, size: mm(7.4 * hk), min: mm(3.4), maxLines: 2, lineHeight: 1.05, uppercase: !!T.caps, color: ink, gap: mm(1.4), input: 'business' },
                v.tagline ? { id: 'tagline', name: 'Line under the name', text: v.tagline, font: T.body, weight: 400, size: mm(2.7), min: mm(2), maxLines: 2, color: muted, gap: mm(3), input: 'tagline' } : null,
                { id: 'kind', name: 'Card type', text: 'Loyalty card', font: T.body, weight: 700, size: mm(2.2), min: mm(1.8), maxLines: 1, uppercase: true, tracking: 0.2, color: acc }
              ]
            }, vals, mm(2)));
            if (v.contact) L.push(env.text({ id: 'contact', name: 'Address or website', text: v.contact, x: inner.x, y: H - b - mm(style === 'fresh' ? 7.6 : 8.4), w: inner.w, h: mm(4), font: T.body, weight: style === 'fresh' ? 700 : 400, size: mm(2.3), min: mm(1.8), maxLines: 1,
              align: style === 'bold' || style === 'fresh' ? 'left' : 'center', valign: 'middle', color: foot }));
            return { layers: L, bg: bg, values: vals };
          }
          /* The back: the reward, the slots, and who the card belongs to. */
          var cols = n === 8 ? 4 : 5, rows = Math.ceil(n / cols), gap = mm(2.2);
          var head = env.text({ id: 'reward', name: 'Reward', text: reward, x: inner.x, y: inner.y, w: inner.w, font: T.head, weight: T.headW, size: mm(3.6 * hk), min: mm(2.3), maxLines: 2, lineHeight: 1.1, uppercase: !!T.caps, align: 'center', color: ink });
          L.push(head);
          var footH = mm(6.2), gy = head.y + head.h + mm(2.6), gh = inner.y + inner.h - footH - mm(2) - gy;
          var d = Math.min((inner.w - gap * (cols - 1)) / cols, (gh - gap * (rows - 1)) / rows), gw = d * cols + gap * (cols - 1), gx = inner.x + (inner.w - gw) / 2, oy = gy + (gh - (d * rows + gap * (rows - 1))) / 2;
          for (var i = 0; i < n; i++) {
            var x = gx + (i % cols) * (d + gap), y = oy + Math.floor(i / cols) * (d + gap), last = i === n - 1;
            L.push(env.ellipse({ id: 'slot-' + (i + 1), name: 'Stamp ' + (i + 1), x: x, y: y, w: d, h: d, fill: last ? acc : { type: 'none' }, stroke: { width: Math.max(2, mm(0.25)), color: acc, dash: last ? null : [mm(0.9), mm(0.7)] } }));
            var on = last ? C.readable(acc, [bg, '#FFFFFF', '#111111']) : C.mix(bg, ink, 0.55);
            if (last) L.push(env.icon('lucide:gift', { id: 'slot-icon-' + (i + 1), name: 'Reward', x: x + d * 0.26, y: y + d * 0.26, w: d * 0.48, h: d * 0.48, color: on, strokeWidth: 2 }));
            else if (v.icon && v.icon !== 'number') L.push(env.icon('lucide:' + v.icon, { id: 'slot-icon-' + (i + 1), name: 'Stamp mark ' + (i + 1), x: x + d * 0.29, y: y + d * 0.29, w: d * 0.42, h: d * 0.42, color: on, strokeWidth: 1.8 }));
            else L.push(env.text({ id: 'slot-n-' + (i + 1), name: 'Stamp number ' + (i + 1), text: String(i + 1), x: x, y: y, w: d, h: d, font: T.body, weight: 700, size: d * 0.36, min: d * 0.2, maxLines: 1, align: 'center', valign: 'middle', color: C.ensure(on, bg, 4.5) }));
          }
          var fy = inner.y + inner.h - footH, nw = v.number ? inner.w * 0.28 : 0, lw = inner.w - nw - (nw ? mm(3) : 0);
          var lab = env.text({ id: 'name-label', name: 'Name label', text: 'Name', x: inner.x, y: fy + footH - mm(3.2), w: mm(11), font: T.body, weight: 700, size: mm(1.9), min: mm(1.6), maxLines: 1, uppercase: true, tracking: 0.14, color: muted });
          L.push(lab);
          if (v.holder) L.push(K.field(env.text({ id: 'holder', name: 'Holder', text: v.holder, x: inner.x + mm(11), y: fy, w: lw - mm(11), h: footH - mm(0.6), font: T.body, weight: 700, size: mm(2.8), min: mm(1.9), maxLines: 1, valign: 'bottom', color: ink }), 'name', vals, { min: mm(1.7) }));
          L.push(env.line({ id: 'name-line', name: 'Name line', x: inner.x + mm(11), y: fy + footH, w: lw - mm(11), width: Math.max(2, mm(0.15)), color: C.mix(bg, ink, 0.5) }));
          if (v.number) L.push(K.field(env.text({ id: 'number', name: 'Card number', text: v.number, x: inner.x + inner.w - nw, y: fy, w: nw, h: footH, font: 'JetBrains Mono', weight: 700, size: mm(2.6), min: mm(1.8), maxLines: 1, align: 'right', valign: 'bottom', color: muted }), 'no', vals, { min: mm(1.7) }));
          return { layers: L, bg: bg, values: vals };
        }

        var F = side(false), B = side(true), pages = [F, B].map(function (sd) {
          var p = env.page(sd.bg);
          p.layers = sd.layers.concat(K.trimMarks(env, b, { color: C.isDark(sd.bg) ? '#FFFFFF' : style === 'fresh' ? '#8A8A8A' : '#1A1A1A' }));
          p.values = sd.values;
          return p;
        });
        return { name: 'Loyalty card — ' + v.business, pages: pages.concat(K.sheets(env, { paper: v.paper, W: W, H: H, trim: { w: W - 2 * b, h: H - 2 * b }, bleed: b, title: 'Loyalty cards', sides: [F, B] })) };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
