/* Quick maker: certificates (award, completion, participation, appreciation, attendance). The recipient, the reason
   and the date are template fields, so Create many can fill one certificate per row of a class or staff list. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var KIND = {
    award: ['of Achievement', 'is proudly presented to'],
    completion: ['of Completion', 'This certifies that'],
    participation: ['of Participation', 'is presented to'],
    appreciation: ['of Appreciation', 'is presented with thanks to'],
    attendance: ['of Attendance', 'This certifies that']
  };
  var S = {
    classic: { bg: '#FBF6E9', ink: '#2A2118', muted: '#5C4E3C', accent: '#8C6A1E', head: 'Cinzel', headW: 700, caps: true, name: 'Great Vibes', nameW: 400, nameK: 1.3, body: 'EB Garamond', bodyK: 1.08, italic: true, frame: 14 },
    modern: { bg: '#FFFFFF', ink: '#14161B', muted: '#555B66', accent: '#2450D8', head: 'Inter Tight', headW: 700, name: 'Fraunces', nameW: 600, nameK: 0.86, body: 'Inter', left: true, frame: 11 },
    bold: { bg: '#FFFFFF', ink: '#16131C', muted: '#4A4654', accent: '#D8402B', head: 'Archivo Black', headW: 400, caps: true, name: 'Archivo Black', nameW: 400, nameK: 0.74, body: 'Work Sans', frame: 10 },
    academic: { bg: '#FFFFFF', ink: '#14284B', muted: '#44536E', accent: '#A9832F', head: 'Libre Baskerville', headW: 700, name: 'Playfair Display', nameW: 700, nameItalic: true, nameK: 0.9, body: 'Libre Baskerville', bodyK: 0.92, italic: true, frame: 14 },
    playful: { bg: '#FFF7DC', ink: '#2B2340', muted: '#5A5070', accent: '#E8553D', head: 'Fredoka', headW: 700, name: 'Baloo 2', nameW: 800, nameK: 0.95, body: 'Nunito', frame: 15 },
    dark: { bg: '#15171D', ink: '#F5F0E6', muted: '#C9C2B4', accent: '#D2AB62', head: 'Cormorant Garamond', headW: 600, caps: true, name: 'Playfair Display', nameW: 400, nameItalic: true, nameK: 0.92, body: 'Cormorant Garamond', bodyK: 1.18, italic: true, frame: 13 }
  };
  var LIST = [['name', 'reason', 'issued'],
    ['Amara Okafor', 'for outstanding work in the science fair', '12 November 2026'], ['Leo Fernandes', 'for reading forty books this term', '12 November 2026'],
    ['Mei Tanaka', 'for kindness to every new classmate', '12 November 2026'], ['Yusuf Rahman', 'for the most improved handwriting', '12 November 2026'],
    ['Sofia Petrova', 'for leading the school choir', '12 November 2026'], ['Noah Williams', 'for full attendance all year', '12 November 2026'],
    ['Ananya Iyer', 'for first place in the maths challenge', '12 November 2026'], ['Kwame Mensah', 'for captaining the football team', '12 November 2026'],
    ['Isabella Rossi', 'for a brilliant history project', '12 November 2026'], ['Tomás García', 'for helping in the library every week', '12 November 2026'],
    ['Zoë van der Merwe', 'for creative writing', '12 November 2026'], ['Alexander Montgomery-Featherstonehaugh', 'for perseverance in swimming', '12 November 2026']];

  function go(K) {
    M.register({
      id: 'certificate',
      name: 'Certificate',
      category: 'Print',
      summary: 'An award or completion certificate with signature lines and a seal, ready to print.',
      keywords: ['certificate', 'award', 'diploma', 'completion', 'participation', 'appreciation', 'attendance', 'school', 'class award', 'employee', 'course', 'print'],
      sizes: [K.paper('a4-landscape', 'A4 wide'), K.paper('letter-landscape', 'Letter wide'), K.paper('a4', 'A4 tall'), K.paper('letter', 'Letter tall'),
        { id: 'screen', name: 'Screen', w: 1600, h: 1131 }],
      inputs: [
        { key: 'kind', label: 'Certificate of', type: 'choice', default: 'award', options: [{ id: 'award', name: 'Achievement' }, { id: 'completion', name: 'Completion' }, { id: 'participation', name: 'Participation' }, { id: 'appreciation', name: 'Appreciation' }, { id: 'attendance', name: 'Attendance' }] },
        { key: 'name', label: 'Recipient', type: 'text', required: true, max: 60, placeholder: 'Amara Okafor' },
        { key: 'reason', label: 'For', type: 'longtext', max: 200, maxLines: 4, placeholder: 'for outstanding work in the science fair' },
        { key: 'date', label: 'Date', type: 'date', today: true },
        { key: 'issuer', label: 'Issued by', type: 'text', max: 60, placeholder: 'Riverside Primary School' },
        { key: 'sig1name', label: 'First signature: name', type: 'text', max: 36, placeholder: 'Helen Marsh' },
        { key: 'sig1role', label: 'First signature: role', type: 'text', max: 36, placeholder: 'Head teacher' },
        { key: 'sig2name', label: 'Second signature: name', type: 'text', max: 36 },
        { key: 'sig2role', label: 'Second signature: role', type: 'text', max: 36 },
        { key: 'logo', label: 'Logo', type: 'photo' },
        { key: 'seal', label: 'Seal', type: 'choice', default: 'seal', options: [{ id: 'seal', name: 'Seal' }, { id: 'ribbon', name: 'Ribbon' }, { id: 'none', name: 'None' }] },
        { key: 'title', label: 'Your own title', type: 'text', max: 40, placeholder: 'Star of the Week', hint: 'Replaces “Certificate of …”.' },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'classic', name: 'Classic' }, { id: 'modern', name: 'Modern' }, { id: 'bold', name: 'Bold' }, { id: 'academic', name: 'Academic' }, { id: 'playful', name: 'Playful' }, { id: 'dark', name: 'Elegant dark' }],
      sample: { values: { kind: 'award', name: 'Amara Okafor', reason: 'for outstanding work in the Year 6 science fair, and for helping every team finish on time', date: '2026-11-12',
        issuer: 'Riverside Primary School', sig1name: 'Helen Marsh', sig1role: 'Head teacher', sig2name: 'David Osei', sig2role: 'Class teacher', seal: 'seal' } },
      ui: K.many('certificate', LIST),
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, style = env.style;
        var T = Object.assign({}, S[style] || S.classic);
        if (v.accent) T.accent = v.accent;
        var u = Math.min(W, H) / 100, wide = W > H, vw = W / u, vh = H / u;
        var bg = T.bg, ink = T.ink, muted = C.readable(bg, [T.muted, ink]);
        var acc = C.ensure(T.accent, bg, 3), accText = C.ensure(T.accent, bg, 4.5);
        var page = env.page(bg), L = [], vals = {};
        var kind = KIND[v.kind] || KIND.award;
        var head = v.title || 'Certificate', sub = v.title ? '' : kind[0];
        var left = !!T.left, al = left ? 'left' : 'center', bk = T.bodyK || 1;
        var mx = (left ? 15 : T.frame + 3) * u, top = (T.frame + 1) * u, bottom = T.frame * u;
        function svg(id, name, inner) { return env.svg({ id: id, name: name, x: 0, y: 0, w: W, h: H, markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vw.toFixed(2) + ' ' + vh.toFixed(2) + '">' + inner + '</svg>' }); }
        function frame(inset, sw, col, extra) { return '<rect x="' + inset + '" y="' + inset + '" width="' + (vw - 2 * inset).toFixed(2) + '" height="' + (vh - 2 * inset).toFixed(2) + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '"' + (extra || '') + '/>'; }

        /* Decoration, under everything. */
        var bandH = 0;
        if (style === 'classic') {
          var cor = '';
          [[5, 5], [vw - 5, 5], [5, vh - 5], [vw - 5, vh - 5]].forEach(function (p) { cor += '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="2.3" fill="' + bg + '" stroke="' + acc + '" stroke-width="0.35"/><circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="0.9" fill="' + acc + '"/>'; });
          L.push(svg('frame', 'Border', frame(5, 0.7, acc) + frame(6.5, 0.16, acc) + frame(9.6, 0.12, acc, ' stroke-dasharray="0.25 0.9"') + cor));
        } else if (style === 'modern') {
          L.push(env.rect({ id: 'bar', name: 'Accent bar', x: 0, y: 0, w: 4.2 * u, h: H, fill: acc }));
          L.push(env.rect({ id: 'bar-2', name: 'Accent block', x: 4.2 * u, y: H - 11 * u, w: 4.2 * u, h: 11 * u, fill: C.mix(acc, ink, 0.55) }));
        } else if (style === 'bold') {
          bandH = (wide ? 33 : 36) * u;
          L.push(env.rect({ id: 'band', name: 'Colour block', x: 0, y: 0, w: W, h: bandH, fill: accText }));
          L.push(env.rect({ id: 'band-foot', name: 'Colour strip', x: 0, y: H - 3 * u, w: W, h: 3 * u, fill: ink }));
        } else if (style === 'academic') {
          L.push(svg('frame', 'Border', frame(5, 1.1, ink) + frame(6.9, 0.22, acc) + frame(7.6, 0.1, acc)));
        } else if (style === 'playful') {
          var cols = [acc, '#2FA58E', '#F4B73E', '#5B8DEF'], conf = '';
          for (var i = 0; i < 40; i++) {
            var edge = i % 4, t = env.random(), d = 1.8 + env.random() * 4.2, r = 0.45 + env.random() * 0.7;
            var cx = edge === 0 ? t * vw : edge === 1 ? vw - d : edge === 2 ? t * vw : d, cy = edge === 0 ? d : edge === 1 ? t * vh : edge === 2 ? vh - d : t * vh;
            conf += i % 3 === 0 ? '<path d="' + K.starPath(cx, cy, r * 1.9, r * 0.8, 5) + '" fill="' + cols[i % 4] + '"/>' : '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="' + r.toFixed(2) + '" fill="' + cols[i % 4] + '"/>';
          }
          L.push(svg('confetti', 'Confetti', conf));
          L.push(svg('frame', 'Border', frame(10, 0.55, '#2FA58E', ' rx="3.5" stroke-dasharray="2.6 1.7" stroke-linecap="round"')));
        } else {
          L.push(svg('frame', 'Border', frame(5, 0.28, acc) + frame(6.3, 0.1, acc) +
            '<path d="M' + (vw / 2 - 1.5).toFixed(2) + ' 5l1.5-1.5 1.5 1.5-1.5 1.5zM' + (vw / 2 - 1.5).toFixed(2) + ' ' + (vh - 5).toFixed(2) + 'l1.5-1.5 1.5 1.5-1.5 1.5z" fill="' + acc + '"/>'));
        }

        /* Signatures and the seal along the foot. */
        var sigs = [[v.sig1name, v.sig1role], [v.sig2name, v.sig2role]].filter(function (s) { return s[0] || s[1]; });
        var sealKind = v.seal || 'seal', hasSeal = sealKind !== 'none';
        var sealW = (left && !wide ? 13 : 14.5) * u, sealH = sealKind === 'ribbon' ? sealW * 1.4 : sealW;
        var sw = (wide ? 30 : 26) * u, sigH = 11.6 * u;
        var footH = Math.max(sigs.length ? sigH : 0, hasSeal ? sealH : 0), footY = H - bottom - footH;
        var xs = [], sealX = (W - sealW) / 2;
        if (left) { xs = [mx, mx + sw + 6 * u]; sealX = W - mx - sealW; }
        else if (sigs.length === 2) { var off = (wide ? 38 : 26) * u; xs = [W / 2 - off - sw / 2, W / 2 + off - sw / 2]; }
        else if (sigs.length === 1 && hasSeal) { var o1 = (wide ? 24 : 18) * u; xs = [W / 2 - o1 - sw / 2]; sealX = W / 2 + o1 - sealW / 2; }
        else if (sigs.length === 1) xs = [(W - sw) / 2];
        sigs.forEach(function (s, i) {
          var x = xs[i], y = H - bottom - sigH + 5.4 * u, n = i + 1;
          L.push(env.line({ id: 'sig-line-' + n, name: 'Signature line ' + n, x: x, y: y, w: sw, width: Math.max(2, 0.14 * u), color: muted }));
          y += 1.1 * u;
          if (s[0]) { var a = env.text({ id: 'sig-name-' + n, name: 'Signature name ' + n, text: s[0], x: x, y: y, w: sw, font: T.body, weight: 700, size: 2 * u * bk, min: 1.45 * u, maxLines: 2, lineHeight: 1.15, align: al, color: ink }); L.push(a); y += a.h + 0.2 * u; }
          if (s[1]) L.push(env.text({ id: 'sig-role-' + n, name: 'Signature role ' + n, text: s[1], x: x, y: y, w: sw, font: T.body, weight: 400, size: 1.75 * u * bk, min: 1.35 * u, maxLines: 2, lineHeight: 1.15, align: al, color: muted }));
        });
        if (hasSeal) {
          var sc = style === 'academic' ? ink : style === 'playful' ? '#F4B73E' : style === 'bold' ? ink : acc;
          var mark = style === 'academic' ? '#E9D9B0' : style === 'playful' ? T.ink : C.readable(sc, [bg, '#FFFFFF']);
          L.push(env.svg({ id: 'seal', name: sealKind === 'ribbon' ? 'Ribbon' : 'Seal', x: sealX, y: H - bottom - footH + (footH - sealH) / 2, w: sealW, h: sealH,
            markup: K.seal(sc, mark, sealKind === 'ribbon', style === 'academic' ? acc : C.mix(sc, style === 'dark' ? '#FFFFFF' : '#000000', 0.22)) }));
        }

        /* The words: one stack that shrinks together, the name as a field that fits its line. */
        var onBand = C.readable(accText, ['#FFFFFF']);
        var headItems = [
          v.logo ? { h: 9 * u, gap: 2.4 * u, make: function (x, y, w, h) { return K.logo(env, v.logo, { x: x, y: y, w: w, h: h }, { align: al }); } } : null,
          v.issuer ? { id: 'issuer', name: 'Issued by', text: v.issuer, font: T.body, weight: 700, size: 2 * u * bk, min: 1.4 * u, maxLines: 2, uppercase: true, tracking: 0.16, color: bandH ? onBand : accText, gap: 3 * u, input: 'issuer' } : null,
          { id: 'title', name: 'Title', text: head, font: T.head, weight: T.headW, size: (T.caps ? 6.6 : 7.6) * u, min: 3.2 * u, maxLines: 2, uppercase: !!T.caps, tracking: T.caps ? 0.07 : -0.01, lineHeight: 1.06, color: bandH ? onBand : ink, gap: (sub ? 1.3 : 0) * u, input: 'title' },
          sub ? { id: 'subtitle', name: 'Kind', text: sub, font: T.caps ? T.body : T.head, weight: 700, size: 2.7 * u * (T.caps ? bk : 1), min: 1.6 * u, maxLines: 1, uppercase: true, tracking: 0.24, color: bandH ? onBand : accText } : null
        ];
        var bodyItems = [
          { id: 'line', name: 'Line above the name', text: kind[1], font: T.body, weight: 400, italic: !!T.italic, size: 2.5 * u * bk, min: 1.5 * u, maxLines: 2, color: muted, gap: 1.5 * u },
          { id: 'name', name: 'Recipient', text: v.name, font: T.name, weight: T.nameW, italic: !!T.nameItalic, size: 9.6 * u * T.nameK, min: 3.4 * u, maxLines: wide ? 1 : 2, lineHeight: 1.14, color: style === 'playful' || style === 'bold' ? accText : ink, gap: 1.3 * u, field: 'name', input: 'name' },
          { h: Math.max(2, 0.22 * u), fixed: true, gap: 2.6 * u, make: function (x, y, w) { var rw = Math.min(w, (wide ? 52 : 46) * u); return env.line({ id: 'rule', name: 'Rule', x: left ? x : x + (w - rw) / 2, y: y, w: rw, width: Math.max(2, 0.22 * u), color: acc }); } },
          v.reason ? { id: 'reason', name: 'Reason', text: v.reason, font: T.body, weight: 400, size: 2.55 * u * bk, min: 1.6 * u, maxLines: 6, lineHeight: 1.42, w: (wide ? 86 : 68) * u, color: ink, gap: 2.6 * u, field: 'reason', fallback: true, input: 'reason' } : null,
          v.date ? { id: 'date', name: 'Date', text: env.date.format(v.date, 'D MMMM YYYY'), font: T.body, weight: 700, size: 1.85 * u * bk, min: 1.4 * u, maxLines: 1, uppercase: true, tracking: 0.14, color: muted, field: 'issued', fallback: true } : null
        ];
        /* A name stays on one line while it can shrink to 60 %; only then, on tall pages, it takes two. */
        var sc0 = wide ? 1.14 : 1.3, nm = bodyItems[1];
        if (!wide && env.fit({ text: v.name, font: nm.font, weight: nm.weight, italic: nm.italic, size: nm.size * sc0, min: nm.size * sc0 * 0.6, maxLines: 1, w: W - 2 * mx }).lineCount === 1) { nm.maxLines = 1; nm.min = nm.size * 0.6; }
        var gapFoot = footH ? 3.4 * u : 0, st;
        if (bandH) {
          L = L.concat(K.stack(env, { x: mx, y: 4.5 * u, w: W - 2 * mx, h: bandH - 9 * u }, headItems, { align: al, valign: 'middle', scale: wide ? 1.1 : 1.2 }).layers);
          st = K.stack(env, { x: mx, y: bandH + 4 * u, w: W - 2 * mx, h: footY - gapFoot - bandH - 4 * u }, bodyItems, { align: al, valign: 'middle', values: vals, scale: sc0 });
        } else {
          var all = headItems.filter(Boolean);
          all[all.length - 1] = Object.assign({}, all[all.length - 1], { gap: 4.4 * u });
          st = K.stack(env, { x: mx, y: top, w: W - 2 * mx, h: footY - gapFoot - top }, all.concat(bodyItems), { align: al, valign: 'middle', values: vals, scale: sc0 });
        }
        page.layers = L.concat(st.layers);
        page.values = vals;
        return { name: 'Certificate — ' + v.name, pages: [page] };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
