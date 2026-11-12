/* Quick maker: film-camera looks (V6). The look is data on the photo layer (adjust and filter), never baked. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;

  var STAMP = '#FF9A3D';
  var LOOKS = {
    film: { warmth: 12, contrast: 6, saturation: -8, vignette: 0.24, grain: 16, fade: 14, highlights: -6 },
    instant: { warmth: 16, contrast: -6, saturation: -12, vignette: 0.16, grain: 8, fade: 22, exposure: 0.04 },
    flash: { exposure: 0.1, contrast: 24, saturation: 14, vignette: 0.46, grain: 22, highlights: 8, shadows: -10 },
    strip: { warmth: 8, contrast: 10, saturation: -14, vignette: 0.2, grain: 18, fade: 10 }
  };

  function holes(env, x, y, w, h, horizontal, color, pitch) {
    var out = [], hw = horizontal ? pitch * 0.5 : h, hh = horizontal ? w : pitch * 0.5;
    var n = Math.floor((horizontal ? w : h) / pitch);
    var off = ((horizontal ? w : h) - n * pitch) / 2 + pitch * 0.25;
    var d = '';
    for (var i = 0; i < n; i++) {
      var a = off + i * pitch;
      var rx = horizontal ? a : 0, ry = horizontal ? 0 : a, ww = horizontal ? pitch * 0.5 : w, hh2 = horizontal ? h : pitch * 0.5;
      d += '<rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + ww.toFixed(1) + '" height="' + hh2.toFixed(1) + '" rx="' + (Math.min(ww, hh2) * 0.22).toFixed(1) + '" fill="' + color + '"/>';
    }
    return env.svg({ id: 'sprockets', name: 'Sprocket holes', markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + Math.round(w) + ' ' + Math.round(h) + '">' + d + '</svg>', x: x, y: y, w: Math.round(w), h: Math.round(h) });
  }

  LE.makers.register({
    id: 'film',
    name: 'Film camera',
    category: 'Photo',
    summary: 'Your photo on 35mm, an instant print or a disposable, with a date stamp.',
    keywords: ['film', '35mm', 'analog', 'polaroid', 'instant', 'disposable', 'date stamp', 'vintage', 'retro', 'contact sheet', 'strip'],
    inputs: [
      { key: 'photos', label: 'Photos', type: 'photos', required: true, max: 4, hint: 'One photo, or up to four for the strip' },
      { key: 'stamp', label: 'Date stamp', type: 'toggle', default: true },
      { key: 'date', label: 'Date', type: 'date', hint: 'Taken from the photo when it knows' },
      { key: 'caption', label: 'Caption', type: 'text', max: 48, placeholder: 'summer, finally' },
      { key: 'backdrop', label: 'Backdrop', type: 'color' }
    ],
    styles: [
      { id: '35mm', name: '35mm' },
      { id: 'instant', name: 'Instant print' },
      { id: 'disposable', name: 'Disposable flash' },
      { id: 'strip', name: 'Contact strip' }
    ],
    sample: { values: { photos: ['sample:people-08', 'sample:travel-06', 'sample:street-01', 'sample:travel-05'], stamp: true, date: '1998-08-14', caption: 'summer, finally' } },
    build: function (v, env) {
      var W = env.W, H = env.H, C = env.color;
      var photos = v.photos || [];
      var date = v.date || env.today;
      var stampText = env.date.format(date, "'YY MM DD");
      var top = env.tall ? 200 : 72, bottom = env.tall ? 260 : 72;
      var L = [], page;
      function stamp(ph, size) {
        if (v.stamp === false) return [];
        var t = env.text({ id: 'date-stamp', name: 'Date stamp', text: stampText, x: ph.x + ph.w * 0.4, y: 0, w: ph.w * 0.6 - size * 0.9, font: 'Space Mono', weight: 700, size: size, min: size * 0.6, maxLines: 1, align: 'right', tracking: 0.06, color: STAMP, opacity: 0.92, shadow: { color: 'rgba(255,110,20,.75)', blur: size * 0.45, x: 0, y: 0 } });
        t.y = Math.round(ph.y + ph.h - t.h - size * 0.7);
        if (ph.rotation) t.rotation = ph.rotation;
        return [t];
      }
      function leak(ph, side) {
        var s = Math.max(ph.w, ph.h) * 0.7;
        return env.ellipse({ id: 'light-leak', name: 'Light leak', x: side ? ph.x + ph.w - s * 0.55 : ph.x - s * 0.45, y: ph.y + ph.h * 0.1 - s * 0.3, w: s, h: s, fill: { type: 'radial', colors: ['rgba(255,140,60,0.65)', 'rgba(255,90,40,0.18)', 'rgba(255,90,40,0)'] }, blend: 'screen', opacity: 0.85 });
      }
      function caption(x, y, w, ink, size, align) {
        if (!v.caption) return [];
        return [env.text({ id: 'caption', name: 'Caption', text: v.caption, x: x, y: y, w: w, font: 'Caveat', weight: 700, size: size, min: size * 0.5, maxLines: 2, align: align || 'center', color: ink, balance: true })];
      }

      if (env.style === '35mm') {
        var bg = v.backdrop || '#ECE6DA';
        page = env.page(bg);
        var landscape = env.square;
        var stripC = '#171513', band = landscape ? 70 : 64;
        var fw, fh, sx, sy, sw, sh;
        if (landscape) {
          sw = W; fw = W - 2 * 56; fh = Math.round(fw * 2 / 3); sh = fh + 2 * band;
        } else {
          fh = Math.round(Math.min((H - top - bottom) * 0.8, (W - 2 * band - 120) * 1.5)); fw = Math.round(fh * 2 / 3); sw = fw + 2 * band; sh = H;
        }
        var cap = caption(80, 0, W - 160, C.readable(bg, ['#1F1B16']), 76);
        var capH = cap.length ? cap[0].h + 40 : 0;
        if (landscape) { sx = 0; sy = Math.round(top + (H - top - bottom - sh - capH) / 2); } else { sx = Math.round((W - sw) / 2); sy = 0; }
        L.push(env.rect({ id: 'film', name: 'Film strip', x: sx, y: sy, w: sw, h: sh, fill: stripC }));
        if (landscape) {
          L.push(holes(env, sx, sy + band * 0.3, sw, band * 0.4, true, bg, 46));
          L.push(holes(env, sx, sy + sh - band * 0.7, sw, band * 0.4, true, bg, 46));
        } else {
          L.push(holes(env, sx + band * 0.3, sy, band * 0.4, sh, false, bg, 46));
          L.push(holes(env, sx + sw - band * 0.7, sy, band * 0.4, sh, false, bg, 46));
        }
        var fx = landscape ? 56 : sx + band, fy = landscape ? sy + band : Math.round(top + (H - top - bottom - fh - capH) / 2);
        var ph = env.photo({ id: 'photo', name: 'Photo', src: photos[0], x: fx, y: fy, w: fw, h: fh, adjust: LOOKS.film, label: 'Add a photo' });
        L.push(ph);
        L.push(leak(ph, 0));
        var edge = 'LE 400   ▸ 12   12A';
        var et = landscape
          ? env.text({ id: 'edge', name: 'Edge marking', text: edge, x: fx + 20, y: sy + 6, w: fw * 0.6, font: 'Space Mono', weight: 700, size: 18, maxLines: 1, tracking: 0.1, color: '#E8902E' })
          : env.text({ id: 'edge', name: 'Edge marking', text: edge, x: 0, y: 0, w: 300, font: 'Space Mono', weight: 700, size: 14, maxLines: 1, tracking: 0.1, color: '#E8902E' });
        if (!landscape) { et.rotation = 90; et.x = sx + sw - band * 0.14 - et.w / 2; et.y = fy + 60 + et.w / 2 - et.h / 2; }
        L.push(et);
        L = L.concat(stamp(ph, 40));
        if (cap.length) { cap[0].y = (landscape ? sy + sh : fy + fh) + 40; if (!landscape) { cap[0].y = fy + fh + band + 24; } }
        if (!landscape && cap.length) {
          /* Caption sits on a label strip across the film, so it never lands on the sprockets. */
          var lbl = env.rect({ id: 'label', name: 'Caption label', x: 0, y: 0, w: Math.min(W - 120, cap[0].w + 80), h: cap[0].h + 30, fill: bg, rotation: -2 });
          lbl.x = (W - lbl.w) / 2; lbl.y = Math.min(H - bottom - lbl.h, fy + fh + 40);
          cap[0].y = lbl.y + 15; cap[0].rotation = -2;
          L.push(lbl);
        }
        L = L.concat(cap);
      } else if (env.style === 'instant') {
        var bd = v.backdrop || '#E4D8C6';
        page = env.page(bd);
        var iw = Math.round(W * (env.square ? 0.66 : env.tall ? 0.82 : 0.78));
        var pad = Math.round(iw * 0.06), pw = iw - 2 * pad, foot = Math.round(iw * 0.24);
        var ih = pad + pw + foot;
        var ix = (W - iw) / 2, iy = Math.round(top + (H - top - bottom - ih) / 2);
        L.push(env.rect({ id: 'print', name: 'Instant print', x: ix, y: iy, w: iw, h: ih, fill: '#FFFDF8', rotation: 2, shadow: { color: 'rgba(40,28,10,.25)', blur: 44, x: 0, y: 18 } }));
        var ph2 = env.photo({ id: 'photo', name: 'Photo', src: photos[0], x: ix + pad, y: iy + pad, w: pw, h: pw, rotation: 2, adjust: LOOKS.instant, label: 'Add a photo' });
        L.push(ph2);
        L = L.concat(stamp(ph2, 34));
        var c2 = caption(ix + pad, 0, pw, '#2B2620', 80);
        if (c2.length) { c2[0].rotation = 2; c2[0].y = Math.round(iy + pad + pw + (foot - c2[0].h) / 2); }
        L = L.concat(c2);
      } else if (env.style === 'disposable') {
        var dk = v.backdrop || '#1A1918';
        page = env.page(dk);
        var bw = 22;
        var c3 = caption(80, 0, W - 160, C.readable(dk, ['#F4EFE6']), 70);
        var c3h = c3.length ? c3[0].h + 36 : 0;
        var dw = W - 2 * (env.tall ? 70 : 90), dh = Math.min(Math.round(dw * (env.square ? 0.72 : 1.32)), H - top - bottom - c3h - 2 * bw);
        var dx = (W - dw) / 2, dy = Math.round(top + (H - top - bottom - dh - c3h) / 2);
        L.push(env.rect({ id: 'print', name: 'Print border', x: dx - bw, y: dy - bw, w: dw + 2 * bw, h: dh + 2 * bw, fill: '#F7F4EE' }));
        var ph3 = env.photo({ id: 'photo', name: 'Photo', src: photos[0], x: dx, y: dy, w: dw, h: dh, adjust: LOOKS.flash, label: 'Add a photo' });
        L.push(ph3);
        L = L.concat(stamp(ph3, 48));
        if (c3.length) { c3[0].y = dy + dh + bw + 30; }
        L = L.concat(c3);
      } else {
        var bs = v.backdrop || '#E9E4DA';
        page = env.page(bs);
        var n = Math.max(3, Math.min(4, photos.length || 3));
        if (env.square) n = 3;
        var vertical = !env.square;
        var strip = '#161412', gap = 18, band2 = 58;
        var c4 = caption(80, 0, W - 160, C.readable(bs, ['#1F1B16']), 64);
        var c4h = c4.length ? c4[0].h + 36 : 0;
        var frames = [], fwv, fhv, stx, sty, stw, sth;
        if (vertical) {
          sth = H - top - bottom - c4h;
          fhv = Math.floor((sth - 2 * 30 - gap * (n - 1)) / n);
          fwv = Math.min(Math.round(fhv * 1.42), W - 2 * band2 - 160);
          fhv = Math.min(fhv, Math.round(fwv / 1.42));
          sth = fhv * n + gap * (n - 1) + 60;
          stw = fwv + 2 * band2; stx = (W - stw) / 2; sty = Math.round(top + (H - top - bottom - sth - c4h) / 2);
          for (var i = 0; i < n; i++) frames.push({ x: stx + band2, y: sty + 30 + i * (fhv + gap), w: fwv, h: fhv });
        } else {
          stw = W; fwv = Math.floor((W - 60 - gap * (n - 1)) / n); fhv = Math.round(fwv * 1.3);
          sth = fhv + 2 * band2; stx = 0; sty = Math.round(top + (H - top - bottom - sth - c4h) / 2);
          for (var j = 0; j < n; j++) frames.push({ x: 30 + j * (fwv + gap), y: sty + band2, w: fwv, h: fhv });
        }
        L.push(env.rect({ id: 'film', name: 'Film strip', x: stx, y: sty, w: stw, h: sth, fill: strip }));
        if (vertical) {
          L.push(holes(env, stx + band2 * 0.28, sty, band2 * 0.4, sth, false, bs, 40));
          L.push(holes(env, stx + stw - band2 * 0.68, sty, band2 * 0.4, sth, false, bs, 40));
        } else {
          L.push(holes(env, stx, sty + band2 * 0.28, stw, band2 * 0.4, true, bs, 40));
          L.push(holes(env, stx, sty + sth - band2 * 0.68, stw, band2 * 0.4, true, bs, 40));
        }
        frames.forEach(function (f, k) {
          L.push(env.photo({ id: 'photo-' + (k + 1), name: 'Photo ' + (k + 1), src: photos[k], x: f.x, y: f.y, w: f.w, h: f.h, adjust: LOOKS.strip, label: 'Photo ' + (k + 1), slot: 'frame' + (k + 1) }));
        });
        if (v.stamp !== false) L = L.concat(stamp(frames[n - 1], 30));
        if (c4.length) c4[0].y = sty + sth + 32;
        L = L.concat(c4);
      }
      page.layers = L;
      return { name: 'Film — ' + (v.caption || stampText), pages: [page] };
    }
  });
})();
