/* LocalEditor: studio subject cut-out (background remover, Beta) and the thumbnail kit.
 *
 * Document: an image layer gets `cutout: { asset, enabled, model, feather, refine, version, outline }` (le-objects.js applies
 * it before crop and adjust). The mask is an ordinary project asset named "background-removal-mask.png" (white, alpha = mask),
 * so it is saved, exported in .leproject and restored like any photo; the original photo is never changed.
 *
 * Runtime: assets/js/le-bgremove.js is loaded with LE.lazy only when someone asks for a cut-out.
 *
 * window.LEStudioCutout:
 *   run(layerId?, { model }) -> Promise<{ asset, coverage, timings } | null>     one-tap cut-out of a photo layer (one undo step)
 *   cancel()                                                                   stops a running cut-out; the document is untouched
 *   state()                                                                    { running, stage, fraction, error, model, last, brush }
 *   setModel(id) / model()                                                     the model the next run uses (remembered on this device)
 *   refine(layerId?, { mode }) / brush: { stroke(points, opts), undo(), redo(), done(), cancel(), set({ mode, size, hard }) }
 *   putOn(layerId, 'transparent' | 'color' | 'blur', color?)                   backdrop behind the subject, as normal layers
 *   storeMask(canvas) -> Promise<assetId>                                      adds a mask image to the design's assets
 *   isMask(metaOrName)                                                         true for generated mask assets
 *   thumbnail: { layouts(), build(opts) -> Promise<doc>, create(opts) -> Promise }   the thumbnail kit (Apps -> Thumbnail)
 */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  function hook(n, f) { (H[n] = H[n] || []).push(f); }

  var me = (document.currentScript && document.currentScript.src) || location.href;
  var ROOT = new URL('../../', me).href;
  var MASK_NAME = 'background-removal-mask.png';
  var BACKDROP = 'Cut-out backdrop';
  var MODEL_KEY = 'le-cutout-model';
  var studio = null;

  var ICONS = {
    cutout: '<path d="M8.5 4.5c-2 0-3.5 1.6-3.5 3.6 0 1.5.9 2.6 1.8 3.4L5 20.5h3l1.3-4.2h5.4l1.3 4.2h3l-1.8-9c.9-.8 1.8-1.9 1.8-3.4 0-2-1.5-3.6-3.5-3.6-1.4 0-2.6.8-3.5 2-.9-1.2-2.1-2-3.5-2z" stroke-dasharray="2.4 2.2"/>',
    restore: '<path d="M12 20.5a8.5 8.5 0 1 1 8.5-8.5"/><path d="M12 8v8M8 12h8"/>',
    erase: '<path d="M7 20.5h11M4.8 14.6l9.5-10.1a1.8 1.8 0 0 1 2.6 0l3 3a1.8 1.8 0 0 1 0 2.6L11.2 20.5H8.2z"/>',
    soft: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2.6"/><circle cx="12" cy="12" r="3.5"/>',
    thumb: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>'
  };

  var ST = { model: lsGet(MODEL_KEY, null), rec: null, engineMissing: true, run: null, error: null, last: null, checks: {}, cached: {}, unloadT: 0 };
  var BR = null;

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function el(c, html) { return c.h(html); }
  function mb(n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; }
  function isMask(x) { var n = typeof x === 'string' ? x : (x && x.name) || ''; return /^background-removal-mask/.test(n); }
  function remover() {
    if (LE.bgRemove && LE.bgRemove.shared) return Promise.resolve(LE.bgRemove);
    return LE.lazy(ROOT + 'assets/js/le-bgremove.js').then(function () {
      if (!LE.bgRemove) throw new Error('The background remover could not load.');
      return LE.bgRemove;
    });
  }
  function kOf(c) { var d = c.doc(); return Math.max(d.width, d.height) / 1080; }
  function refresh(c) {
    c = c || studio;
    if (!c) return;
    if (c.S.panel === 'cutout') c.renderPanel(true);
    else if ((c.S.panel === 'adjust' || c.S.panel === 'effects')) c.renderPanel(true);
    c.renderToolbar();
  }
  function scheduleUnload(ms) {
    clearTimeout(ST.unloadT);
    ST.unloadT = setTimeout(function () { if (!ST.run && LE.bgRemove) LE.bgRemove.unload(); }, ms);
  }

  /* ---------- masks as assets ---------- */
  function storeMask(c, canvas) {
    c = c || studio;
    return LE.toBlob(canvas, 'image/png').then(function (blob) {
      return LE.project.putAsset({ blob: blob, name: MASK_NAME, type: 'image/png', width: canvas.width, height: canvas.height });
    }).then(function (meta) {
      c.mem[meta.id] = { meta: meta, canvas: canvas };
      c.scene.addAsset(meta.id, canvas);
      if (c.S.project) c.S.project.assets[meta.id] = meta;
      return meta.id;
    });
  }
  /* A working copy of a stored mask as a canvas whose alpha is the mask (opaque greyscale masks are converted). */
  function maskWorkCopy(src) {
    var w = src.width, h = src.height;
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var o = out.getContext('2d');
    o.drawImage(src, 0, 0);
    var img = o.getImageData(0, 0, w, h), d = img.data, opaque = true, i;
    for (i = 3; i < d.length; i += 4) if (d[i] < 255) { opaque = false; break; }
    if (opaque) {
      for (i = 0; i < d.length; i += 4) { var a = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a; }
      o.putImageData(img, 0, 0);
    }
    return out;
  }
  function cutoutSpec(base, patch) {
    return Object.assign({ asset: '', enabled: true, model: '', feather: 0, refine: 'guided', version: 1, outline: null }, base || {}, patch || {});
  }

  /* ---------- running a cut-out ---------- */
  function errorCopy(code) {
    return ({
      'no-subject': ['No clear subject found', 'This works best with one person, pet or object that stands out from the background. Nothing was changed. You can cut it out by hand with the brush.'],
      memory: ['Not enough memory', 'This device ran out of memory, even after trying a smaller size. Close other tabs or apps and try again, or use the Fast model.'],
      offline: ['You are offline', 'The background remover has not been downloaded on this device yet. Connect once to download it; after that it works offline.'],
      download: ['Download did not finish', 'The model could not be downloaded. Check your connection and try again.'],
      unsupported: ['Not supported in this browser', 'This browser cannot run the background remover.'],
      engine: ['The cut-out stopped', 'Something went wrong while removing the background. Nothing was changed.']
    })[code] || ['The cut-out stopped', 'Something went wrong. Nothing was changed.'];
  }
  function stageText(p) {
    if (!p) return 'Getting ready…';
    if (p.stage === 'running') return 'Finding the subject…';
    if (p.stage === 'starting' || p.cached) return 'Getting ready…';
    if (p.total) return 'Downloading · ' + Math.max(0, Math.round((p.loaded || 0) / 1e6)) + ' of ' + Math.max(1, Math.round(p.total / 1e6)) + ' MB';
    return 'Getting ready…';
  }
  function run(c, layerId, opts) {
    c = c || studio;
    opts = opts || {};
    var l = layerId ? c.L(layerId) : c.one();
    if (!l || l.type !== 'image') { c.toast('Select a photo first.'); return Promise.resolve(null); }
    var mem = c.mem[l.src];
    if (!mem || !mem.canvas) { c.toast('This photo is still loading.'); return Promise.resolve(null); }
    if (ST.run) return Promise.resolve(null);
    if (BR) endRefine(c, true);
    var model = opts.model || chosen();
    clearTimeout(ST.unloadT);
    ST.error = null;
    var ac = new AbortController();
    var job = ST.run = { layerId: l.id, src: l.src, model: model, abort: ac, stage: 'Preparing…', fraction: 0, indeterminate: true, t0: performance.now() };
    var ran = false;
    refresh(c);
    return remover().then(function (bg) {
      var info = bg.model(model);
      return bg.gate(model, {
        title: 'Remove background',
        force: opts.force,
        run: function () {
          ran = true;
          if (ac.signal.aborted) { var e0 = new Error('Cancelled'); e0.name = 'AbortError'; throw e0; }
          return bg.cutout(mem.canvas, {
            model: model, signal: ac.signal,
            onProgress: function (p) {
              job.stage = stageText(p, info);
              job.indeterminate = p.stage === 'running' || p.stage === 'starting' || p.cached;
              job.fraction = p.fraction || 0;
              paintProgress();
            }
          });
        }
      });
    }).then(function (res) {
      if (!ran || !res || !res.mask) { ST.run = null; refresh(c); return null; }
      var cur = c.L(job.layerId);
      if (!cur || cur.src !== job.src) { ST.run = null; refresh(c); return null; }
      return storeMask(c, res.mask).then(function (assetId) {
        ST.run = null;
        var now = c.L(job.layerId);
        if (!now) { refresh(c); return null; }
        c.patch(job.layerId, { cutout: cutoutSpec({ outline: (now.cutout && now.cutout.outline) || null, feather: (now.cutout && now.cutout.feather) || 0 }, { asset: assetId, enabled: true, model: model, refine: 'guided' }) });
        ST.last = { model: model, coverage: res.coverage, wallMs: Math.round(performance.now() - job.t0), inferMs: Math.round(res.timings.inferMs || 0), maxSide: res.maxSide, size: [res.width, res.height], retried: res.retried };
        if (opts.model) { ST.model = model; lsSet(MODEL_KEY, model); }
        scheduleUnload(90000);
        refresh(c);
        if (!opts.quiet) c.toast('Background removed', { action: { label: 'Undo', fn: function () { c.scene.undo(); } } });
        return { asset: assetId, coverage: res.coverage, timings: res.timings };
      });
    }).catch(function (err) {
      ST.run = null;
      scheduleUnload(30000);
      if (err && (err.name === 'AbortError' || err.code === 'cancelled')) {
        if (!opts.quiet) c.toast('Cancelled. Nothing changed.');
      } else {
        ST.error = { layerId: job.layerId, model: model, code: (err && err.code) || 'engine', message: (err && err.message) || '', coverage: err && err.coverage };
      }
      refresh(c);
      return null;
    });
  }
  function cancel() {
    if (ST.run) ST.run.abort.abort();
  }
  function paintProgress() {
    var job = ST.run;
    var node = document.getElementById('sxc-progress');
    if (!job || !node) return;
    node.querySelector('.sxc-stage').textContent = job.stage;
    var bar = node.querySelector('.sxc-bar');
    bar.classList.toggle('is-busy', !!job.indeterminate);
    bar.firstChild.style.width = job.indeterminate ? '' : Math.round(job.fraction * 100) + '%';
  }

  /* ---------- backdrops ("put it on") ---------- */
  function sameBox(a, b) { return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5; }
  function backdropsOf(c, l) {
    return c.scene.layers().filter(function (x) { return x.name === BACKDROP && x.id !== l.id && sameBox(x, l); });
  }
  function putOn(c, layerId, kind, color) {
    c = c || studio;
    var l = c.L(layerId);
    if (!l || l.type !== 'image') return null;
    var made = null;
    c.batch(function () {
      var old = backdropsOf(c, l).map(function (x) { return x.id; });
      if (old.length) c.scene.remove(old);
      var geo = { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation || 0, name: BACKDROP };
      if (kind === 'color') {
        made = c.scene.add(Object.assign(geo, { type: 'shape', shape: 'rect', radius: l.radius || 0, fill: { type: 'solid', color: color || '#F2D594' } }));
      } else if (kind === 'blur') {
        var adj = Object.assign({}, l.adjust || {}, { blur: Math.max(10, Math.round(Math.max(l.w, l.h) / 60)), brightness: (l.adjust && l.adjust.brightness) || -6 });
        made = c.scene.add(Object.assign(geo, { type: 'image', src: l.src, crop: l.crop, flipX: l.flipX, flipY: l.flipY, radius: l.radius || 0, mask: l.mask || 'none', adjust: adj, filter: l.filter || null }));
      }
      if (made) {
        var idx = c.scene.layers().map(function (x) { return x.id; }).indexOf(l.id);
        c.scene.order(made, Math.max(0, idx));
      }
      c.scene.select([l.id]);
    });
    return made;
  }

  /* ---------- panel ---------- */
  /* ---------- the option chooser (plain words; built from the LE.bgRemove registry only) ---------- */
  function chosen() { return ST.model || ST.rec || 'u2netp'; }
  function deviceWord(c) { return c.isPhone() ? 'phone' : (LE.device && LE.device.tier && LE.device.tier() === 'desktop') ? 'computer' : 'device'; }
  function verdict(c, r) {
    if (!r) return ['', ''];
    var d = deviceWord(c);
    if (r.status === 'ok') return ['ok', 'Works well on this ' + d];
    if (r.status === 'limited') return ['warn', 'May be slow on this ' + d];
    if (r.status === 'unsupported') return ['err', /memory|RAM|GB|computer/i.test((r.reasons || []).join(' ')) ? 'Needs a computer' : 'Not supported in this browser'];
    return ['', ''];
  }
  /* Whole MB the first use downloads: the option itself plus the shared engine (about 2.9 MB compressed) when missing. */
  function mbOf(m, engineMissing) { return Math.max(1, Math.round(((m.bytes || (m.downloadMB || 0) * 1e6) + (engineMissing ? 2.9e6 : 0)) / 1e6)); }
  function dlLine(m, engineMissing, ready) {
    if (ready) return 'Ready on this device';
    var n = mbOf(m, engineMissing);
    return (n < 15 ? 'Small download' : 'Larger download') + ' · ' + n + ' MB, one time';
  }
  function meter(m) {
    var max = m.qualityMax === 5 ? 5 : 3, q = Math.max(1, Math.min(max, m.quality || 1)), dots = '';
    for (var i = 1; i <= max; i++) dots += '<i' + (i <= q ? ' class="on"' : '') + '></i>';
    return '<span class="sxc-q" role="img" aria-label="Quality: ' + m.qualityLabel + '"><span class="sxc-dots" aria-hidden="true">' + dots + '</span>' + m.qualityLabel + '</span>';
  }
  /* Checks, cache state and the recommendation, then fn(models, bg). */
  function survey(fn) {
    return remover().then(function (bg) {
      var list = bg.models().filter(function (m) { return m.listed; });
      return Promise.all(list.map(function (m) {
        return Promise.all([bg.support(m.id), bg.isCached(m.id)]).then(function (r) { ST.checks[m.id] = r[0]; ST.cached[m.id] = r[1]; });
      })).then(function () { return bg.downloadSize(list[0].id); }).then(function (size) {
        var st = {};
        list.forEach(function (m) { st[m.id] = ST.checks[m.id] && ST.checks[m.id].status; });
        ST.rec = bg.recommend({ checks: st, cached: ST.cached, people: false });
        ST.engineMissing = !!size.engine;
        if (ST.model && !list.some(function (m) { return m.id === ST.model; })) ST.model = null;
        fn(list, bg);
      });
    });
  }
  function optionCards(c, host, list, bg, onPick) {
    host.innerHTML = '';
    list.forEach(function (m) {
      var ready = !!ST.cached[m.id], v = verdict(c, ST.checks[m.id]), a = m.about || {};
      var card = el(c, '<div class="sxc-opt" data-model="' + c.esc(m.id) + '"><button type="button" class="sxc-pick" role="radio" aria-checked="' + (m.id === chosen()) + '">' +
        (m.example ? '<img class="sxc-ex" src="' + c.esc(new URL(m.example, ROOT).href) + '" alt="" width="144" height="70" loading="lazy" decoding="async">' : '') +
        '<span class="sxc-otext"><span class="sxc-ohead"><b>' + c.esc(m.label) + '</b>' + (m.id === ST.rec ? '<span class="sxc-rec">Recommended for you</span>' : '') + '</span>' +
        '<span class="sxc-obest">' + c.esc(m.bestFor) + '</span>' +
        '<span class="sxc-ometa">' + meter(m) + '<span class="sxc-speed">' + c.esc(m.speedLabel) + '</span></span>' +
        '<span class="sxc-odl' + (ready ? ' is-ready' : '') + '">' + c.esc(dlLine(m, ST.engineMissing, ready)) + '</span>' +
        (v[1] ? '<span class="sxc-verdict is-' + v[0] + '">' + c.esc(v[1]) + '</span>' : '') + '</span></button>' +
        '<div class="sxc-orow"></div></div>');
      var row = card.querySelector('.sxc-orow');
      card.querySelector('.sxc-pick').onclick = function () {
        ST.model = m.id; lsSet(MODEL_KEY, m.id);
        host.querySelectorAll('.sxc-pick').forEach(function (b) { b.setAttribute('aria-checked', String(b.parentNode === card)); });
        if (onPick) onPick(m);
      };
      var chk = ST.checks[m.id];
      if (chk && chk.status === 'unsupported' && chk.canForce) {
        row.appendChild(btn(c, 'Try anyway', null, 'sxc-link', function () { ST.model = m.id; lsSet(MODEL_KEY, m.id); run(c, (c.targetImage() || {}).id, { model: m.id, force: true }); }));
      }
      if (ready) {
        row.appendChild(btn(c, 'Remove from this device', null, 'sxc-link', function () {
          bg.remove(m.id).then(function () { ST.cached[m.id] = false; c.toast(m.label + ' removed from this device'); refresh(c); });
        }));
      }
      var about = el(c, '<details class="sxc-about"><summary>About this option</summary><dl>' +
        (a.model ? '<dt>Model</dt><dd>' + c.esc(a.model) + '</dd>' : '') + (a.licence ? '<dt>Licence</dt><dd>' + c.esc(a.licence) + '</dd>' : '') +
        '<dt>Download</dt><dd>' + (m.bytes ? (m.bytes / 1048576).toFixed(1) + ' MB (' + m.bytes.toLocaleString('en') + ' bytes)' : m.downloadMB + ' MB') + '</dd>' +
        '<dt>Memory while running</dt><dd>about ' + (m.memoryMB >= 1000 ? (m.memoryMB / 1000).toFixed(1) + ' GB' : m.memoryMB + ' MB') + '</dd>' +
        '<dt>Engine</dt><dd>' + (m.runtime === 'webgpu' ? 'ONNX Runtime Web, WebGPU' : 'ONNX Runtime Web, WebAssembly') + '</dd>' +
        (a.source ? '<dt>Source</dt><dd>' + c.esc(a.source) + '</dd>' : '') + (a.notes ? '<dt>Notes</dt><dd>' + c.esc(a.notes) + '</dd>' : '') +
        (chk && chk.reasons && chk.reasons.length ? '<dt>This device</dt><dd>' + c.esc(chk.reasons.join(' ')) + '</dd>' : '') + '</dl></details>');
      row.appendChild(about);
      host.appendChild(card);
    });
  }
  function askCopy(c, m, ready) {
    if (ready) return 'Ready on this device. It works offline, and your photo stays on this device.';
    var n = mbOf(m, ST.engineMissing);
    return 'This downloads ' + (n < 15 ? 'a small helper' : 'a larger helper') + ' once (' + n + ' MB) and then works offline. Your photo stays on this device.';
  }
  function firstUseNote(c, node, id) {
    survey(function (list) {
      if (!node.isConnected) return;
      var m = list.filter(function (x) { return x.id === (id || chosen()); })[0] || list[0];
      node.textContent = askCopy(c, m, !!ST.cached[m.id]);
    }).catch(function () {});
  }
  function renderStart(c, body, img) {
    var err = ST.error && ST.error.layerId === img.id ? ST.error : null;
    if (err) {
      var copy = errorCopy(err.code);
      var card = el(c, '<div class="sxc-alert" role="alert"><strong>' + c.esc(copy[0]) + '</strong><p>' + c.esc(err.code === 'unsupported' && err.message ? err.message : copy[1]) + '</p><div class="sxc-alert-act"></div></div>');
      var act = card.querySelector('.sxc-alert-act');
      if (err.code === 'no-subject') {
        act.appendChild(btn(c, 'Cut out by hand', 'brush', 'btn btn-sm', function () { beginRefine(c, img.id, { manual: true }); }));
        if (err.model !== 'u2net-int8' && ST.checks['u2net-int8'] && ST.checks['u2net-int8'].status === 'ok') act.appendChild(btn(c, 'Try More detail', 'sparkle', 'btn btn-ghost btn-sm', function () { run(c, img.id, { model: 'u2net-int8' }); }));
      } else if (err.code === 'memory') {
        act.appendChild(btn(c, 'Try again', 'reset', 'btn btn-sm', function () { run(c, img.id); }));
        if (err.model !== 'u2netp') act.appendChild(btn(c, 'Use Quick', 'sparkle', 'btn btn-ghost btn-sm', function () { run(c, img.id, { model: 'u2netp' }); }));
      } else if (err.code !== 'unsupported') {
        act.appendChild(btn(c, 'Try again', 'reset', 'btn btn-sm', function () { run(c, img.id); }));
      }
      body.appendChild(card);
    }
    var ask = el(c, '<div class="sxc-ask"><h3>Remove the background? <span class="sxc-beta">Beta</span></h3><p class="sxc-ask-p sxc-first">Works best with one clear subject.</p></div>');
    var go = btn(c, 'Remove background', 'cutout', 'btn btn-gold sx-block sxc-go', function () { run(c, img.id); });
    ask.appendChild(go);
    body.appendChild(ask);
    var other = el(c, '<details class="sxc-other"><summary>Other quality options</summary><div class="sxc-models" role="radiogroup" aria-label="Quality options"><p class="sx-note">Checking this device…</p></div></details>');
    if (lsGet('le-cutout-other', false)) other.open = true;
    other.addEventListener('toggle', function () { lsSet('le-cutout-other', other.open); });
    body.appendChild(other);
    var row = el(c, '<div class="sxc-more"></div>');
    row.appendChild(btn(c, 'Cut out by hand', 'brush', 'btn btn-ghost btn-sm', function () { beginRefine(c, img.id, { manual: true }); }));
    body.appendChild(row);
    var host = other.querySelector('.sxc-models');
    var p = ask.querySelector('.sxc-ask-p');
    function paint(m) {
      var ready = !!ST.cached[m.id];
      p.textContent = askCopy(c, m, ready);
      go.querySelector('span').textContent = ready ? 'Remove background' : 'Download and remove';
      var v = ST.checks[m.id];
      go.disabled = !!(v && v.status === 'unsupported' && !v.canForce);
    }
    survey(function (list, bg) {
      if (!host.isConnected) return;
      optionCards(c, host, list, bg, paint);
      paint(list.filter(function (m) { return m.id === chosen(); })[0] || list[0]);
    }).catch(function () {
      if (host.isConnected) host.innerHTML = '<p class="sx-note is-warn">The background remover could not load. Check your connection and reopen this panel.</p>';
    });
  }
  function renderRunning(c, body) {
    var job = ST.run;
    var node = el(c, '<div class="sxc-progress" id="sxc-progress" aria-live="polite"><div class="sxc-run-art">' + c.ic('cutout') + '</div><p class="sxc-stage"></p><div class="sxc-bar"><i></i></div></div>');
    body.appendChild(node);
    var cancelBtn = btn(c, 'Cancel', 'x', 'btn sx-block', function () { cancel(); });
    body.appendChild(cancelBtn);
    body.appendChild(el(c, '<p class="sx-note">Runs on this device. Your photo is not uploaded. Cancel leaves your design as it was.</p>'));
    paintProgress();
    void job;
  }
  function btn(c, label, icon, cls, fn) {
    var b = el(c, '<button type="button" class="' + (cls || 'btn btn-ghost btn-sm') + '">' + (icon ? c.ic(icon) : '') + '<span>' + c.esc(label) + '</span></button>');
    if (fn) b.onclick = fn;
    return b;
  }
  var OUTLINE_COLORS = ['#FFFFFF', '#17131F', '#FFD43B', '#FF4D6D', '#2F6BFF', '#17A37A'];
  var BACK_COLORS = ['#FFD43B', '#FF4D6D', '#2F6BFF', '#17131F', '#F2EFE9', '#17A37A'];
  function renderDone(c, body, img) {
    var cut = img.cutout;
    var id = img.id;
    var k = kOf(c);
    var head = el(c, '<div class="sxc-donehead"><span class="sxc-beta">Beta</span><span class="sx-note">' + c.esc(modelName(cut.model)) + '</span></div>');
    body.appendChild(head);
    body.appendChild(c.ui.seg([['cut', 'Cut-out'], ['orig', 'Original']], cut.enabled === false ? 'orig' : 'cut', function (v) {
      c.patch(id, { cutout: { enabled: v === 'cut' } });
    }, 'sxc-seg'));
    var tools = el(c, '<div class="sxc-tools"></div>');
    tools.appendChild(btn(c, 'Refine edges', 'brush', 'btn sxc-refine', function () { beginRefine(c, id); }));
    body.appendChild(tools);
    var others = el(c, '<div class="sxc-retry"></div>');
    body.appendChild(others);
    remover().then(function (bg) {
      bg.models().filter(function (m) { return m.listed && m.id !== cut.model; }).forEach(function (m) {
        var chk = ST.checks[m.id];
        var p = chk ? Promise.resolve(chk) : bg.support(m.id).then(function (r) { ST.checks[m.id] = r; return r; });
        p.then(function (r) {
          if (!others.isConnected || r.status !== 'ok') return;
          others.appendChild(btn(c, 'Try ' + m.label, null, 'btn btn-ghost btn-sm', function () { run(c, id, { model: m.id }); }));
        });
      });
    });

    var s1 = c.ui.section('Edges');
    s1.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Feather', min: 0, max: 30, value: Math.round((cut.feather || 0) / k), onInput: function (v, key) { c.patch(id, { cutout: { feather: v * k } }, key); } }));
    body.appendChild(s1);

    var s2 = c.ui.section('Outline');
    var b2 = s2.querySelector('.sx-sec-body');
    var ol = cut.outline || { width: 0, color: '#FFFFFF' };
    b2.appendChild(c.ui.slider({ label: 'Thickness', min: 0, max: 40, value: Math.round((ol.width || 0) / k), onInput: function (v, key) {
      var cur = c.L(id);
      var color = (cur.cutout && cur.cutout.outline && cur.cutout.outline.color) || '#FFFFFF';
      c.patch(id, { cutout: { outline: v ? { width: v * k, color: color } : null } }, key);
    } }));
    var chips = el(c, '<div class="sx-chips sxc-colors" role="group" aria-label="Outline colour"></div>');
    OUTLINE_COLORS.forEach(function (col) {
      var b = el(c, '<button type="button" class="sx-chip-color" aria-label="Outline ' + col + '" aria-pressed="' + (!!cut.outline && cut.outline.color.toUpperCase() === col) + '" style="background:' + col + '"></button>');
      b.onclick = function () { var cur = c.L(id); var w = cur.cutout.outline ? cur.cutout.outline.width : 8 * k; c.patch(id, { cutout: { outline: { width: w, color: col } } }); c.renderPanel(true); };
      chips.appendChild(b);
    });
    var more = el(c, '<button type="button" class="sx-chip-color is-more" aria-label="More outline colours">' + c.ic('plus') + '</button>');
    more.onclick = function () {
      c.colorPop(more, { value: ol.color, title: 'Outline colour', onChange: function (v, key) { var cur = c.L(id); var w = cur.cutout.outline ? cur.cutout.outline.width : 8 * k; c.patch(id, { cutout: { outline: { width: w, color: v } } }, key); } });
    };
    chips.appendChild(more);
    b2.appendChild(chips);
    b2.appendChild(c.ui.toggle('Soft shadow', !!img.shadow, function (on) {
      c.patch(id, { shadow: on ? { color: 'rgba(15,12,20,.45)', blur: 28 * k, x: 0, y: 14 * k } : null });
    }, 'Follows the subject’s shape'));
    body.appendChild(s2);

    var s3 = c.ui.section('Put it on');
    var b3 = s3.querySelector('.sx-sec-body');
    var has = backdropsOf(c, img)[0];
    var kind = !has ? 'transparent' : has.type === 'image' ? 'blur' : 'color';
    var row = el(c, '<div class="sxc-put" role="group" aria-label="Backdrop"></div>');
    [['transparent', 'Transparent'], ['blur', 'Blurred photo'], ['color', 'Colour']].forEach(function (o) {
      var b = el(c, '<button type="button" class="sx-chip" aria-pressed="' + (kind === o[0]) + '">' + o[1] + '</button>');
      b.onclick = function () { putOn(c, id, o[0], o[0] === 'color' ? (has && has.fill && has.fill.color) || BACK_COLORS[0] : null); c.renderPanel(true); };
      row.appendChild(b);
    });
    b3.appendChild(row);
    if (kind === 'color') {
      var bc = el(c, '<div class="sx-chips sxc-colors" role="group" aria-label="Backdrop colour"></div>');
      BACK_COLORS.forEach(function (col) {
        var b = el(c, '<button type="button" class="sx-chip-color" aria-label="Backdrop ' + col + '" aria-pressed="' + (has.fill && has.fill.color && has.fill.color.toUpperCase() === col) + '" style="background:' + col + '"></button>');
        b.onclick = function () { c.patch(has.id, { fill: { type: 'solid', color: col } }); c.renderPanel(true); };
        bc.appendChild(b);
      });
      b3.appendChild(bc);
    }
    var pg = btn(c, 'Page background…', 'background', 'btn btn-ghost btn-sm', function () { c.openPanel('background'); });
    b3.appendChild(pg);
    body.appendChild(s3);

    var foot = el(c, '<div class="sx-row-between sxc-foot"></div>');
    foot.appendChild(btn(c, 'Remove cut-out', 'trash', 'btn btn-ghost btn-sm', function () { c.patch(id, { cutout: null }); c.renderPanel(true); }));
    body.appendChild(foot);
    body.appendChild(el(c, '<p class="sx-note">Your original photo is untouched. Show the original at any time, or refine the edges with the brush.</p>'));
  }
  function modelName(id) {
    if (id === 'manual') return 'Cut out by hand';
    var m = LE.bgRemove && LE.bgRemove.model(id);
    return m ? m.label + ' quality' : 'Cut-out';
  }
  P.cutout = {
    title: 'Remove background', eyebrow: 'Beta · on this device', select: true,
    render: function (c, body) {
      var img = c.targetImage();
      if (!img || !c.S.project) {
        body.appendChild(c.ui.empty('Select a photo', 'Tap a photo on the canvas to remove its background.', [{ label: c.S.project ? 'Add a photo' : 'Open photo', gold: true, fn: function () { c.pickFiles('add'); } }]));
        return;
      }
      if (ST.run && ST.run.layerId === img.id) renderRunning(c, body);
      else if (img.cutout) renderDone(c, body, img);
      else renderStart(c, body, img);
    },
    doc: function (c, body) { void body; if (!ST.run) c.renderPanel(true); }
  };

  /* Entry cards in Edit photo and Effects. */
  function entryCard(c, img) {
    var card = el(c, '<div class="sxc-entry"></div>');
    if (img.cutout) {
      card.appendChild(el(c, '<div class="sxc-entry-txt"><b>Cut-out <span class="sxc-beta">Beta</span></b><small>' + (img.cutout.enabled === false ? 'Showing the original' : 'Background removed') + '</small></div>'));
      card.appendChild(btn(c, 'Options', 'cutout', 'btn btn-sm', function () { c.openPanel('cutout'); }));
    } else {
      card.appendChild(el(c, '<div class="sxc-entry-txt"><b>Remove background <span class="sxc-beta">Beta</span></b><small>One tap, on this device</small></div>'));
      card.appendChild(btn(c, ST.run ? 'Working…' : 'Remove', 'cutout', 'btn btn-sm', function () { quick(c, img.id); }));
    }
    return card;
  }
  ['adjust', 'effects'].forEach(function (pid) {
    var spec = P[pid];
    if (!spec || spec._cutout) return;
    var orig = spec.render;
    spec.render = function (c, body, o) {
      orig.call(this, c, body, o);
      var img = pid === 'adjust' ? c.targetImage() : c.one();
      if (!img || img.type !== 'image' || !c.S.project) return;
      var card = entryCard(c, img);
      var at = pid === 'adjust' ? body.querySelector('.sx-quick') : null;
      if (at && at.nextSibling) body.insertBefore(card, at.nextSibling);
      else body.insertBefore(card, body.firstChild);
    };
    spec._cutout = true;
  });

  /* One tap: run straight away when the model is already on this device, otherwise explain the download first. */
  function quick(c, layerId) {
    var l = c.L(layerId);
    if (!l || l.type !== 'image') return Promise.resolve(null);
    if (l.cutout || ST.run) { c.openPanel('cutout'); return Promise.resolve(null); }
    c.scene.select([layerId]);
    c.openPanel('cutout');
    return remover().then(function (bg) { return survey(function () {}).then(function () { return bg.isCached(chosen()); }); }).then(function (have) {
      if (have) return run(c, layerId);
      return null;
    }).catch(function () { return null; });
  }

  CMDS.cutout = function (c) { var l = c.one(); if (l && l.type === 'image') quick(c, l.id); else c.openPanel('cutout'); };
  CMDS.cutBrush = function (c, arg) { if (BR) { BR.mode = arg === 'restore' ? 'restore' : 'erase'; c.renderToolbar(); } };
  CMDS.cutSoft = function (c) { if (BR) { BR.hard = !BR.hard; c.renderToolbar(); } };
  CMDS.cutUndo = function () { brushUndo(); };
  CMDS.cutRedo = function () { brushRedo(); };
  CMDS.cutCancel = function (c) { endRefine(c, false); };
  CMDS.cutDone = function (c) { endRefine(c, true); };

  hook('photo-tools', function (c, l) {
    if (!l || l.type !== 'image') return '';
    var label = l.cutout ? 'Cut-out' : 'Remove BG';
    return '<button type="button" class="sx-tb has-text sxc-tb" data-cmd="cutout" aria-label="' + (l.cutout ? 'Cut-out options' : 'Remove background (Beta)') + '" title="' + (l.cutout ? 'Cut-out options' : 'Remove background (Beta)') + '"' + (l.cutout ? ' aria-pressed="true"' : '') + '>' + c.ic('cutout') + '<span>' + label + '</span></button>';
  });

  /* ---------- refine brush ---------- */
  function beginRefine(c, layerId, opts) {
    c = c || studio;
    opts = opts || {};
    var l = c.L(layerId);
    if (!l || l.type !== 'image' || BR || ST.run) return false;
    var mem = c.mem[l.src];
    if (!mem || !mem.canvas) return false;
    var work;
    var stored = l.cutout && c.mem[l.cutout.asset] && c.mem[l.cutout.asset].canvas;
    if (stored && !opts.manual) work = maskWorkCopy(stored);
    else {
      var cap = 2048, s = Math.min(1, cap / Math.max(mem.canvas.width, mem.canvas.height));
      work = document.createElement('canvas');
      work.width = Math.max(1, Math.round(mem.canvas.width * s)); work.height = Math.max(1, Math.round(mem.canvas.height * s));
      var wx = work.getContext('2d');
      wx.fillStyle = '#fff'; wx.fillRect(0, 0, work.width, work.height);
    }
    var prev = document.createElement('canvas');
    prev.width = work.width; prev.height = work.height;
    BR = {
      c: c, id: l.id, orig: l.cutout ? JSON.parse(JSON.stringify(l.cutout)) : null, work: work, wctx: work.getContext('2d'), prev: prev,
      mode: opts.mode || (l.cutout && !opts.manual ? 'restore' : 'erase'), size: lsGet('le-cutout-brush', 48), hard: false,
      undo: [], redo: [], dirty: !!opts.manual, key: 'cutout-live-' + Date.now().toString(36), pointers: {}, stroke: null, pinch: null, ghost: null,
      panelWas: c.S.panel
    };
    c.scene.addAsset(BR.key, work);
    c.scene._patch(l.id, { cutout: cutoutSpec(l.cutout, { asset: BR.key, enabled: true, model: l.cutout ? l.cutout.model : 'manual', refine: l.cutout ? l.cutout.refine : 'none' }) });
    c.scene._mark();
    buildGhostSource(mem.canvas);
    mountOverlay(c);
    if (c.isPhone() && c.S.panel) c.closePanel();
    c.renderToolbar();
    c.toast(c.isPhone() ? 'Paint to erase or restore · pinch to zoom' : 'Paint to erase or restore · scroll to zoom · [ ] size');
    return true;
  }
  function buildGhostSource(src) {
    var s = Math.min(1, 1024 / Math.max(src.width, src.height));
    var g = document.createElement('canvas');
    g.width = Math.max(1, Math.round(src.width * s)); g.height = Math.max(1, Math.round(src.height * s));
    g.getContext('2d').drawImage(src, 0, 0, g.width, g.height);
    var comp = document.createElement('canvas');
    comp.width = g.width; comp.height = g.height;
    BR.ghost = { src: g, comp: comp };
    refreshGhost();
  }
  function refreshGhost() {
    if (!BR || !BR.ghost) return;
    var g = BR.ghost, x = g.comp.getContext('2d');
    x.globalCompositeOperation = 'copy';
    x.drawImage(g.src, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(BR.work, 0, 0, g.comp.width, g.comp.height);
    x.globalCompositeOperation = 'source-over';
  }
  function mountOverlay(c) {
    var host = c.E.sceneEl;
    var ov = document.createElement('div');
    ov.className = 'sxc-brush';
    ov.setAttribute('aria-label', 'Refine the cut-out: paint to erase or restore');
    var cv = document.createElement('canvas');
    ov.appendChild(cv);
    var bar = document.createElement('div');
    bar.className = 'sxc-brushbar';
    bar.innerHTML = '<button type="button" class="btn btn-sm" data-cmd="cutCancel">' + c.ic('x') + '<span>Cancel</span></button><span class="sxc-brushbar-t">Refine</span><button type="button" class="btn btn-gold btn-sm" data-cmd="cutDone">' + c.ic('check') + '<span>Done</span></button>';
    bar.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    bar.addEventListener('click', function (e) { var b = e.target.closest('[data-cmd]'); if (b) { e.stopPropagation(); c.cmd(b.getAttribute('data-cmd')); } });
    ov.appendChild(bar);
    host.appendChild(ov);
    var rootEl = document.getElementById('sx');
    if (rootEl) rootEl.classList.add('is-cutbrush');
    BR.ov = ov; BR.cv = cv;
    /* The overlay sits inside the scene element: keep its events away from the scene's own handlers. */
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'mousedown', 'dblclick', 'click'].forEach(function (t) {
      ov.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    ov.addEventListener('pointerdown', onDown);
    ov.addEventListener('pointermove', onMove);
    ov.addEventListener('pointerup', onUp);
    ov.addEventListener('pointercancel', onUp);
    ov.addEventListener('pointerleave', function () { if (BR) { BR.hover = null; drawOverlay(); } });
    ov.addEventListener('wheel', function (e) { e.stopPropagation(); onWheel(e); }, { passive: false });
    ov.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    sizeOverlay();
  }
  function sizeOverlay() {
    if (!BR || !BR.cv) return;
    var r = BR.ov.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    BR.cv.width = Math.max(1, Math.round(r.width * dpr)); BR.cv.height = Math.max(1, Math.round(r.height * dpr));
    BR.dpr = dpr;
    drawOverlay();
  }
  function view() { return BR.c.scene.view(); }
  function drawOverlay() {
    if (!BR || !BR.cv) return;
    var x = BR.cv.getContext('2d'), v = view(), l = BR.c.scene._find(BR.id);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, BR.cv.width, BR.cv.height);
    if (!l) return;
    x.setTransform(BR.dpr, 0, 0, BR.dpr, 0, 0);
    var g = BR.ghost && BR.ghost.comp;
    if (g) {
      x.save();
      x.translate(v.panX + (l.x + l.w / 2) * v.zoom, v.panY + (l.y + l.h / 2) * v.zoom);
      x.rotate((l.rotation || 0) * Math.PI / 180);
      if (l.flipX || l.flipY) x.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
      var cr = l.crop || { x: 0, y: 0, w: 1, h: 1 };
      x.globalAlpha = 0.32;
      x.drawImage(g, cr.x * g.width, cr.y * g.height, Math.max(1, cr.w * g.width), Math.max(1, cr.h * g.height), -l.w / 2 * v.zoom, -l.h / 2 * v.zoom, l.w * v.zoom, l.h * v.zoom);
      x.globalAlpha = 1;
      x.lineWidth = 1;
      x.setLineDash([5, 4]);
      x.strokeStyle = 'rgba(116,87,240,.85)';
      x.strokeRect(-l.w / 2 * v.zoom, -l.h / 2 * v.zoom, l.w * v.zoom, l.h * v.zoom);
      x.restore();
    }
    if (BR.hover) {
      x.beginPath();
      x.arc(BR.hover.x, BR.hover.y, BR.size / 2, 0, Math.PI * 2);
      x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.95)'; x.stroke();
      x.lineWidth = 1; x.strokeStyle = BR.mode === 'erase' ? 'rgba(180,35,24,.95)' : 'rgba(27,127,84,.95)'; x.stroke();
    }
  }
  function local(e) { var r = BR.ov.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function toMask(px, py) {
    var v = view(), l = BR.c.scene._find(BR.id);
    var wx = (px - v.panX) / v.zoom, wy = (py - v.panY) / v.zoom;
    var cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = (l.rotation || 0) * Math.PI / 180;
    var dx = wx - cx, dy = wy - cy;
    var lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
    var u = lx / l.w + 0.5, vv = ly / l.h + 0.5;
    if (l.flipX) u = 1 - u;
    if (l.flipY) vv = 1 - vv;
    var cr = l.crop || { x: 0, y: 0, w: 1, h: 1 }, W = BR.work.width, Hh = BR.work.height;
    return { x: (cr.x + u * cr.w) * W, y: (cr.y + vv * cr.h) * Hh, k: (cr.w * W) / l.w / v.zoom };
  }
  function stamp(m, r) {
    var x = BR.wctx;
    x.save();
    x.globalCompositeOperation = BR.mode === 'erase' ? 'destination-out' : 'source-over';
    if (BR.hard) { x.fillStyle = '#fff'; }
    else {
      var gr = x.createRadialGradient(m.x, m.y, r * 0.45, m.x, m.y, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
    }
    x.beginPath(); x.arc(m.x, m.y, r, 0, Math.PI * 2); x.fill();
    x.restore();
    var s = BR.stroke;
    if (s) { s.x0 = Math.min(s.x0, m.x - r); s.y0 = Math.min(s.y0, m.y - r); s.x1 = Math.max(s.x1, m.x + r); s.y1 = Math.max(s.y1, m.y + r); }
  }
  function strokeTo(p) {
    var m = toMask(p.x, p.y), r = Math.max(1, BR.size / 2 * m.k), s = BR.stroke;
    if (s.last) {
      var dx = m.x - s.last.x, dy = m.y - s.last.y, d = Math.hypot(dx, dy), step = Math.max(1, r * 0.3);
      for (var t = step; t < d; t += step) stamp({ x: s.last.x + dx * t / d, y: s.last.y + dy * t / d }, r);
    }
    stamp(m, r);
    s.last = m;
    BR.dirty = true;
    liveUpdate();
  }
  var liveRaf = 0;
  function liveUpdate() {
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(function () {
      liveRaf = 0;
      if (!BR) return;
      var rec = BR.c.scene._assets[BR.key];
      if (rec) { rec._cutOf = null; rec._cutAlpha = null; }
      BR.c.scene._scheduleImage(BR.id);
      refreshGhost();
      drawOverlay();
    });
  }
  function startStroke(p) {
    var px = BR.prev.getContext('2d');
    px.globalCompositeOperation = 'copy';
    px.drawImage(BR.work, 0, 0);
    BR.stroke = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, last: null };
    strokeTo(p);
  }
  function region(s) {
    var W = BR.work.width, Hh = BR.work.height;
    var x0 = Math.max(0, Math.floor(s.x0) - 2), y0 = Math.max(0, Math.floor(s.y0) - 2), x1 = Math.min(W, Math.ceil(s.x1) + 2), y1 = Math.min(Hh, Math.ceil(s.y1) + 2);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  function endStroke(revert) {
    var s = BR.stroke;
    BR.stroke = null;
    if (!s) return;
    var r = region(s);
    if (!r) return;
    var before = BR.prev.getContext('2d').getImageData(r.x, r.y, r.w, r.h);
    if (revert) { BR.wctx.putImageData(before, r.x, r.y); liveUpdate(); return; }
    BR.undo.push({ r: r, data: before });
    if (BR.undo.length > 30) BR.undo.shift();
    BR.redo = [];
    BR.c.renderToolbar();
  }
  function swapRegion(from, to) {
    var e = from.pop();
    if (!e) return;
    var now = BR.wctx.getImageData(e.r.x, e.r.y, e.r.w, e.r.h);
    BR.wctx.putImageData(e.data, e.r.x, e.r.y);
    to.push({ r: e.r, data: now });
    BR.dirty = true;
    liveUpdate();
    BR.c.renderToolbar();
  }
  function brushUndo() { if (BR) swapRegion(BR.undo, BR.redo); }
  function brushRedo() { if (BR) swapRegion(BR.redo, BR.undo); }
  function pinchState() {
    var ids = Object.keys(BR.pointers);
    if (ids.length < 2) return null;
    var a = BR.pointers[ids[0]], b = BR.pointers[ids[1]];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  function onDown(e) {
    if (!BR) return;
    e.preventDefault();
    try { BR.ov.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = local(e);
    BR.pointers[e.pointerId] = p;
    if (Object.keys(BR.pointers).length >= 2) {
      if (BR.stroke) endStroke(true);
      var ps = pinchState(), v = view();
      BR.pinch = { d0: ps.d, z0: v.zoom, doc: { x: (ps.mid.x - v.panX) / v.zoom, y: (ps.mid.y - v.panY) / v.zoom } };
      return;
    }
    if (e.button === 1 || e.button === 2) { BR.pan = { x: p.x, y: p.y, v: view() }; return; }
    startStroke(p);
  }
  function onMove(e) {
    if (!BR) return;
    var p = local(e);
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') { BR.hover = p; }
    if (BR.pointers[e.pointerId]) BR.pointers[e.pointerId] = p;
    if (BR.pinch) {
      var ps = pinchState();
      if (!ps) return;
      var z = Math.max(0.05, Math.min(8, BR.pinch.z0 * ps.d / BR.pinch.d0));
      BR.c.scene.setView(z, ps.mid.x - BR.pinch.doc.x * z, ps.mid.y - BR.pinch.doc.y * z);
      drawOverlay();
      return;
    }
    if (BR.pan) {
      BR.c.scene.setView(BR.pan.v.zoom, BR.pan.v.panX + p.x - BR.pan.x, BR.pan.v.panY + p.y - BR.pan.y);
      drawOverlay();
      return;
    }
    if (BR.stroke) {
      var ev = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (ev.length > 1) ev.forEach(function (ce) { strokeTo(local(ce)); });
      else strokeTo(p);
    } else drawOverlay();
  }
  function onUp(e) {
    if (!BR) return;
    delete BR.pointers[e.pointerId];
    if (BR.pinch) { if (Object.keys(BR.pointers).length < 2) BR.pinch = null; return; }
    if (BR.pan) { BR.pan = null; return; }
    if (BR.stroke) endStroke(false);
  }
  function onWheel(e) {
    if (!BR) return;
    e.preventDefault();
    var v = view(), p = local(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      var z = Math.max(0.05, Math.min(8, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      var dx = (p.x - v.panX) / v.zoom, dy = (p.y - v.panY) / v.zoom;
      BR.c.scene.setView(z, p.x - dx * z, p.y - dy * z);
    } else BR.c.scene.setView(v.zoom, v.panX - e.deltaX, v.panY - e.deltaY);
    drawOverlay();
  }
  function setBrush(o) {
    if (!BR || !o) return;
    if (o.mode) BR.mode = o.mode === 'restore' ? 'restore' : 'erase';
    if (o.size) { BR.size = Math.max(4, Math.min(240, o.size)); lsSet('le-cutout-brush', BR.size); }
    if (o.hard != null) BR.hard = !!o.hard;
    BR.c.renderToolbar();
    drawOverlay();
  }
  /* Programmatic stroke (tests and agents): points in document units. */
  function strokeDoc(points, o) {
    if (!BR || !points || !points.length) return;
    if (o) setBrush(o);
    var v = view();
    var scr = points.map(function (pt) { return { x: v.panX + pt[0] * v.zoom, y: v.panY + pt[1] * v.zoom }; });
    startStroke(scr[0]);
    scr.slice(1).forEach(strokeTo);
    endStroke(false);
  }
  function unbrushRoot() { var r = document.getElementById('sx'); if (r) r.classList.remove('is-cutbrush'); }
  function endRefine(c, keep) {
    c = c || studio;
    var b = BR;
    if (!b) return Promise.resolve(null);
    BR = null;
    if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
    if (b.ov) b.ov.remove();
    unbrushRoot();
    var l = c.scene._find(b.id);
    if (l) {
      c.scene._patch(b.id, { cutout: b.orig ? JSON.parse(JSON.stringify(b.orig)) : null });
      c.scene._mark();
    }
    function cleanup() {
      delete c.scene._assets[b.key];
      c.renderToolbar();
      if (!c.isPhone() || b.panelWas === 'cutout') { if (c.scene._find(b.id)) { c.scene.select([b.id]); c.openPanel('cutout'); } }
    }
    if (!keep || !b.dirty || !l) { cleanup(); return Promise.resolve(null); }
    return storeMask(c, b.work).then(function (assetId) {
      if (c.scene._find(b.id)) {
        c.patch(b.id, { cutout: cutoutSpec(b.orig || { model: 'manual', refine: 'none' }, { asset: assetId, enabled: true }) });
      }
      cleanup();
      return assetId;
    });
  }

  hook('toolbar', function (c) {
    if (!BR) return null;
    function tb(cmd, icon, label, o) {
      o = o || {};
      return '<button type="button" class="sx-tb' + (o.text ? ' has-text' : '') + (o.cls ? ' ' + o.cls : '') + '" data-cmd="' + cmd + '" aria-label="' + c.esc(label) + '" title="' + c.esc(o.title || label) + '"' + (o.pressed != null ? ' aria-pressed="' + !!o.pressed + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + c.ic(icon) + (o.text ? '<span>' + c.esc(o.short || label) + '</span>' : '') + '</button>';
    }
    return tb('cutBrush:erase', 'erase', 'Erase', { text: true, pressed: BR.mode === 'erase', title: 'Erase (E)' }) +
      tb('cutBrush:restore', 'restore', 'Restore', { text: true, pressed: BR.mode === 'restore', title: 'Restore (R)' }) +
      '<label class="sxc-size" title="Brush size ([ and ])"><span>Size</span><input type="range" id="sxc-size" min="6" max="200" step="1" value="' + Math.round(BR.size) + '" aria-label="Brush size"></label>' +
      tb('cutSoft', 'soft', 'Soft edge', { text: true, short: 'Soft', pressed: !BR.hard }) +
      '<span class="sx-tb-sep" aria-hidden="true"></span>' +
      tb('cutUndo', 'undo', 'Undo stroke', { disabled: !BR.undo.length, title: 'Undo stroke (Ctrl+Z)' }) + tb('cutRedo', 'redo', 'Redo stroke', { disabled: !BR.redo.length }) +
      '<span class="sx-grow"></span>' + tb('cutCancel', 'x', 'Cancel', { text: true, cls: 'sxc-wide' }) + tb('cutDone', 'check', 'Done', { text: true, cls: 'is-primary sxc-wide' });
  });
  hook('key', function (c, e) {
    if (!BR) return false;
    var t = e.target;
    if (t && /INPUT|TEXTAREA/.test(t.tagName) && t.id !== 'sxc-size') return false;
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) brushRedo(); else brushUndo(); return true; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); brushRedo(); return true; }
    if (k === '[') { setBrush({ size: BR.size / 1.25 }); return true; }
    if (k === ']') { setBrush({ size: BR.size * 1.25 }); return true; }
    if (k === 'e' || k === 'E') { setBrush({ mode: 'erase' }); return true; }
    if (k === 'r' || k === 'R') { setBrush({ mode: 'restore' }); return true; }
    if (k === 'Enter') { e.preventDefault(); endRefine(c, true); return true; }
    if (k === 'Delete' || k === 'Backspace' || /^Arrow/.test(k) || mod) { e.preventDefault(); return true; }
    return false;
  });
  hook('escape', function (c) { if (BR) { endRefine(c, false); return true; } return false; });
  hook('zoom', function () { if (BR) drawOverlay(); });
  hook('resize', function () { if (BR) sizeOverlay(); });
  hook('page', function (c) { if (BR) endRefine(c, false); if (ST.run) cancel(); });
  hook('history', function (c) {
    if (!BR) return;
    var l = c.scene._find(BR.id);
    if (!l || !l.cutout || l.cutout.asset !== BR.key) { var b = BR; BR = null; if (b.ov) b.ov.remove(); unbrushRoot(); delete c.scene._assets[b.key]; c.renderToolbar(); }
  });
  hook('select', function (c, ids) {
    if (BR && (ids.length !== 1 || ids[0] !== BR.id)) endRefine(c, true);
  });
  hook('panel-close', function (c, id) { if (id === 'cutout' && !ST.run) scheduleUnload(20000); });
  hook('init', function (c) {
    studio = c;
    Object.keys(ICONS).forEach(function (k) { if (c.I && !c.I[k]) c.I[k] = ICONS[k]; });
    c.E.tool.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'sxc-size' && BR) { BR.size = Number(e.target.value) || BR.size; lsSet('le-cutout-brush', BR.size); drawOverlay(); }
    });
    if (window.ResizeObserver) new ResizeObserver(function () { if (BR) sizeOverlay(); }).observe(c.E.sceneEl);
  });

  /* =====================================================================================================================
   * Thumbnail kit (Apps -> Thumbnail): photo -> cut-out with outline -> one of eight 1280x720 layouts, as editable layers.
   * ===================================================================================================================== */
  var TW = 1280, TH = 720;
  /* Headline presets: heavy display faces, 2-4 words, a dark stroke and a hard drop so they read at 320 px wide. */
  var LAYOUTS = [
    { id: 'bold-right', name: 'Bold left, subject right', bg: { type: 'color', color: '#14121A' }, subject: { side: 'right', h: 1.06 }, accent: 'bar', text: { x: 56, y: 120, w: 640, size: 132, font: 'Anton', color: '#FFFFFF', stroke: '#000000', accent: '#FFD43B', align: 'left' } },
    { id: 'bold-left', name: 'Subject left, bold right', bg: { type: 'gradient', kind: 'linear', angle: 135, colors: ['#FF4D6D', '#7457F0'] }, subject: { side: 'left', h: 1.06 }, accent: 'none', text: { x: 600, y: 140, w: 630, size: 128, font: 'Anton', color: '#FFFFFF', stroke: '#14121A', align: 'right' } },
    { id: 'behind', name: 'Big word behind', bg: { type: 'color', color: '#FFD43B' }, subject: { side: 'center', h: 0.8 }, accent: 'none', text: { x: 30, y: 26, w: 1220, size: 280, font: 'Anton', color: '#14121A', stroke: null, align: 'center', behind: true, lines: 1 } },
    { id: 'blurred', name: 'Blurred scene', bg: { type: 'blur' }, subject: { side: 'right', h: 1.04 }, accent: 'shade', text: { x: 56, y: 150, w: 620, size: 136, font: 'Anton', color: '#FFD43B', stroke: '#000000', align: 'left' } },
    { id: 'split', name: 'Colour block', bg: { type: 'color', color: '#F2EFE9' }, subject: { side: 'right', h: 1.02 }, accent: 'block', text: { x: 44, y: 150, w: 560, size: 120, font: 'Archivo Black', color: '#FFFFFF', stroke: null, align: 'left', accent: '#2F6BFF', lines: 3 } },
    { id: 'burst', name: 'Circle pop', bg: { type: 'gradient', kind: 'linear', angle: 90, colors: ['#0F2A5C', '#2F6BFF'] }, subject: { side: 'right', h: 1.0 }, accent: 'circle', text: { x: 56, y: 140, w: 600, size: 126, font: 'Bebas Neue', color: '#FFFFFF', stroke: '#0F2A5C', align: 'left', accent: '#FFD43B' } },
    { id: 'banner', name: 'Bottom banner', bg: { type: 'gradient', kind: 'linear', angle: 180, colors: ['#1B7F54', '#0E3B2A'] }, subject: { side: 'center', h: 0.98 }, accent: 'banner', text: { x: 40, y: 556, w: 1200, size: 104, font: 'Anton', color: '#FFFFFF', stroke: null, align: 'center', accent: '#FF4D6D', lines: 1 } },
    { id: 'badge', name: 'Badge corner', bg: { type: 'color', color: '#FFFFFF' }, subject: { side: 'left', h: 1.04 }, accent: 'badge', text: { x: 620, y: 200, w: 620, size: 140, font: 'Anton', color: '#14121A', stroke: null, align: 'left', accent: '#FF4D6D' } }
  ];
  function words(s) { return String(s || '').trim().split(/\s+/).filter(Boolean); }
  function breakHeadline(text, lines) {
    var w = words(text);
    if (lines === 1 || w.length <= 1) return w.join(' ');
    if (w.length === 2) return w.join('\n');
    if (lines === 3 && w.length >= 3) {
      var a = Math.ceil(w.length / 3), b = Math.ceil((w.length - a) / 2);
      return [w.slice(0, a).join(' '), w.slice(a, a + b).join(' '), w.slice(a + b).join(' ')].filter(Boolean).join('\n');
    }
    var half = Math.ceil(w.length / 2);
    return w.slice(0, half).join(' ') + '\n' + w.slice(half).join(' ');
  }
  function textBox(spec, text) {
    var n = String(text).split('\n').length;
    return Math.ceil(n * spec.size * 0.98 * 1.06 + 8);
  }
  var measureCtx = null;
  function fitSize(spec, text) {
    /* Measure the widest line in the real face (loaded first by thumbFonts) so long words shrink instead of wrapping. */
    var lines = String(text).toUpperCase().split('\n'), widest = 0;
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    var family = LE.fonts && LE.fonts.css ? LE.fonts.css(spec.font) : '"' + spec.font + '", sans-serif';
    measureCtx.font = '400 100px ' + family;
    lines.forEach(function (ln) { widest = Math.max(widest, measureCtx.measureText(ln).width + (/Bebas/.test(spec.font) ? ln.length * 2 : 0)); });
    var est = /Archivo/.test(spec.font) ? 82 : /Bebas/.test(spec.font) ? 42 : 50;
    var longest = Math.max.apply(null, lines.map(function (x) { return x.length; }).concat([1]));
    if (!(widest > 0) || !(document.fonts && document.fonts.check && document.fonts.check('100px ' + family))) widest = Math.max(widest, longest * est);
    return Math.max(40, Math.min(spec.size, Math.floor(spec.w * 0.94 / widest * 100)));
  }
  function thumbFonts() {
    if (!LE.fonts || !LE.fonts.load) return Promise.resolve();
    return Promise.all(['Anton', 'Archivo Black', 'Bebas Neue'].map(function (f) { return LE.fonts.load(f, 400).catch(function () {}); }));
  }
  function subjectBox(c, layout, photo, maskCanvas) {
    /* Place by the subject's own bounds (from the mask) so the person, not the whole photo, lands where the layout wants it. */
    var b = maskBounds(maskCanvas);
    var pw = photo.width, ph = photo.height;
    var sx = b.x / maskCanvas.width * pw, sy = b.y / maskCanvas.height * ph, sw = b.w / maskCanvas.width * pw, sh = b.h / maskCanvas.height * ph;
    var targetH = TH * layout.subject.h;
    var scale = targetH / Math.max(1, sh);
    var maxW = layout.subject.side === 'center' ? TW * 0.9 : TW * 0.56;
    if (sw * scale > maxW) scale = maxW / sw;
    var w = pw * scale, h = ph * scale;
    var subjW = sw * scale;
    var left;
    if (layout.subject.side === 'right') left = TW - subjW - TW * 0.03;
    else if (layout.subject.side === 'left') left = TW * 0.03;
    else left = (TW - subjW) / 2;
    var x = left - sx * scale;
    var y = TH - (sy + sh) * scale + (b.touchesBottom ? 0 : -TH * 0.04);
    if (b.touchesBottom) y = TH - (sy + sh) * scale + 2;
    return { x: x, y: y, w: w, h: h };
  }
  function maskBounds(m) {
    var s = Math.min(1, 256 / Math.max(m.width, m.height));
    var w = Math.max(1, Math.round(m.width * s)), h = Math.max(1, Math.round(m.height * s));
    var t = document.createElement('canvas'); t.width = w; t.height = h;
    var x = t.getContext('2d'); x.drawImage(m, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) if (d[(yy * w + xx) * 4 + 3] > 96) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    if (x1 < 0) return { x: 0, y: 0, w: m.width, h: m.height, touchesBottom: true };
    return { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s, touchesBottom: y1 >= h - 3 };
  }
  /* Build the page document for one layout. opts: { photo: assetId, mask: assetId, headline, outline } */
  function buildThumb(c, layoutId, opts) {
    c = c || studio;
    var lay = LAYOUTS.filter(function (x) { return x.id === layoutId; })[0] || LAYOUTS[0];
    var photo = c.mem[opts.photo] && c.mem[opts.photo].canvas;
    var mask = opts.mask && c.mem[opts.mask] && c.mem[opts.mask].canvas;
    if (!photo) throw new Error('Pick a photo first.');
    var layers = [];
    var bg = lay.bg.type === 'blur' ? { type: 'color', color: '#14121A' } : JSON.parse(JSON.stringify(lay.bg));
    if (lay.bg.type === 'blur') {
      var cs = Math.max(TW / photo.width, TH / photo.height), bw = photo.width * cs, bh = photo.height * cs;
      layers.push({ type: 'image', name: 'Blurred photo', src: opts.photo, x: (TW - bw) / 2, y: (TH - bh) / 2, w: bw, h: bh, adjust: { blur: 22, brightness: -18, saturation: 10 }, locked: false });
    }
    var T = lay.text, head = breakHeadline(opts.headline || 'WATCH THIS', T.lines === 1 && words(opts.headline).length > 2 && T.behind ? 2 : T.lines), size = fitSize(T, head);
    var th = textBox({ size: size }, head);
    var accent = T.accent || '#FFD43B';
    if (lay.accent === 'shade') layers.push({ type: 'shape', shape: 'rect', name: 'Shade', x: 0, y: 0, w: TW, h: TH, fill: { type: 'linear', angle: 0, colors: ['rgba(10,8,14,.82)', 'rgba(10,8,14,.35)', 'rgba(10,8,14,0)'] } });
    if (lay.accent === 'block') layers.push({ type: 'shape', shape: 'rect', name: 'Colour block', x: 0, y: 0, w: 640, h: TH, fill: { type: 'solid', color: accent } });
    if (lay.accent === 'circle') layers.push({ type: 'shape', shape: 'ellipse', name: 'Circle', x: TW - 640, y: 60, w: 600, h: 600, fill: { type: 'solid', color: accent } });
    if (lay.accent === 'badge') layers.push({ type: 'shape', shape: 'rect', name: 'Badge', x: 620, y: 96, w: 230, h: 76, radius: 38, fill: { type: 'solid', color: accent } });
    var text = {
      type: 'text', name: 'Headline', text: head, font: T.font, weight: /Anton|Bebas|Archivo/.test(T.font) ? 400 : 700, size: size, color: T.color, align: T.align, uppercase: true,
      lineHeight: 0.98, letterSpacing: /Bebas/.test(T.font) ? 2 : 0, x: T.x, y: T.behind ? T.y : Math.max(lay.accent === 'badge' ? 196 : 36, Math.round((TH - th) / 2 - 70)), w: T.w, h: th
    };
    if (T.stroke) text.stroke = { width: Math.max(6, Math.round(size * 0.07)), color: T.stroke };
    var darkInk = /^#(1|0|2)/.test(T.color);
    if (!T.behind) text.shadow = darkInk ? { color: 'rgba(20,18,26,.16)', blur: 0, x: Math.round(size * 0.04), y: Math.round(size * 0.05) } : { color: 'rgba(0,0,0,.55)', blur: 0, x: Math.round(size * 0.05), y: Math.round(size * 0.06) };
    if (T.behind) text.y = T.y;
    if (lay.accent === 'banner') {
      layers.push({ type: 'shape', shape: 'rect', name: 'Banner', x: 0, y: TH - 170, w: TW, h: 170, fill: { type: 'solid', color: accent } });
      text.y = TH - 170 + (170 - th) / 2;
      text.color = '#FFFFFF';
    }
    if (T.behind) layers.push(text);
    var box = mask ? subjectBox(c, lay, photo, mask) : (function () { var s = TH * 0.9 / photo.height; var w = photo.width * s; return { x: lay.subject.side === 'left' ? 40 : lay.subject.side === 'right' ? TW - w - 40 : (TW - w) / 2, y: TH - photo.height * s, w: w, h: photo.height * s }; })();
    var subject = { type: 'image', name: 'Subject', src: opts.photo, x: box.x, y: box.y, w: box.w, h: box.h, shadow: { color: 'rgba(0,0,0,.45)', blur: 26, x: 0, y: 12 } };
    if (mask) subject.cutout = cutoutSpec(null, { asset: opts.mask, model: opts.model || 'u2netp', outline: opts.outline === false ? null : { width: 9, color: '#FFFFFF' } });
    layers.push(subject);
    if (lay.accent === 'bar') layers.push({ type: 'shape', shape: 'rect', name: 'Accent bar', x: T.x + 4, y: text.y + th + 18, w: 220, h: 18, radius: 9, fill: { type: 'solid', color: accent } });
    if (lay.accent === 'badge') layers.push({ type: 'text', name: 'Badge text', text: opts.badge || 'NEW', font: 'Archivo Black', weight: 400, size: 44, color: '#FFFFFF', align: 'center', uppercase: true, x: 620, y: 104, w: 230, h: 60, lineHeight: 1.1 });
    if (!T.behind) layers.push(text);
    return { v: 1, width: TW, height: TH, background: bg, layers: layers };
  }
  /* Rendered at full size and scaled down: canvas shadows do not scale with the transform, so a 1:4 render would
     show shadows four times too large. */
  function previewThumb(c, layoutId, opts, scale) {
    return thumbFonts().then(function () {
      var d = buildThumb(c, layoutId, opts);
      return c.hiddenRender(d, 1, { small: true });
    }).then(function (full) {
      var s = scale || 0.25;
      var out = document.createElement('canvas');
      out.width = Math.round(TW * s); out.height = Math.round(TH * s);
      var x = out.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(full, 0, 0, out.width, out.height);
      full.width = full.height = 1;
      return out;
    });
  }
  function createThumb(c, layoutId, opts) {
    c = c || studio;
    return thumbFonts().then(function () { return createThumbNow(c, layoutId, opts); });
  }
  function createThumbNow(c, layoutId, opts) {
    var d = buildThumb(c, layoutId, opts);
    var metas = [opts.photo, opts.mask].filter(Boolean).map(function (id) { return c.mem[id] && c.mem[id].meta; }).filter(Boolean);
    c.newDesign(TW, TH, 'Thumbnail' + (opts.headline ? ' · ' + String(opts.headline).slice(0, 40) : ''));
    metas.forEach(function (m) { c.S.project.assets[m.id] = m; c.scene.addAsset(m.id, c.mem[m.id].canvas); });
    c.scene.load(d);
    c.syncProject();
    c.fit();
    c.scene.select([]);
    c.markDirty();
    c.renderToolbar();
    return Promise.resolve(c.scene.toJSON());
  }

  var TK = { photo: null, mask: null, model: null, headline: 'This changed everything', layout: null, busy: false };
  function maskFor(c, photoId) {
    var hit = null;
    c.scene.layers().forEach(function (l) { if (l.type === 'image' && l.src === photoId && l.cutout && c.mem[l.cutout.asset]) hit = l.cutout; });
    if (!hit && TK.photo === photoId && TK.mask && c.mem[TK.mask]) hit = { asset: TK.mask, model: TK.model };
    return hit;
  }
  function photoIds(c) {
    if (!c.S.project) return [];
    return Object.keys(c.S.project.assets || {}).filter(function (id) { var m = c.S.project.assets[id]; return c.mem[id] && !/^background-/.test((m && m.name) || ''); });
  }
  function cutForKit(c, photoId) {
    /* Run the remover on the photo without touching the design: a hidden one-off, using the same engine and model choice. */
    var mem = c.mem[photoId];
    if (!mem) return Promise.resolve(null);
    TK.busy = true;
    var ac = new AbortController();
    TK.abort = ac;
    TK.stage = 'Preparing…';
    return remover().then(function (bg) {
      var mid = chosen(), info = bg.model(mid);
      return bg.gate(mid, { title: 'Cut out the subject', run: function () {
        return bg.cutout(mem.canvas, { model: mid, signal: ac.signal, onProgress: function (p) {
          TK.stage = stageText(p, info);
          var s = document.getElementById('sxc-tk-stage');
          if (s) s.textContent = TK.stage;
        } });
      } });
    }).then(function (res) {
      if (!res || !res.mask) return null;
      return storeMask(c, res.mask).then(function (id) { TK.mask = id; TK.model = chosen(); return id; });
    }).then(function (id) { TK.busy = false; TK.error = null; scheduleUnload(90000); return id; }, function (err) {
      TK.busy = false;
      TK.error = err && (err.name === 'AbortError' || err.code === 'cancelled') ? null : { code: (err && err.code) || 'engine', message: err && err.message };
      return null;
    });
  }
  function renderThumbnailApp(c, body) {
    c.S.panelOpts.back = c.S.panelOpts.back || 'apps';
    var step = el(c, '<div class="sxc-tk"></div>');
    body.appendChild(step);
    body.appendChild(el(c, '<p class="sxc-lead">Make a 1280 × 720 video thumbnail: cut out the subject, add a bold headline, pick a layout. Everything stays editable. <span class="sxc-beta">Beta</span></p>'));
    var s1 = c.ui.section('1 · Photo');
    var g = el(c, '<div class="sx-grid sx-grid-4 sx-thumbs sxc-tk-photos"></div>');
    var ids = photoIds(c);
    var sel = c.one();
    if (!TK.photo && sel && sel.type === 'image' && c.mem[sel.src]) TK.photo = sel.src;
    if (TK.photo && ids.indexOf(TK.photo) < 0 && !c.mem[TK.photo]) TK.photo = null;
    if (!TK.photo && ids.length) TK.photo = ids[ids.length - 1];
    ids.forEach(function (id) {
      var t = el(c, '<button type="button" class="sx-thumb" aria-pressed="' + (id === TK.photo) + '" aria-label="Use this photo"><img alt=""></button>');
      c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
      t.onclick = function () { if (TK.busy) return; TK.photo = id; TK.mask = null; c.renderPanel(true); };
      g.appendChild(t);
    });
    var up = el(c, '<button type="button" class="sx-thumb sxc-tk-add" aria-label="Upload a photo">' + c.ic('plus') + '</button>');
    var input = el(c, '<input type="file" accept="image/*" hidden>');
    up.onclick = function () { input.click(); };
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var go = c.S.project ? c.ingest(f) : c.newFromPhoto(f).then(function () { var b = c.one() || c.targetImage(); return b ? { id: b.src } : null; });
      go.then(function (meta) { if (meta) { TK.photo = meta.id; TK.mask = null; } c.renderPanel(true); }).catch(function (err) { c.toast(err.message || 'Could not read that image.'); });
    };
    g.appendChild(up);
    body.appendChild(input);
    s1.querySelector('.sx-sec-body').appendChild(g);
    body.appendChild(s1);
    if (!TK.photo) { body.appendChild(el(c, '<p class="sx-note">Upload a photo with one clear person or object to start.</p>')); return; }

    var s2 = c.ui.section('2 · Headline');
    var hb = s2.querySelector('.sx-sec-body');
    var inp = el(c, '<input class="sx-input sxc-tk-head" type="text" maxlength="40" aria-label="Headline">');
    inp.value = TK.headline;
    hb.appendChild(inp);
    hb.appendChild(el(c, '<p class="sx-note">Two to four words read best on a phone.</p>'));
    body.appendChild(s2);

    var s3 = c.ui.section('3 · Layout');
    var lb = s3.querySelector('.sx-sec-body');
    body.appendChild(s3);
    var cut = maskFor(c, TK.photo);
    if (cut) { TK.mask = cut.asset; TK.model = cut.model; }
    if (TK.busy) {
      lb.appendChild(el(c, '<div class="sxc-progress"><p class="sxc-stage" id="sxc-tk-stage">' + c.esc(TK.stage || 'Cutting out the subject…') + '</p><div class="sxc-bar is-busy"><i></i></div></div>'));
      lb.appendChild(btn(c, 'Cancel', 'x', 'btn btn-sm', function () { if (TK.abort) TK.abort.abort(); }));
      return;
    }
    if (!TK.mask) {
      if (TK.error) {
        var ec = errorCopy(TK.error.code);
        lb.appendChild(el(c, '<div class="sxc-alert" role="alert"><strong>' + c.esc(ec[0]) + '</strong><p>' + c.esc(ec[1].replace(' You can cut it out by hand with the brush.', ' You can still make a thumbnail with the whole photo.')) + '</p></div>'));
      }
      var row = el(c, '<div class="sxc-tk-go"></div>');
      row.appendChild(btn(c, 'Cut out the subject', 'cutout', 'btn btn-gold sx-block', function () {
        var p = cutForKit(c, TK.photo); c.renderPanel(true); p.then(function () { c.renderPanel(true); });
      }));
      row.appendChild(btn(c, 'Use the whole photo', null, 'btn btn-ghost btn-sm', function () { TK.mask = ''; TK.whole = true; c.renderPanel(true); }));
      lb.appendChild(row);
      var fu = el(c, '<p class="sx-note"></p>');
      lb.appendChild(fu);
      firstUseNote(c, fu, chosen());
      if (!TK.whole) return;
    }
    var grid = el(c, '<div class="sxc-tk-grid"></div>');
    lb.appendChild(grid);
    var opts = function () { return { photo: TK.photo, mask: TK.mask || null, model: TK.model, headline: TK.headline }; };
    var gen = 0;
    function draw() {
      var my = ++gen;
      grid.innerHTML = '';
      LAYOUTS.forEach(function (lay) {
        var card = el(c, '<button type="button" class="sxc-tk-card" aria-label="' + c.esc(lay.name) + '"><span class="sxc-tk-art"></span><small>' + c.esc(lay.name) + '</small></button>');
        card.onclick = function () { createThumb(c, lay.id, opts()).then(function () { c.toast('Thumbnail ready · every part is editable'); c.closePanel(); }); };
        grid.appendChild(card);
        previewThumb(c, lay.id, opts(), 0.25).then(function (cv) {
          if (my !== gen) return;
          cv.className = 'sxc-tk-canvas';
          card.querySelector('.sxc-tk-art').appendChild(cv);
        }).catch(function () {});
      });
    }
    draw();
    inp.addEventListener('input', c.debounce(function () { TK.headline = inp.value.trim() || 'Watch this'; draw(); }, 400));
  }
  if (P._apps && !P._apps.some(function (a) { return a[0] === 'thumbnail'; })) P._apps.splice(0, 0, ['thumbnail', 'Thumbnail', 'thumb', 'Cut-out + bold title, 1280×720']);
  P._appRender = P._appRender || {};
  P._appRender.thumbnail = renderThumbnailApp;

  /* ---------- public ---------- */
  window.LEStudioCutout = {
    run: function (layerId, o) { return run(studio, layerId, o); },
    cancel: cancel,
    open: function (layerId) { return quick(studio, layerId || (studio.one() || {}).id); },
    state: function () {
      return { running: !!ST.run, stage: ST.run ? ST.run.stage : null, fraction: ST.run ? ST.run.fraction : 0, error: ST.error ? { code: ST.error.code, layerId: ST.error.layerId, coverage: ST.error.coverage } : null,
        model: chosen(), recommended: ST.rec, last: ST.last, brush: BR ? { layerId: BR.id, mode: BR.mode, size: BR.size, hard: BR.hard, undo: BR.undo.length, redo: BR.redo.length } : null };
    },
    model: chosen,
    setModel: function (id) { ST.model = id; lsSet(MODEL_KEY, id); },
    refine: function (layerId, o) { return beginRefine(studio, layerId || (studio.one() || {}).id, o); },
    brush: {
      stroke: strokeDoc, set: setBrush, undo: brushUndo, redo: brushRedo,
      done: function () { return endRefine(studio, true); }, cancel: function () { return endRefine(studio, false); }
    },
    putOn: function (layerId, kind, color) { return putOn(studio, layerId, kind, color); },
    storeMask: function (canvas) { return storeMask(studio, canvas); },
    isMask: isMask,
    thumbnail: {
      layouts: function () { return LAYOUTS.map(function (l) { return { id: l.id, name: l.name }; }); },
      build: function (layoutId, o) { return thumbFonts().then(function () { return buildThumb(studio, layoutId, o); }); },
      preview: function (layoutId, o, scale) { return previewThumb(studio, layoutId, o, scale); },
      create: function (layoutId, o) { return createThumb(studio, layoutId, o); },
      cut: function (photoId) { return cutForKit(studio, photoId); }
    }
  };
})();
