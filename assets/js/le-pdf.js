/* LocalEditor PDF engine. Vendored pdf.js, pdf-lib, and fontkit load on first use. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};

  var PAGE_SIZES = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008],
    tabloid: [792, 1224],
    a3: [841.89, 1190.55],
    a5: [419.53, 595.28]
  };

  var openDocs = Object.create(null);
  var docSeq = 1;
  var scriptPromises = Object.create(null);
  var libsReady = null;

  function num(v, d) {
    v = Number(v);
    return isFinite(v) ? v : d;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function roundN(n) {
    if (!isFinite(n)) return '0';
    return String(Math.round(n * 100) / 100);
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function yieldNow() {
    return new Promise(function (resolve) {
      var level = 'high';
      try {
        if (LE.perf && typeof LE.perf.level === 'function') level = LE.perf.level() || 'high';
      } catch (e) { level = 'high'; }
      var wait = level === 'low' ? 24 : level === 'mid' ? 12 : 0;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
          if (wait) setTimeout(resolve, wait);
          else resolve();
        });
      } else {
        setTimeout(resolve, wait || 0);
      }
    });
  }

  function asset(path) {
    var root = '';
    try { root = document.documentElement.getAttribute('data-root') || ''; } catch (e) { root = ''; }
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root + String(path || '').replace(/^\//, '');
  }

  function loadScript(src) {
    var ext = LE.lazy;
    if (typeof ext === 'function' && !ext._lePdf) return ext(src);
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = new Promise(function (resolve, reject) {
      var sel = 'script[data-le-src="' + src.replace(/"/g, '') + '"]';
      var existing = document.querySelector(sel);
      if (existing && existing.getAttribute('data-le-done') === '1') { resolve(); return; }
      var s = existing || document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-le-src', src);
      s.onload = function () { s.setAttribute('data-le-done', '1'); resolve(); };
      s.onerror = function () { delete scriptPromises[src]; if (s.parentNode) s.parentNode.removeChild(s); reject(new Error('Could not load ' + src)); };
      if (!existing) document.head.appendChild(s);
    });
    return scriptPromises[src];
  }

  if (typeof LE.lazy !== 'function') {
    LE.lazy = function (src) { return loadScript(src); };
    LE.lazy._lePdf = true;
  }

  function ready() {
    if (libsReady) return libsReady;
    libsReady = (async function () {
      var jobs = [];
      if (!global.pdfjsLib) jobs.push(loadScript(asset('assets/vendor/pdf.min.js')));
      if (!global.PDFLib) jobs.push(loadScript(asset('assets/vendor/pdf-lib.min.js')));
      if (!global.fontkit) jobs.push(loadScript(asset('assets/vendor/fontkit.umd.min.js')));
      await Promise.all(jobs);
      if (!global.pdfjsLib || !global.PDFLib) throw new Error('PDF libraries failed to load');
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = asset('assets/vendor/pdf.worker.min.js');
    })();
    libsReady = libsReady.catch(function (err) { libsReady = null; throw err; });
    return libsReady;
  }

  function perfScaleCap() {
    try {
      if (LE.perf && typeof LE.perf.pdfScale === 'function') return LE.perf.pdfScale() || 1;
    } catch (e) {}
    return Math.min((global.devicePixelRatio || 1), 2);
  }

  function capScale(scale) {
    var max = perfScaleCap();
    if (!scale || scale <= 0) return max;
    return Math.min(scale, max);
  }

  function pixelCap() {
    var level = 'high';
    try {
      if (LE.perf && typeof LE.perf.level === 'function') level = LE.perf.level() || 'high';
    } catch (e) {}
    if (level === 'low') return 1800;
    if (level === 'mid') return 2800;
    return 4500;
  }

  function pixelArea() {
    var level = 'high';
    try {
      if (LE.perf && typeof LE.perf.level === 'function') level = LE.perf.level() || 'high';
    } catch (e) {}
    if (level === 'low') return 2500000;
    if (level === 'mid') return 6000000;
    return 12000000;
  }

  function ownCopy(target) {
    target = target || Object.create(null);
    for (var a = 1; a < arguments.length; a++) {
      var src = arguments[a];
      if (!src || typeof src !== 'object') continue;
      var keys = Object.keys(src);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        target[key] = src[key];
      }
    }
    return target;
  }

  function readBytes(input) {
    if (input == null) return Promise.reject(new Error('No PDF data'));
    if (input instanceof Uint8Array) return Promise.resolve(input.slice(0));
    if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input.slice(0)));
    if (ArrayBuffer.isView(input)) {
      return Promise.resolve(new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)));
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return input.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return Promise.reject(new Error('Expected a PDF file or bytes'));
  }

  function passwordError(reason) {
    var err = new Error(reason === 'incorrect' ? 'Incorrect password' : 'Password required');
    err.code = 'password';
    err.reason = reason || 'required';
    return err;
  }

  function asPasswordError(e) {
    if (!e) return null;
    var name = String(e.name || '');
    var msg = String(e.message || '');
    if (name === 'PasswordException' || e.code === 1 || e.code === 2) {
      if (name === 'PasswordException' || /password/i.test(msg)) {
        return passwordError(e.code === 2 ? 'incorrect' : 'required');
      }
    }
    if (/password/i.test(msg) && /incorrect|required|need|encrypt/i.test(msg + name)) {
      return passwordError(/incorrect/i.test(msg) ? 'incorrect' : 'required');
    }
    return null;
  }

  function isEncryptedError(e) {
    return !!(e && /encrypt/i.test(String(e.message || '')));
  }

  function normAngle(angle) {
    var a = Number(angle) || 0;
    a = a % 360;
    if (a < 0) a += 360;
    return a;
  }

  function norm90(angle) {
    return normAngle(Math.round((Number(angle) || 0) / 90) * 90);
  }

  function unitInterval(v, d) {
    if (v == null || v === '') return d;
    var n = Number(v);
    if (!isFinite(n)) return d;
    if (n > 1) n = n / 100;
    return clamp(n, 0, 1);
  }

  function parseColor(input) {
    var PDFLib = global.PDFLib;
    if (!input && input !== 0) return PDFLib.rgb(0, 0, 0);
    if (typeof input === 'object' && input.type && input.red != null) return input;
    if (typeof input === 'object' && input.r != null) {
      return PDFLib.rgb(clamp(input.r, 0, 1), clamp(input.g, 0, 1), clamp(input.b, 0, 1));
    }
    var hex = String(input).trim();
    var m = hex.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) return PDFLib.rgb(clamp(+m[1], 0, 255) / 255, clamp(+m[2], 0, 255) / 255, clamp(+m[3], 0, 255) / 255);
    if (hex.charAt(0) === '#') hex = hex.slice(1);
    if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    var n = parseInt(hex.slice(0, 6), 16);
    if (!isFinite(n)) n = 0;
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function hexToRgb(hex) {
    hex = String(hex || '#111111').replace('#', '');
    if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    var n = parseInt(hex.slice(0, 6), 16);
    if (!isFinite(n)) n = 0x111111;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function blendMode(name) {
    if (!name || name === 'normal') return undefined;
    var map = {
      multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
      'color-dodge': 'ColorDodge', colorDodge: 'ColorDodge', 'color-burn': 'ColorBurn', colorBurn: 'ColorBurn',
      'hard-light': 'HardLight', hardLight: 'HardLight', 'soft-light': 'SoftLight', softLight: 'SoftLight',
      difference: 'Difference', exclusion: 'Exclusion'
    };
    var key = map[String(name)] || map[String(name).toLowerCase()];
    if (!key || !global.PDFLib.BlendMode) return undefined;
    return global.PDFLib.BlendMode[key] || key;
  }

  function cropOf(page) {
    var box = page.getCropBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  function viewportOf(viewBox, rotation) {
    var r = (viewBox[2] + viewBox[0]) / 2;
    var o = (viewBox[3] + viewBox[1]) / 2;
    rotation = norm90(rotation);
    var l, h, c, d;
    if (rotation === 180) { l = -1; h = 0; c = 0; d = 1; }
    else if (rotation === 90) { l = 0; h = 1; c = 1; d = 0; }
    else if (rotation === 270) { l = 0; h = -1; c = -1; d = 0; }
    else { l = 1; h = 0; c = 0; d = -1; }
    var u, p, g, m;
    if (l === 0) {
      u = Math.abs(o - viewBox[1]);
      p = Math.abs(r - viewBox[0]);
      g = viewBox[3] - viewBox[1];
      m = viewBox[2] - viewBox[0];
    } else {
      u = Math.abs(r - viewBox[0]);
      p = Math.abs(o - viewBox[1]);
      g = viewBox[2] - viewBox[0];
      m = viewBox[3] - viewBox[1];
    }
    return {
      transform: [l, h, c, d, u - l * r - c * o, p - h * r - d * o],
      width: g,
      height: m
    };
  }

  function applyInverse(pt, m) {
    var det = m[0] * m[3] - m[1] * m[2];
    return [
      (pt[0] * m[3] - pt[1] * m[2] + m[2] * m[5] - m[4] * m[3]) / det,
      (-pt[0] * m[1] + pt[1] * m[0] + m[4] * m[1] - m[5] * m[0]) / det
    ];
  }

  function visualToPdf(vx, vy, crop, rotation) {
    var viewBox = [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height];
    var vp = viewportOf(viewBox, rotation);
    var p = applyInverse([vx, vy], vp.transform);
    return { x: p[0], y: p[1] };
  }

  function visualSize(crop, rotation) {
    rotation = norm90(rotation);
    if (rotation === 90 || rotation === 270) return { width: crop.height, height: crop.width };
    return { width: crop.width, height: crop.height };
  }

  function makePainter(page) {
    var crop = cropOf(page);
    var rotation = norm90(page.getRotation().angle || 0);
    var vis = visualSize(crop, rotation);
    return {
      page: page,
      crop: crop,
      rotation: rotation,
      visW: vis.width,
      visH: vis.height,
      pt: function (vx, vy) { return visualToPdf(vx, vy, crop, rotation); }
    };
  }

  function placement(rotation, cropW, cropH) {
    rotation = norm90(rotation);
    if (rotation === 90) return { x: 0, y: cropW, rotate: -90 };
    if (rotation === 180) return { x: cropW, y: cropH, rotate: 180 };
    if (rotation === 270) return { x: cropH, y: 0, rotate: 90 };
    return { x: 0, y: 0, rotate: 0 };
  }

  function rotatePoint(px, py, cx, cy, deg) {
    var rad = (Number(deg) || 0) * Math.PI / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var dx = px - cx;
    var dy = py - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  function arcBeziers(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
    var curves = [];
    if (!(rx && ry) || (x1 === x2 && y1 === y2)) return curves;
    var phi = (angle || 0) * Math.PI / 180;
    var cos = Math.cos(phi), sin = Math.sin(phi);
    rx = Math.abs(rx); ry = Math.abs(ry);
    var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    var x1p = cos * dx + sin * dy;
    var y1p = -sin * dx + cos * dy;
    var lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { var s = Math.sqrt(lam); rx *= s; ry *= s; }
    var sign = ((large ? 1 : 0) === (sweep ? 1 : 0)) ? -1 : 1;
    var nume = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    var coef = sign * Math.sqrt(Math.max(0, nume / (den || 1)));
    var cxp = coef * (rx * y1p / ry);
    var cyp = coef * (-ry * x1p / rx);
    var cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    var cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    function ang(ux, uy, vx, vy) {
      var dot = ux * vx + uy * vy;
      var len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
      var a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    }
    var theta = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dtheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dtheta > 0) dtheta -= Math.PI * 2;
    if (sweep && dtheta < 0) dtheta += Math.PI * 2;
    var segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
    var delta = dtheta / segs;
    var tan = Math.tan(delta / 4) * 4 / 3;
    for (var i = 0; i < segs; i++) {
      var a1 = theta + i * delta;
      var a2 = a1 + delta;
      var c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
      var e1x = cx + rx * cos * c1 - ry * sin * s1;
      var e1y = cy + rx * sin * c1 + ry * cos * s1;
      var e2x = cx + rx * cos * c2 - ry * sin * s2;
      var e2y = cy + rx * sin * c2 + ry * cos * s2;
      var d1x = -rx * cos * s1 - ry * sin * c1;
      var d1y = -rx * sin * s1 + ry * cos * c1;
      var d2x = -rx * cos * s2 - ry * sin * c2;
      var d2y = -rx * sin * s2 + ry * cos * c2;
      curves.push([e1x + d1x * tan, e1y + d1y * tan, e2x - d2x * tan, e2y - d2y * tan, e2x, e2y]);
    }
    return curves;
  }

  function mapAbsPath(d, fn) {
    var tokens = String(d || '').match(/[MmLlHhVvCcQqAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
    if (!tokens) return '';
    var i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, out = [];
    function read() { var n = parseFloat(tokens[i++]); return isFinite(n) ? n : 0; }
    function isCmd(t) { return t && /^[MmLlHhVvCcQqAaZz]$/.test(t); }
    function emit(c, pts) {
      var mapped = [];
      for (var k = 0; k < pts.length; k += 2) {
        var p = fn(pts[k], pts[k + 1]);
        mapped.push(roundN(p.x), roundN(p.y));
      }
      out.push(c);
      Array.prototype.push.apply(out, mapped);
    }
    while (i < tokens.length) {
      var t = tokens[i];
      if (isCmd(t)) { cmd = t; i++; }
      else if (!cmd) break;
      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();
      if (C === 'Z') { out.push('Z'); cx = sx; cy = sy; cmd = ''; continue; }
      if (C === 'M') {
        var mx = read(), my = read();
        if (rel) { mx += cx; my += cy; }
        emit('M', [mx, my]);
        cx = sx = mx; cy = sy = my;
        cmd = rel ? 'l' : 'L';
        continue;
      }
      if (C === 'L') {
        var lx = read(), ly = read();
        if (rel) { lx += cx; ly += cy; }
        emit('L', [lx, ly]); cx = lx; cy = ly; continue;
      }
      if (C === 'H') {
        var hx = read(); if (rel) hx += cx;
        emit('L', [hx, cy]); cx = hx; continue;
      }
      if (C === 'V') {
        var vy = read(); if (rel) vy += cy;
        emit('L', [cx, vy]); cy = vy; continue;
      }
      if (C === 'C') {
        var x1 = read(), y1 = read(), x2 = read(), y2 = read(), x = read(), y = read();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        emit('C', [x1, y1, x2, y2, x, y]); cx = x; cy = y; continue;
      }
      if (C === 'Q') {
        var qx = read(), qy = read(), xq = read(), yq = read();
        if (rel) { qx += cx; qy += cy; xq += cx; yq += cy; }
        emit('C', [cx + (qx - cx) * 2 / 3, cy + (qy - cy) * 2 / 3, xq + (qx - xq) * 2 / 3, yq + (qy - yq) * 2 / 3, xq, yq]);
        cx = xq; cy = yq; continue;
      }
      if (C === 'A') {
        var rx = read(), ry = read(), ang = read(), large = read(), sweep = read(), ax = read(), ay = read();
        if (rel) { ax += cx; ay += cy; }
        var curves = arcBeziers(cx, cy, rx, ry, ang, large, sweep, ax, ay);
        for (var c = 0; c < curves.length; c++) emit('C', curves[c]);
        if (!curves.length) emit('L', [ax, ay]);
        cx = ax; cy = ay; continue;
      }
      break;
    }
    return out.join(' ');
  }

  function catalogPath(id, w, h, params) {
    var name = String(id || 'rectangle').toLowerCase().replace(/[\s_]+/g, '-');
    var alias = { rect: 'rectangle', 'rounded-rect': 'rounded-rectangle', roundrect: 'rounded-rectangle', circle: 'ellipse', oval: 'ellipse', speech: 'speech-round' };
    var key = alias[name] || name;
    var list = (global.LE && LE.assets && typeof LE.assets.shapes === 'function') ? LE.assets.shapes() : null;
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        var hit = list[i];
        if (!hit || (hit.id !== key && hit.id !== name)) continue;
        if (typeof hit.path !== 'function' || String(hit.fillRule || '').toLowerCase() === 'evenodd') break;
        try {
          var d = hit.path(w, h, params || {});
          if (typeof d === 'string' && d) return d;
        } catch (e) {}
        break;
      }
    }
    return shapePath(id, w, h, params);
  }

  function polyPath(pts, close) {
    if (!pts.length) return '';
    var d = 'M ' + roundN(pts[0][0]) + ' ' + roundN(pts[0][1]);
    for (var i = 1; i < pts.length; i++) d += ' L ' + roundN(pts[i][0]) + ' ' + roundN(pts[i][1]);
    if (close) d += ' Z';
    return d;
  }

  function ellipsePath(w, h) {
    var rx = w / 2;
    var ry = h / 2;
    var cx = rx;
    var cy = ry;
    var k = 0.5522847498;
    var kx = rx * k;
    var ky = ry * k;
    return [
      'M', roundN(cx), roundN(0),
      'C', roundN(cx + kx), roundN(0), roundN(w), roundN(cy - ky), roundN(w), roundN(cy),
      'C', roundN(w), roundN(cy + ky), roundN(cx + kx), roundN(h), roundN(cx), roundN(h),
      'C', roundN(cx - kx), roundN(h), roundN(0), roundN(cy + ky), roundN(0), roundN(cy),
      'C', roundN(0), roundN(cy - ky), roundN(cx - kx), roundN(0), roundN(cx), roundN(0),
      'Z'
    ].join(' ');
  }

  function roundRectPath(w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (r < 0.5) return polyPath([[0, 0], [w, 0], [w, h], [0, h]], true);
    var k = r * 0.5522847498;
    return [
      'M', roundN(r), 0,
      'L', roundN(w - r), 0,
      'C', roundN(w - r + k), 0, roundN(w), roundN(r - k), roundN(w), roundN(r),
      'L', roundN(w), roundN(h - r),
      'C', roundN(w), roundN(h - r + k), roundN(w - r + k), roundN(h), roundN(w - r), roundN(h),
      'L', roundN(r), roundN(h),
      'C', roundN(r - k), roundN(h), 0, roundN(h - r + k), 0, roundN(h - r),
      'L', 0, roundN(r),
      'C', 0, roundN(r - k), roundN(r - k), 0, roundN(r), 0,
      'Z'
    ].join(' ');
  }

  function regularPath(n, w, h) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      pts.push([w / 2 + Math.cos(a) * w / 2 * 0.96, h / 2 + Math.sin(a) * h / 2 * 0.96]);
    }
    return polyPath(pts, true);
  }

  function starPath(points, w, h, inner) {
    var n = Math.max(3, points || 5);
    inner = inner == null ? 0.5 : inner;
    var pts = [];
    for (var i = 0; i < n * 2; i++) {
      var a = -Math.PI / 2 + i * Math.PI / n;
      var rad = i % 2 ? inner : 1;
      pts.push([w / 2 + Math.cos(a) * w / 2 * rad * 0.98, h / 2 + Math.sin(a) * h / 2 * rad * 0.98]);
    }
    return polyPath(pts, true);
  }

  function shapePath(shape, w, h, params) {
    params = params || {};
    var id = String(shape || 'rectangle').toLowerCase().replace(/[\s_]+/g, '-');
    var r = num(params.radius != null ? params.radius : params.r, Math.min(w, h) * 0.15);
    if (id === 'ellipse' || id === 'circle' || id === 'oval') return ellipsePath(w, h);
    if (id === 'rounded-rectangle' || id === 'roundrect' || id === 'rounded-rect' || id === 'rect-rounded') return roundRectPath(w, h, r);
    if (id === 'triangle') return regularPath(3, w, h);
    if (id === 'right-triangle') return polyPath([[0, h], [w, h], [0, 0]], true);
    if (id === 'diamond' || id === 'rhombus') return polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], true);
    if (id === 'pentagon') return regularPath(5, w, h);
    if (id === 'hexagon') return regularPath(6, w, h);
    if (id === 'octagon') return regularPath(8, w, h);
    if (id === 'star' || id === 'burst') {
      var pts = params.points || params.n || (id === 'burst' ? 12 : 5);
      var inner = params.innerRatio != null ? params.innerRatio : (id === 'burst' ? 0.72 : 0.5);
      return starPath(pts, w, h, inner);
    }
    if (id === 'heart') {
      return [
        'M', roundN(w / 2), roundN(h * 0.32),
        'C', roundN(w / 2), roundN(h * 0.12), roundN(w * 0.18), 0, roundN(w * 0.18), roundN(h * 0.28),
        'C', roundN(w * 0.18), roundN(h * 0.52), roundN(w / 2), roundN(h * 0.62), roundN(w / 2), roundN(h * 0.92),
        'C', roundN(w / 2), roundN(h * 0.62), roundN(w * 0.82), roundN(h * 0.52), roundN(w * 0.82), roundN(h * 0.28),
        'C', roundN(w * 0.82), 0, roundN(w / 2), roundN(h * 0.12), roundN(w / 2), roundN(h * 0.32),
        'Z'
      ].join(' ');
    }
    if (id === 'cloud') {
      return [
        'M', roundN(w * 0.22), roundN(h * 0.62),
        'C', roundN(w * 0.05), roundN(h * 0.62), roundN(w * 0.02), roundN(h * 0.38), roundN(w * 0.2), roundN(h * 0.34),
        'C', roundN(w * 0.22), roundN(h * 0.16), roundN(w * 0.42), roundN(h * 0.1), roundN(w * 0.5), roundN(h * 0.28),
        'C', roundN(w * 0.62), roundN(h * 0.12), roundN(w * 0.86), roundN(h * 0.18), roundN(w * 0.84), roundN(h * 0.4),
        'C', roundN(w * 0.98), roundN(h * 0.46), roundN(w * 0.96), roundN(h * 0.7), roundN(w * 0.74), roundN(h * 0.7),
        'L', roundN(w * 0.22), roundN(h * 0.68),
        'Z'
      ].join(' ');
    }
    if (id === 'speech' || id === 'speech-bubble' || id === 'speech-round' || id === 'speech-square') {
      var body = h * 0.78;
      if (id === 'speech-square') {
        return polyPath([
          [0, 0], [w, 0], [w, body], [w * 0.42, body], [w * 0.28, h], [w * 0.34, body], [0, body]
        ], true);
      }
      return roundRectPath(w, body, Math.min(w, body) * 0.2) + ' ' + polyPath([
        [w * 0.28, body], [w * 0.18, h], [w * 0.46, body]
      ], true);
    }
    if (id === 'arrow' || id === 'arrow-right') {
      var mid = h / 2;
      var head = w * 0.62;
      var t = h * 0.28;
      return polyPath([
        [0, mid - t], [head, mid - t], [head, mid - h * 0.42], [w, mid], [head, mid + h * 0.42], [head, mid + t], [0, mid + t]
      ], true);
    }
    if (id === 'arrow-double') {
      var mid2 = h / 2;
      var t2 = h * 0.22;
      return polyPath([
        [0, mid2], [w * 0.22, mid2 - h * 0.42], [w * 0.22, mid2 - t2], [w * 0.78, mid2 - t2], [w * 0.78, mid2 - h * 0.42],
        [w, mid2], [w * 0.78, mid2 + h * 0.42], [w * 0.78, mid2 + t2], [w * 0.22, mid2 + t2], [w * 0.22, mid2 + h * 0.42]
      ], true);
    }
    if (id === 'chevron') return polyPath([[0, 0], [w * 0.72, 0], [w, h / 2], [w * 0.72, h], [0, h], [w * 0.28, h / 2]], true);
    if (id === 'plus' || id === 'cross') {
      var t3 = Math.min(w, h) * (id === 'cross' ? 0.18 : 0.32);
      var x0 = (w - t3) / 2;
      var y0 = (h - t3) / 2;
      if (id === 'cross') {
        return polyPath([[x0, 0], [x0 + t3, 0], [x0 + t3, h], [x0, h]], true) + ' ' +
          polyPath([[0, y0], [w, y0], [w, y0 + t3], [0, y0 + t3]], true);
      }
      return polyPath([
        [x0, 0], [x0 + t3, 0], [x0 + t3, y0], [w, y0], [w, y0 + t3], [x0 + t3, y0 + t3],
        [x0 + t3, h], [x0, h], [x0, y0 + t3], [0, y0 + t3], [0, y0], [x0, y0]
      ], true);
    }
    if (id === 'ring') {
      var outer = ellipsePath(w, h);
      var inset = num(params.innerRatio, 0.62);
      var iw = w * inset;
      var ih = h * inset;
      var inner = mapAbsPath(ellipsePath(iw, ih), function (x, y) {
        return { x: x + (w - iw) / 2, y: y + (h - ih) / 2 };
      });
      return outer + ' ' + inner;
    }
    if (id === 'half-circle' || id === 'halfcircle') {
      return [
        'M', 0, roundN(h),
        'C', 0, roundN(h * 0.45), roundN(w * 0.22), 0, roundN(w / 2), 0,
        'C', roundN(w * 0.78), 0, roundN(w), roundN(h * 0.45), roundN(w), roundN(h),
        'Z'
      ].join(' ');
    }
    if (id === 'arc') {
      return [
        'M', roundN(w * 0.08), roundN(h * 0.85),
        'C', roundN(w * 0.1), roundN(h * 0.2), roundN(w * 0.9), roundN(h * 0.2), roundN(w * 0.92), roundN(h * 0.85)
      ].join(' ');
    }
    if (id === 'parallelogram') return polyPath([[w * 0.22, 0], [w, 0], [w * 0.78, h], [0, h]], true);
    if (id === 'trapezoid') return polyPath([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]], true);
    if (id === 'cylinder') {
      return ellipsePath(w, h * 0.28) + ' ' + polyPath([[0, h * 0.14], [0, h * 0.86], [w, h * 0.86], [w, h * 0.14]], true) + ' ' +
        mapAbsPath(ellipsePath(w, h * 0.28), function (x, y) { return { x: x, y: y + h * 0.72 }; });
    }
    if (id === 'blob' || id === 'blob-2') {
      return [
        'M', roundN(w * 0.5), roundN(h * 0.05),
        'C', roundN(w * 0.85), roundN(h * 0.02), roundN(w * 0.98), roundN(h * 0.4), roundN(w * 0.78), roundN(h * 0.62),
        'C', roundN(w * 0.98), roundN(h * 0.9), roundN(w * 0.55), roundN(h), roundN(w * 0.32), roundN(h * 0.78),
        'C', roundN(w * 0.02), roundN(h * 0.85), 0, roundN(h * 0.4), roundN(w * 0.28), roundN(h * 0.28),
        'C', roundN(w * 0.18), roundN(h * 0.05), roundN(w * 0.35), roundN(h * 0.08), roundN(w * 0.5), roundN(h * 0.05),
        'Z'
      ].join(' ');
    }
    if (id === 'line' || id === 'dashed-line' || id === 'line-arrow' || id === 'arrow-line') {
      var y = h / 2;
      var end = id === 'line-arrow' || id === 'arrow-line' ? w * 0.82 : w;
      var d = 'M 0 ' + roundN(y) + ' L ' + roundN(end) + ' ' + roundN(y);
      if (id === 'line-arrow' || id === 'arrow-line') {
        d += ' M ' + roundN(w) + ' ' + roundN(y) + ' L ' + roundN(w * 0.78) + ' ' + roundN(y - h * 0.35) +
          ' M ' + roundN(w) + ' ' + roundN(y) + ' L ' + roundN(w * 0.78) + ' ' + roundN(y + h * 0.35);
      }
      return d;
    }
    return polyPath([[0, 0], [w, 0], [w, h], [0, h]], true);
  }

  function dataUrlToBytes(url) {
    var i = String(url).indexOf(',');
    var meta = url.slice(0, i);
    var data = url.slice(i + 1);
    if (/;base64/i.test(meta)) {
      var bin = atob(data);
      var out = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(data));
  }

  function sniffImage(bytes) {
    if (!bytes || bytes.length < 4) return '';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    return '';
  }

  function canvasToBytes(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      var type = mime || 'image/png';
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('Could not encode image')); return; }
          blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
        }, type, quality == null ? 0.92 : quality);
        return;
      }
      try { resolve(dataUrlToBytes(canvas.toDataURL(type, quality == null ? 0.92 : quality))); }
      catch (e) { reject(e); }
    });
  }

  function jpegCanvas(canvas, quality) {
    var c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
    return canvasToBytes(c, 'image/jpeg', quality);
  }

  function loadHtmlImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not read image')); };
      img.src = src;
    });
  }

  async function rasterAny(source) {
    if (!source) return null;
    if (source instanceof HTMLCanvasElement) return source;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
      var c = document.createElement('canvas');
      c.width = source.width;
      c.height = source.height;
      c.getContext('2d').drawImage(source, 0, 0);
      return c;
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      var ic = document.createElement('canvas');
      ic.width = source.naturalWidth || source.width;
      ic.height = source.naturalHeight || source.height;
      ic.getContext('2d').drawImage(source, 0, 0);
      return ic;
    }
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      var url = URL.createObjectURL(source);
      try {
        var img = await loadHtmlImage(url);
        var bc = document.createElement('canvas');
        bc.width = img.naturalWidth || img.width;
        bc.height = img.naturalHeight || img.height;
        bc.getContext('2d').drawImage(img, 0, 0);
        return bc;
      } finally { URL.revokeObjectURL(url); }
    }
    if (typeof source === 'string' && (source.indexOf('data:') === 0 || source.indexOf('blob:') === 0)) {
      var dimg = await loadHtmlImage(source);
      var dc = document.createElement('canvas');
      dc.width = dimg.naturalWidth || dimg.width;
      dc.height = dimg.naturalHeight || dimg.height;
      dc.getContext('2d').drawImage(dimg, 0, 0);
      return dc;
    }
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      var bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
      var kind = sniffImage(bytes);
      var mime = kind === 'jpeg' ? 'image/jpeg' : 'image/png';
      var blob = new Blob([bytes], { type: mime });
      return rasterAny(blob);
    }
    if (source.bytes || source.png || source.jpeg || source.dataURL || source.dataUrl || source.canvas) {
      return rasterAny(source.canvas || source.dataURL || source.dataUrl || source.bytes || source.png || source.jpeg);
    }
    return null;
  }

  async function embedImageSource(doc, source) {
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      var bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
      var kind = sniffImage(bytes);
      if (kind === 'jpeg') return doc.embedJpg(bytes);
      if (kind === 'png') return doc.embedPng(bytes);
    }
    if (typeof source === 'string' && source.indexOf('data:image/jpeg') === 0) return doc.embedJpg(dataUrlToBytes(source));
    if (typeof source === 'string' && source.indexOf('data:image/png') === 0) return doc.embedPng(dataUrlToBytes(source));
    var canvas = await rasterAny(source);
    if (!canvas) throw new Error('Could not read image');
    var png = await canvasToBytes(canvas, 'image/png');
    return doc.embedPng(png);
  }

  function standardFontName(family, weight, italic) {
    var f = String(family || '').toLowerCase();
    var bold = num(weight, 400) >= 600;
    var ital = !!italic || /italic|oblique/.test(f);
    if (/courier|mono|code|consolas|source code/.test(f)) {
      if (bold && ital) return 'CourierBoldOblique';
      if (bold) return 'CourierBold';
      if (ital) return 'CourierOblique';
      return 'Courier';
    }
    if (/times|serif|georgia|garamond|merriweather|instrument/.test(f)) {
      if (bold && ital) return 'TimesRomanBoldItalic';
      if (bold) return 'TimesRomanBold';
      if (ital) return 'TimesRomanItalic';
      return 'TimesRoman';
    }
    if (bold && ital) return 'HelveticaBoldOblique';
    if (bold) return 'HelveticaBold';
    if (ital) return 'HelveticaOblique';
    return 'Helvetica';
  }

  /* Font files for fontkit. Two faults in the vendored @pdf-lib/fontkit 1.1.1 broke custom fonts:
     1. Its WOFF reader fails on several library faces ("Trying to access beyond buffer length"), so the WOFF is unwrapped
        to a plain TrueType/OpenType file first (tables inflated with DecompressionStream).
     2. Its subsetter copies each glyph's bytes and then writes the short (2-byte) loca format, which stores offset / 2.
        Faces that ship the long loca format may have odd-length glyphs (Inter, EB Garamond, Lobster, Caveat...), so every
        offset after the first odd glyph is rounded down and the glyphs that follow are cut or empty. Padding each glyph to
        an even length before subsetting keeps every offset exact. */
  async function inflateZlib(u8) {
    if (typeof DecompressionStream !== 'function') throw new Error('No DecompressionStream');
    var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function sfntTables(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var count = dv.getUint16(4);
    var out = [];
    for (var i = 0; i < count; i++) {
      var o = 12 + i * 16;
      out.push({ tag: dv.getUint32(o), sum: dv.getUint32(o + 4), data: u8.subarray(dv.getUint32(o + 8), dv.getUint32(o + 8) + dv.getUint32(o + 12)) });
    }
    return { flavor: dv.getUint32(0), tables: out };
  }
  function writeSfnt(flavor, tables) {
    var n = tables.length, es = 1, lg = 0;
    while (es * 2 <= n) { es *= 2; lg++; }
    var size = 12 + 16 * n;
    tables.forEach(function (t) { size += (t.data.length + 3) & ~3; });
    var out = new Uint8Array(size);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, flavor); dv.setUint16(4, n); dv.setUint16(6, es * 16); dv.setUint16(8, lg); dv.setUint16(10, n * 16 - es * 16);
    var at = 12 + 16 * n;
    tables.forEach(function (t, i) {
      var o = 12 + i * 16;
      dv.setUint32(o, t.tag); dv.setUint32(o + 4, t.sum >>> 0); dv.setUint32(o + 8, at); dv.setUint32(o + 12, t.data.length);
      out.set(t.data, at);
      at += (t.data.length + 3) & ~3;
    });
    return out;
  }
  function tagOf(s) { return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0; }
  function evenGlyphs(flavor, tables) {
    var find = function (s) { var t = tagOf(s); return tables.filter(function (x) { return x.tag === t; })[0]; };
    var head = find('head'), loca = find('loca'), glyf = find('glyf'), maxp = find('maxp');
    if (!head || !loca || !glyf || !maxp) return null;
    var hv = new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength);
    var longFmt = hv.getInt16(50) === 1;
    var glyphs = new DataView(maxp.data.buffer, maxp.data.byteOffset, maxp.data.byteLength).getUint16(4);
    var lv = new DataView(loca.data.buffer, loca.data.byteOffset, loca.data.byteLength);
    var offs = [];
    for (var i = 0; i <= glyphs; i++) offs.push(longFmt ? lv.getUint32(i * 4) : lv.getUint16(i * 2) * 2);
    var odd = false;
    for (i = 0; i < glyphs; i++) if ((offs[i + 1] - offs[i]) % 2) { odd = true; break; }
    if (!odd) return null;
    var total = 0;
    for (i = 0; i < glyphs; i++) total += (offs[i + 1] - offs[i] + 1) & ~1;
    var g2 = new Uint8Array(total), l2 = new Uint8Array((glyphs + 1) * 4), l2v = new DataView(l2.buffer), at = 0;
    for (i = 0; i < glyphs; i++) {
      l2v.setUint32(i * 4, at);
      g2.set(glyf.data.subarray(offs[i], offs[i + 1]), at);
      at += (offs[i + 1] - offs[i] + 1) & ~1;
    }
    l2v.setUint32(glyphs * 4, at);
    var h2 = head.data.slice(0);
    new DataView(h2.buffer).setInt16(50, 1);
    return tables.map(function (t) {
      if (t === glyf) return { tag: t.tag, sum: 0, data: g2 };
      if (t === loca) return { tag: t.tag, sum: 0, data: l2 };
      if (t === head) return { tag: t.tag, sum: t.sum, data: h2 };
      return t;
    });
  }
  async function fontFileForPdf(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (u8.length < 12) return u8;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var flavor, tables;
    if (dv.getUint32(0) === 0x774F4646) { /* 'wOFF' */
      flavor = dv.getUint32(4);
      tables = [];
      for (var i = 0, n = dv.getUint16(12); i < n; i++) {
        var o = 44 + i * 20, off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
        var data = u8.subarray(off, off + comp);
        if (comp < len) data = await inflateZlib(data);
        tables.push({ tag: dv.getUint32(o), sum: dv.getUint32(o + 16), data: data });
      }
    } else {
      var parsed = sfntTables(u8);
      flavor = parsed.flavor;
      tables = parsed.tables;
    }
    var even = evenGlyphs(flavor, tables);
    if (even) tables = even;
    else if (dv.getUint32(0) !== 0x774F4646) return u8;
    return writeSfnt(flavor, tables);
  }

  async function embedFont(doc, family, weight, italic, report) {
    var cache = doc.__leFonts || (doc.__leFonts = {});
    var key = String(family || 'Helvetica') + '/' + (weight || 400) + '/' + (italic ? 'i' : 'n');
    if (cache[key]) return cache[key];
    var builtIn = !family || /^(helvetica|arial|sans-serif|times|times new roman|serif|courier|courier new|monospace)$/i.test(String(family).trim());
    if (!builtIn && LE.fonts && typeof LE.fonts.bytes === 'function') {
      try {
        var buf = await LE.fonts.bytes(family, weight || 400, !!italic);
        if (buf && (buf.byteLength || buf.length)) {
          if (!doc.__leFontkit) {
            await ready();
            if (!global.fontkit) throw new Error('fontkit unavailable');
            doc.registerFontkit(global.fontkit);
            doc.__leFontkit = true;
          }
          var bytes = await fontFileForPdf(buf);
          try {
            cache[key] = await doc.embedFont(bytes, { subset: true });
          } catch (e1) {
            cache[key] = await doc.embedFont(bytes);
          }
          return cache[key];
        }
      } catch (e) {
        if (report && !report._fontWarn) {
          report._fontWarn = true;
          report.warnings.push('A custom font could not be embedded. Standard fonts were used for that text.');
        }
      }
    }
    var name = standardFontName(family, weight, italic);
    cache[key] = await doc.embedFont(global.PDFLib.StandardFonts[name]);
    return cache[key];
  }

  function measureText(font, text, size, spacing) {
    var w = 0;
    try { w = font.widthOfTextAtSize(text || '', size); }
    catch (e) { w = String(text || '').length * size * 0.5; }
    if (spacing && text && text.length > 1) w += spacing * (text.length - 1);
    return w;
  }

  function wrapText(font, text, size, maxWidth, spacing) {
    var src = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var paragraphs = src.split('\n');
    var lines = [];
    function widthOf(value) { return measureText(font, value, size, spacing); }
    function breakWord(word) {
      var buf = '';
      for (var i = 0; i < word.length; i++) {
        var next = buf + word.charAt(i);
        if (buf && widthOf(next) > maxWidth) {
          lines.push(buf);
          buf = word.charAt(i);
        } else buf = next;
      }
      return buf;
    }
    paragraphs.forEach(function (para) {
      if (!para) { lines.push(''); return; }
      var words = para.split(/(\s+)/);
      var line = '';
      words.forEach(function (word) {
        if (!word) return;
        if (!word.trim()) {
          if (line && widthOf(line + word) <= maxWidth) line += word;
          return;
        }
        if (line && widthOf(line + word) > maxWidth) {
          lines.push(line.replace(/\s+$/, ''));
          line = '';
        }
        if (!line && widthOf(word) > maxWidth) line = breakWord(word);
        else line += word;
      });
      lines.push(line.replace(/\s+$/, ''));
    });
    return lines.length ? lines : [''];
  }

  function drawTextRaw(page, text, opts, spacing, report) {
    function attempt(value) {
      if (spacing) page.pushOperators(global.PDFLib.setCharacterSpacing(spacing));
      try { page.drawText(value, opts); }
      finally { if (spacing) page.pushOperators(global.PDFLib.setCharacterSpacing(0)); }
    }
    try { attempt(text); }
    catch (e) {
      if (!/encode|WinAnsi|character/i.test(String(e && e.message))) throw e;
      attempt(String(text).replace(/[^\x20-\x7e]/g, '?'));
      if (report && !report._encodeWarn) {
        report._encodeWarn = true;
        report.warnings.push('Some characters were replaced because the font cannot encode them.');
      }
    }
  }

  function ascentOf(font, size) {
    return lineMetrics(font, size).ascent;
  }

  function lineMetrics(font, size) {
    var ascent = size * 0.8;
    var descent = size * 0.2;
    try {
      var up = font.heightAtSize(size, { descender: false });
      var full = font.heightAtSize(size);
      if (up > 0 && isFinite(up)) ascent = up;
      if (full > up && isFinite(full)) descent = full - up;
    } catch (e) {}
    return { ascent: ascent, descent: descent };
  }

  function drawVisualPath(painter, d, style) {
    if (!d) return;
    var origin = painter.pt(0, 0);
    var opts = {
      x: origin.x,
      y: origin.y,
      rotate: global.PDFLib.degrees(painter.rotation || 0)
    };
    if (style.fill) opts.color = style.fill;
    if (style.stroke && style.strokeWidth) {
      opts.borderColor = style.stroke;
      opts.borderWidth = style.strokeWidth;
    } else if (style.stroke && !style.fill) {
      opts.borderColor = style.stroke;
      opts.borderWidth = style.strokeWidth || 1;
    }
    if (style.dash && style.dash.length) opts.borderDashArray = style.dash;
    if (style.cap) opts.borderLineCap = style.cap;
    if (style.opacity != null && style.opacity < 0.999) {
      opts.opacity = style.opacity;
      opts.borderOpacity = style.opacity;
    }
    if (style.blend) opts.blendMode = style.blend;
    if (!opts.color && !opts.borderColor) return;
    painter.page.drawSvgPath(d, opts);
  }

  function drawVisualImage(painter, image, vx, vy, w, h, rotation, opacity, blendModeName) {
    var cx = vx + w / 2;
    var cy = vy + h / 2;
    var center = painter.pt(cx, cy);
    var theta = ((painter.rotation || 0) - (rotation || 0)) * Math.PI / 180;
    var cos = Math.cos(theta);
    var sin = Math.sin(theta);
    var rcx = (w / 2) * cos - (h / 2) * sin;
    var rcy = (w / 2) * sin + (h / 2) * cos;
    var opts = {
      x: center.x - rcx,
      y: center.y - rcy,
      width: Math.max(0.1, w),
      height: Math.max(0.1, h),
      rotate: global.PDFLib.degrees((painter.rotation || 0) - (rotation || 0))
    };
    if (opacity != null && opacity < 0.999) opts.opacity = opacity;
    if (blendModeName) opts.blendMode = blendModeName;
    painter.page.drawImage(image, opts);
  }

  function drawVisualText(painter, font, text, vx, vy, size, color, opts) {
    opts = opts || {};
    var anchor = painter.pt(vx, vy);
    var drawOpts = {
      x: anchor.x,
      y: anchor.y,
      size: size,
      font: font,
      color: color,
      rotate: global.PDFLib.degrees((painter.rotation || 0) - (opts.rotation || 0))
    };
    if (opts.opacity != null && opts.opacity < 0.999) drawOpts.opacity = opts.opacity;
    if (opts.blend) drawOpts.blendMode = opts.blend;
    drawTextRaw(painter.page, text, drawOpts, opts.spacing || 0, opts.report);
  }

  function pageLabel(fmt, n, N) {
    fmt = fmt || 'n';
    if (fmt === 'n' || fmt === '1') return String(n);
    if (fmt === 'n / N' || fmt === 'n/N' || fmt === 'slash') return n + ' / ' + N;
    if (fmt === 'Page n of N' || fmt === 'pageof' || fmt === 'page-of') return 'Page ' + n + ' of ' + N;
    if (fmt === 'page' || fmt === 'Page n') return 'Page ' + n;
    return String(fmt).replace(/\{n\}/g, String(n)).replace(/\{N\}/g, String(N));
  }

  function applyTokens(str, info) {
    return String(str == null ? '' : str)
      .replace(/\{page\}/gi, String(info.page))
      .replace(/\{pages\}/gi, String(info.pages))
      .replace(/\{date\}/gi, info.date)
      .replace(/\{title\}/gi, info.title);
  }

  function slotX(align, visW, textW, margin) {
    if (align === 'c' || align === 'center') return (visW - textW) / 2;
    if (align === 'r' || align === 'right') return visW - margin - textW;
    return margin;
  }

  async function drawChrome(painter, index, total, opts, fonts, report) {
    var doc = painter.page.doc;
    var margin = 28;
    var tasks = [];
    if (opts.pageNumbers) tasks.push(['num', opts.pageNumbers]);
    if (opts.bates) tasks.push(['bates', opts.bates]);
    if (opts.headerFooter) tasks.push(['hf', opts.headerFooter]);
    if (opts.watermark && !opts.watermark.__behindDone) tasks.push(['wm', opts.watermark]);
    for (var t = 0; t < tasks.length; t++) {
      var kind = tasks[t][0];
      var cfg = tasks[t][1] || {};
      if (kind === 'num') await drawPageNumber(painter, doc, index, total, cfg, fonts, report);
      else if (kind === 'bates') await drawBates(painter, doc, index, total, cfg, fonts, report);
      else if (kind === 'hf') await drawHeaderFooter(painter, doc, index, total, cfg, opts, fonts, report);
      else if (kind === 'wm') await drawWatermark(painter, doc, cfg, fonts, report);
    }
  }

  async function drawPageNumber(painter, doc, index, total, cfg, fonts, report) {
    if (cfg.skipFirst || cfg.skipFirstPage) {
      if (index === 0) return;
    }
    var start = num(cfg.start, 1);
    var skip = (cfg.skipFirst || cfg.skipFirstPage) ? 1 : 0;
    var numbered = Math.max(1, total - skip);
    var n = start + (index - skip);
    var N = start + numbered - 1;
    var label = pageLabel(cfg.format || cfg.fmt || 'n', n, N);
    var size = num(cfg.size || cfg.fontSize, 11);
    var margin = num(cfg.margin, 28);
    var font = await embedFont(doc, cfg.font || cfg.family || 'Helvetica', cfg.weight || 400, !!cfg.italic, report);
    var width = measureText(font, label, size, 0);
    var pos = String(cfg.position || cfg.pos || 'bc');
    var ascent = ascentOf(font, size);
    var vx = slotX(pos.charAt(1) || 'c', painter.visW, width, margin);
    var vy = (pos.charAt(0) === 't') ? margin + ascent : painter.visH - margin;
    drawVisualText(painter, font, label, vx, vy, size, parseColor(cfg.color || '#333333'), { report: report });
    fonts.used = true;
  }

  async function drawBates(painter, doc, index, total, cfg, fonts, report) {
    if ((cfg.skipFirst || cfg.skipFirstPage) && index === 0) return;
    var start = num(cfg.start, 1);
    var skip = (cfg.skipFirst || cfg.skipFirstPage) ? 1 : 0;
    var n = start + (index - skip);
    var digits = num(cfg.digits, 6);
    var body = String(Math.round(n));
    while (body.length < digits) body = '0' + body;
    var label = String(cfg.prefix == null ? '' : cfg.prefix) + body + String(cfg.suffix || '');
    var size = num(cfg.size || cfg.fontSize, 10);
    var margin = num(cfg.margin, 28);
    var font = await embedFont(doc, cfg.font || 'Courier', cfg.weight || 400, false, report);
    var width = measureText(font, label, size, 0);
    var pos = String(cfg.position || 'br');
    var ascent = ascentOf(font, size);
    var vx = slotX(pos.charAt(1) || 'r', painter.visW, width, margin);
    var vy = (pos.charAt(0) === 't') ? margin + ascent : painter.visH - margin;
    drawVisualText(painter, font, label, vx, vy, size, parseColor(cfg.color || '#222222'), { report: report });
  }

  async function drawHeaderFooter(painter, doc, index, total, cfg, opts, fonts, report) {
    if ((cfg.skipFirst || cfg.skipFirstPage) && index === 0) return;
    var size = num(cfg.size || cfg.fontSize, 10);
    var margin = num(cfg.margin, 36);
    var font = await embedFont(doc, cfg.font || 'Helvetica', cfg.weight || 400, !!cfg.italic, report);
    var ascent = ascentOf(font, size);
    var info = {
      page: String(index + 1),
      pages: String(total),
      date: cfg.date || new Date().toLocaleDateString(),
      title: (opts.metadata && opts.metadata.title) || cfg.title || ''
    };
    var header = cfg.header || {};
    var footer = cfg.footer || {};
    var slots = [
      [header.left || cfg.headerLeft, 't', 'l'],
      [header.center || cfg.headerCenter, 't', 'c'],
      [header.right || cfg.headerRight, 't', 'r'],
      [footer.left || cfg.footerLeft, 'b', 'l'],
      [footer.center || cfg.footerCenter, 'b', 'c'],
      [footer.right || cfg.footerRight, 'b', 'r']
    ];
    for (var i = 0; i < slots.length; i++) {
      var text = slots[i][0];
      if (!text) continue;
      text = applyTokens(text, info);
      var width = measureText(font, text, size, 0);
      var vx = slotX(slots[i][2], painter.visW, width, margin);
      var vy = slots[i][1] === 't' ? margin + ascent : painter.visH - margin;
      drawVisualText(painter, font, text, vx, vy, size, parseColor(cfg.color || '#333333'), { report: report });
    }
  }

  async function drawWatermark(painter, doc, cfg, fonts, report) {
    if (!cfg) return;
    var opacity = unitInterval(cfg.opacity, 0.18);
    if (opacity <= 0) return;
    var rotation = num(cfg.rotation, cfg.rotate == null ? 45 : cfg.rotate);
    var tiled = cfg.tiled === true || cfg.layout === 'tile' || cfg.layout === 'tiled';
    if (cfg.image || cfg.imageKey || cfg.src) {
      var source = cfg.image || cfg.src;
      if (!source && cfg.imageKey && fonts.assets) source = fonts.assets[cfg.imageKey];
      if (source) {
        var embedded = await embedImageSource(doc, source);
        var iw = num(cfg.width, Math.min(painter.visW, painter.visH) * 0.45);
        var ih = iw * (embedded.height / embedded.width || 1);
        if (cfg.height) ih = num(cfg.height, ih);
        placeMarks(painter, iw, ih, tiled, function (x, y) {
          drawVisualImage(painter, embedded, x - iw / 2, y - ih / 2, iw, ih, rotation, opacity);
        });
      }
      return;
    }
    var text = cfg.text == null ? '' : String(cfg.text);
    if (!text) return;
    var size = num(cfg.size || cfg.fontSize, 64);
    var font = await embedFont(doc, cfg.font || 'Helvetica', cfg.weight || 700, !!cfg.italic, report);
    var width = measureText(font, text, size, 0);
    var ascent = ascentOf(font, size);
    var color = parseColor(cfg.color || '#888888');
    placeMarks(painter, width, size * 1.4, tiled, function (cx, cy) {
      var localCx = width / 2;
      var localCy = -ascent * 0.35;
      var spun = rotatePoint(localCx, localCy, 0, 0, rotation);
      drawVisualText(painter, font, text, cx - spun.x, cy - spun.y, size, color, {
        rotation: rotation,
        opacity: opacity,
        report: report
      });
    });
  }

  function placeMarks(painter, markW, markH, tiled, drawAt) {
    if (!tiled) {
      drawAt(painter.visW / 2, painter.visH / 2);
      return;
    }
    var stepX = Math.max(markW + 36, 80);
    var stepY = Math.max(markH + 28, 48);
    var row = 0;
    for (var y = stepY / 2; y < painter.visH + stepY; y += stepY) {
      var shift = row % 2 ? stepX / 2 : 0;
      for (var x = shift; x < painter.visW + stepX; x += stepX) drawAt(x, y);
      row++;
    }
  }

  function unsupportedReason(layer) {
    if (!layer) return '';
    if (layer.shadow && (layer.shadow.blur || layer.shadow.x || layer.shadow.y || layer.shadow.color)) return 'shadow';
    var fill = layer.fill;
    if (fill && (fill.type === 'linear' || fill.type === 'radial' || fill.type === 'gradient')) return 'gradient';
    if (layer.type === 'text' && layer.curve) return 'curve';
    if (layer.type === 'text' && layer.color && typeof layer.color === 'object' && (layer.color.type === 'linear' || layer.color.type === 'radial')) return 'gradient';
    return '';
  }

  function fillOf(layer) {
    var fill = layer.fill;
    if (!fill) {
      if (layer.type === 'shape' && layer.color) return parseColor(layer.color);
      if (layer.type === 'shape') return parseColor('#1c1a22');
      return null;
    }
    if (typeof fill === 'string') return parseColor(fill);
    if (fill.type === 'none') return null;
    var color = fill.color || (fill.colors && fill.colors[0]) || layer.color || '#1c1a22';
    return parseColor(color);
  }

  function strokeOf(layer, shapeId) {
    var stroke = layer.stroke;
    var dash = null;
    if (shapeId === 'dashed-line') dash = [8, 5];
    if (!stroke && !dash && shapeId !== 'line' && shapeId !== 'line-arrow' && shapeId !== 'arrow-line' && shapeId !== 'arc') return null;
    if (typeof stroke === 'string') return { color: parseColor(stroke), width: 1.5, dash: dash };
    if (stroke && (stroke.width || stroke.color || stroke.dash)) {
      return {
        color: parseColor(stroke.color || '#1c1a22'),
        width: num(stroke.width, 1.5),
        dash: stroke.dash || dash
      };
    }
    if (shapeId === 'line' || shapeId === 'dashed-line' || shapeId === 'line-arrow' || shapeId === 'arrow-line' || shapeId === 'arc') {
      return { color: parseColor((stroke && stroke.color) || layer.color || '#1c1a22'), width: num(layer.width, 2), dash: dash };
    }
    return null;
  }

  function warnOnce(report, key, message) {
    if (!report) return;
    report._once = report._once || {};
    if (report._once[key]) return;
    report._once[key] = true;
    report.warnings.push(message);
  }

  async function drawScene(painter, scene, opts, report) {
    if (!scene) return;
    var layers = (scene.layers || []).slice();
    layers.sort(function (a, b) { return num(a && a.z, 0) - num(b && b.z, 0); });
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (!layer || layer.visible === false || layer.type === 'group' || layer.type === 'redaction' || layer.redact) continue;
      try {
        var reason = unsupportedReason(layer);
        if (reason && opts.rasterize) {
          var ras = await opts.rasterize(layer, scene);
          if (ras) {
            await paintRasterResult(painter, ras, layer);
            continue;
          }
        }
        if (reason === 'gradient') warnOnce(report, 'gradient', 'Gradient fills were drawn as a solid color. Pass opts.rasterize to keep the gradient.');
        if (reason === 'shadow') warnOnce(report, 'shadow', 'Shadows were approximated. Pass opts.rasterize for a true shadow.');
        if (reason === 'curve') warnOnce(report, 'curve', 'Curved text was drawn on a straight baseline. Pass opts.rasterize for arc text.');
        if (layer.type === 'text') await drawTextLayer(painter, layer, report, reason === 'shadow');
        else if (layer.type === 'shape') drawShapeLayer(painter, layer, report, reason === 'shadow');
        else if (layer.type === 'path' || layer.type === 'ink' || layer.type === 'draw' || layer.type === 'signature') drawInkLayer(painter, layer);
        else if (layer.type === 'image') await drawImageLayer(painter, layer, opts, scene);
        else if (layer.type === 'svg') await drawSvgLayer(painter, layer, opts);
      } catch (e) {
        if (report) report.warnings.push('A ' + (layer.type || 'layer') + ' could not be drawn' + (e && e.message ? ': ' + e.message : '.'));
      }
    }
  }

  async function paintRasterResult(painter, ras, layer) {
    var source = ras.png || ras.bytes || ras.canvas || ras.dataURL || ras.image;
    var embedded = await embedImageSource(painter.page.doc, source);
    var x = ras.x != null ? ras.x : (layer.x || 0);
    var y = ras.y != null ? ras.y : (layer.y || 0);
    var w = ras.w || ras.width || layer.w || embedded.width;
    var h = ras.h || ras.height || layer.h || embedded.height;
    drawVisualImage(painter, embedded, x, y, w, h, 0, unitInterval(layer.opacity, 1));
  }

  async function drawTextLayer(painter, layer, report, shadow) {
    var doc = painter.page.doc;
    var text = layer.uppercase || layer.upper ? String(layer.text == null ? '' : layer.text).toUpperCase() : String(layer.text == null ? '' : layer.text);
    if (!text) return;
    var size = num(layer.size || layer.fontSize, 18);
    var weight = layer.weight || layer.fontWeight || 400;
    var italic = !!(layer.italic || layer.fontStyle === 'italic');
    var font = await embedFont(doc, layer.font || layer.fontFamily || layer.family || 'Helvetica', weight, italic, report);
    var spacing = num(layer.letterSpacing, 0);
    var boxW = num(layer.w, 0);
    if (!boxW) boxW = Math.max(40, measureText(font, text.split('\n')[0] || ' ', size, spacing) + 4);
    var lines = wrapText(font, text, size, Math.max(8, boxW), spacing);
    var lineFactor = num(layer.lineHeight, 1.2);
    var lineH = size * lineFactor;
    var metrics = lineMetrics(font, size);
    var boxH = num(layer.h, lines.length * lineH);
    var ox = num(layer.x, 0);
    var oy = num(layer.y, 0);
    var opacity = unitInterval(layer.opacity, 1);
    var blend = blendMode(layer.blend);
    var rotation = num(layer.rotation, 0);
    var cx = ox + boxW / 2;
    var cy = oy + boxH / 2;
    if (layer.background && layer.background.color) {
      var bgPath = shapeToPage(roundRectPath(boxW, boxH, num(layer.background.radius, 0)), ox, oy, boxW, boxH, rotation, false, false);
      drawVisualPath(painter, bgPath, { fill: parseColor(layer.background.color), opacity: opacity, blend: blend });
    }
    var color = parseColor(typeof layer.color === 'string' ? layer.color : (layer.color && layer.color.color) || '#16141c');
    var align = String(layer.align || layer.textAlign || 'left');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lw = measureText(font, line, size, spacing);
      var lx = ox;
      if (align === 'center' || align === 'middle') lx = ox + (boxW - lw) / 2;
      else if (align === 'right' || align === 'end') lx = ox + boxW - lw;
      var baseline = oy + i * lineH + lineH / 2 + (metrics.ascent - metrics.descent) / 2;
      if (align === 'justify' && i < lines.length - 1 && line.indexOf(' ') >= 0) {
        var words = line.split(/\s+/).filter(Boolean);
        var wordsW = 0;
        words.forEach(function (word) { wordsW += measureText(font, word, size, spacing); });
        var gap = words.length > 1 ? (boxW - wordsW) / (words.length - 1) : 0;
        var cursor = ox;
        for (var w = 0; w < words.length; w++) {
          paintGlyph(painter, font, words[w], cursor, baseline, size, color, rotation, cx, cy, opacity, spacing, blend, layer, report, shadow);
          cursor += measureText(font, words[w], size, spacing) + gap;
        }
      } else {
        paintGlyph(painter, font, line, lx, baseline, size, color, rotation, cx, cy, opacity, spacing, blend, layer, report, shadow);
      }
      if ((layer.underline || layer.strike) && line) {
        var yLine = layer.strike ? baseline - metrics.ascent * 0.35 : baseline + Math.max(1, size * 0.12);
        var a = rotatePoint(lx, yLine, cx, cy, rotation);
        var b = rotatePoint(lx + lw, yLine, cx, cy, rotation);
        var pa = painter.pt(a.x, a.y);
        var pb = painter.pt(b.x, b.y);
        painter.page.drawLine({
          start: { x: pa.x, y: pa.y },
          end: { x: pb.x, y: pb.y },
          thickness: Math.max(0.6, size / 14),
          color: color,
          opacity: opacity
        });
      }
    }
  }

  function paintGlyph(painter, font, text, x, y, size, color, rotation, cx, cy, opacity, spacing, blend, layer, report, shadow) {
    if (!text) return;
    var p = rotatePoint(x, y, cx, cy, rotation);
    if (shadow && layer.shadow) {
      var s = layer.shadow;
      var sp = rotatePoint(x + num(s.x, 2), y + num(s.y, 2), cx, cy, rotation);
      drawVisualText(painter, font, text, sp.x, sp.y, size, parseColor(s.color || 'rgba(0,0,0,0.35)'), {
        rotation: rotation, opacity: opacity * 0.45, spacing: spacing, blend: blend, report: report
      });
    }
    if (layer.stroke && layer.stroke.width) {
      var sw = num(layer.stroke.width, 0);
      var sc = parseColor(layer.stroke.color || '#000000');
      var steps = [[sw, 0], [-sw, 0], [0, sw], [0, -sw]];
      for (var i = 0; i < steps.length; i++) {
        var o = rotatePoint(x + steps[i][0], y + steps[i][1], cx, cy, rotation);
        drawVisualText(painter, font, text, o.x, o.y, size, sc, {
          rotation: rotation, opacity: opacity, spacing: spacing, report: report
        });
      }
    }
    drawVisualText(painter, font, text, p.x, p.y, size, color, {
      rotation: rotation, opacity: opacity, spacing: spacing, blend: blend, report: report
    });
  }

  function shapeToPage(localPath, x, y, w, h, rotation, flipX, flipY) {
    return mapAbsPath(localPath, function (px, py) {
      var lx = flipX ? (w - px) : px;
      var ly = flipY ? (h - py) : py;
      var ax = x + lx;
      var ay = y + ly;
      if (rotation) return rotatePoint(ax, ay, x + w / 2, y + h / 2, rotation);
      return { x: ax, y: ay };
    });
  }

  function drawShapeLayer(painter, layer, report, shadow) {
    var w = Math.max(1, num(layer.w, 80));
    var h = Math.max(1, num(layer.h, 80));
    var id = layer.shape || layer.shapeId || 'rectangle';
    var local = typeof layer.path === 'string' ? layer.path : catalogPath(id, w, h, layer.params || {});
    var opacity = unitInterval(layer.opacity, 1);
    var path = shapeToPage(local, num(layer.x, 0), num(layer.y, 0), w, h, num(layer.rotation, 0), !!layer.flipX, !!layer.flipY);
    var stroke = strokeOf(layer, String(id));
    var fill = fillOf(layer);
    if (String(id) === 'line' || String(id) === 'dashed-line' || String(id) === 'arc' || String(id) === 'line-arrow' || String(id) === 'arrow-line') fill = null;
    var style = {
      fill: fill,
      stroke: stroke && stroke.color,
      strokeWidth: stroke && stroke.width,
      dash: stroke && stroke.dash,
      cap: global.PDFLib.LineCapStyle.Round,
      opacity: opacity,
      blend: blendMode(layer.blend)
    };
    if (shadow && layer.shadow) {
      var s = layer.shadow;
      var shadowPath = shapeToPage(local, num(layer.x, 0) + num(s.x, 3), num(layer.y, 0) + num(s.y, 3), w, h, num(layer.rotation, 0), !!layer.flipX, !!layer.flipY);
      drawVisualPath(painter, shadowPath, { fill: parseColor(s.color || '#000000'), opacity: opacity * 0.25 });
    }
    drawVisualPath(painter, path, style);
  }

  function asInkPoint(p) {
    if (Array.isArray(p)) return [num(p[0], NaN), num(p[1], NaN), p[2] == null ? null : num(p[2], 0.5)];
    if (!p) return [NaN, NaN, null];
    return [num(p.x, NaN), num(p.y, NaN), p.pressure == null ? (p.p == null ? null : num(p.p, 0.5)) : num(p.pressure, 0.5)];
  }

  function inkPoints(layer) {
    var rawSrc = layer.points || (Array.isArray(layer.path) ? layer.path : null);
    if (!rawSrc) return [];
    var raw = rawSrc.map(asInkPoint).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    if (!raw.length) return [];
    var space = layer.pointsAre || layer.pointSpace;
    var local = space === 'local' || space === 'relative';
    if (!local && space !== 'page' && space !== 'absolute' && (layer.x || layer.y)) {
      var maxX = -Infinity, maxY = -Infinity, minX = Infinity, minY = Infinity;
      raw.forEach(function (p) {
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
      });
      var w = num(layer.w, 0);
      var h = num(layer.h, 0);
      if (minX >= -4 && minY >= -4 && maxX <= w + 4 && maxY <= h + 4) local = true;
    }
    if (!local) return raw;
    var ox = num(layer.x, 0);
    var oy = num(layer.y, 0);
    return raw.map(function (p) { return [p[0] + ox, p[1] + oy, p[2]]; });
  }

  function smoothPolyline(pts, amount) {
    if (!amount || pts.length < 3) return pts;
    var cur = pts;
    var passes = Math.min(3, Math.max(1, Math.round(amount * 2)));
    if (pts.length > 600) passes = 1;
    for (var pass = 0; pass < passes; pass++) {
      if (cur.length > 1600) break;
      var next = [cur[0]];
      for (var i = 0; i < cur.length - 1; i++) {
        var a = cur[i];
        var b = cur[i + 1];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2]]);
        next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, b[2]]);
      }
      next.push(cur[cur.length - 1]);
      cur = next;
    }
    return cur;
  }

  function ribbonPath(pts, width) {
    if (pts.length < 2) return '';
    var left = [];
    var right = [];
    for (var i = 0; i < pts.length; i++) {
      var prev = pts[Math.max(0, i - 1)];
      var next = pts[Math.min(pts.length - 1, i + 1)];
      var dx = next[0] - prev[0];
      var dy = next[1] - prev[1];
      var len = Math.hypot(dx, dy) || 1;
      var pressure = pts[i][2] == null ? 0.65 : clamp(pts[i][2], 0.15, 1);
      var hw = Math.max(0.4, width * (0.35 + pressure)) / 2;
      left.push([pts[i][0] + (-dy / len) * hw, pts[i][1] + (dx / len) * hw]);
      right.push([pts[i][0] - (-dy / len) * hw, pts[i][1] - (dx / len) * hw]);
    }
    var d = 'M ' + roundN(left[0][0]) + ' ' + roundN(left[0][1]);
    for (var j = 1; j < left.length; j++) d += ' L ' + roundN(left[j][0]) + ' ' + roundN(left[j][1]);
    for (var k = right.length - 1; k >= 0; k--) d += ' L ' + roundN(right[k][0]) + ' ' + roundN(right[k][1]);
    return d + ' Z';
  }

  function centerlinePath(pts) {
    if (!pts.length) return '';
    var d = 'M ' + roundN(pts[0][0]) + ' ' + roundN(pts[0][1]);
    if (pts.length === 1) return d;
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2;
      var my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ' Q ' + roundN(pts[i][0]) + ' ' + roundN(pts[i][1]) + ' ' + roundN(mx) + ' ' + roundN(my);
    }
    var last = pts[pts.length - 1];
    d += ' L ' + roundN(last[0]) + ' ' + roundN(last[1]);
    return d;
  }

  function drawInkLayer(painter, layer) {
    var pts = smoothPolyline(inkPoints(layer), layer.smoothing == null ? 0.5 : unitInterval(layer.smoothing, 0.5));
    if (pts.length < 2 && typeof layer.path === 'string') {
      var w = num(layer.w, 10);
      var h = num(layer.h, 10);
      drawVisualPath(painter, shapeToPage(layer.path, num(layer.x, 0), num(layer.y, 0), w, h, num(layer.rotation, 0), !!layer.flipX, !!layer.flipY), {
        stroke: parseColor(layer.color || '#111111'),
        strokeWidth: num(layer.width, 2),
        cap: global.PDFLib.LineCapStyle.Round,
        opacity: unitInterval(layer.opacity, 1)
      });
      return;
    }
    if (pts.length < 2) return;
    if (layer.rotation) {
      var bounds = pts.reduce(function (b, p) {
        b.minX = Math.min(b.minX, p[0]); b.maxX = Math.max(b.maxX, p[0]);
        b.minY = Math.min(b.minY, p[1]); b.maxY = Math.max(b.maxY, p[1]);
        return b;
      }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      var cx = (bounds.minX + bounds.maxX) / 2;
      var cy = (bounds.minY + bounds.maxY) / 2;
      pts = pts.map(function (p) {
        var r = rotatePoint(p[0], p[1], cx, cy, layer.rotation);
        return [r.x, r.y, p[2]];
      });
    }
    var mode = layer.mode || (layer.type === 'signature' ? 'pen' : 'pen');
    var opacity = unitInterval(layer.opacity, mode === 'highlighter' ? 0.35 : 1);
    var width = num(layer.width, mode === 'highlighter' ? 16 : mode === 'marker' ? 8 : 2.4);
    var color = parseColor(layer.color || (mode === 'highlighter' ? '#ffe14a' : '#16141c'));
    var vary = pts.some(function (p) { return p[2] != null; }) && mode === 'pen';
    if (vary) {
      drawVisualPath(painter, ribbonPath(pts, width), { fill: color, opacity: opacity, blend: blendMode(layer.blend) });
      return;
    }
    drawVisualPath(painter, centerlinePath(pts), {
      stroke: color,
      strokeWidth: width,
      cap: global.PDFLib.LineCapStyle.Round,
      opacity: opacity,
      blend: mode === 'highlighter' ? (blendMode(layer.blend) || global.PDFLib.BlendMode.Multiply) : blendMode(layer.blend)
    });
  }

  async function resolveLayerImage(layer, opts, scene) {
    if (layer.canvas || layer.image || layer.bytes || layer.png || layer.dataURL || layer.dataUrl) {
      return layer.canvas || layer.image || layer.bytes || layer.png || layer.dataURL || layer.dataUrl;
    }
    var key = layer.src || layer.imageKey || layer.key;
    var pools = [opts.assets, opts.images, scene && scene.assets, opts.workspace && opts.workspace.assets];
    for (var i = 0; i < pools.length; i++) {
      if (pools[i] && key != null && pools[i][key] != null) return pools[i][key];
    }
    if (typeof key === 'string' && (key.indexOf('data:') === 0 || key.indexOf('blob:') === 0)) return key;
    return null;
  }

  async function drawImageLayer(painter, layer, opts, scene) {
    var source = await resolveLayerImage(layer, opts, scene);
    if (!source) return;
    var canvas = null;
    if (layer.flipX || layer.flipY) {
      canvas = await rasterAny(source);
      if (canvas) {
        var flipped = document.createElement('canvas');
        flipped.width = canvas.width;
        flipped.height = canvas.height;
        var ctx = flipped.getContext('2d');
        ctx.translate(layer.flipX ? canvas.width : 0, layer.flipY ? canvas.height : 0);
        ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
        ctx.drawImage(canvas, 0, 0);
        source = flipped;
      }
    }
    var embedded = await embedImageSource(painter.page.doc, source);
    var w = num(layer.w, embedded.width);
    var h = num(layer.h, embedded.height);
    drawVisualImage(painter, embedded, num(layer.x, 0), num(layer.y, 0), w, h, num(layer.rotation, 0), unitInterval(layer.opacity, 1), blendMode(layer.blend));
  }

  async function drawSvgLayer(painter, layer, opts) {
    var markup = layer.svg || layer.markup;
    if (!markup && layer.assetId && LE.assets && typeof LE.assets.svg === 'function') {
      markup = LE.assets.svg(layer.assetId, { color: layer.color, strokeWidth: layer.strokeWidth });
    }
    if (!markup) return;
    var w = Math.max(1, num(layer.w, 64));
    var h = Math.max(1, num(layer.h, 64));
    var canvas = await rasterSvg(markup, w, h);
    var embedded = await embedImageSource(painter.page.doc, canvas);
    drawVisualImage(painter, embedded, num(layer.x, 0), num(layer.y, 0), w, h, num(layer.rotation, 0), unitInterval(layer.opacity, 1), blendMode(layer.blend));
  }

  function rasterSvg(markup, w, h) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([markup], { type: 'image/svg+xml' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * 2));
        c.height = Math.max(1, Math.round(h * 2));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not rasterize SVG'));
      };
      img.src = url;
    });
  }

  function openPdfJs(bytes, password) {
    var params = { data: bytes.slice(0), isEvalSupported: false };
    if (password) params.password = password;
    return global.pdfjsLib.getDocument(params).promise;
  }

  async function open(fileOrBytes, opts) {
    opts = opts || {};
    await ready();
    var name = (fileOrBytes && fileOrBytes.name) || opts.name || 'document.pdf';
    var bytes = await readBytes(fileOrBytes);
    var pdfjs;
    try { pdfjs = await openPdfJs(bytes, opts.password); }
    catch (e) {
      var pe = asPasswordError(e);
      if (pe) throw pe;
      throw e;
    }
    var encrypted = false;
    try { await global.PDFLib.PDFDocument.load(bytes.slice(0), { updateMetadata: false }); }
    catch (e) {
      if (isEncryptedError(e)) encrypted = true;
    }
    if (pdfjs.numPages > 500) {
      try { pdfjs.destroy(); } catch (e2) {}
      throw new Error('PDF has too many pages');
    }
    var pages = [];
    for (var i = 1; i <= pdfjs.numPages; i++) {
      var page = await pdfjs.getPage(i);
      var vp = page.getViewport({ scale: 1 });
      if (!isFinite(vp.width) || !isFinite(vp.height) || vp.width > 14400 || vp.height > 14400) {
        page.cleanup();
        try { pdfjs.destroy(); } catch (e3) {}
        throw new Error('PDF page is too large');
      }
      pages.push({
        index: i - 1,
        width: vp.width,
        height: vp.height,
        rotation: page.rotate || 0
      });
      page.cleanup();
      if (i % 4 === 0) await yieldNow();
    }
    var doc = {
      id: uid('doc'),
      name: name,
      pageCount: pdfjs.numPages,
      pages: pages,
      encrypted: encrypted
    };
    var thumbs = Object.create(null);
    var thumbOrder = [];
    doc._pdfjs = pdfjs;
    doc._bytes = bytes;
    doc.bytes = function () { return bytes.slice(0); };
    doc.close = function () {
      try { pdfjs.destroy(); } catch (e) {}
      delete openDocs[doc.id];
    };
    doc.render = function (pageIndex, scale, canvas) {
      if (pageIndex < 0 || pageIndex >= doc.pageCount) return Promise.reject(new Error('Page out of range'));
      var sc = capScale(scale);
      return pdfjs.getPage(pageIndex + 1).then(function (page) {
        var vp = page.getViewport({ scale: sc });
        var edge = pixelCap();
        var area = pixelArea();
        var fit = 1;
        if (vp.width > edge || vp.height > edge) fit = Math.min(fit, edge / Math.max(vp.width, vp.height, 1));
        if (vp.width * vp.height > area) fit = Math.min(fit, Math.sqrt(area / Math.max(1, vp.width * vp.height)));
        if (fit < 1) vp = page.getViewport({ scale: sc * fit });
        var c = canvas || document.createElement('canvas');
        c.width = Math.max(1, Math.floor(vp.width));
        c.height = Math.max(1, Math.floor(vp.height));
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          page.cleanup();
          return c;
        });
      });
    };
    doc.thumb = function (pageIndex, maxPx) {
      maxPx = maxPx || 160;
      var key = pageIndex + 'x' + maxPx;
      if (thumbs[key]) return Promise.resolve(cloneCanvas(thumbs[key]));
      var pg = doc.pages[pageIndex];
      if (!pg) return Promise.reject(new Error('Page out of range'));
      var scale = maxPx / Math.max(pg.width, pg.height, 1);
      return doc.render(pageIndex, scale).then(function (canvas) {
        thumbs[key] = canvas;
        thumbOrder.push(key);
        if (thumbOrder.length > 48) {
          var old = thumbOrder.shift();
          var gone = thumbs[old];
          if (gone) { try { gone.width = 1; gone.height = 1; } catch (e) {} }
          delete thumbs[old];
        }
        return cloneCanvas(canvas);
      });
    };
    doc.text = function (pageIndex) {
      if (pageIndex == null) {
        return (async function () {
          var all = [];
          var parts = [];
          for (var p = 0; p < doc.pageCount; p++) {
            var one = await doc.text(p);
            all.push(one);
            parts.push(one.text);
            if (p % 2 === 1) await yieldNow();
          }
          return { pages: all, text: parts.join('\n') };
        })();
      }
      if (pageIndex < 0 || pageIndex >= doc.pageCount) return Promise.reject(new Error('Page out of range'));
      return pdfjs.getPage(pageIndex + 1).then(function (page) {
        var vp = page.getViewport({ scale: 1 });
        return page.getTextContent().then(function (tc) {
          var items = [];
          var chunks = [];
          (tc.items || []).forEach(function (item, idx) {
            if (!item || !item.str) {
              if (item && item.hasEOL && chunks.length) chunks.push('\n');
              return;
            }
            var tx = global.pdfjsLib.Util.transform(vp.transform, item.transform);
            var adv = (item.width || 0) * (vp.scale || 1);
            var dir = Math.hypot(tx[0], tx[1]) || 1;
            var up = Math.hypot(tx[2], tx[3]) || item.height || 0;
            var x0 = tx[4];
            var y0 = tx[5];
            var x1 = x0 + (tx[0] / dir) * adv;
            var y1 = y0 + (tx[1] / dir) * adv;
            var upx = up ? (tx[2] / (Math.hypot(tx[2], tx[3]) || 1)) * up : 0;
            var upy = up ? (tx[3] / (Math.hypot(tx[2], tx[3]) || 1)) * up : 0;
            var xs = [x0, x1, x0 + upx, x1 + upx];
            var ys = [y0, y1, y0 + upy, y1 + upy];
            var minX = Math.min(xs[0], xs[1], xs[2], xs[3]);
            var maxX = Math.max(xs[0], xs[1], xs[2], xs[3]);
            var minY = Math.min(ys[0], ys[1], ys[2], ys[3]);
            var maxY = Math.max(ys[0], ys[1], ys[2], ys[3]);
            items.push({
              str: item.str,
              x: minX,
              y: minY,
              w: Math.max(0, maxX - minX),
              h: Math.max(0, maxY - minY),
              font: item.fontName || ''
            });
            chunks.push(item.str);
            var next = tc.items[idx + 1];
            if (item.hasEOL) chunks.push('\n');
            else if (next && next.str) chunks.push(' ');
          });
          page.cleanup();
          return { page: pageIndex, items: items, text: chunks.join('').replace(/[ ]+\n/g, '\n').trim() };
        });
      });
    };
    doc.formFields = function () { return readFormFields(pdfjs); };
    doc.outline = function () { return readOutline(pdfjs); };
    doc.metadata = function () { return readMetadata(pdfjs); };
    openDocs[doc.id] = doc;
    return doc;
  }

  function cloneCanvas(canvas) {
    var c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c;
  }

  async function readFormFields(pdfjs) {
    var fields = [];
    for (var i = 1; i <= pdfjs.numPages; i++) {
      var page = await pdfjs.getPage(i);
      var annots = [];
      try { annots = await page.getAnnotations({ intent: 'display' }); } catch (e) { annots = []; }
      var vp = page.getViewport({ scale: 1 });
      annots.forEach(function (ann) {
        if (!ann || (ann.subtype !== 'Widget' && ann.fieldType == null && !ann.fieldName)) return;
        if (ann.subtype && ann.subtype !== 'Widget') return;
        var rect = ann.rect || [0, 0, 0, 0];
        var vr = vp.convertToViewportRectangle(rect);
        var x1 = Math.min(vr[0], vr[2]);
        var x2 = Math.max(vr[0], vr[2]);
        var y1 = Math.min(vr[1], vr[3]);
        var y2 = Math.max(vr[1], vr[3]);
        var type = 'unknown';
        if (ann.fieldType === 'Sig') type = 'signature';
        else if (ann.fieldType === 'Tx') type = 'text';
        else if (ann.fieldType === 'Ch') type = ann.combo ? 'dropdown' : 'option-list';
        else if (ann.fieldType === 'Btn') type = ann.checkBox ? 'checkbox' : ann.radioButton ? 'radio' : 'button';
        var value = ann.fieldValue == null ? '' : ann.fieldValue;
        if (type === 'checkbox') value = !!(ann.fieldValue && ann.fieldValue !== 'Off');
        var options = [];
        if (ann.options && ann.options.length) {
          options = ann.options.map(function (opt) {
            if (opt && typeof opt === 'object') return opt.exportValue || opt.displayValue || '';
            return String(opt);
          });
        }
        fields.push({
          name: ann.fieldName || '',
          type: type,
          value: value,
          options: options,
          page: i - 1,
          rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
          pdfRect: { x: Math.min(rect[0], rect[2]), y: Math.min(rect[1], rect[3]), width: Math.abs(rect[2] - rect[0]), height: Math.abs(rect[3] - rect[1]) },
          readOnly: !!ann.readOnly
        });
      });
      page.cleanup();
      if (i % 3 === 0) await yieldNow();
    }
    return fields;
  }

  async function readOutline(pdfjs) {
    var items = [];
    try { items = await pdfjs.getOutline() || []; } catch (e) { return []; }
    async function mapItem(item) {
      var page = null;
      try {
        var dest = item.dest;
        if (typeof dest === 'string') dest = await pdfjs.getDestination(dest);
        if (dest && dest[0]) page = await pdfjs.getPageIndex(dest[0]);
      } catch (e) { page = null; }
      var children = [];
      var nested = item.items || [];
      for (var i = 0; i < nested.length; i++) children.push(await mapItem(nested[i]));
      return { title: item.title || '', page: page, bold: !!item.bold, italic: !!item.italic, items: children };
    }
    var out = [];
    for (var i = 0; i < items.length; i++) out.push(await mapItem(items[i]));
    return out;
  }

  function readMetadata(pdfjs) {
    return pdfjs.getMetadata().then(function (meta) {
      var info = (meta && meta.info) || {};
      return {
        title: info.Title || '',
        author: info.Author || '',
        subject: info.Subject || '',
        keywords: info.Keywords || '',
        creator: info.Creator || '',
        producer: info.Producer || '',
        creationDate: info.CreationDate || '',
        modificationDate: info.ModDate || ''
      };
    }).catch(function () {
      return { title: '', author: '', subject: '', keywords: '', creator: '', producer: '', creationDate: '', modificationDate: '' };
    });
  }

  function freshReport() {
    return { warnings: [], redactedPages: [], rasterizedPages: [], compressedPages: [], keptVectorPages: [], textSelectable: [] };
  }

  function attachReport(bytes, report) {
    var out = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    report.pageCount = report.pageCount || 0;
    try { Object.defineProperty(out, 'report', { value: report, enumerable: false }); }
    catch (e) { out.report = report; }
    LE.pdf.lastReport = report;
    return out;
  }

  function normalizeWorkspace(workspace) {
    if (Array.isArray(workspace)) return { pages: workspace.slice() };
    if (workspace && Array.isArray(workspace.pages)) return workspace;
    throw new Error('Workspace needs a pages array');
  }

  function findDoc(ref, workspace) {
    if (ref.doc && ref.doc._pdfjs) return ref.doc;
    var id = ref.docId;
    if (ref.doc && ref.doc.id) id = id || ref.doc.id;
    var pools = [];
    if (workspace && workspace.docs) pools.push(workspace.docs);
    pools.push(openDocs);
    for (var p = 0; p < pools.length; p++) {
      var pool = pools[p];
      if (!pool) continue;
      if (Array.isArray(pool)) {
        for (var i = 0; i < pool.length; i++) if (pool[i] && pool[i].id === id) return pool[i];
      } else if (pool[id]) return pool[id];
    }
    throw new Error('Unknown document' + (id ? ' ' + id : ''));
  }

  var plCache = new WeakMap();

  async function pdfLibOf(doc) {
    if (plCache.has(doc)) return plCache.get(doc);
    if (doc.encrypted) {
      var err = new Error('Encrypted PDF pages are rasterized because this pdf-lib build cannot decrypt them.');
      err.code = 'encrypted';
      throw err;
    }
    var loaded = await global.PDFLib.PDFDocument.load(doc._bytes.slice(0), { updateMetadata: false, ignoreEncryption: false });
    plCache.set(doc, loaded);
    return loaded;
  }

  function collectRedactions(list) {
    var map = Object.create(null);
    (list || []).forEach(function (entry) {
      if (!entry) return;
      var p = entry.page != null ? entry.page : entry.pageIndex;
      if (p == null) return;
      p = p | 0;
      if (!map[p]) map[p] = [];
      if (entry.rects && entry.rects.length) entry.rects.forEach(function (r) { map[p].push(normRect(r)); });
      else map[p].push(normRect(entry));
    });
    return map;
  }

  function normRect(r) {
    return {
      x: num(r.x, 0),
      y: num(r.y, 0),
      w: num(r.w != null ? r.w : r.width, 0),
      h: num(r.h != null ? r.h : r.height, 0)
    };
  }

  function sceneRedactions(scene) {
    var rects = [];
    ((scene && scene.layers) || []).forEach(function (layer) {
      if (!layer || layer.visible === false) return;
      if (layer.type === 'redaction' || layer.redact) rects.push(normRect(layer));
    });
    return rects;
  }

  async function renderPdfPage(pdfjs, pageIndex, rotation, scale) {
    var page = await pdfjs.getPage(pageIndex + 1);
    var vp = page.getViewport({ scale: scale, rotation: norm90(rotation) });
    var cap = pixelCap();
    var edge = Math.max(vp.width, vp.height);
    if (edge > cap) {
      scale = scale * (cap / edge);
      vp = page.getViewport({ scale: scale, rotation: norm90(rotation) });
    }
    var area = pixelArea();
    if (vp.width * vp.height > area) {
      scale = scale * Math.sqrt(area / Math.max(1, vp.width * vp.height));
      vp = page.getViewport({ scale: scale, rotation: norm90(rotation) });
    }
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    return { canvas: canvas, scale: scale, width: vp.width / scale, height: vp.height / scale };
  }

  function paintBoxes(canvas, rects, scale) {
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    rects.forEach(function (r) {
      ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    });
  }

  async function paintFullImage(doc, page, canvas, mime, quality) {
    var bytes = mime === 'image/jpeg' ? await jpegCanvas(canvas, quality == null ? 0.86 : quality) : await canvasToBytes(canvas, 'image/png');
    var image = mime === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    var size = page.getSize();
    page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    try { canvas.width = 1; canvas.height = 1; } catch (e) {}
  }

  function blankSize(blank) {
    blank = blank || {};
    if (blank.pageSize && PAGE_SIZES[String(blank.pageSize).toLowerCase()]) {
      var s = PAGE_SIZES[String(blank.pageSize).toLowerCase()];
      return { w: blank.w || s[0], h: blank.h || s[1], color: blank.color || '#ffffff' };
    }
    return { w: num(blank.w || blank.width, 595.28), h: num(blank.h || blank.height, 841.89), color: blank.color || '#ffffff' };
  }

  function layoutImage(pxW, pxH, opts) {
    opts = opts || {};
    var sizeName = String(opts.pageSize || opts.size || 'a4').toLowerCase();
    var margin = num(opts.margin, 36);
    var orient = opts.orientation || opts.orient || 'auto';
    var pw, ph;
    if (sizeName === 'fit' || sizeName === 'fit-image' || sizeName === 'image') {
      pw = pxW * 0.75 + margin * 2;
      ph = pxH * 0.75 + margin * 2;
      if ((orient === 'portrait' && pw > ph) || (orient === 'landscape' && ph > pw)) {
        var swap = pw; pw = ph; ph = swap;
      }
    } else {
      var base = PAGE_SIZES[sizeName] || (opts.pageSize && opts.pageSize.w ? [opts.pageSize.w, opts.pageSize.h] : PAGE_SIZES.a4);
      if (opts.pageSize && typeof opts.pageSize === 'object') base = [num(opts.pageSize.w || opts.pageSize.width, base[0]), num(opts.pageSize.h || opts.pageSize.height, base[1])];
      pw = base[0];
      ph = base[1];
      var land = orient === 'landscape' || (orient === 'auto' && pxW > pxH);
      if (land) { pw = base[1]; ph = base[0]; }
    }
    var aw = Math.max(1, pw - margin * 2);
    var ah = Math.max(1, ph - margin * 2);
    var s = Math.min(aw / pxW, ah / pxH);
    if ((sizeName === 'fit' || sizeName === 'fit-image' || sizeName === 'image') && orient === 'auto') s = Math.min(s, 0.75);
    var dw = pxW * s;
    var dh = pxH * s;
    return { pw: pw, ph: ph, x: (pw - dw) / 2, y: (ph - dh) / 2, w: dw, h: dh };
  }

  async function build(workspace, opts) {
    opts = opts || {};
    await ready();
    var model = normalizeWorkspace(workspace);
    if (!model.pages.length) throw new Error('Workspace has no pages');
    var report = freshReport();
    var out = await global.PDFLib.PDFDocument.create();
    var redactions = collectRedactions(opts.redactions);
    var total = model.pages.length;
    if (opts.onProgress) opts.onProgress(0, total);
    var assets = ownCopy(Object.create(null), model.assets || {}, model.images || {}, opts.assets || {}, opts.images || {});
    var fontBag = { assets: assets };
    var behind = opts.watermark && (opts.watermark.behind === true || opts.watermark.layer === 'behind' || opts.watermark.position === 'behind');

    for (var i = 0; i < total; i++) {
      var ref = model.pages[i] || {};
      var rects = (redactions[i] || []).concat(sceneRedactions(ref.scene));
      var painter = null;
      report.textSelectable[i] = true;
      try {
        if (ref.blank) {
          var blank = blankSize(ref.blank);
          var bpage = out.addPage([blank.w, blank.h]);
          bpage.drawRectangle({ x: 0, y: 0, width: blank.w, height: blank.h, color: parseColor(blank.color || '#ffffff') });
          painter = makePainter(bpage);
        } else if (ref.image || ref.imageKey || ref.imagePage) {
          var imgSource = ref.image || ref.imagePage || assets[ref.imageKey];
          var canvas = await rasterAny(imgSource);
          if (!canvas) throw new Error('Image page is missing image data');
          var lay = layoutImage(canvas.width, canvas.height, ref.imageOptions || ref.options || opts.image || {
            pageSize: ref.pageSize, margin: ref.margin, orientation: ref.orientation
          });
          var ipage = out.addPage([lay.pw, lay.ph]);
          ipage.drawRectangle({ x: 0, y: 0, width: lay.pw, height: lay.ph, color: parseColor((ref.blank && ref.blank.color) || '#ffffff') });
          var embedded = await embedImageSource(out, canvas);
          ipage.drawImage(embedded, { x: lay.x, y: lay.ph - lay.y - lay.h, width: lay.w, height: lay.h });
          painter = makePainter(ipage);
        } else {
          var src = findDoc(ref, model);
          var pageIndex = ref.pageIndex | 0;
          var finalRot = 0;
          var baseRot = (src.pages[pageIndex] && src.pages[pageIndex].rotation) || 0;
          finalRot = norm90(baseRot + num(ref.rotation, 0));
          if (Math.abs(normAngle(baseRot + num(ref.rotation, 0)) - finalRot) > 1) {
            warnOnce(report, 'rot', 'Page rotation was snapped to the nearest 90 degrees.');
          }
          if (src.encrypted || rects.length) {
            var dpi = num(opts.dpi || opts.redactDpi, rects.length ? 150 : 120);
            var rendered = await renderPdfPage(src._pdfjs, pageIndex, finalRot, dpi / 72);
            if (rects.length) paintBoxes(rendered.canvas, rects, rendered.scale);
            var rpage = out.addPage([rendered.width, rendered.height]);
            await paintFullImage(out, rpage, rendered.canvas, 'image/jpeg', rects.length ? 0.86 : 0.8);
            painter = makePainter(rpage);
            report.rasterizedPages.push(i);
            report.textSelectable[i] = false;
            if (rects.length) {
              report.redactedPages.push(i);
              report.warnings.push('Page ' + (i + 1) + ' text is no longer selectable because the page was rasterized for redaction.');
            } else {
              report.warnings.push('Page ' + (i + 1) + ' was rasterized because the source PDF is encrypted. Its text is no longer selectable.');
            }
          } else if (behind) {
            var pl = await pdfLibOf(src);
            var srcPage = pl.getPage(pageIndex);
            var crop = cropOf(srcPage);
            var vis = visualSize(crop, finalRot);
            var npage = out.addPage([vis.width, vis.height]);
            painter = makePainter(npage);
            opts.watermark.__behindDone = false;
            await drawWatermark(painter, out, opts.watermark, fontBag, report);
            var embeddedPage = await out.embedPage(srcPage, {
              left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height
            });
            var place = placement(finalRot, crop.width, crop.height);
            npage.drawPage(embeddedPage, { x: place.x, y: place.y, rotate: global.PDFLib.degrees(place.rotate) });
            opts.watermark.__behindDone = true;
          } else {
            var srcPl = await pdfLibOf(src);
            var copied = await out.copyPages(srcPl, [pageIndex]);
            copied[0].setRotation(global.PDFLib.degrees(finalRot));
            out.addPage(copied[0]);
            painter = makePainter(copied[0]);
          }
        }
        if (ref.scene && ref.scene.background && ref.blank) {
          var bg = ref.scene.background;
          if (bg.type === 'color' && bg.color) {
            painter.page.drawRectangle({
              x: 0, y: 0, width: painter.visW, height: painter.visH, color: parseColor(bg.color)
            });
          } else if (bg.type === 'gradient') {
            warnOnce(report, 'bg-gradient', 'Page background gradients were drawn as a solid color. Pass opts.rasterize for a true gradient.');
            var gcolor = (bg.colors && bg.colors[0]) || bg.color || '#ffffff';
            painter.page.drawRectangle({ x: 0, y: 0, width: painter.visW, height: painter.visH, color: parseColor(gcolor) });
          }
        }
        var sceneOpts = Object.assign({}, opts, { assets: assets, workspace: model });
        if (ref.scene) await drawScene(painter, ref.scene, sceneOpts, report);
        await drawChrome(painter, i, total, opts, fontBag, report);
        if (opts.watermark) opts.watermark.__behindDone = false;
      } catch (e) {
        if (report) report.warnings.push('Page ' + (i + 1) + ' failed: ' + (e && e.message ? e.message : e));
        if (!painter) {
          var fallback = out.addPage([595.28, 841.89]);
          fallback.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: global.PDFLib.rgb(1, 1, 1) });
        }
      }
      if (opts.onProgress) opts.onProgress(i + 1, total);
      await yieldNow();
    }

    applyMetadata(out, Object.assign({ creator: 'LocalEditor', producer: 'LocalEditor' }, opts.metadata || {}));
    if (opts.formValues || opts.flattenForms || (opts.flatten && opts.formValues)) {
      writeForm(out, opts.formValues || {}, !!(opts.flattenForms || opts.flatten), report);
    }
    var bytes = await out.save();
    report.pageCount = out.getPageCount();
    if (opts.flatten) {
      bytes = await flattenAnnotations(bytes, opts, report);
    }
    if (opts.compress && opts.compress !== 'none') {
      bytes = await compressPdf(bytes, opts.compress, opts, report);
    }
    return attachReport(bytes, report);
  }

  function applyMetadata(doc, meta) {
    if (!meta) return;
    if (meta.title != null) doc.setTitle(String(meta.title));
    if (meta.author != null) doc.setAuthor(String(meta.author));
    if (meta.subject != null) doc.setSubject(String(meta.subject));
    if (meta.creator != null) doc.setCreator(String(meta.creator));
    if (meta.producer != null) doc.setProducer(String(meta.producer));
    if (meta.keywords != null) {
      var kw = meta.keywords;
      if (typeof kw === 'string') kw = kw.split(/\s*,\s*/).filter(Boolean);
      try { doc.setKeywords(kw); } catch (e) {}
    }
    try { doc.setModificationDate(meta.modificationDate ? new Date(meta.modificationDate) : new Date()); } catch (e) {}
    if (meta.creationDate) {
      try { doc.setCreationDate(new Date(meta.creationDate)); } catch (e) {}
    }
  }

  function fieldKind(field) {
    var PDFLib = global.PDFLib;
    if (field instanceof PDFLib.PDFTextField) return 'text';
    if (field instanceof PDFLib.PDFCheckBox) return 'checkbox';
    if (field instanceof PDFLib.PDFRadioGroup) return 'radio';
    if (field instanceof PDFLib.PDFDropdown) return 'dropdown';
    if (field instanceof PDFLib.PDFOptionList) return 'option-list';
    if (field instanceof PDFLib.PDFSignature) return 'signature';
    if (field instanceof PDFLib.PDFButton) return 'button';
    return 'unknown';
  }

  function writeFieldValue(field, value) {
    var type = fieldKind(field);
    if (type === 'text') field.setText(value == null ? '' : String(value));
    else if (type === 'checkbox') {
      var on = value === true || value === 'true' || value === 'Yes' || value === 'On' || value === 'on' || value === 1;
      if (on) field.check(); else field.uncheck();
    } else if (type === 'radio' || type === 'dropdown') field.select(String(value));
    else if (type === 'option-list') field.select(Array.isArray(value) ? value.map(String) : [String(value)]);
  }

  function writeForm(doc, values, doFlatten, report) {
    var form;
    try { form = doc.getForm(); } catch (e) {
      if (report) report.warnings.push('This document has no form to fill.');
      return;
    }
    var fields = [];
    try { fields = form.getFields(); } catch (e) { fields = []; }
    if (!fields.length) {
      if (report && values && Object.keys(values).length) report.warnings.push('This document has no form fields.');
      return;
    }
    Object.keys(values || {}).forEach(function (name) {
      try { writeFieldValue(form.getField(name), values[name]); }
      catch (e) { if (report) report.warnings.push('Could not set form field "' + name + '".'); }
    });
    if (doFlatten) {
      try { form.flatten(); }
      catch (e) { if (report) report.warnings.push('The form could not be flattened.'); }
    }
  }

  async function loadPL(input, opts) {
    await ready();
    var bytes;
    if (input && input._bytes) bytes = input._bytes.slice(0);
    else bytes = await readBytes(input);
    try {
      return await global.PDFLib.PDFDocument.load(bytes, {
        updateMetadata: false,
        ignoreEncryption: false,
        password: opts && opts.password
      });
    } catch (e) {
      if (isEncryptedError(e) || asPasswordError(e)) {
        var err = passwordError('required');
        err.cause = e;
        throw err;
      }
      throw e;
    }
  }

  async function savePL(doc) {
    var bytes = await doc.save();
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  function workspaceFromDoc(doc) {
    var pages = [];
    for (var i = 0; i < doc.pageCount; i++) pages.push({ docId: doc.id, doc: doc, pageIndex: i, rotation: 0 });
    return { pages: pages, docs: [doc] };
  }

  async function ensureDoc(input, opts) {
    if (input && input._pdfjs && input.pages) return input;
    return open(input, opts || {});
  }

  async function pipe(input, extra, opts) {
    var doc = await ensureDoc(input, opts);
    return build(workspaceFromDoc(doc), Object.assign({}, opts || {}, extra || {}));
  }

  function parseRanges(spec, max) {
    var groups = [];
    var pages = [];
    var bad = false;
    if (Array.isArray(spec)) {
      if (spec.length && Array.isArray(spec[0])) {
        spec.forEach(function (group) {
          var g = [];
          group.forEach(function (n) {
            n = n | 0;
            if (n >= 1 && n <= max) { g.push(n); pages.push(n); }
          });
          if (g.length) groups.push(g);
        });
        return { groups: groups, pages: pages, bad: false };
      }
      var flat = [];
      spec.forEach(function (n) {
        n = n | 0;
        if (n >= 1 && n <= max) flat.push(n);
      });
      if (flat.length) groups.push(flat);
      return { groups: groups, pages: flat, bad: false };
    }
    String(spec || '').split(/[,;]+/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var ranged = part.match(/^(\d+)?\s*-\s*(\d+)?$/);
      var a, b;
      if (ranged) {
        a = ranged[1] ? +ranged[1] : 1;
        b = ranged[2] ? +ranged[2] : max;
      } else if (/^\d+$/.test(part)) a = b = +part;
      else { bad = true; return; }
      a = Math.max(1, a);
      b = Math.min(max, b);
      if (a > b) {
        if (a > max) { bad = true; return; }
        var swap = a; a = b; b = swap;
      }
      var g = [];
      for (var i = a; i <= b; i++) { g.push(i); pages.push(i); }
      if (g.length) groups.push(g);
    });
    return { groups: groups, pages: pages, bad: bad };
  }

  function isWorkspace(input) {
    return !!(input && (Array.isArray(input) || Array.isArray(input.pages)) && !input._pdfjs && !(input instanceof Uint8Array) && !(typeof Blob !== 'undefined' && input instanceof Blob));
  }

  async function split(input, ranges, opts) {
    opts = opts || {};
    if (isWorkspace(input)) {
      var model = normalizeWorkspace(input);
      var parsed = parseRanges(ranges, model.pages.length);
      var outputs = [];
      for (var i = 0; i < parsed.groups.length; i++) {
        var subset = ownCopy({}, model, {
          pages: parsed.groups[i].map(function (n) { return model.pages[n - 1]; })
        });
        outputs.push(await build(subset, opts));
        if (opts.onProgress) opts.onProgress(i + 1, parsed.groups.length);
        await yieldNow();
      }
      return outputs;
    }
    var doc = await ensureDoc(input, opts);
    if (doc.encrypted) {
      return split(workspaceFromDoc(doc), ranges, opts);
    }
    var pl = await pdfLibOf(doc);
    var parsedBytes = parseRanges(ranges, pl.getPageCount());
    var parts = [];
    for (var g = 0; g < parsedBytes.groups.length; g++) {
      var out = await global.PDFLib.PDFDocument.create();
      var indexes = parsedBytes.groups[g].map(function (n) { return n - 1; });
      var copied = await out.copyPages(pl, indexes);
      copied.forEach(function (p) { out.addPage(p); });
      applyMetadata(out, { creator: 'LocalEditor', producer: 'LocalEditor' });
      parts.push(await savePL(out));
      if (opts.onProgress) opts.onProgress(g + 1, parsedBytes.groups.length);
      await yieldNow();
    }
    return parts;
  }

  async function extract(input, ranges, opts) {
    opts = opts || {};
    if (isWorkspace(input)) {
      var model = normalizeWorkspace(input);
      var parsed = parseRanges(ranges, model.pages.length);
      var pages = parsed.pages.map(function (n) { return model.pages[n - 1]; });
      return build(ownCopy({}, model, { pages: pages }), opts);
    }
    var doc = await ensureDoc(input, opts);
    if (doc.encrypted) return extract(workspaceFromDoc(doc), ranges, opts);
    var pl = await pdfLibOf(doc);
    var parsedBytes = parseRanges(ranges, pl.getPageCount());
    var out = await global.PDFLib.PDFDocument.create();
    var indexes = parsedBytes.pages.map(function (n) { return n - 1; });
    if (!indexes.length) throw new Error('No pages selected');
    var copied = await out.copyPages(pl, indexes);
    copied.forEach(function (p) { out.addPage(p); });
    applyMetadata(out, { creator: 'LocalEditor', producer: 'LocalEditor' });
    return savePL(out);
  }

  async function fromImages(images, opts) {
    opts = opts || {};
    await ready();
    var list = Array.isArray(images) ? images : [images];
    var doc = await global.PDFLib.PDFDocument.create();
    var report = freshReport();
    for (var i = 0; i < list.length; i++) {
      var canvas = await rasterAny(list[i]);
      if (!canvas) continue;
      var lay = layoutImage(canvas.width, canvas.height, opts);
      var page = doc.addPage([lay.pw, lay.ph]);
      page.drawRectangle({ x: 0, y: 0, width: lay.pw, height: lay.ph, color: parseColor(opts.background || '#ffffff') });
      var embedded = await embedImageSource(doc, canvas);
      page.drawImage(embedded, { x: lay.x, y: lay.ph - lay.y - lay.h, width: lay.w, height: lay.h });
      if (opts.onProgress) opts.onProgress(i + 1, list.length);
      await yieldNow();
    }
    if (!doc.getPageCount()) throw new Error('No images to place');
    applyMetadata(doc, Object.assign({ creator: 'LocalEditor', producer: 'LocalEditor' }, opts.metadata || {}));
    report.pageCount = doc.getPageCount();
    return attachReport(await savePL(doc), report);
  }

  async function toImages(input, opts) {
    opts = opts || {};
    var doc = await ensureDoc(input, opts);
    var format = (opts.format || opts.type || 'png').toLowerCase();
    var mime = format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png';
    var images = [];
    for (var i = 0; i < doc.pageCount; i++) {
      var canvas = await doc.render(i, opts.scale || capScale(0));
      var bytes = mime === 'image/jpeg' ? await jpegCanvas(canvas, opts.quality == null ? 0.9 : opts.quality) : await canvasToBytes(canvas, 'image/png');
      images.push({
        page: i,
        blob: new Blob([bytes], { type: mime }),
        width: canvas.width,
        height: canvas.height
      });
      if (opts.onProgress) opts.onProgress(i + 1, doc.pageCount);
      await yieldNow();
    }
    return images;
  }

  async function insertPages(base, extra, index, opts) {
    opts = opts || {};
    var doc = await loadPL(base, opts);
    var other = await loadPL(extra, opts);
    var copied = await doc.copyPages(other, other.getPageIndices());
    var at = index == null ? doc.getPageCount() : (index | 0);
    at = clamp(at, 0, doc.getPageCount());
    for (var i = 0; i < copied.length; i++) doc.insertPage(at + i, copied[i]);
    if (opts.onProgress) opts.onProgress(1, 1);
    return savePL(doc);
  }

  async function duplicatePage(input, pageIndex, opts) {
    var doc = await loadPL(input, opts);
    var index = pageIndex | 0;
    var copied = await doc.copyPages(doc, [index]);
    doc.insertPage(Math.min(doc.getPageCount(), index + 1), copied[0]);
    return savePL(doc);
  }

  async function deletePages(input, indices, opts) {
    var doc = await loadPL(input, opts);
    var list = normalizeIndexList(indices, doc.getPageCount()).sort(function (a, b) { return b - a; });
    list.forEach(function (i) { if (i >= 0 && i < doc.getPageCount()) doc.removePage(i); });
    if (!doc.getPageCount()) throw new Error('A PDF needs at least one page');
    return savePL(doc);
  }

  function normalizeIndexList(indices, count) {
    if (typeof indices === 'string') return parseRanges(indices, count).pages.map(function (n) { return n - 1; });
    if (typeof indices === 'number') return [indices];
    return (indices || []).map(function (n) { return n | 0; });
  }

  async function rotatePages(input, angle, indices, opts) {
    var doc = await loadPL(input, opts);
    var pages = doc.getPages();
    var set = null;
    if (indices != null) {
      set = Object.create(null);
      normalizeIndexList(indices, pages.length).forEach(function (i) { set[i] = true; });
    }
    pages.forEach(function (page, i) {
      if (set && !set[i]) return;
      var next = norm90((page.getRotation().angle || 0) + num(angle, 90));
      page.setRotation(global.PDFLib.degrees(next));
    });
    return savePL(doc);
  }

  async function reversePages(input, opts) {
    var doc = await loadPL(input, opts);
    var count = doc.getPageCount();
    var order = [];
    for (var i = count - 1; i >= 0; i--) order.push(i);
    return reorderCopy(doc, order);
  }

  function scanOrder(count, mode) {
    var n = count | 0;
    mode = String(mode || 'odd-even');
    if (mode === 'reverse') {
      var rev = [];
      for (var r = n - 1; r >= 0; r--) rev.push(r);
      return rev;
    }
    var splitAt = Math.ceil(n / 2);
    var first = [];
    var second = [];
    for (var i = 0; i < n; i++) (i < splitAt ? first : second).push(i);
    if (/reverse/.test(mode)) second = second.slice().reverse();
    var out = [];
    var evenFirst = mode.indexOf('even-odd') === 0;
    var len = Math.max(first.length, second.length);
    for (var k = 0; k < len; k++) {
      if (evenFirst) {
        if (k < second.length) out.push(second[k]);
        if (k < first.length) out.push(first[k]);
      } else {
        if (k < first.length) out.push(first[k]);
        if (k < second.length) out.push(second[k]);
      }
    }
    return out;
  }

  async function reorderCopy(doc, order) {
    var out = await global.PDFLib.PDFDocument.create();
    var copied = await out.copyPages(doc, order);
    copied.forEach(function (p) { out.addPage(p); });
    try {
      if (doc.getTitle()) out.setTitle(doc.getTitle());
      if (doc.getAuthor()) out.setAuthor(doc.getAuthor());
    } catch (e) {}
    out.setCreator('LocalEditor');
    out.setProducer('LocalEditor');
    return savePL(out);
  }

  async function sortOddEven(input, mode, opts) {
    var doc = await loadPL(input, opts);
    return reorderCopy(doc, scanOrder(doc.getPageCount(), mode || 'odd-even'));
  }

  function cloneRef(page) {
    var copy = {};
    Object.keys(page || {}).forEach(function (k) { copy[k] = page[k]; });
    if (page && page.scene) {
      try { copy.scene = JSON.parse(JSON.stringify(page.scene)); } catch (e) { copy.scene = page.scene; }
    }
    return copy;
  }

  var order = {
    reverse: function (pages) { return (pages || []).slice().reverse(); },
    scan: function (pages, mode) {
      return scanOrder((pages || []).length, mode).map(function (i) { return pages[i]; });
    },
    duplicate: function (pages, index) {
      var copy = (pages || []).slice();
      copy.splice(index + 1, 0, cloneRef(copy[index]));
      return copy;
    },
    remove: function (pages, indices) {
      var drop = Object.create(null);
      normalizeIndexList(indices, (pages || []).length).forEach(function (i) { drop[i] = true; });
      return (pages || []).filter(function (_, i) { return !drop[i]; });
    },
    rotate: function (pages, index, angle) {
      var copy = (pages || []).slice();
      var item = cloneRef(copy[index]);
      item.rotation = norm90(num(item.rotation, 0) + num(angle, 90));
      copy[index] = item;
      return copy;
    },
    move: function (pages, from, to) {
      var copy = (pages || []).slice();
      if (from < 0 || from >= copy.length) return copy;
      var item = copy.splice(from, 1)[0];
      copy.splice(clamp(to, 0, copy.length), 0, item);
      return copy;
    }
  };

  async function flattenAnnotations(bytes, opts, report) {
    var opened = await open(bytes);
    var pl = await global.PDFLib.PDFDocument.load(bytes.slice(0), { updateMetadata: false });
    var out = await global.PDFLib.PDFDocument.create();
    var dpi = num(opts.dpi, 144);
    for (var i = 0; i < opened.pageCount; i++) {
      var page = await opened._pdfjs.getPage(i + 1);
      var annots = [];
      try { annots = await page.getAnnotations({ intent: 'display' }); } catch (e) { annots = []; }
      var meaningful = annots.filter(function (a) {
        return a && a.subtype && a.subtype !== 'Link' && a.subtype !== 'Popup';
      });
      if (opts.all || meaningful.length) {
        var rendered = await renderPdfPage(opened._pdfjs, i, page.rotate || 0, dpi / 72);
        var np = out.addPage([rendered.width, rendered.height]);
        await paintFullImage(out, np, rendered.canvas, 'image/jpeg', 0.85);
        report.rasterizedPages.push(i);
        report.textSelectable[i] = false;
        report.warnings.push('Page ' + (i + 1) + ' annotations were flattened. Text on that page is no longer selectable.');
      } else {
        var copied = await out.copyPages(pl, [i]);
        out.addPage(copied[0]);
      }
      page.cleanup();
      if (opts.onProgress) opts.onProgress(i + 1, opened.pageCount);
      await yieldNow();
    }
    opened.close();
    applyMetadata(out, { creator: 'LocalEditor', producer: 'LocalEditor' });
    report.pageCount = out.getPageCount();
    return savePL(out);
  }

  async function compressPdf(bytes, mode, opts, report) {
    var quality = mode === 'small' ? 0.55 : 0.75;
    var dpi = mode === 'small' ? 110 : 150;
    var opened = await open(bytes);
    var pl = await global.PDFLib.PDFDocument.load(bytes.slice(0), { updateMetadata: false });
    var out = await global.PDFLib.PDFDocument.create();
    for (var i = 0; i < opened.pageCount; i++) {
      var single = await global.PDFLib.PDFDocument.create();
      var one = await single.copyPages(pl, [i]);
      single.addPage(one[0]);
      var original = await single.save();
      var rendered = await renderPdfPage(opened._pdfjs, i, opened.pages[i].rotation || 0, dpi / 72);
      var jpeg = await jpegCanvas(rendered.canvas, quality);
      if (jpeg.length + 12000 >= original.length) {
        var kept = await out.copyPages(pl, [i]);
        out.addPage(kept[0]);
        report.keptVectorPages.push(i);
        if (report.textSelectable[i] == null) report.textSelectable[i] = true;
      } else {
        var np = out.addPage([rendered.width, rendered.height]);
        var image = await out.embedJpg(jpeg);
        np.drawImage(image, { x: 0, y: 0, width: rendered.width, height: rendered.height });
        report.compressedPages.push(i);
        report.rasterizedPages.push(i);
        report.textSelectable[i] = false;
        report.warnings.push('Page ' + (i + 1) + ' was compressed to JPEG. Text on that page is no longer selectable.');
      }
      if (opts.onProgress) opts.onProgress(i + 1, opened.pageCount);
      await yieldNow();
    }
    opened.close();
    applyMetadata(out, { creator: 'LocalEditor', producer: 'LocalEditor' });
    report.pageCount = out.getPageCount();
    return savePL(out);
  }

  function pageNumbers(input, settings, opts) { return pipe(input, { pageNumbers: settings || {} }, opts); }
  function watermark(input, settings, opts) { return pipe(input, { watermark: settings || {} }, opts); }
  function headerFooter(input, settings, opts) { return pipe(input, { headerFooter: settings || {} }, opts); }
  function bates(input, settings, opts) { return pipe(input, { bates: settings || {} }, opts); }
  function redactDoc(input, redactions, opts) { return pipe(input, { redactions: redactions || [], dpi: opts && opts.dpi }, opts); }
  function compressDoc(input, mode, opts) { return pipe(input, { compress: mode || 'balanced' }, opts); }
  function flattenDoc(input, opts) { return pipe(input, { flatten: true, dpi: opts && opts.dpi }, opts); }

  async function setMetadata(input, meta, opts) {
    var doc = await loadPL(input, opts);
    applyMetadata(doc, meta || {});
    return savePL(doc);
  }

  async function fillForm(input, values, opts) {
    opts = opts || {};
    var doc = await loadPL(input, opts);
    var report = freshReport();
    writeForm(doc, values || {}, !!opts.flatten, report);
    var bytes = await savePL(doc);
    report.pageCount = doc.getPageCount();
    return attachReport(bytes, report);
  }

  function normPenPoints(points) {
    return (points || []).map(function (p) {
      if (Array.isArray(p)) return { x: num(p[0], NaN), y: num(p[1], NaN), p: p[2] == null ? null : num(p[2], 0.5), t: p[3] };
      return { x: num(p.x, NaN), y: num(p.y, NaN), p: p.pressure == null ? (p.p == null ? null : num(p.p, 0.5)) : num(p.pressure, 0.5), t: p.t || p.time || null };
    }).filter(function (p) { return isFinite(p.x) && isFinite(p.y); });
  }

  function smoothPen(pts, amount) {
    if (pts.length < 3 || !amount) return pts;
    var out = pts.slice();
    var passes = Math.max(1, Math.round(clamp(amount, 0, 1) * 4));
    for (var pass = 0; pass < passes; pass++) {
      var next = [out[0]];
      for (var i = 1; i < out.length - 1; i++) {
        next.push({
          x: out[i].x * 0.62 + out[i - 1].x * 0.19 + out[i + 1].x * 0.19,
          y: out[i].y * 0.62 + out[i - 1].y * 0.19 + out[i + 1].y * 0.19,
          p: out[i].p,
          t: out[i].t
        });
      }
      next.push(out[out.length - 1]);
      out = next;
    }
    return out;
  }

  function signatureFromPoints(points, opts) {
    opts = opts || {};
    var pts = smoothPen(normPenPoints(points), opts.smoothing == null ? 0.65 : opts.smoothing);
    var canvas = document.createElement('canvas');
    if (pts.length < 2) {
      canvas.width = 4;
      canvas.height = 4;
      return canvas;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    var pad = 18;
    var speeds = [];
    for (var i = 1; i < pts.length; i++) {
      var dist = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      var dt = pts[i].t != null && pts[i - 1].t != null ? Math.max(8, pts[i].t - pts[i - 1].t) : 16;
      speeds.push(dist / dt);
    }
    var sorted = speeds.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0.4;
    var base = num(opts.width, 2.6);
    canvas.width = Math.max(8, Math.ceil(maxX - minX + pad * 2));
    canvas.height = Math.max(8, Math.ceil(maxY - minY + pad * 2));
    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.color || '#16141c';
    for (var s = 1; s < pts.length; s++) {
      var speed = speeds[s - 1] || median;
      var pressure = pts[s].p == null ? 0.7 : clamp(pts[s].p, 0.15, 1);
      var width = base * clamp(1.35 - speed / (median || 0.4) * 0.55, 0.32, 1.85) * (0.55 + pressure * 0.7);
      ctx.beginPath();
      ctx.lineWidth = width;
      ctx.moveTo(pts[s - 1].x - minX + pad, pts[s - 1].y - minY + pad);
      if (s < pts.length - 1) {
        var mx = (pts[s].x + pts[s + 1].x) / 2;
        var my = (pts[s].y + pts[s + 1].y) / 2;
        ctx.quadraticCurveTo(pts[s].x - minX + pad, pts[s].y - minY + pad, mx - minX + pad, my - minY + pad);
      } else {
        ctx.lineTo(pts[s].x - minX + pad, pts[s].y - minY + pad);
      }
      ctx.stroke();
    }
    return canvas;
  }

  function signatureFromText(text, family, color) {
    return (async function () {
      text = String(text || '');
      family = family || 'Great Vibes';
      if (LE.fonts && typeof LE.fonts.load === 'function') {
        try { await LE.fonts.load(family, 400, false); } catch (e) {}
      }
      var css = (LE.fonts && typeof LE.fonts.css === 'function') ? LE.fonts.css(family) : '"' + family + '", cursive';
      var probe = document.createElement('canvas').getContext('2d');
      var fontSize = 72;
      probe.font = fontSize + 'px ' + css;
      var width = Math.ceil(probe.measureText(text || ' ').width + 36);
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(32, width);
      canvas.height = Math.ceil(fontSize * 1.45);
      var ctx = canvas.getContext('2d');
      ctx.font = fontSize + 'px ' + css;
      ctx.fillStyle = color || '#1a1a1a';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 16, canvas.height / 2);
      return canvas;
    })();
  }

  function cleanSignatureImage(canvasOrImage, opts) {
    opts = opts || {};
    var srcW = canvasOrImage.naturalWidth || canvasOrImage.width;
    var srcH = canvasOrImage.naturalHeight || canvasOrImage.height;
    var canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcH;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvasOrImage, 0, 0, srcW, srcH);
    var img = ctx.getImageData(0, 0, srcW, srcH);
    var d = img.data;
    function sample(x, y) {
      var i = (Math.max(0, Math.min(srcH - 1, y)) * srcW + Math.max(0, Math.min(srcW - 1, x))) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    }
    var spots = [sample(2, 2), sample(srcW - 3, 2), sample(2, srcH - 3), sample(srcW - 3, srcH - 3)];
    var br = 0, bg = 0, bb = 0;
    spots.forEach(function (s) { br += s[0]; bg += s[1]; bb += s[2]; });
    br /= spots.length; bg /= spots.length; bb /= spots.length;
    var paper = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
    var threshold = num(opts.threshold, 46);
    var ink = opts.color ? hexToRgb(opts.color) : null;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      var dist = Math.hypot(d[i] - br, d[i + 1] - bg, d[i + 2] - bb);
      var darkness = paper - lum;
      var alpha = 0;
      if (darkness <= threshold * 0.28 && dist < threshold) alpha = 0;
      else if (darkness >= threshold || dist >= threshold * 1.7) alpha = 255;
      else alpha = Math.round(clamp((Math.max(darkness, dist * 0.65) - threshold * 0.28) / threshold, 0, 1) * 255);
      alpha = Math.round(alpha * (d[i + 3] / 255));
      if (ink) { d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2]; }
      d[i + 3] = alpha;
    }
    ctx.putImageData(img, 0, 0);
    var bounds = { minX: srcW, minY: srcH, maxX: 0, maxY: 0, any: false };
    for (var y = 0; y < srcH; y++) {
      for (var x = 0; x < srcW; x++) {
        if (d[(y * srcW + x) * 4 + 3] > 12) {
          bounds.any = true;
          if (x < bounds.minX) bounds.minX = x;
          if (y < bounds.minY) bounds.minY = y;
          if (x > bounds.maxX) bounds.maxX = x;
          if (y > bounds.maxY) bounds.maxY = y;
        }
      }
    }
    if (!bounds.any) return canvas;
    var pad = 8;
    var tw = Math.min(srcW, bounds.maxX - bounds.minX + 1 + pad * 2);
    var th = Math.min(srcH, bounds.maxY - bounds.minY + 1 + pad * 2);
    var trimmed = document.createElement('canvas');
    trimmed.width = tw;
    trimmed.height = th;
    trimmed.getContext('2d').drawImage(canvas, bounds.minX - pad, bounds.minY - pad, tw, th, 0, 0, tw, th);
    return trimmed;
  }

  function sigDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Signatures need IndexedDB'));
        return;
      }
      var req;
      try { req = indexedDB.open('le-signatures', 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('signatures')) db.createObjectStore('signatures', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open signatures')); };
      req.onblocked = function () { reject(new Error('Signatures database is open in another tab')); };
    });
  }

  function sigStore(mode, fn) {
    return sigDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        function done(err, value) {
          if (settled) return;
          settled = true;
          try { db.close(); } catch (e) {}
          if (err) reject(err);
          else resolve(value);
        }
        var tx;
        try { tx = db.transaction('signatures', mode); }
        catch (e2) { done(e2); return; }
        var store = tx.objectStore('signatures');
        var req;
        try { req = fn(store); }
        catch (e3) { done(e3); return; }
        tx.oncomplete = function () { done(null, req.result); };
        tx.onerror = function () { done(tx.error || new Error('Signature save failed')); };
        tx.onabort = function () { done(tx.error || new Error('Signature save was aborted')); };
      });
    });
  }

  var signatures = {
    list: function () {
      return sigStore('readonly', function (store) { return store.getAll(); }).then(function (rows) {
        rows = rows || [];
        rows.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return rows;
      });
    },
    save: function (entry) {
      entry = entry || {};
      var item = {
        id: entry.id || uid('sig'),
        name: String(entry.name || 'Signature'),
        kind: entry.kind === 'type' || entry.kind === 'upload' ? entry.kind : 'draw',
        png: entry.png || '',
        points: entry.points || null,
        createdAt: entry.createdAt || Date.now()
      };
      if (!item.png && entry.canvas) item.png = entry.canvas.toDataURL('image/png');
      if (!item.png && item.points) item.png = signatureFromPoints(item.points, entry).toDataURL('image/png');
      if (!item.png) return Promise.reject(new Error('Signature needs a drawing, image, or text'));
      return sigStore('readwrite', function (store) { return store.put(item); }).then(function () { return item; });
    },
    remove: function (id) {
      return sigStore('readwrite', function (store) { return store.delete(id); }).then(function () { return true; });
    }
  };

  LE.pdf = {
    ready: ready,
    open: open,
    build: build,
    split: split,
    extract: extract,
    fromImages: fromImages,
    toImages: toImages,
    insert: insertPages,
    duplicate: duplicatePage,
    deletePages: deletePages,
    rotate: rotatePages,
    reverse: reversePages,
    sortOddEven: sortOddEven,
    scanOrder: scanOrder,
    parseRanges: parseRanges,
    pageNumbers: pageNumbers,
    watermark: watermark,
    headerFooter: headerFooter,
    bates: bates,
    setMetadata: setMetadata,
    fillForm: fillForm,
    flatten: flattenDoc,
    redact: redactDoc,
    compress: compressDoc,
    order: order,
    signatures: signatures,
    signatureFromPoints: signatureFromPoints,
    signatureFromText: signatureFromText,
    cleanSignatureImage: cleanSignatureImage,
    embedFont: embedFont,
    fontFileForPdf: fontFileForPdf,
    lastReport: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
