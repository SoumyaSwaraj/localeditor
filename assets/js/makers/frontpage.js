/* Quick maker: newspaper front page of your own news (V3). A made-up masthead in the person's words; body text flows
   through two or three columns and ends with "Continued on page 2" when it does not fit. No real paper's name or look. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var T = {
    broadsheet: { paper: '#F3EFE4', ink: '#171512', muted: '#4A453D', mast: 'Playfair Display', mastW: 700, mastUpper: false, head: 'Libre Baskerville', headW: 700, headUpper: false, body: 'EB Garamond', bodyLH: 1.22, cols: 3, photo: { saturation: -100, contrast: 12, grain: 10 }, rule: '#171512' },
    tabloid: { paper: '#FFFFFF', ink: '#111111', muted: '#3D3D3D', band: '#D21F1B', mast: 'Anton', mastW: 400, mastUpper: true, head: 'Anton', headW: 400, headUpper: true, body: 'Inter', bodyLH: 1.3, cols: 2, photo: { contrast: 10, saturation: 10 }, rule: '#111111' },
    vintage: { paper: '#E8DABD', ink: '#2A2016', muted: '#54452F', mast: 'Abril Fatface', mastW: 400, mastUpper: false, head: 'Playfair Display', headW: 700, headUpper: true, body: 'Lora', bodyLH: 1.25, cols: 3, photo: { saturation: -100, warmth: 30, fade: 18, grain: 18, vignette: 0.3 }, rule: '#2A2016' },
    modern: { paper: '#FFFFFF', ink: '#121212', muted: '#4A4A4A', mast: 'Fraunces', mastW: 700, mastUpper: false, head: 'Fraunces', headW: 700, headUpper: false, body: 'Merriweather', bodyLH: 1.4, cols: 2, photo: {}, rule: '#121212' }
  };

  LE.makers.register({
    id: 'frontpage',
    name: 'Newspaper front page',
    category: 'Social',
    summary: 'Your news on a front page: masthead, headline, a photo and columns of text.',
    keywords: ['newspaper', 'front page', 'news', 'headline', 'announcement', 'birth', 'wedding', 'graduation', 'retirement', 'press', 'gazette', 'extra'],
    sizes: [
      'portrait',
      'story',
      Object.assign(LE.makers.paperSize('a4'), { name: 'A4 print' })
    ],
    inputs: [
      { key: 'masthead', label: 'Paper name', type: 'text', required: true, max: 28, placeholder: 'The Weekend Wanderer' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'edition', label: 'Edition line', type: 'text', max: 40, placeholder: 'Vol. I · No. 1 · Free' },
      { key: 'headline', label: 'Headline', type: 'text', required: true, max: 80, placeholder: 'Local Family Finally Reaches the Sea' },
      { key: 'subhead', label: 'Sub-headline', type: 'text', max: 140, placeholder: 'After six hours, two flat tyres and one lost hat, the Rao family arrives in Gokarna' },
      { key: 'dateline', label: 'Dateline', type: 'text', max: 24, placeholder: 'GOKARNA' },
      { key: 'body', label: 'Story', type: 'longtext', max: 1200, maxLines: 12, placeholder: 'Write the story here.' },
      { key: 'photo', label: 'Photo', type: 'photo' },
      { key: 'caption', label: 'Caption', type: 'text', max: 110, placeholder: 'The sea, as seen by everyone at once.' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'broadsheet', name: 'Broadsheet' },
      { id: 'tabloid', name: 'Tabloid' },
      { id: 'vintage', name: 'Vintage' },
      { id: 'modern', name: 'Modern daily' }
    ],
    sample: { values: {
      masthead: 'The Weekend Wanderer', date: '2026-11-14', edition: 'Vol. I · No. 1 · Free', headline: 'Local Family Finally Reaches the Sea',
      subhead: 'After six hours, two flat tyres and one lost hat, the Raos arrive in Gokarna', dateline: 'GOKARNA',
      body: 'The Rao family reached the beach shortly before sunset on Saturday, witnesses confirmed, ending a journey that began with confident promises of an early start.\n\n“We left at nine,” said Mr Rao, who had planned to leave at six. The family stopped twice for tyres, once for chai and four times for photographs of cows.\n\nThe youngest Rao, aged seven, described the sea as “very big” and “mostly wet”. A hat, last seen near Ankola, remains missing. Officials say the search continues.\n\nThe family plans to stay until Tuesday, or until the biscuits run out.',
      photo: 'sample:travel-04', caption: 'The sea, as seen by everyone at once.'
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var S = Object.assign({}, T[style] || T.broadsheet);
      var u = W / 100;
      var top = env.tall ? 18 * u : 4.5 * u, bottom = env.tall ? 22 * u : 4.5 * u, M = 5 * u;
      var cw = W - 2 * M;
      var acc = v.accent || (style === 'tabloid' ? S.band : style === 'modern' ? '#C2410C' : S.ink);
      var page = env.page(S.paper), L = [];
      var ink = S.ink, muted = S.muted;
      var y = top;
      var dateTxt = v.date ? env.date.format(v.date, 'dddd, D MMMM YYYY') : '';

      /* Masthead */
      if (style === 'tabloid') {
        var band = acc;
        for (var g = 0; g < 12 && C.contrast('#FFFFFF', band) < 4.6; g++) band = C.shade(band, 0.1);
        var mt = env.text({ id: 'masthead', name: 'Masthead', text: v.masthead, x: M + 2 * u, y: 0, w: cw - 4 * u, font: S.mast, weight: S.mastW, size: 11 * u, min: 4 * u, maxLines: 1, uppercase: true, tracking: 0.01, color: '#FFFFFF' });
        var bh = mt.h + 4 * u;
        L.push(env.rect({ id: 'mast-band', name: 'Masthead band', x: M, y: y, w: cw, h: bh, fill: band }));
        mt.y = y + 2 * u; L.push(mt);
        y += bh + 1.4 * u;
        var meta = [dateTxt, v.edition].filter(Boolean).join('   ·   ');
        if (meta) { var mm = env.text({ id: 'edition', name: 'Edition line', text: meta, x: M, y: y, w: cw, font: 'Inter', weight: 700, size: 2.2 * u, min: 1.4 * u, maxLines: 1, uppercase: true, tracking: 0.1, color: ink }); L.push(mm); y = mm.y + mm.h + 1.4 * u; }
        L.push(env.rect({ id: 'rule', name: 'Rule', x: M, y: y, w: cw, h: Math.max(2, 0.5 * u), fill: ink })); y += 2.6 * u;
      } else {
        var mt2 = env.text({ id: 'masthead', name: 'Masthead', text: v.masthead, x: M, y: y, w: cw, font: S.mast, weight: S.mastW, size: (style === 'modern' ? 9 : 10.5) * u, min: 4 * u, maxLines: 1, align: style === 'modern' ? 'left' : 'center', tracking: style === 'modern' ? -0.03 : -0.01, color: ink });
        L.push(mt2); y = mt2.y + mt2.h + 1.2 * u;
        var thick = style === 'modern' ? Math.max(2, 0.25 * u) : Math.max(3, 0.45 * u);
        L.push(env.rect({ id: 'rule', name: 'Rule', x: M, y: y, w: cw, h: thick, fill: style === 'modern' ? acc : S.rule }));
        if (style !== 'modern') L.push(env.rect({ id: 'rule-thin', name: 'Rule', x: M, y: y + thick + 0.5 * u, w: cw, h: Math.max(1, 0.12 * u), fill: S.rule }));
        y += thick + 1.4 * u;
        var lt = env.text({ id: 'date', name: 'Date', text: dateTxt || ' ', x: M, y: y, w: cw * 0.5, font: style === 'modern' ? 'Inter' : S.body, weight: 700, size: 2.3 * u, min: 1.4 * u, maxLines: 1, uppercase: style !== 'modern', tracking: 0.06, color: ink });
        var rt = v.edition ? env.text({ id: 'edition', name: 'Edition line', text: v.edition, x: M + cw * 0.5, y: y, w: cw * 0.5, font: style === 'modern' ? 'Inter' : S.body, weight: 700, size: 2.3 * u, min: 1.4 * u, maxLines: 1, uppercase: style !== 'modern', tracking: 0.06, align: 'right', color: ink }) : null;
        L.push(lt); if (rt) L.push(rt);
        y = Math.max(lt.y + lt.h, rt ? rt.y + rt.h : 0) + 1 * u;
        L.push(env.rect({ id: 'rule-2', name: 'Rule', x: M, y: y, w: cw, h: Math.max(1, 0.15 * u), fill: S.rule }));
        y += 2.6 * u;
      }
      if (style === 'vintage') {
        var ex = env.text({ id: 'kicker', name: 'Kicker', text: 'Extra! Extra!', x: M, y: y, w: cw, font: S.head, weight: 700, italic: true, size: 3.2 * u, min: 2 * u, maxLines: 1, align: 'center', color: C.ensure(v.accent || '#8C2A1B', S.paper, 4.5) });
        L.push(ex); y = ex.y + ex.h + 0.6 * u;
      }
      /* Headline and sub-headline */
      var hl = env.text({ id: 'headline', name: 'Headline', text: v.headline, x: M, y: y, w: cw, font: S.head, weight: S.headW, size: (style === 'tabloid' ? (env.tall ? 14 : 11.5) : style === 'vintage' ? 8 : 8.5) * u, min: 4 * u, maxLines: style === 'tabloid' ? 4 : 3, lineHeight: style === 'tabloid' ? 0.95 : 1.08, uppercase: S.headUpper, tracking: style === 'tabloid' ? 0 : -0.015, align: style === 'vintage' ? 'center' : 'left', color: ink, balance: style === 'vintage' });
      L.push(hl); y = hl.y + hl.h + 1.6 * u;
      if (v.subhead) {
        var subColor = style === 'modern' ? C.ensure(acc, S.paper, 4.5) : muted;
        var sh = env.text({ id: 'subhead', name: 'Sub-headline', text: v.subhead, x: M, y: y, w: cw, font: style === 'tabloid' ? 'Inter' : S.head, weight: style === 'tabloid' ? 700 : 400, italic: style !== 'tabloid', size: 3.6 * u, min: 2 * u, maxLines: 3, lineHeight: 1.25, align: style === 'vintage' ? 'center' : 'left', color: subColor, background: style === 'tabloid' ? { color: '#FFE14D', padding: 0.6 * u } : null, balance: style === 'vintage' });
        if (style === 'tabloid') { sh.x += 0.6 * u; sh.y += 0.6 * u; }
        L.push(sh); y = sh.y + sh.h + (style === 'tabloid' ? 2.4 : 2) * u;
      }
      /* Photo, caption and columns share what is left. */
      var avail = H - bottom - y;
      var bodyText = v.body ? ((v.dateline ? v.dateline.toUpperCase() + ' — ' : '') + v.body) : '';
      var ncol = S.cols, gap = 3 * u, colW = (cw - gap * (ncol - 1)) / ncol;
      var bodyFont = { font: S.body, weight: 400, lineHeight: S.bodyLH };
      var capH = 0, cap = null;
      function capLayer(yy) {
        if (!v.caption) return null;
        return env.text({ id: 'caption', name: 'Caption', text: v.caption, x: M, y: yy, w: cw, font: style === 'tabloid' || style === 'modern' ? 'Inter' : S.body, weight: style === 'tabloid' ? 700 : 400, italic: style === 'broadsheet' || style === 'vintage', size: 2.2 * u, min: 1.5 * u, maxLines: 2, color: muted });
      }
      cap = capLayer(0); capH = cap ? cap.h + 1.2 * u : 0;
      var photoH = v.photo || !bodyText ? Math.min(avail * (bodyText ? 0.5 : 1) - capH, cw * 0.62) : Math.min(avail * 0.32, cw * 0.4);
      if (!bodyText) photoH = avail - capH;
      var minColH = 16 * u;
      /* Flow: try sizes from big to small; if nothing fits, give the columns more room from the photo, then cut. */
      function flow(colH) {
        for (var s = 2.9 * u; s >= 1.75 * u; s -= 0.1 * u) {
          var f = env.fit({ text: bodyText, w: colW, size: s, min: s, font: bodyFont.font, weight: 400, lineHeight: bodyFont.lineHeight });
          var per = Math.floor(colH / (s * bodyFont.lineHeight));
          if (per >= 1 && f.lines.length <= per * ncol) return { size: s, lines: f.lines, per: per, cut: false };
        }
        var s2 = 1.75 * u, f2 = env.fit({ text: bodyText, w: colW, size: s2, min: s2, font: bodyFont.font, weight: 400, lineHeight: bodyFont.lineHeight });
        var per2 = Math.max(1, Math.floor(colH / (s2 * bodyFont.lineHeight)));
        return { size: s2, lines: f2.lines, per: per2, cut: f2.lines.length > per2 * ncol };
      }
      var fl = null;
      if (bodyText) {
        for (var it = 0; it < 12; it++) {
          var colH = avail - photoH - capH - 2.6 * u;
          if (colH < minColH) { photoH = Math.max(14 * u, avail - capH - 2.6 * u - minColH); continue; }
          fl = flow(colH);
          if (!fl.cut || photoH <= 18 * u) break;
          photoH = Math.max(18 * u, photoH - 6 * u);
        }
      }
      L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: M, y: y, w: cw, h: Math.max(10 * u, photoH), label: 'Add a photo', adjust: S.photo }));
      y += Math.max(10 * u, photoH) + 1 * u;
      if (cap) { cap.y = y; L.push(cap); y = cap.y + cap.h + 1.6 * u; } else y += 1.6 * u;
      if (fl) {
        var lines = fl.lines.slice();
        while (lines.length && !lines[0].trim()) lines.shift();
        var per = fl.per;
        if (fl.cut) {
          lines = lines.slice(0, per * ncol - 1);
          lines.push('Continued on page 2 ›');
        }
        /* Do not start a column with a blank line. */
        var colsTxt = [];
        for (var c = 0; c < ncol; c++) {
          var part = lines.splice(0, per);
          while (part.length && !part[0].trim()) { part.shift(); if (lines.length) part.push(lines.shift()); }
          if (part.length) colsTxt.push(part);
        }
        colsTxt.forEach(function (part, i) {
          var x = M + i * (colW + gap);
          L.push(env.text({ id: 'column-' + (i + 1), name: 'Column ' + (i + 1), text: part.join('\n'), x: x, y: y, w: colW, font: bodyFont.font, weight: 400, size: fl.size, min: fl.size, lineHeight: bodyFont.lineHeight, color: ink }));
          if (i > 0) L.push(env.rect({ id: 'column-rule', name: 'Column rule', x: x - gap / 2 - 0.5, y: y, w: Math.max(1, 0.1 * u), h: Math.min(per, part.length) * fl.size * bodyFont.lineHeight, fill: C.mix(S.paper, ink, 0.45) }));
        });
      }
      page.layers = L;
      return { name: v.masthead + ' — ' + v.headline, pages: [page] };
    }
  });
})();
