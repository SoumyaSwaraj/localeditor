/* LocalEditor: studio privacy tools. See docs/ROADMAP.md (2.7).
   Redact: a shape layer with `redact: { mode: 'solid' | 'pixelate' | 'blur', amount, color }` (rendered by
   LE.Scene, see "Redaction" in le-objects.js) that hides whatever is beneath it, in the preview and in every export.
   Entry points: Elements panel card, a "Redact" button on the photo toolbar, a toolbar for a selected redaction and
   the Redact panel. "Apply permanently" bakes the redactions into new copies of the photos underneath and drops the
   originals from the project. Also adds a privacy summary to Apps → Metadata (lazy-loads le-privacy.js).
   Public: window.LEStudioPrivacy. */
(function () {
  'use strict';
  var LE = window.LE;
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  if (!LE || !LE.Scene) return;
  function hook(n, f) { (H[n] = H[n] || []).push(f); }

  var MODES = [['solid', 'Box'], ['pixelate', 'Pixelate'], ['blur', 'Blur']];
  var MODE_NAME = { solid: 'Box', pixelate: 'Pixelate', blur: 'Blur' };
  var INKS = ['#17131F', '#000000', '#FFFFFF', '#5E5967', '#B42318'];
  var ICONS = {
    redact: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/><rect x="9.2" y="9.2" width="5.6" height="5.6" fill="currentColor" stroke="none"/>',
    rbox: '<rect x="3.5" y="7" width="17" height="10" rx="1.5" fill="currentColor"/>',
    rpix: '<path d="M4 4h5v5H4zM9 9h6v6H9zM15 4h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z" fill="currentColor" stroke="none" opacity=".85"/><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>',
    rblur: '<circle cx="12" cy="12" r="8.5" opacity=".35"/><circle cx="12" cy="12" r="5.5" opacity=".6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
    oval: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
    rect: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>',
    bake: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.4 2.4 4.6-4.8"/>'
  };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function isRedact(l) { return !!(l && l.type === 'shape' && l.redact); }
  function redactions(c) { return c.scene.layers().filter(isRedact); }
  function selRedact(c) { var l = c.one && c.one(); return isRedact(l) ? l : null; }
  function tbtn(c, cmd, icon, label, o) {
    o = o || {};
    return '<button type="button" class="sx-tb' + (o.text ? ' has-text' : '') + (o.cls ? ' ' + o.cls : '') + '" data-cmd="' + cmd + '" aria-label="' + c.esc(o.aria || label) + '" title="' + c.esc(o.title || label) + '"' + (o.pressed != null ? ' aria-pressed="' + !!o.pressed + '"' : '') + '>' + (icon ? c.ic(icon) : '') + (o.text ? '<span>' + c.esc(label) + '</span>' : '') + '</button>';
  }

  /* ---------- Adding ---------- */
  function addRedact(c, box, mode, shape) {
    mode = mode === 'blur' || mode === 'pixelate' ? mode : 'solid';
    var n = redactions(c).length + 1;
    var id = c.scene.add({
      type: 'shape', shape: shape === 'ellipse' ? 'ellipse' : 'rect', name: 'Redaction ' + n,
      x: Math.round(box.x), y: Math.round(box.y), w: Math.max(4, Math.round(box.w)), h: Math.max(4, Math.round(box.h)),
      fill: { type: 'solid', color: '#17131F' },
      redact: { mode: mode, amount: 0, color: lsGet('le-redact-color', '#17131F') }
    });
    lsSet('le-redact-mode', mode);
    if (c.markDirty) c.markDirty();
    return id;
  }
  function defaultBox(c, at) {
    var d = c.doc();
    var s = Math.round(Math.min(d.width, d.height) * 0.28);
    var w = s, h = Math.round(s * 0.6);
    var cx = at ? at.x : d.width / 2, cy = at ? at.y : d.height / 2;
    var t = c.one && c.one();
    if (!at && t && t.type === 'image') { cx = t.x + t.w / 2; cy = t.y + t.h / 2; }
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }

  /* Draw-a-box: an overlay on the stage; drag to place, tap to drop a default box, Esc or Cancel to stop. */
  var DRAW = null;
  function startDraw(c, mode) {
    if (!c.S.project) { c.toast('Open a design or a photo first.'); return; }
    stopDraw();
    mode = mode || lsGet('le-redact-mode', 'solid');
    if (c.isPhone && c.isPhone() && c.closePanel) c.closePanel();
    c.scene.select([]);
    var stage = c.E.stage;
    var ov = c.h('<div class="sxp-draw" role="application" aria-label="Drag over what you want to hide"><div class="sxp-draw-hint"><span></span><button type="button" class="btn btn-sm sxp-draw-x">Cancel</button></div><i class="sxp-draw-box" hidden></i></div>');
    ov.querySelector('span').textContent = MODE_NAME[mode] + ': drag over what to hide';
    stage.appendChild(ov);
    var box = ov.querySelector('.sxp-draw-box');
    var start = null;
    DRAW = { c: c, el: ov, mode: mode };
    ov.querySelector('.sxp-draw-x').onclick = function (e) { e.stopPropagation(); stopDraw(); };
    function local(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY }; }
    ov.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.sxp-draw-hint')) return;
      e.preventDefault();
      start = local(e);
      try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      box.hidden = false;
      paint(start, start);
    });
    ov.addEventListener('pointermove', function (e) { if (start) paint(start, local(e)); });
    ov.addEventListener('pointerup', function (e) {
      if (!start) return;
      var end = local(e);
      var a = start;
      start = null;
      finish(c, a, end, mode);
    });
    ov.addEventListener('pointercancel', function () { start = null; box.hidden = true; });
    function paint(a, b) {
      box.style.left = Math.min(a.x, b.x) + 'px';
      box.style.top = Math.min(a.y, b.y) + 'px';
      box.style.width = Math.abs(b.x - a.x) + 'px';
      box.style.height = Math.abs(b.y - a.y) + 'px';
    }
  }
  function finish(c, a, b, mode) {
    var pr = c.scene.pageRect();
    var d = c.doc();
    function toDoc(p) { return { x: (p.cx - pr.left) / pr.width * d.width, y: (p.cy - pr.top) / pr.height * d.height }; }
    var p = toDoc(a), q = toDoc(b);
    var rect;
    if (Math.abs(b.x - a.x) < 8 && Math.abs(b.y - a.y) < 8) rect = defaultBox(c, p);
    else rect = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
    stopDraw();
    addRedact(c, rect, mode);
    c.toast(mode === 'solid' ? 'Redaction added' : 'Redaction added · Box is safest for text and numbers');
  }
  function stopDraw() {
    if (!DRAW) return false;
    DRAW.el.remove();
    DRAW = null;
    return true;
  }

  /* ---------- Changing ---------- */
  function setRedact(c, id, patch) {
    var l = c.scene.layer(id);
    if (!isRedact(l)) return;
    var next = Object.assign({}, l.redact, patch);
    c.scene.update(id, { redact: next });
    if (patch.mode) lsSet('le-redact-mode', patch.mode);
    if (patch.color) lsSet('le-redact-color', patch.color);
    if (c.markDirty) c.markDirty();
  }

  /* ---------- Apply permanently ---------- */
  function matrixOf(l) {
    return new DOMMatrix().translate(l.x + l.w / 2, l.y + l.h / 2).rotate(l.rotation || 0).scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1).translate(-l.w / 2, -l.h / 2);
  }
  function aabb(l) {
    var m = matrixOf(l);
    var xs = [], ys = [];
    [[0, 0], [l.w, 0], [l.w, l.h], [0, l.h]].forEach(function (p) { var q = m.transformPoint(new DOMPoint(p[0], p[1])); xs.push(q.x); ys.push(q.y); });
    return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
  }
  function overlaps(a, b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; }
  /* Which photo layers sit under which redactions on this page. */
  function plan(c) {
    var layers = c.scene.layers();
    var jobs = [];
    layers.forEach(function (l, i) {
      if (l.type !== 'image' || !l.src || !c.mem[l.src]) return;
      var over = layers.slice(i + 1).filter(function (r) { return isRedact(r) && r.visible !== false && overlaps(aabb(l), aabb(r)); });
      if (over.length) jobs.push({ layer: l, redacts: over });
    });
    var bg = c.doc().background || {};
    var bgCovered = bg.type === 'image' && bg.src && layers.some(function (r) { return isRedact(r); });
    return { jobs: jobs, bgCovered: !!bgCovered };
  }
  function bakeOne(c, job) {
    var l = job.layer;
    var src = c.mem[l.src].canvas;
    var iw = src.width, ih = src.height;
    var cv = document.createElement('canvas');
    cv.width = iw; cv.height = ih;
    var x = cv.getContext('2d');
    x.drawImage(src, 0, 0);
    var crop = l.crop || { x: 0, y: 0, w: 1, h: 1 };
    var m = new DOMMatrix().translate(crop.x * iw, crop.y * ih).scale(iw * crop.w / l.w, ih * crop.h / l.h).multiply(matrixOf(l).inverse());
    job.redacts.forEach(function (r) {
      x.save();
      x.setTransform(m);
      LE.Scene.paintRedact(x, r, {});
      x.restore();
    });
    var meta = c.mem[l.src].meta || {};
    var png = /png|webp|gif/i.test(meta.type || '');
    return new Promise(function (res) { cv.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.92); }).then(function (blob) {
      if (!blob) throw new Error('Could not encode the photo.');
      var base = String(meta.name || 'photo').replace(/\.[^.]+$/, '');
      return c.ingest(new File([blob], base + '-redacted' + (png ? '.png' : '.jpg'), { type: blob.type }));
    });
  }
  function referenced(c, id) {
    if (c.syncProject) c.syncProject();
    var p = c.S.project;
    return (p.pages || []).some(function (d) {
      if (d.background && d.background.src === id) return true;
      return (d.layers || []).some(function (l) { return l.type === 'image' && l.src === id; });
    });
  }
  function bake(c) {
    var pl = plan(c);
    if (!pl.jobs.length) {
      c.toast(pl.bgCovered ? 'Detach the background photo first, then apply.' : 'No photo is under a redaction on this page.');
      return Promise.resolve({ baked: 0 });
    }
    var olds = pl.jobs.map(function (j) { return j.layer.src; });
    return Promise.all(pl.jobs.map(function (j) { return bakeOne(c, j); })).then(function (metas) {
      c.batch(function () {
        pl.jobs.forEach(function (j, i) { c.scene.update(j.layer.id, { src: metas[i].id }); });
      });
      var dropped = [];
      olds.forEach(function (id) {
        if (!referenced(c, id) && c.S.project.assets[id]) { delete c.S.project.assets[id]; dropped.push(id); }
      });
      if (c.markDirty) c.markDirty();
      if (c.renderPanel) c.renderPanel(true);
      c.toast(pl.jobs.length === 1 ? 'Redaction applied to the photo' : 'Redactions applied to ' + pl.jobs.length + ' photos');
      return { baked: pl.jobs.length, dropped: dropped, assets: metas.map(function (m) { return m.id; }) };
    }).catch(function (err) {
      c.toast('Could not apply: ' + (err && err.message ? err.message : 'something went wrong'));
      return { baked: 0, error: true };
    });
  }
  function confirmBake(c) {
    var pl = plan(c);
    var body = c.h('<div class="sxp-confirm"></div>');
    var p1 = document.createElement('p');
    p1.textContent = pl.jobs.length ? 'This replaces ' + (pl.jobs.length === 1 ? 'the photo' : 'the ' + pl.jobs.length + ' photos') + ' under your redactions with redacted copies, and removes the original' + (pl.jobs.length === 1 ? '' : 's') + ' from this project, so the project file can be shared safely too.' : 'No photo is under a redaction on this page yet.';
    body.appendChild(p1);
    var p2 = document.createElement('p');
    p2.className = 'sxp-muted';
    p2.textContent = 'You can undo it until you leave the studio. Earlier versions in version history may still hold the original; delete them there if you need to.';
    body.appendChild(p2);
    var row = c.h('<div class="sxp-confirm-row"><button type="button" class="btn btn-ghost">Cancel</button><button type="button" class="btn sxp-danger">Apply permanently</button></div>');
    row.firstChild.onclick = function () { c.closeModal(); };
    row.lastChild.disabled = !pl.jobs.length;
    row.lastChild.onclick = function () { c.closeModal(); bake(c); };
    body.appendChild(row);
    c.openModal('Apply permanently?', body);
  }
  /* After undo, a photo that was dropped from the project comes back: put its record back too. */
  function restoreAssets(c) {
    var p = c.S && c.S.project;
    if (!p || !p.assets) return;
    var d = c.doc();
    (d.layers || []).forEach(function (l) {
      if (l.type === 'image' && l.src && !p.assets[l.src] && c.mem[l.src] && c.mem[l.src].meta) p.assets[l.src] = c.mem[l.src].meta;
    });
  }

  /* ---------- Panel ---------- */
  function honesty(c) {
    var n = c.h('<div class="sxp-honest"><p><b>Downloads are safe.</b> PNG, JPG and PDF exports are flat images, so whatever is under a redaction is gone from them for good.</p><p><b>The project still has the original.</b> Your saved design keeps the photo underneath, so do not share the project file, or use Apply permanently.</p></div>');
    return n;
  }
  function addButtons(c) {
    var g = c.h('<div class="sxp-modes" role="group" aria-label="Add a redaction"></div>');
    [['solid', 'Box', 'rbox', 'Safest for text'], ['pixelate', 'Pixelate', 'rpix', 'Faces, plates'], ['blur', 'Blur', 'rblur', 'Faces, backgrounds']].forEach(function (m) {
      var b = c.h('<button type="button" class="sxp-mode" data-mode="' + m[0] + '">' + c.ic(m[2]) + '<b>' + m[1] + '</b><small>' + m[3] + '</small></button>');
      b.onclick = function () { startDraw(c, m[0]); };
      g.appendChild(b);
    });
    return g;
  }
  P.redact = {
    title: 'Redact', eyebrow: 'Privacy',
    render: function (c, body) {
      var l = selRedact(c);
      if (l) {
        var r = l.redact;
        var s1 = c.ui.section('This redaction');
        var b1 = s1.querySelector('.sx-sec-body');
        b1.appendChild(c.ui.seg(MODES, r.mode, function (v) { setRedact(c, l.id, { mode: v }); c.renderPanel(true); }, 'sx-seg-fill sxp-seg'));
        var tip = document.createElement('p');
        tip.className = 'sxp-tip' + (r.mode === 'solid' ? '' : ' is-warn');
        tip.textContent = r.mode === 'solid' ? 'A solid box is the safest choice for text, numbers and plates.' : 'Good for faces. For text and numbers, a solid Box is safer.';
        b1.appendChild(tip);
        if (r.mode !== 'solid') {
          var eff = Math.round(LE.Scene.redactSize(l));
          b1.appendChild(c.ui.slider({
            label: r.mode === 'blur' ? 'Blur strength' : 'Block size', min: 0, max: 200, step: 2, value: r.amount, reset: 0,
            fmt: function (v) { return v ? v + ' px' : 'Auto (' + eff + ' px)'; },
            onInput: function (v, key) { var cur = c.scene.layer(l.id); if (!cur) return; c.scene.update(l.id, { redact: Object.assign({}, cur.redact, { amount: v }) }, { coalesce: key }); },
            onEnd: function () { if (c.markDirty) c.markDirty(); }
          }));
          var fl = document.createElement('p');
          fl.className = 'sxp-muted';
          fl.textContent = 'Values below the safe minimum for this size are raised automatically.';
          b1.appendChild(fl);
        } else {
          var sw = c.h('<div class="sxp-inks" role="group" aria-label="Box colour"></div>');
          INKS.forEach(function (ink) {
            var b = c.h('<button type="button" class="sxp-ink" aria-label="Box colour ' + ink + '" aria-pressed="' + (ink.toLowerCase() === String(r.color).toLowerCase()) + '"><i style="background:' + ink + '"></i></button>');
            b.onclick = function () { setRedact(c, l.id, { color: ink }); c.renderPanel(true); };
            sw.appendChild(b);
          });
          b1.appendChild(sw);
        }
        b1.appendChild(c.ui.seg([['rect', 'Rectangle', 'rect'], ['ellipse', 'Oval', 'oval']], l.shape === 'ellipse' ? 'ellipse' : 'rect', function (v) { c.scene.update(l.id, { shape: v }); if (c.markDirty) c.markDirty(); }, 'sx-seg-fill sxp-seg'));
        body.appendChild(s1);
      }
      var s2 = c.ui.section(l ? 'Add another' : 'Hide something');
      var b2 = s2.querySelector('.sx-sec-body');
      b2.appendChild(addButtons(c));
      var hint = document.createElement('p');
      hint.className = 'sxp-muted';
      hint.textContent = 'Pick one, then drag over a face, a plate, a name or a number. Tap instead of dragging to drop a box.';
      b2.appendChild(hint);
      body.appendChild(s2);
      var s3 = c.ui.section('Before you share');
      var b3 = s3.querySelector('.sx-sec-body');
      b3.appendChild(honesty(c));
      var count = redactions(c).length;
      var pl = plan(c);
      var bake1 = c.h('<button type="button" class="btn sx-block sxp-bake" data-cmd="redactBake">' + c.ic('bake') + '<span>Apply permanently</span></button>');
      bake1.disabled = !pl.jobs.length;
      b3.appendChild(bake1);
      var st = document.createElement('p');
      st.className = 'sxp-muted';
      st.textContent = count ? count + ' redaction' + (count === 1 ? '' : 's') + ' on this page' + (pl.jobs.length ? ', over ' + pl.jobs.length + ' photo' + (pl.jobs.length === 1 ? '' : 's') + '.' : ', over no photo.') : 'No redactions on this page yet.';
      b3.appendChild(st);
      body.appendChild(s3);
    }
  };

  /* ---------- Entry points ---------- */
  var OLD_EL = P.elements;
  if (OLD_EL && typeof OLD_EL.render === 'function') {
    P.elements = Object.assign({}, OLD_EL, {
      render: function (c, body, o) {
        OLD_EL.render.call(OLD_EL, c, body, o);
        var card = c.h('<div class="sxp-entry"><div class="sxp-entry-text"><b>Redact</b><small>Hide faces, plates, names and numbers before you post</small></div></div>');
        card.appendChild(addButtons(c));
        var bar = body.querySelector('.sx-sticky');
        if (bar && bar.nextSibling) body.insertBefore(card, bar.nextSibling); else body.appendChild(card);
      }
    });
  }
  CMDS.redactStart = function (c, arg) { startDraw(c, arg || null); };
  CMDS.redactAdd = function (c, arg) { addRedact(c, defaultBox(c), arg || lsGet('le-redact-mode', 'solid')); };
  CMDS.redactMode = function (c, arg) { var l = selRedact(c); if (l) setRedact(c, l.id, { mode: arg }); };
  CMDS.redactShape = function (c) { var l = selRedact(c); if (l) { c.scene.update(l.id, { shape: l.shape === 'ellipse' ? 'rect' : 'ellipse' }); if (c.markDirty) c.markDirty(); } };
  CMDS.redactPanel = function (c) { c.openPanel('redact'); };
  CMDS.redactBake = function (c) { confirmBake(c); };

  hook('init', function (c) { Object.keys(ICONS).forEach(function (k) { if (c.I && !c.I[k]) c.I[k] = ICONS[k]; }); });
  hook('toolbar-add', function (c, kind) {
    if (kind !== 'image') return '';
    return '<span class="sx-tb-sep" aria-hidden="true"></span>' + tbtn(c, 'redactStart', 'redact', 'Redact', { text: true, title: 'Blur, pixelate or box out part of the photo' });
  });
  hook('toolbar', function (c, kind, l) {
    if (kind !== 'shape' || !isRedact(l)) return null;
    var r = l.redact;
    var sep = '<span class="sx-tb-sep" aria-hidden="true"></span>';
    return '<span class="sx-tb-label sxp-tb-label">' + c.ic('redact') + 'Redaction</span>' +
      MODES.map(function (m) { return tbtn(c, 'redactMode:' + m[0], m[0] === 'solid' ? 'rbox' : m[0] === 'pixelate' ? 'rpix' : 'rblur', m[1], { text: true, pressed: r.mode === m[0] }); }).join('') + sep +
      tbtn(c, 'redactShape', l.shape === 'ellipse' ? 'rect' : 'oval', l.shape === 'ellipse' ? 'Make it a rectangle' : 'Make it an oval') +
      tbtn(c, 'redactPanel', 'adjust', 'Strength and colour', { text: true, title: 'Strength, colour and Apply permanently' }) + sep +
      tbtn(c, 'dup', 'copy', 'Duplicate (Ctrl+D)') + tbtn(c, 'del', 'trash', 'Delete (Del)') + sep +
      tbtn(c, 'redactBake', 'bake', 'Apply permanently', { text: true });
  });
  hook('escape', function () { return stopDraw(); });
  hook('page', function () { stopDraw(); });
  hook('history', function (c) { restoreAssets(c); });
  hook('select', function (c) { if (c.S.panel === 'redact' && c.renderPanel) c.renderPanel(true); });

  /* ---------- Apps → Metadata: privacy summary and a link to the full check ---------- */
  function loadPrivacy() {
    if (LE.privacy) return Promise.resolve(LE.privacy);
    if (loadPrivacy.p) return loadPrivacy.p;
    var me = document.querySelector('script[src*="le-studio-privacy.js"]');
    var src = me ? me.src.replace(/le-studio-privacy\.js.*$/, 'le-privacy.js') : '../assets/js/le-privacy.js';
    loadPrivacy.p = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { if (LE.privacy) res(LE.privacy); else rej(new Error('not loaded')); };
      s.onerror = function () { loadPrivacy.p = null; rej(new Error('not loaded')); };
      document.head.appendChild(s);
    });
    return loadPrivacy.p;
  }
  var OLD_APPS = P.apps;
  if (OLD_APPS && typeof OLD_APPS.render === 'function') {
    P.apps = Object.assign({}, OLD_APPS, {
      render: function (c, body, o) {
        OLD_APPS.render.call(OLD_APPS, c, body, o);
        if (!o || o.app !== 'metadata') return;
        var img = c.targetImage && c.targetImage();
        var box = c.h('<div class="sxp-meta"></div>');
        body.appendChild(box);
        var link = c.h('<a class="btn btn-ghost sx-block sxp-link" href="../photo-privacy/" target="_blank" rel="noopener">' + c.ic('shield') + '<span>Open the photo privacy check</span></a>');
        if (!img || !img.src) { box.appendChild(link); return; }
        Promise.all([loadPrivacy(), LE.project.getAsset(img.src)]).then(function (pair) {
          if (!pair[1]) throw new Error('missing');
          return pair[0].inspect(pair[1]);
        }).then(function (rep) {
          var sum = document.createElement('p');
          sum.className = 'sxp-sum';
          sum.textContent = rep.summary;
          box.appendChild(sum);
          var chips = c.h('<div class="sxp-chips"></div>');
          rep.groups.forEach(function (g) {
            if (g.id === 'file') return;
            var n = g.items.filter(function (i) { return !i.derived; }).length;
            if (!n) return;
            var chip = document.createElement('span');
            chip.className = 'sxp-chip';
            chip.textContent = g.title + ' · ' + n;
            chips.appendChild(chip);
          });
          if (chips.childNodes.length) box.appendChild(chips);
          box.appendChild(link);
        }).catch(function () { box.appendChild(link); });
      }
    });
  }

  window.LEStudioPrivacy = {
    add: function (box, mode, shape) { return addRedact(window.LEStudio, box || defaultBox(window.LEStudio), mode, shape); },
    set: function (id, patch) { setRedact(window.LEStudio, id, patch || {}); },
    startDraw: function (mode) { startDraw(window.LEStudio, mode); },
    stopDraw: stopDraw,
    drawing: function () { return !!DRAW; },
    plan: function () { var p = plan(window.LEStudio); return { photos: p.jobs.map(function (j) { return j.layer.id; }), background: p.bgCovered }; },
    bake: function () { return bake(window.LEStudio); },
    confirmBake: function () { confirmBake(window.LEStudio); },
    redactions: function () { return redactions(window.LEStudio); }
  };
})();
