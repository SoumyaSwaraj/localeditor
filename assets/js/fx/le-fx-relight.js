/* LocalEditor effect pack X6: relighting and depth effects (docs/FX-REFERENCE.md, section "Relight").
 *
 * Effects (all in linear light):
 *   relight      one light per entry (directional, point or spot, with a gobo pattern), diffuse + subtle specular from
 *                depth-derived normals, shadows ray-marched through the depth map, ambient occlusion, and an albedo estimate so the
 *                new light is not just multiplied onto the old one; "Existing light" and "Soften existing light" for the old light.
 *                Stack entries for more lights.
 *   rim-light    edge light from normals that face away from the camera and toward a back light (and from the cut-out's edge).
 *   light-rays   volumetric light / haze rays from a positionable source, occluded by near objects in the depth map.
 *   depth-fog    fog and atmospheric perspective by depth, optionally denser near the ground.
 *   catchlight   tiny, tasteful highlights in the eyes, placed from face landmarks; off by default.
 * Helpers (LE.fx.relight): presets, portrait(doc, layerId, presetId) -> ops, estimate(image, { depth, mask }) -> light
 * direction / softness / colour temperature, retime(), depthGrade(), backgroundDim(), depth.remap/stats/ground, kelvin().
 *
 * The model, and its limits (say these to people and agents):
 *   - Depth is the small on-device model's relative disparity (near = 1, robust-normalised per photo), not metres. Surface height is
 *     z = (D - 1) * relief * 0.5 * boxWidth (document pixels), so the nearest surface sits at z = 0 and lights with a positive
 *     height are in front of it. Normals are its gradient after a small blur, with the slope softly capped (tanh) so depth cliffs
 *     at silhouettes do not become sideways walls. Normals are derived here and never stored.
 *   - Edge-aware depth: the ~518 px depth grid is sampled bilinearly, then refined with a 3 x 3 joint bilateral filter (Kopf et al. 2007,
 *     "Joint bilateral upsampling") whose range kernel is the photo's colour and, where the layer has a cut-out, the cut-out's alpha,
 *     so light and shadow do not halo past subject edges. Draft skips it.
 *   - Albedo: an intrinsic-image approximation, not a decomposition. The existing illumination is estimated as the luminance of a
 *     Gaussian-blurred copy (sigma about 2 % of the layer), re-averaged with depth- and luminance-aware weights so it does not leak across edges.
 *     Relative reflectance A = colour / that illumination (about 1 for an average surface). New light adds A * light; "Soften
 *     existing light" divides out the estimated illumination towards the picture's mean (Retinex-like flattening). It cannot remove
 *     hard cast shadows or specular highlights already in the photo, and it reads large dark objects partly as "in shadow".
 *   - Light units are relative to the photo: intensity 1 adds, on a surface facing the light, as much light as the picture's average
 *     illumination (mean luminance from g.stats(), so preview, tiles and export agree).
 *   - Shading: Lambert with wrap (softness) + GGX specular (F0 0.04, roughness), orthographic viewer. Point and spot lights fall off
 *     with the inverse square, normalised to 1 at the aim point. Shadows: a screen-space ray march along the light direction through
 *     the height field, with a penumbra that widens with distance (soft-shadow height-field marching), reach given by "Shadow length"
 *     (declared in radius(), so tiles agree). AO: horizon-based (relative to the tangent plane), 6 directions x 2 radii.
 *
 * Renderer seam (see the report): the renderer has no handle for the raw depth map yet, so depthRaw() reads it through two depth
 * mask parts (near 1, far 1, soft 1 gives smoothstep(0, 1, farness); the inverted part keeps precision at the far end) and inverts
 * the smoothstep. When LE.fx grows g.map('depth') this file uses it instead with no other change. On 8-bit devices that path
 * quantises depth to 8 bits (soft but usable); half-float devices keep about 11 bits. */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || !FX.register) return;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  /* Read at call time: the renderer adds blurReach to LE.fx.math when it loads, which on some pages is after this pack. */
  function blurReach(s) { var f = FX.math && FX.math.blurReach; return f ? f(s) : Math.ceil(3 * s) + 8; }

  /* LE.maps (assets/js/le-maps.js) draws face masks for the renderer and makes the maps; load it with the pack. It fetches
     nothing by itself: no model, worker or engine starts until a map is asked for. */
  (function loadMaps() {
    if (LE.maps || typeof document === 'undefined') return;
    try {
      var here = (document.currentScript && document.currentScript.src) || '';
      var base = here ? new URL('../le-maps.js', here).href : null;
      if (!base) return;
      var s = document.createElement('script'); s.src = base; s.async = true; document.head.appendChild(s);
    } catch (e) { /* the pack works without it */ }
  })();

  /* ---------- Colour of light ---------- */
  /* Black body (Kim et al. 2002 cubic fit of the Planckian locus in CIE 1931 xy, 1667–25000 K) to linear sRGB, luminance 1, so that
     6504 K is about (1, 1, 1). tint −100…100 moves towards magenta (+) or green (−). */
  function kelvin(T, tint) {
    T = clamp(num(T, 6500), 1667, 25000);
    var t = 1e3 / T, t2 = t * t, t3 = t2 * t, x;
    if (T <= 4000) x = -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910;
    else x = -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
    var x2 = x * x, x3 = x2 * x, y;
    if (T <= 2222) y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
    else if (T <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
    else y = 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
    var X = x / y, Z = (1 - x - y) / y;
    var r = 3.2404542 * X - 1.5371385 - 0.4985314 * Z, g = -0.9692660 * X + 1.8760108 + 0.0415560 * Z, b = 0.0556434 * X - 0.2040259 + 1.0572252 * Z;
    var k = (tint || 0) / 100 * 0.25;
    r *= 1 + k; g *= 1 - k; b *= 1 + k;
    r = Math.max(r, 0); g = Math.max(g, 0); b = Math.max(b, 0);
    var l = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
    return [r / l, g / l, b / l];
  }
  function lightRGB(g, p, scale) {
    var k = kelvin(p.temperature, p.tint), c = g.rgb(p.color || '#ffffff');
    return [k[0] * c[0] * scale, k[1] * c[1] * scale, k[2] * c[2] * scale];
  }
  /* The picture's mean illumination in linear light, from the renderer's whole-image statistics (the same for every tile). */
  function meanLight(g) {
    var st = null;
    try { st = g.stats ? g.stats() : null; } catch (e) { st = null; }
    var m = st && st.mean && typeof st.mean.luma === 'number' ? st.mean.luma : 0.45;
    return Math.max(0.02, FX.math.srgbToLinear(clamp(m, 0, 1)));
  }

  /* ---------- Depth: read, decode, refine ---------- */
  var CLAMP_IMG = 'vec2 clampImg(vec2 uv){ return clamp(uv, u_img.xy + 0.5 * u_texel, u_img.zw - 0.5 * u_texel); }\n';
  var DECODE = 'uniform sampler2D u_a, u_b;\n' + CLAMP_IMG +
    'float invS(float y){ y = clamp(y, 0.0, 1.0); return 0.5 - sin(asin(1.0 - 2.0 * y) / 3.0); }\n' +
    'vec4 fx(){ vec2 uv = clampImg(v_uv); float a = texture(u_a, uv).r, b = 1.0 - texture(u_b, uv).r; return vec4(1.0 - invS(a < 0.5 ? a : b), 0.0, 0.0, 1.0); }';
  /* Depth (near = 1) at the working rectangle, edge-extended beyond the picture. 3 passes through the seam, 0 with g.map. */
  function depthRaw(g) {
    if (typeof g.map === 'function') { var h = g.map('depth'); if (h) return h; }
    var a = g.mask({ on: true, parts: [{ kind: 'depth', near: 1, far: 1, soft: 1 }] });
    var b = g.mask({ on: true, parts: [{ kind: 'depth', near: 1, far: 1, soft: 1, invert: true }] });
    var d = g.pass(DECODE, { u_a: a, u_b: b });
    g.release(a); g.release(b);
    return d;
  }
  /* Joint bilateral refinement: 3 x 3 taps 1.6 depth texels apart; range weights from the photo (display colour) and the cut-out. */
  var JBU = 'uniform sampler2D u_d, u_sub; uniform float u_step, u_sigR, u_useSub;\n' + CLAMP_IMG +
    'vec3 guideAt(vec2 uv){ return clamp(toDisplay(unpremul(texture(u_src, uv))), 0.0, 1.0); }\n' +
    'vec4 fx(){ vec2 c = clampImg(v_uv); vec3 c0 = guideAt(c); float s0 = texture(u_sub, c).r; float ws = 0.0, ds = 0.0;\n' +
    '  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {\n' +
    '    vec2 o = vec2(float(i), float(j)) * 1.6; vec2 uv = clampImg(v_uv + docToUV(o * u_step));\n' +
    '    vec3 dc = guideAt(uv) - c0; float sb = (texture(u_sub, uv).r - s0) * u_useSub;\n' +
    '    float w = exp(-dot(o, o) * 0.35 - dot(dc, dc) * u_sigR - sb * sb * 40.0) + 1e-6;\n' +
    '    ws += w; ds += w * texture(u_d, uv).r; }\n' +
    '  return vec4(ds / ws, 0.0, 0.0, 1.0); }';
  function boxMax(g) { return Math.max(g.box.w, g.box.h, 1); }
  /* Sizes in document pixels that follow the layer, capped so radius() (which cannot see the box) can declare the maximum. */
  var CAP = { step: 8, smooth: 16, albedo: 24, ao: 60 };
  function sizes(g) {
    var B = boxMax(g);
    return { step: clamp(B / 518, 1, CAP.step), smooth: clamp(B * 0.01, 2, CAP.smooth), albedo: clamp(B * 0.02, 4, CAP.albedo), ao: clamp(B * 0.03, 4, CAP.ao) };
  }
  function depthRefined(g, p, sz, draft) {
    var d0 = depthRaw(g);
    if (draft) return d0;
    var sub = p.subject ? g.mask({ on: true, parts: [{ kind: 'subject' }] }) : null;
    var d = g.pass(JBU, { u_d: d0, u_sub: sub || d0, u_step: sz.step, u_sigR: 1 / (2 * 0.08 * 0.08), u_useSub: sub ? 1 : 0 });
    g.release(d0); if (sub) g.release(sub);
    return d;
  }
  function depthReach(scale) { return Math.ceil(2 * CAP.step * scale) + 2; }

  /* ---------- Shared GLSL: height, normals, light ---------- */
  var SURF = [
    'uniform sampler2D u_dr, u_ds; uniform float u_zs, u_h, u_cap, u_md;',
    CLAMP_IMG,
    'float depthAt(vec2 uv){ return texture(u_dr, clampImg(uv)).r; }',
    'float zAt(vec2 uv){ return (depthAt(uv) - 1.0) * u_zs; }',
    /* Normal in document space: x right, y DOWN, z toward the viewer.
       u_md 1 (relight): an edge-aware plane fit. A first gradient from minimum-difference derivatives of the refined depth (at a cliff
       it takes the side that continues this surface), then a weighted least-squares fit over 8 taps alternating u_h and 2·u_h whose weights
       fall with each tap's residual from that first plane: smooth on a surface, never across a depth edge, so the background next to
       a subject is not shaded as a slope (a halo). u_md 0 (rim light): central differences of the Gaussian-smoothed depth, which
       deliberately bend at silhouettes. */
    'vec3 normalAt(vec2 uv){',
    '  vec2 ex = docToUV(vec2(u_h, 0.0)), ey = docToUV(vec2(0.0, u_h)); vec2 gr;',
    '  if (u_md > 0.5) {',
    '    float r0 = texture(u_dr, clampImg(uv)).r, xf = texture(u_dr, clampImg(uv + ex)).r - r0, xb = r0 - texture(u_dr, clampImg(uv - ex)).r, yf = texture(u_dr, clampImg(uv + ey)).r - r0, yb = r0 - texture(u_dr, clampImg(uv - ey)).r;',
    '    vec2 g0 = vec2(abs(xf) < abs(xb) ? xf : xb, abs(yf) < abs(yb) ? yf : yb) / u_h;',
    '    float axx = 1e-6, axy = 0.0, ayy = 1e-6; vec2 b = vec2(0.0);',
    '    for (int k = 0; k < 8; k++) { float an = float(k) * 0.785398; vec2 o = vec2(cos(an), sin(an)) * u_h * (k % 2 == 0 ? 1.0 : 2.0);',
    '      float d = texture(u_dr, clampImg(uv + docToUV(o))).r - r0, res = d - dot(g0, o), w = exp(-res * res * 4000.0);',
    '      axx += w * o.x * o.x; axy += w * o.x * o.y; ayy += w * o.y * o.y; b += w * o * d; }',
    '    float det = axx * ayy - axy * axy; gr = det > 1e-9 ? vec2(ayy * b.x - axy * b.y, axx * b.y - axy * b.x) / det : g0;',
    '  } else {',
    '    gr = vec2(texture(u_ds, clampImg(uv + ex)).r - texture(u_ds, clampImg(uv - ex)).r, texture(u_ds, clampImg(uv + ey)).r - texture(u_ds, clampImg(uv - ey)).r) / (2.0 * u_h); }',
    '  vec2 s = gr * u_zs; float m = length(s); if (m > 1e-6 && u_cap > 0.0) s *= tanh(m / u_cap) * u_cap / m;',
    '  return normalize(vec3(-s, 1.0)); }'
  ].join('\n');

  var RELIGHT = [
    'uniform sampler2D u_b; uniform float u_type, u_lz, u_fall, u_wrap, u_spec, u_rough, u_sh, u_slen, u_steps, u_pen, u_exist, u_soft, u_lmean, u_ao, u_aor, u_sigB, u_pat;',
    'uniform vec2 u_lpos, u_aim, u_center, u_cone; uniform vec3 u_col;',
    SURF,
    'float ign(){ vec2 p = floor(docPos() * u_scale); return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }',
    /* Gobo patterns in the spot's own frame (q in -1..1 across the cone). */
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(docNoise(i, 7.0), docNoise(i + vec2(1.0, 0.0), 7.0), f.x), mix(docNoise(i + vec2(0.0, 1.0), 7.0), docNoise(i + vec2(1.0, 1.0), 7.0), f.x), f.y); }',
    'float gobo(vec2 q, float soft){',
    '  float e = 0.02 + soft * 0.12;',
    '  if (u_pat < 1.5) { vec2 g = abs(fract(vec2(q.x * 1.0 + 1.0, q.y * 1.5 + 1.5)) - 0.5) * 2.0; return (1.0 - smoothstep(0.86 - e, 0.9 + e, g.x)) * (1.0 - smoothstep(0.86 - e, 0.9 + e, g.y)); }',
    '  if (u_pat < 2.5) { float s = 0.5 + 0.5 * cos(q.y * 3.14159265 * 9.0); return smoothstep(0.35 - e * 2.0, 0.55 + e * 2.0, s); }',
    '  float n = vnoise(q * 3.0) * 0.6 + vnoise(q * 7.0 + 11.0) * 0.4; return smoothstep(0.42 - e, 0.58 + e, n); }',
    'vec4 fx(){',
    '  vec4 s = src(v_uv); float a = s.a; if (a <= 0.0) return vec4(0.0);',
    '  vec3 c = s.rgb / a; vec2 uv0 = v_uv; vec2 P = docPos();',
    '  float D0 = depthAt(uv0), zP = (D0 - 1.0) * u_zs;',
    /* Existing illumination: blurred luminance from 9 taps (centre and a ring at 1.6 sigma), weighted by depth and by log-luminance similarity (a cross-bilateral on a blurred copy) so it does not leak across subject edges. */
    '  float lw = 0.0, ls = 0.0, lc = log(max(luma(c), 1e-4));',
    '  for (int k = 0; k < 9; k++) { vec2 o = k == 0 ? vec2(0.0) : vec2(cos(float(k) * 0.785398), sin(float(k) * 0.785398)) * u_sigB * 1.6;',
    '    vec2 uv = clampImg(uv0 + docToUV(o)); float dd = depthAt(uv) - D0; float lt = max(luma(unpremul(texture(u_b, uv))), 1e-4); float dl = log(lt) - lc; float w = (k == 0 ? 1.0 : 0.7) * exp(-dd * dd * 300.0 - dl * dl * 1.5);',
    '    lw += w; ls += w * lt; }',
    '  float Lb = max(ls / lw, u_lmean * 0.03);',
    '  vec3 A = min(c / Lb, vec3(4.0));',
    '  vec3 outc = c * pow(u_lmean / Lb, u_soft) * u_exist;',
    /* Ambient occlusion from the height field (horizon based). */
    '  vec3 N = normalAt(uv0);',
    '  if (u_ao > 0.0) { float occ = 0.0; float j = ign() * 0.785398; vec2 tgs = -N.xy / max(N.z, 0.2);',
    '    for (int k = 0; k < 6; k++) { vec2 dir = vec2(cos(float(k) * 1.047198 + j), sin(float(k) * 1.047198 + j)); float m = 0.0;',
    '      for (int r = 1; r <= 2; r++) { float rr = u_aor * float(r) / 2.0; float dz = zAt(uv0 + docToUV(dir * rr)) - zP; m = max(m, clamp(dz / rr - dot(tgs, dir) - 0.05, 0.0, 1.0) * (1.0 - smoothstep(rr * 1.5, rr * 3.0, dz))); }',
    '      occ += m; }',
    '    outc *= mix(1.0, clamp(1.0 - occ / 6.0 * 1.6, 0.0, 1.0), u_ao); }',
    '  if (max(u_col.r, max(u_col.g, u_col.b)) <= 0.0) return vec4(outc * a, a);',
    '  vec3 P3 = vec3(P, zP), L, Lv; float att = 1.0, dist2 = 1e9;',
    '  if (u_type < 0.5) { Lv = vec3(u_lpos - u_center, u_lz + 1e-3); L = normalize(Lv); }',
    '  else { Lv = vec3(u_lpos, u_lz) - P3; L = normalize(Lv); dist2 = length(Lv.xy);',
    '    vec3 R = vec3(u_lpos, u_lz) - vec3(u_aim, 0.0); att = mix(1.0, dot(R, R) / max(dot(Lv, Lv), 1.0), u_fall); }',
    '  if (u_type > 1.5) { vec3 ax = normalize(vec3(u_aim, 0.0) - vec3(u_lpos, u_lz)); float ca = dot(-L, ax);',
    '    att *= smoothstep(u_cone.x, u_cone.y, ca);',
    '    if (u_pat > 0.5) { vec3 up = abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0); vec3 T = normalize(cross(up, ax)), Bv = cross(ax, T);',
    '      vec3 v = P3 - vec3(u_lpos, u_lz); float dd = max(dot(v, ax), 1.0); vec2 q = vec2(dot(v, T), dot(v, Bv)) / dd / max(sqrt(1.0 - u_cone.x * u_cone.x) / max(u_cone.x, 1e-3), 1e-3);',
    '      att *= gobo(q, u_wrap); } }',
    '  float ndl = dot(N, L); float diff = max((ndl + u_wrap) / (1.0 + u_wrap), 0.0);',
    '  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0)); float nh = max(dot(N, H), 0.0); float al = max(u_rough * u_rough, 0.002), a2 = al * al;',
    '  float dg = nh * nh * (a2 - 1.0) + 1.0; float spec = a2 / (3.14159265 * dg * dg) * 0.04 * 3.14159265 * 0.25 * max(ndl, 0.0) * u_spec;',
    '  float vis = 1.0;',
    '  if (u_sh > 0.0 && u_steps > 0.0 && (diff > 0.0 || spec > 0.0) && length(L.xy) > 1e-3) {',
    '    vec2 d2 = normalize(L.xy); float slope = L.z / length(L.xy); float tmax = min(u_slen, dist2); float stp = tmax / u_steps;',
    '    float t = stp * (0.5 + ign()); float bias = u_zs * 0.01 + stp * 0.15;',
    '    for (int i = 0; i < 96; i++) { if (float(i) >= u_steps || t > tmax) break;',
    '      float zs = zAt(uv0 + docToUV(d2 * t)); float ray = zP + slope * t + bias; float pen = max(t * u_pen, 1.5);',
    '      vis = min(vis, clamp((ray - zs) / pen * 0.5 + 0.5, 0.0, 1.0)); t += stp; }',
    '    vis = mix(1.0, vis, u_sh); }',
    '  vec3 add = u_col * att * vis * (A * diff + vec3(min(spec, 8.0)));',
    '  return vec4((outc + add) * a, a); }'
  ].join('\n');

  var GPU = { needs: ['webgl2'], wants: ['webgl-float'], memoryMB: 200 };
  var TYPES = [{ value: 'directional', label: 'Sun' }, { value: 'point', label: 'Bulb' }, { value: 'spot', label: 'Spot' }];
  var QUALITY = [{ value: 'draft', label: 'Draft' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }];
  var STEPS = { draft: 12, standard: 32, high: 64 };
  function relightNeutral(p) { return !(p.intensity > 0) && p.existing === 1 && p.soften === 0 && p.ao === 0; }

  FX.register({
    id: 'relight', name: 'Relight', group: 'light', version: 1, space: 'linear', needs: ['depth', 'normals', 'stats'],
    params: {
      type: { type: 'choice', options: TYPES, default: 'point', label: 'Light' },
      position: { type: 'point', default: { x: 0.25, y: 0.2 }, label: 'Position', help: 'Where the light is, over the photo. For the sun, the direction it comes from.' },
      height: { type: 'number', min: -1, max: 3, default: 0.6, step: 0.01, label: 'Height', help: 'Distance in front of the subject, in widths of the layer. Below 0 is behind (a back light).' },
      aim: { type: 'point', default: { x: 0.5, y: 0.5 }, label: 'Aim', help: 'Where a spot points; for a bulb, where its strength is as set.' },
      cone: { type: 'number', min: 5, max: 89, default: 35, step: 1, unit: 'deg', label: 'Spread' },
      pattern: { type: 'choice', options: [{ value: 'none', label: 'None' }, { value: 'window', label: 'Window' }, { value: 'blinds', label: 'Blinds' }, { value: 'leaves', label: 'Leaves' }], default: 'none', label: 'Pattern' },
      intensity: { type: 'number', min: 0, max: 4, default: 0, step: 0.01, label: 'Intensity', help: '1 adds as much light as the photo\'s average light, on a surface facing the light.' },
      temperature: { type: 'number', min: 1900, max: 12000, default: 5500, step: 50, unit: 'K', label: 'Temperature' },
      tint: { type: 'number', min: -100, max: 100, default: 0, step: 1, label: 'Tint' },
      color: { type: 'color', default: '#ffffff', label: 'Gel' },
      softness: { type: 'number', min: 0, max: 1, default: 0.4, step: 0.01, label: 'Softness', help: 'Size of the light: wraps light round forms and softens shadow edges.' },
      falloff: { type: 'number', min: 0, max: 1, default: 1, step: 0.01, label: 'Falloff', help: '1 is the inverse square of a real lamp; 0 keeps the same strength everywhere.' },
      specular: { type: 'number', min: 0, max: 1, default: 0.2, step: 0.01, label: 'Shine' },
      roughness: { type: 'number', min: 0.05, max: 1, default: 0.45, step: 0.01, label: 'Roughness' },
      shadows: { type: 'number', min: 0, max: 1, default: 0.7, step: 0.01, label: 'Shadows' },
      shadowLength: { type: 'number', min: 0, max: 240, default: 120, step: 1, unit: 'px', label: 'Shadow length' },
      relief: { type: 'number', min: 0, max: 4, default: 1.2, step: 0.01, label: 'Depth', help: 'How deep the scene is taken to be; more makes forms rounder and shadows longer.' },
      existing: { type: 'number', min: 0, max: 2, default: 1, step: 0.01, label: 'Existing light' },
      soften: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Soften existing light' },
      ao: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Contact shadows' },
      subject: { type: 'bool', default: true, label: 'Snap depth to cut-out' },
      quality: { type: 'choice', options: QUALITY, default: 'standard', label: 'Quality' }
    },
    radius: function (p, s) {
      if (relightNeutral(p)) return 0;
      return depthReach(s) + Math.ceil(s * (Math.max(p.shadowLength, CAP.ao, CAP.albedo * 1.6) + CAP.smooth * 2)) + blurReach(CAP.albedo * s) + 4;
    },
    draft: function (p) { var q = Object.assign({}, p); q.quality = 'draft'; return q; },
    passes: function (g, p) {
      if (relightNeutral(p)) return;
      var sz = sizes(g), draft = g.draft || p.quality === 'draft', lmean = meanLight(g);
      var dr = depthRefined(g, p, sz, draft);
      var ds = dr;   /* normals come from an edge-aware fit on the refined depth (normalAt, u_md 1); no smoothed copy is needed */
      var bl = g.blur(sz.albedo, { source: g.source });
      var bw = g.box.w, cone = p.cone * Math.PI / 180, edge = clamp(p.softness, 0.02, 1) * 0.6;
      var steps = p.shadows > 0 ? STEPS[draft ? 'draft' : p.quality] || 32 : 0;
      var out = g.pass(RELIGHT, {
        u_dr: dr, u_ds: ds, u_b: bl, u_zs: p.relief * 0.5 * bw, u_h: sz.smooth, u_cap: 1.6, u_md: 1,
        u_type: p.type === 'directional' ? 0 : p.type === 'spot' ? 2 : 1,
        u_lpos: [p.position.x * g.box.w, p.position.y * g.box.h], u_lz: p.height * bw, u_aim: [p.aim.x * g.box.w, p.aim.y * g.box.h], u_center: [g.box.w / 2, g.box.h / 2],
        u_cone: [Math.cos(cone), Math.cos(cone * (1 - edge))], u_col: lightRGB(g, p, p.intensity * lmean),
        u_fall: p.falloff, u_wrap: p.softness * 0.6, u_spec: p.specular, u_rough: p.roughness, u_sh: p.shadows, u_slen: p.shadowLength, u_steps: steps,
        u_pen: 0.01 + p.softness * 0.35, u_exist: p.existing, u_soft: p.soften, u_lmean: lmean, u_ao: p.ao, u_aor: sz.ao, u_sigB: sz.albedo,
        u_pat: p.type === 'spot' ? ({ none: 0, window: 1, blinds: 2, leaves: 3 }[p.pattern] || 0) : 0
      });
      g.release(dr); g.release(bl);
      return out;
    },
    support: GPU,
    ui: { section: 'Light', order: 60, controls: [
      { heading: 'Light' }, 'type', 'position', { param: 'height', fine: true }, { param: 'aim', when: { type: 'spot' } }, { param: 'cone', when: { type: 'spot' } }, { param: 'pattern', when: { type: 'spot' } },
      'intensity', { param: 'temperature', gradient: 'temperature' }, { param: 'tint', gradient: 'tint' }, 'color', 'softness', { param: 'falloff', when: { type: 'point' } },
      { heading: 'Surface' }, 'specular', 'roughness', 'relief',
      { heading: 'Shadows' }, 'shadows', 'shadowLength', 'ao',
      { heading: 'Existing light' }, 'existing', 'soften',
      { heading: 'Quality' }, 'subject', 'quality'
    ] },
    agent: {
      summary: 'Adds one light to a photo using its depth map: a sun, a bulb or a spot (with a window, blinds or leaves pattern), with soft shadows cast through the depth map, contact shadows, and controls to dim or flatten the light already in the photo. Stack entries for more lights.',
      tips: [
        'Needs layer.maps.depth: run { op: "map.generate", layer, kind: "depth" } first. Without it the light falls on a flat plane, without shadows.',
        'position and aim are fractions of the layer box; height is in layer widths in front of the nearest surface (0.3 to 1 for a key light, negative for a back light).',
        'A believable key: intensity 0.8 to 1.6, softness 0.4 to 0.7, existing 0.6 to 0.85, soften 0.2 to 0.4. Put existing and soften on the first light only.',
        'Match the photo: LE.fx.relight.estimate(...) gives the current light; to strengthen it, place the light on the same side.',
        'For portraits use LE.fx.relight.portrait(doc, layerId, presetId), which places lights from the face landmarks.',
        'Limits: the depth is a small model\'s relative guess; hair, glass and thin things get soft, and strong hard light on flat walls can look wavy. Keep relief 0.8 to 1.6 and softness above 0.25.'
      ],
      example: { type: 'relight', p: { type: 'point', position: { x: 0.2, y: 0.15 }, height: 0.6, intensity: 1.2, temperature: 4800, softness: 0.5, existing: 0.75, soften: 0.3 } }
    }
  });

  /* ---------- Rim light ---------- */
  var RIM = [
    'uniform sampler2D u_sub; uniform vec2 u_dir; uniform vec3 u_col; uniform float u_pow, u_lmean, u_useSub, u_sw;',
    SURF,
    'vec4 fx(){ vec4 s = src(v_uv); float a = s.a; if (a <= 0.0) return vec4(0.0); vec3 c = s.rgb / a;',
    '  vec3 N = normalAt(v_uv); float D = depthAt(v_uv), Ds = texture(u_ds, clampImg(v_uv)).r;',
    '  vec2 nd = length(N.xy) > 1e-4 ? normalize(N.xy) : vec2(0.0);',
    '  float face = clamp(dot(nd, u_dir), 0.0, 1.0);',
    '  float rim = pow(clamp((1.0 - N.z) / 0.47, 0.0, 1.0), u_pow) * face * face * smoothstep(-0.002, 0.02, D - Ds);',
    '  if (u_useSub > 0.5) { vec2 ex = docToUV(vec2(u_sw, 0.0)), ey = docToUV(vec2(0.0, u_sw));',
    '    vec2 gr = vec2(texture(u_sub, v_uv + ex).r - texture(u_sub, v_uv - ex).r, texture(u_sub, v_uv + ey).r - texture(u_sub, v_uv - ey).r);',
    '    float gm = length(gr); if (gm > 1e-4) { float f2 = clamp(dot(-gr / gm, u_dir), 0.0, 1.0); rim = max(rim, clamp(gm * 1.5, 0.0, 1.0) * f2 * f2 * texture(u_sub, v_uv).r); } }',
    '  vec3 A = min(c / max(u_lmean, 1e-3), vec3(3.0));',
    '  return vec4((c + u_col * rim * (0.35 + 0.65 * A)) * a, a); }'
  ].join('\n');
  FX.register({
    id: 'rim-light', name: 'Rim light', group: 'light', version: 1, space: 'linear', needs: ['depth', 'normals', 'stats'],
    params: {
      angle: { type: 'angle', default: 135, label: 'From', help: 'Direction the back light comes from, on the photo: 0 right, 90 top, 180 left.' },
      intensity: { type: 'number', min: 0, max: 4, default: 0, step: 0.01, label: 'Intensity' },
      width: { type: 'number', min: 0, max: 1, default: 0.5, step: 0.01, label: 'Width' },
      temperature: { type: 'number', min: 1900, max: 12000, default: 6500, step: 50, unit: 'K', label: 'Temperature' },
      color: { type: 'color', default: '#ffffff', label: 'Gel' },
      relief: { type: 'number', min: 0, max: 4, default: 1.2, step: 0.01, label: 'Depth' }
    },
    radius: function (p, s) { return p.intensity > 0 ? depthReach(s) + blurReach(CAP.smooth * s * 2) + Math.ceil(CAP.smooth * 2 * s) + blurReach(12 * s) + 16 : 0; },
    passes: function (g, p) {
      if (!(p.intensity > 0)) return;
      var sz = sizes(g), lmean = meanLight(g), a = p.angle * Math.PI / 180;
      var dr = depthRefined(g, { subject: true }, sz, g.draft);
      var sm = sz.smooth * (1 + p.width), ds = g.blur(sm, { source: dr });
      var subRaw = g.mask({ on: true, parts: [{ kind: 'subject' }] }), sw = clamp(boxMax(g) * 0.004 * (0.5 + p.width * 1.5), 1, 12);
      var sub = g.blur(sw, { source: subRaw }); g.release(subRaw);
      var out = g.pass(RIM, { u_dr: dr, u_ds: ds, u_sub: sub, u_zs: p.relief * 0.5 * g.box.w, u_h: sm, u_cap: 1.6, u_dir: [Math.cos(a), -Math.sin(a)],
        u_col: lightRGB(g, { temperature: p.temperature, color: p.color }, p.intensity * lmean), u_pow: 2.5 - p.width * 2.0, u_md: 0, u_lmean: lmean, u_useSub: 1, u_sw: sw });
      g.release(dr); g.release(ds); g.release(sub);
      return out;
    },
    support: GPU,
    ui: { section: 'Light', order: 70, controls: ['angle', 'intensity', 'width', { param: 'temperature', gradient: 'temperature' }, 'color', 'relief'] },
    agent: {
      summary: 'A back light that outlines the subject: lights the edges whose surface turns away from the camera towards the light (from the depth map), and the edge of a cut-out.',
      tips: ['angle is where the light comes from on the photo (135 = upper left). Two entries on opposite sides give a classic double rim.', 'Intensity 0.8 to 2 with width 0.3 to 0.6 reads as a studio rim; a cut-out makes the edge crisp.', 'Pair it with "existing" below 1 on a relight entry, or a darker background, so the rim shows.'],
      example: { type: 'rim-light', p: { angle: 140, intensity: 1.4, width: 0.45, temperature: 7000 } }
    }
  });

  /* ---------- Volumetric light rays ---------- */
  var EMIT = 'uniform sampler2D u_d; uniform float u_thr, u_dep;\n' + CLAMP_IMG +
    'vec4 fx(){ vec2 uv = clampImg(v_uv); vec3 c = unpremul(texture(u_src, uv)); float l = luma(toDisplay(max(c, 0.0)));\n' +
    '  float e = clamp((l - u_thr) / max(1.0 - u_thr, 0.02), 0.0, 1.0); float far = 1.0 - texture(u_d, uv).r;\n' +
    '  e *= mix(1.0, smoothstep(0.35, 0.85, far), u_dep); return vec4(c * e, 1.0); }';
  var RAYS = 'uniform sampler2D u_e; uniform vec2 u_sun; uniform vec3 u_col; uniform float u_len, u_steps, u_decay;\n' +
    'vec4 fx(){ vec4 s = src(v_uv); vec2 P = docPos(); vec2 d = u_sun - P; float dist = length(d); if (dist < 1e-3) return s;\n' +
    '  vec2 dir = d / dist; float tmax = min(u_len, dist), stp = tmax / u_steps; vec3 acc = vec3(0.0); float wsum = 0.0;\n' +
    '  vec2 q = floor(docPos() * u_scale); float t = stp * fract(52.9829189 * fract(dot(q, vec2(0.06711056, 0.00583715))));\n' +
    '  for (int i = 0; i < 96; i++) { if (float(i) >= u_steps) break; float w = exp(-t / max(u_len, 1.0) * u_decay * 4.0);\n' +
    '    acc += unpremul(texture(u_e, v_uv + docToUV(dir * t))) * w; wsum += 1.0; t += stp; }\n' +
    '  vec3 r = acc / max(wsum, 1.0); return vec4(s.rgb + u_col * r * s.a, s.a); }';
  FX.register({
    id: 'light-rays', name: 'Light rays', group: 'effects', version: 1, space: 'linear', needs: ['depth'],
    params: {
      source: { type: 'point', default: { x: 0.75, y: 0.08 }, label: 'Light source' },
      intensity: { type: 'number', min: 0, max: 3, default: 0, step: 0.01, label: 'Intensity' },
      length: { type: 'number', min: 10, max: 360, default: 240, step: 1, unit: 'px', label: 'Length' },
      decay: { type: 'number', min: 0, max: 1, default: 0.5, step: 0.01, label: 'Falloff' },
      threshold: { type: 'number', min: 0, max: 0.98, default: 0.6, step: 0.01, label: 'Threshold', help: 'Only areas brighter than this send out rays.' },
      depth: { type: 'number', min: 0, max: 1, default: 0.7, step: 0.01, label: 'Use depth', help: 'At 1 only the far background glows and near objects block the rays.' },
      temperature: { type: 'number', min: 1900, max: 12000, default: 5000, step: 50, unit: 'K', label: 'Temperature' },
      quality: { type: 'choice', options: QUALITY, default: 'standard', label: 'Quality' }
    },
    radius: function (p, s) { return p.intensity > 0 ? Math.ceil(p.length * s) + 4 : 0; },
    draft: function (p) { var q = Object.assign({}, p); q.quality = 'draft'; return q; },
    passes: function (g, p) {
      if (!(p.intensity > 0)) return;
      var d = depthRaw(g), e = g.pass(EMIT, { u_d: d, u_thr: p.threshold, u_dep: p.depth }, { scale: 0.5 });
      g.release(d);
      var steps = { draft: 16, standard: 40, high: 80 }[g.draft ? 'draft' : p.quality] || 40;
      var out = g.pass(RAYS, { u_e: e, u_sun: [p.source.x * g.box.w, p.source.y * g.box.h], u_col: lightRGB(g, { temperature: p.temperature }, p.intensity), u_len: p.length, u_steps: steps, u_decay: p.decay });
      g.release(e);
      return out;
    },
    support: GPU,
    ui: { section: 'Effects', order: 60, controls: ['source', 'intensity', 'length', 'decay', 'threshold', 'depth', { param: 'temperature', gradient: 'temperature' }, 'quality'] },
    agent: {
      summary: 'Volumetric light (god rays) streaming from a bright source through haze; with a depth map, near objects such as trees, people and window frames block the rays.',
      tips: ['Put source on or just outside the brightest gap (a window, the sun behind leaves); it may lie outside the box (−1 to 2).', 'Subtle is believable: intensity 0.3 to 0.8, threshold 0.55 to 0.75. Add depth-fog for the haze the rays travel through.', 'length is in document pixels and is the tile overlap: very long rays cost time at export.'],
      example: { type: 'light-rays', p: { source: { x: 0.8, y: 0.05 }, intensity: 0.6, length: 300, threshold: 0.65 } }
    }
  });

  /* ---------- Depth fog / atmospheric perspective ---------- */
  var FOG = 'uniform sampler2D u_dr; uniform vec3 u_fog; uniform float u_amt, u_start, u_end, u_ground, u_desat;\n' + CLAMP_IMG +
    'vec4 fx(){ vec4 s = src(v_uv); float a = s.a; if (a <= 0.0) return s; vec3 c = s.rgb / a;\n' +
    '  float far = 1.0 - texture(u_dr, clampImg(v_uv)).r; float f = smoothstep(u_start, max(u_end, u_start + 1e-3), far);\n' +
    '  f *= mix(1.0, clamp(0.3 + boxUV().y * 1.1, 0.0, 1.5), u_ground); f = clamp(f * u_amt, 0.0, 1.0);\n' +
    '  float l = luma(c); c = mix(c, vec3(l), f * u_desat); return vec4(mix(c, u_fog, f) * a, a); }';
  FX.register({
    id: 'depth-fog', name: 'Depth fog', group: 'effects', version: 1, space: 'linear', needs: ['depth'],
    params: {
      amount: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Amount' },
      start: { type: 'number', min: 0, max: 1, default: 0.3, step: 0.01, label: 'Start', help: '0 is the nearest part of the photo, 1 the farthest.' },
      end: { type: 'number', min: 0, max: 1, default: 1, step: 0.01, label: 'End' },
      color: { type: 'color', default: '#c9d3de', label: 'Colour' },
      ground: { type: 'number', min: 0, max: 1, default: 0, step: 0.01, label: 'Ground fog' },
      desaturate: { type: 'number', min: 0, max: 1, default: 0.3, step: 0.01, label: 'Fade colour' }
    },
    radius: function (p, s) { return p.amount > 0 ? depthReach(s) : 0; },
    passes: function (g, p) {
      if (!(p.amount > 0)) return;
      var dr = depthRefined(g, { subject: true }, sizes(g), g.draft), c = g.rgb(p.color);
      var out = g.pass(FOG, { u_dr: dr, u_fog: [c[0], c[1], c[2]], u_amt: p.amount, u_start: p.start, u_end: p.end, u_ground: p.ground, u_desat: p.desaturate });
      g.release(dr);
      return out;
    },
    support: GPU,
    ui: { section: 'Effects', order: 70, controls: ['amount', 'start', 'end', 'color', 'ground', 'desaturate'] },
    agent: {
      summary: 'Fog and atmospheric perspective by depth: far parts fade towards a fog colour and lose saturation, near parts stay clear.',
      tips: ['Aerial perspective in a landscape: amount 0.25 to 0.45, start 0.4, colour a pale blue-grey from the sky.', 'Morning mist: ground 0.6, a warm white colour, amount 0.5.', 'Dusk: a dusty violet colour with low amount.'],
      example: { type: 'depth-fog', p: { amount: 0.35, start: 0.4, color: '#c4cfdc' } }
    }
  });

  /* ---------- Catchlights ---------- */
  FX.register({
    id: 'catchlight', name: 'Catchlights', group: 'light', version: 1, space: 'linear',
    params: {
      left: { type: 'point', default: { x: 0.42, y: 0.4 }, label: 'Eye 1' },
      right: { type: 'point', default: { x: 0.58, y: 0.4 }, label: 'Eye 2' },
      size: { type: 'number', min: 0.5, max: 40, default: 3, step: 0.1, unit: 'px', label: 'Size' },
      intensity: { type: 'number', min: 0, max: 2, default: 0, step: 0.01, label: 'Intensity' },
      shape: { type: 'choice', options: [{ value: 'round', label: 'Round' }, { value: 'softbox', label: 'Softbox' }, { value: 'ring', label: 'Ring' }, { value: 'window', label: 'Window' }], default: 'round', label: 'Shape' },
      clock: { type: 'angle', default: 135, label: 'Position', help: 'Where in the eye: the direction from the iris centre, as the key light (135 = upper left).' },
      offset: { type: 'number', min: 0, max: 3, default: 1.2, step: 0.01, label: 'Offset', help: 'Distance from the iris centre, in sizes.' },
      temperature: { type: 'number', min: 1900, max: 12000, default: 6500, step: 50, unit: 'K', label: 'Temperature' }
    },
    passes: function (g, p) {
      if (!(p.intensity > 0)) return;
      var a = p.clock * Math.PI / 180, off = [Math.cos(a) * p.offset * p.size, -Math.sin(a) * p.offset * p.size];
      var shape = { round: 0, softbox: 1, ring: 2, window: 3 }[p.shape] || 0, col = kelvin(p.temperature);
      g.color([
        'uniform vec4 $e; uniform vec4 $p; uniform vec3 $c;',
        'float $sh(vec2 q){ float aa = $p.z; if ($p.w < 0.5) return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, length(q));',
        '  vec2 b = abs(q) / vec2(1.0, 0.75); float r = max(b.x, b.y);',
        '  if ($p.w < 1.5) return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);',
        '  if ($p.w < 2.5) return 1.0 - smoothstep(0.22 - aa, 0.22 + aa, abs(length(q) - 0.78));',
        '  float bars = min(smoothstep(0.06 - aa, 0.06 + aa, abs(q.x)), smoothstep(0.06 - aa, 0.06 + aa, abs(q.y))); return (1.0 - smoothstep(1.0 - aa, 1.0 + aa, r)) * bars; }',
        'vec3 $fx(vec3 c){ vec2 P = docPos(); float k = max($sh((P - $e.xy) / $p.x), $sh((P - $e.zw) / $p.x)); return c + $c * k; }'
      ].join('\n'), {
        e: [p.left.x * g.box.w + off[0], p.left.y * g.box.h + off[1], p.right.x * g.box.w + off[0], p.right.y * g.box.h + off[1]],
        p: [p.size, 0, clamp(1.2 / Math.max(p.size * g.scale, 0.5), 0.05, 0.6), shape],
        c: [col[0] * p.intensity, col[1] * p.intensity, col[2] * p.intensity]
      });
    },
    support: { needs: ['webgl2'], wants: [], memoryMB: 20 },
    ui: { section: 'Light', order: 80, controls: ['left', 'right', 'size', 'intensity', 'shape', 'clock', 'offset', { param: 'temperature', gradient: 'temperature' }] },
    agent: {
      summary: 'Small highlights in the eyes, the reflection of a light source; off until intensity is raised. LE.fx.relight.portrait places them from the face landmarks.',
      tips: ['Tasteful: size about 4 % of the iris width (often 2 to 5 document pixels), intensity 0.5 to 1, and the same clock position as the key light.', 'Use one shape for both eyes; mismatched catchlights look fake.', 'Skip it when the eyes already have catchlights or are closed.'],
      example: { type: 'catchlight', p: { left: { x: 0.43, y: 0.38 }, right: { x: 0.57, y: 0.38 }, size: 3, intensity: 0.8, clock: 135 } }
    }
  });

  /* ================================================================ Helpers (CPU, plain data) ================================================================ */
  var R = FX.relight = FX.relight || {};
  R.kelvin = kelvin;

  /* ---------- Face geometry from layer.maps.face ---------- */
  function unpackFace(o) {
    if (o && o.landmarks) return o;
    if (LE.maps && LE.maps.unpack && LE.maps.unpack.face) return LE.maps.unpack.face(o);
    var s = atob(o.points), dv = new DataView(new Uint8Array(s.split('').map(function (ch) { return ch.charCodeAt(0); })).buffer), L = [];
    for (var k = 0; k < o.count; k++) L.push([dv.getUint16(k * 6, true) / 65535 * 2 - 0.5, dv.getUint16(k * 6 + 2, true) / 65535 * 2 - 0.5, dv.getInt16(k * 6 + 4, true) / 65534]);
    return { landmarks: L, rotation: o.rotation || 0, image: o.image };
  }
  function facesOf(layer) {
    var f = layer && layer.maps && layer.maps.face;
    if (!f) return [];
    var list = Array.isArray(f) ? f : Array.isArray(f.faces) ? f.faces : [f];
    return list.map(function (x) { try { return unpackFace(x); } catch (e) { return null; } }).filter(Boolean);
  }
  /* Image fractions -> layer-box fractions, through the layer's crop (layer.crop = { x, y, w, h } in fractions of the photo). */
  function toBox(layer, x, y) {
    var c = layer && layer.crop && layer.crop.w ? layer.crop : { x: 0, y: 0, w: 1, h: 1 };
    return { x: (x - c.x) / c.w, y: (y - c.y) / c.h };
  }
  /* Centre, width, roll and yaw of a face, in layer-box fractions and degrees. Yaw from the nose tip (1) against the cheek
     line (234, 454): positive when the face turns towards image right. */
  function faceInfo(layer, face) {
    var L = face.landmarks, cx = 0, cy = 0, n = Math.min(468, L.length), i;
    for (i = 0; i < n; i++) { cx += L[i][0]; cy += L[i][1]; }
    cx /= n; cy /= n;
    var lc = L[234], rc = L[454], nose = L[1], le = L[468] || L[33], re = L[473] || L[263];
    var c = toBox(layer, cx, cy), a = toBox(layer, lc[0], lc[1]), b = toBox(layer, rc[0], rc[1]);
    var bw = layer && layer.w || 1, bh = layer && layer.h || 1;
    var widthPx = Math.hypot((b.x - a.x) * bw, (b.y - a.y) * bh), mid = (lc[0] + rc[0]) / 2;
    var half = Math.abs(rc[0] - lc[0]) / 2 || 1e-3, yaw = Math.asin(clamp((nose[0] - mid) / half, -1, 1)) * 180 / Math.PI;
    var eyes = [toBox(layer, le[0], le[1]), toBox(layer, re[0], re[1])].sort(function (p, q) { return p.x - q.x; });
    var iris = L[469] && L[471] ? Math.hypot((L[469][0] - L[471][0]) * (face.image ? face.image.width : 1), (L[469][1] - L[471][1]) * (face.image ? face.image.height : 1)) : 0;
    var crop = layer && layer.crop && layer.crop.w ? layer.crop : { w: 1 }, imgW = face.image ? face.image.width : 0;
    var irisPx = imgW ? iris / imgW / crop.w * bw : widthPx * 0.08;
    return { center: c, width: widthPx, widthFrac: widthPx / bw, roll: (face.rotation || 0) * 180 / Math.PI, yaw: yaw, eyes: eyes, irisPx: irisPx };
  }
  R.faceInfo = function (layer) { return facesOf(layer).map(function (f) { return faceInfo(layer, f); }); };

  /* ---------- Portrait presets: plain data, relative to the face ----------
     Each light: az (degrees round the subject from the camera axis; negative = image left), el (degrees above the eye line),
     dist (in face widths), and relight parameters. `rim` entries are rim-light parameters with az giving the side. */
  R.presets = [
    { id: 'studio-key', name: 'Studio key', about: 'A soft key light high on one side; the classic headshot.',
      lights: [{ az: -40, el: 35, dist: 2.5, p: { intensity: 1.1, softness: 0.55, temperature: 5600, specular: 0.25, shadows: 0.6 } }], base: { existing: 0.75, soften: 0.3, ao: 0.25 } },
    { id: 'rembrandt', name: 'Rembrandt', about: 'Key 45° to the side and above: a small triangle of light on the shadow cheek.',
      lights: [{ az: -50, el: 42, dist: 2.2, p: { intensity: 1.5, softness: 0.3, temperature: 5000, shadows: 0.85 } }], base: { existing: 0.45, soften: 0.45, ao: 0.35 } },
    { id: 'butterfly', name: 'Butterfly', about: 'Key straight in front and high: a small shadow under the nose; flattering, glamorous.',
      lights: [{ az: 0, el: 55, dist: 2.2, p: { intensity: 1.2, softness: 0.5, temperature: 5600, specular: 0.3, shadows: 0.7 } }], base: { existing: 0.65, soften: 0.35, ao: 0.2 } },
    { id: 'split', name: 'Split', about: 'Key at 90° to the side: one half lit, one half in shadow; dramatic.',
      lights: [{ az: -88, el: 8, dist: 2, p: { intensity: 1.6, softness: 0.2, temperature: 5200, shadows: 0.9 } }], base: { existing: 0.3, soften: 0.55, ao: 0.3 } },
    { id: 'rim', name: 'Rim and back light', about: 'Two back lights outline the head and shoulders; the front stays as it is.',
      rims: [{ az: -140, p: { intensity: 1.3, width: 0.45, temperature: 7000 } }, { az: 140, p: { intensity: 1.0, width: 0.4, temperature: 7000 } }], base: { existing: 0.85, soften: 0, ao: 0 } },
    { id: 'golden-hour', name: 'Golden hour', about: 'A low, warm sun from the side, with a cool fill from the sky.',
      lights: [{ type: 'directional', az: -70, el: 12, dist: 3, p: { intensity: 1.3, softness: 0.35, temperature: 3100, shadows: 0.75, shadowLength: 180 } }],
      rims: [{ az: -120, p: { intensity: 0.7, width: 0.5, temperature: 3000 } }], base: { existing: 0.6, soften: 0.3, ao: 0.2 }, grade: { temperature: 8 } },
    { id: 'softbox', name: 'Softbox', about: 'A large, very soft key close to the subject: gentle wrap, faint shadows.',
      lights: [{ az: -32, el: 28, dist: 1.6, p: { intensity: 1.0, softness: 0.9, temperature: 5600, specular: 0.15, shadows: 0.35 } }], base: { existing: 0.8, soften: 0.35, ao: 0.2 } },
    { id: 'gel-pair', name: 'Coloured gels', about: 'Two coloured lights from opposite sides, magenta and teal; club and music-video look.',
      lights: [{ az: -75, el: 15, dist: 2, p: { intensity: 1.4, softness: 0.4, temperature: 6500, color: '#ff3d9a', shadows: 0.6 } },
        { az: 75, el: 15, dist: 2, p: { intensity: 1.2, softness: 0.4, temperature: 6500, color: '#28d2ff', shadows: 0.6 } }], base: { existing: 0.35, soften: 0.5, ao: 0.3 } }
  ];
  function presetById(id) { for (var i = 0; i < R.presets.length; i++) if (R.presets[i].id === id) return R.presets[i]; return null; }
  function layerById(doc, id) {
    var out = null;
    (function walk(list) { (list || []).forEach(function (l) { if (!l || out) return; if (l.id === id) out = l; if (l.children) walk(l.children); if (l.layers) walk(l.layers); }); })(doc.layers || (doc.pages && doc.pages[0] && doc.pages[0].layers) || []);
    return out;
  }
  var LIGHT_TYPES = ['relight', 'rim-light', 'catchlight'];
  /* Light placement: the light's offset from the face, turned with the face's roll and yaw, in layer-box fractions. */
  function place(fi, layer, az, el, dist) {
    var bw = layer.w || 1, bh = layer.h || 1, A = (az + fi.yaw) * Math.PI / 180, E = el * Math.PI / 180, d = dist * fi.width;
    var x = Math.sin(A) * Math.cos(E) * d, y = -Math.sin(E) * d, z = Math.cos(A) * Math.cos(E) * d;
    var r = fi.roll * Math.PI / 180, xr = x * Math.cos(r) - y * Math.sin(r), yr = x * Math.sin(r) + y * Math.cos(r);
    return { position: { x: round3(fi.center.x + xr / bw), y: round3(fi.center.y + yr / bh) }, height: round3(z / bw) };
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  /* -> { ok, ops: [fx ops], warnings, face } . opts: { face: index (largest first), catchlights: false, replace: true, strength: 1 } */
  R.portrait = function (doc, layerId, presetId, opts) {
    opts = opts || {};
    var pr = presetById(presetId), layer = layerById(doc || {}, layerId), warnings = [], ops = [];
    if (!pr) return { ok: false, ops: [], errors: [{ code: 'invalid', message: 'Unknown preset ' + presetId + '; see LE.fx.relight.presets.' }] };
    if (!layer) return { ok: false, ops: [], errors: [{ code: 'invalid', message: 'No layer ' + layerId + '.' }] };
    var faces = facesOf(layer), fi;
    if (faces.length) fi = faceInfo(layer, faces[Math.min(opts.face || 0, faces.length - 1)]);
    else {
      warnings.push({ code: 'no-face', message: 'No face map on this layer: lights were placed for a subject in the middle. Run map.generate with kind "faces" first.' });
      fi = { center: { x: 0.5, y: 0.38 }, width: (layer.w || 1) * 0.3, widthFrac: 0.3, roll: 0, yaw: 0, eyes: [], irisPx: 0 };
    }
    if (!(layer.maps && layer.maps.depth)) warnings.push({ code: 'no-depth', message: 'No depth map on this layer: light falls on a flat plane and casts no shadows. Run map.generate with kind "depth" first.' });
    var k = num(opts.strength, 1);
    if (opts.replace !== false) (layer.fx || []).forEach(function (e) { if (LIGHT_TYPES.indexOf(e.type) >= 0) ops.push({ op: 'fx.remove', layer: layerId, id: e.id }); });
    var key = null;
    (pr.lights || []).forEach(function (L, i) {
      var pl = place(fi, layer, L.az, L.el, L.dist);
      var p = Object.assign({ type: L.type || 'point', position: pl.position, height: Math.max(0.03, pl.height), aim: { x: round3(fi.center.x), y: round3(fi.center.y) } }, L.p);
      p.intensity = round3(p.intensity * k);
      if (i === 0) Object.assign(p, pr.base || {}); else Object.assign(p, { existing: 1, soften: 0, ao: 0 });
      if (i === 0) key = L;
      ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'relight', p: p } });
    });
    (pr.rims || []).forEach(function (L, i) {
      /* A back light at az (behind left < 0, behind right > 0) reaches the photo from that side and a little above: 160° or 20°, turned with the head's roll. */
      var p = Object.assign({}, L.p, { angle: Math.round((L.az < 0 ? 160 : 20) - fi.roll) });
      p.intensity = round3(p.intensity * k);
      ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'rim-light', p: p } });
      if (!pr.lights && i === 0 && pr.base) ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'relight', p: Object.assign({ intensity: 0 }, pr.base) } });
    });
    if (pr.grade) ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'white-balance', p: pr.grade } });
    if (opts.catchlights && fi.eyes.length === 2) {
      var clock = key ? Math.round(Math.atan2(Math.sin(key.el * Math.PI / 180), Math.sin((key.az + fi.yaw) * Math.PI / 180)) * 180 / Math.PI) : 135;
      if (clock < 0) clock += 360;
      ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'catchlight', p: { left: { x: round3(fi.eyes[0].x), y: round3(fi.eyes[0].y) }, right: { x: round3(fi.eyes[1].x), y: round3(fi.eyes[1].y) },
        size: round3(clamp(fi.irisPx * 0.18, 0.8, 12)), intensity: 0.7, clock: clock, offset: 1.4, shape: pr.id === 'softbox' ? 'softbox' : 'round' } } });
    }
    return { ok: true, ops: ops, warnings: warnings, face: fi, preset: pr.id };
  };

  /* ---------- Depth helpers (CPU) on a depth result { depth, width, height } or a packed canvas ---------- */
  function depthData(d) { if (d && d.depth) return d; if (d && LE.maps && LE.maps.unpack) return LE.maps.unpack.depth(d); return null; }
  R.depth = {
    /* near/far remap: values between `far` and `near` (0..1 of the stored depth) stretched to 0..1. */
    remap: function (v, near, far) { return clamp((v - far) / Math.max(near - far, 1e-6), 0, 1); },
    stats: function (d) {
      d = depthData(d); if (!d) return null;
      var s = Array.prototype.slice.call(d.depth).filter(function (_, i) { return i % 7 === 0; }).sort(function (a, b) { return a - b; }), q = function (t) { return s[Math.min(s.length - 1, Math.floor(t * (s.length - 1)))]; };
      return { p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99) };
    },
    /* Ground plane: on a level ground, disparity grows linearly with the image row below the horizon. Fits d = a·y + b to the median
       depth of each row in the lower 45 % of the picture; horizon = the row where d reaches the farthest value seen. */
    ground: function (d) {
      d = depthData(d); if (!d) return null;
      var w = d.width, h = d.height, y0 = Math.floor(h * 0.55), xs = [], ys = [];
      for (var y = y0; y < h; y++) { var row = Array.prototype.slice.call(d.depth, y * w, y * w + w).sort(function (a, b) { return a - b; }); xs.push(y / h); ys.push(row[Math.floor(w / 2)]); }
      var n = xs.length, mx = 0, my = 0, i; for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
      var sxx = 0, sxy = 0, syy = 0; for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) * (ys[i] - my); }
      var a = sxx ? sxy / sxx : 0, b = my - a * mx, r2 = sxx && syy ? sxy * sxy / (sxx * syy) : 0;
      var st = R.depth.stats(d), horizon = a > 1e-4 ? clamp((st.p1 - b) / a, -0.5, 1) : null;
      return { slope: a, intercept: b, horizon: horizon, fit: r2, plausible: a > 0.2 && r2 > 0.6 };
    }
  };

  /* ---------- Light estimate (for agents): direction, softness, colour temperature ----------
     A first-order (Lambertian, no clamping) fit L = a + b·n by least squares over the subject, where n comes from the depth map
     when given, else from the cut-out mask "inflated" into a dome (shape from silhouette), else from a centred dome (weak).
     b's direction is the light direction (z toward the viewer), |b| / a the directional share; softness also reads the
     steepness of the shading edge. Colour: the lit-minus-shadow difference of the subject is the key light's colour (times the
     average albedo); McCamy's formula turns it into a temperature. Honest: a guess from one view, best on a single subject with one
     dominant light; mixed or flat light gives low confidence. */
  function canvasOf(src, maxSide) {
    var w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, k = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, c.width, c.height);
    return { c: c, d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  }
  function boxBlur(a, w, h, r) {
    var t = new Float32Array(w * h), o = new Float32Array(w * h), x, y, k;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var s = 0, n = 0; for (k = -r; k <= r; k++) { var xx = clamp(x + k, 0, w - 1); s += a[y * w + xx]; n++; } t[y * w + x] = s / n; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var s2 = 0, n2 = 0; for (k = -r; k <= r; k++) { var yy = clamp(y + k, 0, h - 1); s2 += t[yy * w + x]; n2++; } o[y * w + x] = s2 / n2; }
    return o;
  }
  function solve4(A, b) {
    var n = 4, M2 = A.map(function (r, i) { return r.concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i; for (j = i + 1; j < n; j++) if (Math.abs(M2[j][i]) > Math.abs(M2[piv][i])) piv = j;
      var tmp = M2[i]; M2[i] = M2[piv]; M2[piv] = tmp;
      if (Math.abs(M2[i][i]) < 1e-12) return null;
      for (j = i + 1; j < n; j++) { var f = M2[j][i] / M2[i][i]; for (k = i; k <= n; k++) M2[j][k] -= f * M2[i][k]; }
    }
    var x = [0, 0, 0, 0]; for (i = n - 1; i >= 0; i--) { var s = M2[i][n]; for (j = i + 1; j < n; j++) s -= M2[i][j] * x[j]; x[i] = s / M2[i][i]; }
    return x;
  }
  function cct(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b, s = X + Y + Z;
    if (s <= 1e-6) return 6500;
    var x = X / s, y = Y / s, n = (x - 0.3320) / (0.1858 - y);
    return Math.round(clamp(449 * n * n * n + 3525 * n * n + 6823.3 * n + 5520.33, 1800, 15000));
  }
  function words(az, el, soft, temp, back) {
    var side = '';
    var dx = Math.cos(az * Math.PI / 180), dy = Math.sin(az * Math.PI / 180);
    var v = dy > 0.38 ? 'upper' : dy < -0.38 ? 'lower' : '', hz = dx > 0.38 ? 'right' : dx < -0.38 ? 'left' : '';
    side = v && hz ? v + ' ' + hz : v ? (v === 'upper' ? 'above' : 'below') : hz || 'the front';
    if (el > 70) side = 'the front';
    return 'light comes from ' + (back ? 'behind, ' : '') + side + ', ' + (temp < 4300 ? 'warm' : temp > 6800 ? 'cool' : 'neutral') + ', ' + (soft > 0.66 ? 'soft' : soft < 0.33 ? 'hard' : 'medium');
  }
  /* estimate(image | canvas, { depth: depth result or packed canvas, mask: canvas (alpha or luminance = subject), maxSide: 160 })
     -> { direction: { x, y, z } (x right, y up, z to the viewer), azimuth (degrees, 0 = from the right, 90 = from above), elevation,
          softness 0..1, contrast, temperature (K), colour: '#rrggbb', confidence 0..1, source: 'depth'|'mask'|'none', words, suggest: relight p } */
  R.estimate = function (image, o) {
    o = o || {};
    var im = canvasOf(image, o.maxSide || 160), w = im.w, h = im.h, n = w * h, i, x, y;
    var lum = new Float32Array(n), lin = new Float32Array(n * 3), wgt = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var r = FX.math.srgbToLinear(im.d[i * 4] / 255), g = FX.math.srgbToLinear(im.d[i * 4 + 1] / 255), b = FX.math.srgbToLinear(im.d[i * 4 + 2] / 255);
      lin[i * 3] = r; lin[i * 3 + 1] = g; lin[i * 3 + 2] = b; lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      var mx = Math.max(im.d[i * 4], im.d[i * 4 + 1], im.d[i * 4 + 2]);
      wgt[i] = im.d[i * 4 + 3] / 255 * (mx > 250 || mx < 4 ? 0.05 : 1);
    }
    var mask = null, source = 'none';
    if (o.mask) { var mk = canvasOf(o.mask, 1e9 ), mc = document.createElement('canvas'); mc.width = w; mc.height = h; mc.getContext('2d').drawImage(mk.c, 0, 0, w, h);
      var md = mc.getContext('2d').getImageData(0, 0, w, h).data; mask = new Float32Array(n);
      for (i = 0; i < n; i++) mask[i] = md[i * 4 + 3] / 255 * Math.max(md[i * 4], md[i * 4 + 1], md[i * 4 + 2]) / 255; }
    /* Height field: depth, or the mask (or a centred ellipse) blurred into a dome. */
    var hgt = new Float32Array(n), dd = depthData(o.depth), k2 = 1;
    if (dd) {
      source = 'depth';
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var u = Math.min(dd.width - 1, Math.floor((x + 0.5) / w * dd.width)), v = Math.min(dd.height - 1, Math.floor((y + 0.5) / h * dd.height)); hgt[y * w + x] = dd.depth[v * dd.width + u]; }
      hgt = boxBlur(hgt, w, h, 2); k2 = w * 0.6;
    } else {
      source = mask ? 'mask' : 'none';
      var base = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var j = y * w + x; base[j] = mask ? mask[j] : (Math.pow((x / w - 0.5) / 0.35, 2) + Math.pow((y / h - 0.5) / 0.45, 2) < 1 ? 1 : 0); }
      var rr = Math.max(2, Math.round(Math.min(w, h) * 0.08));
      hgt = boxBlur(boxBlur(base, w, h, rr), w, h, rr);
      for (i = 0; i < n; i++) hgt[i] = Math.sqrt(Math.max(hgt[i], 0));
      k2 = Math.min(w, h) * 0.35;
    }
    var AtA = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], Atb = [0, 0, 0, 0], sw = 0;
    var nrm = new Float32Array(n * 3);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var q = y * w + x, wq = wgt[q] * (mask ? mask[q] : 1);
      var gx = (hgt[q + 1] - hgt[q - 1]) / 2 * k2, gy = (hgt[q + w] - hgt[q - w]) / 2 * k2;
      var nx = -gx, ny = gy, nz = 1, l = Math.sqrt(nx * nx + ny * ny + 1); nx /= l; ny /= l; nz /= l;   /* y up */
      nrm[q * 3] = nx; nrm[q * 3 + 1] = ny; nrm[q * 3 + 2] = nz;
      if (!(wq > 0.05)) continue;
      var row = [1, nx, ny, nz];
      for (var a1 = 0; a1 < 4; a1++) { Atb[a1] += wq * row[a1] * lum[q]; for (var a2 = 0; a2 < 4; a2++) AtA[a1][a2] += wq * row[a1] * row[a2]; }
      sw += wq;
    }
    for (i = 0; i < 4; i++) AtA[i][i] += 1e-4 * sw;
    var sol = sw > 10 ? solve4(AtA, Atb) : null;
    if (!sol) return { ok: false, confidence: 0, words: 'not enough of the picture to judge', source: source };
    var bx = sol[1], by = sol[2], bz = sol[3], bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-6;
    var dir = { x: bx / bl, y: by / bl, z: bz / bl };
    var az = Math.atan2(dir.y, dir.x) * 180 / Math.PI, el = Math.asin(clamp(dir.z, -1, 1)) * 180 / Math.PI;
    var ambient = sol[0] + Math.min(0, sol[3]), contrast = clamp(Math.sqrt(bx * bx + by * by) / Math.max(Math.abs(sol[0]) + Math.sqrt(bx * bx + by * by), 1e-6), 0, 1);
    /* Edge steepness: shading change per pixel along the light direction against its total range on the subject. */
    var proj = [], lo = 1e9, hi = -1e9;
    for (i = 0; i < n; i++) { if (!(wgt[i] * (mask ? mask[i] : 1) > 0.3)) continue; var pv = nrm[i * 3] * dir.x + nrm[i * 3 + 1] * dir.y + nrm[i * 3 + 2] * dir.z; proj.push([pv, lum[i]]); }
    proj.sort(function (p, q2) { return p[0] - q2[0]; });
    var sh = [0, 0, 0], li = [0, 0, 0], ns = 0, nl = 0, cut = Math.floor(proj.length * 0.3);
    var lumSorted = proj.map(function (p) { return p[1]; });
    for (i = 0; i < proj.length; i++) { lo = Math.min(lo, proj[i][1]); hi = Math.max(hi, proj[i][1]); }
    /* lit = top 30 % by facing, shadow = bottom 30 %, colours averaged over the same pixels */
    var idx = []; for (i = 0; i < n; i++) if (wgt[i] * (mask ? mask[i] : 1) > 0.3) idx.push(i);
    idx.sort(function (p, q2) { var a3 = nrm[p * 3] * dir.x + nrm[p * 3 + 1] * dir.y + nrm[p * 3 + 2] * dir.z, b3 = nrm[q2 * 3] * dir.x + nrm[q2 * 3 + 1] * dir.y + nrm[q2 * 3 + 2] * dir.z; return a3 - b3; });
    for (i = 0; i < idx.length; i++) {
      var t3 = idx[i];
      if (i < cut) { sh[0] += lin[t3 * 3]; sh[1] += lin[t3 * 3 + 1]; sh[2] += lin[t3 * 3 + 2]; ns++; }
      else if (i >= idx.length - cut) { li[0] += lin[t3 * 3]; li[1] += lin[t3 * 3 + 1]; li[2] += lin[t3 * 3 + 2]; nl++; }
    }
    var keyRGB = [0, 1, 2].map(function (c) { return Math.max(li[c] / Math.max(nl, 1) - sh[c] / Math.max(ns, 1), 1e-5); });
    var shadowL = 0.2126 * sh[0] / Math.max(ns, 1) + 0.7152 * sh[1] / Math.max(ns, 1) + 0.0722 * sh[2] / Math.max(ns, 1);
    var litL = 0.2126 * li[0] / Math.max(nl, 1) + 0.7152 * li[1] / Math.max(nl, 1) + 0.0722 * li[2] / Math.max(nl, 1);
    var ratio = litL / Math.max(shadowL, 1e-4);   /* lighting ratio, as photographers count it (2:1 soft, 8:1 hard) */
    var softness = clamp(1 - Math.log(Math.max(ratio, 1)) / Math.log(10), 0, 1);
    var temp = cct(keyRGB), mxk = Math.max(keyRGB[0], keyRGB[1], keyRGB[2]);
    var hex = '#' + keyRGB.map(function (v) { var s = Math.round(clamp(FX.math.linearToSrgb(v / mxk), 0, 1) * 255).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
    var conf = clamp(contrast * 1.6, 0, 1) * (source === 'depth' ? 1 : source === 'mask' ? 0.8 : 0.4);
    var back = dir.z < -0.15;
    void lumSorted; void ambient;
    return {
      ok: true, direction: dir, azimuth: Math.round(az), elevation: Math.round(el), softness: Math.round(softness * 100) / 100, ratio: Math.round(ratio * 10) / 10,
      contrast: Math.round(contrast * 100) / 100, temperature: temp, color: hex, confidence: Math.round(conf * 100) / 100, source: source,
      words: words(az, el, softness, temp, back),
      suggest: { type: 'directional', position: { x: round3(0.5 + dir.x * 0.45), y: round3(0.5 - dir.y * 0.45) }, height: round3(clamp(Math.max(dir.z, 0.05) * 0.8, 0.05, 2)), temperature: Math.round(temp / 50) * 50, softness: round3(clamp(softness, 0.1, 0.9)) }
    };
  };

  /* ---------- Re-time: day -> golden hour, dusk, blue hour, night (ops on existing effects) ----------
     opts: { from: 135 (the direction the low sun or moon comes from), practicals: [{ x, y, temperature }] (lamps, windows) } */
  R.retime = function (doc, layerId, when, opts) {
    opts = opts || {};
    var layer = layerById(doc || {}, layerId);
    if (!layer) return { ok: false, ops: [], errors: [{ code: 'invalid', message: 'No layer ' + layerId + '.' }] };
    var A = { golden: { wb: 30, ev: 0.05, sat: 10, key: { t: 3000, i: 1.1, el: 0.12 }, exist: 0.75, soft: 0.25, fog: { c: '#f2c79a', a: 0.18 } },
      dusk: { wb: 12, ev: -0.6, sat: -5, key: { t: 2600, i: 0.7, el: 0.06 }, exist: 0.55, soft: 0.35, fog: { c: '#8f7fa8', a: 0.25 } },
      'blue-hour': { wb: -35, ev: -1.0, sat: -10, key: null, exist: 0.6, soft: 0.4, fog: { c: '#5c6f9a', a: 0.22 } },
      night: { wb: -45, ev: -2.0, sat: -35, key: { t: 4200, i: 0.25, el: 0.4 }, exist: 0.45, soft: 0.5, fog: { c: '#1f2a44', a: 0.2 } } }[when];
    if (!A) return { ok: false, ops: [], errors: [{ code: 'invalid', message: 'when is golden, dusk, blue-hour or night.' }] };
    var from = num(opts.from, 135) * Math.PI / 180, ops = [];
    ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'white-balance', p: { temperature: A.wb, tint: when === 'dusk' ? 8 : 0 } } });
    ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'exposure', p: { ev: A.ev } } });
    ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'saturation', p: { saturation: A.sat, vibrance: when === 'golden' ? 10 : 0 } } });
    ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'relight', p: Object.assign({ type: 'directional', position: { x: round3(0.5 + Math.cos(from) * 0.5), y: round3(0.5 - Math.sin(from) * 0.5) }, height: A.key ? A.key.el : 0.3,
      intensity: A.key ? A.key.i : 0, temperature: A.key ? A.key.t : 6500, softness: 0.45, shadows: 0.7, shadowLength: 200, existing: A.exist, soften: A.soft, ao: 0.2 }) } });
    (opts.practicals || []).slice(0, 6).forEach(function (pt) {
      ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'relight', p: { type: 'point', position: { x: round3(num(pt.x, 0.5)), y: round3(num(pt.y, 0.5)) }, aim: { x: round3(num(pt.x, 0.5)), y: round3(Math.min(1, num(pt.y, 0.5) + 0.15)) }, height: 0.12,
        intensity: when === 'night' ? 2.5 : 1.2, temperature: num(pt.temperature, 2700), softness: 0.5, falloff: 1, shadows: 0.6, shadowLength: 80 } } });
    });
    ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'depth-fog', p: { amount: A.fog.a, start: 0.45, color: A.fog.c, desaturate: 0.25 } } });
    return { ok: true, ops: ops, warnings: layer.maps && layer.maps.depth ? [] : [{ code: 'no-depth', message: 'No depth map: the fog and the new light will be flat. Run map.generate with kind "depth" first.' }] };
  };

  /* ---------- Depth masks as helpers: a grade for near and far, and a background dim / blur ---------- */
  function depthMask(nearPart, split, soft) {
    return { on: true, parts: [nearPart ? { kind: 'depth', near: 0, far: clamp(split, 0, 1), soft: soft } : { kind: 'depth', near: clamp(split, 0, 1), far: 1, soft: soft }] };
  }
  /* entries: { near: [fx entries], far: [fx entries] }; split 0..1 (0 nearest), soft the width of the transition. */
  R.depthGrade = function (doc, layerId, o) {
    o = o || {};
    var split = num(o.split, 0.45), soft = num(o.soft, 0.12), ops = [];
    (o.near || []).forEach(function (e) { ops.push({ op: 'fx.add', layer: layerId, entry: Object.assign({}, e, { mask: depthMask(true, split, soft) }) }); });
    (o.far || []).forEach(function (e) { ops.push({ op: 'fx.add', layer: layerId, entry: Object.assign({}, e, { mask: depthMask(false, split, soft) }) }); });
    return { ok: true, ops: ops };
  };
  /* Dims and/or blurs what is farther than `split`. A masked blur mixes the sharp subject into the blurred background near its
     edge; for a lens-like depth of field use the depth-blur effect of the optics pack. */
  R.backgroundDim = function (doc, layerId, o) {
    o = o || {};
    var split = num(o.split, 0.45), soft = num(o.soft, 0.12), ops = [];
    if (num(o.dim, -0.7) !== 0) ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'exposure', p: { ev: num(o.dim, -0.7) }, mask: depthMask(false, split, soft) } });
    if (num(o.blur, 0) > 0) ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'gaussian-blur', p: { radius: num(o.blur, 0) }, mask: depthMask(false, split, soft) } });
    if (num(o.desaturate, 0) > 0) ops.push({ op: 'fx.add', layer: layerId, entry: { type: 'saturation', p: { saturation: -Math.round(num(o.desaturate, 0) * 100) }, mask: depthMask(false, split, soft) } });
    return { ok: true, ops: ops };
  };
})(window);
