/* LocalEditor effect renderer, starter effects: the basic tone and colour controls (merged into one pass), Gaussian blur,
   grain and drop shadow. Each is one registration; see docs/FX-AUTHORING.md. Feature packs follow this file's pattern. */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;
  var M = FX.math;

  /* ---------- Helpers ---------- */
  function mul3(a, b) {
    var o = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    return o;
  }
  function vec3(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  var RGB2XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
  var XYZ2RGB = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252];
  var BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  var BRADFORD_INV = FX.quad.invert(BRADFORD);
  /* Planckian locus in CIE 1960 uv (Krystek 1985). */
  function planck(T) {
    return [
      (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T),
      (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T)
    ];
  }
  /* The white point `mired` along the locus and `duv` off it (positive = greener), as XYZ with Y = 1. */
  function whiteXYZ(mired, duv) {
    var T = 1e6 / mired, a = planck(T), b = planck(T + 2);
    var tx = b[0] - a[0], ty = b[1] - a[1], len = Math.sqrt(tx * tx + ty * ty) || 1;
    var nx = -ty / len, ny = tx / len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    var u = a[0] + nx * duv, v = a[1] + ny * duv, den = 2 * u - 8 * v + 4;
    var x = 3 * u / den, y = 2 * v / den;
    return [x / y, 1, (1 - x - y) / y];
  }
  var REF_MIRED = 1e6 / 6504;
  /* White balance as one 3×3 matrix on linear sRGB: a Bradford adaptation from the assumed light to the reference white.
     temperature and tint are −100…100; positive temperature warms the picture, positive tint moves it towards magenta. */
  M.wbMatrix = function (temperature, tint) {
    var ws = whiteXYZ(REF_MIRED - temperature * 0.9, tint * 0.0003), wd = whiteXYZ(REF_MIRED, 0);
    var ls = vec3(BRADFORD, ws), ld = vec3(BRADFORD, wd);
    var m = mul3(XYZ2RGB, mul3(BRADFORD_INV, mul3([ld[0] / ls[0], 0, 0, 0, ld[1] / ls[1], 0, 0, 0, ld[2] / ls[2]], mul3(BRADFORD, RGB2XYZ))));
    /* Keep the luminance of white where it was, so the control changes colour and not exposure. */
    var y = 0.2126 * (m[0] + m[1] + m[2]) + 0.7152 * (m[3] + m[4] + m[5]) + 0.0722 * (m[6] + m[7] + m[8]);
    return m.map(function (v) { return v / y; });
  };
  M.contrastK = function (amount) { return amount >= 0 ? 1 + amount / 100 * 1.5 : 1 / (1 + -amount / 100 * 1.5); };
  /* Highlights, shadows, whites and blacks as one monotone tone curve on luminance. */
  M.toneLUT = function (p, n) {
    n = n || 256;
    var out = new Float32Array(n), sh = (p.shadows || 0) / 100, hi = (p.highlights || 0) / 100, wh = (p.whites || 0) / 100, bl = (p.blacks || 0) / 100, i;
    for (i = 0; i < n; i++) {
      var x = i / (n - 1), y = x;
      y += sh * 0.22 * Math.pow(1 - x, 3) * x * 9.4815;
      y += hi * 0.22 * Math.pow(x, 3) * (1 - x) * 9.4815;
      y += wh * 0.18 * x * x * (0.35 + 0.65 * x);
      y += bl * 0.18 * (1 - x) * (1 - x) * (0.35 + 0.65 * (1 - x));
      out[i] = M.clamp(y, 0, 1);
    }
    for (i = 1; i < n; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
    return out;
  };
  /* A curve parameter ({ master, r, g, b }) as an n × 3 table: each channel's curve, then the master curve. Every value comes from
     LE.curves (assets/js/fx/curves.js), the spline the curve editor draws; an identity channel is skipped so a master-only
     curve is LE.curves.sample(master, n) sample for sample. */
  M.curveTable = function (curve, n) {
    n = n || 1024;
    var C = LE.curves, fm = C.monotone(curve.master), out = new Float32Array(n * 3);
    ['r', 'g', 'b'].forEach(function (k, c) {
      var fc = C.isIdentity(curve[k]) ? null : C.monotone(curve[k]);
      for (var i = 0; i < n; i++) { var x = i / (n - 1); out[i * 3 + c] = fm(fc ? fc(x) : x); }
    });
    return out;
  };
  /* The slow path: a 256-entry table per channel on 8-bit pixels. fn maps display 0–1 to display 0–1. */
  function cpuTable(img, fn) {
    var t = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)], i, c;
    for (i = 0; i < 256; i++) for (c = 0; c < 3; c++) t[c][i] = Math.round(M.clamp(fn(i / 255, c), 0, 1) * 255);
    var d = img.data;
    for (i = 0; i < d.length; i += 4) { d[i] = t[0][d[i]]; d[i + 1] = t[1][d[i + 1]]; d[i + 2] = t[2][d[i + 2]]; }
  }
  var GPU = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 60 };

  /* ---------- Light ---------- */
  FX.register({
    id: 'exposure', name: 'Exposure', group: 'light', version: 1, space: 'linear',
    params: { ev: { type: 'number', min: -5, max: 5, default: 0, step: 0.01, unit: 'ev', label: 'Exposure' } },
    passes: function (g, p) { g.color('uniform float $k; vec3 $fx(vec3 c){ return c * $k; }', { k: Math.pow(2, p.ev) }); },
    cpu: function (img, p) { var k = Math.pow(2, p.ev); cpuTable(img, function (v) { return M.linearToSrgb(M.srgbToLinear(v) * k); }); },
    support: GPU,
    ui: { section: 'Light', order: 10, controls: ['ev'] },
    agent: {
      summary: 'Brightens or darkens in linear light, in stops: +1 doubles the light, −1 halves it.',
      tips: ['Use LE.fx.analyze first: aim for a median luminance near 0.45 for a normally lit photo.', 'Prefer exposure for overall brightness and highlights-shadows for the ends of the range.'],
      example: { type: 'exposure', p: { ev: 0.35 } }
    }
  });

  FX.register({
    id: 'contrast', name: 'Contrast', group: 'light', version: 1, space: 'display',
    params: {
      amount: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Contrast' },
      pivot: { type: 'number', min: 0.1, max: 0.9, default: 0.5, step: 0.01, label: 'Pivot' }
    },
    passes: function (g, p) {
      g.color('uniform vec2 $a; vec3 $fx(vec3 c){ vec3 x = clamp(c, 0.0, 1.0); vec3 lo = $a.y * pow(x / $a.y, vec3($a.x)); vec3 hi = 1.0 - (1.0 - $a.y) * pow((1.0 - x) / (1.0 - $a.y), vec3($a.x)); return mix(lo, hi, step(vec3($a.y), x)) + (c - x); }', { a: [M.contrastK(p.amount), p.pivot] });
    },
    cpu: function (img, p) { var k = M.contrastK(p.amount), q = p.pivot; cpuTable(img, function (v) { return v < q ? q * Math.pow(v / q, k) : 1 - (1 - q) * Math.pow((1 - v) / (1 - q), k); }); },
    support: GPU,
    ui: { section: 'Light', order: 20, controls: ['amount', { param: 'pivot', fine: true }] },
    agent: {
      summary: 'An S-shaped tone change around a pivot. Black and white stay where they are; mid-tones spread or flatten.',
      tips: ['Positive values also raise saturation slightly, as in other editors.', 'Lower the pivot to protect shadows in a dark picture.'],
      example: { type: 'contrast', p: { amount: 18 } }
    }
  });

  FX.register({
    id: 'highlights-shadows', name: 'Highlights and shadows', group: 'light', version: 1, space: 'display',
    params: {
      highlights: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Highlights' },
      shadows: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Shadows' },
      whites: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Whites' },
      blacks: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Blacks' }
    },
    passes: function (g, p) {
      g.color('uniform sampler2D $t; vec3 $fx(vec3 c){ float l = clamp(luma(c), 0.0, 1.0); float t = lut1($t, l); return mix(c + (t - l), c * (t / max(l, 1e-4)), smoothstep(0.02, 0.3, l)); }', { t: g.lut1d(M.toneLUT(p, 256), 1) });
    },
    support: GPU,
    ui: { section: 'Light', order: 30, controls: ['highlights', 'shadows', 'whites', 'blacks'] },
    agent: {
      summary: 'Four tone regions on luminance: highlights and shadows shape the upper and lower mid-tones, whites and blacks move the ends. Hue and saturation are kept.',
      tips: ['To recover a bright sky: highlights −40 to −70.', 'To open a backlit subject: shadows +30 to +60, then blacks −10 so the picture keeps depth.', 'Check clipping with LE.fx.analyze before and after.'],
      example: { type: 'highlights-shadows', p: { highlights: -45, shadows: 35 } }
    }
  });

  FX.register({
    id: 'levels', name: 'Levels', group: 'light', version: 1, space: 'display',
    params: {
      inBlack: { type: 'number', min: 0, max: 0.95, default: 0, step: 0.005, label: 'Black point' },
      inWhite: { type: 'number', min: 0.05, max: 1, default: 1, step: 0.005, label: 'White point' },
      gamma: { type: 'number', min: 0.1, max: 5, default: 1, step: 0.01, label: 'Mid-tones' },
      outBlack: { type: 'number', min: 0, max: 1, default: 0, step: 0.005, label: 'Output black' },
      outWhite: { type: 'number', min: 0, max: 1, default: 1, step: 0.005, label: 'Output white' }
    },
    passes: function (g, p) {
      g.color('uniform vec4 $a; uniform float $g; vec3 $fx(vec3 c){ vec3 x = clamp((c - $a.x) / max($a.y - $a.x, 1e-4), 0.0, 1.0); return pow(x, vec3($g)) * ($a.w - $a.z) + $a.z; }', { a: [p.inBlack, p.inWhite, p.outBlack, p.outWhite], g: 1 / p.gamma });
    },
    cpu: function (img, p) { cpuTable(img, function (v) { return Math.pow(M.clamp((v - p.inBlack) / Math.max(p.inWhite - p.inBlack, 1e-4), 0, 1), 1 / p.gamma) * (p.outWhite - p.outBlack) + p.outBlack; }); },
    support: GPU,
    ui: { section: 'Light', order: 40, controls: ['inBlack', 'inWhite', 'gamma', { heading: 'Output' }, 'outBlack', 'outWhite', { action: 'grade.auto', label: 'Auto tone and balance' }] },
    agent: {
      summary: 'Sets the black point, white point and mid-tone gamma, then the output range.',
      tips: ['Read percentiles from LE.fx.analyze: inBlack = luma p1, inWhite = luma p99 stretches a flat picture to the full range.', 'gamma above 1 brightens mid-tones.'],
      example: { type: 'levels', p: { inBlack: 0.04, inWhite: 0.93, gamma: 1.08 } }
    }
  });

  FX.register({
    id: 'curves', name: 'Curves', group: 'curves', version: 1, space: 'display',
    params: { curve: { type: 'curve', label: 'Tone curve' } },
    passes: function (g, p) { g.color('uniform sampler2D $t; vec3 $fx(vec3 c){ return lut1rgb($t, c); }', { t: g.lut1d(M.curveTable(p.curve, 1024), 3) }); },
    cpu: function (img, p) { var t = M.curveTable(p.curve, 256); cpuTable(img, function (v, c) { return t[Math.round(v * 255) * 3 + c]; }); },
    support: GPU,
    ui: { section: 'Curves', order: 10, controls: ['curve'] },
    agent: {
      summary: 'Tone curves through control points (0–1, display-referred): { master, r, g, b }; each channel first, then the master curve. Monotone interpolation, so points never overshoot.',
      tips: ['A gentle S: { "master": [[0,0],[0.25,0.2],[0.75,0.8],[1,1]] }.', 'Lift blacks for a matte look: start the master curve at [0, 0.06].', 'Warm the highlights: raise r and lower b near x = 0.8.'],
      example: { type: 'curves', p: { curve: { master: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]] } } }
    }
  });

  /* ---------- Colour ---------- */
  FX.register({
    id: 'white-balance', name: 'White balance', group: 'color', version: 1, space: 'linear',
    params: {
      temperature: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Temperature' },
      tint: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Tint' }
    },
    passes: function (g, p) { g.color('uniform mat3 $m; vec3 $fx(vec3 c){ return $m * c; }', { m: M.wbMatrix(p.temperature, p.tint) }); },
    support: GPU,
    ui: { section: 'Colour', order: 10, controls: [{ param: 'temperature', gradient: 'temperature' }, { param: 'tint', gradient: 'tint' }] },
    agent: {
      summary: 'A chromatic adaptation in linear light along the black-body line (temperature) and across it (tint). Positive temperature warms, positive tint adds magenta.',
      tips: ['LE.fx.analyze returns whiteBalance.suggest { temperature, tint }: the values that make the near-neutral pixels neutral.', 'Put it first in the stack, before tone controls.'],
      example: { type: 'white-balance', p: { temperature: 12, tint: -4 } }
    }
  });

  FX.register({
    id: 'saturation', name: 'Saturation and vibrance', group: 'color', version: 1, space: 'display',
    params: {
      saturation: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Saturation' },
      vibrance: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Vibrance' }
    },
    passes: function (g, p) {
      g.color('uniform vec2 $a; vec3 $fx(vec3 c){ float l = luma(c); float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); float k = max($a.x * (1.0 + $a.y * (1.0 - clamp(sat * 1.5, 0.0, 1.0))), 0.0); return l + (c - l) * k; }', { a: [1 + p.saturation / 100, p.vibrance / 100] });
    },
    support: GPU,
    ui: { section: 'Colour', order: 20, controls: ['vibrance', { param: 'saturation', gradient: 'saturation' }] },
    agent: {
      summary: 'Saturation scales every colour around its luminance; vibrance does the same but mostly for muted colours, so skin and already vivid areas move less.',
      tips: ['Prefer vibrance for portraits.', 'saturation −100 is a luminance black-and-white.'],
      example: { type: 'saturation', p: { vibrance: 25, saturation: 5 } }
    }
  });

  /* ---------- Spatial ---------- */
  FX.register({
    id: 'gaussian-blur', name: 'Gaussian blur', group: 'blur', version: 1, space: 'linear',
    params: { radius: { type: 'number', min: 0, max: 250, default: 8, step: 0.1, unit: 'px', label: 'Radius' } },
    radius: function (p, scale) { return M.blurReach(p.radius * scale); },
    passes: function (g, p) { return g.blur(p.radius); },
    support: { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 120 },
    ui: { section: 'Optics', order: 10, controls: ['radius'] },
    agent: {
      summary: 'A true Gaussian blur in linear light; radius is the standard deviation in document pixels, so it looks the same at any export size.',
      tips: ['Edges are extended, so the picture keeps its frame.', 'With a mask it becomes a selective blur: a radial mask inverted gives a soft-focus surround.'],
      example: { type: 'gaussian-blur', p: { radius: 12 } }
    }
  });

  FX.register({
    id: 'grain', name: 'Grain', group: 'effects', version: 1, space: 'display',
    params: {
      amount: { type: 'number', min: 0, max: 100, default: 25, step: 1, label: 'Amount' },
      size: { type: 'number', min: 0.5, max: 8, default: 1.2, step: 0.1, unit: 'px', label: 'Size' },
      luminance: { type: 'number', min: 0, max: 1, default: 0.6, step: 0.01, label: 'Mid-tone weighting' },
      color: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Colour' },
      seed: { type: 'seed', default: 1, label: 'Seed' }
    },
    passes: function (g, p) {
      g.color([
        'uniform vec4 $a; uniform float $s;',
        'float $n(vec2 p, float s){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(docNoise(i, s), docNoise(i + vec2(1.0, 0.0), s), f.x), mix(docNoise(i + vec2(0.0, 1.0), s), docNoise(i + vec2(1.0, 1.0), s), f.x), f.y); }',
        'float $g(vec2 p, float s){ return ($n(p, s) + $n(p * 2.03 + 17.0, s + 1.0) * 0.5) / 1.5; }',
        'vec3 $fx(vec3 c){ vec2 p = docPos() / $a.y - 0.5; float m = $g(p, $s); vec3 n = vec3(m);',
        '  if ($a.w > 0.0) n = mix(n, vec3($g(p + 31.7, $s + 2.0), $g(p + 71.3, $s + 3.0), $g(p + 113.9, $s + 4.0)), $a.w);',
        '  float l = clamp(luma(c), 0.0, 1.0); float w = mix(1.0, 3.4 * l * (1.0 - l) + 0.15, $a.z);',
        '  return c + (n - 0.5) * $a.x * w; }'
      ].join('\n'), { a: [p.amount / 100 * 0.6, p.size, p.luminance, p.color], s: p.seed % 65536 });
    },
    support: GPU,
    ui: { section: 'Effects', order: 10, controls: ['amount', 'size', 'luminance', 'color', 'seed'] },
    agent: {
      summary: 'Film-like grain defined in document space and seeded: the preview, the export and every tile show the same pattern. Strongest in the mid-tones.',
      tips: ['Put grain last, after blur and tone, so it is not smoothed or stretched.', 'size is in document pixels; under 1 it is finer than the page grid and reads as texture only at export size.', 'Change seed for a different pattern with the same character.'],
      example: { type: 'grain', p: { amount: 22, size: 1.4, seed: 7 } }
    }
  });

  FX.register({
    id: 'drop-shadow', name: 'Drop shadow', group: 'shadow', version: 1, space: 'display', needs: ['alpha'],
    params: {
      x: { type: 'number', min: -500, max: 500, default: 0, step: 1, unit: 'px', label: 'Offset X' },
      y: { type: 'number', min: -500, max: 500, default: 12, step: 1, unit: 'px', label: 'Offset Y' },
      blur: { type: 'number', min: 0, max: 250, default: 16, step: 0.5, unit: 'px', label: 'Blur' },
      spread: { type: 'number', min: 0, max: 0.95, default: 0, step: 0.01, label: 'Spread' },
      color: { type: 'color', default: '#000000', label: 'Colour' },
      opacity: { type: 'number', min: 0, max: 1, default: 0.45, step: 0.01, label: 'Opacity' }
    },
    radius: function (p, scale) { return Math.ceil(Math.max(Math.abs(p.x), Math.abs(p.y)) * scale) + M.blurReach(p.blur * scale) + 2; },
    grow: function (p, scale) { return Math.ceil(Math.max(Math.abs(p.x), Math.abs(p.y)) * scale) + M.blurReach(p.blur * scale) + 2; },
    passes: function (g, p) {
      var a = g.alpha(), soft = p.blur > 0 ? g.blur(p.blur, { source: a }) : a, c = g.rgb(p.color);
      return g.pass('uniform sampler2D u_sh; uniform vec2 u_off; uniform vec4 u_col; uniform float u_spread;\nvec4 fx(){ vec4 s = src(v_uv); float a = texture(u_sh, v_uv - docToUV(u_off)).a; a = clamp(a / max(1.0 - u_spread, 0.01), 0.0, 1.0) * u_col.a; return s + vec4(u_col.rgb * a, a) * (1.0 - s.a); }',
        { u_sh: soft, u_off: [p.x, p.y], u_col: [c[0], c[1], c[2], c[3] * p.opacity], u_spread: p.spread });
    },
    support: { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 120 },
    ui: { section: 'Shadows & reflections', order: 10, controls: ['x', 'y', 'blur', 'spread', 'color', 'opacity'] },
    agent: {
      summary: 'A shadow cast by the layer\'s own silhouette (after cut-out and mask), drawn outside the layer box. Offsets and blur are document pixels.',
      tips: ['It follows the cut-out, unlike the layer\'s plain `shadow` field, which follows the box.', 'A soft studio look: y 24, blur 40, opacity 0.3. A hard sticker look: x 6, y 6, blur 0, opacity 0.9.', 'Match the shadow colour to the darkest tone of the background instead of pure black.'],
      example: { type: 'drop-shadow', p: { y: 24, blur: 40, opacity: 0.3 } }
    }
  });
})(window);
