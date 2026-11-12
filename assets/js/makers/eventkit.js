/* Quick maker: event kit (V14). One set of details becomes a set of pages with one identity: an invitation (4:5),
   a story (9:16), a banner (16:9 or 3:1) and name-tag sheets (A4 or US Letter, 8 tags a sheet, light cut guides).
   The first multi-page maker: build returns several pages, each with its own size (env.page(bg, { w, h })). */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var PAPER = { a4: { w: 1240, h: 1754, name: 'A4' }, letter: { w: 1275, h: 1650, name: 'US Letter' } };
  var TAGS = 8;
  var T = {
    modern: { bg: '#F3EFE7', ink: '#1B1A20', muted: '#4B4852', accent: '#FF5A36', display: 'Syne', dw: 700, body: 'Inter', align: 'left', tight: -0.03 },
    elegant: { bg: '#1E2B26', ink: '#F4ECDD', muted: '#D3CAB8', accent: '#D2B072', display: 'Cormorant Garamond', dw: 700, body: 'Montserrat', align: 'center', tight: -0.01 },
    party: { bg: '#4B1FB8', bg2: '#C8215F', ink: '#FFFFFF', muted: '#F6ECFF', accent: '#FFE15A', display: 'Righteous', dw: 400, body: 'Poppins', align: 'center', tight: 0 },
    minimal: { bg: '#FFFFFF', ink: '#111111', muted: '#55565C', accent: '#2F5BD3', display: 'Space Grotesk', dw: 700, body: 'Space Grotesk', align: 'left', tight: -0.035 }
  };

  LE.makers.register({
    id: 'eventkit',
    name: 'Event kit',
    category: 'Events',
    summary: 'One set of details: invitation, story, banner and printable name tags that match.',
    keywords: ['event', 'kit', 'invitation', 'story', 'banner', 'name tag', 'badge', 'meetup', 'party', 'conference', 'workshop', 'launch', 'set'],
    sizes: [
      { id: 'a4', name: 'Tags on A4', w: 1080, h: 1350 },
      { id: 'letter', name: 'Tags on Letter', w: 1080, h: 1350 }
    ],
    inputs: [
      { key: 'event', label: 'Event name', type: 'text', required: true, max: 50, placeholder: 'Rooftop Supper Club' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'time', label: 'Time', type: 'text', max: 30, placeholder: '7 pm till late' },
      { key: 'place', label: 'Place', type: 'text', max: 70, placeholder: 'The Terrace, 4th floor' },
      { key: 'host', label: 'Hosted by', type: 'text', max: 50, placeholder: 'Meera and friends' },
      { key: 'details', label: 'One line of details', type: 'text', max: 90, placeholder: 'Bring a dish to share' },
      { key: 'photo', label: 'Photo', type: 'photo' },
      { key: 'accent', label: 'Colour', type: 'color' },
      { key: 'banner', label: 'Banner shape', type: 'choice', options: [{ id: 'wide', name: '16:9' }, { id: 'header', name: '3:1' }], default: 'wide' },
      { key: 'names', label: 'Names for tags', type: 'list', max: 24, cellMax: 32, placeholder: 'A name', hint: 'Eight tags a sheet. Leave empty for blank tags to write on.' }
    ],
    styles: [
      { id: 'modern', name: 'Modern' },
      { id: 'elegant', name: 'Elegant' },
      { id: 'party', name: 'Party' },
      { id: 'minimal', name: 'Minimal' }
    ],
    sample: { values: {
      event: 'Rooftop Supper Club', date: '2026-12-12', time: '7 pm till late', place: 'The Terrace, 4th floor', host: 'Meera and friends',
      details: 'Bring a dish to share', photo: 'sample:travel-07', names: ['Meera', 'Arjun Rao', 'Lena', 'Kofi Mensah', 'Sam']
    } },
    build: function (v, env) {
      var C = env.color, style = env.style;
      var S = Object.assign({}, T[style] || T.modern);
      if (v.accent) {
        if (style === 'party') {
          S.bg = C.shade(v.accent, 0.5); S.bg2 = C.shade(v.accent, 0.18);
          while (C.contrast('#FFFFFF', S.bg2) < 4.6) S.bg2 = C.shade(S.bg2, 0.12);
          while (C.contrast('#FFFFFF', S.bg) < 4.6) S.bg = C.shade(S.bg, 0.12);
        } else S.accent = v.accent;
      }
      var party = style === 'party';
      var bgSolid = party ? S.bg2 : S.bg; /* the lighter end, for contrast decisions */
      var ink = C.readable(bgSolid, [S.ink]), muted = C.readable(bgSolid, [S.muted, S.ink]);
      var acc = party ? S.accent : C.ensure(S.accent, S.bg, 3), accText = party ? S.accent : C.ensure(S.accent, S.bg, 4.5);
      var dateTxt = v.date ? env.date.format(v.date, 'dddd D MMMM YYYY') : '';
      var when = [dateTxt, v.time].filter(Boolean).join(' · ');
      var paper = PAPER[env.size.id] || PAPER.a4;

      function bgOf() { return party ? { type: 'gradient', kind: 'linear', angle: 150, colors: [S.bg, S.bg2] } : S.bg; }
      /* The event's details as a stack at scale s inside width w. kind: invite | story | banner */
      function info(kind, x, w, u, s, align) {
        var out = [], y = 0;
        function push(l, gap) { l.y = y; out.push(l); y += l.h + (gap || 0); return l; }
        var big = kind === 'story' ? 1.25 : kind === 'header' ? 0.9 : 1;
        var kick = kind === 'story' ? 'Save the date' : kind === 'invite' ? 'You’re invited' : (v.host ? 'Hosted by ' + v.host : '');
        if (kick) push(env.text({ id: 'kicker', name: 'Kicker', text: kick, x: x, y: 0, w: w, font: S.body, weight: 700, size: 3 * u * s * big, min: 1.6 * u, maxLines: 2, uppercase: true, tracking: 0.16, align: align, color: accText }), 2 * u * s);
        push(env.text({ id: 'event', name: 'Event name', text: v.event, x: x, y: 0, w: w, font: S.display, weight: S.dw, size: (kind === 'header' ? 13 : 11.5) * u * s * big, min: 4 * u, maxLines: 3, lineHeight: style === 'elegant' ? 1.05 : 1.0, tracking: S.tight, align: align, color: ink, balance: true }), 3.2 * u * s);
        if (style === 'elegant' || style === 'minimal') {
          var rw = style === 'elegant' ? 12 * u : 9 * u;
          out.push(env.line({ id: 'rule', name: 'Rule', x: align === 'center' ? x + (w - rw) / 2 : x, y: y, w: rw, width: Math.max(2, 0.35 * u), color: acc }));
          y += 3 * u * s;
        }
        if (when) push(env.text({ id: 'when', name: 'Date and time', text: when, x: x, y: 0, w: w, font: S.body, weight: 700, size: 3.6 * u * s * big, min: 1.8 * u, maxLines: 2, align: align, color: ink, balance: true }), 1 * u * s);
        if (v.place) push(env.text({ id: 'place', name: 'Place', text: v.place, x: x, y: 0, w: w, font: S.body, weight: 400, size: 3.6 * u * s * big, min: 1.8 * u, maxLines: 2, align: align, color: ink, balance: true }), 2.6 * u * s);
        if (kind !== 'header') {
          if (v.details) push(env.text({ id: 'details', name: 'Details', text: v.details, x: x, y: 0, w: w, font: S.body, weight: 400, italic: style === 'elegant' && false, size: 3 * u * s * big, min: 1.6 * u, maxLines: 3, align: align, color: muted, balance: true }), 1.4 * u * s);
          if (v.host && kind !== 'banner') push(env.text({ id: 'host', name: 'Host', text: 'Hosted by ' + v.host, x: x, y: 0, w: w, font: S.body, weight: 700, size: 2.7 * u * s * big, min: 1.5 * u, maxLines: 2, uppercase: true, tracking: 0.1, align: align, color: muted, balance: true }));
        }
        return { layers: out, h: y };
      }
      function fitInfo(kind, box, u, align, s0) {
        var s = s0 || 1, res;
        for (var i = 0; i < 18; i++) { res = info(kind, box.x, box.w, u, s, align); if (res.h <= box.h) break; s *= 0.93; }
        var oy = box.y + (box.h - res.h) / 2;
        if (box.valign === 'top') oy = box.y;
        if (box.valign === 'bottom') oy = box.y + box.h - res.h;
        res.layers.forEach(function (l) { l.y += oy; });
        return res.layers;
      }
      function photo(x, y, w, h, opts) {
        var spec = Object.assign({ id: 'photo', name: 'Photo', src: v.photo, x: x, y: y, w: w, h: h, label: 'Add a photo' }, opts || {});
        return env.photo(spec);
      }
      function confetti(W, H, u, avoid) {
        var cols = [S.accent, '#FFFFFF', '#7FE3C9', '#FF9CC0'], d = '';
        for (var k = 0; k < 40; k++) {
          var cx = env.random() * W, cy = env.random() * H;
          if (avoid && cx > avoid.x && cx < avoid.x + avoid.w && cy > avoid.y && cy < avoid.y + avoid.h) continue;
          var r = (0.4 + env.random() * 0.7) * u;
          d += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + cols[k % cols.length] + '" fill-opacity="0.9"/>';
        }
        return env.svg({ id: 'confetti', name: 'Confetti', markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '">' + d + '</svg>', x: 0, y: 0, w: W, h: H });
      }

      /* Invitation (4:5) and story (9:16): photo above, details below. */
      function vertical(kind, W, H) {
        var u = W / 100, tall = kind === 'story';
        var page = env.page(bgOf(), { w: W, h: H }), L = [];
        var top = tall ? 20 * u : 7 * u, bottom = tall ? 25 * u : 7 * u, M = 8 * u;
        var align = S.align, text = { x: M, w: W - 2 * M };
        var ph = v.photo ? Math.round(H * (tall ? 0.34 : 0.4)) : 0;
        if (style === 'modern') {
          L.push(env.ellipse({ id: 'disc', name: 'Disc', x: W - 46 * u, y: -18 * u, w: 70 * u, h: 70 * u, fill: acc }));
          if (v.photo) L.push(photo(M, top, W - 2 * M - 10 * u, ph, { radius: 2 * u }));
        } else if (style === 'elegant') {
          L.push(env.rect({ id: 'frame', name: 'Frame', x: 4 * u, y: 4 * u, w: W - 8 * u, h: H - 8 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.3 * u), color: acc } }));
          if (v.photo) { var aw = Math.min(W * 0.56, ph * 0.8); L.push(photo((W - aw) / 2, top, aw, ph, { maskPath: 'M0 ' + ph + 'L0 ' + (aw / 2) + 'A' + (aw / 2) + ' ' + (aw / 2) + ' 0 0 1 ' + aw + ' ' + (aw / 2) + 'L' + aw + ' ' + ph + 'Z' })); }
        } else if (party) {
          if (v.photo) { var cd = Math.min(ph, W * 0.62); ph = cd; L.push(photo((W - cd) / 2, top, cd, cd, { mask: 'ellipse', border: { width: 1.4 * u, color: S.accent } })); }
        } else {
          if (v.photo) { ph = Math.round(H * (tall ? 0.42 : 0.46)); L.push(photo(0, 0, W, ph)); }
          L.push(env.rect({ id: 'block', name: 'Colour block', x: M, y: v.photo ? ph - 2 * u : top, w: 14 * u, h: 4 * u, fill: acc }));
        }
        var ty = v.photo ? (style === 'minimal' ? ph + 6 * u : top + ph + 5 * u) : top + (style === 'minimal' ? 8 * u : 0);
        var box = { x: text.x, y: ty, w: text.w - (style === 'modern' && !v.photo ? 12 * u : 0), h: H - bottom - ty, valign: v.photo ? 'top' : 'middle' };
        if (style === 'modern' && !v.photo) box.valign = 'bottom';
        var lay = fitInfo(kind, box, u, align, tall ? 1.15 : 1);
        if (party) L.push(confetti(W, H, u, { x: box.x - 2 * u, y: Math.min(ty, top), w: box.w + 4 * u, h: H - bottom - Math.min(ty, top) }));
        page.layers = L.concat(lay);
        return page;
      }
      /* Banner: details left, photo right. */
      function banner() {
        var header = v.banner === 'header';
        var W = header ? 1500 : 1920, H = header ? 500 : 1080;
        var u = H / (header ? 56 : 100);
        var page = env.page(bgOf(), { w: W, h: H }), L = [];
        var M = (header ? 5 : 7) * u;
        var pw = v.photo ? Math.round(W * (header ? 0.3 : 0.44)) : 0;
        var tb = { x: M, y: M, w: W - pw - 2 * M - (v.photo ? 2 * u : 0), h: H - 2 * M, valign: 'middle' };
        if (style === 'modern') {
          L.push(env.ellipse({ id: 'disc', name: 'Disc', x: W - 36 * u, y: -22 * u, w: 56 * u, h: 56 * u, fill: acc }));
          if (v.photo) L.push(photo(W - pw - M, M, pw, H - 2 * M, { radius: 2 * u }));
          if (!v.photo) tb.w = W - 2 * M - 40 * u;
        } else if (style === 'elegant') {
          L.push(env.rect({ id: 'frame', name: 'Frame', x: 2.4 * u, y: 2.4 * u, w: W - 4.8 * u, h: H - 4.8 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.3 * u), color: acc } }));
          if (v.photo) L.push(photo(W - pw - M, M, pw, H - 2 * M));
        } else if (party) {
          if (v.photo) { var cd = Math.min(pw, H - 2 * M); L.push(photo(W - M - cd - (pw - cd) / 2, (H - cd) / 2, cd, cd, { mask: 'ellipse', border: { width: 1.2 * u, color: S.accent } })); }
        } else {
          if (v.photo) L.push(photo(W - pw, 0, pw, H));
          L.push(env.rect({ id: 'block', name: 'Colour block', x: 0, y: 0, w: 1.6 * u, h: H, fill: acc }));
        }
        var lay = fitInfo(header ? 'header' : 'banner', tb, u, S.align === 'center' && v.photo ? 'left' : S.align, header ? 1.1 : 1.4);
        if (party) L.push(confetti(W, H, u, { x: tb.x, y: tb.y, w: tb.w, h: tb.h }));
        page.layers = L.concat(lay);
        return page;
      }
      /* Name tags: 2 × 4 per sheet on white paper, light dashed cut guides along every edge, a band in the kit's colours. */
      function sheets() {
        var names = (v.names || []).slice(0, 24);
        var count = Math.max(1, Math.ceil(names.length / TAGS));
        var out = [];
        var W = paper.w, H = paper.h, m = Math.round(W * 0.05);
        var cols = 2, rows = TAGS / cols;
        var tw = (W - 2 * m) / cols, th = (H - 2 * m) / rows;
        var band = party ? S.bg : style === 'elegant' ? S.bg : style === 'minimal' ? '#FFFFFF' : S.accent;
        var bandInk = C.readable(band, [party || style === 'elegant' ? S.ink : '#FFFFFF', '#16131C']);
        var nameInk = style === 'elegant' ? C.ensure(S.bg, '#FFFFFF', 4.5) : C.readable('#FFFFFF', [style === 'party' ? S.bg : S.ink]);
        for (var sh = 0; sh < count; sh++) {
          var page = env.page('#FFFFFF', { w: W, h: H }), L = [];
          for (var i = 0; i < TAGS; i++) {
            var cx = m + (i % cols) * tw, cy = m + Math.floor(i / cols) * th;
            var nm = names[sh * TAGS + i] || '';
            var pad = tw * 0.08, bh = th * 0.24;
            if (style === 'minimal') L.push(env.rect({ id: 'tag-bar', name: 'Tag bar', x: cx, y: cy, w: tw * 0.04, h: th, fill: acc }));
            else L.push(env.rect({ id: 'tag-band', name: 'Tag band', x: cx, y: cy, w: tw, h: bh, fill: band }));
            if (party) L.push(env.rect({ id: 'tag-stripe', name: 'Tag stripe', x: cx, y: cy + bh, w: tw, h: th * 0.025, fill: S.accent }));
            var bx = cx + pad, bw = tw - 2 * pad;
            L.push(env.text({ id: 'tag-event', name: 'Tag event', text: v.event, x: bx, y: cy, w: bw, h: bh, valign: 'middle', font: style === 'minimal' ? S.body : S.display, weight: S.dw, size: th * 0.075, min: th * 0.04, maxLines: 1, uppercase: style !== 'elegant', tracking: style === 'elegant' ? 0 : 0.06, align: S.align === 'center' ? 'center' : 'left', color: style === 'minimal' ? C.ensure(S.accent, '#FFFFFF', 4.5) : bandInk }));
            var ky = cy + bh + th * 0.08;
            var kick = env.text({ id: 'tag-hello', name: 'Tag kicker', text: 'Hello, I’m', x: bx, y: ky, w: bw, font: S.body, weight: 700, size: th * 0.06, min: th * 0.04, maxLines: 1, uppercase: true, tracking: 0.14, align: S.align, color: style === 'minimal' ? '#55565C' : C.ensure(party ? S.bg : S.accent, '#FFFFFF', 4.5) });
            L.push(kick);
            var ny = kick.y + kick.h + th * 0.03, nh = cy + th - th * 0.1 - ny;
            if (nm) L.push(env.text({ id: 'tag-name', name: 'Name ' + (sh * TAGS + i + 1), text: nm, x: bx, y: ny, w: bw, h: nh, valign: 'middle', font: S.display, weight: S.dw, size: th * 0.25, min: th * 0.07, maxLines: 2, lineHeight: 1.02, tracking: S.tight, align: S.align, color: nameInk, balance: true }));
            else L.push(env.line({ id: 'tag-line', name: 'Write-on line', x: bx, y: cy + th * 0.78, w: bw, width: Math.max(2, th * 0.006), color: '#BDBDC4' }));
          }
          /* Cut guides: hairline dashes on every tag edge, light enough to disappear when trimmed off. */
          var d = '', dl = (W * 0.008).toFixed(1);
          for (var r = 0; r <= rows; r++) d += 'M' + (m * 0.4).toFixed(1) + ' ' + (m + r * th).toFixed(1) + 'H' + (W - m * 0.4).toFixed(1);
          for (var c2 = 0; c2 <= cols; c2++) d += 'M' + (m + c2 * tw).toFixed(1) + ' ' + (m * 0.4).toFixed(1) + 'V' + (H - m * 0.4).toFixed(1);
          L.push(env.svg({ id: 'cut-guides', name: 'Cut guides', markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"><path d="' + d + '" fill="none" stroke="#C9C9CF" stroke-width="1.5" stroke-dasharray="' + dl + ' ' + dl + '"/></svg>', x: 0, y: 0, w: W, h: H }));
          L.push(env.text({ id: 'sheet-note', name: 'Sheet note', text: 'Name tags ' + (sh + 1) + ' of ' + count + ' · ' + paper.name + ' · print at 100%, cut on the dashed lines', x: m, y: H - m * 0.62, w: W - 2 * m, font: 'Inter', weight: 400, size: m * 0.26, min: m * 0.18, maxLines: 1, align: 'center', color: '#6E6E76' }));
          page.layers = L;
          out.push(page);
        }
        return out;
      }

      var pages = [vertical('invite', 1080, 1350), vertical('story', 1080, 1920), banner()].concat(sheets());
      return { name: 'Event kit — ' + v.event, pages: pages };
    }
  });
})();
