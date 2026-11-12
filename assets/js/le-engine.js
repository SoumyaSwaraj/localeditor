/* LocalEditor engine.
   Recipes are data. Imported files never run script, HTML, or unknown operations. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

  function ctx2(canvas) {
    return canvas.getContext('2d', { willReadFrequently: true });
  }

  function clone(canvas) {
    var c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    ctx2(c).drawImage(canvas, 0, 0);
    return c;
  }

  function formatBytes(b) {
    if (b == null || !isFinite(b)) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? Math.round(b * 10) / 10 : Math.round(b)) + ' ' + u[i];
  }

  function cleanStr(s, max) {
    s = String(s == null ? '' : s).replace(/[<>]/g, '');
    return s.length > max ? s.slice(0, max) : s;
  }

  function hexToRgb(hex) {
    hex = String(hex || '#ffffff').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex.slice(0, 6), 16);
    if (!isFinite(n)) n = 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return ('0' + clamp8(v).toString(16)).slice(-2); }).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var r, g, b;
    if (!s) r = g = b = l;
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue(p, q, h + 1 / 3);
      g = hue(p, q, h);
      b = hue(p, q, h - 1 / 3);
    }
    return [r * 255, g * 255, b * 255];
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  LE.formatBytes = formatBytes;
  LE.clone = clone;
  LE.device = {
    tier: function () {
      var mem = navigator.deviceMemory || 8;
      var cores = navigator.hardwareConcurrency || 8;
      var narrow = Math.min(screen.width, screen.height) < 900;
      if (mem <= 2 || (mem <= 3 && cores <= 4)) return 'older';
      if (narrow) return 'modern';
      return 'desktop';
    }
  };

  LE.fit = function (canvas, max) {
    var scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
    if (scale >= 0.999) return clone(canvas);
    return resize(canvas, {
      width: Math.max(1, Math.round(canvas.width * scale)),
      height: Math.max(1, Math.round(canvas.height * scale)),
      mode: 'high'
    });
  };

  function resize(canvas, p) {
    var w = p.width, h = p.height;
    if (p.percent) {
      w = Math.round(canvas.width * p.percent / 100);
      h = Math.round(canvas.height * p.percent / 100);
    } else if (p.maxWidth && canvas.width > p.maxWidth) {
      h = Math.max(1, Math.round(canvas.height * p.maxWidth / canvas.width));
      w = p.maxWidth;
    } else if (p.maxWidth && !p.width) {
      return clone(canvas);
    }
    w = clamp(Math.round(w || canvas.width), 1, 16000);
    h = clamp(Math.round(h || canvas.height), 1, 16000);
    if (p.lock && p.width && !p.percent && !p.maxWidth) {
      h = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = ctx2(c);
    ctx.imageSmoothingEnabled = p.mode !== 'nearest';
    ctx.imageSmoothingQuality = p.mode === 'bilinear' ? 'low' : 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
    return c;
  }

  function crop(canvas, p) {
    var x = Math.round(clamp(num(p.x, 0), 0, 1) * canvas.width);
    var y = Math.round(clamp(num(p.y, 0), 0, 1) * canvas.height);
    var w = Math.round(clamp(num(p.w, 1), 0.01, 1) * canvas.width);
    var h = Math.round(clamp(num(p.h, 1), 0.01, 1) * canvas.height);
    w = Math.max(1, Math.min(w, canvas.width - x));
    h = Math.max(1, Math.min(h, canvas.height - y));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    ctx2(c).drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return c;
  }

  function rotate(canvas, p) {
    var rad = ((num(p.degrees, 0) % 360) * Math.PI) / 180;
    var sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * cos + canvas.height * sin));
    c.height = Math.max(1, Math.round(canvas.width * sin + canvas.height * cos));
    var ctx = ctx2(c);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return c;
  }

  function flip(canvas, p) {
    var c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    var ctx = ctx2(c);
    if (p.axis === 'vertical') { ctx.translate(0, c.height); ctx.scale(1, -1); }
    else { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(canvas, 0, 0);
    return c;
  }

  function boxBlur(data, w, h, r) {
    r = Math.max(1, r | 0);
    var tmp = new Uint8ClampedArray(data.length);
    var x, y, k, idx, rs, gs, bs, as, count, xx, yy;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        rs = gs = bs = as = count = 0;
        for (k = -r; k <= r; k++) {
          xx = x + k; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          idx = (y * w + xx) * 4;
          rs += data[idx]; gs += data[idx + 1]; bs += data[idx + 2]; as += data[idx + 3];
          count++;
        }
        idx = (y * w + x) * 4;
        tmp[idx] = rs / count; tmp[idx + 1] = gs / count; tmp[idx + 2] = bs / count; tmp[idx + 3] = as / count;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        rs = gs = bs = as = count = 0;
        for (k = -r; k <= r; k++) {
          yy = y + k; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          idx = (yy * w + x) * 4;
          rs += tmp[idx]; gs += tmp[idx + 1]; bs += tmp[idx + 2]; as += tmp[idx + 3];
          count++;
        }
        idx = (y * w + x) * 4;
        data[idx] = rs / count; data[idx + 1] = gs / count; data[idx + 2] = bs / count; data[idx + 3] = as / count;
      }
    }
  }

  function blurCanvas(canvas, radius) {
    var ctx = ctx2(canvas);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var r = Math.max(1, Math.round(radius));
    boxBlur(img.data, canvas.width, canvas.height, r);
    boxBlur(img.data, canvas.width, canvas.height, Math.max(1, Math.round(r * 0.6)));
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function motionBlur(canvas, radius, angle) {
    var rad = (num(angle, 0) * Math.PI) / 180;
    var dx = Math.cos(rad), dy = Math.sin(rad);
    var ctx = ctx2(canvas);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var src = new Uint8ClampedArray(img.data);
    var w = canvas.width, h = canvas.height, d = img.data;
    var steps = Math.max(1, radius | 0);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var r = 0, g = 0, b = 0, a = 0, c = 0;
        for (var k = -steps; k <= steps; k++) {
          var xx = Math.round(x + dx * k), yy = Math.round(y + dy * k);
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          var i = (yy * w + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; c++;
        }
        var o = (y * w + x) * 4;
        if (c) { d[o] = r / c; d[o + 1] = g / c; d[o + 2] = b / c; d[o + 3] = a / c; }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function sharpen(canvas, amount) {
    if (amount <= 0) return canvas;
    var w = canvas.width, h = canvas.height;
    var ctx = ctx2(canvas);
    var img = ctx.getImageData(0, 0, w, h);
    var src = new Uint8ClampedArray(img.data);
    var blurred = new Uint8ClampedArray(src);
    boxBlur(blurred, w, h, 1);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = clamp8(src[i] + (src[i] - blurred[i]) * amount * 1.5);
      d[i + 1] = clamp8(src[i + 1] + (src[i + 1] - blurred[i + 1]) * amount * 1.5);
      d[i + 2] = clamp8(src[i + 2] + (src[i + 2] - blurred[i + 2]) * amount * 1.5);
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function curveMap(v, points) {
    var t = v / 255;
    for (var i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        var a = points[i - 1], b = points[i];
        var u = (t - a[0]) / ((b[0] - a[0]) || 1);
        return (a[1] + (b[1] - a[1]) * u) * 255;
      }
    }
    return v;
  }

  var PRESETS = {
    vivid: { contrast: 14, saturation: 28, vibrance: 18 },
    warm: { temperature: 16, saturation: 10, exposure: 0.06 },
    cool: { temperature: -14, contrast: 8, tint: -4 },
    cinematic: { contrast: 20, saturation: -10, temperature: 10, vignette: 0.4, shadows: 12, highlights: -8 },
    mono: { saturation: -100, contrast: 15 },
    film: { contrast: 8, saturation: -15, temperature: 12, vignette: 0.28, grain: 14 },
    fade: { contrast: -18, brightness: 10, saturation: -8 },
    golden: { temperature: 24, exposure: 0.1, saturation: 12, highlights: -12 },
    noir: { saturation: -100, contrast: 32, brightness: -4, vignette: 0.5 },
    portrait: { exposure: 0.08, contrast: 6, temperature: 8, saturation: -4, sharpness: 20 },
    vintage: { contrast: -6, saturation: -20, temperature: 18, vignette: 0.22, grain: 12 }
  };
  LE.presets = {
    filters: PRESETS,
    ratios: [['Free', 0], ['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['16:9', 16 / 9], ['9:16', 9 / 16]],
    sizes: [
      ['Instagram post', 1080, 1080],
      ['Instagram portrait', 1080, 1350],
      ['Story or Reel', 1080, 1920],
      ['LinkedIn post', 1200, 1200],
      ['LinkedIn banner', 1584, 396],
      ['YouTube thumbnail', 1280, 720],
      ['YouTube banner', 2560, 1440],
      ['Pinterest', 1000, 1500],
      ['Facebook cover', 820, 312],
      ['X post', 1600, 900]
    ]
  };

  function adjust(canvas, p) {
    p = p || {};
    var ctx = ctx2(canvas);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data, w = canvas.width, h = canvas.height;
    var exposure = num(p.exposure, 0), brightness = num(p.brightness, 0), contrast = num(p.contrast, 0);
    var saturation = num(p.saturation, 0), vibrance = num(p.vibrance, 0);
    var temperature = num(p.temperature, 0), tint = num(p.tint, 0), hue = num(p.hue, 0);
    var highlights = num(p.highlights, 0), shadows = num(p.shadows, 0);
    var vignette = num(p.vignette, 0), grain = num(p.grain, 0);
    var black = num(p.black, 0), white = p.white == null ? 255 : num(p.white, 255), gamma = p.gamma == null ? 1 : num(p.gamma, 1);
    var rOff = num(p.red, 0), gOff = num(p.green, 0), bOff = num(p.blue, 0);
    var points = p.points;
    var fade = clamp(num(p.fade, 0), 0, 100) / 100;
    var fadeLo = fade * 70, fadeK = (255 - fade * 18 - fadeLo) / 255;
    var split = splitTone(p);
    var cx = w / 2, cy = h / 2, maxd = Math.sqrt(cx * cx + cy * cy) || 1;
    var doLevels = black || white !== 255 || gamma !== 1;
    function level(v) {
      var t = (v - black) / ((white - black) || 1);
      t = clamp(t, 0, 1);
      return Math.pow(t, 1 / (gamma || 1)) * 255;
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var r = d[i], g = d[i + 1], b = d[i + 2];
        if (doLevels) { r = level(r); g = level(g); b = level(b); }
        if (exposure) { var ev = Math.pow(2, exposure); r *= ev; g *= ev; b *= ev; }
        if (brightness) { var br = brightness * 2.55; r += br; g += br; b += br; }
        if (contrast) {
          var ct = 1 + contrast / 100;
          r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; b = (b - 128) * ct + 128;
        }
        if (highlights || shadows) {
          var l = clamp((r + g + b) / 3 / 255, 0, 1);
          var lift = (shadows / 100) * (1 - l) * 180 - (highlights / 100) * l * 180;
          r += lift; g += lift; b += lift;
        }
        if (temperature) { r += temperature * 1.15; b -= temperature * 1.15; }
        if (tint) g += tint;
        if (hue) {
          var hsl = rgbToHsl(clamp8(r), clamp8(g), clamp8(b));
          var rgb = hslToRgb((hsl[0] + hue / 360 + 1) % 1, hsl[1], hsl[2]);
          r = rgb[0]; g = rgb[1]; b = rgb[2];
        }
        if (saturation || vibrance) {
          var avg = (r + g + b) / 3;
          var sat = saturation / 100;
          if (vibrance) {
            var maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
            var sv = maxc === 0 ? 0 : (maxc - minc) / maxc;
            sat += (vibrance / 100) * (1 - sv);
          }
          r = avg + (r - avg) * (1 + sat);
          g = avg + (g - avg) * (1 + sat);
          b = avg + (b - avg) * (1 + sat);
        }
        if (rOff || gOff || bOff) { r += rOff; g += gOff; b += bOff; }
        if (points && points.length > 1) { r = curveMap(r, points); g = curveMap(g, points); b = curveMap(b, points); }
        if (split) {
          var sl = clamp((0.299 * r + 0.587 * g + 0.114 * b) / 255, 0, 1);
          var ws = (1 - sl) * (1 - sl) * Math.min(1, sl * 4 + 0.1) * split.ws, wh = sl * sl * Math.min(1, (1 - sl) * 4 + 0.1) * split.wh;
          r += split.s[0] * ws + split.h[0] * wh;
          g += split.s[1] * ws + split.h[1] * wh;
          b += split.s[2] * ws + split.h[2] * wh;
        }
        if (fade) { r = fadeLo + r * fadeK; g = fadeLo + g * fadeK; b = fadeLo + b * fadeK; }
        if (vignette) {
          var dx = x - cx, dy = y - cy;
          var f = 1 - vignette * Math.pow(Math.sqrt(dx * dx + dy * dy) / maxd, 1.6);
          r *= f; g *= f; b *= f;
        }
        if (grain) {
          var n = ((Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0) % 1000 / 1000;
          var gn = (n - 0.5) * grain;
          r += gn; g += gn; b += gn;
        }
        d[i] = clamp8(r); d[i + 1] = clamp8(g); d[i + 2] = clamp8(b);
      }
    }
    var clarity = clamp(num(p.clarity, 0), -100, 100);
    if (clarity) localContrast(d, w, h, clarity / 100);
    ctx.putImageData(img, 0, 0);
    if (p.sharpness) sharpen(canvas, clamp(p.sharpness, 0, 100) / 100);
    return canvas;
  }

  /* Split toning: a colour pushed into the shadows and another into the highlights.
     Hues are degrees, amounts 0-100, balance -100 (favour shadows) to 100 (favour highlights). */
  function splitTone(p) {
    var sa = clamp(num(p.splitShadowAmount, 0), 0, 100) / 100;
    var ha = clamp(num(p.splitHighlightAmount, 0), 0, 100) / 100;
    if (!sa && !ha) return null;
    var bal = clamp(num(p.splitBalance, 0), -100, 100) / 100;
    function chroma(deg) {
      var c = hslToRgb(((num(deg, 0) % 360) + 360) % 360 / 360, 1, 0.5);
      var m = (c[0] + c[1] + c[2]) / 3;
      return [(c[0] - m) * 0.55, (c[1] - m) * 0.55, (c[2] - m) * 0.55];
    }
    var s = chroma(p.splitShadowHue == null ? 210 : p.splitShadowHue);
    var hh = chroma(p.splitHighlightHue == null ? 40 : p.splitHighlightHue);
    return { s: s, h: hh, ws: sa * 2 * (1 - Math.max(0, bal)), wh: ha * 2 * (1 + Math.min(0, bal)) };
  }

  /* Clarity: midtone local contrast from a wide, fast box blur of luminance. */
  function lumaBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    var x, y, acc, i, n = 2 * r + 1;
    for (y = 0; y < h; y++) {
      var row = y * w;
      acc = 0;
      for (i = -r; i <= r; i++) acc += src[row + clamp(i, 0, w - 1)];
      for (x = 0; x < w; x++) {
        tmp[row + x] = acc / n;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      acc = 0;
      for (i = -r; i <= r; i++) acc += tmp[clamp(i, 0, h - 1) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  function localContrast(d, w, h, amount) {
    var lum = new Float32Array(w * h), i, j;
    for (i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    var r = Math.max(2, Math.round(Math.max(w, h) / 70));
    var blur = lumaBlur(lumaBlur(lum, w, h, r), w, h, r);
    var k = amount * 1.6;
    for (i = 0, j = 0; j < lum.length; i += 4, j++) {
      var l = lum[j] / 255;
      var mask = 4 * l * (1 - l);
      var delta = (lum[j] - blur[j]) * k * mask;
      d[i] = clamp8(d[i] + delta); d[i + 1] = clamp8(d[i + 1] + delta); d[i + 2] = clamp8(d[i + 2] + delta);
    }
  }

  function border(canvas, p) {
    var pad = clamp(num(p.padding, 24), 0, 800);
    var bw = clamp(num(p.size, 0), 0, 400);
    var radius = clamp(num(p.radius, 0), 0, 800);
    var margin = p.shadow ? 36 : 0;
    var w = canvas.width + (pad + bw) * 2 + margin * 2;
    var h = canvas.height + (pad + bw) * 2 + margin * 2;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = ctx2(c);
    if (p.background) { ctx.fillStyle = p.background; ctx.fillRect(0, 0, w, h); }
    var x = margin, y = margin, iw = w - margin * 2, ih = h - margin * 2;
    roundRect(ctx, x, y, iw, ih, radius + bw);
    ctx.fillStyle = p.color || '#ffffff';
    ctx.fill();
    ctx.save();
    roundRect(ctx, x + bw + pad, y + bw + pad, canvas.width, canvas.height, Math.max(0, radius - 2));
    ctx.clip();
    ctx.drawImage(canvas, x + bw + pad, y + bw + pad);
    ctx.restore();
    if (p.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(20,16,28,.28)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      roundRect(ctx, x, y, iw, ih, radius + bw);
      ctx.strokeStyle = 'rgba(0,0,0,0)';
      ctx.stroke();
      ctx.restore();
    }
    return c;
  }

  function drawText(canvas, p) {
    var text = String(p.text || '');
    if (!text) return canvas;
    var ctx = ctx2(canvas);
    var size = Math.max(8, Math.round(num(p.size, 0.06) * canvas.width));
    ctx.save();
    ctx.font = (p.weight || 700) + ' ' + size + 'px ' + (p.font || 'Segoe UI, sans-serif');
    ctx.textAlign = p.align || 'center';
    ctx.textBaseline = 'middle';
    var x = (p.x == null ? 0.5 : num(p.x, 0.5)) * canvas.width;
    var y = (p.y == null ? 0.5 : num(p.y, 0.5)) * canvas.height;
    var width = ctx.measureText(text).width;
    ctx.translate(x, y);
    if (p.rotate) ctx.rotate(num(p.rotate, 0) * Math.PI / 180);
    if (p.background) {
      var padX = size * 0.35;
      var bx = p.align === 'left' ? 0 : p.align === 'right' ? -width : -width / 2;
      ctx.fillStyle = p.background;
      roundRect(ctx, bx - padX, -size * 0.72, width + padX * 2, size * 1.45, size * 0.22);
      ctx.fill();
    }
    if (p.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = size * 0.08;
      ctx.shadowOffsetY = size * 0.04;
    }
    if (p.outline) {
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.strokeStyle = p.outline;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillStyle = p.color || '#1B1722';
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return canvas;
  }

  function drawWatermark(canvas, p, image) {
    var ctx = ctx2(canvas);
    ctx.save();
    ctx.globalAlpha = clamp(p.opacity == null ? 0.4 : num(p.opacity, 0.4), 0, 1);
    if (image) {
      var scale = clamp(num(p.scale, 0.2), 0.05, 1);
      var dw = canvas.width * scale;
      var dh = image.height * (dw / image.width);
      var x = (p.x == null ? 1 : num(p.x, 1)) * canvas.width - dw - canvas.width * 0.04;
      var y = (p.y == null ? 1 : num(p.y, 1)) * canvas.height - dh - canvas.height * 0.04;
      if (p.tile) {
        for (var yy = 0; yy < canvas.height; yy += dh + 24) {
          for (var xx = 0; xx < canvas.width; xx += dw + 24) ctx.drawImage(image, xx, yy, dw, dh);
        }
      } else ctx.drawImage(image, x, y, dw, dh);
    } else if (p.tile) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-0.45);
      ctx.font = '700 ' + Math.round(canvas.width * clamp(num(p.scale, 0.045), 0.02, 0.2)) + 'px Segoe UI, sans-serif';
      ctx.fillStyle = p.color || '#ffffff';
      ctx.textAlign = 'center';
      var step = canvas.width * 0.32;
      for (var y2 = -canvas.height; y2 < canvas.height; y2 += step) {
        for (var x2 = -canvas.width; x2 < canvas.width; x2 += step) ctx.fillText(p.text || 'LocalEditor', x2, y2);
      }
    } else {
      ctx.font = '700 ' + Math.round(canvas.width * clamp(num(p.scale, 0.045), 0.02, 0.2)) + 'px Segoe UI, sans-serif';
      ctx.fillStyle = p.color || '#ffffff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      var px = (p.x == null ? 0.96 : num(p.x, 0.96)) * canvas.width;
      var py = (p.y == null ? 0.96 : num(p.y, 0.96)) * canvas.height;
      ctx.fillText(p.text || '', px, py);
    }
    ctx.restore();
    return canvas;
  }

  function drawShape(canvas, p) {
    var ctx = ctx2(canvas);
    ctx.save();
    ctx.globalAlpha = clamp(p.opacity == null ? 1 : num(p.opacity, 1), 0, 1);
    var x = num(p.x, 0.1) * canvas.width;
    var y = num(p.y, 0.1) * canvas.height;
    var w = num(p.w, 0.3) * canvas.width;
    var h = num(p.h, 0.2) * canvas.height;
    if (p.kind === 'emoji') {
      ctx.font = Math.round(Math.abs(w) || canvas.width * 0.12) + 'px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.text || '★', x, y);
      ctx.restore();
      return canvas;
    }
    ctx.beginPath();
    if (p.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    else if (p.kind === 'line' || p.kind === 'arrow') { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); }
    else ctx.rect(x, y, w, h);
    if (p.fill && p.kind !== 'line' && p.kind !== 'arrow') { ctx.fillStyle = p.fill; ctx.fill(); }
    if (p.stroke || p.kind === 'line') {
      ctx.strokeStyle = p.stroke || p.fill || '#1B1722';
      ctx.lineWidth = num(p.strokeWidth, 4);
      ctx.stroke();
    }
    if (p.kind === 'arrow') {
      var ang = Math.atan2(h, w);
      var x2 = x + w, y2 = y + h, head = Math.max(12, num(p.strokeWidth, 4) * 4);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
      ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = p.stroke || '#1B1722';
      ctx.fill();
    }
    ctx.restore();
    return canvas;
  }

  function background(canvas, p) {
    var key = hexToRgb(p.color || '#ffffff');
    var tol = clamp(num(p.tolerance, 28), 0, 100);
    var maxDist = (tol / 100) * 180 + 8;
    var ctx = ctx2(canvas);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var dist = Math.sqrt(Math.pow(d[i] - key[0], 2) + Math.pow(d[i + 1] - key[1], 2) + Math.pow(d[i + 2] - key[2], 2));
      if (dist <= maxDist) d[i + 3] = Math.round(d[i + 3] * (dist / (maxDist || 1)));
    }
    ctx.putImageData(img, 0, 0);
    if (p.replace) return flatten(canvas, p.replace);
    return canvas;
  }

  function applyMask(canvas, maskCanvas) {
    var ctx = ctx2(canvas);
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var m = document.createElement('canvas');
    m.width = canvas.width; m.height = canvas.height;
    ctx2(m).drawImage(maskCanvas, 0, 0, m.width, m.height);
    var md = ctx2(m).getImageData(0, 0, m.width, m.height).data;
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) d[i + 3] = Math.round(d[i + 3] * (md[i] / 255));
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function flatten(canvas, color) {
    var c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    var ctx = ctx2(c);
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
    return c;
  }

  function social(canvas, p) {
    var c = document.createElement('canvas');
    c.width = clamp(num(p.width, 1080), 1, 8000);
    c.height = clamp(num(p.height, 1080), 1, 8000);
    var ctx = ctx2(c);
    ctx.fillStyle = p.background || '#111111';
    ctx.fillRect(0, 0, c.width, c.height);
    var s = p.fit === 'contain'
      ? Math.min(c.width / canvas.width, c.height / canvas.height)
      : Math.max(c.width / canvas.width, c.height / canvas.height);
    var dw = canvas.width * s, dh = canvas.height * s;
    ctx.drawImage(canvas, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    return c;
  }

  function meme(canvas, p) {
    var c = clone(canvas);
    var ctx = ctx2(c);
    var size = Math.round(c.width * clamp(num(p.scale, 0.085), 0.04, 0.16));
    ctx.font = '900 ' + size + 'px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    function write(text, y, baseline) {
      if (!text) return;
      ctx.textBaseline = baseline;
      ctx.strokeText(String(text).toUpperCase(), c.width / 2, y);
      ctx.fillText(String(text).toUpperCase(), c.width / 2, y);
    }
    write(p.top, size * 0.2, 'top');
    write(p.bottom, c.height - size * 0.15, 'bottom');
    return c;
  }

  function upscale(canvas, p, tier) {
    var factor = clamp(num(p.factor, 2), 1, 4);
    var notice = null;
    if (tier === 'older' && factor > 2) {
      factor = 2;
      notice = { level: 'optimized', message: 'Upscale ran at 2× so this device stays responsive. The recipe asked for more.' };
    }
    var pixels = canvas.width * canvas.height * factor * factor;
    if (pixels > 24000000) {
      factor = Math.sqrt(24000000 / (canvas.width * canvas.height));
      notice = { level: 'optimized', message: 'The enlarged image was capped so this device does not run out of memory.' };
    }
    var c = resize(canvas, {
      width: Math.max(1, Math.round(canvas.width * factor)),
      height: Math.max(1, Math.round(canvas.height * factor)),
      mode: 'high'
    });
    sharpen(c, 0.35);
    return { canvas: c, notice: notice };
  }

  function cover(ctx, image, x, y, w, h, radius) {
    var s = Math.max(w / image.width, h / image.height);
    var dw = image.width * s, dh = image.height * s;
    ctx.save();
    roundRect(ctx, x, y, w, h, radius || 0);
    ctx.clip();
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  LE.collage = function (images, opts) {
    opts = opts || {};
    var W = opts.width || 1600;
    var ratio = opts.ratio || 1;
    var H = Math.round(W / ratio);
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = ctx2(c);
    ctx.fillStyle = opts.background || '#F3F2F5';
    ctx.fillRect(0, 0, W, H);
    var cols = clamp(opts.columns || 2, 1, 6);
    var gap = opts.gap == null ? 14 : opts.gap;
    var pad = opts.padding == null ? 18 : opts.padding;
    if (opts.layout === 'free' && opts.placements) {
      images.forEach(function (im, i) {
        var pl = opts.placements[i] || { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };
        cover(ctx, im, pl.x * W, pl.y * H, pl.w * W, pl.h * H, opts.radius || 0);
      });
      return c;
    }
    var rows = Math.max(1, Math.ceil(images.length / cols));
    var cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    var ch = (H - pad * 2 - gap * (rows - 1)) / rows;
    images.forEach(function (im, i) {
      var col = i % cols, row = Math.floor(i / cols);
      cover(ctx, im, pad + col * (cw + gap), pad + row * (ch + gap), cw, ch, opts.radius || 0);
    });
    return c;
  };

  LE.contactSheet = function (images, opts) {
    opts = opts || {};
    var cols = clamp(opts.columns || 3, 1, 8);
    var rows = Math.max(1, Math.ceil(images.length / cols));
    var cell = opts.cell || 280;
    var gap = opts.gap == null ? 16 : opts.gap;
    var labelH = opts.names || opts.numbers ? 28 : 0;
    var pad = 24;
    var c = document.createElement('canvas');
    c.width = pad * 2 + cols * cell + (cols - 1) * gap;
    c.height = pad * 2 + rows * (cell + labelH) + (rows - 1) * gap;
    var ctx = ctx2(c);
    ctx.fillStyle = opts.background || '#F6F5F8';
    ctx.fillRect(0, 0, c.width, c.height);
    images.forEach(function (im, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var x = pad + col * (cell + gap);
      var y = pad + row * (cell + labelH + gap);
      cover(ctx, im.canvas || im, x, y, cell, cell, 8);
      ctx.fillStyle = '#1B1722';
      ctx.font = '600 13px Segoe UI, sans-serif';
      var label = (opts.numbers ? (i + 1) + '  ' : '') + (opts.names ? (im.name || '') : '');
      if (label) ctx.fillText(label.slice(0, 32), x, y + cell + 18);
    });
    return c;
  };

  LE.sideBySide = function (before, after, labels) {
    labels = labels || {};
    var h = Math.max(before.height, after.height, 1);
    function scale(src) {
      var s = h / src.height;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * s));
      c.height = h;
      ctx2(c).drawImage(src, 0, 0, c.width, c.height);
      return c;
    }
    var a = scale(before), b = scale(after);
    var c = document.createElement('canvas');
    c.width = a.width + b.width + 8;
    c.height = h + 36;
    var ctx = ctx2(c);
    ctx.fillStyle = '#F3F2F5';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 36);
    ctx.drawImage(b, a.width + 8, 36);
    ctx.fillStyle = '#1B1722';
    ctx.font = '650 16px Segoe UI, sans-serif';
    ctx.fillText(labels.before || 'Before', 12, 24);
    ctx.fillText(labels.after || 'After', a.width + 20, 24);
    return c;
  };

  LE.histogram = function (canvas) {
    var tiny = canvas.width * canvas.height > 400000 ? LE.fit(canvas, 400) : canvas;
    var d = ctx2(tiny).getImageData(0, 0, tiny.width, tiny.height).data;
    var r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
    for (var i = 0; i < d.length; i += 16) { r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; }
    return { r: r, g: g, b: b };
  };

  function channelRange(pixels) {
    var min = [255, 255, 255], max = [0, 0, 0];
    pixels.forEach(function (p) {
      for (var c = 0; c < 3; c++) { if (p[c] < min[c]) min[c] = p[c]; if (p[c] > max[c]) max[c] = p[c]; }
    });
    var channel = 0, range = max[0] - min[0];
    if (max[1] - min[1] > range) { channel = 1; range = max[1] - min[1]; }
    if (max[2] - min[2] > range) { channel = 2; range = max[2] - min[2]; }
    return { channel: channel, range: range };
  }

  LE.palette = {
    extract: function (canvas, count) {
      count = clamp(count || 6, 2, 8);
      var tiny = LE.fit(canvas, 180);
      var data = ctx2(tiny).getImageData(0, 0, tiny.width, tiny.height).data;
      var pixels = [];
      for (var i = 0; i < data.length; i += 16) {
        if (data[i + 3] < 140) continue;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      if (!pixels.length) return [];
      var boxes = [pixels];
      while (boxes.length < count) {
        var bi = 0, best = -1, info;
        for (var b = 0; b < boxes.length; b++) {
          info = channelRange(boxes[b]);
          if (info.range > best && boxes[b].length > 1) { best = info.range; bi = b; }
        }
        if (best < 4) break;
        var ch = channelRange(boxes[bi]).channel;
        var box = boxes.splice(bi, 1)[0];
        box.sort(function (a, c) { return a[ch] - c[ch]; });
        var mid = Math.max(1, box.length >> 1);
        boxes.push(box.slice(0, mid), box.slice(mid));
      }
      return boxes.map(function (box) {
        var r = 0, g = 0, b = 0;
        box.forEach(function (p) { r += p[0]; g += p[1]; b += p[2]; });
        r = Math.round(r / box.length); g = Math.round(g / box.length); b = Math.round(b / box.length);
        var hsl = rgbToHsl(r, g, b);
        return {
          hex: rgbToHex(r, g, b),
          rgb: [r, g, b],
          hsl: [Math.round(hsl[0] * 360), Math.round(hsl[1] * 100), Math.round(hsl[2] * 100)]
        };
      });
    },
    harmony: function (hex) {
      var rgb = hexToRgb(hex);
      var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      function at(turn) {
        var out = hslToRgb((hsl[0] + turn + 1) % 1, hsl[1], hsl[2]);
        return rgbToHex(out[0], out[1], out[2]);
      }
      return { complementary: at(0.5), analogous: [at(-0.08), hex, at(0.08)] };
    },
    swatch: function (colors) {
      var c = document.createElement('canvas');
      c.width = colors.length * 120; c.height = 160;
      var ctx = ctx2(c);
      colors.forEach(function (color, i) {
        ctx.fillStyle = color.hex;
        ctx.fillRect(i * 120, 0, 120, 120);
        ctx.fillStyle = '#1B1722';
        ctx.font = '600 14px Segoe UI, sans-serif';
        ctx.fillText(color.hex.toUpperCase(), i * 120 + 10, 144);
      });
      return c;
    }
  };

  LE.sample = function (kind) {
    var portrait = kind === 'portrait';
    var c = document.createElement('canvas');
    c.width = portrait ? 900 : 1200;
    c.height = portrait ? 1200 : 800;
    var ctx = ctx2(c);
    var g = ctx.createLinearGradient(0, 0, 0, c.height);
    if (portrait) {
      g.addColorStop(0, '#8AA4C8');
      g.addColorStop(0.5, '#E4D0C2');
      g.addColorStop(1, '#6D5874');
    } else {
      g.addColorStop(0, '#7EA0C4');
      g.addColorStop(0.55, '#E7C59A');
      g.addColorStop(1, '#6E8A62');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(244, 215, 162, .95)';
    ctx.beginPath();
    ctx.arc(c.width * 0.72, c.height * 0.28, portrait ? 70 : 86, 0, Math.PI * 2);
    ctx.fill();
    if (portrait) {
      ctx.fillStyle = '#E8C4AA';
      ctx.beginPath();
      ctx.ellipse(c.width / 2, c.height * 0.42, 120, 156, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#C9957A';
      ctx.beginPath();
      ctx.ellipse(c.width / 2, c.height * 0.8, 230, 200, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#35543A';
      ctx.beginPath();
      ctx.moveTo(0, c.height * 0.64);
      ctx.quadraticCurveTo(c.width * 0.35, c.height * 0.46, c.width, c.height * 0.72);
      ctx.lineTo(c.width, c.height);
      ctx.lineTo(0, c.height);
      ctx.fill();
    }
    return c;
  };

  function loadDataImage(url) {
    return new Promise(function (res, rej) {
      if (typeof url !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url)) {
        rej(new Error('Watermark images must be PNG, JPEG, or WebP.'));
        return;
      }
      if (url.length > 1500000) { rej(new Error('That watermark image is too large to store in a recipe.')); return; }
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Could not read the watermark image.')); };
      img.src = url;
    });
  }

  var CAP_MSG = {
    'background-ai': "This recipe uses AI background removal, which isn't available on this device. You can continue with the remaining steps, or remove the background with the color and brush tools.",
    'upscale-ai': "This recipe uses AI upscaling, which isn't available on this device. You can continue with the remaining steps, or use the standard upscale."
  };

  LE.capabilities = {
    for: function (op, tier) {
      if (op === 'background-ai' || op === 'upscale-ai') return 'unavailable';
      if ((op === 'blur' || op === 'sharpen' || op === 'upscale') && tier === 'older') return 'optimized';
      return 'full';
    },
    message: function (op, tier) {
      if (CAP_MSG[op]) return CAP_MSG[op];
      if (op === 'blur' && tier === 'older') return 'Blur uses a lighter radius on this device.';
      if (op === 'upscale' && tier === 'older') return 'Upscale stays at 2× on this device.';
      return 'This step changes on this device.';
    }
  };

  function runStep(canvas, step, opts) {
    var p = step.parameters || {};
    var tier = (opts && opts.tier) || 'desktop';
    var op = step.operation;
    if (op === 'exposure') return Promise.resolve({ canvas: adjust(canvas, { exposure: p.value }) });
    if (op === 'brightness') return Promise.resolve({ canvas: adjust(canvas, { brightness: p.value }) });
    if (op === 'contrast') return Promise.resolve({ canvas: adjust(canvas, { contrast: p.value }) });
    if (op === 'saturation') return Promise.resolve({ canvas: adjust(canvas, { saturation: p.value }) });
    if (op === 'vibrance') return Promise.resolve({ canvas: adjust(canvas, { vibrance: p.value }) });
    if (op === 'temperature') return Promise.resolve({ canvas: adjust(canvas, { temperature: p.value }) });
    if (op === 'tint') return Promise.resolve({ canvas: adjust(canvas, { tint: p.value }) });
    if (op === 'hue') return Promise.resolve({ canvas: adjust(canvas, { hue: p.value }) });
    if (op === 'highlights') return Promise.resolve({ canvas: adjust(canvas, { highlights: p.value }) });
    if (op === 'shadows') return Promise.resolve({ canvas: adjust(canvas, { shadows: p.value }) });
    if (op === 'vignette') return Promise.resolve({ canvas: adjust(canvas, { vignette: p.amount != null ? p.amount : p.value }) });
    if (op === 'grain') return Promise.resolve({ canvas: adjust(canvas, { grain: p.amount != null ? p.amount : p.value }) });
    if (op === 'fade') return Promise.resolve({ canvas: adjust(canvas, { fade: p.amount }) });
    if (op === 'clarity') return Promise.resolve({ canvas: adjust(canvas, { clarity: p.value }) });
    if (op === 'split-tone') {
      return Promise.resolve({ canvas: adjust(canvas, {
        splitShadowHue: p.shadowHue, splitShadowAmount: p.shadowAmount,
        splitHighlightHue: p.highlightHue, splitHighlightAmount: p.highlightAmount, splitBalance: p.balance
      }) });
    }
    if (op === 'sharpness' || op === 'sharpen') {
      var amount = clamp(num(p.amount != null ? p.amount : p.value, 20), 0, 100) / 100;
      if (tier === 'older') amount = Math.min(amount, 0.45);
      return Promise.resolve({ canvas: sharpen(canvas, amount) });
    }
    if (op === 'adjust' || op === 'levels') return Promise.resolve({ canvas: adjust(canvas, p) });
    if (op === 'curves') return Promise.resolve({ canvas: adjust(canvas, { points: p.points }) });
    if (op === 'filter') {
      var preset = PRESETS[p.name] || {};
      var t = clamp(num(p.intensity, 100), 0, 100) / 100;
      var pack = {};
      Object.keys(preset).forEach(function (k) { pack[k] = preset[k] * t; });
      return Promise.resolve({ canvas: adjust(canvas, pack) });
    }
    if (op === 'crop') return Promise.resolve({ canvas: crop(canvas, p) });
    if (op === 'resize') return Promise.resolve({ canvas: resize(canvas, p) });
    if (op === 'rotate') return Promise.resolve({ canvas: rotate(canvas, p) });
    if (op === 'flip') return Promise.resolve({ canvas: flip(canvas, p) });
    if (op === 'blur') {
      var radius = clamp(num(p.radius, 8), 0, 80);
      var cap = tier === 'older' ? 8 : tier === 'modern' ? 18 : 40;
      var notice = null;
      if (radius > cap) {
        notice = { level: 'optimized', message: 'Blur was reduced from ' + radius + ' to ' + cap + ' so it stays smooth on this device.' };
        radius = cap;
      }
      if (p.type === 'motion') return Promise.resolve({ canvas: motionBlur(clone(canvas), radius, p.angle), notice: notice });
      if (p.type === 'background') {
        var blurred = blurCanvas(clone(canvas), Math.max(1, radius));
        var bctx = ctx2(blurred);
        bctx.save();
        bctx.beginPath();
        bctx.ellipse((p.cx == null ? 0.5 : p.cx) * canvas.width, (p.cy == null ? 0.42 : p.cy) * canvas.height, (p.rx || 0.28) * canvas.width, (p.ry || 0.34) * canvas.height, 0, 0, Math.PI * 2);
        bctx.clip();
        bctx.drawImage(canvas, 0, 0);
        bctx.restore();
        return Promise.resolve({ canvas: blurred, notice: notice });
      }
      return Promise.resolve({ canvas: blurCanvas(clone(canvas), Math.max(1, radius)), notice: notice });
    }
    if (op === 'border' || op === 'frame') return Promise.resolve({ canvas: border(canvas, p) });
    if (op === 'text') return Promise.resolve({ canvas: drawText(canvas, p) });
    if (op === 'shape') return Promise.resolve({ canvas: drawShape(canvas, p) });
    if (op === 'background') return Promise.resolve({ canvas: background(clone(canvas), p) });
    if (op === 'mask') {
      var mask = opts && opts.masks && opts.masks[p.maskId];
      if (!mask) return Promise.resolve({ canvas: canvas, notice: { level: 'skipped', message: 'A brush mask from another session was not found, so that step was left out.' } });
      return Promise.resolve({ canvas: applyMask(canvas, mask) });
    }
    if (op === 'upscale') return Promise.resolve(upscale(canvas, p, tier));
    if (op === 'social') return Promise.resolve({ canvas: social(canvas, p) });
    if (op === 'meme') return Promise.resolve({ canvas: meme(canvas, p) });
    if (op === 'watermark') {
      if (p.image) {
        return loadDataImage(p.image).then(function (img) {
          return { canvas: drawWatermark(canvas, p, img) };
        });
      }
      return Promise.resolve({ canvas: drawWatermark(canvas, p, null) });
    }
    return Promise.resolve({
      canvas: canvas,
      notice: { level: 'unavailable', message: LE.capabilities.message(op, tier) }
    });
  }

  LE.applySteps = function (source, steps, opts) {
    opts = opts || {};
    opts.tier = opts.tier || LE.device.tier();
    var canvas = clone(source);
    var notices = [];
    var chain = Promise.resolve(canvas);
    (steps || []).forEach(function (step) {
      chain = chain.then(function (current) {
        if (!step || step.enabled === false) return current;
        return runStep(current, step, opts).then(function (res) {
          if (res.notice) notices.push(Object.assign({ id: step.id, label: step.label || step.operation }, res.notice));
          return res.canvas;
        });
      });
    });
    return chain.then(function (out) { return { canvas: out, notices: notices }; });
  };

  /* ---------- Recipes (.leworkflow) ----------
     A recipe is data: a list of named operations with numeric, enum, colour or short text parameters.
     Everything an importer accepts is listed in FIELD, ENUMS, STRINGS and BOOLS below and documented in
     docs/FORMAT-WORKFLOW.md. Anything else is rejected or dropped; nothing is ever evaluated. */
  var WF_FORMAT = 'localeditor-workflow';
  var WF_LIMITS = { bytes: 2000000, steps: 40, tags: 8, depth: 12, linkChars: 6000, linkBytes: 65536 };

  function rule(min, max, identity, step) { return { num: true, min: min, max: max, identity: identity, step: step || 1 }; }
  var FIELD = {
    exposure: { value: rule(-2, 2, 0, 0.01) },
    brightness: { value: rule(-100, 100, 0) },
    contrast: { value: rule(-100, 100, 0) },
    saturation: { value: rule(-100, 100, 0) },
    vibrance: { value: rule(-100, 100, 0) },
    temperature: { value: rule(-100, 100, 0) },
    tint: { value: rule(-100, 100, 0) },
    hue: { value: rule(-180, 180, 0) },
    highlights: { value: rule(-100, 100, 0) },
    shadows: { value: rule(-100, 100, 0) },
    sharpness: { value: rule(0, 100, 0), amount: rule(0, 100, 0) },
    sharpen: { value: rule(0, 100, 0), amount: rule(0, 100, 0) },
    vignette: { value: rule(0, 1, 0, 0.01), amount: rule(0, 1, 0, 0.01) },
    grain: { value: rule(0, 100, 0), amount: rule(0, 100, 0) },
    fade: { amount: rule(0, 100, 0) },
    clarity: { value: rule(-100, 100, 0) },
    'split-tone': {
      shadowHue: rule(0, 360, null), shadowAmount: rule(0, 100, 0),
      highlightHue: rule(0, 360, null), highlightAmount: rule(0, 100, 0), balance: rule(-100, 100, 0)
    },
    adjust: {
      exposure: rule(-2, 2, 0, 0.01), brightness: rule(-100, 100, 0), contrast: rule(-100, 100, 0),
      saturation: rule(-100, 100, 0), vibrance: rule(-100, 100, 0), temperature: rule(-100, 100, 0),
      tint: rule(-100, 100, 0), hue: rule(-180, 180, 0), highlights: rule(-100, 100, 0), shadows: rule(-100, 100, 0),
      sharpness: rule(0, 100, 0), vignette: rule(0, 1, 0, 0.01), grain: rule(0, 100, 0),
      black: rule(0, 255, 0), white: rule(0, 255, 255), gamma: rule(0.2, 3, 1, 0.01),
      red: rule(-100, 100, 0), green: rule(-100, 100, 0), blue: rule(-100, 100, 0),
      fade: rule(0, 100, 0), clarity: rule(-100, 100, 0),
      splitShadowHue: rule(0, 360, null), splitShadowAmount: rule(0, 100, 0),
      splitHighlightHue: rule(0, 360, null), splitHighlightAmount: rule(0, 100, 0), splitBalance: rule(-100, 100, 0)
    },
    levels: { black: rule(0, 255, 0), white: rule(0, 255, 255), gamma: rule(0.2, 3, 1, 0.01) },
    curves: {},
    filter: { intensity: rule(0, 100, 0) },
    crop: { x: rule(0, 1, null, 0.01), y: rule(0, 1, null, 0.01), w: rule(0.01, 1, null, 0.01), h: rule(0.01, 1, null, 0.01) },
    resize: { width: rule(1, 16000), height: rule(1, 16000), percent: rule(1, 400), maxWidth: rule(1, 16000) },
    rotate: { degrees: rule(-360, 360, 0) },
    flip: {},
    blur: { radius: rule(0, 80, 0), angle: rule(0, 360, null), cx: rule(0, 1, null, 0.01), cy: rule(0, 1, null, 0.01), rx: rule(0.05, 1, null, 0.01), ry: rule(0.05, 1, null, 0.01) },
    border: { padding: rule(0, 800, 0), size: rule(0, 400, 0), radius: rule(0, 800, 0) },
    frame: { padding: rule(0, 800, 0), size: rule(0, 400, 0), radius: rule(0, 800, 0) },
    text: { size: rule(0.01, 0.4, null, 0.01), x: rule(0, 1, null, 0.01), y: rule(0, 1, null, 0.01), rotate: rule(-180, 180, null), weight: rule(100, 900, null, 100) },
    watermark: { opacity: rule(0, 1, null, 0.01), scale: rule(0.02, 1, null, 0.01), x: rule(0, 1, null, 0.01), y: rule(0, 1, null, 0.01) },
    shape: { x: rule(-1, 2, null, 0.01), y: rule(-1, 2, null, 0.01), w: rule(-2, 2, null, 0.01), h: rule(-2, 2, null, 0.01), opacity: rule(0, 1, null, 0.01), strokeWidth: rule(1, 40, null) },
    background: { tolerance: rule(0, 100, null) },
    mask: {},
    upscale: { factor: rule(1, 4, null) },
    social: { width: rule(1, 8000, null), height: rule(1, 8000, null) },
    meme: { scale: rule(0.04, 0.16, null, 0.01) },
    'background-ai': {},
    'upscale-ai': {}
  };
  /* Operations added in format 1.1. A file that uses one is written as version 1.1. */
  var V11_OPS = { fade: 1, clarity: 1, 'split-tone': 1 };
  var V11_ADJUST = ['fade', 'clarity', 'splitShadowHue', 'splitShadowAmount', 'splitHighlightHue', 'splitHighlightAmount', 'splitBalance'];

  var FILTER_NAMES = Object.keys(PRESETS);
  var ENUMS = {
    resize: { mode: ['nearest', 'bilinear', 'high'] },
    flip: { axis: ['horizontal', 'vertical'] },
    blur: { type: ['gaussian', 'motion', 'background'] },
    filter: { name: FILTER_NAMES },
    shape: { kind: ['rect', 'ellipse', 'line', 'arrow', 'emoji'] },
    text: { align: ['left', 'center', 'right'] },
    social: { fit: ['cover', 'contain'] }
  };
  /* Text parameters: [kind, max length]. Kinds: text (plain words), color (CSS colour), font (family list). */
  var STRINGS = {
    text: { text: ['text', 240], font: ['font', 80], color: ['color', 40], outline: ['color', 40], background: ['color', 40] },
    watermark: { text: ['text', 240], font: ['font', 80], color: ['color', 40] },
    shape: { fill: ['color', 40], stroke: ['color', 40], text: ['text', 16] },
    border: { color: ['color', 40], background: ['color', 40] },
    frame: { color: ['color', 40], background: ['color', 40] },
    background: { color: ['color', 40], replace: ['color', 40] },
    social: { background: ['color', 40] },
    meme: { top: ['text', 240], bottom: ['text', 240], font: ['font', 80] },
    mask: { maskId: ['id', 40] }
  };
  var BOOLS = { border: ['shadow'], frame: ['shadow'], watermark: ['tile'], resize: ['lock'] };
  var COLOR_RE = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
  var FONT_RE = /^[A-Za-z0-9 ,'"\-]{1,80}$/;
  var ID_RE = /^[\w-]{1,40}$/;
  var IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+\/=]+$/i;
  var SCRIPTY = /<\s*\/?\s*(script|iframe|object|embed|svg|img|style|link|meta|html|body|form|a)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon[a-z]{3,}\s*=/i;
  var BAD_KEYS = Object.create(null);
  BAD_KEYS.__proto__ = 1; BAD_KEYS.constructor = 1; BAD_KEYS.prototype = 1;

  var CATEGORIES = [
    ['portrait', 'Portrait'], ['product', 'Product'], ['food', 'Food'], ['landscape', 'Landscape'],
    ['film', 'Film & vintage'], ['bw', 'Black & white'], ['social', 'Social'], ['document', 'Documents']
  ];

  /* Human labels and the default values offered when a step is added in the recipe editor. */
  var CATALOG = [
    ['exposure', 'Exposure', 'light', { value: 0.1 }, true],
    ['brightness', 'Brightness', 'light', { value: 10 }, true],
    ['contrast', 'Contrast', 'light', { value: 12 }, true],
    ['highlights', 'Highlights', 'light', { value: -12 }, true],
    ['shadows', 'Shadows', 'light', { value: 12 }, true],
    ['levels', 'Levels', 'light', { black: 12, white: 245, gamma: 1 }, true],
    ['temperature', 'Warmth', 'color', { value: 12 }, true],
    ['tint', 'Tint', 'color', { value: 6 }, true],
    ['saturation', 'Saturation', 'color', { value: -12 }, true],
    ['vibrance', 'Vibrance', 'color', { value: 18 }, true],
    ['hue', 'Hue shift', 'color', { value: 8 }, true],
    ['split-tone', 'Split tone', 'color', { shadowHue: 200, shadowAmount: 20, highlightHue: 40, highlightAmount: 20, balance: 0 }, true],
    ['filter', 'Filter', 'effect', { name: 'film', intensity: 80 }, true],
    ['fade', 'Fade', 'effect', { amount: 18 }, true],
    ['vignette', 'Vignette', 'effect', { amount: 0.3 }, true],
    ['grain', 'Grain', 'effect', { amount: 12 }, true],
    ['clarity', 'Clarity', 'detail', { value: 15 }, true],
    ['sharpen', 'Sharpen', 'detail', { amount: 20 }, true],
    ['blur', 'Soften', 'detail', { radius: 2, type: 'gaussian' }, true],
    ['resize', 'Fit size', 'output', { maxWidth: 2000, mode: 'high' }, false],
    ['border', 'Border', 'output', { padding: 24, size: 0, radius: 0, color: '#ffffff' }, false]
  ];
  var OP_LABEL = {};
  CATALOG.forEach(function (c) { OP_LABEL[c[0]] = c[1]; });
  OP_LABEL.sharpness = 'Sharpen';
  OP_LABEL.adjust = 'Adjust';
  OP_LABEL.curves = 'Curves';
  OP_LABEL.crop = 'Crop';
  OP_LABEL.rotate = 'Rotate';
  OP_LABEL.flip = 'Flip';
  OP_LABEL.frame = 'Frame';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function slug(s, max) {
    var out = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 60).replace(/-+$/, '');
    return out;
  }
  function round(v, step) {
    var dp = step < 1 ? Math.min(4, String(step).split('.')[1].length + 1) : 2;
    var f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }
  /* Walk a parsed file once: forbidden keys, nesting depth and script-like text anywhere. */
  function scan(v, depth, path) {
    if (depth > WF_LIMITS.depth) return 'This file is nested too deeply.';
    if (typeof v === 'string') {
      if (/\.parameters\.image$/.test(path)) return null;
      return SCRIPTY.test(v) ? 'This file contains markup or script, which recipes cannot carry.' : null;
    }
    if (!v || typeof v !== 'object') return null;
    var keys = Object.keys(v);
    for (var i = 0; i < keys.length; i++) {
      if (BAD_KEYS[keys[i]]) return 'This file contains a forbidden key (' + keys[i] + ').';
      var bad = scan(v[keys[i]], depth + 1, path + '.' + keys[i]);
      if (bad) return bad;
    }
    return null;
  }
  function stepUses11(op, params) {
    if (V11_OPS[op]) return true;
    if (op === 'adjust') return V11_ADJUST.some(function (k) { return params[k] != null; });
    return false;
  }

  function scaleParams(op, params, intensity) {
    var spec = FIELD[op] || {};
    var t = clamp(intensity, 0, 100) / 100;
    var out = {};
    Object.keys(params || {}).forEach(function (k) {
      var r = spec[k];
      var v = params[k];
      if (r && r.num) {
        if (typeof v !== 'number' || !isFinite(v)) return;
        v = clamp(v, r.min, r.max);
        out[k] = r.identity != null ? r.identity + (v - r.identity) * t : v;
      } else out[k] = v;
    });
    return out;
  }

  function validateStep(step, index, errors, warnings, usedIds) {
    var where = 'Step ' + (index + 1);
    if (!isObj(step)) { errors.push(where + ' is not readable.'); return null; }
    var op = step.operation;
    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(FIELD, op)) {
      errors.push(where + ': “' + cleanStr(op, 40) + '” is not a LocalEditor edit.');
      return null;
    }
    var label = cleanStr(step.label || OP_LABEL[op] || op, 60) || op;
    where = where + ' (' + label + ')';
    var raw = step.parameters == null ? {} : step.parameters;
    if (!isObj(raw)) { errors.push(where + ': parameters must be an object.'); return null; }
    var params = {};
    var nums = FIELD[op], enums = ENUMS[op] || {}, strs = STRINGS[op] || {}, bools = BOOLS[op] || [];
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      if (Object.prototype.hasOwnProperty.call(nums, k)) {
        var r = nums[k];
        if (typeof v !== 'number' || !isFinite(v)) { errors.push(where + ': ' + k + ' must be a number.'); return; }
        if (v < r.min || v > r.max) { errors.push(where + ': ' + k + ' ' + v + ' is outside ' + r.min + ' to ' + r.max + '.'); return; }
        params[k] = v;
      } else if (Object.prototype.hasOwnProperty.call(enums, k)) {
        if (enums[k].indexOf(v) < 0) { errors.push(where + ': ' + k + ' must be one of ' + enums[k].join(', ') + '.'); return; }
        params[k] = v;
      } else if (Object.prototype.hasOwnProperty.call(strs, k)) {
        var kind = strs[k][0], max = strs[k][1];
        if (typeof v !== 'string') { errors.push(where + ': ' + k + ' must be text.'); return; }
        if (v.length > max) { errors.push(where + ': ' + k + ' is longer than ' + max + ' characters.'); return; }
        if (kind === 'color' && !COLOR_RE.test(v.trim())) { errors.push(where + ': ' + k + ' is not a colour.'); return; }
        if (kind === 'font' && !FONT_RE.test(v)) { errors.push(where + ': ' + k + ' is not a font name.'); return; }
        if (kind === 'id' && !ID_RE.test(v)) { errors.push(where + ': ' + k + ' is not a valid id.'); return; }
        params[k] = kind === 'text' ? cleanStr(v, max) : v.trim();
      } else if (bools.indexOf(k) >= 0) {
        if (typeof v !== 'boolean') { errors.push(where + ': ' + k + ' must be true or false.'); return; }
        params[k] = v;
      } else if (op === 'curves' && k === 'points') {
        var ok = Array.isArray(v) && v.length >= 2 && v.length <= 6 && v.every(function (pt, i) {
          return Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number' &&
            pt[0] >= 0 && pt[0] <= 1 && pt[1] >= 0 && pt[1] <= 1 && (i === 0 || pt[0] >= v[i - 1][0]);
        });
        if (!ok) { errors.push(where + ': curves need 2 to 6 [x, y] points between 0 and 1, x ascending.'); return; }
        params.points = v.map(function (pt) { return [pt[0], pt[1]]; });
      } else if (op === 'watermark' && k === 'image') {
        if (typeof v !== 'string' || !IMAGE_RE.test(v) || v.length > 1500000) { errors.push(where + ': a recipe image must be a small PNG, JPEG, or WebP data URL.'); return; }
        params.image = v;
      } else {
        warnings.push(where + ': unknown parameter “' + cleanStr(k, 30) + '” was left out.');
      }
    });
    if (op === 'curves' && !params.points) errors.push(where + ': curves need points.');
    if (op === 'filter' && !params.name) errors.push(where + ': a filter needs a name.');
    var id = typeof step.id === 'string' && ID_RE.test(step.id) ? step.id : slug(label, 30) || 'step';
    var base = id, n = 2;
    while (usedIds[id]) id = base.slice(0, 36) + '-' + (n++);
    usedIds[id] = 1;
    if (step.enabled != null && typeof step.enabled !== 'boolean') errors.push(where + ': enabled must be true or false.');
    return {
      id: id,
      operation: op,
      label: label,
      description: cleanStr(step.description || '', 180),
      enabled: step.enabled !== false,
      parameters: params
    };
  }

  function validate(input) {
    var errors = [], warnings = [];
    var data = input;
    function fail(msg) { return { ok: false, errors: [msg], warnings: [] }; }
    if (typeof input === 'string') {
      if (input.length > WF_LIMITS.bytes) return fail('This recipe file is too large.');
      try { data = JSON.parse(input); } catch (e) { return fail('This file is not valid JSON.'); }
    } else {
      var size = 0;
      try { size = JSON.stringify(input).length; } catch (e2) { return fail('This recipe could not be read.'); }
      if (size > WF_LIMITS.bytes) return fail('This recipe file is too large.');
    }
    if (!isObj(data)) return fail('This file is not a LocalEditor recipe.');
    var bad = scan(data, 0, '');
    if (bad) return fail(bad);
    if (data.format !== WF_FORMAT) return fail('This file is not a LocalEditor recipe.');
    var ver = typeof data.version === 'number' ? (data.version % 1 ? String(data.version) : data.version + '.0') : String(data.version || '');
    var major = /^(\d+)\.\d+$/.exec(ver);
    if (!major) return fail('This recipe has no readable version.');
    if (Number(major[1]) > 1) return fail('This recipe needs a newer LocalEditor.');
    if (Number(major[1]) < 1) return fail('This recipe has no readable version.');
    if (data.metadata != null && !isObj(data.metadata)) errors.push('metadata must be an object.');
    var meta = isObj(data.metadata) ? data.metadata : {};
    var stepsIn = Array.isArray(data.steps) ? data.steps : null;
    if (!stepsIn || !stepsIn.length) errors.push('This recipe has no steps.');
    else if (stepsIn.length > WF_LIMITS.steps) errors.push('This recipe has more than ' + WF_LIMITS.steps + ' steps.');
    var steps = [], used = {}, v11 = false;
    if (stepsIn && stepsIn.length <= WF_LIMITS.steps) {
      stepsIn.forEach(function (step, i) {
        var s = validateStep(step, i, errors, warnings, used);
        if (s) { steps.push(s); if (stepUses11(s.operation, s.parameters)) v11 = true; }
      });
    }
    var strength = 75;
    if (data.parameters != null) {
      var p0 = Array.isArray(data.parameters) ? data.parameters[0] : null;
      if (!isObj(p0)) errors.push('parameters must be a list with one strength slider.');
      else if (p0.default != null) {
        if (typeof p0.default !== 'number' || p0.default < 0 || p0.default > 100) errors.push('The default strength must be a number from 0 to 100.');
        else strength = p0.default;
      }
    }
    var exp = data.export == null ? {} : data.export;
    if (!isObj(exp)) { errors.push('export must be an object.'); exp = {}; }
    var format = 'jpeg', quality = 90;
    if (exp.format != null) {
      if (['jpeg', 'png', 'webp'].indexOf(exp.format) < 0) errors.push('export.format must be jpeg, png or webp.');
      else format = exp.format;
    }
    if (exp.quality != null) {
      if (typeof exp.quality !== 'number' || exp.quality < 40 || exp.quality > 100) errors.push('export.quality must be a number from 40 to 100.');
      else quality = exp.quality;
    }
    var name = cleanStr(typeof meta.name === 'string' ? meta.name.trim() : '', 80) || 'Untitled recipe';
    var id = slug(meta.id, 60) || slug(name, 48) || 'recipe';
    var cover = typeof meta.cover === 'string' && /^([a-z]+-\d{2}|sample-portrait|sample-scene)$/.test(meta.cover) ? meta.cover : null;
    if (meta.cover != null && !cover) warnings.push('The cover photo was not recognised and was left out.');
    var tags = Array.isArray(meta.tags) ? meta.tags.filter(function (t) { return typeof t === 'string' && t.trim(); }).slice(0, WF_LIMITS.tags).map(function (t) { return cleanStr(t.trim().toLowerCase(), 24); }) : [];
    var metaOut = {
      id: id,
      name: name,
      description: cleanStr(typeof meta.description === 'string' ? meta.description.trim() : '', 400),
      author: cleanStr(typeof meta.author === 'string' && meta.author.trim() ? meta.author.trim() : 'Anonymous', 80),
      category: slug(meta.category, 24) || 'general',
      difficulty: ['beginner', 'intermediate', 'expert'].indexOf(meta.difficulty) >= 0 ? meta.difficulty : 'beginner',
      tags: tags,
      license: cleanStr(typeof meta.license === 'string' && meta.license.trim() ? meta.license.trim() : 'Free to use and share', 80)
    };
    if (cover) metaOut.cover = cover;
    if (typeof meta.created === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(meta.created)) metaOut.created = meta.created;
    var workflow = {
      format: WF_FORMAT,
      version: v11 ? '1.1' : '1.0',
      metadata: metaOut,
      compatibility: {
        minimumEditorVersion: v11 ? '1.1' : '1.0',
        mobileSupported: !isObj(data.compatibility) || data.compatibility.mobileSupported !== false
      },
      parameters: [{ id: 'intensity', label: 'Strength', type: 'slider', min: 0, max: 100, default: strength }],
      steps: steps,
      export: { format: format, quality: quality }
    };
    return { ok: errors.length === 0, errors: errors, warnings: warnings, workflow: workflow };
  }

  /* ---------- Studio looks: recipe steps <-> a photo layer's adjust + filter fields ---------- */
  var STUDIO_KEYS = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'warmth', 'tint', 'saturation', 'vibrance', 'hue', 'vignette', 'grain', 'sharpness', 'blur'];
  var EXT_KEYS = ['fade', 'clarity', 'splitShadowHue', 'splitShadowAmount', 'splitHighlightHue', 'splitHighlightAmount', 'splitBalance', 'black', 'white', 'gamma'];
  var LOOK_RANGE = {
    exposure: [-1, 1], brightness: [-100, 100], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100],
    warmth: [-100, 100], tint: [-100, 100], saturation: [-100, 100], vibrance: [-100, 100], hue: [-180, 180],
    vignette: [0, 1], grain: [0, 100], sharpness: [0, 100], blur: [0, 40], fade: [0, 100], clarity: [-100, 100],
    splitShadowHue: [0, 360], splitShadowAmount: [0, 100], splitHighlightHue: [0, 360], splitHighlightAmount: [0, 100],
    splitBalance: [-100, 100], black: [0, 255], white: [0, 255], gamma: [0.2, 3]
  };
  var SET_KEYS = { vignette: 1, grain: 1, blur: 1, splitShadowHue: 1, splitHighlightHue: 1, splitShadowAmount: 1, splitHighlightAmount: 1, splitBalance: 1, black: 1, white: 1, gamma: 1, fade: 1 };

  /* Collapses prepared recipe steps into the studio's live fields. Steps that change size or draw
     (resize, border, text...) cannot be live and are listed in `skipped`. */
  function look(steps) {
    var adjust = {}, filter = null, skipped = [];
    function put(k, v) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (SET_KEYS[k]) adjust[k] = v; else adjust[k] = (adjust[k] || 0) + v;
    }
    var single = { exposure: 'exposure', brightness: 'brightness', contrast: 'contrast', saturation: 'saturation', vibrance: 'vibrance', temperature: 'warmth', tint: 'tint', hue: 'hue', highlights: 'highlights', shadows: 'shadows' };
    (steps || []).forEach(function (s) {
      if (!s || s.enabled === false) return;
      var p = s.parameters || {};
      var op = s.operation;
      if (single[op]) put(single[op], p.value);
      else if (op === 'vignette' || op === 'grain') put(op, p.amount != null ? p.amount : p.value);
      else if (op === 'sharpness' || op === 'sharpen') put('sharpness', p.amount != null ? p.amount : p.value);
      else if (op === 'blur' && (!p.type || p.type === 'gaussian')) put('blur', p.radius);
      else if (op === 'fade') put('fade', p.amount);
      else if (op === 'clarity') put('clarity', p.value);
      else if (op === 'split-tone') {
        put('splitShadowHue', p.shadowHue == null ? 210 : p.shadowHue); put('splitShadowAmount', p.shadowAmount || 0);
        put('splitHighlightHue', p.highlightHue == null ? 40 : p.highlightHue); put('splitHighlightAmount', p.highlightAmount || 0);
        put('splitBalance', p.balance || 0);
      } else if (op === 'levels') { put('black', p.black); put('white', p.white); put('gamma', p.gamma); }
      else if (op === 'filter') {
        if (!filter) filter = { name: p.name, intensity: p.intensity == null ? 100 : p.intensity };
        else {
          var pre = PRESETS[p.name] || {}, t = (p.intensity == null ? 100 : p.intensity) / 100;
          Object.keys(pre).forEach(function (k) { put(k === 'temperature' ? 'warmth' : k, pre[k] * t); });
        }
      } else if (op === 'adjust') {
        Object.keys(p).forEach(function (k) {
          var dest = k === 'temperature' ? 'warmth' : k;
          if (LOOK_RANGE[dest]) put(dest, p[k]);
        });
      } else skipped.push(s.label || OP_LABEL[op] || op);
    });
    Object.keys(adjust).forEach(function (k) {
      var r = LOOK_RANGE[k];
      adjust[k] = Math.round(clamp(adjust[k], r[0], r[1]) * 10000) / 10000;
      if (adjust[k] === 0 && !SET_KEYS[k]) delete adjust[k];
    });
    if (!adjust.splitShadowAmount && !adjust.splitHighlightAmount) {
      ['splitShadowHue', 'splitShadowAmount', 'splitHighlightHue', 'splitHighlightAmount', 'splitBalance'].forEach(function (k) { delete adjust[k]; });
    }
    if (adjust.black === 0) delete adjust.black;
    if (adjust.white === 255) delete adjust.white;
    if (adjust.gamma === 1) delete adjust.gamma;
    if (adjust.fade === 0) delete adjust.fade;
    ['vignette', 'grain', 'blur'].forEach(function (k) { if (adjust[k] === 0) delete adjust[k]; });
    return { adjust: adjust, filter: filter, skipped: skipped };
  }

  /* The engine steps that draw a studio photo layer's look: the same order the layered editor uses,
     with the 1.1 keys (fade, clarity, split tone, levels) as one final pass. */
  function lookSteps(adjust, filter) {
    var a = adjust || {};
    var steps = [], pack = {};
    ['brightness', 'contrast', 'saturation', 'tint', 'exposure', 'highlights', 'shadows', 'vibrance', 'vignette', 'grain', 'hue'].forEach(function (k) {
      if (typeof a[k] === 'number' && a[k]) pack[k] = a[k];
    });
    var warm = a.temperature || a.warmth;
    if (typeof warm === 'number' && warm) pack.temperature = warm;
    if (Object.keys(pack).length) steps.push({ operation: 'adjust', parameters: pack });
    if (filter && filter.name) steps.push({ operation: 'filter', parameters: { name: filter.name, intensity: filter.intensity == null ? 100 : filter.intensity } });
    if (typeof a.sharpness === 'number' && a.sharpness) steps.push({ operation: 'sharpen', parameters: { amount: a.sharpness } });
    if (typeof a.blur === 'number' && a.blur) steps.push({ operation: 'blur', parameters: { radius: a.blur, type: 'gaussian' } });
    var e = extPack(a);
    if (e) steps.push({ operation: 'adjust', parameters: e });
    return steps;
  }
  function extPack(a) {
    var ext = {}, any = false;
    EXT_KEYS.forEach(function (k) { if (typeof (a || {})[k] === 'number') { ext[k] = a[k]; any = true; } });
    if (!any) return null;
    if (!ext.fade && !ext.clarity && !ext.splitShadowAmount && !ext.splitHighlightAmount && !ext.black && (ext.white == null || ext.white === 255) && (ext.gamma == null || ext.gamma === 1)) return null;
    return ext;
  }

  /* Turns a photo layer's live look into readable, separately editable recipe steps. */
  function fromLook(adjust, filter) {
    var a = adjust || {};
    var steps = [];
    function add(op, params, label) {
      steps.push({ id: slug(label, 30), operation: op, label: label, description: '', enabled: true, parameters: params });
    }
    function val(k, op, label, field) {
      var v = k === 'warmth' ? (a.warmth || a.temperature) : a[k];
      if (typeof v !== 'number' || !v) return;
      var r = FIELD[op][field || 'value'];
      var p = {};
      p[field || 'value'] = round(clamp(v, r.min, r.max), r.step);
      if (p[field || 'value']) add(op, p, label);
    }
    val('exposure', 'exposure', 'Exposure');
    val('brightness', 'brightness', 'Brightness');
    val('contrast', 'contrast', 'Contrast');
    val('highlights', 'highlights', 'Highlights');
    val('shadows', 'shadows', 'Shadows');
    if ((typeof a.black === 'number' && a.black) || (typeof a.white === 'number' && a.white !== 255) || (typeof a.gamma === 'number' && a.gamma !== 1)) {
      add('levels', {
        black: round(clamp(num(a.black, 0), 0, 255), 1), white: round(clamp(num(a.white, 255), 0, 255), 1), gamma: round(clamp(num(a.gamma, 1), 0.2, 3), 0.01)
      }, 'Levels');
    }
    val('warmth', 'temperature', 'Warmth');
    val('tint', 'tint', 'Tint');
    val('saturation', 'saturation', 'Saturation');
    val('vibrance', 'vibrance', 'Vibrance');
    val('hue', 'hue', 'Hue shift');
    if (num(a.splitShadowAmount, 0) || num(a.splitHighlightAmount, 0)) {
      add('split-tone', {
        shadowHue: round(clamp(num(a.splitShadowHue, 210), 0, 360), 1), shadowAmount: round(clamp(num(a.splitShadowAmount, 0), 0, 100), 1),
        highlightHue: round(clamp(num(a.splitHighlightHue, 40), 0, 360), 1), highlightAmount: round(clamp(num(a.splitHighlightAmount, 0), 0, 100), 1),
        balance: round(clamp(num(a.splitBalance, 0), -100, 100), 1)
      }, 'Split tone');
    }
    if (filter && filter.name && PRESETS[filter.name]) add('filter', { name: filter.name, intensity: round(clamp(num(filter.intensity, 100), 0, 100), 1) }, 'Filter');
    val('fade', 'fade', 'Fade', 'amount');
    val('clarity', 'clarity', 'Clarity');
    val('vignette', 'vignette', 'Vignette', 'amount');
    val('grain', 'grain', 'Grain', 'amount');
    val('sharpness', 'sharpen', 'Sharpen', 'amount');
    if (typeof a.blur === 'number' && a.blur > 0) add('blur', { radius: round(clamp(a.blur, 0, 80), 1), type: 'gaussian' }, 'Soften');
    return steps;
  }

  /* ---------- Share links: the recipe travels in the URL fragment, which browsers never send to a server ---------- */
  function b64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function canDeflate() {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return false;
    try { new CompressionStream('deflate-raw'); return true; } catch (e) { return false; }
  }
  function pump(bytes, transform, cap) {
    var reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
    var chunks = [], total = 0;
    function next() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          chunks.forEach(function (c) { out.set(c, at); at += c.length; });
          return out;
        }
        total += r.value.length;
        if (cap && total > cap) { reader.cancel().catch(function () {}); throw new Error('This recipe link is too large.'); }
        chunks.push(r.value);
        return next();
      });
    }
    return next();
  }
  function siteRoot() {
    var root = (document.documentElement && document.documentElement.getAttribute('data-root')) || './';
    try { return new URL(root, location.href).href; } catch (e) { return location.origin + '/'; }
  }
  function encodeLink(workflow, opts) {
    opts = opts || {};
    var v = validate(workflow);
    if (!v.ok) return Promise.reject(new Error(v.errors[0]));
    var bytes = new TextEncoder().encode(JSON.stringify(v.workflow));
    var make = (canDeflate() && opts.compress !== false)
      ? pump(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'z' + b64url(z); })
      : Promise.resolve('j' + b64url(bytes));
    return make.then(function (payload) {
      if (payload.length > WF_LIMITS.linkChars) throw new Error('This recipe is too large for a link. Share the .leworkflow file instead.');
      var base = opts.base || (siteRoot() + 'recipes/');
      return { payload: payload, fragment: 'r=' + payload, url: base + '#r=' + payload, compressed: payload.charAt(0) === 'z' };
    });
  }
  function linkPayload(text) {
    var s = String(text == null ? '' : text).trim();
    var m = /(?:^|[#&?])r=([A-Za-z0-9_-]+)/.exec(s);
    if (m) return m[1];
    return /^[zj][A-Za-z0-9_-]+$/.test(s) ? s : null;
  }
  function decodeLink(text) {
    var payload = linkPayload(text);
    if (!payload) return Promise.resolve({ ok: false, errors: ['That is not a recipe link.'], warnings: [] });
    if (payload.length > WF_LIMITS.linkChars) return Promise.resolve({ ok: false, errors: ['This recipe link is too large.'], warnings: [] });
    var tag = payload.charAt(0);
    var bytes;
    try { bytes = unb64url(payload.slice(1)); } catch (e) { return Promise.resolve({ ok: false, errors: ['This recipe link is damaged.'], warnings: [] }); }
    var raw;
    if (tag === 'j') raw = Promise.resolve(bytes);
    else if (tag === 'z') {
      if (!canDeflate()) return Promise.resolve({ ok: false, errors: ['This browser cannot open compressed recipe links. Ask for the .leworkflow file instead.'], warnings: [] });
      raw = pump(bytes, new DecompressionStream('deflate-raw'), WF_LIMITS.linkBytes);
    } else return Promise.resolve({ ok: false, errors: ['This recipe link uses a newer format.'], warnings: [] });
    return raw.then(function (out) {
      var json;
      try { json = new TextDecoder('utf-8', { fatal: true }).decode(out); } catch (e) { return { ok: false, errors: ['This recipe link is damaged.'], warnings: [] }; }
      return validate(json);
    }, function (err) {
      return { ok: false, errors: [/too large/.test(err && err.message) ? err.message : 'This recipe link is damaged.'], warnings: [] };
    });
  }

  /* ---------- Built-in recipes ---------- */
  function st(op, params, label, description) {
    return { id: slug(label, 30), operation: op, label: label, description: description || '', enabled: true, parameters: params };
  }
  function recipe(id, name, category, cover, strength, description, tags, steps, exp) {
    var used = {};
    steps.forEach(function (s) { var base = s.id, n = 2; while (used[s.id]) s.id = base + '-' + (n++); used[s.id] = 1; });
    var v11 = steps.some(function (s) { return stepUses11(s.operation, s.parameters); });
    return {
      format: WF_FORMAT, version: v11 ? '1.1' : '1.0',
      metadata: { id: id, name: name, description: description, author: 'LocalEditor', category: category, difficulty: 'beginner', tags: tags, license: 'Free to use and share', cover: cover },
      compatibility: { minimumEditorVersion: v11 ? '1.1' : '1.0', mobileSupported: true },
      parameters: [{ id: 'intensity', label: 'Strength', type: 'slider', min: 0, max: 100, default: strength }],
      steps: steps,
      export: exp || { format: 'jpeg', quality: 90 }
    };
  }
  var BUILTINS = [
    recipe('cinematic-portrait', 'Cinematic Portrait', 'portrait', 'people-08', 75, 'Warm skin, cool shadows and a soft vignette, like a film still.', ['portrait', 'cinematic', 'warm'], [
      st('exposure', { value: 0.1 }, 'Exposure', 'Lift the face a little.'),
      st('temperature', { value: 10 }, 'Warmth', 'Shift the light toward gold.'),
      st('contrast', { value: 14 }, 'Contrast', 'Separate light and shadow.'),
      st('split-tone', { shadowHue: 195, shadowAmount: 18, highlightHue: 32, highlightAmount: 12, balance: 0 }, 'Split tone', 'Teal in the shadows, amber in the light.'),
      st('vignette', { amount: 0.3 }, 'Vignette', 'Darken the corners slightly.'),
      st('sharpen', { amount: 18 }, 'Sharpen', 'Bring eyes and hair into focus.')
    ]),
    recipe('soft-wedding', 'Soft Wedding', 'portrait', 'people-01', 70, 'Airy, bright and gentle, with soft skin and held whites.', ['wedding', 'soft', 'bright'], [
      st('exposure', { value: 0.14 }, 'Exposure', 'Brighten the room.'),
      st('temperature', { value: 6 }, 'Warmth', 'Keep the light flattering.'),
      st('contrast', { value: -10 }, 'Contrast', 'Soften harsh light.'),
      st('highlights', { value: -14 }, 'Highlights', 'Protect dresses and windows.'),
      st('clarity', { value: -14 }, 'Clarity', 'Smooth skin texture a little.'),
      st('fade', { amount: 10 }, 'Fade', 'A whisper of matte in the blacks.')
    ]),
    recipe('golden-hour', 'Golden Hour', 'portrait', 'people-07', 78, 'Sunset warmth, held highlights and a quiet vignette.', ['warm', 'golden', 'sunset'], [
      st('temperature', { value: 20 }, 'Warmth', 'Push the light toward sunset.'),
      st('exposure', { value: 0.06 }, 'Exposure', 'Open the shadows a touch.'),
      st('highlights', { value: -16 }, 'Highlights', 'Hold bright skin and sky.'),
      st('split-tone', { shadowHue: 25, shadowAmount: 10, highlightHue: 42, highlightAmount: 22, balance: 20 }, 'Golden tone', 'Honey in the highlights.'),
      st('vignette', { amount: 0.2 }, 'Vignette', 'Lead the eye inward.')
    ]),
    recipe('soft-skin', 'Soft Skin', 'portrait', 'travel-05', 70, 'Flattering, bright and smooth, without the plastic look.', ['portrait', 'beauty', 'soft'], [
      st('exposure', { value: 0.08 }, 'Exposure', 'A brighter face.'),
      st('clarity', { value: -22 }, 'Clarity', 'Soften fine texture, keep edges.'),
      st('highlights', { value: -10 }, 'Highlights', 'Calm shiny spots.'),
      st('vibrance', { value: 8 }, 'Vibrance', 'Healthy colour, not orange.'),
      st('temperature', { value: 4 }, 'Warmth', 'A touch of warmth.')
    ]),
    recipe('crisp-headshot', 'Crisp Headshot', 'portrait', 'people-06', 75, 'Clean, confident and sharp for profiles and team pages.', ['portrait', 'linkedin', 'profile'], [
      st('contrast', { value: 10 }, 'Contrast', 'A confident base.'),
      st('shadows', { value: 12 }, 'Shadows', 'See into dark hair and jackets.'),
      st('clarity', { value: 14 }, 'Clarity', 'Defined features.'),
      st('saturation', { value: -6 }, 'Saturation', 'Natural skin.'),
      st('sharpen', { amount: 22 }, 'Sharpen', 'Crisp eyes.')
    ]),
    recipe('clean-product', 'Clean Product', 'product', 'still-01', 80, 'Even light and crisp detail for a product photo.', ['product', 'ecommerce', 'clean'], [
      st('exposure', { value: 0.1 }, 'Exposure', 'Lift a dark product shot.'),
      st('contrast', { value: 12 }, 'Contrast', 'Keep edges readable.'),
      st('saturation', { value: -6 }, 'Colour', 'Keep colours honest, not neon.'),
      st('clarity', { value: 16 }, 'Clarity', 'Show texture and material.'),
      st('sharpen', { amount: 26 }, 'Sharpen', 'Make labels and edges clearer.')
    ]),
    recipe('white-sweep', 'Bright White Background', 'product', 'arch-01', 85, 'Pushes a light backdrop to clean white for listings.', ['product', 'white', 'listing'], [
      st('levels', { black: 6, white: 228, gamma: 1.08 }, 'Levels', 'Set a clean white point.'),
      st('exposure', { value: 0.08 }, 'Exposure', 'A brighter scene.'),
      st('saturation', { value: -8 }, 'Saturation', 'Remove colour casts from the backdrop.'),
      st('sharpen', { amount: 20 }, 'Sharpen', 'Crisp product edges.')
    ]),
    recipe('ecommerce-export', 'Shop Export', 'product', 'books-02', 100, 'Limit the long edge to 2000 pixels, sharpen, and save a smaller JPEG.', ['export', 'shop', 'resize'], [
      st('resize', { maxWidth: 2000, mode: 'high' }, 'Fit 2000px', 'Shrink only if the photo is larger than 2000 pixels wide.'),
      st('sharpen', { amount: 18 }, 'Sharpen', 'Recover a little detail after resizing.')
    ], { format: 'jpeg', quality: 82 }),
    recipe('fresh-food', 'Fresh & Tasty', 'food', 'arch-03', 75, 'Juicy colour and bright, appetising light.', ['food', 'bright', 'colour'], [
      st('exposure', { value: 0.08 }, 'Exposure', 'Bright, daylight feel.'),
      st('vibrance', { value: 26 }, 'Vibrance', 'Greens and reds that look fresh.'),
      st('temperature', { value: 6 }, 'Warmth', 'Appetising warmth.'),
      st('shadows', { value: 12 }, 'Shadows', 'Open up the plate.'),
      st('clarity', { value: 14 }, 'Clarity', 'Texture you can almost taste.'),
      st('sharpen', { amount: 14 }, 'Sharpen', 'Crisp crumbs and leaves.')
    ]),
    recipe('moody-table', 'Moody Table', 'food', 'still-02', 75, 'Dark, rich and calm, for coffee, bread and dinner.', ['food', 'dark', 'moody'], [
      st('exposure', { value: -0.12 }, 'Exposure', 'Lower the light.'),
      st('contrast', { value: 16 }, 'Contrast', 'Deeper shadows.'),
      st('highlights', { value: -22 }, 'Highlights', 'Calm bright windows and plates.'),
      st('saturation', { value: -14 }, 'Saturation', 'Muted, earthy colour.'),
      st('temperature', { value: 8 }, 'Warmth', 'Candle-light warmth.'),
      st('vignette', { amount: 0.4 }, 'Vignette', 'Focus on the plate.')
    ]),
    recipe('vivid-landscape', 'Vivid Landscape', 'landscape', 'garden-05', 75, 'Deep skies, rich greens and crisp detail.', ['landscape', 'travel', 'vivid'], [
      st('highlights', { value: -22 }, 'Highlights', 'Bring back the sky.'),
      st('shadows', { value: 16 }, 'Shadows', 'Open the foreground.'),
      st('vibrance', { value: 28 }, 'Vibrance', 'Richer colour, careful with skin.'),
      st('contrast', { value: 10 }, 'Contrast', 'A little punch.'),
      st('clarity', { value: 22 }, 'Clarity', 'Texture in clouds and rocks.'),
      st('sharpen', { amount: 14 }, 'Sharpen', 'Crisp edges.')
    ]),
    recipe('blue-hour', 'Blue Hour', 'landscape', 'street-03', 75, 'Cool dusk tones with a glow in the lights.', ['city', 'night', 'cool'], [
      st('temperature', { value: -16 }, 'Warmth', 'Cool the evening air.'),
      st('contrast', { value: 10 }, 'Contrast', 'Define the shapes.'),
      st('split-tone', { shadowHue: 222, shadowAmount: 26, highlightHue: 38, highlightAmount: 18, balance: 0 }, 'Split tone', 'Blue shadows, warm lamps.'),
      st('vibrance', { value: 12 }, 'Vibrance', 'Glowing colour.'),
      st('vignette', { amount: 0.25 }, 'Vignette', 'A darker frame.')
    ]),
    recipe('misty-morning', 'Misty Morning', 'landscape', 'nature-02', 75, 'Soft, cool and quiet, like early fog.', ['landscape', 'soft', 'fog'], [
      st('exposure', { value: 0.1 }, 'Exposure', 'Morning brightness.'),
      st('contrast', { value: -16 }, 'Contrast', 'Soft, foggy light.'),
      st('fade', { amount: 22 }, 'Fade', 'Milky blacks.'),
      st('saturation', { value: -18 }, 'Saturation', 'Quiet colour.'),
      st('temperature', { value: -8 }, 'Warmth', 'Cool dawn air.'),
      st('clarity', { value: -12 }, 'Clarity', 'Diffuse the haze.')
    ]),
    recipe('vintage-film', 'Vintage Film', 'film', 'travel-03', 80, 'Faded colour, warm highlights, cool shadows and fine grain.', ['film', 'vintage', 'retro'], [
      st('contrast', { value: -6 }, 'Contrast', 'Gentle, printed contrast.'),
      st('saturation', { value: -18 }, 'Saturation', 'Aged colour.'),
      st('temperature', { value: 12 }, 'Warmth', 'Warm paper tone.'),
      st('split-tone', { shadowHue: 190, shadowAmount: 14, highlightHue: 42, highlightAmount: 18, balance: 0 }, 'Split tone', 'Cyan shadows, cream highlights.'),
      st('fade', { amount: 20 }, 'Fade', 'Lifted, matte blacks.'),
      st('grain', { amount: 16 }, 'Grain', 'Fine film grain.'),
      st('vignette', { amount: 0.22 }, 'Vignette', 'Soft lens fall-off.')
    ]),
    recipe('warm-negative', 'Warm Negative', 'film', 'travel-06', 75, 'Creamy colour-negative film: soft contrast, warm skin, gentle grain.', ['film', 'warm', 'analog'], [
      st('exposure', { value: 0.06 }, 'Exposure', 'Slightly over, like a well-fed negative.'),
      st('highlights', { value: -12 }, 'Highlights', 'Soft roll-off.'),
      st('temperature', { value: 9 }, 'Warmth', 'Warm skin.'),
      st('saturation', { value: -8 }, 'Saturation', 'Pastel-leaning colour.'),
      st('split-tone', { shadowHue: 185, shadowAmount: 10, highlightHue: 35, highlightAmount: 14, balance: 0 }, 'Split tone', 'Film colour separation.'),
      st('fade', { amount: 8 }, 'Fade', 'Slightly lifted blacks.'),
      st('grain', { amount: 10 }, 'Grain', 'Gentle grain.')
    ]),
    recipe('teal-orange', 'Teal & Orange', 'film', 'travel-02', 70, 'The blockbuster grade: teal shadows, orange highlights.', ['cinematic', 'night', 'bold'], [
      st('contrast', { value: 16 }, 'Contrast', 'Bold separation.'),
      st('split-tone', { shadowHue: 188, shadowAmount: 36, highlightHue: 28, highlightAmount: 30, balance: 0 }, 'Split tone', 'Complementary teal and orange.'),
      st('saturation', { value: -6 }, 'Saturation', 'Keep it from going neon.'),
      st('clarity', { value: 10 }, 'Clarity', 'A little bite.'),
      st('vignette', { amount: 0.3 }, 'Vignette', 'Cinema framing.')
    ]),
    recipe('instant-fade', 'Instant Fade', 'film', 'sky-02', 80, 'A sun-bleached instant print: faded, warm and dreamy.', ['instant', 'retro', 'faded'], [
      st('fade', { amount: 30 }, 'Fade', 'Washed-out blacks.'),
      st('contrast', { value: -10 }, 'Contrast', 'Soft print contrast.'),
      st('saturation', { value: -22 }, 'Saturation', 'Bleached colour.'),
      st('temperature', { value: 14 }, 'Warmth', 'Warm, yellowed print.'),
      st('split-tone', { shadowHue: 165, shadowAmount: 14, highlightHue: 48, highlightAmount: 20, balance: 10 }, 'Split tone', 'Green-cyan shadows, yellow highlights.'),
      st('vignette', { amount: 0.3 }, 'Vignette', 'Darker print edges.')
    ]),
    recipe('classic-bw', 'Classic Black & White', 'bw', 'sky-03', 100, 'Rich, balanced monochrome with real blacks.', ['black and white', 'mono', 'classic'], [
      st('saturation', { value: -100 }, 'Black & white', 'Remove colour.'),
      st('contrast', { value: 18 }, 'Contrast', 'Rich tones.'),
      st('clarity', { value: 12 }, 'Clarity', 'Texture and depth.'),
      st('sharpen', { amount: 12 }, 'Sharpen', 'Crisp detail.')
    ]),
    recipe('noir', 'Noir', 'bw', 'street-01', 100, 'Hard light, deep blacks and grain for drama.', ['black and white', 'noir', 'dramatic'], [
      st('saturation', { value: -100 }, 'Black & white', 'Remove colour.'),
      st('contrast', { value: 34 }, 'Contrast', 'Hard, dramatic light.'),
      st('exposure', { value: -0.1 }, 'Exposure', 'Darker mood.'),
      st('clarity', { value: 20 }, 'Clarity', 'Gritty texture.'),
      st('grain', { amount: 18 }, 'Grain', 'Fast-film grain.'),
      st('vignette', { amount: 0.5 }, 'Vignette', 'Heavy frame.')
    ]),
    recipe('silver-matte', 'Silver Matte', 'bw', 'travel-04', 100, 'Soft, airy monochrome with matte blacks and a cool silver tone.', ['black and white', 'matte', 'soft'], [
      st('saturation', { value: -100 }, 'Black & white', 'Remove colour.'),
      st('fade', { amount: 24 }, 'Fade', 'Matte blacks.'),
      st('contrast', { value: -4 }, 'Contrast', 'Gentle tones.'),
      st('split-tone', { shadowHue: 215, shadowAmount: 10, highlightHue: 215, highlightAmount: 4, balance: -20 }, 'Silver tone', 'A cool, silvery cast.'),
      st('grain', { amount: 8 }, 'Grain', 'A little tooth.')
    ]),
    recipe('sepia-print', 'Sepia Print', 'bw', 'garden-06', 100, 'Warm brown-toned print, like an old photograph.', ['sepia', 'vintage', 'warm'], [
      st('saturation', { value: -100 }, 'Black & white', 'Start from monochrome.'),
      st('split-tone', { shadowHue: 28, shadowAmount: 34, highlightHue: 40, highlightAmount: 26, balance: 0 }, 'Sepia tone', 'Brown shadows, cream highlights.'),
      st('fade', { amount: 14 }, 'Fade', 'An aged print.'),
      st('contrast', { value: 6 }, 'Contrast', 'Keep the print lively.'),
      st('vignette', { amount: 0.25 }, 'Vignette', 'Darkened edges.')
    ]),
    recipe('feed-pop', 'Feed Pop', 'social', 'people-05', 75, 'Bright, punchy and clean, made to stand out in a feed.', ['social', 'instagram', 'bright'], [
      st('exposure', { value: 0.06 }, 'Exposure', 'Bright and airy.'),
      st('contrast', { value: 14 }, 'Contrast', 'Punch.'),
      st('vibrance', { value: 26 }, 'Vibrance', 'Colour that pops.'),
      st('clarity', { value: 10 }, 'Clarity', 'Crisp on small screens.'),
      st('sharpen', { amount: 14 }, 'Sharpen', 'Survives compression.')
    ]),
    recipe('pastel-dream', 'Pastel Dream', 'social', 'travel-07', 75, 'Light, soft and pink-tinted, for an airy feed.', ['pastel', 'soft', 'pink'], [
      st('exposure', { value: 0.14 }, 'Exposure', 'Light and bright.'),
      st('contrast', { value: -14 }, 'Contrast', 'Soft.'),
      st('saturation', { value: -10 }, 'Saturation', 'Pastel colour.'),
      st('fade', { amount: 16 }, 'Fade', 'Powdery blacks.'),
      st('split-tone', { shadowHue: 205, shadowAmount: 12, highlightHue: 335, highlightAmount: 16, balance: 10 }, 'Split tone', 'Blue shadows, pink light.')
    ]),
    recipe('clean-scan', 'Clean Scan', 'document', 'books-03', 100, 'Turns a phone photo of a page into a clean, readable scan.', ['document', 'scan', 'paper'], [
      st('levels', { black: 40, white: 200, gamma: 1.1 }, 'Levels', 'White paper, dark ink.'),
      st('saturation', { value: -60 }, 'Saturation', 'Remove paper colour casts.'),
      st('contrast', { value: 10 }, 'Contrast', 'Crisp letters.'),
      st('sharpen', { amount: 34 }, 'Sharpen', 'Readable small print.')
    ], { format: 'jpeg', quality: 88 }),
    recipe('whiteboard', 'Whiteboard', 'document', 'paper-02', 100, 'Clears glare and grey from whiteboard and notebook photos, keeps marker colours.', ['document', 'whiteboard', 'notes'], [
      st('levels', { black: 50, white: 190, gamma: 1.05 }, 'Levels', 'A white board, not a grey one.'),
      st('vibrance', { value: 30 }, 'Vibrance', 'Bright marker colours.'),
      st('sharpen', { amount: 30 }, 'Sharpen', 'Readable writing.')
    ], { format: 'png', quality: 90 }),
    recipe('crisp-receipt', 'Crisp Receipt', 'document', 'paper-01', 100, 'High-contrast black and white for receipts and forms.', ['document', 'receipt', 'black and white'], [
      st('saturation', { value: -100 }, 'Black & white', 'Ink only.'),
      st('levels', { black: 70, white: 185, gamma: 1 }, 'Levels', 'Pure white paper.'),
      st('contrast', { value: 18 }, 'Contrast', 'Bold text.'),
      st('sharpen', { amount: 40 }, 'Sharpen', 'Sharp small print.')
    ], { format: 'png', quality: 90 })
  ];

  BUILTINS = BUILTINS.map(function (r) { return validate(r).workflow; });
  LE.recipes = {
    builtins: BUILTINS,
    categories: CATEGORIES,
    limits: WF_LIMITS,
    validate: validate,
    look: look,
    lookSteps: lookSteps,
    lookExtSteps: function (adjust) { var e = extPack(adjust); return e ? [{ operation: 'adjust', parameters: e }] : []; },
    fromLook: fromLook,
    extKeys: EXT_KEYS.slice(),
    lookMeta: { set: SET_KEYS, range: LOOK_RANGE },
    encodeLink: encodeLink,
    decodeLink: decodeLink,
    linkPayload: linkPayload,
    canCompressLinks: canDeflate,
    slug: slug,
    opLabel: function (op) { return OP_LABEL[op] || op; },
    categoryLabel: function (id) {
      for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][0] === id) return CATEGORIES[i][1];
      return id === 'personal' || id === 'general' ? 'Yours' : (id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Other');
    },
    /* The operation list the recipe editor offers, with parameter specs for building controls. */
    operations: function () {
      return CATALOG.map(function (c) {
        var op = c[0], params = [];
        Object.keys(c[3]).forEach(function (k) {
          var r = FIELD[op][k];
          if (r) params.push({ key: k, type: 'number', min: r.min, max: r.max, step: r.step, identity: r.identity, default: c[3][k] });
          else if (ENUMS[op] && ENUMS[op][k]) params.push({ key: k, type: 'enum', options: ENUMS[op][k].slice(), default: c[3][k] });
          else if (STRINGS[op] && STRINGS[op][k]) params.push({ key: k, type: STRINGS[op][k][0], default: c[3][k] });
        });
        return { operation: op, label: c[1], group: c[2], live: c[4], params: params };
      });
    },
    paramSpec: function (op, key) {
      var r = FIELD[op] && FIELD[op][key];
      if (r) return { key: key, type: 'number', min: r.min, max: r.max, step: r.step, identity: r.identity };
      if (ENUMS[op] && ENUMS[op][key]) return { key: key, type: 'enum', options: ENUMS[op][key].slice() };
      if (STRINGS[op] && STRINGS[op][key]) return { key: key, type: STRINGS[op][key][0], max: STRINGS[op][key][1] };
      if (BOOLS[op] && BOOLS[op].indexOf(key) >= 0) return { key: key, type: 'boolean' };
      return null;
    },
    isLive: function (op, params) {
      if (op === 'blur') return !params || !params.type || params.type === 'gaussian';
      return /^(exposure|brightness|contrast|saturation|vibrance|temperature|tint|hue|highlights|shadows|sharpness|sharpen|vignette|grain|fade|clarity|split-tone|levels|filter|adjust)$/.test(op);
    },
    find: function (id) {
      var all = BUILTINS.concat(LE.userRecipes ? LE.userRecipes.all() : []);
      for (var i = 0; i < all.length; i++) if (all[i].metadata.id === id) return all[i];
      return null;
    },
    isBuiltin: function (id) { return BUILTINS.some(function (r) { return r.metadata.id === id; }); },

    prepare: function (workflow, opts) {
      opts = opts || {};
      var tier = opts.tier || LE.device.tier();
      var intensity = opts.intensity == null ? (workflow.parameters && workflow.parameters[0] ? workflow.parameters[0].default : 100) : opts.intensity;
      var notices = [];
      var steps = [];
      var blocked = false;
      (workflow.steps || []).forEach(function (step) {
        if (step.enabled === false) return;
        var cap = LE.capabilities.for(step.operation, tier);
        if (cap === 'unavailable') {
          notices.push({ level: opts.allowSkip ? 'skipped' : 'unavailable', id: step.id, label: step.label, message: LE.capabilities.message(step.operation, tier) });
          if (!opts.allowSkip) blocked = true;
          return;
        }
        if (cap === 'optimized') notices.push({ level: 'optimized', id: step.id, label: step.label, message: LE.capabilities.message(step.operation, tier) });
        steps.push(Object.assign({}, step, { parameters: scaleParams(step.operation, step.parameters, intensity) }));
      });
      if (tier !== 'desktop' && workflow.compatibility && workflow.compatibility.mobileSupported === false) {
        notices.unshift({ level: 'optimized', label: workflow.metadata.name, message: 'This recipe was made for a desktop. You can still try it.' });
      }
      return { steps: blocked ? [] : steps, notices: notices, blocked: blocked, export: workflow.export };
    },

    /* Applies a recipe to a canvas at a strength (0-100). Resolves { canvas, notices }. */
    apply: function (canvas, workflow, opts) {
      opts = opts || {};
      var prep = LE.recipes.prepare(workflow, { intensity: opts.strength, allowSkip: true, tier: opts.tier });
      return LE.applySteps(canvas, prep.steps, { tier: opts.tier }).then(function (res) {
        return { canvas: res.canvas, notices: prep.notices.concat(res.notices) };
      });
    },

    stringify: function (workflow) {
      return JSON.stringify(workflow, null, 2);
    }
  };

  LE.recipes.selfCheck = function () {
    return LE.recipes.builtins.map(function (r) {
      var result = validate(r);
      return { name: r.metadata.name, ok: result.ok, errors: result.errors };
    });
  };

  function toBlob(canvas, type, quality) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (blob) {
        if (!blob) rej(new Error('Could not encode that format in this browser.'));
        else res(blob);
      }, type, quality);
    });
  }
  LE.toBlob = toBlob;

  function searchQuality(canvas, mime, target) {
    var lo = 0.35, hi = 0.95, best = null, i = 0;
    function step() {
      if (i++ >= 6) return Promise.resolve(best);
      var q = (lo + hi) / 2;
      return toBlob(canvas, mime, q).then(function (blob) {
        if (!best || Math.abs(blob.size - target) < Math.abs(best.size - target)) best = blob;
        if (blob.size > target) hi = q; else lo = q;
        return step();
      });
    }
    return step();
  }

  LE.exportImage = function (canvas, opts) {
    opts = opts || {};
    var format = opts.format || 'jpeg';
    var mime = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[format] || 'image/jpeg';
    var quality = opts.quality == null ? 0.9 : opts.quality;
    var work = canvas;
    if (mime === 'image/jpeg' || (opts.background && format !== 'png')) work = flatten(canvas, opts.background || '#ffffff');
    if (opts.maxWidth && work.width > opts.maxWidth) {
      work = resize(work, { width: opts.maxWidth, height: Math.round(work.height * opts.maxWidth / work.width), mode: 'high' });
    }
    var encoded = opts.targetBytes && mime !== 'image/png'
      ? searchQuality(work, mime, opts.targetBytes)
      : toBlob(work, mime, quality);
    return encoded.catch(function (err) {
      if (mime !== 'image/jpeg') return toBlob(flatten(canvas, opts.background || '#ffffff'), 'image/jpeg', quality);
      throw err;
    });
  };

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crc32.table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  LE.zip = function (files) {
    var encoder = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = encoder.encode(file.name);
      var data = file.data;
      var crc = crc32(data);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);
    var blobs = parts.concat(central, [new Uint8Array(eocd.buffer)]);
    var size = blobs.reduce(function (sum, part) { return sum + part.length; }, 0);
    var out = new Uint8Array(size);
    var cursor = 0;
    blobs.forEach(function (part) { out.set(part, cursor); cursor += part.length; });
    return new Blob([out], { type: 'application/zip' });
  };

  function db() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('localeditor', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function idb(mode, fn) {
    return db().then(function (database) {
      return new Promise(function (res, rej) {
        var tx = database.transaction('kv', mode);
        var req = fn(tx.objectStore('kv'));
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    });
  }

  LE.store = {
    set: function (key, value) { return idb('readwrite', function (store) { return store.put(value, key); }); },
    get: function (key) { return idb('readonly', function (store) { return store.get(key); }); },
    del: function (key) { return idb('readwrite', function (store) { return store.delete(key); }); }
  };

  LE.handoff = {
    put: function (blob, meta) { return LE.store.set('handoff', { blob: blob, meta: meta || {}, at: Date.now() }); },
    take: function () {
      return LE.store.get('handoff').then(function (value) {
        if (!value) return null;
        return LE.store.del('handoff').catch(function () {}).then(function () { return value; });
      });
    }
  };

  function ascii(view, tiff, le, offset, count) {
    var s = '';
    for (var i = 0; i < count && tiff + offset + i < view.byteLength; i++) {
      var c = view.getUint8(tiff + offset + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }

  LE.exif = function (file) {
    return file.arrayBuffer().then(function (buffer) {
      var view = new DataView(buffer);
      var info = { orientation: 1, bytes: file.size || buffer.byteLength, type: file.type || '' };
      if (buffer.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return info;
      var offset = 2;
      while (offset + 4 < view.byteLength) {
        if (view.getUint8(offset) !== 0xFF) break;
        var marker = view.getUint8(offset + 1);
        if (marker === 0xDA || marker === 0xD9) break;
        var size = view.getUint16(offset + 2);
        if (marker === 0xE1 && ascii(view, offset + 4, true, 0, 4) === 'Exif') {
          readTiff(view, offset + 10, info);
          break;
        }
        offset += 2 + size;
      }
      return info;
    }).catch(function () { return { orientation: 1 }; });
  };

  function readTiff(view, tiff, info) {
    var order = ascii(view, tiff, true, 0, 2);
    var le = order === 'II';
    function u16(o) { return view.getUint16(tiff + o, le); }
    function u32(o) { return view.getUint32(tiff + o, le); }
    if (tiff + 8 > view.byteLength || u16(2) !== 42) return;
    walk(u32(4), 0);
    function valueOffset(entry, type, count) {
      var size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1) * count;
      return size > 4 ? u32(entry + 8) : entry + 8;
    }
    function rational(off) {
      var n = u32(off), d = u32(off + 4);
      return d ? Math.round((n / d) * 100) / 100 : n;
    }
    function walk(ifd, depth) {
      if (depth > 3 || ifd < 0 || tiff + ifd + 2 > view.byteLength) return;
      var count = u16(ifd);
      for (var i = 0; i < count; i++) {
        var entry = ifd + 2 + i * 12;
        if (tiff + entry + 12 > view.byteLength) break;
        var tag = u16(entry);
        var type = u16(entry + 2);
        var n = u32(entry + 4);
        var off = valueOffset(entry, type, n);
        if (tag === 0x0112) info.orientation = u16(entry + 8);
        else if (tag === 0x010F) info.make = ascii(view, tiff, le, off, n);
        else if (tag === 0x0110) info.model = ascii(view, tiff, le, off, n);
        else if (tag === 0x0132) info.date = ascii(view, tiff, le, off, n);
        else if (tag === 0x8827) info.iso = type === 3 ? u16(off) : u32(off);
        else if (tag === 0x829A) info.exposure = rational(off);
        else if (tag === 0x829D) info.aperture = rational(off);
        else if (tag === 0x920A) info.focalLength = rational(off);
        else if (tag === 0xA002) info.pixelWidth = type === 3 ? u16(off) : u32(off);
        else if (tag === 0xA003) info.pixelHeight = type === 3 ? u16(off) : u32(off);
        else if (tag === 0x8769) walk(u32(entry + 8), depth + 1);
        else if (tag === 0x8825) readGps(u32(entry + 8));
      }
    }
    function readGps(ifd) {
      if (tiff + ifd + 2 > view.byteLength) return;
      var count = u16(ifd);
      var lat, lon, latRef = 'N', lonRef = 'E';
      for (var i = 0; i < count; i++) {
        var entry = ifd + 2 + i * 12;
        var tag = u16(entry);
        var type = u16(entry + 2);
        var n = u32(entry + 4);
        var off = valueOffset(entry, type, n);
        if (tag === 1) latRef = ascii(view, tiff, le, off, n);
        if (tag === 3) lonRef = ascii(view, tiff, le, off, n);
        if (tag === 2) lat = [rational(off), rational(off + 8), rational(off + 16)];
        if (tag === 4) lon = [rational(off), rational(off + 8), rational(off + 16)];
      }
      if (lat && lon) {
        var la = lat[0] + lat[1] / 60 + lat[2] / 3600;
        var lo = lon[0] + lon[1] / 60 + lon[2] / 3600;
        info.latitude = latRef === 'S' ? -la : la;
        info.longitude = lonRef === 'W' ? -lo : lo;
      }
    }
  }

  function drawOriented(source, orientation) {
    var w = source.width, h = source.height;
    var swap = orientation > 4;
    var c = document.createElement('canvas');
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    var ctx = ctx2(c);
    if (orientation === 2) ctx.transform(-1, 0, 0, 1, w, 0);
    else if (orientation === 3) ctx.transform(-1, 0, 0, -1, w, h);
    else if (orientation === 4) ctx.transform(1, 0, 0, -1, 0, h);
    else if (orientation === 5) ctx.transform(0, 1, 1, 0, 0, 0);
    else if (orientation === 6) ctx.transform(0, 1, -1, 0, h, 0);
    else if (orientation === 7) ctx.transform(0, -1, -1, 0, h, w);
    else if (orientation === 8) ctx.transform(0, -1, 1, 0, 0, w);
    ctx.drawImage(source, 0, 0);
    if (source.close) source.close();
    return c;
  }

  function decodeFile(file) {
    if (global.createImageBitmap) {
      try {
        return createImageBitmap(file, { imageOrientation: 'none' }).catch(function () { return createImageBitmap(file); });
      } catch (e) {}
    }
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  LE.load = function (file) {
    return Promise.all([
      LE.exif(file).catch(function () { return { orientation: 1 }; }),
      decodeFile(file)
    ]).then(function (pair) {
      var orientation = pair[0].orientation || 1;
      if (orientation < 2 || orientation > 8) orientation = 1;
      return drawOriented(pair[1], orientation);
    });
  };

  /* Recipes saved on this device (localStorage). Every read and write goes through the validator. */
  LE.userRecipes = {
    key: 'le-user-recipes',
    max: 60,
    raw: function () {
      try {
        var list = JSON.parse(localStorage.getItem(this.key) || '[]');
        return Array.isArray(list) ? list : [];
      } catch (e) { return []; }
    },
    all: function () {
      var seen = {};
      return this.raw().map(function (r) { var v = LE.recipes.validate(r); return v.ok ? v.workflow : null; }).filter(function (r) {
        if (!r || seen[r.metadata.id]) return false;
        seen[r.metadata.id] = 1;
        return true;
      });
    },
    get: function (id) {
      var all = this.all();
      for (var i = 0; i < all.length; i++) if (all[i].metadata.id === id) return all[i];
      return null;
    },
    write: function (list) {
      try { localStorage.setItem(this.key, JSON.stringify(list.slice(0, this.max))); }
      catch (e) { throw new Error('This device has no room left for more recipes. Delete one and try again.'); }
    },
    /* Validates, stores (newest first, replacing the same id) and returns the stored recipe. Throws on invalid input. */
    save: function (workflow) {
      var v = LE.recipes.validate(workflow);
      if (!v.ok) throw new Error(v.errors[0] || 'That is not a valid recipe.');
      var wf = v.workflow;
      var all = this.all().filter(function (r) { return r.metadata.id !== wf.metadata.id; });
      all.unshift(wf);
      this.write(all);
      return wf;
    },
    remove: function (id) {
      var all = this.all();
      var next = all.filter(function (r) { return r.metadata.id !== id; });
      this.write(next);
      return next.length !== all.length;
    },
    /* A free id: the slug of the name, or name-2, name-3... when taken by a built-in or a saved recipe. */
    freeId: function (name) {
      var base = LE.recipes.slug(name, 48) || 'my-recipe';
      var taken = {};
      LE.recipes.builtins.concat(this.all()).forEach(function (r) { taken[r.metadata.id] = 1; });
      var id = base, n = 2;
      while (taken[id]) id = base + '-' + (n++);
      return id;
    },
    duplicate: function (workflow) {
      var copy = JSON.parse(JSON.stringify(workflow));
      copy.metadata.name = String(copy.metadata.name || 'Recipe').slice(0, 74) + ' copy';
      copy.metadata.id = this.freeId(copy.metadata.name);
      if (copy.metadata.author === 'LocalEditor') copy.metadata.author = 'You';
      return this.save(copy);
    },
    votes: function () {
      try { return JSON.parse(localStorage.getItem('le-recipe-votes') || '{}'); } catch (e) { return {}; }
    },
    rate: function (id, score) {
      var votes = this.votes();
      votes[id] = score;
      localStorage.setItem('le-recipe-votes', JSON.stringify(votes));
    },
    savedIds: function () {
      try { return JSON.parse(localStorage.getItem('le-recipe-saved') || '{}'); } catch (e) { return {}; }
    },
    bookmark: function (id) {
      var saved = this.savedIds();
      if (saved[id]) delete saved[id]; else saved[id] = true;
      localStorage.setItem('le-recipe-saved', JSON.stringify(saved));
      return !!saved[id];
    }
  };
})(window);
