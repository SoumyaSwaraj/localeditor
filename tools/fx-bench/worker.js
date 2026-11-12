/* Bench only: runs the real effect renderer inside a worker on an OffscreenCanvas, to compare with the main thread.
   The renderer is written for a page; these few lines give it what it expects (a window, a script loader, a canvas factory). */
'use strict';
self.window = self;
self.document = {
  currentScript: null, head: { appendChild: function () {} },
  createElement: function (tag) { if (tag === 'canvas') return new OffscreenCanvas(1, 1); throw new Error('no ' + tag + ' in a worker'); },
  querySelector: function () { return null; }
};
self.LE = { lazy: function (src) { try { importScripts(src); return Promise.resolve(); } catch (e) { return Promise.reject(e); } } };
var ready = null;
self.onmessage = function (e) {
  var d = e.data;
  if (d.init) {
    self.document.currentScript = { src: d.init };
    try { importScripts(d.init); } catch (err) { self.postMessage({ error: String(err && err.message || err) }); return; }
    ready = self.LE.fx.ready;
    ready.then(function () { self.postMessage({ ok: true, status: self.LE.fx.status().available }); }, function (err) { self.postMessage({ error: String(err && err.message || err) }); });
    return;
  }
  ready.then(function (FX) {
    var t0 = performance.now();
    var out = FX.apply(d.bitmap, { fx: d.fx });
    var bmp = out.transferToImageBitmap();
    d.bitmap.close();
    self.postMessage({ bitmap: bmp, ms: performance.now() - t0 }, [bmp]);
  }).catch(function (err) { self.postMessage({ error: String(err && err.message || err) }); });
};
