/* Expert control kit: curve editor.
 * Master and R/G/B channels; control points in 0–1 ([[x, y], ...]); the drawn curve is LE.curves.monotone, the same function
 * the renderer samples. Click the curve to add a point, drag to move, drag off the graph or double-click to remove.
 * Keyboard: Tab to a point, arrows move it (Shift x10), Delete removes, + adds. Targeted adjustment: drag on the photo. */
(function (global) {
  'use strict';
  var LE = global.LE, X = LE && LE.expert;
  if (!X || !X.controls || !X.controls.register) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;
  var CH = [['master', 'RGB', 'var(--ink)'], ['r', 'Red', '#E5484D'], ['g', 'Green', '#30A46C'], ['b', 'Blue', '#3E7BFA']];
  var PRE = ['linear', 'medium', 'strong', 'matte', 'cross'];

  function normal(v) {
    var o = Array.isArray(v) ? { master: v } : Object.assign({}, v || {});
    CH.forEach(function (c) { o[c[0]] = LE.curves.clean(o[c[0]] || [[0, 0], [1, 1]]); });
    return o;
  }
  function r3(n) { return Math.round(n * 1000) / 1000; }

  /* spec: { label, value, onInput, onCommit, channels (default true), histogram: () => { r, g, b, l } | null } */
  C.register('curve', function (spec) {
    var val = normal(spec.value);
    var ch = 'master', selI = -1;
    var single = spec.channels === false || Array.isArray(spec.value);
    var gid = C.uid('xpcv');
    var el = h('<div class="xp-curve" role="group" aria-label="' + esc(spec.label || 'Curve') + '">' +
      '<div class="xp-curve-head">' + (single ? '<span class="xp-lbl">' + esc(spec.label || 'Curve') + '</span>' : '<div class="xp-seg xp-curve-ch" role="radiogroup" aria-label="Channel"></div>') +
      '<span class="xp-grow"></span><button type="button" class="xp-ib xp-tat" aria-pressed="false" aria-label="Targeted adjustment: drag on the photo" title="' + esc(X.say('Drag up or down on the photo to change that tone', 'Drag on the photo to change that tone')) + '">' + X.ic('point') + '</button>' +
      '<select class="xp-select xp-curve-pre" aria-label="Curve preset"><option value="">Preset…</option>' + PRE.map(function (k) { return '<option value="' + k + '">' + esc(LE.curves.PRESETS[k].name) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="xp-ib" data-act="reset" aria-label="Reset curve" title="Reset curve">' + X.ic('reset') + '</button></div>' +
      '<div class="xp-curve-box"><canvas class="xp-curve-hist" aria-hidden="true"></canvas><svg class="xp-curve-svg" viewBox="0 0 256 256" preserveAspectRatio="none" id="' + gid + '">' +
      '<path class="xp-curve-grid" d="M64 0V256M128 0V256M192 0V256M0 64H256M0 128H256M0 192H256"/><path class="xp-curve-diag" d="M0 256L256 0"/><path class="xp-curve-ghost"/><path class="xp-curve-line"/><g class="xp-curve-pts"></g></svg></div>' +
      '<div class="xp-curve-io"><label>Input <input class="xp-field" data-io="x" inputmode="numeric" aria-label="Input level (0–255)"></label><label>Output <input class="xp-field" data-io="y" inputmode="numeric" aria-label="Output level (0–255)"></label></div></div>');
    var svg = el.querySelector('svg'), line = el.querySelector('.xp-curve-line'), ghost = el.querySelector('.xp-curve-ghost'), ptsG = el.querySelector('.xp-curve-pts');
    var histC = el.querySelector('canvas'), box = el.querySelector('.xp-curve-box');
    var io = { x: el.querySelector('[data-io="x"]'), y: el.querySelector('[data-io="y"]') };
    var g = C.gesture(spec);
    var chSeg = el.querySelector('.xp-curve-ch');
    if (chSeg) {
      CH.forEach(function (c) {
        var b = h('<button type="button" role="radio" aria-checked="false" data-ch="' + c[0] + '"><i style="background:' + c[2] + '"></i>' + esc(c[0] === 'master' ? 'RGB' : c[1].charAt(0)) + '</button>');
        b.setAttribute('aria-label', c[1] === 'RGB' ? 'All channels' : c[1]);
        b.addEventListener('click', function () { setCh(c[0]); });
        chSeg.appendChild(b);
      });
    }
    function setCh(c) {
      ch = c; selI = -1;
      if (chSeg) [].forEach.call(chSeg.children, function (b) { b.setAttribute('aria-checked', b.getAttribute('data-ch') === c ? 'true' : 'false'); });
      el.setAttribute('data-ch', c);
      draw(); drawHist();
    }
    function pts() { return val[ch]; }
    function emit(live) { var out = single ? val.master : val; if (live) g.input(X.clone(out)); else g.once(X.clone(out)); }
    function pathFor(points) {
      var f = LE.curves.monotone(points), d = '';
      for (var i = 0; i <= 64; i++) { var x = i / 64; d += (i ? 'L' : 'M') + r3(x * 256) + ' ' + r3((1 - f(x)) * 256); }
      return d;
    }
    function draw() {
      line.setAttribute('d', pathFor(pts()));
      line.style.stroke = CH.filter(function (c) { return c[0] === ch; })[0][2];
      ghost.setAttribute('d', ch === 'master' ? '' : pathFor(val.master));
      var html = '';
      pts().forEach(function (p, i) {
        html += '<g class="xp-cpt' + (i === selI ? ' is-sel' : '') + '" data-i="' + i + '" tabindex="0" role="slider" aria-label="Point ' + (i + 1) + '" aria-valuemin="0" aria-valuemax="255" aria-valuenow="' + Math.round(p[1] * 255) + '" aria-valuetext="Input ' + Math.round(p[0] * 255) + ', output ' + Math.round(p[1] * 255) + '">' +
          '<circle class="xp-cpt-hit" cx="' + r3(p[0] * 256) + '" cy="' + r3((1 - p[1]) * 256) + '" r="16"/><circle class="xp-cpt-dot" cx="' + r3(p[0] * 256) + '" cy="' + r3((1 - p[1]) * 256) + '" r="5"/></g>';
      });
      ptsG.innerHTML = html;
      var s = pts()[selI];
      io.x.disabled = io.y.disabled = !s;
      if (document.activeElement !== io.x) io.x.value = s ? Math.round(s[0] * 255) : '';
      if (document.activeElement !== io.y) io.y.value = s ? Math.round(s[1] * 255) : '';
    }
    function drawHist() {
      var hist = spec.histogram && spec.histogram();
      var w = Math.max(1, Math.round(box.clientWidth * (global.devicePixelRatio || 1))), hh = w;
      if (histC.width !== w) { histC.width = w; histC.height = hh; }
      var c2 = histC.getContext('2d');
      c2.clearRect(0, 0, w, hh);
      if (!hist) return;
      var arr = hist[ch === 'master' ? 'l' : ch];
      if (!arr) return;
      var max = 1; for (var i = 1; i < 255; i++) max = Math.max(max, arr[i]);
      c2.fillStyle = ch === 'master' ? 'rgba(128,128,128,.28)' : CH.filter(function (c) { return c[0] === ch; })[0][2];
      if (ch !== 'master') c2.globalAlpha = 0.22;
      c2.beginPath(); c2.moveTo(0, hh);
      for (var j = 0; j < arr.length; j++) c2.lineTo(j / (arr.length - 1) * w, hh - Math.min(1, arr[j] / max) * hh * 0.92);
      c2.lineTo(w, hh); c2.closePath(); c2.fill(); c2.globalAlpha = 1;
    }
    function toUnit(e) {
      var r = svg.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1), out: e.clientX < r.left - 18 || e.clientX > r.right + 18 || e.clientY < r.top - 18 || e.clientY > r.bottom + 18 };
    }
    /* Keep points ordered by x and away from their neighbours; endpoints keep their x unless dragged past. */
    function place(i, x, y) {
      var p = pts(), lo = i > 0 ? p[i - 1][0] + 0.01 : 0, hi = i < p.length - 1 ? p[i + 1][0] - 0.01 : 1;
      p[i] = [r3(clamp(x, lo, hi)), r3(clamp(y, 0, 1))];
    }
    function addAt(x, y) {
      var p = pts(), i = 0;
      while (i < p.length && p[i][0] < x) i++;
      if ((i > 0 && x - p[i - 1][0] < 0.02) || (i < p.length && p[i][0] - x < 0.02)) return -1;
      p.splice(i, 0, [r3(x), r3(y)]);
      return i;
    }
    function removeAt(i) { var p = pts(); if (p.length <= 2 || i < 0) return false; p.splice(i, 1); selI = -1; return true; }

    var drag = null;
    C.drag(svg, {
      slop: 0,
      start: function (e) {
        var u = toUnit(e), t = e.target.closest && e.target.closest('.xp-cpt');
        var i = t ? Number(t.getAttribute('data-i')) : -1;
        if (i < 0) {
          var f = LE.curves.monotone(pts());
          /* Near the curve: add a point there. Elsewhere: add at the pointer (Shift keeps it on the curve). */
          i = addAt(u.x, Math.abs(f(u.x) - u.y) < 0.06 || e.shiftKey ? f(u.x) : u.y);
          if (i < 0) return false;
        }
        selI = i;
        drag = { i: i, removed: false };
        g.start();
        draw();
        emit(true);
      },
      move: function (e) {
        if (!drag) return;
        var u = toUnit(e), p = pts();
        var end = drag.i === 0 || drag.i === p.length - 1;
        if (u.out && !end && p.length > 2) { if (!drag.removed) { drag.saved = p[drag.i]; removeAt(drag.i); drag.removed = true; draw(); emit(true); } return; }
        if (drag.removed) { drag.i = addAt(u.x, u.y); if (drag.i < 0) return; drag.removed = false; selI = drag.i; }
        place(drag.i, u.x, u.y);
        draw();
        emit(true);
      },
      end: function () { if (!drag) return; drag = null; g.end(X.clone(single ? val.master : val)); draw(); }
    });
    svg.style.touchAction = 'none';
    svg.addEventListener('dblclick', function (e) {
      var t = e.target.closest && e.target.closest('.xp-cpt');
      if (t && removeAt(Number(t.getAttribute('data-i')))) { draw(); emit(false); }
    });
    svg.addEventListener('focusin', function (e) { var t = e.target.closest('.xp-cpt'); if (t) { selI = Number(t.getAttribute('data-i')); [].forEach.call(ptsG.children, function (n, k) { n.classList.toggle('is-sel', k === selI); }); io.x.disabled = io.y.disabled = false; io.x.value = Math.round(pts()[selI][0] * 255); io.y.value = Math.round(pts()[selI][1] * 255); } });
    svg.addEventListener('keydown', function (e) {
      var p = pts(), k = e.key;
      if (selI < 0 || !p[selI]) return;
      var s = (e.shiftKey ? 10 : 1) / 255, dx = 0, dy = 0;
      if (k === 'ArrowUp') dy = s; else if (k === 'ArrowDown') dy = -s; else if (k === 'ArrowLeft') dx = -s; else if (k === 'ArrowRight') dx = s;
      else if (k === 'Delete' || k === 'Backspace') { C.swallow(e); if (removeAt(selI)) { draw(); emit(false); var f0 = ptsG.querySelector('.xp-cpt'); if (f0) f0.focus(); } return; }
      else if (k === '+' || k === '=') {
        C.swallow(e);
        var gap = 0, at = 0.5;
        for (var i = 1; i < p.length; i++) if (p[i][0] - p[i - 1][0] > gap) { gap = p[i][0] - p[i - 1][0]; at = (p[i][0] + p[i - 1][0]) / 2; }
        var ni = addAt(at, LE.curves.monotone(p)(at));
        if (ni >= 0) { selI = ni; draw(); emit(false); var n = ptsG.querySelector('[data-i="' + ni + '"]'); if (n) n.focus(); }
        return;
      } else return;
      C.swallow(e);
      place(selI, p[selI][0] + dx, p[selI][1] + dy);
      var keep = selI;
      draw();
      g.once(X.clone(single ? val.master : val), true);
      var n2 = ptsG.querySelector('[data-i="' + keep + '"]'); if (n2) n2.focus();
    });
    ['x', 'y'].forEach(function (a) {
      io[a].addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') io[a].blur(); });
      io[a].addEventListener('change', function () {
        var p = pts(); if (!p[selI]) return;
        var n = clamp(Number(io[a].value) || 0, 0, 255) / 255;
        place(selI, a === 'x' ? n : p[selI][0], a === 'y' ? n : p[selI][1]);
        draw(); emit(false);
      });
    });
    el.querySelector('.xp-curve-pre').addEventListener('change', function (e) {
      var pr = LE.curves.PRESETS[e.target.value];
      e.target.value = '';
      if (!pr) return;
      CH.forEach(function (c) { if (single && c[0] !== 'master') return; val[c[0]] = LE.curves.clean(pr[c[0]] || [[0, 0], [1, 1]]); });
      selI = -1; draw(); emit(false);
    });
    el.querySelector('[data-act="reset"]').addEventListener('click', function () { val[ch] = [[0, 0], [1, 1]]; selI = -1; draw(); emit(false); });
    /* Targeted adjustment: the workspace calls target.start(level) with the level under the pointer (0–1, this channel),
       then target.move(dy) with the vertical drag in pixels (up is positive), then target.end(). */
    var tat = el.querySelector('.xp-tat');
    var target = {
      start: function (level) {
        var p = pts(), f = LE.curves.monotone(p), i = -1;
        for (var k = 0; k < p.length; k++) if (Math.abs(p[k][0] - level) < 0.03) i = k;
        if (i < 0) i = addAt(clamp(level, 0.01, 0.99), f(level));
        if (i < 0) return;
        selI = i; this.y0 = p[i][1]; g.start(); draw(); emit(true);
      },
      move: function (dy) { var p = pts(); if (!p[selI]) return; place(selI, p[selI][0], this.y0 + dy / 300); draw(); emit(true); },
      end: function () { g.end(X.clone(single ? val.master : val)); },
      channel: function () { return ch; }
    };
    tat.addEventListener('click', function () {
      var on = tat.getAttribute('aria-pressed') !== 'true';
      tat.setAttribute('aria-pressed', on ? 'true' : 'false');
      X.emit('target', on ? { kind: 'curve', control: api } : null);
    });
    var stopT = X.on('target', function (t) { if (!t || t.control !== api) tat.setAttribute('aria-pressed', 'false'); });
    var ro = global.ResizeObserver ? new ResizeObserver(function () { drawHist(); }) : null;
    if (ro) ro.observe(box);
    var stopH = X.on('scopes', function () { if (el.isConnected) drawHist(); });
    setCh('master');
    var api = {
      el: el, target: target,
      get: function () { return X.clone(single ? val.master : val); },
      set: function (v) { if (g.active()) return; val = normal(v); if (selI >= pts().length) selI = -1; draw(); },
      setChannel: setCh,
      select: function (i) { selI = i; draw(); },
      focus: function () { var f = ptsG.querySelector('.xp-cpt'); if (f) f.focus(); },
      redrawHistogram: drawHist,
      destroy: function () { if (ro) ro.disconnect(); stopH(); stopT(); }
    };
    return api;
  });
})(window);
