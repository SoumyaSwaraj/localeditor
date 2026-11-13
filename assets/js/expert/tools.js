/* LocalEditor Expert: tool strip, tool registry, built-in tools and the shortcut map.
 *
 *   LE.expert.tools.register({
 *     id: 'heal', key: 'J', label: 'Heal', icon: '<svg inner markup>' | icon name, cursor: 'crosshair', group: 'retouch', order: 40,
 *     activate(api), deactivate(api), options(api) -> Node | null (shown in the options bar), placeholder: false
 *   })
 *   LE.expert.tools.activate(id) · .active() · .list() · .bindings() (every shortcut, for the sheet and the collision test)
 * api: { ctx, layer: overlay element over the canvas, capture(on, cursor), toDoc(cx, cy), zoom(), target() -> layer id,
 *        brush() -> shared Brush options, toast(msg), sample(cx, cy) -> { r, g, b } (0–1) }
 * Tool keys are single letters without modifiers; a key that another tool already uses is refused with a console warning. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;
  var T = X.tools = X.tools || {};
  var REG = T._reg = T._reg || {};
  var cur = null, prev = 'move', api = null;
  var BRUSH = X.lsGet('le-expert-brush', { size: 80, hardness: 0.6, flow: 1, opacity: 1, smoothing: 0.35, spacing: 0.12, pressure: { size: true, flow: false }, mode: 'paint' });

  /* ---------- Registry ---------- */
  T.register = function (t) {
    if (!t || !t.id) throw new Error('A tool needs an id');
    if (t.key) {
      var k = String(t.key).toUpperCase();
      var clash = Object.keys(REG).filter(function (id) { return id !== t.id && REG[id].key && String(REG[id].key).toUpperCase() === k; })[0];
      if (clash && !t.replace) { console.warn('LE.expert.tools: key ' + k + ' is already used by ' + clash + '; ' + t.id + ' gets no key.'); t = Object.assign({}, t, { key: null }); }
    }
    var was = REG[t.id];
    REG[t.id] = Object.assign({ order: 100, group: 'misc' }, t);
    if (was && cur === t.id && api) { if (was.deactivate) was.deactivate(api); T.activate(t.id); }
    X.emit('tools');
    return REG[t.id];
  };
  T.list = function () { return Object.keys(REG).map(function (k) { return REG[k]; }).sort(function (a, b) { return a.order - b.order; }); };
  T.get = function (id) { return REG[id]; };
  T.active = function () { return cur; };

  /* ---------- Tool runtime (the workspace calls T.mount(env)) ---------- */
  var env = null, layerEl = null, optsHost = null;
  T.mount = function (e) {
    env = e;
    layerEl = h('<div class="xp-toollayer" aria-hidden="true"></div>');
    env.stage.appendChild(layerEl);
    api = {
      ctx: env.ctx, layer: layerEl,
      capture: function (on, cursor) { layerEl.classList.toggle('is-on', !!on); layerEl.style.cursor = cursor || ''; },
      toDoc: env.toDoc, zoom: env.zoom, target: env.target,
      brush: function () { return BRUSH; },
      toast: function (m) { env.ctx.toast(m); },
      sample: sample
    };
    T.activate(cur || 'move', { silent: true });
  };
  T.unmount = function () {
    if (cur && REG[cur] && REG[cur].deactivate && api) REG[cur].deactivate(api);
    if (layerEl) layerEl.remove();
    layerEl = null; env = null; api = null;
  };
  T.activate = function (id, o) {
    o = o || {};
    var t = REG[id];
    if (!t || !api) { cur = id; return; }
    if (t.placeholder) { api.toast(t.label + ' is coming with the retouching tools.'); if (!o.force) return; }
    if (cur && REG[cur] && cur !== id && REG[cur].deactivate) REG[cur].deactivate(api);
    if (cur && cur !== id) prev = cur;
    cur = id;
    api.capture(false);
    if (t.activate) t.activate(api, o);
    paintStrip();
    T.renderOptions();
    X.emit('tool', id);
  };
  T.back = function () { T.activate(prev && prev !== cur ? prev : 'move'); };
  /* The options bar lives in the studio's contextual toolbar: a slot the shell keeps (data-pri 0), filled with live nodes. */
  T.optionsHtml = function () {
    var t = REG[cur];
    return t && t.options ? '<span class="xp-optslot" data-pri="0" data-tool="' + esc(cur) + '"></span>' : '';
  };
  T.renderOptions = function () {
    var c = env && env.ctx;
    if (!c) return;
    c.renderToolbar();
    fillSlot();
  };
  function fillSlot() {
    var c = env && env.ctx; if (!c) return;
    var slot = c.E.tool.querySelector('.xp-optslot');
    if (!slot || slot._for === cur) return;
    var t = REG[cur];
    slot.innerHTML = '';
    slot._for = cur;
    var n = t && t.options ? t.options(api) : null;
    if (n) slot.appendChild(n);
  }
  T.fillSlot = fillSlot;

  /* ---------- Strip ---------- */
  var strips = [];
  T.renderStrip = function (host, o) {
    o = o || {};
    var el = h('<div class="xp-strip-in" role="toolbar" aria-label="Expert tools" aria-orientation="' + (o.horizontal ? 'horizontal' : 'vertical') + '"></div>');
    var lastGroup = null;
    T.list().forEach(function (t) {
      if (lastGroup && t.group !== lastGroup) el.appendChild(h('<i class="xp-strip-sep" aria-hidden="true"></i>'));
      lastGroup = t.group;
      var icon = /^\s*</.test(t.icon || '') ? '<svg class="xp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.icon + '</svg>' : X.ic(t.icon || t.id);
      var b = h('<button type="button" class="xp-tool' + (t.placeholder ? ' is-soon' : '') + '" data-tool="' + esc(t.id) + '" aria-pressed="false" aria-label="' + esc(t.label + (t.key ? ' (' + t.key + ')' : '')) + '" title="' + esc(t.label + (t.key ? ' (' + t.key + ')' : '') + (t.placeholder ? ' — coming soon' : '')) + '">' + icon + (t.key ? '<kbd aria-hidden="true">' + esc(t.key) + '</kbd>' : '') + '</button>');
      b.addEventListener('click', function () { T.activate(t.id); });
      el.appendChild(b);
    });
    el.addEventListener('keydown', function (e) {
      var bs = [].slice.call(el.querySelectorAll('.xp-tool')), i = bs.indexOf(document.activeElement);
      if (i < 0) return;
      var fwd = o.horizontal ? 'ArrowRight' : 'ArrowDown', back = o.horizontal ? 'ArrowLeft' : 'ArrowUp';
      if (e.key !== fwd && e.key !== back) return;
      e.preventDefault(); e.stopPropagation();
      bs[(i + (e.key === fwd ? 1 : -1) + bs.length) % bs.length].focus();
    });
    host.appendChild(el);
    strips = strips.filter(function (s) { return s.isConnected; });
    strips.push(el);
    paintStrip();
    return el;
  };
  function paintStrip() {
    strips.forEach(function (s) { [].forEach.call(s.querySelectorAll('.xp-tool'), function (b) { var on = b.getAttribute('data-tool') === cur; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }); });
  }

  /* ---------- Shared helpers for tools ---------- */
  function stageCanvas() { return env && env.ctx.E.sceneEl.querySelector('canvas.le-view'); }
  /* Colour on screen at a client point (0–1 per channel). */
  function sample(cx, cy) {
    var cv = stageCanvas(); if (!cv) return null;
    var r = cv.getBoundingClientRect();
    var x = Math.round((cx - r.left) * cv.width / r.width), y = Math.round((cy - r.top) * cv.height / r.height);
    if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return null;
    var d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
    return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255 };
  }
  T.sample = sample;
  /* Compact scrubbable option: "Size 80 px". */
  function opt(label, value, sc, onChange) {
    var n = h('<span class="xp-opt"><span class="xp-opt-l">' + esc(label) + '</span><span class="xp-num" role="slider" tabindex="0" aria-label="' + esc(label) + '" aria-valuemin="' + sc.min + '" aria-valuemax="' + sc.max + '"></span></span>');
    var num = n.querySelector('.xp-num'), v = value;
    var g = { start: function () {}, active: function () { return false; }, input: function () {}, end: function () {} };
    function paint() { if (!num.querySelector('input')) num.textContent = C.format(v, Object.assign({ min: 0 }, sc)); num.setAttribute('aria-valuenow', String(v)); }
    var s = C.scrubber(num, sc, function () { return v; }, function (x) { v = X.roundTo(clamp(x, sc.min, sc.max), sc.step); paint(); onChange(v); }, g, label);
    num.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { C.swallow(e); s.edit(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      C.swallow(e); v = X.roundTo(clamp(v + ((e.key === 'ArrowUp' || e.key === 'ArrowRight') ? 1 : -1) * C.stepFor(sc, e), sc.min, sc.max), sc.step); paint(); onChange(v);
    });
    n.set = function (x) { v = x; paint(); };
    paint();
    return n;
  }
  T.opt = opt;

  /* ---------- Built-in tools ---------- */
  T.register({ id: 'move', key: 'V', label: 'Move', icon: 'move', group: 'select', order: 10,
    activate: function (a) { var s = a.ctx.scene; if (s.tool() !== 'select' && s.tool() !== 'crop') s.setTool('select'); } });
  T.register({ id: 'crop', key: 'C', label: 'Crop and straighten', icon: 'crop', group: 'select', order: 20,
    activate: function (a) {
      var l = a.ctx.targetImage();
      if (!l) { a.toast('Select a photo to crop.'); setTimeout(function () { T.activate('move'); }, 0); return; }
      a.ctx.scene.select([l.id]);
      a.ctx.startCrop(l.id);
    },
    deactivate: function (a) { if (a.ctx.scene.tool() === 'crop') a.ctx.cmd('cropDone'); },
    options: function (a) {
      var l = a.ctx.targetImage(); if (!l) return null;
      var key = null;
      var wrap = h('<span class="xp-opts"></span>');
      wrap.appendChild(opt('Straighten', Math.round((((l.rotation || 0) + 540) % 360 - 180) * 10) / 10, { min: -45, max: 45, step: 0.1, unit: '°' }, function (v) { if (!key) key = X.gesture(); a.ctx.patch(l.id, { rotation: v }, key); clearTimeout(wrap._t); wrap._t = setTimeout(function () { key = null; }, 600); }));
      var done = h('<button type="button" class="sx-tb is-primary">' + X.ic('check', '') + '<span>Done</span></button>');
      done.addEventListener('click', function () { T.activate('move'); });
      wrap.appendChild(done);
      return wrap;
    } });

  /* Brush: paints the selected mask (a layer mask or an effect's mask) into an asset part. */
  var paintTarget = null, brush = null, work = null, ov = null, committing = Promise.resolve();
  X.on('paint-mask', function (t) { paintTarget = t; T.activate('brush'); if (t && brush) brush.set({ mode: t.erase ? 'erase' : 'paint' }); });
  function maskTargetFor(a) {
    var id = (paintTarget && paintTarget.layerId) || a.target();
    if (!id) return null;
    var fxId = paintTarget && paintTarget.layerId === id ? paintTarget.fxId : null;
    var m = X.doc.getMask(id, fxId) || { parts: [] };
    var part = paintTarget && paintTarget.layerId === id && paintTarget.part != null ? paintTarget.part : -1;
    if (part < 0 || !m.parts[part] || m.parts[part].kind !== 'asset') { part = -1; for (var i = m.parts.length - 1; i >= 0; i--) if (m.parts[i].kind === 'asset') { part = i; break; } }
    return { layerId: id, fxId: fxId, part: part };
  }
  function layerScale(l) { return Math.min(1, 2048 / Math.max(l.w, l.h)); }
  function prepareWork(a) {
    var t = maskTargetFor(a);
    if (!t) return null;
    var l = X.doc.layer(t.layerId), m = X.doc.getMask(t.layerId, t.fxId), s = layerScale(l);
    var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(l.w * s)); cv.height = Math.max(1, Math.round(l.h * s));
    var p = t.part >= 0 && m ? m.parts[t.part] : null;
    var src = p && p.asset && X.assetCanvas(p.asset);
    if (src) cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    var rad = (l.rotation || 0) * Math.PI / 180;
    work = { t: t, canvas: cv, s: s, l: l, map: function (x, y) {
      var cx = l.x + l.w / 2, cy = l.y + l.h / 2, dx = x - cx, dy = y - cy;
      var lx = dx * Math.cos(-rad) - dy * Math.sin(-rad) + l.w / 2, ly = dx * Math.sin(-rad) + dy * Math.cos(-rad) + l.h / 2;
      if (l.flipX) lx = l.w - lx; if (l.flipY) ly = l.h - ly;
      return { x: lx * s, y: ly * s };
    } };
    return work;
  }
  function showWork() {
    if (!work || !env) return;
    if (!ov || !ov.isConnected) { ov = document.createElement('canvas'); ov.className = 'xp-paint-ov'; ov.setAttribute('aria-hidden', 'true'); env.stage.appendChild(ov); }
    ov.width = work.canvas.width; ov.height = work.canvas.height;
    paintOv(null);
    placeOv();
  }
  function paintOv(rect) {
    if (!ov || !work) return;
    var cx = ov.getContext('2d'), r = rect || { x: 0, y: 0, w: ov.width, h: ov.height };
    var t = paintOv.tmp || (paintOv.tmp = document.createElement('canvas'));
    if (t.width < r.w || t.height < r.h) { t.width = Math.max(t.width, r.w); t.height = Math.max(t.height, r.h); }
    var tx = t.getContext('2d');
    tx.clearRect(0, 0, r.w, r.h); tx.globalCompositeOperation = 'source-over'; tx.drawImage(work.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    tx.globalCompositeOperation = 'source-in'; tx.fillStyle = 'rgba(229,52,62,.5)'; tx.fillRect(0, 0, r.w, r.h); tx.globalCompositeOperation = 'source-over';
    cx.clearRect(r.x, r.y, r.w, r.h); cx.drawImage(t, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  }
  function placeOv() {
    if (!ov || !work || !env) return;
    var b = env.box(work.t.layerId); if (!b) return;
    var hr = env.stage.getBoundingClientRect();
    ov.style.left = (b.x - hr.left) + 'px'; ov.style.top = (b.y - hr.top) + 'px'; ov.style.width = b.w + 'px'; ov.style.height = b.h + 'px';
    ov.style.transform = (b.rotation ? 'rotate(' + b.rotation + 'deg)' : '') + (work.l.flipX ? ' scaleX(-1)' : '') + (work.l.flipY ? ' scaleY(-1)' : '');
  }
  T.placeOverlays = placeOv;
  /* One stroke -> one asset -> one undo step. Strokes commit in order. */
  function commit(stroke) {
    if (!work) return;
    var w = work, snap = document.createElement('canvas');
    snap.width = w.canvas.width; snap.height = w.canvas.height; snap.getContext('2d').drawImage(w.canvas, 0, 0);
    var key = X.gesture();
    committing = committing.then(function () { return X.storeCanvas(snap, 'mask.png'); }).then(function (id) {
      var m = X.clone(X.doc.getMask(w.t.layerId, w.t.fxId)) || { parts: [] };
      var p = w.t.part >= 0 ? m.parts[w.t.part] : null;
      if (!p || p.kind !== 'asset') { p = X.maskPart('asset'); m.parts.push(p); w.t.part = m.parts.length - 1; }
      p.asset = id;
      X.doc.setMask(w.t.layerId, w.t.fxId, m, key);
      X.emit('stroke', { stroke: stroke, asset: id });
    }).catch(function (err) { console.error(err); if (env) env.ctx.toast('Could not save that brush stroke.'); });
  }
  T.whenCommitted = function () { return committing; };
  function brushOptions(a) {
    var wrap = h('<span class="xp-opts"></span>');
    var b = BRUSH;
    function save(p) { Object.assign(b, p); X.lsSet('le-expert-brush', b); if (brush) brush.set(p); }
    var size = opt('Size', b.size, { min: 1, max: 2000, step: 1, unit: 'px' }, function (v) { save({ size: v }); });
    var hard = opt('Hardness', Math.round(b.hardness * 100), { min: 0, max: 100, step: 1, unit: '%' }, function (v) { save({ hardness: v / 100 }); });
    wrap.appendChild(size); wrap.appendChild(hard);
    wrap.appendChild(opt('Flow', Math.round(b.flow * 100), { min: 1, max: 100, step: 1, unit: '%' }, function (v) { save({ flow: v / 100 }); }));
    wrap.appendChild(opt('Opacity', Math.round(b.opacity * 100), { min: 1, max: 100, step: 1, unit: '%' }, function (v) { save({ opacity: v / 100 }); }));
    wrap.appendChild(opt('Smoothing', Math.round(b.smoothing * 100), { min: 0, max: 95, step: 1, unit: '%' }, function (v) { save({ smoothing: v / 100 }); }));
    var pr = h('<button type="button" class="sx-tb xp-tb-tog" aria-pressed="' + !!b.pressure.size + '" title="Pen pressure changes the size">Pressure</button>');
    pr.addEventListener('click', function () { var on = pr.getAttribute('aria-pressed') !== 'true'; pr.setAttribute('aria-pressed', on ? 'true' : 'false'); save({ pressure: { size: on, flow: false } }); });
    wrap.appendChild(pr);
    var seg = C.create('segmented', { aria: 'Brush mode', options: [{ value: 'paint', label: 'Paint', icon: 'brush' }, { value: 'erase', label: 'Erase (X)', icon: 'erase' }], value: b.mode, onCommit: function (v) { save({ mode: v }); } });
    wrap.appendChild(seg.el.querySelector('.xp-seg'));
    var done = h('<button type="button" class="sx-tb is-primary">' + X.ic('check', '') + '<span>Done</span></button>');
    done.addEventListener('click', function () { T.activate('move'); });
    wrap.appendChild(done);
    wrap._sync = function () { size.set(b.size); hard.set(Math.round(b.hardness * 100)); seg.set(b.mode); };
    return wrap;
  }
  T.register({ id: 'brush', key: 'B', label: 'Brush and mask', icon: 'brush', group: 'paint', order: 30, cursor: 'none',
    activate: function (a) {
      var w = prepareWork(a);
      if (!w) { a.toast('Select a photo or an adjustment layer to paint its mask.'); setTimeout(function () { T.activate('move'); }, 0); return; }
      a.capture(true, 'none');
      brush = X.Brush.attach(a.layer, Object.assign({}, BRUSH, {
        toDoc: a.toDoc, zoom: a.zoom, cursorHost: a.layer,
        target: { canvas: w.canvas, map: w.map, scale: w.s }
      }));
      brush.on('move', function (s, seg) { if (seg.rect) paintOv(seg.rect); });
      brush.on('end', function (s) { paintOv(null); commit(s); });
      brush.on('cancel', function () { paintOv(null); });
      brush.on('options', function (o) { Object.assign(BRUSH, { size: o.size, hardness: o.hardness, mode: o.mode }); X.lsSet('le-expert-brush', BRUSH); var s = env && env.ctx.E.tool.querySelector('.xp-opts'); if (s && s._sync) s._sync(); });
      showWork();
      if (a.ctx.coarse() && !X.lsGet('le-expert-brush-tip', 0)) { X.lsSet('le-expert-brush-tip', 1); a.toast('Paint with one finger; pinch with two to zoom.'); }
    },
    deactivate: function (a) { if (brush) brush.detach(); brush = null; work = null; paintTarget = null; if (ov) ov.remove(); ov = null; a.capture(false); },
    options: brushOptions });
  T.brush = function () { return brush; };

  /* Placeholders the retouch team fills by registering the same id with replace: true. */
  [['heal', 'J', 'Heal', 'heal', 40], ['clone', 'S', 'Clone', 'clone', 41], ['dodge', 'O', 'Dodge and burn', 'dodge', 42], ['liquify', null, 'Liquify', 'liquify', 43]].forEach(function (p) {
    T.register({ id: p[0], key: p[1], label: p[2], icon: p[3], group: 'retouch', order: p[4], placeholder: true });
  });

  /* Gradient: drag on the photo to add a linear gradient to the selected layer's mask. */
  T.register({ id: 'gradient', key: 'G', label: 'Gradient mask', icon: 'gradient', group: 'paint', order: 50,
    activate: function (a) {
      a.capture(true, 'crosshair');
      var st = null;
      function down(e) {
        var id = a.target(); if (!id) { a.toast('Select a photo or an adjustment layer first.'); return; }
        e.preventDefault();
        var f = X.canvas.toFrac(id, e.clientX, e.clientY); if (!f) return;
        var m = X.clone(X.doc.getMask(id, null)) || { parts: [] };
        var p = X.maskPart('linear'); p.x0 = p.x1 = f.x; p.y0 = p.y1 = f.y;
        m.parts.push(p);
        st = { id: id, m: m, p: p, key: X.gesture(), pid: e.pointerId };
        try { a.layer.setPointerCapture(e.pointerId); } catch (err) {}
        X.interactive(true);
      }
      function move(e) {
        if (!st || e.pointerId !== st.pid) return;
        var f = X.canvas.toFrac(st.id, e.clientX, e.clientY); if (!f) return;
        st.p.x1 = Math.round(f.x * 1000) / 1000; st.p.y1 = Math.round(f.y * 1000) / 1000;
        if (e.shiftKey) { if (Math.abs(st.p.x1 - st.p.x0) > Math.abs(st.p.y1 - st.p.y0)) st.p.y1 = st.p.y0; else st.p.x1 = st.p.x0; }
        X.doc.setMask(st.id, null, st.m, st.key);
      }
      function up(e) {
        if (!st || e.pointerId !== st.pid) return;
        var s = st; st = null; X.interactive(false);
        if (Math.hypot(s.p.x1 - s.p.x0, s.p.y1 - s.p.y0) < 0.01) { s.p.y1 = Math.min(1, s.p.y0 + 0.3); X.doc.setMask(s.id, null, s.m, s.key); }
        X.emit('edit-mask', { layerId: s.id });
      }
      a.layer.addEventListener('pointerdown', down); a.layer.addEventListener('pointermove', move);
      a.layer.addEventListener('pointerup', up); a.layer.addEventListener('pointercancel', up);
      this._off = function () { a.layer.removeEventListener('pointerdown', down); a.layer.removeEventListener('pointermove', move); a.layer.removeEventListener('pointerup', up); a.layer.removeEventListener('pointercancel', up); };
    },
    deactivate: function (a) { if (this._off) this._off(); a.capture(false); },
    options: function () { return h('<span class="xp-opts"><span class="xp-opt-note">' + esc(X.say('Drag from where the effect is full to where it ends. Shift keeps it straight.', 'Drag from where the effect is full to where it ends.')) + '</span></span>'); } });

  /* Eyedropper and sampler: shows the colour under the pointer; also answers "pick a colour" requests from masks. */
  var sampleReq = null;
  X.on('sample', function (req) { sampleReq = req; T.activate('eyedropper'); });
  T.register({ id: 'eyedropper', key: 'I', label: 'Colour sampler', icon: 'pipette', group: 'paint', order: 60,
    activate: function (a) {
      a.capture(true, 'crosshair');
      var self = this;
      function show(rgb) {
        var out = env && env.ctx.E.tool.querySelector('.xp-sample');
        if (!out || !rgb) return;
        var hex = '#' + [rgb.r, rgb.g, rgb.b].map(function (v) { return ('0' + Math.round(v * 255).toString(16)).slice(-2); }).join('');
        var q = X.rgb2hsl ? X.rgb2hsl(rgb.r, rgb.g, rgb.b) : [0, 0, 0];
        out.innerHTML = '<i style="background:' + hex + '"></i><span>R ' + Math.round(rgb.r * 255) + ' G ' + Math.round(rgb.g * 255) + ' B ' + Math.round(rgb.b * 255) + '</span><span>H ' + Math.round(q[0]) + '° S ' + Math.round(q[1] * 100) + '% L ' + Math.round(q[2] * 100) + '%</span><b>' + hex.toUpperCase() + '</b>';
        out._hex = hex;
      }
      function move(e) { if (e.pointerType === 'mouse') show(sample(e.clientX, e.clientY)); }
      function down(e) {
        e.preventDefault();
        var rgb = sample(e.clientX, e.clientY);
        show(rgb);
        if (sampleReq) { var r = sampleReq; sampleReq = null; r.done(rgb); T.back(); return; }
        if (rgb && navigator.clipboard && a.ctx.coarse && !a.ctx.coarse()) { /* the hex is shown; copying is a button */ }
      }
      a.layer.addEventListener('pointermove', move); a.layer.addEventListener('pointerdown', down);
      self._off = function () { a.layer.removeEventListener('pointermove', move); a.layer.removeEventListener('pointerdown', down); };
    },
    deactivate: function (a) { if (this._off) this._off(); a.capture(false); if (sampleReq) { var r = sampleReq; sampleReq = null; r.done(null); } },
    options: function () {
      var w = h('<span class="xp-opts"><span class="xp-sample" aria-live="polite"><span>' + esc(sampleReq ? sampleReq.label + ': ' + X.say('click the photo', 'tap the photo') : X.say('Move over the photo to read colours; click to keep one.', 'Tap the photo to read a colour.')) + '</span></span><button type="button" class="sx-tb" data-copy>' + X.ic('copy', '') + '<span>Copy</span></button></span>');
      w.querySelector('[data-copy]').addEventListener('click', function () { var s = w.querySelector('.xp-sample'); if (s._hex && navigator.clipboard) navigator.clipboard.writeText(s._hex.toUpperCase()).then(function () { env.ctx.toast('Copied ' + s._hex.toUpperCase()); }, function () {}); });
      return w;
    } });
  T.register({ id: 'hand', key: 'H', label: 'Hand (hold Space)', icon: 'hand', group: 'view', order: 80,
    activate: function (a) { a.ctx.scene.setTool('hand'); },
    deactivate: function (a) { if (a.ctx.scene.tool() === 'hand') a.ctx.scene.setTool('select'); } });
  T.register({ id: 'zoom', key: 'Z', label: 'Zoom (Alt to zoom out)', icon: 'zoom', group: 'view', order: 90,
    activate: function (a) {
      a.capture(true, 'zoom-in');
      function down(e) {
        e.preventDefault();
        var s = a.ctx.scene, r = a.ctx.E.sceneEl.getBoundingClientRect();
        var z = s.zoom() * (e.altKey ? 1 / 1.5 : 1.5);
        a.ctx.S.autoFit = false; a.ctx.S.fitting = true;
        if (s._zoomAt) s._zoomAt(z, e.clientX - r.left, e.clientY - r.top); else s.zoomTo(z);
        a.ctx.S.fitting = false;
      }
      function key(e) { a.layer.style.cursor = e.altKey ? 'zoom-out' : 'zoom-in'; }
      a.layer.addEventListener('pointerdown', down);
      window.addEventListener('keydown', key); window.addEventListener('keyup', key);
      this._off = function () { a.layer.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); };
    },
    deactivate: function (a) { if (this._off) this._off(); a.capture(false); } });

  /* Targeted adjustment (curves, colour mixer): while a control asks for it, a drag on the photo moves that control. */
  var tat = null;
  X.on('target', function (t) {
    if (!api) return;
    if (tat) { tat.off(); tat = null; }
    if (!t) { if (REG[cur] && REG[cur].activate && cur !== 'move') return; api.capture(false); return; }
    api.capture(true, 'ns-resize');
    var st = null;
    function down(e) {
      e.preventDefault(); e.stopPropagation();
      var rgb = sample(e.clientX, e.clientY); if (!rgb) return;
      st = { y: e.clientY, pid: e.pointerId };
      try { api.layer.setPointerCapture(e.pointerId); } catch (err) {}
      if (t.kind === 'curve') {
        var ch = t.control.target.channel();
        var lv = ch === 'r' ? rgb.r : ch === 'g' ? rgb.g : ch === 'b' ? rgb.b : 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
        t.control.target.start(lv);
      } else t.control.target.start(X.rgb2hsl(rgb.r, rgb.g, rgb.b)[0]);
    }
    function move(e) { if (st && e.pointerId === st.pid) t.control.target.move(st.y - e.clientY); }
    function up(e) { if (st && e.pointerId === st.pid) { st = null; t.control.target.end(); } }
    api.layer.addEventListener('pointerdown', down, true); api.layer.addEventListener('pointermove', move);
    api.layer.addEventListener('pointerup', up); api.layer.addEventListener('pointercancel', up);
    tat = { off: function () { api.layer.removeEventListener('pointerdown', down, true); api.layer.removeEventListener('pointermove', move); api.layer.removeEventListener('pointerup', up); api.layer.removeEventListener('pointercancel', up); if (api && !(REG[cur] && /brush|gradient|eyedropper|zoom/.test(cur))) api.capture(false); } };
    api.toast(X.say('Drag up or down on the photo. Esc to stop.', 'Drag up or down on the photo.'));
  });

  /* ---------- Shortcuts ----------
     Every binding, for the sheet and for the collision test. scope: 'tool' | 'brush' | 'view' | 'layers' | 'panel' | 'edit'. */
  T.bindings = function () {
    var out = T.list().filter(function (t) { return t.key; }).map(function (t) { return { keys: t.key, does: t.label + (t.placeholder ? ' (coming soon)' : ''), scope: 'Tools', combo: t.key.toLowerCase() }; });
    out = out.concat([
      { keys: '[  ]', does: 'Brush smaller / bigger', scope: 'Brush', combo: '[|]' },
      { keys: 'Shift [  ]', does: 'Brush softer / harder', scope: 'Brush', combo: 'shift+[|shift+]' },
      { keys: 'X', does: 'Swap paint and erase', scope: 'Brush', combo: 'x' },
      { keys: 'Shift + click', does: 'Straight line from the last stroke', scope: 'Brush', combo: 'shift+click' },
      { keys: '\\', does: 'Before / after', scope: 'View', combo: '\\' },
      { keys: 'Y', does: 'Compare: split, side by side, off', scope: 'View', combo: 'y' },
      { keys: 'Ctrl 0', does: 'Fit to screen', scope: 'View', combo: 'mod+0' },
      { keys: 'Ctrl 1  ·  Ctrl Alt 0', does: '100%', scope: 'View', combo: 'mod+1|mod+alt+0' },
      { keys: 'Ctrl +  ·  Ctrl −', does: 'Zoom in / out', scope: 'View', combo: 'mod+=|mod+-' },
      { keys: 'Space + drag', does: 'Pan', scope: 'View', combo: 'space' },
      { keys: 'Ctrl [  ]', does: 'Layer down / up', scope: 'Layers', combo: 'mod+[|mod+]' },
      { keys: 'Ctrl Shift [  ]', does: 'Layer to bottom / top', scope: 'Layers', combo: 'mod+shift+[|mod+shift+]' },
      { keys: 'Ctrl D', does: 'Duplicate layer', scope: 'Layers', combo: 'mod+d' },
      { keys: 'Del', does: 'Delete layer', scope: 'Layers', combo: 'delete' },
      { keys: 'F2', does: 'Rename layer (in the layers panel)', scope: 'Layers', combo: 'f2' },
      { keys: 'Alt ↑ ↓', does: 'Move layer (in the layers panel)', scope: 'Layers', combo: 'alt+arrowup|alt+arrowdown' },
      { keys: 'Shift F10', does: 'Layer menu (in the layers panel)', scope: 'Layers', combo: 'shift+f10' },
      { keys: 'Alt + click', does: 'Show only this section', scope: 'Panels', combo: 'alt+click' },
      { keys: 'Double-click', does: 'Reset a slider (on its label or track)', scope: 'Panels', combo: 'dblclick' },
      { keys: '← →  (Shift ×10, Alt ÷10)', does: 'Change the focused slider', scope: 'Panels', combo: 'arrows' },
      { keys: 'Enter', does: 'Type a value (focused slider)', scope: 'Panels', combo: 'enter' },
      { keys: 'Drag the number', does: 'Scrub a value (Shift finer)', scope: 'Panels', combo: 'scrub' },
      { keys: 'Ctrl Z  ·  Ctrl Shift Z', does: 'Undo / redo', scope: 'Edit', combo: 'mod+z|mod+shift+z' },
      { keys: 'Esc', does: 'Stop the current tool', scope: 'Edit', combo: 'escape' },
      { keys: '?', does: 'This sheet', scope: 'Edit', combo: '?' }
    ]);
    return out;
  };
  /* Keys the expert workspace takes from the simple studio, with what they did there. */
  T.conflicts = [
    ['C', 'added an ellipse', 'Crop'], ['[ ]', 'moved the layer down / up', 'Brush size (layer order is Ctrl [ ])'],
    ['\\', 'compare while held', 'Before / after toggle (Y for split)'], ['R, P', 'added a rectangle, opened Draw', 'Red-eye, Patch'], ['L', 'added a line', 'Nothing (no accidental shapes)'],
    ['Ctrl 1', 'the browser switched to tab 1', '100% (Ctrl Alt 0 where the browser keeps Ctrl 1)']
  ];

  function typing(t) { return t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable); }
  /* Called by the workspace's capture-phase keydown listener. Returns true when the key was used. */
  T.handleKey = function (e) {
    var c = env && env.ctx; if (!c) return false;
    var k = e.key, lk = (k || '').toLowerCase(), mod = e.ctrlKey || e.metaKey, t = e.target;
    if (typing(t)) return false;
    if (c.E.modal && !c.E.modal.hidden) return false;
    if (k === 'Escape') {
      if (tat) { X.emit('target', null); return true; }
      if (cur && cur !== 'move' && cur !== 'crop') { T.activate('move'); return true; }
      return false;
    }
    /* Layer order */
    if (mod && (k === '[' || k === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      var up = k === ']' || e.code === 'BracketRight';
      var ids = c.sel(); if (!ids.length) return true;
      var ord = ids.slice(); if (up) ord.reverse();
      ord.forEach(function (id) { c.scene.order(id, e.shiftKey ? (up ? 'front' : 'back') : (up ? 'forward' : 'backward')); });
      return true;
    }
    if (mod && !e.shiftKey && (k === '1' || (e.altKey && k === '0') || (e.altKey && e.code === 'Digit0'))) { c.S.fitting = true; c.scene.zoomTo(1); c.S.fitting = false; c.S.autoFit = false; return true; }
    if (mod || e.altKey) return false;
    if (REG[cur] && REG[cur].onKey && REG[cur].onKey(e, api)) return true;   /* a tool's own brush keys ([ ] X) */
    if (k === '[' || k === ']' || k === '{' || k === '}' || e.code === 'BracketLeft' || e.code === 'BracketRight') {
      var bigger = k === ']' || k === '}' || e.code === 'BracketRight';
      if (brush) { if (e.shiftKey) { if (bigger) brush.harder(); else brush.softer(); } else if (bigger) brush.bigger(); else brush.smaller(); }
      else { var b = BRUSH; if (e.shiftKey) b.hardness = clamp(Math.round((b.hardness + (bigger ? 0.1 : -0.1)) * 10) / 10, 0, 1); else b.size = clamp(bigger ? Math.round(b.size * 1.12) : Math.round(b.size / 1.12), 1, 2000); X.lsSet('le-expert-brush', b); }
      return true;
    }
    if (lk === 'x' && !e.shiftKey) { if (brush) brush.swap(); else BRUSH.mode = BRUSH.mode === 'erase' ? 'paint' : 'erase'; X.lsSet('le-expert-brush', BRUSH); return true; }
    if (k === '?' || (k === '/' && e.shiftKey)) { X.shortcutSheet(); return true; }
    if (e.shiftKey) return false;
    var hit = T.list().filter(function (x) { return x.key && x.key.toLowerCase() === lk; })[0];
    if (hit) { T.activate(hit.id); return true; }
    return lk === 'r' || lk === 'l' || lk === 'p';   /* the simple studio's shape keys never add a shape here */
  };

  /* ---------- Shortcut sheet (searchable) ---------- */
  X.shortcutSheet = function () {
    var c = global.LEStudio;
    var rows = T.bindings();
    var node = h('<div class="xp-keys-sheet"><label class="xp-search">' + X.ic('search') + '<input type="search" placeholder="Search shortcuts" aria-label="Search shortcuts" autocomplete="off"></label><div class="xp-keys-list"></div>' +
      '<details class="xp-keys-conf"><summary>Keys that differ from the simple studio</summary><ul>' + T.conflicts.map(function (r) { return '<li><kbd>' + esc(r[0]) + '</kbd> ' + esc(r[2]) + ' <small>(was: ' + esc(r[1]) + ')</small></li>'; }).join('') + '</ul></details></div>');
    var list = node.querySelector('.xp-keys-list'), input = node.querySelector('input');
    function draw(q) {
      q = (q || '').toLowerCase();
      var html = '', last = null;
      rows.forEach(function (r) {
        if (q && (r.does + ' ' + r.keys + ' ' + r.scope).toLowerCase().indexOf(q) < 0) return;
        if (r.scope !== last) { html += '<h4>' + esc(r.scope) + '</h4>'; last = r.scope; }
        html += '<div class="xp-key"><span>' + esc(r.does) + '</span><kbd>' + esc(r.keys) + '</kbd></div>';
      });
      list.innerHTML = html || '<p class="xp-note">Nothing matches.</p>';
    }
    input.addEventListener('input', function () { draw(input.value); });
    input.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape' && c) c.closeModal(); });
    draw('');
    if (c && c.openModal) { c.openModal('Expert <em>shortcuts</em>', node, { wide: true }); setTimeout(function () { input.focus(); }, 30); }
    return node;
  };
})(window);
