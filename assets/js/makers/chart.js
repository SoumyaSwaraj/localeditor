/* Quick maker: chore chart or reward chart to print, one page per child (V12). */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  function boxesSvg(w, h, boxes, o) {
    var out = '';
    boxes.forEach(function (b) {
      if (o.star) {
        var cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = Math.min(b.w, b.h) / 2, r = R * 0.48, d = '';
        for (var i = 0; i < 10; i++) {
          var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
          d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1);
        }
        out += '<path d="' + d + 'Z" fill="' + (o.fill || 'none') + '" stroke="' + o.stroke + '" stroke-width="' + o.width + '" stroke-linejoin="round"/>';
      } else if (o.circle) {
        out += '<circle cx="' + (b.x + b.w / 2).toFixed(1) + '" cy="' + (b.y + b.h / 2).toFixed(1) + '" r="' + (Math.min(b.w, b.h) / 2 - o.width / 2).toFixed(1) + '" fill="' + (o.fill || 'none') + '" stroke="' + o.stroke + '" stroke-width="' + o.width + '"' + (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + '/>';
      } else {
        out += '<rect x="' + (b.x + o.width / 2).toFixed(1) + '" y="' + (b.y + o.width / 2).toFixed(1) + '" width="' + (b.w - o.width).toFixed(1) + '" height="' + (b.h - o.width).toFixed(1) + '" rx="' + (o.radius || 0).toFixed(1) + '" fill="' + (o.fill || 'none') + '" stroke="' + o.stroke + '" stroke-width="' + o.width + '"/>';
      }
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" preserveAspectRatio="none">' + out + '</svg>';
  }

  LE.makers.register({
    id: 'chart',
    name: 'Chore and reward chart',
    category: 'Print',
    summary: 'Jobs for the week with tick boxes, or a reward chart to fill with stars. One page per child.',
    keywords: ['chore chart', 'reward chart', 'sticker chart', 'jobs', 'kids', 'children', 'routine', 'tick', 'print', 'printable', 'star chart', 'behaviour'],
    sizes: ['a4-landscape', 'letter-landscape', 'a4', 'letter'],
    maxPages: 6,
    inputs: [
      { key: 'kind', label: 'Make', type: 'choice', default: 'chores', options: [{ id: 'chores', name: 'Chore chart' }, { id: 'reward', name: 'Reward chart' }] },
      { key: 'title', label: 'Title', type: 'text', max: 40, placeholder: 'My jobs this week' },
      { key: 'names', label: 'Names', type: 'list', max: 6, cellMax: 24, placeholder: 'Maya', hint: 'One page each. Leave empty for a single chart.' },
      { key: 'tasks', label: 'Jobs', type: 'list', max: 12, cellMax: 36, placeholder: 'Make my bed' },
      { key: 'days', label: 'Days', type: 'choice', default: 'week', options: [{ id: 'week', name: 'Whole week' }, { id: 'school', name: 'Weekdays' }] },
      { key: 'weekStart', label: 'Weeks start on', type: 'choice', default: 'mon', options: [{ id: 'mon', name: 'Monday' }, { id: 'sun', name: 'Sunday' }] },
      { key: 'goal', label: 'Stars to fill', type: 'choice', default: '20', options: ['10', '15', '20', '30'], hint: 'For the reward chart.' },
      { key: 'reward', label: 'Reward', type: 'text', max: 60, placeholder: 'A trip to the park' },
      { key: 'accent', label: 'Colour', type: 'color' }
    ],
    styles: [
      { id: 'friendly', name: 'Friendly' },
      { id: 'clean', name: 'Clean' },
      { id: 'pastel', name: 'Pastel' },
      { id: 'bold', name: 'Bold' },
      { id: 'ink', name: 'Ink saver' }
    ],
    sample: { values: {
      kind: 'chores', title: 'My jobs this week', names: ['Maya', 'Leo'],
      tasks: ['Make my bed', 'Feed the cat', 'Pack my school bag', 'Brush teeth, morning and night', 'Tidy my toys', 'Read for 20 minutes'],
      days: 'week', weekStart: 'mon', goal: '20', reward: 'A trip to the park'
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, D = env.date, P = env.print, mm = P.mm;
      var th = P.theme(env.style, v.accent), style = env.style;
      var land = W > H, S = P.safe(land ? 11 : 12);
      var ink = th.ink, acc = th.inkSaver ? ink : th.accent, accInk = C.ensure(acc, th.bg, 4.5);
      var names = v.names && v.names.length ? v.names : [''];
      var tasks = v.tasks && v.tasks.length ? v.tasks : ['Make my bed', 'Tidy up', 'Help at dinner'];
      var ws = v.weekStart === 'sun' ? 0 : 1;
      var dayNames = D.weekdays(ws, 'ddd');
      if (v.days === 'school') dayNames = dayNames.filter(function (n) { return n !== 'Sat' && n !== 'Sun'; });
      var heavy = style === 'bold' ? mm(0.6) : th.hair * 1.4;
      var lineCol = style === 'bold' ? ink : th.inkSaver ? '#6E6E6E' : C.mix(th.line, ink, 0.15);
      var pages = [];

      names.forEach(function (who, pi) {
        var page = env.page(th.bg), L = [];
        var y = S.y;
        /* Header: title kicker + the name in large type. */
        if (style === 'bold') L.push(env.rect({ id: 'band', name: 'Header band', x: 0, y: 0, w: W, h: S.y + mm(land ? 30 : 34), fill: acc }));
        var onBand = style === 'bold' ? C.readable(acc, [ink, '#FFFFFF']) : null;
        var kick = env.text({ id: 'title', name: 'Title', text: v.title || (v.kind === 'reward' ? 'My reward chart' : 'My jobs this week'), x: S.x, y: y, w: S.w * 0.7, font: th.body, weight: 700, size: mm(5.2), min: mm(3.4), maxLines: 1, uppercase: true, tracking: 0.12, color: onBand || accInk });
        L.push(kick);
        var big = env.text({ id: 'name', name: 'Name', text: who || (v.kind === 'reward' ? 'Superstar' : 'Chore chart'), x: S.x, y: kick.y + kick.h + mm(1), w: S.w * 0.72, font: th.head, weight: th.headWeight, size: mm(land ? 17 : 19), min: mm(9), maxLines: 1, lineHeight: 1.05, color: onBand || ink });
        L.push(big);
        /* Decorative stars at the right of the header (not for ink saver). */
        if (!th.inkSaver) {
          var sx = S.x + S.w, sy = kick.y;
          [[0, 0, 15, th.accent3], [-20, 9, 10, th.accent2], [-4, 19, 8, th.accent]].forEach(function (st, i) {
            L.push(env.star({ id: 'star-' + (i + 1), name: 'Star', x: sx - mm(st[2]) + mm(st[0]), y: sy + mm(st[1]), w: mm(st[2]), h: mm(st[2]), fill: style === 'bold' ? ink : st[3] }));
          });
        }
        y = big.y + big.h + (style === 'bold' ? mm(12) : mm(7));
        var footH = v.reward ? mm(land ? 20 : 22) : 0;
        var area = { x: S.x, y: y, w: S.w, h: S.y + S.h - y - (footH ? footH + mm(5) : 0) };

        if (v.kind !== 'reward') {
          var taskW = Math.round(area.w * (land ? 0.34 : 0.38)), headH = mm(10);
          var colW = (area.w - taskW) / dayNames.length;
          var rowH = Math.min(mm(land ? 30 : 34), (area.h - headH) / tasks.length);
          var tableH = headH + rowH * tasks.length;
          if (style === 'friendly' || style === 'pastel') L.push(env.rect({ id: 'head-band', name: 'Days band', x: area.x + taskW, y: area.y, w: area.w - taskW, h: headH, radius: th.r, fill: acc }));
          var dayInk = style === 'friendly' || style === 'pastel' ? C.readable(acc, ['#FFFFFF', ink]) : th.muted;
          dayNames.forEach(function (n, i) {
            L.push(env.text({ id: 'day-' + (i + 1), name: n, text: n, x: area.x + taskW + i * colW, y: area.y, w: colW, h: headH, valign: 'middle', font: th.body, weight: 700, size: mm(4.2), min: mm(2.8), maxLines: 1, uppercase: true, tracking: 0.06, align: 'center', color: dayInk }));
          });
          var boxes = [], stripes = [];
          tasks.forEach(function (t, r) {
            var ry = area.y + headH + r * rowH;
            if (r % 2 === 0 && th.faint && !th.inkSaver && style !== 'bold') stripes.push(env.rect({ id: 'row-' + (r + 1), name: 'Row ' + (r + 1), x: area.x, y: ry, w: area.w, h: rowH, radius: th.r, fill: th.faint }));
            L.push(env.text({ id: 'task-' + (r + 1), name: 'Job ' + (r + 1), text: t, x: area.x + mm(3), y: ry, w: taskW - mm(5), h: rowH, valign: 'middle', font: th.body, weight: 700, size: Math.min(mm(7), rowH * 0.3), min: mm(3), maxLines: 2, lineHeight: 1.15, color: ink }));
            var bs = Math.min(rowH * 0.62, colW * 0.62, mm(15));
            dayNames.forEach(function (_, c) {
              boxes.push({ x: taskW + c * colW + (colW - bs) / 2, y: headH + r * rowH + (rowH - bs) / 2, w: bs, h: bs });
            });
          });
          L = stripes.concat(L);
          L.push(env.svg({ id: 'tick-boxes', name: 'Tick boxes', x: area.x, y: area.y, w: area.w, h: tableH, markup: boxesSvg(area.w, tableH, boxes, { stroke: lineCol, width: heavy, radius: mm(style === 'friendly' ? 2.5 : 1.2), fill: th.inkSaver || style === 'bold' ? 'none' : '#FFFFFF', circle: style === 'pastel' }) }));
        } else {
          var n = Number(v.goal) || 20;
          var cols = land ? (n === 15 ? 5 : n === 10 ? 5 : n === 30 ? 10 : 10) : (n === 30 ? 6 : 5);
          var rows = Math.ceil(n / cols);
          var cell = Math.min(area.w / cols, area.h / rows);
          var gw = cell * cols, gh = cell * rows;
          var gx = area.x + (area.w - gw) / 2, gy = area.y + (area.h - gh) / 2;
          var spots = [];
          for (var i = 0; i < n; i++) spots.push({ x: (i % cols) * cell + cell * 0.1, y: Math.floor(i / cols) * cell + cell * 0.1, w: cell * 0.8, h: cell * 0.8 });
          L.push(env.svg({ id: 'stars', name: 'Stars to fill', x: gx, y: gy, w: gw, h: gh, markup: boxesSvg(gw, gh, spots, { stroke: style === 'bold' ? ink : th.inkSaver ? '#6E6E6E' : C.mix(acc, ink, 0.2), width: heavy * 1.2, star: style !== 'clean', circle: style === 'clean', dash: th.inkSaver ? '' : '', fill: th.inkSaver ? 'none' : style === 'bold' ? '#FFFFFF' : th.faint || 'none' }) }));
          spots.forEach(function (sp, i) {
            L.push(env.text({ id: 'num-' + (i + 1), name: 'Number ' + (i + 1), text: String(i + 1), x: gx + sp.x, y: gy + sp.y + sp.h * (style === 'clean' ? 0.32 : 0.38), w: sp.w, h: sp.h * 0.3, valign: 'middle', align: 'center', font: th.body, weight: 700, size: Math.min(mm(5), cell * 0.13), min: mm(2.4), maxLines: 1, color: th.muted }));
          });
        }
        if (footH) {
          var fy = S.y + S.h - footH;
          var fFill = th.inkSaver ? null : style === 'bold' ? acc : th.faint;
          L.push(env.rect({ id: 'reward-box', name: 'Reward box', x: S.x, y: fy, w: S.w, h: footH, radius: th.r * 1.5, fill: fFill || { type: 'none' }, stroke: fFill ? (style === 'bold' ? { width: heavy, color: ink } : null) : { width: th.hair, color: th.line } }));
          var fInk = fFill ? C.readable(fFill, [ink, '#FFFFFF']) : ink;
          var lbl = env.text({ id: 'reward-label', name: 'Reward label', text: v.kind === 'reward' ? 'When all the stars are filled:' : 'When the week is done:', x: S.x + mm(6), y: fy, w: S.w * 0.4, h: footH, valign: 'middle', font: th.body, weight: 700, size: mm(5.2), min: mm(3), maxLines: 2, color: fFill ? fInk : accInk });
          L.push(lbl);
          L.push(env.text({ id: 'reward', name: 'Reward', text: v.reward, x: lbl.x + lbl.w + mm(4), y: fy + mm(2), w: S.x + S.w - mm(6) - (lbl.x + lbl.w + mm(4)), h: footH - mm(4), valign: 'middle', font: th.head, weight: th.headWeight, size: mm(8), min: mm(4), maxLines: 2, lineHeight: 1.1, color: fInk }));
        }
        page.layers = L;
        pages.push(page);
      });
      return { name: (v.kind === 'reward' ? 'Reward chart' : 'Chore chart') + (v.names && v.names.length ? ' — ' + v.names.join(', ') : ''), pages: pages };
    }
  });
})();
