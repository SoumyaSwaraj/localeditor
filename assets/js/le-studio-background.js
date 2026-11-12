/* LocalEditor studio: background module. Photo backgrounds that can be framed, fitted, flipped, blurred, dimmed and
   colour-adjusted on the canvas. Registers window.LEStudioPanels.background (replacing the colour module's panel, whose
   Solid / Gradients / Patterns tabs it reuses) and window.LEStudioBackground. The data lives in doc.background; see
   "Photo backgrounds" in le-objects.js for the shape. */
(function () {
  'use strict';
  var LE = window.LE;
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  var OLD = P.background || null;
  if (!LE || !LE.Scene) return;
  function hook(n, f) { (H[n] = H[n] || []).push(f); }
  function U() { return P._u || {}; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  var FITS = [['cover', 'Fill'], ['contain', 'Fit'], ['fill', 'Stretch'], ['tile', 'Tile']];
  var FIT_NAMES = { cover: 'Fill', contain: 'Fit', fill: 'Stretch', tile: 'Tile' };
  var FILTER_NAMES = { vivid: 'Vivid', warm: 'Warm', cool: 'Cool', cinematic: 'Cinematic', mono: 'Mono', film: 'Film', fade: 'Fade', golden: 'Golden', noir: 'Noir', portrait: 'Portrait', vintage: 'Vintage' };
  var LOOK = [['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['warmth', 'Warmth', -60, 60]];
  var ICONS = {
    rotateL: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8"/><path d="M3.5 3.5V8H8"/>',
    detach: '<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 2.6"/><rect x="8" y="8" width="10" height="10" rx="2"/><path d="M12 11.5v3M10.5 13h3"/>',
    move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'
  };

  function isPhoto(bg) { return !!(bg && bg.type === 'image' && bg.src && !bg.spec); }
  function curBg(c) { return c.scene.background ? c.scene.background() : clone(c.doc().background); }
  function spec(bg) { return LE.Scene.backgroundSpec(bg); }
  function srcSize(c, bg) {
    var m = c.mem[bg.src];
    var cv = m && m.canvas;
    if (!cv) { var info = c.scene.backgroundInfo && c.scene.backgroundInfo(); return info ? { iw: info.width, ih: info.height } : null; }
    return { iw: cv.width, ih: cv.height };
  }
  function cropSize(c, bg) {
    var z = srcSize(c, bg);
    if (!z) return null;
    var s = spec(bg);
    return { sw: Math.max(1, z.iw * s.crop.w), sh: Math.max(1, z.ih * s.crop.h) };
  }
  function right(rot) { return Math.abs(((num(rot, 0) % 90) + 90) % 90) < 0.01; }
  function photoName(c, id) {
    var meta = c.S.project && c.S.project.assets ? c.S.project.assets[id] : null;
    return String((meta && meta.name) || 'Photo').replace(/\.[^.]+$/, '');
  }

  /* Keeps the framing sensible: Fill never shows a gap, the other fits keep the photo on the page. */
  function settle(c, bg) {
    var d = c.doc();
    var W = d.width, H = d.height;
    var s = spec(bg);
    var sz = cropSize(c, bg);
    if (s.fit === 'tile') {
      bg.tile = { size: r4(s.tile.size), gap: r4(s.tile.gap) };
      bg.x = r4(clamp(num(bg.x, 0), -1, 1));
      bg.y = r4(clamp(num(bg.y, 0), -1, 1));
      return bg;
    }
    if (s.fit === 'cover') bg.scale = Math.max(1, s.scale);
    else bg.scale = clamp(s.scale, 0.1, 10);
    if (sz) {
      var p = LE.Scene.backgroundPlacement(bg, W, H, sz.sw, sz.sh);
      var mx, my;
      if (s.fit === 'cover' && right(s.rotation)) { mx = Math.max(0, (p.dw - W) / 2) / W; my = Math.max(0, (p.dh - H) / 2) / H; }
      else { mx = (W + p.dw) / 2 / W * 0.92; my = (H + p.dh) / 2 / H * 0.92; }
      bg.x = clamp(num(bg.x, 0), -mx, mx);
      bg.y = clamp(num(bg.y, 0), -my, my);
    }
    bg.x = r4(num(bg.x, 0));
    bg.y = r4(num(bg.y, 0));
    bg.scale = r4(bg.scale);
    return bg;
  }

  /* ---------- Commands ---------- */
  function commit(c, patch, key) {
    var bg = curBg(c);
    if (!isPhoto(bg)) return;
    var next = Object.assign(bg, clone(patch));
    if (patch.fit || patch.scale != null || patch.x != null || patch.y != null || patch.rotation != null || patch.tile) settle(c, next);
    c.scene.setBackground(next, key ? { coalesce: key } : null);
  }
  function setPhoto(c, id, opts) {
    opts = opts || {};
    var prev = curBg(c);
    var base = isPhoto(prev) ? prev : null;
    var next = { type: 'image', src: id, color: base ? (base.color || '#ffffff') : (prev.type === 'color' && prev.color ? prev.color : '#ffffff'), fit: base ? (base.fit || 'cover') : 'cover' };
    if (base) ['opacity', 'blur', 'dim', 'adjust', 'filter', 'tile'].forEach(function (k) { if (base[k] != null) next[k] = clone(base[k]); });
    c.scene.setBackground(next);
    if (!opts.quiet) c.toast('Photo set as the background', { action: { label: 'Adjust position', fn: function () { enter(c); } } });
    return next;
  }
  function metaFor(c, input) {
    if (!input) return Promise.reject(new Error('Choose a photo.'));
    if (typeof input === 'string') {
      if (c.mem[input] && c.mem[input].meta) return Promise.resolve(c.mem[input].meta);
      return LE.project.assetRecord(input).then(function (rec) {
        if (!rec || !rec.blob) throw new Error('That photo is not on this device.');
        return c.ingest(new File([rec.blob], rec.name || 'photo.jpg', { type: rec.blob.type || 'image/jpeg' }));
      });
    }
    var blob = (typeof Blob !== 'undefined' && input instanceof Blob) ? input : (input.file || input.blob);
    if (!(typeof Blob !== 'undefined' && blob instanceof Blob)) {
      if (input.id) return metaFor(c, input.id);
      return Promise.reject(new Error('Could not read that image.'));
    }
    var file = blob instanceof File ? blob : new File([blob], input.name || 'photo.jpg', { type: blob.type || 'image/jpeg' });
    if (input.source && !file.source) file.source = input.source;
    return c.ingest(file);
  }
  function usePhoto(c, input) {
    return metaFor(c, input).then(function (meta) {
      if (!meta || !meta.id) throw new Error('Could not read that image.');
      setPhoto(c, meta.id);
      if (c.S.panel === 'background') c.renderPanel(true);
      return meta;
    }).catch(function (err) { c.toast((err && err.message) || 'Could not use that photo.'); return null; });
  }
  function openSources(c) {
    if (!c.S.project) return;
    var host = document.createElement('div');
    var C = window.LEStudioCollage;
    if (!C || typeof C.renderReplaceSheet !== 'function') { pickDevice(c); return; }
    var w = Object.create(c);
    w.replaceImage = function (input) { return usePhoto(c, input); };
    var body = c.openModal('Background <em>photo</em>', host);
    var card = body && body.parentElement;
    if (card) card.classList.add('sx-rep-card', 'sxb-sources');
    C.renderReplaceSheet(w, host);
    var p = host.querySelector('.sx-rep-device p');
    if (p) p.textContent = 'The photo fills the page. Your fit, blur, dim and colour settings stay.';
  }
  var fileIn = null;
  function pickDevice(c) {
    if (!fileIn) {
      fileIn = document.createElement('input');
      fileIn.type = 'file';
      fileIn.accept = 'image/*';
      fileIn.hidden = true;
      document.body.appendChild(fileIn);
    }
    fileIn.onchange = function () {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (f) usePhoto(c, f);
    };
    fileIn.click();
  }
  function removePhoto(c) {
    var bg = curBg(c);
    if (!isPhoto(bg)) return;
    var col = bg.color && bg.color !== 'rgba(0,0,0,0)' ? bg.color : '#ffffff';
    c.scene.setBackground({ type: 'color', color: col });
    c.toast('Background photo removed', { action: { label: 'Undo', fn: function () { c.scene.undo(); } } });
  }
  /* Image layer → background, keeping its crop, adjustments, filter, flips, rotation and opacity. */
  function fromLayer(c, id) {
    var l = c.L(id);
    if (!l || l.type !== 'image' || !l.src) return null;
    var prev = curBg(c);
    var next = {
      type: 'image', src: l.src, fit: 'cover',
      color: prev.type === 'color' && prev.color ? prev.color : (prev.color || '#ffffff'),
      crop: clone(l.crop || { x: 0, y: 0, w: 1, h: 1 }), x: 0, y: 0, scale: 1,
      rotation: num(l.rotation, 0), flipX: !!l.flipX, flipY: !!l.flipY, opacity: l.opacity == null ? 1 : l.opacity,
      adjust: clone(l.adjust || {}), filter: l.filter && l.filter.name ? clone(l.filter) : null
    };
    c.batch(function () {
      c.scene.setBackground(next);
      c.scene.remove([id]);
    });
    if (c.S.baseId === id) c.S.baseId = null;
    c.toast('Photo is now the background', { action: { label: 'Adjust position', fn: function () { enter(c); } } });
    return next;
  }
  /* Background → image layer at the back with the same look. Dim becomes a colour layer above it. */
  function detach(c) {
    var bg = curBg(c);
    if (!isPhoto(bg)) return null;
    var info = c.scene.backgroundInfo && c.scene.backgroundInfo();
    if (!info) { c.toast('The background photo is still loading.'); return null; }
    var s = info.spec, p = info.place, d = c.doc();
    var turned = Math.abs(Math.sin(p.rad)) > 0.5;
    var w = info.sw * (turned ? p.ky : p.kx), h = info.sh * (turned ? p.kx : p.ky);
    var adjust = clone(bg.adjust || {});
    if (s.blur > 0) adjust.blur = Math.min(40, Math.max(num(adjust.blur, 0), Math.round(s.blur)));
    var layer = {
      type: 'image', name: 'Background photo', src: bg.src, crop: clone(s.crop),
      x: r4(p.cx - w / 2), y: r4(p.cy - h / 2), w: r4(w), h: r4(h), rotation: s.rotation, flipX: s.flipX, flipY: s.flipY,
      opacity: s.opacity, adjust: adjust, filter: bg.filter && bg.filter.name ? clone(bg.filter) : null
    };
    var col = bg.color || '#ffffff';
    var photoId = null;
    c.batch(function () {
      c.scene.setBackground({ type: 'color', color: col });
      if (s.dim && s.dim.amount > 0) {
        var dimId = c.scene.add({ type: 'shape', shape: 'rect', name: 'Background dim', x: 0, y: 0, w: d.width, h: d.height, fill: { type: 'solid', color: s.dim.color }, opacity: s.dim.amount });
        c.scene.order(dimId, 'back');
      }
      photoId = c.scene.add(layer);
      c.scene.order(photoId, 'back');
    });
    if (photoId) c.scene.select([photoId]);
    c.toast(s.fit === 'tile' ? 'Detached one tile as a photo layer' : 'Background detached — it is now a photo layer at the back');
    return photoId;
  }

  /* ---------- Edit background mode ---------- */
  var ED = null;
  function editing() { return !!ED; }
  function enter(c) {
    if (ED) return true;
    if (!c.S.project) return false;
    var bg = curBg(c);
    if (!isPhoto(bg)) { c.toast('Pick a photo background first.'); c.openPanel('background', { tab: 'photos' }); return false; }
    if (c.S.tool && c.S.tool !== 'select') c.scene.setTool('select');
    c.closePop();
    c.scene.select([]);
    var phonePanel = c.isPhone() && c.S.panel ? c.S.panel : null;
    if (phonePanel) c.closePanel();
    var sz = cropSize(c, bg);
    ED = { c: c, start: clone(bg), cur: settle(c, clone(bg)), undo: [], redo: [], gkey: null, sz: sz, phonePanel: phonePanel, ptrs: {}, peek: false };
    c.scene.editBackground({});
    var root = document.getElementById('sx');
    if (root) root.classList.add('is-bgedit');
    buildOverlay(c);
    buildBar(c);
    c.renderToolbar();
    return true;
  }
  function apply(next) {
    ED.cur = next;
    ED.c.scene.setBackground(next, { history: false });
    syncBar();
  }
  function begin(kind) {
    if (ED.gkey === kind) return;
    ED.undo.push(clone(ED.cur));
    if (ED.undo.length > 60) ED.undo.shift();
    ED.redo = [];
    ED.gkey = kind;
  }
  function end() { if (ED) ED.gkey = null; }
  function localUndo(redo) {
    var from = redo ? ED.redo : ED.undo, to = redo ? ED.undo : ED.redo;
    if (!from.length) return;
    to.push(clone(ED.cur));
    ED.gkey = null;
    apply(from.pop());
  }
  function finish(keep) {
    if (!ED) return;
    var c = ED.c, start = ED.start, cur = ED.cur, phonePanel = ED.phonePanel;
    teardown();
    c.scene.setBackground(start, { history: false });
    if (keep && JSON.stringify(start) !== JSON.stringify(cur)) c.scene.setBackground(cur);
    c.renderToolbar();
    if (phonePanel) c.openPanel(phonePanel, phonePanel === 'background' ? { tab: 'photos' } : {});
    else if (c.S.panel === 'background') c.renderPanel(true);
  }
  function teardown() {
    if (!ED) return;
    var c = ED.c;
    if (ED.overlay && ED.overlay.parentNode) ED.overlay.parentNode.removeChild(ED.overlay);
    if (ED.bar && ED.bar.parentNode) ED.bar.parentNode.removeChild(ED.bar);
    c.scene.editBackground(null);
    var root = document.getElementById('sx');
    if (root) root.classList.remove('is-bgedit');
    ED = null;
  }
  function pageSize() { var d = ED.c.doc(); return { W: d.width, H: d.height }; }
  function docPoint(e) {
    var r = ED.c.scene.pageRect();
    var z = ED.c.scene.zoom();
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  }
  /* Zoom the photo by factor f about a page point (document units). */
  function zoomed(base, f, pt) {
    var ps = pageSize();
    var next = clone(base);
    var s = spec(base);
    var cx = ps.W / 2 + s.x * ps.W, cy = ps.H / 2 + s.y * ps.H;
    var real;
    if (s.fit === 'tile') {
      var size = clamp(s.tile.size * f, 0.03, 2);
      real = size / s.tile.size;
      next.tile = { size: size, gap: s.tile.gap };
    } else {
      var lo = s.fit === 'cover' ? 1 : 0.1;
      var sc = clamp(s.scale * f, lo, 10);
      real = sc / s.scale;
      next.scale = sc;
    }
    pt = pt || { x: ps.W / 2, y: ps.H / 2 };
    next.x = (pt.x + (cx - pt.x) * real - ps.W / 2) / ps.W;
    next.y = (pt.y + (cy - pt.y) * real - ps.H / 2) / ps.H;
    return settle(ED.c, next);
  }
  function moved(base, dx, dy) {
    var ps = pageSize();
    var s = spec(base);
    var next = clone(base);
    next.x = s.x + dx / ps.W;
    next.y = s.y + dy / ps.H;
    return settle(ED.c, next);
  }
  function resetFrame() {
    begin('reset');
    var next = clone(ED.cur);
    next.x = 0; next.y = 0; next.scale = 1;
    if (spec(next).fit === 'tile') next.tile = { size: 0.25, gap: spec(next).tile.gap };
    apply(settle(ED.c, next));
    end();
  }
  function setPeek(on) {
    if (!ED) return;
    ED.peek = !!on;
    ED.c.scene.editBackground({ peek: ED.peek });
    if (ED.bar) {
      var b = ED.bar.querySelector('[data-bgx="peek"]');
      if (b) { b.setAttribute('aria-pressed', String(ED.peek)); b.innerHTML = ED.c.ic(ED.peek ? 'eyeOff' : 'eye') + '<span>' + (ED.peek ? 'Show design' : 'Hide design') + '</span>'; }
    }
  }

  function buildOverlay(c) {
    var ov = document.createElement('div');
    ov.className = 'sxb-edit';
    ov.setAttribute('aria-hidden', 'true');
    c.E.sceneEl.appendChild(ov);
    ED.overlay = ov;
    var g = null;
    function stop(e) { e.stopPropagation(); }
    function startGesture() {
      var ids = Object.keys(ED.ptrs);
      if (ids.length >= 2) {
        var a = ED.ptrs[ids[0]], b = ED.ptrs[ids[1]];
        g = { type: 'pinch', base: clone(ED.cur), dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: docPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }), key: 'pinch' + Date.now() };
      } else if (ids.length === 1) {
        var p = ED.ptrs[ids[0]];
        g = { type: 'pan', base: clone(ED.cur), x: p.x, y: p.y, key: 'pan' + Date.now() };
      } else g = null;
    }
    ov.addEventListener('pointerdown', function (e) {
      stop(e);
      e.preventDefault();
      if (!ED) return;
      try { ov.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      ED.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      ov.classList.add('is-dragging');
      startGesture();
    });
    ov.addEventListener('pointermove', function (e) {
      stop(e);
      if (!ED || !ED.ptrs[e.pointerId]) return;
      ED.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (!g) return;
      var z = ED.c.scene.zoom();
      if (g.type === 'pan') {
        var dx = (e.clientX - g.x) / z, dy = (e.clientY - g.y) / z;
        if (Math.abs(dx) + Math.abs(dy) < 0.01) return;
        begin(g.key);
        apply(moved(g.base, dx, dy));
      } else {
        var ids = Object.keys(ED.ptrs);
        if (ids.length < 2) return;
        var a = ED.ptrs[ids[0]], b = ED.ptrs[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        var mid = docPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        begin(g.key);
        var next = zoomed(g.base, dist / g.dist, g.mid);
        apply(moved(next, mid.x - g.mid.x, mid.y - g.mid.y));
      }
    });
    function up(e) {
      stop(e);
      if (!ED) return;
      delete ED.ptrs[e.pointerId];
      if (!Object.keys(ED.ptrs).length) { ov.classList.remove('is-dragging'); g = null; end(); }
      else { end(); startGesture(); }
    }
    ov.addEventListener('pointerup', up);
    ov.addEventListener('pointercancel', up);
    ov.addEventListener('wheel', function (e) {
      stop(e);
      e.preventDefault();
      if (!ED) return;
      var dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      if (e.deltaMode === 2) dy *= 400;
      begin('wheel');
      clearTimeout(ED.wheelT);
      ED.wheelT = setTimeout(end, 350);
      apply(zoomed(ED.cur, Math.exp(-dy * 0.0015), docPoint(e)));
    }, { passive: false });
    ov.addEventListener('dblclick', function (e) { stop(e); e.preventDefault(); finish(true); });
    ov.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function zoomValue() {
    var s = spec(ED.cur);
    return Math.round((s.fit === 'tile' ? s.tile.size : s.scale) * 100);
  }
  function buildBar(c) {
    var touch = c.isPhone() || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    var bar = c.h('<div class="sxb-bar" role="toolbar" aria-label="Edit background">' +
      '<div class="sxb-bar-info"><span class="sxb-bar-ic">' + c.ic('move') + '</span><span><strong>Edit background</strong><small>' + (touch ? 'Drag to move · pinch to zoom' : 'Drag to move · scroll to zoom · arrows nudge') + '</small></span></div>' +
      '<div class="sxb-bar-zoom"><button type="button" class="sx-iconbtn" data-bgx="out" aria-label="Zoom out">' + c.ic('minus') + '</button><span class="sxb-zoom-host"></span><button type="button" class="sx-iconbtn" data-bgx="in" aria-label="Zoom in">' + c.ic('plus') + '</button></div>' +
      '<div class="sxb-bar-act">' +
      '<button type="button" class="sxb-btn" data-bgx="reset" title="Reset position and zoom (0)">' + c.ic('reset') + '<span>Reset</span></button>' +
      '<button type="button" class="sxb-btn" data-bgx="peek" aria-pressed="false" title="Hide the design to see the whole photo">' + c.ic('eye') + '<span>Hide design</span></button>' +
      '<button type="button" class="sxb-btn" data-bgx="cancel" title="Cancel (Esc)">' + c.ic('x') + '<span>Cancel</span></button>' +
      '<button type="button" class="btn btn-gold sxb-done" data-bgx="done" title="Done (Enter)">' + c.ic('check') + '<span>Done</span></button>' +
      '</div></div>');
    var s = spec(ED.cur);
    var tile = s.fit === 'tile';
    var slider = c.ui.slider({
      label: tile ? 'Tile size' : 'Zoom', min: tile ? 3 : (s.fit === 'cover' ? 100 : 10), max: tile ? 200 : 1000, step: 1, value: zoomValue(), reset: tile ? 25 : 100,
      fmt: function (v) { return v + '%'; },
      onInput: function (v, key) {
        if (!ED) return;
        begin('slider' + key);
        var cur = spec(ED.cur);
        apply(zoomed(ED.cur, (v / 100) / (tile ? cur.tile.size : cur.scale), null));
      },
      onEnd: end
    });
    slider.classList.add('sxb-zoom');
    bar.querySelector('.sxb-zoom-host').appendChild(slider);
    ED.slider = slider;
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-bgx]');
      if (!b || !ED) return;
      var k = b.getAttribute('data-bgx');
      if (k === 'done') finish(true);
      else if (k === 'cancel') finish(false);
      else if (k === 'reset') resetFrame();
      else if (k === 'peek') setPeek(!ED.peek);
      else if (k === 'in' || k === 'out') { begin('btn' + Date.now()); apply(zoomed(ED.cur, k === 'in' ? 1.15 : 1 / 1.15, null)); end(); }
    });
    c.E.stage.appendChild(bar);
    ED.bar = bar;
    syncBar();
    var done = bar.querySelector('[data-bgx="done"]');
    if (done && !touch) setTimeout(function () { try { done.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }, 30);
  }
  function syncBar() {
    if (!ED || !ED.slider) return;
    ED.slider.set(zoomValue());
  }
  function typingTarget(t) { return t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable); }
  function onKey(e) {
    if (!ED) return;
    var k = e.key;
    var mod = e.ctrlKey || e.metaKey;
    var modal = document.getElementById('sx-modal');
    if (modal && !modal.hidden) return;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (typingTarget(e.target)) return;
    if (ED.bar && ED.bar.contains(e.target) && (k === 'Enter' || k === ' ') && e.target.tagName === 'BUTTON') return;
    var ps = pageSize();
    var step = e.shiftKey ? 0.1 : 0.01;
    var handled = true;
    if (k === 'Enter') finish(true);
    else if (mod && (k === 'z' || k === 'Z')) localUndo(e.shiftKey);
    else if (mod && (k === 'y' || k === 'Y')) localUndo(true);
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      begin('nudge');
      clearTimeout(ED.nudgeT);
      ED.nudgeT = setTimeout(end, 700);
      var dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
      var dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      apply(moved(ED.cur, dx * step * ps.W, dy * step * ps.H));
    } else if (!mod && (k === '+' || k === '=' || k === '-' || k === '_')) {
      begin('key' + Date.now());
      apply(zoomed(ED.cur, (k === '-' || k === '_') ? 1 / 1.1 : 1.1, null));
      end();
    } else if (!mod && (k === '0' || k === 'r' || k === 'R')) resetFrame();
    else if (!mod && (k === 'h' || k === 'H')) setPeek(!ED.peek);
    else if (mod) handled = false;
    else if (k === 'Tab') handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  window.addEventListener('keydown', onKey, true);
  /* Header undo / redo act on the edit session while it is open. */
  document.addEventListener('click', function (e) {
    if (!ED) return;
    var b = e.target.closest && e.target.closest('[data-cmd="undo"],[data-cmd="redo"]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    localUndo(b.getAttribute('data-cmd') === 'redo');
  }, true);

  /* Entering: double-click (or double-tap) empty page area when the background is a photo. */
  function emptyPageAt(c, clientX, clientY) {
    if (!c.S.project || ED || c.S.tool !== 'select' || c.S.editing || c.S.preview || c.S.pick) return false;
    if (!isPhoto(c.doc().background)) return false;
    var r = c.scene.pageRect();
    if (!r || clientX < r.left || clientY < r.top || clientX > r.right || clientY > r.bottom) return false;
    var z = c.scene.zoom();
    return !c.scene.hitTest((clientX - r.left) / z, (clientY - r.top) / z);
  }
  function bindEntry(c) {
    var el = c.E.sceneEl;
    el.addEventListener('dblclick', function (e) {
      if (e.target && e.target.closest && e.target.closest('.sxb-edit')) return;
      if (!emptyPageAt(c, e.clientX, e.clientY)) return;
      e.stopPropagation();
      e.preventDefault();
      enter(c);
    }, true);
    var lastTap = null;
    el.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'touch' || ED) return;
      var now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28 && emptyPageAt(c, e.clientX, e.clientY)) {
        lastTap = null;
        setTimeout(function () { enter(c); }, 0);
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }, true);
  }

  /* ---------- Mini preview of the background ---------- */
  function drawOne(x, img, s, p, sx, sy, sw, sh) {
    x.save();
    x.translate(p.cx, p.cy);
    x.scale(p.kx, p.ky);
    x.rotate(p.rad);
    if (s.flipX || s.flipY) x.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    x.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    x.restore();
  }
  function cssLook(bg, k) {
    var a = bg.adjust || {};
    var f = [];
    var s = spec(bg);
    if (s.blur > 0) f.push('blur(' + Math.max(0.3, s.blur * k).toFixed(2) + 'px)');
    if (a.brightness) f.push('brightness(' + (1 + a.brightness / 200).toFixed(3) + ')');
    if (a.contrast) f.push('contrast(' + (1 + a.contrast / 150).toFixed(3) + ')');
    if (a.saturation) f.push('saturate(' + Math.max(0, 1 + a.saturation / 100).toFixed(3) + ')');
    if (a.warmth > 0) f.push('sepia(' + (a.warmth / 150).toFixed(3) + ')');
    if (bg.filter && /mono|noir/.test(bg.filter.name)) f.push('grayscale(' + ((bg.filter.intensity == null ? 100 : bg.filter.intensity) / 100) + ')');
    return f.join(' ');
  }
  function paintMini(c, cv, bg, box) {
    var d = c.doc();
    var W = d.width, Hh = d.height;
    var k = Math.min(box / W, box / Hh);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(W * k * dpr));
    cv.height = Math.max(1, Math.round(Hh * k * dpr));
    cv.style.width = Math.round(W * k) + 'px';
    cv.style.height = Math.round(Hh * k) + 'px';
    var x = cv.getContext('2d');
    x.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    x.fillStyle = bg.color || '#ffffff';
    x.fillRect(0, 0, W, Hh);
    var m = c.mem[bg.src];
    if (!m || !m.canvas) return;
    var s = spec(bg);
    var iw = m.canvas.width, ih = m.canvas.height;
    var sx = iw * s.crop.x, sy = ih * s.crop.y, sw = Math.max(1, iw * s.crop.w), sh = Math.max(1, ih * s.crop.h);
    var p = LE.Scene.backgroundPlacement(bg, W, Hh, sw, sh);
    x.save();
    x.beginPath();
    x.rect(0, 0, W, Hh);
    x.clip();
    x.globalAlpha = s.opacity;
    var look = cssLook(bg, k * dpr);
    if (look && 'filter' in x) x.filter = look;
    if (s.fit === 'tile') {
      var gap = s.tile.gap * W, cw = p.dw + gap, ch = p.dh + gap;
      var x0 = p.cx - Math.ceil((p.cx + cw / 2) / cw) * cw, y0 = p.cy - Math.ceil((p.cy + ch / 2) / ch) * ch;
      var n = 0;
      for (var ty = y0; ty < Hh + ch && n < 900; ty += ch) for (var tx = x0; tx < W + cw && n < 900; tx += cw, n++) drawOne(x, m.canvas, s, { cx: tx, cy: ty, kx: p.kx, ky: p.ky, rad: p.rad }, sx, sy, sw, sh);
    } else drawOne(x, m.canvas, s, p, sx, sy, sw, sh);
    x.restore();
    if (s.dim && s.dim.amount > 0) {
      x.globalAlpha = s.dim.amount;
      x.fillStyle = s.dim.color;
      x.fillRect(0, 0, W, Hh);
      x.globalAlpha = 1;
    }
  }

  /* ---------- Panel ---------- */
  function tabOf(bg) {
    if (!bg) return 'solid';
    if (bg.spec) return bg.spec.kind === 'gradient' ? 'gradients' : bg.spec.kind === 'pattern' ? 'patterns' : 'photos';
    if (bg.type === 'gradient') return 'gradients';
    if (bg.type === 'image') return 'photos';
    return 'solid';
  }
  var VIEW = null;
  function viewKey(bg) {
    if (!isPhoto(bg)) return 'none|' + (bg && bg.spec ? JSON.stringify(bg.spec) : bg && bg.type);
    var s = spec(bg);
    return [bg.src, s.fit, !!(bg.filter && bg.filter.name), bg.filter && bg.filter.name].join('|');
  }
  P.background = {
    title: 'Background', eyebrow: 'Colour, gradient, pattern, photo', select: true,
    render: function (c, body, o) {
      o = o || {};
      VIEW = null;
      var u = U();
      if (u.needProject && u.needProject(c, body)) return;
      var bg = c.doc().background || { type: 'color', color: '#ffffff' };
      var tab = o.tab || (o.section === 'remove' ? 'photos' : tabOf(bg));
      if (tab !== 'photos' && OLD && OLD.render) { OLD.render(c, body, Object.assign({}, o, { tab: tab })); return; }
      var bar = c.h('<div class="sx-sticky"></div>');
      body.appendChild(bar);
      u.tabs(c, bar, [['solid', 'Solid'], ['gradients', 'Gradients'], ['patterns', 'Patterns'], ['photos', 'Photos']], 'photos', function (t) { c.S.panelOpts.tab = t; c.S.panelOpts.section = null; c.renderPanel(true); }).classList.add('is-fill');
      var host = c.h('<div class="sx-bg-host sxb-panel"></div>');
      body.appendChild(host);
      VIEW = { key: viewKey(bg), sync: [], mini: null };
      if (isPhoto(bg)) photoControls(c, host, bg);
      else photoEmpty(c, host, bg);
      sources(c, host, bg);
      textures(c, host, bg);
      if (u.removeBg) u.removeBg(c, host, o);
    },
    doc: function (c) {
      if (!VIEW) return;
      var bg = c.doc().background;
      if (viewKey(bg) !== VIEW.key) { c.renderPanel(true); return; }
      if (!isPhoto(bg)) return;
      VIEW.sync.forEach(function (f) { try { f(bg); } catch (e) { /* stale node */ } });
    }
  };

  function sec(c, title, extra) { return c.ui.section(title, extra); }
  function secBody(s) { return s.querySelector('.sx-sec-body'); }
  function slider(c, o, read) {
    var n = c.ui.slider(o);
    VIEW.sync.push(function (bg) { n.set(read(bg)); });
    return n;
  }

  function photoEmpty(c, host, bg) {
    var card = c.h('<div class="sx-card sxb-empty"><div class="sxb-empty-art">' + c.ic('image') + '</div><div><strong>Fill the page with a photo</strong><p>Then drag to frame it, zoom, flip, blur or dim it — right on the canvas.</p></div></div>');
    var row = c.h('<div class="sxb-row2"></div>');
    var one = c.one();
    if (one && one.type === 'image' && one.src) row.appendChild(U().btn(c, 'Use selected photo', 'background', 'btn btn-gold btn-sm', function () { fromLayer(c, one.id); }));
    row.appendChild(U().btn(c, 'Choose a photo', 'image', 'btn ' + (one && one.type === 'image' ? 'btn-ghost' : 'btn-gold') + ' btn-sm', function () { openSources(c); }));
    card.appendChild(row);
    host.appendChild(card);
  }

  function photoControls(c, host, bg) {
    var s = spec(bg);
    var meta = c.S.project.assets && c.S.project.assets[bg.src];
    var dims = meta && meta.width ? meta.width + ' × ' + meta.height : '';
    /* Current background card */
    var card = c.h('<div class="sx-card sxb-hero">' +
      '<button type="button" class="sxb-mini" aria-label="Edit background position"><canvas></canvas><span class="sxb-mini-hint">' + c.ic('move') + '</span></button>' +
      '<div class="sxb-hero-txt"><span class="sx-eyebrow">Current background</span><strong></strong><small></small></div>' +
      '<div class="sxb-hero-act"></div></div>');
    card.querySelector('strong').textContent = photoName(c, bg.src);
    var small = card.querySelector('small');
    function info(b) { small.textContent = [FIT_NAMES[spec(b).fit], dims].filter(Boolean).join(' · '); }
    info(bg);
    var cv = card.querySelector('canvas');
    function mini(b) { paintMini(c, cv, b, 92); }
    mini(bg);
    VIEW.sync.push(function (b) { mini(b); info(b); });
    card.querySelector('.sxb-mini').onclick = function () { enter(c); };
    var act = card.querySelector('.sxb-hero-act');
    act.appendChild(U().btn(c, 'Adjust position & zoom', 'move', 'btn btn-gold btn-sm sxb-edit-btn', function () { enter(c); }));
    act.appendChild(U().btn(c, 'Replace', 'replace', 'btn btn-ghost btn-sm', function () { openSources(c); }));
    act.appendChild(U().btn(c, 'Detach', 'detach', 'btn btn-ghost btn-sm', function () { detach(c); }));
    var rm = c.h('<button type="button" class="sx-iconbtn sxb-rm" aria-label="Remove background photo" title="Remove background photo">' + c.ic('trash') + '</button>');
    rm.onclick = function () { removePhoto(c); };
    act.appendChild(rm);
    host.appendChild(card);
    host.appendChild(c.h('<p class="sx-note is-muted sxb-tip">Tip: double-click an empty part of the page to reposition the photo.</p>'));

    /* Fit */
    var sf = sec(c, 'Fit');
    var fb = secBody(sf);
    fb.appendChild(c.ui.seg(FITS, s.fit, function (v) { commit(c, { fit: v, x: 0, y: 0, scale: 1 }); }, 'sx-seg-sm sx-seg-fill sxb-fits'));
    var fitNote = { cover: 'Fills the page; the edges that do not fit are cropped.', contain: 'Shows the whole photo; the base colour fills the rest.', fill: 'Stretches the photo to the page shape.', tile: 'Repeats the photo across the page.' }[s.fit];
    fb.appendChild(c.h('<p class="sx-note is-muted">' + c.esc(fitNote) + '</p>'));
    if (s.fit === 'tile') {
      fb.appendChild(slider(c, { label: 'Tile size', min: 3, max: 100, value: Math.round(s.tile.size * 100), reset: 25, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { var t = spec(curBg(c)).tile; commit(c, { tile: { size: v / 100, gap: t.gap } }, key); } }, function (b) { return Math.round(spec(b).tile.size * 100); }));
      fb.appendChild(slider(c, { label: 'Spacing', min: 0, max: 25, value: Math.round(s.tile.gap * 100), reset: 0, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { var t = spec(curBg(c)).tile; commit(c, { tile: { size: t.size, gap: v / 100 } }, key); } }, function (b) { return Math.round(spec(b).tile.gap * 100); }));
    } else {
      fb.appendChild(slider(c, { label: 'Zoom', min: s.fit === 'cover' ? 100 : 10, max: 500, value: Math.round(s.scale * 100), reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { commit(c, { scale: v / 100 }, key); } }, function (b) { return Math.round(spec(b).scale * 100); }));
    }
    host.appendChild(sf);

    /* Rotate & flip */
    var sr = sec(c, 'Rotate & flip');
    var q = c.h('<div class="sxb-quick"></div>');
    [['rotateL', 'Rotate left', function () { var b = spec(curBg(c)); commit(c, { rotation: (((b.rotation - 90) % 360) + 360) % 360 }); }],
      ['rotate', 'Rotate right', function () { var b = spec(curBg(c)); commit(c, { rotation: (b.rotation + 90) % 360 }); }],
      ['flip', 'Flip horizontal', function () { commit(c, { flipX: !spec(curBg(c)).flipX }); }],
      ['flipV', 'Flip vertical', function () { commit(c, { flipY: !spec(curBg(c)).flipY }); }]].forEach(function (x, i) {
      var b = c.h('<button type="button" class="sx-quick-btn" data-bgq="' + i + '" title="' + x[1] + '">' + c.ic(x[0]) + '<span>' + ['Left', 'Right', 'Mirror', 'Flip'][i] + '</span></button>');
      b.setAttribute('aria-label', x[1]);
      b.onclick = x[2];
      if (i === 2) VIEW.sync.push(function (bb) { b.setAttribute('aria-pressed', String(!!bb.flipX)); });
      if (i === 3) VIEW.sync.push(function (bb) { b.setAttribute('aria-pressed', String(!!bb.flipY)); });
      if (i === 2) b.setAttribute('aria-pressed', String(s.flipX));
      if (i === 3) b.setAttribute('aria-pressed', String(s.flipY));
      q.appendChild(b);
    });
    secBody(sr).appendChild(q);
    host.appendChild(sr);

    /* Look: blur, dim, transparency, base colour */
    var sl = sec(c, 'Blur & dim');
    var lb = secBody(sl);
    lb.appendChild(slider(c, { label: 'Blur', min: 0, max: 60, value: Math.round(s.blur), reset: 0, onInput: function (v, key) { commit(c, { blur: v }, key); } }, function (b) { return Math.round(spec(b).blur); }));
    var dimRow = c.h('<div class="sxb-dim"></div>');
    var dimCol = (s.dim && s.dim.color) || '#000000';
    var dimSl = slider(c, { label: 'Dim', min: 0, max: 90, value: Math.round((s.dim ? s.dim.amount : 0) * 100), reset: 0, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { var d0 = spec(curBg(c)).dim; commit(c, { dim: { color: (d0 && d0.color) || dimCol, amount: v / 100 } }, key); } }, function (b) { var d0 = spec(b).dim; return Math.round((d0 ? d0.amount : 0) * 100); });
    var dimBtn = c.h('<button type="button" class="sxb-dim-col" aria-label="Dim colour" title="Dim colour"><i></i></button>');
    dimBtn.querySelector('i').style.background = dimCol;
    VIEW.sync.push(function (b) { var d0 = spec(b).dim; dimBtn.querySelector('i').style.background = (d0 && d0.color) || '#000000'; });
    dimBtn.onclick = function () {
      var d0 = spec(curBg(c)).dim;
      c.colorPop(dimBtn, { value: (d0 && d0.color) || '#000000', title: 'Dim colour', onChange: function (v, key) {
        var cur = spec(curBg(c)).dim;
        if (typeof v !== 'string') return;
        commit(c, { dim: { color: v, amount: cur && cur.amount > 0 ? cur.amount : 0.35 } }, key || 'dimcol');
      } });
    };
    dimRow.appendChild(dimSl);
    dimRow.appendChild(dimBtn);
    lb.appendChild(dimRow);
    lb.appendChild(slider(c, { label: 'Transparency', min: 0, max: 100, value: Math.round((1 - s.opacity) * 100), reset: 0, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { commit(c, { opacity: r4(1 - v / 100) }, key); } }, function (b) { return Math.round((1 - spec(b).opacity) * 100); }));
    var baseRow = c.h('<div class="sx-row-between sxb-base"><span><b>Base colour</b><small>Shows through gaps, Fit and transparency</small></span></div>');
    var baseBtn = c.ui.swatchBtn(bg.color || '#ffffff', 'Colour', function (b) {
      c.colorPop(b, { value: curBg(c).color || '#ffffff', title: 'Base colour', onChange: function (v, key) { if (typeof v === 'string') commit(c, { color: v }, key || 'basecol'); } });
    });
    VIEW.sync.push(function (b) { c.paintSwatch(baseBtn.querySelector('i'), b.color || '#ffffff'); });
    baseRow.appendChild(baseBtn);
    lb.appendChild(baseRow);
    host.appendChild(sl);

    /* Adjust */
    var adjOn = LOOK.some(function (x) { return bg.adjust && bg.adjust[x[0]]; });
    var sa = sec(c, 'Adjust', '<button type="button" class="sx-link sxb-adj-reset"' + (adjOn ? '' : ' hidden') + '>Reset</button>');
    var ab = secBody(sa);
    var resetBtn = sa.querySelector('.sxb-adj-reset');
    resetBtn.onclick = function () {
      var b = curBg(c);
      var a = clone(b.adjust || {});
      LOOK.forEach(function (x) { delete a[x[0]]; });
      b.adjust = a;
      c.scene.setBackground(b);
    };
    VIEW.sync.push(function (b) { resetBtn.hidden = !LOOK.some(function (x) { return b.adjust && b.adjust[x[0]]; }); });
    LOOK.forEach(function (x) {
      ab.appendChild(slider(c, { label: x[1], min: x[2], max: x[3], value: num(bg.adjust && bg.adjust[x[0]], 0), reset: 0, onInput: function (v, key) {
        var a = clone(curBg(c).adjust || {});
        a[x[0]] = v;
        var b = curBg(c);
        b.adjust = a;
        c.scene.setBackground(b, { coalesce: key });
      } }, function (b) { return num(b.adjust && b.adjust[x[0]], 0); }));
    });
    host.appendChild(sa);

    /* Filters */
    if (LE.presets && LE.presets.filters) filters(c, host, bg);
  }

  var thumbCache = {};
  function filters(c, host, bg) {
    var sfl = sec(c, 'Filter');
    var b = secBody(sfl);
    var f = bg.filter && bg.filter.name ? bg.filter : null;
    var row = c.h('<div class="sxb-filters"></div>');
    var m = c.mem[bg.src];
    var src = null;
    if (m && m.canvas) {
      var s = spec(bg);
      var sw = m.canvas.width * s.crop.w, sh = m.canvas.height * s.crop.h;
      var k = Math.min(1, 160 / Math.max(sw, sh));
      src = document.createElement('canvas');
      src.width = Math.max(1, Math.round(sw * k));
      src.height = Math.max(1, Math.round(sh * k));
      src.getContext('2d').drawImage(m.canvas, m.canvas.width * s.crop.x, m.canvas.height * s.crop.y, sw, sh, 0, 0, src.width, src.height);
    }
    var key0 = bg.src + '|' + JSON.stringify(bg.crop || null);
    [['', 'Original']].concat(Object.keys(LE.presets.filters).map(function (n) { return [n, FILTER_NAMES[n] || n]; })).forEach(function (fl) {
      var on = (f && f.name) === fl[0] || (!f && !fl[0]);
      var t = c.h('<button type="button" class="sx-filter" aria-pressed="' + on + '" data-lazy="' + fl[0] + '"><span class="sx-filter-art"></span><small>' + c.esc(fl[1]) + '</small></button>');
      t.onclick = function () {
        var cur = curBg(c);
        var it = cur.filter && cur.filter.intensity != null ? cur.filter.intensity : 100;
        commit(c, { filter: fl[0] ? { name: fl[0], intensity: it } : null });
      };
      row.appendChild(t);
    });
    b.appendChild(row);
    if (f) b.appendChild(slider(c, { label: 'Filter strength', min: 0, max: 100, value: f.intensity == null ? 100 : f.intensity, reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { var cur = curBg(c); if (cur.filter) commit(c, { filter: { name: cur.filter.name, intensity: v } }, key); } }, function (bb) { return bb.filter && bb.filter.intensity != null ? bb.filter.intensity : 100; }));
    host.appendChild(sfl);
    function paint(n) {
      var name = n.getAttribute('data-lazy');
      var art = n.querySelector('.sx-filter-art');
      if (!src) return;
      var ck = key0 + '|' + name;
      function show(url) { art.style.backgroundImage = 'url(' + url + ')'; }
      if (thumbCache[ck]) { show(thumbCache[ck]); return; }
      if (!name) { thumbCache[ck] = src.toDataURL('image/jpeg', 0.8); show(thumbCache[ck]); return; }
      LE.applySteps(src, [{ operation: 'filter', parameters: { name: name, intensity: 100 } }]).then(function (r) {
        thumbCache[ck] = r.canvas.toDataURL('image/jpeg', 0.8);
        show(thumbCache[ck]);
      }).catch(function () {});
    }
    if (c.ui.lazy) c.ui.lazy(row, paint); else row.querySelectorAll('[data-lazy]').forEach(paint);
  }

  function sources(c, host, bg) {
    var s = sec(c, isPhoto(bg) ? 'Change photo' : 'Your photos');
    var b = secBody(s);
    var g = c.h('<div class="sx-grid sx-grid-4 sx-thumbs sxb-thumbs"></div>');
    var assets = c.S.project.assets || {};
    Object.keys(assets).forEach(function (id) {
      var meta = assets[id];
      if (meta && /^background-/.test(meta.name || '')) return;
      var t = c.h('<button type="button" class="sx-thumb" aria-pressed="' + (isPhoto(bg) && bg.src === id) + '"><img alt=""></button>');
      t.setAttribute('aria-label', 'Use ' + photoName(c, id) + ' as the background');
      c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
      t.onclick = function () { setPhoto(c, id); c.renderPanel(true); };
      g.appendChild(t);
    });
    if (g.children.length) b.appendChild(g);
    var row = c.h('<div class="sxb-row2"></div>');
    row.appendChild(U().btn(c, 'From device', 'uploads', 'btn btn-ghost btn-sm', function () { pickDevice(c); }));
    row.appendChild(U().btn(c, 'Browse & stock', 'search', 'btn btn-ghost btn-sm', function () { openSources(c); }));
    b.appendChild(row);
    var one = c.one();
    if (isPhoto(bg) && one && one.type === 'image' && one.src) b.appendChild(U().btn(c, 'Use selected photo as background', 'background', 'btn btn-ghost btn-sm sx-block', function () { fromLayer(c, one.id); }));
    host.appendChild(s);
  }

  /* Paper textures (moved here from the colour module's Photos tab). */
  var texUrls = {};
  function texThumb(t, fg, bg) {
    var key = t.id + fg + bg;
    if (texUrls[key]) return texUrls[key];
    var cv = document.createElement('canvas');
    cv.width = 160; cv.height = 120;
    var x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 160, 120);
    try {
      if (t.local) t.draw.call(t, x, 160, 120, { fg: fg, bg: bg, scale: 1 });
      else {
        x.save(); (t.draw || t.render).call(t, x, 160, 120, bg); x.restore();
        x.save(); x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.18; x.fillStyle = fg; x.fillRect(0, 0, 160, 120); x.restore();
      }
    } catch (e) { /* a broken texture keeps its base colour */ }
    texUrls[key] = cv.toDataURL('image/png');
    return texUrls[key];
  }
  function textures(c, host, bg) {
    var COLOR = window.LEStudioColor;
    if (!COLOR || !COLOR.textures || !COLOR.specToBg) return;
    var list = COLOR.textures();
    if (!list.length) return;
    var hex = COLOR.hex || function (v) { return v; };
    var cur = bg.spec && bg.spec.kind === 'texture' ? clone(bg.spec) : { kind: 'texture', id: '', fg: '#3b2f63', bg: '#f6efe1', scale: 1 };
    var s0 = sec(c, 'Paper & textures');
    var b0 = secBody(s0);
    var cols = c.h('<div class="sx-row"></div>');
    var fgB = c.ui.swatchBtn(cur.fg, 'Ink', function (b) { c.colorPop(b, { value: cur.fg, title: 'Texture ink', onChange: function (v) { if (typeof v !== 'string') return; cur.fg = v; fgB.querySelector('i').style.background = v; again(); } }); });
    var bgB = c.ui.swatchBtn(cur.bg, 'Paper', function (b) { c.colorPop(b, { value: cur.bg, title: 'Texture base', onChange: function (v) { if (typeof v !== 'string') return; cur.bg = v; bgB.querySelector('i').style.background = v; again(); } }); });
    cols.appendChild(fgB); cols.appendChild(bgB);
    b0.appendChild(cols);
    var tg = c.h('<div class="sx-pat-grid"></div>');
    var tok = 0;
    function apply2() {
      var my = ++tok;
      COLOR.specToBg(c, clone(cur), c.doc()).then(function (nb) { if (my === tok) COLOR.bgCommit(c, nb); }).catch(function (err) { c.toast((err && err.message) || 'Could not set that texture.'); });
    }
    function again() {
      tg.querySelectorAll('.sx-pat').forEach(function (t) { var tx = list.filter(function (q) { return q.id === t.getAttribute('data-id'); })[0]; if (tx) t.querySelector('i').style.backgroundImage = 'url("' + texThumb(tx, hex(cur.fg), hex(cur.bg)) + '")'; });
      if (!cur.id) return;
      clearTimeout(again._t);
      again._t = setTimeout(apply2, 350);
    }
    list.forEach(function (t) {
      var b = c.h('<button type="button" class="sx-pat" data-id="' + c.esc(t.id) + '" aria-label="' + c.esc(t.name + ' texture') + '" aria-pressed="' + (t.id === cur.id) + '"><i></i><span>' + c.esc(t.name) + '</span></button>');
      b.onclick = function () { cur.id = t.id; tg.querySelectorAll('.sx-pat').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); apply2(); };
      tg.appendChild(b);
    });
    b0.appendChild(tg);
    again();
    host.appendChild(s0);
  }

  /* ---------- Hooks ---------- */
  CMDS.bgEdit = function (c) { enter(c); };
  CMDS.bgDetach = function (c) { detach(c); };
  CMDS.bgPanel = function (c) { c.openPanel('background', { tab: 'photos' }); };
  hook('init', function (c) {
    Object.keys(ICONS).forEach(function (k) { if (c.I && !c.I[k]) c.I[k] = ICONS[k]; });
    bindEntry(c);
  });
  hook('toolbar', function (c, kind) {
    if (kind !== 'page' || !c.S.project || !isPhoto(c.doc().background)) return '';
    return '<button type="button" class="sx-tb has-text sxb-tb" data-cmd="bgEdit" aria-label="Edit background photo" title="Edit background — or double-click the page"' + (ED ? ' aria-pressed="true"' : '') + '>' + c.ic('move') + '<span>Edit background</span></button>';
  });
  hook('page', function () { if (ED) teardown(); });
  hook('select', function (c, ids) { if (ED && ids && ids.length) finish(true); });

  window.LEStudioBackground = {
    enter: function (c) { return enter(c || window.LEStudio); },
    done: function () { finish(true); },
    cancel: function () { finish(false); },
    editing: editing,
    session: function () { return ED ? { start: clone(ED.start), current: clone(ED.cur), undo: ED.undo.length, redo: ED.redo.length } : null; },
    fromLayer: function (c, id) { return fromLayer(c || window.LEStudio, id); },
    detach: function (c) { return detach(c || window.LEStudio); },
    setPhoto: function (c, id, opts) { return setPhoto(c || window.LEStudio, id, opts); },
    update: function (c, patch, key) { commit(c || window.LEStudio, patch || {}, key); },
    isPhoto: isPhoto
  };
})();
