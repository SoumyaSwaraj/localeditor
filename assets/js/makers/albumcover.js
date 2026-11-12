/* Quick maker: album cover (V3). Square, at social size or 3000 × 3000 for a release. The optional sticker is a
   generic round sticker drawn from shapes with the person's own words; it copies no real label's mark. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  LE.makers.register({
    id: 'albumcover',
    name: 'Album cover',
    category: 'Social',
    summary: 'An album or single cover with your photo, the artist and the title.',
    keywords: ['album', 'cover', 'single', 'ep', 'music', 'band', 'playlist', 'mixtape', 'record', 'vinyl', 'streaming', 'artwork'],
    sizes: [
      'square',
      { id: 'release', name: 'Release 3000²', w: 3000, h: 3000 }
    ],
    inputs: [
      { key: 'artist', label: 'Artist', type: 'text', required: true, max: 40, placeholder: 'The Night Owls' },
      { key: 'title', label: 'Title', type: 'text', required: true, max: 50, placeholder: 'Monsoon Tapes' },
      { key: 'photo', label: 'Photo', type: 'photo' },
      { key: 'note', label: 'Small print', type: 'text', max: 40, placeholder: 'Vol. 1 · 2026' },
      { key: 'sticker', label: 'Sticker', type: 'toggle', default: false, hint: 'A round sticker on the cover' },
      { key: 'stickerText', label: 'Sticker words', type: 'text', max: 24, placeholder: 'Explicit lyrics' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'photo', name: 'Photo' },
      { id: 'type', name: 'Big type' },
      { id: 'duotone', name: 'Duotone' },
      { id: 'classical', name: 'Classical' },
      { id: 'handmade', name: 'Handmade' }
    ],
    sample: { values: { artist: 'The Night Owls', title: 'Monsoon Tapes', photo: 'sample:sky-04', note: 'Vol. 1 · 2026', sticker: true, stickerText: 'Explicit lyrics' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var u = W / 100, M = 6 * u;
      var L = [], page;

      function sticker(cx, cy, d, rot) {
        if (!v.sticker) return [];
        var words = v.stickerText || 'Explicit lyrics';
        var out = [];
        out.push(env.ellipse({ id: 'sticker', name: 'Sticker', x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: '#111111', shadow: { color: 'rgba(0,0,0,.3)', blur: 1.2 * u, x: 0, y: 0.4 * u } }));
        out.push(env.ellipse({ id: 'sticker-ring', name: 'Sticker ring', x: cx - d * 0.42, y: cy - d * 0.42, w: d * 0.84, h: d * 0.84, fill: { type: 'none' }, stroke: { width: Math.max(2, d * 0.02), color: '#FFFFFF' } }));
        var t = env.text({ id: 'sticker-text', name: 'Sticker words', text: words, x: cx - d * 0.3, y: 0, w: d * 0.6, font: 'Inter', weight: 700, size: d * 0.14, min: d * 0.07, maxLines: 3, lineHeight: 1.05, uppercase: true, tracking: 0.04, align: 'center', color: '#FFFFFF', balance: true });
        t.y = cy - t.h / 2;
        out.forEach(function (l) { l.rotation = rot; });
        t.rotation = rot;
        out.push(t);
        return out;
      }

      if (style === 'photo') {
        page = env.page('#15151A');
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: H, label: 'Add your photo' }));
        if (v.photo) L.push(env.rect({ id: 'scrim', name: 'Shade', x: 0, y: 0, w: W, h: H * 0.42, fill: { type: 'linear', angle: 90, colors: ['rgba(10,10,14,0.78)', 'rgba(10,10,14,0.35)', 'rgba(10,10,14,0)'] } }));
        var a = env.text({ id: 'artist', name: 'Artist', text: v.artist, x: M, y: M, w: W * 0.7, font: 'Inter', weight: 700, size: 4.4 * u, min: 2.4 * u, maxLines: 2, uppercase: true, tracking: 0.14, color: v.photo ? '#FFFFFF' : '#16131C' });
        var t = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: a.y + a.h + 1 * u, w: W * 0.7, font: 'Instrument Serif', weight: 400, italic: true, size: 7 * u, min: 3.4 * u, maxLines: 2, lineHeight: 1.05, color: v.photo ? '#FFFFFF' : '#16131C' });
        L.push(a, t);
        if (v.note) {
          if (v.photo) L.push(env.rect({ id: 'scrim-bottom', name: 'Shade', x: 0, y: H * 0.8, w: W, h: H * 0.2, fill: { type: 'linear', angle: 90, colors: ['rgba(10,10,14,0)', 'rgba(10,10,14,0.6)'] } }));
          var nt0 = env.text({ id: 'note', name: 'Small print', text: v.note, x: M, y: 0, w: W * 0.6, font: 'Inter', weight: 700, size: 2.4 * u, min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.12, color: v.photo ? '#FFFFFF' : '#16131C' });
          nt0.y = H - M - nt0.h; L.push(nt0);
        }
        L = L.concat(sticker(W - M - 9 * u, H - M - 9 * u, 18 * u, -10));
      } else if (style === 'type') {
        var bg = v.accent || '#F2EDE4';
        page = env.page(bg);
        var ink = C.readable(bg, ['#141414', '#FFFFFF']);
        var ph = v.photo ? 34 * u : 0;
        var title = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: M, w: W - 2 * M, h: H - 2 * M - (ph ? ph + 6 * u : 14 * u), font: 'Archivo Black', weight: 400, size: 22 * u, min: 6 * u, maxLines: 5, lineHeight: 0.9, tracking: -0.04, uppercase: true, color: ink });
        L.push(title);
        var by = H - M;
        if (v.photo) L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: W - M - ph, y: H - M - ph, w: ph, h: ph, label: 'Add your photo' }));
        var aw = W - 2 * M - (ph ? ph + 4 * u : 0);
        var art = env.text({ id: 'artist', name: 'Artist', text: v.artist, x: M, y: 0, w: aw, font: 'Inter', weight: 700, size: 4.4 * u, min: 2.2 * u, maxLines: 3, color: ink });
        var nt = v.note ? env.text({ id: 'note', name: 'Small print', text: v.note, x: M, y: 0, w: aw, font: 'Inter', weight: 400, size: 2.6 * u, min: 1.6 * u, maxLines: 2, color: ink }) : null;
        if (nt) { nt.y = by - nt.h; by = nt.y - 1 * u; }
        art.y = by - art.h;
        L.push(env.rect({ id: 'rule', name: 'Rule', x: M, y: art.y - 2.4 * u, w: aw, h: Math.max(2, 0.4 * u), fill: ink }));
        L.push(art); if (nt) L.push(nt);
        L = L.concat(v.photo ? sticker(W - M - ph, H - M - ph, 15 * u, 12) : sticker(W - M - 9 * u, H - M - 9 * u, 16 * u, 12));
      } else if (style === 'duotone') {
        var tone = v.accent || '#2E5BFF';
        page = env.page('#111111');
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: H, label: 'Add your photo', adjust: { saturation: -100, contrast: 30, grain: 14 } }));
        if (v.photo) L.push(env.rect({ id: 'tone', name: 'Duotone colour', x: 0, y: 0, w: W, h: H, fill: tone, blend: 'multiply' }));
        var ink3 = '#FFFFFF';
        var plate = C.shade(tone, 0.55);
        var t3 = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: 0, w: W - 2 * M, font: 'Anton', weight: 400, size: 15 * u, min: 5 * u, maxLines: 3, lineHeight: 0.95, uppercase: true, color: ink3 });
        var a3 = env.text({ id: 'artist', name: 'Artist', text: v.artist, x: M, y: 0, w: W - 2 * M, font: 'Space Grotesk', weight: 700, size: 4 * u, min: 2 * u, maxLines: 2, uppercase: true, tracking: 0.2, color: ink3 });
        var bandH = t3.h + a3.h + 9 * u;
        L.push(env.rect({ id: 'band', name: 'Band', x: 0, y: H - bandH, w: W, h: bandH, fill: C.readable(plate, ['#FFFFFF']) === '#FFFFFF' && C.contrast('#FFFFFF', plate) >= 4.5 ? plate : '#111111' }));
        a3.y = H - bandH + 3.5 * u; t3.y = a3.y + a3.h + 1 * u;
        L.push(a3, t3);
        if (v.note) L.push(env.text({ id: 'note', name: 'Small print', text: v.note, x: M, y: M, w: W - 2 * M, font: 'Space Grotesk', weight: 700, size: 2.6 * u, min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.2, align: 'right', color: '#FFFFFF', background: { color: '#111111', padding: 0.8 * u } }));
        L = L.concat(sticker(W - M - 9 * u, H - bandH - 6 * u, 17 * u, -8));
      } else if (style === 'classical') {
        var cream = '#F3EDE2', ink4 = '#2A2420', gold = C.ensure(v.accent || '#8C6A3F', cream, 4.5);
        page = env.page(cream);
        L.push(env.rect({ id: 'frame', name: 'Frame', x: 3 * u, y: 3 * u, w: W - 6 * u, h: H - 6 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.3 * u), color: gold } }));
        var a4 = env.text({ id: 'artist', name: 'Artist', text: v.artist, x: 10 * u, y: 9 * u, w: W - 20 * u, font: 'Cormorant Garamond', weight: 700, size: 4.4 * u, min: 2.2 * u, maxLines: 2, uppercase: true, tracking: 0.22, align: 'center', color: ink4, balance: true });
        L.push(a4);
        var t4 = env.text({ id: 'title', name: 'Title', text: v.title, x: 10 * u, y: 0, w: W - 20 * u, font: 'Cormorant Garamond', weight: 400, italic: true, size: 9 * u, min: 4 * u, maxLines: 2, lineHeight: 1.0, align: 'center', color: ink4, balance: true });
        var n4 = v.note ? env.text({ id: 'note', name: 'Small print', text: v.note, x: 10 * u, y: 0, w: W - 20 * u, font: 'Cormorant Garamond', weight: 700, size: 2.8 * u, min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.2, align: 'center', color: gold }) : null;
        var yb = H - 9 * u;
        if (n4) { n4.y = yb - n4.h; yb = n4.y - 1.4 * u; }
        t4.y = yb - t4.h;
        var archTop = a4.y + a4.h + 4 * u, archBottom = t4.y - 4 * u;
        var ah = Math.max(16 * u, archBottom - archTop), awd = Math.min(W * 0.5, ah * 0.78);
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: (W - awd) / 2, y: archTop, w: awd, h: ah, label: 'Add your photo', maskPath: 'M0 ' + ah + 'L0 ' + (awd / 2) + 'A' + (awd / 2) + ' ' + (awd / 2) + ' 0 0 1 ' + awd + ' ' + (awd / 2) + 'L' + awd + ' ' + ah + 'Z', adjust: { saturation: -20, warmth: 6, fade: 8 } }));
        L.push(t4); if (n4) L.push(n4);
        L = L.concat(sticker(W - 14 * u, archTop + 10 * u, 16 * u, 10));
      } else {
        var kraft = '#D9C4A0', ink5 = '#22180F';
        page = env.page(kraft);
        var t5 = env.text({ id: 'title', name: 'Title', text: v.title, x: M, y: 0, w: W - 2 * M, font: 'Caveat', weight: 700, size: 10 * u, min: 4 * u, maxLines: 2, lineHeight: 1.0, align: 'center', color: ink5, balance: true });
        var a5 = env.text({ id: 'artist', name: 'Artist', text: v.artist, x: M, y: 0, w: W - 2 * M, font: 'Shadows Into Light', weight: 400, size: 5 * u, min: 2.6 * u, maxLines: 1, align: 'center', color: ink5 });
        var n5 = v.note ? env.text({ id: 'note', name: 'Small print', text: v.note, x: M, y: 0, w: W - 2 * M, font: 'Space Mono', weight: 400, size: 2.2 * u, min: 1.4 * u, maxLines: 1, align: 'center', color: ink5 }) : null;
        var textH = t5.h + a5.h + (n5 ? n5.h + 1.4 * u : 0);
        var py = 9 * u, pw = Math.min(W * 0.62, H - py - 4 * u - textH - 4 * u - 2.4 * u), px = (W - pw) / 2 + 2 * u;
        L.push(env.rect({ id: 'print', name: 'Print', x: px - 2.4 * u, y: py - 2.4 * u, w: pw + 4.8 * u, h: pw + 4.8 * u, fill: '#FBF8F2', rotation: -4, shadow: { color: 'rgba(40,25,5,.3)', blur: 2 * u, x: 0, y: 0.8 * u } }));
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: px, y: py, w: pw, h: pw, rotation: -4, label: 'Add your photo', adjust: { warmth: 12, fade: 12, grain: 12 } }));
        L.push(env.rect({ id: 'tape', name: 'Tape', x: px + pw / 2 - 9 * u, y: py - 4.5 * u, w: 18 * u, h: 5 * u, fill: 'rgba(255,250,235,0.6)', rotation: 3 }));
        var yb5 = H - 4 * u;
        if (n5) { n5.y = yb5 - n5.h; yb5 = n5.y - 1.4 * u; }
        a5.y = yb5 - a5.h; t5.y = a5.y - t5.h;
        L.push(t5, a5); if (n5) L.push(n5);
        L = L.concat(sticker(px + pw - 4 * u, py + pw - 6 * u, 16 * u, 14));
      }
      page.layers = L;
      return { name: v.artist + ' — ' + v.title, pages: [page] };
    }
  });
})();
