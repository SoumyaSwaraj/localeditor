/* Worker for RAW working copies (Expert step X5). Our own code. Turns a decode (camera-native linear RGB, black removed, sensor white = 1)
 * into the scene-referred picture LE.fx develops: upright, reduced to the working size, highlights reconstructed with the as-shot
 * white balance, converted with the camera's matrices to linear Rec. 709 / sRGB primaries (unbounded), baseline exposure applied.
 *
 * In:  { id, cmd: 'work', data: ArrayBuffer, format: 'f16'|'f32', width, height, meta, opts: { orientation, cap, recovery, matrix, baseline, estimate } }
 *      { id, cmd: 'ca', data: ArrayBuffer (Float32 RGB), width, height }                       -> lateral CA estimate on a small copy
 *      { id, cmd: 'stats', data, width, height }                                               -> luminance percentiles (for auto tone)
 * Out: { id, ok: true, result } (the pixel buffer is transferred) | { id, progress } | { id, ok: false, error }
 */
'use strict';
importScripts('raw-core.js', 'raw-develop.js');
var HALF = null;
function halfLUT() { if (HALF) return HALF; HALF = new Float32Array(65536); for (var i = 0; i < 65536; i++) HALF[i] = LERawCore.halfToFloat(i); return HALF; }
function toF32(buf, format) {
  if (format === 'f32') return new Float32Array(buf);
  if (format === 'u16') { var u = new Uint16Array(buf), o = new Float32Array(u.length); for (var i = 0; i < u.length; i++) o[i] = u[i] / 16384; return o; }
  var h = new Uint16Array(buf), t = halfLUT(), f = new Float32Array(h.length);
  for (var j = 0; j < h.length; j++) { var v = t[h[j]]; f[j] = v === v && isFinite(v) ? v : 0; }
  return f;
}
/* Area-average resampling, separable (exact box integration of the source over each target pixel). RGB interleaved. */
function resample(src, w, h, tw, th) {
  if (tw === w && th === h) return src;
  function axis(n, tn) { // for each target index: list of [srcIndex, weight]
    var out = [], k = n / tn;
    for (var i = 0; i < tn; i++) { var a = i * k, b = a + k, s = Math.floor(a), e = Math.min(n, Math.ceil(b)), lst = []; for (var j = s; j < e; j++) { var wgt = Math.min(b, j + 1) - Math.max(a, j); if (wgt > 1e-9) lst.push(j, wgt / k); } out.push(lst); }
    return out;
  }
  var ax = axis(w, tw), ay = axis(h, th), tmp = new Float32Array(tw * h * 3), out = new Float32Array(tw * th * 3), x, y, q;
  for (y = 0; y < h; y++) { var row = y * w * 3, orow = y * tw * 3; for (x = 0; x < tw; x++) { var l = ax[x], r = 0, g = 0, b = 0; for (q = 0; q < l.length; q += 2) { var o = row + l[q] * 3, wt = l[q + 1]; r += src[o] * wt; g += src[o + 1] * wt; b += src[o + 2] * wt; } tmp[orow + x * 3] = r; tmp[orow + x * 3 + 1] = g; tmp[orow + x * 3 + 2] = b; } }
  for (y = 0; y < th; y++) { var ly = ay[y], oo = y * tw * 3; for (x = 0; x < tw; x++) { var r2 = 0, g2 = 0, b2 = 0; for (q = 0; q < ly.length; q += 2) { var o2 = (ly[q] * tw + x) * 3, w2 = ly[q + 1]; r2 += tmp[o2] * w2; g2 += tmp[o2 + 1] * w2; b2 += tmp[o2 + 2] * w2; } out[oo + x * 3] = r2; out[oo + x * 3 + 1] = g2; out[oo + x * 3 + 2] = b2; } }
  return out;
}
function fitSize(w, h, cap) { if (!cap || Math.max(w, h) <= cap) return [w, h]; var k = cap / Math.max(w, h); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; }
/* Grey-world on near-neutral pixels (after the as-shot balance), in camera space: the camera's response to the scene's average light. */
function autoNeutral(cam, n, gains) {
  var sr = 0, sg = 0, sb = 0, cnt = 0, step = Math.max(1, Math.floor(n / 200000));
  for (var pass = 0; pass < 2; pass++) {
    sr = sg = sb = cnt = 0;
    for (var i = 0; i < n; i += step) {
      var r = cam[i * 3], g = cam[i * 3 + 1], b = cam[i * 3 + 2];
      if (r >= 0.98 || g >= 0.98 || b >= 0.98) continue;
      var R = r * gains[0], G = g * gains[1], B = b * gains[2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mx < 0.02) continue;
      var sat = (mx - mn) / mx; if (sat > (pass ? 0.25 : 0.5)) continue;
      var w = 1 - sat; sr += R * w; sg += G * w; sb += B * w; cnt += w;
    }
    if (cnt > 50) { gains = [gains[0] * sg / sr, gains[1], gains[2] * sg / sb]; }
  }
  return [1 / gains[0], 1 / gains[1], 1 / gains[2]].map(function (v, k, a) { return v / Math.max(a[0], a[1], a[2]); });
}
function lumaStats(rgb, n) {
  var step = Math.max(1, Math.floor(n / 250000)), L = [];
  for (var i = 0; i < n; i += step) { var y = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]; L.push(Math.log2(Math.max(y, 1e-6))); }
  L.sort(function (a, b) { return a - b; });
  function q(p) { return L[Math.min(L.length - 1, Math.floor(p * L.length))]; }
  var s = 0; for (var j = 0; j < L.length; j++) s += L[j];
  return { p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99), p999: q(0.999), meanLog: s / L.length, n: L.length };
}
/* Reconstructed highlights keep the colour of their surroundings near the clip edge and fade to neutral the further the estimate goes
   above the clip level, and the more channels were clipped (colour propagation alone leaves mint or lilac casts in skies and suns). */
