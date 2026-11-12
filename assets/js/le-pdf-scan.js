/* LocalEditor: phone camera to clean scan (D10, "Scan with camera"). See docs/PDF-OCR-SCAN.md.
 *
 * Part 1, window.LE.scan: plain JS and canvas, no dependency except pdf-lib for the PDF (the lab at labs/scan/ uses it too).
 *   LE.scan.detect(source, { maxSide })                 -> { corners:[{x,y}x4 clockwise from top-left, source pixels], score, method, ms }
 *   LE.scan.warp(source, corners, { maxSide, aspect, maxSource }) -> canvas (perspective-corrected; aspect 'auto' | 'a4' | 'letter' | w/h)
 *   LE.scan.enhance(canvas, mode)                       -> canvas (in place) mode: 'none' | 'bw' | 'whiten' | 'gray' | 'color'
 *   LE.scan.exportPdf(pages, { size, quality, dpi })    -> Promise<Uint8Array>   pages: [{ canvas, mode }]
 *   LE.scan.exportBlobs(pages, { size, dpi, onProgress, signal }) -> Promise<Uint8Array>   pages: [{ out: Blob (JPEG, or PNG for 'bw'), mode, w, h }]
 *        one page decoded at a time: JPEG pages are embedded as they are, black-and-white pages are packed to 1 bit per pixel
 *   LE.scan.toSource(blobOrFile, { maxSide })           -> Promise<canvas>  (EXIF orientation applied, capped for memory)
 *   LE.scan.limits()                                    -> { maxSource, outSide, warnPages, maxPages, small }
 *   LE.scan.camera.supported() / start(video, opts) / capture(video) / stop(video)
 *   LE.scan.orderCorners(pts), LE.scan.aspectOf(corners, w, h), LE.scan.rotate90(canvas, quarterTurns)
 *
 * Part 2 (only inside the PDF studio): the "Scan with camera" workbench: capture or pick photos, adjust corners, straighten,
 * clean up, a page tray (reorder, retake, edit, delete), then a PDF, optionally made searchable (D9, le-pdf-ocr.js).
 *
 * Everything runs on the device; nothing is uploaded.
 */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {};

  /* ---------------------------------------------------------------- helpers */
  function srcSize(s) { return { w: s.naturalWidth || s.videoWidth || s.width, h: s.naturalHeight || s.videoHeight || s.height }; }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function ctx2(c) { return c.getContext('2d', { willReadFrequently: true }); }

  /* Clockwise from top-left (screen coordinates, y down). */
  function orderCorners(pts) {
    var cx = 0, cy = 0, i;
    for (i = 0; i < 4; i++) { cx += pts[i].x; cy += pts[i].y; }
    cx /= 4; cy /= 4;
    var p = pts.map(function (q) { return { x: q.x, y: q.y, a: Math.atan2(q.y - cy, q.x - cx) }; }).sort(function (a, b) { return a.a - b.a; });
    var k = 0, best = Infinity;
    for (i = 0; i < 4; i++) { var s = p[i].x + p[i].y; if (s < best) { best = s; k = i; } }
    var out = []; for (i = 0; i < 4; i++) { var q = p[(k + i) % 4]; out.push({ x: q.x, y: q.y }); }
    return out;
  }

  /* ---------------------------------------------------------------- detection */
  function gaussBlur(src, w, h, passes) {          /* cheap blur: repeated 3x3 box (approximates a Gaussian) */
    var a = src, b = new Float32Array(w * h), x, y, p, t;
    for (p = 0; p < passes; p++) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x, i = y * w;
        b[i + x] = (a[i + xm] + a[i + x] + a[i + xp]) / 3;
      }
      for (y = 0; y < h; y++) {
        var ym = (y > 0 ? y - 1 : y) * w, yp = (y < h - 1 ? y + 1 : y) * w, i2 = y * w;
        for (x = 0; x < w; x++) a[i2 + x] = (b[ym + x] + b[i2 + x] + b[yp + x]) / 3;
      }
    }
    return a;
  }

  function otsu(vals, n) {
    var hist = new Uint32Array(256), i;
    for (i = 0; i < n; i++) hist[Math.max(0, Math.min(255, vals[i] | 0))]++;
    var sum = 0, sumB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }

  /* 4-connected components of a binary mask; returns the biggest `keep` labels as arrays of boundary points + area. */
  function components(mask, w, h, keep, minArea) {
    var lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [], id = 0, i, x, y;
    for (i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      id++; var sp = 0, area = 0; stack[sp++] = i; lab[i] = id;
      var pts = [];
      while (sp) {
        var q = stack[--sp]; area++;
        x = q % w; y = (q / w) | 0;
        var edge = false;
        if (x > 0) { if (mask[q - 1]) { if (!lab[q - 1]) { lab[q - 1] = id; stack[sp++] = q - 1; } } else edge = true; } else edge = true;
        if (x < w - 1) { if (mask[q + 1]) { if (!lab[q + 1]) { lab[q + 1] = id; stack[sp++] = q + 1; } } else edge = true; } else edge = true;
        if (y > 0) { if (mask[q - w]) { if (!lab[q - w]) { lab[q - w] = id; stack[sp++] = q - w; } } else edge = true; } else edge = true;
        if (y < h - 1) { if (mask[q + w]) { if (!lab[q + w]) { lab[q + w] = id; stack[sp++] = q + w; } } else edge = true; } else edge = true;
        if (edge) pts.push(x, y);
      }
      if (area >= minArea) comps.push({ area: area, pts: pts });
    }
    comps.sort(function (a, b) { return b.area - a.area; });
    return comps.slice(0, keep);
  }

  function convexHull(flat) {                       /* Andrew's monotone chain on a flat [x,y,x,y..] list */
    var n = flat.length / 2, P = new Array(n), i;
    for (i = 0; i < n; i++) P[i] = [flat[2 * i], flat[2 * i + 1]];
    P.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    for (i = 0; i < n; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = n - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  function polyArea(p) { var a = 0, i; for (i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; }

  function lineX(a, b, c, d) {                      /* intersection of line ab and line cd */
    var d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = d[0] - c[0], d2y = d[1] - c[1], den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / den;
    return [a[0] + t * d1x, a[1] + t * d1y];
  }

  /* Smallest enclosing quadrilateral (greedy): repeatedly replace the hull edge whose removal adds the least area by extending its neighbours. */
  function hullToQuad(hull) {
    var p = hull.slice();
    if (p.length < 4) return null;
    while (p.length > 4) {
      var n = p.length, bestI = -1, bestAdd = Infinity, bestX = null, i;
      for (i = 0; i < n; i++) {
        var a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], d = p[(i + 2) % n];
        var X = lineX(a, b, c, d);
        if (!X) continue;
        /* X must lie beyond edge b-c on the outer side: check it is on the far side of both neighbours */
        var add = polyArea([b, X, c]);
        var side1 = (b[0] - a[0]) * (X[1] - a[1]) - (b[1] - a[1]) * (X[0] - a[0]), side2 = (d[0] - c[0]) * (X[1] - c[1]) - (d[1] - c[1]) * (X[0] - c[0]);
        if (add < bestAdd && isFinite(add) && side1 * side2 !== 0) { bestAdd = add; bestI = i; bestX = X; }
      }
      if (bestI < 0) {                              /* degenerate: drop the smallest-area vertex */
        var m = 0, ma = Infinity;
        for (i = 0; i < n; i++) { var ar = polyArea([p[(i - 1 + n) % n], p[i], p[(i + 1) % n]]); if (ar < ma) { ma = ar; m = i; } }
        p.splice(m, 1); continue;
      }
      var i1 = bestI, i2 = (bestI + 1) % n;
      p[i1] = bestX; p.splice(i2, 1);
    }
    return p;
  }

  function quadOK(q, w, h) {
    var i, ang;
    for (i = 0; i < 4; i++) {
      var a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      var v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
      var cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
      ang = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (ang < 50 || ang > 130) return false;
    }
    /* convex and not wildly outside the frame */
    var s = 0;
    for (i = 0; i < 4; i++) {
      var a2 = q[i], b2 = q[(i + 1) % 4], c2 = q[(i + 2) % 4], cr = (b2[0] - a2[0]) * (c2[1] - b2[1]) - (b2[1] - a2[1]) * (c2[0] - b2[0]);
      if (cr === 0) return false; if (!s) s = cr > 0 ? 1 : -1; else if ((cr > 0 ? 1 : -1) !== s) return false;
    }
    for (i = 0; i < 4; i++) if (q[i][0] < -w * 0.15 || q[i][0] > w * 1.15 || q[i][1] < -h * 0.15 || q[i][1] > h * 1.15) return false;
    return true;
  }

  /* Fraction of points along each quad edge that sit on a clear edge (strongest directional derivative within +-3 px across the edge).
   * q is clockwise on screen, so (-dy, dx) points inside. sign: +1 paper brighter than the background, -1 darker, 0 either. */
  function edgeSupport(q, gx, gy, w, h, thr, sign) {
    var per = [], e;
    for (e = 0; e < 4; e++) {
      var a = q[e], b = q[(e + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1), hit = 0, tot = 0, t;
      for (t = 0.04; t <= 0.96; t += Math.max(0.008, 2 / (L || 1))) {
        var x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, best = 0, o;
        if (x < 3 || y < 3 || x > w - 4 || y > h - 4) continue;       /* edges on the frame border are not evidence */
        for (o = -3; o <= 3; o++) {
          var xi = Math.round(x + nx * o), yi = Math.round(y + ny * o);
          if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
          var dd = gx[yi * w + xi] * nx + gy[yi * w + xi] * ny, d = sign === 0 ? Math.abs(dd) : sign * dd; if (d > best) best = d;
        }
        tot++; if (best > thr) hit++;
      }
      per.push(tot > 4 ? hit / tot : 0.1);
    }
    return per;
  }

  var SW = { mean: 0.4, min: 0.2, fill: 0.1, area: 0.3, areaRef: 0.5, dominance: false };   /* tuned on the synthetic test set, see docs/research/pdf-ocr-scan.md */
  function scoreQuad(q, w, h, gx, gy, thr, label, fill, out) {
    var qa = polyArea(q), frac = qa / (w * h);
    if (frac < 0.1 || frac > 0.995) return;
    var best = null, signs = [1, -1], i;
    for (i = 0; i < 2; i++) {
      var sup = edgeSupport(q, gx, gy, w, h, thr, signs[i]), mean = (sup[0] + sup[1] + sup[2] + sup[3]) / 4, mn = Math.min.apply(null, sup);
      if (!best || mean + mn > best.mean + best.mn) best = { mean: mean, mn: mn, sign: signs[i] };
    }
    /* quads hugging the frame have no usable edge evidence: do not let the default value win */
    var margin = 0; q.forEach(function (p) { margin += (p[0] < 4 || p[1] < 4 || p[0] > w - 4 || p[1] > h - 4) ? 1 : 0; });
    var score = SW.mean * best.mean + SW.min * best.mn + SW.fill * fill + SW.area * Math.min(1, frac / SW.areaRef);
    if (margin >= 3) score -= 0.12;
    out.push({ q: q, score: score, method: label, support: best.mean, minSupport: best.mn, fill: fill, frac: frac });
  }

  function candidateFromMask(mask, w, h, gx, gy, thr, label, out) {
    var comps = components(mask, w, h, 3, w * h * 0.1), k;
    for (k = 0; k < comps.length; k++) {
      var c = comps[k], hull = convexHull(c.pts), q = hullToQuad(hull);
      if (!q || !quadOK(q, w, h)) continue;
      var qo = orderCorners(q.map(function (p) { return { x: p[0], y: p[1] }; })).map(function (p) { return [p.x, p.y]; });
      scoreQuad(qo, w, h, gx, gy, thr, label, Math.min(1, c.area / polyArea(qo)), out);
    }
  }

  /* Straight-line candidates: Hough transform over edge pixels, each pixel voting only for lines whose normal agrees with its own
   * gradient (so the polarity of an edge is known), then every compatible set of four lines is intersected and scored. */
  function houghCandidates(mag, gx, gy, w, h, et, thr, out) {
    var n = w * h, rmax = Math.ceil(Math.hypot(w, h)), RW = 2 * rmax + 1, acc = new Uint16Array(360 * RW), i, th, cosT = new Float32Array(360), sinT = new Float32Array(360);
    for (th = 0; th < 360; th++) { cosT[th] = Math.cos(th * Math.PI / 180); sinT[th] = Math.sin(th * Math.PI / 180); }
    var x, y;
    for (y = 2; y < h - 2; y++) for (x = 2; x < w - 2; x++) {
      i = y * w + x; var m = mag[i]; if (m <= et) continue;
      /* non-maximum suppression along the gradient direction (keeps lines thin) */
      var ux = gx[i] / m, uy = gy[i] / m, m1 = mag[(Math.round(y + uy)) * w + Math.round(x + ux)], m2 = mag[(Math.round(y - uy)) * w + Math.round(x - ux)];
      if (m < m1 || m < m2) continue;
      var phi = Math.round(Math.atan2(gy[i], gx[i]) * 180 / Math.PI), d;
      for (d = -10; d <= 10; d += 2) {
        th = (phi + d + 720) % 360;
        var r = Math.round(x * cosT[th] + y * sinT[th]) + rmax;
        acc[th * RW + r]++;
      }
    }
    var minVotes = Math.max(12, Math.round(0.09 * Math.min(w, h))), peaks = [], r2;
    for (th = 0; th < 360; th++) for (r2 = 0; r2 < RW; r2++) { var v = acc[th * RW + r2]; if (v >= minVotes) peaks.push({ th: th, r: r2 - rmax, v: v }); }
    peaks.sort(function (a, b) { return b.v - a.v; });
    var lines = [];
    for (i = 0; i < peaks.length && lines.length < 14; i++) {
      var pk = peaks[i], ok = true, j;
      for (j = 0; j < lines.length; j++) { var dth = Math.abs(((pk.th - lines[j].th + 540) % 360) - 180); if (dth < 12 && Math.abs(pk.r - lines[j].r) < 12) { ok = false; break; } }
      if (ok) lines.push(pk);
    }
    lines.sort(function (a, b) { return a.th - b.th; });
    var L = lines.length, a, b, c, d2, tried = 0;
    function inter(l1, l2) {
      var c1 = cosT[l1.th], s1 = sinT[l1.th], c2 = cosT[l2.th], s2 = sinT[l2.th], det = c1 * s2 - s1 * c2;
      if (Math.abs(det) < 0.2) return null;
      return [(l1.r * s2 - s1 * l2.r) / det, (c1 * l2.r - l1.r * c2) / det];
    }
    for (a = 0; a < L; a++) for (b = a + 1; b < L; b++) for (c = b + 1; c < L; c++) for (d2 = c + 1; d2 < L; d2++) {
      var ls = [lines[a], lines[b], lines[c], lines[d2]], okg = true, k;
      for (k = 0; k < 4; k++) { var gap = (ls[(k + 1) % 4].th - ls[k].th + 360) % 360; if (gap < 35 || gap > 145) { okg = false; break; } }
      if (!okg) continue;
      var pts = [inter(ls[0], ls[1]), inter(ls[1], ls[2]), inter(ls[2], ls[3]), inter(ls[3], ls[0])];
      if (pts.some(function (p) { return !p; })) continue;
      if (!quadOK(pts, w, h)) continue;
      var qo = orderCorners(pts.map(function (p) { return { x: p[0], y: p[1] }; })).map(function (p) { return [p.x, p.y]; });
      tried++;
      scoreQuad(qo, w, h, gx, gy, thr, 'lines', 0.9, out);
    }
    return { lines: L, tried: tried, minVotes: minVotes, top: peaks.length ? peaks[0].v : 0, peaks: lines.map(function (l) { return [l.th, l.r, l.v]; }) };
  }

  function detect(source, opts) {
    opts = opts || {};
    var t0 = performance.now(), sz = srcSize(source), maxSide = opts.maxSide || 420, s = Math.min(1, maxSide / Math.max(sz.w, sz.h));
    var w = Math.max(16, Math.round(sz.w * s)), h = Math.max(16, Math.round(sz.h * s));
    var c = makeCanvas(w, h), cx = ctx2(c); cx.drawImage(source, 0, 0, w, h);
    var d = cx.getImageData(0, 0, w, h).data, n = w * h, L = new Float32Array(n), Mn = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) { var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; L[i] = (r * 77 + g * 150 + b * 29) / 256; Mn[i] = Math.min(r, g, b); }
    var Lb = gaussBlur(Float32Array.from(L), w, h, 3), gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var o = y * w + x;
      gx[o] = (Lb[o - w + 1] + 2 * Lb[o + 1] + Lb[o + w + 1] - Lb[o - w - 1] - 2 * Lb[o - 1] - Lb[o + w - 1]) / 8;
      gy[o] = (Lb[o + w - 1] + 2 * Lb[o + w] + Lb[o + w + 1] - Lb[o - w - 1] - 2 * Lb[o - w] - Lb[o - w + 1]) / 8;
      mag[o] = Math.hypot(gx[o], gy[o]);
    }
    var cands = [], mask = new Uint8Array(n), Lq = gaussBlur(Float32Array.from(L), w, h, 2), Mq = gaussBlur(Float32Array.from(Mn), w, h, 2);
    var magSorted = Float32Array.from(mag).sort(), thr = Math.min(7, Math.max(3, magSorted[Math.floor(n * 0.85)] * 0.4));

    /* A: bright paper (luminance and min-channel), both polarities for luminance */
    function binMask(vals, bright) {
      var t = otsu(vals, n), m = new Uint8Array(n), j;
      for (j = 0; j < n; j++) m[j] = (bright ? vals[j] > t : vals[j] <= t) ? 1 : 0;
      return clean(m);
    }
    function clean(m) {                       /* 3x3 open then close, to drop speckle and bridge text */
      var a = new Uint8Array(n), b = new Uint8Array(n), j, xx, yy, dx, dy;
      for (yy = 1; yy < h - 1; yy++) for (xx = 1; xx < w - 1; xx++) { var all = 1; for (dy = -1; dy <= 1 && all; dy++) for (dx = -1; dx <= 1; dx++) if (!m[(yy + dy) * w + xx + dx]) { all = 0; break; } a[yy * w + xx] = all; }
      for (yy = 1; yy < h - 1; yy++) for (xx = 1; xx < w - 1; xx++) { var any = 0; for (dy = -1; dy <= 1 && !any; dy++) for (dx = -1; dx <= 1; dx++) if (a[(yy + dy) * w + xx + dx]) { any = 1; break; } b[yy * w + xx] = any; }
      /* close: dilate twice then erode twice with big text gaps filled by flood from the outside afterwards */
      return fillHoles(b);
    }
    function fillHoles(m) {                   /* background connected to the border stays background; everything else is foreground */
      var out = new Uint8Array(n), st = new Int32Array(n), sp = 0, j;
      var seen = new Uint8Array(n);
      for (j = 0; j < n; j++) { var px = j % w, py = (j / w) | 0; if ((px === 0 || py === 0 || px === w - 1 || py === h - 1) && !m[j]) { seen[j] = 1; st[sp++] = j; } }
      while (sp) {
        var q = st[--sp], qx = q % w, qy = (q / w) | 0;
        if (qx > 0 && !m[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st[sp++] = q - 1; }
        if (qx < w - 1 && !m[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st[sp++] = q + 1; }
        if (qy > 0 && !m[q - w] && !seen[q - w]) { seen[q - w] = 1; st[sp++] = q - w; }
        if (qy < h - 1 && !m[q + w] && !seen[q + w]) { seen[q + w] = 1; st[sp++] = q + w; }
      }
      for (j = 0; j < n; j++) out[j] = seen[j] ? 0 : 1;
      return out;
    }
    candidateFromMask(binMask(Lq, true), w, h, gx, gy, thr, 'bright', cands);
    candidateFromMask(binMask(Mq, true), w, h, gx, gy, thr, 'bright-min', cands);
    candidateFromMask(binMask(Lq, false), w, h, gx, gy, thr, 'dark', cands);

    /* B: region enclosed by strong edges: flood the outside through weak-gradient pixels */
    var eMask = new Uint8Array(n), j2;
    var et = Math.min(4, Math.max(2.2, magSorted[Math.floor(n * 0.92)] * 0.2));
    for (j2 = 0; j2 < n; j2++) eMask[j2] = mag[j2] > et ? 1 : 0;
    var dil = new Uint8Array(n);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { var o2 = y * w + x; dil[o2] = (eMask[o2] || eMask[o2 - 1] || eMask[o2 + 1] || eMask[o2 - w] || eMask[o2 + w] || eMask[o2 - w - 1] || eMask[o2 + w + 1] || eMask[o2 - w + 1] || eMask[o2 + w - 1]) ? 1 : 0; }
    candidateFromMask(fillHoles(dil), w, h, gx, gy, thr, 'edges', cands);
    var hv = houghCandidates(mag, gx, gy, w, h, et, thr, cands);

    if (opts.weights) Object.keys(opts.weights).forEach(function (k) { SW[k] = opts.weights[k]; });
    var dbg = null;
    if (opts.gt) {                               /* test hook: how would the true quad score, and what did the line finder see? */
      var gq = orderCorners(opts.gt.map(function (p) { return { x: p[0] * w / sz.w, y: p[1] * h / sz.h }; })).map(function (p) { return [p.x, p.y]; }), go = [];
      scoreQuad(gq, w, h, gx, gy, thr, 'gt', 0.9, go);
      dbg = { gt: go[0] && { score: +go[0].score.toFixed(2), support: +go[0].support.toFixed(2), min: +go[0].minSupport.toFixed(2) }, thr: +thr.toFixed(1), et: +et.toFixed(1), lines: hv.lines, tried: hv.tried, minVotes: hv.minVotes, top: hv.top, peaks: hv.peaks };
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    /* A strong straight line inside the page (table border, shadow edge, text block) can beat a weaker true page edge. Prefer a
     * larger quad that contains the winner when it is also supported by real edges. */
    function insideQuad(pt, q, tol) {
      var i; for (i = 0; i < 4; i++) { var a = q[i], b = q[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; if (((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])) / L < -tol) return false; }
      return true;
    }
    var best = cands[0], bi, bj;
    for (bi = 0; SW.dominance && bi < cands.length && bi < 12; bi++) {
      var A = cands[bi];
      if (A.score < 0.45) break;
      var dom = false;
      for (bj = 0; bj < cands.length; bj++) {
        var B = cands[bj];
        if (B === A || B.support < 0.5 || B.minSupport < 0.2 || B.score < 0.45 || B.frac > 0.96 || B.frac < A.frac * 1.12) continue;
        if (A.q.every(function (pt) { return insideQuad(pt, B.q, 6); })) { dom = true; break; }
      }
      if (!dom) { best = A; break; }
    }
    var ms = Math.round(performance.now() - t0);
    if (!best || best.score < 0.5) return { corners: null, score: best ? best.score : 0, method: best ? best.method : 'none', ms: ms, candidates: cands.length, debug: dbg };
    var corners = orderCorners(best.q.map(function (p) { return { x: Math.max(0, Math.min(w, p[0])) / (w / sz.w), y: Math.max(0, Math.min(h, p[1])) / (h / sz.h) }; }));
    return { corners: corners, score: +best.score.toFixed(3), method: best.method, support: +best.support.toFixed(2), minSupport: +best.minSupport.toFixed(2), fill: +best.fill.toFixed(2), ms: ms, candidates: cands.length };
  }

  /* ---------------------------------------------------------------- geometry: homography, aspect, warp */
  function solveHomography(src, dst) {              /* maps src[i] -> dst[i]; returns 9 numbers (h33 = 1) */
    var A = [], b = [], i;
    for (i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var n = 8, k, r, c;
    for (k = 0; k < n; k++) {
      var piv = k; for (r = k + 1; r < n; r++) if (Math.abs(A[r][k]) > Math.abs(A[piv][k])) piv = r;
      var tmp = A[k]; A[k] = A[piv]; A[piv] = tmp; var tb = b[k]; b[k] = b[piv]; b[piv] = tb;
      for (r = k + 1; r < n; r++) { var f = A[r][k] / A[k][k]; for (c = k; c < n; c++) A[r][c] -= f * A[k][c]; b[r] -= f * b[k]; }
    }
    var hsol = new Array(n);
    for (k = n - 1; k >= 0; k--) { var s = b[k]; for (c = k + 1; c < n; c++) s -= A[k][c] * hsol[c]; hsol[k] = s / A[k][k]; }
    hsol.push(1); return hsol;
  }

  /* True width/height of the page from its image quad (Zhang and He, 2007: pinhole camera, square pixels, principal point at the image centre). Falls back to the mean edge ratio. */
  function aspectOf(c, imgW, imgH) {
    var tl = c[0], tr = c[1], br = c[2], bl = c[3];
    var top = Math.hypot(tr.x - tl.x, tr.y - tl.y), bot = Math.hypot(br.x - bl.x, br.y - bl.y), lef = Math.hypot(bl.x - tl.x, bl.y - tl.y), rig = Math.hypot(br.x - tr.x, br.y - tr.y);
    var simple = ((top + bot) / 2) / ((lef + rig) / 2);
    try {
      var u0 = imgW / 2, v0 = imgH / 2;
      var m1 = [tl.x - u0, tl.y - v0, 1], m2 = [tr.x - u0, tr.y - v0, 1], m3 = [bl.x - u0, bl.y - v0, 1], m4 = [br.x - u0, br.y - v0, 1];
      var cr = function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; };
      var dt = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
      var k2 = dt(cr(m1, m4), m3) / dt(cr(m2, m4), m3), k3 = dt(cr(m1, m4), m2) / dt(cr(m3, m4), m2);
      var n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
      var f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);       /* principal point is the origin now */
      if (!(f2 > 0) || !isFinite(f2)) return simple;
      var f = Math.sqrt(f2), q2 = function (n) { return n[0] * n[0] / f2 + n[1] * n[1] / f2 + n[2] * n[2]; };
      var ratio = Math.sqrt(q2(n2) / q2(n3));
      if (!isFinite(ratio) || ratio < 0.2 || ratio > 5) return simple;
      /* Zhang and He's w/h; if it disagrees wildly with the plain ratio the pose is near-parallel and the plain ratio is safer */
      return (Math.abs(ratio / simple - 1) > 0.35) ? simple : ratio;
    } catch (e) { return simple; }
  }

  /* opts: maxSide (longest side of the output, default 2339 = A4 at 200 dpi), aspect: 'auto' | 'a4' | 'letter' | number | 'edges' */
  function warp(source, corners, opts) {
    opts = opts || {};
    var t0 = performance.now(), sz = srcSize(source), c = corners, maxSide = opts.maxSide || 2339;
    var top = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), bot = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y), lef = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y), rig = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
    var asp = opts.aspect, ratio;
    if (asp === 'edges') ratio = ((top + bot) / 2) / ((lef + rig) / 2);
    else if (typeof asp === 'number') ratio = asp;
    else if (asp === 'a4') ratio = (((top + bot) / 2) > ((lef + rig) / 2)) ? 297 / 210 : 210 / 297;
    else if (asp === 'letter') ratio = (((top + bot) / 2) > ((lef + rig) / 2)) ? 11 / 8.5 : 8.5 / 11;
    else {
      ratio = aspectOf(c, sz.w, sz.h);
      /* snap to A4 / Letter when within 4 percent (both orientations) */
      [210 / 297, 297 / 210, 8.5 / 11, 11 / 8.5].forEach(function (r) { if (Math.abs(ratio / r - 1) < 0.04) ratio = r; });
    }
    var natural = Math.max((top + bot) / 2, (lef + rig) / 2), ow, oh;
    if (ratio >= 1) { ow = Math.min(maxSide, Math.max(64, natural)); oh = ow / ratio; } else { oh = Math.min(maxSide, Math.max(64, natural)); ow = oh * ratio; }
    ow = Math.max(32, Math.round(ow)); oh = Math.max(32, Math.round(oh));
    /* source pixels (cap memory: very large photos are first scaled to 3200 px) */
    var cap = opts.maxSource || defaultLimits().maxSource, ss = Math.min(1, cap / Math.max(sz.w, sz.h)), sw = Math.round(sz.w * ss), sh = Math.round(sz.h * ss);
    var own = !(ss === 1 && source.getContext && source.width === sw && source.height === sh), sc = own ? makeCanvas(sw, sh) : source, sx = ctx2(sc);
    if (own) sx.drawImage(source, 0, 0, sw, sh);
    var sd = sx.getImageData(0, 0, sw, sh).data;
    var H = solveHomography([{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }], c.map(function (p) { return { x: p.x * ss, y: p.y * ss }; }));
    var out = makeCanvas(ow, oh), ox = ctx2(out), od = ox.createImageData(ow, oh), o = od.data;
    var h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7];
    var x, y, idx = 0, maxX = sw - 1, maxY = sh - 1;
    for (y = 0; y < oh; y++) {
      var yy = y + 0.5;
      for (x = 0; x < ow; x++, idx += 4) {
        var xx = x + 0.5, den = h6 * xx + h7 * yy + 1, u = (h0 * xx + h1 * yy + h2) / den - 0.5, v = (h3 * xx + h4 * yy + h5) / den - 0.5;
        if (u < 0) u = 0; else if (u > maxX) u = maxX; if (v < 0) v = 0; else if (v > maxY) v = maxY;
        var x0 = u | 0, y0 = v | 0, x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0, fx = u - x0, fy = v - y0;
        var i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        o[idx] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        o[idx + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        o[idx + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        o[idx + 3] = 255;
      }
    }
    ox.putImageData(od, 0, 0);
    sd = od = o = null; if (own) sc.width = sc.height = 1;      /* drop the source copy at once: a 12 MP photo is about 50 MB */
    out._info = { ratio: +ratio.toFixed(4), ms: Math.round(performance.now() - t0), size: ow + 'x' + oh };
    return out;
  }

  /* ---------------------------------------------------------------- clean-up modes */
  /* Paper level per pixel: 90th percentile of luminance in a coarse grid, max-then-average smoothed, bilinear. Returns Float32Array(w*h). */
  function paperMap(L, w, h) {
    var cell = Math.max(16, Math.round(Math.max(w, h) / 90)), gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), bg = new Float32Array(gw * gh), hist = new Uint32Array(256), cx, cy, px, py, k, acc;
    for (cy = 0; cy < gh; cy++) for (cx = 0; cx < gw; cx++) {
      hist.fill(0); var x0 = cx * cell, y0 = cy * cell, x1 = Math.min(w, x0 + cell), y1 = Math.min(h, y0 + cell), cnt = 0;
      for (py = y0; py < y1; py += 2) for (px = x0; px < x1; px += 2) { hist[L[py * w + px] | 0]++; cnt++; }
      var target = cnt * 0.9; acc = 0; for (k = 0; k < 256; k++) { acc += hist[k]; if (acc >= target) break; }
      bg[cy * gw + cx] = k;
    }
    var tmp = new Float32Array(gw * gh), pass, x, y;
    for (pass = 0; pass < 2; pass++) {
      for (cy = 0; cy < gh; cy++) for (cx = 0; cx < gw; cx++) { var m = 0; for (y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) for (x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) if (bg[y * gw + x] > m) m = bg[y * gw + x]; tmp[cy * gw + cx] = m; }
      for (cy = 0; cy < gh; cy++) for (cx = 0; cx < gw; cx++) { var s = 0, q = 0; for (y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) for (x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) { s += tmp[y * gw + x]; q++; } bg[cy * gw + cx] = s / q; }
    }
    var out = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5)), iy = Math.floor(fy), ty = fy - iy, iy2 = Math.min(gh - 1, iy + 1);
      for (x = 0; x < w; x++) {
        var fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5)), ix = Math.floor(fx), tx = fx - ix, ix2 = Math.min(gw - 1, ix + 1);
        out[y * w + x] = (bg[iy * gw + ix] * (1 - tx) + bg[iy * gw + ix2] * tx) * (1 - ty) + (bg[iy2 * gw + ix] * (1 - tx) + bg[iy2 * gw + ix2] * tx) * ty;
      }
    }
    return out;
  }

  /* modes: 'color' (flatten light, keep colour), 'whiten' (paper to pure white, colour ink kept), 'gray', 'bw' (adaptive threshold, pure black and white), 'none' */
  function enhance(canvas, mode) {
    if (!mode || mode === 'none') return canvas;
    var w = canvas.width, h = canvas.height, cx = ctx2(canvas), im = cx.getImageData(0, 0, w, h), d = im.data, n = w * h, L = new Uint8ClampedArray(n), i;
    for (i = 0; i < n; i++) L[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    var bg = paperMap(L, w, h);
    if (mode === 'bw') {
      /* flatten, then Bradley adaptive threshold on an integral image */
      var F = new Uint8ClampedArray(n);
      for (i = 0; i < n; i++) { var v = L[i] * 255 / Math.max(60, bg[i]); F[i] = v > 255 ? 255 : v; }
      var W1 = w + 1, integ = new Float64Array(W1 * (h + 1)), x, y;
      for (y = 0; y < h; y++) { var rs = 0; for (x = 0; x < w; x++) { rs += F[y * w + x]; integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + rs; } }
      var r = Math.max(8, Math.round(Math.max(w, h) / 90)), t = 0.14;
      for (y = 0; y < h; y++) {
        var ya = Math.max(0, y - r), yb = Math.min(h - 1, y + r);
        for (x = 0; x < w; x++) {
          var xa = Math.max(0, x - r), xb = Math.min(w - 1, x + r), cnt = (xb - xa + 1) * (yb - ya + 1);
          var sum = integ[(yb + 1) * W1 + xb + 1] - integ[ya * W1 + xb + 1] - integ[(yb + 1) * W1 + xa] + integ[ya * W1 + xa];
          var val = F[y * w + x], out = (val * cnt < sum * (1 - t) && val < 225) ? 0 : 255, o = (y * w + x) * 4;
          d[o] = d[o + 1] = d[o + 2] = out; d[o + 3] = 255;
        }
      }
    } else {
      for (i = 0; i < n; i++) {
        var gain = 247 / Math.max(60, bg[i]), o2 = i * 4, rr = d[o2] * gain, gg = d[o2 + 1] * gain, bb = d[o2 + 2] * gain;
        if (mode === 'gray') { var lum = (rr * 77 + gg * 150 + bb * 29) / 256; rr = gg = bb = lum; }
        if (mode === 'whiten') {                      /* pull everything near paper level to white, deepen ink */
          var lm = (rr * 77 + gg * 150 + bb * 29) / 256, k2 = lm >= 225 ? 1 : (lm <= 150 ? 0 : (lm - 150) / 75);
          var sm = k2 * k2 * (3 - 2 * k2); rr = rr + (255 - rr) * sm; gg = gg + (255 - gg) * sm; bb = bb + (255 - bb) * sm;
          var dk = lm < 150 ? 0.82 : 1; rr *= dk; gg *= dk; bb *= dk;
        } else {                                      /* levels: 6 % black point, paper at 255 */
          rr = (rr - 14) * 1.07; gg = (gg - 14) * 1.07; bb = (bb - 14) * 1.07;
        }
        d[o2] = rr < 0 ? 0 : rr > 255 ? 255 : rr; d[o2 + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg; d[o2 + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb; d[o2 + 3] = 255;
      }
    }
    cx.putImageData(im, 0, 0);
    return canvas;
  }

  function rotate90(canvas, quarterTurns) {            /* clockwise */
    var q = ((quarterTurns % 4) + 4) % 4; if (!q) return canvas;
    var out = makeCanvas(q % 2 ? canvas.height : canvas.width, q % 2 ? canvas.width : canvas.height), x = ctx2(out);
    x.translate(out.width / 2, out.height / 2); x.rotate(q * Math.PI / 2); x.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
  }

  /* ---------------------------------------------------------------- PDF export */
  var SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

  function canvasJpeg(c, q) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { if (!b) return rej(new Error('Could not encode a page')); b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, 'image/jpeg', q); });
  }

  /* Packs a pure black-and-white canvas as 1 bit per pixel (MSB first, 1 = white). */
  function packBits(c) {
    var w = c.width, h = c.height, d = ctx2(c).getImageData(0, 0, w, h).data, rb = (w + 7) >> 3, out = new Uint8Array(rb * h), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (d[(y * w + x) * 4] > 127) out[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
    return out;
  }

  /* pages: [{ canvas, mode }]; opts: size 'a4' | 'letter' | 'fit', quality (0.5 to 0.95, JPEG), dpi (for 'fit', default 200), bwOneBit (default true) */
  async function exportPdf(pages, opts) {
    opts = opts || {};
    var L = global.PDFLib; if (!L) throw new Error('pdf-lib is not loaded');
    var doc = await L.PDFDocument.create(), size = opts.size || 'a4', q = opts.quality || 0.8, dpi = opts.dpi || 200, i;
    for (i = 0; i < pages.length; i++) {
      var p = pages[i], c = p.canvas, pw, ph, img;
      if (p.mode === 'bw' && opts.bwOneBit !== false) {
        var bits = packBits(c), ctxp = doc.context;
        var stream = ctxp.flateStream(bits, { Type: 'XObject', Subtype: 'Image', Width: c.width, Height: c.height, ColorSpace: 'DeviceGray', BitsPerComponent: 1 });
        img = { ref: ctxp.register(stream), width: c.width, height: c.height, oneBit: true };
      } else {
        img = await doc.embedJpg(await canvasJpeg(c, q));
      }
      if (size === 'fit') { pw = c.width * 72 / dpi; ph = c.height * 72 / dpi; }
      else { var sz = SIZES[size] || SIZES.a4; var land = c.width > c.height; pw = land ? sz[1] : sz[0]; ph = land ? sz[0] : sz[1]; }
      var page = doc.addPage([pw, ph]), k = Math.min(pw / c.width, ph / c.height), dw = c.width * k, dh = c.height * k, dx = (pw - dw) / 2, dy = (ph - dh) / 2;
      if (img.oneBit) {
        var name = 'Im' + i; page.node.setXObject(L.PDFName.of(name), img.ref);
        page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(dw, 0, 0, dh, dx, dy), L.drawObject(name), L.popGraphicsState());
      } else page.drawImage(img, { x: dx, y: dy, width: dw, height: dh });
    }
    doc.setCreator('LocalEditor'); doc.setProducer('LocalEditor');
    return doc.save({ useObjectStreams: false });
  }

  /* ---------------------------------------------------------------- camera */
  var camera = {
    supported: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && (global.isSecureContext !== false); },
    /* Ask for the rear camera and a high but sensible resolution (the browser picks the closest it has). */
    start: async function (video, o) {
      o = o || {};
      if (!camera.supported()) throw Object.assign(new Error('Camera access needs a secure (https) page and a browser that supports it'), { name: 'NotSupportedError' });
      var attempts = [
        { video: { facingMode: { ideal: o.facing || 'environment' }, width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false },
        { video: { facingMode: { ideal: o.facing || 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
        { video: true, audio: false }
      ], stream = null, err = null, i;
      for (i = 0; i < attempts.length && !stream; i++) { try { stream = await navigator.mediaDevices.getUserMedia(attempts[i]); } catch (e) { err = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e; } }
      if (!stream) throw err || new Error('No camera available');
      video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = stream;
      await video.play();
      var t = stream.getVideoTracks()[0], st = t.getSettings ? t.getSettings() : {};
      return { width: video.videoWidth, height: video.videoHeight, settings: st, label: t.label };
    },
    /* Full-sensor still where ImageCapture exists (Chromium on Android), otherwise the current video frame. */
    capture: async function (video) {
      var stream = video.srcObject, t = stream && stream.getVideoTracks()[0];
      if (t && global.ImageCapture) {
        try { var blob = await new global.ImageCapture(t).takePhoto(); var bmp = await createImageBitmap(blob); return { source: bmp, width: bmp.width, height: bmp.height, via: 'takePhoto' }; } catch (e) { /* fall through */ }
      }
      var c = makeCanvas(video.videoWidth, video.videoHeight); ctx2(c).drawImage(video, 0, 0);
      return { source: c, width: c.width, height: c.height, via: 'video-frame' };
    },
    stop: function (video) {
      var s = video.srcObject; if (s) s.getTracks().forEach(function (t) { t.stop(); }); video.srcObject = null;
    }
  };

  /* ---------------------------------------------------------------- memory limits for this device */
  function smallDevice() {
    var mem = navigator.deviceMemory, coarse = false;
    try { coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches; } catch (e) { coarse = false; }
    return !!((mem && mem <= 4) || (coarse && Math.min(screen.width, screen.height) < 820));
  }
  /* maxSource: longest side of a photo kept in memory while editing; outSide: longest side of a finished page
     (2339 px = A4 at 200 dpi; 1754 px = A4 at 150 dpi on phones and small-memory devices). */
  function defaultLimits() {
    var small = smallDevice(), tiny = navigator.deviceMemory && navigator.deviceMemory <= 2;
    return { maxSource: tiny ? 2000 : small ? 2400 : 3600, outSide: small ? 1754 : 2339, warnPages: small ? 30 : 80, maxPages: 200, small: small };
  }

  /* A photo file or blob as a canvas, EXIF orientation applied, longest side capped. The decoded bitmap is closed at once. */
  async function toSource(blob, opts) {
    var max = (opts && opts.maxSide) || defaultLimits().maxSource, bmp;
    try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(blob); }
    var s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = makeCanvas(bmp.width * s, bmp.height * s);
    ctx2(c).drawImage(bmp, 0, 0, c.width, c.height);
    c._orig = { w: bmp.width, h: bmp.height };
    if (bmp.close) bmp.close();
    return c;
  }
  function decodeToCanvas(blob) {
    return createImageBitmap(blob).then(function (bmp) {
      var c = makeCanvas(bmp.width, bmp.height); ctx2(c).drawImage(bmp, 0, 0); if (bmp.close) bmp.close(); return c;
    });
  }

  /* pages: [{ out: Blob, mode, w, h }]; opts: size 'a4' | 'letter' | 'fit', dpi (for 'fit', default 200), onProgress(done, total), signal */
  async function exportBlobs(pages, opts) {
    opts = opts || {};
    var L = global.PDFLib; if (!L) throw new Error('pdf-lib is not loaded');
    var doc = await L.PDFDocument.create(), size = opts.size || 'a4', dpi = opts.dpi || 200, i;
    for (i = 0; i < pages.length; i++) {
      if (opts.signal && opts.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      var p = pages[i], w = p.w, h = p.h, img = null, ref = null;
      if (p.mode === 'bw') {
        var c = await decodeToCanvas(p.out);
        w = c.width; h = c.height;
        var bits = packBits(c); c.width = c.height = 1; c = null;
        ref = doc.context.register(doc.context.flateStream(bits, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }));
        bits = null;
      } else {
        img = await doc.embedJpg(new Uint8Array(await p.out.arrayBuffer()));
        w = img.width; h = img.height;
      }
      var pw, ph;
      if (size === 'fit') { pw = w * 72 / dpi; ph = h * 72 / dpi; }
      else { var sz = SIZES[size] || SIZES.a4, land = w > h; pw = land ? sz[1] : sz[0]; ph = land ? sz[0] : sz[1]; }
      var page = doc.addPage([pw, ph]), k = Math.min(pw / w, ph / h), dw = w * k, dh = h * k, dx = (pw - dw) / 2, dy = (ph - dh) / 2;
      if (ref) {
        var name = 'Scan' + i; page.node.setXObject(L.PDFName.of(name), ref);
        page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(dw, 0, 0, dh, dx, dy), L.drawObject(name), L.popGraphicsState());
      } else page.drawImage(img, { x: dx, y: dy, width: dw, height: dh });
      if (opts.onProgress) opts.onProgress(i + 1, pages.length);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    doc.setCreator('LocalEditor'); doc.setProducer('LocalEditor');
    return doc.save({ useObjectStreams: false });
  }

  LE.scan = {
    detect: detect, warp: warp, enhance: enhance, rotate90: rotate90, exportPdf: exportPdf, exportBlobs: exportBlobs, toSource: toSource,
    limits: defaultLimits, camera: camera, orderCorners: orderCorners, aspectOf: aspectOf, solveHomography: solveHomography, version: 2
  };

  /* LE.support (docs/SUPPORT.md): the live camera needs the camera API; the rest (photos, straighten, clean up, PDF) needs only canvas.
     "degraded" keeps "Try anyway" on: without a camera the person picks photos (on phones that opens the system camera). */
  (global.LE_SUPPORT_DEFS = global.LE_SUPPORT_DEFS || []).push(
    { id: 'scan.camera', name: 'Scan with the camera', group: 'PDF studio', needs: ['camera', 'secure-context'], wants: ['device-memory-4gb'], memoryMB: 250, downloadMB: 0,
      note: 'Takes the photo in the page; the picture stays on this device.', degraded: 'Choose photos instead (on a phone this opens the camera app).' },
    { id: 'scan.cleanup', name: 'Straighten and clean up photos of pages', group: 'PDF studio', needs: ['canvas-2d'], wants: ['device-memory-4gb', 'createimagebitmap'], memoryMB: 250, downloadMB: 0 }
  );
})(window);

