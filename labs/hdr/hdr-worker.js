/* Worker for LE.hdr.merge. In: { frames, opts }. Out: { progress } ... then { ok: true, result } (the data buffer is transferred) or { ok: false, error }. */
'use strict';
importScripts('hdr.js');
self.onmessage = function (ev) {
  var m = ev.data;
  try {
    m.opts.onProgress = function (p) { self.postMessage({ progress: p }); };
    var r = LEHdr.merge(m.frames, m.opts);
    self.postMessage({ ok: true, result: r }, [r.data.buffer]);
  } catch (e) { self.postMessage({ ok: false, error: String(e && e.message || e) }); }
};
