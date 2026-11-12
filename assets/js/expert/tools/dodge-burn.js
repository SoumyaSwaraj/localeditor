/* LocalEditor Expert: Dodge and burn (O) for the retouching pack. Paints the mask of a "dodge-burn" entry on the selected
 * photo: one entry per mode (dodge, burn, sponge + / −), each with its own painted map (an asset mask part, the workspace's
 * supported brush form). X swaps dodge and burn. One stroke = one asset = one undo step. The photo itself is never painted. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.tools) return;
  var T = X.tools, h = X.h;
  var OPT = X.lsGet('le-expert-dodge', { size: 80, hardness: 0.2, flow: 0.25, mode: 'dodge', exposure: 30, range: 'midtones', protect: true });
  var EMPTY = { kind: 'radial', mode: 'add', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, density: 0 };   /* selects nothing: the map starts empty */
  var st = null;

  function entryFor(id, mode, key) {
    var list = X.doc.fx(id), e = null;
    for (var i = 0; i < list.length; i++) if (list[i].type === 'dodge-burn' && list[i].p && list[i].p.mode === mode) { e = list[i]; break; }
    if (e) return e.id;
    var fxId = X.doc.addFx(id, 'dodge-burn', { p: { mode: mode, exposure: OPT.exposure, range: OPT.range, protect: OPT.protect } }, key);
    X.doc.setMask(id, fxId, { on: true, invert: false, parts: [X.clone(EMPTY)] }, key);
    return fxId;
  }
  function prepare() {
    var l = X.doc.layer(st.id), s = Math.min(1, 2048 / Math.max(l.w, l.h));
    var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(l.w * s)); cv.height = Math.max(1, Math.round(l.h * s));
    var e = st.fxId && X.doc.entry(st.id, st.fxId), parts = e && e.mask ? e.mask.parts : [];
    for (var i = parts.length - 1; i >= 0; i--) if (parts[i].kind === 'asset') { var src = X.assetCanvas(parts[i].asset); if (src) cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height); break; }
    st.canvas = cv; st.s = s;
    if (st.brush) st.brush.setTarget({ canvas: cv, scale: s, map: function (x, y) { var f = X.rtFrac(X.doc.layer(st.id), x, y); return { x: f.x * cv.width, y: f.y * cv.height }; } });
  }
  function setMode(m) {
    OPT.mode = m; X.lsSet('le-expert-dodge', OPT);
    if (!st) return;
    st.fxId = null;
    var list = X.doc.fx(st.id);
    for (var i = 0; i < list.length; i++) if (list[i].type === 'dodge-burn' && list[i].p && list[i].p.mode === m) st.fxId = list[i].id;
    prepare();
    var o = global.document.querySelector('.xp-opts [data-dbmode]'); if (o && o._set) o._set(m);
  }
  function commit() {
    var snap = document.createElement('canvas'); snap.width = st.canvas.width; snap.height = st.canvas.height; snap.getContext('2d').drawImage(st.canvas, 0, 0);
    var id = st.id, key = X.gesture(), mode = OPT.mode;
    st.chain = (st.chain || Promise.resolve()).then(function () { return X.storeCanvas(snap, 'dodge-burn.png'); }).then(function (asset) {
      var fxId = entryFor(id, mode, key), e = X.doc.entry(id, fxId), m = X.clone(e && e.mask) || { parts: [X.clone(EMPTY)] }, part = null;
      for (var i = m.parts.length - 1; i >= 0; i--) if (m.parts[i].kind === 'asset') { part = m.parts[i]; break; }
      if (!part) { part = { kind: 'asset', mode: 'add', invert: false, feather: 0.25, density: 1, blur: 0 }; m.parts.push(part); }
      part.asset = asset;
      X.doc.setMask(id, fxId, m, key);
      if (st && st.id === id && OPT.mode === mode) st.fxId = fxId;
    }).catch(function (err) { console.error(err); });
  }
  T.register({ id: 'dodge', key: 'O', label: 'Dodge and burn', icon: 'dodge', group: 'retouch', order: 42, replace: true, cursor: 'none',
    activate: function (a) {
      var l = X.rtTarget(a, 'dodge and burn'); if (!l) { setTimeout(function () { T.activate('move'); }, 0); return; }
      st = { a: a, id: l.id, fxId: null };
      a.capture(true, 'none');
      global.LE.fxBoot.load().then(function () {
        if (!st) return;
        st.brush = X.Brush.attach(a.layer, { toDoc: a.toDoc, zoom: a.zoom, cursorHost: a.layer, target: null, size: OPT.size, hardness: OPT.hardness, flow: OPT.flow, pressure: { size: false, flow: true } });
        st.brush.on('end', function () { commit(); });
        st.brush.on('options', function (o) { OPT.size = o.size; OPT.hardness = o.hardness; X.lsSet('le-expert-dodge', OPT); });
        setMode(OPT.mode);
      });
    },
    deactivate: function (a) { if (st && st.brush) st.brush.detach(); st = null; a.capture(false); },
    onKey: function (e) {
      if (!st || !st.brush) return false;
      var k = e.key;
      if ((k || '').toLowerCase() === 'x' && !e.shiftKey) { setMode(OPT.mode === 'dodge' ? 'burn' : OPT.mode === 'burn' ? 'dodge' : OPT.mode === 'saturate' ? 'desaturate' : 'saturate'); st.a.toast(OPT.mode === 'dodge' ? 'Dodge' : OPT.mode === 'burn' ? 'Burn' : 'Sponge'); return true; }
      if (k === '[' || k === ']' || k === '{' || k === '}') { if (e.shiftKey) { if (k === '}' || k === ']') st.brush.harder(); else st.brush.softer(); } else if (k === ']') st.brush.bigger(); else st.brush.smaller(); return true; }
      return false;
    },
    options: function (a) {
      var w = h('<span class="xp-opts"></span>'), C = X.controls;
      function save(o) { Object.assign(OPT, o); X.lsSet('le-expert-dodge', OPT); if (st && st.brush) st.brush.set({ size: OPT.size, hardness: OPT.hardness, flow: OPT.flow }); }
      function params(o) { save(o); if (st && st.fxId) X.doc.setParams(st.id, st.fxId, o, X.gesture()); }
      var seg = C.create('segmented', { aria: 'Mode', options: [{ value: 'dodge', label: 'Dodge' }, { value: 'burn', label: 'Burn' }, { value: 'saturate', label: 'Sponge +' }, { value: 'desaturate', label: 'Sponge −' }], value: OPT.mode, onCommit: function (v) { setMode(v); } });
      var sg = seg.el.querySelector('.xp-seg') || seg.el; sg.setAttribute('data-dbmode', ''); sg._set = function (v) { seg.set(v); };
      w.appendChild(sg);
      w.appendChild(T.opt('Size', OPT.size, { min: 2, max: 2000, step: 1, unit: 'px' }, function (v) { save({ size: v }); }));
      w.appendChild(T.opt('Hardness', Math.round(OPT.hardness * 100), { min: 0, max: 100, step: 1, unit: '%' }, function (v) { save({ hardness: v / 100 }); }));
      w.appendChild(T.opt('Flow', Math.round(OPT.flow * 100), { min: 1, max: 100, step: 1, unit: '%' }, function (v) { save({ flow: v / 100 }); }));
      w.appendChild(T.opt('Exposure', OPT.exposure, { min: 1, max: 100, step: 1, unit: '%' }, function (v) { params({ exposure: v }); }));
      var rg = C.create('choice', { label: 'Range', schema: { options: [{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Mid-tones' }, { value: 'highlights', label: 'Highlights' }, { value: 'all', label: 'All' }] }, value: OPT.range, onCommit: function (v) { params({ range: v }); } });
      w.appendChild(rg.el);
      var pr = h('<button type="button" class="sx-tb xp-tb-tog" aria-pressed="' + !!OPT.protect + '" title="Keep hue; avoid clipping">Protect tones</button>');
      pr.addEventListener('click', function () { var on = pr.getAttribute('aria-pressed') !== 'true'; pr.setAttribute('aria-pressed', String(on)); params({ protect: on }); });
      w.appendChild(pr);
      var done = h('<button type="button" class="sx-tb is-primary">' + X.ic('check', '') + '<span>Done</span></button>');
      done.addEventListener('click', function () { T.activate('move'); });
      w.appendChild(done);
      return w;
    } });
})(window);
