/* Quick maker: quote card (V8). */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  function stripQuotes(s) { return String(s || '').replace(/^[\s"“”„«»'‘’]+|[\s"“”„«»'‘’]+$/g, ''); }
  function byline(v) { return v.author ? '— ' + v.author : ''; }

  LE.makers.register({
    id: 'quote',
    name: 'Quote card',
    category: 'Social',
    summary: 'A quote, who said it, and an optional photo.',
    keywords: ['quote', 'saying', 'words', 'motivation', 'poem', 'lyrics', 'text post'],
    inputs: [
      { key: 'quote', label: 'Quote', type: 'longtext', required: true, max: 420, maxLines: 8, placeholder: 'The best way out is always through.' },
      { key: 'author', label: 'Who said it', type: 'text', max: 60, placeholder: 'Robert Frost' },
      { key: 'source', label: 'Source', type: 'text', max: 80, placeholder: 'A Servant to Servants' },
      { key: 'photo', label: 'Photo', type: 'photo' },
      { key: 'accent', label: 'Accent colour', type: 'color' }
    ],
    styles: [
      { id: 'editorial', name: 'Editorial' },
      { id: 'bold', name: 'Bold' },
      { id: 'handwritten', name: 'Handwritten' },
      { id: 'minimal', name: 'Minimal' },
      { id: 'photo', name: 'Over a photo' }
    ],
    sample: { values: { quote: 'Not all those who wander are lost.', author: 'J. R. R. Tolkien', source: 'The Fellowship of the Ring', photo: 'sample:travel-08' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color;
      var q = stripQuotes(v.quote);
      var long = q.length > 160;
      /* Safe area: stories keep clear of the top and bottom UI. */
      var top = env.tall ? 230 : 96, bottom = env.tall ? 300 : 96, M = env.tall ? 96 : 96;
      var area = { x: M, y: top, w: W - 2 * M, h: H - top - bottom };
      var page, L = [];
      var style = env.style;

      function credits(x, w, align, ink, muted, opts) {
        opts = opts || {};
        var out = [];
        if (v.author) out.push(env.text({ id: 'author', name: 'Author', text: opts.dash === false ? v.author : byline(v), x: x, y: 0, w: w, font: opts.font || 'Inter', weight: opts.weight || 700, size: opts.size || 28, min: 18, maxLines: 2, tracking: opts.tracking == null ? 0.12 : opts.tracking, uppercase: opts.upper !== false, align: align, color: ink }));
        if (v.source) out.push(env.text({ id: 'source', name: 'Source', text: v.source, x: x, y: 0, w: w, font: opts.sourceFont || 'Playfair Display', italic: opts.sourceItalic !== false, weight: 400, size: opts.sourceSize || 28, min: 18, maxLines: 2, align: align, color: muted }));
        var y = 0;
        out.forEach(function (l, i) { l.y = y; y += l.h + (i === 0 ? 10 : 0); });
        return out;
      }
      function stackBelow(first, rest, gap) {
        var y = first.y + first.h + gap;
        rest.forEach(function (l) { var dy = y - l.y; l.y += dy; y = l.y + l.h; });
      }

      if (style === 'editorial') {
        var paper = '#F3EEE4', ink = '#1F1A17', accent = v.accent || '#A4441F';
        var accentText = C.ensure(accent, paper, 3);
        page = env.page(paper);
        var textArea = area;
        if (v.photo) {
          var ph = Math.round((H - top - bottom) * (env.tall ? 0.42 : 0.4));
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: M, y: top, w: W - 2 * M, h: ph, label: 'Add a photo' }));
          textArea = { x: M, y: top + ph + 56, w: W - 2 * M, h: H - bottom - (top + ph + 56) };
        }
        var mark = env.text({ id: 'mark', name: 'Quote mark', text: '“', x: textArea.x - 8, y: textArea.y, w: 220, font: 'Playfair Display', weight: 700, size: v.photo ? 150 : 230, lineHeight: 0.9, color: accentText });
        var body = env.text({ id: 'quote', name: 'Quote', text: q, x: textArea.x, y: 0, w: textArea.w, h: textArea.h - mark.h * 0.45 - 150, font: 'Playfair Display', italic: true, weight: 400, size: v.photo ? (long ? 60 : 96) : (long ? 68 : 120), min: 30, lineHeight: 1.2, balance: !long, color: ink });
        var rule = env.line({ id: 'rule', name: 'Rule', x: textArea.x, y: 0, w: 96, width: 3, color: accentText });
        var cr = credits(textArea.x, textArea.w, 'left', ink, '#5E5248', { size: 28, sourceSize: 32 });
        var block = [mark, body, rule].concat(cr);
        body.y = mark.y + mark.h * 0.55;
        rule.y = body.y + body.h + 44;
        stackBelow(rule, cr, 28);
        env.place(block, textArea, 'middle');
        L = L.concat(block);
      } else if (style === 'bold') {
        var bg = v.accent || '#FFD43B';
        var ink2 = C.readable(bg, ['#141414', '#FFFFFF']);
        page = env.page(bg);
        var tArea = area;
        if (v.photo) {
          var bh = Math.round(H * (env.tall ? 0.36 : 0.38));
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: H - bh, w: W, h: bh, label: 'Add a photo' }));
          tArea = { x: M, y: top, w: W - 2 * M, h: H - bh - top - 72 };
        }
        var bar = env.rect({ id: 'bar', name: 'Bar', x: M, y: tArea.y, w: 120, h: 18, fill: ink2 });
        var big = env.text({ id: 'quote', name: 'Quote', text: q, x: tArea.x, y: 0, w: tArea.w, h: tArea.h - 200, font: 'Archivo Black', weight: 400, size: long ? 88 : 128, min: 32, lineHeight: 1.06, tracking: -0.01, color: ink2 });
        var cr2 = credits(tArea.x, tArea.w, 'left', ink2, ink2, { font: 'Space Grotesk', size: 34, sourceFont: 'Space Grotesk', sourceItalic: false, sourceSize: 30 });
        big.y = bar.y + bar.h + 48;
        stackBelow(big, cr2, 44);
        var blk = [bar, big].concat(cr2);
        env.place(blk, tArea, 'middle');
        L = L.concat(blk);
      } else if (style === 'handwritten') {
        var cream = '#FBF6EC', pen = '#22307A';
        page = env.page(cream);
        var lines = [];
        for (var y = top + 40; y < H - bottom + 40; y += 64) lines.push(env.line({ id: 'rule', name: 'Ruled line', x: 0, y: y, w: W, width: 2, color: '#E6DCCB' }));
        L = L.concat(lines);
        var hArea = area;
        if (v.photo) {
          var pw = Math.round(W * (env.tall ? 0.62 : env.square ? 0.42 : 0.5));
          var phh = Math.round(pw * 1.05);
          var fx = (W - pw) / 2, fy = top;
          L.push(env.rect({ id: 'print', name: 'Print', x: fx - 22, y: fy - 22, w: pw + 44, h: phh + 90, fill: '#FFFFFF', rotation: -3, shadow: { color: 'rgba(40,30,20,.18)', blur: 30, x: 0, y: 12 } }));
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: fx, y: fy, w: pw, h: phh, rotation: -3, label: 'Add a photo' }));
          L.push(env.rect({ id: 'tape', name: 'Tape', x: W / 2 - 90, y: fy - 44, w: 180, h: 46, fill: 'rgba(232,180,160,0.78)', rotation: 4 }));
          hArea = { x: M, y: fy + phh + 120, w: W - 2 * M, h: H - bottom - (fy + phh + 120) };
        } else {
          L.push(env.rect({ id: 'tape', name: 'Tape', x: W / 2 - 100, y: top - 30, w: 200, h: 50, fill: 'rgba(232,180,160,0.78)', rotation: -4 }));
        }
        var hand = env.text({ id: 'quote', name: 'Quote', text: q, x: hArea.x, y: 0, w: hArea.w, h: hArea.h - 110, font: 'Caveat', weight: 700, size: v.photo ? (long ? 76 : 104) : (long ? 84 : 132), min: 40, lineHeight: 1.1, align: 'center', balance: true, color: pen });
        var cr3 = credits(hArea.x, hArea.w, 'center', pen, '#4A557F', { font: 'Caveat', weight: 400, size: 46, upper: false, tracking: 0, sourceFont: 'Caveat', sourceItalic: false, sourceSize: 38 });
        stackBelow(hand, cr3, 26);
        var hb = [hand].concat(cr3);
        env.place(hb, hArea, 'middle');
        L = L.concat(hb);
      } else if (style === 'minimal') {
        var white = '#FFFFFF', black = '#111111', acc = C.ensure(v.accent || '#2F6BFF', white, 3);
        page = env.page(white);
        L.push(env.ellipse({ id: 'dot', name: 'Dot', x: M, y: top, w: 30, h: 30, fill: acc }));
        var mArea = { x: M, y: top + 90, w: W - 2 * M, h: area.h - 90 };
        if (v.photo) {
          var sq = Math.round(W * (env.square ? 0.3 : 0.4));
          L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: W - M - sq, y: top, w: sq, h: Math.round(sq * 1.25), label: 'Add a photo' }));
          mArea = { x: M, y: top + Math.round(sq * 1.25) + 64, w: W - 2 * M, h: H - bottom - (top + Math.round(sq * 1.25) + 64) };
        }
        var mq = env.text({ id: 'quote', name: 'Quote', text: q, x: mArea.x, y: 0, w: mArea.w * (long ? 1 : 0.92), h: mArea.h - 120, font: 'Inter', weight: 400, size: long ? 52 : 96, min: 28, lineHeight: 1.22, tracking: -0.015, color: black });
        var cr4 = credits(mArea.x, mArea.w, 'left', black, '#5C5C5C', { size: 30, tracking: 0, upper: false, weight: 700, sourceFont: 'Inter', sourceItalic: false, sourceSize: 28 });
        stackBelow(mq, cr4, 40);
        var mb = [mq].concat(cr4);
        env.place(mb, mArea, 'bottom');
        L = L.concat(mb);
      } else {
        /* Over a photo: full-bleed photo, a scrim that is darkest where the words sit. */
        page = env.page('#2A2433');
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: H, label: 'Add a photo' }));
        L.push(env.rect({ id: 'scrim', name: 'Shade', x: 0, y: 0, w: W, h: H, fill: { type: 'linear', angle: 90, colors: ['rgba(12,10,18,0.30)', 'rgba(12,10,18,0.55)', 'rgba(12,10,18,0.86)'] } }));
        var pArea = { x: M, y: Math.round(top + (H - top - bottom) * 0.34), w: W - 2 * M, h: Math.round((H - top - bottom) * 0.66) };
        var pq = env.text({ id: 'quote', name: 'Quote', text: '“' + q + '”', x: pArea.x, y: 0, w: pArea.w, h: pArea.h - 130, font: 'DM Serif Display', weight: 400, size: long ? 66 : 92, min: 30, lineHeight: 1.16, align: 'center', balance: true, color: '#FFFFFF' });
        var cr5 = credits(pArea.x, pArea.w, 'center', '#FFFFFF', '#E9E4F0', { size: 30, sourceSize: 32 });
        stackBelow(pq, cr5, 36);
        var pb = [pq].concat(cr5);
        env.place(pb, pArea, 'bottom');
        L = L.concat(pb);
      }
      page.layers = L;
      return { name: 'Quote — ' + (v.author || q.slice(0, 40)), pages: [page] };
    }
  });
})();
