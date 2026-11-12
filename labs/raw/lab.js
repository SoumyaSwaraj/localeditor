/* RAW lab driver. Everything is on window.__raw* so tests and measurement scripts can read results. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); }, S = window.LEDngSynth, D = window.LERawDevelop, current = null, busy = false;
  var log = function (m) { $('log').textContent += m + '\n'; };
  Object.keys(D.LOOKS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = D.LOOKS[k].name; if (k === 'standard') o.selected = true; $('look').appendChild(o); });
  window.__lab = { synth: S, develop: D };

  function status(t) { $('status').textContent = t; }
  function open(file) {
    status('Reading ' + file.name + '...'); var t0 = performance.now();
    return LE.raw.probe(file).then(function (pr) {
      window.__rawProbe = pr; log('probe: ' + JSON.stringify({ format: pr.format, decoder: pr.decoder, supported: pr.supported, why: pr.why, preview: !!pr.preview, ms: Math.round(performance.now() - t0) }));
      if (!pr.supported) { status(pr.why); return null; }
      if (pr.preview) { var im = new Image(); im.onload = function () { if (!current) { var c = $('out'); c.width = 320; c.height = Math.round(320 * im.naturalHeight / im.naturalWidth); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); } }; im.src = pr.preview.url; }
      status('Decoding...'); var t1 = performance.now();
      return LE.raw.decode(file, { halfSize: $('half').value === '1', format: 'f32', onProgress: function (p) { status('Decoding ' + Math.round(p * 100) + '%'); } }).then(function (r) {
        r.decodeMs = performance.now() - t1; current = r; window.__rawResult = { width: r.width, height: r.height, space: r.space, format: r.format, meta: r.meta, decodeMs: r.decodeMs };
        status('Opened ' + r.width + ' x ' + r.height + ' in ' + Math.round(r.decodeMs) + ' ms (' + r.meta.decoder + ').'); render(); return r;
      });
    }).catch(function (e) { window.__rawError = String(e.message || e); status('Could not open: ' + (e.why || e.message)); log('error: ' + e.message); });
  }
  function render() {
    if (!current || busy) return; busy = true;
    var r = current, m = r.meta, wb = { temp: +$('temp').value, tint: +$('tint').value };
    var C = window.LERawCore, t0 = performance.now();
    var cm = C.cameraToSpace(m, window.__useAsShot ? 'as-shot' : wb, 'srgb');
    var img = D.develop(r, cm, { highlightMode: $('hl').value, exposure: +$('exposure').value, shadows: +$('shadows').value, look: $('look').value });
    var rgba = D.toSRGB8(img), c = $('out'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    window.__rawRender = { ms: performance.now() - t0, timing: img.timing, temp: cm.temp, tint: cm.tint };
    $('meta').textContent = (m.make || '') + ' ' + (m.model || '') + ' - as shot ' + Math.round(cm.temp) + ' K, tint ' + Math.round(cm.tint) + ' - rendered in ' + Math.round(performance.now() - t0) + ' ms'; busy = false;
  }
  ['exposure', 'temp', 'tint', 'shadows', 'hl', 'look'].forEach(function (id) { $(id).addEventListener('input', function () { if (id === 'temp' || id === 'tint') window.__useAsShot = false; render(); }); });
  $('half').addEventListener('change', function () { if (window.__lastFile) open(window.__lastFile); });
  $('file').addEventListener('change', function () { var f = $('file').files[0]; if (f) { window.__lastFile = f; window.__useAsShot = true; open(f).then(function () { if (current) { $('temp').value = Math.round(current.meta.temp); $('tint').value = Math.round(current.meta.tint); } }); } });
  $('synth').addEventListener('click', function () {
    var sz = $('synthSize').value.split('x').map(Number), W = sz[0], H = sz[1], sc = S.scene(W, H, 'natural'), cam = S.cameraFor();
    var mos = S.mosaic(sc, { bits: 14, black: 256, white: 16383, cam: cam, headroom: 0.9 });
    var bytes = S.writeDNG({ width: W, height: H, mosaic: mos, bits: 14, black: 256, white: 16383, cam: cam, compression: $('synthComp').value, tile: $('synthComp').value === 'lj92' ? [256, 256] : null });
    var f = new File([bytes], 'synthetic-' + W + 'x' + H + '.dng', { type: 'image/x-adobe-dng' }); window.__lastFile = f; window.__useAsShot = true; open(f).then(function () { if (current) { $('temp').value = Math.round(current.meta.temp); $('tint').value = Math.round(current.meta.tint); } });
  });
})();
