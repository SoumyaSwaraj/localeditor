/* Quick maker: invitation with a QR code (V15). The person pastes an RSVP, map or address link; nothing is fetched.
   The code is always dark on a white tile with a 4-module quiet zone, and never smaller than about a quarter of the width. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var CAPTION = { rsvp: 'Scan to RSVP', map: 'Scan for directions', address: 'Scan for the address', info: 'Scan for details' };
  var S = {
    wedding: { bg: '#F6F1E8', ink: '#2E2A26', muted: '#5F574E', accent: '#9A7B4F', names: 'Great Vibes', namesW: 400, head: 'Cormorant Garamond', body: 'Cormorant Garamond', kicker: 'Together with their families', line: 'invite you to celebrate their wedding', align: 'center' },
    birthday: { bg: '#FFD84D', ink: '#2A1838', muted: '#4A3658', accent: '#E8445A', names: 'Bungee', namesW: 400, head: 'Bungee', body: 'Poppins', kicker: 'You’re invited to', line: 'Birthday party', align: 'center' },
    babyshower: { bg: '#E6EFF3', ink: '#24364A', muted: '#4B5E70', accent: '#6E97B8', names: 'Dancing Script', namesW: 700, head: 'Fraunces', body: 'Nunito', kicker: 'Please join us for a baby shower honouring', line: '', align: 'center' },
    housewarming: { bg: '#F3E7DA', ink: '#3A2418', muted: '#6A4C3B', accent: '#B4532A', names: 'DM Serif Display', namesW: 400, head: 'DM Serif Display', body: 'DM Sans', kicker: 'Come and warm our new home', line: 'Housewarming', align: 'center' },
    corporate: { bg: '#13213C', ink: '#FFFFFF', muted: '#C9D2E3', accent: '#E3B65B', names: 'Montserrat', namesW: 700, head: 'Montserrat', body: 'Inter', kicker: 'You are invited to', line: '', align: 'left' }
  };

  LE.makers.register({
    id: 'qrinvite',
    name: 'Invitation with QR',
    category: 'Life',
    summary: 'An invitation with a scannable code for RSVPs, the map or the address.',
    keywords: ['invitation', 'invite', 'qr', 'rsvp', 'wedding', 'birthday', 'baby shower', 'housewarming', 'party', 'corporate', 'event', 'map', 'save the date'],
    sizes: [
      'portrait',
      'story',
      { id: 'card5x7', name: 'Print 5×7', w: 1500, h: 2100, print: { paper: '5x7', w: 127, h: 177.8, dpi: 300 } }
    ],
    inputs: [
      { key: 'names', label: 'Who or what', type: 'text', required: true, max: 60, placeholder: 'Asha & Rohan' },
      { key: 'kicker', label: 'Line above', type: 'text', max: 70, placeholder: 'Together with their families' },
      { key: 'line', label: 'Line below', type: 'text', max: 60, placeholder: 'invite you to celebrate their wedding' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'time', label: 'Time', type: 'text', max: 30, placeholder: '4 pm onwards' },
      { key: 'venue', label: 'Venue', type: 'text', max: 70, placeholder: 'The Banyan Courtyard' },
      { key: 'address', label: 'Address', type: 'text', max: 120, placeholder: '12 Lake Road, Udaipur' },
      { key: 'message', label: 'Message', type: 'longtext', max: 200, maxLines: 4, placeholder: 'Dinner and dancing to follow.' },
      { key: 'rsvp', label: 'RSVP line', type: 'text', max: 80, placeholder: 'Kindly reply by 1 February' },
      { key: 'link', label: 'Link for the code', type: 'text', max: 600, placeholder: 'https://…', hint: 'Paste your RSVP form, map or address link. Nothing is looked up. Shorter links make codes that scan more easily.' },
      { key: 'linkKind', label: 'The code opens', type: 'choice', options: [{ id: 'rsvp', name: 'RSVP' }, { id: 'map', name: 'Map' }, { id: 'address', name: 'Address' }, { id: 'info', name: 'Details' }], default: 'rsvp' },
      { key: 'photo', label: 'Photo', type: 'photo' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'wedding', name: 'Wedding' },
      { id: 'birthday', name: 'Birthday' },
      { id: 'babyshower', name: 'Baby shower' },
      { id: 'housewarming', name: 'Housewarming' },
      { id: 'corporate', name: 'Corporate' }
    ],
    sample: { values: {
      names: 'Asha & Rohan', date: '2027-02-14', time: '5 pm', venue: 'The Banyan Courtyard', address: '12 Lake Road, Udaipur',
      message: 'Dinner and dancing to follow.', rsvp: 'Kindly reply by 20 January', link: 'https://example.com/rsvp/asha-rohan', linkKind: 'rsvp', photo: 'sample:soft-02'
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var T = Object.assign({}, S[style] || S.wedding);
      if (v.accent) {
        if (style === 'birthday') T.bg = v.accent;
        else if (style === 'corporate') T.bg = C.isDark(v.accent) ? v.accent : C.shade(v.accent, 0.7);
        else T.accent = v.accent;
      }
      var u = W / 100;
      var top = env.tall ? 12 * u : 7 * u, bottom = env.tall ? 15 * u : 7 * u;
      var page = env.page(T.bg), L = [];
      var bg = T.bg;
      var ink = C.readable(bg, [T.ink]), muted = C.readable(bg, [T.muted, T.ink]);
      var acc = C.ensure(T.accent, bg, 3), accText = C.ensure(T.accent, bg, 4.5);
      var left = T.align === 'left';
      var mx = (style === 'wedding' ? 13 : left ? 10 : 11) * u;
      var inner = { x: mx, y: top + (style === 'wedding' ? 4 * u : 0), w: W - 2 * mx, h: H - top - bottom - (style === 'wedding' ? 8 * u : 0) };
      var code = v.link || '';
      if (code.length > 160) env.warn('input', 'This link is long (' + code.length + ' characters), so the code is dense and harder to scan from a printed card. A shorter link works better.', 'link');
      var kicker = v.kicker || T.kicker, line = v.line != null ? v.line : T.line;
      var dateTxt = v.date ? env.date.format(v.date, style === 'corporate' ? 'dddd D MMMM YYYY' : 'dddd, D MMMM YYYY') : '';
      var when = [dateTxt, v.time].filter(Boolean).join(style === 'wedding' ? ' at ' : ' · ');
      var al = left ? 'left' : 'center';

      /* The code is encoded once; the fitting loop only moves and sizes copies of it. */
      var QR = code ? env.qr(code, { id: 'qr', name: 'QR code', x: 0, y: 0, w: 1, h: 1, color: '#111111', background: '#FFFFFF', quiet: 4, level: 'M' }) : null;
      function qrAt(x, y, q) { return Object.assign({}, QR, { x: x, y: y, w: q, h: q }); }
      function blocks(s, q, ph) {
        var out = [], y = 0, x = inner.x, w = inner.w;
        function push(l, gap) { l.y = y; out.push(l); y += l.h + (gap || 0); return l; }
        if (v.photo && ph > 0) {
          var pw = style === 'wedding' ? ph * 0.78 : style === 'corporate' ? w : ph;
          var px = left ? x : x + (w - pw) / 2;
          var spec = { id: 'photo', name: 'Photo', src: v.photo, x: px, y: y, w: pw, h: ph, label: 'Add a photo' };
          if (style === 'wedding') spec.maskPath = 'M0 ' + ph + 'L0 ' + (pw / 2) + 'A' + (pw / 2) + ' ' + (pw / 2) + ' 0 0 1 ' + pw + ' ' + (pw / 2) + 'L' + pw + ' ' + ph + 'Z';
          else if (style === 'birthday' || style === 'babyshower') { spec.mask = 'ellipse'; spec.border = { width: 1.4 * u, color: '#FFFFFF' }; }
          else spec.radius = style === 'corporate' ? 1 * u : 2.4 * u;
          out.push(env.photo(spec));
          y += ph + 5 * u * s;
        }
        if (kicker) push(env.text({ id: 'kicker', name: 'Line above', text: kicker, x: x, y: 0, w: w, font: T.body, weight: style === 'wedding' ? 700 : 700, size: (style === 'wedding' ? 3.4 : 2.9) * u * s, min: 1.8 * u, maxLines: 2, uppercase: style !== 'birthday', tracking: style === 'wedding' ? 0.14 : 0.12, align: al, color: style === 'corporate' ? acc : accText, balance: bal && !left }), 2.4 * u * s);
        var nameSize = { wedding: 15, birthday: 11, babyshower: 13, housewarming: 11.5, corporate: 8.5 }[style] * u * s;
        push(env.text({ id: 'names', name: 'Names', text: v.names, x: x, y: 0, w: w, font: T.names, weight: T.namesW, size: nameSize, min: 4.5 * u, maxLines: 3, lineHeight: style === 'wedding' || style === 'babyshower' ? 1.15 : 1.02, tracking: style === 'corporate' ? -0.02 : 0, align: al, color: style === 'wedding' ? C.ensure(T.accent, bg, 4.5) : ink, balance: bal && !left }), 2 * u * s);
        if (line) push(env.text({ id: 'line', name: 'Line below', text: line, x: x, y: 0, w: w, font: style === 'birthday' ? 'Poppins' : T.head, weight: style === 'wedding' ? 400 : 700, italic: style === 'wedding', size: (style === 'wedding' ? 4.6 : style === 'birthday' ? 4.2 : 4.4) * u * s, min: 2.2 * u, maxLines: 2, uppercase: style === 'birthday', tracking: style === 'birthday' ? 0.08 : 0, align: al, color: style === 'birthday' ? accText : ink, balance: bal && !left }), 3 * u * s);
        if (style === 'wedding' || style === 'corporate') { out.push(env.line({ id: 'rule', name: 'Rule', x: left ? x : x + w / 2 - 8 * u, y: y, w: left ? 14 * u : 16 * u, width: Math.max(2, 0.3 * u), color: acc })); y += 3.2 * u * s; }
        if (when) push(env.text({ id: 'when', name: 'Date and time', text: when, x: x, y: 0, w: w, font: T.body, weight: 700, size: 3.5 * u * s, min: 1.9 * u, maxLines: 2, uppercase: style === 'wedding' || style === 'corporate', tracking: style === 'wedding' ? 0.08 : 0.02, align: al, color: ink, balance: bal && !left }), 1.4 * u * s);
        if (v.venue) push(env.text({ id: 'venue', name: 'Venue', text: v.venue, x: x, y: 0, w: w, font: style === 'wedding' ? T.body : T.head === 'Bungee' ? 'Poppins' : T.head, weight: 700, size: 3.9 * u * s, min: 2 * u, maxLines: 2, align: al, color: ink, balance: bal && !left }), 0.8 * u * s);
        if (v.address) push(env.text({ id: 'address', name: 'Address', text: v.address, x: x, y: 0, w: w, font: T.body, weight: 400, size: 3.1 * u * s, min: 1.8 * u, maxLines: 3, align: al, color: muted, balance: bal && !left }), 0);
        y += 3 * u * s;
        if (v.message) push(env.text({ id: 'message', name: 'Message', text: v.message, x: x, y: 0, w: w, font: T.body, weight: 400, italic: style === 'wedding', size: 3.3 * u * s, min: 1.8 * u, maxLines: 6, lineHeight: 1.35, align: al, color: ink, balance: bal && !left }), 3 * u * s);
        if (code) {
          var tile = q + 3 * u;
          var tx = left ? x : x + (w - tile) / 2;
          out.push(env.rect({ id: 'qr-tile', name: 'Code tile', x: tx, y: y, w: tile, h: tile, fill: '#FFFFFF', radius: 1.6 * u, stroke: C.contrast('#FFFFFF', bg) < 1.3 ? { width: Math.max(2, 0.25 * u), color: C.mix(bg, ink, 0.3) } : null }));
          out.push(qrAt(tx + 1.5 * u, y + 1.5 * u, q));
          y += tile + 1.6 * u * s;
          push(env.text({ id: 'qr-caption', name: 'Code caption', text: CAPTION[v.linkKind || 'rsvp'], x: x, y: 0, w: w, font: T.body, weight: 700, size: 2.7 * u * s, min: 1.7 * u, maxLines: 1, uppercase: true, tracking: 0.12, align: al, color: accText }), 1.2 * u * s);
        }
        if (v.rsvp) push(env.text({ id: 'rsvp', name: 'RSVP line', text: v.rsvp, x: x, y: 0, w: w, font: T.body, weight: 400, size: 3 * u * s, min: 1.8 * u, maxLines: 2, align: al, color: muted, balance: bal && !left }));
        return { layers: out, h: y };
      }
      var qMax = 30 * u, qMin = 24 * u;
      var phMax = v.photo ? (env.tall ? 44 : env.portrait ? 30 : 34) * u * (style === 'corporate' ? 0.8 : 1) : 0, phMin = v.photo ? 18 * u : 0;
      var bal = false; /* balancing keeps the line count, so it is left for the final pass */
      var s = env.tall ? 1.28 : 1, q = qMax * (env.tall ? 1.15 : 1), ph = phMax, res;
      for (var i = 0; i < 40; i++) {
        res = blocks(s, q, ph);
        var over = res.h - inner.h;
        if (over <= 0) break;
        var phSoft = Math.max(phMin, phMax * 0.7);
        if (ph > phSoft) ph = Math.max(phSoft, ph - over);
        else if (s > 0.82) s = Math.max(0.82, s * 0.95);
        else if (ph > phMin) ph = Math.max(phMin, ph - over);
        else if (q > qMin) q = Math.max(qMin, q - over);
        else s = Math.max(0.5, s * 0.93);
      }
      bal = true; res = blocks(s, q, ph);
      var oy = inner.y + Math.max(0, (inner.h - res.h) / 2);
      res.layers.forEach(function (l) { l.y += oy; });

      /* Decoration, back to front, kept off the text. */
      if (style === 'wedding') {
        L.push(env.rect({ id: 'frame', name: 'Frame', x: 4 * u, y: 4 * u, w: W - 8 * u, h: H - 8 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.3 * u), color: acc } }));
        L.push(env.rect({ id: 'frame-inner', name: 'Frame', x: 5.4 * u, y: 5.4 * u, w: W - 10.8 * u, h: H - 10.8 * u, fill: { type: 'none' }, stroke: { width: Math.max(1, 0.12 * u), color: acc } }));
      } else if (style === 'birthday') {
        var cols = ['#E8445A', '#2F7DE1', '#2A1838', '#FFFFFF', '#1FA67A'];
        var conf = '';
        for (var k = 0; k < 46; k++) {
          var cx = env.random() * 100, cy = env.random() * 100 * H / W, edge = Math.min(cx, 100 - cx);
          if (edge > 9) cx = env.random() < 0.5 ? env.random() * 8 : 92 + env.random() * 8;
          var c = cols[k % cols.length], r = 0.6 + env.random() * 0.9;
          conf += k % 3 ? '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(2) + '" fill="' + c + '"/>' : '<rect x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '" width="' + (r * 2.6).toFixed(2) + '" height="' + (r * 0.9).toFixed(2) + '" fill="' + c + '" transform="rotate(' + Math.round(env.random() * 180) + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')"/>';
        }
        L.push(env.svg({ id: 'confetti', name: 'Confetti', markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ' + (100 * H / W).toFixed(1) + '">' + conf + '</svg>', x: 0, y: 0, w: W, h: H }));
      } else if (style === 'babyshower') {
        var cloud = C.mix(bg, '#FFFFFF', 0.6);
        [[-8, 4, 34, 16], [74, 10, 36, 15], [-10, 100 * H / W - 18, 38, 16], [76, 100 * H / W - 12, 34, 14]].forEach(function (c, i) {
          L.push(env.ellipse({ id: 'cloud', name: 'Cloud', x: c[0] * u, y: c[1] * u, w: c[2] * u, h: c[3] * u, fill: cloud }));
          L.push(env.ellipse({ id: 'cloud', name: 'Cloud', x: (c[0] + c[2] * 0.25) * u, y: (c[1] - c[3] * 0.4) * u, w: c[2] * 0.5 * u, h: c[3] * 0.9 * u, fill: cloud }));
        });
      } else if (style === 'housewarming') {
        L.push(env.rect({ id: 'band', name: 'Band', x: 0, y: 0, w: W, h: 2.4 * u, fill: acc }));
        L.push(env.rect({ id: 'band', name: 'Band', x: 0, y: H - 2.4 * u, w: W, h: 2.4 * u, fill: acc }));
      } else if (style === 'corporate') {
        L.push(env.rect({ id: 'side', name: 'Accent bar', x: 0, y: 0, w: 2.2 * u, h: H, fill: acc }));
      }
      L = L.concat(res.layers);
      page.layers = L;
      return { name: 'Invitation — ' + v.names, pages: [page] };
    }
  });
})();
