/* LocalEditor studio: panels most sessions never open, loaded on demand (docs/LOADING.md, module "panels2" in
   le-studio-lazy.js): Design (text layouts, Resize, Size history), Position (arrange and layers), Your designs, Version history,
   Performance, and the small Apps (watermark, meme, palette, metadata, before/after, upscale, contact sheet).
   The code is moved from le-studio-panels.js unchanged; helpers come from P._u. */
(function () {
  'use strict';
  var P = window.LEStudioPanels;
  var LE = window.LE;
  if (!P || !P._u) return;
  var U = P._u;
  var tabs = U.tabs, grid = U.grid, btn = U.btn, note = U.note, needProject = U.needProject, sizeArt = U.sizeArt, when = U.when,
    projectCard = U.projectCard, noImage = U.noImage, copy = U.copy;

  /* ---------- Design: text layouts, Resize and Size history ---------- */
  var TEMPLATES = [
    { id: 'caption', name: 'Bold caption', build: function (W, H, s) {
      return [
        { type: 'shape', shape: 'rectangle', name: 'Shade', x: 0, y: H * 0.55, w: W, h: H * 0.45, fill: { type: 'linear', colors: ['rgba(17,15,23,0)', 'rgba(17,15,23,.82)'], angle: 90 } },
        { type: 'text', text: 'Weekend in the hills', font: 'Plus Jakarta Sans', weight: 800, size: 84, w: 900, color: '#FFFFFF', align: 'left', abs: { x: W * 0.07, y: H * 0.74 } },
        { type: 'text', text: 'A few quiet days, written down.', font: 'Instrument Serif', italic: true, weight: 400, size: 44, w: 900, color: '#F2D594', align: 'left', abs: { x: W * 0.07, y: H * 0.86 } }
      ];
    } },
    { id: 'polaroid', name: 'Polaroid frame', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'shape', shape: 'rectangle', name: 'Frame', x: 0, y: 0, w: W, h: H, fill: { type: 'none' }, stroke: { width: m * 0.09, color: '#FBF8F3', join: 'miter' } },
        { type: 'shape', shape: 'rectangle', name: 'Frame bottom', x: 0, y: H - m * 0.2, w: W, h: m * 0.2, fill: { type: 'solid', color: '#FBF8F3' } },
        { type: 'text', text: 'summer ’26', font: 'Caveat', weight: 700, size: 70, w: 700, color: '#17131F', abs: { x: W / 2 - 350 * m / 1080, y: H - m * 0.15 } }
      ];
    } },
    { id: 'quote', name: 'Quote card', build: function (W, H) {
      return [
        { type: 'shape', shape: 'rounded-rectangle', name: 'Card', params: { radius: 40 * Math.min(W, H) / 1080 }, x: W * 0.08, y: H * 0.22, w: W * 0.84, h: H * 0.56, fill: { type: 'solid', color: 'rgba(251,248,243,.92)' }, shadow: { color: 'rgba(23,19,31,.25)', blur: 40, x: 0, y: 18 } },
        { type: 'text', text: '“Simplicity is the ultimate sophistication.”', font: 'Playfair Display', italic: true, weight: 400, size: 64, w: 760, color: '#17131F', lineHeight: 1.25, dy: -30 },
        { type: 'text', text: '— LEONARDO', font: 'Plus Jakarta Sans', weight: 700, size: 26, letterSpacing: 8, w: 760, color: '#B9832F', dy: 130 }
      ];
    } },
    { id: 'sale', name: 'Sale post', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'shape', shape: 'burst', name: 'Burst', params: {}, x: W - m * 0.42, y: m * 0.05, w: m * 0.36, h: m * 0.36, fill: { type: 'solid', color: '#E0668E' } },
        { type: 'text', text: '50%\nOFF', font: 'Anton', weight: 400, size: 74, w: 300, color: '#FFFFFF', lineHeight: 1, abs: { x: W - m * 0.42 + m * 0.18 - 150 * m / 1080, y: m * 0.05 + m * 0.18 - 74 * m / 1080 } },
        { type: 'text', text: 'SUMMER SALE', font: 'Bebas Neue', weight: 400, size: 180, w: 1000, color: '#FFFFFF', shadow: { color: 'rgba(23,19,31,.45)', blur: 24, x: 0, y: 8 }, dy: 260 }
      ];
    } },
    { id: 'event', name: 'Event poster', build: function (W, H) {
      return [
        { type: 'shape', shape: 'rectangle', name: 'Tint', x: 0, y: 0, w: W, h: H, fill: { type: 'linear', colors: ['rgba(42,26,62,.75)', 'rgba(116,87,240,.35)'], angle: 90 } },
        { type: 'text', text: 'LIVE IN CONCERT', font: 'Plus Jakarta Sans', weight: 700, size: 30, letterSpacing: 14, w: 900, color: '#F2D594', dy: -200 },
        { type: 'text', text: 'Midnight\nAurora', font: 'Instrument Serif', italic: true, weight: 400, size: 190, w: 960, color: '#FFFFFF', lineHeight: 0.95, dy: -10 },
        { type: 'text', text: 'FRI 14 NOV · THE HALL', font: 'Space Grotesk', weight: 700, size: 34, letterSpacing: 6, w: 900, color: '#FFFFFF', dy: 240 }
      ];
    } },
    { id: 'thumb', name: 'Thumbnail punch', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'text', text: 'I TRIED IT', font: 'Anton', weight: 400, size: 200, w: 1000, color: '#FFFFFF', stroke: { width: 10, color: '#17131F' }, rotation: -3, abs: { x: W * 0.05, y: H * 0.08 } },
        { type: 'shape', shape: 'arrow-curved', name: 'Arrow', params: {}, x: W * 0.55, y: H * 0.5, w: m * 0.32, h: m * 0.32, fill: { type: 'solid', color: '#FFB020' } }
      ];
    } },
    { id: 'minimal', name: 'Minimal title', build: function (W, H) {
      return [
        { type: 'text', text: 'the quiet edit', font: 'Cormorant Garamond', italic: true, weight: 400, size: 130, w: 960, color: '#FFFFFF', shadow: { color: 'rgba(0,0,0,.35)', blur: 24, x: 0, y: 4 }, dy: -10 },
        { type: 'shape', shape: 'line', name: 'Rule', x: W / 2 - 80 * Math.min(W, H) / 1080, y: H / 2 + 80 * Math.min(W, H) / 1080, w: 160 * Math.min(W, H) / 1080, h: 10, fill: { type: 'none' }, stroke: { width: 3, color: '#FFFFFF', cap: 'round' } }
      ];
    } },
    { id: 'story', name: 'Story announcement', build: function (W, H) {
      var m = Math.min(W, H);
      return [
        { type: 'text', text: 'NEW', font: 'Plus Jakarta Sans', weight: 800, size: 40, letterSpacing: 10, w: 420, color: '#2C220F', background: { color: '#F2D594', radius: 999, padding: 20 }, abs: { x: W / 2 - 210 * m / 1080, y: H * 0.12 } },
        { type: 'text', text: 'Swipe up\nfor the drop', font: 'Syne', weight: 700, size: 120, w: 960, color: '#FFFFFF', lineHeight: 1, fill: { type: 'linear', colors: ['#FFFFFF', '#F2D594'], angle: 90 }, abs: { x: W / 2 - 480 * m / 1080, y: H * 0.7 } }
      ];
    } }
  ];
  function applyTemplate(c, t) {
    var d = c.doc();
    var W = d.width, H = d.height, s = Math.min(W, H) / 1080;
    var list = t.build(W, H, s);
    c.batch(function () {
      var ids = list.map(function (l) {
        if (l.type === 'text') {
          var spec = Object.assign({ align: 'center' }, l);
          var abs = spec.abs;
          delete spec.abs;
          var id = c.addText(spec);
          if (abs) c.patch(id, { x: abs.x, y: abs.y });
          return id;
        }
        return c.scene.add(l);
      });
      var gid = c.scene.group(ids);
      c.patch(gid, { name: t.name });
      c.scene.select([gid]);
    });
    c.toast('Template added — everything stays editable');
  }
  function renderTemplates(c, body) {
    if (window.LEStudioCollage && typeof LEStudioCollage.renderCatalog === 'function') {
      try {
        LEStudioCollage.renderCatalog(c, body, { surface: 'design', textTemplates: TEMPLATES, applyText: applyTemplate });
        return;
      } catch (err) { /* keep the original text layouts if the catalog cannot render */ }
    }
    var sec = c.ui.section('Layouts for this page');
    var g = grid('sx-grid-2');
    TEMPLATES.forEach(function (t) {
      var b = c.h('<button type="button" class="sx-tpl sx-tpl-' + t.id + '"><span class="sx-tpl-art" aria-hidden="true"><i></i><i></i><i></i></span><b>' + c.esc(t.name) + '</b></button>');
      b.onclick = function () { if (!c.S.project) { c.useSample().then(function () { applyTemplate(c, t); }); return; } applyTemplate(c, t); };
      g.appendChild(b);
    });
    sec.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(sec);
    var sec2 = c.ui.section('New design');
    var g2 = grid('sx-grid-2');
    c.SIZES.slice(0, 10).forEach(function (s) {
      var b = c.h('<button type="button" class="sx-size-mini">' + sizeArt(s.w, s.h, 32, 32) + '<span><b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + '</small></span></button>');
      b.onclick = function () { c.newDesign(s.w, s.h, s.name); };
      g2.appendChild(b);
    });
    sec2.querySelector('.sx-sec-body').appendChild(g2);
    body.appendChild(sec2);
  }
  var customSize = null;   /* Design → Resize custom form: { key: project id, w, h, lock } */
  function renderSizes(c, body) {
    if (needProject(c, body)) return;
    var d = c.doc();
    var st = c.studio();
    var opts = c.size.opts();
    var base = c.baseLayer();
    var orig = st.originalSize;
    var head = c.h('<div class="sx-cur-size"><div><span class="sx-eyebrow">Current page</span><strong>' + d.width + ' × ' + d.height + ' px</strong>' + (orig ? '<small>Original ' + orig.w + ' × ' + orig.h + '</small>' : '') + '</div></div>');
    head.appendChild(btn(c, 'Reset to original', 'reset', 'btn btn-ghost btn-sm', function () { c.size.reset(); }));
    body.appendChild(head);
    var how = c.ui.section('How content adapts');
    var hb = how.querySelector('.sx-sec-body');
    if (base) {
      hb.appendChild(c.ui.seg([['cover', 'Fill', 'fit'], ['contain', 'Fit', 'frame'], ['stretch', 'Stretch', 'resize']], opts.fit, function (v) {
        st.fit = v;
        if (c.S.preview && c.S.preview.target) c.size.preview(c.S.preview.target.W, c.S.preview.target.H, c.S.preview.target.label, { fit: v });
        focal.hidden = v !== 'cover';
      }));
      var focal = focalPad(c, st);
      focal.hidden = opts.fit !== 'cover';
      hb.appendChild(focal);
    }
    hb.appendChild(c.ui.toggle('Scale content', opts.scaleContent, function (v) {
      st.scaleContent = v;
      if (c.S.preview && c.S.preview.target) c.size.preview(c.S.preview.target.W, c.S.preview.target.H, c.S.preview.target.label, { scaleContent: v });
    }, 'Text, shapes and stickers grow or shrink with the page.'));
    hb.appendChild(c.ui.toggle('Resize from current result', c.size.chain(), function (v) { c.size.setChain(v); }, 'Off: every size is rendered fresh from your original photo.'));
    body.appendChild(how);

    var presets = c.ui.section('Sizes', '<button type="button" class="sx-link" data-compare>Compare sizes</button>');
    presets.querySelector('[data-compare]').onclick = function () { compareModal(c); };
    var pb = presets.querySelector('.sx-sec-body');
    var groups = {};
    c.SIZES.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    var hoverT = 0;
    var pinned = c.S.preview && c.S.preview.target ? c.S.preview.target.label : null;
    Object.keys(groups).forEach(function (gname) {
      pb.appendChild(c.h('<h4 class="sx-sub">' + c.esc(gname) + '</h4>'));
      var g = grid('sx-grid-2 sx-sizes');
      groups[gname].forEach(function (s) {
        var cur = s.w === d.width && s.h === d.height;
        var b = c.h('<button type="button" class="sx-size-mini' + (cur ? ' is-current' : '') + (pinned === s.name ? ' is-pinned' : '') + '">' + sizeArt(s.w, s.h, 32, 32) + '<span><b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + (cur ? ' · current' : '') + '</small></span></button>');
        b.addEventListener('mouseenter', function (e) {
          if (e.pointerType === 'touch' || !window.matchMedia('(hover: hover)').matches) return;
          if (pinned) return;
          clearTimeout(hoverT);
          hoverT = setTimeout(function () { c.size.preview(s.w, s.h, s.name); }, 220);
        });
        b.addEventListener('mouseleave', function () {
          clearTimeout(hoverT);
          if (!pinned && c.S.preview && c.S.preview.type === 'size') hoverT = setTimeout(function () { if (!pinned) c.size.cancel(); }, 160);
        });
        b.onclick = function () {
          clearTimeout(hoverT);
          pinned = s.name;
          g.parentNode.querySelectorAll('.is-pinned').forEach(function (x) { x.classList.remove('is-pinned'); });
          b.classList.add('is-pinned');
          c.size.preview(s.w, s.h, s.name);
        };
        g.appendChild(b);
      });
      pb.appendChild(g);
    });
    body.appendChild(presets);

    var custom = c.ui.section('Custom size');
    /* The typed size and the lock survive a re-render of this panel (a hover preview, an autosave): before, every
       re-render rebuilt the form with the lock on and the current size, so "Preview size" read 1080 × 1080. */
    var base = c.S.preview && c.S.preview.pre ? c.S.preview.pre : d;   /* the size before any preview */
    var key = (c.S.project ? c.S.project.id : '') + '|' + base.width + 'x' + base.height;
    var cs = customSize && customSize.key === key ? customSize : (customSize = { key: key, w: d.width, h: d.height, lock: true });
    var form = c.h('<form class="sx-form"><div class="sx-wh"><label>Width<input class="sx-input" type="number" min="16" max="16000" value="' + cs.w + '"></label><button type="button" class="sx-iconbtn sx-ratio-lock" aria-pressed="' + cs.lock + '" aria-label="Lock aspect ratio">' + c.ic('lock') + '</button><label>Height<input class="sx-input" type="number" min="16" max="16000" value="' + cs.h + '"></label></div><div class="sx-row-end"><button type="submit" class="btn btn-gold btn-sm">Preview size</button></div></form>');
    var ins = form.querySelectorAll('input');
    var lock = form.querySelector('.sx-ratio-lock');
    var ratio = (Number(cs.w) / Number(cs.h)) || d.width / d.height;
    function keep() { cs.w = ins[0].value; cs.h = ins[1].value; cs.lock = lock.getAttribute('aria-pressed') === 'true'; }
    lock.onclick = function () { lock.setAttribute('aria-pressed', lock.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); ratio = Number(ins[0].value) / Number(ins[1].value) || 1; keep(); };
    ins[0].addEventListener('input', function () { if (lock.getAttribute('aria-pressed') === 'true') ins[1].value = Math.round(Number(ins[0].value) / ratio) || ''; keep(); });
    ins[1].addEventListener('input', function () { if (lock.getAttribute('aria-pressed') === 'true') ins[0].value = Math.round(Number(ins[1].value) * ratio) || ''; keep(); });
    form.onsubmit = function (e) {
      e.preventDefault();
      var w = c.clamp(Math.round(Number(ins[0].value) || 0), 16, 16000), h = c.clamp(Math.round(Number(ins[1].value) || 0), 16, 16000);
      pinned = 'Custom';
      c.size.preview(w, h, 'Custom ' + w + ' × ' + h);
    };
    custom.querySelector('.sx-sec-body').appendChild(form);
    body.appendChild(custom);
    body.appendChild(note(c, (c.say ? c.say('Hover a size to preview it, click to pin it, then choose “Use this size”. Your original photo is never changed.', 'Tap a size to preview it, then choose “Use this size”. Your original photo is never changed.') : 'Hover a size to preview it, click to pin it, then choose “Use this size”. Your original photo is never changed.')));
  }
  function focalPad(c, st) {
    var base = c.baseLayer();
    var wrap = c.h('<div class="sx-focal"><div class="sx-focal-pad" role="slider" tabindex="0" aria-label="Focal point — drag to choose what stays in frame"><canvas></canvas><i class="sx-focal-dot"></i></div><small>Drag the dot to choose what stays in frame when filling a new size.</small></div>');
    var m = base && c.mem[base.src];
    var cv = wrap.querySelector('canvas');
    if (m) {
      var reg = st.baseRegion || { x: 0, y: 0, w: 1, h: 1 };
      var sw = m.canvas.width * reg.w, sh = m.canvas.height * reg.h;
      var s = Math.min(240 / sw, 140 / sh);
      cv.width = Math.max(1, Math.round(sw * s));
      cv.height = Math.max(1, Math.round(sh * s));
      cv.getContext('2d').drawImage(m.canvas, m.canvas.width * reg.x, m.canvas.height * reg.y, sw, sh, 0, 0, cv.width, cv.height);
    }
    var pad = wrap.querySelector('.sx-focal-pad');
    var dot = wrap.querySelector('.sx-focal-dot');
    var f = st.focal || { x: 0.5, y: 0.5 };
    function paint() { dot.style.left = (f.x * 100) + '%'; dot.style.top = (f.y * 100) + '%'; }
    function apply() {
      st.focal = { x: Math.round(f.x * 1000) / 1000, y: Math.round(f.y * 1000) / 1000 };
      var p = c.S.preview;
      if (p && p.target) c.size.preview(p.target.W, p.target.H, p.target.label, { focal: st.focal });
    }
    var raf = 0;
    function at(e) {
      var r = cv.getBoundingClientRect();
      f = { x: c.clamp((e.clientX - r.left) / r.width, 0, 1), y: c.clamp((e.clientY - r.top) / r.height, 0, 1) };
      paint();
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; apply(); });
    }
    var down = false;
    pad.addEventListener('pointerdown', function (e) { down = true; pad.setPointerCapture(e.pointerId); at(e); });
    pad.addEventListener('pointermove', function (e) { if (down) at(e); });
    pad.addEventListener('pointerup', function () { down = false; });
    pad.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowLeft') f.x = c.clamp(f.x - step, 0, 1);
      else if (e.key === 'ArrowRight') f.x = c.clamp(f.x + step, 0, 1);
      else if (e.key === 'ArrowUp') f.y = c.clamp(f.y - step, 0, 1);
      else if (e.key === 'ArrowDown') f.y = c.clamp(f.y + step, 0, 1);
      else return;
      e.preventDefault();
      paint();
      apply();
    });
    paint();
    return wrap;
  }
  function compareModal(c) {
    var picks = ['ig-post', 'ig-story', 'yt-thumb', 'pin'];
    var body = c.h('<div class="sx-compare"><div class="sx-chips"></div><div class="sx-compare-grid"></div><p class="sx-note">Every option is rendered from the same document and your original photo.</p></div>');
    var chips = body.querySelector('.sx-chips');
    var out = body.querySelector('.sx-compare-grid');
    c.SIZES.forEach(function (s) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (picks.indexOf(s.id) >= 0) + '">' + c.esc(s.name) + '</button>');
      b.onclick = function () {
        var on = picks.indexOf(s.id) >= 0;
        if (on) picks = picks.filter(function (x) { return x !== s.id; });
        else { if (picks.length >= 4) picks.shift(); picks.push(s.id); }
        chips.querySelectorAll('.sx-chip').forEach(function (x, i) { x.setAttribute('aria-pressed', picks.indexOf(c.SIZES[i].id) >= 0); });
        run();
      };
      chips.appendChild(b);
    });
    var token = 0;
    function run() {
      var my = ++token;
      out.innerHTML = '<div class="sx-loading">Rendering…</div>';
      var list = picks.map(function (id) { return c.SIZES.filter(function (s) { return s.id === id; })[0]; });
      c.size.compare(list).then(function (res) {
        if (my !== token) return;
        out.innerHTML = '';
        res.forEach(function (r) {
          var card = c.h('<figure class="sx-compare-card"><div class="sx-compare-art"></div><figcaption><b>' + c.esc(r.size.name) + '</b><small>' + r.size.w + ' × ' + r.size.h + '</small></figcaption></figure>');
          r.canvas.className = 'sx-compare-img';
          card.querySelector('.sx-compare-art').appendChild(r.canvas);
          var use = btn(c, 'Use this', 'check', 'btn btn-gold btn-sm', function () { c.closeModal(); c.size.apply(r.size.w, r.size.h, r.size.name); });
          card.querySelector('figcaption').appendChild(use);
          out.appendChild(card);
        });
      }).catch(function (err) { out.innerHTML = ''; out.appendChild(note(c, err.message || 'Could not render previews.')); });
    }
    c.openModal('Compare <em>sizes</em>', body, { wide: true });
    run();
  }
  function renderSizeHistory(c, body) {
    if (needProject(c, body)) return;
    var list = (c.S.project.sizeHistory || []).slice().reverse();
    var top = c.h('<div class="sx-row-between"></div>');
    top.appendChild(btn(c, 'Reset to original size', 'reset', 'btn btn-ghost btn-sm', function () { c.size.reset(); }));
    body.appendChild(top);
    if (!list.length) { body.appendChild(note(c, 'No resizes yet. Each size you apply is recorded here so you can step back to any of them.')); return; }
    var ul = c.h('<ol class="sx-hist"></ol>');
    list.forEach(function (e) {
      var li = c.h('<li class="sx-hist-item' + (e.reverted ? ' is-reverted' : '') + '"><span class="sx-hist-ic">' + c.ic(e.type === 'revert' ? 'reset' : 'resize') + '</span><span class="sx-hist-txt"><b>' + c.esc(e.label || 'Resize') + '</b><small>' + e.from.w + '×' + e.from.h + ' → ' + e.to.w + '×' + e.to.h + ' · ' + ({ cover: 'Fill', contain: 'Fit', stretch: 'Stretch' }[e.fit] || 'Fill') + ' · from ' + (e.source === 'current' ? 'current result' : 'original') + ' · ' + when(e.at) + '</small></span></li>');
      if (e.before) li.appendChild(btn(c, e.reverted ? 'Reverted' : 'Revert', null, 'btn btn-ghost btn-sm', function () { c.size.revert(e.id); }));
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }
  P._templates = renderTemplates;
  P._sizes = renderSizes;
  P._sizeHistory = renderSizeHistory;

  /* ---------- Layers / Position ---------- */
  var TYPE_IC = { image: 'image', text: 'text', shape: 'shapes', svg: 'emoji', path: 'pen', group: 'group' };
  P.layers = {
    title: 'Position', eyebrow: 'Arrange & layers', select: true, doc: true,
    render: function (c, body, o) {
      var tab = o.tab || 'layers';
      tabs(c, body, [['arrange', 'Arrange'], ['layers', 'Layers']], tab, function (t) { c.S.panelOpts.tab = t; c.renderPanel(true); });
      if (needProject(c, body)) return;
      if (tab === 'arrange') return arrange(c, body);
      layerList(c, body);
    }
  };
  function arrange(c, body) {
    var ids = c.sel();
    if (!ids.length) { body.appendChild(note(c, 'Select something on the canvas to align, order or position it.')); return; }
    var s = c.ui.section('Layer order');
    var g = grid('sx-grid-2');
    [['front', 'Bring to front', 'front'], ['forward', 'Forward', 'front'], ['backward', 'Backward', 'back2'], ['back', 'Send to back', 'back2']].forEach(function (x) {
      g.appendChild(btn(c, x[1], x[2], 'sx-arr', function () { ids.forEach(function (id) { c.scene.order(id, x[0]); }); }));
    });
    s.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(s);
    var s2 = c.ui.section(ids.length > 1 ? 'Align to selection' : 'Align to page');
    var g2 = grid('sx-grid-3');
    [['left', 'Left', 'alL'], ['center', 'Center', 'alC'], ['right', 'Right', 'alR'], ['top', 'Top', 'alT'], ['middle', 'Middle', 'alM'], ['bottom', 'Bottom', 'alB']].forEach(function (x) {
      g2.appendChild(btn(c, x[1], x[2], 'sx-arr', function () { c.scene.align(ids, x[0], ids.length > 1 ? 'selection' : 'page'); }));
    });
    s2.querySelector('.sx-sec-body').appendChild(g2);
    if (ids.length > 2) {
      var g3 = grid('sx-grid-2');
      g3.appendChild(btn(c, 'Space horizontally', 'distH', 'sx-arr', function () { c.scene.distribute(ids, 'h'); }));
      g3.appendChild(btn(c, 'Space vertically', 'distV', 'sx-arr', function () { c.scene.distribute(ids, 'v'); }));
      s2.querySelector('.sx-sec-body').appendChild(g3);
    }
    body.appendChild(s2);
    if (ids.length === 1) {
      var l = c.L(ids[0]);
      var forced = l.type === 'image' || l.type === 'svg' || l.type === 'group';
      var lockAsp = forced || c.lsGet('le-studio-lockaspect', false);
      var s3 = c.ui.section('Size & position', '<button type="button" class="sx-iconbtn sx-lockasp" aria-pressed="' + lockAsp + '" aria-label="Lock aspect ratio" title="' + (forced ? 'Photos and graphics always keep their proportions' : 'Lock aspect ratio') + '"' + (forced ? ' disabled' : '') + '>' + c.ic(lockAsp ? 'lock' : 'unlock') + '</button>');
      var lk = s3.querySelector('.sx-lockasp');
      lk.onclick = function () { lockAsp = !lockAsp; c.lsSet('le-studio-lockaspect', lockAsp); lk.setAttribute('aria-pressed', lockAsp); lk.innerHTML = c.ic(lockAsp ? 'lock' : 'unlock'); };
      var f = c.h('<div class="sx-xywh"></div>');
      [['w', 'W'], ['h', 'H'], ['x', 'X'], ['y', 'Y'], ['rotation', '°']].forEach(function (x) {
        var lab = c.h('<label><span>' + x[1] + '</span><input class="sx-input" type="number" step="1" inputmode="decimal" data-k="' + x[0] + '" aria-label="' + ({ w: 'Width', h: 'Height', x: 'X position', y: 'Y position', rotation: 'Rotation in degrees' })[x[0]] + '" value="' + Math.round(l[x[0]] || 0) + '"></label>');
        lab.querySelector('input').addEventListener('change', function (e) {
          var v = Number(e.target.value);
          if (!isFinite(v)) return;
          var p = {};
          if (x[0] === 'w' || x[0] === 'h') {
            var cur = c.L(ids[0]);
            var r = cur.w / cur.h;
            v = Math.max(1, v);
            if (lockAsp) { p.w = x[0] === 'w' ? v : v * r; p.h = x[0] === 'h' ? v : v / r; }
            else p[x[0]] = v;
          } else p[x[0]] = x[0] === 'rotation' ? ((v % 360) + 360) % 360 : v;
          c.patch(ids, p);
          var now = c.L(ids[0]);
          f.querySelectorAll('input').forEach(function (inp) { if (inp !== e.target) inp.value = Math.round(now[inp.getAttribute('data-k')] || 0); });
        });
        f.appendChild(lab);
      });
      s3.querySelector('.sx-sec-body').appendChild(f);
      var fl = c.h('<div class="sx-row"></div>');
      fl.appendChild(btn(c, 'Flip horizontal', 'flip', 'btn btn-ghost btn-sm', function () { var cur = c.L(ids[0]); c.patch(ids, { flipX: !cur.flipX }); }));
      fl.appendChild(btn(c, 'Flip vertical', 'flipV', 'btn btn-ghost btn-sm', function () { var cur = c.L(ids[0]); c.patch(ids, { flipY: !cur.flipY }); }));
      s3.querySelector('.sx-sec-body').appendChild(fl);
      body.appendChild(s3);
    }
  }
  function layerList(c, body) {
    var d = c.doc();
    var selIds = c.sel();
    var ul = c.h('<ol class="sx-layers" aria-label="Layers, top first"></ol>');
    var byGroup = {};
    d.layers.forEach(function (l) { if (l.groupId) (byGroup[l.groupId] = byGroup[l.groupId] || []).push(l); });
    var top = d.layers.filter(function (l) { return !l.groupId; }).reverse();
    function item(l, depth) {
      var li = c.h('<li class="sx-layer' + (selIds.indexOf(l.id) >= 0 ? ' is-on' : '') + (l.visible === false ? ' is-hidden' : '') + '" data-id="' + c.esc(l.id) + '" style="--depth:' + depth + '"><span class="sx-layer-grip" aria-hidden="true">⋮⋮</span><span class="sx-layer-thumb">' + c.ic(TYPE_IC[l.type] || 'layers') + '</span><button type="button" class="sx-layer-name">' + c.esc(shownName(l)) + '</button><button type="button" class="sx-iconbtn sx-layer-eye" aria-label="' + (l.visible === false ? 'Show' : 'Hide') + ' layer" aria-pressed="' + (l.visible !== false) + '">' + c.ic(l.visible === false ? 'eyeOff' : 'eye') + '</button><button type="button" class="sx-iconbtn sx-layer-lock" aria-label="' + (l.locked ? 'Unlock' : 'Lock') + ' layer" aria-pressed="' + !!l.locked + '">' + c.ic(l.locked ? 'lock' : 'unlock') + '</button></li>');
      if (l.type === 'image') c.thumbUrl(l.src).then(function (u) { if (u) li.querySelector('.sx-layer-thumb').innerHTML = '<img alt="" src="' + u + '">'; });
      if (l.type === 'text') li.querySelector('.sx-layer-thumb').innerHTML = '<b style="font-family:' + c.esc(c.fontCss(l.font)) + '">Aa</b>';
      if (l.type === 'shape' || l.type === 'path') li.querySelector('.sx-layer-thumb').style.color = l.type === 'path' ? l.color : (l.fill && (l.fill.color || (l.fill.colors && l.fill.colors[0]))) || '';
      var nameBtn = li.querySelector('.sx-layer-name');
      nameBtn.onclick = function (e) {
        var cur = c.sel();
        if (e.shiftKey || e.ctrlKey || e.metaKey) c.scene.select(cur.indexOf(l.id) >= 0 ? cur.filter(function (x) { return x !== l.id; }) : cur.concat([l.id]));
        else c.scene.select([l.id]);
      };
      nameBtn.ondblclick = function () {
        var input = c.h('<input class="sx-input sx-layer-rename" maxlength="60" value="' + c.esc(shownName(l)) + '" aria-label="Layer name">');
        nameBtn.replaceWith(input);
        input.focus();
        input.select();
        function done() { var v = input.value.trim(); if (v) c.patch(l.id, { name: v }); c.renderPanel(true); }
        input.addEventListener('blur', done);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = ''; input.blur(); } });
      };
      li.querySelector('.sx-layer-eye').onclick = function () { c.patch(l.id, { visible: l.visible === false }); };
      li.querySelector('.sx-layer-lock').onclick = function () { c.scene.lock(l.id, !l.locked); c.renderPanel(true); };
      ul.appendChild(li);
      if (l.type === 'group') (byGroup[l.id] || []).slice().reverse().forEach(function (k2) { item(k2, depth + 1); });
    }
    top.forEach(function (l) { item(l, 0); });
    if (!d.layers.length) body.appendChild(note(c, 'Nothing on this page yet.'));
    body.appendChild(ul);
    reorder(c, ul);
    var tools = c.h('<div class="sx-row-between"></div>');
    if (selIds.length > 1) tools.appendChild(btn(c, 'Group', 'group', 'btn btn-ghost btn-sm', function () { c.scene.group(selIds); }));
    var one = c.one();
    if (one && one.type === 'group') tools.appendChild(btn(c, 'Ungroup', 'ungroup', 'btn btn-ghost btn-sm', function () { c.scene.ungroup(one.id); }));
    if (tools.children.length) body.appendChild(tools);
    body.appendChild(note(c, (c.say ? c.say('Drag to reorder. Double-click a name to rename. Shift-click to select several.', 'Drag to reorder. Double-tap a name to rename. Tap and hold a layer on the canvas to select several.') : 'Drag to reorder. Double-click a name to rename. Shift-click to select several.')));
  }
  function labelOf(l) {
    if (l.type === 'text') return String(l.text || 'Text').split('\n')[0].slice(0, 28);
    return ({ image: 'Photo', shape: 'Shape', svg: 'Graphic', path: 'Drawing', group: 'Group' })[l.type] || 'Layer';
  }
  function shownName(l) {
    if (l.type === 'text' && (!l.name || /^Text \d+$/.test(l.name))) return labelOf(l);
    return l.name || labelOf(l);
  }
  function reorder(c, ul) {
    var drag = null;
    ul.addEventListener('pointerdown', function (e) {
      var grip = e.target.closest('.sx-layer-grip');
      if (!grip) return;
      var li = grip.closest('.sx-layer');
      if (li.style.getPropertyValue('--depth') !== '0') return;
      e.preventDefault();
      drag = { li: li, id: li.getAttribute('data-id'), y: e.clientY };
      c.S.panelDrag = true;
      li.classList.add('is-drag');
      ul.setPointerCapture(e.pointerId);
    });
    ul.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.li.style.transform = 'translateY(' + (e.clientY - drag.y) + 'px)';
      var items = [].slice.call(ul.querySelectorAll('.sx-layer')).filter(function (x) { return x !== drag.li && x.style.getPropertyValue('--depth') === '0'; });
      items.forEach(function (x) { x.classList.remove('is-over-top', 'is-over-bottom'); });
      var tgt = items.filter(function (x) { var r = x.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; })[0];
      if (tgt) { var r = tgt.getBoundingClientRect(); tgt.classList.add(e.clientY < r.top + r.height / 2 ? 'is-over-top' : 'is-over-bottom'); }
      drag.target = tgt || null;
      drag.after = tgt ? e.clientY >= tgt.getBoundingClientRect().top + tgt.getBoundingClientRect().height / 2 : false;
    });
    function end() {
      if (!drag) return;
      var d = drag;
      drag = null;
      c.S.panelDrag = false;
      if (d.target) {
        var layers = c.doc().layers;
        var tid = d.target.getAttribute('data-id');
        var ti = -1;
        layers.forEach(function (l, i) { if (l.id === tid) ti = i; });
        var fi = -1;
        layers.forEach(function (l, i) { if (l.id === d.id) fi = i; });
        if (ti >= 0 && fi >= 0) {
          var dest = d.after ? ti : ti + 1;
          if (fi < dest) dest -= 1;
          if (d.after && fi > ti) dest = ti;
          if (!d.after && fi < ti) dest = ti;
          if (d.after && fi < ti) dest = ti - 1;
          c.scene.order(d.id, c.clamp(dest, 0, layers.length - 1));
        }
      }
      c.renderPanel(true);
    }
    ul.addEventListener('pointerup', end);
    ul.addEventListener('pointercancel', end);
  }

  /* ---------- Projects ---------- */
  P.projects = {
    title: 'Your designs', eyebrow: 'Saved on this device',
    render: function (c, body) {
      var top = c.h('<div class="sx-row-between"></div>');
      top.appendChild(btn(c, 'New design', 'plus', 'btn btn-gold btn-sm', function () { c.cmd('newDesign'); }));
      top.appendChild(btn(c, 'Import .leproject', 'file', 'btn btn-ghost btn-sm', function () { c.pickFiles('project'); }));
      body.appendChild(top);
      if (c.S.project) {
        var cur = c.h('<div class="sx-row-between"></div>');
        cur.appendChild(btn(c, 'Save a version', 'save', 'btn btn-ghost btn-sm', function () { c.checkpoint(); }));
        cur.appendChild(btn(c, 'Export this design', 'share', 'btn btn-ghost btn-sm', function () { c.exportProject(); }));
        body.appendChild(cur);
      }
      var g = c.h('<div class="sx-proj-grid" aria-busy="true"><span class="skel skel-cards"></span><span class="skel skel-cards"></span></div>');
      body.appendChild(g);
      var drop = c.h('<div class="sx-dropzone">' + c.ic('file') + '<span>' + (c.coarse && c.coarse() ? 'Open a <b>.leproject</b> file to import it' : 'Drop a <b>.leproject</b> file here to import it') + '</span></div>');
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('is-over'); var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) c.importProject(f); });
      body.appendChild(drop);
      var store = c.ui.section('Storage');
      var sb = store.querySelector('.sx-sec-body');
      body.appendChild(store);
      LE.project.list().then(function (list) {
        g.innerHTML = '';
        g.removeAttribute('aria-busy');
        if (!list.length) g.appendChild(c.ui.empty('No designs yet', 'Everything you make is saved here as you work, on this device only.', [{ label: 'Start from a template', fn: function () { c.openPanel('design', { tab: 'templates' }); } }]));
        list.forEach(function (p) { g.appendChild(projectCard(c, p)); });
      });
      storage(c, sb);
      var lg = c.ui.section('Activity');
      body.appendChild(lg);
      ledger(c, lg.querySelector('.sx-sec-body'), null);
    }
  };
  function storage(c, sb) {
    sb.innerHTML = '<div class="sx-loading">Measuring…</div>';
    LE.project.usage().then(function (u) {
      sb.innerHTML = '';
      var used = u.projects + u.assets + u.versions;
      var pct = u.quota ? Math.min(100, used / u.quota * 100) : 0;
      sb.appendChild(c.h('<div class="sx-usage"><div class="sx-usage-bar"><i style="width:' + Math.max(2, pct).toFixed(1) + '%"></i></div><div class="sx-usage-rows"><span>Designs <b>' + c.fmtBytes(u.projects) + '</b></span><span>Photos <b>' + c.fmtBytes(u.assets) + '</b> (' + u.counts.assets + ')</span><span>Versions <b>' + c.fmtBytes(u.versions) + '</b></span>' + (u.quota ? '<span>Browser space <b>' + c.fmtBytes(u.usage || 0) + ' / ' + c.fmtBytes(u.quota) + '</b></span>' : '') + '</div></div>'));
      sb.appendChild(btn(c, 'Clean up unused photos', 'trash', 'btn btn-ghost btn-sm', function () {
        LE.project.gc({ grace: 0 }).then(function (r) { if (c.S.project) c.saveNow(); c.toast(r.removed ? 'Freed ' + c.fmtBytes(r.freed) + ' (' + r.removed + ' photo' + (r.removed > 1 ? 's' : '') + ')' : 'Nothing to clean up'); storage(c, sb); });
      }));
      if (window.LEPwa) sb.appendChild(btn(c, 'Manage all storage on this device', 'download', 'btn btn-ghost btn-sm', function () { LEPwa.openStorage(); }));
    }).catch(function () { sb.innerHTML = ''; sb.appendChild(note(c, 'Storage details are not available in this browser.')); });
  }
  var LEDGER_TXT = { created: 'Created', opened: 'Opened', autosaved: 'Autosaved', checkpoint: 'Saved a version', exported: 'Exported', imported: 'Imported', deleted: 'Deleted', restored: 'Restored a version', duplicated: 'Duplicated', renamed: 'Renamed', gc: 'Cleaned up storage', resized: 'Resized', 'size-reverted': 'Reverted a resize' };
  function ledger(c, host, id) {
    LE.project.ledger(id).then(function (rows) {
      if (!rows.length) { host.appendChild(note(c, 'No activity yet.')); return; }
      var ul = c.h('<ol class="sx-ledger"></ol>');
      rows.slice(0, 40).forEach(function (r) {
        var d = r.detail || {};
        var extra = d.name ? ' “' + d.name + '”' : '';
        if (r.type === 'exported' && d.format) extra += ' as ' + String(d.format).toUpperCase();
        if (d.label) extra += ' — ' + d.label;
        if (d.to && d.to.w) extra += ' (' + d.to.w + ' × ' + d.to.h + ')';
        ul.appendChild(c.h('<li><span class="sx-ledger-dot sx-ledger-' + c.esc(r.type) + '"></span><span>' + c.esc((LEDGER_TXT[r.type] || r.type) + extra) + '</span><time>' + when(r.at) + '</time></li>'));
      });
      host.appendChild(ul);
    }).catch(function () {});
  }

  /* ---------- History (versions) ---------- */
  P.history = {
    title: 'Version history', eyebrow: 'Autosaves & checkpoints',
    render: function (c, body) {
      if (needProject(c, body)) return;
      var id = c.S.project.id;
      var form = c.h('<form class="sx-form sx-inline"><input class="sx-input" maxlength="60" placeholder="Name this version (optional)" aria-label="Version name"><button type="submit" class="btn btn-gold btn-sm">' + c.ic('save') + 'Save version</button></form>');
      form.onsubmit = function (e) { e.preventDefault(); c.checkpoint(form.querySelector('input').value.trim()); };
      body.appendChild(form);
      var host = c.h('<div class="sx-versions"><div class="sx-loading">Loading…</div></div>');
      body.appendChild(host);
      LE.project.versions(id).then(function (vs) {
        host.innerHTML = '';
        if (!vs.length) { host.appendChild(note(c, 'Versions are saved automatically as you work. Save a named version before big changes.')); return; }
        vs.forEach(function (v) {
          var card = c.h('<button type="button" class="sx-version' + (v.kind === 'checkpoint' ? ' is-check' : '') + '"><span class="sx-version-art"></span><span class="sx-version-txt"><b>' + c.esc(v.label || (v.kind === 'checkpoint' ? 'Version' : 'Autosave')) + '</b><small>' + when(v.at) + (v.doc ? ' · ' + v.doc.pages[0].width + '×' + v.doc.pages[0].height : '') + '</small></span><span class="sx-version-go">Preview</span></button>');
          if (v.thumb) { var im = new Image(); im.alt = ''; im.onload = im.onerror = function () { URL.revokeObjectURL(im.src); }; im.src = URL.createObjectURL(v.thumb); card.querySelector('.sx-version-art').appendChild(im); }
          card.onclick = function () { if (c.isPhone()) c.closePanel(); c.previewVersion(v); };
          host.appendChild(card);
        });
      });
      var sz = c.ui.section('Size history');
      body.appendChild(sz);
      renderSizeHistory(c, sz.querySelector('.sx-sec-body'));
      var lg = c.ui.section('Activity for this design');
      body.appendChild(lg);
      ledger(c, lg.querySelector('.sx-sec-body'), id);
    }
  };

  /* ---------- Settings ---------- */
  P.settings = {
    title: 'Performance', eyebrow: 'Speed, quality & storage',
    render: function (c, body) {
      var mode = LE.perf ? LE.perf.mode() : 'auto';
      var s = c.ui.section('Mode');
      s.querySelector('.sx-sec-body').appendChild(c.ui.seg([['auto', 'Auto'], ['quality', 'Best quality'], ['saver', 'Battery saver']], mode, function (v) { LE.perf.set(v); c.toast(v === 'saver' ? 'Battery saver — lighter previews, same exports' : v === 'quality' ? 'Best quality previews' : 'Automatic for this device'); c.renderPanel(true); }));
      s.querySelector('.sx-sec-body').appendChild(note(c, 'This device: ' + LE.device.tier() + ' tier. Battery saver uses smaller previews and skips blur and shadows while you edit. Downloads are always full quality.'));
      body.appendChild(s);
      var s2 = c.ui.section('Storage');
      body.appendChild(s2);
      storage(c, s2.querySelector('.sx-sec-body'));
      var s3 = c.ui.section('Offline');
      var b3 = s3.querySelector('.sx-sec-body');
      /* One place for every offline download (docs/DOWNLOADS.md); the old button stays as the fallback. */
      if (window.LE && LE.downloads && LE.downloads.studioRow) LE.downloads.studioRow(c, b3); else {
      b3.appendChild(note(c, 'Fonts and graphics are fetched from this site the first time you use them, then cached. Save them all now to work fully offline.'));
      var go = btn(c, 'Save fonts & graphics for offline', 'download', 'btn btn-ghost btn-sm', function () {
        go.disabled = true;
        var p1 = LE.fonts && LE.fonts.saveAllOffline ? LE.fonts.saveAllOffline(function (p) { go.querySelector('span').textContent = 'Fonts ' + p.loaded + '/' + p.total; }) : Promise.resolve();
        p1.then(function () { return LE.assets && LE.assets.saveAllOffline ? LE.assets.saveAllOffline() : null; }).then(function () { go.querySelector('span').textContent = 'Saved for offline'; c.toast('Fonts and graphics are saved for offline use'); }).catch(function () { go.disabled = false; go.querySelector('span').textContent = 'Try again'; c.toast('Could not save everything — check your connection.'); });
      });
      b3.appendChild(go);
      }
      body.appendChild(s3);
      if (window.LE && LE.surround) LE.surround.section(c, body);
      if (window.LE && LE.support && LE.support.studioSettings) LE.support.studioSettings(c, body);
    }
  };

  /* ---------- Apps ---------- */
  var APP_RENDER = {
    watermark: function (c, body) {
      if (needProject(c, body)) return;
      var st = { text: '© ' + new Date().getFullYear() + ' Your name', pos: 'br', opacity: 55, size: 32, color: '#FFFFFF', logo: '' };
      var form = c.h('<div class="sx-form"><label class="sx-field"><span>Text</span><input class="sx-input" maxlength="80" value="' + c.esc(st.text) + '"></label></div>');
      body.appendChild(form);
      var pos = c.ui.seg([['tl', '↖'], ['tr', '↗'], ['c', '●'], ['bl', '↙'], ['br', '↘'], ['tile', 'Tiled']], st.pos, function (v) { st.pos = v; }, 'sx-seg-sm');
      body.appendChild(pos);
      body.appendChild(c.ui.slider({ label: 'Size', min: 12, max: 120, value: st.size, onInput: function (v) { st.size = v; } }));
      body.appendChild(c.ui.slider({ label: 'Opacity', min: 5, max: 100, value: st.opacity, fmt: function (v) { return v + '%'; }, onInput: function (v) { st.opacity = v; } }));
      var sw = c.ui.swatchBtn(st.color, 'Color', function (b) { c.colorPop(b, { value: st.color, onChange: function (v) { st.color = v; c.paintSwatch(sw.querySelector('i'), v); } }); });
      body.appendChild(sw);
      var ids = Object.keys(c.S.project.assets || {}).filter(function (id) { return !/^background-/.test((c.S.project.assets[id] || {}).name || ''); });
      if (ids.length) {
        var ls = c.ui.section('Logo (optional)');
        var g = grid('sx-grid-4 sx-thumbs');
        ids.forEach(function (id) {
          var t = c.h('<button type="button" class="sx-thumb" aria-pressed="false" aria-label="Use as logo"><img alt=""></button>');
          c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
          t.onclick = function () { st.logo = st.logo === id ? '' : id; g.querySelectorAll('.sx-thumb').forEach(function (x) { x.setAttribute('aria-pressed', x === t && !!st.logo); }); };
          g.appendChild(t);
        });
        ls.querySelector('.sx-sec-body').appendChild(g);
        body.appendChild(ls);
      }
      body.appendChild(btn(c, 'Add watermark', 'stamp', 'btn btn-gold sx-block', function () {
        st.text = form.querySelector('input').value.trim();
        var d = c.doc();
        var W = d.width, H = d.height, kk = Math.min(W, H) / 1080;
        var size = st.size * kk;
        var mk = function (x, y, rot) {
          if (st.logo && c.mem[st.logo]) {
            var m = c.mem[st.logo];
            var lw = size * 4, lh = lw * m.canvas.height / m.canvas.width;
            return { type: 'image', src: st.logo, name: 'Watermark logo', x: x - lw / 2, y: y - lh / 2, w: lw, h: lh, opacity: st.opacity / 100, rotation: rot || 0 };
          }
          var w = Math.max(size * 2, st.text.length * size * 0.62);
          return { type: 'text', text: st.text, font: 'Plus Jakarta Sans', weight: 600, size: size, align: 'center', color: st.color, name: 'Watermark', x: x - w / 2, y: y - size * 0.7, w: w, h: size * 1.4, opacity: st.opacity / 100, rotation: rot || 0, shadow: { color: 'rgba(0,0,0,.35)', blur: 6 * kk, x: 0, y: 2 * kk } };
        };
        var m0 = 40 * kk;
        var list = [];
        if (st.pos === 'tile') {
          var stepX = Math.max(size * 10, W / 3), stepY = size * 6;
          for (var y = stepY / 2, row = 0; y < H + stepY; y += stepY, row++) for (var x = (row % 2 ? stepX / 2 : 0); x < W + stepX; x += stepX) list.push(mk(x, y, 330));
          list = list.slice(0, 80);
        } else {
          var w0 = Math.max(size * 2, st.text.length * size * 0.62) / 2;
          var px = st.pos === 'c' ? W / 2 : /l$/.test(st.pos) ? m0 + w0 : W - m0 - w0;
          var py = st.pos === 'c' ? H / 2 : /^t/.test(st.pos) ? m0 + size : H - m0 - size;
          list.push(mk(px, py, 0));
        }
        c.batch(function () {
          var made = list.map(function (l) { return c.scene.add(l); });
          var gid = made.length > 1 ? c.scene.group(made) : made[0];
          if (made.length > 1) c.patch(gid, { name: 'Watermark' });
          c.scene.select([gid]);
        });
        c.toast('Watermark added as a layer — edit or move it anytime');
      }));
    },
    meme: function (c, body) {
      if (needProject(c, body)) return;
      var form = c.h('<div class="sx-form"><label class="sx-field"><span>Top text</span><input class="sx-input" maxlength="120" value="WHEN THE EDITOR"></label><label class="sx-field"><span>Bottom text</span><input class="sx-input" maxlength="120" value="RUNS OFFLINE"></label></div>');
      body.appendChild(form);
      body.appendChild(btn(c, 'Add meme captions', 'meme', 'btn btn-gold sx-block', function () {
        var ins = form.querySelectorAll('input');
        var d = c.doc();
        var W = d.width, H = d.height, kk = Math.min(W, H) / 1080;
        var size = 96 * kk;
        var mk = function (t, y) { return { type: 'text', text: t.toUpperCase(), font: 'Anton', weight: 400, size: size, align: 'center', color: '#FFFFFF', stroke: { width: 6 * kk, color: '#000000' }, name: 'Meme caption', x: W * 0.04, y: y, w: W * 0.92, h: size * 1.25, lineHeight: 1.05 }; };
        var list = [];
        if (ins[0].value.trim()) list.push(mk(ins[0].value.trim(), H * 0.03));
        if (ins[1].value.trim()) list.push(mk(ins[1].value.trim(), H * 0.97 - size * 1.25));
        c.batch(function () { var made = list.map(function (l) { return c.scene.add(l); }); c.scene.select(made); });
      }));
      body.appendChild(note(c, (c.say ? c.say('Captions are normal text layers — double-click to edit.', 'Captions are normal text layers — double-tap to edit.') : 'Captions are normal text layers — double-click to edit.')));
    },
    palette: function (c, body) {
      if (needProject(c, body)) return;
      var art = c.artboard(480);
      if (!art) { body.appendChild(note(c, 'Nothing to sample yet.')); return; }
      var cols = LE.palette.extract(art, 6);
      var g = c.h('<div class="sx-palette"></div>');
      cols.forEach(function (col) {
        var b = c.h('<button type="button" class="sx-pal" aria-label="Copy ' + col.hex + '"><i style="background:' + col.hex + '"></i><b>' + col.hex.toUpperCase() + '</b><small>hsl ' + col.hsl.join(' ') + '</small></button>');
        b.onclick = function () { copy(c, col.hex.toUpperCase()); };
        g.appendChild(b);
      });
      body.appendChild(g);
      var row = c.h('<div class="sx-row-between"></div>');
      row.appendChild(btn(c, 'Copy CSS', 'clip', 'btn btn-ghost btn-sm', function () { copy(c, ':root {\n' + cols.map(function (x, i) { return '  --brand-' + (i + 1) + ': ' + x.hex + ';'; }).join('\n') + '\n}'); }));
      row.appendChild(btn(c, 'Copy JSON', 'clip', 'btn btn-ghost btn-sm', function () { copy(c, JSON.stringify(cols.map(function (x) { return x.hex; }))); }));
      row.appendChild(btn(c, 'Swatch PNG', 'download', 'btn btn-ghost btn-sm', function () { LE.toBlob(LE.palette.swatch(cols), 'image/png').then(function (b) { c.download(b, 'palette.png'); }); }));
      body.appendChild(row);
      body.appendChild(btn(c, 'Add to document colors', 'palette', 'btn btn-gold btn-sm sx-block', function () { var st = c.studio(); st.docColors = cols.map(function (x) { return x.hex; }); c.markDirty(); c.toast('Added to document colors'); }));
    },
    metadata: function (c, body) {
      var img = c.targetImage();
      if (!img) return noImage(c, body, 'read its metadata');
      var host = c.h('<div class="sx-meta"><div class="sx-loading">Reading…</div></div>');
      body.appendChild(host);
      LE.project.getAsset(img.src).then(function (blob) { return LE.exif(blob); }).then(function (x) {
        host.innerHTML = '';
        var rows = [['Camera', [x.make, x.model].filter(Boolean).join(' ')], ['Taken', x.date], ['ISO', x.iso], ['Aperture', x.aperture ? 'f/' + x.aperture : ''], ['Focal length', x.focalLength ? x.focalLength + ' mm' : ''], ['Location', x.latitude != null ? x.latitude.toFixed(5) + ', ' + x.longitude.toFixed(5) : ''], ['Orientation', x.orientation], ['File', (x.type || '') + (x.bytes ? ' · ' + c.fmtBytes(x.bytes) : '')], ['Pixels', c.mem[img.src] ? c.mem[img.src].canvas.width + ' × ' + c.mem[img.src].canvas.height : '']];
        var dl = c.h('<dl class="sx-dl"></dl>');
        var any = false;
        rows.forEach(function (r) { if (r[1] === '' || r[1] == null) return; any = true; dl.appendChild(c.h('<div><dt>' + c.esc(r[0]) + '</dt><dd>' + c.esc(r[1]) + '</dd></div>')); });
        host.appendChild(any ? dl : note(c, 'This photo has no camera metadata.'));
        host.appendChild(note(c, x.latitude != null ? 'This photo contains GPS location. Every download from the studio strips it.' : 'Downloads from the studio never include EXIF or location data.', x.latitude != null ? 'is-warn' : ''));
      }).catch(function () { host.innerHTML = ''; host.appendChild(note(c, 'No metadata could be read from this photo.')); });
    },
    compare: function (c, body) {
      if (needProject(c, body)) return;
      body.appendChild(note(c, 'Press and hold “Hold to compare” (or the \\ key) to flick between your edits and the original photo.'));
      var hold = c.h('<button type="button" class="btn btn-ghost sx-block" data-cmd="compareHold">' + c.ic('compare') + '<span>Hold to compare</span></button>');
      body.appendChild(hold);
      body.appendChild(btn(c, 'Download before / after image', 'download', 'btn btn-gold sx-block', function () {
        var img = c.targetImage();
        if (!img || !c.mem[img.src]) { c.toast('Select a photo first.'); return; }
        var before = LE.fit(c.mem[img.src].canvas, 1600);
        c.scene.render(Math.min(1, 1600 / Math.max(c.doc().width, c.doc().height))).then(function (after) {
          return LE.exportImage(LE.sideBySide(before, after, { before: 'Original', after: 'Edited' }), { format: 'jpeg', quality: 0.9 });
        }).then(function (b) { c.download(b, 'before-after.jpg'); });
      }));
    },
    upscale: function (c, body) {
      var tier = LE.device.tier();
      body.appendChild(note(c, LE.capabilities.message('upscale-ai', tier)));
      body.appendChild(note(c, 'You can still export at up to ' + Math.floor(c.maxScale() * 10) / 10 + '× using high-quality resampling. Text, shapes and stickers are re-rendered sharply at the bigger size.'));
      body.appendChild(btn(c, 'Export at 2×', 'upscale', 'btn btn-gold sx-block', function () { c.S.exportOpts.scale = Math.min(2, Math.floor(c.maxScale() * 2) / 2); c.lsSet('le-studio-export', c.S.exportOpts); c.openPanel('export'); }));
    },
    contact: function (c, body) {
      if (needProject(c, body)) return;
      var ids = Object.keys(c.S.project.assets || {}).filter(function (id) { return !/^background-/.test((c.S.project.assets[id] || {}).name || ''); });
      var cols = 3;
      body.appendChild(c.ui.slider({ label: 'Columns', min: 1, max: 6, value: cols, onInput: function (v) { cols = v; } }));
      body.appendChild(btn(c, 'Download contact sheet', 'sheet', 'btn btn-gold sx-block', function () {
        if (!ids.length) { c.toast('Upload some photos first.'); return; }
        var imgs = ids.filter(function (id) { return c.mem[id]; }).map(function (id) { var cv = LE.fit(c.mem[id].canvas, 600); cv.name = c.mem[id].meta.name; return { canvas: cv, name: c.mem[id].meta.name }; });
        LE.exportImage(LE.contactSheet(imgs, { columns: cols, names: true }), { format: 'jpeg', quality: 0.9 }).then(function (b) { c.download(b, 'contact-sheet.jpg'); });
      }));
      body.appendChild(note(c, ids.length + ' photo' + (ids.length === 1 ? '' : 's') + ' in this design.'));
    }
  };
  P._appRender = P._appRender || {};
  Object.keys(APP_RENDER).forEach(function (k) { P._appRender[k] = APP_RENDER[k]; });
})();
