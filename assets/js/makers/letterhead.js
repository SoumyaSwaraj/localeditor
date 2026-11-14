/* Quick maker: letterhead on A4 or US Letter, with a matching compliment slip and envelope front as extra pages.
   The recipient's name and address are fields, so Create many addresses one letter per row of a list. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    classic: { ink: '#22201C', muted: '#5F5A52', accent: '#7A5C2E', head: 'Cormorant Garamond', headW: 700, caps: true, body: 'EB Garamond', bodyK: 1.1 },
    modern: { ink: '#15171C', muted: '#5A5F6B', accent: '#2450D8', head: 'Plus Jakarta Sans', headW: 800, body: 'Inter' },
    bold: { ink: '#16131C', muted: '#56525F', accent: '#0F4C5C', head: 'Archivo', headW: 800, body: 'Archivo' },
    minimal: { ink: '#1A1A1A', muted: '#5E5E5E', accent: '#C63D28', head: 'Inter Tight', headW: 700, body: 'Inter' },
    side: { ink: '#1C1B22', muted: '#5C5968', accent: '#5F7650', head: 'Sora', headW: 700, body: 'DM Sans' }
  };
  var LIST = [['name', 'address'],
    ['Ms Amara Okafor', '12 Mill Lane, Leeds LS1 4AB'], ['Mr Daniel Kim', '48 Harbour Road, Bristol BS1 5TT'], ['Dr Fatima Al-Sayed', '3 Orchard Close, Oxford OX2 6HN'],
    ['Mr George Papadopoulos', '27 Castle Street, Edinburgh EH2 3DN'], ['Ms Hye-jin Park', '9 Station Approach, Reading RG1 1LX'], ['Mr Ibrahim Diallo', '61 Park Avenue, Cardiff CF10 3AT'],
    ['Mrs Julia Nowak', '5 Riverside Walk, York YO1 9SL'], ['Mr Kofi Boateng', '110 High Street, Croydon CR0 1ND'], ['Ms Lucía Hernández', '22 Queen’s Gardens, Brighton BN1 4AR'],
    ['Mr Mohammed Rahman', '7 Chapel Lane, Bradford BD1 5DT'], ['Ms Nadia Petrenko', '34 Victoria Terrace, Newcastle upon Tyne NE1 4ST'], ['Professor Oluwaseun Adeyemi-Williams', 'Flat 4, 18 St Andrew’s Square, Glasgow G1 5PP']];
  var SAMPLE_BODY = 'Write your letter here. Tap this paragraph and type, or paste your own words over it.\n\nThe margins suit a standard business letter. Change the size, the font or the spacing like any other text, and add more paragraphs or a signature below.';

  function go(K) {
    M.register({
      id: 'letterhead',
      name: 'Letterhead',
      category: 'Business',
      summary: 'A letterhead with your details, plus a matching compliment slip and envelope front.',
      keywords: ['letterhead', 'letter', 'stationery', 'company paper', 'compliment slip', 'envelope', 'header', 'footer', 'business letter', 'print'],
      sizes: ['a4', 'letter'],
      maxPages: 3,
      inputs: [
        { key: 'company', label: 'Company or name', type: 'text', required: true, max: 50, placeholder: 'Northwind Studio' },
        { key: 'tagline', label: 'Line under the name', type: 'text', max: 60, placeholder: 'Brand and web design' },
        { key: 'address', label: 'Address', type: 'text', max: 100, placeholder: '14 Canal Street, Manchester M1 3HE' },
        { key: 'phone', label: 'Phone', type: 'text', max: 28, placeholder: '+44 20 7946 0101' },
        { key: 'email', label: 'Email', type: 'text', max: 48, placeholder: 'hello@northwind.example' },
        { key: 'site', label: 'Website', type: 'text', max: 48, placeholder: 'northwind.example' },
        { key: 'reg', label: 'Small print', type: 'text', max: 110, placeholder: 'Registered in England and Wales, company number 01234567' },
        { key: 'logo', label: 'Logo', type: 'photo' },
        { key: 'toName', label: 'Recipient', type: 'text', max: 50, placeholder: 'Ms Amara Okafor' },
        { key: 'toAddress', label: 'Recipient’s address', type: 'text', max: 110, placeholder: '12 Mill Lane, Leeds LS1 4AB' },
        { key: 'date', label: 'Date', type: 'date', today: true },
        { key: 'watermark', label: 'Watermark', type: 'toggle', default: false },
        { key: 'slip', label: 'Compliment slip', type: 'toggle', default: false },
        { key: 'envelope', label: 'Envelope front', type: 'toggle', default: false },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'classic', name: 'Classic' }, { id: 'modern', name: 'Modern' }, { id: 'bold', name: 'Bold band' }, { id: 'minimal', name: 'Minimal' }, { id: 'side', name: 'Side bar' }],
      sample: { values: { company: 'Northwind Studio', tagline: 'Brand and web design', address: '14 Canal Street, Manchester M1 3HE', phone: '+44 20 7946 0101', email: 'hello@northwind.example', site: 'northwind.example',
        reg: 'Registered in England and Wales, company number 01234567', toName: 'Ms Amara Okafor', toAddress: '12 Mill Lane, Leeds LS1 4AB', date: '2026-11-12', watermark: false, slip: false, envelope: false } },
      ui: K.many('letterhead', LIST, { toName: 0, toAddress: 1 }),
      build: function (v, env) {
        var C = env.color, mm = env.print.mm, style = env.style, us = env.size.id === 'letter';
        var T = Object.assign({}, S[style] || S.classic);
        if (v.accent) T.accent = v.accent;
        var ink = T.ink, muted = T.muted, acc = C.ensure(T.accent, '#FFFFFF', 4.5), on = C.readable(acc, ['#FFFFFF', ink]), bk = T.bodyK || 1;
        var contacts = [v.address, v.phone, v.email, v.site].filter(Boolean);

        /* Header and footer for a page of W × H px at scale k; returns the layers and the clear area between them. */
        function dress(W, H, k, small) {
          var L = [], u = mm(1) * k, mx = (style === 'side' ? 30 : 22) * u, rx = 22 * u, top = 14 * u, y0, y1 = H - 14 * u;
          function name(al, col, size) {
            return v.logo ? { h: 15 * u, gap: 2 * u, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: al }); } }
              : { id: 'company', name: 'Company', text: v.company, font: T.head, weight: T.headW, size: (size || 6.4) * u, min: 3.2 * u, maxLines: 2, lineHeight: 1.08, uppercase: !!T.caps, tracking: T.caps ? 0.12 : -0.01, color: col || ink, gap: 1.2 * u, input: 'company' };
          }
          function tag(col) { return v.tagline ? { id: 'tagline', name: 'Line under the name', text: v.tagline, font: T.body, weight: 400, italic: style === 'classic', size: 3 * u * bk, min: 2.2 * u, maxLines: 2, color: col || muted, input: 'tagline' } : null; }
          function lines(col, size) { return contacts.map(function (c, i) { return { id: 'contact', name: 'Contact line', text: c, font: T.body, weight: 400, size: (size || 2.75) * u * bk, min: 2 * u, maxLines: 2, lineHeight: 1.3, color: col || muted, gap: 0.5 * u, input: ['address', 'phone', 'email', 'site'][i] }; }); }
          function oneLine(x, y, w, al, col) { return contacts.length ? env.text({ id: 'contact', name: 'Contact line', text: contacts.join('  ·  '), x: x, y: y, w: w, font: T.body, weight: 400, size: 2.75 * u * bk, min: 1.9 * u, maxLines: 2, lineHeight: 1.35, align: al, color: col || muted, balance: true }) : null; }
          function reg(x, y, w, al) { return v.reg && !small ? env.text({ id: 'reg', name: 'Small print', text: v.reg, x: x, y: y, w: w, font: T.body, weight: 400, size: 2.2 * u * bk, min: 1.8 * u, maxLines: 2, align: al, color: muted }) : null; }
          var cw = W - mx - rx, st, a, b2;
          if (style === 'classic') {
            st = K.stack(env, { x: mx, y: top, w: cw, h: 26 * u }, [name('center'), tag()], { align: 'center', valign: 'top' });
            L = L.concat(st.layers);
            y0 = st.bottom + 5 * u;
            L.push(env.line({ id: 'rule', name: 'Rule', x: mx, y: y0, w: cw, width: Math.max(2, 0.3 * u), color: acc }), env.line({ id: 'rule', name: 'Rule', x: mx, y: y0 + 1 * u, w: cw, width: Math.max(1, 0.1 * u), color: acc }));
            y0 += 1 * u;
            b2 = reg(mx, 0, cw, 'center'); a = oneLine(mx, 0, cw, 'center');
            env.place([a, b2].filter(Boolean).map(function (l, i, arr) { if (i) l.y = arr[0].y + arr[0].h + 0.8 * u; return l; }), { x: mx, y: 0, w: cw, h: y1 }, 'bottom');
            if (a) { L.push(env.line({ id: 'rule', name: 'Rule', x: W / 2 - 12 * u, y: a.y - 3.2 * u, w: 24 * u, width: Math.max(1, 0.12 * u), color: acc })); y1 = a.y - 3.2 * u; }
            L.push(a, b2);
          } else if (style === 'modern') {
            st = K.stack(env, { x: mx, y: top, w: cw * 0.56, h: 28 * u }, [name('left'), tag()], { align: 'left', valign: 'top' });
            a = K.stack(env, { x: mx + cw * 0.6, y: top + 0.6 * u, w: cw * 0.4, h: 30 * u }, lines(), { align: 'right', valign: 'top' });
            L = L.concat(st.layers, a.layers);
            y0 = Math.max(st.bottom, a.bottom) + 5 * u;
            L.push(env.rect({ id: 'rule', name: 'Accent line', x: mx, y: y0, w: 16 * u, h: 0.8 * u, fill: acc }));
            b2 = reg(mx, 0, cw, 'left');
            if (b2) { env.place([b2], { x: mx, y: 0, w: cw, h: y1 }, 'bottom'); L.push(b2); y1 = b2.y - 3 * u; }
          } else if (style === 'bold') {
            var bh = 36 * u;
            L.push(env.rect({ id: 'band', name: 'Colour band', x: 0, y: 0, w: W, h: bh, fill: acc }));
            L = L.concat(K.stack(env, { x: mx, y: 7 * u, w: cw * 0.56, h: bh - 14 * u }, [name('left', on, 7), tag(on)], { align: 'left', valign: 'middle' }).layers);
            L = L.concat(K.stack(env, { x: mx + cw * 0.6, y: 7 * u, w: cw * 0.4, h: bh - 14 * u }, lines(on, 2.6), { align: 'right', valign: 'middle' }).layers);
            y0 = bh;
            L.push(env.rect({ id: 'strip', name: 'Colour strip', x: 0, y: H - 5 * u, w: W, h: 5 * u, fill: acc }));
            b2 = reg(mx, 0, cw, 'left');
            y1 = H - 10 * u;
            if (b2) { env.place([b2], { x: mx, y: 0, w: cw, h: y1 }, 'bottom'); L.push(b2); y1 = b2.y - 3 * u; }
          } else if (style === 'minimal') {
            L.push(env.rect({ id: 'mark', name: 'Accent mark', x: mx, y: top, w: 7 * u, h: 1 * u, fill: acc }));
            st = K.stack(env, { x: mx, y: top + 4 * u, w: cw, h: 24 * u }, [name('left', ink, 4.6), tag()], { align: 'left', valign: 'top' });
            L = L.concat(st.layers);
            y0 = st.bottom + 2 * u;
            b2 = reg(mx, 0, cw, 'left'); a = oneLine(mx, 0, cw, 'left');
            env.place([a, b2].filter(Boolean).map(function (l, i, arr) { if (i) l.y = arr[0].y + arr[0].h + 0.8 * u; return l; }), { x: mx, y: 0, w: cw, h: y1 }, 'bottom');
            L.push(a, b2);
            if (a || b2) y1 = (a || b2).y - 4 * u;
          } else {
            L.push(env.rect({ id: 'bar', name: 'Side bar', x: 0, y: 0, w: 14 * u, h: H, fill: acc }));
            st = K.stack(env, { x: mx, y: top, w: cw, h: 26 * u }, [name('left', ink, 6), tag(acc)], { align: 'left', valign: 'top' });
            L = L.concat(st.layers);
            y0 = st.bottom + 3 * u;
            a = K.stack(env, { x: mx, y: 0, w: cw, h: y1 }, (small ? [] : lines()).concat(v.reg && !small ? [{ id: 'reg', name: 'Small print', text: v.reg, font: T.body, weight: 400, size: 2.2 * u * bk, min: 1.8 * u, maxLines: 2, color: muted, gap: 0 }] : []), { align: 'left', valign: 'bottom' });
            if (small) { b2 = oneLine(mx, 0, cw, 'left'); if (b2) { env.place([b2], { x: mx, y: 0, w: cw, h: y1 }, 'bottom'); L.push(b2); y1 = b2.y - 3 * u; } }
            L = L.concat(a.layers);
            if (a.layers.length) y1 = a.top - 4 * u;
          }
          return { layers: L.filter(Boolean), x: mx, w: cw, y0: y0, y1: y1, u: u };
        }

        var W = env.W, H = env.H, page = env.page('#FFFFFF'), D = dress(W, H, 1), u = D.u, vals = {}, L = [];
        if (v.watermark) {
          var wd = Math.min(W, H) * 0.56;
          if (v.logo) { var wl = K.logo(env, v.logo, { x: (W - wd) / 2, y: (H - wd) / 2, w: wd, h: wd }, { align: 'center', id: 'watermark', name: 'Watermark' }); wl.opacity = 0.07; L.push(wl); }
          else L.push(env.svg({ id: 'watermark', name: 'Watermark', x: (W - wd) / 2, y: H * 0.58 - wd / 2, w: wd, h: wd, opacity: 0.06,
            markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="none" stroke="' + acc + '" stroke-width="2"/><circle cx="50" cy="50" r="41" fill="none" stroke="' + acc + '" stroke-width="0.8"/><circle cx="50" cy="50" r="27" fill="none" stroke="' + acc + '" stroke-width="5"/><circle cx="50" cy="50" r="9" fill="' + acc + '"/></svg>' }));
        }
        L = L.concat(D.layers);
        var body = [
          v.date ? { id: 'date', name: 'Date', text: env.date.format(v.date, 'D MMMM YYYY'), font: T.body, weight: 400, size: 3.9 * u * bk, min: 3 * u, maxLines: 1, color: ink, gap: 8 * u } : null,
          v.toName ? { id: 'to-name', name: 'Recipient', text: v.toName, font: T.body, weight: 700, size: 3.9 * u * bk, min: 2.8 * u, maxLines: 1, color: ink, gap: 0.8 * u, field: 'name', w: D.w * 0.6 } : null,
          v.toAddress ? { id: 'to-address', name: 'Recipient’s address', text: v.toAddress, font: T.body, weight: 400, size: 3.9 * u * bk, min: 2.8 * u, maxLines: 4, lineHeight: 1.4, color: ink, gap: 0, field: 'address', fallback: true, w: D.w * 0.5 } : null,
          v.toName || v.toAddress ? { h: 9 * u, make: function () { return null; } } : null,
          { id: 'greeting', name: 'Greeting', text: 'Dear ' + (v.toName || 'reader') + ',', font: T.body, weight: 400, size: 3.9 * u * bk, min: 2.8 * u, maxLines: 1, color: ink, gap: 5 * u, w: D.w * 0.8 },
          { id: 'body', name: 'Your letter', text: SAMPLE_BODY, font: T.body, weight: 400, size: 3.9 * u * bk, min: 3.2 * u, maxLines: 14, lineHeight: 1.55, color: C.ensure('#737780', '#FFFFFF', 4.6), gap: 7 * u, w: Math.min(D.w, 150 * u) },
          { id: 'closing', name: 'Closing', text: 'Yours sincerely,', font: T.body, weight: 400, size: 3.9 * u * bk, min: 2.8 * u, maxLines: 1, color: ink }
        ];
        var st = K.stack(env, { x: D.x, y: D.y0 + 14 * u, w: D.w, h: D.y1 - D.y0 - 20 * u }, body, { align: 'left', valign: 'top', values: vals });
        st.layers.forEach(function (l) { if (l.id === 'greeting' && v.toName) { l.text = 'Dear {{name}},'; l.overflow = 'shrink'; l.minSize = Math.round(l.size * 0.7); } });
        page.layers = L.concat(st.layers);
        page.values = vals;
        var pages = [page];

        if (v.slip) {
          var sw = us ? 215.9 : 210, sh = us ? 93.1 : 99, sp = env.page('#FFFFFF', { w: K.px(sw), h: K.px(sh), print: { paper: 'slip', w: sw, h: sh, dpi: 300 } });
          var SD = dress(sp.width, sp.height, 0.72, true);
          var wc = env.text({ id: 'compliments', name: 'With compliments', text: 'With compliments', x: SD.x, y: SD.y0, w: SD.w, h: Math.max(mm(8), SD.y1 - SD.y0), font: T.head, weight: T.caps ? 700 : T.headW, italic: style === 'classic', size: mm(5.4), min: mm(3),
            maxLines: 1, align: style === 'classic' ? 'center' : 'left', valign: 'middle', color: acc });
          sp.layers = SD.layers.concat([wc]);
          pages.push(sp);
        }
        if (v.envelope) {
          var ew = us ? 241.3 : 220, eh = us ? 104.8 : 110, ep = env.page('#FFFFFF', { w: K.px(ew), h: K.px(eh), print: { paper: us ? 'envelope-10' : 'envelope-dl', w: ew, h: eh, dpi: 300 } });
          var EW = ep.width, EH = ep.height, ev = {}, m1 = mm(1);
          var ret = K.stack(env, { x: 12 * m1, y: 11 * m1, w: EW * 0.42, h: 30 * m1 }, [
            v.logo ? { h: 9 * m1, gap: 1.6 * m1, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: 'left' }); } }
              : { id: 'company', name: 'Company', text: v.company, font: T.head, weight: T.headW, size: 3.6 * m1, min: 2.4 * m1, maxLines: 2, uppercase: !!T.caps, tracking: T.caps ? 0.12 : 0, color: acc, gap: 1 * m1 },
            v.address ? { id: 'return', name: 'Return address', text: v.address, font: T.body, weight: 400, size: 2.6 * m1 * bk, min: 2 * m1, maxLines: 3, lineHeight: 1.3, color: muted } : null
          ], { align: 'left', valign: 'top' });
          var to = K.stack(env, { x: EW * 0.4, y: EH * 0.44, w: EW * 0.5, h: EH * 0.44 }, [
            { id: 'to-name', name: 'Recipient', text: v.toName || 'Recipient’s name', font: T.body, weight: 700, size: 4.4 * m1 * bk, min: 3 * m1, maxLines: 2, color: ink, gap: 1 * m1, field: 'name' },
            { id: 'to-address', name: 'Recipient’s address', text: v.toAddress || 'Street, town and postcode', font: T.body, weight: 400, size: 4.1 * m1 * bk, min: 2.8 * m1, maxLines: 4, lineHeight: 1.4, color: ink, field: 'address', fallback: true }
          ], { align: 'left', valign: 'top', values: ev });
          ep.layers = ret.layers.concat(to.layers, env.print.cutMarks({ name: 'Stamp guide', id: 'stamp-guide', outlines: [{ x: EW - 34 * m1, y: 10 * m1, w: 22 * m1, h: 26 * m1 }] }));
          if (style === 'bold' || style === 'side') ep.layers.unshift(env.rect({ id: 'bar', name: 'Colour strip', x: 0, y: EH - 4 * m1, w: EW, h: 4 * m1, fill: acc }));
          ep.values = ev;
          pages.push(ep);
        }
        return { name: 'Letterhead — ' + v.company, pages: pages };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
