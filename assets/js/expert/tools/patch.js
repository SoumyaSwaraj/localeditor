/* LocalEditor Expert: Patch (P) and Red-eye (R), the on-canvas tools for two records of the retouching pack
 * (assets/js/fx/le-fx-retouch.js) that were data-only before.
 * Patch: draw around the area (a freehand lasso, or click corner by corner and close on the first one), then drag the
 *   outline onto a clean area and release. The drag writes one polygon record into a "spot-heal" entry under one gesture
 *   key (draft rendering while dragging, one undo step). A full entry is followed by a new one.
 * Red-eye: tap the pupil, or drag a small box over the eye. Each eye fills a free eye of a "red-eye" entry with the same
 *   pupil size, or adds an entry. Pupil size and darken are in the options bar and follow the last eye placed.
 * Nothing is painted into the photo: the renderer replays the records. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.tools) return;
  var T = X.tools, h = X.h;
  var NS = 'http://www.w3.org/2000/svg';

  /* Fractions of the layer box → pixels inside the tool layer (rotation and flips applied). */
  function place(a, id, f) {
    var b = X.canvas._box && X.canvas._box(id), l = X.doc.layer(id);
    if (!b || !l) return null;
    var hr = a.layer.getBoundingClientRect(), rad = (b.rotation || 0) * Math.PI / 180;
    var dx = ((l.flipX ? 1 - f[0] : f[0]) - 0.5) * b.w, dy = ((l.flipY ? 1 - f[1] : f[1]) - 0.5) * b.h;
    return [b.x + b.w / 2 + dx * Math.cos(rad) - dy * Math.sin(rad) - hr.left, b.y + b.h / 2 + dx * Math.sin(rad) + dy * Math.cos(rad) - hr.top];
  }
  function fracAt(a, id, e) { var d = a.toDoc(e.clientX, e.clientY), f = X.rtFrac(X.doc.layer(id), d.x, d.y); return [f.x, f.y]; }
  function overlay(a) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'xp-tool-svg'); s.setAttribute('aria-hidden', 'true');
    a.layer.appendChild(s);
    return s;
  }
  function entriesOf(id, type) { return X.doc.fx(id).filter(function (e) { return e.type === type; }); }
  /* One undo step for a run of option changes (a scrub or held arrow keys). */
  function runKey(o) { var now = Date.now(); if (!o.key || now - o.t > 700) o.key = X.gesture(); o.t = now; return o.key; }
  function doneBtn() {
    var b = h('<button type="button" class="sx-tb is-primary">' + X.ic('check', '') + '<span>Done</span></button>');
    b.addEventListener('click', function () { T.activate('move'); });
    return b;
  }

  /* ---------- Patch ---------- */
  var PO = X.lsGet('le-expert-patch', { mode: 'heal', feather: 6, opacity: 1 });
  var pt = null;
  /* Ramer–Douglas–Peucker on a closed outline, loosened until it fits the record's budget. */
  function simplify(pts, max) {
    function rdp(p, eps) {
      if (p.length < 3) return p.slice();
      var keep = [0, p.length - 1], stack = [[0, p.length - 1]];
      while (stack.length) {
        var s = stack.pop(), a = p[s[0]], b = p[s[1]], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9, best = 0, at = -1;
        for (var i = s[0] + 1; i < s[1]; i++) { var d = Math.abs((p[i][0] - a[0]) * dy - (p[i][1] - a[1]) * dx) / len; if (d > best) { best = d; at = i; } }
        if (at > 0 && best > eps) { keep.push(at); stack.push([s[0], at], [at, s[1]]); }
      }
      return keep.sort(function (x, y) { return x - y; }).map(function (i) { return p[i]; });
    }
    var eps = 0.0008, out = rdp(pts, eps);
    while (out.length > max && eps < 0.05) { eps *= 1.6; out = rdp(pts, eps); }
    return out.slice(0, max);
  }
  function inside(pts, f) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a[1] > f[1]) !== (b[1] > f[1]) && f[0] < (b[0] - a[0]) * (f[1] - a[1]) / ((b[1] - a[1]) || 1e-9) + a[0]) c = !c;
    }
    return c;
  }
  function patchDraw() {
    if (!pt) return;
    var out = '', P = pt.pts.map(function (f) { return place(pt.a, pt.id, f); }).filter(Boolean);
    if (P.length) {
      var d = P.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ');
      out += pt.closed ? '<polygon class="xp-h-line" points="' + d + '"/>' : '<polyline class="xp-h-line" points="' + d + '"/>';
      if (!pt.closed) out += '<circle class="xp-h-dot" cx="' + P[0][0] + '" cy="' + P[0][1] + '" r="5"/>';
      if (pt.closed && pt.off) {
        var S = pt.pts.map(function (f) { return place(pt.a, pt.id, [f[0] + pt.off.dx, f[1] + pt.off.dy]); }).filter(Boolean);
        out += '<polygon class="xp-h-guide" points="' + S.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '"/>';
      }
    }
    pt.svg.innerHTML = out;
    pt.a.layer.style.cursor = pt.closed ? 'move' : 'crosshair';
    if (pt.note) pt.note.textContent = pt.closed ? X.say('Drag the outline onto a clean area.', 'Drag it onto a clean area.') : X.say('Draw around the area to repair.', 'Draw around the area.');
  }
  function patchReset() { pt.pts = []; pt.closed = false; pt.off = null; pt.drag = null; pt.free = false; patchDraw(); }
  function patchClose() {
    if (!pt || pt.closed) return;
    pt.pts = simplify(pt.pts, 64);
    var xs = pt.pts.map(function (q) { return q[0]; }), ys = pt.pts.map(function (q) { return q[1]; });
    if (pt.pts.length < 3 || (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * (Math.max.apply(null, ys) - Math.min.apply(null, ys)) < 1e-6) { patchReset(); return; }
    pt.closed = true; patchDraw();
  }
  /* The record so far, into the last healing entry with room (a new one when it is full), under the drag's key. */
  var patchWrite = X.rafThrottle(function () {
    if (!pt || !pt.drag || !pt.drag.key) return;
    var FX = global.LE.fx, R = FX.retouch, lay = X.doc.layer(pt.id), g = pt.drag;
    var rec = { kind: PO.mode === 'clone' ? 'clone-polygon' : 'heal-polygon', r: Math.max(0.0005, PO.feather / Math.max(lay.w, lay.h)), opacity: PO.opacity, dx: pt.off.dx, dy: pt.off.dy, points: pt.pts.map(function (q) { return [q[0], q[1], 1]; }) };
    if (g.entry) { X.doc.setEntry(pt.id, g.entry, { p: R.spots.add(g.p0, rec) }, g.key); return; }
    var list = entriesOf(pt.id, 'spot-heal'), e = list[list.length - 1];
    if (e) {
      var base = Object.assign(FX.defaults('spot-heal'), X.clone(e.p)), p = R.spots.add(base, rec);
      if (R.spots.read(p).length > R.spots.read(base).length) { g.entry = e.id; g.p0 = base; X.doc.setEntry(pt.id, e.id, { p: p }, g.key); return; }
    }
    g.p0 = FX.defaults('spot-heal');
    g.entry = X.doc.addFx(pt.id, 'spot-heal', { p: R.spots.add(g.p0, rec), append: !!e }, g.key);
  });
  function patchDown(e) {
    if (!pt || !pt.ready || (e.pointerType === 'mouse' && e.button !== 0) || pt.pid != null) return;
    e.preventDefault();
    var f = fracAt(pt.a, pt.id, e);
    pt.pid = e.pointerId; pt.down = { x: e.clientX, y: e.clientY, moved: false };
    try { pt.a.layer.setPointerCapture(e.pointerId); } catch (err) {}
    if (pt.closed && inside(pt.pts, f)) { pt.drag = { f0: f, key: null }; return; }
    if (pt.closed) patchReset();
    pt.pts.push(f); patchDraw();
  }
  function patchMove(e) {
    if (!pt || e.pointerId !== pt.pid) return;
    var far = Math.hypot(e.clientX - pt.down.x, e.clientY - pt.down.y) > 4, f = fracAt(pt.a, pt.id, e);
    if (pt.drag) {
      if (!far && !pt.drag.key) return;
      if (!pt.drag.key) { pt.drag.key = X.gesture(); X.interactive(true); }
      pt.off = { dx: f[0] - pt.drag.f0[0], dy: f[1] - pt.drag.f0[1] };
      patchWrite(); patchDraw();
      return;
    }
    if (!far && !pt.down.moved) return;
    if (!pt.down.moved) { pt.down.moved = true; pt.free = pt.pts.length === 1; }
    if (pt.free) { pt.pts.push(f); patchDraw(); }
  }
  function patchUp(e) {
    if (!pt || e.pointerId !== pt.pid) return;
    pt.pid = null;
    try { pt.a.layer.releasePointerCapture(e.pointerId); } catch (err) {}
    if (pt.drag) {
      var g = pt.drag;
      if (g.key) { if (e.type === 'pointercancel') patchWrite.cancel(); else { patchWrite(); patchWrite.flush(); } X.interactive(false); patchReset(); }
      pt.drag = null;
      return;
    }
    if (e.type === 'pointercancel') { patchReset(); return; }
    if (pt.free) { pt.free = false; patchClose(); return; }
    /* Corner by corner: a click on the first corner, or a second click on the last one, closes the outline. */
    var n = pt.pts.length, P = pt.pts.map(function (q) { return place(pt.a, pt.id, q); }), reach = X.coarse() ? 22 : 12;
    if (n >= 4 && P[n - 1] && (Math.hypot(P[n - 1][0] - P[0][0], P[n - 1][1] - P[0][1]) < reach || Math.hypot(P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1]) < 5)) { pt.pts.pop(); patchClose(); }
  }
  T.register({
    id: 'patch', key: 'P', label: 'Patch', group: 'retouch', order: 41.4, cursor: 'crosshair',
    icon: '<path d="M8.5 3.5 3.5 8.5a3 3 0 0 0 0 4.2l7.3 7.3a3 3 0 0 0 4.2 0l5-5a3 3 0 0 0 0-4.2L12.7 3.5a3 3 0 0 0-4.2 0Z"/><path d="m7 10 7 7M10 7l7 7"/><path d="M11.2 11.2h.01M12.8 12.8h.01"/>',
    activate: function (a) {
      var l = X.rtTarget(a, 'patch'); if (!l) { setTimeout(function () { T.activate('move'); }, 0); return; }
      pt = { a: a, id: l.id, pts: [], closed: false, off: null, drag: null, pid: null, svg: overlay(a), ready: false };
      a.capture(true, 'crosshair');
      global.LE.fxBoot.load().then(function () { if (pt) pt.ready = true; });
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (n, i) { a.layer.addEventListener(n, [patchDown, patchMove, patchUp, patchUp][i]); });
      pt.unview = X.workspace && X.workspace.onView ? X.workspace.onView(patchDraw) : null;
    },
    deactivate: function (a) {
      if (pt) {
        if (pt.drag && pt.drag.key) { patchWrite.flush(); X.interactive(false); }
        ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (n, i) { a.layer.removeEventListener(n, [patchDown, patchMove, patchUp, patchUp][i]); });
        if (pt.unview) pt.unview();
        pt.svg.remove();
      }
      pt = null; a.capture(false);
    },
    onKey: function (e) {
      if (!pt) return false;
      if (e.key === 'Enter' && !pt.closed && pt.pts.length >= 3) { patchClose(); return true; }
      if (e.key === 'Escape' && pt.pts.length) { patchReset(); return true; }
      return false;
    },
    options: function () {
      var w = h('<span class="xp-opts"></span>');
      function save(o) { Object.assign(PO, o); X.lsSet('le-expert-patch', PO); }
      var seg = X.controls.create('segmented', { aria: 'Patch mode', options: [{ value: 'heal', label: 'Heal' }, { value: 'clone', label: 'Copy' }], value: PO.mode, onCommit: function (v) { save({ mode: v }); } });
      w.appendChild(seg.el);
      w.appendChild(T.opt('Feather', PO.feather, { min: 0, max: 200, step: 1, unit: 'px' }, function (v) { save({ feather: v }); }));
      w.appendChild(T.opt('Opacity', Math.round(PO.opacity * 100), { min: 1, max: 100, step: 1, unit: '%' }, function (v) { save({ opacity: v / 100 }); }));
      var note = h('<span class="xp-opt-note" data-patch-note></span>');
      w.appendChild(note);
      if (pt) { pt.note = note; patchDraw(); }
      w.appendChild(doneBtn());
      return w;
    }
  });

  /* ---------- Red-eye ---------- */
  var RO = X.lsGet('le-expert-redeye', { size: 12, darken: 50 });
  var re = null;
  function free(p, k) { return !p || !p[k] || !(p[k].x >= 0 && p[k].y >= 0); }
  function redPlace(f, r) {
    var key = X.gesture(), eye = { x: X.clamp(f[0], 0, 1), y: X.clamp(f[1], 0, 1) };
    var e = entriesOf(re.id, 'red-eye').filter(function (x) { var p = x.p || {}; return (free(p, 'eye1') || free(p, 'eye2')) && (!(p.radius > 0) || Math.abs(p.radius - r) < 0.5); })[0];
    if (e) {
      var o = { radius: r, darken: RO.darken }; o[free(e.p, 'eye1') ? 'eye1' : 'eye2'] = eye;
      X.doc.setParams(re.id, e.id, o, key); re.last = e.id;
    } else re.last = X.doc.addFx(re.id, 'red-eye', { p: { eye1: eye, radius: r, darken: RO.darken } }, key);
  }
  function redDraw(b) {
    if (!re) return;
    re.svg.innerHTML = b ? '<rect class="xp-h-line" x="' + Math.min(b.x0, b.x1) + '" y="' + Math.min(b.y0, b.y1) + '" width="' + Math.abs(b.x1 - b.x0) + '" height="' + Math.abs(b.y1 - b.y0) + '"/>' : '';
  }
  function redDown(e) {
    if (!re || !re.ready || (e.pointerType === 'mouse' && e.button !== 0) || re.pid != null) return;
    e.preventDefault();
    re.pid = e.pointerId; re.down = { x: e.clientX, y: e.clientY };
    try { re.a.layer.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function redBox(e) { var hr = re.a.layer.getBoundingClientRect(); return { x0: re.down.x - hr.left, y0: re.down.y - hr.top, x1: e.clientX - hr.left, y1: e.clientY - hr.top }; }
  function redMove(e) { if (re && e.pointerId === re.pid && Math.hypot(e.clientX - re.down.x, e.clientY - re.down.y) > 6) redDraw(redBox(e)); }
  function redUp(e) {
    if (!re || e.pointerId !== re.pid) return;
    re.pid = null; redDraw(null);
    try { re.a.layer.releasePointerCapture(e.pointerId); } catch (err) {}
    if (e.type === 'pointercancel') return;
    var d0 = re.a.toDoc(re.down.x, re.down.y), d1 = re.a.toDoc(e.clientX, e.clientY), lay = X.doc.layer(re.id);
    if (Math.hypot(e.clientX - re.down.x, e.clientY - re.down.y) > 6) {
      /* A box: its centre is the pupil, half its longer side the pupil size. */
      var r = X.clamp(Math.round(Math.max(Math.abs(d1.x - d0.x), Math.abs(d1.y - d0.y))) / 2, 1, 200), c = X.rtFrac(lay, (d0.x + d1.x) / 2, (d0.y + d1.y) / 2);
      RO.size = r; X.lsSet('le-expert-redeye', RO); if (re.size) re.size.set(r);
      redPlace([c.x, c.y], r);
    } else { var f = X.rtFrac(lay, d1.x, d1.y); redPlace([f.x, f.y], RO.size); }
  }
  T.register({
    id: 'redeye', key: 'R', label: 'Red-eye', group: 'retouch', order: 41.6, cursor: 'crosshair',
    icon: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/><path d="M12 2.5v1.6M12 19.9v1.6"/>',
    activate: function (a) {
      var l = X.rtTarget(a, 'remove red-eye from'); if (!l) { setTimeout(function () { T.activate('move'); }, 0); return; }
      re = { a: a, id: l.id, pid: null, svg: overlay(a), ready: false, last: null, run: {} };
      a.capture(true, 'crosshair');
      global.LE.fxBoot.load().then(function () { if (re) re.ready = true; });
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (n, i) { a.layer.addEventListener(n, [redDown, redMove, redUp, redUp][i]); });
    },
    deactivate: function (a) {
      if (re) { ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (n, i) { a.layer.removeEventListener(n, [redDown, redMove, redUp, redUp][i]); }); re.svg.remove(); }
      re = null; a.capture(false);
    },
    options: function () {
      var w = h('<span class="xp-opts"></span>');
      /* The sliders set what the next eye gets and follow the last one placed (one undo step per run of changes). */
      function save(o, p) {
        Object.assign(RO, o); X.lsSet('le-expert-redeye', RO);
        if (re && re.last && X.doc.entry(re.id, re.last)) X.doc.setParams(re.id, re.last, p, runKey(re.run));
      }
      var size = T.opt('Pupil size', RO.size, { min: 1, max: 200, step: 0.5, unit: 'px' }, function (v) { save({ size: v }, { radius: v }); });
      if (re) re.size = size;
      w.appendChild(size);
      w.appendChild(T.opt('Darken', RO.darken, { min: 0, max: 100, step: 1, unit: '%' }, function (v) { save({ darken: v }, { darken: v }); }));
      w.appendChild(h('<span class="xp-opt-note">' + X.esc(X.say('Click each pupil, or drag a box over the eye.', 'Tap each pupil.')) + '</span>'));
      w.appendChild(doneBtn());
      return w;
    }
  });
})(window);
