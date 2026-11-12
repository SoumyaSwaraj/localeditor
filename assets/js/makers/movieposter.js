/* Quick maker: a movie poster of your own trip or event (V3). Genre conventions only (a names row, a big title, a
   tagline, the condensed credits block, a date); no studio names, logos or rating marks. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  function credits(v) {
    if (v.credits) return v.credits;
    var who = v.director || '';
    var names = (v.starring || []).filter(Boolean);
    var parts = [];
    if (who) parts.push('A ' + who + ' picture');
    parts.push('“' + v.title + '”');
    if (names.length) parts.push('Starring ' + names.join('  '));
    if (who) parts.push('Written and directed by ' + who);
    return parts.join('   ');
  }

  LE.makers.register({
    id: 'movieposter',
    name: 'Movie poster',
    category: 'Social',
    summary: 'Your trip or event as a film poster: title, tagline, the cast and the credits.',
    keywords: ['movie', 'film', 'poster', 'cinema', 'trip', 'holiday', 'starring', 'premiere', 'blockbuster', 'event', 'one sheet'],
    sizes: [
      { id: 'onesheet', name: 'Poster 2:3', w: 1080, h: 1620 },
      'portrait',
      'story'
    ],
    inputs: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 40, placeholder: 'The Long Way Round' },
      { key: 'tagline', label: 'Tagline', type: 'text', max: 90, placeholder: 'Four friends. One car. No plan.' },
      { key: 'starring', label: 'Starring', type: 'list', max: 4, cellMax: 28, placeholder: 'A name' },
      { key: 'date', label: 'Date line', type: 'text', max: 32, placeholder: 'Summer 2026' },
      { key: 'director', label: 'A film by', type: 'text', max: 40, placeholder: 'Maya Iyer' },
      { key: 'credits', label: 'Credits block', type: 'longtext', max: 300, maxLines: 4, hint: 'Leave empty to write it from the names above.' },
      { key: 'photo', label: 'Hero photo', type: 'photo' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'blockbuster', name: 'Blockbuster' },
      { id: 'thriller', name: 'Thriller' },
      { id: 'indie', name: 'Indie' },
      { id: 'retro', name: 'Seventies' },
      { id: 'swiss', name: 'Swiss' }
    ],
    sample: { values: {
      title: 'The Long Way Round', tagline: 'Four friends. One car. No plan.', starring: ['Maya Iyer', 'Dev Shah', 'Lina Park', 'Tom Ade'],
      date: 'Summer 2026', director: 'Maya Iyer', photo: 'sample:people-08'
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var u = W / 100;
      var top = env.tall ? 20 * u : 6 * u, bottom = env.tall ? 25 * u : 5 * u, M = 7 * u;
      var names = (v.starring || []).filter(Boolean);
      var block = credits(v);
      var L = [], page;

      function namesRow(y, w, x, color, font, size, align) {
        if (!names.length) return null;
        return env.text({ id: 'starring', name: 'Starring', text: names.join('     '), x: x, y: y, w: w, font: font || 'Oswald', weight: 700, size: size || 3.4 * u, min: 1.8 * u, maxLines: 2, uppercase: true, tracking: 0.12, align: align || 'center', color: color, balance: true });
      }
      function billing(y, w, x, color, align) {
        return env.text({ id: 'credits', name: 'Credits block', text: block, x: x, y: y, w: w, font: 'Oswald', weight: 400, size: 2.3 * u, min: 1.3 * u, maxLines: 4, lineHeight: 1.15, uppercase: true, tracking: 0.04, align: align || 'center', color: color, balance: true });
      }
      /* Stacks layers bottom-up from yBottom, with gaps; returns the top. */
      function stackUp(list, yBottom, gaps) {
        var y = yBottom;
        for (var i = list.length - 1; i >= 0; i--) { var l = list[i]; if (!l) continue; l.y = y - l.h; y = l.y - (gaps[i] || 0); }
        return y;
      }
      function scrim(y0, h, to, from) {
        return env.rect({ id: 'scrim', name: 'Shade', x: 0, y: y0, w: W, h: h, fill: { type: 'linear', angle: from ? -90 : 90, colors: [C.rgba(to, 0), C.rgba(to, 0.72), C.rgba(to, 0.96)] } });
      }

      if (style === 'blockbuster' || style === 'thriller') {
        var thr = style === 'thriller';
        var dark = thr ? '#0B0B0D' : '#0A0D14';
        var acc = v.accent || (thr ? '#E0322B' : '#F2B33D');
        page = env.page(dark);
        var heroH = v.photo ? H : Math.round(H * 0.56);
        L.push(env.photo({ id: 'photo', name: 'Hero photo', src: v.photo, x: 0, y: 0, w: W, h: heroH, label: 'Add your hero photo', focus: { x: 0.5, y: 0.35 },
          adjust: thr ? { saturation: -100, contrast: 28, exposure: -0.06, vignette: 0.4, grain: 12 } : { contrast: 10, saturation: 8, vignette: 0.3 } }));
        if (v.photo) {
          L.push(scrim(H * 0.38, H * 0.62, dark));
          L.push(scrim(0, H * 0.3, dark, true));
        }
        var white = '#FFFFFF', soft = thr ? '#C9C9CC' : '#D8DCE6';
        var accT = C.ensure(acc, dark, 4.5);
        var nr = namesRow(top, W - 2 * M, M, white);
        if (nr) L.push(nr);
        var tag = v.tagline ? env.text({ id: 'tagline', name: 'Tagline', text: v.tagline, x: M, y: 0, w: W - 2 * M, font: thr ? 'Oswald' : 'Oswald', weight: 400, size: 3.6 * u, min: 2 * u, maxLines: 2, uppercase: true, tracking: thr ? 0.3 : 0.14, align: 'center', color: thr ? soft : white, balance: true }) : null;
        var title = env.text({ id: 'title', name: 'Title', text: v.title, x: M * 0.7, y: 0, w: W - 1.4 * M, font: thr ? 'Anton' : 'Bebas Neue', weight: 400, size: (thr ? 15 : 21) * u, min: 6 * u, maxLines: 3, lineHeight: thr ? 1.0 : 0.88, uppercase: true, tracking: thr ? 0.04 : 0.01, align: 'center', color: white, balance: true });
        var rule = thr ? env.rect({ id: 'rule', name: 'Rule', x: W / 2 - 9 * u, y: 0, w: 18 * u, h: 0.6 * u, fill: acc }) : null;
        var date = v.date ? env.text({ id: 'date', name: 'Date line', text: v.date, x: M, y: 0, w: W - 2 * M, font: thr ? 'Oswald' : 'Bebas Neue', weight: thr ? 700 : 400, size: (thr ? 3.4 : 5.4) * u, min: 2 * u, maxLines: 1, uppercase: true, tracking: thr ? 0.3 : 0.08, align: 'center', color: accT }) : null;
        var bill = billing(0, W - 2 * M, M, soft);
        if (thr) {
          /* Tagline high on the page, title low. */
          if (tag) { tag.y = (nr ? nr.y + nr.h + 4 * u : top); }
          stackUp([title, rule, bill, date], H - bottom, [0, 3 * u, 3 * u, 2.4 * u]);
          L.push(title); L.push(rule); L.push(bill); if (date) L.push(date); if (tag) L.push(tag);
        } else {
          stackUp([tag, title, date, bill], H - bottom, [2 * u, 1.6 * u, 2.4 * u, 2 * u]);
          [tag, title, date, bill].forEach(function (l) { if (l) L.push(l); });
        }
        /* Without a photo the text area is the solid dark base; make sure the slot ends above it. */
        if (!v.photo) {
          var topText = Math.min.apply(null, L.filter(function (l) { return l.type === 'text' && l.id.indexOf('starring') !== 0 && l.id.indexOf('tagline') !== 0; }).map(function (l) { return l.y; }));
          var slot = L[0];
          var slotTop = nr ? nr.y + nr.h + 3 * u : top;
          if (thr && tag) slotTop = tag.y + tag.h + 3 * u;
          slot.y = slotTop; slot.x = M; slot.w = W - 2 * M; slot.h = Math.max(10 * u, topText - 3 * u - slotTop);
        }
      } else if (style === 'indie') {
        var paper = '#EFE9DE', ink = '#1E1B18', accI = C.ensure(v.accent || '#B5462B', paper, 4.5);
        page = env.page(paper);
        var y = top;
        var n2 = namesRow(y, W - 2 * M, M, ink, 'Oswald', 2.9 * u);
        if (n2) { L.push(n2); y = n2.y + n2.h + 3 * u; }
        var tl = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: 0, w: W - 2 * M, font: 'Playfair Display', weight: 700, italic: true, size: 12 * u, min: 5 * u, maxLines: 3, lineHeight: 1.0, align: 'center', color: ink, balance: true });
        var tg = v.tagline ? env.text({ id: 'tagline', name: 'Tagline', text: v.tagline, x: M + 4 * u, y: 0, w: W - 2 * M - 8 * u, font: 'Playfair Display', weight: 400, italic: true, size: 3.8 * u, min: 2 * u, maxLines: 2, align: 'center', color: accI, balance: true }) : null;
        var dt = v.date ? env.text({ id: 'date', name: 'Date line', text: v.date, x: M, y: 0, w: W - 2 * M, font: 'Oswald', weight: 700, size: 3.2 * u, min: 1.8 * u, maxLines: 1, uppercase: true, tracking: 0.24, align: 'center', color: ink }) : null;
        var bl = billing(0, W - 2 * M, M, '#4A443D');
        var footTop = stackUp([tl, tg, bl, dt], H - bottom, [0, 2 * u, 3 * u, 2 * u]);
        var phY = y, phH = footTop - 4 * u - phY;
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: M, y: phY, w: W - 2 * M, h: Math.max(12 * u, phH), label: 'Add your photo', adjust: { warmth: 8, fade: 10, saturation: -10, grain: 10 } }));
        L.push(env.rect({ id: 'photo-rule', name: 'Rule', x: M, y: phY + Math.max(12 * u, phH) + 1.6 * u, w: W - 2 * M, h: Math.max(2, 0.25 * u), fill: ink }));
        [tl, tg, bl, dt].forEach(function (l) { if (l) L.push(l); });
      } else if (style === 'retro') {
        var base = v.accent || '#E36A2E';
        var cream = '#F6E7C8', brown = '#3B2416';
        page = env.page(cream);
        var bands = [C.shade(base, 0.35), base, C.tint(base, 0.35)];
        var t3 = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: 0, w: W - 2 * M, font: 'Abril Fatface', weight: 400, size: 11 * u, min: 4.5 * u, maxLines: 2, lineHeight: 1.0, align: 'center', color: brown, balance: true });
        var g3 = v.tagline ? env.text({ id: 'tagline', name: 'Tagline', text: v.tagline, x: M, y: 0, w: W - 2 * M, font: 'Righteous', weight: 400, size: 3.4 * u, min: 1.8 * u, maxLines: 2, align: 'center', color: C.ensure(C.shade(base, 0.2), cream, 4.5), balance: true }) : null;
        var n3 = namesRow(0, W - 2 * M, M, brown, 'Oswald', 2.8 * u);
        var d3 = v.date ? env.text({ id: 'date', name: 'Date line', text: v.date, x: M, y: 0, w: W - 2 * M, font: 'Righteous', weight: 400, size: 3.6 * u, min: 1.8 * u, maxLines: 1, uppercase: true, tracking: 0.12, align: 'center', color: brown }) : null;
        var b3 = billing(0, W - 2 * M, M, '#5A4130');
        var list3 = [g3, t3, n3, b3, d3];
        /* Type first, from the bottom up; the sunburst and the round photo take what is left above it. */
        var textTop = stackUp(list3, H - bottom, [1.6 * u, 2 * u, 2 * u, 1.6 * u, 0]);
        var panelY = textTop - 1.5 * u;
        var r = Math.min(W * 0.46, (panelY - 3 * u - top) / 2);
        var cy = panelY - 3 * u - r;
        bands.forEach(function (c, i) {
          var rr = r + (bands.length - i) * 5 * u;
          L.push(env.ellipse({ id: 'band', name: 'Band', x: W / 2 - rr, y: cy - rr, w: rr * 2, h: rr * 2, fill: c }));
        });
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: W / 2 - r, y: cy - r, w: r * 2, h: r * 2, mask: 'ellipse', label: 'Add your photo', adjust: { warmth: 18, fade: 14, saturation: -6, grain: 14 } }));
        L.push(env.rect({ id: 'panel', name: 'Panel', x: 0, y: panelY, w: W, h: H - panelY, fill: cream }));
        list3.forEach(function (l) { if (l) L.push(l); });
      } else {
        var bgc = v.accent || '#D7381F';
        for (var g = 0; g < 10 && C.contrast(C.readable(bgc, ['#111111', '#FFFFFF']), bgc) < 4.6; g++) bgc = C.shade(bgc, 0.08);
        page = env.page(bgc);
        var ink2 = C.readable(bgc, ['#111111', '#FFFFFF']);
        var stripH = H * (env.tall ? 0.3 : 0.32);
        var sy = H * (env.tall ? 0.24 : 0.12);
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: sy, w: W, h: stripH, label: 'Add your photo', adjust: { saturation: -100, contrast: 18 }, blend: 'source-over' }));
        var gx = M, gw = W - 2 * M;
        var t4 = env.text({ id: 'title', name: 'Title', text: v.title, x: gx, y: sy + stripH + 4 * u, w: gw, font: 'Archivo Black', weight: 400, size: 13 * u, min: 5 * u, maxLines: 3, lineHeight: 0.95, tracking: -0.03, color: ink2 });
        L.push(t4);
        var col = (gw - 4 * u) / 2;
        var yy = t4.y + t4.h + 4 * u;
        L.push(env.rect({ id: 'rule', name: 'Rule', x: gx, y: yy - 2 * u, w: gw, h: Math.max(2, 0.35 * u), fill: ink2 }));
        var leftCol = [], rightCol = [];
        if (v.tagline) leftCol.push(env.text({ id: 'tagline', name: 'Tagline', text: v.tagline, x: gx, y: 0, w: col, font: 'Inter', weight: 700, size: 3.4 * u, min: 1.8 * u, maxLines: 4, color: ink2 }));
        if (v.date) leftCol.push(env.text({ id: 'date', name: 'Date line', text: v.date, x: gx, y: 0, w: col, font: 'Inter', weight: 400, size: 3.4 * u, min: 1.8 * u, maxLines: 2, color: ink2 }));
        if (names.length) rightCol.push(env.text({ id: 'starring', name: 'Starring', text: names.join('\n'), x: gx + col + 4 * u, y: 0, w: col, font: 'Inter', weight: 700, size: 3.1 * u, min: 1.6 * u, maxLines: 8, lineHeight: 1.25, color: ink2 }));
        rightCol.push(env.text({ id: 'credits', name: 'Credits block', text: block, x: gx + col + 4 * u, y: 0, w: col, font: 'Inter', weight: 400, size: 2.2 * u, min: 1.3 * u, maxLines: 8, lineHeight: 1.3, color: ink2 }));
        var maxY = H - bottom;
        function place(colList) {
          var y2 = yy;
          colList.forEach(function (l) { l.y = y2; y2 += l.h + 2 * u; });
          return y2;
        }
        var e1 = place(leftCol), e2 = place(rightCol);
        var over = Math.max(e1, e2) - 2 * u - maxY;
        if (over > 0) {
          /* Push the whole block up into the strip's margin rather than off the page. */
          var lift4 = Math.min(over, sy - top);
          L.forEach(function (l) { l.y -= lift4; }); leftCol.concat(rightCol).forEach(function (l) { l.y -= lift4; });
        }
        L = L.concat(leftCol, rightCol);
      }
      page.layers = L;
      return { name: 'Poster — ' + v.title, pages: [page] };
    }
  });
})();
