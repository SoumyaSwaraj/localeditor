/* LocalEditor maps: on-device depth, normals, face landmarks and person segments.  window.LE.maps
 *
 * The product module (X6), promoted from the S2 prototype in labs/maps/ (docs/research/depth-face-maps.md). labs/maps/maps.js
 * now only loads this file, so the lab's function shapes are this module's shapes and stay stable.
 * Lazy: loading this file declares support entries and model names and fetches nothing; no model, engine or worker starts
 * until a call asks. Inference runs in assets/js/le-maps-worker.js on onnxruntime-web (assets/vendor/ort/, WebAssembly;
 * WebGPU only when asked or when a model is built for it, as le-bgremove.js does). Model bytes live in Cache Storage
 * 'le-models-v1' (x-le-model header), so the storage manager lists them under their plain names. Downloads go through
 * LE.downloads: no question in the normal flow, one when its rules say so. Photos, landmarks and maps never leave the device.
 *
 *   LE.maps.models() / model(id) / budget() / support(kind) / gate(kind, { run }) / ep(kind)
 *   LE.maps.depth(image, { model, maxSide, refine, ep, signal, onProgress, confirmed })
 *        -> { depth: Float32Array (width*height, row-major, top row first; 0 = farthest, 1 = nearest, robust-normalised
 *             relative disparity, NOT metric), width, height, model, version, orientation: 'near=1', timings, refined }
 *   LE.maps.depthMap(image, opts)        -> { canvas (packed 16-bit, PNG-ready, at the model grid), entry (layer.maps.depth without asset), result }
 *   LE.maps.normals(depth, { strength, smooth, format }) -> canvas RGB (x right, y UP, z to the viewer; rgb = 0.5 + 0.5 * n). Derived, never stored.
 *   LE.maps.face(image, { maxFaces, signal, onProgress, parts, blendshapes, scan, maxSide })
 *        -> [{ box, landmarks: [[x,y,z] x 478], blendshapes?, parts: { skin, eyes, lips, teeth, brows, underEyes, innerMouth },
 *              score, rotation, maps: { skin: canvas|null, hair: canvas|null }, image: { width, height }, model, version }]
 *      x, y, z and box are fractions of the analysed image (z in the same unit as x, 0 at the head centre, smaller = nearer).
 *      Each part is { rings: [[[x,y]...]...], rule: 'nonzero' | 'evenodd' } in the same fractions.
 *   LE.maps.faces(image, opts)           -> { faces: [packed faces, about 4 KB each, ready for layer.maps.face], image }
 *   LE.maps.segments(image, { maxSide, refine, signal, onProgress }) -> { person, hair, skin, clothes, background: canvases (white, alpha = mask), width, height, model, version }
 *   LE.maps.faceMask(face, part, w, h, { feather, grow, image })  -> canvas (white, alpha = mask)
 *   LE.maps.refineDepth(result, image, { radius, eps })           -> result at the photo's resolution (guided filter, photo as guide)
 *   LE.maps.pack.depth(result) / unpack.depth(canvas | image)     16-bit depth in an RGBA canvas (R high byte, G low byte), lossless as PNG
 *   LE.maps.pack.face(face) / unpack.face(obj)                     compact JSON for layer.maps.face (about 4 KB per face)
 *   LE.maps.pack.segments(res) / unpack.segments(rgb, clothes)     opaque RGB (R person, G hair, B skin) and a grey clothes plane
 *   LE.maps.ops.apply(scene | doc, { op: 'map.generate', layer, kind: 'depth' | 'faces' | 'segments', model?, force? }, opts)
 *   LE.maps.ops.run(op, { layer, image(layer), store(canvas, name) })   the same for any host: resolves { ok, maps, asset }
 *   LE.maps.isCached(id) / prefetch(id) / remove(id) / cachedModels() / unload(kind) / downloadSize(id)
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.maps && LE.maps.shared) return;

  var CACHE = 'le-models-v1', VERSION = 'maps-1';
  var scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  var cfg = { root: new URL('../../', scriptUrl).href, worker: new URL('le-maps-worker.js', scriptUrl).href };
  var IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
  var NEEDS = ['wasm', 'wasm-simd', 'worker', 'offscreen-canvas'];

  /* ---------- Model registry (plain data, same idea as le-bgremove.js) ----------
   * kind 'depth' | 'face' | 'parts'. A 'face' entry has three files (detector, landmarks, blendshapes) that load together.
   * Labels name the purpose, never the network. Technical facts sit under `about`, shown only behind "About this option". */
  var MODELS = [
    { id: 'depth-small', kind: 'depth', label: 'Depth map', bestFor: 'Blur the background, add haze, light a subject from the side', quality: 2, speed: 'medium', downloadMB: 16,
      supportId: 'maps.depth', tier: 'standard', runtime: 'wasm', memoryMB: 450,
      files: { depth: { path: 'assets/models/maps/depth_anything_v2_small_q4.onnx', bytes: 15737423 } },
      spec: { side: 518, warm: 14, grid: 14, mean: IMAGENET.mean, std: IMAGENET.std, sides: [266, 392, 518] },
      about: { model: 'Depth Anything V2 Small, 4-bit transformer weights and 8-bit head (made by LocalEditor), 14-pixel grid, up to 518 px', licence: 'Apache-2.0 (code and weights)', source: 'huggingface.co/depth-anything/Depth-Anything-V2-Small', notes: 'Relative depth only, not metric. Trained mostly on synthetic images with pseudo-labels on public photo sets.' } },
    { id: 'depth-small-int8', kind: 'depth', label: 'Depth map (finer)', bestFor: 'The same depth map with a little more fine detail', quality: 3, speed: 'medium', downloadMB: 26,
      supportId: 'maps.depth', tier: 'pro', runtime: 'wasm', memoryMB: 500,
      files: { depth: { path: 'assets/models/maps/local/depth_anything_v2_small_int8.onnx', bytes: 25726146 } },
      spec: { side: 518, warm: 14, grid: 14, mean: IMAGENET.mean, std: IMAGENET.std, sides: [266, 392, 518] },
      about: { model: 'Depth Anything V2 Small, 8-bit weights (made by LocalEditor), 14-pixel grid, up to 518 px', licence: 'Apache-2.0 (code and weights)', source: 'huggingface.co/depth-anything/Depth-Anything-V2-Small', notes: 'Larger than the repository file limit: lives on S3, produced by labs/maps/tools/derive.py.' } },
    { id: 'depth-small-fp32', kind: 'depth', label: 'Depth map (reference)', bestFor: 'Evaluation only', quality: 2, speed: 'slow', downloadMB: 99,
      supportId: 'maps.depth', tier: 'eval', runtime: 'wasm', memoryMB: 900,
      files: { depth: { path: 'assets/models/maps/local/depth_anything_v2_small_fp32.onnx', bytes: 99060839 } },
      spec: { side: 518, warm: 14, grid: 14, mean: IMAGENET.mean, std: IMAGENET.std, sides: [266, 392, 518] },
      about: { model: 'Depth Anything V2 Small, float32', licence: 'Apache-2.0', source: 'huggingface.co/onnx-community/depth-anything-v2-small' } },
    { id: 'face-landmarks', kind: 'face', label: 'Face map', bestFor: 'Find eyes, lips and skin for retouching and face-aware reshaping', quality: 2, speed: 'fast', downloadMB: 4,
      supportId: 'maps.face', tier: 'standard', runtime: 'wasm', memoryMB: 400,
      files: {
        detector: { path: 'assets/models/maps/face_detector.onnx', bytes: 228409 },
        landmarks: { path: 'assets/models/maps/face_landmarks.onnx', bytes: 2557688 },
        blend: { path: 'assets/models/maps/face_blendshapes.onnx', bytes: 992811, optional: true }
      },
      spec: {},
      about: { model: 'MediaPipe BlazeFace short-range, Face Landmarker v2 (478 points) and Blendshape v2, float16 weights', licence: 'Apache-2.0 (code and weights)', source: 'storage.googleapis.com/mediapipe-models/face_landmarker', notes: 'Computed on this device. Not used to identify anyone.' } },
    { id: 'face-parts', kind: 'parts', label: 'Hair and skin detail', bestFor: 'Keeps hair and beard out of skin smoothing', quality: 2, speed: 'fast', downloadMB: 9,
      supportId: 'maps.faceparts', tier: 'standard', runtime: 'wasm', memoryMB: 400,
      files: { parts: { path: 'assets/models/maps/selfie_multiclass.onnx', bytes: 8356582 } },
      spec: {},
      about: { model: 'MediaPipe multi-class selfie segmenter (hair, body skin, face skin, clothes), float16 weights', licence: 'Apache-2.0', source: 'storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256', notes: 'Trained on a Google-internal photo set; weaker on heavy make-up, head coverings and unusual lighting.' } }
  ];
  var QUALITY = ['', 'Good', 'Better', 'Best'];
  MODELS.forEach(function (m) {
    m.needs = NEEDS.slice();
    m.listed = m.tier === 'standard' || m.tier === 'pro';
    m.speedLabel = { fast: 'Fast', medium: 'Takes a little longer', slow: 'Takes a while' }[m.speed];
    m.qualityLabel = QUALITY[m.quality];
    m.name = m.label;
    m.sizeLabel = m.label + ' — small download, about ' + m.downloadMB + ' MB, one time';
  });
  function find(id) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i]; return null; }
  function firstOf(kind) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i].kind === kind && MODELS[i].tier === 'standard') return MODELS[i]; return null; }

  /* Sizes are filled from the files themselves the first time a HEAD says so; until then the numbers above are the plan. */
  var SUPPORT = [
    { id: 'maps.depth', name: 'Depth map', group: 'On-device AI', needs: NEEDS, wants: ['cache-storage'], memoryMB: 450, downloadMB: 19, note: 'Needs about 450 MB while it runs. About 1 to 3 seconds per photo on a computer, 3 to 12 on a phone.' },
    { id: 'maps.face', name: 'Face map', group: 'On-device AI', needs: NEEDS, wants: ['cache-storage'], memoryMB: 400, downloadMB: 7, note: 'About half a second per face on a computer. Face points are computed on this device and never sent anywhere.' },
    { id: 'maps.faceparts', name: 'Hair and skin detail', group: 'On-device AI', needs: NEEDS, wants: ['cache-storage'], memoryMB: 400, downloadMB: 9, note: 'Optional add-on to the face map.' }
  ];
  (function declare() {
    var defs = global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || [];
    SUPPORT.forEach(function (d) { if (!defs.some(function (x) { return x && x.id === d.id; })) defs.push(d); });
    function describe() {
      if (!global.LEPwa || typeof global.LEPwa.describeModel !== 'function') return;
      MODELS.forEach(function (m) {
        if (!m.listed) return;
        var a = m.about || {};
        global.LEPwa.describeModel(m.id, { name: m.label, about: m.bestFor + (a.model ? ' (' + a.model + (a.licence ? ', ' + a.licence : '') + ')' : '') });
      });
    }
    describe();
    if (!global.LEPwa) global.addEventListener('le-pwa-ready', describe, { once: true });
  })();

  /* ---------- helpers ---------- */
  function abs(p) { return new URL(p, cfg.root).href; }
  function coded(msg, code, cause) { var e = new Error(msg); e.code = code; if (cause) e.cause = cause; return e; }
  function aborted() { var e = new Error('Cancelled'); e.name = 'AbortError'; e.code = 'cancelled'; return e; }
  function isAbort(e) { return e && (e.name === 'AbortError' || e.code === 'cancelled'); }
  function isMemory(e) { return /out of memory|memory|heap|allocation|RangeError|code \d+/i.test(String(e && (e.message || e))); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function srcSize(src) { return { w: src.naturalWidth || src.videoWidth || src.width, h: src.naturalHeight || src.videoHeight || src.height }; }
  /* Errors that a retry at half size cannot fix. */
  var FINAL = { offline: 1, download: 1, unsupported: 1, declined: 1, quota: 1 };
  /* Execution provider, the remover's rule: WebAssembly unless a model is built for WebGPU (runtime 'webgpu') or the person
     chose it (localStorage 'le-maps-ep' = 'auto' | 'webgpu'). The committed 4-bit depth file's WebGPU operator coverage is
     unverified and no GPU timing exists (research S2), so nothing selects WebGPU by default; 'auto' tries it and falls back. */
  function epFor(kind) {
    var m = firstOf(kind === 'segments' ? 'parts' : kind), pref = null;
    try { pref = global.localStorage && localStorage.getItem('le-maps-ep'); } catch (e) { pref = null; }
    if (pref === 'auto' || pref === 'webgpu' || pref === 'wasm') return pref;
    return m && m.runtime === 'webgpu' ? 'auto' : 'wasm';
  }

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
    return { tier: t, depthSide: t === 'desktop' ? 518 : t === 'modern' ? 392 : 266, faceSide: t === 'desktop' ? 2048 : t === 'modern' ? 1536 : 1024 };
  }

  var SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  function localCheck(m) {
    var reasons = [], status = 'ok';
    if (typeof WebAssembly !== 'object') { status = 'unsupported'; reasons.push('This browser cannot run WebAssembly, which the maps need.'); }
    else { var simd = false; try { simd = WebAssembly.validate(SIMD); } catch (e) { /* ignore */ } if (!simd) { status = 'unsupported'; reasons.push('This browser lacks WebAssembly SIMD.'); } }
    if (typeof Worker === 'undefined') { status = 'unsupported'; reasons.push('This browser cannot run background workers.'); }
    if (typeof OffscreenCanvas === 'undefined') { status = 'unsupported'; reasons.push('This browser lacks OffscreenCanvas.'); }
    var mem = navigator.deviceMemory;
    if (status === 'ok' && mem && mem * 1024 < m.memoryMB * 2.5) { status = 'limited'; reasons.push('This device reports ' + mem + ' GB of memory; this needs about ' + m.memoryMB + ' MB while it runs.'); }
    return { status: status, reasons: reasons, canForce: status !== 'unsupported' };
  }
  function support(kind) {
    var m = firstOf(kind) || find(kind);
    if (!m) return Promise.resolve({ status: 'unknown', reasons: ['Unknown map type.'], canForce: false });
    if (LE.support && typeof LE.support.check === 'function') {
      return Promise.resolve().then(function () { return LE.support.check(m.supportId); }).then(function (r) { return r && r.status ? r : localCheck(m); }, function () { return localCheck(m); });
    }
    return Promise.resolve(localCheck(m));
  }

  /* ---------- model bytes: Cache Storage first, network second, with progress ---------- */
  function openCache() { return global.caches ? caches.open(CACHE).catch(function () { return null; }) : Promise.resolve(null); }
  async function fileBytes(m, key, onChunk, signal) {
    var f = m.files[key], url = abs(f.path), cache = await openCache(), req = new Request(url);
    if (cache) {
      var hit = await cache.match(req);
      if (hit) { var b = await hit.arrayBuffer(); onChunk(b.byteLength, b.byteLength); return { buf: b, cached: true }; }
    }
    if (navigator.onLine === false) throw coded('You are offline, and this model has not been downloaded yet.', 'offline');
    var res;
    try { res = await fetch(url, signal ? { signal: signal } : undefined); }
    catch (e) { if (isAbort(e)) throw aborted(); throw coded('The model could not be downloaded. Check your connection and try again.', 'download', e); }
    if (!res.ok) { if (f.optional && res.status === 404) return null; throw coded('The model could not be downloaded (' + res.status + ').', 'download'); }
    var total = +res.headers.get('content-length') || f.bytes || 0, loaded = 0, chunks = [];
    try {
      var rd = res.body.getReader();
      for (;;) { var r = await rd.read(); if (r.done) break; chunks.push(r.value); loaded += r.value.length; onChunk(loaded, total || loaded); }
    } catch (e2) { if (isAbort(e2) || (signal && signal.aborted)) throw aborted(); throw coded('The download stopped part-way. Check your connection and try again.', 'download', e2); }
    var out = new Uint8Array(loaded), off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    if (cache) { try { await cache.put(req, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded), 'x-le-model': m.id } })); } catch (e3) { /* quota */ } }
    return { buf: out.buffer, cached: false };
  }

  /* ---------- workers: one per kind ('depth', 'face'), so a long depth run never blocks face work ---------- */
  var workers = { depth: null, face: null, segments: null }, current = { depth: null, face: null, segments: null }, seq = 0, pending = {};
  function call(w, type, payload, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++seq; pending[id] = { resolve: resolve, reject: reject, w: w, onStage: payload && payload.onStage };
      var msg = {}; Object.keys(payload || {}).forEach(function (k) { if (k !== 'onStage') msg[k] = payload[k]; });
      msg.id = id; msg.type = type; w.postMessage(msg, transfer || []);
    });
  }
  function rejectAllFor(w, err) { Object.keys(pending).forEach(function (k) { if (pending[k].w === w) { pending[k].reject(err); delete pending[k]; } }); }
  function killWorker(kind, err) {
    var w = workers[kind]; if (w) { w.terminate(); workers[kind] = null; rejectAllFor(w, err || aborted()); }
    current[kind] = null;
  }
  function startWorker(kind) {
    var w = new Worker(cfg.worker); workers[kind] = w;
    w.onmessage = function (e) {
      var d = e.data, p = pending[d.id];
      if (d.type === 'progress') { if (p && p.onStage) p.onStage(d.stage); return; }
      if (!p) return; delete pending[d.id];
      if (d.ok) p.resolve(d); else p.reject(new Error(d.error || 'Worker error'));
    };
    w.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var msg = (e && e.message) || 'The engine stopped';
      killWorker(kind, coded(msg, isMemory(msg) ? 'memory' : 'engine'));
    };
    return w;
  }

  /* ---------- the download policy (docs/DOWNLOADS.md): LE.downloads decides; without it, quietly up to 60 MB ---------- */
  var ENGINE_BYTES = 2900000;
  async function missingBytes(ids) {
    var c = await openCache(), bytes = 0;
    for (var i = 0; i < ids.length; i++) {
      var m = find(ids[i]); if (!m) continue;
      for (var k in m.files) { if (m.files[k].optional) continue; if (!(c && await c.match(abs(m.files[k].path)))) bytes += m.files[k].bytes || 0; }
    }
    return bytes;
  }
  async function allowDownload(ids, bytes, o) {
    if (!bytes) return null;
    var m = find(ids[0]), d = LE.downloads && typeof LE.downloads.request === 'function' ? LE.downloads : null;
    if (d) {
      var r = null;
      try { r = await d.request({ id: m.id, name: m.label, bytes: bytes, kind: 'model', reason: m.bestFor, confirmed: !!(o && o.confirmed), quiet: !!(o && o.quiet) }); } catch (e) { r = null; }
      if (!r || !r.ok) throw coded(r && r.why === 'space' ? 'There is not enough free space on this device for this download.' : 'The download was not started (' + ((r && r.why) || 'declined') + ').', r && r.why === 'space' ? 'quota' : 'declined');
      return typeof d.track === 'function' ? d.track(m.id, { name: m.label, bytes: bytes }) : null;
    }
    if (bytes > 60e6 && !(o && o.confirmed)) throw coded('This download is large; ask the person first, then call again with { confirmed: true }.', 'declined');
    return null;
  }

  /* Loads every model a kind needs (a face map may add the optional 'parts' model) into the kind's worker.
     o: { confirmed, quiet } for the download policy. ep: 'wasm' | 'auto' | 'webgpu'. */
  async function ensure(kind, ids, onProgress, signal, ep, o) {
    ep = ep === 'webgpu' || ep === 'auto' ? ep : 'wasm';
    var gpu = ep !== 'wasm' ? '@' + ep : '', key = ids.join('+') + gpu;
    /* Keep a running worker when it already holds everything asked for (a face call without the optional parts model reuses one that has it). */
    var cur = current[kind];
    if (workers[kind] && cur && (cur.gpu || '') === gpu && ids.every(function (id) { return cur.ids.indexOf(id) >= 0; })) return cur;
    killWorker(kind);
    var need = await missingBytes(ids), chip = await allowDownload(ids, need, o);
    var bytes = {}, specs = {}, got = {}, cachedAll = true, files = [];
    ids.forEach(function (id) { var m = find(id); if (!m) throw new Error('Unknown model: ' + id); Object.keys(m.files).forEach(function (k) { files.push({ m: m, k: k }); }); });
    var inner = new AbortController(), onOuter = function () { inner.abort(); };
    if (signal) { if (signal.aborted) throw aborted(); signal.addEventListener('abort', onOuter, { once: true }); }
    if (chip && chip.onCancel) chip.onCancel(function () { inner.abort(); });
    try {
      await Promise.all(files.map(function (f, i) {
        return fileBytes(f.m, f.k, function (l, t) {
          got[i] = [l, t];
          var L = 0, T = 0; Object.keys(got).forEach(function (j) { L += got[j][0]; T += got[j][1]; });
          if (chip && need) chip.progress(Math.min(need, Math.max(0, L - (T - need))), need);
          if (onProgress) onProgress({ loaded: L, total: T, fraction: T ? Math.min(1, L / T) : 0, stage: 'download' });
        }, inner.signal).then(function (r) {
        if (!r) return;
        if (!r.cached) cachedAll = false;
          var key2 = f.m.kind === 'parts' ? 'parts' : f.k;
          bytes[key2] = r.buf; specs[key2] = f.m.spec || {};
        });
      }));
      if (chip) chip.done();
    } catch (eD) {
      if (chip) chip.fail(eD);
      if (inner.signal.aborted) throw aborted();
      throw eD;
    } finally { if (signal) signal.removeEventListener('abort', onOuter); }
    if (signal && signal.aborted) throw aborted();
    if (onProgress) onProgress({ fraction: 1, stage: 'starting', cached: cachedAll });
    var w = startWorker(kind), t0 = performance.now();
    var onAbort = function () { killWorker(kind, aborted()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      var transfer = Object.keys(bytes).map(function (k) { return bytes[k]; });
      var info = await call(w, 'init', { kind: kind, bytes: bytes, specs: specs, ortBase: abs('assets/vendor/ort/'), threads: 1, ep: ep, webgpuBase: abs('assets/vendor/ort-webgpu/') }, transfer);
      current[kind] = { key: key, ids: ids, gpu: gpu, ep: info.ep, info: info, fromCache: cachedAll, startMs: performance.now() - t0 };
      return current[kind];
    } catch (e) {
      killWorker(kind, e);
      if (isAbort(e)) throw aborted();
      throw coded(isMemory(e) ? 'This device ran out of memory while starting the model.' : 'The engine could not start: ' + (e.message || e), isMemory(e) ? 'memory' : 'engine', e);
    } finally { if (signal) signal.removeEventListener('abort', onAbort); }
  }

  /* An ImageBitmap of the source, scaled so its long side is at most maxSide (0 = as is). Scaling goes through a canvas, not
     createImageBitmap's resize options, because Safari ignores those. */
  async function bitmapOf(src, maxSide) {
    var s = srcSize(src), k = maxSide && Math.max(s.w, s.h) > maxSide ? maxSide / Math.max(s.w, s.h) : 1;
    if (k === 1) return createImageBitmap(src);
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(s.w * k)); c.height = Math.max(1, Math.round(s.h * k));
    var x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return createImageBitmap(c);
  }

  /* ================================================================ depth ================================================================ */
  async function depth(src, o) {
    o = o || {};
    var m = find(o.model || firstOf('depth').id);
    if (!m || m.kind !== 'depth') throw new Error('Unknown depth model');
    var signal = o.signal, t0 = performance.now();
    var side = o.maxSide || budget().depthSide;
    side = Math.max(112, Math.round(side / 14) * 14);
    for (var tries = 0; ; tries++) {
      try {
        var st = await ensure('depth', [m.id], o.onProgress, signal, o.ep || epFor('depth'), o);
        if (o.onProgress) o.onProgress({ fraction: 1, stage: 'running' });
        var bmp = await bitmapOf(src, Math.max(1024, side * 2)), w = workers.depth; /* the model reads at most ~518 px; never ship a 24 MP bitmap to the worker */
        if (signal && signal.aborted) throw aborted();
        var onAbort = function () { killWorker('depth', aborted()); };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        var r;
        try { r = await call(w, 'depth', { bitmap: bmp, side: side }, [bmp]); }
        finally { if (signal) signal.removeEventListener('abort', onAbort); }
        var res = { depth: new Float32Array(r.depth), width: r.info.width, height: r.info.height, model: m.id, version: VERSION, orientation: 'near=1',
          timings: Object.assign({ wallMs: performance.now() - t0, startMs: st.startMs }, r.info.timings), side: side, refined: false, raw: { lo: r.info.rawLo, hi: r.info.rawHi } };
        if (o.refine) res = await refineDepth(res, src, typeof o.refine === 'object' ? o.refine : {});
        return res;
      } catch (e) {
        if (isAbort(e) || (signal && signal.aborted)) throw aborted();
        if (FINAL[e.code]) throw e;
        var mem = e.code === 'memory' || isMemory(e) || !workers.depth;
        if (tries === 0 && mem && side > 266) { side = Math.max(266, Math.round(side / 2 / 14) * 14); killWorker('depth'); continue; }
        throw coded(mem ? 'This device ran out of memory for this photo.' : (e.message || 'The depth map failed.'), mem ? 'memory' : (e.code || 'engine'), e);
      }
    }
  }

  /* Guided filter against the photo (long side capped at opts.maxSide, default 1024). */
  async function refineDepth(res, src, o) {
    o = o || {};
    var maxSide = o.maxSide || 1024, st = workers.depth && current.depth ? current.depth : await ensure('depth', [res.model], null, null), w = workers.depth;
    var bmp = await bitmapOf(src, maxSide), t0 = performance.now();
    var copy = new Float32Array(res.depth);
    var r = await call(w, 'refine', { bitmap: bmp, depth: copy.buffer, dw: res.width, dh: res.height, radius: o.radius == null ? 6 : o.radius, eps: o.eps == null ? 2e-3 : o.eps }, [bmp, copy.buffer]);
    return Object.assign({}, res, { depth: new Float32Array(r.depth), width: r.width, height: r.height, refined: true, refinedFrom: { width: res.width, height: res.height }, timings: Object.assign({}, res.timings, { refineMs: performance.now() - t0 }) });
  }

  /* ---------- normals from depth ---------- */
  function blurPlane(src, w, h, r) {
    if (r < 1) return src;
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, i, sum;
    for (y = 0; y < h; y++) {
      sum = 0; var row = y * w;
      for (x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
      for (x = 0; x < w; x++) { var lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r); tmp[row + x] = sum / (hi - lo + 1); if (x + r + 1 < w) sum += src[row + x + r + 1]; if (x - r >= 0) sum -= src[row + x - r]; }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (i = 0; i <= Math.min(r, h - 1); i++) sum += tmp[i * w + x];
      for (y = 0; y < h; y++) { var lo2 = Math.max(0, y - r), hi2 = Math.min(h - 1, y + r); out[y * w + x] = sum / (hi2 - lo2 + 1); if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x]; if (y - r >= 0) sum -= tmp[(y - r) * w + x]; }
    }
    return out;
  }
  /* Float32Array of w*h*3 unit normals (x right, y up, z toward the viewer). strength 1 means a full-range depth change across the
     image width is a 45 degree slope; smooth is a blur radius in depth pixels (default 2); maxSlope softly caps the slope (default 1.2, 0 = off). Two box blurs approximate a gaussian. */
  function normalsData(res, o) {
    o = o || {};
    var w = res.width, h = res.height, d = res.depth, k = (o.strength == null ? 1 : o.strength);
    var r = o.smooth == null ? 2 : o.smooth;
    if (r >= 1) { d = blurPlane(blurPlane(d, w, h, Math.round(r)), w, h, Math.round(r)); }
    var out = new Float32Array(w * h * 3), sc = k * w, cap = o.maxSlope == null ? 1.2 : o.maxSlope; /* soft cap on the slope: depth cliffs at silhouettes would otherwise light up as sideways walls */
    for (var y = 0; y < h; y++) {
      var y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      for (var x = 0; x < w; x++) {
        var x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
        /* depth per pixel times the image width = depth change per image width; the image's y runs down, the output's y runs up. */
        var nx = -(d[y * w + x1] - d[y * w + x0]) / (x1 - x0) * sc, ny = (d[y1 * w + x] - d[y0 * w + x]) / (y1 - y0) * sc;
        if (cap) { var gm = Math.sqrt(nx * nx + ny * ny); if (gm > 1e-6) { var q = Math.tanh(gm / cap) * cap / gm; nx *= q; ny *= q; } }
        var l = Math.sqrt(nx * nx + ny * ny + 1), j = (y * w + x) * 3;
        out[j] = nx / l; out[j + 1] = ny / l; out[j + 2] = 1 / l;
      }
    }
    return out;
  }
  function normals(res, o) {
    var n = normalsData(res, o), w = res.width, h = res.height, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d'), img = x.createImageData(w, h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) {
      img.data[p] = Math.round((n[i * 3] * 0.5 + 0.5) * 255); img.data[p + 1] = Math.round((n[i * 3 + 1] * 0.5 + 0.5) * 255); img.data[p + 2] = Math.round((n[i * 3 + 2] * 0.5 + 0.5) * 255); img.data[p + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  /* ================================================================ faces ================================================================ */
  /* MediaPipe Face Mesh topology (478-point model): the landmark indices of each region, outline order. */
  var IDX = {
    oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    lipsOuter: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    lipsInner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
    eyeR: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    eyeL: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    browR: [46, 53, 52, 65, 55, 107, 66, 105, 63, 70],
    browL: [276, 283, 282, 295, 285, 336, 296, 334, 293, 300],
    lowerLidR: [33, 7, 163, 144, 145, 153, 154, 155, 133],
    lowerLidL: [362, 382, 381, 380, 374, 373, 390, 249, 263],
    irisR: [468, 469, 470, 471, 472], irisL: [473, 474, 475, 476, 477],
    jaw: [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397]
  };
  function ring(L, ids, grow, cx, cy) {
    var pts = ids.map(function (i) { return [L[i][0], L[i][1]]; });
    if (!grow) return pts;
    if (cx == null) { cx = 0; cy = 0; pts.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length; }
    return pts.map(function (p) { return [cx + (p[0] - cx) * grow, cy + (p[1] - cy) * grow]; });
  }
  function partsFor(face, aspect) {
    var L = face.landmarks;
    var eyeR = ring(L, IDX.eyeR), eyeL = ring(L, IDX.eyeL);
    var lipsO = ring(L, IDX.lipsOuter), lipsI = ring(L, IDX.lipsInner);
    var browR = ring(L, IDX.browR), browL = ring(L, IDX.browL);
    /* Under-eye: the lower lid line and the same line moved away from the eye along the face's own "down" axis by about 0.55 eye widths. */
    var rot = face.rotation || 0, dxn = -Math.sin(rot), dyn = Math.cos(rot);
    function under(lidIds, outer) {
      var pts = lidIds.map(function (i) { return [L[i][0], L[i][1]]; });
      var wEye = Math.hypot((pts[0][0] - pts[pts.length - 1][0]) * aspect, pts[0][1] - pts[pts.length - 1][1]);
      var off = wEye * 0.55, a = pts.slice(), b = pts.slice().reverse().map(function (p, k, arr) {
        var t = k / (arr.length - 1), fade = Math.sin(Math.PI * t) * 0.8 + 0.2; /* band narrows at the corners */
        return [p[0] + dxn * off * fade / aspect, p[1] + dyn * off * fade];
      });
      return a.concat(b);
    }
    var skinRings = [ring(L, IDX.oval), ring(L, IDX.eyeR, 1.12), ring(L, IDX.eyeL, 1.12), ring(L, IDX.browR, 1.1), ring(L, IDX.browL, 1.1), ring(L, IDX.lipsOuter, 1.04)];
    var irisR = L[468], irisL = L[473];
    return {
      skin: { rings: skinRings, rule: 'evenodd' },
      eyes: { rings: [eyeR, eyeL], rule: 'nonzero' },
      lips: { rings: [lipsO, lipsI], rule: 'evenodd' },
      teeth: { rings: [lipsI], rule: 'nonzero', note: 'inner mouth polygon; use teethMask() to keep only the light, unsaturated pixels inside it' },
      brows: { rings: [browR, browL], rule: 'nonzero' },
      underEyes: { rings: [under(IDX.lowerLidR), under(IDX.lowerLidL)], rule: 'nonzero' },
      innerMouth: { rings: [lipsI], rule: 'nonzero' },
      irises: { centres: [[irisR[0], irisR[1]], [irisL[0], irisL[1]]] }
    };
  }

  async function face(src, o) {
    o = o || {};
    var signal = o.signal, wantParts = o.parts !== false && (o.parts === true || await isCached('face-parts'));
    var ids = ['face-landmarks'].concat(wantParts ? ['face-parts'] : []);
    var t0 = performance.now();
    var maxSide = o.maxSide || budget().faceSide;
    for (var tries = 0; ; tries++) {
      try {
        var st = await ensure('face', ids, o.onProgress, signal, o.ep || epFor('face'), o);
        if (o.onProgress) o.onProgress({ fraction: 1, stage: 'running' });
        var bmp = await bitmapOf(src, maxSide), w = workers.face, W = bmp.width, H = bmp.height;
        var onAbort = function () { killWorker('face', aborted()); };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        var r;
        try { r = await call(w, 'face', { bitmap: bmp, opts: { maxFaces: o.maxFaces || 8, parts: wantParts, blendshapes: o.blendshapes !== false, scan: o.scan !== false } }, [bmp]); }
        finally { if (signal) signal.removeEventListener('abort', onAbort); }
        var maps = { skin: null, hair: null };
        if (r.skin) { maps.skin = planeCanvas(new Uint8Array(r.skin), r.width, r.height); maps.hair = planeCanvas(new Uint8Array(r.hair), r.width, r.height); }
        var out = r.faces.map(function (f) {
          f.parts = partsFor(f, r.width / r.height);
          f.maps = maps; f.image = { width: r.width, height: r.height }; f.model = 'face-landmarks' + (wantParts ? '+face-parts' : ''); f.version = VERSION;
          return f;
        });
        out.timings = Object.assign({ wallMs: performance.now() - t0, startMs: st.startMs }, r.timings);
        out.image = { width: r.width, height: r.height };
        return out;
      } catch (e) {
        if (isAbort(e) || (signal && signal.aborted)) throw aborted();
        if (FINAL[e.code]) throw e;
        var mem = e.code === 'memory' || isMemory(e) || !workers.face;
        if (tries === 0 && mem && maxSide > 640) { maxSide = Math.round(maxSide / 2); killWorker('face'); continue; }
        throw coded(mem ? 'This device ran out of memory for this photo.' : (e.message || 'The face map failed.'), mem ? 'memory' : (e.code || 'engine'), e);
      }
    }
  }
  function planeCanvas(u8, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'), img = x.createImageData(w, h);
    for (var i = 0; i < u8.length; i++) { var j = i * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = 255; img.data[j + 3] = u8[i]; }
    x.putImageData(img, 0, 0);
    return c;
  }

  /* White canvas whose alpha is the mask of one part, w x h pixels. opts: { feather (px), grow (1 = as is), image (for teeth) } */
  function faceMask(f, part, w, h, o) {
    o = o || {};
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'), p = f.parts[part];
    if (!p || !p.rings) return c;
    var path = new Path2D();
    p.rings.forEach(function (r) {
      var cx = 0, cy = 0; r.forEach(function (q) { cx += q[0]; cy += q[1]; }); cx /= r.length; cy /= r.length;
      var g = o.grow || 1;
      r.forEach(function (q, i) { var X = (cx + (q[0] - cx) * g) * w, Y = (cy + (q[1] - cy) * g) * h; if (i) path.lineTo(X, Y); else path.moveTo(X, Y); });
      path.closePath();
    });
    x.fillStyle = '#fff';
    x.fill(path, p.rule || 'nonzero');
    if (part === 'skin' && f.maps && f.maps.skin && o.segmentation !== false) {
      /* Intersect with the segmenter's face-skin class (removes hair at the hairline, glasses frames and most of a beard). */
      /* Guard: if the segmenter keeps under 35 % of the polygon it has failed on this face (seen on two of 56 test faces), so use the polygon alone. */
      var before = alphaCount(c), keep = document.createElement('canvas'); keep.width = w; keep.height = h;
      var kx = keep.getContext('2d'); kx.drawImage(c, 0, 0); kx.globalCompositeOperation = 'destination-in'; kx.imageSmoothingQuality = 'high'; kx.drawImage(f.maps.skin, 0, 0, w, h);
      if (before && alphaCount(keep) / before >= 0.35) { c = keep; x = c.getContext('2d'); }
    }
    if (part === 'teeth' && o.image) {
      var t = teethAlpha(c, o.image, w, h); c = t;
    }
    if (o.feather) {
      var d = document.createElement('canvas'); d.width = w; d.height = h;
      var dx = d.getContext('2d'); dx.filter = 'blur(' + o.feather + 'px)'; dx.drawImage(c, 0, 0); c = d;
    }
    return c;
  }
  function alphaCount(c) { var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0; for (var i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n; }
  /* Inside the inner-mouth polygon keep pixels that are light and low in colour: a pixel test, but only ever inside a landmark polygon. */
  function teethAlpha(poly, image, w, h) {
    var s = document.createElement('canvas'); s.width = w; s.height = h;
    var sx = s.getContext('2d', { willReadFrequently: true }); sx.drawImage(image, 0, 0, w, h);
    var id = sx.getImageData(0, 0, w, h), pm = poly.getContext('2d').getImageData(0, 0, w, h), n = w * h, lum = 0, cnt = 0, i;
    for (i = 0; i < n; i++) if (pm.data[i * 4 + 3] > 128) { lum += 0.3 * id.data[i * 4] + 0.59 * id.data[i * 4 + 1] + 0.11 * id.data[i * 4 + 2]; cnt++; }
    var mean = cnt ? lum / cnt : 128;
    for (i = 0; i < n; i++) {
      var r = id.data[i * 4], g = id.data[i * 4 + 1], b = id.data[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), y = 0.3 * r + 0.59 * g + 0.11 * b, sat = mx ? (mx - mn) / mx : 0;
      var a = pm.data[i * 4 + 3] / 255 * clamp((y - mean * 0.95) / 25, 0, 1) * clamp((0.45 - sat) / 0.15, 0, 1);
      pm.data[i * 4] = pm.data[i * 4 + 1] = pm.data[i * 4 + 2] = 255; pm.data[i * 4 + 3] = Math.round(a * 255);
    }
    poly.getContext('2d').putImageData(pm, 0, 0);
    return poly;
  }

  /* ---------- storage packing (layer.maps) ---------- */
  var pack = {
    depth: function (res) {
      var w = res.width, h = res.height, c = document.createElement('canvas'); c.width = w; c.height = h;
      var x = c.getContext('2d'), img = x.createImageData(w, h);
      for (var i = 0; i < w * h; i++) { var v = Math.round(clamp(res.depth[i], 0, 1) * 65535); img.data[i * 4] = v >> 8; img.data[i * 4 + 1] = v & 255; img.data[i * 4 + 2] = 0; img.data[i * 4 + 3] = 255; }
      x.putImageData(img, 0, 0);
      return c;
    },
    face: function (f) {
      var n = f.landmarks.length, buf = new Uint8Array(n * 6), dv = new DataView(buf.buffer);
      for (var i = 0; i < n; i++) {
        dv.setUint16(i * 6, Math.round(clamp(f.landmarks[i][0] + 0.5, 0, 2) / 2 * 65535), true);
        dv.setUint16(i * 6 + 2, Math.round(clamp(f.landmarks[i][1] + 0.5, 0, 2) / 2 * 65535), true);
        dv.setInt16(i * 6 + 4, Math.round(clamp(f.landmarks[i][2], -0.5, 0.5) * 65534), true);
      }
      var s = ''; for (var j = 0; j < buf.length; j++) s += String.fromCharCode(buf[j]);
      return { v: 1, count: n, rotation: Math.round(f.rotation * 1e4) / 1e4, score: Math.round(f.score * 1e3) / 1e3, image: f.image, points: btoa(s), model: f.model, version: f.version };
    }
  };
  /* Segments: one opaque RGB image (R person, G hair, B skin) plus a grey clothes plane. Opaque on purpose: a canvas stores
     colour premultiplied, so a transparent pixel would lose its other channels. */
  pack.segments = function (res) {
    var w = res.width, h = res.height, rgb = document.createElement('canvas'), cl = document.createElement('canvas');
    rgb.width = cl.width = w; rgb.height = cl.height = h;
    var a = rgb.getContext('2d').createImageData(w, h), b = cl.getContext('2d').createImageData(w, h);
    var P = res.planes;
    for (var i = 0; i < w * h; i++) {
      var j = i * 4;
      a.data[j] = P.person[i]; a.data[j + 1] = P.hair[i]; a.data[j + 2] = P.skin[i]; a.data[j + 3] = 255;
      b.data[j] = b.data[j + 1] = b.data[j + 2] = P.clothes[i]; b.data[j + 3] = 255;
    }
    rgb.getContext('2d').putImageData(a, 0, 0); cl.getContext('2d').putImageData(b, 0, 0);
    return { rgb: rgb, clothes: cl };
  };
  function pixelsOf(src) {
    var s = srcSize(src), c = src;
    if (!src.getContext) { c = document.createElement('canvas'); c.width = s.w; c.height = s.h; c.getContext('2d').drawImage(src, 0, 0); }
    return { data: c.getContext('2d').getImageData(0, 0, s.w, s.h).data, w: s.w, h: s.h };
  }
  var unpack = {
    depth: function (canvas) {
      var px = pixelsOf(canvas), w = px.w, h = px.h, d = px.data, out = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) out[i] = ((d[i * 4] << 8) | d[i * 4 + 1]) / 65535;
      return { depth: out, width: w, height: h, orientation: 'near=1' };
    },
    face: function (o) {
      var s = atob(o.points), buf = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
      var dv = new DataView(buf.buffer), L = [];
      for (var k = 0; k < o.count; k++) L.push([dv.getUint16(k * 6, true) / 65535 * 2 - 0.5, dv.getUint16(k * 6 + 2, true) / 65535 * 2 - 0.5, dv.getInt16(k * 6 + 4, true) / 65534]);
      var f = { landmarks: L, rotation: o.rotation, score: o.score, image: o.image, model: o.model, version: o.version, maps: { skin: null, hair: null } }, minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (var j = 0; j < 468; j++) { minX = Math.min(minX, L[j][0]); maxX = Math.max(maxX, L[j][0]); minY = Math.min(minY, L[j][1]); maxY = Math.max(maxY, L[j][1]); }
      f.box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      f.parts = partsFor(f, o.image.width / o.image.height);
      return f;
    },
    segments: function (rgb, clothes) {
      var a = pixelsOf(rgb), b = clothes ? pixelsOf(clothes) : null, n = a.w * a.h, P = { person: new Uint8Array(n), hair: new Uint8Array(n), skin: new Uint8Array(n), clothes: new Uint8Array(n) };
      for (var i = 0; i < n; i++) { P.person[i] = a.data[i * 4]; P.hair[i] = a.data[i * 4 + 1]; P.skin[i] = a.data[i * 4 + 2]; P.clothes[i] = b ? b.data[i * 4] : 0; }
      return segCanvases({ width: a.w, height: a.h, planes: P });
    }
  };

  /* ================================================================ segments ================================================================ */
  function segCanvases(res) {
    var P = res.planes, n = res.width * res.height, bg = new Uint8Array(n);
    for (var i = 0; i < n; i++) bg[i] = 255 - P.person[i];
    return { person: planeCanvas(P.person, res.width, res.height), hair: planeCanvas(P.hair, res.width, res.height), skin: planeCanvas(P.skin, res.width, res.height),
      clothes: planeCanvas(P.clothes, res.width, res.height), background: planeCanvas(bg, res.width, res.height), width: res.width, height: res.height, planes: P };
  }
  /* Person, hair, skin and clothes masks for the whole frame from the multi-class person segmenter (the "hair and skin detail"
     model). Best on portraits and selfies; a small person in a wide shot is found weakly or not at all. */
  async function segments(src, o) {
    o = o || {};
    var m = firstOf('parts'), signal = o.signal, t0 = performance.now(), side = o.maxSide || Math.min(1024, budget().faceSide);
    try {
      var st = await ensure('segments', [m.id], o.onProgress, signal, o.ep || epFor('segments'), o);
      if (o.onProgress) o.onProgress({ fraction: 1, stage: 'running' });
      var bmp = await bitmapOf(src, side), w = workers.segments;
      var onAbort = function () { killWorker('segments', aborted()); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      var r;
      try { r = await call(w, 'segments', { bitmap: bmp, side: side, refine: o.refine !== false }, [bmp]); }
      finally { if (signal) signal.removeEventListener('abort', onAbort); }
      var res = segCanvases({ width: r.width, height: r.height, planes: { person: new Uint8Array(r.person), hair: new Uint8Array(r.hair), skin: new Uint8Array(r.skin), clothes: new Uint8Array(r.clothes) } });
      res.model = m.id; res.version = VERSION; res.timings = Object.assign({ wallMs: performance.now() - t0, startMs: st.startMs }, r.timings);
      return res;
    } catch (e) {
      if (isAbort(e) || (signal && signal.aborted)) throw aborted();
      if (FINAL[e.code]) throw e;
      throw coded(isMemory(e) ? 'This device ran out of memory for this photo.' : (e.message || 'The person map failed.'), isMemory(e) ? 'memory' : (e.code || 'engine'), e);
    }
  }

  /* The packed forms the document stores (layer.maps), straight from a photo. */
  async function depthMap(src, o) {
    var r = await depth(src, o);
    return { canvas: pack.depth(r), result: r, entry: { width: r.width, height: r.height, orientation: 'near=1', model: r.model, version: r.version, refined: !!r.refined } };
  }
  async function faces(src, o) {
    var list = await face(src, Object.assign({ blendshapes: false }, o || {}));
    return { faces: list.map(function (f) { return pack.face(f); }), image: list.image, raw: list };
  }

  /* ================================================================ map.generate ================================================================
     op: { op: 'map.generate', layer: id, kind: 'depth' | 'faces' | 'segments', model?, force?, maxSide? }
     run(op, { layer, image(layer) -> Promise<image>, store(canvas, name) -> Promise<assetId>, signal, onProgress, confirmed })
       -> { ok, kind, layer, maps (the layer's new maps object), asset, count?, info } | { ok: false, code, message, canForce }
     Results follow docs/FX-AUTHORING.md: maps.depth = { asset, width, height, orientation, model, version, refined } (16-bit PNG at the
     model grid); maps.face = [packed faces] (about 4 KB each; none found leaves maps.face out); maps.segments = { asset (R person,
     G hair, B skin), clothes: { asset }, width, height, model, version }. Nothing is computed until asked; nothing leaves the device. */
  var KINDS = { depth: 'depth', faces: 'face', face: 'face', segments: 'segments' };
  function fail(code, message, extra) { return Object.assign({ ok: false, code: code, message: message, errors: [{ code: code, message: message }] }, extra || {}); }
  async function run(op, o) {
    o = o || {};
    var kind = KINDS[op && op.kind], layer = o.layer;
    if (!kind) return fail('invalid', 'kind is "depth", "faces" or "segments".');
    if (!layer || !layer.src) return fail('invalid', 'map.generate needs a photo layer.');
    var supKind = kind === 'segments' ? 'parts' : kind, sup = await API.support(supKind);
    if (sup.status === 'unsupported' && !(op.force || o.force)) return fail('unsupported', (sup.reasons && sup.reasons[0]) || 'This device cannot make this map.', { canForce: sup.canForce !== false });
    var img;
    try { img = await o.image(layer); } catch (e) { img = null; }
    if (!img) return fail('missing-image', 'The photo of this layer is not loaded.');
    var call0 = { signal: o.signal, onProgress: o.onProgress, confirmed: o.confirmed, quiet: o.quiet, maxSide: op.maxSide, model: op.model };
    var maps = JSON.parse(JSON.stringify(layer.maps || {})), out = { ok: true, kind: op.kind, layer: layer.id };
    try {
      if (kind === 'depth') {
        var d = await API.depthMap(img, call0), id = await o.store(d.canvas, 'depth.png');
        maps.depth = Object.assign({ asset: id }, d.entry);
        out.asset = id; out.info = { width: d.entry.width, height: d.entry.height, ms: Math.round(d.result.timings.wallMs) };
      } else if (kind === 'face') {
        var f = await API.faces(img, call0);
        if (f.faces.length) maps.face = f.faces; else delete maps.face;
        out.count = f.faces.length; out.info = { image: f.image };
      } else {
        var s = await API.segments(img, call0), pk = pack.segments(s), a1 = await o.store(pk.rgb, 'segments.png'), a2 = await o.store(pk.clothes, 'clothes.png');
        maps.segments = { asset: a1, clothes: { asset: a2 }, width: s.width, height: s.height, channels: 'r:person g:hair b:skin', model: s.model, version: s.version };
        out.asset = a1; out.info = { width: s.width, height: s.height };
      }
    } catch (e) {
      return fail(e.code || 'engine', e.message || String(e), { canForce: false });
    }
    out.maps = maps;
    return out;
  }
  /* Asset ids are the SHA-256 of the PNG, the same id LE.project.putAsset gives, so projects keep them. */
  function toBlob(canvas) { return LE.toBlob ? LE.toBlob(canvas, 'image/png') : new Promise(function (res) { canvas.toBlob(res, 'image/png'); }); }
  async function sha256(blob) {
    var buf = await blob.arrayBuffer(), h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), s = '';
    for (var i = 0; i < h.length; i++) s += (h[i] < 16 ? '0' : '') + h[i].toString(16);
    return s;
  }
  function sceneStore(scene) {
    return async function (canvas, name) {
      if (LE.expert && typeof LE.expert.storeCanvas === 'function' && LE.expert.active && LE.expert.active()) return LE.expert.storeCanvas(canvas, name);
      var blob = await toBlob(canvas), id;
      if (LE.project && typeof LE.project.putAsset === 'function') { try { id = (await LE.project.putAsset({ blob: blob, name: name, type: 'image/png', width: canvas.width, height: canvas.height })).id; } catch (e) { id = null; } }
      if (!id) id = await sha256(blob);
      if (scene && typeof scene.addAsset === 'function') scene.addAsset(id, canvas);
      return id;
    };
  }
  function sceneImage(scene) {
    return function (layer) {
      var rec = scene && scene._assets && scene._assets[layer.src];
      if (!rec) return Promise.resolve(null);
      return Promise.resolve(rec.ready || rec).then(function (r) { r = r || rec; return r.canvas || r.image || r.bitmap || null; });
    };
  }
  function layersOf(doc) {
    var out = [];
    (function walk(list) { (list || []).forEach(function (l) { out.push(l); if (l && l.children) walk(l.children); if (l && l.layers) walk(l.layers); }); })(doc.layers || (doc.pages && doc.pages[0] && doc.pages[0].layers) || []);
    return out;
  }
  var ops = {
    list: function () {
      return [{ op: 'map.generate', fields: { layer: 'photo layer id', kind: '"depth" | "faces" | "segments"', model: 'optional model id (LE.maps.models())', force: 'run even where LE.support says unsupported' },
        summary: 'Computes a depth map, face landmarks or person segments for a photo layer on this device and stores them in layer.maps. Needed by depth and face masks and by the relight effects.',
        example: { op: 'map.generate', layer: 'photo-1', kind: 'depth' } }];
    },
    run: run,
    /* target: an LE.Scene (writes with scene.update, one undo step) or a plain document { layers } (returns a new doc).
       o: { image(layer), store(canvas, name), signal, onProgress, confirmed, quiet, force } */
    apply: async function (target, op, o) {
      o = o || {};
      if (!op || op.op && op.op !== 'map.generate') return fail('invalid', 'Unknown operation: ' + (op && op.op));
      var isScene = target && typeof target.update === 'function' && typeof target.layer === 'function';
      var layer = isScene ? target.layer(op.layer) : layersOf(target || {}).filter(function (l) { return l && l.id === op.layer; })[0];
      if (!layer) return fail('invalid', 'No layer ' + op.layer + '.');
      var r = await run(op, Object.assign({}, o, { layer: layer, image: o.image || (isScene ? sceneImage(target) : null), store: o.store || sceneStore(isScene ? target : null) }));
      if (!r.ok) return isScene ? r : Object.assign({ doc: target }, r);
      if (isScene) { target.update(layer.id, { maps: r.maps }); r.id = layer.id; return r; }
      var doc = JSON.parse(JSON.stringify(target));
      layersOf(doc).forEach(function (l) { if (l.id === layer.id) l.maps = r.maps; });
      r.doc = doc; r.id = layer.id;
      return r;
    }
  };

  /* ---------- cache helpers ---------- */
  async function isCached(id) {
    var m = find(id), c = await openCache(); if (!m || !c) return false;
    var keys = Object.keys(m.files);
    for (var i = 0; i < keys.length; i++) { if (m.files[keys[i]].optional) continue; if (!(await c.match(abs(m.files[keys[i]].path)))) return false; }
    return true;
  }

  var API = LE.maps = {
    shared: true, CACHE: CACHE, VERSION: VERSION, IDX: IDX,
    config: function (o) { if (o && o.root) cfg.root = new URL(o.root, location.href).href; if (o && o.worker) cfg.worker = new URL(o.worker, location.href).href; return cfg; },
    models: function () { return MODELS.map(function (m) { var c = Object.assign({}, m); c.urls = {}; Object.keys(m.files).forEach(function (k) { c.urls[k] = abs(m.files[k].path); }); return c; }); },
    model: function (id) { var m = find(id); return m ? Object.assign({}, m) : null; },
    register: function (def) { if (!def || !def.id || find(def.id)) return false; MODELS.push(Object.assign({ tier: 'standard', needs: NEEDS.slice(), listed: true }, def)); return true; },
    budget: budget, support: support,
    gate: function (kind, opts) {
      var m = firstOf(kind) || find(kind); opts = opts || {};
      if (m && LE.support && typeof LE.support.gate === 'function') return LE.support.gate(m.supportId, { title: opts.title || m.label, run: opts.run });
      return support(kind).then(function (r) { if (r.status === 'unsupported') throw coded(r.reasons[0] || 'Not supported here.', 'unsupported'); return opts.run ? opts.run(r) : r; });
    },
    downloadSize: async function (id) {
      var m = find(id), c = await openCache(), bytes = 0, need = false;
      if (m) for (var k in m.files) { if (!(c && await c.match(abs(m.files[k].path)))) { bytes += m.files[k].bytes || m.downloadMB * 1e6 / Object.keys(m.files).length; need = true; } }
      var engine = !!(c && await c.match(abs('assets/vendor/ort/ort-wasm-simd-threaded.wasm')));
      return { bytes: bytes + (engine ? 0 : 2900000), model: need, engine: !engine, cached: !need };
    },
    depth: depth, depthMap: depthMap, refineDepth: refineDepth, normals: normals, normalsData: normalsData,
    face: face, faces: faces, faceMask: faceMask, partsFor: partsFor, segments: segments,
    pack: pack, unpack: unpack, ops: ops, generate: function (scene, layerId, kind, o) { return ops.apply(scene, { op: 'map.generate', layer: layerId, kind: kind }, o); },
    ep: epFor,
    /* Downloads a model into Cache Storage without starting the engine (for "Download now" and background fetches). */
    prefetch: async function (id, o) {
      o = o || {};
      var m = find(id); if (!m) throw new Error('Unknown model: ' + id);
      var need = await missingBytes([id]), chip = await allowDownload([id], need, o), total = 0;
      try { for (var k in m.files) { var r = await fileBytes(m, k, function (l) { if (chip && need) chip.progress(Math.min(need, l), need); }, o.signal); if (r) total += r.buf.byteLength; } if (chip) chip.done(); }
      catch (e) { if (chip) chip.fail(e); throw e; }
      return { cached: !need, bytes: total };
    },
    isLoaded: function (kind) { return current[kind] ? current[kind].ids.slice() : null; },
    info: function (kind) { return current[kind] ? current[kind].info : null; },
    unload: function (kind) { (kind ? [kind] : ['depth', 'face', 'segments']).forEach(function (k) { var w = workers[k]; if (w) { try { w.postMessage({ type: 'dispose', id: ++seq }); } catch (e) { /* ignore */ } w.terminate(); workers[k] = null; rejectAllFor(w, aborted()); } current[k] = null; }); },
    isCached: isCached,
    cachedModels: async function () {
      var c = await openCache(); if (!c) return [];
      var keys = await c.keys(), out = [];
      for (var i = 0; i < keys.length; i++) { var r = await c.match(keys[i]); var id = r.headers.get('x-le-model'); if (id && find(id)) out.push({ url: keys[i].url, id: id, bytes: +r.headers.get('content-length') || 0 }); }
      return out;
    },
    remove: async function (id) {
      var m = find(id), c = await openCache(), ok = false; if (!m || !c) return false;
      API.unload(m.kind === 'depth' ? 'depth' : 'face');
      if (m.kind === 'parts') API.unload('segments');
      for (var k in m.files) if (await c.delete(abs(m.files[k].path))) ok = true;
      return ok;
    }
  };
})(window);
