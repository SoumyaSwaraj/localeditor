/* LocalEditor Expert scopes: histogram (per channel + luminance, clipping), waveform, vectorscope with a skin-tone line.
 * Computed from the rendered preview at reduced size in an idle callback, so they never stall a drag.
 *
 *   var s = LE.expert.scopes.create(host, { mode: 'histogram' | 'waveform' | 'vectorscope' })
 *   LE.expert.scopes.source = () => canvas      // the picture to measure (the workspace sets it)
 *   LE.expert.scopes.request()                  // something changed; recompute when idle
 *   LE.expert.scopes.data                       // last result: { hist: { r, g, b, l }, clip: { low, high }, w, h, ms }
 * When LE.fx.analyze exists it is asked first (analyze({ source: canvas, kinds: ['histogram'] })); its histogram is used if it returns one. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var h = X.h, esc = X.esc;
  var MAXW = 240;
  var S = X.scopes = X.scopes || {};
  var views = [], pending = 0, lastRun = 0, timer = 0;
  S.data = null;
  S.skinAngle = 123;   /* degrees from +Cb toward +Cr: the usual skin-tone (I) line */

  function analyze(src) {
    var t0 = performance.now();
    var w = Math.min(MAXW, src.width), hh = Math.max(1, Math.round(src.height * w / src.width));
    var c = S._c || (S._c = document.createElement('canvas'));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    var cx = c.getContext('2d', { willReadFrequently: true });
    cx.clearRect(0, 0, w, hh);
    cx.drawImage(src, 0, 0, w, hh);
    var d = cx.getImageData(0, 0, w, hh).data;
    var r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    var WB = 128, WR = 96, wave = new Uint32Array(WB * WR), VS = 128, vec = new Uint32Array(VS * VS);
    var low = 0, high = 0, n = 0, clipMask = new Uint8Array(w * hh);
    for (var y = 0; y < hh; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (d[i + 3] < 8) continue;
        var R = d[i], G = d[i + 1], B = d[i + 2];
        var L = (54 * R + 183 * G + 19 * B) >> 8;
        r[R]++; g[G]++; b[B]++; l[L]++; n++;
        if (R <= 0 && G <= 0 && B <= 0) { low++; clipMask[y * w + x] = 1; }
        else if (R >= 255 || G >= 255 || B >= 255) { high++; clipMask[y * w + x] = 2; }
        wave[((WR - 1) - ((L * (WR - 1) / 255) | 0)) * WB + ((x * WB / w) | 0)]++;
        var cb = (-0.1687 * R - 0.3313 * G + 0.5 * B) / 255, cr = (0.5 * R - 0.4187 * G - 0.0813 * B) / 255;
        var vx = ((cb + 0.5) * (VS - 1)) | 0, vy = ((0.5 - cr) * (VS - 1)) | 0;
        vec[vy * VS + vx]++;
      }
    }
    return { hist: { r: r, g: g, b: b, l: l }, clip: { low: n ? low / n : 0, high: n ? high / n : 0 }, clipMask: clipMask, wave: wave, wb: WB, wr: WR, vec: vec, vs: VS, n: n, w: w, h: hh, ms: performance.now() - t0 };
  }
  S.analyze = analyze;

  function run() {
    pending = 0;
    lastRun = performance.now();
    var src = S.source && S.source();
    if (!src || !src.width) return;
    var R = X.registry && X.registry();
    var data = analyze(src);
    if (R && X.isReal() && typeof R.analyze === 'function') {
      try {
        var a = R.analyze({ source: src, kinds: ['histogram'] });
        if (a && a.histogram && a.histogram.l) data.hist = a.histogram;
      } catch (e) { /* the renderer's analysis is optional */ }
    }
    S.data = data;
    views.forEach(function (v) { if (v.el.isConnected) v.draw(); });
    X.emit('scopes', data);
    if (S.clipOn) S.paintClip();
  }
  /* Recompute when the browser is idle; while a control is being dragged, at most every 250 ms. */
  S.request = function () {
    if (pending) return;
    var wait = S.interactive ? Math.max(0, 250 - (performance.now() - lastRun)) : 60;
    clearTimeout(timer);
    timer = setTimeout(function () { pending = X.idle(run, 400); }, wait);
  };
  S.now = run;
  X.on('interactive', function (on) { S.interactive = on; if (!on) S.request(); });

  function css(el, name, fb) { var v = getComputedStyle(el).getPropertyValue(name); return v && v.trim() ? v.trim() : fb; }
  function drawHist(cv, data, cx, W, H) {
    var hist = data.hist, max = 1, k;
    ['r', 'g', 'b'].forEach(function (c) { for (k = 2; k < 254; k++) max = Math.max(max, hist[c][k]); });
    max = Math.max(1, max);
    function path(arr, col, fill) {
      cx.beginPath(); cx.moveTo(0, H);
      for (var i = 0; i < 256; i++) cx.lineTo(i / 255 * W, H - Math.min(1, Math.sqrt(arr[i] / max)) * (H - 4));
      cx.lineTo(W, H); cx.closePath();
      if (fill) { cx.fillStyle = col; cx.fill(); } else { cx.strokeStyle = col; cx.lineWidth = 1; cx.stroke(); }
    }
    cx.globalCompositeOperation = 'lighter';
    path(hist.r, 'rgba(229,72,77,.62)', true);
    path(hist.g, 'rgba(48,164,108,.62)', true);
    path(hist.b, 'rgba(62,123,250,.62)', true);
    cx.globalCompositeOperation = 'source-over';
    path(hist.l, 'rgba(255,255,255,.55)', false);
  }
  function drawWave(cv, data, cx, W, H) {
    var img = cx.createImageData(data.wb, data.wr), px = img.data, max = 1, i;
    for (i = 0; i < data.wave.length; i++) max = Math.max(max, data.wave[i]);
    var lm = Math.log(1 + max);
    for (i = 0; i < data.wave.length; i++) {
      var v = data.wave[i] ? Math.log(1 + data.wave[i]) / lm : 0;
      px[i * 4] = 150 + v * 90; px[i * 4 + 1] = 220; px[i * 4 + 2] = 160 + v * 60; px[i * 4 + 3] = Math.round(Math.min(1, v * 1.4) * 255);
    }
    var t = S._t || (S._t = document.createElement('canvas'));
    t.width = data.wb; t.height = data.wr; t.getContext('2d').putImageData(img, 0, 0);
    cx.imageSmoothingEnabled = true; cx.drawImage(t, 0, 0, W, H);
    cx.strokeStyle = 'rgba(255,255,255,.12)'; cx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(function (f) { cx.beginPath(); cx.moveTo(0, Math.round(H * f) + 0.5); cx.lineTo(W, Math.round(H * f) + 0.5); cx.stroke(); });
  }
  function drawVec(cv, data, cx, W, H) {
    var S2 = Math.min(W, H), ox = (W - S2) / 2, oy = (H - S2) / 2, r = S2 / 2 - 4, c0x = W / 2, c0y = H / 2;
    var img = cx.createImageData(data.vs, data.vs), px = img.data, max = 1, i;
    for (i = 0; i < data.vec.length; i++) max = Math.max(max, data.vec[i]);
    var lm = Math.log(1 + max);
    for (i = 0; i < data.vec.length; i++) {
      var v = data.vec[i] ? Math.log(1 + data.vec[i]) / lm : 0;
      px[i * 4] = 230; px[i * 4 + 1] = 230; px[i * 4 + 2] = 230; px[i * 4 + 3] = Math.round(Math.min(1, v * 1.5) * 255);
    }
    cx.strokeStyle = 'rgba(255,255,255,.16)'; cx.lineWidth = 1;
    cx.beginPath(); cx.arc(c0x, c0y, r, 0, Math.PI * 2); cx.stroke();
    cx.beginPath(); cx.arc(c0x, c0y, r * 0.5, 0, Math.PI * 2); cx.stroke();
    cx.beginPath(); cx.moveTo(c0x - r, c0y); cx.lineTo(c0x + r, c0y); cx.moveTo(c0x, c0y - r); cx.lineTo(c0x, c0y + r); cx.stroke();
    /* 75% colour targets */
    [['R', 1, 0, 0, '#E5484D'], ['Y', 1, 1, 0, '#E2B15A'], ['G', 0, 1, 0, '#30A46C'], ['C', 0, 1, 1, '#3DB9CF'], ['B', 0, 0, 1, '#3E7BFA'], ['M', 1, 0, 1, '#C850C0']].forEach(function (t) {
      var R0 = t[1] * 0.75, G0 = t[2] * 0.75, B0 = t[3] * 0.75;
      var cb = -0.1687 * R0 - 0.3313 * G0 + 0.5 * B0, cr = 0.5 * R0 - 0.4187 * G0 - 0.0813 * B0;
      var x = c0x + cb * 2 * r, y = c0y - cr * 2 * r;
      cx.strokeStyle = t[4]; cx.strokeRect(x - 4, y - 4, 8, 8);
      cx.fillStyle = 'rgba(255,255,255,.55)'; cx.font = '600 9px "Plus Jakarta Sans", sans-serif'; cx.fillText(t[0], x + 6, y + 3);
    });
    /* Skin-tone line */
    var a = S.skinAngle * Math.PI / 180;
    cx.strokeStyle = 'rgba(242,213,148,.85)'; cx.setLineDash([4, 3]);
    cx.beginPath(); cx.moveTo(c0x, c0y); cx.lineTo(c0x + Math.cos(a) * r, c0y - Math.sin(a) * r); cx.stroke(); cx.setLineDash([]);
    var t2 = S._v || (S._v = document.createElement('canvas'));
    t2.width = data.vs; t2.height = data.vs; t2.getContext('2d').putImageData(img, 0, 0);
    cx.drawImage(t2, ox + 4, oy + 4, S2 - 8, S2 - 8);
  }

  /* A scope view: mode switch, the plot, clipping indicators (histogram). */
  S.create = function (host, opts) {
    opts = opts || {};
    var mode = opts.mode || X.lsGet('le-expert-scope', 'histogram');
    var el = h('<div class="xp-scope" data-mode="' + mode + '"><div class="xp-scope-plot"><canvas aria-hidden="true"></canvas>' +
      '<button type="button" class="xp-clip is-low" aria-pressed="false" aria-label="Show shadow clipping on the photo" title="Shadow clipping"></button>' +
      '<button type="button" class="xp-clip is-high" aria-pressed="false" aria-label="Show highlight clipping on the photo" title="Highlight clipping"></button>' +
      '<p class="xp-scope-empty">Open a photo to see its histogram.</p></div>' +
      '<div class="xp-scope-bar"><div class="xp-seg xp-seg-xs" role="radiogroup" aria-label="Scope"></div><span class="xp-scope-info" aria-live="off"></span></div></div>');
    var cv = el.querySelector('canvas'), seg = el.querySelector('.xp-seg'), info = el.querySelector('.xp-scope-info');
    var lo = el.querySelector('.is-low'), hi = el.querySelector('.is-high');
    [['histogram', 'Histogram'], ['waveform', 'Waveform'], ['vectorscope', 'Vectorscope']].forEach(function (m) {
      var b = h('<button type="button" role="radio" aria-checked="false" data-m="' + m[0] + '">' + esc(m[1]) + '</button>');
      b.addEventListener('click', function () { set(m[0]); });
      seg.appendChild(b);
    });
    function set(m) {
      mode = m; X.lsSet('le-expert-scope', m); el.setAttribute('data-mode', m);
      [].forEach.call(seg.children, function (b) { var on = b.getAttribute('data-m') === m; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      draw();
    }
    seg.addEventListener('keydown', function (e) {
      var bs = [].slice.call(seg.children), i = bs.indexOf(document.activeElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault(); e.stopPropagation();
      var n = (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length; bs[n].focus(); bs[n].click();
    });
    [lo, hi].forEach(function (b) {
      b.addEventListener('click', function () {
        var on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        S.clipShow = { low: lo.getAttribute('aria-pressed') === 'true', high: hi.getAttribute('aria-pressed') === 'true' };
        S.clipOn = S.clipShow.low || S.clipShow.high;
        S.paintClip();
      });
    });
    function draw() {
      var data = S.data;
      var dpr = global.devicePixelRatio || 1, W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      var cx = cv.getContext('2d');
      cx.clearRect(0, 0, W, H);
      el.classList.toggle('is-empty', !data);
      if (!data) return;
      if (mode === 'waveform') drawWave(cv, data, cx, W, H);
      else if (mode === 'vectorscope') drawVec(cv, data, cx, W, H);
      else drawHist(cv, data, cx, W, H);
      lo.classList.toggle('is-lit', data.clip.low > 0.001);
      hi.classList.toggle('is-lit', data.clip.high > 0.001);
      lo.title = 'Shadow clipping: ' + (data.clip.low * 100).toFixed(1) + '%';
      hi.title = 'Highlight clipping: ' + (data.clip.high * 100).toFixed(1) + '%';
      info.textContent = mode === 'histogram' ? (data.clip.low > 0.001 || data.clip.high > 0.001 ? 'Clipped ' + (data.clip.low * 100).toFixed(1) + '% · ' + (data.clip.high * 100).toFixed(1) + '%' : 'No clipping') : mode === 'vectorscope' ? 'Skin line ' + S.skinAngle + '°' : 'Luminance';
    }
    var view = { el: el, draw: draw, set: set };
    views.push(view);
    if (global.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(cv);
    set(mode);
    if (host) host.appendChild(el);
    return view;
  };

  /* Clipping overlay on the photo: blue where shadows clip, red where highlights clip. */
  S.paintClip = function () {
    var host = X.canvas && X.canvas._host && X.canvas._host();
    var page = X.canvas && X.canvas._page && X.canvas._page();
    var ov = S._ov;
    if (!S.clipOn || !host || !page || !S.data) { if (ov) ov.hidden = true; return; }
    if (!ov || !ov.isConnected) { ov = S._ov = document.createElement('canvas'); ov.className = 'xp-clip-ov'; ov.setAttribute('aria-hidden', 'true'); host.appendChild(ov); }
    var d = S.data; ov.hidden = false; ov.width = d.w; ov.height = d.h;
    var cx = ov.getContext('2d'), img = cx.createImageData(d.w, d.h), px = img.data;
    for (var i = 0; i < d.clipMask.length; i++) {
      var m = d.clipMask[i];
      if (m === 1 && S.clipShow.low) { px[i * 4] = 40; px[i * 4 + 1] = 110; px[i * 4 + 2] = 255; px[i * 4 + 3] = 230; }
      else if (m === 2 && S.clipShow.high) { px[i * 4] = 255; px[i * 4 + 1] = 40; px[i * 4 + 2] = 60; px[i * 4 + 3] = 230; }
    }
    cx.putImageData(img, 0, 0);
    var hr = host.getBoundingClientRect();
    ov.style.left = (page.left - hr.left) + 'px'; ov.style.top = (page.top - hr.top) + 'px';
    ov.style.width = page.width + 'px'; ov.style.height = page.height + 'px';
  };
  S.redraw = function () { views.forEach(function (v) { if (v.el.isConnected) v.draw(); }); };
})(window);
