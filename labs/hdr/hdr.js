/* HDR merge lab (research prototype for Expert mode step X5). Our own code, from public papers only:
 *   alignment:        Ward, "Fast, Robust Image Registration for Compositing High Dynamic Range Photographs from Handheld Exposures" (2003), median threshold bitmaps
 *   radiance merge:   Debevec and Malik (1997) weighting idea, with weights that also favour the longer exposures
 *   exposure fusion:  Mertens, Kautz, Van Reeth, "Exposure Fusion" (2007) with Burt-Adelson Laplacian pyramids
 *   deghosting:       reference-frame consistency with a brightness transfer function built by histogram matching (no exposure data needed)
 *   local tone map:   guided filter (He, Sun, Tang 2010) base/detail split on log luminance
 *
 * Frames:  { width, height, data: Uint8ClampedArray RGBA (sRGB encoded, like a JPEG/PNG)  |  Float32Array RGB (linear light),
 *            ev?: number, exposureTime?, iso?, fNumber? }
 * Result:  { width, height, data: Float32Array RGB linear, meta }
 *
 * UMD: window.LEHdr / LE.hdr.merge, or require().
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) { module.exports = m; return; }
  root.LEHdr = m;
  var LE = root.LE = root.LE || {}, base = null;
  try { var cs = document.currentScript; if (cs && cs.src) base = cs.src.replace(/[^/]*$/, ''); } catch (e) { }
  /* LE.hdr.merge(frames, opts) -> Promise. Runs in a Worker when it can (frames are copied in; the result is transferred back), else on this thread.
   * opts.signal (AbortSignal) cancels; opts.onProgress(0..1) reports. LE.hdr.mergeSync is the same call without a Worker. */
  function mergeAsync(frames, opts) {
    opts = opts || {};
    if (!base || typeof Worker === 'undefined') return new Promise(function (res, rej) { try { res(m.merge(frames, opts)); } catch (e) { rej(e); } });
    return new Promise(function (res, rej) {
      var w = new Worker(base + 'hdr-worker.js'), done = false;
      function end() { done = true; w.terminate(); }
      if (opts.signal) { if (opts.signal.aborted) { end(); var e0 = new Error('Cancelled'); e0.name = 'AbortError'; return rej(e0); } opts.signal.addEventListener('abort', function () { if (!done) { end(); var e = new Error('Cancelled'); e.name = 'AbortError'; rej(e); } }); }
      w.onmessage = function (ev) { var d = ev.data; if (d.progress != null) { if (opts.onProgress) opts.onProgress(d.progress); return; } end(); if (d.ok) res(d.result); else rej(new Error(d.error)); };
      w.onerror = function (ev) { if (!done) { end(); rej(new Error(ev.message || 'HDR worker error')); } };
      var o = {}; Object.keys(opts).forEach(function (k) { if (k !== 'signal' && k !== 'onProgress') o[k] = opts[k]; });
      w.postMessage({ frames: frames.map(function (f) { return { width: f.width, height: f.height, data: f.data.slice(), ev: f.ev, exposureTime: f.exposureTime, iso: f.iso, fNumber: f.fNumber }; }), opts: o });
    });
  }
  LE.hdr = { merge: mergeAsync, mergeSync: m.merge, toneMap: m.toneMap, align: m.alignFrames, fromImageData: m.fromImageData };
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var now = function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function abortError() { var e = new Error('Cancelled'); e.name = 'AbortError'; return e; }
  var LUT_DEC = (function () { var t = new Float32Array(256); for (var i = 0; i < 256; i++) { var v = i / 255; t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return t; })();
  function encExact(v) { v = v < 0 ? 0 : v > 1 ? 1 : v; return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
  function decExact(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var NL = 8192, ENC_T = new Float32Array(NL + 2), DEC_T = new Float32Array(NL + 2);
  (function () { for (var i = 0; i <= NL + 1; i++) { ENC_T[i] = encExact(i / NL); DEC_T[i] = decExact(i / NL); } })();
  function enc(v) { if (v <= 0) return 0; if (v >= 1) return 1; var x = v * NL, i = x | 0; return ENC_T[i] + (ENC_T[i + 1] - ENC_T[i]) * (x - i); }
  function dec(v) { if (v <= 0) return 0; if (v >= 1) return 1; var x = v * NL, i = x | 0; return DEC_T[i] + (DEC_T[i + 1] - DEC_T[i]) * (x - i); }

  /* ------------------------------------------------------------ frame access: everything is converted to Float32 RGB when needed */
  function isU8(f) { return f.data instanceof Uint8ClampedArray || f.data instanceof Uint8Array; }
  function toLinear(f) { // Float32 RGB linear, new array
    var n = f.width * f.height, out = new Float32Array(n * 3), d = f.data, i;
    if (isU8(f)) for (i = 0; i < n; i++) { out[i * 3] = LUT_DEC[d[i * 4]]; out[i * 3 + 1] = LUT_DEC[d[i * 4 + 1]]; out[i * 3 + 2] = LUT_DEC[d[i * 4 + 2]]; } else out.set(d);
    return out;
  }
  function toDisplay(f) { // Float32 RGB display-referred 0..1
    var n = f.width * f.height, out = new Float32Array(n * 3), d = f.data, i;
    if (isU8(f)) for (i = 0; i < n; i++) { out[i * 3] = d[i * 4] / 255; out[i * 3 + 1] = d[i * 4 + 1] / 255; out[i * 3 + 2] = d[i * 4 + 2] / 255; } else for (i = 0; i < n * 3; i++) out[i] = enc(d[i]);
    return out;
  }
  function fromImageData(id, meta) { return Object.assign({ width: id.width, height: id.height, data: id.data }, meta || {}); }

  /* bilinear resize of a Float32 RGB image (after a box prefilter for large reductions) */
  function resize(src, w, h, nw, nh) {
    if (nw === w && nh === h) return src;
    var fx = 1, fy = 1; while (w / fx / 2 >= nw) fx *= 2; while (h / fy / 2 >= nh) fy *= 2;
    if (fx > 1 || fy > 1) { var bw = Math.floor(w / fx), bh = Math.floor(h / fy), b = new Float32Array(bw * bh * 3), x, y, i, j, c, inv = 1 / (fx * fy); for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) for (c = 0; c < 3; c++) { var s = 0; for (j = 0; j < fy; j++) for (i = 0; i < fx; i++) s += src[((y * fy + j) * w + x * fx + i) * 3 + c]; b[(y * bw + x) * 3 + c] = s * inv; } src = b; w = bw; h = bh; }
    var out = new Float32Array(nw * nh * 3), sx = w / nw, sy = h / nh;
    for (var yy = 0; yy < nh; yy++) { var py = clamp((yy + 0.5) * sy - 0.5, 0, h - 1), y0 = Math.floor(py), y1 = Math.min(h - 1, y0 + 1), ty = py - y0; for (var xx = 0; xx < nw; xx++) { var px = clamp((xx + 0.5) * sx - 0.5, 0, w - 1), x0 = Math.floor(px), x1 = Math.min(w - 1, x0 + 1), tx = px - x0; for (var cc = 0; cc < 3; cc++) { var a = src[(y0 * w + x0) * 3 + cc], bb = src[(y0 * w + x1) * 3 + cc], c2 = src[(y1 * w + x0) * 3 + cc], d2 = src[(y1 * w + x1) * 3 + cc]; out[(yy * nw + xx) * 3 + cc] = a + (bb - a) * tx + (c2 - a) * ty + (a - bb - c2 + d2) * tx * ty; } } }
    return out;
  }

  /* ------------------------------------------------------------ alignment (median threshold bitmaps, with a small rotation search) */
  function grayBox(f, maxSide) { // Uint8 luminance (display referred) at a size with the long side <= maxSide; returns { g, w, h, scale }
    var s = Math.max(1, Math.ceil(Math.max(f.width, f.height) / maxSide)), w = Math.floor(f.width / s), h = Math.floor(f.height / s), g = new Uint8Array(w * h), u8 = isU8(f), d = f.data, x, y, i, j;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var sum = 0, cnt = 0;
      for (j = 0; j < s; j += (s > 4 ? 2 : 1)) for (i = 0; i < s; i += (s > 4 ? 2 : 1)) { var o = ((y * s + j) * f.width + x * s + i); var r, gg, b; if (u8) { r = d[o * 4] / 255; gg = d[o * 4 + 1] / 255; b = d[o * 4 + 2] / 255; } else { r = enc(d[o * 3]); gg = enc(d[o * 3 + 1]); b = enc(d[o * 3 + 2]); } sum += 0.2126 * r + 0.7152 * gg + 0.0722 * b; cnt++; }
      g[y * w + x] = Math.round(255 * sum / cnt);
    }
    return { g: g, w: w, h: h, scale: s };
  }
  function half(g, w, h) { var nw = w >> 1, nh = h >> 1, o = new Uint8Array(nw * nh), x, y; for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) o[y * nw + x] = (g[2 * y * w + 2 * x] + g[2 * y * w + 2 * x + 1] + g[(2 * y + 1) * w + 2 * x] + g[(2 * y + 1) * w + 2 * x + 1]) >> 2; return { g: o, w: nw, h: nh }; }
  function medianOf(g) { var hist = new Uint32Array(256), i; for (i = 0; i < g.length; i++) hist[g[i]]++; var acc = 0, half = g.length / 2; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= half) return i; } return 128; }
  function bitmaps(L) { var med = medianOf(L.g), n = L.g.length, bm = new Uint8Array(n), ex = new Uint8Array(n); for (var i = 0; i < n; i++) { bm[i] = L.g[i] > med ? 1 : 0; ex[i] = Math.abs(L.g[i] - med) > 4 ? 1 : 0; } return { bm: bm, ex: ex, w: L.w, h: L.h }; }
  function mtbError(a, b, dx, dy) { // a = reference, b = moving; b sampled at (x - dx, y - dy)
    var w = a.w, h = a.h, err = 0, x0 = Math.max(0, dx), x1 = Math.min(w, w + dx), y0 = Math.max(0, dy), y1 = Math.min(h, h + dy), x, y;
    for (y = y0; y < y1; y++) { var ro = y * w, mo = (y - dy) * w - dx; for (x = x0; x < x1; x++) { if (a.ex[ro + x] & b.ex[mo + x]) err += a.bm[ro + x] ^ b.bm[mo + x]; } }
    return err;
  }
  function rotateGray(g, w, h, theta) { // about the centre, bilinear, edge fill with the median
    if (!theta) return g; var o = new Uint8Array(g.length), c = Math.cos(theta), s = Math.sin(theta), cx = (w - 1) / 2, cy = (h - 1) / 2, x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var dx = x - cx, dy = y - cy, sx = c * dx + s * dy + cx, sy = -s * dx + c * dy + cy; if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) { o[y * w + x] = 128; continue; } var x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = sx - x0, ty = sy - y0; o[y * w + x] = (g[y0 * w + x0] * (1 - tx) + g[y0 * w + x1] * tx) * (1 - ty) + (g[y1 * w + x0] * (1 - tx) + g[y1 * w + x1] * tx) * ty; }
    return o;
  }
  function pyramidBitmaps(L, levels) { var out = [], cur = L; for (var i = 0; i < levels; i++) { out.push(bitmaps(cur)); if (cur.w < 24 || cur.h < 24) break; cur = half(cur.g, cur.w, cur.h); } return out; }
  function searchTranslation(refP, movP) { // coarse to fine, +-1 per level
    var dx = 0, dy = 0, lv = Math.min(refP.length, movP.length) - 1, best = null;
    for (var l = lv; l >= 0; l--) {
      dx *= 2; dy *= 2; var bx = dx, by = dy, be = Infinity;
      for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) { var e = mtbError(refP[l], movP[l], dx + i, dy + j); if (e < be) { be = e; bx = dx + i; by = dy + j; } }
      dx = bx; dy = by; best = be / Math.max(1, refP[l].w * refP[l].h);
    }
    return { dx: dx, dy: dy, err: best };
  }
  /* returns the transform that maps the moving frame onto the reference at the frame's own resolution:
   * a point p in the reference corresponds to R(theta) (p - c) + c - t in the moving frame, with t = { dx, dy } */
  function alignPair(refGray, movGray, opts) {
    opts = opts || {}; var levels = opts.levels || 7, maxRot = opts.maxRotation == null ? 3 : opts.maxRotation, refP = pyramidBitmaps(refGray, levels);
    var bestTheta = 0, movG = movGray;
    if (maxRot > 0) { // rotation search on a coarse level (about 128 px), then fix the rotation
      var cl = movGray, k = 0; while (Math.max(cl.w, cl.h) > 320) { var hh = half(cl.g, cl.w, cl.h); cl = { g: hh.g, w: hh.w, h: hh.h }; k++; }
      var rl = refGray, k2 = 0; while (k2 < k) { var h2 = half(rl.g, rl.w, rl.h); rl = { g: h2.g, w: h2.w, h: h2.h }; k2++; }
      var rp = pyramidBitmaps(rl, 6), be = Infinity, step = 0.25, a;
      for (a = -maxRot; a <= maxRot + 1e-9; a += step) { var th = a * Math.PI / 180, rg = { g: rotateGray(cl.g, cl.w, cl.h, th), w: cl.w, h: cl.h }, mp = pyramidBitmaps(rg, 6), t = searchTranslation(rp, mp), e = t.err + 0.0001 * Math.abs(a); if (e < be) { be = e; bestTheta = th; } }
      if (bestTheta) movG = { g: rotateGray(movGray.g, movGray.w, movGray.h, bestTheta), w: movGray.w, h: movGray.h };
    }
    var t2 = searchTranslation(refP, pyramidBitmaps(movG, levels));
    return { theta: bestTheta, dx: t2.dx, dy: t2.dy, err: t2.err };
  }
  function warp(lin, w, h, T, scale) { // resample the moving frame onto the reference grid (Float32 RGB)
    var out = new Float32Array(lin.length), c = Math.cos(T.theta), s = Math.sin(T.theta), cx = (w - 1) / 2, cy = (h - 1) / 2, tx = T.dx * scale, ty = T.dy * scale, x, y, k;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var dx = x - tx - cx, dy = y - ty - cy, sx = c * dx + s * dy + cx, sy = -s * dx + c * dy + cy;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) { var q0 = (y * w + x) * 3; sx = clamp(sx, 0, w - 1); sy = clamp(sy, 0, h - 1); }
      var x0 = sx | 0, y0 = sy | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0, o = (y * w + x) * 3;
      for (k = 0; k < 3; k++) { var a = lin[(y0 * w + x0) * 3 + k], b = lin[(y0 * w + x1) * 3 + k], c2 = lin[(y1 * w + x0) * 3 + k], d2 = lin[(y1 * w + x1) * 3 + k]; out[o + k] = a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + d2) * fx * fy; }
    }
    return out;
  }
  /* align every frame to frames[ref]; returns [{ theta (rad), dx, dy (full-resolution px), err }] */
  function alignFrames(frames, ref, opts) {
    opts = opts || {}; var maxSide = opts.maxSide || 1024, rg = grayBox(frames[ref], maxSide), out = [];
    for (var i = 0; i < frames.length; i++) {
      if (i === ref) { out.push({ theta: 0, dx: 0, dy: 0, err: 0 }); continue; }
      var mg = grayBox(frames[i], maxSide), t = alignPair(rg, mg, opts); out.push({ theta: t.theta, dx: t.dx * rg.scale, dy: t.dy * rg.scale, err: t.err });
    }
    return out;
  }

  /* ------------------------------------------------------------ small image ops */
  function lumaLin(lin, n) { var o = new Float32Array(n); for (var i = 0; i < n; i++) o[i] = 0.2126 * lin[i * 3] + 0.7152 * lin[i * 3 + 1] + 0.0722 * lin[i * 3 + 2]; return o; }
  function boxBlur(src, w, h, r) { // separable mean, edge clamped, single plane
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length), x, y, i, win = 2 * r + 1;
    for (y = 0; y < h; y++) { var acc = 0, row = y * w; for (i = -r; i <= r; i++) acc += src[row + clamp(i, 0, w - 1)]; for (x = 0; x < w; x++) { tmp[row + x] = acc / win; acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)]; } }
    for (x = 0; x < w; x++) { var a2 = 0; for (i = -r; i <= r; i++) a2 += tmp[clamp(i, 0, h - 1) * w + x]; for (y = 0; y < h; y++) { out[y * w + x] = a2 / win; a2 += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]; } }
    return out;
  }
  function dilate(mask, w, h, r) { var tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length), x, y, i; for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var m = 0; for (i = -r; i <= r && !m; i++) { var xx = x + i; if (xx >= 0 && xx < w && mask[y * w + xx]) m = 1; } tmp[y * w + x] = m; } for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var m2 = 0; for (i = -r; i <= r && !m2; i++) { var yy = y + i; if (yy >= 0 && yy < h && tmp[yy * w + x]) m2 = 1; } out[y * w + x] = m2; } return out; }

  /* brightness transfer function ref -> frame by cumulative histogram matching on display luminance (no exposure data needed) */
  function transferLUT(refD, frmD, n) { // display-referred Float32 RGB inputs; returns Float32Array(256): ref level -> frame level (0..1)
    var hr = new Float64Array(256), hf = new Float64Array(256), i;
    for (i = 0; i < n; i += 3) { var a = 0.2126 * refD[i * 3] + 0.7152 * refD[i * 3 + 1] + 0.0722 * refD[i * 3 + 2], b = 0.2126 * frmD[i * 3] + 0.7152 * frmD[i * 3 + 1] + 0.0722 * frmD[i * 3 + 2]; hr[Math.min(255, (a * 255) | 0)]++; hf[Math.min(255, (b * 255) | 0)]++; }
    var cr = 0, cf = 0, tot = 0; for (i = 0; i < 256; i++) tot += hr[i]; var cdfR = new Float64Array(256), cdfF = new Float64Array(256); for (i = 0; i < 256; i++) { cr += hr[i]; cf += hf[i]; cdfR[i] = cr / tot; cdfF[i] = cf / tot; }
    var lut = new Float32Array(256), j = 0; for (i = 0; i < 256; i++) { while (j < 255 && cdfF[j] < cdfR[i]) j++; lut[i] = j / 255; }
    return lut;
  }
  /* motion mask (1 = this pixel of the frame disagrees with the reference). Both inputs display-referred Float32 RGB on the same grid.
   * Computed at no more than about 2 megapixels and then enlarged: the mask is smooth by construction, and this keeps the cost flat for big photos. */
  function ghostMask(refD, frmD, w, h, o) {
    o = o || {}; var f = Math.max(1, Math.floor(Math.sqrt(w * h / 2.2e6)));
    if (f > 1) {
      var sw = Math.floor(w / f), sh = Math.floor(h / f), a = resize(refD, w, h, sw, sh), b = resize(frmD, w, h, sw, sh), r = ghostMaskSmall(a, b, sw, sh, o), full = new Float32Array(w * h);
      for (var y = 0; y < h; y++) { var py = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = py | 0, y1 = Math.min(sh - 1, y0 + 1), fy = py - y0; for (var x = 0; x < w; x++) { var px = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = px | 0, x1 = Math.min(sw - 1, x0 + 1), fx = px - x0; full[y * w + x] = (r.mask[y0 * sw + x0] * (1 - fx) + r.mask[y0 * sw + x1] * fx) * (1 - fy) + (r.mask[y1 * sw + x0] * (1 - fx) + r.mask[y1 * sw + x1] * fx) * fy; } }
      return { mask: full, fraction: r.fraction };
    }
    return ghostMaskSmall(refD, frmD, w, h, o);
  }
  function ghostMaskSmall(refD, frmD, w, h, o) {
    o = o || {}; var n = w * h, lut = transferLUT(refD, frmD, n), thr = o.threshold == null ? 0.12 : o.threshold, rl = new Float32Array(n), fl = new Float32Array(n), pr = new Float32Array(n), i;
    for (i = 0; i < n; i++) { var a = 0.2126 * refD[i * 3] + 0.7152 * refD[i * 3 + 1] + 0.0722 * refD[i * 3 + 2]; rl[i] = a; fl[i] = 0.2126 * frmD[i * 3] + 0.7152 * frmD[i * 3 + 1] + 0.0722 * frmD[i * 3 + 2]; pr[i] = lut[Math.min(255, (a * 255) | 0)]; }
    var r = Math.max(1, Math.round(Math.min(w, h) / 400)), bF = boxBlur(fl, w, h, r), bP = boxBlur(pr, w, h, r), bR = boxBlur(rl, w, h, r), mask = new Uint8Array(n), moving = 0;
    for (i = 0; i < n; i++) {
      var ref = bR[i], f = bF[i]; if (ref < 0.04 || ref > 0.96 || f < 0.03 || f > 0.97) continue; // the reference cannot judge clipped or black pixels
      if (Math.abs(f - bP[i]) > thr) { mask[i] = 1; moving++; }
    }
    var grown = dilate(mask, w, h, Math.max(2, Math.round(Math.min(w, h) / 150))), soft = new Float32Array(n); for (i = 0; i < n; i++) soft[i] = grown[i];
    var sm = boxBlur(soft, w, h, Math.max(1, Math.round(Math.min(w, h) / 300)));
    return { mask: sm, fraction: moving / n };
  }

  /* ------------------------------------------------------------ radiance merge */
  function mergeRadiance(frames, lins, evs, ref, masks, o) {
    var w = frames[0].width, h = frames[0].height, n = w * h, num = new Float32Array(n * 3), den = new Float32Array(n * 3), i, f, k;
    var order = frames.map(function (_, i) { return i; }).sort(function (a, b) { return evs[a] - evs[b]; }), lo = order[0], hi = order[order.length - 1];
    for (f = 0; f < frames.length; f++) {
      var lin = lins[f], t = Math.pow(2, evs[f]), mk = masks[f], u8 = isU8(frames[f]);
      for (i = 0; i < n; i++) {
        var m = f === ref || !mk ? 1 : 1 - mk[i];
        if (m <= 0) continue;
        for (k = 0; k < 3; k++) {
          var z = lin[i * 3 + k], zd = u8 ? enc(z) : clamp(z, 0, 1); // weight from the display value so 8-bit steps (large at the dark end) count for little
          var wgt;
          if (u8) wgt = zd < 0.02 || zd > 0.985 ? 0 : (1 - Math.pow(Math.abs(2 * zd - 1), 4)) * t; else wgt = z <= 0.002 || z > 0.98 ? 0 : (z < 0.5 ? z / 0.5 : (1 - z) / 0.5 + 0.02) * t;
          wgt *= m;
          num[i * 3 + k] += wgt * z / t; den[i * 3 + k] += wgt;
        }
      }
    }
    var out = new Float32Array(n * 3), loLin = lins[lo], hiLin = lins[hi], tlo = Math.pow(2, evs[lo]), thi = Math.pow(2, evs[hi]);
    for (i = 0; i < n * 3; i++) {
      if (den[i] > 1e-9) out[i] = num[i] / den[i]; else { // every frame clipped or black here: take the darkest frame for bright pixels, the brightest for dark ones
        var l = (loLin[i - i % 3] + loLin[i - i % 3 + 1] + loLin[i - i % 3 + 2]) / 3; out[i] = l > 0.5 ? loLin[i] / tlo : hiLin[i] / thi;
      }
    }
    return out;
  }
  function estimateRelativeEV(refLin, lin, n) { // from the ratio of medians of pixels well exposed in both (works on linear data, relative to the reference)
    var ratios = []; for (var i = 0; i < n; i += 7) { var a = refLin[i * 3 + 1], b = lin[i * 3 + 1]; if (a > 0.03 && a < 0.8 && b > 0.03 && b < 0.8) ratios.push(Math.log2(b / a)); }
    if (ratios.length < 50) return 0; ratios.sort(function (x, y) { return x - y; }); return ratios[ratios.length >> 1];
  }

  /* ------------------------------------------------------------ exposure fusion */
  function reduce(src, w, h, ch) { // blur 5-tap and decimate
    var nw = (w + 1) >> 1, nh = (h + 1) >> 1, tmp = new Float32Array(nw * h * ch), out = new Float32Array(nw * nh * ch), x, y, c, K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16], t;
    for (y = 0; y < h; y++) for (x = 0; x < nw; x++) for (c = 0; c < ch; c++) { var s = 0; for (t = -2; t <= 2; t++) { var xx = 2 * x + t; xx = xx < 0 ? -xx : xx >= w ? 2 * w - 2 - xx : xx; if (xx < 0) xx = 0; s += K[t + 2] * src[(y * w + xx) * ch + c]; } tmp[(y * nw + x) * ch + c] = s; }
    for (y = 0; y < nh; y++) for (x = 0; x < nw; x++) for (c = 0; c < ch; c++) { var s2 = 0; for (t = -2; t <= 2; t++) { var yy = 2 * y + t; yy = yy < 0 ? -yy : yy >= h ? 2 * h - 2 - yy : yy; if (yy < 0) yy = 0; s2 += K[t + 2] * tmp[(yy * nw + x) * ch + c]; } out[(y * nw + x) * ch + c] = s2; }
    return { d: out, w: nw, h: nh };
  }
  function expand(src, w, h, nw, nh, ch) { // bilinear upsample (the Laplacian is formed against the same expansion, so the pyramid is exactly invertible)
    var out = new Float32Array(nw * nh * ch), x, y, c;
    for (y = 0; y < nh; y++) { var sy = clamp((y + 0.5) / 2 - 0.5, 0, h - 1), y0 = sy | 0, y1 = Math.min(h - 1, y0 + 1), fy = sy - y0; for (x = 0; x < nw; x++) { var sx = clamp((x + 0.5) / 2 - 0.5, 0, w - 1), x0 = sx | 0, x1 = Math.min(w - 1, x0 + 1), fx = sx - x0; for (c = 0; c < ch; c++) { var a = src[(y0 * w + x0) * ch + c], b = src[(y0 * w + x1) * ch + c], c2 = src[(y1 * w + x0) * ch + c], d2 = src[(y1 * w + x1) * ch + c]; out[(y * nw + x) * ch + c] = a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + d2) * fx * fy; } } }
    return out;
  }
  function gaussPyr(img, w, h, ch, levels) { var p = [{ d: img, w: w, h: h }]; for (var l = 1; l < levels; l++) p.push(reduce(p[l - 1].d, p[l - 1].w, p[l - 1].h, ch)); return p; }
  function lapPyr(g, ch) { var L = [], l; for (l = 0; l < g.length - 1; l++) { var up = expand(g[l + 1].d, g[l + 1].w, g[l + 1].h, g[l].w, g[l].h, ch), d = new Float32Array(g[l].d.length); for (var i = 0; i < d.length; i++) d[i] = g[l].d[i] - up[i]; L.push({ d: d, w: g[l].w, h: g[l].h }); } L.push(g[g.length - 1]); return L; }
  function fusionWeights(disp, w, h, ow) { // contrast * saturation * well-exposedness, Mertens 2007
    var n = w * h, wt = new Float32Array(n), gray = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) gray[i] = 0.2126 * disp[i * 3] + 0.7152 * disp[i * 3 + 1] + 0.0722 * disp[i * 3 + 2];
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; var xm = x > 0 ? i - 1 : i, xp = x < w - 1 ? i + 1 : i, ym = y > 0 ? i - w : i, yp = y < h - 1 ? i + w : i;
      var C = Math.abs(gray[xm] + gray[xp] + gray[ym] + gray[yp] - 4 * gray[i]);
      var r = disp[i * 3], g = disp[i * 3 + 1], b = disp[i * 3 + 2], mu = (r + g + b) / 3, S = Math.sqrt(((r - mu) * (r - mu) + (g - mu) * (g - mu) + (b - mu) * (b - mu)) / 3);
      var E = Math.exp(-((r - 0.5) * (r - 0.5) + (g - 0.5) * (g - 0.5) + (b - 0.5) * (b - 0.5)) / 0.08);
      wt[i] = (ow.c === 1 ? C : Math.pow(C, ow.c)) * (ow.s === 1 ? S : Math.pow(S, ow.s)) * (ow.e === 1 ? E : Math.pow(E, ow.e)) + 1e-6;
    }
    return wt;
  }
  function fuse(disps, w, h, masks, ref, opts, tick) {
    var ow = { c: opts.wContrast == null ? 1 : opts.wContrast, s: opts.wSaturation == null ? 1 : opts.wSaturation, e: opts.wExposure == null ? 1 : opts.wExposure };
    var levels = Math.max(2, Math.min(opts.levels || 8, Math.floor(Math.log2(Math.min(w, h))) - 2)), n = w * h, f, i;
    var wts = disps.map(function (d, f) { var wt = fusionWeights(d, w, h, ow); if (masks[f] && f !== ref) for (var k = 0; k < n; k++) wt[k] *= 1 - masks[f][k]; return wt; });
    var sum = new Float32Array(n); wts.forEach(function (wt) { for (var k = 0; k < n; k++) sum[k] += wt[k]; }); wts.forEach(function (wt) { for (var k = 0; k < n; k++) wt[k] /= sum[k]; });
    var acc = null;
    for (f = 0; f < disps.length; f++) {
      var gi = gaussPyr(disps[f], w, h, 3, levels), L = lapPyr(gi, 3), gw = gaussPyr(wts[f], w, h, 1, levels);
      if (!acc) acc = L.map(function (l) { return { d: new Float32Array(l.d.length), w: l.w, h: l.h }; });
      for (var l = 0; l < levels; l++) { var ld = L[l].d, wd = gw[l].d, ad = acc[l].d, m = wd.length; for (i = 0; i < m; i++) { var ww = wd[i]; ad[i * 3] += ww * ld[i * 3]; ad[i * 3 + 1] += ww * ld[i * 3 + 1]; ad[i * 3 + 2] += ww * ld[i * 3 + 2]; } }
      tick((f + 1) / disps.length);
    }
    var cur = acc[levels - 1];
    for (var l2 = levels - 2; l2 >= 0; l2--) { var up = expand(cur.d, cur.w, cur.h, acc[l2].w, acc[l2].h, 3), d = acc[l2].d; for (i = 0; i < d.length; i++) up[i] += d[i]; cur = { d: up, w: acc[l2].w, h: acc[l2].h }; }
    return cur.d;
  }

  /* ------------------------------------------------------------ local tone mapping (guided filter base/detail on log luminance) */
  function guidedFilter(I, p, w, h, r, eps) { // I guide, p input (same plane), He et al. 2010 with box filters
    var n = w * h, mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r), Ip = new Float32Array(n), II = new Float32Array(n), i; for (i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    var mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r), a = new Float32Array(n), b = new Float32Array(n);
    for (i = 0; i < n; i++) { var cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i]; a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
    var ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), q = new Float32Array(n); for (i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i]; return q;
  }
  /* img: { width, height, data: Float32 linear RGB, scene referred }. Returns display-referred LINEAR RGB (0..1) in a new array.
   * method 'local' (guided base/detail), 'global' (Reinhard-style, extended), 'gaussian' (plain blur base, for halo comparison). strength 0..1 how much of the range to compress. */
  function toneMap(img, o) {
    o = o || {}; var w = img.width, h = img.height, n = w * h, d = img.data, method = o.method || 'local', strength = o.strength == null ? 0.7 : o.strength, sat = o.saturation == null ? 1 : o.saturation, i;
    var Y = lumaLin(d, n), key = 0; for (i = 0; i < n; i++) key += Math.log(Y[i] + 1e-5); key = Math.exp(key / n);
    var exposure = (o.key == null ? 0.18 : o.key) / key, out = new Float32Array(n * 3), L = new Float32Array(n);
    for (i = 0; i < n; i++) L[i] = Math.log2(Math.max(1e-5, Y[i] * exposure));
    var Ln = new Float32Array(n);
    if (method === 'global') { for (i = 0; i < n; i++) { var y = Y[i] * exposure, wp = 4; var yd = y * (1 + y / (wp * wp)) / (1 + y); Ln[i] = Math.log2(Math.max(1e-5, yd)); } }
    else {
      // work at reduced size for the base layer (the guided filter radius is then in a few pixels, and the cost is small)
      var s = Math.max(1, Math.floor(Math.max(w, h) / 512)), bw = Math.floor(w / s), bh = Math.floor(h / s), sm = new Float32Array(bw * bh), x, yy;
      for (yy = 0; yy < bh; yy++) for (x = 0; x < bw; x++) { var a = 0; for (var j = 0; j < s; j++) for (var k = 0; k < s; k++) a += L[(yy * s + j) * w + x * s + k]; sm[yy * bw + x] = a / (s * s); }
      var base;
      if (method === 'gaussian') base = boxBlur(boxBlur(boxBlur(sm, bw, bh, Math.max(2, bw >> 5)), bw, bh, Math.max(2, bw >> 5)), bw, bh, Math.max(2, bw >> 5));
      else base = guidedFilter(sm, sm, bw, bh, Math.max(3, bw >> 5), 0.25);
      var bl = new Float32Array(n); for (yy = 0; yy < h; yy++) { var sy = clamp((yy + 0.5) / s - 0.5, 0, bh - 1), y0 = sy | 0, y1 = Math.min(bh - 1, y0 + 1), fy = sy - y0; for (x = 0; x < w; x++) { var sx = clamp((x + 0.5) / s - 0.5, 0, bw - 1), x0 = sx | 0, x1 = Math.min(bw - 1, x0 + 1), fx = sx - x0; bl[yy * w + x] = (base[y0 * bw + x0] * (1 - fx) + base[y0 * bw + x1] * fx) * (1 - fy) + (base[y1 * bw + x0] * (1 - fx) + base[y1 * bw + x1] * fx) * fy; } }
      var mn = Infinity, mx = -Infinity; for (i = 0; i < n; i++) { if (bl[i] < mn) mn = bl[i]; if (bl[i] > mx) mx = bl[i]; }
      var range = Math.max(1e-3, mx - mn), target = Math.max(2.5, 6 - strength * 3.0), comp = range > target ? 1 - strength * (1 - target / range) : 1, mid = Math.log2(0.18);
      for (i = 0; i < n; i++) { var detail = L[i] - bl[i]; Ln[i] = mid + (bl[i] - mid) * comp + detail * (o.detail == null ? 1.0 : o.detail); }
    }
    for (i = 0; i < n; i++) { var yo = Math.pow(2, Ln[i]), yi = Math.max(1e-6, Y[i] * exposure), g = yo / yi; var r = d[i * 3] * exposure, gg = d[i * 3 + 1] * exposure, b = d[i * 3 + 2] * exposure; r = yi + (r - yi) * sat; gg = yi + (gg - yi) * sat; b = yi + (b - yi) * sat; out[i * 3] = clamp(r * g, 0, 1); out[i * 3 + 1] = clamp(gg * g, 0, 1); out[i * 3 + 2] = clamp(b * g, 0, 1); }
    return { width: w, height: h, data: out };
  }

  /* ------------------------------------------------------------ the public merge */
  /* opts: { mode: 'fusion' | 'radiance', align: true | { maxShift, maxRotation }, deghost: true | { threshold }, reference: index, signal, onProgress, maxPixels (working size cap in pixels, default 8 million; the result keeps that size, see meta.scale) }
   * radiance: data is scene-referred linear RGB scaled so the reference frame's exposure is 1.0 (values above 1 are the recovered highlights).
   * fusion: data is the fused picture, linear RGB, already within 0..1 (display range). */
  function merge(frames, opts) {
    opts = opts || {}; var t0 = now(), tick = function (p) { if (opts.signal && opts.signal.aborted) throw abortError(); if (opts.onProgress) opts.onProgress(p); };
    if (!frames || frames.length < 2) throw new Error('Need at least two frames');
    var mode = opts.mode || 'fusion', W = frames[0].width, H = frames[0].height, N = frames.length;
    frames.forEach(function (f) { if (f.width !== W || f.height !== H) throw new Error('All frames must have the same size'); });
    // reference: the frame with the middle exposure (by metadata when given, else by mean brightness)
    var evs = frames.map(function (f) { return f.ev != null ? f.ev : (f.exposureTime ? Math.log2(f.exposureTime * (f.iso || 100) / 100 / Math.pow(f.fNumber || 1, 2)) : null); });
    var haveEV = evs.every(function (e) { return e != null; });
    var means = frames.map(function (f) { var s = 0, c = 0, d = f.data, u8 = isU8(f), step = Math.max(1, (W * H / 4000) | 0); for (var i = 0; i < W * H; i += step) { s += u8 ? d[i * 4 + 1] / 255 : enc(d[i * 3 + 1]); c++; } return s / c; });
    var ref = opts.reference != null ? opts.reference : (haveEV ? (function () { var o = evs.map(function (e, i) { return i; }).sort(function (a, b) { return evs[a] - evs[b]; }); return o[o.length >> 1]; })() : (function () { var o = means.map(function (e, i) { return i; }).sort(function (a, b) { return means[a] - means[b]; }); return o[o.length >> 1]; })());
    var meta = { mode: mode, frames: N, reference: ref, space: 'linear-srgb', times: {} }, ts = now();
    // working size
    var maxPx = opts.maxPixels || 8e6, scale = 1, w = W, h = H;
    if (W * H > maxPx) { var f = Math.sqrt(maxPx / (W * H)); w = Math.floor(W * f) & ~1; h = Math.floor(H * f) & ~1; scale = w / W; }
    meta.scale = scale; meta.inputSize = [W, H];
    // 1. alignment (on small gray copies; the transform is applied at the working size)
    var T = null;
    if (opts.align !== false) { T = alignFrames(frames, ref, { maxSide: 1024, maxRotation: (opts.align && opts.align.maxRotation != null) ? opts.align.maxRotation : 3 }); meta.alignment = T.map(function (t) { return { dx: +(t.dx * scale).toFixed(2), dy: +(t.dy * scale).toFixed(2), rotationDeg: +(t.theta * 180 / Math.PI).toFixed(3) }; }); }
    meta.times.align = now() - ts; tick(0.15);
    // 2. bring every frame to the working size, aligned, as Float32 (display referred for fusion, linear for radiance)
    ts = now(); var lins = new Array(N).fill(null), disps = new Array(N).fill(null), i;
    function geometry(arr, i) { if (scale !== 1) arr = resize(arr, W, H, w, h); if (T && i !== ref) arr = warp(arr, w, h, T[i], scale); return arr; }
    for (i = 0; i < N; i++) {
      if (mode === 'fusion') disps[i] = geometry(toDisplay(frames[i]), i);
      else { lins[i] = geometry(toLinear(frames[i]), i); if (opts.deghost) { var dd = new Float32Array(w * h * 3); for (var k = 0; k < dd.length; k++) dd[k] = enc(lins[i][k]); disps[i] = dd; } }
      if (opts.signal && opts.signal.aborted) throw abortError();
    }
    meta.times.prepare = now() - ts; tick(0.3);
    // 3. deghost masks against the reference
    ts = now(); var masks = new Array(N).fill(null), ghostFrac = [];
    if (opts.deghost) { for (i = 0; i < N; i++) { if (i === ref) { ghostFrac.push(0); continue; } var gm = ghostMask(disps[ref], disps[i], w, h, typeof opts.deghost === 'object' ? opts.deghost : {}); masks[i] = gm.mask; ghostFrac.push(+gm.fraction.toFixed(4)); } meta.ghostFraction = ghostFrac; }
    meta.times.deghost = now() - ts; tick(0.45);
    var out, hdrOut = null; ts = now();
    if (mode === 'radiance') {
      var ev = []; for (i = 0; i < N; i++) ev.push(haveEV ? evs[i] - evs[ref] : (i === ref ? 0 : estimateRelativeEV(lins[ref], lins[i], w * h)));
      meta.exposuresEV = ev.map(function (v) { return +v.toFixed(3); }); meta.exposureSource = haveEV ? 'metadata' : 'estimated from the pictures';
      out = mergeRadiance(frames.map(function (f, i) { return { width: w, height: h, data: frames[i].data }; }), lins, ev, ref, masks, opts);
    } else {
      out = fuse(disps, w, h, masks, ref, opts, function (p) { tick(0.45 + 0.5 * p); });
      for (i = 0; i < out.length; i++) out[i] = dec(clamp(out[i], 0, 1));
    }
    meta.times.merge = now() - ts; meta.times.total = now() - t0; tick(1);
    return { width: w, height: h, data: out, meta: meta };
  }

  return { merge: merge, toneMap: toneMap, alignFrames: alignFrames, alignPair: alignPair, grayBox: grayBox, warp: warp, ghostMask: ghostMask, fromImageData: fromImageData, resize: resize, toLinear: toLinear, toDisplay: toDisplay, boxBlur: boxBlur, guidedFilter: guidedFilter, enc: enc, dec: dec };
});
