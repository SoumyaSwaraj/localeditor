/* LocalEditor Expert workspace: layout per size class, the right column (scopes, develop, layers), the tool strip, the
 * tablet and phone panel, before/after, mask overlays, keyboard routing, and the asset helpers the tools use.
 *   desktop (>= 1024 px): tool strip | canvas | right column (scopes on top, develop, layers), resizable and collapsible
 *   tablet (768–1023 px): tool strip | canvas; develop, layers and scopes in the studio's floating panel
 *   phone (< 768 px): compact strip over the canvas; the same panels in the bottom sheet; Expert tabs in the tab bar */
(function (global) {
  'use strict';
  var LE = global.LE, X = LE && LE.expert;
  if (!X) return;
  var h = X.h, esc = X.esc, clamp = X.clamp;
  var W = X.workspace = X.workspace || {};
  var on = false, c = null, root = null, size = null;
  var E = {}, comp = {}, panelComp = null, hooked = false, layout = X.lsGet('le-expert-layout', { rightW: 340, split: 0.6, scopes: true, dev: true, lay: true });
  function mq(q) { return X.mq(q); }
  function sizeClass() { return mq('(max-width: 767px)') ? 'phone' : mq('(max-width: 1023px)') ? 'tablet' : 'desktop'; }
  function saveLayout() { X.lsSet('le-expert-layout', layout); }
  W.active = function () { return on; };
  W.size = function () { return size; };
  W.components = function () { return Object.assign({}, comp, { panel: panelComp }); };

  /* ---------- Assets (masks, overlays) ---------- */
  X.maskAssets = X.maskAssets || {};
  X.assetCanvas = function (id) { var m = c && c.mem && c.mem[id]; return (m && m.canvas) || X.maskAssets[id] || null; };
  X.assetCanvases = function () {
    var out = {};
    if (!c) return out;
    c.scene.layers().forEach(function (l) {
      var all = [X.doc.mask(l)].concat((l.fx || []).map(function (e) { return e.mask; }));
      all.forEach(function (m) { (m && m.parts || []).forEach(function (p) { if (p.asset) { var cv = X.assetCanvas(p.asset); if (cv) out[p.asset] = cv; } }); });
    });
    return out;
  };
  /* Store a canvas as a project asset (PNG); resolves to its id. Also registered with the scene so the renderer can draw it. */
  X.storeCanvas = function (canvas, name) {
    var toBlob = LE.toBlob ? LE.toBlob(canvas, 'image/png') : new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
    return toBlob.then(function (blob) {
      var put = LE.project && LE.project.putAsset ? LE.project.putAsset({ blob: blob, name: name || 'mask.png', type: 'image/png', width: canvas.width, height: canvas.height }) : Promise.resolve({ id: X.uid('mask') });
      return put.then(function (meta) {
        X.maskAssets[meta.id] = canvas;
        if (c) {
          c.mem[meta.id] = { meta: meta, canvas: canvas };
          c.scene.addAsset(meta.id, canvas);
          if (c.S.project && c.S.project.assets) c.S.project.assets[meta.id] = meta;
        }
        return meta.id;
      });
    });
  };

  /* ---------- Geometry for overlays ---------- */
  function box(id) {
    var l = c && c.scene.layer(id); if (!l) return null;
    var r = c.scene._rectToScreen({ x: l.x, y: l.y, w: l.w, h: l.h });
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height, rotation: l.rotation || 0 } : null;
  }
  var viewFns = [];
  function onView(fn) { viewFns.push(fn); return function () { var i = viewFns.indexOf(fn); if (i >= 0) viewFns.splice(i, 1); }; }
  var viewChanged = X.rafThrottle(function () { viewFns.slice().forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); });
  W.onView = onView;   /* tools redraw their own overlays when the canvas scrolls, zooms or resizes */
  function toDoc(cx, cy) { var r = c.E.sceneEl.getBoundingClientRect(); return c.scene._cssToDoc(cx - r.left, cy - r.top); }
  function target() {
    var d = comp.develop || (panelComp && panelComp.develop);
    if (d) return d.target();
    var ids = c.sel(); if (ids.length === 1) return ids[0];
    var b = c.targetImage(); return b ? b.id : null;
  }
  W.target = target;

  /* ---------- Mask overlay ---------- */
  var maskView = null, maskJob = 0, srcCache = {};
  function layerPixels(l, w, hh) {
    var m = l && l.src && c.mem[l.src];
    if (!m || !m.canvas) return null;
    var k = l.src + '|' + w + 'x' + hh + '|' + JSON.stringify(l.crop || {});
    if (srcCache.k === k) return srcCache.px;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    var cr = l.crop || { x: 0, y: 0, w: 1, h: 1 }, s = m.canvas;
    cv.getContext('2d').drawImage(s, cr.x * s.width, cr.y * s.height, cr.w * s.width, cr.h * s.height, 0, 0, w, hh);
    srcCache = { k: k, px: cv.getContext('2d').getImageData(0, 0, w, hh).data };
    return srcCache.px;
  }
  function paintMask() {
    if (!maskView || !maskView.mask || !maskView.layerId) { X.canvas.maskOverlay && X.canvas.maskOverlay(null, null, null); return; }
    X.cancelIdle(maskJob);
    maskJob = X.idle(function () {
      var l = c && c.scene.layer(maskView.layerId); if (!l) return;
      var edge = X.scopes && X.scopes.interactive ? 200 : 480;
      var s = edge / Math.max(l.w, l.h), w = Math.max(8, Math.round(l.w * s)), hh = Math.max(8, Math.round(l.h * s));
      var cut = l.cutout && l.cutout.asset ? X.assetCanvas(l.cutout.asset) : null;
      var data = X.evalMask(maskView.mask, { w: w, h: hh, pixels: layerPixels(l, w, hh), assets: X.assetCanvases(), cutout: cut });
      X.canvas.maskOverlay(maskView.layerId, { w: w, h: hh, data: data }, maskView.view, box(maskView.layerId));
    }, 200);
  }
  X.on('mask-view', function (v) { if (!on) return; maskView = v && v.mask && v.mask.parts && v.mask.parts.length ? v : null; paintMask(); });

  /* ---------- Before / after ---------- */
  var cmp = { mode: 'off', last: 'split', pos: 0.5, canvas: null, key: '', el: null, job: 0 };
  function beforeDoc() {
    var d = c.doc();
    d.layers = d.layers.filter(function (l) { return l.type !== 'adjust'; }).map(function (l) {
      delete l.fx; delete l.retouch; delete l.transform; delete l.raw;
      if (l[X.doc.MASK] && typeof l[X.doc.MASK] === 'object') l[X.doc.MASK] = l.type === 'image' ? 'none' : null;
      if (l.type === 'image') { l.adjust = {}; l.filter = null; }
      return l;
    });
    return d;
  }
  function cmpRender() {
    if (cmp.mode === 'off' || !c.S.project) return;
    var d = beforeDoc(), key = JSON.stringify(d);
    var pr = c.scene.pageRect();
    var scale = Math.min(1, (pr.width * (global.devicePixelRatio || 1)) / d.width);
    if (key === cmp.key && cmp.canvas && Math.abs(cmp.scale - scale) < 0.05) { cmpPlace(); return; }
    cmp.key = key; cmp.scale = scale;
    var job = ++cmp.job;
    c.hiddenRender(d, Math.max(0.05, scale), { small: scale < 0.5 }).then(function (cv) {
      if (job !== cmp.job || cmp.mode === 'off') return;
      cmp.canvas = cv;
      var host = cmp.el.querySelector('.xp-before-img');
      host.innerHTML = ''; host.appendChild(cv);
      cmpPlace();
    }).catch(function (err) { console.error(err); });
  }
  function cmpPlace() {
    if (!cmp.el || cmp.mode === 'off') return;
    var stage = c.E.stage.getBoundingClientRect(), pr = c.scene.pageRect();
    var img = cmp.el.querySelector('.xp-before-img');
    var left = pr.left - stage.left, top = pr.top - stage.top;
    if (cmp.mode === 'side') left -= stage.width / 2;
    img.style.left = left + 'px'; img.style.top = top + 'px'; img.style.width = pr.width + 'px'; img.style.height = pr.height + 'px';
    var div = cmp.el.querySelector('.xp-divider');
    if (cmp.mode === 'split') {
      var x = left + pr.width * cmp.pos;
      img.style.clipPath = 'inset(0 ' + ((1 - cmp.pos) * 100) + '% 0 0)';
      div.hidden = false; div.style.left = x + 'px';
      div.setAttribute('aria-valuenow', String(Math.round(cmp.pos * 100)));
    } else { img.style.clipPath = ''; div.hidden = true; }
  }
  function sideFit() {
    var el = c.E.sceneEl, cw = el.clientWidth / 2, ch = el.clientHeight, d = c.doc();
    var pad = 24, z = Math.min((cw - pad * 2) / d.width, (ch - pad * 2) / d.height);
    c.S.fitting = true;
    c.scene.setView(z, cw + (cw - d.width * z) / 2, (ch - d.height * z) / 2);
    c.S.fitting = false;
  }
  W.compare = function (mode) {
    if (mode == null) return cmp.mode;
    if (!c.S.project) { c.toast('Open a photo to compare.'); return cmp.mode; }
    var was = cmp.mode;
    cmp.mode = mode;
    if (mode !== 'off' && mode !== 'before') cmp.last = mode;
    if (!cmp.el) {
      cmp.el = h('<div class="xp-compare" aria-live="polite"><div class="xp-before-img" aria-hidden="true"></div><div class="xp-divider" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Before and after divider" aria-valuemin="0" aria-valuemax="100" hidden><i></i></div><span class="xp-cmp-l">Before</span><span class="xp-cmp-r">After</span></div>');
      var div = cmp.el.querySelector('.xp-divider');
      X.controls.drag(div, { slop: 0, move: function (e) { var pr = c.scene.pageRect(); cmp.pos = clamp((e.clientX - pr.left) / pr.width, 0, 1); cmpPlace(); } });
      div.style.touchAction = 'none';
      div.addEventListener('keydown', function (e) { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation(); cmp.pos = clamp(cmp.pos + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.02), 0, 1); cmpPlace(); });
    }
    root.classList.toggle('xp-cmp-on', mode !== 'off');
    root.setAttribute('data-xp-compare', mode);
    if (mode === 'off') { cmp.el.remove(); cmp.key = ''; if (was === 'side') c.fit(); paintCompareBtn(); return mode; }
    if (!cmp.el.isConnected) c.E.stage.appendChild(cmp.el);
    cmp.el.setAttribute('data-mode', mode);
    if (mode === 'side') sideFit(); else if (was === 'side') c.fit();
    cmp.key = '';
    cmpRender();
    paintCompareBtn();
    return mode;
  };
  function paintCompareBtn() {
    [].forEach.call(document.querySelectorAll('[data-xp-cmp]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-xp-cmp') === cmp.mode ? 'true' : 'false'); });
  }

  /* ---------- The right column (desktop) ---------- */
  function pane(cls, title, key, extra) {
    var p = h('<section class="xp-pane ' + cls + (layout[key] === false ? ' is-collapsed' : '') + '" aria-label="' + esc(title) + '"><header class="xp-pane-head"><button type="button" class="xp-pane-tog" aria-expanded="' + (layout[key] !== false) + '">' + X.ic('chev', 'xp-chev') + '<h2>' + esc(title) + '</h2></button>' + (extra || '') + '</header><div class="xp-pane-body"></div></section>');
    p.querySelector('.xp-pane-tog').addEventListener('click', function () {
      layout[key] = layout[key] === false;
      p.classList.toggle('is-collapsed', !layout[key]);
      p.querySelector('.xp-pane-tog').setAttribute('aria-expanded', layout[key] ? 'true' : 'false');
      saveLayout(); applySplit();
      if (key === 'scopes' && layout[key]) { X.scopes.request(); }
    });
    return p;
  }
  function cmpButtons() {
    return '<span class="xp-seg xp-seg-xs xp-cmp-seg" role="group" aria-label="Compare">' +
      '<button type="button" data-xp-cmp="before" aria-pressed="false" title="Before / after (\\)" aria-label="Before and after (backslash)">' + X.ic('compare') + '</button>' +
      '<button type="button" data-xp-cmp="split" aria-pressed="false" title="Split view (Y)" aria-label="Split view">' + X.ic('split') + '</button>' +
      '<button type="button" data-xp-cmp="side" aria-pressed="false" title="Side by side (Y)" aria-label="Side by side">' + X.ic('sideBySide') + '</button></span>';
  }
  function bindCmp(host) {
    host.addEventListener('click', function (e) { var b = e.target.closest('[data-xp-cmp]'); if (!b) return; var m = b.getAttribute('data-xp-cmp'); W.compare(cmp.mode === m ? 'off' : m); });
  }
  function buildRight() {
    var r = E.right = h('<aside class="xp-right" id="xp-right" aria-label="Expert panels"><div class="xp-resizer" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Panel width" aria-valuemin="280" aria-valuemax="560"></div></aside>');
    var sc = pane('xp-pane-scopes', 'Scopes', 'scopes', cmpButtons());
    var dev = pane('xp-pane-dev', 'Develop', 'dev');
    var split = h('<div class="xp-split" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Develop and layers split" aria-valuemin="20" aria-valuemax="85"></div>');
    var lay = pane('xp-pane-lay', 'Layers', 'lay');
    r.appendChild(sc); r.appendChild(dev); r.appendChild(split); r.appendChild(lay);
    bindCmp(sc);
    comp.scope = X.scopes.create(sc.querySelector('.xp-pane-body'));
    comp.develop = X.develop(dev.querySelector('.xp-pane-body'));
    comp.layers = X.layers(lay.querySelector('.xp-pane-body'));
    /* Width */
    var rz = r.querySelector('.xp-resizer'), w0 = 0;
    X.controls.drag(rz, { slop: 0, start: function () { w0 = layout.rightW; }, move: function (e, dx) { layout.rightW = clamp(Math.round(w0 - dx), 280, 560); applyWidth(); }, end: function () { saveLayout(); c.fit(); } });
    rz.addEventListener('keydown', function (e) { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation(); layout.rightW = clamp(layout.rightW + (e.key === 'ArrowLeft' ? 16 : -16), 280, 560); applyWidth(); saveLayout(); });
    C2.doubleTap(rz, function () { layout.rightW = 340; applyWidth(); saveLayout(); c.fit(); });
    /* Develop / layers split */
    var s0 = 0, hh = 1;
    X.controls.drag(split, { slop: 0, start: function () { s0 = layout.split; hh = dev.parentNode.clientHeight - sc.offsetHeight || 1; }, move: function (e, dx, dy) { layout.split = clamp(s0 + dy / hh, 0.2, 0.85); applySplit(); }, end: saveLayout });
    split.addEventListener('keydown', function (e) { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); e.stopPropagation(); layout.split = clamp(layout.split + (e.key === 'ArrowDown' ? 0.05 : -0.05), 0.2, 0.85); applySplit(); saveLayout(); });
    /* Keys typed in the panels never reach the canvas shortcuts (Backspace would delete the layer). */
    r.addEventListener('keydown', function (e) { if (e.key === 'Backspace' || e.key === 'Delete') e.stopPropagation(); });
    root.appendChild(r);
    applyWidth(); applySplit();
  }
  var C2 = X.controls;
  function applyWidth() {
    root.style.setProperty('--xp-right-w', layout.rightW + 'px');
    var rz = E.right && E.right.querySelector('.xp-resizer'); if (rz) rz.setAttribute('aria-valuenow', String(layout.rightW));
  }
  function applySplit() {
    if (!E.right) return;
    var dev = E.right.querySelector('.xp-pane-dev'), lay = E.right.querySelector('.xp-pane-lay'), split = E.right.querySelector('.xp-split');
    var both = layout.dev !== false && layout.lay !== false;
    split.hidden = !both;
    dev.style.flex = layout.dev === false ? '0 0 auto' : both ? (layout.split + ' 1 0') : '1 1 0';
    lay.style.flex = layout.lay === false ? '0 0 auto' : both ? ((1 - layout.split) + ' 1 0') : '1 1 0';
    split.setAttribute('aria-valuenow', String(Math.round(layout.split * 100)));
  }

  /* ---------- Strip ---------- */
  function buildStrip(horizontal) {
    var s = E.strip = h('<nav class="xp-strip' + (horizontal ? ' is-h' : '') + '" id="xp-strip" aria-label="Expert tools"></nav>');
    X.tools.renderStrip(s, { horizontal: horizontal });
    var more = h('<div class="xp-strip-foot"></div>');
    if (!horizontal && size === 'tablet') {
      [['adjust', 'Develop', 'develop'], ['layers', 'Layers', 'layers'], ['scopes', 'Scopes', 'scopes']].forEach(function (t) {
        var b = h('<button type="button" class="xp-tool" data-xp-tab="' + t[0] + '" aria-label="' + t[1] + '" title="' + t[1] + '">' + X.ic(t[2]) + '</button>');
        b.addEventListener('click', function () { openPanelTab(t[0]); });
        more.appendChild(b);
      });
    }
    var all = h('<button type="button" class="xp-tool" aria-haspopup="menu" aria-label="Simple studio tools" title="Simple studio tools">' + X.ic('grid') + '</button>');
    all.addEventListener('click', function () {
      X.menu(all, c.railItems().map(function (it) { return { label: it.label, icon: it.icon, fn: function () { c.openPanel(it.id); } }; }));
    });
    more.appendChild(all);
    var keys = h('<button type="button" class="xp-tool" aria-label="Shortcuts (?)" title="Shortcuts (?)">' + X.ic('keyboard') + '</button>');
    keys.addEventListener('click', function () { X.shortcutSheet(); });
    more.appendChild(keys);
    s.appendChild(more);
    if (horizontal) c.E.stage.appendChild(s); else root.appendChild(s);
  }
  /* ---------- Phone tab bar ---------- */
  function buildTabs() {
    var t = E.tabs = h('<nav class="xp-tabs" aria-label="Expert panels"></nav>');
    [['adjust', 'Develop', 'develop'], ['mask', 'Mask', 'mask'], ['layers', 'Layers', 'layers'], ['scopes', 'Scopes', 'scopes'], ['more', 'More', 'grid']].forEach(function (x) {
      var b = h('<button type="button" class="sx-rail-btn" data-xp-tab="' + x[0] + '" aria-pressed="false"><span class="sx-rail-ic">' + X.ic(x[2]) + '</span><span class="sx-rail-lb">' + x[1] + '</span></button>');
      b.addEventListener('click', function () {
        if (x[0] === 'more') { if (c.S.panel === 'more') c.closePanel(); else c.openPanel('more'); markTabs(); return; }
        if (c.S.panel === 'expert' && c.S.panelOpts.tab === x[0]) { c.closePanel(); markTabs(); return; }
        openPanelTab(x[0]);
      });
      t.appendChild(b);
    });
    root.appendChild(t);
  }
  function markTabs() {
    [].forEach.call(document.querySelectorAll('[data-xp-tab]'), function (b) {
      var id = b.getAttribute('data-xp-tab');
      var pressed = (id === 'more' && c.S.panel && c.S.panel !== 'expert') || (c.S.panel === 'expert' && (c.S.panelOpts.tab || 'adjust') === id);
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }
  function openPanelTab(tab) {
    c.openPanel('expert', { tab: tab === 'mask' ? 'adjust' : tab, mask: tab === 'mask' });
    markTabs();
  }

  /* Brings a panel forward (deep links, assets/js/expert/links.js): 'develop' | 'mask' | 'layers' | 'scopes'. On desktop the pane
     is expanded, scrolled into view and its heading focused; elsewhere the tab opens. False for a name it does not know. */
  W.show = function (tab) {
    var t = { develop: 'adjust', mask: 'mask', layers: 'layers', scopes: 'scopes' }[tab];
    if (!on || !t) return false;
    if (size !== 'desktop') { openPanelTab(t); return true; }
    var key = t === 'layers' ? 'lay' : t === 'scopes' ? 'scopes' : 'dev';
    var p = E.right && E.right.querySelector('.xp-pane-' + key), tog = p && p.querySelector('.xp-pane-tog');
    if (!p) return false;
    if (layout[key] === false) tog.click();
    if (t === 'mask' && comp.develop) { comp.develop.open('Mask', true); var s = p.querySelector('[data-sec="Mask"]'); if (s) s.scrollIntoView({ block: 'nearest' }); }
    else p.scrollIntoView({ block: 'nearest' });
    tog.focus({ preventScroll: true });
    return true;
  };

  /* ---------- The studio panel (tablet and phone) ---------- */
  function destroyPanelComp() {
    if (!panelComp) return;
    ['develop', 'layers'].forEach(function (k) { if (panelComp[k]) panelComp[k].destroy(); });
    panelComp = null;
  }
  function panelSpec() {
    return {
      title: function (cc, o) { return { adjust: 'Develop', layers: 'Layers', scopes: 'Scopes' }[o.tab || 'adjust'] || 'Develop'; },
      eyebrow: 'Expert', sheet: function (cc, o) { return o.tab === 'scopes' ? 'peek' : 'half'; },
      render: function (cc, body, o) {
        destroyPanelComp();
        var tab = o.tab || 'adjust';
        var row = h('<div class="sx-tabs-row is-fill xp-ptabs" role="tablist"></div>');
        [['adjust', 'Develop'], ['layers', 'Layers'], ['scopes', 'Scopes']].forEach(function (t) {
          var b = h('<button type="button" role="tab" aria-selected="' + (t[0] === tab) + '">' + t[1] + '</button>');
          b.addEventListener('click', function () { cc.S.panelOpts.tab = t[0]; cc.S.panelOpts.mask = false; cc.renderPanel(); markTabs(); });
          row.appendChild(b);
        });
        body.appendChild(row);
        var host = h('<div class="xp-phost"></div>');
        body.appendChild(host);
        panelComp = {};
        if (tab === 'scopes') {
          var sc = h('<div class="xp-pscopes"></div>');
          sc.innerHTML = cmpButtons();
          bindCmp(sc);
          host.appendChild(sc);
          panelComp.scope = X.scopes.create(host);
          X.scopes.request();
        } else if (tab === 'layers') panelComp.layers = X.layers(host);
        else {
          panelComp.develop = X.develop(host);
          if (o.mask) panelComp.develop.open('Mask', true);
        }
        host.addEventListener('keydown', function (e) { if (e.key === 'Backspace' || e.key === 'Delete') e.stopPropagation(); });
        markTabs();
      },
      close: function () { destroyPanelComp(); setTimeout(markTabs, 0); }
    };
  }

  /* ---------- Hooks into the studio (registered once; idle while Expert is off) ---------- */
  function hooks() {
    if (hooked) return;
    hooked = true;
    var P = global.LEStudioPanels, H = P._hooks = P._hooks || {};
    function add(n, f) { (H[n] = H[n] || []).push(function (cc, a, b) { if (on) return f(a, b); }); }
    add('change', onDoc);
    add('select', function () { onDoc(); });
    add('page', function () { if (comp.develop) comp.develop.rebuild(); if (panelComp && panelComp.develop) panelComp.develop.rebuild(); });
    add('zoom', function () { viewChanged(); });
    add('resize', function () { viewChanged(); });
    add('toolbar', function (kind) { if (kind === 'crop') return; var s = X.tools.optionsHtml(); return s || undefined; });
    add('toolbar-add', function (kind) { if (kind === 'crop' && X.tools.active() === 'crop') return X.tools.optionsHtml(); });
    add('panel-close', function (id) { if (id === 'expert') destroyPanelComp(); setTimeout(markTabs, 0); });
    P.expert = panelSpec();
    new MutationObserver(function () { if (on) X.tools.fillSlot(); }).observe(c.E.tool, { childList: true });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', X.rafThrottle(function () { if (on) { var s = sizeClass(); if (s !== size) relayout(); viewChanged(); } }));
    c.E.stage.addEventListener('scroll', viewChanged, true);
    var ro = global.ResizeObserver ? new ResizeObserver(function () { if (on) viewChanged(); }) : null;
    if (ro) ro.observe(c.E.stage);
  }
  var docSoon = X.rafThrottle(function () {
    if (!on) return;
    if (comp.develop) comp.develop.sync();
    /* The layer list waits for the end of a drag (its rows show nothing a slider changes live). */
    if (comp.layers && !X.scopes.interactive) comp.layers.render();
    if (panelComp && panelComp.develop) panelComp.develop.sync();
    if (panelComp && panelComp.layers && !X.scopes.interactive) panelComp.layers.render();
    X.scopes.request();
    viewChanged();
    if (X.handles) X.handles.sync();
    if (cmp.mode !== 'off') cmpRenderLater();
    if (maskView) { var m = X.doc.getMask(maskView.layerId, maskView.fxId); if (m) { maskView.mask = m; paintMask(); } }
  });
  var cmpT = 0;
  function cmpRenderLater() { clearTimeout(cmpT); cmpT = setTimeout(cmpRender, 260); }
  function onDoc() { docSoon(); }
  function onKey(e) {
    if (!on) return;
    var t = e.target, k = e.key;
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (c.E.modal && !c.E.modal.hidden) return;
    var mod = e.ctrlKey || e.metaKey;
    if (k === '\\' && !mod && !e.altKey) { if (!e.repeat) W.compare(cmp.mode === 'off' ? 'before' : 'off'); stop(e); return; }
    if ((k === 'y' || k === 'Y') && !mod && !e.altKey && !e.shiftKey) { W.compare(cmp.mode === 'off' || cmp.mode === 'before' ? 'split' : cmp.mode === 'split' ? 'side' : 'off'); stop(e); return; }
    if (X.tools.handleKey(e)) { stop(e); return; }
  }
  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  /* ---------- Layout ---------- */
  function teardown() {
    destroyPanelComp();
    if (c.S.panel === 'expert') c.closePanel();
    ['develop', 'layers'].forEach(function (k) { if (comp[k]) comp[k].destroy(); });
    comp = {};
    ['right', 'strip', 'tabs'].forEach(function (k) { if (E[k]) E[k].remove(); E[k] = null; });
  }
  function relayout() {
    var reopen = c.S.panel === 'expert' ? Object.assign({}, c.S.panelOpts) : null;
    var was = size;
    teardown();
    size = sizeClass();
    root.setAttribute('data-xp-size', size);
    if (size === 'desktop') { buildStrip(false); buildRight(); }
    else if (size === 'tablet') { buildStrip(false); }
    else { buildStrip(true); buildTabs(); }
    if (size !== 'desktop' && (reopen || !relayout.done || was === 'desktop')) openPanelTab((reopen && reopen.tab) || 'adjust');
    relayout.done = true;
    X.scopes.request();
    setTimeout(function () { c.fit(); viewChanged(); }, 30);
  }

  W.enter = function (ctx) {
    if (on) return;
    c = ctx || global.LEStudio;
    root = document.getElementById('sx');
    on = true;
    hooks();
    root.classList.add('is-expert');
    document.body.classList.add('xp-body');
    X.canvas.attach(c.E.stage, { box: box, onChange: onView });
    X.canvas._page = function () { return c.scene.pageRect(); };
    /* The page area of the stage canvas, in canvas pixels (what the person sees). */
    X.scopes.source = function () {
      var cv = c.S.project && c.E.sceneEl.querySelector('canvas.le-view');
      if (!cv || !cv.clientWidth) return null;
      var k = cv.width / cv.clientWidth, z = c.scene.zoom(), v = c.scene.view(), d = c.doc();
      var sx = v.panX * k, sy = v.panY * k, sw = d.width * z * k, sh = d.height * z * k;
      var x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(cv.width, sx + sw), y1 = Math.min(cv.height, sy + sh);
      if (x1 - x0 < 2 || y1 - y0 < 2) return null;
      return { canvas: cv, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    X.tools.mount({ ctx: c, stage: c.E.stage, toDoc: toDoc, zoom: function () { return c.scene.zoom(); }, target: target, box: box });
    onView(function () { X.tools.placeOverlays(); if (X.scopes.clipOn) X.scopes.paintClip(); if (maskView) paintMask(); cmpPlace(); });
    relayout.done = false;
    relayout();
    var R = X.registry && X.registry();
    if (!R && LE.fxBoot && typeof LE.fxBoot.load === 'function') { try { LE.fxBoot.load().then(function () { if (on) relayout(); }); } catch (e) {} }
    if (size === 'phone' && !X.lsGet('le-expert-phone-note', 0)) {
      X.lsSet('le-expert-phone-note', 1);
      c.toast('Expert mode is designed for a larger screen. Everything works here, with tighter panels.', { ms: 6000 });
    }
    c.renderToolbar();
    X.emit('enter');
  };
  W.leave = function () {
    if (!on) return;
    if (cmp.mode !== 'off') W.compare('off');
    X.emit('target', null);
    X.tools.unmount();
    teardown();
    X.canvas.detach();
    if (X.canvas.maskOverlay) X.canvas.maskOverlay(null, null, null);
    X.scopes.clipOn = false; if (X.scopes._ov) X.scopes._ov.hidden = true;
    maskView = null;
    on = false;
    root.classList.remove('is-expert');
    root.removeAttribute('data-xp-size');
    document.body.classList.remove('xp-body');
    if (c.scene.tool() === 'hand') c.scene.setTool('select');
    c.renderToolbar();
    c.renderRail();
    setTimeout(function () { c.fit(); }, 30);
    X.emit('leave');
  };
  X.on('edit-mask', function (m) {
    if (!on) return;
    if (size === 'desktop' && comp.develop) { layout.dev = true; saveLayout(); comp.develop.open('Mask', true); var s = E.right && E.right.querySelector('[data-sec="Mask"]'); if (s) s.scrollIntoView({ block: 'nearest' }); }
    else openPanelTab('mask');
    void m;
  });
  X.on('tool', function () { if (on) setTimeout(markTabs, 0); });
  /* While a control is dragged the studio holds its own canvas-side work (mini toolbar, toolbar redraws, panel refresh), as it
     does for a drag on the canvas; its window pointerup handler releases it. */
  X.on('interactive', function (v) { if (on && v && c) c.S.pointer = true; if (on && !v) docSoon(); });
})(window);
