/* LocalEditor background remover: inference worker (loaded by assets/js/le-bgremove.js, only when a cut-out is asked for).
 *
 * Owns onnxruntime-web, the model session and every pixel-heavy step (resize, normalise, run, upscale the mask,
 * edge refinement, foreground decontamination, compose). The page only sends bytes and an ImageBitmap, so the UI
 * thread never blocks. Classic worker (importScripts) so it runs everywhere a worker does.
 *
 * Messages in:  { id, type: 'init' | 'run' | 'dispose', ... }
 * Messages out: { id, ok: true, ... } or { id, ok: false, error }, plus { type: 'progress', id, stage }.
 */
(function () {
  'use strict';

  var ort = null, session = null, spec = null, ep = 'wasm', inName = '', outName = '';

  function post(id, ok, payload, transfer) {
    var msg = payload || {};
    msg.id = id; msg.ok = ok;
    self.postMessage(msg, transfer || []);
  }
  /* ORT-web sometimes throws a bare number (a wasm exception pointer); it almost always means the wasm heap ran out. */
  function explain(e) {
    if (typeof e === 'number') return 'ONNX Runtime error code ' + e + ' (usually out of memory in the 32-bit WASM heap)';
    return String(e && e.message || e);
  }
  function now() { return self.performance.now(); }

  /* ---------- init ---------- */
  async function init(m) {
    var t0 = now();
    spec = m.model;
    var wantGpu = m.ep === 'webgpu' || (m.ep === 'auto' && !!self.navigator.gpu && !!m.webgpuBase);
    if (wantGpu) {
      try {
        var adapter = self.navigator.gpu ? await self.navigator.gpu.requestAdapter() : null;
        if (!adapter) throw new Error('No WebGPU adapter');
        importScripts(m.webgpuBase + 'ort.webgpu.min.js');
        ort = self.ort;
        ort.env.wasm.wasmPaths = { mjs: m.webgpuBase + 'ort-wasm-simd-threaded.jsep.module.js', wasm: m.webgpuBase + 'ort-wasm-simd-threaded.jsep.wasm' };
        ep = 'webgpu';
      } catch (e) {
        if (m.ep === 'webgpu') throw e;
        ort = null; wantGpu = false;
      }
    }
    if (!ort) {
      importScripts(m.ortBase + 'ort.wasm.min.js');
      ort = self.ort;
      /* The loader is hosted as .module.js (not .mjs) so every static host sends a JavaScript MIME type for it. */
      ort.env.wasm.wasmPaths = { mjs: m.ortBase + 'ort-wasm-simd-threaded.module.js', wasm: m.ortBase + 'ort-wasm-simd-threaded.wasm' };
      ep = 'wasm';
    }
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    var threads = (self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') ? Math.max(1, m.threads || 1) : 1;
    ort.env.wasm.numThreads = threads;
    var t1 = now();
    try {
      session = await ort.InferenceSession.create(new Uint8Array(m.bytes), {
        executionProviders: [ep],
        graphOptimizationLevel: m.graphOpt || 'all'
      });
    } catch (e) { throw new Error('session create failed: ' + explain(e)); }
    inName = session.inputNames[0];
    outName = session.outputNames[0];
    var t2 = now();
    /* Warm-up: the first run pays one-off kernel set-up, so keep it out of the "inference" number. */
    var s = spec.size;
    var zero = new ort.Tensor('float32', new Float32Array(3 * s * s), [1, 3, s, s]);
    var feeds = {}; feeds[inName] = zero;
    var tw = now();
    try { await session.run(feeds); } catch (e) { throw new Error('warm-up run failed: ' + explain(e)); }
    var t3 = now();
    return { ep: ep, threads: ep === 'wasm' ? threads : 1, isolated: !!self.crossOriginIsolated,
      timings: { runtimeMs: t1 - t0, sessionMs: t2 - t1, warmupMs: t3 - tw } };
  }

  /* ---------- pixel helpers ---------- */

  /* Sliding-window box blur, edge-clamped (divides by the real window size). src/dst are Float32Array w*h, can be the same. */
  function boxBlur(src, w, h, r, dst, tmp) {
    var x, y, i, sum, n, lo, hi;
    tmp = tmp || new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var row = y * w;
      sum = 0;
      for (x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
      for (x = 0; x < w; x++) {
        lo = Math.max(0, x - r); hi = Math.min(w - 1, x + r);
        tmp[row + x] = sum / (hi - lo + 1);
        if (x + r + 1 < w) sum += src[row + x + r + 1];
        if (x - r >= 0) sum -= src[row + x - r];
      }
    }
    var col = new Float32Array(h), colOut = new Float32Array(h);
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) col[y] = tmp[y * w + x];
      sum = 0;
      for (i = 0; i <= Math.min(r, h - 1); i++) sum += col[i];
      for (y = 0; y < h; y++) {
        lo = Math.max(0, y - r); hi = Math.min(h - 1, y + r);
        colOut[y] = sum / (hi - lo + 1);
        if (y + r + 1 < h) sum += col[y + r + 1];
        if (y - r >= 0) sum -= col[y - r];
      }
      for (y = 0; y < h; y++) dst[y * w + x] = colOut[y];
    }
    return dst;
  }

  /* Bilinear resample of a Float32 plane. */
  function resizePlane(src, sw, sh, dw, dh, dst) {
    dst = dst || new Float32Array(dw * dh);
    var xs = new Int32Array(dw), xf = new Float32Array(dw), x, y;
    var rx = sw / dw, ry = sh / dh;
    for (x = 0; x < dw; x++) {
      var fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * rx - 0.5));
      xs[x] = Math.min(sw - 2 < 0 ? 0 : sw - 2, Math.floor(fx)); xf[x] = fx - xs[x];
      if (sw < 2) xf[x] = 0;
    }
    for (y = 0; y < dh; y++) {
      var fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * ry - 0.5));
      var y0 = Math.min(sh - 2 < 0 ? 0 : sh - 2, Math.floor(fy)), wy = sh < 2 ? 0 : fy - y0;
      var y1 = Math.min(sh - 1, y0 + 1);
      var r0 = y0 * sw, r1 = y1 * sw, o = y * dw;
      for (x = 0; x < dw; x++) {
        var x0 = xs[x], x1 = Math.min(sw - 1, x0 + 1), wx = xf[x];
        var a = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * wx;
        var b = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * wx;
        dst[o + x] = a + (b - a) * wy;
      }
    }
    return dst;
  }

  /* Area-average downsample by an integer factor. */
  function downsample(src, w, h, s) {
    var dw = Math.max(1, Math.floor(w / s)), dh = Math.max(1, Math.floor(h / s));
    var out = new Float32Array(dw * dh), x, y, i, j;
    var inv = 1 / (s * s);
    for (y = 0; y < dh; y++) for (x = 0; x < dw; x++) {
      var sum = 0;
      for (j = 0; j < s; j++) {
        var row = Math.min(h - 1, y * s + j) * w;
        for (i = 0; i < s; i++) sum += src[row + Math.min(w - 1, x * s + i)];
      }
      out[y * dw + x] = sum * inv;
    }
    return { data: out, w: dw, h: dh };
  }

  /* Fast guided filter (He & Sun): luminance guide, mask as the input. Runs the heavy part at 1/s resolution. */
  function guidedFilter(I, p, w, h, radius, eps, s) {
    var Id = downsample(I, w, h, s), pd = downsample(p, w, h, s);
    var dw = Id.w, dh = Id.h, n = dw * dh, r = Math.max(1, Math.round(radius / s)), i;
    var tmp = new Float32Array(n);
    var mI = boxBlur(Id.data, dw, dh, r, new Float32Array(n), tmp);
    var mp = boxBlur(pd.data, dw, dh, r, new Float32Array(n), tmp);
    var II = new Float32Array(n), Ip = new Float32Array(n);
    for (i = 0; i < n; i++) { II[i] = Id.data[i] * Id.data[i]; Ip[i] = Id.data[i] * pd.data[i]; }
    var mII = boxBlur(II, dw, dh, r, II, tmp), mIp = boxBlur(Ip, dw, dh, r, Ip, tmp);
    var a = new Float32Array(n), b = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var varI = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i];
      a[i] = cov / (varI + eps);
      b[i] = mp[i] - a[i] * mI[i];
    }
    var ma = boxBlur(a, dw, dh, r, a, tmp), mb = boxBlur(b, dw, dh, r, b, tmp);
    var A = resizePlane(ma, dw, dh, w, h), B = resizePlane(mb, dw, dh, w, h);
    var q = new Float32Array(w * h);
    for (i = 0; i < q.length; i++) { var v = A[i] * I[i] + B[i]; q[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
    return q;
  }

  /* Blur-fusion foreground estimate (Forte & Pitie 2021, one pass): removes the old background colour from edge pixels. */
  function decontaminate(rgba, alpha, w, h, r) {
    var n = w * h, c, i, tmp = new Float32Array(n);
    var inv = new Float32Array(n), ab = new Float32Array(n), ib = new Float32Array(n);
    for (i = 0; i < n; i++) inv[i] = 1 - alpha[i];
    boxBlur(alpha, w, h, r, ab, tmp);
    boxBlur(inv, w, h, r, ib, tmp);
    var plane = new Float32Array(n), fb = new Float32Array(n), bb = new Float32Array(n);
    var Fb = [], Bb = [];
    for (c = 0; c < 3; c++) {
      for (i = 0; i < n; i++) plane[i] = rgba[i * 4 + c] / 255 * alpha[i];
      boxBlur(plane, w, h, r, fb, tmp);
      var f = new Float32Array(n);
      for (i = 0; i < n; i++) f[i] = ab[i] > 1e-4 ? fb[i] / ab[i] : 0;
      Fb.push(f);
      for (i = 0; i < n; i++) plane[i] = rgba[i * 4 + c] / 255 * inv[i];
      boxBlur(plane, w, h, r, bb, tmp);
      var b = new Float32Array(n);
      for (i = 0; i < n; i++) b[i] = ib[i] > 1e-4 ? bb[i] / ib[i] : 0;
      Bb.push(b);
    }
    for (i = 0; i < n; i++) {
      var al = alpha[i];
      if (al >= 0.999 || al <= 0.001) continue; /* fully inside or outside: colour is already right (or invisible) */
      for (c = 0; c < 3; c++) {
        var I = rgba[i * 4 + c] / 255;
        var F = Fb[c][i] + al * (I - al * Fb[c][i] - (1 - al) * Bb[c][i]);
        rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(F * 255)));
      }
    }
  }

  /* Mean image-gradient magnitude along the mask edge: higher = the cut follows real edges. */
  function edgeScore(lum, alpha, w, h) {
    var sum = 0, cnt = 0, x, y;
    for (y = 1; y < h - 1; y += 1) {
      for (x = 1; x < w - 1; x += 1) {
        var i = y * w + x;
        var ga = Math.abs(alpha[i + 1] - alpha[i - 1]) + Math.abs(alpha[i + w] - alpha[i - w]);
        if (ga < 0.04) continue;
        var gl = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
        sum += gl * ga; cnt += ga;
      }
    }
    return cnt ? sum / cnt : 0;
  }

  /* Drop small islands (stray blobs the model picked up away from the subject): connected components on a coarse grid,
     anything under `frac` of the largest component is cleared, with a one-cell margin for its soft edge. */
  function despeckle(alpha, w, h, frac) {
    var f = Math.max(1, Math.round(Math.max(w, h) / 480));
    var gw = Math.ceil(w / f), gh = Math.ceil(h / f), gn = gw * gh, x, y, i;
    var on = new Uint8Array(gn), lab = new Int32Array(gn), sizes = [0];
    for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) {
      var px = Math.min(w - 1, x * f + (f >> 1)), py = Math.min(h - 1, y * f + (f >> 1));
      on[y * gw + x] = alpha[py * w + px] > 0.5 ? 1 : 0;
    }
    var stack = new Int32Array(gn), next = 0;
    for (i = 0; i < gn; i++) {
      if (!on[i] || lab[i]) continue;
      next++; var top = 0, size = 0;
      stack[top++] = i; lab[i] = next;
      while (top) {
        var j = stack[--top]; size++;
        var jx = j % gw, jy = (j / gw) | 0;
        if (jx > 0 && on[j - 1] && !lab[j - 1]) { lab[j - 1] = next; stack[top++] = j - 1; }
        if (jx < gw - 1 && on[j + 1] && !lab[j + 1]) { lab[j + 1] = next; stack[top++] = j + 1; }
        if (jy > 0 && on[j - gw] && !lab[j - gw]) { lab[j - gw] = next; stack[top++] = j - gw; }
        if (jy < gh - 1 && on[j + gw] && !lab[j + gw]) { lab[j + gw] = next; stack[top++] = j + gw; }
      }
      sizes.push(size);
    }
    if (!next) return 0;
    var big = Math.max.apply(null, sizes), dropped = 0;
    var keep = new Uint8Array(gn);
    for (i = 0; i < gn; i++) if (lab[i] && sizes[lab[i]] >= big * frac) keep[i] = 1;
    for (i = 1; i <= next; i++) if (sizes[i] < big * frac) dropped++;
    /* Keep pixels within two cells of a kept component (its soft edge); clear faint haze and small islands elsewhere. */
    var near = new Uint8Array(gn), R = 2;
    for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) {
      if (!keep[y * gw + x]) continue;
      for (var yy = Math.max(0, y - R); yy <= Math.min(gh - 1, y + R); yy++) for (var xx = Math.max(0, x - R); xx <= Math.min(gw - 1, x + R); xx++) near[yy * gw + xx] = 1;
    }
    for (y = 0; y < h; y++) {
      var row = ((y / f) | 0) * gw;
      for (x = 0; x < w; x++) if (!near[row + ((x / f) | 0)]) alpha[y * w + x] = 0;
    }
    return dropped;
  }

  /* ---------- run ---------- */
  async function run(m) {
    var t = {}, T = now(), bmp = m.bitmap, o = m.opts || {};
    var W = bmp.width, H = bmp.height;
    var maxSide = o.maxSide || 2560;
    var k = Math.min(1, maxSide / Math.max(W, H));
    var w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    var s = spec.size, n = w * h, i;

    /* 1. full-size pixels (scaled down only when over the cap) */
    var full = new OffscreenCanvas(w, h);
    var fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(bmp, 0, 0, w, h);
    var img = fctx.getImageData(0, 0, w, h);
    t.decodeMs = now() - T; T = now();

    /* 2. resize + normalise to the model input */
    var small = new OffscreenCanvas(s, s);
    var sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(full, 0, 0, s, s);
    var px = sctx.getImageData(0, 0, s, s).data;
    var plane = s * s, input = new Float32Array(3 * plane), mean = spec.mean, std = spec.std;
    for (i = 0; i < plane; i++) {
      input[i] = (px[i * 4] / 255 - mean[0]) / std[0];
      input[plane + i] = (px[i * 4 + 1] / 255 - mean[1]) / std[1];
      input[2 * plane + i] = (px[i * 4 + 2] / 255 - mean[2]) / std[2];
    }
    t.preMs = now() - T; T = now();

    /* 3. inference */
    var feeds = {}; feeds[inName] = new ort.Tensor('float32', input, [1, 3, s, s]);
    var out = await session.run(feeds);
    var o0 = out[outName];
    var raw = o0.data;
    t.inferMs = now() - T; T = now();

    /* 4. sigmoid (when the model outputs logits) + min-max normalise */
    var m0 = new Float32Array(plane), mn = Infinity, mx = -Infinity;
    for (i = 0; i < plane; i++) {
      var v = raw[i];
      if (spec.sigmoid) v = 1 / (1 + Math.exp(-v));
      m0[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    var span = mx - mn || 1;
    for (i = 0; i < plane; i++) m0[i] = (m0[i] - mn) / span;
    if (o.debugRaw) t.raw = { min: mn, max: mx, dims: o0.dims.slice() };
    if (o0.dispose) o0.dispose();

    /* 5. upscale the mask (bilinear) */
    var alpha = resizePlane(m0, s, s, w, h);
    t.upMs = now() - T; T = now();

    /* 6. refinement */
    var lum = null;
    function getLum() {
      if (lum) return lum;
      lum = new Float32Array(n);
      var d = img.data;
      for (var j = 0; j < n; j++) lum[j] = (0.299 * d[j * 4] + 0.587 * d[j * 4 + 1] + 0.114 * d[j * 4 + 2]) / 255;
      return lum;
    }
    var st = {};
    if (o.stats) st.edgeBefore = edgeScore(getLum(), alpha, w, h);
    var refine = o.refine || 'none';
    if (refine === 'guided') {
      var rad = o.radius || Math.max(4, Math.round(Math.max(w, h) * 0.006));
      var sub = Math.max(1, Math.min(8, Math.round(Math.max(w, h) / 500)));
      alpha = guidedFilter(getLum(), alpha, w, h, rad, o.eps || 1e-4, sub);
    }
    if (o.feather > 0) {
      var tmp2 = new Float32Array(n);
      boxBlur(alpha, w, h, Math.max(1, Math.round(o.feather)), alpha, tmp2);
      boxBlur(alpha, w, h, Math.max(1, Math.round(o.feather)), alpha, tmp2);
    }
    if (o.harden) { /* contrast curve: values under lo go to 0, over hi go to 1 */
      var lo = o.harden[0], hi = o.harden[1], inv = 1 / Math.max(1e-4, hi - lo);
      for (i = 0; i < n; i++) { var q = (alpha[i] - lo) * inv; q = q < 0 ? 0 : q > 1 ? 1 : q; alpha[i] = q * q * (3 - 2 * q); }
    }
    if (o.despeckle) despeckle(alpha, w, h, o.despeckle);
    if (o.stats) st.edgeAfter = edgeScore(getLum(), alpha, w, h);
    /* Coverage: the share of clearly opaque pixels. Under 3 % or over 97 % means "no clear subject". */
    var solid = 0;
    for (i = 0; i < n; i++) if (alpha[i] > 0.5) solid++;
    st.coverage = solid / n;
    t.refineMs = now() - T; T = now();

    /* 7. compose */
    var rgba = img.data;
    if (o.maskOnly) {
      var mOnly = new Uint8ClampedArray(n);
      for (i = 0; i < n; i++) mOnly[i] = Math.round(alpha[i] * 255);
      t.composeMs = now() - T; t.totalMs = Object.keys(t).reduce(function (a2, kk) { return a2 + (typeof t[kk] === 'number' ? t[kk] : 0); }, 0);
      if (bmp.close) bmp.close();
      return { payload: { width: w, height: h, mask: mOnly.buffer, cut: null, timings: t, stats: st, raw: t.raw }, transfer: [mOnly.buffer] };
    }
    if (o.decontaminate) decontaminate(rgba, alpha, w, h, Math.max(2, Math.round(Math.max(w, h) / 160)));
    var maskData = new Uint8ClampedArray(n);
    for (i = 0; i < n; i++) {
      var a = Math.round(alpha[i] * 255);
      maskData[i] = a;
      rgba[i * 4 + 3] = a;
    }
    fctx.putImageData(img, 0, 0);
    var cut = full.transferToImageBitmap();
    t.composeMs = now() - T; t.totalMs = Object.keys(t).reduce(function (a2, kk) { return a2 + (typeof t[kk] === 'number' ? t[kk] : 0); }, 0);
    if (bmp.close) bmp.close();
    return { payload: { width: w, height: h, mask: maskData.buffer, cut: cut, timings: t, stats: st, raw: t.raw }, transfer: [maskData.buffer, cut] };
  }

  self.onmessage = function (e) {
    var m = e.data;
    var job;
    if (m.type === 'init') job = init(m).then(function (r) { post(m.id, true, r); });
    else if (m.type === 'run') job = run(m).then(function (r) { post(m.id, true, r.payload, r.transfer); });
    else if (m.type === 'dispose') {
      job = (session && session.release ? session.release() : Promise.resolve()).then(function () { session = null; post(m.id, true, {}); });
    } else return;
    job.catch(function (err) { post(m.id, false, { error: explain(err) }); });
  };
})();
