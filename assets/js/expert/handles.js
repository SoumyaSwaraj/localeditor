/* LocalEditor Expert: on-canvas handles generated from an effect's descriptor (ui.handles, docs/EXPERT-UI.md "Handles from
 * a registration"). The workspace shows them for the selected effect entry: the one whose controls were last touched in the
 * develop panel, opened in the layers panel or just added. Data only: a descriptor names parameters, nothing else.
 *
 *   ui.handles = descriptor | [descriptor, ...]
 *   { kind: 'point',   param }
 *   { kind: 'ring',    center, radius, unit }                       drag the rim: radius
 *   { kind: 'ellipse', center, rx, ry, angle, unit, cw }            first axis handle: rx and angle; second: ry
 *   { kind: 'band',    center, angle, half, feather, unit, cw }     a band through a point; only `center` = a level line
 *   { kind: 'angle',   param, anchor, cw }                          an arm from a point parameter (or the box centre)
 *   { kind: 'line',    anchor, angle, length, unit, half, cw }      direction and length: drag the tip
 *                      … or elevation, height, squash               a shadow tip: length = height / tan(elevation), y × squash
 *   { kind: 'mesh',    rows, cols, params: [row by row] }           a control net of point parameters
 * unit: what a length parameter is a fraction of: 'box' (rx of the width, ry of the height; ellipse default), 'short'
 * (default for ring and band), 'long', 'w', 'h', or 'px' (document pixels; default for line). Angles are degrees,
 * counter-clockwise on screen unless cw. Points are fractions of the layer box.
 * One drag is one undo step (one gesture key), rendered in draft quality; handles hide while a painting tool is active. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.canvas) return;
  var H = X.handles = {}, D2R = Math.PI / 180;
  var sel = null, shown = null, drag = null, run = { key: null, t: 0 };
  var QUIET = { move: 1, hand: 1, zoom: 1 };   /* tools that leave the canvas to the handles */

  function list(def) { var u = def && def.ui && def.ui.handles; return !u ? [] : Array.isArray(u) ? u : [u]; }
  H.describe = function (type) { return list(X.def(type)); };
  function unitLen(u, l) { return u === 'px' ? 1 : u === 'w' ? l.w : u === 'h' ? l.h : u === 'long' ? Math.max(l.w, l.h) : Math.min(l.w, l.h); }
  function num(def, k, v) { var ps = def.params[k] || {}; if (ps.min != null) v = Math.max(ps.min, v); if (ps.max != null) v = Math.min(ps.max, v); return X.roundTo(v, ps.step || 0.001); }
  function ang(def, k, deg) {
    var ps = def.params[k] || {};
    deg = ((deg % 360) + 360) % 360;
    if (ps.min != null && ps.min < 0 && deg > 180) deg -= 360;
    if (ps.min != null) deg = Math.max(ps.min, deg);
    if (ps.max != null) deg = Math.min(ps.max, deg);
    return Math.round(deg * 10) / 10;
  }
  function r4(v) { return Math.round(v * 10000) / 10000; }

  /* Geometry for one entry, in pixels of the unflipped layer box: { points, segs, lines, ellipses, drags }. */
  function build(l, e, def) {
    var w = l.w, hh = l.h, out = { points: [], segs: [], lines: [], ellipses: [], drags: {} }, seen = {};
    function v(k) { var p = e.p; return p && p[k] !== undefined ? p[k] : X.paramDefault(def.params[k]); }
    function has(k) { return !!(k && def.params[k]); }
    function label(k, alt) { return (has(k) && def.params[k].label) || alt || k; }
    function pt(id, x, y, lb, ring, fn) { if (seen[id]) return; seen[id] = 1; out.points.push({ id: id, x: x, y: y, label: lb, ring: ring }); out.drags[id] = fn; }
    /* A point parameter as a handle (shared when several descriptors name it); returns its position. */
    function anchor(k) {
      if (!has(k)) return [w / 2, hh / 2];
      var f = v(k) || { x: 0.5, y: 0.5 }, c = [f.x * w, f.y * hh];
      pt('p:' + k, c[0], c[1], label(k), false, function (x, y) { var o = {}; o[k] = { x: r4(x / w), y: r4(y / hh) }; return o; });
      return c;
    }
    function dir(deg, cw) { var a = deg * D2R; return [Math.cos(a), (cw ? 1 : -1) * Math.sin(a)]; }
    function toDeg(vx, vy, cw) { return Math.atan2(cw ? vy : -vy, vx) / D2R; }
    list(def).forEach(function (d, i) {
      var c, u, n, U, a, id = i + ':';
      if (d.kind === 'point') { anchor(d.param); return; }
      if (d.kind === 'mesh') {
        var ks = (d.params || []).filter(has), cols = d.cols || 1;
        ks.forEach(function (k) { anchor(k); });
        ks.forEach(function (k, j) {
          if ((j + 1) % cols && ks[j + 1]) out.lines.push(['p:' + k, 'p:' + ks[j + 1], 'line']);
          if (ks[j + cols]) out.lines.push(['p:' + k, 'p:' + ks[j + cols], 'line']);
        });
        return;
      }
      if (d.kind === 'ring') {
        c = anchor(d.center); U = unitLen(d.unit || 'short', l);
        var R = v(d.radius) * U;
        out.ellipses.push({ at: c, rx: R, ry: R, rot: 0 });
        pt(id + 'r', c[0] + R, c[1], label(d.radius, 'Size'), true, function (x, y) { var o = {}; o[d.radius] = num(def, d.radius, Math.hypot(x - c[0], y - c[1]) / U); return o; });
        return;
      }
      if (d.kind === 'ellipse') {
        c = anchor(d.center); a = has(d.angle) ? v(d.angle) : 0; u = dir(a, d.cw); n = [-u[1], u[0]];
        var box = !d.unit || d.unit === 'box', Ux = box ? w : unitLen(d.unit, l), Uy = box ? hh : unitLen(d.unit, l), rx = v(d.rx) * Ux, ry = v(d.ry) * Uy;
        out.ellipses.push({ at: c, rx: rx, ry: ry, rot: d.cw ? a : -a });
        pt(id + 'rx', c[0] + u[0] * rx, c[1] + u[1] * rx, label(d.rx, 'Width'), true, function (x, y) {
          var o = {}; o[d.rx] = num(def, d.rx, Math.hypot(x - c[0], y - c[1]) / Ux);
          if (has(d.angle)) o[d.angle] = ang(def, d.angle, toDeg(x - c[0], y - c[1], d.cw));
          return o;
        });
        pt(id + 'ry', c[0] + n[0] * ry, c[1] + n[1] * ry, label(d.ry, 'Height'), true, function (x, y) { var o = {}; o[d.ry] = num(def, d.ry, Math.abs((x - c[0]) * n[0] + (y - c[1]) * n[1]) / Uy); return o; });
        return;
      }
      if (d.kind === 'band') {
        c = anchor(d.center); a = has(d.angle) ? v(d.angle) : 0; u = dir(a, d.cw); n = [-u[1], u[0]]; U = unitLen(d.unit || 'short', l);
        var E = 0.75 * Math.hypot(w, hh), hf = has(d.half) ? v(d.half) * U : 0, ft = has(d.feather) ? v(d.feather) * U : 0;
        var across = function (off, cls) { out.segs.push([c[0] + n[0] * off - u[0] * E, c[1] + n[1] * off - u[1] * E, c[0] + n[0] * off + u[0] * E, c[1] + n[1] * off + u[1] * E, cls]); };
        if (has(d.half)) { across(hf, 'line'); across(-hf, 'line'); } else across(0, 'line');
        if (has(d.feather)) { across(hf + ft, 'guide'); across(-hf - ft, 'guide'); }
        if (has(d.angle)) {
          var A = 0.3 * Math.min(w, hh);
          pt(id + 'a', c[0] + u[0] * A, c[1] + u[1] * A, label(d.angle, 'Angle'), true, function (x, y) { var o = {}; o[d.angle] = ang(def, d.angle, toDeg(x - c[0], y - c[1], d.cw)); return o; });
        }
        var dist = function (x, y) { return Math.abs((x - c[0]) * n[0] + (y - c[1]) * n[1]); };
        if (has(d.half)) pt(id + 'h', c[0] + n[0] * hf, c[1] + n[1] * hf, label(d.half, 'Width'), true, function (x, y) { var o = {}; o[d.half] = num(def, d.half, dist(x, y) / U); return o; });
        if (has(d.feather)) pt(id + 'f', c[0] - n[0] * (hf + ft), c[1] - n[1] * (hf + ft), label(d.feather, 'Feather'), true, function (x, y) { var o = {}; o[d.feather] = num(def, d.feather, Math.max(0, dist(x, y) - hf) / U); return o; });
        return;
      }
      if (d.kind === 'angle') {
        c = anchor(d.anchor); u = dir(v(d.param), d.cw);
        var arm = 0.22 * Math.min(w, hh), tip = [c[0] + u[0] * arm, c[1] + u[1] * arm];
        out.segs.push([c[0], c[1], tip[0], tip[1], 'line']);
        pt(id + 'a', tip[0], tip[1], label(d.param, 'Angle'), true, function (x, y) { var o = {}; o[d.param] = ang(def, d.param, toDeg(x - c[0], y - c[1], d.cw)); return o; });
        return;
      }
      if (d.kind === 'line') {
        c = anchor(d.anchor); u = dir(has(d.angle) ? v(d.angle) : 0, d.cw); U = unitLen(d.unit || 'px', l);
        var sq = has(d.squash) ? Math.max(0.01, v(d.squash)) : 1, k = d.half ? 0.5 : 1;
        var L = has(d.elevation) ? v(d.height) / Math.tan(Math.max(1, v(d.elevation)) * D2R) : v(d.length) * U * k;
        var end = [c[0] + u[0] * L, c[1] + u[1] * L * sq];
        out.segs.push([c[0], c[1], end[0], end[1], 'line']);
        pt(id + 't', end[0], end[1], label(has(d.elevation) ? d.elevation : d.length, 'Length'), true, function (x, y) {
          var o = {}, vx = x - c[0], vy = (y - c[1]) / sq, len = has(d.angle) ? Math.hypot(vx, vy) : Math.abs(vx * u[0] + vy * u[1]);
          if (has(d.angle)) o[d.angle] = ang(def, d.angle, toDeg(vx, vy, d.cw));
          if (has(d.elevation)) o[d.elevation] = num(def, d.elevation, Math.atan2(v(d.height), Math.max(len, 1e-6)) / D2R);
          else if (has(d.length)) o[d.length] = num(def, d.length, len / U / k);
          return o;
        });
      }
    });
    return out;
  }
  H.build = build;

  /* Pixels of the unflipped box → what the canvas kit draws (fractions of the box as shown, flips applied). */
  function toSpec(g, l) {
    var w = l.w, hh = l.h, fx = l.flipX, fy = l.flipY;
    function X1(x) { return (fx ? w - x : x) / w; }
    function Y1(y) { return (fy ? hh - y : y) / hh; }
    return {
      points: g.points.map(function (p) { return { id: p.id, x: X1(p.x), y: Y1(p.y), label: p.label, ring: p.ring }; }),
      lines: g.lines,
      segs: g.segs.map(function (s) { return [X1(s[0]), Y1(s[1]), X1(s[2]), Y1(s[3]), s[4]]; }),
      ellipses: g.ellipses.map(function (e) { return { x: X1(e.at[0]), y: Y1(e.at[1]), rx: e.rx / w, ry: e.ry / hh, rot: (fx ? -1 : 1) * (fy ? -1 : 1) * e.rot }; })
    };
  }
  function current() {
    if (!sel || !X.workspace || !X.workspace.active()) return null;
    var t = X.tools && X.tools.active();
    if (t && !QUIET[t]) return null;
    var l = X.doc.layer(sel.layerId), e = l && (sel.fxId ? X.doc.entry(sel.layerId, sel.fxId) : X.doc.firstOfType(sel.layerId, sel.type));
    if (!l || !e || e.on === false || !(l.w > 0 && l.h > 0)) return null;
    var def = X.def(e.type);
    return list(def).length ? { l: l, e: e, def: def } : null;
  }
  function hide() { if (shown) { var s = shown; shown = null; s.hd.destroy(); } drag = null; }
  var write = X.rafThrottle(function () {
    if (!drag || !drag.patch) return;
    var p = drag.patch; drag.patch = null;
    X.doc.setParams(drag.layerId, drag.fxId, p, drag.key);
  });
  function onDrag(id, x, y, phase) {
    var c = current(); if (!c || !shown) return;
    if (phase === 'start') {
      /* The handle keeps its distance from the pointer (a press on its edge does not make it jump), and a press alone writes nothing. */
      var p0 = shown.spec.points.filter(function (q) { return q.id === id; })[0];
      drag = { layerId: c.l.id, fxId: c.e.id, key: X.gesture(), patch: null, ox: p0 ? p0.x - x : 0, oy: p0 ? p0.y - y : 0, moved: false };
      return;
    }
    if (phase === 'key') { var now = Date.now(); if (!run.key || now - run.t > 700) run.key = X.gesture(); run.t = now; drag = { layerId: c.l.id, fxId: c.e.id, key: run.key, patch: null, ox: 0, oy: 0, moved: true }; }
    if (!drag) return;
    if (phase === 'move') drag.moved = true;
    var fn = shown.geom.drags[id];
    x += drag.ox; y += drag.oy;
    if (fn && drag.moved) drag.patch = fn(c.l.flipX ? (1 - x) * c.l.w : x * c.l.w, c.l.flipY ? (1 - y) * c.l.h : y * c.l.h);
    write();
    if (phase === 'move') return;
    write.flush();
    drag = null;
  }
  /* Called on every document, selection, tool and view change (cheap: a few numbers per handle). */
  H.sync = function () {
    var c = current();
    if (!c || (sel && sel.yielded)) { hide(); return; }
    var geom = build(c.l, c.e, c.def), s = toSpec(geom, c.l);
    if (shown && shown.fxId === c.e.id && X.canvas.current() === shown.spec) { shown.geom = geom; shown.hd.update(s); return; }
    hide();
    var spec = Object.assign({ layerId: c.l.id, onDrag: onDrag, onClose: function () { if (shown && shown.spec === spec) { shown = null; if (sel) sel.yielded = true; } } }, s);
    shown = { spec: spec, fxId: c.e.id, geom: geom, hd: null };
    shown.hd = X.canvas.handles(spec);
  };
  /* { layerId, type, fxId } or null. Selecting again takes the canvas back from another control. */
  H.select = function (s) {
    sel = s && s.layerId && (s.type || s.fxId) ? { layerId: s.layerId, type: s.type, fxId: s.fxId || null } : null;
    H.sync();
  };
  H.selected = function () { return sel ? { layerId: sel.layerId, type: sel.type, fxId: sel.fxId } : null; };
  H.shown = function () { return shown ? shown.spec : null; };
  X.on('fx-select', H.select);
  X.on('tool', function () { H.sync(); });
  X.on('target-layer', function (id) { if (sel && sel.layerId !== id) H.select(null); });
  X.on('leave', function () { sel = null; hide(); });
})(window);