/* =====================================================================
   Part 2: "Scan with camera" in the PDF studio
   ===================================================================== */
(function (global) {
  'use strict';
  var LE = global.LE || {};
  var SCAN = LE.scan;
  var PS = global.PS;
  if (!PS || !PS.panels || !PS.S || !SCAN) return;
  var d = global.document;
  var S = PS.S;
  var el = PS.el, esc = PS.esc;

  var I = {
    camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
    photos: '<rect x="7" y="3" width="14" height="12" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/><circle cx="12" cy="8" r="1.4"/><path d="m21 12-3.5-3.5L11 15"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    find: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/>',
    full: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>',
    rotL: '<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v6h6"/>',
    rotR: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v6h-6"/>',
    up: '<path d="m15 6-6 6 6 6"/>',
    down: '<path d="m9 6 6 6-6 6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    retake: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M9.5 12.5a2.5 2.5 0 1 0 1-2"/><path d="M10 9v2h2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
  };
  function ic(name, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>'; }
  function h(tag, cls, html, attrs) { var n = el(tag, cls, html); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function button(cls, html, onClick, attrs) { var b = h('button', cls, html, attrs); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; }
  function say(m, ms) { if (PS.say) PS.say(m, ms); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function frame() { return new Promise(function (r) { (global.requestAnimationFrame || setTimeout)(function () { setTimeout(r, 0); }); }); }
  function release(c) { if (c && c.getContext) { c.width = c.height = 1; } else if (c && c.close) { try { c.close(); } catch (e) { /* ignore */ } } }
  function toBlob(c, type, q) { return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('Could not keep the page')); }, type, q); }); }
  function isAbort(e) { return e && (e.name === 'AbortError' || e.cancelled); }

  var LIM = SCAN.limits();
  /* Clean-up modes in plain words; the engine ids are 'none', 'bw', 'whiten', 'gray'. */
  var MODES = [['none', 'Original'], ['bw', 'Document', 'black on white'], ['whiten', 'Colour boost'], ['gray', 'Greyscale']];
  var MODE_WORD = { none: 'Original', bw: 'Document', whiten: 'Colour boost', gray: 'Greyscale', color: 'Colour' };
  var st = {
    pages: [], view: 'start', cur: null, nextId: 1, queue: [], replaceId: null, camOn: false, camTimer: null, busy: false,
    mode: MODE_WORD[lsGet('le-scan-mode')] ? lsGet('le-scan-mode') : 'whiten', size: lsGet('le-scan-size') || 'a4', searchable: lsGet('le-scan-ocr') === '1',
    error: '', note: ''
  };
  var W = null, E = {};

  /* ---------- workbench shell ---------- */

  function inputs() {
    if (E.pick) return;
    E.pick = h('input', 'psn-file', '', { type: 'file', accept: 'image/*', multiple: '', hidden: '', 'aria-hidden': 'true', 'data-psn-input': 'pick' });
    E.native = h('input', 'psn-file', '', { type: 'file', accept: 'image/*', capture: 'environment', hidden: '', 'aria-hidden': 'true', 'data-psn-input': 'native' });
    [E.pick, E.native].forEach(function (inp) {
      inp.addEventListener('change', function () { var f = [].slice.call(inp.files || []); inp.value = ''; onFiles(f); });
      W.appendChild(inp);
    });
  }
  function build() {
    if (W) return W;
    W = h('section', 'psn-work', '', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'psn-title', hidden: '' });
    W.innerHTML = '<header class="psn-head"><button class="ps-ib psn-back" type="button" aria-label="Back to the studio">' + ic('back') + '</button>' +
      '<div class="psn-head-t"><h2 id="psn-title">Scan with camera</h2><p class="psn-head-sub">' + ic('lock') + '<span>Photos stay on this device.</span></p></div>' +
      '<span class="psn-count" aria-live="polite"></span></header>' +
      '<div class="psn-body"><div class="psn-view"></div></div>' +
      '<footer class="psn-foot"><p class="psn-msg" aria-live="polite"></p><div class="psn-acts"></div></footer>' +
      '<canvas class="psn-loupe" width="168" height="168" hidden aria-hidden="true"></canvas>';
    d.body.appendChild(W);
    E.view = W.querySelector('.psn-view'); E.acts = W.querySelector('.psn-acts'); E.msg = W.querySelector('.psn-msg');
    E.count = W.querySelector('.psn-count'); E.loupe = W.querySelector('.psn-loupe'); E.title = W.querySelector('#psn-title');
    W.querySelector('.psn-back').addEventListener('click', function () { back(); });
    W.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !d.querySelector('dialog[open]')) { e.stopPropagation(); back(); } });
    inputs();
    return W;
  }
  function open(opts) {
    build();
    W.hidden = false;
    d.body.classList.add('psn-open');
    if (PS.isPhone && PS.isPhone() && PS.setSheet) PS.setSheet('closed');
    st.error = '';
    show(st.pages.length ? 'tray' : 'start');
    try { if (LE.downloads && LE.downloads.used) LE.downloads.used('scan'); } catch (e) { /* ignore */ }
    if (opts && opts.camera) takePhoto();
    setTimeout(function () { var f = W.querySelector('.psn-back'); if (f) f.focus(); }, 30);
  }
  /* Back: one step at a time. Pages in the tray are kept until "Make PDF" or "Discard" (owner: this scan session). */
  function back() {
    if (st.busy) return;
    if (st.view === 'camera') { stopCamera(); show(st.pages.length ? 'tray' : 'start'); return; }
    if (st.view === 'clean') { show('corners'); return; }
    if (st.view === 'corners') { dropCurrent(); st.queue = []; show(st.pages.length ? 'tray' : 'start'); return; }
    close();
  }
  function close() {
    stopCamera(); dropCurrent(); st.queue = [];
    if (!W) return;
    W.hidden = true;
    d.body.classList.remove('psn-open');
    if (PS.ocr && PS.ocr.render) PS.ocr.render();
  }
  function setMsg(t, bad) { E.msg.textContent = t || ''; E.msg.classList.toggle('is-bad', !!bad); }
  function acts(list) {
    E.acts.innerHTML = '';
    list.forEach(function (b) { if (b) E.acts.appendChild(b); });
  }
  function show(view) {
    st.view = view;
    W.setAttribute('data-view', view);
    E.view.innerHTML = '';
    E.count.textContent = st.pages.length ? plural(st.pages.length, 'page') : '';
    setMsg(st.error, !!st.error);
    if (view !== 'camera') stopCamera();
    (VIEWS[view] || VIEWS.start)();
  }

  /* ---------- capture ---------- */

  function takePhoto() {
    st.error = '';
    if (SCAN.camera.supported()) startCamera();
    else E.native.click();               /* no camera API here: the system camera or the photo picker */
  }
  function choosePhotos() { st.error = ''; E.pick.click(); }
  function fresh(fn) { return function () { st.replaceId = null; fn(); }; }

  function cameraError(e) {
    var n = e && e.name;
    return n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera access is blocked. To allow it, open this site’s settings in your browser (next to the address). You can still choose photos.'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No camera was found on this device. Choose photos instead.'
        : n === 'NotReadableError' ? 'Another app is using the camera. Close it and try again, or choose photos.'
          : n === 'NotSupportedError' ? 'The camera can’t be used on this page. Choose photos instead.'
            : 'The camera could not start. Choose photos instead.';
  }
  async function startCamera() {
    show('camera');
    var v = E.video;
    setMsg('Asking for the camera…');
    try {
      await SCAN.camera.start(v);
      if (st.view !== 'camera') { SCAN.camera.stop(v); return; }
      st.camOn = true;
      setMsg('Hold the page flat in even light, all four corners in view.');
      clearInterval(st.camTimer);
      st.camTimer = setInterval(liveOutline, 450);
      if (LE.support && LE.support.reportSuccess) LE.support.reportSuccess('scan.camera');
      var shot = W.querySelector('[data-psn="shoot"]'); if (shot) { shot.disabled = false; shot.focus(); }
    } catch (e) {
      st.camOn = false;
      st.error = cameraError(e);
      if (LE.support && LE.support.reportFailure && e && e.name !== 'NotAllowedError') LE.support.reportFailure('scan.camera', e);
      show(st.pages.length ? 'tray' : 'start');
    }
  }
  function stopCamera() {
    clearInterval(st.camTimer); st.camTimer = null;
    if (E.video && E.video.srcObject) { try { SCAN.camera.stop(E.video); } catch (e) { /* ignore */ } }
    st.camOn = false;
  }
  d.addEventListener('visibilitychange', function () {
    if (d.hidden && st.camOn) { stopCamera(); if (st.view === 'camera') { st.error = 'The camera was turned off while the page was hidden.'; show(st.pages.length ? 'tray' : 'start'); } }
  });
  function liveOutline() {
    var v = E.video, o = E.overlay;
    if (!v || !o || !v.videoWidth || st.view !== 'camera') return;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    o.width = Math.round(v.clientWidth * dpr); o.height = Math.round(v.clientHeight * dpr);
    var r = SCAN.detect(v, { maxSide: 320 }), x = o.getContext('2d');
    x.clearRect(0, 0, o.width, o.height);
    if (!r.corners) return;
    var sc = Math.min(o.width / v.videoWidth, o.height / v.videoHeight), ox = (o.width - v.videoWidth * sc) / 2, oy = (o.height - v.videoHeight * sc) / 2;
    var path = function () { x.beginPath(); r.corners.forEach(function (c, i) { var px = ox + c.x * sc, py = oy + c.y * sc; if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.closePath(); };
    x.setLineDash(r.score > 0.75 ? [] : [10 * dpr, 8 * dpr]);
    path(); x.lineWidth = 6 * dpr; x.strokeStyle = 'rgba(0,0,0,0.45)'; x.stroke();
    path(); x.lineWidth = 3 * dpr; x.strokeStyle = r.score > 0.75 ? '#5884F8' : '#FFFFFF'; x.stroke();
  }
  async function shoot() {
    if (!st.camOn) return;
    var b = W.querySelector('[data-psn="shoot"]'); if (b) b.disabled = true;
    setMsg('Taking the photo…');
    try {
      var shot = await SCAN.camera.capture(E.video);
      stopCamera();
      var c = shot.source, s = Math.min(1, LIM.maxSource / Math.max(shot.width, shot.height)), cap = c;
      if (s < 1 || !c.getContext) { cap = document.createElement('canvas'); cap.width = Math.round(shot.width * s); cap.height = Math.round(shot.height * s); cap.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, cap.width, cap.height); release(c); }
      var blob = await toBlob(cap, 'image/jpeg', 0.92);        /* the source kept for "edit again": a JPEG, not a bitmap */
      await startEdit(blob, cap, st.replaceId);
    } catch (e) {
      st.error = 'The photo could not be taken. Try again, or choose photos.';
      show(st.pages.length ? 'tray' : 'start');
    }
  }
  async function onFiles(files) {
    files = files.filter(function (f) { return /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name || ''); });
    if (!files.length) return;
    var room = LIM.maxPages - st.pages.length;
    if (!st.replaceId && files.length > room) { files = files.slice(0, Math.max(0, room)); st.error = 'A scan can have up to ' + LIM.maxPages + ' pages. Make a PDF, then start a new scan.'; }
    st.queue = st.replaceId ? files.slice(0, 1) : files;
    await nextFromQueue();
  }
  async function nextFromQueue() {
    var f = st.queue.shift();
    if (!f) { show(st.pages.length ? 'tray' : 'start'); return false; }
    try {
      setMsg('Opening the photo…');
      var c = await SCAN.toSource(f, { maxSide: LIM.maxSource });
      await startEdit(f, c, st.replaceId);
    } catch (e) {
      st.error = (f.name ? f.name + ': ' : '') + 'this photo could not be opened.' + (/hei[cf]$/i.test(f.name || '') ? ' This browser cannot read HEIC photos; choose a JPEG.' : '');
      return nextFromQueue();
    }
    return true;
  }

  /* ---------- corners ---------- */

  async function startEdit(src, canvas, replaceId, page) {
    dropCurrent();
    st.cur = { src: src, canvas: canvas, corners: null, score: 0, rot: page ? page.rot : 0, replaceId: replaceId || null, mode: page ? page.mode : st.mode, raw: null, result: null };
    st.replaceId = null;
    if (page) { st.cur.corners = page.corners.map(function (p) { return { x: p.x * canvas.width, y: p.y * canvas.height }; }); st.cur.score = 1; st.cur.found = true; }
    else detectNow();
    show('corners');
  }
  function detectNow() {
    var c = st.cur, r = SCAN.detect(c.canvas, { maxSide: 420 });
    c.score = r.score || 0; c.found = !!r.corners;
    if (r.corners) c.corners = r.corners;
    else { var w = c.canvas.width, hh = c.canvas.height, m = 0.04; c.corners = [{ x: w * m, y: hh * m }, { x: w * (1 - m), y: hh * m }, { x: w * (1 - m), y: hh * (1 - m) }, { x: w * m, y: hh * (1 - m) }]; }
    c.detected = c.corners.map(function (p) { return { x: p.x, y: p.y }; });
  }
  function dropCurrent() {
    var c = st.cur;
    if (!c) return;
    release(c.canvas); release(c.raw); release(c.result);
    st.cur = null;
  }
  var ed = { k: 1, drag: -1, dpr: 1 };
  function layoutEditor() {
    var cv = E.editor, c = st.cur;
    if (!cv || !c) return;
    var box = E.edBox.getBoundingClientRect();
    var maxW = Math.max(120, box.width), maxH = Math.max(160, box.height);
    var k = Math.min(maxW / c.canvas.width, maxH / c.canvas.height);
    var cw = Math.max(1, Math.floor(c.canvas.width * k)), ch = Math.max(1, Math.floor(c.canvas.height * k));
    ed.dpr = Math.min(2, global.devicePixelRatio || 1);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    cv.width = Math.round(cw * ed.dpr); cv.height = Math.round(ch * ed.dpr);
    ed.k = k * ed.dpr;
    drawEditor();
  }
  function drawEditor() {
    var cv = E.editor, c = st.cur;
    if (!cv || !c) return;
    var x = cv.getContext('2d'), k = ed.k, dpr = ed.dpr;
    x.clearRect(0, 0, cv.width, cv.height);
    x.drawImage(c.canvas, 0, 0, c.canvas.width * k, c.canvas.height * k);
    var pts = c.corners.map(function (p) { return { x: p.x * k, y: p.y * k }; });
    x.fillStyle = 'rgba(0,0,0,0.42)'; x.beginPath(); x.rect(0, 0, cv.width, cv.height);
    pts.forEach(function (p, i) { if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }); x.closePath(); x.fill('evenodd');
    var path = function () { x.beginPath(); pts.forEach(function (p, i) { if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }); x.closePath(); };
    path(); x.lineWidth = 5 * dpr; x.strokeStyle = 'rgba(0,0,0,0.5)'; x.stroke();
    path(); x.lineWidth = 2.5 * dpr; x.strokeStyle = '#5884F8'; x.stroke();
    pts.forEach(function (p, i) {
      x.beginPath(); x.arc(p.x, p.y, (i === ed.drag ? 13 : 11) * dpr, 0, Math.PI * 2);
      x.fillStyle = '#FFFFFF'; x.fill(); x.lineWidth = 3 * dpr; x.strokeStyle = '#3F67D9'; x.stroke();
    });
    /* keyboard-reachable handles mirror the canvas corners (for screen readers and keyboards) */
    if (E.handles) E.handles.forEach(function (b, i) { b.style.left = (pts[i].x / dpr) + 'px'; b.style.top = (pts[i].y / dpr) + 'px'; });
  }
  function evPoint(e) { var r = E.editor.getBoundingClientRect(); return { x: (e.clientX - r.left) * ed.dpr, y: (e.clientY - r.top) * ed.dpr, cx: e.clientX, cy: e.clientY }; }
  function nearest(p) {
    var best = -1, bd = 1e9;
    st.cur.corners.forEach(function (c, i) { var dd = Math.hypot(c.x * ed.k - p.x, c.y * ed.k - p.y); if (dd < bd) { bd = dd; best = i; } });
    return bd <= 44 * ed.dpr ? best : -1;                 /* 44 CSS px target around each handle */
  }
  function loupe(p, c) {
    var l = E.loupe, x = l.getContext('2d'), z = 3, R = 84, src = st.cur.canvas;
    l.hidden = false;
    var lx = Math.max(8, Math.min(global.innerWidth - 176, p.cx - R)), ly = p.cy - 200;
    if (ly < 64) ly = Math.min(global.innerHeight - 176, p.cy + 56);
    l.style.left = lx + 'px'; l.style.top = ly + 'px';
    x.save(); x.clearRect(0, 0, 168, 168); x.beginPath(); x.arc(R, R, R, 0, Math.PI * 2); x.clip();
    x.fillStyle = '#000000'; x.fillRect(0, 0, 168, 168);
    x.drawImage(src, c.x - R / z, c.y - R / z, 168 / z, 168 / z, 0, 0, 168, 168);
    x.restore();
    x.strokeStyle = '#5884F8'; x.lineWidth = 2; x.beginPath(); x.moveTo(R, R - 18); x.lineTo(R, R + 18); x.moveTo(R - 18, R); x.lineTo(R + 18, R); x.stroke();
  }
  function bindEditor() {
    var cv = E.editor;
    cv.addEventListener('pointerdown', function (e) {
      if (!st.cur) return;
      var p = evPoint(e), i = nearest(p);
      if (i < 0) return;
      ed.drag = i; cv.setPointerCapture(e.pointerId); e.preventDefault(); loupe(p, st.cur.corners[i]); drawEditor();
    });
    cv.addEventListener('pointermove', function (e) {
      if (ed.drag < 0 || !st.cur) return;
      var p = evPoint(e), c = st.cur.canvas;
      st.cur.corners[ed.drag] = { x: Math.max(0, Math.min(c.width, p.x / ed.k)), y: Math.max(0, Math.min(c.height, p.y / ed.k)) };
      loupe(p, st.cur.corners[ed.drag]); drawEditor(); e.preventDefault();
    });
    function end() { if (ed.drag < 0) return; ed.drag = -1; E.loupe.hidden = true; st.cur.corners = SCAN.orderCorners(st.cur.corners); drawEditor(); }
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  function nudge(i, dx, dy) {
    var c = st.cur, step = Math.max(2, Math.round(Math.max(c.canvas.width, c.canvas.height) / 200));
    var p = c.corners[i];
    c.corners[i] = { x: Math.max(0, Math.min(c.canvas.width, p.x + dx * step)), y: Math.max(0, Math.min(c.canvas.height, p.y + dy * step)) };
    drawEditor();
  }
  function rotateCurrent(q) {
    var c = st.cur, old = c.canvas, w = old.width, hh = old.height;
    c.canvas = SCAN.rotate90(old, q);
    release(old);
    c.corners = SCAN.orderCorners(c.corners.map(function (p) { return q === 1 ? { x: hh - p.y, y: p.x } : { x: p.y, y: w - p.x }; }));
    c.rot = (c.rot + q) % 4;
    layoutEditor();
  }

  /* ---------- straighten and clean up ---------- */

  async function straighten() {
    var c = st.cur;
    if (!c) return;
    st.busy = true; setMsg('Straightening the page…');
    var nb = W.querySelector('[data-psn="next"]'); if (nb) nb.disabled = true;
    await frame();
    try {
      release(c.raw);
      c.raw = SCAN.warp(c.canvas, c.corners, { maxSide: LIM.outSide, maxSource: LIM.maxSource });
      st.busy = false;
      show('clean');
    } catch (e) {
      st.busy = false; setMsg('The page could not be straightened. Move the corners and try again.', true);
      if (nb) nb.disabled = false;
    }
  }
  async function applyMode(m) {
    var c = st.cur;
    if (!c || !c.raw) return;
    c.mode = m;
    if (!c.result || c.result.width !== c.raw.width || c.result.height !== c.raw.height) { release(c.result); c.result = document.createElement('canvas'); c.result.width = c.raw.width; c.result.height = c.raw.height; }
    var x = c.result.getContext('2d', { willReadFrequently: true });
    x.drawImage(c.raw, 0, 0);
    SCAN.enhance(c.result, m);
    if (m === 'bw') {                    /* a hairline of table often survives at the page edge; in Document mode trim it to paper white */
      var t = Math.max(2, Math.round(Math.min(c.result.width, c.result.height) * 0.006)); x.fillStyle = '#FFFFFF';
      x.fillRect(0, 0, c.result.width, t); x.fillRect(0, c.result.height - t, c.result.width, t); x.fillRect(0, 0, t, c.result.height); x.fillRect(c.result.width - t, 0, t, c.result.height);
    }
    if (E.preview) {
      var pv = E.preview, k = Math.min(1, 1100 / Math.max(c.result.width, c.result.height));
      pv.width = Math.round(c.result.width * k); pv.height = Math.round(c.result.height * k);
      pv.getContext('2d').drawImage(c.result, 0, 0, pv.width, pv.height);
    }
    if (E.modes) [].forEach.call(E.modes.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === m)); });
  }
  function thumbOf(c) {
    var k = 220 / Math.max(c.width, c.height), t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(c.width * k)); t.height = Math.max(1, Math.round(c.height * k));
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return toBlob(t, 'image/jpeg', 0.7).then(function (b) { release(t); return URL.createObjectURL(b); });
  }
  /* Keeps the finished page as a compressed file (JPEG, or PNG for black and white) plus a small thumbnail; every canvas is released. */
  async function keepPage() {
    var c = st.cur;
    if (!c || !c.result) return;
    st.busy = true; setMsg('Keeping the page…');
    try {
      var out = await toBlob(c.result, c.mode === 'bw' ? 'image/png' : 'image/jpeg', 0.86);
      var pg = {
        id: c.replaceId || ('p' + (st.nextId++)), src: c.src, rot: c.rot, mode: c.mode, out: out, w: c.result.width, h: c.result.height,
        corners: c.corners.map(function (p) { return { x: p.x / c.canvas.width, y: p.y / c.canvas.height }; }), thumb: await thumbOf(c.result)
      };
      var at = -1;
      st.pages.forEach(function (p, i) { if (p.id === pg.id) at = i; });
      if (at >= 0) { URL.revokeObjectURL(st.pages[at].thumb); st.pages[at] = pg; } else st.pages.push(pg);
      st.mode = c.mode; lsSet('le-scan-mode', c.mode);
      dropCurrent();
      st.busy = false;
      st.error = st.pages.length >= LIM.warnPages ? 'That is a lot of pages for this device. Make a PDF now, then start a new scan.' : '';
      if (!(await nextFromQueue())) say(at >= 0 ? 'Page ' + (at + 1) + ' updated.' : 'Page ' + st.pages.length + ' added.');
    } catch (e) {
      st.busy = false; setMsg('The page could not be kept. Try again.', true);
    }
  }

  /* ---------- tray actions ---------- */

  function movePage(i, by) {
    var j = i + by;
    if (j < 0 || j >= st.pages.length) return;
    st.pages.splice(j, 0, st.pages.splice(i, 1)[0]);
    show('tray');
    var b = W.querySelector('.psn-page[data-i="' + j + '"] [data-psn-move="' + (by < 0 ? 'up' : 'down') + '"]');
    if (b && !b.disabled) b.focus();
  }
  function deletePage(i) {
    var p = st.pages.splice(i, 1)[0];
    if (p) URL.revokeObjectURL(p.thumb);
    show(st.pages.length ? 'tray' : 'start');
    say('Page ' + (i + 1) + ' removed.');
  }
  async function editPage(i) {
    var p = st.pages[i];
    if (!p) return;
    setMsg('Opening the photo…');
    try {
      var c = await SCAN.toSource(p.src, { maxSide: LIM.maxSource });
      for (var q = 0; q < p.rot; q++) { var r = SCAN.rotate90(c, 1); release(c); c = r; }
      await startEdit(p.src, c, p.id, p);
    } catch (e) { setMsg('This page’s photo could not be opened again. Retake it instead.', true); }
  }
  function retakePage(i) { var p = st.pages[i]; if (!p) return; st.replaceId = p.id; takePhoto(); }
  function discardAll() {
    st.pages.forEach(function (p) { URL.revokeObjectURL(p.thumb); });
    st.pages = [];
    dropCurrent();
  }
  function scanName() {
    var t = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'Scan ' + t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + pad(t.getMinutes()) + '.pdf';
  }

  /* Builds the PDF one page at a time; then, if asked, reads the text in it (D9); then opens it in the studio or downloads it. */
  async function makePdf(how) {
    if (st.busy || !st.pages.length) return null;
    st.busy = true;
    var pr = PS.progress('Making the PDF', false), bytes;
    try { if (LE.pdf && LE.pdf.ready) await LE.pdf.ready(); } catch (e) { /* reported below */ }
    try {
      bytes = await SCAN.exportBlobs(st.pages, { size: st.size, onProgress: function (dn, t) { try { pr.set(dn, t, 'Page ' + dn + ' of ' + t); } catch (e) { /* ignore */ } } });
    } catch (e) {
      pr.end(); st.busy = false; setMsg('The PDF could not be made: ' + (e && e.message ? e.message : 'unknown problem') + '.', true); return null;
    }
    pr.end();
    var searchable = false;
    if (st.searchable && PS.ocr && PS.ocr.readJobs) {
      try {
        var all = st.pages.map(function (_, i) { return i + 1; });
        bytes = (await PS.ocr.readJobs([{ bytes: bytes, pages: all }], { label: 'Making the scan searchable', skipTextPages: false }))[0];
        searchable = true;
      } catch (e) {
        say(isAbort(e) ? 'Stopped reading the text. The PDF is made without it.' : 'The text could not be read (' + (e && e.message ? e.message : 'unknown problem') + '). The PDF is made without it.', 5200);
      }
    }
    var name = scanName(), n = st.pages.length;
    st.busy = false;
    st.last = { bytes: bytes.length, pages: n, searchable: searchable, name: name };
    if (how === 'download') {
      var blob = new Blob([bytes], { type: 'application/pdf' });
      if (global.IT && IT.download) IT.download(blob, name);
      else { var a = d.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; d.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
      setMsg('Downloaded ' + name + (searchable ? ', searchable' : '') + '. The pages stay here until you open them or discard them.');
      return st.last;
    }
    var had = S.pages.length;
    discardAll();
    close();
    await PS.addFiles([new File([bytes], name, { type: 'application/pdf' })]);
    if (!had) say('Scanned ' + plural(n, 'page') + (searchable ? ', searchable' : '') + '. Use Save PDF to keep it.', 4600);
    return st.last;
  }

  /* ---------- views ---------- */

  var VIEWS = {};

  VIEWS.start = function () {
    E.title.textContent = 'Scan with camera';
    var v = E.view;
    var hero = h('div', 'psn-start');
    hero.appendChild(h('p', 'psn-lead', 'Photograph paper pages. LocalEditor finds the page edges, straightens them, cleans them up and makes a PDF.'));
    var big = h('div', 'psn-sources');
    big.appendChild(button('psn-src psn-src-main', '<span class="psn-src-ic">' + ic('camera') + '</span><strong>Take a photo</strong><small>Uses this device’s camera</small>', fresh(takePhoto), { 'data-psn': 'camera' }));
    big.appendChild(button('psn-src', '<span class="psn-src-ic">' + ic('photos') + '</span><strong>Choose photos</strong><small>Several at once is fine</small>', fresh(choosePhotos), { 'data-psn': 'pick' }));
    if (SCAN.camera.supported() && matchMediaCoarse()) big.appendChild(button('psn-src', '<span class="psn-src-ic">' + ic('phone') + '</span><strong>Use the camera app</strong><small>Full resolution, your phone’s focus and flash</small>', function () { st.error = ''; E.native.click(); }, { 'data-psn': 'native' }));
    hero.appendChild(big);
    hero.appendChild(h('ul', 'psn-tips', '<li>Lay the page flat, in even light.</li><li>Keep all four corners in view.</li><li>A dark table behind white paper works best.</li>'));
    hero.appendChild(h('p', 'psn-why', ic('lock') + '<span>When you take a photo, your browser asks to use the camera. The picture stays on this device.</span>'));
    v.appendChild(hero);
    acts([]);
  };

  VIEWS.camera = function () {
    E.title.textContent = st.replaceId ? 'Retake the page' : 'Take a photo';
    var wrap = h('div', 'psn-cam');
    E.video = h('video', 'psn-video', '', { playsinline: '', muted: '', autoplay: '', 'aria-label': 'Camera view' });
    E.video.muted = true;
    E.overlay = h('canvas', 'psn-overlay', '', { 'aria-hidden': 'true' });
    wrap.appendChild(E.video); wrap.appendChild(E.overlay);
    var bar = h('div', 'psn-cambar');
    bar.appendChild(button('btn psn-cam-pick', ic('photos') + '<span>Photos</span>', function () { stopCamera(); choosePhotos(); }, { 'data-psn': 'cam-pick' }));
    var shot = button('psn-shutter', '<span class="psn-sr">Take photo</span>', shoot, { 'data-psn': 'shoot', 'aria-label': 'Take photo' });
    shot.disabled = true;
    bar.appendChild(shot);
    bar.appendChild(button('btn psn-cam-done', '<span>' + (st.pages.length ? 'Done (' + st.pages.length + ')' : 'Close') + '</span>', function () { stopCamera(); show(st.pages.length ? 'tray' : 'start'); }, { 'data-psn': 'cam-done' }));
    wrap.appendChild(bar);
    E.view.appendChild(wrap);
    acts([]);
  };

  VIEWS.corners = function () {
    var c = st.cur;
    if (!c) { show(st.pages.length ? 'tray' : 'start'); return; }
    E.title.textContent = c.replaceId ? 'Adjust the corners' : 'Check the corners';
    var box = h('div', 'psn-edbox');
    E.edBox = box;
    var stage = h('div', 'psn-edstage');
    E.editor = h('canvas', 'psn-editor', '', { 'aria-label': 'Photo with the page outline. Drag a corner to move it.', role: 'img' });
    stage.appendChild(E.editor);
    E.handles = [0, 1, 2, 3].map(function (i) {
      var names = ['top left', 'top right', 'bottom right', 'bottom left'];
      var b = button('psn-handle', '', null, { 'aria-label': 'Corner ' + names[i] + '. Use the arrow keys to move it.', 'data-corner': String(i) });
      b.addEventListener('keydown', function (e) {
        var k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!k) return; e.preventDefault(); nudge(i, k[0] * (e.shiftKey ? 5 : 1), k[1] * (e.shiftKey ? 5 : 1));
      });
      stage.appendChild(b);
      return b;
    });
    box.appendChild(stage);
    E.view.appendChild(box);
    var tools = h('div', 'psn-tools', '', { role: 'toolbar', 'aria-label': 'Corners' });
    tools.appendChild(button('btn psn-tool', ic('find') + '<span>Find page</span>', function () { detectNow(); drawEditor(); setMsg(st.cur.found ? (st.cur.score < 0.7 ? 'Please check the corners.' : 'Page found.') : 'No page outline found. Drag the corners onto the page.'); }, { 'data-psn': 'auto' }));
    tools.appendChild(button('btn psn-tool', ic('full') + '<span>Whole photo</span>', function () { var w = c.canvas.width, hh = c.canvas.height; c.corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: hh }, { x: 0, y: hh }]; drawEditor(); }, { 'data-psn': 'full' }));
    tools.appendChild(button('btn psn-tool psn-tool-ic', ic('rotL'), function () { rotateCurrent(3); }, { 'data-psn': 'rot-left', 'aria-label': 'Rotate left' }));
    tools.appendChild(button('btn psn-tool psn-tool-ic', ic('rotR'), function () { rotateCurrent(1); }, { 'data-psn': 'rot-right', 'aria-label': 'Rotate right' }));
    E.view.appendChild(tools);
    bindEditor();
    var msg = c.found ? (c.score < 0.7 ? 'Please check the corners: drag any that are off the page.' : 'Page found. Drag a corner if it is off.') : 'No page outline found. Drag the corners onto the page.';
    if (!st.error) setMsg(msg);
    acts([button('btn btn-gold psn-go', '<span>Next</span>' + ic('chevron'), straighten, { 'data-psn': 'next' })]);
    requestAnimationFrame(layoutEditor);
  };

  VIEWS.clean = function () {
    var c = st.cur;
    if (!c || !c.raw) { show('corners'); return; }
    E.title.textContent = 'Clean up';
    var wrap = h('div', 'psn-clean');
    var pv = h('div', 'psn-pvbox');
    E.preview = h('canvas', 'psn-preview', '', { role: 'img', 'aria-label': 'The straightened page' });
    pv.appendChild(E.preview);
    wrap.appendChild(pv);
    E.modes = h('div', 'psn-modes', '', { role: 'group', 'aria-label': 'Clean-up' });
    MODES.forEach(function (m) {
      E.modes.appendChild(button('psn-mode', '<strong>' + esc(m[1]) + '</strong>' + (m[2] ? '<small>' + esc(m[2]) + '</small>' : ''), function () { setMsg('…'); requestAnimationFrame(function () { applyMode(m[0]).then(function () { setMsg(''); }); }); }, { 'data-mode': m[0], 'aria-pressed': String(m[0] === c.mode) }));
    });
    wrap.appendChild(E.modes);
    E.view.appendChild(wrap);
    if (!st.error) setMsg('');
    acts([
      button('btn psn-backbtn', ic('back') + '<span>Corners</span>', function () { show('corners'); }, { 'data-psn': 'to-corners' }),
      button('btn btn-gold psn-go', ic(c.replaceId ? 'pdf' : 'plus') + '<span>' + (c.replaceId ? 'Save page' : 'Add page') + '</span>', keepPage, { 'data-psn': 'add' })
    ]);
    applyMode(c.mode);
  };

  VIEWS.tray = function () {
    E.title.textContent = 'Your scan';
    var v = E.view;
    var grid = h('ol', 'psn-pages', '', { 'aria-label': 'Scanned pages' });
    st.pages.forEach(function (p, i) {
      var li = h('li', 'psn-page', '', { 'data-i': String(i) });
      li.appendChild(h('div', 'psn-thumb', '<img alt="Page ' + (i + 1) + '" src="' + esc(p.thumb) + '"><span class="psn-pn">' + (i + 1) + '</span>'));
      li.appendChild(h('p', 'psn-pmeta', esc(MODE_WORD[p.mode] || '')));
      var row = h('div', 'psn-pacts');
      var up = button('ps-ib psn-pact', ic('up'), function () { movePage(i, -1); }, { 'aria-label': 'Move page ' + (i + 1) + ' earlier', 'data-psn-move': 'up' }); up.disabled = i === 0;
      var dn = button('ps-ib psn-pact', ic('down'), function () { movePage(i, 1); }, { 'aria-label': 'Move page ' + (i + 1) + ' later', 'data-psn-move': 'down' }); dn.disabled = i === st.pages.length - 1;
      row.appendChild(up); row.appendChild(dn);
      row.appendChild(button('ps-ib psn-pact', ic('edit'), function () { editPage(i); }, { 'aria-label': 'Adjust page ' + (i + 1), 'data-psn-page': 'edit' }));
      row.appendChild(button('ps-ib psn-pact', ic('retake'), function () { retakePage(i); }, { 'aria-label': 'Retake page ' + (i + 1), 'data-psn-page': 'retake' }));
      row.appendChild(button('ps-ib psn-pact psn-del', ic('trash'), function () { deletePage(i); }, { 'aria-label': 'Delete page ' + (i + 1), 'data-psn-page': 'delete' }));
      li.appendChild(row);
      grid.appendChild(li);
    });
    var add = h('li', 'psn-page psn-addpage');
    add.appendChild(button('psn-addbtn', ic('camera') + '<span>Take a photo</span>', fresh(takePhoto), { 'data-psn': 'camera' }));
    add.appendChild(button('psn-addbtn', ic('photos') + '<span>Choose photos</span>', fresh(choosePhotos), { 'data-psn': 'pick' }));
    grid.appendChild(add);
    v.appendChild(grid);

    var opts = h('div', 'psn-opts');
    opts.appendChild(h('div', 'ps-eyebrow', 'Page size'));
    var sz = h('div', 'seg ps-seg psn-seg', '', { role: 'group', 'aria-label': 'Page size' });
    [['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Same as photo']].forEach(function (o) {
      sz.appendChild(button(null, esc(o[1]), function () { st.size = o[0]; lsSet('le-scan-size', o[0]); [].forEach.call(sz.children, function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-v') === o[0])); }); }, { 'data-v': o[0], 'aria-pressed': String(st.size === o[0]) }));
    });
    opts.appendChild(sz);
    if (PS.ocr && PS.ocr.readJobs) {
      var tg = h('label', 'ps-toggle psn-ocr');
      var cb = d.createElement('input'); cb.type = 'checkbox'; cb.checked = st.searchable; cb.setAttribute('data-psn', 'searchable');
      cb.addEventListener('change', function () { st.searchable = cb.checked; lsSet('le-scan-ocr', cb.checked ? '1' : '0'); });
      tg.appendChild(cb); tg.appendChild(h('span', 'ps-toggle-ui'));
      tg.appendChild(h('span', 'ps-toggle-text', 'Make it searchable too<small>Reads the text in the pages on this device, so you can search and copy it.</small>'));
      opts.appendChild(tg);
    }
    v.appendChild(opts);
    v.appendChild(button('btn btn-quiet psn-discard', ic('trash') + '<span>Discard this scan</span>', function () {
      var go = function () { discardAll(); show('start'); say('Scan discarded.'); };
      if (PS.dialog) PS.dialog({ title: 'Discard this scan?', text: plural(st.pages.length, 'page') + ' will be removed from this device.', ok: 'Discard' }).then(function (ok) { if (ok) go(); });
      else go();
    }, { 'data-psn': 'discard' }));
    acts([
      button('btn psn-dl', ic('download') + '<span>Download PDF</span>', function () { makePdf('download'); }, { 'data-psn': 'download' }),
      button('btn btn-gold psn-go', ic('pdf') + '<span>Make PDF</span>', function () { makePdf('studio'); }, { 'data-psn': 'make' })
    ]);
    if (!st.error) setMsg('Make PDF opens it in the studio, where you can sign, edit or save it.');
  };

  function matchMediaCoarse() { try { return global.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
  global.addEventListener('resize', function () { if (W && !W.hidden && st.view === 'corners') layoutEditor(); });

  /* ---------- entry points: the Scan panel card, the start screen, ?panel=scan&job=camera ---------- */

  function card() {
    var s = h('section', 'ps-sec psn-card');
    s.appendChild(h('h3', 'ps-sec-title', 'Scan paper with your camera'));
    s.appendChild(h('p', 'ps-note', 'Finds the page edges, straightens the page, cleans it up and makes a PDF. Works with photos you already have, too.'));
    var label = st.pages.length ? 'Continue your scan (' + plural(st.pages.length, 'page') + ')' : 'Scan with camera';
    s.appendChild(button(S.pages.length ? 'btn btn-block psn-open' : 'btn btn-gold btn-block psn-open', ic('camera') + '<span>' + esc(label) + '</span>', function () { open(); }, { 'data-psn-open': 'panel' }));
    return s;
  }
  if (PS.ocr && PS.ocr.addSection) PS.ocr.addSection({ order: 2, render: card });
  else PS.panels.scan = PS.panels.scan || { title: 'Scan', icon: 'images', tone: 'sapphire', snap: 'half', noDoc: true, build: function (pane) { pane.appendChild(card()); } };

  function addEntryPoints() {
    var starts = d.querySelector('.ps-empty .ps-starts');
    if (starts && !starts.querySelector('[data-psn-open]')) {
      var tile = button('ps-start psn-start', '<span class="ic ic-sapphire">' + ic('camera') + '</span><strong>Scan with camera</strong><small>Paper to a clean PDF</small>', function () { open(); }, { 'data-psn-open': 'start' });
      var after = starts.querySelector('[data-intent="images"]');
      starts.insertBefore(tile, after ? after.nextSibling : null);
    }
    var q = null;
    try { q = new URLSearchParams(global.location.search); } catch (e) { q = null; }
    if (q && q.get('panel') === 'scan' && q.get('job') === 'camera') open();
  }

  PS.scan = { open: open, close: close, state: st, addPhotos: onFiles, makePdf: makePdf, show: function (v) { show(v); } };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(addEntryPoints, 0); });
  else setTimeout(addEntryPoints, 0);
})(window);
