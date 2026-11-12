/* LocalEditor RAW develop reference (CPU, Float32). Our own code, written from public papers and formulae only.
 *
 * This is the reference the GPU shaders of build step X5 must match, and the slow path for devices without WebGL2.
 * It is deliberately small and readable. All images are { width, height, data: Float32Array(w*h*3) } interleaved RGB.
 * Space notes: highlight reconstruction and denoise work in camera RGB (before the colour matrix); tone and looks work in linear working RGB.
 *
 * UMD: window.LERawDevelop / require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LERawDevelop = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function clone(img) { return { width: img.width, height: img.height, data: new Float32Array(img.data) }; }

  /* ---------------------------------------------------------------- white balance + highlight reconstruction (camera RGB in, white-balanced camera RGB out) */
  /* method: 'none' (leave clipped channels as they are: pink or magenta highlights), 'clip' (clip everything to the smallest channel's clip level: white highlights, detail lost),
   *         'ratio' (colour propagation, see below). Input channels are 0..1 raw-normalised (sensor white = 1). `gains` are the white-balance multipliers (neutral -> 1). */
  function whiteBalanceAndHighlights(img, gains, method, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, src = img.data, n = w * h, out = new Float32Array(src.length), i, c;
    var thr = opts.clipThreshold == null ? 0.995 : opts.clipThreshold, minClip = Math.min(gains[0], gains[1], gains[2]);
    var cm = new Uint8Array(n); // bit0..2: channel c clipped
    var anyClip = false;
    for (i = 0; i < n; i++) {
      var f = 0, o = i * 3;
      for (c = 0; c < 3; c++) { if (src[o + c] >= thr) f |= 1 << c; out[o + c] = src[o + c] * gains[c]; }
      cm[i] = f; if (f) anyClip = true;
    }
    if (!anyClip || method === 'none') return { width: w, height: h, data: out, clipped: countBits(cm) };
    if (method === 'clip') {
      for (i = 0; i < n; i++) if (cm[i]) { var o2 = i * 3; for (c = 0; c < 3; c++) if (out[o2 + c] > minClip) out[o2 + c] = minClip; }
      return { width: w, height: h, data: out, clipped: countBits(cm) };
    }
    // ---- 'ratio': colour propagation. A guide chromaticity (c / sum) is built from nearby pixels where no channel is clipped, then used to rebuild
    // the clipped channels of a pixel from its unclipped ones. Pixels with all channels clipped take the guide colour faded toward neutral with the distance from valid pixels.
    var B = opts.block || 8, gw = Math.ceil(w / B), gh = Math.ceil(h / B), num = new Float32Array(gw * gh * 3), den = new Float32Array(gw * gh), x, y;
    var lowCut = 0.02 * minClip; // ignore near-black pixels in the guide (noisy chromaticity)
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (cm[i]) continue; var o3 = i * 3, r = out[o3], g = out[o3 + 1], b = out[o3 + 2], s = r + g + b;
      // a pixel next to clipped ones is more representative; also reject pixels that are themselves dark
      if (s < 3 * lowCut) continue;
      var gi = ((y / B) | 0) * gw + ((x / B) | 0), wgt = 1 + 2 * smooth(0.3, 0.9, Math.min(r, g, b) / minClip);
      num[gi * 3] += wgt * r / s; num[gi * 3 + 1] += wgt * g / s; num[gi * 3 + 2] += wgt * b / s; den[gi] += wgt;
    }
    // fill empty guide cells by iterative dilation (average of valid 8-neighbours); remember the distance in cells for the neutral fade
    var dist = new Float32Array(gw * gh), valid = new Uint8Array(gw * gh), gx, gy, left = 0;
    for (i = 0; i < gw * gh; i++) { if (den[i] > 0) { valid[i] = 1; num[i * 3] /= den[i]; num[i * 3 + 1] /= den[i]; num[i * 3 + 2] /= den[i]; } else left++; }
    var maxIter = Math.max(gw, gh), it = 0;
    while (left > 0 && it < maxIter) {
      it++; var nv = new Uint8Array(valid), nn = new Float32Array(num);
      for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) {
        var gi2 = gy * gw + gx; if (valid[gi2]) continue; var ar = 0, ag = 0, ab = 0, ac = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy = gy + dy, xx = gx + dx; if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue; var q = yy * gw + xx; if (valid[q]) { ar += num[q * 3]; ag += num[q * 3 + 1]; ab += num[q * 3 + 2]; ac++; } }
        if (ac) { nn[gi2 * 3] = ar / ac; nn[gi2 * 3 + 1] = ag / ac; nn[gi2 * 3 + 2] = ab / ac; nv[gi2] = 1; dist[gi2] = it; left--; }
      }
      valid = nv; num = nn;
    }
    if (left > 0) { for (i = 0; i < gw * gh; i++) if (!valid[i]) { num[i * 3] = num[i * 3 + 1] = num[i * 3 + 2] = 1 / 3; dist[i] = 99; } }
    // smooth the guide a little (3x3 box) so cell borders are invisible
    var sm = new Float32Array(num.length);
    for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) { var sr = 0, sg = 0, sb = 0, sc = 0; for (var dy2 = -1; dy2 <= 1; dy2++) for (var dx2 = -1; dx2 <= 1; dx2++) { var y3 = clamp(gy + dy2, 0, gh - 1), x3 = clamp(gx + dx2, 0, gw - 1), q2 = y3 * gw + x3; sr += num[q2 * 3]; sg += num[q2 * 3 + 1]; sb += num[q2 * 3 + 2]; sc++; } var q3 = (gy * gw + gx) * 3; sm[q3] = sr / sc; sm[q3 + 1] = sg / sc; sm[q3 + 2] = sb / sc; }
    function guideAt(px, py) { // bilinear
      var fx = clamp(px / B - 0.5, 0, gw - 1), fy = clamp(py / B - 0.5, 0, gh - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0, res = [0, 0, 0, 0];
      for (var k = 0; k < 3; k++) { var a = sm[(y0 * gw + x0) * 3 + k], b = sm[(y0 * gw + x1) * 3 + k], cc = sm[(y1 * gw + x0) * 3 + k], d = sm[(y1 * gw + x1) * 3 + k]; res[k] = a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty; }
      var dd = dist[y0 * gw + x0] * (1 - tx) * (1 - ty) + dist[y0 * gw + x1] * tx * (1 - ty) + dist[y1 * gw + x0] * (1 - tx) * ty + dist[y1 * gw + x1] * tx * ty; res[3] = dd; return res;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; var f2 = cm[i]; if (!f2) continue; var o4 = i * 3, g2 = guideAt(x, y), v = [out[o4], out[o4 + 1], out[o4 + 2]];
      var clippedLevel = [gains[0], gains[1], gains[2]]; // value of each channel when its raw value saturates
      var nclip = (f2 & 1) + ((f2 >> 1) & 1) + ((f2 >> 2) & 1);
      var refBest = 0; for (c = 0; c < 3; c++) if (!(f2 & (1 << c)) && v[c] > refBest) refBest = v[c];
      if (nclip < 3 && refBest >= 0.3 * minClip) {
        // reference channel: the unclipped channel with the largest value
        var u = -1, best = -1; for (c = 0; c < 3; c++) if (!(f2 & (1 << c)) && v[c] > best) { best = v[c]; u = c; }
        var gu = Math.max(g2[u], 1e-4);
        for (c = 0; c < 3; c++) if (f2 & (1 << c)) { var est = v[u] * g2[c] / gu; v[c] = Math.max(v[c], est); }
      } else {
        // every channel clipped: brightness is at least the clip level; colour from the guide, faded to neutral the further the pixel is from valid data
        var mv = Math.max(v[0], v[1], v[2]), fade = smooth(1, 6, g2[3]), gmax = 1e-4;
        var col = [0, 0, 0]; for (c = 0; c < 3; c++) { col[c] = g2[c] * (1 - fade) + (1 / 3) * fade; if (col[c] > gmax) gmax = col[c]; }
        for (c = 0; c < 3; c++) v[c] = Math.max(v[c], mv * col[c] / gmax);
      }
      out[o4] = v[0]; out[o4 + 1] = v[1]; out[o4 + 2] = v[2];
    }
    return { width: w, height: h, data: out, clipped: countBits(cm) };
  }
  function countBits(a) { var n = 0; for (var i = 0; i < a.length; i++) if (a[i]) n++; return n; }

  /* ---------------------------------------------------------------- tone controls (linear working RGB, in place) */
  /* params: exposure (EV), shadows (-1..1 ->  lift -/+ up to ~2 EV at black), highlights (-1..1; negative compresses), contrast (-1..1), whites, blacks */
  function toneControls(img, p) {
    p = p || {};
    var d = img.data, n = img.width * img.height, ex = Math.pow(2, p.exposure || 0), sh = p.shadows || 0, hi = p.highlights || 0, i;
    for (i = 0; i < n; i++) {
      var o = i * 3, r = d[o] * ex, g = d[o + 1] * ex, b = d[o + 2] * ex, Y = luma(r, g, b), gain = 1;
      if (sh) gain *= 1 + 3 * sh * Math.pow(1 - smooth(0, 0.25, Y), 2);
      if (hi < 0) gain *= 1 + 0.6 * hi * smooth(0.6, 2.5, Y); else if (hi > 0) gain *= 1 + 0.5 * hi * smooth(0.15, 0.6, Y) * (1 - smooth(0.6, 1.5, Y));
      d[o] = r * gain; d[o + 1] = g * gain; d[o + 2] = b * gain;
    }
    return img;
  }
  /* base tone curve: scene-linear -> display-referred linear (0..1), applied to luminance with colour ratios kept, plus a gentle per-channel part so saturated colours roll off */
  function baseCurve(x, shoulder) { // soft shoulder: identity up to x0, then an exponential approach to 1
    var x0 = shoulder == null ? 0.55 : shoulder; if (x <= x0) return x < 0 ? 0 : x; return x0 + (1 - x0) * (1 - Math.exp(-(x - x0) / (1 - x0)));
  }
  var LOOKS = {
    neutral: { name: 'Neutral', contrast: 0, sat: 1.0, shoulder: 0.6, mono: false },
    standard: { name: 'Standard', contrast: 0.18, sat: 1.08, shoulder: 0.55, mono: false },
    vivid: { name: 'Vivid', contrast: 0.30, sat: 1.35, shoulder: 0.5, mono: false },
    portrait: { name: 'Portrait', contrast: 0.08, sat: 0.96, shoulder: 0.6, mono: false, skin: 0.85 },
    landscape: { name: 'Landscape', contrast: 0.26, sat: 1.22, shoulder: 0.5, mono: false, cool: 1.12 },
    monochrome: { name: 'Monochrome', contrast: 0.28, sat: 0, shoulder: 0.55, mono: true }
  };
  /* returns display-referred LINEAR 0..1 in place; apply the sRGB encode afterwards (toSRGB8). */
  function applyLook(img, lookId, extra) {
    var look = LOOKS[lookId] || LOOKS.neutral, d = img.data, n = img.width * img.height, i, c = (extra && extra.contrast != null ? extra.contrast : 0) + look.contrast, sat = look.sat * (extra && extra.saturation != null ? extra.saturation : 1);
    for (i = 0; i < n; i++) {
      var o = i * 3, r = d[o], g = d[o + 1], b = d[o + 2], Y = Math.max(1e-6, luma(r, g, b));
      if (look.mono) { r = g = b = Y; } else if (sat !== 1) { r = Y + (r - Y) * sat; g = Y + (g - Y) * sat; b = Y + (b - Y) * sat; }
      if (look.skin && r > g && g > b) { var h = (g - b) / Math.max(1e-6, r - b); if (h > 0.15 && h < 0.8) { var k = look.skin + (1 - look.skin) * Math.abs(h - 0.45) / 0.35; r = Y + (r - Y) * k; g = Y + (g - Y) * k; b = Y + (b - Y) * k; } }
      if (look.cool) { b *= look.cool; }
      var Y2 = Math.max(1e-6, luma(r, g, b)), Yt = baseCurve(Y2, look.shoulder);
      // contrast: an S curve around mid grey in display space (0.18 linear ~ 0.46 encoded)
      if (c) { var e = encodeSRGBf(Yt), s2 = e + c * (e - 0.5) * (1 - Math.abs(2 * e - 1)) * 1.0 * 2 * 0.5; s2 = clamp(s2, 0, 1); Yt = decodeSRGBf(s2); }
      var k2 = Yt / Y2; r *= k2; g *= k2; b *= k2;
      // keep the result inside the gamut: pull towards the luminance as needed
      var mx = Math.max(r, g, b); if (mx > 1) { var t = (mx - 1) / (mx - Yt); t = clamp(t, 0, 1); r += (Yt - r) * t; g += (Yt - g) * t; b += (Yt - b) * t; }
      d[o] = clamp(r, 0, 1); d[o + 1] = clamp(g, 0, 1); d[o + 2] = clamp(b, 0, 1);
    }
    return img;
  }
  function encodeSRGBf(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function decodeSRGBf(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function toSRGB8(img) {
    var d = img.data, n = img.width * img.height, out = new Uint8ClampedArray(n * 4), lut = toSRGB8.lut, i;
    if (!lut) { lut = toSRGB8.lut = new Uint8Array(4097); for (i = 0; i <= 4096; i++) lut[i] = Math.round(255 * encodeSRGBf(i / 4096)); }
    for (i = 0; i < n; i++) { for (var c = 0; c < 3; c++) { var v = d[i * 3 + c]; out[i * 4 + c] = lut[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096 + 0.5) | 0]; } out[i * 4 + 3] = 255; }
    return out;
  }

  /* ---------------------------------------------------------------- blur / sharpen */
  function gaussKernel(sigma) { var r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1), s = 0, i; for (i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; } for (i = 0; i < k.length; i++) k[i] /= s; return k; }
  function blurPlane(src, w, h, sigma) {
    var k = gaussKernel(sigma), r = (k.length - 1) >> 1, tmp = new Float32Array(src.length), out = new Float32Array(src.length), x, y, i;
    for (y = 0; y < h; y++) { var row = y * w; for (x = 0; x < w; x++) { var a = 0; for (i = -r; i <= r; i++) { var xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += k[i + r] * src[row + xx]; } tmp[row + x] = a; } }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var b = 0; for (i = -r; i <= r; i++) { var yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; b += k[i + r] * tmp[yy * w + x]; } out[y * w + x] = b; }
    return out;
  }
  /* luminance unsharp mask on display-referred linear data, with an edge-aware gate so flat noisy areas are not boosted. amount 0..2, radius px */
  function sharpen(img, amount, radius, gate) {
    var w = img.width, h = img.height, d = img.data, n = w * h, Y = new Float32Array(n), i;
    for (i = 0; i < n; i++) Y[i] = encodeSRGBf(clamp(luma(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]), 0, 1));
    var B = blurPlane(Y, w, h, radius || 1), gt = gate == null ? 0.01 : gate;
    for (i = 0; i < n; i++) {
      var diff = Y[i] - B[i], g = smooth(gt * 0.5, gt * 2, Math.abs(diff)), y2 = clamp(Y[i] + amount * diff * g, 0, 1), k = decodeSRGBf(y2) / Math.max(1e-6, decodeSRGBf(Y[i]));
      d[i * 3] *= k; d[i * 3 + 1] *= k; d[i * 3 + 2] *= k;
    }
    return img;
  }

  /* ---------------------------------------------------------------- denoise */
  /* Poisson-Gaussian variance stabilisation (generalised Anscombe), a-trous B3 wavelet with soft thresholds, algebraic inverse. Works per channel on camera RGB.
   * noise = { S, O }: variance = S*x + O for raw-normalised x (as in the DNG NoiseProfile tag). strength scales the threshold (1 = soft threshold of 1.5 sigma on each scale; 0.4 to 1 is the useful range, 1 already softens fine texture at low ISO). */
  function denoiseWavelet(img, noise, strength, levels) {
    var w = img.width, h = img.height, n = w * h, d = img.data, c, i, S = (noise && noise.S) || 1e-3, O = (noise && noise.O) || 1e-6, L = levels || 4, st = strength == null ? 1 : strength;
    var plane = new Float32Array(n), kk = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
    for (c = 0; c < 3; c++) {
      for (i = 0; i < n; i++) plane[i] = 2 / S * Math.sqrt(Math.max(0, S * d[i * 3 + c] + 3 / 8 * S * S + O));
      // decomposition
      var cur = plane, bands = [];
      for (var l = 0; l < L; l++) {
        var step = 1 << l, tmp = new Float32Array(n), sm = new Float32Array(n), x, y, t;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var a = 0; for (t = -2; t <= 2; t++) { var xx = x + t * step; xx = xx < 0 ? -xx : xx >= w ? 2 * (w - 1) - xx : xx; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += kk[t + 2] * cur[y * w + xx]; } tmp[y * w + x] = a; }
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var b = 0; for (t = -2; t <= 2; t++) { var yy = y + t * step; yy = yy < 0 ? -yy : yy >= h ? 2 * (h - 1) - yy : yy; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; b += kk[t + 2] * tmp[yy * w + x]; } sm[y * w + x] = b; }
        var det = new Float32Array(n); for (i = 0; i < n; i++) det[i] = cur[i] - sm[i]; bands.push(det); cur = sm;
      }
      // after stabilisation the noise std is about 1; the std of a-trous band l (B3 kernel) for white noise of std 1 is approx [0.89, 0.20, 0.086, 0.041]
      var sig = [0.89, 0.20, 0.086, 0.041, 0.020];
      for (var l2 = 0; l2 < L; l2++) { var T = 1.5 * st * sig[l2], det2 = bands[l2]; for (i = 0; i < n; i++) { var v = det2[i], av = Math.abs(v); det2[i] = av <= T ? 0 : v > 0 ? v - T : v + T; } }
      for (i = 0; i < n; i++) { var s = cur[i]; for (var l3 = 0; l3 < L; l3++) s += bands[l3][i]; plane[i] = s; }
      for (i = 0; i < n; i++) { var z = plane[i], inv = (S * z * z / 4) - 3 / 8 * S - O / S; d[i * 3 + c] = Math.max(0, inv); }
    }
    return img;
  }
  /* edge-preserving bilateral filter on luma-chroma (radius px, sigma in raw-normalised units scaled by the local level via sqrt) */
  function denoiseBilateral(img, radius, sigmaR, sigmaS) {
    var w = img.width, h = img.height, d = img.data, out = new Float32Array(d.length), r = radius || 2, ss = sigmaS || r * 0.7, x, y, dx, dy, c;
    var sp = new Float32Array((2 * r + 1) * (2 * r + 1)), k = 0; for (dy = -r; dy <= r; dy++) for (dx = -r; dx <= r; dx++) sp[k++] = Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss));
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var o = (y * w + x) * 3, y0 = luma(d[o], d[o + 1], d[o + 2]), sw = 0, a0 = 0, a1 = 0, a2 = 0, kk = 0, sr = sigmaR * Math.sqrt(Math.max(y0, 1e-4)) ; // noise grows with sqrt(level)
      for (dy = -r; dy <= r; dy++) { var yy = y + dy; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; for (dx = -r; dx <= r; dx++, kk++) { var xx = x + dx; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; var q = (yy * w + xx) * 3, yq = luma(d[q], d[q + 1], d[q + 2]), df = (yq - y0) / sr, wt = sp[kk] * Math.exp(-0.5 * df * df); sw += wt; a0 += wt * d[q]; a1 += wt * d[q + 1]; a2 += wt * d[q + 2]; } }
      out[o] = a0 / sw; out[o + 1] = a1 / sw; out[o + 2] = a2 / sw;
    }
    for (c = 0; c < out.length; c++) d[c] = out[c];
    return img;
  }

  /* ---------------------------------------------------------------- lateral chromatic aberration and vignetting */
  /* radial magnification of R and B relative to G: sample channel c at centre + (p - centre) * (1 + k_c) (k small, e.g. 0.001). Bilinear. */
  function lateralCA(img, kR, kB) {
    var w = img.width, h = img.height, d = img.data, out = new Float32Array(d.length), cx = (w - 1) / 2, cy = (h - 1) / 2, x, y, c, ks = [kR || 0, 0, kB || 0];
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) for (c = 0; c < 3; c++) {
      var sx = cx + (x - cx) * (1 + ks[c]), sy = cy + (y - cy) * (1 + ks[c]);
      sx = clamp(sx, 0, w - 1); sy = clamp(sy, 0, h - 1); var x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
      var a = d[(y0 * w + x0) * 3 + c], b = d[(y0 * w + x1) * 3 + c], e = d[(y1 * w + x0) * 3 + c], f = d[(y1 * w + x1) * 3 + c];
      out[(y * w + x) * 3 + c] = a + (b - a) * tx + (e - a) * ty + (a - b - e + f) * tx * ty;
    }
    return { width: w, height: h, data: out };
  }
  /* fringe metric: mean absolute difference between the R-G and B-G values at strong edges (lower = less colour fringing) */
  function fringeMetric(img) {
    var w = img.width, h = img.height, d = img.data, sum = 0, cnt = 0, x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { var o = (y * w + x) * 3, gx = Math.abs(d[o + 4] - d[o - 2]), gy = Math.abs(d[(y + 1) * w * 3 + x * 3 + 1] - d[(y - 1) * w * 3 + x * 3 + 1]); if (gx + gy > 0.15) { sum += Math.abs(d[o] - d[o + 1]) + Math.abs(d[o + 2] - d[o + 1]); cnt++; } }
    return cnt ? sum / cnt : 0;
  }
  /* edge-map correlation between channel c and green: 1 = the edges of the two channels coincide */
  function edgeCorr(img, c) {
    var w = img.width, h = img.height, d = img.data, sgg = 0, scc = 0, sgc = 0, x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var o = (y * w + x) * 3, gxg = d[o + 4] - d[o - 2], gyg = d[o + 1 + 3 * w] - d[o + 1 - 3 * w], gxc = d[o + 3 + c] - d[o - 3 + c], gyc = d[o + 3 * w + c] - d[o - 3 * w + c];
      var mg = Math.sqrt(gxg * gxg + gyg * gyg), mc = Math.sqrt(gxc * gxc + gyc * gyc); sgg += mg * mg; scc += mc * mc; sgc += mg * mc;
    }
    return sgc / Math.sqrt(Math.max(1e-12, sgg * scc));
  }
  /* search the R and B magnification (relative, e.g. 0.001 = 0.1 %) that best aligns their edges with green's. Coarse scan then a finer one. Returns the factors to pass to lateralCA. */
  function estimateCA(img, range, steps) {
    var r = range || 0.004, st = steps || 9, out = { kR: 0, kB: 0 };
    [[0, 'kR'], [2, 'kB']].forEach(function (ch) {
      var c = ch[0], best = -2, bk = 0, lo = -r, hi = r;
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < st; i++) { var k = lo + (hi - lo) * i / (st - 1), t = lateralCA(img, c === 0 ? k : 0, c === 2 ? k : 0), sc = edgeCorr(t, c); if (sc > best) { best = sc; bk = k; } }
        var span = (hi - lo) / (st - 1) * 1.5; lo = bk - span; hi = bk + span;
      }
      out[ch[1]] = bk; out[ch[1] + 'Score'] = best;
    });
    out.before = [edgeCorr(img, 0), edgeCorr(img, 2)];
    return out;
  }
  /* radial vignette gain: 1 / (1 - strength * r^2), r = 0 centre to 1 corner(ish) */
  function vignetteGain(img, strength) {
    var w = img.width, h = img.height, d = img.data, x, y; for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), g = 1 / (1 - strength * (dx * dx + dy * dy) / 2), o = (y * w + x) * 3; d[o] *= g; d[o + 1] *= g; d[o + 2] *= g; }
    return img;
  }

  /* ---------------------------------------------------------------- full reference develop of a decode() result in 'camera' space */
  /* params: { wb:{...}|'as-shot' (already resolved into meta.wbGains by the decoder for as-shot), highlights:'none'|'clip'|'ratio', exposure, shadows, highlightsAmount, contrast, look, denoise:0..2, sharpen:{amount,radius}, space }
   * `matrix` is the wb-excluded camera->space matrix after gains: pass meta.wbMatrix; for as-shot use LERawCore.cameraToSpace(...).  */
  function develop(decoded, cm, params) {
    params = params || {}; var img = { width: decoded.width, height: decoded.height, data: new Float32Array(decoded.data) }, t = {};
    var t0 = now();
    if (params.denoise) { denoiseWavelet(img, params.noise || { S: 1e-3, O: 1e-6 }, params.denoise); t.denoise = now() - t0; }
    var t1 = now(); var wb = whiteBalanceAndHighlights(img, cm.gains, params.highlightMode || 'ratio'); t.wbHighlights = now() - t1; img = wb;
    var t2 = now(); applyMat(img.data, cm.wbMatrix); t.matrix = now() - t2;
    var t3 = now(); toneControls(img, { exposure: params.exposure, shadows: params.shadows, highlights: params.highlightsAmount }); t.tone = now() - t3;
    var t4 = now(); applyLook(img, params.look || 'standard', { contrast: params.contrast, saturation: params.saturation }); t.look = now() - t4;
    if (params.sharpen && params.sharpen.amount) { var t5 = now(); sharpen(img, params.sharpen.amount, params.sharpen.radius || 1); t.sharpen = now() - t5; }
    img.timing = t; return img;
  }
  function applyMat(data, M) { var n = data.length / 3, a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7], i2 = M[8]; for (var k = 0, o = 0; k < n; k++, o += 3) { var r = data[o], gg = data[o + 1], bb = data[o + 2]; data[o] = a * r + b * gg + c * bb; data[o + 1] = d * r + e * gg + f * bb; data[o + 2] = g * r + h * gg + i2 * bb; } }
  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  /* ---------------------------------------------------------------- colour metrics */
  function srgbToLab(r, g, b) { // linear sRGB (D65) -> CIE Lab (D65)
    var X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
    function f(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }
    var fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function deltaE76(a, b) { var l = srgbToLab(a[0], a[1], a[2]), m = srgbToLab(b[0], b[1], b[2]); return Math.sqrt(Math.pow(l[0] - m[0], 2) + Math.pow(l[1] - m[1], 2) + Math.pow(l[2] - m[2], 2)); }
  function psnr(a, b, n, peak) { var se = 0, i; for (i = 0; i < n; i++) { var d = a[i] - b[i]; se += d * d; } return 10 * Math.log10((peak || 1) * (peak || 1) / Math.max(1e-20, se / n)); }

  return {
    whiteBalanceAndHighlights: whiteBalanceAndHighlights, toneControls: toneControls, applyLook: applyLook, LOOKS: LOOKS, baseCurve: baseCurve, toSRGB8: toSRGB8, encodeSRGB: encodeSRGBf, decodeSRGB: decodeSRGBf,
    sharpen: sharpen, denoiseWavelet: denoiseWavelet, denoiseBilateral: denoiseBilateral, lateralCA: lateralCA, estimateCA: estimateCA, fringeMetric: fringeMetric, edgeCorr: edgeCorr, vignetteGain: vignetteGain,
    develop: develop, applyMat: applyMat, blurPlane: blurPlane, srgbToLab: srgbToLab, deltaE76: deltaE76, psnr: psnr, luma: luma, clone: clone
  };
});
