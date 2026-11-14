/* Quick maker: event tickets with a tear-off stub and a perforation line. The ticket number (also the QR code) and the
   seat are fields, so Create many makes a numbered run from a list. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    classic: { bg: '#FBF6E9', ink: '#2A2118', muted: '#5C4E3C', accent: '#9B2C2C', head: 'Playfair Display', headW: 800, body: 'Lora', frame: 1 },
    bold: { bg: '#FFD23F', ink: '#16131C', muted: '#3A3542', accent: '#16131C', head: 'Anton', headW: 400, caps: 1, headK: 1.12, body: 'Work Sans' },
    dark: { bg: '#15171D', ink: '#F5F0E6', muted: '#C9C2B4', accent: '#E0B15C', head: 'Bebas Neue', headW: 400, caps: 1, headK: 1.25, body: 'Inter' },
    minimal: { bg: '#FFFFFF', ink: '#15171C', muted: '#555B66', accent: '#2450D8', head: 'Inter Tight', headW: 800, body: 'Inter' }
  };
  var LIST = [['no', 'seat']].concat([['A-0001', 'Row A, seat 1'], ['A-0002', 'Row A, seat 2'], ['A-0003', 'Row A, seat 3'], ['A-0004', 'Row A, seat 4'], ['B-0005', 'Row B, seat 1'], ['B-0006', 'Row B, seat 2'],
    ['B-0007', 'Row B, seat 3'], ['B-0008', 'Row B, seat 4'], ['C-0009', 'Standing'], ['C-0010', 'Standing'], ['C-0011', 'Standing'], ['VIP-0012', 'Balcony box 2, seat 14']]);

  function go(K) {
    M.register({
      id: 'ticket',
      name: 'Event ticket',
      category: 'Events',
      summary: 'A ticket with a tear-off stub, a number and a QR code, ready for a numbered run.',
      keywords: ['ticket', 'event ticket', 'raffle ticket', 'admission', 'concert', 'school play', 'numbered tickets', 'stub', 'entry pass', 'print'],
      sizes: [K.size('ticket-140', '140×55', 140, 55), K.size('ticket-us', '5.5×2 in', 139.7, 50.8), K.size('ticket-180', '180×70', 180, 70)],
      maxPages: 2,
      inputs: [
        { key: 'event', label: 'Event', type: 'text', required: true, max: 48, placeholder: 'Winter Concert' },
        { key: 'tagline', label: 'Line under it', type: 'text', max: 60, placeholder: 'Riverside School Orchestra' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'time', label: 'Time', type: 'text', max: 24, placeholder: 'Doors 6.30 pm' },
        { key: 'venue', label: 'Venue', type: 'text', max: 60, placeholder: 'Main Hall, Riverside School' },
        { key: 'seat', label: 'Seat or zone', type: 'text', max: 26, placeholder: 'Row A, seat 1' },
        { key: 'price', label: 'Price', type: 'text', max: 14, placeholder: '£8' },
        { key: 'code', label: 'Ticket number', type: 'text', max: 14, placeholder: 'A-0001', default: 'A-0001' },
        { key: 'qr', label: 'Number as a QR code', type: 'toggle', default: true },
        { key: 'paper', label: 'Print sheet', type: 'choice', default: 'none', options: [{ id: 'none', name: 'None' }, { id: 'a4', name: 'A4' }, { id: 'letter', name: 'US Letter' }] },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'classic', name: 'Classic' }, { id: 'bold', name: 'Bold' }, { id: 'dark', name: 'Dark' }, { id: 'minimal', name: 'Minimal' }],
      sample: { values: { event: 'Winter Concert', tagline: 'Riverside School Orchestra', date: '2026-12-11', time: 'Doors 6.30 pm', venue: 'Main Hall, Riverside School', seat: 'Row A, seat 1', price: '£8', code: 'A-0001', qr: true, paper: 'none' } },
      ui: K.many('ticket', LIST, { seat: 1 }),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, mm = env.print.mm, style = env.style;
        var T = Object.assign({}, S[style] || S.classic);
        if (v.accent) { if (style === 'bold') T.bg = v.accent; else T.accent = v.accent; }
        var u = H / 55, bg = T.bg, ink = C.readable(bg, [T.ink, '#FFFFFF']), muted = C.readable(bg, [T.muted, ink]), acc = C.ensure(T.accent, bg, 4.5);
        var hk = T.headK || 1, pad = 6 * u, stubW = Math.max(mm(34), W * 0.25), sx = W - stubW, L = [], vals = {};
        var code = v.code || 'A-0001';

        if (T.frame) L.push(env.rect({ id: 'frame', name: 'Border', x: 2.6 * u, y: 2.6 * u, w: W - 5.2 * u, h: H - 5.2 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.3 * u), color: acc } }));
        if (style === 'bold') L.push(env.rect({ id: 'stub-bg', name: 'Stub', x: sx, y: 0, w: stubW, h: H, fill: ink }));
        if (style === 'minimal') L.push(env.rect({ id: 'bar', name: 'Accent bar', x: 0, y: 0, w: 2.2 * u, h: H, fill: acc }));
        /* The perforation: a dashed line with a notch at each end. */
        L.push(env.svg({ id: 'perforation', name: 'Perforation', x: sx - 2 * u, y: 0, w: 4 * u, h: H,
          markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 55" preserveAspectRatio="none"><path d="M2 3.2V51.8" stroke="' + (style === 'bold' ? C.mix(bg, ink, 0.6) : C.mix(bg, ink, 0.55)) + '" stroke-width="0.3" stroke-dasharray="1.1 1" fill="none"/><circle cx="2" cy="0" r="1.9" fill="#FFFFFF"/><circle cx="2" cy="55" r="1.9" fill="#FFFFFF"/></svg>' }));

        var when = [v.date ? env.date.format(v.date, 'ddd D MMMM YYYY') : '', v.time].filter(Boolean).join('  ·  ');
        function fact(label, value, key, x, y, w) {
          var a = env.text({ id: key + '-label', name: label + ' label', text: label, x: x, y: y, w: w, font: T.body, weight: 700, size: 1.75 * u, min: 1.5 * u, maxLines: 1, uppercase: true, tracking: 0.16, color: muted });
          var b = env.text({ id: key, name: label, text: value, x: x, y: y + a.h + 0.3 * u, w: w, font: key === 'no' ? 'JetBrains Mono' : T.body, weight: 700, size: 3 * u, min: 1.9 * u, maxLines: 1, color: ink });
          return [a, b];
        }
        var main = { x: pad + (style === 'minimal' ? 2 * u : 0), y: pad, w: sx - 2 * pad - (style === 'minimal' ? 2 * u : 0), h: H - 2 * pad };
        L = L.concat(K.column(env, main, 'left', {
          top: [
            v.tagline ? { id: 'tagline', name: 'Line under the event', text: v.tagline, font: T.body, weight: 700, size: 2.2 * u, min: 1.7 * u, maxLines: 1, uppercase: true, tracking: 0.16, color: acc, gap: 1.4 * u, input: 'tagline' } : null,
            { id: 'event', name: 'Event', text: v.event, font: T.head, weight: T.headW, size: 9.2 * u * hk, min: 4 * u, maxLines: 2, lineHeight: 1.02, uppercase: !!T.caps, tracking: T.caps ? 0.02 : -0.01, color: ink, gap: 1.6 * u, input: 'event' },
            when ? { id: 'when', name: 'Date and time', text: when, font: T.body, weight: 700, size: 2.9 * u, min: 2 * u, maxLines: 1, color: ink, gap: 0.6 * u } : null,
            v.venue ? { id: 'venue', name: 'Venue', text: v.venue, font: T.body, weight: 400, size: 2.7 * u, min: 1.9 * u, maxLines: 1, color: muted, input: 'venue' } : null
          ],
          bottom: [{ h: 6.6 * u, make: function (x, y, w) {
            var out = [], cols = [v.seat ? ['Seat', v.seat, 'seat', 0.5] : null, v.price ? ['Price', v.price, 'price', 0.2] : null, ['Ticket', code, 'no', 0.3]].filter(Boolean), cx = x;
            var total = cols.reduce(function (a, c) { return a + c[3]; }, 0);
            cols.forEach(function (c) {
              var cw = w * c[3] / total, f = fact(c[0], c[1], c[2], cx, y, cw - 2 * u);
              if (c[2] === 'seat') K.field(f[1], 'seat', vals, { fallback: true, min: 1.6 * u });
              if (c[2] === 'no') K.field(f[1], 'no', vals, { min: 1.6 * u });
              out = out.concat(f); cx += cw;
            });
            return out;
          } }]
        }, vals, 2 * u));

        /* The stub the door keeps: admit one, the number again, and the code. */
        var sInk = style === 'bold' ? C.readable(ink, [bg, '#FFFFFF']) : ink, sMuted = style === 'bold' ? sInk : muted;
        var sb = { x: sx + 4.5 * u, y: pad, w: stubW - 4.5 * u - pad * 0.9, h: H - 2 * pad }, q = v.qr !== false ? Math.min(sb.w, sb.h - 14 * u, 26 * u) : 0;
        L = L.concat(K.column(env, sb, 'center', {
          top: [{ id: 'admit', name: 'Admit one', text: 'Admit one', font: T.head, weight: T.headW, size: 3.6 * u * hk, min: 2.2 * u, maxLines: 1, uppercase: true, tracking: 0.12, color: style === 'bold' ? sInk : acc }],
          mid: q ? [{ h: q, make: function (x, y, w, h) { return K.qrTile(env, code, x + (w - h) / 2, y, h, { key: 'no', stroke: style === 'bold' ? null : C.mix(bg, ink, 0.2) }); } }] : [],
          bottom: [{ id: 'stub-no', name: 'Ticket number', text: code, font: 'JetBrains Mono', weight: 700, size: 3.2 * u, min: 1.8 * u, maxLines: 1, color: sInk, field: 'no' },
            !q && v.seat ? { id: 'stub-seat', name: 'Seat', text: v.seat, font: T.body, weight: 400, size: 2.4 * u, min: 1.7 * u, maxLines: 2, color: sMuted } : null]
        }, vals, 1.6 * u));

        var page = env.page(bg);
        page.layers = L;
        page.values = vals;
        return { name: 'Ticket — ' + v.event, pages: [page].concat(K.sheets(env, { paper: v.paper, W: W, H: H, trim: { w: W, h: H }, gap: mm(4), title: 'Tickets', outline: C.mix(bg, ink, 0.25), sides: [{ layers: L, bg: bg, values: vals }] })) };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
