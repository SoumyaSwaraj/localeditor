/* LocalEditor Expert brush engine.
 *
 *   var b = LE.expert.Brush.attach(el, {
 *     toDoc(clientX, clientY) -> { x, y }       pointer to document space (required)
 *     zoom() -> screen pixels per document unit (for the cursor; default 1)
 *     target: { canvas, map(x, y) -> { x, y } target pixels, scale: target pixels per document unit } | null
 *     size: 60 (document px, diameter), hardness: 0.7, flow: 1, opacity: 1, spacing: 0.12 (of the diameter),
 *     smoothing: 0.35 (0–0.95), pressure: { size: true, flow: false }, tilt: false, mode: 'paint' | 'erase', color: '#ffffff'
 *   });
 *   b.on('start' | 'move' | 'end' | 'cancel', fn(stroke, seg))   stroke: { id, mode, points: [{ x, y, p, tx, ty, t }], bounds, dirty }
 *   b.set(opts) · b.get() · b.size(n) · b.bigger() · b.smaller() · b.harder() · b.softer() · b.swap() · b.setTarget(t) · b.detach()
 *
 * Points are interpolated at the brush spacing, in document space, so a consumer (retouch, liquify, dodge and burn) can
 * replay them at any resolution. With a target canvas the engine also stamps dabs into it, touching only the dirty rectangle.
 * One stroke = one 'end' event: commit there for one undo step per stroke. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var clamp = X.clamp;
  var DEF = { size: 60, hardness: 0.7, flow: 1, opacity: 1, spacing: 0.12, smoothing: 0.35, pressure: { size: true, flow: false }, tilt: false, mode: 'paint', color: '#ffffff', minSize: 1, maxSize: 2000 };

  var dabCache = {};
  function dab(d, hard, color) {
    d = Math.max(1, Math.round(d));
    var k = d + '|' + Math.round(hard * 20) + '|' + color;
    if (dabCache[k]) return dabCache[k];
    var keys = Object.keys(dabCache); if (keys.length > 48) delete dabCache[keys[0]];
    var c = document.createElement('canvas'); c.width = c.height = d + 2;
    var g = c.getContext('2d'), r = d / 2;
    var gr = g.createRadialGradient(r + 1, r + 1, 0, r + 1, r + 1, r);
    var hs = clamp(hard, 0, 0.98);
    gr.addColorStop(0, color); gr.addColorStop(hs, color);
    gr.addColorStop(1, toRgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(r + 1, r + 1, r, 0, Math.PI * 2); g.fill();
    dabCache[k] = c;
    return c;
  }
  function toRgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '#ffffff');
    return m ? 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')' : 'rgba(255,255,255,' + a + ')';
  }

  function attach(el, opts) {
    var o = Object.assign({}, DEF, opts || {});
    o.pressure = Object.assign({}, DEF.pressure, (opts && opts.pressure) || {});
    var ev = {};
    var stroke = null, sm = null, carry = 0, last = null, lastEnd = null, base = null, buf = null, bctx = null;
    var penSeen = 0, pid = null, touches = {};
    var cursor = document.createElement('div');
    cursor.className = 'xp-brush-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = '<i></i>';
    cursor.hidden = true;
    (o.cursorHost || el).appendChild(cursor);

    function emit(n, a, b) { (ev[n] || []).slice().forEach(function (f) { try { f(a, b); } catch (e) { console.error(e); } }); }
    function zoom() { return o.zoom ? o.zoom() : 1; }
    function paintCursor(e) {
      if (!e) return;
      var hr = (o.cursorHost || el).getBoundingClientRect();
      var d = Math.max(4, o.size * zoom());
      cursor.style.width = cursor.style.height = d + 'px';
      cursor.style.transform = 'translate(' + (e.clientX - hr.left - d / 2) + 'px,' + (e.clientY - hr.top - d / 2) + 'px)';
      cursor.style.setProperty('--hard', String(clamp(o.hardness, 0.05, 1)));
      cursor.classList.toggle('is-erase', (stroke ? stroke.mode : o.mode) === 'erase');
    }
    var lastPointer = null;

    function pt(e) {
      var p = o.toDoc(e.clientX, e.clientY);
      var pen = e.pointerType === 'pen';
      return { x: p.x, y: p.y, p: pen ? (e.pressure || 0.5) : 1, tx: e.tiltX || 0, ty: e.tiltY || 0, t: e.timeStamp || Date.now() };
    }
    function sizeAt(q) { return clamp(o.size * (o.pressure.size ? Math.max(0.08, q.p) : 1), o.minSize, o.maxSize); }
    function grow(b, x, y, r) {
      if (!b) return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
      b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r); b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r);
      return b;
    }
    /* Stamp one dab into the stroke buffer. */
    function stamp(q, seg) {
      var d = sizeAt(q);
      seg.bounds = grow(seg.bounds, q.x, q.y, d / 2);
      if (!bctx) return;
      var T = o.target, tp = T.map(q.x, q.y), td = d * (T.scale || 1);
      var flow = o.flow * (o.pressure.flow ? Math.max(0.05, q.p) : 1);
      bctx.globalAlpha = clamp(flow, 0, 1);
      var img = dab(td, o.hardness, '#ffffff');
      if (o.tilt && (q.tx || q.ty)) {
        var ang = Math.atan2(q.ty, q.tx), squash = 1 - Math.min(0.7, Math.hypot(q.tx, q.ty) / 90);
        bctx.save(); bctx.translate(tp.x, tp.y); bctx.rotate(ang); bctx.scale(1, squash);
        bctx.drawImage(img, -td / 2 - 1, -td / 2 - 1, td + 2, td + 2); bctx.restore();
      } else bctx.drawImage(img, tp.x - td / 2 - 1, tp.y - td / 2 - 1, td + 2, td + 2);
      seg.dirty = grow(seg.dirty, tp.x, tp.y, td / 2 + 2);
    }
    /* Interpolate from `last` to q at the spacing; carry the remainder so dabs are evenly spaced at any speed. */
    function segment(q, seg) {
      if (!last) { stamp(q, seg); seg.points.push(q); last = q; carry = 0; return; }
      var dx = q.x - last.x, dy = q.y - last.y, dist = Math.hypot(dx, dy);
      var step = Math.max(0.5, o.spacing * sizeAt(q));
      var t = step - carry;
      while (t <= dist) {
        var k = t / dist;
        var s = { x: last.x + dx * k, y: last.y + dy * k, p: last.p + (q.p - last.p) * k, tx: q.tx, ty: q.ty, t: q.t };
        stamp(s, seg); seg.points.push(s);
        t += step;
      }
      carry = dist - (t - step);
      last = q;
    }
    /* Show the buffer on the target over the saved base, only inside the dirty rectangle. */
    function present(dirty) {
      if (!bctx || !dirty) return;
      var T = o.target, tc = T.canvas.getContext('2d');
      var x = Math.max(0, Math.floor(dirty.x0)), y = Math.max(0, Math.floor(dirty.y0));
      var w = Math.min(T.canvas.width, Math.ceil(dirty.x1)) - x, hh = Math.min(T.canvas.height, Math.ceil(dirty.y1)) - y;
      if (w <= 0 || hh <= 0) return null;
      tc.save();
      tc.globalCompositeOperation = 'copy';
      tc.globalAlpha = 1;
      tc.drawImage(base, x, y, w, hh, x, y, w, hh);
      tc.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
      tc.globalAlpha = clamp(o.opacity, 0, 1);
      if (stroke.mode === 'erase') tc.drawImage(buf, x, y, w, hh, x, y, w, hh);
      else {
        /* Colour the white buffer with the brush colour on the way out. */
        var tmp = present.tmp || (present.tmp = document.createElement('canvas'));
        if (tmp.width < w || tmp.height < hh) { tmp.width = Math.max(tmp.width, w); tmp.height = Math.max(tmp.height, hh); }
        var tx = tmp.getContext('2d');
        tx.globalCompositeOperation = 'copy'; tx.drawImage(buf, x, y, w, hh, 0, 0, w, hh);
        tx.globalCompositeOperation = 'source-in'; tx.fillStyle = o.color; tx.fillRect(0, 0, w, hh);
        tc.drawImage(tmp, 0, 0, w, hh, x, y, w, hh);
      }
      tc.restore();
      return { x: x, y: y, w: w, h: hh };
    }
    function begin(e, line) {
      var q = pt(e);
      var erase = o.mode === 'erase' || e.button === 5 || (e.buttons & 32) === 32;
      stroke = { id: X.uid('st'), mode: erase ? 'erase' : 'paint', points: [], bounds: null, dirty: null, pointer: e.pointerType, line: !!line };
      sm = { x: q.x, y: q.y, p: q.p, tx: q.tx, ty: q.ty, t: q.t };
      last = null; carry = 0;
      if (o.target && o.target.canvas) {
        var tc = o.target.canvas;
        base = document.createElement('canvas'); base.width = tc.width; base.height = tc.height;
        base.getContext('2d').drawImage(tc, 0, 0);
        buf = document.createElement('canvas'); buf.width = tc.width; buf.height = tc.height;
        bctx = buf.getContext('2d');
      } else { base = buf = bctx = null; }
      X.interactive(true);
      emit('start', stroke);
      var seg = { points: [], bounds: null, dirty: null };
      if (line && lastEnd) { segment(Object.assign({}, lastEnd), seg); segment(q, seg); }
      else segment(q, seg);
      flushSeg(seg);
    }
    function flushSeg(seg) {
      if (!seg.points.length && !seg.dirty) return;
      stroke.points.push.apply(stroke.points, seg.points);
      if (seg.bounds) stroke.bounds = grow(stroke.bounds, seg.bounds.x0, seg.bounds.y0, 0), stroke.bounds = grow(stroke.bounds, seg.bounds.x1, seg.bounds.y1, 0);
      if (seg.dirty) { stroke.dirty = grow(stroke.dirty, seg.dirty.x0, seg.dirty.y0, 0); stroke.dirty = grow(stroke.dirty, seg.dirty.x1, seg.dirty.y1, 0); seg.rect = present(seg.dirty); }
      emit('move', stroke, seg);
    }
    function moveTo(list) {
      var seg = { points: [], bounds: null, dirty: null };
      var k = 1 - clamp(o.smoothing, 0, 0.95);
      list.forEach(function (q) {
        sm.x += (q.x - sm.x) * k; sm.y += (q.y - sm.y) * k; sm.p += (q.p - sm.p) * Math.max(k, 0.5); sm.tx = q.tx; sm.ty = q.ty; sm.t = q.t;
        segment({ x: sm.x, y: sm.y, p: sm.p, tx: sm.tx, ty: sm.ty, t: sm.t }, seg);
      });
      flushSeg(seg);
    }
    function finish(e, cancel) {
      if (!stroke) return;
      if (!cancel && e) {
        /* Catch the smoothed point up with the pointer so the stroke ends where the pen lifted. */
        var q = pt(e), seg = { points: [], bounds: null, dirty: null };
        segment(q, seg); flushSeg(seg);
        lastEnd = q;
      }
      var s = stroke;
      stroke = null;
      X.interactive(false);
      if (cancel && bctx) { var tc = o.target.canvas.getContext('2d'); tc.save(); tc.globalCompositeOperation = 'copy'; tc.drawImage(base, 0, 0); tc.restore(); }
      base = buf = bctx = null;
      if (s.bounds) s.bounds = { x: s.bounds.x0, y: s.bounds.y0, w: s.bounds.x1 - s.bounds.x0, h: s.bounds.y1 - s.bounds.y0 };
      emit(cancel ? 'cancel' : 'end', s);
    }

    function down(e) {
      if (o.enabled === false) return;
      if (e.pointerType === 'pen') penSeen = Date.now();
      if (e.pointerType === 'touch') {
        touches[e.pointerId] = 1;
        /* Palm rejection: a pen was used in the last few seconds, a broad contact, or a second finger (that is a pinch). */
        if (Date.now() - penSeen < 3000 || (e.width && e.width > 40 && e.height > 40)) return;
        if (Object.keys(touches).length > 1) { if (stroke) finish(null, true); pid = null; return; }
      }
      if (e.button !== 0 && e.button !== 5 && e.pointerType === 'mouse') return;
      if (stroke) return;
      e.preventDefault(); e.stopPropagation();
      pid = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      begin(e, e.shiftKey);
    }
    function move(e) {
      lastPointer = e;
      if (!stroke) { cursor.hidden = o.enabled === false || e.pointerType === 'touch'; paintCursor(e); return; }
      if (e.pointerId !== pid) return;
      e.preventDefault();
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!list.length) list = [e];
      moveTo(list.map(pt));
      paintCursor(e);
    }
    function up(e) {
      delete touches[e.pointerId];
      if (!stroke || e.pointerId !== pid) return;
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      pid = null;
      finish(e, e.type === 'pointercancel');
    }
    function leave() { if (!stroke) cursor.hidden = true; }
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', leave);

    var api = {
      cursor: cursor,
      on: function (n, f) { (ev[n] = ev[n] || []).push(f); return function () { var a = ev[n]; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; },
      get: function () { return { size: o.size, hardness: o.hardness, flow: o.flow, opacity: o.opacity, spacing: o.spacing, smoothing: o.smoothing, pressure: Object.assign({}, o.pressure), tilt: o.tilt, mode: o.mode, color: o.color }; },
      set: function (p) { Object.keys(p || {}).forEach(function (k) { if (k === 'pressure') o.pressure = Object.assign({}, o.pressure, p.pressure); else o[k] = p[k]; }); o.size = clamp(o.size, o.minSize, o.maxSize); o.hardness = clamp(o.hardness, 0, 1); paintCursor(lastPointer); emit('options', api.get()); },
      size: function (n) { if (n == null) return o.size; api.set({ size: n }); return o.size; },
      /* [ and ]: about 10% per press, finer below 10 px. */
      bigger: function () { return api.size(o.size < 10 ? o.size + 1 : Math.round(o.size * 1.12)); },
      smaller: function () { return api.size(o.size <= 10 ? o.size - 1 : Math.round(o.size / 1.12)); },
      harder: function () { api.set({ hardness: Math.round(Math.min(1, o.hardness + 0.1) * 10) / 10 }); return o.hardness; },
      softer: function () { api.set({ hardness: Math.round(Math.max(0, o.hardness - 0.1) * 10) / 10 }); return o.hardness; },
      swap: function () { api.set({ mode: o.mode === 'erase' ? 'paint' : 'erase' }); return o.mode; },
      setTarget: function (t) { o.target = t; },
      enable: function (on) { o.enabled = on !== false; if (!on) cursor.hidden = true; },
      painting: function () { return !!stroke; },
      cancel: function () { if (stroke) finish(null, true); },
      detach: function () {
        if (stroke) finish(null, true);
        el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('pointerleave', leave);
        cursor.remove();
      },
      /* Test and replay hook: feed document-space points as one stroke. */
      replay: function (points, mode) {
        var e0 = points[0];
        stroke = { id: X.uid('st'), mode: mode || o.mode, points: [], bounds: null, dirty: null, pointer: 'replay' };
        sm = Object.assign({ p: 1, tx: 0, ty: 0, t: 0 }, e0); last = null; carry = 0;
        if (o.target && o.target.canvas) { var tc = o.target.canvas; base = document.createElement('canvas'); base.width = tc.width; base.height = tc.height; base.getContext('2d').drawImage(tc, 0, 0); buf = document.createElement('canvas'); buf.width = tc.width; buf.height = tc.height; bctx = buf.getContext('2d'); }
        emit('start', stroke);
        var seg = { points: [], bounds: null, dirty: null };
        points.forEach(function (q) { segment(Object.assign({ p: 1, tx: 0, ty: 0, t: 0 }, q), seg); });
        flushSeg(seg);
        var s = stroke; stroke = null; base = buf = bctx = null;
        if (s.bounds) s.bounds = { x: s.bounds.x0, y: s.bounds.y0, w: s.bounds.x1 - s.bounds.x0, h: s.bounds.y1 - s.bounds.y0 };
        emit('end', s);
        return s;
      }
    };
    return api;
  }
  X.Brush = { attach: attach, defaults: DEF, dab: dab };
})(window);
