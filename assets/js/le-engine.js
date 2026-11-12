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
    ctx.putImageData(img, 0, 0);
    if (p.sharpness) sharpen(canvas, clamp(p.sharpness, 0, 100) / 100);
    return canvas;
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

  function rule(min, max, identity) { return { num: true, min: min, max: max, identity: identity }; }
  var FIELD = {
    exposure: { value: rule(-2, 2, 0) },
    brightness: { value: rule(-100, 100, 0) },
    contrast: { value: rule(-100, 100, 0) },
    saturation: { value: rule(-100, 100, 0) },
    vibrance: { value: rule(-100, 100, 0) },
    temperature: { value: rule(-50, 50, 0) },
    tint: { value: rule(-50, 50, 0) },
    hue: { value: rule(-180, 180, 0) },
    highlights: { value: rule(-100, 100, 0) },
    shadows: { value: rule(-100, 100, 0) },
    sharpness: { value: rule(0, 100, 0), amount: rule(0, 100, 0) },
    sharpen: { value: rule(0, 100, 0), amount: rule(0, 100, 0) },
    vignette: { value: rule(0, 1, 0), amount: rule(0, 1, 0) },
    grain: { value: rule(0, 40, 0), amount: rule(0, 40, 0) },
    adjust: {
      exposure: rule(-2, 2, 0), brightness: rule(-100, 100, 0), contrast: rule(-100, 100, 0),
      saturation: rule(-100, 100, 0), vibrance: rule(-100, 100, 0), temperature: rule(-50, 50, 0),
      tint: rule(-50, 50, 0), hue: rule(-180, 180, 0), highlights: rule(-100, 100, 0), shadows: rule(-100, 100, 0),
      sharpness: rule(0, 100, 0), vignette: rule(0, 1, 0), grain: rule(0, 40, 0),
      black: rule(0, 255, 0), white: rule(0, 255, 255), gamma: rule(0.2, 3, 1),
      red: rule(-100, 100, 0), green: rule(-100, 100, 0), blue: rule(-100, 100, 0)
    },
    levels: { black: rule(0, 255, 0), white: rule(0, 255, 255), gamma: rule(0.2, 3, 1) },
    curves: {},
    filter: { intensity: rule(0, 100, 0) },
    crop: { x: rule(0, 1), y: rule(0, 1), w: rule(0.01, 1), h: rule(0.01, 1) },
    resize: { width: rule(1, 16000), height: rule(1, 16000), percent: rule(1, 400), maxWidth: rule(1, 16000) },
    rotate: { degrees: rule(-360, 360, 0) },
    flip: {},
    blur: { radius: rule(0, 80, 0), angle: rule(0, 360, 0), cx: rule(0, 1), cy: rule(0, 1), rx: rule(0.05, 1), ry: rule(0.05, 1) },
    border: { padding: rule(0, 800, 0), size: rule(0, 400, 0), radius: rule(0, 800, 0) },
    frame: { padding: rule(0, 800, 0), size: rule(0, 400, 0), radius: rule(0, 800, 0) },
    text: { size: rule(0.01, 0.4), x: rule(0, 1), y: rule(0, 1), rotate: rule(-180, 180, 0), weight: rule(100, 900) },
    watermark: { opacity: rule(0, 1), scale: rule(0.02, 1), x: rule(0, 1), y: rule(0, 1) },
    shape: { x: rule(-1, 2), y: rule(-1, 2), w: rule(-2, 2), h: rule(-2, 2), opacity: rule(0, 1), strokeWidth: rule(1, 40) },
    background: { tolerance: rule(0, 100) },
    upscale: { factor: rule(1, 4) },
    social: { width: rule(1, 8000), height: rule(1, 8000) },
    meme: { scale: rule(0.04, 0.16) },
    'background-ai': {},
    'upscale-ai': {}
  };

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

  function scaleParams(op, params, intensity) {
    var spec = FIELD[op] || {};
    var t = clamp(intensity, 0, 100) / 100;
    var out = {};
    Object.keys(params || {}).forEach(function (k) {
      var rule = spec[k];
      var v = params[k];
      if (rule && rule.num && typeof v === 'number' && isFinite(v)) {
        v = clamp(v, rule.min, rule.max);
        out[k] = rule.identity != null ? rule.identity + (v - rule.identity) * t : v;
      }
    });
    var enums = ENUMS[op] || {};
    Object.keys(enums).forEach(function (k) {
      if (params[k] != null) out[k] = enums[k].indexOf(params[k]) >= 0 ? params[k] : enums[k][0];
    });
    ['text', 'font', 'color', 'outline', 'background', 'fill', 'stroke', 'replace', 'image'].forEach(function (k) {
      if (params[k] != null) out[k] = params[k];
    });
    if (op === 'curves' && Array.isArray(params.points)) out.points = params.points;
    if (typeof params.shadow === 'boolean') out.shadow = params.shadow;
    if (typeof params.tile === 'boolean') out.tile = params.tile;
    if (typeof params.lock === 'boolean') out.lock = params.lock;
    return out;
  }

  function stepTone(op, value, label, description) {
    return { id: label.toLowerCase().replace(/\s+/g, '-'), operation: op, label: label, description: description || '', enabled: true, parameters: { value: value } };
  }

  LE.recipes = {
    builtins: [
      {
        format: 'localeditor-workflow', version: '1.0',
        metadata: { id: 'cinematic-portrait', name: 'Cinematic Portrait', description: 'A warm, gently contrasted portrait with a soft vignette.', author: 'LocalEditor', category: 'portrait', difficulty: 'beginner', tags: ['portrait', 'cinematic', 'warm'], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: 75 }],
        steps: [
          stepTone('exposure', 0.16, 'Exposure', 'Brighten the face a little.'),
          stepTone('temperature', 14, 'Warmth', 'Shift the light toward gold.'),
          stepTone('contrast', 16, 'Contrast', 'Separate light and shadow.'),
          { id: 'vignette', operation: 'vignette', label: 'Vignette', description: 'Darken the corners slightly.', enabled: true, parameters: { amount: 0.32 } },
          stepTone('sharpness', 22, 'Sharpen', 'Bring eyes and hair into focus.')
        ],
        export: { format: 'jpeg', quality: 90 }
      },
      {
        format: 'localeditor-workflow', version: '1.0',
        metadata: { id: 'clean-product', name: 'Clean Product', description: 'Even light and crisp detail for a product photo.', author: 'LocalEditor', category: 'product', difficulty: 'beginner', tags: ['product', 'ecommerce'], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: 80 }],
        steps: [
          stepTone('exposure', 0.1, 'Exposure', 'Lift a dark product shot.'),
          stepTone('contrast', 12, 'Contrast', 'Keep edges readable.'),
          stepTone('saturation', -8, 'Color', 'Keep colors honest, not neon.'),
          stepTone('sharpness', 26, 'Sharpen', 'Make labels and edges clearer.')
        ],
        export: { format: 'jpeg', quality: 86 }
      },
      {
        format: 'localeditor-workflow', version: '1.0',
        metadata: { id: 'vintage-film', name: 'Vintage Film', description: 'Faded color, warm shadows, and a light vignette.', author: 'LocalEditor', category: 'creative', difficulty: 'beginner', tags: ['film', 'vintage'], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: 80 }],
        steps: [
          { id: 'film', operation: 'filter', label: 'Film look', description: 'Apply the vintage film grades.', enabled: true, parameters: { name: 'vintage', intensity: 100 } }
        ],
        export: { format: 'jpeg', quality: 90 }
      },
      {
        format: 'localeditor-workflow', version: '1.0',
        metadata: { id: 'ecommerce-export', name: 'Shop Export', description: 'Limit the long edge to 2000 pixels, sharpen, and save a smaller JPEG.', author: 'LocalEditor', category: 'product', difficulty: 'beginner', tags: ['export', 'shop', 'resize'], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Sharpen amount', type: 'slider', min: 0, max: 100, default: 100 }],
        steps: [
          { id: 'fit', operation: 'resize', label: 'Fit 2000px', description: 'Shrink only if the photo is larger than 2000 pixels wide.', enabled: true, parameters: { maxWidth: 2000, mode: 'high' } },
          stepTone('sharpness', 18, 'Sharpen', 'Recover a little detail after resizing.')
        ],
        export: { format: 'jpeg', quality: 82 }
      },
      {
        format: 'localeditor-workflow', version: '1.0',
        metadata: { id: 'golden-hour', name: 'Golden Hour', description: 'Warm light, held highlights, and a quiet vignette.', author: 'LocalEditor', category: 'portrait', difficulty: 'beginner', tags: ['warm', 'golden'], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: 78 }],
        steps: [
          stepTone('temperature', 22, 'Warmth', 'Push the light toward sunset.'),
          stepTone('exposure', 0.08, 'Exposure', 'Open the shadows a touch.'),
          stepTone('highlights', -12, 'Highlights', 'Hold bright skin and sky.'),
          { id: 'vignette', operation: 'vignette', label: 'Vignette', enabled: true, parameters: { amount: 0.2 } }
        ],
        export: { format: 'jpeg', quality: 90 }
      },
      {
        format: 'localeditor-workflow', version: '1.0',
        metadata: { id: 'soft-wedding', name: 'Soft Wedding', description: 'Airy skin tones and lower contrast for ceremony photos.', author: 'LocalEditor', category: 'portrait', difficulty: 'beginner', tags: ['wedding', 'soft'], license: 'Free to use and share' },
        compatibility: { minimumEditorVersion: '1.0', mobileSupported: true },
        parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: 70 }],
        steps: [
          stepTone('exposure', 0.12, 'Exposure', 'Brighten the room.'),
          stepTone('temperature', 8, 'Warmth', 'Keep the light flattering.'),
          stepTone('contrast', -8, 'Contrast', 'Soften harsh light.'),
          stepTone('highlights', -10, 'Highlights', 'Protect dresses and windows.')
        ],
        export: { format: 'jpeg', quality: 92 }
      }
    ],

    validate: function (input) {
      var errors = [];
      var data = input;
      if (typeof input === 'string') {
        if (input.length > 2000000) return { ok: false, errors: ['This recipe file is too large.'] };
        try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['This file is not valid JSON.'] }; }
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['This file is not a LocalEditor recipe.'] };
      if (data.format !== 'localeditor-workflow') errors.push('This file is not a LocalEditor recipe.');
      if (!/^1\./.test(String(data.version || ''))) errors.push('This recipe needs a newer LocalEditor.');
      var meta = data.metadata || {};
      var stepsIn = Array.isArray(data.steps) ? data.steps : null;
      if (!stepsIn) errors.push('This recipe has no steps.');
      if (stepsIn && stepsIn.length > 40) errors.push('This recipe has too many steps.');
      var steps = [];
      (stepsIn || []).forEach(function (step, index) {
        if (!step || typeof step !== 'object') { errors.push('Step ' + (index + 1) + ' is not readable.'); return; }
        var op = step.operation;
        if (!FIELD[op]) { errors.push('“' + cleanStr(op, 40) + '” is not a LocalEditor edit.'); return; }
        var params = {};
        var raw = step.parameters || {};
        if (raw && typeof raw === 'object') {
          var spec = FIELD[op];
          Object.keys(spec).forEach(function (k) {
            if (raw[k] == null || raw[k] === '') return;
            var n = Number(raw[k]);
            if (!isFinite(n)) { errors.push(step.label || op + ' has a value that is not a number.'); return; }
            params[k] = clamp(n, spec[k].min, spec[k].max);
          });
          var enums = ENUMS[op] || {};
          Object.keys(enums).forEach(function (k) {
            if (raw[k] == null) return;
            if (enums[k].indexOf(raw[k]) < 0) errors.push((step.label || op) + ' uses an unknown ' + k + '.');
            else params[k] = raw[k];
          });
          if (op === 'curves') {
            if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > 6) errors.push('Curves need between 2 and 6 points.');
            else {
              params.points = raw.points.map(function (pt) {
                return [clamp(Number(pt[0]) || 0, 0, 1), clamp(Number(pt[1]) || 0, 0, 1)];
              });
            }
          }
          ['text', 'font', 'color', 'outline', 'background', 'fill', 'stroke', 'replace'].forEach(function (k) {
            if (raw[k] != null) params[k] = cleanStr(raw[k], k === 'text' ? 240 : 80);
          });
          if (raw.image != null) {
            if (typeof raw.image !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw.image) || raw.image.length > 1500000) {
              errors.push('A recipe image must be a small PNG, JPEG, or WebP.');
            } else params.image = raw.image;
          }
          if (typeof raw.shadow === 'boolean') params.shadow = raw.shadow;
          if (typeof raw.tile === 'boolean') params.tile = raw.tile;
        }
        steps.push({
          id: cleanStr(step.id || ('step-' + (index + 1)), 40),
          operation: op,
          label: cleanStr(step.label || op, 60),
          description: cleanStr(step.description || '', 180),
          enabled: step.enabled !== false,
          parameters: params
        });
      });
      var intensity = 75;
      if (Array.isArray(data.parameters) && data.parameters[0] && isFinite(Number(data.parameters[0].default))) {
        intensity = clamp(Number(data.parameters[0].default), 0, 100);
      }
      var exp = data.export || {};
      var format = ['jpeg', 'png', 'webp'].indexOf(exp.format) >= 0 ? exp.format : 'jpeg';
      var workflow = {
        format: 'localeditor-workflow',
        version: '1.0',
        metadata: {
          id: cleanStr(meta.id || ('recipe-' + Date.now()), 60),
          name: cleanStr(meta.name || 'Untitled recipe', 80),
          description: cleanStr(meta.description || '', 400),
          author: cleanStr(meta.author || 'Anonymous', 80),
          category: cleanStr(meta.category || 'general', 40),
          difficulty: ['beginner', 'intermediate', 'expert'].indexOf(meta.difficulty) >= 0 ? meta.difficulty : 'beginner',
          tags: Array.isArray(meta.tags) ? meta.tags.slice(0, 8).map(function (t) { return cleanStr(t, 24); }) : [],
          license: cleanStr(meta.license || 'Free to use and share', 80)
        },
        compatibility: {
          minimumEditorVersion: '1.0',
          mobileSupported: !data.compatibility || data.compatibility.mobileSupported !== false
        },
        parameters: [{ id: 'intensity', label: 'Effect intensity', type: 'slider', min: 0, max: 100, default: intensity }],
        steps: steps,
        export: { format: format, quality: clamp(num(exp.quality, 90), 40, 100) }
      };
      return { ok: errors.length === 0, errors: errors, workflow: workflow };
    },

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

    stringify: function (workflow) {
      return JSON.stringify(workflow, null, 2);
    }
  };

  LE.recipes.selfCheck = function () {
    return LE.recipes.builtins.map(function (recipe) {
      var result = LE.recipes.validate(recipe);
      return { name: recipe.metadata.name, ok: result.ok, errors: result.errors };
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

  LE.userRecipes = {
    key: 'le-user-recipes',
    all: function () {
      try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { return []; }
    },
    save: function (workflow) {
      var all = this.all().filter(function (r) { return r.metadata.id !== workflow.metadata.id; });
      all.unshift(workflow);
      localStorage.setItem(this.key, JSON.stringify(all.slice(0, 40)));
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
