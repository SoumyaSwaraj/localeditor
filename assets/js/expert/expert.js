/* LocalEditor Expert mode: core. Namespace, helpers, the effect-registry adapter and every document write the workspace makes.
 * Loaded on the first switch to Expert (docs/EXPERT-UI.md). The control kit (controls/*) also works on its own with this file. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.expert && LE.expert.version) return;
  var me = (document.currentScript && document.currentScript.src) || '';
  var BASE = me ? new URL('./', me).href : '';

  /* ---------- Helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function uid(p) { return (p || 'x') + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function mq(q) { return global.matchMedia ? global.matchMedia(q).matches : false; }
  function reduced() { return mq('(prefers-reduced-motion: reduce)'); }
  function coarse() { return mq('(pointer: coarse)'); }
  function say(mouse, touch) { return coarse() ? touch : mouse; }
  /* Round to the step's precision so 0.1 + 0.2 never shows as 0.30000000000000004. */
  function roundTo(v, step) {
    if (!step) return v;
    var d = String(step).indexOf('.') >= 0 ? String(step).split('.')[1].length : 0;
    var n = Math.round(v / step) * step;
    return Number(n.toFixed(Math.min(6, d)));
  }
  /* One call per animation frame, with the newest arguments. */
  function rafThrottle(fn) {
    var raf = 0, args = null;
    function run() { raf = 0; var a = args; args = null; fn.apply(null, a); }
    function t() { args = arguments; if (!raf) raf = requestAnimationFrame(run); }
    t.flush = function () { if (raf) { cancelAnimationFrame(raf); run(); } };
    t.cancel = function () { if (raf) cancelAnimationFrame(raf); raf = 0; args = null; };
    return t;
  }
  function idle(fn, timeout) {
    if (global.requestIdleCallback) return global.requestIdleCallback(fn, { timeout: timeout || 300 });
    return setTimeout(function () { fn({ timeRemaining: function () { return 8; }, didTimeout: true }); }, 1);
  }
  function cancelIdle(id) { if (global.cancelIdleCallback) global.cancelIdleCallback(id); else clearTimeout(id); }

  /* Expert icons: 24x24 strokes drawn for LocalEditor (no product artwork). Shell icons (LEStudio.I) are used as a fallback. */
  var I = {
    move: '<path d="M5 3.5l12.5 7.2-5.4 1.4 3.5 6.1-2.4 1.4-3.5-6.1-4 3.9z"/>',
    crop: '<path d="M6.5 2.5v13a2 2 0 0 0 2 2h13"/><path d="M17.5 21.5v-13a2 2 0 0 0-2-2h-13"/>',
    brush: '<path d="M20.5 3.5l-9 9"/><path d="M11.5 12.5c-2.5-.5-5 1-5.5 3.5-.3 1.6-1.2 2.8-2.5 3.5 4 .8 8.3-.4 8.9-3.4.3-1.4 0-2.8-.9-3.6z"/>',
    heal: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M10.5 10.5h.01M13.5 13.5h.01M13.5 10.5h.01M10.5 13.5h.01"/>',
    clone: '<path d="M9 13V9.5a3 3 0 1 1 6 0V13M5 13h14v4H5zM6.5 20.5h11"/>',
    dodge: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l7.5 7.5"/>',
    liquify: '<path d="M3.5 8c3-3 5 3 8.5 0s5.5 3 8.5 0M3.5 13c3-3 5 3 8.5 0s5.5 3 8.5 0M3.5 18c3-3 5 3 8.5 0s5.5 3 8.5 0"/>',
    gradient: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 8.5h17M3.5 12h17M3.5 15.5h17" stroke-dasharray="1.5 2.5"/>',
    pipette: '<path d="M14.5 4.5l5 5M16.8 2.2a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L19 10l-5-5zM14 7.5l-9 9V20h3.5l9-9"/>',
    hand: '<path d="M7.5 11.5V6a1.5 1.5 0 0 1 3 0v5M10.5 10V4.5a1.5 1.5 0 0 1 3 0V10M13.5 10V5.5a1.5 1.5 0 0 1 3 0V12M16.5 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.5-1.7l1.1 1.4"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6M8 10.5h5M10.5 8v5"/>',
    compare: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 2.5v19"/><path d="M15 9l2.5 3-2.5 3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.5 6.8C4 8.5 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    chev: '<path d="M7 10l5 5 5-5"/>',
    right: '<path d="M9.5 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    grip: '<circle cx="9" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/>',
    fx: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    adjust: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    mask: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="4.5" fill="currentColor" fill-opacity=".25"/>',
    linear: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 6.5v11" stroke-dasharray="2 2"/>',
    radial: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><ellipse cx="12" cy="12" rx="5.5" ry="4"/><ellipse cx="12" cy="12" rx="2.5" ry="1.6"/>',
    luma: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    color: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 2-2 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7H17a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7.5" r="1.1"/><circle cx="14.5" cy="7.5" r="1.1"/>',
    subject: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20.5c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
    depth: '<path d="M3 18l6-9 4 5 3-3 5 7z"/>',
    face: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    invert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    paste: '<rect x="6" y="4.5" width="12" height="16.5" rx="2.5"/><path d="M9 4.5V3h6v1.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l.9 12.1A2 2 0 0 0 8.4 21h7.2a2 2 0 0 0 2-1.9L18.5 7M9 7V4.5h6V7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
    scopes: '<path d="M4 20V4M4 20h16"/><path d="M6 18c2-9 4-11 6-6s4 4 7-6"/>',
    develop: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/>',
    sideBySide: '<rect x="2.5" y="5" width="8.5" height="14" rx="2"/><rect x="13" y="5" width="8.5" height="14" rx="2"/>',
    point: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    angle: '<path d="M4 19h16M4 19L16 6"/><path d="M10 19a6 6 0 0 0-1.8-4.2"/>',
    lut: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>',
    clip: '<path d="M8 4v10a4 4 0 0 0 8 0V7"/><path d="M12 7v7"/>',
    erase: '<path d="M7 20.5h11M4.8 14.6l9.5-10.1a1.8 1.8 0 0 1 2.6 0l3 3a1.8 1.8 0 0 1 0 2.6L11.2 20.5H8.2z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8h.01"/>',
    fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'
  };
  function ic(name, cls) {
    var body = I[name] || (global.LEStudio && global.LEStudio.I && global.LEStudio.I[name]) || I.info;
    return '<svg class="xp-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /* ---------- Event bus ---------- */
  var EV = {};
  function on(name, fn) { (EV[name] = EV[name] || []).push(fn); return function () { var a = EV[name] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  function emit(name, a, b) { (EV[name] || []).slice().forEach(function (f) { try { f(a, b); } catch (e) { console.error(e); } }); }

  /* ---------- Gestures: one undo step per gesture ---------- */
  var gN = 0;
  function gesture() {
    var c = global.LEStudio;
    return c && c.gesture ? c.gesture() : 'xg' + (++gN);
  }

  /* ---------- Effect registry adapter ----------
     The real registry is LE.fx (docs/EXPERT-MODE.md). Until it lands, or in tests and the gallery, the mock in mock-fx.js
     (window.LE_FX_MOCK) stands in. Detected at every call, so a registry that loads later is picked up. */
  var SECTIONS = ['Light', 'Colour', 'Curves', 'Colour mixer', 'Colour grading', 'Detail', 'Optics', 'Geometry', 'Effects', 'Shadows & reflections', 'Compositing', 'Retouch'];
  var SECTION_ALIAS = {
    light: 'Light', tone: 'Light', basic: 'Light', exposure: 'Light',
    color: 'Colour', colour: 'Colour', 'white balance': 'Colour', presence: 'Colour',
    curves: 'Curves', curve: 'Curves', 'tone curve': 'Curves',
    'color mixer': 'Colour mixer', 'colour mixer': 'Colour mixer', hsl: 'Colour mixer', mixer: 'Colour mixer', 'channel mixer': 'Colour mixer',
    'color grading': 'Colour grading', 'colour grading': 'Colour grading', grading: 'Colour grading', 'split toning': 'Colour grading', lut: 'Colour grading',
    detail: 'Detail', sharpen: 'Detail', noise: 'Detail',
    optics: 'Optics', lens: 'Optics', blur: 'Optics',
    geometry: 'Geometry', transform: 'Geometry', perspective: 'Geometry',
    effects: 'Effects', creative: 'Effects', effect: 'Effects',
    shadows: 'Shadows & reflections', 'shadows & reflections': 'Shadows & reflections', reflections: 'Shadows & reflections',
    compositing: 'Compositing', composite: 'Compositing', retouch: 'Retouch', retouching: 'Retouch'
  };
  function sectionOf(def) {
    var s = (def && ((def.ui && def.ui.section) || def.group)) || 'Effects';
    var k = String(s).toLowerCase();
    return SECTION_ALIAS[k] || (String(s).charAt(0).toUpperCase() + String(s).slice(1));
  }
  function sectionRank(name) {
    var i = SECTIONS.indexOf(name);
    return i < 0 ? SECTIONS.indexOf('Effects') + 0.5 : i;
  }
  function registry() {
    if (LE.fx && typeof LE.fx.describe === 'function') return LE.fx;
    if (global.LE_FX_MOCK && typeof global.LE_FX_MOCK.describe === 'function') return global.LE_FX_MOCK;
    return null;
  }
  function isReal() { return !!(LE.fx && typeof LE.fx.describe === 'function'); }
  var defCache = { src: null, n: -1, list: [], byId: {}, bySec: {}, t: 0 };
  /* The registry is read at most twice a second (a late registration still shows up); panels call defs() often. */
  function defs() {
    var R = registry();
    if (!R) return [];
    var now = Date.now();
    if (defCache.src === R && now - defCache.t < 500) return defCache.list;
    defCache.t = now;
    var raw;
    try { raw = R.describe(); } catch (e) { console.error(e); raw = []; }
    if (raw && !Array.isArray(raw)) raw = Object.keys(raw).map(function (k) { var d = raw[k]; if (d && !d.id) d.id = k; return d; });
    raw = (raw || []).filter(function (d) { return d && d.id; });
    if (defCache.src === R && defCache.n === raw.length) return defCache.list;
    var byId = {};
    var list = raw.map(function (d, i) {
      var o = Object.assign({}, d);
      o.params = o.params || {};
      o.section = sectionOf(d);
      o.rank = sectionRank(o.section);
      o.order = i;
      byId[o.id] = o;
      return o;
    }).sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    var bySec = {};
    list.forEach(function (d) { (bySec[d.section] = bySec[d.section] || []).push(d.id); });
    defCache = { src: R, n: raw.length, list: list, byId: byId, bySec: bySec, t: now };
    return list;
  }
  function def(id) { defs(); return defCache.byId[id] || null; }
  function sectionTypes(sec) { defs(); return defCache.bySec[sec] || []; }
  function sections() {
    var seen = {}, out = [];
    defs().forEach(function (d) { if (!seen[d.section]) { seen[d.section] = 1; out.push(d.section); } });
    return out.sort(function (a, b) { return sectionRank(a) - sectionRank(b) || (a < b ? -1 : 1); });
  }
  function interactive(onOff) {
    var R = registry();
    if (R && typeof R.interactive === 'function') { try { R.interactive(!!onOff); } catch (e) {} }
    emit('interactive', !!onOff);
  }
  /* Defaults for one parameter schema. */
  function paramDefault(ps) {
    if (!ps) return null;
    if (ps.default !== undefined) return clone(ps.default);
    switch (ps.type) {
      case 'number': return ps.min != null && ps.max != null && ps.min < 0 && ps.max > 0 ? 0 : (ps.min || 0);
      case 'bool': return false;
      case 'choice': var o = (ps.options || ps.choices || [])[0]; return o && typeof o === 'object' ? o.value : o;
      case 'color': return '#808080';
      case 'point': return { x: 0.5, y: 0.5 };
      case 'angle': return 0;
      case 'curve': return { master: [[0, 0], [1, 1]] };
      case 'wheel': return { h: 0, a: 0, l: 0 };
      case 'bands': return [0, 1, 2, 3, 4, 5, 6, 7].map(function () { return { h: 0, s: 0, l: 0 }; });
      case 'lut': return null;
      case 'seed': return 1;
    }
    return null;
  }
  function defaults(d) {
    var p = {};
    Object.keys((d && d.params) || {}).forEach(function (k) { p[k] = paramDefault(d.params[k]); });
    return p;
  }
  /* Clamp a value to its schema (numbers to min/max and step, choices to their options, points to 0-1). */
  function coerce(ps, v) {
    if (!ps) return v;
    switch (ps.type) {
      case 'number':
        v = Number(v);
        if (!isFinite(v)) v = paramDefault(ps);
        if (ps.min != null) v = Math.max(ps.min, v);
        if (ps.max != null) v = Math.min(ps.max, v);
        /* Kept to a hundredth of the step: the step is the UI's granularity, fine adjustment may go below it. */
        return ps.step ? roundTo(v, ps.step / 100) : Math.round(v * 1e6) / 1e6;
      case 'angle':
        v = Number(v) || 0;
        if (ps.min != null || ps.max != null) return clamp(v, ps.min == null ? -360 : ps.min, ps.max == null ? 360 : ps.max);
        return ((v % 360) + 360) % 360;
      case 'bool': return !!v;
      case 'seed': return Math.max(0, Math.round(Number(v) || 0)) % 2147483647;
      case 'point': return v ? { x: clamp(Number(v.x) || 0, ps.min != null ? ps.min : 0, ps.max != null ? ps.max : 1), y: clamp(Number(v.y) || 0, ps.min != null ? ps.min : 0, ps.max != null ? ps.max : 1) } : paramDefault(ps);
      case 'wheel': return v ? { h: (((Number(v.h) || 0) % 360) + 360) % 360, a: clamp(Number(v.a) || 0, 0, 1), l: clamp(Number(v.l) || 0, -1, 1) } : paramDefault(ps);
      case 'choice':
        var opts = (ps.options || ps.choices || []).map(function (o) { return o && typeof o === 'object' ? o.value : o; });
        return opts.indexOf(v) >= 0 ? v : paramDefault(ps);
    }
    return v;
  }

  /* ---------- Document writes ----------
     Every change the workspace makes goes through here, so the contract with LE.Scene lives in one place.
     `key` is a gesture key: all writes with the same key collapse into one undo step. */
  var MASK = 'layerMask';   /* the composable layer mask; layer.mask stays the frame-shape name on image layers */
  function ctx() { return global.LEStudio || null; }
  function scene() { var c = ctx(); return c && c.scene; }
  /* Layer copies are memoised per document state (LE.Scene's last snapshot), so a panel refresh clones each layer once.
     Callers never mutate what they get; every write goes through scene.update with a fresh copy. */
  var memo = { k: null, m: {} };
  function L(id) {
    var s = scene();
    if (!s || !id) return null;
    var k = s._lastSnap;
    if (k == null) return s.layer(id);
    if (memo.k !== k) memo = { k: k, m: {} };
    return memo.m[id] || (memo.m[id] = s.layer(id));
  }
  function raw(id) { var s = scene(); return s && s._find ? s._find(id) : null; }
  function upd(id, patch, key) { var s = scene(); if (s) s.update(id, patch, key ? { coalesce: key } : null); }
  function isMaskObj(m) { return !!(m && typeof m === 'object' && Array.isArray(m.parts)); }
  function maskOf(l) { var m = l && l[MASK]; return isMaskObj(m) ? m : null; }
  function hasExpert(l) { return !!(l && (l.type === 'adjust' || (l.fx && l.fx.length) || maskOf(l) || l.retouch || l.transform)); }
  function newEntry(type, p) {
    var d = def(type);
    return { id: uid('fx'), type: type, on: true, amount: 1, blend: 'normal', mask: null, p: Object.assign(defaults(d), clone(p || {})) };
  }
  function fxOf(id) { var l = L(id); return (l && Array.isArray(l.fx)) ? l.fx : []; }
  function writeFx(id, list, key) { upd(id, { fx: list }, key); emit('fx', id); }
  function findIdx(list, fxId) { for (var i = 0; i < list.length; i++) if (list[i].id === fxId) return i; return -1; }
  var doc = {
    MASK: MASK,
    layer: L, fx: fxOf, mask: maskOf, hasExpert: hasExpert, newEntry: newEntry,
    /* Add an entry. opts.index: position; by default an entry lands after the last entry of an earlier or equal section, so
       colour work runs before creative effects (the develop panel's order). */
    addFx: function (id, type, opts, key) {
      opts = opts || {};
      var list = fxOf(id).slice();
      var e = newEntry(type, opts.p);
      var at = opts.index;
      if (at == null) {
        if (opts.append) at = list.length;
        else {
          var r = sectionRank(sectionOf(def(type)));
          at = 0;
          for (var i = 0; i < list.length; i++) if (sectionRank(sectionOf(def(list[i].type))) <= r) at = i + 1;
        }
      }
      list.splice(clamp(at, 0, list.length), 0, e);
      writeFx(id, list, key);
      return e.id;
    },
    entry: function (id, fxId) { var l = fxOf(id); var i = findIdx(l, fxId); return i < 0 ? null : l[i]; },
    firstOfType: function (id, type) { var l = fxOf(id); for (var i = 0; i < l.length; i++) if (l[i].type === type) return l[i]; return null; },
    setEntry: function (id, fxId, patch, key) {
      var list = clone(fxOf(id)); var i = findIdx(list, fxId); if (i < 0) return;
      Object.keys(patch).forEach(function (k) { list[i][k] = patch[k]; });
      if (list[i].amount != null) list[i].amount = clamp(Number(list[i].amount), 0, 1);
      writeFx(id, list, key);
    },
    setParam: function (id, fxId, name, value, key) {
      var list = clone(fxOf(id)); var i = findIdx(list, fxId); if (i < 0) return;
      var d = def(list[i].type);
      list[i].p = list[i].p || {};
      list[i].p[name] = coerce(d && d.params[name], value);
      writeFx(id, list, key);
    },
    setParams: function (id, fxId, p, key) {
      var list = clone(fxOf(id)); var i = findIdx(list, fxId); if (i < 0) return;
      var d = def(list[i].type);
      list[i].p = list[i].p || {};
      Object.keys(p).forEach(function (k) { list[i].p[k] = coerce(d && d.params[k], p[k]); });
      writeFx(id, list, key);
    },
    resetEntry: function (id, fxId, key) {
      var list = clone(fxOf(id)); var i = findIdx(list, fxId); if (i < 0) return;
      list[i].p = defaults(def(list[i].type)); list[i].amount = 1;
      writeFx(id, list, key);
    },
    removeFx: function (id, fxId, key) { writeFx(id, fxOf(id).filter(function (e) { return e.id !== fxId; }), key); },
    moveFx: function (id, fxId, to, key) {
      var list = fxOf(id).slice(); var i = findIdx(list, fxId); if (i < 0) return;
      var e = list.splice(i, 1)[0];
      list.splice(clamp(to, 0, list.length), 0, e);
      writeFx(id, list, key);
    },
    setFx: writeFx,
    /* Masks: on a layer (fxId null) or on one fx entry. null removes it. */
    setMask: function (id, fxId, mask, key) {
      if (fxId) { doc.setEntry(id, fxId, { mask: mask ? clone(mask) : null }, key); return; }
      var p = {}; p[MASK] = mask ? clone(mask) : (L(id) && L(id).type === 'image' ? 'none' : null);
      upd(id, p, key);
      emit('mask', id);
    },
    getMask: function (id, fxId) {
      if (fxId) { var e = doc.entry(id, fxId); return e && isMaskObj(e.mask) ? e.mask : null; }
      return maskOf(L(id));
    },
    patchLayer: function (id, patch, key) { upd(id, patch, key); },
    /* Adjustment layer: its stack applies to everything beneath it (or the layer below when clip is true). */
    addAdjust: function (type, opts, key) {
      var c = ctx(), s = scene();
      if (!s) return null;
      opts = opts || {};
      var d = s.toJSON();
      var id = uid('adj');
      var dd = def(type);
      var layer = { id: id, type: 'adjust', name: opts.name || ((dd && dd.name) || 'Adjustment'), x: 0, y: 0, w: d.width, h: d.height, rotation: 0, opacity: 1, blend: 'normal', visible: true, locked: false, groupId: null, clip: false, fx: type ? [newEntry(type, opts.p)] : [] };
      layer[MASK] = null;
      var arr = s._doc.layers;
      var at = arr.length;
      if (opts.above) { var i = s._index(opts.above); if (i >= 0) at = i + 1; }
      /* LE.Scene.add() normalises unknown types to shapes until X0a extends the model, so insert the plain record. */
      s._before(key || null);
      arr.splice(at, 0, layer);
      s._after();
      if (c && c.onHistory) c.onHistory({ canUndo: s.canUndo(), canRedo: s.canRedo() });
      s.select([id]);
      emit('fx', id);
      return id;
    },
    reorderLayer: function (id, toIndex) { var s = scene(); if (s) s.order(id, toIndex); },
    raw: raw
  };

  /* Mask clipboard, shared by the layers panel and the mask manager (also across reloads on this device). */
  var clip = {
    copy: function (mask) { if (!mask) return; lsSet('le-expert-mask-clip', mask); emit('clip'); },
    paste: function () { return lsGet('le-expert-mask-clip', null); },
    has: function () { return !!lsGet('le-expert-mask-clip', null); }
  };

  /* ---------- Module loading ---------- */
  /* Two waves: the kit's base first (the other files register into it), then everything else in parallel. */
  var FIRST = ['../fx/curves.js', 'controls/base.js'];   /* the spline lives with the renderer (assets/js/fx/curves.js): one definition for both */
  var FILES = ['controls/slider.js', 'controls/curve.js', 'controls/color.js', 'controls/bands.js',
    'controls/pickers.js', 'controls/mask.js', 'brush.js', 'scopes.js', 'panel.js', 'layers.js', 'tools.js', 'workspace.js'];
  var loading = null;
  function lazy(src) {
    if (LE.lazy) return LE.lazy(src);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
  }
  function css() {
    if (document.querySelector('link[data-le-expert]')) return Promise.resolve();
    return new Promise(function (res) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = new URL('../../css/expert.css', BASE).href;
      l.setAttribute('data-le-expert', '');
      l.onload = l.onerror = function () { res(); };
      document.head.appendChild(l);
    });
  }
  /* Within a wave scripts run in any order: each one only fills LE.expert; nothing runs until enter(). */
  function load() {
    if (loading) return loading;
    loading = Promise.all([css(), Promise.all(FIRST.map(function (f) { return lazy(BASE + f); })).then(function () {
      return Promise.all(FILES.map(function (f) { return lazy(BASE + f); }));
    })]);
    loading.catch(function () { loading = null; });
    return loading;
  }

  var X = LE.expert = {
    version: 1, base: BASE,
    h: h, esc: esc, clamp: clamp, clone: clone, uid: uid, lsGet: lsGet, lsSet: lsSet, roundTo: roundTo, rafThrottle: rafThrottle, idle: idle, cancelIdle: cancelIdle,
    mq: mq, reduced: reduced, coarse: coarse, say: say, ic: ic, I: I, on: on, emit: emit, gesture: gesture,
    SECTIONS: SECTIONS, sectionOf: sectionOf, sectionRank: sectionRank,
    registry: registry, isReal: isReal, defs: defs, def: def, sections: sections, sectionTypes: sectionTypes, interactive: interactive,
    paramDefault: paramDefault, defaults: defaults, coerce: coerce,
    doc: doc, clip: clip, load: load,
    controls: X && X.controls || {},
    /* Enter and leave the workspace (assets/js/expert/workspace.js fills these in). */
    enter: function (c) { return load().then(function () { return X.workspace.enter(c || global.LEStudio); }); },
    leave: function () { if (X.workspace && X.workspace.active()) X.workspace.leave(); },
    active: function () { return !!(X.workspace && X.workspace.active && X.workspace.active()); }
  };
})(window);
