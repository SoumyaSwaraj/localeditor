/* Quick maker: link preview card and README / profile banner (V22). 1200 × 630 social cards, 1280 × 640 repository
   cards and 1500 × 500 headers, in styles developers use. Icons come from the built-in generic set; no brand marks. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var ICONS = ['code', 'terminal', 'rocket', 'zap', 'package', 'book-open', 'globe', 'shield', 'cpu', 'database', 'sparkles', 'leaf', 'puzzle', 'layers', 'git-branch', 'braces'];
  var S = {
    dark: { bg: '#111216', ink: '#F2F3F5', muted: '#A9ADB8', accent: '#7C9CFF', head: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    mesh: { bg: '#170F2E', ink: '#FFFFFF', muted: '#E2DCF5', accent: '#8B5CF6', head: 'Outfit', body: 'Outfit', mono: 'JetBrains Mono' },
    grid: { bg: '#FAFAF6', ink: '#14161A', muted: '#4D5360', accent: '#2563EB', head: 'Space Grotesk', body: 'Space Grotesk', mono: 'Space Mono' },
    terminal: { bg: '#E9EBEE', ink: '#D8F5DC', muted: '#9FB3A4', accent: '#5FD38D', head: 'JetBrains Mono', body: 'JetBrains Mono', mono: 'JetBrains Mono', win: '#15181C' },
    editorial: { bg: '#F4EFE6', ink: '#1C1A17', muted: '#575047', accent: '#C2410C', head: 'Fraunces', body: 'Inter', mono: 'IBM Plex Mono' }
  };

  LE.makers.register({
    id: 'linkcard',
    name: 'Link card and banner',
    category: 'Business',
    summary: 'A social preview card or a README and profile banner for your project or post.',
    keywords: ['og image', 'open graph', 'social card', 'link preview', 'twitter card', 'readme', 'banner', 'github', 'repository', 'header', 'blog', 'developer', 'project'],
    sizes: [
      { id: 'og', name: 'Card 1200×630', w: 1200, h: 630 },
      { id: 'repo', name: 'Repo 1280×640', w: 1280, h: 640 },
      { id: 'header', name: 'Header 1500×500', w: 1500, h: 500 }
    ],
    inputs: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 70, placeholder: 'tinyqueue' },
      { key: 'subline', label: 'One line about it', type: 'text', max: 120, placeholder: 'A fast, dependency-free job queue for small servers' },
      { key: 'site', label: 'Site or author', type: 'text', max: 40, placeholder: 'yourname.dev' },
      { key: 'tags', label: 'Tags', type: 'list', max: 4, cellMax: 18, placeholder: 'TypeScript' },
      { key: 'icon', label: 'Icon', type: 'choice', options: [{ id: 'none', name: 'None' }].concat(ICONS.map(function (i) { return { id: i, name: i.replace('-', ' ').replace(/^./, function (c) { return c.toUpperCase(); }) }; })), default: 'braces' },
      { key: 'photo', label: 'Logo or photo', type: 'photo' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'dark', name: 'Minimal dark' },
      { id: 'mesh', name: 'Gradient mesh' },
      { id: 'grid', name: 'Grid paper' },
      { id: 'terminal', name: 'Terminal' },
      { id: 'editorial', name: 'Big type' }
    ],
    sample: { values: { title: 'tinyqueue', subline: 'A fast, dependency-free job queue for small servers', site: 'yourname.dev/tinyqueue', tags: ['TypeScript', 'MIT', 'v2.1'], icon: 'braces' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var T = Object.assign({}, S[style] || S.dark);
      if (v.accent) T.accent = v.accent;
      var header = env.size.id === 'header';
      var u = H / 100;
      var M = (header ? 9 : 9) * u;
      var page = env.page(T.bg), L = [];
      var under = style === 'terminal' ? T.win : T.bg;
      var ink = C.readable(under, [T.ink]), muted = C.readable(under, [T.muted, T.ink]);
      var acc = C.ensure(T.accent, under, 3), accText = C.ensure(T.accent, under, 4.5);
      var icon = v.icon && v.icon !== 'none' ? v.icon : '';
      var tags = (v.tags || []).slice(0, 4);

      /* Area for the words, and an optional square on the right for the logo or a big icon. */
      var box = { x: M, y: M, w: W - 2 * M, h: H - 2 * M };
      if (style === 'terminal') {
        var wx = 5 * u, wy = 6 * u, ww = W - 10 * u, wh = H - 12 * u, bar = header ? 9 * u : 8 * u;
        L.push(env.rect({ id: 'window', name: 'Window', x: wx, y: wy, w: ww, h: wh, radius: 2.4 * u, fill: T.win, shadow: { color: 'rgba(0,0,0,.25)', blur: 4 * u, x: 0, y: 1.4 * u } }));
        L.push(env.rect({ id: 'title-bar', name: 'Title bar', x: wx, y: wy, w: ww, h: bar, radius: 2.4 * u, fill: '#23272D' }));
        L.push(env.rect({ id: 'title-bar-base', name: 'Title bar', x: wx, y: wy + bar / 2, w: ww, h: bar / 2, fill: '#23272D' }));
        for (var d = 0; d < 3; d++) L.push(env.ellipse({ id: 'dot', name: 'Window dot', x: wx + 3 * u + d * 3.4 * u, y: wy + bar / 2 - 1.1 * u, w: 2.2 * u, h: 2.2 * u, fill: '#5A6068' }));
        if (v.site) L.push(env.text({ id: 'site', name: 'Site', text: v.site, x: wx + 16 * u, y: wy, w: ww - 32 * u, h: bar, valign: 'middle', font: T.mono, weight: 400, size: 3.2 * u, min: 2 * u, maxLines: 1, align: 'center', color: C.readable('#23272D', ['#A9B0B8']) }));
        box = { x: wx + 5 * u, y: wy + bar + 5 * u, w: ww - 10 * u, h: wh - bar - 10 * u };
      }
      var side = 0;
      if (v.photo || (icon && style !== 'terminal')) side = Math.min(box.h, W * (header ? 0.2 : 0.26));
      if (v.photo) {
        var sx = box.x + box.w - side, sy = box.y + (box.h - side) / 2;
        var spec = { id: 'photo', name: 'Logo or photo', src: v.photo, x: sx, y: sy, w: side, h: side, label: 'Add a logo or photo' };
        if (style === 'mesh') spec.mask = 'ellipse';
        else spec.radius = style === 'editorial' ? 0 : side * 0.18;
        if (style === 'grid') spec.border = { width: Math.max(2, 0.5 * u), color: T.ink };
        L.push(env.photo(spec));
      }
      if (side) box.w -= side + 6 * u;

      /* Background details */
      if (style === 'mesh') {
        var blobs = [[T.accent, -0.15, -0.5, 1.1], ['#EC4899', 0.45, 0.25, 0.9], ['#06B6D4', 0.75, -0.55, 0.8]];
        blobs.forEach(function (b, i) {
          var d2 = W * b[3] * (header ? 0.7 : 1);
          L.unshift(env.ellipse({ id: 'blob', name: 'Colour blob', x: W * b[1], y: H * b[2], w: d2, h: d2, fill: { type: 'radial', colors: [C.rgba(b[0], 0.55), C.rgba(b[0], 0.2), C.rgba(b[0], 0)] } }));
        });
        page.background = { type: 'gradient', kind: 'linear', angle: 135, colors: ['#1C1238', '#0F0A22'] };
      } else if (style === 'grid') {
        var step = 5 * u, g = '';
        for (var gx = 0; gx <= W; gx += step) g += 'M' + gx.toFixed(1) + ' 0V' + H;
        for (var gy = 0; gy <= H; gy += step) g += 'M0 ' + gy.toFixed(1) + 'H' + W;
        L.unshift(env.svg({ id: 'grid', name: 'Grid paper', markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"><path d="' + g + '" stroke="#D9DEE8" stroke-width="1.2" fill="none"/></svg>', x: 0, y: 0, w: W, h: H }));
      } else if (style === 'dark') {
        L.unshift(env.rect({ id: 'accent-bar', name: 'Accent bar', x: 0, y: H - 1.4 * u, w: W, h: 1.4 * u, fill: acc }));
      } else if (style === 'editorial') {
        L.push(env.rect({ id: 'rule', name: 'Rule', x: M, y: M - 3 * u, w: W - 2 * M, h: Math.max(2, 0.5 * u), fill: T.ink }));
      }
      if (icon && !v.photo && style !== 'terminal') {
        var isz = side * 0.62;
        var ix = box.x + box.w + 6 * u + (side - isz) / 2, iy = box.y + (box.h - isz) / 2;
        if (style === 'grid' || style === 'editorial') L.push(env.rect({ id: 'icon-tile', name: 'Icon tile', x: box.x + box.w + 6 * u, y: box.y + (box.h - side) / 2, w: side, h: side, radius: style === 'grid' ? side * 0.16 : 0, fill: style === 'grid' ? '#FFFFFF' : T.accent, stroke: style === 'grid' ? { width: Math.max(2, 0.5 * u), color: T.ink } : null }));
        L.push(env.icon('lucide:' + icon, { id: 'icon', name: 'Icon', x: ix, y: iy, w: isz, h: isz, color: style === 'editorial' ? C.readable(T.accent, ['#FFFFFF', '#14161A']) : style === 'grid' ? T.ink : acc, strokeWidth: 1.6 }));
      }

      /* Words: kicker (site), title, sub-line, tags. Fitted together. */
      function words(s) {
        var out = [], y = 0, x = box.x, w = box.w;
        function push(l, gap) { l.y = y; out.push(l); y += l.h + (gap || 0); return l; }
        if (style === 'terminal') {
          push(env.text({ id: 'title', name: 'Title', text: '$ ' + v.title, x: x, y: 0, w: w, font: T.mono, weight: 700, size: (header ? 14 : 13) * u * s, min: 3.6 * u, maxLines: 3, lineHeight: 1.2, color: C.readable(T.win, [T.accent]) }), 3 * u * s);
          if (v.subline) push(env.text({ id: 'subline', name: 'Sub-line', text: '# ' + v.subline, x: x, y: 0, w: w, font: T.mono, weight: 400, size: 5.4 * u * s, min: 2.4 * u, maxLines: 3, lineHeight: 1.35, color: muted }), 3 * u * s);
          if (tags.length) push(env.text({ id: 'tags', name: 'Tags', text: tags.map(function (t) { return '--' + t.toLowerCase().replace(/\s+/g, '-'); }).join('  '), x: x, y: 0, w: w, font: T.mono, weight: 400, size: 5 * u * s, min: 2.2 * u, maxLines: 2, lineHeight: 1.3, color: ink }));
          return { layers: out, h: y };
        }
        if (v.site && style !== 'editorial') push(env.text({ id: 'site', name: 'Site', text: v.site, x: x, y: 0, w: w, font: T.mono, weight: 400, size: 4.2 * u * s, min: 2.2 * u, maxLines: 1, color: style === 'mesh' ? muted : accText }), 3 * u * s);
        if (style === 'editorial' && v.site) push(env.text({ id: 'site', name: 'Site', text: v.site, x: x, y: 0, w: w, font: T.body, weight: 700, size: 3.2 * u * s, min: 2 * u, maxLines: 1, uppercase: true, tracking: 0.14, color: accText }), 2.4 * u * s);
        var big = style === 'editorial' ? 20 : style === 'mesh' ? 16 : 15;
        push(env.text({ id: 'title', name: 'Title', text: v.title, x: x, y: 0, w: w, font: T.head, weight: style === 'editorial' ? 700 : 700, size: big * u * s * (header ? 1.05 : 1), min: 4.4 * u, maxLines: 3, lineHeight: style === 'editorial' ? 0.98 : 1.05, tracking: style === 'editorial' ? -0.03 : -0.025, color: ink }), 3 * u * s);
        if (v.subline) push(env.text({ id: 'subline', name: 'Sub-line', text: v.subline, x: x, y: 0, w: w, font: style === 'editorial' ? 'Fraunces' : T.body, weight: 400, italic: style === 'editorial', size: 5.6 * u * s, min: 2.4 * u, maxLines: 3, lineHeight: 1.3, color: muted }), 4 * u * s);
        if (tags.length) {
          var cx = x, cy = y, ch = 0, fs = 4 * u * s, padX = 2 * u * s, gap = 1.6 * u;
          var chipBg = style === 'grid' ? '#FFFFFF' : style === 'editorial' ? T.bg : C.mix(under, ink, 0.1);
          tags.forEach(function (t, i) {
            var f = env.fit({ text: t, font: T.mono, weight: 700, size: fs, min: fs, w: 100000 });
            var cw = Math.min(w, f.textWidth + 2 * padX + 2);
            if (cx + cw > x + w && cx > x) { cx = x; cy += ch + gap; }
            var tl = env.text({ id: 'tag-' + (i + 1), name: 'Tag ' + (i + 1), text: t, x: cx + padX, y: 0, w: cw - 2 * padX, font: T.mono, weight: 700, size: fs, min: fs * 0.7, maxLines: 1, color: C.readable(chipBg, [style === 'editorial' ? T.ink : ink]) });
            var chH = tl.h + 1.6 * u * s;
            out.push(env.rect({ id: 'chip-' + (i + 1), name: 'Tag chip ' + (i + 1), x: cx, y: cy, w: cw, h: chH, radius: style === 'editorial' ? 0 : chH / 2, fill: chipBg, stroke: style === 'grid' || style === 'editorial' ? { width: Math.max(2, 0.35 * u), color: T.ink } : null }));
            tl.y = cy + (chH - tl.h) / 2;
            out.push(tl);
            ch = chH; cx += cw + gap;
          });
          y = cy + ch;
        }
        return { layers: out, h: y };
      }
      var res, s = header ? 1.25 : 1;
      for (var i = 0; i < 16; i++) { res = words(s); if (res.h <= box.h) break; s *= 0.92; }
      var oy = box.y + (box.h - res.h) / 2;
      if (style === 'terminal') oy = box.y;
      res.layers.forEach(function (l) { l.y += oy; });
      L = L.concat(res.layers);
      if (style === 'dark' && icon && v.photo) L.push(env.icon('lucide:' + icon, { id: 'icon-small', name: 'Icon', x: W - M - 6 * u, y: M - 4 * u, w: 6 * u, h: 6 * u, color: acc, strokeWidth: 2 }));
      page.layers = L;
      return { name: 'Card — ' + v.title, pages: [page] };
    }
  });
})();
