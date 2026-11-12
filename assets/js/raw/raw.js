/* LE.raw: open RAW photographs. One call, two decoders.
 *
 *   LE.raw.probe(file)   -> { format, supported, decoder: 'builtin'|'camera'|'none', needsDownload, why, preview, meta }
 *   LE.raw.decode(file, { halfSize, signal, onProgress, space, format, wb, quality, method, decoder })
 *                        -> { width, height, data, space, format, meta }
 *
 * 'builtin'  our own DNG reader (assets/js/raw/raw-core.js, runs in a Worker, no download): phone RAW and camera DNG.
 * 'camera'   the optional Camera RAW support module (assets/vendor/raw-decoder/, LibRaw under the LGPL-2.1): CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW and
 *            the rest. Downloaded once, only when such a file is opened, kept in Cache Storage 'le-models-v1', run in its own Worker.
 *
 * decode() output: `data` is interleaved RGB. space 'camera' means camera-native linear light, black subtracted, sensor white = 1.0, no white balance applied
 * (what the develop renderer wants); `meta.matrix` is the 3x3 that takes it to linear `meta.matrixSpace` with the white balance in `meta.wbGains`/`meta.temp`/`meta.tint` included.
 * Pass { space: 'srgb' | 'display-p3' } (f32 only) to get it converted with the as-shot white balance for simple viewing.
 * decoder: 'camera' forces the optional module even for a DNG (for comparisons); quality is its demosaic method: 0 linear, 1 VNG, 2 PPG, 3 AHD (default), 4 DCB, 11 DHT, 12 AAHD.
 * format: 'f32' (default), 'f16' (Uint16Array of half-float bits, for RGBA16F textures) or 'u16' (value * 16384).
 *
 * Loaded lazily: nothing here is precached and nothing runs until a RAW file is opened.
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  var scriptBase = (function () { try { var s = document.currentScript; if (s && s.src) return s.src.replace(/[^/]*$/, ''); } catch (e) { } return null; })();
  var BASE = scriptBase || (global.LE_RAW_BASE || '/assets/js/raw/');
  var DECODER_DIR = (global.LE_RAW_DECODER_BASE || BASE.replace(/js\/raw\/$/, 'vendor/raw-decoder/'));
  var CACHE = 'le-models-v1', MODEL_ID = 'raw-camera', DL_ID = 'raw.camera';
  var MODULE = {
    name: 'LibRaw', version: '0.22.2', licence: 'LGPL-2.1', licenceName: 'GNU Lesser General Public License 2.1',
    licenceUrl: 'licenses/#libraw', licenceText: 'assets/vendor/licenses/libraw-LICENSE.LGPL.txt', sourceUrl: 'https://github.com/LibRaw/LibRaw/tree/0.22.2', projectUrl: 'https://www.libraw.org/', buildUrl: 'licenses/#libraw-source'
  };
  var NOTE_KEY = 'le-raw-camera-licence-seen';

  /* ---------------------------------------------------------------- support declarations */
  var defs = global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || [];
  [
    { id: 'raw.dng', name: 'Open phone and DNG RAW photos', group: 'Photo studio', needs: ['worker'], wants: [], memoryMB: 450, note: 'Built-in reader. About 450 MB for a 24-megapixel file at full size; the half-size preview needs a quarter of that.', degraded: 'Opens a half-size version instead.' },
    { id: 'raw.develop', name: 'Develop RAW photos (exposure, white balance, highlights, tone)', group: 'Photo studio', needs: ['webgl2', 'worker'], wants: ['canvas-max-area'], memoryMB: 900, note: 'Needs WebGL 2. Large files are worked on at reduced size and refined at export.' },
    { id: 'raw.camera', name: 'Camera RAW support (Canon, Nikon, Sony, Fujifilm and more)', group: 'Photo studio', needs: ['wasm', 'worker'], wants: ['cache-storage'], memoryMB: 700, downloadMB: 0.8, note: 'Optional download (LibRaw, LGPL-2.1). About 700 MB for a 24-megapixel photo at full size; half size needs about a third of that.', degraded: 'Opens the half-size version instead.' },
    { id: 'hdr.merge', name: 'Merge bracketed photos to HDR', group: 'Photo studio', needs: ['worker'], wants: ['canvas-max-area'], memoryMB: 1500, note: 'Merging bracketed photos works at up to about 8 megapixels (3 on phones); at full size five 24-megapixel photos would need several gigabytes.', degraded: 'Merges at a smaller size.' }
  ].forEach(function (d) { if (!defs.some(function (x) { return x.id === d.id; })) defs.push(d); });
  if (LE.support && LE.support.define) defs.forEach(function (d) { try { LE.support.define(d); } catch (e) { } });

  /* ---------------------------------------------------------------- small helpers */
  function abortError() { var e = new Error('Cancelled'); e.name = 'AbortError'; return e; }
  function readFile(file) { return file.arrayBuffer ? file.arrayBuffer() : Promise.resolve(file); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  var coreP = null;
  function core() { // the pure colour maths, in the page, loaded on first use
    if (global.LERawCore) return Promise.resolve(global.LERawCore);
    return coreP || (coreP = loadScript(BASE + 'raw-core.js').then(function () { return global.LERawCore; }));
  }
  function Call(worker) { // request/response over postMessage with progress and abort
    var seq = 0, pending = {};
    worker.onmessage = function (ev) { var m = ev.data, p = pending[m.id]; if (!p) return; if (m.progress != null && m.ok == null) { if (p.onProgress) p.onProgress(m.progress); return; } delete pending[m.id]; if (m.ok) p.res(m); else { var e = new Error(m.why || m.error || 'Failed'); e.code = m.error; e.why = m.why; p.rej(e); } };
    worker.onerror = function (ev) { Object.keys(pending).forEach(function (k) { pending[k].rej(new Error(ev.message || 'Worker error')); delete pending[k]; }); };
    return function (msg, transfer, o) {
      o = o || {}; var id = ++seq; msg.id = id;
      return new Promise(function (res, rej) {
        if (o.signal && o.signal.aborted) return rej(abortError());
        pending[id] = { res: res, rej: rej, onProgress: o.onProgress };
        if (o.signal) o.signal.addEventListener('abort', function () { if (pending[id]) { delete pending[id]; worker.postMessage({ cmd: 'abort', id: id }); rej(abortError()); } });
        worker.postMessage(msg, transfer || []);
      });
    };
  }

  /* ---------------------------------------------------------------- the built-in worker */
  var builtin = null;
  function builtinWorker() { if (!builtin) { var w = new Worker(BASE + 'raw-worker.js'); builtin = { worker: w, call: Call(w) }; } return builtin; }

  /* ---------------------------------------------------------------- the optional camera module */
  var camera = null, cameraLoading = null;
  function cameraCached() {
    if (!global.caches) return Promise.resolve(false);
    return caches.open(CACHE).then(function (c) { return c.match(new Request(DECODER_DIR + 'raw-decoder.wasm')); }).then(function (r) { return !!r; }).catch(function () { return false; });
  }
  function fetchWasm(onProgress) {
    var url = DECODER_DIR + 'raw-decoder.wasm';
    return (global.caches ? caches.open(CACHE) : Promise.reject()).then(function (c) { return c.match(new Request(url)).then(function (hit) { return { c: c, hit: hit }; }); }).catch(function () { return { c: null, hit: null }; }).then(function (st) {
      if (st.hit) return st.hit.arrayBuffer().then(function (b) { return { buf: b, fromCache: true }; });
      var tracker = LE.downloads && LE.downloads.track ? LE.downloads.track(DL_ID, { name: 'Camera RAW support', bytes: 7.3e5 }) : null;
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('Could not download the Camera RAW module (' + r.status + ')');
        var total = +r.headers.get('content-length') || 0, reader = r.body && r.body.getReader ? r.body.getReader() : null, chunks = [], loaded = 0;
        if (!reader) return r.arrayBuffer();
        return (function pump() { return reader.read().then(function (x) { if (x.done) { var all = new Uint8Array(loaded), o = 0; chunks.forEach(function (ch) { all.set(ch, o); o += ch.length; }); return all.buffer; } chunks.push(x.value); loaded += x.value.length; if (tracker) tracker.progress(loaded); if (onProgress) onProgress(total ? loaded / total : 0); return pump(); }); })();
      }).then(function (buf) {
        if (tracker) tracker.done();
        if (st.c) { try { return st.c.put(new Request(url), new Response(buf.slice(0), { headers: { 'content-type': 'application/wasm', 'content-length': String(buf.byteLength), 'x-le-model': MODEL_ID } })).then(function () { return { buf: buf, fromCache: false }; }, function () { return { buf: buf, fromCache: false }; }); } catch (e) { }
        }
        return { buf: buf, fromCache: false };
      }, function (e) { if (tracker) tracker.fail(e); throw e; });
    });
  }
  function describeInStorageManager(bytes) {
    if (global.LEPwa && typeof global.LEPwa.describeModel === 'function') global.LEPwa.describeModel(MODEL_ID, { name: 'Camera RAW support', about: 'Opens Canon, Nikon, Sony, Fujifilm and other camera RAW files. ' + MODULE.name + ' ' + MODULE.version + ', ' + MODULE.licence + ' licence' });
  }
  /* One calm line, once per device: what it is, which licence, links to the licence text and the source. Not blocking. */
  function licenceNotice() {
    var seen = false; try { seen = !!localStorage.getItem(NOTE_KEY); } catch (e) { }
    var detail = { text: 'Camera RAW support uses ' + MODULE.name + ', under the ' + MODULE.licence.replace('LGPL-2.1', 'LGPL 2.1') + ' licence.', links: [{ label: 'licence', href: MODULE.licenceUrl }, { label: 'source', href: MODULE.sourceUrl }], module: MODULE, firstTime: !seen };
    try { localStorage.setItem(NOTE_KEY, '1'); } catch (e) { }
    if (seen) return detail;
    var handled = false;
    try { handled = !global.dispatchEvent(new CustomEvent('le-raw:licence', { detail: detail, cancelable: true })); } catch (e) { }
    if (!handled && global.document) { // fallback: a small status line the person can dismiss, no dialog
      var el = document.createElement('div'); el.setAttribute('role', 'status'); el.className = 'le-raw-licence';
      el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:92vw;padding:10px 14px;border-radius:10px;background:var(--card,#fff);color:var(--ink,#17131f);border:1px solid var(--line,#ddd);font:14px/1.4 system-ui,sans-serif;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.15)';
      el.appendChild(document.createTextNode(detail.text + ' ')); detail.links.forEach(function (l, i) { var a = document.createElement('a'); a.href = global.LE_RAW_SITE_ROOT ? global.LE_RAW_SITE_ROOT + l.href : (BASE.replace(/assets\/js\/raw\/$/, '') + l.href); a.textContent = l.label.charAt(0).toUpperCase() + l.label.slice(1); a.target = '_blank'; a.rel = 'noopener'; a.style.marginRight = '10px'; el.appendChild(a); });
      document.body.appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 12000);
    }
    return detail;
  }
  function loadCamera(o) {
    o = o || {};
    if (camera) return Promise.resolve(camera);
    if (cameraLoading) return cameraLoading;
    var ask = LE.downloads && LE.downloads.request ? cameraCached().then(function (c) { return c ? { ok: true } : LE.downloads.request({ id: DL_ID, name: 'Camera RAW support', bytes: 7.3e5, kind: 'feature', reason: 'Opens Canon, Nikon, Sony, Fujifilm and other camera RAW files.' }); }) : Promise.resolve({ ok: true });
    cameraLoading = ask.then(function (a) {
      if (a && a.ok === false) { var e = new Error('Camera RAW support was not downloaded.'); e.code = 'declined'; e.why = a.why; throw e; }
      return fetchWasm(o.onProgress);
    }).then(function (w) {
      var worker = new Worker(DECODER_DIR + 'raw-decoder-worker.js'), call = Call(worker);
      return new Promise(function (res, rej) {
        var done = false; worker.onmessage = function (ev) { var m = ev.data; if (done || m.id) return; done = true; if (m.ok) { worker.onmessage = null; camera = { worker: worker, call: Call(worker), info: m.module, version: m.version, fromCache: w.fromCache, bytes: w.buf.byteLength }; describeInStorageManager(w.buf.byteLength); res(camera); } else rej(new Error(m.error || 'The Camera RAW module did not start')); };
        worker.onerror = function (ev) { if (!done) { done = true; rej(new Error('The Camera RAW module could not start: ' + (ev.message || ''))); } };
        worker.postMessage({ cmd: 'init', wasm: w.buf }, [w.buf]);
      });
    }).then(function (c) { cameraLoading = null; licenceNotice(); return c; }, function (e) { cameraLoading = null; throw e; });
    return cameraLoading;
  }

  /* ---------------------------------------------------------------- probe */
  function probe(file) {
    return readFile(file).then(function (buf) {
      var w = builtinWorker();
      return w.call({ cmd: 'probe', buf: buf, name: file.name || '' }, [buf]);
    }).then(function (m) {
      var r = m.result, prev = null;
      if (r.previewBytes && r.preview) { var blob = new Blob([r.previewBytes], { type: 'image/jpeg' }); prev = { blob: blob, url: URL.createObjectURL(blob), width: r.preview.w, height: r.preview.h, orientation: r.orientation || 1, mime: 'image/jpeg' }; }
      delete r.previewBytes;
      return cameraCached().then(function (cached) {
        var out = { format: r.format, supported: r.decoder !== 'none', decoder: r.decoder, needsDownload: r.decoder === 'camera' && !cached, why: r.why, preview: prev, meta: r.meta || {}, container: r.container, orientation: r.orientation || 1 };
        if (r.decoder === 'camera') out.module = { name: MODULE.name, version: MODULE.version, licence: MODULE.licence, licenceUrl: MODULE.licenceUrl, sourceUrl: MODULE.sourceUrl };
        return out;
      });
    });
  }

  /* ---------------------------------------------------------------- decode */
  function finishMeta(res, wbSpec) { // add the colour matrix for the renderer, using the same code for both decoders
    return core().then(function (C) {
      var meta = res.meta; if (res.decoderKind === 'camera') { meta.camera = true; }
      var src = meta.color || meta;
      var cm = C.cameraToSpace(src, wbSpec || 'as-shot', 'srgb');
      meta.matrix = cm.matrix; meta.wbGains = cm.gains; meta.neutral = cm.neutral; meta.temp = cm.temp; meta.tint = cm.tint; meta.matrixSpace = 'srgb'; meta.colorFallback = cm.fallback;
      return res;
    });
  }
  function decode(file, o) {
    o = o || {};
    return probe(file).then(function (pr) {
      if (!pr.supported) { var e = new Error(pr.why || 'This file cannot be opened.'); e.code = 'unsupported'; throw e; }
      if (o.signal && o.signal.aborted) throw abortError();
      return readFile(file).then(function (buf) {
        var common = { signal: o.signal, onProgress: o.onProgress };
        if (pr.decoder === 'builtin' && o.decoder !== 'camera') {
          var w = builtinWorker();
          return w.call({ cmd: 'decode', buf: buf, name: file.name || '', opts: { half: !!o.halfSize, method: o.method, format: o.format, space: o.space, wb: o.wb, crop: o.crop } }, [buf], common).then(function (m) { var r = m.result; r.meta.decoder = 'builtin'; r.meta.format = pr.format; return r; });
        }
        return loadCamera({ onProgress: o.onDownloadProgress }).then(function (cam) {
          return cam.call({ cmd: 'decode', buf: buf, opts: { half: !!o.halfSize, quality: o.quality, format: o.format || 'f32' } }, [buf], common).then(function (m) {
            var r = m.result; r.meta.decoder = 'camera'; r.meta.format = pr.format; r.meta.module = { name: cam.info.name, version: cam.info.version, licence: cam.info.licence };
            return r;
          });
        });
      });
    }).then(function (r) {
      if (r.meta.matrix) return r; // the built-in worker already added it
      return finishMeta(r, o.wb).then(function (rr) { return convertSpace(rr, o); });
    }).then(function (r) { return r; });
  }
  function convertSpace(r, o) { // camera decode + requested working space (f32 only)
    if (!o.space || o.space === 'camera' || r.format !== 'f32') return r;
    return core().then(function (C) { var cm = C.cameraToSpace(r.meta.color || r.meta, o.wb || 'as-shot', o.space); C.applyMatrix(r.data, cm.matrix); r.space = o.space; r.meta.matrix = cm.matrix; r.meta.matrixSpace = o.space; return r; });
  }

  /* camera RGB -> linear working space for a chosen white balance: { temp, tint } | { neutral } | 'as-shot'. Pure maths, synchronous once core() has loaded. */
  function matrixFor(meta, wb, space) { var C = global.LERawCore; if (!C) throw new Error('Call LE.raw.ready() first'); return C.cameraToSpace(meta.color || meta, wb || 'as-shot', space || 'srgb'); }

  LE.raw = {
    probe: probe, decode: decode, matrix: matrixFor, ready: core,
    module: MODULE,
    camera: { id: DL_ID, isCached: cameraCached, load: loadCamera, info: function () { return MODULE; }, licenceNotice: licenceNotice, unload: function () { if (camera) { camera.worker.terminate(); camera = null; } },
      remove: function () { this.unload(); return global.caches ? caches.open(CACHE).then(function (c) { return c.delete(new Request(DECODER_DIR + 'raw-decoder.wasm')); }) : Promise.resolve(false); } },
    release: function () { if (builtin) { builtin.worker.terminate(); builtin = null; } if (camera) { camera.worker.terminate(); camera = null; } },
    base: BASE, decoderBase: DECODER_DIR
  };
  describeInStorageManager();
})(typeof self !== 'undefined' ? self : this);