function fadeClipped(cam, out, n, gains) {
  var lo = Math.min(gains[0], gains[1], gains[2]);
  for (var i = 0; i < n; i++) {
    var o = i * 3, nc = (cam[o] >= 0.995 ? 1 : 0) + (cam[o + 1] >= 0.995 ? 1 : 0) + (cam[o + 2] >= 0.995 ? 1 : 0);
    if (!nc) continue;
    var r = out[o], g = out[o + 1], b = out[o + 2], mx = Math.max(r, g, b), mean = (r + g + b) / 3;
    var t = Math.min(1, (nc === 1 ? 0.35 : nc === 2 ? 0.7 : 1) * (0.4 + 0.6 * Math.min(1, Math.max(0, (mx / lo - 1) / 0.6))));
    out[o] = r + (mean - r) * t; out[o + 1] = g + (mean - g) * t; out[o + 2] = b + (mean - b) * t;
  }
}
var RECOVERY = { reconstruct: 'ratio', clip: 'clip', off: 'none' };
self.onmessage = function (ev) {
  var m = ev.data, id = m.id;
  try {
    if (m.cmd === 'work') {
      var o = m.opts || {}, meta = m.meta || {}, w = m.width, h = m.height;
      var cam = toF32(m.data, m.format);
      self.postMessage({ id: id, progress: 0.2 });
      if (o.orientation && o.orientation !== 1) { var ori = LERawCore.applyOrientation(cam, w, h, o.orientation); cam = ori.data; w = ori.width; h = ori.height; }
      var result = { width: w, height: h, full: [w, h] };
      if (o.matrix === false) { // camera space, only upright and reduced (HDR frames)
        var sz0 = fitSize(w, h, o.cap), d0 = resample(cam, w, h, sz0[0], sz0[1]);
        result.width = sz0[0]; result.height = sz0[1]; result.data = d0;
        self.postMessage({ id: id, ok: true, result: result }, [d0.buffer]); return;
      }
      var color = meta.color || meta, cm = LERawCore.cameraToSpace(color, 'as-shot', 'srgb');
      result.asShot = [cm.temp, cm.tint]; result.colorFallback = !!cm.fallback;
      if (o.estimate) { // auto white balance from the full data (sampled)
        var nAuto = autoNeutral(cam, w * h, cm.gains);
        try { var ca = LERawCore.cameraToSpace(color, { neutral: nAuto }, 'srgb'); result.auto = [Math.round(ca.temp), Math.round(ca.tint)]; } catch (e) { result.auto = result.asShot; }
      }
      var img = { width: w, height: h, data: cam };
      var rec = LERawDevelop.whiteBalanceAndHighlights(img, cm.gains, RECOVERY[o.recovery] || 'ratio');
      result.clipped = rec.clipped / (w * h);
      if ((o.recovery || 'reconstruct') === 'reconstruct' && rec.clipped) fadeClipped(cam, rec.data, w * h, cm.gains);
      self.postMessage({ id: id, progress: 0.6 });
      var sz = fitSize(w, h, o.cap), data = resample(rec.data, w, h, sz[0], sz[1]);
      var k = Math.pow(2, o.baseline || 0), M = cm.wbMatrix;
      for (var i = 0, n = sz[0] * sz[1]; i < n; i++) {
        var r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
        data[i * 3] = k * (M[0] * r + M[1] * g + M[2] * b); data[i * 3 + 1] = k * (M[3] * r + M[4] * g + M[5] * b); data[i * 3 + 2] = k * (M[6] * r + M[7] * g + M[8] * b);
      }
      result.width = sz[0]; result.height = sz[1]; result.data = data;
      if (o.estimate) result.stats = lumaStats(data, sz[0] * sz[1]);
      self.postMessage({ id: id, ok: true, result: result }, [data.buffer]);
    } else if (m.cmd === 'ca') {
      var src = new Float32Array(m.data), s2 = fitSize(m.width, m.height, 720), small = resample(src, m.width, m.height, s2[0], s2[1]);
      var est = LERawDevelop.estimateCA({ width: s2[0], height: s2[1], data: small }, 0.004, 7);
      self.postMessage({ id: id, ok: true, result: { r: est.kR, b: est.kB } });
    } else if (m.cmd === 'stats') {
      self.postMessage({ id: id, ok: true, result: lumaStats(new Float32Array(m.data), m.width * m.height) });
    }
  } catch (e) { self.postMessage({ id: id, ok: false, error: String(e && e.message || e) }); }
};
