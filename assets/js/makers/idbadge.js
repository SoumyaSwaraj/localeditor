/* Quick maker: ID badges for staff, visitors, students and events. CR80 card and lanyard sizes, a slot punch guide,
   an optional back and print sheets. Name, role, ID number (also the QR code) and the photo are fields, so Create many
   makes one badge per row with photos matched by file name. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var KIND = { staff: ['Staff', '#1F5FBF'], visitor: ['Visitor', '#C96A12'], student: ['Student', '#23805A'], event: ['Attendee', '#6C45C4'] };
  var S = {
    clean: { bg: '#FFFFFF', ink: '#16181D', muted: '#555A65', head: 'Inter Tight', headW: 700, body: 'Inter' },
    band: { bg: '#FFFFFF', ink: '#14171F', muted: '#535864', head: 'Plus Jakarta Sans', headW: 800, body: 'Plus Jakarta Sans' },
    dark: { bg: '#15171C', ink: '#F4F2EC', muted: '#C3C0B8', head: 'Sora', headW: 700, body: 'Inter', dark: true },
    soft: { bg: '#FFFFFF', ink: '#2A2733', muted: '#5F5A6C', head: 'Nunito', headW: 800, body: 'Nunito', soft: true },
    bold: { bg: '#FFFFFF', ink: '#111111', muted: '#3C3C3C', head: 'Archivo Black', headW: 400, body: 'Archivo', nameK: 0.88 }
  };
  var LIST = [['name', 'role', 'id', 'photo'],
    ['Amara Okafor', 'Nurse', 'NW-00412', 'amara.jpg'], ['Daniel Kim', 'Reception', 'NW-00413', 'daniel.jpg'], ['Fatima Al-Sayed', 'Pharmacist', 'NW-00414', 'fatima.jpg'],
    ['George Papadopoulos', 'Facilities', 'NW-00415', 'george.jpg'], ['Hye-jin Park', 'Radiographer', 'NW-00416', 'hyejin.jpg'], ['Ibrahim Diallo', 'Porter', 'NW-00417', 'ibrahim.jpg'],
    ['Julia Nowak', 'Physiotherapist', 'NW-00418', 'julia.jpg'], ['Kofi Boateng', 'Security', 'NW-00419', 'kofi.jpg'], ['Lucía Hernández', 'Midwife', 'NW-00420', 'lucia.jpg'],
    ['Mohammed Rahman', 'IT Support', 'NW-00421', 'mohammed.jpg'], ['Nadia Petrenko', 'Administrator', 'NW-00422', 'nadia.jpg'], ['Oluwaseun Adeyemi-Williams', 'Consultant Anaesthetist', 'NW-00423', 'oluwaseun.jpg']];

  function go(K) {
    M.register({
      id: 'idbadge',
      name: 'ID badge',
      category: 'Business',
      summary: 'Staff, visitor, student and event badges with a photo, an ID code and a print sheet.',
      keywords: ['id badge', 'id card', 'staff badge', 'visitor pass', 'student card', 'event badge', 'lanyard', 'name badge', 'cr80', 'photo id', 'pass'],
      sizes: [K.size('cr80-tall', 'Card tall', 54, 85.6), K.size('cr80-wide', 'Card wide', 85.6, 54), K.size('lanyard-a6', 'Lanyard A6', 105, 148), K.size('lanyard-4x3', 'Lanyard 4×3', 101.6, 76.2)],
      maxPages: 4,
      inputs: [
        { key: 'kind', label: 'Badge for', type: 'choice', default: 'staff', options: [{ id: 'staff', name: 'Staff' }, { id: 'visitor', name: 'Visitor' }, { id: 'student', name: 'Student' }, { id: 'event', name: 'Event' }] },
        { key: 'org', label: 'Organisation or event', type: 'text', max: 40, placeholder: 'Northwind Clinic' },
        { key: 'name', label: 'Name', type: 'text', required: true, max: 40, placeholder: 'Amara Okafor' },
        { key: 'role', label: 'Role, class or company', type: 'text', max: 40, placeholder: 'Nurse' },
        { key: 'idno', label: 'ID number', type: 'text', max: 24, placeholder: 'NW-00412' },
        { key: 'valid', label: 'Valid until', type: 'text', max: 28, placeholder: '31 December 2027' },
        { key: 'photo', label: 'Photo', type: 'photo' },
        { key: 'logo', label: 'Logo', type: 'photo' },
        { key: 'code', label: 'ID number as a QR code', type: 'toggle', default: true },
        { key: 'slot', label: 'Slot punch guide', type: 'toggle', default: true, hint: 'A dashed outline where the lanyard slot goes. Turn off for card printers.' },
        { key: 'back', label: 'Back side', type: 'toggle', default: false },
        { key: 'backtext', label: 'Words for the back', type: 'longtext', max: 220, maxLines: 5, placeholder: 'This badge stays the property of the organisation. If found, please return it to reception.' },
        { key: 'paper', label: 'Print sheet', type: 'choice', default: 'none', options: [{ id: 'none', name: 'None' }, { id: 'a4', name: 'A4' }, { id: 'letter', name: 'US Letter' }] },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'clean', name: 'Clean' }, { id: 'band', name: 'Colour band' }, { id: 'dark', name: 'Dark' }, { id: 'soft', name: 'Soft' }, { id: 'bold', name: 'Bold' }],
      sample: { values: { kind: 'staff', org: 'Northwind Clinic', name: 'Amara Okafor', role: 'Nurse', idno: 'NW-00412', valid: '31 December 2027', photo: 'sample:people-03', code: true, slot: true, back: false, paper: 'none' } },
      ui: K.many('idbadge', LIST),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, mm = env.print.mm, style = env.style;
        var T = Object.assign({}, S[style] || S.clean), kind = KIND[v.kind] || KIND.staff;
        var accent = v.accent || kind[1], tall = H > W;
        var u = mm(1) * (tall ? Math.min(W / mm(54), H / mm(85.6)) : Math.min(W / mm(85.6), H / mm(54)));
        var bg = style === 'soft' ? C.mix(accent, '#FFFFFF', 0.9) : T.bg, ink = T.ink, muted = C.readable(bg, [T.muted, ink]);
        var acc = C.ensure(accent, bg, 4.5), on = C.readable(acc, ['#FFFFFF', '#111111']);
        var pad = 5 * u, nk = T.nameK || 1, label = kind[0];

        function front(vals) {
          var L = [], footH = 8 * u, slotH = v.slot === false ? 4 * u : 9.5 * u;
          var headOn = style === 'band' || style === 'bold';
          /* Blocks of colour, then the footer strip that says who the holder is. */
          if (style === 'band') L.push(env.rect({ id: 'band', name: 'Colour band', x: 0, y: 0, w: W, h: tall ? H * 0.36 : 13 * u, fill: acc }));
          if (style === 'bold') L.push(env.rect({ id: 'band', name: 'Colour block', x: 0, y: 0, w: tall ? W : W * 0.36, h: tall ? H * 0.44 : H, fill: acc }));
          if (style === 'dark') L.push(env.rect({ id: 'band', name: 'Accent line', x: 0, y: 0, w: W, h: 1.6 * u, fill: acc }));
          L.push(env.rect({ id: 'foot', name: 'Footer', x: 0, y: H - footH, w: W, h: footH, fill: style === 'bold' ? ink : acc }));
          var footInk = style === 'bold' ? C.readable(ink, ['#FFFFFF']) : on;
          L.push(env.text({ id: 'kind', name: 'Badge type', text: label, x: pad, y: H - footH, w: W - 2 * pad, h: footH, font: T.head, weight: T.headW, size: 3.3 * u, min: 2 * u, maxLines: 1, uppercase: true, tracking: 0.2, align: tall ? 'center' : 'left', valign: 'middle', color: footInk }));

          var orgInk = style === 'band' || (style === 'bold' && tall) ? on : acc, pw, ph, px, py, box, q = v.code !== false && v.idno ? (tall ? 15.5 : 13.5) * u : 0;
          function brand(al) {
            return v.logo ? { h: 8 * u, gap: 2.6 * u, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: al }); } }
              : v.org ? { id: 'org', name: 'Organisation', text: v.org, font: T.head, weight: T.headW, size: 3.1 * u, min: 2 * u, maxLines: 2, lineHeight: 1.1, color: orgInk, gap: 2.8 * u, input: 'org' } : null;
          }
          function photo(x, y, w, h) {
            var p = env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: x, y: y, w: w, h: h, label: 'Photo', mask: T.soft ? 'ellipse' : 'none', radius: T.soft ? 0 : 1.6 * u,
              border: headOn || T.soft ? { width: 0.9 * u, color: '#FFFFFF' } : null });
            return K.bind(p, 'photo', 'cover');
          }
          function who(al) {
            return [
              { id: 'name', name: 'Name', text: v.name, font: T.head, weight: T.headW, size: 5.2 * u * nk, min: 2.9 * u, maxLines: 2, lineHeight: 1.08, color: ink, gap: 1 * u, field: 'name', input: 'name' },
              v.role ? { id: 'role', name: 'Role', text: v.role, font: T.body, weight: 400, size: 3 * u, min: 2.1 * u, maxLines: 2, lineHeight: 1.2, color: muted, field: 'role', fallback: true, input: 'role' } : null
            ];
          }
          /* ID number and validity beside the code, along the bottom. */
          function details(x, y, w, h, al) {
            var out = [], tw = q ? w - q - 2.5 * u : w, tx = al === 'right' || !q ? x : x, rows = [];
            if (v.idno) rows.push(['id-label', 'ID', null], ['id', v.idno, 'id']);
            if (v.valid) rows.push(['valid-label', 'Valid until', null], ['valid', v.valid, null]);
            var yy = 0, made = [];
            rows.forEach(function (r) {
              var lab = /label/.test(r[0]);
              var l = env.text({ id: r[0], name: lab ? r[1] + ' label' : r[0] === 'id' ? 'ID number' : 'Valid until', text: r[1], x: tx, y: yy, w: tw, font: lab ? T.body : r[0] === 'id' ? 'JetBrains Mono' : T.body, weight: 700,
                size: (lab ? 1.75 : 2.6) * u, min: (lab ? 1.5 : 1.8) * u, maxLines: 1, uppercase: lab, tracking: lab ? 0.14 : 0, color: lab ? muted : ink });
              if (r[2]) K.field(l, r[2], vals, { min: 1.6 * u });
              made.push(l);
              yy += l.h + (lab ? 0.15 : 1.1) * u;
            });
            env.place(made, { x: x, y: y, w: w, h: h }, 'bottom');
            out = out.concat(made);
            if (q) out = out.concat(K.qrTile(env, v.idno, x + w - q, y + h - q, q, { key: 'id', stroke: C.mix(bg, ink, 0.2) }));
            return out;
          }
          var detH = Math.max(q, (v.idno ? 5.2 : 0) * u + (v.valid ? 5.2 : 0) * u);
          if (tall) {
            box = { x: pad, y: slotH, w: W - 2 * pad, h: H - footH - slotH - 3.4 * u };
            pw = 25 * u; ph = 31 * u;
            var top = K.stack(env, { x: box.x, y: box.y, w: box.w, h: 12 * u }, [brand('center')], { align: 'center', valign: 'top' });
            L = L.concat(top.layers);
            py = top.layers.length ? top.bottom + 2.6 * u : box.y + 1 * u;
            var avail = box.y + box.h - detH - py;
            if (avail < ph + 16 * u) { ph = Math.max(18 * u, avail - 16 * u); pw = ph * 0.81; }
            L.push(photo((W - pw) / 2, py, pw, ph));
            L = L.concat(K.stack(env, { x: box.x, y: py + ph + 2.6 * u, w: box.w, h: box.y + box.h - detH - 2.4 * u - (py + ph + 2.6 * u) }, who('center'), { align: 'center', valign: 'top', values: vals }).layers);
            if (detH) L = L.concat(details(box.x, box.y + box.h - detH, box.w, detH));
          } else {
            var bold = style === 'bold', colW = bold ? W * 0.36 : 0;
            pw = 23 * u; ph = 28.5 * u;
            if (bold) { px = (colW - pw) / 2; py = (H - footH - ph) / 2 + 2 * u; }
            else { px = pad; py = slotH + (style === 'band' ? 4.5 : 3.5) * u; ph = Math.min(ph, H - footH - py - 3 * u); pw = ph * 0.81; }
            L.push(photo(px, py, pw, ph));
            var tx = bold ? colW + pad : px + pw + 4.5 * u, ty = bold ? slotH : (style === 'band' ? 13 * u + 2.6 * u : slotH + 1 * u);
            box = { x: tx, y: ty, w: W - pad - tx, h: H - footH - 3 * u - ty };
            if (style === 'band') L = L.concat(K.stack(env, { x: px, y: slotH - 2.4 * u, w: W - px - pad, h: 13 * u - slotH + 1.4 * u }, [Object.assign({}, brand('left') || {}, { gap: 0 })].filter(function (i) { return i.make || i.text; }), { align: 'left', valign: 'middle' }).layers);
            var items = (style === 'band' ? [] : [brand('left')]).concat(who('left'));
            L = L.concat(K.stack(env, { x: box.x, y: box.y, w: box.w, h: box.h - detH - 2 * u }, items, { align: 'left', valign: 'top', values: vals }).layers);
            if (detH) L = L.concat(details(box.x, box.y + box.h - detH, box.w, detH));
          }
          return L;
        }
        function back(vals) {
          var L = [], items = [
            v.logo ? { h: 9 * u, gap: 3 * u, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: 'center' }); } }
              : v.org ? { id: 'org', name: 'Organisation', text: v.org, font: T.head, weight: T.headW, size: 3.6 * u, min: 2.2 * u, maxLines: 2, color: acc, gap: 3 * u } : null,
            { id: 'backtext', name: 'Words for the back', text: v.backtext || 'If found, please return this badge to ' + (v.org || 'the address below') + '.', font: T.body, weight: 400, size: 2.6 * u, min: 1.9 * u, maxLines: 8, lineHeight: 1.4, color: ink, gap: 4 * u, w: W - 2 * pad - 4 * u, input: 'backtext' },
            { h: 8 * u, gap: 1 * u, make: function (x, y, w, h) { var lw = Math.min(w, 44 * u); return env.line({ id: 'sign-line', name: 'Signature line', x: x + (w - lw) / 2, y: y + h, w: lw, width: Math.max(2, 0.18 * u), color: muted }); } },
            { id: 'sign-label', name: 'Signature label', text: 'Holder’s signature', font: T.body, weight: 700, size: 1.8 * u, min: 1.5 * u, maxLines: 1, uppercase: true, tracking: 0.14, color: muted }
          ];
          L.push(env.rect({ id: 'foot', name: 'Footer', x: 0, y: H - 3 * u, w: W, h: 3 * u, fill: acc }));
          return L.concat(K.stack(env, { x: pad, y: 10 * u, w: W - 2 * pad, h: H - 18 * u }, items, { align: 'center', valign: 'middle', values: vals }).layers);
        }
        function slot() {
          if (v.slot === false) return [];
          var sw = 14 * u, sh = 3 * u;
          return env.print.cutMarks({ name: 'Slot punch guide', id: 'slot-guide', color: C.readable(style === 'band' || (style === 'bold' && tall) ? acc : bg, ['#6B6875', '#FFFFFF']), outlines: [{ x: (W - sw) / 2, y: 4 * u, w: sw, h: sh, radius: sh / 2 }] });
        }

        var fv = {}, bv = {}, F = front(fv), p1 = env.page(bg), pages = [p1], B = null;
        p1.layers = F.concat(slot());
        p1.values = fv;
        if (v.back) { B = back(bv); var p2 = env.page(bg); p2.layers = B.concat(slot()); p2.values = bv; pages.push(p2); }
        if (v.paper === 'a4' || v.paper === 'letter') {
          [[F, fv, false], B ? [B, bv, true] : null].filter(Boolean).forEach(function (side) {
            var src = [env.rect({ id: 'card-bg', name: 'Badge', x: 0, y: 0, w: W, h: H, fill: bg, stroke: { width: Math.max(1.5, mm(0.1)), color: C.mix(bg, ink, 0.25) } })].concat(side[0], slot());
            var pg = K.sheet(env, { paper: v.paper, trim: { w: W, h: H }, bleed: 0, gap: mm(4), back: side[2], duplex: !!B, title: 'ID badges', draw: function (x, y, i) { return K.copy(src, x, y, i + 1).concat(K.copy(src.filter(function (l) { return l.groupId; }).map(function (l) { var c = Object.assign({}, l); delete c.groupId; return c; }), x, y, 'g' + (i + 1))); } });
            pg.values = side[1];
            pages.push(pg);
          });
        }
        return { name: 'ID badge — ' + v.name, pages: pages };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
