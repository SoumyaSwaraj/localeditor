/* LocalEditor background remover: on-device subject cut-out.  window.LE.bgRemove
 *
 * Loaded on demand (LE.lazy) the first time someone asks for a cut-out; nothing here runs or downloads before that.
 * Inference runs in assets/js/le-bgremove-worker.js on onnxruntime-web (WASM, one thread unless the page is
 * cross-origin isolated). Model bytes are kept in Cache Storage 'le-models-v1', keyed by URL, with an x-le-model header.
 *
 *   LE.bgRemove.models()                         -> registry entries (see "Model registry" below) plus { url, listed, qualityLabel, speedLabel }
 *   LE.bgRemove.register(def)                    -> add an option to the registry (or queue it in window.LE_BGREMOVE_MODELS)
 *   LE.bgRemove.recommend({ people, checks, cached }) -> the one option id to pre-select
 *   LE.bgRemove.budget()                         -> { tier, maxSide }   input cap for this device
 *   LE.bgRemove.support(id)                      -> Promise<{ status: ok|limited|unsupported|unknown, reasons, suggest, canForce }>
 *   LE.bgRemove.gate(id, { title, run })         -> LE.support.gate when present, else a minimal check, then run()
 *   LE.bgRemove.downloadSize(id)                 -> Promise<{ bytes, model, engine, cached }>   what the first use will fetch
 *   LE.bgRemove.load(id, onProgress, o)          -> Promise<info>   o: { ep, threads, cache, signal }
 *   LE.bgRemove.run(src, opts)                   -> Promise<{ mask: ImageData, canvas, width, height, timings, stats, model }>
 *   LE.bgRemove.cutout(src, opts)                -> Promise<{ mask: canvas (white, alpha = mask), coverage, width, height, model, timings, maxSide }>
 *        opts: { model, onProgress, signal, maxSide, refine }. Rejects with err.code = 'no-subject' | 'memory' | 'download' |
 *        'offline' | 'unsupported' | 'cancelled'. Retries once at half size when the engine runs out of memory.
 *   LE.bgRemove.applyMask(src, mask, w?, h?)     -> canvas
 *   LE.bgRemove.isLoaded() / unload()
 *   LE.bgRemove.isCached(id) / remove(id) / cachedModels() / clearCache()
 *   LE.bgRemove.prefetch(id, onProgress, signal)  -> Promise<{ cached, bytes }>  into Cache Storage only (fetch for next time)
 *   LE.bgRemove.space(id)                        -> Promise<{ ok, need, free }>  free-space check before a download
 * Downloads of LARGE (50 MB) or more stream straight into Cache Storage; a cancelled one leaves no entry.
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.bgRemove && LE.bgRemove.shared) return;

  var CACHE = 'le-models-v1';
  var scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  var cfg = { root: new URL('../../', scriptUrl).href, worker: new URL('le-bgremove-worker.js', scriptUrl).href };

  var IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
  var NEEDS = ['wasm', 'wasm-simd', 'worker', 'offscreen-canvas'];
  /* ---------- Model registry ----------
   * Every option the person can pick is one entry. The studio's chooser is built from these entries only, so a new option
   * (for example a larger "pro" model on WebGPU) appears without UI changes. Add one from any file, before or after this
   * script loads:
   *   (window.LE_BGREMOVE_MODELS = window.LE_BGREMOVE_MODELS || []).push(def)    // before (queued, read on load)
   *   LE.bgRemove.register(def)                                                  // after
   *
   * def (plain data):
   *   id          string, unique, [\w.-]+                  also the x-le-model id in Cache Storage and the storage manager
   *   label       short human name by purpose: "Quick", "More detail", "People and portraits"
   *   bestFor     one plain line: "Best for products and objects with clean edges"
   *   quality     1..3 (1 Good, 2 Better, 3 Best)          qualityMax defaults to 3; set it to 5 for a 1..5 scale
   *   speed       'fast' | 'medium' | 'slow'                shown as "Fast" / "Takes a little longer" / "Takes a while"
   *   downloadMB  whole MB of the model file (the engine, ~3 MB, is added on first use automatically)
   *   example     site-relative URL of a small before/after image (assets/img/cutout/*.jpg), or ''
   *   supportId   LE.support feature id; declared here in LE_SUPPORT_DEFS from needs/memoryMB/downloadMB
   *   tier        'standard' | 'pro'                        anything else (e.g. 'eval') is hidden from the chooser
   *   runtime     'wasm' | 'webgpu'                          webgpu needs assets/vendor/ort-webgpu/ (another owner's file)
   *   subject     'general' | 'people'                      the studio recommends 'people' only for people photos
   *   path        site-relative model URL; bytes: exact file size (checked after download)
   *   size, norm { mean, std }, sigmoid                     model input (square side), normalisation, logits?
   *   memoryMB    peak working memory while it runs (for the device check)
   *   needs       LE.support capability ids (default: wasm, wasm-simd, worker, offscreen-canvas; webgpu adds 'webgpu')
   *   about       { model, licence, source, notes }          technical facts, shown only behind "About this option"
   */
  var MODELS = [];
  var QUALITY = ['', 'Good', 'Better', 'Best'];
  function normDef(d) {
    if (!d || typeof d !== 'object' || !/^[\w.-]{1,60}$/.test(d.id || '')) return null;
    var m = Object.assign({
      label: d.id, bestFor: '', quality: 1, qualityMax: 3, speed: 'fast', downloadMB: d.bytes ? Math.max(1, Math.round(d.bytes / 1e6)) : 0, example: '',
      supportId: 'cutout.' + d.id, tier: 'standard', runtime: 'wasm', subject: 'general', size: 320, norm: IMAGENET, sigmoid: false, memoryMB: 1000, about: {}
    }, d);
    m.needs = (d.needs || NEEDS.concat(m.runtime === 'webgpu' ? ['webgpu'] : [])).slice();
    m.listed = m.tier === 'standard' || m.tier === 'pro';
    m.bundled = m.listed;
    m.name = m.label;
    m.qualityLabel = m.qualityMax === 3 ? QUALITY[Math.max(1, Math.min(3, m.quality))] : (m.quality >= m.qualityMax ? 'Best' : m.quality > m.qualityMax / 2 ? 'Better' : 'Good');
    m.speedLabel = { fast: 'Fast', medium: 'Takes a little longer', slow: 'Takes a while' }[m.speed] || String(m.speed);
    return m;
  }
  function declare(m) {
    var defs = global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || [];
    if (!defs.some(function (d) { return d && d.id === m.supportId; })) {
      defs.push({ id: m.supportId, name: 'Background remover: ' + m.label, needs: m.needs.slice(), wants: [], memoryMB: m.memoryMB, downloadMB: m.downloadMB });
    }
    if (m.listed && global.LEPwa && typeof global.LEPwa.describeModel === 'function') {
      var a = m.about || {};
      global.LEPwa.describeModel(m.id, { name: 'Background remover: ' + m.label, about: m.bestFor + (a.model ? ' (' + a.model + (a.licence ? ', ' + a.licence : '') + ')' : '') });
    }
  }
  function addModel(d) {
    var m = normDef(d);
    if (!m || find(m.id)) return false;
    MODELS.push(m);
    declare(m);
    return true;
  }
  [
    { id: 'u2netp', label: 'Quick', bestFor: 'Best for products and objects with clean edges', quality: 1, speed: 'fast', downloadMB: 5, example: 'assets/img/cutout/quick.jpg',
      supportId: 'cutout.fast', tier: 'standard', runtime: 'wasm', subject: 'general', path: 'assets/models/u2netp.onnx', bytes: 4574861, memoryMB: 700,
      about: { model: 'U\u00b2-Net small (u2netp), 320 px input', licence: 'Apache-2.0', source: 'github.com/xuebinqin/U-2-Net (ONNX export via rembg)', notes: 'Trained on DUTS-TR.' } },
    { id: 'u2net-int8', label: 'More detail', bestFor: 'Best for busy edges, groups and things with thin parts', quality: 2, speed: 'medium', downloadMB: 44, example: 'assets/img/cutout/detail.jpg',
      supportId: 'cutout.detailed', tier: 'standard', runtime: 'wasm', subject: 'general', path: 'assets/models/u2net-int8.onnx', bytes: 44212603, memoryMB: 1000,
      about: { model: 'U\u00b2-Net (u2net), 8-bit quantised by LocalEditor, 320 px input', licence: 'Apache-2.0', source: 'github.com/xuebinqin/U-2-Net', notes: 'Trained on DUTS-TR.' } },
    { id: 'u2net_human_seg-int8', label: 'People and portraits', bestFor: 'Best for selfies, portraits and groups of people', quality: 3, speed: 'medium', downloadMB: 44, example: 'assets/img/cutout/people.jpg',
      supportId: 'cutout.people', tier: 'standard', runtime: 'wasm', subject: 'people', path: 'assets/models/u2net_human_seg-int8.onnx', bytes: 44212602, memoryMB: 1000,
      about: { model: 'U\u00b2-Net human segmentation, 8-bit quantised by LocalEditor, 320 px input', licence: 'Apache-2.0', source: 'github.com/xuebinqin/U-2-Net', notes: 'People only: poor on objects. Trained on the Supervisely Person dataset.' } }
  ].forEach(addModel);
  (global.LE_BGREMOVE_MODELS || []).forEach(addModel);
  global.LE_BGREMOVE_MODELS = { push: function (d) { return addModel(d); } };
  if (!global.LEPwa) global.addEventListener('le-pwa-ready', function () { MODELS.forEach(declare); }, { once: true });

  var worker = null, current = null, seq = 0, pending = {};

  function abs(p) { return new URL(p, cfg.root).href; }
  function find(id) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i]; return null; }
  function coded(msg, code, cause) { var e = new Error(msg); e.code = code; if (cause) e.cause = cause; return e; }
  function aborted() { var e = new Error('Cancelled'); e.name = 'AbortError'; e.code = 'cancelled'; return e; }
  function isAbort(e) { return e && (e.name === 'AbortError' || e.code === 'cancelled'); }
  function isMemory(e) { return /out of memory|memory|heap|allocation|RangeError|code \d+/i.test(String(e && (e.message || e))); }

  /* ---------- device budget ---------- */
  function deviceTier() {
    var t = (LE.device && LE.device.tier) ? LE.device.tier() : 'desktop';
    var mem = navigator.deviceMemory;
    if (mem && mem <= 2) t = 'older';
    var mode = (LE.perf && LE.perf.mode) ? LE.perf.mode() : 'auto';
    if (mode === 'saver') t = t === 'desktop' ? 'modern' : 'older';
    return t;
  }
  function budget() {
    var t = deviceTier();
    return { tier: t, maxSide: t === 'desktop' ? 2560 : t === 'modern' ? 1600 : 1024 };
  }

  /* ---------- minimal capability check (used when LE.support is not on the page) ---------- */
  var SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  function localCheck(m) {
    var reasons = [], status = 'ok';
    var wasm = typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function';
    if (!wasm) { status = 'unsupported'; reasons.push('This browser cannot run WebAssembly, which the background remover needs.'); }
    else {
      var simd = false;
      try { simd = WebAssembly.validate(SIMD); } catch (e) { simd = false; }
      if (!simd) { status = 'unsupported'; reasons.push('This browser lacks WebAssembly SIMD. Update it, or try a current Chrome, Edge, Firefox or Safari.'); }
    }
    if (typeof Worker === 'undefined') { status = 'unsupported'; reasons.push('This browser cannot run background workers.'); }
    if (typeof OffscreenCanvas === 'undefined') { status = 'unsupported'; reasons.push('This browser lacks OffscreenCanvas (Safari 16.4 or newer has it).'); }
    if (m.runtime === 'webgpu' && !navigator.gpu) { status = 'unsupported'; reasons.push('This option needs WebGPU, which this browser does not offer.'); }
    var mem = navigator.deviceMemory;
    if (status === 'ok') {
      if (mem && mem * 1024 < m.memoryMB * 2.5) { status = 'limited'; reasons.push('This device reports ' + mem + ' GB of memory; this model needs about ' + (m.memoryMB >= 1000 ? (m.memoryMB / 1000).toFixed(1) + ' GB' : m.memoryMB + ' MB') + ' while it runs, so it may be slow or stop.'); }
      else if (!mem && m.memoryMB >= 1000 && deviceTier() !== 'desktop') { status = 'limited'; reasons.push('This is a large model; on a phone it may be slow or run out of memory.'); }
      else if (deviceTier() === 'older') { status = 'limited'; reasons.push('This looks like an older device; expect a few seconds per photo.'); }
    }
    return { status: status, reasons: reasons, suggest: status === 'unsupported' ? [{ browser: 'Chrome, Edge, Firefox or Safari 16.4+', reason: 'They run WebAssembly SIMD and OffscreenCanvas.' }] : [], canForce: status !== 'unsupported' };
  }
  function support(id) {
    var m = find(id);
    if (!m) return Promise.resolve({ status: 'unknown', reasons: ['Unknown model.'], suggest: [], canForce: false });
    if (LE.support && typeof LE.support.check === 'function') {
      /* checkAsync probes first (WebGPU is only known after asking for an adapter); check() is the sync fallback. */
      return Promise.resolve().then(function () { return typeof LE.support.checkAsync === 'function' ? LE.support.checkAsync(m.supportId) : LE.support.check(m.supportId); }).then(function (r) {
        return r && r.status ? r : localCheck(m);
      }, function () { return localCheck(m); });
    }
    return Promise.resolve(localCheck(m));
  }
  /* Owner's rule: never block an ambiguous result; explain and allow a forced run. Only a hard "unsupported" stops. */
  function gate(id, opts) {
    var m = find(id);
    opts = opts || {};
    if (m && LE.support && typeof LE.support.gate === 'function') {
      return LE.support.gate(m.supportId, { title: opts.title || 'Remove background', run: opts.run });
    }
    return support(id).then(function (r) {
      if (r.status === 'unsupported' && !opts.force) throw coded(r.reasons[0] || 'This browser cannot run the background remover.', 'unsupported');
      return opts.run ? opts.run(r) : r;
    });
  }

  /* ---------- model bytes: Cache Storage first, network second, with progress ---------- */
  function openCache() {
    if (!global.caches) return Promise.resolve(null);
    return caches.open(CACHE).catch(function () { return null; });
  }
  /* Large models (the "pro" options, 100 MB to 500 MB) stream straight into Cache Storage instead of being held in memory
     twice. Cache.put() commits only once the whole body has arrived, so a cancelled or broken download leaves nothing
     behind: the next attempt is a clean restart. Free space is checked first. */
  var LARGE = 50e6, ENGINE_GPU = 7200000; /* compressed transfer of the WebGPU engine (assets/vendor/ort-webgpu) */
  async function space(bytes) {
    var need = Math.round(bytes * 1.1) + 20e6;
    if (!(global.navigator && navigator.storage && navigator.storage.estimate)) return { ok: true, need: need, free: null };
    try {
      var e = await navigator.storage.estimate();
      var free = e.quota ? e.quota - (e.usage || 0) : null;
      return { ok: free == null || free >= need, need: need, free: free };
    } catch (err) { return { ok: true, need: need, free: null }; }
  }
  function quotaError(room) {
    var e = coded('There is not enough free space on this device for this download.', 'quota');
    e.name = 'QuotaExceededError';
    e.need = room && room.need; e.free = room && room.free;
    if (global.LEPwa && typeof global.LEPwa.reportQuotaError === 'function') { try { global.LEPwa.reportQuotaError(e); } catch (x) { /* ignore */ } }
    return e;
  }
  async function streamToCache(m, req, res, cache, onProgress, signal) {
    var total = +res.headers.get('content-length') || m.bytes, loaded = 0;
    var counter = new TransformStream({
      transform: function (chunk, ctl) {
        loaded += chunk.length;
        if (onProgress) onProgress({ loaded: loaded, total: total, fraction: Math.min(1, loaded / total), cached: false });
        ctl.enqueue(chunk);
      }
    });
    var headers = { 'content-type': 'application/octet-stream', 'content-length': String(m.bytes), 'x-le-model': m.id };
    try {
      await cache.put(req, new Response(res.body.pipeThrough(counter), { headers: headers }));
    } catch (e) {
      try { await cache.delete(req); } catch (x) { /* nothing stored */ }
      if (isAbort(e) || (signal && signal.aborted)) throw aborted();
      if (global.LEPwa && global.LEPwa.isQuotaError && global.LEPwa.isQuotaError(e)) throw quotaError(null);
      if (e && e.name === 'QuotaExceededError') throw quotaError(null);
      throw coded('The download stopped part-way. Check your connection and try again.', 'download', e);
    }
    if (m.bytes && Math.abs(loaded - m.bytes) > 16) {
      try { await cache.delete(req); } catch (x) { /* ignore */ }
      throw coded('The model download was incomplete. Try again.', 'download');
    }
    var hit = await cache.match(req);
    if (!hit) throw coded('The model could not be stored on this device.', 'download');
    return { buf: await hit.arrayBuffer(), cached: false };
  }
  async function modelBytes(m, onProgress, useCache, signal) {
    var url = abs(m.path), cache = null, req = new Request(url);
    if (useCache) cache = await openCache();
    if (cache) {
      var hit = await cache.match(req);
      if (hit) {
        var buf = await hit.arrayBuffer();
        if (onProgress) onProgress({ loaded: buf.byteLength, total: buf.byteLength, fraction: 1, cached: true });
        return { buf: buf, cached: true };
      }
    }
    if (global.navigator && navigator.onLine === false) throw coded('You are offline, and this model has not been downloaded yet.', 'offline');
    if (cache && m.bytes >= LARGE) {
      var room = await space(m.bytes);
      if (!room.ok) throw quotaError(room);
    }
    var res;
    try { res = await fetch(url, signal ? { signal: signal } : undefined); }
    catch (e) { if (isAbort(e)) throw aborted(); throw coded('The model could not be downloaded. Check your connection and try again.', navigator.onLine === false ? 'offline' : 'download', e); }
    if (!res.ok) throw coded('The model could not be downloaded (' + res.status + ').', 'download');
    if (cache && m.bytes >= LARGE && res.body && typeof TransformStream === 'function') return streamToCache(m, req, res, cache, onProgress, signal);
    var total = +res.headers.get('content-length') || m.bytes, loaded = 0, chunks = [];
    try {
      if (res.body && res.body.getReader) {
        var rd = res.body.getReader();
        for (;;) {
          var r = await rd.read();
          if (r.done) break;
          chunks.push(r.value); loaded += r.value.length;
          if (onProgress) onProgress({ loaded: loaded, total: total, fraction: Math.min(1, loaded / total), cached: false });
        }
      } else {
        chunks.push(new Uint8Array(await res.arrayBuffer())); loaded = chunks[0].length;
      }
    } catch (e2) {
      if (isAbort(e2) || (signal && signal.aborted)) throw aborted();
      throw coded('The download stopped part-way. Check your connection and try again.', 'download', e2);
    }
    if (m.bytes && Math.abs(loaded - m.bytes) > 16 && m.listed) throw coded('The model download was incomplete. Try again.', 'download');
    var out = new Uint8Array(loaded), off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    chunks = null;
    if (cache) {
      try {
        await cache.put(req, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded), 'x-le-model': m.id } }));
      } catch (e3) { /* quota: run anyway */ }
    }
    return { buf: out.buffer, cached: false };
  }

  /* ---------- worker plumbing ---------- */
  function call(type, payload, transfer) {
    return new Promise(function (resolve, reject) {
      if (!worker) { reject(coded('The engine stopped.', 'memory')); return; }
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      var msg = payload || {}; msg.id = id; msg.type = type;
      worker.postMessage(msg, transfer || []);
    });
  }
  function rejectAll(err) {
    Object.keys(pending).forEach(function (k) { pending[k].reject(err); delete pending[k]; });
  }
  function killWorker(err) {
    if (worker) { worker.terminate(); worker = null; }
    rejectAll(err || aborted());
    current = null;
  }
  function startWorker() {
    worker = new Worker(cfg.worker);
    worker.onmessage = function (e) {
      var d = e.data, p = pending[d.id];
      if (!p) return;
      delete pending[d.id];
      if (d.ok) p.resolve(d); else p.reject(new Error(d.error || 'Worker error'));
    };
    worker.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var msg = (e && e.message) || 'The engine stopped';
      killWorker(coded(msg, isMemory(msg) ? 'memory' : 'engine'));
    };
  }

  function canvasFromMask(u8, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var img = c.getContext('2d').createImageData(w, h), d = img.data;
    for (var i = 0; i < u8.length; i++) { var j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = u8[i]; }
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /* ---------- public API ---------- */
  var API = LE.bgRemove = {
    shared: true,
    CACHE: CACHE,
    config: function (o) {
      if (o && o.root) cfg.root = new URL(o.root, location.href).href;
      if (o && o.worker) cfg.worker = new URL(o.worker, location.href).href;
      return cfg;
    },
    models: function () { return MODELS.map(function (m) { return Object.assign({}, m, { url: abs(m.path) }); }); },
    model: function (id) { var m = find(id); return m ? Object.assign({}, m, { url: abs(m.path) }) : null; },
    register: addModel,
    /* The one option to pre-select. ctx: { people: bool, checks: { id: status } }. Prefers an option that is already on this
       device and runs well here; otherwise the smallest standard option. A 'people' option only for people photos. */
    recommend: function (ctx) {
      ctx = ctx || {};
      var list = MODELS.filter(function (m) { return m.listed && m.tier === 'standard'; });
      var ok = function (m) { return !ctx.checks || ctx.checks[m.id] === 'ok'; };
      var have = ctx.cached || {};
      var fits = list.filter(function (m) { return (m.subject !== 'people' || ctx.people) && ok(m); });
      var ready = fits.filter(function (m) { return have[m.id]; }).sort(function (a, b) { return (b.subject === 'people' && ctx.people) - (a.subject === 'people' && ctx.people) || b.quality - a.quality; });
      if (ready.length) return ready[0].id;
      var small = list.slice().sort(function (a, b) { return a.downloadMB - b.downloadMB; });
      return (small[0] || MODELS[0]).id;
    },
    budget: budget,
    support: support,
    space: function (id) { var m = find(id); return space(m ? m.bytes : 0); },
    LARGE: LARGE,
    gate: gate,

    isAvailable: async function (id) {
      var m = find(id); if (!m) return false;
      try { var r = await fetch(abs(m.path), { method: 'HEAD' }); return r.ok && /octet|onnx/.test(r.headers.get('content-type') || 'octet'); } catch (e) { return false; }
    },
    /* Download a model into Cache Storage without starting the engine (background fetch for next time). */
    prefetch: async function (id, onProgress, signal) {
      var m = find(id); if (!m) throw new Error('Unknown model: ' + id);
      var got = await modelBytes(m, onProgress, true, signal);
      return { cached: got.cached, bytes: got.buf.byteLength };
    },
    isLoaded: function () { return current ? current.id : null; },
    isCached: async function (id) {
      var m = find(id), c = await openCache();
      return !!(m && c && await c.match(abs(m.path)));
    },
    /* What the first use will download: the model plus the engine (ORT wasm, ~2.9 MB compressed) unless cached. */
    downloadSize: async function (id) {
      var m = find(id), c = await openCache();
      var model = !!(m && c && await c.match(abs(m.path)));
      var gpu = !!(m && m.runtime === 'webgpu');
      var engine = !!(c && await c.match(abs(gpu ? 'assets/vendor/ort-webgpu/ort-wasm-simd-threaded.asyncify.wasm' : 'assets/vendor/ort/ort-wasm-simd-threaded.wasm')));
      var bytes = (model ? 0 : (m ? m.bytes : 0)) + (engine ? 0 : gpu ? ENGINE_GPU : 2900000);
      return { bytes: bytes, model: !model, engine: !engine, cached: model };
    },

    /* o: { ep: 'auto'|'wasm'|'webgpu', threads: n, cache: bool, signal } */
    load: function (id, onProgress, o) {
      o = o || {};
      var m = find(id);
      if (!m) return Promise.reject(new Error('Unknown model: ' + id));
      if (!o.ep && m.runtime === 'webgpu') o = Object.assign({}, o, { ep: 'webgpu' });
      if (current && worker && current.id === id && current.ep === (o.ep || 'wasm') && current.threads === (o.threads || 1)) return Promise.resolve(current.info);
      return (async function () {
        API.unload();
        var got = await modelBytes(m, onProgress, o.cache !== false, o.signal);
        if (o.signal && o.signal.aborted) throw aborted();
        if (onProgress) onProgress({ fraction: 1, stage: 'starting', cached: got.cached });
        startWorker();
        var onAbort = function () { killWorker(aborted()); };
        if (o.signal) o.signal.addEventListener('abort', onAbort, { once: true });
        try {
          var info = await call('init', {
            model: { id: m.id, size: m.size, mean: m.norm.mean, std: m.norm.std, sigmoid: m.sigmoid, minmax: m.minmax !== false },
            bytes: got.buf, ep: o.ep || 'wasm', threads: o.threads || 1, graphOpt: o.graphOpt, needF16: !!m.fp16, warmup: m.warmup !== false,
            ortBase: abs('assets/vendor/ort/'), webgpuBase: o.ep === 'webgpu' || o.ep === 'auto' ? abs('assets/vendor/ort-webgpu/') : null
          }, [got.buf]);
          info.model = id; info.fromCache = got.cached;
          current = { id: id, ep: o.ep || 'wasm', threads: o.threads || 1, info: info };
          return info;
        } catch (e) {
          if (worker) killWorker(e);
          if (isAbort(e)) throw aborted();
          if (/fetch|import|load|network/i.test(e.message || '') && navigator.onLine === false) throw coded('You are offline, and the AI engine has not been downloaded yet.', 'offline', e);
          throw coded(isMemory(e) ? 'This device ran out of memory while starting the model.' : 'The AI engine could not start: ' + (e.message || e), isMemory(e) ? 'memory' : 'engine', e);
        } finally {
          if (o.signal) o.signal.removeEventListener('abort', onAbort);
        }
      })();
    },

    /* src: ImageBitmap | canvas | OffscreenCanvas | ImageData | HTMLImageElement.
       opts: { refine: 'none'|'guided', feather, harden: [lo, hi], decontaminate, maxSide, stats, maskOnly, signal } */
    run: async function (src, opts) {
      opts = Object.assign({}, opts || {});
      if (!current || !worker) throw new Error('Load a model first');
      var signal = opts.signal; delete opts.signal;
      if (signal && signal.aborted) throw aborted();
      var bmp = await createImageBitmap(src);
      var onAbort = null;
      if (signal) { onAbort = function () { killWorker(aborted()); }; signal.addEventListener('abort', onAbort, { once: true }); }
      try {
        var r = await call('run', { bitmap: bmp, opts: opts }, [bmp]);
        var canvas = null;
        if (r.cut) {
          canvas = document.createElement('canvas');
          canvas.width = r.width; canvas.height = r.height;
          canvas.getContext('2d').drawImage(r.cut, 0, 0);
          r.cut.close();
        }
        var m8 = new Uint8ClampedArray(r.mask), rgba = new Uint8ClampedArray(r.width * r.height * 4);
        for (var i = 0; i < m8.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = m8[i]; }
        return { mask: new ImageData(rgba, r.width, r.height), canvas: canvas, width: r.width, height: r.height, timings: r.timings, stats: r.stats, model: current && current.id };
      } finally {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      }
    },

    /* One call for the studio: load (from cache when possible), run at the device's cap, check coverage, retry smaller on OOM. */
    cutout: async function (src, opts) {
      opts = opts || {};
      var id = opts.model || 'u2netp';
      var maxSide = opts.maxSide || budget().maxSide;
      var srcSide = Math.max(src.naturalWidth || src.width || 0, src.naturalHeight || src.height || 0);
      if (srcSide) maxSide = Math.min(maxSide, srcSide);
      var t0 = performance.now(), info, res, tries = 0;
      for (;;) {
        try {
          info = await API.load(id, opts.onProgress, { signal: opts.signal });
          if (opts.onProgress) opts.onProgress({ fraction: 1, stage: 'running' });
          res = await API.run(src, { refine: opts.refine || 'guided', harden: [0.2, 0.8], despeckle: opts.despeckle == null ? 0.03 : opts.despeckle, maxSide: maxSide, stats: true, maskOnly: true, signal: opts.signal });
          break;
        } catch (e) {
          if (isAbort(e) || (opts.signal && opts.signal.aborted)) throw aborted();
          if (e.code === 'offline' || e.code === 'download' || e.code === 'unsupported' || e.code === 'quota') throw e;
          var mem = e.code === 'memory' || isMemory(e) || !worker;
          if (tries === 0 && mem && maxSide > 512) { tries++; maxSide = Math.round(maxSide / 2); API.unload(); continue; }
          throw coded(mem ? 'This device ran out of memory for this photo.' : (e.message || 'The cut-out failed.'), mem ? 'memory' : (e.code || 'engine'), e);
        }
      }
      var coverage = res.stats && res.stats.coverage != null ? res.stats.coverage : null;
      if (coverage != null && (coverage < 0.03 || coverage > 0.97)) {
        var ns = coded('No clear subject found in this photo.', 'no-subject');
        ns.coverage = coverage;
        throw ns;
      }
      var c = document.createElement('canvas');
      c.width = res.width; c.height = res.height;
      c.getContext('2d').putImageData(res.mask, 0, 0);
      return { mask: c, coverage: coverage, width: res.width, height: res.height, model: id, timings: Object.assign({ wallMs: performance.now() - t0, loadMs: info && info.timings }, res.timings), maxSide: maxSide, retried: tries > 0 };
    },

    /* Re-compose a cut-out from any source plus a stored mask (ImageData with alpha, or a canvas whose alpha is the mask). */
    applyMask: function (src, mask, w, h) {
      var sw = w || src.naturalWidth || src.videoWidth || src.width, sh = h || src.naturalHeight || src.videoHeight || src.height;
      var c = document.createElement('canvas'); c.width = sw; c.height = sh;
      var x = c.getContext('2d');
      x.drawImage(src, 0, 0, sw, sh);
      var mc = mask;
      if (mask instanceof ImageData) { mc = document.createElement('canvas'); mc.width = mask.width; mc.height = mask.height; mc.getContext('2d').putImageData(mask, 0, 0); }
      x.globalCompositeOperation = 'destination-in';
      x.imageSmoothingQuality = 'high';
      x.drawImage(mc, 0, 0, sw, sh);
      return c;
    },
    maskCanvas: canvasFromMask,

    unload: function () {
      if (worker) { try { worker.postMessage({ type: 'dispose', id: ++seq }); } catch (e) { /* ignore */ } worker.terminate(); worker = null; }
      rejectAll(aborted());
      current = null;
    },

    /* Cache Storage helpers for the storage manager and the model chooser. */
    cachedModels: async function () {
      var c = await openCache(); if (!c) return [];
      var keys = await c.keys(), out = [];
      for (var i = 0; i < keys.length; i++) {
        var r = await c.match(keys[i]);
        out.push({ url: keys[i].url, id: r.headers.get('x-le-model'), bytes: +r.headers.get('content-length') || 0 });
      }
      return out;
    },
    remove: async function (id) {
      var m = find(id), c = await openCache();
      if (current && current.id === id) API.unload();
      return !!(m && c && await c.delete(abs(m.path)));
    },
    clearCache: function () { API.unload(); return global.caches ? caches.delete(CACHE) : Promise.resolve(false); }
  };
})(window);
