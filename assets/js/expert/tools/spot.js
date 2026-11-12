/* LocalEditor Expert: Heal (J) and Clone (S) brushes for the retouching pack (assets/js/fx/le-fx-retouch.js).
 * A stroke (or a click) becomes one record in the layer's "spot-heal" entry: one stroke = one undo step through
 * scene.update. Alt/Option-click sets the source; Heal without a source picks one automatically (LE.fx.retouch.suggestSource).
 * Nothing is painted into the photo: the renderer replays the records. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.tools) return;
  var T = X.tools, h = X.h, esc = X.esc;

  /* Page coordinates → fractions of a layer's box (undoing its rotation and flips). Shared with the other retouch tools. */
  X.rtFrac = X.rtFrac || function (l, x, y) {
    var rad = (l.rotation || 0) * Math.PI / 180, cx = l.x + l.w / 2, cy = l.y + l.h / 2, dx = x - cx, dy = y - cy;
    var lx = dx * Math.cos(-rad) - dy * Math.sin(-rad) + l.w / 2, ly = dx * Math.sin(-rad) + dy * Math.cos(-rad) + l.h / 2;
    if (l.flipX) lx = l.w - lx; if (l.flipY) ly = l.h - ly;
    return { x: lx / l.w, y: ly / l.h };
  };
  /* The photo layer a retouch tool works on, or null with a toast. */
  X.rtTarget = X.rtTarget || function (a, what) {
    var id = a.target(), l = id && X.doc.layer(id);
    if (!l || l.type !== 'image') { a.toast('Select a photo to ' + what + '.'); return null; }
    return l;
  };
  /* Writes a whole new parameter object into the first entry of `type` (made when missing), under one gesture key. */
  X.rtWrite = X.rtWrite || function (id, type, p, key) {
    var e = X.doc.firstOfType(id, type);
    if (e) X.doc.setEntry(id, e.id, { p: p }, key); else X.doc.addFx(id, type, { p: p }, key);
  };
  X.rtParams = X.rtParams || function (id, type) {
    var FX = global.LE.fx, e = X.doc.firstOfType(id, type);
    return Object.assign(FX.defaults(type), e ? X.clone(e.p) : {});
  };

  var OPT = X.lsGet('le-expert-spot', { size: 40, hardness: 0.4, opacity: 1, aligned: true });
  function spotTool(id, key, label, icon, order, clone) {
    var st = null;
    return {
      id: id, key: key, label: label, icon: icon, group: 'retouch', order: order, replace: true, cursor: 'none',
      activate: function (a) {
        var l = X.rtTarget(a, clone ? 'clone on' : 'heal'); if (!l) { setTimeout(function () { T.activate('move'); }, 0); return; }
        st = { a: a, id: l.id, src: null, offset: null, brush: null };
        a.capture(true, 'none');
        global.LE.fxBoot.load().then(function () {
          if (!st) return;
          st.brush = X.Brush.attach(a.layer, { toDoc: a.toDoc, zoom: a.zoom, cursorHost: a.layer, target: null, size: OPT.size, hardness: OPT.hardness, spacing: 0.15, smoothing: 0.3, pressure: { size: true, flow: false } });
          st.brush.on('end', function (s) { commit(s); });
          st.brush.on('options', function (o) { OPT.size = o.size; OPT.hardness = o.hardness; X.lsSet('le-expert-spot', OPT); });
        });
        /* Alt/Option-click: the source point (capture phase, before the brush sees it). */
        st.alt = function (e) {
          if (!e.altKey) return;
          e.preventDefault(); e.stopImmediatePropagation();
          var d = a.toDoc(e.clientX, e.clientY), lay = X.doc.layer(st.id);
          st.src = X.rtFrac(lay, d.x, d.y); st.offset = null;
          a.toast('Source set. Paint where it should go.');
        };
        a.layer.addEventListener('pointerdown', st.alt, true);
        if (!clone && !X.lsGet('le-expert-heal-tip', 0)) { X.lsSet('le-expert-heal-tip', 1); a.toast(X.say('Click a spot to heal it; Alt-click to choose the source yourself.', 'Tap a spot to heal it.')); }
        if (clone) a.toast(X.say('Alt-click to set the source, then paint.', 'Set the source in the options bar, then paint.'));
      },
      deactivate: function (a) { if (st) { if (st.brush) st.brush.detach(); a.layer.removeEventListener('pointerdown', st.alt, true); } st = null; a.capture(false); },
      onKey: function (e) {
        if (!st || !st.brush) return false;
        var k = e.key;
        if (k === '[' || k === ']' || k === '{' || k === '}') { if (e.shiftKey) { if (k === '}' || k === ']') st.brush.harder(); else st.brush.softer(); } else if (k === ']') st.brush.bigger(); else st.brush.smaller(); return true; }
        return false;
      },
      options: function (a) {
        var w = h('<span class="xp-opts"></span>');
        function save(o) { Object.assign(OPT, o); X.lsSet('le-expert-spot', OPT); if (st && st.brush) st.brush.set({ size: OPT.size, hardness: OPT.hardness }); }
        w.appendChild(T.opt('Size', OPT.size, { min: 2, max: 1000, step: 1, unit: 'px' }, function (v) { save({ size: v }); }));
        w.appendChild(T.opt('Hardness', Math.round(OPT.hardness * 100), { min: 0, max: 100, step: 1, unit: '%' }, function (v) { save({ hardness: v / 100 }); }));
        w.appendChild(T.opt('Opacity', Math.round(OPT.opacity * 100), { min: 1, max: 100, step: 1, unit: '%' }, function (v) { save({ opacity: v / 100 }); }));
        if (clone) {
          var al = h('<button type="button" class="sx-tb xp-tb-tog" aria-pressed="' + !!OPT.aligned + '" title="Keep the same offset for every stroke">Aligned</button>');
          al.addEventListener('click', function () { var on = al.getAttribute('aria-pressed') !== 'true'; al.setAttribute('aria-pressed', String(on)); save({ aligned: on }); });
          w.appendChild(al);
        }
        var src = h('<button type="button" class="sx-tb" title="' + esc(X.say('Or Alt-click on the photo', 'Tap here, then tap the photo')) + '">' + X.ic('pipette', '') + '<span>Source</span></button>');
        src.addEventListener('click', function () { if (!st) return; st.pickNext = true; a.toast(X.say('Click the photo where the source is.', 'Tap the photo where the source is.')); });
        w.appendChild(src);
        var done = h('<button type="button" class="sx-tb is-primary">' + X.ic('check', '') + '<span>Done</span></button>');
        done.addEventListener('click', function () { T.activate('move'); });
        w.appendChild(done);
        return w;
      }
    };
    function commit(s) {
      if (!st || !s.points.length) return;
      var R = global.LE.fx.retouch, lay = X.doc.layer(st.id); if (!lay || !R) return;
      var pts = s.points.map(function (q) { var f = X.rtFrac(lay, q.x, q.y); return [f.x, f.y, q.p == null ? 1 : q.p]; });
      if (st.pickNext) { st.pickNext = false; st.src = { x: pts[0][0], y: pts[0][1] }; st.offset = null; st.a.toast('Source set.'); return; }
      var L = Math.max(lay.w, lay.h), r = Math.max(0.0008, OPT.size / 2 / L), off = null;
      if (st.src) {
        if (!st.offset || !OPT.aligned || !clone) st.offset = { dx: st.src.x - pts[0][0], dy: st.src.y - pts[0][1] };
        off = st.offset;
        if (clone && !OPT.aligned) st.offset = null;
      } else if (clone) { st.a.toast(X.say('Alt-click to set the clone source first.', 'Set the source first.')); return; }
      else {
        /* The source search runs on the whole photo: box fractions → photo fractions through the crop, and back. */
        var img = X.assetCanvas(lay.src), c = lay.crop || {}, cx = c.x || 0, cy = c.y || 0, cw = c.w == null ? 1 : c.w, ch = c.h == null ? 1 : c.h;
        if (img) {
          var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
          var s0 = R.suggestSource(img, { x: cx + pts[0][0] * cw, y: cy + pts[0][1] * ch, r: r * Math.max(cw * W, ch * H) / Math.max(W, H) });
          off = { dx: s0.dx / cw, dy: s0.dy / ch };
        } else off = { dx: 0, dy: r * 3 };
      }
      var p = R.spots.add(X.rtParams(st.id, 'spot-heal'), { kind: clone ? 'clone' : 'heal', r: r, hardness: OPT.hardness, opacity: OPT.opacity, dx: off.dx, dy: off.dy, points: pts });
      if (R.spots.used(p) > 0.98) st.a.toast('This healing layer is full; new spots go into a new one.');
      X.rtWrite(st.id, 'spot-heal', p, X.gesture());
    }
  }
  T.register(spotTool('heal', 'J', 'Heal', 'heal', 40, false));
  T.register(spotTool('clone', 'S', 'Clone', 'clone', 41, true));
})(window);
