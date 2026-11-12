/* LocalEditor effect renderer, core: registry, validation, document operations and the loader.
   Loaded on demand by le-fx-boot.js. The contract is docs/FX-AUTHORING.md. No WebGL in this file. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  if (LE.fx && LE.fx.register) return;
  var FX = LE.fx = LE.fx || {};

  /* Part of every cache key. Bump when the renderer's pixels change for the same document. */
  FX.version = 1;
  /* Effect packs loaded with the renderer. Feature teams add their pack name here (assets/js/fx/le-fx-<name>.js). */
  var PACKS = ['basic'];

  var BAD = { __proto__: 1, constructor: 1, prototype: 1 };
  var BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'difference', 'color', 'luminosity'];
  var NEEDS = ['alpha', 'scene', 'depth', 'normals', 'face', 'stats'];
  var PARAM_TYPES = ['number', 'bool', 'choice', 'color', 'point', 'angle', 'curve', 'wheel', 'bands', 'lut', 'seed'];
  var MASK_KINDS = {
    asset: {}, subject: {},
    linear: { x0: [-4, 5, 0.5], y0: [-4, 5, 0], x1: [-4, 5, 0.5], y1: [-4, 5, 1] },
    radial: { cx: [-4, 5, 0.5], cy: [-4, 5, 0.5], rx: [0.001, 8, 0.4], ry: [0.001, 8, 0.4], rotation: [-360, 360, 0] },
    luma: { min: [0, 1, 0], max: [0, 1, 1], soft: [0, 1, 0.1] },
    color: { h: [0, 360, 0], s: [0, 1, 0.5], l: [0, 1, 0.5], range: [0, 1, 0.15], soft: [0, 1, 0.1] },
    depth: { near: [0, 1, 0], far: [0, 1, 1], soft: [0, 1, 0.1] },
    face: {}
  };
  /* layer.maps.face.parts.asset is one image: each face part is a grey level band (value / 255). */
  var FACE_PARTS = { skin: 40, brows: 80, eyes: 120, 'under-eyes': 160, lips: 200, teeth: 240 };
  var LIMITS = { stack: 32, parts: 8, params: 24, points: 64 };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function idOk(v, n) { return typeof v === 'string' && v.length > 0 && v.length <= (n || 80) && /^[\w:.-]+$/.test(v); }
  function uid() { return 'fx' + Math.floor(Math.random() * 0xffffff).toString(36) + (uid.n = (uid.n || 0) + 1).toString(36); }
  function warn(list, path, code, message) { if (list) list.push({ path: path, code: code, message: message }); }

  /* ---------- Small maths shared by effects, the renderer and the tests ---------- */
  var M = FX.math = {};
  M.clamp = clamp;
  M.srgbToLinear = function (v) { var a = Math.abs(v); return (v < 0 ? -1 : 1) * (a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4)); };
  M.linearToSrgb = function (v) { var a = Math.abs(v); return (v < 0 ? -1 : 1) * (a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055); };
  /* '#rgb', '#rrggbb' or '#rrggbbaa' → [r, g, b, a] in 0–1 (display-referred), or null. */
  M.parseColor = function (s) {
    if (typeof s !== 'string') return null;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s.trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  };
  /* Monotone cubic (Fritsch–Carlson) through control points; never overshoots, so a curve cannot invert tones by accident. */
  M.curveLUT = function (points, n) {
    n = n || 1024;
    var pts = (points || []).filter(function (p) { return p && isNum(p[0]) && isNum(p[1]); }).map(function (p) { return [clamp(p[0], 0, 1), clamp(p[1], 0, 1)]; });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var xs = [], ys = [], i;
    for (i = 0; i < pts.length; i++) { if (xs.length && pts[i][0] - xs[xs.length - 1] < 1e-5) { ys[ys.length - 1] = pts[i][1]; continue; } xs.push(pts[i][0]); ys.push(pts[i][1]); }
    var out = new Float32Array(n), k = xs.length;
    if (k === 0) { for (i = 0; i < n; i++) out[i] = i / (n - 1); return out; }
    if (k === 1) { for (i = 0; i < n; i++) out[i] = ys[0]; return out; }
    var d = [], m = [], h = [];
    for (i = 0; i < k - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = d[0]; m[k - 1] = d[k - 2];
    for (i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < k - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    var seg = 0;
    for (i = 0; i < n; i++) {
      var x = i / (n - 1);
      if (x <= xs[0]) { out[i] = ys[0]; continue; }
      if (x >= xs[k - 1]) { out[i] = ys[k - 1]; continue; }
      while (seg < k - 2 && x > xs[seg + 1]) seg++;
      var u = (x - xs[seg]) / h[seg], u2 = u * u, u3 = u2 * u;
      out[i] = clamp((2 * u3 - 3 * u2 + 1) * ys[seg] + (u3 - 2 * u2 + u) * h[seg] * m[seg] + (-2 * u3 + 3 * u2) * ys[seg + 1] + (u3 - u2) * h[seg] * m[seg + 1], 0, 1);
    }
    return out;
  };
  M.hash = function (s) {
    s = String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  };

  /* ---------- Registry ---------- */
  var defs = {}, order = [];

  function cleanParamDef(key, d) {
    if (!isObj(d) || PARAM_TYPES.indexOf(d.type) < 0) throw new Error('Parameter "' + key + '" needs a type: ' + PARAM_TYPES.join(', ') + '.');
    var o = { type: d.type, label: typeof d.label === 'string' ? d.label.slice(0, 60) : key };
    if (typeof d.help === 'string') o.help = d.help.slice(0, 200);
    if (d.type === 'number') {
      o.min = isNum(d.min) ? d.min : 0; o.max = isNum(d.max) ? d.max : 1;
      if (o.max < o.min) throw new Error('Parameter "' + key + '": max is below min.');
      o.default = clamp(isNum(d.default) ? d.default : o.min, o.min, o.max);
      o.step = isNum(d.step) && d.step > 0 ? d.step : (o.max - o.min) / 200;
      if (typeof d.unit === 'string') o.unit = d.unit.slice(0, 8);
    } else if (d.type === 'bool') o.default = !!d.default;
    else if (d.type === 'choice') {
      o.options = (Array.isArray(d.options) ? d.options : []).map(function (x) { return isObj(x) ? { value: String(x.value), label: String(x.label == null ? x.value : x.label) } : { value: String(x), label: String(x) }; });
      if (!o.options.length) throw new Error('Parameter "' + key + '" needs options.');
      o.default = o.options.some(function (x) { return x.value === d.default; }) ? d.default : o.options[0].value;
    } else if (d.type === 'color') { o.alpha = !!d.alpha; o.default = M.parseColor(d.default) ? d.default : '#000000'; }
    else if (d.type === 'point') o.default = Array.isArray(d.default) && isNum(d.default[0]) && isNum(d.default[1]) ? [d.default[0], d.default[1]] : [0.5, 0.5];
    else if (d.type === 'angle') o.default = isNum(d.default) ? clamp(d.default, -360, 360) : 0;
    else if (d.type === 'curve') o.default = Array.isArray(d.default) ? clone(d.default) : [[0, 0], [1, 1]];
    else if (d.type === 'wheel') o.default = isObj(d.default) ? { h: d.default.h || 0, amount: d.default.amount || 0, l: d.default.l || 0 } : { h: 0, amount: 0, l: 0 };
    else if (d.type === 'bands') { o.min = isNum(d.min) ? d.min : -1; o.max = isNum(d.max) ? d.max : 1; o.default = Array.isArray(d.default) && d.default.length === 8 ? d.default.slice() : [0, 0, 0, 0, 0, 0, 0, 0]; }
    else if (d.type === 'lut') o.default = null;
    else if (d.type === 'seed') o.default = isNum(d.default) ? Math.round(clamp(d.default, 0, 2147483647)) : 0;
    return o;
  }

  FX.register = function (def) {
    if (!isObj(def) || typeof def.id !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(def.id)) throw new Error('An effect needs an id such as "gaussian-blur".');
    if (typeof def.passes !== 'function') throw new Error('Effect "' + def.id + '" needs passes(g, p).');
    var v = Math.max(1, Math.round(Number(def.version) || 1));
    if (defs[def.id] && defs[def.id].version > v) return defs[def.id];
    var params = {};
    Object.keys(isObj(def.params) ? def.params : {}).slice(0, LIMITS.params).forEach(function (k) {
      if (BAD[k] || !/^[a-zA-Z][\w]{0,31}$/.test(k)) throw new Error('Effect "' + def.id + '": "' + k + '" is not a parameter name.');
      params[k] = cleanParamDef(k, def.params[k]);
    });
    var sup = isObj(def.support) ? def.support : {};
    var d = {
      id: def.id, name: String(def.name || def.id).slice(0, 60), group: String(def.group || 'effects').slice(0, 30), version: v,
      space: def.space === 'display' ? 'display' : 'linear',
      needs: (Array.isArray(def.needs) ? def.needs : []).filter(function (n) { return NEEDS.indexOf(n) >= 0; }),
      params: params,
      radius: typeof def.radius === 'function' ? def.radius : function () { return 0; },
      grow: typeof def.grow === 'function' ? def.grow : null,
      draft: typeof def.draft === 'function' ? def.draft : null,
      passes: def.passes,
      cpu: typeof def.cpu === 'function' ? def.cpu : null,
      support: { needs: Array.isArray(sup.needs) ? sup.needs.slice() : ['webgl2'], wants: Array.isArray(sup.wants) ? sup.wants.slice() : [], memoryMB: isNum(sup.memoryMB) ? sup.memoryMB : 0 },
      ui: isObj(def.ui) ? clone(def.ui) : { section: 'Effects' },
      agent: isObj(def.agent) ? clone(def.agent) : { summary: '' }
    };
    d.silhouette = d.needs.indexOf('alpha') >= 0 || d.needs.indexOf('scene') >= 0;
    if (!defs[d.id]) order.push(d.id);
    defs[d.id] = d;
    resolveMemo = {};
    /* E7: every effect says what a device needs. Works whether le-support.js has loaded or not. */
    var sdef = { id: 'fx.' + d.id, name: d.name, group: 'Photo studio', needs: d.support.needs, wants: d.support.wants, memoryMB: d.support.memoryMB || undefined, note: d.agent.summary || undefined, degraded: d.cpu ? 'Uses a slower path without the graphics chip.' : undefined };
    try { if (LE.support && LE.support.define) LE.support.define(sdef); else (global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || []).push(sdef); } catch (e) { /* support is optional */ }
    return d;
  };
  FX.list = function () { return order.slice(); };
  FX.get = function (id) { return own(defs, id) ? defs[id] : null; };
  FX.defaults = function (id) {
    var d = FX.get(id);
    if (!d) return null;
    var p = {};
    Object.keys(d.params).forEach(function (k) { p[k] = clone(d.params[k].default); });
    return p;
  };
  FX.describe = function () {
    return {
      version: FX.version,
      effects: order.map(function (id) {
        var d = defs[id];
        return { id: d.id, name: d.name, group: d.group, version: d.version, space: d.space, needs: d.needs.slice(), spatial: d.silhouette || d.radius(FX.defaults(id), 1) > 0 || !!d._spatial, params: clone(d.params), ui: clone(d.ui), agent: clone(d.agent), support: clone(d.support), cpu: !!d.cpu };
      }),
      blends: BLENDS.slice(), paramTypes: PARAM_TYPES.slice(),
      maskKinds: Object.keys(MASK_KINDS).map(function (k) { return { kind: k, fields: clone(MASK_KINDS[k]) }; }),
      faceParts: Object.keys(FACE_PARTS), limits: clone(LIMITS),
      entry: { id: 'string', type: 'effect id', on: true, amount: 1, blend: 'normal', mask: null, p: {} }
    };
  };

  /* ---------- Validation against the schema ---------- */
  function cleanParam(s, v, path, w) {
    var t = s.type, i;
    function bad(msg) { warn(w, path, 'bad-value', msg + ' The default is used.'); return clone(s.default); }
    if (v === undefined) return clone(s.default);
    if (t === 'number' || t === 'angle' || t === 'seed') {
      if (!isNum(v)) return bad('This must be a number.');
      var lo = t === 'angle' ? -360 : t === 'seed' ? 0 : s.min, hi = t === 'angle' ? 360 : t === 'seed' ? 2147483647 : s.max;
      if (v < lo || v > hi) { warn(w, path, 'clamped', 'Out of range (' + lo + ' to ' + hi + '); clamped.'); v = clamp(v, lo, hi); }
      return t === 'seed' ? Math.round(v) : v;
    }
    if (t === 'bool') return typeof v === 'boolean' ? v : bad('This must be true or false.');
    if (t === 'choice') return s.options.some(function (o) { return o.value === v; }) ? v : bad('Not one of the options.');
    if (t === 'color') { var c = M.parseColor(v); if (!c || (!s.alpha && v.length > 7)) return bad('Colours are "#rrggbb"' + (s.alpha ? ' or "#rrggbbaa"' : '') + '.'); return v.toLowerCase(); }
    if (t === 'point') {
      if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) return bad('A point is [x, y].');
      return [clamp(v[0], -1, 2), clamp(v[1], -1, 2)];
    }
    if (t === 'curve') {
      if (!Array.isArray(v) || v.length < 2) return bad('A curve is a list of at least two [x, y] points.');
      if (v.length > LIMITS.points) { warn(w, path, 'clamped', 'A curve can have up to ' + LIMITS.points + ' points; the rest were dropped.'); v = v.slice(0, LIMITS.points); }
      var pts = [];
      for (i = 0; i < v.length; i++) {
        if (!Array.isArray(v[i]) || !isNum(v[i][0]) || !isNum(v[i][1])) return bad('A curve point is [x, y].');
        pts.push([clamp(v[i][0], 0, 1), clamp(v[i][1], 0, 1)]);
      }
      pts.sort(function (a, b) { return a[0] - b[0]; });
      return pts;
    }
    if (t === 'wheel') {
      if (!isObj(v)) return bad('A wheel is { h, amount, l }.');
      return { h: clamp(isNum(v.h) ? v.h : 0, 0, 360), amount: clamp(isNum(v.amount) ? v.amount : 0, 0, 1), l: clamp(isNum(v.l) ? v.l : 0, -1, 1) };
    }
    if (t === 'bands') {
      if (!Array.isArray(v) || v.length !== 8) return bad('Bands are eight numbers.');
      var out = [];
      for (i = 0; i < 8; i++) { if (!isNum(v[i])) return bad('Bands are eight numbers.'); out.push(clamp(v[i], s.min, s.max)); }
      return out;
    }
    if (t === 'lut') return v === null || idOk(v, 80) ? v : bad('A LUT is an asset id.');
    return clone(s.default);
  }

  function cleanMask(mask, path, w) {
    if (mask == null) return null;
    if (!isObj(mask) || !Array.isArray(mask.parts)) { warn(w, path, 'bad-value', 'A mask is { parts: [...] }.'); return null; }
    if (mask.parts.length > LIMITS.parts) warn(w, path + '/parts', 'clamped', 'A mask can have up to ' + LIMITS.parts + ' parts.');
    var parts = [];
    mask.parts.slice(0, LIMITS.parts).forEach(function (src, i) {
      var pp = path + '/parts/' + i;
      if (!isObj(src) || !own(MASK_KINDS, src.kind)) { warn(w, pp, 'unknown-kind', 'Unknown mask kind; the part was left out.'); return; }
      var radial = src.kind === 'radial';
      var o = {
        kind: src.kind, mode: src.mode === 'subtract' || src.mode === 'intersect' ? src.mode : 'add', invert: src.invert === true,
        feather: clamp(isNum(src.feather) ? src.feather : 0, 0, radial ? 1 : 500), density: clamp(isNum(src.density) ? src.density : 1, 0, 1)
      };
      var f = MASK_KINDS[src.kind];
      Object.keys(f).forEach(function (k) {
        var v = isNum(src[k]) ? src[k] : f[k][2];
        if (v < f[k][0] || v > f[k][1]) { warn(w, pp + '/' + k, 'clamped', 'Out of range; clamped.'); v = clamp(v, f[k][0], f[k][1]); }
        o[k] = v;
      });
      if (src.kind === 'asset') { if (!idOk(src.asset, 80)) { warn(w, pp + '/asset', 'bad-value', 'An asset mask needs an asset id.'); return; } o.asset = src.asset; }
      if (src.kind === 'face') { if (!own(FACE_PARTS, src.part)) { warn(w, pp + '/part', 'bad-value', 'part is one of ' + Object.keys(FACE_PARTS).join(', ') + '.'); return; } o.part = src.part; }
      Object.keys(src).forEach(function (k) { if (BAD[k]) warn(w, pp, 'forbidden-key', 'The key "' + k + '" is not allowed.'); else if (!own(o, k)) warn(w, pp + '/' + k, 'unknown-key', 'Unknown mask field; ignored.'); });
      parts.push(o);
    });
    return parts.length ? { parts: parts } : null;
  }
  FX.cleanMask = function (mask) { var w = []; var m = cleanMask(mask, '/mask', w); return { mask: m, warnings: w }; };

  FX.validate = function (entry, path) {
    path = path || '';
    var w = [], e = [];
    if (!isObj(entry)) { warn(e, path, 'bad-entry', 'An effect entry must be an object.'); return { ok: false, entry: null, warnings: w, errors: e }; }
    var d = typeof entry.type === 'string' ? FX.get(entry.type) : null;
    if (!d) { warn(e, path + '/type', 'unknown-type', 'Unknown effect type "' + String(entry.type).slice(0, 40) + '".'); return { ok: false, entry: null, warnings: w, errors: e }; }
    var out = {
      id: idOk(entry.id, 40) ? entry.id : uid(), type: d.id, on: entry.on !== false,
      amount: clamp(isNum(entry.amount) ? entry.amount : 1, 0, 1),
      blend: BLENDS.indexOf(entry.blend) >= 0 ? entry.blend : 'normal',
      mask: cleanMask(entry.mask, path + '/mask', w), p: {}
    };
    if (entry.amount != null && (!isNum(entry.amount) || entry.amount < 0 || entry.amount > 1)) warn(w, path + '/amount', 'clamped', 'amount is 0 to 1.');
    if (entry.blend != null && BLENDS.indexOf(entry.blend) < 0) warn(w, path + '/blend', 'bad-value', 'Unknown blend; "normal" is used.');
    var p = isObj(entry.p) ? entry.p : {};
    if (entry.p != null && !isObj(entry.p)) warn(w, path + '/p', 'bad-value', 'p must be an object of parameters.');
    Object.keys(p).forEach(function (k) {
      if (BAD[k]) warn(w, path + '/p', 'forbidden-key', 'The key "' + k + '" is not allowed.');
      else if (!own(d.params, k)) warn(w, path + '/p/' + k.slice(0, 40), 'unknown-key', 'Unknown parameter for ' + d.id + '; ignored.');
    });
    Object.keys(d.params).forEach(function (k) { out.p[k] = cleanParam(d.params[k], own(p, k) ? p[k] : undefined, path + '/p/' + k, w); });
    Object.keys(entry).forEach(function (k) {
      if (BAD[k]) warn(w, path, 'forbidden-key', 'The key "' + k + '" is not allowed.');
      else if (['id', 'type', 'on', 'amount', 'blend', 'mask', 'p'].indexOf(k) < 0) warn(w, path + '/' + k.slice(0, 40), 'unknown-key', 'Unknown entry field; ignored.');
    });
    return { ok: true, entry: out, warnings: w, errors: e };
  };

  /* The runnable form of a stack: validated, switched-on entries with their definitions. Memoised, because it runs on every render. */
  var resolveMemo = {}, resolveCount = 0;
  FX.resolve = function (stack) {
    if (!Array.isArray(stack) || !stack.length) return { entries: [], skipped: [], key: '' };
    var key = JSON.stringify(stack);
    if (own(resolveMemo, key)) return resolveMemo[key];
    var entries = [], skipped = [];
    stack.slice(0, LIMITS.stack).forEach(function (src, i) {
      var r = FX.validate(src, '/fx/' + i);
      if (!r.ok) { skipped.push({ index: i, type: src && typeof src.type === 'string' ? src.type.slice(0, 40) : null, reason: r.errors[0] ? r.errors[0].code : 'bad-entry' }); return; }
      if (!r.entry.on || r.entry.amount <= 0) return;
      var d = FX.get(r.entry.type);
      entries.push({ id: r.entry.id, type: d.id, def: d, p: r.entry.p, amount: r.entry.amount, blend: r.entry.blend, mask: r.entry.mask, sig: d.id + '@' + d.version + JSON.stringify([r.entry.p, r.entry.amount, r.entry.blend, r.entry.mask]) });
    });
    var out = { entries: entries, skipped: skipped, key: M.hash(entries.map(function (x) { return x.sig; }).join('|')) };
    if (++resolveCount > 400) { resolveMemo = {}; resolveCount = 0; }
    resolveMemo[key] = out;
    return out;
  };

  /* Everything in a page document the renderer would skip or change, for the workspace and for agents. */
  FX.problems = function (doc) {
    var out = [];
    ((doc && doc.layers) || []).forEach(function (l) {
      (Array.isArray(l.fx) ? l.fx : []).forEach(function (en, i) {
        var r = FX.validate(en, '/fx/' + i);
        r.errors.concat(r.warnings).forEach(function (x) { out.push({ layer: l.id, path: x.path, code: x.code, message: x.message }); });
      });
      var parts = [];
      function maskParts(m) { if (m && Array.isArray(m.parts)) parts = parts.concat(m.parts); }
      maskParts(l.fxMask); (Array.isArray(l.fx) ? l.fx : []).forEach(function (en) { maskParts(en && en.mask); });
      parts.forEach(function (p) {
        if (!p) return;
        if (p.kind === 'subject' && !(l.cutout && l.cutout.asset)) out.push({ layer: l.id, path: '/mask', code: 'missing-map', message: 'A subject mask needs a cut-out on this layer.' });
        if (p.kind === 'depth' && !(l.maps && l.maps.depth && l.maps.depth.asset)) out.push({ layer: l.id, path: '/mask', code: 'missing-map', message: 'A depth mask needs layer.maps.depth.' });
        if (p.kind === 'face' && !(l.maps && l.maps.face && l.maps.face.parts && l.maps.face.parts.asset)) out.push({ layer: l.id, path: '/mask', code: 'missing-map', message: 'A face mask needs layer.maps.face.' });
      });
    });
    return out;
  };

  /* ---------- Geometry helpers for layer.transform.quad ---------- */
  var Q = FX.quad = {};
  /* The quad as fractions of its own bounding box (TL, TR, BR, BL), or null when it is missing or degenerate. */
  Q.unit = function (layer) {
    var q = layer && layer.transform && layer.transform.quad;
    if (!Array.isArray(q) || q.length !== 4) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < 4; i++) { if (!Array.isArray(q[i]) || !isNum(q[i][0]) || !isNum(q[i][1])) return null; x0 = Math.min(x0, q[i][0]); y0 = Math.min(y0, q[i][1]); x1 = Math.max(x1, q[i][0]); y1 = Math.max(y1, q[i][1]); }
    if (!(x1 - x0 > 1e-6) || !(y1 - y0 > 1e-6)) return null;
    var u = q.map(function (p) { return [(p[0] - x0) / (x1 - x0), (p[1] - y0) / (y1 - y0)]; });
    /* Convex and not folded: all cross products share a sign. */
    var sign = 0;
    for (i = 0; i < 4; i++) {
      var a = u[i], b = u[(i + 1) % 4], c = u[(i + 2) % 4];
      var cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-9) return null;
      if (sign && (cr > 0) !== (sign > 0)) return null;
      sign = cr;
    }
    return u;
  };
  /* Where the four corners are on the page now: the quad's shape carried by the layer's live box, rotation and flips. */
  Q.corners = function (layer) {
    var u = Q.unit(layer) || [[0, 0], [1, 0], [1, 1], [0, 1]];
    var cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2, r = (layer.rotation || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    return u.map(function (p) {
      var lx = (p[0] - 0.5) * layer.w * (layer.flipX ? -1 : 1), ly = (p[1] - 0.5) * layer.h * (layer.flipY ? -1 : 1);
      return [cx + lx * cs - ly * sn, cy + lx * sn + ly * cs];
    });
  };
  /* 3×3 homography (row-major, 9 numbers) taking the unit square to four points. */
  Q.homography = function (d) {
    var x0 = d[0][0], y0 = d[0][1], x1 = d[1][0], y1 = d[1][1], x2 = d[2][0], y2 = d[2][1], x3 = d[3][0], y3 = d[3][1];
    var dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
    var den = dx1 * dy2 - dx2 * dy1, g = 0, h = 0;
    if (Math.abs(den) > 1e-12 && (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12)) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  };
  Q.invert = function (m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-14) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };

  /* ---------- Document operations (pure: they work on a copy of a page document) ---------- */
  var OPS = {
    'fx.add': 'Add an effect. { layer, entry: { type, p?, amount?, blend?, mask?, id? }, index? }',
    'fx.update': 'Change an effect. { layer, id, p?, on?, amount?, blend?, mask? }; p is merged into the existing parameters.',
    'fx.remove': 'Remove an effect. { layer, id }',
    'fx.reorder': 'Move an effect inside its stack. { layer, id, index }',
    'mask.set': 'Set or clear a mask. { layer, mask } for the layer mask, { layer, fx: entryId, mask } for one effect; mask: null clears.',
    'adjust.add': 'Add an adjustment layer. { fx: [entries], name?, mask?, clip?, above?: layerId, x?, y?, w?, h?, opacity? }',
    'transform.set': 'Set or clear a perspective quad. { layer, quad: [[x,y]×4] | null } in page units (TL, TR, BR, BL); the layer box becomes its bounding box.'
  };
  function findLayer(doc, id) { var ls = doc.layers || []; for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i]; return null; }
  function strict(entry, errors, warnings) {
    var r = FX.validate(entry, '/entry');
    r.warnings.forEach(function (x) { warnings.push(x); });
    if (!r.ok) { r.errors.forEach(function (x) { errors.push(x); }); return null; }
    var bad = r.warnings.filter(function (x) { return x.code === 'forbidden-key'; });
    if (bad.length) { errors.push(bad[0]); return null; }
    return r.entry;
  }
  FX.ops = {
    list: function () { return Object.keys(OPS).map(function (k) { return { op: k, summary: OPS[k] }; }); },
    apply: function (doc, op) {
      var errors = [], warnings = [], out = clone(doc) || {}, id = null;
      function fail(code, message) { errors.push({ path: '', code: code, message: message }); return { ok: false, doc: doc, errors: errors, warnings: warnings, id: null }; }
      if (!isObj(doc) || !Array.isArray(doc.layers)) return fail('bad-doc', 'A page document with layers is needed.');
      if (!isObj(op) || !own(OPS, op.op)) return fail('unknown-op', 'Unknown operation. Known: ' + Object.keys(OPS).join(', ') + '.');
      var name = op.op, layer = name === 'adjust.add' ? null : findLayer(out, op.layer);
      if (name !== 'adjust.add' && !layer) return fail('no-layer', 'No layer with the id "' + String(op.layer).slice(0, 48) + '".');
      var stack = layer ? (Array.isArray(layer.fx) ? layer.fx : (layer.fx = [])) : null, i, entry;
      function indexOf(eid) { for (var k = 0; k < stack.length; k++) if (stack[k] && stack[k].id === eid) return k; return -1; }
      if (name === 'fx.add') {
        if (stack.length >= LIMITS.stack) return fail('too-many', 'A stack can hold ' + LIMITS.stack + ' effects.');
        entry = strict(op.entry, errors, warnings);
        if (!entry) return fail('bad-entry', 'The effect entry is not valid.');
        while (indexOf(entry.id) >= 0) entry.id = uid();
        i = isNum(op.index) ? clamp(Math.round(op.index), 0, stack.length) : stack.length;
        stack.splice(i, 0, entry); id = entry.id;
      } else if (name === 'fx.update' || name === 'fx.remove' || name === 'fx.reorder') {
        i = indexOf(op.id);
        if (i < 0) return fail('no-entry', 'No effect with the id "' + String(op.id).slice(0, 40) + '" on that layer.');
        id = op.id;
        if (name === 'fx.remove') stack.splice(i, 1);
        else if (name === 'fx.reorder') { if (!isNum(op.index)) return fail('bad-value', 'index must be a number.'); entry = stack.splice(i, 1)[0]; stack.splice(clamp(Math.round(op.index), 0, stack.length), 0, entry); }
        else {
          var next = clone(stack[i]);
          if (isObj(op.p)) { next.p = isObj(next.p) ? next.p : {}; Object.keys(op.p).forEach(function (k) { if (!BAD[k]) next.p[k] = op.p[k]; else errors.push({ path: '/p', code: 'forbidden-key', message: 'The key "' + k + '" is not allowed.' }); }); }
          ['on', 'amount', 'blend', 'mask'].forEach(function (k) { if (own(op, k)) next[k] = op[k]; });
          if (errors.length) return fail('bad-entry', 'The update is not valid.');
          entry = strict(next, errors, warnings);
          if (!entry) return fail('bad-entry', 'The update is not valid.');
          stack[i] = entry;
        }
        if (!stack.length) delete layer.fx;
      } else if (name === 'mask.set') {
        var m = op.mask == null ? null : cleanMask(op.mask, '/mask', warnings);
        if (op.mask != null && !m) return fail('bad-mask', 'The mask is not valid.');
        if (op.fx != null) {
          i = indexOf(op.fx);
          if (i < 0) return fail('no-entry', 'No effect with the id "' + String(op.fx).slice(0, 40) + '" on that layer.');
          stack[i].mask = m; id = op.fx;
        } else if (m) layer.fxMask = m; else delete layer.fxMask;
        if (!stack.length) delete layer.fx;
      } else if (name === 'adjust.add') {
        var list = Array.isArray(op.fx) ? op.fx : [];
        if (!list.length || list.length > LIMITS.stack) return fail('bad-value', 'fx must be a list of 1 to ' + LIMITS.stack + ' entries.');
        var clean = [];
        for (i = 0; i < list.length; i++) { entry = strict(list[i], errors, warnings); if (!entry) return fail('bad-entry', 'Entry ' + i + ' is not valid.'); clean.push(entry); }
        var al = { id: idOk(op.id, 48) && !findLayer(out, op.id) ? op.id : 'adj-' + uid(), type: 'adjust', name: typeof op.name === 'string' ? op.name.slice(0, 120) : 'Adjustment', x: isNum(op.x) ? op.x : 0, y: isNum(op.y) ? op.y : 0, w: isNum(op.w) && op.w > 0 ? op.w : out.width, h: isNum(op.h) && op.h > 0 ? op.h : out.height, rotation: 0, opacity: clamp(isNum(op.opacity) ? op.opacity : 1, 0, 1), visible: true, locked: false, clip: op.clip === true, fx: clean };
        var am = op.mask == null ? null : cleanMask(op.mask, '/mask', warnings);
        if (op.mask != null && !am) return fail('bad-mask', 'The mask is not valid.');
        if (am) al.fxMask = am;
        var at = out.layers.length;
        if (op.above != null) { at = -1; for (i = 0; i < out.layers.length; i++) if (out.layers[i].id === op.above) at = i + 1; if (at < 0) return fail('no-layer', 'No layer with the id "' + String(op.above).slice(0, 48) + '".'); }
        out.layers.splice(at, 0, al); id = al.id;
      } else if (name === 'transform.set') {
        if (op.quad == null) { delete layer.transform; }
        else {
          var u = Q.unit({ transform: { quad: op.quad } });
          if (!u) return fail('bad-quad', 'quad is four [x, y] corners (top-left, top-right, bottom-right, bottom-left) forming a convex shape.');
          var xs = op.quad.map(function (p) { return p[0]; }), ys = op.quad.map(function (p) { return p[1]; });
          if (xs.concat(ys).some(function (v) { return Math.abs(v) > 100000; })) return fail('bad-quad', 'quad is out of range.');
          layer.transform = { quad: op.quad.map(function (p) { return [p[0], p[1]]; }) };
          layer.x = Math.min.apply(null, xs); layer.y = Math.min.apply(null, ys);
          layer.w = Math.max(1, Math.max.apply(null, xs) - layer.x); layer.h = Math.max(1, Math.max.apply(null, ys) - layer.y);
          layer.rotation = 0;
        }
        id = layer.id;
      }
      return { ok: true, doc: out, errors: errors, warnings: warnings, id: id };
    }
  };

  /* ---------- Loader ---------- */
  var base = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (!s) { var n = document.querySelector('script[data-le-src*="fx/le-fx.js"],script[src*="fx/le-fx.js"]'); s = n ? (n.src || n.getAttribute('data-le-src')) : ''; }
    return s ? s.replace(/le-fx\.js(?:[?#].*)?$/, '') : 'assets/js/fx/';
  })();
  function load(name) {
    var src = base + 'le-fx-' + name + '.js';
    if (LE.lazy) return LE.lazy(src);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
  }
  FX._load = load;
  FX._const = { BLENDS: BLENDS, MASK_KINDS: MASK_KINDS, FACE_PARTS: FACE_PARTS, LIMITS: LIMITS };

  /* Effects registered before this file arrived. */
  var queue = Array.isArray(global.LE_FX_DEFS) ? global.LE_FX_DEFS : [];
  global.LE_FX_DEFS = { push: function (d) { try { FX.register(d); } catch (e) { if (global.console) console.warn('LE.fx: ' + e.message); } return 0; } };
  queue.forEach(function (d) { global.LE_FX_DEFS.push(d); });

  FX.ready = Promise.all([load('gl')].concat(PACKS.map(load))).then(function () { return FX; });

  /* Statistics load on first use. */
  FX.analyze = function (target, opts) {
    return load('analyze').then(function () { return FX._analyze(target, opts || {}); });
  };
})(window);
