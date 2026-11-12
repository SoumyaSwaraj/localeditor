/* LocalEditor on-device text recognition (OCR).  window.LE.ocr
 *
 *   LE.ocr.languages()                          -> [{ id, label, script, rtl, bytes, bundled, cached, url, licence }]
 *   LE.ocr.load(lang, onProgress)               -> Promise<{ lang, fromCache, ms }>    lang: 'eng' | 'eng+hin' | ['eng','hin']
 *   LE.ocr.recognize(canvasOrImage, { lang, signal, prep, psm, dpi, timeoutMs, minConfidence })
 *                                               -> Promise<{ text, words:[{ text, bbox:{x0,y0,x1,y1}, confidence, line }], lines, confidence, width, height, ms }>
 *   LE.ocr.makeSearchable(pdfBytes, { lang, pages, onProgress, signal, dpi, skipTextPages })
 *                                               -> Promise<Uint8Array>   (original pages untouched, invisible text layer added)
 *   LE.ocr.cachedLanguages() / clearCache()     -> Cache Storage 'le-models-v1' (the storage manager lists these under "AI models")
 *   LE.ocr.unload()                             -> terminates the worker and frees ~100-200 MB
 *
 * Engine: Tesseract 5 (LSTM only) compiled to WebAssembly (tesseract.js-core 7.0.0, Apache-2.0), driven through the
 * message protocol of the tesseract.js 7.0.0 worker script (Apache-2.0). Nothing is fetched until load() is called.
 * Language data (tessdata_fast, Apache-2.0) is cached in Cache Storage 'le-models-v1'.
 * Needs: WebAssembly (+SIMD preferred), Web Worker, canvas. For makeSearchable also pdf.js (window.pdfjsLib) and pdf-lib (window.PDFLib).
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};

  var CACHE = 'le-models-v1';
  var scriptUrl = (document.currentScript && document.currentScript.src) || location.href;
  var cfg = { root: new URL('../../', scriptUrl).href, maxSide: 3600, maxPixels: 9000000, params: { preserve_interword_spaces: '1' }, sendDpi: true };

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
  async function langBytes(l, onProgress) {
    var url = abs(l.path), cache = null, req = new Request(url);
    if (global.caches) { try { cache = await caches.open(CACHE); } catch (e) { cache = null; } }
    if (cache) {
      var hit = await cache.match(req);
      if (hit) { var b = await hit.arrayBuffer(); if (onProgress) onProgress({ stage: 'language', lang: l.id, loaded: b.byteLength, total: b.byteLength, fraction: 1, cached: true }); return { buf: new Uint8Array(b), cached: true }; }
    }
    var res = await fetch(url);
    if (!res.ok) throw new Error('Language data not available (' + res.status + '): ' + l.path);
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
      try { await cache.put(req, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded), 'x-le-model': 'ocr-' + l.id } })); } catch (e) { /* quota: run anyway */ }
    }
    return { buf: out, cached: false };
  }

  /* Warm the HTTP cache with progress so importScripts() in the worker is instant and the download bar is honest. */
  async function warmEngine(url, bytes, onProgress) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('OCR engine not available (' + res.status + ')');
    var total = +res.headers.get('content-length') || bytes, loaded = 0;
    if (res.body && res.body.getReader) {
      var rd = res.body.getReader();
      for (;;) { var r = await rd.read(); if (r.done) break; loaded += r.value.length; if (onProgress) onProgress({ stage: 'engine', loaded: loaded, total: total, fraction: Math.min(1, loaded / total) }); }
    } else { await res.arrayBuffer(); }
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
      var msg = (e && e.message) || 'OCR worker failed to start';
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

  /* ---------- load ---------- */
  function load(lang, onProgress) {
    var ids = langList(lang), key = ids.join('+');
    if (eng && loadedKey === key) return Promise.resolve({ lang: key, fromCache: true, ms: 0 });
    if (loading && loading.key === key) return loading.p;
    var p = (async function () {
      var t0 = performance.now();
      unload();
      var infos = ids.map(function (id) { var l = langInfo(id); if (!l) throw new Error('Unknown OCR language: ' + id); return l; });
      var simd = hasSimd(), core = simd ? ENGINE.simd : ENGINE.plain;
      await warmEngine(abs(core), simd ? ENGINE.simdBytes : ENGINE.plainBytes, onProgress);
      var datas = [], allCached = true;
      for (var i = 0; i < infos.length; i++) {
        var got = await langBytes(infos[i], onProgress);
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
    if (!eng || loadedKey !== key) await load(key, opts.onProgress);
    checkSignal(opts.signal);
    var t0 = performance.now(), srcW = src.naturalWidth || src.videoWidth || src.width, srcH = src.naturalHeight || src.videoHeight || src.height;
    var c = toCanvas(src, opts.maxSide || cfg.maxSide), scale = c.width / srcW, pstats = null;
    if (opts.prep !== 'none') pstats = prepCanvas(c, opts.prep === 'flatten' ? 'flatten' : 'auto');
    var png = await canvasPng(c), tPrep = performance.now() - t0;
    checkSignal(opts.signal);
    var myEng = eng, timer = null, onAbort = null, tR = performance.now();
    var done = new Promise(function (resolve, reject) {
      if (opts.signal) { onAbort = function () { reject(abortErr('Stopped')); }; opts.signal.addEventListener('abort', onAbort); }
      timer = setTimeout(function () { reject(new Error('Recognition took longer than ' + Math.round((opts.timeoutMs || 90000) / 1000) + ' s')); }, opts.timeoutMs || 90000);
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

  async function makeSearchable(pdfBytes, opts) {
    opts = opts || {};
    var L = global.PDFLib, pj = global.pdfjsLib;
    if (!L || !pj) throw new Error('makeSearchable needs pdf-lib and pdf.js on the page');
    if (pj.GlobalWorkerOptions && !pj.GlobalWorkerOptions.workerSrc) pj.GlobalWorkerOptions.workerSrc = abs('assets/vendor/pdf.worker.min.js');
    var signal = opts.signal, dpi = opts.dpi || 200, progress = opts.onProgress || function () {};
    var key = langList(opts.lang || 'eng').join('+');
    await load(key, function (p) { progress({ stage: p.stage, fraction: p.fraction, page: 0 }); });
    var bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    var task = pj.getDocument({ data: bytes.slice(), isEvalSupported: false });
    var pdf = await task.promise;
    try {
      var doc = await L.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
      var fontRef = addGlyphlessFont(doc), FNAME = 'GlyphLessFont';
      var wanted = opts.pages && opts.pages.length ? opts.pages.slice() : Array.apply(null, { length: pdf.numPages }).map(function (_, i) { return i + 1; });
      var report = { pages: [], words: 0, skipped: 0 }, done = 0;
      for (var wi = 0; wi < wanted.length; wi++) {
        checkSignal(signal);
        var pn = wanted[wi], pg = await pdf.getPage(pn), page = doc.getPage(pn - 1);
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
        await pg.render({ canvasContext: cx, viewport: vp }).promise;
        checkSignal(signal);
        var res = await recognize(cv, { lang: key, signal: signal, dpi: Math.round(scale * 72), minConfidence: opts.minConfidence == null ? 25 : opts.minConfidence, timeoutMs: opts.timeoutMs });
        var nw = 0;
        /* lines whose words were filtered keep only the surviving words */
        var keep = new Set(res.words);
        var res2 = { lines: res.lines.map(function (ln) { return Object.assign({}, ln, { words: ln.words.filter(function (w) { return keep.has(w); }) }); }).filter(function (ln) { return ln.words.length; }) };
        page.node.setFontDictionary(L.PDFName.of(FNAME), fontRef);
        nw = drawWords(L, page, FNAME, res2, function (x, y) { return vp.convertToPdfPoint(x, y); }, 1 / scale);
        report.pages.push({ page: pn, words: nw, confidence: Math.round(res.confidence), ms: res.ms, canvas: cv.width + 'x' + cv.height }); report.words += nw;
        pg.cleanup(); cv.width = cv.height = 1; done++;
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
    if (!global.caches) return 0;
    var cache = await caches.open(CACHE), n = 0;
    for (var i = 0; i < LANGS.length; i++) if (!id || LANGS[i].id === id) { if (await cache.delete(new Request(abs(LANGS[i].path)))) n++; }
    return n;
  }

  LE.ocr = {
    config: function (o) { if (o && o.root) cfg.root = new URL(o.root, location.href).href; if (o && o.maxSide) cfg.maxSide = o.maxSide; if (o && o.params) cfg.params = o.params; if (o && o.sendDpi != null) cfg.sendDpi = o.sendDpi; return cfg; },
    languages: function () { return LANGS.map(function (l) { return Object.assign({}, l, { url: abs(l.path) }); }); },
    languagesWithCache: async function () { var ids = await cachedIds(); return LANGS.map(function (l) { return Object.assign({}, l, { url: abs(l.path), cached: !!ids[l.id] }); }); },
    isAvailable: async function (id) { var l = langInfo(id); if (!l) return false; try { var r = await fetch(abs(l.path), { method: 'HEAD' }); return r.ok; } catch (e) { return false; } },
    isLoaded: function () { return eng ? loadedKey : null; },
    hasSimd: hasSimd,
    load: load, recognize: recognize, makeSearchable: makeSearchable, unload: unload,
    cachedLanguages: cachedLanguages, clearCache: clearCache,
    _prep: prepCanvas, _toCanvas: toCanvas
  };
})(window);
