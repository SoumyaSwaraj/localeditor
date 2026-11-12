/* LocalEditor studio: recipes module.
   Replaces the Recipes panel (window.LEStudioPanels.recipes) and the Apps → Batch app.
   A recipe applied to a photo lives in the document: its look is written into the layer's
   `adjust` and `filter` fields, and `adjust.recipe` remembers what was added so it can be
   tuned or removed later. Format: docs/FORMAT-WORKFLOW.md. */
(function () {
  'use strict';
  var LE = window.LE;
  var P = window.LEStudioPanels;
  if (!LE || !LE.recipes || !P) return;
  var R = LE.recipes;
  var META = R.lookMeta;
  var HOOKS = P._hooks = P._hooks || {};
  function hook(name, fn) { (HOOKS[name] = HOOKS[name] || []).push(fn); }
  function root() { return document.documentElement.getAttribute('data-root') || '../'; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  }
  function release(cv) { if (cv && cv.getContext) { cv.width = 0; cv.height = 0; } }

  /* ---------- Render shim ----------
     Format 1.1 adds fade, clarity, split tone and levels to a photo's look. Until the layered editor
     passes those adjust keys through itself (it should then set LE.Scene.EXTENDED_ADJUST = true),
     draw them as one extra pass after the layer's usual steps. */
  (function shim() {
    var proto = LE.Scene && LE.Scene.prototype;
    if (!proto || typeof proto._processImage !== 'function' || proto._processImage.__leRecipes) return;
    var orig = proto._processImage;
    var wrapped = function (layer) {
      var job = orig.apply(this, arguments);
      if (LE.Scene.EXTENDED_ADJUST) return job;
      var ext = R.lookExtSteps(layer && layer.adjust);
      if (!ext.length) return job;
      return Promise.resolve(job).then(function (canvas) {
        if (!canvas) return canvas;
        return LE.applySteps(canvas, ext).then(function (res) { release(canvas); return res.canvas; });
      });
    };
    wrapped.__leRecipes = true;
    proto._processImage = wrapped;
  })();

  /* ---------- State ---------- */
  var ST = {
    token: 0, cache: {}, cacheKeys: [], q: '', cat: 'all', draft: null,
    applyKey: null, applyFor: null, lastLook: '', handoffDone: false, batch: null, focus: null
  };

  function strengthOf(wf) { return wf && wf.parameters && wf.parameters[0] && typeof wf.parameters[0].default === 'number' ? wf.parameters[0].default : 75; }
  function findRecipe(c, id) {
    if (!id) return null;
    if (c && c.S.handoffRecipe && c.S.handoffRecipe.metadata.id === id) return c.S.handoffRecipe;
    if (ST.draft && ST.draft.wf.metadata.id === id && ST.draft.tried) return ST.draft.wf;
    return R.find(id);
  }

  /* ---------- Looks on a layer ---------- */
  function marker(layer) {
    var m = layer && layer.adjust && layer.adjust.recipe;
    return m && typeof m === 'object' && typeof m.id === 'string' ? m : null;
  }
  /* The layer's look without the applied recipe. */
  function baseLook(layer) {
    var a = clean(layer && layer.adjust);
    var m = marker(layer);
    delete a.recipe;
    var filter = layer && layer.filter ? clone(layer.filter) : null;
    if (m) {
      Object.keys(m.add || {}).forEach(function (k) {
        if (typeof a[k] !== 'number') return;
        a[k] = r4(a[k] - m.add[k]);
        if (Math.abs(a[k]) < 1e-6) delete a[k];
      });
      Object.keys(m.prev || {}).forEach(function (k) {
        if (m.prev[k] == null) delete a[k]; else a[k] = m.prev[k];
      });
      if (m.filter) filter = m.prevFilter || null;
    }
    return { adjust: a, filter: filter };
  }
  /* The layer's full look as it is drawn now. */
  function fullLook(layer) {
    var a = clean(layer && layer.adjust);
    delete a.recipe;
    return { adjust: a, filter: layer && layer.filter ? clone(layer.filter) : null };
  }
  function hasLook(look) {
    var a = look.adjust || {};
    return !!look.filter || Object.keys(a).some(function (k) { return typeof a[k] === 'number' && a[k] && !(k === 'white' && a[k] === 255) && !(k === 'gamma' && a[k] === 1); });
  }
  function combine(base, wf, strength) {
    var prep = R.prepare(wf, { intensity: strength, allowSkip: true });
    var L = R.look(prep.steps);
    var a = Object.assign({}, base.adjust);
    if (typeof a.temperature === 'number') { a.warmth = r4((a.warmth || 0) + a.temperature); delete a.temperature; }
    var m = { id: wf.metadata.id, name: wf.metadata.name, strength: strength, add: {}, prev: {}, filter: false, prevFilter: null };
    Object.keys(L.adjust).forEach(function (k) {
      var v = L.adjust[k];
      if (META.set[k]) { m.prev[k] = typeof a[k] === 'number' ? a[k] : null; a[k] = v; return; }
      var range = META.range[k];
      var before = typeof a[k] === 'number' ? a[k] : 0;
      var next = r4(Math.max(range[0], Math.min(range[1], before + v)));
      m.add[k] = r4(next - before);
      a[k] = next;
    });
    var filter = base.filter || null;
    if (L.filter) { m.filter = true; m.prevFilter = base.filter || null; filter = L.filter; }
    a.recipe = m;
    return { adjust: a, filter: filter, skipped: L.skipped, notices: prep.notices };
  }
  function lookKey(layer) { return layer ? layer.id + '|' + JSON.stringify(layer.adjust || {}) + JSON.stringify(layer.filter || null) : 'none'; }
  /* The layered editor deep-merges patches, so keys that go away are written as null and the
     recipe marker is cleared before it is replaced. Both writes share one undo step. */
  function setLook(c, id, adjust, filter, key) {
    var cur = c.L(id);
    var old = (cur && cur.adjust) || {};
    var next = Object.assign({}, adjust);
    Object.keys(old).forEach(function (k) { if (!(k in next)) next[k] = null; });
    key = key || c.gesture();
    if (old.recipe && typeof old.recipe === 'object') c.patch(id, { adjust: { recipe: null } }, key);
    c.patch(id, { adjust: next, filter: filter || null }, key);
  }
  function clean(a) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { if (a[k] != null) out[k] = a[k]; });
    return out;
  }
  function applyTo(c, layer, wf, strength, key) {
    var res = combine(baseLook(layer), wf, strength);
    setLook(c, layer.id, res.adjust, res.filter, key);
    ST.lastLook = lookKey(c.L(layer.id));
    return res;
  }
  function removeFrom(c, layer) {
    var b = baseLook(layer);
    setLook(c, layer.id, b.adjust, b.filter);
    ST.lastLook = lookKey(c.L(layer.id));
  }
  function applyFresh(c, layer, wf, strength) {
    var key = c.gesture();
    ST.applyKey = key;
    ST.applyFor = layer.id;
    var res = applyTo(c, layer, wf, strength == null ? strengthOf(wf) : strength, key);
    var later = res.skipped.concat((res.notices || []).filter(function (n) { return n.level === 'skipped' || n.level === 'unavailable'; }).map(function (n) { return n.label; }));
    c.toast('Applied “' + wf.metadata.name + '”' + (later.length ? ' — ' + later.join(', ') + ' run' + (later.length === 1 ? 's' : '') + ' on batch export' : ''), {
      action: { label: 'Undo', fn: function () { c.cmd('undo'); } }
    });
    return res;
  }

  /* ---------- Thumbnails: small, cached, cancelled when the panel closes ---------- */
  var queue = [];
  var running = false;
  function later(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 120 }); else setTimeout(fn, 16); }
  function pump() {
    if (running) return;
    var job = queue.shift();
    if (!job) return;
    if (job.token !== ST.token) { pump(); return; }
    running = true;
    later(function () {
      if (job.token !== ST.token) { running = false; pump(); return; }
      Promise.resolve().then(job.run).catch(function () {}).then(function () { running = false; pump(); });
    });
  }
  function cancelThumbs() { ST.token++; queue.length = 0; }
  function cachePut(key, url) {
    if (!ST.cache[key]) ST.cacheKeys.push(key);
    ST.cache[key] = url;
    while (ST.cacheKeys.length > 120) delete ST.cache[ST.cacheKeys.shift()];
  }
  function renderThumb(src, srcKey, steps, cb) {
    var key = srcKey + '|' + JSON.stringify(steps);
    if (ST.cache[key]) { cb(ST.cache[key]); return; }
    var token = ST.token;
    queue.push({
      token: token,
      run: function () {
        return LE.applySteps(src, steps).then(function (res) {
          var url = res.canvas.toDataURL('image/jpeg', 0.84);
          release(res.canvas);
          cachePut(key, url);
          if (token === ST.token) cb(url);
        });
      }
    });
    pump();
  }
  var samples = {};
  function sampleCanvas(kind) {
    if (!samples[kind]) samples[kind] = LE.fit(LE.sample(kind), 260);
    return samples[kind];
  }
  var srcMemo = { key: '', canvas: null };
  function layerSource(c, layer, max) {
    var m = layer && c.mem[layer.src];
    if (!m || !m.canvas) return null;
    var cr = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    var key = layer.src + '|' + JSON.stringify(cr) + '|' + max;
    if (srcMemo.key === key) return { canvas: srcMemo.canvas, key: key };
    var sw = m.canvas.width * cr.w, sh = m.canvas.height * cr.h;
    var s = Math.min(1, max / Math.max(sw, sh));
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(sw * s));
    cv.height = Math.max(1, Math.round(sh * s));
    var g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(m.canvas, m.canvas.width * cr.x, m.canvas.height * cr.y, sw, sh, 0, 0, cv.width, cv.height);
    if (srcMemo.canvas && srcMemo.canvas !== cv) release(srcMemo.canvas);
    srcMemo = { key: key, canvas: cv };
    return { canvas: cv, key: key };
  }
  function sourceFor(c, layer, wf) {
    var s = layer && layerSource(c, layer, 260);
    if (s) return s;
    var kind = wf && wf.metadata.category === 'portrait' ? 'portrait' : 'scene';
    return { canvas: sampleCanvas(kind), key: 'sample-' + kind };
  }

  /* ---------- Small UI helpers ---------- */
  function btn(c, label, icon, cls, fn) {
    var b = c.h('<button type="button" class="' + (cls || 'btn btn-ghost btn-sm') + '">' + (icon ? c.ic(icon) : '') + '<span>' + esc(label) + '</span></button>');
    if (fn) b.onclick = fn;
    return b;
  }
  function download(c, wf) {
    var v = R.validate(wf);
    if (!v.ok) { c.toast(v.errors[0]); return; }
    c.download(new Blob([R.stringify(v.workflow)], { type: 'application/json' }), (v.workflow.metadata.id || 'recipe') + '.leworkflow');
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(new Error('copy')); } catch (e) { rej(e); }
      ta.remove();
    });
  }
  function summary(step) {
    var p = step.parameters || {};
    var keys = Object.keys(p);
    if (step.operation === 'split-tone') return 'Shadows ' + Math.round(p.shadowAmount || 0) + ' · Highlights ' + Math.round(p.highlightAmount || 0);
    if (step.operation === 'filter') return (p.name || '') + (p.intensity != null ? ' · ' + p.intensity + '%' : '');
    if (step.operation === 'levels') return 'Black ' + (p.black || 0) + ' · White ' + (p.white == null ? 255 : p.white);
    if (step.operation === 'resize' && p.maxWidth) return 'Up to ' + p.maxWidth + ' px wide';
    if (keys.length === 1 && typeof p[keys[0]] === 'number') {
      var v = p[keys[0]];
      return (v > 0 && /value/.test(keys[0]) ? '+' : '') + v;
    }
    return keys.slice(0, 3).map(function (k) { return k + ' ' + (typeof p[k] === 'number' ? p[k] : String(p[k]).slice(0, 12)); }).join(' · ');
  }

  /* ---------- Import ---------- */
  function importWorkflow(c, wf, warnings) {
    var id = wf.metadata.id;
    var existing = LE.userRecipes.get(id);
    var same = existing && JSON.stringify(existing.steps) === JSON.stringify(wf.steps) && existing.metadata.name === wf.metadata.name;
    if (R.isBuiltin(id) || (existing && !same)) wf.metadata.id = LE.userRecipes.freeId(wf.metadata.name);
    var saved;
    try { saved = LE.userRecipes.save(wf); } catch (err) { c.toast(err.message); return null; }
    c.toast('Added “' + saved.metadata.name + '” to your recipes' + (warnings && warnings.length ? ' (' + warnings.length + ' unknown setting' + (warnings.length === 1 ? '' : 's') + ' left out)' : ''));
    return saved;
  }
  function importText(c, text) {
    var t = String(text || '').trim();
    if (!t) return Promise.resolve({ ok: false, errors: ['Paste a recipe link or the text of a .leworkflow file.'] });
    if (t.charAt(0) !== '{' && R.linkPayload(t)) return R.decodeLink(t);
    return Promise.resolve(R.validate(t));
  }
  function importFile(c, file) {
    if (!file) return;
    if (file.size > R.limits.bytes) { c.toast('That recipe file is too large.'); return; }
    file.text().then(function (txt) {
      var v = R.validate(txt);
      if (!v.ok) { c.toast(v.errors[0] || 'That is not a valid recipe.'); return; }
      var saved = importWorkflow(c, v.workflow, v.warnings);
      if (saved) { c.closeModal(); ST.cat = 'mine'; ST.focus = saved.metadata.id; c.openPanel('recipes', { recipe: saved.metadata.id }); }
    });
  }
  function openImport(c) {
    var box = c.h('<div class="sxr-import">' +
      '<p class="sxr-lead">Add a recipe someone shared with you. It is checked against the list of allowed edits before anything runs.</p>' +
      '<button type="button" class="btn btn-ghost sxr-wide" data-file>' + c.ic('file') + '<span>Choose a .leworkflow file</span></button>' +
      '<label class="sxr-label" for="sxr-paste">Or paste a link or the file’s text</label>' +
      '<textarea id="sxr-paste" class="sx-input sxr-textarea" rows="4" spellcheck="false" placeholder="https://…/recipes/#r=…"></textarea>' +
      '<p class="sxr-error" role="alert" hidden></p>' +
      '<div class="sxr-actions"><button type="button" class="btn btn-gold" data-go>Add recipe</button></div></div>');
    c.openModal('Import a recipe', box);
    box.querySelector('[data-file]').onclick = function () { c.pickFiles('recipe'); };
    var err = box.querySelector('.sxr-error');
    box.querySelector('[data-go]').onclick = function () {
      importText(c, box.querySelector('textarea').value).then(function (v) {
        if (!v.ok) { err.hidden = false; err.textContent = v.errors[0] || 'That is not a valid recipe.'; return; }
        var saved = importWorkflow(c, v.workflow, v.warnings);
        if (!saved) return;
        c.closeModal();
        ST.cat = 'mine';
        ST.focus = saved.metadata.id;
        c.openPanel('recipes', { recipe: saved.metadata.id });
      });
    };
  }

  /* ---------- Share ---------- */
  var qrReady = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrReady) qrReady = (LE.lazy ? LE.lazy(root() + 'assets/vendor/qrcode.js') : Promise.reject(new Error('no loader'))).then(function () { return window.qrcode; });
    return qrReady;
  }
  function qrSvg(text) {
    var q = window.qrcode;
    if (!q) return '';
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    var qr = q(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount(), m = 4, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) d += 'M' + (x + m) + ' ' + (y + m) + 'h1v1h-1z';
    return '<svg viewBox="0 0 ' + (n + m * 2) + ' ' + (n + m * 2) + '" role="img" aria-label="QR code for the recipe link" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#17131F"/></svg>';
  }
  function openShare(c, wf) {
    var v = R.validate(wf);
    if (!v.ok) { c.toast(v.errors[0]); return; }
    wf = v.workflow;
    var box = c.h('<div class="sxr-share">' +
      '<p class="sxr-lead">Anyone with the link can preview “' + esc(wf.metadata.name) + '” and use it on their own photos. The recipe rides after the <b>#</b> in the link, so it never reaches a server. No photo is included.</p>' +
      '<div class="sxr-linkrow"><input class="sx-input" readonly aria-label="Recipe link" value="Making a link…"><button type="button" class="btn btn-gold btn-sm" data-copy disabled>' + c.ic('copy') + '<span>Copy</span></button></div>' +
      '<div class="sxr-qr" aria-live="polite"></div>' +
      '<div class="sxr-actions"><button type="button" class="btn btn-ghost btn-sm" data-share hidden>' + c.ic('share') + '<span>Share…</span></button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-file>' + c.ic('download') + '<span>Download .leworkflow</span></button></div></div>');
    c.openModal('Share recipe', box);
    var input = box.querySelector('input');
    var copy = box.querySelector('[data-copy]');
    var share = box.querySelector('[data-share]');
    box.querySelector('[data-file]').onclick = function () { download(c, wf); };
    var file = new File([R.stringify(wf)], wf.metadata.id + '.leworkflow', { type: 'application/json' });
    var url = null;
    if (navigator.share) {
      share.hidden = false;
      share.onclick = function () {
        var data = { title: wf.metadata.name, text: 'A LocalEditor recipe: ' + wf.metadata.name };
        var withFile = navigator.canShare && navigator.canShare({ files: [file] });
        if (withFile) data.files = [file]; else if (url) data.url = url;
        navigator.share(data).catch(function () {});
      };
    }
    R.encodeLink(wf).then(function (link) {
      url = link.url;
      input.value = link.url;
      copy.disabled = false;
      copy.onclick = function () {
        copyText(link.url).then(function () { copy.querySelector('span').textContent = 'Copied'; c.toast('Link copied'); }, function () { input.select(); c.toast('Press Ctrl+C to copy'); });
      };
      input.onfocus = function () { input.select(); };
      if (link.url.length <= 1200) {
        loadQr().then(function () {
          var svg = qrSvg(link.url);
          if (svg) box.querySelector('.sxr-qr').innerHTML = svg + '<small>Scan to open on a phone</small>';
        }).catch(function () {});
      } else box.querySelector('.sxr-qr').innerHTML = '<small>This link is too long for a QR code. Copy it instead.</small>';
    }, function (err) {
      input.value = '';
      input.placeholder = 'No link for this recipe';
      box.querySelector('.sxr-qr').innerHTML = '<p class="sxr-error">' + esc(err.message) + '</p>';
    });
  }

  /* ---------- Recipe list ---------- */
  function cardArt(c, card, layer, wf, base) {
    var src = sourceFor(c, layer, wf);
    var before = card.querySelector('.is-before'), after = card.querySelector('.is-after');
    var baseSteps = R.lookSteps(base.adjust, base.filter);
    var res = combine(base, wf, strengthOf(wf));
    var afterSteps = R.lookSteps(res.adjust, res.filter);
    renderThumb(src.canvas, src.key, baseSteps, function (url) { before.src = url; card.classList.add('has-before'); });
    renderThumb(src.canvas, src.key, afterSteps, function (url) { after.src = url; card.classList.add('has-art'); });
  }
  function renderList(c, body, o) {
    cancelThumbs();
    var layer = c.targetImage();
    var wrap = c.h('<div class="sxr"></div>');
    body.appendChild(wrap);
    c.S.onRecipeFile = function (f) { importFile(c, f); };
    bindDrop(c, wrap);
    var mine = LE.userRecipes.all();
    var mineIds = {};
    mine.forEach(function (r) { mineIds[r.metadata.id] = 1; });
    var list = mine.concat(R.builtins);
    var ho = c.S.handoffRecipe;
    if (ho && !list.some(function (r) { return r.metadata.id === ho.metadata.id; })) list.unshift(ho);
    if (ho && o.recipe === ho.metadata.id && !ST.handoffDone && layer) {
      ST.handoffDone = true;
      applyFresh(c, c.L(layer.id), ho);
      layer = c.L(layer.id);
    }
    ST.lastLook = lookKey(layer);
    var m = marker(layer);
    var base = layer ? baseLook(layer) : { adjust: {}, filter: null };

    if (!layer) {
      var hint = c.h('<div class="sxr-hint">' + c.ic('image') + '<div><b>' + (c.S.project ? 'Select a photo' : 'Open a photo') + '</b><span>Tap a recipe to apply it. Previews use a sample until then.</span></div></div>');
      var acts = c.h('<div class="sxr-hint-act"></div>');
      acts.appendChild(btn(c, c.S.project ? 'Add photo' : 'Open photo', 'plus', 'btn btn-gold btn-sm', function () { c.pickFiles('add'); }));
      if (!c.S.project) acts.appendChild(btn(c, 'Try sample', null, 'btn btn-ghost btn-sm', function () { c.useSample(); }));
      hint.appendChild(acts);
      wrap.appendChild(hint);
    } else if (m) {
      wrap.appendChild(appliedCard(c, layer, m));
    }

    var sticky = c.h('<div class="sx-sticky sxr-tools"><div class="sx-search">' + c.ic('search') + '<input type="search" placeholder="Search recipes" aria-label="Search recipes"></div><div class="sx-chips is-scroll sxr-cats" role="group" aria-label="Categories"></div></div>');
    wrap.appendChild(sticky);
    var chips = sticky.querySelector('.sxr-cats');
    var cats = [['all', 'All']];
    if (mine.length || ho) cats.push(['mine', 'Yours']);
    R.categories.forEach(function (cat) { if (list.some(function (r) { return r.metadata.category === cat[0]; })) cats.push(cat); });
    if (!cats.some(function (x) { return x[0] === ST.cat; })) ST.cat = 'all';
    cats.forEach(function (cat) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (ST.cat === cat[0]) + '">' + esc(cat[1]) + '</button>');
      b.onclick = function () {
        ST.cat = cat[0];
        chips.querySelectorAll('.sx-chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        filter();
      };
      chips.appendChild(b);
    });
    var search = sticky.querySelector('input');
    search.value = ST.q;
    search.addEventListener('input', c.debounce(function () { ST.q = search.value.trim().toLowerCase(); filter(); }, 120));

    var grid = c.h('<div class="sxr-grid" role="list"></div>');
    wrap.appendChild(grid);
    var empty = c.h('<p class="sxr-empty" hidden>No recipe matches. Try another word, or import one.</p>');
    wrap.appendChild(empty);
    var cards = [];
    list.forEach(function (wf) {
      var id = wf.metadata.id;
      var on = m && m.id === id;
      var yours = !!mineIds[id] || (ho && ho.metadata.id === id && !R.isBuiltin(id));
      var card = c.h('<div class="sxr-card' + (on ? ' is-on' : '') + '" role="listitem" data-id="' + esc(id) + '">' +
        '<button type="button" class="sxr-card-main" aria-pressed="' + !!on + '" aria-label="' + esc((on ? 'Applied: ' : 'Apply ') + wf.metadata.name) + '">' +
        '<span class="sxr-art"><img class="is-before" alt=""><img class="is-after" alt=""><i class="sxr-split" aria-hidden="true"></i>' + (on ? '<span class="sxr-badge">' + c.ic('check') + '</span>' : '') + '</span>' +
        '<span class="sxr-name">' + esc(wf.metadata.name) + '</span>' +
        '<span class="sxr-meta">' + esc(yours ? 'Yours' : R.categoryLabel(wf.metadata.category)) + ' · ' + wf.steps.length + ' step' + (wf.steps.length === 1 ? '' : 's') + '</span></button>' +
        '<button type="button" class="sxr-more" aria-label="More for ' + esc(wf.metadata.name) + '">' + c.ic('more') + '</button></div>');
      card._wf = wf;
      card._text = (wf.metadata.name + ' ' + wf.metadata.description + ' ' + wf.metadata.tags.join(' ') + ' ' + R.categoryLabel(wf.metadata.category)).toLowerCase();
      card._mine = yours;
      card.querySelector('.sxr-card-main').onclick = function () {
        var cur = c.targetImage();
        if (!cur) { c.toast('Select a photo first, then tap a recipe.'); return; }
        if (marker(cur) && marker(cur).id === id) { var s = wrap.querySelector('.sxr-applied input[type=range]'); if (s) s.focus(); return; }
        applyFresh(c, cur, wf);
        c.renderPanel(true);
      };
      card.querySelector('.sxr-more').onclick = function (e) { moreMenu(c, e.currentTarget, wf, yours); };
      cards.push(card);
      grid.appendChild(card);
      cardArt(c, card, layer, wf, base);
    });
    function filter() {
      var shown = 0;
      cards.forEach(function (card) {
        var wf = card._wf;
        var ok = (ST.cat === 'all' || (ST.cat === 'mine' ? card._mine : wf.metadata.category === ST.cat)) && (!ST.q || card._text.indexOf(ST.q) >= 0);
        card.hidden = !ok;
        if (ok) shown++;
      });
      empty.hidden = shown > 0;
    }
    filter();

    var foot = c.h('<div class="sxr-foot"></div>');
    var look = layer ? fullLook(layer) : null;
    var save = btn(c, 'Save this look as a recipe', 'save', 'btn btn-ghost sxr-wide', function () {
      var cur = c.targetImage();
      if (!cur) { c.toast('Select a photo first.'); return; }
      openEditor(c, newFromLook(fullLook(cur), marker(cur)));
    });
    if (!layer || !hasLook(look)) { save.disabled = true; save.title = 'Adjust a photo first, then save its look.'; }
    foot.appendChild(save);
    var row = c.h('<div class="sxr-row"></div>');
    row.appendChild(btn(c, 'New recipe', 'plus', 'btn btn-ghost btn-sm', function () { openEditor(c, newFromLook({ adjust: {}, filter: null }, null)); }));
    row.appendChild(btn(c, 'Import…', 'file', 'btn btn-ghost btn-sm', function () { openImport(c); }));
    var lib = c.h('<a class="btn btn-ghost btn-sm" href="' + root() + 'recipes/">' + c.ic('recipes') + '<span>Library</span></a>');
    row.appendChild(lib);
    foot.appendChild(row);
    foot.appendChild(c.h('<p class="sx-note">Recipes are plain lists of edits (.leworkflow). They are checked before use and can never run code.</p>'));
    wrap.appendChild(foot);

    var focusId = o.recipe || ST.focus;
    ST.focus = null;
    if (focusId) {
      var target = grid.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"]');
      if (target && !target.hidden) setTimeout(function () { target.scrollIntoView({ block: 'nearest' }); target.classList.add('is-flash'); }, 60);
    }
  }

  function appliedCard(c, layer, m) {
    var wf = findRecipe(c, m.id);
    var box = c.h('<section class="sxr-applied" aria-label="Applied recipe"><div class="sxr-applied-head"><span class="sx-eyebrow">' + c.ic('check') + 'Applied</span><b>' + esc(m.name || m.id) + '</b></div></section>');
    if (wf) {
      var slider = c.ui.slider({
        label: 'Strength', min: 0, max: 100, value: typeof m.strength === 'number' ? m.strength : strengthOf(wf), reset: strengthOf(wf),
        fmt: function (v) { return Math.round(v) + '%'; },
        onInput: function (v) {
          var cur = c.L(layer.id);
          if (!cur) return;
          if (ST.applyFor !== layer.id || !ST.applyKey) { ST.applyKey = c.gesture(); ST.applyFor = layer.id; }
          applyTo(c, cur, wf, v, ST.applyKey);
        }
      });
      box.appendChild(slider);
    } else {
      box.appendChild(c.h('<p class="sx-note">This recipe is not saved on this device, so its strength cannot be changed here.</p>'));
    }
    var row = c.h('<div class="sxr-row"></div>');
    row.appendChild(btn(c, 'Remove', 'reset', 'btn btn-ghost btn-sm', function () {
      var cur = c.L(layer.id);
      if (!cur) return;
      removeFrom(c, cur);
      ST.applyKey = null;
      c.toast('Removed “' + (m.name || 'recipe') + '”', { action: { label: 'Undo', fn: function () { c.cmd('undo'); } } });
      c.renderPanel(true);
    }));
    if (wf) {
      row.appendChild(btn(c, 'Share', 'share', 'btn btn-ghost btn-sm', function () { openShare(c, wf); }));
      if (!R.isBuiltin(wf.metadata.id) && !LE.userRecipes.get(wf.metadata.id)) {
        row.appendChild(btn(c, 'Save', 'save', 'btn btn-ghost btn-sm', function () {
          var saved = importWorkflow(c, clone(wf));
          if (saved) { c.S.handoffRecipe = null; c.renderPanel(true); }
        }));
      }
    }
    box.appendChild(row);
    return box;
  }

  function moreMenu(c, anchor, wf, yours) {
    var menu = c.h('<div class="sxr-menu" role="menu"></div>');
    function item(label, icon, fn, danger) {
      var b = c.h('<button type="button" role="menuitem" class="sxr-menu-item' + (danger ? ' is-danger' : '') + '">' + c.ic(icon) + '<span>' + esc(label) + '</span></button>');
      b.onclick = function () { c.closePop(); fn(); };
      menu.appendChild(b);
    }
    item('Apply to many photos…', 'batch', function () { c.openPanel('apps', { app: 'batch', recipe: wf.metadata.id, back: 'recipes' }); });
    item('Share…', 'share', function () { openShare(c, wf); });
    item('Download .leworkflow', 'download', function () { download(c, wf); });
    if (yours && LE.userRecipes.get(wf.metadata.id)) {
      item('Edit', 'pen', function () { openEditor(c, { wf: clone(wf), isNew: false }); });
      item('Duplicate', 'copy', function () { try { var d = LE.userRecipes.duplicate(wf); ST.focus = d.metadata.id; c.toast('Duplicated'); c.renderPanel(true); } catch (e) { c.toast(e.message); } });
      item('Delete', 'trash', function () {
        LE.userRecipes.remove(wf.metadata.id);
        c.toast('Deleted “' + wf.metadata.name + '”', { action: { label: 'Undo', fn: function () { try { LE.userRecipes.save(wf); } catch (e) {} c.renderPanel(true); } } });
        c.renderPanel(true);
      }, true);
    } else {
      item('Edit a copy', 'pen', function () {
        var copy = clone(wf);
        copy.metadata.name = wf.metadata.name + ' (mine)';
        copy.metadata.id = '';
        copy.metadata.author = 'You';
        openEditor(c, { wf: copy, isNew: true });
      });
    }
    c.openPop(anchor, menu, { title: wf.metadata.name, cls: 'sxr-pop' });
  }

  function bindDrop(c, el) {
    el.addEventListener('dragover', function (e) {
      var types = e.dataTransfer && e.dataTransfer.types ? [].slice.call(e.dataTransfer.types) : [];
      if (types.indexOf('Files') < 0) return;
      e.preventDefault();
      el.classList.add('is-drop');
    });
    el.addEventListener('dragleave', function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove('is-drop'); });
    el.addEventListener('drop', function (e) {
      el.classList.remove('is-drop');
      var files = e.dataTransfer && e.dataTransfer.files ? [].slice.call(e.dataTransfer.files) : [];
      var rec = files.filter(function (f) { return /\.(leworkflow|json)$/i.test(f.name); })[0];
      if (!rec) return;
      e.preventDefault();
      e.stopPropagation();
      importFile(c, rec);
    });
  }

  /* ---------- Recipe editor ---------- */
  function newFromLook(look, m) {
    var steps = R.fromLook(look.adjust, look.filter);
    return {
      isNew: true,
      wf: {
        format: 'localeditor-workflow', version: '1.1',
        metadata: { id: '', name: m && m.name ? m.name + ' (mine)' : 'My look', description: '', author: 'You', category: 'personal', difficulty: 'beginner', tags: [], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Strength', type: 'slider', min: 0, max: 100, default: 100 }],
        steps: steps,
        export: { format: 'jpeg', quality: 90 }
      }
    };
  }
  function openEditor(c, draft) {
    ST.draft = draft;
    c.openPanel('recipes', { view: 'edit', back: 'recipes' });
  }
  var COVERS = ['people-08', 'people-01', 'people-06', 'travel-05', 'still-01', 'still-02', 'arch-03', 'garden-05', 'street-03', 'nature-02', 'travel-07', 'books-03'];

  function draftForSave(c) {
    var wf = clone(ST.draft.wf);
    if (!wf.metadata.id || ST.draft.isNew) wf.metadata.id = LE.userRecipes.freeId(wf.metadata.name || 'My recipe');
    if (!wf.metadata.created) wf.metadata.created = new Date().toISOString().slice(0, 10);
    return wf;
  }

  function renderEdit(c, body) {
    cancelThumbs();
    if (!ST.draft) { c.openPanel('recipes'); return; }
    var d = ST.draft, wf = d.wf;
    var layer = c.targetImage();
    var wrap = c.h('<div class="sxr sxr-edit"></div>');
    body.appendChild(wrap);
    c.S.onRecipeFile = function (f) { importFile(c, f); };

    /* Preview: before and after on the current photo, with a draggable split. */
    var pv = c.h('<div class="sxr-compare" style="--split:50%"><canvas class="is-before" aria-hidden="true"></canvas><canvas class="is-after" aria-hidden="true"></canvas><i class="sxr-split" aria-hidden="true"></i>' +
      '<input type="range" min="0" max="100" value="50" aria-label="Compare before and after"><span class="sxr-tag is-l">Before</span><span class="sxr-tag is-r">After</span></div>');
    wrap.appendChild(pv);
    pv.querySelector('input').addEventListener('input', function (e) { pv.style.setProperty('--split', e.target.value + '%'); });
    var srcInfo = layer ? layerSource(c, layer, 520) : null;
    var src = srcInfo ? srcInfo.canvas : LE.fit(LE.sample('portrait'), 520);
    var bc = pv.querySelector('.is-before'), ac = pv.querySelector('.is-after');
    var base = layer ? baseLook(layer) : { adjust: {}, filter: null };
    LE.applySteps(src, R.lookSteps(base.adjust, base.filter)).then(function (res) {
      bc.width = res.canvas.width; bc.height = res.canvas.height;
      bc.getContext('2d').drawImage(res.canvas, 0, 0);
      pv.style.aspectRatio = res.canvas.width + ' / ' + res.canvas.height;
      release(res.canvas);
    });
    var pvToken = 0;
    var preview = c.debounce(function () {
      var t = ++pvToken;
      var v = R.validate(wf);
      if (!v.ok) return;
      LE.applySteps(bc.width ? bc : src, R.prepare(v.workflow, { intensity: strengthOf(v.workflow), allowSkip: true }).steps).then(function (res) {
        if (t !== pvToken) { release(res.canvas); return; }
        ac.width = res.canvas.width; ac.height = res.canvas.height;
        ac.getContext('2d').drawImage(res.canvas, 0, 0);
        release(res.canvas);
      });
    }, 140);

    var errBox = c.h('<p class="sxr-error" role="alert" hidden></p>');
    var saveBtn;
    function changed(noPreview) {
      var v = R.validate(wf);
      var msg = !wf.steps.length ? 'Add at least one step.' : (v.ok ? '' : v.errors[0]);
      errBox.hidden = !msg;
      errBox.textContent = msg;
      if (saveBtn) saveBtn.disabled = !!msg;
      if (!noPreview) preview();
    }

    /* Details */
    var form = c.h('<div class="sxr-form">' +
      '<label class="sxr-label">Name<input class="sx-input" data-k="name" maxlength="80" required></label>' +
      '<label class="sxr-label">Description<textarea class="sx-input sxr-textarea" data-k="description" rows="2" maxlength="400" placeholder="What it does, in a sentence"></textarea></label>' +
      '<div class="sxr-2"><label class="sxr-label">Category<select class="sx-input" data-k="category"></select></label>' +
      '<label class="sxr-label">Tags<input class="sx-input" data-k="tags" maxlength="200" placeholder="warm, film"></label></div></div>');
    wrap.appendChild(form);
    var nameIn = form.querySelector('[data-k=name]');
    nameIn.value = wf.metadata.name;
    nameIn.oninput = function () { wf.metadata.name = nameIn.value; changed(true); };
    var descIn = form.querySelector('[data-k=description]');
    descIn.value = wf.metadata.description || '';
    descIn.oninput = function () { wf.metadata.description = descIn.value; };
    var catIn = form.querySelector('[data-k=category]');
    [['personal', 'Yours']].concat(R.categories).forEach(function (cat) {
      var opt = document.createElement('option');
      opt.value = cat[0]; opt.textContent = cat[1];
      catIn.appendChild(opt);
    });
    catIn.value = R.categories.some(function (x) { return x[0] === wf.metadata.category; }) ? wf.metadata.category : 'personal';
    catIn.onchange = function () { wf.metadata.category = catIn.value; };
    var tagIn = form.querySelector('[data-k=tags]');
    tagIn.value = (wf.metadata.tags || []).join(', ');
    tagIn.oninput = function () { wf.metadata.tags = tagIn.value.split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean).slice(0, 8); };

    wrap.appendChild(c.ui.slider({
      label: 'Default strength', min: 0, max: 100, value: strengthOf(wf), reset: 100, fmt: function (v) { return Math.round(v) + '%'; },
      onInput: function (v) { wf.parameters[0].default = Math.round(v); preview(); }
    }));

    var covers = c.h('<fieldset class="sxr-covers"><legend>Cover photo <small>shown in the library</small></legend><div class="sxr-cover-row"></div></fieldset>');
    var crow = covers.querySelector('.sxr-cover-row');
    [''].concat(COVERS).forEach(function (id) {
      var b = c.h('<button type="button" class="sxr-cover" aria-pressed="' + ((wf.metadata.cover || '') === id) + '" aria-label="' + (id ? 'Cover ' + id : 'No cover') + '">' + (id ? '<img loading="lazy" alt="" src="' + root() + 'assets/photos/collage/' + id + '.jpg">' : '<span>None</span>') + '</button>');
      b.onclick = function () {
        if (id) wf.metadata.cover = id; else delete wf.metadata.cover;
        crow.querySelectorAll('.sxr-cover').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      };
      crow.appendChild(b);
    });
    wrap.appendChild(covers);

    /* Steps */
    var stepsSec = c.h('<section class="sxr-steps-sec"><div class="sxr-steps-head"><h3>Steps</h3><small>Run top to bottom. Drag to reorder.</small></div><ol class="sxr-steps"></ol></section>');
    wrap.appendChild(stepsSec);
    var ol = stepsSec.querySelector('ol');
    var open = d.open || {};
    d.open = open;
    function renderSteps() {
      ol.innerHTML = '';
      wf.steps.forEach(function (step, i) { ol.appendChild(stepRow(step, i)); });
      if (!wf.steps.length) ol.appendChild(c.h('<li class="sxr-steps-empty">No steps yet. Add one below.</li>'));
    }
    function move(from, to) {
      if (to < 0 || to >= wf.steps.length || from === to) return;
      var s = wf.steps.splice(from, 1)[0];
      wf.steps.splice(to, 0, s);
      renderSteps();
      changed();
      var row = ol.children[to];
      if (row) { var f = row.querySelector('[data-focus]'); if (f) f.focus(); }
    }
    function stepRow(step, i) {
      var live = R.isLive(step.operation, step.parameters);
      var li = c.h('<li class="sxr-step' + (step.enabled === false ? ' is-off' : '') + '" data-i="' + i + '">' +
        '<div class="sxr-step-row">' +
        '<button type="button" class="sxr-handle" aria-label="Drag to reorder ' + esc(step.label) + '">' + c.ic('menu') + '</button>' +
        '<label class="sxr-check"><input type="checkbox"' + (step.enabled === false ? '' : ' checked') + ' aria-label="Use ' + esc(step.label) + '"><i aria-hidden="true"></i></label>' +
        '<button type="button" class="sxr-step-main" data-focus aria-expanded="' + !!open[step.id] + '"><b>' + esc(step.label) + '</b><small>' + esc(summary(step)) + (live ? '' : ' · on export') + '</small></button>' +
        '<span class="sxr-chev" aria-hidden="true">' + c.ic('chev') + '</span></div></li>');
      li.querySelector('input[type=checkbox]').onchange = function (e) { step.enabled = e.target.checked; li.classList.toggle('is-off', !step.enabled); changed(); };
      li.querySelector('.sxr-step-main').onclick = function () { open[step.id] = !open[step.id]; renderSteps(); };
      dragHandle(li.querySelector('.sxr-handle'), li, i);
      if (open[step.id]) li.appendChild(stepBody(step, i, li));
      return li;
    }
    function stepBody(step, i, li) {
      var box = c.h('<div class="sxr-step-body"></div>');
      var lab = c.h('<label class="sxr-label">Label<input class="sx-input" maxlength="60"></label>');
      var labIn = lab.querySelector('input');
      labIn.value = step.label;
      labIn.oninput = function () { step.label = labIn.value || R.opLabel(step.operation); li.querySelector('.sxr-step-main b').textContent = step.label; };
      box.appendChild(lab);
      var spec = R.operations().filter(function (o) { return o.operation === step.operation; })[0];
      var keys = Object.keys(step.parameters || {});
      if (spec) spec.params.forEach(function (p) { if (keys.indexOf(p.key) < 0) keys.push(p.key); });
      keys.forEach(function (k) {
        var ps = R.paramSpec(step.operation, k);
        if (!ps) return;
        var val = step.parameters[k];
        function set(v) {
          step.parameters[k] = v;
          li.querySelector('.sxr-step-main small').textContent = summary(step) + (R.isLive(step.operation, step.parameters) ? '' : ' · on export');
          changed();
        }
        if (ps.type === 'number') {
          var dflt = ps.identity != null ? ps.identity : ps.min;
          var node = c.ui.slider({
            label: paramLabel(step.operation, k), min: ps.min, max: ps.max, step: ps.step, value: typeof val === 'number' ? val : dflt, reset: dflt,
            onInput: function (v) { set(Math.min(ps.max, Math.max(ps.min, Math.round(Math.round(v / ps.step) * ps.step * 10000) / 10000))); }
          });
          if (/Hue$/.test(k)) node.classList.add('sxr-hue');
          box.appendChild(node);
        } else if (ps.type === 'enum') {
          var sel = c.h('<label class="sxr-label">' + esc(paramLabel(step.operation, k)) + '<select class="sx-input"></select></label>');
          ps.options.forEach(function (opt) { var o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.querySelector('select').appendChild(o); });
          sel.querySelector('select').value = val || ps.options[0];
          sel.querySelector('select').onchange = function (e) { set(e.target.value); };
          box.appendChild(sel);
        } else if (ps.type === 'color') {
          var col = c.h('<label class="sxr-label sxr-color">' + esc(paramLabel(step.operation, k)) + '<input type="color"></label>');
          col.querySelector('input').value = /^#[0-9a-f]{6}$/i.test(val || '') ? val : '#ffffff';
          col.querySelector('input').oninput = function (e) { set(e.target.value); };
          box.appendChild(col);
        } else if (ps.type === 'boolean') {
          box.appendChild(c.ui.toggle(paramLabel(step.operation, k), !!val, function (v) { set(v); }));
        } else if (ps.type === 'text' || ps.type === 'font') {
          var tx = c.h('<label class="sxr-label">' + esc(paramLabel(step.operation, k)) + '<input class="sx-input"></label>');
          tx.querySelector('input').maxLength = ps.max || 80;
          tx.querySelector('input').value = val || '';
          tx.querySelector('input').oninput = function (e) { set(e.target.value); };
          box.appendChild(tx);
        }
      });
      if (!R.isLive(step.operation, step.parameters)) box.appendChild(c.h('<p class="sx-note">This step changes size or adds a frame, so it runs when you export or batch, not on the live photo.</p>'));
      var row = c.h('<div class="sxr-row"></div>');
      row.appendChild(btn(c, 'Up', 'chev', 'btn btn-ghost btn-sm sxr-up', function () { move(i, i - 1); }));
      row.appendChild(btn(c, 'Down', 'chev', 'btn btn-ghost btn-sm sxr-down', function () { move(i, i + 1); }));
      row.appendChild(btn(c, 'Delete step', 'trash', 'btn btn-ghost btn-sm', function () { wf.steps.splice(i, 1); renderSteps(); changed(); }));
      if (i === 0) row.querySelector('.sxr-up').disabled = true;
      if (i === wf.steps.length - 1) row.querySelector('.sxr-down').disabled = true;
      box.appendChild(row);
      return box;
    }
    function dragHandle(handle, li, from) {
      handle.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp') { e.preventDefault(); move(from, from - 1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); move(from, from + 1); }
      });
      handle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        li.classList.add('is-drag');
        var to = from;
        function onMove(ev) {
          var rows = [].slice.call(ol.children).filter(function (r) { return r !== li && r.classList.contains('sxr-step'); });
          var idx = 0;
          rows.forEach(function (r) { var b = r.getBoundingClientRect(); if (ev.clientY > b.top + b.height / 2) idx++; });
          to = idx;
          var ref = rows[idx] || null;
          if (li.nextSibling !== ref) ol.insertBefore(li, ref);
        }
        function onUp() {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          li.classList.remove('is-drag');
          if (to !== from) move(from, to); else renderSteps();
        }
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    }
    renderSteps();

    var add = c.h('<label class="sxr-add">' + c.ic('plus') + '<select aria-label="Add a step"><option value="">Add a step…</option></select></label>');
    var addSel = add.querySelector('select');
    var groups = { light: 'Light', color: 'Colour', effect: 'Effects', detail: 'Detail', output: 'Size and frame (on export)' };
    var ops = R.operations();
    Object.keys(groups).forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = groups[g];
      ops.filter(function (o) { return o.group === g; }).forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.operation; opt.textContent = o.label;
        og.appendChild(opt);
      });
      addSel.appendChild(og);
    });
    addSel.onchange = function () {
      var op = ops.filter(function (o) { return o.operation === addSel.value; })[0];
      addSel.value = '';
      if (!op) return;
      if (wf.steps.length >= R.limits.steps) { c.toast('A recipe can have up to ' + R.limits.steps + ' steps.'); return; }
      var params = {};
      op.params.forEach(function (p) { params[p.key] = p.default; });
      var id = R.slug(op.label, 30) || op.operation, n = 2, base0 = id;
      while (wf.steps.some(function (s) { return s.id === id; })) id = base0 + '-' + (n++);
      wf.steps.push({ id: id, operation: op.operation, label: op.label, description: '', enabled: true, parameters: params });
      open[id] = true;
      renderSteps();
      changed();
      var last = ol.lastElementChild;
      if (last) last.scrollIntoView({ block: 'nearest' });
    };
    stepsSec.appendChild(add);
    wrap.appendChild(errBox);

    var row2 = c.h('<div class="sxr-row sxr-edit-more"></div>');
    row2.appendChild(btn(c, 'Try on photo', 'image', 'btn btn-ghost btn-sm', function () {
      var cur = c.targetImage();
      if (!cur) { c.toast('Select a photo first.'); return; }
      var v = R.validate(draftForSave(c));
      if (!v.ok) { changed(); return; }
      d.tried = true;
      wf.metadata.id = v.workflow.metadata.id;
      applyFresh(c, cur, v.workflow);
    }));
    row2.appendChild(btn(c, 'Download', 'download', 'btn btn-ghost btn-sm', function () { download(c, draftForSave(c)); }));
    row2.appendChild(btn(c, 'Share…', 'share', 'btn btn-ghost btn-sm', function () { openShare(c, draftForSave(c)); }));
    wrap.appendChild(row2);
    var actions = c.h('<div class="sxr-edit-actions"></div>');
    actions.appendChild(btn(c, 'Cancel', null, 'btn btn-ghost', function () { ST.draft = null; c.openPanel('recipes'); }));
    saveBtn = btn(c, d.isNew ? 'Save recipe' : 'Save changes', 'save', 'btn btn-gold', function () {
      var wf2 = draftForSave(c);
      var v = R.validate(wf2);
      if (!v.ok) { changed(); return; }
      var saved;
      try { saved = LE.userRecipes.save(v.workflow); } catch (err) { c.toast(err.message); return; }
      ST.draft = null;
      ST.focus = saved.metadata.id;
      ST.cat = 'mine';
      c.toast('Saved “' + saved.metadata.name + '” on this device');
      c.openPanel('recipes', { recipe: saved.metadata.id });
    });
    actions.appendChild(saveBtn);
    wrap.appendChild(actions);
    changed();
  }
  var PARAM_LABEL = {
    value: 'Amount', amount: 'Amount', shadowHue: 'Shadow colour', shadowAmount: 'Shadow strength', highlightHue: 'Highlight colour',
    highlightAmount: 'Highlight strength', balance: 'Balance', black: 'Black point', white: 'White point', gamma: 'Midtones',
    intensity: 'Intensity', name: 'Filter', radius: 'Radius', maxWidth: 'Max width (px)', mode: 'Quality', padding: 'Padding', size: 'Border width',
    color: 'Colour', type: 'Type'
  };
  function paramLabel(op, k) { return PARAM_LABEL[k] || k; }

  /* ---------- Panel ---------- */
  P.recipes = {
    eyebrow: 'Shareable looks',
    title: function (c, o) { return o && o.view === 'edit' ? (ST.draft && !ST.draft.isNew ? 'Edit recipe' : 'New recipe') : 'Recipes'; },
    select: true,
    render: function (c, body, o) {
      o = o || {};
      if (o.view === 'edit') renderEdit(c, body); else renderList(c, body, o);
    },
    doc: function (c) {
      if (c.S.panelOpts && c.S.panelOpts.view === 'edit') return;
      var layer = c.targetImage();
      if (lookKey(layer) !== ST.lastLook) c.renderPanel(true);
    },
    close: function () { cancelThumbs(); }
  };
  hook('panel-close', function (c, id) { if (id === 'recipes' || id === 'apps') cancelThumbs(); });

  /* ---------- Apps → Batch ---------- */
  function renderBatch(c, body, o) {
    var layer = c.targetImage();
    var mine = LE.userRecipes.all();
    var cfg = ST.batchCfg = ST.batchCfg || { max: 2048, format: 'jpeg' };
    var source = o.recipe ? 'r:' + o.recipe : (cfg.source || (layer && hasLook(fullLook(layer)) ? 'look' : 'r:' + R.builtins[0].metadata.id));
    if (source.indexOf('r:') === 0 && !findRecipe(c, source.slice(2))) source = 'r:' + R.builtins[0].metadata.id;
    var wrap = c.h('<div class="sxr sxr-batch"></div>');
    body.appendChild(wrap);
    wrap.appendChild(c.h('<p class="sxr-lead">Apply a recipe to many photos at once. They are processed one by one on this device and saved as a zip.</p>'));
    var pick = c.h('<label class="sxr-label">Look<select class="sx-input"></select></label>');
    var sel = pick.querySelector('select');
    var optLook = document.createElement('option');
    optLook.value = 'look'; optLook.textContent = 'This photo’s current look';
    if (!layer || !hasLook(fullLook(layer))) optLook.disabled = true;
    sel.appendChild(optLook);
    [['Yours', mine], ['From LocalEditor', R.builtins]].forEach(function (g) {
      if (!g[1].length) return;
      var og = document.createElement('optgroup');
      og.label = g[0];
      g[1].forEach(function (wf) { var opt = document.createElement('option'); opt.value = 'r:' + wf.metadata.id; opt.textContent = wf.metadata.name; og.appendChild(opt); });
      sel.appendChild(og);
    });
    var ho = c.S.handoffRecipe;
    if (ho && !sel.querySelector('option[value="r:' + ho.metadata.id + '"]')) {
      var oh = document.createElement('option'); oh.value = 'r:' + ho.metadata.id; oh.textContent = ho.metadata.name; sel.insertBefore(oh, sel.children[1]);
    }
    sel.value = source;
    wrap.appendChild(pick);
    var strengthBox = c.h('<div></div>');
    wrap.appendChild(strengthBox);
    var info = c.h('<p class="sx-note"></p>');
    wrap.appendChild(info);
    var strength = null;
    function paint() {
      source = sel.value;
      cfg.source = source;
      strengthBox.innerHTML = '';
      var wf = source.indexOf('r:') === 0 ? findRecipe(c, source.slice(2)) : null;
      if (wf) {
        strength = strengthOf(wf);
        strengthBox.appendChild(c.ui.slider({ label: 'Strength', min: 0, max: 100, value: strength, reset: strengthOf(wf), fmt: function (v) { return Math.round(v) + '%'; }, onInput: function (v) { strength = v; } }));
        info.textContent = wf.steps.filter(function (s) { return s.enabled !== false; }).map(function (s) { return s.label; }).join(' → ');
      } else {
        strength = null;
        info.textContent = 'Uses the adjustments and filter of the selected photo.';
      }
    }
    sel.onchange = paint;
    paint();
    wrap.appendChild(c.ui.seg([['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']], cfg.format, function (v) { cfg.format = v; }, 'sx-seg-sm'));
    wrap.appendChild(c.ui.slider({ label: 'Longest edge', min: 512, max: 6000, step: 64, value: cfg.max, fmt: function (v) { return v + ' px'; }, onInput: function (v) { cfg.max = v; } }));
    var drop = c.h('<button type="button" class="sxr-dropzone">' + c.ic('batch') + '<b>Choose photos</b><small>or drop them here · up to 200</small></button>');
    drop.onclick = function () { if (!(ST.batch && ST.batch.running)) c.pickFiles('batch'); };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-drop'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-drop'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); drop.classList.remove('is-drop');
      start([].slice.call(e.dataTransfer.files || []));
    });
    wrap.appendChild(drop);
    var prog = c.h('<div class="sxr-progress" hidden><div class="sxr-bar"><i></i></div><div class="sxr-progress-row"><span aria-live="polite"></span><button type="button" class="btn btn-ghost btn-sm">Cancel</button></div></div>');
    wrap.appendChild(prog);
    var result = c.h('<div class="sxr-result" hidden></div>');
    wrap.appendChild(result);
    /* Device support: LE.support explains first when the verdict for batch is not ok (invisible when it is). */
    function start(files) {
      if (ST.batch && ST.batch.running) return;
      if (!(window.LE && LE.support && LE.support.gate)) { startNow(files); return; }
      LE.support.gate('studio.recipes', { title: 'Batch edit', run: function () { return startNow(files); } }).catch(function (err) { c.toast((err && err.message) || 'The batch could not start.'); });
    }
    function startNow(files) {
      if (ST.batch && ST.batch.running) return;
      var wf = source.indexOf('r:') === 0 ? findRecipe(c, source.slice(2)) : null;
      var steps;
      if (wf) steps = R.prepare(wf, { intensity: strength, allowSkip: true }).steps;
      else {
        var cur = c.targetImage();
        var lk = cur ? fullLook(cur) : { adjust: {}, filter: null };
        steps = R.lookSteps(lk.adjust, lk.filter);
      }
      var label = wf ? wf.metadata.id : 'my-look';
      result.hidden = true;
      prog.hidden = false;
      var bar = prog.querySelector('i'), text = prog.querySelector('span');
      var job = runBatch(files, { steps: steps, max: cfg.max, format: cfg.format, quality: 0.88, label: label }, function (i, n, name) {
        bar.style.width = (i / n * 100) + '%';
        text.textContent = i + ' of ' + n + ' · ' + name;
      });
      prog.querySelector('button').onclick = function () { job.cancel(); };
      job.done.then(function (r) {
        prog.hidden = true;
        result.hidden = false;
        result.innerHTML = '';
        if (!r.count) { result.appendChild(c.h('<p class="sxr-error">' + esc(r.cancelled ? 'Stopped before any photo was finished.' : 'None of those files could be read as photos.') + '</p>')); return; }
        if (window.LE && LE.support && LE.support.reportSuccess) LE.support.reportSuccess('studio.recipes');
        result.appendChild(c.h('<p class="sxr-done"><b>' + r.count + ' photo' + (r.count === 1 ? '' : 's') + ' ready</b> · ' + c.fmtBytes(r.zip.size) + (r.failed.length ? ' · ' + r.failed.length + ' skipped' : '') + (r.cancelled ? ' · stopped early' : '') + '</p>'));
        var dl = btn(c, 'Download zip', 'download', 'btn btn-gold sxr-wide', function () { c.download(r.zip, r.name); });
        result.appendChild(dl);
        c.download(r.zip, r.name);
      });
    }
    c.S.onBatchFiles = start;
  }
  /* Processes files one at a time and releases every canvas before the next one. */
  function runBatch(files, cfg, onProgress) {
    var list = (files || []).filter(function (f) { return f && (!f.type || /^image\//.test(f.type)); }).slice(0, 200);
    var state = { running: true, cancelled: false };
    ST.batch = state;
    var out = [], failed = [], names = {}, bytes = 0, i = 0;
    var ext = cfg.format === 'jpeg' ? 'jpg' : cfg.format;
    function name(f) {
      var b = String(f.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'photo';
      var n = b + '-' + cfg.label.slice(0, 32), k = n, j = 2;
      while (names[k]) k = n + '-' + (j++);
      names[k] = 1;
      return k + '.' + ext;
    }
    function step() {
      if (state.cancelled || i >= list.length || bytes > 450 * 1024 * 1024) return null;
      var f = list[i++];
      if (onProgress) onProgress(i, list.length, f.name || 'photo');
      return LE.load(f).then(function (full) {
        var small = LE.fit(full, cfg.max);
        release(full);
        return LE.applySteps(small, cfg.steps).then(function (res) { if (res.canvas !== small) release(small); return res.canvas; });
      }).then(function (canvas) {
        return LE.exportImage(canvas, { format: cfg.format, quality: cfg.quality }).then(function (blob) { release(canvas); return blob.arrayBuffer(); });
      }).then(function (buf) {
        bytes += buf.byteLength;
        out.push({ name: name(f), data: new Uint8Array(buf) });
      }).catch(function () { failed.push(f.name || 'photo'); }).then(function () {
        return new Promise(function (res) { setTimeout(res, 0); });
      }).then(step);
    }
    var done = Promise.resolve().then(step).then(function () {
      state.running = false;
      var zip = out.length ? LE.zip(out) : null;
      var r = { count: out.length, failed: failed, cancelled: state.cancelled, zip: zip, name: (cfg.label || 'localeditor') + '-' + out.length + '-photos.zip', names: out.map(function (x) { return x.name; }) };
      out = null;
      state.result = r;
      return r;
    });
    return { done: done, cancel: function () { state.cancelled = true; } };
  }
  (function wrapApps() {
    var spec = P.apps;
    if (!spec || typeof spec.render !== 'function') return;
    var orig = spec.render;
    spec.render = function (c, body, o) {
      if (o && o.app === 'batch') {
        if (!o.back) c.S.panelOpts.back = 'apps';
        return renderBatch(c, body, o);
      }
      return orig.apply(this, arguments);
    };
  })();

  /* A small API for other modules and tests. */
  window.LEStudioRecipes = {
    apply: function (c, layerId, wf, strength) { var l = c.L(layerId); return l ? applyFresh(c, l, wf, strength) : null; },
    remove: function (c, layerId) { var l = c.L(layerId); if (l) removeFrom(c, l); },
    baseLook: baseLook,
    applied: marker,
    share: openShare,
    importText: importText,
    runBatch: runBatch,
    edit: function (c, wf) { openEditor(c, wf ? { wf: clone(wf), isNew: !LE.userRecipes.get(wf.metadata.id) } : newFromLook(fullLook(c.targetImage()), null)); },
    lastBatch: function () { return ST.batch; }
  };
})();
