/* DNG synthesiser (LocalEditor research tool, MIT-style: our own code, public TIFF/DNG/JPEG specifications only).
 *
 * Builds valid DNG files from a known linear image so a decoder can be measured against the truth:
 * mosaics a linear-sRGB image through a made-up camera (ColorMatrix / ForwardMatrix), adds optional sensor noise,
 * and writes it as uncompressed (8..16 bit packed, or 32-bit float), lossless-JPEG (LJ92, predictors 1..7, 1/2/4
 * components), or deflate (Node only), strips or tiles, little or big endian, with gain-map opcodes, an embedded
 * preview, a linearisation table, black level patterns and a "linear" (3 samples per pixel, ProRAW-like) variant.
 *
 * UMD: `require('./dng-synth.js')` in Node, `window.LEDngSynth` in a page.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LEDngSynth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ small maths */
  var M_SRGB2XYZ_D65 = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
  var D65 = [0.95047, 1, 1.08883], D50 = [0.96422, 1, 0.82521];
  function mul3(a, b) { var r = new Array(9); for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; }
  function mulv(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  function inv3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  var BRAD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  function bradford(srcW, dstW) {
    var s = mulv(BRAD, srcW), d = mulv(BRAD, dstW);
    var D = [d[0] / s[0], 0, 0, 0, d[1] / s[1], 0, 0, 0, d[2] / s[2]];
    return mul3(inv3(BRAD), mul3(D, BRAD));
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(rnd) { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /* ------------------------------------------------------------------ cameras (made up, but plausible and well conditioned) */
  // XYZ -> camera, under illuminant A (ColorMatrix1) and D65 (ColorMatrix2).
  var CAM = {
    cm1: [1.0210, -0.3100, -0.0610, -0.4310, 1.2150, 0.1670, -0.0420, 0.1530, 0.5120],
    cm2: [0.8230, -0.2290, -0.0810, -0.3600, 1.1480, 0.1880, -0.0260, 0.1230, 0.6050]
  };
  var TEMP = { 17: 2856, 21: 6504, 23: 5003 };

  /* camera neutral (what a white surface gives) and the exact DNG matrices for a scene lit by D65 */
  function cameraFor(opts) {
    opts = opts || {};
    var cm1 = opts.colorMatrix1 || CAM.cm1, cm2 = opts.colorMatrix2 || CAM.cm2;
    var wxyz = D65;
    var n = mulv(cm2, wxyz), mx = Math.max(n[0], n[1], n[2]);
    var neutral = [n[0] / mx, n[1] / mx, n[2] / mx];
    var cat = bradford(D65, D50);
    // ForwardMatrix: white-balanced camera -> XYZ D50 (exact for the D65 scene)
    var wbcm = mul3([1 / neutral[0], 0, 0, 0, 1 / neutral[1], 0, 0, 0, 1 / neutral[2]], cm2);
    var fm2 = mul3(cat, inv3(wbcm));
    // a slightly different matrix for illuminant A (so interpolation has something to do)
    var n1 = mulv(cm1, [1.0985, 1, 0.35585]), m1 = Math.max(n1[0], n1[1], n1[2]);
    var wbcm1 = mul3([m1 / n1[0], 0, 0, 0, m1 / n1[1], 0, 0, 0, m1 / n1[2]], cm1);
    var fm1 = mul3(bradford([1.0985, 1, 0.35585], D50), inv3(wbcm1));
    return { colorMatrix1: cm1, colorMatrix2: cm2, forwardMatrix1: fm1, forwardMatrix2: fm2, asShotNeutral: neutral, illuminant1: 17, illuminant2: 21 };
  }
  /* linear sRGB (D65) -> camera RGB (before any white balance), for the D65 scene */
  function srgbToCamera(cam) { return mul3(cam.colorMatrix2, M_SRGB2XYZ_D65); }

  /* ------------------------------------------------------------------ scenes (linear sRGB floats, D65) */
  var CHART = [[115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170], [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
    [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161], [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52]];
  function s2l(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function l2s(v) { v = v < 0 ? 0 : v > 1 ? 1 : v; return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
  function chartLinear() { return CHART.map(function (c) { return [s2l(c[0]), s2l(c[1]), s2l(c[2])]; }); }

  function blur(img, w, h, ch, sigma) { // separable gaussian, clamp edges
    if (!sigma) return img;
    var r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1), s = 0, i, x, y, c;
    for (i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (i = 0; i < k.length; i++) k[i] /= s;
    var tmp = new Float32Array(img.length), out = new Float32Array(img.length);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) for (c = 0; c < ch; c++) {
      var a = 0; for (i = -r; i <= r; i++) { var xx = x + i; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += k[i + r] * img[(y * w + xx) * ch + c]; } tmp[(y * w + x) * ch + c] = a;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) for (c = 0; c < ch; c++) {
      var b = 0; for (i = -r; i <= r; i++) { var yy = y + i; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; b += k[i + r] * tmp[(yy * w + x) * ch + c]; } out[(y * w + x) * ch + c] = b;
    }
    return out;
  }

  function valueNoise(seed) { // smooth 2D value noise on an integer lattice
    var rnd = mulberry32(seed), tab = new Float32Array(256 * 256); for (var i = 0; i < tab.length; i++) tab[i] = rnd();
    function at(x, y) { return tab[((y & 255) << 8) | (x & 255)]; }
    return function (x, y) { var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); var a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  }

  /* kind: 'natural' | 'chart' | 'zone' | 'ramp'. Returns { w, h, data: Float32Array(w*h*3) linear sRGB, patches? }.
   * The image is lightly blurred (sigma ~0.7 px) as a lens plus anti-alias filter would, so it is a fair truth for demosaicing. */
  function scene(w, h, kind, o) {
    o = o || {}; var d = new Float32Array(w * h * 3), x, y, i, patches = null;
    var gain = o.gain == null ? 1 : o.gain, sigma = o.sigma == null ? 0.7 : o.sigma;
    if (kind === 'chart') {
      var cols = 6, rows = 4, L = chartLinear(); patches = [];
      var mx = Math.round(w * 0.04), my = Math.round(h * 0.04), pw = Math.floor((w - 2 * mx) / cols), ph = Math.floor((h - 2 * my) / rows);
      for (i = 0; i < d.length; i += 3) { d[i] = d[i + 1] = d[i + 2] = 0.18 * 0.5; }
      for (var p = 0; p < 24; p++) {
        var c = p % cols, r = (p / cols) | 0, x0 = mx + c * pw + 3, y0 = my + r * ph + 3, x1 = mx + (c + 1) * pw - 3, y1 = my + (r + 1) * ph - 3;
        patches.push({ x0: x0, y0: y0, x1: x1, y1: y1, rgb: L[p] });
        for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { var q = (y * w + x) * 3; d[q] = L[p][0]; d[q + 1] = L[p][1]; d[q + 2] = L[p][2]; }
      }
    } else if (kind === 'zone') {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var dx = (x - w / 2) / w, dy = (y - h / 2) / h, v = 0.5 + 0.45 * Math.cos(Math.PI * 0.9 * (dx * dx + dy * dy) * (w) * 0.5); var q2 = (y * w + x) * 3; d[q2] = d[q2 + 1] = d[q2 + 2] = v * v; }
    } else if (kind === 'ramp') {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var q3 = (y * w + x) * 3, t = x / (w - 1); d[q3] = d[q3 + 1] = d[q3 + 2] = Math.pow(2, -9 + 11 * t) * 0.5; }
    } else { // natural-ish
      var n1 = valueNoise(11), n2 = valueNoise(12), rnd = mulberry32(5);
      var horizon = Math.round(h * 0.42);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var u = x / w, vv = y / h, q4 = (y * w + x) * 3, rr, gg, bb;
        if (y < horizon) { var t2 = y / horizon; rr = 0.10 + 0.55 * t2 * t2; gg = 0.25 + 0.50 * t2; bb = 0.75 + 0.15 * t2; var cl = n1(x / (w * 0.09), y / (h * 0.06)) * n2(x / (w * 0.04), y / (h * 0.03)); var k = Math.max(0, cl - 0.38) * 3; rr += k; gg += k; bb += k; }
        else {
          var tex = 0.5 * n1(x / 3.1, y / 3.1) + 0.3 * n2(x / 9.7, y / 9.7) + 0.2 * n1(x / 31, y / 31);
          var f = (y - horizon) / (h - horizon);
          rr = 0.05 + 0.10 * tex + 0.05 * f; gg = 0.10 + 0.22 * tex * (1 - 0.3 * f); bb = 0.03 + 0.04 * tex;
        }
        d[q4] = rr; d[q4 + 1] = gg; d[q4 + 2] = bb;
      }
      function disc(cx, cy, rad, col) { for (var yy = Math.max(0, Math.floor(cy - rad - 1)); yy < Math.min(h, cy + rad + 1); yy++) for (var xx = Math.max(0, Math.floor(cx - rad - 1)); xx < Math.min(w, cx + rad + 1); xx++) { var dd = Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy)); if (dd <= rad) { var qq = (yy * w + xx) * 3, sh = 0.75 + 0.25 * (1 - dd / rad); d[qq] = col[0] * sh; d[qq + 1] = col[1] * sh; d[qq + 2] = col[2] * sh; } } }
      function rect(x0, y0, x1, y1, col) { for (var yy = Math.max(0, y0 | 0); yy < Math.min(h, y1 | 0); yy++) for (var xx = Math.max(0, x0 | 0); xx < Math.min(w, x1 | 0); xx++) { var qq = (yy * w + xx) * 3; d[qq] = col[0]; d[qq + 1] = col[1]; d[qq + 2] = col[2]; } }
      disc(w * 0.22, h * 0.62, Math.min(w, h) * 0.12, [0.70, 0.05, 0.04]);
      disc(w * 0.50, h * 0.70, Math.min(w, h) * 0.09, [0.85, 0.65, 0.05]);
      disc(w * 0.78, h * 0.60, Math.min(w, h) * 0.10, [0.60, 0.10, 0.55]);
      rect(w * 0.60, h * 0.18, w * 0.80, h * 0.34, [0.45, 0.42, 0.38]);
      disc(w * 0.10, h * 0.18, Math.min(w, h) * 0.06, [1.6, 1.5, 1.2]); // a bright "sun" (clips if the exposure is raised)
      for (var li = 0; li < 7; li++) { var ly = h * (0.50 + 0.04 * li); rect(w * 0.05, ly, w * 0.40, ly + (li % 2 ? 1 : 2), [0.02, 0.02, 0.02]); } // thin dark lines
      for (var lj = 0; lj < 9; lj++) { var lx = w * (0.62 + 0.02 * lj); rect(lx, h * 0.80, lx + 1, h * 0.96, [0.85, 0.85, 0.85]); } // thin bright lines
    }
    if (gain !== 1) for (i = 0; i < d.length; i++) d[i] *= gain;
    return { w: w, h: h, data: blur(d, w, h, 3, sigma), patches: patches };
  }

  /* ------------------------------------------------------------------ mosaic (linear sRGB truth -> raw integers) */
  var PATTERNS = { RGGB: [0, 1, 1, 2], BGGR: [2, 1, 1, 0], GRBG: [1, 0, 2, 1], GBRG: [1, 2, 0, 1] };
  /* opts: pattern, bits, black (number or [4]), white, cam (cameraFor()), exposure (linear gain applied to the scene before capture),
   * noise: { gain (e-/DN: smaller=noisier... see code), read (DN std) } or null, seed, headroom (multiplier so white maps to this fraction of full scale),
   * vignette (strength; 0.. ; the scene is darkened radially and the same map can be written as a GainMap opcode) */
  function mosaic(sc, o) {
    o = o || {};
    var w = sc.w, h = sc.h, pat = PATTERNS[o.pattern || 'RGGB'], bits = o.bits || 14, whiteMax = (1 << bits) - 1;
    var black = o.black == null ? 0 : o.black, bl = Array.isArray(black) ? black : [black, black, black, black];
    var white = o.white == null ? whiteMax : o.white;
    var cam = o.cam || cameraFor(), M = srgbToCamera(cam);
    var expo = o.exposure == null ? 1 : o.exposure, head = o.headroom == null ? 0.9 : o.headroom; // neutral white (rgb 1,1,1) * expo hits head of full range
    var noise = o.noise, rnd = mulberry32(o.seed || 1), vig = o.vignette || 0;
    var out = new Uint16Array(w * h), src = sc.data, i, x, y, chroma = [0, 0, 0], wv = mulv(M, [1, 1, 1]), whiteMax = Math.max(wv[0], wv[1], wv[2]);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 3;
      var r = src[i] * expo, g = src[i + 1] * expo, b = src[i + 2] * expo;
      if (vig) { var dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), f = 1 - vig * (dx * dx + dy * dy) / 2; r *= f; g *= f; b *= f; }
      chroma[0] = M[0] * r + M[1] * g + M[2] * b; chroma[1] = M[3] * r + M[4] * g + M[5] * b; chroma[2] = M[6] * r + M[7] * g + M[8] * b;
      // pattern colour index -> camera channel; the sensor value is the camera response scaled so a neutral white of 1.0 reaches `head` of full scale
      var ci = pat[(y & 1) * 2 + (x & 1)], sensor = chroma[ci] * head / whiteMax;
      var blk = bl[(y & 1) * 2 + (x & 1)], dn = sensor * (white - blk);
      if (noise) { var k = noise.gain || 1; /* photons: variance = dn*k (Poisson), plus read noise */ var sd = Math.sqrt(Math.max(0, dn) * k + (noise.read || 0) * (noise.read || 0)); dn += sd * gauss(rnd); }
      var val = Math.round(dn + blk); if (val > white) val = white; if (val < 0) val = 0;
      out[y * w + x] = val;
    }
    return out;
  }

  /* ------------------------------------------------------------------ TIFF writer */
  function Writer(le) {
    var buf = new Uint8Array(1 << 20), len = 0, dv = null;
    function ensure(n) { if (len + n > buf.length) { var nb = new Uint8Array(Math.max(buf.length * 2, len + n)); nb.set(buf.subarray(0, len)); buf = nb; } }
    this.pos = function () { return len; };
    this.align = function () { ensure(2); if (len & 1) buf[len++] = 0; };
    this.bytes = function (u8) { this.align(); ensure(u8.length); buf.set(u8, len); var o = len; len += u8.length; return o; };
    this.u16at = function (o, v) { if (le) { buf[o] = v & 255; buf[o + 1] = v >> 8 & 255; } else { buf[o + 1] = v & 255; buf[o] = v >> 8 & 255; } };
    this.u32at = function (o, v) { if (le) { buf[o] = v & 255; buf[o + 1] = v >>> 8 & 255; buf[o + 2] = v >>> 16 & 255; buf[o + 3] = v >>> 24 & 255; } else { buf[o + 3] = v & 255; buf[o + 2] = v >>> 8 & 255; buf[o + 1] = v >>> 16 & 255; buf[o] = v >>> 24 & 255; } };
    this.header = function () { ensure(8); buf[0] = buf[1] = le ? 0x49 : 0x4D; this.u16at(2, 42); this.u32at(4, 0); len = 8; };
    this.setFirstIFD = function (o) { this.u32at(4, o); };
    this.setByte = function (o, v) { buf[o] = v; };
    this.finish = function () { return buf.slice(0, len); };
    this.le = le;
  }
  var TYPES = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, SBYTE: 6, UNDEF: 7, SSHORT: 8, SLONG: 9, SRATIONAL: 10, FLOAT: 11, DOUBLE: 12 };
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  function encodeValue(w, type, vals) {
    var le = w.le, n = type === TYPES.ASCII ? vals.length + 1 : vals.length, out = new Uint8Array(n * TSIZE[type]), dv = new DataView(out.buffer), i;
    for (i = 0; i < vals.length; i++) {
      var v = vals[i], o = i * TSIZE[type];
      switch (type) {
        case 1: case 7: out[o] = v; break;
        case 6: dv.setInt8(o, v); break;
        case 2: out[o] = typeof v === 'string' ? v.charCodeAt(0) : v; break;
        case 3: dv.setUint16(o, v, le); break;
        case 8: dv.setInt16(o, v, le); break;
        case 4: dv.setUint32(o, v, le); break;
        case 9: dv.setInt32(o, v, le); break;
        case 11: dv.setFloat32(o, v, le); break;
        case 12: dv.setFloat64(o, v, le); break;
        case 5: dv.setUint32(o, v[0], le); dv.setUint32(o + 4, v[1], le); break;
        case 10: dv.setInt32(o, v[0], le); dv.setInt32(o + 4, v[1], le); break;
      }
    }
    return { bytes: out, count: n };
  }
  function rational(x) { var den = 100000, neg = x < 0; var num = Math.round(Math.abs(x) * den); return [neg ? -num : num, den]; }
  function srationals(arr) { return arr.map(rational); }
  function writeIFD(w, entries) {
    entries.sort(function (a, b) { return a.tag - b.tag; });
    var blobs = entries.map(function (e) {
      var enc;
      if (e.raw) enc = { bytes: e.raw, count: e.count }; else enc = encodeValue(w, e.type, e.vals);
      var off = enc.bytes.length > 4 ? w.bytes(enc.bytes) : -1;
      return { e: e, enc: enc, off: off };
    });
    w.align(); var at = w.bytes(new Uint8Array(2 + entries.length * 12 + 4)); w.u16at(at, entries.length);
    // access to the raw buffer through a tiny re-bind: write entries via a view over finish()? simpler: patch with u16at/u32at + byte writes
    blobs.forEach(function (b, i) {
      var o = at + 2 + i * 12; w.u16at(o, b.e.tag); w.u16at(o + 2, b.e.type); w.u32at(o + 4, b.enc.count);
      if (b.off >= 0) w.u32at(o + 8, b.off); else {
        var tmp = new Uint8Array(4); tmp.set(b.enc.bytes);
        // inline value: SHORT values must be placed in the leading bytes in file byte order (already encoded in that order)
        for (var k = 0; k < 4; k++) w.setByte(o + 8 + k, tmp[k]);
      }
    });
    w.u32at(at + 2 + entries.length * 12, 0);
    return at;
  }

  /* ------------------------------------------------------------------ lossless JPEG (LJ92) encoder */
  function BitWriter() { this.b = []; this.acc = 0; this.n = 0; }
  BitWriter.prototype.put = function (code, len) { for (var i = len - 1; i >= 0; i--) { this.acc = (this.acc << 1) | ((code >>> i) & 1); if (++this.n === 8) { this.b.push(this.acc); if (this.acc === 255) this.b.push(0); this.acc = 0; this.n = 0; } } };
  BitWriter.prototype.flush = function () { while (this.n !== 0) this.put(1, 1); };

  function huffLengths(freq) { // package of simple Huffman then JPEG K.3 limit to 16 bits
    var syms = [], i; for (i = 0; i < freq.length; i++) if (freq[i] > 0) syms.push({ s: i, f: freq[i] });
    if (syms.length === 1) syms.push({ s: (syms[0].s + 1) % freq.length, f: 1 });
    var nodes = syms.map(function (a) { return { f: a.f, s: a.s }; }), codesize = new Array(freq.length).fill(0), others = new Array(freq.length).fill(-1);
    // classic JPEG K.2 procedure
    var f = new Array(freq.length + 1).fill(1e18); for (i = 0; i < freq.length; i++) f[i] = freq[i] > 0 ? freq[i] : 1e18; f[freq.length] = 1; // reserved symbol
    codesize = new Array(freq.length + 1).fill(0); others = new Array(freq.length + 1).fill(-1);
    for (;;) {
      var c1 = -1, v = 1e18; for (i = 0; i <= freq.length; i++) if (f[i] <= v && f[i] > 0) { v = f[i]; c1 = i; }
      var c2 = -1; v = 1e18; for (i = 0; i <= freq.length; i++) if (f[i] <= v && f[i] > 0 && i !== c1) { v = f[i]; c2 = i; }
      if (c2 < 0 || f[c2] >= 1e18) break;
      f[c1] += f[c2]; f[c2] = 0; codesize[c1]++; while (others[c1] >= 0) { c1 = others[c1]; codesize[c1]++; }
      others[c1] = c2; codesize[c2]++; while (others[c2] >= 0) { c2 = others[c2]; codesize[c2]++; }
    }
    var bits = new Array(33).fill(0); for (i = 0; i <= freq.length; i++) if (codesize[i]) bits[codesize[i]]++;
    for (i = 32; i > 16; i--) while (bits[i] > 0) { var j = i - 2; while (bits[j] === 0) j--; bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--; }
    i = 16; while (bits[i] === 0) i--; bits[i]--; // drop the reserved all-ones code
    var order = []; for (var len = 1; len <= 32; len++) for (i = 0; i < freq.length; i++) if (codesize[i] === len) order.push(i);
    return { bits: bits.slice(1, 17), symbols: order };
  }

  /* samples: Uint16Array row-major, `w` samples per row (= tileWidth), `h` rows, `comps` interleaved components (w divisible by comps) */
  function lj92Encode(samples, w, h, comps, bitsPrec, predictor, pt) {
    predictor = predictor || 1; pt = pt || 0;
    var X = w / comps, i, x, y, c, diffs = new Int32Array(w * h), freq = new Array(17).fill(0);
    var init = 1 << (bitsPrec - pt - 1);
    for (y = 0; y < h; y++) for (x = 0; x < X; x++) for (c = 0; c < comps; c++) {
      var idx = (y * X + x) * comps + c, v = samples[idx] >> pt;
      var Ra = x > 0 ? samples[idx - comps] >> pt : 0, Rb = y > 0 ? samples[idx - X * comps] >> pt : 0, Rc = (x > 0 && y > 0) ? samples[idx - X * comps - comps] >> pt : 0, pred;
      if (y === 0 && x === 0) pred = init; else if (y === 0) pred = Ra; else if (x === 0) pred = Rb;
      else switch (predictor) { case 1: pred = Ra; break; case 2: pred = Rb; break; case 3: pred = Rc; break; case 4: pred = Ra + Rb - Rc; break; case 5: pred = Ra + ((Rb - Rc) >> 1); break; case 6: pred = Rb + ((Ra - Rc) >> 1); break; case 7: pred = (Ra + Rb) >> 1; break; default: pred = Ra; }
      var d = (v - pred); d = ((d + 32768) & 65535) - 32768; diffs[idx] = d;
      var a = d < 0 ? -d : d, s = 0; while (a) { s++; a >>= 1; } freq[s]++;
    }
    var hl = huffLengths(freq), code = 0, codes = new Array(17).fill(null), k = 0, ln;
    for (ln = 1; ln <= 16; ln++) { for (var q = 0; q < hl.bits[ln - 1]; q++) { codes[hl.symbols[k++]] = [code, ln]; code++; } code <<= 1; }
    var bw = new BitWriter();
    for (i = 0; i < diffs.length; i++) {
      var dd = diffs[i], ad = dd < 0 ? -dd : dd, ss = 0; while (ad) { ss++; ad >>= 1; }
      var cc = codes[ss]; bw.put(cc[0], cc[1]);
      if (ss && ss < 16) bw.put(dd < 0 ? (dd - 1) & ((1 << ss) - 1) : dd, ss);
    }
    bw.flush();
    var hdr = [0xFF, 0xD8, 0xFF, 0xC3, 0, 8 + 3 * comps, bitsPrec, h >> 8, h & 255, X >> 8, X & 255, comps];
    for (c = 0; c < comps; c++) hdr.push(c + 1, 0x11, 0);
    var nsym = hl.symbols.length;
    hdr.push(0xFF, 0xC4, (19 + nsym) >> 8, (19 + nsym) & 255, 0x00); for (i = 0; i < 16; i++) hdr.push(hl.bits[i]); for (i = 0; i < nsym; i++) hdr.push(hl.symbols[i]);
    hdr.push(0xFF, 0xDA, 0, 6 + 2 * comps, comps); for (c = 0; c < comps; c++) hdr.push(c + 1, 0);
    hdr.push(predictor, 0, pt);
    var out = new Uint8Array(hdr.length + bw.b.length + 2); out.set(hdr); out.set(bw.b, hdr.length); out[out.length - 2] = 0xFF; out[out.length - 1] = 0xD9;
    return out;
  }

  /* ------------------------------------------------------------------ sample packing */
  function packBits(samples, bits, le) { // MSB-first packed, rows padded to a byte boundary handled by the caller (we pass one row at a time)
    var nbytes = Math.ceil(samples.length * bits / 8), out = new Uint8Array(nbytes), acc = 0, n = 0, o = 0;
    for (var i = 0; i < samples.length; i++) { acc = (acc << bits) | samples[i]; n += bits; while (n >= 8) { n -= 8; out[o++] = (acc >>> n) & 255; } acc &= (1 << n) - 1; }
    if (n > 0) out[o++] = (acc << (8 - n)) & 255;
    return out;
  }
  function sampleBytes(samples, bits, le) {
    if (bits === 8) return Uint8Array.from(samples);
    if (bits === 16) { var o = new Uint8Array(samples.length * 2); for (var i = 0; i < samples.length; i++) { if (le) { o[i * 2] = samples[i] & 255; o[i * 2 + 1] = samples[i] >> 8; } else { o[i * 2 + 1] = samples[i] & 255; o[i * 2] = samples[i] >> 8; } } return o; }
    return packBits(samples, bits, le);
  }

  /* ------------------------------------------------------------------ opcodes (always big endian) */
  function opcodeList(list) {
    var parts = [new Uint8Array(4)]; new DataView(parts[0].buffer).setUint32(0, list.length);
    list.forEach(function (op) { var b = new Uint8Array(16 + op.params.length), dv = new DataView(b.buffer); dv.setUint32(0, op.id); dv.setUint32(4, 0x01030000); dv.setUint32(8, op.flags || 0); dv.setUint32(12, op.params.length); b.set(op.params, 16); parts.push(b); });
    var n = 0; parts.forEach(function (p) { n += p.length; }); var out = new Uint8Array(n), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out;
  }
  /* GainMap (id 9), one plane count `planes` applied to Bayer plane (0 = all) ; gains: Float32Array(rows*cols*mapPlanes) */
  function gainMapOp(o) {
    var mp = o.mapPlanes || 1, params = new Uint8Array(76 + 4 * o.rows * o.cols * mp), dv = new DataView(params.buffer);
    dv.setUint32(0, o.top || 0); dv.setUint32(4, o.left || 0); dv.setUint32(8, o.bottom); dv.setUint32(12, o.right);
    dv.setUint32(16, o.plane || 0); dv.setUint32(20, o.planes || 1); dv.setUint32(24, o.rowPitch || 1); dv.setUint32(28, o.colPitch || 1);
    dv.setUint32(32, o.rows); dv.setUint32(36, o.cols);
    dv.setFloat64(40, o.spacingV); dv.setFloat64(48, o.spacingH); dv.setFloat64(56, o.originV || 0); dv.setFloat64(64, o.originH || 0);
    dv.setUint32(72, mp);
    for (var i = 0; i < o.rows * o.cols * mp; i++) dv.setFloat32(76 + 4 * i, o.gains[i]);
    return { id: 9, params: params };
  }
  /* a vignette gain map that exactly undoes the radial falloff used in mosaic({ vignette }) , on a coarse grid */
  function vignetteGainMap(w, h, vig, rows, cols) {
    rows = rows || 9; cols = cols || 12; var g = new Float32Array(rows * cols);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var y = r / (rows - 1) * (h - 1), x = c / (cols - 1) * (w - 1), dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2); g[r * cols + c] = 1 / (1 - vig * (dx * dx + dy * dy) / 2); }
    return gainMapOp({ top: 0, left: 0, bottom: h, right: w, rows: rows, cols: cols, spacingV: 1 / (rows - 1), spacingH: 1 / (cols - 1), gains: g });
  }

  /* ------------------------------------------------------------------ the DNG writer */
  /* o: { width, height, mosaic: Uint16Array, pattern, bits, black, white, cam, compression: 'none'|'lj92'|'deflate', predictor, components,
   *      tile: [tw, th] | null, rowsPerStrip, le, layout: 'subifd'|'ifd0', preview: Uint8Array (JPEG)|null, orientation, activeArea, cropOrigin, cropSize,
   *      baselineExposure, linearization: Uint16Array|null, blackDeltaV/H, opcodes2: [ops], opcodes1, make, model, illuminants, noOpcodes, noForward, noColorMatrix2,
   *      linear: { rgb: Float32Array(w*h*3) camera-linear 0..1, bits: 16|32 } -> a LinearRaw (ProRAW-like) file instead of a CFA }
   */
  function writeDNG(o) {
    var le = o.le !== false, w = new Writer(le), W = o.width, H = o.height, bits = o.bits || 14, cam = o.cam || cameraFor();
    var layout = o.layout || 'subifd', comp = o.compression || 'none', linear = !!o.linear, spp = linear ? 3 : 1, i;
    var zlib = null; if (comp === 'deflate') zlib = require('zlib');
    w.header();
    // ---- data blocks
    var tw = o.tile ? o.tile[0] : W, th = o.tile ? o.tile[1] : (o.rowsPerStrip || H);
    var tilesX = o.tile ? Math.ceil(W / tw) : 1, tilesY = Math.ceil(H / th), offsets = [], counts = [];
    var samplesPerPixel = spp, fmtFloat = linear && o.linear.bits === 32, dataBits = linear ? o.linear.bits : bits;
    var src = linear ? null : o.mosaic, lin = linear ? o.linear.rgb : null;
    for (var ty = 0; ty < tilesY; ty++) for (var tx = 0; tx < tilesX; tx++) {
      var rows = o.tile ? th : Math.min(th, H - ty * th), cw = o.tile ? tw : W, x0 = tx * tw, y0 = ty * th;
      var nvals = rows * cw * samplesPerPixel, tile;
      if (!linear) { tile = new Uint16Array(nvals); for (var yy = 0; yy < rows; yy++) for (var xx = 0; xx < cw; xx++) { var sy = Math.min(y0 + yy, H - 1), sx = Math.min(x0 + xx, W - 1); tile[yy * cw + xx] = src[sy * W + sx]; } }
      else { tile = fmtFloat ? new Float32Array(nvals) : new Uint16Array(nvals); for (var yl = 0; yl < rows; yl++) for (var xl = 0; xl < cw; xl++) for (var cl = 0; cl < 3; cl++) { var sy2 = Math.min(y0 + yl, H - 1), sx2 = Math.min(x0 + xl, W - 1), vv = lin[(sy2 * W + sx2) * 3 + cl]; tile[(yl * cw + xl) * 3 + cl] = fmtFloat ? vv : Math.max(0, Math.min(65535, Math.round(vv * 65535))); } }
      var bytes;
      if (comp === 'lj92') { var comps = o.components || (linear ? 3 : 2); bytes = lj92Encode(tile, cw * samplesPerPixel, rows, comps, dataBits, o.predictor || 1, 0); }
      else if (comp === 'deflate') {
        var raw; if (fmtFloat) raw = new Uint8Array(tile.buffer, 0, tile.byteLength).slice(); else raw = sampleBytes(tile, dataBits, le);
        if (o.predictor === 2 && !fmtFloat) { var d2 = tile.slice(); for (var r2 = 0; r2 < rows; r2++) for (var x2 = cw * samplesPerPixel - 1; x2 >= samplesPerPixel; x2--) d2[r2 * cw * samplesPerPixel + x2] = (d2[r2 * cw * samplesPerPixel + x2] - d2[r2 * cw * samplesPerPixel + x2 - samplesPerPixel]) & ((1 << Math.min(dataBits, 16)) - 1); raw = sampleBytes(d2, dataBits, le); }
        if (fmtFloat && le) { /* little endian floats are already in host (LE) order */ }
        bytes = new Uint8Array(zlib.deflateSync(Buffer.from(raw)));
      } else {
        if (fmtFloat) { var fb = new Uint8Array(nvals * 4), fdv = new DataView(fb.buffer); for (i = 0; i < nvals; i++) fdv.setFloat32(i * 4, tile[i], le); bytes = fb; }
        else { // pack row by row so every row starts on a byte boundary (as DNG packs)
          var rowBytes = Math.ceil(cw * samplesPerPixel * dataBits / 8); bytes = new Uint8Array(rowBytes * rows);
          for (var rr = 0; rr < rows; rr++) bytes.set(sampleBytes(tile.subarray(rr * cw * samplesPerPixel, (rr + 1) * cw * samplesPerPixel), dataBits, le), rr * rowBytes);
        }
      }
      offsets.push(w.bytes(bytes)); counts.push(bytes.length);
    }
    // ---- raw IFD
    var rawE = [
      { tag: 254, type: 4, vals: [0] }, { tag: 256, type: 4, vals: [W] }, { tag: 257, type: 4, vals: [H] },
      { tag: 258, type: 3, vals: new Array(spp).fill(dataBits) },
      { tag: 259, type: 3, vals: [comp === 'lj92' ? 7 : comp === 'deflate' ? 8 : 1] },
      { tag: 262, type: 3, vals: [linear ? 34892 : 32803] },
      { tag: 277, type: 3, vals: [spp] }, { tag: 284, type: 3, vals: [1] }
    ];
    if (fmtFloat) rawE.push({ tag: 339, type: 3, vals: new Array(spp).fill(3) });
    if (comp === 'deflate' && o.predictor === 2) rawE.push({ tag: 317, type: 3, vals: [2] });
    if (o.tile) rawE.push({ tag: 322, type: 4, vals: [tw] }, { tag: 323, type: 4, vals: [th] }, { tag: 324, type: 4, vals: offsets }, { tag: 325, type: 4, vals: counts });
    else rawE.push({ tag: 273, type: 4, vals: offsets }, { tag: 278, type: 4, vals: [th] }, { tag: 279, type: 4, vals: counts });
    var blk = o.black == null ? 0 : o.black, blArr = Array.isArray(blk) ? blk : [blk, blk, blk, blk];
    var wl = o.white == null ? (linear ? (fmtFloat ? 1 : 65535) : (1 << bits) - 1) : o.white;
    var dngE = [
      { tag: 50706, type: 1, vals: [1, 4, 0, 0] }, { tag: 50707, type: 1, vals: [1, 1, 0, 0] },
      { tag: 50708, type: 2, vals: Array.from(o.model || 'LocalEditor Synthetic Camera') }, { tag: 50717, type: 4, vals: [wl] }
    ];
    if (!linear) {
      var pat = PATTERNS[o.pattern || 'RGGB'];
      rawE.push({ tag: 33421, type: 3, vals: [2, 2] }, { tag: 33422, type: 1, vals: pat });
      rawE.push({ tag: 50710, type: 1, vals: [0, 1, 2] }, { tag: 50711, type: 3, vals: [1] });
      if (blArr.some(function (b) { return b !== blArr[0]; }) || o.blackRepeat) { rawE.push({ tag: 50713, type: 3, vals: [2, 2] }, { tag: 50714, type: 3, vals: blArr }); } else rawE.push({ tag: 50714, type: 3, vals: [blArr[0]] });
      if (o.blackDeltaV) rawE.push({ tag: 50716, type: 10, vals: srationals(o.blackDeltaV) });
      if (o.blackDeltaH) rawE.push({ tag: 50715, type: 10, vals: srationals(o.blackDeltaH) });
      if (o.linearization) rawE.push({ tag: 50712, type: 3, vals: Array.from(o.linearization) });
    } else rawE.push({ tag: 50714, type: 3, vals: [0] });
    rawE.push({ tag: 50717, type: 4, vals: [wl] });
    if (fmtFloat) rawE.push({ tag: 50717, type: 4, vals: [1] });
    if (o.activeArea) rawE.push({ tag: 50829, type: 4, vals: o.activeArea });
    if (o.cropOrigin) rawE.push({ tag: 50719, type: 5, vals: [[o.cropOrigin[0], 1], [o.cropOrigin[1], 1]] });
    if (o.cropSize) rawE.push({ tag: 50720, type: 5, vals: [[o.cropSize[0], 1], [o.cropSize[1], 1]] });
    if (o.opcodes1) rawE.push({ tag: 51008, type: 7, raw: opcodeList(o.opcodes1), count: opcodeList(o.opcodes1).length });
    if (o.opcodes2) rawE.push({ tag: 51009, type: 7, raw: opcodeList(o.opcodes2), count: opcodeList(o.opcodes2).length });
    if (o.opcodes3) rawE.push({ tag: 51022, type: 7, raw: opcodeList(o.opcodes3), count: opcodeList(o.opcodes3).length });
    // fix duplicates: keep the last 50717
    var seen = {}; rawE = rawE.filter(function (e, idx) { for (var j = rawE.length - 1; j > idx; j--) if (rawE[j].tag === e.tag) return false; return true; });
    dngE = dngE.filter(function (e) { return e.tag !== 50717; });
    var colorE = [];
    if (!o.noColorMatrix) {
      colorE.push({ tag: 50778, type: 3, vals: [cam.illuminant1] }, { tag: 50779, type: 3, vals: [cam.illuminant2] });
      colorE.push({ tag: 50721, type: 10, vals: srationals(cam.colorMatrix1) });
      if (!o.noColorMatrix2) colorE.push({ tag: 50722, type: 10, vals: srationals(cam.colorMatrix2) });
      if (!o.noForward) { colorE.push({ tag: 50964, type: 10, vals: srationals(cam.forwardMatrix1) }); if (!o.noColorMatrix2) colorE.push({ tag: 50965, type: 10, vals: srationals(cam.forwardMatrix2) }); }
      if (o.asShotXY) colorE.push({ tag: 50729, type: 5, vals: [[Math.round(o.asShotXY[0] * 1e6), 1e6], [Math.round(o.asShotXY[1] * 1e6), 1e6]] });
      else colorE.push({ tag: 50728, type: 5, vals: (o.neutral || cam.asShotNeutral).map(function (v) { return [Math.round(v * 1e6), 1e6]; }) });
    }
    if (o.baselineExposure != null) colorE.push({ tag: 50730, type: 10, vals: [rational(o.baselineExposure)] });
    if (o.analogBalance) colorE.push({ tag: 50727, type: 5, vals: o.analogBalance.map(function (v) { return [Math.round(v * 1e6), 1e6]; }) });
    var exifE = [{ tag: 33434, type: 5, vals: [[1, 125]] }, { tag: 33437, type: 5, vals: [[28, 10]] }, { tag: 34855, type: 3, vals: [o.iso || 100] }];
    // ---- preview / thumbnail
    var previewOff = null; var previewE = null;
    if (o.preview) {
      var po = w.bytes(o.preview);
      previewE = [{ tag: 254, type: 4, vals: [1] }, { tag: 256, type: 4, vals: [o.previewWidth || 0] }, { tag: 257, type: 4, vals: [o.previewHeight || 0] }, { tag: 259, type: 3, vals: [7] }, { tag: 262, type: 3, vals: [6] }, { tag: 513, type: 4, vals: [po] }, { tag: 514, type: 4, vals: [o.preview.length] }];
    }
    var ifd0E = [{ tag: 271, type: 2, vals: Array.from(o.make || 'LocalEditor') }, { tag: 272, type: 2, vals: Array.from(o.model || 'Synthetic Camera') }, { tag: 274, type: 3, vals: [o.orientation || 1] }];
    var exifOff = writeIFD(w, exifE);
    ifd0E.push({ tag: 34665, type: 4, vals: [exifOff] });
    ifd0E = ifd0E.concat(dngE, colorE);
    var first;
    if (layout === 'subifd') {
      var subs = [];
      if (previewE) subs.push(writeIFD(w, previewE));
      subs.push(writeIFD(w, rawE));
      ifd0E.push({ tag: 330, type: 4, vals: subs });
      ifd0E.push({ tag: 254, type: 4, vals: [1] }, { tag: 256, type: 4, vals: [1] }, { tag: 257, type: 4, vals: [1] }, { tag: 258, type: 3, vals: [8, 8, 8] }, { tag: 259, type: 3, vals: [1] }, { tag: 262, type: 3, vals: [2] }, { tag: 277, type: 3, vals: [3] }, { tag: 273, type: 4, vals: [w.bytes(new Uint8Array([0, 0, 0]))] }, { tag: 278, type: 4, vals: [1] }, { tag: 279, type: 4, vals: [3] });
      first = writeIFD(w, ifd0E);
    } else {
      // raw lives in IFD0 (phone style)
      var all = ifd0E.concat(rawE.filter(function (e) { return e.tag !== 254; }));
      first = writeIFD(w, all);
    }
    w.setFirstIFD(first);
    return w.finish();
  }

  /* ------------------------------------------------------------------ convenience */
  function toBlob(u8) { return typeof Blob !== 'undefined' ? new Blob([u8], { type: 'image/x-adobe-dng' }) : null; }

  return {
    writeDNG: writeDNG, scene: scene, mosaic: mosaic, cameraFor: cameraFor, srgbToCamera: srgbToCamera, lj92Encode: lj92Encode, gainMapOp: gainMapOp, vignetteGainMap: vignetteGainMap,
    PATTERNS: PATTERNS, CHART: CHART, chartLinear: chartLinear, mulberry32: mulberry32, gauss: gauss, blur: blur, bradford: bradford, inv3: inv3, mul3: mul3, mulv: mulv,
    M_SRGB2XYZ_D65: M_SRGB2XYZ_D65, D50: D50, D65: D65, l2s: l2s, s2l: s2l, toBlob: toBlob
  };
});
