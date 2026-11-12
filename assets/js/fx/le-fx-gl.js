/* LocalEditor effect renderer, WebGL2 back end: context, pools, the pass builder, the merged colour pass, masks, tiling and
   the two entry points the scene uses (a cached layer bitmap, and draw-time processing). Contract: docs/FX-AUTHORING.md.
   Main thread by design: the compositor needs results synchronously inside a frame (see tools/fx-bench for the measurement). */
(function (global) {
  'use strict';

  var LE = global.LE, FX = LE && LE.fx;
  if (!FX || FX._gl) return;
  var M = FX.math, Q = FX.quad, C = FX._const;

  var S = FX._gl = {
    gl: null, canvas: null, caps: null, lost: false, failed: false, epoch: 0, tick: 0,
    programs: {}, vs: null, free: {}, bytes: 0, uploads: [], luts: {}, lutCount: 0, cache: {}, cacheBytes: 0, white: null,
    interactive: false, listeners: [], prof: null, runTick: 0, touches: 0, stats: { passes: 0, compiled: 0, tiles: 0, renders: 0, cacheHits: 0, lost: 0 },
    cfg: { eightBit: false, tile: 0, budgetMB: 0, workMP: 0 }, clips: [], warned: {}
  };

  function makeCanvas(w, h) {
    var c;
    if (global.document) { c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    return new OffscreenCanvas(w, h);
  }
  function note(code, message) { if (!S.warned[code]) { S.warned[code] = message; if (global.console) console.warn('LE.fx: ' + message); } }
  function budget() {
    if (S.cfg.budgetMB) return S.cfg.budgetMB * 1048576;
    var level = LE.perf && LE.perf.level ? LE.perf.level() : 'high';
    return (level === 'high' ? 384 : level === 'mid' ? 192 : 96) * 1048576;
  }

  /* ---------- Context ---------- */
  function dropAll() {
    S.programs = {}; S.vs = null; S.free = {}; S.bytes = 0; S.uploads = []; S.luts = {}; S.lutCount = 0; S.cache = {}; S.cacheBytes = 0; S.white = null; S.gl = null;
  }
  function emit(what) { S.listeners.slice().forEach(function (fn) { try { fn(what); } catch (e) { /* host listener */ } }); }
  function init() {
    if (S.failed) return null;
    if (S.gl && !S.lost) return S.gl;
    if (S.lost) return null;
    if (!S.canvas) {
      S.canvas = makeCanvas(64, 64);
      S.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); S.lost = true; S.stats.lost++; dropAll(); emit('lost'); }, false);
      S.canvas.addEventListener('webglcontextrestored', function () { S.lost = false; S.epoch++; emit('restored'); }, false);
    }
    var gl = null;
    try { gl = S.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
    if (!gl) { S.failed = true; note('no-webgl2', 'WebGL2 is not available; expert effects use the slow path where one exists.'); return null; }
    if (gl.isContextLost()) { S.lost = true; return null; }
    S.gl = gl;
    var caps = S.caps = { float: false, maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), aniso: null, anisoMax: 1, p3: 'drawingBufferColorSpace' in gl, renderer: '' };
    var okF = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    if (okF && !S.cfg.eightBit) {
      /* Some drivers advertise the extension and still refuse the attachment: ask the framebuffer. */
      var t = gl.createTexture(), f = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 4, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      caps.float = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
    }
    caps.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (caps.aniso) caps.anisoMax = Math.min(8, gl.getParameter(caps.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1);
    try { var dbg = gl.getExtension('WEBGL_debug_renderer_info'); caps.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e2) { /* optional */ }
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.DITHER);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!caps.float) note('eight-bit', 'Half-float render targets are not available; rendering in 8 bits with dithering.');
    return gl;
  }

  /* ---------- Texture pool with a memory budget ---------- */
  function bpp(fmt) { return fmt === 'f16' ? 8 : 4; }
  function fmtFor(space) { return S.caps.float ? 'f16' : (space === 'linear' ? 's8' : '8'); }
  function evictCache(need) {
    var keys = Object.keys(S.cache).sort(function (a, b) { return S.cache[a].used - S.cache[b].used; });
    for (var i = 0; i < keys.length && (need > 0 || S.cacheBytes > budget() / 2); i++) {
      var e = S.cache[keys[i]];
      if (e.h.held) continue;
      delete S.cache[keys[i]];
      S.cacheBytes -= e.h.t.bytes; need -= e.h.t.bytes;
      e.h.cached = false; e.h.t.cached = false;
      kill(e.h.t);
    }
  }
  function kill(t) {
    var gl = S.gl;
    if (!gl || t.dead) return;
    t.dead = true;
    if (t.fbo) gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
    S.bytes -= t.bytes;
  }
  function trim(need) {
    var cap = budget();
    if (S.bytes + (need || 0) <= cap) return;
    var all = [];
    Object.keys(S.free).forEach(function (k) { S.free[k].forEach(function (t) { all.push(t); }); });
    all.sort(function (a, b) { return a.at - b.at; });
    for (var i = 0; i < all.length && S.bytes + (need || 0) > cap; i++) {
      var list = S.free[all[i].key];
      list.splice(list.indexOf(all[i]), 1);
      kill(all[i]);
    }
    for (var j = 0; j < S.uploads.length && S.bytes + (need || 0) > cap; j++) {
      if (S.uploads[j].at >= S.runTick) continue;   /* in use by the render in progress */
      kill(S.uploads.splice(j--, 1)[0]);
    }
    if (S.bytes + (need || 0) > cap) evictCache(S.bytes + (need || 0) - cap);
  }
  function acquire(w, h, fmt) {
    var gl = S.gl;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var key = w + 'x' + h + fmt, list = S.free[key];
    if (list && list.length) return list.pop();
    var bytes = w * h * bpp(fmt);
    trim(bytes);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'f16' ? gl.RGBA16F : fmt === 's8' ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    S.bytes += bytes;
    return { tex: tex, fbo: null, w: w, h: h, fmt: fmt, bytes: bytes, key: key, at: 0 };
  }
  function release(t) {
    if (!t || t.dead || t.cached || t.upload || t.pooled) return;
    t.pooled = true; t.at = ++S.tick;
    (S.free[t.key] = S.free[t.key] || []).push(t);
  }
  function take(w, h, fmt) { var t = acquire(w, h, fmt); t.pooled = false; return t; }
  function fbo(t) {
    var gl = S.gl;
    if (!t.fbo) {
      t.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    } else gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  }

  /* Canvas or image → texture. Cached per source object; LE.fx.touch(source) after painting into it. */
  var uploadMap = typeof WeakMap === 'function' ? new WeakMap() : null;
  function upload(source, opts) {
    opts = opts || {};
    var gl = S.gl, sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    if (!sw || !sh) return null;
    var rect = opts.rect || null, stamp = (source._fxStamp || 0) + '|' + sw + 'x' + sh + '|' + (opts.mips ? 'm' : '') + (rect ? rect.join(',') : '');
    var hit = uploadMap && !opts.fresh ? uploadMap.get(source) : null;
    if (hit && hit.stamp === stamp && !hit.t.dead && hit.epoch === S.epoch) { hit.t.at = ++S.tick; return hit.t; }
    var src = source, w = sw, h = sh;
    var max = Math.min(S.caps.maxTex, opts.max || S.caps.maxTex);
    if (rect || w > max || h > max) {
      var rx = rect ? rect[0] : 0, ry = rect ? rect[1] : 0, rw = rect ? rect[2] : sw, rh = rect ? rect[3] : sh;
      var k = Math.min(1, max / rw, max / rh);
      w = Math.max(1, Math.round(rw * k)); h = Math.max(1, Math.round(rh * k));
      var sc = S.scratch || (S.scratch = makeCanvas(w, h));
      if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
      var sx = sc.getContext('2d');
      sx.globalCompositeOperation = 'copy';
      sx.imageSmoothingQuality = 'high';
      sx.drawImage(source, rx, ry, rw, rh, 0, 0, w, h);
      src = sc;
    }
    var bytes = Math.round(w * h * 4 * (opts.mips ? 1.34 : 1));
    trim(bytes);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (opts.mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (S.caps.aniso) gl.texParameterf(gl.TEXTURE_2D, S.caps.aniso.TEXTURE_MAX_ANISOTROPY_EXT, S.caps.anisoMax);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    S.bytes += bytes;
    var t = { tex: tex, fbo: null, w: w, h: h, fmt: '8', bytes: bytes, key: 'upload', at: ++S.tick, upload: true };
    if (opts.fresh) return t;
    S.uploads.push(t);
    if (S.uploads.length > 48 && S.uploads[0].at < S.runTick) kill(S.uploads.shift());
    if (uploadMap) uploadMap.set(source, { stamp: stamp, t: t, epoch: S.epoch });
    return t;
  }
  function freeUpload(t) { if (!t || t.dead) return; var i = S.uploads.indexOf(t); if (i >= 0) S.uploads.splice(i, 1); kill(t); }
  /* An asset canvas was painted into: upload it again, forget stages computed from it, and let scenes redraw. */
  FX.touch = function (source) {
    if (source) { try { source._fxStamp = (source._fxStamp || 0) + 1; } catch (e) { /* frozen source */ } }
    S.touches++;
    if (S.gl && !S.lost) evictCache(Infinity);
    emit('touch');
  };

  /* ---------- Shaders ---------- */
  var VERT = '#version 300 es\nuniform vec4 u_uvr; uniform float u_flip; out vec2 v_uv;\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); v_uv = u_uvr.xy + vec2(p.x, mix(p.y, 1.0 - p.y, u_flip)) * u_uvr.zw; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }';
  var HEADER = [
    '#version 300 es', 'precision highp float;', 'precision highp int;', 'precision highp sampler2D;', 'precision mediump sampler3D;',
    'in vec2 v_uv; out vec4 o_color;',
    'uniform sampler2D u_src;',
    'uniform vec2 u_res, u_texel, u_scale, u_box, u_abs, u_dt, u_origin;',
    'uniform vec4 u_dm, u_im, u_img;',
    'uniform float u_dither, u_dsrgb;',
    'vec2 docPos(){ vec2 p = v_uv * u_res; return vec2(dot(u_dm.xy, p), dot(u_dm.zw, p)) + u_dt; }',
    'vec2 boxUV(){ return docPos() / u_box; }',
    'vec2 docToUV(vec2 d){ return vec2(dot(u_im.xy, d), dot(u_im.zw, d)) * u_texel; }',
    'vec4 src(vec2 uv){ return texture(u_src, uv); }',
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'vec3 toLinear(vec3 c){ vec3 a = abs(c); return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), a)); }',
    'vec3 toDisplay(vec3 c){ vec3 a = abs(c); return sign(c) * mix(a * 12.92, 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), a)); }',
    'vec3 unpremul(vec4 c){ return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }',
    'uint hashu(uvec2 v){ v = v * 1664525u + 1013904223u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; return v.x ^ v.y; }',
    'float hash21(vec2 p){ return float(hashu(uvec2(ivec2(floor(p)) + 1048576)) >> 8) / 16777216.0; }',
    'float docNoise(vec2 cell, float seed){ return hash21(cell + vec2(mod(seed, 4096.0) * 17.0, floor(seed / 4096.0) * 59.0 + mod(seed, 4096.0) * 3.0)); }',
    'float lut1(sampler2D t, float x){ float n = float(textureSize(t, 0).x); return texture(t, vec2((clamp(x, 0.0, 1.0) * (n - 1.0) + 0.5) / n, 0.5)).r; }',
    'vec3 lut1rgb(sampler2D t, vec3 c){ float n = float(textureSize(t, 0).x); vec3 u = (clamp(c, 0.0, 1.0) * (n - 1.0) + 0.5) / n; return vec3(texture(t, vec2(u.r, 0.5)).r, texture(t, vec2(u.g, 0.5)).g, texture(t, vec2(u.b, 0.5)).b); }',
    'vec3 lut3(mediump sampler3D t, vec3 c){ float n = float(textureSize(t, 0).x); return texture(t, (clamp(c, 0.0, 1.0) * (n - 1.0) + 0.5) / n).rgb; }',
    'float insideImg(vec2 uv){ return step(u_img.x, uv.x) * step(uv.x, u_img.z) * step(u_img.y, uv.y) * step(uv.y, u_img.w); }',
    'float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }',
    ''
  ].join('\n');
  var MAIN = '\nvoid main(){ vec4 c = fx(); float n = (ign(floor(v_uv * u_res) + u_abs) - 0.5) * u_dither * 0.998; if (u_dsrgb > 0.5) c.rgb = toLinear(toDisplay(c.rgb) + n); else c.rgb += n; c.a += n; o_color = c; }';
  var BLEND_LIB = [
    'float bl_lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }',
    'vec3 bl_clip(vec3 c){ float l = bl_lum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b); if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6); if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6); return c; }',
    'vec3 bl_setlum(vec3 c, float l){ return bl_clip(c + (l - bl_lum(c))); }',
    'vec3 bl_soft(vec3 b, vec3 s){ vec3 d = mix(sqrt(max(b, 0.0)), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25))); return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(vec3(0.5), s)); }',
    'vec3 bl_over(vec3 b, vec3 s){ return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b)); }',
    ''
  ].join('\n');
  var BLEND_EXPR = {
    normal: 's', multiply: 'b * s', screen: 'b + s - b * s', overlay: 'bl_over(b, s)', 'hard-light': 'bl_over(s, b)', 'soft-light': 'bl_soft(clamp(b, 0.0, 1.0), clamp(s, 0.0, 1.0))',
    darken: 'min(b, s)', lighten: 'max(b, s)', difference: 'abs(b - s)', color: 'bl_setlum(s, bl_lum(b))', luminosity: 'bl_setlum(b, bl_lum(s))'
  };

  function program(body, label) {
    var p = S.programs[body];
    if (p) return p;
    var gl = S.gl;
    function sh(type, text) {
      var s = gl.createShader(type);
      gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var log = String(gl.getShaderInfoLog(s) || '').split('\n').slice(0, 3).join(' ');
        gl.deleteShader(s);
        throw new Error('LE.fx shader "' + (label || '?') + '": ' + log);
      }
      return s;
    }
    if (!S.vs) S.vs = sh(gl.VERTEX_SHADER, VERT);
    var fs = sh(gl.FRAGMENT_SHADER, HEADER + body + MAIN);
    var prog = gl.createProgram();
    gl.attachShader(prog, S.vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { var l2 = String(gl.getProgramInfoLog(prog) || ''); gl.deleteProgram(prog); throw new Error('LE.fx shader "' + (label || '?') + '" link: ' + l2); }
    var u = {}, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(prog, i);
      var name = info.name.replace(/\[0\]$/, '');
      u[name] = { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size };
    }
    S.stats.compiled++;
    return (S.programs[body] = { prog: prog, u: u });
  }
  function whiteTex() {
    var gl = S.gl;
    if (!S.white) {
      S.white = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, S.white);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    return S.white;
  }
  /* One full-screen pass. target: a pool texture, or null for the output canvas (opt.vw × opt.vh at its top-left). */
  function draw(body, target, values, opt) {
    var gl = S.gl, p = program(body, opt && opt.label), u = p.u, unit = 0, name;
    gl.useProgram(p.prog);
    if (target) { fbo(target); gl.viewport(0, 0, target.w, target.h); }
    else {
      var cv = S.canvas;
      if (cv.width < opt.vw || cv.height < opt.vh) { cv.width = Math.max(cv.width, opt.vw); cv.height = Math.max(cv.height, opt.vh); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, cv.height - opt.vh, opt.vw, opt.vh);
    }
    for (name in u) {
      var d = u[name], v = values[name];
      if (d.type === gl.SAMPLER_2D || d.type === gl.SAMPLER_3D) {
        var tex = v ? (v.t ? v.t.tex : v.tex) : null;
        if (target && tex === target.tex) throw new Error('LE.fx: a pass cannot read the texture it writes.');
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(d.type === gl.SAMPLER_3D ? gl.TEXTURE_3D : gl.TEXTURE_2D, tex || (d.type === gl.SAMPLER_3D ? null : whiteTex()));
        gl.uniform1i(d.loc, unit++);
        continue;
      }
      if (v === undefined || v === null) continue;
      if (d.type === gl.FLOAT) { if (d.size > 1 || v.length) gl.uniform1fv(d.loc, v); else gl.uniform1f(d.loc, +v); }
      else if (d.type === gl.FLOAT_VEC2) gl.uniform2fv(d.loc, v);
      else if (d.type === gl.FLOAT_VEC3) gl.uniform3fv(d.loc, v);
      else if (d.type === gl.FLOAT_VEC4) gl.uniform4fv(d.loc, v);
      else if (d.type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(d.loc, true, v);
      else if (d.type === gl.INT || d.type === gl.BOOL) gl.uniform1i(d.loc, v === true ? 1 : v === false ? 0 : Math.round(v));
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    S.stats.passes++;
    if (S.prof) {
      /* gl.finish() does not wait in every browser; reading one pixel back does, so a pass's time is the time to really draw it. */
      var f16 = !!target && target.fmt === 'f16';
      gl.readPixels(0, target ? 0 : S.canvas.height - 1, 1, 1, gl.RGBA, f16 ? gl.FLOAT : gl.UNSIGNED_BYTE, f16 ? (S.pxF || (S.pxF = new Float32Array(4))) : (S.px8 || (S.px8 = new Uint8Array(4))));
      var now = performance.now();
      S.prof.push({ label: (opt && opt.label) || 'pass', ms: now - S.profAt, w: target ? target.w : opt.vw, h: target ? target.h : opt.vh });
      S.profAt = performance.now();
    }
  }

  /* ---------- Lookup textures ---------- */
  function lutKey(data, extra) {
    var h = 2166136261, n = data.length, step = 1, i;
    var bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (i = 0; i < bytes.length; i += step) h = Math.imul(h ^ bytes[i], 16777619);
    return extra + ':' + n + ':' + (h >>> 0).toString(36);
  }
  function lut1d(data, channels) {
    var gl = S.gl;
    channels = channels === 3 || channels === 4 ? channels : 1;
    if (!(data instanceof Float32Array)) data = new Float32Array(data);
    var n = Math.floor(data.length / channels);
    if (n < 2 || n > 4096) throw new Error('LE.fx: a 1D LUT has 2 to 4096 entries.');
    var key = lutKey(data, '1d' + channels), hit = S.luts[key];
    if (hit) { hit.at = ++S.tick; return hit; }
    var rgba = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) {
      rgba[i * 4] = data[i * channels];
      rgba[i * 4 + 1] = channels > 1 ? data[i * channels + 1] : data[i];
      rgba[i * 4 + 2] = channels > 1 ? data[i * channels + 2] : data[i];
      rgba[i * 4 + 3] = channels > 3 ? data[i * channels + 3] : 1;
    }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, n, 1, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return keepLut(key, { tex: tex, lut: true, n: n, at: ++S.tick });
  }
  function lut3d(data, size) {
    var gl = S.gl;
    size = Math.round(size);
    if (!(size >= 2 && size <= 65)) throw new Error('LE.fx: a 3D LUT has 2 to 65 points per side.');
    if (!(data instanceof Float32Array)) data = new Float32Array(data);
    if (data.length !== size * size * size * 3) throw new Error('LE.fx: a 3D LUT needs size^3 × 3 numbers.');
    var key = lutKey(data, '3d' + size), hit = S.luts[key];
    if (hit) { hit.at = ++S.tick; return hit; }
    var n = size * size * size, rgba = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 1; }
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return keepLut(key, { tex: tex, lut: true, n: size, at: ++S.tick });
  }
  function keepLut(key, l) {
    S.luts[key] = l;
    if (++S.lutCount > 64) {
      var keys = Object.keys(S.luts).sort(function (a, b) { return S.luts[a].at - S.luts[b].at; });
      keys.slice(0, 32).forEach(function (k) { S.gl.deleteTexture(S.luts[k].tex); delete S.luts[k]; });
      S.lutCount = Object.keys(S.luts).length;
    }
    return l;
  }

  /* ---------- A run: one working rectangle, one stack ---------- */
  /* env: { rw, rh, sx, sy, dm[4], dt[2], box[2], abs[2], img[4], draft, crop[4], hinv[9], subject, scene, assets(fn), layer, stats(fn) } */
  function builtins(env, tw, th) {
    var kx = tw / env.rw, ky = th / env.rh;
    var a = env.dm[0] / kx, b = env.dm[1] / ky, c = env.dm[2] / kx, d = env.dm[3] / ky, det = a * d - b * c || 1e-12;
    return {
      u_im: [d / det, -b / det, -c / det, a / det],
      u_res: [tw, th], u_texel: [1 / tw, 1 / th], u_scale: [env.sx * kx, env.sy * ky], u_box: env.box,
      u_abs: [Math.round(env.abs[0] * kx), Math.round(env.abs[1] * ky)], u_dm: [env.dm[0] / kx, env.dm[1] / ky, env.dm[2] / kx, env.dm[3] / ky], u_dt: env.dt, u_origin: env.dt,
      u_img: env.img, u_uvr: [0, 0, 1, 1], u_flip: 0, u_dither: 0, u_dsrgb: 0
    };
  }
  function Run(env, input) {
    this.env = env;
    this.cur = input;            /* { t, w, h, space, borrowed } */
    this.groups = [];            /* pending colour groups */
    this.alpha = null;           /* pending alpha multiplier handle */
    this.temps = [];
    this.held = [];
  }
  var RP = Run.prototype;
  RP.handle = function (scale, space, fmt) {
    var w = Math.max(1, Math.ceil(this.env.rw * scale - 1e-6)), h = Math.max(1, Math.ceil(this.env.rh * scale - 1e-6));
    var hd = { t: take(w, h, fmt || fmtFor(space)), w: w, h: h, space: space };
    this.temps.push(hd);
    return hd;
  };
  RP.free = function (hd) {
    if (!hd || hd.borrowed || hd.cached || hd.hold || hd === this.cur || hd === this.alpha) return;
    var i = this.temps.indexOf(hd);
    if (i >= 0) this.temps.splice(i, 1);
    release(hd.t);
  };
  RP.pass = function (body, values, target, label) {
    var u = builtins(this.env, target.w, target.h), k;
    if (target.t.fmt !== 'f16') { u.u_dither = 1 / 255; u.u_dsrgb = target.t.fmt === 's8' ? 1 : 0; }
    for (k in values) u[k] = values[k];
    draw(body, target.t, u, { label: label });
    return target;
  };
  /* The merged colour pass: every pending colour operation, space conversions, entry amount/blend/mask and the alpha multiplier. */
  RP.flush = function (outSpace, present) {
    var cur = this.cur, groups = this.groups, alpha = this.alpha;
    outSpace = outSpace || cur.space;
    if (!groups.length && !alpha && !present && outSpace === cur.space) return cur;
    var decl = [], body = [], values = { u_src: cur }, space = cur.space, usesBlend = false, labels = [];
    body.push('vec4 fx(){ vec4 s0 = texture(u_src, v_uv);');
    if (alpha) { decl.push('uniform sampler2D u_alpha;'); body.push('s0 *= texture(u_alpha, v_uv).r;'); values.u_alpha = alpha; }
    body.push('float a0 = s0.a; vec3 c = a0 > 0.0 ? s0.rgb / a0 : vec3(0.0); vec3 b; float t;');
    groups.forEach(function (g, gi) {
      if (g.space !== space) { body.push(g.space === 'linear' ? 'c = toLinear(c);' : 'c = toDisplay(c);'); space = g.space; }
      body.push('b = c;');
      g.ops.forEach(function (op, oi) {
        var pre = 'e' + gi + '_' + oi + '_';
        decl.push(op.glsl.replace(/\$/g, pre));
        body.push('c = ' + pre + 'fx(c);');
        Object.keys(op.uniforms || {}).forEach(function (k) { values[pre + k] = op.uniforms[k]; });
      });
      if (g.blend !== 'normal') { usesBlend = true; body.push('{ vec3 s = c; c = ' + BLEND_EXPR[g.blend] + '; }'); }
      decl.push('uniform float g' + gi + '_amt;');
      values['g' + gi + '_amt'] = g.amount;
      if (g.mask) { decl.push('uniform sampler2D g' + gi + '_mask;'); values['g' + gi + '_mask'] = g.mask; body.push('t = g' + gi + '_amt * texture(g' + gi + '_mask, v_uv).r;'); }
      else body.push('t = g' + gi + '_amt;');
      body.push('c = mix(b, c, t);');
      labels.push(g.label);
    });
    var target = null, opt = { label: 'color(' + (labels.join('+') || 'copy') + ')' };
    if (present) {
      if (space !== 'linear' && present.p3) { body.push('c = toLinear(c);'); space = 'linear'; }
      if (present.p3) body.push('c = mat3(0.8224621, 0.0331941, 0.0170827, 0.1775380, 0.9668058, 0.0723974, 0.0, 0.0, 0.9105199) * c;');
      if (space !== 'display') body.push('c = toDisplay(c);');
      body.push('c = clamp(c, 0.0, 1.0);');
    } else if (outSpace !== space) body.push(outSpace === 'linear' ? 'c = toLinear(c);' : 'c = toDisplay(c);');
    body.push('return vec4(c * a0, a0); }');
    var source = (usesBlend ? BLEND_LIB : '') + decl.join('\n') + '\n' + body.join('\n');
    var u = builtins(this.env, this.env.rw, this.env.rh), k;
    for (k in values) u[k] = values[k];
    if (present) {
      u.u_uvr = present.uvr; u.u_flip = 1; u.u_dither = 1 / 255;
      draw(source, null, u, { label: opt.label + '>out', vw: present.w, vh: present.h });
    } else {
      target = this.handle(cur.w / this.env.rw, outSpace);
      if (target.t.fmt !== 'f16') { u.u_dither = 1 / 255; u.u_dsrgb = target.t.fmt === 's8' ? 1 : 0; }
      draw(source, target.t, u, opt);
    }
    var old = cur, self = this, masks = groups.map(function (g) { return g.mask; });
    this.groups = []; this.alpha = null;
    if (target) this.cur = target;
    this.free(old); if (alpha) this.free(alpha);
    masks.forEach(function (h) { if (h) self.free(h); });
    return this.cur;
  };

  /* Gaussian blur: sigma in target pixels per axis. Downsample-aware, kernel taps paired for bilinear sampling. */
  var BLUR_DOWN = 'vec4 fx(){ return texture(u_src, v_uv); }';
  var BLUR_SEP = 'uniform vec2 u_dir; uniform float u_w0; uniform float u_off[10]; uniform float u_wt[10]; uniform int u_n;\nvec4 fx(){ vec4 acc = texture(u_src, v_uv) * u_w0; for (int i = 0; i < 10; i++) { if (i >= u_n) break; vec2 d = u_dir * u_off[i]; acc += (texture(u_src, v_uv + d) + texture(u_src, v_uv - d)) * u_wt[i]; } return acc; }';
  function kernel(sigma) {
    var r = Math.max(1, Math.min(19, Math.ceil(sigma * 3))), w = [], sum = 0, i;
    for (i = 0; i <= r; i++) { w[i] = Math.exp(-0.5 * i * i / (sigma * sigma)); sum += i ? 2 * w[i] : w[i]; }
    for (i = 0; i <= r; i++) w[i] /= sum;
    var off = new Float32Array(10), wt = new Float32Array(10), n = 0;
    for (i = 1; i <= r; i += 2) {
      var a = w[i], b = i + 1 <= r ? w[i + 1] : 0;
      off[n] = (i * a + (i + 1) * b) / (a + b); wt[n] = a + b; n++;
    }
    return { w0: w[0], off: off, wt: wt, n: n };
  }
  function blurLevels(sigma) { var k = 0; while (sigma / (1 << k) > 3 && k < 8) k++; return k; }
  /* Tile origins sit on this grid so every pyramid level lines up between tiles: 64 px, or 256 px for very wide blurs. */
  function gridFor(reach) { return reach > 400 ? 256 : 64; }
  /* Pixels of neighbourhood a blur of this sigma reads, including its pyramid. Effects use it in radius(). */
  M.blurReach = function (sigmaPx) {
    if (!(sigmaPx > 0.05)) return 0;
    var k = blurLevels(sigmaPx);
    return Math.ceil(3 * sigmaPx + (k ? 3 * (1 << k) : 0)) + 2;
  };
  RP.blur = function (src, sgx, sgy, edge) {
    var self = this, env = this.env;
    if (!(sgx > 0.05) && !(sgy > 0.05)) return src;
    var big = Math.max(sgx, sgy), k = Math.min(blurLevels(big), env.grid === 256 ? 8 : 6);
    if (env.draft && k < 6 && big / (1 << k) > 1.6) k++;
    var cur = src, made = [], space = src.space, i;
    if (edge === 'transparent') {
      var gated = this.handle(src.w / env.rw, space);
      this.pass('vec4 fx(){ return texture(u_src, v_uv) * insideImg(v_uv); }', { u_src: cur }, gated, 'blur:gate');
      cur = gated; made.push(gated);
    }
    for (i = 0; i < k; i++) {
      var half = this.handle(src.w / env.rw / (2 << i), space);
      this.pass(BLUR_DOWN, { u_src: cur }, half, 'blur:down');
      cur = half; made.push(half);
    }
    var f = 1 << k, lost = (Math.pow(4, k) - 1) / 12 + (Math.pow(4, k + 1) - 4) / 18;
    function residual(s) { return Math.sqrt(Math.max(s * s - (k ? lost : 0), 0.04)) / f; }
    [[sgx, [1, 0]], [sgy, [0, 1]]].forEach(function (ax) {
      if (!(ax[0] > 0.05)) return;
      var kr = kernel(residual(ax[0]));
      var out = self.handle(cur.w / env.rw, space);
      self.pass(BLUR_SEP, { u_src: cur, u_dir: [ax[1][0] / cur.w, ax[1][1] / cur.h], u_w0: kr.w0, u_off: kr.off, u_wt: kr.wt, u_n: kr.n }, out, 'blur:sep');
      cur = out; made.push(out);
    });
    for (i = k - 1; i >= 0; i--) {
      var up = this.handle(src.w / env.rw / (1 << i), space);
      this.pass(BLUR_DOWN, { u_src: cur }, up, 'blur:up');
      cur = up; made.push(up);
    }
    made.forEach(function (h) { if (h !== cur) self.free(h); });
    return cur;
  };

  /* ---------- Masks ---------- */
  var MASK_HEAD = 'uniform sampler2D u_prev, u_pre, u_map; uniform float u_first, u_usePre, u_inv, u_den, u_mode; uniform mat3 u_hinv; uniform vec4 u_crop; uniform float m_p[8];\n' +
    'vec2 warpUV(){ vec3 q = u_hinv * vec3(boxUV(), 1.0); return q.z > 1e-6 ? q.xy / q.z : vec2(-1.0); }\n' +
    'vec2 srcUV(){ return u_crop.xy + warpUV() * u_crop.zw; }\n' +
    'float in01(vec2 u){ return step(0.0, u.x) * step(u.x, 1.0) * step(0.0, u.y) * step(u.y, 1.0); }\n' +
    'vec3 rgb2hsl(vec3 c){ float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b), l = (mx + mn) * 0.5, d = mx - mn; if (d < 1e-5) return vec3(0.0, 0.0, l); float s = d / (1.0 - abs(2.0 * l - 1.0) + 1e-5); float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0; return vec3(h * 60.0, clamp(s, 0.0, 1.0), l); }\n' +
    'vec3 dispRGB(){ vec4 s = texture(u_src, v_uv); vec3 c = unpremul(s); return clamp(DISP(c), 0.0, 1.0); }\n';
  var MASK_KIND = {
    linear: 'float part(){ vec2 a = vec2(m_p[0], m_p[1]), d = vec2(m_p[2], m_p[3]) - a; d *= u_box; vec2 p = (boxUV() - a) * u_box; return clamp(dot(p, d) / max(dot(d, d), 1e-6), 0.0, 1.0); }',
    radial: 'float part(){ vec2 p = docPos() - vec2(m_p[0], m_p[1]) * u_box; float r = radians(m_p[4]); p = vec2(p.x * cos(r) + p.y * sin(r), -p.x * sin(r) + p.y * cos(r)); p /= max(vec2(m_p[2], m_p[3]) * u_box, vec2(1e-4)); float d = length(p); float f = max(m_p[5], fwidth(d) * 1.5); return 1.0 - smoothstep(1.0 - f, 1.0, d); }',
    luma: 'float part(){ float l = luma(dispRGB()); float s = max(m_p[2], 1e-4); return smoothstep(m_p[0] - s, m_p[0], l) * (1.0 - smoothstep(m_p[1], m_p[1] + s, l)); }',
    color: 'float part(){ vec3 h = rgb2hsl(dispRGB()); float dh = abs(h.x - m_p[0]); dh = min(dh, 360.0 - dh) / 180.0; float sw = min(h.y, m_p[1]) * 2.0; float d = max(dh * clamp(sw, 0.0, 1.0) * 2.0, max(abs(h.y - m_p[1]), abs(h.z - m_p[2])) * 0.5); return 1.0 - smoothstep(m_p[3], m_p[3] + max(m_p[4], 1e-4), d); }',
    asset: 'float part(){ vec2 u = boxUV(); vec4 m = texture(u_map, u); return (m_p[0] > 0.5 ? luma(m.rgb) : m.a) * in01(u); }',
    subject: 'float part(){ vec2 u = srcUV(); return texture(u_map, u).a * in01(warpUV()); }',
    depth: 'float part(){ float d = texture(u_map, srcUV()).r; float s = max(m_p[2], 1e-4); return smoothstep(m_p[0] - s, m_p[0], d) * (1.0 - smoothstep(m_p[1], m_p[1] + s, d)) * in01(warpUV()); }',
    face: 'float part(){ float g = texture(u_map, srcUV()).r * 255.0; return (1.0 - smoothstep(10.0, 18.0, abs(g - m_p[0]))) * in01(warpUV()); }'
  };
  var MASK_TAIL = '\nvec4 fx(){ float v = u_usePre > 0.5 ? texture(u_pre, v_uv).r : part(); v = (u_inv > 0.5 ? 1.0 - v : v) * u_den; float m = u_first > 0.5 ? (u_mode < 0.5 ? 0.0 : 1.0) : texture(u_prev, v_uv).r; m = u_mode < 0.5 ? m + v - m * v : u_mode < 1.5 ? m * (1.0 - v) : m * v; return vec4(clamp(m, 0.0, 1.0)); }';
  var MASK_RAW = '\nvec4 fx(){ return vec4(part()); }';
  function opaque(canvas) {
    if (canvas._fxOpaqueAt === (canvas._fxStamp || 0) && canvas._fxOpaque != null) return canvas._fxOpaque;
    var w = canvas.naturalWidth || canvas.width, h = canvas.naturalHeight || canvas.height, k = Math.min(1, 256 / Math.max(w, h));
    var c = makeCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))), x = c.getContext('2d');
    x.drawImage(canvas, 0, 0, c.width, c.height);
    var d = x.getImageData(0, 0, c.width, c.height).data, op = true;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 250) { op = false; break; }
    try { canvas._fxOpaque = op; canvas._fxOpaqueAt = canvas._fxStamp || 0; } catch (e) { /* frozen source */ }
    return op;
  }
  RP.mapFor = function (part) {
    var env = this.env, layer = env.layer || {}, id = null;
    if (part.kind === 'asset') id = part.asset;
    else if (part.kind === 'subject') { if (env.subjectCanvas) return env.subjectCanvas; id = layer.cutout && layer.cutout.asset; }
    else if (part.kind === 'depth') id = layer.maps && layer.maps.depth && layer.maps.depth.asset;
    else if (part.kind === 'face') id = layer.maps && layer.maps.face && layer.maps.face.parts && layer.maps.face.parts.asset;
    return id && env.assets ? env.assets(id) : null;
  };
  /* The image the luma and colour kinds look at, in whichever space it is; DISP() converts in the shader. */
  RP.mask = function (def, look) {
    var self = this, env = this.env;
    if (!def || !def.parts || !def.parts.length) return null;
    look = look || this.cur;
    var m = null, first = true;
    def.parts.forEach(function (part) {
      var needsMap = part.kind === 'asset' || part.kind === 'subject' || part.kind === 'depth' || part.kind === 'face';
      var map = needsMap ? self.mapFor(part) : null;
      if (needsMap && !map) { note('mask-' + part.kind, 'A ' + part.kind + ' mask has no image to read; it was skipped.'); return; }
      var mp = new Float32Array(8), k = part.kind;
      if (k === 'linear') mp.set([part.x0, part.y0, part.x1, part.y1]);
      else if (k === 'radial') mp.set([part.cx, part.cy, part.rx, part.ry, part.rotation, part.feather]);
      else if (k === 'luma') mp.set([part.min, part.max, part.soft]);
      else if (k === 'color') mp.set([part.h, part.s, part.l, part.range, part.soft]);
      else if (k === 'depth') mp.set([part.near, part.far, part.soft]);
      else if (k === 'face') mp.set([C.FACE_PARTS[part.part]]);
      else if (k === 'asset') mp.set([opaque(map) ? 1 : 0]);
      var head = MASK_HEAD.replace('DISP(c)', look.space === 'linear' ? 'toDisplay(c)' : 'c') + MASK_KIND[k];
      var values = { u_src: look, m_p: mp, u_hinv: env.hinv || [1, 0, 0, 0, 1, 0, 0, 0, 1], u_crop: env.crop || [0, 0, 1, 1], u_map: map ? upload(map) : null, u_inv: part.invert ? 1 : 0, u_den: part.density, u_mode: part.mode === 'subtract' ? 1 : part.mode === 'intersect' ? 2 : 0, u_first: first ? 1 : 0, u_usePre: 0, u_prev: m };
      var blurDoc = k === 'linear' || k === 'radial' ? 0 : part.feather;
      if (blurDoc > 0) {
        var raw = self.handle(1, 'display', S.caps.float ? 'f16' : '8');
        self.pass(head + MASK_RAW, values, raw, 'mask:' + k);
        var soft = self.blur(raw, blurDoc * env.sx, blurDoc * env.sy);
        if (soft !== raw) self.free(raw);
        values.u_pre = soft; values.u_usePre = 1;
        var out2 = self.handle(1, 'display', S.caps.float ? 'f16' : '8');
        self.pass(head + MASK_TAIL, values, out2, 'mask:combine');
        self.free(soft); if (m) self.free(m);
        m = out2;
      } else {
        var out = self.handle(1, 'display', S.caps.float ? 'f16' : '8');
        self.pass(head + MASK_TAIL, values, out, 'mask:' + k);
        if (m) self.free(m);
        m = out;
      }
      first = false;
    });
    return m;
  };

  /* ---------- The builder handed to an effect's passes(g, p) ---------- */
  function builder(run, entry) {
    var env = run.env, def = entry.def, ops = [], usedSource = false;
    var g = {
      width: env.rw, height: env.rh, scale: Math.max(env.sx, env.sy), scaleXY: [env.sx, env.sy], box: { w: env.box[0], h: env.box[1] }, origin: env.dt.slice(),
      draft: !!env.draft, float: S.caps.float, space: def.space,
      px: function (v) { return v * Math.max(env.sx, env.sy); },
      rgb: function (color) {
        var c = M.parseColor(color) || [0, 0, 0, 1];
        return def.space === 'linear' ? [M.srgbToLinear(c[0]), M.srgbToLinear(c[1]), M.srgbToLinear(c[2]), c[3]] : c;
      },
      color: function (glsl, uniforms) {
        if (usedSource) throw new Error('LE.fx: "' + def.id + '" mixes g.color with passes; an effect does one or the other.');
        ops.push({ glsl: String(glsl), uniforms: uniforms || {} });
      },
      pass: function (frag, uniforms, opts) {
        opts = opts || {};
        var values = {}, k;
        for (k in (uniforms || {})) values[k] = uniforms[k];
        if (!values.u_src) values.u_src = g.source;
        var target = opts.target || run.handle(opts.scale || 1, def.space);
        return run.pass(String(frag), values, target, def.id);
      },
      blur: function (radius, opts) {
        opts = opts || {};
        var src = opts.source || g.source, rel = src.w / env.rw;
        var out = run.blur(src, radius * env.sx * rel, radius * env.sy * rel, opts.edge);
        if (out === src) { var copy = run.handle(rel, src.space); run.pass(BLUR_DOWN, { u_src: src }, copy, 'copy'); return copy; }
        return out;
      },
      downsample: function (handle, levels) {
        var out = [], cur = handle || g.source;
        for (var i = 0; i < Math.max(1, Math.min(8, levels || 1)); i++) {
          var half = run.handle(cur.w / env.rw / 2, cur.space);
          run.pass(BLUR_DOWN, { u_src: cur }, half, 'downsample');
          out.push(half); cur = half;
        }
        return out;
      },
      upsample: function (handle, scale) {
        var out = run.handle(scale || 1, handle.space);
        return run.pass('vec4 fx(){ vec2 d = 0.5 / vec2(textureSize(u_src, 0)); return (texture(u_src, v_uv + d) + texture(u_src, v_uv - d) + texture(u_src, v_uv + vec2(d.x, -d.y)) + texture(u_src, v_uv + vec2(-d.x, d.y))) * 0.25; }', { u_src: handle }, out, 'upsample');
      },
      lut1d: function (data, channels) { return lut1d(data, channels); },
      curve: function (points) { return lut1d(M.curveLUT(points, 1024), 1); },
      lut3d: function (data, size) { return lut3d(data, size); },
      mask: function (maskDef) { var r = FX.cleanMask(maskDef); return run.mask(r.mask, g.source) || run.constant(1); },
      alpha: function () { var out = run.handle(1, def.space); return run.pass('vec4 fx(){ return vec4(texture(u_src, v_uv).a); }', { u_src: g.source }, out, 'alpha'); },
      scene: function () { return env.scene || null; },
      stats: function () { return env.stats ? env.stats(entry) : null; },
      release: function (h) { run.free(h); }
    };
    Object.defineProperty(g, 'source', { enumerable: true, get: function () {
      if (ops.length) throw new Error('LE.fx: "' + def.id + '" mixes g.color with passes; an effect does one or the other.');
      usedSource = true;
      return run.flush(def.space);
    } });
    g._ops = ops;
    return g;
  }
  RP.constant = function (v) {
    var h = this.handle(1 / Math.max(this.env.rw, this.env.rh), 'display', '8');
    this.pass('uniform float u_v; vec4 fx(){ return vec4(u_v); }', { u_v: v }, h, 'const');
    return h;
  };
  var MIX = 'uniform sampler2D u_base, u_mask; uniform float u_amt, u_useMask;\nvec4 fx(){ vec4 a = texture(u_base, v_uv), r = texture(u_src, v_uv); float t = u_amt * (u_useMask > 0.5 ? texture(u_mask, v_uv).r : 1.0); BLEND return mix(a, r, t); }';
  /* Runs entries [from, to) of a resolved stack. Returns nothing; the result is run.cur plus whatever is still pending. */
  RP.entries = function (list, cacheKey) {
    var self = this, env = this.env, key = cacheKey || null, start = 0, i;
    /* Stage cache: resume after the last spatial entry whose output is still held. */
    if (key) {
      var keys = [], acc = key;
      for (i = 0; i < list.length; i++) { acc = M.hash(acc + '|' + list[i].sig); keys.push(acc); }
      for (i = list.length - 1; i >= 0; i--) {
        var hit = S.cache[keys[i]];
        if (hit && !hit.h.t.dead) { hit.used = ++S.tick; S.stats.cacheHits++; hit.h.held = true; self.held.push(hit.h); var was = self.cur; self.cur = hit.h; self.pending = null; self.free(was); start = i + 1; break; }
      }
    }
    this.input();
    for (i = start; i < list.length; i++) {
      var en = list[i], def = en.def;
      var p = env.draft && def.draft ? (def.draft(en.p) || en.p) : en.p;
      var g = builder(this, en);
      var result = def.passes(g, p);
      if (g._ops.length) {
        if (result) throw new Error('LE.fx: "' + def.id + '" mixes g.color with passes; an effect does one or the other.');
        var mh = en.mask ? this.maskFor(en.mask) : null;
        this.groups.push({ ops: g._ops, space: def.space, amount: en.amount, blend: en.blend, mask: mh, label: def.id });
        continue;
      }
      if (!result) continue;
      def._spatial = true;
      var base = this.cur;
      if (result !== base && (en.amount < 1 || en.blend !== 'normal' || en.mask)) {
        var mk = en.mask ? this.maskFor(en.mask) : null;
        var out = this.handle(1, def.space);
        var body = MIX.replace('BLEND', en.blend === 'normal' ? '' : 'float ra = r.a; vec3 b = unpremul(a), s = unpremul(r); r = vec4((' + BLEND_EXPR[en.blend] + ') * ra, ra);');
        this.pass((en.blend === 'normal' ? '' : BLEND_LIB) + body, { u_src: result, u_base: base, u_mask: mk, u_useMask: mk ? 1 : 0, u_amt: en.amount }, out, def.id + ':mix');
        if (mk) this.free(mk);
        this.free(result);
        result = out;
      }
      if (result !== base) { this.cur = result; this.free(base); }
      if (key && keys) {
        var h = this.cur;
        if (!h.cached && !h.borrowed) {
          h.cached = true; h.t.cached = true; h.held = true; this.held.push(h);
          var ti = this.temps.indexOf(h); if (ti >= 0) this.temps.splice(ti, 1);
          S.cache[keys[i]] = { h: h, used: ++S.tick };
          S.cacheBytes += h.t.bytes;
          if (S.cacheBytes > budget() / 2) evictCache(0);
        }
      }
    }
  };
  /* An entry mask is evaluated on the image as it is before the entry's group (pending colour ops are flushed first). */
  RP.maskFor = function (mask) {
    var look = this.groups.length || this.alpha ? this.flush(this.cur.space) : this.cur;
    return this.mask(mask, look);
  };
  RP.done = function () {
    this.temps.slice().forEach(function (h) { if (!h.cached) release(h.t); });
    this.temps = [];
    if (this.cur && !this.cur.cached && !this.cur.borrowed) release(this.cur.t);
    this.held.forEach(function (h) { h.held = false; });
    this.held = [];
  };

  /* ---------- Rendering an image through a stack, in tiles ---------- */
  var INGEST = 'uniform vec4 u_map; uniform float u_lin;\nvec4 fx(){ vec4 s = texture(u_src, v_uv * u_map.zw + u_map.xy); if (u_lin > 0.5 && s.a > 0.0) s.rgb = toLinear(s.rgb / s.a) * s.a; return s; }';
  var WARP = 'uniform mat3 u_hinv;\nvec4 fx(){ vec3 q = u_hinv * vec3(boxUV(), 1.0); if (q.z <= 1e-6) return vec4(0.0); vec2 s = q.xy / q.z; vec2 fw = max(fwidth(s), vec2(1e-6)); vec2 e = smoothstep(-0.5 * fw, 0.5 * fw, s) * smoothstep(-0.5 * fw, 0.5 * fw, 1.0 - s); float cov = e.x * e.y; if (cov <= 0.0) return vec4(0.0); return texture(u_src, s) * cov; }';
  var ALPHA = 'uniform sampler2D u_cut, u_clip, u_mask; uniform vec4 u_use;\nvec4 fx(){ float a = 1.0; vec2 b = boxUV(); if (u_use.x > 0.5) a *= texture(u_cut, v_uv).r; if (u_use.y > 0.5) a *= texture(u_clip, b).a; if (u_use.z > 0.5) a *= texture(u_mask, v_uv).r; if (u_use.w > 0.5) a *= step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0); return vec4(a); }';

  function align(v, down, grid) { grid = grid || 64; return down ? Math.floor(v / grid) * grid : Math.ceil(v / grid) * grid; }
  /* What one working rectangle may cost: about five targets alive at once, inside half the memory budget and the texture limit. */
  function perPixel() { return (S.caps.float ? 8 : 4) * 5; }
  function maxArea() { return budget() * 0.5 / perPixel(); }
  /* A stack that reads further than a tile can carry is clamped (and may show seams between tiles); say so once. */
  function capReach(reach) {
    var side = Math.min(Math.min(S.caps.maxTex, 8192), Math.floor(Math.sqrt(maxArea() * 2)));
    var max = Math.max(64, Math.floor((side - 768) / 2));
    if (reach > max) { note('reach', 'This stack reads ' + reach + ' pixels around each point, more than this device can tile (' + max + '); very wide effects may show seams at export size.'); return max; }
    return reach;
  }
  function tileSize(reach, grid) {
    if (S.cfg.tile) return S.cfg.tile;
    var side = Math.floor(Math.sqrt(maxArea())) - 2 * reach - 2 * grid;
    return Math.max(256, Math.min(2048, align(Math.min(S.caps.maxTex, 4096) - 2 * reach - 2 * grid, true), align(side, true)));
  }
  function clipCanvas(path, W, H, sx, sy, key) {
    var i, hit;
    for (i = 0; i < S.clips.length; i++) if (S.clips[i].key === key) { hit = S.clips.splice(i, 1)[0]; S.clips.push(hit); return hit.canvas; }
    var c = makeCanvas(W, H), x = c.getContext('2d');
    x.setTransform(sx, 0, 0, sy, 0, 0);
    x.fillStyle = '#fff';
    x.fill(path);
    S.clips.push({ key: key, canvas: c });
    if (S.clips.length > 6) S.clips.shift();
    return c;
  }

  /* job: { source, box:{w,h}, fx, mask, quad (unit corners), cut:{alpha, feather}, crop, clip (canvas), outline(fn), assets(fn), layer,
            preview, key, colorSpace, pad (doc px, forced), scene }  →  canvas with ._fx = { pad } (pad in document pixels) */
  function renderImage(job) {
    var gl = init();
    var src = job.source, W0 = src.naturalWidth || src.width, H0 = src.naturalHeight || src.height;
    var res = FX.resolve(job.fx);
    var stageA = res.entries.filter(function (e) { return !e.def.silhouette; });
    var stageB = res.entries.filter(function (e) { return e.def.silhouette && e.def.needs.indexOf('scene') < 0; });
    if (!res.entries.length && !job.cut && !job.clip && !job.mask && !job.quad && !job.pad && !job.colorSpace) {
      /* Nothing to do (an empty stack, or only entries that are off or unknown): the same pixels back, without a round trip. */
      var same = makeCanvas(W0, H0);
      same.getContext('2d').drawImage(src, 0, 0);
      same._fx = { pad: 0, padX: 0, padY: 0, padPx: 0, w: W0, h: H0 };
      return same;
    }
    if (!gl) return cpuImage(job, stageA.concat(stageB));
    var spatialA = stageA.some(function (e) { return e.def.radius(e.p, 1) > 0; });
    var draft = !!(job.preview && S.interactive);
    var source = src, W = W0, H = H0;
    /* Draft: spatial stacks render at half resolution while a control is dragged. */
    if (draft && (spatialA || stageB.length) && Math.max(W0, H0) > 512) {
      if (!src._fxHalf || src._fxHalfAt !== (src._fxStamp || 0)) {
        var hc = makeCanvas(Math.max(1, Math.round(W0 / 2)), Math.max(1, Math.round(H0 / 2)));
        hc.getContext('2d').drawImage(src, 0, 0, hc.width, hc.height);
        try { src._fxHalf = hc; src._fxHalfAt = src._fxStamp || 0; } catch (e) { /* not cacheable */ }
        source = hc;
      } else source = src._fxHalf;
      W = source.width; H = source.height;
    }
    var box = [job.box.w, job.box.h], sx = W / box[0], sy = H / box[1], sc = Math.max(sx, sy);
    var out;
    S.stats.renders++;
    if (!job.nested) S.runTick = ++S.tick;
    if (S.prof) S.profAt = performance.now();
    var hasAlpha = !!(job.cut || job.clip || job.mask);
    if (job.outline && job.cut) {
      var first = tiles(source, W, H, { job: job, box: box, sx: sx, sy: sy, draft: draft, entries: stageA, alpha: true, pad: 0, key: job.key });
      out = job.outline(first) || first;
      if (stageB.length) {
        var W2 = out.width, H2 = out.height, sx2 = W2 / box[0], sy2 = H2 / box[1];
        out = tiles(out, W2, H2, { job: { source: out, box: job.box, assets: job.assets, layer: job.layer, colorSpace: job.colorSpace }, box: box, sx: sx2, sy: sy2, draft: draft, entries: stageB, alpha: false, gate: true, pad: growOf(stageB, Math.max(sx2, sy2), job.pad), key: null });
      }
    } else {
      out = tiles(source, W, H, { job: job, box: box, sx: sx, sy: sy, draft: draft, entries: stageA, entriesB: stageB, alpha: hasAlpha || stageB.length > 0, gate: stageB.length > 0, pad: growOf(stageB, sc, job.pad), key: job.key });
    }
    return out;
  }
  function growOf(list, sc, forced) {
    var pad = forced ? forced * sc : 0;
    list.forEach(function (e) {
      var v = e.def.grow ? e.def.grow(e.p, sc) : 0;
      if (Array.isArray(v)) v = Math.max.apply(null, v);
      if (v > 0) pad = Math.max(pad, v);
    });
    return Math.ceil(pad);
  }
  /* A result may reach beyond the layer box, but not without bound: at most twice the picture's longer side, 2048 pixels,
     six times the picture's area (2 MP for small pictures) and 48 MP in all. Beyond that a far shadow is cut off. */
  function capPad(pad, W, H) {
    pad = Math.max(0, Math.min(pad, 2048, Math.max(64, 2 * Math.max(W, H))));
    var most = Math.min(48e6, Math.max(6 * W * H, 2e6));
    while (pad > 0 && (W + 2 * pad) * (H + 2 * pad) > most) pad = Math.floor(pad * 0.8);
    return pad;
  }
  function reachOf(list, sc, masks) {
    var r = 0;
    list.forEach(function (e) {
      r += Math.max(0, Math.ceil(e.def.radius(e.p, sc) || 0));
      if (e.mask) r += maskReach(e.mask, sc);
    });
    (masks || []).forEach(function (m) { r += maskReach(m, sc); });
    return r;
  }
  function maskReach(mask, sc) {
    var r = 0;
    ((mask && mask.parts) || []).forEach(function (p) { if (p.kind !== 'linear' && p.kind !== 'radial' && p.feather > 0) r = Math.max(r, M.blurReach(p.feather * sc)); });
    return r;
  }

  /* Rectangle pixels a render will touch, summed over its tiles (the same arithmetic as eachTile). */
  function workOf(W, H, pad, reach, spatial) {
    var grid = gridFor(reach), OW = W + 2 * pad, OH = H + 2 * pad;
    var near = spatial ? Math.min(reach, 2 * grid) : 0, sw = OW + 2 * near + 2 * grid, sh = OH + 2 * near + 2 * grid;
    if (!S.cfg.tile && sw <= S.caps.maxTex && sh <= S.caps.maxTex && sw * sh <= maxArea()) return spatial ? sw * sh : OW * OH;
    var core = tileSize(reach, grid), side = spatial ? core + 2 * reach + 2 * grid : core;
    return Math.ceil(OW / core) * Math.ceil(OH / core) * side * side;
  }
  /* How much one render may cost. Stacks with a very wide reach on a large picture would otherwise take minutes: past this,
     the working resolution is halved (and the result drawn back at full size), with a note. */
  function workMax(preview) {
    if (S.cfg.workMP) return S.cfg.workMP * 1e6;
    var level = LE.perf && LE.perf.level ? LE.perf.level() : 'high';
    return (level === 'high' ? 480 : level === 'mid' ? 240 : 120) * 1e6 / (preview ? 6 : 1);
  }
  function halve(source) {
    var c = makeCanvas(Math.max(1, Math.round((source.naturalWidth || source.width) / 2)), Math.max(1, Math.round((source.naturalHeight || source.height) / 2))), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  /* The tile loop shared by the layer stage and draw time. plan: { W, H, pad, reach, spatial, origin:[ax, ay] } → calls each(tile). */
  function eachTile(plan, each) {
    var W = plan.W, H = plan.H, pad = plan.pad || 0, reach = plan.reach, grid = gridFor(reach), ax = plan.origin ? plan.origin[0] : 0, ay = plan.origin ? plan.origin[1] : 0;
    var OW = W + 2 * pad, OH = H + 2 * pad;
    /* One rectangle holding the whole picture needs only a small border: beyond the picture everything is its extended edge (or
       transparent), which the texture's own edge clamp continues exactly. Tiles inside a picture need the stack's real reach. */
    var near = plan.spatial ? Math.min(reach, 2 * grid) : 0, sw = OW + 2 * near + 2 * grid, sh = OH + 2 * near + 2 * grid;
    var single = !S.cfg.tile && sw <= S.caps.maxTex && sh <= S.caps.maxTex && sw * sh <= maxArea();
    var core = single ? 0 : tileSize(reach, grid), tw = single ? OW : core, th = single ? OH : core;
    if (single) reach = near;
    for (var ty = -pad; ty < H + pad; ty += th) {
      for (var tx = -pad; tx < W + pad; tx += tw) {
        var cw = Math.min(tw, W + pad - tx), ch = Math.min(th, H + pad - ty);
        var x0 = tx, y0 = ty, x1 = tx + cw, y1 = ty + ch;
        if (plan.spatial) { x0 = align(tx - reach + ax, true, grid) - ax; y0 = align(ty - reach + ay, true, grid) - ay; x1 = align(tx + cw + reach + ax, false, grid) - ax; y1 = align(ty + ch + reach + ay, false, grid) - ay; }
        /* The part of the image that exists under this rectangle (at least one pixel, so edges can be extended). */
        var ux0 = Math.max(0, x0), uy0 = Math.max(0, y0), ux1 = Math.min(W, x1), uy1 = Math.min(H, y1);
        if (ux1 <= ux0) { ux0 = Math.min(Math.max(0, x0), W - 1); ux1 = ux0 + 1; }
        if (uy1 <= uy0) { uy0 = Math.min(Math.max(0, y0), H - 1); uy1 = uy0 + 1; }
        each({
          tx: tx, ty: ty, cw: cw, ch: ch, x0: x0, y0: y0, rw: x1 - x0, rh: y1 - y0, single: single, grid: grid,
          up: [ux0, uy0, ux1 - ux0, uy1 - uy0], whole: ux0 === 0 && uy0 === 0 && ux1 === W && uy1 === H,
          map: [(x0 - ux0) / (ux1 - ux0), (y0 - uy0) / (uy1 - uy0), (x1 - x0) / (ux1 - ux0), (y1 - y0) / (uy1 - uy0)],
          img: [(0 - x0) / (x1 - x0), (0 - y0) / (y1 - y0), (W - x0) / (x1 - x0), (H - y0) / (y1 - y0)],
          uvr: [(tx - x0) / (x1 - x0), (ty - y0) / (y1 - y0), cw / (x1 - x0), ch / (y1 - y0)]
        });
        S.stats.tiles++;
      }
    }
  }
  /* The start of a run for one tile: upload what exists, extend it over the working rectangle when they differ. */
  function ingest(env, source, t, cached, space) {
    var tex = upload(source, t.whole ? { fresh: !cached } : { rect: t.up, fresh: true });
    var run = new Run(env, { t: tex, w: tex.w, h: tex.h, space: 'display', borrowed: true });
    run.tex = tex; run.texFresh = !(t.whole && cached);
    /* Deferred until something reads the input: a stage-cache hit never needs it. */
    if (!t.whole || tex.w !== t.rw || tex.h !== t.rh) run.pending = { map: t.map, space: space === 'linear' ? 'linear' : 'display' };
    return run;
  }
  RP.input = function () {
    var q = this.pending;
    if (!q) return this.cur;
    this.pending = null;
    var ing = this.handle(1, q.space);
    this.pass(INGEST, { u_src: this.cur, u_map: q.map, u_lin: q.space === 'linear' ? 1 : 0 }, ing, 'ingest');
    this.cur = ing;
    return ing;
  };

  function tiles(source, W, H, o) {
    var job = o.job, sc = Math.max(o.sx, o.sy), pad = capPad(o.pad || 0, W, H);
    var listA = o.entries || [], listB = o.entriesB || [];
    var mask = o.alpha && job.mask ? FX.cleanMask(job.mask).mask : null;
    var cut = o.alpha ? job.cut : null;
    var cutSigma = cut && cut.feather > 0 ? cut.feather / 2 : 0;
    var reach = capReach(reachOf(listA.concat(listB), sc, mask ? [mask] : []) + (cutSigma ? M.blurReach(cutSigma * sc) : 0));
    if (reach > 0 && Math.max(W, H) > 96 && workOf(W, H, pad, reach, true) > workMax(job.preview)) {
      note('work', 'This stack is very wide for the picture size; it is rendered at reduced resolution to stay responsive.');
      var small = halve(source), o2 = {};
      Object.keys(o).forEach(function (k) { o2[k] = o[k]; });
      o2.sx = o.sx * small.width / W; o2.sy = o.sy * small.height / H; o2.pad = (o.pad || 0) / 2; o2.key = o.key ? o.key + '|half' : null;
      return tiles(small, small.width, small.height, o2);
    }
    var out = makeCanvas(W + 2 * pad, H + 2 * pad), octx;
    try { octx = out.getContext('2d', job.colorSpace === 'display-p3' ? { colorSpace: 'display-p3' } : undefined); } catch (e) { octx = out.getContext('2d'); }
    var p3 = job.colorSpace === 'display-p3' && S.caps.p3;
    try { if (S.caps.p3) { var want = p3 ? 'display-p3' : 'srgb'; if (S.gl.drawingBufferColorSpace !== want) S.gl.drawingBufferColorSpace = want; } } catch (e2) { p3 = false; }
    var hinv = null, whole = null, ident = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (job.quad) { var hm = Q.homography(job.quad); hinv = hm && Q.invert(hm); }
    var clipTex = o.alpha && job.clip ? upload(job.clip) : null;
    var stats = statsFn(source, listA, o, job);
    var f8 = S.caps.float ? 'f16' : '8';
    eachTile({ W: W, H: H, pad: pad, reach: reach, spatial: reach > 0 }, function (t) {
      var env = {
        rw: t.rw, rh: t.rh, sx: o.sx, sy: o.sy, dm: [1 / o.sx, 0, 0, 1 / o.sy], dt: [t.x0 / o.sx, t.y0 / o.sy], box: o.box, abs: [t.x0, t.y0], grid: t.grid,
        img: t.img, draft: o.draft, crop: job.crop || [0, 0, 1, 1], hinv: hinv, assets: job.assets, layer: job.layer, subjectCanvas: job.cut ? job.cut.alpha : null, scene: null, stats: stats
      };
      var run;
      var cacheKey = o.key && t.single && job.preview ? M.hash([o.key, W, H, t.x0, t.y0, t.rw, t.rh, o.draft ? 1 : 0, S.caps.float ? 1 : 0, job.quad ? JSON.stringify(job.quad) : ''].join('|')) : null;
      if (hinv) {
        whole = whole || upload(source, { mips: true });
        run = new Run(env, { t: whole, w: whole.w, h: whole.h, space: 'display', borrowed: true });
        var warped = run.handle(1, 'display');
        run.pass(WARP, { u_src: run.cur, u_hinv: hinv }, warped, 'warp');
        run.cur = warped;
      } else run = ingest(env, source, t, !!job.preview, listA.length ? listA[0].def.space : 'display');
      try {
        run.entries(listA, cacheKey);
        if (o.alpha || o.gate) {
          var sub = null, mk = null;
          if (cut && cut.alpha) {
            sub = run.handle(1, 'display', f8);
            run.pass(MASK_HEAD.replace('DISP(c)', 'c') + MASK_KIND.subject + MASK_RAW, { u_map: { t: upload(cut.alpha) }, u_hinv: hinv || ident, u_crop: env.crop, m_p: new Float32Array(8) }, sub, 'cutout');
            if (cutSigma > 0) { var soft = run.blur(sub, cutSigma * o.sx, cutSigma * o.sy); if (soft !== sub) { run.free(sub); sub = soft; } }
          }
          if (mask) mk = run.maskFor(mask);
          if (sub || mk || clipTex || o.gate) {
            var ah = run.handle(1, 'display', f8);
            run.pass(ALPHA, { u_cut: sub, u_clip: clipTex ? { t: clipTex } : null, u_mask: mk, u_use: [sub ? 1 : 0, clipTex ? 1 : 0, mk ? 1 : 0, o.gate ? 1 : 0] }, ah, 'alpha');
            if (sub) run.free(sub);
            if (mk) run.free(mk);
            run.alpha = ah;   /* multiplied in by the next flush, together with any colour operations still pending */
          }
        }
        if (listB.length) run.entries(listB, null);
        run.flush('display', { uvr: t.uvr, w: t.cw, h: t.ch, p3: p3 });
        octx.drawImage(S.canvas, 0, 0, t.cw, t.ch, t.tx + pad, t.ty + pad, t.cw, t.ch);
      } finally {
        run.done();
        if (run.tex && run.texFresh) kill(run.tex);
      }
    });
    if (whole && !job.preview) freeUpload(whole);
    trim(0);
    out._fx = { pad: pad / sc, padX: pad / o.sx, padY: pad / o.sy, padPx: pad, w: W, h: H };
    return out;
  }

  /* Whole-image statistics for entries that ask: the stack up to that entry, run once on a reduced copy. */
  function statsFn(source, list, o, job) {
    var memo = {};
    return function (entry) {
      var idx = list.indexOf(entry);
      if (idx < 0 || !FX._stats) return null;
      if (memo[idx]) return memo[idx];
      var W = source.naturalWidth || source.width, H = source.naturalHeight || source.height, k = Math.min(1, 256 / Math.max(W, H));
      var small = makeCanvas(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
      small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
      var before = list.slice(0, idx).map(function (e) { return { id: e.id, type: e.type, p: e.p, amount: e.amount, blend: e.blend, mask: e.mask }; });
      var img = before.length ? renderImage({ source: small, box: job.box, fx: before, assets: job.assets, layer: job.layer, nested: true }) : small;
      return (memo[idx] = FX._stats(img, {}));
    };
  }

  /* Devices without WebGL2: effects with a cpu() path run, the rest are skipped. */
  function cpuImage(job, entries) {
    var src = job.source, W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    var todo = entries.filter(function (e) { return !!e.def.cpu; });
    if (todo.length) {
      var img = x.getImageData(0, 0, W, H);
      todo.forEach(function (e) {
        var before = e.amount < 1 ? new Uint8ClampedArray(img.data) : null;
        e.def.cpu(img, e.p, { scale: W / job.box.w, box: job.box, width: W, height: H });
        if (before) { var d = img.data, t = e.amount; for (var i = 0; i < d.length; i++) d[i] = before[i] + (d[i] - before[i]) * t; }
      });
      x.putImageData(img, 0, 0);
    }
    if (job.cutApply) c = job.cutApply(c) || c;
    if (job.outline && job.cut) c = job.outline(c) || c;
    c._fx = { pad: 0, padX: 0, padY: 0, padPx: 0, w: W, h: H, fallback: true };
    return c;
  }

  /* ---------- Public: standalone, layer stage, draw time ---------- */
  /* LE.fx.apply(canvas, { fx, mask, quad, box, cut, clip, tile, preview, colorSpace }) → canvas. For tests, thumbnails and tools. */
  FX.apply = function (source, opts) {
    opts = opts || {};
    var W = source.naturalWidth || source.width, H = source.naturalHeight || source.height;
    var scale = opts.scale > 0 ? opts.scale : 1;
    var keep = S.cfg.tile;
    if (opts.tile) S.cfg.tile = opts.tile;
    try {
      return renderImage({
        source: source, box: opts.box || { w: W / scale, h: H / scale }, fx: opts.fx || [], mask: opts.mask || null,
        quad: opts.quad ? Q.unit({ transform: { quad: opts.quad } }) : null, cut: opts.cut || null, crop: opts.crop || null, clip: opts.clip || null,
        assets: opts.assets || null, layer: opts.layer || null, preview: !!opts.preview, key: opts.key || null, colorSpace: opts.colorSpace, pad: opts.pad || 0
      });
    } finally { S.cfg.tile = keep; }
  };

  /* The seam in LE.Scene._processImage: the layer's processed bitmap when it carries expert data. */
  FX.layerBitmap = function (scene, layer, canvas, o) {
    o = o || {};
    var W = canvas.width, H = canvas.height, cut = null;
    if (o.cut && o.cut.alpha) cut = { alpha: o.cut.alpha, feather: o.cut.feather || 0 };
    var clip = null;
    if (o.clip) clip = clipCanvas(o.clip, W, H, W / layer.w, H / layer.h, [layer.id, layer.mask, layer.maskPath, layer.radius, layer.w, layer.h, W, H].join('|'));
    var crop = layer.crop ? [layer.crop.x || 0, layer.crop.y || 0, layer.crop.w == null ? 1 : layer.crop.w, layer.crop.h == null ? 1 : layer.crop.h] : null;
    try {
      return renderImage({
        source: canvas, box: { w: layer.w, h: layer.h }, fx: layer.fx || [], mask: layer.fxMask || null, quad: Q.unit(layer), cut: cut, crop: crop, clip: clip,
        outline: o.outline || null, cutApply: o.cutApply || null, assets: o.assets || null, layer: layer, preview: !!o.preview, key: o.key || null
      });
    } catch (err) {
      /* A lost context or a broken effect must not blank the layer: fall back to the picture without expert effects. */
      note('render-' + (S.lost ? 'lost' : 'error'), S.lost ? 'The graphics context was lost; effects come back when it is restored.' : String(err && err.message || err));
      var fb = o.cutApply ? (o.cutApply(canvas) || canvas) : canvas;
      if (o.outline && cut) fb = o.outline(fb) || fb;
      if (fb === canvas) { fb = makeCanvas(W, H); fb.getContext('2d').drawImage(canvas, 0, 0); }
      return fb;
    }
  };

  /* Draw-time processing: a region of device pixels through a stack.
     o: { source (canvas), scene (canvas|null), fx, layerMask, adjust:{ amount, mask }|null, scale, matrix (region px → layer box), box, abs, assets, layer, draft } */
  function renderRegion(o) {
    var gl = init();
    if (!gl) return null;
    var res = FX.resolve(o.fx), sc = o.scale;
    var listA = o.adjust ? res.entries : res.entries.filter(function (e) { return !e.def.silhouette; });
    var listB = o.adjust ? [] : res.entries.filter(function (e) { return e.def.silhouette; });
    var lmask = o.layerMask ? FX.cleanMask(o.layerMask).mask : null;
    var amask = o.adjust && o.adjust.mask ? FX.cleanMask(o.adjust.mask).mask : null;
    var reach = capReach(reachOf(res.entries, sc, [lmask, amask].filter(Boolean)));
    var W = o.source.width, H = o.source.height, m = o.matrix;
    if (reach > 0 && Math.max(W, H) > 96 && !o.halved && workOf(W, H, 0, reach, true) > workMax(o.draft)) {
      note('work', 'This stack is very wide for the picture size; it is rendered at reduced resolution to stay responsive.');
      var o2 = {};
      Object.keys(o).forEach(function (k) { o2[k] = o[k]; });
      o2.source = halve(o.source); o2.scene = o.scene ? halve(o.scene) : null; o2.scale = sc / 2;
      o2.matrix = [m[0] * 2, m[1] * 2, m[2] * 2, m[3] * 2, m[4], m[5]]; o2.abs = [Math.round(o.abs[0] / 2), Math.round(o.abs[1] / 2)];
      o2.halved = workOf(o2.source.width, o2.source.height, 0, capReach(reachOf(res.entries, sc / 2, [lmask, amask].filter(Boolean))), true) <= workMax(o.draft);
      var lowRes = renderRegion(o2), up = makeCanvas(W, H), ux = up.getContext('2d');
      if (!lowRes) return null;
      ux.imageSmoothingQuality = 'high';
      ux.drawImage(lowRes, 0, 0, W, H);
      return up;
    }
    var out = makeCanvas(W, H), octx = out.getContext('2d');
    var needScene = !!o.scene && res.entries.some(function (e) { return e.def.needs.indexOf('scene') >= 0; });
    var f8 = S.caps.float ? 'f16' : '8';
    if (S.prof) S.profAt = performance.now();
    S.stats.renders++;
    S.runTick = ++S.tick;
    eachTile({ W: W, H: H, pad: 0, reach: reach, spatial: reach > 0, origin: o.abs }, function (t) {
      var env = {
        rw: t.rw, rh: t.rh, sx: sc, sy: sc, dm: [m[0], m[2], m[1], m[3]], dt: [m[0] * t.x0 + m[2] * t.y0 + m[4], m[1] * t.x0 + m[3] * t.y0 + m[5]], box: o.box, abs: [t.x0 + o.abs[0], t.y0 + o.abs[1]], grid: t.grid,
        img: t.img, draft: !!o.draft, crop: [0, 0, 1, 1], hinv: null, assets: o.assets, layer: o.layer, subjectCanvas: null, scene: null, stats: null
      };
      var run = ingest(env, o.source, t, false, !o.adjust && listA.length ? listA[0].def.space : 'display'), scTex = null, base = null;
      try {
        if (needScene) {
          scTex = upload(o.scene, t.whole ? { fresh: true } : { rect: t.up, fresh: true });
          var sh = run.handle(1, 'display');
          run.pass(INGEST, { u_src: { t: scTex }, u_map: t.whole && scTex.w === t.rw && scTex.h === t.rh ? [0, 0, 1, 1] : t.map, u_lin: 0 }, sh, 'scene');
          sh.hold = true;
          env.scene = sh;
        }
        if (o.adjust) { base = run.input(); base.hold = true; }
        run.entries(listA, null);
        if (o.adjust) {
          /* Adjustment layer: the processed pixels are mixed back by opacity, mask and the layer's box. */
          var after = run.flush('display');
          var am = amask ? run.mask(amask, base) : null;
          var mixed = run.handle(1, 'display');
          run.pass('uniform sampler2D u_base, u_mask; uniform vec2 u_k;\nvec4 fx(){ vec2 b = boxUV(); float t = u_k.x * step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0); if (u_k.y > 0.5) t *= texture(u_mask, v_uv).r; return mix(texture(u_base, v_uv), texture(u_src, v_uv), t); }',
            { u_src: after, u_base: base, u_mask: am, u_k: [o.adjust.amount, am ? 1 : 0] }, mixed, 'adjust:mix');
          if (am) run.free(am);
          run.cur = mixed;
          if (after !== base) run.free(after);
        } else {
          if (lmask) {
            var lm = run.maskFor(lmask);
            if (lm) { var ah = run.handle(1, 'display', f8); run.pass(ALPHA, { u_mask: lm, u_use: [0, 0, 1, 0] }, ah, 'alpha'); run.free(lm); run.alpha = ah; }
          }
          if (listB.length) run.entries(listB, null);
        }
        run.flush('display', { uvr: t.uvr, w: t.cw, h: t.ch, p3: false });
        octx.drawImage(S.canvas, 0, 0, t.cw, t.ch, t.tx, t.ty, t.cw, t.ch);
      } finally {
        if (base) { base.hold = false; if (base !== run.cur && !base.borrowed) release(base.t); }
        if (env.scene) { env.scene.hold = false; release(env.scene.t); }
        run.done();
        if (run.tex) kill(run.tex);
        if (scTex) kill(scTex);
      }
    });
    trim(0);
    return out;
  }
  FX._region = renderRegion;

  /* ---------- Draw time: the hook LE.Scene._drawDocument calls for each layer ---------- */
  function expert(l) { return !!l && ((Array.isArray(l.fx) && l.fx.length > 0) || !!l.fxMask); }
  function sceneAsset(scene) {
    return function (id) {
      var rec = scene._assets && scene._assets[id];
      if (!rec) return null;
      if (rec.canvas) return rec.canvas;
      if (rec.image && rec.image.complete && (rec.image.naturalWidth || rec.image.width)) return rec.image;
      return null;
    };
  }
  function deviceBox(m, pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { var x = m.a * p[0] + m.c * p[1] + m.e, y = m.b * p[0] + m.d * p[1] + m.f; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    return [x0, y0, x1, y1];
  }
  function layerCorners(l, e) {
    e = e || 0;
    var cx = l.x + l.w / 2, cy = l.y + l.h / 2, r = (l.rotation || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) { var lx = k[0] * (l.w / 2 + e), ly = k[1] * (l.h / 2 + e); return [cx + lx * cs - ly * sn, cy + lx * sn + ly * cs]; });
  }
  /* region pixels → the layer's box coordinates (document units), as [a, b, c, d, e, f] (x' = a·x + c·y + e, y' = b·x + d·y + f). */
  function toBox(m, l, rx, ry) {
    var det = m.a * m.d - m.b * m.c || 1e-9;
    var ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det, ie = (m.c * m.f - m.d * m.e) / det, iff = (m.b * m.e - m.a * m.f) / det;
    var pe = ia * rx + ic * ry + ie, pf = ib * rx + id * ry + iff;   /* region origin on the page */
    var r = -(l.rotation || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    var fxs = l.flipX ? -1 : 1, fys = l.flipY ? -1 : 1;
    return [
      (cs * ia - sn * ib) * fxs, (sn * ia + cs * ib) * fys, (cs * ic - sn * id) * fxs, (sn * ic + cs * id) * fys,
      (cs * (pe - cx) - sn * (pf - cy)) * fxs + l.w / 2, (sn * (pe - cx) + cs * (pf - cy)) * fys + l.h / 2
    ];
  }
  /* Draws layers alone, with the page's current transform, into a canvas covering their device bounding box. */
  function isolate(scene, ctx, layers, opts, grow) {
    var m = ctx.getTransform(), cv = ctx.canvas, pts = [];
    layers.forEach(function (l) {
      var s = l.shadow, e = (grow || 0) + (s ? (Number(s.blur) || 0) * 2 + Math.abs(Number(s.x) || 0) + Math.abs(Number(s.y) || 0) : 0);
      layerCorners(l, e).forEach(function (p) { pts.push(p); });
    });
    if (!pts.length) return null;
    var b = deviceBox(m, pts), sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    var x0 = Math.max(0, Math.floor(b[0] - 2)), y0 = Math.max(0, Math.floor(b[1] - 2)), x1 = Math.min(cv.width, Math.ceil(b[2] + 2)), y1 = Math.min(cv.height, Math.ceil(b[3] + 2));
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    var c = makeCanvas(x1 - x0, y1 - y0), x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = ctx.imageSmoothingQuality || 'high';
    x.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    var inner = {};
    Object.keys(opts).forEach(function (k) { inner[k] = opts[k]; });
    inner.fxInner = true;
    layers.forEach(function (l) { scene._drawLayer(x, l, inner); });
    return { canvas: c, ctx: x, x: x0, y: y0, m: m, scale: sc };
  }
  function put(ctx, canvas, x, y, blend, replace) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    if (replace) { ctx.beginPath(); ctx.rect(x, y, canvas.width, canvas.height); ctx.clip(); ctx.globalCompositeOperation = 'copy'; }
    else ctx.globalCompositeOperation = blend || 'source-over';
    ctx.drawImage(canvas, x, y);
    ctx.restore();
  }
  /* Applies an adjustment layer to whatever ctx's canvas holds, inside the layer's box and the page. */
  function adjustOnto(scene, ctx, adj, opts) {
    var m = ctx.getTransform(), cv = ctx.canvas, sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    var b = deviceBox(m, layerCorners(adj)), dw = scene._doc.width, dh = scene._doc.height;
    var page = deviceBox(m, [[0, 0], [dw, 0], [dw, dh], [0, dh]]);
    var x0 = Math.max(0, Math.floor(Math.max(b[0], page[0]))), y0 = Math.max(0, Math.floor(Math.max(b[1], page[1])));
    var x1 = Math.min(cv.width, Math.ceil(Math.min(b[2], page[2]))), y1 = Math.min(cv.height, Math.ceil(Math.min(b[3], page[3])));
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    var srcC = makeCanvas(x1 - x0, y1 - y0);
    srcC.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
    var out = renderRegion({ source: srcC, fx: adj.fx, adjust: { amount: scene._opacity(adj), mask: adj.fxMask || null }, scale: sc, matrix: toBox(m, adj, x0, y0), box: [adj.w, adj.h], abs: [x0, y0], assets: sceneAsset(scene), layer: adj, draft: !!(opts.preview && S.interactive) });
    if (out) put(ctx, out, x0, y0, null, true);
  }
  function growDoc(layer) {
    var g = 0;
    FX.resolve(layer.fx).entries.forEach(function (e) { var v = e.def.grow ? e.def.grow(e.p, 1) : 0; if (Array.isArray(v)) v = Math.max.apply(null, v); g += Math.max(0, v || 0); });
    return Math.min(4096, g);
  }
  function plainEntries(list) { return list.map(function (e) { return { id: e.id, type: e.type, p: e.p, amount: e.amount, blend: e.blend, mask: e.mask }; }); }
  var BLEND2D = { multiply: 1, screen: 1, overlay: 1, darken: 1, lighten: 1, 'color-dodge': 1, 'color-burn': 1, 'hard-light': 1, 'soft-light': 1, difference: 1, exclusion: 1, hue: 1, saturation: 1, color: 1, luminosity: 1 };
  /* Returns true when the layer was handled here (drawn, or deliberately skipped); false lets LE.Scene draw it as usual. */
  FX.draw = function (scene, ctx, layer, opts) {
    if (!layer || opts.fxInner) return false;
    var layers = scene._doc.layers, st = opts._fx || (opts._fx = { done: {} }), i;
    if (layer.type === 'adjust') {
      if (layer.visible === false || scene._hidden(layer) || layer.clip || !Array.isArray(layer.fx) || !layer.fx.length || !(scene._opacity(layer) > 0)) return true;
      try { adjustOnto(scene, ctx, layer, opts); } catch (e) { note('adjust-error', String(e && e.message || e)); }
      return true;
    }
    if (layer.type === 'group') return false;
    /* A group with expert data draws its members together, once, where its first member sits. */
    var top = null, g = layer.groupId ? scene._find(layer.groupId) : null, guard = 0;
    while (g && guard++ < 16) { if (expert(g)) top = g; g = g.groupId ? scene._find(g.groupId) : null; }
    var members, owner, stack, lmask, clipped = [];
    if (top) {
      if (st.done[top.id]) return true;
      st.done[top.id] = 1;
      if (top.visible === false || scene._hidden(top)) return true;
      members = scene._descendants(top.id, []).filter(function (l) { return l.type !== 'group' && l.type !== 'adjust'; });
      members.sort(function (a, b) { return layers.indexOf(a) - layers.indexOf(b); });
      owner = top; stack = top.fx || []; lmask = top.fxMask || null;
    } else {
      if (layer.visible === false || scene._hidden(layer) || (opts.preview && scene._editing === layer.id)) return false;
      for (i = layers.indexOf(layer) + 1; i < layers.length && layers[i].type === 'adjust' && layers[i].clip; i++) if (layers[i].visible !== false && Array.isArray(layers[i].fx) && layers[i].fx.length) clipped.push(layers[i]);
      var res = FX.resolve(layer.fx);
      if (layer.type === 'image') { stack = plainEntries(res.entries.filter(function (e) { return e.def.needs.indexOf('scene') >= 0; })); lmask = null; }
      else { stack = layer.fx || []; lmask = layer.fxMask || null; }
      if (!stack.length && !lmask && !clipped.length) return false;
      members = [layer]; owner = layer;
    }
    try {
      var iso = isolate(scene, ctx, members, opts, stack.length ? growDoc({ fx: stack }) : 0);
      if (!iso) return true;
      var canvas = iso.canvas;
      if (stack.length || lmask) {
        var needScene = FX.resolve(stack).entries.some(function (e) { return e.def.needs.indexOf('scene') >= 0; }), behind = null;
        if (needScene) { behind = makeCanvas(canvas.width, canvas.height); behind.getContext('2d').drawImage(ctx.canvas, iso.x, iso.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height); }
        var outC = renderRegion({ source: canvas, scene: behind, fx: stack, layerMask: lmask, scale: iso.scale, matrix: toBox(iso.m, owner, iso.x, iso.y), box: [owner.w, owner.h], abs: [iso.x, iso.y], assets: sceneAsset(scene), layer: owner, draft: !!(opts.preview && S.interactive) });
        if (outC) canvas = outC;
      }
      if (clipped.length) {
        var cx = canvas.getContext('2d');
        cx.setTransform(iso.m.a, iso.m.b, iso.m.c, iso.m.d, iso.m.e - iso.x, iso.m.f - iso.y);
        clipped.forEach(function (adj) { adjustOnto(scene, cx, adj, opts); });
      }
      put(ctx, canvas, iso.x, iso.y, !top && BLEND2D[layer.blend] ? layer.blend : 'source-over', false);
    } catch (e2) {
      note('draw-error', String(e2 && e2.message || e2));
      return false;
    }
    return true;
  };

  /* ---------- The cached layer stage, driven from LE.Scene._processImage through le-fx-boot.js ---------- */
  /* Asset ids a layer's expert data refers to. */
  FX.assetsOf = function (layer) {
    var ids = [];
    function parts(m) { ((m && m.parts) || []).forEach(function (p) { if (p && p.kind === 'asset' && p.asset) ids.push(p.asset); }); }
    if (!layer) return ids;
    parts(layer.fxMask);
    (Array.isArray(layer.fx) ? layer.fx : []).forEach(function (e) {
      if (!e) return;
      parts(e.mask);
      var d = FX.get(e.type);
      if (d && e.p) Object.keys(d.params).forEach(function (k) { if (d.params[k].type === 'lut' && typeof e.p[k] === 'string') ids.push(e.p[k]); });
    });
    if (layer.retouch && layer.retouch.asset) ids.push(layer.retouch.asset);
    if (layer.cutout && layer.cutout.asset) ids.push(layer.cutout.asset);
    var mp = layer.maps || {};
    ['depth', 'normals'].forEach(function (k) { if (mp[k] && mp[k].asset) ids.push(mp[k].asset); });
    if (mp.face && mp.face.parts && mp.face.parts.asset) ids.push(mp.face.parts.asset);
    return ids;
  };
  /* Waits for the assets a page's expert data needs, so the synchronous draw-time path finds them decoded. */
  FX.prepare = function (scene) {
    var jobs = [];
    (scene._doc.layers || []).forEach(function (l) {
      FX.assetsOf(l).forEach(function (id) { var rec = scene._assets[id]; if (rec && rec.ready) jobs.push(Promise.resolve(rec.ready).catch(function () { return null; })); });
    });
    return Promise.all(jobs);
  };
  FX.layer = function (scene, layer, targetMax, preview) {
    var H = (LE.Scene && LE.Scene._fx) || {};
    var raw = {};
    Object.keys(layer).forEach(function (k) { raw[k] = layer[k]; });
    raw._fxRaw = true;
    delete raw.cutout;   /* applied after the effect stack, on the GPU */
    var cut = layer.cutout && layer.cutout.enabled !== false ? layer.cutout : null;
    var mrec = cut ? scene._assets[cut.asset] : null;
    var key = JSON.stringify([layer.src, layer.crop, layer.adjust, layer.filter, layer.removeBg, layer.retouch || 0, targetMax, preview ? scene._level() : 'x']);
    var store = scene._fxBase || (scene._fxBase = { map: {}, order: [] });
    return FX.prepare({ _doc: { layers: [layer] }, _assets: scene._assets }).then(function () {
      var hit = preview ? store.map[layer.id] : null;
      if (hit && hit.key === key && hit.canvas && hit.canvas.width > 1) return hit.canvas;
      return scene._processImage(raw, targetMax, preview).then(function (canvas) {
        if (canvas && preview) {
          /* The CPU part of the pipeline is kept, so dragging an effect control does not redo crop, adjust and filters. */
          store.map[layer.id] = { key: key, canvas: canvas };
          var at = store.order.indexOf(layer.id);
          if (at >= 0) store.order.splice(at, 1);
          store.order.push(layer.id);
          while (store.order.length > 12) { var old = store.order.shift(); delete store.map[old]; }
        }
        return canvas;
      });
    }).then(function (canvas) {
      if (!canvas) return null;
      var alpha = cut && mrec && H.cutoutAlpha ? H.cutoutAlpha(mrec) : null;
      var feather = cut ? cut.feather || 0 : 0;
      return FX.layerBitmap(scene, layer, canvas, {
        preview: preview, key: key, assets: sceneAsset(scene), clip: scene._imageClip(layer),
        cut: alpha ? { alpha: alpha, feather: feather } : null,
        cutApply: alpha && H.cutoutApply ? function (c) { return H.cutoutApply(c, mrec, feather * c.width / Math.max(1, layer.w)); } : null,
        outline: cut && cut.outline && H.cutoutOutline ? function (c) { return H.cutoutOutline(c, cut.outline.width * c.width / Math.max(1, layer.w), cut.outline.color); } : null
      });
    });
  };

  /* ---------- Interaction, status, housekeeping ---------- */
  FX.interactive = function (on) {
    if (on === undefined) return S.interactive;
    on = !!on;
    if (on === S.interactive) return on;
    S.interactive = on;
    emit(on ? 'draft' : 'refine');
    return on;
  };
  /* Part of the scene's bitmap cache key: renderer version, context generation, draft state, precision. */
  FX.stamp = function () { return FX.version + '.' + S.epoch + '.' + S.touches + (S.interactive ? 'd' : '') + (S.lost ? 'x' : '') + (S.cfg.eightBit ? '8' : ''); };
  FX.on = function (fn) { if (typeof fn === 'function') S.listeners.push(fn); return function () { var i = S.listeners.indexOf(fn); if (i >= 0) S.listeners.splice(i, 1); }; };
  FX.status = function () {
    var gl = init();
    return {
      available: !!gl, lost: S.lost, float: !!(S.caps && S.caps.float), p3: !!(S.caps && S.caps.p3), maxTexture: S.caps ? S.caps.maxTex : 0, renderer: S.caps ? S.caps.renderer : '',
      memory: { bytes: S.bytes, cacheBytes: S.cacheBytes, budget: budget() }, stats: JSON.parse(JSON.stringify(S.stats)), interactive: S.interactive, warnings: JSON.parse(JSON.stringify(S.warned))
    };
  };
  FX.configure = function (cfg) {
    cfg = cfg || {};
    if (cfg.tile !== undefined) S.cfg.tile = cfg.tile > 0 ? Math.max(64, Math.round(cfg.tile / 64) * 64) : 0;
    if (cfg.budgetMB !== undefined) S.cfg.budgetMB = cfg.budgetMB > 0 ? cfg.budgetMB : 0;
    if (cfg.workMP !== undefined) S.cfg.workMP = cfg.workMP > 0 ? cfg.workMP : 0;
    if (cfg.eightBit !== undefined && !!cfg.eightBit !== S.cfg.eightBit) {
      S.cfg.eightBit = !!cfg.eightBit;
      FX.trim(true);
      if (S.caps && S.gl) { S.gl = null; init(); }
      S.epoch++;
    }
    return { tile: S.cfg.tile, budgetMB: S.cfg.budgetMB, workMP: S.cfg.workMP, eightBit: S.cfg.eightBit };
  };
  /* Frees GPU memory. all: also the programs' textures in use by caches. */
  FX.trim = function (all) {
    if (!S.gl || S.lost) return;
    evictCache(Infinity);
    Object.keys(S.free).forEach(function (k) { S.free[k].forEach(kill); });
    S.free = {};
    if (all) { S.uploads.slice().forEach(kill); S.uploads = []; uploadMap = typeof WeakMap === 'function' ? new WeakMap() : null; }
  };
  FX.profile = function (on) {
    if (on) { S.prof = []; S.profAt = performance.now(); return null; }
    var out = S.prof; S.prof = null; return out;
  };
  /* For tests: lose and restore the context through WEBGL_lose_context. */
  FX._lose = function () { var gl = init(); var x = gl && gl.getExtension('WEBGL_lose_context'); if (x) { S._loseExt = x; x.loseContext(); return true; } return false; };
  FX._restore = function () { if (S._loseExt) { S._loseExt.restoreContext(); return true; } return false; };
})(window);
