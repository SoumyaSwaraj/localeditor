/* LocalEditor: styled QR codes. LE.qr — one engine for the tool page, the studio, makers, agents and the command line.
   Docs: docs/QR.md. Plain data in (a style spec), SVG / canvas / design layers out. Nothing leaves the device.

   - matrix(text, { ec })        the modules, from the vendored encoder (assets/vendor/qrcode.js)
   - svg(spec)                   one self-contained SVG string: no script, no links, pictures only as data: images
   - canvas(spec, px)            Promise<canvas> (browser only), drawn from that same SVG
   - layers(spec, box)           ordinary design layers (open format) to design around
   - check(spec)                 Promise<{ ok, contrast, quiet, logoCover, decoded, notes[] }>: contrast, quiet zone,
                                 picture cover against the error-correction budget and a real decode at two sizes
   - encode(type, values)        link, text, wifi, contact, email, phone, sms, chat, location, event, pay
   - presets(brand), clean(spec), fileName(text, ext), TYPES, SHAPES, EYES, FRAMES, LIMITS

   A spec with only { text, fg, bg, ec } is the studio's old plain code and is drawn exactly as before. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  var doc = typeof document !== 'undefined' ? document : null;
  var BASE = (function () {
    try { return doc && doc.currentScript && doc.currentScript.src ? doc.currentScript.src.replace(/[^\/]*$/, '') : '../assets/js/'; } catch (e) { return '../assets/js/'; }
  })();
  var VENDOR = BASE.replace(/js\/$/, 'vendor/');

  var LIMITS = { text: 1200, dense: 10, veryDense: 20, picture: 120000, frameText: 32, logoMax: 0.3, logoHard: 0.42, cover: 0.12, svg: 190000 };
  var SHAPES = ['square', 'rounded', 'dots', 'diamond', 'vbars', 'hbars', 'connected'];
  /* Corner "eyes". Scanners find a code by the 1:1:3:1:1 rhythm of its corners along rows, columns and diagonals, so a
     centre only reads reliably inside a frame of a similar roundness: pairs lists what goes with what (first = the match). */
  var EYES = { outer: ['square', 'rounded', 'circle', 'leaf'], inner: ['square', 'rounded', 'dot', 'leaf'], pairs: { square: ['square', 'rounded'], rounded: ['rounded', 'dot', 'leaf'], circle: ['dot'], leaf: ['leaf', 'rounded'] } };
  var FRAMES = ['none', 'label', 'tab', 'badge', 'ticket'];
  var EC = ['L', 'M', 'Q', 'H'];
  var BUDGET = { L: 0.07, M: 0.15, Q: 0.25, H: 0.30 };
  var DATA_IMG = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/;
  var FONT = 'system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

  /* ---------- small helpers ---------- */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function f(x) { var s = String(Math.round(x * 100) / 100); return s.replace(/^(-?)0\./, '$1.'); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function lazy(src) {
    if (LE.lazy && LE.lazy !== lazy) return LE.lazy(src);
    if (!doc) return Promise.reject(new Error('no document'));
    lazy.jobs = lazy.jobs || {};
    if (!lazy.jobs[src]) lazy.jobs[src] = new Promise(function (ok, no) { var s = doc.createElement('script'); s.src = src; s.async = true; s.onload = function () { ok(); }; s.onerror = function () { delete lazy.jobs[src]; no(new Error('Could not load ' + src)); }; doc.head.appendChild(s); });
    return lazy.jobs[src];
  }

  /* ---------- colour ---------- */
  function hex(c) {
    c = String(c == null ? '' : c).trim().toLowerCase();
    var m = /^#?([0-9a-f]{3})$/.exec(c);
    if (m) return '#' + m[1].replace(/./g, '$&$&');
    m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c);
    return m ? '#' + m[1] : null;
  }
  function rgb(c) { c = hex(c) || '#000000'; return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function lum(c) { var p = rgb(c).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { var p = rgb(a), q = rgb(b); return '#' + p.map(function (v, i) { return ('0' + Math.round(v + (q[i] - v) * t).toString(16)).slice(-2); }).join(''); }
  function toward(c, target, against, want) { for (var t = 0; t <= 1.001; t += 0.05) { var m = mix(c, target, t); if (ratio(m, against) >= want) return m; } return target; }
  function inkOn(c) { return lum(c) > 0.4 ? '#17131f' : '#ffffff'; }
  function stopsOf(fg) { return isObj(fg) ? fg.stops.map(function (s) { return s.color; }) : [fg]; }

  /* ---------- the spec: plain data, whitelisted ---------- */
  function cleanFill(v, d) {
    if (isObj(v) && Array.isArray(v.stops)) {
      var stops = v.stops.slice(0, 3).map(function (s, i, a) {
        var c = hex(isObj(s) ? s.color : s);
        return c ? { at: clamp(isObj(s) && s.at != null ? s.at : i / Math.max(1, a.length - 1), 0, 1), color: c } : null;
      }).filter(Boolean);
      if (stops.length >= 2) return { type: v.type === 'radial' ? 'radial' : 'linear', angle: Math.round(clamp(v.angle == null ? 45 : v.angle, 0, 360)), stops: stops };
      return stops.length ? stops[0].color : d;
    }
    return hex(v) || d;
  }
  function cleanPicture(v) { return isObj(v) && typeof v.src === 'string' && v.src.length <= LIMITS.picture && DATA_IMG.test(v.src) ? v.src : null; }
  /* clean(spec) → a new spec with only known keys and safe values. Unknown keys are dropped; nothing is interpreted. */
  function clean(spec) {
    spec = isObj(spec) ? spec : {};
    var o = { text: String(spec.text == null ? '' : spec.text).slice(0, LIMITS.text), fg: cleanFill(spec.fg, '#17131f'), ec: oneOf(spec.ec, EC, 'M') };
    o.bg = spec.bg === null || spec.bg === 'transparent' || spec.bg === 'none' ? null : hex(spec.bg) || '#ffffff';
    if (spec.shape != null) o.shape = oneOf(spec.shape, SHAPES, 'square');
    if (isObj(spec.eye)) {
      o.eye = { outer: oneOf(spec.eye.outer, EYES.outer, 'square'), inner: oneOf(spec.eye.inner, EYES.inner, 'square') };
      if (hex(spec.eye.outerColor)) o.eye.outerColor = hex(spec.eye.outerColor);
      if (hex(spec.eye.innerColor)) o.eye.innerColor = hex(spec.eye.innerColor);
    }
    if (spec.quiet != null) o.quiet = Math.round(clamp(spec.quiet, 0, 8));
    if (spec.radius != null) o.radius = Math.round(clamp(spec.radius, 0, 0.25) * 100) / 100;
    var src = cleanPicture(spec.image);
    if (src) {
      o.image = { src: src, size: Math.round(clamp(spec.image.size == null ? 0.22 : spec.image.size, 0.1, LIMITS.logoHard) * 100) / 100, fit: spec.image.fit === 'cover' ? 'cover' : 'contain', round: Math.round(clamp(spec.image.round == null ? 0.2 : spec.image.round, 0, 0.5) * 100) / 100 };
      if (spec.image.plate === null) o.image.plate = null; else if (hex(spec.image.plate)) o.image.plate = hex(spec.image.plate);
    }
    src = cleanPicture(spec.picture);
    if (src) o.picture = { src: src, dim: Math.round(clamp(spec.picture.dim == null ? 0.6 : spec.picture.dim, 0.35, 0.9) * 100) / 100 };
    if (isObj(spec.frame) && oneOf(spec.frame.style, FRAMES, 'none') !== 'none') {
      o.frame = { style: spec.frame.style, text: String(spec.frame.text == null ? 'Scan me' : spec.frame.text).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, LIMITS.frameText) };
      if (hex(spec.frame.color)) o.frame.color = hex(spec.frame.color);
      if (hex(spec.frame.ink)) o.frame.ink = hex(spec.frame.ink);
    }
    return o;
  }
  /* The studio's old entries: { text, fg, bg, ec } and nothing else, one flat colour. Drawn exactly as they always were. */
  function isPlain(spec) {
    return isObj(spec) && !isObj(spec.fg) && spec.shape == null && spec.eye == null && spec.quiet == null && spec.radius == null && spec.image == null && spec.picture == null && spec.frame == null;
  }
  function ecOf(spec) { return spec.image ? 'H' : spec.picture && spec.ec !== 'H' ? 'Q' : spec.ec || 'M'; }

  /* ---------- modules ---------- */
  function encoder() {
    var q = global.qrcode;
    if (!q && typeof require === 'function') { try { q = global.qrcode = require('../vendor/qrcode.js'); } catch (e) { /* not on disk */ } }
    if (!q) throw new Error('The QR encoder is not loaded yet.');
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    return q;
  }
  function ready() { return global.qrcode ? Promise.resolve(LE.qr) : lazy(VENDOR + 'qrcode.js').then(function () { encoder(); return LE.qr; }); }
  function matrix(text, o) {
    var code = encoder()(0, oneOf(o && o.ec, EC, 'M'));
    code.addData(String(text == null || text === '' ? ' ' : text), 'Byte');
    try { code.make(); } catch (e) { var err = new Error('That is too long for a QR code. Shorten it.'); err.code = 'too-long'; throw err; }
    var n = code.getModuleCount(), rows = [];
    for (var r = 0; r < n; r++) { var row = new Uint8Array(n); for (var c = 0; c < n; c++) row[c] = code.isDark(r, c) ? 1 : 0; rows.push(row); }
    return { n: n, version: (n - 17) / 4, ec: oneOf(o && o.ec, EC, 'M'), rows: rows, dark: function (r, c) { return r >= 0 && c >= 0 && r < n && c < n && rows[r][c] === 1; } };
  }

  /* ---------- path pieces (module units) ---------- */
  function rrect(x, y, w, h, r) {
    r = typeof r === 'number' ? [r, r, r, r] : r;
    var a = r[0], b = r[1], c = r[2], d = r[3];
    return 'M' + f(x + a) + ' ' + f(y) + 'h' + f(w - a - b) + (b ? 'a' + f(b) + ' ' + f(b) + ' 0 0 1 ' + f(b) + ' ' + f(b) : '') + 'v' + f(h - b - c) + (c ? 'a' + f(c) + ' ' + f(c) + ' 0 0 1 ' + f(-c) + ' ' + f(c) : '') +
      'h' + f(-(w - c - d)) + (d ? 'a' + f(d) + ' ' + f(d) + ' 0 0 1 ' + f(-d) + ' ' + f(-d) : '') + 'v' + f(-(h - d - a)) + (a ? 'a' + f(a) + ' ' + f(a) + ' 0 0 1 ' + f(a) + ' ' + f(-a) : '') + 'z';
  }
  function circle(cx, cy, r) { return 'M' + f(cx - r) + ' ' + f(cy) + 'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(2 * r) + ' 0a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(-2 * r) + ' 0z'; }
  function diamond(x, y) {
    var k = 0.14, a = 0.52, cx = x + 0.5, cy = y + 0.5;
    return 'M' + f(cx - k) + ' ' + f(cy - a + k) + 'Q' + f(cx) + ' ' + f(cy - a) + ' ' + f(cx + k) + ' ' + f(cy - a + k) + 'L' + f(cx + a - k) + ' ' + f(cy - k) + 'Q' + f(cx + a) + ' ' + f(cy) + ' ' + f(cx + a - k) + ' ' + f(cy + k) +
      'L' + f(cx + k) + ' ' + f(cy + a - k) + 'Q' + f(cx) + ' ' + f(cy + a) + ' ' + f(cx - k) + ' ' + f(cy + a - k) + 'L' + f(cx - a + k) + ' ' + f(cy + k) + 'Q' + f(cx - a) + ' ' + f(cy) + ' ' + f(cx - a + k) + ' ' + f(cy - k) + 'z';
  }
  /* Data modules as one path element. on(r, c) says whether a module is drawn (dark, outside the eyes and the picture
     plate). Dots, bars, rounded squares and diamonds are short strokes with round caps and joins, which keeps the markup small. */
  function modulesPath(n, on, shape, ox, oy, fill) {
    var d = '', r, c, run, sw = 0;
    if (shape === 'vbars') {
      for (c = 0; c < n; c++) for (r = 0, run = -1; r <= n; r++) {
        if (r < n && on(r, c)) { if (run < 0) run = r; } else if (run >= 0) { d += 'M' + f(ox + c + 0.5) + ' ' + f(oy + run + 0.45) + 'v' + f(r - run - 0.9); run = -1; }
      }
      sw = 0.78;
    } else for (r = 0; r < n; r++) for (c = 0, run = -1; c <= n; c++) {
      var dark = c < n && on(r, c);
      if (shape === 'square' || shape === 'hbars' || shape === 'connected') {
        if (dark) { if (run < 0) run = c; continue; }
        if (run < 0) continue;
        var x = ox + run, y = oy + r, len = c - run;
        if (shape === 'square') d += 'M' + f(x) + ' ' + f(y) + 'h' + len + 'v1h-' + len + 'z';
        else if (shape === 'hbars') { d += 'M' + f(x + 0.45) + ' ' + f(y + 0.5) + 'h' + f(len - 0.9); sw = 0.78; }
        else d += rrect(x, y, len, 1, [on(r - 1, run) ? 0 : 0.5, on(r - 1, c - 1) ? 0 : 0.5, on(r + 1, c - 1) ? 0 : 0.5, on(r + 1, run) ? 0 : 0.5]);
        run = -1;
      } else if (dark) {
        if (shape === 'dots') { d += 'M' + f(ox + c + 0.5) + ' ' + f(oy + r + 0.5) + 'h.01'; sw = 0.88; }
        else if (shape === 'diamond') { d += 'M' + f(ox + c + 0.5) + ' ' + f(oy + r + 0.14) + 'l.36.36-.36.36-.36-.36z'; sw = 0.3; }
        else { d += 'M' + f(ox + c + 0.25) + ' ' + f(oy + r + 0.25) + 'h.5v.5h-.5z'; sw = 0.42; }
      }
    }
    var line = shape === 'dots' || shape === 'vbars' || shape === 'hbars';
    return '<path d="' + d + '" fill="' + (line ? 'none' : fill) + '"' + (sw ? ' stroke="' + fill + '" stroke-width="' + f(sw) + '" stroke-linecap="round" stroke-linejoin="round"' : '') + '/>';
  }
  /* One finder eye at (x, y); toward = the corner that points at the middle of the code (0 tl, 1 tr, 2 br, 3 bl). */
  function eyeShape(kind, x, y, s, toward) {
    if (kind === 'circle' || kind === 'dot') return circle(x + s / 2, y + s / 2, s / 2);
    if (kind === 'rounded') return rrect(x, y, s, s, s * 0.3);
    if (kind === 'leaf') { var lr = s * 0.38, r = [lr, lr, lr, lr]; r[toward] = 0; return rrect(x, y, s, s, r); }
    return rrect(x, y, s, s, 0);
  }
  function eyePaths(eye, x, y, toward) {
    var outer = eye.outer || 'square';
    return { ring: eyeShape(outer, x, y, 7, toward) + eyeShape(outer, x + 1, y + 1, 5, toward), pupil: eyeShape(eye.inner || 'square', x + 2, y + 2, 3, toward) };
  }

  /* ---------- layout ---------- */
  function geometry(spec) {
    var ec = ecOf(spec), m = matrix(spec.text, { ec: ec }), n = m.n;
    var q = spec.quiet == null ? 4 : spec.quiet, S = n + 2 * q;
    var fr = spec.frame || null, st = fr ? fr.style : 'none';
    var p = st === 'none' ? 0 : st === 'label' || st === 'ticket' ? Math.max(1, S * 0.05) : Math.max(0.6, S * 0.03);
    var band = st === 'none' ? 0 : st === 'badge' ? S * 0.15 : S * 0.2, gap = st === 'tab' ? S * 0.075 : 0;
    var W = S + 2 * p, H = S + 2 * p + (st === 'label' || st === 'ticket' ? band : st === 'tab' ? gap + band : st === 'badge' ? band / 2 : 0);
    var g = { m: m, n: n, ec: ec, q: q, S: S, W: W, H: H, p: p, band: band, gap: gap, tx: p, ty: p, ox: p + q, oy: p + q, frame: st, plate: null };
    if (spec.image) {
      var k = Math.round(clamp(spec.image.size, 0.1, LIMITS.logoHard) * n);
      if (k % 2 === 0) k += 1;
      k = Math.max(3, Math.min(n - 16, k));
      var a = (n - k) / 2;
      g.plate = { a: a, k: k };
    }
    return g;
  }
  function inEye(n, r, c) { return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7); }
  /* Centres of the small alignment squares (version 2 and up). They are always drawn solid: scanners steer by them. */
  function alignments(n) {
    var v = (n - 17) / 4, out = [];
    if (v < 2) return out;
    var count = Math.floor(v / 7) + 2, last = n - 7, step = v === 32 ? 26 : Math.ceil((last - 6) / (count - 1) / 2) * 2, pos = [6], i, j;
    for (i = count - 2; i >= 0; i--) pos.splice(1, 0, last - (count - 2 - i) * step);
    for (i = 0; i < count; i++) for (j = 0; j < count; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) continue;
      out.push([pos[i], pos[j]]);
    }
    return out;
  }
  function inPlate(pl, r, c, pad) { return !!pl && r >= pl.a - pad && r < pl.a + pl.k + pad && c >= pl.a - pad && c < pl.a + pl.k + pad; }
  function drawn(g) {
    var n = g.n, m = g.m, pl = g.plate, al = {};
    g.align = alignments(n).filter(function (a) { return !inPlate(pl, a[0], a[1], 2); });
    g.align.forEach(function (a) { for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) al[(a[0] + r) * n + a[1] + c] = 1; });
    return function (r, c) { return m.dark(r, c) && !inEye(n, r, c) && !al[r * n + c] && !inPlate(pl, r, c, 0); };
  }
  /* How much of the data area the picture plate hides (0–1). */
  function coverOf(g) { return g.plate ? (g.plate.k * g.plate.k) / (g.n * g.n - 3 * 64) : 0; }

  /* ---------- SVG ---------- */
  function legacySvg(spec) {
    var m = matrix(spec.text, { ec: spec.ec || 'M' }), n = m.n, q = 4, size = n + q * 2, d = '';
    for (var r = 0; r < n; r++) {
      var run = -1;
      for (var c = 0; c <= n; c++) {
        var dark = c < n && m.dark(r, c);
        if (dark && run < 0) run = c;
        if (!dark && run >= 0) { d += 'M' + (run + q) + ' ' + (r + q) + 'h' + (c - run) + 'v1h-' + (c - run) + 'z'; run = -1; }
      }
    }
    var bg = spec.bg ? hex(spec.bg) : null;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' + (bg ? '<rect width="' + size + '" height="' + size + '" fill="' + bg + '"/>' : '') + '<path d="' + d + '" fill="' + (hex(spec.fg) || '#17131f') + '"/></svg>';
  }
  function paint(fg, g, defs) {
    if (!isObj(fg)) return fg;
    var id = 'qg' + hash(JSON.stringify(fg) + g.n + '.' + g.ox), cx = g.ox + g.n / 2, cy = g.oy + g.n / 2, h = g.n / 2;
    var stops = fg.stops.map(function (s) { return '<stop offset="' + f(s.at) + '" stop-color="' + s.color + '"/>'; }).join('');
    if (fg.type === 'radial') defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(h * 1.42) + '">' + stops + '</radialGradient>');
    else {
      var t = (fg.angle || 0) * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t), L = h * (Math.abs(dx) + Math.abs(dy));
      defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + f(cx - dx * L) + '" y1="' + f(cy - dy * L) + '" x2="' + f(cx + dx * L) + '" y2="' + f(cy + dy * L) + '">' + stops + '</linearGradient>');
    }
    return 'url(#' + id + ')';
  }
  function frameColors(spec) {
    var fr = spec.frame || {}, c = fr.color || stopsOf(spec.fg)[0];
    return { color: c, ink: fr.ink || inkOn(c) };
  }
  function label(text, cx, cy, maxW, maxH, ink) {
    text = String(text || '').trim();
    if (!text) return '';
    var fs = Math.min(maxH * 0.52, maxW / (Math.max(3, text.length) * 0.6));
    return '<text x="' + f(cx) + '" y="' + f(cy + fs * 0.35) + '" font-family="' + FONT + '" font-size="' + f(fs) + '" font-weight="700" text-anchor="middle" fill="' + ink + '">' + esc(text) + '</text>';
  }
  function frameSvg(spec, g, tileR) {
    var st = g.frame, W = g.W, H = g.H, p = g.p, S = g.S, band = g.band, fc = frameColors(spec), out = '', R = tileR + p, text = spec.frame.text;
    if (st === 'label') out = '<path d="' + rrect(0, 0, W, H, Math.min(R, W / 4)) + '" fill="' + fc.color + '"/>' + label(text, W / 2, S + 1.5 * p + band / 2, W - 4 * p, band, fc.ink);
    else if (st === 'ticket') {
      var r = Math.min(R, W / 4), ny = S + 1.5 * p, nr = S * 0.035;
      out = '<path d="M' + f(r) + ' 0H' + f(W - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(W) + ' ' + f(r) + 'V' + f(ny - nr) + 'A' + f(nr) + ' ' + f(nr) + ' 0 0 0 ' + f(W) + ' ' + f(ny + nr) + 'V' + f(H - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(W - r) + ' ' + f(H) +
        'H' + f(r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 0 ' + f(H - r) + 'V' + f(ny + nr) + 'A' + f(nr) + ' ' + f(nr) + ' 0 0 0 0 ' + f(ny - nr) + 'V' + f(r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' 0z" fill="' + fc.color + '"/>' +
        '<path d="M' + f(nr * 2) + ' ' + f(ny) + 'H' + f(W - nr * 2) + '" stroke="' + fc.ink + '" stroke-opacity=".45" stroke-width="' + f(S * 0.006) + '" stroke-dasharray="' + f(S * 0.02) + ' ' + f(S * 0.02) + '" fill="none"/>' +
        label(text, W / 2, ny + nr + (H - ny - nr) / 2 - p * 0.2, W - 4 * p, band * 0.9, fc.ink);
    } else if (st === 'tab') {
      var y0 = S + 2 * p + g.gap, tw = S * 0.07;
      out = '<path d="' + rrect(0, 0, W, S + 2 * p, Math.min(R, W / 4)) + '" fill="' + fc.color + '"/><path d="' + rrect(0, y0, W, band, band * 0.28) + 'M' + f(W / 2 - tw) + ' ' + f(y0 + 0.02) + 'L' + f(W / 2) + ' ' + f(y0 - g.gap * 0.72) + 'L' + f(W / 2 + tw) + ' ' + f(y0 + 0.02) + 'z" fill="' + fc.color + '"/>' +
        label(text, W / 2, y0 + band / 2, W - 2 * band * 0.4, band, fc.ink);
    } else if (st === 'badge') {
      var pw = Math.min(W * 0.86, Math.max(W * 0.46, String(text).length * band * 0.36 + band)), py = H - band;
      out = '<path d="' + rrect(0, 0, W, S + 2 * p, Math.min(R, W / 4)) + '" fill="' + fc.color + '"/>';
      out = [out, '<path d="' + rrect((W - pw) / 2, py, pw, band, band / 2) + '" fill="' + fc.color + '" stroke="' + (spec.bg || '#ffffff') + '" stroke-width="' + f(p * 0.5) + '"/>' + label(text, W / 2, py + band / 2, pw - band * 0.7, band, fc.ink)];
    }
    return out;
  }
  /* svg(spec, opts) → markup. opts.plain === false forces the styled renderer; opts.fallback keeps dense codes small. */
  function svg(spec, opts) {
    opts = opts || {};
    if (isPlain(spec) && opts.plain !== false && !opts.caption) return legacySvg(spec);
    spec = clean(spec);
    var g = geometry(spec), n = g.n, S = g.S, defs = [], body = '', shape = spec.shape || 'square';
    var tileR = clamp(spec.radius || 0, 0, 0.25) * S, fill = paint(spec.fg, g, defs), on = drawn(g), eye = spec.eye || {};
    var fr = g.frame !== 'none' ? frameSvg(spec, g, tileR) : '', over = '';
    if (Array.isArray(fr)) { over = fr[1]; fr = fr[0]; }
    body += fr;
    var tile = rrect(g.tx, g.ty, S, S, tileR), light = spec.bg || '#ffffff';
    if (spec.picture) {
      var cid = 'qc' + hash(tile);
      defs.push('<clipPath id="' + cid + '"><path d="' + tile + '"/></clipPath>');
      body += '<g clip-path="url(#' + cid + ')"><path d="' + tile + '" fill="' + light + '"/><image href="' + spec.picture.src + '" x="' + f(g.tx) + '" y="' + f(g.ty) + '" width="' + f(S) + '" height="' + f(S) + '" preserveAspectRatio="xMidYMid slice"/>' +
        '<path d="' + tile + '" fill="' + light + '" fill-opacity="' + f(spec.picture.dim) + '"/></g>';
      /* Light modules become small light dots and the eyes sit on light plates, so every module still reads against the picture. */
      var lightDots = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (!g.m.dark(r, c) && !inEye(n, r, c)) lightDots += 'M' + f(g.ox + c + 0.5) + ' ' + f(g.oy + r + 0.5) + 'h.01';
      body += '<path d="' + lightDots + '" fill="none" stroke="' + light + '" stroke-opacity=".86" stroke-width=".56" stroke-linecap="round"/>';
      var plates = '';
      [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (e) { plates += rrect(g.ox + e[0] - 0.6, g.oy + e[1] - 0.6, 8.2, 8.2, 1.2); });
      alignments(n).forEach(function (a) { if (!inPlate(g.plate, a[0], a[1], 2)) plates += rrect(g.ox + a[1] - 2.5, g.oy + a[0] - 2.5, 6, 6, 1); });
      body += '<path d="' + plates + '" fill="' + light + '" fill-opacity=".92"/>';
      if (shape === 'square' || shape === 'connected' || shape === 'vbars' || shape === 'hbars') shape = 'dots';
    } else if (spec.bg) body += '<path d="' + tile + '" fill="' + spec.bg + '"/>';
    var mods = modulesPath(n, on, shape, g.ox, g.oy, fill);
    if (opts.fallback !== false && mods.length > LIMITS.svg && shape !== 'square') mods = modulesPath(n, on, 'square', g.ox, g.oy, fill);
    body += mods;
    var rings = '', pupils = '';
    [[0, 0, 2], [n - 7, 0, 3], [0, n - 7, 1]].forEach(function (e) { var p = eyePaths(eye, g.ox + e[0], g.oy + e[1], e[2]); rings += p.ring; pupils += p.pupil; });
    /* Alignment squares stay solid and keep one shape through ring, gap and centre (the same rule as the eyes), a little
       rounded when the dots are. */
    var marks = '', ar = shape === 'square' ? 0 : 0.28;
    g.align.forEach(function (a) { var x = g.ox + a[1] - 2, y = g.oy + a[0] - 2; marks += rrect(x, y, 5, 5, 5 * ar) + rrect(x + 1, y + 1, 3, 3, 3 * ar) + rrect(x + 2, y + 2, 1, 1, ar); });
    if (marks) body += '<path fill-rule="evenodd" d="' + marks + '" fill="' + fill + '"/>';
    body += '<path fill-rule="evenodd" d="' + rings + '" fill="' + (eye.outerColor || fill) + '"/><path d="' + pupils + '" fill="' + (eye.innerColor || eye.outerColor || fill) + '"/>';
    if (g.plate) {
      var im = spec.image, pl = g.plate, px = g.ox + pl.a, py = g.oy + pl.a, k = pl.k, pad = Math.max(0.5, k * 0.08), rr = im.round * k;
      var plateFill = im.plate === null ? null : im.plate || spec.bg || (spec.picture ? light : null);
      if (plateFill) body += '<path d="' + rrect(px + 0.2, py + 0.2, k - 0.4, k - 0.4, Math.min(rr, k / 2 - 0.2)) + '" fill="' + plateFill + '"/>';
      var iid = 'qi' + hash(px + ':' + k + ':' + rr), ir = Math.max(0, Math.min(rr - pad * 0.6, (k - 2 * pad) / 2));
      defs.push('<clipPath id="' + iid + '"><path d="' + rrect(px + pad, py + pad, k - 2 * pad, k - 2 * pad, ir) + '"/></clipPath>');
      body += '<image href="' + im.src + '" x="' + f(px + pad) + '" y="' + f(py + pad) + '" width="' + f(k - 2 * pad) + '" height="' + f(k - 2 * pad) + '" preserveAspectRatio="xMidYMid ' + (im.fit === 'cover' ? 'slice' : 'meet') + '" clip-path="url(#' + iid + ')"/>';
    }
    body += over;
    var capH = captionHeight(g, opts.caption);
    if (capH) body = (spec.bg ? '<path d="M0 ' + f(g.H) + 'h' + f(g.W) + 'v' + f(capH) + 'h' + f(-g.W) + 'z" fill="#ffffff"/>' : '') + body + label(String(opts.caption).slice(0, 60), g.W / 2, g.H + capH / 2, g.W * 0.94, capH * 1.25, '#17131f');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f(g.W) + ' ' + f(g.H + capH) + '">' + (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + body + '</svg>';
  }
  function captionHeight(g, caption) { return caption != null && (String(caption).trim() || caption === ' ') ? g.W * 0.13 : 0; }
  /* The picture's proportions: width / height. opts.caption adds a line of words under the code (bulk labels). */
  function aspect(spec, opts) { if (isPlain(spec) && !(opts && (opts.caption || opts.plain === false))) return 1; var g = geometry(clean(spec)); return g.W / (g.H + captionHeight(g, opts && opts.caption)); }

  /* ---------- canvas (browser) ---------- */
  function canvas(spec, px, opts) {
    opts = opts || {};
    if (!doc) return Promise.reject(new Error('canvas() needs a browser.'));
    var markup, a;
    try { markup = opts.markup || svg(spec, opts); a = opts.aspect || aspect(spec, opts); } catch (e) { return Promise.reject(e); }
    var w = Math.max(16, Math.round(px || 512)), h = Math.max(16, Math.round(w / a));
    markup = markup.replace(/^<svg /, '<svg width="' + w + '" height="' + h + '" ');
    return new Promise(function (ok, no) {
      var img = new Image();
      img.onload = function () {
        var cv = doc.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        if (opts.under) { ctx.fillStyle = opts.under; ctx.fillRect(0, 0, w, h); }
        ctx.imageSmoothingEnabled = !/crispEdges/.test(markup);
        ctx.drawImage(img, 0, 0, w, h);
        ok(cv);
      };
      img.onerror = function () { no(new Error('The code could not be drawn.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    });
  }

  /* ---------- the scannability guard ---------- */
  var decoderJob = null;
  function decoder() {
    if (global.jsQR) return Promise.resolve(global.jsQR);
    if (!decoderJob) { decoderJob = lazy(VENDOR + 'jsqr.js').then(function () { if (!global.jsQR) throw new Error('no decoder'); return global.jsQR; }); decoderJob.catch(function () { decoderJob = null; }); }
    return decoderJob;
  }
  function utf8(s) { try { return Array.prototype.slice.call(new TextEncoder().encode(s)); } catch (e) { return null; } }
  function sameText(res, text) {
    if (!res) return false;
    if (res.data === text) return true;
    var want = utf8(text), got = res.binaryData;
    return !!want && !!got && want.length === got.length && want.every(function (b, i) { return b === got[i]; });
  }
  /* The checks that need no pixels: contrast, quiet zone, picture cover, density. */
  function inspect(spec) {
    var plain = isPlain(spec);
    spec = clean(spec);
    var notes = [], res = { ok: true, contrast: null, quiet: plain || spec.quiet == null ? 4 : spec.quiet, logoCover: 0, decoded: null, version: 0, ec: ecOf(spec), notes: notes };
    function note(level, code, text, label, patch) { var o = { level: level, code: code, text: text }; if (label) o.fix = { label: label, patch: patch }; notes.push(o); if (level === 'fail') res.ok = false; }
    if (!spec.text.trim()) { note('fail', 'empty', 'Type something for the code to hold.'); return res; }
    var g;
    try { g = geometry(spec); } catch (e) { note('fail', 'too-long', 'That is too long for a QR code. Shorten it.'); return res; }
    res.version = g.m.version;
    var fr = spec.frame ? frameColors(spec) : null;
    var back = spec.bg || (fr && (g.frame === 'label' || g.frame === 'ticket') ? fr.color : lum(stopsOf(spec.fg)[0]) > 0.5 ? '#17131f' : '#ffffff');
    var inks = stopsOf(spec.fg).concat(spec.eye ? [spec.eye.outerColor, spec.eye.innerColor].filter(Boolean) : []);
    var worst = inks.reduce(function (m, c) { return Math.min(m, ratio(c, back)); }, 99), inverted = inks.some(function (c) { return lum(c) > lum(back); });
    res.contrast = Math.round(worst * 100) / 100;
    var darker = function () {
      var target = inverted ? '#ffffff' : '#0b0b12', fix = function (c) { return ratio(c, back) >= 4.6 ? c : toward(c, target, back, 4.6); };
      var p = { fg: isObj(spec.fg) ? { type: spec.fg.type, angle: spec.fg.angle, stops: spec.fg.stops.map(function (s) { return { at: s.at, color: fix(s.color) }; }) } : fix(spec.fg) };
      if (spec.eye && (spec.eye.outerColor || spec.eye.innerColor)) { p.eye = { outer: spec.eye.outer, inner: spec.eye.inner }; if (spec.eye.outerColor) p.eye.outerColor = fix(spec.eye.outerColor); if (spec.eye.innerColor) p.eye.innerColor = fix(spec.eye.innerColor); }
      return p;
    };
    if (worst < 2.5) note('fail', 'contrast', 'The dots are too close to the background colour, so cameras cannot tell them apart.', inverted ? 'Make the dots lighter' : 'Make the dots darker', darker());
    else if (worst < 4) note('warn', 'contrast', 'The dots are a little pale against the background. Some cameras will struggle.', inverted ? 'Make the dots lighter' : 'Make the dots darker', darker());
    if (inverted && worst >= 2.5) note('warn', 'inverted', 'Light dots on a dark background: some older scanners cannot read these.', spec.bg ? 'Swap the colours' : 'Use dark dots', { fg: back, bg: !spec.bg ? null : isObj(spec.fg) ? spec.fg.stops[0].color : spec.fg, eye: spec.eye ? { outer: spec.eye.outer, inner: spec.eye.inner } : undefined });
    if (!spec.bg && !spec.picture) note('info', 'transparent', 'No background: place the code on something plain and light.');
    if (res.quiet < 2) note('warn', 'quiet', 'There is almost no empty space around the code. Scanners use that margin to find it.', 'Add the margin back', { quiet: 4 });
    else if (res.quiet < 4 && !plain) note('info', 'quiet', 'A margin of 4 squares is the safe standard, more so in print.');
    res.logoCover = Math.round(coverOf(g) * 1000) / 1000;
    if (spec.image && (spec.image.size > LIMITS.logoMax + 0.001 || res.logoCover > LIMITS.cover)) note('fail', 'logo', 'The picture covers too much of the code (' + Math.round(res.logoCover * 100) + '% of it). The code can only repair about ' + Math.round(BUDGET[g.ec] * 50) + '% safely.', 'Make the picture smaller', { image: { size: 0.22 } });
    if (g.m.version > LIMITS.veryDense) note('warn', 'dense', 'This code is very dense (' + g.n + ' squares across). Shorten the content or print it large.');
    else if (g.m.version > LIMITS.dense) note('info', 'dense', 'This code is getting dense. Shorter content scans faster and prints smaller.');
    res.geometry = { w: g.W, h: g.H, n: g.n };
    return res;
  }
  /* check(spec, { decode: false, quick: true }) → Promise of the report. The decode draws the code at two sizes (quick:
     the small one only) and reads it back with the vendored decoder. */
  function check(spec, opts) {
    opts = opts || {};
    var res = inspect(spec), g = res.geometry;
    delete res.geometry;
    if (!g || opts.decode === false || !doc) return Promise.resolve(res);
    var small = Math.round(clamp(g.w * 4, 120, 640)), large = Math.round(clamp(g.w * 9, 240, 1100));
    var cs = clean(spec), dark = !cs.bg && lum(stopsOf(cs.fg)[0]) > 0.5;
    var markup;
    try { markup = svg(spec); } catch (e) { return Promise.resolve(res); }
    return decoder().then(function (jsQR) {
      var read = function (px) {
        return canvas(spec, px, { markup: markup, aspect: g.w / g.h, under: cs.bg ? '#ffffff' : dark ? '#17131f' : '#ffffff' }).then(function (cv) {
          var d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
          return sameText(jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' }), cs.text === '' ? ' ' : cs.text);
        });
      };
      return read(small).then(function (a) { return opts.quick ? [a, a] : read(large).then(function (b) { return [a, b]; }); });
    }).then(function (r) {
      res.decoded = r[0] && r[1];
      res.sizes = [small, large];
      res.reads = r;
      if (!res.decoded && res.ok) {
        res.ok = false;
        var eo = cs.eye && cs.eye.outer, odd = eo && EYES.pairs[eo].indexOf(cs.eye.inner) < 0;
        var fix = odd ? ['Match the corner centres', { eye: { inner: EYES.pairs[eo][0] } }] : cs.picture ? ['Dim the picture more', { picture: { dim: 0.8 } }] : cs.image ? ['Make the picture smaller', { image: { size: 0.18 } }] : cs.shape && cs.shape !== 'square' ? ['Use square dots', { shape: 'square', eye: { outer: 'square', inner: 'square' } }] : [null, null];
        res.notes.unshift({ level: 'fail', code: 'decode', text: r[1] ? 'A test scan failed at a small size. It may only work printed large.' : 'A test scan could not read this code.', fix: fix[0] ? { label: fix[0], patch: fix[1] } : undefined });
      }
      return res;
    }, function () { res.notes.push({ level: 'info', code: 'no-decoder', text: 'The test scanner is not available right now, so try the code with your phone.' }); return res; });
  }
  /* A fix is a small patch of plain data, merged one level deep. */
  function applyFix(spec, patch) {
    var o = JSON.parse(JSON.stringify(spec || {}));
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] === undefined) delete o[k];
      else if (isObj(patch[k]) && isObj(o[k]) && !patch[k].stops) Object.keys(patch[k]).forEach(function (j) { o[k][j] = patch[k][j]; });
      else o[k] = patch[k];
    });
    return o;
  }

  /* ---------- design layers ---------- */
  /* layers(spec, { x, y, w, id }) → open-format layers. The code is one svg layer that carries its spec ("Edit QR" keeps
     working); a label or ticket frame comes apart into a plate and a text layer so the words stay editable text. */
  function layers(spec, box) {
    box = box || {};
    var plain = isPlain(spec), cs = plain ? spec : clean(spec), x = Number(box.x) || 0, y = Number(box.y) || 0, w = Number(box.w) || 400, id = String(box.id || 'qr');
    var name = 'QR · ' + String(cs.text).slice(0, 30);
    if (plain || !cs.frame || box.split === false) return [{ id: id, type: 'svg', assetId: 'qr:code', name: name, svg: svg(spec), qr: cs, x: x, y: y, w: w, h: Math.round(w / aspect(spec) * 100) / 100 }];
    var g = geometry(cs), u = w / g.W, fc = frameColors(cs), inner = JSON.parse(JSON.stringify(cs));
    delete inner.frame;
    var plateH = (g.frame === 'badge' ? g.S + 2 * g.p + g.band / 2 : g.H) * u, bandH = Math.max(g.band, 1) * u;
    return [
      { id: id + '-frame', type: 'shape', shape: 'rectangle', name: 'QR frame', fill: fc.color, radius: Math.round(Math.min((cs.radius || 0) * g.S + g.p, g.W / 4) * u), x: x, y: y, w: w, h: Math.round(plateH) },
      { id: id, type: 'svg', assetId: 'qr:code', name: name, svg: svg(inner, { plain: false }), qr: inner, x: x + g.p * u, y: y + g.p * u, w: g.S * u, h: g.S * u },
      { id: id + '-label', type: 'text', name: 'QR label', text: cs.frame.text, color: fc.ink, weight: 700, align: 'center', size: Math.round(Math.min(bandH * 0.5, (w * 0.9) / (Math.max(3, cs.frame.text.length) * 0.6))), x: x + w * 0.05, y: y + plateH - bandH * (g.frame === 'badge' ? 0.8 : 0.82), w: w * 0.9 }
    ];
  }

  /* ---------- content types ---------- */
  function wifiEsc(s) { return String(s == null ? '' : s).replace(/([\\;,":])/g, '\\$1'); }
  function vEsc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function stamp(v, allDay) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v || '')); return m ? m[1] + m[2] + m[3] + (allDay || m[4] == null ? '' : 'T' + m[4] + m[5] + '00') : ''; }
  var UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;
  var ENC = {
    link: function (v) { var u = String(v.url || '').trim(); if (!u) return ''; return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u; },
    text: function (v) { return String(v.text || ''); },
    /* Same string as the Wi-Fi sign maker (LE.makers.wifiPayload). */
    wifi: function (v) {
      var sec = v.security || 'WPA';
      if (!v.ssid || (sec !== 'nopass' && !v.password)) return '';
      var s = 'WIFI:T:' + sec + ';S:' + wifiEsc(v.ssid) + ';';
      if (sec !== 'nopass') s += 'P:' + wifiEsc(v.password) + ';';
      if (v.hidden && v.hidden !== 'false' && v.hidden !== '0') s += 'H:true;';
      return s + ';';
    },
    contact: function (v) {
      var first = String(v.first || '').trim(), last = String(v.last || '').trim();
      if (!first && !last && !v.org) return '';
      var L = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + vEsc(last) + ';' + vEsc(first) + ';;;', 'FN:' + vEsc((first + ' ' + last).trim() || v.org)];
      if (v.org) L.push('ORG:' + vEsc(v.org));
      if (v.title) L.push('TITLE:' + vEsc(v.title));
      if (v.phone) L.push('TEL;TYPE=CELL:' + String(v.phone).replace(/[^\d+*#,;() -]/g, ''));
      if (v.email) L.push('EMAIL:' + vEsc(v.email));
      if (v.url) L.push('URL:' + String(v.url).trim().replace(/[\r\n]/g, ''));
      if (v.address) L.push('ADR:;;' + vEsc(v.address) + ';;;;');
      if (v.note) L.push('NOTE:' + vEsc(v.note));
      return L.concat('END:VCARD').join('\n');
    },
    email: function (v) {
      var to = String(v.to || '').trim(), q = [];
      if (!to) return '';
      if (v.subject) q.push('subject=' + encodeURIComponent(v.subject));
      if (v.body) q.push('body=' + encodeURIComponent(v.body));
      return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
    },
    phone: function (v) { var p = String(v.phone || '').replace(/[^\d+*#]/g, ''); return p ? 'tel:' + p : ''; },
    sms: function (v) { var p = String(v.phone || '').replace(/[^\d+*#]/g, ''); return p ? 'SMSTO:' + p + ':' + String(v.message || '') : ''; },
    chat: function (v) { var u = String(v.link || '').trim(); return /^https:\/\/\S{3,}$/i.test(u) ? u : ''; },
    location: function (v) {
      var la = parseFloat(v.lat), lo = parseFloat(v.lng);
      if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return '';
      return 'geo:' + la + ',' + lo + (v.label ? '?q=' + encodeURIComponent(v.label) : '');
    },
    event: function (v) {
      var allDay = v.allDay && v.allDay !== 'false' && v.allDay !== '0', a = stamp(v.start, allDay), b = stamp(v.end, allDay);
      if (!v.title || !a) return '';
      var D = allDay ? ';VALUE=DATE:' : ':', L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:' + vEsc(v.title), 'DTSTART' + D + a];
      if (b) L.push('DTEND' + D + b);
      if (v.location) L.push('LOCATION:' + vEsc(v.location));
      if (v.notes) L.push('DESCRIPTION:' + vEsc(v.notes));
      return L.concat('END:VEVENT', 'END:VCALENDAR').join('\n');
    },
    /* Same string as the Scan to pay maker (LE.makers.payPayload, UPI mode). */
    pay: function (v) {
      var id = String(v.upiId || '').trim(), name = String(v.payee || '').trim();
      if (!id || !name || !UPI_RE.test(id)) return '';
      var s = 'upi://pay?pa=' + id + '&pn=' + encodeURIComponent(name);
      if (v.amount && isFinite(Number(v.amount))) s += '&am=' + Number(v.amount).toFixed(2);
      s += '&cu=INR';
      if (v.note) s += '&tn=' + encodeURIComponent(v.note);
      return s;
    }
  };
  function F(k, label, type, extra) { return Object.assign({ k: k, label: label, type: type || 'text' }, extra || {}); }
  var TYPES = [
    { id: 'link', name: 'Link', fields: [F('url', 'Web address', 'url', { ph: 'https://example.com', max: 1200, req: 1 })], sample: { url: 'https://localeditor.net' } },
    { id: 'text', name: 'Text', fields: [F('text', 'Text', 'textarea', { ph: 'Any text', max: 1200, req: 1 })] },
    { id: 'wifi', name: 'Wi-Fi', fields: [F('ssid', 'Network name', 'text', { max: 64, req: 1 }), F('password', 'Password', 'text', { max: 64 }), F('security', 'Security', 'select', { opts: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP (old)'], ['nopass', 'No password']] }), F('hidden', 'Hidden network', 'check')] },
    { id: 'contact', name: 'Contact', fields: [F('first', 'First name', 'text', { max: 60 }), F('last', 'Last name', 'text', { max: 60 }), F('org', 'Company', 'text', { max: 80 }), F('title', 'Job title', 'text', { max: 80 }), F('phone', 'Phone', 'tel', { max: 30 }), F('email', 'Email', 'email', { max: 120 }), F('url', 'Website', 'url', { max: 200 }), F('address', 'Address', 'text', { max: 160 }), F('note', 'Note', 'text', { max: 160 })] },
    { id: 'email', name: 'Email', fields: [F('to', 'Send to', 'email', { max: 120, req: 1 }), F('subject', 'Subject', 'text', { max: 160 }), F('body', 'Message', 'textarea', { max: 600 })] },
    { id: 'phone', name: 'Phone', fields: [F('phone', 'Phone number', 'tel', { ph: '+1 555 010 0199', max: 30, req: 1 })] },
    { id: 'sms', name: 'SMS', fields: [F('phone', 'Phone number', 'tel', { max: 30, req: 1 }), F('message', 'Message', 'textarea', { max: 300 })] },
    { id: 'chat', name: 'Chat link', fields: [F('link', 'Your chat link', 'url', { ph: 'https://…', max: 600, req: 1, hint: 'Paste the https link your chat app gives you for starting a conversation.' })] },
    { id: 'location', name: 'Location', fields: [F('lat', 'Latitude', 'text', { ph: '51.5007', max: 16, req: 1 }), F('lng', 'Longitude', 'text', { ph: '-0.1246', max: 16, req: 1 }), F('label', 'Place name', 'text', { max: 80 })] },
    { id: 'event', name: 'Event', fields: [F('title', 'Event name', 'text', { max: 120, req: 1 }), F('start', 'Starts', 'datetime-local', { req: 1 }), F('end', 'Ends', 'datetime-local'), F('allDay', 'All day', 'check'), F('location', 'Where', 'text', { max: 160 }), F('notes', 'Notes', 'textarea', { max: 300 })] },
    { id: 'pay', name: 'Payment', fields: [F('upiId', 'UPI ID', 'text', { ph: 'name@bank', max: 320, req: 1 }), F('payee', 'Pay to (name)', 'text', { max: 80, req: 1 }), F('amount', 'Amount (₹, optional)', 'number', { max: 12 }), F('note', 'Note', 'text', { max: 80 })] }
  ];
  /* encode(type, values) → { text, error }. Values are plain strings; nothing is fetched or run. */
  function encode(type, values) {
    var fn = ENC[type];
    if (!fn) return { text: '', error: 'Unknown content type "' + type + '".' };
    var v = {};
    Object.keys(isObj(values) ? values : {}).slice(0, 24).forEach(function (k) { var x = values[k]; v[k] = typeof x === 'boolean' ? (x ? '1' : '') : String(x == null ? '' : x).slice(0, 2000); });
    var text = fn(v);
    if (!text) return { text: '', error: type === 'pay' ? 'Add a UPI ID like name@bank and the name to pay.' : type === 'chat' ? 'Paste a link that starts with https://' : type === 'location' ? 'Latitude is between -90 and 90, longitude between -180 and 180.' : 'Fill in the fields marked as needed.' };
    if (text.length > LIMITS.text) return { text: text.slice(0, LIMITS.text), error: 'That is ' + text.length + ' characters. A code holds up to ' + LIMITS.text + ' here; shorter scans better.' };
    return { text: text, error: null };
  }
  function slug(s, n) { return String(s || '').normalize ? String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 40).replace(/-+$/, '') : 'qr'; }
  /* fileName(text, ext) → a safe name from the content: "wifi-guest.png", "example-com-menu.svg". */
  function fileName(text, ext) {
    var t = String(text || ''), m, base;
    if ((m = /^WIFI:.*?S:((?:\\.|[^;])*)/.exec(t))) base = 'wifi-' + slug(m[1].replace(/\\(.)/g, '$1'));
    else if ((m = /^BEGIN:VCARD[\s\S]*?\nFN:([^\n]*)/.exec(t))) base = 'contact-' + slug(m[1]);
    else if ((m = /^BEGIN:VCALENDAR[\s\S]*?\nSUMMARY:([^\n]*)/.exec(t))) base = 'event-' + slug(m[1]);
    else if ((m = /^mailto:([^?]*)/i.exec(t))) base = 'email-' + slug(m[1]);
    else if ((m = /^tel:(.*)/i.exec(t))) base = 'phone-' + slug(m[1]);
    else if ((m = /^SMSTO:([^:]*)/i.exec(t))) base = 'sms-' + slug(m[1]);
    else if ((m = /^geo:([-\d.]+),([-\d.]+)/i.exec(t))) base = 'location-' + slug(m[1] + ' ' + m[2]);
    else if ((m = /^upi:\/\/pay\?pa=([^&]*)/i.exec(t))) base = 'pay-' + slug(m[1]);
    else if ((m = /^https?:\/\/(?:www\.)?([^\/?#]+)([^?#]*)/i.exec(t))) base = slug(m[1] + ' ' + m[2]);
    else base = 'qr-' + slug(t.slice(0, 60), 32);
    base = base.replace(/-+$/, '') || 'qr-code';
    return base + (ext ? '.' + String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() : '');
  }

  /* ---------- presets: plain data, every one passes check() (tests/qr.test.js) ---------- */
  function G(type, angle, colors) { return { type: type, angle: angle, stops: colors.map(function (c, i) { return { at: i / (colors.length - 1), color: c }; }) }; }
  var PRESETS = [
    { id: 'ink', name: 'Ink on paper', style: { fg: '#17131f', bg: '#ffffff', shape: 'square', eye: { outer: 'square', inner: 'square' } } },
    { id: 'deep-blue', name: 'Deep blue', style: { fg: '#0b3d91', bg: '#ffffff', shape: 'rounded', eye: { outer: 'rounded', inner: 'rounded' } } },
    { id: 'forest', name: 'Forest', style: { fg: '#14532d', bg: '#f3f8f1', shape: 'connected', eye: { outer: 'rounded', inner: 'rounded' }, radius: 0.06 } },
    { id: 'plum', name: 'Plum', style: { fg: '#581c58', bg: '#fbf5fb', shape: 'dots', eye: { outer: 'circle', inner: 'dot' } } },
    { id: 'sunset', name: 'Sunset', style: { fg: G('linear', 45, ['#9f1239', '#c2410c']), bg: '#fff8f1', shape: 'rounded', eye: { outer: 'rounded', inner: 'dot' }, radius: 0.06 } },
    { id: 'ocean', name: 'Ocean', style: { fg: G('linear', 135, ['#0e7490', '#1d4ed8']), bg: '#f5fbff', shape: 'connected', eye: { outer: 'rounded', inner: 'rounded' }, radius: 0.06 } },
    { id: 'mono-dots', name: 'Mono dots', style: { fg: '#111111', bg: '#ffffff', shape: 'dots', eye: { outer: 'circle', inner: 'dot' } } },
    { id: 'rounded-dark', name: 'Rounded dark', style: { fg: '#111827', bg: '#ffffff', shape: 'connected', eye: { outer: 'rounded', inner: 'rounded' }, radius: 0.1 } },
    { id: 'berry', name: 'Berry', style: { fg: G('radial', 0, ['#be185d', '#6b21a8']), bg: '#fdf4ff', shape: 'dots', eye: { outer: 'rounded', inner: 'dot' }, radius: 0.06 } },
    { id: 'teal-bars', name: 'Teal bars', style: { fg: '#0f766e', bg: '#f0fdfa', shape: 'vbars', eye: { outer: 'rounded', inner: 'rounded' } } },
    { id: 'coffee', name: 'Coffee', style: { fg: '#4a2c17', bg: '#fbf3e4', shape: 'diamond', eye: { outer: 'square', inner: 'square' } } },
    { id: 'slate', name: 'Slate lines', style: { fg: '#334155', bg: '#f8fafc', shape: 'hbars', eye: { outer: 'rounded', inner: 'rounded' } } },
    { id: 'royal', name: 'Royal', style: { fg: '#1e1b4b', bg: '#eef2ff', shape: 'rounded', eye: { outer: 'leaf', inner: 'leaf', outerColor: '#4338ca', innerColor: '#1e1b4b' }, radius: 0.06 } },
    { id: 'ember', name: 'Ember', style: { fg: '#7c2d12', bg: '#fff7ed', shape: 'connected', eye: { outer: 'rounded', inner: 'dot', outerColor: '#c2410c', innerColor: '#7c2d12' } } },
    { id: 'mint', name: 'Mint ticket', style: { fg: '#065f46', bg: '#ecfdf5', shape: 'dots', eye: { outer: 'rounded', inner: 'dot' }, frame: { style: 'ticket', text: 'Scan me', color: '#065f46' }, radius: 0.04 } },
    { id: 'midnight', name: 'Midnight', style: { fg: G('linear', 90, ['#1e3a8a', '#6d28d9']), bg: '#ffffff', shape: 'connected', eye: { outer: 'leaf', inner: 'leaf' } } },
    { id: 'rose', name: 'Rose', style: { fg: '#9d174d', bg: '#fff1f2', shape: 'dots', eye: { outer: 'rounded', inner: 'dot' }, radius: 0.08 } },
    { id: 'graphite', name: 'Graphite', style: { fg: '#27272a', bg: '#f4f4f5', shape: 'square', eye: { outer: 'square', inner: 'rounded' }, radius: 0.08 } },
    { id: 'lagoon', name: 'Lagoon', style: { fg: G('linear', 30, ['#0f766e', '#0369a1', '#4338ca']), bg: '#f8fafc', shape: 'rounded', eye: { outer: 'circle', inner: 'dot' }, radius: 0.06 } },
    { id: 'label-blue', name: 'Blue label', style: { fg: '#1e3a8a', bg: '#ffffff', shape: 'rounded', eye: { outer: 'rounded', inner: 'rounded' }, frame: { style: 'label', text: 'Scan me', color: '#1e3a8a' }, radius: 0.05 } }
  ];
  /* presets(brand) → the list; with a brand kit ({ colors: [...] }) a "Your brand" style comes first when a colour is dark enough. */
  function presets(brand) {
    var list = PRESETS.map(function (p) { return { id: p.id, name: p.name, style: JSON.parse(JSON.stringify(p.style)) }; });
    var cols = brand && Array.isArray(brand.colors) ? brand.colors.map(hex).filter(Boolean) : [];
    var ok = cols.filter(function (c) { return ratio(c, '#ffffff') >= 4.5; }).sort(function (a, b) { return lum(a) - lum(b); });
    if (ok.length) {
      var main = ok.filter(function (c) { var p = rgb(c); return Math.max.apply(null, p) - Math.min.apply(null, p) > 40; })[0] || ok[0];
      list.unshift({ id: 'brand', name: 'Your brand', style: { fg: main, bg: '#ffffff', shape: 'rounded', eye: { outer: 'rounded', inner: 'rounded', outerColor: main, innerColor: ok[0] }, radius: 0.06 } });
    }
    return list;
  }
  function preset(id, brand) { var p = presets(brand).filter(function (x) { return x.id === id; })[0]; return p ? p.style : null; }
  /* styleOf(spec) → the look without the content; withStyle(text, style) puts a look on new content. */
  function styleOf(spec) { var o = clean(spec); delete o.text; return o; }
  function withStyle(text, style) { return clean(Object.assign({}, typeof style === 'string' ? preset(style) || {} : style || {}, { text: text })); }

  LE.qr = {
    LIMITS: LIMITS, SHAPES: SHAPES, EYES: EYES, FRAMES: FRAMES, TYPES: TYPES, BASE: BASE, VENDOR: VENDOR,
    ready: ready, matrix: matrix, svg: svg, canvas: canvas, layers: layers, check: check, inspect: inspect, applyFix: applyFix, aspect: aspect,
    clean: clean, isPlain: isPlain, encode: encode, fileName: fileName, slug: slug, presets: presets, preset: preset, styleOf: styleOf, withStyle: withStyle,
    decoder: decoder, lazy: lazy, color: { hex: hex, ratio: ratio, lum: lum, mix: mix, inkOn: inkOn }
  };
  if (typeof module === 'object' && module.exports) module.exports = LE.qr;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
