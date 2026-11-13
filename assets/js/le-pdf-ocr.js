/* LocalEditor: read the text in scanned PDFs (D9, "Make searchable"). See docs/PDF-OCR-SCAN.md.
 *
 * Part 1, window.LE.ocr: the on-device text reader, usable on any page (the lab at labs/pdf-ocr/ uses it too).
 *   LE.ocr.languages()                          -> [{ id, label, script, rtl, bytes, bundled, url, licence }]
 *   LE.ocr.available()                          -> Promise<[id]>  languages whose data is on this copy of the site (packs.json)
 *   LE.ocr.load(lang, onProgress)               -> Promise<{ lang, fromCache, ms }>    lang: 'eng' | 'eng+hin' | ['eng','hin']
 *   LE.ocr.recognize(canvasOrImage, { lang, signal, prep, psm, dpi, timeoutMs, minConfidence })
 *                                               -> Promise<{ text, words:[{ text, bbox:{x0,y0,x1,y1}, confidence, line }], lines, confidence, width, height, ms }>
 *   LE.ocr.status(pdfBytesOrPdfjsDoc, { maxPages }) -> Promise<{ pages:[{ page, chars, picture, scan }], scans:[page], text:[page] }>  (0-based pages)
 *   LE.ocr.makeSearchable(pdfBytes, { lang, pages, onProgress, signal, dpi, skipTextPages })
 *                                               -> Promise<Uint8Array>   (original pages untouched, invisible text layer added; .report)
 *   LE.ocr.cachedLanguages() / clearCache(id) / engineCached()   Cache Storage 'le-models-v1' (storage manager: "AI models")
 *   LE.ocr.unload()                             -> terminates the worker and frees ~100-200 MB
 *   LE.ocr.defaults()                           -> { dpi, maxPixels } for this device (150 dpi on phones and small-memory devices)
 *
 * Part 2 (only inside the PDF studio, when window.PS exists): the "Scan" panel's "Make searchable" card, the offer shown when a
 * scanned PDF is opened, Copy text / Save text, and the hook that lets "Find sensitive data" read scanned pages first.
 *
 * Engine: Tesseract 5 (LSTM only) compiled to WebAssembly (tesseract.js-core 7.0.0, Apache-2.0), driven through the
 * message protocol of the tesseract.js 7.0.0 worker script (Apache-2.0). Nothing is fetched until load() is called.
 * Language data (tessdata_fast, Apache-2.0) and the engine are cached in Cache Storage 'le-models-v1' (x-le-model: ocr-<id>, ocr-engine).
 * Needs: WebAssembly (+SIMD preferred), Web Worker, canvas. makeSearchable also needs pdf.js (window.pdfjsLib) and pdf-lib (window.PDFLib).
 * Document text is never logged, stored or sent anywhere.
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};

  var CACHE = 'le-models-v1';
  var scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  var dataRoot = document.documentElement.getAttribute('data-root');
  var cfg = { root: dataRoot != null ? new URL(dataRoot || './', location.href).href : new URL('../../', scriptUrl).href, maxSide: 3600, maxPixels: 9000000, params: { preserve_interword_spaces: '1' }, sendDpi: true };

  /* Phones and small-memory devices: 150 dpi and a smaller working image (docs/research/pdf-ocr-scan.md: 300 dpi buys nothing, 200 dpi peaks
     at about 330 MB, 150 dpi at about 190 MB). */
  function smallDevice() {
    var mem = navigator.deviceMemory, coarse = false;
    try { coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches; } catch (e) { coarse = false; }
    return (mem && mem <= 4) || (coarse && Math.min(screen.width, screen.height) < 820);
  }
  function defaults() {
    var small = smallDevice();
    return { dpi: small ? 150 : 200, maxPixels: small ? 4500000 : 9000000, maxDpi: small ? 200 : 300, small: !!small };
  }

  var TESS_DIR = 'assets/vendor/tesseract/';
  var ENGINE = { worker: TESS_DIR + 'worker.min.js', simd: TESS_DIR + 'tesseract-core-simd-lstm.wasm.js', plain: TESS_DIR + 'tesseract-core-lstm.wasm.js', simdBytes: 3899472, plainBytes: 3896484 };

  /* Language data: tessdata_fast (Apache-2.0). 'bundled' ones ship in the repo, the others are fetched by scripts/fetch-ocr-data.js
   * and hosted on S3 under assets/models/ocr/more/. Sizes are the raw .traineddata bytes. */
  var LANGS = [
    { id: 'eng', label: 'English', script: 'Latin', bytes: 4113088, path: 'assets/models/ocr/eng.traineddata', bundled: true },
    { id: 'spa', label: 'Spanish', script: 'Latin', bytes: 2294433, path: 'assets/models/ocr/more/spa.traineddata' },
    { id: 'por', label: 'Portuguese', script: 'Latin', bytes: 1982756, path: 'assets/models/ocr/more/por.traineddata' },
    { id: 'fra', label: 'French', script: 'Latin', bytes: 1130365, path: 'assets/models/ocr/more/fra.traineddata' },
    { id: 'deu', label: 'German', script: 'Latin', bytes: 1525436, path: 'assets/models/ocr/more/deu.traineddata' },
    { id: 'hin', label: 'Hindi (Devanagari)', script: 'Devanagari', bytes: 1122751, path: 'assets/models/ocr/more/hin.traineddata' },
    { id: 'ara', label: 'Arabic', script: 'Arabic', rtl: true, bytes: 1432056, path: 'assets/models/ocr/more/ara.traineddata' }
  ];
  LANGS.forEach(function (l) { l.licence = 'Apache-2.0 (tesseract-ocr/tessdata_fast)'; });

  var eng = null, loadedKey = null, loading = null, seq = 0, simdOk = null;

  function abs(p) { return new URL(p, cfg.root).href; }
  function langInfo(id) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === id) return LANGS[i]; return null; }
  function langList(l) { return (Array.isArray(l) ? l : String(l || 'eng').split('+')).filter(Boolean); }
  function abortErr(m) { return new DOMException(m || 'Stopped', 'AbortError'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* WebAssembly SIMD feature test (validates a tiny module that uses a v128 op). */
  function hasSimd() {
    if (simdOk !== null) return simdOk;
    try {
      simdOk = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) { simdOk = false; }
    return simdOk;
  }

  /* ---------- bytes: Cache Storage first, network second, with progress ---------- */
  async function langBytes(l, onProgress, signal) {
    var url = abs(l.path), cache = null, req = new Request(url);
    if (global.caches) { try { cache = await caches.open(CACHE); } catch (e) { cache = null; } }
    if (cache) {
      var hit = await cache.match(req);
      if (hit) { var b = await hit.arrayBuffer(); if (onProgress) onProgress({ stage: 'language', lang: l.id, loaded: b.byteLength, total: b.byteLength, fraction: 1, cached: true }); return { buf: new Uint8Array(b), cached: true }; }
    }
    var res = await fetch(url, signal ? { signal: signal } : undefined);
    if (!res.ok) throw new Error('The text reader for ' + l.label + ' is not on this copy of LocalEditor (' + res.status + ')');
    var total = +res.headers.get('content-length') || l.bytes, loaded = 0, chunks = [];
    if (res.body && res.body.getReader) {
      var rd = res.body.getReader();
      for (;;) {
        var r = await rd.read(); if (r.done) break;
        chunks.push(r.value); loaded += r.value.length;
        if (onProgress) onProgress({ stage: 'language', lang: l.id, loaded: loaded, total: total, fraction: Math.min(1, loaded / total), cached: false });
      }
    } else { chunks.push(new Uint8Array(await res.arrayBuffer())); loaded = chunks[0].length; }
    var out = new Uint8Array(loaded), off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    if (cache) {
      try { await cache.put(req, new Response(new Blob([out], { type: 'application/octet-stream' }), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded), 'x-le-model': 'ocr-' + l.id } })); } catch (e) { /* quota: run anyway */ }
    }
    return { buf: out, cached: false };
  }

  /* The engine script is fetched once with progress (so the download bar is honest) and kept in 'le-models-v1' with
     x-le-model: ocr-engine, so the storage manager lists it as one item with a delete button. The worker's importScripts() then
     hits the service worker (which serves /assets/vendor/tesseract/ from 'le-models-v1') or, without one, the HTTP cache. */
  async function engineCached(url) {
    if (!global.caches) return false;
    try {
      if (!(await caches.has(CACHE))) return false;
      var c = await caches.open(CACHE);
      return !!(await c.match(url || abs(hasSimd() ? ENGINE.simd : ENGINE.plain)));
    } catch (e) { return false; }
  }
  async function warmEngine(url, bytes, onProgress, signal) {
    var controlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    if (controlled && await engineCached(url)) { if (onProgress) onProgress({ stage: 'engine', loaded: bytes, total: bytes, fraction: 1, cached: true }); return true; }
    var res = await fetch(url, signal ? { signal: signal } : undefined);
    if (!res.ok) throw new Error('The text reader is not available (' + res.status + ')');
    var total = +res.headers.get('content-length') || bytes, loaded = 0, chunks = [];
    if (res.body && res.body.getReader) {
      var rd = res.body.getReader();
      for (;;) {
        var r = await rd.read(); if (r.done) break;
        chunks.push(r.value); loaded += r.value.length;
        if (onProgress) onProgress({ stage: 'engine', loaded: loaded, total: total, fraction: Math.min(1, loaded / total) });
      }
    } else { chunks.push(new Uint8Array(await res.arrayBuffer())); loaded = chunks[0].length; }
    if (global.caches) {
      try {
        var cache = await caches.open(CACHE);
        await cache.put(new Request(url), new Response(new Blob(chunks, { type: 'text/javascript' }), { headers: { 'content-type': 'text/javascript', 'content-length': String(loaded), 'x-le-model': 'ocr-engine' } }));
      } catch (e) { /* quota: run anyway */ }
    }
    chunks = null;
    return false;
  }

  /* ---------- worker client (tesseract.js worker message protocol) ---------- */
  function Engine() {
    var self = this;
    this.w = new Worker(abs(ENGINE.worker));
    this.jobs = {};
    this.w.onmessage = function (e) {
      var d = e.data, j = self.jobs[d.jobId];
      if (!j) return;
      if (d.status === 'progress') { if (j.onProgress) j.onProgress(d.data); return; }
      delete self.jobs[d.jobId];
      if (d.status === 'resolve') j.resolve(d.data); else j.reject(new Error(String(d.data)));
    };
    this.w.onerror = function (e) {
      var msg = (e && e.message) || 'The text reader failed to start';
      Object.keys(self.jobs).forEach(function (k) { self.jobs[k].reject(new Error(msg)); delete self.jobs[k]; });
    };
  }
  Engine.prototype.call = function (action, payload, onProgress, transfer) {
    var self = this, id = 'j' + (++seq);
    return new Promise(function (resolve, reject) {
      self.jobs[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
      self.w.postMessage({ workerId: 'le-ocr', jobId: id, action: action, payload: payload }, transfer || []);
    });
  };
  Engine.prototype.kill = function (reason) {
    this.w.terminate();
    var jobs = this.jobs; this.jobs = {};
    Object.keys(jobs).forEach(function (k) { jobs[k].reject(abortErr(reason)); });
  };

  /* ---------- public: languages / cache ---------- */
  async function cachedIds() {
    var ids = {};
    if (!global.caches) return ids;
    try {
      if (!(await caches.has(CACHE))) return ids;   /* do not create the cache just by looking */
      var cache = await caches.open(CACHE), keys = await cache.keys();
      keys.forEach(function (k) { LANGS.forEach(function (l) { if (k.url === abs(l.path)) ids[l.id] = true; }); });
    } catch (e) { /* ignore */ }
    return ids;
  }

  function checkSignal(signal) { if (signal && signal.aborted) throw abortErr('Stopped'); }

  /* Which languages are on this copy of the site. English always ships; the others are listed in assets/data/packs.json by the build
     when scripts/fetch-ocr-data.js put them in assets/models/ocr/more/. No language data is requested to find out. */
  var availP = null;
  function idsFromManifest(m) {
    var ids = { eng: true };
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      var mm = typeof o.model === 'string' && /^ocr-([a-z_]+)$/.exec(o.model);
      if (mm && mm[1] !== 'engine') ids[mm[1]] = true;
      var um = typeof o.u === 'string' && /assets\/models\/ocr\/(?:more\/)?([a-z_]+)\.traineddata$/.exec(o.u);
      if (um) ids[um[1]] = true;
      Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k]); });
    })(m);
    return LANGS.filter(function (l) { return ids[l.id]; }).map(function (l) { return l.id; });
  }
  function available() {
    if (availP) return availP;
    var D = LE.downloads;
    var src = D && D.ready && D.manifest ? Promise.resolve(D.ready).catch(function () {}).then(function () { return D.manifest(); }) : Promise.resolve(null);
    availP = src.then(function (m) {
      if (m) return m;
      return fetch(abs('assets/data/packs.json')).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }).then(function (m) { return m ? idsFromManifest(m) : ['eng']; }, function () { return ['eng']; });
    return availP;
  }

  /* ---------- load ---------- */
  function load(lang, onProgress, signal) {
    var ids = langList(lang), key = ids.join('+');
    if (eng && loadedKey === key) return Promise.resolve({ lang: key, fromCache: true, ms: 0 });
    if (loading && loading.key === key) return loading.p;
    var p = (async function () {
      var t0 = performance.now();
      unload();
      var infos = ids.map(function (id) { var l = langInfo(id); if (!l) throw new Error('Unknown language: ' + id); return l; });
      var simd = hasSimd(), core = simd ? ENGINE.simd : ENGINE.plain;
      await warmEngine(abs(core), simd ? ENGINE.simdBytes : ENGINE.plainBytes, onProgress, signal);
      checkSignal(signal);
      var datas = [], allCached = true;
      for (var i = 0; i < infos.length; i++) {
        var got = await langBytes(infos[i], onProgress, signal);
        checkSignal(signal);
        allCached = allCached && got.cached; datas.push({ code: infos[i].id, data: got.buf });
      }
      if (onProgress) onProgress({ stage: 'starting', fraction: 1 });
      var e = new Engine();
      try {
        await e.call('load', { options: { lstmOnly: true, corePath: abs(core), logging: false } });
        await e.call('loadLanguage', { langs: datas, options: { gzip: false, cacheMethod: 'none', lstmOnly: true } });
        await e.call('initialize', { langs: key, oem: 1, config: {} });
        await e.call('setParameters', { params: Object.assign({ tessedit_pageseg_mode: '3' }, cfg.params) });
      } catch (err) { e.kill(); throw err; }
      eng = e; loadedKey = key;
      return { lang: key, fromCache: allCached, ms: Math.round(performance.now() - t0), simd: simd };
    })();
    loading = { key: key, p: p };
    p.then(function () { loading = null; }, function () { loading = null; });
    return p;
  }

  function unload() {
    if (eng) { eng.kill('Unloaded'); eng = null; loadedKey = null; }
  }

  /* ---------- pre-processing: flatten uneven light, reduce noise, stretch contrast ---------- */
  function toCanvas(src, maxSide) {
    var w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
    var s = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(cfg.maxPixels / (w * h)));
    var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, 0, 0, cw, ch);
    return c;
  }


  /* Page skew by projection profile: the angle (degrees, canvas convention) at which ink rows are sharpest. Tesseract's own
   * layout analysis drops whole blocks at about 3 degrees of skew (measured), so we straighten first. */
  function estimateSkew(g, w, h) {
    var f = Math.max(1, Math.floor(Math.max(w, h) / 900)), xs = [], ys = [], x, y, cx = w / 2, cy = h / 2;
    for (y = 0; y < h; y += f) for (x = 0; x < w; x += f) if (g[y * w + x] < 140) { xs.push((x - cx) / f); ys.push((y - cy) / f); }
    var n = xs.length;
    if (n < 200) return 0;
    var step = Math.max(1, Math.floor(n / 60000)), span = Math.ceil(Math.hypot(w, h) / f) + 4, bins = new Uint32Array(span * 2);
    function score(deg) {
      var a = deg * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a), i, sc = 0;
      bins.fill(0);
      for (i = 0; i < n; i += step) bins[Math.round(xs[i] * sn + ys[i] * cs) + span]++;
      for (i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
      return sc;
    }
    var s0 = score(0), best = 0, bs = s0, d, sc;
    for (d = -8; d <= 8; d += 0.5) { sc = score(d); if (sc > bs) { bs = sc; best = d; } }
    var c0 = best;
    for (d = c0 - 0.5; d <= c0 + 0.5; d += 0.1) { sc = score(d); if (sc > bs) { bs = sc; best = d; } }
    return bs > s0 * 1.03 && Math.abs(best) >= 0.2 ? +best.toFixed(2) : 0;
  }

  /* Returns stats so callers can show "cleaned up" hints. Modifies the canvas in place (grey, flattened). */
  function prepCanvas(c, mode) {
    var w = c.width, h = c.height, ctx = c.getContext('2d', { willReadFrequently: true });
    var im = ctx.getImageData(0, 0, w, h), d = im.data, n = w * h, g = new Uint8ClampedArray(n), i, x, y;
    for (i = 0, x = 0; i < n; i++, x += 4) g[i] = (d[x] * 77 + d[x + 1] * 150 + d[x + 2] * 29) >> 8;
    var stats = { noise: 0, flattened: false, denoised: false, skew: 0, rot: null };
    /* 1. paper level on a coarse grid: 85th percentile of each cell, then smoothed */
    var cell = Math.max(12, Math.round(Math.max(w, h) / 120)), gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    var bg = new Float32Array(gw * gh), hist = new Uint32Array(256), cx, cy, px, py, k, acc, target;
    for (cy = 0; cy < gh; cy++) for (cx = 0; cx < gw; cx++) {
      hist.fill(0); var x0 = cx * cell, y0 = cy * cell, x1 = Math.min(w, x0 + cell), y1 = Math.min(h, y0 + cell), cnt = 0;
      for (py = y0; py < y1; py++) for (px = x0; px < x1; px++) { hist[g[py * w + px]]++; cnt++; }
      target = cnt * 0.85; acc = 0; for (k = 0; k < 256; k++) { acc += hist[k]; if (acc >= target) break; }
      bg[cy * gw + cx] = k;
    }
    var tmp = new Float32Array(gw * gh);
    for (var pass = 0; pass < 2; pass++) {   /* max of neighbours, then average: keeps paper level under big letters */
      for (cy = 0; cy < gh; cy++) for (cx = 0; cx < gw; cx++) {
        var m = 0; for (y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) for (x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) m = Math.max(m, bg[y * gw + x]);
        tmp[cy * gw + cx] = m;
      }
      for (cy = 0; cy < gh; cy++) for (cx = 0; cx < gw; cx++) {
        var s = 0, q = 0; for (y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) for (x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) { s += tmp[y * gw + x]; q++; }
        bg[cy * gw + cx] = s / q;
      }
    }
    var lo = 255, hi = 0; for (i = 0; i < gw * gh; i++) { if (bg[i] < lo) lo = bg[i]; if (bg[i] > hi) hi = bg[i]; }
    stats.flattened = (hi - lo) > 20;
    /* 2. divide by the bilinear background */
    var row = new Float32Array(w);
    for (y = 0; y < h; y++) {
      var fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5)), iy = Math.floor(fy), ty = fy - iy, iy2 = Math.min(gh - 1, iy + 1);
      for (x = 0; x < w; x++) {
        var fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5)), ix = Math.floor(fx), tx = fx - ix, ix2 = Math.min(gw - 1, ix + 1);
        var b = (bg[iy * gw + ix] * (1 - tx) + bg[iy * gw + ix2] * tx) * (1 - ty) + (bg[iy2 * gw + ix] * (1 - tx) + bg[iy2 * gw + ix2] * tx) * ty;
        row[x] = b;
      }
      for (x = 0; x < w; x++) { var v = g[y * w + x] * 250 / Math.max(40, row[x]); g[y * w + x] = v > 255 ? 255 : v; }
    }
    /* 3. noise estimate on a sample of the page, light denoise if it is noisy */
    var dev = 0, samples = 0;
    for (y = 2; y < h - 2; y += 7) for (x = 2; x < w - 2; x += 7) {
      var cv = g[y * w + x]; if (cv < 150) continue;     /* paper pixels only */
      dev += Math.abs(cv - (g[y * w + x - 1] + g[y * w + x + 1] + g[(y - 1) * w + x] + g[(y + 1) * w + x]) / 4); samples++;
    }
    stats.noise = samples ? dev / samples : 0;
    if (mode !== 'flatten' && stats.noise > 3.2) {
      stats.denoised = true;
      var t2 = new Uint8ClampedArray(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x, ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
        t2[y * w + x] = (4 * g[y * w + x] + 2 * (g[y * w + xm] + g[y * w + xp] + g[ym * w + x] + g[yp * w + x]) + g[ym * w + xm] + g[ym * w + xp] + g[yp * w + xm] + g[yp * w + xp]) >> 4;
      }
      g = t2;
    }
    /* 4. contrast stretch: darkest 0.3 % to black */
    hist.fill(0); for (i = 0; i < n; i++) hist[g[i]]++;
    acc = 0; var blk = 0; for (k = 0; k < 256; k++) { acc += hist[k]; if (acc >= n * 0.003) { blk = k; break; } }
    blk = Math.min(blk, 110);   /* a nearly empty page has almost no ink: never treat paper as black */
    var span = Math.max(100, 250 - blk);
    for (i = 0, x = 0; i < n; i++, x += 4) { var o = (g[i] - blk) * 255 / span; o = o < 0 ? 0 : o > 255 ? 255 : o; d[x] = d[x + 1] = d[x + 2] = o; d[x + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    if (mode !== 'flatten') {
      var deg = estimateSkew(g, w, h);
      if (deg) {
        var tc = document.createElement('canvas'); tc.width = w; tc.height = h; tc.getContext('2d').drawImage(c, 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(tc, -w / 2, -h / 2); ctx.restore();
        stats.skew = deg; stats.rot = { a: deg * Math.PI / 180, cx: w / 2, cy: h / 2 };
      }
    }
    return stats;
  }

  function canvasPng(c) {
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (!b) return reject(new Error('Could not encode the page image')); b.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject); }, 'image/png');
    });
  }

  /* ---------- recognise ---------- */
  /* Words and lines in source-image pixels. toSrc maps a point of the (scaled, straightened) OCR image back to the source image.
   * Each word also gets base: { x0, y0, x1, y1 } (its baseline, source pixels) and each line size (ascender height, source pixels). */
  function flatten(blocks, toSrc) {
    var words = [], lines = [];
    function box(b) {
      var p = [toSrc(b.x0, b.y0), toSrc(b.x1, b.y0), toSrc(b.x1, b.y1), toSrc(b.x0, b.y1)];
      return { x0: Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), y0: Math.min(p[0][1], p[1][1], p[2][1], p[3][1]), x1: Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), y1: Math.max(p[0][1], p[1][1], p[2][1], p[3][1]) };
    }
    (blocks || []).forEach(function (b) {
      b.paragraphs.forEach(function (p) {
        p.lines.forEach(function (ln) {
          var li = lines.length, lw = [];
          var bl = ln.baseline && ln.baseline.x1 !== ln.baseline.x0 ? ln.baseline : { x0: ln.bbox.x0, y0: ln.bbox.y1, x1: ln.bbox.x1, y1: ln.bbox.y1 };
          var slope = (bl.y1 - bl.y0) / (bl.x1 - bl.x0), size = Math.max(4, bl.y0 - ln.bbox.y0);
          var s0 = toSrc(0, 0), s1 = toSrc(0, size), sizeSrc = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
          ln.words.forEach(function (w) {
            var q0 = toSrc(w.bbox.x0, bl.y0 + (w.bbox.x0 - bl.x0) * slope), q1 = toSrc(w.bbox.x1, bl.y0 + (w.bbox.x1 - bl.x0) * slope);
            var o = { text: w.text, bbox: box(w.bbox), confidence: w.confidence, line: li, base: { x0: q0[0], y0: q0[1], x1: q1[0], y1: q1[1] }, size: sizeSrc };
            words.push(o); lw.push(o);
          });
          var lb = toSrc(bl.x0, bl.y0), le = toSrc(bl.x1, bl.y1);
          lines.push({ bbox: box(ln.bbox), baseline: { x0: lb[0], y0: lb[1], x1: le[0], y1: le[1] }, size: sizeSrc,
            text: ln.text.replace(/\s+$/, ''), confidence: ln.confidence, words: lw });
        });
      });
    });
    return { words: words, lines: lines };
  }

  /* opts: lang (loads it if needed), signal, prep 'auto'|'none', psm (default '3'), timeoutMs (default 90000), minConfidence (drop words below), maxSide, canvasIsPrepared */
  async function recognize(src, opts) {
    opts = opts || {};
    checkSignal(opts.signal);
    var key = langList(opts.lang || loadedKey || 'eng').join('+');
    if (!eng || loadedKey !== key) await load(key, opts.onProgress, opts.signal);
    checkSignal(opts.signal);
    var t0 = performance.now(), srcW = src.naturalWidth || src.videoWidth || src.width, srcH = src.naturalHeight || src.videoHeight || src.height;
    var c = toCanvas(src, opts.maxSide || cfg.maxSide), scale = c.width / srcW, pstats = null;
    if (opts.prep !== 'none') pstats = prepCanvas(c, opts.prep === 'flatten' ? 'flatten' : 'auto');
    var png = await canvasPng(c), tPrep = performance.now() - t0;
    c.width = c.height = 1; c = null;                  /* release the working copy before the engine allocates its own */
    checkSignal(opts.signal);
    var myEng = eng, timer = null, onAbort = null, tR = performance.now();
    var done = new Promise(function (resolve, reject) {
      if (opts.signal) { onAbort = function () { reject(abortErr('Stopped')); }; opts.signal.addEventListener('abort', onAbort); }
      timer = setTimeout(function () { reject(new Error('Reading one page took longer than ' + Math.round((opts.timeoutMs || 90000) / 1000) + ' s')); }, opts.timeoutMs || 90000);
    });
    var data;
    try {
      var params = { tessedit_pageseg_mode: String(opts.psm || '3') };
      if (cfg.sendDpi) params.user_defined_dpi = String(opts.dpi || 200);
      await Promise.race([myEng.call('setParameters', { params: params }), done]);
      data = await Promise.race([myEng.call('recognize', { image: png, options: {}, output: { text: true, blocks: true, hocr: false, tsv: false, pdf: false, unlv: false, box: false, osd: false, imageColor: false, imageGrey: false, imageBinary: false, debug: false } }), done]);
    } catch (err) {
      /* a stopped or timed-out job cannot be interrupted inside WebAssembly: drop the worker, the next call reloads it from cache */
      if (eng === myEng) { unload(); }
      throw err;
    } finally { clearTimeout(timer); if (opts.signal && onAbort) opts.signal.removeEventListener('abort', onAbort); }
    var rot = pstats && pstats.rot, ca = rot ? Math.cos(-rot.a) : 1, sa = rot ? Math.sin(-rot.a) : 1;
    var toSrc = function (x, y) {
      if (rot) { var dx = x - rot.cx, dy = y - rot.cy; x = rot.cx + dx * ca - dy * sa; y = rot.cy + dx * sa + dy * ca; }
      return [x / scale, y / scale];
    };
    var f = flatten(data.blocks, toSrc), min = opts.minConfidence == null ? 0 : opts.minConfidence;
    var words = f.words.filter(function (w) { return w.text.trim() && w.confidence >= min; });
    return { text: data.text || '', words: words, lines: f.lines, confidence: data.confidence, width: srcW, height: srcH, ms: Math.round(performance.now() - t0),
      skew: pstats ? pstats.skew : 0, timings: { prepMs: Math.round(tPrep), recognizeMs: Math.round(performance.now() - tR) }, prep: pstats, lang: key };
  }

  /* ---------- searchable PDF: invisible text layer, word by word ---------- */
  /* Tesseract's "GlyphLessFont" (Apache-2.0, tesseract-ocr/tesseract src/api/pdf_ttf.h): a 572-byte TrueType font whose every glyph is blank,
   * with CID = UTF-16 code unit and an identity ToUnicode map. Text drawn in render mode 3 selects, searches and copies as Unicode. */
  var GLYPHLESS_TTF = 'AAEAAAAKAIAAAwAgT1MvMlbeyJQAAAEoAAAAYGNtYXAACgA0AAABkAAAAB5nbHlmFSJBJAAAAbgAAAAYaGVhZAt48WUAAACsAAAANmhoZWEMAgQCAAAA5AAAACRobXR4BAAAAAAAAYgAAAAIbG9jYQAMAAAAAAGwAAAABm1heHAABAAFAAABCAAAACBuYW1l8usW2gAAAdAAAABLcG9zdAABAAEAAAIcAAAAIAABAAAAAQAAsJRxEF8PPPUEBwgAAAAAAM+a/G4AAAAA1MOn8gAAAAAEAAgAAAAAEAACAAAAAAAAAAEAAAgA//8AAAQAAAAAAAQAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAQAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAR09PRwBAAAAAAAAB//8AAAABAAGAAAAAAAAAAAAAAAAAAAABAAAAAAAABAAAAAAAAAIAAQAAAAAAFAADAAAAAAAUAAYACgAAAAAAAAAAAAAAAAAMAAAAAQAAAAAEAAgAAAMAADEhESEEAPwACAAAAAADACoAAAADAAAABQAWAAAAAQAAAAAABQALABYAAwABBAkABQAWAAAAVgBlAHIAcwBpAG8AbgAgADEALgAwVmVyc2lvbiAxLjAAAAEAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=';
  var TOUNICODE = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo\n<<\n  /Registry (Adobe)\n  /Ordering (UCS)\n  /Supplement 0\n>> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';

  function b64(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  function addGlyphlessFont(pdfDoc) {
    var L = global.PDFLib, ctx = pdfDoc.context, N = L.PDFName, ttf = ctx.register(ctx.stream(b64(GLYPHLESS_TTF), { Length1: 572 }));
    /* CIDToGIDMap: every CID -> glyph 1 (the blank glyph). 128 KB raw; stored uncompressed here and deflated by pdf-lib's save via useObjectStreams off + a Flate filter */
    var map = new Uint8Array(131072); for (var i = 0; i < 65536; i++) { map[i * 2] = 0; map[i * 2 + 1] = 1; }
    var mapStream = ctx.flateStream(map);
    var toUni = ctx.register(ctx.flateStream(TOUNICODE));
    var desc = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'GlyphLessFont', Flags: 5, FontBBox: [0, 0, 500, 1000], ItalicAngle: 0, Ascent: 1000, Descent: -1, CapHeight: 1000, StemV: 80, FontFile2: ttf }));
    var cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GlyphLessFont', CIDSystemInfo: { Registry: L.PDFString.of('Adobe'), Ordering: L.PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: desc, CIDToGIDMap: ctx.register(mapStream), DW: 500 }));
    return ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GlyphLessFont', Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUni }));
  }

  function hexOf(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); out += (c < 4096 ? (c < 256 ? (c < 16 ? '000' : '00') : '0') : '') + c.toString(16); }
    return out;
  }

  /* Draw every OCR word of one page. `toPdf(px, py)` maps a pixel of the OCR image to PDF user space (pdf.js viewport.convertToPdfPoint). */
  function drawWords(L, page, fontName, res, toPdf, pxToPt) {
    var ops = [L.pushGraphicsState(), L.beginText(), L.setTextRenderingMode(L.TextRenderingMode.Invisible)];
    var wrote = 0, PO = L.PDFOperator, PN = L.PDFNumber, NM = L.PDFName;
    res.lines.forEach(function (ln) {
      var lastIdx = ln.words.length - 1;
      ln.words.forEach(function (w, wi) {
        var text = w.text.replace(/[\u0000-\u001f\u007f]/g, '');
        if (!text) return;
        var p0 = toPdf(w.base.x0, w.base.y0), p1 = toPdf(w.base.x1, w.base.y1);
        var wPt = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        var size = (w.size || ln.size) * pxToPt;          /* Ascent is 1000 and Descent -1, so the font size is the ascender height */
        var n = text.length, nat = n * 0.5 * size;         /* every glyph advances 500/1000 of the size */
        var tz = Math.max(10, Math.min(1000, (wPt / nat) * 100));
        var c = Math.cos(ang), s = Math.sin(ang);
        ops.push(PO.of('Tf', [NM.of(fontName), PN.of(+size.toFixed(2))]));
        ops.push(PO.of('Tz', [PN.of(+tz.toFixed(2))]));
        ops.push(L.setTextMatrix(+c.toFixed(5), +s.toFixed(5), +(-s).toFixed(5), +c.toFixed(5), +p0[0].toFixed(2), +p0[1].toFixed(2)));
        ops.push(L.showText(L.PDFHexString.of(hexOf(text + (wi < lastIdx ? ' ' : '')))));
        wrote++;
      });
    });
    ops.push(L.endText(), L.popGraphicsState());
    if (wrote) page.pushOperators.apply(page, ops);
    return wrote;
  }

  /* ---------- which pages need reading ---------- */
  function isPdfjsDoc(x) { return x && typeof x.getPage === 'function' && typeof x.numPages === 'number'; }
  function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }
  function openPdfjs(bytes) {
    var pj = global.pdfjsLib;
    if (pj.GlobalWorkerOptions && !pj.GlobalWorkerOptions.workerSrc) pj.GlobalWorkerOptions.workerSrc = abs('assets/vendor/pdf.worker.min.js');
    return pj.getDocument({ data: u8(bytes).slice(), isEvalSupported: false }).promise;   /* never without isEvalSupported: false (CVE-2024-4367) */
  }
  /* A page "needs reading" when it has (almost) no text and paints an image: a scan or a photo of a page. 0-based page numbers. */
  async function status(input, opts) {
    opts = opts || {};
    var own = !isPdfjsDoc(input), pdf = own ? await openPdfjs(input) : input;
    try {
      var n = Math.min(pdf.numPages, opts.maxPages || 2000), out = { count: pdf.numPages, pages: [], scans: [], text: [] };
      var O = global.pdfjsLib && global.pdfjsLib.OPS;
      for (var p = 1; p <= n; p++) {
        checkSignal(opts.signal);
        var page = await pdf.getPage(p), tc = await page.getTextContent(), chars = 0, picture = false;
        (tc.items || []).forEach(function (it) { chars += String(it.str || '').replace(/\s/g, '').length; });
        if (chars <= 25 && O) {
          try {
            var ol = await page.getOperatorList();
            picture = ol.fnArray.some(function (f) { return f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintJpegXObject || f === O.paintImageXObjectRepeat; });
          } catch (e) { picture = false; }
        }
        var row = { page: p - 1, chars: chars, picture: picture, scan: chars <= 25 && picture };
        out.pages.push(row);
        (row.scan ? out.scans : chars > 25 ? out.text : []).push(p - 1);
        page.cleanup();
        if (p % 8 === 0) await sleep(0);
      }
      return out;
    } finally { if (own) { try { pdf.destroy(); } catch (e) { /* ignore */ } } }
  }

  /* opts: lang, pages (1-based), dpi, skipTextPages (default true), signal, minConfidence (default 25), timeoutMs,
     onProgress({ stage: 'engine'|'language'|'starting'|'page'|'page-done', loaded, total, fraction, page, index, count, words, ms }).
     The bytes returned carry .report = { pages:[{ page (1-based), words, uncertain, confidence, ms, weak } | { page, skipped }], words, uncertain, skipped, weak:[page] }. */
  async function makeSearchable(pdfBytes, opts) {
    opts = opts || {};
    var L = global.PDFLib, pj = global.pdfjsLib;
    if (!L || !pj) throw new Error('makeSearchable needs pdf-lib and pdf.js on the page');
    var signal = opts.signal, dpi = opts.dpi || defaults().dpi, progress = opts.onProgress || function () {};
    var key = langList(opts.lang || 'eng').join('+');
    await load(key, function (p) { progress(Object.assign({ page: 0 }, p)); }, signal);
    checkSignal(signal);
    var bytes = u8(pdfBytes);
    var pdf = await openPdfjs(bytes);
    try {
      var doc;
      try { doc = await L.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }); }
      catch (e) { var le = new Error('This PDF is locked with a password. Unlock it first, then make it searchable.'); le.code = 'locked'; throw le; }
      var fontRef = null, FNAME = 'GlyphLessFont';
      var wanted = opts.pages && opts.pages.length ? opts.pages.slice() : Array.apply(null, { length: pdf.numPages }).map(function (_, i) { return i + 1; });
      var report = { pages: [], words: 0, uncertain: 0, skipped: 0, weak: [] };
      for (var wi = 0; wi < wanted.length; wi++) {
        checkSignal(signal);
        var pn = wanted[wi];
        if (pn < 1 || pn > pdf.numPages) continue;
        var pg = await pdf.getPage(pn), page = doc.getPage(pn - 1);
        progress({ stage: 'page', page: pn, index: wi, count: wanted.length, fraction: wi / wanted.length });
        if (opts.skipTextPages !== false) {
          var tc = await pg.getTextContent(), chars = 0; tc.items.forEach(function (it) { chars += (it.str || '').replace(/\s/g, '').length; });
          if (chars > 25) { report.pages.push({ page: pn, skipped: 'already has text' }); report.skipped++; pg.cleanup(); continue; }
        }
        var base = pg.getViewport({ scale: 1 }), scale = dpi / 72;
        scale = Math.min(scale, Math.sqrt(cfg.maxPixels / (base.width * base.height)));
        var vp = pg.getViewport({ scale: scale }), cv = document.createElement('canvas');
        cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        var cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        var res;
        try {
          await pg.render({ canvasContext: cx, viewport: vp }).promise;
          checkSignal(signal);
          res = await recognize(cv, { lang: key, signal: signal, dpi: Math.round(scale * 72), minConfidence: opts.minConfidence == null ? 25 : opts.minConfidence, timeoutMs: opts.timeoutMs });
        } finally { cv.width = cv.height = 1; cx = null; pg.cleanup(); }   /* one page in memory at a time */
        /* lines whose words were filtered keep only the surviving words */
        var keep = new Set(res.words);
        var res2 = { lines: res.lines.map(function (ln) { return Object.assign({}, ln, { words: ln.words.filter(function (w) { return keep.has(w); }) }); }).filter(function (ln) { return ln.words.length; }) };
        if (!fontRef) fontRef = addGlyphlessFont(doc);
        page.node.setFontDictionary(L.PDFName.of(FNAME), fontRef);
        var nw = drawWords(L, page, FNAME, res2, function (x, y) { return vp.convertToPdfPoint(x, y); }, 1 / scale);
        var unsure = res.words.filter(function (w) { return w.confidence < 60; }).length;
        var weak = nw < 5 || res.confidence < 50;
        report.pages.push({ page: pn, words: nw, uncertain: unsure, confidence: Math.round(res.confidence), ms: res.ms, weak: weak });
        report.words += nw; report.uncertain += unsure; if (weak) report.weak.push(pn);
        res = res2 = keep = null;
        progress({ stage: 'page-done', page: pn, index: wi + 1, count: wanted.length, fraction: (wi + 1) / wanted.length, words: nw });
      }
      checkSignal(signal);
      var out = await doc.save({ useObjectStreams: false });
      out.report = report;
      return out;
    } finally { try { pdf.destroy(); } catch (e) { /* ignore */ } }
  }

  /* ---------- storage manager hooks ---------- */
  async function cachedLanguages() {
    var ids = await cachedIds();
    return LANGS.filter(function (l) { return ids[l.id]; }).map(function (l) { return { id: l.id, label: l.label, bytes: l.bytes, url: abs(l.path) }; });
  }
  async function clearCache(id) {
    if (!global.caches || !(await caches.has(CACHE))) return 0;
    var cache = await caches.open(CACHE), n = 0;
    for (var i = 0; i < LANGS.length; i++) if (!id || LANGS[i].id === id) { if (await cache.delete(new Request(abs(LANGS[i].path)))) n++; }
    if (!id || id === 'engine') {
      var eng2 = [ENGINE.worker, ENGINE.simd, ENGINE.plain];
      for (var j = 0; j < eng2.length; j++) if (await cache.delete(new Request(abs(eng2[j])))) n++;
    }
    return n;
  }

  LE.ocr = {
    config: function (o) {
      if (o && o.root) cfg.root = new URL(o.root, location.href).href;
      if (o && o.maxSide) cfg.maxSide = o.maxSide;
      if (o && o.maxPixels) cfg.maxPixels = o.maxPixels;
      if (o && o.params) cfg.params = o.params;
      if (o && o.sendDpi != null) cfg.sendDpi = o.sendDpi;
      return cfg;
    },
    defaults: defaults,
    languages: function () { return LANGS.map(function (l) { return Object.assign({}, l, { url: abs(l.path) }); }); },
    languagesWithCache: async function () { var ids = await cachedIds(); return LANGS.map(function (l) { return Object.assign({}, l, { url: abs(l.path), cached: !!ids[l.id] }); }); },
    available: available,
    engineBytes: function () { return hasSimd() ? ENGINE.simdBytes : ENGINE.plainBytes; },
    engineCached: function () { return engineCached(); },
    isLoaded: function () { return eng ? loadedKey : null; },
    hasSimd: hasSimd,
    load: load, recognize: recognize, status: status, makeSearchable: makeSearchable, unload: unload,
    cachedLanguages: cachedLanguages, clearCache: clearCache,
    _prep: prepCanvas, _toCanvas: toCanvas, _idsFromManifest: idsFromManifest
  };
  cfg.maxPixels = defaults().maxPixels;

  /* What /device-check/ and LE.support.gate() know about this feature (docs/SUPPORT.md). A non-SIMD engine exists (2.2 times
     slower), so SIMD is a "want". Ambiguous answers (no deviceMemory on Safari and Firefox) leave "Try anyway" on. */
  (global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || []).push({
    id: 'ocr.read', name: 'Make scanned PDFs searchable', group: 'PDF studio',
    needs: ['wasm', 'worker'], wants: ['wasm-simd', 'cache-storage', 'device-memory-4gb'], memoryMB: 350, downloadMB: 8,
    note: 'Reads the text in scanned pages on this device, so you can search, select and copy it.'
  });
})(window);

