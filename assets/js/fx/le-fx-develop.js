/* LocalEditor effect pack "develop" (Expert step X5): RAW develop and HDR tone mapping. Contract: docs/FX-AUTHORING.md.
 *
 *   develop.basic     Profile, white balance (camera matrices), exposure, highlight recovery, tone (filmic), presence. One merged colour pass.
 *   develop.detail    Capture sharpening and noise reduction on scene-linear data (raw-stage versions; the creative pack has generic ones).
 *   develop.lens      Lens corrections: distortion, vignetting, lateral chromatic aberration, defringe.
 *   develop.tonemap   HDR tone mapping: global (log compression), local (base/detail with a guided filter), fusion-style local exposure.
 *
 * Colour model (said once, used everywhere in this file):
 *   - Scene-referred values travel between effects as LINEAR light in Rec. 709 / sRGB primaries with UNBOUNDED range: above 1 is
 *     brighter than diffuse white, below 0 is a colour outside the sRGB gamut. Half-float textures keep both. RAW layers enter here
 *     already white-balanced (as shot) and converted from camera RGB with the camera's own matrices (assets/js/raw/le-raw-layer.js);
 *     HDR merges enter as merged radiance in the same space.
 *   - develop.basic is the OUTPUT TRANSFORM: (1) relative white balance as one 3x3 (camera-accurate: built by LE.raw.matrix from the
 *     camera's ColorMatrix/ForwardMatrix for the chosen kelvin and tint, injected by the RAW layer; a Bradford adaptation otherwise),
 *     (2) gamut compression into sRGB with the distance formula of the ACES 1.3 Reference Gamut Compression (threshold 0.8, limit 1.25,
 *     power 1.2), (3) a hue-preserving filmic tone curve on Rec. 709 luminance (documented at toneTable below), (4) saturation and
 *     vibrance, highlight desaturation and a "path to white" so no channel clips with a hue shift. Its output is display-referred
 *     linear sRGB in 0..1; everything after it in a stack is ordinary display editing.
 *   - The studio compositor is sRGB, so the output gamut is sRGB. A wide-gamut (Display P3) export would need the compression to
 *     target P3 instead; that is one constant (proposal in the X5 report).
 *
 * On a RAW or HDR layer the develop entries run first, before anything else on the layer, in the fixed order
 * lens -> detail -> tonemap -> basic, whatever their place in layer.fx (the render order of docs/EXPERT-MODE.md: source -> RAW develop ->
 * ... -> fx stack). On other layers they run where they are, as ordinary effects.
 *
 * Also in this file, behind a clearly marked seam: the float-source provider registry (LE.fx.sources) and the wrapper of LE.fx.layer
 * that draws RAW and HDR layers from their decoded data instead of their 8-bit fallback picture.
 */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;
  var M = FX.math;
  var PACK_BASE = (function () { try { var s = document.currentScript; if (s && s.src) return s.src.replace(/[^/]*$/, ''); } catch (e) { } return null; })();
  var GPU = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 120 };
  var LUMA = [0.2126, 0.7152, 0.0722];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function softplus(x) { return x > 30 ? x : Math.log(1 + Math.exp(x)); }
  function mul3(a, b) { var o = []; for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]); return o; }
  function vec3(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  var I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function isIdent(m) { for (var i = 0; i < 9; i++) if (Math.abs(m[i] - I3[i]) > 1e-7) return false; return true; }

  /* ================================================================== white balance */
  /* Kelvin presets (the usual names and values of RAW developers). */
  var WB_PRESETS = { daylight: [5500, 10], cloudy: [6500, 10], shade: [7500, 10], tungsten: [2850, 0], fluorescent: [3800, 21], flash: [5500, 0] };
  var RGB2XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
  var XYZ2RGB = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252];
  var BRAD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296], BRAD_INV = FX.quad.invert(BRAD);
  /* Kim et al. (2002) Planckian locus and a Duv offset (the same convention as LERawCore: Duv = tint * 0.0002, positive = greener light). */
  function planckXY(T) {
    T = clamp(T, 1667, 25000); var x, y;
    if (T <= 4000) x = -0.2661239e9 / (T * T * T) - 0.2343589e6 / (T * T) + 0.8776956e3 / T + 0.179910; else x = -3.0258469e9 / (T * T * T) + 2.1070379e6 / (T * T) + 0.2226347e3 / T + 0.240390;
    if (T <= 2222) y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683; else if (T <= 4000) y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867; else y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
    return [x, y];
  }
  function xyToUV(xy) { var d = -2 * xy[0] + 12 * xy[1] + 3; return [4 * xy[0] / d, 6 * xy[1] / d]; }
  function uvToXY(uv) { var d = 2 * uv[0] - 8 * uv[1] + 4; return [3 * uv[0] / d, 2 * uv[1] / d]; }
  function whiteXY(T, tint) {
    var uv = xyToUV(planckXY(T)), a = xyToUV(planckXY(T - 20)), b = xyToUV(planckXY(T + 20)), tx = b[0] - a[0], ty = b[1] - a[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
    var nx = -ty / l, ny = tx / l; if (ny < 0) { nx = -nx; ny = -ny; }
    return uvToXY([uv[0] + nx * (tint || 0) * 0.0002, uv[1] + ny * (tint || 0) * 0.0002]);
  }
  function xyz(xy) { return [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]]; }
  /* Generic relative white balance for pictures without camera data (JPEG brackets, ordinary photos): the light is assumed to have
     been D65 (6504 K, tint +16, where D65 sits in this convention); choosing another kelvin adapts from that light to D65 (Bradford). */
  var ASSUMED = [6504, 16];
  function genericWB(T, tint) {
    var ws = xyz(whiteXY(T, tint)), wd = xyz(whiteXY(ASSUMED[0], ASSUMED[1])), ls = vec3(BRAD, ws), ld = vec3(BRAD, wd);
    return mul3(XYZ2RGB, mul3(BRAD_INV, mul3([ld[0] / ls[0], 0, 0, 0, ld[1] / ls[1], 0, 0, 0, ld[2] / ls[2]], mul3(BRAD, RGB2XYZ))));
  }
  /* The white (kelvin, tint) an entry asks for. ctx: { asShot: [T, tint], auto: [T, tint] } from the RAW layer. */
  function wbTarget(p, ctx) {
    ctx = ctx || {};
    if (p.wb === 'custom') return [p.temp, p.tint];
    if (p.wb === 'auto') return ctx.auto || ctx.asShot || null;
    if (WB_PRESETS[p.wb]) return WB_PRESETS[p.wb];
    return null;   /* as shot */
  }
  /* Keep the luminance of what was white, so white balance changes colour and not exposure. */
  function normWhite(m) { var w = vec3(m, [1, 1, 1]), y = LUMA[0] * w[0] + LUMA[1] * w[1] + LUMA[2] * w[2]; return y > 1e-6 ? m.map(function (v) { return v / y; }) : m; }
  /* The matrix applied to the working data for an entry: as injected by the RAW layer (m0..m8), else generic. */
  function wbMatrix(p) {
    var m = [p.m0, p.m1, p.m2, p.m3, p.m4, p.m5, p.m6, p.m7, p.m8];
    if (!isIdent(m)) return m;
    var t = wbTarget(p, null);
    return t ? normWhite(genericWB(t[0], t[1])) : I3;
  }

  /* ================================================================== tone curve (the documented model) */
  /* Domain: x = log2(Y / 0.18), exposure in stops relative to scene middle grey, from X0 to X1. Range: display-encoded value v (sRGB).
   *
   * Base curve (ours; "close to a camera JPEG" means: plain sRGB encoding of the scene from deep shadows to just above middle grey,
   * a little extra contrast per profile, and a smooth shoulder instead of a hard clip):
   *     e = sRGB_encode_extended(0.18 * 2^(kp x))                                  (kp: profile contrast around grey; 1 = sRGB)
   *     v = e                                         when e <= knee
   *     v = knee + (1 - knee) S((e - knee) / (1 - knee), ps)   above,   S(t, p) = t / (1 + t^p)^(1/p)
   *   S has slope 1 at 0 and tends to 1, so the shoulder joins the straight part with the same slope (C1) and approaches white without
   *   ever reaching a hard clip: Standard keeps gradation to about +4 EV over middle grey (+1.5 EV over sensor white after the baseline
   *   exposure), where a plain encoding clips at +2.5 EV. Monotone everywhere. Middle grey stays at sRGB 118.
   * The six tone controls warp x BEFORE the curve, with ramps whose slope is below 1 so the result stays monotone:
   *     exposure  x + e                                        contrast   kp (1 + 0.6 c) (c in -1..1), around grey
   *     highlights x + 0.65 h R(x - 1.2)    shadows   x + 0.7 s R(-x - 1.2)     whites  x + 0.5 w R(x - 2.6)     blacks  x + 0.55 b R(-x - 4)
   *   with R(u) = softplus(1.6 u) / 1.6 (a smooth ramp: 0 far below, u far above, slope 0..1). Negative highlights recover bright
   *   detail, positive shadows open dark areas, and so on, as in other RAW developers.
   * "none" (for pictures that are already display-referred): kp 1 and no shoulder, so with every control at 0 the curve is the
   *   identity (values above white clip). */
  var X0 = -14, X1 = 10, TONE_N = 1024;
  var PROFILES = {
    none: { name: 'None (linear)', kp: 1, sat: 1, desat: 0, rgc: 0 },
    neutral: { name: 'Camera neutral', kp: 1.0, knee: 0.70, ps: 2.4, sat: 1.0, desat: 0.5, rgc: 1 },
    standard: { name: 'Standard', kp: 1.08, knee: 0.70, ps: 2.6, sat: 1.06, desat: 0.55, rgc: 1 },
    vivid: { name: 'Vivid', kp: 1.18, knee: 0.72, ps: 2.8, sat: 1.28, desat: 0.45, rgc: 1 },
    portrait: { name: 'Portrait', kp: 1.04, knee: 0.68, ps: 2.3, sat: 0.97, desat: 0.6, rgc: 1 },
    landscape: { name: 'Landscape', kp: 1.14, knee: 0.72, ps: 2.8, sat: 1.18, desat: 0.5, rgc: 1 },
    flat: { name: 'Flat (for grading)', kp: 0.85, knee: 0.55, ps: 1.8, sat: 0.92, desat: 0.4, rgc: 1 },
    mono: { name: 'Monochrome', kp: 1.1, knee: 0.70, ps: 2.6, sat: 0, desat: 0, rgc: 1, mono: true },
    'mono-high': { name: 'Monochrome high contrast', kp: 1.3, knee: 0.74, ps: 3.0, sat: 0, desat: 0, rgc: 1, mono: true }
  };
  function S(t, p) { return t / Math.pow(1 + Math.pow(t, p), 1 / p); }
  function R(u) { return softplus(1.6 * u) / 1.6; }
  function encode(y) { y = clamp(y, 0, 1); return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055; }
  function decode(v) { v = clamp(v, 0, 1); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  /* profile: a resolved profile id (not 'auto'). Returns { lut: Float32Array(TONE_N) of display-encoded v over x in [X0, X1], k0 } where
     k0 = (linear output / linear input) at X0, the slope used below the table. */
  function toneTable(p, profile) {
    var P = PROFILES[profile] || PROFILES.none, lut = new Float32Array(TONE_N), i;
    var c = (p.contrast || 0) / 100, h = (p.highlights || 0) / 100, s = (p.shadows || 0) / 100, w = (p.whites || 0) / 100, b = (p.blacks || 0) / 100, e = p.exposure || 0;
    var kp = P.kp * (1 + 0.6 * c);
    function warp(x) { return x + e + 0.65 * h * R(x - 1.2) + 0.7 * s * R(-x - 1.2) + 0.5 * w * R(x - 2.6) + 0.55 * b * R(-x - 4); }
    function base(x) {
      var y = 0.18 * Math.pow(2, x * kp), en = y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
      if (!P.knee || en <= P.knee) return en;
      return P.knee + (1 - P.knee) * S((en - P.knee) / (1 - P.knee), P.ps);
    }
    for (i = 0; i < TONE_N; i++) lut[i] = clamp(base(warp(X0 + (X1 - X0) * i / (TONE_N - 1))), 0, 1);
    for (i = 1; i < TONE_N; i++) if (lut[i] < lut[i - 1]) lut[i] = lut[i - 1];
    var y0 = 0.18 * Math.pow(2, X0);
    return { lut: lut, k0: decode(lut[0]) / y0 };
  }
  function toneAt(T, Y) { // CPU twin of the shader's table read (linear interpolation, as the texture does)
    if (Y <= 0) return 0;
    var x = Math.log(Y / 0.18) / Math.LN2;
    if (x < X0) return T.k0 * Y;
    var u = clamp((x - X0) / (X1 - X0), 0, 1) * (TONE_N - 1), i = Math.floor(u), f = u - i, a = T.lut[Math.min(i, TONE_N - 1)], bb = T.lut[Math.min(i + 1, TONE_N - 1)];
    return decode(a + (bb - a) * f);
  }

  /* ================================================================== develop.basic */
  var PROFILE_OPTS = [{ value: 'auto', label: 'Auto' }].concat(Object.keys(PROFILES).map(function (k) { return { value: k, label: PROFILES[k].name }; }));
  function hiddenM(i) { return { type: 'number', min: -64, max: 64, default: i % 4 === 0 ? 1 : 0, step: 1e-6, label: 'm' + i, help: 'Set by a RAW layer from the camera matrices for the chosen white balance; leave it out.', ui: { hidden: true } }; }
  var BASIC_PARAMS = {
    profile: { type: 'choice', options: PROFILE_OPTS, default: 'auto', label: 'Profile', help: 'Auto: Standard on RAW and HDR layers, None on ordinary photos.' },
    wb: { type: 'choice', default: 'as-shot', label: 'White balance', options: [{ value: 'as-shot', label: 'As shot' }, { value: 'auto', label: 'Auto' }, { value: 'daylight', label: 'Daylight' }, { value: 'cloudy', label: 'Cloudy' }, { value: 'shade', label: 'Shade' }, { value: 'tungsten', label: 'Tungsten' }, { value: 'fluorescent', label: 'Fluorescent' }, { value: 'flash', label: 'Flash' }, { value: 'custom', label: 'Custom' }] },
    temp: { type: 'number', min: 2000, max: 50000, default: 5500, step: 10, unit: 'K', label: 'Temp', help: 'The colour temperature of the light; a higher value warms the picture. Used when white balance is Custom.', ui: { gradient: 'temperature' } },
    tint: { type: 'number', min: -150, max: 150, default: 0, step: 1, label: 'Tint', help: 'Positive adds magenta, negative adds green. Used when white balance is Custom.', ui: { gradient: 'tint' } },
    exposure: { type: 'number', min: -5, max: 5, default: 0, step: 0.01, unit: 'ev', label: 'Exposure' },
    contrast: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Contrast' },
    highlights: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Highlights' },
    shadows: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Shadows' },
    whites: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Whites' },
    blacks: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Blacks' },
    vibrance: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Vibrance' },
    saturation: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Saturation' },
    recovery: { type: 'choice', default: 'reconstruct', label: 'Highlight recovery', help: 'How clipped sensor channels are handled on a RAW layer: rebuilt from the unclipped channels and nearby colour, clipped to white, or left as recorded.', options: [{ value: 'reconstruct', label: 'Reconstruct' }, { value: 'clip', label: 'Clip to white' }, { value: 'off', label: 'Off' }] }
  };
  for (var mi = 0; mi < 9; mi++) BASIC_PARAMS['m' + mi] = hiddenM(mi);

  /* Everything the shader needs, from the entry and (on a RAW/HDR layer) the injected context. Also the CPU reference's input. */
  function basicPlan(p) {
    var profile = p.profile === 'auto' ? 'none' : p.profile;   /* a RAW/HDR layer resolves 'auto' to 'standard' before this (inject) */
    var P = PROFILES[profile] || PROFILES.none;
    var W = wbMatrix(p);
    var toneOn = profile !== 'none' || p.exposure || p.contrast || p.highlights || p.shadows || p.whites || p.blacks;
    var sat = P.sat * (1 + p.saturation / 100), vib = p.vibrance / 100;
    var colourOn = P.mono || Math.abs(sat - 1) > 1e-6 || vib !== 0;
    if (!toneOn && !colourOn && isIdent(W)) return null;   /* neutral at default: no work at all */
    return { profile: profile, P: P, W: W, tone: toneOn ? toneTable(p, profile) : null, sat: sat, vib: vib, mono: !!P.mono, desat: toneOn ? P.desat : 0, rgc: toneOn ? P.rgc : 0 };
  }
  /* ACES 1.3 Reference Gamut Compression distance curve, one channel. */
  var RGC = { t: 0.8, l: 1.25, p: 1.2 };
  RGC.s = (RGC.l - RGC.t) / Math.pow(Math.pow((1 - RGC.t) / (RGC.l - RGC.t), -RGC.p) - 1, 1 / RGC.p);
  function rgcD(d) { if (d < RGC.t) return d; var x = (d - RGC.t) / RGC.s; return RGC.t + RGC.s * x / Math.pow(1 + Math.pow(x, RGC.p), 1 / RGC.p); }
  /* CPU reference of develop.basic for one pixel: linear scene RGB in, display-referred linear RGB (0..1) out. */
  function basicPixel(c, plan) {
    if (!plan) return c.slice();
    c = vec3(plan.W, c);
    if (plan.rgc) { var ach = Math.max(c[0], c[1], c[2]); if (ach > 0) c = c.map(function (v) { return ach - rgcD((ach - v) / ach) * ach; }); }
    var o = c;
    if (plan.tone) {
      var Y = Math.max(LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2], 1e-10), y = toneAt(plan.tone, Y), k = y / Y;
      o = [c[0] * k, c[1] * k, c[2] * k];
      if (plan.desat) { var v = encode(y), d = smooth(0.78, 1.0, v) * plan.desat; o = o.map(function (q) { return q + (y - q) * d; }); }
    }
    var Yo = LUMA[0] * o[0] + LUMA[1] * o[1] + LUMA[2] * o[2];
    if (plan.mono) o = [Yo, Yo, Yo];
    else if (Math.abs(plan.sat - 1) > 1e-6 || plan.vib) {
      var mx = Math.max(o[0], o[1], o[2]), mn = Math.min(o[0], o[1], o[2]), s = mx > 1e-6 ? (mx - mn) / mx : 0, kk = Math.max(0, plan.sat * (1 + plan.vib * (1 - clamp(s * 1.4, 0, 1))));
      o = o.map(function (q) { return Yo + (q - Yo) * kk; });
    }
    if (plan.tone || plan.rgc) {
      var m2 = Math.max(o[0], o[1], o[2]), Yc = clamp(Yo, 0, 1);
      if (m2 > 1) { var t = clamp((m2 - 1) / Math.max(m2 - Yc, 1e-6), 0, 1); o = o.map(function (q) { return q + (Yc - q) * t; }); }
      o = o.map(function (q) { return clamp(q, 0, 1); });
    }
    return o;
  }
  var BASIC_GLSL = [
    'uniform mat3 $w; uniform sampler2D $t; uniform vec4 $a; uniform vec4 $b; uniform vec2 $c;',
    'float $d(float d){ if (d < ' + RGC.t.toFixed(6) + ') return d; float x = (d - ' + RGC.t.toFixed(6) + ') / ' + RGC.s.toFixed(6) + '; return ' + RGC.t.toFixed(6) + ' + ' + RGC.s.toFixed(6) + ' * x / pow(1.0 + pow(x, ' + RGC.p.toFixed(6) + '), ' + (1 / RGC.p).toFixed(6) + '); }',
    'vec3 $fx(vec3 c){',
    '  c = $w * c;',
    '  if ($b.x > 0.5) { float ach = max(c.r, max(c.g, c.b)); if (ach > 0.0) c = vec3(ach) - vec3($d((ach - c.r) / ach), $d((ach - c.g) / ach), $d((ach - c.b) / ach)) * ach; }',
    '  vec3 o = c;',
    '  if ($b.w > 0.5) {',
    '    float Y = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-10); float x = log2(Y / 0.18); float y;',
    '    if (x < $a.x) y = $c.x * Y; else { float v0 = lut1($t, clamp((x - $a.x) * $a.y, 0.0, 1.0)); y = toLinear(vec3(v0)).x; }',
    '    o = c * (y / Y);',
    '    if ($b.z > 0.0) { float v = toDisplay(vec3(y)).x; o = mix(o, vec3(y), smoothstep(0.78, 1.0, v) * $b.z); }',
    '  }',
    '  float Yo = dot(o, vec3(0.2126, 0.7152, 0.0722));',
    '  if ($b.y > 0.5) o = vec3(Yo);',
    '  else if ($c.y > 0.5) { float mx = max(o.r, max(o.g, o.b)), mn = min(o.r, min(o.g, o.b)); float s = mx > 1e-6 ? (mx - mn) / mx : 0.0; float kk = max(0.0, $a.z * (1.0 + $a.w * (1.0 - clamp(s * 1.4, 0.0, 1.0)))); o = vec3(Yo) + (o - vec3(Yo)) * kk; }',
    '  if ($b.w > 0.5 || $b.x > 0.5) { float m2 = max(o.r, max(o.g, o.b)); float Yc = clamp(Yo, 0.0, 1.0); if (m2 > 1.0) o = mix(o, vec3(Yc), clamp((m2 - 1.0) / max(m2 - Yc, 1e-6), 0.0, 1.0)); o = clamp(o, 0.0, 1.0); }',
    '  return o;',
    '}'
  ].join('\n');

  FX.register({
    id: 'develop.basic', name: 'Develop', group: 'light', version: 1, space: 'linear',
    params: BASIC_PARAMS,
    passes: function (g, p) {
      var plan = basicPlan(p);
      if (!plan) return;
      g.color(BASIC_GLSL, {
        w: plan.W, t: plan.tone ? g.lut1d(plan.tone.lut, 1) : g.lut1d(new Float32Array([0, 1]), 1),
        a: [X0, 1 / (X1 - X0), plan.sat, plan.vib], b: [plan.rgc ? 1 : 0, plan.mono ? 1 : 0, plan.desat, plan.tone ? 1 : 0],
        c: [plan.tone ? plan.tone.k0 : 1, plan.mono || Math.abs(plan.sat - 1) > 1e-6 || plan.vib ? 1 : 0]
      });
    },
    support: GPU,
    ui: {
      section: 'Light', order: 1, controls: [
        'profile', { heading: 'White balance' }, 'wb', { param: 'temp', gradient: 'temperature', when: { wb: 'custom' } }, { param: 'tint', gradient: 'tint', when: { wb: 'custom' } },
        { heading: 'Tone' }, 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'recovery', { heading: 'Presence' }, 'vibrance', 'saturation'
      ]
    },
    agent: {
      summary: 'The RAW develop basics in one pass: profile (tone curve and colour rendering), white balance in kelvin with the camera\'s own colour matrices, exposure in stops on linear data, highlights, shadows, whites and blacks shaped on a filmic curve, highlight recovery, vibrance and saturation. On a RAW or HDR layer it is the output transform from scene light to the display (gamut compression plus a hue-preserving filmic curve) and always runs last of the develop entries; on an ordinary photo, Profile "Auto" means no curve, so it is a set of tone controls.',
      tips: [
        'Start from the defaults a RAW layer opens with (profile Auto = Standard, white balance As shot); then exposure first, then highlights and shadows, then whites and blacks. Read LE.fx.analyze after each step.',
        'Backlit portrait: exposure +0.3 to +0.7, shadows +40 to +60, highlights -40 to -70, whites -10, blacks -5, vibrance +10; white balance As shot or Custom 5600-6200 K for warm skin.',
        'Night city: exposure -0.3 to +0.3 (keep lights from clipping), highlights -60 to -90, shadows +20 to +35, blacks -15 to -25 for depth, white balance Custom 3800-4300 K (sodium and LED light), contrast +10, saturation -5 if signs are garish.',
        'High-ISO indoor (ISO 3200 and up): exposure as needed (+0.5 to +1.2), shadows at most +30 (lifting dark areas lifts noise), blacks -10, white balance Tungsten or Custom 3000-3400 K tint +5; pair with develop.detail (luminance noise 30-50, colour noise 25-40, sharpening 30 with masking 40).',
        'Landscape with sky: profile landscape, highlights -50, whites +15, shadows +20, vibrance +20.',
        'Pitfalls: Temp and Tint only act when wb is "custom"; white balance "auto" uses the estimate made when the RAW was opened; exposure is in stops (each +1 doubles the light), not percent; on a RAW layer do not add the basic "white-balance" or "exposure" effects for the same job: they act after the curve, on display values.'
      ],
      example: { type: 'develop.basic', p: { profile: 'standard', wb: 'custom', temp: 5200, tint: 6, exposure: 0.4, highlights: -45, shadows: 35, whites: -8, blacks: -6, vibrance: 15 } }
    }
  });

  /* ================================================================== develop.detail */
  /* Model. Works on scene-linear RGB (before the tone curve on RAW layers).
   *   A = sqrt(Y + 1e-4): luminance in a variance-stabilising domain (photon noise has a variance proportional to the signal, so its
   *   square root has a roughly constant noise level), the domain the guided filter (He, Sun, Tang 2010) smooths in.
   *   Luminance NR: self-guided filter on A, radius 1.2-3.2 px, eps = (0.0009 + 0.012 n)^2 for n in 0..1; Detail puts back part of what
   *   it removed. Colour NR: luminance-weighted local chromaticity, Y * blur(rgb) / luma(blur(rgb)), radius 1.5-9 px; Colour detail
   *   narrows the radius. Sharpening: unsharp mask on A with the given radius; Detail lowers the threshold below which the difference is
   *   treated as noise; Masking keeps only edges (a larger-scale difference above a level).
   *   Demosaic chooses the decoder's demosaic method for this layer's next decode (no pixels change here). */
  var NR_PASS1 = 'vec4 fx(){ vec4 s = texture(u_src, v_uv); float Y = max(dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0); float A = sqrt(Y + 1e-4); return vec4(A, A * A, 0.0, 1.0); }';
  var NR_PASS2 = 'uniform float u_eps; vec4 fx(){ vec4 m = texture(u_src, v_uv); float v = max(m.y - m.x * m.x, 0.0); float a = v / (v + u_eps); return vec4(a, m.x - a * m.x, 0.0, 1.0); }';
  var DETAIL_FINAL = [
    'uniform sampler2D u_a, u_ab, u_c, u_s, u_m; uniform vec4 u_k; uniform vec4 u_q;',
    /* u_k: lumAmt, detail, colAmt, sharpen; u_q: threshold, masking level, useLum, useSharp */
    'vec4 fx(){ vec4 s = texture(u_src, v_uv); vec3 c = s.rgb; float Y = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0);',
    '  float A = texture(u_a, v_uv).x; float An = A;',
    '  if (u_q.z > 0.5) { vec4 ab = texture(u_ab, v_uv); float nr = ab.x * A + ab.y; An = mix(A, nr, u_k.x); An = mix(An, A, u_k.y); }',
    '  if (u_q.w > 0.5) { float D = A - texture(u_s, v_uv).x; float ad = abs(D); float g = ad < u_q.x ? (ad / max(u_q.x, 1e-6)) * (ad / max(u_q.x, 1e-6)) : 1.0;',
    '    float E = abs(A - texture(u_m, v_uv).x); g *= u_q.y > 0.0 ? smoothstep(u_q.y * 0.5, u_q.y, E) : 1.0; An += u_k.w * g * D; }',
    '  float Yn = max(An * An - 1e-4, 0.0);',
    '  vec3 chroma = Y > 1e-6 ? c / Y : vec3(1.0);',
    '  if (u_k.z > 0.0) { vec3 bc = texture(u_c, v_uv).rgb; float bY = dot(bc, vec3(0.2126, 0.7152, 0.0722)); if (bY > 1e-6) chroma = mix(chroma, bc / bY, u_k.z); }',
    '  vec3 o = Y > 1e-6 ? chroma * Yn : c + (Yn - Y);',
    '  return vec4(o * s.a, s.a); }'
  ].join('\n');
  function detailPlan(p, draft) {
    var lum = p.luminance / 100, col = p.color / 100, sh = p.sharpen / 100;
    if (!lum && !col && !sh) return null;
    return {
      lum: lum, col: col, sh: sh,
      sNR: 1.2 + 2.0 * lum, eps: Math.pow(0.0009 + 0.012 * lum, 2), keep: (p.lumDetail / 100) * 0.35,
      sC: (1.5 + 7.5 * col) * (1 - 0.6 * p.colorDetail / 100), sS: p.radius, sM: p.radius * 3,
      thr: 0.0035 * (1 - p.detail / 100) + 0.0002, mask: p.masking / 100 * 0.02, amt: sh * 1.6
    };
  }
  FX.register({
    id: 'develop.detail', name: 'Detail (RAW)', group: 'detail', version: 1, space: 'linear',
    params: {
      sharpen: { type: 'number', min: 0, max: 150, default: 0, step: 1, label: 'Sharpening amount' },
      radius: { type: 'number', min: 0.5, max: 3, default: 1, step: 0.1, unit: 'px', label: 'Radius' },
      detail: { type: 'number', min: 0, max: 100, default: 25, step: 1, label: 'Detail' },
      masking: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Masking' },
      luminance: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Luminance noise' },
      lumDetail: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Luminance detail' },
      color: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Colour noise' },
      colorDetail: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Colour detail' },
      demosaic: { type: 'choice', default: 'auto', label: 'Demosaic', help: 'Interpolation of the sensor pattern when a RAW layer is decoded. Auto: edge-directed for DNG, AHD in the camera module.', options: [{ value: 'auto', label: 'Auto' }, { value: 'fast', label: 'Fast' }, { value: 'detail', label: 'Fine detail' }, { value: 'smooth', label: 'Smooth' }] }
    },
    radius: function (p, sc) {
      var q = detailPlan(p); if (!q) return 0;
      var r = 0, R2 = M.blurReach;
      if (q.lum) r = 2 * R2(q.sNR * sc);
      return Math.ceil(r + Math.max(q.col ? R2(q.sC * sc) : 0, q.sh ? R2(q.sM * sc) : 0)) + 2;
    },
    draft: function (p) { var o = {}; Object.keys(p).forEach(function (k) { o[k] = p[k]; }); o.masking = 0; return o; },
    passes: function (g, p) {
      var q = detailPlan(p);
      if (!q || !g.float) return;    /* the packed intermediates need float targets */
      var src = g.source, a = g.pass(NR_PASS1, { u_src: src }), ab = null, c = null, s = null, mk = null;
      if (q.lum) { var m1 = g.blur(q.sNR, { source: a }), ab0 = g.pass(NR_PASS2, { u_src: m1, u_eps: q.eps }); g.release(m1); ab = g.blur(q.sNR, { source: ab0 }); g.release(ab0); }
      if (q.col) c = g.blur(q.sC, { source: src });
      if (q.sh) { s = g.blur(q.sS, { source: a }); mk = q.mask > 0 ? g.blur(q.sM, { source: a }) : s; }
      var out = g.pass(DETAIL_FINAL, { u_src: src, u_a: a, u_ab: ab || a, u_c: c || src, u_s: s || a, u_m: mk || a, u_k: [q.lum ? 1 : 0, q.keep, q.col, q.amt], u_q: [q.thr, q.mask, q.lum ? 1 : 0, q.sh ? 1 : 0] });
      [a, ab, c, s].forEach(function (h) { if (h) g.release(h); }); if (mk && mk !== s) g.release(mk);
      return out;
    },
    support: { needs: ['webgl2', 'webgl-float'], wants: [], memoryMB: 160 },
    ui: { section: 'Detail', order: 5, controls: [{ heading: 'Sharpening' }, 'sharpen', 'radius', 'detail', 'masking', { heading: 'Noise reduction' }, 'luminance', 'lumDetail', 'color', 'colorDetail', { heading: 'Raw' }, 'demosaic'] },
    agent: {
      summary: 'Capture sharpening and noise reduction for RAW and HDR layers, on linear light before the tone curve (the creative pack has the generic sharpen and denoise for finished pictures). Luminance noise uses an edge-preserving guided filter in a variance-stabilised domain; colour noise averages chromaticity weighted by brightness; sharpening is an unsharp mask with a noise threshold (Detail) and an edge mask (Masking). A RAW layer opens with values chosen from its ISO.',
      tips: [
        'Typical for a clean base-ISO RAW: sharpen 40, radius 1.0, detail 25, masking 0, luminance 0, colour 25.',
        'High-ISO indoor (ISO 3200-6400): luminance 35-55, lumDetail 40-50, colour 30-45, sharpen 25-35 with masking 40-60 so flat walls stay smooth.',
        'Night city: colour 35 (coloured blotches in the sky), luminance 25-40, sharpen 30, masking 30.',
        'Backlit portrait: sharpen 30-40, radius 1.0-1.2, masking 50-70 (skin stays soft, eyes and hair stay crisp), luminance 10-20.',
        'Pitfalls: radius above 1.5 makes halos at preview size; noise reduction above 70 smears texture; this effect needs half-float GPU targets and does nothing without them.'
      ],
      example: { type: 'develop.detail', p: { sharpen: 40, radius: 1, detail: 25, masking: 30, luminance: 20, color: 25 } }
    }
  });

  /* ================================================================== develop.lens */
  /* Model (box-centred, r = distance from the centre over the half-diagonal, 1 at the corners):
   *   distortion d: the output at r samples the source at r (1 + kd r^2), kd = -0.15 d (d in -1..1; + corrects barrel, - pincushion)
   *   lateral CA: red and blue sampled at an extra scale (1 + 0.003 ca) about the centre (red/cyan, blue/yellow sliders, -100..100)
   *   vignetting v: gain 2^(1.6 v w(r)), w = smoothstep(m, 1.25, r) with m = 0.55 * midpoint (+ lightens the corners)
   *   defringe: near an edge (local luminance range in a 3 px window above 0.12 of the local maximum), purple (or green) pixels lose
   *   their chroma towards neutral by amount/20, within the hue band of the colour.
   * Auto CA: when autoCA is on, a RAW layer injects the estimate made when it was opened (LERawDevelop.estimateCA on a 1 MP copy). */
  var LENS_GLSL = [
    'uniform vec4 u_k; uniform vec4 u_v; uniform vec2 u_df;',
    /* u_k: kd, caR, caB, halfDiag (doc px); u_v: vignette amount, midpoint, useWarp, useDefringe */
    'vec3 fetch(vec2 off){ vec2 d = docPos() - u_box * 0.5; float rn = length(d) / u_k.w; float k = 1.0 + u_k.x * rn * rn;',
    '  vec2 dR = d * (k * (1.0 + u_k.y) - 1.0), dG = d * (k - 1.0), dB = d * (k * (1.0 + u_k.z) - 1.0);',
    '  vec2 o = docToUV(off); return vec3(src(v_uv + o + docToUV(dR)).r, src(v_uv + o + docToUV(dG)).g, src(v_uv + o + docToUV(dB)).b); }',
    'vec4 fx(){ vec4 s0 = src(v_uv); float a = s0.a > 0.0 ? s0.a : 1.0; vec3 c = u_v.z > 0.5 ? fetch(vec2(0.0)) / a : s0.rgb / a;',
    '  if (u_v.w > 0.5) { float lmin = 1e9, lmax = 0.0; for (int y = -3; y <= 3; y += 1) for (int x = -3; x <= 3; x += 1) { vec2 off = vec2(float(x), float(y)) / u_scale; float l = dot(src(v_uv + docToUV(off)).rgb, vec3(0.2126, 0.7152, 0.0722)); lmin = min(lmin, l); lmax = max(lmax, l); }',
    '    float edge = smoothstep(0.08, 0.25, (lmax - lmin) / max(lmax, 1e-4)); float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '    float purple = clamp(min(c.b - c.g, c.r - c.g) / max(Y, 1e-4), 0.0, 1.0) * step(c.g, c.b); float green = clamp(min(c.g - c.r, c.g - c.b) / max(Y, 1e-4), 0.0, 1.0);',
    '    float k = edge * clamp(u_df.x * smoothstep(0.02, 0.25, purple) + u_df.y * smoothstep(0.02, 0.25, green), 0.0, 1.0); c = mix(c, vec3(Y), k); }',
    '  if (u_v.x != 0.0) { vec2 d = docPos() - u_box * 0.5; float rn = length(d) / u_k.w; c *= exp2(1.6 * u_v.x * smoothstep(u_v.y, 1.25, rn)); }',
    '  return vec4(c * s0.a, s0.a); }'
  ].join('\n');
  function lensPlan(p) {
    var kd = -0.15 * p.distortion / 100, cr = 0.003 * p.caRed / 100 + (p.autoCA ? p.autoR : 0), cb = 0.003 * p.caBlue / 100 + (p.autoCA ? p.autoB : 0);
    var warp = kd !== 0 || cr !== 0 || cb !== 0, df = p.defringePurple > 0 || p.defringeGreen > 0, vig = p.vignette !== 0;
    if (!warp && !df && !vig) return null;
    return { kd: kd, cr: cr, cb: cb, warp: warp, df: df, vig: p.vignette / 100, mid: 0.55 * p.midpoint / 100, dfp: p.defringePurple / 20, dfg: p.defringeGreen / 20 };
  }
  FX.register({
    id: 'develop.lens', name: 'Lens corrections', group: 'optics', version: 1, space: 'linear',
    params: {
      distortion: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Distortion' },
      vignette: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Vignetting' },
      midpoint: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Midpoint' },
      caRed: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Red / cyan fringe' },
      caBlue: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Blue / yellow fringe' },
      autoCA: { type: 'bool', default: false, label: 'Remove chromatic aberration' },
      defringePurple: { type: 'number', min: 0, max: 20, default: 0, step: 1, label: 'Purple amount' },
      defringeGreen: { type: 'number', min: 0, max: 20, default: 0, step: 1, label: 'Green amount' },
      extent: { type: 'number', min: 0, max: 100000, default: 0, step: 1, label: 'extent', help: 'Set by a RAW or HDR layer (long side in document pixels); leave it out.', ui: { hidden: true } },
      autoR: { type: 'number', min: -0.02, max: 0.02, default: 0, step: 1e-6, label: 'autoR', help: 'Set by a RAW layer (estimated red magnification); leave it out.', ui: { hidden: true } },
      autoB: { type: 'number', min: -0.02, max: 0.02, default: 0, step: 1e-6, label: 'autoB', help: 'Set by a RAW layer (estimated blue magnification); leave it out.', ui: { hidden: true } }
    },
    radius: function (p, sc) {
      var q = lensPlan(p); if (!q) return 0;
      /* the largest displacement, at the corners, needs the box size: at most 15 % + 0.6 % of the half-diagonal; 3 px for defringe */
      /* the largest displacement is at the corners: the half-diagonal, from the injected extent or a generous 6000-pixel picture */
      var hd = (p.extent || 6000) * 0.71;
      return Math.ceil((q.warp ? (Math.abs(q.kd) + Math.abs(q.cr) + Math.abs(q.cb)) * 1.05 * hd * sc : 0) + (q.df ? 4 * sc + 1 : 0)) + 2;
    },
    passes: function (g, p) {
      var q = lensPlan(p);
      if (!q) return;
      var hd = 0.5 * Math.sqrt(g.box.w * g.box.w + g.box.h * g.box.h);
      return g.pass(LENS_GLSL, { u_k: [q.kd, q.cr, q.cb, hd], u_v: [q.vig, q.mid, q.warp ? 1 : 0, q.df ? 1 : 0], u_df: [q.dfp, q.dfg] });
    },
    support: GPU,
    ui: { section: 'Optics', order: 5, controls: [{ heading: 'Profile' }, 'autoCA', { heading: 'Manual' }, 'distortion', 'vignette', 'midpoint', 'caRed', 'caBlue', { heading: 'Defringe' }, 'defringePurple', 'defringeGreen'] },
    agent: {
      summary: 'Lens corrections in linear light, centred on the picture: barrel or pincushion distortion, corner darkening (vignetting) with a midpoint, lateral chromatic aberration (red/cyan and blue/yellow edges) and defringe (purple or green fringes along high-contrast edges). On a RAW layer the automatic CA estimate from the file can be switched on; DNG gain-map and vignette opcodes are already applied by the decoder. No lens database is used.',
      tips: [
        'Wide-angle barrel distortion: distortion +5 to +25; a fisheye-like look is beyond this model.',
        'Corner darkening of a fast prime wide open: vignetting +20 to +45, midpoint 40-60.',
        'Purple fringes on branches against a bright sky or on backlit hair: defringePurple 4-10; green fringes behind the focus plane: defringeGreen 2-6.',
        'Night city lights with coloured edges: autoCA true, then caRed or caBlue +-10 to +-30 by eye; vignetting 0 (dark corners suit night scenes).',
        'Backlit portrait: defringePurple 4-8 along the backlit hair, vignetting +10 to +20 at most so the face stays the brightest area.',
        'High-ISO indoor: vignetting correction lifts noisy corners too: keep it under +25 and add luminance noise reduction in develop.detail.',
        'Pitfalls: distortion moves the picture edges inward, so crop after it; defringe can grey out genuinely purple objects at edges.'
      ],
      example: { type: 'develop.lens', p: { distortion: 12, vignette: 30, midpoint: 50, autoCA: true, defringePurple: 6 } }
    }
  });

  /* ================================================================== develop.tonemap */
  /* Model (scene-linear in, scene-linear out, so develop.basic's filmic curve still comes last):
   *   L = log2(Y). Base B = edge-aware smooth of L: a guided filter (He, Sun, Tang 2010) computed at quarter resolution and applied at
   *   full resolution through its linear coefficients ("fast guided filter", He and Sun 2015), radius rho = (0.6 % to 2.5 %) of the
   *   picture's long side (a 3000-pixel picture is assumed off RAW/HDR layers); Halo control raises the edge-awareness (smaller eps) and lowers the radius.
   *   local:  L' = g + (B - g) * (1 - 0.85 s) * (1 + 0.5 hl [B > g] - 0.5 sh [B < g]) + (L - B) * (1 + d)
   *   fusion: five virtual exposures, -2k, -k, 0, +k, +2k stops with k = 1.2 + 1.8 s, are weighted per pixel by how well exposed the BASE would be in each
   *           (Gaussian around display value 0.5, sigma 0.2, Mertens et al. 2007), giving a smooth local gain; detail is kept.
   *   global: L' = g + (L - g) * (1 - 0.6 s) (plain log compression, one colour pass).
   *   g = log2(0.18) (scene middle grey). Colour ratios are kept (Y'/Y on every channel), then saturation moves chroma in linear light. */
  var TM_PASS1 = 'vec4 fx(){ vec4 s = texture(u_src, v_uv); float Y = max(dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-7); float L = log2(Y); return vec4(L, L * L, 0.0, 1.0); }';
  var TM_FINAL = [
    'uniform sampler2D u_ab; uniform vec4 u_p; uniform vec4 u_q;',
    /* u_p: compression (1 - 0.85 s) or fusion stops, detail, highlights, shadows; u_q: mode (1 local, 2 fusion), saturation, grey, - */
    'vec4 fx(){ vec4 s = texture(u_src, v_uv); float a = s.a > 0.0 ? s.a : 1.0; vec3 c = s.rgb / a; float Y = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-7); float L = log2(Y);',
    '  vec4 ab = texture(u_ab, v_uv); float B = ab.x * L + ab.y; float g = u_q.z; float Ln;',
    '  if (u_q.x < 1.5) { float bd = B - g; bd *= u_p.x * (bd > 0.0 ? 1.0 + 0.5 * u_p.z : 1.0 - 0.5 * u_p.w); Ln = g + bd + (L - B) * (1.0 + u_p.y); }',
    '  else { float acc = 0.0, wsum = 0.0; for (int i = -2; i <= 2; i++) { float ev = float(i) * u_p.x; float v = clamp(toDisplay(vec3(exp2(B + ev - g) * 0.18)).x, 0.0, 1.0); float w = exp(-(v - 0.5) * (v - 0.5) / 0.08) + 1e-4; if (i > 0) w *= 1.0 + 0.6 * u_p.w; if (i < 0) w *= 1.0 - 0.6 * u_p.z; acc += w * ev; wsum += w; } Ln = L + acc / wsum + (L - B) * u_p.y; }',
    '  vec3 o = c * exp2(Ln - L); float Yo = dot(o, vec3(0.2126, 0.7152, 0.0722)); o = vec3(Yo) + (o - vec3(Yo)) * u_q.y;',
    '  return vec4(o * s.a, s.a); }'
  ].join('\n');
  var TM_GLOBAL = 'uniform vec2 $k; vec3 $fx(vec3 c){ float Y = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-7); float L = log2(Y); float g = log2(0.18); vec3 o = c * exp2(g + (L - g) * $k.x - L); float Yo = dot(o, vec3(0.2126, 0.7152, 0.0722)); return vec3(Yo) + (o - vec3(Yo)) * $k.y; }';
  /* The base radius is a fraction of the picture's long side on RAW and HDR layers (injected as `extent`), so the look is the same at
     any resolution; elsewhere it is that of a 3000-pixel picture, in document pixels. Either way radius() and passes() agree. */
  function tmPlan(p) {
    var s = p.strength / 100;
    if (!s && !p.detail && !p.highlights && !p.shadows && !p.saturation) return null;
    var longSide = p.extent || 3000, halo = p.halo / 100;
    return { mode: p.method, s: s, rho: longSide * (0.025 - 0.019 * halo), eps: Math.pow(0.9 - 0.75 * halo, 2), detail: p.detail / 100, hl: p.highlights / 100, sh: p.shadows / 100, sat: 1 + p.saturation / 100 };
  }
  FX.register({
    id: 'develop.tonemap', name: 'HDR tone mapping', group: 'light', version: 1, space: 'linear',
    params: {
      method: { type: 'choice', default: 'local', label: 'Method', options: [{ value: 'local', label: 'Local' }, { value: 'fusion', label: 'Exposure fusion' }, { value: 'global', label: 'Global' }] },
      strength: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Strength' },
      detail: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Detail' },
      highlights: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Highlights' },
      shadows: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Shadows' },
      saturation: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Saturation' },
      halo: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Halo control' },
      extent: { type: 'number', min: 0, max: 100000, default: 0, step: 1, label: 'extent', help: 'Set by a RAW or HDR layer (long side in document pixels); leave it out.', ui: { hidden: true } }
    },
    radius: function (p, sc) {
      var q = tmPlan(p); if (!q || q.mode === 'global') return 0;
      return Math.ceil(2 * M.blurReach(q.rho * sc)) + 8;
    },
    draft: function (p) { return p; },
    passes: function (g, p) {
      var q = tmPlan(p);
      if (!q) return;
      if (q.mode === 'global' || !g.float) { g.color(TM_GLOBAL, { k: [1 - 0.6 * q.s, q.sat] }); return; }
      var src = g.source;
      var low = g.pass(TM_PASS1, { u_src: src }, { scale: 0.25 });
      var m = g.blur(q.rho, { source: low });
      var abl = g.pass(NR_PASS2, { u_src: m, u_eps: q.eps }, { scale: 0.25 }); g.release(m);
      var ab = g.blur(q.rho, { source: abl }); g.release(abl); g.release(low);
      var out = g.pass(TM_FINAL, { u_src: src, u_ab: ab, u_p: [q.mode === 'fusion' ? 1.2 + 1.8 * q.s : 1 - 0.85 * q.s, q.detail, q.hl, q.sh], u_q: [q.mode === 'fusion' ? 2 : 1, q.sat, Math.log2(0.18), 0] });
      g.release(ab);
      return out;
    },
    support: GPU,
    ui: { section: 'Light', order: 2, controls: ['method', 'strength', 'detail', 'highlights', 'shadows', 'saturation', { param: 'halo', when: { method: ['local', 'fusion'] } }] },
    agent: {
      summary: 'Tone mapping for scene-referred HDR (a merged bracket set, or one RAW used for an HDR look): compresses the brightness range before the filmic curve of develop.basic. Local keeps local contrast with an edge-aware base/detail split (little halo); Exposure fusion blends virtual exposures by how well each part is exposed (the bright, airy look of fused brackets); Global is a plain log compression without halos.',
      tips: [
        'Natural HDR of a bracketed interior with windows: method local, strength 55-70, detail 15-25, highlights -20, shadows +20, halo 60, saturation 0 to +10.',
        'Single-image HDR look from one RAW: method local, strength 35-50, detail 20-35, halo 50; then develop.basic highlights -30, shadows +30.',
        'Backlit portrait: method fusion, strength 30-45, detail 0-10, halo 75 (protects the face outline), saturation -5.',
        'Night city: method local, strength 45-60, highlights -40 (street lights), shadows +15, detail 10, halo 70.',
        'High-ISO indoor: keep strength under 35 and detail at or below 0, or the noise becomes texture.',
        'Pitfalls: detail above 50 looks over-processed ("grunge"); low halo control at high strength draws bright outlines along skylines; global flattens everything at high strength.'
      ],
      example: { type: 'develop.tonemap', p: { method: 'local', strength: 60, detail: 20, highlights: -20, shadows: 20, halo: 60 } }
    }
  });

  /* ================================================================== the RAW / HDR seam: float sources for LE.Scene layers */
  /* Proposed home: LE.fx.layer in le-fx-gl.js (see the X5 report). Kept here so no shared file changes.
   *
   * LE.fx.sources.register(kind, provider)  kind 'raw' | 'hdr' (layer.raw.kind, default 'raw').
   *   provider(layer, { targetMax, preview, draft, scene }) -> Promise<null | {
   *       source:  { data: Float32Array, width, height, channels: 3, space: 'linear' }  scene-linear, upright, uncropped,
   *       box:     { w, h }            the full-resolution size in document pixels (so radii mean the same in preview and export),
   *       key:     string              identifies the pixels (asset, variant, size),
   *       ctx:     { asShot:[T,tint], auto:[T,tint], wb(p) -> 3x3, ca: { r, b }, scene: true },
   *       fallback: canvas|null }>
   * A layer is drawn from its float source when layer.raw.source.asset is set and a provider for its kind answers; otherwise exactly
   * as before (its 8-bit src picture, which is the default development, so Simple mode and devices without WebGL2 still look right). */
  var DEV_TYPES = ['develop.lens', 'develop.detail', 'develop.tonemap', 'develop.basic'];
  var providers = {};
  FX.sources = {
    register: function (kind, fn) { if (typeof fn === 'function' && /^[a-z][\w-]{0,20}$/.test(kind)) providers[kind] = fn; },
    get: function (kind) { return providers[kind] || null; }
  };
  function isSceneLayer(l) { return !!(l && l.type === 'image' && l.raw && l.raw.source && typeof l.raw.source.asset === 'string'); }
  /* Splits a stack: the develop stage (fixed order) and the rest. Adds a default develop.basic when there is none. */
  function splitStack(fx) {
    var dev = [], rest = [];
    (Array.isArray(fx) ? fx : []).forEach(function (e) { if (e && DEV_TYPES.indexOf(e.type) >= 0) dev.push(e); else rest.push(e); });
    dev.sort(function (a, b) { return DEV_TYPES.indexOf(a.type) - DEV_TYPES.indexOf(b.type); });
    if (!dev.some(function (e) { return e.type === 'develop.basic'; })) dev.push({ id: 'dev-default', type: 'develop.basic', on: true, amount: 1, blend: 'normal', p: {} });
    return { dev: dev, rest: rest };
  }
  /* The develop entries with what only the layer knows filled in: the profile for a scene-referred source, the camera WB matrix,
     the automatic CA estimate. Never written to the document. */
  function inject(dev, ctx) {
    return dev.map(function (e) {
      var o = JSON.parse(JSON.stringify(e)), p = o.p = o.p || {};
      if (o.type === 'develop.basic') {
        var full = FX.defaults('develop.basic'); Object.keys(p).forEach(function (k) { full[k] = p[k]; }); p = o.p = full;
        if (p.profile === 'auto' || !p.profile) p.profile = 'standard';
        var m = ctx && ctx.wb ? ctx.wb(p) : null;
        if (m) { for (var i = 0; i < 9; i++) p['m' + i] = m[i]; p.wb = 'as-shot'; }   /* the camera matrix says it all */
        else if (p.wb === 'auto' && ctx && ctx.auto) { p.wb = 'custom'; p.temp = ctx.auto[0]; p.tint = ctx.auto[1]; }
      }
      if (o.type === 'develop.lens' && p.autoCA && ctx && ctx.ca) { p.autoR = ctx.ca.r; p.autoB = ctx.ca.b; }
      if ((o.type === 'develop.lens' || o.type === 'develop.tonemap') && ctx && ctx.extent) p.extent = ctx.extent;
      return o;
    });
  }
  function script(src) { return new Promise(function (res, rej) { var el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(el); }); }
  function rawModule() {
    if (LE.rawLayer) return LE.rawLayer.ready();
    var base = PACK_BASE ? PACK_BASE.replace(/fx\/$/, 'raw/') : (global.LE_RAW_BASE || '../assets/js/raw/');
    if (!rawModule.p) rawModule.p = (LE.lazy ? LE.lazy(base + 'le-raw-layer.js') : script(base + 'le-raw-layer.js')).then(function () { return LE.rawLayer.ready(); }).catch(function (e) { rawModule.p = null; throw e; });
    return rawModule.p;
  }
  function provider(kind) {
    if (providers[kind]) return Promise.resolve(providers[kind]);
    return rawModule().then(function () {
      if (!providers[kind] && LE.rawLayer && LE.rawLayer.provide && (kind === 'raw' || kind === 'hdr')) FX.sources.register(kind, LE.rawLayer.provide);
      if (!providers[kind]) throw new Error('No source for "' + kind + '" layers.');
      return providers[kind];
    });
  }
  /* Phase 1: the develop stage on the float source, to an 8-bit display canvas (cached per layer while its inputs do not change). */
  var devCache = {};
  function developCanvas(scene, layer, targetMax, preview) {
    var kind = layer.raw.kind || 'raw', st = splitStack(layer.fx);
    var draft = !!(preview && FX.interactive());
    return provider(kind).then(function (fn) {
      return fn(layer, { targetMax: targetMax, preview: preview, draft: draft, scene: scene, entries: st.dev });
    }).then(function (src) {
      if (!src || !src.source) return null;
      var dev = inject(st.dev, src.ctx);
      var key = M.hash(JSON.stringify([src.key, dev, preview ? 1 : 0, FX.stamp()]));
      var hit = devCache[layer.id];
      if (hit && hit.key === key) return { canvas: hit.canvas, rest: st.rest, key: key };
      var canvas = FX.apply(src.source, { fx: dev, box: src.box, preview: !!preview, key: preview ? 'dev|' + layer.id + '|' + src.key : null });
      if (preview) devCache[layer.id] = { key: key, canvas: canvas };
      return { canvas: canvas, rest: st.rest, key: key };
    });
  }
  FX.develop = {
    PROFILES: PROFILES, WB_PRESETS: WB_PRESETS, types: DEV_TYPES.slice(), X0: X0, X1: X1,
    toneTable: toneTable, toneAt: toneAt, basicPlan: basicPlan, basicPixel: basicPixel, genericWB: genericWB, whiteXY: whiteXY, rgc: rgcD,
    split: splitStack, inject: inject, isSceneLayer: isSceneLayer, developCanvas: developCanvas,
    forget: function (layerId) { if (layerId) delete devCache[layerId]; else devCache = {}; }
  };

  /* ---- The wrapper of LE.fx.layer (SEAM, see above). Phase 2 is the unchanged pipeline on the developed picture: crop, legacy
     adjust and filters, retouch, cut-out, the rest of the stack, masks. ---- */
  var origLayer = FX.layer;
  if (origLayer && !origLayer._develop) {
    FX.layer = function (scene, layer, targetMax, preview) {
      if (!isSceneLayer(layer) || !(FX.status().float)) return origLayer.apply(this, arguments);
      return developCanvas(scene, layer, targetMax, preview).then(function (dev) {
        if (!dev || !dev.canvas) return origLayer(scene, layer, targetMax, preview);
        /* The developed picture stands in for the layer's photo (keyed by what made it, so the original path's caches follow). */
        var pre = 'le-dev:' + layer.id + ':', tmpKey = pre + dev.key, rec = { key: tmpKey, canvas: dev.canvas };
        rec.ready = Promise.resolve(rec);
        Object.keys(scene._assets).forEach(function (k) { if (k.indexOf(pre) === 0 && k !== tmpKey) delete scene._assets[k]; });
        scene._assets[tmpKey] = rec;
        var l2 = {}; Object.keys(layer).forEach(function (k) { l2[k] = layer[k]; });
        l2.src = tmpKey; l2.fx = dev.rest; delete l2.raw;
        if (!l2.fx.length) delete l2.fx;
        return (LE.fxBoot && LE.fxBoot.needs(l2)) ? origLayer(scene, l2, targetMax, preview) : scene._processImage(Object.assign(l2, { _fxRaw: true }), targetMax, preview);
      }).catch(function (err) {
        try { console.warn('LE.fx develop: ' + (err && err.message || err)); } catch (e) { }
        return origLayer(scene, layer, targetMax, preview);
      });
    };
    FX.layer._develop = true;
  }
})(window);
