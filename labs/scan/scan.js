/* LocalEditor phone camera to clean scan.  window.LE.scan   (plain JS + canvas, no dependency except pdf-lib for the PDF export)
 *
 *   LE.scan.detect(source, { maxSide })                 -> { corners:[{x,y}x4 clockwise from top-left, source pixels], score, method, ms } | null
 *   LE.scan.warp(source, corners, { maxSide, aspect })  -> canvas   (perspective-corrected, flat page; aspect 'auto' | 'a4' | 'letter' | w/h number)
 *   LE.scan.enhance(canvas, mode)                       -> canvas   (in place) mode: 'color' | 'gray' | 'bw' | 'whiten' | 'none'
 *   LE.scan.exportPdf(pages, { size, quality, dpi })    -> Promise<Uint8Array>   pages: [{ canvas, mode }]
 *   LE.scan.camera.start(video, opts) / capture(video) / stop(video)
 *   LE.scan.orderCorners(pts), LE.scan.aspectOf(corners, w, h)
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
    var cap = opts.maxSource || 3600, ss = Math.min(1, cap / Math.max(sz.w, sz.h)), sw = Math.round(sz.w * ss), sh = Math.round(sz.h * ss);
    var sc = makeCanvas(sw, sh), sx = ctx2(sc); sx.drawImage(source, 0, 0, sw, sh);
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

  LE.scan = { detect: detect, warp: warp, enhance: enhance, rotate90: rotate90, exportPdf: exportPdf, camera: camera, orderCorners: orderCorners, aspectOf: aspectOf, solveHomography: solveHomography, version: 1 };
})(window);
