/* Expert control kit: slider row and scrubbable number field.
 * Label | track (centre detent for bipolar ranges, tick at the default, optional gradient) | number (drag to scrub, click to type) | reset.
 * Keys on the track: arrows (Shift x10, Alt /10), Page Up/Down x10, Home/End, Enter to type, Backspace/Delete to reset. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X || !X.controls || !X.controls.register) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;

  var GRADIENTS = {
    temperature: 'linear-gradient(90deg,#3d6fd8,#9bb7e6 35%,#e9e4d8 50%,#eac36a 68%,#e19a2b)',
    tint: 'linear-gradient(90deg,#37a046,#a8d39b 38%,#e7e2df 50%,#d79bd2 64%,#b13fae)',
    hue: 'linear-gradient(90deg,#f33,#ff3 17%,#3f3 33%,#3ff 50%,#33f 67%,#f3f 83%,#f33)',
    saturation: 'linear-gradient(90deg,#8a8a8a,#e33)',
    luminance: 'linear-gradient(90deg,#111,#f4f4f4)',
    exposure: 'linear-gradient(90deg,#1b1b1b,#f6f6f6)'
  };
  C.GRADIENTS = GRADIENTS;

  /* Scrubbable number. Drag left/right to change (Shift = 10x finer), click or Enter to type, Escape cancels. */
  function scrubber(node, schema, get, apply, g, labelText) {
    var range = (schema.max - schema.min) || 1;
    var startV = 0;
    C.drag(node, {
      slop: 3,
      start: function () { startV = get(); },
      move: function (e, dx) {
        if (!g.active()) g.start();
        var per = range / (e.shiftKey ? 2000 : 200);
        apply(clamp(startV + dx * per, schema.min, schema.max), false);
      },
      end: function (e, moved) { if (moved) g.end(get()); },
      tap: function () { edit(); }
    });
    function edit() {
      if (node.querySelector('input')) return;
      var input = h('<input class="xp-num-in" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="' + esc(labelText) + '">');
      input.value = String(get());
      node.classList.add('is-editing');
      node.appendChild(input);
      input.focus(); input.select();
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        var n = parseFloat(String(input.value).replace(',', '.'));
        input.remove();
        node.classList.remove('is-editing');
        if (ok && isFinite(n)) { apply(clamp(n, schema.min, schema.max), true); }
      }
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); node.dispatchEvent(new CustomEvent('xp-edited')); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); node.dispatchEvent(new CustomEvent('xp-edited')); }
      });
      input.addEventListener('blur', function () { finish(true); });
    }
    return { edit: edit };
  }
  C.scrubber = scrubber;

  /* spec: { label, value, schema: { min, max, step, default, unit }, gradient, fine, onInput, onCommit, compact } */
  C.register('slider', function (spec) {
    var sc = Object.assign({ min: 0, max: 100, step: 1 }, spec.schema || {});
    if (sc.min > sc.max) { var t0 = sc.min; sc.min = sc.max; sc.max = t0; }
    var dflt = sc.default != null ? sc.default : X.paramDefault(Object.assign({ type: 'number' }, sc));
    var bi = sc.min < 0 && sc.max > 0;
    var value = spec.value == null ? dflt : Number(spec.value);
    var row = C.row(spec, 'xp-slider' + (bi ? ' is-bi' : '') + (spec.gradient ? ' has-grad' : '') + (spec.compact ? ' is-compact' : ''));
    var ctl = row.querySelector('.xp-ctl');
    var track = h('<div class="xp-track" role="slider" tabindex="0" aria-labelledby="' + row._lid + '" aria-valuemin="' + sc.min + '" aria-valuemax="' + sc.max + '"><i class="xp-rail"></i><i class="xp-fill"></i>' +
      (dflt > sc.min && dflt < sc.max ? '<i class="xp-def" style="--d:' + ((dflt - sc.min) / (sc.max - sc.min)) + '"></i>' : '') + '<i class="xp-thumb"></i></div>');
    var num = h('<span class="xp-num" aria-hidden="true"></span>');
    if (spec.gradient) track.querySelector('.xp-rail').style.background = GRADIENTS[spec.gradient] || spec.gradient;
    if (bi) track.style.setProperty('--z', String((0 - sc.min) / (sc.max - sc.min)));
    ctl.appendChild(track);
    row.insertBefore(num, row.querySelector('.xp-rst'));
    var g = C.gesture(spec);

    function paint() {
      var t = (value - sc.min) / ((sc.max - sc.min) || 1);
      track.style.setProperty('--t', String(clamp(t, 0, 1)));
      var txt = C.format(value, sc);
      if (num.firstChild && num.firstChild.nodeType === 3) num.firstChild.nodeValue = txt; else if (!num.querySelector('input')) num.textContent = txt;
      track.setAttribute('aria-valuenow', String(value));
      track.setAttribute('aria-valuetext', txt);
      row.classList.toggle('is-changed', Math.abs(value - dflt) > 1e-9);
    }
    function snap(v, fine) {
      v = clamp(v, sc.min, sc.max);
      if (!fine && bi && Math.abs(v) < (sc.max - sc.min) * 0.012) v = 0;
      return X.roundTo(v, fine ? (sc.step || 1) / 10 : sc.step);
    }
    /* apply(v, oneShot): set, paint, and send. */
    function apply(v, oneShot) {
      v = X.roundTo(clamp(v, sc.min, sc.max), (sc.step || 1) / 10);
      if (v === value && !oneShot) return;
      value = v;
      if (oneShot) { paint(); g.once(value); return; }
      /* The document write goes first in the frame and the row repaints after it, so the scene never reads a layout this
         row has just dirtied (no forced layout per move). */
      g.input(value);
      paintSoon();
    }
    var paintSoon = X.rafThrottle(function () { paint(); });
    /* Track dragging. Mouse: the thumb jumps to the click, then follows. Touch: relative, so a scroll that starts on a slider
       does not change it. Shift (or the `fine` option) moves 10x finer. */
    var startV = 0, startX = 0, w = 1, rel = false, left = 0;
    C.drag(track, {
      slop: 0, prevent: false,
      start: function (e) {
        var r = track.getBoundingClientRect();
        w = r.width || 1; left = r.left; startX = e.clientX;
        rel = e.pointerType !== 'mouse' || e.shiftKey;
        if (e.pointerType === 'mouse') e.preventDefault();
        g.start();
        track.classList.add('is-drag');
        row.classList.add('is-drag');
        if (!rel) apply(snap(sc.min + (e.clientX - left) / w * (sc.max - sc.min), false), false);
        startV = value;
        startX = e.clientX;
        track.focus({ preventScroll: true });
      },
      move: function (e) {
        var fine = e.shiftKey || spec.fine;
        var dv = (e.clientX - startX) / w * (sc.max - sc.min) * (fine ? 0.1 : 1);
        apply(snap(startV + dv, fine), false);
        if (fine !== rel) { startV = value; startX = e.clientX; rel = fine; }
      },
      end: function () { track.classList.remove('is-drag'); row.classList.remove('is-drag'); g.end(value); paintSoon.flush(); }
    });
    /* Touch: let vertical scrolling of the panel win until the finger clearly moves sideways. */
    track.style.touchAction = 'pan-y';

    function reset() { apply(dflt, true); }
    C.doubleTap(track, reset);
    C.doubleTap(row.querySelector('.xp-lbl'), reset);
    row.querySelector('.xp-rst').addEventListener('click', reset);
    var sc2 = scrubber(num, sc, function () { return value; }, function (v, one) { v = X.roundTo(v, (sc.step || 1) / (one ? 100 : 10)); if (one) apply(v, true); else { value = clamp(v, sc.min, sc.max); paint(); g.input(value); } }, g, spec.label || 'Value');
    num.addEventListener('xp-edited', function () { track.focus(); });

    track.addEventListener('keydown', function (e) {
      var k = e.key, s = C.stepFor(sc, e), v = null;
      if (k === 'ArrowRight' || k === 'ArrowUp') v = value + s;
      else if (k === 'ArrowLeft' || k === 'ArrowDown') v = value - s;
      else if (k === 'PageUp') v = value + C.stepFor(sc, { shiftKey: true });
      else if (k === 'PageDown') v = value - C.stepFor(sc, { shiftKey: true });
      else if (k === 'Home') v = sc.min;
      else if (k === 'End') v = sc.max;
      else if (k === 'Enter') { C.swallow(e); sc2.edit(); return; }
      else if (k === 'Backspace' || k === 'Delete') { C.swallow(e); reset(); return; }
      if (v == null) return;
      C.swallow(e);
      value = X.roundTo(clamp(v, sc.min, sc.max), e.altKey ? (sc.step || 1) / 10 : sc.step);
      paint();
      g.once(value, true);
    });
    paint();
    return {
      el: row, track: track,
      get: function () { return value; },
      set: function (v) { if (g.active()) return; v = Number(v); if (!isFinite(v)) v = dflt; if (v === value) return; value = v; paint(); },
      focus: function () { track.focus(); },
      reset: reset,
      destroy: function () {}
    };
  });
  C.register('number', function (spec) { return C.create('slider', spec); });
})(window);
