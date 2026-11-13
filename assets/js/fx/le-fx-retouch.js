/* LocalEditor effect renderer, retouching pack (X4): frequency separation, multi-band detail, skin retouching by face area,
   dodge and burn, red-eye, spot healing / clone / patch, liquify (manual and face-aware) and a generic shape warp.
   The contract is docs/FX-AUTHORING.md; the reference for agents is docs/FX-REFERENCE.md ("Retouching").

   Everything here is data in the document, replayed by the renderer; no pixel of the photo is ever baked:
   - slider effects keep plain parameters;
   - strokes, spots, polygons and liquify strokes are quantised records kept in the entry's parameters (see "Data slots");
   - painted dodge / burn maps are the entry's own mask (an asset part painted with the workspace brush), the supported brush form.

   LE.fx.retouch (this file) also carries the helpers an agent or a tool needs to write that data without a pointer:
   R.ops.* build LE.fx.ops operations ("heal a spot at x, y radius r", "slim the jaw by 8 %"), R.suggestSource picks a
   source for a spot, R.face.* turn layer.maps.face into the anchor set the face-aware warp reads. */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;
  var M = FX.math;
  var R = FX.retouch = FX.retouch || {};
  R.version = 1;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function GPU(mb) { return { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: mb || 120 }; }
  function reach(sigmaDocPx, scale) { return M.blurReach ? M.blurReach(sigmaDocPx * scale) : Math.ceil(sigmaDocPx * scale * 3); }
  /* A small cache for work done in passes() that depends only on the parameters (decoded records, meshes, data textures). */
  function memo(limit) {
    var keys = [], vals = {};
    return function (key, make) {
      if (Object.prototype.hasOwnProperty.call(vals, key)) return vals[key];
      var v = make();
      keys.push(key); vals[key] = v;
      if (keys.length > limit) delete vals[keys.shift()];
      return v;
    };
  }

  /* ======================================================================================================================
     Data slots (the seam).
     The registry has no list type, so records ride in `curve` parameters marked hidden: each curve parameter carries
     4 channels x 64 points, and only the y of each point is data (x is the slot number / 100, which keeps the validator's
     sort stable). Values are fractions 0–1 quantised to 1e-4. Slot 0 holds the count of values that follow, / 10000.
     PROPOSAL (report): a `data` parameter type ({ type: 'data', max: 4096 }, value a list of numbers or a packed string,
     validated for length and range only). When it lands, only R.data.read / R.data.write change.
     ====================================================================================================================== */
  var SLOT = 64, CH = ['master', 'r', 'g', 'b'], Q = 10000;
  function q4(v) { return Math.round(clamp(v, 0, 1) * Q) / Q; }
  R.data = {
    perParam: SLOT * 4,
    capacity: function (nParams) { return nParams * SLOT * 4 - 1; },
    param: function (label) { return { type: 'curve', label: label || 'Data', help: 'Packed records written by LE.fx.retouch (R.ops.*, the tools). Not for editing by hand.', ui: { hidden: true } }; },
    /* values: numbers 0–1 → { d0: curve, d1: curve, … } for nParams parameters named prefix0… */
    write: function (values, nParams, prefix) {
      prefix = prefix || 'd';
      var cap = R.data.capacity(nParams), n = Math.min(values.length, cap), all = [n / Q], out = {}, i, k;
      for (i = 0; i < n; i++) all.push(q4(values[i]));
      for (k = 0; k < nParams; k++) {
        var cv = {};
        CH.forEach(function (ch, c) {
          var from = (k * 4 + c) * SLOT, pts = [];
          for (var j = 0; j < SLOT && from + j < all.length; j++) pts.push([j / 100, all[from + j]]);
          if (pts.length === 1) pts.push([0.01, 0]);
          cv[ch] = pts.length ? pts : [[0, 0], [1, 1]];
        });
        out[prefix + k] = cv;
      }
      return out;
    },
    read: function (p, nParams, prefix) {
      prefix = prefix || 'd';
      var flat = [], k;
      for (k = 0; k < nParams; k++) {
        var cv = p && p[prefix + k];
        CH.forEach(function (ch) {
          var pts = cv && Array.isArray(cv[ch]) ? cv[ch] : [[0, 0], [1, 1]];
          for (var j = 0; j < SLOT; j++) flat.push(pts[j] ? Number(pts[j][1]) || 0 : 0);
        });
      }
      var n = Math.round((flat[0] || 0) * Q);
      return flat.slice(1, 1 + Math.min(n, flat.length - 1));
    }
  };
  function dataParams(n, label) { var o = {}; for (var k = 0; k < n; k++) o['d' + k] = R.data.param(label); return o; }

  /* ======================================================================================================================
     Shared GLSL for g.pass shaders (display-referred unless stated).
     ====================================================================================================================== */
  var LIB = [
    'vec3 rt_un(vec4 s){ return s.a > 1e-5 ? s.rgb / s.a : vec3(0.0); }',
    /* BT.601 full-range YCbCr, chroma centred on 0. */
    'vec3 rt_ycc(vec3 c){ float y = dot(c, vec3(0.299, 0.587, 0.114)); return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713); }',
    'vec3 rt_rgb(vec3 q){ float r = q.x + 1.403 * q.z, b = q.x + 1.773 * q.y; return vec3(r, (q.x - 0.299 * r - 0.114 * b) / 0.587, b); }',
    /* Skin likelihood from colour alone: a soft box around the skin cluster in CbCr (Chai and Ngan 1999, widened so that
       very light and very dark skin and warm or cool light still fall in), gated away from black and blown highlights.
       Used only together with the face-part mask in "auto", or alone when a person or agent asks for it. */
    'float rt_skin(vec3 c){ vec3 q = rt_ycc(clamp(c, 0.0, 1.0)); return smoothstep(-0.27, -0.18, q.y) * (1.0 - smoothstep(-0.005, 0.045, q.y)) * smoothstep(0.0, 0.035, q.z) * (1.0 - smoothstep(0.2, 0.28, q.z)) * smoothstep(0.03, 0.09, q.x) * (1.0 - smoothstep(0.97, 1.0, q.x)); }',
    'float rt_sat(vec3 c){ float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)); return mx > 1e-4 ? (mx - mn) / mx : 0.0; }'
  ].join('\n') + '\n';

  /* Edge-aware low-pass: a guided filter (He, Sun and Tang 2010) with the image as its own guide, per channel, built from
     Gaussian windows instead of boxes so that it tiles with the renderer's blur. eps is in display units squared. */
  function guided(g, img, sigma, eps) {
    var mean = g.blur(sigma, { source: img });
    var sq = g.pass('vec4 fx(){ vec4 s = texture(u_src, v_uv); return vec4(s.rgb * s.rgb, s.a); }', { u_src: img });
    var corr = g.blur(sigma, { source: sq }); g.release(sq);
    var A = g.pass('uniform sampler2D u_m, u_c; uniform float u_eps;\nvec4 fx(){ vec3 m = texture(u_m, v_uv).rgb, c = texture(u_c, v_uv).rgb; vec3 v = max(c - m * m, 0.0); return vec4(v / (v + u_eps), 1.0); }', { u_src: img, u_m: mean, u_c: corr, u_eps: eps });
    var B = g.pass('uniform sampler2D u_m, u_a;\nvec4 fx(){ vec3 m = texture(u_m, v_uv).rgb, a = texture(u_a, v_uv).rgb; return vec4(m - a * m, 1.0); }', { u_src: img, u_m: mean, u_a: A });
    g.release(corr);
    var mA = g.blur(sigma, { source: A }), mB = g.blur(sigma, { source: B });
    g.release(A); g.release(B);
    var out = g.pass('uniform sampler2D u_a, u_b;\nvec4 fx(){ vec4 s = texture(u_src, v_uv); return vec4(texture(u_a, v_uv).rgb * s.rgb + texture(u_b, v_uv).rgb * s.a, s.a); }', { u_src: img, u_a: mA, u_b: mB });
    g.release(mA); g.release(mB);
    return { out: out, mean: mean };
  }
  function guidedReach(sigma, scale) { return reach(sigma, scale) * 2; }

  /* Face-area masks. A part whose map is missing selects everything in the renderer, so every area mask subtracts a part
     that would also be "everything" in that case (eyes, lips and teeth are holes in the skin polygon; under-eyes are not
     eyes): with no face map the area is empty, with one it is the area. Skin is gated by colour instead (see rt_skin). */
  var AREA = {
    skin: [{ kind: 'face', part: 'skin' }],
    eyes: [{ kind: 'face', part: 'eyes' }, { kind: 'face', part: 'skin', mode: 'subtract' }],
    lips: [{ kind: 'face', part: 'lips' }, { kind: 'face', part: 'skin', mode: 'subtract' }],
    teeth: [{ kind: 'face', part: 'teeth' }, { kind: 'face', part: 'skin', mode: 'subtract' }],
    brows: [{ kind: 'face', part: 'brows' }, { kind: 'face', part: 'skin', mode: 'subtract' }],
    'under-eyes': [{ kind: 'face', part: 'under-eyes' }, { kind: 'face', part: 'eyes', mode: 'subtract' }]
  };
  function areaMask(g, area, blur) {
    var parts = (AREA[area] || AREA.skin).map(function (q, i) { var o = { kind: q.kind, part: q.part, mode: q.mode || 'add', blur: i === 0 ? Math.max(0, blur || 0) : 0 }; return o; });
    return g.mask({ on: true, invert: false, parts: parts });
  }
  if (FX.declareControl) FX.declareControl('face-rig');   /* this pack's own control (assets/js/expert/tools/liquify.js) */

  var AREA_OPTIONS = [{ value: 'all', label: 'Everywhere' }, { value: 'skin', label: 'Skin' }, { value: 'face', label: 'Face skin (map)' }];

  /* ======================================================================================================================
     Frequency separation
     Model (display-referred, float): low = G(I) (Gaussian, σ = radius) or the guided filter of I (edge-aware);
     high = I − low, a signed difference kept in float, so low + high = I exactly — the 16-bit "subtract, scale 1, offset 0"
     convention without its rounding, not the 8-bit "apply image" one. The high view shows 0.5 + high, like the linear-light
     50 % grey layer of the classic workflow.
     Edits: smooth low = mix(low, G(low, σ2), amount) on the chosen area; even colour = chroma of low pulled to the chroma of
     G(low, 2.3σ2), luminance kept; texture = high × (1 + t/100).
     ====================================================================================================================== */
  FX.register({
    id: 'frequency-separation', name: 'Frequency separation', group: 'retouch', version: 1, space: 'display',
    params: {
      radius: { type: 'number', min: 0.5, max: 40, default: 4, step: 0.1, unit: 'px', label: 'Split radius', help: 'Detail finer than this goes to the high (texture) band.' },
      method: { type: 'choice', options: [{ value: 'gaussian', label: 'Gaussian' }, { value: 'edge', label: 'Edge-aware' }], default: 'gaussian', label: 'Split' },
      smooth: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Smooth tone', help: 'Evens light and dark blotches in the low band; texture is kept.' },
      smoothRadius: { type: 'number', min: 1, max: 100, default: 12, step: 0.5, unit: 'px', label: 'Smoothing radius' },
      evenColor: { type: 'number', min: 0, max: 100, default: 0, step: 1, label: 'Even colour', help: 'Evens colour blotches (redness) in the low band; luminance is kept.' },
      texture: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Texture', help: '−100 removes the high band, +100 doubles it.' },
      lowArea: { type: 'choice', options: AREA_OPTIONS, default: 'all', label: 'Low band area' },
      highArea: { type: 'choice', options: AREA_OPTIONS, default: 'all', label: 'High band area' },
      view: { type: 'choice', options: [{ value: 'result', label: 'Result' }, { value: 'low', label: 'Low' }, { value: 'high', label: 'High' }], default: 'result', label: 'View' }
    },
    radius: function (p, scale) {
      var split = p.method === 'edge' ? guidedReach(p.radius, scale) : reach(p.radius, scale);
      return split + (p.smooth > 0 || p.evenColor > 0 ? reach(p.smoothRadius * (p.evenColor > 0 ? 2.3 : 1), scale) : 0) + 4;
    },
    draft: function (p) { return p.method === 'edge' ? Object.assign({}, p, { method: 'gaussian' }) : p; },
    passes: function (g, p) {
      if (p.view === 'result' && !(p.smooth > 0) && !(p.evenColor > 0) && p.texture === 0) return undefined;
      var I = g.source;
      var low = p.method === 'edge' ? guided(g, I, p.radius, 0.0025).out : g.blur(p.radius, { source: I });
      var sm = p.smooth > 0 || p.evenColor > 0 ? g.blur(p.smoothRadius, { source: low }) : low;
      var wide = p.evenColor > 0 ? g.blur(p.smoothRadius * 2, { source: sm }) : sm;
      function area(a) { return a === 'all' ? null : a === 'face' ? areaMask(g, 'skin', p.radius) : 'colour'; }
      var la = area(p.lowArea), ha = area(p.highArea);
      return g.pass(LIB + [
        'uniform sampler2D u_low, u_sm, u_wide, u_la, u_ha; uniform vec4 u_k; uniform vec4 u_f;',
        'float areaW(sampler2D m, float mode, vec3 base){ return mode < 0.5 ? 1.0 : mode < 1.5 ? texture(m, v_uv).r : rt_skin(base); }',
        'vec4 fx(){ vec4 s = texture(u_src, v_uv); vec3 I = rt_un(s); vec3 lo = rt_un(texture(u_low, v_uv)); vec3 hi = I - lo;',
        '  if (u_f.z > 0.5 && u_f.z < 1.5) return vec4(lo * s.a, s.a);',
        '  if (u_f.z > 1.5) return vec4(clamp(0.5 + hi, 0.0, 1.0) * s.a, s.a);',
        '  float wl = areaW(u_la, u_f.x, lo), wh = areaW(u_ha, u_f.y, lo);',
        '  vec3 l2 = mix(lo, rt_un(texture(u_sm, v_uv)), u_k.x * wl);',
        '  if (u_k.y > 0.0) { vec3 a = rt_ycc(l2), b = rt_ycc(rt_un(texture(u_wide, v_uv))); a.yz = mix(a.yz, b.yz, u_k.y * wl); l2 = rt_rgb(a); }',
        '  vec3 o = l2 + hi * (1.0 + u_k.z * wh);',
        '  return vec4(o * s.a, s.a); }'
      ].join('\n'), {
        u_low: low, u_sm: sm, u_wide: wide, u_la: la && la !== 'colour' ? la : I, u_ha: ha && ha !== 'colour' ? ha : I,
        u_k: [p.smooth / 100, p.evenColor / 100, p.texture / 100, 0],
        u_f: [la == null ? 0 : la === 'colour' ? 2 : 1, ha == null ? 0 : ha === 'colour' ? 2 : 1, p.view === 'low' ? 1 : p.view === 'high' ? 2 : 0, 0]
      });
    },
    support: GPU(160),
    ui: { section: 'Retouch', order: 20, controls: [
      'view', { heading: 'Split' }, 'radius', 'method',
      { heading: 'Low frequencies' }, 'smooth', 'smoothRadius', 'evenColor', 'lowArea',
      { heading: 'High frequencies' }, 'texture', 'highArea'
    ] },
    agent: {
      summary: 'Splits the picture into a low band (tone and colour) and a high band (texture) at a radius, and edits each: smooth or even the low band, attenuate or boost the high band. Exact recombination (float), so it is neutral until a slider moves.',
      tips: [
        'Split radius ≈ the size of the texture to keep: pores on a face 100–200 px wide are 1–2 px; on a 1000 px wide face, 4–8 px.',
        'Tone evening on skin: smooth 40–60, smoothRadius 3–4 × radius, lowArea "skin" (colour-gated) or "face" (needs layer.maps.face).',
        'Even colour (redness, blotches): evenColor 30–60; luminance is untouched.',
        'Texture −20 to −40 softens skin without the plastic look; never −100 on a face.',
        'For two different masks per band, add two entries: one with only the low edits and an entry mask, one with only texture and another mask.',
        'view "low" / "high" shows a band alone to check the split; set it back to "result".',
        'For several bands at once ("reduce blotchiness at 8–32 px, keep pores") use detail-bands.'
      ],
      example: { type: 'frequency-separation', p: { radius: 3, smooth: 45, smoothRadius: 10, evenColor: 35, texture: -15, lowArea: 'skin' } }
    }
  });

  /* ======================================================================================================================
     Detail bands: a five-band Gaussian (Laplacian-style) pyramid kept at full resolution.
     G0 = I, Gk = G(I, σk) with σk = scale × 2^(k−1) px (1, 2, 4, 8, 16 at scale 1); band k = G(k−1) − Gk; residual G5.
     out = I + Σ (gain_k − 1) · band_k, gain = 1 + v/100. Exact identity at 0 (nothing runs).
     ====================================================================================================================== */
  var BAND_LABELS = ['Band 1 · 0–1 px', 'Band 2 · 1–2 px', 'Band 3 · 2–4 px', 'Band 4 · 4–8 px', 'Band 5 · 8–16 px'];
  FX.register({
    id: 'detail-bands', name: 'Detail bands', group: 'retouch', version: 1, space: 'display',
    params: {
      scale: { type: 'number', min: 0.25, max: 4, default: 1, step: 0.05, label: 'Band scale', help: 'Multiplies every band edge: at 2 the bands are 0–2, 2–4, 4–8, 8–16 and 16–32 px.' },
      b1: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: BAND_LABELS[0] },
      b2: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: BAND_LABELS[1] },
      b3: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: BAND_LABELS[2] },
      b4: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: BAND_LABELS[3] },
      b5: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: BAND_LABELS[4] },
      area: { type: 'choice', options: AREA_OPTIONS, default: 'all', label: 'Area' },
      view: { type: 'choice', options: [{ value: 'result', label: 'Result' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }, { value: 'residual', label: 'Residual' }], default: 'result', label: 'View' }
    },
    radius: function (p, scale) { return reach(16 * p.scale, scale) + 4; },
    passes: function (g, p) {
      var gains = [p.b1, p.b2, p.b3, p.b4, p.b5];
      if (p.view === 'result' && gains.every(function (v) { return v === 0; })) return undefined;
      var G = [], prev = g.source, prevS = 0;
      for (var k = 0; k < 5; k++) {
        var s = p.scale * Math.pow(2, k);
        prev = g.blur(Math.sqrt(s * s - prevS * prevS), { source: prev });
        G.push(prev); prevS = s;
      }
      var am = p.area === 'face' ? areaMask(g, 'skin', p.scale * 2) : null;
      var view = p.view === 'result' ? 0 : p.view === 'residual' ? 6 : Number(p.view);
      return g.pass(LIB + [
        'uniform sampler2D u_g1, u_g2, u_g3, u_g4, u_g5, u_am; uniform float u_k[5]; uniform vec2 u_f;',
        'vec4 fx(){ vec4 s = texture(u_src, v_uv); vec3 I = rt_un(s);',
        '  vec3 g1 = rt_un(texture(u_g1, v_uv)), g2 = rt_un(texture(u_g2, v_uv)), g3 = rt_un(texture(u_g3, v_uv)), g4 = rt_un(texture(u_g4, v_uv)), g5 = rt_un(texture(u_g5, v_uv));',
        '  vec3 b[5]; b[0] = I - g1; b[1] = g1 - g2; b[2] = g2 - g3; b[3] = g3 - g4; b[4] = g4 - g5;',
        '  if (u_f.y > 5.5) return vec4(g5 * s.a, s.a);',
        '  if (u_f.y > 0.5) { int i = int(u_f.y + 0.5) - 1; return vec4(clamp(0.5 + b[i] * 2.0, 0.0, 1.0) * s.a, s.a); }',
        '  float w = u_f.x < 0.5 ? 1.0 : u_f.x < 1.5 ? texture(u_am, v_uv).r : rt_skin(g2);',
        '  vec3 o = I; for (int i = 0; i < 5; i++) o += u_k[i] * w * b[i];',
        '  return vec4(o * s.a, s.a); }'
      ].join('\n'), { u_g1: G[0], u_g2: G[1], u_g3: G[2], u_g4: G[3], u_g5: G[4], u_am: am || g.source, u_k: gains.map(function (v) { return v / 100; }), u_f: [p.area === 'all' ? 0 : p.area === 'face' ? 1 : 2, view] });
    },
    support: GPU(160),
    ui: { section: 'Retouch', order: 21, controls: ['view', 'scale', 'b1', 'b2', 'b3', 'b4', 'b5', 'area'] },
    agent: {
      summary: 'Five detail bands, each an octave wide (0–1, 1–2, 2–4, 4–8, 8–16 px × scale), with a gain each: −100 removes a band, +100 doubles it. A multi-band frequency separation for precise texture work.',
      tips: [
        '"Reduce blotchiness at 8–32 px, keep pores": scale 2, b4 −40, b5 −50, area "skin".',
        'Bands near the size of pores (b1–b2 at the right scale) should stay at 0 or slightly negative on skin.',
        'Positive b3–b4 is a fine-structure clarity; positive b1 is sharpening (watch noise).',
        'scale = (face width in document px) / 300 puts band 4–5 on blotches for most portraits.',
        'view "1"…"5" shows a band (grey = 0, amplified ×2); "residual" shows what remains below band 5.'
      ],
      example: { type: 'detail-bands', p: { scale: 2, b4: -40, b5: -50, area: 'skin' } }
    }
  });

  /* ======================================================================================================================
     Skin and face retouching (one core; a composite "Portrait retouch" plus detailed effects)
     Bands (display-referred): Gt = G(I, size) (texture split), Mi = G(Gt, 3·size) (blotch window), Q = guided(Gt, 3·size).
     - Smoothness: low = mix(Gt, Q, s · skin) — the low band is smoothed edge-aware; texture (I − Gt) is added back untouched.
     - Texture: high × (1 + t · skin).
     - Blemishes: dark outliers of the mid band (Gt − Mi) beyond 0.012 are pulled to the local mean, and dark outliers of the
       high band beyond 2–3.5 × its local RMS are attenuated: small spots go, pores (low amplitude, dense) stay.
     - Even tone: chroma of the low band pulled to a skin-weighted wide average (luminance kept).
     - Shine: luminance above the skin reference + 0.03 compressed to 30 %, chroma pulled back towards the reference.
     - Contour: large-scale skin contrast around that reference (the face's own light, strengthened) plus, with a face map, a
       soft burn at the face's edge.
     - Under-eyes: lifted to the reference luminance, chroma towards the reference. Eyes: brighter whites and iris, high-band
       clarity, iris saturation. Teeth: chroma reduced and a small lift, only on light, low-saturation pixels. Lips: saturation.
     Skin = face 'skin' part × colour likelihood ("auto"), either alone, or everywhere.
     ====================================================================================================================== */
  var CORE0 = { smooth: 0, texture: 0, even: 0, blem: 0, under: 0, eyeBright: 0, eyeClarity: 0, iris: 0, teeth: 0, lips: 0, shine: 0, contour: 0, size: 3, skin: 'auto', edges: 50, view: 'result' };
  function coreActive(P) { return P.view !== 'result' || ['smooth', 'texture', 'even', 'blem', 'under', 'eyeBright', 'eyeClarity', 'iris', 'teeth', 'lips', 'shine', 'contour'].some(function (k) { return P[k] !== 0; }); }
  function coreReach(P, scale) {
    var s = P.size, r = reach(s, scale) + 2;
    if (P.smooth > 0 || P.blem > 0) r += guidedReach(3 * s, scale);
    if (P.even > 0 || P.shine > 0 || P.contour > 0 || P.under > 0) r = Math.max(r, reach(s, scale) + reach(8 * s, scale));
    if (P.contour > 0) r = Math.max(r, reach(10 * s, scale) + reach(s, scale));
    return r + 4;
  }
  function corePasses(g, P) {
    if (!coreActive(P)) return undefined;
    var s = P.size, I = g.source;
    var needLow = P.smooth || P.texture || P.even || P.blem || P.shine || P.contour || P.under || P.eyeClarity || P.view === 'skin';
    var Gt = needLow ? g.blur(s, { source: I }) : I;
    var Q = Gt, Mi = Gt;
    if (P.smooth > 0 || P.blem > 0) {
      if (P.smooth > 0 && !g.draft) { var eps = Math.pow(0.012 + 0.07 * (1 - P.edges / 100), 2), gr = guided(g, Gt, 3 * s, eps); Q = gr.out; Mi = gr.mean; }
      else { Mi = g.blur(3 * s, { source: Gt }); Q = Mi; }
    }
    var faceSkin = P.skin === 'auto' || P.skin === 'face' ? areaMask(g, 'skin', s) : null;
    var needRef = P.even || P.shine || P.contour || P.under;
    var ref = null;
    if (needRef) {
      var sw = g.pass(LIB + 'uniform sampler2D u_fs; uniform float u_mode;\nvec4 fx(){ vec3 c = rt_un(texture(u_src, v_uv)); float f = u_mode < 0.5 ? texture(u_fs, v_uv).r * rt_skin(c) : u_mode < 1.5 ? texture(u_fs, v_uv).r : u_mode < 2.5 ? rt_skin(c) : 1.0; f = max(f, 1e-3) ; return vec4(c * f, f); }',
        { u_src: Gt, u_fs: faceSkin || I, u_mode: ['auto', 'face', 'colour', 'all'].indexOf(P.skin) });
      ref = g.blur(8 * s, { source: sw }); g.release(sw);
    }
    var faceBlur = P.contour > 0 && faceSkin ? g.blur(10 * s, { source: faceSkin }) : null;
    var energy = null;
    if (P.blem > 0) {
      var e2 = g.pass(LIB + 'uniform sampler2D u_gt;\nvec4 fx(){ vec3 h = rt_un(texture(u_src, v_uv)) - rt_un(texture(u_gt, v_uv)); float l = dot(h, vec3(0.2126, 0.7152, 0.0722)); return vec4(l * l); }', { u_src: I, u_gt: Gt });
      energy = g.blur(3 * s, { source: e2 }); g.release(e2);
    }
    var eyes = P.eyeBright || P.eyeClarity || P.iris ? areaMask(g, 'eyes', 0) : null;   /* part edges are real edges: no blur */
    var teeth = P.teeth ? areaMask(g, 'teeth', 0) : null;
    var lips = P.lips ? areaMask(g, 'lips', 0) : null;
    var under = P.under ? areaMask(g, 'under-eyes', s * 2) : null;
    return g.pass(LIB + [
      'uniform sampler2D u_gt, u_mi, u_q, u_ref, u_fs, u_fb, u_en, u_eye, u_teeth, u_lips, u_under;',
      'uniform vec4 u_a, u_b, u_c, u_f;',
      'vec4 fx(){',
      '  vec4 s4 = texture(u_src, v_uv); vec3 I = rt_un(s4);',
      '  vec3 gt = rt_un(texture(u_gt, v_uv)), mi = rt_un(texture(u_mi, v_uv)), q = rt_un(texture(u_q, v_uv));',
      '  float fs = u_f.y > 0.5 ? texture(u_fs, v_uv).r : 1.0;',
      '  float sc = rt_skin(gt);',
      '  float skin = u_f.x < 0.5 ? fs * sc : u_f.x < 1.5 ? fs : u_f.x < 2.5 ? sc : 1.0;',
      '  if (u_f.w > 0.5) return vec4(vec3(skin) * s4.a, s4.a);',
      '  vec3 high = I - gt, low = gt;',
      '  float bl = u_a.w * skin;',
      '  if (bl > 0.0) {',
      '    vec3 mid = gt - mi; float ml = dot(mid, vec3(0.2126, 0.7152, 0.0722));',
      '    low -= mid * smoothstep(0.012, 0.045, -ml) * bl;',
      '    float hl = dot(high, vec3(0.2126, 0.7152, 0.0722)), rms = sqrt(max(texture(u_en, v_uv).r, 0.0)) + 0.004;',
      '    high *= 1.0 - smoothstep(2.0 * rms, 3.5 * rms, -hl) * bl;',
      '  }',
      '  low = mix(low, q + (low - gt), u_a.x * skin);',
      '  vec4 rf = texture(u_ref, v_uv); float rok = u_f.z > 0.5 ? smoothstep(0.02, 0.15, rf.a) : 0.0; vec3 ref = rf.rgb / max(rf.a, 1e-4);',
      '  float L, Lr;',
      '  if (u_a.z > 0.0 && rok > 0.0) { vec3 a = rt_ycc(low), b = rt_ycc(ref); a.yz = mix(a.yz, b.yz, u_a.z * skin * rok); low = rt_rgb(a); }',
      '  if (u_c.z > 0.0 && rok > 0.0) {',
      '    L = dot(low, vec3(0.299, 0.587, 0.114)); Lr = dot(ref, vec3(0.299, 0.587, 0.114));',
      '    float ex = L - Lr - 0.03; float w = u_c.z * skin * rok * smoothstep(0.0, 0.06, ex);',
      '    if (w > 0.0) { vec3 a = rt_ycc(low), b = rt_ycc(ref); a.x = mix(a.x, Lr + 0.03 + ex * 0.3, w); a.yz = mix(a.yz, b.yz, w * 0.6); low = rt_rgb(a); }',
      '  }',
      '  if (u_c.w > 0.0 && rok > 0.0) {',
      '    L = dot(low, vec3(0.299, 0.587, 0.114)); Lr = dot(ref, vec3(0.299, 0.587, 0.114));',
      '    float c = u_f.y > 0.5 ? smoothstep(0.3, 0.85, texture(u_fb, v_uv).r) : 1.0;',
      '    float Ln = Lr + (L - Lr) * (1.0 + 1.1 * u_c.w * skin * rok) - u_c.w * 0.07 * (1.0 - c) * skin;',
      '    low *= max(Ln, 0.0) / max(L, 1e-4);',
      '  }',
      '  if (u_b.x > 0.0 && rok > 0.0) {',
      '    float U = texture(u_under, v_uv).r * u_b.x; L = dot(low, vec3(0.299, 0.587, 0.114)); Lr = dot(ref, vec3(0.299, 0.587, 0.114));',
      '    vec3 a = rt_ycc(low), b = rt_ycc(ref); float lift = max(Lr - L, 0.0);',
      '    a.x += lift * 0.8 * U; a.yz = mix(a.yz, b.yz, 0.6 * U); low = rt_rgb(a);',
      '  }',
      '  vec3 o = low + high * (1.0 + u_a.y * skin);',
      '  if (u_b.y > 0.0 || u_b.z > 0.0 || u_b.w > 0.0) {',
      '    float E = texture(u_eye, v_uv).r; float l = dot(o, vec3(0.2126, 0.7152, 0.0722));',
      '    o *= 1.0 + u_b.y * 0.35 * E * smoothstep(0.06, 0.3, l);',
      '    o += u_b.z * 1.2 * E * (I - gt);',
      '    l = dot(o, vec3(0.2126, 0.7152, 0.0722)); o = l + (o - l) * (1.0 + u_b.w * 0.8 * E);',
      '  }',
      '  if (u_c.x > 0.0) {',
      '    vec3 a = rt_ycc(o); float T = texture(u_teeth, v_uv).r * smoothstep(0.25, 0.42, a.x) * (1.0 - smoothstep(0.35, 0.6, rt_sat(o)));',
      '    a.yz *= 1.0 - 0.7 * u_c.x * T; a.x += 0.07 * u_c.x * T * (1.0 - a.x); o = rt_rgb(a);',
      '  }',
      '  if (u_c.y != 0.0) { float Lp = texture(u_lips, v_uv).r; float l = dot(o, vec3(0.2126, 0.7152, 0.0722)); o = l + (o - l) * max(1.0 + u_c.y * 0.6 * Lp, 0.0); }',
      '  return vec4(o * s4.a, s4.a);',
      '}'
    ].join('\n'), {
      u_gt: Gt, u_mi: Mi, u_q: Q, u_ref: ref || I, u_fs: faceSkin || I, u_fb: faceBlur || I, u_en: energy || I,
      u_eye: eyes || I, u_teeth: teeth || I, u_lips: lips || I, u_under: under || I,
      u_a: [P.smooth / 100, P.texture / 100, P.even / 100, P.blem / 100],
      u_b: [P.under / 100, P.eyeBright / 100, P.eyeClarity / 100, P.iris / 100],
      u_c: [P.teeth / 100, P.lips / 100, P.shine / 100, P.contour / 100],
      u_f: [['auto', 'face', 'colour', 'all'].indexOf(P.skin), faceSkin ? 1 : 0, ref ? 1 : 0, P.view === 'skin' ? 1 : 0]
    });
  }
  R.core = { defaults: CORE0, passes: corePasses, reach: coreReach };

  var SKIN_FROM = { type: 'choice', options: [{ value: 'auto', label: 'Face and colour' }, { value: 'face', label: 'Face map' }, { value: 'colour', label: 'Colour' }, { value: 'all', label: 'Everywhere' }], default: 'auto', label: 'Skin from',
    help: 'Face and colour: the face map\'s skin polygon, kept where the colour is skin. Without a face map it falls back to colour.' };
  var SIZE = { type: 'number', min: 0.5, max: 12, default: 3, step: 0.1, unit: 'px', label: 'Detail size', help: 'The texture scale to keep: about face width ÷ 60 in document pixels.' };
  function slider(label, min, help) { var o = { type: 'number', min: min == null ? 0 : min, max: 100, default: 0, step: 1, label: label }; if (help) o.help = help; return o; }
  function coreEffect(def) {
    def.space = 'display'; def.group = 'retouch';
    def.radius = function (p, scale) { return coreReach(def.map(p), scale); };
    def.draft = function (p) { return p; };
    def.passes = function (g, p) { return corePasses(g, def.map(p)); };
    def.support = GPU(200);
    FX.register(def);
  }
  function C(o) { return Object.assign({}, CORE0, o); }

  /* The composite: familiar high-level sliders that expand to the detailed effects below (R.expand). */
  var PORTRAIT_MAP = function (p) {
    return C({ smooth: p.smoothness, even: p.smoothness * 0.5, texture: p.texture, blem: p.blemishes, under: p.eyes * 0.6, eyeBright: p.eyes * 0.6, eyeClarity: p.eyes * 0.5, iris: p.eyes * 0.4,
      teeth: p.teeth, lips: p.lips, shine: p.shine, contour: p.contour, size: p.size, skin: p.skin, edges: 50, view: p.view === 'skin' ? 'skin' : 'result' });
  };
  coreEffect({
    id: 'portrait-retouch', name: 'Portrait retouch', version: 1,
    params: {
      smoothness: slider('Smoothness', 0, 'Evens skin tone and colour; texture is kept.'),
      texture: slider('Texture', -100, 'Fine skin texture: negative softens, positive brings it out.'),
      blemishes: slider('Blemishes', 0, 'Reduces small dark spots on skin; pores stay.'),
      eyes: slider('Eyes', 0, 'Brighter whites and iris, a little clarity, lighter under-eyes. Needs a face map.'),
      teeth: slider('Teeth', 0, 'Less yellow, slightly brighter. Needs a face map.'),
      lips: slider('Lips', -100, 'Lip colour saturation. Needs a face map.'),
      shine: slider('Shine', 0, 'Compresses specular hot spots on skin.'),
      contour: slider('Contour', 0, 'Strengthens the face\'s own light and shade.'),
      size: SIZE,
      skin: SKIN_FROM,
      view: { type: 'choice', options: [{ value: 'result', label: 'Result' }, { value: 'skin', label: 'Skin mask' }], default: 'result', label: 'View' }
    },
    map: PORTRAIT_MAP,
    ui: { section: 'Retouch', order: 10, controls: ['smoothness', 'texture', 'blemishes', 'eyes', 'teeth', 'lips', 'shine', 'contour', { heading: 'Options' }, 'size', 'skin', 'view'] },
    agent: {
      summary: 'One-stop portrait retouch with familiar sliders (Smoothness, Texture, Blemishes, Eyes, Teeth, Lips, Shine, Contour). Skin work is frequency-based and edge-aware, so texture survives; eye, teeth and lip work uses the face map (layer.maps.face) and does nothing without it. Every slider at 0 is no change.',
      tips: [
        'Natural defaults for a retoucher\'s eye: smoothness 30–40, texture −10 to 0, blemishes 40–60, eyes 20–35, teeth 20–30, shine 30–50, contour 10–25.',
        'Set size to face width ÷ 60 in document pixels (R.face.size(layer) computes it from the face map); too small leaves blotches, too large smears features.',
        'Check the mask first: view "skin" shows what counts as skin. On strong colour casts use skin "face"; beards and glasses frames are inside the face polygon: subtract them with an entry mask.',
        'LE.fx.retouch.expand(entry) returns the equivalent detailed entries (skin-smoothing, blemish-removal, eye-enhance, under-eye, teeth-whitening, lip-color, shine-reduction, face-contour) to fine-tune.',
        'Run it before colour grading; after liquify if both are used.'
      ],
      example: { type: 'portrait-retouch', p: { smoothness: 35, texture: -5, blemishes: 50, eyes: 25, teeth: 20, shine: 35, contour: 15, size: 3 } }
    }
  });
  coreEffect({
    id: 'skin-smoothing', name: 'Skin smoothing', version: 1,
    params: { smoothness: slider('Smoothness'), texture: slider('Texture', -100), evenTone: slider('Even tone', 0, 'Colour only: redness and blotches; luminance is kept.'), edges: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Edge protection' }, size: SIZE, skin: SKIN_FROM,
      view: { type: 'choice', options: [{ value: 'result', label: 'Result' }, { value: 'skin', label: 'Skin mask' }], default: 'result', label: 'View' } },
    map: function (p) { return C({ smooth: p.smoothness, texture: p.texture, even: p.evenTone, edges: p.edges, size: p.size, skin: p.skin, view: p.view }); },
    ui: { section: 'Retouch', order: 30, controls: ['smoothness', 'texture', 'evenTone', 'edges', 'size', 'skin', 'view'] },
    agent: { summary: 'Texture-preserving skin smoothing: the low band is smoothed with an edge-aware filter on skin only, the fine texture is added back (and can be softened or boosted).',
      tips: ['smoothness 30–45 and texture 0 is a natural start; raise edges to protect nostrils, lips and the jaw line.', 'evenTone 20–40 evens redness without flattening light.'], example: { type: 'skin-smoothing', p: { smoothness: 40, texture: -10, evenTone: 25, size: 3 } } }
  });
  coreEffect({
    id: 'blemish-removal', name: 'Blemish reduction', version: 1,
    params: { amount: slider('Amount'), size: SIZE, skin: SKIN_FROM },
    map: function (p) { return C({ blem: p.amount, size: p.size, skin: p.skin }); },
    ui: { section: 'Retouch', order: 31, controls: ['amount', 'size', 'skin'] },
    agent: { summary: 'Conservative automatic small-spot suppression on skin: dark outliers of the mid and high bands are pulled towards their surroundings; low-amplitude texture (pores) stays.', tips: ['amount 40–70. For a big or isolated blemish use spot-heal (R.ops.heal) instead.'], example: { type: 'blemish-removal', p: { amount: 60, size: 3 } } }
  });
  coreEffect({
    id: 'under-eye', name: 'Under-eye', version: 1,
    params: { lighten: slider('Lighten'), size: SIZE },
    map: function (p) { return C({ under: p.lighten, size: p.size }); },
    ui: { section: 'Retouch', order: 32, controls: ['lighten', 'size'] },
    agent: { summary: 'Lifts the under-eye band (face map) towards the surrounding skin\'s luminance and colour; texture is kept. Needs layer.maps.face.', tips: ['lighten 25–45; the band is geometric (below the lower lid), not a bag detector.'], example: { type: 'under-eye', p: { lighten: 35, size: 3 } } }
  });
  coreEffect({
    id: 'eye-enhance', name: 'Eyes', version: 1,
    params: { brighten: slider('Brighten'), clarity: slider('Clarity'), iris: slider('Iris saturation'), size: SIZE },
    map: function (p) { return C({ eyeBright: p.brighten, eyeClarity: p.clarity, iris: p.iris, size: p.size }); },
    ui: { section: 'Retouch', order: 33, controls: ['brighten', 'clarity', 'iris', 'size'] },
    agent: { summary: 'Brightens the eyes (whites and iris, not the pupil), adds fine clarity and iris saturation inside the face map\'s eye area. Needs layer.maps.face.', tips: ['brighten 20–35, clarity 15–30, iris 10–25 stays believable.'], example: { type: 'eye-enhance', p: { brighten: 25, clarity: 20, iris: 15 } } }
  });
  coreEffect({
    id: 'teeth-whitening', name: 'Teeth', version: 1,
    params: { amount: slider('Whiten'), size: SIZE },
    map: function (p) { return C({ teeth: p.amount, size: p.size }); },
    ui: { section: 'Retouch', order: 34, controls: ['amount', 'size'] },
    agent: { summary: 'Reduces yellow and lifts slightly, only on light, low-saturation pixels inside the mouth (face map).', tips: ['amount 20–40. Shadowed or stained teeth are often missed by the mask; check visually.'], example: { type: 'teeth-whitening', p: { amount: 30 } } }
  });
  coreEffect({
    id: 'lip-color', name: 'Lips', version: 1,
    params: { saturation: slider('Saturation', -100), size: SIZE },
    map: function (p) { return C({ lips: p.saturation, size: p.size }); },
    ui: { section: 'Retouch', order: 35, controls: ['saturation', 'size'] },
    agent: { summary: 'Lip colour saturation inside the face map\'s lip area.', tips: ['±10–25 is subtle; for a hue change use an HSL effect with this area as its mask.'], example: { type: 'lip-color', p: { saturation: 15 } } }
  });
  coreEffect({
    id: 'shine-reduction', name: 'Shine', version: 1,
    params: { amount: slider('Reduce shine'), size: SIZE, skin: SKIN_FROM },
    map: function (p) { return C({ shine: p.amount, size: p.size, skin: p.skin }); },
    ui: { section: 'Retouch', order: 36, controls: ['amount', 'size', 'skin'] },
    agent: { summary: 'Specular compression on skin: highlights above the surrounding skin level are compressed and their colour restored, so oily shine reads as skin.', tips: ['amount 30–60. It leaves the catch-lights in the eyes alone (they are not skin).'], example: { type: 'shine-reduction', p: { amount: 45 } } }
  });
  coreEffect({
    id: 'face-contour', name: 'Contour', version: 1,
    params: { amount: slider('Contour'), size: SIZE, skin: SKIN_FROM },
    map: function (p) { return C({ contour: p.amount, size: p.size, skin: p.skin }); },
    ui: { section: 'Retouch', order: 37, controls: ['amount', 'size', 'skin'] },
    agent: { summary: 'Dodge-and-burn along the face\'s own structure: strengthens large-scale light and shade on skin and, with a face map, softly darkens the face\'s edge.', tips: ['amount 10–25. For hand-placed dodge and burn use dodge-burn with a painted or shaped mask.'], example: { type: 'face-contour', p: { amount: 20 } } }
  });

  /* Composite → detailed entries (same intent; pixels close but not identical, since the composite runs as one pass). */
  R.expand = function (entry) {
    var p = Object.assign(FX.defaults('portrait-retouch'), entry && entry.p || {}), out = [];
    function add(type, q) { out.push({ type: type, on: true, amount: entry && entry.amount != null ? entry.amount : 1, blend: 'normal', mask: entry && entry.mask || null, p: Object.assign({ size: p.size }, q) }); }
    if (p.smoothness || p.texture) add('skin-smoothing', { smoothness: p.smoothness, texture: p.texture, evenTone: Math.round(p.smoothness * 0.5), skin: p.skin });
    if (p.blemishes) add('blemish-removal', { amount: p.blemishes, skin: p.skin });
    if (p.eyes) { add('under-eye', { lighten: Math.round(p.eyes * 0.6) }); add('eye-enhance', { brighten: Math.round(p.eyes * 0.6), clarity: Math.round(p.eyes * 0.5), iris: Math.round(p.eyes * 0.4) }); }
    if (p.teeth) add('teeth-whitening', { amount: p.teeth });
    if (p.lips) add('lip-color', { saturation: p.lips });
    if (p.shine) add('shine-reduction', { amount: p.shine, skin: p.skin });
    if (p.contour) add('face-contour', { amount: p.contour, skin: p.skin });
    return out;
  };

  /* ======================================================================================================================
     Dodge, burn and sponge — a painted (or shaped) map is the entry's mask.
     Model: linear light. Dodge/burn scale RGB by 2^(±ev · w(l)) (hue kept); with "protect tones" a dodge follows the curve
     y = kx / (1 + (k − 1)x) on luminance, which never clips white (the curve-based form of a 50 % grey dodge layer).
     w(l) is the tonal range on display luminance: shadows 1 − S(0.05, 0.55), highlights S(0.45, 0.95), mid-tones a bump at 0.5.
     Sponge: saturation × (1 ± a · w(l)) around luminance. Exposure is 0–100 %: 100 % = ±1 EV where the mask is full.
     ====================================================================================================================== */
  var RANGES = { shadows: 0, midtones: 1, highlights: 2, all: 3 };
  M.retouchRange = function (l, range) {
    function ss(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
    return range === 'shadows' ? 1 - ss(0.05, 0.55, l) : range === 'highlights' ? ss(0.45, 0.95, l) : range === 'midtones' ? 1 - Math.pow(Math.abs(2 * l - 1), 2) : 1;
  };
  FX.register({
    id: 'dodge-burn', name: 'Dodge and burn', group: 'retouch', version: 1, space: 'linear',
    params: {
      mode: { type: 'choice', options: [{ value: 'dodge', label: 'Dodge' }, { value: 'burn', label: 'Burn' }, { value: 'saturate', label: 'Sponge +' }, { value: 'desaturate', label: 'Sponge −' }], default: 'dodge', label: 'Mode' },
      exposure: { type: 'number', min: 0, max: 100, default: 0, step: 1, unit: '%', label: 'Exposure', help: '100 % is one stop where the map is full (sponge: ±100 % saturation).' },
      range: { type: 'choice', options: [{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Mid-tones' }, { value: 'highlights', label: 'Highlights' }, { value: 'all', label: 'All' }], default: 'midtones', label: 'Range' },
      protect: { type: 'bool', default: true, label: 'Protect tones', help: 'Keeps hue and avoids clipping highlights.' }
    },
    passes: function (g, p) {
      if (!(p.exposure > 0)) return;
      var e = p.exposure / 100, mode = ['dodge', 'burn', 'saturate', 'desaturate'].indexOf(p.mode);
      g.color([
        'uniform vec4 $a;',
        'float $w(float l){ float r = $a.z; return r < 0.5 ? 1.0 - smoothstep(0.05, 0.55, l) : r < 1.5 ? 1.0 - pow(abs(2.0 * l - 1.0), 2.0) : r < 2.5 ? smoothstep(0.45, 0.95, l) : 1.0; }',
        'vec3 $fx(vec3 c){ float ly = dot(c, vec3(0.2126, 0.7152, 0.0722)); float l = clamp(toDisplay(vec3(ly)).x, 0.0, 1.0); float w = $w(l);',
        '  if ($a.y < 1.5) { float k = exp2(($a.y < 0.5 ? 1.0 : -1.0) * $a.x * w);',
        '    if ($a.w > 0.5 && $a.y < 0.5) { float x = max(ly, 0.0); float y = k * x / (1.0 + (k - 1.0) * min(x, 1.0)); return c * (x > 1e-6 ? y / x : k); }',
        '    return c * k; }',
        '  float s = 1.0 + ($a.y < 2.5 ? 1.0 : -1.0) * $a.x * w; vec3 o = ly + (c - ly) * max(s, 0.0);',
        '  if ($a.w > 0.5) o = max(o, 0.0);',
        '  return o; }'
      ].join('\n'), { a: [e, mode, RANGES[p.range], p.protect ? 1 : 0] });
    },
    cpu: null,
    support: GPU(40),
    ui: { section: 'Retouch', order: 40, controls: ['mode', 'exposure', 'range', 'protect'] },
    agent: {
      summary: 'Dodge (lighten), burn (darken) or sponge (saturate / desaturate) through the entry\'s mask: paint the mask with the Dodge and burn tool, or give it shapes (radial, linear, an asset). Exposure 100 % is one stop. One colour pass; it merges with other colour effects.',
      tips: [
        'The 50 % grey dodge-and-burn layer: R.ops.dodgeBurnLayer(doc) adds an adjustment layer with a dodge and a burn entry whose masks start empty; paint each mask (white = full effect).',
        '"Dodge this polygon": R.ops.dodgePolygon(doc, layerId, points, { exposure, feather }) paints the polygon into an asset mask (needs a scene to store the asset) — or use a radial mask part for round areas.',
        'Typical exposure 10–30 % with a soft mask; build up with several strokes rather than one strong one.',
        'range "highlights" + burn tames hot spots; range "shadows" + dodge opens eye sockets.',
        'Keep protect tones on unless you want a deliberately clipped look.'
      ],
      example: { type: 'dodge-burn', p: { mode: 'dodge', exposure: 25, range: 'midtones' }, mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.42, rx: 0.12, ry: 0.16, feather: 0.6 }] } }
    }
  });

  /* ======================================================================================================================
     Red-eye: two eyes per entry. Inside a soft disc, "redness" (r − max(g, b)) / r above 0.3 + threshold × 0.5 sets red to the
     mean of green and blue, then darkens by `darken`. Display-referred; one colour pass.
     ====================================================================================================================== */
  FX.register({
    id: 'red-eye', name: 'Red-eye', group: 'retouch', version: 1, space: 'display',
    params: {
      eye1: { type: 'point', default: { x: -1, y: -1 }, label: 'Eye 1' },
      eye2: { type: 'point', default: { x: -1, y: -1 }, label: 'Eye 2' },
      radius: { type: 'number', min: 0, max: 200, default: 0, step: 0.5, unit: 'px', label: 'Pupil size' },
      threshold: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Threshold', help: 'How red a pixel must be to change: 50 leaves skin and lips alone.' },
      darken: { type: 'number', min: 0, max: 100, default: 50, step: 1, label: 'Darken' }
    },
    passes: function (g, p) {
      if (!(p.radius > 0)) return;
      var b = g.box;
      g.color([
        'uniform vec4 $e; uniform vec3 $k;',
        'vec3 $fx(vec3 c){ vec2 q = docPos(); float w = max(1.0 - smoothstep(0.75, 1.0, length(q - $e.xy) / $k.x), 1.0 - smoothstep(0.75, 1.0, length(q - $e.zw) / $k.x));',
        '  float red = (c.r - max(c.g, c.b)) / max(c.r, 1e-3); float t = w * smoothstep($k.y, $k.y + 0.12, red) * smoothstep(0.08, 0.2, c.r);',
        '  vec3 o = vec3(min(c.r, 0.5 * (c.g + c.b)), c.g, c.b) * (1.0 - $k.z);',
        '  return mix(c, o, t); }'
      ].join('\n'), { e: [p.eye1.x * b.w, p.eye1.y * b.h, p.eye2.x * b.w, p.eye2.y * b.h], k: [p.radius, 0.3 + p.threshold / 100 * 0.5, p.darken / 100 * 0.6] });
    },
    support: GPU(20),
    ui: { section: 'Retouch', order: 60, controls: ['eye1', 'eye2', 'radius', 'threshold', 'darken'] },
    agent: {
      summary: 'Removes red-eye inside two discs (pupil centres in box fractions, radius in document px). Only red pixels change, so a generous radius is safe.',
      tips: ['With a face map, R.ops.redEye(doc, layerId) places both eyes on the irises and sizes the pupils.', 'radius ≈ 0.4 × the iris radius… 1.2 × the visible red disc.', 'Another entry for each further face.'],
      example: { type: 'red-eye', p: { eye1: { x: 0.42, y: 0.38 }, eye2: { x: 0.55, y: 0.37 }, radius: 9 } }
    }
  });

  /* The registry calls radius(p, scale) without the layer box, but strokes, offsets and meshes are stored as fractions of
     the box. SEAM (proposal: radius(p, scale, box)): passes() records the box it saw for a parameter set, and radius() uses
     it; before the first render it assumes a long side of 4,000 document px (generous: wider reach, never seams). */
  var HINTS = {}, HINT_KEYS = [];
  function hintSet(key, box) { if (!HINTS[key]) { HINT_KEYS.push(key); if (HINT_KEYS.length > 64) delete HINTS[HINT_KEYS.shift()]; } HINTS[key] = { w: box.w, h: box.h }; }
  function hintGet(key, box) { return box && box.w ? box : HINTS[key] || { w: 4000, h: 4000 }; }   /* radius(p, scale, box) is given the box; the rest is for callers that give none */

  /* ======================================================================================================================
     Spot healing, clone and patch (one entry holds every stroke, click and polygon, replayed in order)
     Record (values 0–1 in the data slots): kind/8 (1 heal stroke, 2 clone stroke, 3 heal polygon = patch, 4 clone polygon),
     n/10000, r (radius as a fraction of the box's long side), hardness, opacity, (dx + 1)/2, (dy + 1)/2 (the source offset as
     fractions of the box width and height: source = destination + offset), then n × (x, y, p) in box fractions, p = pen
     pressure (radius scale; for polygons the feather is r). Caps: 256 records, 512 points per record, 2,047 values per entry
     (about 200 single-click spots or 600 stroke points); strokes are simplified (Ramer–Douglas–Peucker, 0.15 r) when added.
     Rendering (per tile, culled to the records that touch it):
       1. coverage pass: per pixel, the composite coverage m, heal or clone, and the source offset of the dominant record
          (also in a band around each record, so the source image is valid where the blend reads it);
       2. S = the picture sampled at the offset (rounded to whole target pixels: a clone is an exact copy);
       3. heal = M_w(D) + S − M_w(S), with M_w a normalised Gaussian membrane over the pixels outside the healed area
          (w = 1 outside, 0 inside; σ = blend × the largest radius): the destination's surrounding tone and colour, the
          source's texture. A Poisson-like blend that tiles; limits: a single σ per tile, so a tiny spot next to a huge one
          gets a softer tone match, and a gradient across a large patch is matched only to its σ-blurred boundary.
       4. out = mix(D, clone ? S : heal, m). Passes: 3 for clone only, 9–13 with healing.
     ====================================================================================================================== */
  var SPOT_PARAMS = 8, SPOT_CAP = { records: 256, points: 512 };
  var KINDS = { 'heal': 1, 'clone': 2, 'heal-polygon': 3, 'clone-polygon': 4 };
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    (function rec(a, b) {
      var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9, best = -1, bi = -1;
      for (var i = a + 1; i < b; i++) {
        var d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L + Math.abs(pts[i][2] - pts[a][2]) * 0.02;
        if (d > best) { best = d; bi = i; }
      }
      if (best > eps && bi > 0) { keep[bi] = 1; rec(a, bi); rec(bi, b); }
    })(0, pts.length - 1);
    return pts.filter(function (p, i) { return keep[i]; });
  }
  function ptsOf(list, maxN) {
    return (Array.isArray(list) ? list : []).slice(0, maxN).map(function (q) {
      var x = Array.isArray(q) ? q[0] : q && q.x, y = Array.isArray(q) ? q[1] : q && q.y, p = Array.isArray(q) ? q[2] : q && q.p;
      return [clamp(Number(x) || 0, 0, 1), clamp(Number(y) || 0, 0, 1), clamp(isNum(p) ? p : 1, 0.05, 1)];
    });
  }
  R.spots = {
    params: SPOT_PARAMS, cap: SPOT_CAP,
    /* Records: { kind: 'heal' | 'clone' | 'heal-polygon' | 'clone-polygon', r, hardness, opacity, dx, dy, points: [[x, y, p]] } */
    read: function (p) {
      var v = R.data.read(p, SPOT_PARAMS), out = [], i = 0;
      while (i + 7 <= v.length && out.length < SPOT_CAP.records) {
        var k = Math.round(v[i] * 8), n = Math.round(v[i + 1] * Q), rec = { kind: ['', 'heal', 'clone', 'heal-polygon', 'clone-polygon'][k] || 'heal', r: v[i + 2], hardness: v[i + 3], opacity: v[i + 4], dx: v[i + 5] * 2 - 1, dy: v[i + 6] * 2 - 1, points: [] };
        i += 7;
        if (!(n > 0) || i + n * 3 > v.length) break;
        for (var j = 0; j < n; j++) rec.points.push([v[i + j * 3], v[i + j * 3 + 1], v[i + j * 3 + 2]]);
        i += n * 3;
        out.push(rec);
      }
      return out;
    },
    write: function (list) {
      var v = [];
      list.slice(0, SPOT_CAP.records).forEach(function (r) {
        var pts = ptsOf(r.points, SPOT_CAP.points);
        if (!pts.length || v.length + 7 + pts.length * 3 > R.data.capacity(SPOT_PARAMS)) return;
        v.push((KINDS[r.kind] || 1) / 8, pts.length / Q, clamp(r.r, 0.0005, 0.5), clamp(isNum(r.hardness) ? r.hardness : 0.5, 0, 1), clamp(isNum(r.opacity) ? r.opacity : 1, 0, 1), (clamp(r.dx || 0, -1, 1) + 1) / 2, (clamp(r.dy || 0, -1, 1) + 1) / 2);
        pts.forEach(function (q) { v.push(q[0], q[1], q[2]); });
      });
      return R.data.write(v, SPOT_PARAMS);
    },
    /* Adds a record (points simplified); returns the new full parameter object. */
    add: function (p, rec) {
      var list = R.spots.read(p);
      var pts = ptsOf(rec.points || [[rec.x, rec.y, 1]], 4096);
      if (!/polygon/.test(rec.kind || '')) pts = rdp(pts, Math.max(1e-4, (rec.r || 0.01) * 0.15));
      list.push({ kind: rec.kind || 'heal', r: rec.r, hardness: rec.hardness, opacity: rec.opacity, dx: rec.dx, dy: rec.dy, points: pts.slice(0, SPOT_CAP.points) });
      return Object.assign({}, p, R.spots.write(list));
    },
    used: function (p) { return R.data.read(p, SPOT_PARAMS).length / R.data.capacity(SPOT_PARAMS); }
  };
  function spotKey(p) { var k = []; for (var i = 0; i < SPOT_PARAMS; i++) k.push(p['d' + i]); return JSON.stringify(k); }
  var spotMemo = memo(16);
  function spotDoc(p, w, h) {
    return spotMemo(spotKey(p) + '|' + w + 'x' + h, function () {
      var L = Math.max(w, h);
      return R.spots.read(p).map(function (r) {
        var rad = r.r * L, poly = r.kind.indexOf('polygon') >= 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        var pts = r.points.map(function (q) { var X = q[0] * w, Y = q[1] * h, rr = poly ? rad : rad * q[2]; x0 = Math.min(x0, X - rr); y0 = Math.min(y0, Y - rr); x1 = Math.max(x1, X + rr); y1 = Math.max(y1, Y + rr); return [X, Y, rr]; });
        return { kind: KINDS[r.kind] || 1, poly: poly, clone: r.kind.indexOf('clone') === 0, rad: rad, hard: r.hardness, op: r.opacity, dx: r.dx * w, dy: r.dy * h, pts: pts, box: [x0, y0, x1, y1] };
      });
    });
  }
  function hiLo(v) { var hi = Math.round(v / 32) * 32; return [hi, v - hi]; }
  var SPOT_COV = [
    'uniform sampler2D u_P, u_R; uniform float u_nr, u_ext, u_dmax;',
    'vec4 tP(int i){ return texelFetch(u_P, ivec2(i, 0), 0); }',
    'vec4 tR(int i){ return texelFetch(u_R, ivec2(i, 0), 0); }',
    'vec2 pos(int i){ vec4 a = tP(2 * i), b = tP(2 * i + 1); return vec2(a.x + a.y, a.z + b.x); }',
    'float rad(int i){ return tP(2 * i + 1).y; }',
    'vec4 fx(){',
    '  vec2 q = docPos(); float m = 0.0, best = 0.0, kind = 0.0; vec2 d = vec2(0.0);',
    '  int nr = int(u_nr + 0.5);',
    '  for (int i = 0; i < 1024; i++) { if (i >= nr) break;',
    '    vec4 r3 = tR(5 * i + 3), r4 = tR(5 * i + 4);',
    '    if (q.x < r3.x - u_ext || q.y < r3.y - u_ext || q.x > r3.z + u_ext || q.y > r4.x + u_ext) continue;',
    '    vec4 r0 = tR(5 * i), r1 = tR(5 * i + 1), r2 = tR(5 * i + 2);',
    '    int k = int(r0.x + 0.5), n = int(r0.y + 0.5), s0 = int(r0.z + 0.5); float hard = min(r2.y, 0.97), cov = 0.0, gap = 1e9;',
    '    if (k <= 2) {',
    '      vec2 a = pos(s0); float ra = rad(s0), nd = 1e9;',
    '      if (n == 1) { float dd = length(q - a); nd = dd / max(ra, 1e-3); gap = dd - ra; }',
    '      for (int j = 1; j < 512; j++) { if (j >= n) break; vec2 b = pos(s0 + j); float rb = rad(s0 + j); vec2 ab = b - a;',
    '        float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); float rad = max(mix(ra, rb, t), 1e-3); float dd = length(q - a - ab * t);',
    '        nd = min(nd, dd / rad); gap = min(gap, dd - rad); a = b; ra = rb; }',
    '      cov = 1.0 - smoothstep(hard, 1.0, nd);',
    '    } else {',
    '      float fe = max(rad(s0), 1e-3), dm = 1e9; bool inside = false; vec2 a = pos(s0 + n - 1);',
    '      for (int j = 0; j < 512; j++) { if (j >= n) break; vec2 b = pos(s0 + j);',
    '        if (((b.y > q.y) != (a.y > q.y)) && (q.x < (a.x - b.x) * (q.y - b.y) / (a.y - b.y) + b.x)) inside = !inside;',
    '        vec2 ab = a - b; float t = clamp(dot(q - b, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); dm = min(dm, length(q - b - ab * t)); a = b; }',
    '      cov = inside ? smoothstep(0.0, fe, dm) : 0.0; gap = inside ? -dm : dm;',
    '    }',
    '    cov *= r2.z;',
    '    float score = cov > 0.0 ? 1.0 + cov : (gap < u_ext ? 1.0 - max(gap, 0.0) / u_ext : 0.0);',
    '    if (cov > 0.0) m = 1.0 - (1.0 - m) * (1.0 - cov);',
    '    if (score > 0.0 && score >= best) { best = score; d = vec2(r1.x + r1.y, r1.z + r2.x); kind = (k == 2 || k == 4) ? 1.0 : 0.0; }',
    '  }',
    '  return vec4(m, kind, 0.5 + d / (2.0 * u_dmax));',
    '}'
  ].join('\n');
  FX.register({
    id: 'spot-heal', name: 'Healing and clone', group: 'retouch', version: 1, space: 'display',
    params: Object.assign({ blend: { type: 'number', min: 0.2, max: 1.5, default: 0.6, step: 0.05, label: 'Blend radius', help: 'How far around a healed spot the tone and colour are matched, × the largest spot radius.' } }, dataParams(SPOT_PARAMS, 'Spots')),
    radius: function (p, scale, bx) {
      var key = spotKey(p), box = hintGet(key, bx), recs = spotDoc(p, box.w, box.h), dm = 0, rm = 0;
      recs.forEach(function (r) { dm = Math.max(dm, Math.hypot(r.dx, r.dy)); rm = Math.max(rm, r.rad); });
      return recs.length ? Math.ceil(dm * scale) + reach(clamp(p.blend * rm, 0.75, 150), scale) + 4 : 0;
    },
    passes: function (g, p) {
      var all = spotDoc(p, g.box.w, g.box.h);
      if (!all.length) return undefined;
      hintSet(spotKey(p), g.box);
      var D = Math.hypot(g.width, g.height) / g.scale, ox = g.origin[0], oy = g.origin[1];
      var recs = all.filter(function (r) { return !(r.box[2] < ox - D || r.box[0] > ox + D || r.box[3] < oy - D || r.box[1] > oy + D); });
      if (!recs.length) return undefined;
      var rmax = 0, dmax = 1, npt = 0;
      recs.forEach(function (r) { rmax = Math.max(rmax, r.rad); dmax = Math.max(dmax, Math.abs(r.dx), Math.abs(r.dy)); npt += r.pts.length; });
      var sigma = clamp(p.blend * rmax, 0.75, 150), ext = 2.5 * sigma + 2, anyHeal = recs.some(function (r) { return !r.clone; });
      var P = new Float32Array(Math.max(2, npt * 2) * 4), RR = new Float32Array(Math.max(2, recs.length * 5) * 4), at = 0;
      recs.forEach(function (r, i) {
        var o = i * 20, dx = hiLo(r.dx), dy = hiLo(r.dy);
        RR.set([r.kind, r.pts.length, at, 1, dx[0], dx[1], dy[0], 1, dy[1], r.hard, r.op, 1, r.box[0] - 2, r.box[1] - 2, r.box[2] + 2, 1, r.box[3] + 2, 0, 0, 1], o);
        r.pts.forEach(function (q) { var x = hiLo(q[0]), y = hiLo(q[1]); P.set([x[0], x[1], y[0], 1, y[1], q[2], 0, 1], at * 8); at++; });
      });
      var cov = g.pass(SPOT_COV, { u_P: g.lut1d(P, 4), u_R: g.lut1d(RR, 4), u_nr: recs.length, u_ext: ext, u_dmax: dmax });
      var S = g.pass('uniform sampler2D u_cov; uniform float u_dmax;\nvec4 fx(){ vec4 c = texture(u_cov, v_uv); vec2 d = (c.ba - 0.5) * 2.0 * u_dmax; d = floor(d * u_scale + 0.5) / u_scale; return texture(u_src, v_uv + docToUV(d)); }', { u_cov: cov, u_dmax: dmax });
      var md = null, ms = null;
      if (anyHeal) {
        var W = 'uniform sampler2D u_cov, u_pic;\nvec4 fx(){ float w = 1.0 - step(0.002, texture(u_cov, v_uv).r); vec4 s = texture(u_pic, v_uv); return vec4(s.rgb * w, w); }';
        var dw = g.pass(W, { u_cov: cov, u_pic: g.source }), sw = g.pass(W, { u_cov: cov, u_pic: S });
        md = g.blur(sigma, { source: dw }); g.release(dw);
        ms = g.blur(sigma, { source: sw }); g.release(sw);
      }
      return g.pass([
        'uniform sampler2D u_cov, u_S, u_md, u_ms; uniform float u_heal;',
        'vec4 fx(){ vec4 D = texture(u_src, v_uv); vec4 c = texture(u_cov, v_uv); float m = c.r; if (m <= 0.0) return D;',
        '  vec4 S = texture(u_S, v_uv); vec3 r = S.rgb;',
        '  if (u_heal > 0.5 && c.g < 0.5) { vec4 a = texture(u_md, v_uv), b = texture(u_ms, v_uv); float ok = smoothstep(1e-4, 0.02, min(a.a, b.a));',
        '    vec3 heal = a.rgb / max(a.a, 1e-5) + (S.rgb - b.rgb / max(b.a, 1e-5)); r = mix(S.rgb, max(heal, 0.0), ok); }',
        '  return vec4(mix(D.rgb, r, m), D.a); }'
      ].join('\n'), { u_cov: cov, u_S: S, u_md: md || S, u_ms: ms || S, u_heal: anyHeal ? 1 : 0 });
    },
    support: GPU(160),
    ui: { section: 'Retouch', order: 50, controls: ['blend'] },
    agent: {
      summary: 'Healing brush, clone stamp, spot removal and patch as one list of records replayed in order on the GPU. Heal takes texture from the source and tone and colour from around the destination; clone copies exactly. Write records with LE.fx.retouch.ops (heal, clone, patch) rather than by hand: they live in packed data slots.',
      tips: [
        'Heal a spot: LE.fx.ops.apply(doc, LE.fx.retouch.ops.heal(doc, layerId, { x: 0.41, y: 0.33, r: 0.008, image })) — x, y in box fractions, r a fraction of the box\'s long side; with an image (the layer\'s picture) the source is chosen automatically (R.suggestSource), else pass source: { dx, dy }.',
        'Clone a stroke: ops.clone(doc, layerId, { points: [[x, y], …], r, dx, dy, hardness: 0.8 }).',
        'Patch: ops.patch(doc, layerId, { polygon: [[x, y], …], dx, dy, feather: 0.004 }) brings the content from the offset into the polygon with a heal blend (mode "clone" for an exact copy).',
        'Spot radius ≈ 1.3 × the blemish radius; hardness 0.3–0.6 for healing, 0.7–0.9 for cloning.',
        'Limits: 256 records and about 2,000 values per entry; add a second entry ({ newEntry: true }) when one is full (R.spots.used(p) tells how full). Sources farther than the renderer\'s tile reach (about 1,200 px at export) show seams when tiled.'
      ],
      example: { type: 'spot-heal', p: { blend: 0.6 } }
    }
  });

  /* Automatic source for a spot: on a copy at most 512 px wide, candidates on rings 2.2–4.6 r around the spot (24
     directions) are scored by how well the ring just outside the spot matches the ring around the candidate (tone and
     colour continuity), how close the candidate's own texture is to the destination's surroundings (no blemish copied in)
     and, lightly, by distance. Deterministic. image: canvas, image, ImageData or { data, width, height }; spot { x, y, r }
     in box fractions (r of the long side). Returns { dx, dy, score } in box fractions (source = spot + d). */
  R.suggestSource = function (image, spot) {
    var W = image.naturalWidth || image.width, H = image.naturalHeight || image.height, data = null, w = W, h = H;
    var k = Math.min(1, 512 / Math.max(W, H));
    if (image.data && !image.getContext && k >= 1) data = image.data;
    else {
      var srcC = image;
      if (image.data && !image.getContext) { srcC = document.createElement('canvas'); srcC.width = W; srcC.height = H; srcC.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), W, H), 0, 0); }
      w = Math.max(1, Math.round(W * k)); h = Math.max(1, Math.round(H * k));
      var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(srcC, 0, 0, w, h); data = x.getImageData(0, 0, w, h).data;
    }
    var L = Math.max(w, h), cx = spot.x * w, cy = spot.y * h, r = Math.max(1.5, spot.r * L);
    function px(X, Y) { var i = (clamp(Math.round(Y), 0, h - 1) * w + clamp(Math.round(X), 0, w - 1)) * 4; return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]; }
    var A = 24, ring = [1.15, 1.4, 1.75], ref = [], i, j;
    for (i = 0; i < A; i++) { var an = i / A * Math.PI * 2; for (var f0 = 0; f0 < ring.length; f0++) ref.push(px(cx + Math.cos(an) * r * ring[f0], cy + Math.sin(an) * r * ring[f0])); }
    function stats(X, Y, rr) {
      var s = 0, s2 = 0, n = 0, st = Math.max(1, rr / 6);
      for (var yy = -rr; yy <= rr; yy += st) for (var xx = -rr; xx <= rr; xx += st) { if (xx * xx + yy * yy > rr * rr) continue; var q = px(X + xx, Y + yy), l = 0.3 * q[0] + 0.59 * q[1] + 0.11 * q[2]; s += l; s2 += l * l; n++; }
      var m = s / Math.max(n, 1); return { m: m, sd: Math.sqrt(Math.max(s2 / Math.max(n, 1) - m * m, 0)) };
    }
    var refTex = stats(cx, cy, r * 1.6), best = null;
    [2.2, 2.8, 3.6, 4.6].forEach(function (dist, di) {
      for (j = 0; j < A; j++) {
        var a2 = (j + 0.5 * (di % 2)) / A * Math.PI * 2, X = cx + Math.cos(a2) * r * dist, Y = cy + Math.sin(a2) * r * dist;
        if (X < r * 1.8 || Y < r * 1.8 || X > w - r * 1.8 || Y > h - r * 1.8) continue;
        var e = 0, n = 0;
        for (i = 0; i < A; i++) { var an2 = i / A * Math.PI * 2; for (var f = 0; f < ring.length; f++) { var q = px(X + Math.cos(an2) * r * ring[f], Y + Math.sin(an2) * r * ring[f]), t = ref[i * ring.length + f]; e += (q[0] - t[0]) * (q[0] - t[0]) + (q[1] - t[1]) * (q[1] - t[1]) + (q[2] - t[2]) * (q[2] - t[2]); n++; } }
        var st = stats(X, Y, r), score = e / n + 2 * Math.pow(st.sd - refTex.sd, 2) + 0.0004 * dist;
        if (!best || score < best.score) best = { score: score, X: X, Y: Y };
      }
    });
    if (!best) return { dx: 0, dy: clamp(3 * r / h, -1, 1), score: Infinity };
    return { dx: (best.X - cx) / w, dy: (best.Y - cy) / h, score: best.score };
  };

  /* ======================================================================================================================
     Liquify: a displacement mesh rebuilt from stored strokes.
     Record: tool/16 (1 forward warp, 2 twirl clockwise, 3 twirl counter-clockwise, 4 pucker, 5 bloat, 6 push left,
     7 reconstruct, 8 smooth, 9 freeze, 10 thaw), n/10000, size (brush radius / long side), pressure, density, 0, then
     n × (x, y, p) in box fractions (a point repeated = the brush held still). Caps: 256 strokes, 1,024 points per stroke,
     3,071 values per entry; forward and push-left strokes are simplified (0.08 × radius) when added.
     Mesh: square cells, 128 nodes on the long side (≤ 16,384 nodes), node values = backward displacement D in document px
     (the output at q shows the picture at q + D(q)). Each dab rewrites the nodes under the brush:
       forward warp D'(q) = D(q − f·v) − f·v (v = brush motion), push left the same with v turned −90°,
       twirl / pucker / bloat D'(q) = D(q') + (q' − q) with q' the rotated / scaled position, reconstruct D·(1 − 0.15 f),
       smooth towards the 4-neighbour mean; every change × (1 − freeze). |D| ≤ 15 % of the long side.
     Rendering: D by a cubic B-spline over the nodes (C2, no creases at cell edges), the picture by Catmull-Rom bicubic at
     q + D. Reach = max |D| in target pixels + 3. One pass after the mesh upload (4 small data textures, hi/lo split for
     exact positions in half floats).
     ====================================================================================================================== */
  var LIQ_PARAMS = 12, LIQ_TOOLS = ['', 'forward', 'twirl-cw', 'twirl-ccw', 'pucker', 'bloat', 'push-left', 'reconstruct', 'smooth', 'freeze', 'thaw'];
  var LIQ_NODES = 128, LIQ_MAX = 0.15;
  R.liquify = {
    params: LIQ_PARAMS, tools: LIQ_TOOLS.slice(1), nodes: LIQ_NODES, maxDisplacement: LIQ_MAX,
    read: function (p) {
      var v = R.data.read(p, LIQ_PARAMS), out = [], i = 0;
      while (i + 6 <= v.length && out.length < 256) {
        var t = Math.round(v[i] * 16), n = Math.round(v[i + 1] * Q), rec = { tool: LIQ_TOOLS[t] || 'forward', size: v[i + 2], pressure: v[i + 3], density: v[i + 4], points: [] };
        i += 6;
        if (!(n > 0) || i + n * 3 > v.length) break;
        for (var j = 0; j < n; j++) rec.points.push([v[i + j * 3], v[i + j * 3 + 1], v[i + j * 3 + 2]]);
        i += n * 3;
        out.push(rec);
      }
      return out;
    },
    write: function (list) {
      var v = [], cap = R.data.capacity(LIQ_PARAMS);
      list.slice(0, 256).forEach(function (r) {
        var pts = ptsOf(r.points, 1024);
        if (!pts.length || v.length + 6 + pts.length * 3 > cap) return;
        v.push(Math.max(1, LIQ_TOOLS.indexOf(r.tool)) / 16, pts.length / Q, clamp(r.size, 0.001, 0.5), clamp(isNum(r.pressure) ? r.pressure : 0.5, 0.01, 1), clamp(isNum(r.density) ? r.density : 0.5, 0, 1), 0);
        pts.forEach(function (q) { v.push(q[0], q[1], q[2]); });
      });
      return R.data.write(v, LIQ_PARAMS);
    },
    add: function (p, rec) {
      var list = R.liquify.read(p), pts = ptsOf(rec.points, 4096);
      if (rec.tool === 'forward' || rec.tool === 'push-left') pts = rdp(pts, Math.max(1e-4, (rec.size || 0.05) * 0.08));
      list.push({ tool: rec.tool || 'forward', size: rec.size || 0.05, pressure: rec.pressure, density: rec.density, points: pts });
      return Object.assign({}, p, R.liquify.write(list));
    },
    used: function (p) { return R.data.read(p, LIQ_PARAMS).length / R.data.capacity(LIQ_PARAMS); }
  };
  function Mesh(w, h) {
    var L = Math.max(w, h), sp = L / (LIQ_NODES - 1), nx = Math.min(LIQ_NODES, Math.ceil(w / sp - 1e-9) + 1), ny = Math.min(LIQ_NODES, Math.ceil(h / sp - 1e-9) + 1);
    return { w: w, h: h, sp: sp, nx: nx, ny: ny, dx: new Float32Array(nx * ny), dy: new Float32Array(nx * ny), fz: new Float32Array(nx * ny), max: 0 };
  }
  function meshAt(m, x, y) {   /* bilinear D at a doc position, for the replay */
    if (m.nx < 2 || m.ny < 2) return [m.dx[0], m.dy[0]];
    var fx = clamp(x / m.sp, 0, m.nx - 1), fy = clamp(y / m.sp, 0, m.ny - 1), i = Math.min(Math.floor(fx), m.nx - 2), j = Math.min(Math.floor(fy), m.ny - 2);
    var tx = fx - i, ty = fy - j, a = j * m.nx + i, b = a + 1, c = a + m.nx, d = c + 1;
    return [(m.dx[a] * (1 - tx) + m.dx[b] * tx) * (1 - ty) + (m.dx[c] * (1 - tx) + m.dx[d] * tx) * ty, (m.dy[a] * (1 - tx) + m.dy[b] * tx) * (1 - ty) + (m.dy[c] * (1 - tx) + m.dy[d] * tx) * ty];
  }
  function falloff(t, density) { if (t >= 1) return 0; var soft = Math.pow(1 - t * t, 2), hard = 1 - Math.pow(t, 8); return hard + (soft - hard) * density; }
  function dab(m, tool, cx, cy, R0, k, density, vx, vy) {
    var i0 = Math.max(0, Math.floor((cx - R0) / m.sp)), i1 = Math.min(m.nx - 1, Math.ceil((cx + R0) / m.sp)), j0 = Math.max(0, Math.floor((cy - R0) / m.sp)), j1 = Math.min(m.ny - 1, Math.ceil((cy + R0) / m.sp));
    var upd = [], i, j;
    for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
      var X = i * m.sp, Y = j * m.sp, t = Math.hypot(X - cx, Y - cy) / R0, n = j * m.nx + i, fo = falloff(t, density);
      if (tool === 'freeze') { m.fz[n] = Math.max(m.fz[n], fo * k); continue; }
      if (tool === 'thaw') { m.fz[n] *= 1 - fo * k; continue; }
      var f = fo * (1 - m.fz[n]);
      if (!(f > 0)) continue;
      var nx, ny, q;
      if (tool === 'forward' || tool === 'push-left') { var ax = f * vx, ay = f * vy; q = meshAt(m, X - ax, Y - ay); nx = q[0] - ax; ny = q[1] - ay; }
      else if (tool === 'twirl-cw' || tool === 'twirl-ccw') { var th = (tool === 'twirl-cw' ? -1 : 1) * 0.08 * k * f, cs = Math.cos(th), sn = Math.sin(th), rx = X - cx, ry = Y - cy, px2 = cx + rx * cs - ry * sn, py2 = cy + rx * sn + ry * cs; q = meshAt(m, px2, py2); nx = q[0] + px2 - X; ny = q[1] + py2 - Y; }
      else if (tool === 'pucker' || tool === 'bloat') { var s = 1 + (tool === 'pucker' ? 1 : -1) * 0.05 * k * f, px3 = cx + (X - cx) * s, py3 = cy + (Y - cy) * s; q = meshAt(m, px3, py3); nx = q[0] + px3 - X; ny = q[1] + py3 - Y; }
      else if (tool === 'reconstruct') { nx = m.dx[n] * (1 - 0.15 * k * f); ny = m.dy[n] * (1 - 0.15 * k * f); }
      else if (tool === 'smooth') {
        var ax2 = 0, ay2 = 0, c2 = 0, nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
        for (var b = 0; b < 4; b++) { var o = nb[b]; if (o[0] < 0 || o[1] < 0 || o[0] >= m.nx || o[1] >= m.ny) continue; var nn = o[1] * m.nx + o[0]; ax2 += m.dx[nn]; ay2 += m.dy[nn]; c2++; }
        var tt = 0.25 * k * f; nx = m.dx[n] + (ax2 / c2 - m.dx[n]) * tt; ny = m.dy[n] + (ay2 / c2 - m.dy[n]) * tt;
      } else continue;
      upd.push(n, nx, ny);
    }
    for (i = 0; i < upd.length; i += 3) { m.dx[upd[i]] = upd[i + 1]; m.dy[upd[i]] = upd[i + 2]; }
  }
  function clampMesh(m) {
    var lim = LIQ_MAX * Math.max(m.w, m.h), mx = 0;
    for (var n = 0; n < m.dx.length; n++) {
      var l = Math.hypot(m.dx[n], m.dy[n]);
      if (l > lim) { m.dx[n] *= lim / l; m.dy[n] *= lim / l; l = lim; }
      if (l > mx) mx = l;
    }
    m.max = mx;
    return m;
  }
  /* The mesh for a list of records on a box w × h (document px). Exposed for tools, tests and agents. */
  R.liquify.mesh = function (records, w, h) {
    var m = Mesh(w, h), L = Math.max(w, h);
    records.forEach(function (r) {
      var R0 = Math.max(r.size * L, m.sp * 0.75), prev = null, k = r.pressure;
      r.points.forEach(function (q) {
        var X = q[0] * w, Y = q[1] * h, kk = k * q[2];
        if (r.tool === 'forward' || r.tool === 'push-left') {
          if (prev) {
            var vx = X - prev[0], vy = Y - prev[1], len = Math.hypot(vx, vy), steps = Math.max(1, Math.ceil(len / (R0 * 0.25)));
            for (var s = 1; s <= steps; s++) {
              var sx = vx / steps * kk, sy = vy / steps * kk, cx = prev[0] + vx * s / steps, cy = prev[1] + vy * s / steps;
              if (r.tool === 'push-left') { var t0 = sx; sx = sy; sy = -t0; }
              dab(m, r.tool, cx, cy, R0, kk, r.density, sx, sy);
            }
          }
        } else dab(m, r.tool, X, Y, R0, kk, r.density, 0, 0);
        prev = [X, Y];
      });
    });
    return clampMesh(m);
  };
  /* The renderer's interpolation of the mesh (cubic B-spline), on the CPU: tests and hit-testing. */
  function bsw(t) { var t2 = t * t, t3 = t2 * t; return [(1 - t) * (1 - t) * (1 - t) / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6]; }
  R.liquify.sample = function (m, x, y) {
    var fx = x / m.sp, fy = y / m.sp, i = Math.floor(fx), j = Math.floor(fy), wx = bsw(fx - i), wy = bsw(fy - j), ox = 0, oy = 0;
    for (var b = 0; b < 4; b++) for (var a = 0; a < 4; a++) {
      var n = clamp(j - 1 + b, 0, m.ny - 1) * m.nx + clamp(i - 1 + a, 0, m.nx - 1), wt = wx[a] * wy[b];
      ox += m.dx[n] * wt; oy += m.dy[n] * wt;
    }
    return [ox, oy];
  };
  function meshLuts(g, m) {
    var luts = [];
    for (var k = 0; k * 4096 < m.dx.length; k++) {
      var d = new Float32Array(4096 * 4);
      for (var t = 0; t < 4096; t++) {
        var n = k * 4096 + t; if (n >= m.dx.length) break;
        d[t * 4] = m.dx[n]; d[t * 4 + 1] = m.dy[n]; d[t * 4 + 3] = 1;
      }
      luts.push(g.lut1d(d, 4));
    }
    while (luts.length < 4) luts.push(luts[0]);
    return luts;
  }
  /* Catmull-Rom bicubic in 9 bilinear taps, on u_src. */
  var CUBIC = [
    'vec4 cubic(vec2 uv){ vec2 ts = vec2(textureSize(u_src, 0)); vec2 p = uv * ts - 0.5; vec2 i = floor(p), f = p - i;',
    '  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);',
    '  vec2 w12 = w1 + w2, t0 = (i - 0.5) / ts, t3 = (i + 2.5) / ts, t12 = (i + 0.5 + w2 / w12) / ts;',
    '  vec4 r = (texture(u_src, vec2(t0.x, t0.y)) * w0.x + texture(u_src, vec2(t12.x, t0.y)) * w12.x + texture(u_src, vec2(t3.x, t0.y)) * w3.x) * w0.y;',
    '  r += (texture(u_src, vec2(t0.x, t12.y)) * w0.x + texture(u_src, vec2(t12.x, t12.y)) * w12.x + texture(u_src, vec2(t3.x, t12.y)) * w3.x) * w12.y;',
    '  r += (texture(u_src, vec2(t0.x, t3.y)) * w0.x + texture(u_src, vec2(t12.x, t3.y)) * w12.x + texture(u_src, vec2(t3.x, t3.y)) * w3.x) * w3.y;',
    '  r = max(r, 0.0); r.a = min(r.a, 1.0); return r; }'
  ].join('\n') + '\n';
  var WARP = CUBIC + [
    'uniform sampler2D u_m0, u_m1, u_m2, u_m3; uniform vec3 u_g;',
    'vec2 node(int i, int j){ i = clamp(i, 0, int(u_g.x) - 1); j = clamp(j, 0, int(u_g.y) - 1); int n = j * int(u_g.x) + i; int k = n / 4096, t = n - k * 4096; vec4 v;',
    '  if (k == 0) v = texelFetch(u_m0, ivec2(t, 0), 0); else if (k == 1) v = texelFetch(u_m1, ivec2(t, 0), 0); else if (k == 2) v = texelFetch(u_m2, ivec2(t, 0), 0); else v = texelFetch(u_m3, ivec2(t, 0), 0);',
    '  return v.xy; }',
    'vec4 bsw(float t){ float t2 = t * t, t3 = t2 * t; return vec4((1.0 - t) * (1.0 - t) * (1.0 - t), 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0; }',
    'vec2 disp(vec2 q){ vec2 f = q / u_g.z; vec2 i = floor(f); vec4 wx = bsw(f.x - i.x), wy = bsw(f.y - i.y); vec2 o = vec2(0.0); int ix = int(i.x), iy = int(i.y);',
    '  for (int b = 0; b < 4; b++) { vec2 row = node(ix - 1, iy - 1 + b) * wx.x + node(ix, iy - 1 + b) * wx.y + node(ix + 1, iy - 1 + b) * wx.z + node(ix + 2, iy - 1 + b) * wx.w; o += row * wy[b]; }',
    '  return o; }',
    'vec4 fx(){ vec2 d = disp(docPos()); if (dot(d, d) < 1e-8) return texture(u_src, v_uv); return cubic(v_uv + docToUV(d)); }'
  ].join('\n');
  function warpPasses(g, m) {
    if (!m || !(m.max > 1e-3)) return undefined;
    var l = meshLuts(g, m);
    return g.pass(WARP, { u_m0: l[0], u_m1: l[1], u_m2: l[2], u_m3: l[3], u_g: [m.nx, m.ny, m.sp] });
  }
  R._gl = { WARP: WARP, CUBIC: CUBIC, meshLuts: meshLuts };
  var liqMemo = memo(8);
  function liqKey(p) { var k = []; for (var i = 0; i < LIQ_PARAMS; i++) k.push(p['d' + i]); return JSON.stringify(k); }
  function liqMesh(p, w, h) { return liqMemo(liqKey(p) + '|' + w + 'x' + h, function () { return R.liquify.mesh(R.liquify.read(p), w, h); }); }
  FX.register({
    id: 'liquify', name: 'Liquify', group: 'geometry', version: 1, space: 'linear',
    params: dataParams(LIQ_PARAMS, 'Strokes'),
    radius: function (p, scale, bx) {
      var key = liqKey(p); if (!R.liquify.read(p).length) return 0;
      var box = hintGet(key, bx);
      return Math.ceil(liqMesh(p, box.w, box.h).max * scale) + 3;
    },
    passes: function (g, p) { hintSet(liqKey(p), g.box); return warpPasses(g, liqMesh(p, g.box.w, g.box.h)); },
    support: GPU(80),
    ui: { section: 'Geometry', order: 60, controls: [] },
    agent: {
      summary: 'Manual liquify: forward warp, twirl, pucker, bloat, push left, reconstruct, smooth, freeze and thaw strokes, stored as compact records and replayed into a 128-node displacement mesh, rendered with bicubic sampling. Write strokes with LE.fx.retouch.ops.liquify.',
      tips: [
        'ops.liquify(doc, layerId, { tool: "forward", points: [[0.40, 0.62], [0.42, 0.62]], size: 0.04, pressure: 0.6 }) pushes content right by about 0.6 × 2 % of the width under a brush 4 % of the long side.',
        'Hold-still tools (twirl, pucker, bloat, reconstruct, smooth, freeze, thaw) act once per point: repeat a point to apply more.',
        'Freeze first (tool "freeze") to protect an edge, then warp; thaw to release.',
        'For faces use face-liquify (numeric sliders from the face map) instead of strokes; for a region use shape-warp.',
        'Displacement is limited to 15 % of the long side; the mesh has 128 nodes on the long side, so features smaller than about 1 % of the picture cannot be moved precisely.'
      ],
      example: { type: 'liquify', p: {} }
    }
  });

  /* ======================================================================================================================
     Face-aware liquify: named sliders → a displacement field from landmark anchors (no strokes, nothing automatic).
     The rig (anchors in box fractions, from layer.maps.face via R.face.rig) is stored in the entry; sliders are signed
     percentages of the feature they move, so "slim the jaw by 8 %" is jawline −8. Face frame: x along the eye line, y down
     the face, unit = the distance between the eye centres (IOD). Each slider is a forward field built from smooth bumps
     b(d, r) = (1 − (d/r)²)² around its feature (scales, shifts, a rotation for tilt); the backward map D(q) = −F(q + D(q))
     is solved by 4 fixed-point steps per mesh node, then rendered like liquify. Deterministic from the rig and the sliders.
     ====================================================================================================================== */
  var FACE_SLIDERS = [
    ['faceWidth', 'Face width', 30, '%'], ['jawline', 'Jawline', 30, '%'], ['chinHeight', 'Chin height', 50, '%'], ['forehead', 'Forehead', 50, '%'],
    ['eyeSize', 'Eye size', 40, '%'], ['eyeHeight', 'Eye height', 10, '%'], ['eyeWidth', 'Eye width', 40, '%'], ['eyeTilt', 'Eye tilt', 20, 'deg'], ['eyeDistance', 'Eye distance', 15, '%'],
    ['noseWidth', 'Nose width', 40, '%'], ['noseHeight', 'Nose height', 10, '%'],
    ['mouthWidth', 'Mouth width', 40, '%'], ['mouthHeight', 'Mouth height', 10, '%'], ['smile', 'Smile', 30, '%'], ['upperLip', 'Upper lip', 50, '%'], ['lowerLip', 'Lower lip', 50, '%']
  ];
  /* Landmark indices (MediaPipe Face Mesh, 478 points) kept in the rig, in this order: iris centres, eye corners and lids,
     nose tip, wings and bridge, mouth corners, lip edges, chin, forehead top, cheeks, jaw angles, brows. */
  var RIG_IDX = [468, 473, 33, 133, 362, 263, 159, 145, 386, 374, 1, 64, 294, 168, 61, 291, 0, 13, 14, 17, 152, 10, 234, 454, 172, 397, 105, 334];
  R.face = {
    rigIndex: RIG_IDX.slice(), sliders: FACE_SLIDERS.map(function (d) { return { id: d[0], label: d[1], range: d[2], unit: d[3] }; }),
    /* layer.maps.face → a list of faces, each { landmarks: [[x, y, z]] (source-photo fractions), rotation, score }. */
    list: function (layer) {
      var f = layer && layer.maps && layer.maps.face; if (!f) return [];
      var faces = Array.isArray(f) ? f : Array.isArray(f.faces) ? f.faces : [f];
      return faces.map(function (one) { try { return one && one.points ? R.face.unpack(one) : one && one.landmarks ? one : null; } catch (e) { return null; } }).filter(Boolean);
    },
    /* The packed form of LE.maps.pack.face (uint16 x, uint16 y, int16 z per point, little-endian, base64). */
    unpack: function (o) {
      var s = atob(o.points), n = o.count, L = [];
      for (var k = 0; k < n; k++) {
        var b = k * 6, x = s.charCodeAt(b) | (s.charCodeAt(b + 1) << 8), y = s.charCodeAt(b + 2) | (s.charCodeAt(b + 3) << 8);
        L.push([x / 65535 * 2 - 0.5, y / 65535 * 2 - 0.5, 0]);
      }
      return { landmarks: L, rotation: o.rotation || 0, score: o.score, image: o.image };
    },
    /* Source-photo fractions → layer-box fractions through the layer's crop. */
    toBox: function (layer, pt) { var c = layer && layer.crop || {}, cx = c.x || 0, cy = c.y || 0, cw = c.w == null ? 1 : c.w, ch = c.h == null ? 1 : c.h; return [(pt[0] - cx) / cw, (pt[1] - cy) / ch]; },
    anchors: function (layer, index) {
      var f = R.face.list(layer)[index || 0]; if (!f || !f.landmarks || f.landmarks.length < 468) return null;
      return RIG_IDX.map(function (i) { return R.face.toBox(layer, f.landmarks[Math.min(i, f.landmarks.length - 1)]); });
    },
    /* { rig } for a face-liquify entry, or null when the layer has no such face. */
    rig: function (layer, index) {
      var a = R.face.anchors(layer, index); if (!a) return null;
      var v = [a.length / 100]; a.forEach(function (q) { v.push((clamp(q[0], -0.5, 1.5) + 0.5) / 2, (clamp(q[1], -0.5, 1.5) + 0.5) / 2); });
      return { rig: R.data.write(v, 1, 'rig').rig0 };
    },
    readRig: function (p) {
      var v = R.data.read({ rig0: p.rig }, 1, 'rig'), n = Math.round((v[0] || 0) * 100), out = [];
      for (var i = 0; i < n && 2 + i * 2 <= v.length; i++) out.push([v[1 + i * 2] * 2 - 0.5, v[2 + i * 2] * 2 - 0.5]);
      return out.length >= RIG_IDX.length ? out : null;
    },
    /* Face width in document px and the matching detail size for the skin effects (face width ÷ 60). */
    size: function (layer, index) {
      var a = R.face.anchors(layer, index); if (!a) return null;
      var w = Math.hypot((a[22][0] - a[23][0]) * layer.w, (a[22][1] - a[23][1]) * layer.h);
      return { faceWidth: w, detailSize: Math.round(clamp(w / 60, 0.5, 40) * 10) / 10 };
    },
    /* Red-eye placement: the iris centres and a radius of about a fifth of the eye width. */
    eyes: function (layer, index) {
      var a = R.face.anchors(layer, index); if (!a) return null;
      var ew = Math.hypot((a[2][0] - a[3][0]) * layer.w, (a[2][1] - a[3][1]) * layer.h);
      return { eye1: { x: a[0][0], y: a[0][1] }, eye2: { x: a[1][0], y: a[1][1] }, radius: Math.round(ew * 0.2 * 10) / 10 };
    }
  };
  function bump(d, r) { if (!(d < r)) return 0; var t = d / r; return (1 - t * t) * (1 - t * t); }
  function ss(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  /* Forward field of the sliders, F(x, y) in document px, from anchors in document px. */
  R.face.field = function (A, p) {
    function V(a, b) { return [b[0] - a[0], b[1] - a[1]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
    function len(a) { return Math.hypot(a[0], a[1]); }
    function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    var E0 = A[0], E1 = A[1], iod = Math.max(len(V(E0, E1)), 1e-3), e1 = [(E1[0] - E0[0]) / iod, (E1[1] - E0[1]) / iod], e2 = [-e1[1], e1[0]];
    var O = mid(E0, E1), MC = mid(A[17], A[18]);
    if (dot(V(O, MC), e2) < 0) e2 = [-e2[0], -e2[1]];
    function uv(q) { var d = V(O, q); return [dot(d, e1), dot(d, e2)]; }
    var eyes = [{ c: mid(mid(A[2], A[3]), E0), w: Math.max(len(V(A[2], A[3])), 1), outer: A[2] }, { c: mid(mid(A[4], A[5]), E1), w: Math.max(len(V(A[4], A[5])), 1), outer: A[5] }];
    var N = A[10], nose = [A[10][0] * 0.8 + A[13][0] * 0.2, A[10][1] * 0.8 + A[13][1] * 0.2], noseW = Math.max(len(V(A[11], A[12])), iod * 0.3);
    var MA = A[14], MB = A[15], mouthW = Math.max(len(V(MA, MB)), iod * 0.3);
    var vm = uv(MC)[1], vchin = uv(A[20])[1], vtop = uv(A[21])[1], vbrow = (uv(A[26])[1] + uv(A[27])[1]) / 2;
    var hw = Math.max(Math.abs(uv(A[22])[0]), Math.abs(uv(A[23])[0]), iod * 0.8), hwj = Math.max(Math.abs(uv(A[24])[0]), Math.abs(uv(A[25])[0]), iod * 0.5);
    var UT = len(V(A[16], A[17])), LT = len(V(A[18], A[19]));
    var s = {}; FACE_SLIDERS.forEach(function (d) { s[d[0]] = (p[d[0]] || 0) / (d[3] === 'deg' ? 1 : 100); });
    return function (x, y) {
      var q = [x, y], fx = 0, fy = 0, u = uv(q), au = Math.abs(u[0]);
      function add(vec, k) { fx += vec[0] * k; fy += vec[1] * k; }
      if (s.faceWidth) add(e1, u[0] * s.faceWidth * (1 - ss(hw, hw * 1.45, au)) * ss(-0.35 * iod, 0.15 * iod, u[1]) * (1 - ss(vchin + 0.05 * iod, vchin + 0.5 * iod, u[1])));
      if (s.jawline) add(e1, u[0] * s.jawline * (1 - ss(hwj, hwj * 1.5, au)) * ss(vm - 0.2 * iod, vm + 0.25 * iod, u[1]) * (1 - ss(vchin + 0.05 * iod, vchin + 0.5 * iod, u[1])));
      if (s.chinHeight) { var tv = u[1] <= vchin ? ss(vm, vchin, u[1]) : 1 - ss(vchin, vchin + 0.6 * iod, u[1]); add(e2, s.chinHeight * (vchin - vm) * tv * (1 - ss(0.35 * iod, 0.75 * iod, au))); }
      if (s.forehead) { var tf = u[1] >= vtop ? ss(vbrow, vtop, u[1]) : 1 - ss(vtop, vtop - 0.5 * iod, u[1]); add(e2, -s.forehead * (vbrow - vtop) * tf * (1 - ss(hw * 1.1, hw * 1.5, au))); }
      eyes.forEach(function (ey, k) {
        var d = V(ey.c, q), dl = len(d), R1 = ey.w * 1.25, R2 = ey.w * 1.4;
        if (s.eyeSize) add(d, s.eyeSize * bump(dl, R1));
        if (s.eyeWidth) add(e1, dot(d, e1) * s.eyeWidth * bump(dl, R1));
        if (s.eyeHeight) add(e2, -s.eyeHeight * iod * bump(dl, R2));
        if (s.eyeDistance) add(e1, (k === 0 ? -1 : 1) * s.eyeDistance * iod * 0.5 * bump(dl, R2));
        if (s.eyeTilt) {
          var o = V(ey.c, ey.outer), perp = [-o[1], o[0]], sg = dot(perp, [-e2[0], -e2[1]]) > 0 ? 1 : -1, th = sg * s.eyeTilt * Math.PI / 180 * bump(dl, R1);
          add([d[0] * Math.cos(th) - d[1] * Math.sin(th) - d[0], d[0] * Math.sin(th) + d[1] * Math.cos(th) - d[1]], 1);
        }
      });
      if (s.noseWidth) { var dn = V(nose, q); add(e1, dot(dn, e1) * s.noseWidth * bump(len(dn), noseW * 0.95)); }
      if (s.noseHeight) add(e2, -s.noseHeight * iod * bump(len(V(N, q)), noseW * 0.85));
      var dm = V(MC, q), dml = len(dm);
      if (s.mouthWidth) add(e1, dot(dm, e1) * s.mouthWidth * bump(dml, mouthW * 0.85));
      if (s.mouthHeight) add(e2, -s.mouthHeight * iod * bump(dml, mouthW * 0.8));
      if (s.smile) [MA, MB].forEach(function (K) { var out = dot(V(MC, K), e1) > 0 ? 1 : -1; var b = bump(len(V(K, q)), mouthW * 0.4) * s.smile * mouthW; add([-e2[0] * 0.6 + e1[0] * 0.2 * out, -e2[1] * 0.6 + e1[1] * 0.2 * out], b); });
      if (s.upperLip) add(e2, -s.upperLip * UT * bump(len(V(A[16], q)), mouthW * 0.55));
      if (s.lowerLip) add(e2, s.lowerLip * LT * bump(len(V(A[19], q)), mouthW * 0.55));
      return [fx, fy];
    };
  };
  function faceOn(p) { return FACE_SLIDERS.some(function (d) { return p[d[0]]; }); }
  R.face.mesh = function (p, w, h) {
    var rig = R.face.readRig(p), m = Mesh(w, h);
    if (!rig || !faceOn(p)) return m;
    var A = rig.map(function (q) { return [q[0] * w, q[1] * h]; }), F = R.face.field(A, p);
    for (var j = 0; j < m.ny; j++) for (var i = 0; i < m.nx; i++) {
      var X = i * m.sp, Y = j * m.sp, f = F(X, Y), dx = -f[0], dy = -f[1];
      for (var it = 0; it < 4; it++) { f = F(X + dx, Y + dy); dx = -f[0]; dy = -f[1]; }
      m.dx[j * m.nx + i] = dx; m.dy[j * m.nx + i] = dy;
    }
    return clampMesh(m);
  };
  var faceMemo = memo(8);
  function faceMesh(p, w, h) { return faceMemo(JSON.stringify(p) + '|' + w + 'x' + h, function () { return R.face.mesh(p, w, h); }); }
  var FACE_PARAMS = { rig: R.data.param('Face anchors') };
  FACE_SLIDERS.forEach(function (d) { FACE_PARAMS[d[0]] = { type: 'number', min: -d[2], max: d[2], default: 0, step: d[3] === 'deg' ? 0.5 : 1, unit: d[3] === 'deg' ? 'deg' : '%', label: d[1] }; });
  FX.register({
    id: 'face-liquify', name: 'Face-aware liquify', group: 'geometry', version: 1, space: 'linear',
    params: FACE_PARAMS,
    radius: function (p, scale, bx) { if (!faceOn(p)) return 0; var box = hintGet(JSON.stringify(p), bx); return Math.ceil(faceMesh(p, box.w, box.h).max * scale) + 3; },
    passes: function (g, p) {
      if (!faceOn(p)) return undefined;
      hintSet(JSON.stringify(p), g.box);
      return warpPasses(g, faceMesh(p, g.box.w, g.box.h));
    },
    support: GPU(80),
    ui: { section: 'Geometry', order: 61, controls: [
      { param: 'rig', control: 'face-rig' },
      { heading: 'Face shape' }, 'faceWidth', 'jawline', 'chinHeight', 'forehead',
      { heading: 'Eyes' }, 'eyeSize', 'eyeHeight', 'eyeWidth', 'eyeTilt', 'eyeDistance',
      { heading: 'Nose' }, 'noseWidth', 'noseHeight',
      { heading: 'Mouth' }, 'smile', 'upperLip', 'lowerLip', 'mouthWidth', 'mouthHeight'
    ] },
    agent: {
      summary: 'Reshapes one face from its landmarks with named numeric sliders (face width, jawline, chin, forehead, eyes, nose, mouth, lips). Values are signed percentages of the feature (eye tilt in degrees). Needs the face rig: LE.fx.retouch.ops.face(doc, layerId, { jawline: -8 }) fills it from layer.maps.face. Nothing changes until a slider moves; it never runs on its own.',
      tips: [
        '"Slim the jaw by 8 %": jawline −8. "Eyes 5 % bigger": eyeSize 5. "A slight smile": smile 10.',
        'Stay within ±10 % for a believable result; several small moves read better than one large one.',
        'Faces turned more than about 45° have unreliable anchors: do not use it there.',
        'One entry per face ({ face: i } in ops.face, newEntry: true for the second). The rig holds 28 anchor points derived from the landmarks, stored only inside this design.',
        'Skin and part masks come from the unwarped landmarks; put face-liquify after skin retouching so the masks still line up.'
      ],
      example: { type: 'face-liquify', p: { jawline: -8, eyeSize: 4 } }
    }
  });

  /* ======================================================================================================================
     Shape warp: a generic, honest region warp (no body detection). Ellipse at center (box fractions), radii rx, ry
     (fractions of box width and height), rotation. Backward map inside the ellipse with weight b = (1 − ρ²)²:
       scale    q' = c + (q − c)(1 − a·b)            (+ magnifies, − shrinks)
       squeeze  x' = x(1 − a·b) along the ellipse's own x axis (− narrower, + wider)
       shift    q' = q − v·b, v = amount × rx in direction `angle`.
     a = amount/100 × 0.5. Analytic, one pass, bicubic sampling.
     ====================================================================================================================== */
  FX.register({
    id: 'shape-warp', name: 'Shape warp', group: 'geometry', version: 1, space: 'linear',
    params: {
      mode: { type: 'choice', options: [{ value: 'scale', label: 'Bloat / pinch' }, { value: 'squeeze', label: 'Narrow / widen' }, { value: 'shift', label: 'Shift' }], default: 'squeeze', label: 'Mode' },
      amount: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Amount' },
      center: { type: 'point', default: { x: 0.5, y: 0.5 }, label: 'Centre' },
      rx: { type: 'number', min: 0.01, max: 1, default: 0.2, step: 0.005, label: 'Width' },
      ry: { type: 'number', min: 0.01, max: 1, default: 0.2, step: 0.005, label: 'Height' },
      rotation: { type: 'angle', default: 0, label: 'Rotation' },
      angle: { type: 'angle', default: 0, label: 'Shift direction' }
    },
    radius: function (p, scale, bx) { if (!p.amount) return 0; var box = hintGet('shape|' + JSON.stringify(p), bx); return Math.ceil(Math.abs(p.amount) / 100 * Math.max(p.rx * box.w, p.ry * box.h) * scale) + 3; },
    passes: function (g, p) {
      if (!p.amount) return undefined;
      hintSet('shape|' + JSON.stringify(p), g.box);
      var b = g.box, a = p.amount / 100 * 0.5, mode = ['scale', 'squeeze', 'shift'].indexOf(p.mode);
      return g.pass(CUBIC + [
        'uniform vec4 u_e; uniform vec4 u_k;',
        'vec4 fx(){ vec2 q = docPos(), d = q - u_e.xy; float cs = cos(u_k.y), sn = sin(u_k.y); vec2 l = vec2(d.x * cs + d.y * sn, -d.x * sn + d.y * cs);',
        '  float r2 = dot(l / u_e.zw, l / u_e.zw); if (r2 >= 1.0) return texture(u_src, v_uv); float w = (1.0 - r2) * (1.0 - r2);',
        '  vec2 o;',
        '  if (u_k.x < 0.5) o = -d * u_k.z * w;',
        '  else if (u_k.x < 1.5) { vec2 lo = vec2(l.x * (1.0 - u_k.z * w), l.y); o = vec2(lo.x * cs - lo.y * sn, lo.x * sn + lo.y * cs) - d; }',
        '  else o = -vec2(cos(u_k.w), sin(u_k.w)) * u_k.z * 2.0 * u_e.z * w;',
        '  return cubic(v_uv + docToUV(o)); }'
      ].join('\n'), { u_e: [p.center.x * b.w, p.center.y * b.h, p.rx * b.w, p.ry * b.h], u_k: [mode, p.rotation * Math.PI / 180, a, p.angle * Math.PI / 180] });
    },
    support: GPU(40),
    ui: { section: 'Geometry', order: 62, controls: ['mode', 'amount', 'center', 'rx', 'ry', 'rotation', { param: 'angle', when: { mode: 'shift' } }] },
    agent: {
      summary: 'A smooth elliptical region warp for shapes and bodies: bloat or pinch, narrow or widen along the ellipse\'s own axis, or shift. It detects nothing: you place the ellipse.',
      tips: ['"Narrow the waist slightly": mode squeeze, amount −10, the ellipse over the waist with rx a little wider than the body.', 'Keep straight lines (door frames, horizons) outside the ellipse or they bend.', 'amount ±10–20 is subtle; the field falls to zero at the ellipse edge.'],
      example: { type: 'shape-warp', p: { mode: 'squeeze', amount: -12, center: { x: 0.5, y: 0.6 }, rx: 0.18, ry: 0.12 } }
    }
  });

  /* ======================================================================================================================
     Agent operations: each returns an LE.fx.ops operation (apply it with LE.fx.ops.apply(doc, op)), or null.
     ====================================================================================================================== */
  function findLayer(doc, id) {
    var ls = doc && (doc.layers || (doc.pages && doc.pages[0] && doc.pages[0].layers)) || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i];
    return null;
  }
  function firstEntry(layer, type) { var l = layer && layer.fx || []; for (var i = 0; i < l.length; i++) if (l[i].type === type) return l[i]; return null; }
  function upsert(doc, layerId, type, makeP, opts) {
    var layer = findLayer(doc, layerId), e = layer && !(opts && opts.newEntry) ? firstEntry(layer, type) : null;
    var base = e ? Object.assign(FX.defaults(type), e.p) : FX.defaults(type);
    var p = makeP(base);
    return e ? { op: 'fx.update', layer: layerId, id: e.id, p: p } : { op: 'fx.add', layer: layerId, entry: { type: type, p: p } };
  }
  R.ops = {
    /* { x, y, r } in box fractions (r of the long side) or { points }; source: { dx, dy }, or image for an automatic
       source; mode 'heal' | 'clone'; hardness, opacity. */
    heal: function (doc, layerId, o) {
      o = o || {};
      var d = o.source && isNum(o.source.dx) ? o.source : o.image ? R.suggestSource(o.image, { x: o.x, y: o.y, r: o.r || 0.01 }) : { dx: 0, dy: clamp((o.r || 0.01) * 3, 0, 1) };
      return upsert(doc, layerId, 'spot-heal', function (p) { return R.spots.add(p, { kind: o.mode === 'clone' ? 'clone' : 'heal', r: o.r || 0.01, hardness: isNum(o.hardness) ? o.hardness : 0.4, opacity: o.opacity, dx: d.dx, dy: d.dy, points: o.points || [[o.x, o.y, 1]] }); }, o);
    },
    clone: function (doc, layerId, o) { o = Object.assign({ hardness: 0.8 }, o); return R.ops.heal(doc, layerId, Object.assign({}, o, { mode: 'clone', source: { dx: o.dx || 0, dy: o.dy || 0 } })); },
    patch: function (doc, layerId, o) {
      o = o || {};
      return upsert(doc, layerId, 'spot-heal', function (p) { return R.spots.add(p, { kind: o.mode === 'clone' ? 'clone-polygon' : 'heal-polygon', r: o.feather || 0.004, opacity: o.opacity, dx: o.dx, dy: o.dy, points: o.polygon }); }, o);
    },
    liquify: function (doc, layerId, o) {
      o = o || {};
      return upsert(doc, layerId, 'liquify', function (p) { return R.liquify.add(p, { tool: o.tool || 'forward', size: o.size || 0.05, pressure: isNum(o.pressure) ? o.pressure : 0.6, density: isNum(o.density) ? o.density : 0.5, points: o.points || [] }); }, o);
    },
    /* Sliders by name (face-liquify params); opts.face = face index in layer.maps.face. Null when there is no such face. */
    face: function (doc, layerId, sliders, opts) {
      var layer = findLayer(doc, layerId), rig = R.face.rig(layer, opts && opts.face || 0);
      if (!rig) return null;
      return upsert(doc, layerId, 'face-liquify', function (p) { return Object.assign({}, p, rig, sliders || {}); }, opts);
    },
    redEye: function (doc, layerId, opts) {
      var layer = findLayer(doc, layerId), e = R.face.eyes(layer, opts && opts.face || 0);
      if (!e) return null;
      return upsert(doc, layerId, 'red-eye', function (p) { return Object.assign({}, p, e, opts && opts.p || {}); }, Object.assign({ newEntry: true }, opts));
    },
    /* The 50 % grey dodge-and-burn layer: an adjustment layer with a dodge and a burn entry whose masks select nothing yet
       (one part at density 0); paint each mask's asset part to dodge or burn there. */
    dodgeBurnLayer: function (doc, opts) {
      opts = opts || {};
      var empty = { on: true, invert: false, parts: [{ kind: 'radial', mode: 'add', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, density: 0 }] };
      var ex = isNum(opts.exposure) ? opts.exposure : 30;
      return { op: 'adjust.add', name: opts.name || 'Dodge and burn', fx: [
        { type: 'dodge-burn', p: { mode: 'dodge', exposure: ex, range: opts.range || 'midtones' }, mask: empty },
        { type: 'dodge-burn', p: { mode: 'burn', exposure: ex, range: opts.range || 'midtones' }, mask: empty }
      ] };
    }
  };
  /* A white-on-transparent mask canvas from shapes in box fractions, for an asset mask part ("dodge this polygon"):
     shapes [{ polygon: [[x, y]…] } | { stroke: [[x, y]…], r } | { circle: [x, y], r }], feather in canvas px. */
  R.maskCanvas = function (w, h, shapes, feather) {
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    var x = c.getContext('2d'), L = Math.max(c.width, c.height);
    if (feather) x.filter = 'blur(' + feather + 'px)';
    x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
    (shapes || []).forEach(function (s) {
      x.beginPath();
      if (s.polygon) { s.polygon.forEach(function (q, i) { if (i) x.lineTo(q[0] * c.width, q[1] * c.height); else x.moveTo(q[0] * c.width, q[1] * c.height); }); x.closePath(); x.fill(); }
      else if (s.stroke) { x.lineWidth = (s.r || 0.01) * 2 * L; s.stroke.forEach(function (q, i) { if (i) x.lineTo(q[0] * c.width, q[1] * c.height); else x.moveTo(q[0] * c.width, q[1] * c.height); }); x.stroke(); }
      else if (s.circle) { x.arc(s.circle[0] * c.width, s.circle[1] * c.height, (s.r || 0.01) * L, 0, Math.PI * 2); x.fill(); }
    });
    return c;
  };
  /* Helpers for agents (the fx.call operation): positions are fractions of the layer box. */
  if (FX.actions) {
    [['retouch.heal', 'heal', 'Heals a spot or a stroke from nearby texture.', { x: 'centre x', y: 'centre y', r: 'radius, fraction of the long side', points: 'or a stroke: [[x, y], ...]', source: 'optional { dx, dy }' }],
     ['retouch.clone', 'clone', 'Copies from an offset onto a spot or a stroke.', { x: 'centre x', y: 'centre y', r: 'radius', dx: 'source offset x', dy: 'source offset y' }],
     ['retouch.patch', 'patch', 'Heals the inside of a polygon.', { points: '[[x, y], ...]', dx: 'source offset x', dy: 'source offset y' }],
     ['retouch.liquify', 'liquify', 'One liquify stroke.', { tool: 'forward | pinch | bloat | twirl | restore', points: '[[x, y], ...]', size: 'brush size, fraction of the long side', pressure: '0 to 1' }],
     ['retouch.red-eye', 'redEye', 'Places red-eye removal on the eyes of a face (needs a face map).', { face: 'face index (default 0)' }]
    ].forEach(function (d) {
      FX.actions.register({ id: d[0], label: d[0], kind: 'call', summary: d[2], args: d[3], run: function (ctx) { return R.ops[d[1]](ctx.doc, ctx.layer.id, ctx.args); } });
    });
    FX.actions.register({ id: 'retouch.face', label: 'retouch.face', kind: 'call', summary: 'Face-aware liquify by named sliders (needs a face map: map.generate faces).', args: { sliders: '{ name: value } of face-liquify parameters', face: 'face index (default 0)' },
      run: function (ctx) { return R.ops.face(ctx.doc, ctx.layer.id, ctx.args.sliders || {}, ctx.args); } });
    FX.actions.register({ id: 'retouch.dodge-burn-layer', label: 'retouch.dodge-burn-layer', kind: 'call', summary: 'Adds a dodge and burn adjustment layer above the layer.', args: {},
      run: function (ctx) { return R.ops.dodgeBurnLayer(ctx.doc, Object.assign({ above: ctx.layer.id }, ctx.args)); } });
  }
})(window);
