/* LocalEditor effect renderer, creative pack (X2): film and analog looks, optics, the blur gallery, detail, stylise and
   atmosphere effects, plus named looks (LE.fx.creative.presets). The contract is docs/FX-AUTHORING.md; the reference for
   agents and people is docs/FX-REFERENCE.md ("Creative pack").

   Relation to the starter pack (le-fx-basic.js): `grain` and `gaussian-blur` stay as the simple controls. `film-grain`
   supersedes `grain` for film work (density-space model, roughness, per-channel response); `lens-blur`, `box-blur`,
   `motion-blur` and the field blurs extend `gaussian-blur` (which remains the right choice for a plain Gaussian).

   Conventions used everywhere below:
   - "linear" effects work on linear-light Rec. 709 / sRGB primaries, premultiplied; "display" effects on sRGB-encoded values.
   - Lengths are document pixels (`unit: 'px'`) and scaled by g.scale; positions are `point` values in fractions of the
     layer box; procedural patterns are functions of docPos() and a seed, so preview, export and every tile agree.
   - Pyramids built here never go deeper than 6 levels (8 when the effect's own reach is over 400 px), because tile origins
     sit on a 64-pixel grid (256 past a reach of 400): deeper levels would not line up between tiles.
   - Every effect is neutral at its defaults: the strength parameter starts at 0 and passes() then records nothing. */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;
  var M = FX.math;
  var CR = FX.creative = FX.creative || {};

  /* ---------- Parameter shorthands ---------- */
  function N(min, max, def, step, label, unit, help) {
    var o = { type: 'number', min: min, max: max, default: def, step: step, label: label };
    if (unit) o.unit = unit;
    if (help) o.help = help;
    return o;
  }
  function CH(options, def, label) { return { type: 'choice', options: options, default: def, label: label }; }
  function COL(def, label) { return { type: 'color', default: def, label: label }; }
  function PT(x, y, label) { return { type: 'point', default: { x: x, y: y }, label: label }; }
  function ANG(def, label) { return { type: 'angle', default: def, label: label }; }
  function SEED() { return { type: 'seed', default: 1, label: 'Seed' }; }
  function BOOL(def, label) { return { type: 'bool', default: def, label: label }; }
  function opts(list) { return list.map(function (o) { return { value: o[0], label: o[1] }; }); }

  var GPU = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 40 };
  var GPU_MID = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 120 };
  var GPU_BIG = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 200 };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lin(v) { return M.srgbToLinear(v); }
  function seedOf(p) { return (p.seed || 0) % 65536; }
  function reg(def) { FX.register(def); CR.ids = (CR.ids || []).concat([def.id]); }

  /* ---------- Shared GLSL ----------
     NOISE is written with `$` names so it can sit inside g.color (where `$` becomes a unique prefix); P() makes it plain
     for a standalone pass. docNoise is the renderer's integer hash, the same on every GPU. */
  var NOISE = [
    'float $vn(vec2 p, float s){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(docNoise(i, s), docNoise(i + vec2(1.0, 0.0), s), f.x), mix(docNoise(i + vec2(0.0, 1.0), s), docNoise(i + vec2(1.0, 1.0), s), f.x), f.y); }',
    'float $fbm(vec2 p, float s, int o){ float a = 0.5, t = 0.0, n = 0.0; for (int i = 0; i < 6; i++) { if (i >= o) break; t += a * $vn(p, s + float(i) * 13.0); n += a; p = mat2(1.6, 1.2, -1.2, 1.6) * p + 5.3; a *= 0.5; } return t / n; }',
    'vec2 $asp(){ return docPos() / min(u_box.x, u_box.y); }',
    'vec2 $rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }',
    ''
  ].join('\n');
  function P(src) { return src.replace(/\$/g, 'k_'); }
  var TENT = 'vec4 tent(sampler2D t, vec2 uv){ vec2 d = 0.5 / vec2(textureSize(t, 0)); return (texture(t, uv + d) + texture(t, uv - d) + texture(t, uv + vec2(d.x, -d.y)) + texture(t, uv + vec2(-d.x, d.y))) * 0.25; }\n';

  /* Levels a pyramid may use for an effect whose own reach (target px) is `reach`. */
  function maxLevels(reach) { return reach > 400 ? 8 : 6; }
  /* Halvings so that `px` target pixels become at most `most` pixels at that level. */
  function levelFor(px, most, cap) { var L = 0; while (px / (1 << L) > most && L < cap) L++; return L; }
  /* Reach of an n-level box-down / tent-up chain, in target pixels. */
  function chainReach(n) { return n > 0 ? 3 * (1 << n) + 4 : 0; }

  /* Soft threshold with a knee (the common bloom prefilter): returns the factor that scales a colour of brightness b. */
  var KNEE = 'float knee(float b, float th, float kn){ float r = clamp(b - th + kn, 0.0, 2.0 * kn); r = r * r / (4.0 * kn + 1e-5); return max(r, b - th) / max(b, 1e-5); }\n';

  /* ---------- Multi-scale glow chain (bloom, glow, halation) ----------
     prefiltered full-resolution handle → n box downsamples → upsample-and-add with per-level weights. Level i (1…n) has a
     texel of 2^i target pixels; a level of the same size in document pixels is used whatever the scale, so the half-size
     preview drops exactly the finest level. Returns { h (half resolution), norm (1 / sum of weights) }. */
  var UPADD = TENT + 'uniform sampler2D u_add; uniform vec2 u_w;\nvec4 fx(){ return tent(u_src, v_uv) * u_w.x + texture(u_add, v_uv) * u_w.y; }';
  function glowChain(g, pre, n, weight) {
    var d = g.downsample(pre, n), i, sum = 0, w = [];
    g.release(pre);
    for (i = 0; i < n; i++) { w[i] = weight(i + 1, n); sum += w[i]; }
    var acc = d[n - 1];
    for (i = n - 2; i >= 0; i--) {
      var next = g.pass(UPADD, { u_src: acc, u_add: d[i], u_w: [i === n - 2 ? w[n - 1] : 1, w[i]] }, { scale: 1 / (2 << i) });
      g.release(acc); g.release(d[i]); acc = next;
    }
    if (n === 1) { acc = g.pass('uniform float u_k; vec4 fx(){ return texture(u_src, v_uv) * u_k; }', { u_src: d[0], u_k: w[0] }, { scale: 0.5 }); g.release(d[0]); }
    return { h: acc, norm: 1 / (sum || 1) };
  }

  /* ---------- Bokeh kernels and gathers (lens blur, depth blur, field blurs) ----------
     A kernel is a set of points in the unit aperture: concentric rings with 6·k points on ring k (uniform density), mapped
     onto a polygon with `blades` straight sides (blended back to a circle by `roundness`), rotated. */
  var KCACHE = {};
  function bokehKernel(rings, blades, roundness, rotation) {
    var key = [rings, blades, Math.round(roundness * 100), Math.round(rotation)].join('|');
    if (KCACHE[key]) return KCACHE[key];
    var pts = [0, 0], rot = rotation * Math.PI / 180, b = Math.max(3, Math.round(blades || 0)), seg = 2 * Math.PI / b;
    for (var k = 1; k <= rings; k++) {
      var m = 6 * k, rho = k / rings;
      for (var j = 0; j < m; j++) {
        var th = (j + (k % 2) * 0.5) / m * 2 * Math.PI;
        var a = ((th - rot) % seg + seg) % seg - seg / 2, poly = Math.cos(seg / 2) / Math.cos(a);
        var rr = rho * (blades >= 3 ? poly + (1 - poly) * roundness : 1);
        pts.push(Math.cos(th) * rr, Math.sin(th) * rr);
      }
    }
    var out = { data: new Float32Array(pts), n: pts.length / 2 };
    var keys = Object.keys(KCACHE); if (keys.length > 24) delete KCACHE[keys[0]];
    return (KCACHE[key] = out);
  }
  var MAXK = 127;   /* 6 rings: 1 + 6 + 12 + … + 36 = 127 points */
  /* Rings for a gather whose radius is `px` pixels at its level: ring spacing stays under 1.6 pixels. */
  function ringsFor(draft, px) { return clamp(Math.ceil((px || 99) / 1.6), 2, draft ? 3 : 6); }
  /* Highlight boost before the gather: bright parts are amplified so they open into visible discs (energy is kept by the average). */
  var BOOST = 'uniform vec3 u_hb;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float b = 1.0 + u_hb.x * smoothstep(u_hb.y, u_hb.z, luma(c)); return vec4(s.rgb * b, s.a); }';
  function boostOf(p) { var th = lin(p.threshold), gain = (p.highlights || 0) / 100 * 8; return gain > 0 ? [gain, th * 0.85, Math.max(th, th * 0.85 + 1e-3)] : null; }
  var GATHER = 'uniform vec2 u_k[' + MAXK + ']; uniform int u_n; uniform float u_r, u_cat;\n' +
    'vec4 fx(){ vec2 cq = (boxUV() - 0.5) * 2.0 * u_cat; vec4 acc = vec4(0.0); float ws = 0.0;\n' +
    '  for (int i = 0; i < ' + MAXK + '; i++) { if (i >= u_n) break; vec2 k = u_k[i]; float w = u_cat > 0.0 ? clamp((1.0 - length(k + cq)) * 6.0 + 0.5, 0.0, 1.0) : 1.0;\n' +
    '    acc += texture(u_src, v_uv + docToUV(k * u_r)) * w; ws += w; }\n' +
    '  return acc / max(ws, 1e-4); }';
  /* A uniform-aperture gather of `src` (full resolution) with radius R document pixels. Returns { h, L } (h at 1 / 2^L). */
  function gatherAt(g, levels, R, kern, cat, most) {
    var Rt = R * g.scale, L = levelFor(Rt, most || 10, levels.length);
    var srcL = L ? levels[L - 1] : levels.base;
    return { h: g.pass(GATHER, { u_src: srcL, u_k: kern.data, u_n: kern.n, u_r: R, u_cat: cat || 0 }, { scale: 1 / (1 << L) }), L: L };
  }
  function pyramid(g, base, L) {
    var lv = L > 0 ? g.downsample(base, L) : [];
    lv.base = base;
    return lv;
  }
  function freePyramid(g, lv) { lv.forEach(function (h) { g.release(h); }); if (lv.base) g.release(lv.base); }

  /* ---------- Directional "comb" blurs (motion, box, streaks, zoom, spin, god rays) ----------
     k passes of n taps; pass j spaces its taps L / n^(j+1) apart, so the passes convolve into n^k evenly spaced taps over
     the length L (a box), or, with decaying weights, an exponential-like streak. Bilinear taps fill the gaps. */
  var COMB = 'uniform vec2 u_dir; uniform int u_n; uniform float u_w[16];\nvec4 fx(){ vec4 a = vec4(0.0); for (int i = 0; i < 16; i++) { if (i >= u_n) break; float t = float(i) - 0.5 * float(u_n - 1); a += texture(u_src, v_uv + docToUV(u_dir * t)) * u_w[i]; } return a; }';
  function combWeights(n, decay) {
    var w = new Float32Array(16), s = 0, i;
    for (i = 0; i < n; i++) { var t = Math.abs(i - 0.5 * (n - 1)) / Math.max(1, 0.5 * (n - 1)); w[i] = decay ? Math.exp(-decay * t) : 1; s += w[i]; }
    for (i = 0; i < n; i++) w[i] /= s;
    return w;
  }
  function combPasses(Lt) { return Lt <= 1 ? 0 : Lt <= 10 ? 1 : Lt <= 80 ? 2 : 3; }
  /* Blur `src` along the document-space unit vector `dir` over `len` document pixels. */
  function comb(g, src, dir, len, decay, scale) {
    var Lt = len * g.scale * (scale || 1), k = combPasses(Lt), n = 10, cur = src;
    if (g.draft && k > 1) k--;
    for (var j = 0; j < k; j++) {
      var step = len / Math.pow(n, j + 1);
      var out = g.pass(COMB, { u_src: cur, u_dir: [dir[0] * step, dir[1] * step], u_n: n, u_w: combWeights(n, decay) }, { scale: scale || 1 });
      if (cur !== src) g.release(cur);
      cur = out;
    }
    return cur;
  }

  /* ---------- Depth from layer.maps.depth (seam) ----------
     The renderer exposes the depth map only through masks. A depth part with near = far = soft = 1 returns smoothstep(0, 1, d)
     for d in 0–1 (0 = nearest), which is inverted exactly in the shader: d = 0.5 − sin(asin(1 − 2y) / 3). A second part with
     near = 1, far = 0 is 0 for every real depth and 1 where the map is missing, so the effects can stay neutral then.
     Proposal for the renderer: g.depth() → a handle with the unpacked depth in .r (and a flag when it is missing). */
  var DEPTH_DEF = { parts: [{ kind: 'depth', near: 1, far: 1, soft: 1 }] };
  var DEPTH_MISSING = { parts: [{ kind: 'depth', near: 1, far: 0, soft: 0 }] };
  var DEPTH_GLSL = 'float depthAt(sampler2D t, vec2 uv){ uv = clamp(uv, u_img.xy + 0.5 * u_texel, u_img.zw - 0.5 * u_texel); float y = clamp(texture(t, uv).r, 0.0, 1.0); return 0.5 - sin(asin(1.0 - 2.0 * y) / 3.0); }\n';
  CR.depthFromMask = function (y) { y = clamp(y, 0, 1); return 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3); };

  /* =====================================================================================================================
     1. Film and analog
     ===================================================================================================================== */

  /* Film grain in density space. A print's density is D = −log10(T) for transmittance T (here: linear light). Grain is a
     random density offset, so it multiplies linear light: c' = c · 10^(−σ·n). σ follows a response curve over display
     luminance (strongest in the lower mid-tones, rolled off in the highlights and the deepest shadows, as on a print), n is
     zero-mean noise built from value-noise octaves at the grain size (roughness adds a finer octave and removes the clumping
     octave). Colour mixes three independent channel fields into the shared one (dye clouds of each layer).
     Sizes are document pixels; when a target pixel covers several grains (a reduced preview) the amplitude falls by
     size/footprint, the standard deviation of their average, so the preview reads as the export does at its own scale. */
  CR.grainResponse = function (L, response) { var mid = Math.pow(Math.max(4 * L * (1 - L), 0), 0.6); return (1 - response + response * mid) * (1 - 0.85 * response * smoothstepJS(0.7, 1.0, L)); };
  function smoothstepJS(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  reg({
    id: 'film-grain', name: 'Film grain', group: 'effects', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      size: N(0.5, 6, 1.2, 0.1, 'Size', 'px', 'Average grain size in document pixels.'),
      roughness: N(0, 100, 50, 1, 'Roughness', null, 'Low values give soft, clumped grain; high values a crisp, irregular one.'),
      color: N(0, 100, 0, 1, 'Colour', null, 'How independent the three dye layers are. 0 is monochrome grain.'),
      response: N(0, 100, 75, 1, 'Mid-tone response', null, 'How much the grain concentrates in the mid-tones and leaves highlights clean.'),
      seed: SEED()
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var foot = 1 / Math.max(g.scale, 1e-6), aa = Math.min(1, p.size / foot);
      g.color(NOISE + [
        'uniform vec4 $a; uniform vec4 $b;',
        'float $o(vec2 q, float s){ return $vn(q, s) + $vn(q + vec2(0.5, 0.31), s + 101.0) - 1.0; }',
        'float $g(vec2 q, float s){ float r = $b.z; return ($o(q, s) * 1.0 + $o(q * 2.03 + 7.1, s + 3.0) * r * 0.7 + $o(q * 0.49 + 3.3, s + 5.0) * (1.0 - r) * 0.6) / (1.0 + 0.35 * r + 0.3 * (1.0 - r)); }',
        'vec3 $fx(vec3 c){ vec2 q = docPos() / $a.y; float s = $b.x; float m = $g(q, s); vec3 n = vec3(m);',
        '  if ($a.w > 0.0) n = mix(n, vec3($o(q + 31.7, s + 11.0), $o(q + 71.3, s + 23.0), $o(q + 113.9, s + 37.0)), $a.w);',
        '  float L = pow(clamp(luma(c), 0.0, 1.0), 1.0 / 2.2); float mid = pow(max(4.0 * L * (1.0 - L), 0.0), 0.6);',
        '  float w = (1.0 - $b.w + $b.w * mid) * (1.0 - 0.85 * $b.w * smoothstep(0.7, 1.0, L));',
        '  return c * exp2(-$a.x * w * n * 3.321928); }'
      ].join('\n'), { a: [p.amount / 100 * 0.32 * aa, p.size, 0, p.color / 100], b: [seedOf(p), 0, p.roughness / 100, p.response / 100] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 12, controls: ['amount', 'size', 'roughness', 'color', 'response', 'seed'] },
    agent: {
      summary: 'Photographic film grain modelled as random density on a print: it multiplies linear light, sits mostly in the mid-tones and leaves clean highlights. Seeded and defined in document space.',
      like: 'the film grain panel of raw developers and film-emulation plug-ins',
      tips: ['Put it last in the stack, after blur and tone, so nothing smooths it.', 'Fine 35 mm stock: amount 25–35, size 1.0–1.4, roughness 40–60. Push-processed or 16 mm: amount 50–70, size 2–3.', 'colour 15–30 adds the faint dye-cloud colour of colour negative film; leave it at 0 for black-and-white.', 'Use the starter `grain` effect only when you want a simple, even noise.'],
      example: { type: 'film-grain', p: { amount: 30, size: 1.3, roughness: 55, color: 20, seed: 7 } }
    }
  });

  /* Halation: light that passes through the emulsion, reflects off the film base and re-exposes the red-sensitive layer, so
     bright edges get a red-orange rim. Model (linear light): a knee threshold on luminance keeps the highlights, a multi-scale
     chain spreads them (weights favour the tight core), the result is tinted and added. Passes: 1 + n down + (n − 1) up + 1. */
  function glowNFor(Rt) { return clamp(Math.round(Math.log(Math.max(Rt, 2)) / Math.LN2), 1, 8); }
  /* Seven or eight levels only line up between tiles on the 256-pixel grid, which the renderer uses past a reach of 400. */
  function glowRadius(p, scale) { var n = glowNFor(p.radius * scale), r = chainReach(n); return n > 6 ? Math.max(r, 401) : r; }
  function glowReach(p, scale) { return p.amount > 0 && p.radius > 0 ? glowRadius(p, scale) : 0; }
  function glowN(g, p) { return glowNFor(p.radius * g.scale); }
  var PREFILTER = KNEE + 'uniform vec2 u_th;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float b = max(max(c.r, c.g), c.b); return vec4(c * knee(b, u_th.x, u_th.y) * s.a, s.a); }';
  var ADDGLOW = TENT + 'uniform sampler2D u_glow; uniform vec3 u_t;\nvec4 fx(){ vec4 s = src(v_uv); vec3 gl = tent(u_glow, v_uv).rgb; return vec4(s.rgb + gl * u_t * s.a, s.a); }';
  reg({
    id: 'halation', name: 'Halation', group: 'effects', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      threshold: N(0, 1, 0.8, 0.01, 'Threshold', null, 'Display brightness above which light starts to halate.'),
      radius: N(1, 200, 10, 0.5, 'Radius', 'px'),
      color: COL('#ff4a14', 'Colour')
    },
    radius: glowReach,
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var th = lin(p.threshold), pre = g.pass(PREFILTER, { u_th: [th, Math.max(th * 0.5, 0.02)] });
      var ch = glowChain(g, pre, glowN(g, p), function (i) { return Math.pow(0.6, i - 1); });
      var t = g.rgb(p.color), k = p.amount / 100 * 1.6 * ch.norm;
      return g.pass(ADDGLOW, { u_glow: ch.h, u_t: [t[0] * k, t[1] * k, t[2] * k] });
    },
    support: GPU_MID,
    ui: { section: 'Effects', order: 20, controls: ['amount', 'threshold', 'radius', 'color'] },
    agent: {
      summary: 'The red-orange glow film shows around bright highlights and light sources: thresholded highlights, spread and tinted, added in linear light.',
      like: 'the halation control of film-emulation tools and cinema finishing software',
      tips: ['Subtle print look: amount 20–35, radius 6–12, threshold 0.7.', 'Night scenes with lamps and neon: amount 40–60, radius 12–25, threshold 0.6.', 'It is strongest where a highlight meets a dark area; nothing happens in a picture with no bright parts.'],
      example: { type: 'halation', p: { amount: 35, threshold: 0.7, radius: 12 } }
    }
  });

  /* Bloom: energy-conserving light spread in linear light (scene-referred threshold with a soft knee). Every level of the chain
     gets the same weight, which gives the long ~1/r² tail of a real lens and sensor; the sum is normalised so `amount` 50 adds
     the prefiltered light once. Passes: 1 + n + (n − 1) + 1, n = log2(radius · scale) ≤ 6 (8 for very wide radii). */
  reg({
    id: 'bloom', name: 'Bloom', group: 'effects', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      threshold: N(0, 4, 0.9, 0.01, 'Threshold', null, 'Linear brightness where bloom starts (1 is display white).'),
      knee: N(0, 1, 0.5, 0.01, 'Softness', null, 'Width of the soft knee around the threshold.'),
      radius: N(4, 400, 60, 1, 'Radius', 'px'),
      color: COL('#ffffff', 'Tint')
    },
    radius: glowReach,
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var pre = g.pass(PREFILTER, { u_th: [p.threshold, Math.max(p.knee * Math.max(p.threshold, 0.05), 1e-3)] });
      var ch = glowChain(g, pre, glowN(g, p), function () { return 1; });
      var t = g.rgb(p.color), k = p.amount / 50 * ch.norm;
      return g.pass(ADDGLOW, { u_glow: ch.h, u_t: [t[0] * k, t[1] * k, t[2] * k] });
    },
    support: GPU_MID,
    ui: { section: 'Effects', order: 30, controls: ['amount', 'threshold', 'knee', 'radius', 'color'] },
    agent: {
      summary: 'Physically based bloom: light above a threshold spreads with a long soft tail and is added in linear light, as from a real lens and sensor.',
      like: 'bloom in game engines and compositing tools; the light-spread part of a glow filter',
      tips: ['Threshold is linear: 1 is display white. Use 0.7–0.9 for a gentle glow on ordinary photos, 1.0+ to bloom only true highlights in HDR or RAW sources.', 'Dreamy: amount 25, radius 80, softness 0.7. Neon at night: amount 50, threshold 0.6, radius 120.', 'Put it after exposure and white balance and before grain.'],
      example: { type: 'bloom', p: { amount: 30, threshold: 0.8, radius: 80 } }
    }
  });

  /* Glow: the same chain with a display-referred threshold, a tint and screen blending in display values, so it can never
     push a pixel past white (the classic "glow" of design tools, unlike bloom, which adds light). */
  var SCREENGLOW = TENT + 'uniform sampler2D u_glow; uniform vec3 u_t;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); vec3 gd = clamp(toDisplay(max(tent(u_glow, v_uv).rgb * u_t, 0.0)), 0.0, 1.0); vec3 d = toDisplay(c); vec3 o = 1.0 - (1.0 - clamp(d, 0.0, 1.0)) * (1.0 - gd) + max(d - 1.0, 0.0); return vec4(toLinear(o) * s.a, s.a); }';
  reg({
    id: 'glow', name: 'Glow', group: 'effects', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      threshold: N(0, 1, 0.6, 0.01, 'Threshold', null, 'Display brightness where the glow starts.'),
      knee: N(0, 1, 0.4, 0.01, 'Softness'),
      radius: N(2, 300, 30, 1, 'Radius', 'px'),
      color: COL('#ffffff', 'Tint')
    },
    radius: glowReach,
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var th = lin(p.threshold), pre = g.pass(PREFILTER, { u_th: [th, Math.max(p.knee * th, 1e-3)] });
      var ch = glowChain(g, pre, glowN(g, p), function (i, n) { return Math.pow(0.8, n - i); });
      var t = g.rgb(p.color), k = p.amount / 100 * 1.8 * ch.norm;
      return g.pass(SCREENGLOW, { u_glow: ch.h, u_t: [t[0] * k, t[1] * k, t[2] * k] });
    },
    support: GPU_MID,
    ui: { section: 'Effects', order: 32, controls: ['amount', 'threshold', 'knee', 'radius', 'color'] },
    agent: {
      summary: 'A tinted glow around bright parts, blended with screen so it brightens without clipping. Use for neon, signs, product highlights.',
      like: 'outer-glow and glow filters of photo and design editors',
      tips: ['Coloured neon: tint the glow with the sign colour, threshold 0.5, radius 20–40.', 'Prefer bloom for a photographic light spread; glow is a graphic look.'],
      example: { type: 'glow', p: { amount: 35, threshold: 0.7, radius: 30, color: '#ff7ad9' } }
    }
  });

  /* Light leaks and film burn: light reaching the film from the edge of the frame. Procedural and seeded: an elongated
     radial field around `position`, warped by fBm turbulence, coloured from `color` (outer) to `color2` (hot core) and added
     with screen blending in linear light. "burn" sharpens the field and blows the core out to white; "flash" is a wide, soft
     wash. One colour pass. */
  reg({
    id: 'light-leak', name: 'Light leak', group: 'effects', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      style: CH(opts([['leak', 'Leak'], ['burn', 'Burn'], ['flash', 'Flash']]), 'leak', 'Style'),
      position: PT(0.95, 0.2, 'Position'),
      size: N(0.05, 2, 0.6, 0.01, 'Size', null, 'Fraction of the short side of the picture.'),
      angle: ANG(70, 'Angle'),
      color: COL('#ff5a1f', 'Colour'),
      color2: COL('#ffd27a', 'Core colour'),
      turbulence: N(0, 100, 50, 1, 'Turbulence'),
      seed: SEED()
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var st = { leak: [2.2, 0.0, 0.7], burn: [3.5, 1.0, 1.3], flash: [1.1, 0.0, 0.35] }[p.style] || [2.2, 0, 0.7];
      var a = g.rgb(p.color), b = g.rgb(p.color2), sh = Math.min(g.box.w, g.box.h);
      g.color(NOISE + [
        'uniform vec4 $p; uniform vec4 $s; uniform vec3 $c1, $c2; uniform float $amt;',
        'vec3 $fx(vec3 c){ vec2 q = $rot($asp() - $p.xy, -$p.w); q.x *= 0.55; float t = $s.w;',
        '  float n = $fbm(q * 2.2 + $s.z * 0.013, $s.z, 4) - 0.5; float d = length(q) / $p.z + n * t * 0.9;',
        '  float f = exp(-d * d * $s.x); vec3 col = mix($c1, $c2, smoothstep(0.25, 0.95, f));',
        '  col = mix(col, vec3(1.0), $s.y * smoothstep(0.75, 1.0, f)); vec3 L = col * f * $amt * (1.0 + $s.y * 2.0);',
        '  vec3 cc = clamp(c, 0.0, 1.0); return c + L * (1.0 - cc); }'
      ].join('\n'), { p: [p.position.x * g.box.w / sh, p.position.y * g.box.h / sh, p.size, p.angle * Math.PI / 180], s: [st[0], st[1], seedOf(p), p.turbulence / 100], c1: a.slice(0, 3), c2: b.slice(0, 3), amt: p.amount / 100 * st[2] * 1.6 });
    },
    support: GPU,
    ui: { section: 'Effects', order: 40, controls: ['amount', 'style', 'position', 'size', 'angle', 'color', 'color2', 'turbulence', 'seed'] },
    agent: {
      summary: 'A procedural light leak or film burn entering from a point near the frame edge: warm, turbulent, seeded, screen-blended in linear light.',
      like: 'light-leak overlays and film-burn transitions, generated instead of photographed',
      tips: ['Place position on or just outside an edge (x 0.95–1.1 or y −0.05–0.1) so the light seems to come from the gate.', 'Leak: amount 30–50. Burn: amount 40–70 for a dramatic, blown-out corner. Flash: a soft wash over a third of the frame.', 'Change seed for another shape with the same character; angle sets the direction of the streak.'],
      example: { type: 'light-leak', p: { amount: 40, style: 'leak', position: { x: 1.0, y: 0.25 }, size: 0.7, seed: 4 } }
    }
  });

  /* Dust and scratches: procedural, seeded overlay of specks, hairs and vertical scratches, drawn per cell of a document-
     space grid (the 2 × 2 nearest cells: every element is smaller than half a cell), anti-aliased to the target pixel. "dark" is a print (dust blocks light), "light" a scan
     of a negative (dust shows white). One colour pass. */
  reg({
    id: 'dust-scratches', name: 'Dust and scratches', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      dust: N(0, 100, 50, 1, 'Dust'),
      size: N(0.5, 12, 2.5, 0.1, 'Size', 'px'),
      hairs: N(0, 100, 30, 1, 'Hairs'),
      scratches: N(0, 100, 30, 1, 'Scratches'),
      polarity: CH(opts([['dark', 'Dark (print)'], ['light', 'Light (negative)'], ['mixed', 'Mixed']]), 'mixed', 'Polarity'),
      seed: SEED()
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      g.color(NOISE + [
        'uniform vec4 $a; uniform vec4 $b;',
        'float $h(vec2 c, float k){ return docNoise(c, $b.x + k); }',
        'vec3 $fx(vec3 col){ vec2 P = docPos(); float fw = 1.0 / max(u_scale.x, 1e-4); float S = $a.y; float dk = 0.0, lt = 0.0;',
        '  vec2 C = P / (S * 7.0), ci = floor(C - 0.5);',
        '  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) { vec2 cell = ci + vec2(float(i), float(j));',
        '    if ($h(cell, 1.0) > $a.z * 0.2) continue; vec2 o = (cell + vec2($h(cell, 2.0), $h(cell, 3.0))) * S * 7.0; vec2 d = P - o;',
        '    float ang = atan(d.y, d.x); float hs = $h(cell, 4.0); float r = S * (0.25 + 1.3 * hs * hs) * (1.0 + 0.16 * sin(ang * 3.0 + 6.2831 * $h(cell, 5.0)) + 0.09 * sin(ang * 5.0 + 6.2831 * $h(cell, 8.0)));',
        '    float v = (1.0 - smoothstep(r - fw, r + fw, length(d))) * (0.5 + 0.5 * $h(cell, 6.0));',
        '    if ($b.y > 1.5 ? $h(cell, 7.0) < 0.7 : $b.y < 0.5) dk = max(dk, v); else lt = max(lt, v); }',
        '  vec2 H = P / (S * 40.0), hi = floor(H - 0.5);',
        '  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) { vec2 cell = hi + vec2(float(i), float(j));',
        '    if ($h(cell, 11.0) > $a.w * 0.35) continue; vec2 o = (cell + vec2($h(cell, 12.0), $h(cell, 13.0))) * S * 40.0; float R = S * (6.0 + 12.0 * $h(cell, 14.0));',
        '    vec2 d = P - o; float a0 = 6.2831 * $h(cell, 15.0), span = 1.0 + 2.5 * $h(cell, 16.0); float ang = mod(atan(d.y, d.x) - a0 + 12.566, 6.2831);',
        '    float w = max(S * 0.18, fw * 0.7); float v = (1.0 - smoothstep(w - fw * 0.5, w + fw * 0.5, abs(length(d) - R))) * step(ang, span) * smoothstep(0.0, 0.3, ang) * smoothstep(span, span - 0.3, ang);',
        '    if ($b.y > 0.5 && $b.y < 1.5) lt = max(lt, v * 0.8); else dk = max(dk, v * 0.8); }',
        '  float band = 160.0; float bi = floor(P.x / band + 1e-3);',
        '  for (int i = -1; i <= 1; i++) { float b = bi + float(i); if (docNoise(vec2(b, 7.0), $b.x + 21.0) > $b.z * 0.5) continue;',
        '    float x = (b + docNoise(vec2(b, 8.0), $b.x + 22.0)) * band + (docNoise(vec2(b, 9.0), $b.x + 23.0) - 0.5) * P.y * 0.03;',
        '    float w = max(S * 0.22, fw * 0.6); float fl = smoothstep(0.35, 0.75, $vn(vec2(b * 3.1, P.y / (S * 60.0)), $b.x + 24.0));',
        '    float v = (1.0 - smoothstep(w - fw * 0.5, w + fw * 0.5, abs(P.x - x))) * fl * 0.7; if ($b.y < 0.5) dk = max(dk, v); else lt = max(lt, v); }',
        '  return mix(mix(col, col * 0.08, dk * $a.x), vec3(0.96), lt * $a.x); }'
      ].join('\n'), { a: [p.amount / 100, p.size, p.dust / 100, p.hairs / 100], b: [seedOf(p), p.polarity === 'dark' ? 0 : p.polarity === 'light' ? 1 : 2, p.scratches / 100, 0] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 50, controls: ['amount', 'dust', 'size', 'hairs', 'scratches', 'polarity', 'seed'] },
    agent: {
      summary: 'Procedural dust specks, hairs and vertical scratches of an old print or scanned negative. Seeded; drawn in document space.',
      like: 'dust-and-scratches overlays used for vintage film looks (generated, no stock texture)',
      tips: ['A believable old print: amount 60, dust 40, hairs 20, scratches 25, polarity dark.', 'A dusty negative scan: polarity light, dust 70, scratches 10.', 'Keep size near 2–3 px at screen sizes; it is in document pixels and scales with the export.'],
      example: { type: 'dust-scratches', p: { amount: 60, dust: 45, hairs: 25, scratches: 30, seed: 3 } }
    }
  });

  /* Fade / matte: the output range is remapped per channel from [black colour, whites] — the classic faded-print and matte
     look (lifted, tinted blacks; dimmed whites), with an optional desaturation. Display space. One colour pass. */
  reg({
    id: 'fade', name: 'Fade and matte', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      black: COL('#262220', 'Matte black'),
      whites: N(0.6, 1, 0.93, 0.005, 'Whites'),
      desaturate: N(0, 100, 15, 1, 'Desaturate')
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var b = g.rgb(p.black);
      g.color('uniform vec3 $bk; uniform vec3 $a; vec3 $fx(vec3 c){ vec3 y = $bk + ($a.y - $bk) * c; float l = luma(y); y = mix(y, vec3(l), $a.z); return mix(c, y, $a.x); }',
        { bk: b.slice(0, 3), a: [p.amount / 100, p.whites, p.desaturate / 100] });
    },
    cpu: null,
    support: GPU,
    ui: { section: 'Effects', order: 60, controls: ['amount', 'black', 'whites', 'desaturate'] },
    agent: {
      summary: 'Faded print and matte look: blacks lift to a chosen colour, whites dim, colours soften. A straight remap of the output range, so it stays smooth.',
      like: 'the "fade" slider of photo apps and the output levels of a matte grade',
      tips: ['Classic matte: amount 60–80, matte black #2a2622, whites 0.95.', 'Tint the matte black to tint the shadows: a teal black #1d2a2c gives a cool matte, #2e2318 a warm one.', 'Put it after contrast and curves, before grain.'],
      example: { type: 'fade', p: { amount: 70, black: '#2a2420', whites: 0.95, desaturate: 10 } }
    }
  });

  /* Cross-process: chemistry mismatches expressed as per-channel tone curves (LE.curves, the same spline as the Curves effect),
     mixed in by `amount`. The presets are plain data in LE.fx.creative.crossCurves, so an agent can read them and copy one into
     a Curves entry to edit it further. One colour pass (a 1024-entry lookup). */
  CR.crossCurves = {
    'slide-in-negative': { master: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]], r: [[0, 0], [0.3, 0.26], [0.7, 0.8], [1, 1]], g: [[0, 0.02], [0.5, 0.55], [1, 1]], b: [[0, 0.16], [0.5, 0.42], [1, 0.72]] },
    'negative-in-slide': { master: [[0, 0.04], [0.5, 0.5], [1, 0.94]], r: [[0, 0.02], [0.5, 0.44], [1, 0.9]], g: [[0, 0.06], [0.5, 0.55], [1, 1]], b: [[0, 0.2], [0.5, 0.56], [1, 0.94]] },
    'teal-orange': { master: [[0, 0], [0.25, 0.22], [0.75, 0.79], [1, 1]], r: [[0, 0], [0.35, 0.3], [0.7, 0.76], [1, 1]], g: [[0, 0.02], [0.5, 0.5], [1, 0.97]], b: [[0, 0.1], [0.4, 0.42], [0.75, 0.68], [1, 0.86]] },
    'lomo': { master: [[0, 0], [0.22, 0.14], [0.78, 0.88], [1, 1]], r: [[0, 0], [0.3, 0.24], [0.7, 0.8], [1, 1]], g: [[0, 0], [0.3, 0.25], [0.7, 0.79], [1, 1]], b: [[0, 0.12], [0.5, 0.48], [1, 0.84]] },
    'warm-fade': { master: [[0, 0.07], [0.5, 0.52], [1, 0.95]], r: [[0, 0.04], [0.5, 0.55], [1, 1]], g: [[0, 0.02], [0.5, 0.5], [1, 0.96]], b: [[0, 0.04], [0.5, 0.44], [1, 0.84]] },
    'cool-slide': { master: [[0, 0], [0.25, 0.21], [0.75, 0.81], [1, 1]], r: [[0, 0], [0.5, 0.46], [1, 0.95]], g: [[0, 0.01], [0.5, 0.51], [1, 1]], b: [[0, 0.06], [0.5, 0.56], [1, 1]] },
    'bleach': { master: [[0, 0], [0.2, 0.1], [0.5, 0.52], [0.8, 0.92], [1, 1]] }
  };
  var CROSS_SAT = { 'slide-in-negative': 0.25, 'negative-in-slide': -0.15, 'teal-orange': 0.1, 'lomo': 0.3, 'warm-fade': -0.1, 'cool-slide': 0.05, 'bleach': -0.55 };
  reg({
    id: 'cross-process', name: 'Cross process', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      preset: CH(opts([['slide-in-negative', 'Slide in negative chemistry'], ['negative-in-slide', 'Negative in slide chemistry'], ['teal-orange', 'Teal and orange'], ['lomo', 'Toy camera'], ['warm-fade', 'Warm fade'], ['cool-slide', 'Cool slide'], ['bleach', 'Bleach bypass']]), 'slide-in-negative', 'Process')
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var cv = CR.crossCurves[p.preset] || CR.crossCurves['slide-in-negative'], id = [[0, 0], [1, 1]];
      var t = g.lut1d(M.curveTable({ master: cv.master || id, r: cv.r || id, g: cv.g || id, b: cv.b || id }, 1024), 3);
      g.color('uniform sampler2D $t; uniform vec2 $a; vec3 $fx(vec3 c){ vec3 y = lut1rgb($t, c); float l = luma(y); y = l + (y - l) * (1.0 + $a.y); return mix(c, y, $a.x); }', { t: t, a: [p.amount / 100, CROSS_SAT[p.preset] || 0] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 70, controls: ['preset', 'amount'] },
    agent: {
      summary: 'Cross-processing and related chemistry looks as per-channel tone curves (shadows, mid-tones and highlights pushed to different hues), with the matching saturation change.',
      like: 'cross-process presets of photo apps; the curves are in LE.fx.creative.crossCurves and can be copied into a Curves entry',
      tips: ['slide-in-negative: punchy, yellow-green highlights and blue shadows (the classic). negative-in-slide: flat, cyan-tinted.', 'bleach: high contrast, low saturation (bleach-bypass print).', 'amount 40–70 keeps skin believable; 100 is the full chemistry.'],
      example: { type: 'cross-process', p: { preset: 'slide-in-negative', amount: 70 } }
    }
  });

  /* =====================================================================================================================
     Optics: chromatic aberration, vignette, lens distortion, anamorphic streaks, lens flare
     ===================================================================================================================== */

  /* Distance from `center` (box fractions) to the farthest corner, in document pixels: the radius every radial optic is
     normalised to, so 100 % means "at the corner". */
  function farCorner(box, c) { return Math.sqrt(Math.pow(Math.max(c.x, 1 - c.x) * box.w, 2) + Math.pow(Math.max(c.y, 1 - c.y) * box.h, 2)) || 1; }
  /* radius(p, scale, box) is told the layer box; this one stands in where a caller gives none. */
  var REACH_BOX = { w: 3000, h: 2000 };

  /* Chromatic aberration (lateral/transverse): the red and blue images are magnified about the optical centre relative to
     green, by k·(r/R)^(falloff−1) (R = distance to the far corner), plus an optional prism-like linear shift. Each channel is
     integrated over a short stretch of its displacement (5 taps, 1 while dragging) so the fringe is a smooth spectrum, not
     three ghost images. Negative values move the channels the other way, which removes a lens's own fringing. One pass. */
  CR.caDisplacement = function (r, R, k, falloff) { return r * k * Math.pow(Math.max(r / R, 1e-4), falloff - 1); };
  var CA = 'uniform vec4 u_k; uniform vec2 u_c; uniform vec2 u_shift; uniform int u_taps;\n' +
    'vec4 fx(){ vec2 P = docPos(), d = P - u_c; float rr = length(d) / u_k.z; float f = pow(max(rr, 1e-4), u_k.w - 1.0);\n' +
    '  vec2 dR = d * u_k.x * f, dB = d * u_k.y * f; vec4 g = src(v_uv); float r = 0.0, b = 0.0;\n' +
    '  for (int i = 0; i < 5; i++) { if (i >= u_taps) break; float t = u_taps > 1 ? 0.6 + 0.2 * float(i) : 1.0;\n' +
    '    r += texture(u_src, v_uv + docToUV(-dR * t - u_shift * t)).r; b += texture(u_src, v_uv + docToUV(-dB * t + u_shift * t)).b; }\n' +
    '  return vec4(r / float(u_taps), g.g, b / float(u_taps), g.a); }';
  reg({
    id: 'chromatic-aberration', name: 'Chromatic aberration', group: 'optics', version: 1, space: 'linear',
    params: {
      redCyan: N(-100, 100, 0, 1, 'Red / cyan fringe'),
      blueYellow: N(-100, 100, 0, 1, 'Blue / yellow fringe'),
      falloff: N(1, 4, 2, 0.05, 'Falloff', null, 'How fast the fringe grows towards the corners (1 even, 2 like a real lens).'),
      shift: N(-40, 40, 0, 0.1, 'Shift', 'px', 'An even sideways split of red and blue (a prism or a misaligned scanner).'),
      angle: ANG(0, 'Shift angle'),
      center: PT(0.5, 0.5, 'Optical centre')
    },
    radius: function (p, scale, box) {
      if (!p.redCyan && !p.blueYellow && !p.shift) return 0;
      var R = farCorner(box && box.w ? box : REACH_BOX, p.center), k = Math.max(Math.abs(p.redCyan), Math.abs(p.blueYellow)) / 100 * 0.012;
      return Math.ceil((k * 1.4 * R * Math.pow(1.5, p.falloff - 1) + Math.abs(p.shift) * 1.4) * scale) + 2;
    },
    passes: function (g, p) {
      if (!p.redCyan && !p.blueYellow && !p.shift) return;
      var C = [p.center.x * g.box.w, p.center.y * g.box.h], R = farCorner(g.box, p.center), a = p.angle * Math.PI / 180;
      return g.pass(CA, { u_k: [p.redCyan / 100 * 0.012, p.blueYellow / 100 * 0.012, R, p.falloff], u_c: C, u_shift: [Math.cos(a) * p.shift, -Math.sin(a) * p.shift], u_taps: g.draft ? 1 : 5 });
    },
    support: GPU,
    ui: { section: 'Optics', order: 30, controls: ['redCyan', 'blueYellow', 'falloff', { heading: 'Shift' }, 'shift', 'angle', 'center'] },
    agent: {
      summary: 'Lateral chromatic aberration: red and blue are magnified slightly differently from green about the optical centre, so colour fringes grow towards the corners. Positive adds fringing; negative values correct a lens that has it.',
      like: 'the chromatic aberration sliders of lens-correction panels, used in both directions',
      tips: ['Creative lens character: redCyan 20–40, blueYellow −10 to −20.', 'To correct a real lens, look at a corner with a dark-light edge and move redCyan until the red/cyan edge disappears, then blueYellow.', 'shift with an angle gives the even RGB split of a cheap scanner; glitch has a stronger version.', 'It does not remove purple fringing around blown highlights (axial aberration); that needs a defringe tool.'],
      example: { type: 'chromatic-aberration', p: { redCyan: 35, blueYellow: -15 } }
    }
  });

  /* Vignette. Shape (shared with the CPU reference CR.vignetteShape): q = 2·(box uv − centre), so a centred frame's corners are
     at (±1, ±1); roundness > 0 blends towards a true circle in pixels, < 0 towards a rounded rectangle (superellipse, exponent
     2…8), with the corner distance kept at √2. midpoint sets the radius r0 = 0.25 + midpoint/100 and feather the half width
     w = 0.05 + 0.75·feather/100 of a smoothstep. Styles: highlight priority (an exposure change in linear light, up to ±2 EV,
     with highlight protection), colour priority (a lightness change in display values that keeps hue and saturation), paint
     overlay (a mix towards a colour in display values). One colour pass. */
  CR.vignetteShape = function (bx, by, p, aspect) {
    var qx = (bx - p.center.x) * 2, qy = (by - p.center.y) * 2, rnd = p.roundness / 100, d;
    if (rnd >= 0) { var nrm = Math.sqrt((aspect * aspect + 1) / 2), cx = qx * aspect / nrm, cy = qy / nrm; d = Math.hypot(qx + (cx - qx) * rnd, qy + (cy - qy) * rnd); }
    else { var n = 2 - rnd * 6; d = Math.pow(Math.pow(Math.abs(qx), n) + Math.pow(Math.abs(qy), n), 1 / n) * Math.pow(2, 0.5 - 1 / n); }
    var r0 = 0.25 + p.midpoint / 100, w = 0.05 + 0.75 * p.feather / 100;
    return smoothstepJS(r0 - w, r0 + w, d);
  };
  reg({
    id: 'vignette', name: 'Vignette', group: 'optics', version: 1, space: 'linear',
    params: {
      amount: N(-100, 100, 0, 1, 'Amount'),
      style: CH(opts([['highlight', 'Highlight priority'], ['color', 'Colour priority'], ['paint', 'Paint overlay']]), 'highlight', 'Style'),
      midpoint: N(0, 100, 50, 1, 'Midpoint'),
      roundness: N(-100, 100, 0, 1, 'Roundness'),
      feather: N(0, 100, 50, 1, 'Feather'),
      highlights: N(0, 100, 0, 1, 'Highlights', null, 'Highlight priority only: keeps bright parts bright inside a darkening vignette.'),
      color: COL('#000000', 'Colour'),
      center: PT(0.5, 0.5, 'Centre')
    },
    passes: function (g, p) {
      if (!p.amount) return;
      var st = p.style === 'color' ? 1 : p.style === 'paint' ? 2 : 0, c = M.parseColor(p.color) || [0, 0, 0, 1];
      g.color([
        'uniform vec4 $a; uniform vec4 $b; uniform vec3 $col;',
        'vec3 $fx(vec3 c){ vec2 q = (boxUV() - $b.xy) * 2.0; float rnd = $a.y; float d;',
        '  if (rnd >= 0.0) { float asp = u_box.x / u_box.y; vec2 pc = q * vec2(asp, 1.0) / sqrt((asp * asp + 1.0) * 0.5); d = length(mix(q, pc, rnd)); }',
        '  else { float n = 2.0 - rnd * 6.0; d = pow(pow(abs(q.x), n) + pow(abs(q.y), n), 1.0 / n) * pow(2.0, 0.5 - 1.0 / n); }',
        '  float v = smoothstep($a.z - $a.w, $a.z + $a.w, d); float a = $a.x;',
        '  if ($b.z < 0.5) { vec3 o = c * exp2(a * v * 2.0); if (a < 0.0) { float yd = toDisplay(vec3(luma(max(c, 0.0)))).r; o = mix(o, c, $b.w * smoothstep(0.55, 1.0, yd) * v); } return o; }',
        '  vec3 d0 = toDisplay(c);',
        '  if ($b.z < 1.5) return toLinear(a < 0.0 ? d0 * (1.0 + a * v) : d0 + (1.0 - clamp(d0, 0.0, 1.0)) * a * v);',
        '  return toLinear(mix(d0, a < 0.0 ? $col : vec3(1.0), abs(a) * v)); }'
      ].join('\n'), { a: [p.amount / 100, p.roundness / 100, 0.25 + p.midpoint / 100, 0.05 + 0.75 * p.feather / 100], b: [p.center.x, p.center.y, st, p.highlights / 100], col: c.slice(0, 3) });
    },
    support: GPU,
    ui: { section: 'Optics', order: 40, controls: ['amount', 'style', 'midpoint', 'roundness', 'feather', { param: 'highlights', when: { style: 'highlight' } }, { param: 'color', when: { style: 'paint' } }, 'center'] },
    agent: {
      summary: 'Darkens (negative) or lightens (positive) the edges of the frame around a movable centre, in three styles: highlight priority (an exposure change that can protect highlights), colour priority (keeps hues) and paint overlay (blends to a colour).',
      like: 'the post-crop vignette of raw developers, with the same controls',
      tips: ['A natural portrait vignette: amount −20 to −30, midpoint 40, feather 70, highlight priority.', 'Move centre onto the subject in an off-centre composition.', 'Paint overlay with a dark brown colour gives an old-print edge burn; positive amounts give a white "dreamy" edge.', 'Put it after geometry effects (lens distortion) and before grain.'],
      example: { type: 'vignette', p: { amount: -25, midpoint: 45, feather: 65, style: 'highlight' } }
    }
  });

  /* Lens distortion: the one-term Brown–Conrady radial model. An output point at normalised radius ru (radius / distance from the
     centre to the far corner) samples the source at rs = s·ru·(1 + k·(s·ru)²), k = −amount/100 · 0.3 (positive amount: barrel,
     the picture bulges; negative: pincushion). |k| ≤ 0.3 keeps the map monotonic to the corner. With auto scale, pincushion is
     zoomed by s (s·(1 + k s²) = 1) so no empty corners appear. One pass. */
  CR.distortScale = function (k) { if (k <= 0) return 1; var s = 1; for (var i = 0; i < 60; i++) s = 1 / (1 + k * s * s); return s; };
  CR.distortSource = function (ru, k, s) { var r = s * ru; return r * (1 + k * r * r); };
  function distortMax(k, s) { var m = 0; for (var i = 1; i <= 32; i++) { var ru = i / 32; m = Math.max(m, Math.abs(CR.distortSource(ru, k, s) - ru)); } return m; }
  var DISTORT = 'uniform vec4 u_d; uniform float u_edge, u_kk;\nvec4 fx(){ vec2 P = docPos(), d = P - u_d.xy; float r = u_d.w * length(d) / u_d.z; vec2 S = u_d.xy + d * (u_d.w * (1.0 + u_kk * r * r)); vec2 uv = v_uv + docToUV(S - P); vec4 c = texture(u_src, uv); return u_edge > 0.5 ? c * insideImg(uv) : c; }';
  reg({
    id: 'lens-distortion', name: 'Lens distortion', group: 'optics', version: 1, space: 'linear',
    params: {
      amount: N(-100, 100, 0, 1, 'Distortion', null, 'Positive bulges the picture (barrel); negative pinches it (pincushion). Use the opposite sign to correct a lens.'),
      autoScale: BOOL(true, 'Auto scale'),
      edges: CH(opts([['transparent', 'Transparent'], ['extend', 'Extend']]), 'transparent', 'Edges'),
      center: PT(0.5, 0.5, 'Centre')
    },
    radius: function (p, scale, box) { if (!p.amount) return 0; var k = -p.amount / 100 * 0.3, s = p.autoScale ? CR.distortScale(k) : 1; return Math.ceil(distortMax(k, s) * farCorner(box && box.w ? box : REACH_BOX, p.center) * scale) + 2; },
    passes: function (g, p) {
      if (!p.amount) return;
      var k = -p.amount / 100 * 0.3, s = p.autoScale ? CR.distortScale(k) : 1;
      return g.pass(DISTORT, { u_d: [p.center.x * g.box.w, p.center.y * g.box.h, farCorner(g.box, p.center), s], u_kk: k, u_edge: p.edges === 'transparent' ? 1 : 0 });
    },
    support: GPU,
    ui: { section: 'Optics', order: 20, controls: ['amount', 'autoScale', 'edges', 'center'] },
    agent: {
      summary: 'Barrel and pincushion distortion with the standard radial lens model about a movable centre: creative (bulge, pinch) or corrective (straighten a wide-angle or telephoto lens).',
      like: 'the distortion slider of lens-correction panels',
      tips: ['To correct barrel distortion from a wide lens use a negative amount (about −5 to −20) until lines near the edges are straight.', 'A creative bulge: amount 60–100.', 'autoScale keeps the frame full for pincushion; with barrel the content shrinks inside the frame and the corners stay filled.'],
      example: { type: 'lens-distortion', p: { amount: 40 } }
    }
  });

  /* Anamorphic streaks: horizontal (or angled) flares from highlights, as a cylindrical anamorphic lens draws them. Knee
     threshold at half resolution, a decaying comb blur along the angle (2–3 passes), tinted and added in linear light.
     Passes: 1 + 2–3 + 1. */
  reg({
    id: 'anamorphic-streaks', name: 'Anamorphic streaks', group: 'optics', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      threshold: N(0, 1, 0.85, 0.01, 'Threshold'),
      length: N(20, 3000, 500, 1, 'Length', 'px'),
      color: COL('#4f86ff', 'Tint'),
      angle: ANG(0, 'Angle')
    },
    radius: function (p, scale) { return p.amount > 0 ? Math.ceil(p.length * 0.55 * scale) + 8 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var th = lin(p.threshold), a = p.angle * Math.PI / 180;
      var pre = g.pass(PREFILTER, { u_th: [th, Math.max(th * 0.3, 0.01)] }, { scale: 0.5 });
      var st = comb(g, pre, [Math.cos(a), -Math.sin(a)], p.length, 4, 0.5);
      if (st !== pre) g.release(pre);
      var t = g.rgb(p.color), k = p.amount / 100 * 2.5;
      return g.pass(ADDGLOW, { u_glow: st, u_t: [t[0] * k, t[1] * k, t[2] * k] });
    },
    support: GPU_MID,
    ui: { section: 'Optics', order: 60, controls: ['amount', 'threshold', 'length', 'color', 'angle'] },
    agent: {
      summary: 'Long horizontal light streaks through bright points, the signature flare of anamorphic cinema lenses. Tinted (blue by default) and added in linear light.',
      like: 'anamorphic streak and lens-streak plug-ins of compositing tools',
      tips: ['Works on night scenes, headlights, specular highlights; threshold 0.7–0.85 so only real lights streak.', 'length is in document pixels: about the frame width for a cinematic look.', 'Combine with lens-flare and a gentle vignette for a film-like frame.'],
      example: { type: 'anamorphic-streaks', p: { amount: 45, threshold: 0.75, length: 900 } }
    }
  });

  /* Lens flare: procedural elements placed along the axis from the light point through the frame centre (where internal
     reflections land): polygonal ghosts with a bright rim and chromatic edges, a halo ring around the light, a starburst of
     seeded rays, a horizontal streak and a core glow. Positions are in units of the short side so shapes stay round. One colour
     pass, added in linear light; the ghost table is drawn from the seed on the CPU (CR.flareGhosts). */
  function lcg(seed) { var s = (seed * 2654435761 + 1013904223) >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function hue(h) { var r = Math.abs(h * 6 - 3) - 1, g = 2 - Math.abs(h * 6 - 2), b = 2 - Math.abs(h * 6 - 4); return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)]; }
  CR.flareGhosts = function (seed) {
    var r = lcg(seed || 1), out = [];
    for (var i = 0; i < 8; i++) {
      var k = 0.35 + r() * 1.9, rad = 0.012 + Math.pow(r(), 2) * 0.11, inten = 0.25 + r() * 0.75, hh = [0.08, 0.12, 0.3, 0.45, 0.55, 0.62, 0.8][Math.floor(r() * 7)];
      out.push({ k: k, r: rad, i: inten, c: hue(hh).map(function (v) { return 0.45 + 0.55 * v; }) });
    }
    return out;
  };
  reg({
    id: 'lens-flare', name: 'Lens flare', group: 'optics', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      position: PT(0.25, 0.22, 'Light position'),
      size: N(0.2, 3, 1, 0.01, 'Size'),
      ghosts: N(0, 100, 60, 1, 'Ghosts'),
      halo: N(0, 100, 35, 1, 'Halo'),
      starburst: N(0, 100, 40, 1, 'Starburst'),
      streak: N(0, 100, 20, 1, 'Streak'),
      blades: N(5, 9, 6, 1, 'Aperture blades'),
      dispersion: N(0, 100, 40, 1, 'Dispersion', null, 'Colour fringing of the ghosts and halo.'),
      color: COL('#ffe2b8', 'Tint'),
      seed: SEED()
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var gh = CR.flareGhosts(seedOf(p)), G = new Float32Array(32), C = new Float32Array(24), sh = Math.min(g.box.w, g.box.h);
      gh.forEach(function (o, i) { G.set([o.k, o.r * p.size, o.i, 0], i * 4); C.set(o.c, i * 3); });
      g.color(NOISE + [
        'uniform vec4 $g[8]; uniform vec3 $gc[8]; uniform vec4 $a; uniform vec4 $b; uniform vec4 $l; uniform vec3 $t; uniform float $amt;',
        'float $poly(vec2 q, float n){ float s = 6.2831853 / n; float a = atan(q.y, q.x) + 0.3; return length(q) * cos(mod(a + 0.5 * s, s) - 0.5 * s) / cos(0.5 * s); }',
        'float $ghost(float d){ return (1.0 - smoothstep(0.86, 1.0, d)) * (0.3 + 0.7 * smoothstep(0.55, 0.97, d)); }',
        'vec3 $fx(vec3 c){ vec2 P = $asp(), L = $l.xy, C = $l.zw, v = C - L; float sz = $a.y; vec3 acc = vec3(0.0); float disp = $b.y * 0.06;',
        '  for (int i = 0; i < 8; i++) { vec4 g = $g[i]; vec2 q = (P - (L + v * g.x)) / g.y;',
        '    vec3 e = vec3($ghost($poly(q * (1.0 + disp), $b.x)), $ghost($poly(q, $b.x)), $ghost($poly(q * (1.0 - disp), $b.x)));',
        '    acc += e * $gc[i] * g.z * 0.35 * $a.z; }',
        '  vec2 d = P - L; float r = length(d); float hr = 0.42 * sz; vec3 rr = vec3(hr * (1.0 + disp), hr, hr * (1.0 - disp));',
        '  acc += exp(-pow((vec3(r) - rr) / (0.02 * sz), vec3(2.0))) * 0.12 * $a.w;',
        '  float th = atan(d.y, d.x); float rays = pow(abs(cos(th * $b.x * 0.5 + 0.3)), 24.0) * 0.6 + pow($vn(vec2(th * 18.0, 0.5), $b.z), 6.0) * 1.4;',
        '  acc += vec3(rays * exp(-r / (0.22 * sz)) * 0.9 * $b.w);',
        '  acc += vec3(0.6, 0.8, 1.2) * exp(-abs(d.y) / (0.0035 * sz)) * exp(-abs(d.x) / (0.7 * sz)) * 0.6 * $a.x;',
        '  acc += vec3(exp(-r * r / (0.0004 * sz * sz)) * 2.0 + 0.12 / (1.0 + r * r / (0.0016 * sz * sz)));',
        '  return c + acc * $t * $amt; }'
      ].join('\n'), { g: G, gc: C, a: [p.streak / 100, p.size, p.ghosts / 100, p.halo / 100], b: [p.blades, p.dispersion / 100, seedOf(p), p.starburst / 100],
        l: [p.position.x * g.box.w / sh, p.position.y * g.box.h / sh, 0.5 * g.box.w / sh, 0.5 * g.box.h / sh], t: g.rgb(p.color).slice(0, 3), amt: p.amount / 100 * 1.5 });
    },
    support: GPU,
    ui: { section: 'Optics', order: 70, controls: ['amount', 'position', 'size', { heading: 'Elements' }, 'ghosts', 'halo', 'starburst', 'streak', 'blades', 'dispersion', 'color', 'seed'] },
    agent: {
      summary: 'A procedural lens flare from a positionable light: ghosts along the axis through the frame centre, a halo, a starburst, a streak and a glowing core. Seeded, so the same settings always give the same flare.',
      like: 'lens flare filters of photo editors and flare plug-ins of compositing tools',
      tips: ['Put position on the real light source (the sun, a lamp); the ghosts then fall on the opposite side of the centre like a real lens.', 'Tasteful: amount 30–50, ghosts 40–60, starburst 30. Keep size near 1 for a 35 mm look.', 'Change seed to rearrange the ghosts; blades sets the ghost polygon and the number of rays.'],
      example: { type: 'lens-flare', p: { amount: 45, position: { x: 0.22, y: 0.2 }, ghosts: 55, starburst: 35, seed: 2 } }
    }
  });

  /* =====================================================================================================================
     2. Blur gallery
     ===================================================================================================================== */

  /* Lens blur: a gather over a shaped aperture (polygon of `blades` sides, curved back towards a circle, rotated; a cat's-eye
     clip that grows towards the corners), after a highlight boost that opens bright points into discs. The gather runs at the
     pyramid level where the radius is at most 10 pixels, with 127 taps (37 while dragging), and is tent-upsampled.
     Passes: [boost] + L down + 1 gather + [1 up]. */
  var BOKEH_PARAMS = function (extra) {
    var o = {};
    Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    o.blades = N(3, 10, 6, 1, 'Blades');
    o.curvature = N(0, 100, 50, 1, 'Blade curvature', null, '100 is a round aperture.');
    o.rotation = ANG(0, 'Rotation');
    o.highlights = N(0, 100, 0, 1, 'Specular highlights', null, 'Brightens highlights before blurring so they open into bright discs.');
    o.threshold = N(0, 1, 0.85, 0.01, 'Highlight threshold');
    return o;
  };
  function bokehBase(g, p) { var hb = boostOf(p); return hb ? g.pass(BOOST, { u_hb: hb }) : g.source; }
  function kernOf(g, p, px) { return bokehKernel(ringsFor(g.draft, px), p.blades, (p.curvature == null ? 100 : p.curvature) / 100, p.rotation || 0); }
  function lensReach(R, scale, most) { var Rt = R * scale, L = levelFor(Rt, most || 10, 6); return Rt > 0.3 ? Math.ceil(Rt + 3 * (1 << L) + 4) : 0; }
  reg({
    id: 'lens-blur', name: 'Lens blur', group: 'blur', version: 1, space: 'linear',
    params: BOKEH_PARAMS({ radius: N(0, 150, 0, 0.1, 'Radius', 'px'), catsEye: N(0, 100, 0, 1, 'Cat\'s eye', null, 'Clips the aperture towards the corners, as a fast lens does wide open.') }),
    radius: function (p, scale) { return lensReach(p.radius, scale); },
    passes: function (g, p) {
      var Rt = p.radius * g.scale;
      if (!(Rt > 0.3)) return;
      var base = bokehBase(g, p), L = levelFor(Rt, 10, 6), lv = pyramid(g, base, L);
      var k = kernOf(g, p, Rt / (1 << L));
      var out = g.pass(GATHER, { u_src: L ? lv[L - 1] : base, u_k: k.data, u_n: k.n, u_r: p.radius, u_cat: p.catsEye / 100 * 0.6 }, { scale: 1 / (1 << L) });
      freePyramid(g, lv);
      if (!L) return out;
      var up = g.upsample(out, 1); g.release(out);
      return up;
    },
    support: GPU_MID,
    ui: { section: 'Optics', order: 80, controls: ['radius', { heading: 'Iris' }, 'blades', 'curvature', 'rotation', 'catsEye', { heading: 'Highlights' }, 'highlights', 'threshold'] },
    agent: {
      summary: 'A blur that looks like an out-of-focus lens: bright points become discs or polygons shaped by the aperture blades, unlike a Gaussian blur. Use it with a mask (or depth-blur) to separate a subject.',
      like: 'the lens blur filter of photo editors (iris shape, blade curvature, rotation, specular highlights)',
      tips: ['Background separation: lens-blur radius 12–25 with an inverted subject mask on the entry.', 'Night bokeh: specular highlights 40–70, threshold 0.75; 6–8 blades, curvature 30 for a vintage polygon, 100 for a modern round aperture.', 'radius is in document pixels; while dragging it uses fewer taps.'],
      example: { type: 'lens-blur', p: { radius: 14, blades: 7, curvature: 40, highlights: 40, threshold: 0.8 } }
    }
  });

  /* Depth blur (depth of field from layer.maps.depth). Per-pixel circle of confusion: c = R·clamp((|d − focus| − range/2)/0.35, 0, 1),
     scaled by `near` in front of the focus plane; d = 0 is nearest. Scatter-as-gather at the pyramid level of R: every tap is a
     neighbour whose own disc may reach this pixel (coverage of its circle of confusion at the tap distance, weighted by 1/area so
     its energy is kept); a neighbour behind this pixel may spread over it only as far as this pixel's own circle (so a blurred
     background does not bleed over a sharp subject). A second gather measures how far blurred foreground covers this pixel, and
     the full-resolution composite shows the blur where either is large, so out-of-focus foreground spills over a sharp
     background. Limits (a single image, no hidden layers): what is behind a blurred foreground edge is not known, so such
     edges are partly transparent over the sharp background instead of revealing it; a soft or misaligned depth map gives halos at
     depth edges. Passes: 2 depth (mask) + 1 CoC + [boost] + 2L down + 2 gathers + 1 composite. */
  var COC = DEPTH_GLSL + 'uniform sampler2D u_dmap, u_miss; uniform vec4 u_f;\nvec4 fx(){ float d = depthAt(u_dmap, v_uv); float miss = texture(u_miss, clamp(v_uv, u_img.xy + 0.5 * u_texel, u_img.zw - 0.5 * u_texel)).r; float c = clamp((abs(d - u_f.x) - u_f.y) / 0.35, 0.0, 1.0); if (d < u_f.x) c *= u_f.w; c *= 1.0 - step(0.5, miss); return vec4(c, d, 0.0, 1.0); }';
  var DGATHER = 'uniform sampler2D u_aux; uniform vec2 u_k[' + MAXK + ']; uniform float u_kr[' + MAXK + ']; uniform int u_n; uniform float u_r, u_tx;\n' +
    'vec4 fx(){ vec4 a0 = texture(u_aux, v_uv); float cc = a0.r * u_r, dc = a0.g, t2 = u_tx * u_tx; float w0 = 1.0 / max(cc * cc / t2, 1.0); vec4 acc = texture(u_src, v_uv) * w0; float ws = w0;\n' +
    '  for (int i = 1; i < ' + MAXK + '; i++) { if (i >= u_n) break; float lo = u_kr[i] * u_r; vec2 uv = v_uv + docToUV(u_k[i] * u_r); vec4 a = texture(u_aux, uv); float cs = a.r * u_r;\n' +
    '    float reach = a.g > dc + 0.02 ? min(cs, cc) : cs; float w = clamp((reach - lo) / u_tx + 0.5, 0.0, 1.0) / max(cs * cs / t2, 1.0); acc += texture(u_src, uv) * w; ws += w; }\n' +
    '  return acc / ws; }';
  var DCOVER = 'uniform sampler2D u_aux; uniform vec2 u_k[' + MAXK + ']; uniform float u_kr[' + MAXK + ']; uniform int u_n; uniform float u_r, u_tx;\n' +
    'vec4 fx(){ vec4 a0 = texture(u_aux, v_uv); float dc = a0.g, cov = 0.0;\n' +
    '  for (int i = 1; i < ' + MAXK + '; i++) { if (i >= u_n) break; float lo = u_kr[i] * u_r; vec4 a = texture(u_aux, v_uv + docToUV(u_k[i] * u_r)); if (a.g < dc - 0.02) cov = max(cov, clamp((a.r * u_r - lo) / u_tx + 0.5, 0.0, 1.0) * smoothstep(0.5, 2.0, a.r * u_r / u_tx)); }\n' +
    '  return vec4(cov); }';
  var DCOMP = TENT + 'uniform sampler2D u_blur, u_aux, u_cov; uniform vec2 u_q;\nvec4 fx(){ vec4 s = src(v_uv); float c = texture(u_aux, v_uv).r * u_q.x; float t = max(smoothstep(0.35, max(u_q.y, 0.5) * 1.5, c), tent(u_cov, v_uv).r); return mix(s, tent(u_blur, v_uv), t); }';
  /* The kernel's ring radius per tap (before the polygon mapping), for the coverage test. */
  function kernRadii(k) { if (k.radii) return k.radii; var r = new Float32Array(k.n); for (var i = 0; i < k.n; i++) r[i] = Math.hypot(k.data[i * 2], k.data[i * 2 + 1]); return (k.radii = r); }
  reg({
    id: 'depth-blur', name: 'Depth blur', group: 'blur', version: 1, space: 'linear', needs: ['depth'],
    params: BOKEH_PARAMS({
      radius: N(0, 100, 0, 0.1, 'Blur', 'px', 'Largest blur, for the parts farthest from the focus plane.'),
      focus: N(0, 1, 0.2, 0.005, 'Focal distance', null, '0 is the nearest point of the depth map, 1 the farthest.'),
      range: N(0, 1, 0.1, 0.005, 'Depth of field', null, 'Depth range around the focal distance that stays sharp.'),
      near: N(0, 100, 100, 1, 'Foreground blur', null, 'How much the parts in front of the focus plane blur.')
    }),
    radius: function (p, scale) { return lensReach(p.radius, scale); },
    passes: function (g, p) {
      var Rt = p.radius * g.scale;
      if (!(Rt > 0.3)) return;
      var src = g.source, dm = g.mask(DEPTH_DEF), miss = g.mask(DEPTH_MISSING);
      var aux = g.pass(COC, { u_src: src, u_dmap: dm, u_miss: miss, u_f: [p.focus, p.range / 2, 0, p.near / 100] });
      g.release(dm); g.release(miss);
      var L = levelFor(Rt, 10, 6), base = bokehBase(g, p), lv = pyramid(g, base, L), la = L ? g.downsample(aux, L) : [];
      var k = kernOf(g, p, Rt / (1 << L)), kr = kernRadii(k), tx = (1 << L) / g.scale;
      var cAux = L ? la[L - 1] : aux, u = { u_aux: cAux, u_k: k.data, u_kr: kr, u_n: k.n, u_r: p.radius, u_tx: tx };
      var blur = g.pass(DGATHER, Object.assign({ u_src: L ? lv[L - 1] : base }, u), { scale: 1 / (1 << L) });
      var cov = g.pass(DCOVER, Object.assign({ u_src: cAux }, u), { scale: 1 / (1 << L) });
      freePyramid(g, lv); la.forEach(function (h) { g.release(h); });
      var out = g.pass(DCOMP, { u_src: src, u_blur: blur, u_aux: aux, u_cov: cov, u_q: [p.radius, tx] });
      g.release(blur); g.release(cov); g.release(aux);
      return out;
    },
    support: GPU_BIG,
    ui: { section: 'Optics', order: 82, controls: ['radius', 'focus', 'range', 'near', { heading: 'Iris' }, 'blades', 'curvature', 'rotation', { heading: 'Highlights' }, 'highlights', 'threshold'] },
    agent: {
      summary: 'Depth of field from the layer\'s depth map (layer.maps.depth): parts away from the focal distance blur with lens-shaped bokeh, nearer parts spill over the sharp subject, background never bleeds onto it.',
      like: 'the depth-map lens blur and "portrait mode" depth effects of photo editors',
      tips: ['Needs layer.maps.depth (map.generate depth); without a map it does nothing and LE.fx.problems reports nothing for it, so check the layer has maps.depth first.', 'focus is depth (0 = nearest). For a portrait: focus near the subject depth (often 0.1–0.3), range 0.05–0.15, radius 10–25.', 'A soft-edged depth map gives halos at the subject edge: combine with a subject mask on a second, plain lens-blur entry for hair-level edges.', 'Foreground blur 0 keeps everything in front of the focus plane sharp.'],
      example: { type: 'depth-blur', p: { radius: 18, focus: 0.15, range: 0.1, highlights: 30 } }
    }
  });

  /* Field blurs (tilt-shift, iris): a lens-blur pyramid at R/4, R/2 and R (each gathered at its own level, circular aperture)
     blended per pixel by a position function t (0 sharp … 1 full blur), so the blur grows smoothly with distance from the focus
     area, as a tilted lens or a wide aperture's field curvature would. Passes: [boost] + L down + 3 gathers + 1 composite. */
  var FIELD = TENT + 'uniform sampler2D u_b1, u_b2, u_b3; uniform vec4 u_tf; uniform vec4 u_tw;\nFIELD_T\nvec4 fx(){ float t = clamp(fieldT(), 0.0, 1.0) * 3.0; vec4 s0 = src(v_uv), s1 = tent(u_b1, v_uv), s2 = tent(u_b2, v_uv), s3 = tent(u_b3, v_uv); return t < 1.0 ? mix(s0, s1, t) : t < 2.0 ? mix(s1, s2, t - 1.0) : mix(s2, s3, t - 2.0); }';
  var T_TILT = 'float fieldT(){ vec2 d = docPos() - u_tf.xy; vec2 n = vec2(sin(u_tf.z), cos(u_tf.z)); float dist = abs(dot(d, n)) / u_tf.w; return smoothstep(u_tw.x, u_tw.x + max(u_tw.y, 1e-3), dist); }';
  var T_IRIS = 'float fieldT(){ vec2 d = docPos() - u_tf.xy; float c = cos(u_tf.z), s = sin(u_tf.z); vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / max(u_tw.xy, vec2(1e-3)); return smoothstep(1.0 - u_tw.z, 1.0, length(q)); }';
  CR.tiltT = function (dx, dy, angleDeg, short, focus, transition) { var a = angleDeg * Math.PI / 180, dist = Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) / short; return smoothstepJS(focus, focus + Math.max(transition, 1e-3), dist); };
  function fieldBlur(g, p, tfun, tf, tw) {
    var R = p.blur, Rt = R * g.scale;
    if (!(Rt > 0.3)) return;
    var base = bokehBase(g, p), radii = [R / 4, R / 2, R], Ls = radii.map(function (r) { return levelFor(r * g.scale, 6, 6); });
    var lv = pyramid(g, base, Ls[2]);
    var B = radii.map(function (r, i) { var k = bokehKernel(ringsFor(g.draft, r * g.scale / (1 << Ls[i])), 0, 1, 0); return g.pass(GATHER, { u_src: Ls[i] ? lv[Ls[i] - 1] : base, u_k: k.data, u_n: k.n, u_r: r, u_cat: 0 }, { scale: 1 / (1 << Ls[i]) }); });
    freePyramid(g, lv);
    var out = g.pass(FIELD.replace('FIELD_T', tfun), { u_b1: B[0], u_b2: B[1], u_b3: B[2], u_tf: tf, u_tw: tw });
    B.forEach(function (h) { g.release(h); });
    return out;
  }
  var FIELD_PARAMS = function (extra) {
    var o = { blur: N(0, 100, 0, 0.1, 'Blur', 'px') };
    Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    o.highlights = N(0, 100, 0, 1, 'Specular highlights'); o.threshold = N(0, 1, 0.85, 0.01, 'Highlight threshold');
    return o;
  };
  reg({
    id: 'tilt-shift', name: 'Tilt-shift blur', group: 'blur', version: 1, space: 'linear',
    params: FIELD_PARAMS({ center: PT(0.5, 0.55, 'Centre'), angle: ANG(0, 'Angle'), focus: N(0, 1, 0.1, 0.005, 'Focus band', null, 'Half the height of the sharp band, as a fraction of the short side.'), transition: N(0, 1, 0.25, 0.005, 'Transition') }),
    radius: function (p, scale) { return lensReach(p.blur, scale, 6); },
    passes: function (g, p) {
      return fieldBlur(g, p, T_TILT, [p.center.x * g.box.w, p.center.y * g.box.h, p.angle * Math.PI / 180, Math.min(g.box.w, g.box.h)], [p.focus, p.transition, 0, 0]);
    },
    support: GPU_MID,
    ui: { section: 'Optics', order: 84, controls: ['blur', 'center', 'angle', 'focus', 'transition', { heading: 'Highlights' }, 'highlights', 'threshold'] },
    agent: {
      summary: 'A sharp band through a point with blur growing above and below it, as a tilted lens makes: the "miniature" look, or a way to lead the eye along a line.',
      like: 'the tilt-shift blur of photo editors\' blur galleries',
      tips: ['Miniature look: shoot from above, centre on the subject row, focus 0.06–0.1, transition 0.2, blur 10–20, then raise vibrance.', 'angle tilts the band (degrees, counter-clockwise).'],
      example: { type: 'tilt-shift', p: { blur: 14, center: { x: 0.5, y: 0.6 }, focus: 0.08, transition: 0.22 } }
    }
  });
  reg({
    id: 'iris-blur', name: 'Iris blur', group: 'blur', version: 1, space: 'linear',
    params: FIELD_PARAMS({ center: PT(0.5, 0.5, 'Centre'), rx: N(0.02, 2, 0.35, 0.005, 'Width'), ry: N(0.02, 2, 0.35, 0.005, 'Height'), angle: ANG(0, 'Angle'), transition: N(0, 1, 0.5, 0.005, 'Feather') }),
    radius: function (p, scale) { return lensReach(p.blur, scale, 6); },
    passes: function (g, p) {
      return fieldBlur(g, p, T_IRIS, [p.center.x * g.box.w, p.center.y * g.box.h, p.angle * Math.PI / 180, 0], [p.rx * g.box.w, p.ry * g.box.h, p.transition, 0]);
    },
    support: GPU_MID,
    ui: { section: 'Optics', order: 86, controls: ['blur', 'center', 'rx', 'ry', 'angle', 'transition', { heading: 'Highlights' }, 'highlights', 'threshold'] },
    agent: {
      summary: 'An elliptical sharp area around a point with lens-like blur growing outside it: a shallow-depth-of-field portrait look without a depth map.',
      like: 'the iris (field) blur of photo editors\' blur galleries',
      tips: ['Centre on the face; width and height are fractions of the layer box; feather 0.4–0.6 for a natural fall-off.', 'Prefer depth-blur when the layer has a depth map; this one does not know what is in front of what.'],
      example: { type: 'iris-blur', p: { blur: 16, center: { x: 0.5, y: 0.4 }, rx: 0.3, ry: 0.4, transition: 0.5 } }
    }
  });

  /* Motion blur: a uniform box along a direction, as the camera or subject moved during the exposure (a straight path at
     constant speed). Built from 1–3 comb passes of 10 taps (100 or 1,000 evenly spaced samples in all), linear light. */
  reg({
    id: 'motion-blur', name: 'Motion blur', group: 'blur', version: 1, space: 'linear',
    params: { angle: ANG(0, 'Angle'), distance: N(0, 1000, 0, 1, 'Distance', 'px') },
    radius: function (p, scale) { return p.distance * scale > 1 ? Math.ceil(p.distance * 0.5 * scale) + 3 : 0; },
    passes: function (g, p) {
      if (!(p.distance * g.scale > 1)) return;
      var a = p.angle * Math.PI / 180, out = comb(g, g.source, [Math.cos(a), -Math.sin(a)], p.distance, 0, 1);
      return out === g.source ? undefined : out;
    },
    support: GPU,
    ui: { section: 'Optics', order: 90, controls: ['angle', 'distance'] },
    agent: {
      summary: 'Blurs along a straight line, as when the camera or the subject moved during the exposure. Distance is the length of the movement in document pixels.',
      like: 'the motion blur filter of photo editors',
      tips: ['Speed lines behind a moving subject: apply with an inverted subject mask, angle along the movement, distance 30–80.', 'Camera shake: small distance (3–8) at an odd angle.'],
      example: { type: 'motion-blur', p: { angle: 0, distance: 40 } }
    }
  });

  reg({
    id: 'box-blur', name: 'Box blur', group: 'blur', version: 1, space: 'linear',
    params: { radius: N(0, 250, 0, 0.5, 'Radius', 'px') },
    radius: function (p, scale) { var rt = p.radius * scale; return rt > 0.5 ? Math.ceil(rt + 3 * (1 << levelFor(rt, 8, 6))) + 3 : 0; },
    passes: function (g, p) {
      var rt = p.radius * g.scale;
      if (!(rt > 0.5)) return;
      /* A box blur is smooth, so a wide one runs on the pyramid level where the radius is at most 8 pixels, then is tent-upsampled. */
      var L = levelFor(rt, 8, 6), lv = pyramid(g, g.source, L), src = L ? lv[L - 1] : g.source, sc = 1 / (1 << L);
      var x = comb(g, src, [1, 0], 2 * p.radius, 0, sc), y = comb(g, x, [0, 1], 2 * p.radius, 0, sc);
      if (x !== src && x !== y) g.release(x);
      lv.forEach(function (h) { if (h !== y) g.release(h); });
      if (y === g.source) return;
      if (!L) return y;
      var up = g.upsample(y, 1); g.release(y);
      return up;
    },
    support: GPU,
    ui: { section: 'Optics', order: 92, controls: ['radius'] },
    agent: {
      summary: 'An even (box) blur: every pixel within the radius counts the same. Flatter and more graphic than a Gaussian; useful for backgrounds behind text.',
      like: 'the box blur filter of photo editors',
      tips: ['For a natural defocus use lens-blur; for a smooth soft blur use gaussian-blur.'],
      example: { type: 'box-blur', p: { radius: 12 } }
    }
  });

  /* Radial blur: zoom (taps along the line to the centre, scaled about it) or spin (taps along the circle about it). The same comb
     structure as motion blur, in the radial or angular coordinate: 1–3 passes of 10 taps. Zoom spreads up to 60 % of the distance
     to the centre at amount 100; spin up to 30 degrees. */
  var RADIAL = 'uniform vec2 u_c; uniform vec2 u_m; uniform int u_n; uniform float u_w[16];\nvec4 fx(){ vec2 P = docPos(), d = P - u_c; vec4 a = vec4(0.0); for (int i = 0; i < 16; i++) { if (i >= u_n) break; float t = (float(i) - 0.5 * float(u_n - 1)) * u_m.y; vec2 Q; if (u_m.x < 0.5) Q = u_c + d * (1.0 + t); else { float c = cos(t), s = sin(t); Q = u_c + vec2(c * d.x - s * d.y, s * d.x + c * d.y); } a += texture(u_src, v_uv + docToUV(Q - P)) * u_w[i]; } return a; }';
  function radialSpread(p) { return p.mode === 'spin' ? p.amount / 100 * Math.PI / 6 : p.amount / 100 * 0.6; }
  reg({
    id: 'radial-blur', name: 'Radial blur', group: 'blur', version: 1, space: 'linear',
    params: { amount: N(0, 100, 0, 0.5, 'Amount'), mode: CH(opts([['zoom', 'Zoom'], ['spin', 'Spin']]), 'zoom', 'Method'), center: PT(0.5, 0.5, 'Centre') },
    radius: function (p, scale, box) { return p.amount > 0 ? Math.ceil(radialSpread(p) * 0.5 * farCorner(box && box.w ? box : REACH_BOX, p.center) * scale) + 3 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var s = radialSpread(p), Lt = s * farCorner(g.box, p.center) * g.scale, k = combPasses(Lt), n = 10, cur = g.source;
      if (g.draft && k > 1) k--;
      for (var j = 0; j < k; j++) {
        var out = g.pass(RADIAL, { u_src: cur, u_c: [p.center.x * g.box.w, p.center.y * g.box.h], u_m: [p.mode === 'spin' ? 1 : 0, s / Math.pow(n, j + 1)], u_n: n, u_w: combWeights(n, 0) });
        if (cur !== g.source) g.release(cur);
        cur = out;
      }
      return cur === g.source ? undefined : cur;
    },
    support: GPU,
    ui: { section: 'Optics', order: 94, controls: ['amount', 'mode', 'center'] },
    agent: {
      summary: 'Zoom blur (streaks towards a centre, like zooming during the exposure) or spin blur (arcs around it, like a spinning wheel).',
      like: 'the radial blur filter (zoom and spin) of photo editors',
      tips: ['Zoom burst on a subject: amount 15–30 with centre on the subject and a radial mask that keeps the subject sharp.', 'Spin a wheel: mode spin, centre on the hub, amount 20–60, masked to the wheel.'],
      example: { type: 'radial-blur', p: { amount: 20, mode: 'zoom', center: { x: 0.5, y: 0.45 } } }
    }
  });

  /* Surface blur: an edge-preserving average. Within the radius every neighbour counts the same, scaled by 1 − |difference| /
     (2.5 · threshold) (the largest channel difference, display values), the weighting of the classic surface blur. Done as two
     1-D passes of 2 × 8 taps (a separable approximation of the 2-D filter: very strong settings can show faint cross-shaped
     streaks along diagonal edges). */
  var SURF = 'uniform vec2 u_dir; uniform float u_t;\nvec4 fx(){ vec4 c0 = src(v_uv); vec3 u0 = unpremul(c0); vec4 acc = c0; float ws = 1.0;\n  for (int i = 1; i <= 8; i++) { for (int sgn = -1; sgn <= 1; sgn += 2) { vec4 a = texture(u_src, v_uv + docToUV(u_dir * float(i * sgn))); vec3 d = abs(unpremul(a) - u0); float w = max(0.0, 1.0 - max(d.r, max(d.g, d.b)) / u_t); acc += a * w; ws += w; } }\n  return acc / ws; }';
  reg({
    id: 'surface-blur', name: 'Surface blur', group: 'blur', version: 1, space: 'display',
    params: { radius: N(0, 100, 0, 0.5, 'Radius', 'px'), threshold: N(1, 255, 15, 1, 'Threshold', null, 'Differences (in levels) above which neighbours are ignored; edges with more contrast stay sharp.') },
    radius: function (p, scale) { return p.radius * scale > 0.5 ? Math.ceil(p.radius * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.radius * g.scale > 0.5)) return;
      var st = p.radius / 8, t = 2.5 * p.threshold / 255;
      var x = g.pass(SURF, { u_dir: [st, 0], u_t: t });
      var y = g.pass(SURF, { u_src: x, u_dir: [0, st], u_t: t });
      g.release(x);
      return y;
    },
    support: GPU,
    ui: { section: 'Optics', order: 96, controls: ['radius', 'threshold'] },
    agent: {
      summary: 'Smooths flat areas and keeps edges: neighbours that differ by more than the threshold are ignored. Good for skin, skies and posterised graphic looks.',
      like: 'the surface blur filter of photo editors (radius, threshold in levels)',
      tips: ['Skin smoothing base: radius 6–10, threshold 10–20, then lower the entry amount to 0.5 and add texture back with film-grain.', 'Painterly flats: radius 20+, threshold 30+.'],
      example: { type: 'surface-blur', p: { radius: 8, threshold: 18 } }
    }
  });

  /* Soft focus family: diffusion (a diffusion filter: part of the light spread, linear light), Orton (the slide sandwich of a
     sharp and a blurred over-exposure, multiplied, display values) and soft glow (a blurred bright-pass screened over the picture).
     Passes: [1 bright pass] + Gaussian blur (2–14) + 1 composite. */
  var SOFTC = 'uniform sampler2D u_bl; uniform vec4 u_a;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); vec3 b = unpremul(texture(u_bl, v_uv)); float e = u_a.z; vec3 o;\n' +
    '  if (u_a.y < 0.5) o = mix(c, b, 0.75 * u_a.x);\n' +
    '  else if (u_a.y < 1.5) { vec3 A = clamp(toDisplay(c * e), 0.0, 1.0), B = clamp(toDisplay(b * e), 0.0, 1.0); vec3 S = 1.0 - (1.0 - A) * (1.0 - B); o = toLinear(mix(toDisplay(c), S * B * 1.08, u_a.x)); }\n' +
    '  else { vec3 d = toDisplay(c), B = clamp(toDisplay(b * e), 0.0, 1.0) * u_a.x; o = toLinear(1.0 - (1.0 - clamp(d, 0.0, 1.0)) * (1.0 - B) + max(d - 1.0, 0.0)); }\n' +
    '  return vec4(o * s.a, s.a); }';
  var BRIGHT = 'vec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float y = toDisplay(vec3(luma(max(c, 0.0)))).r; return vec4(c * smoothstep(0.35, 0.9, y) * s.a, s.a); }';
  reg({
    id: 'soft-focus', name: 'Soft focus and glow', group: 'blur', version: 1, space: 'linear',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      style: CH(opts([['diffusion', 'Diffusion'], ['orton', 'Orton'], ['glow', 'Soft glow']]), 'diffusion', 'Style'),
      radius: N(1, 200, 20, 0.5, 'Radius', 'px'),
      brightness: N(-100, 100, 0, 1, 'Brightness', null, 'Orton and soft glow: exposure of the blurred layer.')
    },
    radius: function (p, scale) { return p.amount > 0 ? M.blurReach(p.radius * scale) : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var st = p.style === 'orton' ? 1 : p.style === 'glow' ? 2 : 0, pre = st === 2 ? g.pass(BRIGHT) : null;
      var bl = g.blur(p.radius, pre ? { source: pre } : null);
      if (pre) g.release(pre);
      var out = g.pass(SOFTC, { u_bl: bl, u_a: [p.amount / 100, st, Math.pow(2, p.brightness / 100 * 1.5 + (st === 1 ? 0.6 : 0)), 0] });
      g.release(bl);
      return out;
    },
    support: GPU_MID,
    ui: { section: 'Optics', order: 98, controls: ['amount', 'style', 'radius', 'brightness'] },
    agent: {
      summary: 'Soft-focus looks: diffusion (a diffusion filter\'s gentle spread of light), Orton (the dreamy sandwich of a sharp and a blurred over-exposure) and soft glow (bright parts glow outward).',
      like: 'diffusion filters, the Orton effect and the soft/diffuse glow filters of photo editors',
      tips: ['Portraits: diffusion 25–40, radius 15–25.', 'Landscapes and forests: orton 30–50, radius 20–40, brightness 0–20.', 'Soft glow 30 with radius 30 gives a 1980s soft-focus portrait.'],
      example: { type: 'soft-focus', p: { amount: 35, style: 'orton', radius: 25 } }
    }
  });

  /* =====================================================================================================================
     3. Detail
     ===================================================================================================================== */

  /* Unsharp mask on luminance (display values): d = L − Gaussian(L, radius); a soft threshold ignores |d| below `threshold`
     levels; masking keeps sharpening to edges (gradient of the blurred image above a level); halo suppression clamps the result
     to the local range of the source (8 neighbours one radius away), widened by (1 − halo). The change is added to every channel
     equally, so colours do not fringe. Passes: blur (2 for small radii) + 1. */
  var USM = 'uniform sampler2D u_bl; uniform vec4 u_a; uniform vec2 u_r;\n' +
    'float L(sampler2D t, vec2 uv){ return luma(unpremul(texture(t, uv))); }\n' +
    'vec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float l = luma(c), lb = L(u_bl, v_uv), d = l - lb;\n' +
    '  if (u_a.y > 0.0) d *= smoothstep(u_a.y * 0.5, u_a.y, abs(d));\n' +
    '  vec2 ex = docToUV(vec2(u_r.x, 0.0)), ey = docToUV(vec2(0.0, u_r.x));\n' +
    '  if (u_a.z > 0.0) { float gx = L(u_bl, v_uv + ex) - L(u_bl, v_uv - ex), gy = L(u_bl, v_uv + ey) - L(u_bl, v_uv - ey); d *= smoothstep(u_a.z * 0.06, u_a.z * 0.06 + 0.03, length(vec2(gx, gy))); }\n' +
    '  float ln = l + d * u_a.x;\n' +
    '  if (u_a.w > 0.0) { float lo = l, hi = l; for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { if (i == 0 && j == 0) continue; float v = L(u_src, v_uv + ex * float(i) + ey * float(j)); lo = min(lo, v); hi = max(hi, v); }\n' +
    '    float sl = (hi - lo) * (1.0 - u_a.w) * 0.5 + 0.004; ln = clamp(ln, lo - sl, hi + sl); }\n' +
    '  return vec4((c + (ln - l)) * s.a, s.a); }';
  reg({
    id: 'sharpen', name: 'Sharpen', group: 'detail', version: 1, space: 'display',
    params: {
      amount: N(0, 500, 0, 1, 'Amount', '%'),
      radius: N(0.1, 10, 1, 0.1, 'Radius', 'px'),
      threshold: N(0, 255, 0, 1, 'Threshold', null, 'Levels of difference below which nothing is sharpened (protects smooth areas and noise).'),
      masking: N(0, 100, 0, 1, 'Masking', null, 'Sharpen only edges: 0 everywhere, 100 only strong edges.'),
      halo: N(0, 100, 50, 1, 'Halo suppression')
    },
    radius: function (p, scale) { return p.amount > 0 ? M.blurReach(p.radius * scale) + Math.ceil(p.radius * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var bl = g.blur(p.radius), r = Math.max(p.radius, 1 / g.scale);
      var out = g.pass(USM, { u_bl: bl, u_a: [p.amount / 100, p.threshold / 255, p.masking / 100, p.halo / 100], u_r: [r, 0] });
      g.release(bl);
      return out;
    },
    support: GPU,
    ui: { section: 'Detail', order: 10, controls: ['amount', 'radius', 'threshold', 'masking', 'halo'] },
    agent: {
      summary: 'Unsharp-mask sharpening on luminance with threshold, edge masking and halo suppression, so edges crisp up without colour fringes or bright outlines.',
      like: 'the unsharp mask filter and the sharpening panel of raw developers (amount, radius, masking)',
      tips: ['Output sharpening for screens: amount 60–100, radius 0.6–1.0, halo 50.', 'Portraits: masking 50–70 so skin is left alone; threshold 3–6 protects noise.', 'Local contrast punch: amount 20–30, radius 20–50 (or use clarity, which avoids halos better).', 'Sharpen last, after resizing effects and before grain.'],
      example: { type: 'sharpen', p: { amount: 90, radius: 0.9, masking: 30 } }
    }
  });

  /* Smart sharpen: Richardson–Lucy deconvolution in linear light (est ← est · PSF ⊛ (I / PSF ⊛ est), the ratio clamped to
     0.5–2 for stability), 3 iterations (1 while dragging), with a Gaussian, a lens (disc) or a motion (line) point spread
     function. The restored detail est − I is soft-thresholded by `noise` (on its luminance) and clamped to the local range for
     halo control, then scaled by `amount`. Passes per iteration: 2 PSF blurs + 2; plus 1. */
  var RL_RATIO = 'uniform sampler2D u_i;\nvec4 fx(){ vec4 I = texture(u_i, v_uv), b = src(v_uv); return vec4(clamp(I.rgb / max(b.rgb, vec3(1e-4)), 0.5, 2.0), 1.0); }';
  var RL_MUL = 'uniform sampler2D u_e;\nvec4 fx(){ vec4 e = texture(u_e, v_uv); return vec4(e.rgb * src(v_uv).rgb, e.a); }';
  var RL_OUT = 'uniform sampler2D u_e; uniform vec4 u_a;\nvec4 fx(){ vec4 s = src(v_uv), e = texture(u_e, v_uv); vec3 d = e.rgb - s.rgb; float dl = luma(d);\n' +
    '  float k = u_a.y > 0.0 ? smoothstep(u_a.y, u_a.y * 2.5, abs(dl)) : 1.0; vec3 o = s.rgb + d * k * u_a.x;\n' +
    '  vec2 ex = docToUV(vec2(u_a.z, 0.0)), ey = docToUV(vec2(0.0, u_a.z)); vec3 lo = s.rgb, hi = s.rgb;\n' +
    '  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec3 v = texture(u_src, v_uv + ex * float(i) + ey * float(j)).rgb; lo = min(lo, v); hi = max(hi, v); }\n' +
    '  vec3 sl = (hi - lo) * 0.35 + 0.002; return vec4(clamp(o, lo - sl, hi + sl), s.a); }';
  var DISC = 'uniform vec2 u_k[' + MAXK + ']; uniform int u_n; uniform float u_r;\nvec4 fx(){ vec4 a = vec4(0.0); for (int i = 0; i < ' + MAXK + '; i++) { if (i >= u_n) break; a += texture(u_src, v_uv + docToUV(u_k[i] * u_r)); } return a / float(u_n); }';
  reg({
    id: 'smart-sharpen', name: 'Smart sharpen', group: 'detail', version: 1, space: 'linear',
    params: {
      amount: N(0, 300, 0, 1, 'Amount', '%'),
      radius: N(0.3, 8, 1.2, 0.1, 'Radius', 'px'),
      remove: CH(opts([['gaussian', 'Gaussian blur'], ['lens', 'Lens blur'], ['motion', 'Motion blur']]), 'gaussian', 'Remove'),
      angle: ANG(0, 'Angle'),
      noise: N(0, 100, 10, 1, 'Reduce noise')
    },
    radius: function (p, scale) { if (!(p.amount > 0)) return 0; var one = p.remove === 'gaussian' ? M.blurReach(p.radius * scale) : Math.ceil(p.radius * 1.2 * scale) + 3; return one * 6 + Math.ceil(p.radius * scale) + 4; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var I = g.source, a = p.angle * Math.PI / 180;
      var kd = bokehKernel(clamp(Math.ceil(p.radius * g.scale / 1.2), 1, 4), 0, 1, 0);
      function psf(h) {
        if (p.remove === 'lens') return g.pass(DISC, { u_src: h, u_k: kd.data, u_n: kd.n, u_r: p.radius });
        if (p.remove === 'motion') { var m = comb(g, h, [Math.cos(a), -Math.sin(a)], p.radius * 2, 0, 1); return m === h ? g.pass('vec4 fx(){ return src(v_uv); }', { u_src: h }) : m; }
        return g.blur(p.radius * 0.7, { source: h });
      }
      var est = I, it = g.draft ? 1 : 3;
      for (var i = 0; i < it; i++) {
        var b = psf(est), ratio = g.pass(RL_RATIO, { u_src: b, u_i: I }); g.release(b);
        var cr = psf(ratio); g.release(ratio);
        var next = g.pass(RL_MUL, { u_src: cr, u_e: est }); g.release(cr);
        if (est !== I) g.release(est);
        est = next;
      }
      var out = g.pass(RL_OUT, { u_src: I, u_e: est, u_a: [p.amount / 100, p.noise / 100 * 0.02, Math.max(p.radius, 1 / g.scale), 0] });
      g.release(est);
      return out;
    },
    support: GPU_MID,
    ui: { section: 'Detail', order: 20, controls: ['amount', 'radius', 'remove', { param: 'angle', when: { remove: 'motion' } }, 'noise'] },
    agent: {
      summary: 'Deconvolution sharpening (Richardson–Lucy): undoes a small Gaussian, lens or motion blur instead of only raising edge contrast, with noise and halo control.',
      like: 'the smart sharpen filter of photo editors (remove: Gaussian, lens or motion blur; reduce noise)',
      tips: ['Slightly soft lens: remove lens, radius 1–2, amount 80–150.', 'Small camera shake: remove motion, angle along the smear, radius = half its length.', 'Raise reduce noise if flat areas get gritty. It is slower than sharpen; use sharpen for output sharpening.'],
      example: { type: 'smart-sharpen', p: { amount: 120, radius: 1.4, remove: 'lens', noise: 15 } }
    }
  });

  /* Clarity: large-radius local contrast on log luminance with an edge-aware base (a self-guided filter, He et al. 2010: the base
     is a·I + b with a = var/(var + ε) over a Gaussian window, so strong edges stay in the base and do not halo). The detail I − base
     is scaled by 1 + k·w, w a mid-tone weight on the base, and the luminance ratio is applied to all channels (hue and saturation
     kept). `halo` sets ε: high values preserve edges more. Passes: 1 + 2 blurs + 2. */
  var LOGL = 'vec4 fx(){ vec4 s = src(v_uv); float y = max(luma(unpremul(s)), 0.0); float l = (log2(y + 1e-3) + 10.0) / 10.5; return vec4(l, l * l, 0.0, 1.0); }';
  var GFAB = 'uniform float u_eps;\nvec4 fx(){ vec4 m = src(v_uv); float v = max(m.g - m.r * m.r, 0.0); float a = v / (v + u_eps); return vec4(a, m.r - a * m.r, 0.0, 1.0); }';
  var CLAR = 'uniform sampler2D u_i, u_ab; uniform vec2 u_k;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float I = texture(u_i, v_uv).r; vec2 ab = texture(u_ab, v_uv).rg; float base = ab.x * I + ab.y;\n' +
    '  float ld = pow(clamp(exp2(base * 10.5 - 10.0), 0.0, 1.0), 1.0 / 2.2); float w = mix(1.0, smoothstep(0.0, 0.35, ld) * (1.0 - smoothstep(0.7, 1.0, ld)), u_k.y);\n' +
    '  float f = exp2(clamp((I - base) * u_k.x * w * 10.5, -2.0, 2.0)); return vec4(c * f * s.a, s.a); }';
  CR.guidedAB = function (mean, meanSq, eps) { var v = Math.max(meanSq - mean * mean, 0), a = v / (v + eps); return [a, mean - a * mean]; };
  function clarityLike(g, p, R, eps, k, w) {
    var I = g.pass(LOGL), m = g.blur(R, { source: I });
    var ab = g.pass(GFAB, { u_src: m, u_eps: eps }); g.release(m);
    var mab = g.blur(R, { source: ab }); g.release(ab);
    var out = g.pass(CLAR, { u_i: I, u_ab: mab, u_k: [k, w] });
    g.release(I); g.release(mab);
    return out;
  }
  reg({
    id: 'clarity', name: 'Clarity', group: 'detail', version: 1, space: 'linear',
    params: {
      amount: N(-100, 100, 0, 1, 'Clarity'),
      radius: N(5, 300, 40, 1, 'Radius', 'px'),
      halo: N(0, 100, 60, 1, 'Edge protection', null, 'Higher keeps strong edges out of the effect, so no halos form around them.'),
      midtones: N(0, 100, 70, 1, 'Mid-tone focus')
    },
    radius: function (p, scale) { return p.amount ? 2 * M.blurReach(p.radius * scale) : 0; },
    passes: function (g, p) {
      if (!p.amount) return;
      var e = 0.004 + (1 - p.halo / 100) * 0.05;
      return clarityLike(g, p, p.radius, e * e, p.amount / 100, p.midtones / 100);
    },
    support: GPU_MID,
    ui: { section: 'Detail', order: 30, controls: ['amount', 'radius', 'halo', 'midtones'] },
    agent: {
      summary: 'Local contrast at a large scale on luminance with an edge-aware base, so mid-tone structure gains punch without halos; negative values soften it (a gentle "glow" for skin).',
      like: 'the clarity slider of raw developers',
      tips: ['Landscapes and architecture: +20 to +40. Portraits: −10 to −25 on skin with a face or subject mask.', 'radius in document pixels: about 2–4 % of the short side.', 'Lower edge protection for a grittier, more dramatic look; raise it if bright outlines appear around dark objects.'],
      example: { type: 'clarity', p: { amount: 30, radius: 40 } }
    }
  });

  /* Texture: medium-frequency detail. band = G(σ = 1.2 px) − G(σ = 6 px) of log luminance (a band-pass), attenuated where it is
     large (|band| ≫ 0.03, real edges) so halos do not form, scaled by k and applied as a luminance ratio. Negative values remove
     the band: skin and surfaces smooth while fine detail and large shapes stay. Passes: 1 + 2 blurs + 1. */
  var TEXT = 'uniform sampler2D u_i, u_b1, u_b2; uniform float u_k;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float band = texture(u_b1, v_uv).r - texture(u_b2, v_uv).r; float stop = 1.0 / (1.0 + band * band / 0.0009); float f = exp2(clamp(band * stop * u_k * 10.5, -2.0, 2.0)); return vec4(c * f * s.a, s.a); }';
  reg({
    id: 'texture', name: 'Texture', group: 'detail', version: 1, space: 'linear',
    params: { amount: N(-100, 100, 0, 1, 'Texture'), size: N(0.5, 4, 1, 0.05, 'Detail size', null, 'Scales the band of detail (1 is fine textures such as skin pores and fabric).') },
    radius: function (p, scale) { return p.amount ? M.blurReach(6 * p.size * scale) : 0; },
    passes: function (g, p) {
      if (!p.amount) return;
      var I = g.pass(LOGL), b1 = g.blur(1.2 * p.size, { source: I }), b2 = g.blur(6 * p.size, { source: I });
      var out = g.pass(TEXT, { u_b1: b1, u_b2: b2, u_k: p.amount > 0 ? p.amount / 100 * 1.6 : p.amount / 100 });
      g.release(I); g.release(b1); g.release(b2);
      return out;
    },
    support: GPU,
    ui: { section: 'Detail', order: 40, controls: ['amount', 'size'] },
    agent: {
      summary: 'Enhances or smooths medium-sized detail (skin texture, foliage, fabric) without touching fine detail or large shapes. Negative values are a natural skin smoother.',
      like: 'the texture slider of raw developers',
      tips: ['Portrait skin: −20 to −40 with a face/skin mask; keep it above −50 or skin turns plastic.', 'Product and food: +20 to +40 brings out surface detail.'],
      example: { type: 'texture', p: { amount: 30 } }
    }
  });

  /* Dehaze: the dark channel prior (He, Sun, Tang 2009) in display values. Atmospheric light A from whole-image statistics (the
     99th percentile per channel, from g.stats(), so every tile uses the same A); dark channel min(c / A) eroded over a patch of
     15 document pixels at quarter resolution, refined with a guided filter on luminance (σ 37 px; skipped while dragging), transmission
     t = 1 − 0.95·amount·dark, recovery J = (I − A)/max(t, 0.1) + A. Negative amounts add haze where the estimate already sees some
     (I·(1 − h) + A·h). Passes: 1 + 2 min-downsamples + 2 erosions + 1 + 2 blurs + 1 + 1 (8 while dragging). */
  var DARK = 'uniform vec3 u_A;\nvec4 fx(){ vec3 c = clamp(unpremul(src(v_uv)), 0.0, 1.0) / u_A; return vec4(min(min(c.r, c.g), c.b)); }';
  var MIN2 = 'vec4 fx(){ vec2 d = 0.25 * u_texel; return vec4(min(min(texture(u_src, v_uv + d).r, texture(u_src, v_uv - d).r), min(texture(u_src, v_uv + vec2(d.x, -d.y)).r, texture(u_src, v_uv + vec2(-d.x, d.y)).r))); }';
  var ERODE = 'uniform vec2 u_step; uniform int u_n;\nvec4 fx(){ float m = src(v_uv).r; for (int i = 1; i <= 8; i++) { if (i > u_n) break; vec2 o = docToUV(u_step * float(i)); m = min(m, min(texture(u_src, v_uv + o).r, texture(u_src, v_uv - o).r)); } return vec4(m); }';
  var DPACK = TENT + 'uniform sampler2D u_d;\nvec4 fx(){ float I = luma(clamp(unpremul(src(v_uv)), 0.0, 1.0)); float p = tent(u_d, v_uv).r; return vec4(I, p, I * p, I * I); }';
  var DCOEF = 'uniform float u_eps;\nvec4 fx(){ vec4 m = src(v_uv); float v = max(m.a - m.r * m.r, 0.0); float a = (m.b - m.r * m.g) / (v + u_eps); return vec4(a, m.g - a * m.r, 0.0, 1.0); }';
  var DHAZE = TENT + 'uniform sampler2D u_ab, u_d; uniform vec3 u_A; uniform vec2 u_k;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float q;\n' +
    '  if (u_k.y > 0.5) { vec2 ab = texture(u_ab, v_uv).rg; q = ab.x * luma(clamp(c, 0.0, 1.0)) + ab.y; } else q = tent(u_d, v_uv).r; q = clamp(q, 0.0, 1.0);\n' +
    '  vec3 o; if (u_k.x >= 0.0) { float t = max(1.0 - 0.95 * u_k.x * q, 0.1); o = (c - u_A) / t + u_A; } else { float hz = -u_k.x * 0.7 * (0.35 + 0.65 * q); o = c * (1.0 - hz) + u_A * hz; }\n' +
    '  return vec4(o * s.a, s.a); }';
  CR.dehazePixel = function (c, A, q, k) { if (k >= 0) { var t = Math.max(1 - 0.95 * k * q, 0.1); return c.map(function (v, i) { return (v - A[i]) / t + A[i]; }); } var hz = -k * 0.7 * (0.35 + 0.65 * q); return c.map(function (v, i) { return v * (1 - hz) + A[i] * hz; }); };
  var DH_PATCH = 15;   /* document pixels: the 15 × 15 patch of the paper at its working size */
  function hazeLight(g) {
    var st = g.stats && g.stats(), P = st && st.percentiles;
    if (!P) return [0.92, 0.94, 0.96];
    return [P.r.p99, P.g.p99, P.b.p99].map(function (v) { return clamp(v, 0.3, 1); });
  }
  reg({
    id: 'dehaze', name: 'Dehaze', group: 'detail', version: 1, space: 'display', needs: ['stats'],
    params: { amount: N(-100, 100, 0, 1, 'Dehaze') },
    radius: function (p, scale) { return p.amount ? Math.ceil(DH_PATCH * scale) + 2 * M.blurReach(DH_PATCH * 2.5 * scale) + 16 : 0; },
    passes: function (g, p) {
      if (!p.amount) return;
      var A = hazeLight(g), patch = DH_PATCH, refine = !g.draft;
      var d0 = g.pass(DARK, { u_A: A }), d1 = g.pass(MIN2, { u_src: d0 }, { scale: 0.5 }); g.release(d0);
      var d2 = g.pass(MIN2, { u_src: d1 }, { scale: 0.25 }); g.release(d1);
      var n = clamp(Math.round(patch * g.scale / 4), 1, 8), stp = patch / n;
      var e1 = g.pass(ERODE, { u_src: d2, u_step: [stp, 0], u_n: n }, { scale: 0.25 }); g.release(d2);
      var e2 = g.pass(ERODE, { u_src: e1, u_step: [0, stp], u_n: n }, { scale: 0.25 }); g.release(e1);
      var mab = null;
      if (refine) {
        var pk = g.pass(DPACK, { u_d: e2 }), R = patch * 2.5, m = g.blur(R, { source: pk }); g.release(pk);
        var ab = g.pass(DCOEF, { u_src: m, u_eps: 0.002 }); g.release(m);
        mab = g.blur(R, { source: ab }); g.release(ab);
      }
      var out = g.pass(DHAZE, { u_ab: mab, u_d: e2, u_A: A, u_k: [p.amount / 100, refine ? 1 : 0] });
      g.release(e2); if (mab) g.release(mab);
      return out;
    },
    support: GPU_MID,
    ui: { section: 'Detail', order: 50, controls: ['amount'] },
    agent: {
      summary: 'Removes (positive) or adds (negative) atmospheric haze with the dark-channel-prior model: estimates how much haze each area has and the colour of the haze, then restores contrast and colour there.',
      like: 'the dehaze slider of raw developers',
      tips: ['Landscapes with distant haze: +20 to +40. Above +60 shadows can block up and noise rises: follow with highlights-shadows (shadows +20).', 'Negative values (−20 to −40) add a soft, airy haze; for coloured fog use haze.', 'It reads whole-picture statistics (needs: stats), so the haze colour is the same in every tile and in the preview.'],
      example: { type: 'dehaze', p: { amount: 30 } }
    }
  });

  /* Noise reduction (display values), edge-aware, in a luminance/colour-difference space (Y, Cb, Cr). Luminance: a self-guided
     filter on Y (radius 1–3.5 px, ε from the amount), with `detail` blending some of the original back. Colour: Cb and Cr are each
     filtered with Y as the guide (radius 2–10 px, large ε), so colour blotches flatten but colour edges that follow luminance edges
     stay put. Comparison: it removes moderate sensor noise and colour blotches well; it is not a patch-based or learned denoiser,
     so strong high-ISO noise keeps some grain and fine texture is smoothed at high settings. Passes: 1–2 + 2–3 blurs (+1 each) + 1. */
  var NRPACK1 = 'vec4 fx(){ vec3 c = unpremul(src(v_uv)); float y = luma(c); return vec4(y, y * y, (c.b - y) * 0.5 + 0.5, (c.r - y) * 0.5 + 0.5); }';
  var NRPACK2 = 'vec4 fx(){ vec3 c = unpremul(src(v_uv)); float y = luma(c); return vec4(y * ((c.b - y) * 0.5 + 0.5), y * ((c.r - y) * 0.5 + 0.5), 0.0, 1.0); }';
  var NRLAB = 'uniform float u_eps;\nvec4 fx(){ vec4 m = src(v_uv); float v = max(m.g - m.r * m.r, 0.0); float a = v / (v + u_eps); return vec4(a, m.r - a * m.r, 0.0, 1.0); }';
  var NRCAB = 'uniform sampler2D u_m2; uniform float u_eps;\nvec4 fx(){ vec4 m = src(v_uv), n = texture(u_m2, v_uv); float v = max(m.g - m.r * m.r, 0.0) + u_eps; float ab = (n.r - m.r * m.b) / v, ar = (n.g - m.r * m.a) / v; return vec4(ab, m.b - ab * m.r, ar, m.a - ar * m.r); }';
  var NROUT = 'uniform sampler2D u_l, u_c; uniform vec4 u_k;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float y = luma(c); float cb = (c.b - y) * 0.5 + 0.5, cr = (c.r - y) * 0.5 + 0.5;\n' +
    '  float yn = y; if (u_k.x > 0.5) { vec2 l = texture(u_l, v_uv).rg; yn = mix(l.x * y + l.y, y, u_k.z); }\n' +
    '  if (u_k.y > 0.5) { vec4 k = texture(u_c, v_uv); cb = k.r * y + k.g; cr = k.b * y + k.a; }\n' +
    '  float r = yn + (cr - 0.5) * 2.0, b = yn + (cb - 0.5) * 2.0, gg = (yn - 0.2126 * r - 0.0722 * b) / 0.7152; return vec4(vec3(r, gg, b) * s.a, s.a); }';
  function nrRadii(p) { return [1 + p.luminance / 100 * 2.5, 2 + p.color / 100 * 8]; }
  reg({
    id: 'noise-reduction', name: 'Noise reduction', group: 'detail', version: 1, space: 'display',
    params: { luminance: N(0, 100, 0, 1, 'Luminance'), detail: N(0, 100, 50, 1, 'Detail'), color: N(0, 100, 0, 1, 'Colour') },
    radius: function (p, scale) { if (!(p.luminance > 0 || p.color > 0)) return 0; var r = nrRadii(p); return 2 * M.blurReach(Math.max(p.luminance > 0 ? r[0] : 0, p.color > 0 ? r[1] : 0) * scale); },
    passes: function (g, p) {
      if (!(p.luminance > 0 || p.color > 0)) return;
      var r = nrRadii(p), pk1 = g.pass(NRPACK1), lh = null, ch = null;
      if (p.luminance > 0) {
        var ml = g.blur(r[0], { source: pk1 }), e = p.luminance / 100 * 0.07;
        var al = g.pass(NRLAB, { u_src: ml, u_eps: e * e }); g.release(ml);
        lh = g.blur(r[0], { source: al }); g.release(al);
      }
      if (p.color > 0) {
        var pk2 = g.pass(NRPACK2), m1 = g.blur(r[1], { source: pk1 }), m2 = g.blur(r[1], { source: pk2 }); g.release(pk2);
        var ec = 0.01 + p.color / 100 * 0.12, ac = g.pass(NRCAB, { u_src: m1, u_m2: m2, u_eps: ec * ec }); g.release(m1); g.release(m2);
        ch = g.blur(r[1], { source: ac }); g.release(ac);
      }
      g.release(pk1);
      var out = g.pass(NROUT, { u_l: lh, u_c: ch, u_k: [lh ? 1 : 0, ch ? 1 : 0, p.detail / 100 * 0.6, 0] });
      if (lh) g.release(lh); if (ch) g.release(ch);
      return out;
    },
    support: GPU_MID,
    ui: { section: 'Detail', order: 60, controls: [{ heading: 'Luminance' }, 'luminance', 'detail', { heading: 'Colour' }, 'color'] },
    agent: {
      summary: 'Edge-aware noise reduction: luminance smoothing that keeps edges, and colour-noise removal guided by luminance so colour edges stay. Good for moderate noise; not a replacement for a dedicated learned denoiser on very high ISO files.',
      like: 'the noise reduction panel of raw developers (luminance, detail, colour)',
      tips: ['Phone night shots: colour 40–60, luminance 20–30, detail 50.', 'Colour noise reduction is almost free of side effects; luminance above 50 starts to smooth texture.', 'Put it early, before sharpening and clarity, which would otherwise amplify the noise.'],
      example: { type: 'noise-reduction', p: { luminance: 30, detail: 50, color: 50 } }
    }
  });

  /* High pass: the picture minus its Gaussian blur, around mid-grey (display values), either shown as is or blended back with an
     overlay-family mode (the classic high-pass sharpening). Passes: blur + 1. */
  var HP = 'uniform sampler2D u_bl; uniform vec2 u_m;\nvec3 ov(vec3 b, vec3 s){ return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b)); }\n' +
    'vec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); vec3 hp = clamp(c - unpremul(texture(u_bl, v_uv)) + 0.5, 0.0, 1.0); vec3 o; float m = u_m.y;\n' +
    '  vec3 b = clamp(c, 0.0, 1.0);\n' +
    '  if (m < 0.5) o = hp; else if (m < 1.5) o = ov(b, hp); else if (m < 2.5) o = mix(b - (1.0 - 2.0 * hp) * b * (1.0 - b), b + (2.0 * hp - 1.0) * (sqrt(b) - b), step(vec3(0.5), hp)); else if (m < 3.5) o = ov(hp, b); else o = b + 2.0 * hp - 1.0;\n' +
    '  return vec4(mix(c, o, u_m.x) * s.a, s.a); }';
  reg({
    id: 'high-pass', name: 'High pass', group: 'detail', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      radius: N(0.3, 250, 4, 0.1, 'Radius', 'px'),
      mode: CH(opts([['show', 'Show high pass'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['hard-light', 'Hard light'], ['linear-light', 'Linear light']]), 'overlay', 'Blend')
    },
    radius: function (p, scale) { return p.amount > 0 ? M.blurReach(p.radius * scale) : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var bl = g.blur(p.radius), out = g.pass(HP, { u_bl: bl, u_m: [p.amount / 100, ['show', 'overlay', 'soft-light', 'hard-light', 'linear-light'].indexOf(p.mode)] });
      g.release(bl);
      return out;
    },
    support: GPU,
    ui: { section: 'Detail', order: 70, controls: ['amount', 'radius', 'mode'] },
    agent: {
      summary: 'The high-pass filter: detail finer than the radius around mid-grey. Blended with overlay or soft light it sharpens or adds local contrast; shown as is it is a detail map.',
      like: 'the high pass filter of photo editors used on an overlay layer',
      tips: ['High-pass sharpening: radius 1.5–3, overlay, amount 60–100.', 'Local contrast: radius 30–60, soft light, amount 40.', 'mode show with entry blend set to another mode reproduces any layer recipe.'],
      example: { type: 'high-pass', p: { amount: 80, radius: 2.5, mode: 'overlay' } }
    }
  });

  /* =====================================================================================================================
     4. Stylise
     ===================================================================================================================== */

  /* Duotone / tritone: a gradient map from display luminance (perceptual position) through two or three colours interpolated in
     linear light, mixed by amount. One colour pass. */
  reg({
    id: 'duotone', name: 'Duotone', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      tones: CH(opts([['2', 'Duotone'], ['3', 'Tritone']]), '2', 'Tones'),
      shadows: COL('#1b2a4a', 'Shadows'),
      midtones: COL('#b0566a', 'Mid-tones'),
      highlights: COL('#ffe0b0', 'Highlights'),
      balance: N(-100, 100, 0, 1, 'Balance')
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      function L(c) { var v = M.parseColor(c) || [0, 0, 0, 1]; return [lin(v[0]), lin(v[1]), lin(v[2])]; }
      g.color('uniform vec3 $s, $m, $h; uniform vec3 $a; vec3 $fx(vec3 c){ float t = clamp(luma(clamp(c, 0.0, 1.0)) + $a.z, 0.0, 1.0); vec3 col = $a.y > 0.5 ? (t < 0.5 ? mix($s, $m, t * 2.0) : mix($m, $h, t * 2.0 - 1.0)) : mix($s, $h, t); return mix(c, toDisplay(col), $a.x); }',
        { s: L(p.shadows), m: L(p.midtones), h: L(p.highlights), a: [p.amount / 100, p.tones === '3' ? 1 : 0, p.balance / 200] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 100, controls: ['amount', 'tones', 'shadows', { param: 'midtones', when: { tones: '3' } }, 'highlights', 'balance'] },
    agent: {
      summary: 'Maps the picture\'s tones onto two (duotone) or three (tritone) colours, like a two-ink print or a graphic poster.',
      like: 'duotone image modes and gradient maps of photo and design editors',
      tips: ['Brand duotone: shadows = the darkest brand colour, highlights = a light tint of another; amount 100.', 'A subtle split-tone look: amount 20–35 with warm highlights and cool shadows.', 'balance shifts which tones get which colour.'],
      example: { type: 'duotone', p: { amount: 100, shadows: '#1b2a4a', highlights: '#ffd0a0' } }
    }
  });

  /* Radius of a dot whose area inside its unit cell is D: √(D/π) until the dot touches the cell edges (D = π/4), then the disc minus
     the four segments beyond the edges, inverted by bisection. 256 entries, built once. */
  var DOTR = null;
  CR.dotArea = function (r) { if (r <= 0.5) return Math.PI * r * r; var seg = r * r * Math.acos(0.5 / r) - 0.5 * Math.sqrt(r * r - 0.25); return r >= Math.SQRT1_2 ? 1 : Math.PI * r * r - 4 * seg; };
  function dotRadii() {
    if (DOTR) return DOTR;
    DOTR = new Float32Array(256);
    for (var i = 0; i < 256; i++) { var D = i / 255, lo = 0, hi = Math.SQRT1_2; for (var k = 0; k < 40; k++) { var mid = (lo + hi) / 2; if (CR.dotArea(mid) < D) lo = mid; else hi = mid; } DOTR[i] = i === 255 ? 0.75 : (lo + hi) / 2; }
    return DOTR;
  }
  /* Halftone: an amplitude-modulated screen in document space. Dots: a disc per cell of `size` px whose area in the cell is the ink
     coverage D (dotRadii); lines: a stripe of width D. Mono uses ink and paper colours and 1 − luminance as coverage;
     CMYK separates naively (K = 1 − max, C/M/Y from the rest) and screens each ink at its classic angle (C 15°, M 75°, Y 0°,
     K 45°, plus `angle`), multiplying them on paper. Edges are anti-aliased to the target pixel and, when a cell gets smaller than
     ~3 target pixels (a reduced preview), the screen fades into the tone it stands for. One colour pass. */
  reg({
    id: 'halftone', name: 'Halftone', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      style: CH(opts([['dot', 'Dots'], ['line', 'Lines'], ['cmyk', 'CMYK dots']]), 'dot', 'Screen'),
      size: N(2, 80, 8, 0.5, 'Cell size', 'px', 'Screen frequency as cell size: 8 px is about 30 lines per 240 px.'),
      angle: ANG(45, 'Angle'),
      softness: N(0, 100, 10, 1, 'Softness'),
      ink: COL('#141414', 'Ink'),
      paper: COL('#f6f2ea', 'Paper')
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var ink = g.rgb(p.ink), paper = g.rgb(p.paper), st = p.style === 'line' ? 1 : p.style === 'cmyk' ? 2 : 0;
      g.color(NOISE + [
        'uniform vec4 $a; uniform vec4 $b; uniform vec3 $ink, $pap;',
        'uniform sampler2D $rl;',
        'float $cov(vec2 P, float ang, float D, float st){ vec2 u = $rot(P, -ang) / $a.y; vec2 f = fract(u) - 0.5; float fw = 0.75 / ($a.y * u_scale.x) + $a.w * 0.2; D = clamp(D, 0.0, 1.0);',
        '  if (st > 0.5 && st < 1.5) { float w = D * 0.5; return 1.0 - smoothstep(w - fw, w + fw, abs(f.y)); }',
        '  float r = lut1($rl, D); return 1.0 - smoothstep(r - fw, r + fw, length(f)); }',
        'vec3 $fx(vec3 c){ vec2 P = docPos(); vec3 x = clamp(c, 0.0, 1.0); vec3 o; float an = $a.z;',
        '  if ($b.x < 1.5) { float k = $cov(P, an, 1.0 - luma(x), $b.x); o = mix($pap, $ink, k); }',
        '  else { float K = 1.0 - max(x.r, max(x.g, x.b)); vec3 cmy = (1.0 - x - K) / max(1.0 - K, 1e-4);',
        '    float cc = $cov(P, an - 0.5236, cmy.r, 0.0), mm = $cov(P, an + 0.5236, cmy.g, 0.0), yy = $cov(P, an - 0.7854, cmy.b, 0.0), kk = $cov(P, an, K, 0.0);',
        '    o = $pap * vec3(1.0 - cc, 1.0 - mm, 1.0 - yy) * (1.0 - kk); }',
        '  o = mix(c, o, smoothstep(1.5, 3.0, $a.y * u_scale.x)); return mix(c, o, $a.x); }'
      ].join('\n'), { a: [p.amount / 100, p.size, p.angle * Math.PI / 180, p.softness / 100], b: [st, 0, 0, 0], ink: ink.slice(0, 3), pap: paper.slice(0, 3), rl: g.lut1d(dotRadii(), 1) });
    },
    support: GPU,
    ui: { section: 'Effects', order: 110, controls: ['amount', 'style', 'size', 'angle', 'softness', { param: 'ink', when: { style: ['dot', 'line'] } }, { param: 'paper', when: { style: ['dot', 'line'] } }] },
    agent: {
      summary: 'Printed halftone screens: round dots or lines in one ink, or four rotated CMYK dot screens, in document space so the pattern scales with the export.',
      like: 'the colour halftone and halftone pattern filters of photo editors',
      tips: ['Comic or pop-art: cmyk, size 6–10, amount 100, after a contrast boost.', 'Newspaper photo: dot, size 4–6, angle 45, ink #111, paper #f3efe6.', 'Very small cells fade into the tone at reduced previews; judge them at 100 %.'],
      example: { type: 'halftone', p: { amount: 100, style: 'dot', size: 7, angle: 45 } }
    }
  });

  /* Pixelate (mosaic): each square cell of `size` px (anchored to the layer box) shows the average of the picture under it, a
     4 × 4 grid of bilinear taps on the pyramid level where a cell is 2–4 pixels. Passes: L down + 1. */
  var MOSAIC = 'uniform sampler2D u_lv; uniform float u_cell;\nvec4 fx(){ vec2 P = docPos(); vec2 cP = (floor(P / u_cell + 1e-3) + 0.5) * u_cell; vec4 a = vec4(0.0); for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5; a += texture(u_lv, v_uv + docToUV(cP + o * u_cell - P)); } return a / 16.0; }';
  reg({
    id: 'pixelate', name: 'Pixelate', group: 'effects', version: 1, space: 'display',
    params: { size: N(1, 200, 1, 1, 'Cell size', 'px') },
    radius: function (p, scale) { var c = p.size * scale; return c > 1.01 ? Math.ceil(c + 3 * (1 << levelFor(c, 4, 6))) + 2 : 0; },
    passes: function (g, p) {
      var c = p.size * g.scale;
      if (!(c > 1.01)) return;
      var L = levelFor(c, 4, 6), lv = pyramid(g, g.source, L);
      var out = g.pass(MOSAIC, { u_lv: L ? lv[L - 1] : g.source, u_cell: p.size });
      lv.forEach(function (h) { g.release(h); });
      return out;
    },
    support: GPU,
    ui: { section: 'Effects', order: 120, controls: ['size'] },
    agent: {
      summary: 'Turns the picture (or a masked area) into square blocks of its average colour. Use for pixel-art looks or to hide a face or plate with a mask.',
      like: 'the mosaic / pixelate filter of photo editors',
      tips: ['To anonymise, mask the area (radial or face mask) and use a cell of at least 1/8 of the face width.', 'Pixel art: cell 8–16 then posterize 8–16 levels.'],
      example: { type: 'pixelate', p: { size: 12 } }
    }
  });

  reg({
    id: 'posterize', name: 'Posterize', group: 'effects', version: 1, space: 'display',
    params: { levels: N(2, 256, 256, 1, 'Levels', null, 'Tones per channel; 256 leaves the picture as it is.') },
    passes: function (g, p) {
      if (!(p.levels < 255.5)) return;
      g.color('uniform float $n; vec3 $fx(vec3 c){ return floor(clamp(c, 0.0, 1.0) * ($n - 1.0) + 0.5) / ($n - 1.0); }', { n: Math.round(p.levels) });
    },
    cpu: function (img, p) { if (!(p.levels < 255.5)) return; var n = Math.round(p.levels) - 1, d = img.data; for (var i = 0; i < d.length; i += 4) for (var k = 0; k < 3; k++) d[i + k] = Math.round(Math.round(d[i + k] / 255 * n) / n * 255); },
    support: GPU,
    ui: { section: 'Effects', order: 130, controls: ['levels'] },
    agent: {
      summary: 'Reduces each colour channel to a few tones, for poster and screen-print looks.',
      like: 'the posterize adjustment of photo editors',
      tips: ['4–6 levels for a screen-print look; follow surface-blur or oil-paint first so the flats are clean.'],
      example: { type: 'posterize', p: { levels: 5 } }
    }
  });

  reg({
    id: 'threshold', name: 'Threshold', group: 'effects', version: 1, space: 'display',
    params: { amount: N(0, 100, 0, 1, 'Amount'), level: N(0, 1, 0.5, 0.005, 'Level'), softness: N(0, 0.5, 0.01, 0.005, 'Softness') },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      g.color('uniform vec3 $a; vec3 $fx(vec3 c){ float v = smoothstep($a.y - $a.z, $a.y + $a.z + 1e-4, luma(clamp(c, 0.0, 1.0))); return mix(c, vec3(v), $a.x); }', { a: [p.amount / 100, p.level, p.softness] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 140, controls: ['amount', 'level', 'softness'] },
    agent: {
      summary: 'Black and white only: pixels brighter than the level become white, the rest black (with an optional soft edge).',
      like: 'the threshold adjustment of photo editors',
      tips: ['Use LE.fx.analyze median luminance as the level for a balanced result.', 'With duotone after it, it becomes a two-colour stencil.'],
      example: { type: 'threshold', p: { amount: 100, level: 0.5 } }
    }
  });

  /* Glitch: horizontal bands of the picture displaced sideways (two band scales, seeded per band in document space), an RGB split
     along an angle, and scan lines (a cosine of period 3 document pixels, faded out when they get finer than a target pixel). One pass. */
  var GLITCH = 'uniform vec4 u_a; uniform vec4 u_b;\nvec4 fx(){ vec2 P = docPos(); float s = u_b.y; float row = floor(P.y / u_b.x + 1e-3), row2 = floor(P.y / (u_b.x * 3.0) + 1e-3); float sh = 0.0;\n' +
    '  if (docNoise(vec2(row, 3.0), s) < u_a.w * 0.45) sh += (docNoise(vec2(row, 5.0), s) - 0.5) * 2.0 * u_b.z;\n' +
    '  if (docNoise(vec2(row2, 7.0), s) < u_a.w * 0.3) sh += (docNoise(vec2(row2, 9.0), s) - 0.5) * u_b.z;\n' +
    '  vec2 base = vec2(sh, 0.0), dir = vec2(cos(u_a.y), -sin(u_a.y)) * u_a.x; vec4 g = texture(u_src, v_uv + docToUV(base));\n' +
    '  vec3 c = vec3(texture(u_src, v_uv + docToUV(base - dir)).r, g.g, texture(u_src, v_uv + docToUV(base + dir)).b);\n' +
    '  float sc = u_a.z * 0.45 * (0.5 + 0.5 * cos(2.0943951 * P.y)) * smoothstep(0.6, 1.2, 3.0 * u_scale.y); return vec4(c * (1.0 - sc), g.a); }';
  reg({
    id: 'glitch', name: 'Glitch', group: 'effects', version: 1, space: 'linear',
    params: {
      split: N(0, 60, 0, 0.5, 'RGB split', 'px'),
      angle: ANG(0, 'Split angle'),
      blocks: N(0, 100, 0, 1, 'Block displacement'),
      blockSize: N(2, 200, 18, 1, 'Block height', 'px'),
      scanlines: N(0, 100, 0, 1, 'Scan lines'),
      seed: SEED()
    },
    radius: function (p, scale) { return p.split || p.blocks || p.scanlines ? Math.ceil((p.split + (p.blocks ? p.blockSize * 4.5 : 0)) * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.split > 0 || p.blocks > 0 || p.scanlines > 0)) return;
      return g.pass(GLITCH, { u_a: [p.split, p.angle * Math.PI / 180, p.scanlines / 100, p.blocks / 100], u_b: [p.blockSize, seedOf(p), p.blockSize * 3, 0] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 150, controls: ['split', 'angle', 'blocks', 'blockSize', 'scanlines', 'seed'] },
    agent: {
      summary: 'Digital glitch: sideways-displaced bands, an RGB channel split and scan lines. Seeded, so a look can be reproduced exactly.',
      like: 'glitch and VHS effects of photo and video apps',
      tips: ['Subtle: split 3–5, scan lines 30. Heavy: blocks 40–70, block height 10–30, split 8.', 'Change seed to move the displaced bands.'],
      example: { type: 'glitch', p: { split: 5, blocks: 35, blockSize: 16, scanlines: 30, seed: 9 } }
    }
  });

  reg({
    id: 'emboss', name: 'Emboss', group: 'effects', version: 1, space: 'display',
    params: { amount: N(0, 100, 0, 1, 'Amount'), angle: ANG(135, 'Angle'), height: N(0.5, 20, 2, 0.1, 'Height', 'px'), strength: N(10, 500, 100, 1, 'Strength', '%'), color: BOOL(false, 'Keep colour') },
    radius: function (p, scale) { return p.amount > 0 ? Math.ceil(p.height * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      return g.pass('uniform vec4 u_a; uniform float u_keep;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); vec2 d = docToUV(vec2(cos(u_a.y), sin(u_a.y)) * u_a.z); float e = (luma(unpremul(texture(u_src, v_uv - d))) - luma(unpremul(texture(u_src, v_uv + d)))) * u_a.w; vec3 o = u_keep > 0.5 ? c + e : vec3(0.5 + e); return vec4(mix(c, o, u_a.x) * s.a, s.a); }',
        { u_a: [p.amount / 100, p.angle * Math.PI / 180, p.height, p.strength / 100 * 1.5], u_keep: p.color ? 1 : 0 });
    },
    support: GPU,
    ui: { section: 'Effects', order: 160, controls: ['amount', 'angle', 'height', 'strength', 'color'] },
    agent: {
      summary: 'Relief: edges become raised or sunken as if lit from the angle, on grey or on the picture\'s own colours.',
      like: 'the emboss filter of photo editors (angle, height, amount)',
      tips: ['Stamped metal: amount 100, height 2, strength 150, grey. A subtle relief on the photo: keep colour, amount 40.'],
      example: { type: 'emboss', p: { amount: 100, angle: 135, height: 2, strength: 120 } }
    }
  });

  /* Edge glow: Sobel edges of the slightly blurred picture, coloured with the picture's own hue and brightened, on black. */
  var EDGEG = 'uniform sampler2D u_bl; uniform vec4 u_a;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); vec2 ex = docToUV(vec2(u_a.y, 0.0)), ey = docToUV(vec2(0.0, u_a.y));\n' +
    '  float tl = luma(unpremul(texture(u_bl, v_uv - ex - ey))), t = luma(unpremul(texture(u_bl, v_uv - ey))), tr = luma(unpremul(texture(u_bl, v_uv + ex - ey))), l = luma(unpremul(texture(u_bl, v_uv - ex))), r = luma(unpremul(texture(u_bl, v_uv + ex))), bl = luma(unpremul(texture(u_bl, v_uv - ex + ey))), b = luma(unpremul(texture(u_bl, v_uv + ey))), br = luma(unpremul(texture(u_bl, v_uv + ex + ey)));\n' +
    '  float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl, gy = bl + 2.0 * b + br - tl - 2.0 * t - tr; float e = clamp(length(vec2(gx, gy)) * u_a.z, 0.0, 1.0);\n' +
    '  vec3 h = unpremul(texture(u_bl, v_uv)); h = h / max(max(h.r, max(h.g, h.b)), 1e-3); return vec4(mix(c, h * e, u_a.x) * s.a, s.a); }';
  reg({
    id: 'edge-glow', name: 'Glowing edges', group: 'effects', version: 1, space: 'display',
    params: { amount: N(0, 100, 0, 1, 'Amount'), width: N(0.5, 10, 1.5, 0.1, 'Edge width', 'px'), brightness: N(0, 100, 50, 1, 'Edge brightness'), smoothness: N(0, 10, 1, 0.1, 'Smoothness', 'px') },
    radius: function (p, scale) { return p.amount > 0 ? Math.ceil(p.width * scale) + M.blurReach(p.smoothness * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var bl = p.smoothness > 0 ? g.blur(p.smoothness) : g.source, out = g.pass(EDGEG, { u_bl: bl, u_a: [p.amount / 100, p.width, 1 + p.brightness / 100 * 6, 0] });
      if (bl !== g.source) g.release(bl);
      return out;
    },
    support: GPU,
    ui: { section: 'Effects', order: 170, controls: ['amount', 'width', 'brightness', 'smoothness'] },
    agent: {
      summary: 'Neon outlines: the picture\'s edges glow in their own colours on black.',
      like: 'the glowing edges filter of photo editors',
      tips: ['Follow with glow (threshold 0.3) for a neon-sign look.', 'Raise smoothness on noisy photos so only real edges light up.'],
      example: { type: 'edge-glow', p: { amount: 100, width: 1.5, brightness: 60 } }
    }
  });

  /* Oil paint: a generalised Kuwahara filter (Papari, Petkov, Campisi 2007) with 8 overlapping sectors, smooth sector weights
     (cos⁴ of the angle to each sector's axis, from dot products; Gaussian in radius), and the sector means weighted by
     (σ_k / σ_min)^−q, so each pixel takes the colour of its most uniform neighbourhood: flat brush-like patches with sharp edges.
     Up to 11 × 11 taps spaced at most 1.25 target pixels apart (7 × 7 while dragging), strided beyond. One pass. */
  var KUWA = 'uniform float u_r, u_q; uniform int u_n;\nconst vec2 E[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071068, 0.7071068), vec2(0.0, 1.0), vec2(-0.7071068, 0.7071068), vec2(-1.0, 0.0), vec2(-0.7071068, -0.7071068), vec2(0.0, -1.0), vec2(0.7071068, -0.7071068));\n' +
    'vec4 fx(){ vec3 m[8]; vec3 s[8]; float w[8]; for (int k = 0; k < 8; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); w[k] = 0.0; }\n' +
    '  float a0 = src(v_uv).a;\n' +
    '  for (int j = -5; j <= 5; j++) for (int i = -5; i <= 5; i++) { if (abs(i) > u_n || abs(j) > u_n) continue; vec2 o = vec2(float(i), float(j)) / float(u_n); float rr = dot(o, o); if (rr > 1.0) continue;\n' +
    '    vec3 c = unpremul(texture(u_src, v_uv + docToUV(o * u_r))); float gw = exp(-rr * 2.0); vec3 cg = c * gw, ccg = c * c * gw; vec2 dir = rr > 1e-6 ? o * inversesqrt(rr) : vec2(0.0);\n' +
    '    for (int k = 0; k < 8; k++) { float ck = rr > 1e-6 ? max(dot(dir, E[k]), 0.0) : 0.5; if (ck <= 0.0) continue; ck *= ck; ck *= ck; m[k] += cg * ck; s[k] += ccg * ck; w[k] += gw * ck; } }\n' +
    '  float sd[8]; float mn = 1e9; for (int k = 0; k < 8; k++) { vec3 mu = m[k] / max(w[k], 1e-6); vec3 v = max(s[k] / max(w[k], 1e-6) - mu * mu, 0.0); sd[k] = sqrt(v.r + v.g + v.b) + 1e-3; mn = min(mn, sd[k]); }\n' +
    '  vec3 acc = vec3(0.0); float ws = 0.0; for (int k = 0; k < 8; k++) { float a = pow(mn / sd[k], u_q); acc += m[k] / max(w[k], 1e-6) * a; ws += a; }\n' +
    '  return vec4(acc / ws * a0, a0); }';
  reg({
    id: 'oil-paint', name: 'Oil paint', group: 'effects', version: 1, space: 'display',
    params: { radius: N(0, 30, 0, 0.5, 'Brush size', 'px'), sharpness: N(0, 100, 60, 1, 'Sharpness') },
    radius: function (p, scale) { return p.radius * scale > 0.75 ? Math.ceil(p.radius * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.radius * g.scale > 0.75)) return;
      return g.pass(KUWA, { u_r: p.radius, u_q: 2 + p.sharpness / 100 * 14, u_n: Math.min(g.draft ? 3 : 5, Math.max(1, Math.ceil(p.radius * g.scale / 1.25))) });
    },
    support: GPU_MID,
    ui: { section: 'Effects', order: 180, controls: ['radius', 'sharpness'] },
    agent: {
      summary: 'A painterly look: flat, brush-like patches of colour with crisp edges (a generalised Kuwahara filter).',
      like: 'oil paint and painterly filters of photo editors',
      tips: ['Brush size 3–6 on a 1,000–2,000 px picture; follow with texture-overlay (canvas) and a little clarity for a painting.', 'Higher sharpness keeps edges crisper.'],
      example: { type: 'oil-paint', p: { radius: 5, sharpness: 60 } }
    }
  });

  /* Sketch: the classic pencil sketch: grey / Gaussian(grey) (a colour dodge of the grey picture with its blurred negative) so only
     edges and texture stay dark, with darkness as a gamma and optional colour pencil. Passes: blur + 1. */
  var SKETCH = 'uniform sampler2D u_bl; uniform vec3 u_a;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float g = luma(clamp(c, 0.0, 1.0)), gb = luma(clamp(unpremul(texture(u_bl, v_uv)), 0.0, 1.0)); float k = pow(clamp(g / max(gb, 1e-3), 0.0, 1.0), u_a.y); vec3 o = mix(vec3(k), clamp(c / max(g, 1e-3), 0.0, 1.5) * k * 0.9 + 0.1 * k, u_a.z); return vec4(mix(c, o, u_a.x) * s.a, s.a); }';
  reg({
    id: 'sketch', name: 'Sketch', group: 'effects', version: 1, space: 'display',
    params: { amount: N(0, 100, 0, 1, 'Amount'), radius: N(0.5, 30, 4, 0.1, 'Stroke width', 'px'), darkness: N(0, 100, 40, 1, 'Darkness'), color: N(0, 100, 0, 1, 'Colour pencil') },
    radius: function (p, scale) { return p.amount > 0 ? M.blurReach(p.radius * scale) : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var bl = g.blur(p.radius), out = g.pass(SKETCH, { u_bl: bl, u_a: [p.amount / 100, 1 + p.darkness / 100 * 5, p.color / 100] });
      g.release(bl);
      return out;
    },
    support: GPU,
    ui: { section: 'Effects', order: 190, controls: ['amount', 'radius', 'darkness', 'color'] },
    agent: {
      summary: 'Turns the photo into a pencil sketch: dark strokes where edges and texture are, white elsewhere; optionally coloured pencil.',
      like: 'sketch and photocopy filters of photo editors',
      tips: ['Add texture-overlay (paper) after it for a drawing on paper.', 'Stroke width 2–5 for fine lines; 10+ for charcoal.'],
      example: { type: 'sketch', p: { amount: 100, radius: 4, darkness: 45 } }
    }
  });

  /* Texture overlay: procedural paper (fibres over a soft fBm), canvas (an over-under weave) or concrete (blotches and pits) as a
     height field in document space, lit from `angle` (normals from finite differences of the same function), applied with soft
     light. Generated, so no third-party images. One colour pass. */
  reg({
    id: 'texture-overlay', name: 'Texture overlay', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      style: CH(opts([['paper', 'Paper'], ['canvas', 'Canvas'], ['concrete', 'Concrete']]), 'paper', 'Texture'),
      scale: N(0.25, 4, 1, 0.01, 'Scale'),
      relief: N(0, 100, 50, 1, 'Relief'),
      angle: ANG(135, 'Light angle'),
      seed: SEED()
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var st = p.style === 'canvas' ? 1 : p.style === 'concrete' ? 2 : 0, a = p.angle * Math.PI / 180;
      g.color(NOISE + [
        'uniform vec4 $a; uniform vec4 $b;',
        'float $h(vec2 P){ float s = $b.x; vec2 q = P / $a.y;',
        '  if ($b.y < 0.5) { float f1 = $vn($rot(q, 0.6) * vec2(0.3, 0.025), s + 3.0), f2 = $vn($rot(q, -0.9) * vec2(0.3, 0.025), s + 4.0); return 0.55 * $fbm(q / 60.0, s, 4) + 0.3 * $fbm(q / 7.0, s + 1.0, 2) + 0.12 * (smoothstep(0.75, 0.95, f1) + smoothstep(0.75, 0.95, f2)); }',
        '  if ($b.y < 1.5) { vec2 u = q / 6.0; vec2 f = fract(u); float over = mod(floor(u.x) + floor(u.y), 2.0); float wx = pow(sin(3.14159 * f.y), 0.7), wy = pow(sin(3.14159 * f.x), 0.7); return mix(wx, wy, over) * 0.6 + 0.25 * $fbm(q / 25.0, s, 3) + 0.15 * $vn(q / 1.5, s + 2.0); }',
        '  return 0.6 * $fbm(q / 110.0, s, 5) - 0.35 * smoothstep(0.78, 0.86, $vn(q / 5.0, s + 5.0)) + 0.2 * $vn(q / 1.7, s + 6.0) + 0.2; }',
        'vec3 $fx(vec3 c){ vec2 P = docPos(); float e = 0.8 * $a.y; float h = $h(P), hx = $h(P + vec2(e, 0.0)) - h, hy = $h(P + vec2(0.0, e)) - h;',
        '  vec3 n = normalize(vec3(-hx * $a.z * 6.0, -hy * $a.z * 6.0, 1.0)); vec3 L = normalize(vec3($b.z, $b.w, 1.0)); float sh = dot(n, L) / L.z;',
        '  float v = clamp(0.5 + (sh - 1.0) * 0.8 + (h - 0.5) * 0.25 * $a.z, 0.0, 1.0); vec3 b = clamp(c, 0.0, 1.0);',
        '  vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25))); vec3 o = mix(b - (1.0 - 2.0 * v) * b * (1.0 - b), b + (2.0 * v - 1.0) * (d - b), step(0.5, v));',
        '  return mix(c, o, $a.x); }'
      ].join('\n'), { a: [p.amount / 100, p.scale, p.relief / 100, 0], b: [seedOf(p), st, Math.cos(a), -Math.sin(a)] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 200, controls: ['amount', 'style', 'scale', 'relief', 'angle', 'seed'] },
    agent: {
      summary: 'A generated surface texture (paper, canvas or concrete) lit from an angle and soft-light blended over the picture, so it looks printed or painted on that surface.',
      like: 'texture overlays and the texturizer filter of photo editors, generated instead of photographed',
      tips: ['After oil-paint: canvas, amount 50–70. After sketch: paper, amount 60.', 'scale changes the grain of the surface; relief its depth.'],
      example: { type: 'texture-overlay', p: { amount: 60, style: 'paper', relief: 50 } }
    }
  });

  /* Frosted glass: each pixel averages 4 taps scattered by up to `amount` px, the scatter drawn per document-space cell from the
     seed, as light through ground glass. One pass. */
  var FROST = 'uniform vec3 u_a; uniform int u_n;\nvec4 fx(){ vec2 P = docPos(); vec4 a = vec4(0.0); for (int i = 0; i < 4; i++) { if (i >= u_n) break; vec2 cell = floor(P / u_a.y + 1e-3); float s = u_a.z + float(i) * 7.0; vec2 r = vec2(docNoise(cell, s), docNoise(cell, s + 3.0)) * 2.0 - 1.0; a += texture(u_src, v_uv + docToUV(r * u_a.x)); } return a / float(u_n); }';
  reg({
    id: 'frosted-glass', name: 'Frosted glass', group: 'effects', version: 1, space: 'linear',
    params: { amount: N(0, 50, 0, 0.1, 'Scatter', 'px'), grain: N(0.5, 10, 1, 0.1, 'Grain', 'px'), seed: SEED() },
    radius: function (p, scale) { return p.amount > 0 ? Math.ceil(p.amount * 1.42 * scale) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.amount * g.scale > 0.3)) return;
      return g.pass(FROST, { u_a: [p.amount, p.grain, seedOf(p)], u_n: g.draft ? 2 : 4 });
    },
    support: GPU,
    ui: { section: 'Effects', order: 210, controls: ['amount', 'grain', 'seed'] },
    agent: {
      summary: 'Looks through ground glass: pixels are scattered randomly by up to the given distance (seeded).',
      like: 'the diffuse glass and frosted glass filters of photo editors',
      tips: ['Background for text: scatter 8–15 on a masked area; combine with gaussian-blur 2 for a smoother frost.'],
      example: { type: 'frosted-glass', p: { amount: 8, grain: 1.5 } }
    }
  });

  /* Sun beams (god rays): bright areas (knee threshold, half resolution) are smeared towards the light point with decaying
     weights (1–3 one-sided comb passes in the radial coordinate, the screen-space light-scattering approximation of crepuscular
     rays), tinted and added in linear light, so rays appear where light passes between darker shapes. Passes: 1 + 1–3 + 1. */
  var RAYS = 'uniform vec2 u_L; uniform float u_s, u_d; uniform int u_n;\nvec4 fx(){ vec2 P = docPos(); vec4 a = vec4(0.0); float ws = 0.0; for (int i = 0; i < 16; i++) { if (i >= u_n) break; float w = exp(-u_d * float(i) / float(u_n)); a += texture(u_src, v_uv + docToUV((u_L - P) * float(i) * u_s)) * w; ws += w; } return a / ws; }';
  reg({
    id: 'sun-rays', name: 'Sun rays', group: 'effects', version: 1, space: 'linear',
    params: { amount: N(0, 100, 0, 1, 'Amount'), position: PT(0.5, 0.15, 'Light position'), threshold: N(0, 1, 0.7, 0.01, 'Threshold'), length: N(5, 100, 50, 1, 'Length'), color: COL('#fff0d2', 'Tint') },
    radius: function (p, scale, box) { return p.amount > 0 ? Math.ceil(p.length / 100 * farCorner(box && box.w ? box : REACH_BOX, p.position) * scale) + 4 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var th = lin(p.threshold), pre = g.pass(PREFILTER, { u_th: [th, Math.max(th * 0.4, 0.01)] }, { scale: 0.5 });
      var len = p.length / 100, Lt = len * farCorner(g.box, p.position) * g.scale, k = combPasses(Lt), n = 10, cur = pre, Lp = [p.position.x * g.box.w, p.position.y * g.box.h];
      if (g.draft && k > 1) k--;
      for (var j = 0; j < k; j++) {
        var out = g.pass(RAYS, { u_src: cur, u_L: Lp, u_s: len / Math.pow(n, j + 1), u_d: 2.2, u_n: n }, { scale: 0.5 });
        g.release(cur); cur = out;
      }
      var t = g.rgb(p.color), kk = p.amount / 100 * 4.5, res = g.pass(ADDGLOW, { u_glow: cur, u_t: [t[0] * kk, t[1] * kk, t[2] * kk] });
      g.release(cur);
      return res;
    },
    support: GPU_MID,
    ui: { section: 'Effects', order: 220, controls: ['amount', 'position', 'threshold', 'length', 'color'] },
    agent: {
      summary: 'God rays: light from a point streams through the bright gaps of the picture (trees, windows, clouds) as visible beams.',
      like: 'sun-ray and light-ray plug-ins of photo and compositing tools',
      tips: ['Put position on the sun or the brightest gap; threshold 0.6–0.8 so only the sky and openings feed the rays.', 'Pair with haze (amount 15–25) for atmosphere and with sun-glow at the same position.'],
      example: { type: 'sun-rays', p: { amount: 50, position: { x: 0.6, y: 0.1 }, threshold: 0.7, length: 60 } }
    }
  });

  /* =====================================================================================================================
     5. Atmosphere
     ===================================================================================================================== */

  /* Haze and fog: Koschmieder's law in linear light, I' = I·t + A·(1 − t), t = exp(−β·d). Distance d is 1 everywhere (flat), a
     vertical ramp from the bottom of the frame to the horizon (gradient), or the layer's depth map mapped from near…far (depth;
     neutral where the map is missing). β = 2·amount. Flat and gradient: one colour pass; depth: 2 depth (mask) passes + 1. */
  var HAZE_D = DEPTH_GLSL + 'uniform sampler2D u_dmap, u_miss; uniform vec4 u_a; uniform vec3 u_A;\nvec4 fx(){ vec4 s = src(v_uv); vec3 c = unpremul(s); float d = clamp((depthAt(u_dmap, v_uv) - u_a.y) / max(u_a.z - u_a.y, 1e-3), 0.0, 1.0); d *= 1.0 - step(0.5, texture(u_miss, clamp(v_uv, u_img.xy + 0.5 * u_texel, u_img.zw - 0.5 * u_texel)).r); float t = exp(-u_a.x * d); return vec4((c * t + u_A * (1.0 - t)) * s.a, s.a); }';
  CR.hazePixel = function (c, A, beta, d) { var t = Math.exp(-beta * d); return c.map(function (v, i) { return v * t + A[i] * (1 - t); }); };
  reg({
    id: 'haze', name: 'Haze and fog', group: 'effects', version: 1, space: 'linear', needs: ['depth'],
    params: {
      amount: N(0, 100, 0, 1, 'Density'),
      color: COL('#c9d2da', 'Colour'),
      source: CH(opts([['flat', 'Even'], ['gradient', 'Towards the horizon'], ['depth', 'Depth map']]), 'gradient', 'Distance'),
      horizon: N(0, 1, 0.4, 0.005, 'Horizon', null, 'Gradient: where the fog is densest (fraction of the height from the top).'),
      softness: N(0, 100, 40, 1, 'Fall-off'),
      near: N(0, 1, 0, 0.005, 'Near', null, 'Depth map: depth where the fog starts.'),
      far: N(0, 1, 1, 0.005, 'Far', null, 'Depth map: depth of full density.')
    },
    radius: function () { return 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var A = g.rgb(p.color).slice(0, 3), beta = p.amount / 100 * 2;
      if (p.source === 'depth') {
        var dm = g.mask(DEPTH_DEF), miss = g.mask(DEPTH_MISSING), out = g.pass(HAZE_D, { u_dmap: dm, u_miss: miss, u_a: [beta, p.near, p.far, 0], u_A: A });
        g.release(dm); g.release(miss);
        return out;
      }
      g.color('uniform vec4 $a; uniform vec3 $A; vec3 $fx(vec3 c){ float d = 1.0; if ($a.y > 0.5) { float y = boxUV().y; d = pow(clamp((1.0 - y) / max(1.0 - $a.z, 1e-3), 0.0, 1.0), 0.5 + $a.w * 2.5); } float t = exp(-$a.x * d); return c * t + $A * (1.0 - t); }',
        { a: [beta, p.source === 'gradient' ? 1 : 0, p.horizon, p.softness / 100], A: A });
    },
    support: GPU,
    ui: { section: 'Effects', order: 230, controls: ['amount', 'color', 'source', { param: 'horizon', when: { source: 'gradient' } }, { param: 'softness', when: { source: 'gradient' } }, { param: 'near', when: { source: 'depth' } }, { param: 'far', when: { source: 'depth' } }] },
    agent: {
      summary: 'Atmospheric haze or fog with the physical exponential law: farther parts fade towards the fog colour. Distance comes from the depth map, a ramp towards the horizon, or is even.',
      like: 'fog and haze filters, and the "add haze" direction of dehaze',
      tips: ['With a depth map (source depth) the fog follows the scene: amount 30–60, near 0.2, far 1.', 'Landscape without a map: gradient, horizon at the real horizon line, amount 25–40.', 'Match the fog colour to the sky near the horizon (sample it with LE.fx.analyze region).'],
      example: { type: 'haze', p: { amount: 35, source: 'gradient', horizon: 0.4, color: '#cfd8e2' } }
    }
  });

  reg({
    id: 'color-wash', name: 'Colour wash', group: 'effects', version: 1, space: 'display',
    params: {
      amount: N(0, 100, 0, 1, 'Amount'),
      color: COL('#ff9a5c', 'Colour'),
      color2: COL('#3a6cff', 'Second colour'),
      style: CH(opts([['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']]), 'solid', 'Fill'),
      start: PT(0.5, 0, 'Start'),
      end: PT(0.5, 1, 'End'),
      mode: CH(opts([['soft-light', 'Soft light'], ['overlay', 'Overlay'], ['color', 'Colour'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['normal', 'Normal']]), 'soft-light', 'Blend')
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var st = p.style === 'linear' ? 1 : p.style === 'radial' ? 2 : 0, md = ['soft-light', 'overlay', 'color', 'screen', 'multiply', 'normal'].indexOf(p.mode);
      g.color([
        'uniform vec3 $c1, $c2; uniform vec4 $se; uniform vec3 $a;',
        'vec3 $fx(vec3 c){ vec2 b = boxUV(), s = $se.xy, e = $se.zw; float t = 0.0;',
        '  if ($a.y > 1.5) { vec2 k = u_box; t = clamp(length((b - s) * k) / max(length((e - s) * k), 1e-4), 0.0, 1.0); } else if ($a.y > 0.5) { vec2 d = e - s; t = clamp(dot(b - s, d) / max(dot(d, d), 1e-6), 0.0, 1.0); }',
        '  vec3 w = mix($c1, $c2, t), x = clamp(c, 0.0, 1.0), o; float m = $a.z;',
        '  if (m < 0.5) { vec3 d = mix(sqrt(x), ((16.0 * x - 12.0) * x + 4.0) * x, step(x, vec3(0.25))); o = mix(x - (1.0 - 2.0 * w) * x * (1.0 - x), x + (2.0 * w - 1.0) * (d - x), step(vec3(0.5), w)); }',
        '  else if (m < 1.5) o = mix(2.0 * x * w, 1.0 - 2.0 * (1.0 - x) * (1.0 - w), step(vec3(0.5), x));',
        '  else if (m < 2.5) { float l = dot(x, vec3(0.3, 0.59, 0.11)); o = clamp(w + (l - dot(w, vec3(0.3, 0.59, 0.11))), 0.0, 1.0); }',
        '  else if (m < 3.5) o = 1.0 - (1.0 - x) * (1.0 - w); else if (m < 4.5) o = x * w; else o = w;',
        '  return mix(c, o, $a.x); }'
      ].join('\n'), { c1: g.rgb(p.color).slice(0, 3), c2: g.rgb(p.color2).slice(0, 3), se: [p.start.x, p.start.y, p.end.x, p.end.y], a: [p.amount / 100, st, md] });
    },
    support: GPU,
    ui: { section: 'Effects', order: 240, controls: ['amount', 'color', 'style', { param: 'color2', when: { style: ['linear', 'radial'] } }, { param: 'start', when: { style: ['linear', 'radial'] } }, { param: 'end', when: { style: ['linear', 'radial'] } }, 'mode'] },
    agent: {
      summary: 'A colour (or two-colour gradient) laid over the picture with a blend mode: warm or cool washes, sunset gradients, brand-colour tints.',
      like: 'a solid-colour or gradient fill layer with a blend mode in photo editors',
      tips: ['Golden-hour warmth: color #ff9a5c, soft light, amount 30.', 'Sunset sky: linear from start (0.5, 0) orange to end (0.5, 0.6) violet, soft light, amount 40, masked to the sky.', 'mode color recolours while keeping luminance.'],
      example: { type: 'color-wash', p: { amount: 30, color: '#ff9a5c', mode: 'soft-light' } }
    }
  });

  /* Sun glow: a positioned warm glow (a Gaussian core plus a 1/(1 + r²) wing, in short-side units) added in linear light, with a
     veiling-glare term that lifts and tints the picture around the sun. One colour pass. */
  reg({
    id: 'sun-glow', name: 'Sun glow', group: 'effects', version: 1, space: 'linear',
    params: { amount: N(0, 100, 0, 1, 'Amount'), position: PT(0.75, 0.2, 'Position'), size: N(0.05, 2, 0.5, 0.01, 'Size'), color: COL('#ffb35c', 'Colour'), veil: N(0, 100, 40, 1, 'Veil', null, 'How much the glow washes out contrast around the sun.') },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var sh = Math.min(g.box.w, g.box.h);
      g.color(NOISE + 'uniform vec4 $a; uniform vec3 $c; uniform float $v; vec3 $fx(vec3 c){ float r = length($asp() - $a.xy) / $a.z; float gl = exp(-r * r * 3.0) * 0.6 + 0.4 / (1.0 + r * r * 30.0); vec3 o = c + $c * gl * $a.w; return mix(o, max(o, $c * 0.9), clamp(gl * $v * $a.w * 2.0, 0.0, 1.0)); }',
        { a: [p.position.x * g.box.w / sh, p.position.y * g.box.h / sh, p.size, p.amount / 100 * 1.2], c: g.rgb(p.color).slice(0, 3), v: p.veil / 100 * 0.5 });
    },
    support: GPU,
    ui: { section: 'Effects', order: 250, controls: ['amount', 'position', 'size', 'color', 'veil'] },
    agent: {
      summary: 'A warm glow around a point (the sun, a lamp) with veiling glare that softens contrast near it, added in linear light.',
      like: 'the sun-glow / light-source glow of photo and compositing tools',
      tips: ['Golden hour: position on the sun, size 0.4–0.7, amount 40–60, colour #ffb35c.', 'Combine with sun-rays and lens-flare at the same position for a backlit scene.'],
      example: { type: 'sun-glow', p: { amount: 50, position: { x: 0.8, y: 0.15 }, size: 0.5 } }
    }
  });

  /* =====================================================================================================================
     Named looks: plain data. Each is an ordered list of fx entries (this pack plus the starter effects) an agent can append to a
     layer's stack with fx.add, or put on an adjustment layer with adjust.add, then tune. Order follows the usual pipeline:
     colour and tone first, then optics and blur, then light effects, then texture and grain last.
     ===================================================================================================================== */
  CR.presets = {
    '35mm-print': { name: '35 mm print', summary: 'Colour negative printed on paper: gentle contrast, lifted warm blacks, halation on highlights, fine grain.', fx: [
      { type: 'contrast', p: { amount: 12 } },
      { type: 'cross-process', p: { preset: 'warm-fade', amount: 35 } },
      { type: 'fade', p: { amount: 45, black: '#211b16', whites: 0.96, desaturate: 8 } },
      { type: 'halation', p: { amount: 28, threshold: 0.78, radius: 10 } },
      { type: 'vignette', p: { amount: -15, midpoint: 45, feather: 70 } },
      { type: 'film-grain', p: { amount: 28, size: 1.2, roughness: 55, color: 18, seed: 35 } }
    ] },
    'dreamy-portrait': { name: 'Dreamy portrait', summary: 'Soft diffusion, glowing highlights, smoothed skin texture, a pale airy finish.', fx: [
      { type: 'texture', p: { amount: -25 } },
      { type: 'soft-focus', p: { amount: 30, style: 'diffusion', radius: 18 } },
      { type: 'bloom', p: { amount: 22, threshold: 0.75, radius: 90, knee: 0.7 } },
      { type: 'fade', p: { amount: 25, black: '#2b2526', whites: 0.98, desaturate: 10 } },
      { type: 'vignette', p: { amount: 12, style: 'color', midpoint: 40, feather: 80 } },
      { type: 'film-grain', p: { amount: 10, size: 1.0 } }
    ] },
    'night-neon': { name: 'Night neon', summary: 'City lights that bloom, streak and fringe, with cool shadows and grain.', fx: [
      { type: 'curves', p: { curve: { master: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]], b: [[0, 0.06], [1, 1]] } } },
      { type: 'bloom', p: { amount: 45, threshold: 0.65, radius: 120 } },
      { type: 'halation', p: { amount: 30, threshold: 0.7, radius: 14, color: '#ff2a6d' } },
      { type: 'anamorphic-streaks', p: { amount: 35, threshold: 0.8, length: 800 } },
      { type: 'chromatic-aberration', p: { redCyan: 18, blueYellow: -8 } },
      { type: 'film-grain', p: { amount: 25, size: 1.4, color: 25, seed: 12 } }
    ] },
    'product-pop': { name: 'Product pop', summary: 'Crisp, clean commercial finish: clarity and texture, output sharpening, a gentle edge falloff.', fx: [
      { type: 'dehaze', p: { amount: 8 } },
      { type: 'clarity', p: { amount: 22, radius: 30 } },
      { type: 'texture', p: { amount: 25 } },
      { type: 'saturation', p: { vibrance: 15 } },
      { type: 'vignette', p: { amount: -10, midpoint: 55, feather: 80, highlights: 40 } },
      { type: 'sharpen', p: { amount: 70, radius: 0.8, masking: 30 } }
    ] },
    'faded-summer': { name: 'Faded summer', summary: 'Warm, washed-out holiday print with a light leak from the edge.', fx: [
      { type: 'cross-process', p: { preset: 'warm-fade', amount: 70 } },
      { type: 'fade', p: { amount: 50, black: '#2e2219', whites: 0.95, desaturate: 12 } },
      { type: 'light-leak', p: { amount: 35, position: { x: 1.02, y: 0.3 }, size: 0.8, seed: 5 } },
      { type: 'film-grain', p: { amount: 18, size: 1.3 } }
    ] },
    'cinematic-anamorphic': { name: 'Cinematic anamorphic', summary: 'Teal-and-orange grade, anamorphic streaks and flare, a darker frame edge.', fx: [
      { type: 'cross-process', p: { preset: 'teal-orange', amount: 60 } },
      { type: 'anamorphic-streaks', p: { amount: 40, threshold: 0.78, length: 1000 } },
      { type: 'lens-flare', p: { amount: 25, position: { x: 0.2, y: 0.3 }, ghosts: 45, starburst: 20, streak: 40, seed: 3 } },
      { type: 'vignette', p: { amount: -28, midpoint: 40, roundness: -30, feather: 60 } },
      { type: 'film-grain', p: { amount: 15, size: 1.1 } }
    ] },
    'vintage-damaged': { name: 'Vintage damaged print', summary: 'An old, handled print: faded, burnt at one corner, dusty and scratched.', fx: [
      { type: 'cross-process', p: { preset: 'bleach', amount: 30 } },
      { type: 'fade', p: { amount: 55, black: '#2a2118', whites: 0.9, desaturate: 35 } },
      { type: 'light-leak', p: { amount: 30, style: 'burn', position: { x: -0.02, y: 0.05 }, size: 0.5, seed: 8 } },
      { type: 'vignette', p: { amount: -35, style: 'paint', color: '#2a1d12', midpoint: 35, roundness: -20, feather: 70 } },
      { type: 'film-grain', p: { amount: 45, size: 1.8, roughness: 70 } },
      { type: 'dust-scratches', p: { amount: 65, dust: 45, hairs: 25, scratches: 35, polarity: 'dark', seed: 4 } }
    ] },
    'misty-morning': { name: 'Misty morning', summary: 'Soft fog towards the horizon, a low warm sun and a glow.', fx: [
      { type: 'haze', p: { amount: 28, source: 'gradient', horizon: 0.45, color: '#d3dbe2' } },
      { type: 'sun-glow', p: { amount: 40, position: { x: 0.7, y: 0.3 }, size: 0.6 } },
      { type: 'soft-focus', p: { amount: 20, style: 'glow', radius: 30 } },
      { type: 'fade', p: { amount: 20, black: '#2b2c30', whites: 0.98 } }
    ] },
    'crisp-landscape': { name: 'Crisp landscape', summary: 'Haze removed, structure and texture brought out, sharpened for screens.', fx: [
      { type: 'dehaze', p: { amount: 25 } },
      { type: 'clarity', p: { amount: 30, radius: 50 } },
      { type: 'texture', p: { amount: 18 } },
      { type: 'saturation', p: { vibrance: 20 } },
      { type: 'vignette', p: { amount: -12, midpoint: 50, feather: 75 } },
      { type: 'sharpen', p: { amount: 60, radius: 0.9, masking: 20 } }
    ] },
    'miniature': { name: 'Miniature', summary: 'The tilt-shift toy-town look: a narrow sharp band, saturated colour, bright and crisp.', fx: [
      { type: 'saturation', p: { vibrance: 35, saturation: 10 } },
      { type: 'contrast', p: { amount: 15 } },
      { type: 'clarity', p: { amount: 15, radius: 30 } },
      { type: 'tilt-shift', p: { blur: 12, center: { x: 0.5, y: 0.6 }, focus: 0.07, transition: 0.2, highlights: 20 } }
    ] },
    'cross-processed-90s': { name: 'Cross-processed 90s', summary: 'Slide film in negative chemistry: punchy, yellow-green highlights, blue shadows, heavy vignette.', fx: [
      { type: 'cross-process', p: { preset: 'slide-in-negative', amount: 85 } },
      { type: 'vignette', p: { amount: -40, style: 'color', midpoint: 30, feather: 55 } },
      { type: 'chromatic-aberration', p: { redCyan: 12 } },
      { type: 'film-grain', p: { amount: 30, size: 1.5, color: 30 } }
    ] },
    'comic-print': { name: 'Comic print', summary: 'Posterised flats on CMYK halftone dots, like a printed comic panel.', fx: [
      { type: 'surface-blur', p: { radius: 6, threshold: 25 } },
      { type: 'contrast', p: { amount: 25 } },
      { type: 'posterize', p: { levels: 6 } },
      { type: 'halftone', p: { amount: 85, style: 'cmyk', size: 6, angle: 15 } }
    ] }
  };
  /* A fresh copy of a look's entries, ready for fx.add (or null). */
  CR.look = function (id) { var pr = CR.presets[id]; return pr ? JSON.parse(JSON.stringify(pr.fx)) : null; };
  /* Helper for agents (the fx.call operation). */
  if (FX.actions) FX.actions.register({ id: 'creative.look', label: 'Creative look', kind: 'call', summary: 'Applies a named look (several effects). Ids: ' + Object.keys(CR.presets || {}).join(', ') + '.', args: { id: 'look id' },
    run: function (ctx) { var fx = CR.look(ctx.args.id); return fx ? { fx: fx } : { ok: false, message: 'Unknown look. Known: ' + Object.keys(CR.presets || {}).join(', ') + '.' }; } });
})(window);
