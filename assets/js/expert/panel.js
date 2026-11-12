/* LocalEditor Expert: panels generated from effect registrations, and the develop panel.
 *
 * X.panel.build(def, binding) turns one registration into controls:
 *   def      a registration from LE.fx.describe(): { id, name, params: { key: schema }, ui: { section, controls: [...] } }
 *   binding  { entry() -> fx entry | null, write(param, value, gestureKey, live), layerId() -> id, histogram() }
 * ui.controls items (all optional; without ui.controls every param gets its default control, in declaration order):
 *   'param'                                        the default control for that param's type
 *   { param, control, label, gradient, fine, when: { otherParam: value } }   override or decorate one control
 *   { heading: 'Tone' }                            a small sub-heading
 *   { control: 'wheels', params: [shadows, midtones, highlights, global], global, balance, blending }
 *   { control: 'mixer', rows: { r: [rr, rg, rb], g: [...], b: [...] } }   nine number params as a matrix
 *   { control: 'line', params: [a, b], style: 'gradient' | 'line', label }   two point params as one line on the canvas
 * Controls are created when a section opens; a value change updates controls in place (never re-renders the panel). */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var C = X.controls, h = X.h, esc = X.esc;
  var DEFAULT = { number: 'slider', bool: 'bool', choice: 'choice', color: 'color', point: 'point', angle: 'angle', curve: 'curve', wheel: 'wheel', bands: 'bands', lut: 'lut', seed: 'seed' };
  /* Gradient tracks by parameter name, so a registration gets them without saying so. */
  var GRAD_BY_NAME = { temperature: 'temperature', temp: 'temperature', warmth: 'temperature', tint: 'tint', hue: 'hue' };

  function labelOf(key, ps) { return (ps && ps.label) || key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase(); }
  function val(entry, key, ps) { var p = entry && entry.p; return p && p[key] !== undefined ? p[key] : X.paramDefault(ps); }

  function build(def, B) {
    var el = h('<div class="xp-fxpanel" data-fx="' + esc(def.id) + '"></div>');
    var items = [];   /* { keys: [...], ctl, read(entry) -> value for ctl.set } */
    var params = def.params || {};
    var spec = (def.ui && def.ui.controls) || Object.keys(params);
    var used = {};
    function entry() { return B.entry(); }
    function single(it) {
      var key = typeof it === 'string' ? it : it.param;
      var ps = params[key];
      if (!ps) { console.warn('LE.expert: ' + def.id + ' ui names an unknown param "' + key + '"'); return; }
      used[key] = 1;
      var o = typeof it === 'object' ? it : {};
      var type = o.control || (ps.ui && ps.ui.control) || DEFAULT[ps.type];
      if (!type || !C.has(type)) {
        el.appendChild(h('<p class="xp-note">No control for “' + esc(ps.type) + '” (' + esc(key) + ').</p>'));
        console.warn('LE.expert: no control for param type ' + ps.type);
        return;
      }
      var sc = Object.assign({}, ps);
      var ctl = C.create(type, {
        label: o.label || labelOf(key, ps), schema: sc, value: val(entry(), key, ps),
        gradient: o.gradient || (ps.ui && ps.ui.gradient) || (ps.type === 'number' ? GRAD_BY_NAME[key] : null), fine: o.fine,
        control: o.control, style: o.style, hint: ps.help || ps.hint,
        layerId: B.layerId, histogram: B.histogram, channels: ps.channels,
        onInput: function (v, k) { B.write(key, v, k, true); },
        onCommit: function (v, k) { B.write(key, v, k, false); }
      });
      ctl.el.setAttribute('data-param', key);
      items.push({ keys: [key], ctl: ctl, read: function (e) { return val(e, key, ps); }, when: o.when });
      el.appendChild(ctl.el);
    }
    function group(it) {
      if (it.heading) { el.appendChild(h('<h4 class="xp-subhead">' + esc(it.heading) + '</h4>')); return; }
      if (it.row) { it.row.forEach(function (k) { single(k); }); return; }
      if (it.control === 'wheels') {
        var keys = (it.params || []).filter(function (k) { return params[k]; });
        keys.forEach(function (k) { used[k] = 1; });
        var bal = it.balance && params[it.balance], bl = it.blending && params[it.blending];
        if (bal) used[it.balance] = 1;
        if (bl) used[it.blending] = 1;
        var wc = C.create('wheels', {
          globalKey: it.global,
          wheels: keys.map(function (k) { return { key: k, label: labelOf(k, params[k]), value: val(entry(), k, params[k]) }; }),
          balance: bal ? { key: it.balance, label: labelOf(it.balance, bal), value: val(entry(), it.balance, bal), schema: bal } : null,
          blending: bl ? { key: it.blending, label: labelOf(it.blending, bl), value: val(entry(), it.blending, bl), schema: bl } : null,
          onChange: function (k, v, gk, live) { B.write(k, v, gk, live); }
        });
        var all = keys.concat(bal ? [it.balance] : [], bl ? [it.blending] : []);
        items.push({ keys: all, ctl: wc, read: function (e) { var o = {}; all.forEach(function (k) { o[k] = val(e, k, params[k]); }); return o; } });
        el.appendChild(wc.el);
        return;
      }
      if (it.control === 'mixer') {
        var rows = it.rows || {}, flat = [];
        ['r', 'g', 'b'].forEach(function (r) { (rows[r] || []).forEach(function (k) { flat.push(k); used[k] = 1; }); });
        var ps0 = params[flat[0]] || {};
        var read = function (e) { var o = {}; ['r', 'g', 'b'].forEach(function (r) { o[r] = (rows[r] || []).map(function (k) { return val(e, k, params[k]); }); }); return o; };
        var mc = C.create('mixer', { label: it.label || def.name, schema: ps0, value: read(entry()),
          onInput: function (v, k) { B.writeMany(unpack(v), k, true); }, onCommit: function (v, k) { B.writeMany(unpack(v), k, false); } });
        var unpack = function (v) { var o = {}; ['r', 'g', 'b'].forEach(function (r) { (rows[r] || []).forEach(function (k, j) { o[k] = v[r][j]; }); }); return o; };
        items.push({ keys: flat, ctl: mc, read: read });
        el.appendChild(mc.el);
        return;
      }
      if (it.control === 'line') {
        var a = it.params[0], b = it.params[1];
        used[a] = used[b] = 1;
        var rd = function (e) { return { a: val(e, a, params[a]), b: val(e, b, params[b]) }; };
        var lc = C.create('line', { label: it.label || 'Line', style: it.style, labels: [labelOf(a, params[a]), labelOf(b, params[b])], layerId: B.layerId, value: rd(entry()),
          schema: { default: { a: X.paramDefault(params[a]), b: X.paramDefault(params[b]) } },
          onInput: function (v, k) { var o = {}; o[a] = v.a; o[b] = v.b; B.writeMany(o, k, true); }, onCommit: function (v, k) { var o = {}; o[a] = v.a; o[b] = v.b; B.writeMany(o, k, false); } });
        items.push({ keys: [a, b], ctl: lc, read: rd });
        el.appendChild(lc.el);
        return;
      }
      single(it);
    }
    spec.forEach(function (it) { if (typeof it === 'string') single(it); else group(it); });
    /* Params the ui list forgot still get a control, so nothing is unreachable. */
    if (def.ui && def.ui.controls) Object.keys(params).forEach(function (k) { if (!used[k] && !(params[k].ui && params[k].ui.hidden)) single(k); });
    function applyWhen(e) {
      items.forEach(function (it) {
        if (!it.when) return;
        var show = Object.keys(it.when).every(function (k) { var want = it.when[k], v = val(e, k, params[k]); return Array.isArray(want) ? want.indexOf(v) >= 0 : v === want; });
        it.ctl.el.hidden = !show;
      });
    }
    applyWhen(entry());
    return {
      el: el, items: items,
      refresh: function () { var e = entry(); items.forEach(function (it) { it.ctl.set(it.read(e)); }); applyWhen(e); },
      destroy: function () { items.forEach(function (it) { if (it.ctl.destroy) it.ctl.destroy(); }); }
    };
  }

  /* A binding to "the first entry of this type on this layer", created on the first edit (one undo step with the edit). */
  function bindFirst(def, layerId, extra) {
    var B = {
      layerId: function () { return layerId(); },
      entry: function () { return X.doc.firstOfType(layerId(), def.id); },
      write: function (k, v, key, live) { var o = {}; o[k] = v; B.writeMany(o, key, live); },
      writeMany: function (o, key) {
        var id = layerId(); if (!id) return;
        var e = X.doc.firstOfType(id, def.id);
        if (!e) { X.doc.addFx(id, def.id, { p: o }, key); return; }
        X.doc.setParams(id, e.id, o, key);
      },
      histogram: function () { return X.scopes && X.scopes.data ? X.scopes.data.hist : null; }
    };
    return Object.assign(B, extra || {});
  }
  /* A binding to one specific entry (the layers panel's effect rows). */
  function bindEntry(layerId, fxId) {
    var B = {
      layerId: function () { return layerId; },
      entry: function () { return X.doc.entry(layerId, fxId); },
      write: function (k, v, key) { X.doc.setParam(layerId, fxId, k, v, key); },
      writeMany: function (o, key) { X.doc.setParams(layerId, fxId, o, key); },
      histogram: function () { return X.scopes && X.scopes.data ? X.scopes.data.hist : null; }
    };
    return B;
  }
  X.panel = { build: build, bindFirst: bindFirst, bindEntry: bindEntry, labelOf: labelOf, DEFAULT: DEFAULT };

  /* ---------- Develop panel ----------
     Sections in the professional order (X.SECTIONS); each with an on/off eye (all its entries), a reset, alt/option-click to
     solo (only that section open). Bodies are built when first opened. */
  X.develop = function (host, opts) {
    opts = opts || {};
    var open = X.lsGet('le-expert-open', { Light: true });
    var solo = X.lsGet('le-expert-solo', false);
    var built = {};   /* section -> [{ def, panel }] */
    var secEls = {};
    var targetId = null, lastSig = '';
    var el = h('<div class="xp-develop"><div class="xp-dev-target"></div><div class="xp-dev-secs"></div></div>');
    var secsHost = el.querySelector('.xp-dev-secs'), tgt = el.querySelector('.xp-dev-target');
    host.appendChild(el);
    function target() { return targetId; }
    function pickTarget() {
      var c = global.LEStudio, ids = c ? c.sel() : [];
      var l = ids.length === 1 ? c.L(ids[0]) : null;
      if (l && (l.type === 'image' || l.type === 'adjust' || l.type === 'group')) return l.id;
      if (!ids.length && c) { var b = c.targetImage && c.targetImage(); return b ? b.id : null; }
      return null;
    }
    function entriesIn(sec, list) { var d = X.sectionTypes(sec); return (list || X.doc.fx(targetId)).filter(function (e) { return d.indexOf(e.type) >= 0; }); }
    function sig() {
      var l = targetId && X.doc.layer(targetId);
      return (targetId || '') + '|' + X.defs().length + '|' + (l && l.fx ? l.fx.map(function (e) { return e.id + e.type; }).join(',') : '') + '|' + (X.doc.mask(l) ? 1 : 0);
    }
    function headState(sec, list) {
      var s = secEls[sec]; if (!s) return;
      var es = entriesIn(sec, list);
      var any = es.length > 0, off = any && es.every(function (e) { return e.on === false; });
      s.classList.toggle('is-used', any);
      s.classList.toggle('is-off', off);
      var eye = s.querySelector('[data-act="eye"]');
      eye.disabled = !any; eye.setAttribute('aria-pressed', off ? 'false' : 'true');
      eye.innerHTML = X.ic(off ? 'eyeOff' : 'eye');
      eye.setAttribute('aria-label', (off ? 'Turn on ' : 'Turn off ') + sec);
      s.querySelector('[data-act="reset"]').disabled = !any;
    }
    function buildBody(sec) {
      var s = secEls[sec], body = s.querySelector('.xp-sec-body');
      (built[sec] || []).forEach(function (b) { b.panel.destroy(); });
      body.innerHTML = '';
      built[sec] = [];
      var list = X.defs().filter(function (d) { return d.section === sec; });
      list.forEach(function (d) {
        var p = build(d, bindFirst(d, target));
        if (list.length > 1 && !(d.ui && d.ui.bare)) {
          var wrap = h('<div class="xp-fxgroup"><h4 class="xp-subhead">' + esc(d.name || d.id) + '</h4></div>');
          wrap.appendChild(p.el); body.appendChild(wrap);
        } else body.appendChild(p.el);
        built[sec].push({ def: d, panel: p });
      });
    }
    function toggle(sec, on, soloClick) {
      if (soloClick) { solo = !(solo && open[sec]); X.lsSet('le-expert-solo', solo); }
      if (solo && on) Object.keys(secEls).forEach(function (k) { if (k !== sec && open[k]) setOpen(k, false); });
      setOpen(sec, on);
      X.lsSet('le-expert-open', open);
    }
    function setOpen(sec, on) {
      open[sec] = on;
      var s = secEls[sec]; if (!s) return;
      s.classList.toggle('is-open', on);
      s.querySelector('.xp-sec-tog').setAttribute('aria-expanded', on ? 'true' : 'false');
      s.querySelector('.xp-sec-body').hidden = !on;
      if (on && sec === 'Mask' && !s._mask) buildMask(s);
      else if (on && !built[sec]) buildBody(sec);
    }
    function render() {
      Object.keys(built).forEach(function (k) { built[k].forEach(function (b) { b.panel.destroy(); }); });
      built = {}; secEls = {};
      secsHost.innerHTML = '';
      var l = targetId && X.doc.layer(targetId);
      tgt.innerHTML = '';
      if (!l) {
        var c = global.LEStudio;
        tgt.appendChild(h('<div class="xp-empty"><strong>' + (c && c.S && c.S.project ? 'Select a photo or an adjustment layer' : 'Open a photo to start') + '</strong><p>' + esc(c && c.S && c.S.project ? 'Develop settings apply to photos, groups and adjustment layers.' : 'The develop panel, masks and scopes work on the photo you open.') + '</p></div>'));
        if (c && c.S && c.S.project) {
          var b = h('<button type="button" class="btn btn-sm">' + X.ic('adjust') + '<span>New adjustment layer</span></button>');
          b.addEventListener('click', function () { if (X.layers && X.layers.addAdjustMenu) X.layers.addAdjustMenu(b); });
          tgt.firstChild.appendChild(b);
        }
        lastSig = sig();
        return;
      }
      tgt.appendChild(h('<div class="xp-dev-name">' + X.ic(l.type === 'adjust' ? 'adjust' : 'layers') + '<span>' + esc(l.name || 'Layer') + '</span>' + (l.type === 'adjust' ? '<small>Adjustment layer</small>' : '') + '</div>'));
      var secs = X.sections();
      if (!secs.length) secsHost.appendChild(h('<p class="xp-note">The effect library is not loaded on this device yet.</p>'));
      /* Layer mask first, then the registry's sections in the professional order. */
      secs = ['Mask'].concat(secs);
      secs.forEach(function (sec) {
        var isMask = sec === 'Mask';
        var s = h('<section class="xp-sec" data-sec="' + esc(sec) + '"><div class="xp-sec-head"><button type="button" class="xp-sec-tog" aria-expanded="false" title="' + esc(X.say('Alt-click: show only this section', 'Show or hide')) + '">' + X.ic('chev', 'xp-chev') + '<span>' + esc(isMask ? 'Layer mask' : sec) + '</span></button>' +
          (isMask ? '' : '<button type="button" class="xp-ib" data-act="eye" aria-pressed="true">' + X.ic('eye') + '</button><button type="button" class="xp-ib" data-act="reset" aria-label="Reset ' + esc(sec) + '" title="Reset ' + esc(sec) + '">' + X.ic('reset') + '</button>') +
          '</div><div class="xp-sec-body" hidden></div></section>');
        secEls[sec] = s;
        s.querySelector('.xp-sec-tog').addEventListener('click', function (e) { toggle(sec, !open[sec], e.altKey); });
        if (!isMask) {
          s.querySelector('[data-act="eye"]').addEventListener('click', function () {
            var es = entriesIn(sec); if (!es.length) return;
            var turnOn = es.every(function (e) { return e.on === false; });
            var list = X.clone(X.doc.fx(targetId)); var ids = es.map(function (e) { return e.id; });
            list.forEach(function (e) { if (ids.indexOf(e.id) >= 0) e.on = turnOn; });
            X.doc.setFx(targetId, list, X.gesture());
          });
          s.querySelector('[data-act="reset"]').addEventListener('click', function () {
            var ids = entriesIn(sec).map(function (e) { return e.id; });
            X.doc.setFx(targetId, X.doc.fx(targetId).filter(function (e) { return ids.indexOf(e.id) < 0; }), X.gesture());
          });
          headState(sec);
        } else {
          s.classList.toggle('is-used', !!X.doc.mask(l));
          built[sec] = [];
        }
        secsHost.appendChild(s);
        if (isMask) {
          if (open.Mask) setOpen(sec, true);
        } else if (open[sec]) setOpen(sec, true);
      });
      lastSig = sig();
    }
    function buildMask(s) {
      if (s._mask) { s._mask.destroy(); }
      var body = s.querySelector('.xp-sec-body'); body.innerHTML = '';
      var id = targetId;
      s._mask = C.create('mask', {
        label: 'Layer mask', value: X.doc.mask(X.doc.layer(id)), layerId: function () { return id; }, fxId: null,
        sample: function () { return null; },
        onInput: function (m, k) { X.doc.setMask(id, null, m, k); },
        onCommit: function (m, k) { X.doc.setMask(id, null, m, k); },
        onPaint: function (i, erase) { X.emit('paint-mask', { layerId: id, fxId: null, part: i, erase: erase }); }
      });
      body.appendChild(s._mask.el);
    }
    /* Called on every document change (once per frame at most). Section heads update only when entries or their on/off
       state change; built controls get their values in place. */
    var lastHead = '';
    function sync() {
      var t = pickTarget();
      if (t !== targetId) { targetId = t; render(); X.emit('target-layer', t); return; }
      var l = targetId && X.doc.layer(targetId), list = (l && l.fx) || [];
      var hs = list.map(function (e) { return e.id + e.type + (e.on === false ? 0 : 1); }).join(',') + (X.doc.mask(l) ? 'm' : '');
      if (hs !== lastHead) {
        lastHead = hs;
        Object.keys(secEls).forEach(function (k) { if (k !== 'Mask') headState(k, list); });
        var ms = secEls.Mask; if (ms) ms.classList.toggle('is-used', !!X.doc.mask(l));
      }
      lastSig = sig();
      Object.keys(built).forEach(function (k) { built[k].forEach(function (b) { b.panel.refresh(); }); });
      var m = secEls.Mask; if (m && m._mask) m._mask.set(X.doc.mask(l));
    }
    var syncSoon = X.rafThrottle(sync);
    targetId = pickTarget();
    render();
    return {
      el: el, sync: syncSoon, syncNow: sync, target: target,
      open: function (sec, on) { if (secEls[sec]) toggle(sec, on !== false, false); },
      isOpen: function (sec) { return !!open[sec]; },
      sections: function () { return Object.keys(secEls); },
      rebuild: function () { targetId = pickTarget(); render(); },
      destroy: function () { Object.keys(built).forEach(function (k) { built[k].forEach(function (b) { b.panel.destroy(); }); }); el.remove(); }
    };
  };
})(window);
