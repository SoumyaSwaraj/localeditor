/* Quick maker: review / testimonial card (V20). */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  function starPoints(cx, cy, R, r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R;
      pts.push((cx + Math.cos(a) * rad).toFixed(2) + ',' + (cy + Math.sin(a) * rad).toFixed(2));
    }
    return pts.join(' ');
  }
  /* Five stars as one graphic; halves use a hard-stop gradient. Plain SVG, no script. */
  function starsSvg(rating, on, off) {
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 100" preserveAspectRatio="xMinYMid meet"><defs><linearGradient id="half" x1="0" x2="1" y1="0" y2="0">' +
      '<stop offset="0.5" stop-color="' + on + '"/><stop offset="0.5" stop-color="' + off + '"/></linearGradient></defs>';
    for (var i = 0; i < 5; i++) {
      var f = rating - i;
      var fill = f >= 1 ? on : f >= 0.5 ? 'url(#half)' : off;
      out += '<polygon points="' + starPoints(50 + i * 115, 52, 48, 20) + '" fill="' + fill + '"/>';
    }
    return out + '</svg>';
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    var s = parts.length > 1 ? parts[0].charAt(0) + parts[parts.length - 1].charAt(0) : (parts[0] || '?').slice(0, 2);
    return s.toUpperCase();
  }

  LE.makers.register({
    id: 'review',
    name: 'Review card',
    category: 'Business',
    summary: 'Turn a customer review into a post, with stars.',
    keywords: ['review', 'testimonial', 'feedback', 'customer', 'rating', 'stars', 'social proof', 'small business'],
    inputs: [
      { key: 'review', label: 'Review', type: 'longtext', required: true, max: 360, maxLines: 6, placeholder: 'Best coffee in the neighbourhood, and they remember my order.' },
      { key: 'name', label: 'Name', type: 'text', required: true, max: 40, placeholder: 'Priya S.' },
      { key: 'role', label: 'Role or company', type: 'text', max: 60, placeholder: 'Regular since 2021' },
      { key: 'rating', label: 'Stars', type: 'number', min: 0, max: 5, step: 0.5, default: 5 },
      { key: 'photo', label: 'Photo or logo', type: 'photo' },
      { key: 'accent', label: 'Brand colour', type: 'color' }
    ],
    styles: [
      { id: 'card', name: 'Card' },
      { id: 'dark', name: 'Dark' },
      { id: 'chat', name: 'Chat bubble' },
      { id: 'product', name: 'Product' },
      { id: 'statement', name: 'Statement' }
    ],
    sample: { values: { review: 'Best coffee in the neighbourhood, and they remember my order every single morning.', name: 'Priya Sharma', role: 'Regular since 2021', rating: 4.5, photo: 'sample:still-02' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color;
      var top = env.tall ? 230 : 96, bottom = env.tall ? 300 : 96, M = 96;
      var rating = v.rating == null ? null : v.rating;
      var long = v.review.length > 150;
      var L = [], page;
      var gold = '#F2B33D';

      function person(x, y, w, ink, muted, opts) {
        opts = opts || {};
        var out = [], av = opts.avatar || 0, tx = x;
        if (av) {
          if (v.photo) out.push(env.photo({ id: 'avatar', name: 'Photo', src: v.photo, x: x, y: y, w: av, h: av, mask: 'ellipse', label: 'Photo or logo' }));
          else {
            out.push(env.ellipse({ id: 'avatar-bg', name: 'Initials circle', x: x, y: y, w: av, h: av, fill: opts.circle }));
            out.push(env.text({ id: 'initials', name: 'Initials', text: initials(v.name), x: x, y: y, w: av, h: av, valign: 'middle', align: 'center', font: 'Inter', weight: 700, size: av * 0.36, color: C.readable(opts.circle, [opts.circleInk]) }));
          }
          tx = x + av + 28;
        }
        var nm = env.text({ id: 'name', name: 'Name', text: v.name, x: tx, y: y, w: x + w - tx, font: opts.font || 'Inter', weight: 700, size: opts.size || 34, min: 22, maxLines: 1, align: opts.align || 'left', color: ink });
        var parts = [nm];
        if (v.role) parts.push(env.text({ id: 'role', name: 'Role', text: v.role, x: tx, y: nm.y + nm.h + 4, w: x + w - tx, font: 'Inter', weight: 400, size: (opts.size || 34) * 0.8, min: 18, maxLines: 2, align: opts.align || 'left', color: muted }));
        if (av) env.place(parts, { x: tx, y: y, w: 1, h: av }, 'middle');
        return out.concat(parts);
      }
      function stars(x, y, h, on, off, align, w) {
        if (rating == null) return [];
        var sw = h * 5.6;
        var sx = align === 'center' ? x + (w - sw) / 2 : x;
        return [env.svg({ id: 'stars', name: 'Stars ' + rating + ' of 5', markup: starsSvg(rating, on, off), x: sx, y: y, w: sw, h: h })];
      }
      function stack(items, gaps) {
        for (var i = 1; i < items.length; i++) {
          var prev = items[i - 1], cur = [].concat(items[i]);
          var pb = Math.max.apply(null, [].concat(prev).map(function (l) { return l.y + l.h; }));
          var ct = Math.min.apply(null, cur.map(function (l) { return l.y; }));
          cur.forEach(function (l) { l.y += pb + gaps[i - 1] - ct; });
        }
        return [].concat.apply([], items);
      }

      if (env.style === 'card') {
        var bg = v.accent ? C.tint(v.accent, 0.82) : '#ECE8F7';
        page = env.page(bg);
        var cx = M - 24, cy = top, cw = W - 2 * (M - 24), ch = H - top - bottom;
        var card = env.rect({ id: 'card', name: 'Card', x: cx, y: cy, w: cw, h: ch, radius: 40, fill: '#FFFFFF', shadow: { color: 'rgba(30,20,60,.12)', blur: 50, x: 0, y: 18 } });
        var inner = { x: cx + 64, y: cy + 72, w: cw - 128, h: ch - 144 };
        var acc = C.ensure(v.accent || '#5B3FD9', '#FFFFFF', 4.5);
        var st = stars(inner.x, inner.y, 54, gold, '#E4E0EC');
        var rv = env.text({ id: 'review', name: 'Review', text: v.review, x: inner.x, y: 0, w: inner.w, h: inner.h - 250, font: 'DM Sans', weight: 400, size: long ? 54 : 74, min: 28, lineHeight: 1.28, color: '#1C1830' });
        var who = person(inner.x, 0, inner.w, '#1C1830', '#5E5967', { avatar: 112, circle: acc, circleInk: '#FFFFFF' });
        var all = stack(st.length ? [st, rv, who] : [rv, who], st.length ? [48, 56] : [56]);
        var bhh = env.place(all, inner, 'top');
        card.h = Math.max(Math.round(ch * 0.5), Math.round(bhh + 144));
        all.forEach(function (l) { l.y += (card.h - 144 - bhh) / 2; });
        env.place([card].concat(all), { x: 0, y: cy, w: W, h: ch }, 'middle');
        L.push(card);
        L = L.concat(all);
      } else if (env.style === 'dark') {
        var dk = '#141318';
        page = env.page(dk);
        var area = { x: M, y: top, w: W - 2 * M, h: H - top - bottom };
        var st2 = stars(area.x, 0, 84, v.accent ? C.ensure(v.accent, dk, 3) : gold, '#3A3742', 'center', area.w);
        var rv2 = env.text({ id: 'review', name: 'Review', text: '“' + v.review + '”', x: area.x, y: 0, w: area.w, h: area.h - 300, font: 'Fraunces', weight: 400, size: long ? 58 : 84, min: 30, lineHeight: 1.2, align: 'center', balance: true, color: '#F6F2EA' });
        var who2 = person(area.x, 0, area.w, '#F6F2EA', '#B9B4C4', { align: 'center', size: 34 });
        var all2 = stack(st2.length ? [st2, rv2, who2] : [rv2, who2], st2.length ? [64, 56] : [56]);
        env.place(all2, area, 'middle');
        L = L.concat(all2);
      } else if (env.style === 'chat') {
        var mint = v.accent ? C.tint(v.accent, 0.78) : '#DDF1E6';
        page = env.page(mint);
        var bw = W - 2 * (M - 24), bx = M - 24;
        var maxBubble = H - top - bottom - 200;
        var pad = 64;
        var st3 = stars(bx + pad, 0, 48, gold, '#E3E8E4');
        var rv3 = env.text({ id: 'review', name: 'Review', text: v.review, x: bx + pad, y: 0, w: bw - 2 * pad, h: maxBubble * 0.74 - 2 * pad - (st3.length ? 84 : 0), font: 'Nunito', weight: 700, size: long ? 52 : 70, min: 28, lineHeight: 1.26, color: '#16211B' });
        var content = stack(st3.length ? [st3, rv3] : [rv3], [36]);
        var contentH = env.place(content, { x: 0, y: 0, w: 1, h: 1 }, 'top');
        var bubbleBody = contentH + 2 * pad;
        var bh = Math.round(bubbleBody / 0.74);
        var bubble = env.shape('speech-round', { id: 'bubble', name: 'Speech bubble', x: bx, y: 0, w: bw, h: bh, params: { radius: 48 }, fill: '#FFFFFF', shadow: { color: 'rgba(20,40,30,.10)', blur: 40, x: 0, y: 14 } });
        content.forEach(function (l) { l.y += pad; });
        var who3 = person(bx + bw * 0.1, 0, bw * 0.9, '#16211B', '#3F5248', { avatar: 104, circle: C.ensure(v.accent || '#17A37A', '#FFFFFF', 4.5), circleInk: '#FFFFFF' });
        who3.forEach(function (l) { l.y += bh + 20; });
        var all3 = [bubble].concat(content, who3);
        env.place(all3, { x: 0, y: top, w: W, h: H - top - bottom }, 'middle');
        L = L.concat(all3);
      } else if (env.style === 'product') {
        page = env.page('#FFFFFF');
        var phH = Math.round(H * (env.tall ? 0.46 : env.square ? 0.44 : 0.48));
        L.push(env.photo({ id: 'photo', name: 'Product photo', src: v.photo, x: 0, y: 0, w: W, h: phH, label: 'Product photo' }));
        var pa = { x: M, y: phH + 64, w: W - 2 * M, h: H - phH - 64 - bottom + (env.tall ? 0 : 24) };
        var st4 = stars(pa.x, 0, 48, gold, '#E6E3EA');
        var rv4 = env.text({ id: 'review', name: 'Review', text: v.review, x: pa.x, y: 0, w: pa.w, h: pa.h - 180, font: 'Lora', italic: true, weight: 400, size: long ? 46 : 62, min: 26, lineHeight: 1.26, color: '#1B1722' });
        var who4 = person(pa.x, 0, pa.w, '#1B1722', '#5E5967', { size: 30 });
        var all4 = stack(st4.length ? [st4, rv4, who4] : [rv4, who4], st4.length ? [32, 36] : [36]);
        env.place(all4, pa, 'middle');
        L = L.concat(all4);
      } else {
        var brand = v.accent || '#E8553D';
        var ink = C.readable(brand, ['#FFFFFF', '#16131C']);
        page = env.page(brand);
        var sa = { x: M, y: top, w: W - 2 * M, h: H - top - bottom };
        var mark = env.text({ id: 'mark', name: 'Quote mark', text: '“', x: sa.x, y: 0, w: 200, font: 'Fraunces', weight: 700, size: 220, lineHeight: 0.8, color: ink, opacity: 0.9 });
        var rv5 = env.text({ id: 'review', name: 'Review', text: v.review, x: sa.x, y: 0, w: sa.w, h: sa.h - 330, font: 'Fraunces', weight: 700, size: long ? 60 : 88, min: 30, lineHeight: 1.14, tracking: -0.01, color: ink });
        var st5 = stars(sa.x, 0, 50, ink, C.mix(brand, ink, 0.35));
        var who5 = person(sa.x, 0, sa.w, ink, ink, { size: 32 });
        var all5 = stack(st5.length ? [[mark], rv5, st5, who5] : [[mark], rv5, who5], st5.length ? [10, 52, 24] : [10, 52]);
        env.place(all5, sa, 'middle');
        if (v.photo) {
          var lg = 150;
          L.push(env.photo({ id: 'photo', name: 'Logo or photo', src: v.photo, x: W - M - lg, y: top, w: lg, h: lg, mask: 'ellipse', label: 'Logo' }));
        }
        L = L.concat(all5);
      }
      page.layers = L;
      return { name: 'Review — ' + v.name, pages: [page] };
    }
  });
})();