/* =====================================================================
   Part 2: "Make searchable" in the PDF studio
   ===================================================================== */
(function (global) {
  'use strict';
  var LE = global.LE || {};
  var OCR = LE.ocr;
  var PS = global.PS;
  if (!PS || !PS.panels || !PS.S || !OCR) return;
  var d = global.document;
  var S = PS.S;
  var el = PS.el, esc = PS.esc, $ = PS.$;
  var MB = 1048576;

  var I = {
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9h8M8 12h8M8 15h5"/>',
    text: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    save: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19.5 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'
  };
  function ic(name, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>'; }
  function h(tag, cls, html, attrs) { var n = el(tag, cls, html); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function button(cls, html, onClick, attrs) { var b = h('button', cls, html, attrs); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; }
  function say(m, ms) { if (PS.say) PS.say(m, ms); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function isAbort(e) { return e && (e.name === 'AbortError' || e.cancelled); }
  function list(nums) { return nums.length === 1 ? String(nums[0]) : nums.slice(0, -1).join(', ') + ' and ' + nums[nums.length - 1]; }

  var DEF = OCR.defaults();
  var ST = {
    status: {}, checking: {}, dismissed: {}, busy: false, last: null, pane: null, offer: null, avail: ['eng'],
    lang: lsGet('le-ocr-lang') || 'eng', dpi: +lsGet('le-ocr-dpi') || DEF.dpi, onlyNoText: true, readScansForFind: false, sections: []
  };
  if (ST.dpi > DEF.maxDpi) ST.dpi = DEF.dpi;
  OCR.available().then(function (ids) { ST.avail = ids; if (ids.indexOf(ST.lang) < 0) ST.lang = 'eng'; render(); });

  /* The storage manager names our cache entries (le-pwa.js lists 'le-models-v1' under "AI models"). */
  function describe() {
    if (!global.LEPwa || !LEPwa.describeModel) return false;
    LEPwa.describeModel('ocr-engine', { name: 'Text reader', about: 'Reads the text in scanned pages (Make searchable)' });
    OCR.languages().forEach(function (l) { LEPwa.describeModel('ocr-' + l.id, { name: 'Text reader: ' + l.label, about: 'Language data for Make searchable' }); });
    return true;
  }
  if (!describe()) global.addEventListener('load', function () { if (!describe()) setTimeout(describe, 1500); });

  /* ---------- which pages are scans ---------- */

  function docIdsInUse() {
    var ids = [];
    S.pages.forEach(function (r) { if (r.docId && S.docs[r.docId] && ids.indexOf(r.docId) < 0) ids.push(r.docId); });
    return ids;
  }
  /* { pages: refs in the document, scans: refs on scanned pages, checking: bool, text: refs with text } */
  function summary() {
    var out = { pages: S.pages.length, scans: 0, text: 0, checking: false, docs: [] };
    var byDoc = {};
    S.pages.forEach(function (r) {
      if (!r.docId) return;
      var st = ST.status[r.docId];
      if (!st) { out.checking = true; return; }
      var row = st.pages[r.pageIndex];
      if (!row) return;
      if (row.scan) { out.scans++; (byDoc[r.docId] = byDoc[r.docId] || []).push(r.pageIndex + 1); }
      else if (row.chars > 25) out.text++;
    });
    Object.keys(byDoc).forEach(function (id) { out.docs.push({ docId: id, pages: byDoc[id].filter(function (p, i, a) { return a.indexOf(p) === i; }).sort(function (a, b) { return a - b; }) }); });
    return out;
  }
  var checkTimer = null;
  function scheduleCheck() { clearTimeout(checkTimer); checkTimer = setTimeout(check, 250); }
  function check() {
    docIdsInUse().forEach(function (id) {
      if (ST.status[id] || ST.checking[id]) return;
      var doc = S.docs[id];
      if (!doc || !doc._pdfjs) return;
      ST.checking[id] = true;
      OCR.status(doc._pdfjs, { maxPages: 500 }).then(function (st) { ST.status[id] = st; }, function () { ST.status[id] = { count: 0, pages: [], scans: [], text: [] }; })
        .then(function () { delete ST.checking[id]; refreshOffer(); render(); });
    });
    refreshOffer();
  }

  /* ---------- the offer: shown once per document, when it has scanned pages ---------- */

  function refreshOffer() {
    var stage = d.getElementById('ps-stage');
    if (!stage) return;
    var sm = summary();
    var key = docIdsInUse().join('|');
    var show = sm.scans > 0 && !ST.busy && !ST.dismissed[key] && S.pages.length && S.panel !== 'scan';
    if (!show) { if (ST.offer) ST.offer.hidden = true; return; }
    if (!ST.offer) {
      ST.offer = h('div', 'por-offer', '', { role: 'region', 'aria-label': 'Scanned pages' });
      stage.appendChild(ST.offer);
      ST.offer.addEventListener('click', function (e) {
        var b = e.target.closest('[data-por-offer]');
        if (!b) return;
        var a = b.getAttribute('data-por-offer');
        ST.dismissed[docIdsInUse().join('|')] = true;
        ST.offer.hidden = true;
        if (a === 'go') { PS.openPanel('scan'); run({}); }
      });
    }
    var all = sm.scans === sm.pages;
    ST.offer.innerHTML = '<span class="por-offer-ic">' + ic('scan') + '</span>' +
      '<p class="por-offer-t"><strong>' + (all ? (sm.pages === 1 ? 'This page is a scan.' : 'This PDF is a scan.') : esc(plural(sm.scans, 'page')) + ' ' + (sm.scans === 1 ? 'is a scan.' : 'are scans.')) + '</strong>' +
      '<span>' + (all || sm.scans === 1 ? 'Its' : 'Their') + ' text can’t be searched, selected or copied yet.</span></p>' +
      '<button class="btn btn-sm btn-ink por-offer-go" type="button" data-por-offer="go">' + ic('search') + '<span>Make searchable</span></button>' +
      '<button class="ps-ib por-offer-x" type="button" data-por-offer="close" aria-label="Not now">' + ic('close') + '</button>';
    ST.offer.hidden = false;
  }

  /* ---------- the job ---------- */

  function langLabel(id) { var l = OCR.languages().filter(function (x) { return x.id === id; })[0]; return l ? l.label : id; }

  /* LE.downloads decides whether to ask (docs/DOWNLOADS.md): silent in automatic mode, one question in "ask" mode or on a metered line. */
  async function allowDownload(lang) {
    var D = LE.downloads;
    try { if (D && D.used) D.used('ocr'); } catch (e) { /* ignore */ }
    var need = 0, langs = await OCR.languagesWithCache();
    String(lang).split('+').forEach(function (id) { var l = langs.filter(function (x) { return x.id === id; })[0]; if (l && !l.cached) need += l.bytes; });
    if (!(await OCR.engineCached())) need += OCR.engineBytes();
    if (!need) return { ok: true, bytes: 0 };
    if (!D || !D.request) return { ok: true, bytes: need };
    var r = await D.request({ id: 'ocr-' + lang, name: 'Text reader (' + langLabel(lang) + ')', bytes: need, kind: 'model', reason: 'Reads the text in scanned pages on this device' });
    return { ok: !!r.ok, why: r.why, bytes: need };
  }

  /* Progress card with Cancel; Cancel stops the engine at once (it terminates the worker). */
  function progressCard(label, ctrl) {
    var pr = PS.progress(label, true);
    var cb = d.querySelector('#ps-progress .ps-prog-cancel');
    function onCancel() { ctrl.abort(); }
    if (cb) cb.addEventListener('click', onCancel);
    return {
      set: function (done, total, sub) { try { pr.set(done, total, sub); } catch (e) { /* cancelled: the abort is already on its way */ } },
      end: function () { if (cb) cb.removeEventListener('click', onCancel); pr.end(); }
    };
  }

  /* Runs makeSearchable over a list of { bytes, pages } jobs with one progress card, one download chip and one cancel. */
  async function readJobs(jobs, opts) {
    var ctrl = new AbortController(), lang = opts.lang || ST.lang, dpi = opts.dpi || ST.dpi;
    var total = jobs.reduce(function (a, j) { return a + j.pages.length; }, 0);
    var card = progressCard(opts.label || 'Reading the text in your scans', ctrl);
    var D = LE.downloads, chip = null, done = 0, t0 = 0, outs = [];
    try {
      if (LE.pdf && LE.pdf.ready) await LE.pdf.ready();
      var allow = await allowDownload(lang);
      if (!allow.ok) {
        var e1 = new Error(allow.why === 'space' ? 'There is not enough space on this device for the text reader.' : 'The text reader was not downloaded. Press the button again when you are ready.');
        e1.code = 'download'; throw e1;
      }
      if (allow.bytes && D && D.track) chip = D.track('ocr-' + lang, { name: 'Text reader (' + langLabel(lang) + ')', bytes: allow.bytes, cancel: function () { ctrl.abort(); } });
      var dl = { engine: 0, language: 0 };
      function onProgress(p) {
        if (p.stage === 'engine' || p.stage === 'language') {
          dl[p.stage] = p.cached ? 0 : p.loaded || 0;
          var got = dl.engine + dl.language;
          if (chip) chip.progress(got, allow.bytes);
          if (allow.bytes) card.set(got, allow.bytes, 'Getting the text reader ready (first time only) · ' + (got / MB).toFixed(1) + ' of ' + (allow.bytes / MB).toFixed(1) + ' MB');
          else card.set(0, 1, 'Starting the text reader');
        } else if (p.stage === 'starting') {
          if (chip) { chip.done(); chip = null; }
          card.set(0, 1, 'Starting the text reader');
        } else if (p.stage === 'page') {
          if (!t0) t0 = Date.now();
          var left = '';
          if (done > 0) { var s = Math.round((Date.now() - t0) / done * (total - done) / 1000); left = s >= 5 ? ' · about ' + (s >= 90 ? Math.round(s / 60) + ' min' : s + ' s') + ' left' : ''; }
          card.set(done, total, 'Page ' + (done + 1) + ' of ' + total + left);
        } else if (p.stage === 'page-done') {
          done++;
          card.set(done, total, 'Page ' + Math.min(done + 1, total) + ' of ' + total);
        }
      }
      for (var i = 0; i < jobs.length; i++) {
        var out = await OCR.makeSearchable(jobs[i].bytes, { lang: lang, dpi: dpi, pages: jobs[i].pages, skipTextPages: opts.skipTextPages, signal: ctrl.signal, onProgress: onProgress });
        outs.push(out);
      }
      if (chip) chip.done();
      if (LE.support && LE.support.reportSuccess) LE.support.reportSuccess('ocr.read');
      return outs;
    } catch (e) {
      if (chip) { if (isAbort(e)) chip.done(); else chip.fail(e); }
      if (!isAbort(e) && e.code !== 'download' && e.code !== 'locked' && LE.support && LE.support.reportFailure) LE.support.reportFailure('ocr.read', e);
      throw e;
    } finally {
      card.end();
      OCR.unload();                       /* an idle engine holds 100-200 MB: free it as soon as the job ends */
    }
  }

  /* Replace a source document by its searchable copy. Page refs keep their rotation and annotations; Undo brings the old one back. */
  function swapDoc(oldId, doc) {
    S.docs[doc.id] = doc;
    S.docNames[doc.id] = S.docNames[oldId] || doc.name;
    if (S.formValues && S.formValues[oldId]) S.formValues[doc.id] = JSON.parse(JSON.stringify(S.formValues[oldId]));
    if (S.fields && S.fields.some(function (f) { return f.docId === oldId; })) {
      S.fields = S.fields.concat(S.fields.filter(function (f) { return f.docId === oldId; }).map(function (f) { return Object.assign({}, f, { docId: doc.id, key: doc.id + '|' + f.name }); }));
    }
    var old = ST.status[oldId];
    PS.commitPages(function () { S.pages.forEach(function (r) { if (r.docId === oldId) r.docId = doc.id; }); }, 'Make searchable');
    return old;
  }

  /* opts: { lang, dpi, all (also pages that already have text) } */
  function run(opts) {
    opts = opts || {};
    if (ST.busy) return Promise.resolve(null);
    var go = function () { return runJob(opts); };
    if (LE.support && LE.support.gate) return Promise.resolve(LE.support.gate('ocr.read', { title: 'Make searchable', run: go, onCancel: function () {} }));
    return go();
  }
  async function runJob(opts) {
    var sm = summary(), jobs = [];
    var all = opts.all != null ? opts.all : !ST.onlyNoText;
    if (all) {
      docIdsInUse().forEach(function (id) {
        var pages = [];
        S.pages.forEach(function (r) { if (r.docId === id && pages.indexOf(r.pageIndex + 1) < 0) pages.push(r.pageIndex + 1); });
        pages.sort(function (a, b) { return a - b; });
        jobs.push({ docId: id, pages: pages });
      });
    } else jobs = sm.docs.map(function (x) { return { docId: x.docId, pages: x.pages }; });
    jobs = jobs.filter(function (j) { return j.pages.length && S.docs[j.docId]; });
    if (!jobs.length) { say(sm.checking ? 'Still checking the pages. Try again in a moment.' : 'Every page already has text you can search.'); return null; }
    if (jobs.some(function (j) { return S.docs[j.docId].encrypted; })) { ST.last = { error: 'This PDF is locked with a password. Unlock it first (Bulk, then Password-protect or unlock).' }; render(); return null; }
    ST.busy = true; ST.last = null;
    if (ST.offer) ST.offer.hidden = true;
    render();
    var t0 = Date.now();
    try {
      var outs = await readJobs(jobs.map(function (j) { return { bytes: S.docs[j.docId]._bytes, pages: j.pages }; }), { lang: opts.lang, dpi: opts.dpi, skipTextPages: !all });
      var rep = { pages: 0, words: 0, uncertain: 0, weak: [], skipped: 0, ms: 0 };
      for (var i = 0; i < jobs.length; i++) {
        var r = outs[i].report || { pages: [] };
        var doc = await LE.pdf.open(outs[i], { name: S.docs[jobs[i].docId].name });
        var oldStatus = swapDoc(jobs[i].docId, doc);
        /* the new document's page status is known: what was a scan now has text */
        if (oldStatus) ST.status[doc.id] = { count: oldStatus.count, pages: oldStatus.pages.map(function (p) { var hit = r.pages.filter(function (x) { return x.page === p.page + 1 && !x.skipped; })[0]; return hit ? { page: p.page, chars: 99, picture: p.picture, scan: false, read: true } : p; }), scans: [], text: [] };
        r.pages.forEach(function (p) { if (p.skipped) rep.skipped++; else rep.pages++; });
        rep.words += r.words || 0; rep.uncertain += r.uncertain || 0;
        (r.weak || []).forEach(function (pn) { var idx = -1; S.pages.forEach(function (ref, k) { if (idx < 0 && ref.docId === doc.id && ref.pageIndex === pn - 1) idx = k; }); rep.weak.push(idx >= 0 ? idx + 1 : pn); });
      }
      rep.ms = Date.now() - t0;
      ST.last = { ok: true, report: rep, lang: opts.lang || ST.lang, dpi: opts.dpi || ST.dpi };
      ST.dismissed[docIdsInUse().join('|')] = true;
      say(rep.pages ? plural(rep.pages, 'page') + ' made searchable. Search with Ctrl+F or the magnifier.' : 'Nothing needed reading.', 4200);
      return ST.last;
    } catch (e) {
      ST.last = isAbort(e) ? { stopped: true } : { error: e && e.message ? e.message : 'The text could not be read.' };
      if (isAbort(e)) say('Stopped. The document is unchanged.');
      return ST.last;
    } finally {
      ST.busy = false;
      render();
      check();
    }
  }

  /* ---------- text out: copy and save ---------- */

  async function allText() {
    var parts = [];
    for (var i = 0; i < S.pages.length; i++) {
      var r = S.pages[i];
      if (!r.docId || !S.docs[r.docId] || !S.docs[r.docId].text) continue;
      try { var t = await S.docs[r.docId].text(r.pageIndex); if (t && t.text) parts.push(t.text); } catch (e) { /* skip a page that cannot be read */ }
    }
    return parts.join('\n\n');
  }
  async function copyText() {
    var t = await allText();
    if (!t.trim()) { say('There is no text to copy yet. Make the pages searchable first.'); return false; }
    try { await navigator.clipboard.writeText(t); }
    catch (e) {
      var ta = d.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      d.body.appendChild(ta); ta.select(); var ok = false; try { ok = d.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove(); t = '';
      if (!ok) { say('Copying is blocked here. Use Save text instead.'); return false; }
    }
    say('Copied the text of ' + plural(S.pages.length, 'page') + '.');
    return true;
  }
  async function saveText() {
    var t = await allText();
    if (!t.trim()) { say('There is no text to save yet. Make the pages searchable first.'); return false; }
    var blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
    var name = (PS.baseName ? PS.baseName(S.name || 'document') : 'document') + '.txt';
    if (global.IT && IT.download) IT.download(blob, name);
    else { var a = d.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; d.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    return true;
  }

  /* ---------- the panel ---------- */

  function seg(options, value, onPick, label) {
    var w = h('div', 'seg ps-seg por-seg', '', { role: 'group', 'aria-label': label });
    options.forEach(function (o) {
      var b = button(null, esc(o[1]), function () {
        [].forEach.call(w.children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onPick(o[0]);
      }, { 'aria-pressed': String(o[0] === value), 'data-v': String(o[0]) });
      w.appendChild(b);
    });
    return w;
  }

  function readSection() {
    var s = h('section', 'ps-sec por-read');
    s.appendChild(h('h3', 'ps-sec-title', 'Read the text in scans'));
    if (!S.pages.length) {
      s.appendChild(h('p', 'ps-note', 'Open a scanned PDF and make it searchable: you can then find words, select them and copy them. It is read on this device; nothing is uploaded.'));
      s.appendChild(button('btn btn-sm', ic('text') + '<span>Open a PDF</span>', function () { if (PS.intent) PS.intent('open'); }, { 'data-por': 'open' }));
      return s;
    }
    var sm = summary();
    var line = sm.checking ? 'Checking the pages…'
      : sm.scans ? (sm.scans === sm.pages ? (sm.pages === 1 ? 'This page is a scan with no text.' : 'All ' + sm.pages + ' pages are scans with no text.') : plural(sm.scans, 'page') + ' of ' + sm.pages + (sm.scans === 1 ? ' is a scan' : ' are scans') + ' with no text.')
        : 'Every page already has text you can search.';
    s.appendChild(h('p', 'por-status' + (sm.scans ? ' has-scans' : ''), ic(sm.scans ? 'scan' : 'check') + '<span>' + esc(line) + '</span>', { 'aria-live': 'polite' }));

    if (ST.avail.length > 1) {
      var f = h('label', 'ps-label', 'Language of the text', { for: 'por-lang' });
      var sel = h('select', 'select por-lang', '', { id: 'por-lang' });
      ST.avail.forEach(function (id) { var o = d.createElement('option'); o.value = id; o.textContent = langLabel(id); o.selected = id === ST.lang; sel.appendChild(o); });
      sel.addEventListener('change', function () { ST.lang = sel.value; lsSet('le-ocr-lang', sel.value); });
      s.appendChild(f); s.appendChild(sel);
    } else s.appendChild(h('p', 'ps-note por-lang-one', 'Language: English'));

    s.appendChild(h('div', 'ps-eyebrow', 'Quality'));
    var q = [[150, 'Faster'], [200, 'Standard']];
    if (DEF.maxDpi >= 300) q.push([300, 'Sharper']);
    s.appendChild(seg(q, ST.dpi, function (v) { ST.dpi = +v; lsSet('le-ocr-dpi', String(v)); }, 'Quality'));

    var tg = h('label', 'ps-toggle por-only');
    var cb = d.createElement('input'); cb.type = 'checkbox'; cb.checked = ST.onlyNoText;
    cb.addEventListener('change', function () { ST.onlyNoText = cb.checked; render(); });
    tg.appendChild(cb); tg.appendChild(h('span', 'ps-toggle-ui'));
    tg.appendChild(h('span', 'ps-toggle-text', 'Only pages without text<small>Pages that already have text stay exactly as they are.</small>'));
    s.appendChild(tg);

    var go = button('btn btn-gold btn-block por-go', ic('search') + '<span>' + (ST.busy ? 'Reading…' : 'Make searchable') + '</span>', function () { run({}); }, { 'data-por': 'go' });
    go.disabled = ST.busy || sm.checking || (ST.onlyNoText && !sm.scans);
    s.appendChild(go);
    if (!ST.last && sm.scans) s.appendChild(h('p', 'ps-note por-first', 'The first time, the text reader is downloaded once (about ' + Math.round((OCR.engineBytes() + 4113088) / MB) + ' MB) and kept on this device. Pages are read one at a time; you can stop at any moment.'));

    var L = ST.last;
    if (L && L.ok) {
      var r = L.report;
      var box = h('div', 'por-result', '', { role: 'status' });
      box.appendChild(h('p', 'por-result-head', ic('check') + '<strong>' + esc(r.pages ? plural(r.pages, 'page') + ' made searchable' : 'Nothing needed reading') + '</strong>'));
      var lines = [];
      if (r.pages) lines.push(plural(r.words, 'word') + ' found' + (r.uncertain ? ', ' + r.uncertain + ' of them uncertain' : '') + '.');
      if (r.weak.length) lines.push('Page ' + list(r.weak) + (r.weak.length === 1 ? ' was' : ' were') + ' hard to read.' + (ST.dpi < DEF.maxDpi ? ' Try a sharper quality.' : ''));
      lines.push('Search with Ctrl+F or the magnifier. Save PDF keeps the text. Undo puts the original back.');
      lines.forEach(function (t) { box.appendChild(h('p', 'por-result-line', esc(t))); });
      s.appendChild(box);
    } else if (L && L.error) s.appendChild(h('p', 'ps-note ps-bad por-error', esc(L.error), { role: 'alert' }));
    else if (L && L.stopped) s.appendChild(h('p', 'ps-note por-stopped', 'Stopped. The document is unchanged.'));

    var tx = h('div', 'por-textacts');
    tx.appendChild(button('btn btn-sm', ic('copy') + '<span>Copy text</span>', function () { copyText(); }, { 'data-por': 'copy' }));
    tx.appendChild(button('btn btn-sm', ic('save') + '<span>Save text (.txt)</span>', function () { saveText(); }, { 'data-por': 'save-text' }));
    s.appendChild(tx);
    return s;
  }

  function render() {
    var pane = ST.pane;
    if (!pane) return;
    var keep = PS.E && PS.E.panelBody ? PS.E.panelBody.scrollTop : 0;
    pane.innerHTML = '';
    pane.appendChild(h('p', 'por-private', ic('lock') + '<span>Read and scanned on this device. Nothing is uploaded.</span>'));
    var parts = [];
    ST.sections.forEach(function (sec) { try { var n = sec.render(); if (n) parts.push({ order: sec.order || 0, node: n }); } catch (e) { /* a broken section must not break the panel */ } });
    parts.push({ order: S.pages.length ? 0 : 5, node: readSection() });
    parts.sort(function (a, b) { return a.order - b.order; }).forEach(function (p) { pane.appendChild(p.node); });
    if (PS.E && PS.E.panelBody) PS.E.panelBody.scrollTop = keep;
  }

  PS.panels.scan = {
    title: 'Scan & read text', icon: 'search', tone: 'sapphire', snap: 'half', noDoc: true,
    build: function (pane) { ST.pane = pane; pane.classList.add('por-pane'); render(); },
    show: function () { render(); check(); refreshOffer(); },
    hide: function () { setTimeout(refreshOffer, 0); }
  };

  function addEntryPoints() {
    var rail = d.getElementById('ps-rail');
    if (rail && !rail.querySelector('[data-panel="scan"]')) {
      var b = h('button', null, ic('scan') + '<span>Scan</span>', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-panel': 'scan', title: 'Scan and read text', 'aria-label': 'Scan and read text' });
      var exp = rail.querySelector('[data-panel="export"]');
      rail.insertBefore(b, exp || null);
    }
    var stack = d.getElementById('pv-stack');
    if (stack && global.MutationObserver) new MutationObserver(scheduleCheck).observe(stack, { childList: true });
    if (global.MutationObserver) new MutationObserver(scheduleCheck).observe(d.body, { attributes: true, attributeFilter: ['class', 'data-panel'] });
    scheduleCheck();
  }

  /* ---------- "Find sensitive data" (D2, le-pdf-security.js): read scanned pages first when the person asks ---------- */

  function hookSecurity() {
    var SEC = PS.security, API = LE.pdfSecurity;
    if (!SEC || !API || SEC.findWith) return;
    /* Called by the find view instead of API.findSensitive(bytes, opts). */
    SEC.findWith = async function (bytes, opts) {
      if (!ST.readScansForFind) return API.findSensitive(bytes, opts);
      ST.readScansForFind = false;
      var st = await OCR.status(bytes);
      var pages = st.scans.map(function (p) { return p + 1; });
      if (!pages.length) return API.findSensitive(bytes, opts);
      var read;
      try { read = (await readJobs([{ bytes: bytes, pages: pages }], { label: 'Reading the text in scanned pages', skipTextPages: false }))[0]; }
      catch (e) {
        if (isAbort(e)) { say('Stopped. Scanned pages were not searched.'); return API.findSensitive(bytes, opts); }
        throw e;
      }
      var out = await API.findSensitive(read, opts);
      read = null;
      (out.matches || []).forEach(function (m) {
        if (pages.indexOf(m.page + 1) < 0) return;
        m.fromScan = true; m.possible = true;          /* read from a picture: unticked, the person confirms each one */
        m.label = m.label + ' · read from a scan, please check';
      });
      out.readScans = pages.length;
      return out;
    };
    /* Called with the find result; returns an element to show under the "this page is a picture" notes, or null. */
    SEC.scanHint = function (res) {
      var pics = (res && res.pages || []).filter(function (p) { return p.status === 'picture'; }).map(function (p) { return p.page + 1; });
      if (!pics.length) return null;
      var w = h('div', 'por-findhint');
      w.appendChild(h('p', null, ic('scan') + '<span>' + esc((pics.length === 1 ? 'Page ' + pics[0] + ' is a scan.' : 'Pages ' + list(pics) + ' are scans.') + ' Read the text in them first, so they are searched too. Matches found there are left unticked for you to check.') + '</span>'));
      w.appendChild(button('btn btn-sm por-findhint-go', ic('search') + '<span>Read the scans and search again</span>', function () {
        ST.readScansForFind = true;
        var again = d.querySelector('.sec-findbox [data-sec-search]');
        if (again) again.click(); else ST.readScansForFind = false;
      }, { 'data-por': 'find-scans' }));
      return w;
    };
  }

  PS.ocr = {
    run: run, status: summary, check: check, copyText: copyText, saveText: saveText, allText: allText, readJobs: readJobs,
    state: ST, render: render, addSection: function (sec) { ST.sections.push(sec); render(); }
  };

  function boot() { addEntryPoints(); hookSecurity(); }
  /* Protect may load after this file (docs/LOADING.md): hook it when it arrives. */
  global.addEventListener('le-load', function (e) { if (e.detail && e.detail.id === 'security' && e.detail.state === 'loaded') hookSecurity(); });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  else setTimeout(boot, 0);
})(window);
