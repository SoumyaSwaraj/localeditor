/* LocalEditor effect pack X3: shadows, reflections and compositing (LE.fx.composite). Contract: docs/FX-AUTHORING.md.
   Reference: docs/FX-REFERENCE.md, section "Shadows, reflections and compositing".

   Conventions used by every effect here
   - Light is composited in linear light with premultiplied alpha (`space: 'linear'`). The blend-mode effects are the exception: the
     standard blend formulas are defined on display-referred values, so they run in `display`.
   - Ground geometry: the subject is a flat cut-out standing on a ground plane. Its contact point (`anchor`, a fraction of the layer box)
     is where the base meets the ground; `LE.fx.composite.contact()` measures it from the cut-out and `stage()` writes it in.
   - Shadows and reflections are composited UNDER what is already there (subject over shadow), so a shadow never darkens the subject
     and two shadows multiply instead of adding. Anything that reaches outside the layer box declares `grow`; anything that reads
     around a pixel declares `radius`, so tiles join without seams.
   - Shadow colour ("receive: linear"): the page compositor draws layers source-over in sRGB. A shadow of strength s and tint T should
     multiply the backdrop by m = 1 − s·(1 − T) in linear light. Because sRGB is close to a 2.2 power law, multiplying linear light by m
     is multiplying the encoded value by m^(1/2.2), whatever the backdrop is; so the shadow is written with alpha α = 1 − min(m^(1/2.2))
     and the colour that makes a white backdrop come out exactly right. Neutral shadows are within about 2 % of a true linear multiply
     on any backdrop; tinted shadows are exact on white and approximate on dark backdrops. ("receive: normal" is the painter's over.)
   - Every effect is pixel-identical to no effect at its defaults (strength 0, identity geometry), and grows nothing then. */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;
  var M = FX.math, C = FX.composite = FX.composite || {};
  /* What casts shadows and glows is the layer as it entered the silhouette stage (g.subject): a reflection or an earlier shadow
     of the same stack does not cast one of its own, so the order of these effects no longer matters. */
  function subj(g) { return (typeof g.subject === 'function' && g.subject()) || g.source; }
  var GPU = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 120 };
  var GPU_HEAVY = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 200 };
  var D2R = Math.PI / 180;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function reachOf(sigmaDoc, scale) { return M.blurReach(Math.max(0, sigmaDoc) * scale); }

  /* ---------- GLSL shared by the passes ---------- */
  /* at(t, q): a handle sampled at a document position q (layer-box document pixels), tile- and rotation-safe. */
  var AT = 'vec4 at(sampler2D t, vec2 q){ return texture(t, v_uv + docToUV(q - docPos())); }\n';
  /* shade(s): a shadow of strength s as premultiplied linear RGBA (see the header comment). u_tint is linear, u_rcv 1 = linear multiply. */
  var SHADE = [
    'uniform vec3 u_tint; uniform float u_rcv;',
    'vec4 shade(float s){ s = clamp(s, 0.0, 1.0); if (s <= 0.0) return vec4(0.0);',
    '  if (u_rcv < 0.5) return vec4(u_tint * s, s);',
    '  vec3 m = 1.0 - s * (1.0 - u_tint); vec3 md = pow(max(m, vec3(1e-5)), vec3(1.0 / 2.2)); float a = 1.0 - min(md.r, min(md.g, md.b));',
    '  if (a <= 1e-6) return vec4(0.0); vec3 cd = clamp((md - 1.0 + a) / a, 0.0, 1.0); return vec4(toLinear(cd) * a, a); }',
    'vec4 under(vec4 s, vec4 sh){ return s + sh * (1.0 - s.a); }',
    ''
  ].join('\n');
  /* Four blur levels of one image with their sigmas (document pixels); lev(sg) interpolates between the two nearest. */
  var LEVELS = [
    'uniform sampler2D u_l0, u_l1, u_l2, u_l3; uniform vec4 u_sg;',
    'vec4 lev(float sg){ vec4 S = u_sg;',
    '  if (sg <= S.y) return mix(texture(u_l0, v_uv), texture(u_l1, v_uv), clamp((sg - S.x) / max(S.y - S.x, 1e-4), 0.0, 1.0));',
    '  if (sg <= S.z) return mix(texture(u_l1, v_uv), texture(u_l2, v_uv), clamp((sg - S.y) / max(S.z - S.y, 1e-4), 0.0, 1.0));',
    '  return mix(texture(u_l2, v_uv), texture(u_l3, v_uv), clamp((sg - S.z) / max(S.w - S.z, 1e-4), 0.0, 1.0)); }',
    ''
  ].join('\n');
  /* Smooth value noise in document space (the same construction as the starter grain). */
  var NOISE = 'float vnoise(vec2 p, float s){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(docNoise(i, s), docNoise(i + vec2(1.0, 0.0), s), f.x), mix(docNoise(i + vec2(0.0, 1.0), s), docNoise(i + vec2(1.0, 1.0), s), f.x), f.y); }\n';
  var ALPHA_OF = 'vec4 fx(){ return vec4(texture(u_src, v_uv).a); }';

  /* The shadow colour uniforms for shade(). */
  function shadeU(g, p) {
    var c = M.parseColor(p.color) || [0, 0, 0, 1];
    return { u_tint: [M.srgbToLinear(c[0]), M.srgbToLinear(c[1]), M.srgbToLinear(c[2])], u_rcv: p.receive === 'normal' ? 0 : 1 };
  }
  function linColor(hex) { var c = M.parseColor(hex) || [1, 1, 1, 1]; return [M.srgbToLinear(c[0]), M.srgbToLinear(c[1]), M.srgbToLinear(c[2])]; }

  /* Blur levels of `hard` at sigmas sg[0..3] (document pixels). Soft levels are made at reduced resolution (box-filtered), so the
     four levels together cost little more than one full-size target. */
  function blurLevels(g, hard, sg) {
    var out = [], cache = {};
    sg.forEach(function (s) {
      var key = s.toFixed(4);
      if (cache[key]) { out.push(cache[key]); return; }
      var px = s * g.scale, h = hard;
      if (px >= 0.35) {
        var k = 0;
        while (k < 3 && px / (1 << (k + 1)) >= 2) k++;
        if (k) { var chain = g.downsample(hard, k); h = chain[chain.length - 1]; for (var i = 0; i < chain.length - 1; i++) g.release(chain[i]); }
        h = g.blur(s, { source: h });
      }
      cache[key] = h;
      out.push(h);
    });
    return out;
  }
  function levelU(lv, sg) { return { u_l0: lv[0], u_l1: lv[1], u_l2: lv[2], u_l3: lv[3], u_sg: sg }; }

  var SHADOW_COMMON = {
    color: { type: 'color', default: '#000000', label: 'Colour' },
    receive: { type: 'choice', options: [{ value: 'linear', label: 'Multiply (linear light)' }, { value: 'normal', label: 'Normal' }], default: 'linear', label: 'Blend' },
    only: { type: 'bool', default: false, label: 'Shadow only', help: 'Hide the subject and keep only the shadow, to export it on transparency.' }
  };
  function withCommon(params) { var o = {}; Object.keys(params).forEach(function (k) { o[k] = params[k]; }); Object.keys(SHADOW_COMMON).forEach(function (k) { o[k] = SHADOW_COMMON[k]; }); return o; }
  var ANCHOR = { type: 'point', default: { x: 0.5, y: 1 }, label: 'Contact point', help: 'Where the subject meets the ground, as a fraction of the layer box. LE.fx.composite.contact() measures it.' };

  /* =====================================================================================================================
     Cast shadow: the silhouette projected onto the ground plane.
     Model: the subject is a flat card standing at the contact line y = anchor.y. A subject point at height h above that line (document
     pixels) and horizontal offset dx from the anchor lands on the ground at  O + (dx + h·a.x, h·a.y) / w,  w = 1 + c·h,
     where a = L·(cos φ, k·sin φ) is the shadow per unit height (L = 1/tan elevation, φ = ground azimuth, k = ground foreshortening) and
     c is a perspective term (far parts of the shadow shrink when it falls away from the camera). The shader inverts that map per pixel.
     Penumbra: the blur grows linearly from `blurNear` at the contact to `blurFar` at the top of the subject (an area light: penumbra
     width proportional to the occluder distance); four precomputed blur levels are interpolated per pixel.
     ===================================================================================================================== */
  function castGeo(p, box) {
    var L = 1 / Math.tan(clamp(p.elevation, 3, 89) * D2R), phi = p.direction * D2R;
    var ax = L * Math.cos(phi), ay = L * p.ground * Math.sin(phi);
    if (Math.abs(ay) < 0.04) ay = ay < 0 ? -0.04 : 0.04;   /* a shadow exactly along the ground line has no depth; keep a sliver */
    /* height 0: from the layer box, the part of it above the contact line */
    var o = box ? [p.anchor.x * box.w, p.anchor.y * box.h] : [0, 0], H = p.height > 0 ? p.height : box ? Math.max(1, p.anchor.y * box.h) : 300;
    var c = -p.perspective * 2 * ay / H;
    return { o: o, a: [ax, ay], c: c, H: H };
  }
  /* The projection reads the whole silhouette from g.whole(), the same reduced copy for every tile, so the neighbourhood a tile
     needs is the blur alone, however long the shadow is. */
  function castReach(p, scale) { return reachOf(p.blurFar, scale) + 4; }
  /* How far the shadow can lie outside the layer box: every subject pixel is inside the box, so the corners of the part of
     the box above the contact line, projected, bound it. */
  function castGrow(p, scale, box) {
    box = box && box.w ? box : { w: 2 * Math.max(1, p.height), h: Math.max(1, p.height) };
    var gm = castGeo(p, box), top = Math.max(1, gm.o[1]), gx = 0, gy = 0;
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var h = t * top, w = Math.max(0.2, 1 + gm.c * h);
      [-gm.o[0], box.w - gm.o[0]].forEach(function (dx) {
        var x = gm.o[0] + (dx + h * gm.a[0]) / w, y = gm.o[1] + h * gm.a[1] / w;
        gx = Math.max(gx, -x, x - box.w); gy = Math.max(gy, -y, y - box.h);
      });
    });
    return Math.ceil(Math.max(gx, gy, 0) * scale) + reachOf(p.blurFar, scale) + 4;
  }
  var CAST_PROJ = [
    'uniform vec2 u_o, u_a; uniform float u_c, u_far; uniform sampler2D u_w;',
    /* The silhouette at a position in the layer box (document pixels): from the whole-layer copy, or (without one) from the tile. */
    'float sil(vec2 q){ if (u_far > 0.5) { vec2 b = q / u_box; return texture(u_w, b).a * step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0); } return texture(u_src, v_uv + docToUV(q - docPos())).a; }',
    'vec4 fx(){ vec2 u = docPos() - u_o; float den = u_a.y - u_c * u.y; if (den * u_a.y <= 0.0) return vec4(0.0);',
    /* A pixel centred on the contact line has h = ±0 within rounding; accept up to three quarters of a pixel behind it so the row
       never flips between tiles. */
    '  float h = u.y / den; if (h < -0.75 / u_scale.y * abs(1.0 / den)) return vec4(0.0); h = max(h, 0.0);',
    /* Four taps across this pixel's footprint in height: a strongly foreshortened shadow minifies the subject vertically. */
    '  float dh = abs(1.0 / (u_scale.y * den)); float s = 0.0;',
    '  for (int i = 0; i < 4; i++) { float hh = max(h + dh * (float(i) - 1.5) * 0.25, 0.0); float w = max(1.0 + u_c * hh, 0.2);',
    '    vec2 q = vec2(u_o.x + u.x * w - hh * u_a.x, u_o.y - hh); s += sil(q); }',
    '  return vec4(s * 0.25); }'
  ].join('\n');
  var CAST_COMP = SHADE + LEVELS + [
    'uniform vec2 u_o, u_a; uniform float u_c, u_H, u_only; uniform vec4 u_k; uniform vec3 u_clip;',
    'vec4 fx(){ vec2 P = docPos(), u = P - u_o; float den = u_a.y - u_c * u.y;',
    '  float h = den * u_a.y > 0.0 ? max(u.y / den, 0.0) : u_H; float t = clamp(h / u_H, 0.0, 1.0);',
    '  float sg = mix(u_k.x, u_k.y, t); float cov = lev(sg).a;',
    '  float s = cov * u_k.z * mix(1.0, 1.0 - u_k.w, t);',
    '  if (u_clip.x > 0.5) s *= smoothstep(u_clip.y - u_clip.z, u_clip.y + u_clip.z + 1e-3, P.y);',
    '  vec4 sh = shade(s); return u_only > 0.5 ? sh : under(texture(u_src, v_uv), sh); }'
  ].join('\n');

  FX.register({
    id: 'cast-shadow', name: 'Cast shadow', group: 'shadow', version: 2, space: 'linear', needs: ['alpha'],
    params: withCommon({
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      direction: { type: 'angle', default: 300, label: 'Direction', help: 'Where the shadow falls on the ground: 0° right, 90° toward the camera, 180° left, 270° away.' },
      elevation: { type: 'number', min: 5, max: 85, default: 35, step: 0.5, unit: 'deg', label: 'Light elevation' },
      ground: { type: 'number', min: 0.05, max: 1, default: 0.3, step: 0.01, label: 'Ground tilt', help: 'How much the ground recedes: low for a camera near the floor, 1 for a top view.' },
      perspective: { type: 'number', min: 0, max: 1, default: 0.25, step: 0.01, label: 'Perspective' },
      blurNear: { type: 'number', min: 0, max: 60, default: 1.5, step: 0.1, unit: 'px', label: 'Contact blur' },
      blurFar: { type: 'number', min: 0, max: 250, default: 28, step: 0.5, unit: 'px', label: 'Far blur' },
      fade: { type: 'number', min: 0, max: 1, default: 0.7, step: 0.01, label: 'Fade' },
      height: { type: 'number', min: 0, max: 10000, default: 0, step: 1, unit: 'px', label: 'Subject height', help: 'Height of the subject above the contact point: sets how the blur and fade grow along the shadow. 0 takes the part of the layer box above the contact point; stage() and contact() fill it.' },
      anchor: ANCHOR,
      clip: { type: 'bool', default: false, label: 'Clip at a line' },
      clipY: { type: 'number', min: -1, max: 2, default: 0.5, step: 0.005, label: 'Clip line', help: 'Fraction of the box height: the shadow is removed above it (a wall, a table edge).' },
      clipSoft: { type: 'number', min: 0, max: 100, default: 2, step: 0.5, unit: 'px', label: 'Clip softness' }
    }),
    radius: function (p, s) { return p.opacity > 0 ? castReach(p, s) : 0; },
    grow: function (p, s, box) { return p.opacity > 0 ? castGrow(p, s, box) : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var gm = castGeo(p, g.box), far = g.whole({ maxSide: 1024 });
      var hard = g.pass(CAST_PROJ, { u_src: subj(g), u_w: far, u_far: far ? 1 : 0, u_o: gm.o, u_a: gm.a, u_c: gm.c });
      var d = p.blurFar - p.blurNear, sg = g.draft ? [p.blurNear, p.blurNear, p.blurFar, p.blurFar] : [p.blurNear, p.blurNear + d / 9, p.blurNear + d / 3, p.blurFar];
      var lv = blurLevels(g, hard, sg);
      var u = Object.assign({ u_o: gm.o, u_a: gm.a, u_c: gm.c, u_H: gm.H, u_only: p.only ? 1 : 0, u_k: [p.blurNear, p.blurFar, p.opacity, p.fade], u_clip: [p.clip ? 1 : 0, p.clipY * g.box.h, p.clipSoft] }, levelU(lv, sg), shadeU(g, p));
      return g.pass(CAST_COMP, u);
    },
    support: GPU_HEAVY,
    ui: { section: 'Shadows & reflections', order: 20, controls: ['opacity', 'direction', 'elevation', 'ground', 'perspective', { heading: 'Softness' }, 'blurNear', 'blurFar', 'fade', { heading: 'Placement' }, 'anchor', 'height', 'clip', { param: 'clipY', when: { clip: true } }, { param: 'clipSoft', when: { clip: true } }, { heading: 'Colour' }, 'color', 'receive', 'only'] },
    agent: {
      summary: 'A shadow cast by the cut-out onto the ground, from a light at a direction and elevation: hard at the contact, softer and fainter with distance. Composited under the subject in linear light.',
      tips: ['Set the anchor from LE.fx.composite.contact() (or use stage()); a wrong contact point makes the shadow float. Leave height at 0 to take it from the layer box, or set the subject\'s real height so blur and fade grow at the right rate.', 'Soft daylight: elevation 35–50, blurNear 1–2, blurFar 0.05–0.1 × subject height, opacity 0.5–0.7. Hard sun: elevation 25–40, blurFar 4–8, opacity 0.75.', 'direction 270 (away) hides most of the shadow behind the subject; 300–330 or 210–240 read best. Use shadowFromVanishing() so several subjects agree.', 'Put it after floor-reflection and refine-edge in the stack; pair with contact-shadow for a grounded look.', 'The whole silhouette casts however long the shadow is (it is read from a copy of the layer at most 1,024 pixels on its longer side), so on very large exports the contact edge is a little softer than the picture.'],
      example: { type: 'cast-shadow', p: { opacity: 0.6, direction: 315, elevation: 38, ground: 0.3, blurNear: 1.5, blurFar: 30, fade: 0.7, height: 420, anchor: { x: 0.5, y: 0.95 } } }
    }
  });

  /* =====================================================================================================================
     Contact shadow (ambient occlusion at the base): for a ground point at distance d from the contact line, the occluder is the
     subject's footprint directly above it; occlusion = max over a few heights of alpha · exp(−h / reach), h = d / squash, then blurred.
     ===================================================================================================================== */
  var CONTACT_FOOT = [
    'uniform vec2 u_o; uniform vec2 u_k;',
    'vec4 fx(){ vec2 P = docPos(); float d = abs(P.y - u_o.y); float h = d / u_k.y; if (h > 3.0 * u_k.x) return vec4(0.0); float a = 0.0;',
    '  for (int i = 0; i < 4; i++) { float hh = h + float(i) * u_k.x * 0.16; a = max(a, texture(u_src, v_uv + docToUV(vec2(P.x, u_o.y - hh) - P)).a * exp(-hh / u_k.x)); }',
    '  return vec4(a); }'
  ].join('\n');
  var CONTACT_COMP = SHADE + 'uniform sampler2D u_sh; uniform float u_op, u_only;\nvec4 fx(){ vec4 sh = shade(texture(u_sh, v_uv).a * u_op); return u_only > 0.5 ? sh : under(texture(u_src, v_uv), sh); }';
  function contactReach(p, s) { var R = Math.max(0.5, p.distance); return Math.ceil((3 * R * p.squash + 3.5 * R) * s) + reachOf(p.softness, s) + 3; }
  FX.register({
    id: 'contact-shadow', name: 'Contact shadow', group: 'shadow', version: 1, space: 'linear', needs: ['alpha'],
    params: withCommon({
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      distance: { type: 'number', min: 0.5, max: 200, default: 20, step: 0.5, unit: 'px', label: 'Reach' },
      softness: { type: 'number', min: 0, max: 100, default: 2.5, step: 0.5, unit: 'px', label: 'Softness' },
      squash: { type: 'number', min: 0.05, max: 1, default: 0.3, step: 0.01, label: 'Squash', help: 'How flat the occlusion lies on the ground: low for a camera near the floor.' },
      anchor: ANCHOR
    }),
    radius: function (p, s) { return p.opacity > 0 ? contactReach(p, s) : 0; },
    grow: function (p, s) { return p.opacity > 0 ? contactReach(p, s) : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var o = [p.anchor.x * g.box.w, p.anchor.y * g.box.h];
      var foot = g.pass(CONTACT_FOOT, { u_src: subj(g), u_o: o, u_k: [p.distance, p.squash] });
      var soft = p.softness > 0 ? g.blur(p.softness, { source: foot }) : foot;
      return g.pass(CONTACT_COMP, Object.assign({ u_sh: soft, u_op: p.opacity, u_only: p.only ? 1 : 0 }, shadeU(g, p)));
    },
    support: GPU,
    /* The section opens with the staging presets (C.presets; the composite.stage action): one tap, one undo step. */
    ui: { section: 'Shadows & reflections', order: 15, controls: [{ heading: 'Stage product' },
      { action: 'composite.stage', label: 'Studio white sweep', args: { preset: 'studio-white-sweep' } }, { action: 'composite.stage', label: 'Soft table reflection', args: { preset: 'soft-table-reflection' } },
      { action: 'composite.stage', label: 'Hard sun', args: { preset: 'hard-sun' } }, { action: 'composite.stage', label: 'Floating', args: { preset: 'floating' } }, { action: 'composite.stage', label: 'Dark glossy', args: { preset: 'dark-glossy' } },
      { heading: 'Contact shadow' }, 'opacity', 'distance', 'softness', 'squash', 'anchor', { heading: 'Colour' }, 'color', 'receive', 'only'] },
    agent: {
      summary: 'A tight, dark, soft occlusion where the subject touches the ground; the single most important cue that an object sits on a surface.',
      tips: ['Typical: opacity 0.8–0.9, distance 0.06–0.08 × subject height, softness 0.01 × height, squash 0.25–0.3 (the occlusion lies about distance × squash deep on the ground).', 'Always pair with a cast or floating shadow for a product shot; alone it reads as a studio sweep with overhead light.', 'Needs a correct anchor (LE.fx.composite.contact()).'],
      example: { type: 'contact-shadow', p: { opacity: 0.85, distance: 24, softness: 3, squash: 0.3, anchor: { x: 0.5, y: 0.95 } } }
    }
  });

  /* =====================================================================================================================
     Floating shadow: an elliptical ground shadow for an object hovering `height` pixels above the ground, analytic (one pass, no
     neighbourhood). The ellipse widens and softens, and fades, as the object rises (penumbra grows with occluder distance).
     The soft edge is a Gaussian-blurred ellipse approximated with the ellipse's first-order signed distance and an erf profile.
     ===================================================================================================================== */
  function floatGeo(p, box) {
    var wd = p.width > 0 ? p.width : box ? 0.8 * box.w : 240;   /* width 0: 0.8 × the layer box */
    var hgt = p.height, rx = Math.max(1, wd / 2 + hgt * 0.12), ry = Math.max(0.5, rx * p.aspect);
    var sigma = p.softness + hgt * 0.22, op = p.opacity / (1 + hgt / Math.max(1, wd));
    return { c: box ? [p.anchor.x * box.w, p.anchor.y * box.h + hgt * p.drop] : [0, hgt * p.drop], r: [rx, ry], sigma: Math.max(0.3, sigma), op: op };
  }
  /* The ellipse plus its blur, where it leaves the box. Without the box, assume the anchor may sit on the box edge. */
  function floatGrow(p, s, box) {
    var gm = floatGeo(p, box && box.w ? box : null), e = 3.2 * gm.sigma;
    if (!(box && box.w)) return Math.ceil(Math.max(gm.r[0], gm.c[1] + gm.r[1]) * s + e * s) + 2;
    return Math.ceil(Math.max(0, gm.r[0] + e - gm.c[0], gm.c[0] + gm.r[0] + e - box.w, gm.r[1] + e - gm.c[1], gm.c[1] + gm.r[1] + e - box.h) * s) + 2;
  }
  var FLOAT_COMP = SHADE + [
    'uniform vec2 u_c, u_r; uniform float u_sg, u_op, u_core, u_only;',
    'float erfc_(float x){ float t = 1.0 / (1.0 + 0.47047 * abs(x)); float y = t * (0.3480242 + t * (-0.0958798 + t * 0.7478556)) * exp(-x * x); return x >= 0.0 ? y : 2.0 - y; }',
    'float ell(vec2 q, vec2 R, float sg){ vec2 n = q / R; float r = length(n); vec2 gr = n / (R * max(r, 1e-4)); float d = (r - 1.0) / max(length(gr), 1e-6); return 0.5 * erfc_(d / (sg * 1.41421356)); }',
    'vec4 fx(){ vec2 q = docPos() - u_c; float v = ell(q, u_r, u_sg); if (u_core > 0.0) v = 1.0 - (1.0 - v) * (1.0 - u_core * ell(q, u_r * 0.55, u_sg * 0.5));',
    '  vec4 sh = shade(v * u_op); return u_only > 0.5 ? sh : under(texture(u_src, v_uv), sh); }'
  ].join('\n');
  FX.register({
    id: 'floating-shadow', name: 'Floating shadow', group: 'shadow', version: 2, space: 'linear', needs: ['alpha'],
    params: withCommon({
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      height: { type: 'number', min: 0, max: 1000, default: 40, step: 1, unit: 'px', label: 'Height', help: 'How far the object hovers above the ground.' },
      width: { type: 'number', min: 0, max: 8000, default: 0, step: 1, unit: 'px', label: 'Width', help: 'Shadow width at height 0, usually 0.8 × the subject width. 0 takes 0.8 × the layer box.' },
      aspect: { type: 'number', min: 0.02, max: 1, default: 0.14, step: 0.005, label: 'Flatness' },
      softness: { type: 'number', min: 0, max: 200, default: 6, step: 0.5, unit: 'px', label: 'Softness' },
      core: { type: 'number', min: 0, max: 1, default: 0.35, step: 0.01, label: 'Core' },
      drop: { type: 'number', min: 0, max: 2, default: 1, step: 0.01, label: 'Ground distance', help: 'How far below the contact point the shadow lies, as a multiple of height.' },
      anchor: ANCHOR
    }),
    radius: function () { return 0; },
    grow: function (p, s, box) { return p.opacity > 0 ? floatGrow(p, s, box) : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var gm = floatGeo(p, g.box);
      return g.pass(FLOAT_COMP, Object.assign({ u_c: gm.c, u_r: gm.r, u_sg: gm.sigma, u_op: gm.op, u_core: p.core, u_only: p.only ? 1 : 0 }, shadeU(g, p)));
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 30, controls: ['opacity', 'height', 'width', 'aspect', 'softness', 'core', 'drop', 'anchor', { heading: 'Colour' }, 'color', 'receive', 'only'] },
    agent: {
      summary: 'An elliptical shadow on the ground under a hovering object: wider, softer and fainter as height grows. One pass, no neighbourhood.',
      tips: ['Typical floating product: opacity 0.5, height 0.1–0.2 × subject height, width 0.8 × subject width, flatness 0.12.', 'Set anchor to the bottom of the subject (contact()); the shadow sits height × drop below it.', 'For a resting object use contact-shadow instead.'],
      example: { type: 'floating-shadow', p: { opacity: 0.5, height: 60, width: 300, aspect: 0.12, softness: 8, anchor: { x: 0.5, y: 0.92 } } }
    }
  });

  /* =====================================================================================================================
     Studio shadow: the familiar drop shadow (angle, distance, size, spread, noise) built as 1–4 stacked layers whose size and
     distance double each time ("layered" shadow) with strengths chosen so the stack is as dark as `opacity` where all overlap.
     Spread: the blurred alpha is divided by (1 − spread) before clamping, as in the familiar dialog.
     ===================================================================================================================== */
  function studioLayers(p) {
    var n = Math.round(p.layers), out = [], k = 1 - Math.pow(1 - p.opacity, 1 / n);
    for (var i = 0; i < n; i++) { var f = Math.pow(2, i - (n - 1)); out.push({ size: p.size * f, dist: p.distance * f, op: k }); }
    return out;
  }
  function studioReach(p, s) { return Math.ceil(p.distance * s) + reachOf(p.size, s) + 3; }
  var STUDIO_COMP = SHADE + NOISE + [
    'uniform sampler2D u_b0, u_b1, u_b2, u_b3; uniform vec4 u_d, u_op; uniform vec2 u_dir; uniform float u_spread, u_noise, u_seed, u_n, u_only;',
    'float cv(sampler2D t, float d){ return clamp(at(t, docPos() - u_dir * d).a / max(1.0 - u_spread, 0.02), 0.0, 1.0); }',
    'vec4 fx(){ float keep = 1.0 - cv(u_b0, u_d.x) * u_op.x;',
    '  if (u_n > 1.5) keep *= 1.0 - cv(u_b1, u_d.y) * u_op.y; if (u_n > 2.5) keep *= 1.0 - cv(u_b2, u_d.z) * u_op.z; if (u_n > 3.5) keep *= 1.0 - cv(u_b3, u_d.w) * u_op.w;',
    '  float s = 1.0 - keep; if (u_noise > 0.0) s *= clamp(1.0 + (docNoise(floor(docPos()), u_seed) - 0.5) * 2.0 * u_noise, 0.0, 2.0);',
    '  vec4 sh = shade(s); return u_only > 0.5 ? sh : under(texture(u_src, v_uv), sh); }'
  ].join('\n');
  FX.register({
    id: 'studio-shadow', name: 'Studio shadow', group: 'shadow', version: 1, space: 'linear', needs: ['alpha'],
    params: withCommon({
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      angle: { type: 'angle', default: 120, label: 'Angle', help: 'Where the light comes from (90° = from above); the shadow falls the other way.' },
      distance: { type: 'number', min: 0, max: 1000, default: 18, step: 0.5, unit: 'px', label: 'Distance' },
      size: { type: 'number', min: 0, max: 250, default: 24, step: 0.5, unit: 'px', label: 'Size' },
      spread: { type: 'number', min: 0, max: 0.95, default: 0, step: 0.01, label: 'Spread' },
      layers: { type: 'number', min: 1, max: 4, default: 1, step: 1, label: 'Layers', help: 'Stack 2–4 shadows of doubling size for a natural, layered falloff.' },
      noise: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Noise' },
      seed: { type: 'seed', default: 1, label: 'Seed' }
    }),
    radius: function (p, s) { return p.opacity > 0 ? studioReach(p, s) : 0; },
    grow: function (p, s) { return p.opacity > 0 ? studioReach(p, s) : 0; },
    draft: function (p) { var q = Object.assign({}, p); q.layers = Math.min(2, p.layers); return q; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var a = g.pass(ALPHA_OF, { u_src: subj(g) }), ls = studioLayers(p), b = [], d = [0, 0, 0, 0], op = [0, 0, 0, 0];
      ls.forEach(function (l, i) { b[i] = l.size > 0 ? g.blur(l.size, { source: a }) : a; d[i] = l.dist; op[i] = l.op; });
      for (var i = ls.length; i < 4; i++) b[i] = b[0];
      var r = p.angle * D2R;
      return g.pass(AT + STUDIO_COMP, Object.assign({ u_b0: b[0], u_b1: b[1], u_b2: b[2], u_b3: b[3], u_d: d, u_op: op, u_dir: [-Math.cos(r), Math.sin(r)], u_spread: p.spread, u_noise: p.noise, u_seed: p.seed % 65536, u_n: ls.length, u_only: p.only ? 1 : 0 }, shadeU(g, p)));
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 40, controls: ['opacity', 'angle', 'distance', 'size', 'spread', 'layers', 'noise', 'seed', { heading: 'Colour' }, 'color', 'receive', 'only'] },
    agent: {
      summary: 'A professional drop shadow from the silhouette: angle, distance, size, spread and noise, optionally stacked in 2–4 layers for a soft natural falloff. Composited under the subject.',
      tips: ['UI cards and floating objects: layers 3, distance 0.05 × height, size 0.08 × height, opacity 0.35.', 'Sticker look: layers 1, size 0, spread 0, distance 6, opacity 0.9.', 'angle follows the familiar convention: 120° puts the shadow down and to the right.', 'For an object standing on a floor use cast-shadow + contact-shadow instead.'],
      example: { type: 'studio-shadow', p: { opacity: 0.4, angle: 110, distance: 24, size: 36, layers: 3 } }
    }
  });

  /* =====================================================================================================================
     Inner shadow, outer glow, inner glow, rim light: alpha-driven layer styles.
     Inner shadow multiplies the subject in linear light; glows screen (outer glow is a coloured layer under the subject);
     rim light adds light along the edge facing the light.
     ===================================================================================================================== */
  function offReach(p, s) { return Math.ceil((p.distance || 0) * s) + reachOf(p.size, s) + 3; }
  var INNER_COMP = NOISE + [
    'uniform sampler2D u_b; uniform vec2 u_off; uniform float u_choke, u_op, u_noise, u_seed; uniform vec3 u_tint;',
    'vec4 fx(){ vec4 s = texture(u_src, v_uv); if (s.a <= 0.0) return s;',
    '  float k = clamp((1.0 - at(u_b, docPos() - u_off).a) / max(1.0 - u_choke, 0.02), 0.0, 1.0) * u_op;',
    '  if (u_noise > 0.0) k *= clamp(1.0 + (docNoise(floor(docPos()), u_seed) - 0.5) * 2.0 * u_noise, 0.0, 2.0);',
    '  return vec4(s.rgb * (1.0 - clamp(k, 0.0, 1.0) * (1.0 - u_tint)), s.a); }'
  ].join('\n');
  FX.register({
    id: 'inner-shadow', name: 'Inner shadow', group: 'shadow', version: 1, space: 'linear', needs: ['alpha'],
    params: {
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      angle: { type: 'angle', default: 120, label: 'Angle' },
      distance: { type: 'number', min: 0, max: 500, default: 6, step: 0.5, unit: 'px', label: 'Distance' },
      size: { type: 'number', min: 0, max: 250, default: 8, step: 0.5, unit: 'px', label: 'Size' },
      choke: { type: 'number', min: 0, max: 0.95, default: 0, step: 0.01, label: 'Choke' },
      noise: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Noise' },
      color: { type: 'color', default: '#000000', label: 'Colour' },
      seed: { type: 'seed', default: 1, label: 'Seed' }
    },
    radius: function (p, s) { return p.opacity > 0 ? offReach(p, s) : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var a = g.pass(ALPHA_OF), b = p.size > 0 ? g.blur(p.size, { source: a, edge: 'transparent' }) : a, r = p.angle * D2R;
      return g.pass(AT + INNER_COMP, { u_b: b, u_off: [-Math.cos(r) * p.distance, Math.sin(r) * p.distance], u_choke: p.choke, u_op: p.opacity, u_noise: p.noise, u_seed: p.seed % 65536, u_tint: linColor(p.color) });
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 50, controls: ['opacity', 'angle', 'distance', 'size', 'choke', 'noise', 'color', 'seed'] },
    agent: {
      summary: 'A shadow inside the silhouette, as if the shape were cut into the surface; multiplies the subject in linear light.',
      tips: ['Pressed or engraved look: distance 4, size 6, opacity 0.6.', 'distance 0 with a large size gives an inner vignette that follows the shape.'],
      example: { type: 'inner-shadow', p: { opacity: 0.55, angle: 120, distance: 5, size: 7 } }
    }
  });

  var OUTER_GLOW = 'uniform sampler2D u_b; uniform float u_spread, u_op, u_only; uniform vec3 u_col;\nvec4 fx(){ float g = clamp(texture(u_b, v_uv).a / max(1.0 - u_spread, 0.02), 0.0, 1.0) * u_op; vec4 gl = vec4(u_col * g, g); return u_only > 0.5 ? gl : texture(u_src, v_uv) + gl * (1.0 - texture(u_src, v_uv).a); }';
  FX.register({
    id: 'outer-glow', name: 'Outer glow', group: 'glow', version: 1, space: 'linear', needs: ['alpha'],
    params: {
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      size: { type: 'number', min: 0, max: 250, default: 16, step: 0.5, unit: 'px', label: 'Size' },
      spread: { type: 'number', min: 0, max: 0.95, default: 0.1, step: 0.01, label: 'Spread' },
      color: { type: 'color', default: '#fff3c4', label: 'Colour' },
      only: SHADOW_COMMON.only
    },
    radius: function (p, s) { return p.opacity > 0 ? reachOf(p.size, s) + 2 : 0; },
    grow: function (p, s) { return p.opacity > 0 ? reachOf(p.size, s) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var a = g.pass(ALPHA_OF, { u_src: subj(g) }), b = p.size > 0 ? g.blur(p.size, { source: a }) : a;
      return g.pass(OUTER_GLOW, { u_b: b, u_spread: p.spread, u_op: p.opacity, u_col: linColor(p.color), u_only: p.only ? 1 : 0 });
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 60, controls: ['opacity', 'size', 'spread', 'color', 'only'] },
    agent: {
      summary: 'A coloured halo around the silhouette, drawn under the subject.',
      tips: ['Neon or backlit look on dark backgrounds: size 20–40, spread 0.1, a saturated colour.', 'On light backgrounds a glow reads as a fringe; prefer a soft studio-shadow.'],
      example: { type: 'outer-glow', p: { opacity: 0.8, size: 24, spread: 0.15, color: '#7fd4ff' } }
    }
  });

  var INNER_GLOW = 'uniform sampler2D u_b; uniform float u_choke, u_op, u_center; uniform vec3 u_col;\nvec4 fx(){ vec4 s = texture(u_src, v_uv); if (s.a <= 0.0) return s; float b = texture(u_b, v_uv).a; float g = u_center > 0.5 ? b : 1.0 - b; g = clamp(g / max(1.0 - u_choke, 0.02), 0.0, 1.0) * u_op; vec3 c = s.rgb / s.a; c = 1.0 - (1.0 - c) * (1.0 - u_col * g); return vec4(c * s.a, s.a); }';
  FX.register({
    id: 'inner-glow', name: 'Inner glow', group: 'glow', version: 1, space: 'linear', needs: ['alpha'],
    params: {
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      source: { type: 'choice', options: [{ value: 'edge', label: 'Edge' }, { value: 'center', label: 'Centre' }], default: 'edge', label: 'Source' },
      size: { type: 'number', min: 0, max: 250, default: 12, step: 0.5, unit: 'px', label: 'Size' },
      choke: { type: 'number', min: 0, max: 0.95, default: 0, step: 0.01, label: 'Choke' },
      color: { type: 'color', default: '#fff3c4', label: 'Colour' }
    },
    radius: function (p, s) { return p.opacity > 0 ? reachOf(p.size, s) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var a = g.pass(ALPHA_OF), b = p.size > 0 ? g.blur(p.size, { source: a, edge: 'transparent' }) : a;
      return g.pass(INNER_GLOW, { u_b: b, u_choke: p.choke, u_op: p.opacity, u_center: p.source === 'center' ? 1 : 0, u_col: linColor(p.color) });
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 70, controls: ['opacity', 'source', 'size', 'choke', 'color'] },
    agent: {
      summary: 'Light that screens over the subject from its edges inward (or from its centre outward).',
      tips: ['Edge, size 10, opacity 0.4, a warm white: a subtle backlit rim on icons and text.'],
      example: { type: 'inner-glow', p: { opacity: 0.4, size: 10, color: '#ffffff' } }
    }
  });

  var RIM_EDGE = 'uniform vec2 u_dir;\nvec4 fx(){ float a = texture(u_src, v_uv).a; float b = texture(u_src, v_uv + docToUV(u_dir)).a; return vec4(a * (1.0 - b)); }';
  var RIM_COMP = 'uniform sampler2D u_e; uniform float u_k; uniform vec3 u_col;\nvec4 fx(){ vec4 s = texture(u_src, v_uv); if (s.a <= 0.0) return s; float e = clamp(texture(u_e, v_uv).a * u_k, 0.0, 4.0) * s.a; return vec4(s.rgb + u_col * e * s.a, s.a); }';
  FX.register({
    id: 'edge-light', name: 'Edge light', group: 'light', version: 1, space: 'linear', needs: ['alpha'],
    params: {
      intensity: { type: 'number', min: 0, max: 4, default: 0, step: 0.01, label: 'Intensity' },
      angle: { type: 'angle', default: 135, label: 'Light angle', help: 'Where the light comes from: 0° right, 90° above, 180° left.' },
      width: { type: 'number', min: 0.5, max: 100, default: 4, step: 0.5, unit: 'px', label: 'Width' },
      softness: { type: 'number', min: 0, max: 100, default: 3, step: 0.5, unit: 'px', label: 'Softness' },
      color: { type: 'color', default: '#ffffff', label: 'Colour' }
    },
    radius: function (p, s) { return p.intensity > 0 ? Math.ceil(p.width * s) + reachOf(p.softness, s) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.intensity > 0)) return;
      var r = p.angle * D2R, e = g.pass(RIM_EDGE, { u_dir: [Math.cos(r) * p.width, -Math.sin(r) * p.width] });
      var eb = p.softness > 0 ? g.blur(p.softness, { source: e }) : e;
      return g.pass(RIM_COMP, { u_e: eb, u_k: p.intensity, u_col: linColor(p.color) });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 80, controls: ['intensity', 'angle', 'width', 'softness', 'color'] },
    agent: {
      summary: 'Adds light (linear, additive) along the edge of the silhouette that faces a light: a simple rim or kicker light to match a bright background. True relighting is a later pack.',
      tips: ['Match the angle to the brightest area of the background; intensity 0.3–0.8, width 3–6, softness 2–4.', 'Use a colour sampled from the background light for integration.'],
      example: { type: 'edge-light', p: { intensity: 0.6, angle: 140, width: 4, softness: 3, color: '#fff1d6' } }
    }
  });

  /* =====================================================================================================================
     Long shadow (flat design): the silhouette swept along a direction for `length` pixels, with an optional fade.
     v_n(p) = max(v_{n−1}(p), v_{n−1}(p − 2^(n−1)·d)·f^(2^(n−1))) doubles the swept length per pass (log2 passes); a final pass with
     a fractional offset makes the length exact.
     ===================================================================================================================== */
  var LONG_STEP = 'uniform vec2 u_d; uniform float u_f;\nvec4 fx(){ float a = texture(u_src, v_uv).a; float b = texture(u_src, v_uv - docToUV(u_d)).a * u_f; return vec4(max(a, b)); }';
  FX.register({
    id: 'long-shadow', name: 'Long shadow', group: 'shadow', version: 1, space: 'linear', needs: ['alpha'],
    params: withCommon({
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      angle: { type: 'angle', default: 135, label: 'Angle', help: 'Where the light comes from; 135° sends the shadow down and to the right.' },
      length: { type: 'number', min: 1, max: 2000, default: 200, step: 1, unit: 'px', label: 'Length' },
      fade: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Fade' }
    }),
    radius: function (p, s) { return p.opacity > 0 ? Math.ceil(p.length * s) + 3 : 0; },
    grow: function (p, s) { return p.opacity > 0 ? Math.ceil(p.length * s) + 3 : 0; },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var r = p.angle * D2R, dir = [-Math.cos(r), Math.sin(r)], Lpx = Math.max(1, p.length * g.scale), cur = g.pass(ALPHA_OF, { u_src: subj(g) });
      var perPx = p.fade > 0 ? Math.pow(Math.max(1e-4, 1 - p.fade), 1 / Lpx) : 1, step = 1, covered = 0;
      while (covered * 2 + 1 < Lpx && step < 8192) {
        var nx = g.pass(LONG_STEP, { u_src: cur, u_d: [dir[0] * step / g.scale, dir[1] * step / g.scale], u_f: Math.pow(perPx, step) });
        g.release(cur); cur = nx; covered = covered * 2 + 1; step *= 2;
      }
      var last = Lpx - covered;
      if (last > 0) { var fin = g.pass(LONG_STEP, { u_src: cur, u_d: [dir[0] * last / g.scale, dir[1] * last / g.scale], u_f: Math.pow(perPx, last) }); g.release(cur); cur = fin; }
      return g.pass(SHADE + 'uniform sampler2D u_sh; uniform float u_op, u_only;\nvec4 fx(){ vec4 sh = shade(texture(u_sh, v_uv).a * u_op); return u_only > 0.5 ? sh : under(texture(u_src, v_uv), sh); }', Object.assign({ u_sh: cur, u_op: p.opacity, u_only: p.only ? 1 : 0 }, shadeU(g, p)));
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 80, controls: ['opacity', 'angle', 'length', 'fade', 'color', 'receive', 'only'] },
    agent: {
      summary: 'The flat-design long shadow: the silhouette extruded along a direction, hard-edged, optionally fading. Log2(length) passes.',
      tips: ['Icons and lettering: angle 135, length 3–5× the shape size, opacity 0.25, colour a darker shade of the background.', 'Clip the page or group to the background shape so the shadow ends at its edge.'],
      example: { type: 'long-shadow', p: { opacity: 0.3, angle: 135, length: 400, fade: 0.4, color: '#1d3557', receive: 'normal' } }
    }
  });

  /* =====================================================================================================================
     Reflections: the subject mirrored about the contact line (a vertical flip about y = anchor.y, scaled by `perspective` for a camera
     above the floor), faded with distance d below the line, blurred more with distance (glossy blur ∝ d·roughness), with a
     Schlick-like fresnel term (strong near the contact, where the floor is seen at a grazing angle), optional ripple / waves (seeded
     value noise in document space), and a tint for the floor colour. Composited under the subject, premultiplied, linear.
     ===================================================================================================================== */
  function reflGeo(p, box) { return { o: [p.anchor.x * box.w, p.anchor.y * box.h], D: Math.max(1, p.distance) }; }
  function reflReach(p, s) {
    var D = Math.max(1, p.distance), amp = p.ripple * (p.waveSize || 20) + (p.chop || 0) * (p.waveSize || 20);
    return Math.ceil((D + D / Math.max(0.2, p.perspective) + amp * 2) * s) + reachOf(p.blur + p.roughness * 0.25 * D, s) + 4;
  }
  function reflGrow(p, s) { var D = Math.max(1, p.distance); return Math.ceil((D + p.ripple * (p.waveSize || 20) * 2) * s) + reachOf(p.blur + p.roughness * 0.25 * D, s) + 4; }
  var REFL_MIRROR = NOISE + [
    'uniform vec2 u_o; uniform vec4 u_r; uniform vec4 u_w;',     /* u_r: perspective, D, ripple amplitude, wave size; u_w: seed, water(0/1), chop, stretch */
    'vec4 fx(){ vec2 P = docPos(); float d = P.y - u_o.y; if (d < -0.75 / u_scale.y || d > u_r.y) return vec4(0.0); d = max(d, 0.0); float t = d / u_r.y; vec2 off = vec2(0.0);',
    '  if (u_r.z > 0.0 || u_w.z > 0.0) { float ws = max(u_r.w, 0.5);',
    '    if (u_w.y > 0.5) { vec2 q = vec2(P.x / (ws * u_w.w), P.y / ws); off.x = (vnoise(q, u_w.x) - 0.5) * 2.0 * u_r.z * ws * (0.25 + t) + sin(P.y / ws * 6.2831 + vnoise(q * 0.5, u_w.x + 7.0) * 6.0) * u_r.z * ws * 0.35 * (0.25 + t);',
    '      off.y = (vnoise(q * 1.7 + 13.0, u_w.x + 3.0) - 0.5) * 2.0 * u_w.z * ws * (0.2 + t); }',
    '    else { vec2 q = P / ws; off.x = (vnoise(q, u_w.x) - 0.5) * 2.0 * u_r.z * ws * t; off.y = (vnoise(q + 31.0, u_w.x + 1.0) - 0.5) * u_r.z * ws * t; } }',
    '  float dy = max(d + off.y, 0.0) / u_r.x; vec2 q = vec2(P.x + off.x, u_o.y - dy);',
    '  return texture(u_src, v_uv + docToUV(q - P)); }'
  ].join('\n');
  var REFL_COMP = LEVELS + [
    'uniform vec2 u_o; uniform vec4 u_k; uniform vec3 u_tint; uniform float u_fres, u_only, u_near;',   /* u_k: blur0, roughness, opacity, D */
    'float schlick(float t){ float c = mix(0.04, 0.95, t); return 0.04 + 0.96 * pow(1.0 - c, 5.0); }',
    'vec4 fx(){ vec2 P = docPos(); float d = P.y - u_o.y; vec4 s = texture(u_src, v_uv); if (d < -2.0 / u_scale.y) return u_only > 0.5 ? vec4(0.0) : s;',
    '  float t = clamp(d / u_k.w, 0.0, 1.0); float sg = u_k.x + u_k.y * 0.25 * max(d, 0.0); vec4 r = lev(sg);',
    '  float f = mix(1.0, schlick(t) / schlick(0.0), u_fres); float k = u_k.z * f * (1.0 - smoothstep(0.0, 1.0, t)) * smoothstep(-2.0 / u_scale.y, 0.0, d) * u_near;',
    '  r = vec4(r.rgb * u_tint, r.a) * k; return u_only > 0.5 ? r : s + r * (1.0 - s.a); }'
  ].join('\n');
  function reflPasses(g, p, water) {
    if (!(p.opacity > 0)) return;
    var gm = reflGeo(p, g.box);
    var mir = g.pass(REFL_MIRROR, { u_o: gm.o, u_r: [p.perspective, gm.D, p.ripple, p.waveSize || 20], u_w: [(p.seed || 0) % 65536, water ? 1 : 0, p.chop || 0, p.stretch || 1] });
    var far = p.blur + p.roughness * 0.25 * gm.D, d = far - p.blur;
    var sg = g.draft ? [p.blur, p.blur, far, far] : [p.blur, p.blur + d / 9, p.blur + d / 3, far];
    var lv = blurLevels(g, mir, sg);
    return g.pass(REFL_COMP, Object.assign({ u_o: gm.o, u_k: [p.blur, p.roughness, p.opacity, gm.D], u_tint: linColor(p.tint), u_fres: p.fresnel, u_only: p.only ? 1 : 0, u_near: 1 }, levelU(lv, sg)));
  }
  var REFL_PARAMS = {
    opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
    distance: { type: 'number', min: 1, max: 4000, default: 240, step: 1, unit: 'px', label: 'Fade distance' },
    blur: { type: 'number', min: 0, max: 60, default: 0.5, step: 0.1, unit: 'px', label: 'Blur' },
    roughness: { type: 'number', min: 0, max: 1, default: 0.15, step: 0.01, label: 'Roughness', help: 'Blur that grows with distance from the contact line.' },
    fresnel: { type: 'number', min: 0, max: 1, default: 0.5, step: 0.01, label: 'Fresnel' },
    perspective: { type: 'number', min: 0.3, max: 1.5, default: 1, step: 0.01, label: 'Perspective', help: 'Height of the reflection against the subject: below 1 for a camera above the floor.' },
    tint: { type: 'color', default: '#ffffff', label: 'Surface colour' },
    anchor: ANCHOR
  };
  FX.register({
    id: 'floor-reflection', name: 'Floor reflection', group: 'reflection', version: 1, space: 'linear', needs: ['alpha'],
    params: Object.assign({}, REFL_PARAMS, {
      ripple: { type: 'number', min: 0, max: 2, default: 0, step: 0.01, label: 'Ripple' },
      waveSize: { type: 'number', min: 1, max: 200, default: 18, step: 0.5, unit: 'px', label: 'Ripple size' },
      seed: { type: 'seed', default: 1, label: 'Seed' },
      only: { type: 'bool', default: false, label: 'Reflection only' }
    }),
    radius: function (p, s) { return p.opacity > 0 ? reflReach(p, s) : 0; },
    grow: function (p, s) { return p.opacity > 0 ? reflGrow(p, s) : 0; },
    passes: function (g, p) { return reflPasses(g, p, false); },
    support: GPU_HEAVY,
    ui: { section: 'Shadows & reflections', order: 90, controls: ['opacity', 'distance', 'blur', 'roughness', 'fresnel', 'perspective', 'tint', 'anchor', { heading: 'Ripple' }, 'ripple', { param: 'waveSize', when: {} }, 'seed', 'only'] },
    agent: {
      summary: 'A mirror image of the subject on a glossy floor: flipped about the contact line, fading and blurring with distance, stronger near the contact (fresnel), optionally rippled.',
      tips: ['Glossy acrylic: opacity 0.35, distance 0.5 × subject height, roughness 0.1, fresnel 0.6. Satin table: opacity 0.2, roughness 0.5, distance 0.35 × height.', 'Dark glossy surface: tint near the floor colour (e.g. #808080) and opacity 0.5.', 'Put it before the shadows in the stack, so shadows are not reflected; reflections are only drawn below the contact line.', 'perspective 0.8–0.95 when the camera looks down on the product.'],
      example: { type: 'floor-reflection', p: { opacity: 0.35, distance: 300, roughness: 0.12, fresnel: 0.6, anchor: { x: 0.5, y: 0.95 } } }
    }
  });
  FX.register({
    id: 'water-reflection', name: 'Water reflection', group: 'reflection', version: 1, space: 'linear', needs: ['alpha'],
    params: Object.assign({}, REFL_PARAMS, {
      distance: { type: 'number', min: 1, max: 4000, default: 600, step: 1, unit: 'px', label: 'Fade distance' },
      roughness: { type: 'number', min: 0, max: 1, default: 0.05, step: 0.01, label: 'Roughness' },
      fresnel: { type: 'number', min: 0, max: 1, default: 0.3, step: 0.01, label: 'Fresnel' },
      tint: { type: 'color', default: '#b8c8d0', label: 'Water colour' },
      ripple: { type: 'number', min: 0, max: 2, default: 0.6, step: 0.01, label: 'Waves' },
      waveSize: { type: 'number', min: 1, max: 200, default: 10, step: 0.5, unit: 'px', label: 'Wave size' },
      chop: { type: 'number', min: 0, max: 2, default: 0.4, step: 0.01, label: 'Chop' },
      stretch: { type: 'number', min: 1, max: 12, default: 5, step: 0.1, label: 'Stretch', help: 'How much wider than tall the wave cells are.' },
      seed: { type: 'seed', default: 1, label: 'Seed' },
      only: { type: 'bool', default: false, label: 'Reflection only' }
    }),
    radius: function (p, s) { return p.opacity > 0 ? reflReach(p, s) : 0; },
    grow: function (p, s) { return p.opacity > 0 ? reflGrow(p, s) : 0; },
    passes: function (g, p) { return reflPasses(g, p, true); },
    support: GPU_HEAVY,
    ui: { section: 'Shadows & reflections', order: 95, controls: ['opacity', 'distance', 'ripple', 'waveSize', 'chop', 'stretch', 'seed', { heading: 'Surface' }, 'blur', 'roughness', 'fresnel', 'perspective', 'tint', 'anchor', 'only'] },
    agent: {
      summary: 'A reflection on water: the mirrored subject broken by seeded, horizontally stretched waves, tinted by the water colour and fading with distance.',
      tips: ['Calm lake: waves 0.3, chop 0.2, stretch 6. Choppy: waves 1, chop 0.8, stretch 3.', 'Set the anchor at the waterline. Change seed for another wave pattern.'],
      example: { type: 'water-reflection', p: { opacity: 0.6, distance: 500, ripple: 0.6, waveSize: 10, chop: 0.4, stretch: 5, anchor: { x: 0.5, y: 0.9 } } }
    }
  });

  /* Glass reflection overlay: procedural window-light streaks across the subject (a colour operation, so it fuses into the colour pass).
     Bands lie along `angle`, at seeded positions across the box, each a smooth bump, screened in linear light. */
  FX.register({
    id: 'glass-reflection', name: 'Glass reflection', group: 'reflection', version: 1, space: 'linear',
    params: {
      amount: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Amount' },
      angle: { type: 'angle', default: 60, label: 'Angle' },
      bands: { type: 'number', min: 1, max: 6, default: 2, step: 1, label: 'Streaks' },
      width: { type: 'number', min: 0.01, max: 0.5, default: 0.1, step: 0.005, label: 'Width' },
      softness: { type: 'number', min: 0, max: 1, default: 0.5, step: 0.01, label: 'Softness' },
      falloff: { type: 'number', min: 0, max: 1, default: 0.4, step: 0.01, label: 'Falloff', help: 'How much the streaks fade along their length.' },
      color: { type: 'color', default: '#ffffff', label: 'Colour' },
      seed: { type: 'seed', default: 3, label: 'Seed' }
    },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var r = p.angle * D2R, pos = [], wid = [], h = p.seed >>> 0;
      for (var i = 0; i < 6; i++) {
        h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9 + i | 0;
        var u = ((h >>> 8) & 0xffff) / 65535, v = ((h >>> 3) & 0x3ff) / 1023;
        pos.push(i < p.bands ? -0.35 + (i + 0.2 + u * 0.6) * 1.7 / p.bands : 99); wid.push(p.width * (0.45 + v * 1.1));
      }
      g.color([
        'uniform vec2 $d; uniform float $pos[6]; uniform float $wid[6]; uniform vec4 $k; uniform vec3 $c;',
        'vec3 $fx(vec3 c){ vec2 q = boxUV() - 0.5; float s = dot(q, vec2(-$d.y, $d.x)), l = dot(q, $d); float v = 0.0;',
        '  for (int i = 0; i < 6; i++) { float x = abs(s - $pos[i]) / $wid[i]; v += 1.0 - smoothstep(1.0 - $k.y, 1.0 + 1e-3, x); }',
        '  v *= 1.0 - $k.z * smoothstep(-0.5, 0.7, l); float k = clamp(v * $k.x, 0.0, 1.0); return 1.0 - (1.0 - c) * (1.0 - $c * k); }'
      ].join('\n'), { d: [Math.cos(r), -Math.sin(r)], pos: pos, wid: wid, k: [p.amount, p.softness, p.falloff, 0], c: linColor(p.color) });
    },
    support: GPU,
    ui: { section: 'Shadows & reflections', order: 100, controls: ['amount', 'angle', 'bands', 'width', 'softness', 'falloff', 'color', 'seed'] },
    agent: {
      summary: 'Soft window-light streaks screened over the subject, as reflected on glass or glossy packaging. A colour operation: free when merged with other colour effects.',
      tips: ['Bottles and phone screens: amount 0.25–0.4, 2 streaks, width 0.08, angle 60, softness 0.6.', 'It follows the layer box, not the shape; the cut-out keeps it inside the subject.'],
      example: { type: 'glass-reflection', p: { amount: 0.3, angle: 62, bands: 2, width: 0.08, softness: 0.6, seed: 4 } }
    }
  });

  /* =====================================================================================================================
     Edge refinement for cut-outs (premultiplied, linear).
     Alpha: smooth = Gaussian blur of alpha (σ = max(smooth, |shift|·0.6)); shift edge = re-threshold at t = Φ(−shift/σ) (the level of
     a blurred step at that offset); the ramp slope keeps the edge about 1.5 target pixels wide, multiplied by `contrast`;
     feather = blur after. Colour: decontamination replaces the colour of edge pixels (within `defringe` of the interior) with the
     interior colour pushed outward (blur(c·w)/blur(w), w = interior weight), which removes the old background's spill; pixels that
     become visible because the edge moved out take that pushed colour too, never black.
     ===================================================================================================================== */
  function erf(x) { var t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  function refineNeutral(p) { return !p.smooth && !p.shift && !p.contrast && !p.feather && !p.decontaminate; }
  function refineReach(p, s) { var sg = Math.max(p.smooth, Math.abs(p.shift) * 0.6); return reachOf(sg, s) + reachOf(p.feather, s) + reachOf(Math.max(1, p.defringe * 0.5, Math.abs(p.shift) * 0.75, p.feather), s) + 2; }
  /* Maps [t − w, t + w] to [0, 1] with w = min(t, 1 − t, 0.5 / slope): 0 and 1 stay put, the edge level moves to t. */
  var REF_RAMP = 'uniform vec2 u_t;\nvec4 fx(){ float a = texture(u_src, v_uv).a; float w = max(min(min(u_t.x, 1.0 - u_t.x), 0.5 / u_t.y), 1e-4); return vec4(clamp((a - u_t.x) / (2.0 * w) + 0.5, 0.0, 1.0)); }';
  var REF_W = 'vec4 fx(){ vec4 s = texture(u_src, v_uv); float w = smoothstep(0.85, 1.0, s.a); vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0); return vec4(c * w, w); }';
  var REF_COMP = [
    'uniform sampler2D u_a, u_in; uniform float u_dec;',
    'vec4 fx(){ vec4 s = texture(u_src, v_uv); float a = texture(u_a, v_uv).a; vec4 ib = texture(u_in, v_uv);',
    '  vec3 orig = s.a > 0.0 ? s.rgb / s.a : vec3(0.0); vec3 inner = ib.a > 1e-4 ? ib.rgb / ib.a : orig;',
    '  float band = 1.0 - smoothstep(0.5, 0.97, ib.a); float known = smoothstep(0.0, 0.12, s.a);',
    '  vec3 c = mix(inner, mix(orig, inner, u_dec * band), known); return vec4(c * a, a); }'
  ].join('\n');
  FX.register({
    id: 'refine-edge', name: 'Refine edge', group: 'compositing', version: 1, space: 'linear', needs: ['alpha'],
    params: {
      smooth: { type: 'number', min: 0, max: 30, default: 0, step: 0.1, unit: 'px', label: 'Smooth' },
      feather: { type: 'number', min: 0, max: 50, default: 0, step: 0.1, unit: 'px', label: 'Feather' },
      contrast: { type: 'number', min: 0, max: 100, default: 0, step: 1, unit: '%', label: 'Contrast' },
      shift: { type: 'number', min: -30, max: 30, default: 0, step: 0.1, unit: 'px', label: 'Shift edge' },
      decontaminate: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Decontaminate colours' },
      defringe: { type: 'number', min: 0.5, max: 30, default: 3, step: 0.5, unit: 'px', label: 'Edge band' }
    },
    radius: function (p, s) { return refineNeutral(p) ? 0 : refineReach(p, s); },
    grow: function (p, s) { return p.shift > 0 || p.feather > 0 ? Math.ceil((Math.max(0, p.shift) + 3 * p.feather) * s) + 2 : 0; },
    passes: function (g, p) {
      if (refineNeutral(p)) return;
      var src = g.source, a = g.pass(ALPHA_OF);
      var sg = Math.max(p.smooth, Math.abs(p.shift) * 0.6);
      var slope = 1;
      if (sg > 0 || p.contrast > 0 || p.shift) {
        var ab = sg > 0 ? g.blur(sg, { source: a }) : a;
        var sgPx = sg * g.scale, t = sg > 0 ? 0.5 * (1 + erf(-p.shift / sg / Math.SQRT2)) : 0.5;
        slope = Math.max(1, sgPx * 1.25) * (1 + p.contrast / 100 * 9);
        a = g.pass(REF_RAMP, { u_src: ab, u_t: [t, slope] });
      }
      if (p.feather > 0) a = g.blur(p.feather, { source: a });
      var w = g.pass(REF_W, { u_src: src });
      var wb = g.blur(Math.max(1, p.defringe * 0.5, Math.abs(p.shift) * 0.75, p.feather), { source: w });
      return g.pass(REF_COMP, { u_src: src, u_a: a, u_in: wb, u_dec: p.decontaminate });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 10, controls: ['smooth', 'feather', 'contrast', 'shift', { heading: 'Colour' }, 'decontaminate', 'defringe'] },
    agent: {
      summary: 'Cleans a cut-out\'s edge after the background remover: smooth jagged outlines, feather, harden (contrast), move the edge in or out, and remove the old background\'s colour from edge pixels (decontaminate).',
      tips: ['Typical product cut-out: smooth 1, shift −0.5, decontaminate 0.7, edge band 3.', 'A light halo around a subject cut from a white background: shift −1 and decontaminate 1.', 'Hair: keep contrast 0 and smooth 0; use decontaminate only.', 'Put it first among the silhouette effects so shadows and reflections use the refined edge.'],
      example: { type: 'refine-edge', p: { smooth: 1, shift: -0.6, decontaminate: 0.75, defringe: 3 } }
    }
  });

  /* =====================================================================================================================
     Match colour: mean/variance transfer per channel in Oklab (Ottosson 2020; the perceptual space used by CSS Color 4), the
     technique of Reinhard et al. 2001 ("Color transfer between images") in a modern perceptual space. Parameters are the source and
     target statistics, so LE.fx.composite.match() can fill them; luminance and colour transfer have separate weights.
     ===================================================================================================================== */
  var OKLAB = [
    'vec3 $lab(vec3 c){ c = max(c, 0.0); vec3 l = vec3(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);',
    '  l = sign(l) * pow(abs(l), vec3(1.0 / 3.0)); return vec3(0.2104542553 * l.x + 0.7936177850 * l.y - 0.0040720468 * l.z, 1.9779984951 * l.x - 2.4285922050 * l.y + 0.4505937099 * l.z, 0.0259040371 * l.x + 0.7827717662 * l.y - 0.8086757660 * l.z); }',
    'vec3 $rgb(vec3 o){ vec3 l = vec3(o.x + 0.3963377774 * o.y + 0.2158037573 * o.z, o.x - 0.1055613458 * o.y - 0.0638541728 * o.z, o.x - 0.0894841775 * o.y - 1.2914855480 * o.z); l = l * l * l;',
    '  return vec3(4.0767416621 * l.x - 3.3077115913 * l.y + 0.2309699292 * l.z, -1.2684380046 * l.x + 2.6097574011 * l.y - 0.3413193965 * l.z, -0.0041960863 * l.x - 0.7034186147 * l.y + 1.7076147010 * l.z); }'
  ].join('\n');
  C.oklab = function (r, g, b) {
    var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    l = Math.cbrt(l); m = Math.cbrt(m); s = Math.cbrt(s);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  };
  C.oklabToRgb = function (L, a, b) {
    var l = L + 0.3963377774 * a + 0.2158037573 * b, m = L - 0.1055613458 * a - 0.0638541728 * b, s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  };
  /* The transfer, on one linear RGB triple (the CPU reference the tests compare the shader with). */
  C.transfer = function (rgb, p) {
    var o = C.oklab(rgb[0], rgb[1], rgb[2]), k = p.strength / 100, wl = p.luminance / 100 * k, wc = p.color / 100 * k;
    var L = (o[0] - p.srcL) * p.scaleL + p.dstL, A = (o[1] - p.srcA) * p.scaleA + p.dstA, B = (o[2] - p.srcB) * p.scaleB + p.dstB;
    return C.oklabToRgb(o[0] + (L - o[0]) * wl, o[1] + (A - o[1]) * wc, o[2] + (B - o[2]) * wc);
  };
  function matchNeutral(p) { return p.strength <= 0 || (p.srcL === p.dstL && p.srcA === p.dstA && p.srcB === p.dstB && p.scaleL === 1 && p.scaleA === 1 && p.scaleB === 1) || (p.luminance <= 0 && p.color <= 0); }
  FX.register({
    id: 'match-color', name: 'Match colour', group: 'color', version: 1, space: 'linear',
    params: {
      strength: { type: 'number', min: 0, max: 100, default: 100, step: 1, unit: '%', label: 'Strength' },
      luminance: { type: 'number', min: 0, max: 100, default: 100, step: 1, unit: '%', label: 'Luminance' },
      color: { type: 'number', min: 0, max: 100, default: 100, step: 1, unit: '%', label: 'Colour intensity' },
      srcL: { type: 'number', min: 0, max: 1, default: 0.6, step: 0.001, label: 'Source lightness' },
      srcA: { type: 'number', min: -0.4, max: 0.4, default: 0, step: 0.001, label: 'Source green–magenta' },
      srcB: { type: 'number', min: -0.4, max: 0.4, default: 0, step: 0.001, label: 'Source blue–yellow' },
      dstL: { type: 'number', min: 0, max: 1, default: 0.6, step: 0.001, label: 'Target lightness' },
      dstA: { type: 'number', min: -0.4, max: 0.4, default: 0, step: 0.001, label: 'Target green–magenta' },
      dstB: { type: 'number', min: -0.4, max: 0.4, default: 0, step: 0.001, label: 'Target blue–yellow' },
      scaleL: { type: 'number', min: 0.25, max: 4, default: 1, step: 0.001, label: 'Contrast ratio' },
      scaleA: { type: 'number', min: 0.25, max: 4, default: 1, step: 0.001, label: 'Green–magenta ratio' },
      scaleB: { type: 'number', min: 0.25, max: 4, default: 1, step: 0.001, label: 'Blue–yellow ratio' }
    },
    passes: function (g, p) {
      if (matchNeutral(p)) return;
      var k = p.strength / 100;
      g.color(OKLAB + '\nuniform vec3 $s, $d, $k; uniform vec2 $w;\nvec3 $fx(vec3 c){ vec3 o = $lab(c); vec3 t = (o - $s) * $k + $d; return $rgb(vec3(mix(o.x, t.x, $w.x), mix(o.yz, t.yz, $w.y))); }',
        { s: [p.srcL, p.srcA, p.srcB], d: [p.dstL, p.dstA, p.dstB], k: [p.scaleL, p.scaleA, p.scaleB], w: [p.luminance / 100 * k, p.color / 100 * k] });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 30, controls: ['strength', 'luminance', 'color', { heading: 'Source' }, { param: 'srcL', fine: true }, { param: 'srcA', fine: true }, { param: 'srcB', fine: true }, { heading: 'Target' }, { param: 'dstL', fine: true }, { param: 'dstA', fine: true }, { param: 'dstB', fine: true }, { heading: 'Spread' }, 'scaleL', 'scaleA', 'scaleB'] },
    agent: {
      summary: 'Moves the layer\'s colour statistics (mean and spread of lightness and both colour axes, in Oklab) toward a target\'s, so a pasted subject takes on the background\'s light. Call LE.fx.composite.match(subject, background) to get the parameters.',
      tips: ['Start from match() and lower strength to 50–80: a full transfer can flatten a product\'s own colours.', 'luminance 0 keeps the subject\'s brightness and matches only colour (temperature and tint); colour 0 matches brightness and contrast only.', 'Put it before the shadows (it is a colour effect, so it runs before the cut-out anyway).'],
      example: { type: 'match-color', p: { strength: 70, srcL: 0.62, srcA: 0.01, srcB: 0.02, dstL: 0.55, dstA: 0.004, dstB: 0.035, scaleL: 0.9, scaleA: 1, scaleB: 1.1 } }
    }
  });

  /* Ambient colour: the light of the surroundings on the subject. A luminance-preserving multiply by the ambient colour (linear),
     plus `fill`: the ambient colour added in the shadows (a coloured bounce). */
  FX.register({
    id: 'ambient-light', name: 'Ambient colour', group: 'color', version: 1, space: 'linear',
    params: {
      amount: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Amount' },
      color: { type: 'color', default: '#ffd9a8', label: 'Colour' },
      fill: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Shadow fill' }
    },
    passes: function (g, p) {
      if (!(p.amount > 0) && !(p.fill > 0)) return;
      var c = linColor(p.color), y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], n = y > 1e-6 ? [c[0] / y, c[1] / y, c[2] / y] : [1, 1, 1];
      g.color('uniform vec3 $n, $c; uniform vec2 $k;\nvec3 $fx(vec3 c){ vec3 m = c * mix(vec3(1.0), $n, $k.x); float l = clamp(luma(c), 0.0, 1.0); return m + $c * $k.y * 0.25 * (1.0 - l) * (1.0 - l); }', { n: n, c: c, k: [p.amount, p.fill] });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 40, controls: ['amount', 'color', 'fill'] },
    agent: {
      summary: 'Tints the subject with the colour of the light around it (luminance kept), and optionally lifts its shadows with that colour, like light bounced from the surroundings.',
      tips: ['Sample the average colour of the background near the subject; amount 0.15–0.35.', 'Warm sunset scene: #ffb36b, amount 0.3, fill 0.15.'],
      example: { type: 'ambient-light', p: { amount: 0.25, color: '#ffc68a', fill: 0.1 } }
    }
  });

  /* =====================================================================================================================
     Scene-reading effects (need: 'scene'): light wrap, blend options, apply image, displacement. They run at draw time in the studio,
     on the pixels behind the layer. LE.fx.apply() on a bare canvas has no scene and skips them.
     g.scene() is display-referred, premultiplied.
     ===================================================================================================================== */
  var SCENE_LIN = 'vec4 fx(){ vec4 s = texture(u_src, v_uv); return s.a > 0.0 ? vec4(toLinear(s.rgb / s.a) * s.a, s.a) : vec4(0.0); }';
  FX.register({
    id: 'light-wrap', name: 'Light wrap', group: 'compositing', version: 1, space: 'linear', needs: ['alpha', 'scene'],
    params: {
      amount: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Amount' },
      width: { type: 'number', min: 0.5, max: 100, default: 10, step: 0.5, unit: 'px', label: 'Width' },
      blur: { type: 'number', min: 0, max: 200, default: 18, step: 0.5, unit: 'px', label: 'Background blur' },
      mode: { type: 'choice', options: [{ value: 'screen', label: 'Screen' }, { value: 'normal', label: 'Normal' }], default: 'screen', label: 'Blend' }
    },
    radius: function (p, s) { return p.amount > 0 ? reachOf(p.width, s) + reachOf(p.blur, s) + 2 : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var sc = g.scene();
      if (!sc) return;
      var bl = g.pass(SCENE_LIN, { u_src: sc }), bb = p.blur > 0 ? g.blur(p.blur, { source: bl }) : bl;
      var a = g.pass(ALPHA_OF), ab = g.blur(p.width, { source: a, edge: 'transparent' });
      return g.pass('uniform sampler2D u_bg, u_ab; uniform vec2 u_k;\nvec4 fx(){ vec4 s = texture(u_src, v_uv); if (s.a <= 0.0) return s; vec4 b = texture(u_bg, v_uv); vec3 bc = b.a > 0.0 ? b.rgb / b.a : vec3(0.0); float m = clamp(1.0 - texture(u_ab, v_uv).a, 0.0, 1.0) * 2.0; m = clamp(m, 0.0, 1.0) * u_k.x * b.a; vec3 c = s.rgb / s.a; c = u_k.y > 0.5 ? 1.0 - (1.0 - c) * (1.0 - bc * m) : mix(c, bc, m); return vec4(c * s.a, s.a); }',
        { u_bg: bb, u_ab: ab, u_k: [p.amount, p.mode === 'screen' ? 1 : 0] });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 20, controls: ['amount', 'width', 'blur', 'mode'] },
    agent: {
      summary: 'Lets the blurred background light bleed over the subject\'s edges, the classic compositing trick that makes a cut-out sit in a bright scene. Reads the scene behind the layer (draw time).',
      tips: ['Bright or backlit backgrounds: amount 0.4–0.7, width 0.01 × subject height, blur 2× width.', 'Dark backgrounds gain little; use mode normal at a low amount to carry their colour into the edge instead.'],
      example: { type: 'light-wrap', p: { amount: 0.5, width: 8, blur: 20 } }
    }
  });

  /* Blend modes on display-referred values, premultiplied out. Formulas: the W3C Compositing and Blending Level 1 set, plus the
     contrast family of professional editors (linear burn/dodge, vivid, linear and pin light, hard mix), subtract, divide, darker and
     lighter colour, and dissolve (a seeded threshold on the alpha). */
  var MODES = ['normal', 'dissolve', 'darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color', 'lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color', 'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'];
  var MODE_LABEL = { 'normal': 'Normal', 'dissolve': 'Dissolve', 'darken': 'Darken', 'multiply': 'Multiply', 'color-burn': 'Colour burn', 'linear-burn': 'Linear burn', 'darker-color': 'Darker colour', 'lighten': 'Lighten', 'screen': 'Screen', 'color-dodge': 'Colour dodge', 'linear-dodge': 'Linear dodge (add)', 'lighter-color': 'Lighter colour', 'overlay': 'Overlay', 'soft-light': 'Soft light', 'hard-light': 'Hard light', 'vivid-light': 'Vivid light', 'linear-light': 'Linear light', 'pin-light': 'Pin light', 'hard-mix': 'Hard mix', 'difference': 'Difference', 'exclusion': 'Exclusion', 'subtract': 'Subtract', 'divide': 'Divide', 'hue': 'Hue', 'saturation': 'Saturation', 'color': 'Colour', 'luminosity': 'Luminosity' };
  var BLENDS_GLSL = [
    'float bLum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }',
    'vec3 bClip(vec3 c){ float l = bLum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b); if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6); if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6); return c; }',
    'vec3 bSetLum(vec3 c, float l){ return bClip(c + (l - bLum(c))); }',
    'float bSat(vec3 c){ return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }',
    'vec3 bSetSat(vec3 c, float s){ float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b); return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0); }',
    'vec3 bBurn(vec3 b, vec3 s){ return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, 1e-6)), vec3(0.0), step(s, vec3(0.0))) * (1.0 - step(vec3(1.0), b)) + step(vec3(1.0), b); }',
    'vec3 bDodge(vec3 b, vec3 s){ return mix(min(vec3(1.0), b / max(1.0 - s, 1e-6)), vec3(1.0), step(vec3(1.0), s)) * (1.0 - step(b, vec3(0.0))); }',
    'vec3 bSoft(vec3 b, vec3 s){ vec3 d = mix(sqrt(max(b, 0.0)), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25))); return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(vec3(0.5), s)); }',
    'vec3 bHard(vec3 b, vec3 s){ return mix(b * 2.0 * s, 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)), step(vec3(0.5), s)); }',
    'vec3 blendMode(int m, vec3 b, vec3 s){',
    '  if (m <= 1) return s; if (m == 2) return min(b, s); if (m == 3) return b * s; if (m == 4) return bBurn(b, s); if (m == 5) return max(b + s - 1.0, 0.0);',
    '  if (m == 6) return bLum(s) < bLum(b) ? s : b; if (m == 7) return max(b, s); if (m == 8) return b + s - b * s; if (m == 9) return bDodge(b, s); if (m == 10) return min(b + s, 1.0);',
    '  if (m == 11) return bLum(s) > bLum(b) ? s : b; if (m == 12) return bHard(s, b); if (m == 13) return bSoft(b, s); if (m == 14) return bHard(b, s);',
    '  if (m == 15) return mix(bBurn(b, 2.0 * s), bDodge(b, 2.0 * s - 1.0), step(vec3(0.5), s)); if (m == 16) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);',
    '  if (m == 17) return mix(min(b, 2.0 * s), max(b, 2.0 * s - 1.0), step(vec3(0.5), s)); if (m == 18) return step(vec3(1.0), b + s);',
    '  if (m == 19) return abs(b - s); if (m == 20) return b + s - 2.0 * b * s; if (m == 21) return max(b - s, 0.0); if (m == 22) return mix(min(b / max(s, 1e-6), vec3(1.0)), vec3(1.0), step(s, vec3(0.0)));',
    '  if (m == 23) return bSetLum(bSetSat(s, bSat(b)), bLum(b)); if (m == 24) return bSetLum(bSetSat(b, bSat(s)), bLum(b)); if (m == 25) return bSetLum(s, bLum(b)); return bSetLum(b, bLum(s)); }',
    ''
  ].join('\n');
  C.blendModes = {
    effect: MODES.slice(),
    entry: ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'difference', 'color', 'luminosity'],
    compositor: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'],
    labels: MODE_LABEL
  };
  /* The CPU reference for the blend formulas (one display-referred RGB triple each), for tests and agents. */
  C.blend = function (mode, b, s) {
    function lum(c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
    function clip(c) { var l = lum(c), n = Math.min.apply(null, c), x = Math.max.apply(null, c); if (n < 0) c = c.map(function (v) { return l + (v - l) * l / Math.max(l - n, 1e-6); }); if (x > 1) c = c.map(function (v) { return l + (v - l) * (1 - l) / Math.max(x - l, 1e-6); }); return c; }
    function setLum(c, l) { var d = l - lum(c); return clip(c.map(function (v) { return v + d; })); }
    function sat(c) { return Math.max.apply(null, c) - Math.min.apply(null, c); }
    function setSat(c, sv) { var mx = Math.max.apply(null, c), mn = Math.min.apply(null, c); return c.map(function (v) { return mx > mn ? (v - mn) * sv / (mx - mn) : 0; }); }
    function burn(x, y) { return x >= 1 ? 1 : y <= 0 ? 0 : 1 - Math.min(1, (1 - x) / y); }
    function dodge(x, y) { return x <= 0 ? 0 : y >= 1 ? 1 : Math.min(1, x / (1 - y)); }
    function hard(x, y) { return y < 0.5 ? x * 2 * y : 1 - (1 - x) * (1 - (2 * y - 1)); }
    function soft(x, y) { var d = x <= 0.25 ? ((16 * x - 12) * x + 4) * x : Math.sqrt(x); return y < 0.5 ? x - (1 - 2 * y) * x * (1 - x) : x + (2 * y - 1) * (d - x); }
    var per = {
      'normal': function (x, y) { return y; }, 'dissolve': function (x, y) { return y; }, 'darken': Math.min, 'multiply': function (x, y) { return x * y; }, 'color-burn': burn,
      'linear-burn': function (x, y) { return Math.max(x + y - 1, 0); }, 'lighten': Math.max, 'screen': function (x, y) { return x + y - x * y; }, 'color-dodge': dodge,
      'linear-dodge': function (x, y) { return Math.min(x + y, 1); }, 'overlay': function (x, y) { return hard(y, x); }, 'soft-light': soft, 'hard-light': hard,
      'vivid-light': function (x, y) { return y < 0.5 ? burn(x, 2 * y) : dodge(x, 2 * y - 1); }, 'linear-light': function (x, y) { return clamp(x + 2 * y - 1, 0, 1); },
      'pin-light': function (x, y) { return y < 0.5 ? Math.min(x, 2 * y) : Math.max(x, 2 * y - 1); }, 'hard-mix': function (x, y) { return x + y >= 1 ? 1 : 0; },
      'difference': function (x, y) { return Math.abs(x - y); }, 'exclusion': function (x, y) { return x + y - 2 * x * y; }, 'subtract': function (x, y) { return Math.max(x - y, 0); },
      'divide': function (x, y) { return y <= 0 ? 1 : Math.min(x / y, 1); }
    };
    if (per[mode]) return [0, 1, 2].map(function (i) { return per[mode](b[i], s[i]); });
    if (mode === 'darker-color') return lum(s) < lum(b) ? s.slice() : b.slice();
    if (mode === 'lighter-color') return lum(s) > lum(b) ? s.slice() : b.slice();
    if (mode === 'hue') return setLum(setSat(s, sat(b)), lum(b));
    if (mode === 'saturation') return setLum(setSat(b, sat(s)), lum(b));
    if (mode === 'color') return setLum(s, lum(b));
    if (mode === 'luminosity') return setLum(b, lum(s));
    return s.slice();
  };
  /* Blend-if: 0 below lo0, ramps to 1 at lo1, 1 to hi0, ramps to 0 at hi1 (0–255 like the familiar dialog, split sliders). */
  C.blendIf = function (v, lo0, lo1, hi0, hi1) {
    var x = v * 255, a = lo1 > lo0 ? clamp((x - lo0) / (lo1 - lo0), 0, 1) : (x >= lo0 ? 1 : 0), b = hi1 > hi0 ? clamp((hi1 - x) / (hi1 - hi0), 0, 1) : (x <= hi1 ? 1 : 0);
    return a * b;
  };
  var BLENDIF_GLSL = 'float bif(float v, vec4 r){ float x = v * 255.0; float a = r.y > r.x ? clamp((x - r.x) / (r.y - r.x), 0.0, 1.0) : step(r.x, x); float b = r.w > r.z ? clamp((r.w - x) / (r.w - r.z), 0.0, 1.0) : step(x, r.w); return a * b; }\nfloat chan(vec3 c, float k){ return k < 0.5 ? dot(c, vec3(0.2126, 0.7152, 0.0722)) : k < 1.5 ? c.r : k < 2.5 ? c.g : c.b; }\n';
  var MODE_OPTS = MODES.map(function (m) { return { value: m, label: MODE_LABEL[m] }; });
  function blendNeutral(p) { return p.mode === 'normal' && p.fill >= 100 && p.thisLo0 <= 0 && p.thisLo1 <= 0 && p.thisHi0 >= 255 && p.thisHi1 >= 255 && p.underLo0 <= 0 && p.underLo1 <= 0 && p.underHi0 >= 255 && p.underHi1 >= 255; }
  var BLEND_COMP = BLENDS_GLSL + BLENDIF_GLSL + [
    'uniform sampler2D u_sc; uniform int u_mode; uniform float u_fill, u_ch, u_seed; uniform vec4 u_this, u_under;',
    'vec4 fx(){ vec4 s = texture(u_src, v_uv); if (s.a <= 0.0) return vec4(0.0); vec4 b = texture(u_sc, v_uv);',
    '  vec3 sc = s.rgb / s.a, bc = b.a > 0.0 ? b.rgb / b.a : vec3(0.0);',
    '  float a = s.a * u_fill * bif(chan(sc, u_ch), u_this) * mix(1.0, bif(chan(bc, u_ch), u_under), b.a);',
    '  if (u_mode == 1) a = step(docNoise(floor(docPos()), u_seed), a);',
    '  vec3 f = clamp(mix(sc, blendMode(u_mode, bc, sc), b.a), 0.0, 1.0); return vec4(f * a, a); }'
  ].join('\n');
  FX.register({
    id: 'blend-options', name: 'Blending options', group: 'compositing', version: 1, space: 'display', needs: ['scene'],
    params: {
      mode: { type: 'choice', options: MODE_OPTS, default: 'normal', label: 'Blend mode' },
      fill: { type: 'number', min: 0, max: 100, default: 100, step: 1, unit: '%', label: 'Fill opacity' },
      channel: { type: 'choice', options: [{ value: 'gray', label: 'Grey' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }], default: 'gray', label: 'Blend if' },
      thisLo0: { type: 'number', min: 0, max: 255, default: 0, step: 1, label: 'This layer: black' },
      thisLo1: { type: 'number', min: 0, max: 255, default: 0, step: 1, label: 'This layer: black (split)' },
      thisHi0: { type: 'number', min: 0, max: 255, default: 255, step: 1, label: 'This layer: white (split)' },
      thisHi1: { type: 'number', min: 0, max: 255, default: 255, step: 1, label: 'This layer: white' },
      underLo0: { type: 'number', min: 0, max: 255, default: 0, step: 1, label: 'Underlying: black' },
      underLo1: { type: 'number', min: 0, max: 255, default: 0, step: 1, label: 'Underlying: black (split)' },
      underHi0: { type: 'number', min: 0, max: 255, default: 255, step: 1, label: 'Underlying: white (split)' },
      underHi1: { type: 'number', min: 0, max: 255, default: 255, step: 1, label: 'Underlying: white' },
      seed: { type: 'seed', default: 1, label: 'Dissolve seed' }
    },
    passes: function (g, p) {
      if (blendNeutral(p)) return;
      var sc = g.scene();
      if (!sc) return;
      var lo = Math.min(p.thisLo0, p.thisLo1), hi = Math.max(p.thisHi0, p.thisHi1), ulo = Math.min(p.underLo0, p.underLo1), uhi = Math.max(p.underHi0, p.underHi1);
      return g.pass(BLEND_COMP, { u_sc: sc, u_mode: MODES.indexOf(p.mode), u_fill: p.fill / 100, u_ch: ['gray', 'red', 'green', 'blue'].indexOf(p.channel), u_seed: p.seed % 65536,
        u_this: [lo, Math.max(lo, p.thisLo1), Math.min(hi, p.thisHi0), hi], u_under: [ulo, Math.max(ulo, p.underLo1), Math.min(uhi, p.underHi0), uhi] });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 50, controls: ['mode', 'fill', { heading: 'Blend if' }, 'channel', { heading: 'This layer' }, 'thisLo0', 'thisLo1', 'thisHi0', 'thisHi1', { heading: 'Underlying layer' }, 'underLo0', 'underLo1', 'underHi0', 'underHi1', { param: 'seed', when: { mode: 'dissolve' } }] },
    agent: {
      summary: 'The full professional blend-mode set (27 modes, including vivid, linear and pin light, hard mix, subtract, divide, darker/lighter colour) blended onto the pixels behind the layer, with fill opacity and blend-if ranges for this layer and the underlying pixels (0–255, split for a soft transition). Draw time.',
      tips: ['Leave the layer\'s own blend at normal when using this, or the two blends stack.', 'Drop a texture only into the dark parts of the background: underLo0 0, underLo1 0, underHi0 90, underHi1 150.', 'Remove a white backdrop from a scanned logo: mode multiply, or thisHi0 200, thisHi1 250.', 'Fill applies to the layer pixels and its layer-stage effects together here (see the report on fill vs opacity).'],
      example: { type: 'blend-options', p: { mode: 'linear-light', fill: 60, underHi0: 180, underHi1: 240 } }
    }
  });

  /* Apply image: blends a channel of the backdrop (or of the layer itself) into the layer with a blend mode and opacity. */
  FX.register({
    id: 'apply-image', name: 'Apply image', group: 'compositing', version: 1, space: 'display', needs: ['scene'],
    params: {
      opacity: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Opacity' },
      source: { type: 'choice', options: [{ value: 'backdrop', label: 'Backdrop' }, { value: 'layer', label: 'This layer' }], default: 'backdrop', label: 'Source' },
      channel: { type: 'choice', options: [{ value: 'rgb', label: 'RGB' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' }, { value: 'luma', label: 'Luminosity' }, { value: 'alpha', label: 'Transparency' }], default: 'rgb', label: 'Channel' },
      invert: { type: 'bool', default: false, label: 'Invert' },
      mode: { type: 'choice', options: MODE_OPTS, default: 'multiply', label: 'Blend mode' }
    },
    passes: function (g, p) {
      if (!(p.opacity > 0)) return;
      var sc = g.scene();
      if (!sc && p.source === 'backdrop') return;
      return g.pass(BLENDS_GLSL + [
        'uniform sampler2D u_sc; uniform int u_mode; uniform float u_op, u_ch, u_inv, u_self;',
        'vec4 fx(){ vec4 s = texture(u_src, v_uv); if (s.a <= 0.0) return s; vec4 x = u_self > 0.5 ? s : texture(u_sc, v_uv); vec3 xc = x.a > 0.0 ? x.rgb / x.a : vec3(0.0);',
        '  vec3 v = u_ch < 0.5 ? xc : u_ch < 1.5 ? vec3(xc.r) : u_ch < 2.5 ? vec3(xc.g) : u_ch < 3.5 ? vec3(xc.b) : u_ch < 4.5 ? vec3(dot(xc, vec3(0.2126, 0.7152, 0.0722))) : vec3(x.a);',
        '  if (u_inv > 0.5) v = 1.0 - v; vec3 c = s.rgb / s.a; float t = u_op * (u_self > 0.5 || u_ch > 4.5 ? 1.0 : x.a); return vec4(clamp(mix(c, blendMode(u_mode, c, v), t), 0.0, 1.0) * s.a, s.a); }'
      ].join('\n'), { u_sc: sc || g.source, u_mode: MODES.indexOf(p.mode), u_op: p.opacity, u_ch: ['rgb', 'red', 'green', 'blue', 'luma', 'alpha'].indexOf(p.channel), u_inv: p.invert ? 1 : 0, u_self: p.source === 'layer' ? 1 : 0 });
    },
    support: GPU,
    ui: { section: 'Compositing', order: 60, controls: ['opacity', 'source', 'channel', 'invert', 'mode'] },
    agent: {
      summary: 'Blends a channel of the backdrop behind the layer (or of the layer itself) into the layer\'s pixels with any blend mode; the layer\'s transparency is kept. Draw time.',
      tips: ['Carry the background\'s texture into a pasted label: source backdrop, channel luma, mode soft-light, opacity 0.5.', 'A quick black-and-white with punch: source layer, channel red, mode luminosity, opacity 1.'],
      example: { type: 'apply-image', p: { opacity: 0.5, source: 'backdrop', channel: 'luma', mode: 'soft-light' } }
    }
  });

  /* Displacement: shifts the layer (colour and alpha) by the luminance of a map (the backdrop behind it, or the layer itself),
     128 = no shift, like the familiar displacement filter; optional shading multiplies the layer by the map's light. */
  FX.register({
    id: 'displace', name: 'Displace', group: 'geometry', version: 1, space: 'linear', needs: ['scene'],
    params: {
      x: { type: 'number', min: -200, max: 200, default: 0, step: 0.5, unit: 'px', label: 'Horizontal scale' },
      y: { type: 'number', min: -200, max: 200, default: 0, step: 0.5, unit: 'px', label: 'Vertical scale' },
      map: { type: 'choice', options: [{ value: 'backdrop', label: 'Backdrop' }, { value: 'layer', label: 'This layer' }], default: 'backdrop', label: 'Map' },
      smooth: { type: 'number', min: 0, max: 50, default: 2, step: 0.1, unit: 'px', label: 'Smooth map' },
      shading: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Shading' }
    },
    radius: function (p, s) { return p.x || p.y || p.shading ? Math.ceil(Math.max(Math.abs(p.x), Math.abs(p.y)) * s) + reachOf(p.smooth, s) + 2 : 0; },
    grow: function (p, s) { return p.x || p.y ? Math.ceil(Math.max(Math.abs(p.x), Math.abs(p.y)) * s) + 2 : 0; },
    passes: function (g, p) {
      if (!p.x && !p.y && !p.shading) return;
      var sc = p.map === 'layer' ? null : g.scene();
      if (!sc && p.map !== 'layer') return;
      var m = g.pass('uniform float u_lin; vec4 fx(){ vec4 s = texture(u_src, v_uv); vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.5); if (u_lin > 0.5) c = toDisplay(c); return vec4(luma(c)); }', { u_src: sc || g.source, u_lin: sc ? 0 : 1 });
      var mb = p.smooth > 0 ? g.blur(p.smooth, { source: m }) : m;
      return g.pass('uniform sampler2D u_m; uniform vec3 u_k;\nvec4 fx(){ float v = texture(u_m, v_uv).r; vec2 off = (v - 0.5) * 2.0 * u_k.xy; vec4 s = texture(u_src, v_uv + docToUV(off)); float sh = mix(1.0, clamp(texture(u_m, v_uv + docToUV(off)).r * 2.0, 0.0, 2.0), u_k.z); return vec4(s.rgb * sh, s.a); }',
        { u_m: mb, u_k: [p.x, p.y, p.shading] });
    },
    support: GPU,
    ui: { section: 'Geometry', order: 60, controls: ['x', 'y', 'map', 'smooth', 'shading'] },
    agent: {
      summary: 'Wraps the layer over the surface behind it: pixels move by the backdrop\'s brightness (mid grey = no move) and can take on its shading. For logos on fabric, labels on crumpled paper, prints on stone. Draw time.',
      tips: ['Fabric: x 6, y 6, smooth 2, shading 0.5, and put the layer\'s own blend at multiply.', 'Keep the scale under about 2 % of the layer size or the artwork tears.'],
      example: { type: 'displace', p: { x: 8, y: 8, smooth: 2, shading: 0.4 } }
    }
  });

  /* =====================================================================================================================
     Mesh warp to a mockup: a bicubic Bézier patch with a 4 × 4 control net (16 `point` parameters, box fractions). The identity net is
     the thirds of the box. The shader inverts the patch per pixel with Newton's method (8 steps from the pixel's own position, which
     converges for any fold-free net within the convex hull); pixels with no preimage are transparent.
     Proposed on-canvas handles (ui.handles, see docs/FX-REFERENCE.md): the 16 points with lines along rows and columns.
     ===================================================================================================================== */
  var MESH = [];
  for (var mr = 0; mr < 4; mr++) for (var mc = 0; mc < 4; mc++) MESH.push('p' + mr + mc);
  function meshPts(p) { return MESH.map(function (k) { return [p[k].x, p[k].y]; }); }
  function meshDev(p) { var m = 0; MESH.forEach(function (k, i) { m = Math.max(m, Math.abs(p[k].x - (i % 4) / 3), Math.abs(p[k].y - Math.floor(i / 4) / 3)); }); return m; }
  C.bezierPatch = function (pts, u, v) {
    function bern(t) { var s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; }
    var bu = bern(u), bv = bern(v), x = 0, y = 0;
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) { var w = bv[r] * bu[c]; x += pts[r * 4 + c][0] * w; y += pts[r * 4 + c][1] * w; }
    return [x, y];
  };
  var MESH_GLSL = [
    'uniform vec2 u_p[16];',
    'void bern(float t, out vec4 b, out vec4 d){ float s = 1.0 - t; b = vec4(s * s * s, 3.0 * s * s * t, 3.0 * s * t * t, t * t * t); d = vec4(-3.0 * s * s, 3.0 * s * s - 6.0 * s * t, 6.0 * s * t - 3.0 * t * t, 3.0 * t * t); }',
    'vec4 fx(){ vec2 P = boxUV(), uv = P;',
    '  for (int it = 0; it < 10; it++) { vec4 bu, du, bv, dv; bern(uv.x, bu, du); bern(uv.y, bv, dv); vec2 f = vec2(0.0), fu = vec2(0.0), fv = vec2(0.0);',
    '    for (int r = 0; r < 4; r++) for (int c = 0; c < 4; c++) { vec2 q = u_p[r * 4 + c]; f += q * bv[r] * bu[c]; fu += q * bv[r] * du[c]; fv += q * dv[r] * bu[c]; }',
    '    vec2 e = f - P; float det = fu.x * fv.y - fu.y * fv.x; if (abs(det) < 1e-8) break; uv -= vec2(fv.y * e.x - fv.x * e.y, -fu.y * e.x + fu.x * e.y) / det; uv = clamp(uv, vec2(-0.25), vec2(1.25)); }',
    '  vec4 bu, du, bv, dv; bern(uv.x, bu, du); bern(uv.y, bv, dv); vec2 f = vec2(0.0); for (int r = 0; r < 4; r++) for (int c = 0; c < 4; c++) f += u_p[r * 4 + c] * bv[r] * bu[c];',
    '  if (length((f - P) * u_box) > 0.5 || uv.x < -0.002 || uv.y < -0.002 || uv.x > 1.002 || uv.y > 1.002) return vec4(0.0);',
    '  return texture(u_src, v_uv + docToUV((uv - P) * u_box)); }'
  ].join('\n');
  var meshParams = {};
  MESH.forEach(function (k, i) { meshParams[k] = { type: 'point', default: { x: (i % 4) / 3, y: Math.floor(i / 4) / 3 }, min: -1, max: 2, label: 'Point ' + (Math.floor(i / 4) + 1) + '·' + (i % 4 + 1) }; });
  /* The reach comes from the layer box (radius and grow receive it); `size` is kept for documents that set it and overrides the box. */
  meshParams.size = { type: 'number', min: 0, max: 20000, default: 0, step: 1, unit: 'px', label: 'Layer size', help: 'Leave at 0: the layer box bounds how far the warp may move pixels. A value replaces the box\'s longer side.', ui: { hidden: true } };
  FX.register({
    id: 'mesh-warp', name: 'Mesh warp', group: 'geometry', version: 1, space: 'linear', needs: ['alpha'],
    params: meshParams,
    radius: function (p, s, box) { var d = meshDev(p); return d > 1e-6 ? Math.ceil(d * (p.size > 0 ? p.size : box && box.w ? Math.max(box.w, box.h) : 1200) * s) + 3 : 0; },
    grow: function (p, s, box) {
      var x0 = 0, y0 = 0, x1 = 1, y1 = 1, bw = p.size > 0 ? p.size : box && box.w ? box.w : 1200, bh = p.size > 0 ? p.size : box && box.h ? box.h : 1200;
      if (!(meshDev(p) > 1e-6)) return 0;
      MESH.forEach(function (k) { x0 = Math.min(x0, p[k].x); y0 = Math.min(y0, p[k].y); x1 = Math.max(x1, p[k].x); y1 = Math.max(y1, p[k].y); });
      return Math.ceil(Math.max(-x0 * bw, -y0 * bh, (x1 - 1) * bw, (y1 - 1) * bh, 0) * s) + 2;
    },
    passes: function (g, p) {
      if (!(meshDev(p) > 1e-6)) return;
      var flat = [];
      meshPts(p).forEach(function (q) { flat.push(q[0], q[1]); });
      return g.pass(MESH_GLSL, { u_p: new Float32Array(flat) });
    },
    support: GPU,
    ui: { section: 'Geometry', order: 50, handles: { kind: 'mesh', rows: 4, cols: 4, params: MESH.slice() }, controls: MESH.concat(['size']) },
    agent: {
      summary: 'Bends the layer (after its cut-out) over a curved surface with a 4 × 4 Bézier control net, for mockups: mugs, bottles, bent pages, fabric folds. Points are fractions of the layer box; the thirds grid is "no warp".',
      tips: ['Start from LE.fx.composite.meshFromQuad(quad) or cylinder(bulge) helpers, then move single points.', 'Combine with transform.quad for the overall perspective and use mesh-warp only for the curvature.', 'Keep the net fold-free (rows and columns must not cross).'],
      example: { type: 'mesh-warp', p: { size: 800, p01: { x: 0.333, y: -0.05 }, p02: { x: 0.667, y: -0.05 }, p31: { x: 0.333, y: 1.05 }, p32: { x: 0.667, y: 1.05 } } }
    }
  });
  /* Control nets an agent can start from. */
  C.meshIdentity = function () { var o = {}; MESH.forEach(function (k, i) { o[k] = { x: (i % 4) / 3, y: Math.floor(i / 4) / 3 }; }); return o; };
  /* A cylinder label: the middle columns bulge by `bulge` (fraction of the box height) at the top and bottom edges, and the
     columns compress toward the sides (foreshortening of a cylinder seen from the front). */
  C.meshCylinder = function (bulge, squeeze) {
    var o = C.meshIdentity(), b = bulge || 0, sq = squeeze == null ? 0.08 : squeeze;
    MESH.forEach(function (k, i) {
      var r = Math.floor(i / 4), c = i % 4, x = c / 3, y = r / 3, mid = c === 1 || c === 2;
      if (mid) x = x + (x < 0.5 ? sq : -sq) * 0.5;
      if (mid) y = y + (r === 0 ? -b : r === 3 ? b : r === 1 ? -b / 3 : b / 3) * 1.333;
      o[k] = { x: x, y: y };
    });
    return o;
  };

  /* =====================================================================================================================
     Agent helpers: contact detection, colour/noise matching, plane placement, vanishing-point shadows, presets, staging.
     None of these runs in the render path; they read pixels on the CPU from canvases the caller hands over.
     ===================================================================================================================== */
  function imageDataOf(src, maxSide) {
    if (!src) return null;
    if (src.data && src.width && src.height && !src.getContext) return src;
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    if (!w || !h) return null;
    var k = Math.min(1, (maxSide || 512) / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return x.getImageData(0, 0, c.width, c.height);
  }
  function assetNode(scene, id) {
    var rec = scene && scene._assets && scene._assets[id];
    if (!rec) return null;
    return rec.canvas || (rec.image && (rec.image.naturalWidth || rec.image.width) ? rec.image : null);
  }
  /* The alpha canvas of a layer's subject: the cut-out mask when there is one, else the photo's own transparency. */
  function subjectAlpha(scene, layer) {
    if (!scene || !layer) return null;
    var L = typeof layer === 'string' ? (scene.layer ? scene.layer(layer) : null) : layer;
    if (!L) return null;
    if (L.cutout && L.cutout.asset) {
      var rec = scene._assets && scene._assets[L.cutout.asset];
      var fn = LE.Scene && LE.Scene._fx && LE.Scene._fx.cutoutAlpha;
      var a = rec && fn ? fn(rec) : assetNode(scene, L.cutout.asset);
      if (a) return a;
    }
    return assetNode(scene, L.src);
  }

  /* contact(source) → { x, y, left, right, top, bottom, width, height, coverage } in fractions of the image (= the layer box when the
     photo is not cropped): x, y = the middle of the lowest band of the subject (its contact with the ground), left/right = that band's
     extent, top/bottom/width/height = the subject's bounding box. source: a canvas, image or ImageData with transparency, or
     { scene, layer } (the layer's cut-out). Returns null when there is nothing opaque. */
  C.contact = function (source, opts) {
    opts = opts || {};
    var node = source && source.scene ? subjectAlpha(source.scene, source.layer) : source;
    var img = imageDataOf(node, opts.maxSide || 512);
    if (!img) return null;
    var w = img.width, h = img.height, d = img.data, thr = (opts.threshold == null ? 0.5 : opts.threshold) * 255;
    var x0 = w, x1 = -1, y0 = h, y1 = -1, n = 0, minRow = Math.max(1, Math.round(w * 0.004)), x, y;
    for (y = 0; y < h; y++) {
      var cnt = 0;
      for (x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= thr) { cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      n += cnt;
      if (cnt >= minRow) { if (y < y0) y0 = y; y1 = y; }
    }
    if (y1 < 0) return null;
    var band = Math.max(1, Math.round((y1 - y0 + 1) * (opts.band || 0.03))), sx = 0, sn = 0, l = w, r = -1;
    for (y = Math.max(y0, y1 - band + 1); y <= y1; y++) for (x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= thr) { sx += x; sn++; if (x < l) l = x; if (x > r) r = x; }
    var f = function (v) { return Math.round(v * 10000) / 10000; };
    return { x: f((sx / sn + 0.5) / w), y: f((y1 + 1) / h), left: f(l / w), right: f((r + 1) / w), top: f(y0 / h), bottom: f((y1 + 1) / h), x0: f(x0 / w), x1: f((x1 + 1) / w), width: f((x1 - x0 + 1) / w), height: f((y1 - y0 + 1) / h), coverage: f(n / (w * h)), opaque: n === w * h };
  };

  /* Oklab statistics of the pixels (weighted by alpha, or by opts.weight(x, y) in 0–1) inside opts.region { x, y, w, h } (fractions). */
  function labStats(img, region, minAlpha) {
    var w = img.width, h = img.height, d = img.data, r = region || { x: 0, y: 0, w: 1, h: 1 };
    var X0 = Math.floor(r.x * w), Y0 = Math.floor(r.y * h), X1 = Math.ceil((r.x + r.w) * w), Y1 = Math.ceil((r.y + r.h) * h);
    var s = [0, 0, 0], q = [0, 0, 0], W = 0, lut = new Float32Array(256);
    for (var i = 0; i < 256; i++) lut[i] = M.srgbToLinear(i / 255);
    for (var y = Math.max(0, Y0); y < Math.min(h, Y1); y++) for (var x = Math.max(0, X0); x < Math.min(w, X1); x++) {
      var k = (y * w + x) * 4, a = d[k + 3] / 255;
      if (a < (minAlpha == null ? 0.5 : minAlpha)) continue;
      var o = C.oklab(lut[d[k]], lut[d[k + 1]], lut[d[k + 2]]);
      for (var c = 0; c < 3; c++) { s[c] += o[c] * a; q[c] += o[c] * o[c] * a; }
      W += a;
    }
    if (!W) return null;
    var mean = s.map(function (v) { return v / W; }), sd = q.map(function (v, c) { return Math.sqrt(Math.max(v / W - mean[c] * mean[c], 1e-8)); });
    return { mean: mean, sd: sd, n: W };
  }
  function pixelsSync(x, maxSide) {
    if (!x) return null;
    if (x.scene && x.layer) {
      var L = typeof x.layer === 'string' ? x.scene.layer(x.layer) : x.layer, base = L ? assetNode(x.scene, L.src) : null;
      if (!base) return null;
      var img = imageDataOf(base, maxSide), al = subjectAlpha(x.scene, L);
      if (al && al !== base) {
        var am = imageDataOf(al, maxSide), c = document.createElement('canvas');
        if (am && (am.width !== img.width || am.height !== img.height)) { c.width = img.width; c.height = img.height; var cx = c.getContext('2d'); cx.drawImage(al, 0, 0, c.width, c.height); am = cx.getImageData(0, 0, c.width, c.height); }
        for (var i = 3; i < img.data.length; i += 4) img.data[i] = Math.round(img.data[i] * am.data[i] / 255);
      }
      return img;
    }
    return imageDataOf(x.canvas || x, maxSide);
  }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  /* match.sync(source, target, { region, targetRegion, strength }) → { type: 'match-color', p, stats, whiteBalance }: parameters that
     move the source's Oklab mean and spread to the target's. Canvases, images, ImageData or { scene, layer }. */
  C.match = function (source, target, opts) {
    opts = opts || {};
    var go = function (s, t) { return C.match.sync(s, t, opts); };
    var page = function (x) { return x && x.scene && !x.layer ? x.scene.render(Math.min(1, 512 / Math.max(x.scene._doc.width, x.scene._doc.height))) : Promise.resolve(x); };
    return Promise.all([page(source), page(target)]).then(function (r) { return go(r[0], r[1]); });
  };
  C.match.sync = function (source, target, opts) {
    opts = opts || {};
    var a = labStats(pixelsSync(source, 384), opts.region, 0.5), b = labStats(pixelsSync(target, 384), opts.targetRegion, 0.5);
    if (!a || !b) return null;
    var ratio = function (c, lo, hi) { return r4(clamp(b.sd[c] / a.sd[c], lo, hi)); };
    var p = { strength: opts.strength == null ? 100 : opts.strength, luminance: opts.luminance == null ? 100 : opts.luminance, color: opts.color == null ? 100 : opts.color,
      srcL: r4(a.mean[0]), srcA: r4(clamp(a.mean[1], -0.4, 0.4)), srcB: r4(clamp(a.mean[2], -0.4, 0.4)), dstL: r4(b.mean[0]), dstA: r4(clamp(b.mean[1], -0.4, 0.4)), dstB: r4(clamp(b.mean[2], -0.4, 0.4)),
      scaleL: ratio(0, 0.5, 2), scaleA: ratio(1, 0.5, 2), scaleB: ratio(2, 0.5, 2) };
    return {
      type: 'match-color', p: p, entry: { type: 'match-color', p: p },
      stats: { source: { mean: a.mean.map(r4), sd: a.sd.map(r4) }, target: { mean: b.mean.map(r4), sd: b.sd.map(r4) } },
      /* A rough equivalent in white-balance units (Oklab b ≈ blue–yellow, a ≈ green–magenta), for agents that prefer that control. */
      whiteBalance: { temperature: Math.round(clamp((b.mean[2] - a.mean[2]) * 900, -100, 100)), tint: Math.round(clamp((b.mean[1] - a.mean[1]) * 900, -100, 100)) }
    };
  };

  /* Noise (Immerkær 1996, "Fast noise variance estimation": σ = √(π/2)·Σ|I∗N| / (6(W−2)(H−2)), N the 3×3 Laplacian difference) and
     sharpness (variance of the Laplacian) on luminance, 0–1. Measure both images at the scale they will be composited at. */
  function noiseStats(img) {
    var w = img.width, h = img.height, d = img.data, Y = new Float32Array(w * h), A = new Uint8Array(w * h), i, x, y;
    for (i = 0; i < w * h; i++) { Y[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; A[i] = d[i * 4 + 3] > 250 ? 1 : 0; }
    var sum = 0, n = 0, ls = 0, lq = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      if (!(A[i] && A[i - 1] && A[i + 1] && A[i - w] && A[i + w] && A[i - w - 1] && A[i - w + 1] && A[i + w - 1] && A[i + w + 1])) continue;
      var c = Y[i - w - 1] - 2 * Y[i - w] + Y[i - w + 1] - 2 * Y[i - 1] + 4 * Y[i] - 2 * Y[i + 1] + Y[i + w - 1] - 2 * Y[i + w] + Y[i + w + 1];
      var lap = Y[i - 1] + Y[i + 1] + Y[i - w] + Y[i + w] - 4 * Y[i];
      sum += Math.abs(c); ls += lap; lq += lap * lap; n++;
    }
    if (!n) return null;
    return { noise: Math.sqrt(Math.PI / 2) * sum / (6 * n), sharpness: lq / n - (ls / n) * (ls / n), n: n };
  }
  C.noiseStats = function (src) { var img = pixelsSync(src, 1024); return img ? noiseStats(img) : null; };
  /* matchNoise(subject, background) → { grain: entry|null, blur: entry|null, stats }: grain to add when the background is noisier, a
     blur when the subject is sharper. Heuristic, documented in docs/FX-REFERENCE.md. */
  C.matchNoise = function (source, target, opts) {
    opts = opts || {};
    var a = C.noiseStats(source), b = C.noiseStats(target);
    if (!a || !b) return null;
    var need = Math.sqrt(Math.max(0, b.noise * b.noise - a.noise * a.noise)), grain = null, blur = null;
    if (need > 0.002) grain = { type: 'grain', p: { amount: Math.round(clamp(need / 0.105 * 100, 1, 100)), size: opts.grainSize || 1.1, luminance: 0.4, color: 0.15, seed: opts.seed || 1 } };
    var ratio = a.sharpness / Math.max(b.sharpness, 1e-9);
    if (ratio > 1.3) blur = { type: 'gaussian-blur', p: { radius: Math.round(clamp(Math.sqrt(Math.sqrt(ratio) - 1) * 0.8 / (opts.scale || 1), 0.1, 6) * 10) / 10 } };
    return { grain: grain, blur: blur, entries: [blur, grain].filter(Boolean), stats: { source: a, target: b } };
  };

  /* quadFromPlane(points, opts) → { quad, op }: corners (TL, TR, BR, BL, page units) for layer.transform.quad that put a layer on the
     planar surface `points`. opts: { layer (id, for the op), layerAspect (w / h of the artwork), aspect (true w / h of the surface;
     estimated from the perspective when omitted), fit: 'stretch' | 'contain' | 'cover', margin (0–0.45 of the surface), focal }. */
  function applyH(m, u, v) { var w = m[6] * u + m[7] * v + m[8]; return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w]; }
  /* The true aspect of a planar rectangle seen as a quad (Zhang & He 2007, "Whiteboard scanning and image enhancement"), with the
     principal point at the centre of `frame` (page size); falls back to the mean side lengths when the view is nearly frontal. */
  C.planeAspect = function (pts, frame) {
    var u0 = frame ? frame.w / 2 : 0, v0 = frame ? frame.h / 2 : 0;
    var P = pts.map(function (p) { return [p[0] - u0, p[1] - v0, 1]; });
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    /* Zhang–He order: m1 = TL→ BL? They use m1..m4 as corners of the rectangle in order; here TL, TR, BL, BR. */
    var m1 = P[3], m2 = P[2], m3 = P[0], m4 = P[1];
    var k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3), k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
    var n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
    var side = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    var simple = (side(pts[0], pts[1]) + side(pts[3], pts[2])) / Math.max(1e-9, side(pts[0], pts[3]) + side(pts[1], pts[2]));
    if (Math.abs(n2[2]) < 1e-6 || Math.abs(n3[2]) < 1e-6) return simple;
    var f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (!(f2 > 0)) return simple;
    var ar = Math.sqrt((n2[0] * n2[0] + n2[1] * n2[1] + n2[2] * n2[2] * f2) / (n3[0] * n3[0] + n3[1] * n3[1] + n3[2] * n3[2] * f2));
    return isFinite(ar) && ar > 0 ? ar : simple;
  };
  C.quadFromPlane = function (points, opts) {
    opts = opts || {};
    if (!Array.isArray(points) || points.length !== 4) throw new Error('quadFromPlane needs four points: top-left, top-right, bottom-right, bottom-left.');
    var pts = points.map(function (p) { return Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]; });
    var H = FX.quad.homography(pts), fit = opts.fit || 'stretch', m = clamp(opts.margin || 0, 0, 0.45);
    var u0 = m, v0 = m, u1 = 1 - m, v1 = 1 - m;
    if (fit !== 'stretch' && opts.layerAspect > 0) {
      var A = opts.aspect > 0 ? opts.aspect : C.planeAspect(pts, opts.frame), la = opts.layerAspect;
      var w = u1 - u0, h = v1 - v0, k = (la / A);   /* the layer's aspect in unit-square terms */
      var cw = w, ch = cw / k;
      if ((fit === 'contain' && ch > h) || (fit === 'cover' && ch < h)) { ch = h; cw = ch * k; }
      var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      u0 = cu - cw / 2; u1 = cu + cw / 2; v0 = cv - ch / 2; v1 = cv + ch / 2;
    }
    var quad = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(function (q) { var r = applyH(H, q[0], q[1]); return [Math.round(r[0] * 100) / 100, Math.round(r[1] * 100) / 100]; });
    return { quad: quad, op: opts.layer ? { op: 'transform.set', layer: opts.layer, quad: quad } : null };
  };

  /* shadowFromVanishing({ vanish, contact, ground, light }) → { direction, imageAngle }: the cast-shadow `direction` that makes the
     shadow follow the scene's perspective. vanish: the shadows' vanishing point on the horizon (page units); contact: the subject's
     contact point (page units); light 'behind-camera' (shadows recede toward vanish, the usual case) or 'facing-camera' (backlight:
     shadows come toward the viewer, away from vanish); or foot: the point on the ground under a lamp (shadows radiate away from it).
     ground: the cast-shadow `ground` value in use (default 0.3). Several subjects given the same vanish agree with each other. */
  C.shadowFromVanishing = function (o) {
    o = o || {};
    var c = o.contact, dx, dy;
    if (!c) throw new Error('shadowFromVanishing needs the contact point.');
    if (o.foot) { dx = c.x - o.foot.x; dy = c.y - o.foot.y; }
    else if (o.vanish) { dx = o.vanish.x - c.x; dy = o.vanish.y - c.y; if (o.light === 'facing-camera') { dx = -dx; dy = -dy; } }
    else throw new Error('shadowFromVanishing needs vanish or foot.');
    var k = o.ground > 0 ? o.ground : 0.3, phi = Math.atan2(dy / k, dx) / D2R;
    return { direction: Math.round(((phi % 360) + 360) % 360 * 10) / 10, imageAngle: Math.round(Math.atan2(dy, dx) / D2R * 10) / 10 };
  };

  /* ---------- Product presets: plain data. A number is used as is; { of: 'height' | 'width', k } is k × the subject's size in document
     pixels; 'anchor' is the measured contact point. stage() resolves them. ---------- */
  C.presets = {
    'studio-white-sweep': {
      name: 'Studio white sweep', summary: 'A product on a seamless white sweep: soft overhead light, a dark contact shadow and a faint, very soft shadow behind.',
      background: { type: 'color', color: '#f4f4f2' },
      entries: [
        { type: 'refine-edge', p: { smooth: 0.8, shift: -0.4, decontaminate: 0.7, defringe: 3 } },
        { type: 'contact-shadow', p: { opacity: 0.85, distance: { of: 'height', k: 0.08 }, softness: { of: 'height', k: 0.01 }, squash: 0.3, anchor: 'anchor', color: '#2a2a2a' } },
        { type: 'cast-shadow', p: { opacity: 0.35, direction: 305, elevation: 55, ground: 0.25, perspective: 0.2, blurNear: { of: 'height', k: 0.006 }, blurFar: { of: 'height', k: 0.12 }, fade: 0.85, height: { of: 'height', k: 1 }, anchor: 'anchor', color: '#303030' } }
      ]
    },
    'soft-table-reflection': {
      name: 'Soft table reflection', summary: 'A satin tabletop: a soft, short reflection, a contact shadow and a gentle cast shadow.',
      background: { type: 'color', color: '#ecebe8' },
      entries: [
        { type: 'refine-edge', p: { smooth: 0.8, shift: -0.4, decontaminate: 0.7, defringe: 3 } },
        { type: 'floor-reflection', p: { opacity: 0.22, distance: { of: 'height', k: 0.35 }, blur: 0.8, roughness: 0.45, fresnel: 0.6, perspective: 0.92, anchor: 'anchor' } },
        { type: 'contact-shadow', p: { opacity: 0.8, distance: { of: 'height', k: 0.07 }, softness: { of: 'height', k: 0.01 }, squash: 0.25, anchor: 'anchor' } },
        { type: 'cast-shadow', p: { opacity: 0.35, direction: 300, elevation: 48, ground: 0.28, perspective: 0.25, blurNear: { of: 'height', k: 0.006 }, blurFar: { of: 'height', k: 0.1 }, fade: 0.8, height: { of: 'height', k: 1 }, anchor: 'anchor' } }
      ]
    },
    'hard-sun': {
      name: 'Hard sun', summary: 'Direct sunlight: a crisp, long cast shadow with a short penumbra and a tight contact shadow.',
      background: { type: 'color', color: '#efe6d6' },
      entries: [
        { type: 'refine-edge', p: { smooth: 0.6, shift: -0.3, decontaminate: 0.6, defringe: 2.5 } },
        { type: 'contact-shadow', p: { opacity: 0.75, distance: { of: 'height', k: 0.04 }, softness: { of: 'height', k: 0.005 }, squash: 0.3, anchor: 'anchor', color: '#2b2118' } },
        { type: 'cast-shadow', p: { opacity: 0.72, direction: 325, elevation: 32, ground: 0.32, perspective: 0.3, blurNear: { of: 'height', k: 0.002 }, blurFar: { of: 'height', k: 0.025 }, fade: 0.25, height: { of: 'height', k: 1 }, anchor: 'anchor', color: '#3a2c1f' } }
      ]
    },
    'floating': {
      name: 'Floating', summary: 'The product hovers above a light ground with a soft elliptical shadow under it.',
      background: { type: 'color', color: '#f1f1ef' },
      entries: [
        { type: 'refine-edge', p: { smooth: 0.8, shift: -0.4, decontaminate: 0.7, defringe: 3 } },
        { type: 'floating-shadow', p: { opacity: 0.5, height: { of: 'height', k: 0.12 }, width: { of: 'width', k: 0.8 }, aspect: 0.12, softness: { of: 'height', k: 0.02 }, core: 0.35, drop: 1, anchor: 'anchor' } }
      ]
    },
    'dark-glossy': {
      name: 'Dark glossy', summary: 'A dark, polished surface: a strong, sharp reflection darkened by the surface colour and a deep contact shadow.',
      background: { type: 'color', color: '#141518' },
      entries: [
        { type: 'refine-edge', p: { smooth: 0.8, shift: -0.5, decontaminate: 0.8, defringe: 3 } },
        { type: 'floor-reflection', p: { opacity: 0.55, distance: { of: 'height', k: 0.6 }, blur: 0.5, roughness: 0.08, fresnel: 0.7, perspective: 0.95, tint: '#9a9ca3', anchor: 'anchor' } },
        { type: 'contact-shadow', p: { opacity: 0.9, distance: { of: 'height', k: 0.06 }, softness: { of: 'height', k: 0.008 }, squash: 0.25, anchor: 'anchor' } },
        { type: 'edge-light', p: { intensity: 0.35, angle: 120, width: { of: 'height', k: 0.006 }, softness: { of: 'height', k: 0.004 }, color: '#dfe6ff' } }
      ]
    }
  };
  function resolveValue(v, geo) {
    if (v === 'anchor') return { x: geo.anchor.x, y: geo.anchor.y };
    if (v && typeof v === 'object' && v.of) {
      var base = v.of === 'height' ? geo.height : v.of === 'width' ? geo.width : v.of === 'widthBox' ? geo.widthFrac : 0;
      return Math.round(base * v.k * 100) / 100;
    }
    return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  /* stage(docOrScene, layerId, presetId, opts) → { ok, ops, geometry, background, errors }. The ops are LE.fx.ops operations (fx.add,
     and fx.remove for this pack's entries already on the layer when opts.replace is true) for LEAgent.apply, in render order.
     The subject's contact and size come from opts.contact, else (when given a live LE.Scene) from the layer's cut-out, else from
     the layer box (bottom centre). */
  C.stage = function (doc, layerId, presetId, opts) {
    opts = opts || {};
    var preset = C.presets[presetId];
    if (!preset) return { ok: false, ops: [], errors: [{ code: 'unknown-preset', message: 'Known presets: ' + Object.keys(C.presets).join(', ') + '.' }] };
    var isScene = !!(doc && doc._assets && doc.toJSON), plain = isScene ? doc.toJSON() : doc;
    var layer = plain && Array.isArray(plain.layers) ? plain.layers.filter(function (l) { return l.id === layerId; })[0] : null;
    if (!layer) return { ok: false, ops: [], errors: [{ code: 'no-layer', message: 'No layer with that id.' }] };
    var ct = opts.contact || (isScene ? C.contact({ scene: doc, layer: layerId }) : null) || { x: 0.5, y: 1, top: 0, x0: 0.15, x1: 0.85, width: 0.7, height: 1, measured: false };
    var crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    var map = function (fx, fy) { return { x: (fx - crop.x) / crop.w, y: (fy - crop.y) / crop.h }; };
    var anc = map(ct.x, ct.y), top = map(0, ct.top == null ? 0 : ct.top).y;
    var geo = {
      anchor: { x: r4(anc.x), y: r4(anc.y) },
      height: Math.max(1, (anc.y - top) * layer.h), width: Math.max(1, (ct.width == null ? 0.7 : ct.width) / crop.w * layer.w),
      widthFrac: clamp((ct.width == null ? 0.7 : ct.width) / crop.w, 0.02, 2), measured: ct.measured !== false
    };
    var ops = [];
    if (opts.replace) {
      var mine = {};
      FX.list().forEach(function (id) { var d = FX.get(id); if (d && d._pack === 'composite') mine[id] = 1; });
      (Array.isArray(layer.fx) ? layer.fx : []).forEach(function (e) { if (e && mine[e.type] && e.id) ops.push({ op: 'fx.remove', layer: layerId, id: e.id }); });
    }
    preset.entries.forEach(function (en) {
      var p = {};
      Object.keys(en.p).forEach(function (k) { p[k] = resolveValue(en.p[k], geo); });
      ops.push({ op: 'fx.add', layer: layerId, entry: { type: en.type, p: p } });
    });
    return { ok: true, ops: ops, geometry: geo, background: preset.background, preset: { id: presetId, name: preset.name, summary: preset.summary }, errors: [] };
  };

  /* Mark this pack's registrations (stage(…, { replace: true }) uses it) and give radius/grow functions the layer box when they need
     it: the renderer passes (p, scale) only, so effects whose reach depends on the box size read it from the entry's own p where they can
     and fall back to a generous bound. See the report: a `box` argument for radius/grow is proposed. */
  ['cast-shadow', 'contact-shadow', 'floating-shadow', 'studio-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'edge-light', 'long-shadow', 'floor-reflection', 'water-reflection', 'glass-reflection', 'refine-edge', 'match-color', 'ambient-light', 'light-wrap', 'blend-options', 'apply-image', 'displace', 'mesh-warp']
    .forEach(function (id) { var d = FX.get(id); if (d) d._pack = 'composite'; });
  C.list = function () { return FX.list().filter(function (id) { var d = FX.get(id); return d && d._pack === 'composite'; }); };
  /* Helpers for agents (the fx.call operation). */
  if (FX.actions) {
    FX.actions.register({ id: 'composite.stage', label: 'Stage a product', kind: 'call', summary: 'Shadows and reflection for a cut-out subject in one step. Presets: ' + Object.keys(C.presets).join(', ') + '.',
      args: { preset: 'preset id', contact: 'optional { x, y } of where the subject touches the ground, fractions of the layer box' },
      run: function (ctx) { return C.stage(ctx.doc, ctx.layer.id, ctx.args.preset, ctx.args); } });
    FX.actions.register({ id: 'composite.match', label: 'Match the background', kind: 'call', needs: ['scene'], summary: 'Measures the layer and the page behind it and adds a match-color entry that brings the layer to the page\'s colour and contrast.',
      args: { strength: '0 to 100 (default 100)' },
      run: function (ctx) {
        if (!ctx.scene) return { ok: false, message: 'composite.match needs the open design; it is not available on plain files.' };
        return C.match({ scene: ctx.scene, layer: ctx.layer.id }, { scene: ctx.scene }, ctx.args).then(function (m) { return m ? { fx: [m.entry], data: { stats: m.stats, whiteBalance: m.whiteBalance } } : null; });
      } });
  }
})(window);
