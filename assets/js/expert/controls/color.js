/* Expert control kit: colour wheel, grading wheels (shadows / midtones / highlights / global + balance and blending),
 * channel mixer matrix and colour swatch (the studio's colour picker when it is there, the system picker otherwise). */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.controls || !X.controls.register) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;

  function hsl2hex(hh, s, l) {
    var f = function (n) { var k = (n + hh / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return '#' + [f(0), f(8), f(4)].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  C.hsl2hex = hsl2hex;

  /* ---------- One wheel: hue-and-amount puck, luminance slider below ---------- */
  /* spec: { label, value: { h, a, l }, size, onInput, onCommit, compact } */
  C.register('wheel', function (spec) {
    var v = X.coerce({ type: 'wheel' }, spec.value || {});
    var lid = C.uid('xpw');
    var el = h('<div class="xp-wheel' + (spec.compact ? ' is-compact' : '') + '"><div class="xp-wheel-head"><span class="xp-lbl" id="' + lid + '">' + esc(spec.label || 'Colour') + '</span><i class="xp-wheel-chip" aria-hidden="true"></i><button type="button" class="xp-rst" tabindex="-1" aria-label="Reset ' + esc(spec.label || 'wheel') + '">' + X.ic('reset') + '</button></div>' +
      '<div class="xp-wheel-disc" tabindex="0" role="slider" aria-labelledby="' + lid + '" aria-valuemin="0" aria-valuemax="100"><i class="xp-wheel-x" aria-hidden="true"></i><i class="xp-wheel-puck" aria-hidden="true"></i></div></div>');
    if (spec.size) el.style.setProperty('--wheel', spec.size + 'px');
    var disc = el.querySelector('.xp-wheel-disc'), puck = el.querySelector('.xp-wheel-puck'), chip = el.querySelector('.xp-wheel-chip');
    var g = C.gesture(spec);
    var lum = C.create('slider', { label: 'Luminance', compact: true, gradient: 'luminance', value: Math.round(v.l * 100), schema: { min: -100, max: 100, step: 1, default: 0 },
      onInput: function (n, k) { v.l = n / 100; paint(); if (spec.onInput) spec.onInput(X.clone(v), k); },
      onCommit: function (n, k) { v.l = n / 100; paint(); (spec.onCommit || spec.onInput)(X.clone(v), k); } });
    el.appendChild(lum.el);
    function paint() {
      var rad = v.h * Math.PI / 180;
      puck.style.setProperty('--px', (50 + Math.cos(rad) * v.a * 50) + '%');
      puck.style.setProperty('--py', (50 - Math.sin(rad) * v.a * 50) + '%');
      chip.style.background = v.a > 0.001 ? hsl2hex(v.h, Math.min(1, v.a * 1.6), 0.5 + v.l * 0.25) : 'transparent';
      disc.setAttribute('aria-valuenow', String(Math.round(v.a * 100)));
      disc.setAttribute('aria-valuetext', 'Hue ' + Math.round(v.h) + '°, amount ' + Math.round(v.a * 100) + '%, luminance ' + Math.round(v.l * 100));
      el.classList.toggle('is-changed', v.a > 0.001 || Math.abs(v.l) > 0.001);
    }
    function fromPointer(e, fine, base) {
      var r = disc.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      if (fine && base) { dx = base.x + (dx - base.px) * 0.15; dy = base.y + (dy - base.py) * 0.15; }
      var a = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      var hh = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      return { h: Math.round(hh * 10) / 10, a: Math.round(a * 1000) / 1000 };
    }
    var base = null;
    C.drag(disc, {
      slop: 0,
      start: function (e) {
        g.start();
        var rad = v.h * Math.PI / 180, r = disc.getBoundingClientRect();
        var px = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), py = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        base = { x: Math.cos(rad) * v.a, y: Math.sin(rad) * v.a, px: px, py: py };
        /* Grab the puck where it is (relative); a press away from it jumps there. */
        if (Math.hypot(px - base.x, py - base.y) > 0.22) { var p = fromPointer(e); v.h = p.h; v.a = p.a; base = { x: Math.cos(v.h * Math.PI / 180) * v.a, y: Math.sin(v.h * Math.PI / 180) * v.a, px: px, py: py }; paint(); g.input(X.clone(v)); }
        disc.focus({ preventScroll: true });
      },
      move: function (e) {
        var r = disc.getBoundingClientRect();
        var px = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), py = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        var k = e.shiftKey ? 0.15 : 1;
        var x = base.x + (px - base.px) * k, y = base.y + (py - base.py) * k;
        var a = Math.min(1, Math.hypot(x, y));
        v.h = Math.round(((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) * 10) / 10;
        v.a = Math.round(a * 1000) / 1000;
        paint(); g.input(X.clone(v));
      },
      end: function () { g.end(X.clone(v)); }
    });
    disc.style.touchAction = 'none';
    function reset() { v = { h: 0, a: 0, l: 0 }; lum.set(0); paint(); g.once(X.clone(v)); }
    C.doubleTap(disc, reset);
    el.querySelector('.xp-rst').addEventListener('click', reset);
    disc.addEventListener('keydown', function (e) {
      var k = e.key, s = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      if (k === 'ArrowLeft' || k === 'ArrowRight') v.h = (v.h + (k === 'ArrowRight' ? -s : s) + 360) % 360;
      else if (k === 'ArrowUp' || k === 'ArrowDown') v.a = clamp(v.a + (k === 'ArrowUp' ? s : -s) / 100, 0, 1);
      else if (k === 'Backspace' || k === 'Delete') { C.swallow(e); reset(); return; }
      else return;
      C.swallow(e);
      v.h = Math.round(v.h * 10) / 10; v.a = Math.round(v.a * 1000) / 1000;
      paint(); g.once(X.clone(v), true);
    });
    paint();
    return {
      el: el, luminance: lum,
      get: function () { return X.clone(v); },
      set: function (n) { if (g.active()) return; v = X.coerce({ type: 'wheel' }, n || {}); lum.set(Math.round(v.l * 100)); paint(); },
      focus: function () { disc.focus(); }, reset: reset, destroy: function () {}
    };
  });

  /* ---------- Grading wheels ----------
     spec: { wheels: [{ key, label, value }], balance: { label, value, schema } | null, blending: {...} | null, onChange(key, value, gestureKey, live) } */
  C.register('wheels', function (spec) {
    var el = h('<div class="xp-wheels"><div class="xp-seg xp-wheels-view" role="radiogroup" aria-label="Wheels shown"></div><div class="xp-wheels-grid"></div><div class="xp-wheels-extra"></div></div>');
    var grid = el.querySelector('.xp-wheels-grid'), seg = el.querySelector('.xp-wheels-view'), extra = el.querySelector('.xp-wheels-extra');
    var view = X.lsGet('le-expert-wheels-view', 'all');
    var ctrls = {};
    function mk(w, compact) {
      return C.create('wheel', { label: w.label, value: w.value, compact: compact,
        onInput: function (val, k) { w.value = val; spec.onChange(w.key, val, k, true); },
        onCommit: function (val, k) { w.value = val; spec.onChange(w.key, val, k, false); } });
    }
    function build() {
      grid.innerHTML = ''; ctrls = {};
      var list = view === 'all' ? spec.wheels.filter(function (w) { return w.key !== spec.globalKey; }) : spec.wheels.filter(function (w) { return w.key === view; });
      grid.className = 'xp-wheels-grid is-' + (view === 'all' ? 'three' : 'one');
      list.forEach(function (w) { var c = mk(w, view === 'all'); ctrls[w.key] = c; grid.appendChild(c.el); });
      [].forEach.call(seg.children, function (b) { b.setAttribute('aria-checked', b.getAttribute('data-v') === view ? 'true' : 'false'); });
    }
    [['all', '3-way']].concat(spec.wheels.map(function (w) { return [w.key, w.label]; })).forEach(function (o) {
      var b = h('<button type="button" role="radio" aria-checked="false" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>');
      b.addEventListener('click', function () { view = o[0]; X.lsSet('le-expert-wheels-view', view); build(); });
      seg.appendChild(b);
    });
    if (!spec.wheels.some(function (w) { return w.key === view; }) && view !== 'all') view = 'all';
    var sliders = {};
    ['blending', 'balance'].forEach(function (k) {
      var s = spec[k];
      if (!s) return;
      sliders[k] = C.create('slider', { label: s.label, value: s.value, schema: s.schema,
        onInput: function (v, gk) { spec.onChange(s.key, v, gk, true); }, onCommit: function (v, gk) { spec.onChange(s.key, v, gk, false); } });
      extra.appendChild(sliders[k].el);
    });
    build();
    return {
      el: el,
      get: function () { var o = {}; spec.wheels.forEach(function (w) { o[w.key] = w.value; }); return o; },
      /* set({ key: value }) */
      set: function (o) {
        spec.wheels.forEach(function (w) { if (o[w.key] !== undefined) { w.value = o[w.key]; if (ctrls[w.key]) ctrls[w.key].set(o[w.key]); } });
        ['blending', 'balance'].forEach(function (k) { var s = spec[k]; if (s && o[s.key] !== undefined && sliders[k]) sliders[k].set(o[s.key]); });
      },
      focus: function () { var f = el.querySelector('.xp-wheel-disc'); if (f) f.focus(); }, destroy: function () {}
    };
  });

  /* ---------- Channel mixer: a 3x3 matrix of scrubbable cells (output rows, source columns) with row totals ----------
     spec: { value: { r: [rr, rg, rb], g: [...], b: [...] }, schema: { min, max, step }, onInput, onCommit } */
  C.register('mixer', function (spec) {
    var sc = Object.assign({ min: -200, max: 200, step: 1, unit: '%' }, spec.schema || {});
    var v = X.clone(spec.value || { r: [100, 0, 0], g: [0, 100, 0], b: [0, 0, 100] });
    var ROWS = [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];
    var el = h('<div class="xp-mixer" role="grid" aria-label="' + esc(spec.label || 'Channel mixer') + '"><div class="xp-mixer-row is-head" role="row"><span role="columnheader">Output</span><span role="columnheader">Red</span><span role="columnheader">Green</span><span role="columnheader">Blue</span><span role="columnheader">Total</span></div></div>');
    var g = C.gesture(spec);
    var cells = {};
    ROWS.forEach(function (r) {
      var row = h('<div class="xp-mixer-row" role="row"><span role="rowheader"><i class="xp-dot is-' + r[0] + '"></i>' + r[1] + '</span></div>');
      [0, 1, 2].forEach(function (j) {
        var c = h('<span class="xp-mixer-cell xp-num" role="slider" tabindex="0" aria-label="' + r[1] + ' from ' + ROWS[j][1] + '" aria-valuemin="' + sc.min + '" aria-valuemax="' + sc.max + '"></span>');
        cells[r[0] + j] = c;
        var sc2 = C.scrubber(c, sc, function () { return v[r[0]][j]; }, function (n, one) { v[r[0]][j] = X.roundTo(n, sc.step); paint(); if (one) g.once(X.clone(v)); else g.input(X.clone(v)); }, g, r[1] + ' from ' + ROWS[j][1]);
        c.addEventListener('keydown', function (e) {
          var s = C.stepFor(sc, e), k = e.key;
          if (k === 'Enter') { C.swallow(e); sc2.edit(); return; }
          if (k === 'Backspace' || k === 'Delete') { C.swallow(e); v[r[0]][j] = (ROWS[j][0] === r[0]) ? 100 : 0; paint(); g.once(X.clone(v)); return; }
          if (k !== 'ArrowUp' && k !== 'ArrowDown') return;
          C.swallow(e);
          v[r[0]][j] = X.roundTo(clamp(v[r[0]][j] + (k === 'ArrowUp' ? s : -s), sc.min, sc.max), sc.step);
          paint(); g.once(X.clone(v), true);
        });
        c.addEventListener('xp-edited', function () { c.focus(); });
        C.doubleTap(c, function () { v[r[0]][j] = (ROWS[j][0] === r[0]) ? 100 : 0; paint(); g.once(X.clone(v)); });
        row.appendChild(c);
      });
      row.appendChild(h('<span class="xp-mixer-tot" data-row="' + r[0] + '" aria-live="off"></span>'));
      el.appendChild(row);
    });
    function paint() {
      ROWS.forEach(function (r) {
        [0, 1, 2].forEach(function (j) { var c = cells[r[0] + j], n = v[r[0]][j]; if (!c.querySelector('input')) c.textContent = C.format(n, { step: sc.step, min: 0 }); c.setAttribute('aria-valuenow', String(n)); c.classList.toggle('is-changed', n !== (r[0] === ROWS[j][0] ? 100 : 0)); });
        var tot = v[r[0]][0] + v[r[0]][1] + v[r[0]][2];
        var t = el.querySelector('[data-row="' + r[0] + '"]');
        t.textContent = Math.round(tot) + '%';
        t.classList.toggle('is-warn', Math.abs(tot - 100) > 0.5);
        t.title = Math.abs(tot - 100) > 0.5 ? 'Totals away from 100% brighten or darken the picture' : '';
      });
    }
    paint();
    return { el: el, get: function () { return X.clone(v); }, set: function (n) { if (g.active() || !n) return; v = X.clone(n); paint(); }, focus: function () { cells.r0.focus(); }, destroy: function () {} };
  });

  /* ---------- Colour swatch ---------- */
  function toHex(c) {
    var P = global.LEStudioColor;
    if (P && P.hex6) { try { return P.hex6(c); } catch (e) {} }
    return /^#[0-9a-f]{6}$/i.test(c) ? c : '#808080';
  }
  /* spec: { label, value: '#rrggbb', alpha, eyedropper (default true), onInput, onCommit } */
  C.register('color', function (spec) {
    var row = C.row(spec, 'xp-colorrow');
    var cur = spec.value || '#808080';
    var ctl = row.querySelector('.xp-ctl');
    var sw = h('<button type="button" class="xp-swatch" aria-labelledby="' + row._lid + '"><i></i><span class="xp-swatch-hex"></span></button>');
    ctl.appendChild(sw);
    var c = global.LEStudio;
    if (spec.eyedropper !== false && c && c.startPick) {
      var pick = h('<button type="button" class="xp-ib" aria-label="Pick a colour from the photo" title="Pick from the photo">' + X.ic('pipette') + '</button>');
      pick.addEventListener('click', function () { c.startPick(function (hex) { set(hex); g.once(cur); }, X.say('Click the photo to pick a colour', 'Tap the photo to pick a colour')); });
      ctl.appendChild(pick);
    }
    var g = C.gesture(spec);
    function set(v) { cur = v || '#808080'; sw.querySelector('i').style.background = cur; sw.querySelector('.xp-swatch-hex').textContent = String(cur).toUpperCase(); sw.setAttribute('aria-description', String(cur)); row.classList.toggle('is-changed', spec.schema && spec.schema.default ? String(cur).toLowerCase() !== String(spec.schema.default).toLowerCase() : false); }
    sw.addEventListener('click', function () {
      var P = global.LEStudioColor;
      if (c && P && P.pop) {
        var key = null;
        P.pop(c, sw, { value: cur, alpha: !!spec.alpha, title: spec.label || 'Colour', onChange: function (v) { set(v); if (!key) key = X.gesture(); if (spec.onInput) spec.onInput(v, key); } });
        var stop = function () { if (key && spec.onCommit) spec.onCommit(cur, key); key = null; };
        var obs = new MutationObserver(function () { if (c.E && c.E.pop && c.E.pop.hidden) { obs.disconnect(); stop(); } });
        if (c.E && c.E.pop) obs.observe(c.E.pop, { attributes: true, attributeFilter: ['hidden'] });
        return;
      }
      var inp = h('<input type="color" class="sr" tabindex="-1">');
      inp.value = toHex(cur);
      document.body.appendChild(inp);
      var key2 = X.gesture();
      inp.addEventListener('input', function () { set(inp.value); if (spec.onInput) spec.onInput(inp.value, key2); });
      inp.addEventListener('change', function () { set(inp.value); (spec.onCommit || spec.onInput)(inp.value, key2); inp.remove(); });
      inp.addEventListener('blur', function () { setTimeout(function () { inp.remove(); }, 200); });
      inp.click();
    });
    row.querySelector('.xp-rst').addEventListener('click', function () { var d = spec.schema && spec.schema.default; if (d) { set(d); g.once(d); } });
    C.doubleTap(row.querySelector('.xp-lbl'), function () { var d = spec.schema && spec.schema.default; if (d) { set(d); g.once(d); } });
    set(cur);
    return { el: row, get: function () { return cur; }, set: set, focus: function () { sw.focus(); }, destroy: function () {} };
  });
})(window);
