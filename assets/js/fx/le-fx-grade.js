/* LocalEditor effect renderer, colour grading pack (Expert step X1). See docs/FX-AUTHORING.md and docs/FX-REFERENCE.md.
 *
 * Every effect here is a per-pixel colour operation: it calls g.color() only, so a whole grade (with the starter effects) fuses into
 * ONE shader pass. Lookup tables (curves, hue tables, gradient maps, LUTs) are small textures built on the CPU from the parameters.
 * Each effect also has a CPU reference (G.ref[id](p) → function (rgb) → rgb, in the effect's own space) that mirrors the shader line
 * for line; tests compare the two, and the .cube export bakes a stack through them.
 *
 * Colour models used (documented per effect below):
 *   - OKLab / OKLCh (Björn Ottosson, 2020) on linear sRGB for hue, chroma and lightness changes that should look even across hues.
 *   - HSV hue (red 0°, yellow 60°, green 120° …) to decide *which* colours a hue band or hue curve touches: the same hue wheel the
 *     workspace's band grid and curve gradients draw, and the one photographers know.
 *   - BT.601 YCbCr on display values for skin tones: the vectorscope of LE.fx.analyze and the workspace, skin-tone line at 123°.
 *   - CIE 1960 uv, Krystek's Planckian locus, Bradford / CAT16 / von Kries chromatic adaptation for Kelvin white balance.
 *   - ASC CDL v1.2 for slope/offset/power/saturation; the GIMP colour-balance transfer model; the commonly published per-hue
 *     "min + (mid−min)·secondary + (max−mid)·primary" black-and-white mix.
 * No third-party code or LUT files: every look is generated from these effects.
 */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;
  var M = FX.math;
  var G = FX.grade = FX.grade || {};
  var REF = G.ref = {};            /* id → function (p) → function (rgb) → rgb, in the effect's space */
  var GPU = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 40 };

  /* ===================================================================================================================
     Shared maths (JS). Each function has a GLSL twin in the strings below; keep them in step.
     =================================================================================================================== */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function mix(a, b, t) { return a + (b - a) * t; }
  var lin1 = M.srgbToLinear, dsp1 = M.linearToSrgb;
  function toLin(c) { return [lin1(c[0]), lin1(c[1]), lin1(c[2])]; }
  function toDsp(c) { return [dsp1(c[0]), dsp1(c[1]), dsp1(c[2])]; }
  function luma(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function cbrt(x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3); }
  function oklab(c) {
    var l = cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    var m = cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    var s = cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function oklabInv(L) {
    var l = L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], m = L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], s = L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  /* HSV hue in degrees (0 for greys). */
  function hueOf(c) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn, h;
    if (d < 1e-6) return 0;
    if (mx === c[0]) h = (((c[1] - c[2]) / d) % 6 + 6) % 6; else if (mx === c[1]) h = (c[2] - c[0]) / d + 2; else h = (c[0] - c[1]) / d + 4;
    return h * 60;
  }
  /* Chroma compression towards a grey of the same lightness, so no channel goes below min(0, its input): hue and lightness are kept
     instead of being clipped into a different colour. g = the grey's value in the same space. */
  function gamut(c, g, base) {
    var t = 1;
    for (var k = 0; k < 3; k++) { var lo = Math.min(0, base[k]); if (c[k] < lo) t = Math.min(t, (g - lo) / Math.max(g - c[k], 1e-6)); }
    t = clamp(t, 0, 1);
    return [g + (c[0] - g) * t, g + (c[1] - g) * t, g + (c[2] - g) * t];
  }
  /* A hue (degrees, HSL wheel as the workspace draws it) as a luminance-free direction in display RGB, largest component 1. */
  function hueDir(h) {
    var c = hsl2rgb(h, 1, 0.5), y = luma(c), d = [c[0] - y, c[1] - y, c[2] - y], m = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])) || 1;
    return [d[0] / m, d[1] / m, d[2] / m];
  }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = l - C / 2, r, g, b;
    if (h < 60) { r = C; g = X; b = 0; } else if (h < 120) { r = X; g = C; b = 0; } else if (h < 180) { r = 0; g = C; b = X; }
    else if (h < 240) { r = 0; g = X; b = C; } else if (h < 300) { r = X; g = 0; b = C; } else { r = C; g = 0; b = X; }
    return [r + m, g + m, b + m];
  }
  function rgb2hsl(c) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-6) return [0, 0, l];
    return [hueOf(c), d / Math.max(1e-6, 1 - Math.abs(2 * l - 1)), l];
  }
  /* Linear interpolation in a table of n entries × ch channels over x in 0–1: what a LINEAR-filtered texture returns. */
  function tab(t, ch, x, k) {
    var n = t.length / ch, p = clamp(x, 0, 1) * (n - 1), i = Math.floor(p), f = p - i, j = Math.min(i + 1, n - 1);
    return t[i * ch + k] * (1 - f) + t[j * ch + k] * f;
  }
  function mat3mul(a, b) {
    var o = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    return o;
  }
  function mat3vec(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  var inv3 = FX.quad.invert;
  function flatCurve(cv, y) { return !cv || !cv.master || cv.master.every(function (q) { return Math.abs(q[1] - y) < 1e-6; }); }
  function idCurve(pts) { return LE.curves.isIdentity(pts); }
  function zeroWheel(w) { return !w || (!(w.a > 0) && !w.l); }
  var BAND_NAMES = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
  var BAND_HUES = [0, 30, 60, 120, 180, 240, 270, 300];

  /* GLSL twins. `$` is replaced per entry by the renderer. */
  var GL = {
    hue: 'float $hue(vec3 c){ float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn; if (d < 1e-6) return 0.0; float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : (mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0); return h * 60.0; }\n',
    lab: 'float $cbrt(float x){ return sign(x) * pow(abs(x), 1.0 / 3.0); }\n' +
      'vec3 $lab(vec3 c){ float l = $cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b); float m = $cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b); float s = $cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);\n' +
      '  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s); }\n' +
      'vec3 $rgb(vec3 L){ float l = L.x + 0.3963377774 * L.y + 0.2158037573 * L.z, m = L.x - 0.1055613458 * L.y - 0.0638541728 * L.z, s = L.x - 0.0894841775 * L.y - 1.2914855480 * L.z; l = l * l * l; m = m * m * m; s = s * s * s;\n' +
      '  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s); }\n',
    gamut: 'vec3 $gamut(vec3 c, float g, vec3 base){ vec3 lo = min(vec3(0.0), base); float t = 1.0; for (int k = 0; k < 3; k++) { if (c[k] < lo[k]) t = min(t, (g - lo[k]) / max(g - c[k], 1e-6)); } t = clamp(t, 0.0, 1.0); return g + (c - g) * t; }\n'
  };

  function reg(def) {
    def.support = def.support || GPU;
    FX.register(def);
    if (def.ref) REF[def.id] = def.ref;
  }

  /* ===================================================================================================================
     CURVES
     =================================================================================================================== */
  /* Parametric tone regions (highlights, lights, darks, shadows with three split points), the familiar "region" curve.
     Each region lifts or lowers a sin² bump over its zone widened by half its width on each side, amplitude 0.3 × the window,
     so a single slider can never fold the curve (largest slope change 0.3·π < 1); combinations are kept monotone by a running
     maximum. The ends stay at 0 and 1. */
  G.paramCurve = function (p, n) {
    n = n || 1024;
    var s1 = clamp(p.split1, 0.05, 0.9), s2 = Math.max(clamp(p.split2, 0.1, 0.95), s1 + 0.02), s3 = Math.max(clamp(p.split3, 0.15, 0.98), s2 + 0.02);
    var zones = [[0, s1, p.shadows || 0], [s1, s2, p.darks || 0], [s2, s3, p.lights || 0], [s3, 1, p.highlights || 0]].map(function (z) {
      var w = z[1] - z[0], a = Math.max(0, z[0] - 0.5 * w), b = Math.min(1, z[1] + 0.5 * w);
      return { a: a, b: b, k: z[2] / 100 * 0.3 * (b - a) };
    });
    var out = new Float32Array(n), i;
    for (i = 0; i < n; i++) {
      var x = i / (n - 1), y = x;
      zones.forEach(function (z) { if (z.k && x > z.a && x < z.b) { var s = Math.sin(Math.PI * (x - z.a) / (z.b - z.a)); y += z.k * s * s; } });
      out[i] = clamp(y, 0, 1);
    }
    for (i = 1; i < n; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
    return out;
  };
  function toneTables(p) {
    var n = 1024, fp = G.paramCurve(p, n), C = LE.curves, fm = C.monotone(p.curve.master);
    var fc = ['r', 'g', 'b'].map(function (k) { return C.isIdentity(p.curve[k]) ? null : C.monotone(p.curve[k]); });
    var t1 = new Float32Array(n * 3), ta = new Float32Array(n), t2 = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1), y = tab(fp, 1, x, 0);
      for (var k = 0; k < 3; k++) { t1[i * 3 + k] = fm(fc[k] ? fc[k](y) : y); t2[i * 3 + k] = fc[k] ? fc[k](x) : x; }
      ta[i] = fm(y);
    }
    return { t1: t1, ta: ta, t2: t2, chan: fc.some(Boolean) };
  }
  function toneNeutral(p) { return !p.highlights && !p.lights && !p.darks && !p.shadows && ['master', 'r', 'g', 'b'].every(function (k) { return idCurve(p.curve[k]); }); }
  reg({
    id: 'tone-curve', name: 'Tone curve', group: 'curves', version: 1, space: 'display',
    params: {
      curve: { type: 'curve', label: 'Point curve' },
      highlights: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Highlights' },
      lights: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Lights' },
      darks: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Darks' },
      shadows: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Shadows' },
      split1: { type: 'number', min: 0.05, max: 0.5, default: 0.25, step: 0.01, label: 'Shadows split' },
      split2: { type: 'number', min: 0.2, max: 0.8, default: 0.5, step: 0.01, label: 'Mid-tone split' },
      split3: { type: 'number', min: 0.5, max: 0.95, default: 0.75, step: 0.01, label: 'Highlights split' },
      mode: { type: 'choice', options: [{ value: 'rgb', label: 'RGB' }, { value: 'luminosity', label: 'Luminosity' }], default: 'rgb', label: 'Apply to' }
    },
    passes: function (g, p) {
      if (toneNeutral(p)) return;
      var t = toneTables(p), lum = p.mode === 'luminosity';
      g.color('uniform sampler2D $t, $c; uniform vec2 $m;\n' +
        'vec3 $fx(vec3 c){ if ($m.x < 0.5) return lut1rgb($t, c);\n' +
        '  float l = clamp(luma(c), 0.0, 1.0); float t = lut1($t, l); vec3 o = mix(c + (t - l), c * (t / max(l, 1e-4)), smoothstep(0.02, 0.3, l));\n' +
        '  return $m.y > 0.5 ? lut1rgb($c, o) : o; }',
      { t: lum ? g.lut1d(t.ta, 1) : g.lut1d(t.t1, 3), c: g.lut1d(lum && t.chan ? t.t2 : t.t1, 3), m: [lum ? 1 : 0, t.chan ? 1 : 0] });
    },
    ref: function (p) {
      if (toneNeutral(p)) return null;
      var t = toneTables(p), lum = p.mode === 'luminosity';
      return function (c) {
        if (!lum) return [tab(t.t1, 3, c[0], 0), tab(t.t1, 3, c[1], 1), tab(t.t1, 3, c[2], 2)];
        var l = clamp(luma(c), 0, 1), v = tab(t.ta, 1, l, 0), w = sstep(0.02, 0.3, l), k = v / Math.max(l, 1e-4);
        var o = [0, 1, 2].map(function (i) { return mix(c[i] + (v - l), c[i] * k, w); });
        return t.chan ? [tab(t.t2, 3, o[0], 0), tab(t.t2, 3, o[1], 1), tab(t.t2, 3, o[2], 2)] : o;
      };
    },
    ui: { section: 'Curves', order: 20, controls: ['curve', { heading: 'Region' }, 'highlights', 'lights', 'darks', 'shadows', { heading: 'Splits' }, { param: 'split1', fine: true }, { param: 'split2', fine: true }, { param: 'split3', fine: true }, 'mode'] },
    agent: {
      summary: 'Pro tone curve: four region sliders (highlights, lights, darks, shadows) with movable splits, then a point curve with R/G/B channels. "Luminosity" applies the master and region curve to luminance only, so contrast does not shift hue or saturation. Display-referred 0–1. Extends the starter "curves".',
      tips: ['Gentle contrast: lights 15, darks -15.', 'Filmic fade: curve.master [[0,0.06],[0.25,0.22],[0.75,0.8],[1,0.95]], mode "luminosity".', 'Recover highlights: highlights -40, split3 0.8.', 'Cross-process channels: curve.r [[0,0],[0.25,0.2],[0.75,0.82],[1,1]], curve.b [[0,0.1],[1,0.9]].', 'Use luminosity for strong S curves on portraits so skin does not oversaturate.'],
      example: { type: 'tone-curve', p: { lights: 12, darks: -14, curve: { master: [[0, 0.03], [0.5, 0.5], [1, 0.97]] }, mode: 'luminosity' } }
    }
  });

  /* Hue and luminance curves (hue vs hue, hue vs saturation, hue vs luminance, luminance vs saturation, saturation vs saturation).
     x of the hue curves is the HSV hue / 360 (red at both ends); y = 0.5 is "no change". Changes are made in OKLCh: hue vs hue turns
     the hue by (y − 0.5) × 180° (±90°), hue vs sat and the two sat curves multiply chroma by 2y, hue vs lum raises OKLab L to the
     power 2^(−2(y − 0.5)), each weighted by how colourful the pixel is so greys never pick up a colour. */
  function hueEngine(g, tA, tB, useB, lumK) {
    g.color(GL.hue + GL.lab + GL.gamut + 'uniform sampler2D $t, $u; uniform vec2 $k;\n' +
      'vec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); float d = max(x.r, max(x.g, x.b)) - min(x.r, min(x.g, x.b)); if (d < 1e-5 && $k.x < 0.5) return c;\n' +
      '  float q = smoothstep(0.0, 0.12, d); vec3 a = lut1rgb($t, vec3($hue(x) / 360.0)); vec3 li = toLinear(c); vec3 L = $lab(li);\n' +
      '  float C = length(L.yz), ang = atan(L.z, L.y), sf = a.g;\n' +
      '  if ($k.x > 0.5) { sf *= lut1rgb($u, vec3(clamp(luma(c), 0.0, 1.0))).r * lut1rgb($u, vec3(clamp(C / 0.32, 0.0, 1.0))).g; }\n' +
      '  ang += a.r * 3.14159265 * q; C *= max(sf, 0.0); float Lp = pow(max(L.x, 0.0), exp2(-a.b * $k.y * q));\n' +
      '  vec3 o = $rgb(vec3(Lp, C * cos(ang), C * sin(ang))); o = $gamut(o, Lp * Lp * Lp, li); return toDisplay(o); }',
    { t: tA, u: tB || tA, k: [useB ? 1 : 0, lumK] });
  }
  function hueEngineRef(tA, tB, useB, lumK) {
    return function (c) {
      var x = [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)], d = Math.max(x[0], x[1], x[2]) - Math.min(x[0], x[1], x[2]);
      if (d < 1e-5 && !useB) return c.slice();
      var q = sstep(0, 0.12, d), hx = hueOf(x) / 360, li = toLin(c), L = oklab(li);
      var C = Math.hypot(L[1], L[2]), ang = Math.atan2(L[2], L[1]), sf = tab(tA, 3, hx, 1);
      if (useB) sf *= tab(tB, 3, clamp(luma(c), 0, 1), 0) * tab(tB, 3, clamp(C / 0.32, 0, 1), 1);
      ang += tab(tA, 3, hx, 0) * Math.PI * q; C *= Math.max(sf, 0);
      var Lp = Math.pow(Math.max(L[0], 0), Math.pow(2, -tab(tA, 3, hx, 2) * lumK * q));
      var o = oklabInv([Lp, C * Math.cos(ang), C * Math.sin(ang)]);
      return toDsp(gamut(o, Lp * Lp * Lp, li));
    };
  }
  var FLAT = { master: [[0, 0.5], [1, 0.5]] };
  function hueCurveTables(p) {
    var n = 361, C = LE.curves, f = ['hueHue', 'hueSat', 'hueLum'].map(function (k) { return C.monotone(p[k].master); });
    var fl = C.monotone(p.lumSat.master), fs = C.monotone(p.satSat.master), a = new Float32Array(n * 3), b = new Float32Array(256 * 3);
    for (var i = 0; i < n; i++) { var x = i / (n - 1); a[i * 3] = (f[0](x) - 0.5); a[i * 3 + 1] = 2 * f[1](x); a[i * 3 + 2] = 2 * (f[2](x) - 0.5); }
    for (var j = 0; j < 256; j++) { var y = j / 255; b[j * 3] = 2 * fl(y); b[j * 3 + 1] = 2 * fs(y); b[j * 3 + 2] = 0; }
    return { a: a, b: b, useB: !flatCurve(p.lumSat, 0.5) || !flatCurve(p.satSat, 0.5) };
  }
  function hueCurvesNeutral(p) { return ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'].every(function (k) { return flatCurve(p[k], 0.5); }); }
  reg({
    id: 'hue-curves', name: 'Hue curves', group: 'curves', version: 1, space: 'display',
    params: {
      hueHue: { type: 'curve', default: FLAT, label: 'Hue vs hue' },
      hueSat: { type: 'curve', default: FLAT, label: 'Hue vs saturation' },
      hueLum: { type: 'curve', default: FLAT, label: 'Hue vs luminance' },
      lumSat: { type: 'curve', default: FLAT, label: 'Luminance vs saturation' },
      satSat: { type: 'curve', default: FLAT, label: 'Saturation vs saturation' }
    },
    passes: function (g, p) {
      if (hueCurvesNeutral(p)) return;
      var t = hueCurveTables(p);
      hueEngine(g, g.lut1d(t.a, 3), t.useB ? g.lut1d(t.b, 3) : null, t.useB, 1);
    },
    ref: function (p) { if (hueCurvesNeutral(p)) return null; var t = hueCurveTables(p); return hueEngineRef(t.a, t.b, t.useB, 1); },
    ui: { section: 'Curves', order: 30, controls: ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'] },
    agent: {
      summary: 'Secondary-grading curves, master channel only, y = 0.5 means no change. x of the hue curves is the hue (0 red, 0.167 yellow, 0.333 green, 0.5 cyan, 0.667 blue, 0.833 magenta, 1 red). Hue vs hue turns hues by (y−0.5)×180°; the saturation curves multiply chroma by 2y; hue vs luminance brightens (y > 0.5) or darkens that hue. Greys are never tinted.',
      tips: ['Keep the first and last points of a hue curve at the same height (red wraps around).', 'Teal sky without touching skin: hueHue [[0,0.5],[0.5,0.5],[0.6,0.46],[0.7,0.5],[1,0.5]].', 'Darken blue sky: hueLum [[0,0.5],[0.55,0.5],[0.64,0.36],[0.72,0.5],[1,0.5]].', 'Desaturate shadows (filmic): lumSat [[0,0.3],[0.3,0.5],[1,0.5]].', 'Tame over-saturated colours only: satSat [[0,0.5],[0.6,0.5],[1,0.38]].'],
      example: { type: 'hue-curves', p: { hueLum: { master: [[0, 0.5], [0.55, 0.5], [0.64, 0.38], [0.72, 0.5], [1, 0.5]] }, lumSat: { master: [[0, 0.32], [0.3, 0.5], [1, 0.5]] } } }
    }
  });

  /* ===================================================================================================================
     COLOUR MIXER
     =================================================================================================================== */
  /* Band weights of a hue (degrees): the two neighbouring band centres share the hue with a smoothstep crossfade (flat at the band's
     own centre, smooth between), so dragging one band never creates an edge. Used by the shader table and by the targeted-adjustment
     seam below. */
  G.bandWeights = function (hue) {
    hue = ((hue % 360) + 360) % 360;
    var w = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 8; i++) {
      var a = BAND_HUES[i], b = i === 7 ? 360 : BAND_HUES[i + 1];
      if (hue >= a && hue < b) { var s = sstep(0, 1, (hue - a) / (b - a)); w[i] = 1 - s; w[(i + 1) % 8] += s; break; }
    }
    return w;
  };
  /* Targeted adjustment: given a picked colour (display RGB 0–1 or '#rrggbb'), which bands move and by how much. Returns
     { hue, chroma, weights: { red: … }, bands: [8 weights], apply(bands, prop, delta) → new bands }. The workspace's band grid can
     call this instead of its own linear weights; an agent can use it to edit "the colour of this pixel". */
  G.targetBands = function (rgb) {
    var c = typeof rgb === 'string' ? (M.parseColor(rgb) || [0, 0, 0]).slice(0, 3) : rgb.slice(0, 3);
    var x = [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)], d = Math.max(x[0], x[1], x[2]) - Math.min(x[0], x[1], x[2]);
    var q = sstep(0, 0.12, d), w = G.bandWeights(hueOf(x)).map(function (v) { return v * q; }), named = {};
    BAND_NAMES.forEach(function (n, i) { named[n] = Math.round(w[i] * 1000) / 1000; });
    return {
      hue: Math.round(hueOf(x) * 10) / 10, chroma: Math.round(d * 1000) / 1000, bands: w, weights: named,
      apply: function (bands, prop, delta) {
        return (bands || BAND_NAMES.map(function () { return { h: 0, s: 0, l: 0 }; })).map(function (b, i) {
          var o = { h: b.h, s: b.s, l: b.l }; o[prop] = clamp(Math.round(o[prop] + delta * w[i]), -100, 100); return o;
        });
      }
    };
  };
  function mixerTable(bands) {
    var n = 361, t = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var w = G.bandWeights(i), dh = 0, ds = 0, dl = 0;
      for (var k = 0; k < 8; k++) { dh += w[k] * bands[k].h; ds += w[k] * bands[k].s; dl += w[k] * bands[k].l; }
      t[i * 3] = dh / 100 * (30 / 180); t[i * 3 + 1] = 1 + ds / 100; t[i * 3 + 2] = dl / 100;
    }
    return t;
  }
  function mixerNeutral(p) { return p.mixer.every(function (b) { return !b.h && !b.s && !b.l; }); }
  reg({
    id: 'hsl', name: 'Colour mixer', group: 'color', version: 1, space: 'display',
    params: { mixer: { type: 'bands', min: -100, max: 100, label: 'Hue, saturation, luminance' } },
    passes: function (g, p) { if (mixerNeutral(p)) return; hueEngine(g, g.lut1d(mixerTable(p.mixer), 3), null, false, 0.9); },
    ref: function (p) { if (mixerNeutral(p)) return null; return hueEngineRef(mixerTable(p.mixer), null, false, 0.9); },
    ui: { section: 'Colour mixer', order: 10, controls: ['mixer'] },
    agent: {
      summary: 'HSL colour mixer: 8 bands (red, orange, yellow, green, aqua, blue, purple, magenta) × hue / saturation / luminance, −100…100. Band membership by hue with smooth crossfades; changes in OKLCh so luminance moves look even and hue shifts keep lightness. Hue ±100 turns a band ±30° towards its neighbours. Neutral greys never change.',
      tips: ['Value: 8 objects { h, s, l } in the order above; LE.fx.grade.targetBands(rgb) tells which bands a picked colour belongs to.', 'Teal and orange: orange s +15, aqua h -20 s +20, blue h -30 s -10.', 'Clean product white: all bands s -10 to remove colour casts in near-whites, yellow l +10.', 'Moody greens: green h +25 s -40 l -20, yellow h -20 s -25.', 'Portrait skin: orange s -10 l +10, red s -8; never push orange saturation past +20.', 'Darken a blue sky: blue l -30 s +10, aqua l -15.'],
      example: { type: 'hsl', p: { mixer: [{ h: 0, s: -5, l: 0 }, { h: 0, s: 12, l: 6 }, { h: -10, s: -15, l: 0 }, { h: 20, s: -35, l: -15 }, { h: -15, s: 15, l: -5 }, { h: -20, s: 5, l: -20 }, { h: 0, s: 0, l: 0 }, { h: 0, s: 0, l: 0 }] } }
    }
  });

  /* Black & white mix (the widely published per-hue luminance model): grey = min + (mid − min)·w(secondary) + (max − mid)·w(primary),
     where the primary is the hue of the largest channel (red, green, blue) and the secondary the hue of the two largest (yellow,
     cyan, magenta). Weights are percent (defaults 40 / 60 / 40 / 60 / 20 / 80, a natural panchromatic look). The tint adds a
     luminance-free colour direction scaled by 1 − |2·grey − 1|, so black and white stay neutral (a classic split-free toning). */
  reg({
    id: 'bw-mix', name: 'Black & white', group: 'color', version: 1, space: 'display',
    params: {
      convert: { type: 'bool', default: false, label: 'Black & white' },
      reds: { type: 'number', min: -200, max: 300, default: 40, step: 1, unit: '%', label: 'Reds' },
      yellows: { type: 'number', min: -200, max: 300, default: 60, step: 1, unit: '%', label: 'Yellows' },
      greens: { type: 'number', min: -200, max: 300, default: 40, step: 1, unit: '%', label: 'Greens' },
      cyans: { type: 'number', min: -200, max: 300, default: 60, step: 1, unit: '%', label: 'Cyans' },
      blues: { type: 'number', min: -200, max: 300, default: 20, step: 1, unit: '%', label: 'Blues' },
      magentas: { type: 'number', min: -200, max: 300, default: 80, step: 1, unit: '%', label: 'Magentas' },
      tintHue: { type: 'number', min: 0, max: 360, default: 35, step: 1, unit: 'deg', label: 'Tint hue', ui: { gradient: 'hue' } },
      tint: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Tint amount' }
    },
    passes: function (g, p) {
      if (!p.convert) return;
      var d = hueDir(p.tintHue), k = p.tint / 100 * 0.25;
      g.color('uniform vec3 $p, $q, $t;\nvec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); float mx = max(x.r, max(x.g, x.b)), mn = min(x.r, min(x.g, x.b)), md = x.r + x.g + x.b - mx - mn;\n' +
        '  float wp = x.r >= x.g && x.r >= x.b ? $p.x : (x.g >= x.b ? $p.y : $p.z); float ws = x.b <= x.r && x.b <= x.g ? $q.x : (x.r <= x.g ? $q.y : $q.z);\n' +
        '  float y = mn + (md - mn) * ws + (mx - md) * wp; return vec3(y) + $t * (1.0 - abs(2.0 * clamp(y, 0.0, 1.0) - 1.0)); }',
      { p: [p.reds / 100, p.greens / 100, p.blues / 100], q: [p.yellows / 100, p.cyans / 100, p.magentas / 100], t: [d[0] * k, d[1] * k, d[2] * k] });
    },
    ref: function (p) {
      if (!p.convert) return null;
      var d = hueDir(p.tintHue), k = p.tint / 100 * 0.25;
      return function (c) {
        var x = c.map(function (v) { return clamp(v, 0, 1); }), mx = Math.max(x[0], x[1], x[2]), mn = Math.min(x[0], x[1], x[2]), md = x[0] + x[1] + x[2] - mx - mn;
        var wp = x[0] >= x[1] && x[0] >= x[2] ? p.reds : x[1] >= x[2] ? p.greens : p.blues, ws = x[2] <= x[0] && x[2] <= x[1] ? p.yellows : x[0] <= x[1] ? p.cyans : p.magentas;
        var y = mn + (md - mn) * ws / 100 + (mx - md) * wp / 100, f = 1 - Math.abs(2 * clamp(y, 0, 1) - 1);
        return [y + d[0] * k * f, y + d[1] * k * f, y + d[2] * k * f];
      };
    },
    ui: { section: 'Colour mixer', order: 40, controls: ['convert', { heading: 'Mix' }, 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', { heading: 'Tint' }, 'tintHue', 'tint'] },
    agent: {
      summary: 'Black-and-white conversion with per-colour brightness (percent of each colour family that becomes grey) and an optional tint. Nothing happens until convert is true.',
      tips: ['Dramatic sky (red-filter look): reds 110, yellows 90, blues -20, cyans -10.', 'Glowing portrait skin: reds 80, yellows 70, greens 30.', 'Infrared-like foliage: greens 200, yellows 160, blues -50.', 'Selenium tone: tintHue 330, tint 12; sepia: tintHue 35, tint 25.', 'Add a tone-curve after it for contrast; grain from the effects pack finishes a silver look.'],
      example: { type: 'bw-mix', p: { convert: true, reds: 90, yellows: 80, greens: 35, cyans: 40, blues: -10, magentas: 60, tintHue: 35, tint: 12 } }
    }
  });

  /* Selective colour, the CMYK-style per-family control. Families are weighted the published way: the primary (red/green/blue, the
     largest channel) by max − mid, the secondary (yellow/cyan/magenta, the two largest) by mid − min; whites by 2·(min − ½), blacks by
     2·(½ − max), neutrals by 1 − (|max − ½| + |min − ½|). In ink terms (C = 1 − R, M = 1 − G, Y = 1 − B): relative changes an ink by a
     fraction of what is there (pure white cannot be tinted), absolute adds it outright; black adds (+) or removes (−) all three inks
     towards 1 or 0. Out-of-range input headroom is carried through untouched. */
  function selFamily(ink, a, w, rel) {
    if (!(w > 0)) return ink;
    var o = [0, 1, 2].map(function (k) { return clamp(ink[k] + a[k] * w * (rel ? ink[k] : 1), 0, 1); }), kw = a[3] * w;
    return o.map(function (v) { return kw > 0 ? v + (1 - v) * kw : v * (1 + kw); });
  }
  var SEL_GL = 'vec3 $adj(vec3 ink, vec4 a, float w, float rel){ if (w <= 0.0) return ink; vec3 o = clamp(ink + a.xyz * w * mix(vec3(1.0), ink, rel), 0.0, 1.0); float kw = a.w * w; return kw > 0.0 ? o + (1.0 - o) * kw : o * (1.0 + kw); }\n';
  var FAM = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'], TONES = ['whites', 'neutrals', 'blacks'], INKS = [['C', 'Cyan'], ['M', 'Magenta'], ['Y', 'Yellow'], ['K', 'Black']];
  function inkParams(fams) {
    var o = {};
    fams.forEach(function (f) { INKS.forEach(function (k) { o[f + k[0]] = { type: 'number', min: -100, max: 100, default: 0, step: 1, unit: '%', label: k[1] }; }); });
    return o;
  }
  function inkUi(fams) {
    var out = [];
    fams.forEach(function (f) { out.push({ heading: f.charAt(0).toUpperCase() + f.slice(1) }); INKS.forEach(function (k) { out.push({ param: f + k[0], label: k[1] }); }); });
    return out;
  }
  function inkVec(p, f) { return INKS.map(function (k) { return p[f + k[0]] / 100; }); }
  function inkZero(p, fams) { return fams.every(function (f) { return INKS.every(function (k) { return !p[f + k[0]]; }); }); }
  reg({
    id: 'selective-color', name: 'Selective colour', group: 'color', version: 1, space: 'display',
    params: inkParams(FAM),
    passes: function (g, p) {
      if (inkZero(p, FAM)) return;
      var u = {}; FAM.forEach(function (f, i) { u['f' + i] = inkVec(p, f); });
      g.color(SEL_GL + 'uniform vec4 $f0, $f1, $f2, $f3, $f4, $f5;\nvec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); float mx = max(x.r, max(x.g, x.b)), mn = min(x.r, min(x.g, x.b)), md = x.r + x.g + x.b - mx - mn;\n' +
        '  vec4 P = x.r >= x.g && x.r >= x.b ? $f0 : (x.g >= x.b ? $f2 : $f4); vec4 S = x.b <= x.r && x.b <= x.g ? $f1 : (x.r <= x.g ? $f3 : $f5);\n' +
        '  vec3 ink = $adj($adj(1.0 - x, P, mx - md, 1.0), S, md - mn, 1.0); return 1.0 - ink + (c - x); }', u);
    },
    ref: function (p) {
      if (inkZero(p, FAM)) return null;
      var v = FAM.map(function (f) { return inkVec(p, f); });
      return function (c) {
        var x = c.map(function (q) { return clamp(q, 0, 1); }), mx = Math.max(x[0], x[1], x[2]), mn = Math.min(x[0], x[1], x[2]), md = x[0] + x[1] + x[2] - mx - mn;
        var P = x[0] >= x[1] && x[0] >= x[2] ? v[0] : x[1] >= x[2] ? v[2] : v[4], S = x[2] <= x[0] && x[2] <= x[1] ? v[1] : x[0] <= x[1] ? v[3] : v[5];
        var ink = selFamily(selFamily([1 - x[0], 1 - x[1], 1 - x[2]], P, mx - md, true), S, md - mn, true);
        return [0, 1, 2].map(function (k) { return 1 - ink[k] + (c[k] - x[k]); });
      };
    },
    ui: { section: 'Colour mixer', order: 30, controls: inkUi(FAM) },
    agent: {
      summary: 'Selective colour for the six colour families (reds, yellows, greens, cyans, blues, magentas): add or remove cyan, magenta, yellow and black ink, −100…100 %, relative to the ink already there (the usual default method). Params are <family><C|M|Y|K>, e.g. redsC. Whites, neutrals and blacks are the companion effect "selective-color-tones".',
      tips: ['Warmer, cleaner skin: redsC -15, redsY +8, yellowsC -10, yellowsK -5.', 'Teal and orange: yellowsC -10, yellowsM +5, cyansC +20, bluesY -15.', 'Deeper sky: cyansK +15, bluesK +20, bluesC +10.', 'Richer greens without neon: greensC +10, greensM +10, greensK +10.', 'Because it is relative, a pure white or black does not change here; use selective-color-tones with method "absolute" for that.'],
      example: { type: 'selective-color', p: { redsC: -15, redsY: 8, yellowsC: -10, cyansC: 20, bluesK: 15 } }
    }
  });
  var tonesParams = inkParams(TONES);
  tonesParams.method = { type: 'choice', options: [{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }], default: 'relative', label: 'Method' };
  reg({
    id: 'selective-color-tones', name: 'Selective colour (whites, neutrals, blacks)', group: 'color', version: 1, space: 'display',
    params: tonesParams,
    passes: function (g, p) {
      if (inkZero(p, TONES)) return;
      g.color(SEL_GL + 'uniform vec4 $w, $n, $b; uniform float $r;\nvec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); float mx = max(x.r, max(x.g, x.b)), mn = min(x.r, min(x.g, x.b));\n' +
        '  vec3 ink = 1.0 - x; ink = $adj(ink, $w, clamp((mn - 0.5) * 2.0, 0.0, 1.0), $r); ink = $adj(ink, $n, clamp(1.0 - (abs(mx - 0.5) + abs(mn - 0.5)), 0.0, 1.0), $r); ink = $adj(ink, $b, clamp((0.5 - mx) * 2.0, 0.0, 1.0), $r);\n' +
        '  return 1.0 - ink + (c - x); }', { w: inkVec(p, 'whites'), n: inkVec(p, 'neutrals'), b: inkVec(p, 'blacks'), r: p.method === 'relative' ? 1 : 0 });
    },
    ref: function (p) {
      if (inkZero(p, TONES)) return null;
      var w = inkVec(p, 'whites'), n = inkVec(p, 'neutrals'), b = inkVec(p, 'blacks'), rel = p.method === 'relative';
      return function (c) {
        var x = c.map(function (q) { return clamp(q, 0, 1); }), mx = Math.max(x[0], x[1], x[2]), mn = Math.min(x[0], x[1], x[2]);
        var ink = selFamily([1 - x[0], 1 - x[1], 1 - x[2]], w, clamp((mn - 0.5) * 2, 0, 1), rel);
        ink = selFamily(ink, n, clamp(1 - (Math.abs(mx - 0.5) + Math.abs(mn - 0.5)), 0, 1), rel);
        ink = selFamily(ink, b, clamp((0.5 - mx) * 2, 0, 1), rel);
        return [0, 1, 2].map(function (k) { return 1 - ink[k] + (c[k] - x[k]); });
      };
    },
    ui: { section: 'Colour mixer', order: 31, controls: ['method'].concat(inkUi(TONES)) },
    agent: {
      summary: 'Selective colour for whites, neutrals and blacks (whitesC … blacksK, −100…100 %), with the relative or absolute method. Neutrals is the classic tool for removing a mid-tone cast or toning a grade.',
      tips: ['Remove a yellow cast in mid-tones: neutralsY -8, neutralsM +2.', 'Clean product white: method "absolute", whitesY -6, whitesK -10.', 'Cool, inky blacks: method "absolute", blacksC +8, blacksK +10.', 'Warm highlights / cool shadows (split): whitesY +6, blacksC +6, blacksY -4 with method "absolute".'],
      example: { type: 'selective-color-tones', p: { method: 'absolute', whitesY: -6, neutralsY: -5, blacksC: 6, blacksK: 8 } }
    }
  });

  /* Channel mixer, in linear light (mixing channels is mixing light): out = M·rgb + constant, M in percent. Monochrome uses the red
     row for all three outputs. */
  var MIXK = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
  function mixerMat(p) { var m = MIXK.map(function (k) { return p[k] / 100; }); return p.monochrome ? [m[0], m[1], m[2], m[0], m[1], m[2], m[0], m[1], m[2]] : m; }
  function mixerZero(p) { return !p.monochrome && MIXK.every(function (k, i) { return p[k] === (i % 4 === 0 ? 100 : 0); }) && !p.rc && !p.gc && !p.bc; }
  var mixParams = {};
  MIXK.forEach(function (k, i) { mixParams[k] = { type: 'number', min: -200, max: 200, default: i % 4 === 0 ? 100 : 0, step: 1, unit: '%', label: { r: 'Red', g: 'Green', b: 'Blue' }[k[1]] }; });
  mixParams.rc = { type: 'number', min: -100, max: 100, default: 0, step: 1, unit: '%', label: 'Red constant' };
  mixParams.gc = { type: 'number', min: -100, max: 100, default: 0, step: 1, unit: '%', label: 'Green constant' };
  mixParams.bc = { type: 'number', min: -100, max: 100, default: 0, step: 1, unit: '%', label: 'Blue constant' };
  mixParams.monochrome = { type: 'bool', default: false, label: 'Monochrome' };
  reg({
    id: 'channel-mixer', name: 'Channel mixer', group: 'color', version: 1, space: 'linear',
    params: mixParams,
    passes: function (g, p) {
      if (mixerZero(p)) return;
      g.color('uniform mat3 $m; uniform vec3 $k; vec3 $fx(vec3 c){ return $m * c + $k; }', { m: mixerMat(p), k: [p.rc / 100, p.gc / 100, p.bc / 100] });
    },
    ref: function (p) { if (mixerZero(p)) return null; var m = mixerMat(p), k = [p.rc / 100, p.gc / 100, p.bc / 100]; return function (c) { var o = mat3vec(m, c); return [o[0] + k[0], o[1] + k[1], o[2] + k[2]]; }; },
    ui: { section: 'Colour mixer', order: 50, controls: ['monochrome', { control: 'mixer', rows: { r: ['rr', 'rg', 'rb'], g: ['gr', 'gg', 'gb'], b: ['br', 'bg', 'bb'] } }, { heading: 'Constant' }, 'rc', 'gc', 'bc'] },
    agent: {
      summary: 'Channel mixer in linear light: each output channel is a percentage mix of the input red, green and blue plus a constant. Rows rr rg rb (red output) … bb. Monochrome makes a grey from the red row. Keep each row near 100 % total to keep brightness.',
      tips: ['Classic mono: monochrome true, rr 30, rg 59, rb 11; red-filter mono: rr 70, rg 30, rb 0.', 'Teal shadows / warm lights in one move: rr 105, rb -5, br -5, bg 10, bb 95.', 'Infrared false colour: rr 0, rb 100, br 100, bb 0 (swap red and blue).', 'Constants add light: bc 2 lifts blue in the blacks.'],
      example: { type: 'channel-mixer', p: { monochrome: true, rr: 40, rg: 50, rb: 10 } }
    }
  });

  /* ===================================================================================================================
     COLOUR GRADING
     =================================================================================================================== */
  /* Three-way colour wheels plus global. Region weights on display luminance y: y' = y^(2^(−balance)), shadows = 1 − smoothstep over
     ⅓ ± w, highlights = smoothstep over ⅔ ± w, mid-tones the rest (normalised), w = 0.05 + 0.3 × blending. A wheel's colour is a
     luminance-free direction × amount × 0.3, applied with strength 0.2 + 0.8·√y so blacks take a little tint without lifting.
     Wheel luminance moves its region by 0.2·4y(1−y); the global wheel's luminance is a gamma. Luminance is then restored to the
     target exactly, so colour never changes brightness. */
  function gradeU(p) {
    function t(w) { var d = hueDir(w.h); return [d[0] * w.a * 0.3, d[1] * w.a * 0.3, d[2] * w.a * 0.3]; }
    return { s: t(p.shadows), m: t(p.midtones), h: t(p.highlights), g: t(p.global), l: [p.shadows.l, p.midtones.l, p.highlights.l, p.global.l], k: [Math.pow(2, -p.balance / 100), 0.05 + 0.3 * p.blending / 100] };
  }
  function gradeZero(p) { return zeroWheel(p.shadows) && zeroWheel(p.midtones) && zeroWheel(p.highlights) && zeroWheel(p.global); }
  G.regionWeights = function (y, balance, blending) {
    var yb = Math.pow(clamp(y, 0, 1), Math.pow(2, -(balance || 0) / 100)), w = 0.05 + 0.3 * (blending == null ? 50 : blending) / 100;
    var ws = 1 - sstep(1 / 3 - w, 1 / 3 + w, yb), wh = sstep(2 / 3 - w, 2 / 3 + w, yb), wm = Math.max(0, 1 - ws - wh), s = ws + wm + wh;
    return [ws / s, wm / s, wh / s];
  };
  var wheelDef = function (label) { return { type: 'wheel', default: { h: 0, a: 0, l: 0 }, label: label }; };
  reg({
    id: 'color-grading', name: 'Colour grading', group: 'color', version: 1, space: 'display',
    params: {
      shadows: wheelDef('Shadows'), midtones: wheelDef('Mid-tones'), highlights: wheelDef('Highlights'), global: wheelDef('Global'),
      blending: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Blending' },
      balance: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Balance' }
    },
    passes: function (g, p) {
      if (gradeZero(p)) return;
      var u = gradeU(p);
      g.color(GL.gamut + 'uniform vec3 $s, $m, $h, $g; uniform vec4 $l; uniform vec2 $k;\n' +
        'vec3 $fx(vec3 c){ float y = clamp(luma(c), 0.0, 1.0); float yb = pow(y, $k.x);\n' +
        '  float ws = 1.0 - smoothstep(1.0 / 3.0 - $k.y, 1.0 / 3.0 + $k.y, yb), wh = smoothstep(2.0 / 3.0 - $k.y, 2.0 / 3.0 + $k.y, yb), wm = max(0.0, 1.0 - ws - wh), sm = ws + wm + wh; ws /= sm; wm /= sm; wh /= sm;\n' +
        '  vec3 o = c + (0.2 + 0.8 * sqrt(y)) * (ws * $s + wm * $m + wh * $h + $g);\n' +
        '  float yt = max(0.0, y + 0.2 * (ws * $l.x + wm * $l.y + wh * $l.z) * 4.0 * y * (1.0 - y)); yt = pow(yt, exp2(-$l.w * 0.7));\n' +
        '  float yo = luma(o); o = mix(o + (yt - yo), o * (yt / max(yo, 1e-4)), smoothstep(0.02, 0.3, yo)); return $gamut(o, luma(o), c); }', u);
    },
    ref: function (p) {
      if (gradeZero(p)) return null;
      var u = gradeU(p);
      return function (c) {
        var y = clamp(luma(c), 0, 1), w = G.regionWeights(y, p.balance, p.blending), f = 0.2 + 0.8 * Math.sqrt(y);
        var o = [0, 1, 2].map(function (k) { return c[k] + f * (w[0] * u.s[k] + w[1] * u.m[k] + w[2] * u.h[k] + u.g[k]); });
        var yt = Math.max(0, y + 0.2 * (w[0] * u.l[0] + w[1] * u.l[1] + w[2] * u.l[2]) * 4 * y * (1 - y)); yt = Math.pow(yt, Math.pow(2, -u.l[3] * 0.7));
        var yo = luma(o), t = sstep(0.02, 0.3, yo), r = yt / Math.max(yo, 1e-4);
        o = o.map(function (v) { return mix(v + (yt - yo), v * r, t); });
        return gamut(o, luma(o), c);
      };
    },
    ui: { section: 'Colour grading', order: 10, controls: [{ control: 'wheels', params: ['shadows', 'midtones', 'highlights', 'global'], global: 'global', balance: 'balance', blending: 'blending' }] },
    agent: {
      summary: 'Three-way colour wheels (shadows, mid-tones, highlights) plus global. Each wheel { h: hue°, a: amount 0–1, l: luminance −1…1 }; blending (0–100) sets how much the regions overlap, balance (−100…100) moves the split towards shadows (−) or highlights (+). Colour never changes luminance. Split toning is shadows + highlights only (LE.fx.grade.splitTone).',
      tips: ['Teal-orange: shadows {h:195,a:0.35}, highlights {h:35,a:0.3}, balance 10.', 'Filmic fade: shadows {h:220,a:0.15,l:0.25}, highlights {h:45,a:0.12,l:-0.1}, blending 70.', 'Warm portrait: midtones {h:30,a:0.12}, highlights {h:40,a:0.1}.', 'Moonlight: global {h:220,a:0.2,l:-0.15}, highlights {h:200,a:0.1}.', 'Hues: 0 red, 30 orange, 60 yellow, 120 green, 180 cyan, 210 teal-blue, 240 blue, 300 magenta. Amounts over 0.5 are very strong.'],
      example: { type: 'color-grading', p: { shadows: { h: 195, a: 0.35, l: 0 }, highlights: { h: 35, a: 0.3, l: 0 }, balance: 10, blending: 50 } }
    }
  });
  /* Classic split toning as a colour-grading entry (highlight and shadow hue/saturation 0–100, balance −100…100). */
  G.splitTone = function (o) {
    o = o || {};
    return { type: 'color-grading', p: { shadows: { h: o.shadowHue == null ? 210 : o.shadowHue, a: clamp((o.shadowSat == null ? 25 : o.shadowSat) / 100, 0, 1), l: 0 }, midtones: { h: 0, a: 0, l: 0 },
      highlights: { h: o.highlightHue == null ? 40 : o.highlightHue, a: clamp((o.highlightSat == null ? 25 : o.highlightSat) / 100, 0, 1), l: 0 }, global: { h: 0, a: 0, l: 0 }, balance: o.balance || 0, blending: o.blending == null ? 60 : o.blending } };
  };

  /* Lift / gamma / gain / offset, the video primaries. Per channel x = l + 0.5·a·direction(h):
     out = gain·max(in + lift·(1 − in), 0)^gamma + offset, with lift = 0.5·x, gain = 2^x (±1 stop), gamma exponent = 2^(−x), offset = 0.25·x. */
  function lggU(p) {
    function x(w) { var d = hueDir(w.h); return [w.l + 0.5 * w.a * d[0], w.l + 0.5 * w.a * d[1], w.l + 0.5 * w.a * d[2]]; }
    var L = x(p.lift), Gm = x(p.gamma), Gn = x(p.gain), O = x(p.offset);
    return { lift: L.map(function (v) { return 0.5 * v; }), gam: Gm.map(function (v) { return Math.pow(2, -v); }), gain: Gn.map(function (v) { return Math.pow(2, v); }), off: O.map(function (v) { return 0.25 * v; }) };
  }
  reg({
    id: 'lift-gamma-gain', name: 'Lift, gamma, gain', group: 'color', version: 1, space: 'display',
    params: { lift: wheelDef('Lift'), gamma: wheelDef('Gamma'), gain: wheelDef('Gain'), offset: wheelDef('Offset') },
    passes: function (g, p) {
      if (zeroWheel(p.lift) && zeroWheel(p.gamma) && zeroWheel(p.gain) && zeroWheel(p.offset)) return;
      g.color('uniform vec3 $a, $b, $c, $d; vec3 $fx(vec3 c){ return $c * pow(max(c + $a * (1.0 - c), 0.0), $b) + $d; }', (function (u) { return { a: u.lift, b: u.gam, c: u.gain, d: u.off }; })(lggU(p)));
    },
    ref: function (p) {
      if (zeroWheel(p.lift) && zeroWheel(p.gamma) && zeroWheel(p.gain) && zeroWheel(p.offset)) return null;
      var u = lggU(p);
      return function (c) { return [0, 1, 2].map(function (k) { return u.gain[k] * Math.pow(Math.max(c[k] + u.lift[k] * (1 - c[k]), 0), u.gam[k]) + u.off[k]; }); };
    },
    ui: { section: 'Colour grading', order: 20, controls: [{ control: 'wheels', params: ['lift', 'gamma', 'gain', 'offset'], global: 'offset' }] },
    agent: {
      summary: 'Video-style primaries on display values: lift moves the blacks (white stays), gamma the mid-tones, gain the whites (black stays), offset everything. Each wheel { h, a, l }: l is the master (−1…1), h/a push a colour (a 1 = ±0.5 on that channel).',
      tips: ['Lifted, matte blacks: lift {l:0.08}. Crushed, contrasty blacks: lift {l:-0.06}.', 'Warm highlights, cool shadows: gain {h:35,a:0.12}, lift {h:210,a:0.1}.', 'Brighten mids without touching ends: gamma {l:0.15}.', 'Neutralise a cast in one place: push the opposite hue on that wheel (cast at 40° → h 220).'],
      example: { type: 'lift-gamma-gain', p: { lift: { h: 210, a: 0.1, l: 0.03 }, gamma: { h: 0, a: 0, l: 0.05 }, gain: { h: 35, a: 0.12, l: 0 } } }
    }
  });

  /* ASC CDL v1.2: out = max(in·slope + offset, 0)^power per channel, then saturation around Rec. 709 luma. The specification clamps to
     0–1; here only the lower clamp is applied (a power of a negative number is undefined), so headroom from earlier effects survives. */
  function cdlNeutral(p) { return p.slopeR === 1 && p.slopeG === 1 && p.slopeB === 1 && !p.offsetR && !p.offsetG && !p.offsetB && p.powerR === 1 && p.powerG === 1 && p.powerB === 1 && p.saturation === 1; }
  var cdlP = {};
  [['slope', 0, 4, 1, 0.001], ['offset', -1, 1, 0, 0.001], ['power', 0.1, 4, 1, 0.001]].forEach(function (s) {
    ['R', 'G', 'B'].forEach(function (ch) { cdlP[s[0] + ch] = { type: 'number', min: s[1], max: s[2], default: s[3], step: s[4], label: { R: 'Red', G: 'Green', B: 'Blue' }[ch] }; });
  });
  cdlP.saturation = { type: 'number', min: 0, max: 4, default: 1, step: 0.001, label: 'Saturation' };
  reg({
    id: 'cdl', name: 'ASC CDL', group: 'color', version: 1, space: 'display',
    params: cdlP,
    passes: function (g, p) {
      if (cdlNeutral(p)) return;
      g.color('uniform vec3 $s, $o, $p; uniform float $t; vec3 $fx(vec3 c){ vec3 v = pow(max(c * $s + $o, 0.0), $p); float l = luma(v); return l + (v - l) * $t; }',
        { s: [p.slopeR, p.slopeG, p.slopeB], o: [p.offsetR, p.offsetG, p.offsetB], p: [p.powerR, p.powerG, p.powerB], t: p.saturation });
    },
    ref: function (p) {
      if (cdlNeutral(p)) return null;
      var s = [p.slopeR, p.slopeG, p.slopeB], o = [p.offsetR, p.offsetG, p.offsetB], w = [p.powerR, p.powerG, p.powerB];
      return function (c) { var v = [0, 1, 2].map(function (k) { return Math.pow(Math.max(c[k] * s[k] + o[k], 0), w[k]); }), l = luma(v); return v.map(function (x) { return l + (x - l) * p.saturation; }); };
    },
    ui: { section: 'Colour grading', order: 30, controls: [{ heading: 'Slope' }, 'slopeR', 'slopeG', 'slopeB', { heading: 'Offset' }, 'offsetR', 'offsetG', 'offsetB', { heading: 'Power' }, 'powerR', 'powerG', 'powerB', { heading: 'Saturation' }, 'saturation'] },
    agent: {
      summary: 'ASC Colour Decision List: slope, offset and power per channel, then saturation, on display values. Paste the numbers of a .cdl/.ccc file (SOPNode Slope/Offset/Power, SatNode Saturation) to reproduce a colourist\'s decision.',
      tips: ['A CDL from a file: slopeR 1.05 slopeG 1 slopeB 0.94, offsetR 0.01, powerR 0.98 …, saturation 0.9.', 'Warm: slopeR 1.06, slopeB 0.92. Lift blacks: offsetR/G/B 0.02. Contrast via power > 1.', 'Everything is exact and invertible-ish; ideal for agents that grade by numbers.'],
      example: { type: 'cdl', p: { slopeR: 1.06, slopeG: 1, slopeB: 0.93, offsetR: 0.01, offsetG: 0.01, offsetB: 0.02, powerR: 1, powerG: 1, powerB: 1, saturation: 0.92 } }
    }
  });

  /* Colour balance (the GIMP transfer model): each channel is shifted by the cyan–red, magenta–green or yellow–blue amount of the
     shadows, mid-tones and highlights, masked by the pixel's HSL lightness l with a = 0.25, b = 0.333, scale 0.7; preserve luminosity
     then puts the original HSL lightness back with hue and saturation kept. */
  function cbMap(v, l, a) {
    var s = a[0] * clamp((l - 0.333) / -0.25 + 0.5, 0, 1) * 0.7;
    var m = a[1] * clamp((l - 0.333) / 0.25 + 0.5, 0, 1) * clamp((l + 0.333 - 1) / -0.25 + 0.5, 0, 1) * 0.7;
    var h = a[2] * clamp((l + 0.333 - 1) / 0.25 + 0.5, 0, 1) * 0.7;
    return clamp(v + s + m + h, 0, 1);
  }
  function setL(c, L) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), l0 = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-6) return [L, L, L];
    var s = d / Math.max(1e-6, 1 - Math.abs(2 * l0 - 1)), d2 = s * (1 - Math.abs(2 * L - 1));
    return c.map(function (v) { return L + (v - l0) * d2 / d; });
  }
  var CB = ['CR', 'MG', 'YB'];
  function cbVecs(p) { return CB.map(function (k) { return [p['shadows' + k] / 100, p['midtones' + k] / 100, p['highlights' + k] / 100]; }); }
  function cbZero(p) { return ['shadows', 'midtones', 'highlights'].every(function (r) { return CB.every(function (k) { return !p[r + k]; }); }); }
  var cbP = {};
  ['shadows', 'midtones', 'highlights'].forEach(function (r) { [['CR', 'Cyan – red'], ['MG', 'Magenta – green'], ['YB', 'Yellow – blue']].forEach(function (k) { cbP[r + k[0]] = { type: 'number', min: -100, max: 100, default: 0, step: 1, label: k[1] }; }); });
  cbP.preserve = { type: 'bool', default: true, label: 'Preserve luminosity' };
  reg({
    id: 'color-balance', name: 'Colour balance', group: 'color', version: 1, space: 'display',
    params: cbP,
    passes: function (g, p) {
      if (cbZero(p)) return;
      var v = cbVecs(p);
      g.color('uniform vec3 $r, $g, $b; uniform float $p;\n' +
        'float $map(float v, float l, vec3 a){ float s = a.x * clamp((l - 0.333) / -0.25 + 0.5, 0.0, 1.0) * 0.7; float m = a.y * clamp((l - 0.333) / 0.25 + 0.5, 0.0, 1.0) * clamp((l + 0.333 - 1.0) / -0.25 + 0.5, 0.0, 1.0) * 0.7; float h = a.z * clamp((l + 0.333 - 1.0) / 0.25 + 0.5, 0.0, 1.0) * 0.7; return clamp(v + s + m + h, 0.0, 1.0); }\n' +
        'vec3 $setL(vec3 c, float L){ float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l0 = (mx + mn) * 0.5, d = mx - mn; if (d < 1e-6) return vec3(L); float s = d / max(1e-6, 1.0 - abs(2.0 * l0 - 1.0)); return L + (c - l0) * (s * (1.0 - abs(2.0 * L - 1.0)) / d); }\n' +
        'vec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); float l = (max(x.r, max(x.g, x.b)) + min(x.r, min(x.g, x.b))) * 0.5; vec3 o = vec3($map(x.r, l, $r), $map(x.g, l, $g), $map(x.b, l, $b)); return $p > 0.5 ? $setL(o, l) : o; }',
      { r: v[0], g: v[1], b: v[2], p: p.preserve ? 1 : 0 });
    },
    ref: function (p) {
      if (cbZero(p)) return null;
      var v = cbVecs(p);
      return function (c) {
        var x = c.map(function (q) { return clamp(q, 0, 1); }), l = (Math.max(x[0], x[1], x[2]) + Math.min(x[0], x[1], x[2])) / 2;
        var o = [cbMap(x[0], l, v[0]), cbMap(x[1], l, v[1]), cbMap(x[2], l, v[2])];
        return p.preserve ? setL(o, l) : o;
      };
    },
    ui: { section: 'Colour grading', order: 40, controls: [{ heading: 'Shadows' }, 'shadowsCR', 'shadowsMG', 'shadowsYB', { heading: 'Mid-tones' }, 'midtonesCR', 'midtonesMG', 'midtonesYB', { heading: 'Highlights' }, 'highlightsCR', 'highlightsMG', 'highlightsYB', 'preserve'] },
    agent: {
      summary: 'Colour balance per tonal range: cyan–red, magenta–green, yellow–blue sliders for shadows, mid-tones and highlights (−100…100). Preserve luminosity (default on) keeps brightness. A gentle, classic tool for removing casts by range.',
      tips: ['Cool shadows, warm highlights: shadowsCR -12, shadowsYB +15, highlightsCR +10, highlightsYB -12.', 'Remove green fluorescent cast in mid-tones: midtonesMG -10.', 'Values above ±40 are strong; it is not luminance-aware like colour-grading, so prefer that for big looks.'],
      example: { type: 'color-balance', p: { shadowsCR: -10, shadowsYB: 12, highlightsCR: 8, highlightsYB: -10, preserve: true } }
    }
  });

  /* Gradient map: display luminance (Rec. 709) indexes a gradient of 2–5 stops, interpolated in OKLab ("perceptual") or display RGB,
     as a 256-entry table; strength mixes it over the picture (0 = off, so the effect is neutral until set). */
  G.gradientTable = function (p, n) {
    n = n || 256;
    var k = clamp(Math.round(Number(p.count) || 2), 2, 5), stops = [];
    for (var i = 0; i < k; i++) stops.push({ at: clamp(p['pos' + i], 0, 1), c: (M.parseColor(p['color' + i]) || [0, 0, 0]).slice(0, 3) });
    stops.sort(function (a, b) { return a.at - b.at; });
    var lab = p.interpolation !== 'rgb', sp = stops.map(function (s) { return lab ? oklab(toLin(s.c)) : s.c; }), out = new Float32Array(n * 3);
    for (var j = 0; j < n; j++) {
      var x = j / (n - 1); if (p.reverse) x = 1 - x;
      var a = 0; while (a < k - 1 && stops[a + 1].at < x) a++;
      var b = Math.min(a + 1, k - 1), t = stops[b].at > stops[a].at ? clamp((x - stops[a].at) / (stops[b].at - stops[a].at), 0, 1) : (x >= stops[b].at ? 1 : 0);
      if (x <= stops[0].at) { b = a = 0; t = 0; }
      var v = [0, 1, 2].map(function (q) { return mix(sp[a][q], sp[b][q], t); });
      if (lab) v = toDsp(oklabInv(v));
      out[j * 3] = clamp(v[0], 0, 1); out[j * 3 + 1] = clamp(v[1], 0, 1); out[j * 3 + 2] = clamp(v[2], 0, 1);
    }
    return out;
  };
  var gmP = { strength: { type: 'number', min: 0, max: 100, default: 0, step: 1, unit: '%', label: 'Strength' }, count: { type: 'number', min: 2, max: 5, default: 2, step: 1, label: 'Stops' } };
  [['#000000', 0], ['#ffffff', 1], ['#c2703d', 0.5], ['#f3d9a4', 0.75], ['#22314f', 0.25]].forEach(function (s, i) {
    gmP['color' + i] = { type: 'color', default: s[0], label: 'Stop ' + (i + 1) + ' colour' };
    gmP['pos' + i] = { type: 'number', min: 0, max: 1, default: s[1], step: 0.01, label: 'Stop ' + (i + 1) + ' position' };
  });
  gmP.interpolation = { type: 'choice', options: [{ value: 'perceptual', label: 'Perceptual' }, { value: 'rgb', label: 'RGB' }], default: 'perceptual', label: 'Interpolation' };
  gmP.reverse = { type: 'bool', default: false, label: 'Reverse' };
  reg({
    id: 'gradient-map', name: 'Gradient map', group: 'color', version: 1, space: 'display',
    params: gmP,
    passes: function (g, p) {
      if (!p.strength) return;
      g.color('uniform sampler2D $t; uniform float $k; vec3 $fx(vec3 c){ return mix(c, lut1rgb($t, vec3(clamp(luma(c), 0.0, 1.0))), $k); }', { t: g.lut1d(G.gradientTable(p), 3), k: p.strength / 100 });
    },
    ref: function (p) {
      if (!p.strength) return null;
      var t = G.gradientTable(p), k = p.strength / 100;
      return function (c) { var y = clamp(luma(c), 0, 1); return [0, 1, 2].map(function (i) { return mix(c[i], tab(t, 3, y, i), k); }); };
    },
    ui: { section: 'Colour grading', order: 60, controls: ['strength', 'count', 'interpolation', 'reverse', { heading: 'Stops' }, 'color0', 'pos0', 'color1', 'pos1', { param: 'color2', when: { count: [3, 4, 5] } }, { param: 'pos2', when: { count: [3, 4, 5] } }, { param: 'color3', when: { count: [4, 5] } }, { param: 'pos3', when: { count: [4, 5] } }, { param: 'color4', when: { count: 5 } }, { param: 'pos4', when: { count: 5 } }] },
    agent: {
      summary: 'Maps luminance to a gradient of 2–5 colour stops (colorN at posN, the first `count` stops are used), interpolated perceptually. strength is 0 by default: set it (100 replaces the picture; 10–30 tints it). Use blend "soft-light" or "color" on the entry for classic looks.',
      tips: ['Duotone: count 2, color0 "#1b2440", color1 "#f2c98a", strength 100.', 'Subtle cinematic tone: count 3, color0 "#0f1d2b" pos0 0, color2 "#7a8d93" pos2 0.5, color1 "#f6dfb8" pos1 1, strength 20.', 'Clean product white: count 2, color0 "#202326", color1 "#ffffff", strength 12, blend "luminosity".'],
      example: { type: 'gradient-map', p: { strength: 100, count: 2, color0: '#1b2440', color1: '#f2c98a' } }
    }
  });

  /* ===================================================================================================================
     COLOUR
     =================================================================================================================== */
  /* Photo filter: a coloured lens filter in linear light. The filter's transmission is its linear colour divided by its largest
     channel; density mixes from clear glass to the full filter; preserve luminosity rescales to the original Rec. 709 luminance. */
  var FILTERS = { 'warming-85': '#ec8a00', 'warming-lba': '#fa9600', 'warming-81': '#ebb113', 'cooling-80': '#006dff', 'cooling-lbb': '#005dff', 'cooling-82': '#00b5ff',
    red: '#ea1a1a', orange: '#f38417', yellow: '#f9e31c', green: '#19c919', cyan: '#1dcbea', blue: '#1d35ea', violet: '#9b1dea', magenta: '#e318e3', sepia: '#ac7a33', 'deep-emerald': '#008c00' };
  function filterT(p) {
    var c = (M.parseColor(p.filter === 'custom' ? p.color : FILTERS[p.filter] || p.color) || [1, 1, 1]).slice(0, 3).map(lin1), m = Math.max(c[0], c[1], c[2]) || 1;
    return c.map(function (v) { return v / m; });
  }
  reg({
    id: 'photo-filter', name: 'Photo filter', group: 'color', version: 1, space: 'linear',
    params: {
      filter: { type: 'choice', options: ['custom'].concat(Object.keys(FILTERS)), default: 'warming-85', label: 'Filter' },
      color: { type: 'color', default: '#ec8a00', label: 'Colour' },
      density: { type: 'number', min: 0, max: 100, default: 0, step: 1, unit: '%', label: 'Density' },
      preserve: { type: 'bool', default: true, label: 'Preserve luminosity' }
    },
    passes: function (g, p) {
      if (!p.density) return;
      var t = filterT(p), d = p.density / 100;
      g.color('uniform vec3 $t; uniform float $p; vec3 $fx(vec3 c){ vec3 o = c * $t; if ($p > 0.5) { float y = luma(c), yo = luma(o); o = yo > 1e-6 ? o * (y / yo) : c; } return o; }', { t: t.map(function (v) { return mix(1, v, d); }), p: p.preserve ? 1 : 0 });
    },
    ref: function (p) {
      if (!p.density) return null;
      var t = filterT(p).map(function (v) { return mix(1, v, p.density / 100); });
      return function (c) { var o = [c[0] * t[0], c[1] * t[1], c[2] * t[2]]; if (p.preserve) { var y = luma(c), yo = luma(o); o = yo > 1e-6 ? o.map(function (v) { return v * y / yo; }) : c.slice(); } return o; };
    },
    ui: { section: 'Colour', order: 40, controls: ['filter', { param: 'color', when: { filter: 'custom' } }, 'density', 'preserve'] },
    agent: {
      summary: 'A coloured lens filter in linear light (warming 85/LBA/81, cooling 80/LBB/82, colours, sepia, or a custom colour). density 0 by default; 15–35 is natural. Preserve luminosity keeps brightness.',
      tips: ['Golden hour: filter "warming-85", density 25.', 'Cool night: filter "cooling-80", density 30 with a slight exposure drop.', 'Sepia over black-and-white: bw-mix first, then filter "sepia", density 60.'],
      example: { type: 'photo-filter', p: { filter: 'warming-85', density: 25 } }
    }
  });

  /* Vibrance done right: OKLCh chroma is scaled by 1 + v·(1 − C/0.32)² (positive) or 1 + v·(1 − C/0.32) (negative), so muted colours move
     most and nothing clips; skin (OKLCh hue near 60°, chroma 0.03–0.15, Gaussian width 22°) is protected by `protect`. */
  reg({
    id: 'vibrance', name: 'Vibrance', group: 'color', version: 1, space: 'display',
    params: {
      amount: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Vibrance' },
      protect: { type: 'number', min: 0, max: 100, default: 75, step: 1, unit: '%', label: 'Protect skin' }
    },
    passes: function (g, p) {
      if (!p.amount) return;
      g.color(GL.lab + GL.gamut + 'uniform vec2 $a;\nvec3 $fx(vec3 c){ vec3 li = toLinear(c); vec3 L = $lab(li); float C = length(L.yz); if (C < 1e-6) return c;\n' +
        '  float h = degrees(atan(L.z, L.y)); float dh = mod(h - 60.0 + 180.0, 360.0) - 180.0; float sk = exp(-(dh * dh) / (2.0 * 22.0 * 22.0)) * smoothstep(0.015, 0.035, C) * (1.0 - smoothstep(0.15, 0.22, C));\n' +
        '  float r = clamp(C / 0.32, 0.0, 1.0); float w = ($a.x > 0.0 ? (1.0 - r) * (1.0 - r) : (1.0 - r)) * (1.0 - $a.y * sk); float k = max(0.0, 1.0 + $a.x * w);\n' +
        '  vec3 o = $rgb(vec3(L.x, L.yz * k)); return toDisplay($gamut(o, L.x * L.x * L.x, li)); }', { a: [p.amount / 100, p.protect / 100] });
    },
    ref: function (p) {
      if (!p.amount) return null;
      var v = p.amount / 100, pr = p.protect / 100;
      return function (c) {
        var li = toLin(c), L = oklab(li), C = Math.hypot(L[1], L[2]);
        if (C < 1e-6) return c.slice();
        var h = Math.atan2(L[2], L[1]) * 180 / Math.PI, dh = (((h - 60 + 180) % 360) + 360) % 360 - 180;
        var sk = Math.exp(-(dh * dh) / (2 * 22 * 22)) * sstep(0.015, 0.035, C) * (1 - sstep(0.15, 0.22, C)), r = clamp(C / 0.32, 0, 1);
        var w = (v > 0 ? (1 - r) * (1 - r) : 1 - r) * (1 - pr * sk), k = Math.max(0, 1 + v * w);
        return toDsp(gamut(oklabInv([L[0], L[1] * k, L[2] * k]), L[0] * L[0] * L[0], li));
      };
    },
    ui: { section: 'Colour', order: 25, controls: ['amount', 'protect'] },
    agent: {
      summary: 'Vibrance in OKLCh: raises muted colours much more than saturated ones (no neon, no clipping) and protects skin tones. Supersedes the starter saturation effect\'s vibrance slider for portraits and products.',
      tips: ['Portrait: amount 20–35, protect 75–90.', 'Landscape: amount 30–50, protect 30.', 'Muted, filmic: amount -25.', 'Combine with hsl to target single colours.'],
      example: { type: 'vibrance', p: { amount: 30, protect: 80 } }
    }
  });

  /* Skin tones on the vectorscope (BT.601 CbCr of display values; angle 123° is the skin-tone line). Pixels whose angle is within
     ±width/2 of `center` are fully selected, fading to nothing at ±1.5·width, ignoring near-greys and the extreme ends of luminance.
     Uniformity pulls their hue towards `center`; evenness pulls their CbCr magnitude towards `chroma` (read both from
     LE.fx.analyze on a skin region); hue / saturation / lightness move the selection. Colour-only: no texture is touched (that is X4). */
  function skinU(p) { return [p.hue / 100 * 12, p.saturation / 100 * 0.6, p.lightness / 100 * 0.08, p.uniformity / 100, p.evenness / 100, p.center, p.width, p.chroma]; }
  function skinZero(p) { return !p.hue && !p.saturation && !p.lightness && !p.uniformity && !p.evenness; }
  G.skinWeight = function (rgb, p) {
    p = p || FX.defaults('skin-tone');
    var c = rgb.map(function (v) { return clamp(v, 0, 1); }), Y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    var cb = -0.168736 * c[0] - 0.331264 * c[1] + 0.5 * c[2], cr = 0.5 * c[0] - 0.418688 * c[1] - 0.081312 * c[2], m = Math.hypot(cb, cr);
    var ang = (Math.atan2(cr, cb) * 180 / Math.PI + 360) % 360, d = ((ang - p.center + 540) % 360) - 180;
    return { weight: (1 - sstep(p.width * 0.5, p.width * 1.5, Math.abs(d))) * sstep(0.012, 0.035, m) * sstep(0.04, 0.12, Y) * (1 - sstep(0.92, 0.99, Y)), angle: ang, magnitude: m, y: Y, offset: d };
  };
  reg({
    id: 'skin-tone', name: 'Skin tone', group: 'color', version: 1, space: 'display',
    params: {
      hue: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Hue', help: 'Positive is more yellow, negative more red.' },
      saturation: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Saturation' },
      lightness: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Lightness' },
      uniformity: { type: 'number', min: 0, max: 100, default: 0, step: 1, unit: '%', label: 'Hue uniformity' },
      evenness: { type: 'number', min: 0, max: 100, default: 0, step: 1, unit: '%', label: 'Saturation evenness' },
      center: { type: 'number', min: 90, max: 170, default: 123, step: 0.5, unit: 'deg', label: 'Skin hue' },
      width: { type: 'number', min: 5, max: 45, default: 25, step: 0.5, unit: 'deg', label: 'Range' },
      chroma: { type: 'number', min: 0.02, max: 0.3, default: 0.12, step: 0.001, label: 'Target saturation' }
    },
    passes: function (g, p) {
      if (skinZero(p)) return;
      var u = skinU(p);
      g.color('uniform vec4 $a, $b;\nvec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); float Y = dot(x, vec3(0.299, 0.587, 0.114)); float cb = dot(x, vec3(-0.168736, -0.331264, 0.5)), cr = dot(x, vec3(0.5, -0.418688, -0.081312)); float m = length(vec2(cb, cr));\n' +
        '  float ang = mod(degrees(atan(cr, cb)) + 360.0, 360.0); float d = mod(ang - $b.y + 540.0, 360.0) - 180.0;\n' +
        '  float W = (1.0 - smoothstep($b.z * 0.5, $b.z * 1.5, abs(d))) * smoothstep(0.012, 0.035, m) * smoothstep(0.04, 0.12, Y) * (1.0 - smoothstep(0.92, 0.99, Y)); if (W <= 0.0) return c;\n' +
        '  float a2 = radians(ang + W * ($a.x - d * $b.x)); float m2 = m * (1.0 + W * $a.y); m2 = mix(m2, $b.w, W * $a.w); float Y2 = Y + W * $a.z * 4.0 * Y * (1.0 - Y);\n' +
        '  vec2 q = vec2(cos(a2), sin(a2)) * m2; vec3 o = vec3(Y2 + 1.402 * q.y, Y2 - 0.344136 * q.x - 0.714136 * q.y, Y2 + 1.772 * q.x); return o + (c - x); }',
      { a: [u[0], u[1], u[2], u[4]], b: [u[3], u[5], u[6], u[7]] });
    },
    ref: function (p) {
      if (skinZero(p)) return null;
      var u = skinU(p);
      return function (c) {
        var s = G.skinWeight(c, p), W = s.weight, x = c.map(function (v) { return clamp(v, 0, 1); });
        if (W <= 0) return c.slice();
        var a2 = (s.angle + W * (u[0] - s.offset * u[3])) * Math.PI / 180, m2 = s.magnitude * (1 + W * u[1]); m2 = mix(m2, u[7], W * u[4]);
        var Y2 = s.y + W * u[2] * 4 * s.y * (1 - s.y), qx = Math.cos(a2) * m2, qy = Math.sin(a2) * m2;
        var o = [Y2 + 1.402 * qy, Y2 - 0.344136 * qx - 0.714136 * qy, Y2 + 1.772 * qx];
        return [0, 1, 2].map(function (k) { return o[k] + (c[k] - x[k]); });
      };
    },
    ui: { section: 'Colour', order: 60, controls: ['hue', 'saturation', 'lightness', { heading: 'Even out' }, 'uniformity', 'evenness', 'chroma', { heading: 'Selection' }, 'center', 'width'] },
    agent: {
      summary: 'Skin-tone targeting on the vectorscope: moves only colours near the skin-tone line (center 123°, ±width) and evens them out. Uniformity pulls skin hues onto the line (fixes blotchy red/yellow patches); evenness pulls their saturation to `chroma`. Colour only; texture is untouched.',
      tips: ['Measure first: LE.fx.analyze(target, { region: skinBox }).hue.vectorscope gives angle and magnitude; set center to the angle (or 123) and chroma to the magnitude.', 'Typical portrait: uniformity 40, evenness 25, saturation -5, hue 5.', 'Too red / sunburnt: hue +20, uniformity 50. Sallow / green: hue -10, saturation +10.', 'Limit it to faces with a mask: mask = LE.fx.grade.skinMask() or a face mask part.'],
      example: { type: 'skin-tone', p: { uniformity: 40, evenness: 25, hue: 5, saturation: -5 } }
    }
  });
  /* A colour-mask (kind 'color', LE.expert.evalMask's HSL model) that selects skin. tone: 'all' (three parts), 'light', 'medium',
     'deep'; or sample: [r, g, b] (display 0–1) or '#rrggbb' measured on the subject's skin. Defaults were fitted on a 19-swatch skin
     set from very light to very deep against greys, foliage, sky and saturated oranges (tests/fx-grade.test.js keeps them honest). */
  var SKIN_PARTS = { light: { h: 27, s: 0.55, l: 0.78, range: 0.2, soft: 0.1 }, medium: { h: 22, s: 0.45, l: 0.56, range: 0.2, soft: 0.1 }, deep: { h: 21, s: 0.33, l: 0.33, range: 0.18, soft: 0.1 } };
  G.skinMask = function (o) {
    o = o || {};
    var parts;
    if (o.sample) {
      var c = typeof o.sample === 'string' ? (M.parseColor(o.sample) || [0.8, 0.6, 0.5]).slice(0, 3) : o.sample, q = rgb2hsl(c);
      parts = [{ kind: 'color', mode: 'add', h: Math.round(q[0]), s: Math.round(q[1] * 100) / 100, l: Math.round(q[2] * 100) / 100, range: o.range || 0.16, soft: o.soft || 0.1 }];
    } else {
      var keys = o.tone && SKIN_PARTS[o.tone] ? [o.tone] : ['light', 'medium', 'deep'];
      parts = keys.map(function (k) { var s = SKIN_PARTS[k]; return { kind: 'color', mode: 'add', h: s.h, s: s.s, l: s.l, range: s.range, soft: s.soft }; });
    }
    return { on: true, invert: false, parts: parts };
  };

  /* Camera-style calibration: each primary's hue (±25° in OKLCh) and saturation (chroma ×0.6…×1.4) is moved, giving a 3×3 matrix on
     linear RGB whose columns are the new primaries, rescaled so white stays white. Shadows tint is a green–magenta shift that fades out
     above 12 % linear luminance. */
  function calMatrix(p) {
    var cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(function (prim, i) {
      var key = ['red', 'green', 'blue'][i], L = oklab(prim), C = Math.hypot(L[1], L[2]), a = Math.atan2(L[2], L[1]) + p[key + 'Hue'] / 100 * 25 * Math.PI / 180, k = 1 + p[key + 'Sat'] / 100 * 0.4;
      return oklabInv([L[0], C * k * Math.cos(a), C * k * Math.sin(a)]);
    });
    var m = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]];
    var s = mat3vec(inv3(m), [1, 1, 1]);
    return [m[0] * s[0], m[1] * s[1], m[2] * s[2], m[3] * s[0], m[4] * s[1], m[5] * s[2], m[6] * s[0], m[7] * s[1], m[8] * s[2]];
  }
  function calZero(p) { return ['red', 'green', 'blue'].every(function (k) { return !p[k + 'Hue'] && !p[k + 'Sat']; }) && !p.shadowsTint; }
  var calP = { shadowsTint: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Shadows tint' } };
  ['red', 'green', 'blue'].forEach(function (k) {
    var n = k.charAt(0).toUpperCase() + k.slice(1);
    calP[k + 'Hue'] = { type: 'number', min: -100, max: 100, default: 0, step: 1, label: n + ' primary hue', ui: { gradient: 'hue' } };
    calP[k + 'Sat'] = { type: 'number', min: -100, max: 100, default: 0, step: 1, label: n + ' primary saturation' };
  });
  reg({
    id: 'calibration', name: 'Calibration', group: 'color', version: 1, space: 'linear',
    params: calP,
    passes: function (g, p) {
      if (calZero(p)) return;
      g.color('uniform mat3 $m; uniform float $t; vec3 $fx(vec3 c){ vec3 o = $m * c; float w = 1.0 - smoothstep(0.0, 0.12, clamp(luma(o), 0.0, 1.0)); return o * vec3(1.0 - 0.5 * $t * w, 1.0 + $t * w, 1.0 - 0.5 * $t * w); }',
        { m: calMatrix(p), t: -p.shadowsTint / 100 * 0.2 });
    },
    ref: function (p) {
      if (calZero(p)) return null;
      var m = calMatrix(p), t = -p.shadowsTint / 100 * 0.2;
      return function (c) { var o = mat3vec(m, c), w = 1 - sstep(0, 0.12, clamp(luma(o), 0, 1)); return [o[0] * (1 - 0.5 * t * w), o[1] * (1 + t * w), o[2] * (1 - 0.5 * t * w)]; };
    },
    ui: { section: 'Colour', order: 90, controls: ['shadowsTint', { heading: 'Red primary' }, 'redHue', 'redSat', { heading: 'Green primary' }, 'greenHue', 'greenSat', { heading: 'Blue primary' }, 'blueHue', 'blueSat'] },
    agent: {
      summary: 'Calibration panel: shifts the hue and saturation of the red, green and blue primaries themselves (a 3×3 matrix in linear light, white preserved), plus a shadows green–magenta tint. Changes every colour coherently, like a camera profile.',
      tips: ['Popular cinematic base: redHue +10, redSat +5, greenHue -20, blueHue -40, blueSat +30.', 'Richer skin: redHue +8, redSat -10. Cleaner greens: greenHue +15, greenSat -10.', 'Positive shadowsTint is magenta, negative green.'],
      example: { type: 'calibration', p: { redHue: 10, greenHue: -20, blueHue: -40, blueSat: 30 } }
    }
  });

  /* White balance in Kelvin. The light the picture was taken under is assumed to be `temp` (CIE 1960 uv on Krystek's Planckian locus)
     offset across the locus by D65's own distance from it (≈ +0.0032 Δuv, so 6504 K and tint 0 are exactly D65) plus tint·0.0003, and
     adapted to D65 with Bradford, CAT16 or von Kries; the matrix is scaled to keep the luminance of white. A lower temperature makes
     the picture cooler, a higher one warmer (as in other editors); positive tint adds magenta. */
  var RGB2XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
  var XYZ2RGB = inv3(RGB2XYZ);
  var CATS = {
    bradford: [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296],
    cat16: [0.401288, 0.650173, -0.051461, -0.250268, 1.204414, 0.045854, -0.002079, 0.048952, 0.953127],
    'von-kries': [0.40024, 0.7076, -0.08081, -0.2263, 1.16532, 0.0457, 0, 0, 0.91822]
  };
  function planck(T) {
    return [(0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T),
      (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)];
  }
  function locusFrame(T) {
    var a = planck(T), b = planck(T + 2), tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1, nx = -ty / len, ny = tx / len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    return { uv: a, n: [nx, ny], t: [tx / len, ty / len] };
  }
  function uvOfXYZ(X) { var d = X[0] + 15 * X[1] + 3 * X[2]; return d > 0 ? [4 * X[0] / d, 6 * X[1] / d] : [0.2105, 0.3162]; }
  function xyzOfUV(uv) { var den = 2 * uv[0] - 8 * uv[1] + 4, x = 3 * uv[0] / den, y = 2 * uv[1] / den; return [x / y, 1, (1 - x - y) / y]; }
  var D65 = mat3vec(RGB2XYZ, [1, 1, 1]);
  var D65_DUV = (function () { var f = locusFrame(6504), uv = uvOfXYZ(D65); return (uv[0] - f.uv[0]) * f.n[0] + (uv[1] - f.uv[1]) * f.n[1]; })();
  function whiteOf(T, tint) { var f = locusFrame(T), d = D65_DUV + tint * 0.0003; return xyzOfUV([f.uv[0] + f.n[0] * d, f.uv[1] + f.n[1] * d]); }
  G.kelvinMatrix = function (T, tint, method) {
    var cat = CATS[method] || CATS.bradford, ws = mat3vec(cat, whiteOf(T, tint || 0)), wd = mat3vec(cat, D65);
    var m = mat3mul(XYZ2RGB, mat3mul(inv3(cat), mat3mul([wd[0] / ws[0], 0, 0, 0, wd[1] / ws[1], 0, 0, 0, wd[2] / ws[2]], mat3mul(cat, RGB2XYZ))));
    var y = 0.2126 * (m[0] + m[1] + m[2]) + 0.7152 * (m[3] + m[4] + m[5]) + 0.0722 * (m[6] + m[7] + m[8]);
    return m.map(function (v) { return v / y; });
  };
  reg({
    id: 'temperature', name: 'White balance (Kelvin)', group: 'color', version: 1, space: 'linear',
    params: {
      temp: { type: 'number', min: 2000, max: 15000, default: 6504, step: 10, unit: 'K', label: 'Temperature' },
      tint: { type: 'number', min: -150, max: 150, default: 0, step: 1, label: 'Tint' },
      method: { type: 'choice', options: [{ value: 'bradford', label: 'Bradford' }, { value: 'cat16', label: 'CAT16' }, { value: 'von-kries', label: 'Von Kries' }], default: 'bradford', label: 'Adaptation' }
    },
    passes: function (g, p) { if (p.temp === 6504 && !p.tint) return; g.color('uniform mat3 $m; vec3 $fx(vec3 c){ return $m * c; }', { m: G.kelvinMatrix(p.temp, p.tint, p.method) }); },
    ref: function (p) { if (p.temp === 6504 && !p.tint) return null; var m = G.kelvinMatrix(p.temp, p.tint, p.method); return function (c) { return mat3vec(m, c); }; },
    ui: { section: 'Colour', order: 5, controls: [{ param: 'temp', gradient: 'temperature', label: 'Temperature' }, { param: 'tint', gradient: 'tint' }, 'method', { action: 'grade.white-balance-pick' }, { action: 'grade.auto-white-balance' }] },
    agent: {
      summary: 'White balance in Kelvin with a real chromatic adaptation (Bradford default, CAT16, von Kries) in linear light. temp is the colour of the light the photo was taken under: 6504 K with tint 0 changes nothing; lower values cool the picture, higher values warm it. Complements the starter white-balance (relative −100…100).',
      tips: ['Tungsten-lit room shot as daylight: temp 3200. Shade: temp 7500. Golden warmth: temp 7200, tint 5.', 'Neutralise a grey card: LE.fx.grade.whiteBalanceFrom(sampleRGB) → { temp, tint }.', 'Auto: LE.fx.grade.auto(await LE.fx.analyze(target)).fx.', 'Put it first in the stack.'],
      example: { type: 'temperature', p: { temp: 5600, tint: 4 } }
    }
  });
  /* White-balance picker: the { temp, tint } that makes a sampled colour neutral. rgb is linear (default) or display ('display').
     Solves for the locus point whose normal passes through the sample's uv (golden-section search in mired), then reads the tint
     from the distance along the normal. Also returns the starter white-balance's units. */
  G.whiteBalanceFrom = function (rgb, space) {
    var c = space === 'display' ? toLin(rgb) : rgb.slice(0, 3);
    if (!(c[0] > 0 && c[1] > 0 && c[2] > 0)) return { temp: 6504, tint: 0, starter: { temperature: 0, tint: 0 }, ok: false };
    var uv = uvOfXYZ(mat3vec(RGB2XYZ, c));
    function err(mired) { var f = locusFrame(1e6 / mired), du = uv[0] - f.uv[0], dv = uv[1] - f.uv[1]; return Math.abs(du * f.t[0] + dv * f.t[1]); }
    var lo = 1e6 / 50000, hi = 1e6 / 1000, gr = (Math.sqrt(5) - 1) / 2;
    for (var i = 0; i < 80; i++) { var a = hi - gr * (hi - lo), b = lo + gr * (hi - lo); if (err(a) < err(b)) hi = b; else lo = a; }
    var T = 1e6 / ((lo + hi) / 2), f = locusFrame(T), duv = (uv[0] - f.uv[0]) * f.n[0] + (uv[1] - f.uv[1]) * f.n[1];
    var tint = (duv - D65_DUV) / 0.0003;
    return {
      temp: Math.round(clamp(T, 2000, 15000)), tint: Math.round(clamp(tint, -150, 150) * 10) / 10, ok: T >= 2000 && T <= 15000 && Math.abs(tint) <= 150,
      starter: { temperature: Math.round(clamp((1e6 / 6504 - 1e6 / T) / 0.9, -100, 100)), tint: Math.round(clamp(duv / 0.0003, -100, 100)) }
    };
  };

  /* ===================================================================================================================
     LUTS
     =================================================================================================================== */
  /* .cube parser (Adobe/Iridas and Resolve flavours): TITLE, LUT_1D_SIZE (2–4096), LUT_3D_SIZE (2–65), DOMAIN_MIN/MAX,
     LUT_1D_INPUT_RANGE / LUT_3D_INPUT_RANGE, comments. Read strictly as data: every data row must be exactly three finite numbers,
     unknown keywords are refused, the text is capped at 16 MB and the row count must match the declared sizes. When both sizes are
     present the 1D table is a shaper applied before the cube (Resolve). Data order: red fastest, then green, then blue. */
  var CUBE_MAX = 16 * 1024 * 1024;
  G.parseCube = function (text) {
    text = String(text == null ? '' : text);
    if (text.length > CUBE_MAX) throw new Error('This LUT file is larger than 16 MB.');
    var s1 = 0, s3 = 0, title = '', rows = [], dmin = null, dmax = null, r1 = null, r3 = null, lines = text.split(/\r\n|\r|\n/), num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
    function nums(parts, n, what) { if (parts.length !== n || !parts.every(function (q) { return num.test(q); })) throw new Error('Bad ' + what + ' line in this LUT.'); return parts.map(Number); }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/#.*$/, '').trim();
      if (!line) continue;
      var parts = line.split(/\s+/), key = parts[0].toUpperCase();
      if (num.test(parts[0])) {
        var v = nums(parts, 3, 'data');
        if (!v.every(isFinite)) throw new Error('This LUT has a number that is not finite.');
        rows.push(v[0], v[1], v[2]);
        if (rows.length > 3 * (4096 + 65 * 65 * 65)) throw new Error('This LUT has too many rows.');
        continue;
      }
      if (rows.length) throw new Error('This LUT has a keyword after its data (line ' + (i + 1) + ').');
      if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, '').replace(/[^\w #:.,()%\/+=-]/g, '').slice(0, 120); continue; }
      if (key === 'LUT_1D_SIZE') { s1 = nums(parts.slice(1), 1, 'size')[0]; if (!(s1 >= 2 && s1 <= 4096 && s1 % 1 === 0)) throw new Error('LUT_1D_SIZE must be 2 to 4096.'); continue; }
      if (key === 'LUT_3D_SIZE') { s3 = nums(parts.slice(1), 1, 'size')[0]; if (!(s3 >= 2 && s3 <= 65 && s3 % 1 === 0)) throw new Error('LUT_3D_SIZE must be 2 to 65.'); continue; }
      if (key === 'DOMAIN_MIN') { dmin = nums(parts.slice(1), 3, 'DOMAIN_MIN'); continue; }
      if (key === 'DOMAIN_MAX') { dmax = nums(parts.slice(1), 3, 'DOMAIN_MAX'); continue; }
      if (key === 'LUT_1D_INPUT_RANGE') { r1 = nums(parts.slice(1), 2, 'input range'); continue; }
      if (key === 'LUT_3D_INPUT_RANGE') { r3 = nums(parts.slice(1), 2, 'input range'); continue; }
      throw new Error('Unknown keyword "' + parts[0].slice(0, 24) + '" in this LUT.');
    }
    if (!s1 && !s3) throw new Error('This file has no LUT_1D_SIZE or LUT_3D_SIZE.');
    var want = (s1 ? s1 * 3 : 0) + (s3 ? s3 * s3 * s3 * 3 : 0);
    if (rows.length !== want) throw new Error('This LUT should have ' + want / 3 + ' rows; it has ' + rows.length / 3 + '.');
    var d0 = dmin || [0, 0, 0], d1 = dmax || [1, 1, 1];
    function dom(r) { return r ? { min: [r[0], r[0], r[0]], max: [r[1], r[1], r[1]] } : { min: d0, max: d1 }; }
    for (var k = 0; k < 3; k++) if (!(d1[k] > d0[k])) throw new Error('DOMAIN_MAX must be above DOMAIN_MIN.');
    var all = new Float32Array(rows), out = { title: title, kind: s1 && s3 ? 'shaper+3d' : s3 ? '3d' : '1d', size: s3 || s1 };
    if (s1) { out.size1 = s1; out.data1 = all.subarray(0, s1 * 3); var a = dom(r1); out.domain1 = a; }
    if (s3) { out.size3 = s3; out.data3 = all.subarray(s1 * 3); var b = dom(s1 && !r3 ? [0, 1] : r3); out.domain3 = b; }
    /* The shape LE.expert.controls.parseCube returns, so the workspace's LUT control can use this parser as is. */
    out.data = out.data3 || out.data1; out.domainMin = (out.domain3 || out.domain1).min; out.domainMax = (out.domain3 || out.domain1).max;
    return out;
  };
  /* LUTs by asset id (64-hex content hash, as LE.project.putAsset makes them). Looked up here, then in the workspace's cache
     (LE.expert.luts), then read from the project store in the background; the render shows no LUT until it arrives and then
     redraws (LE.fx.touch). */
  var LUTS = G.luts = G.luts || {}, pending = {};
  function normLut(l) {
    if (!l) return null;
    if (l.kind) return l;
    if (l.data && l.size) return { kind: '3d', size: l.size, size3: l.size, data3: l.data instanceof Float32Array ? l.data : new Float32Array(l.data), domain3: { min: l.domainMin || [0, 0, 0], max: l.domainMax || [1, 1, 1] }, title: l.title || '' };
    return null;
  }
  G.getLut = function (id) {
    if (!id) return null;
    if (LUTS[id]) return LUTS[id];
    var X = LE.expert && LE.expert.luts && LE.expert.luts[id];
    if (X && X.lut) { var n = normLut(X.lut); if (n) return (LUTS[id] = n); }
    if (!pending[id] && LE.project && LE.project.getAsset) {
      pending[id] = LE.project.getAsset(id).then(function (blob) { return blob && blob.size <= CUBE_MAX ? blob.text() : null; }).then(function (text) {
        if (text == null) return;
        LUTS[id] = G.parseCube(text);
        if (FX.touch) FX.touch();
      }).catch(function (e) { if (global.console) console.warn('LE.fx.grade: LUT ' + String(id).slice(0, 12) + ' could not be read: ' + (e && e.message)); });
    }
    return null;
  };
  function sha256hex(text) {
    var C = global.crypto && global.crypto.subtle;
    if (!C) return Promise.reject(new Error('No SHA-256 here.'));
    return C.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); });
  }
  /* Imports .cube text (or a File/Blob): parsed first (a bad file is refused before anything is stored), then stored as a project
     asset by content hash when LE.project is there, else only hashed; resolves to { id, title, kind, size }. */
  G.importCube = function (src, name) {
    var read = typeof src === 'string' ? Promise.resolve(src) : (src && src.size > CUBE_MAX ? Promise.reject(new Error('This LUT file is larger than 16 MB.')) : src.text());
    return read.then(function (text) {
      var lut = G.parseCube(text), nm = String(name || (src && src.name) || lut.title || 'look.cube').slice(0, 80);
      var put = LE.project && LE.project.putAsset ? LE.project.putAsset({ blob: new Blob([text], { type: 'text/plain' }), name: nm, type: 'text/plain' }).then(function (m) { return m.id; }) : sha256hex(text);
      return put.then(function (id) {
        LUTS[id] = lut;
        if (LE.expert && LE.expert.luts) LE.expert.luts[id] = { name: nm, size: lut.size, lut: lut };
        return { id: id, title: lut.title, kind: lut.kind, size: lut.size, name: nm };
      });
    });
  };
  /* Tetrahedral interpolation in a size³ cube (red fastest), JS twin of the shader below. */
  function tetra(d, n, c) {
    var p = [0, 1, 2].map(function (k) { return clamp(c[k], 0, 1) * (n - 1); }), b = p.map(function (v) { return Math.min(Math.floor(v), n - 2); }), f = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    function at(dr, dg, db) { var i = ((b[2] + db) * n + (b[1] + dg)) * n + (b[0] + dr); return [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]]; }
    var c000 = at(0, 0, 0), c111 = at(1, 1, 1), A, B, w;
    if (f[0] >= f[1]) {
      if (f[1] >= f[2]) { A = at(1, 0, 0); B = at(1, 1, 0); w = [f[0], f[1], f[2]]; }
      else if (f[0] >= f[2]) { A = at(1, 0, 0); B = at(1, 0, 1); w = [f[0], f[2], f[1]]; }
      else { A = at(0, 0, 1); B = at(1, 0, 1); w = [f[2], f[0], f[1]]; }
    } else {
      if (f[2] > f[1]) { A = at(0, 0, 1); B = at(0, 1, 1); w = [f[2], f[1], f[0]]; }
      else if (f[2] > f[0]) { A = at(0, 1, 0); B = at(0, 1, 1); w = [f[1], f[2], f[0]]; }
      else { A = at(0, 1, 0); B = at(1, 1, 0); w = [f[1], f[0], f[2]]; }
    }
    return [0, 1, 2].map(function (k) { return c000[k] + w[0] * (A[k] - c000[k]) + w[1] * (B[k] - A[k]) + w[2] * (c111[k] - B[k]); });
  }
  G.tetra = tetra;
  var TETRA_GL = 'vec3 $f(ivec3 i){ return texelFetch($t, i, 0).rgb; }\n' +
    'vec3 $tet(vec3 c){ float n = float(textureSize($t, 0).x); vec3 p = clamp(c, 0.0, 1.0) * (n - 1.0); vec3 b = min(floor(p), vec3(n - 2.0)); vec3 f = p - b; ivec3 i = ivec3(b);\n' +
    '  vec3 c0 = $f(i), c1 = $f(i + ivec3(1)), A, B; vec3 w;\n' +
    '  if (f.r >= f.g) { if (f.g >= f.b) { A = $f(i + ivec3(1, 0, 0)); B = $f(i + ivec3(1, 1, 0)); w = f.rgb; } else if (f.r >= f.b) { A = $f(i + ivec3(1, 0, 0)); B = $f(i + ivec3(1, 0, 1)); w = f.rbg; } else { A = $f(i + ivec3(0, 0, 1)); B = $f(i + ivec3(1, 0, 1)); w = f.brg; } }\n' +
    '  else { if (f.b > f.g) { A = $f(i + ivec3(0, 0, 1)); B = $f(i + ivec3(0, 1, 1)); w = f.bgr; } else if (f.b > f.r) { A = $f(i + ivec3(0, 1, 0)); B = $f(i + ivec3(0, 1, 1)); w = f.gbr; } else { A = $f(i + ivec3(0, 1, 0)); B = $f(i + ivec3(1, 1, 0)); w = f.grb; } }\n' +
    '  return c0 + w.x * (A - c0) + w.y * (B - A) + w.z * (c1 - B); }\n';
  /* Built-in looks, generated here from this pack's own effects and baked to 33³ through their CPU references (no LUT files). */
  var LOOKS = {
    'teal-orange': [{ type: 'color-grading', p: { shadows: { h: 195, a: 0.42, l: -0.05 }, highlights: { h: 32, a: 0.34, l: 0 }, midtones: { h: 25, a: 0.06, l: 0 }, balance: 5 } }, { type: 'hsl', p: { mixer: [{ h: 0, s: 0, l: 0 }, { h: 0, s: 12, l: 4 }, { h: -15, s: -20, l: 0 }, { h: 40, s: -45, l: -10 }, { h: -10, s: 10, l: -5 }, { h: -25, s: 0, l: -10 }, { h: -20, s: -20, l: 0 }, { h: 0, s: -10, l: 0 }] } }, { type: 'tone-curve', p: { lights: 10, darks: -12 } }],
    'warm-film': [{ type: 'tone-curve', p: { curve: { master: [[0, 0.05], [0.25, 0.23], [0.75, 0.8], [1, 0.96]] }, mode: 'luminosity' } }, { type: 'color-grading', p: { highlights: { h: 42, a: 0.22, l: 0 }, shadows: { h: 200, a: 0.1, l: 0 }, blending: 70 } }, { type: 'vibrance', p: { amount: -15 } }],
    'cool-film': [{ type: 'tone-curve', p: { curve: { master: [[0, 0.04], [0.3, 0.27], [0.7, 0.74], [1, 0.97]] }, mode: 'luminosity' } }, { type: 'color-grading', p: { global: { h: 205, a: 0.12, l: 0 }, highlights: { h: 50, a: 0.06, l: 0 } } }, { type: 'vibrance', p: { amount: -20 } }],
    'bleach-bypass': [{ type: 'hue-curves', p: { satSat: { master: [[0, 0.3], [1, 0.25]] } } }, { type: 'tone-curve', p: { lights: 25, darks: -25, highlights: 10, mode: 'luminosity' } }],
    'cross-process': [{ type: 'tone-curve', p: { curve: { r: [[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]], g: [[0, 0], [0.25, 0.22], [0.75, 0.82], [1, 1]], b: [[0, 0.12], [1, 0.86]] } } }, { type: 'vibrance', p: { amount: 25, protect: 0 } }],
    'faded-matte': [{ type: 'tone-curve', p: { curve: { master: [[0, 0.1], [0.5, 0.5], [1, 0.92]] } } }, { type: 'vibrance', p: { amount: -30 } }, { type: 'color-grading', p: { shadows: { h: 220, a: 0.08, l: 0 } } }],
    'golden-hour': [{ type: 'temperature', p: { temp: 7600, tint: 6 } }, { type: 'color-grading', p: { highlights: { h: 38, a: 0.2, l: 0.05 }, midtones: { h: 28, a: 0.08, l: 0 } } }, { type: 'vibrance', p: { amount: 15 } }],
    'silver-mono': [{ type: 'bw-mix', p: { convert: true, reds: 70, yellows: 80, greens: 40, cyans: 30, blues: 0, magentas: 60 } }, { type: 'tone-curve', p: { lights: 15, darks: -18 } }],
    'night-blue': [{ type: 'temperature', p: { temp: 4200, tint: -4 } }, { type: 'exposure', p: { ev: -0.6 } }, { type: 'tone-curve', p: { shadows: -20, highlights: -15, mode: 'luminosity' } }, { type: 'vibrance', p: { amount: -25 } }]
  };
  var LOOK_NAMES = { none: 'None', 'teal-orange': 'Teal and orange', 'warm-film': 'Warm film', 'cool-film': 'Cool film', 'bleach-bypass': 'Bleach bypass', 'cross-process': 'Cross process', 'faded-matte': 'Faded matte', 'golden-hour': 'Golden hour', 'silver-mono': 'Silver mono', 'night-blue': 'Night blue' };
  G.looks = function () { return Object.keys(LOOKS).map(function (k) { return { id: k, name: LOOK_NAMES[k], fx: JSON.parse(JSON.stringify(LOOKS[k])) }; }); };
  var lookCache = {};
  function lookLut(id) {
    if (!LOOKS[id]) return null;
    return lookCache[id] || (lookCache[id] = { kind: '3d', size3: 33, data3: G.bake(LOOKS[id], 33).data, domain3: { min: [0, 0, 0], max: [1, 1, 1] }, title: LOOK_NAMES[id] });
  }
  function lutFor(p) { return p.lut ? G.getLut(p.lut) : (p.look !== 'none' ? lookLut(p.look) : null); }
  reg({
    id: 'lut', name: 'LUT', group: 'color', version: 1, space: 'display',
    params: {
      lut: { type: 'lut', label: 'LUT file' },
      look: { type: 'choice', options: Object.keys(LOOK_NAMES).map(function (k) { return { value: k, label: LOOK_NAMES[k] }; }), default: 'none', label: 'Built-in look' },
      intensity: { type: 'number', min: 0, max: 100, default: 100, step: 1, unit: '%', label: 'Intensity' },
      input: { type: 'choice', options: [{ value: 'display', label: 'sRGB / Rec. 709' }, { value: 'linear', label: 'Linear' }], default: 'display', label: 'Input space' }
    },
    passes: function (g, p) {
      var L = lutFor(p);
      if (!L || !p.intensity) return;
      var has3 = !!L.data3, has1 = !!L.data1, d3 = L.domain3 || { min: [0, 0, 0], max: [1, 1, 1] }, d1 = L.domain1 || d3;
      var t3 = has3 ? g.lut3d(L.data3, L.size3) : g.lut3d(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]), 2);
      var t1 = has1 ? g.lut1d(L.data1, 3) : g.lut1d(new Float32Array([0, 0, 0, 1, 1, 1]), 3);
      g.color('uniform mediump sampler3D $t; uniform sampler2D $u; uniform vec4 $o; uniform vec3 $a0, $a1, $b0, $b1;\n' + TETRA_GL +
        'vec3 $fx(vec3 c){ vec3 x = $o.w > 0.5 ? toLinear(c) : c;\n' +
        '  if ($o.y > 0.5) x = lut1rgb($u, (x - $a0) / ($a1 - $a0));\n' +
        '  if ($o.x > 0.5) x = $tet((x - $b0) / ($b1 - $b0));\n' +
        '  if ($o.w > 0.5) x = toDisplay(x); return mix(c, x, $o.z); }',
      { t: t3, u: t1, o: [has3 ? 1 : 0, has1 ? 1 : 0, p.intensity / 100, p.input === 'linear' ? 1 : 0], a0: d1.min, a1: d1.max, b0: d3.min, b1: d3.max });
    },
    ref: function (p) {
      var L = lutFor(p);
      if (!L || !p.intensity) return null;
      var k = p.intensity / 100, lnr = p.input === 'linear';
      return function (c) {
        var x = lnr ? toLin(c) : c.slice();
        if (L.data1) { var a = L.domain1; x = [0, 1, 2].map(function (q) { return tab(L.data1, 3, (x[q] - a.min[q]) / (a.max[q] - a.min[q]), q); }); }
        if (L.data3) { var b = L.domain3; x = tetra(L.data3, L.size3, [0, 1, 2].map(function (q) { return (x[q] - b.min[q]) / (b.max[q] - b.min[q]); })); }
        if (lnr) x = toDsp(x);
        return [0, 1, 2].map(function (q) { return mix(c[q], x[q], k); });
      };
    },
    ui: { section: 'Colour grading', order: 90, controls: ['lut', 'look', 'intensity', 'input', { action: 'grade.import-cube' }, { action: 'grade.export-cube' }] },
    agent: {
      summary: 'Applies a .cube LUT (1D, 3D up to 65³, or shaper + 3D; tetrahedral interpolation) or a built-in look generated by this pack. lut is a project asset id (64-hex, from LE.fx.grade.importCube(text)); when lut is set it wins over look. intensity blends it; input says what encoding the LUT expects.',
      tips: ['Built-in looks: teal-orange, warm-film, cool-film, bleach-bypass, cross-process, faded-matte, golden-hour, silver-mono, night-blue.', 'Looks are strong: intensity 40–70 is usual.', 'Grade exposure and white balance before the LUT; creative LUTs assume a normal display picture.', 'Export the colour part of a layer as a LUT: LE.fx.grade.exportCube(layer.fx).text.'],
      example: { type: 'lut', p: { look: 'teal-orange', intensity: 60 } }
    }
  });

  /* ===================================================================================================================
     CPU references for the starter colour effects (le-fx-basic.js), mirroring their shaders, so a whole stack can be baked.
     =================================================================================================================== */
  var STARTER = {
    exposure: function (p) { var k = Math.pow(2, p.ev); return function (c) { return [c[0] * k, c[1] * k, c[2] * k]; }; },
    contrast: function (p) {
      var k = M.contrastK(p.amount), q = p.pivot;
      return function (c) { return c.map(function (v) { var x = clamp(v, 0, 1), o = x < q ? q * Math.pow(x / q, k) : 1 - (1 - q) * Math.pow((1 - x) / (1 - q), k); return o + (v - x); }); };
    },
    'highlights-shadows': function (p) {
      var t = M.toneLUT(p, 256);
      return function (c) { var l = clamp(luma(c), 0, 1), v = tab(t, 1, l, 0), w = sstep(0.02, 0.3, l), r = v / Math.max(l, 1e-4); return c.map(function (x) { return mix(x + (v - l), x * r, w); }); };
    },
    levels: function (p) { return function (c) { return c.map(function (v) { return Math.pow(clamp((v - p.inBlack) / Math.max(p.inWhite - p.inBlack, 1e-4), 0, 1), 1 / p.gamma) * (p.outWhite - p.outBlack) + p.outBlack; }); }; },
    curves: function (p) { var t = M.curveTable(p.curve, 1024); return function (c) { return [tab(t, 3, c[0], 0), tab(t, 3, c[1], 1), tab(t, 3, c[2], 2)]; }; },
    'white-balance': function (p) { var m = M.wbMatrix(p.temperature, p.tint); return function (c) { return mat3vec(m, c); }; },
    saturation: function (p) {
      var a = 1 + p.saturation / 100, v = p.vibrance / 100;
      return function (c) { var l = luma(c), s = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]), k = Math.max(a * (1 + v * (1 - clamp(s * 1.5, 0, 1))), 0); return c.map(function (x) { return l + (x - l) * k; }); };
    }
  };
  Object.keys(STARTER).forEach(function (k) { if (!REF[k]) REF[k] = STARTER[k]; });

  /* ===================================================================================================================
     Baking and .cube export
     =================================================================================================================== */
  /* Runs a stack through the CPU references. Returns { fn(rgbDisplay) → rgbDisplay, used: [ids], skipped: [{ index, type, reason }] }.
     Entries that are off, at amount 0 or neutral are left out; entries with a mask, a blend other than normal, a spatial effect or
     no CPU reference are skipped and reported (a LUT cannot hold them). */
  G.compile = function (stack) {
    var steps = [], skipped = [], used = [];
    (Array.isArray(stack) ? stack : []).forEach(function (e, i) {
      if (!e || e.on === false) return;
      var v = FX.validate(e);
      if (!v.ok) { skipped.push({ index: i, type: e.type, reason: 'not a known effect' }); return; }
      var en = v.entry, d = FX.get(en.type);
      if (en.amount === 0) return;
      if (en.mask && en.mask.parts && en.mask.parts.length) { skipped.push({ index: i, type: en.type, reason: 'has a mask' }); return; }
      if (en.blend !== 'normal') { skipped.push({ index: i, type: en.type, reason: 'blend ' + en.blend }); return; }
      if (!REF[en.type] || (d.needs && d.needs.length) || (typeof d.radius === 'function' && d.radius(en.p, 1) > 0)) { skipped.push({ index: i, type: en.type, reason: 'not a per-pixel colour effect' }); return; }
      var f = REF[en.type](en.p);
      if (!f) return;
      steps.push({ f: f, linear: d.space === 'linear', amount: en.amount });
      used.push(en.type);
    });
    function fn(c) {
      var x = c.slice(), lnr = false;
      steps.forEach(function (s) {
        if (s.linear !== lnr) { x = s.linear ? toLin(x) : toDsp(x); lnr = s.linear; }
        var o = s.f(x);
        x = s.amount < 1 ? [0, 1, 2].map(function (k) { return mix(x[k], o[k], s.amount); }) : o;
      });
      return lnr ? toDsp(x) : x;
    }
    return { fn: fn, used: used, skipped: skipped };
  };
  /* A stack as a size³ table (display in, display out, red fastest), clamped to 0–1. */
  G.bake = function (stack, size) {
    size = clamp(Math.round(size || 33), 2, 65);
    var r = G.compile(stack), n = size, data = new Float32Array(n * n * n * 3), i = 0;
    for (var b = 0; b < n; b++) for (var g2 = 0; g2 < n; g2++) for (var rr = 0; rr < n; rr++) {
      var o = r.fn([rr / (n - 1), g2 / (n - 1), b / (n - 1)]);
      data[i++] = clamp(o[0], 0, 1); data[i++] = clamp(o[1], 0, 1); data[i++] = clamp(o[2], 0, 1);
    }
    return { data: data, size: n, used: r.used, skipped: r.skipped };
  };
  /* The colour-only part of a layer's stack (a layer, or its fx list) as .cube text. Returns { text, size, used, skipped }. */
  G.exportCube = function (layerOrStack, o) {
    o = o || {};
    var stack = Array.isArray(layerOrStack) ? layerOrStack : (layerOrStack && layerOrStack.fx) || [];
    var b = G.bake(stack, o.size || 33), lines = ['# Made with LocalEditor from: ' + (b.used.join(', ') || 'nothing (identity)'), 'TITLE "' + String(o.title || 'LocalEditor grade').replace(/[^\w #:.,()%\/+=-]/g, '').slice(0, 80) + '"', 'LUT_3D_SIZE ' + b.size, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
    for (var i = 0; i < b.data.length; i += 3) lines.push(b.data[i].toFixed(6) + ' ' + b.data[i + 1].toFixed(6) + ' ' + b.data[i + 2].toFixed(6));
    return { text: lines.join('\n') + '\n', size: b.size, used: b.used, skipped: b.skipped };
  };

  /* ===================================================================================================================
     Auto white balance and auto tone (pure functions of LE.fx.analyze / g.stats() statistics)
     =================================================================================================================== */
  G.auto = function (stats, o) {
    o = o || {};
    var fx = [], notes = [];
    var wb = G.auto.whiteBalance(stats);
    if (wb && o.whiteBalance !== false) fx.push(wb.entry); else if (o.whiteBalance !== false) notes.push('No reliable neutral found; white balance left alone.');
    var t = G.auto.tone(stats, o);
    if (t) fx.push(t.entry); else notes.push('Tone already uses the full range.');
    return { fx: fx, notes: notes.concat(wb ? wb.notes : [], t ? t.notes : []) };
  };
  /* From whiteBalance.neutral (display RGB of the near-neutral pixels): a temperature entry, or null when there is little to fix
     or the estimate is weak (grey-world with low confidence). */
  G.auto.whiteBalance = function (stats) {
    var w = stats && stats.whiteBalance;
    if (!w || !w.neutral) return null;
    var r = G.whiteBalanceFrom(w.neutral, 'display'), notes = [];
    if (!r.ok) return null;
    var conf = w.confidence == null ? 0.5 : w.confidence, k = w.method === 'near-neutral' ? Math.min(1, 0.4 + conf) : 0.5;
    var temp = Math.round(6504 + (r.temp - 6504) * k), tint = Math.round(r.tint * k * 10) / 10;
    if (Math.abs(1e6 / temp - 1e6 / 6504) < 4 && Math.abs(tint) < 3) return null;
    if (k < 1) notes.push('White balance applied at ' + Math.round(k * 100) + ' % (' + w.method + ', confidence ' + conf + ').');
    return { entry: { type: 'temperature', p: { temp: temp, tint: tint } }, measured: r, notes: notes };
  };
  /* From luminance percentiles: levels that put p0.5-ish blacks at 0 and p99.5-ish whites at 1 (never clipping more than ~0.5 %) and
     a mid-tone gamma that moves the median towards `target` (0.46 default), limited to 0.7–1.5. */
  G.auto.tone = function (stats, o) {
    o = o || {};
    var P = stats && stats.percentiles && stats.percentiles.luma;
    if (!P) return null;
    var clipLo = stats.clipping && stats.clipping.shadows ? stats.clipping.shadows.all || 0 : 0, clipHi = stats.clipping && stats.clipping.highlights ? stats.clipping.highlights.all || 0 : 0;
    var bk = clamp(P.p1 - 0.01, 0, 0.25), wt = clamp(P.p99 + 0.01, 0.6, 1);
    if (clipLo > 0.005) bk = 0;
    if (clipHi > 0.005) wt = 1;
    var mid = clamp((P.p50 - bk) / Math.max(wt - bk, 1e-3), 0.02, 0.98), target = o.target || 0.46;
    var gamma = clamp(Math.log(mid) / Math.log(target), 0.7, 1.5);
    gamma = Math.round(gamma * 100) / 100; bk = Math.round(bk * 1000) / 1000; wt = Math.round(wt * 1000) / 1000;
    if (bk < 0.004 && wt > 0.996 && Math.abs(gamma - 1) < 0.03) return null;
    return { entry: { type: 'levels', p: { inBlack: bk, inWhite: wt, gamma: gamma, outBlack: 0, outWhite: 1 } }, notes: [] };
  };
  /* Convenience: analyse a target and return the auto entries. */
  G.autoFor = function (target, o) { return FX.analyze(target).then(function (s) { return G.auto(s, o); }); };

  /* ===================================================================================================================
     Named grading presets (plain data): each is a list of fx entries an agent or the interface applies in order.
     LE.fx.grade.preset(id) returns validated copies; LE.fx.grade.presetOps(layerId, id) returns LE.fx.ops operations.
     =================================================================================================================== */
  var PRESETS = [
    { id: 'teal-orange', name: 'Teal and orange', summary: 'Blockbuster complementary grade: teal shadows, warm skin and highlights.', fx: [
      { type: 'color-grading', p: { shadows: { h: 195, a: 0.38, l: -0.04 }, highlights: { h: 33, a: 0.28, l: 0 }, balance: 8 } },
      { type: 'hsl', p: { mixer: [{ h: 0, s: 0, l: 0 }, { h: 0, s: 10, l: 5 }, { h: -12, s: -15, l: 0 }, { h: 35, s: -40, l: -10 }, { h: -10, s: 12, l: -5 }, { h: -20, s: 0, l: -8 }, { h: 0, s: -15, l: 0 }, { h: 0, s: -10, l: 0 }] } },
      { type: 'tone-curve', p: { lights: 10, darks: -12, mode: 'luminosity' } }] },
    { id: 'filmic-fade', name: 'Filmic fade', summary: 'Lifted matte blacks, soft roll-off, muted colour, warm highlights.', fx: [
      { type: 'tone-curve', p: { curve: { master: [[0, 0.07], [0.25, 0.24], [0.75, 0.79], [1, 0.95]] }, mode: 'luminosity' } },
      { type: 'color-grading', p: { shadows: { h: 215, a: 0.12, l: 0 }, highlights: { h: 42, a: 0.12, l: 0 }, blending: 70 } },
      { type: 'hue-curves', p: { lumSat: { master: [[0, 0.3], [0.35, 0.5], [1, 0.48]] } } }, { type: 'vibrance', p: { amount: -15 } }] },
    { id: 'clean-product-white', name: 'Clean product white', summary: 'Neutral, bright, cast-free whites with crisp but natural colour.', fx: [
      { type: 'selective-color-tones', p: { method: 'absolute', whitesY: -5, whitesK: -8, neutralsY: -3 } },
      { type: 'tone-curve', p: { highlights: 12, lights: 8, darks: -4 } }, { type: 'vibrance', p: { amount: 10, protect: 50 } }] },
    { id: 'warm-portrait', name: 'Warm portrait', summary: 'Flattering warm skin, even tones, gentle contrast.', fx: [
      { type: 'temperature', p: { temp: 6900, tint: 3 } }, { type: 'skin-tone', p: { uniformity: 35, evenness: 20, hue: 4 } },
      { type: 'color-grading', p: { midtones: { h: 30, a: 0.08, l: 0 }, highlights: { h: 40, a: 0.08, l: 0 } } },
      { type: 'tone-curve', p: { lights: 8, darks: -8, mode: 'luminosity' } }, { type: 'vibrance', p: { amount: 15, protect: 90 } }] },
    { id: 'cool-cinematic', name: 'Cool cinematic', summary: 'Desaturated steel blues, deep shadows, restrained highlights.', fx: [
      { type: 'temperature', p: { temp: 5600, tint: -3 } }, { type: 'calibration', p: { blueHue: -30, blueSat: 20, greenHue: -15 } },
      { type: 'color-grading', p: { shadows: { h: 210, a: 0.25, l: -0.05 }, highlights: { h: 190, a: 0.08, l: 0 } } },
      { type: 'tone-curve', p: { darks: -15, highlights: -10, mode: 'luminosity' } }, { type: 'vibrance', p: { amount: -20 } }] },
    { id: 'bleach-bypass', name: 'Bleach bypass', summary: 'Hard, silvery, low-saturation contrast.', fx: [
      { type: 'hue-curves', p: { satSat: { master: [[0, 0.32], [1, 0.26]] } } }, { type: 'tone-curve', p: { lights: 25, darks: -25, highlights: 10, mode: 'luminosity' } }] },
    { id: 'moody-forest', name: 'Moody forest', summary: 'Deep olive greens, muted yellows, cool shadows.', fx: [
      { type: 'hsl', p: { mixer: [{ h: 0, s: 0, l: 0 }, { h: 0, s: -10, l: 0 }, { h: -20, s: -30, l: -10 }, { h: 25, s: -40, l: -25 }, { h: 10, s: -30, l: -15 }, { h: 0, s: -10, l: 0 }, { h: 0, s: 0, l: 0 }, { h: 0, s: 0, l: 0 }] } },
      { type: 'color-grading', p: { shadows: { h: 200, a: 0.18, l: -0.05 }, highlights: { h: 45, a: 0.08, l: 0 } } }, { type: 'tone-curve', p: { darks: -10, shadows: 6 } }] },
    { id: 'golden-hour', name: 'Golden hour', summary: 'Late-sun warmth with glowing highlights.', fx: [
      { type: 'temperature', p: { temp: 7600, tint: 6 } }, { type: 'color-grading', p: { highlights: { h: 38, a: 0.2, l: 0.05 }, midtones: { h: 28, a: 0.08, l: 0 } } }, { type: 'vibrance', p: { amount: 15 } }] },
    { id: 'nordic-matte', name: 'Nordic matte', summary: 'Pale, airy, cool and low contrast.', fx: [
      { type: 'tone-curve', p: { curve: { master: [[0, 0.1], [0.5, 0.53], [1, 0.95]] } } }, { type: 'temperature', p: { temp: 6000, tint: 0 } }, { type: 'vibrance', p: { amount: -35 } }] },
    { id: 'high-key-airy', name: 'High-key airy', summary: 'Bright, soft and clean with lifted mid-tones.', fx: [
      { type: 'tone-curve', p: { lights: 18, darks: 10, shadows: 15, mode: 'luminosity' } }, { type: 'selective-color-tones', p: { method: 'absolute', whitesY: -4 } }, { type: 'vibrance', p: { amount: -10 } }] },
    { id: 'noir', name: 'Noir', summary: 'Contrasty black and white with deep blacks.', fx: [
      { type: 'bw-mix', p: { convert: true, reds: 60, yellows: 90, greens: 30, cyans: 20, blues: -20, magentas: 50 } }, { type: 'tone-curve', p: { lights: 25, darks: -30, shadows: -10 } }] },
    { id: 'vintage-cross', name: 'Vintage cross-process', summary: 'Yellow-green highlights, blue blacks, punchy colour.', fx: [
      { type: 'tone-curve', p: { curve: { r: [[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]], g: [[0, 0], [0.25, 0.22], [0.75, 0.82], [1, 1]], b: [[0, 0.12], [1, 0.86]] } } }, { type: 'vibrance', p: { amount: 20, protect: 30 } }] }
  ];
  G.presets = PRESETS;
  G.preset = function (id) {
    var pr = PRESETS.filter(function (x) { return x.id === id; })[0];
    return pr ? pr.fx.map(function (e) { return FX.validate(e).entry; }) : null;
  };
  G.presetOps = function (layerId, id) {
    var list = G.preset(id);
    return list ? list.map(function (e) { return { op: 'fx.add', layer: layerId, entry: { type: e.type, p: e.p } }; }) : null;
  };

  /* ===================================================================================================================
     Actions (LE.fx.actions, docs/FX-AUTHORING.md "Actions"): the buttons in this pack's panels, and the same calls for agents.
     Each is a pure function of what it is handed and answers with data; the caller applies it.
     =================================================================================================================== */
  if (FX.actions) {
    FX.actions.register({ id: 'grade.auto', label: 'Auto', needs: ['stats'], summary: 'White balance and tone from the picture\'s own statistics.',
      run: function (ctx) { var r = G.auto(ctx.stats || {}); return { fx: r.fx, message: r.notes.join(' ') }; } });
    FX.actions.register({ id: 'grade.auto-white-balance', label: 'Auto white balance', needs: ['stats'], summary: 'A temperature and tint that make the near-neutral pixels neutral.',
      run: function (ctx) { var r = G.auto.whiteBalance(ctx.stats || {}); return r ? { fx: [r.entry], message: r.notes.join(' ') } : { message: 'No reliable neutral found; white balance left alone.' }; } });
    FX.actions.register({ id: 'grade.white-balance-pick', label: 'Pick a neutral', kind: 'pick', summary: 'Click something that should be grey or white; temperature and tint are set to make it neutral.',
      run: function (ctx) {
        var r = ctx.pick && ctx.pick.linear ? G.whiteBalanceFrom(ctx.pick.linear) : null;
        return r && r.ok ? { fx: [{ type: 'temperature', p: { temp: Math.round(r.temp / 10) * 10, tint: Math.round(r.tint * 10) / 10 } }] } : { message: 'That point is too dark or too coloured to balance from.' };
      } });
    FX.actions.register({ id: 'grade.export-cube', label: 'Export .cube', kind: 'export', summary: 'The colour-only part of this layer\'s stack as a 33-point .cube LUT.',
      run: function (ctx) { var r = G.exportCube(ctx.stack); return { download: { name: 'localeditor-grade.cube', text: r.text, type: 'text/plain' }, message: r.skipped && r.skipped.length ? 'Left out (not colour-only): ' + r.skipped.join(', ') + '.' : '' }; } });
    FX.actions.register({ id: 'grade.import-cube', label: 'Import .cube', kind: 'import', accept: '.cube,text/plain', summary: 'Reads a .cube LUT, stores it with the project and applies it.',
      run: function (ctx) { return G.importCube(ctx.text || '', ctx.name).then(function (m) { return { fx: [{ type: 'lut', p: { lut: m.id } }] }; }); } });
  }
})(window);
