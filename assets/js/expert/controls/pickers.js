/* Expert control kit: point and angle pickers with on-canvas handles, two-point lines (gradient ends, vanishing lines),
 * the LUT picker (.cube file -> asset) and X.canvas, the overlay every on-canvas handle is drawn in.
 *
 * X.canvas.attach(host, map) — the workspace (or the gallery) says where the picture is:
 *   map = { box(layerId) -> { x, y, w, h, rotation } in client pixels, onChange(fn) -> unsubscribe }
 * X.canvas.handles(spec) — one set of handles at a time:
 *   spec = { layerId, points: [{ id, x, y, label, ring }], lines: [[idA, idB]], ellipses: [{ c, rx, ry, rot }],
 *            onDrag(id, x, y, phase, event) }   x, y are fractions of the layer box (0–1)
 *   returns { update(spec), destroy() } */
(function (global) {
  'use strict';
  var LE = global.LE, X = LE && LE.expert;
  if (!X || !X.controls || !X.controls.register) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;

  /* ---------- Canvas overlay ---------- */
  var CV = X.canvas = X.canvas || {};
  var host = null, map = null, svg = null, cur = null, unsub = null;
  CV.attach = function (el, m) {
    CV.detach();
    host = el; map = m;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'xp-handles');
    svg.setAttribute('aria-hidden', 'false');
    host.appendChild(svg);
    if (map.onChange) unsub = map.onChange(function () { if (cur) draw(); });
  };
  CV.detach = function () { if (svg) svg.remove(); if (unsub) unsub(); svg = null; host = null; map = null; cur = null; unsub = null; };
  CV.attached = function () { return !!svg; };
  CV._host = function () { return host; };
  CV._box = function (id) { return map && map.box(id); };
  /* Fractions of a layer box <-> client pixels, honouring rotation. */
  function frame() {
    var b = map && cur && map.box(cur.layerId);
    if (!b) return null;
    var hr = host.getBoundingClientRect();
    return { b: b, hr: hr, rad: (b.rotation || 0) * Math.PI / 180 };
  }
  function toClient(f, x, y) {
    var b = f.b, cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = (x - 0.5) * b.w, dy = (y - 0.5) * b.h;
    return { x: cx + dx * Math.cos(f.rad) - dy * Math.sin(f.rad) - f.hr.left, y: cy + dx * Math.sin(f.rad) + dy * Math.cos(f.rad) - f.hr.top };
  }
  function toFrac(f, clientX, clientY) {
    var b = f.b, cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = clientX - cx, dy = clientY - cy;
    var lx = dx * Math.cos(-f.rad) - dy * Math.sin(-f.rad), ly = dx * Math.sin(-f.rad) + dy * Math.cos(-f.rad);
    return { x: lx / b.w + 0.5, y: ly / b.h + 0.5 };
  }
  CV.toFrac = function (layerId, clientX, clientY) { var save = cur; cur = { layerId: layerId }; var f = frame(); cur = save; return f ? toFrac(f, clientX, clientY) : null; };
  function draw() {
    if (!svg) return;
    var f = frame();
    if (!f || !cur) { svg.innerHTML = ''; return; }
    var P = {}, out = '';
    (cur.points || []).forEach(function (p) { P[p.id] = toClient(f, p.x, p.y); });
    (cur.ellipses || []).forEach(function (e) {
      var c = P[e.c] || toClient(f, 0.5, 0.5);
      out += '<ellipse class="xp-h-shape" cx="' + c.x + '" cy="' + c.y + '" rx="' + Math.abs(e.rx * f.b.w) + '" ry="' + Math.abs(e.ry * f.b.h) + '" transform="rotate(' + ((e.rot || 0) + (f.b.rotation || 0)) + ' ' + c.x + ' ' + c.y + ')"/>';
    });
    (cur.lines || []).forEach(function (l) {
      var a = P[l[0]], b = P[l[1]];
      if (!a || !b) return;
      out += '<line class="xp-h-line' + (l[2] ? ' is-' + l[2] : '') + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
      if (l[2] === 'gradient') {
        /* Parallel guides at both ends, like a graduated filter. */
        var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len * 2000, ny = dx / len * 2000;
        out += '<line class="xp-h-guide" x1="' + (a.x - nx) + '" y1="' + (a.y - ny) + '" x2="' + (a.x + nx) + '" y2="' + (a.y + ny) + '"/><line class="xp-h-guide" x1="' + (b.x - nx) + '" y1="' + (b.y - ny) + '" x2="' + (b.x + nx) + '" y2="' + (b.y + ny) + '"/>';
      }
    });
    (cur.points || []).forEach(function (p) {
      var c = P[p.id];
      out += '<g class="xp-h-pt' + (p.ring ? ' is-ring' : '') + '" data-id="' + esc(p.id) + '" tabindex="0" role="slider" aria-label="' + esc(p.label || p.id) + '" aria-valuetext="' + Math.round(p.x * 100) + '%, ' + Math.round(p.y * 100) + '%"><circle class="xp-h-hit" cx="' + c.x + '" cy="' + c.y + '" r="22"/><circle class="xp-h-dot" cx="' + c.x + '" cy="' + c.y + '" r="' + (p.ring ? 8 : 6) + '"/></g>';
    });
    svg.innerHTML = out;
  }
  CV.redraw = draw;
  CV.handles = function (spec) {
    if (!svg) return { update: function () {}, destroy: function () {} };
    if (cur && cur.onClose && cur !== spec) cur.onClose();
    cur = spec;
    svg.classList.add('is-on');
    draw();
    return {
      update: function (s) { if (cur !== spec) return; Object.assign(spec, s); draw(); },
      destroy: function () { if (cur === spec) { cur = null; svg.classList.remove('is-on'); svg.innerHTML = ''; } }
    };
  };
  CV.current = function () { return cur; };
  /* Dragging handles. */
  (function () {
    var drag = null;
    document.addEventListener('pointerdown', function (e) {
      if (!svg || !cur) return;
      var g = e.target.closest && e.target.closest('.xp-h-pt');
      if (!g || !svg.contains(g)) return;
      e.preventDefault(); e.stopPropagation();
      drag = { id: g.getAttribute('data-id'), pid: e.pointerId };
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      X.interactive(true);
      if (cur.onDrag) { var f = frame(); var u = toFrac(f, e.clientX, e.clientY); cur.onDrag(drag.id, u.x, u.y, 'start', e); }
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.pid || !cur) return;
      var f = frame(); if (!f) return;
      var u = toFrac(f, e.clientX, e.clientY);
      if (cur.onDrag) cur.onDrag(drag.id, u.x, u.y, 'move', e);
    }, true);
    function up(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag; drag = null;
      X.interactive(false);
      try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
      var f = frame();
      if (cur && cur.onDrag && f) { var u = toFrac(f, e.clientX, e.clientY); cur.onDrag(d.id, u.x, u.y, 'end', e); }
    }
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', function (e) {
      if (!svg || !cur) return;
      var g = e.target.closest && e.target.closest('.xp-h-pt');
      if (!g || !svg.contains(g)) return;
      var p = (cur.points || []).filter(function (q) { return q.id === g.getAttribute('data-id'); })[0];
      if (!p) return;
      var s = e.shiftKey ? 0.05 : 0.005, dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -s; else if (e.key === 'ArrowRight') dx = s; else if (e.key === 'ArrowUp') dy = -s; else if (e.key === 'ArrowDown') dy = s; else return;
      e.preventDefault(); e.stopPropagation();
      var id = p.id;
      if (cur.onDrag) { cur.onDrag(id, p.x + dx, p.y + dy, 'key', e); }
      var again = svg.querySelector('[data-id="' + id + '"]'); if (again) again.focus();
    }, true);
  })();

  function fmtP(v) { return v == null ? '–' : Math.round(v * 100) + '%'; }
  /* A button that shows this control's handles on the canvas. Only one control owns the canvas at a time. */
  function canvasToggle(label, show) {
    var b = h('<button type="button" class="xp-ib xp-oncanvas" aria-pressed="false" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + X.ic('point') + '</button>');
    var hd = null;
    function off() { if (hd) { hd.destroy(); hd = null; } b.setAttribute('aria-pressed', 'false'); }
    b.addEventListener('click', function () {
      if (hd) { off(); return; }
      if (!CV.attached()) { if (global.LEStudio) global.LEStudio.toast('Open a photo to place this on the canvas.'); return; }
      hd = show(off);
      b.setAttribute('aria-pressed', hd ? 'true' : 'false');
    });
    b._update = function (s) { if (hd) hd.update(s); };
    b._off = off;
    return b;
  }
  C.canvasToggle = canvasToggle;

  /* ---------- Point ----------
     spec: { label, value: { x, y }, layerId: () => id, onInput, onCommit } */
  C.register('point', function (spec) {
    var v = X.coerce({ type: 'point' }, spec.value);
    var dflt = (spec.schema && spec.schema.default) || { x: 0.5, y: 0.5 };
    var row = C.row(spec, 'xp-pointrow');
    var ctl = row.querySelector('.xp-ctl');
    var g = C.gesture(spec);
    var sx = { min: 0, max: 1, step: 0.001 };
    var nx = h('<span class="xp-num xp-num-sm" role="slider" tabindex="0" aria-label="' + esc(spec.label) + ' across" aria-valuemin="0" aria-valuemax="100"></span>');
    var ny = h('<span class="xp-num xp-num-sm" role="slider" tabindex="0" aria-label="' + esc(spec.label) + ' down" aria-valuemin="0" aria-valuemax="100"></span>');
    ctl.appendChild(h('<span class="xp-axis">X</span>')); ctl.appendChild(nx); ctl.appendChild(h('<span class="xp-axis">Y</span>')); ctl.appendChild(ny);
    var tog = canvasToggle('Show ' + (spec.label || 'point') + ' on the canvas', function () {
      var id = spec.layerId && spec.layerId();
      if (!id) return null;
      return CV.handles({ layerId: id, points: [{ id: 'p', x: v.x, y: v.y, label: spec.label, ring: true }], onDrag: function (_, x, y, ph) {
        if (ph === 'start') g.start();
        v = X.coerce({ type: 'point' }, { x: x, y: y }); paint();
        if (ph === 'end') g.end(X.clone(v)); else if (ph === 'key') g.once(X.clone(v), true); else g.input(X.clone(v));
      } });
    });
    ctl.appendChild(tog);
    function paint() {
      nx.textContent = fmtP(v.x); ny.textContent = fmtP(v.y);
      nx.setAttribute('aria-valuenow', String(Math.round(v.x * 100))); ny.setAttribute('aria-valuenow', String(Math.round(v.y * 100)));
      row.classList.toggle('is-changed', Math.abs(v.x - dflt.x) > 1e-4 || Math.abs(v.y - dflt.y) > 1e-4);
      tog._update({ points: [{ id: 'p', x: v.x, y: v.y, label: spec.label, ring: true }] });
    }
    [['x', nx], ['y', ny]].forEach(function (a) {
      var s = C.scrubber(a[1], sx, function () { return v[a[0]]; }, function (n, one) { v[a[0]] = Math.round(n * 1000) / 1000; paint(); if (one) g.once(X.clone(v)); else g.input(X.clone(v)); }, g, spec.label + ' ' + a[0]);
      a[1].addEventListener('keydown', function (e) {
        var k = e.key, st = e.shiftKey ? 0.05 : 0.005;
        if (k === 'Enter') { C.swallow(e); s.edit(); return; }
        if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
        C.swallow(e);
        v[a[0]] = clamp(Math.round((v[a[0]] + (k === 'ArrowUp' || k === 'ArrowRight' ? st : -st)) * 1000) / 1000, 0, 1);
        paint(); g.once(X.clone(v), true);
      });
    });
    function reset() { v = X.clone(dflt); paint(); g.once(X.clone(v)); }
    row.querySelector('.xp-rst').addEventListener('click', reset);
    C.doubleTap(row.querySelector('.xp-lbl'), reset);
    paint();
    return { el: row, get: function () { return X.clone(v); }, set: function (n) { if (g.active()) return; v = X.coerce({ type: 'point' }, n); paint(); }, focus: function () { nx.focus(); }, destroy: function () { tog._off(); } };
  });

  /* ---------- Line: two points (gradient ends, a vanishing line) ----------
     spec: { label, value: { a: {x,y}, b: {x,y} }, labels: [a, b], style: 'gradient' | 'line', layerId, onInput, onCommit } */
  C.register('line', function (spec) {
    var v = { a: X.coerce({ type: 'point' }, spec.value && spec.value.a), b: X.coerce({ type: 'point' }, spec.value && spec.value.b) };
    var row = C.row(spec, 'xp-pointrow xp-linerow');
    var ctl = row.querySelector('.xp-ctl');
    var g = C.gesture(spec);
    var info = h('<span class="xp-line-info"></span>');
    ctl.appendChild(info);
    function pts() { return [{ id: 'a', x: v.a.x, y: v.a.y, label: (spec.labels || [])[0] || 'Start' }, { id: 'b', x: v.b.x, y: v.b.y, label: (spec.labels || [])[1] || 'End' }]; }
    var tog = canvasToggle('Show ' + (spec.label || 'line') + ' on the canvas', function () {
      var id = spec.layerId && spec.layerId();
      if (!id) return null;
      return CV.handles({ layerId: id, points: pts(), lines: [['a', 'b', spec.style || 'line']], onDrag: function (pid, x, y, ph) {
        if (ph === 'start') g.start();
        v[pid] = X.coerce({ type: 'point' }, { x: x, y: y }); paint();
        if (ph === 'end') g.end(X.clone(v)); else if (ph === 'key') g.once(X.clone(v), true); else g.input(X.clone(v));
      } });
    });
    ctl.appendChild(tog);
    function paint() {
      var ang = Math.round(Math.atan2(v.b.y - v.a.y, v.b.x - v.a.x) * 180 / Math.PI);
      info.textContent = fmtP(v.a.x) + ', ' + fmtP(v.a.y) + ' → ' + fmtP(v.b.x) + ', ' + fmtP(v.b.y) + ' · ' + ang + '°';
      tog._update({ points: pts() });
    }
    row.querySelector('.xp-rst').addEventListener('click', function () { var d = spec.schema && spec.schema.default; if (d) { v = X.clone(d); paint(); g.once(X.clone(v)); } });
    paint();
    return { el: row, get: function () { return X.clone(v); }, set: function (n) { if (g.active() || !n) return; v = { a: X.coerce({ type: 'point' }, n.a), b: X.coerce({ type: 'point' }, n.b) }; paint(); }, focus: function () { tog.focus(); }, destroy: function () { tog._off(); } };
  });

  /* ---------- Angle: a dial you can turn, a scrubbable number, and a handle on the canvas ---------- */
  C.register('angle', function (spec) {
    var sc = Object.assign({ min: 0, max: 360, step: 1, unit: '°' }, spec.schema || {});
    var wrap = !(spec.schema && (spec.schema.min != null || spec.schema.max != null));
    var dflt = sc.default != null ? sc.default : 0;
    var v = Number(spec.value) || 0;
    var row = C.row(spec, 'xp-anglerow');
    var ctl = row.querySelector('.xp-ctl');
    var dial = h('<span class="xp-dial" role="slider" tabindex="0" aria-labelledby="' + row._lid + '" aria-valuemin="' + sc.min + '" aria-valuemax="' + sc.max + '"><i></i></span>');
    var num = h('<span class="xp-num" aria-hidden="true"></span>');
    ctl.appendChild(dial); ctl.appendChild(num);
    var g = C.gesture(spec);
    function norm(a) { return wrap ? Math.round((((a % 360) + 360) % 360) * 10) / 10 : X.roundTo(clamp(a, sc.min, sc.max), sc.step); }
    var tog = canvasToggle('Show ' + (spec.label || 'angle') + ' on the canvas', function () {
      var id = spec.layerId && spec.layerId();
      if (!id) return null;
      return CV.handles({ layerId: id, points: hp(), lines: [['c', 'p']], onDrag: function (pid, x, y, ph) {
        if (pid !== 'p') return;
        if (ph === 'start') g.start();
        v = norm(-Math.atan2(y - 0.5, x - 0.5) * 180 / Math.PI); paint();
        if (ph === 'end') g.end(v); else if (ph === 'key') g.once(v, true); else g.input(v);
      } });
    });
    ctl.appendChild(tog);
    function hp() { var r = v * Math.PI / 180; return [{ id: 'c', x: 0.5, y: 0.5, label: 'Centre' }, { id: 'p', x: 0.5 + Math.cos(r) * 0.3, y: 0.5 - Math.sin(r) * 0.3, label: spec.label, ring: true }]; }
    function paint() {
      dial.style.setProperty('--a', (-v) + 'deg');
      num.textContent = C.format(v, Object.assign({}, sc, { min: wrap ? 0 : sc.min }));
      dial.setAttribute('aria-valuenow', String(v)); dial.setAttribute('aria-valuetext', v + ' degrees');
      row.classList.toggle('is-changed', Math.abs(v - dflt) > 1e-6);
      tog._update({ points: hp() });
    }
    C.drag(dial, {
      slop: 0,
      start: function () { g.start(); dial.focus({ preventScroll: true }); },
      move: function (e) {
        var r = dial.getBoundingClientRect();
        var a = -Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        v = norm(a); paint(); g.input(v);
      },
      end: function () { g.end(v); }
    });
    dial.style.touchAction = 'none';
    var s = C.scrubber(num, Object.assign({}, sc, wrap ? { min: -720, max: 720 } : {}), function () { return v; }, function (n, one) { v = norm(n); paint(); if (one) g.once(v); else g.input(v); }, g, spec.label || 'Angle');
    dial.addEventListener('keydown', function (e) {
      var k = e.key, st = e.shiftKey ? 15 : e.altKey ? 0.1 : 1;
      if (k === 'Enter') { C.swallow(e); s.edit(); return; }
      if (k === 'Backspace' || k === 'Delete') { C.swallow(e); reset(); return; }
      if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return;
      C.swallow(e);
      v = norm(v + (k === 'ArrowUp' || k === 'ArrowLeft' ? st : -st)); paint(); g.once(v, true);
    });
    function reset() { v = dflt; paint(); g.once(v); }
    row.querySelector('.xp-rst').addEventListener('click', reset);
    C.doubleTap(dial, reset);
    C.doubleTap(row.querySelector('.xp-lbl'), reset);
    paint();
    return { el: row, get: function () { return v; }, set: function (n) { if (g.active()) return; v = Number(n) || 0; paint(); }, focus: function () { dial.focus(); }, destroy: function () { tog._off(); } };
  });

  /* ---------- LUT: a .cube file becomes an asset ---------- */
  /* Parse an Adobe/Resolve-style .cube text (3D only). Returns { size, title, data: Float32Array(size^3 * 3), domainMin, domainMax }. */
  function parseCube(text) {
    var size = 0, title = '', data = [], dmin = [0, 0, 0], dmax = [1, 1, 1];
    String(text).split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === '#') return;
      var m;
      if ((m = /^TITLE\s+"?(.*?)"?$/i.exec(line))) { title = m[1]; return; }
      if ((m = /^LUT_3D_SIZE\s+(\d+)/i.exec(line))) { size = Number(m[1]); return; }
      if (/^LUT_1D_SIZE/i.test(line)) throw new Error('1D LUTs are not supported; use a 3D .cube file.');
      if ((m = /^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line))) { dmin = [+m[1], +m[2], +m[3]]; return; }
      if ((m = /^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line))) { dmax = [+m[1], +m[2], +m[3]]; return; }
      var p = line.split(/\s+/);
      if (p.length === 3 && p.every(function (n) { return isFinite(+n); })) data.push(+p[0], +p[1], +p[2]);
    });
    if (!size || size < 2 || size > 128) throw new Error('This file has no LUT_3D_SIZE between 2 and 128.');
    if (data.length !== size * size * size * 3) throw new Error('This LUT should have ' + (size * size * size) + ' rows; it has ' + Math.floor(data.length / 3) + '.');
    return { size: size, title: title, data: new Float32Array(data), domainMin: dmin, domainMax: dmax };
  }
  C.parseCube = parseCube;
  var LUTS = X.luts = X.luts || {};
  /* Store a .cube file as a project asset; resolves to { id, name, size }. */
  function storeLut(file) {
    return file.text().then(function (text) {
      var G = LE.fx && LE.fx.grade, lut = G && G.parseCube ? G.parseCube(text) : parseCube(text);   /* the grading pack's parser: 1D, shaper + 3D, capped at 65³ */
      var blob = new Blob([text], { type: 'text/plain' });
      var name = file.name || 'look.cube';
      var put = LE.project && LE.project.putAsset ? LE.project.putAsset({ blob: blob, name: name, type: 'text/plain' }) : Promise.resolve({ id: 'lut-' + X.uid() });
      return put.then(function (meta) {
        LUTS[meta.id] = { name: name, size: lut.size, lut: lut };
        var c = global.LEStudio;
        if (c && c.S && c.S.project && c.S.project.assets) c.S.project.assets[meta.id] = Object.assign({ kind: 'lut' }, meta);
        return { id: meta.id, name: name, size: lut.size };
      });
    });
  }
  X.storeLut = storeLut;
  C.register('lut', function (spec) {
    var v = spec.value || null;
    var row = C.row(spec, 'xp-lutrow');
    var ctl = row.querySelector('.xp-ctl');
    var fid = C.uid('xpf');
    ctl.innerHTML = '<label class="xp-lut-drop" for="' + fid + '" tabindex="0" role="button"><span class="xp-lut-name"></span><small>' + esc(X.say('Choose or drop a .cube file', 'Choose a .cube file')) + '</small></label><input type="file" id="' + fid + '" accept=".cube,text/plain" hidden><button type="button" class="xp-ib" data-act="clear" aria-label="Remove LUT">' + X.ic('x') + '</button>';
    var drop = ctl.querySelector('.xp-lut-drop'), input = ctl.querySelector('input'), name = ctl.querySelector('.xp-lut-name');
    var g = C.gesture(spec);
    function paint() {
      var info = v && LUTS[v];
      name.textContent = v ? (info ? info.name + ' · ' + info.size + '³' : 'LUT ' + String(v).slice(0, 8)) : 'None';
      row.classList.toggle('is-changed', !!v);
      ctl.querySelector('[data-act="clear"]').hidden = !v;
    }
    function take(file) {
      if (!file) return;
      row.classList.add('is-busy');
      storeLut(file).then(function (r) { v = r.id; paint(); g.once(v); }, function (err) {
        var c = global.LEStudio; var msg = err && err.message ? err.message : 'Could not read that LUT.';
        if (c && c.toast) c.toast(msg); else row.setAttribute('data-error', msg);
      }).then(function () { row.classList.remove('is-busy'); });
    }
    input.addEventListener('change', function () { take(input.files && input.files[0]); input.value = ''; });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { C.swallow(e); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { row.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); row.classList.add('is-over'); }); });
    row.addEventListener('dragleave', function () { row.classList.remove('is-over'); });
    row.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); row.classList.remove('is-over'); take(e.dataTransfer.files && e.dataTransfer.files[0]); });
    ctl.querySelector('[data-act="clear"]').addEventListener('click', function () { v = null; paint(); g.once(null); });
    row.querySelector('.xp-rst').addEventListener('click', function () { v = null; paint(); g.once(null); });
    paint();
    return { el: row, get: function () { return v; }, set: function (n) { v = n || null; paint(); }, focus: function () { drop.focus(); }, take: take, destroy: function () {} };
  });
})(window);
