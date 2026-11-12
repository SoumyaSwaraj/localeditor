(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); }, H = window.LEHdr, S = window.LEDngSynth, frames = [];
  var log = function (m) { $('log').textContent += m + '\n'; };
  function status(t) { $('status').textContent = t; }
  function show(canvasData, w, h) { var c = $('out'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(canvasData, w, h), 0, 0); }
  function thumbs() { $('thumbs').textContent = ''; frames.forEach(function (f) { var c = document.createElement('canvas'); c.width = f.width; c.height = f.height; c.getContext('2d').putImageData(new ImageData(f.data, f.width, f.height), 0, 0); $('thumbs').appendChild(c); }); $('run').disabled = frames.length < 2; }
  function loadFile(file) {
    return createImageBitmap(file).then(function (bmp) {
      var maxSide = 2400, s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s), c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d'); x.drawImage(bmp, 0, 0, w, h);
      return { width: w, height: h, data: x.getImageData(0, 0, w, h).data, name: file.name };
    });
  }
  $('files').addEventListener('change', function () { Promise.all(Array.prototype.slice.call($('files').files).slice(0, 7).map(loadFile)).then(function (fs) { frames = fs; thumbs(); status(fs.length + ' photos loaded. Exposure data is not read in this lab; the merge estimates it.'); }); });
  $('synth').addEventListener('click', function () {
    var w = 640, h = 480, sc = S.scene(w, h, 'natural', { sigma: 0.8 }), T = sc.data; frames = [];
    [-3, -1.5, 0, 1.5, 3].forEach(function (ev, i) {
      var d = new Uint8ClampedArray(w * h * 4), g = 0.3 * Math.pow(2, ev), sh = i * 3;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) for (var c = 0; c < 3; c++) d[(y * w + x) * 4 + c] = 255 * H.enc(Math.min(1, T[(y * w + (x + sh) % w) * 3 + c] * g * (1 + 3 * (x / w) * (x / w) * 3)));
      for (var k = 3; k < d.length; k += 4) d[k] = 255; frames.push({ width: w, height: h, data: d, ev: ev });
    });
    thumbs(); status('5 synthetic brackets (-3 to +3 EV, each shifted 3 px).');
  });
  $('run').addEventListener('click', function () {
    status('Merging...'); var t0 = performance.now(), mode = $('mode').value;
    LE.hdr.merge(frames, { mode: mode, align: $('align').value === '1', deghost: $('deghost').value === '1', onProgress: function (p) { status('Merging ' + Math.round(p * 100) + '%'); } }).then(function (r) {
      var out = r; if (mode === 'radiance') out = Object.assign({}, r, H.toneMap(r, { method: 'local' })); var rgba = new Uint8ClampedArray(r.width * r.height * 4);
      for (var i = 0; i < r.width * r.height; i++) { for (var c = 0; c < 3; c++) rgba[i * 4 + c] = 255 * H.enc(out.data[i * 3 + c]); rgba[i * 4 + 3] = 255; }
      show(rgba, r.width, r.height); window.__hdrResult = { width: r.width, height: r.height, meta: r.meta, ms: performance.now() - t0 }; status('Merged ' + r.width + ' x ' + r.height + ' in ' + Math.round(performance.now() - t0) + ' ms.'); log(JSON.stringify(r.meta));
    }).catch(function (e) { window.__hdrError = String(e.message || e); status('Could not merge: ' + e.message); });
  });
  window.__hdrLab = { frames: function () { return frames; }, setFrames: function (f) { frames = f; thumbs(); } };
})();
