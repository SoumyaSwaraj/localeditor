/* LocalEditor effect renderer, image statistics: the numbers an agent grades by. CPU only, on a reduced copy.
   LE.fx.analyze(target, { region }) loads this file on first use. See docs/FX-AUTHORING.md. */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || FX._stats) return;
  var M = FX.math;

  function r4(v) { return Math.round(v * 10000) / 10000; }
  function hex(r, g, b) { function h(v) { v = Math.round(Math.max(0, Math.min(255, v))).toString(16); return v.length < 2 ? '0' + v : v; } return '#' + h(r) + h(g) + h(b); }
  function reduce(src, region, max) {
    var W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    var rx = 0, ry = 0, rw = W, rh = H;
    if (region && typeof region === 'object') {
      rx = Math.round(M.clamp(Number(region.x) || 0, 0, 1) * W); ry = Math.round(M.clamp(Number(region.y) || 0, 0, 1) * H);
      rw = Math.max(1, Math.min(W - rx, Math.round(M.clamp(region.w == null ? 1 : Number(region.w) || 0, 0, 1) * W)));
      rh = Math.max(1, Math.min(H - ry, Math.round(M.clamp(region.h == null ? 1 : Number(region.h) || 0, 0, 1) * H)));
    }
    var k = Math.min(1, max / Math.max(rw, rh));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rw * k)); c.height = Math.max(1, Math.round(rh * k));
    var x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, rx, ry, rw, rh, 0, 0, c.width, c.height);
    return { canvas: c, ctx: x, width: rw, height: rh };
  }
  function percentiles(hist, total) {
    var want = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99], names = ['p1', 'p5', 'p25', 'p50', 'p75', 'p95', 'p99'], out = {}, acc = 0, wi = 0;
    for (var i = 0; i < 256 && wi < want.length; i++) {
      acc += hist[i];
      while (wi < want.length && acc >= want[wi] * total) { out[names[wi]] = r4(i / 255); wi++; }
    }
    while (wi < want.length) { out[names[wi]] = 1; wi++; }
    return out;
  }
  /* The temperature and tint (white-balance effect units) that make a linear colour neutral. */
  function suggestWB(lin) {
    if (!M.wbMatrix) return null;
    function err(t, n) {
      var m = M.wbMatrix(t, n), r = m[0] * lin[0] + m[1] * lin[1] + m[2] * lin[2], g = m[3] * lin[0] + m[4] * lin[1] + m[5] * lin[2], b = m[6] * lin[0] + m[7] * lin[1] + m[8] * lin[2];
      var mean = (r + g + b) / 3 || 1e-6;
      return Math.abs(r - mean) + Math.abs(g - mean) + Math.abs(b - mean);
    }
    var bt = 0, bn = 0, be = err(0, 0), step, t, n, e;
    for (step = 16; step >= 1; step /= 2) {
      var improved = true;
      while (improved) {
        improved = false;
        [[step, 0], [-step, 0], [0, step], [0, -step]].forEach(function (d) {
          t = M.clamp(bt + d[0], -100, 100); n = M.clamp(bn + d[1], -100, 100); e = err(t, n);
          if (e < be - 1e-9) { be = e; bt = t; bn = n; improved = true; }
        });
      }
    }
    return { temperature: bt, tint: bn };
  }

  /* Synchronous statistics of a canvas or image. */
  FX._stats = function (src, opts) {
    opts = opts || {};
    var red = reduce(src, opts.region, 512), w = red.canvas.width, h = red.canvas.height;
    var d = red.ctx.getImageData(0, 0, w, h).data, n = w * h;
    var hr = new Float64Array(256), hg = new Float64Array(256), hb = new Float64Array(256), hl = new Float64Array(256), hs = new Float64Array(256);
    var count = 0, sr = 0, sg = 0, sb = 0, sl = 0, ssat = 0, sx = 0, sy = 0, cb = 0, cr = 0;
    var lo = { r: 0, g: 0, b: 0, any: 0, all: 0 }, hi = { r: 0, g: 0, b: 0, any: 0, all: 0 };
    var nl = [0, 0, 0], nc = 0, gl = [0, 0, 0], rg = 0, yb = 0, rg2 = 0, yb2 = 0, i, alpha = 0;
    for (i = 0; i < d.length; i += 4) {
      var a = d[i + 3];
      alpha += a;
      if (a < 128) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var l = 0.2126 * r + 0.7152 * g + 0.0722 * b, li = Math.round(l);
      hr[r]++; hg[g]++; hb[b]++; hl[li]++;
      count++; sr += r; sg += g; sb += b; sl += l;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
      hs[Math.round(sat * 255)]++; ssat += sat;
      if (r <= 2) lo.r++; if (g <= 2) lo.g++; if (b <= 2) lo.b++;
      if (r <= 2 || g <= 2 || b <= 2) lo.any++; if (mx <= 2) lo.all++;
      if (r >= 253) hi.r++; if (g >= 253) hi.g++; if (b >= 253) hi.b++;
      if (mx >= 253) hi.any++; if (mn >= 253) hi.all++;
      /* Circular mean of hue, weighted by chroma. */
      var ch = mx - mn;
      if (ch > 0) {
        var hue = mx === r ? ((g - b) / ch) % 6 : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4;
        hue *= Math.PI / 3;
        sx += Math.cos(hue) * ch; sy += Math.sin(hue) * ch;
      }
      cb += -0.168736 * r - 0.331264 * g + 0.5 * b; cr += 0.5 * r - 0.418688 * g - 0.081312 * b;
      var lr = M.srgbToLinear(r / 255), lg = M.srgbToLinear(g / 255), lb = M.srgbToLinear(b / 255);
      gl[0] += lr; gl[1] += lg; gl[2] += lb;
      if (ch < 28 && l > 50 && l < 232) { nl[0] += lr; nl[1] += lg; nl[2] += lb; nc++; }
      var o1 = r - g, o2 = 0.5 * (r + g) - b;
      rg += o1; yb += o2; rg2 += o1 * o1; yb2 += o2 * o2;
    }
    var c = Math.max(1, count);
    function frac(o) { var out = {}; Object.keys(o).forEach(function (k) { out[k] = r4(o[k] / c); }); return out; }
    function norm(hh) { var out = new Array(256); for (var k = 0; k < 256; k++) out[k] = Math.round(hh[k] / c * 1e5) / 1e5; return out; }
    var useNeutral = nc >= c * 0.005, base = useNeutral ? nl.map(function (v) { return v / nc; }) : gl.map(function (v) { return v / c; });
    var gref = base[1] || 1e-6;
    var sdRg = Math.sqrt(Math.max(0, rg2 / c - Math.pow(rg / c, 2))), sdYb = Math.sqrt(Math.max(0, yb2 / c - Math.pow(yb / c, 2)));
    var angle = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360, strength = Math.sqrt(sx * sx + sy * sy) / Math.max(1e-6, ssat * 255);
    var vAngle = (Math.atan2(cr / c, cb / c) * 180 / Math.PI + 360) % 360, vMag = Math.sqrt(cb * cb + cr * cr) / c / 255;
    var off = ((vAngle - 123 + 540) % 360) - 180;

    /* Sharpness: variance of the Laplacian of luminance, on a copy up to 1024 px so fine detail still counts.
       Skipped when the caller asks for specific kinds that do not include it (the scopes ask for the histogram many times a second). */
    var lapVar = null, bw = 0, bh = 0;
    if (!Array.isArray(opts.kinds) || opts.kinds.indexOf('sharpness') >= 0) {
      var big = reduce(src, opts.region, 1024), bd, lum, j, s1 = 0, s2 = 0, sn = 0, x, y;
      bw = big.canvas.width; bh = big.canvas.height; bd = big.ctx.getImageData(0, 0, bw, bh).data; lum = new Float32Array(bw * bh);
      for (i = 0, j = 0; i < bd.length; i += 4, j++) lum[j] = 0.2126 * bd[i] + 0.7152 * bd[i + 1] + 0.0722 * bd[i + 2];
      for (y = 1; y < bh - 1; y++) for (x = 1; x < bw - 1; x++) {
        j = y * bw + x;
        var lap = 4 * lum[j] - lum[j - 1] - lum[j + 1] - lum[j - bw] - lum[j + bw];
        s1 += lap; s2 += lap * lap; sn++;
      }
      lapVar = sn ? s2 / sn - Math.pow(s1 / sn, 2) : 0;
    }

    return {
      width: red.width, height: red.height, sample: { width: w, height: h, pixels: count },
      histogram: (function (L) { return { bins: 256, r: norm(hr), g: norm(hg), b: norm(hb), luma: L, l: L }; })(norm(hl)),
      percentiles: { r: percentiles(hr, c), g: percentiles(hg, c), b: percentiles(hb, c), luma: percentiles(hl, c) },
      clipping: { shadows: frac(lo), highlights: frac(hi) },
      mean: { r: r4(sr / c / 255), g: r4(sg / c / 255), b: r4(sb / c / 255), luma: r4(sl / c / 255), color: hex(sr / c, sg / c, sb / c) },
      median: { luma: percentiles(hl, c).p50 },
      whiteBalance: {
        method: useNeutral ? 'near-neutral' : 'grey-world', confidence: r4(useNeutral ? Math.min(1, nc / (c * 0.05)) : 0.2),
        neutral: base.map(function (v) { return r4(M.linearToSrgb(v)); }), cast: { rg: r4(base[0] / gref), bg: r4(base[2] / gref) },
        suggest: suggestWB(base)
      },
      saturation: { mean: r4(ssat / c), p50: percentiles(hs, c).p50, p95: percentiles(hs, c).p95, colorfulness: r4((Math.sqrt(sdRg * sdRg + sdYb * sdYb) + 0.3 * Math.sqrt(Math.pow(rg / c, 2) + Math.pow(yb / c, 2))) / 255) },
      sharpness: lapVar == null ? null : { laplacianVariance: Math.round(lapVar * 100) / 100, sample: { width: bw, height: bh } },
      hue: { mean: r4(angle), strength: r4(Math.min(1, strength)), vectorscope: { angle: r4(vAngle), magnitude: r4(vMag), skinLine: 123, offsetFromSkinLine: r4(off) } },
      alpha: { coverage: r4(alpha / 255 / Math.max(1, n)) }
    };
  };

  /* target: a canvas or image, ImageData, a LE.Scene (the whole page), or { scene, layer: id } (one layer). */
  FX._analyze = function (target, opts) {
    opts = opts || {};
    function done(c) { if (!c) throw new Error('Nothing to analyse.'); return FX._stats(c, opts); }
    try {
      if (target && target.data && target.width && typeof ImageData !== 'undefined' && target instanceof ImageData) {
        var ic = document.createElement('canvas'); ic.width = target.width; ic.height = target.height; ic.getContext('2d').putImageData(target, 0, 0);
        return Promise.resolve(done(ic));
      }
      var scene = target && typeof target.render === 'function' ? target : target && target.scene && typeof target.scene.render === 'function' ? target.scene : null;
      if (scene) {
        var doc = scene.toJSON(), layerId = target === scene ? opts.layer : target.layer;
        if (layerId) {
          var l = scene.layer(layerId);
          if (!l) return Promise.reject(new Error('No layer with the id "' + String(layerId).slice(0, 48) + '".'));
          return scene.exportLayer(layerId, Math.min(2, 1024 / Math.max(l.w, l.h))).then(done);
        }
        return scene.render(Math.min(2, 1024 / Math.max(doc.width, doc.height))).then(done);
      }
      return Promise.resolve(done(target));
    } catch (e) { return Promise.reject(e); }
  };
})(window);
