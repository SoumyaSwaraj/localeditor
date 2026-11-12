/* LocalEditor RAW and HDR layers (Expert step X5). Our own code. Loaded on demand (never precached): by the studio's RAW hook when a
 * camera RAW file is opened, or by the effect pack (assets/js/fx/le-fx-develop.js) when a document has a RAW or HDR layer.
 *
 * What it adds to LE.raw (assets/js/raw/raw.js keeps probe/decode/matrix/camera):
 *   LE.raw.open(file, { onPreview, onProgress, signal, quality })      -> Promise<{ layer, assets: { src, raw }, info }>
 *   LE.raw.formats()                                                   -> [{ ext, format, decoder: 'builtin'|'camera' }]
 *   LE.raw.defaults(info)                                              -> develop entries (fx) for a newly opened RAW, tuned by ISO
 *   LE.raw.settings.copy(layer) / .paste(layer, settings, opts)        -> plain-data develop settings / { fx } patch
 *   LE.raw.presets.list() / .get(id) / .save(name, settings) / .remove(id)
 *   LE.raw.autoTone(layer)                                             -> Promise<develop.basic params>
 *   LE.raw.wrap(bytes, info, previewCanvas) / .unwrap(blob)            the original RAW bytes inside a PNG (see "Storage")
 *   LE.raw.work.clear() / .usage()                                     the working-copy cache
 *   LE.hdr.mergeFiles(files, { mode, align, deghost, reference, signal, onProgress, maxPixels }) -> Promise<{ layer, assets, info }>
 *   LE.hdr.encode(float, meta) / .decode(blob)                         the scene-referred HDR asset (16-bit log PNG)
 *
 * Storage (why it is done this way):
 *   - The ORIGINAL RAW FILE is a document asset like a photo: a PNG whose picture is a small preview and whose private ancillary
 *     chunk "leRw" holds the RAW bytes unchanged (PNG decoders skip unknown ancillary chunks, by the PNG specification). So it gets a
 *     content hash, lives in the designs database, travels in .leproject files and passes every existing image check, with no change
 *     to the project format. Limit: the project asset cap (80 MB); a larger RAW opens and edits from its working copy, but its original
 *     is not kept in the design (said in the result's info.warnings).
 *   - The WORKING COPY (decoded once, scene-linear, upright, capped at 4096 / 3072 / 2048 px on the long side by device class) is kept
 *     in memory while used and in Cache Storage "le-models-v1" as half floats (x-le-model: raw-work), which the storage manager lists
 *     as "RAW working copies" with its size and a delete action. It is derived data: when it is gone it is made again from the original.
 *   - Export decodes the original again at full resolution (desktop and modern devices up to 48 and 24 MP; older devices use the
 *     working copy) and the renderer tiles it.
 *   - An HDR merge is stored as one PNG asset with 16-bit channels holding log2 radiance (code = (log2 x + 20) / 36 * 65535, step
 *     0.00055 EV over 36 stops; code 0 is zero) and a tEXt chunk describing the encoding. It is an ordinary image file to every tool
 *     (it decodes, hashes and round-trips), compact (deflate, Sub filter), and exact enough to re-develop.
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};
  if (LE.rawLayer) return;
  var BASE = (function () { try { var s = document.currentScript; if (s && s.src) return s.src.replace(/[^/]*$/, ''); } catch (e) { } return global.LE_RAW_BASE || '/assets/js/raw/'; })();
  var CACHE = 'le-models-v1', WORK_MODEL = 'raw-work', WORK_VERSION = 'w1';
  var EXT = { dng: 'DNG', cr2: 'CR2', cr3: 'CR3', crw: 'CRW', nef: 'NEF', nrw: 'NEF', arw: 'ARW', sr2: 'ARW', srf: 'ARW', raf: 'RAF', orf: 'ORF', rw2: 'RW2', rwl: 'RW2', pef: 'PEF', srw: 'SRW', mrw: 'MRW', raw: 'RAW', iiq: 'IIQ', '3fr': '3FR', x3f: 'X3F', erf: 'ERF', kdc: 'KDC', dcr: 'DCR', mef: 'MEF', arq: 'ARW' };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function abortError() { var e = new Error('Cancelled'); e.name = 'AbortError'; return e; }
  function plain(msg, code) { var e = new Error(msg); e.code = code || 'raw'; e.plain = true; return e; }
  function loadScript(src) { return LE.lazy ? LE.lazy(src) : new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function tier() { return LE.device && LE.device.tier ? LE.device.tier() : 'desktop'; }
  function workCap() { var t = tier(); return t === 'older' ? 2048 : t === 'modern' ? 3072 : 4096; }
  function fullCapMP() { var t = tier(); return t === 'older' ? 0 : t === 'modern' ? 24 : 48; }
  function mergeCapPx() { var t = tier(); return t === 'older' ? 3e6 : t === 'modern' ? 5e6 : 8e6; }
  function M3() { return global.LERawCore.color.MAT; }

  /* ------------------------------------------------------------------ worker for working copies */
  var worker = null, seq = 0, pending = {};
  function work(msg, transfer, o) {
    o = o || {};
    if (!worker) {
      worker = new Worker(BASE + 'raw-work-worker.js');
      worker.onmessage = function (ev) { var m = ev.data, p = pending[m.id]; if (!p) return; if (m.progress != null && m.ok == null) { if (p.onProgress) p.onProgress(m.progress); return; } delete pending[m.id]; if (m.ok) p.res(m.result); else p.rej(new Error(m.error || 'The RAW working copy could not be made.')); };
      worker.onerror = function (ev) { Object.keys(pending).forEach(function (k) { pending[k].rej(new Error(ev.message || 'Worker error')); delete pending[k]; }); worker = null; };
    }
    var id = ++seq; msg.id = id;
    return new Promise(function (res, rej) {
      if (o.signal && o.signal.aborted) return rej(abortError());
      pending[id] = { res: res, rej: rej, onProgress: o.onProgress };
      if (o.signal) o.signal.addEventListener('abort', function () { if (pending[id]) { delete pending[id]; rej(abortError()); } });
      worker.postMessage(msg, transfer || []);
    });
  }

  /* ------------------------------------------------------------------ PNG helpers (RAW wrapper and the HDR container) */
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(parts) { var c = 0xFFFFFFFF; parts.forEach(function (u) { for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); }); return (c ^ 0xFFFFFFFF) >>> 0; }
  function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
  function chunk(type, data) {
    var head = new Uint8Array(8), dv = new DataView(head.buffer), t = ascii(type), tail = new Uint8Array(4);
    dv.setUint32(0, data.length); head.set(t, 4);
    new DataView(tail.buffer).setUint32(0, crc32([t, data]));
    return [head, data, tail];
  }
  function chunks(u8) { // [{ type, start, len }] (data offsets)
    var out = [], o = 8, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 8 || u8[0] !== 0x89 || u8[1] !== 0x50) return null;
    while (o + 12 <= u8.length) { var len = dv.getUint32(o), type = String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]); out.push({ type: type, start: o + 8, len: len }); o += 12 + len; if (type === 'IEND') break; }
    return out;
  }
  function zlib(u8, inflate) {
    var S = inflate ? global.DecompressionStream : global.CompressionStream;
    if (!S) return Promise.reject(new Error('This browser cannot ' + (inflate ? 'read' : 'write') + ' compressed HDR files.'));
    return new Response(new Blob([u8]).stream().pipeThrough(new S('deflate'))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function textOf(u8, c) { var s = ''; for (var i = 0; i < c.len; i++) s += String.fromCharCode(u8[c.start + i]); var z = s.indexOf('\0'); return { key: s.slice(0, z), value: s.slice(z + 1) }; }

  /* The original RAW bytes inside a PNG (private ancillary chunk 'leRw', plus tEXt 'le-raw' with { v, name, format, bytes }). */
  function wrap(bytes, info, preview) {
    var c = preview || (function () { var x = document.createElement('canvas'); x.width = 8; x.height = 8; return x; })();
    return new Promise(function (res) { c.toBlob(res, 'image/png'); }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
      var u8 = new Uint8Array(buf), list = chunks(u8), iend = list[list.length - 1];
      var meta = JSON.stringify({ v: 1, name: String(info.name || 'photo').slice(0, 120), format: info.format || '', bytes: bytes.byteLength });
      var parts = [u8.subarray(0, iend.start - 8)];
      parts = parts.concat(chunk('tEXt', ascii('le-raw\0' + meta)), chunk('leRw', new Uint8Array(bytes)), [u8.subarray(iend.start - 8)]);
      return new Blob(parts, { type: 'image/png' });
    });
  }
  function unwrap(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), list = chunks(u8); if (!list) throw plain('This is not a stored RAW file.');
      var info = null, data = null;
      list.forEach(function (c) { if (c.type === 'tEXt') { var t = textOf(u8, c); if (t.key === 'le-raw') { try { info = JSON.parse(t.value); } catch (e) { } } } if (c.type === 'leRw') data = buf.slice(c.start, c.start + c.len); });
      if (!data) throw plain('The original RAW data is missing from this stored file.');
      return { bytes: data, info: info || {} };
    });
  }

  /* HDR container: 16-bit RGB PNG of log2 radiance. */
  var LOG = { lo: -20, hi: 16 };
  function hdrEncode(img, meta) {
    var w = img.width, h = img.height, d = img.data, row = 1 + w * 6, raw = new Uint8Array(row * h), span = LOG.hi - LOG.lo, x, y, c;
    var prev = new Uint8Array(w * 6), cur = new Uint8Array(w * 6);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) for (c = 0; c < 3; c++) {
        var v = d[(y * w + x) * 3 + c], code = v > Math.pow(2, LOG.lo) ? Math.round(clamp((Math.log2(v) - LOG.lo) / span, 0, 1) * 65534) + 1 : 0;
        cur[x * 6 + c * 2] = code >> 8; cur[x * 6 + c * 2 + 1] = code & 255;
      }
      var o = y * row; raw[o] = 1;   /* filter: Sub */
      for (x = 0; x < w * 6; x++) raw[o + 1 + x] = (cur[x] - (x >= 6 ? cur[x - 6] : 0)) & 255;
    }
    var ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    var desc = JSON.stringify({ v: 1, enc: 'log2', lo: LOG.lo, hi: LOG.hi, space: (meta && meta.space) || 'linear-srgb' });
    return zlib(raw, false).then(function (z) {
      var parts = [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])].concat(chunk('IHDR', ihdr), chunk('tEXt', ascii('le-hdr\0' + desc)), chunk('IDAT', z), chunk('IEND', new Uint8Array(0)));
      return new Blob(parts, { type: 'image/png' });
    });
  }
  function paeth(a, b, c) { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
  function hdrDecode(blob) {
    return (blob.arrayBuffer ? blob.arrayBuffer() : Promise.resolve(blob)).then(function (buf) {
      var u8 = new Uint8Array(buf), list = chunks(u8); if (!list) throw plain('This is not an HDR picture made by LocalEditor.');
      var ih = list.filter(function (c) { return c.type === 'IHDR'; })[0], desc = null, idat = [];
      list.forEach(function (c) { if (c.type === 'tEXt') { var t = textOf(u8, c); if (t.key === 'le-hdr') { try { desc = JSON.parse(t.value); } catch (e) { } } } if (c.type === 'IDAT') idat.push(u8.subarray(c.start, c.start + c.len)); });
      if (!ih || !desc || desc.enc !== 'log2') throw plain('This is not an HDR picture made by LocalEditor.');
      var dv = new DataView(buf, ih.start, 13), w = dv.getUint32(0), h = dv.getUint32(4);
      if (u8[ih.start + 8] !== 16 || u8[ih.start + 9] !== 2 || w * h > 1e8) throw plain('This HDR picture has an unexpected layout.');
      var all = new Uint8Array(idat.reduce(function (s, a) { return s + a.length; }, 0)), off = 0; idat.forEach(function (a) { all.set(a, off); off += a.length; });
      return zlib(all, true).then(function (raw) {
        var row = w * 6, prev = new Uint8Array(row), cur = new Uint8Array(row), out = new Float32Array(w * h * 3), span = desc.hi - desc.lo, x, y;
        for (y = 0; y < h; y++) {
          var o = y * (row + 1), f = raw[o];
          for (x = 0; x < row; x++) {
            var a = x >= 6 ? cur[x - 6] : 0, b = prev[x], c = x >= 6 ? prev[x - 6] : 0, v = raw[o + 1 + x];
            cur[x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
          }
          for (x = 0; x < w * 3; x++) { var code = cur[x * 2] << 8 | cur[x * 2 + 1]; out[y * w * 3 + x] = code ? Math.pow(2, desc.lo + (code - 1) / 65534 * span) : 0; }
          var t = prev; prev = cur; cur = t;
        }
        return { width: w, height: h, data: out, space: desc.space || 'linear-srgb' };
      });
    });
  }

  /* ------------------------------------------------------------------ bytes of a stored original, by asset id */
  var mem = { bytes: {}, hdr: {} };   /* just opened, before (or instead of) the designs database */
  function rawBytes(id) {
    if (mem.bytes[id]) return Promise.resolve(mem.bytes[id]);
    if (!LE.project || !LE.project.getAsset) return Promise.reject(plain('The original RAW file of this photo is not on this device.', 'missing'));
    return LE.project.getAsset(id).then(function (blob) { if (!blob) throw plain('The original RAW file of this photo is not on this device.', 'missing'); return unwrap(blob); }).then(function (u) { return u.bytes; });
  }
  function hdrBlob(id) {
    if (mem.hdr[id]) return Promise.resolve(mem.hdr[id]);
    if (!LE.project || !LE.project.getAsset) return Promise.reject(plain('This HDR picture is not on this device.', 'missing'));
    return LE.project.getAsset(id).then(function (b) { if (!b) throw plain('This HDR picture is not on this device.', 'missing'); return b; });
  }
  function hashBlob(blob) {
    if (LE.project && LE.project.hash) return LE.project.hash(blob);
    return blob.arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(function (d) { return Array.prototype.map.call(new Uint8Array(d), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); });
  }

  /* ------------------------------------------------------------------ working copies */
  var works = {}, workOrder = [];   /* key -> { data, width, height, full, asShot, auto, stats, clipped, bytes } */
  function remember(key, w) {
    works[key] = w; var i = workOrder.indexOf(key); if (i >= 0) workOrder.splice(i, 1); workOrder.push(key);
    var budget = tier() === 'desktop' ? 700e6 : tier() === 'modern' ? 300e6 : 120e6, total = 0;
    for (var j = workOrder.length - 1; j >= 0; j--) { total += works[workOrder[j]].data.byteLength; if (total > budget && j < workOrder.length - 1) { delete works[workOrder[j]]; workOrder.splice(j, 1); } }
    derived = {};
  }
  function workUrl(key) { return new URL(BASE + '__work/' + encodeURIComponent(key).replace(/%/g, '_') + '.bin', location.href).href; }
  function persist(key, w) {
    if (!global.caches || !global.LERawCore) return Promise.resolve(false);
    var n = w.data.length, half = new Uint16Array(n), toHalf = global.LERawCore.toHalf;
    for (var i = 0; i < n; i++) half[i] = toHalf(w.data[i]);
    var head = ascii(JSON.stringify({ v: WORK_VERSION, width: w.width, height: w.height, full: w.full, asShot: w.asShot, auto: w.auto, stats: w.stats, clipped: w.clipped })), lenB = new Uint8Array(4);
    new DataView(lenB.buffer).setUint32(0, head.length);
    var body = new Blob([lenB, head, half.buffer]);
    return caches.open(CACHE).then(function (c) {
      return c.put(new Request(workUrl(key)), new Response(body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.size), 'x-le-model': WORK_MODEL, 'date': new Date().toUTCString() } })).then(function () { return trimCache(c); });
    }).then(function () { return true; }, function () { return false; });
  }
  function trimCache(c) {
    var max = tier() === 'desktop' ? 1.5e9 : tier() === 'modern' ? 600e6 : 250e6;
    return c.keys().then(function (reqs) {
      reqs = reqs.filter(function (r) { return /\/__work\//.test(r.url); });
      return Promise.all(reqs.map(function (r) { return c.match(r).then(function (res) { return { r: r, size: +res.headers.get('content-length') || 0, at: Date.parse(res.headers.get('date') || '') || 0 }; }); }));
    }).then(function (rows) {
      rows.sort(function (a, b) { return b.at - a.at; });
      var total = 0, drop = [];
      rows.forEach(function (x, i) { total += x.size; if (i > 0 && total > max) drop.push(x.r); });
      return Promise.all(drop.map(function (r) { return c.delete(r); }));
    });
  }
  function restore(key) {
    if (!global.caches || !global.LERawCore) return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(new Request(workUrl(key))); }).then(function (res) {
      if (!res) return null;
      return res.arrayBuffer().then(function (buf) {
        var len = new DataView(buf).getUint32(0), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
        if (head.v !== WORK_VERSION) return null;
        var start = 4 + len, half = new Uint16Array(buf.slice(start)), f = new Float32Array(half.length), H = global.LERawCore.halfToFloat, lut = restore.lut || (restore.lut = (function () { var t = new Float32Array(65536); for (var i = 0; i < 65536; i++) t[i] = H(i); return t; })());
        for (var i = 0; i < half.length; i++) f[i] = lut[half[i]];
        head.data = f; return head;
      });
    }).catch(function () { return null; });
  }
  /* Decode a RAW (bytes) and make its working copy. o: { cap (0 = full size), recovery, quality, estimate, matrix, signal, onProgress, name } */
  function decodeToWork(bytes, o) {
    var file = new File([bytes], o.name || 'photo.raw');
    var full = !o.cap, half = false;
    return LE.raw.probe(new File([bytes], o.name || 'photo.raw')).then(function (pr) {
      if (!pr.supported && pr.decoder !== 'camera') throw plain(pr.why || 'This file cannot be opened as a RAW photo.', 'unsupported');
      var mw = pr.meta && pr.meta.width, mh = pr.meta && pr.meta.height;
      if (!full && mw && mh) half = Math.max(mw, mh) >= 2 * o.cap;
      else if (!full && !mw) half = tier() !== 'desktop';
      return LE.raw.decode(file, { halfSize: half, format: 'f16', space: 'camera', quality: o.quality, method: o.method, signal: o.signal, onProgress: o.onProgress ? function (p) { o.onProgress(0.1 + 0.6 * p); } : null }).then(function (d) { return { d: d, pr: pr }; });
    }).then(function (r) {
      var d = r.d, meta = d.meta || {};
      var baseline = meta.baselineExposure != null ? meta.baselineExposure : meta.decoder === 'camera' ? 0.5 : 0;
      return work({ cmd: 'work', data: d.data.buffer, format: d.format, width: d.width, height: d.height, meta: { color: meta.color || meta }, opts: { orientation: meta.orientation || r.pr.orientation || 1, cap: o.cap || 0, recovery: o.recovery || 'reconstruct', matrix: o.matrix !== false, baseline: baseline, estimate: !!o.estimate } }, [d.data.buffer], { signal: o.signal, onProgress: o.onProgress ? function (p) { o.onProgress(0.7 + 0.3 * p); } : null }).then(function (w) {
        w.meta = meta; w.probe = r.pr; w.baseline = baseline; w.half = half;
        if (half && w.full) { w.full = [w.full[0] * 2, w.full[1] * 2]; }
        return w;
      });
    });
  }
  function workKey(asset, recovery, demosaic, cap) { return [WORK_VERSION, asset, recovery || 'reconstruct', demosaic || 'auto', cap].join('|'); }
  var DEMOSAIC = { auto: {}, fast: { method: 'mhc', quality: 2 }, detail: { method: 'ed', quality: 11 }, smooth: { method: 'mhc', quality: 1 } };
  function workingCopy(layer, o) {
    var raw = layer.raw, asset = raw.source.asset, cap = o.cap != null ? o.cap : workCap(), key = workKey(asset, o.recovery, o.demosaic, cap);
    if (works[key]) { remember(key, works[key]); return Promise.resolve(works[key]); }
    if (workingCopy.busy[key]) return workingCopy.busy[key];
    var p = (cap ? restore(key) : Promise.resolve(null)).then(function (hit) {
      if (hit) return hit;
      var dm = DEMOSAIC[o.demosaic] || {};
      return rawBytes(asset).then(function (bytes) {
        return decodeToWork(bytes, { cap: cap, recovery: o.recovery, quality: dm.quality, method: dm.method, name: raw.source.name, estimate: !raw.auto });
      }).then(function (w) { if (cap) persist(key, w); return w; });
    }).then(function (w) { delete workingCopy.busy[key]; if (cap) remember(key, w); return w; }, function (e) { delete workingCopy.busy[key]; throw e; });
    workingCopy.busy[key] = p;
    return p;
  }
  workingCopy.busy = {};
  function hdrWorkingCopy(layer, o) {
    var raw = layer.raw, asset = raw.source.asset, cap = o.cap != null ? o.cap : workCap(), key = [WORK_VERSION, 'hdr', asset, cap].join('|');
    if (works[key]) return Promise.resolve(works[key]);
    if (workingCopy.busy[key]) return workingCopy.busy[key];
    var p = hdrBlob(asset).then(hdrDecode).then(function (img) {
      var camera = img.space === 'camera';
      return work({ cmd: 'work', data: img.data.buffer, format: 'f32', width: img.width, height: img.height, meta: { color: raw.color || {} }, opts: { orientation: 1, cap: cap, recovery: 'off', matrix: camera, baseline: 0, estimate: false } }, [img.data.buffer]);
    }).then(function (w) { delete workingCopy.busy[key]; remember(key, w); return w; }, function (e) { delete workingCopy.busy[key]; throw e; });
    workingCopy.busy[key] = p;
    return p;
  }
  /* A reduced copy of a working copy for a preview size (cached), half again while a control is dragged. */
  var derived = {};
  function reduce(w, maxSide) {
    if (Math.max(w.width, w.height) <= maxSide) return w;
    var k = 'r' + maxSide + '|' + w.width + 'x' + w.height + '|' + (w.stamp || (w.stamp = Math.random().toString(36).slice(2)));
    if (derived[k]) return derived[k];
    var f = maxSide / Math.max(w.width, w.height), tw = Math.max(1, Math.round(w.width * f)), th = Math.max(1, Math.round(w.height * f)), src = w.data, out = new Float32Array(tw * th * 3), x, y, i, j;
    /* box filter over the covered source pixels (integer bounds; good enough for previews; export uses the full data) */
    var sx = w.width / tw, sy = w.height / th;
    for (y = 0; y < th; y++) {
      var y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (x = 0; x < tw; x++) {
        var x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), r = 0, g = 0, b = 0, n = 0;
        for (j = y0; j < y1; j++) for (i = x0; i < x1; i++) { var o = (j * w.width + i) * 3; r += src[o]; g += src[o + 1]; b += src[o + 2]; n++; }
        var q = (y * tw + x) * 3; out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n;
      }
    }
    var keys = Object.keys(derived); if (keys.length > 4) delete derived[keys[0]];
    return (derived[k] = { data: out, width: tw, height: th });
  }

  /* ------------------------------------------------------------------ white balance through the camera matrices */
  var PRESETS_WB = { daylight: [5500, 10], cloudy: [6500, 10], shade: [7500, 10], tungsten: [2850, 0], fluorescent: [3800, 21], flash: [5500, 0] };
  function wbFor(raw) {
    var C = global.LERawCore; if (!C || !raw.color) return null;
    var asFull;
    try { asFull = C.cameraToSpace(raw.color, 'as-shot', 'srgb'); } catch (e) { return null; }
    if (asFull.fallback) return null;
    var inv = M3().inv(asFull.matrix);
    return function (p) {
      var t = p.wb === 'custom' ? [p.temp, p.tint] : p.wb === 'auto' ? (raw.auto ? [raw.auto.temp, raw.auto.tint] : null) : PRESETS_WB[p.wb] || null;
      if (!t) return null;
      var m = M3().mul(C.cameraToSpace(raw.color, { temp: clamp(t[0], 1700, 25000), tint: t[1] }, 'srgb').matrix, inv);
      var wv = M3().vec(m, [1, 1, 1]), y = 0.2126 * wv[0] + 0.7152 * wv[1] + 0.0722 * wv[2];
      return y > 1e-6 ? m.map(function (v) { return v / y; }) : m;
    };
  }
  /* The float-source provider registered with LE.fx.sources (see le-fx-develop.js). */
  function entry(list, type) { for (var i = 0; i < (list || []).length; i++) if (list[i].type === type && list[i].on !== false) return list[i]; return null; }
  function provide(layer, o) {
    var raw = layer.raw, kind = raw.kind || 'raw', basic = entry(o.entries, 'develop.basic'), detail = entry(o.entries, 'develop.detail'), lens = entry(o.entries, 'develop.lens');
    var exportFull = !o.preview && kind === 'raw' && fullCapMP() > 0 && raw.size && raw.size.w * raw.size.h <= fullCapMP() * 1e6 && o.targetMax > workCap() * 1.05;
    var spec = { recovery: basic && basic.p && basic.p.recovery || 'reconstruct', demosaic: detail && detail.p && detail.p.demosaic || 'auto', cap: exportFull ? 0 : workCap() };
    var get = kind === 'hdr' ? hdrWorkingCopy(layer, spec) : workingCopy(layer, spec);
    return get.then(function (w) {
      var side = o.preview ? Math.min(Math.max(w.width, w.height), Math.max(256, o.targetMax || 2400)) : Math.max(w.width, w.height);
      if (o.draft) side = Math.max(256, Math.round(side / 2));
      var s = reduce(w, side), full = raw.size ? [raw.size.w, raw.size.h] : (w.full || [w.width, w.height]);
      var ctx = { asShot: raw.asShot ? [raw.asShot.temp, raw.asShot.tint] : (w.asShot || null), auto: raw.auto ? [raw.auto.temp, raw.auto.tint] : (w.auto || null), wb: wbFor(raw), extent: Math.max(full[0], full[1]), scene: true };
      var needCA = lens && lens.p && lens.p.autoCA;
      var ca = needCA ? caFor(raw.source.asset, w) : Promise.resolve(null);
      return ca.then(function (c) {
        if (c) ctx.ca = c;
        return { source: { data: s.data, width: s.width, height: s.height, channels: 3, space: 'linear' }, box: { w: full[0], h: full[1] }, key: [kind, raw.source.asset, spec.recovery, spec.demosaic, s.width, s.height].join('|'), ctx: ctx };
      });
    });
  }
  var caCache = {};
  function caFor(asset, w) {
    if (caCache[asset]) return caCache[asset];
    var s = reduce(w, 1200), copy = new Float32Array(s.data);
    return (caCache[asset] = work({ cmd: 'ca', data: copy.buffer, width: s.width, height: s.height }, [copy.buffer]).catch(function () { delete caCache[asset]; return null; }));
  }

  /* ------------------------------------------------------------------ defaults, settings, presets, auto tone */
  function round(v, n) { var k = Math.pow(10, n || 0); return Math.round(v * k) / k; }
  function defaults(info) {
    info = info || {};
    var iso = info.iso || 100, l2 = Math.log2(Math.max(50, iso) / 100);
    var basic = { type: 'develop.basic', p: { profile: 'auto', wb: 'as-shot', temp: Math.round(clamp(info.asShot ? info.asShot[0] : 5500, 2000, 50000)), tint: Math.round(clamp(info.asShot ? info.asShot[1] : 0, -150, 150)), recovery: 'reconstruct' } };
    var detail = { type: 'develop.detail', p: { sharpen: iso >= 3200 ? 30 : 40, radius: 1, detail: 25, masking: iso >= 1600 ? 35 : 0, luminance: Math.round(clamp(9 * (l2 - 2), 0, 60)), color: Math.round(clamp(25 + 4 * Math.max(0, l2 - 3), 25, 50)), lumDetail: 50, colorDetail: 50 } };
    return [basic, detail];
  }
  var HIDDEN = { 'develop.basic': ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'], 'develop.lens': ['autoR', 'autoB', 'extent'], 'develop.tonemap': ['extent'] };
  var DEV = ['develop.lens', 'develop.detail', 'develop.tonemap', 'develop.basic'];
  function cleanEntry(e) {
    var o = { type: e.type, on: e.on !== false, amount: e.amount == null ? 1 : e.amount, p: {} };
    Object.keys(e.p || {}).forEach(function (k) { if ((HIDDEN[e.type] || []).indexOf(k) < 0) o.p[k] = JSON.parse(JSON.stringify(e.p[k])); });
    if (e.blend && e.blend !== 'normal') o.blend = e.blend;
    if (e.mask) o.mask = JSON.parse(JSON.stringify(e.mask));
    return o;
  }
  var settings = {
    /* Plain data: { v: 1, kind: 'develop-settings', fx: [develop entries without ids or injected values] }. */
    copy: function (layer) { return { v: 1, kind: 'develop-settings', fx: ((layer && layer.fx) || []).filter(function (e) { return e && DEV.indexOf(e.type) >= 0; }).map(cleanEntry) }; },
    /* Returns the patch { fx } that gives `layer` these settings. opts.whiteBalance (default true) also copies white balance; when
       false the target keeps its own (as shot). opts.only: list of effect types to take. */
    paste: function (layer, s, opts) {
      opts = opts || {};
      var src = s && Array.isArray(s.fx) ? s.fx : [];
      if (opts.only) src = src.filter(function (e) { return opts.only.indexOf(e.type) >= 0; });
      var keep = ((layer && layer.fx) || []).filter(function (e) { return DEV.indexOf(e.type) < 0 || src.every(function (x) { return x.type !== e.type; }); });
      var mine = ((layer && layer.fx) || []).filter(function (e) { return e.type === 'develop.basic'; })[0];
      var add = src.map(function (e, i) {
        var o = cleanEntry(e); o.id = 'dv' + Date.now().toString(36) + i;
        if (o.type === 'develop.basic' && opts.whiteBalance === false) { o.p.wb = mine && mine.p ? mine.p.wb : 'as-shot'; if (mine && mine.p) { o.p.temp = mine.p.temp; o.p.tint = mine.p.tint; } }
        return o;
      });
      var devFirst = add.concat(keep.filter(function (e) { return DEV.indexOf(e.type) >= 0; })).sort(function (a, b) { return DEV.indexOf(a.type) - DEV.indexOf(b.type); });
      return { fx: devFirst.concat(keep.filter(function (e) { return DEV.indexOf(e.type) < 0; })) };
    }
  };
  function P(fx) { return { v: 1, kind: 'develop-settings', fx: fx }; }
  var BUILTIN = [
    { id: 'natural', name: 'Natural', settings: P([{ type: 'develop.basic', p: { profile: 'neutral', vibrance: 10 } }]) },
    { id: 'vivid-landscape', name: 'Vivid landscape', settings: P([{ type: 'develop.basic', p: { profile: 'landscape', highlights: -45, shadows: 20, whites: 12, blacks: -8, vibrance: 22 } }, { type: 'develop.detail', p: { sharpen: 45, radius: 1, detail: 30, masking: 10, color: 25 } }]) },
    { id: 'backlit-portrait', name: 'Backlit portrait', settings: P([{ type: 'develop.basic', p: { profile: 'portrait', exposure: 0.45, highlights: -55, shadows: 50, whites: -10, blacks: -5, vibrance: 10 } }, { type: 'develop.detail', p: { sharpen: 35, radius: 1.1, detail: 20, masking: 60, luminance: 15, color: 25 } }]) },
    { id: 'night-city', name: 'Night city', settings: P([{ type: 'develop.basic', p: { profile: 'standard', wb: 'custom', temp: 4000, tint: 8, highlights: -75, shadows: 25, blacks: -20, contrast: 10, saturation: -5 } }, { type: 'develop.detail', p: { sharpen: 30, masking: 30, luminance: 30, color: 35 } }, { type: 'develop.tonemap', p: { method: 'local', strength: 45, detail: 10, highlights: -40, shadows: 15, halo: 70 } }]) },
    { id: 'high-iso-indoor', name: 'High-ISO indoor', settings: P([{ type: 'develop.basic', p: { profile: 'standard', exposure: 0.6, shadows: 25, blacks: -10, wb: 'tungsten' } }, { type: 'develop.detail', p: { sharpen: 30, radius: 1, detail: 20, masking: 50, luminance: 45, lumDetail: 45, color: 40 } }]) },
    { id: 'mono-contrast', name: 'Black and white, contrast', settings: P([{ type: 'develop.basic', p: { profile: 'mono-high', highlights: -30, shadows: 15, blacks: -10 } }]) },
    { id: 'hdr-natural', name: 'HDR natural', settings: P([{ type: 'develop.tonemap', p: { method: 'local', strength: 60, detail: 18, highlights: -20, shadows: 20, halo: 60 } }, { type: 'develop.basic', p: { profile: 'neutral', vibrance: 8 } }]) },
    { id: 'hdr-look', name: 'Single-image HDR look', settings: P([{ type: 'develop.tonemap', p: { method: 'local', strength: 45, detail: 30, highlights: -25, shadows: 25, halo: 50 } }, { type: 'develop.basic', p: { profile: 'standard', highlights: -30, shadows: 30, vibrance: 12 } }]) },
    { id: 'hdr-fusion', name: 'HDR exposure fusion', settings: P([{ type: 'develop.tonemap', p: { method: 'fusion', strength: 45, detail: 5, halo: 70 } }, { type: 'develop.basic', p: { profile: 'neutral' } }]) }
  ];
  var PKEY = 'le-raw-presets';
  function userPresets() { try { var l = JSON.parse(localStorage.getItem(PKEY) || '[]'); return Array.isArray(l) ? l.filter(function (x) { return x && typeof x.id === 'string' && x.settings && Array.isArray(x.settings.fx); }) : []; } catch (e) { return []; } }
  var presets = {
    list: function () { return BUILTIN.map(function (x) { return { id: x.id, name: x.name, builtIn: true, settings: JSON.parse(JSON.stringify(x.settings)) }; }).concat(userPresets()); },
    get: function (id) { return presets.list().filter(function (x) { return x.id === id; })[0] || null; },
    save: function (name, s) {
      var list = userPresets(), id = 'user-' + String(name || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      var clean = { v: 1, kind: 'develop-settings', fx: (s && s.fx || []).filter(function (e) { return e && DEV.indexOf(e.type) >= 0; }).map(cleanEntry) };
      list = list.filter(function (x) { return x.id !== id; }); list.unshift({ id: id, name: String(name || 'Preset').slice(0, 60), settings: clean });
      try { localStorage.setItem(PKEY, JSON.stringify(list.slice(0, 60))); } catch (e) { throw plain('This device has no room left for more presets.'); }
      return id;
    },
    remove: function (id) { try { localStorage.setItem(PKEY, JSON.stringify(userPresets().filter(function (x) { return x.id !== id; }))); } catch (e) { } }
  };
  /* Auto tone from the working copy's luminance statistics (log2 of scene luminance): middle grey to the median, then keep the
     brightest 0.1 % below sensor white and the darkest 5 % out of black. */
  function autoToneFrom(st) {
    if (!st) return {};
    var ex = clamp(-2.65 - st.p50, -3, 3) * 0.9, top = st.p999 + ex, low = st.p5 + ex;
    return {
      exposure: round(ex, 2), highlights: Math.round(-clamp((top - 0.2) * 32, 0, 80)), shadows: Math.round(clamp((-6.2 - low) * 14, 0, 55)),
      whites: Math.round(clamp((-0.3 - top) * 18, -25, 25)), blacks: Math.round(-clamp((low + 9.5) * 4, 0, 15))
    };
  }
  function autoTone(layer) {
    if (!layer || !layer.raw) return Promise.reject(plain('Auto tone needs a RAW or HDR layer.'));
    var get = (layer.raw.kind === 'hdr' ? hdrWorkingCopy : workingCopy)(layer, {});
    return get.then(function (w) {
      if (w.stats) return autoToneFrom(w.stats);
      var s = reduce(w, 1024), copy = new Float32Array(s.data);
      return work({ cmd: 'stats', data: copy.buffer, width: s.width, height: s.height }, [copy.buffer]).then(function (st) { w.stats = st; return autoToneFrom(st); });
    });
  }

  /* ------------------------------------------------------------------ rendering the default development (the layer's 8-bit picture) */
  function canvasOf(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function renderDefault(w, fx, box, ctx) {
    function cpu() {   /* no WebGL2: the CPU reference of develop.basic on a reduced copy (no detail, lens or tone map) */
      var D = LE.fx && LE.fx.develop, s = reduce(w, 2048), c = canvasOf(s.width, s.height), x = c.getContext('2d'), id = x.createImageData(s.width, s.height);
      var dev = D ? D.inject(D.split(fx).dev, ctx).filter(function (e) { return e.type === 'develop.basic'; })[0] : null;
      var plan = D && dev ? D.basicPlan(dev.p) : null, n = s.width * s.height, enc = function (v) { v = clamp(v, 0, 1); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
      for (var i = 0; i < n; i++) { var o = D ? D.basicPixel([s.data[i * 3], s.data[i * 3 + 1], s.data[i * 3 + 2]], plan) : [s.data[i * 3], s.data[i * 3 + 1], s.data[i * 3 + 2]]; id.data[i * 4] = enc(o[0]); id.data[i * 4 + 1] = enc(o[1]); id.data[i * 4 + 2] = enc(o[2]); id.data[i * 4 + 3] = 255; }
      x.putImageData(id, 0, 0); return c;
    }
    var boot = LE.fxBoot ? LE.fxBoot.load() : (LE.fx && LE.fx.ready ? LE.fx.ready : Promise.reject(new Error('no renderer')));
    return boot.then(function (FXr) {
      var FX = FXr || LE.fx;
      if (!FX.status().available || !FX.status().float) return cpu();
      var dev = FX.develop.inject(FX.develop.split(fx).dev, ctx);
      return FX.apply({ data: w.data, width: w.width, height: w.height, channels: 3, space: 'linear' }, { fx: dev, box: box });
    }).catch(function () { return cpu(); });
  }
  function toBlob(c, type, q) { return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('Could not encode the picture.')); }, type, q); }); }
  function fit(c, side) { if (Math.max(c.width, c.height) <= side) return c; var k = side / Math.max(c.width, c.height), o = canvasOf(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, o.width, o.height); return o; }
  function str(v, n) { return typeof v === 'string' ? v.replace(/[^\w #:.,()%\/+=-]/g, '').slice(0, n || 80) : undefined; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : undefined; }
  function colorOf(meta) {
    var c = meta.color || meta, out = {};
    ['colorMatrix1', 'colorMatrix2', 'forwardMatrix1', 'forwardMatrix2', 'cameraCal1', 'cameraCal2', 'analogBalance', 'asShotNeutral', 'asShotWhiteXY'].forEach(function (k) { if (Array.isArray(c[k]) && c[k].every(function (x) { return typeof x === 'number' && isFinite(x); })) out[k] = c[k].slice(0, 9); });
    ['illuminant1', 'illuminant2'].forEach(function (k) { if (num(c[k]) != null) out[k] = c[k]; });
    return out;
  }
  function cameraOf(meta) {
    var o = {}; ['make', 'model'].forEach(function (k) { var v = str(meta[k], 60); if (v) o[k] = v; });
    ['iso', 'exposureTime', 'fNumber', 'focalLength'].forEach(function (k) { if (num(meta[k]) != null) o[k] = meta[k]; });
    var lens = meta.lensInfo && typeof meta.lensInfo === 'string' ? str(meta.lensInfo, 80) : null; if (lens) o.lens = lens;
    return o;
  }

  /* ------------------------------------------------------------------ open */
  function readBytes(file) { return file.arrayBuffer ? file.arrayBuffer() : Promise.resolve(file); }
  function open(file, o) {
    o = o || {};
    var name = (file && file.name) || 'photo.dng', prog = o.onProgress || function () { };
    var bytes, rawId, wrapBlob, pr, w, warnings = [];
    return ready().then(function () { return readBytes(file); }).then(function (b) {
      bytes = b; prog(0.02);
      return LE.raw.probe(new File([b], name));
    }).then(function (p) {
      pr = p;
      if (!pr.supported && pr.decoder !== 'camera') throw plain(pr.why || 'This file is not a RAW photo LocalEditor can open.', 'unsupported');
      if (pr.preview && o.onPreview) { try { o.onPreview(pr.preview); } catch (e) { } }
      var dm = DEMOSAIC[o.demosaic] || {};
      return decodeToWork(bytes, { cap: workCap(), recovery: 'reconstruct', estimate: true, name: name, quality: o.quality != null ? o.quality : dm.quality, method: dm.method, signal: o.signal, onProgress: function (x) { prog(0.05 + 0.75 * x); } }).catch(function (e) {
        if (e && e.name === 'AbortError') throw e;
        if (e && e.code === 'declined') throw plain('Camera RAW support was not downloaded, so this ' + pr.format + ' file cannot be opened. You can convert it to DNG with a free converter and open that.', 'declined');
        if (pr.decoder === 'camera' && !e.why) throw plain('Camera RAW support could not open this ' + pr.format + ' file (' + (e && e.message || 'unknown reason') + '). DNG files open without it.', 'decoder');
        throw e.plain ? e : plain((e && (e.why || e.message)) || 'This RAW file could not be decoded.', 'decode');
      });
    }).then(function (work0) {
      w = work0;
      var meta = w.meta || {};
      var size = { w: w.full ? w.full[0] : w.width, h: w.full ? w.full[1] : w.height };
      var cap = LE.project && LE.project.LIMITS ? LE.project.LIMITS.assetBytes : 80 * 1048576;
      var info = { name: name, format: pr.format, decoder: meta.decoder || pr.decoder, iso: meta.iso, asShot: w.asShot, auto: w.auto };
      var raw = {
        v: 1, kind: 'raw',
        source: { asset: '', format: str(pr.format, 8) || 'RAW', decoder: meta.decoder === 'camera' ? 'camera' : 'builtin', name: str(name, 100), bytes: bytes.byteLength, stored: bytes.byteLength + 2e6 < cap },
        size: size, camera: cameraOf(meta), color: colorOf(meta),
        asShot: { temp: Math.round(w.asShot ? w.asShot[0] : 5500), tint: round(w.asShot ? w.asShot[1] : 0, 1) },
        auto: w.auto ? { temp: Math.round(w.auto[0]), tint: round(w.auto[1], 1) } : undefined,
        baseline: round(w.baseline || 0, 3)
      };
      if (!raw.source.stored) warnings.push('This RAW file is larger than the ' + Math.round(cap / 1048576) + ' MB a design can store; it is edited from its working copy on this device and the original is not saved in the design.');
      if (w.colorFallback) warnings.push('This file carries no colour matrix, so its colours are approximate.');
      var fx = defaults(info);
      var ctx = { asShot: w.asShot, auto: w.auto, wb: wbFor(raw), extent: Math.max(size.w, size.h), scene: true };
      prog(0.85);
      return renderDefault(w, fx, size, ctx).then(function (canvas) {
        return Promise.all([toBlob(canvas, 'image/jpeg', 0.92), wrap(bytes, { name: name, format: pr.format }, fit(canvas, 512))]).then(function (blobs) {
          wrapBlob = blobs[1];
          return Promise.all([hashBlob(blobs[0]), hashBlob(wrapBlob)]).then(function (ids) {
            rawId = ids[1]; raw.source.asset = rawId; mem.bytes[rawId] = bytes;
            var key = workKey(rawId, 'reconstruct', o.demosaic || 'auto', workCap());
            remember(key, w); persist(key, w);
            prog(1);
            return {
              layer: { type: 'image', name: name.replace(/\.[^.]+$/, '').slice(0, 40) || 'RAW photo', src: ids[0], w: canvas.width, h: canvas.height, crop: { x: 0, y: 0, w: 1, h: 1 }, raw: raw, fx: fx.map(function (e, i) { return { id: 'dv' + i + Date.now().toString(36), type: e.type, on: true, amount: 1, blend: 'normal', p: e.p }; }) },
              assets: {
                src: { id: ids[0], blob: blobs[0], type: 'image/jpeg', width: canvas.width, height: canvas.height, canvas: canvas, name: name.replace(/\.[^.]+$/, '') + '.jpg' },
                raw: raw.source.stored ? { id: rawId, blob: wrapBlob, type: 'image/png', width: Math.min(512, canvas.width), height: Math.round(Math.min(512, canvas.width) * canvas.height / canvas.width), name: name } : null
              },
              info: { format: pr.format, decoder: raw.source.decoder, size: size, working: [w.width, w.height], halfSize: !!w.half, asShot: raw.asShot, auto: raw.auto, clipped: w.clipped, warnings: warnings, module: pr.module || null }
            };
          });
        });
      });
    });
  }

  /* ------------------------------------------------------------------ HDR merge from files */
  function isRawName(n) { return EXT[String(n || '').toLowerCase().split('.').pop()] != null; }
  function evOf(meta) { return meta && meta.exposureTime ? Math.log2(meta.exposureTime * (meta.iso || 100) / 100 / Math.pow(meta.fNumber || 1, 2)) : null; }
  var DEGHOST = { off: null, low: { threshold: 0.2 }, medium: { threshold: 0.12 }, high: { threshold: 0.07 } };
  function loadHdr() { return LE.hdr && LE.hdr.merge && LE.hdr.core ? Promise.resolve(LE.hdr) : loadScript(BASE + 'hdr.js').then(function () { return LE.hdr; }); }
  function mergeFiles(files, o) {
    o = o || {};
    files = [].slice.call(files || []);
    if (files.length < 2 || files.length > 9) return Promise.reject(plain('Choose 2 to 9 bracketed photos of the same scene.'));
    var raws = files.filter(function (f) { return isRawName(f.name); });
    if (raws.length && raws.length !== files.length) return Promise.reject(plain('Use all RAW files or all JPEG files for one HDR merge, not a mix.'));
    var isRaw = raws.length === files.length, prog = o.onProgress || function () { }, maxPx = o.maxPixels || mergeCapPx();
    var frames = [], metas = [];
    return Promise.all([ready(), loadHdr()]).then(function () {
      var chain = Promise.resolve();
      files.forEach(function (f, i) {
        chain = chain.then(function () {
          if (o.signal && o.signal.aborted) throw abortError();
          if (isRaw) {
            return readBytes(f).then(function (b) {
              return LE.raw.probe(new File([b], f.name)).then(function (pr) {
                var mw = (pr.meta && pr.meta.width) || 4000, mh = (pr.meta && pr.meta.height) || 3000, cap = Math.round(Math.sqrt(maxPx * Math.max(mw, mh) / Math.min(mw, mh)));
                return decodeToWork(b, { cap: cap, matrix: false, name: f.name, signal: o.signal });
              });
            }).then(function (w) { metas.push(w.meta || {}); frames.push({ width: w.width, height: w.height, data: w.data, ev: o.evs ? o.evs[i] : evOf(w.meta) }); });
          }
          return (LE.load ? LE.load(f) : createImageBitmap(f)).then(function (img) {
            var c = img.getContext ? img : (function () { var x = canvasOf(img.width, img.height); x.getContext('2d').drawImage(img, 0, 0); return x; })();
            var k = Math.min(1, Math.sqrt(maxPx / (c.width * c.height))); if (k < 1) c = fit(c, Math.round(Math.max(c.width, c.height) * k));
            var id = c.getContext('2d').getImageData(0, 0, c.width, c.height);
            metas.push({}); frames.push({ width: id.width, height: id.height, data: id.data, ev: o.evs ? o.evs[i] : null });
          });
        }).then(function () { prog(0.4 * (i + 1) / files.length); });
      });
      return chain;
    }).then(function () {
      var W = frames[0].width, H = frames[0].height;
      if (frames.some(function (f) { return f.width !== W || f.height !== H; })) throw plain('The bracketed photos are not all the same size.');
      if (frames.some(function (f) { return f.ev == null; })) frames.forEach(function (f) { delete f.ev; });
      return LE.hdr.merge(frames, { mode: o.mode === 'fusion' ? 'fusion' : 'radiance', align: o.align === false ? false : { maxRotation: 3 }, deghost: DEGHOST[o.deghost || 'medium'] || false, reference: o.reference, maxPixels: maxPx * 1.05, signal: o.signal, onProgress: function (p) { prog(0.4 + 0.45 * p); } });
    }).then(function (res) {
      var space = isRaw ? 'camera' : 'linear-srgb', refMeta = metas[res.meta.reference] || {};
      var merged = { width: res.width, height: res.height, data: res.data };
      return hdrEncode(merged, { space: space }).then(function (blob) {
        return hashBlob(blob).then(function (id) {
          mem.hdr[id] = blob;
          var raw = {
            v: 1, kind: 'hdr', source: { asset: id, encoding: 'le-log16', space: space, stored: true }, size: { w: res.width, h: res.height },
            camera: cameraOf(refMeta), color: isRaw ? colorOf(refMeta) : undefined,
            merge: { frames: files.length, mode: res.meta.mode, reference: res.meta.reference, deghost: o.deghost || 'medium', align: o.align !== false, evs: (res.meta.exposuresEV || []).slice(0, 9), exposureSource: str(res.meta.exposureSource || 'metadata', 40), shiftX: (res.meta.alignment || []).map(function (a) { return a.dx; }).slice(0, 9), shiftY: (res.meta.alignment || []).map(function (a) { return a.dy; }).slice(0, 9), rotation: (res.meta.alignment || []).map(function (a) { return a.rotationDeg; }).slice(0, 9) }
          };
          var lay = { raw: raw };
          return hdrWorkingCopy(lay, {}).then(function (w) {
            if (w.asShot) raw.asShot = { temp: Math.round(w.asShot[0]), tint: round(w.asShot[1], 1) };
            var fx = res.meta.mode === 'fusion' ? [{ type: 'develop.basic', p: { profile: 'neutral' } }] : [{ type: 'develop.tonemap', p: { method: 'local', strength: 60, detail: 18, highlights: -20, shadows: 20, halo: 60 } }, { type: 'develop.basic', p: { profile: 'neutral', vibrance: 8 } }];
            var ctx = { asShot: w.asShot, wb: wbFor(raw), extent: Math.max(res.width, res.height), scene: true };
            return renderDefault(w, fx, { w: res.width, h: res.height }, ctx).then(function (canvas) {
              return toBlob(canvas, 'image/jpeg', 0.92).then(function (jb) {
                return hashBlob(jb).then(function (sid) {
                  prog(1);
                  return {
                    layer: { type: 'image', name: 'HDR merge', src: sid, w: canvas.width, h: canvas.height, crop: { x: 0, y: 0, w: 1, h: 1 }, raw: raw, fx: fx.map(function (e, i) { return { id: 'dh' + i + Date.now().toString(36), type: e.type, on: true, amount: 1, blend: 'normal', p: e.p }; }) },
                    assets: { src: { id: sid, blob: jb, type: 'image/jpeg', width: canvas.width, height: canvas.height, canvas: canvas, name: 'HDR merge.jpg' }, hdr: { id: id, blob: blob, type: 'image/png', width: res.width, height: res.height, name: 'HDR merge (scene-referred).png' } },
                    info: { meta: res.meta, space: space, size: [res.width, res.height], limit: 'Merged at up to ' + Math.round(maxPx / 1e5) / 10 + ' megapixels on this device.' }
                  };
                });
              });
            });
          });
        });
      });
    });
  }

  /* ------------------------------------------------------------------ loading and attaching */
  var readyP = null;
  function ready() {
    if (readyP) return readyP;
    readyP = (LE.raw && LE.raw.decode ? Promise.resolve() : loadScript(BASE + 'raw.js')).then(function () { return LE.raw.ready(); }).then(function () { attach(); return LE.raw; });
    readyP.catch(function () { readyP = null; });
    return readyP;
  }
  function formats() { return Object.keys(EXT).map(function (e) { return { ext: e, format: EXT[e], decoder: EXT[e] === 'DNG' ? 'builtin' : 'camera' }; }); }
  function attach() {
    var R = LE.raw;
    R.open = open; R.formats = formats; R.defaults = defaults; R.settings = settings; R.presets = presets; R.autoTone = autoTone; R.autoToneFrom = autoToneFrom;
    R.wrap = wrap; R.unwrap = unwrap; R.isRawName = isRawName;
    R.work = {
      clear: function () { works = {}; workOrder = []; derived = {}; return global.caches ? caches.open(CACHE).then(function (c) { return c.keys().then(function (ks) { return Promise.all(ks.filter(function (r) { return /\/__work\//.test(r.url); }).map(function (r) { return c.delete(r); })); }); }) : Promise.resolve(); },
      usage: function () { var b = 0; workOrder.forEach(function (k) { b += works[k].data.byteLength; }); return { memoryBytes: b, entries: workOrder.length, cap: workCap() }; },
      get: function (layer, o) { return (layer.raw.kind === 'hdr' ? hdrWorkingCopy : workingCopy)(layer, o || {}); }
    };
    R.layer = LE.rawLayer;
    var H = LE.hdr = LE.hdr || {};
    H.mergeFiles = mergeFiles; H.encode = hdrEncode; H.decode = hdrDecode; H.deghostLevels = Object.keys(DEGHOST); H.load = loadHdr;
    if (global.LEPwa && global.LEPwa.describeModel) global.LEPwa.describeModel(WORK_MODEL, { name: 'RAW working copies', about: 'Decoded RAW and HDR photos kept so they reopen instantly. Made again from the original when deleted.' });
    if (LE.fx && LE.fx.sources) { LE.fx.sources.register('raw', provide); LE.fx.sources.register('hdr', provide); }
  }
  LE.rawLayer = { ready: ready, provide: provide, mem: mem, base: BASE, workCap: workCap };
  /* The pack may be loaded after this file: register then too. */
  if (LE.fx && LE.fx.ready && LE.fx.ready.then) LE.fx.ready.then(function () { if (LE.raw && LE.raw.open && LE.fx.sources) { LE.fx.sources.register('raw', provide); LE.fx.sources.register('hdr', provide); } });
})(window);
