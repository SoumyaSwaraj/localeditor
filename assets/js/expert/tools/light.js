/* LocalEditor Expert: the Light tool (K), X6. On-canvas handles for the relight pack's lights (assets/js/fx/le-fx-relight.js):
 * each light's position (ring sized by its softness), the aim of a spot (with a direction line), the direction line of a sun,
 * the light-rays source and the catchlight eye points. The options bar: Add light, Depth map (makes one on this device when the
 * layer has none), Show depth (an overlay of the depth map), and a small top-down lighting diagram. Writes go through
 * LE.expert.doc with one gesture key per drag, so a drag is one undo step and renders in draft quality while it moves. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var h = X.h, esc = X.esc, LE = global.LE;
  var TYPES = ['relight', 'light-rays', 'catchlight'];
  var ICON = '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>';
  var st = { hd: null, off: null, layerId: null, key: null, overlay: false, ovEl: null, api: null };

  function scene() { return st.api && st.api.ctx && st.api.ctx.scene; }
  function entries(id) { return (X.doc.fx(id) || []).filter(function (e) { return TYPES.indexOf(e.type) >= 0; }); }
  function pt(v, d) { return v && typeof v.x === 'number' ? v : d; }

  function spec(id) {
    var points = [], lines = [], ellipses = [], n = 0;
    entries(id).forEach(function (e) {
      var p = e.p || {};
      if (e.type === 'relight') {
        n++;
        var pos = pt(p.position, { x: 0.25, y: 0.2 }), lab = 'Light ' + n;
        points.push({ id: e.id + '|position', x: pos.x, y: pos.y, label: lab, ring: true });
        ellipses.push({ c: e.id + '|position', rx: 0.02 + (p.softness == null ? 0.4 : p.softness) * 0.06, ry: 0.02 + (p.softness == null ? 0.4 : p.softness) * 0.06 });
        if (p.type === 'spot') { var aim = pt(p.aim, { x: 0.5, y: 0.5 }); points.push({ id: e.id + '|aim', x: aim.x, y: aim.y, label: lab + ' aim' }); lines.push([e.id + '|position', e.id + '|aim', 'line']); }
        else if (p.type === 'directional') { points.push({ id: e.id + '|centre', x: 0.5, y: 0.5, label: lab + ' (centre)' }); lines.push([e.id + '|position', e.id + '|centre', 'line']); }
      } else if (e.type === 'light-rays') {
        var s = pt(p.source, { x: 0.75, y: 0.08 }); points.push({ id: e.id + '|source', x: s.x, y: s.y, label: 'Rays source', ring: true });
      } else if (e.type === 'catchlight' && p.intensity > 0) {
        var l = pt(p.left, { x: 0.42, y: 0.4 }), r = pt(p.right, { x: 0.58, y: 0.4 });
        points.push({ id: e.id + '|left', x: l.x, y: l.y, label: 'Catchlight, eye 1' }, { id: e.id + '|right', x: r.x, y: r.y, label: 'Catchlight, eye 2' });
      }
    });
    return { layerId: id, points: points, lines: lines, ellipses: ellipses, onDrag: onDrag };
  }
  function onDrag(hid, x, y, phase) {
    var parts = hid.split('|'), id = st.layerId;
    if (!id || parts[1] === 'centre') return;
    if (phase === 'start') st.key = X.gesture();
    var v = { x: Math.round(Math.max(-1, Math.min(2, x)) * 1000) / 1000, y: Math.round(Math.max(-1, Math.min(2, y)) * 1000) / 1000 }, patch = {};
    patch[parts[1]] = v;
    X.doc.setParams(id, parts[0], patch, st.key || X.gesture());
    if (phase === 'key') st.key = null;
  }
  function refresh() {
    var id = st.api && st.api.target();
    st.layerId = id;
    if (!X.canvas || !X.canvas.handles) return;
    if (!id) { if (st.hd) { st.hd.destroy(); st.hd = null; } return; }
    var s = spec(id);
    if (st.hd && X.canvas.current && X.canvas.current() && X.canvas.current().layerId === id) st.hd.update(s); else st.hd = X.canvas.handles(s);
    paintOverlay(); paintDiagram();
  }

  /* ---------- Depth overlay ---------- */
  function depthCanvas(l) {
    var a = l && l.maps && l.maps.depth && l.maps.depth.asset, s = scene();
    var rec = a && s && s._assets && s._assets[a], c = rec && (rec.canvas || rec.image);
    if (!c || !LE.maps || !LE.maps.unpack) return null;
    if (c._lePreview) return c._lePreview;
    var d = LE.maps.unpack.depth(c), v = document.createElement('canvas'); v.width = d.width; v.height = d.height;
    var im = v.getContext('2d').createImageData(d.width, d.height);
    for (var i = 0; i < d.depth.length; i++) { var g = Math.round(d.depth[i] * 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = g; im.data[i * 4 + 3] = 255; }
    v.getContext('2d').putImageData(im, 0, 0);
    try { c._lePreview = v; } catch (e) { /* frozen */ }
    return v;
  }
  function paintOverlay() {
    if (st.ovEl) { st.ovEl.remove(); st.ovEl = null; }
    if (!st.overlay || !st.layerId || !X.canvas._host) return;
    var host = X.canvas._host(), b = X.canvas._box(st.layerId), l = X.doc.layer(st.layerId), dc = depthCanvas(l);
    if (!host || !b || !dc) return;
    var hr = host.getBoundingClientRect(), img = document.createElement('img');
    img.src = dc.toDataURL(); img.alt = '';
    img.className = 'xp-depth-ov';
    img.style.cssText = 'position:absolute;pointer-events:none;opacity:.85;mix-blend-mode:normal;left:' + (b.x - hr.left) + 'px;top:' + (b.y - hr.top) + 'px;width:' + b.w + 'px;height:' + b.h + 'px;transform:rotate(' + (b.rotation || 0) + 'deg);';
    host.appendChild(img); st.ovEl = img;
  }

  /* ---------- Top-down lighting diagram: x across the photo, height towards the camera (bottom) ---------- */
  var diag = null;
  function paintDiagram() {
    if (!diag) return;
    var W = 84, H = 40, out = '<rect x="0.5" y="0.5" width="' + (W - 1) + '" height="' + (H - 1) + '" rx="6" fill="none" stroke="currentColor" stroke-opacity=".25"/>' +
      '<circle cx="' + W / 2 + '" cy="12" r="5" fill="none" stroke="currentColor" stroke-opacity=".6"/><path d="M' + (W / 2 - 4) + ' ' + (H - 3) + 'h8" stroke="currentColor" stroke-opacity=".6"/>';
    entries(st.layerId || '').forEach(function (e) {
      if (e.type !== 'relight' || !(e.p && e.p.intensity > 0)) return;
      var x = 6 + Math.max(0, Math.min(1, (e.p.position || { x: 0.5 }).x)) * (W - 12), z = 12 + Math.max(-0.6, Math.min(1.6, e.p.height || 0)) / 1.6 * (H - 16);
      out += '<circle cx="' + x.toFixed(1) + '" cy="' + z.toFixed(1) + '" r="3.5" fill="var(--accent)"/><path d="M' + x.toFixed(1) + ' ' + z.toFixed(1) + 'L' + W / 2 + ' 12" stroke="var(--accent)" stroke-opacity=".5"/>';
    });
    diag.innerHTML = out;
  }

  var DEF = {
    id: 'light', key: 'K', label: 'Light', icon: ICON, group: 'paint', order: 58,
    activate: function (a) {
      st.api = a; refresh();
      var u1 = X.on('fx', function () { refresh(); }), u2 = X.on('target', function () { refresh(); });
      var s = scene(), u3 = s && s.on ? s.on('change', function () { if (st.hd) { st.hd.update(spec(st.layerId)); paintDiagram(); } }) : null, u4 = s && s.on ? s.on('select', function () { refresh(); }) : null;
      st.off = function () { u1(); u2(); if (typeof u3 === 'function') u3(); if (typeof u4 === 'function') u4(); };
      if (st.layerId && !entries(st.layerId).length) a.toast(X.say('Add a light, then drag it on the photo.', 'Add a light, then drag it on the photo.'));
    },
    deactivate: function () {
      if (st.off) st.off(); st.off = null;
      if (st.hd) { st.hd.destroy(); st.hd = null; }
      if (st.ovEl) { st.ovEl.remove(); st.ovEl = null; }
      st.api = null;
    },
    options: function (a) {
      var w = h('<span class="xp-opts">' +
        '<button type="button" class="sx-tb" data-add>' + X.ic('plus', '') + '<span>Add light</span></button>' +
        '<button type="button" class="sx-tb" data-map>Depth map</button>' +
        '<button type="button" class="sx-tb xp-tb-tog" data-ov aria-pressed="' + st.overlay + '">Show depth</button>' +
        '<svg class="xp-light-diag" width="84" height="40" viewBox="0 0 84 40" role="img" aria-label="Lighting diagram, seen from above" style="flex:none;color:var(--muted)"></svg></span>');
      diag = w.querySelector('svg'); paintDiagram();
      var id = function () { return a.target(); };
      w.querySelector('[data-add]').addEventListener('click', function () {
        var l = id(); if (!l) { a.toast('Select a photo first.'); return; }
        var n = entries(l).filter(function (e) { return e.type === 'relight'; }).length;
        var p = n ? { intensity: 0.8, position: { x: 0.8, y: 0.25 }, existing: 1 } : { intensity: 1, position: { x: 0.2, y: 0.2 }, existing: 0.8, soften: 0.2 };
        X.doc.addFx(l, 'relight', { p: p, append: true }, X.gesture());
        refresh();
      });
      var mapBtn = w.querySelector('[data-map]');
      function paintMap() { var l = X.doc.layer(id()); mapBtn.disabled = !l || !l.src || !!(l.maps && l.maps.depth); mapBtn.title = mapBtn.disabled ? 'This photo has a depth map' : 'Make a depth map on this device'; }
      paintMap();
      mapBtn.addEventListener('click', function () {
        var l = id(); if (!l) return;
        mapBtn.disabled = true; mapBtn.textContent = 'Making depth…';
        var go = function () { return LE.maps.generate(scene(), l, 'depth', {}); };
        var ready = LE.maps ? Promise.resolve() : (LE.lazy ? LE.lazy(X.base + '../le-maps.js') : Promise.reject(new Error('missing')));
        ready.then(function () { return LE.maps.gate ? LE.maps.gate('depth', { run: go }) : go(); }).then(function (r) {
          mapBtn.textContent = 'Depth map';
          if (r && r.ok === false) a.toast(r.message || 'The depth map could not be made.');
          paintMap(); refresh();
        }, function (e) { mapBtn.textContent = 'Depth map'; paintMap(); if (!e || e.code !== 'cancelled') a.toast((e && e.message) || 'The depth map could not be made.'); });
      });
      var ov = w.querySelector('[data-ov]');
      ov.addEventListener('click', function () { st.overlay = !st.overlay; ov.setAttribute('aria-pressed', String(st.overlay)); paintOverlay(); });
      return w;
    }
  };
  /* The workspace loads its files in parallel; register as soon as the tool registry (tools.js) is there. */
  function reg() { if (X.tools && typeof X.tools.register === 'function') { X.tools.register(DEF); return true; } return false; }
  if (!reg()) { var tries = 0, t = setInterval(function () { if (reg() || ++tries > 400) clearInterval(t); }, 25); }
})(window);
