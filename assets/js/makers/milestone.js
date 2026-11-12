/* Quick maker: milestone card (V2). Counts the time since a start date with calendar-correct maths. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var KINDS = {
    baby: { name: 'Baby', suffix: 'old', tint: '#F6E6D8', ink: '#5A2E1B', accent: '#D9774B' },
    pet: { name: 'Pet', suffix: 'with us', tint: '#E3EDDA', ink: '#22402A', accent: '#4F8A3C' },
    couple: { name: 'Couple', suffix: 'together', tint: '#F6DFE3', ink: '#5C1C34', accent: '#C9466E' },
    sober: { name: 'Sobriety', suffix: 'sober', tint: '#DFE9F3', ink: '#14304F', accent: '#2F6BB0' },
    work: { name: 'Work anniversary', suffix: 'and counting', tint: '#E9E4F6', ink: '#2A2154', accent: '#6A4FE8' },
    other: { name: 'Something else', suffix: 'and counting', tint: '#F2ECDD', ink: '#3A2E14', accent: '#B9832F' }
  };

  /* { num, unit, line }: num is a big figure when the span reads well as one ("6", "months today"). */
  function elapsed(v, env) {
    var kind = KINDS[v.kind] || KINDS.other;
    if (!v.start) return null;
    var asOf = v.asOf || env.today;
    var d = env.date.diff(v.start, asOf);
    if (!d || d.sign < 0) return { num: '', unit: '', line: 'Starts ' + env.date.format(v.start, 'D MMMM YYYY') };
    var exact = d.days === 0;
    var suffix = exact && v.kind !== 'sober' ? 'today' : kind.suffix;
    if (v.kind === 'sober' && d.totalDays < 1000) return { num: String(d.totalDays), unit: (d.totalDays === 1 ? 'day ' : 'days ') + suffix, line: d.totalDays + ' days ' + suffix };
    if (d.totalMonths < 1) {
      var weeks = d.totalDays >= 14 && d.totalDays % 7 === 0;
      var n = weeks ? d.totalWeeks : d.totalDays;
      var u = weeks ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days');
      return { num: String(n), unit: u + ' ' + suffix, line: n + ' ' + u + ' ' + suffix };
    }
    if (exact && d.months === 0 && d.years) return { num: String(d.years), unit: (d.years === 1 ? 'year ' : 'years ') + suffix, line: d.years + (d.years === 1 ? ' year ' : ' years ') + suffix };
    if (exact && d.totalMonths < 24) return { num: String(d.totalMonths), unit: (d.totalMonths === 1 ? 'month ' : 'months ') + suffix, line: d.totalMonths + (d.totalMonths === 1 ? ' month ' : ' months ') + suffix };
    var text = env.date.describe(v.start, asOf);
    return { num: '', unit: '', line: text + ' ' + suffix };
  }

  function archPath(w, h) {
    var r = w / 2;
    return 'M0 ' + h + 'L0 ' + r.toFixed(1) + 'A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 0 1 ' + w + ' ' + r.toFixed(1) + 'L' + w + ' ' + h + 'Z';
  }

  LE.makers.register({
    id: 'milestone',
    name: 'Milestone card',
    category: 'Life',
    summary: '“6 months today” for a baby, a pet, a couple, sobriety or work.',
    keywords: ['milestone', 'anniversary', 'baby', 'months', 'birthday', 'pet', 'gotcha day', 'sober', 'sobriety', 'work anniversary', 'couple', 'together'],
    inputs: [
      { key: 'kind', label: 'For', type: 'choice', default: 'baby', options: Object.keys(KINDS).map(function (k) { return { id: k, name: KINDS[k].name }; }) },
      { key: 'start', label: 'Start date', type: 'date', hint: 'Birthday, adoption day, first date, last drink, first day at work' },
      { key: 'asOf', label: 'As of', type: 'date', today: true, hint: 'Today when left empty' },
      { key: 'headline', label: 'Headline', type: 'text', max: 40, placeholder: '6 months today', hint: 'Leave empty to count from the start date' },
      { key: 'name', label: 'Name', type: 'text', max: 40, placeholder: 'Arlo' },
      { key: 'note', label: 'Note', type: 'text', max: 80, placeholder: 'Our little sunshine' },
      { key: 'photo', label: 'Photo', type: 'photo' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'soft', name: 'Soft arch' },
      { id: 'bold', name: 'Big number' },
      { id: 'polaroid', name: 'Snapshot' },
      { id: 'badge', name: 'Badge' },
      { id: 'minimal', name: 'Full photo' }
    ],
    sample: { values: { kind: 'baby', start: '2026-05-12', asOf: '2026-11-12', name: 'Arlo', note: 'Our little sunshine', photo: 'sample:people-07' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color;
      var kind = KINDS[v.kind] || KINDS.other;
      var top = env.tall ? 220 : 88, bottom = env.tall ? 280 : 88, M = 88;
      var e = v.headline ? { num: '', unit: '', line: v.headline } : (elapsed(v, env) || { num: '', unit: '', line: '6 months today' });
      var since = v.start ? 'Since ' + env.date.format(v.start, 'D MMMM YYYY') : '';
      var accent = v.accent || kind.accent;
      var L = [], page;
      function sub(x, y, w, align, ink, size) {
        var out = [];
        var nm = [v.name, v.note].filter(Boolean);
        if (v.name) out.push(env.text({ id: 'name', name: 'Name', text: v.name, x: x, y: y, w: w, font: 'Fraunces', weight: 700, size: size * 1.35, min: size * 0.8, maxLines: 2, align: align, color: ink, balance: true }));
        if (v.note) out.push(env.text({ id: 'note', name: 'Note', text: v.note, x: x, y: 0, w: w, font: 'Inter', weight: 400, size: size, min: size * 0.7, maxLines: 3, align: align, color: ink, balance: true }));
        if (since) out.push(env.text({ id: 'since', name: 'Date', text: since, x: x, y: 0, w: w, font: 'Inter', weight: 700, size: size * 0.72, min: size * 0.5, maxLines: 1, align: align, uppercase: true, tracking: 0.14, color: ink }));
        var cy = y;
        out.forEach(function (l, i) { l.y = cy; cy += l.h + (i === out.length - 2 && since ? size * 0.9 : size * 0.35); });
        return out;
      }
      function headline(x, y, w, h, align, ink, accentInk, fonts) {
        var out = [];
        if (e.num) {
          var big = env.text({ id: 'number', name: 'Number', text: e.num, x: x, y: y, w: w, h: h * 0.62, font: fonts.num, weight: fonts.numWeight || 700, size: fonts.numSize, min: fonts.numSize * 0.4, maxLines: 1, lineHeight: 1, align: align, color: accentInk });
          var unit = env.text({ id: 'unit', name: 'Unit', text: e.unit, x: x, y: big.y + big.h + (fonts.gap || 0), w: w, h: h * 0.38, font: fonts.unit, weight: fonts.unitWeight || 400, italic: !!fonts.unitItalic, size: fonts.unitSize, min: fonts.unitSize * 0.45, maxLines: 2, lineHeight: 1.05, align: align, uppercase: !!fonts.upper, tracking: fonts.tracking || 0, color: ink, balance: true });
          out.push(big, unit);
        } else {
          out.push(env.text({ id: 'headline', name: 'Headline', text: e.line, x: x, y: y, w: w, h: h, font: fonts.line || fonts.unit, weight: fonts.lineWeight || 700, italic: !!fonts.lineItalic, size: fonts.lineSize, min: fonts.lineSize * 0.35, maxLines: 3, lineHeight: 1.05, align: align, uppercase: !!fonts.upper, color: fonts.lineInk || ink, balance: true }));
        }
        return out;
      }
      function below(a, b, gap) { var y = Math.max.apply(null, a.map(function (l) { return l.y + l.h; })) + gap; var t = Math.min.apply(null, b.map(function (l) { return l.y; })); b.forEach(function (l) { l.y += y - t; }); }

      if (env.style === 'soft') {
        var bg = v.accent ? C.tint(v.accent, 0.84) : kind.tint;
        var ink = C.ensure(kind.ink, bg, 7);
        page = env.page(bg);
        var aw = Math.round(W * (env.square ? 0.42 : env.tall ? 0.7 : 0.56)), ah = Math.round(aw * 1.18);
        var ax = (W - aw) / 2;
        var arch = env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: ax, y: top, w: aw, h: ah, maskPath: archPath(aw, ah), label: 'Add a photo' });
        var hl = headline(M, 0, W - 2 * M, env.square ? 300 : 380, 'center', ink, C.ensure(accent, bg, 4.5), { num: 'Fraunces', numSize: env.square ? 200 : 240, unit: 'Dancing Script', unitWeight: 700, unitSize: 76, lineSize: 92, line: 'Fraunces', gap: -6 });
        below([arch], hl, 36);
        var sb = sub(M, 0, W - 2 * M, 'center', ink, 32);
        if (sb.length) below(hl, sb, 28);
        var all = [arch].concat(hl, sb);
        env.place(all, { x: 0, y: top, w: W, h: H - top - bottom }, 'middle');
        L = all;
      } else if (env.style === 'bold') {
        var dark = '#16131C';
        page = env.page(dark);
        var ph = Math.round(H * (env.tall ? 0.52 : 0.5));
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: ph, label: 'Add a photo' }));
        var hot = C.ensure(v.accent || '#FFD43B', dark, 7);
        var area = { x: M, y: ph + 56, w: W - 2 * M, h: H - ph - 56 - bottom + (env.tall ? 0 : 20) };
        var hl2 = headline(area.x, area.y, area.w, area.h * 0.68, 'left', '#F6F2EA', hot, { num: 'Anton', numWeight: 400, numSize: env.square ? 230 : 300, unit: 'Bebas Neue', unitSize: 92, upper: true, tracking: 0.02, line: 'Anton', lineWeight: 400, lineSize: 120, lineInk: hot, gap: 4 });
        var sb2 = sub(area.x, 0, area.w, 'left', '#F6F2EA', 30);
        if (sb2.length) below(hl2, sb2, 24);
        var blk = hl2.concat(sb2);
        env.place(blk, area, 'middle');
        L = L.concat(blk);
      } else if (env.style === 'polaroid') {
        var bgp = v.accent ? C.tint(v.accent, 0.7) : C.mix(kind.tint, kind.accent, 0.22);
        page = env.page(bgp);
        var fw = Math.round(W * (env.square ? 0.6 : env.tall ? 0.8 : 0.74)), fpad = Math.round(fw * 0.06);
        var phw = fw - 2 * fpad, phh = phw;
        var capH = Math.round(fw * (env.square ? 0.3 : 0.34));
        var fh = fpad + phh + capH;
        var fx = (W - fw) / 2;
        var frame = env.rect({ id: 'frame', name: 'Snapshot frame', x: fx, y: 0, w: fw, h: fh, fill: '#FFFEFB', rotation: -2, shadow: { color: 'rgba(30,20,10,.22)', blur: 36, x: 0, y: 14 } });
        var pic = env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: fx + fpad, y: fpad, w: phw, h: phh, rotation: -2, label: 'Add a photo', adjust: { warmth: 8, contrast: 4 } });
        var cap = env.text({ id: 'headline', name: 'Caption', text: e.line, x: fx + fpad, y: fpad + phh + fpad * 0.6, w: phw, h: capH - fpad * 1.6, valign: 'middle', font: 'Caveat', weight: 700, size: 96, min: 34, maxLines: 2, lineHeight: 1.0, align: 'center', color: '#24212B', rotation: -2, balance: true });
        var grp = [frame, pic, cap];
        var inkp = C.readable(bgp, [kind.ink, '#16131C']);
        var sb3 = sub(M, fh + 60, W - 2 * M, 'center', inkp, 32);
        var allp = grp.concat(sb3);
        env.place(allp, { x: 0, y: top, w: W, h: H - top - bottom }, 'middle');
        L = allp;
      } else if (env.style === 'badge') {
        var deep = v.accent ? C.shade(v.accent, 0.55) : C.shade(kind.accent, 0.6);
        var cream = '#FBF4E6';
        page = env.page(deep);
        var ring = Math.round(W * (env.square ? 0.56 : 0.66));
        var rx = (W - ring) / 2;
        var badge = [];
        badge.push(env.ellipse({ id: 'ring', name: 'Badge', x: rx, y: 0, w: ring, h: ring, fill: cream }));
        badge.push(env.ellipse({ id: 'ring-line', name: 'Badge ring', x: rx + ring * 0.05, y: ring * 0.05, w: ring * 0.9, h: ring * 0.9, fill: { type: 'none' }, stroke: { width: 4, color: deep } }));
        var inner = { x: rx + ring * 0.16, y: ring * 0.2, w: ring * 0.68, h: ring * 0.6 };
        var hl3 = headline(inner.x, 0, inner.w, inner.h, 'center', deep, deep, { num: 'Montserrat', numSize: ring * 0.36, unit: 'Montserrat', unitWeight: 700, unitSize: ring * 0.075, upper: true, tracking: 0.12, line: 'Montserrat', lineSize: ring * 0.11, gap: 0 });
        env.place(hl3, inner, 'middle');
        badge = badge.concat(hl3);
        var sb4 = sub(M, 0, W - 2 * M, 'center', cream, 34);
        var pre = [];
        if (v.photo) pre.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: (W - 180) / 2, y: 0, w: 180, h: 180, mask: 'ellipse', border: { width: 6, color: cream }, label: 'Add a photo' }));
        if (pre.length) below(pre, badge, 40);
        if (sb4.length) below(badge, sb4, 48);
        var allb = pre.concat(badge, sb4);
        env.place(allb, { x: 0, y: top, w: W, h: H - top - bottom }, 'middle');
        L = allb;
      } else {
        page = env.page('#2A2433');
        L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: 0, y: 0, w: W, h: H, label: 'Add a photo' }));
        L.push(env.rect({ id: 'scrim', name: 'Shade', x: 0, y: Math.round(H * 0.35), w: W, h: H - Math.round(H * 0.35), fill: { type: 'linear', angle: 90, colors: ['rgba(10,8,16,0)', 'rgba(10,8,16,0.55)', 'rgba(10,8,16,0.88)'] } }));
        var fa = { x: M, y: Math.round(H * 0.56), w: W - 2 * M, h: H - Math.round(H * 0.56) - bottom };
        var hl4 = headline(fa.x, 0, fa.w, fa.h * 0.62, 'left', '#FFFFFF', '#FFFFFF', { num: 'Inter', numSize: 200, unit: 'Inter', unitWeight: 700, unitSize: 64, line: 'Inter', lineSize: 96, gap: -8 });
        var sb5 = sub(fa.x, 0, fa.w, 'left', '#FFFFFF', 30);
        if (sb5.length) below(hl4, sb5, 20);
        var blk5 = hl4.concat(sb5);
        env.place(blk5, fa, 'bottom');
        L = L.concat(blk5);
      }
      page.layers = L;
      return { name: (v.name ? v.name + ' — ' : '') + e.line, pages: [page] };
    }
  });
  LE.makers.milestoneElapsed = elapsed;
})();
