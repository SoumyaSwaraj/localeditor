/* LocalEditor curve spline: monotone cubic (Fritsch–Carlson) through control points in 0–1.
 * One definition for the curve editor's drawing and the renderer's lookup table (docs/EXPERT-UI.md "Curves").
 * No dependencies. Lives with the renderer (it was assets/js/expert/spline.js): LE.fx loads it before anything draws, and the
 * workspace loads the same file for the curve editor. Change the maths here and both follow; tests/fx.test.js pins them together. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.curves && LE.curves.version) return;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  /* Points as [[x, y], ...] or [{x, y}, ...]; sorted, clamped to 0–1, duplicate x merged (last wins). */
  function clean(points) {
    var pts = (points || []).map(function (p) { return Array.isArray(p) ? [clamp01(+p[0] || 0), clamp01(+p[1] || 0)] : [clamp01(+p.x || 0), clamp01(+p.y || 0)]; });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    pts.forEach(function (p) { if (out.length && Math.abs(out[out.length - 1][0] - p[0]) < 1e-6) out[out.length - 1] = p; else out.push(p); });
    if (!out.length) out = [[0, 0], [1, 1]];
    if (out.length === 1) out = [[0, out[0][1]], [1, out[0][1]]];
    return out;
  }
  /* Returns f(x) for x in 0–1. Flat outside the first and last points; monotone between (no overshoot). */
  function monotone(points) {
    var p = clean(points);
    var n = p.length;
    var xs = p.map(function (q) { return q[0]; }), ys = p.map(function (q) { return q[1]; });
    var d = [], m = [];
    for (var i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1e-9));
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (var k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (var j = 0; j < n - 1; j++) {
      if (d[j] === 0) { m[j] = 0; m[j + 1] = 0; continue; }
      var a = m[j] / d[j], b = m[j + 1] / d[j];
      var s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[j] = t * a * d[j]; m[j + 1] = t * b * d[j]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
      var hgt = xs[hi] - xs[lo], t = (x - xs[lo]) / hgt, t2 = t * t, t3 = t2 * t;
      var v = (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * hgt * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * hgt * m[hi];
      return clamp01(v);
    };
  }
  /* n samples at x = i / (n - 1). */
  function sample(points, n) {
    n = n || 256;
    var f = monotone(points), out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = f(i / (n - 1));
    return out;
  }
  /* 8-bit lookup table (Uint8Array of n entries, 0–255). */
  function lut(points, n) {
    var s = sample(points, n || 256), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = Math.round(s[i] * 255);
    return out;
  }
  function isIdentity(points) {
    var p = clean(points);
    return p.every(function (q) { return Math.abs(q[0] - q[1]) < 1e-4; });
  }
  /* Curve presets (master channel). Names are descriptive, not any product's. */
  var PRESETS = {
    linear: { name: 'Linear', master: [[0, 0], [1, 1]] },
    medium: { name: 'Medium contrast', master: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]] },
    strong: { name: 'Strong contrast', master: [[0, 0], [0.25, 0.17], [0.75, 0.85], [1, 1]] },
    matte: { name: 'Matte', master: [[0, 0.1], [0.28, 0.27], [0.75, 0.78], [1, 0.95]] },
    cross: { name: 'Cross process', master: [[0, 0], [1, 1]], r: [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]], g: [[0, 0], [0.3, 0.24], [0.72, 0.8], [1, 1]], b: [[0, 0.12], [0.5, 0.5], [1, 0.86]] }
  };
  LE.curves = { version: 1, clean: clean, monotone: monotone, sample: sample, lut: lut, isIdentity: isIdentity, PRESETS: PRESETS };
  if (LE.expert) LE.expert.spline = LE.curves;
})(window);
