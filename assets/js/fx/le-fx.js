/* LocalEditor effect renderer, core: registry, validation, document operations and the loader.
   Loaded on demand by le-fx-boot.js. The contract is docs/FX-AUTHORING.md. No WebGL in this file. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  if (LE.fx && LE.fx.register) return;
  var FX = LE.fx = LE.fx || {};

  /* Part of every cache key. Bump when the renderer's pixels change for the same document. */
  FX.build = 2;
  /* The registry's change counter: it moves whenever an effect or an action is registered. Cheap to ask on every frame. */
  var revision = 0;
  FX.version = function () { return revision; };
  /* The ui grammar's fixed words, one source for the registry, the tests and the workspace (docs/EXPERT-UI.md). */
  FX.UI = {
    sections: ['Light', 'Colour', 'Curves', 'Colour mixer', 'Colour grading', 'Detail', 'Optics', 'Geometry', 'Effects', 'Shadows & reflections', 'Compositing', 'Retouch'],
    controls: ['slider', 'bool', 'choice', 'color', 'point', 'angle', 'curve', 'wheel', 'bands', 'lut', 'seed'],
    composite: ['wheels', 'mixer', 'line'],
    spaces: ['linear', 'display', 'oklab']
  };
  /* A pack that brings its own workspace control (registered with LE.expert.controls.register) declares its name here first. */
  FX.declareControl = function (name) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{1,23}$/.test(name)) throw new Error('LE.fx: a control name is lower-case words joined by hyphens.');
    if (FX.UI.controls.indexOf(name) < 0 && FX.UI.controls.length < 48) { FX.UI.controls.push(name); revision++; }
  };
  /* Effect packs loaded with the renderer. Feature teams add their pack name here (assets/js/fx/le-fx-<name>.js). */
  var PACKS = ['basic', 'develop', 'grade', 'retouch', 'creative', 'relight', 'composite'];

  var BAD = { __proto__: 1, constructor: 1, prototype: 1 };
  var BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'difference', 'color', 'luminosity'];
  var NEEDS = ['alpha', 'scene', 'depth', 'normals', 'face', 'stats'];
  var PARAM_TYPES = ['number', 'bool', 'choice', 'color', 'point', 'angle', 'curve', 'wheel', 'bands', 'lut', 'seed', 'data'];
  var MASK_KINDS = {
    asset: {}, subject: {},
    linear: { x0: [-4, 5, 0.5], y0: [-4, 5, 0.25], x1: [-4, 5, 0.5], y1: [-4, 5, 0.75] },
    radial: { cx: [-4, 5, 0.5], cy: [-4, 5, 0.5], rx: [0.0001, 8, 0.3], ry: [0.0001, 8, 0.3], rotation: [-360, 360, 0] },
    luma: { min: [0, 1, 0], max: [0, 1, 1], soft: [0, 1, 0.1] },
    color: { h: [0, 360, 0], s: [0, 1, 0.5], l: [0, 1, 0.5], range: [0, 1, 0.15], soft: [0, 1, 0.1] },
    depth: { near: [0, 1, 0], far: [0, 1, 1], soft: [0, 1, 0.1] },
    face: {}, segment: {}
  };
  var SEGMENTS = { person: 1, hair: 1, skin: 1, clothes: 1, background: 1 };   /* layer.maps.segments (LE.maps) */
  var FACE_PARTS = { skin: 1, eyes: 1, lips: 1, teeth: 1, brows: 1, 'under-eyes': 1, 'inner-mouth': 1 };
  /* Documents use the hyphenated names; the names LE.maps gives its parts are accepted on input and stored hyphenated. */
  var FACE_ALIAS = { underEyes: 'under-eyes', innerMouth: 'inner-mouth' };
  var LIMITS = { stack: 32, parts: 8, params: 48, points: 64, data: 4096, layerData: 16384 };

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
  /* Curves are LE.curves (assets/js/fx/curves.js): the one spline the curve editor draws and the renderer samples. */
  M.curveLUT = function (points, n) { return LE.curves.sample(points, n || 1024); };
  /* OKLab (Björn Ottosson, 2020) from and to linear sRGB; the GLSL twins are fx_oklab and fx_oklab_inv in every shader. */
  M.oklab = function (c) {
    var l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]), m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]), q = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * q, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q];
  };
  M.oklabInv = function (L) {
    var l = L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], m = L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], q = L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2];
    l = l * l * l; m = m * m * m; q = q * q * q;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * q];
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
    else if (d.type === 'point') { var pd = pointOf(d.default); o.default = pd || { x: 0.5, y: 0.5 }; if (isNum(d.min)) o.min = d.min; if (isNum(d.max)) o.max = d.max; }
    else if (d.type === 'angle') o.default = isNum(d.default) ? clamp(d.default, -360, 360) : 0;
    else if (d.type === 'curve') o.default = curveOf(d.default) || curveOf([[0, 0], [1, 1]]);
    else if (d.type === 'wheel') o.default = wheelOf(d.default) || { h: 0, a: 0, l: 0 };
    else if (d.type === 'bands') { o.min = isNum(d.min) ? d.min : -100; o.max = isNum(d.max) ? d.max : 100; o.default = bandsOf(d.default, o.min, o.max) || bandsOf([0, 0, 0, 0, 0, 0, 0, 0], o.min, o.max); }
    else if (d.type === 'lut') o.default = null;
    else if (d.type === 'data') {
      /* A bounded list of numbers (strokes, spots, mesh points): max values, each inside range and a multiple of step. */
      o.max = Math.round(clamp(isNum(d.max) ? d.max : 1024, 1, LIMITS.data));
      o.range = Array.isArray(d.range) && isNum(d.range[0]) && isNum(d.range[1]) && d.range[1] > d.range[0] ? [d.range[0], d.range[1]] : [0, 1];
      o.step = isNum(d.step) && d.step > 0 ? d.step : 1e-4;
      o.default = [];
      if (isObj(d.legacy) && typeof d.legacy.prefix === 'string' && /^[a-zA-Z]\w{0,15}$/.test(d.legacy.prefix)) o.legacy = { prefix: d.legacy.prefix, params: Math.round(clamp(isNum(d.legacy.params) ? d.legacy.params : 1, 1, 16)) };
    }
    else if (d.type === 'seed') o.default = isNum(d.default) ? Math.round(clamp(d.default, 0, 2147483647)) : 0;
    if (isObj(d.ui)) o.ui = clone(d.ui);   /* hints for the control kit (gradient, hidden, fine …), passed through */
    return o;
  }

  /* Value shapes shared with the control kit (docs/EXPERT-UI.md). Each returns the canonical form, or null. */
  function pointOf(v) {
    if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])) return { x: v[0], y: v[1] };
    return isObj(v) && isNum(v.x) && isNum(v.y) ? { x: v.x, y: v.y } : null;
  }
  function pointsOf(v) {
    if (!Array.isArray(v) || v.length < 2) return null;
    var pts = [];
    for (var i = 0; i < Math.min(v.length, LIMITS.points); i++) {
      var q = pointOf(v[i]);
      if (!q) return null;
      pts.push([clamp(q.x, 0, 1), clamp(q.y, 0, 1)]);
    }
    return pts.sort(function (a, b) { return a[0] - b[0]; });
  }
  /* A curve is { master, r, g, b }, each a list of control points in 0–1; a bare list means master. */
  function curveOf(v) {
    if (Array.isArray(v)) v = { master: v };
    if (!isObj(v)) return null;
    var out = {}, ok = true;
    ['master', 'r', 'g', 'b'].forEach(function (k) { if (v[k] == null) { out[k] = [[0, 0], [1, 1]]; return; } var pts = pointsOf(v[k]); if (pts) out[k] = pts; else ok = false; });
    return ok ? out : null;
  }
  function wheelOf(v) {
    if (!isObj(v)) return null;
    var a = isNum(v.a) ? v.a : isNum(v.amount) ? v.amount : 0;
    return { h: (((isNum(v.h) ? v.h : 0) % 360) + 360) % 360, a: clamp(a, 0, 1), l: clamp(isNum(v.l) ? v.l : 0, -1, 1) };
  }
  /* Eight bands (red, orange, yellow, green, aqua, blue, purple, magenta) of { h, s, l }; eight plain numbers mean s. */
  function bandsOf(v, lo, hi) {
    if (!Array.isArray(v) || v.length !== 8) return null;
    var out = [];
    for (var i = 0; i < 8; i++) {
      var q = isNum(v[i]) ? { h: 0, s: v[i], l: 0 } : v[i];
      if (!isObj(q)) return null;
      out.push({ h: clamp(isNum(q.h) ? q.h : 0, lo, hi), s: clamp(isNum(q.s) ? q.s : 0, lo, hi), l: clamp(isNum(q.l) ? q.l : 0, lo, hi) });
    }
    return out;
  }

  FX.register = function (def) {
    if (!isObj(def) || typeof def.id !== 'string' || !/^[a-z][a-z0-9.-]{1,39}$/.test(def.id)) throw new Error('An effect needs an id such as "gaussian-blur".');
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
      space: def.space === 'display' || def.space === 'oklab' ? def.space : 'linear',
      needs: (Array.isArray(def.needs) ? def.needs : []).filter(function (n) { return NEEDS.indexOf(n) >= 0; }),
      params: params,
      radius: typeof def.radius === 'function' ? def.radius : function () { return 0; },
      grow: typeof def.grow === 'function' ? def.grow : null,
      draft: typeof def.draft === 'function' ? def.draft : null,
      passes: def.passes, inert: def.inert === true,   /* inert: described and validated, never drawn */
      /* source: { order, required } puts the effect in the source stage of a layer drawn from float data (RAW, HDR): it runs on
         the uncropped scene-referred picture, in that order, before everything else. inject(p, ctx) fills in what only the
         layer's source knows (a camera matrix, the picture's extent); its result is never written to the document. */
      source: isObj(def.source) || def.source === true ? { order: isNum(def.source.order) ? def.source.order : 50, required: def.source.required === true } : null,
      inject: typeof def.inject === 'function' ? def.inject : null,
      cpu: typeof def.cpu === 'function' ? def.cpu : null,
      support: { needs: Array.isArray(sup.needs) ? sup.needs.slice() : ['webgl2'], wants: Array.isArray(sup.wants) ? sup.wants.slice() : [], memoryMB: isNum(sup.memoryMB) ? sup.memoryMB : 0 },
      ui: isObj(def.ui) ? clone(def.ui) : { section: 'Effects' },
      agent: isObj(def.agent) ? clone(def.agent) : { summary: '' }
    };
    d.silhouette = d.needs.indexOf('alpha') >= 0 || d.needs.indexOf('scene') >= 0;
    if (!defs[d.id]) order.push(d.id);
    defs[d.id] = d;
    resolveMemo = {};
    revision++; shared = null;
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
  /* ---------- Describing the registry ----------
     describe()            a compact index, one line per effect: [{ id, name, group, section, summary }]
     describe(id)          one registration in full: { id, name, group, version, space, needs, spatial, params, ui, agent, support, cpu, actions }
     describe({ group })   the full registrations of a group (also { section }, { ids: [...] })
     defs()                every full registration, for the workspace's panels
     Full registrations are built once per registry version, frozen and shared: nothing is cloned per call, so they are safe to ask
     for during a drag. Copy before changing one. */
  var shared = null;
  function firstSentence(t) { t = String(t || ''); var m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t); return (m ? m[0] : t).slice(0, 140); }
  function freeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { freeze(o[k]); }); }
    return o;
  }
  function build() {
    if (shared) return shared;
    var full = [], byId = {}, index = [];
    order.forEach(function (id) {
      var d = defs[id], spatial = d.silhouette;
      try { spatial = spatial || d.radius(FX.defaults(id), 1) > 0; } catch (e) { /* a pack that is still loading */ }
      var one = freeze({ id: d.id, name: d.name, group: d.group, version: d.version, space: d.space, needs: d.needs.slice(), spatial: !!spatial, params: clone(d.params), ui: clone(d.ui), agent: clone(d.agent), support: clone(d.support), cpu: !!d.cpu, inert: d.inert });
      full.push(one); byId[id] = one;
      index.push(Object.freeze({ id: d.id, name: d.name, group: d.group, section: String(d.ui.section || 'Effects'), summary: firstSentence(d.agent.summary) }));
    });
    return (shared = { full: Object.freeze(full), byId: byId, index: Object.freeze(index) });
  }
  FX.defs = function () { return build().full; };
  FX.describe = function (what) {
    var b = build();
    if (what == null) return b.index;
    if (typeof what === 'string') return own(b.byId, what) ? b.byId[what] : null;
    if (isObj(what)) {
      return b.full.filter(function (d) {
        return (what.group == null || d.group === what.group) && (what.section == null || d.ui.section === what.section) && (!Array.isArray(what.ids) || what.ids.indexOf(d.id) >= 0);
      });
    }
    return null;
  };

  /* ---------- Actions ----------
     A button in an effect's panel, or a call an agent makes, that works something out and answers with data: never script in a
     document (rule A5). ui.controls names one with { action: 'grade.auto', label }.
       LE.fx.actions.register({ id, label, kind, needs, accept, run })
         kind    'apply' (default) | 'pick' (the person clicks the picture first) | 'export' | 'import' (a file is chosen first)
         needs   ['stats'] to be handed LE.fx.analyze numbers of the layer
         run     function (ctx) → result or a promise of one; pure: it reads ctx and returns data
         ctx     { layer, stack, entry, p, stats, pick: { linear: [r,g,b], display: [r,g,b], x, y }, text, file, name }
         result  { p: { …patch of this entry's parameters } } | { fx: [ { type, p } … ] } (each is added, or merged into the first
                 entry of that type) | { ops: [ LE.fx.ops operations without "layer" ] } | { download: { name, text, type } } | { message }
       LE.fx.actions.run(id, ctx) → a promise of { ok, ops: [...validated operations for ctx.layer.id], download, message } */
  var actions = {};
  FX.actions = {
    register: function (a) {
      if (!isObj(a) || typeof a.id !== 'string' || !/^[a-z][\w.-]{1,59}$/.test(a.id) || typeof a.run !== 'function') throw new Error('An action needs an id such as "grade.auto" and run(ctx).');
      actions[a.id] = { id: a.id, label: String(a.label || a.id).slice(0, 60), kind: ['pick', 'export', 'import', 'call'].indexOf(a.kind) >= 0 ? a.kind : 'apply', needs: Array.isArray(a.needs) ? a.needs.filter(function (n) { return n === 'stats' || n === 'image' || n === 'scene'; }) : [], accept: typeof a.accept === 'string' ? a.accept.slice(0, 80) : '', summary: String(a.summary || '').slice(0, 200), run: a.run };
      /* kind 'call': a helper for agents (the fx.call operation). args: { name: 'what it is' }, plain words. */
      var args = {};
      if (isObj(a.args)) Object.keys(a.args).slice(0, 16).forEach(function (k) { if (!BAD[k]) args[k.slice(0, 32)] = String(a.args[k]).slice(0, 160); });
      actions[a.id].args = args;
      revision++;
      return actions[a.id];
    },
    get: function (id) { var a = own(actions, id) ? actions[id] : null; return a ? { id: a.id, label: a.label, kind: a.kind, needs: a.needs.slice(), accept: a.accept, summary: a.summary, args: clone(a.args || {}) } : null; },
    list: function () { return Object.keys(actions).map(function (id) { return FX.actions.get(id); }); },
    run: function (id, ctx) {
      var a = own(actions, id) ? actions[id] : null;
      ctx = ctx || {};
      if (!a) return Promise.resolve({ ok: false, ops: [], message: 'Unknown action "' + String(id).slice(0, 60) + '".' });
      var layer = isObj(ctx.layer) ? ctx.layer : { id: 'layer' }, stack = Array.isArray(ctx.stack) ? ctx.stack : (Array.isArray(layer.fx) ? layer.fx : []);
      var given = { layer: clone(layer), stack: clone(stack), entry: ctx.entry ? clone(ctx.entry) : null, p: ctx.entry && isObj(ctx.entry.p) ? clone(ctx.entry.p) : {}, stats: ctx.stats || null, pick: ctx.pick || null, text: ctx.text == null ? null : String(ctx.text), file: ctx.file || null, name: ctx.name || '' };
      given.args = isObj(ctx.args) ? clone(ctx.args) : {};
      given.doc = isObj(ctx.doc) ? clone(ctx.doc) : null;
      given.image = ctx.image || null; given.scene = ctx.scene || null;   /* only for actions that declare needs: ['image'] / ['scene'] */
      return Promise.resolve().then(function () { return a.run(given); }).then(function (r) {
        if (r == null && a.kind === 'call') return { ok: false, ops: [], message: 'Nothing to do: the layer does not have what "' + a.id + '" needs.' };
        r = isObj(r) ? r : {};
        if (typeof r.op === 'string') r = { ops: [r] };   /* a helper may answer with one operation */
        if (r.ok === false) return { ok: false, ops: [], message: String((Array.isArray(r.errors) && r.errors[0] && r.errors[0].message) || r.message || 'It could not be done.').slice(0, 300) };
        var ops = [], seen = {};
        if (isObj(r.p) && given.entry) ops.push({ op: 'fx.update', layer: layer.id, id: given.entry.id, p: clone(r.p) });
        (Array.isArray(r.fx) ? r.fx : []).slice(0, LIMITS.stack).forEach(function (e) {
          if (!isObj(e) || typeof e.type !== 'string') return;
          var at = -1;
          stack.forEach(function (x, i) { if (at < 0 && x && x.type === e.type && !seen[x.id]) at = i; });
          if (at >= 0) { seen[stack[at].id] = 1; ops.push({ op: 'fx.update', layer: layer.id, id: stack[at].id, p: clone(e.p || {}) }); }
          else ops.push({ op: 'fx.add', layer: layer.id, entry: clone(e) });
        });
        (Array.isArray(r.ops) ? r.ops : []).slice(0, 64).forEach(function (o) { if (isObj(o) && own(OPS, o.op)) { var c = clone(o); if (c.op !== 'adjust.add' && (a.kind !== 'call' || typeof c.layer !== 'string')) c.layer = layer.id; ops.push(c); } });
        var dl = isObj(r.download) && typeof r.download.text === 'string' ? { name: String(r.download.name || 'download.txt').replace(/[^\w .()-]/g, '').slice(0, 80) || 'download.txt', text: r.download.text, type: /^[\w.+-]+\/[\w.+-]+$/.test(r.download.type || '') ? r.download.type : 'text/plain' } : null;
        var data = null;
        if (isObj(r.data)) { try { var js = JSON.stringify(r.data); if (js.length <= 20000) data = JSON.parse(js); } catch (e2) { data = null; } }
        var out = { ok: true, ops: ops, download: dl, message: typeof r.message === 'string' ? r.message.slice(0, 300) : '' };
        if (data) out.data = data;
        return out;
      }, function (e) { return { ok: false, ops: [], message: String(e && e.message || e).slice(0, 300) }; });
    }
  };

  /* ---------- Data assets (LUT text and other non-image files) ----------
     LE.fx.data(id) → { id, text, bytes } once it is loaded, else null: it is fetched from the scene's assets or the project store
     in the background and LE.fx.touch() redraws when it arrives. LE.fx.data.load(id) → a promise of the same.
     Inside an effect, g.asset(id) is this call. Up to 16 MB of text per asset; 12 are kept. */
  var dataCache = {}, dataOrder = [], dataJobs = {}, DATA_MAX = 16 * 1048576;
  function dataKeep(id, rec) {
    dataCache[id] = rec;
    var i = dataOrder.indexOf(id);
    if (i >= 0) dataOrder.splice(i, 1);
    dataOrder.push(id);
    while (dataOrder.length > 12) delete dataCache[dataOrder.shift()];
    return rec;
  }
  FX.data = function (id) {
    if (!idOk(id, 80)) return null;
    if (own(dataCache, id)) return dataCache[id];
    FX.data.load(id).then(function (rec) { if (rec && FX.touch) FX.touch(); }, function () {});
    return null;
  };
  FX.data.sources = [];   /* functions (id) → Blob | string | null (or a promise), asked in order; the scene path adds its assets */
  FX.data.put = function (id, text) { return idOk(id, 80) && typeof text === 'string' && text.length <= DATA_MAX ? dataKeep(id, { id: id, text: text, bytes: text.length }) : null; };
  FX.data.load = function (id) {
    if (!idOk(id, 80)) return Promise.resolve(null);
    if (own(dataCache, id)) return Promise.resolve(dataCache[id]);
    if (dataJobs[id]) return dataJobs[id];
    var tries = FX.data.sources.slice();
    if (LE.project && LE.project.getAsset) tries.push(function (x) { return LE.project.getAsset(x); });
    function next(i) {
      if (i >= tries.length) return Promise.resolve(null);
      return Promise.resolve().then(function () { return tries[i](id); }).then(function (v) {
        if (typeof v === 'string') return v;
        if (v && typeof v.text === 'function' && !(v.size > DATA_MAX) && !/^image\//.test(v.type || '')) return v.text();
        return next(i + 1);
      }, function () { return next(i + 1); });
    }
    dataJobs[id] = next(0).then(function (text) { delete dataJobs[id]; return typeof text === 'string' && text.length <= DATA_MAX ? dataKeep(id, { id: id, text: text, bytes: text.length }) : null; });
    return dataJobs[id];
  };

  /* ---------- Resizing a design ----------
     Lengths marked unit: 'px' are document pixels, so when a design is resized with its content they scale with it.
     LE.fx.rescale(layer, k) changes the layer in place (its fx stack, mask blurs, quad) and returns true when anything moved. */
  FX.rescale = function (layer, k) {
    if (!isObj(layer) || !isNum(k) || !(k > 0) || k === 1) return false;
    var changed = false;
    function mask(m) { ((m && m.parts) || []).forEach(function (q) { if (q && isNum(q.blur) && q.blur) { q.blur = Math.round(q.blur * k * 1000) / 1000; changed = true; } }); }
    (Array.isArray(layer.fx) ? layer.fx : []).forEach(function (e) {
      var d = e && FX.get(e.type);
      mask(e && e.mask);
      if (!d || !isObj(e.p)) return;
      Object.keys(d.params).forEach(function (key) {
        var sc = d.params[key];
        if (sc.type === 'number' && sc.unit === 'px' && isNum(e.p[key]) && e.p[key] !== 0) { e.p[key] = clamp(Math.round(e.p[key] * k * 1000) / 1000, sc.min, sc.max); changed = true; }
      });
    });
    mask(layer.layerMask);
    return changed;
  };

  /* Everything else an agent needs to write expert data: blends, mask kinds and their ranges, limits, the entry shape. */
  FX.schema = function () {
    return {
      version: FX.build, blends: BLENDS.slice(), paramTypes: PARAM_TYPES.slice(), spaces: FX.UI.spaces.slice(), sections: FX.UI.sections.slice(), actions: FX.actions.list(),
      maskKinds: Object.keys(MASK_KINDS).map(function (k) { return { kind: k, fields: clone(MASK_KINDS[k]) }; }),
      mask: { on: true, invert: false, parts: [{ kind: 'radial', mode: 'add', invert: false, feather: 0.25, density: 1, blur: 0 }] },
      faceParts: Object.keys(FACE_PARTS), segments: Object.keys(SEGMENTS), limits: clone(LIMITS),
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
    if (t === 'point') { var pt = pointOf(v); return pt ? { x: clamp(pt.x, s.min == null ? -1 : s.min, s.max == null ? 2 : s.max), y: clamp(pt.y, s.min == null ? -1 : s.min, s.max == null ? 2 : s.max) } : bad('A point is { x, y }.'); }
    if (t === 'curve') {
      var cv = curveOf(v);
      if (!cv) return bad('A curve is { master, r, g, b }, each a list of at least two [x, y] points (a bare list means master).');
      if (['master', 'r', 'g', 'b'].some(function (k) { return isObj(v) && Array.isArray(v[k]) && v[k].length > LIMITS.points; }) || (Array.isArray(v) && v.length > LIMITS.points)) warn(w, path, 'clamped', 'A curve can have up to ' + LIMITS.points + ' points; the rest were dropped.');
      return cv;
    }
    if (t === 'wheel') return wheelOf(v) || bad('A wheel is { h, a, l }.');
    if (t === 'bands') return bandsOf(v, s.min, s.max) || bad('Bands are eight { h, s, l } objects.');
    if (t === 'lut') return v === null || idOk(v, 80) ? v : bad('A LUT is an asset id.');
    if (t === 'data') {
      if (isObj(v) && Array.isArray(v.master)) v = legacyData({ x0: v }, 'x', 1);   /* the packed-curve form of the first retouch pack */
      return Array.isArray(v) ? dataOf(s, v, path, w) : bad('Data is a flat list of numbers.');
    }
    return clone(s.default);
  }

  /* data parameters. A clean list is returned as it is (the same object), so its content hash is computed once: lists are
     replaced, never changed in place. */
  function dataOf(s, v, path, w) {
    var lo = s.range[0], hi = s.range[1], st = s.step, n = Math.min(v.length, s.max), i, x, ok = v.length <= s.max;
    for (i = 0; ok && i < n; i++) { x = v[i]; ok = typeof x === 'number' && x >= lo && x <= hi && Math.abs(x / st - Math.round(x / st)) < 1e-6; }
    if (ok) return v;
    if (v.length > s.max) warn(w, path, 'clamped', 'This list can hold ' + s.max + ' numbers; the rest were dropped.');
    var digits = Math.max(0, Math.min(8, Math.ceil(-Math.log(st) / Math.LN10 - 1e-9))), out = new Array(n);
    for (i = 0; i < n; i++) { x = isNum(v[i]) ? clamp(v[i], lo, hi) : lo; out[i] = Number((Math.round(x / st) * st).toFixed(digits)); }
    return out;
  }
  /* The first retouch pack kept its records in hidden curve parameters (prefix0, prefix1 …: four channels of 64 points, the y of
     each point a value, the first value the count / 10000). Read here so that documents made then still open. */
  function legacyData(p, prefix, params) {
    var flat = [], k, j;
    for (k = 0; k < params; k++) {
      var cv = p[prefix + k];
      ['master', 'r', 'g', 'b'].forEach(function (ch) {
        var pts = isObj(cv) && Array.isArray(cv[ch]) ? cv[ch] : [];
        for (j = 0; j < 64; j++) flat.push(Array.isArray(pts[j]) && isNum(pts[j][1]) ? pts[j][1] : 0);
      });
    }
    var n = Math.round((flat[0] || 0) * 10000);
    return flat.slice(1, 1 + Math.max(0, Math.min(n, flat.length - 1)));
  }
  var dataTags = typeof WeakMap === 'function' ? new WeakMap() : null;
  function dataTag(a) {
    var t = dataTags && dataTags.get(a);
    if (t) return t;
    var h1 = 2166136261, h2 = 5381, i, x;
    for (i = 0; i < a.length; i++) { x = Math.round(a[i] * 1e6) | 0; h1 = Math.imul(h1 ^ x, 16777619); h2 = (Math.imul(h2, 33) + x + i) | 0; }
    t = '#' + a.length + '.' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
    if (dataTags) dataTags.set(a, t);
    return t;
  }
  /* JSON for cache keys: long number lists stand in as their content hash, so nothing large is written out per frame. */
  FX.keyOf = function (v) { return JSON.stringify(v, function (k, x) { return Array.isArray(x) && x.length > 24 && typeof x[0] === 'number' ? dataTag(x) : x; }); };

  function cleanMask(mask, path, w) {
    if (mask == null) return null;
    if (!isObj(mask) || !Array.isArray(mask.parts)) { warn(w, path, 'bad-value', 'A mask is { on, invert, parts: [...] }.'); return null; }
    if (mask.parts.length > LIMITS.parts) warn(w, path + '/parts', 'clamped', 'A mask can have up to ' + LIMITS.parts + ' parts.');
    var parts = [];
    mask.parts.slice(0, LIMITS.parts).forEach(function (src, i) {
      var pp = path + '/parts/' + i;
      if (!isObj(src) || !own(MASK_KINDS, src.kind)) { warn(w, pp, 'unknown-kind', 'Unknown mask kind; the part was left out.'); return; }
      var o = {
        kind: src.kind, mode: src.mode === 'subtract' || src.mode === 'intersect' ? src.mode : 'add', invert: src.invert === true,
        feather: clamp(isNum(src.feather) ? src.feather : 0.25, 0, 1), density: clamp(isNum(src.density) ? src.density : 1, 0, 1),
        blur: clamp(isNum(src.blur) ? src.blur : 0, 0, 500)
      };
      var f = MASK_KINDS[src.kind];
      Object.keys(f).forEach(function (k) {
        var v = isNum(src[k]) ? src[k] : f[k][2];
        if (v < f[k][0] || v > f[k][1]) { warn(w, pp + '/' + k, 'clamped', 'Out of range; clamped.'); v = clamp(v, f[k][0], f[k][1]); }
        o[k] = v;
      });
      if (src.kind === 'asset') { if (!idOk(src.asset, 80)) { warn(w, pp + '/asset', 'bad-value', 'An asset mask needs an asset id.'); return; } o.asset = src.asset; }
      if (src.kind === 'face') { if (own(FACE_ALIAS, src.part)) src = Object.assign({}, src, { part: FACE_ALIAS[src.part] }); if (!own(FACE_PARTS, src.part)) { warn(w, pp + '/part', 'bad-value', 'part is one of ' + Object.keys(FACE_PARTS).join(', ') + '.'); return; } o.part = src.part; }
      if (src.kind === 'segment') { if (!own(SEGMENTS, src.class)) { warn(w, pp + '/class', 'bad-value', 'class is one of ' + Object.keys(SEGMENTS).join(', ') + '.'); return; } o.class = src.class; }
      Object.keys(src).forEach(function (k) { if (BAD[k]) warn(w, pp, 'forbidden-key', 'The key "' + k + '" is not allowed.'); else if (!own(o, k)) warn(w, pp + '/' + k, 'unknown-key', 'Unknown mask field; ignored.'); });
      parts.push(o);
    });
    /* A mask with no parts is "everything" (the reference does the same), so it only matters when inverted. */
    var out = { on: mask.on !== false, invert: mask.invert === true, parts: parts };
    return parts.length || out.invert ? out : null;
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
    var old = {};
    Object.keys(d.params).forEach(function (k) {
      var s = d.params[k], L = s.type === 'data' && s.legacy;
      if (!L) return;
      for (var i = 0; i < L.params; i++) old[L.prefix + i] = 1;
      if (!own(p, k) && isObj(p[L.prefix + '0'])) { var q = {}; Object.keys(p).forEach(function (x) { q[x] = p[x]; }); q[k] = legacyData(p, L.prefix, L.params); p = q; }
    });
    Object.keys(p).forEach(function (k) {
      if (BAD[k]) warn(w, path + '/p', 'forbidden-key', 'The key "' + k + '" is not allowed.');
      else if (!own(d.params, k) && !own(old, k)) warn(w, path + '/p/' + k.slice(0, 40), 'unknown-key', 'Unknown parameter for ' + d.id + '; ignored.');
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
    var key = FX.keyOf(stack);
    if (own(resolveMemo, key)) return resolveMemo[key];
    var entries = [], skipped = [];
    stack.slice(0, LIMITS.stack).forEach(function (src, i) {
      var r = FX.validate(src, '/fx/' + i);
      if (!r.ok) { skipped.push({ index: i, type: src && typeof src.type === 'string' ? src.type.slice(0, 40) : null, reason: r.errors[0] ? r.errors[0].code : 'bad-entry' }); return; }
      var d = FX.get(r.entry.type);
      if (!r.entry.on || r.entry.amount <= 0 || d.inert) return;
      entries.push({ id: r.entry.id, type: d.id, def: d, p: r.entry.p, amount: r.entry.amount, blend: r.entry.blend, mask: r.entry.mask, sig: d.id + '@' + d.version + FX.keyOf([r.entry.p, r.entry.amount, r.entry.blend, r.entry.mask]) });
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
      maskParts(l.layerMask); (Array.isArray(l.fx) ? l.fx : []).forEach(function (en) { maskParts(en && en.mask); });
      parts.forEach(function (p) {
        if (!p) return;
        if (p.kind === 'subject' && !(l.cutout && l.cutout.asset)) out.push({ layer: l.id, path: '/mask', code: 'missing-map', message: 'A subject mask needs a cut-out on this layer.' });
        if (p.kind === 'depth' && !(l.maps && l.maps.depth && l.maps.depth.asset)) out.push({ layer: l.id, path: '/mask', code: 'missing-map', message: 'A depth mask needs layer.maps.depth.' });
        if (p.kind === 'face' && !(l.maps && l.maps.face)) out.push({ layer: l.id, path: '/mask', code: 'missing-map', message: 'A face mask needs layer.maps.face.' });
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
      /* An entry is named by its id, or by its type when the layer has exactly one of that kind. */
      function entryAt(ref) {
        var k = indexOf(ref), same = [];
        if (k >= 0 || typeof ref !== 'string') return k;
        stack.forEach(function (e, j) { if (e && e.type === ref) same.push(j); });
        if (same.length > 1) { errors.push({ path: '', code: 'ambiguous', message: 'The layer has ' + same.length + ' "' + ref.slice(0, 40) + '" effects. Use an entry id: ' + same.map(function (j) { return stack[j].id; }).join(', ') + '.' }); return -2; }
        return same.length ? same[0] : -1;
      }
      function noEntry(k, ref) { return k === -2 ? { ok: false, doc: doc, errors: errors, warnings: warnings, id: null } : fail('no-entry', 'No effect with the id "' + String(ref).slice(0, 40) + '" on that layer.'); }
      if (name === 'fx.add') {
        if (stack.length >= LIMITS.stack) return fail('too-many', 'A stack can hold ' + LIMITS.stack + ' effects.');
        entry = strict(op.entry, errors, warnings);
        if (!entry) return fail('bad-entry', 'The effect entry is not valid.');
        while (indexOf(entry.id) >= 0) entry.id = uid();
        i = isNum(op.index) ? clamp(Math.round(op.index), 0, stack.length) : stack.length;
        stack.splice(i, 0, entry); id = entry.id;
      } else if (name === 'fx.update' || name === 'fx.remove' || name === 'fx.reorder') {
        i = entryAt(op.id);
        if (i < 0) return noEntry(i, op.id);
        id = stack[i].id;
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
        if (op.mask != null && !m && !(isObj(op.mask) && Array.isArray(op.mask.parts) && !op.mask.parts.length)) return fail('bad-mask', 'The mask is not valid.');
        if (op.fx != null) {
          i = entryAt(op.fx);
          if (i < 0) return noEntry(i, op.fx);
          stack[i].mask = m; id = stack[i].id;
        } else if (m) layer.layerMask = m; else delete layer.layerMask;
        if (!stack.length) delete layer.fx;
      } else if (name === 'adjust.add') {
        var list = Array.isArray(op.fx) ? op.fx : [];
        if (!list.length || list.length > LIMITS.stack) return fail('bad-value', 'fx must be a list of 1 to ' + LIMITS.stack + ' entries.');
        var clean = [];
        for (i = 0; i < list.length; i++) { entry = strict(list[i], errors, warnings); if (!entry) return fail('bad-entry', 'Entry ' + i + ' is not valid.'); clean.push(entry); }
        var al = { id: idOk(op.id, 48) && !findLayer(out, op.id) ? op.id : 'adj-' + uid(), type: 'adjust', name: typeof op.name === 'string' ? op.name.slice(0, 120) : 'Adjustment', x: isNum(op.x) ? op.x : 0, y: isNum(op.y) ? op.y : 0, w: isNum(op.w) && op.w > 0 ? op.w : out.width, h: isNum(op.h) && op.h > 0 ? op.h : out.height, rotation: 0, opacity: clamp(isNum(op.opacity) ? op.opacity : 1, 0, 1), visible: true, locked: false, clip: op.clip === true, fx: clean };
        var am = op.mask == null ? null : cleanMask(op.mask, '/mask', warnings);
        if (op.mask != null && !am) return fail('bad-mask', 'The mask is not valid.');
        if (am) al.layerMask = am;
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

  /* ---------- The open design format (.ledesign.json): reading expert fields; le-design.js calls this when a file has any ---------- */
  FX.design = {
    /* drafts: [{ l (layer being built), path, expert: { raw, type, page } }]. ctx: { rep (err, warn), imgs (list resolved next), src(value, path, ref) }.
       Returns a function to call once the images are resolved. */
    read: function (drafts, ctx) {
      var rep = ctx.rep, todo = [];
      drafts.forEach(function (d) {
        var raw = d.expert.raw, type = d.expert.type, path = d.path, l = d.l, refs = [];
        var where = { page: d.expert.page, layer: l.id };
        if (type === 'image' && isObj(raw.fxBaked) && !d.fx) {
          d.fx = clone(raw.fxBaked);
          d.fxImg = ctx.src(raw.fxBaked.src, path + '/fxBaked/src', where);
          if (d.fxImg && d.fxImg.kind !== 'remote') ctx.imgs.push(d.fxImg);
        }
        if (raw.fx != null && !Array.isArray(raw.fx)) { rep.err(path + '/fx', 'fx is a list of effect entries: [{ "type": "exposure", "p": { "ev": 0.5 } }].'); raw.fx = null; }
        ['layerMask', 'transform', 'retouch', 'maps', 'raw'].forEach(function (k) { if (raw[k] != null && !isObj(raw[k])) { rep.err(path + '/' + k, k + ' must be an object.'); raw[k] = null; } });
        try { raw = clone({ fx: raw.fx, layerMask: raw.layerMask, transform: raw.transform, retouch: raw.retouch, maps: raw.maps, raw: raw.raw }); } catch (e) { rep.err(path, 'The expert fields of this layer could not be read.'); return; }
        /* A data asset written into a parameter (LUT text as a data: URI) is taken out before the shape check, which keeps strings
           short, and stored as a project asset afterwards; the parameter then holds its id. */
        var datas = [];
        (Array.isArray(raw.fx) ? raw.fx : []).forEach(function (e) {
          if (!isObj(e) || !isObj(e.p)) return;
          Object.keys(e.p).forEach(function (k) { if (typeof e.p[k] === 'string' && /^data:/i.test(e.p[k])) { datas.push(e.p[k]); e.p[k] = 'x:data:' + (datas.length - 1); } });
        });
        /* Every "asset" is an image source like src. It is swapped for a marker while the shape is checked, and resolved with the other images. */
        (function walk(o, at, depth) {
          if (!o || typeof o !== 'object' || depth > 6) return;
          Object.keys(o).slice(0, 600).forEach(function (k) {
            if (k === 'asset' && typeof o[k] === 'string') {
              var img = ctx.src(o[k], at + '/asset', where);
              if (img && img.kind === 'remote') { rep.warn(at + '/asset', 'remote-asset', 'Masks and maps cannot be remote images; this one was left out.', l.id); img = null; }
              o[k] = 'x:ref:' + refs.length;
              refs.push(img);
              if (img) ctx.imgs.push(img);
            } else if (o[k] && typeof o[k] === 'object') walk(o[k], at + '/' + k, depth + 1);
          });
        })(raw, path, 0);
        var x = LE.Scene.expertOf(raw, {});
        if (Array.isArray(raw.fx) && (!x.fx || x.fx.length !== Math.min(raw.fx.length, LIMITS.stack))) rep.warn(path + '/fx', 'bad-effect', 'An effect entry needs a "type" such as "exposure"; entries without one were left out.', l.id);
        if (Array.isArray(raw.fx) && raw.fx.length > LIMITS.stack) rep.warn(path + '/fx', 'too-many', 'A layer can have up to ' + LIMITS.stack + ' effects; the rest were left out.', l.id);
        if (isObj(raw.transform) && !x.transform) rep.err(path + '/transform/quad', 'transform.quad is four [x, y] corners in page units: top-left, top-right, bottom-right, bottom-left.');
        todo.push({ d: d, x: x, refs: refs, datas: datas });
      });
      function storeData(t) {
        var jobs = [];
        (t.x.fx || []).forEach(function (e, i) {
          var def = FX.get(e.type);
          Object.keys(e.p || {}).forEach(function (k) {
            var m = typeof e.p[k] === 'string' ? /^x:data:(\d+)$/.exec(e.p[k]) : null;
            if (!m) return;
            var uri = t.datas[Number(m[1])], at = t.d.path + '/fx/' + i + '/p/' + k;
            e.p[k] = null;
            var q = /^data:(text\/plain|application\/octet-stream)(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/i.exec(uri || '');
            if (!def || !def.params[k] || def.params[k].type !== 'lut' || !q) { rep.warn(at, 'bad-data', 'Only a LUT parameter can carry embedded data, as a text/plain data: URI; this one was left out.', t.d.l.id); return; }
            if (q[3].length > 6 * 1048576) { rep.warn(at, 'too-large', 'Embedded data can be up to 4 MB; this one was left out.', t.d.l.id); return; }
            if (!(LE.project && LE.project.putAsset)) return;
            jobs.push(Promise.resolve().then(function () {
              var text = q[2] ? atob(q[3].replace(/\s+/g, '')) : decodeURIComponent(q[3]), bytes = new Uint8Array(text.length);
              for (var j = 0; j < text.length; j++) bytes[j] = text.charCodeAt(j) & 255;
              return LE.project.putAsset({ blob: new Blob([bytes], { type: 'text/plain' }), name: 'look.cube', type: 'text/plain' });
            }).then(function (meta) { e.p[k] = meta.id; }, function () { rep.warn(at, 'bad-data', 'The embedded data could not be read; it was left out.', t.d.l.id); }));
          });
        });
        return Promise.all(jobs);
      }
      return function () {
        return Promise.all(todo.map(storeData)).then(function () { finish(); });
      };
      function finish() {
        todo.forEach(function (t) {
          var d = t.d, l = d.l;
          (function fix(o) {
            if (!o || typeof o !== 'object') return;
            if (Array.isArray(o)) { for (var i = o.length - 1; i >= 0; i--) { fix(o[i]); if (o[i] && o[i].asset === null) o.splice(i, 1); } return; }
            Object.keys(o).forEach(function (k) {
              var m = typeof o[k] === 'string' ? /^x:ref:(\d+)$/.exec(o[k]) : null;
              if (k === 'asset' && m) { var img = t.refs[Number(m[1])]; o[k] = img && img.id ? img.id : null; }
              else if (m) delete o[k];
              else { fix(o[k]); if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && o[k].asset === null) delete o[k]; }
            });
          })(t.x);
          Object.keys(t.x).forEach(function (k) { l[k] = t.x[k]; });
          if (l.maps && !Object.keys(l.maps).length) delete l.maps;
          (l.fx || []).forEach(function (e, i) {
            var r = FX.validate(e, d.path + '/fx/' + i);
            r.errors.forEach(function (m) { rep.warn(m.path, m.code, m.message + ' It is kept in the file but not drawn.', l.id); });
            r.warnings.forEach(function (m) { rep.warn(m.path, m.code, m.message, l.id); });
            if (r.ok) l.fx[i] = r.entry;
          });
          if (l.layerMask) {
            var w = [], cm = cleanMask(l.layerMask, d.path + '/layerMask', w);
            w.forEach(function (m) { rep.warn(m.path, m.code, m.message, l.id); });
            if (cm) l.layerMask = cm; else delete l.layerMask;
          }
        });
      };
    }
  };

  /* ---------- Float sources (the seam for RAW and HDR) ----------
     LE.fx.sources.register(kind, provider)   kind: layer.raw.kind ('raw' when absent)
       provider(layer, { targetMax, preview, draft, scene, entries }) → a promise of null or
         { source: { data: Float32Array, width, height, channels: 3 | 4, space: 'linear' | 'display' }   upright, uncropped
           box: { w, h }     the full-resolution size: the document pixels of the source stage, so radii mean the same in preview and export
           key: string       identifies the pixels
           ctx: { … }        handed to each source-stage effect's inject(p, ctx) }
     LE.fx.sources.lazy(kind, load)   load() → a promise; called once when a layer of that kind is drawn and nothing is registered.
     A layer is drawn from its float source when layer.raw.source.asset is set and a provider answers; otherwise from its 8-bit
     picture, exactly as before. */
  var providers = {}, lazies = {};
  FX.sources = {
    register: function (kind, fn) { if (typeof fn === 'function' && /^[a-z][\w-]{0,20}$/.test(kind)) providers[kind] = fn; },
    lazy: function (kind, fn) { if (typeof fn === 'function' && /^[a-z][\w-]{0,20}$/.test(kind)) lazies[kind] = fn; },
    get: function (kind) { return providers[kind] || null; },
    provider: function (kind) {
      if (providers[kind]) return Promise.resolve(providers[kind]);
      return Promise.resolve(lazies[kind] ? lazies[kind](kind) : null).then(function () {
        if (!providers[kind]) throw new Error('No source for "' + kind + '" layers.');
        return providers[kind];
      });
    },
    is: function (l) { return !!(l && l.type === 'image' && isObj(l.raw) && isObj(l.raw.source) && typeof l.raw.source.asset === 'string'); },
    /* A stack split into the source stage (effects that declare `source`, in their fixed order, with a default entry for each
       required one that is missing) and the rest. */
    split: function (fx) {
      var dev = [], rest = [];
      (Array.isArray(fx) ? fx : []).forEach(function (e) { var d = e && defs[e.type]; if (d && d.source) dev.push(e); else if (e) rest.push(e); });
      order.forEach(function (id) {
        var d = defs[id];
        if (d.source && d.source.required && !dev.some(function (e) { return e.type === id; })) dev.push({ id: 'src-' + id, type: id, on: true, amount: 1, blend: 'normal', p: {} });
      });
      dev = dev.map(function (e, i) { return [e, i]; }).sort(function (a, b) { return (defs[a[0].type].source.order - defs[b[0].type].source.order) || (a[1] - b[1]); }).map(function (q) { return q[0]; });
      return { dev: dev, rest: rest };
    },
    inject: function (dev, ctx) {
      return (dev || []).map(function (e) {
        var o = clone(e), d = defs[o.type];
        o.p = isObj(o.p) ? o.p : {};
        if (d && d.inject) { var full = FX.defaults(o.type); Object.keys(o.p).forEach(function (k) { full[k] = o.p[k]; }); o.p = d.inject(full, ctx || {}) || full; }
        return o;
      });
    }
  };

  /* ---------- Loader ---------- */
  var base = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (!s) { var n = document.querySelector('script[data-le-src*="fx/le-fx.js"],script[src*="fx/le-fx.js"]'); s = n ? (n.src || n.getAttribute('data-le-src')) : ''; }
    return s ? s.replace(/le-fx\.js(?:[?#].*)?$/, '') : 'assets/js/fx/';
  })();
  function script(src) {
    if (LE.lazy) return LE.lazy(src);
    return new Promise(function (res, rej) { var n = document.createElement('script'); n.src = src; n.onload = function () { res(); }; n.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(n); });
  }
  function load(name) { return script(base + 'le-fx-' + name + '.js'); }
  FX._load = load;
  FX._const = { BLENDS: BLENDS, MASK_KINDS: MASK_KINDS, FACE_PARTS: FACE_PARTS, LIMITS: LIMITS };

  /* Effects registered before this file arrived. */
  var queue = Array.isArray(global.LE_FX_DEFS) ? global.LE_FX_DEFS : [];
  global.LE_FX_DEFS = { push: function (d) { try { FX.register(d); } catch (e) { if (global.console) console.warn('LE.fx: ' + e.message); } return 0; } };
  queue.forEach(function (d) { global.LE_FX_DEFS.push(d); });
  /* Test pages may have loaded the workspace's mock registry (assets/js/expert/mock-fx.js) before this file. Its effects draw
     nothing; registering them keeps the panels built from them alive once the real registry takes over. Never present in production. */
  if (global.LE_FX_MOCK && typeof global.LE_FX_MOCK.describe === 'function') {
    try { [].concat(global.LE_FX_MOCK.describe()).forEach(function (d) { var c = {}; Object.keys(d || {}).forEach(function (k) { c[k] = d[k]; }); c.passes = function () {}; c.inert = true; global.LE_FX_DEFS.push(c); }); } catch (e) { /* a mock must never break the renderer */ }
  }

  FX.ready = (LE.curves && LE.curves.sample ? Promise.resolve() : script(base + 'curves.js')).then(function () {
    return Promise.all([load('gl')].concat(PACKS.map(load)));
  }).then(function () {
    var mock = global.LE_FX_MOCK;   /* test pages only: the mock's call log keeps working */
    if (mock && typeof mock.interactive === 'function') { var real = FX.interactive; FX.interactive = function (on) { if (on !== undefined) { try { mock.interactive(on); } catch (x) { /* test helper */ } } return real(on); }; }
    /* Effects that read whole-image statistics need the analysis code before the first render. */
    return order.some(function (id) { return defs[id].needs.indexOf('stats') >= 0; }) ? load('analyze') : null;
  }).then(function () { return FX; });

  /* Statistics load on first use. analyze(target, { region, kinds }) → a promise of the numbers.
     The scopes' form, analyze({ source, kinds: ['histogram'] }), answers at once when the code is already in
     (histogram.l is luminance), and with a promise the first time. */
  FX.analyze = function (target, opts) {
    if (isObj(target) && target.source && !target.scene && typeof target.render !== 'function') {
      var o = { region: target.region, kinds: target.kinds, layer: target.layer };
      if (FX._stats && (target.source.getContext || target.source.naturalWidth)) return FX._stats(target.source, o);
      return load('analyze').then(function () { return FX._analyze(target.source, o); });
    }
    return load('analyze').then(function () { return FX._analyze(target, opts || {}); });
  };
})(window);
