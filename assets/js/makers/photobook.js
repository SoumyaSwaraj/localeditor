/* Quick maker: photo book (V13). A cover, varied inside pages with page numbers, and a back cover, as separate pages. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  /* The order inside pages follow; 'text' pages need a caption to show, and are skipped otherwise. */
  var RHYTHM = ['full', 'caption', 'two', 'text', 'grid', 'caption', 'full', 'two', 'text', 'caption', 'grid', 'two'];
  var NEED = { full: 1, caption: 1, two: 2, grid: 4, text: 0 };

  var LOOKS = {
    classic: { bg: '#FBF8F2', ink: '#25211C', muted: '#5F574C', head: 'Cormorant Garamond', headWeight: 700, body: 'EB Garamond', italic: true, rule: '#C9BBA4' },
    modern: { bg: '#FFFFFF', ink: '#121216', muted: '#55535E', head: 'Space Grotesk', headWeight: 700, body: 'Inter', italic: false, rule: '#121216' },
    journal: { bg: '#F3EBDD', ink: '#2E2620', muted: '#5C4E42', head: 'Caveat', headWeight: 700, body: 'Kalam', italic: false, rule: '#B9A487' },
    dark: { bg: '#18171B', ink: '#F4F1EA', muted: '#B9B4AA', head: 'Playfair Display', headWeight: 700, body: 'Lora', italic: true, rule: '#4A4650' }
  };

  /* Plans which layout each inside page gets and which photos it shows. */
  function plan(nInside, photos, captions) {
    var out = [], p = 0, k = 0, textUsed = 0;
    for (var i = 0; i < nInside; i++) {
      var kind = RHYTHM[k++ % RHYTHM.length];
      var capLeft = captions.length > textUsed && captions.some(function (c, ci) { return ci >= p && c; });
      if (kind === 'text' && !capLeft) kind = RHYTHM[k++ % RHYTHM.length];
      if (kind === 'text') {
        var ci = -1;
        for (var j = p; j < captions.length; j++) if (captions[j]) { ci = j; break; }
        out.push({ kind: 'text', quote: captions[ci], photos: [] });
        captions[ci] = '';
        textUsed++;
        continue;
      }
      if (kind === 'caption' && !(p < photos.length && captions[p])) kind = 'full';
      var list = [];
      for (var n = 0; n < NEED[kind]; n++) { list.push(p < photos.length ? { src: photos[p], cap: captions[p] || '', i: p } : { src: '', cap: '', i: p }); p++; }
      out.push({ kind: kind, photos: list });
    }
    return out;
  }

  LE.makers.register({
    id: 'photobook',
    name: 'Photo book',
    category: 'Print',
    summary: 'A cover, varied photo pages with captions and page numbers, and a back cover, ready to print.',
    keywords: ['photo book', 'photobook', 'album', 'booklet', 'yearbook', 'holiday', 'family', 'print', 'printable', 'scrapbook', 'memories'],
    sizes: ['a5', 'square-20', 'a4-landscape'],
    maxPages: 24,
    inputs: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 48, placeholder: 'Summer by the sea' },
      { key: 'subtitle', label: 'Subtitle', type: 'text', max: 60, placeholder: 'Cornwall, August 2026' },
      { key: 'photos', label: 'Photos', type: 'photos', max: 36, hint: 'In the order they appear. Pages with no photo yet keep a slot to fill.' },
      { key: 'captions', label: 'Captions', type: 'list', max: 36, cellMax: 90, placeholder: 'The first swim', hint: 'Caption 1 goes with photo 1, and so on. Leave a line empty to skip.' },
      { key: 'pages', label: 'Pages', type: 'choice', default: '12', options: ['8', '12', '16', '20', '24'] }
    ],
    styles: [
      { id: 'classic', name: 'Classic' },
      { id: 'modern', name: 'Modern' },
      { id: 'journal', name: 'Journal' },
      { id: 'dark', name: 'Dark' }
    ],
    sample: { values: {
      title: 'Summer by the sea', subtitle: 'Cornwall, August 2026', pages: '12',
      photos: ['sample:travel-07', 'sample:travel-08', 'sample:people-07', 'sample:travel-05', 'sample:still-02', 'sample:travel-06', 'sample:people-08', 'sample:street-01', 'sample:garden-02', 'sample:still-01', 'sample:arch-01', 'sample:books-01'],
      captions: ['Low tide, the first evening', 'The harbour at seven', 'Gran found the best rock pool', '', 'Breakfast outside, every day', 'Fog rolled in after lunch', '', 'The long way home', 'Wild garden behind the cottage']
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, P = env.print, mm = P.mm;
      var look = LOOKS[env.style] || LOOKS.classic, style = env.style;
      var photos = v.photos || [], captions = (v.captions || []).map(String);
      var N = Number(v.pages) || 12;
      var land = W > H * 1.1;
      var M = mm(land ? 14 : 13), G = mm(4);
      var ink = look.ink, muted = C.ensure(look.muted, look.bg, 4.5);
      var pages = [];
      var frame = style === 'journal' ? { width: mm(3), color: '#FFFFFF' } : null;
      var shadow = style === 'journal' ? { color: 'rgba(60,40,20,.28)', blur: mm(3), x: 0, y: mm(1) } : null;

      function photoL(id, src, b, label) {
        return env.photo({ id: id, name: 'Photo', src: src, x: b.x, y: b.y, w: b.w, h: b.h, label: label || 'Add a photo', border: frame, shadow: shadow, radius: style === 'modern' ? 0 : 0 });
      }
      function caption(id, text, b, align, size) {
        return env.text({ id: id, name: 'Caption', text: text, x: b.x, y: b.y, w: b.w, h: b.h, font: look.body, italic: look.italic, weight: 400, size: size || mm(land ? 4.6 : 4.2), min: mm(2.8), maxLines: 3, lineHeight: 1.25, align: align || 'left', color: muted });
      }
      function folio(n, L) {
        var right = n % 2 === 1;
        L.push(env.text({ id: 'page-number', name: 'Page number', text: String(n), x: right ? W - M - mm(20) : M, y: H - M * 0.55 - mm(4), w: mm(20), font: look.body, weight: 400, size: mm(3.6), min: mm(3), maxLines: 1, align: right ? 'right' : 'left', color: muted }));
      }
      /* Cover */
      (function () {
        var page = env.page(look.bg), L = [];
        var hero = photos[0] || '';
        if (style === 'dark' || style === 'modern') {
          if (style === 'dark') {
            if (hero) {
              L.push(photoL('cover-photo', hero, { x: 0, y: 0, w: W, h: H }, 'Add a cover photo'));
              L.push(env.rect({ id: 'scrim', name: 'Shade', x: 0, y: H * 0.45, w: W, h: H * 0.55, fill: { type: 'linear', angle: 180, colors: ['rgba(18,17,22,0)', 'rgba(18,17,22,.82)'] } }));
              L.push(env.rect({ id: 'scrim-base', name: 'Shade base', x: 0, y: H * 0.72, w: W, h: H * 0.28, fill: 'rgba(18,17,22,.55)' }));
            } else L.push(photoL('cover-photo', '', { x: 0, y: 0, w: W, h: H * 0.68 }, 'Add a cover photo'));
            var t = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: 0, w: W - 2 * M, font: look.head, weight: look.headWeight, size: mm(land ? 20 : 17), min: mm(8), maxLines: 2, lineHeight: 1.05, color: '#FFFFFF', balance: true });
            var blk = [t];
            if (v.subtitle) blk.push(env.text({ id: 'subtitle', name: 'Subtitle', text: v.subtitle, x: M, y: t.y + t.h + mm(3), w: W - 2 * M, font: look.body, italic: true, weight: 400, size: mm(5.5), min: mm(3.5), maxLines: 2, color: '#EDE8DF' }));
            env.place(blk, { x: 0, y: H * 0.72, w: W, h: H * 0.28 - M }, 'bottom');
            L = L.concat(blk);
          } else {
            var t2 = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: M, w: W - 2 * M, font: look.head, weight: 700, size: mm(land ? 18 : 16), min: mm(8), maxLines: 3, lineHeight: 1, color: ink });
            L.push(t2);
            var y2 = t2.y + t2.h + mm(4);
            if (v.subtitle) { var s2 = env.text({ id: 'subtitle', name: 'Subtitle', text: v.subtitle, x: M, y: y2, w: W - 2 * M, font: look.body, weight: 400, size: mm(4.8), min: mm(3.2), maxLines: 2, uppercase: true, tracking: 0.1, color: muted }); L.push(s2); y2 = s2.y + s2.h; }
            y2 += mm(8);
            L.push(photoL('cover-photo', hero, { x: M, y: y2, w: W - 2 * M, h: H - M - y2 }, 'Add a cover photo'));
          }
        } else {
          var ph = { x: M, y: M, w: W - 2 * M, h: (H - 2 * M) * (land ? 0.7 : 0.68) };
          if (style === 'journal') ph = { x: M * 1.4, y: M * 1.2, w: W - 2.8 * M, h: (H - 2 * M) * 0.66 };
          L.push(photoL('cover-photo', hero, ph, 'Add a cover photo'));
          var area = { x: M, y: ph.y + ph.h + mm(6), w: W - 2 * M, h: H - M - (ph.y + ph.h + mm(6)) };
          var b = [];
          var tt = env.text({ id: 'title', name: 'Title', text: v.title, x: area.x, y: 0, w: area.w, font: look.head, weight: look.headWeight, size: mm(style === 'journal' ? 17 : 14), min: mm(7), maxLines: 2, lineHeight: 1.05, align: 'center', color: ink, balance: true });
          b.push(tt);
          if (style === 'classic') b.push(env.line({ id: 'rule', name: 'Rule', x: W / 2 - mm(10), y: tt.y + tt.h + mm(3), w: mm(20), width: Math.max(2, mm(0.35)), color: look.rule }));
          if (v.subtitle) b.push(env.text({ id: 'subtitle', name: 'Subtitle', text: v.subtitle, x: area.x, y: tt.y + tt.h + mm(style === 'classic' ? 7 : 3), w: area.w, font: look.body, italic: look.italic, weight: 400, size: mm(5), min: mm(3.2), maxLines: 2, align: 'center', color: muted }));
          env.place(b, area, 'middle');
          L = L.concat(b);
        }
        page.layers = L;
        pages.push(page);
      })();

      /* Inside pages */
      var inside = plan(N - 2, photos.slice(1), captions.slice(1).map(String));
      inside.forEach(function (pl, pi) {
        var n = pi + 2;
        var page = env.page(look.bg), L = [];
        var box = { x: M, y: M, w: W - 2 * M, h: H - 2 * M - mm(6) };
        var ph = pl.photos;
        function id(i) { return 'photo-' + (ph[i].i + 2); }
        if (pl.kind === 'full') {
          var bleed = style === 'dark' || style === 'modern';
          var fb = bleed ? { x: 0, y: 0, w: W, h: H } : { x: M, y: M, w: W - 2 * M, h: H - 2 * M - mm(ph[0].cap ? 14 : 6) };
          L.push(photoL(id(0), ph[0].src, fb));
          if (ph[0].cap) {
            if (bleed) {
              var capT = env.text({ id: 'caption', name: 'Caption', text: ph[0].cap, x: M + mm(4), y: 0, w: Math.min(W - 2 * M - mm(8), mm(110)), font: look.body, italic: look.italic, weight: 400, size: mm(4.4), min: mm(3), maxLines: 3, lineHeight: 1.25, color: '#FFFFFF' });
              capT.y = H - M - capT.h - mm(3);
              L.push(env.rect({ id: 'caption-bg', name: 'Caption background', x: capT.x - mm(4), y: capT.y - mm(3), w: capT.w + mm(8), h: capT.h + mm(6), fill: 'rgba(18,17,22,.78)' }));
              L.push(capT);
            } else L.push(caption('caption', ph[0].cap, { x: M, y: fb.y + fb.h + mm(3), w: W - 2 * M, h: mm(10) }, 'center'));
          }
        } else if (pl.kind === 'caption') {
          var split = land ? { a: { x: M, y: M, w: (W - 2 * M) * 0.62, h: H - 2 * M - mm(6) }, b: { x: M + (W - 2 * M) * 0.62 + mm(10), y: M, w: (W - 2 * M) * 0.38 - mm(10), h: H - 2 * M - mm(6) } }
            : { a: { x: M, y: M, w: W - 2 * M, h: (H - 2 * M) * 0.7 }, b: { x: M, y: M + (H - 2 * M) * 0.7 + mm(6), w: W - 2 * M, h: (H - 2 * M) * 0.3 - mm(12) } };
          L.push(photoL(id(0), ph[0].src, split.a));
          if (ph[0].cap) {
            var ct = env.text({ id: 'caption', name: 'Caption', text: ph[0].cap, x: split.b.x, y: split.b.y, w: split.b.w, h: split.b.h, valign: land ? 'bottom' : 'top', font: style === 'journal' ? look.head : look.body, italic: look.italic, weight: 400, size: mm(style === 'journal' ? 8 : 6), min: mm(3.2), maxLines: 4, lineHeight: 1.2, color: ink });
            L.push(ct);
          }
        } else if (pl.kind === 'two') {
          var cells = land ? env.grid(box, 2, 2, G * 1.5) : env.grid(box, 2, 1, G * 1.5);
          cells.forEach(function (c, i) {
            var capH = ph[i].cap ? mm(9) : 0;
            L.push(photoL(id(i), ph[i].src, { x: c.x, y: c.y, w: c.w, h: c.h - capH }));
            if (ph[i].cap) L.push(caption('caption-' + (i + 1), ph[i].cap, { x: c.x, y: c.y + c.h - capH + mm(2), w: c.w, h: capH - mm(2) }, 'left', mm(3.8)));
          });
        } else if (pl.kind === 'grid') {
          env.grid(box, 4, 2, G).forEach(function (c, i) { L.push(photoL(id(i), ph[i].src, c)); });
        } else {
          var q = env.text({ id: 'quote', name: 'Words', text: pl.quote, x: M + mm(10), y: M, w: W - 2 * M - mm(20), h: H - 2 * M - mm(20), valign: 'middle', font: look.head, weight: look.headWeight, italic: style === 'classic', size: mm(land ? 13 : 11), min: mm(6), maxLines: 6, lineHeight: 1.15, align: 'center', balance: true, color: ink });
          L.push(q);
          L.push(env.line({ id: 'rule', name: 'Rule', x: W / 2 - mm(8), y: q.y + q.h + mm(8), w: mm(16), width: Math.max(2, mm(0.4)), color: style === 'dark' ? look.rule : style === 'modern' ? ink : look.rule }));
        }
        if (!(pl.kind === 'full' && (style === 'dark' || style === 'modern'))) folio(n, L);
        page.layers = L;
        pages.push(page);
      });

      /* Back cover */
      (function () {
        var page = env.page(style === 'journal' ? look.bg : style === 'dark' ? look.bg : look.bg), L = [];
        var b = [];
        var last = photos.length > 1 ? photos[photos.length - 1] : '';
        if (last) {
          var s = Math.min(W, H) * 0.34;
          b.push(photoL('back-photo', last, { x: (W - s) / 2, y: 0, w: s, h: s }));
        }
        var t = env.text({ id: 'back-title', name: 'Title', text: v.title, x: M * 2, y: b.length ? b[0].y + b[0].h + mm(8) : 0, w: W - 4 * M, font: look.head, weight: look.headWeight, size: mm(7), min: mm(4), maxLines: 2, align: 'center', color: ink, balance: true });
        b.push(t);
        if (v.subtitle) b.push(env.text({ id: 'back-subtitle', name: 'Subtitle', text: v.subtitle, x: M * 2, y: t.y + t.h + mm(2), w: W - 4 * M, font: look.body, italic: look.italic, weight: 400, size: mm(4), min: mm(3), maxLines: 2, align: 'center', color: muted }));
        env.place(b, { x: 0, y: M, w: W, h: H - 2 * M }, 'middle');
        page.layers = L.concat(b);
        pages.push(page);
      })();
      return { name: 'Photo book — ' + v.title, pages: pages };
    }
  });
})();
