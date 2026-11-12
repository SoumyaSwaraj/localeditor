/* LocalEditor Expert: Liquify brush and the face-aware liquify panel control, for the retouching pack.
 * Liquify: each stroke is one record in the layer's "liquify" entry (forward warp, twirl, pucker, bloat, push left,
 * reconstruct, smooth, freeze, thaw). While dragging, the stroke so far is written at most once per frame under one gesture
 * key (draft rendering); the stroke's end is the same undo step. Holding still repeats the last point for the tools that
 * act in place. The face sliders are the develop panel's own controls for "face-liquify"; this file adds the control that
 * finds faces on this device and fills the anchors ("face-rig"). */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.tools) return;
  var T = X.tools, h = X.h, esc = X.esc;
  var TOOLS = [['forward', 'Forward warp'], ['reconstruct', 'Reconstruct'], ['smooth', 'Smooth'], ['twirl-cw', 'Twirl clockwise'], ['twirl-ccw', 'Twirl counter-clockwise'], ['pucker', 'Pucker'], ['bloat', 'Bloat'], ['push-left', 'Push left'], ['freeze', 'Freeze mask'], ['thaw', 'Thaw mask']];
  var HOLD = { 'twirl-cw': 1, 'twirl-ccw': 1, pucker: 1, bloat: 1, reconstruct: 1, smooth: 1 };
  var OPT = X.lsGet('le-expert-liquify', { tool: 'forward', size: 120, pressure: 0.6, density: 0.5 });
  var st = null;

  function base() { return X.rtParams(st.id, 'liquify'); }
  function rec(points) { var l = X.doc.layer(st.id); return { tool: OPT.tool, size: Math.max(0.002, OPT.size / 2 / Math.max(l.w, l.h)), pressure: OPT.pressure, density: OPT.density, points: points }; }
  function frac(q) { var f = X.rtFrac(X.doc.layer(st.id), q.x, q.y); return [f.x, f.y, q.p == null ? 1 : q.p]; }
  /* At most one document write per frame while dragging; never waits for a render. */
  var flush = X.rafThrottle(function () {
    if (!st || !st.stroke) return;
    var R = global.LE.fx.retouch;
    X.rtWrite(st.id, 'liquify', R.liquify.add(st.p0, rec(st.stroke.slice(0, 1024))), st.key);
  });
  T.register({ id: 'liquify', key: null, label: 'Liquify', icon: 'liquify', group: 'retouch', order: 43, replace: true, cursor: 'none',
    activate: function (a) {
      var l = X.rtTarget(a, 'liquify'); if (!l) { setTimeout(function () { T.activate('move'); }, 0); return; }
      st = { a: a, id: l.id };
      a.capture(true, 'none');
      global.LE.fxBoot.load().then(function () {
        if (!st) return;
        var b = st.brush = X.Brush.attach(a.layer, { toDoc: a.toDoc, zoom: a.zoom, cursorHost: a.layer, target: null, size: OPT.size, hardness: 0.3, spacing: 0.1, smoothing: 0.2, pressure: { size: false, flow: true } });
        b.on('start', function (s) {
          st.p0 = base(); st.key = X.gesture(); st.stroke = s.points.map(frac);
          X.interactive(true);
          if (HOLD[OPT.tool]) st.hold = setInterval(function () { if (st && st.stroke && st.stroke.length < 1024) { st.stroke.push(st.stroke[st.stroke.length - 1].slice()); flush(); } }, 60);
        });
        b.on('move', function (s) { if (!st.stroke) return; st.stroke = s.points.map(frac); flush(); });
        function end(s, cancel) {
          clearInterval(st.hold);
          if (st.stroke && !cancel) { if (s && s.points.length && !HOLD[OPT.tool]) st.stroke = s.points.map(frac); flush(); flush.flush && flush.flush(); }
          st.stroke = null; X.interactive(false);
        }
        b.on('end', function (s) { end(s, false); });
        b.on('cancel', function () { end(null, true); });
        b.on('options', function (o) { OPT.size = o.size; X.lsSet('le-expert-liquify', OPT); });
      });
    },
    deactivate: function (a) { if (st) { clearInterval(st.hold); if (st.brush) st.brush.detach(); } st = null; a.capture(false); },
    onKey: function (e) {
      if (!st || !st.brush) return false;
      var k = e.key;
      if (k === '[' || k === ']') { if (k === ']') st.brush.bigger(); else st.brush.smaller(); return true; }
      return false;
    },
    options: function () {
      var w = h('<span class="xp-opts"></span>'), C = X.controls;
      function save(o) { Object.assign(OPT, o); X.lsSet('le-expert-liquify', OPT); if (st && st.brush) st.brush.set({ size: OPT.size }); }
      var sel = C.create('choice', { label: 'Tool', schema: { options: TOOLS.map(function (t) { return { value: t[0], label: t[1] }; }) }, value: OPT.tool, onCommit: function (v) { save({ tool: v }); } });
      w.appendChild(sel.el);
      w.appendChild(T.opt('Size', OPT.size, { min: 4, max: 3000, step: 1, unit: 'px' }, function (v) { save({ size: v }); }));
      w.appendChild(T.opt('Pressure', Math.round(OPT.pressure * 100), { min: 1, max: 100, step: 1, unit: '%' }, function (v) { save({ pressure: v / 100 }); }));
      w.appendChild(T.opt('Density', Math.round(OPT.density * 100), { min: 0, max: 100, step: 1, unit: '%' }, function (v) { save({ density: v / 100 }); }));
      var all = h('<button type="button" class="sx-tb" title="Remove every liquify stroke on this photo">Restore all</button>');
      all.addEventListener('click', function () { if (!st) return; var e = X.doc.firstOfType(st.id, 'liquify'); if (e) X.doc.removeFx(st.id, e.id, X.gesture()); });
      w.appendChild(all);
      var done = h('<button type="button" class="sx-tb is-primary">' + X.ic('check', '') + '<span>Done</span></button>');
      done.addEventListener('click', function () { T.activate('move'); });
      w.appendChild(done);
      return w;
    } });

  /* ---------- "face-rig": finds faces on this device and stores the anchors the face sliders read ---------- */
  function loadMaps() {
    if (global.LE.maps && global.LE.maps.face) return Promise.resolve(global.LE.maps);
    var src = new URL('../../../labs/maps/maps.js', X.base).href;
    return (global.LE.lazy ? global.LE.lazy(src) : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); })).then(function () {
      if (global.LE.fx && global.LE.fx.retouch) global.LE.fx.retouch.installFaceAlias();
      return global.LE.maps;
    });
  }
  X.controls.register('face-rig', function (spec) {
    var el = h('<div class="xp-row xp-facerig"><div class="xp-row-l">Face</div><div class="xp-facerig-b"><button type="button" class="sx-tb" data-find>' + X.ic('search', '') + '<span>Find faces</span></button><select data-face aria-label="Face" hidden></select><p class="xp-note" data-msg>Runs on this device. Face points stay in this design.</p></div></div>');
    var btn = el.querySelector('[data-find]'), sel = el.querySelector('[data-face]'), msg = el.querySelector('[data-msg]'), value = spec.value;
    function layer() { var id = spec.layerId && spec.layerId(); return id ? X.doc.layer(id) : null; }
    function faces() { var R = global.LE.fx && global.LE.fx.retouch, l = layer(); return R && l ? R.face.list(l) : []; }
    function fill() {
      var n = faces().length;
      sel.hidden = n < 2;
      sel.innerHTML = Array.from({ length: n }, function (_, i) { return '<option value="' + i + '">Face ' + (i + 1) + '</option>'; }).join('');
      if (n) msg.textContent = n === 1 ? 'One face found. Move a slider to reshape it.' : n + ' faces found; choose one.';
    }
    function use(i) {
      var R = global.LE.fx.retouch, l = layer(); if (!l) return;
      var r = R.face.rig(l, i); if (r) { value = r.rig; spec.onCommit(r.rig, X.gesture()); }
    }
    sel.addEventListener('change', function () { use(Number(sel.value)); });
    btn.addEventListener('click', function () {
      var l = layer(); if (!l) return;
      if (faces().length) { fill(); use(Number(sel.value) || 0); return; }
      btn.disabled = true; msg.textContent = 'Finding faces on this device…';
      loadMaps().then(function (mp) {
        var img = X.assetCanvas(l.src); if (!img) throw new Error('The photo is not loaded yet.');
        return mp.face(img, { maxFaces: 8, parts: false, blendshapes: false }).then(function (list) {
          if (!list.length) { msg.textContent = 'No face found. Faces turned far away or covered are often missed.'; return; }
          var key = X.gesture(), maps = Object.assign({}, l.maps || {}, { face: list.map(function (f) { return mp.pack.face(f); }) });
          X.doc.patchLayer(l.id, { maps: maps }, key);
          fill(); use(0);
        });
      }).catch(function (err) { msg.textContent = (err && err.message) || 'Faces could not be found.'; }).then(function () { btn.disabled = false; });
    });
    setTimeout(fill, 0);
    return { el: el, get: function () { return value; }, set: function (v) { value = v; }, focus: function () { btn.focus(); }, destroy: function () {} };
  });
})(window);
