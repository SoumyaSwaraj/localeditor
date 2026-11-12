/* LocalEditor background remover: page-side API.  window.LE.bgRemove
 *
 *   LE.bgRemove.models()                      -> [{ id, label, tier, bytes, size, ... }]
 *   LE.bgRemove.load(modelId, onProgress, o)  -> Promise<{ model, ep, threads, timings }>   (downloads + caches bytes, starts the worker)
 *   LE.bgRemove.run(src, opts)                -> Promise<{ mask: ImageData, canvas, width, height, timings, stats }>
 *   LE.bgRemove.applyMask(src, mask)          -> canvas   (re-compose a stored mask over a source, non-destructively)
 *   LE.bgRemove.unload()                      -> frees the worker, the session and the model memory
 *
 * Nothing is fetched or started until load() is called. Model bytes are kept in Cache Storage under 'le-models-v1'.
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};

  var CACHE = 'le-models-v1';
  var scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  var cfg = { root: new URL('../../', scriptUrl).href };   /* site root; the studio overrides this with config({ root: '/' }) */

  /* mean/std are applied to RGB scaled 0..1. sigmoid: the model outputs logits. */
  var IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
  var MODELS = [
    { id: 'u2netp', label: 'Fast (u2netp)', tier: 'fast', size: 320, bytes: 4574861, path: 'assets/models/u2netp.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'Apache-2.0', bundled: true },
    { id: 'u2netp-int8', label: 'u2netp int8 (dynamic quant)', tier: 'eval', size: 320, bytes: 1321751, path: 'assets/models/local/u2netp-int8.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'Apache-2.0 (derived)', bundled: false },
    { id: 'u2net-int8', label: 'u2net int8 (dynamic quant)', tier: 'eval', size: 320, bytes: 44212603, path: 'assets/models/local/u2net-int8.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'Apache-2.0 (derived)', bundled: false },
    { id: 'u2net_human_seg-int8', label: 'u2net human seg int8', tier: 'eval', size: 320, bytes: 44212603, path: 'assets/models/local/u2net_human_seg-int8.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'people', licence: 'Apache-2.0 (derived)', bundled: false },
    { id: 'isnet-int8', label: 'IS-Net general int8', tier: 'eval', size: 1024, bytes: 46360717, path: 'assets/models/local/isnet-general-use-int8.onnx',
      norm: { mean: [0.5, 0.5, 0.5], std: [1, 1, 1] }, sigmoid: false, subject: 'general', licence: 'Apache-2.0 code; weights trained on non-commercial DIS5K', bundled: false },
    { id: 'silueta', label: 'silueta (u2net, reduced)', tier: 'eval', size: 320, bytes: 44173029, path: 'assets/models/local/silueta.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'unverified', bundled: false },
    { id: 'u2net', label: 'u2net (full)', tier: 'eval', size: 320, bytes: 175997641, path: 'assets/models/local/u2net.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'general', licence: 'Apache-2.0', bundled: false },
    { id: 'u2net_human_seg', label: 'u2net human seg', tier: 'eval', size: 320, bytes: 175997641, path: 'assets/models/local/u2net_human_seg.onnx',
      norm: IMAGENET, sigmoid: false, subject: 'people', licence: 'Apache-2.0', bundled: false },
    { id: 'isnet-general-use', label: 'IS-Net general use', tier: 'eval', size: 1024, bytes: 178648008, path: 'assets/models/local/isnet-general-use.onnx',
      norm: { mean: [0.5, 0.5, 0.5], std: [1, 1, 1] }, sigmoid: false, subject: 'general', licence: 'Apache-2.0 code; weights trained on non-commercial DIS5K', bundled: false },
    { id: 'birefnet-lite', label: 'BiRefNet (Swin-tiny)', tier: 'quality', size: 1024, bytes: 224005088, path: 'assets/models/local/BiRefNet-swin-tiny.onnx',
      norm: IMAGENET, sigmoid: true, subject: 'general', licence: 'MIT code; training data caveats', bundled: false }
  ];

  var worker = null, current = null, seq = 0, pending = {}, loading = null;

  function abs(p) { return new URL(p, cfg.root).href; }
  function find(id) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i]; return null; }

  /* ---------- model bytes: Cache Storage first, network second, with progress ---------- */
  async function modelBytes(m, onProgress, useCache) {
    var url = abs(m.path), cache = null, req = new Request(url);
    if (useCache && global.caches) { try { cache = await caches.open(CACHE); } catch (e) { cache = null; } }
    if (cache) {
      var hit = await cache.match(req);
      if (hit) {
        var buf = await hit.arrayBuffer();
        if (onProgress) onProgress({ loaded: buf.byteLength, total: buf.byteLength, fraction: 1, cached: true });
        return { buf: buf, cached: true };
      }
    }
    var res = await fetch(url);
    if (!res.ok) throw new Error('Model not available (' + res.status + '): ' + m.path);
    var total = +res.headers.get('content-length') || m.bytes, loaded = 0, chunks = [];
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
    var out = new Uint8Array(loaded), off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    chunks = null;
    if (cache) {
      try {
        await cache.put(req, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded), 'x-le-model': m.id } }));
      } catch (e) { /* quota: run anyway */ }
    }
    return { buf: out.buffer, cached: false };
  }

  /* ---------- worker plumbing ---------- */
  function call(type, payload, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      var msg = payload || {}; msg.id = id; msg.type = type;
      worker.postMessage(msg, transfer || []);
    });
  }
  function killWorker(reason) {
    if (worker) { worker.terminate(); worker = null; }
    Object.keys(pending).forEach(function (k) { pending[k].reject(new DOMException(reason || 'Stopped', 'AbortError')); delete pending[k]; });
    current = null;
  }
  function startWorker() {
    worker = new Worker(new URL('bg-worker.js', scriptUrl));
    worker.onmessage = function (e) {
      var d = e.data, p = pending[d.id];
      if (!p) return;
      delete pending[d.id];
      if (d.ok) p.resolve(d); else p.reject(new Error(d.error || 'Worker error'));
    };
    worker.onerror = function (e) {
      var msg = (e && e.message) || 'Worker failed to start';
      Object.keys(pending).forEach(function (k) { pending[k].reject(new Error(msg)); delete pending[k]; });
    };
  }

  /* ---------- public API ---------- */
  var API = LE.bgRemove = {
    config: function (o) { if (o && o.root) cfg.root = new URL(o.root, location.href).href; return cfg; },

    models: function () { return MODELS.map(function (m) { return Object.assign({}, m, { url: abs(m.path) }); }); },

    /* HEAD probe: is the model file actually hosted here? (Evaluation models are not committed.) */
    isAvailable: async function (id) {
      var m = find(id); if (!m) return false;
      try { var r = await fetch(abs(m.path), { method: 'HEAD' }); return r.ok && /octet|onnx/.test(r.headers.get('content-type') || 'octet'); } catch (e) { return false; }
    },

    isLoaded: function () { return current ? current.id : null; },

    /* o: { ep: 'auto'|'wasm'|'webgpu', threads: n, cache: bool } */
    load: function (id, onProgress, o) {
      o = o || {};
      var m = find(id);
      if (!m) return Promise.reject(new Error('Unknown model: ' + id));
      if (current && current.id === id && current.ep === (o.ep || 'wasm') && current.threads === (o.threads || 1)) return Promise.resolve(current.info);
      loading = (async function () {
        API.unload();
        var got = await modelBytes(m, onProgress, o.cache !== false);
        if (onProgress) onProgress({ fraction: 1, stage: 'starting', cached: got.cached });
        startWorker();
        var ortBase = abs('assets/vendor/ort/'), webgpuBase = abs('assets/vendor/ort-webgpu/');
        var info = await call('init', {
          model: { id: m.id, size: m.size, mean: m.norm.mean, std: m.norm.std, sigmoid: m.sigmoid },
          bytes: got.buf, ep: o.ep || 'wasm',
          threads: o.threads || 1, graphOpt: o.graphOpt, ortBase: ortBase, webgpuBase: o.ep === 'webgpu' || o.ep === 'auto' ? webgpuBase : null
        }, [got.buf]);
        info.model = id; info.fromCache = got.cached;
        current = { id: id, ep: o.ep || 'wasm', threads: o.threads || 1, info: info };
        return info;
      })();
      return loading;
    },

    /* src: ImageBitmap | canvas | OffscreenCanvas | ImageData | HTMLImageElement.
       opts: { refine: 'none'|'guided', feather: px, harden: [lo, hi], decontaminate: bool, maxSide: 2560, stats: bool, signal: AbortSignal } */
    run: async function (src, opts) {
      opts = Object.assign({}, opts || {});
      if (!current) throw new Error('Load a model first');
      var signal = opts.signal; delete opts.signal;
      if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      var bmp = (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) ? await createImageBitmap(src) : await createImageBitmap(src);
      var onAbort = null;
      if (signal) {
        onAbort = function () { killWorker('Cancelled'); };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        var r = await call('run', { bitmap: bmp, opts: opts }, [bmp]);
        var canvas = document.createElement('canvas');
        canvas.width = r.width; canvas.height = r.height;
        canvas.getContext('2d').drawImage(r.cut, 0, 0);
        r.cut.close();
        var m8 = new Uint8ClampedArray(r.mask), rgba = new Uint8ClampedArray(r.width * r.height * 4);
        for (var i = 0; i < m8.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = m8[i]; }
        return { mask: new ImageData(rgba, r.width, r.height), canvas: canvas, width: r.width, height: r.height, timings: r.timings, stats: r.stats, model: current && current.id };
      } finally {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      }
    },

    /* Re-compose a cut-out from any source plus a stored mask (ImageData with alpha, or a canvas whose alpha is the mask). Scales the mask bilinearly. */
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

    unload: function () {
      if (worker) { try { worker.postMessage({ type: 'dispose', id: ++seq }); } catch (e) { /* ignore */ } worker.terminate(); worker = null; }
      Object.keys(pending).forEach(function (k) { pending[k].reject(new DOMException('Unloaded', 'AbortError')); delete pending[k]; });
      current = null;
    },

    /* Cache Storage helpers for the storage manager. */
    cachedModels: async function () {
      if (!global.caches) return [];
      var c = await caches.open(CACHE), keys = await c.keys(), out = [];
      for (var i = 0; i < keys.length; i++) {
        var r = await c.match(keys[i]);
        out.push({ url: keys[i].url, id: r.headers.get('x-le-model'), bytes: +r.headers.get('content-length') || 0 });
      }
      return out;
    },
    clearCache: function () { return global.caches ? caches.delete(CACHE) : Promise.resolve(false); }
  };
})(window);
