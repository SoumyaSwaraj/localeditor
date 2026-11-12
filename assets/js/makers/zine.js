/* Quick maker: 8-page mini-zine on one sheet (V13). Pages are placed and turned for the classic fold-and-cut:
   fold in half lengthwise, cut the middle of the fold, fold into a little book. Imposition: LE.makers.print.zine. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var LOOKS = {
    classic: { bg: '#FBF8F2', ink: '#25211C', muted: '#5F574C', accent: '#B5452B', head: 'Fraunces', body: 'Lora' },
    bold: { bg: '#FFE14D', ink: '#111111', muted: '#2E2E2E', accent: '#111111', head: 'Anton', body: 'Work Sans' },
    journal: { bg: '#F3EBDD', ink: '#2E2620', muted: '#5C4E42', accent: '#8A5A2B', head: 'Caveat', body: 'Kalam' },
    ink: { bg: '#FFFFFF', ink: '#000000', muted: '#333333', accent: '#000000', head: 'Archivo Black', body: 'Inter' }
  };

  LE.makers.register({
    id: 'zine',
    name: 'Mini zine',
    category: 'Print',
    summary: 'Eight little pages on one sheet: print, fold, make one cut, and it is a book.',
    keywords: ['zine', 'mini zine', 'booklet', 'one page zine', 'fold', 'pocket book', 'kids', 'class project', 'print', 'printable'],
    sizes: ['a4-landscape', 'letter-landscape'],
    inputs: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 40, placeholder: 'Our street' },
      { key: 'subtitle', label: 'Subtitle', type: 'text', max: 48, placeholder: 'A tiny guide by Class 4' },
      { key: 'photos', label: 'Photos', type: 'photos', max: 7, hint: 'Photo 1 is the cover; the others fill pages 2 to 7.' },
      { key: 'pages', label: 'Page words', type: 'list', max: 6, cellMax: 120, placeholder: 'The bakery opens at six.', hint: 'Words for pages 2 to 7, one line each.' },
      { key: 'back', label: 'Back cover', type: 'text', max: 60, placeholder: 'Made by Ada, Ben and Chloe' },
      { key: 'guides', label: 'Fold and cut guides', type: 'toggle', default: true }
    ],
    styles: [
      { id: 'classic', name: 'Classic' },
      { id: 'bold', name: 'Bold' },
      { id: 'journal', name: 'Journal' },
      { id: 'ink', name: 'Ink saver' }
    ],
    sample: { values: {
      title: 'Our street', subtitle: 'A tiny guide by Class 4', back: 'Made by Ada, Ben and Chloe', guides: true,
      photos: ['sample:street-01', 'sample:still-02', 'sample:arch-01', 'sample:garden-02', 'sample:people-07', 'sample:books-01', 'sample:travel-06'],
      pages: ['The bakery opens at six. Follow your nose.', 'Look up: the oldest house has a sundial.', 'The park has a secret garden behind the gate.', 'Saturday is market day.', 'The library lends seeds as well as books.', 'Wave at the ferry on the way home.']
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, P = env.print, mm = P.mm;
      var look = LOOKS[env.style] || LOOKS.classic, style = env.style;
      var photos = v.photos || [], words = v.pages || [];
      var page = env.page(look.bg), L = [];
      var panels = P.zine(W, H);
      var m = mm(6);
      var ink = look.ink, muted = C.ensure(look.muted, look.bg, 4.5), accent = C.ensure(look.accent, look.bg, 4.5);
      var adjust = style === 'ink' ? { saturation: -100, contrast: 10, brightness: 12 } : null;
      panels.forEach(function (pn) {
        var n = pn.page, out = [], w = pn.w, h = pn.h;
        var inner = { x: m, y: m, w: w - 2 * m, h: h - 2 * m };
        function pic(i, b) {
          return env.photo({ id: 'photo-' + (i + 1), name: 'Photo ' + (i + 1), src: photos[i] || '', x: b.x, y: b.y, w: b.w, h: b.h, label: 'Add a photo', adjust: adjust, border: style === 'journal' ? { width: mm(1.6), color: '#FFFFFF' } : null });
        }
        if (n === 1) {
          var ph = { x: inner.x, y: inner.y, w: inner.w, h: inner.h * 0.6 };
          if (style === 'bold') ph = { x: 0, y: 0, w: w, h: h * 0.6 };
          out.push(pic(0, ph));
          var area = { x: inner.x, y: ph.y + ph.h + mm(3), w: inner.w, h: inner.y + inner.h - (ph.y + ph.h + mm(3)) };
          var t = env.text({ id: 'title', name: 'Title', text: v.title, x: area.x, y: 0, w: area.w, font: look.head, weight: style === 'journal' || style === 'classic' ? 700 : 400, size: mm(style === 'bold' ? 13 : 10), min: mm(4.5), maxLines: 2, lineHeight: 1.02, uppercase: style === 'bold', align: style === 'bold' ? 'left' : 'center', color: ink, balance: true });
          var blk = [t];
          if (v.subtitle) blk.push(env.text({ id: 'subtitle', name: 'Subtitle', text: v.subtitle, x: area.x, y: t.y + t.h + mm(1.5), w: area.w, font: look.body, weight: 400, size: mm(3.4), min: mm(2.4), maxLines: 2, align: style === 'bold' ? 'left' : 'center', color: muted }));
          env.place(blk, area, 'middle');
          out = out.concat(blk);
        } else if (n === 8) {
          var b = [];
          b.push(env.text({ id: 'back-title', name: 'Back title', text: v.title, x: inner.x, y: 0, w: inner.w, font: look.head, weight: style === 'journal' || style === 'classic' ? 700 : 400, size: mm(6), min: mm(3.5), maxLines: 2, align: 'center', uppercase: style === 'bold', color: ink }));
          if (v.back) b.push(env.text({ id: 'back', name: 'Back cover words', text: v.back, x: inner.x, y: b[0].y + b[0].h + mm(2), w: inner.w, font: look.body, weight: 400, size: mm(3.4), min: mm(2.4), maxLines: 3, align: 'center', color: muted }));
          env.place(b, inner, 'middle');
          out = out.concat(b);
        } else {
          var i = n - 1, txt = words[n - 2] || '';
          var photoFirst = n % 2 === 0;
          var tb = null;
          if (txt) {
            tb = env.text({ id: 'words-' + n, name: 'Page ' + n + ' words', text: txt, x: inner.x, y: 0, w: inner.w, font: style === 'journal' ? look.head : look.body, weight: style === 'bold' ? 700 : 400, size: mm(style === 'journal' ? 5.4 : 4.2), min: mm(2.6), maxLines: 5, lineHeight: 1.2, color: ink });
          }
          var room = inner.h - (tb ? tb.h + mm(3) : 0) - mm(5);
          var pb = { x: inner.x, y: photoFirst ? inner.y : inner.y + (tb ? tb.h + mm(3) : 0), w: inner.w, h: room };
          out.push(pic(i, pb));
          if (tb) { tb.y = photoFirst ? pb.y + pb.h + mm(3) : inner.y; out.push(tb); }
          out.push(env.text({ id: 'folio-' + n, name: 'Page number', text: String(n), x: n % 2 ? inner.x + inner.w - mm(10) : inner.x, y: inner.y + inner.h - mm(4), w: mm(10), font: look.body, weight: 700, size: mm(3), min: mm(2.4), maxLines: 1, align: n % 2 ? 'right' : 'left', color: accent }));
        }
        L = L.concat(P.placeIn(out, pn));
      });
      if (v.guides !== false) {
        var folds = [[W / 4, 0, W / 4, H], [W / 2, 0, W / 2, H / 2 - 1], [W / 2, H / 2 + 1, W / 2, H], [3 * W / 4, 0, 3 * W / 4, H], [0, H / 2, W / 4, H / 2], [3 * W / 4, H / 2, W, H / 2]];
        L = P.cutMarks({ folds: folds, cuts: [[W / 4, H / 2, 3 * W / 4, H / 2]], name: 'Fold and cut guides', id: 'fold-guides', color: style === 'bold' ? '#5A5A5A' : '#9A96A2' }).concat(L);
      }
      page.layers = L;
      return { name: 'Mini zine — ' + v.title, pages: [page] };
    }
  });
})();
