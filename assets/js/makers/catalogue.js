/* Quick maker: catalogue, price list or menu from spreadsheet rows (V18). Rows come from the `table` input
   (pasted cells or a CSV / Excel file, mapped to these columns); pages flow as long as the rows need. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var COLS = [
    { key: 'name', label: 'Name', max: 60, aliases: ['product', 'item', 'title', 'dish'] },
    { key: 'price', label: 'Price', max: 16, aliases: ['cost', 'amount', 'rrp'], worst: '9,999,999.99' },
    { key: 'description', label: 'Description', max: 140, aliases: ['desc', 'details', 'notes', 'about'] },
    { key: 'category', label: 'Category', max: 32, aliases: ['section', 'group', 'type', 'department'] },
    { key: 'photo', label: 'Photo', max: 60, aliases: ['image', 'picture', 'file', 'filename', 'img'] },
    { key: 'code', label: 'Code', max: 20, aliases: ['sku', 'ref', 'reference', 'id', 'number'] }
  ];
  var MAX_ROWS = 300;

  var LOOKS = {
    clean: { bg: '#FFFFFF', card: '#FFFFFF', cardLine: '#E3E0E8', ink: '#1C1B22', muted: '#5E5B68', accent: '#2D6CDF', head: 'Plus Jakarta Sans', hw: 700, body: 'Inter', zebra: '#F4F3F7', rule: '#D9D6DE' },
    warm: { bg: '#FAF5EC', card: '#FFFFFF', cardLine: null, ink: '#2B2118', muted: '#5E4E40', accent: '#A0522D', head: 'Fraunces', hw: 700, body: 'DM Sans', zebra: '#F2E9DA', rule: '#D9C8AE' },
    dark: { bg: '#141317', card: '#1F1D24', cardLine: null, ink: '#F3F0EA', muted: '#B8B3BF', accent: '#E9B872', head: 'Playfair Display', hw: 700, body: 'Inter', zebra: '#1C1B21', rule: '#3A3741' },
    bold: { bg: '#FFFFFF', card: '#FFFFFF', cardLine: '#111111', ink: '#111111', muted: '#3A3A3A', accent: '#E8452C', head: 'Archivo Black', hw: 400, body: 'Work Sans', zebra: '#FFF1C9', rule: '#111111' },
    ink: { bg: '#FFFFFF', card: '#FFFFFF', cardLine: '#9A9A9A', ink: '#000000', muted: '#3F3F3F', accent: '#000000', head: 'Lora', hw: 700, body: 'Inter', zebra: null, rule: '#9A9A9A' }
  };

  /* A price as typed, or formatted when it is a plain number and a format was chosen. Never guesses a currency. */
  function money(s, fmt) {
    s = String(s || '').trim();
    if (!s || !fmt || fmt === 'as') return s;
    var t = s.replace(/\s/g, '');
    if (!/^-?[\d.,]+$/.test(t)) return s;
    var dec = /[.,]\d{1,2}$/.test(t) ? t.charAt(t.search(/[.,]\d{1,2}$/)) : '';
    var whole = dec ? t.slice(0, t.lastIndexOf(dec)) : t, frac = dec ? t.slice(t.lastIndexOf(dec) + 1) : '';
    whole = whole.replace(/[.,]/g, '');
    if (!/^-?\d+$/.test(whole)) return s;
    var n = Number(whole + '.' + (frac || '0'));
    if (!isFinite(n)) return s;
    var neg = n < 0;
    n = Math.abs(n);
    var parts = n.toFixed(2).split('.');
    var sep = fmt === 'eur' ? '.' : ',', dp = fmt === 'eur' ? ',' : '.';
    var w = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    var num = w + dp + parts[1];
    var out = fmt === 'gbp' ? '£' + num : fmt === 'usd' ? '$' + num : fmt === 'eur' ? num + ' €' : num;
    return (neg ? '−' : '') + out;
  }

  function leaderSvg(w, h, color, r) {
    var d = '', step = r * 3.2;
    for (var x = r; x < w - r; x += step) d += '<circle cx="' + x.toFixed(1) + '" cy="' + (h / 2).toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" preserveAspectRatio="none"><g fill="' + color + '">' + d + '</g></svg>';
  }

  LE.makers.register({
    id: 'catalogue',
    name: 'Catalogue, price list or menu',
    category: 'Print',
    summary: 'Paste rows from a spreadsheet (or open a CSV or Excel file) and get print-ready product pages, a price list or a menu.',
    keywords: ['catalogue', 'catalog', 'price list', 'menu', 'products', 'spreadsheet', 'csv', 'excel', 'xlsx', 'shop', 'cafe', 'market stall', 'print', 'printable', 'line sheet'],
    sizes: ['a4', 'letter', 'a5'],
    maxPages: 50,
    inputs: [
      { key: 'kind', label: 'Make', type: 'choice', default: 'catalogue', options: [{ id: 'catalogue', name: 'Catalogue' }, { id: 'pricelist', name: 'Price list' }, { id: 'menu', name: 'Menu' }] },
      { key: 'business', label: 'Business name', type: 'text', required: true, max: 48, placeholder: 'Fern & Clay' },
      { key: 'title', label: 'Title', type: 'text', max: 48, placeholder: 'Spring collection 2027' },
      { key: 'contact', label: 'Contact line', type: 'text', max: 90, placeholder: 'hello@fernandclay.example · Saturdays at Mill Street market' },
      { key: 'items', label: 'Rows', type: 'table', columns: COLS, max: MAX_ROWS, hint: 'Columns: name, price, and optionally description, category, photo file name and code. Up to 300 rows.' },
      { key: 'photos', label: 'Product photos', type: 'photos', max: 40, hint: 'Matched by the photo column’s file name, or in row order.' },
      { key: 'currency', label: 'Prices', type: 'choice', default: 'as', options: [{ id: 'as', name: 'As typed' }, { id: 'gbp', name: '£1,234.50' }, { id: 'usd', name: '$1,234.50' }, { id: 'eur', name: '1.234,50 €' }, { id: 'plain', name: '1,234.50' }] },
      { key: 'slots', label: 'Photo on each card', type: 'toggle', default: true, hint: 'For the catalogue. Off: compact text cards.' },
      { key: 'cover', label: 'Cover page', type: 'toggle', default: true },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'clean', name: 'Clean' },
      { id: 'warm', name: 'Warm' },
      { id: 'dark', name: 'Dark' },
      { id: 'bold', name: 'Bold' },
      { id: 'ink', name: 'Ink saver' }
    ],
    sample: { values: {
      kind: 'catalogue', business: 'Fern & Clay', title: 'Spring collection 2027', contact: 'hello@fernandclay.example · Saturdays at Mill Street market', currency: 'gbp', slots: true, cover: true,
      photos: ['sample:still-02', 'sample:still-01', 'sample:books-01', 'sample:garden-02', 'sample:still-03', 'sample:still-04', 'sample:paper-01', 'sample:soft-01'],
      items: [
        ['Speckled mug', '18', 'Stoneware, 350 ml, glazed inside and out', 'Tableware', '', 'FC-101'],
        ['Breakfast bowl', '22', 'Wide and shallow, for porridge or salad', 'Tableware', '', 'FC-102'],
        ['Dinner plate', '28', '27 cm, satin white glaze', 'Tableware', '', 'FC-103'],
        ['Pouring jug', '34', 'Holds a pint; drips nothing', 'Tableware', '', 'FC-104'],
        ['Bud vase', '16', 'For one stem from the garden', 'For the home', '', 'FC-201'],
        ['Tall vase', '42', 'Hand thrown, about 30 cm', 'For the home', '', 'FC-202'],
        ['Planter with saucer', '26', 'Drainage hole, fits a 12 cm pot', 'For the home', '', 'FC-203'],
        ['Incense dish', '12', 'Little and leaf shaped', 'For the home', '', 'FC-204'],
        ['Gift voucher', '25', 'Any amount from 10', 'Gifts', '', 'FC-900']
      ]
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, P = env.print, mm = P.mm;
      var style = env.style, look = LOOKS[style] || LOOKS.clean;
      var acc = style === 'ink' ? look.ink : (v.accent || look.accent);
      var ink = look.ink, muted = C.ensure(look.muted, look.bg, 4.5);
      var accBg = C.ensure(acc, look.bg, 4.5), accCard = C.ensure(acc, look.card, 4.5);
      var kind = v.kind || 'catalogue';
      var small = W < mm(160);
      var M = mm(small ? 11 : 13);
      var rows = LE.makers.table.unpack(v.items || [], COLS.length).map(function (r) {
        return { name: r[0], price: money(r[1], v.currency), description: r[2], category: r[3], photo: r[4], code: r[5] };
      });
      if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);
      if (!rows.length) rows = [{ name: 'Your first product', price: '', description: 'Paste your rows in the form.', category: '', photo: '', code: '' }];
      var photos = v.photos || [];
      /* Photos by file name (photo column) when any row names one, else in row order. */
      var byName = {};
      photos.forEach(function (id) {
        var nm = (env.photoName(id) || '').toLowerCase();
        if (nm) { byName[nm] = id; byName[nm.replace(/\.[a-z0-9]+$/, '')] = id; }
      });
      var named = rows.some(function (r) { return r.photo; });
      rows.forEach(function (r, i) {
        if (named) { var k = String(r.photo || '').toLowerCase().trim(); r.src = byName[k] || byName[k.replace(/\.[a-z0-9]+$/, '')] || ''; }
        else r.src = photos[i] || '';
      });
      /* Category groups, in order of first appearance. */
      var groups = [], gi = {};
      rows.forEach(function (r) {
        var c = r.category || '';
        if (!(c in gi)) { gi[c] = groups.length; groups.push({ name: c, rows: [] }); }
        groups[gi[c]].rows.push(r);
      });
      var pages = [];
      var title = v.title || (kind === 'menu' ? 'Menu' : kind === 'pricelist' ? 'Price list' : 'Catalogue');

      /* ---------- Cover ---------- */
      if (v.cover !== false) {
        var cp = env.page(style === 'warm' || style === 'clean' || style === 'ink' ? look.bg : look.bg), CL = [];
        var hero = photos[0] || '';
        var useHero = kind !== 'pricelist' && style !== 'ink';
        var tb = { x: M, y: M, w: W - 2 * M, h: H - 2 * M };
        if (useHero) {
          var ph = Math.round(H * 0.56);
          CL.push(env.photo({ id: 'cover-photo', name: 'Cover photo', src: hero, x: 0, y: 0, w: W, h: ph, label: 'Add a cover photo' }));
          tb = { x: M, y: ph + mm(10), w: W - 2 * M, h: H - ph - mm(10) - M };
        }
        if (style === 'bold') CL.push(env.rect({ id: 'cover-band', name: 'Band', x: 0, y: useHero ? Math.round(H * 0.56) : 0, w: mm(6), h: useHero ? H - Math.round(H * 0.56) : H, fill: acc }));
        var blk = [];
        var t1 = env.text({ id: 'cover-business', name: 'Business name', text: v.business, x: tb.x, y: 0, w: tb.w, font: look.head, weight: look.hw, size: mm(small ? 13 : 17), min: mm(7), maxLines: 2, lineHeight: 1.05, color: ink, balance: true });
        blk.push(t1);
        var t2 = env.text({ id: 'cover-title', name: 'Title', text: title, x: tb.x, y: t1.y + t1.h + mm(4), w: tb.w, font: look.body, weight: 700, size: mm(small ? 5 : 6), min: mm(3.5), maxLines: 2, uppercase: true, tracking: 0.1, color: accBg });
        blk.push(t2);
        if (v.contact) blk.push(env.text({ id: 'cover-contact', name: 'Contact line', text: v.contact, x: tb.x, y: t2.y + t2.h + mm(6), w: tb.w, font: look.body, weight: 400, size: mm(small ? 3.6 : 4.2), min: mm(2.8), maxLines: 3, lineHeight: 1.3, color: muted }));
        var cats = groups.map(function (g) { return g.name; }).filter(Boolean);
        if (cats.length > 1) {
          var last = blk[blk.length - 1];
          blk.push(env.text({ id: 'cover-sections', name: 'Sections', text: cats.slice(0, 8).join('  ·  ') + (cats.length > 8 ? '  ·  …' : ''), x: tb.x, y: last.y + last.h + mm(8), w: tb.w, font: look.body, weight: 700, size: mm(small ? 3.2 : 3.6), min: mm(2.4), maxLines: 3, lineHeight: 1.4, color: ink }));
        }
        if (!useHero) blk.push(env.line({ id: 'cover-rule', name: 'Rule', x: tb.x, y: t1.y - mm(8), w: mm(24), width: mm(1.2), color: acc }));
        env.place(blk, tb, 'middle');
        cp.layers = CL.concat(blk);
        pages.push(cp);
      }

      /* ---------- Content pages: running header, footer, flowing body ---------- */
      var headH = mm(11), footH = mm(9);
      var body = { x: M, y: M + headH, w: W - 2 * M, h: H - 2 * M - headH - footH };
      var pageLayers = [];
      function newPage() { pageLayers.push([]); return pageLayers[pageLayers.length - 1]; }
      function shift(ls, dx, dy) { ls.forEach(function (l) { l.x = Math.round((l.x + dx) * 100) / 100; l.y = Math.round((l.y + dy) * 100) / 100; }); return ls; }
      function bottomOf(ls) { return ls.reduce(function (a, l) { return Math.max(a, l.y + l.h); }, 0); }
      function sectionHead(name, w) {
        var out = [];
        if (style === 'bold') {
          var t = env.text({ id: 'section', name: 'Section ' + name, text: name, x: mm(3), y: mm(2), w: w - mm(6), font: look.head, weight: look.hw, size: mm(small ? 5 : 6), min: mm(3.5), maxLines: 1, uppercase: true, color: '#FFFFFF' });
          out.push(env.rect({ id: 'section-band', name: 'Section band', x: 0, y: 0, w: w, h: t.h + mm(4), fill: '#111111' }));
          out.push(t);
          return out;
        }
        var t2 = env.text({ id: 'section', name: 'Section ' + name, text: name, x: kind === 'menu' ? 0 : 0, y: 0, w: w, font: kind === 'menu' ? look.head : look.body, weight: kind === 'menu' ? look.hw : 700, size: mm(kind === 'menu' ? (small ? 6 : 7) : (small ? 4.2 : 4.8)), min: mm(3.2), maxLines: 1, uppercase: kind !== 'menu', tracking: kind === 'menu' ? 0 : 0.12, align: kind === 'menu' ? 'center' : 'left', color: kind === 'menu' ? ink : accBg });
        out.push(t2);
        out.push(env.line({ id: 'section-rule', name: 'Rule', x: kind === 'menu' ? w / 2 - mm(8) : 0, y: t2.y + t2.h + mm(1.5), w: kind === 'menu' ? mm(16) : w, width: Math.max(2, mm(0.3)), color: kind === 'menu' ? acc : look.rule }));
        return out;
      }

      var cur = null, warn = 0;
      /* Without a cover, the first page opens with a masthead. Returns its height. */
      function masthead(into) {
        if (v.cover !== false) return 0;
        var centre = kind === 'menu', al = centre ? 'center' : 'left', out = [];
        var t = env.text({ id: 'masthead-business', name: 'Business name', text: v.business, x: body.x, y: body.y, w: body.w, font: look.head, weight: look.hw, size: mm(small ? 10 : 13), min: mm(6), maxLines: 2, lineHeight: 1.05, align: al, color: ink, balance: true });
        out.push(t);
        var t2 = env.text({ id: 'masthead-title', name: 'Title', text: title, x: body.x, y: t.y + t.h + mm(2), w: body.w, font: look.body, weight: 700, size: mm(small ? 3.8 : 4.4), min: mm(3), maxLines: 1, uppercase: true, tracking: 0.12, align: al, color: accBg });
        out.push(t2);
        var yb = t2.y + t2.h;
        if (v.contact) { var t3 = env.text({ id: 'masthead-contact', name: 'Contact line', text: v.contact, x: body.x, y: yb + mm(2), w: body.w, font: look.body, weight: 400, size: mm(small ? 3 : 3.4), min: mm(2.4), maxLines: 2, align: al, color: muted }); out.push(t3); yb = t3.y + t3.h; }
        into.push.apply(into, out);
        return yb - body.y + mm(9);
      }
      if (kind === 'catalogue') {
        var withPhoto = v.slots !== false;
        var cols = small ? 2 : 3;
        var rowsPer = withPhoto ? (small ? 3 : 4) : (small ? 5 : 7);
        var gap = mm(small ? 4 : 5), secH = mm(small ? 10 : 12);
        var cw = (body.w - gap * (cols - 1)) / cols;
        var ch = (body.h - 3 * secH - mm(6) - gap * (rowsPer - 1)) / rowsPer;
        cur = newPage();
        var y = masthead(cur);
        var card = function (r, x, y0) {
          var out = [], pad = mm(small ? 2.6 : 3.2);
          var filled = look.card !== look.bg || style === 'warm';
          out.push(env.rect({ id: 'card', name: 'Card', x: x, y: y0, w: cw, h: ch, radius: mm(style === 'bold' || style === 'ink' ? 0.8 : 2), fill: look.card, stroke: look.cardLine ? { width: style === 'bold' ? mm(0.5) : Math.max(2, mm(0.25)), color: look.cardLine } : null }));
          var iy = y0 + pad;
          if (withPhoto) {
            var phH = Math.round(Math.min(ch * 0.55, (cw - 2 * pad) * 0.8));
            out.push(env.photo({ id: 'product-photo', name: 'Photo · ' + (r.name || 'item'), src: r.src, x: x + pad, y: iy, w: cw - 2 * pad, h: phH, radius: mm(style === 'bold' || style === 'ink' ? 0 : 1.2), label: r.photo ? 'Add ' + r.photo : 'Add a photo' }));
            iy += phH + pad * 0.9;
          }
          var tw = cw - 2 * pad;
          var bottom = y0 + ch - pad;
          var price = r.price ? env.text({ id: 'price', name: 'Price', text: r.price, x: x + pad, y: 0, w: tw * 0.6, font: look.head, weight: look.hw, size: mm(small ? 4.4 : 5), min: mm(3), maxLines: 1, color: accCard }) : null;
          var code = r.code ? env.text({ id: 'code', name: 'Code', text: r.code, x: x + pad + tw * 0.6, y: 0, w: tw * 0.4, font: look.body, weight: 400, size: mm(2.9), min: mm(2.2), maxLines: 1, align: 'right', color: C.ensure(look.muted, look.card, 4.5) }) : null;
          var lineH = Math.max(price ? price.h : 0, code ? code.h : 0);
          if (price) { price.y = bottom - price.h; out.push(price); }
          if (code) { code.y = price ? price.y + (price.h - code.h) / 2 : bottom - code.h; out.push(code); }
          var textBottom = bottom - lineH - mm(1.2);
          var name = env.text({ id: 'name', name: 'Name', text: r.name || ' ', x: x + pad, y: iy, w: tw, h: Math.max(mm(4), textBottom - iy), font: look.body, weight: 700, size: mm(small ? 4 : 4.4), min: mm(2.6), maxLines: 2, lineHeight: 1.15, color: ink });
          out.push(name);
          var room = textBottom - (name.y + name.h + mm(0.8));
          if (r.description && room > mm(3)) out.push(env.text({ id: 'description', name: 'Description', text: r.description, x: x + pad, y: name.y + name.h + mm(0.8), w: tw, h: room, font: look.body, weight: 400, size: mm(small ? 3.1 : 3.3), min: mm(2.2), maxLines: withPhoto ? 3 : 4, lineHeight: 1.25, color: C.ensure(look.muted, look.card, 4.5) }));
          return out;
        };
        groups.forEach(function (g) {
          var col = 0;
          if (g.name) {
            if (y > 0 && y + secH + ch > body.h + 1) { cur = newPage(); y = 0; }
            cur.push.apply(cur, shift(sectionHead(g.name, body.w), body.x, body.y + y));
            y += secH;
          }
          g.rows.forEach(function (r) {
            if (col === 0 && y + ch > body.h + 1) { cur = newPage(); y = 0; }
            cur.push.apply(cur, card(r, body.x + col * (cw + gap), body.y + y));
            col++;
            if (col === cols) { col = 0; y += ch + gap; }
          });
          if (col) y += ch + gap;
          y += mm(2);
        });
      } else {
        /* Price list and menu: blocks flowing down columns. */
        var ncol = kind === 'menu' && !small ? 2 : 1;
        var cgap = mm(10), colW = (body.w - cgap * (ncol - 1)) / ncol;
        var colIdx = 0;
        cur = newPage();
        var pageTop = masthead(cur), yy = pageTop;
        var showCode = kind === 'pricelist' && rows.some(function (r) { return r.code; });
        var zebra = 0;
        var item = function (r) {
          var out = [];
          var codeW = showCode ? mm(small ? 18 : 24) : 0;
          var priceW = Math.min(colW * 0.3, mm(34));
          var nameX = codeW ? codeW + mm(2) : 0;
          var nameW = colW - nameX - priceW - mm(4);
          var pad = kind === 'pricelist' ? mm(1.6) : mm(1.2);
          var nm = env.text({ id: 'name', name: 'Name', text: r.name || ' ', x: nameX + (kind === 'pricelist' ? mm(2) : 0), y: pad, w: nameW - (kind === 'pricelist' ? mm(2) : 0), font: kind === 'menu' ? look.head : look.body, weight: kind === 'menu' ? look.hw : 700, size: mm(kind === 'menu' ? (small ? 4.6 : 5) : (small ? 3.8 : 4)), min: mm(kind === 'menu' ? (small ? 3.9 : 4.2) : 3.2), maxLines: 3, lineHeight: 1.15, color: ink });
          out.push(nm);
          var pr = r.price ? env.text({ id: 'price', name: 'Price', text: r.price, x: colW - priceW - (kind === 'pricelist' ? mm(2) : 0), y: pad, w: priceW, font: kind === 'menu' ? look.head : look.body, weight: 700, size: mm(kind === 'menu' ? (small ? 4.6 : 5) : (small ? 3.8 : 4)), min: mm(2.6), maxLines: 1, align: 'right', color: kind === 'menu' ? accBg : ink }) : null;
          if (pr) out.push(pr);
          if (codeW && r.code) out.push(env.text({ id: 'code', name: 'Code', text: r.code, x: mm(2), y: pad + (nm.size - mm(3)) * 0.4, w: codeW - mm(2), font: 'IBM Plex Mono', weight: 400, size: mm(3), min: mm(2.2), maxLines: 1, color: muted }));
          if (kind === 'menu' && pr) {
            /* Dotted leader from the end of the name's last line to the price. */
            var fl = env.fit({ text: r.name || ' ', font: nm.font, weight: nm.weight, size: nm.size, min: nm.size, lineHeight: nm.lineHeight, w: nm.w });
            var lastW = env.fit({ text: fl.lines[fl.lines.length - 1] || ' ', font: nm.font, weight: nm.weight, size: nm.size, min: nm.size, w: 100000 }).textWidth;
            var lx = nm.x + lastW + mm(2), rx = colW - env.fit({ text: r.price, font: pr.font, weight: pr.weight, size: pr.size, min: pr.size, w: 100000 }).textWidth - mm(2);
            if (rx - lx > mm(6)) out.push(env.svg({ id: 'leader', name: 'Dotted leader', x: lx, y: nm.y + nm.h - nm.size * 0.62, w: rx - lx, h: mm(1.6), markup: leaderSvg(rx - lx, mm(1.6), C.mix(muted, look.bg, 0.2), mm(0.32)) }));
          }
          var y2 = Math.max(nm.y + nm.h, pr ? pr.y + pr.h : 0);
          if (r.description) {
            var d = env.text({ id: 'description', name: 'Description', text: r.description, x: nm.x, y: y2 + mm(0.4), w: kind === 'menu' ? colW - mm(12) : nameW, font: look.body, italic: kind === 'menu' && (style === 'warm' || style === 'dark'), weight: 400, size: mm(small ? 3 : 3.3), min: mm(2.2), maxLines: 3, lineHeight: 1.25, color: muted });
            out.push(d);
            y2 = d.y + d.h;
          }
          var h = y2 + pad + (kind === 'menu' ? mm(2.6) : 0);
          if (kind === 'pricelist') {
            if (look.zebra && style !== 'bold' && style !== 'ink' ? (zebra++ % 2 === 0) : false) out.unshift(env.rect({ id: 'zebra', name: 'Row shade', x: 0, y: 0, w: colW, h: h, fill: look.zebra }));
            else if (!look.zebra || style === 'bold' || style === 'ink') out.push(env.line({ id: 'row-rule', name: 'Row rule', x: 0, y: h - 1, w: colW, width: Math.max(2, mm(0.2)), color: look.rule }));
          }
          return { layers: out, h: h };
        };
        var place = function (blk, keep) {
          if (yy > pageTop && yy + blk.h + (keep || 0) > body.h + 1) {
            colIdx++; yy = pageTop;
            if (colIdx >= ncol) { cur = newPage(); colIdx = 0; pageTop = 0; yy = 0; }
          }
          cur.push.apply(cur, shift(blk.layers, body.x + colIdx * (colW + cgap), body.y + yy));
          yy += blk.h;
        };
        groups.forEach(function (g, gi2) {
          if (g.name) {
            var sh = sectionHead(g.name, colW);
            var shH = bottomOf(sh) + mm(kind === 'menu' ? 4 : 3);
            if (yy > pageTop) yy += mm(kind === 'menu' ? 6 : 4);
            zebra = 0;
            place({ layers: sh, h: shH }, mm(12));
          }
          g.rows.forEach(function (r) { place(item(r)); });
        });
      }

      /* Page cap: the project holds 50 pages. */
      var room = 50 - pages.length;
      if (pageLayers.length > room) { warn = pageLayers.length - room; pageLayers = pageLayers.slice(0, room); env.warn('pages', 'Only the first ' + room + ' pages fit; ' + warn + ' more were left out.'); }
      var total = pageLayers.length;
      pageLayers.forEach(function (ls, i) {
        var pg = env.page(look.bg);
        var hd = [];
        if (!(i === 0 && v.cover === false)) hd.push(env.text({ id: 'running-business', name: 'Business name', text: v.business, x: M, y: M, w: (W - 2 * M) * 0.55, font: look.head, weight: look.hw, size: mm(small ? 4 : 4.6), min: mm(2.8), maxLines: 1, color: ink }));
        if (!(i === 0 && v.cover === false)) hd.push(env.text({ id: 'running-title', name: 'Title', text: title, x: M + (W - 2 * M) * 0.55, y: M + mm(0.6), w: (W - 2 * M) * 0.45, font: look.body, weight: 700, size: mm(small ? 3 : 3.3), min: mm(2.4), maxLines: 1, align: 'right', uppercase: true, tracking: 0.1, color: muted }));
        if (!(i === 0 && v.cover === false)) hd.push(env.line({ id: 'head-rule', name: 'Rule', x: M, y: M + headH - mm(4), w: W - 2 * M, width: style === 'bold' ? mm(0.8) : Math.max(2, mm(0.3)), color: style === 'bold' ? ink : look.rule }));
        var fy = H - M - mm(4);
        if (v.contact) hd.push(env.text({ id: 'running-contact', name: 'Contact line', text: v.contact, x: M, y: fy, w: (W - 2 * M) * 0.78, font: look.body, weight: 400, size: mm(2.9), min: mm(2.2), maxLines: 1, color: muted }));
        hd.push(env.text({ id: 'page-number', name: 'Page number', text: (i + 1) + ' / ' + total, x: W - M - mm(30), y: fy, w: mm(30), font: look.body, weight: 700, size: mm(2.9), min: mm(2.2), maxLines: 1, align: 'right', color: muted }));
        pg.layers = hd.concat(ls);
        pages.push(pg);
      });
      return { name: title + ' — ' + v.business, pages: pages };
    }
  });
  LE.makers.catalogueMoney = money;
})();
