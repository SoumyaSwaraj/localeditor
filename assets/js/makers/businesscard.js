/* Quick maker: business cards. Front and back as two pages with 3 mm (0.125 in) bleed and crop marks, an optional QR
   contact card, and print sheets that register when printed on both sides. Name, role, phone and email are fields. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    minimal: { bg: '#FFFFFF', ink: '#15171C', muted: '#555B66', accent: '#2450D8', head: 'Inter Tight', headW: 700, body: 'Inter', back: 'accent' },
    split: { bg: '#FFFFFF', ink: '#14232B', muted: '#4C5A62', accent: '#0F4C5C', head: 'Plus Jakarta Sans', headW: 700, body: 'Plus Jakarta Sans', back: 'accent' },
    monogram: { bg: '#F7F3EC', ink: '#2B2622', muted: '#5E554C', accent: '#8A5A2B', head: 'Playfair Display', headW: 700, body: 'Lato', back: 'ink' },
    photo: { bg: '#FFFFFF', ink: '#1B1B1F', muted: '#56565E', accent: '#C63D28', head: 'DM Sans', headW: 700, body: 'DM Sans', back: 'ink' },
    centred: { bg: '#FFFFFF', ink: '#23262B', muted: '#5A5F66', accent: '#5F7650', head: 'Cormorant Garamond', headW: 700, nameK: 1.28, body: 'Jost', roleCaps: true, back: 'accent' },
    dark: { bg: '#16171C', ink: '#F3EFE7', muted: '#C4BFB4', accent: '#D2AB62', head: 'Sora', headW: 600, nameK: 0.94, body: 'Inter', back: 'bg' },
    stripe: { bg: '#FFFFFF', ink: '#191B22', muted: '#565A66', accent: '#F2B441', head: 'Archivo', headW: 700, body: 'Archivo', roleCaps: true, back: 'accent' },
    qr: { bg: '#FFFFFF', ink: '#101114', muted: '#54575F', accent: '#1E8E6A', head: 'Space Grotesk', headW: 700, body: 'Space Grotesk', back: 'ink' }
  };
  var LIST = [['name', 'role', 'phone', 'email', 'qr'],
    ['Priya Nair', 'Founder', '+44 20 7946 0101', 'priya@northwind.example', 'https://northwind.example/priya'], ['Daniel Okoye', 'Head of Design', '+44 20 7946 0102', 'daniel@northwind.example', 'https://northwind.example/daniel'],
    ['Hannah Schmidt', 'Operations Manager', '+44 20 7946 0103', 'hannah@northwind.example', 'https://northwind.example/hannah'], ['Rafael Costa', 'Account Director', '+44 20 7946 0104', 'rafael@northwind.example', 'https://northwind.example/rafael'],
    ['Aiko Sato', 'Senior Engineer', '+44 20 7946 0105', 'aiko@northwind.example', 'https://northwind.example/aiko'], ['Omar Haddad', 'Sales Lead', '+44 20 7946 0106', 'omar@northwind.example', 'https://northwind.example/omar'],
    ['Grace Mwangi', 'Finance Manager', '+44 20 7946 0107', 'grace@northwind.example', 'https://northwind.example/grace'], ['Lukas Novak', 'Product Manager', '+44 20 7946 0108', 'lukas@northwind.example', 'https://northwind.example/lukas'],
    ['Chloé Laurent', 'Marketing Manager', '+44 20 7946 0109', 'chloe@northwind.example', 'https://northwind.example/chloe'], ['Arjun Mehta', 'Customer Success', '+44 20 7946 0110', 'arjun@northwind.example', 'https://northwind.example/arjun'],
    ['Sinéad O’Connor-Fitzgerald', 'Chief Technology Officer', '+44 20 7946 0111', 'sinead@northwind.example', 'https://northwind.example/sinead'], ['Bo Li', 'Intern', '+44 20 7946 0112', 'bo@northwind.example', 'https://northwind.example/bo']];
  /* What the code holds: the contact card, the website, or nothing. Pure, so tests can assert it. */
  function payload(v, kit) {
    v = v || {};
    if (v.qr === 'none') return '';
    if (v.qr === 'site') return kit.link(v.site);
    return kit.vcard(v);
  }

  function go(K) {
    M.cardPayload = function (v) { return payload(v, K); };
    M.register({
      id: 'businesscard',
      name: 'Business card',
      category: 'Business',
      summary: 'Front and back with bleed and crop marks, a QR contact card, and a print sheet.',
      keywords: ['business card', 'visiting card', 'name card', 'contact card', 'vcard', 'qr', 'bleed', 'print', 'card', 'networking'],
      sizes: [K.size('card-85x55', '85×55', 85, 55, 3), K.size('card-us', '3.5×2 in', 88.9, 50.8, 3.175), K.size('card-90x54', '90×54', 90, 54, 3), K.size('card-square', 'Square', 65, 65, 3), K.size('card-tall', 'Tall', 55, 85, 3)],
      maxPages: 4,
      inputs: [
        { key: 'name', label: 'Name', type: 'text', required: true, max: 40, placeholder: 'Priya Nair' },
        { key: 'role', label: 'Role', type: 'text', max: 44, placeholder: 'Founder' },
        { key: 'company', label: 'Company', type: 'text', max: 40, placeholder: 'Northwind Studio' },
        { key: 'phone', label: 'Phone', type: 'text', max: 28, placeholder: '+44 20 7946 0101' },
        { key: 'email', label: 'Email', type: 'text', max: 48, placeholder: 'priya@northwind.example' },
        { key: 'site', label: 'Website', type: 'text', max: 48, placeholder: 'northwind.example' },
        { key: 'address', label: 'Address', type: 'text', max: 80, placeholder: '14 Canal Street, Manchester M1 3HE' },
        { key: 'tagline', label: 'Line for the back', type: 'text', max: 60, placeholder: 'Brand and web design' },
        { key: 'logo', label: 'Logo', type: 'photo' },
        { key: 'photo', label: 'Photo', type: 'photo', hint: 'Used by the Photo style.' },
        { key: 'qr', label: 'QR code', type: 'choice', default: 'vcard', options: [{ id: 'vcard', name: 'Contact card' }, { id: 'site', name: 'Website' }, { id: 'none', name: 'None' }], hint: 'A contact card saves your details to a phone. It goes on the back.' },
        { key: 'guides', label: 'Trim and safe-area guides', type: 'toggle', default: false, hint: 'Dashed lines for checking. Turn off before you print.' },
        { key: 'paper', label: 'Print sheets', type: 'choice', default: 'none', options: [{ id: 'none', name: 'None' }, { id: 'a4', name: 'A4' }, { id: 'letter', name: 'US Letter' }], hint: 'Adds a sheet of fronts and a sheet of backs with cut marks, for printing on both sides.' },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'minimal', name: 'Minimal' }, { id: 'split', name: 'Split colour' }, { id: 'monogram', name: 'Monogram' }, { id: 'photo', name: 'Photo' },
        { id: 'centred', name: 'Centred' }, { id: 'dark', name: 'Dark' }, { id: 'stripe', name: 'Side stripe' }, { id: 'qr', name: 'Large QR' }],
      sample: { values: { name: 'Priya Nair', role: 'Founder', company: 'Northwind Studio', phone: '+44 20 7946 0101', email: 'priya@northwind.example', site: 'northwind.example',
        address: '14 Canal Street, Manchester M1 3HE', tagline: 'Brand and web design', photo: 'sample:people-03', qr: 'vcard', paper: 'none' } },
      ui: K.many('businesscard', LIST),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, mm = env.print.mm, style = env.style;
        var T = Object.assign({}, S[style] || S.minimal);
        if (v.accent) T.accent = v.accent;
        var b = mm(env.size.id === 'card-us' ? 3.175 : 3), tw = W - 2 * b, th = H - 2 * b;
        var wide = tw > th * 1.2, pad = mm(5);
        var inner = { x: b + pad, y: b + pad, w: tw - 2 * pad, h: th - 2 * pad };
        var code = payload(v, K), nk = T.nameK || 1;

        function ident(ink, acc, kicker) {
          return [
            kicker && v.company && !v.logo ? { id: 'company', name: 'Company', text: v.company, font: T.body, weight: 700, size: mm(2.3), min: mm(1.8), maxLines: 2, uppercase: true, tracking: 0.14, color: acc, gap: mm(1.6), input: 'company' } : null,
            { id: 'name', name: 'Name', text: v.name, font: T.head, weight: T.headW, size: mm(4.7 * nk), min: mm(2.9), maxLines: 2, lineHeight: 1.08, tracking: -0.005, color: ink, gap: mm(0.9), field: 'name', input: 'name' },
            v.role ? { id: 'role', name: 'Role', text: v.role, font: T.body, weight: T.roleCaps ? 700 : 400, size: mm(T.roleCaps ? 2.25 : 2.7), min: mm(1.8), maxLines: 2, uppercase: !!T.roleCaps, tracking: T.roleCaps ? 0.14 : 0, color: acc, field: 'role', fallback: true, input: 'role' } : null
          ];
        }
        function contact(ink) {
          return [['phone', 'Phone', v.phone, 1], ['email', 'Email', v.email, 1], ['site', 'Website', v.site, 0], ['address', 'Address', v.address, 0]].map(function (r) {
            return r[2] ? { id: r[0], name: r[1], text: r[2], font: T.body, weight: 400, size: mm(2.5), min: mm(1.9), maxLines: r[0] === 'address' ? 2 : 1, balance: r[0] === 'address', lineHeight: 1.28, color: ink, gap: mm(0.5),
              field: r[3] ? r[0] : null, fallback: true, input: r[0] } : null;
          });
        }
        function brand(ink, hmm, big) {
          if (v.logo) return [{ h: mm(hmm || 9), fixed: true, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: this.al }); }, al: 'left' }];
          return v.company ? [{ id: 'company', name: 'Company', text: v.company, font: T.head, weight: T.headW, size: mm(big ? 5.2 * nk : 3.1 * nk), min: mm(2.1), maxLines: 3, lineHeight: 1.1, color: ink, input: 'company' }] : [];
        }
        function aligned(items, al) { items.forEach(function (it) { if (it && it.make) it.al = al; }); return items; }
        function col(box, al, parts, vals) { ['top', 'mid', 'bottom'].forEach(function (k) { if (parts[k]) aligned(parts[k], al); }); return K.column(env, box, al, parts, vals, mm(2)); }
        function rule(acc, w) { return { h: mm(0.45), fixed: true, gap: mm(2), make: function (x, y, bw) { var rw = mm(w || 9); return env.rect({ id: 'rule', name: 'Rule', x: this.al === 'center' ? x + (bw - rw) / 2 : x, y: y, w: rw, h: mm(0.45), fill: acc }); } }; }

        function front(vals) {
          var L = [], bg = T.bg, ink = T.ink, acc = C.ensure(T.accent, bg, 4.5), muted = C.readable(bg, [T.muted, ink]);
          var markCol = C.isDark(bg) ? '#FFFFFF' : '#1A1A1A', s, box, q;
          if (style === 'split') {
            var on = C.readable(T.accent, ['#FFFFFF', T.ink]);
            if (wide) {
              s = b + tw * 0.37;
              L.push(env.rect({ id: 'panel', name: 'Colour panel', x: 0, y: 0, w: s, h: H, fill: T.accent }));
              L = L.concat(col({ x: b + pad, y: inner.y, w: s - b - 2 * pad, h: inner.h }, 'left', { mid: v.logo || v.company ? brand(on, 11) : [{ id: 'mark', name: 'Initials', text: K.initials(v.name), font: T.head, weight: T.headW, size: mm(11), min: mm(5), maxLines: 1, color: on }] }, vals));
              L = L.concat(col({ x: s + pad, y: inner.y, w: W - b - pad - s - pad, h: inner.h }, 'left', { top: ident(ink, acc), bottom: contact(muted) }, vals));
            } else {
              s = b + th * 0.34;
              L.push(env.rect({ id: 'panel', name: 'Colour panel', x: 0, y: 0, w: W, h: s, fill: T.accent }));
              L = L.concat(col({ x: inner.x, y: inner.y, w: inner.w, h: s - inner.y - pad * 0.8 }, 'left', { mid: v.logo || v.company ? brand(on, 10) : [{ id: 'mark', name: 'Initials', text: K.initials(v.name), font: T.head, weight: T.headW, size: mm(10), min: mm(5), maxLines: 1, color: on }] }, vals));
              L = L.concat(col({ x: inner.x, y: s + pad * 0.8, w: inner.w, h: H - b - pad - s - pad * 0.8 }, 'left', { top: ident(ink, acc), bottom: contact(muted) }, vals));
            }
            markCol = '#8A8A8A';
          } else if (style === 'monogram') {
            var d = wide ? Math.min(inner.h * 0.68, mm(25)) : Math.min(inner.w * 0.42, mm(22));
            var cx = wide ? inner.x : inner.x + (inner.w - d) / 2, cy = wide ? inner.y + (inner.h - d) / 2 : inner.y;
            if (v.logo) L.push(K.logo(env, v.logo, { x: cx, y: cy, w: d, h: d }, { align: 'center' }));
            else {
              L.push(env.ellipse({ id: 'ring', name: 'Ring', x: cx, y: cy, w: d, h: d, fill: { type: 'none' }, stroke: { width: mm(0.35), color: acc } }));
              L.push(env.ellipse({ id: 'ring-2', name: 'Ring', x: cx + mm(1.1), y: cy + mm(1.1), w: d - mm(2.2), h: d - mm(2.2), fill: { type: 'none' }, stroke: { width: mm(0.12), color: acc } }));
              var it = env.text({ id: 'mark', name: 'Initials', text: K.initials(v.name), x: cx + d * 0.14, y: cy, w: d * 0.72, h: d, font: T.head, weight: 700, size: d * 0.44, min: d * 0.2, maxLines: 1, align: 'center', valign: 'middle', color: acc });
              L.push(it);
            }
            box = wide ? { x: inner.x + d + mm(6), y: inner.y, w: inner.w - d - mm(6), h: inner.h } : { x: inner.x, y: inner.y + d + mm(4), w: inner.w, h: inner.h - d - mm(4) };
            L = L.concat(col(box, wide ? 'left' : 'center', { mid: ident(ink, acc, true).concat([{ h: mm(1.6), fixed: true, make: function () { return null; } }], contact(muted)) }, vals));
          } else if (style === 'photo') {
            s = wide ? b + tw * 0.38 : b + th * 0.42;
            var ph = env.photo(wide ? { id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: s, h: H, label: 'Your photo' } : { id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: s, label: 'Your photo' });
            L.push(K.bind(ph, 'photo', 'cover'));
            box = wide ? { x: s + pad, y: inner.y, w: W - b - pad - s - pad, h: inner.h } : { x: inner.x, y: s + pad * 0.8, w: inner.w, h: H - b - pad - s - pad * 0.8 };
            L = L.concat(col(box, 'left', { top: ident(ink, acc, true), bottom: contact(muted) }, vals));
            markCol = '#8A8A8A';
          } else if (style === 'centred') {
            L = L.concat(col(inner, 'center', { top: brand(ink, 8), mid: ident(ink, acc).concat([{ h: mm(1.8), fixed: true, make: function () { return null; } }, rule(acc, 8)]), bottom: contact(muted) }, vals));
          } else if (style === 'dark') {
            if (wide) {
              L = L.concat(col({ x: inner.x, y: inner.y, w: inner.w * 0.46, h: inner.h }, 'left', { top: brand(acc, 9), bottom: ident(ink, acc) }, vals));
              L = L.concat(col({ x: inner.x + inner.w * 0.48, y: inner.y, w: inner.w * 0.52, h: inner.h }, 'right', { bottom: contact(muted) }, vals));
            } else L = L.concat(col(inner, 'left', { top: brand(acc, 9), mid: ident(ink, acc), bottom: contact(muted) }, vals));
          } else if (style === 'stripe') {
            s = mm(6.5);
            var onS = C.readable(T.accent, [T.ink, '#FFFFFF']);
            if (wide) {
              L.push(env.rect({ id: 'stripe', name: 'Stripe', x: 0, y: 0, w: b + s, h: H, fill: T.accent }));
              box = { x: b + s + pad, y: inner.y, w: W - b - pad - (b + s + pad), h: inner.h };
              L = L.concat(col({ x: box.x, y: box.y, w: box.w * 0.62, h: box.h }, 'left', { top: ident(ink, acc), bottom: contact(muted) }, vals));
              L = L.concat(col({ x: box.x + box.w * 0.64, y: box.y, w: box.w * 0.36, h: box.h }, 'right', { top: brand(ink, 9) }, vals));
            } else {
              L.push(env.rect({ id: 'stripe', name: 'Stripe', x: 0, y: 0, w: W, h: b + s, fill: T.accent }));
              L = L.concat(col({ x: inner.x, y: b + s + pad * 0.8, w: inner.w, h: H - b - pad - (b + s + pad * 0.8) }, 'left', { top: brand(ink, 9), mid: ident(ink, acc), bottom: contact(muted) }, vals));
            }
            markCol = C.isDark(onS) ? '#1A1A1A' : '#8A8A8A';
          } else if (style === 'qr') {
            var text = code || K.vcard(v);
            if (wide) {
              q = Math.min(inner.h, inner.w * 0.42);
              L = L.concat(K.qrTile(env, text, inner.x + inner.w - q, inner.y + (inner.h - q) / 2, q, { key: 'qr', stroke: C.mix(bg, ink, 0.18) }));
              L = L.concat(col({ x: inner.x, y: inner.y, w: inner.w - q - mm(4), h: inner.h }, 'left', { top: ident(ink, acc, true), bottom: contact(muted) }, vals));
            } else {
              q = Math.min(inner.w * 0.7, inner.h * 0.44);
              L = L.concat(col(inner, 'left', { top: ident(ink, acc, true), mid: [{ h: q, make: function (x, y, w, h) { return K.qrTile(env, text, x, y, h, { key: 'qr', stroke: C.mix(bg, ink, 0.18) }); } }], bottom: contact(muted) }, vals));
            }
            vals.qr = text;
          } else {
            if (wide) {
              L = L.concat(col({ x: inner.x, y: inner.y, w: inner.w * 0.62, h: inner.h }, 'left', { top: ident(ink, acc).concat([{ h: mm(2), fixed: true, make: function () { return null; } }, rule(acc, 9)]), bottom: contact(muted) }, vals));
              L = L.concat(col({ x: inner.x + inner.w * 0.64, y: inner.y, w: inner.w * 0.36, h: inner.h }, 'right', { top: brand(ink, 9) }, vals));
            } else L = L.concat(col(inner, 'left', { top: brand(ink, 9), mid: ident(ink, acc).concat([{ h: mm(2), fixed: true, make: function () { return null; } }, rule(acc, 9)]), bottom: contact(muted) }, vals));
          }
          return { layers: L, mark: markCol, bg: bg };
        }
        function back(vals) {
          var bg = T.back === 'accent' ? T.accent : T.back === 'ink' ? T.ink : T.bg;
          var ink = C.readable(bg, ['#FFFFFF', T.ink, '#16131C']), soft = C.readable(bg, [C.mix(ink, bg, 0.25), ink]);
          var L = [env.rect({ id: 'back-bg', name: 'Background', x: 0, y: 0, w: W, h: H, fill: bg })];
          var hasQr = !!code && style !== 'qr';
          var words = brand(style === 'dark' ? C.ensure(T.accent, bg, 4.5) : ink, 12, true);
          if (!words.length) words = [{ id: 'back-name', name: 'Name', text: v.name, font: T.head, weight: T.headW, size: mm(5 * nk), min: mm(2.6), maxLines: 2, lineHeight: 1.1, color: ink }];
          words[words.length - 1].gap = mm(1.6);
          if (v.tagline) words.push({ id: 'tagline', name: 'Line', text: v.tagline, font: T.body, weight: 400, size: mm(2.6), min: mm(1.9), maxLines: 2, lineHeight: 1.3, color: soft, gap: mm(1), input: 'tagline' });
          if (v.site && (style === 'qr' || !hasQr || v.qr === 'vcard')) words.push({ id: 'back-site', name: 'Website', text: v.site, font: T.body, weight: 700, size: mm(2.4), min: mm(1.9), maxLines: 1, color: ink });
          var cap = { id: 'qr-caption', name: 'Code caption', text: v.qr === 'site' ? 'Visit the website' : 'Save my contact', font: T.body, weight: 700, size: mm(2), min: mm(1.7), maxLines: 2, uppercase: true, tracking: 0.12, color: soft };
          if (!hasQr) L = L.concat(col(inner, 'center', { mid: words }, vals));
          else if (wide) {
            var q = Math.min(inner.h * 0.86, mm(27)), qx = inner.x + inner.w - q, qy = inner.y + (inner.h - q - mm(4.4)) / 2;
            L = L.concat(K.qrTile(env, code, qx, qy, q, { key: 'qr' }));
            L.push(env.text(Object.assign({}, cap, { x: qx, y: qy + q + mm(1.4), w: q, align: 'center', maxLines: 1 })));
            L = L.concat(col({ x: inner.x, y: inner.y, w: inner.w - q - mm(5), h: inner.h }, 'left', { mid: words }, vals));
          } else {
            var q2 = Math.min(inner.w * 0.66, inner.h * 0.42, mm(28));
            L = L.concat(col(inner, 'center', { mid: words.concat([{ h: mm(3), fixed: true, make: function () { return null; } },
              { h: q2, fixed: true, gap: mm(1.6), make: function (x, y, w, h) { return K.qrTile(env, code, x + (w - h) / 2, y, h, { key: 'qr' }); } }, cap]) }, vals));
          }
          if (hasQr) vals.qr = code;
          return { layers: L, mark: C.isDark(bg) ? '#FFFFFF' : '#1A1A1A', bg: bg };
        }

        var fv = {}, bv = {}, F = front(fv), B = back(bv);
        var p1 = env.page(F.bg), p2 = env.page(B.bg);
        p1.layers = F.layers.concat(K.trimMarks(env, b, { color: F.mark, guides: v.guides, safe: mm(3) }));
        p2.layers = B.layers.concat(K.trimMarks(env, b, { color: B.mark, guides: v.guides, safe: mm(3), id: 'crop-marks' }));
        p1.values = fv; p2.values = bv;
        var pages = [p1, p2];
        if (v.paper === 'a4' || v.paper === 'letter') {
          [[F, fv, false], [B, bv, true]].forEach(function (side) {
            var src = side[2] ? [env.rect({ id: 'card-bg', name: 'Card', x: 0, y: 0, w: W, h: H, fill: side[0].bg })].concat(side[0].layers.slice(1)) : [env.rect({ id: 'card-bg', name: 'Card', x: 0, y: 0, w: W, h: H, fill: side[0].bg })].concat(side[0].layers);
            var pg = K.sheet(env, { paper: v.paper, trim: { w: tw, h: th }, bleed: b, back: side[2], duplex: true, title: 'Business cards',
              draw: function (x, y, i) { return K.copy(src, x, y, i + 1); } });
            pg.values = side[1];
            pages.push(pg);
          });
        }
        return { name: 'Business card — ' + v.name, pages: pages };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
