/* Expert control kit: hue-band grid. Eight bands x hue / saturation / luminance, with on-image targeted adjustment.
 * Value: [{ h, s, l } x 8] in the schema's range (default -100..100), bands in this order. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.controls || !X.controls.register) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;
  var BANDS = [['Red', 0], ['Orange', 30], ['Yellow', 60], ['Green', 120], ['Aqua', 180], ['Blue', 240], ['Purple', 270], ['Magenta', 300]];
  var PROPS = [['h', 'Hue'], ['s', 'Saturation'], ['l', 'Luminance']];
  C.BANDS = BANDS;

  function hex(hh, s, l) { return C.hsl2hex ? C.hsl2hex((hh + 360) % 360, s, l) : '#888'; }
  function grad(i, p) {
    var c = BANDS[i][1];
    if (p === 'h') { var a = BANDS[(i + 7) % 8][1], b = BANDS[(i + 1) % 8][1]; if (i === 0) a -= 360; if (i === 7) b += 360; return 'linear-gradient(90deg,' + hex((c + a) / 2, 0.75, 0.55) + ',' + hex(c, 0.75, 0.55) + ',' + hex((c + b) / 2, 0.75, 0.55) + ')'; }
    if (p === 's') return 'linear-gradient(90deg,' + hex(c, 0, 0.55) + ',' + hex(c, 0.9, 0.5) + ')';
    return 'linear-gradient(90deg,' + hex(c, 0.7, 0.12) + ',' + hex(c, 0.7, 0.5) + ',' + hex(c, 0.6, 0.9) + ')';
  }
  /* Weights of the two bands around a hue (degrees). */
  function weights(hue) {
    hue = (hue % 360 + 360) % 360;
    for (var i = 0; i < 8; i++) {
      var a = BANDS[i][1], b = i === 7 ? 360 : BANDS[i + 1][1];
      if (hue >= a && hue < b) { var t = (hue - a) / (b - a); return [[i, 1 - t], [(i + 1) % 8, t]]; }
    }
    return [[0, 1]];
  }
  C.bandWeights = weights;

  /* spec: { label, value, schema: { min, max }, onInput, onCommit } */
  C.register('bands', function (spec) {
    var sc = Object.assign({ min: -100, max: 100, step: 1 }, spec.schema || {});
    var v = norm(spec.value);
    function norm(n) { return BANDS.map(function (b, i) { var o = (n && n[i]) || {}; return { h: Number(o.h) || 0, s: Number(o.s) || 0, l: Number(o.l) || 0 }; }); }
    var prop = X.lsGet('le-expert-bands', 'h');
    var el = h('<div class="xp-bands"><div class="xp-bands-head"><div class="xp-seg" role="radiogroup" aria-label="Adjust"></div><span class="xp-grow"></span>' +
      '<button type="button" class="xp-ib xp-tat" aria-pressed="false" aria-label="Targeted adjustment: drag on the photo" title="' + esc(X.say('Drag up or down on a colour in the photo', 'Drag on a colour in the photo')) + '">' + X.ic('point') + '</button></div><div class="xp-bands-rows"></div></div>');
    var seg = el.querySelector('.xp-seg'), rows = el.querySelector('.xp-bands-rows');
    var ctrls = [];
    var g = C.gesture(spec);
    PROPS.concat([['all', 'All']]).forEach(function (p) {
      var b = h('<button type="button" role="radio" aria-checked="false" data-p="' + p[0] + '">' + esc(p[1]) + '</button>');
      b.addEventListener('click', function () { prop = p[0]; X.lsSet('le-expert-bands', prop); build(); });
      seg.appendChild(b);
    });
    function slider(i, p, label) {
      var c = C.create('slider', { label: label, compact: true, gradient: grad(i, p), value: v[i][p], schema: sc,
        onInput: function (n, k) { v[i][p] = n; if (spec.onInput) spec.onInput(X.clone(v), k); },
        onCommit: function (n, k) { v[i][p] = n; (spec.onCommit || spec.onInput)(X.clone(v), k); } });
      c._i = i; c._p = p;
      return c;
    }
    function build() {
      rows.innerHTML = ''; ctrls = [];
      [].forEach.call(seg.children, function (b) { b.setAttribute('aria-checked', b.getAttribute('data-p') === prop ? 'true' : 'false'); });
      if (prop === 'all') {
        BANDS.forEach(function (b, i) {
          var grp = h('<div class="xp-bands-grp" role="group" aria-label="' + b[0] + '"><div class="xp-bands-name"><i class="xp-dot" style="background:' + hex(b[1], 0.75, 0.5) + '"></i>' + b[0] + '</div></div>');
          PROPS.forEach(function (p) { var c = slider(i, p[0], p[1]); ctrls.push(c); grp.appendChild(c.el); });
          rows.appendChild(grp);
        });
      } else {
        BANDS.forEach(function (b, i) { var c = slider(i, prop, b[0]); ctrls.push(c); rows.appendChild(c.el); });
      }
    }
    /* Targeted adjustment: start(hueDegrees), move(dy pixels, up positive), end(). The property is the one shown (Hue when "All"). */
    var t0 = null;
    var target = {
      start: function (hue) { t0 = { w: weights(hue), p: prop === 'all' ? 's' : prop, base: X.clone(v) }; g.start(); },
      move: function (dy) {
        if (!t0) return;
        t0.w.forEach(function (w) { v[w[0]][t0.p] = Math.round(clamp(t0.base[w[0]][t0.p] + dy / 2 * w[1], sc.min, sc.max)); });
        ctrls.forEach(function (c) { c.set(v[c._i][c._p]); });
        g.input(X.clone(v));
      },
      end: function () { if (t0) g.end(X.clone(v)); t0 = null; }
    };
    var api;
    var tat = el.querySelector('.xp-tat');
    tat.addEventListener('click', function () {
      var on = tat.getAttribute('aria-pressed') !== 'true';
      tat.setAttribute('aria-pressed', on ? 'true' : 'false');
      X.emit('target', on ? { kind: 'bands', control: api } : null);
    });
    var stopT = X.on('target', function (t) { if (!t || t.control !== api) tat.setAttribute('aria-pressed', 'false'); });
    build();
    api = {
      el: el, target: target,
      get: function () { return X.clone(v); },
      set: function (n) { if (g.active()) return; v = norm(n); ctrls.forEach(function (c) { c.set(v[c._i][c._p]); }); },
      focus: function () { if (ctrls[0]) ctrls[0].focus(); }, destroy: function () { stopT(); }
    };
    return api;
  });
})(window);
