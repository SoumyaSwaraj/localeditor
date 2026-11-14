/* Quick maker: greeting cards. Thank you, birthday, congratulations and season's greetings; a folded card (outside
   and inside sheets with a fold line) at A5 or A6, or a flat 5 × 7 in card. The name after "Dear" and the message (field `note`) are
   fields, so Create many writes one card per person. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var OCC = { thanks: 'Thank you', birthday: 'Happy birthday', congrats: 'Congratulations', season: 'Season’s greetings' };
  var S = {
    simple: { bg: '#FFFFFF', ink: '#22201C', muted: '#5F5A52', accent: '#B4532A', head: 'Playfair Display', headW: 700, body: 'Lora' },
    bold: { bg: '#2450D8', ink: '#FFFFFF', muted: '#DCE5FF', accent: '#FFD23F', head: 'Archivo Black', headW: 400, caps: 1, headK: 0.86, body: 'Work Sans' },
    script: { bg: '#FBF6E9', ink: '#3A2A1E', muted: '#6B5A4A', accent: '#9A7B4F', head: 'Great Vibes', headW: 400, headK: 1.45, body: 'EB Garamond', bodyK: 1.12, frame: 1 },
    photo: { bg: '#FFFFFF', ink: '#1B1B1F', muted: '#56565E', accent: '#1B1B1F', head: 'DM Serif Display', headW: 400, body: 'DM Sans', photo: 1 },
    confetti: { bg: '#FFF7DC', ink: '#2B2340', muted: '#5A5070', accent: '#E8553D', head: 'Fredoka', headW: 700, body: 'Nunito', dots: 1 },
    dark: { bg: '#14233B', ink: '#F5F0E6', muted: '#C9C9D2', accent: '#D2AB62', head: 'Cormorant Garamond', headW: 600, headK: 1.15, body: 'Cormorant Garamond', bodyK: 1.2, frame: 1 }
  };
  var LIST = [['name', 'note'],
    ['Amara', 'Thank you for the beautiful flowers. They brightened the whole week.'], ['Daniel and Kim', 'Thank you for coming all that way. It meant a great deal to us.'],
    ['Grandma', 'Thank you for the jumper. It fits perfectly and I wear it every day.'], ['Mr Papadopoulos', 'Thank you for a wonderful year in your class.'],
    ['Hye-jin', 'Thank you for looking after the cat. She misses you already.'], ['Ibrahim', 'Thank you for the lift home and the good company.'],
    ['Julia', 'Thank you for the book. I read it in two days.'], ['Kofi', 'Thank you for helping us move. We could not have done it without you.'],
    ['Lucía', 'Thank you for the lovely dinner and the recipe.'], ['Mohammed', 'Thank you for your kind words when they were needed most.'],
    ['Nadia', 'Thank you for the photographs. They are on the wall already.'], ['Everyone at Northwind Health', 'Thank you for the card, the cake and five very happy years. I will miss you all, and I promise to visit.']];

  function go(K) {
    M.register({
      id: 'greetingcard',
      name: 'Greeting card',
      category: 'Life',
      summary: 'A folded or flat card for thanks, birthdays and congratulations, with your message inside.',
      keywords: ['greeting card', 'thank you card', 'birthday card', 'congratulations card', 'folded card', 'card maker', 'note card', 'holiday card', 'print'],
      sizes: [Object.assign(K.paper('a4-landscape', 'Fold to A5'), { id: 'fold-a5' }), Object.assign(K.paper('a5-landscape', 'Fold to A6'), { id: 'fold-a6' }), K.size('flat-5x7', 'Flat 5×7', 127, 177.8)],
      maxPages: 2,
      inputs: [
        { key: 'occasion', label: 'Card for', type: 'choice', default: 'thanks', options: [{ id: 'thanks', name: 'Thank you' }, { id: 'birthday', name: 'Birthday' }, { id: 'congrats', name: 'Congrats' }, { id: 'season', name: 'Season' }] },
        { key: 'headline', label: 'Your own words on the front', type: 'text', max: 36, placeholder: 'Thank you' },
        { key: 'to', label: 'Dear', type: 'text', max: 40, placeholder: 'Amara' },
        { key: 'message', label: 'Message inside', type: 'longtext', max: 320, maxLines: 7, placeholder: 'Thank you for the beautiful flowers.' },
        { key: 'from', label: 'From', type: 'text', max: 50, placeholder: 'With love, Priya' },
        { key: 'photo', label: 'Photo', type: 'photo', hint: 'Used by the Photo style.' },
        { key: 'fold', label: 'Fold line', type: 'toggle', default: true, hint: 'A dashed guide on folded cards. Fold along it, or hide it in Layers.' },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'simple', name: 'Simple' }, { id: 'bold', name: 'Bold' }, { id: 'script', name: 'Script' }, { id: 'photo', name: 'Photo' }, { id: 'confetti', name: 'Confetti' }, { id: 'dark', name: 'Midnight' }],
      sample: { values: { occasion: 'thanks', to: 'Amara', message: 'Thank you for the beautiful flowers. They brightened the whole week, and the kitchen still smells wonderful.', from: 'With love, Priya', photo: 'sample:garden-03', fold: true } },
      ui: K.many('greetingcard', LIST, { to: 0, message: 1 }, 1),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, mm = env.print.mm, style = env.style;
        var T = Object.assign({}, S[style] || S.simple);
        if (v.accent) { if (style === 'bold') T.bg = v.accent; else T.accent = v.accent; }
        var folded = env.size.id !== 'flat-5x7', pw = folded ? W / 2 : W, u = pw / 100, hk = T.headK || 1, bk = T.bodyK || 1;
        var bg = T.bg, ink = C.readable(bg, [T.ink, '#16131C', '#FFFFFF']), muted = C.readable(bg, [T.muted, ink]), acc = C.ensure(T.accent, bg, 3), accText = C.ensure(T.accent, bg, 4.5);
        var words = v.headline || OCC[v.occasion] || OCC.thanks, vals = {};

        /* The front panel at x0 (the right half of the outside sheet when folded). */
        function front(x0) {
          var L = [], m = 11 * u, box = { x: x0 + m, y: m, w: pw - 2 * m, h: H - 2 * m };
          if (T.photo) {
            var ph = H * 0.62;
            L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: x0, y: 0, w: pw, h: ph, label: 'Your photo' }));
            box = { x: x0 + m, y: ph + 4 * u, w: pw - 2 * m, h: H - ph - 4 * u - m * 0.7 };
          }
          if (T.frame) L.push(env.rect({ id: 'frame', name: 'Border', x: x0 + 5 * u, y: 5 * u, w: pw - 10 * u, h: H - 10 * u, fill: { type: 'none' }, stroke: { width: Math.max(2, 0.35 * u), color: acc } }));
          if (T.dots) {
            var cols = [T.accent, '#2FA58E', '#F4B73E', '#5B8DEF'], d = '', vh = H / u;
            for (var i = 0; i < 60; i++) { var x = env.random() * 100, y = env.random() * vh, far = Math.abs(y - vh / 2) > vh * 0.2; if (!far) y = y < vh / 2 ? y * 0.5 : vh - (vh - y) * 0.5; d += i % 4 === 0 ? '<path d="' + K.starPath(x, y, 2.2, 0.9, 5) + '" fill="' + cols[i % 4] + '"/>' : '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (0.7 + env.random() * 1.1).toFixed(2) + '" fill="' + cols[i % 4] + '"/>'; }
            L.push(env.svg({ id: 'confetti', name: 'Confetti', x: x0, y: 0, w: pw, h: H, markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ' + vh.toFixed(1) + '">' + d + '</svg>' }));
          }
          var items = [
            style === 'simple' ? { h: 7 * u, gap: 5 * u, make: function (x, y, w, h) { return env.svg({ id: 'ornament', name: 'Ornament', x: x + (w - h) / 2, y: y, w: h, h: h, markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="' + K.starPath(10, 10, 9, 3.4, 8) + '" fill="' + acc + '"/></svg>' }); } } : null,
            { id: 'headline', name: 'Front words', text: words, font: T.head, weight: T.headW, size: 15.5 * u * hk, min: 6 * u, maxLines: 3, lineHeight: T.caps ? 1 : 1.08, uppercase: !!T.caps, tracking: T.caps ? 0.01 : 0, color: ink, gap: 4 * u, input: 'headline' },
            style === 'bold' || style === 'dark' || style === 'script' ? { h: Math.max(2, 0.5 * u), fixed: true, make: function (x, y, w) { return env.rect({ id: 'rule', name: 'Rule', x: x + (w - 14 * u) / 2, y: y, w: 14 * u, h: Math.max(2, 0.5 * u), fill: acc }); } } : null
          ];
          return L.concat(K.stack(env, box, items, { align: 'center', valign: 'middle', minScale: 0.5 }).layers);
        }
        /* The message panel: Dear …, the message, and who it is from. */
        function inside(x0, onBg) {
          var m = 13 * u, pInk = C.readable(onBg, [S.simple.ink, '#FFFFFF']), pAcc = C.ensure(T.accent, onBg, 4.5);
          var st = K.stack(env, { x: x0 + m, y: m, w: pw - 2 * m, h: H - 2 * m }, [
            v.to ? { id: 'dear', name: 'Dear', text: 'Dear ' + v.to + ',', font: T.body, weight: 700, size: 4.6 * u * bk, min: 2.8 * u, maxLines: 2, color: pInk, gap: 4 * u, input: 'to' } : null,
            { id: 'message', name: 'Message', text: v.message || 'Write your message here.', font: T.body, weight: 400, size: 4.3 * u * bk, min: 2.7 * u, maxLines: 12, lineHeight: 1.55, color: pInk, gap: 6 * u, field: 'note', fallback: true, input: 'message' },
            v.from ? { id: 'from', name: 'From', text: v.from, font: style === 'script' ? 'Great Vibes' : T.body, weight: style === 'script' ? 400 : 700, size: (style === 'script' ? 7.5 : 4.4) * u * (style === 'script' ? 1 : bk), min: 2.8 * u, maxLines: 2, color: pAcc, input: 'from' } : null
          ], { align: 'left', valign: 'middle', values: vals, minScale: 0.6 });
          st.layers.forEach(function (l) { if (/^dear/.test(l.id)) { vals.name = v.to; l.text = 'Dear {{name}},'; l.overflow = 'shrink'; l.minSize = Math.round(l.size * 0.6); } });
          return st.layers;
        }
        function foldMark(pg) { return folded && v.fold !== false ? env.print.cutMarks({ name: 'Fold line', id: 'fold-line', folds: [[W / 2, mm(4), W / 2, H - mm(4)]], color: '#9A96A2' }) : []; }

        var p1 = env.page(bg), p2 = env.page('#FFFFFF');
        if (folded) {
          /* Outside sheet: the back (left blank) on the left, the front on the right. Inside sheet: blank left, message right. */
          p1.layers = front(pw).concat(foldMark());
          p2.layers = inside(pw, '#FFFFFF').concat(foldMark());
        } else {
          p1.layers = front(0);
          p2.layers = inside(0, '#FFFFFF');
        }
        p2.values = vals;
        return { name: 'Card — ' + words, pages: [p1, p2] };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
