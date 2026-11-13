/* Expert control kit: the shared contract, pointer and keyboard helpers, and the small controls (toggle, segmented, choice).
 *
 * Every control is `factory(spec) -> control`:
 *   spec    { label, value, schema, onInput(value, key), onCommit(value, key), id?, hint? ... type-specific options }
 *   control { el, get(), set(value) (no events), focus(), destroy() }
 * onInput fires at most once per frame while a gesture runs; onCommit fires once when it ends, with the same gesture key,
 * so a writer that coalesces on the key makes exactly one undo step per gesture. See docs/EXPERT-UI.md. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var C = X.controls = X.controls || {};
  var h = X.h, esc = X.esc;
  var FACTORIES = C._f = C._f || {};
  var nid = 0;

  C.register = function (name, factory) { FACTORIES[name] = factory; return factory; };
  C.create = function (name, spec) {
    var f = FACTORIES[name];
    if (!f) throw new Error('No expert control "' + name + '"');
    return f(spec || {});
  };
  C.has = function (name) { return !!FACTORIES[name]; };
  C.uid = function (p) { return (p || 'xpc') + (++nid); };

  /* A gesture: interactive mode on, one key, throttled input, one commit. */
  C.gesture = function (spec) {
    var key = null, last, active = false;
    var push = X.rafThrottle(function (v) { if (spec.onInput) spec.onInput(v, key); });
    return {
      start: function () { key = X.gesture(); active = true; X.interactive(true); return key; },
      input: function (v) { last = v; if (!key) key = X.gesture(); push(v); },
      end: function (v) {
        if (v === undefined) v = last;
        push.flush();
        if (active) X.interactive(false);
        active = false;
        var k = key || X.gesture();
        key = null;
        if (v !== undefined && spec.onCommit) spec.onCommit(v, k);
        else if (v !== undefined && spec.onInput) spec.onInput(v, k);
      },
      /* One-shot change (a click, a key press, a reset). Keyboard repeats within 700 ms share a key. */
      once: function (v, sticky) {
        var now = Date.now();
        if (!sticky || !this._k || now - this._t > 700) this._k = X.gesture();
        this._t = now;
        if (spec.onCommit) spec.onCommit(v, this._k);
        else if (spec.onInput) spec.onInput(v, this._k);
      },
      active: function () { return active; }
    };
  };

  /* Pointer drag with capture. o.start(e) may return false to ignore; o.move(e, dx, dy); o.end(e, moved); o.tap(e). */
  C.drag = function (el, o) {
    var st = null;
    function down(e) {
      if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
      if (st) return;
      if (o.start && o.start(e) === false) return;
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      if (o.prevent !== false) e.preventDefault();
    }
    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.moved && Math.abs(dx) + Math.abs(dy) < (o.slop == null ? 3 : o.slop)) return;
      st.moved = true;
      if (o.move) o.move(e, dx, dy);
    }
    function up(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st;
      st = null;
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      if (o.end) o.end(e, s.moved, e.type === 'pointercancel');
      if (!s.moved && e.type !== 'pointercancel' && o.tap) o.tap(e);
    }
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return function () {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    };
  };

  /* Double-click with a mouse, double-tap on touch. */
  C.doubleTap = function (el, fn) {
    var last = 0, lx = 0, ly = 0;
    el.addEventListener('dblclick', function (e) { fn(e); });
    el.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse') return;
      var now = Date.now();
      if (now - last < 320 && Math.abs(e.clientX - lx) < 24 && Math.abs(e.clientY - ly) < 24) { last = 0; fn(e); return; }
      last = now; lx = e.clientX; ly = e.clientY;
    });
  };

  /* Keys a control consumes never reach the studio's shortcuts (Backspace would delete the layer). */
  C.swallow = function (e) { e.preventDefault(); e.stopPropagation(); };

  /* Step size for keyboard and scrubbing: Shift x10, Alt (Option) /10. */
  C.stepFor = function (schema, e) {
    var s = schema.step || ((schema.max - schema.min) / 100) || 1;
    if (e && e.shiftKey) s *= 10;
    if (e && e.altKey) s /= 10;
    return s;
  };
  C.decimals = function (step) {
    var s = String(step || 1);
    return s.indexOf('e-') > 0 ? Number(s.split('e-')[1]) : (s.indexOf('.') >= 0 ? s.split('.')[1].length : 0);
  };
  C.format = function (v, schema) {
    if (v == null || !isFinite(v)) return '–';
    var d = schema.decimals != null ? schema.decimals : C.decimals(schema.step);
    var s = Number(v).toFixed(Math.min(4, d));
    if (schema.min < 0 && v > 0 && schema.signed !== false) s = '+' + s;
    var u = schema.unit === 'deg' ? '°' : schema.unit === 'ev' ? 'EV' : schema.unit;   /* packs spell degrees and stops both ways; the value column shows one */
    return s + (u ? (u === '%' || u === '°' ? '' : ' ') + u : '');
  };

  /* A row: label on the left, the control, and a reset button that shows only when the value is not the default. */
  C.row = function (spec, cls) {
    var lid = C.uid('xpl');
    var row = h('<div class="xp-row ' + (cls || '') + '"><label class="xp-lbl" id="' + lid + '"' + (spec.hint ? ' title="' + esc(spec.hint) + '"' : '') + '>' + esc(spec.label || '') + '</label><div class="xp-ctl"></div>' +
      '<button type="button" class="xp-rst" tabindex="-1" aria-label="Reset ' + esc(spec.label || '') + '" title="' + esc(X.say('Reset (double-click the label)', 'Reset (double-tap the label)')) + '">' + X.ic('reset') + '</button></div>');
    row._lid = lid;
    return row;
  };

  /* ---------- Toggle (bool) ---------- */
  C.register('bool', function (spec) {
    var id = C.uid('xpt');
    var el = h('<label class="xp-row xp-toggle" for="' + id + '"><span class="xp-lbl">' + esc(spec.label || '') + '</span><input type="checkbox" role="switch" id="' + id + '"' + (spec.value ? ' checked' : '') + '><i aria-hidden="true"></i></label>');
    var input = el.querySelector('input');
    var g = C.gesture(spec);
    input.addEventListener('change', function () { g.once(input.checked); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { C.swallow(e); input.click(); } else if (/^(Backspace|Delete)$/.test(e.key)) e.stopPropagation(); });
    return { el: el, get: function () { return input.checked; }, set: function (v) { input.checked = !!v; }, focus: function () { input.focus(); }, destroy: function () {} };
  });

  /* ---------- Segmented (few choices, all visible) ---------- */
  function optsOf(schema) {
    return (schema.options || schema.choices || []).map(function (o) { return o && typeof o === 'object' ? { value: o.value, label: o.label || String(o.value), icon: o.icon } : { value: o, label: String(o) }; });
  }
  C.options = optsOf;
  C.register('segmented', function (spec) {
    var schema = spec.schema || {};
    var opts = spec.options ? spec.options : optsOf(schema);
    var lid = C.uid('xps');
    var el = h('<div class="xp-row xp-segrow">' + (spec.label ? '<span class="xp-lbl" id="' + lid + '">' + esc(spec.label) + '</span>' : '') + '<div class="xp-seg" role="radiogroup"' + (spec.label ? ' aria-labelledby="' + lid + '"' : ' aria-label="' + esc(spec.aria || 'Options') + '"') + '></div></div>');
    var seg = el.querySelector('.xp-seg');
    var cur = spec.value;
    var g = C.gesture(spec);
    opts.forEach(function (o) {
      var b = h('<button type="button" role="radio" aria-checked="false" tabindex="-1" data-v="' + esc(String(o.value)) + '"' + (o.icon ? ' aria-label="' + esc(o.label) + '" title="' + esc(o.label) + '">' + X.ic(o.icon) : '>' + esc(o.label)) + '</button>');
      b._v = o.value;
      b.addEventListener('click', function () { if (cur === o.value && !spec.toggle) return; set(o.value); g.once(o.value); });
      seg.appendChild(b);
    });
    function set(v) {
      cur = v;
      var any = false;
      [].forEach.call(seg.children, function (b) { var on = b._v === v; if (on) any = true; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      if (!any && seg.firstChild) seg.firstChild.tabIndex = 0;
    }
    seg.addEventListener('keydown', function (e) {
      var bs = [].slice.call(seg.children), i = bs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : null;
      if (n == null) { if (/^(Backspace|Delete)$/.test(e.key)) e.stopPropagation(); return; }
      C.swallow(e);
      n = (n + bs.length) % bs.length;
      bs[n].focus(); bs[n].click();
    });
    set(cur);
    return { el: el, get: function () { return cur; }, set: set, focus: function () { var b = seg.querySelector('[tabindex="0"]'); if (b) b.focus(); }, destroy: function () {} };
  });

  /* ---------- Choice: segmented up to 4 short options, a native select beyond (searchable by typing, works everywhere) ---------- */
  C.register('choice', function (spec) {
    var schema = spec.schema || {};
    var opts = optsOf(schema);
    var short = opts.length <= (spec.maxSeg || 4) && opts.every(function (o) { return o.label.length <= 10; });
    if (short && spec.control !== 'select') return C.create('segmented', Object.assign({}, spec, { options: opts }));
    var sid = C.uid('xpc');
    var el = h('<div class="xp-row xp-choice"><label class="xp-lbl" for="' + sid + '">' + esc(spec.label || '') + '</label><div class="xp-ctl"><select class="xp-select" id="' + sid + '">' +
      opts.map(function (o, i) { return '<option value="' + i + '">' + esc(o.label) + '</option>'; }).join('') + '</select></div></div>');
    var sel = el.querySelector('select');
    var g = C.gesture(spec);
    function idx(v) { for (var i = 0; i < opts.length; i++) if (opts[i].value === v) return i; return 0; }
    sel.value = String(idx(spec.value));
    sel.addEventListener('change', function () { g.once(opts[Number(sel.value)].value); });
    sel.addEventListener('keydown', function (e) { if (/^(Backspace|Delete)$/.test(e.key)) e.stopPropagation(); });
    return { el: el, get: function () { return opts[Number(sel.value)].value; }, set: function (v) { sel.value = String(idx(v)); }, focus: function () { sel.focus(); }, destroy: function () {} };
  });

  /* ---------- Seed: number + new random seed ---------- */
  C.register('seed', function (spec) {
    var sid = C.uid('xpd');
    var el = h('<div class="xp-row xp-seed"><label class="xp-lbl" for="' + sid + '">' + esc(spec.label || 'Seed') + '</label><div class="xp-ctl"><input class="xp-field" id="' + sid + '" inputmode="numeric" autocomplete="off" spellcheck="false"><button type="button" class="xp-ib" aria-label="New random seed" title="New random seed">' + X.ic('dice') + '</button></div></div>');
    var input = el.querySelector('input');
    var g = C.gesture(spec);
    var cur = spec.value == null ? 1 : spec.value;
    input.value = cur;
    function commit(v) { cur = X.coerce({ type: 'seed' }, v); input.value = cur; g.once(cur); }
    input.addEventListener('change', function () { commit(input.value); });
    input.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
    el.querySelector('button').addEventListener('click', function () { commit(Math.floor(Math.random() * 1e9)); });
    return { el: el, get: function () { return cur; }, set: function (v) { cur = v; if (document.activeElement !== input) input.value = v; }, focus: function () { input.focus(); }, destroy: function () {} };
  });
})(window);
