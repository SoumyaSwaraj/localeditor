/* Quick maker: app-store screenshot set (V21). One page per screenshot (up to six), each a headline, an optional
   sub-line and the screenshot in a generic device drawn from shapes: a rounded body, an even bezel and a round camera
   dot. No real product's outline, notch or buttons. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  LE.makers.register({
    id: 'appshots',
    name: 'App store screenshots',
    category: 'Business',
    summary: 'A set of store screenshots: a headline over each screen in a simple device frame.',
    keywords: ['app store', 'play store', 'screenshots', 'app', 'mockup', 'device', 'phone', 'tablet', 'launch', 'listing', 'marketing'],
    sizes: [
      { id: 'phone', name: 'Phone', w: 1290, h: 2796 },
      { id: 'phone916', name: 'Phone 9:16', w: 1080, h: 1920 },
      { id: 'tablet', name: 'Tablet', w: 2048, h: 2732 }
    ],
    inputs: [
      { key: 'shots', label: 'Screens', type: 'list', columns: ['Headline', 'Sub-line'], required: true, max: 6, cellMax: 60, placeholder: 'Plan your week in a minute', hint: 'One line per page, in order. Up to six.' },
      { key: 'photos', label: 'Screenshots', type: 'photos', max: 6, hint: 'In the same order as the lines above.' },
      { key: 'accent', label: 'Colour', type: 'color' },
      { key: 'accent2', label: 'Second colour', type: 'color' },
      { key: 'device', label: 'Device', type: 'choice', options: [{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }], default: 'dark' }
    ],
    styles: [
      { id: 'centred', name: 'Device centred' },
      { id: 'tilted', name: 'Tilted' },
      { id: 'bleed', name: 'Off the bottom' },
      { id: 'below', name: 'Text below' },
      { id: 'panorama', name: 'Panorama' }
    ],
    sample: { values: {
      shots: [['Plan your week in a minute', 'Drag tasks onto the days that suit you'], ['See everything at a glance', ''], ['Share lists with your people', 'Changes show up for everyone at once'], ['Works offline', 'Your plans stay on your phone']],
      photos: ['sample:street-01', 'sample:arch-03', 'sample:travel-05', 'sample:sky-04'], accent: '#5B3FD9', accent2: '#E85D75'
    } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color, style = env.style;
      var u = W / 100;
      var tablet = env.size.id === 'tablet';
      var rows = (v.shots || []).slice(0, 6), photos = (v.photos || []).slice(0, 6);
      var n = Math.max(1, Math.min(6, Math.max(rows.length, photos.length)));
      var c1 = v.accent || '#5B3FD9', c2 = v.accent2 || C.mix(c1, '#FF7A59', 0.6);
      /* One ink for the whole set; push the background until it reads at both ends. */
      var ink = C.readable(C.mix(c1, c2, 0.5), ['#FFFFFF', '#14121A']);
      var fix = function (c) { for (var i = 0; i < 12 && C.contrast(ink, c) < 4.6; i++) c = ink === '#FFFFFF' ? C.shade(c, 0.1) : C.tint(c, 0.12); return c; };
      c1 = fix(c1); c2 = fix(c2);
      var sub = C.mix(ink, ink === '#FFFFFF' ? c1 : '#FFFFFF', 0.12);
      var dark = (v.device || 'dark') === 'dark';
      var body = dark ? '#16161A' : '#ECECEF', edge = dark ? '#3A3A42' : '#C9C9D0';
      var screenRatio = tablet ? 4 / 3 : 2796 / 1290;
      var M = 7 * u;

      function device(cx, cy, dw, rot, i) {
        var bz = dw * (tablet ? 0.035 : 0.03);
        var sw = dw - 2 * bz, sh = sw * screenRatio, dh = sh + 2 * bz;
        var r = dw * (tablet ? 0.06 : 0.14), ri = Math.max(0, r - bz);
        var x = cx - dw / 2, y = cy - dh / 2;
        var out = [];
        out.push(env.rect({ id: 'device', name: 'Device', x: x, y: y, w: dw, h: dh, radius: r, fill: body, stroke: { width: Math.max(2, dw * 0.004), color: edge }, rotation: rot, shadow: { color: 'rgba(0,0,0,.28)', blur: dw * 0.08, x: 0, y: dw * 0.03 } }));
        out.push(env.photo({ id: 'screen', name: 'Screenshot ' + (i + 1), src: photos[i], x: x + bz, y: y + bz, w: sw, h: sh, radius: ri, rotation: rot, label: 'Add screenshot ' + (i + 1), slot: 'screen' + (i + 1), focus: { x: 0.5, y: 0 } }));
        /* Camera: a round dot, in the bezel on tablets, a small punch-hole on phones. Placed by rotating its centre. */
        var d = tablet ? bz * 0.45 : sw * 0.035;
        var ox = 0, oy = tablet ? -dh / 2 + bz / 2 : -sh / 2 + sw * 0.045;
        var a = rot * Math.PI / 180;
        var px = cx + ox * Math.cos(a) - oy * Math.sin(a), py = cy + ox * Math.sin(a) + oy * Math.cos(a);
        out.push(env.ellipse({ id: 'camera', name: 'Camera', x: px - d / 2, y: py - d / 2, w: d, h: d, fill: dark ? '#0B0B0D' : '#2A2A30' }));
        return { layers: out, h: dh, w: dw };
      }
      function words(i, x, y, w, align, s) {
        var row = rows[i] || ['', ''];
        var out = [];
        var hl = env.text({ id: 'headline', name: 'Headline ' + (i + 1), text: row[0] || ' ', x: x, y: y, w: w, font: 'Plus Jakarta Sans', weight: 700, size: (tablet ? 7 : 10) * u * s, min: 4 * u, maxLines: 3, lineHeight: 1.08, tracking: -0.02, align: align, color: ink, balance: true });
        out.push(hl);
        if (row[1]) out.push(env.text({ id: 'subline', name: 'Sub-line ' + (i + 1), text: row[1], x: x, y: hl.y + hl.h + 2 * u, w: w, font: 'Inter', weight: 400, size: (tablet ? 3.4 : 4.8) * u * s, min: 2.4 * u, maxLines: 3, lineHeight: 1.3, align: align, color: sub, balance: true }));
        var b = out[out.length - 1];
        return { layers: out, bottom: b.y + b.h, top: hl.y };
      }
      function bgFor(i) {
        if (style === 'panorama') return { type: 'gradient', kind: 'linear', angle: 0, colors: [C.mix(c1, c2, i / n), C.mix(c1, c2, (i + 1) / n)] };
        return { type: 'gradient', kind: 'linear', angle: 160, colors: [c1, c2] };
      }

      var pages = [];
      for (var i = 0; i < n; i++) {
        var page = env.page(bgFor(i)), L = [];
        var dw0 = tablet ? W * 0.74 : W * 0.66;
        if (style === 'panorama') {
          /* Big rings and a ribbon positioned on the whole strip, so they run across the seams. */
          var total = n * W, off = -i * W;
          var ring = Math.max(2, 2.4 * u);
          for (var k = 0; k <= n; k++) {
            var gx = k * W - W * 0.28 + (k % 2 ? W * 0.1 : 0), gy = H * (k % 2 ? 0.62 : 0.3), gd = W * (k % 2 ? 0.9 : 0.7);
            if (gx + gd + off < 0 || gx + off > W) continue;
            L.push(env.ellipse({ id: 'ring', name: 'Ring', x: gx + off, y: gy, w: gd, h: gd, fill: { type: 'none' }, stroke: { width: ring, color: C.rgba(ink, 0.14) } }));
          }
          var t = words(i, M, H * 0.06, W - 2 * M, 'center', 1);
          var top = t.bottom + 5 * u, avail = H - top - 4 * u;
          var dw = Math.min(dw0, avail / (screenRatio * 1.06 + 0.06));
          var dv = device(W / 2 + (i % 2 ? 4 : -4) * u, top + avail / 2 + (i % 2 ? 2 : -1) * u, dw, 0, i);
          L = L.concat(dv.layers, t.layers);
        } else if (style === 'below') {
          var tb = words(i, M, 0, W - 2 * M, 'center', 1);
          var tbH = tb.bottom - tb.top;
          tb.layers.forEach(function (l) { l.y += H - 7 * u - tbH; });
          var avail2 = H - 7 * u - tbH - 5 * u - 6 * u;
          var dw2 = Math.min(dw0, avail2 / (screenRatio * 1.06 + 0.06));
          var dv2 = device(W / 2, 6 * u + avail2 / 2, dw2, 0, i);
          L = L.concat(dv2.layers, tb.layers);
        } else if (style === 'bleed') {
          var t3 = words(i, M, H * 0.07, W - 2 * M, 'center', 1.05);
          var dw3 = tablet ? W * 0.84 : W * 0.8;
          var dh3 = dw3 * (1 - 0.06) * screenRatio + dw3 * 0.06;
          var top3 = t3.bottom + 6 * u;
          var dv3 = device(W / 2, top3 + dh3 / 2, dw3, 0, i);
          L = L.concat(dv3.layers, t3.layers);
        } else if (style === 'tilted') {
          var left = i % 2 === 0;
          var t4 = words(i, M, H * 0.07, W - 2 * M, left ? 'left' : 'right', 1);
          var dw4 = tablet ? W * 0.72 : W * 0.68;
          var dh4 = dw4 * (1 - 0.06) * screenRatio + dw4 * 0.06;
          var top4 = t4.bottom + 8 * u;
          var dv4 = device(W / 2 + (left ? 9 : -9) * u, top4 + dh4 / 2, dw4, left ? -8 : 8, i);
          L = L.concat(dv4.layers, t4.layers);
        } else {
          var t5 = words(i, M, H * 0.07, W - 2 * M, 'center', 1);
          var top5 = t5.bottom + 6 * u, avail5 = H - top5 - 6 * u;
          var dw5 = Math.min(dw0, avail5 / (screenRatio * 1.06 + 0.06));
          var dv5 = device(W / 2, top5 + avail5 / 2, dw5, 0, i);
          L = L.concat(dv5.layers, t5.layers);
        }
        page.layers = L;
        pages.push(page);
      }
      return { name: 'App screenshots — ' + ((rows[0] && rows[0][0]) || 'set'), pages: pages };
    }
  });
})();
