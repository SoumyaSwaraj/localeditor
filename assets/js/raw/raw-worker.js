/* Worker for the built-in (permissive) RAW path: DNG parsing, decoding, demosaicing. Our own code.
 * Messages in:  { id, cmd: 'probe', buf, name } | { id, cmd: 'decode', buf, name, opts }
 * Messages out: { id, ok: true, result } | { id, progress } | { id, ok: false, error, code }
 * `buf` is an ArrayBuffer and is transferred. `opts.signal` is replaced by { cmd: 'abort', id }.
 */
'use strict';
importScripts('raw-core.js');
var aborts = {};
self.onmessage = function (ev) {
  var m = ev.data, id = m.id;
  if (m.cmd === 'abort') { aborts[id] = true; return; }
  try {
    if (m.cmd === 'probe') {
      var pr = LERawCore.probeBuffer(m.buf, m.name);
      if (pr.preview) { pr.previewBytes = m.buf.slice(pr.preview.off, pr.preview.off + pr.preview.len); }
      self.postMessage({ id: id, ok: true, result: pr }, pr.previewBytes ? [pr.previewBytes] : []);
    } else if (m.cmd === 'decode') {
      var o = m.opts || {}, t0 = performance.now(), sig = { get aborted() { return !!aborts[id]; } };
      LERawCore.decodeDNG(m.buf, { half: o.half, method: o.method, format: o.format, crop: o.crop, signal: sig, onProgress: function (p) { self.postMessage({ id: id, progress: p }); } }).then(function (r) {
        var meta = r.meta; delete meta.parsed;
        var t1 = performance.now(), data = r.data;
        if (o.space && o.space !== 'camera') { // convert to a working space with as-shot white balance (float only)
          var parsed = LERawCore.parseDNG(m.buf), cm = LERawCore.cameraToSpace(parsed, o.wb || 'as-shot', o.space);
          if (r.format === 'f32') { LERawCore.applyMatrix(data, cm.matrix); }
          meta.matrix = cm.matrix; meta.wbGains = cm.gains; meta.temp = cm.temp; meta.tint = cm.tint;
        } else {
          var p2 = LERawCore.parseDNG(m.buf), cm2 = LERawCore.cameraToSpace(p2, o.wb || 'as-shot', o.matrixSpace || 'srgb');
          meta.matrix = cm2.matrix; meta.wbGains = cm2.gains; meta.temp = cm2.temp; meta.tint = cm2.tint; meta.colorFallback = cm2.fallback; meta.matrixSpace = o.matrixSpace || 'srgb';
        }
        var space = o.space && o.space !== 'camera' && r.format === 'f32' ? o.space : 'camera';
        meta.timing = { developMs: r.ms, totalMs: performance.now() - t0 };
        meta.crop = r.crop;
        self.postMessage({ id: id, ok: true, result: { width: r.width, height: r.height, data: data, space: space, format: r.format, meta: meta } }, [data.buffer]);
      }).catch(function (e) { self.postMessage({ id: id, ok: false, error: String(e && e.message || e), name: e && e.name, why: LERawCore.unsupportedWhy(String(e && e.message || e)) }); delete aborts[id]; });
    }
  } catch (e) { self.postMessage({ id: id, ok: false, error: String(e && e.message || e), why: LERawCore.unsupportedWhy(String(e && e.message || e)) }); }
};
