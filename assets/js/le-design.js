/* LocalEditor: open design format (.ledesign.json): read, write, shorthand, lint, remix links.
   Spec: docs/FORMAT-DESIGN.md. Schema: schema/design-1.json. The one safety gate stays LE.project.validate:
   parse() turns the file into the internal project shape and hands it to that validator.
   Nothing here runs code from a file and nothing is fetched without the person agreeing. */
(function () {
  'use strict';

  var LE = window.LE = window.LE || {};
  /* Captured before the studio rewrites the address bar (panels replace the URL without the fragment). */
  var INITIAL_HASH = typeof location !== 'undefined' ? String(location.hash || '') : '';

  (window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push(
    { id: 'design.remix-link', name: 'Template links', needs: [], wants: ['compression-stream'] },
    { id: 'design.share', name: 'Share template links', needs: [], wants: ['web-share'] }
  );

  var FORMAT = 'localeditor-design';
  var VERSION = 1;
  var SCHEMA_URL = 'https://localeditor.net/schema/design-1.json';
  var LIMITS = {
    json: 12 * 1024 * 1024, pages: 50, layers: 600, text: 8000, name: 160, variables: 50, depth: 40,
    linkChars: 30000, linkBytes: 512 * 1024, qrChars: 1200
  };
  var BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  var TYPES = ['image', 'text', 'shape', 'svg', 'path', 'group', 'icon'];
  var IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' };
  var ICON_SETS = { lucide: 1, phosphor: 1, ph: 1, emoji: 1, stickers: 1, withicons: 1 };
  var BG_FIT_IN = { fill: 'cover', cover: 'cover', fit: 'contain', contain: 'contain', stretch: 'fill', tile: 'tile' };
  var BG_FIT_OUT = { cover: 'fill', contain: 'fit', fill: 'stretch', tile: 'tile' };
  var ADJUST_KEYS = ['brightness', 'contrast', 'saturation', 'warmth', 'temperature', 'tint', 'exposure', 'highlights', 'shadows', 'vibrance', 'sharpness', 'blur', 'vignette', 'grain', 'hue',
    'fade', 'clarity', 'splitShadowHue', 'splitShadowAmount', 'splitHighlightHue', 'splitHighlightAmount', 'splitBalance', 'black', 'white', 'gamma'];
  /* Strings may not carry markup or script URLs. svg markup has its own check; src has its own. */
  var DANGER = /<\s*\/?\s*(?:script|iframe|object|embed|style|link|meta|html|body|svg|img|foreignobject|form|input|textarea|button|a)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;
  var SVG_DANGER = /<\s*(?:script|foreignobject|iframe|embed|object)\b|\son[a-z]+\s*=|javascript\s*:|<!ENTITY|<!DOCTYPE/i;

  /* ---------- Small helpers ---------- */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function ptr(base, key) { return base + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1'); }
  function plain(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
  function slug(s, max) { return String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 40); }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return ''; } }
  function safeColor(v) {
    if (typeof v !== 'string') return null;
    var c = v.trim();
    if (c.length > 64) return null;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
    if (/^(?:rgb|hsl)a?\(\s*[\d.%\s,\/-]+\)$/i.test(c)) return c;
    if (/^[a-z]{3,24}$/i.test(c)) return c;
    return null;
  }
  function withTimeout(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }

  /* ---------- Colour maths for lint ---------- */
  var NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', navy: '#000080', gold: '#ffd700' };
  function rgbOf(c) {
    if (typeof c !== 'string') return null;
    c = c.trim().toLowerCase();
    if (NAMED[c]) c = NAMED[c];
    var m = /^#([0-9a-f]{3,8})$/.exec(c);
    if (m) {
      var hx = m[1];
      if (hx.length === 3 || hx.length === 4) hx = hx.split('').map(function (ch) { return ch + ch; }).join('');
      if (hx.length !== 6 && hx.length !== 8) return null;
      var a = hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1;
      return { r: parseInt(hx.slice(0, 2), 16), g: parseInt(hx.slice(2, 4), 16), b: parseInt(hx.slice(4, 6), 16), a: a };
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+%?))?\s*\)$/.exec(c);
    if (m) {
      var al = m[4] == null ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: +m[1], g: +m[2], b: +m[3], a: al };
    }
    return null;
  }
  function luminance(rgb) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* ---------- Text measurement (own canvas; the same wrapping rules LE.Scene uses) ---------- */
  var mctx = null;
  function measureCtx() {
    if (mctx) return mctx;
    if (typeof document === 'undefined') return null;
    try { mctx = document.createElement('canvas').getContext('2d'); } catch (e) { mctx = null; }
    return mctx;
  }
  function fontFamily(name) {
    if (LE.fonts && typeof LE.fonts.css === 'function') { try { return LE.fonts.css(name) || 'sans-serif'; } catch (e) { /* fall through */ } }
    return '"' + String(name || 'sans-serif').replace(/"/g, '') + '", sans-serif';
  }
  function mw(ctx, text, spacing) {
    if (!text) return 0;
    if (!spacing) return ctx.measureText(text).width;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text.charAt(i)).width + spacing;
    return Math.max(0, w - spacing);
  }
  function wrap(ctx, text, maxW, spacing) {
    var paras = String(text).replace(/\r\n?/g, '\n').split('\n');
    var lines = [];
    var broke = false;
    function breakWord(word) {
      var buf = '';
      broke = true;
      for (var i = 0; i < word.length; i++) {
        var next = buf + word.charAt(i);
        if (buf && mw(ctx, next, spacing) > maxW) { lines.push(buf); buf = word.charAt(i); } else buf = next;
      }
      return buf;
    }
    paras.forEach(function (para) {
      if (!para) { lines.push(''); return; }
      var words = para.split(/(\s+)/);
      var line = '';
      words.forEach(function (word) {
        if (!word) return;
        if (!word.trim()) { if (line && mw(ctx, line + word, spacing) <= maxW) line += word; return; }
        if (line && mw(ctx, line + word, spacing) > maxW) { lines.push(line.replace(/\s+$/, '')); line = ''; }
        if (!line && mw(ctx, word, spacing) > maxW) line = breakWord(word);
        else line += word;
      });
      lines.push(line.replace(/\s+$/, ''));
    });
    return { lines: lines.length ? lines : [''], broke: broke };
  }
  /* { height, lines, broke } for a text layer at its own size, or null when no canvas exists. */
  function measureText(l, size) {
    var ctx = measureCtx();
    if (!ctx) return null;
    size = size || l.size || 48;
    var text = String(l.text == null ? '' : l.text);
    if (l.uppercase) text = text.toUpperCase();
    ctx.font = (l.italic ? 'italic ' : 'normal ') + (l.weight || 400) + ' ' + size + 'px ' + fontFamily(l.font);
    var lh = (l.lineHeight || 1.2) * size;
    if (l.curve) return { height: lh, lines: [text], broke: false };
    var spacing = (l.letterSpacing || 0) * (size / (l.size || size));
    var res = wrap(ctx, text, Math.max(1, l.w || 1), spacing);
    return { height: res.lines.length * lh, lines: res.lines, broke: res.broke };
  }
  function loadFont(font, weight, italic) {
    if (!LE.fonts || typeof LE.fonts.load !== 'function') return Promise.resolve(false);
    return withTimeout(LE.fonts.load(font, weight, !!italic), 6000).then(function () { return true; }, function () { return false; });
  }
  function knownFont(name) {
    if (!LE.fonts || typeof LE.fonts.list !== 'function') return true;
    var n = String(name || '').toLowerCase();
    try { return LE.fonts.list().some(function (f) { return f.family.toLowerCase() === n; }); } catch (e) { return true; }
  }

  /* ---------- Binary helpers ---------- */
  function b64ToBytes(b64) {
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64url(bytes) { return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return b64ToBytes(s);
  }
  function blobToDataUri(blob) {
    return blob.arrayBuffer().then(function (buf) {
      return 'data:' + (blob.type || 'image/png') + ';base64,' + bytesToB64(new Uint8Array(buf));
    });
  }
  function dims(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).then(function (bmp) { var d = { width: bmp.width, height: bmp.height }; if (bmp.close) bmp.close(); return d; });
    }
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
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
        if (cap && total > cap) { reader.cancel().catch(function () {}); throw new Error('too large'); }
        chunks.push(r.value);
        return next();
      });
    }
    return next();
  }

  /* =====================================================================
     READ
     ===================================================================== */

  function Report() { this.errors = []; this.warnings = []; }
  Report.prototype.err = function (path, message) { if (this.errors.length < 200) this.errors.push({ path: path || '', message: message }); };
  Report.prototype.warn = function (path, kind, message, layer) {
    if (this.warnings.length >= 300) return;
    var w = { path: path || '', kind: kind, message: message };
    if (layer) w.layer = layer;
    this.warnings.push(w);
  };

  /* Walks the raw JSON once for forbidden keys, markup in strings and runaway nesting. */
  function scan(v, path, rep, depth) {
    if (depth > LIMITS.depth) { rep.err(path, 'The file is nested too deeply.'); return; }
    if (typeof v === 'string') {
      var key = path.slice(path.lastIndexOf('/') + 1);
      if (key !== 'svg' && key !== 'src' && DANGER.test(v)) rep.err(path, 'Text cannot contain HTML, script or javascript: links.');
      return;
    }
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) scan(v[i], path + '/' + i, rep, depth + 1); return; }
    if (v && typeof v === 'object') {
      Object.keys(v).forEach(function (k) {
        if (BAD_KEYS[k]) { rep.err(ptr(path, k), 'Keys named __proto__, constructor or prototype are not allowed.'); return; }
        scan(v[k], ptr(path, k), rep, depth + 1);
      });
    }
  }

  function numberAt(v, path, rep, label) {
    if (v == null) return null;
    if (isNum(v)) return v;
    rep.err(path, (label || 'This value') + ' must be a number.');
    return null;
  }
  function boolAt(v, path, rep) {
    if (v == null) return null;
    if (typeof v === 'boolean') return v;
    rep.err(path, 'Use true or false.');
    return null;
  }
  function colorAt(v, path, rep) {
    if (v == null) return null;
    var c = safeColor(v);
    if (!c) rep.err(path, 'Not a colour. Use "#RRGGBB", "rgb(…)" or a colour name.');
    return c;
  }
  /* Size: number, "50%" of the page axis, or "auto" where allowed. */
  function sizeAt(v, total, path, rep, allowAuto) {
    if (v == null) return null;
    if (isNum(v)) return v;
    if (typeof v === 'string') {
      var s = v.trim();
      if (allowAuto && s === 'auto') return 'auto';
      var m = /^(-?\d+(?:\.\d+)?)%$/.exec(s);
      if (m) return r2(total * Number(m[1]) / 100);
    }
    rep.err(path, 'Use a number of pixels or a percentage like "90%"' + (allowAuto ? ', or "auto"' : '') + '.');
    return null;
  }
  /* Position: number, "50%", or an edge/centre word; resolved once the size is known. */
  function posSpec(v, path, rep, axis) {
    if (v == null) return null;
    if (isNum(v)) return v;
    if (typeof v === 'string') {
      var s = v.trim().toLowerCase();
      var words = axis === 'x' ? { left: 'start', center: 'center', middle: 'center', right: 'end' } : { top: 'start', center: 'center', middle: 'center', bottom: 'end' };
      if (words[s]) return { anchor: words[s] };
      var m = /^(-?\d+(?:\.\d+)?)%$/.exec(s);
      if (m) return { pct: Number(m[1]) };
    }
    rep.err(path, axis === 'x' ? 'Use a number, a percentage, or "left", "center" or "right".' : 'Use a number, a percentage, or "top", "center" or "bottom".');
    return null;
  }
  function resolvePos(spec, total, size) {
    if (spec == null) return 0;
    if (isNum(spec)) return spec;
    if (spec.anchor === 'start') return 0;
    if (spec.anchor === 'center') return r2((total - size) / 2);
    if (spec.anchor === 'end') return r2(total - size);
    if (spec.pct != null) return r2(total * spec.pct / 100);
    return 0;
  }

  function fillAt(v, path, rep) {
    if (v == null) return null;
    if (typeof v === 'string') {
      if (v === 'none' || v === 'transparent') return { type: 'none' };
      var c = colorAt(v, path, rep);
      return c ? { type: 'solid', color: c } : null;
    }
    if (!isObj(v)) { rep.err(path, 'A fill is a colour string or { "type": "solid" | "linear" | "radial" | "none", … }.'); return null; }
    var type = v.type == null ? (Array.isArray(v.colors) ? 'linear' : 'solid') : v.type;
    if (['solid', 'linear', 'radial', 'none'].indexOf(type) < 0) { rep.err(path + '/type', 'Fill type must be "solid", "linear", "radial" or "none".'); return null; }
    var out = { type: type };
    if (v.color != null) out.color = colorAt(v.color, path + '/color', rep);
    if (v.colors != null) {
      if (!Array.isArray(v.colors)) rep.err(path + '/colors', 'colors must be a list of colours.');
      else out.colors = v.colors.slice(0, 8).map(function (c, i) { return colorAt(c, path + '/colors/' + i, rep); }).filter(Boolean);
    }
    if (v.angle != null) out.angle = numberAt(v.angle, path + '/angle', rep, 'angle');
    if (type === 'solid' && !out.color && out.colors && out.colors.length) out.color = out.colors[0];
    return out;
  }
  function objAt(v, path, rep, what) {
    if (v == null) return null;
    if (isObj(v)) return v;
    rep.err(path, (what || 'This') + ' must be an object.');
    return null;
  }

  var COMMON = ['id', 'name', 'type', 'x', 'y', 'w', 'h', 'rotation', 'opacity', 'blend', 'visible', 'locked', 'flipX', 'flipY', 'groupId', 'shadow'];
  var BY_TYPE = {
    text: ['text', 'font', 'weight', 'italic', 'size', 'color', 'fill', 'align', 'lineHeight', 'letterSpacing', 'uppercase', 'underline', 'strike', 'stroke', 'background', 'curve', 'fit'],
    image: ['src', 'source', 'crop', 'fit', 'radius', 'border', 'mask', 'maskPath', 'slot', 'adjust', 'recipe', 'filter', 'removeBg', 'fx'],
    shape: ['shape', 'params', 'radius', 'fill', 'stroke'],
    svg: ['assetId', 'svg', 'color', 'strokeWidth', 'iconStyle', 'qr', 'icon'],
    icon: ['icon', 'assetId', 'color', 'strokeWidth', 'iconStyle'],
    path: ['points', 'smoothing', 'width', 'color', 'mode'],
    group: []
  };

  /* One file layer → an internal layer draft plus the work still to do (images, icons, measuring, placing). */
  function readLayer(src, path, page, rep, st) {
    if (!isObj(src)) { rep.err(path, 'A layer must be an object.'); return null; }
    var type = src.type;
    if (TYPES.indexOf(type) < 0) {
      rep.err(path + '/type', type == null ? 'Every layer needs a "type": image, text, shape, svg, icon, path or group.' : 'Unknown layer type "' + plain(type, 30) + '". Use image, text, shape, svg, icon, path or group.');
      return null;
    }
    var allowed = COMMON.concat(BY_TYPE[type] || []);
    Object.keys(src).forEach(function (k) { if (allowed.indexOf(k) < 0) rep.warn(ptr(path, k), 'unknown-key', 'The key "' + plain(k, 40) + '" is not part of a ' + type + ' layer and was ignored.', typeof src.id === 'string' ? src.id : null); });

    var id = src.id;
    if (id == null) {
      var n = 1;
      while (st.ids[type + '-' + n]) n++;
      id = type + '-' + n;
    } else if (typeof id !== 'string' || !/^[\w:.-]{1,48}$/.test(id)) {
      rep.err(path + '/id', 'Layer ids use letters, numbers, "-", "_", "." or ":" (up to 48 characters).');
      return null;
    } else if (st.ids[id]) {
      rep.err(path + '/id', 'The id "' + id + '" is used twice. Every layer needs its own id.');
      return null;
    }
    st.ids[id] = 1;
    var W = page.width, H = page.height;
    var l = { id: id, type: type === 'icon' ? 'svg' : type, name: typeof src.name === 'string' && src.name.trim() ? src.name.slice(0, 120) : id };
    if (src.name != null && typeof src.name !== 'string') rep.err(path + '/name', 'name must be text.');
    var d = { l: l, path: path, w: sizeAt(src.w, W, path + '/w', rep, type === 'text'), h: sizeAt(src.h, H, path + '/h', rep, type === 'text'),
      x: posSpec(src.x, path + '/x', rep, 'x'), y: posSpec(src.y, path + '/y', rep, 'y') };
    ['rotation', 'opacity'].forEach(function (k) { var v = numberAt(src[k], path + '/' + k, rep, k); if (v != null) l[k] = v; });
    if (src.blend != null) {
      if (typeof src.blend !== 'string') rep.err(path + '/blend', 'blend must be text.');
      else l.blend = src.blend === 'normal' ? 'source-over' : src.blend;
    }
    ['visible', 'locked', 'flipX', 'flipY'].forEach(function (k) { var v = boolAt(src[k], path + '/' + k, rep); if (v != null) l[k] = v; });
    if (src.groupId != null) {
      if (typeof src.groupId !== 'string' || !/^[\w:.-]{1,48}$/.test(src.groupId)) rep.err(path + '/groupId', 'groupId must be the id of a group layer.');
      else l.groupId = src.groupId;
    }
    if (src.shadow != null) {
      var sh = objAt(src.shadow, path + '/shadow', rep, 'shadow');
      if (sh) {
        l.shadow = {};
        if (sh.color != null) l.shadow.color = colorAt(sh.color, path + '/shadow/color', rep);
        ['blur', 'x', 'y'].forEach(function (k) { var v = numberAt(sh[k], path + '/shadow/' + k, rep, k); if (v != null) l.shadow[k] = v; });
      }
    }

    if (type === 'text') readText(src, path, l, d, rep);
    else if (type === 'image') readImage(src, path, l, d, rep, st, page);
    else if (type === 'shape') readShape(src, path, l, rep);
    else if (type === 'svg' || type === 'icon') readSvg(src, path, l, d, rep, type);
    else if (type === 'path') readPath(src, path, l, rep);
    readExpert(src, l, d, page, type);
    return d;
  }

  function readText(src, path, l, d, rep) {
    if (src.text == null) rep.err(path + '/text', 'A text layer needs "text".');
    else if (typeof src.text !== 'string' && !isNum(src.text)) rep.err(path + '/text', 'text must be a string.');
    else {
      var t = String(src.text);
      if (t.length > LIMITS.text) rep.err(path + '/text', 'Text is limited to ' + LIMITS.text + ' characters per layer.');
      l.text = t;
    }
    if (src.font != null) {
      if (typeof src.font !== 'string' || !/^[\w \-]{1,80}$/.test(src.font)) rep.err(path + '/font', 'font must be a font family name such as "Inter".');
      else l.font = src.font;
    }
    if (src.weight != null) {
      if (src.weight === 'bold') l.weight = 700;
      else if (src.weight === 'normal' || src.weight === 'regular') l.weight = 400;
      else { var wv = numberAt(src.weight, path + '/weight', rep, 'weight'); if (wv != null) l.weight = clamp(Math.round(wv), 100, 900); }
    }
    ['italic', 'uppercase', 'underline', 'strike'].forEach(function (k) { var v = boolAt(src[k], path + '/' + k, rep); if (v != null) l[k] = v; });
    ['size', 'lineHeight', 'letterSpacing', 'curve'].forEach(function (k) { var v = numberAt(src[k], path + '/' + k, rep, k); if (v != null) l[k] = v; });
    if (src.color != null) l.color = colorAt(src.color, path + '/color', rep);
    if (src.fill != null) l.fill = fillAt(src.fill, path + '/fill', rep);
    if (src.align != null) {
      if (['left', 'center', 'right'].indexOf(src.align) < 0) rep.err(path + '/align', 'align must be "left", "center" or "right".');
      else l.align = src.align;
    }
    if (src.stroke != null) {
      var s = objAt(src.stroke, path + '/stroke', rep, 'stroke');
      if (s) l.stroke = { width: numberAt(s.width, path + '/stroke/width', rep, 'width') || 0, color: colorAt(s.color, path + '/stroke/color', rep) || '#17131F' };
    }
    if (src.background != null) {
      var bg = typeof src.background === 'string' ? { color: src.background } : objAt(src.background, path + '/background', rep, 'background');
      if (bg) {
        l.background = { color: colorAt(bg.color, path + '/background/color', rep) || '#ffffff' };
        ['radius', 'padding'].forEach(function (k) { var v = numberAt(bg[k], path + '/background/' + k, rep, k); if (v != null) l.background[k] = v; });
      }
    }
    if (src.fit != null) {
      if (src.fit !== 'shrink' && src.fit !== 'none') rep.err(path + '/fit', 'On text, fit can only be "shrink".');
      else if (src.fit === 'shrink') d.shrink = true;
    }
    d.text = true;
  }

  function readSrc(v, path, rep, st, ref) {
    if (v == null || v === '') return null;
    if (typeof v !== 'string') { rep.err(path, 'src must be text: a data: URI, a relative path or an https: URL.'); return null; }
    var s = v.trim();
    if (/^data:/i.test(s)) {
      if (st.link) { st.dropped.push(path); return null; }
      var m = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif|bmp));base64,([a-z0-9+\/=\s]+)$/i.exec(s);
      if (!m) { rep.err(path, 'Only base64 PNG, JPEG, WebP, GIF, AVIF or BMP data: URIs are allowed here.'); return null; }
      return { kind: 'data', type: m[1].toLowerCase().replace('jpg', 'jpeg'), b64: m[2], ref: ref, path: path };
    }
    if (/^https:\/\//i.test(s)) {
      if (st.link) { st.dropped.push(path); return null; }
      if (s.length > 2000 || /[\s<>"']/.test(s) || !hostOf(s)) { rep.err(path, 'That image URL is not valid.'); return null; }
      return { kind: 'remote', url: s, host: hostOf(s), ref: ref, path: path };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) { rep.err(path, 'Images can be data: URIs, relative paths or https: URLs. "' + plain(s.split(':')[0], 20) + ':" is not allowed.'); return null; }
    if (/^[a-f0-9]{64}$/.test(s)) return { kind: 'id', id: s, ref: ref, path: path };
    if (st.link) { st.dropped.push(path); return null; }
    if (s.length > 300 || /(^|\/)\.\.(\/|$)|^\/|\\|[<>"'?#]/.test(s)) { rep.err(path, 'Image paths are relative, without "..", "\\", "?" or "#".'); return null; }
    return { kind: 'path', rel: s, ref: ref, path: path };
  }

  function readImage(src, path, l, d, rep, st, page) {
    d.img = readSrc(src.src, path + '/src', rep, st, { page: page.index, layer: l.id });
    if (src.crop != null) {
      var c = objAt(src.crop, path + '/crop', rep, 'crop');
      if (c) {
        l.crop = {};
        ['x', 'y', 'w', 'h'].forEach(function (k) { var v = numberAt(c[k], path + '/crop/' + k, rep, k); l.crop[k] = v == null ? (k === 'w' || k === 'h' ? 1 : 0) : v; });
      }
    }
    if (src.fit != null) {
      if (['cover', 'contain', 'stretch', 'fill'].indexOf(src.fit) < 0) rep.err(path + '/fit', 'On images, fit is "cover", "contain" or "stretch".');
      else d.fit = src.fit === 'fill' ? 'cover' : src.fit;
    }
    var rv = numberAt(src.radius, path + '/radius', rep, 'radius');
    if (rv != null) l.radius = rv;
    if (src.border != null) {
      var b = objAt(src.border, path + '/border', rep, 'border');
      if (b) l.border = { width: numberAt(b.width, path + '/border/width', rep, 'width') || 0, color: colorAt(b.color, path + '/border/color', rep) || '#17131F' };
    }
    if (src.mask != null && !isObj(src.mask)) {
      if (typeof src.mask !== 'string' || !/^[\w-]{1,40}$/.test(src.mask)) rep.err(path + '/mask', 'mask is a shape id such as "ellipse" or "heart".');
      else l.mask = src.mask;
    }
    if (src.maskPath != null) {
      if (typeof src.maskPath !== 'string' || /[^MmLlCcQqAaZzHhVv0-9eE+.,\s-]/.test(src.maskPath)) rep.err(path + '/maskPath', 'maskPath is an SVG path made of M, L, C, Q, A, H, V, Z commands and numbers.');
      else l.maskPath = src.maskPath;
    }
    if (src.slot != null) {
      if (src.slot === true) l.slot = { id: l.id.replace(/[^\w.-]/g, '').slice(0, 40), label: l.name !== l.id ? l.name.slice(0, 80) : 'Photo', photo: '' };
      else if (src.slot === false) { /* not a slot */ } else {
        var so = objAt(src.slot, path + '/slot', rep, 'slot');
        if (so) l.slot = { id: typeof so.id === 'string' ? so.id : l.id.replace(/[^\w.-]/g, '').slice(0, 40), label: typeof so.label === 'string' ? so.label : 'Photo', photo: typeof so.photo === 'string' ? so.photo : '' };
      }
    }
    if (src.adjust != null) {
      var a = objAt(src.adjust, path + '/adjust', rep, 'adjust');
      if (a) {
        l.adjust = {};
        Object.keys(a).forEach(function (k) {
          if (k === 'recipe') { l.adjust.recipe = a.recipe; return; }
          if (ADJUST_KEYS.indexOf(k) < 0) { rep.warn(ptr(path + '/adjust', k), 'unknown-key', 'Unknown adjustment "' + plain(k, 30) + '" was ignored.', l.id); return; }
          var v = numberAt(a[k], ptr(path + '/adjust', k), rep, k);
          if (v != null) l.adjust[k] = v;
        });
      }
    }
    if (src.filter != null) {
      var f = typeof src.filter === 'string' ? { name: src.filter } : objAt(src.filter, path + '/filter', rep, 'filter');
      if (f) {
        if (typeof f.name !== 'string' || !/^[a-z-]{1,30}$/.test(f.name)) rep.err(path + '/filter', 'filter is a filter name such as "warm" or { "name", "intensity" }.');
        else l.filter = { name: f.name, intensity: f.intensity == null ? 100 : numberAt(f.intensity, path + '/filter/intensity', rep, 'intensity') };
      }
    }
    if (src.removeBg != null) {
      var rb = objAt(src.removeBg, path + '/removeBg', rep, 'removeBg');
      if (rb) l.removeBg = { color: colorAt(rb.color, path + '/removeBg/color', rep) || '#ffffff', tolerance: rb.tolerance == null ? 28 : numberAt(rb.tolerance, path + '/removeBg/tolerance', rep, 'tolerance') };
    }
    if (src.recipe != null) {
      if (typeof src.recipe === 'string') d.recipe = { id: src.recipe };
      else if (isObj(src.recipe) && typeof src.recipe.id === 'string') {
        if (isObj(src.recipe.add)) { l.adjust = l.adjust || {}; l.adjust.recipe = clone(src.recipe); }
        else d.recipe = { id: src.recipe.id, strength: src.recipe.strength };
      } else rep.err(path + '/recipe', 'recipe is a recipe id such as "golden-hour" or { "id", "strength" }.');
      if (d.recipe && (typeof d.recipe.id !== 'string' || !/^[\w.-]{1,80}$/.test(d.recipe.id))) { rep.err(path + '/recipe', 'That is not a recipe id.'); d.recipe = null; }
      if (d.recipe && d.recipe.strength != null && !isNum(d.recipe.strength)) { rep.err(path + '/recipe/strength', 'strength must be a number from 0 to 100.'); d.recipe = null; }
    }
    if (src.fx != null && !Array.isArray(src.fx)) {
      var fx = objAt(src.fx, path + '/fx', rep, 'fx');
      if (fx) { d.fx = clone(fx); d.fxImg = readSrc(fx.src, path + '/fx/src', rep, st, { page: page.index, layer: l.id }); }
    }
    if (src.source != null) { var so2 = objAt(src.source, path + '/source', rep, 'source'); if (so2) d.source = clone(so2); }
  }

  function readShape(src, path, l, rep) {
    if (src.shape != null) {
      if (typeof src.shape !== 'string' || !/^[\w-]{1,40}$/.test(src.shape)) rep.err(path + '/shape', 'shape is a shape id such as "rectangle", "ellipse" or "star".');
      else l.shape = src.shape === 'rect' ? 'rectangle' : src.shape;
    } else l.shape = 'rectangle';
    if (l.shape && LE.assets && typeof LE.assets.shapes === 'function') {
      try {
        var ok = LE.assets.shapes().some(function (s) { return s.id === l.shape; });
        if (!ok) rep.warn(path + '/shape', 'unknown-shape', 'Unknown shape "' + l.shape + '"; it is drawn as a rectangle.', l.id);
      } catch (e) { /* no catalogue */ }
    }
    if (src.params != null) { var p = objAt(src.params, path + '/params', rep, 'params'); if (p) l.params = clone(p); }
    var rv = numberAt(src.radius, path + '/radius', rep, 'radius');
    if (rv != null) l.radius = rv;
    l.fill = src.fill == null ? { type: 'none' } : fillAt(src.fill, path + '/fill', rep);
    if (src.stroke != null) {
      var s = typeof src.stroke === 'string' ? { color: src.stroke, width: 4 } : objAt(src.stroke, path + '/stroke', rep, 'stroke');
      if (s) {
        l.stroke = { width: numberAt(s.width, path + '/stroke/width', rep, 'width') || 0, color: colorAt(s.color, path + '/stroke/color', rep) || '#17131F' };
        if (s.dash != null) l.stroke.dash = Array.isArray(s.dash) ? s.dash.filter(isNum).slice(0, 8) : null;
        if (s.cap != null) l.stroke.cap = s.cap;
        if (s.join != null) l.stroke.join = s.join;
      }
    }
  }

  function readSvg(src, path, l, d, rep, type) {
    var aid = type === 'icon' ? (src.icon != null ? src.icon : src.assetId) : (src.assetId != null ? src.assetId : src.icon);
    var aidPath = path + (type === 'icon' ? (src.icon != null ? '/icon' : '/assetId') : (src.assetId != null ? '/assetId' : '/icon'));
    if (aid != null) {
      if (typeof aid !== 'string' || !/^[\w-]{1,24}:(?:[\w-]{1,40}\/)?[\w-]{1,80}$/.test(aid)) { rep.err(aidPath, 'Icon ids look like "lucide:sun", "phosphor:star" or "withicons:<style>/<icon>".'); aid = null; }
      else l.assetId = aid;
    }
    if (type === 'icon' && !aid) rep.err(path + '/icon', 'An icon layer needs "icon", for example "lucide:sun".');
    if (src.svg != null && type === 'svg') {
      if (typeof src.svg !== 'string') rep.err(path + '/svg', 'svg must be SVG markup text.');
      else if (src.svg.length > 200000) rep.err(path + '/svg', 'This SVG is larger than 200 KB.');
      else if (SVG_DANGER.test(src.svg)) rep.err(path + '/svg', 'SVG cannot contain script, event handlers, foreignObject or javascript: links.');
      else if (LE.project && LE.project.sanitizeSvg && !LE.project.sanitizeSvg(src.svg)) rep.err(path + '/svg', 'This SVG could not be read.');
      else l.svg = src.svg;
    }
    if (type === 'svg' && !aid && src.svg == null) rep.err(path, 'An svg layer needs "svg" markup or an "assetId".');
    if (src.color != null) l.color = colorAt(src.color, path + '/color', rep);
    var sw = numberAt(src.strokeWidth, path + '/strokeWidth', rep, 'strokeWidth');
    if (sw != null) l.strokeWidth = sw;
    if (aid && /^lucide:/.test(aid) && l.strokeWidth == null && type === 'icon') l.strokeWidth = 2;
    if (aid && /^(lucide|phosphor|ph):/.test(aid) && !l.color && type === 'icon') l.color = '#17131F';
    if (src.iconStyle != null) { var is = objAt(src.iconStyle, path + '/iconStyle', rep, 'iconStyle'); if (is) d.iconStyle = clone(is); }
    if (src.qr != null) { var q = objAt(src.qr, path + '/qr', rep, 'qr'); if (q) d.qr = clone(q); }
    d.icon = !!aid;
    if (type === 'icon') { d.square = true; }
  }

  function readPath(src, path, l, rep) {
    if (!Array.isArray(src.points)) { rep.err(path + '/points', 'A path layer needs "points": [[x, y], …].'); return; }
    if (src.points.length > 20000) rep.err(path + '/points', 'A path can have up to 20000 points.');
    l.points = src.points.slice(0, 20000).map(function (p, i) {
      if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) { rep.err(path + '/points/' + i, 'Each point is [x, y] or [x, y, pressure].'); return [0, 0, 0.5]; }
      return [p[0], p[1], isNum(p[2]) ? p[2] : 0.5];
    });
    ['smoothing', 'width'].forEach(function (k) { var v = numberAt(src[k], path + '/' + k, rep, k); if (v != null) l[k] = v; });
    if (src.color != null) l.color = colorAt(src.color, path + '/color', rep);
    if (src.mode != null) {
      if (['pen', 'marker', 'highlighter'].indexOf(src.mode) < 0) rep.err(path + '/mode', 'mode is "pen", "marker" or "highlighter".');
      else l.mode = src.mode;
    }
  }

  function readBackground(v, path, rep, st, page) {
    if (v == null) return { bg: { type: 'color', color: '#ffffff' } };
    if (typeof v === 'string') { var c = colorAt(v, path, rep); return { bg: { type: 'color', color: c || '#ffffff' } }; }
    if (!isObj(v)) { rep.err(path, 'background is a colour or an object.'); return { bg: { type: 'color', color: '#ffffff' } }; }
    var t = v.type || (v.src ? 'image' : Array.isArray(v.colors) ? 'gradient' : 'color');
    var out = { bg: null };
    if (t === 'pattern' || t === 'texture') {
      var spec = { kind: t, id: typeof v.id === 'string' ? v.id : '', fg: v.fg || '#17131f', bg: v.bg || '#ffffff', scale: isNum(v.scale) ? v.scale : 1 };
      out.bg = { type: 'color', color: safeColor(spec.bg) || '#ffffff', spec: spec };
      out.regen = true;
      return out;
    }
    if (['color', 'gradient', 'image'].indexOf(t) < 0) { rep.err(path + '/type', 'Background type is "color", "gradient", "image", "pattern" or "texture".'); return { bg: { type: 'color', color: '#ffffff' } }; }
    var bg = { type: t };
    if (v.color != null) bg.color = colorAt(v.color, path + '/color', rep);
    if (t === 'gradient') {
      if (v.kind != null) bg.kind = v.kind === 'radial' ? 'radial' : 'linear';
      if (!Array.isArray(v.colors) || v.colors.length < 2) rep.err(path + '/colors', 'A gradient needs at least two colours in "colors".');
      else bg.colors = v.colors.slice(0, 8).map(function (c, i) { return colorAt(c, path + '/colors/' + i, rep); }).filter(Boolean);
      if (v.angle != null) bg.angle = numberAt(v.angle, path + '/angle', rep, 'angle');
    }
    if (t === 'image') {
      out.img = readSrc(v.src, path + '/src', rep, st, { page: page.index, background: true });
      if (v.fit != null) {
        if (!BG_FIT_IN[v.fit]) rep.err(path + '/fit', 'Background fit is "fill", "fit", "stretch" or "tile".');
        else bg.fit = BG_FIT_IN[v.fit];
      }
      ['x', 'y', 'scale', 'rotation', 'opacity', 'blur'].forEach(function (k) { var n = numberAt(v[k], path + '/' + k, rep, k); if (n != null) bg[k] = n; });
      ['flipX', 'flipY'].forEach(function (k) { var b = boolAt(v[k], path + '/' + k, rep); if (b != null) bg[k] = b; });
      ['crop', 'dim', 'adjust', 'filter', 'tile'].forEach(function (k) { if (v[k] != null) { var o = objAt(v[k], path + '/' + k, rep, k); if (o) bg[k] = clone(o); } });
      if (v.source != null && isObj(v.source)) out.source = clone(v.source);
    }
    if (v.spec != null) {
      var sp = objAt(v.spec, path + '/spec', rep, 'spec');
      if (sp) {
        bg.spec = clone(sp);
        if (t !== 'image' && sp.kind !== 'gradient') out.regen = true;
        if (t === 'color' && sp.kind === 'gradient' && !(v.colors)) out.regen = true;
      }
    }
    out.bg = bg;
    return out;
  }

  function readVariables(v, rep) {
    if (v == null) return null;
    if (!Array.isArray(v)) { rep.err('/variables', 'variables is a list of { "key", "label", "type", "default" }.'); return null; }
    if (v.length > LIMITS.variables) rep.err('/variables', 'Up to ' + LIMITS.variables + ' variables.');
    var seen = {};
    return v.slice(0, LIMITS.variables).map(function (x, i) {
      var p = '/variables/' + i;
      if (!isObj(x)) { rep.err(p, 'Each variable is an object.'); return null; }
      if (typeof x.key !== 'string' || !/^[A-Za-z_][\w.-]{0,39}$/.test(x.key)) { rep.err(p + '/key', 'A variable key starts with a letter and uses letters, numbers, "_", "-" or ".", like "name".'); return null; }
      if (seen[x.key]) { rep.err(p + '/key', 'The variable "' + x.key + '" is listed twice.'); return null; }
      seen[x.key] = 1;
      var o = { key: x.key, label: plain(x.label == null ? x.key : x.label, 80), type: x.type == null ? 'text' : x.type };
      if (o.type !== 'text' && o.type !== 'image') { rep.err(p + '/type', 'type is "text" or "image".'); return null; }
      if (x.default != null) {
        if (typeof x.default !== 'string') rep.err(p + '/default', 'default must be text.');
        else o.default = x.default.slice(0, 2000);
      }
      return o;
    }).filter(Boolean);
  }

  /* ---------- Async stages ---------- */
  function resolveImages(items, opts, rep, st, out) {
    var cache = {};
    function bytesOf(it) {
      if (it.kind === 'data') {
        var bytes;
        try { bytes = b64ToBytes(it.b64); } catch (e) { rep.err(it.path, 'This data: URI is not valid base64.'); return Promise.resolve(null); }
        return Promise.resolve(new Blob([bytes], { type: it.type }));
      }
      if (it.kind === 'path') {
        if (typeof opts.resolve !== 'function') {
          rep.warn(it.path, 'missing-image', 'The image "' + plain(it.rel, 80) + '" is not inside this file. Open the folder or zip that holds it, or embed it as a data: URI.', it.ref.layer || null);
          return Promise.resolve(null);
        }
        return Promise.resolve().then(function () { return opts.resolve(it.rel); }).then(function (b) {
          if (!b) { rep.warn(it.path, 'missing-image', 'The image "' + plain(it.rel, 80) + '" was not found.', it.ref.layer || null); return null; }
          return b;
        }, function () { rep.warn(it.path, 'missing-image', 'The image "' + plain(it.rel, 80) + '" could not be read.', it.ref.layer || null); return null; });
      }
      return Promise.resolve(null);
    }
    return Promise.all(items.map(function (it) {
      if (it.kind === 'remote') {
        var r = out.remote.filter(function (x) { return x.url === it.url; })[0];
        if (!r) { r = { url: it.url, host: it.host, refs: [] }; out.remote.push(r); }
        r.refs.push({ page: it.ref.page, layer: it.ref.layer || null, background: !!it.ref.background, path: it.path });
        return null;
      }
      if (it.kind === 'id') { it.id = it.id; return null; }
      var key = it.kind === 'data' ? it.b64.slice(0, 64) + it.b64.length : it.rel;
      var p = cache[key] || (cache[key] = bytesOf(it).then(function (blob) { return blob ? ingestBlob(blob, it.rel || '', rep, it.path, out) : null; }));
      return p.then(function (meta) { if (meta) { it.id = meta.id; it.dims = meta; } });
    }));
  }
  function ingestBlob(blob, name, rep, path, out) {
    var cap = (LE.project && LE.project.LIMITS && LE.project.LIMITS.assetBytes) || 80 * 1024 * 1024;
    var type = String(blob.type || '').toLowerCase();
    if (!IMAGE_TYPES[type]) { rep.err(path, 'Images must be PNG, JPEG, WebP, GIF, AVIF or BMP.'); return Promise.resolve(null); }
    if (blob.size > cap) { rep.err(path, 'This image is larger than ' + Math.round(cap / 1048576) + ' MB.'); return Promise.resolve(null); }
    return Promise.all([LE.project.hash(blob), dims(blob)]).then(function (r) {
      var id = r[0];
      var base = String(name || '').split('/').pop() || ('image.' + IMAGE_TYPES[type]);
      out.assets[id] = blob;
      out.meta[id] = { id: id, type: type, name: base.slice(0, 160), width: r[1].width, height: r[1].height, bytes: blob.size, original: true };
      return out.meta[id];
    }, function () { rep.err(path, 'This image could not be decoded.'); return null; });
  }
  function coverCrop(iw, ih, W, H) {
    if (LE.collage && LE.collage.coverCrop) return LE.collage.coverCrop(iw, ih, W, H);
    var A = iw / ih, T = W / H, c = { x: 0, y: 0, w: 1, h: 1 };
    if (A > T) { c.w = T / A; c.x = (1 - c.w) / 2; } else { c.h = A / T; c.y = (1 - c.h) / 2; }
    return { x: r4(c.x), y: r4(c.y), w: r4(c.w), h: r4(c.h) };
  }

  function loadIcons(drafts, rep) {
    var sets = {};
    drafts.forEach(function (d) {
      if (!d.icon) return;
      var set = d.l.assetId.split(':')[0];
      if (set === 'withicons') sets['withicons/' + d.l.assetId.split(':')[1].split('/')[0]] = 1;
      else if (ICON_SETS[set]) sets[set === 'ph' ? 'phosphor' : set] = 1;
    });
    if (!LE.assets) return Promise.resolve();
    return Promise.all(Object.keys(sets).map(function (s) {
      var p = s.indexOf('withicons/') === 0
        ? (LE.assets.load('withicons').then(function () { return LE.assets.loadStyle(s.slice(10)); }))
        : LE.assets.load(s);
      return withTimeout(p, 15000).catch(function () { sets[s] = 0; });
    })).then(function () {
      drafts.forEach(function (d) {
        if (!d.icon) return;
        var set = d.l.assetId.split(':')[0];
        if (!ICON_SETS[set]) {
          if (!d.l.svg) rep.warn(d.path, 'unknown-icon', 'The icon set "' + set + '" is not one that ships with LocalEditor.', d.l.id);
          return;
        }
        try {
          var markup = LE.assets.svg(d.l.assetId, { color: d.l.color || undefined, strokeWidth: d.l.strokeWidth == null ? undefined : d.l.strokeWidth });
          if (markup) {
            d.l.svg = markup;
            d.markup = markup;
          }
        } catch (e) {
          rep.err(d.path + (d.l.type === 'svg' && d.srcType === 'icon' ? '/icon' : '/assetId'), 'Unknown icon "' + d.l.assetId + '". Search the icon catalogue for a valid id.');
        }
      });
    });
  }

  function applyRecipe(d, rep) {
    var R = LE.recipes;
    if (!R || typeof R.find !== 'function') { rep.warn(d.path + '/recipe', 'unknown-recipe', 'Recipes are not available here; the look was left out.', d.l.id); return; }
    var wf = R.find(d.recipe.id);
    if (!wf) { rep.err(d.path + '/recipe', 'Unknown recipe "' + d.recipe.id + '".'); return; }
    var strength = d.recipe.strength == null ? (wf.parameters && wf.parameters[0] && isNum(wf.parameters[0].default) ? wf.parameters[0].default : 75) : clamp(d.recipe.strength, 0, 100);
    var prep = R.prepare(wf, { intensity: strength, allowSkip: true });
    var L = R.look(prep.steps);
    var META = R.lookMeta || { set: {}, range: {} };
    var a = Object.assign({}, d.l.adjust || {});
    delete a.recipe;
    if (isNum(a.temperature)) { a.warmth = r4((a.warmth || 0) + a.temperature); delete a.temperature; }
    var m = { id: wf.metadata.id, name: wf.metadata.name, strength: strength, add: {}, prev: {}, filter: false, prevFilter: null };
    Object.keys(L.adjust).forEach(function (k) {
      var v = L.adjust[k];
      if (META.set[k]) { m.prev[k] = isNum(a[k]) ? a[k] : null; a[k] = v; return; }
      var range = META.range[k] || [-1000, 1000];
      var before = isNum(a[k]) ? a[k] : 0;
      var next = r4(clamp(before + v, range[0], range[1]));
      m.add[k] = r4(next - before);
      a[k] = next;
    });
    if (L.filter) { m.filter = true; m.prevFilter = d.l.filter || null; d.l.filter = L.filter; }
    a.recipe = m;
    d.l.adjust = a;
  }

  function collageStage(page, rep) {
    var c = page.collageIn;
    if (!c) return Promise.resolve();
    if (!isObj(c)) { rep.err(page.path + '/collage', 'collage is an object such as { "layout": "r-2.3" }.'); return Promise.resolve(); }
    var G = LE.collage;
    var slots = page.drafts.filter(function (d) { return d.l.type === 'image' && d.l.slot; });
    if (c.template && !slots.length) {
      if (!G || typeof G.loadStyle !== 'function') { rep.err(page.path + '/collage/template', 'Collage styles are not available here.'); return Promise.resolve(); }
      return withTimeout(G.loadStyle(String(c.template)), 15000).then(function (tpl) {
        if (!tpl || !tpl.slots) throw new Error('none');
        var W = page.width, H = page.height;
        if (!page.bgGiven && tpl.bg) {
          if (typeof tpl.bg === 'string') page.bg = { type: 'color', color: tpl.bg };
          else if (tpl.bg.colors && tpl.bg.colors.length) page.bg = { type: 'gradient', kind: tpl.bg.kind === 'radial' ? 'radial' : 'linear', colors: tpl.bg.colors, angle: tpl.bg.angle || 0, color: tpl.bg.color || tpl.bg.colors[0] };
          else if (tpl.bg.color) page.bg = { type: 'color', color: tpl.bg.color };
        }
        var order = [];
        var made = [];
        G.templateItems(tpl, W, H).forEach(function (item, i) {
          if (item.kind === 'slot') {
            var s = item.slot, box = item.box, k = item.k;
            var sid = String(s.id || ('p' + (item.i + 1))).replace(/[^\w.-]/g, '').slice(0, 40);
            var l = { id: 'slot-' + sid, type: 'image', name: s.label || ('Photo ' + (item.i + 1)), src: '', x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h),
              rotation: Number(s.rot || 0) || 0, radius: Math.max(0, Number(s.radius || 0) * k), mask: s.mask && s.mask !== 'none' ? String(s.mask).slice(0, 40) : 'none',
              slot: { id: sid, label: String(s.label || ('Photo ' + (item.i + 1))).slice(0, 80), photo: String(s.photo || '').slice(0, 80) } };
            if (s.border && Number(s.border.width) > 0) l.border = { width: Number(s.border.width) * k, color: s.border.color || '#FBF8F3' };
            if (s.shadow) l.shadow = { color: s.shadow.color || 'rgba(42,31,10,.28)', blur: (s.shadow.blur || 16) * k, x: (s.shadow.x || 0) * k, y: (s.shadow.y || 0) * k };
            if (s.maskPath) l.maskPath = s.maskPath;
            order.push(sid);
            made.push({ l: l, path: page.path + '/collage', placed: true });
          } else if (item.spec) {
            var spec = clone(item.spec);
            spec.id = 'decor-' + (i + 1);
            made.push({ l: spec, path: page.path + '/collage', placed: true, icon: spec.type === 'svg' && !!spec.assetId });
          }
        });
        page.drafts = made.concat(page.drafts);
        page.collage = { v: 1, template: String(c.template), order: order };
      }).catch(function () { rep.err(page.path + '/collage/template', 'Unknown collage style "' + plain(c.template, 60) + '".'); });
    }
    var meta = LE.Scene && LE.Scene.collageOf ? LE.Scene.collageOf(c) : clone(c);
    if (!meta) return Promise.resolve();
    var W = page.width, H = page.height;
    var needs = !meta.cells || slots.some(function (d) { return d.w == null || d.h == null || d.x == null || d.y == null; });
    if (meta.template && slots.length) { page.collage = meta; return Promise.resolve(); }
    if (!needs) { page.collage = meta; return Promise.resolve(); }
    if (!G || typeof G.layoutFor !== 'function') { rep.err(page.path + '/collage', 'Collage layouts are not available here.'); return Promise.resolve(); }
    var count = slots.length;
    if (!count) {
      var m1 = /^(r|c)-([\d.]+)$/.exec(meta.layout || '');
      count = m1 ? m1[2].split('.').reduce(function (p, v) { return p + (Number(v) || 0); }, 0) : clamp(Math.round(Number(c.count) || 0), 0, 20);
      if (!count && meta.cells) count = meta.cells.length;
      if (!count) { rep.err(page.path + '/collage', 'Add photo slot layers ("slot": true) or a layout like "r-2.3" that says how many cells.'); return Promise.resolve(); }
      count = Math.min(count, G.MAX_CELLS || 20);
      for (var i = 0; i < count; i++) {
        var sid = 'cell' + (i + 1);
        var dd = { l: { id: sid, type: 'image', name: 'Photo ' + (i + 1), src: '', slot: { id: sid, label: 'Photo ' + (i + 1), photo: '' } }, path: page.path + '/collage' };
        page.drafts.push(dd);
        slots.push(dd);
      }
    }
    var k = Math.min(W, H) / 1080;
    var D = G.DEFAULTS || { spacing: 16, margin: 24, radius: 0 };
    if (meta.spacing == null) meta.spacing = Math.round(D.spacing * k);
    if (meta.margin == null) meta.margin = Math.round(D.margin * k);
    if (!meta.cells || meta.cells.length !== slots.length) {
      var lay = G.layoutFor(meta.layout || '', slots.length, W / H);
      meta.layout = lay.id;
      meta.cells = lay.cells;
    }
    if (!meta.aspect && G.aspectFor) meta.aspect = G.aspectFor(W, H);
    meta.order = slots.map(function (d) { return d.l.slot.id; });
    var R = G.rects(meta, W, H);
    var bw = meta.border && meta.border.width > 0 ? meta.border.width : 0;
    slots.forEach(function (d, i) {
      var r = R[i];
      if (!r) return;
      d.l.x = r.x; d.l.y = r.y; d.l.w = r.w; d.l.h = r.h; d.l.rotation = 0;
      d.l.radius = Math.min(meta.radius || 0, Math.min(r.w, r.h) / 2);
      if (bw) d.l.border = { width: bw, color: meta.border.color || '#FFFFFF' };
      d.placed = true;
    });
    page.collage = meta;
    return Promise.resolve();
  }

  /* The main read: text or object → { ok, project, assets, remote, errors, warnings }. */
  function parse(input, opts) {
    opts = opts || {};
    var rep = new Report();
    function done(extra) {
      var out = { ok: !rep.errors.length, project: null, assets: {}, remote: [], errors: rep.errors, warnings: rep.warnings };
      if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
      if (rep.errors.length) { out.ok = false; out.project = null; out.assets = {}; }
      return out;
    }
    var raw = input;
    if (typeof raw === 'string') {
      if (raw.length > LIMITS.json) { rep.err('', 'This design file is larger than 12 MB. Use smaller images or relative image paths.'); return Promise.resolve(done()); }
      raw = raw.replace(/^﻿/, '');
      try { raw = JSON.parse(raw); } catch (e) { rep.err('', 'This is not valid JSON: ' + String(e.message || '').slice(0, 160)); return Promise.resolve(done()); }
    } else if (raw && typeof raw === 'object') {
      try { raw = JSON.parse(JSON.stringify(raw)); } catch (e2) { rep.err('', 'This design could not be read.'); return Promise.resolve(done()); }
    }
    if (!isObj(raw)) { rep.err('', 'A design file is one JSON object with "format": "localeditor-design".'); return Promise.resolve(done()); }
    scan(raw, '', rep, 0);
    if (rep.errors.length) return Promise.resolve(done());
    if (raw.format !== FORMAT) { rep.err('/format', raw.format == null ? 'Add "format": "localeditor-design".' : 'This is not a LocalEditor design ("format" must be "localeditor-design").'); return Promise.resolve(done()); }
    if (raw.version == null) rep.err('/version', 'Add "version": 1.');
    else if (Number(raw.version) > VERSION) { rep.err('/version', 'This design needs a newer LocalEditor (version ' + plain(raw.version, 8) + ').'); return Promise.resolve(done()); }
    else if (Number(raw.version) !== VERSION) rep.err('/version', '"version" must be 1.');
    var TOP = ['$schema', 'format', 'version', 'name', 'pages', 'variables', 'remix'];
    Object.keys(raw).forEach(function (k) { if (TOP.indexOf(k) < 0) rep.warn(ptr('', k), 'unknown-key', 'The key "' + plain(k, 40) + '" is not part of the format and was ignored.'); });
    if (raw.name != null && typeof raw.name !== 'string') rep.err('/name', 'name must be text.');
    if (!Array.isArray(raw.pages) || !raw.pages.length) { rep.err('/pages', 'A design needs "pages": [ { "width", "height", "layers": [ … ] } ].'); return Promise.resolve(done()); }
    if (raw.pages.length > LIMITS.pages) rep.err('/pages', 'A design can have up to ' + LIMITS.pages + ' pages.');
    var variables = readVariables(raw.variables, rep);
    var remix = null;
    if (raw.remix != null) {
      if (!isObj(raw.remix)) rep.err('/remix', 'remix is { "name", "by" }.');
      else {
        remix = { name: plain(raw.remix.name, 160), by: plain(raw.remix.by, 80) };
        if (!remix.name && !remix.by) remix = null;
      }
    }

    var st = { ids: {}, link: !!opts.link, dropped: [] };
    var pageIds = [];
    var pages = raw.pages.slice(0, LIMITS.pages).map(function (p, pi) {
      var path = '/pages/' + pi;
      if (!isObj(p)) { rep.err(path, 'A page must be an object.'); return null; }
      var PKEYS = ['id', 'name', 'width', 'height', 'background', 'collage', 'layers'];
      Object.keys(p).forEach(function (k) { if (PKEYS.indexOf(k) < 0) rep.warn(ptr(path, k), 'unknown-key', 'The key "' + plain(k, 40) + '" is not part of a page and was ignored.'); });
      var pid = '';
      if (p.id != null) {
        if (typeof p.id !== 'string' || !/^[\w:.-]{1,48}$/.test(p.id)) rep.err(path + '/id', 'Page ids use letters, numbers, "-", "_", "." or ":" (up to 48 characters).');
        else if (pageIds.indexOf(p.id) >= 0) rep.err(path + '/id', 'The page id "' + p.id + '" is used twice.');
        else pid = p.id;
      }
      pageIds.push(pid);
      var page = { index: pi, path: path, width: 1080, height: 1080, drafts: [], collageIn: p.collage, bgGiven: p.background != null };
      ['width', 'height'].forEach(function (k) {
        if (p[k] == null) return;
        if (!isNum(p[k]) || p[k] < 16 || p[k] > 20000) rep.err(path + '/' + k, k + ' must be a number of pixels from 16 to 20000.');
        else page[k] = Math.round(p[k]);
      });
      if (p.width == null && p.height == null && !(isObj(p.collage) && p.collage.template)) rep.warn(path, 'default-size', 'No width or height; the page is 1080 × 1080.');
      var bgr = readBackground(p.background, path + '/background', rep, st, page);
      page.bg = bgr.bg;
      page.bgImg = bgr.img || null;
      page.bgSource = bgr.source || null;
      page.regen = !!bgr.regen;
      if (p.layers != null && !Array.isArray(p.layers)) rep.err(path + '/layers', 'layers is a list, back to front.');
      var layers = Array.isArray(p.layers) ? p.layers : [];
      if (layers.length > LIMITS.layers) rep.err(path + '/layers', 'A page can have up to ' + LIMITS.layers + ' layers.');
      layers.slice(0, LIMITS.layers).forEach(function (l, li) {
        var d = readLayer(l, path + '/layers/' + li, page, rep, st);
        if (d) { d.srcType = l.type; page.drafts.push(d); }
      });
      return page;
    }).filter(Boolean);
    pages.forEach(function (page) {
      var groups = {};
      page.drafts.forEach(function (d) { if (d.l.type === 'group') groups[d.l.id] = 1; });
      page.drafts.forEach(function (d) {
        if (d.l.groupId && !groups[d.l.groupId]) rep.err(d.path + '/groupId', 'No group layer with the id "' + d.l.groupId + '" on this page.');
      });
    });
    if (rep.errors.length) return Promise.resolve(done());

    var out = { assets: {}, meta: {}, remote: [] };
    var imgs = [];
    pages.forEach(function (p) {
      if (p.bgImg) imgs.push(p.bgImg);
      p.drafts.forEach(function (d) { if (d.img) imgs.push(d.img); if (d.fxImg && d.fxImg.kind !== 'remote') imgs.push(d.fxImg); });
    });

    return expertStage(pages, imgs, rep, st).then(function (after) { return resolveImages(imgs, opts, rep, st, out).then(after); }).then(function () {
      return Promise.all(pages.map(function (p) { return collageStage(p, rep); }));
    }).then(function () {
      var all = [];
      pages.forEach(function (p) { all = all.concat(p.drafts); });
      return loadIcons(all, rep).then(function () { return all; });
    }).then(function (all) {
      var fonts = {};
      all.forEach(function (d) {
        if (d.text) fonts[[d.l.font || 'Plus Jakarta Sans', d.l.weight || 700, d.l.italic ? 1 : 0].join('|')] = 1;
      });
      return Promise.all(Object.keys(fonts).map(function (k) {
        var parts = k.split('|');
        return loadFont(parts[0], Number(parts[1]), parts[2] === '1');
      }));
    }).then(function () {
      if (rep.errors.length) return done();
      var studio = { fit: 'cover', focal: { x: 0.5, y: 0.5 }, scaleContent: true };
      var icons = {}, qr = {}, fx = {};
      var outPages = pages.map(function (page) {
        var W = page.width, H = page.height;
        var layers = page.drafts.map(function (d) {
          var l = d.l;
          if (l.type === 'image') {
            if (d.img && d.img.id) {
              l.src = d.img.id;
              var dm = out.meta[d.img.id];
              if (d.source && dm) dm.source = d.source;
              if (dm) {
                if (d.w == null && d.h == null && !d.placed) { d.w = W; d.h = r2(W * dm.height / dm.width); }
                else if (d.w == null && !d.placed) d.w = r2(d.h * dm.width / dm.height);
                else if (d.h == null && !d.placed) d.h = r2(d.w * dm.height / dm.width);
              }
            } else l.src = '';
            if (d.recipe) applyRecipe(d, rep);
            if (d.fx && d.fxImg && d.fxImg.id) { d.fx.src = d.fxImg.id; fx[l.id] = d.fx; }
          }
          if (!d.placed) {
            if (d.l.type === 'svg' && d.square) {
              if (d.w == null && d.h == null) { d.w = 120; d.h = 120; } else if (d.w == null) d.w = d.h; else if (d.h == null) d.h = d.w;
            }
            if (d.text) {
              if (d.w == null) d.w = r2(W * 0.8);
            } else if (d.w == null || d.h == null) {
              if (l.type === 'group' || l.type === 'path') { if (d.w == null) d.w = 100; if (d.h == null) d.h = 100; } else {
                rep.err(d.path + (d.w == null ? '/w' : '/h'), 'This ' + (d.srcType || l.type) + ' layer needs "' + (d.w == null ? 'w' : 'h') + '".');
                d.w = d.w == null ? 100 : d.w; d.h = d.h == null ? 100 : d.h;
              }
            }
            l.w = Math.max(1, d.w);
            if (d.text) {
              if (d.shrink) shrinkText(d, rep);
              if (d.h == null || d.h === 'auto') {
                var m = measureText(l);
                l.h = m ? Math.max(1, Math.ceil(m.height)) : Math.ceil((l.size || 48) * (l.lineHeight || 1.2) * String(l.text || '').split('\n').length);
              } else l.h = Math.max(1, d.h);
            } else l.h = Math.max(1, d.h);
            l.x = resolvePos(d.x, W, l.w);
            l.y = resolvePos(d.y, H, l.h);
          }
          if (l.type === 'image' && l.src && !l.crop && out.meta[l.src]) {
            var mm = out.meta[l.src];
            if (d.fit === 'contain') {
              var s = Math.min(l.w / mm.width, l.h / mm.height);
              var nw = r2(mm.width * s), nh = r2(mm.height * s);
              l.x = r2(l.x + (l.w - nw) / 2); l.y = r2(l.y + (l.h - nh) / 2); l.w = nw; l.h = nh;
              l.crop = { x: 0, y: 0, w: 1, h: 1 };
            } else if (d.fit === 'stretch') l.crop = { x: 0, y: 0, w: 1, h: 1 };
            else l.crop = coverCrop(mm.width, mm.height, l.w, l.h);
          }
          if (d.iconStyle) icons[l.id] = d.iconStyle;
          if (d.qr) qr[l.id] = d.qr;
          return l;
        });
        var bg = page.bg;
        if (page.bgImg) {
          if (page.bgImg.id) {
            bg.src = page.bgImg.id;
            if (page.bgSource && out.meta[bg.src]) out.meta[bg.src].source = page.bgSource;
          } else {
            var keep = bg.spec;
            bg = { type: 'color', color: bg.color || '#ffffff' };
            if (keep) { bg.spec = keep; page.regen = true; }
          }
        }
        var doc = { v: 1, width: W, height: H, background: bg, layers: layers };
        if (page.collage) doc.collage = page.collage;
        return doc;
      });
      pages.forEach(function (p) {
        p.drafts.forEach(function (d) {
          if (d.img && d.img.kind === 'id' && !out.meta[d.img.id]) {
            if (opts.assets && opts.assets[d.img.id]) out.meta[d.img.id] = clone(opts.assets[d.img.id]);
            else rep.warn(d.path + '/src', 'missing-image', 'The image ' + d.img.id.slice(0, 10) + '… is not in this file; it shows only if it is already on this device.', d.l.id);
          }
        });
      });
      if (Object.keys(icons).length) studio.icons = icons;
      if (Object.keys(qr).length) studio.qr = qr;
      if (Object.keys(fx).length) studio.fx = fx;
      if (variables && variables.length) studio.variables = variables;
      if (remix) studio.remix = remix;
      if (pageIds.some(Boolean)) studio.pageIds = pageIds.slice(0, outPages.length);
      studio.originalSize = { w: outPages[0].width, h: outPages[0].height };
      var assetMeta = {};
      Object.keys(out.meta).forEach(function (id) { assetMeta[id] = out.meta[id]; });
      var rawProject = {
        schema: LE.project.SCHEMA, v: LE.project.VERSION, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported design',
        kind: 'design', pages: outPages, activePage: 0, assets: assetMeta, meta: { app: '2.0', studio: studio }
      };
      if (rep.errors.length) return done();
      var check = LE.project.validate(rawProject);
      if (!check.ok) { (check.errors || []).forEach(function (e) { rep.err('', e); }); return done(); }
      (check.errors || []).forEach(function (e) { if (!/photo in this project is missing/.test(e)) rep.warn('', 'sanitised', e); });
      var project = check.project;
      /* The sanitiser keeps an unknown variable list out; check that ours survived. */
      if (st.dropped.length) st.dropped.forEach(function (p) { rep.warn(p, 'link-image', 'Photos are not carried in template links; this one became an empty slot.'); });
      lint(project, { report: rep, pageIds: pageIds });
      var regen = [];
      pages.forEach(function (p, i) { if (p.regen) regen.push(i); });
      var blobs = {};
      Object.keys(project.assets).forEach(function (id) { if (out.assets[id]) blobs[id] = out.assets[id]; });
      var result = done({ project: project, assets: blobs, remote: out.remote, regenerate: regen });
      return result;
    }).catch(function (err) {
      rep.err('', 'This design could not be read (' + String((err && err.message) || err).slice(0, 120) + ').');
      return done();
    });
  }

  function shrinkText(d, rep) {
    var l = d.l;
    var boxH = d.h == null || d.h === 'auto' ? null : d.h;
    if (boxH == null) { rep.warn(d.path + '/fit', 'shrink-needs-height', '"fit": "shrink" needs a fixed "h"; the size was kept.', l.id); return; }
    if (!measureCtx()) return;
    var hi = l.size || 400, lo = 4;
    function fits(s) { var m = measureText(l, s); return m && m.height <= boxH + 0.5 && !m.broke; }
    if (fits(hi)) return;
    if (!fits(lo)) { l.size = lo; rep.warn(d.path, 'overflow', 'Even at 4 px this text does not fit its box.', l.id); return; }
    for (var i = 0; i < 20 && hi - lo > 0.25; i++) { var mid = (hi + lo) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    var orig = l.size || hi;
    l.size = Math.floor(lo * 4) / 4;
    if (l.letterSpacing) l.letterSpacing = r2(l.letterSpacing * l.size / orig);
  }

  /* =====================================================================
     LINT — honest and small; pure apart from the text measurement canvas.
     ===================================================================== */
  function lint(project, opts) {
    opts = opts || {};
    var rep = opts.report || new Report();
    var start = rep.warnings.length;
    if (!project || !Array.isArray(project.pages)) return [];
    var assets = project.assets || {};
    project.pages.forEach(function (page, pi) {
      var W = page.width, H = page.height;
      var base = '/pages/' + pi + '/layers/';
      var layers = page.layers || [];
      layers.forEach(function (l, li) {
        var path = base + li;
        if (l.visible === false || l.type === 'group') return;
        var label = l.name && l.name !== l.id ? '“' + String(l.name).slice(0, 40) + '”' : '“' + l.id + '”';
        var bb = aabb(l);
        if (bb.x >= W || bb.y >= H || bb.x + bb.w <= 0 || bb.y + bb.h <= 0) rep.warn(path, 'off-page', 'Layer ' + label + ' is completely outside the page.', l.id);
        else if (l.type === 'text' && (bb.x < -2 || bb.y < -2 || bb.x + bb.w > W + 2 || bb.y + bb.h > H + 2)) rep.warn(path, 'clipped', 'Text ' + label + ' runs past the edge of the page.', l.id);
        if (l.type === 'image' && l.src && !assets[l.src]) rep.warn(path, 'missing-image', 'The photo for ' + label + ' is missing.', l.id);
        if (l.type === 'text') {
          if (l.font && !knownFont(l.font)) rep.warn(path + '/font', 'unknown-font', 'The font "' + l.font + '" does not ship with LocalEditor; a fallback font is used. Pick one from the font list.', l.id);
          var m = opts.measure ? opts.measure(l) : measureText(l);
          if (m) {
            if (m.height > l.h * 1.04 + 2) rep.warn(path, 'overflow', 'Text ' + label + ' needs ' + Math.ceil(m.height) + ' px but its box is ' + Math.round(l.h) + ' px tall. Make the box taller, the text smaller, or use "fit": "shrink".', l.id);
            else if (m.broke) rep.warn(path, 'overflow', 'A word in ' + label + ' is wider than its box and breaks mid-word. Widen the box or use a smaller size.', l.id);
          }
          var fg = rgbOf(l.fill && l.fill.type === 'solid' ? l.fill.color : (l.fill && l.fill.type !== 'none' && l.fill.type ? null : l.color));
          var under = l.background && l.background.color ? rgbOf(l.background.color) : behind(page, li, bb);
          if (fg && under && fg.a > 0.6 && under.a > 0.95) {
            var ratio = contrast(fg, under);
            var need = (l.size || 48) >= 24 ? 3 : 4.5;
            if (ratio < need) rep.warn(path, 'low-contrast', 'Text ' + label + ' has low contrast against what is behind it (' + (Math.round(ratio * 10) / 10) + ':1; aim for ' + need + ':1).', l.id);
          }
        }
      });
    });
    return rep.warnings.slice(start);
  }
  function aabb(l) {
    var r = (l.rotation || 0) * Math.PI / 180;
    if (!r) return { x: l.x, y: l.y, w: l.w, h: l.h };
    var c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    var w = l.w * c + l.h * s, h = l.w * s + l.h * c;
    return { x: l.x + l.w / 2 - w / 2, y: l.y + l.h / 2 - h / 2, w: w, h: h };
  }
  /* The solid colour right behind a text box: the topmost layer below that fully covers it, else the page.
     Anything we cannot read cheaply (photos, gradients, icons) means "unknown". */
  function behind(page, index, box) {
    for (var i = index - 1; i >= 0; i--) {
      var l = page.layers[i];
      if (l.visible === false || l.type === 'group' || l.type === 'path' || (l.opacity != null && l.opacity < 1)) continue;
      var b = aabb(l);
      var overlaps = b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
      if (!overlaps) continue;
      var covers = !l.rotation && b.x <= box.x && b.y <= box.y && b.x + b.w >= box.x + box.w && b.y + b.h >= box.y + box.h;
      if (l.type === 'shape' && covers && l.fill && l.fill.type === 'solid' && /^(rectangle|rounded-rectangle|rect)$/.test(l.shape || '')) return rgbOf(l.fill.color);
      if (l.type === 'shape' && l.fill && l.fill.type === 'none') continue;
      return null;
    }
    var bg = page.background || {};
    if (bg.type === 'color' && !bg.spec) return rgbOf(bg.color || '#ffffff');
    return null;
  }

  /* =====================================================================
     WRITE
     ===================================================================== */
  function fullCrop(c) { return !c || ((c.x || 0) < 1e-4 && (c.y || 0) < 1e-4 && (c.w == null ? 1 : c.w) > 0.9999 && (c.h == null ? 1 : c.h) > 0.9999); }
  function knownSetId(aid) { return typeof aid === 'string' && !!ICON_SETS[aid.split(':')[0]]; }
  function geo(v) { return r2(Number(v) || 0); }
  function put(o, k, v) { if (v !== undefined) o[k] = v; }
  function cleanObj(o) {
    if (!isObj(o)) return o;
    var out = {};
    Object.keys(o).forEach(function (k) { if (o[k] !== undefined && o[k] !== null) out[k] = o[k]; });
    return out;
  }
  function fillOut(f) {
    if (!f) return undefined;
    var o = { type: f.type || 'solid' };
    if (f.color) o.color = f.color;
    if (f.colors && f.colors.length) o.colors = f.colors.slice();
    if (f.angle != null && f.angle !== 0) o.angle = r2(f.angle);
    return o;
  }
  function slotOut(s, layer) {
    var o = { id: s.id || '', label: s.label || '' };
    if (s.photo) o.photo = s.photo;
    return o;
  }
  function recipeOut(m) {
    var o = { id: m.id, name: m.name || '', strength: m.strength };
    o.add = {}; Object.keys(m.add || {}).sort().forEach(function (k) { o.add[k] = r4(m.add[k]); });
    o.prev = {}; Object.keys(m.prev || {}).sort().forEach(function (k) { o.prev[k] = m.prev[k] == null ? null : r4(m.prev[k]); });
    o.filter = !!m.filter;
    if (m.prevFilter) o.prevFilter = { name: m.prevFilter.name, intensity: m.prevFilter.intensity };
    return o;
  }

  /* ---------- Expert fields (docs/FX-AUTHORING.md; "Expert fields" in docs/FORMAT-DESIGN.md) ----------
     fx as a list, layerMask (a "mask" object means the same), transform, retouch, maps, raw and the adjustment layer type.
     They are read and checked by LE.fx.design, which loads only when a file carries them. */
  TYPES.push('adjust');
  COMMON.push('fx', 'layerMask', 'transform', 'retouch', 'maps', 'raw');
  BY_TYPE.adjust = ['clip'];
  BY_TYPE.image.push('fxBaked');
  function readExpert(src, l, d, page, type) {
    if (type === 'adjust') { l.clip = src.clip === true; if (d.w == null && d.h == null) { d.w = page.width; d.h = page.height; } }
    var raw = { fx: type === 'image' && !Array.isArray(src.fx) ? null : src.fx, fxBaked: src.fxBaked, layerMask: src.layerMask != null ? src.layerMask : isObj(src.mask) ? src.mask : null, transform: src.transform, retouch: src.retouch, maps: src.maps, raw: src.raw };
    if (Object.keys(raw).some(function (k) { return raw[k] != null; })) d.expert = { raw: raw, type: type, page: page.index };
  }
  /* Before the images resolve: asset references join them. Returns what to run once they have. */
  function expertStage(pages, imgs, rep, st) {
    var drafts = [];
    pages.forEach(function (p) { p.drafts.forEach(function (d) { if (d.expert) drafts.push(d); }); });
    if (!drafts.length) return Promise.resolve(null);
    return (LE.fxBoot ? LE.fxBoot.load() : Promise.reject()).then(function (fx) {
      return fx.design.read(drafts, { rep: rep, imgs: imgs, src: function (v, path, ref) { return readSrc(v, path, rep, st, ref); } });
    }, function () {
      rep.warn('', 'effects-unchecked', 'The effect renderer could not be loaded, so effects in this file were not checked; they are checked again before they are drawn.');
      drafts.forEach(function (d) { if (LE.Scene && LE.Scene.expertOf) LE.Scene.expertOf(d.expert.raw, d.l); });
      return null;
    });
  }
  function expertOut(l, o, ctx) {
    if (l.type === 'adjust' && l.clip) o.clip = true;
    var lost = false;
    /* Keys sorted; every "asset" inside is written the way an image src is. */
    function out(v) {
      if (Array.isArray(v)) return v.map(out).filter(function (x) { return x !== undefined; });
      if (!isObj(v)) return v;
      var r = {}, gone = false;
      Object.keys(v).sort().forEach(function (k) {
        if (k !== 'asset' || typeof v[k] !== 'string') r[k] = out(v[k]);
        else if (ctx.images === 'none') lost = gone = true;
        else r[k] = ctx.ref(v[k], l.id + '-asset') || v[k];
      });
      return gone ? undefined : r;
    }
    if (Array.isArray(l.fx) && l.fx.length) { if (isObj(o.fx)) o.fxBaked = o.fx; o.fx = out(l.fx); }
    ['layerMask', 'transform', 'retouch', 'maps', 'raw'].forEach(function (k) {
      var v = l[k] == null ? undefined : out(l[k]);
      if (v !== undefined && !(k === 'layerMask' && !v.parts.length)) o[k] = v;
    });
    if (lost) ctx.dropped.push({ kind: 'effect', layer: l.id, name: l.name });
  }

  function layerOut(l, ctx) {
    var o = {};
    o.id = l.id;
    if (l.name && l.name !== l.id) o.name = l.name;
    o.type = l.type;
    o.x = geo(l.x); o.y = geo(l.y); o.w = geo(l.w); o.h = geo(l.h);
    if (l.rotation) o.rotation = r2(l.rotation);
    if (l.opacity != null && l.opacity !== 1) o.opacity = r4(l.opacity);
    if (l.blend && l.blend !== 'source-over' && l.blend !== 'normal') o.blend = l.blend;
    if (l.visible === false) o.visible = false;
    if (l.locked) o.locked = true;
    if (l.flipX) o.flipX = true;
    if (l.flipY) o.flipY = true;
    if (l.groupId) o.groupId = l.groupId;
    if (l.shadow) o.shadow = { color: l.shadow.color, blur: r2(l.shadow.blur || 0), x: r2(l.shadow.x || 0), y: r2(l.shadow.y || 0) };
    var st = ctx.studio || {};
    if (l.type === 'text') {
      o.text = l.text == null ? '' : String(l.text);
      if (l.font && l.font !== 'Plus Jakarta Sans') o.font = l.font;
      if (l.weight != null && l.weight !== 700) o.weight = l.weight;
      if (l.italic) o.italic = true;
      if (l.size != null && l.size !== 48) o.size = r2(l.size);
      if (l.color && l.color !== '#17131F') o.color = l.color;
      if (l.fill) o.fill = fillOut(l.fill);
      if (l.align && l.align !== 'left') o.align = l.align;
      if (l.lineHeight != null && l.lineHeight !== 1.2) o.lineHeight = r4(l.lineHeight);
      if (l.letterSpacing) o.letterSpacing = r2(l.letterSpacing);
      if (l.uppercase) o.uppercase = true;
      if (l.underline) o.underline = true;
      if (l.strike) o.strike = true;
      if (l.stroke) o.stroke = { width: r2(l.stroke.width || 0), color: l.stroke.color };
      if (l.background) o.background = { color: l.background.color, radius: r2(l.background.radius == null ? 999 : l.background.radius), padding: r2(l.background.padding == null ? 8 : l.background.padding) };
      if (l.curve) o.curve = r2(l.curve);
    } else if (l.type === 'image') {
      var hasPhoto = l.src && ctx.images !== 'none';
      if (hasPhoto) {
        var ref = ctx.ref(l.src, l.id);
        if (ref) o.src = ref;
        var srcMeta = ctx.assets[l.src];
        if (srcMeta && srcMeta.source) o.source = cleanObj(srcMeta.source);
      } else if (l.src && ctx.images === 'none') ctx.dropped.push({ kind: 'photo', layer: l.id, name: l.name });
      if (hasPhoto || !fullCrop(l.crop)) o.crop = { x: r4(l.crop ? l.crop.x : 0), y: r4(l.crop ? l.crop.y : 0), w: r4(l.crop ? l.crop.w : 1), h: r4(l.crop ? l.crop.h : 1) };
      if (l.radius) o.radius = r2(l.radius);
      if (l.border) o.border = { width: r2(l.border.width || 0), color: l.border.color };
      if (l.mask && l.mask !== 'none') o.mask = l.mask;
      if (l.maskPath) o.maskPath = l.maskPath;
      var slot = l.slot;
      if (!slot && ctx.images === 'none' && l.src) slot = { id: String(l.id).replace(/[^\w.-]/g, '').slice(0, 40), label: l.name && l.name !== l.id ? String(l.name).slice(0, 80) : 'Photo', photo: '' };
      if (slot) o.slot = slotOut(slot, l);
      var adj = {};
      Object.keys(l.adjust || {}).sort().forEach(function (k) { if (k !== 'recipe' && isNum(l.adjust[k])) adj[k] = r4(l.adjust[k]); });
      if (Object.keys(adj).length) o.adjust = adj;
      if (l.adjust && isObj(l.adjust.recipe)) o.recipe = recipeOut(l.adjust.recipe);
      if (l.filter && l.filter.name) o.filter = { name: l.filter.name, intensity: l.filter.intensity == null ? 100 : r2(l.filter.intensity) };
      if (l.removeBg) o.removeBg = { color: l.removeBg.color, tolerance: l.removeBg.tolerance };
      if (st.fx && st.fx[l.id]) {
        if (ctx.images === 'none') ctx.dropped.push({ kind: 'effect', layer: l.id, name: l.name });
        else { var fx = clone(st.fx[l.id]); if (fx.src) fx.src = ctx.ref(fx.src, l.id + '-fx') || fx.src; o.fx = sortKeys(fx); }
      }
    } else if (l.type === 'shape') {
      o.shape = l.shape || 'rectangle';
      if (l.params && Object.keys(l.params).length) o.params = sortKeys(clone(l.params));
      if (l.radius) o.radius = r2(l.radius);
      if (l.fill && l.fill.type !== 'none') o.fill = fillOut(l.fill);
      if (l.stroke) {
        o.stroke = { width: r2(l.stroke.width || 0), color: l.stroke.color };
        if (l.stroke.dash && l.stroke.dash.length) o.stroke.dash = l.stroke.dash.slice();
        if (l.stroke.cap && l.stroke.cap !== 'butt') o.stroke.cap = l.stroke.cap;
        if (l.stroke.join && l.stroke.join !== 'miter') o.stroke.join = l.stroke.join;
      }
    } else if (l.type === 'svg') {
      if (l.assetId) o.assetId = l.assetId;
      if (!(l.assetId && knownSetId(l.assetId)) && l.svg) o.svg = l.svg;
      if (l.color) o.color = l.color;
      if (l.strokeWidth != null) o.strokeWidth = r2(l.strokeWidth);
      if (st.icons && st.icons[l.id]) o.iconStyle = sortKeys(cleanObj(clone(st.icons[l.id])));
      if (st.qr && st.qr[l.id]) o.qr = cleanObj(clone(st.qr[l.id]));
    } else if (l.type === 'path') {
      o.points = (l.points || []).map(function (p) { return [r2(p[0]), r2(p[1]), r4(p[2] == null ? 0.5 : p[2])]; });
      if (l.smoothing != null && l.smoothing !== 0.55) o.smoothing = r4(l.smoothing);
      if (l.width != null && l.width !== 4) o.width = r2(l.width);
      if (l.color && l.color !== '#17131F') o.color = l.color;
      if (l.mode && l.mode !== 'pen') o.mode = l.mode;
    }
    expertOut(l, o, ctx);
    return o;
  }
  function sortKeys(o) {
    if (!isObj(o)) return o;
    var out = {};
    Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  function backgroundOut(bg, ctx, pi) {
    bg = bg || { type: 'color', color: '#ffffff' };
    var o = { type: bg.type || 'color' };
    var photoGone = bg.type === 'image' && ctx.images === 'none';
    if (photoGone) {
      o.type = 'color';
      o.color = bg.color || '#ffffff';
      if (bg.spec) o.spec = sortKeys(clone(bg.spec));
      else ctx.dropped.push({ kind: 'background', page: pi });
      return o;
    }
    if (bg.color) o.color = bg.color;
    if (bg.type === 'gradient') {
      if (bg.kind && bg.kind !== 'linear') o.kind = bg.kind;
      if (bg.colors) o.colors = bg.colors.slice();
      if (bg.angle) o.angle = r2(bg.angle);
    }
    if (bg.type === 'image') {
      if (bg.src) { var ref = ctx.ref(bg.src, 'background-' + (pi + 1)); if (ref) o.src = ref; var am = ctx.assets[bg.src]; if (am && am.source) o.source = cleanObj(am.source); }
      if (bg.fit && bg.fit !== 'cover') o.fit = BG_FIT_OUT[bg.fit] || 'fill';
      if (bg.crop && !fullCrop(bg.crop)) o.crop = { x: r4(bg.crop.x), y: r4(bg.crop.y), w: r4(bg.crop.w), h: r4(bg.crop.h) };
      ['x', 'y'].forEach(function (k) { if (bg[k]) o[k] = r4(bg[k]); });
      if (bg.scale != null && bg.scale !== 1) o.scale = r4(bg.scale);
      if (bg.rotation) o.rotation = r2(bg.rotation);
      if (bg.flipX) o.flipX = true;
      if (bg.flipY) o.flipY = true;
      if (bg.opacity != null && bg.opacity !== 1) o.opacity = r4(bg.opacity);
      if (bg.blur) o.blur = r2(bg.blur);
      if (bg.dim && bg.dim.amount) o.dim = { color: bg.dim.color, amount: r4(bg.dim.amount) };
      if (bg.adjust && Object.keys(bg.adjust).length) o.adjust = sortKeys(clone(bg.adjust));
      if (bg.filter && bg.filter.name) o.filter = { name: bg.filter.name, intensity: bg.filter.intensity == null ? 100 : bg.filter.intensity };
      if (bg.tile && (bg.fit === 'tile' || bg.tile.size !== 0.25 || bg.tile.gap)) o.tile = { size: r4(bg.tile.size == null ? 0.25 : bg.tile.size), gap: r4(bg.tile.gap || 0) };
    }
    if (bg.spec) o.spec = sortKeys(clone(bg.spec));
    return o;
  }
  function collageOut(c) {
    var m = LE.Scene && LE.Scene.collageOf ? LE.Scene.collageOf(c) : clone(c);
    if (!m) return undefined;
    var o = {};
    ['layout', 'template', 'aspect', 'spacing', 'margin', 'radius', 'border', 'cells', 'order'].forEach(function (k) { if (m[k] != null) o[k] = m[k]; });
    return o;
  }

  /* Names images readably: assets/<name>.<ext>, de-duplicated. */
  function namer(assets) {
    var used = {}, byId = {};
    return function (id, hint) {
      if (byId[id]) return byId[id];
      var a = assets[id] || {};
      var ext = IMAGE_TYPES[a.type] || 'png';
      var base = slug(a.name, 40) || slug(hint, 40) || 'image';
      var name = base, n = 2;
      while (used[name]) name = base + '-' + (n++);
      used[name] = 1;
      byId[id] = 'assets/' + name + '.' + ext;
      return byId[id];
    };
  }

  function toDocument(project, opts) {
    opts = opts || {};
    var images = opts.images || 'paths';
    var st = (project.meta && project.meta.studio) || {};
    var nameFor = namer(project.assets || {});
    var listed = {};
    var assetList = [];
    var missing = [];
    var ctx = {
      images: images, studio: st, assets: project.assets || {}, dropped: [],
      ref: function (id, hint) {
        if (!id) return '';
        if (images === 'ids') return id;
        if (images === 'embed' && opts.dataUris && opts.dataUris[id]) { if (!listed[id]) { listed[id] = 1; assetList.push({ id: id, path: null, name: (ctx.assets[id] || {}).name || '', type: (ctx.assets[id] || {}).type || '', bytes: (ctx.assets[id] || {}).bytes || 0 }); } return opts.dataUris[id]; }
        var p = nameFor(id, hint);
        if (!listed[id]) {
          listed[id] = 1;
          var a = ctx.assets[id] || {};
          assetList.push({ id: id, path: p, name: a.name || '', type: a.type || '', bytes: a.bytes || 0 });
          if (images === 'embed') missing.push(id);
        }
        return p;
      }
    };
    var doc = { $schema: SCHEMA_URL, format: FORMAT, version: VERSION, name: String(project.name || 'Untitled design') };
    var remix = opts.remix !== undefined ? opts.remix : st.remix;
    if (remix && (remix.name || remix.by)) { doc.remix = {}; if (remix.name) doc.remix.name = remix.name; if (remix.by) doc.remix.by = remix.by; }
    if (Array.isArray(st.variables) && st.variables.length) doc.variables = st.variables.map(function (v) { var o = { key: v.key, label: v.label, type: v.type || 'text' }; if (v.default != null) o.default = v.default; return o; });
    var pageIds = Array.isArray(st.pageIds) ? st.pageIds : [];
    doc.pages = (project.pages || []).map(function (p, pi) {
      var o = {};
      if (pageIds[pi]) o.id = pageIds[pi];
      o.width = p.width; o.height = p.height;
      o.background = backgroundOut(p.background, ctx, pi);
      var c = p.collage ? collageOut(p.collage) : undefined;
      if (c) o.collage = c;
      o.layers = (p.layers || []).map(function (l) { return layerOut(l, ctx); });
      return o;
    });
    return { doc: doc, assets: assetList, dropped: ctx.dropped, missing: missing };
  }

  /* JSON with two-space indent; short primitive arrays and small flat objects stay on one line. */
  function pretty(v, indent) {
    indent = indent || '';
    var next = indent + '  ';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      var prim = v.every(function (x) { return x === null || typeof x !== 'object'; });
      if (prim) return '[' + v.map(function (x) { return JSON.stringify(x); }).join(', ') + ']';
      return '[\n' + v.map(function (x) { return next + pretty(x, next); }).join(',\n') + '\n' + indent + ']';
    }
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      if (!keys.length) return '{}';
      var flat = keys.every(function (k) { return v[k] === null || typeof v[k] !== 'object'; });
      if (flat) {
        var one = '{ ' + keys.map(function (k) { return JSON.stringify(k) + ': ' + JSON.stringify(v[k]); }).join(', ') + ' }';
        if (one.length <= 72 && one.indexOf('\\n') < 0 && !keys.some(function (k) { return typeof v[k] === 'string' && v[k].length > 40; })) return one;
      }
      return '{\n' + keys.map(function (k) { return next + JSON.stringify(k) + ': ' + pretty(v[k], next); }).join(',\n') + '\n' + indent + '}';
    }
    return JSON.stringify(v);
  }

  function stringify(project, opts) {
    opts = opts || {};
    var r = toDocument(project, opts);
    var text = opts.minify ? JSON.stringify(r.doc) : pretty(r.doc) + '\n';
    return { text: text, assets: r.assets, dropped: r.dropped, missing: r.missing };
  }

  /* Async helper: gathers the photos (from opts.blobs or this device) and returns the finished text. */
  function exportText(project, opts) {
    opts = Object.assign({}, opts || {});
    var images = opts.images || 'embed';
    opts.images = images;
    if (images !== 'embed') {
      var res = stringify(project, opts);
      res.bytes = new Blob([res.text]).size;
      if (images === 'paths') {
        return Promise.all(res.assets.map(function (a) {
          var b = opts.blobs && opts.blobs[a.id];
          return (b ? Promise.resolve(b) : LE.project.getAsset(a.id).catch(function () { return null; })).then(function (blob) { a.blob = blob || null; });
        })).then(function () { return res; });
      }
      return Promise.resolve(res);
    }
    var ids = LE.project.assetIds(project).filter(function (id) { return project.assets && project.assets[id]; });
    var fxIds = [];
    var st = (project.meta && project.meta.studio) || {};
    Object.keys(st.fx || {}).forEach(function (k) { if (st.fx[k] && st.fx[k].src) fxIds.push(st.fx[k].src); });
    ids = ids.concat(fxIds.filter(function (id) { return ids.indexOf(id) < 0; }));
    var uris = {};
    return Promise.all(ids.map(function (id) {
      var b = opts.blobs && opts.blobs[id];
      return (b ? Promise.resolve(b) : LE.project.getAsset(id).catch(function () { return null; })).then(function (blob) {
        if (!blob) return;
        if (!blob.type && project.assets[id]) blob = new Blob([blob], { type: project.assets[id].type });
        return blobToDataUri(blob).then(function (u) { uris[id] = u; });
      });
    })).then(function () {
      opts.dataUris = uris;
      var r = stringify(project, opts);
      r.bytes = new Blob([r.text]).size;
      return r;
    });
  }

  /* =====================================================================
     REMIX LINKS — the template rides in the URL fragment; nothing reaches a server.
     ===================================================================== */
  function studioBase() {
    try {
      var root = (document.documentElement && document.documentElement.getAttribute('data-root')) || './';
      return new URL(root, location.href).href + 'studio/';
    } catch (e) { return location.origin + '/studio/'; }
  }
  function toLink(project, opts) {
    opts = opts || {};
    var remix = (project.meta && project.meta.studio && project.meta.studio.remix) || null;
    var credit = { name: (remix && remix.name) || String(project.name || '').slice(0, 160) };
    var by = opts.by != null ? plain(opts.by, 80) : (remix && remix.by) || '';
    if (by) credit.by = by;
    var r = stringify(project, { images: 'none', minify: true, remix: credit });
    var bytes = new TextEncoder().encode(r.text);
    var make = canDeflate() && opts.compress !== false
      ? pump(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'z' + b64url(z); })
      : Promise.resolve('j' + b64url(bytes));
    return make.then(function (payload) {
      var url = (opts.base || studioBase()) + '#d=' + payload;
      var dropped = summarizeDropped(r.dropped);
      return { url: url, payload: payload, length: url.length, chars: payload.length, json: bytes.length, fits: payload.length <= LIMITS.linkChars, compressed: payload.charAt(0) === 'z', dropped: dropped, qr: url.length <= LIMITS.qrChars };
    });
  }
  function summarizeDropped(list) {
    var photos = list.filter(function (d) { return d.kind === 'photo'; }).length;
    var bgs = list.filter(function (d) { return d.kind === 'background'; }).length;
    var fx = list.filter(function (d) { return d.kind === 'effect'; }).length;
    var out = [];
    if (photos) out.push(photos + ' photo' + (photos > 1 ? 's' : '') + ' (kept as empty photo slots)');
    if (bgs) out.push(bgs + ' background photo' + (bgs > 1 ? 's' : ''));
    if (fx) out.push(fx + ' photo effect' + (fx > 1 ? 's' : ''));
    return out;
  }
  function linkPayload(text) {
    var s = String(text == null ? '' : text).trim();
    var m = /(?:^|[#&?])d=([A-Za-z0-9_-]+)/.exec(s);
    if (m) return m[1];
    return /^[zj][A-Za-z0-9_-]+$/.test(s) ? s : null;
  }
  function linkFail(msg) { return { ok: false, project: null, assets: {}, remote: [], errors: [{ path: '', message: msg }], warnings: [] }; }
  function fromLink(hash) {
    var payload = linkPayload(hash);
    if (!payload) return Promise.resolve(linkFail('That is not a LocalEditor template link.'));
    if (payload.length > LIMITS.linkChars) return Promise.resolve(linkFail('This template link is too large to open.'));
    var tag = payload.charAt(0);
    var bytes;
    try { bytes = unb64url(payload.slice(1)); } catch (e) { return Promise.resolve(linkFail('This template link is damaged. Ask for the link again, or for the design file.')); }
    var raw;
    if (tag === 'j') raw = bytes.length > LIMITS.linkBytes ? Promise.reject(new Error('too large')) : Promise.resolve(bytes);
    else if (tag === 'z') {
      if (!canDeflate()) return Promise.resolve(linkFail('This browser cannot open compressed template links. Ask for the .ledesign.json file instead.'));
      raw = pump(bytes, new DecompressionStream('deflate-raw'), LIMITS.linkBytes);
    } else return Promise.resolve(linkFail('This template link uses a newer format. Update LocalEditor and try again.'));
    return raw.then(function (out) {
      var text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(out); } catch (e) { return linkFail('This template link is damaged. Ask for the link again, or for the design file.'); }
      return parse(text, { link: true });
    }, function (err) {
      return linkFail(/too large/.test(err && err.message) ? 'This template link is too large to open.' : 'This template link is damaged. Ask for the link again, or for the design file.');
    });
  }

  /* Remote images: only after the person agreed, per host. Fills the parse result in place. */
  function fetchRemote(result, hosts, opts) {
    opts = opts || {};
    var allow = {};
    (hosts || []).forEach(function (h) { allow[h] = 1; });
    var rep = new Report();
    var out = { assets: result.assets, meta: {} };
    return Promise.all((result.remote || []).filter(function (r) { return allow[r.host]; }).map(function (r) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || 20000);
      return fetch(r.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (res) {
        clearTimeout(t);
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      }).then(function (blob) {
        var type = String(blob.type || '').split(';')[0].toLowerCase();
        if (type === 'image/jpg') type = 'image/jpeg';
        return ingestBlob(new Blob([blob], { type: type }), r.url.split('?')[0].split('/').pop() || 'image', rep, r.refs[0].path, out);
      }).then(function (meta) {
        if (!meta) throw new Error('decode');
        result.project.assets[meta.id] = meta;
        r.refs.forEach(function (ref) {
          var page = result.project.pages[ref.page];
          if (!page) return;
          if (ref.background) { page.background = Object.assign({}, page.background, { type: 'image', src: meta.id }); return; }
          page.layers.forEach(function (l) {
            if (l.id !== ref.layer || l.type !== 'image') return;
            l.src = meta.id;
            if (fullCrop(l.crop)) l.crop = coverCrop(meta.width, meta.height, l.w, l.h);
          });
        });
        r.done = true;
      }).catch(function () {
        clearTimeout(t);
        r.failed = true;
        result.warnings.push({ path: r.refs[0].path, kind: 'remote-failed', message: 'The image from ' + r.host + ' could not be downloaded.' });
      });
    })).then(function () { return result; });
  }

  /* =====================================================================
     STUDIO — File menu entries, import, save, share and the shared-template sheet.
     Everything takes the studio context (window.LEStudio) as `c`.
     ===================================================================== */
  function rootPath() {
    var root = (document.documentElement && document.documentElement.getAttribute('data-root')) || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root;
  }
  function ensureCss() {
    if (document.querySelector('link[href*="studio-design.css"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = rootPath() + 'assets/css/studio-design.css';
    document.head.appendChild(link);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function fmt(c, b) { return c && c.fmtBytes ? c.fmtBytes(b) : (b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 102.4) / 10 + ' KB' : Math.round(b / 104857.6) / 10 + ' MB'); }
  function support(id) {
    try { return LE.support && typeof LE.support.check === 'function' ? LE.support.check(id) : null; } catch (e) { return null; }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) res(); else rej(new Error('copy')); } catch (e) { rej(e); }
      ta.remove();
    });
  }
  var qrReady = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrReady) qrReady = LE.lazy(rootPath() + 'assets/vendor/qrcode.js').then(function () { if (!window.qrcode) throw new Error('QR maker unavailable'); return window.qrcode; });
    return qrReady;
  }
  function qrSvg(text) {
    var q = window.qrcode;
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    var qr = q(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount(), m = 4, size = n + m * 2, d = '';
    for (var r = 0; r < n; r++) {
      var run = -1;
      for (var col = 0; col <= n; col++) {
        var dark = col < n && qr.isDark(r, col);
        if (dark && run < 0) run = col;
        if (!dark && run >= 0) { d += 'M' + (run + m) + ' ' + (r + m) + 'h' + (col - run) + 'v1h-' + (col - run) + 'z'; run = -1; }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR code for the template link"><rect width="' + size + '" height="' + size + '" fill="#ffffff"/><path d="' + d + '" fill="#17131f"/></svg>';
  }
  function clearHash() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  /* A yes/no modal that resolves once, also when closed with ✕, Escape or a tap outside. */
  function ask(c, title, html, yes, no) {
    return new Promise(function (res) {
      var decided = false;
      var box = c.h('<div class="sxd-ask">' + html + '<div class="sxd-actions"><button type="button" class="btn" data-no>' + esc(no) + '</button><button type="button" class="btn btn-gold" data-yes>' + esc(yes) + '</button></div></div>');
      c.openModal(title, box);
      c.S.onModalClose = function () { if (!decided) { decided = true; res(false); } };
      box.querySelector('[data-yes]').onclick = function () { decided = true; res(true); c.closeModal(); };
      box.querySelector('[data-no]').onclick = function () { decided = true; res(false); c.closeModal(); };
    });
  }
  function showErrors(c, name, errors) {
    ensureCss();
    var list = (errors || []).slice(0, 8).map(function (e) {
      return '<li>' + (e.path ? '<code>' + esc(e.path) + '</code>' : '') + '<span>' + esc(e.message) + '</span></li>';
    }).join('');
    var more = errors.length > 8 ? '<p class="sx-note">…and ' + (errors.length - 8) + ' more.</p>' : '';
    var box = c.h('<div class="sxd-ask"><p class="sxd-lead">' + (name ? '“' + esc(name) + '” ' : 'This design ') + 'could not be opened. Your open design was not changed.</p>' +
      '<ul class="sxd-errs">' + list + '</ul>' + more +
      '<p class="sx-note">The path shows where the problem is, for example <code>/pages/0/layers/2/x</code> is the x of the third layer on the first page.</p>' +
      '<div class="sxd-actions"><button type="button" class="btn btn-gold" data-ok>OK</button></div></div>');
    c.openModal('Design file problem', box);
    box.querySelector('[data-ok]').onclick = function () { c.closeModal(); };
  }
  function askRemote(c, res) {
    var hosts = [];
    (res.remote || []).forEach(function (r) { if (hosts.indexOf(r.host) < 0) hosts.push(r.host); });
    var allowed = [];
    var chain = Promise.resolve();
    hosts.forEach(function (host) {
      chain = chain.then(function () {
        var n = res.remote.filter(function (r) { return r.host === host; }).length;
        return ask(c, 'Download images?', '<p class="sxd-lead">This design uses ' + n + ' image' + (n > 1 ? 's' : '') + ' from <b>' + esc(host) + '</b>.</p>' +
          '<p class="sx-note">LocalEditor downloads them only if you agree. That site will see your IP address, like any visit. If you skip, the images stay as empty photo slots.</p>',
          'Download from ' + host, 'Skip').then(function (yes) { if (yes) allowed.push(host); });
      });
    });
    return chain.then(function () { return allowed; });
  }
  function regenBackgrounds(c, res) {
    var list = res.regenerate || [];
    var C = window.LEStudioColor;
    if (!list.length || !C || typeof C.specToBg !== 'function') return Promise.resolve();
    var p = c.S.project;
    var chain = Promise.resolve();
    list.forEach(function (i) {
      chain = chain.then(function () {
        var page = p.pages[i];
        if (!page || !page.background || !page.background.spec) return null;
        return C.specToBg(c, page.background.spec, { width: page.width, height: page.height }).then(function (bg) { if (bg) page.background = bg; }).catch(function () {});
      });
    });
    return chain.then(function () { c.loadPage(p.activePage || 0); });
  }
  /* Opens a parsed design as a new design. The open one is saved first and stays in "Your designs". */
  function openResult(c, res, o) {
    o = o || {};
    if (c.S.dirty && c.S.project) c.saveNow();
    var ids = Object.keys(res.assets || {});
    return Promise.all(ids.map(function (id) {
      var m = res.project.assets[id] || {};
      return LE.project.putAsset({ blob: res.assets[id], name: m.name, type: m.type, width: m.width, height: m.height, source: m.source });
    })).then(function () {
      return c.startProject(res.project, { toast: o.toast });
    }).then(function () {
      return regenBackgrounds(c, res);
    }).then(function () {
      if (c.closePanel && c.S.panel === 'projects') c.closePanel();
      return c.saveNow({ created: true });
    }).then(function () { return res.project; });
  }
  function importText(c, text, o) {
    o = o || {};
    ensureCss();
    return parse(text, { resolve: o.resolve }).then(function (res) {
      if (!res.ok) { showErrors(c, o.name, res.errors); return null; }
      return askRemote(c, res).then(function (hosts) {
        return hosts.length ? fetchRemote(res, hosts) : res;
      }).then(function (r) {
        var notes = r.warnings.filter(function (w) { return w.kind !== 'unknown-key' && w.kind !== 'default-size'; });
        var msg = 'Opened “' + r.project.name + '”' + (notes.length ? ' · ' + notes.length + ' note' + (notes.length > 1 ? 's' : '') + ': ' + notes[0].message : '');
        return openResult(c, r, { toast: msg });
      });
    }).catch(function (err) {
      showErrors(c, o.name, [{ path: '', message: (err && err.message) || 'Something went wrong.' }]);
      return null;
    });
  }
  function studioImport(c, file) {
    if (!file) return Promise.resolve(null);
    if (file.size > LIMITS.json) { showErrors(c, file.name, [{ path: '', message: 'This file is larger than 12 MB.' }]); return Promise.resolve(null); }
    return file.text().then(function (text) {
      if (/"format"\s*:\s*"localeditor-workflow"/.test(text.slice(0, 4000)) && c.S.onRecipeFile) {
        c.openPanel('recipes');
        c.S.onRecipeFile(file);
        return null;
      }
      c.toast('Opening ' + (file.name || 'design') + '…', { ms: 1400 });
      return importText(c, text, { name: file.name });
    }, function () { showErrors(c, file.name, [{ path: '', message: 'This file could not be read.' }]); return null; });
  }
  var picker = null;
  function pickDesign(c) {
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.ledesign.json,.json,application/json';
      picker.hidden = true;
      picker.id = 'sx-file-design';
      document.body.appendChild(picker);
      picker.addEventListener('change', function () {
        var f = picker.files && picker.files[0];
        picker.value = '';
        if (f) studioImport(c, f);
      });
    }
    picker.click();
  }

  /* ---------- Save as design file ---------- */
  function saveDialog(c) {
    if (!c.S.project) return;
    ensureCss();
    c.syncProject();
    var p = c.S.project;
    var hasPhotos = LE.project.assetIds(p).length > 0;
    var box = c.h('<div class="sxd-save">' +
      '<p class="sxd-lead">One plain JSON file: every layer stays editable, and an AI agent can read and write it too.</p>' +
      '<div class="sxd-choices" role="radiogroup" aria-label="What to include">' +
      '<button type="button" class="sxd-choice" role="radio" aria-checked="true" data-mode="embed"><b>With photos</b><span>One self-contained file</span><em data-size="embed">Measuring…</em></button>' +
      '<button type="button" class="sxd-choice" role="radio" aria-checked="false" data-mode="none"><b>Template only</b><span>Photos become empty photo slots</span><em data-size="none">Measuring…</em></button>' +
      '</div><p class="sx-note is-warn" data-warn hidden></p>' +
      '<div class="sxd-actions"><button type="button" class="btn btn-gold" data-go disabled>' + c.ic('download') + '<span>Download .ledesign.json</span></button></div>' +
      '<p class="sx-note is-muted">Open it again from File → Open design file. Nothing is uploaded.</p></div>');
    if (!hasPhotos) box.querySelector('[data-mode="embed"] span').textContent = 'This design has no photos';
    c.openModal('Save as <em>design file</em>', box);
    var mode = 'embed';
    var texts = {};
    var go = box.querySelector('[data-go]');
    var warn = box.querySelector('[data-warn]');
    [].forEach.call(box.querySelectorAll('.sxd-choice'), function (b) {
      b.onclick = function () {
        mode = b.getAttribute('data-mode');
        [].forEach.call(box.querySelectorAll('.sxd-choice'), function (x) { x.setAttribute('aria-checked', String(x === b)); });
        go.disabled = !texts[mode];
      };
    });
    var none = stringify(p, { images: 'none' });
    texts.none = none.text;
    box.querySelector('[data-size="none"]').textContent = fmt(c, new Blob([none.text]).size);
    exportText(p, { images: 'embed' }).then(function (r) {
      texts.embed = r.text;
      box.querySelector('[data-size="embed"]').textContent = fmt(c, r.bytes);
      if (r.missing.length) { warn.hidden = false; warn.textContent = r.missing.length + ' photo' + (r.missing.length > 1 ? 's are' : ' is') + ' not on this device and will be saved as a file name only.'; }
      if (mode === 'embed') go.disabled = false;
    }).catch(function () { box.querySelector('[data-size="embed"]').textContent = 'Not available'; });
    go.onclick = function () {
      var text = texts[mode];
      if (!text) return;
      c.download(new Blob([text], { type: 'application/json' }), c.safeName(p.name) + '.ledesign.json');
      c.closeModal();
      c.toast('Saved ' + c.safeName(p.name) + '.ledesign.json');
    };
  }

  /* ---------- Share as template link ---------- */
  function openShare(c) {
    if (!c || !c.S || !c.S.project) return;
    ensureCss();
    c.syncProject();
    var p = c.S.project;
    var remix = (p.meta && p.meta.studio && p.meta.studio.remix) || null;
    var limited = support('design.remix-link');
    var box = c.h('<div class="sxd-share">' +
      '<p class="sxd-lead">Anyone with the link opens a copy of “' + esc(p.name) + '” and edits it. The template rides after the <b>#</b> in the link, so it never reaches a server.</p>' +
      '<p class="sxd-photo-note">' + c.ic('image') + '<span>Photos are not included. The person who opens it adds their own; layout, text, colours, shapes and icons come along.</span></p>' +
      '<label class="sx-field">Credit (optional)<input class="sx-input" data-by maxlength="80" placeholder="Your name or handle" autocomplete="off"></label>' +
      '<div class="sxd-meter" data-meter><div class="sxd-meter-bar"><i></i></div><div class="sxd-meter-row"><b data-fit>Making the link…</b><span data-len></span></div></div>' +
      '<p class="sx-note" data-dropped hidden></p>' +
      '<div class="sxd-linkrow"><input class="sx-input" readonly aria-label="Template link" value="Making the link…"><button type="button" class="btn btn-gold btn-sm" data-copy disabled>' + c.ic('copy') + '<span>Copy link</span></button></div>' +
      '<div class="sxd-qr" aria-live="polite"></div>' +
      '<div class="sxd-actions sxd-actions-split"><button type="button" class="btn btn-ghost btn-sm" data-share hidden>' + c.ic('share') + '<span>Share…</span></button>' +
      '<button type="button" class="btn btn-sm" data-file>' + c.ic('download') + '<span>Download design file</span></button></div>' +
      (limited && limited.status === 'limited' ? '<p class="sx-note is-muted">This browser cannot compress links, so they are longer.</p>' : '') +
      '</div>');
    c.openModal('Share as <em>template link</em>', box);
    var by = box.querySelector('[data-by]');
    if (remix && remix.by) by.value = remix.by;
    var input = box.querySelector('.sxd-linkrow input');
    var copy = box.querySelector('[data-copy]');
    var share = box.querySelector('[data-share]');
    var fileBtn = box.querySelector('[data-file]');
    var qr = box.querySelector('.sxd-qr');
    var current = null;
    fileBtn.onclick = function () { c.closeModal(); saveDialog(c); };
    var sh = support('design.share');
    var canShare = sh ? (sh.status === 'ok') : !!navigator.share;
    if (canShare && navigator.share) {
      share.hidden = false;
      share.onclick = function () { if (current && current.fits) navigator.share({ title: p.name, text: 'A LocalEditor template: ' + p.name, url: current.url }).catch(function () {}); };
    }
    copy.onclick = function () {
      if (!current) return;
      copyText(current.url).then(function () { copy.querySelector('span').textContent = 'Copied'; c.toast('Link copied'); }, function () { input.select(); c.toast('Press Ctrl+C to copy'); });
    };
    input.onfocus = function () { input.select(); };
    var token = 0;
    function make() {
      var my = ++token;
      return toLink(p, { by: by.value }).then(function (link) {
        if (my !== token) return;
        current = link;
        var pct = Math.min(100, Math.round(link.chars / LIMITS.linkChars * 100));
        box.querySelector('.sxd-meter-bar i').style.width = Math.max(3, pct) + '%';
        box.querySelector('[data-meter]').classList.toggle('is-over', !link.fits);
        box.querySelector('[data-fit]').textContent = link.fits ? 'Fits in a link' : 'Too large for a link — share it as a file instead';
        box.querySelector('[data-len]').textContent = link.length.toLocaleString() + ' characters';
        var dropped = box.querySelector('[data-dropped]');
        dropped.hidden = !link.dropped.length;
        dropped.textContent = link.dropped.length ? 'Left out: ' + link.dropped.join(', ') + '.' : '';
        copy.disabled = !link.fits;
        copy.classList.toggle('btn-gold', link.fits);
        fileBtn.classList.toggle('btn-gold', !link.fits);
        share.disabled = !link.fits;
        input.value = link.fits ? link.url : '';
        input.placeholder = link.fits ? '' : 'No link: this design is too large';
        qr.innerHTML = '';
        if (link.fits && link.qr) {
          loadQr().then(function () {
            if (my !== token) return;
            try { qr.innerHTML = qrSvg(link.url) + '<small>Scan to open on a phone</small>'; } catch (e) { qr.innerHTML = ''; }
          }).catch(function () {});
        } else if (link.fits) qr.innerHTML = '<small>This link is too long for a QR code. Copy it instead.</small>';
      }).catch(function (err) {
        box.querySelector('[data-fit]').textContent = 'Could not make a link: ' + ((err && err.message) || 'unknown error');
      });
    }
    var t = 0;
    by.addEventListener('input', function () { clearTimeout(t); t = setTimeout(make, 250); });
    return make();
  }

  /* ---------- Opening a template link: preview first, never replaces silently ---------- */
  function openSharedLink(c, hash) {
    ensureCss();
    return fromLink(hash).then(function (res) {
      clearHash();
      if (!res.ok) {
        var bad = c.h('<div class="sxd-ask"><p class="sxd-lead">This template link can’t be opened.</p><p class="sx-note">' + esc(res.errors[0].message) + '</p><p class="sx-note is-muted">Nothing was changed.</p><div class="sxd-actions"><button type="button" class="btn btn-gold" data-ok>OK</button></div></div>');
        c.openModal('Shared template', bad);
        bad.querySelector('[data-ok]').onclick = function () { c.closeModal(); };
        return null;
      }
      var p = res.project;
      var st = p.meta.studio || {};
      var slots = 0;
      p.pages.forEach(function (pg) { pg.layers.forEach(function (l) { if (l.type === 'image' && l.slot) slots++; }); });
      var first = p.pages[0];
      var credit = st.remix && st.remix.by ? '<p class="sxd-credit">Originally by ' + esc(st.remix.by) + '</p>' : '';
      var box = c.h('<div class="sxd-sheet">' +
        '<figure class="sxd-preview" style="aspect-ratio:' + first.width + ' / ' + first.height + '"><span class="sxd-preview-wait">Drawing preview…</span></figure>' +
        '<div class="sxd-sheet-text"><h3>' + esc(p.name) + '</h3>' +
        '<p class="sxd-meta">' + p.pages.length + ' page' + (p.pages.length > 1 ? 's' : '') + ' · ' + first.width + ' × ' + first.height + (slots ? ' · ' + slots + ' photo slot' + (slots > 1 ? 's' : '') : '') + '</p>' + credit +
        '<p class="sx-note">Opening it adds a new design to Your designs. ' + (c.S.project ? 'Your current design stays as it is.' : '') + (slots ? ' Add your own photos to the empty slots.' : '') + '</p></div>' +
        '<div class="sxd-actions"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn btn-gold" data-yes>Use this template</button></div></div>');
      c.openModal('Shared <em>template</em>', box);
      var scale = Math.min(1, 640 / Math.max(first.width, first.height));
      c.hiddenRender(first, scale).then(function (cv) {
        var fig = box.querySelector('.sxd-preview');
        if (!fig) return;
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', 'Preview of ' + p.name);
        fig.innerHTML = '';
        fig.appendChild(cv);
      }).catch(function () { var w = box.querySelector('.sxd-preview-wait'); if (w) w.textContent = 'No preview'; });
      box.querySelector('[data-no]').onclick = function () { c.closeModal(); };
      box.querySelector('[data-yes]').onclick = function () {
        c.closeModal();
        openResult(c, res, { toast: slots ? 'Template ready — tap a photo slot to add yours' : 'Template ready' });
      };
      return res;
    });
  }
  function hashLink(h) { return /(?:^#|[#&])d=[A-Za-z0-9_-]/.test(String(h || '')) ? String(h) : null; }
  function studioBoot(c) {
    var h = hashLink(location.hash) || hashLink(INITIAL_HASH);
    INITIAL_HASH = '';
    window.addEventListener('hashchange', function () { var x = hashLink(location.hash); if (x) openSharedLink(c, x); });
    if (h) return openSharedLink(c, h);
    return Promise.resolve(null);
  }
  function studioCmd(c, name) {
    if (name === 'openDesignFile') pickDesign(c);
    else if (name === 'saveDesignFile') saveDialog(c);
    else if (name === 'shareTemplate') openShare(c);
  }

  LE.design = {
    FORMAT: FORMAT, VERSION: VERSION, SCHEMA_URL: SCHEMA_URL, LIMITS: LIMITS,
    parse: parse, stringify: stringify, exportText: exportText, lint: lint, measureText: measureText,
    toLink: toLink, fromLink: fromLink, linkPayload: linkPayload, fetchRemote: fetchRemote,
    openShare: openShare, saveDialog: saveDialog, importText: importText, openSharedLink: openSharedLink,
    studioImport: studioImport, studioBoot: studioBoot, studioCmd: studioCmd, isDesignFile: function (f) { return !!f && (/\.json$/i.test(f.name || '') || f.type === 'application/json'); }
  };
})();
