/* Face lab: photo -> faces and 478 landmarks (LE.maps.face) -> overlay, part masks, skin-only smoothing, one landmark-anchored warp. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MAXW = 1100, srcImage = null, work = null, faces = [], abortCtl = null, ready = false;
  var POOL = ['people-07', 'people-08', 'people-06', 'people-01', 'street-02', 'travel-05', 'travel-06', 'street-01', 'people-03', 'people-05', 'arch-01', 'still-02'];
  POOL.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; $('pool').appendChild(o); });
  function status(t) { $('status').textContent = t; }
  function loadImage(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('Could not open that image')); }; i.src = src; }); }
  async function setPhoto(img, name) {
    srcImage = img; faces = []; ready = false; window.__faceDone = false;
    var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAXW / Math.max(w, h));
    work = document.createElement('canvas'); work.width = Math.round(w * k); work.height = Math.round(h * k); work.getContext('2d').drawImage(img, 0, 0, work.width, work.height);
    $('srcinfo').textContent = (name || 'Photo') + ': ' + w + ' x ' + h + ' px (the lab shows it at ' + work.width + ' x ' + work.height + ')';
    $('go').disabled = false; ['viewPanel', 'demoSkin', 'demoWarp'].forEach(function (i) { $(i).hidden = true; });
  }
  $('file').addEventListener('change', async function (e) { var f = e.target.files[0]; if (f) await setPhoto(await loadImage(URL.createObjectURL(f)), f.name); });
  $('pool').addEventListener('change', async function () { await setPhoto(await loadImage('../../assets/photos/collage/' + $('pool').value + '.jpg'), $('pool').value); });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', async function (e) { var f = e.dataTransfer.files[0]; if (f) await setPhoto(await loadImage(URL.createObjectURL(f)), f.name); });

  $('go').addEventListener('click', async function () {
    if (!srcImage) return;
    abortCtl = new AbortController(); window.__faceError = null; window.__faceDone = false;
    $('go').disabled = true; $('cancel').classList.remove('hidden'); $('bar').classList.remove('hidden'); $('bar').value = 0;
    try {
      var r = await LE.maps.gate('face', { run: function () {
        return LE.maps.face(srcImage, { maxFaces: +$('maxFaces').value, parts: $('useParts').checked, scan: $('scan').checked, signal: abortCtl.signal,
          onProgress: function (p) { $('bar').value = p.fraction || 0; status(p.stage === 'download' ? 'Downloading the face models (one time)...' : p.stage === 'starting' ? 'Starting the engine...' : 'Finding faces...'); } });
      } });
      if (!r) { status('Cancelled.'); return; }
      faces = r; ready = true;
      var t = r.timings;
      status(faces.length ? 'Found ' + faces.length + (faces.length === 1 ? ' face' : ' faces') + ' in ' + Math.round(t.wallMs) + ' ms.' : 'No face found in this photo.');
      $('timings').classList.remove('hidden');
      $('timings').innerHTML = '<tr><th>Start</th><td>' + Math.round(t.startMs) + ' ms</td><th>Detection</th><td>' + Math.round(t.detectMs) + ' ms</td><th>Landmarks, blendshapes, parts</th><td>' + Math.round(t.landmarksMs) + ' ms</td></tr>';
      show(); window.__faceDone = true;
    } catch (e) { window.__faceError = e.message || String(e); status(e.code === 'cancelled' ? 'Cancelled.' : 'Could not make the face map: ' + (e.message || e)); }
    finally { $('go').disabled = false; $('cancel').classList.add('hidden'); $('bar').classList.add('hidden'); }
  });
  $('cancel').addEventListener('click', function () { if (abortCtl) abortCtl.abort(); });

  /* ---------- overlay and mask views ---------- */
  var COLORS = { skin: '#f5c542', eyes: '#2ee6e6', lips: '#ff4d6d', teeth: '#ffffff', brows: '#ff9f1c', underEyes: '#9b5de5', innerMouth: '#ff00ff' };
  function pathOf(p, w, h) { var path = new Path2D(); p.rings.forEach(function (r) { r.forEach(function (q, i) { if (i) path.lineTo(q[0] * w, q[1] * h); else path.moveTo(q[0] * w, q[1] * h); }); path.closePath(); }); return path; }
  function drawOverlay() {
    var c = $('cOver'), w = work.width, h = work.height; c.width = w; c.height = h;
    var x = c.getContext('2d'); x.drawImage(work, 0, 0);
    faces.forEach(function (f) {
      if ($('vBox').checked) { x.strokeStyle = '#00ff88'; x.lineWidth = 2; x.strokeRect(f.box.x * w, f.box.y * h, f.box.w * w, f.box.h * h); x.strokeStyle = '#ff3b3b'; x.setLineDash([4, 3]); x.strokeRect(f.detectorBox.x * w, f.detectorBox.y * h, f.detectorBox.w * w, f.detectorBox.h * h); x.setLineDash([]); }
      if ($('vLines').checked) ['skin', 'eyes', 'lips', 'brows', 'underEyes'].forEach(function (k) {
        x.strokeStyle = COLORS[k]; x.lineWidth = Math.max(1, w / 700); x.stroke(pathOf(f.parts[k], w, h));
      });
      if ($('vPoints').checked) { x.fillStyle = '#7CFC00'; var r = Math.max(0.8, w / 900); f.landmarks.forEach(function (p) { x.beginPath(); x.arc(p[0] * w, p[1] * h, r, 0, 6.3); x.fill(); }); }
    });
  }
  function maskUnion(part, w, h, o) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d');
    faces.forEach(function (f) { x.drawImage(LE.maps.faceMask(f, part, w, h, Object.assign({ image: work }, o || {})), 0, 0); });
    return c;
  }
  function drawMask() {
    var c = $('cMask'), w = work.width, h = work.height; c.width = w; c.height = h; var x = c.getContext('2d'), part = $('partSel').value;
    x.drawImage(work, 0, 0);
    var m = maskUnion(part, w, h, { segmentation: $('useSeg').checked });
    var tint = document.createElement('canvas'); tint.width = w; tint.height = h; var tx = tint.getContext('2d');
    tx.fillStyle = '#ff2d95'; tx.fillRect(0, 0, w, h); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(m, 0, 0);
    x.globalAlpha = 0.6; x.drawImage(tint, 0, 0); x.globalAlpha = 1;
    $('capMask').textContent = 'Mask: ' + $('partSel').selectedOptions[0].textContent;
  }
  function info() {
    $('faceInfo').textContent = faces.map(function (f, i) {
      var b = f.blendshapes || {};
      return 'Face ' + (i + 1) + ': box ' + Math.round(f.box.w * work.width) + ' x ' + Math.round(f.box.h * work.height) + ' px, detector score ' + f.score.toFixed(2) + ', presence ' + f.presence.toFixed(2) + ', tilt ' + (f.rotation * 57.3).toFixed(0) + ' deg' +
        (f.blendshapes ? ', smile ' + (((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2).toFixed(2) + ', jaw open ' + (b.jawOpen || 0).toFixed(2) + ', eyes closed ' + (((b.eyeBlinkLeft || 0) + (b.eyeBlinkRight || 0)) / 2).toFixed(2) : '');
    }).join('  |  ');
  }
  function show() {
    ['viewPanel', 'demoSkin', 'demoWarp'].forEach(function (i) { $(i).hidden = !faces.length; });
    if (!faces.length) return;
    $('wFace').innerHTML = ''; faces.forEach(function (f, i) { var o = document.createElement('option'); o.value = i; o.textContent = 'Face ' + (i + 1); $('wFace').appendChild(o); });
    drawOverlay(); drawMask(); info(); skinCache = null; renderSkin(); renderWarp();
  }
  ['vPoints', 'vLines', 'vBox'].forEach(function (id) { $(id).addEventListener('change', function () { if (ready && faces.length) drawOverlay(); }); });
  ['partSel', 'useSeg'].forEach(function (id) { $(id).addEventListener('change', function () { if (ready && faces.length) drawMask(); }); });

  /* ---------- pixel helpers (CPU, float) ---------- */
  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, i, sum, lo, hi;
    for (y = 0; y < h; y++) { var row = y * w; sum = 0; for (x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x]; for (x = 0; x < w; x++) { lo = Math.max(0, x - r); hi = Math.min(w - 1, x + r); tmp[row + x] = sum / (hi - lo + 1); if (x + r + 1 < w) sum += src[row + x + r + 1]; if (x - r >= 0) sum -= src[row + x - r]; } }
    for (x = 0; x < w; x++) { sum = 0; for (i = 0; i <= Math.min(r, h - 1); i++) sum += tmp[i * w + x]; for (y = 0; y < h; y++) { lo = Math.max(0, y - r); hi = Math.min(h - 1, y + r); out[y * w + x] = sum / (hi - lo + 1); if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x]; if (y - r >= 0) sum -= tmp[(y - r) * w + x]; } }
    return out;
  }
  function gauss(src, w, h, r) { var a = boxBlur(src, w, h, r); a = boxBlur(a, w, h, r); return boxBlur(a, w, h, r); }
  function guided(guide, p, w, h, r, eps) {
    var n = w * h, mI = boxBlur(guide, w, h, r), mP = boxBlur(p, w, h, r), IP = new Float32Array(n), II = new Float32Array(n), i;
    for (i = 0; i < n; i++) { IP[i] = guide[i] * p[i]; II[i] = guide[i] * guide[i]; }
    var mIP = boxBlur(IP, w, h, r), mII = boxBlur(II, w, h, r), a = new Float32Array(n), b = new Float32Array(n);
    for (i = 0; i < n; i++) { var v = mII[i] - mI[i] * mI[i], c = mIP[i] - mI[i] * mP[i]; a[i] = c / (v + eps); b[i] = mP[i] - a[i] * mI[i]; }
    var ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), out = new Float32Array(n);
    for (i = 0; i < n; i++) out[i] = ma[i] * guide[i] + mb[i];
    return out;
  }
  function planes(canvas) {
    var w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data, n = w * h, P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (var i = 0; i < n; i++) { P[0][i] = d[i * 4] / 255; P[1][i] = d[i * 4 + 1] / 255; P[2][i] = d[i * 4 + 2] / 255; }
    return P;
  }
  function alphaPlane(canvas) { var w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data, a = new Float32Array(w * h); for (var i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255; return a; }

  /* ---------- demo A: frequency split restricted to the skin mask ---------- */
  var skinCache = null;
  function renderSkin() {
    if (!ready || !faces.length) return;
    var c = $('cSkin'), w = work.width, h = work.height; c.width = w; c.height = h; var x = c.getContext('2d');
    if ($('sShowMask').checked) { var mm = maskUnion('skin', w, h, { segmentation: $('sSeg').checked, feather: 2 }); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(mm, 0, 0); return; }
    var amt = +$('sAmt').value, rad = +$('sRad').value, tex = +$('sTex').value, t0 = performance.now();
    var key = rad + '|' + $('sSeg').checked;
    if (!skinCache || skinCache.key !== key) {
      var P = planes(work), lum = new Float32Array(w * h), i;
      for (i = 0; i < lum.length; i++) lum[i] = 0.299 * P[0][i] + 0.587 * P[1][i] + 0.114 * P[2][i];
      var base = [0, 1, 2].map(function (k) { return guided(lum, P[k], w, h, rad, 0.0025); });        /* blemish and blotch scale removed, edges kept */
      var fine = [0, 1, 2].map(function (k) { return gauss(P[k], w, h, Math.max(1, Math.round(rad / 5))); }); /* what is finer than this is texture */
      var mask = alphaPlane(maskUnion('skin', w, h, { segmentation: $('sSeg').checked, feather: Math.max(1, Math.round(w / 400)) }));
      skinCache = { key: key, P: P, base: base, fine: fine, mask: mask };
    }
    var C = skinCache, img = x.createImageData(w, h), o = img.data;
    for (var j = 0; j < w * h; j++) {
      var m = C.mask[j] * amt;
      for (var k = 0; k < 3; k++) {
        var orig = C.P[k][j], smooth = C.base[k][j] + (orig - C.fine[k][j]) * tex;   /* smooth base + the texture we choose to keep */
        var v = orig + (smooth - orig) * m; o[j * 4 + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      o[j * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    window.__skinMs = performance.now() - t0;
  }
  var skinTimer = 0;
  ['sAmt', 'sTex', 'sRad', 'sSeg', 'sShowMask'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(skinTimer); skinTimer = setTimeout(renderSkin, 30); }); $(id).addEventListener('change', function () { clearTimeout(skinTimer); skinTimer = setTimeout(renderSkin, 30); }); });
  function hold(btn, on, off) { btn.addEventListener('pointerdown', function (e) { e.preventDefault(); on(); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { btn.addEventListener(t, off); }); }
  hold($('sHold'), function () { var c = $('cSkin'); c.getContext('2d').drawImage(work, 0, 0); }, function () { renderSkin(); });

  /* ---------- demo B: landmark-anchored displacement ---------- */
  /* Returns the field as inverse displacement (where to read from) on a coarse grid, in pixels. */
  function warpField(f, kind, amt, w, h) {
    var L = f.landmarks, P = function (i) { return [L[i][0] * w, L[i][1] * h]; };
    var faceH = Math.hypot((P(10)[0] - P(152)[0]), (P(10)[1] - P(152)[1])), terms = [];
    var axis = (function () { var a = P(168), b = P(152), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return { px: a[0], py: a[1], ux: dx / l, uy: dy / l }; })();
    if (kind === 'eyes') {
      [[LE.maps.IDX.eyeR, 468], [LE.maps.IDX.eyeL, 473]].forEach(function (e) {
        var cx = 0, cy = 0; e[0].forEach(function (i) { cx += P(i)[0]; cy += P(i)[1]; }); cx /= e[0].length; cy /= e[0].length;
        var ew = Math.hypot(P(e[0][0])[0] - P(e[0][8])[0], P(e[0][0])[1] - P(e[0][8])[1]);
        terms.push({ kind: 'radial', cx: cx, cy: cy, R: ew * 1.5, s: amt * 0.45 });
      });
    } else if (kind === 'jaw') {
      var jaw = LE.maps.IDX.jaw; var sig = faceH * 0.2;
      jaw.forEach(function (i) {
        var p = P(i), t = ((p[0] - axis.px) * axis.ux + (p[1] - axis.py) * axis.uy), ax = axis.px + axis.ux * t, ay = axis.py + axis.uy * t;
        var dx = ax - p[0], dy = ay - p[1], l = Math.hypot(dx, dy) || 1;
        /* narrower jaw (amt > 0): content moves toward the axis, so each output pixel reads from farther out */
        terms.push({ kind: 'bump', x: p[0], y: p[1], sig: sig, dx: -dx / l * amt * faceH * 0.07, dy: -dy / l * amt * faceH * 0.07 });
      });
    } else if (kind === 'smile') {
      [61, 291].forEach(function (i) { var p = P(i), up = [-axis.ux, -axis.uy], out = i === 61 ? [-1, 0] : [1, 0]; terms.push({ kind: 'bump', x: p[0], y: p[1], sig: faceH * 0.1, dx: -(up[0] * 0.6 + out[0] * 0.25) * amt * faceH * 0.05, dy: -(up[1] * 0.6) * amt * faceH * 0.05 }); });
    }
    return function (x, y) {
      var dx = 0, dy = 0, bx = 0, by = 0, bw = 0;
      terms.forEach(function (t) {
        if (t.kind === 'radial') { var rx = x - t.cx, ry = y - t.cy, d = Math.hypot(rx, ry) / t.R; if (d < 1) { var f2 = (1 - d * d); f2 *= f2; dx += -rx * t.s * f2; dy += -ry * t.s * f2; } }
        else { var ex = x - t.x, ey = y - t.y, g = Math.exp(-(ex * ex + ey * ey) / (2 * t.sig * t.sig)); bx += t.dx * g; by += t.dy * g; bw += g; }
      });
      /* anchored bumps overlap: use their weighted average, faded by the strongest single bump, so the amount does not grow with the number of anchors */
      if (bw > 1e-6) { var mx = 0; terms.forEach(function (t) { if (t.kind === 'bump') { var ex2 = x - t.x, ey2 = y - t.y; mx = Math.max(mx, Math.exp(-(ex2 * ex2 + ey2 * ey2) / (2 * t.sig * t.sig))); } }); dx += bx / bw * mx; dy += by / bw * mx; }
      return [dx, dy];
    };
  }
  function renderWarp() {
    if (!ready || !faces.length) return;
    var c = $('cWarp'), w = work.width, h = work.height; c.width = w; c.height = h; var x = c.getContext('2d');
    var f = faces[+$('wFace').value || 0], kind = $('wKind').value, amt = +$('wAmt').value, t0 = performance.now();
    var field = warpField(f, kind, amt, w, h), src = work.getContext('2d').getImageData(0, 0, w, h).data, img = x.createImageData(w, h), o = img.data, G = 8;
    /* coarse grid, bilinear in between */
    var gw = Math.ceil(w / G) + 1, gh = Math.ceil(h / G) + 1, gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
    for (var j = 0; j < gh; j++) for (var i = 0; i < gw; i++) { var d = field(i * G, j * G); gx[j * gw + i] = d[0]; gy[j * gw + i] = d[1]; }
    for (var y = 0; y < h; y++) {
      var fy = y / G, y0 = Math.floor(fy), wy = fy - y0;
      for (var xx = 0; xx < w; xx++) {
        var fx = xx / G, x0 = Math.floor(fx), wx = fx - x0, a = y0 * gw + x0;
        var dx = (gx[a] * (1 - wx) + gx[a + 1] * wx) * (1 - wy) + (gx[a + gw] * (1 - wx) + gx[a + gw + 1] * wx) * wy;
        var dy = (gy[a] * (1 - wx) + gy[a + 1] * wx) * (1 - wy) + (gy[a + gw] * (1 - wx) + gy[a + gw + 1] * wx) * wy;
        var sx = Math.max(0, Math.min(w - 1.001, xx + dx)), sy = Math.max(0, Math.min(h - 1.001, y + dy)), ix = sx | 0, iy = sy | 0, ax = sx - ix, ay = sy - iy, p = (iy * w + ix) * 4, q = p + w * 4, oo = (y * w + xx) * 4;
        for (var k = 0; k < 3; k++) o[oo + k] = (src[p + k] * (1 - ax) + src[p + 4 + k] * ax) * (1 - ay) + (src[q + k] * (1 - ax) + src[q + 4 + k] * ax) * ay;
        o[oo + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    if ($('wGrid').checked) { x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1; for (var gj = 0; gj < gh; gj += 3) { x.beginPath(); for (var gi = 0; gi < gw; gi++) { var px = gi * G - gx[gj * gw + gi], py = gj * G - gy[gj * gw + gi]; if (gi) x.lineTo(px, py); else x.moveTo(px, py); } x.stroke(); } for (var gi2 = 0; gi2 < gw; gi2 += 3) { x.beginPath(); for (var gj2 = 0; gj2 < gh; gj2++) { var px2 = gi2 * G - gx[gj2 * gw + gi2], py2 = gj2 * G - gy[gj2 * gw + gi2]; if (gj2) x.lineTo(px2, py2); else x.moveTo(px2, py2); } x.stroke(); } }
    window.__warpMs = performance.now() - t0;
  }
  var warpTimer = 0;
  ['wFace', 'wKind', 'wAmt', 'wGrid'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(warpTimer); warpTimer = setTimeout(renderWarp, 30); }); $(id).addEventListener('change', function () { clearTimeout(warpTimer); warpTimer = setTimeout(renderWarp, 30); }); });
  hold($('wHold'), function () { $('cWarp').getContext('2d').drawImage(work, 0, 0); }, function () { renderWarp(); });

  window.__labReady = true;
  window.__faceLab = { faces: function () { return faces; }, work: function () { return work; }, setAmounts: function (o) { Object.keys(o).forEach(function (k) { $(k).value = o[k]; }); renderSkin(); renderWarp(); } };
})();
