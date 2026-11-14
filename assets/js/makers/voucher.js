/* Quick maker: gift vouchers and coupons. DL, A6 and a share size; a value or an offer, to and from, a code (also as
   a QR code), terms and a valid-until line. To, from, value and code are fields for Create many. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    classic: { bg: '#FBF6E9', ink: '#2A2118', muted: '#5C4E3C', accent: '#8C6A1E', head: 'Playfair Display', headW: 700, body: 'EB Garamond', bodyK: 1.14, frame: 1 },
    modern: { bg: '#FFFFFF', ink: '#15171C', muted: '#555B66', accent: '#2450D8', head: 'Plus Jakarta Sans', headW: 800, body: 'Inter', panel: 1 },
    festive: { bg: '#8E1B2B', ink: '#FFF6E8', muted: '#F3DCC8', accent: '#F2C46D', head: 'Fraunces', headW: 700, body: 'Nunito', dots: 1 },
    minimal: { bg: '#FFFFFF', ink: '#1A1A1A', muted: '#5E5E5E', accent: '#1A1A1A', head: 'Inter Tight', headW: 700, body: 'Inter' },
    dark: { bg: '#16171C', ink: '#F3EFE7', muted: '#C4BFB4', accent: '#D2AB62', head: 'Cormorant Garamond', headW: 700, headK: 1.15, body: 'Jost', frame: 1 }
  };
  var LIST = [['to', 'from', 'value', 'code'],
    ['Amara', 'Daniel', '£50', 'GV-1001'], ['Mei', 'the Tanaka family', '£25', 'GV-1002'], ['Yusuf', 'Sofia', '£100', 'GV-1003'], ['Noah', 'Grandma', '£20', 'GV-1004'],
    ['Ananya', 'Kwame', 'One facial', 'GV-1005'], ['Isabella', 'Tomás', '£75', 'GV-1006'], ['Zoë', 'all of us at work', '£40', 'GV-1007'], ['Leo', 'Mum and Dad', '£30', 'GV-1008'],
    ['Hannah', 'Rafael', 'Two massages', 'GV-1009'], ['Omar', 'Grace', '£60', 'GV-1010'], ['Lukas', 'Chloé', '£15', 'GV-1011'], ['Alexandra Montgomery-Featherstonehaugh', 'Bo', '£250', 'GV-1012']];

  function go(K) {
    M.register({
      id: 'voucher',
      name: 'Gift voucher',
      category: 'Business',
      summary: 'A gift voucher or coupon with a value, a code and terms, ready to print or send.',
      keywords: ['gift voucher', 'gift certificate', 'coupon', 'gift card', 'voucher', 'discount', 'offer', 'salon', 'shop', 'print'],
      sizes: [K.size('dl', 'DL', 210, 99), K.size('a6-wide', 'A6', 148, 105), { id: 'share', name: 'Share', w: 1600, h: 900 }],
      maxPages: 2,
      inputs: [
        { key: 'title', label: 'Title', type: 'text', max: 28, placeholder: 'Gift voucher', default: 'Gift voucher' },
        { key: 'value', label: 'Value or offer', type: 'text', required: true, max: 24, placeholder: '£50' },
        { key: 'offer', label: 'Line under it', type: 'text', max: 70, placeholder: 'towards any treatment' },
        { key: 'business', label: 'Business', type: 'text', max: 40, placeholder: 'Willow Day Spa' },
        { key: 'to', label: 'To', type: 'text', max: 40, hint: 'Leave empty for a line to write on.' },
        { key: 'from', label: 'From', type: 'text', max: 40 },
        { key: 'code', label: 'Code', type: 'text', max: 20, placeholder: 'GV-1001' },
        { key: 'qr', label: 'Code as a QR code too', type: 'toggle', default: true },
        { key: 'valid', label: 'Valid until', type: 'text', max: 30, placeholder: '31 December 2027' },
        { key: 'terms', label: 'Terms', type: 'longtext', max: 200, maxLines: 3, placeholder: 'Not exchangeable for cash. One voucher per visit.' },
        { key: 'logo', label: 'Logo', type: 'photo' },
        { key: 'paper', label: 'Print sheet', type: 'choice', default: 'none', options: [{ id: 'none', name: 'None' }, { id: 'a4', name: 'A4' }, { id: 'letter', name: 'US Letter' }] },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'classic', name: 'Classic' }, { id: 'modern', name: 'Modern' }, { id: 'festive', name: 'Festive' }, { id: 'minimal', name: 'Minimal' }, { id: 'dark', name: 'Dark' }],
      sample: { values: { title: 'Gift voucher', value: '£50', offer: 'towards any treatment', business: 'Willow Day Spa', to: 'Amara', from: 'Daniel', code: 'GV-1001', qr: true, valid: '31 December 2027',
        terms: 'Not exchangeable for cash. One voucher per visit. Please book ahead and bring this voucher with you.', paper: 'none' } },
      ui: K.many('voucher', LIST, { to: 0, from: 1, code: 3 }),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, style = env.style;
        var T = Object.assign({}, S[style] || S.classic);
        if (v.accent) T.accent = v.accent;
        var u = Math.min(W / 180, H / 99), bg = T.bg, ink = T.ink, muted = C.readable(bg, [T.muted, ink]), acc = C.ensure(T.accent, bg, 4.5);
        var bk = T.bodyK || 1, hk = T.headK || 1, pad = (T.frame ? 11 : 9) * u, split = W * 0.67, L = [], vals = {};
        var panelBg = T.panel ? acc : bg, pInk = T.panel ? C.readable(acc, ['#FFFFFF', ink]) : ink, pMuted = T.panel ? pInk : muted;

        if (T.panel) L.push(env.rect({ id: 'panel', name: 'Colour panel', x: split, y: 0, w: W - split, h: H, fill: acc }));
        if (T.dots) {
          var d = '';
          for (var i = 0; i < 46; i++) { var x = env.random() * 180, y = env.random() < 0.5 ? env.random() * 6 : H / u - env.random() * 6; d += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (0.5 + env.random() * 1.1).toFixed(2) + '" fill="' + (i % 3 ? T.accent : '#FFFFFF') + '" opacity="' + (0.35 + env.random() * 0.5).toFixed(2) + '"/>'; }
          L.push(env.svg({ id: 'dots', name: 'Confetti', x: 0, y: 0, w: W, h: H, markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (W / u).toFixed(1) + ' ' + (H / u).toFixed(1) + '">' + d + '</svg>' }));
        }
        if (T.frame) L.push(env.rect({ id: 'frame', name: 'Border', x: 4.5 * u, y: 4.5 * u, w: W - 9 * u, h: H - 9 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.35 * u), color: acc } }));
        if (!T.panel) L.push(env.svg({ id: 'divider', name: 'Divider', x: split - u, y: pad, w: 2 * u, h: H - 2 * pad,
          markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 100" preserveAspectRatio="none"><path d="M1 0V100" stroke="' + C.mix(bg, ink, 0.45) + '" stroke-width="0.25" stroke-dasharray="1.2 1.2" fill="none"/></svg>' }));

        function toFrom(x, y, w, h) {
          var out = [], cw = (w - 6 * u) / 2;
          [['To', v.to, 'to'], ['From', v.from, 'from']].forEach(function (r, i) {
            var cx = x + i * (cw + 6 * u);
            var lab = env.text({ id: r[2] + '-label', name: r[0] + ' label', text: r[0], x: cx, y: y, w: cw, font: T.body, weight: 700, size: 2.3 * u * bk, min: 1.8 * u, maxLines: 1, uppercase: true, tracking: 0.16, color: acc });
            out.push(lab);
            if (r[1]) out.push(K.field(env.text({ id: r[2], name: r[0], text: r[1], x: cx, y: y + lab.h + 0.6 * u, w: cw, font: T.body, weight: 400, size: 4 * u * bk, min: 2.4 * u, maxLines: 1, color: ink }), r[2], vals, { min: 2 * u }));
            out.push(env.line({ id: r[2] + '-line', name: r[0] + ' line', x: cx, y: y + h - 0.3 * u, w: cw, width: Math.max(2, 0.18 * u), color: C.mix(bg, ink, 0.5) }));
          });
          return out;
        }
        var left = { x: pad, y: pad, w: split - pad - 6 * u, h: H - 2 * pad };
        L = L.concat(K.column(env, left, 'left', {
          top: [
            v.logo ? { h: 10 * u, gap: 2.4 * u, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: 'left' }); } }
              : v.business ? { id: 'business', name: 'Business', text: v.business, font: T.head, weight: T.headW, size: 4.4 * u * hk, min: 2.6 * u, maxLines: 1, color: ink, gap: 1.6 * u, input: 'business' } : null,
            { id: 'title', name: 'Title', text: v.title || 'Gift voucher', font: T.body, weight: 700, size: 2.7 * u * bk, min: 2 * u, maxLines: 1, uppercase: true, tracking: 0.24, color: acc, input: 'title' }
          ],
          mid: [
            { id: 'value', name: 'Value', text: v.value, font: T.head, weight: T.headW, size: 19 * u * hk, min: 6 * u, maxLines: 2, lineHeight: 1.02, tracking: -0.01, color: ink, gap: 1 * u, field: 'value', fallback: true, input: 'value' },
            v.offer ? { id: 'offer', name: 'Line under the value', text: v.offer, font: T.body, weight: 400, size: 3.7 * u * bk, min: 2.4 * u, maxLines: 2, color: muted, input: 'offer' } : null
          ],
          bottom: [{ h: 9.5 * u, make: toFrom }]
        }, vals, 3 * u));

        var px = split + 6 * u, pw = W - px - (T.panel ? 7 * u : pad), q = v.code && v.qr !== false ? Math.min(pw * 0.72, 30 * u) : 0;
        L = L.concat(K.column(env, { x: px, y: pad, w: pw, h: H - 2 * pad }, 'center', {
          top: [
            q ? { h: q, gap: 2.4 * u, make: function (x, y, w, h) { return K.qrTile(env, v.code, x + (w - h) / 2, y, h, { key: 'code', stroke: T.panel ? null : C.mix(bg, ink, 0.2) }); } } : null,
            v.code ? { id: 'code-label', name: 'Code label', text: 'Voucher code', font: T.body, weight: 700, size: 2 * u * bk, min: 1.7 * u, maxLines: 1, uppercase: true, tracking: 0.16, color: pMuted, gap: 0.5 * u } : null,
            v.code ? { id: 'code', name: 'Code', text: v.code, font: 'JetBrains Mono', weight: 700, size: 4 * u, min: 2.2 * u, maxLines: 1, color: pInk, gap: 2.6 * u, field: 'code', input: 'code' } : null,
            v.valid ? { id: 'valid', name: 'Valid until', text: 'Valid until ' + v.valid, font: T.body, weight: 700, size: 2.5 * u * bk, min: 1.9 * u, maxLines: 2, color: pInk, input: 'valid' } : null
          ],
          bottom: [v.terms ? { id: 'terms', name: 'Terms', text: v.terms, font: T.body, weight: 400, size: 2.1 * u * bk, min: 1.7 * u, maxLines: 7, lineHeight: 1.35, color: pMuted, input: 'terms' } : null]
        }, vals, 2 * u));
        if (panelBg && v.code) vals.code = v.code;

        var page = env.page(bg);
        page.layers = L;
        page.values = vals;
        var pages = [page].concat(K.sheets(env, { paper: env.size.print ? v.paper : 'none', W: W, H: H, trim: { w: W, h: H }, gap: env.print.mm(4), title: 'Gift vouchers', outline: C.mix(bg, ink, 0.25), sides: [{ layers: L, bg: bg, values: vals }] }));
        return { name: 'Voucher — ' + v.value, pages: pages };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
