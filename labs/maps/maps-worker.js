/* LocalEditor maps: inference worker (labs/maps/maps.js starts it; one worker per kind, 'depth' or 'face').
 *
 * Owns onnxruntime-web (the WASM build already shipped in assets/vendor/ort/, never a CDN) and every pixel-heavy step:
 *   depth: resize to the model grid, run, robust-normalise, optional guided edge refinement against the photo.
 *   face : BlazeFace detection (full frame and tiles), rotated face crop, 478-point landmarks (two passes), optional 52
 *          blendshapes, optional multi-class person segmentation (hair / body skin / face skin / clothes) per face.
 * Classic worker (importScripts), same message envelope as le-bgremove-worker.js:
 *   in : { id, type: 'init' | 'depth' | 'refine' | 'face' | 'dispose', ... }
 *   out: { id, ok: true, ... } | { id, ok: false, error }, plus { type: 'progress', id, stage }.
 */
(function () {
  'use strict';

  var ort = null, kind = '', sessions = {}, specs = {}, ep = 'wasm';

  function now() { return self.performance.now(); }
  function post(id, ok, payload, transfer) { var m = payload || {}; m.id = id; m.ok = ok; self.postMessage(m, transfer || []); }
  function progress(id, stage) { self.postMessage({ type: 'progress', id: id, stage: stage }); }
  function explain(e) {
    if (typeof e === 'number') return 'ONNX Runtime error code ' + e + ' (usually out of memory in the 32-bit WASM heap)';
    return String(e && e.message || e);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- init ---------- */
  async function init(m) {
    var t0 = now();
    kind = m.kind;
    ep = 'wasm';
    if (m.ep === 'webgpu' && m.webgpuBase) {
      /* Optional: the WebGPU build another engineer vendors into assets/vendor/ort-webgpu/ (git-ignored, fetched by scripts/fetch-models.js --webgpu). */
      var adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter() : null;
      if (!adapter) throw new Error('No WebGPU adapter');
      importScripts(m.webgpuBase + 'ort.webgpu.min.js');
      ort = self.ort;
      ort.env.wasm.wasmPaths = { mjs: m.webgpuBase + 'ort-wasm-simd-threaded.jsep.module.js', wasm: m.webgpuBase + 'ort-wasm-simd-threaded.jsep.wasm' };
      ep = 'webgpu';
    } else {
      importScripts(m.ortBase + 'ort.wasm.min.js');
      ort = self.ort;
      ort.env.wasm.wasmPaths = { mjs: m.ortBase + 'ort-wasm-simd-threaded.module.js', wasm: m.ortBase + 'ort-wasm-simd-threaded.wasm' };
    }
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    var threads = (self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') ? Math.max(1, m.threads || 1) : 1;
    ort.env.wasm.numThreads = threads;
    var t1 = now(), warm = {};
    specs = m.specs;
    for (var key in m.bytes) {
      try {
        sessions[key] = await ort.InferenceSession.create(new Uint8Array(m.bytes[key]), { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
      } catch (e) { throw new Error('session create failed (' + key + '): ' + explain(e)); }
    }
    var t2 = now();
    /* Warm-up run per session, so one-off kernel set-up is not charged to the first photo. */
    for (var k in sessions) {
      var s = sessions[k], sp = specs[k] || {}, feeds = {}, n = s.inputNames[0], t = now();
      try {
        if (k === 'depth') feeds[n] = new ort.Tensor('float32', new Float32Array(3 * sp.warm * sp.warm), [1, 3, sp.warm, sp.warm]);
        else if (k === 'detector') feeds[n] = new ort.Tensor('float32', new Float32Array(128 * 128 * 3), [1, 128, 128, 3]);
        else if (k === 'landmarks' || k === 'parts') feeds[n] = new ort.Tensor('float32', new Float32Array(256 * 256 * 3), [1, 256, 256, 3]);
        else if (k === 'blend') feeds[n] = new ort.Tensor('float32', new Float32Array(146 * 2), [1, 146, 2]);
        else continue;
        await s.run(feeds);
      } catch (e) { throw new Error('warm-up run failed (' + k + '): ' + explain(e)); }
      warm[k] = now() - t;
    }
    return { ep: ep, threads: threads, isolated: !!self.crossOriginIsolated, timings: { runtimeMs: t1 - t0, sessionMs: t2 - t1, warmupMs: warm } };
  }

  /* ---------- shared pixel helpers ---------- */
  function drawTo(bitmap, w, h) {
    var c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(bitmap, 0, 0, w, h);
    return { canvas: c, ctx: x };
  }
  function boxBlur(src, w, h, r, dst) {
    var x, y, i, sum, lo, hi, tmp = new Float32Array(w * h);
    dst = dst || new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var row = y * w; sum = 0;
      for (x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
      for (x = 0; x < w; x++) {
        lo = Math.max(0, x - r); hi = Math.min(w - 1, x + r);
        tmp[row + x] = sum / (hi - lo + 1);
        if (x + r + 1 < w) sum += src[row + x + r + 1];
        if (x - r >= 0) sum -= src[row + x - r];
      }
    }
    var col = new Float32Array(h), out = new Float32Array(h);
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) col[y] = tmp[y * w + x];
      sum = 0;
      for (i = 0; i <= Math.min(r, h - 1); i++) sum += col[i];
      for (y = 0; y < h; y++) {
        lo = Math.max(0, y - r); hi = Math.min(h - 1, y + r);
        out[y] = sum / (hi - lo + 1);
        if (y + r + 1 < h) sum += col[y + r + 1];
        if (y - r >= 0) sum -= col[y - r];
      }
      for (y = 0; y < h; y++) dst[y * w + x] = out[y];
    }
    return dst;
  }
  function resizePlane(src, sw, sh, dw, dh) {
    var dst = new Float32Array(dw * dh), rx = sw / dw, ry = sh / dh, x, y;
    var xs = new Int32Array(dw), xf = new Float32Array(dw);
    for (x = 0; x < dw; x++) {
      var fx = clamp((x + 0.5) * rx - 0.5, 0, sw - 1);
      xs[x] = Math.min(sw - 2 < 0 ? 0 : sw - 2, Math.floor(fx)); xf[x] = sw < 2 ? 0 : fx - xs[x];
    }
    for (y = 0; y < dh; y++) {
      var fy = clamp((y + 0.5) * ry - 0.5, 0, sh - 1), y0 = Math.min(sh - 2 < 0 ? 0 : sh - 2, Math.floor(fy)), wy = sh < 2 ? 0 : fy - y0;
      var y1 = Math.min(sh - 1, y0 + 1);
      for (x = 0; x < dw; x++) {
        var x0 = xs[x], x1 = Math.min(sw - 1, x0 + 1), wx = xf[x];
        var a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
        dst[y * dw + x] = (a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy;
      }
    }
    return dst;
  }
  /* He and Sun guided filter, gray guide, box radius r, regulariser eps. a, b are computed on the full grid. */
  function guidedFilter(guide, p, w, h, r, eps) {
    var n = w * h, i;
    var mI = boxBlur(guide, w, h, r), mP = boxBlur(p, w, h, r);
    var IP = new Float32Array(n), II = new Float32Array(n);
    for (i = 0; i < n; i++) { IP[i] = guide[i] * p[i]; II[i] = guide[i] * guide[i]; }
    var mIP = boxBlur(IP, w, h, r), mII = boxBlur(II, w, h, r);
    var a = new Float32Array(n), b = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var varI = mII[i] - mI[i] * mI[i], cov = mIP[i] - mI[i] * mP[i];
      a[i] = cov / (varI + eps); b[i] = mP[i] - a[i] * mI[i];
    }
    var ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r), out = new Float32Array(n);
    for (i = 0; i < n; i++) out[i] = ma[i] * guide[i] + mb[i];
    return out;
  }

  /* ================================================================ depth ================================================================ */

  function percentile(arr, q) {
    var step = Math.max(1, Math.floor(arr.length / 20000)), s = [];
    for (var i = 0; i < arr.length; i += step) s.push(arr[i]);
    s.sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  }

  /* o: { side, grid ('14' for ViT models, '32' for conv models), fixed (model has a fixed input size), mean, std } */
  async function runDepth(m) {
    var sp = specs.depth, t0 = now();
    var bmp = m.bitmap, W = bmp.width, H = bmp.height, side = m.side || sp.side;
    var grid = sp.grid || 14, w, h;
    if (sp.fixed) { w = h = sp.fixed; }
    else {
      var k = side / Math.max(W, H);
      w = Math.max(grid, Math.round(W * k / grid) * grid); h = Math.max(grid, Math.round(H * k / grid) * grid);
    }
    var cv = drawTo(bmp, w, h), px = cv.ctx.getImageData(0, 0, w, h).data, n = w * h;
    var inp = new Float32Array(3 * n), mean = sp.mean, std = sp.std;
    for (var i = 0; i < n; i++) {
      inp[i] = (px[i * 4] / 255 - mean[0]) / std[0];
      inp[n + i] = (px[i * 4 + 1] / 255 - mean[1]) / std[1];
      inp[2 * n + i] = (px[i * 4 + 2] / 255 - mean[2]) / std[2];
    }
    var t1 = now(), s = sessions.depth, feeds = {};
    feeds[s.inputNames[0]] = new ort.Tensor('float32', inp, [1, 3, h, w]);
    var res;
    try { res = await s.run(feeds); } catch (e) { throw new Error('inference failed: ' + explain(e)); }
    var out = res[s.outputNames[0]], dims = out.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1];
    var raw = out.data;
    var t2 = now();
    /* Robust normalisation: 1st and 99th percentile become 0 and 1; larger = nearer (these models predict relative inverse depth). */
    var lo = percentile(raw, 0.01), hi = percentile(raw, 0.99);
    if (!(hi - lo > 1e-6)) hi = lo + 1;
    var d = new Float32Array(ow * oh), inv = 1 / (hi - lo);
    for (i = 0; i < d.length; i++) d[i] = clamp((raw[i] - lo) * inv, 0, 1);
    var info = { width: ow, height: oh, inputWidth: w, inputHeight: h, rawLo: lo, rawHi: hi, timings: { prepMs: t1 - t0, inferMs: t2 - t1, postMs: now() - t2 } };
    return { depth: d, info: info };
  }

  /* Guided refinement: bilinear upsample to the photo grid, then a guided filter with the photo's luminance as the guide. */
  function refineDepth(m) {
    var t0 = now(), bmp = m.bitmap, W = bmp.width, H = bmp.height;
    var cv = drawTo(bmp, W, H), px = cv.ctx.getImageData(0, 0, W, H).data, n = W * H, g = new Float32Array(n);
    for (var i = 0; i < n; i++) g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    var up = resizePlane(new Float32Array(m.depth), m.dw, m.dh, W, H);
    var r = Math.max(2, Math.round(m.radius * Math.max(W, H) / 1000)), out = guidedFilter(g, up, W, H, r, m.eps);
    for (i = 0; i < n; i++) out[i] = clamp(out[i], 0, 1);
    return { depth: out, width: W, height: H, ms: now() - t0 };
  }

  /* ================================================================ face ================================================================ */

  var ANCHORS = null;
  function anchors() {
    if (ANCHORS) return ANCHORS;
    var a = [];
    [[16, 2], [8, 6]].forEach(function (g) {
      for (var y = 0; y < g[0]; y++) for (var x = 0; x < g[0]; x++) for (var k = 0; k < g[1]; k++) a.push([(x + 0.5) / g[0], (y + 0.5) / g[0]]);
    });
    return (ANCHORS = a);
  }
  function sigmoid(v) { return 1 / (1 + Math.exp(-clamp(v, -80, 80))); }

  /* The 146 landmark indices the blendshape model reads (read out of the MediaPipe Tasks WASM data section, 146 entries). */
  var BLEND_IDX = [0, 1, 4, 5, 6, 7, 8, 10, 13, 14, 17, 21, 33, 37, 39, 40, 46, 52, 53, 54, 55, 58, 61, 63, 65, 66, 67, 70, 78, 80, 81, 82, 84, 87, 88, 91, 93, 95, 103, 105, 107, 109, 127, 132, 133, 136, 144, 145, 146, 148, 149, 150, 152, 153, 154, 155, 157, 158, 159, 160, 161, 162, 163, 168, 172, 173, 176, 178, 181, 185, 191, 195, 197, 234, 246, 249, 251, 263, 267, 269, 270, 276, 282, 283, 284, 285, 288, 291, 293, 295, 296, 297, 300, 308, 310, 311, 312, 314, 317, 318, 321, 323, 324, 332, 334, 336, 338, 356, 361, 362, 365, 373, 374, 375, 377, 378, 379, 380, 381, 382, 384, 385, 386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 415, 454, 466, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477];
  var BLEND_NAMES = ['_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight'];

  /* A square, rotated crop of the source: centre (cx,cy), side `size`, x-axis unit vector (ax,ay) in source pixels.
     Returns the crop as a size x size canvas, drawn with bilinear filtering and black outside the image. */
  function cropRotated(bmp, cx, cy, size, ax, ay, out) {
    var c = new OffscreenCanvas(out, out), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#000'; x.fillRect(0, 0, out, out);
    var s = out / size;
    /* crop pixel (u,v) -> source: c + (u - out/2)/s * (ax,ay) + (v - out/2)/s * (-ay,ax); so source -> crop is the inverse. */
    /* source (X,Y) -> crop: rotate by the inverse of the face axes, scale, then translate so (cx,cy) lands in the middle. */
    var tx = out / 2 - (ax * s * cx + ay * s * cy), ty = out / 2 - (-ay * s * cx + ax * s * cy);
    x.setTransform(ax * s, -ay * s, ay * s, ax * s, tx, ty);
    x.drawImage(bmp, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0);
    return { canvas: c, ctx: x, data: x.getImageData(0, 0, out, out).data };
  }
  function toNHWC(data, n, scale, offset) {
    var f = new Float32Array(n * n * 3);
    for (var i = 0, j = 0; i < n * n; i++) { f[j++] = data[i * 4] * scale + offset; f[j++] = data[i * 4 + 1] * scale + offset; f[j++] = data[i * 4 + 2] * scale + offset; }
    return f;
  }

  function iou(a, b) {
    var x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
    var inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0), u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
    return u > 0 ? inter / u : 0;
  }
  function nms(list, thr) {
    list.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    list.forEach(function (d) { if (!keep.some(function (k) { return iou(k, d) > thr; })) keep.push(d); });
    return keep;
  }

  /* One detector pass over a square window of the source (x0,y0,side). Boxes are returned in source pixels. */
  async function detectWindow(bmp, wx, wy, ws, thr) {
    var c = new OffscreenCanvas(128, 128), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
    /* Letterbox: the window may extend past the image (full-frame pass); the empty part stays black like MediaPipe's zero border. */
    var sx = Math.max(0, wx), sy = Math.max(0, wy), ex = Math.min(bmp.width, wx + ws), ey = Math.min(bmp.height, wy + ws);
    if (ex <= sx || ey <= sy) return [];
    var k = 128 / ws;
    x.drawImage(bmp, sx, sy, ex - sx, ey - sy, (sx - wx) * k, (sy - wy) * k, (ex - sx) * k, (ey - sy) * k);
    var f = toNHWC(x.getImageData(0, 0, 128, 128).data, 128, 1 / 127.5, -1);
    var s = sessions.detector, feeds = {};
    feeds[s.inputNames[0]] = new ort.Tensor('float32', f, [1, 128, 128, 3]);
    var res = await s.run(feeds), reg = res[s.outputNames[0]], sc = res[s.outputNames[1]];
    if (reg.dims[2] !== 16) { var t = reg; reg = sc; sc = t; }
    var an = anchors(), out = [];
    for (var i = 0; i < an.length; i++) {
      var p = sigmoid(sc.data[i]);
      if (p < thr) continue;
      var o = i * 16, cx = an[i][0] + reg.data[o] / 128, cy = an[i][1] + reg.data[o + 1] / 128, bw = reg.data[o + 2] / 128, bh = reg.data[o + 3] / 128;
      var kp = [];
      for (var q = 0; q < 6; q++) kp.push([wx + (an[i][0] + reg.data[o + 4 + q * 2] / 128) * ws, wy + (an[i][1] + reg.data[o + 5 + q * 2] / 128) * ws]);
      out.push({ score: p, x0: wx + (cx - bw / 2) * ws, y0: wy + (cy - bh / 2) * ws, x1: wx + (cx + bw / 2) * ws, y1: wy + (cy + bh / 2) * ws, kp: kp });
    }
    return nms(out, 0.3);
  }

  async function detectFaces(bmp, maxFaces, scan, onStage) {
    var W = bmp.width, H = bmp.height, L = Math.max(W, H), found = [];
    /* Pass 1: the whole frame, letterboxed. */
    found = found.concat(await detectWindow(bmp, (W - L) / 2, (H - L) / 2, L, 0.5));
    /* Pass 2: overlapping square tiles so small faces (group photos, far subjects) reach the detector at a usable size.
       Each tile is read at 128 px: a face needs to be about 12 px or more across inside the tile to be seen. */
    if (scan) {
      var tiles = [0.5, 0.34];
      for (var ti = 0; ti < tiles.length; ti++) {
        var ts = Math.max(64, Math.min(L, Math.round(L * tiles[ti])));
        var step = ts / 2, nx = Math.max(1, Math.ceil((W - ts) / step) + 1), ny = Math.max(1, Math.ceil((H - ts) / step) + 1);
        for (var iy = 0; iy < ny; iy++) for (var ix = 0; ix < nx; ix++) {
          var wx = nx === 1 ? (W - ts) / 2 : Math.min(W - ts, ix * step), wy = ny === 1 ? (H - ts) / 2 : Math.min(H - ts, iy * step);
          found = found.concat(await detectWindow(bmp, wx, wy, ts, 0.7)); /* tile hits at 0.6 to 0.67 were mostly background (8 of 90 test photos); real small faces score above 0.7 */
        }
      }
    }
    var keep = nms(found, 0.35);
    return keep.slice(0, maxFaces);
  }

  /* ROI from the detector: eye line gives the rotation, the box gives centre and scale (MediaPipe: square, 1.5x the long side). */
  function roiFromDetection(d) {
    var e0 = d.kp[0], e1 = d.kp[1], dx = e1[0] - e0[0], dy = e1[1] - e0[1], len = Math.hypot(dx, dy) || 1;
    var bw = d.x1 - d.x0, bh = d.y1 - d.y0;
    return { cx: (d.x0 + d.x1) / 2, cy: (d.y0 + d.y1) / 2, size: Math.max(bw, bh) * 1.5, ax: dx / len, ay: dy / len };
  }
  /* ROI from landmarks (pass 2): rotation from the outer eye corners (33, 263), centre and extent from the rotated bounding box. */
  function roiFromLandmarks(L) {
    var a = L[33], b = L[263], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, ax = dx / len, ay = dy / len;
    var minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
    for (var i = 0; i < 468; i++) {
      var u = L[i][0] * ax + L[i][1] * ay, v = -L[i][0] * ay + L[i][1] * ax;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    var cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
    return { cx: cu * ax - cv * ay, cy: cu * ay + cv * ax, size: Math.max(maxU - minU, maxV - minV) * 1.5, ax: ax, ay: ay };
  }

  async function landmarksFor(bmp, roi) {
    var cr = cropRotated(bmp, roi.cx, roi.cy, roi.size, roi.ax, roi.ay, 256);
    var f = toNHWC(cr.data, 256, 1 / 255, 0), s = sessions.landmarks, feeds = {};
    feeds[s.inputNames[0]] = new ort.Tensor('float32', f, [1, 256, 256, 3]);
    var res = await s.run(feeds), lm = null, score = 1;
    s.outputNames.forEach(function (n) { var t = res[n]; if (t.data.length === 1434) lm = t.data; else if (t.data.length === 1 && t.dims.length === 4) score = sigmoid(t.data[0]); });
    var k = roi.size / 256, L = [];
    for (var i = 0; i < 478; i++) {
      var u = lm[i * 3] - 128, v = lm[i * 3 + 1] - 128;
      L.push([roi.cx + (u * roi.ax - v * roi.ay) * k, roi.cy + (u * roi.ay + v * roi.ax) * k, lm[i * 3 + 2] * k]);
    }
    return { L: L, score: score, crop: cr, raw: lm };
  }

  async function blendFor(raw) {
    var s = sessions.blend; if (!s) return null;
    var inp = new Float32Array(146 * 2);
    for (var i = 0; i < 146; i++) { inp[i * 2] = raw[BLEND_IDX[i] * 3]; inp[i * 2 + 1] = raw[BLEND_IDX[i] * 3 + 1]; }
    var feeds = {}; feeds[s.inputNames[0]] = new ort.Tensor('float32', inp, [1, 146, 2]);
    var res = await s.run(feeds), o = res[s.outputNames[0]].data, out = {};
    for (var j = 0; j < 52; j++) out[BLEND_NAMES[j]] = Math.round(o[j] * 1000) / 1000;
    return out;
  }

  /* Multi-class person segmentation on the (wider) face crop: classes 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 other.
     The crop is the landmark ROI widened by 1.35 so hair and neck are in frame. Returns soft face-skin and hair planes in crop space. */
  async function partsFor(bmp, roi) {
    var s = sessions.parts; if (!s) return null;
    var wide = { cx: roi.cx, cy: roi.cy, size: roi.size * 1.35, ax: roi.ax, ay: roi.ay };
    var cr = cropRotated(bmp, wide.cx, wide.cy, wide.size, wide.ax, wide.ay, 256);
    var f = toNHWC(cr.data, 256, 1 / 255, 0), feeds = {};
    feeds[s.inputNames[0]] = new ort.Tensor('float32', f, [1, 256, 256, 3]);
    var res = await s.run(feeds), lg = res[s.outputNames[0]].data, n = 256 * 256;
    var skin = new Uint8Array(n), hair = new Uint8Array(n), body = new Uint8Array(n), cloth = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 6, mx = -1e9, k;
      for (k = 0; k < 6; k++) if (lg[o + k] > mx) mx = lg[o + k];
      var sum = 0, e = [0, 0, 0, 0, 0, 0];
      for (k = 0; k < 6; k++) { e[k] = Math.exp(lg[o + k] - mx); sum += e[k]; }
      skin[i] = Math.round(255 * e[3] / sum); hair[i] = Math.round(255 * e[1] / sum); body[i] = Math.round(255 * e[2] / sum); cloth[i] = Math.round(255 * e[4] / sum);
    }
    return { skin: skin, hair: hair, body: body, clothes: cloth, roi: wide };
  }

  /* Paint a crop-space plane (256x256, 8-bit) back into an image-space accumulator (max-combine across faces). */
  function paintBack(acc, W, H, plane, roi) {
    var s = roi.size / 256, ax = roi.ax, ay = roi.ay;
    /* Forward map is cheaper: for every output pixel inside the rotated square, invert the crop transform. */
    var corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(function (c) { return [roi.cx + (c[0] * ax - c[1] * ay) * roi.size, roi.cy + (c[0] * ay + c[1] * ax) * roi.size]; });
    var x0 = Math.max(0, Math.floor(Math.min.apply(null, corners.map(function (c) { return c[0]; })))), x1 = Math.min(W - 1, Math.ceil(Math.max.apply(null, corners.map(function (c) { return c[0]; }))));
    var y0 = Math.max(0, Math.floor(Math.min.apply(null, corners.map(function (c) { return c[1]; })))), y1 = Math.min(H - 1, Math.ceil(Math.max.apply(null, corners.map(function (c) { return c[1]; }))));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var dx = x + 0.5 - roi.cx, dy = y + 0.5 - roi.cy;
      var u = (dx * ax + dy * ay) / s + 128 - 0.5, v = (-dx * ay + dy * ax) / s + 128 - 0.5;
      if (u < 0 || v < 0 || u > 255 || v > 255) continue;
      var iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv, iu1 = Math.min(255, iu + 1), iv1 = Math.min(255, iv + 1);
      var val = (plane[iv * 256 + iu] * (1 - fu) + plane[iv * 256 + iu1] * fu) * (1 - fv) + (plane[iv1 * 256 + iu] * (1 - fu) + plane[iv1 * 256 + iu1] * fu) * fv;
      if (val > acc[y * W + x]) acc[y * W + x] = val;
    }
  }

  async function runFace(m) {
    var t0 = now(), bmp = m.bitmap, W = bmp.width, H = bmp.height, o = m.opts || {};
    var dets = await detectFaces(bmp, o.maxFaces || 8, o.scan !== false);
    var t1 = now(), faces = [], skinAcc = (sessions.parts && o.parts !== false) ? new Float32Array(W * H) : null, hairAcc = skinAcc ? new Float32Array(W * H) : null;
    for (var di = 0; di < dets.length; di++) {
      var d = dets[di], roi = roiFromDetection(d);
      var r1 = await landmarksFor(bmp, roi);
      var r2 = roiFromLandmarks(r1.L), r = await landmarksFor(bmp, r2);
      if (r.score < 0.5) continue;
      var L = r.L, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (var i = 0; i < 468; i++) { minX = Math.min(minX, L[i][0]); maxX = Math.max(maxX, L[i][0]); minY = Math.min(minY, L[i][1]); maxY = Math.max(maxY, L[i][1]); }
      var face = {
        score: d.score, presence: r.score,
        box: { x: minX / W, y: minY / H, w: (maxX - minX) / W, h: (maxY - minY) / H },
        detectorBox: { x: d.x0 / W, y: d.y0 / H, w: (d.x1 - d.x0) / W, h: (d.y1 - d.y0) / H },
        rotation: Math.atan2(r2.ay, r2.ax),
        landmarks: L.map(function (p) { return [p[0] / W, p[1] / H, p[2] / W]; })
      };
      if (o.blendshapes !== false && sessions.blend) face.blendshapes = await blendFor(r.raw);
      if (skinAcc) {
        var pr = await partsFor(bmp, r2);
        paintBack(skinAcc, W, H, pr.skin, pr.roi); paintBack(hairAcc, W, H, pr.hair, pr.roi);
      }
      faces.push(face);
    }
    faces.sort(function (a, b) { return b.box.w * b.box.h - a.box.w * a.box.h; }); /* largest face first */
    var t2 = now(), res = { faces: faces, width: W, height: H, timings: { detectMs: t1 - t0, landmarksMs: t2 - t1 } };
    var transfer = [];
    if (skinAcc) {
      var s8 = new Uint8Array(W * H), h8 = new Uint8Array(W * H);
      for (var q = 0; q < s8.length; q++) { s8[q] = skinAcc[q]; h8[q] = hairAcc[q]; }
      res.skin = s8.buffer; res.hair = h8.buffer; transfer.push(res.skin, res.hair);
    }
    return { res: res, transfer: transfer };
  }

  /* ---------- message loop ---------- */
  self.onmessage = async function (e) {
    var m = e.data, id = m.id;
    try {
      if (m.type === 'init') post(id, true, await init(m));
      else if (m.type === 'depth') {
        var r = await runDepth(m);
        post(id, true, { depth: r.depth.buffer, info: r.info }, [r.depth.buffer]);
        try { m.bitmap.close(); } catch (e1) { /* ignore */ }
      } else if (m.type === 'refine') {
        var q = refineDepth(m);
        post(id, true, { depth: q.depth.buffer, width: q.width, height: q.height, ms: q.ms }, [q.depth.buffer]);
        try { m.bitmap.close(); } catch (e2) { /* ignore */ }
      } else if (m.type === 'face') {
        var f = await runFace(m);
        post(id, true, f.res, f.transfer);
        try { m.bitmap.close(); } catch (e3) { /* ignore */ }
      } else if (m.type === 'dispose') {
        for (var k in sessions) { try { await sessions[k].release(); } catch (e4) { /* ignore */ } }
        sessions = {}; post(id, true, {});
      } else post(id, false, { error: 'Unknown message ' + m.type });
    } catch (err) {
      post(id, false, { error: explain(err) });
    }
  };
})();
