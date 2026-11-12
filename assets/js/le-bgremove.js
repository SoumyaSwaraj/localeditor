/* LocalEditor background remover: on-device subject cut-out.  window.LE.bgRemove
 *
 * Loaded on demand (LE.lazy) the first time someone asks for a cut-out; nothing here runs or downloads before that.
 * Inference runs in assets/js/le-bgremove-worker.js on onnxruntime-web (WASM, one thread unless the page is
 * cross-origin isolated). Model bytes are kept in Cache Storage 'le-models-v1', keyed by URL, with an x-le-model header.
 *
 *   LE.bgRemove.models()                         -> [{ id, name, label, about, goodAt, tier, bytes, size, subject, licence, supportId, memoryMB, url }]
 *   LE.bgRemove.register(model)                  -> add a model to the registry (labs use this for evaluation models)
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
  /* memoryMB = measured peak browser RSS minus an idle tab (docs/research/background-remover.md, rounded up). */
  var MODELS = [
    { id: 'u2netp', name: 'Fast', label: 'Fast (u2netp)', tier: 'fast', size: 320, bytes: 4574861, path: 'assets/models/u2netp.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'Apache-2.0', bundled: true, supportId: 'cutout.fast', memoryMB: 700, downloadMB: 7,
      about: 'Quick, small download.', goodAt: 'One clear subject: a person, a pet, a product' },
    { id: 'u2net-int8', name: 'Detailed', label: 'Detailed (u2net int8)', tier: 'detailed', size: 320, bytes: 44212603, path: 'assets/models/u2net-int8.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'Apache-2.0 (int8 derived)', bundled: true, supportId: 'cutout.detailed', memoryMB: 1000, downloadMB: 44,
      about: 'Fuller, cleaner masks. About twice as slow.', goodAt: 'Objects with thin parts, groups, busy edges' },
    { id: 'u2net_human_seg-int8', name: 'People', label: 'People (u2net human seg int8)', tier: 'people', size: 320, bytes: 44212602, path: 'assets/models/u2net_human_seg-int8.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'people', licence: 'Apache-2.0 (int8 derived)', bundled: true, supportId: 'cutout.people', memoryMB: 1000, downloadMB: 44,
      about: 'Best on portraits and groups. Poor on anything else.', goodAt: 'Portraits, selfies, groups of people' }
  ];

  /* Device-support declarations (LE.support reads these whenever it loads; order does not matter). */
  var defs = global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || [];
  MODELS.forEach(function (m) {
    if (defs.some(function (d) { return d && d.id === m.supportId; })) return;
    defs.push({ id: m.supportId, name: 'Background remover (' + m.name + ')', needs: NEEDS.slice(), wants: [], memoryMB: m.memoryMB, downloadMB: m.downloadMB });
  });
  function describe() {
    if (!global.LEPwa || typeof global.LEPwa.describeModel !== 'function') return;
    MODELS.forEach(function (m) { if (m.bundled) global.LEPwa.describeModel(m.id, { name: 'Background remover (' + m.name.toLowerCase() + ')', about: m.goodAt }); });
  }
  describe();
  if (!global.LEPwa) global.addEventListener('le-pwa-ready', describe, { once: true });

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
      return Promise.resolve().then(function () { return LE.support.check(m.supportId); }).then(function (r) {
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
    var res;
    try { res = await fetch(url, signal ? { signal: signal } : undefined); }
    catch (e) { if (isAbort(e)) throw aborted(); throw coded('The model could not be downloaded. Check your connection and try again.', navigator.onLine === false ? 'offline' : 'download', e); }
    if (!res.ok) throw coded('The model could not be downloaded (' + res.status + ').', 'download');
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
    if (m.bytes && Math.abs(loaded - m.bytes) > 16 && m.bundled) throw coded('The model download was incomplete. Try again.', 'download');
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
    register: function (m) {
      if (!m || !m.id || find(m.id)) return false;
      MODELS.push(Object.assign({ norm: IMAGENET, sigmoid: false, size: 320, subject: 'general', bundled: false, memoryMB: 1000, name: m.label || m.id, about: '', goodAt: '' }, m));
      return true;
    },
    budget: budget,
    support: support,
    gate: gate,

    isAvailable: async function (id) {
      var m = find(id); if (!m) return false;
      try { var r = await fetch(abs(m.path), { method: 'HEAD' }); return r.ok && /octet|onnx/.test(r.headers.get('content-type') || 'octet'); } catch (e) { return false; }
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
      var engine = !!(c && await c.match(abs('assets/vendor/ort/ort-wasm-simd-threaded.wasm')));
      var bytes = (model ? 0 : (m ? m.bytes : 0)) + (engine ? 0 : 2900000);
      return { bytes: bytes, model: !model, engine: !engine, cached: model };
    },

    /* o: { ep: 'auto'|'wasm'|'webgpu', threads: n, cache: bool, signal } */
    load: function (id, onProgress, o) {
      o = o || {};
      var m = find(id);
      if (!m) return Promise.reject(new Error('Unknown model: ' + id));
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
            model: { id: m.id, size: m.size, mean: m.norm.mean, std: m.norm.std, sigmoid: m.sigmoid },
            bytes: got.buf, ep: o.ep || 'wasm', threads: o.threads || 1, graphOpt: o.graphOpt,
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
          res = await API.run(src, { refine: opts.refine || 'guided', harden: [0.2, 0.8], maxSide: maxSide, stats: true, maskOnly: true, signal: opts.signal });
          break;
        } catch (e) {
          if (isAbort(e) || (opts.signal && opts.signal.aborted)) throw aborted();
          if (e.code === 'offline' || e.code === 'download' || e.code === 'unsupported') throw e;
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
