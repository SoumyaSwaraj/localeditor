/* Expert control kit: mask manager, the CPU reference evaluation of a mask, and the on-canvas mask overlay.
 *
 * A mask is { parts: [ { kind, mode: 'add'|'subtract'|'intersect', invert, feather, density, ...kind fields } ] }
 * (docs/EXPERT-MODE.md). Coordinates are fractions of the layer box. Units used here (see docs/EXPERT-UI.md "Masks"):
 *   feather, density, soft, range, min, max, s, l: 0–1   h, rotation: degrees
 * Combination, in order, starting from an empty mask: add = max(m, v), subtract = m * (1 - v), intersect = m * v. */
(function (global) {
  'use strict';
  var LE = global.LE, X = LE && LE.expert;
  if (!X || !X.controls || !X.controls.register) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;

  var KINDS = {
    linear: { label: 'Linear gradient', icon: 'linear', make: function () { return { x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.6 }; } },
    radial: { label: 'Radial gradient', icon: 'radial', make: function () { return { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, rotation: 0 }; } },
    luma: { label: 'Luminance range', icon: 'luma', make: function () { return { min: 0.6, max: 1, soft: 0.15 }; } },
    color: { label: 'Colour range', icon: 'color', make: function () { return { h: 30, s: 0.5, l: 0.5, range: 0.12, soft: 0.1 }; } },
    subject: { label: 'Subject', icon: 'subject', make: function () { return {}; } },
    asset: { label: 'Brush', icon: 'brush', make: function () { return { asset: null }; } },
    depth: { label: 'Depth range', icon: 'depth', make: function () { return { near: 0, far: 0.5, soft: 0.1 }; } },
    face: { label: 'Face area', icon: 'face', make: function () { return { part: 'skin' }; } }
  };
  var MODES = [{ value: 'add', label: 'Add', icon: 'plus' }, { value: 'subtract', label: 'Subtract', icon: 'minus' }, { value: 'intersect', label: 'Intersect', icon: 'clip' }];
  var VIEWS = [{ value: 'off', label: 'Off' }, { value: 'overlay', label: 'Overlay' }, { value: 'wb', label: 'White on black' }, { value: 'bw', label: 'Black on white' }, { value: 'image', label: 'On image' }];
  X.MASK_KINDS = KINDS;

  function newPart(kind) { return Object.assign({ kind: kind, mode: 'add', invert: false, feather: kind === 'radial' ? 0.5 : 0.25, density: 1 }, KINDS[kind].make()); }
  X.maskPart = newPart;

  /* ---------- CPU reference evaluation ----------
     opts: { w, h, pixels: Uint8ClampedArray (RGBA of the layer at w x h) | null, assets: { id: canvas }, cutout: canvas | null }
     Returns Float32Array(w * h) in 0–1. */
  function smooth(a, b, x) { if (a === b) return x < a ? 0 : 1; var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function rgb2hsl(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, hh = 0, s = 0;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hh = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh *= 60;
    }
    return [hh, s, l];
  }
  X.rgb2hsl = rgb2hsl;
  function alphaOf(canvas, w, hh) {
    if (!canvas) return null;
    var c = document.createElement('canvas'); c.width = w; c.height = hh;
    var cx = c.getContext('2d'); cx.drawImage(canvas, 0, 0, w, hh);
    var d = cx.getImageData(0, 0, w, hh).data, out = new Float32Array(w * hh);
    /* A painted mask is white-on-transparent or white-on-black: use alpha x luminance. */
    for (var i = 0; i < w * hh; i++) out[i] = d[i * 4 + 3] / 255 * ((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765);
    return out;
  }
  function evalPart(p, o) {
    var w = o.w, hh = o.h, n = w * hh, out = new Float32Array(n), px = o.pixels;
    var f = clamp(p.feather == null ? 0.25 : p.feather, 0, 1);
    var i, x, y, v;
    if (p.kind === 'linear') {
      var dx = p.x1 - p.x0, dy = p.y1 - p.y0, len2 = dx * dx + dy * dy || 1e-6;
      for (y = 0; y < hh; y++) for (x = 0; x < w; x++) {
        var t = (((x + 0.5) / w - p.x0) * dx + ((y + 0.5) / hh - p.y0) * dy) / len2;
        t = clamp(t, 0, 1);
        out[y * w + x] = 1 - (t + (t * t * (3 - 2 * t) - t) * f);
      }
    } else if (p.kind === 'radial') {
      var rot = (p.rotation || 0) * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot), rx = Math.max(1e-4, p.rx), ry = Math.max(1e-4, p.ry);
      for (y = 0; y < hh; y++) for (x = 0; x < w; x++) {
        var ux = (x + 0.5) / w - p.cx, uy = (y + 0.5) / hh - p.cy;
        var lx = ux * cs + uy * sn, ly = -ux * sn + uy * cs;
        var d = Math.sqrt((lx / rx) * (lx / rx) + (ly / ry) * (ly / ry));
        out[y * w + x] = 1 - smooth(1 - f, 1 + 1e-6, d);
      }
    } else if (p.kind === 'luma' || p.kind === 'color') {
      if (!px) { out.fill(1); return out; }
      var soft = Math.max(1e-3, p.soft == null ? 0.1 : p.soft);
      for (i = 0; i < n; i++) {
        var r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
        if (p.kind === 'luma') {
          var L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          v = smooth(p.min - soft, p.min, L) * (1 - smooth(p.max, p.max + soft, L));
        } else {
          var q = rgb2hsl(r, g, b);
          var dh = Math.abs(q[0] - p.h); if (dh > 180) dh = 360 - dh;
          var dist = dh / 180 * Math.min(1, q[1] * 2.5) + Math.abs(q[1] - p.s) * 0.25 + Math.abs(q[2] - p.l) * 0.25 + (1 - Math.min(1, q[1] * 2.5)) * 0.5;
          v = 1 - smooth(p.range, p.range + soft, dist);
        }
        out[i] = v;
      }
    } else if (p.kind === 'asset') {
      var a = p.asset && o.assets && o.assets[p.asset];
      if (!a) return out;
      out.set(alphaOf(a, w, hh));
    } else if (p.kind === 'subject') {
      if (o.cutout) out.set(alphaOf(o.cutout, w, hh)); else out.fill(1);
    } else {
      out.fill(1);
    }
    return out;
  }
  function evalMask(mask, o) {
    var n = o.w * o.h, acc = new Float32Array(n);
    if (!mask || !mask.parts || !mask.parts.length) { acc.fill(1); return acc; }
    mask.parts.forEach(function (p, k) {
      var v = evalPart(p, o), den = clamp(p.density == null ? 1 : p.density, 0, 1), inv = !!p.invert, mode = p.mode || 'add';
      for (var i = 0; i < n; i++) {
        var x = v[i]; if (inv) x = 1 - x; x *= den;
        if (k === 0 && mode === 'intersect') acc[i] = x;
        else if (mode === 'add') acc[i] = Math.max(acc[i], x);
        else if (mode === 'subtract') acc[i] = acc[i] * (1 - x);
        else acc[i] = acc[i] * x;
      }
    });
    return acc;
  }
  X.evalMask = evalMask;
  X.evalMaskPart = evalPart;

  /* ---------- Overlay on the canvas ----------
     X.canvas.maskOverlay(layerId, field: { w, h, data: Float32Array }, view) ; view null hides it. */
  var ov = null;
  X.canvas = X.canvas || {};
  X.canvas.maskOverlay = function (layerId, field, view, box) {
    var host = X.canvas._host && X.canvas._host();
    if (!view || view === 'off' || !field || !host) { if (ov) ov.hidden = true; return; }
    if (!ov || !ov.isConnected) { ov = document.createElement('canvas'); ov.className = 'xp-mask-ov'; ov.setAttribute('aria-hidden', 'true'); host.appendChild(ov); }
    ov.hidden = false;
    if (ov.width !== field.w || ov.height !== field.h) { ov.width = field.w; ov.height = field.h; }
    var cx = ov.getContext('2d'), img = cx.createImageData(field.w, field.h), d = img.data, m = field.data;
    for (var i = 0; i < m.length; i++) {
      var v = m[i], j = i * 4;
      if (view === 'overlay') { d[j] = 229; d[j + 1] = 52; d[j + 2] = 62; d[j + 3] = Math.round(v * 140); }
      else if (view === 'wb') { var c = Math.round(v * 255); d[j] = d[j + 1] = d[j + 2] = c; d[j + 3] = 255; }
      else if (view === 'bw') { var c2 = Math.round((1 - v) * 255); d[j] = d[j + 1] = d[j + 2] = c2; d[j + 3] = 255; }
      else { d[j] = d[j + 1] = d[j + 2] = 12; d[j + 3] = Math.round((1 - v) * 200); }
    }
    cx.putImageData(img, 0, 0);
    var b = box || (X.canvas._box && X.canvas._box(layerId));
    if (!b) return;
    var hr = host.getBoundingClientRect();
    ov.style.left = (b.x - hr.left) + 'px'; ov.style.top = (b.y - hr.top) + 'px';
    ov.style.width = b.w + 'px'; ov.style.height = b.h + 'px';
    ov.style.transform = b.rotation ? 'rotate(' + b.rotation + 'deg)' : '';
  };

  /* ---------- Mask manager ----------
     spec: { label, value: mask | null, layerId: () => id, fxId, kinds: [...] (default: all that apply),
             sample: (clientX, clientY) => { r, g, b } | null  (eyedropper), onInput, onCommit, onPaint(partIndex, erase), view: 'overlay' } */
  C.register('mask', function (spec) {
    var mask = spec.value && spec.value.parts ? X.clone(spec.value) : { parts: [] };
    var open = 0;
    var view = X.lsGet('le-expert-mask-view', 'overlay');
    var el = h('<div class="xp-mask" role="group" aria-label="' + esc(spec.label || 'Mask') + '"><div class="xp-mask-head"><span class="xp-lbl">' + esc(spec.label || 'Mask') + '</span><span class="xp-grow"></span>' +
      '<button type="button" class="xp-ib" data-act="copy" aria-label="Copy mask" title="Copy mask">' + X.ic('copy') + '</button>' +
      '<button type="button" class="xp-ib" data-act="paste" aria-label="Paste mask" title="Paste mask">' + X.ic('paste') + '</button>' +
      '<button type="button" class="xp-ib" data-act="clear" aria-label="Remove mask" title="Remove mask">' + X.ic('trash') + '</button>' +
      '<button type="button" class="btn btn-sm xp-mask-add" aria-haspopup="menu" aria-expanded="false">' + X.ic('plus') + '<span>Add</span></button></div>' +
      '<div class="xp-mask-view"></div><ol class="xp-mask-parts"></ol><p class="xp-mask-empty">' + esc(X.say('No mask: the effect applies everywhere. Add a gradient, a range or a brush to limit it.', 'No mask: the effect applies everywhere. Add a gradient, a range or a brush to limit it.')) + '</p></div>');
    var list = el.querySelector('.xp-mask-parts'), empty = el.querySelector('.xp-mask-empty');
    var g = C.gesture(spec);
    var viewCtl = C.create('segmented', { label: 'Show', options: VIEWS, value: view, onCommit: function (v) { view = v; X.lsSet('le-expert-mask-view', v); X.emit('mask-view', { layerId: spec.layerId && spec.layerId(), fxId: spec.fxId, mask: mask, view: v }); } });
    el.querySelector('.xp-mask-view').appendChild(viewCtl.el);
    var live = [];
    function send(liveMode, key) {
      var out = mask.parts.length ? X.clone(mask) : null;
      if (liveMode) { if (spec.onInput) spec.onInput(out, key); } else (spec.onCommit || spec.onInput)(out, key);
      X.emit('mask-view', { layerId: spec.layerId && spec.layerId(), fxId: spec.fxId, mask: mask, view: view });
    }
    function field(p, i, name, label, sc, extra) {
      var c = C.create('slider', Object.assign({ label: label, compact: true, value: Math.round((p[name] == null ? 0 : p[name]) * (sc.mul || 100)), schema: { min: sc.min == null ? 0 : sc.min, max: sc.max == null ? 100 : sc.max, step: 1, default: sc.d, unit: sc.unit || '' },
        onInput: function (v, k) { p[name] = v / (sc.mul || 100); send(true, k); }, onCommit: function (v, k) { p[name] = v / (sc.mul || 100); send(false, k); } }, extra || {}));
      live.push(c);
      return c.el;
    }
    function partRow(p, i) {
      var K = KINDS[p.kind] || { label: p.kind, icon: 'mask' };
      var li = h('<li class="xp-part' + (open === i ? ' is-open' : '') + '"><div class="xp-part-head"><button type="button" class="xp-part-tog" aria-expanded="' + (open === i) + '">' + X.ic(K.icon) + '<span>' + esc(K.label) + '</span></button><span class="xp-part-mode"></span>' +
        '<button type="button" class="xp-ib" data-act="inv" aria-pressed="' + !!p.invert + '" aria-label="Invert this part" title="Invert">' + X.ic('invert') + '</button>' +
        '<button type="button" class="xp-ib" data-act="del" aria-label="Remove this part" title="Remove">' + X.ic('x') + '</button></div><div class="xp-part-body"></div></li>');
      var mc = C.create('segmented', { aria: 'Combine', options: MODES, value: p.mode || 'add', onCommit: function (v, k) { p.mode = v; send(false, k); } });
      li.querySelector('.xp-part-mode').appendChild(mc.el.querySelector('.xp-seg'));
      li.querySelector('.xp-part-tog').addEventListener('click', function () { open = open === i ? -1 : i; render(); });
      li.querySelector('[data-act="inv"]').addEventListener('click', function () { p.invert = !p.invert; send(false, X.gesture()); render(); });
      li.querySelector('[data-act="del"]').addEventListener('click', function () { mask.parts.splice(i, 1); if (open >= mask.parts.length) open = mask.parts.length - 1; send(false, X.gesture()); render(); });
      if (open !== i) return li;
      var body = li.querySelector('.xp-part-body');
      var lid = spec.layerId;
      if (p.kind === 'linear') {
        var lc = C.create('line', { label: 'Ends', style: 'gradient', labels: ['Full effect', 'No effect'], layerId: lid, value: { a: { x: p.x0, y: p.y0 }, b: { x: p.x1, y: p.y1 } },
          onInput: function (v, k) { p.x0 = v.a.x; p.y0 = v.a.y; p.x1 = v.b.x; p.y1 = v.b.y; send(true, k); }, onCommit: function (v, k) { p.x0 = v.a.x; p.y0 = v.a.y; p.x1 = v.b.x; p.y1 = v.b.y; send(false, k); } });
        live.push(lc); body.appendChild(lc.el);
        autoCanvas(lc);
      } else if (p.kind === 'radial') {
        var pc = C.create('point', { label: 'Centre', layerId: lid, value: { x: p.cx, y: p.cy }, schema: { default: { x: 0.5, y: 0.5 } },
          onInput: function (v, k) { p.cx = v.x; p.cy = v.y; send(true, k); radialHandles(); }, onCommit: function (v, k) { p.cx = v.x; p.cy = v.y; send(false, k); } });
        live.push(pc); body.appendChild(pc.el);
        body.appendChild(field(p, i, 'rx', 'Width', { d: 30 }));
        body.appendChild(field(p, i, 'ry', 'Height', { d: 30 }));
        var ac = C.create('angle', { label: 'Rotation', value: p.rotation || 0, schema: { min: -180, max: 180, step: 1, default: 0, unit: '°' }, onInput: function (v, k) { p.rotation = v; send(true, k); }, onCommit: function (v, k) { p.rotation = v; send(false, k); } });
        live.push(ac); body.appendChild(ac.el);
        var radialHandles = function () {
          var id = lid && lid();
          if (!id || !X.canvas.attached || !X.canvas.attached()) return;
          var rot = (p.rotation || 0) * Math.PI / 180;
          if (!radialHandles.hd || X.canvas.current() !== radialHandles.spec) {
            radialHandles.spec = { layerId: id, points: [], ellipses: [], onDrag: function (pid, x, y, ph) {
              if (ph === 'start' || !radialHandles.key) radialHandles.key = X.gesture();
              if (pid === 'c') { p.cx = clamp(x, 0, 1); p.cy = clamp(y, 0, 1); pc.set({ x: p.cx, y: p.cy }); }
              else { var ux = x - p.cx, uy = y - p.cy, r2 = (p.rotation || 0) * Math.PI / 180, lx = ux * Math.cos(r2) + uy * Math.sin(r2), ly = -ux * Math.sin(r2) + uy * Math.cos(r2); if (pid === 'rx') p.rx = clamp(Math.abs(lx), 0.01, 2); else p.ry = clamp(Math.abs(ly), 0.01, 2); }
              radialHandles();
              send(ph !== 'end' && ph !== 'key', radialHandles.key);
              if (ph === 'end') radialHandles.key = null;
            } };
            radialHandles.hd = X.canvas.handles(radialHandles.spec);
          }
          radialHandles.hd.update({ points: [{ id: 'c', x: p.cx, y: p.cy, label: 'Centre', ring: true }, { id: 'rx', x: p.cx + Math.cos(rot) * p.rx, y: p.cy + Math.sin(rot) * p.rx, label: 'Width' }, { id: 'ry', x: p.cx - Math.sin(rot) * p.ry, y: p.cy + Math.cos(rot) * p.ry, label: 'Height' }], ellipses: [{ c: 'c', rx: p.rx, ry: p.ry, rot: p.rotation || 0 }] });
        };
        radialHandles();
      } else if (p.kind === 'luma') {
        body.appendChild(field(p, i, 'min', 'From', { d: 60 }));
        body.appendChild(field(p, i, 'max', 'To', { d: 100 }));
        body.appendChild(field(p, i, 'soft', 'Smoothness', { d: 15 }));
        body.appendChild(dropper('Pick a tone', function (rgb) { var L = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b; p.min = clamp(Math.round((L - 0.12) * 100) / 100, 0, 1); p.max = clamp(Math.round((L + 0.12) * 100) / 100, 0, 1); send(false, X.gesture()); render(); }));
      } else if (p.kind === 'color') {
        var sw = h('<div class="xp-row xp-colorrow"><span class="xp-lbl">Colour</span><div class="xp-ctl"><span class="xp-swatch"><i style="background:' + (C.hsl2hex ? C.hsl2hex(p.h, p.s, p.l) : '#888') + '"></i><span class="xp-swatch-hex">' + Math.round(p.h) + '°</span></span></div></div>');
        sw.querySelector('.xp-ctl').appendChild(dropper('Pick a colour', function (rgb) { var q = rgb2hsl(rgb.r, rgb.g, rgb.b); p.h = Math.round(q[0]); p.s = Math.round(q[1] * 100) / 100; p.l = Math.round(q[2] * 100) / 100; send(false, X.gesture()); render(); }, true));
        body.appendChild(sw);
        body.appendChild(field(p, i, 'range', 'Range', { d: 12 }));
        body.appendChild(field(p, i, 'soft', 'Smoothness', { d: 10 }));
      } else if (p.kind === 'asset') {
        var paint = h('<div class="xp-row xp-brushrow"><span class="xp-lbl">Brush</span><div class="xp-ctl"><button type="button" class="btn btn-sm" data-b="paint">' + X.ic('brush') + '<span>Paint</span></button><button type="button" class="btn btn-sm" data-b="erase">' + X.ic('erase') + '<span>Erase</span></button></div></div>');
        paint.querySelector('[data-b="paint"]').addEventListener('click', function () { if (spec.onPaint) spec.onPaint(i, false); });
        paint.querySelector('[data-b="erase"]').addEventListener('click', function () { if (spec.onPaint) spec.onPaint(i, true); });
        body.appendChild(paint);
        if (!p.asset) body.appendChild(h('<p class="xp-note">' + esc(X.say('Paint on the photo with B. [ and ] change the size.', 'Choose Paint, then paint on the photo.')) + '</p>'));
      } else if (p.kind === 'subject') {
        body.appendChild(h('<p class="xp-note">Uses this layer’s cut-out. Make one with Remove background if the layer has none.</p>'));
      } else if (p.kind === 'depth' || p.kind === 'face') {
        body.appendChild(h('<p class="xp-note">Needs a ' + (p.kind === 'depth' ? 'depth map' : 'face map') + ' for this layer. Until there is one, this part covers the whole layer.</p>'));
      }
      if (p.kind !== 'subject' && p.kind !== 'asset') body.appendChild(field(p, i, 'feather', p.kind === 'linear' ? 'Smoothness' : 'Feather', { d: p.kind === 'radial' ? 50 : 25 }));
      body.appendChild(field(p, i, 'density', 'Density', { d: 100, unit: '%' }));
      return li;
    }
    function autoCanvas(ctl) { var b = ctl.el.querySelector('.xp-oncanvas'); if (b && X.canvas.attached && X.canvas.attached() && b.getAttribute('aria-pressed') !== 'true') b.click(); }
    function dropper(label, fn, compact) {
      var b = h('<button type="button" class="' + (compact ? 'xp-ib' : 'btn btn-sm xp-dropper') + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + X.ic('pipette') + (compact ? '' : '<span>' + esc(label) + '</span>') + '</button>');
      b.addEventListener('click', function () {
        if (!spec.sample) return;
        X.emit('sample', { label: label, done: function (rgb) { if (rgb) fn(rgb); } });
      });
      return b;
    }
    function render() {
      live.forEach(function (c) { if (c.destroy) c.destroy(); });
      live = [];
      list.innerHTML = '';
      mask.parts.forEach(function (p, i) { list.appendChild(partRow(p, i)); });
      empty.hidden = mask.parts.length > 0;
      el.querySelector('.xp-mask-view').hidden = !mask.parts.length;
      el.querySelector('[data-act="copy"]').disabled = !mask.parts.length;
      el.querySelector('[data-act="clear"]').disabled = !mask.parts.length;
      el.querySelector('[data-act="paste"]').disabled = !X.clip.has();
    }
    /* Add menu */
    var addBtn = el.querySelector('.xp-mask-add');
    addBtn.addEventListener('click', function () {
      var kinds = spec.kinds || ['linear', 'radial', 'luma', 'color', 'subject', 'asset', 'depth', 'face'];
      var items = kinds.map(function (k) { return { label: KINDS[k].label, icon: KINDS[k].icon, fn: function () { add(k); } }; });
      X.menu(addBtn, items);
    });
    function add(kind) {
      mask.parts.push(newPart(kind));
      open = mask.parts.length - 1;
      send(false, X.gesture());
      render();
      if (kind === 'asset' && spec.onPaint) spec.onPaint(open, false);
    }
    el.querySelector('[data-act="copy"]').addEventListener('click', function () { X.clip.copy(mask); if (global.LEStudio) global.LEStudio.toast('Mask copied'); render(); });
    el.querySelector('[data-act="paste"]').addEventListener('click', function () { var m = X.clip.paste(); if (!m) return; mask = X.clone(m); open = 0; send(false, X.gesture()); render(); });
    el.querySelector('[data-act="clear"]').addEventListener('click', function () { mask = { parts: [] }; send(false, X.gesture()); render(); });
    var stopClip = X.on('clip', render);
    render();
    if (mask.parts.length) X.emit('mask-view', { layerId: spec.layerId && spec.layerId(), fxId: spec.fxId, mask: mask, view: view });
    return {
      el: el,
      get: function () { return mask.parts.length ? X.clone(mask) : null; },
      set: function (m) { if (g.active()) return; var n = m && m.parts ? X.clone(m) : { parts: [] }; if (JSON.stringify(n) === JSON.stringify(mask)) return; var same = n.parts.length === mask.parts.length && n.parts.every(function (p, i) { return p.kind === mask.parts[i].kind; }); mask = n; if (same) { var fresh = mask.parts; void fresh; } render(); },
      add: add,
      view: function () { return view; },
      focus: function () { addBtn.focus(); },
      destroy: function () { stopClip(); live.forEach(function (c) { if (c.destroy) c.destroy(); }); X.emit('mask-view', null); }
    };
  });

  /* ---------- A small keyboard menu, used by the kit when the studio's openPop is not there ---------- */
  X.menu = X.menu || function (anchor, items, opts) {
    var c = global.LEStudio;
    var html = '<div class="sx-menu xp-menu">' + items.map(function (it, i) { return it.sep ? '<hr>' : '<button type="button" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + (it.danger ? ' class="is-danger"' : '') + '>' + (it.icon ? X.ic(it.icon) : '') + '<span>' + esc(it.label) + '</span>' + (it.kbd ? '<kbd>' + esc(it.kbd) + '</kbd>' : '') + '</button>'; }).join('') + '</div>';
    function pick(e) { var b = e.target.closest('[data-i]'); if (!b || b.disabled) return; var it = items[Number(b.getAttribute('data-i'))]; close(); if (it && it.fn) it.fn(); }
    var node, close;
    if (c && c.openPop) {
      node = c.openPop(anchor, html, Object.assign({ cls: 'sx-pop-menu' }, opts || {}));
      close = function () { c.closePop(); };
      var pop = c.E.pop;
      if (pop._xpMenu) pop.removeEventListener('click', pop._xpMenu);
      pop._xpMenu = function (e) { if (e.target.closest('.xp-menu [data-i]')) { pop.removeEventListener('click', pop._xpMenu); pop._xpMenu = null; pick(e); } };
      pop.addEventListener('click', pop._xpMenu);
      return node;
    }
    node = h('<div class="xp-pop" role="menu">' + html + '</div>');
    document.body.appendChild(node);
    var r = anchor.getBoundingClientRect();
    node.style.left = Math.min(innerWidth - 240, r.left) + 'px'; node.style.top = (r.bottom + 4) + 'px';
    close = function () { node.remove(); document.removeEventListener('pointerdown', outside, true); };
    var outside = function (e) { if (!node.contains(e.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    node.addEventListener('click', pick);
    node.addEventListener('keydown', function (e) {
      var bs = [].slice.call(node.querySelectorAll('button:not([disabled])')), i = bs.indexOf(document.activeElement);
      if (e.key === 'Escape') { close(); anchor.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    });
    var f = node.querySelector('button:not([disabled])'); if (f) f.focus();
    return node;
  };
})(window);
