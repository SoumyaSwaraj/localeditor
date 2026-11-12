/* LocalEditor layered scene. Document units stay independent of zoom. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};

  if (!LE.lazy) {
    var lazyLoads = {};
    LE.lazy = function (src) {
      src = String(src || '');
      if (lazyLoads[src]) return lazyLoads[src];
      lazyLoads[src] = new Promise(function (resolve, reject) {
        var nodes = document.getElementsByTagName('script');
        var found = null;
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute('data-le-src') === src || nodes[i].src === src) { found = nodes[i]; break; }
        }
        function fail() { reject(new Error('Could not load ' + src)); }
        if (found && found.getAttribute('data-le-loaded') === '1') { resolve(); return; }
        var script = found || document.createElement('script');
        script.async = true;
        script.setAttribute('data-le-src', src);
        script.addEventListener('load', function () {
          script.setAttribute('data-le-loaded', '1');
          resolve();
        });
        script.addEventListener('error', fail);
        if (!found) {
          script.src = src;
          document.head.appendChild(script);
        }
      });
      return lazyLoads[src];
    };
  }

  if (!LE.perf) {
    var PERF_KEY = 'le-perf';
    function readMode() {
      try {
        var m = global.localStorage && localStorage.getItem(PERF_KEY);
        if (m === 'quality' || m === 'saver' || m === 'auto') return m;
      } catch (e) { /* private mode */ }
      return 'auto';
    }
    function levelFrom(mode) {
      if (mode === 'quality') return 'high';
      if (mode === 'saver') return 'low';
      var tier = (LE.device && LE.device.tier) ? LE.device.tier() : 'desktop';
      if (tier === 'desktop') return 'high';
      if (tier === 'modern') return 'mid';
      return 'low';
    }
    LE.perf = {
      mode: readMode,
      set: function (mode) {
        if (mode !== 'quality' && mode !== 'saver' && mode !== 'auto') mode = 'auto';
        try { localStorage.setItem(PERF_KEY, mode); } catch (e2) { /* ignore */ }
      },
      level: function () { return levelFrom(readMode()); },
      previewMax: function () {
        var level = levelFrom(readMode());
        return level === 'high' ? 2400 : level === 'mid' ? 1600 : 1000;
      },
      pdfScale: function () {
        var level = levelFrom(readMode());
        return level === 'high' ? 2 : level === 'mid' ? 1.5 : 1;
      },
      fps: function () {
        var level = levelFrom(readMode());
        return level === 'high' ? 60 : level === 'mid' ? 45 : 30;
      }
    };
  }

  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hash32(s) {
    s = String(s || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function uid() {
    uid.n = (uid.n || 0) + 1;
    return 'l' + uid.n.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  function asIds(ids) {
    if (!ids) return [];
    if (typeof ids === 'string') return [ids];
    var out = [];
    for (var i = 0; i < ids.length; i++) if (ids[i]) out.push(ids[i]);
    return out;
  }
  function round3(n) { return Math.round(n * 1000) / 1000; }

  var BLENDS = {
    'source-over': 1, normal: 1, multiply: 1, screen: 1, overlay: 1, darken: 1, lighten: 1,
    'color-dodge': 1, 'color-burn': 1, 'hard-light': 1, 'soft-light': 1, difference: 1,
    exclusion: 1, hue: 1, saturation: 1, color: 1, luminosity: 1
  };
  function blendOf(name) {
    if (name === 'normal' || !name) return 'source-over';
    return BLENDS[name] ? name : 'source-over';
  }

  var SHAPE_ALIAS = {
    rectangle: 'rect', circle: 'ellipse', round: 'rounded-rect', rounded: 'rounded-rect',
    'rounded-rectangle': 'rounded-rect', 'round-rect': 'rounded-rect', rrect: 'rounded-rect'
  };

  function r2(n) { return Math.round(n * 100) / 100; }

  function roundedPath(w, h, r) {
    r = Math.max(0, Math.min(num(r, 0), w / 2, h / 2));
    if (r <= 0) return 'M0 0H' + r2(w) + 'V' + r2(h) + 'H0Z';
    return 'M' + r2(r) + ' 0H' + r2(w - r) +
      'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(w) + ' ' + r2(r) +
      'V' + r2(h - r) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(w - r) + ' ' + r2(h) +
      'H' + r2(r) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 0 ' + r2(h - r) +
      'V' + r2(r) + 'A' + r2(r) + ' ' + r2(r) + ' 0 0 1 ' + r2(r) + ' 0Z';
  }

  function starPath(w, h, points, inner) {
    points = Math.max(3, Math.round(num(points, 5)));
    inner = inner == null ? 0.4 : num(inner, 0.4);
    var cx = w / 2, cy = h / 2, ro = Math.min(w, h) / 2, ri = ro * inner;
    var d = '', n = points * 2, i, a, rad, x, y;
    for (i = 0; i < n; i++) {
      rad = i % 2 ? ri : ro;
      a = -Math.PI / 2 + i * Math.PI / points;
      x = cx + Math.cos(a) * rad;
      y = cy + Math.sin(a) * rad;
      d += (i ? 'L' : 'M') + r2(x) + ' ' + r2(y);
    }
    return d + 'Z';
  }

  var FALLBACK_SHAPES = [
    { id: 'rect', name: 'Rectangle', path: function (w, h) { return 'M0 0H' + r2(w) + 'V' + r2(h) + 'H0Z'; } },
    { id: 'rounded-rect', name: 'Rounded rectangle', editable: { radius: true }, path: function (w, h, p) {
      return roundedPath(w, h, p && p.radius != null ? p.radius : Math.min(w, h) * 0.16);
    } },
    { id: 'ellipse', name: 'Ellipse', path: function (w, h) {
      var rx = w / 2, ry = h / 2;
      return 'M' + r2(w) + ' ' + r2(ry) + 'A' + r2(rx) + ' ' + r2(ry) + ' 0 1 1 0 ' + r2(ry) +
        'A' + r2(rx) + ' ' + r2(ry) + ' 0 1 1 ' + r2(w) + ' ' + r2(ry) + 'Z';
    } },
    { id: 'triangle', name: 'Triangle', path: function (w, h) {
      return 'M' + r2(w / 2) + ' 0L' + r2(w) + ' ' + r2(h) + 'L0 ' + r2(h) + 'Z';
    } },
    { id: 'star', name: 'Star', editable: { points: true, innerRatio: true }, path: function (w, h, p) {
      return starPath(w, h, p && p.points, p && p.innerRatio);
    } },
    { id: 'line', name: 'Line', strokeOnly: true, path: function (w, h) {
      return 'M0 ' + r2(h / 2) + 'L' + r2(w) + ' ' + r2(h / 2);
    } },
    { id: 'arrow', name: 'Arrow', path: function (w, h) {
      var head = Math.min(w * 0.38, h * 0.95);
      var shaft = Math.max(1, h * 0.28);
      var y1 = h / 2 - shaft / 2, y2 = h / 2 + shaft / 2, xh = Math.max(0, w - head);
      return 'M0 ' + r2(y1) + 'H' + r2(xh) + 'V0L' + r2(w) + ' ' + r2(h / 2) + 'L' + r2(xh) + ' ' + r2(h) + 'V' + r2(y2) + 'H0Z';
    } }
  ];

  function shapeCatalog() {
    var extra = [];
    try {
      if (LE.assets && typeof LE.assets.shapes === 'function') {
        var list = LE.assets.shapes();
        if (list && list.length) extra = list;
      }
    } catch (e) { extra = []; }
    if (!extra.length) return FALLBACK_SHAPES;
    var seen = {};
    extra.forEach(function (s) { if (s && s.id) seen[s.id] = 1; });
    var out = extra.slice();
    FALLBACK_SHAPES.forEach(function (s) { if (!seen[s.id]) out.push(s); });
    return out;
  }

  function findShape(id) {
    id = SHAPE_ALIAS[id] || id || 'rect';
    var list = shapeCatalog();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    for (var j = 0; j < FALLBACK_SHAPES.length; j++) if (FALLBACK_SHAPES[j].id === id) return FALLBACK_SHAPES[j];
    return FALLBACK_SHAPES[0];
  }

  var SVG_DROP = { script: 1, foreignobject: 1, iframe: 1, object: 1, embed: 1, audio: 1, video: 1, link: 1, meta: 1, base: 1, set: 1, animate: 1, animatetransform: 1, animatemotion: 1, handler: 1 };

  function safePaint(value) {
    if (!value || typeof value !== 'string') return '';
    var c = value.trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
    if (/^(?:rgb|hsl)a?\(\s*[\d.%\s,\/]+\)$/i.test(c)) return c;
    if (/^[a-z]{3,24}$/i.test(c)) return c;
    return '';
  }

  function cleanSvgStyle(css) {
    return String(css || '')
      .replace(/<\/\s*/gi, '')
      .replace(/@import\b[^;]*;?/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, function (_, q, u) {
        u = String(u || '').trim();
        if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(u)) return 'url(' + (q || '"') + u + (q || '"') + ')';
        if (u.charAt(0) === '#') return 'url(#' + u.slice(1).replace(/[^A-Za-z0-9_.:-]/g, '') + ')';
        return 'none';
      });
  }

  function sanitizeSvg(svg) {
    svg = String(svg || '');
    if (!/<svg[\s>]/i.test(svg)) return '';
    var doc;
    try { doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); }
    catch (e) { return ''; }
    var root = doc.documentElement;
    if (!root || /parsererror/i.test(root.nodeName || root.localName || '')) return '';
    var all = [].slice.call(doc.getElementsByTagName('*'));
    for (var i = all.length - 1; i >= 0; i--) {
      var n = all[i];
      var name = String(n.localName || '').toLowerCase();
      if (name === 'style') {
        n.textContent = cleanSvgStyle(n.textContent || '');
        continue;
      }
      if (SVG_DROP[name]) {
        if (n.parentNode) n.parentNode.removeChild(n);
        continue;
      }
      var attrs = [].slice.call(n.attributes || []);
      for (var a = 0; a < attrs.length; a++) {
        var nm = String(attrs[a].name || '').toLowerCase();
        var val = attrs[a].value || '';
        if (nm.indexOf('on') === 0) { n.removeAttribute(attrs[a].name); continue; }
        if (nm === 'style') {
          var css = cleanSvgStyle(val);
          if (css) n.setAttribute('style', css);
          else n.removeAttribute(attrs[a].name);
          continue;
        }
        if (nm === 'href' || nm.slice(-4) === 'href') {
          var u = val.replace(/^\s+|\s+$/g, '');
          if (u.charAt(0) === '#') continue;
          if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(u)) continue;
          n.removeAttribute(attrs[a].name);
          continue;
        }
        if (/javascript\s*:/i.test(val)) n.removeAttribute(attrs[a].name);
      }
    }
    try { return new XMLSerializer().serializeToString(doc); }
    catch (e2) { return ''; }
  }

  function tintSvg(svg, color) {
    color = safePaint(color);
    if (!color) return svg;
    if (/currentColor/i.test(svg)) return svg.replace(/currentColor/gi, color);
    return svg.replace(/\sfill=(['"])(?!none\b|url\()[^'"]*\1/gi, ' fill="' + color + '"');
  }

  function prepSvg(markup, rw, rh) {
    markup = sanitizeSvg(markup);
    if (!markup) return '';
    if (!/\sxmlns=/.test(markup)) markup = markup.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    markup = markup.replace(/<svg\b([^>]*)>/i, function (_, attrs) {
      attrs = attrs.replace(/\swidth\s*=\s*(['"])[^'"]*\1/i, '').replace(/\sheight\s*=\s*(['"])[^'"]*\1/i, '');
      return '<svg' + attrs + ' width="' + rw + '" height="' + rh + '">';
    });
    return markup;
  }

  function fontFamily(name) {
    if (LE.fonts && typeof LE.fonts.css === 'function') {
      try { return LE.fonts.css(name) || 'sans-serif'; } catch (e) { /* fall through */ }
    }
    name = name || 'sans-serif';
    if (name.indexOf(',') >= 0 || name.charAt(0) === '"') return name;
    return '"' + String(name).replace(/"/g, '') + '", sans-serif';
  }

  function assignInto(target, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      var v = patch[k];
      if (typeof v === 'function') return;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
        assignInto(target[k], v);
      } else if (Array.isArray(v)) {
        target[k] = clone(v);
      } else {
        target[k] = v;
      }
    });
  }

  function shadowOf(src) {
    if (!src) return null;
    return {
      color: src.color || 'rgba(23,19,31,.35)',
      blur: num(src.blur, 16),
      x: num(src.x, 0),
      y: num(src.y, 8)
    };
  }

  function slotOf(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    var id = typeof s.id === 'string' ? s.id.replace(/[^\w.-]/g, '').slice(0, 40) : '';
    var label = typeof s.label === 'string' ? s.label.replace(/[<>]/g, '').slice(0, 80) : '';
    var photo = typeof s.photo === 'string' ? s.photo.replace(/[^\w.-]/g, '').slice(0, 80) : '';
    if (!id && !label && !photo) return null;
    return { id: id, label: label, photo: photo };
  }

  /* Subject cut-out (layer.cutout): an alpha-mask asset applied to the photo before crop and adjust. Non-destructive. */
  function cutoutOf(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.asset !== 'string') return null;
    var asset = c.asset.replace(/[^\w:.-]/g, '').slice(0, 80);
    if (!asset) return null;
    var o = c.outline && typeof c.outline === 'object' ? c.outline : null;
    return {
      asset: asset, enabled: c.enabled !== false,
      model: typeof c.model === 'string' ? c.model.replace(/[^\w.-]/g, '').slice(0, 40) : '',
      feather: clamp(num(c.feather, 0), 0, 50), refine: c.refine === 'none' ? 'none' : 'guided', version: 1,
      outline: o && num(o.width, 0) > 0 ? { color: safePaint(o.color) || '#ffffff', width: clamp(num(o.width, 0), 0, 200) } : null
    };
  }

  /* Collage meta (doc.collage): plain data the collage builder re-opens from. */
  function collageOf(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    var out = { v: 1 };
    function word(v, n) { return typeof v === 'string' ? v.replace(/[^\w.:-]/g, '').slice(0, n) : ''; }
    if (word(c.layout, 40)) out.layout = word(c.layout, 40);
    if (word(c.template, 60)) out.template = word(c.template, 60);
    if (word(c.aspect, 12)) out.aspect = word(c.aspect, 12);
    ['spacing', 'margin', 'radius'].forEach(function (k) {
      var v = Number(c[k]);
      if (c[k] != null && isFinite(v)) out[k] = Math.round(clamp(v, 0, 4000) * 100) / 100;
    });
    if (c.border && typeof c.border === 'object') {
      var bw = Number(c.border.width);
      var bc = typeof c.border.color === 'string' ? c.border.color.replace(/[^#\w(),.%\s-]/g, '').slice(0, 40) : '';
      out.border = { width: isFinite(bw) ? Math.round(clamp(bw, 0, 400) * 100) / 100 : 0, color: bc || '#FFFFFF' };
    }
    if (Array.isArray(c.cells)) {
      out.cells = c.cells.slice(0, 60).filter(function (r) {
        return Array.isArray(r) && r.length === 4 && r.every(function (v) { return typeof v === 'number' && isFinite(v); });
      }).map(function (r) { return r.map(function (v) { return Math.round(clamp(v, 0, 1) * 1e4) / 1e4; }); });
    }
    if (Array.isArray(c.order)) out.order = c.order.slice(0, 60).map(function (id) { return word(String(id == null ? '' : id), 40); });
    return out;
  }
  /* Carousel meta (doc.carousel): the page is N slides of slideWidth side by side. */
  function carouselOf(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    var n = Math.round(Number(c.slides)), w = Number(c.slideWidth);
    if (!(n >= 1) || !(w >= 1) || !isFinite(w)) return null;
    return { v: 1, slides: Math.min(n, 20), slideWidth: Math.round(clamp(w, 1, 20000) * 100) / 100 };
  }

  /* Quick-maker meta (doc.maker): the form values a page was made from, so it can be reopened and remade. */
  function makerOf(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    function word(v, n) { return typeof v === 'string' ? v.replace(/[^\w.:-]/g, '').slice(0, n) : ''; }
    function val(v, d) {
      if (typeof v === 'string') return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 2000);
      if (typeof v === 'number') return isFinite(v) ? v : null;
      if (typeof v === 'boolean') return v;
      if (Array.isArray(v) && d < 2) return v.slice(0, 40).map(function (x) { return val(x, d + 1); }).filter(function (x) { return x != null; });
      return null;
    }
    var out = { v: 1, id: word(m.id, 40), style: word(m.style, 40), size: word(m.size, 24), values: {} };
    if (!out.id) return null;
    var src = m.values && typeof m.values === 'object' && !Array.isArray(m.values) ? m.values : {};
    Object.keys(src).slice(0, 40).forEach(function (k) {
      if (!/^[a-zA-Z]\w{0,31}$/.test(k) || k === 'constructor' || k === 'prototype') return;
      var v = val(src[k], 0);
      if (v != null) out.values[k] = v;
    });
    if (word(m.sig, 16)) out.sig = word(m.sig, 16);
    return out;
  }
  /* Expert fields (docs/EXPERT-MODE.md, docs/FX-AUTHORING.md): fx stack, fxMask, transform.quad, retouch, maps, raw.
     Only the shape is checked here (types, sizes, forbidden keys); LE.fx checks every entry against its effect's schema before it runs. */
  var FX_BAD = { __proto__: 1, constructor: 1, prototype: 1 };
  function fxVal(v, d, inList) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.replace(/[^\w #:.,()%\/+-]/g, '').slice(0, 120);
    if (v == null || typeof v !== 'object' || d > 3) return null;
    if (Array.isArray(v)) return v.slice(0, inList ? 4 : 512).map(function (x) { return fxVal(x, d + 1, true); });
    var o = {};
    Object.keys(v).slice(0, 24).forEach(function (k) { if (!FX_BAD[k] && /^[a-zA-Z][\w-]{0,31}$/.test(k)) o[k] = fxVal(v[k], d + 1, inList); });
    return o;
  }
  function fxObj(v, d) { v = fxVal(v, d); return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? v : null; }
  function fxMaskOf(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.parts)) return null;
    var parts = m.parts.slice(0, 8).map(function (q) { q = fxObj(q, 2); return q && typeof q.kind === 'string' ? q : null; }).filter(Boolean);
    return parts.length ? { parts: parts } : null;
  }
  function fxStackOf(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    list.slice(0, 32).forEach(function (e) {
      if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.type !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(e.type)) return;
      out.push({
        id: typeof e.id === 'string' && /^[\w.-]{1,40}$/.test(e.id) ? e.id : uid(), type: e.type, on: e.on !== false, amount: clamp(num(e.amount, 1), 0, 1),
        blend: typeof e.blend === 'string' && /^[a-z-]{1,20}$/.test(e.blend) ? e.blend : 'normal', mask: fxMaskOf(e.mask), p: fxObj(e.p, 1) || {}
      });
    });
    return out.length ? out : null;
  }
  function expertOf(src, layer) {
    var fx = fxStackOf(src.fx), mask = fxMaskOf(src.fxMask || (src.mask && typeof src.mask === 'object' ? src.mask : null));
    var q = src.transform && src.transform.quad, rt = src.retouch, maps = fxObj(src.maps, 0), raw = fxObj(src.raw, 2);
    ['fx', 'fxMask', 'transform', 'retouch', 'maps', 'raw'].forEach(function (k) { delete layer[k]; });
    if (fx) layer.fx = fx;
    if (mask) layer.fxMask = mask;
    if (Array.isArray(q) && q.length === 4 && q.every(function (c) { return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && isFinite(c[0]) && isFinite(c[1]); })) {
      layer.transform = { quad: q.map(function (c) { return [clamp(c[0], -1e5, 1e5), clamp(c[1], -1e5, 1e5)]; }) };
    }
    if (rt && typeof rt.asset === 'string' && /^[\w:.-]{1,80}$/.test(rt.asset)) layer.retouch = { asset: rt.asset, version: Math.max(0, Math.round(num(rt.version, 1))) };
    if (maps) layer.maps = maps;
    if (raw) layer.raw = raw;
    return layer;
  }
  /* Asset ids the expert fields point at (masks, retouch overlay, maps, LUTs), so projects keep them. */
  function expertAssets(l) { return JSON.stringify([l.fx, l.fxMask, l.retouch, l.maps]).match(/[a-f0-9]{64}/g) || []; }

  /* Print meta (doc.print): the physical page this page is meant for, in mm, and the pixels per inch it was laid out at.
     PDF export uses it for the page size. */
  function printOf(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    var w = Number(p.w), h = Number(p.h), dpi = Number(p.dpi);
    if (!(w > 0) || !(h > 0) || !isFinite(w) || !isFinite(h)) return null;
    var paper = typeof p.paper === 'string' ? p.paper.replace(/[^\w.:-]/g, '').slice(0, 24) : '';
    return { v: 1, paper: paper, w: Math.round(clamp(w, 10, 2000) * 100) / 100, h: Math.round(clamp(h, 10, 2000) * 100) / 100, dpi: Math.round(clamp(isFinite(dpi) && dpi > 0 ? dpi : 300, 72, 1200)) };
  }
  /* Keeps a crop's centre and zoom when the photo moves into a frame of another shape. */
  function refitCrop(crop, iw, ih, W, H) {
    crop = crop || { x: 0, y: 0, w: 1, h: 1 };
    function cover(T) {
      var A = iw / ih;
      return A > T ? { w: T / A, h: 1 } : { w: 1, h: A / T };
    }
    if (!iw || !ih || !W || !H) return { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
    var was = cover((crop.w * iw) / (crop.h * ih));
    var zoom = Math.max(1, Math.min(was.w / crop.w, was.h / crop.h) || 1);
    var next = cover(W / H);
    var w = next.w / zoom, h = next.h / zoom;
    var cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w: w, h: h };
  }

  function sanitizeMaskPath(d) {
    if (typeof d !== 'string' || !d || d.length > 20000) return '';
    if (!/[MmLlCcQqAaZzHhVv]/.test(d)) return '';
    if (/[^MmLlCcQqAaZzHhVv0-9eE+.,\s-]/.test(d)) return '';
    return d;
  }

  function placeholderFill() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--surface-2');
      if (v && v.trim()) return v.trim();
    } catch (e) { /* canvas tests may have no theme */ }
    return '#F6F5F8';
  }

  function normalize(src, scene, keepName) {
    src = src || {};
    var type = src.type || 'shape';
    if (type !== 'image' && type !== 'text' && type !== 'shape' && type !== 'svg' && type !== 'path' && type !== 'group' && type !== 'adjust') type = 'shape';
    var names = { image: 'Image', text: 'Text', shape: 'Shape', svg: 'Graphic', path: 'Drawing', group: 'Group', adjust: 'Adjustment' };
    var layer = {
      id: src.id || uid(),
      type: type,
      name: (keepName && src.name) ? src.name : (src.name || ((names[type] || 'Layer') + ' ' + scene._nextName(type))),
      x: num(src.x, 48),
      y: num(src.y, 48),
      w: Math.max(1, num(src.w, type === 'text' ? 360 : type === 'path' ? 80 : 240)),
      h: Math.max(1, num(src.h, type === 'text' ? 96 : type === 'path' ? 80 : 180)),
      rotation: num(src.rotation, 0),
      opacity: clamp(src.opacity == null ? 1 : num(src.opacity, 1), 0, 1),
      blend: blendOf(src.blend),
      visible: src.visible !== false,
      locked: !!src.locked,
      flipX: !!src.flipX,
      flipY: !!src.flipY,
      shadow: shadowOf(src.shadow),
      groupId: src.groupId || null
    };
    if (type === 'image') {
      layer.src = src.src || '';
      var crop = src.crop || {};
      layer.crop = {
        x: clamp(num(crop.x, 0), 0, 1),
        y: clamp(num(crop.y, 0), 0, 1),
        w: clamp(num(crop.w, 1), 0.01, 1),
        h: clamp(num(crop.h, 1), 0.01, 1)
      };
      layer.radius = Math.max(0, num(src.radius, 0));
      layer.border = src.border ? { width: Math.max(0, num(src.border.width, 0)), color: src.border.color || '#17131F' } : null;
      layer.mask = typeof src.mask === 'string' && src.mask ? src.mask : 'none';
      layer.adjust = clone(src.adjust) || {};
      layer.filter = src.filter && src.filter.name ? { name: String(src.filter.name), intensity: num(src.filter.intensity, 100) } : null;
      layer.removeBg = src.removeBg ? { tolerance: num(src.removeBg.tolerance, 28), color: src.removeBg.color || '#ffffff' } : null;
      var maskPath = sanitizeMaskPath(src.maskPath);
      if (maskPath) layer.maskPath = maskPath;
      var slot = slotOf(src.slot);
      if (slot) layer.slot = slot;
      var cutout = cutoutOf(src.cutout);
      if (cutout) layer.cutout = cutout;
    } else if (type === 'text') {
      layer.text = src.text == null ? 'Text' : String(src.text);
      layer.font = src.font || 'Plus Jakarta Sans';
      layer.weight = num(src.weight, 700);
      layer.italic = !!src.italic;
      layer.size = Math.max(1, num(src.size, 48));
      layer.color = src.color || '#17131F';
      layer.fill = src.fill ? clone(src.fill) : null;
      layer.align = src.align === 'center' || src.align === 'right' ? src.align : 'left';
      layer.lineHeight = num(src.lineHeight, 1.2);
      layer.letterSpacing = num(src.letterSpacing, 0);
      layer.uppercase = !!src.uppercase;
      layer.underline = !!src.underline;
      layer.strike = !!src.strike;
      layer.stroke = src.stroke ? { width: Math.max(0, num(src.stroke.width, 0)), color: src.stroke.color || '#17131F' } : null;
      layer.background = src.background ? {
        color: src.background.color || 'rgba(255,255,255,.92)',
        radius: num(src.background.radius, 999),
        padding: num(src.background.padding, 8)
      } : null;
      layer.curve = clamp(num(src.curve, 0), -360, 360);
    } else if (type === 'shape') {
      layer.shape = src.shape || 'rect';
      layer.params = clone(src.params) || {};
      layer.radius = Math.max(0, num(src.radius, layer.params.radius || 0));
      layer.fill = src.fill ? clone(src.fill) : { type: 'solid', color: '#7457F0' };
      layer.stroke = src.stroke ? {
        width: Math.max(0, num(src.stroke.width, 0)),
        color: src.stroke.color || '#17131F',
        dash: src.stroke.dash ? src.stroke.dash.slice() : null,
        cap: src.stroke.cap || 'butt',
        join: src.stroke.join || 'miter'
      } : null;
      var redact = redactOf(src.redact);
      if (redact) layer.redact = redact;
    } else if (type === 'svg') {
      layer.assetId = src.assetId || '';
      layer.svg = src.svg || '';
      layer.color = src.color || null;
      layer.strokeWidth = src.strokeWidth == null ? null : num(src.strokeWidth, 2);
    } else if (type === 'path') {
      layer.points = (src.points || []).map(function (p) {
        return [num(p[0], 0), num(p[1], 0), p[2] == null ? 0.5 : num(p[2], 0.5)];
      });
      layer.smoothing = clamp(num(src.smoothing, 0.55), 0, 1);
      layer.width = Math.max(0.5, num(src.width, 4));
      layer.color = src.color || '#17131F';
      layer.mode = src.mode === 'marker' || src.mode === 'highlighter' ? src.mode : 'pen';
    } else if (type === 'adjust') {
      /* Adjustment layer: its fx stack applies to what is beneath it. Covers the page unless a box is given. */
      layer.clip = src.clip === true;
      if (src.w == null && src.h == null) { layer.x = 0; layer.y = 0; layer.w = scene._doc.width; layer.h = scene._doc.height; }
    }
    return expertOf(src, layer);
  }

  function blank(w, h) {
    return {
      v: 1,
      width: Math.max(1, num(w, 1080)),
      height: Math.max(1, num(h, 1080)),
      background: { type: 'color', color: '#ffffff' },
      layers: []
    };
  }

  function imageSteps(layer, skipBlur) {
    var steps = [];
    var crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    if ((crop.x || 0) > 0.0001 || (crop.y || 0) > 0.0001 || (crop.w == null ? 1 : crop.w) < 0.9999 || (crop.h == null ? 1 : crop.h) < 0.9999) {
      steps.push({ operation: 'crop', parameters: { x: crop.x || 0, y: crop.y || 0, w: crop.w == null ? 1 : crop.w, h: crop.h == null ? 1 : crop.h } });
    }
    var a = layer.adjust || {};
    var pack = {};
    function put(from, to) {
      if (a[from] == null || a[from] === 0) return;
      pack[to] = a[from];
    }
    put('brightness', 'brightness');
    put('contrast', 'contrast');
    put('saturation', 'saturation');
    put('tint', 'tint');
    put('exposure', 'exposure');
    put('highlights', 'highlights');
    put('shadows', 'shadows');
    put('vibrance', 'vibrance');
    put('vignette', 'vignette');
    put('grain', 'grain');
    put('hue', 'hue');
    if (a.temperature != null && a.temperature !== 0) pack.temperature = a.temperature;
    else if (a.warmth != null && a.warmth !== 0) pack.temperature = a.warmth;
    var sharp = num(a.sharpness, 0);
    if (Object.keys(pack).length) steps.push({ operation: 'adjust', parameters: pack });
    if (layer.filter && layer.filter.name) {
      steps.push({ operation: 'filter', parameters: { name: layer.filter.name, intensity: layer.filter.intensity == null ? 100 : layer.filter.intensity } });
    }
    if (sharp) steps.push({ operation: 'sharpen', parameters: { amount: sharp } });
    if (a.blur && !skipBlur) steps.push({ operation: 'blur', parameters: { radius: a.blur, type: 'gaussian' } });
    /* Fade, clarity, split tone and levels (recipe format 1.1), in the same place the file pipeline runs them. */
    if (LE.recipes && typeof LE.recipes.lookExtSteps === 'function') steps = steps.concat(LE.recipes.lookExtSteps(a) || []);
    if (layer.removeBg && (layer.removeBg.color || layer.removeBg.tolerance != null)) {
      steps.push({ operation: 'background', parameters: { color: layer.removeBg.color || '#ffffff', tolerance: layer.removeBg.tolerance == null ? 28 : layer.removeBg.tolerance } });
    }
    return steps;
  }

  function cloneCanvas(src) {
    if (LE.clone) return LE.clone(src);
    var c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function assetNode(rec) {
    if (!rec) return null;
    if (rec.canvas) return rec.canvas;
    if (rec.image && rec.image.complete && (rec.image.naturalWidth || rec.image.width)) return rec.image;
    return null;
  }

  function assetCanvas(rec) {
    if (!rec) return null;
    if (rec.canvas) return rec.canvas;
    var img = assetNode(rec);
    if (!img || img.getContext) return img;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    if (!rec._raster || rec._raster.width !== w || rec._raster.height !== h) {
      rec._raster = document.createElement('canvas');
      rec._raster.width = w;
      rec._raster.height = h;
      rec._raster.getContext('2d').drawImage(img, 0, 0);
    }
    return rec._raster;
  }

  function makeFill(ctx, fill, w, h) {
    if (!fill) return '#7457F0';
    if (typeof fill === 'string') return fill;
    if (fill.type === 'none') return null;
    var colors = fill.colors || (fill.color ? [fill.color] : ['#7457F0', '#E0668E']);
    if (!colors.length) colors = ['#7457F0'];
    if (fill.type === 'linear') {
      var ang = num(fill.angle, 0) * Math.PI / 180;
      var cx = w / 2, cy = h / 2;
      var len = Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang));
      var g = ctx.createLinearGradient(cx - Math.cos(ang) * len / 2, cy - Math.sin(ang) * len / 2, cx + Math.cos(ang) * len / 2, cy + Math.sin(ang) * len / 2);
      colors.forEach(function (c, i) { g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c); });
      return g;
    }
    if (fill.type === 'radial') {
      var rg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
      colors.forEach(function (c, i) { rg.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c); });
      return rg;
    }
    return fill.color || colors[0];
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

  function measureText(ctx, text, spacing) {
    if (!text) return 0;
    if (!spacing) return ctx.measureText(text).width;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text.charAt(i)).width + spacing;
    return Math.max(0, w - spacing);
  }

  function wrapText(ctx, text, maxW, spacing) {
    var paras = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var lines = [];
    function breakWord(word) {
      var buf = '';
      for (var i = 0; i < word.length; i++) {
        var next = buf + word.charAt(i);
        if (buf && measureText(ctx, next, spacing) > maxW) {
          lines.push(buf);
          buf = word.charAt(i);
        } else buf = next;
      }
      return buf;
    }
    paras.forEach(function (para) {
      if (!para) { lines.push(''); return; }
      var words = para.split(/(\s+)/);
      var line = '';
      words.forEach(function (word) {
        if (!word) return;
        if (!word.trim()) {
          if (line && measureText(ctx, line + word, spacing) <= maxW) line += word;
          return;
        }
        if (line && measureText(ctx, line + word, spacing) > maxW) {
          lines.push(line.replace(/\s+$/, ''));
          line = '';
        }
        if (!line && measureText(ctx, word, spacing) > maxW) line = breakWord(word);
        else line += word;
      });
      lines.push(line.replace(/\s+$/, ''));
    });
    return lines.length ? lines : [''];
  }

  function alignX(align, box, tw) {
    if (align === 'center') return (box - tw) / 2;
    if (align === 'right') return box - tw;
    return 0;
  }

  function paintLine(ctx, line, x, y, spacing, fill, stroke) {
    ctx.textAlign = 'left';
    function glyph(ch, gx) {
      if (stroke && stroke.width) {
        ctx.lineWidth = stroke.width;
        ctx.strokeStyle = stroke.color || '#17131F';
        ctx.lineJoin = 'round';
        ctx.strokeText(ch, gx, y);
      }
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillText(ch, gx, y);
      }
    }
    if (!spacing) { glyph(line, x); return; }
    var cx = x;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      glyph(ch, cx);
      cx += ctx.measureText(ch).width + spacing;
    }
  }

  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    function axis(k) {
      return 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    var pr = p1[2] == null ? 0.5 : p1[2];
    var pr2 = p2[2] == null ? pr : p2[2];
    return [axis(0), axis(1), pr + (pr2 - pr) * t];
  }

  function smoothSamples(points, amount) {
    if (points.length < 3 || amount <= 0.01) return points;
    var src = [points[0]].concat(points, [points[points.length - 1]]);
    var out = [];
    for (var i = 1; i < src.length - 2; i++) {
      var steps = 6;
      for (var s = 0; s < steps; s++) {
        var t = s / steps;
        var c = catmull(src[i - 1], src[i], src[i + 1], src[i + 2], t);
        var lx = src[i][0] + (src[i + 1][0] - src[i][0]) * t;
        var ly = src[i][1] + (src[i + 1][1] - src[i][1]) * t;
        out.push([lx + (c[0] - lx) * amount, ly + (c[1] - ly) * amount, c[2]]);
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function localToWorld(layer, lx, ly) {
    var x = lx - layer.w / 2;
    var y = ly - layer.h / 2;
    if (layer.flipX) x = -x;
    if (layer.flipY) y = -y;
    var r = (layer.rotation || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    return {
      x: layer.x + layer.w / 2 + x * c - y * s,
      y: layer.y + layer.h / 2 + x * s + y * c
    };
  }

  function worldToLocal(layer, wx, wy) {
    var dx = wx - (layer.x + layer.w / 2);
    var dy = wy - (layer.y + layer.h / 2);
    var r = -(layer.rotation || 0) * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    var x = dx * c - dy * s;
    var y = dx * s + dy * c;
    if (layer.flipX) x = -x;
    if (layer.flipY) y = -y;
    return { x: x + layer.w / 2, y: y + layer.h / 2 };
  }

  function layerAabb(layer) {
    var corners = [[0, 0], [layer.w, 0], [layer.w, layer.h], [0, layer.h]];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    corners.forEach(function (p) {
      var w = localToWorld(layer, p[0], p[1]);
      if (w.x < minX) minX = w.x;
      if (w.y < minY) minY = w.y;
      if (w.x > maxX) maxX = w.x;
      if (w.y > maxY) maxY = w.y;
    });
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function resizeLocal(start, handle, worldDx, worldDy, lock) {
    var rot = start.rotation || 0;
    var rad = -rot * Math.PI / 180;
    var c = Math.cos(rad), s = Math.sin(rad);
    var lx = worldDx * c - worldDy * s;
    var ly = worldDx * s + worldDy * c;
    if (start.flipX) lx = -lx;
    if (start.flipY) ly = -ly;
    var left = 0, right = start.w, top = 0, bottom = start.h;
    if (handle.indexOf('e') >= 0) right = start.w + lx;
    if (handle.indexOf('w') >= 0) left = lx;
    if (handle.indexOf('s') >= 0) bottom = start.h + ly;
    if (handle.indexOf('n') >= 0) top = ly;
    if (right < left + 8) {
      if (handle.indexOf('e') >= 0) right = left + 8;
      else left = right - 8;
    }
    if (bottom < top + 8) {
      if (handle.indexOf('s') >= 0) bottom = top + 8;
      else top = bottom - 8;
    }
    var corner = handle.length === 2;
    if (lock && corner) {
      var ratio = start.w / Math.max(1, start.h);
      var nw = right - left, nh = bottom - top;
      if (Math.abs(nw - start.w) >= Math.abs(nh * ratio - start.w)) {
        nh = nw / ratio;
        if (handle.indexOf('n') >= 0) top = bottom - nh;
        else bottom = top + nh;
      } else {
        nw = nh * ratio;
        if (handle.indexOf('w') >= 0) left = right - nw;
        else right = left + nw;
      }
    }
    var sw = Math.max(8, right - left);
    var sh = Math.max(8, bottom - top);
    var fixed = {
      se: [0, 0], nw: [start.w, start.h], ne: [0, start.h], sw: [start.w, 0],
      n: [start.w / 2, start.h], s: [start.w / 2, 0], e: [0, start.h / 2], w: [start.w, start.h / 2]
    }[handle];
    var next = {
      se: [0, 0], nw: [sw, sh], ne: [0, sh], sw: [sw, 0],
      n: [sw / 2, sh], s: [sw / 2, 0], e: [0, sh / 2], w: [sw, sh / 2]
    }[handle];
    var worldFixed = localToWorld(start, fixed[0], fixed[1]);
    var vx = next[0] - sw / 2;
    var vy = next[1] - sh / 2;
    if (start.flipX) vx = -vx;
    if (start.flipY) vy = -vy;
    var rr = rot * Math.PI / 180;
    var cc = Math.cos(rr), ss = Math.sin(rr);
    var cx = worldFixed.x - (vx * cc - vy * ss);
    var cy = worldFixed.y - (vx * ss + vy * cc);
    return { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
  }

  function Scene(opts) {
    if (!(this instanceof Scene)) return new Scene(opts);
    opts = opts || {};
    var el = opts.el;
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) throw new Error('LE.Scene needs a container element.');
    this.el = el;
    this._forced = opts.perf === 'high' || opts.perf === 'mid' || opts.perf === 'low' ? opts.perf : null;
    this._names = { image: 0, text: 0, shape: 0, svg: 0, path: 0, group: 0 };
    this._doc = blank(opts.width, opts.height);
    if (opts.background) this._doc.background = clone(opts.background);
    this._assets = {};
    this._sel = [];
    this._hover = null;
    this._tool = 'select';
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._dpr = 1;
    this._hist = { undo: [], redo: [], key: null, base: null, pushed: false };
    this._ev = {};
    this._imageCache = {};
    this._svgCache = {};
    this._textCache = {};
    this._jobs = {};
    this._fontAsked = {};
    this._fontEpoch = 0;
    this._clipboard = [];
    this._pasteN = 0;
    this._gesture = null;
    this._crop = null;
    this._editing = null;
    this._guides = [];
    this._space = false;
    this._dead = false;
    this._mark();
    this._lastSnap = '';
    this._lastDraw = 0;
    this._workspace = '#EEEBF3';
    this._pointers = {};
    this._build();
    this._bind();
    this._lastSnap = this._snapshot();
    var self = this;
    requestAnimationFrame(function () { if (!self._dead) self.fit(); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (self._dead) return;
        self._textCache = {};
        self._fontEpoch++;
        self._mark();
      });
    }
  }

  var P = Scene.prototype;

  P._level = function () {
    if (this._forced) return this._forced;
    return LE.perf.level();
  };
  P._fps = function () {
    if (!this._forced) return LE.perf.fps();
    return this._forced === 'high' ? 60 : this._forced === 'mid' ? 45 : 30;
  };
  P._previewMax = function () {
    if (!this._forced) return LE.perf.previewMax();
    return this._forced === 'high' ? 2400 : this._forced === 'mid' ? 1600 : 1000;
  };
  P._dprCap = function () {
    var level = this._level();
    return level === 'high' ? 2 : level === 'mid' ? 1.5 : 1;
  };
  P._histCap = function () {
    var level = this._level();
    return level === 'high' ? 100 : level === 'mid' ? 60 : 30;
  };
  P._nextName = function (type) {
    this._names[type] = (this._names[type] || 0) + 1;
    return this._names[type];
  };

  P._build = function () {
    var el = this.el;
    el.classList.add('le-scene');
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', 'Design canvas');
    el.innerHTML = '';
    var canvas = document.createElement('canvas');
    canvas.className = 'le-view';
    var overlay = document.createElement('div');
    overlay.className = 'le-overlay';
    var hover = document.createElement('div');
    hover.className = 'le-hover';
    var marquee = document.createElement('div');
    marquee.className = 'le-marquee';
    var guides = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    guides.setAttribute('class', 'le-guides');
    var sel = document.createElement('div');
    sel.className = 'le-sel';
    var crop = document.createElement('div');
    crop.className = 'le-crop';
    var editor = document.createElement('div');
    editor.className = 'le-textedit';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', 'Edit text');
    editor.setAttribute('hidden', '');
    try {
      editor.contentEditable = 'plaintext-only';
      if (editor.contentEditable !== 'plaintext-only') editor.contentEditable = 'true';
    } catch (e) { editor.contentEditable = 'true'; }
    function handles(parent, withRotate) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].concat(withRotate ? ['rotate'] : []).forEach(function (h) {
        var n = document.createElement('span');
        n.className = 'le-h';
        n.setAttribute('data-h', h);
        if (h === 'rotate') {
          n.setAttribute('aria-label', 'Rotate');
          var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('aria-hidden', 'true');
          var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p1.setAttribute('d', 'M19 12a7 7 0 1 1-2-4.9');
          p1.setAttribute('fill', 'none');
          p1.setAttribute('stroke', '#17131F');
          p1.setAttribute('stroke-width', '2');
          p1.setAttribute('stroke-linecap', 'round');
          var p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p2.setAttribute('d', 'M17 3v5h5');
          p2.setAttribute('fill', 'none');
          p2.setAttribute('stroke', '#17131F');
          p2.setAttribute('stroke-width', '2');
          p2.setAttribute('stroke-linecap', 'round');
          p2.setAttribute('stroke-linejoin', 'round');
          svg.appendChild(p1);
          svg.appendChild(p2);
          n.appendChild(svg);
        }
        parent.appendChild(n);
      });
    }
    handles(sel, true);
    handles(crop, false);
    overlay.appendChild(hover);
    overlay.appendChild(marquee);
    overlay.appendChild(guides);
    overlay.appendChild(sel);
    overlay.appendChild(crop);
    overlay.appendChild(editor);
    el.appendChild(canvas);
    el.appendChild(overlay);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._overlay = overlay;
    this._hoverEl = hover;
    this._marqueeEl = marquee;
    this._guidesEl = guides;
    this._selEl = sel;
    this._cropEl = crop;
    this._editor = editor;
    try {
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg');
      if (bg && bg.trim()) this._workspace = bg.trim();
    } catch (e2) { /* keep default */ }
  };

  P._bind = function () {
    var self = this;
    this._onKey = function (e) { self._key(e, false); };
    this._onKeyUp = function (e) { self._key(e, true); };
    this.el.addEventListener('pointerdown', function (e) { self._down(e); });
    this.el.addEventListener('pointermove', function (e) { self._move(e); });
    this.el.addEventListener('pointerup', function (e) { self._up(e); });
    this.el.addEventListener('pointercancel', function (e) { self._up(e); });
    this.el.addEventListener('pointerleave', function () { if (!self._gesture) self._setHover(null); });
    this.el.addEventListener('wheel', function (e) { self._wheel(e); }, { passive: false });
    this.el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    this.el.addEventListener('dblclick', function (e) { self._double(e); });
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKeyUp);
    this._editor.addEventListener('input', function () { self._onEditInput(); });
    this._editor.addEventListener('blur', function () { self._commitEdit(false); });
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self._mark(); self._layout(); });
      this._ro.observe(this.el);
    }
  };

  P._mark = function () {
    if (this._dead) return;
    this._dirty = true;
    if (this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function (t) { self._loop(t); });
  };
  P._loop = function (t) {
    this._raf = 0;
    if (this._dead || !this._dirty) return;
    var min = 1000 / this._fps();
    if (this._lastDraw && t - this._lastDraw < min - 0.5) {
      this._mark();
      return;
    }
    this._lastDraw = t;
    this._dirty = false;
    this._draw();
    if (this._dirty) this._mark();
  };

  P.on = function (event, fn) {
    var arr = this._ev[event] || (this._ev[event] = []);
    arr.push(fn);
    return function () {
      var i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  };
  P._emit = function (event, payload) {
    var arr = this._ev[event] || [];
    arr.slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { /* host listener */ }
    });
  };

  P._snapshot = function () {
    return JSON.stringify({
      v: 1,
      width: this._doc.width,
      height: this._doc.height,
      background: this._doc.background,
      layers: this._doc.layers,
      collage: this._doc.collage || undefined,
      carousel: this._doc.carousel || undefined,
      maker: this._doc.maker || undefined,
      print: this._doc.print || undefined
    });
  };
  P._histInfo = function () {
    return { canUndo: this._hist.undo.length > 0, canRedo: this._hist.redo.length > 0 };
  };
  P._before = function (key) {
    if (key && this._hist.key === key) return;
    this._hist.key = key || null;
    this._hist.pushed = false;
    this._hist.base = this._snapshot();
  };
  P._after = function () {
    var now = this._snapshot();
    if (this._hist.base != null && now !== this._hist.base && !this._hist.pushed) {
      this._hist.undo.push(this._hist.base);
      this._hist.redo = [];
      this._hist.pushed = true;
      var cap = this._histCap();
      while (this._hist.undo.length > cap) this._hist.undo.shift();
      this._emit('history', this._histInfo());
    }
    if (now !== this._lastSnap) {
      this._lastSnap = now;
      this._emit('change', { doc: this.toJSON() });
    }
    this._mark();
    this._layout();
  };
  P._endHist = function () { this._hist.key = null; };
  P._live = function (fn) {
    fn();
    var now = this._snapshot();
    if (now !== this._lastSnap) {
      this._lastSnap = now;
      this._emit('change', { doc: this.toJSON() });
    }
    this._mark();
    this._layout();
  };

  P._restore = function (json, silentHist) {
    var data = JSON.parse(json);
    this._doc.width = data.width;
    this._doc.height = data.height;
    this._doc.background = data.background || { type: 'color', color: '#ffffff' };
    this._doc.layers = data.layers || [];
    if (data.collage) this._doc.collage = collageOf(data.collage); else delete this._doc.collage;
    if (carouselOf(data.carousel)) this._doc.carousel = carouselOf(data.carousel); else delete this._doc.carousel;
    if (makerOf(data.maker)) this._doc.maker = makerOf(data.maker); else delete this._doc.maker;
    if (printOf(data.print)) this._doc.print = printOf(data.print); else delete this._doc.print;
    this._clearBitmaps();
    this._jobs = {};
    var self = this;
    var keep = [];
    this._sel.forEach(function (id) { if (self._find(id)) keep.push(id); });
    this._sel = keep;
    this._doc.layers.forEach(function (layer) { self._watch(layer); });
    if (this._editing && !this._find(this._editing)) this._closeEdit();
    if (this._editing && this._editor) {
      var editing = this._find(this._editing);
      if (editing) this._editor.textContent = editing.text || '';
    }
    this._lastSnap = this._snapshot();
    this._emit('change', { doc: this.toJSON() });
    if (!silentHist) this._emit('history', this._histInfo());
    this._emitSelect();
    this._mark();
    this._layout();
  };

  P.undo = function () {
    if (this._crop) { this._cancelCrop(); return; }
    if (this._editing) this._commitEdit(true);
    if (!this._hist.undo.length) return;
    this._hist.redo.push(this._snapshot());
    var prev = this._hist.undo.pop();
    this._endHist();
    this._hist.pushed = false;
    this._hist.base = null;
    this._restore(prev);
  };
  P.redo = function () {
    if (this._crop) this._applyCrop();
    if (this._editing) this._commitEdit(true);
    if (!this._hist.redo.length) return;
    this._hist.undo.push(this._snapshot());
    var next = this._hist.redo.pop();
    this._endHist();
    this._hist.pushed = false;
    this._hist.base = null;
    this._restore(next);
  };
  P.canUndo = function () { return this._hist.undo.length > 0; };
  P.canRedo = function () { return this._hist.redo.length > 0; };

  P.toJSON = function () {
    return JSON.parse(this._snapshot());
  };
  P.load = function (doc) {
    this._crop = null;
    this._closeEdit();
    this._gesture = null;
    doc = doc || blank(1080, 1080);
    var self = this;
    this._doc = {
      v: 1,
      width: Math.max(1, num(doc.width, 1080)),
      height: Math.max(1, num(doc.height, 1080)),
      background: clone(doc.background || { type: 'color', color: '#ffffff' }),
      layers: []
    };
    (doc.layers || []).forEach(function (layer) {
      self._doc.layers.push(normalize(layer, self, true));
    });
    if (collageOf(doc.collage)) this._doc.collage = collageOf(doc.collage);
    if (carouselOf(doc.carousel)) this._doc.carousel = carouselOf(doc.carousel);
    if (makerOf(doc.maker)) this._doc.maker = makerOf(doc.maker);
    if (printOf(doc.print)) this._doc.print = printOf(doc.print);
    this._sel = [];
    this._hist = { undo: [], redo: [], key: null, base: null, pushed: false };
    this._clearBitmaps();
    this._jobs = {};
    this._doc.layers.forEach(function (layer) { self._watch(layer); });
    this._lastSnap = this._snapshot();
    this._emit('change', { doc: this.toJSON() });
    this._emit('history', this._histInfo());
    this._emitSelect();
    this.fit();
  };

  P._find = function (id) {
    var layers = this._doc.layers;
    for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return layers[i];
    return null;
  };
  P._index = function (id) {
    var layers = this._doc.layers;
    for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return i;
    return -1;
  };
  P.layer = function (id) {
    var layer = this._find(id);
    return layer ? JSON.parse(JSON.stringify(layer)) : null;
  };
  P.layers = function () { return JSON.parse(JSON.stringify(this._doc.layers)); };

  P._direct = function (gid) {
    var out = [];
    this._doc.layers.forEach(function (l) { if (l.groupId === gid) out.push(l); });
    return out;
  };
  P._shiftTree = function (layer, dx, dy) {
    layer.x += dx;
    layer.y += dy;
    if (layer.type !== 'group') return;
    var self = this;
    this._direct(layer.id).forEach(function (m) { self._shiftTree(m, dx, dy); });
  };
  P._descendants = function (id, into) {
    var self = this;
    this._direct(id).forEach(function (m) {
      into.push(m);
      if (m.type === 'group') self._descendants(m.id, into);
    });
    return into;
  };
  P._roots = function (ids) {
    var set = {};
    ids.forEach(function (id) { set[id] = 1; });
    var self = this;
    return ids.filter(function (id) {
      var l = self._find(id);
      while (l && l.groupId) {
        if (set[l.groupId]) return false;
        l = self._find(l.groupId);
      }
      return true;
    });
  };
  P._topGroup = function (id) {
    var l = this._find(id);
    var guard = 0;
    while (l && l.groupId && guard++ < 16) {
      var g = this._find(l.groupId);
      if (!g) break;
      l = g;
    }
    return l ? l.id : id;
  };
  P._hidden = function (layer) {
    var guard = 0;
    var l = layer;
    while (l && guard++ < 16) {
      if (l.visible === false) return true;
      l = l.groupId ? this._find(l.groupId) : null;
    }
    return false;
  };
  P._locked = function (layer) {
    var guard = 0;
    var l = layer;
    while (l && guard++ < 16) {
      if (l.locked) return true;
      l = l.groupId ? this._find(l.groupId) : null;
    }
    return false;
  };
  P._opacity = function (layer) {
    var o = layer.opacity == null ? 1 : layer.opacity;
    var guard = 0;
    var l = layer.groupId ? this._find(layer.groupId) : null;
    while (l && guard++ < 16) {
      o *= l.opacity == null ? 1 : l.opacity;
      l = l.groupId ? this._find(l.groupId) : null;
    }
    return o;
  };

  P._watch = function (layer) {
    if (layer.type === 'image') this._scheduleImage(layer.id);
    if (layer.type === 'svg') this._scheduleSvg(layer.id);
    if (layer.type === 'text') this._ensureFont(layer);
  };
  P._ensureFont = function (layer) {
    if (!LE.fonts || typeof LE.fonts.load !== 'function') return;
    var key = [layer.font, layer.weight, layer.italic ? 1 : 0].join('|');
    if (this._fontAsked[key]) return;
    this._fontAsked[key] = 1;
    var self = this;
    LE.fonts.load(layer.font, layer.weight, !!layer.italic).then(function () {
      self._fontEpoch++;
      self._textCache = {};
      self._mark();
    }, function () {});
  };

  P._insert = function (src, index) {
    var layer = normalize(src, this, !!src.id);
    if (typeof index === 'number') this._doc.layers.splice(index, 0, layer);
    else this._doc.layers.push(layer);
    this._watch(layer);
    return layer;
  };

  P.add = function (layer) {
    this._before(null);
    var created = this._insert(layer || {});
    this._after();
    this.select([created.id]);
    return created.id;
  };

  P._patch = function (id, patch) {
    var layer = this._find(id);
    if (!layer || !patch) return null;
    var prevX = layer.x, prevY = layer.y, prevMask = layer.mask;
    assignInto(layer, patch);
    if (patch.fx !== undefined || patch.fxMask !== undefined || patch.transform !== undefined || patch.retouch !== undefined || patch.maps !== undefined || patch.raw !== undefined || (patch.mask && typeof patch.mask === 'object')) {
      var asMask = layer.mask && typeof layer.mask === 'object' ? layer.mask : null;
      if (asMask) { layer.fxMask = asMask; if (typeof prevMask === 'string') layer.mask = prevMask; else delete layer.mask; }
      expertOf(layer, layer);
      if (layer.type === 'image') this._scheduleImage(layer.id);
    }
    layer.opacity = clamp(num(layer.opacity, 1), 0, 1);
    layer.blend = blendOf(layer.blend);
    layer.w = Math.max(1, num(layer.w, 1));
    layer.h = Math.max(1, num(layer.h, 1));
    if (layer.type === 'group' && (patch.x != null || patch.y != null)) {
      var dx = layer.x - prevX, dy = layer.y - prevY;
      var self = this;
      this._direct(layer.id).forEach(function (m) { self._shiftTree(m, dx, dy); });
    }
    if (layer.type === 'image' && patch.maskPath != null) {
      var maskPath = sanitizeMaskPath(layer.maskPath);
      if (maskPath) layer.maskPath = maskPath;
      else delete layer.maskPath;
    }
    if (layer.type === 'image' && patch.slot != null) {
      var slot = slotOf(layer.slot);
      if (slot) layer.slot = slot;
      else delete layer.slot;
    }
    if (layer.type === 'image' && patch.cutout !== undefined) {
      var cut = cutoutOf(layer.cutout);
      if (cut) layer.cutout = cut;
      else delete layer.cutout;
    }
    if (layer.type === 'image' && (patch.src != null || patch.crop || patch.adjust || patch.filter || patch.removeBg || patch.cutout !== undefined)) {
      this._scheduleImage(layer.id);
    }
    if (layer.type === 'svg' && (patch.assetId != null || patch.svg != null || patch.color != null || patch.strokeWidth != null || patch.w != null || patch.h != null)) {
      this._scheduleSvg(layer.id);
    }
    if (layer.type === 'text' && (patch.font || patch.weight != null || patch.italic != null)) this._ensureFont(layer);
    if (layer.type === 'shape' && patch.redact !== undefined) { var redact = redactOf(layer.redact); if (redact) layer.redact = redact; else delete layer.redact; }
    if (layer.groupId) this._syncGroup(layer.groupId);
    return layer;
  };
  P.update = function (id, patch, opts) {
    var key = opts && opts.coalesce ? String(opts.coalesce) : null;
    this._before(key);
    this._patch(id, patch || {});
    this._after();
  };

  P._removeIds = function (ids, keepChildren) {
    var drop = {};
    var self = this;
    asIds(ids).forEach(function (id) {
      drop[id] = 1;
      if (!keepChildren) self._descendants(id, []).forEach(function (m) { drop[m.id] = 1; });
    });
    this._doc.layers = this._doc.layers.filter(function (l) { return !drop[l.id]; });
    this._sel = this._sel.filter(function (id) { return !drop[id]; });
    if (this._editing && drop[this._editing]) this._closeEdit();
  };
  P.remove = function (ids) {
    this._before(null);
    this._removeIds(ids);
    this._after();
    this._emitSelect();
  };

  P._spawn = function (list, offset) {
    var map = {};
    list.forEach(function (l) { map[l.id] = uid(); });
    var created = [];
    var self = this;
    list.forEach(function (src) {
      var copy = clone(src);
      copy.id = map[src.id];
      copy.groupId = copy.groupId && map[copy.groupId] ? map[copy.groupId] : null;
      copy.x = num(copy.x, 0) + offset;
      copy.y = num(copy.y, 0) + offset;
      created.push(self._insert(copy));
    });
    return created;
  };
  P._selectionTree = function (ids) {
    var self = this;
    var out = [];
    var seen = {};
    this._roots(asIds(ids)).forEach(function (id) {
      var l = self._find(id);
      if (!l || seen[l.id]) return;
      seen[l.id] = 1;
      out.push(JSON.parse(JSON.stringify(l)));
      if (l.type === 'group') {
        self._descendants(l.id, []).forEach(function (m) {
          if (!seen[m.id]) { seen[m.id] = 1; out.push(JSON.parse(JSON.stringify(m))); }
        });
      }
    });
    return out;
  };
  P.duplicate = function (ids) {
    var list = this._selectionTree(ids && asIds(ids).length ? ids : this._sel);
    if (!list.length) return [];
    this._before(null);
    var created = this._spawn(list, 24);
    this._after();
    var roots = created.filter(function (l) { return !l.groupId; }).map(function (l) { return l.id; });
    this.select(roots);
    return roots;
  };

  P.select = function (ids) {
    var self = this;
    var next = [];
    asIds(ids).forEach(function (id) {
      if (self._find(id) && next.indexOf(id) < 0) next.push(id);
    });
    this._sel = next;
    this._layout();
    this._emitSelect();
  };
  P.selection = function () { return this._sel.slice(); };
  P._emitSelect = function () {
    this._emit('select', { ids: this._sel.slice(), rect: this._selectionRect() });
  };

  P.order = function (id, how) {
    var i = this._index(id);
    if (i < 0) return;
    this._before(null);
    var arr = this._doc.layers;
    var item = arr.splice(i, 1)[0];
    if (how === 'front') arr.push(item);
    else if (how === 'back') arr.unshift(item);
    else if (how === 'forward') arr.splice(Math.min(arr.length, i + 1), 0, item);
    else if (how === 'backward') arr.splice(Math.max(0, i - 1), 0, item);
    else if (typeof how === 'number') arr.splice(clamp(how, 0, arr.length), 0, item);
    else arr.splice(i, 0, item);
    this._after();
  };

  P._union = function (ids) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var self = this;
    asIds(ids).forEach(function (id) {
      var l = self._find(id);
      if (!l) return;
      var list = l.type === 'group' ? self._descendants(l.id, []) : [l];
      if (!list.length && l.type === 'group') list = [l];
      list.forEach(function (layer) {
        if (layer.type === 'group') return;
        var b = layerAabb(layer);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      });
    });
    if (!isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  };
  P._syncGroup = function (gid) {
    var g = this._find(gid);
    if (!g || g.type !== 'group') return;
    var kids = this._direct(gid);
    if (!kids.length) return;
    var b = this._union(kids.map(function (k) { return k.id; }));
    g.x = b.x; g.y = b.y; g.w = b.w; g.h = b.h;
    if (g.groupId) this._syncGroup(g.groupId);
  };

  P.align = function (ids, edge, relativeTo) {
    ids = asIds(ids);
    if (!ids.length) ids = this._sel.slice();
    var roots = this._roots(ids);
    if (!roots.length) return;
    var box = relativeTo === 'page' || (relativeTo !== 'selection' && roots.length < 2 && relativeTo !== 'selection')
      ? { x: 0, y: 0, w: this._doc.width, h: this._doc.height }
      : this._union(roots);
    if (relativeTo === 'page') box = { x: 0, y: 0, w: this._doc.width, h: this._doc.height };
    this._before(null);
    var self = this;
    roots.forEach(function (id) {
      var l = self._find(id);
      if (!l) return;
      var b = l.type === 'group' ? { x: l.x, y: l.y, w: l.w, h: l.h } : layerAabb(l);
      var dx = 0, dy = 0;
      if (edge === 'left') dx = box.x - b.x;
      else if (edge === 'center') dx = (box.x + box.w / 2) - (b.x + b.w / 2);
      else if (edge === 'right') dx = (box.x + box.w) - (b.x + b.w);
      else if (edge === 'top') dy = box.y - b.y;
      else if (edge === 'middle') dy = (box.y + box.h / 2) - (b.y + b.h / 2);
      else if (edge === 'bottom') dy = (box.y + box.h) - (b.y + b.h);
      self._shiftTree(l, dx, dy);
    });
    roots.forEach(function (id) {
      var l = self._find(id);
      if (l && l.groupId) self._syncGroup(l.groupId);
    });
    this._after();
  };

  P.distribute = function (ids, axis) {
    ids = asIds(ids);
    if (!ids.length) ids = this._sel.slice();
    var roots = this._roots(ids).map(this._find, this).filter(Boolean);
    if (roots.length < 3) return;
    this._before(null);
    var vertical = axis === 'v';
    roots.sort(function (a, b) { return vertical ? a.y - b.y : a.x - b.x; });
    var first = roots[0], last = roots[roots.length - 1];
    var span = vertical ? (last.y + last.h) - first.y : (last.x + last.w) - first.x;
    var size = 0;
    roots.forEach(function (l) { size += vertical ? l.h : l.w; });
    var gap = (span - size) / (roots.length - 1);
    var cursor = vertical ? first.y : first.x;
    var self = this;
    roots.forEach(function (l, i) {
      if (i === 0) { cursor += (vertical ? l.h : l.w) + gap; return; }
      if (i === roots.length - 1) return;
      var delta = cursor - (vertical ? l.y : l.x);
      self._shiftTree(l, vertical ? 0 : delta, vertical ? delta : 0);
      cursor += (vertical ? l.h : l.w) + gap;
    });
    this._after();
  };

  P.group = function (ids) {
    ids = asIds(ids);
    if (!ids.length) ids = this._sel.slice();
    var roots = this._roots(ids);
    if (roots.length < 2) return null;
    this._before(null);
    var b = this._union(roots);
    var g = this._insert({ type: 'group', name: 'Group', x: b.x, y: b.y, w: b.w, h: b.h });
    var self = this;
    roots.forEach(function (id) {
      var l = self._find(id);
      if (l) l.groupId = g.id;
    });
    this._after();
    this.select([g.id]);
    return g.id;
  };
  P.ungroup = function (id) {
    var g = this._find(id);
    if (!g || g.type !== 'group') {
      var leaf = g;
      if (leaf && leaf.groupId) g = this._find(leaf.groupId);
    }
    if (!g || g.type !== 'group') return;
    this._before(null);
    var parent = g.groupId || null;
    var kids = this._direct(g.id);
    kids.forEach(function (k) { k.groupId = parent; });
    this._removeIds([g.id], true);
    this._after();
    this.select(kids.map(function (k) { return k.id; }));
  };
  P.lock = function (id, locked) {
    var layer = this._find(id);
    if (!layer) return;
    this._before(null);
    layer.locked = !!locked;
    this._after();
  };

  /* opts.coalesce: one undo step per gesture key; opts.history === false: live change with no undo step. */
  P.setBackground = function (bg, opts) {
    var next = clone(bg || { type: 'color', color: '#ffffff' });
    var self = this;
    if (opts && opts.history === false) { this._live(function () { self._doc.background = next; }); return; }
    this._before(opts && opts.coalesce ? String(opts.coalesce) : null);
    this._doc.background = next;
    this._after();
  };
  P.background = function () { return clone(this._doc.background || { type: 'color', color: '#ffffff' }); };
  /* Background edit mode: ghost of the photo outside the page; peek hides the layers while dragging. */
  P.editBackground = function (state) {
    this._bgEdit = state ? { peek: !!(state && state.peek) } : null;
    this._mark();
  };
  P.pageRect = function () { return this._rectToScreen({ x: 0, y: 0, w: this._doc.width, h: this._doc.height }); };
  P.view = function () { return { zoom: this._zoom, panX: this._panX, panY: this._panY }; };
  P.setView = function (zoom, panX, panY) {
    this._zoom = clamp(num(zoom, this._zoom), 0.05, 8);
    this._panX = num(panX, this._panX);
    this._panY = num(panY, this._panY);
    this._mark();
    this._layout();
    this._emit('zoom', { zoom: this._zoom, panX: this._panX, panY: this._panY });
  };
  /* Natural size of the background photo after its crop, and where it sits on the page (document units). */
  P.backgroundInfo = function () {
    var bg = this._doc.background;
    if (!bgPhoto(bg)) return null;
    var node = assetNode(this._assets[bg.src]);
    if (!node) return null;
    var s = bgSpec(bg);
    var iw = node.naturalWidth || node.width, ih = node.naturalHeight || node.height;
    var sw = Math.max(1, iw * s.crop.w), sh = Math.max(1, ih * s.crop.h);
    var p = bgPlace(s, this._doc.width, this._doc.height, sw, sh);
    return { width: iw, height: ih, sw: sw, sh: sh, page: { w: this._doc.width, h: this._doc.height }, spec: s, place: p };
  };
  P.resizePage = function (w, h, opts) {
    w = Math.max(1, num(w, this._doc.width));
    h = Math.max(1, num(h, this._doc.height));
    this._before(null);
    var sx = w / this._doc.width, sy = h / this._doc.height;
    this._doc.width = w;
    this._doc.height = h;
    if (opts && opts.scaleContent) {
      this._doc.layers.forEach(function (l) {
        l.x *= sx; l.y *= sy; l.w *= sx; l.h *= sy;
        if (l.type === 'text') l.size = Math.max(1, l.size * ((Math.abs(sx) + Math.abs(sy)) / 2));
        if (l.type === 'path') {
          l.points.forEach(function (p) { p[0] *= sx; p[1] *= sy; });
          l.width *= (Math.abs(sx) + Math.abs(sy)) / 2;
        }
      });
    }
    this._after();
    this.fit();
  };

  P.setTool = function (tool) {
    tool = tool || 'select';
    if (this._crop && tool !== 'crop') this._applyCrop();
    if (this._editing && tool !== 'text') this._commitEdit(false);
    this._tool = tool;
    var family = tool.indexOf('shape:') === 0 ? 'shape' : tool;
    this.el.setAttribute('data-tool', family);
    this._emit('tool', { tool: tool });
    this._layout();
  };
  P.tool = function () { return this._tool; };

  P.addAsset = function (key, value) {
    var rec = { key: key };
    var self = this;
    if (value && typeof value.getContext === 'function') {
      rec.canvas = value;
      rec.ready = Promise.resolve(rec);
    } else if (value && value.tagName === 'IMG') {
      rec.image = value;
      rec.ready = value.complete ? Promise.resolve(rec) : new Promise(function (res, rej) {
        value.onload = function () { res(rec); };
        value.onerror = function () { rej(new Error('Could not read that image.')); };
      });
    } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
      rec.url = URL.createObjectURL(value);
      rec.ready = new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () { rec.image = img; self._mark(); res(rec); };
        img.onerror = function () { rej(new Error('Could not read that image.')); };
        img.src = rec.url;
      });
    } else {
      rec.ready = Promise.resolve(rec);
    }
    if (this._assets[key] && this._assets[key].url) URL.revokeObjectURL(this._assets[key].url);
    this._assets[key] = rec;
    this._mark();
    return key;
  };

  P._imageBucket = function (layer) {
    var mul = this._level() === 'high' ? 2 : this._level() === 'mid' ? 1.5 : 1;
    var target = Math.max(64, Math.min(this._previewMax(), Math.ceil(Math.max(layer.w, layer.h) * mul)));
    return Math.ceil(target / 128) * 128;
  };
  P._imageKey = function (layer) {
    return JSON.stringify([layer.src, layer.crop, layer.adjust, layer.filter, layer.removeBg, layer.cutout || null, this._level(), this._imageBucket(layer), LE.fxBoot ? LE.fxBoot.key(layer) : 0]);
  };
  P._dropCanvas = function (canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    try { canvas.width = 1; canvas.height = 1; } catch (e) {}
  };
  P._clearBitmaps = function () {
    var self = this;
    Object.keys(this._imageCache || {}).forEach(function (k) {
      if (self._imageCache[k]) self._dropCanvas(self._imageCache[k].canvas);
    });
    this._imageCache = {};
    this._svgCache = {};
    this._textCache = {};
    this._dropBg();
  };
  P._scheduleImage = function (id) {
    var job = this._jobs[id] || (this._jobs[id] = { token: 0, busy: false, again: false, frame: 0 });
    job.token++;
    job.again = true;
    if (job.frame) return;
    var self = this;
    job.frame = requestAnimationFrame(function () {
      job.frame = 0;
      self._pumpImage(id);
    });
  };
  P._pumpImage = function (id) {
    var job = this._jobs[id];
    var layer = this._find(id);
    if (!job || !layer || layer.type !== 'image') return;
    if (!job.again || job.busy) return;
    job.again = false;
    job.busy = true;
    var token = job.token;
    var key = this._imageKey(layer);
    var target = Math.max(64, Math.min(this._previewMax(), Math.ceil(Math.max(layer.w, layer.h) * (this._level() === 'high' ? 2 : this._level() === 'mid' ? 1.5 : 1))));
    var self = this;
    this._processImage(layer, target, true).then(function (canvas) {
      job.busy = false;
      if (self._dead || job.token !== token) {
        if (job.token !== token) { job.again = true; self._pumpImage(id); }
        return;
      }
      var prev = self._imageCache[id];
      if (prev && prev.canvas && prev.canvas !== canvas) self._dropCanvas(prev.canvas);
      self._imageCache[id] = { key: key, canvas: canvas };
      self._mark();
      if (job.again) self._pumpImage(id);
    }, function () {
      job.busy = false;
      if (job.token === token) self._imageCache[id] = { key: key, canvas: null };
      if (job.again) self._pumpImage(id);
    });
  };
  P._processImage = function (layer, targetMax, preview) {
    var rec = this._assets[layer.src];
    var self = this;
    if (!rec) return Promise.resolve(null);
    /* Expert data: LE.fx makes the bitmap (it calls back here with _fxRaw for the legacy part). Everything below is unchanged. */
    if (!layer._fxRaw && LE.fxBoot && LE.fxBoot.needs(layer)) return LE.fxBoot.layer(this, layer, targetMax, preview);
    var cut = layer.cutout && layer.cutout.enabled !== false ? layer.cutout : null;
    var mrec = cut ? this._assets[cut.asset] : null;
    return Promise.all([rec.ready, mrec ? Promise.resolve(mrec.ready).catch(function () { return null; }) : null]).then(function () {
      var src = assetCanvas(rec);
      if (!src) return null;
      var base = src;
      if (LE.fit && Math.max(src.width, src.height) > targetMax) {
        /* Preview only: shrink a big original once to preview size and reuse it, so a zoom or resize does not re-scale 48 MP each time. */
        var pm = preview ? self._previewMax() : 0;
        if (preview && LE.fit && Math.max(src.width, src.height) > pm * 1.5 && targetMax <= pm) {
          if (!rec._prev || rec._prevFor !== src) { rec._prev = LE.fit(src, pm); rec._prevFor = src; }
          base = Math.max(rec._prev.width, rec._prev.height) > targetMax ? LE.fit(rec._prev, targetMax) : cloneCanvas(rec._prev);
        } else base = LE.fit(src, targetMax);
      }
      var rt = layer._fxRaw && layer.retouch ? assetCanvas(self._assets[layer.retouch.asset]) : null;
      if (rt) { if (base === src) base = cloneCanvas(base); base.getContext('2d').drawImage(rt, 0, 0, base.width, base.height); }   /* retouch overlay, at source geometry */
      /* Cut-out first, so crop, adjust, filters and the outline all see the subject on transparency. */
      if (cut && mrec) base = cutoutApply(base, mrec, cut.feather * base.width * ((layer.crop && layer.crop.w) || 1) / Math.max(1, layer.w));
      function finish(c) { return cut && cut.outline && c ? cutoutOutline(c, cut.outline.width * c.width / Math.max(1, layer.w), cut.outline.color) : c; }
      var steps = imageSteps(layer, preview && self._level() === 'low');
      if (!steps.length || !LE.applySteps) return finish(base === src ? cloneCanvas(base) : base);
      var tier = (LE.device && LE.device.tier) ? LE.device.tier() : 'desktop';
      return LE.applySteps(base, steps, { tier: tier }).then(function (res) { return finish(res.canvas); });
    }, function () { return null; });
  };
  /* The mask asset as a canvas whose alpha is the mask. An opaque greyscale mask (white = keep) is read by luminance. */
  function cutoutAlpha(mrec) {
    var m = assetCanvas(mrec);
    if (!m || !m.width) return null;
    if (mrec._cutOf === m && mrec._cutAlpha) return mrec._cutAlpha;
    var w = m.width, h = m.height, d = m.getContext('2d').getImageData(0, 0, w, h).data, opaque = true, i;
    for (i = 3; i < d.length; i += 4) if (d[i] < 255) { opaque = false; break; }
    var out = m;
    if (opaque) {
      out = document.createElement('canvas');
      out.width = w; out.height = h;
      var oc = out.getContext('2d'), img = oc.createImageData(w, h), o = img.data;
      for (i = 0; i < d.length; i += 4) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); }
      oc.putImageData(img, 0, 0);
    }
    mrec._cutOf = m;
    mrec._cutAlpha = out;
    return out;
  }
  function cutoutApply(base, mrec, feather) {
    var mask = cutoutAlpha(mrec);
    if (!mask) return base;
    var c = document.createElement('canvas');
    c.width = base.width; c.height = base.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (feather >= 0.5 && filterBlur()) {
      ctx.filter = 'blur(' + (feather / 2).toFixed(2) + 'px)';
      ctx.drawImage(mask, 0, 0, c.width, c.height);
      ctx.filter = 'none';
    } else if (feather >= 0.5) {
      var k = Math.max(1, Math.round(feather)), sm = document.createElement('canvas');
      sm.width = Math.max(1, Math.round(c.width / k)); sm.height = Math.max(1, Math.round(c.height / k));
      sm.getContext('2d').drawImage(mask, 0, 0, sm.width, sm.height);
      ctx.drawImage(sm, 0, 0, c.width, c.height);
    } else ctx.drawImage(mask, 0, 0, c.width, c.height);
    return c;
  }
  /* Sticker outline: a solid band of `width` px around everything at least half opaque (chamfer distance transform). */
  function cutoutOutline(canvas, width, color) {
    if (!(width >= 0.5)) return canvas;
    var w = canvas.width, h = canvas.height, n = w * h, x, y, i;
    var d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var dist = new Float32Array(n), BIG = 1e7, D = Math.SQRT2;
    for (i = 0; i < n; i++) dist[i] = d[i * 4 + 3] >= 128 ? 0 : BIG;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var v = dist[i];
      if (!v) continue;
      if (x > 0 && dist[i - 1] + 1 < v) v = dist[i - 1] + 1;
      if (y > 0) {
        if (dist[i - w] + 1 < v) v = dist[i - w] + 1;
        if (x > 0 && dist[i - w - 1] + D < v) v = dist[i - w - 1] + D;
        if (x < w - 1 && dist[i - w + 1] + D < v) v = dist[i - w + 1] + D;
      }
      dist[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x;
      var u = dist[i];
      if (!u) continue;
      if (x < w - 1 && dist[i + 1] + 1 < u) u = dist[i + 1] + 1;
      if (y < h - 1) {
        if (dist[i + w] + 1 < u) u = dist[i + w] + 1;
        if (x < w - 1 && dist[i + w + 1] + D < u) u = dist[i + w + 1] + D;
        if (x > 0 && dist[i + w - 1] + D < u) u = dist[i + w - 1] + D;
      }
      dist[i] = u;
    }
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var octx = out.getContext('2d');
    octx.fillStyle = color || '#ffffff';
    octx.fillRect(0, 0, 1, 1);
    var rgb = octx.getImageData(0, 0, 1, 1).data;
    var band = octx.createImageData(w, h), b = band.data;
    for (i = 0; i < n; i++) {
      var a = width + 0.5 - dist[i];
      if (a <= 0) continue;
      var j = i * 4;
      b[j] = rgb[0]; b[j + 1] = rgb[1]; b[j + 2] = rgb[2]; b[j + 3] = a >= 1 ? rgb[3] : Math.round(a * rgb[3]);
    }
    octx.putImageData(band, 0, 0);
    octx.drawImage(canvas, 0, 0);
    return out;
  }

  P._svgMarkup = function (layer) {
    var raw = '';
    var fromAsset = false;
    if (layer.assetId && LE.assets && typeof LE.assets.svg === 'function') {
      try {
        raw = LE.assets.svg(layer.assetId, { color: layer.color || undefined, strokeWidth: layer.strokeWidth == null ? undefined : layer.strokeWidth }) || '';
        fromAsset = !!raw;
      } catch (e) { raw = ''; }
    }
    if (!raw) raw = layer.svg || '';
    if (!fromAsset && layer.color) raw = tintSvg(raw, layer.color);
    return sanitizeSvg(raw);
  };
  P._scheduleSvg = function (id) {
    var self = this;
    var job = this._jobs['svg:' + id] || (this._jobs['svg:' + id] = { token: 0 });
    job.token++;
    var token = job.token;
    requestAnimationFrame(function () {
      if (job.token !== token || self._dead) return;
      var layer = self._find(id);
      if (!layer) return;
      self._rasterSvg(layer, 2).then(function (img) {
        if (job.token !== token || self._dead) return;
        self._svgCache[id] = { key: self._svgKey(layer, 2), image: img };
        self._mark();
      });
    });
  };
  P._svgKey = function (layer, mul) {
    var edge = Math.max(layer.w, layer.h);
    var bucket = Math.max(64, Math.min(2048, Math.ceil(edge * mul / 64) * 64));
    return [layer.assetId, layer.color, layer.strokeWidth, hash32(layer.svg || ''), bucket, Math.round(layer.w), Math.round(layer.h)].join('|');
  };
  P._rasterSvg = function (layer, mul) {
    var edge = Math.max(layer.w, layer.h, 1);
    var size = Math.max(64, Math.min(2048, Math.ceil(edge * mul / 64) * 64));
    var rw = Math.max(1, Math.round(layer.w / edge * size));
    var rh = Math.max(1, Math.round(layer.h / edge * size));
    var markup = prepSvg(this._svgMarkup(layer), rw, rh);
    if (!markup) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  };

  P._prepareFonts = function () {
    var jobs = [];
    this._doc.layers.forEach(function (l) {
      if (l.type === 'text' && LE.fonts && LE.fonts.load) {
        try { jobs.push(Promise.resolve(LE.fonts.load(l.font, l.weight, !!l.italic))['catch'](function () {})); }
        catch (e) { /* ignore */ }
      }
    });
    return Promise.all(jobs);
  };
  P._prepareBitmaps = function (scale) {
    var self = this;
    var bitmaps = {};
    var jobs = this._doc.layers.map(function (layer) {
      if (layer.type === 'image') {
        var rec = self._assets[layer.src];
        return Promise.resolve(rec && rec.ready).then(function () {
          var canvas = rec && assetCanvas(rec);
          var edge = canvas ? Math.max(canvas.width, canvas.height) : 256;
          var need = Math.ceil(Math.max(layer.w, layer.h) * scale);
          var target = Math.min(8192, Math.max(need, Math.min(edge, 8192)));
          return self._processImage(layer, target, false).then(function (bmp) { bitmaps[layer.id] = bmp; });
        }, function () { bitmaps[layer.id] = null; });
      }
      if (layer.type === 'svg') {
        return self._rasterSvg(layer, Math.max(2, scale)).then(function (img) { bitmaps[layer.id] = img; });
      }
      return null;
    });
    jobs.push(this._prepareBg(scale).then(function (pic) { if (pic) bitmaps[BG_KEY] = pic; }));
    if (LE.fxBoot) jobs.push(LE.fxBoot.prepare(this));
    return Promise.all(jobs).then(function () { return bitmaps; });
  };

  P.render = function (scale, opts) {
    opts = opts || {};
    scale = num(scale, 1);
    if (!(scale > 0)) scale = 1;
    var w = Math.max(1, Math.round(this._doc.width * scale));
    var h = Math.max(1, Math.round(this._doc.height * scale));
    var maxEdge = 16384;
    var tierNow = (LE.device && LE.device.tier) ? LE.device.tier() : 'desktop';
    var maxArea = tierNow === 'desktop' ? 120000000 : tierNow === 'modern' ? 48000000 : 17000000;
    if (w > maxEdge || h > maxEdge || w * h > maxArea) {
      var fit = Math.min(maxEdge / w, maxEdge / h, Math.sqrt(maxArea / (w * h)));
      w = Math.max(1, Math.round(w * fit));
      h = Math.max(1, Math.round(h * fit));
      scale *= fit;
    }
    var self = this;
    return this._prepareFonts().then(function () {
      return self._prepareBitmaps(scale);
    }).then(function (bitmaps) {
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      self._drawDocument(ctx, {
        preview: false,
        includeBackground: opts.includeBackground !== false,
        bitmaps: bitmaps
      });
      return c;
    });
  };

  P.exportLayer = function (id, scale) {
    var layer = this._find(id);
    scale = num(scale, 1);
    if (!(scale > 0)) scale = 1;
    if (!layer || layer.type === 'group') return Promise.resolve(null);
    var self = this;
    return this._prepareFonts().then(function () {
      return self._prepareBitmaps(scale);
    }).then(function (bitmaps) {
      var lw = Math.max(1, Math.round(layer.w * scale));
      var lh = Math.max(1, Math.round(layer.h * scale));
      if (lw > 8192 || lh > 8192 || lw * lh > 16000000) {
        var fitL = Math.min(8192 / lw, 8192 / lh, Math.sqrt(16000000 / (lw * lh)));
        lw = Math.max(1, Math.round(lw * fitL));
        lh = Math.max(1, Math.round(lh * fitL));
        scale *= fitL;
      }
      var c = document.createElement('canvas');
      c.width = lw;
      c.height = lh;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      self._drawLayer(ctx, layer, { preview: false, bitmaps: bitmaps, local: true });
      return c;
    });
  };

  P._draw = function () {
    var cssW = this.el.clientWidth, cssH = this.el.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    var dpr = Math.min(global.devicePixelRatio || 1, this._dprCap());
    var bw = cssW * dpr, bh = cssH * dpr;
    var maxEdge = Math.max(bw, bh);
    var cap = this._previewMax();
    if (maxEdge > cap) {
      var s = cap / maxEdge;
      bw *= s; bh *= s; dpr *= s;
    }
    var canvas = this._canvas;
    var pw = Math.max(1, Math.round(bw)), ph = Math.max(1, Math.round(bh));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    this._dpr = dpr;
    var ctx = this._ctx;
    var level = this._level();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = level === 'low' ? 'low' : level === 'mid' ? 'medium' : 'high';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this._workspace;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * this._zoom, 0, 0, dpr * this._zoom, this._panX * dpr, this._panY * dpr);
    if (this._bgEdit) this._drawBgGhost(ctx);
    if (level !== 'low') {
      ctx.save();
      ctx.shadowColor = 'rgba(23,19,31,.20)';
      ctx.shadowBlur = 28 / this._zoom;
      ctx.shadowOffsetY = 12 / this._zoom;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this._doc.width, this._doc.height);
      ctx.restore();
    }
    this._drawDocument(ctx, { preview: true, includeBackground: true });
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(23,19,31,.16)';
    ctx.lineWidth = 1 / this._zoom;
    ctx.strokeRect(0, 0, this._doc.width, this._doc.height);
    var car = this._doc.carousel;
    if (car && car.slides > 1) {
      ctx.strokeStyle = 'rgba(116,87,240,.85)';
      ctx.lineWidth = 1.5 / this._zoom;
      ctx.setLineDash([6 / this._zoom, 5 / this._zoom]);
      for (var si = 1; si < car.slides; si++) {
        ctx.beginPath(); ctx.moveTo(car.slideWidth * si, 0); ctx.lineTo(car.slideWidth * si, this._doc.height); ctx.stroke();
      }
    }
    ctx.restore();
    if (this._bgEdit) this._drawBgFrame(ctx);
  };

  P._drawDocument = function (ctx, opts) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this._doc.width, this._doc.height);
    ctx.clip();
    if (opts.includeBackground !== false) this._drawBackground(ctx, opts);
    var self = this;
    this._doc.layers.forEach(function (layer) {
      if (opts.preview && self._bgEdit && self._bgEdit.peek) return;
      if (opts.preview && self._crop && self._crop.id === layer.id) self._drawCropGhost(ctx, layer);
      if (LE.fxBoot && LE.fxBoot.draw(self, ctx, layer, opts)) return;   /* adjustment layers, groups and non-photo layers with effects */
      self._drawLayer(ctx, layer, opts);
    });
    ctx.restore();
  };

  P._drawBackground = function (ctx, opts) {
    var bg = this._doc.background || { type: 'color', color: '#ffffff' };
    var w = this._doc.width, h = this._doc.height;
    if (bg.type === 'gradient') {
      ctx.fillStyle = makeFill(ctx, {
        type: bg.kind === 'radial' ? 'radial' : 'linear',
        colors: bg.colors || ['#ffffff', '#E7E5EB'],
        angle: bg.angle || 0,
        color: bg.color
      }, w, h) || '#ffffff';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (bg.type === 'image') {
      ctx.fillStyle = bg.color || '#ffffff';
      ctx.fillRect(0, 0, w, h);
      this._paintBgPhoto(ctx, bg, opts || {});
      return;
    }
    this._dropBg();
    ctx.fillStyle = bg.color || '#ffffff';
    ctx.fillRect(0, 0, w, h);
  };

  /* ---------- Photo backgrounds ----------
     doc.background = { type:'image', src, color, fit:'cover'|'contain'|'fill'|'tile', crop:{x,y,w,h}, x, y, scale,
     rotation, flipX, flipY, opacity, blur, dim:{color,amount}, adjust:{...}, filter:{name,intensity}, tile:{size,gap} }.
     crop/adjust/filter go through the same pipeline as image layers; every other field is applied when drawing. */
  var BG_KEY = '\u0000background';
  var BG_FITS = { cover: 1, contain: 1, fill: 1, tile: 1 };
  function bgPhoto(bg) { return !!(bg && bg.type === 'image' && bg.src); }
  function bgSpec(bg) {
    bg = bg || {};
    var crop = bg.crop || {};
    var dim = bg.dim && typeof bg.dim === 'object' ? bg.dim : null;
    var tile = bg.tile && typeof bg.tile === 'object' ? bg.tile : {};
    var cx = clamp(num(crop.x, 0), 0, 0.999), cy = clamp(num(crop.y, 0), 0, 0.999);
    return {
      fit: BG_FITS[bg.fit] ? bg.fit : 'cover',
      crop: { x: cx, y: cy, w: clamp(num(crop.w, 1), 0.001, 1 - cx), h: clamp(num(crop.h, 1), 0.001, 1 - cy) },
      x: clamp(num(bg.x, 0), -10, 10),
      y: clamp(num(bg.y, 0), -10, 10),
      scale: clamp(num(bg.scale, 1), 0.05, 50),
      rotation: num(bg.rotation, 0),
      flipX: !!bg.flipX,
      flipY: !!bg.flipY,
      opacity: clamp(num(bg.opacity, 1), 0, 1),
      blur: clamp(num(bg.blur, 0), 0, 250),
      dim: dim ? { color: safePaint(dim.color) || '#000000', amount: clamp(num(dim.amount, 0), 0, 1) } : null,
      tile: { size: clamp(num(tile.size, 0.25), 0.02, 4), gap: clamp(num(tile.gap, 0), 0, 1) }
    };
  }
  function bgLook(bg, s) {
    return { src: bg.src, crop: s.crop, adjust: bg.adjust || {}, filter: bg.filter && bg.filter.name ? bg.filter : null, removeBg: null };
  }
  /* Where the photo (sw × sh after crop) lands on a W × H page: centre, page-axis scale, rotation. */
  function bgPlace(s, W, H, sw, sh) {
    var rad = (s.rotation || 0) * Math.PI / 180;
    var c = Math.abs(Math.cos(rad)), n = Math.abs(Math.sin(rad));
    if (c < 1e-9) c = 0;
    if (n < 1e-9) n = 0;
    var ew = sw * c + sh * n, eh = sw * n + sh * c;
    var kx, ky;
    if (s.fit === 'fill') { kx = W / ew; ky = H / eh; }
    else if (s.fit === 'tile') { kx = ky = s.tile.size * W / ew; }
    else if (s.fit === 'contain') { kx = ky = Math.min(W / ew, H / eh); }
    else { kx = ky = Math.max((W * c + H * n) / sw, (W * n + H * c) / sh); }
    if (s.fit !== 'tile') { kx *= s.scale; ky *= s.scale; }
    return { cx: W / 2 + s.x * W, cy: H / 2 + s.y * H, kx: kx, ky: ky, rad: rad, dw: ew * kx, dh: eh * ky };
  }
  function bgDrawOne(ctx, pic, s, p) {
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.scale(p.kx, p.ky);
    ctx.rotate(p.rad);
    if (s.flipX || s.flipY) ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    ctx.drawImage(pic.img, pic.sx, pic.sy, pic.sw, pic.sh, -pic.nw / 2, -pic.nh / 2, pic.nw, pic.nh);
    ctx.restore();
  }
  function bgTileCanvas(pic, s, p, W, res) {
    var gap = s.tile.gap * W;
    var cw = p.dw + gap, ch = p.dh + gap;
    var k = Math.max(0.05, res);
    if (Math.max(cw, ch) * k > 4096) k = 4096 / Math.max(cw, ch);
    var t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(cw * k));
    t.height = Math.max(1, Math.round(ch * k));
    var x = t.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.scale(t.width / cw, t.height / ch);
    bgDrawOne(x, pic, s, { cx: cw / 2, cy: ch / 2, kx: p.kx, ky: p.ky, rad: p.rad });
    return { canvas: t, cw: cw, ch: ch };
  }
  function bgDrawTiles(ctx, tile, p, W, H) {
    var ox = p.cx - tile.cw / 2, oy = p.cy - tile.ch / 2;
    var pat = ctx.createPattern(tile.canvas, 'repeat');
    if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix === 'function') {
      pat.setTransform(new DOMMatrix([tile.cw / tile.canvas.width, 0, 0, tile.ch / tile.canvas.height, ox, oy]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    var x0 = ox - Math.ceil(ox / tile.cw) * tile.cw, y0 = oy - Math.ceil(oy / tile.ch) * tile.ch;
    for (var y = y0; y < H; y += tile.ch) for (var x = x0; x < W; x += tile.cw) ctx.drawImage(tile.canvas, x, y, tile.cw, tile.ch);
  }
  var canFilter = null;
  function filterBlur() {
    if (canFilter == null) {
      try { var t = document.createElement('canvas').getContext('2d'); t.filter = 'blur(2px)'; canFilter = t.filter === 'blur(2px)'; }
      catch (e) { canFilter = false; }
    }
    return canFilter;
  }
  function ctxScale(ctx) {
    try { var m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; } catch (e) { return 1; }
  }
  function blank2d(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  P._dropBg = function () {
    var c = this._bgc;
    if (!c) return;
    var self = this;
    ['src', 'blur', 'tile'].forEach(function (k) { if (c[k] && c[k].canvas) self._dropCanvas(c[k].canvas); });
    this._bgc = {};
  };
  P._dropBgPart = function (k) {
    var c = this._bgc;
    if (!c || !c[k]) return;
    if (c[k].canvas) this._dropCanvas(c[k].canvas);
    c[k] = null;
  };
  P._bgRaw = function (bg, s) {
    var node = assetNode(this._assets[bg.src]);
    if (!node) return null;
    var iw = node.naturalWidth || node.width, ih = node.naturalHeight || node.height;
    if (!iw || !ih) return null;
    var sw = Math.max(1, iw * s.crop.w), sh = Math.max(1, ih * s.crop.h);
    return { img: node, sx: iw * s.crop.x, sy: ih * s.crop.y, sw: sw, sh: sh, nw: sw, nh: sh, id: 'raw|' + bg.src + '|' + JSON.stringify(s.crop) };
  };
  function bgProcessed(canvas, raw, id) {
    return { img: canvas, sx: 0, sy: 0, sw: canvas.width, sh: canvas.height, nw: raw ? raw.nw : canvas.width, nh: raw ? raw.nh : canvas.height, id: id };
  }
  /* The photo to draw: the raw asset when there is nothing to process, else the processed bitmap (cached, made off-frame). */
  P._bgPic = function (bg, s, opts) {
    if (opts && opts.bitmaps && opts.bitmaps[BG_KEY]) return opts.bitmaps[BG_KEY];
    var raw = this._bgRaw(bg, s);
    if (!raw) return null;
    var look = bgLook(bg, s);
    if (!imageSteps(look, false).length) { this._dropBgPart('src'); return raw; }
    var mul = this._level() === 'high' ? 2 : this._level() === 'mid' ? 1.5 : 1;
    var p = bgPlace(s, this._doc.width, this._doc.height, raw.sw, raw.sh);
    var need = Math.max(64, Math.min(this._previewMax(), Math.ceil(Math.max(p.dw, p.dh) * mul)));
    var target = Math.ceil(need / 128) * 128;
    var key = JSON.stringify([bg.src, s.crop, look.adjust, look.filter, this._level(), target]);
    var c = this._bgc || (this._bgc = {});
    if (!c.src || c.src.key !== key) this._scheduleBg(key, look, target);
    if (c.src && c.src.canvas) return bgProcessed(c.src.canvas, raw, 'p|' + c.src.key);
    return raw;
  };
  P._scheduleBg = function (key, look, target) {
    var job = this._bgJob || (this._bgJob = { busy: null, want: null });
    if (job.busy === key || (job.want && job.want.key === key)) return;
    job.want = { key: key, look: look, target: target };
    if (!job.busy) this._pumpBg();
  };
  P._pumpBg = function () {
    var job = this._bgJob;
    var want = job && job.want;
    if (!want) return;
    job.want = null;
    job.busy = want.key;
    var self = this;
    function next() { job.busy = null; if (job.want && !self._dead) self._pumpBg(); }
    this._processImage(want.look, want.target, true).then(function (canvas) {
      if (self._dead) return;
      var c = self._bgc || (self._bgc = {});
      if (c.src && c.src.canvas && c.src.canvas !== canvas) self._dropCanvas(c.src.canvas);
      c.src = { key: want.key, canvas: canvas };
      self._mark();
      next();
    }, function () {
      var c = self._bgc || (self._bgc = {});
      c.src = { key: want.key, canvas: null };
      next();
    });
  };
  /* Export: process the photo at output resolution. */
  P._prepareBg = function (scale) {
    var bg = this._doc.background;
    if (!bgPhoto(bg)) return Promise.resolve(null);
    var rec = this._assets[bg.src];
    var self = this;
    return Promise.resolve(rec && rec.ready).then(function () {
      var s = bgSpec(bg);
      var raw = self._bgRaw(bg, s);
      if (!raw) return null;
      var look = bgLook(bg, s);
      if (!imageSteps(look, false).length) return raw;
      var p = bgPlace(s, self._doc.width, self._doc.height, raw.sw, raw.sh);
      var need = Math.ceil(Math.max(p.dw, p.dh) * scale);
      var target = Math.min(8192, Math.max(need, Math.min(Math.max(raw.sw, raw.sh), 8192)));
      return self._processImage(look, target, false).then(function (canvas) {
        return canvas ? bgProcessed(canvas, raw, 'export') : raw;
      });
    }, function () { return null; });
  };
  /* Sharp photo at full opacity: one placed image, or a tiled fill. */
  P._bgSharp = function (ctx, pic, s, W, H, res, cache) {
    var p = bgPlace(s, W, H, pic.nw, pic.nh);
    if (s.fit !== 'tile') { bgDrawOne(ctx, pic, s, p); return; }
    var tile;
    if (cache) {
      var bucket = Math.pow(2, clamp(Math.round(Math.log(Math.max(res, 0.01)) / Math.LN2 * 2) / 2, -3, 1.5));
      var key = JSON.stringify([pic.id, s.tile, s.rotation, s.flipX, s.flipY, W, bucket]);
      if (!cache.tile || cache.tile.key !== key) {
        if (cache.tile && cache.tile.canvas) this._dropCanvas(cache.tile.canvas);
        var made = bgTileCanvas(pic, s, p, W, bucket);
        cache.tile = { key: key, canvas: made.canvas, cw: made.cw, ch: made.ch };
      }
      tile = cache.tile;
    } else tile = bgTileCanvas(pic, s, p, W, res);
    bgDrawTiles(ctx, tile, p, W, H);
    if (!cache) this._dropCanvas(tile.canvas);
  };
  /* Blurred photo as a page-sized bitmap at r pixels per document unit. */
  P._bgBlurred = function (pic, s, W, H, r, cache) {
    var cw = Math.max(1, Math.round(W * r)), ch = Math.max(1, Math.round(H * r));
    var br = s.blur * r;
    var pad = Math.ceil(br * 2.5);
    var sharp = blank2d(cw + pad * 2, ch + pad * 2);
    var x = sharp.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.translate(pad, pad);
    x.scale(r, r);
    if (s.fit === 'cover') {
      x.save();
      x.translate(W / 2, H / 2);
      x.scale((W + pad * 2 / r) / W, (H + pad * 2 / r) / H);
      x.translate(-W / 2, -H / 2);
      this._bgSharp(x, pic, s, W, H, r, null);
      x.restore();
    }
    this._bgSharp(x, pic, s, W, H, r, cache);
    var out = blank2d(cw, ch);
    var o = out.getContext('2d');
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    if (filterBlur()) {
      o.filter = 'blur(' + br + 'px)';
      o.drawImage(sharp, -pad, -pad);
      o.filter = 'none';
    } else {
      var f = Math.max(1, br / 2);
      var small = blank2d(sharp.width / f, sharp.height / f);
      var sx = small.getContext('2d');
      sx.imageSmoothingEnabled = true;
      sx.drawImage(sharp, 0, 0, small.width, small.height);
      o.drawImage(small, pad / f, pad / f, cw / f, ch / f, 0, 0, cw, ch);
      this._dropCanvas(small);
    }
    this._dropCanvas(sharp);
    return out;
  };
  P._paintBgPhoto = function (ctx, bg, opts) {
    var s = bgSpec(bg);
    var pic = this._bgPic(bg, s, opts);
    if (!pic) return;
    var W = this._doc.width, H = this._doc.height;
    var preview = !opts.bitmaps;
    var cache = preview ? (this._bgc || (this._bgc = {})) : null;
    var res = ctxScale(ctx);
    if (preview && !s.blur) this._dropBgPart('blur');
    if (preview && s.fit !== 'tile') this._dropBgPart('tile');
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * s.opacity;
    if (s.blur > 0) {
      var comp;
      if (preview) {
        var r = Math.min(1, Math.min(this._previewMax(), 1600) / Math.max(W, H));
        var key = JSON.stringify([pic.id, s, W, H, r]);
        if (!cache.blur || cache.blur.key !== key) {
          if (cache.blur && cache.blur.canvas) this._dropCanvas(cache.blur.canvas);
          cache.blur = { key: key, canvas: this._bgBlurred(pic, s, W, H, r, cache) };
        }
        comp = cache.blur.canvas;
      } else comp = this._bgBlurred(pic, s, W, H, Math.min(res, 16384 / Math.max(W, H)), null);
      ctx.drawImage(comp, 0, 0, W, H);
      if (!preview) this._dropCanvas(comp);
    } else {
      this._bgSharp(ctx, pic, s, W, H, res, cache);
    }
    ctx.restore();
    if (s.dim && s.dim.amount > 0) {
      ctx.save();
      ctx.globalAlpha = s.dim.amount;
      ctx.fillStyle = s.dim.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };
  /* Edit-background mode: the part of the photo outside the page, faded. */
  P._drawBgGhost = function (ctx) {
    var bg = this._doc.background;
    if (!bgPhoto(bg)) return;
    var s = bgSpec(bg);
    if (s.fit === 'tile') return;
    var pic = this._bgPic(bg, s, {});
    if (!pic) return;
    ctx.save();
    ctx.globalAlpha = 0.34;
    bgDrawOne(ctx, pic, s, bgPlace(s, this._doc.width, this._doc.height, pic.nw, pic.nh));
    ctx.restore();
  };
  P._drawBgFrame = function (ctx) {
    var bg = this._doc.background;
    if (!bgPhoto(bg)) return;
    var s = bgSpec(bg);
    var raw = this._bgRaw(bg, s);
    ctx.save();
    ctx.lineWidth = 2 / this._zoom;
    ctx.strokeStyle = '#7457F0';
    ctx.strokeRect(0, 0, this._doc.width, this._doc.height);
    if (raw && s.fit !== 'tile') {
      var p = bgPlace(s, this._doc.width, this._doc.height, raw.nw, raw.nh);
      ctx.translate(p.cx, p.cy);
      ctx.rotate(p.rad);
      var hw = raw.nw * p.kx / 2, hh = raw.nh * p.ky / 2;
      if (Math.abs(Math.sin(p.rad)) > 0.5) { hw = raw.nw * p.ky / 2; hh = raw.nh * p.kx / 2; }
      ctx.setLineDash([6 / this._zoom, 5 / this._zoom]);
      ctx.lineWidth = 1.5 / this._zoom;
      ctx.strokeStyle = 'rgba(116,87,240,.85)';
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    }
    ctx.restore();
  };

  P._drawLayer = function (ctx, layer, opts) {
    if (!layer || layer.type === 'group' || layer.visible === false) return;
    if (this._hidden(layer)) return;
    if (opts.preview && this._editing === layer.id) return;
    if (layer.type === 'shape' && layer.redact) { this._paintRedact(ctx, layer, opts); return; }
    var alpha = this._opacity(layer);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blendOf(layer.blend);
    if (opts.local) {
      ctx.translate(layer.w / 2, layer.h / 2);
      if (layer.flipX || layer.flipY) ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      ctx.translate(-layer.w / 2, -layer.h / 2);
    } else {
      ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
      ctx.rotate((layer.rotation || 0) * Math.PI / 180);
      if (layer.flipX || layer.flipY) ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      ctx.translate(-layer.w / 2, -layer.h / 2);
    }
    var skipShadow = opts.preview && this._level() === 'low';
    if (layer.shadow && !skipShadow) {
      ctx.shadowColor = layer.shadow.color || 'rgba(23,19,31,.35)';
      ctx.shadowBlur = num(layer.shadow.blur, 16);
      ctx.shadowOffsetX = num(layer.shadow.x, 0);
      ctx.shadowOffsetY = num(layer.shadow.y, 8);
    }
    try {
      if (layer.type === 'image') this._paintImage(ctx, layer, opts);
      else if (layer.type === 'text') this._paintText(ctx, layer);
      else if (layer.type === 'shape') this._paintShape(ctx, layer);
      else if (layer.type === 'svg') this._paintSvg(ctx, layer, opts);
      else if (layer.type === 'path') this._paintPath(ctx, layer);
    } catch (paintErr) { /* a broken layer should not stop the frame */ }
    ctx.restore();
  };

  function paintPlaceholder(ctx, layer) {
    var w = Math.max(1, layer.w), h = Math.max(1, layer.h);
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = placeholderFill();
    ctx.fillRect(0, 0, w, h);
    var arm = Math.max(7, Math.min(18, Math.min(w, h) * 0.12));
    var cx = w / 2, cy = h / 2;
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(23,19,31,.55)';
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.restore();
  }

  P._imageClip = function (layer) {
    var maskPath = sanitizeMaskPath(layer.maskPath);
    if (maskPath) {
      try { return new Path2D(maskPath); } catch (e) { /* fall through to the shape mask */ }
    }
    if (layer.mask && layer.mask !== 'none') {
      var spec = findShape(layer.mask);
      var params = { radius: layer.radius };
      var d = 'M0 0H' + layer.w + 'V' + layer.h + 'H0Z';
      try { if (spec.path) d = spec.path(layer.w, layer.h, params); } catch (e) { d = roundedPath(layer.w, layer.h, 0); }
      if (typeof d === 'string') return new Path2D(d);
      return d;
    }
    if (layer.radius > 0) {
      var p = new Path2D();
      var r = Math.min(layer.radius, layer.w / 2, layer.h / 2);
      p.moveTo(r, 0);
      p.arcTo(layer.w, 0, layer.w, layer.h, r);
      p.arcTo(layer.w, layer.h, 0, layer.h, r);
      p.arcTo(0, layer.h, 0, 0, r);
      p.arcTo(0, 0, layer.w, 0, r);
      p.closePath();
      return p;
    }
    return null;
  };

  P._paintImage = function (ctx, layer, opts) {
    var bitmap = opts.bitmaps ? opts.bitmaps[layer.id] : null;
    if (!opts.bitmaps) {
      var cached = this._imageCache[layer.id];
      var key = this._imageKey(layer);
      if (cached && cached.canvas) bitmap = cached.canvas;
      if ((!cached || cached.key !== key) && layer.src) this._scheduleImage(layer.id);
    }
    var node = null;
    var cutPending = !bitmap && layer.cutout && layer.cutout.enabled !== false;
    if (!bitmap && !cutPending) node = assetNode(this._assets[layer.src]);
    if (cutPending) return;
    var clip = this._imageClip(layer);
    var empty = !bitmap && !node;
    var fxb = bitmap && bitmap._fx && !bitmap._fx.fallback ? bitmap._fx : null;
    ctx.save();
    if (clip && !fxb) ctx.clip(clip);
    if (fxb) ctx.drawImage(bitmap, -fxb.padX, -fxb.padY, layer.w + 2 * fxb.padX, layer.h + 2 * fxb.padY);
    else if (bitmap) ctx.drawImage(bitmap, 0, 0, layer.w, layer.h);
    else if (node) {
      var crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
      var iw = node.naturalWidth || node.width, ih = node.naturalHeight || node.height;
      ctx.drawImage(node, crop.x * iw, crop.y * ih, Math.max(1, crop.w * iw), Math.max(1, crop.h * ih), 0, 0, layer.w, layer.h);
    } else {
      paintPlaceholder(ctx, layer);
    }
    ctx.restore();
    if (empty) {
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(23,19,31,.45)';
      if (clip) ctx.stroke(clip);
      else ctx.strokeRect(0.75, 0.75, Math.max(0, layer.w - 1.5), Math.max(0, layer.h - 1.5));
      ctx.restore();
    }
    if (layer.border && layer.border.width > 0) {
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = layer.border.width;
      ctx.strokeStyle = layer.border.color || '#17131F';
      if (clip) ctx.stroke(clip);
      else ctx.strokeRect(0, 0, layer.w, layer.h);
      ctx.restore();
    }
  };

  P._drawCropGhost = function (ctx, layer) {
    var session = this._crop;
    if (!session) return;
    var rec = this._assets[layer.src];
    var node = assetNode(rec);
    if (!node) return;
    ctx.save();
    ctx.translate(session.cx, session.cy);
    ctx.rotate((session.rot || 0) * Math.PI / 180);
    if (session.flipX || session.flipY) ctx.scale(session.flipX ? -1 : 1, session.flipY ? -1 : 1);
    ctx.globalAlpha *= 0.45;
    ctx.drawImage(node, -session.fw / 2, -session.fh / 2, session.fw, session.fh);
    ctx.restore();
  };

  P._paintText = function (ctx, layer) {
    var text = String(layer.text || '');
    if (layer.uppercase) text = text.toUpperCase();
    var size = layer.size || 32;
    ctx.font = (layer.italic ? 'italic ' : 'normal ') + (layer.weight || 400) + ' ' + size + 'px ' + fontFamily(layer.font);
    ctx.textBaseline = 'middle';
    var fill = layer.fill ? makeFill(ctx, layer.fill, layer.w, layer.h) : (layer.color || '#17131F');
    var spacing = layer.letterSpacing || 0;
    if (layer.curve) {
      this._paintArc(ctx, layer, text, fill, spacing);
      return;
    }
    var cacheKey = [text, layer.font, layer.weight, layer.italic, size, layer.w, spacing, layer.lineHeight, this._fontEpoch].join('\u0001');
    var cached = this._textCache[layer.id];
    var lines;
    if (cached && cached.key === cacheKey) lines = cached.lines;
    else {
      lines = wrapText(ctx, text, Math.max(1, layer.w), spacing);
      this._textCache[layer.id] = { key: cacheKey, lines: lines };
    }
    var lh = (layer.lineHeight || 1.2) * size;
    if (layer.background) {
      var bg = layer.background;
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = bg.color || 'rgba(255,255,255,.92)';
      lines.forEach(function (line, i) {
        if (!line) return;
        var tw = measureText(ctx, line, spacing);
        var x = alignX(layer.align, layer.w, tw);
        var pad = bg.padding == null ? size * 0.18 : bg.padding;
        roundRect(ctx, x - pad, i * lh + lh * 0.12, tw + pad * 2, lh * 0.76, bg.radius == null ? 999 : bg.radius);
        ctx.fill();
      });
      ctx.restore();
    }
    lines.forEach(function (line, i) {
      var tw = measureText(ctx, line, spacing);
      var x = alignX(layer.align, layer.w, tw);
      var y = i * lh + lh / 2;
      paintLine(ctx, line, x, y, spacing, fill, layer.stroke);
      if ((layer.underline || layer.strike) && line) {
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.beginPath();
        ctx.strokeStyle = layer.color || '#17131F';
        ctx.lineWidth = Math.max(1, size / 16);
        var uy = layer.strike ? y : y + size * 0.32;
        ctx.moveTo(x, uy);
        ctx.lineTo(x + tw, uy);
        ctx.stroke();
        ctx.restore();
      }
    });
  };

  P._paintArc = function (ctx, layer, text, fill, spacing) {
    var sweep = (layer.curve || 0) * Math.PI / 180;
    text = text.replace(/\n/g, ' ');
    if (Math.abs(sweep) < 0.02 || !text) return;
    var tw = measureText(ctx, text, spacing);
    if (tw < 1) return;
    var r = tw / Math.abs(sweep);
    var mid = sweep > 0 ? -Math.PI / 2 : Math.PI / 2;
    var cx = layer.w / 2 - Math.cos(mid) * r;
    var cy = layer.h / 2 - Math.sin(mid) * r;
    var dir = sweep > 0 ? 1 : -1;
    var angle = mid - (tw / 2) / r * dir;
    var size = layer.size || 32;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var cw = ctx.measureText(ch).width;
      var step = cw + (i < text.length - 1 ? spacing : 0);
      var a = angle + (step / 2) / r * dir;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.rotate(a + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2));
      ctx.textAlign = 'center';
      if (layer.stroke && layer.stroke.width) {
        ctx.lineWidth = layer.stroke.width;
        ctx.strokeStyle = layer.stroke.color || '#17131F';
        ctx.lineJoin = 'round';
        ctx.strokeText(ch, 0, 0);
      }
      if (fill) { ctx.fillStyle = fill; ctx.fillText(ch, 0, 0); }
      if (layer.underline || layer.strike) {
        ctx.shadowColor = 'transparent';
        ctx.beginPath();
        ctx.strokeStyle = layer.color || '#17131F';
        ctx.lineWidth = Math.max(1, size / 16);
        var uy = layer.strike ? 0 : size * 0.32;
        ctx.moveTo(-cw / 2, uy);
        ctx.lineTo(cw / 2, uy);
        ctx.stroke();
      }
      ctx.restore();
      angle += step / r * dir;
    }
  };

  /* ---------- Redaction (privacy) ----------
     A shape layer with `redact: { mode, amount, color }` hides whatever is already painted beneath it, inside its
     outline: 'solid' covers it, 'pixelate' averages it into blocks, 'blur' averages it down and then blurs it (so detail
     is destroyed, not just softened). `amount` is the block size or blur radius in document units; 0 means automatic.
     A floor tied to the box size keeps it strong enough to hide text. The effect reads the pixels already drawn on the
     target canvas, so the preview and every export scale match; opacity, blend and shadow never weaken it. */
  function redactOf(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    var mode = r.mode === 'blur' || r.mode === 'pixelate' ? r.mode : 'solid';
    var color = typeof r.color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(r.color) ? r.color : '#17131F';
    return { mode: mode, amount: clamp(Math.round(num(r.amount, 0)), 0, 500), color: color };
  }
  function redactSize(layer) {
    var r = redactOf(layer && layer.redact) || { mode: 'solid', amount: 0 };
    var short = Math.max(1, Math.min(Math.abs(num(layer.w, 1)), Math.abs(num(layer.h, 1))));
    if (r.mode === 'blur') return Math.max(r.amount || Math.max(12, short / 4), Math.max(6, short / 8));
    return Math.max(r.amount || Math.max(12, short / 5), Math.max(4, short / 10));
  }
  function redactScratch(pool, i, w, h) {
    var c = pool[i] || (pool[i] = document.createElement('canvas'));
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else c.getContext('2d').clearRect(0, 0, w, h);
    return c;
  }
  /* Box-averages a region of src down to tw × th by repeated halving, so every output pixel is a true mean. */
  function redactShrink(pool, src, sx, sy, sw, sh, tw, th) {
    var cur = src, cx = sx, cy = sy, cw = sw, ch = sh, slot = 0;
    while (cw / 2 >= tw * 1.5 || ch / 2 >= th * 1.5) {
      var nw = Math.max(tw, Math.ceil(cw / 2)), nh = Math.max(th, Math.ceil(ch / 2));
      var step = redactScratch(pool, slot, nw, nh);
      var x = step.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
      cur = step; cx = 0; cy = 0; cw = nw; ch = nh; slot = slot ? 0 : 1;
    }
    var out = redactScratch(pool, 2, tw, th);
    var o = out.getContext('2d');
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
    o.drawImage(cur, cx, cy, cw, ch, 0, 0, tw, th);
    return out;
  }
  function redactPath(layer) {
    var spec = findShape(layer.shape);
    var params = clone(layer.params) || {};
    if (params.radius == null && layer.radius) params.radius = layer.radius;
    var d = 'M0 0H' + layer.w + 'V' + layer.h + 'H0Z';
    try { if (spec && spec.path && !spec.strokeOnly) d = spec.path(layer.w, layer.h, params) || d; } catch (e) { /* plain box */ }
    return typeof d === 'string' ? new Path2D(d) : d;
  }
  /* Paints a redaction with the context set to document units. Also used to bake a redaction into a photo. */
  function paintRedact(ctx, layer, opts) {
    opts = opts || {};
    var r = redactOf(layer.redact);
    if (!r) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent';
    var base = ctx.getTransform();
    var W = num(opts.pageW, 0), H = num(opts.pageH, 0);
    ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
    ctx.rotate((layer.rotation || 0) * Math.PI / 180);
    if (layer.flipX || layer.flipY) ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.translate(-layer.w / 2, -layer.h / 2);
    var path = redactPath(layer);
    if (r.mode === 'solid' || opts.local) {
      ctx.fillStyle = r.color;
      ctx.fill(path);
      ctx.restore();
      return;
    }
    var m = ctx.getTransform();
    var cv = ctx.canvas;
    function box(t, w, h) {
      var xs = [], ys = [];
      [[0, 0], [w, 0], [w, h], [0, h]].forEach(function (p) { xs.push(t.a * p[0] + t.c * p[1] + t.e); ys.push(t.b * p[0] + t.d * p[1] + t.f); });
      return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    }
    var lim = { x0: 0, y0: 0, x1: cv.width, y1: cv.height };
    if (W > 0 && H > 0) {
      var pg = box(base, W, H);
      lim = { x0: Math.max(0, pg.x0), y0: Math.max(0, pg.y0), x1: Math.min(cv.width, pg.x1), y1: Math.min(cv.height, pg.y1) };
    }
    var b = box(m, layer.w, layer.h);
    var x0 = Math.floor(Math.max(b.x0, lim.x0)), y0 = Math.floor(Math.max(b.y0, lim.y0));
    var x1 = Math.ceil(Math.min(b.x1, lim.x1)), y1 = Math.ceil(Math.min(b.y1, lim.y1));
    if (x1 - x0 < 1 || y1 - y0 < 1) { ctx.restore(); return; }
    var k = Math.max(1, redactSize(layer) * (Math.hypot(base.a, base.b) || 1));
    var pool = opts.pool || [];
    ctx.clip(path);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var bw = x1 - x0, bh = y1 - y0;
    if (r.mode === 'pixelate') {
      var cols = Math.max(1, Math.ceil(bw / k)), rows = Math.max(1, Math.ceil(bh / k));
      var gw = cols * k, gh = rows * k;
      var sw = Math.min(gw, lim.x1 - x0), sh = Math.min(gh, lim.y1 - y0);
      var tw = Math.max(1, Math.round(cols * sw / gw)), th = Math.max(1, Math.round(rows * sh / gh));
      var small = redactShrink(pool, cv, x0, y0, sw, sh, tw, th);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, tw, th, x0, y0, tw * k, th * k);
    } else {
      var pad = Math.ceil(k * 1.5);
      var rx0 = Math.max(lim.x0, x0 - pad), ry0 = Math.max(lim.y0, y0 - pad);
      var rx1 = Math.min(lim.x1, x1 + pad), ry1 = Math.min(lim.y1, y1 + pad);
      var rw = rx1 - rx0, rh = ry1 - ry0;
      var soft = opts.fast || !filterBlur();
      var f = Math.max(1, soft ? k / 1.5 : k / 4);
      var dw = Math.max(1, Math.round(rw / f)), dh = Math.max(1, Math.round(rh / f));
      var low = redactShrink(pool, cv, rx0, ry0, rw, rh, dw, dh);
      var out = low;
      if (!soft) {
        out = redactScratch(pool, 3, dw, dh);
        var ox = out.getContext('2d');
        ox.drawImage(low, 0, 0);
        ox.filter = 'blur(' + (k / f).toFixed(2) + 'px)';
        ox.drawImage(low, 0, 0);
        ox.filter = 'none';
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(out, 0, 0, dw, dh, rx0, ry0, rw, rh);
    }
    ctx.restore();
    if (!opts.pool) pool.forEach(function (c) { try { c.width = 1; c.height = 1; } catch (e) {} });
  }
  P._paintRedact = function (ctx, layer, opts) {
    var preview = !!opts.preview;
    try {
      paintRedact(ctx, layer, {
        local: !!opts.local, pageW: this._doc.width, pageH: this._doc.height,
        pool: preview ? (this._rdx || (this._rdx = [])) : null, fast: preview && this._level() === 'low'
      });
    } catch (e) { /* a broken redaction should not stop the frame */ }
  };

  P._paintShape = function (ctx, layer) {
    var spec = findShape(layer.shape);
    var params = clone(layer.params) || {};
    if (params.radius == null && layer.radius) params.radius = layer.radius;
    var d = 'M0 0H' + layer.w + 'V' + layer.h + 'H0Z';
    try {
      if (spec && spec.path) {
        var next = spec.path(layer.w, layer.h, params);
        if (next) d = next;
      }
    } catch (e) { d = 'M0 0H' + layer.w + 'V' + layer.h + 'H0Z'; }
    var path = typeof d === 'string' ? new Path2D(d) : d;
    var strokeOnly = !!(spec && spec.strokeOnly) || layer.shape === 'line';
    var fill = makeFill(ctx, layer.fill, layer.w, layer.h);
    if (!strokeOnly && fill) {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    var stroke = layer.stroke;
    if ((stroke && stroke.width) || strokeOnly) {
      ctx.shadowColor = fill ? 'transparent' : ctx.shadowColor;
      ctx.strokeStyle = (stroke && stroke.color) || (typeof layer.fill === 'string' ? layer.fill : '#17131F');
      ctx.lineWidth = (stroke && stroke.width) || 4;
      ctx.lineCap = (stroke && stroke.cap) || 'round';
      ctx.lineJoin = (stroke && stroke.join) || 'round';
      ctx.setLineDash(stroke && stroke.dash ? stroke.dash : []);
      ctx.stroke(path);
    }
  };

  P._paintSvg = function (ctx, layer, opts) {
    var img = opts.bitmaps ? opts.bitmaps[layer.id] : null;
    if (!opts.bitmaps) {
      var cached = this._svgCache[layer.id];
      var key = this._svgKey(layer, 2);
      if (cached && cached.image) img = cached.image;
      if (!cached || cached.key !== key) this._scheduleSvg(layer.id);
    }
    if (!img) {
      ctx.fillStyle = 'rgba(116,87,240,.12)';
      ctx.fillRect(0, 0, layer.w, layer.h);
      return;
    }
    ctx.drawImage(img, 0, 0, layer.w, layer.h);
  };

  P._paintPath = function (ctx, layer) {
    var pts = layer.points || [];
    if (!pts.length) return;
    var width = layer.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = layer.color || '#17131F';
    ctx.fillStyle = ctx.strokeStyle;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if ((layer.mode || 'pen') === 'pen') {
      var samples = smoothSamples(pts, layer.smoothing == null ? 0.55 : layer.smoothing);
      for (var i = 1; i < samples.length; i++) {
        var pr = ((samples[i - 1][2] == null ? 0.5 : samples[i - 1][2]) + (samples[i][2] == null ? 0.5 : samples[i][2])) / 2;
        ctx.lineWidth = Math.max(0.5, width * (0.3 + 0.7 * clamp(pr, 0, 1)));
        ctx.beginPath();
        ctx.moveTo(samples[i - 1][0], samples[i - 1][1]);
        ctx.lineTo(samples[i][0], samples[i][1]);
        ctx.stroke();
      }
      return;
    }
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if ((layer.smoothing || 0) > 0.05 && pts.length > 2) {
      for (var q = 1; q < pts.length - 1; q++) {
        var mx = (pts[q][0] + pts[q + 1][0]) / 2;
        var my = (pts[q][1] + pts[q + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[q][0], pts[q][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    } else {
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
    }
    ctx.stroke();
  };

  P.hitTest = function (x, y) {
    var layers = this._doc.layers;
    for (var i = layers.length - 1; i >= 0; i--) {
      var layer = layers[i];
      if (layer.type === 'group' || layer.type === 'adjust' || layer.visible === false || this._hidden(layer) || this._locked(layer)) continue;
      if (this._hits(layer, x, y)) return layer.id;
    }
    for (var g = layers.length - 1; g >= 0; g--) {
      var group = layers[g];
      if (group.type !== 'group' || group.visible === false || group.locked) continue;
      if (x >= group.x && y >= group.y && x <= group.x + group.w && y <= group.y + group.h) return group.id;
    }
    return null;
  };
  P._hits = function (layer, x, y) {
    if (layer.type === 'path') return this._hitPath(layer, x, y);
    var local = worldToLocal(layer, x, y);
    var slop = (layer.type === 'shape' && (layer.shape === 'line' || layer.shape === 'arrow')) ? 10 : 0;
    return local.x >= -slop && local.y >= -slop && local.x <= layer.w + slop && local.y <= layer.h + slop;
  };
  P._hitPath = function (layer, x, y) {
    var local = worldToLocal(layer, x, y);
    var pts = layer.points || [];
    var reach = (layer.width || 4) / 2 + 8;
    if (pts.length === 1) {
      var dx = local.x - pts[0][0], dy = local.y - pts[0][1];
      return dx * dx + dy * dy <= reach * reach;
    }
    for (var i = 1; i < pts.length; i++) {
      if (distToSeg(local.x, local.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reach) return true;
    }
    return false;
  };

  function distToSeg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = dx * dx + dy * dy || 1;
    var t = clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1);
    var x = x1 + t * dx, y = y1 + t * dy;
    return Math.hypot(px - x, py - y);
  }

  P._docToCss = function (x, y) {
    return { x: x * this._zoom + this._panX, y: y * this._zoom + this._panY };
  };
  P._cssToDoc = function (x, y) {
    return { x: (x - this._panX) / this._zoom, y: (y - this._panY) / this._zoom };
  };
  P._localFromEvent = function (e) {
    var r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  P._rectToScreen = function (box) {
    if (!box) return null;
    var r = this.el.getBoundingClientRect();
    var p = this._docToCss(box.x, box.y);
    var q = this._docToCss(box.x + box.w, box.y + box.h);
    return {
      x: r.left + p.x,
      y: r.top + p.y,
      left: r.left + p.x,
      top: r.top + p.y,
      width: q.x - p.x,
      height: q.y - p.y,
      right: r.left + q.x,
      bottom: r.top + q.y
    };
  };
  P.screenRect = function (id) {
    var layer = this._find(id);
    if (!layer) return null;
    if (layer.type === 'group') return this._rectToScreen({ x: layer.x, y: layer.y, w: layer.w, h: layer.h });
    return this._rectToScreen(layerAabb(layer));
  };
  P._selectionRect = function () {
    if (!this._sel.length) return null;
    if (this._sel.length === 1) return this.screenRect(this._sel[0]);
    return this._rectToScreen(this._union(this._sel));
  };

  P.zoom = function () { return this._zoom; };
  P._zoomAt = function (z, cssX, cssY) {
    z = clamp(z, 0.05, 8);
    var doc = this._cssToDoc(cssX, cssY);
    this._zoom = z;
    this._panX = cssX - doc.x * z;
    this._panY = cssY - doc.y * z;
    this._mark();
    this._layout();
    this._emit('zoom', { zoom: this._zoom, panX: this._panX, panY: this._panY });
    if (this._sel.length) this._emitSelect();
  };
  P.zoomTo = function (z) {
    this._zoomAt(z, this.el.clientWidth / 2, this.el.clientHeight / 2);
  };
  P.fit = function () {
    var cw = this.el.clientWidth, ch = this.el.clientHeight;
    if (cw < 8 || ch < 8) return;
    var pad = Math.max(16, Math.min(48, cw * 0.04));
    var z = Math.min((cw - pad * 2) / this._doc.width, (ch - pad * 2) / this._doc.height);
    z = clamp(z, 0.05, 8);
    this._zoom = z;
    this._panX = (cw - this._doc.width * z) / 2;
    this._panY = (ch - this._doc.height * z) / 2;
    this._mark();
    this._layout();
    this._emit('zoom', { zoom: this._zoom, panX: this._panX, panY: this._panY });
  };

  P._place = function (el, layer) {
    var c = this._docToCss(layer.x + layer.w / 2, layer.y + layer.h / 2);
    var w = layer.w * this._zoom, h = layer.h * this._zoom;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = (c.x - w / 2) + 'px';
    el.style.top = (c.y - h / 2) + 'px';
    el.style.transform = 'rotate(' + (layer.rotation || 0) + 'deg)';
  };
  P._placeRect = function (el, box) {
    var p = this._docToCss(box.x, box.y);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.style.width = (box.w * this._zoom) + 'px';
    el.style.height = (box.h * this._zoom) + 'px';
    el.style.transform = 'none';
  };
  P._layout = function () {
    if (this._dead) return;
    var showSel = this._tool === 'select' && this._sel.length && !this._crop;
    this._selEl.classList.toggle('is-on', !!showSel);
    if (showSel) {
      if (this._sel.length === 1) {
        var only = this._find(this._sel[0]);
        if (only && only.type !== 'group') this._place(this._selEl, only);
        else if (only) this._placeRect(this._selEl, { x: only.x, y: only.y, w: only.w, h: only.h });
      } else this._placeRect(this._selEl, this._union(this._sel));
      this._cursors();
      this._fitHandles();
    }
    var hover = this._hover && this._find(this._hover);
    var showHover = hover && this._sel.indexOf(this._hover) < 0 && this._sel.indexOf(this._topGroup(this._hover)) < 0;
    this._hoverEl.classList.toggle('is-on', !!showHover);
    if (showHover) {
      if (hover.type === 'group') this._placeRect(this._hoverEl, { x: hover.x, y: hover.y, w: hover.w, h: hover.h });
      else this._place(this._hoverEl, hover);
    }
    this._cropEl.classList.toggle('is-on', !!this._crop);
    if (this._crop) {
      var target = this._find(this._crop.id);
      if (target) this._place(this._cropEl, target);
    }
    if (this._editing) this._placeEditor();
    this._paintGuides();
  };
  /* Handles fit the object: edge handles only where there is room (so the middle of a small heading stays draggable), corner
     hit areas move outward on tiny objects, and the rotate knob flips below (or inside) when the top of the view would clip it. */
  P._fitHandles = function () {
    var el = this._selEl;
    var w = parseFloat(el.style.width) || el.offsetWidth, hh = parseFloat(el.style.height) || el.offsetHeight;
    var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var room = touch ? 104 : 44;
    el.classList.toggle('no-ns', hh < room || w < room * 0.75);
    el.classList.toggle('no-ew', w < room || hh < room * 0.4);
    el.classList.toggle('is-tiny', w < (touch ? 64 : 24) || hh < (touch ? 64 : 24));
    var top = parseFloat(el.style.top) || 0, vh = this.el.clientHeight;
    var need = touch ? 62 : 44;
    el.classList.toggle('rot-below', top < need && top + hh + need <= vh);
    el.classList.toggle('rot-inside', top < need && top + hh + need > vh);
  };
  P._cursors = function () {
    var rot = 0;
    if (this._sel.length === 1) {
      var l = this._find(this._sel[0]);
      if (l && l.type !== 'group') rot = l.rotation || 0;
    }
    var nodes = this._selEl.querySelectorAll('.le-h');
    for (var i = 0; i < nodes.length; i++) {
      var h = nodes[i].getAttribute('data-h');
      nodes[i].style.cursor = cursorFor(h, rot);
    }
  };
  function cursorFor(handle, rot) {
    if (handle === 'rotate') return 'grab';
    var base = { n: 0, ne: 45, e: 90, se: 135, s: 0, sw: 45, w: 90, nw: 135 }[handle];
    if (base == null) return 'default';
    var a = ((base + rot) % 180 + 180) % 180;
    var options = [{ c: 'ns-resize', a: 0 }, { c: 'nesw-resize', a: 45 }, { c: 'ew-resize', a: 90 }, { c: 'nwse-resize', a: 135 }];
    var best = options[0], bd = 999;
    options.forEach(function (o) {
      var d = Math.min(Math.abs(o.a - a), 180 - Math.abs(o.a - a));
      if (d < bd) { bd = d; best = o; }
    });
    return best.c;
  }
  P._paintGuides = function () {
    var svg = this._guidesEl;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var self = this;
    this._guides.forEach(function (ln) {
      var a = self._docToCss(ln.x1, ln.y1);
      var b = self._docToCss(ln.x2, ln.y2);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      svg.appendChild(line);
    });
  };
  P._setHover = function (id) {
    if (this._hover === id) return;
    this._hover = id;
    this._layout();
    this._emit('hover', { id: id, rect: id ? this.screenRect(id) : null });
  };

  P._handle = function (node) {
    while (node && node !== this.el) {
      if (node.getAttribute && node.getAttribute('data-h')) return node.getAttribute('data-h');
      node = node.parentNode;
    }
    return '';
  };

  P._down = function (e) {
    if (this._dead) return;
    if (e.button != null && e.button !== 0) return;
    if (this._editor && this._editing && (e.target === this._editor || this._editor.contains(e.target))) return;
    if (e.preventDefault) e.preventDefault();
    this.el.focus({ preventScroll: true });
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    this._pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(this._pointers);
    if (ids.length >= 2) {
      this._beginPinch();
      return;
    }
    var local = this._localFromEvent(e);
    var doc = this._cssToDoc(local.x, local.y);
    if (this._space || this._tool === 'hand') {
      this._gesture = { type: 'pan', x: local.x, y: local.y, panX: this._panX, panY: this._panY };
      this.el.classList.add('is-panning');
      return;
    }
    if (this._crop) {
      var ch = this._handle(e.target);
      if (this._crop.pan) {
        /* Photo slot: the frame stays, the photo pans inside it. A tap outside the cell ends crop. */
        var cl = this._find(this._crop.id);
        if (cl && this._hits(cl, doc.x, doc.y)) { this._gesture = { type: 'croppan', last: doc }; return; }
        this._applyCrop();
        return;
      }
      if (ch && ch !== 'rotate') {
        var cur = this._cropLocal();
        this._gesture = { type: 'crop', handle: ch, start: cur, anchor: this._toFullLocal(doc.x, doc.y) };
      }
      return;
    }
    var leaf = this._find(this.hitTest(doc.x, doc.y));
    var now = Date.now();
    var tapped = this._lastTap && leaf && this._lastTap.id === leaf.id && now - this._lastTap.t < 320 && Math.abs(local.x - this._lastTap.x) < 28 && Math.abs(local.y - this._lastTap.y) < 28;
    this._lastTap = { t: now, x: local.x, y: local.y, id: leaf ? leaf.id : null };
    if ((e.detail >= 2 || tapped) && leaf && this._tool === 'select') {
      if (leaf.type === 'text') { this.select([leaf.id]); this._startEdit(leaf); return; }
      if (leaf.type === 'image') { this.select([leaf.id]); this._beginCrop(leaf); return; }
    }
    if (this._tool === 'pen' || this._tool === 'marker' || this._tool === 'highlighter') {
      this._beginPath(doc, e);
      return;
    }
    if (this._tool === 'eraser') {
      this._before('pointer');
      this._gesture = { type: 'erase', last: doc, ids: {} };
      this._erase(doc, doc);
      return;
    }
    if (this._tool.indexOf('shape:') === 0) {
      this._beginShape(doc, this._tool.slice(6));
      return;
    }
    if (this._tool === 'text') {
      this._placeText(doc);
      return;
    }
    var handle = this._handle(e.target);
    if (handle && this._sel.length && this._tool === 'select') {
      this._beginTransform(handle, doc);
      return;
    }
    var additive = e.shiftKey || e.ctrlKey || e.metaKey;
    var sid = leaf ? this._topGroup(leaf.id) : null;
    if (!sid) {
      this._gesture = {
        type: 'marquee',
        x0: doc.x, y0: doc.y, x1: doc.x, y1: doc.y,
        additive: additive,
        base: additive ? this._sel.slice() : [],
        fine: e.pointerType !== 'touch'
      };
      return;
    }
    this._gesture = {
      type: 'pending',
      sid: sid,
      leaf: leaf.id,
      additive: additive,
      pointerType: e.pointerType || 'mouse',
      startSel: this._sel.slice(),
      doc: doc,
      local: local,
      moved: false
    };
    var self = this;
    var coarse = e.pointerType === 'touch' || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (coarse) {
      this._longTimer = setTimeout(function () {
        if (!self._gesture || self._gesture.type !== 'pending' || self._gesture.moved) return;
        var set = self._gesture.startSel.slice();
        if (set.indexOf(sid) < 0) set.push(sid);
        self._gesture.long = true;
        self.select(set);
      }, 480);
    }
  };

  P._move = function (e) {
    if (this._dead) return;
    if (this._pointers[e.pointerId]) this._pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (Object.keys(this._pointers).length >= 2 && this._gesture && this._gesture.type === 'pinch') {
      this._applyPinch();
      return;
    }
    if (Object.keys(this._pointers).length >= 2 && this._gesture && this._gesture.type === 'croppinch') {
      this._applyCropPinch();
      return;
    }
    var local = this._localFromEvent(e);
    var doc = this._cssToDoc(local.x, local.y);
    var g = this._gesture;
    if (!g) {
      if (this._tool === 'select' && !this._crop) this._setHover(this.hitTest(doc.x, doc.y));
      return;
    }
    if (g.type === 'pending') {
      var dist = Math.hypot(local.x - g.local.x, local.y - g.local.y);
      if (dist < (g.pointerType === 'touch' ? 8 : 3)) return;
      g.moved = true;
      if (this._longTimer) { clearTimeout(this._longTimer); this._longTimer = 0; }
      if (!g.long && !g.additive && this._sel.indexOf(g.sid) < 0) this.select([g.sid]);
      else if (g.additive && this._sel.indexOf(g.sid) < 0) this.select(this._sel.concat([g.sid]));
      this._beginMove(g.doc);
      g = this._gesture;
    }
    if (g.type === 'pan') {
      this._panX = g.panX + (local.x - g.x);
      this._panY = g.panY + (local.y - g.y);
      this._mark();
      this._layout();
      this._emit('zoom', { zoom: this._zoom, panX: this._panX, panY: this._panY });
      return;
    }
    if (g.type === 'marquee') {
      if (!g.fine && e.pointerType === 'touch') {
        this._gesture = { type: 'pan', x: local.x, y: local.y, panX: this._panX, panY: this._panY };
        this.el.classList.add('is-panning');
        return;
      }
      g.x1 = doc.x; g.y1 = doc.y;
      var box = normBox(g.x0, g.y0, g.x1, g.y1);
      this._placeRect(this._marqueeEl, box);
      this._marqueeEl.classList.add('is-on');
      var hits = this._marqueeHits(box);
      var next = g.base.slice();
      hits.forEach(function (id) { if (next.indexOf(id) < 0) next.push(id); });
      this.select(next);
      return;
    }
    if (g.type === 'move') this._applyMove(doc);
    else if (g.type === 'resize') this._applyResize(doc, e);
    else if (g.type === 'rotate') this._applyRotate(doc, e);
    else if (g.type === 'path') this._extendPath(doc, e);
    else if (g.type === 'erase') { this._erase(g.last, doc); g.last = doc; }
    else if (g.type === 'shape') this._updateShape(doc);
    else if (g.type === 'crop') this._applyCropDrag(doc);
    else if (g.type === 'croppan') this._applyCropPan(doc);
  };

  P._up = function (e) {
    if (this._pointers[e.pointerId]) delete this._pointers[e.pointerId];
    if (this._longTimer) { clearTimeout(this._longTimer); this._longTimer = 0; }
    var g = this._gesture;
    if (!g) return;
    if (Object.keys(this._pointers).length >= 1 && g.type === 'pinch') return;
    if (g.type === 'pending' && !g.moved && !g.long) {
      if (g.additive) {
        var set = this._sel.slice();
        var i = set.indexOf(g.sid);
        if (i >= 0) set.splice(i, 1); else set.push(g.sid);
        this.select(set);
      } else this.select([g.sid]);
    }
    if (g.type === 'marquee') {
      this._marqueeEl.classList.remove('is-on');
      var box = normBox(g.x0, g.y0, g.x1, g.y1);
      if (box.w < 3 && box.h < 3 && !g.additive) this.select(g.base);
    }
    if (g.type === 'path') this._finishPath();
    if (g.type === 'shape') this._finishShape();
    if (g.type === 'erase') this._finishErase();
    if (g.type === 'move' && g.swap) this._finishSlotSwap(g);
    this._guides = [];
    this._tidySelection();
    this._endHist();
    this._lastSnap = this._snapshot();
    this._gesture = null;
    this.el.classList.remove('is-panning');
    this._layout();
    if (g.type === 'move' || g.type === 'resize' || g.type === 'rotate') this._emitSelect();
  };

  P._double = function (e) {
    if (this._tool !== 'select' || this._crop) return;
    var local = this._localFromEvent(e);
    var doc = this._cssToDoc(local.x, local.y);
    var leaf = this._find(this.hitTest(doc.x, doc.y));
    if (!leaf) return;
    if (leaf.type === 'text') { this.select([leaf.id]); this._startEdit(leaf); }
    else if (leaf.type === 'image') { this.select([leaf.id]); this._beginCrop(leaf); }
  };

  P._beginPinch = function () {
    var ids = Object.keys(this._pointers);
    if (ids.length < 2) return;
    var a = this._pointers[ids[0]], b = this._pointers[ids[1]];
    var rect = this.el.getBoundingClientRect();
    var mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    var held = this._crop && this._crop.pan ? this._find(this._crop.id) : null;
    if (held) {
      this._gesture = { type: 'croppinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, crop: clone(held.crop), at: this._cssToDoc(mid.x, mid.y) };
      return;
    }
    this._gesture = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: this._zoom,
      doc: this._cssToDoc(mid.x, mid.y)
    };
  };
  P._applyPinch = function () {
    var ids = Object.keys(this._pointers);
    if (ids.length < 2 || !this._gesture) return;
    var a = this._pointers[ids[0]], b = this._pointers[ids[1]];
    var rect = this.el.getBoundingClientRect();
    var mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    var z = clamp(this._gesture.zoom * (dist / this._gesture.dist), 0.05, 8);
    this._zoom = z;
    this._panX = mid.x - this._gesture.doc.x * z;
    this._panY = mid.y - this._gesture.doc.y * z;
    this._mark();
    this._layout();
    this._emit('zoom', { zoom: z, panX: this._panX, panY: this._panY });
  };

  P._wheel = function (e) {
    if (this._dead) return;
    e.preventDefault();
    var local = this._localFromEvent(e);
    var dy = e.deltaY, dx = e.deltaX;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    if (e.deltaMode === 2) { dx *= this.el.clientWidth; dy *= this.el.clientHeight; }
    if (this._crop && this._crop.pan) {
      var held = this._find(this._crop.id);
      if (held) this._zoomSlotCrop(held, held.crop, Math.exp(-dy * 0.002), this._cssToDoc(local.x, local.y));
      return;
    }
    if (e.ctrlKey || e.metaKey) this._zoomAt(this._zoom * Math.exp(-dy * 0.0015), local.x, local.y);
    else {
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      this._panX -= dx;
      this._panY -= dy;
      this._mark();
      this._layout();
      this._emit('zoom', { zoom: this._zoom, panX: this._panX, panY: this._panY });
    }
  };

  P._beginMove = function (anchor) {
    var roots = this._roots(this._sel).map(this._find, this).filter(function (l) { return l && !l.locked; });
    if (!roots.length) { this._gesture = { type: 'noop' }; return; }
    var starts = {};
    var self = this;
    roots.forEach(function (l) { starts[l.id] = { x: l.x, y: l.y }; });
    this._gesture = {
      type: 'move',
      anchor: anchor,
      starts: starts,
      bounds: this._union(Object.keys(starts)),
      roots: Object.keys(starts)
    };
    this._before('pointer');
  };
  P._applyMove = function (doc) {
    var g = this._gesture;
    var dx = doc.x - g.anchor.x;
    var dy = doc.y - g.anchor.y;
    var proposed = { x: g.bounds.x + dx, y: g.bounds.y + dy, w: g.bounds.w, h: g.bounds.h };
    var snapped = this._snapRect(proposed, g.roots);
    var sdx = snapped.x - g.bounds.x;
    var sdy = snapped.y - g.bounds.y;
    var self = this;
    g.roots.forEach(function (id) {
      var l = self._find(id);
      var s = g.starts[id];
      if (!l || !s) return;
      var ddx = (s.x + sdx) - l.x;
      var ddy = (s.y + sdy) - l.y;
      self._shiftTree(l, ddx, ddy);
    });
    this._guides = snapped.guides;
    this._after();
    this._slotDropCheck(doc);
  };

  P._snapRect = function (box, ignore) {
    var skip = {};
    var self = this;
    (ignore || []).forEach(function (id) {
      skip[id] = 1;
      var l = self._find(id);
      if (l && l.type === 'group') self._descendants(id, []).forEach(function (m) { skip[m.id] = 1; });
    });
    var thresh = 6 / this._zoom;
    var bestX = thresh, bestY = thresh, dx = 0, dy = 0;
    var gx = [], gy = [];
    function takeX(delta, guide) {
      var a = Math.abs(delta);
      if (a <= bestX + 0.01) {
        if (a < bestX - 0.01) { bestX = a; dx = delta; gx = [guide]; }
        else gx.push(guide);
      }
    }
    function takeY(delta, guide) {
      var a = Math.abs(delta);
      if (a <= bestY + 0.01) {
        if (a < bestY - 0.01) { bestY = a; dy = delta; gy = [guide]; }
        else gy.push(guide);
      }
    }
    var page = [
      { x: 0 }, { x: this._doc.width / 2, center: true }, { x: this._doc.width },
      { y: 0 }, { y: this._doc.height / 2, center: true }, { y: this._doc.height }
    ];
    takeX(0 - box.x, { x: 0 });
    takeX(this._doc.width - (box.x + box.w), { x: this._doc.width });
    takeX(this._doc.width / 2 - (box.x + box.w / 2), { x: this._doc.width / 2 });
    takeY(0 - box.y, { y: 0 });
    takeY(this._doc.height - (box.y + box.h), { y: this._doc.height });
    takeY(this._doc.height / 2 - (box.y + box.h / 2), { y: this._doc.height / 2 });
    var others = [];
    this._doc.layers.forEach(function (l) {
      if (skip[l.id] || l.type === 'group' || l.visible === false) return;
      var b = layerAabb(l);
      others.push(b);
      takeX(b.x - box.x, { x: b.x });
      takeX((b.x + b.w) - (box.x + box.w), { x: b.x + b.w });
      takeX((b.x + b.w / 2) - (box.x + box.w / 2), { x: b.x + b.w / 2 });
      takeX(b.x - (box.x + box.w), { x: b.x });
      takeX((b.x + b.w) - box.x, { x: b.x + b.w });
      takeY(b.y - box.y, { y: b.y });
      takeY((b.y + b.h) - (box.y + box.h), { y: b.y + b.h });
      takeY((b.y + b.h / 2) - (box.y + box.h / 2), { y: b.y + b.h / 2 });
      takeY(b.y - (box.y + box.h), { y: b.y });
      takeY((b.y + b.h) - box.y, { y: b.y + b.h });
    });
    var moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    if (bestX >= thresh - 0.001) this._snapSpacing(moved, others, 'x', thresh, takeX);
    if (bestY >= thresh - 0.001) this._snapSpacing(moved, others, 'y', thresh, takeY);
    var guides = [];
    gx.forEach(function (g) {
      guides.push({ x1: g.x, y1: 0, x2: g.x, y2: self._doc.height });
    });
    gy.forEach(function (g) {
      guides.push({ x1: 0, y1: g.y, x2: self._doc.width, y2: g.y });
    });
    return { x: box.x + dx, y: box.y + dy, guides: guides };
  };
  P._snapSpacing = function (box, others, axis, thresh, take) {
    var horiz = axis === 'x';
    var list = others.slice().sort(function (a, b) { return horiz ? a.x - b.x : a.y - b.y; });
    var before = list.filter(function (o) {
      return horiz ? (o.x + o.w) <= box.x + thresh : (o.y + o.h) <= box.y + thresh;
    });
    var after = list.filter(function (o) {
      return horiz ? o.x >= box.x + box.w - thresh : o.y >= box.y + box.h - thresh;
    });
    if (!before.length || !after.length) return;
    var L = before[before.length - 1], R = after[0];
    var target = horiz
      ? ((L.x + L.w) + R.x - box.w) / 2
      : ((L.y + L.h) + R.y - box.h) / 2;
    var delta = target - (horiz ? box.x : box.y);
    if (Math.abs(delta) > thresh) return;
    take(delta, horiz ? { x: L.x + L.w } : { y: L.y + L.h });
  };

  P._beginTransform = function (handle, doc) {
    var self = this;
    var roots = this._roots(this._sel).map(function (id) { return self._find(id); }).filter(function (l) { return l && !l.locked; });
    if (!roots.length) return;
    var single = roots.length === 1 && roots[0].type !== 'group' ? roots[0] : null;
    if (handle === 'rotate') {
      var b = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : this._union(roots.map(function (l) { return l.id; }));
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      var angle = Math.atan2(doc.y - cy, doc.x - cx);
      var starts = {};
      var affected = [];
      roots.forEach(function (l) {
        affected.push(l);
        if (l.type === 'group') self._descendants(l.id, affected);
      });
      affected.forEach(function (l) {
        starts[l.id] = { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation || 0 };
      });
      this._gesture = { type: 'rotate', cx: cx, cy: cy, angle: angle, starts: starts, single: single && single.id };
      this._before('pointer');
      return;
    }
    if (single) {
      this._gesture = {
        type: 'resize',
        mode: 'local',
        handle: handle,
        anchor: doc,
        id: single.id,
        start: JSON.parse(JSON.stringify(single))
      };
    } else {
      var box = this._union(roots.map(function (l) { return l.id; }));
      var starts2 = {};
      var all = [];
      roots.forEach(function (l) {
        all.push(l);
        if (l.type === 'group') self._descendants(l.id, all);
      });
      all.forEach(function (l) {
        starts2[l.id] = JSON.parse(JSON.stringify(l));
      });
      this._gesture = { type: 'resize', mode: 'box', handle: handle, anchor: doc, box: box, starts: starts2 };
    }
    this._before('pointer');
  };

  P._applyResize = function (doc, e) {
    var g = this._gesture;
    var dx = doc.x - g.anchor.x;
    var dy = doc.y - g.anchor.y;
    if (g.mode === 'local') {
      var start = g.start;
      var lock = this._aspectLock(start, e);
      var next = resizeLocal(start, g.handle, dx, dy, lock);
      var layer = this._find(g.id);
      if (!layer) return;
      layer.x = next.x; layer.y = next.y; layer.w = next.w; layer.h = next.h;
      if (layer.type === 'text' && (g.handle.indexOf('n') >= 0 || g.handle.indexOf('s') >= 0)) {
        layer.size = Math.max(4, start.size * (next.h / start.h));
      }
      if (layer.type === 'path' && start.points) {
        var sx = next.w / start.w, sy = next.h / start.h;
        layer.points = start.points.map(function (p) { return [p[0] * sx, p[1] * sy, p[2]]; });
        layer.width = start.width * ((Math.abs(sx) + Math.abs(sy)) / 2);
      }
      if (layer.groupId) this._syncGroup(layer.groupId);
      this._after();
      return;
    }
    var box = g.box;
    var left = box.x, right = box.x + box.w, top = box.y, bottom = box.y + box.h;
    if (g.handle.indexOf('e') >= 0) right += dx;
    if (g.handle.indexOf('w') >= 0) left += dx;
    if (g.handle.indexOf('s') >= 0) bottom += dy;
    if (g.handle.indexOf('n') >= 0) top += dy;
    if (right < left + 8) { if (g.handle.indexOf('e') >= 0) right = left + 8; else left = right - 8; }
    if (bottom < top + 8) { if (g.handle.indexOf('s') >= 0) bottom = top + 8; else top = bottom - 8; }
    var sx = (right - left) / box.w;
    var sy = (bottom - top) / box.h;
    var corner = g.handle.length === 2;
    var lockBox = this._boxLock(g.starts, e);
    if (lockBox && corner) {
      if (Math.abs(sx - 1) >= Math.abs(sy - 1)) sy = sx;
      else sx = sy;
    }
    if (g.handle.indexOf('e') < 0 && g.handle.indexOf('w') < 0) sx = 1;
    if (g.handle.indexOf('n') < 0 && g.handle.indexOf('s') < 0) sy = 1;
    var ox = g.handle.indexOf('w') >= 0 ? box.x + box.w : box.x;
    var oy = g.handle.indexOf('n') >= 0 ? box.y + box.h : box.y;
    var self = this;
    Object.keys(g.starts).forEach(function (id) {
      var s = g.starts[id];
      var l = self._find(id);
      if (!l) return;
      l.x = ox + (s.x - ox) * sx;
      l.y = oy + (s.y - oy) * sy;
      l.w = Math.max(1, s.w * Math.abs(sx));
      l.h = Math.max(1, s.h * Math.abs(sy));
      if (l.type === 'text' && sy !== 1) l.size = Math.max(4, s.size * Math.abs(sy));
      if (l.type === 'path' && s.points) {
        l.points = s.points.map(function (p) { return [p[0] * sx, p[1] * sy, p[2]]; });
        l.width = s.width * ((Math.abs(sx) + Math.abs(sy)) / 2);
      }
    });
    this._after();
  };
  P._aspectLock = function (layer, e) {
    var kind = layer.type === 'image' || layer.type === 'svg';
    if (kind) return !(e && e.shiftKey);
    return !!(e && e.shiftKey);
  };
  P._boxLock = function (starts, e) {
    var ids = Object.keys(starts);
    var kind = true;
    for (var i = 0; i < ids.length; i++) {
      var t = starts[ids[i]].type;
      if (t !== 'image' && t !== 'svg' && t !== 'group') kind = false;
    }
    if (kind) return !(e && e.shiftKey);
    return !!(e && e.shiftKey);
  };
  P._applyRotate = function (doc, e) {
    var g = this._gesture;
    var angle = Math.atan2(doc.y - g.cy, doc.x - g.cx);
    var delta = (angle - g.angle) * 180 / Math.PI;
    if (e && e.shiftKey) delta = Math.round(delta / 15) * 15;
    else {
      var base = g.single && g.starts[g.single] ? g.starts[g.single].rotation : 0;
      var abs = base + delta;
      var snapped = Math.round(abs / 15) * 15;
      if (Math.abs(snapped - abs) <= 3.5) delta = snapped - base;
    }
    var rad = delta * Math.PI / 180;
    var c = Math.cos(rad), s = Math.sin(rad);
    var self = this;
    Object.keys(g.starts).forEach(function (id) {
      var st = g.starts[id];
      var l = self._find(id);
      if (!l) return;
      if (g.single && id === g.single) {
        l.rotation = st.rotation + delta;
        return;
      }
      var cx = st.x + st.w / 2, cy = st.y + st.h / 2;
      var dx = cx - g.cx, dy = cy - g.cy;
      var nx = g.cx + dx * c - dy * s;
      var ny = g.cy + dx * s + dy * c;
      l.x = nx - st.w / 2;
      l.y = ny - st.h / 2;
      l.rotation = st.rotation + delta;
    });
    if (!g.single) {
      Object.keys(g.starts).forEach(function (id) {
        var l = self._find(id);
        if (l && l.type === 'group') self._syncGroup(l.id);
      });
    }
    this._after();
  };

  P._tidySelection = function () {
    var self = this;
    this._sel.forEach(function (id) {
      var l = self._find(id);
      if (!l) return;
      l.x = round3(l.x); l.y = round3(l.y); l.w = round3(l.w); l.h = round3(l.h);
      l.rotation = round3(l.rotation || 0);
    });
  };

  P._beginPath = function (doc, e) {
    var mode = this._tool;
    var spec = {
      pen: { width: 4, color: '#17131F', smoothing: 0.55, blend: 'source-over', opacity: 1 },
      marker: { width: 16, color: '#1B1722', smoothing: 0.7, blend: 'source-over', opacity: 0.92 },
      highlighter: { width: 28, color: '#FFE56A', smoothing: 0.45, blend: 'multiply', opacity: 0.7 }
    }[mode];
    this._before('pointer');
    var layer = this._insert({
      type: 'path',
      mode: mode,
      x: doc.x, y: doc.y, w: 1, h: 1,
      points: [],
      width: spec.width,
      color: spec.color,
      smoothing: spec.smoothing,
      blend: spec.blend,
      opacity: spec.opacity,
      name: mode === 'highlighter' ? 'Highlight' : mode === 'marker' ? 'Marker' : 'Pen'
    });
    this._gesture = { type: 'path', id: layer.id, docs: [] };
    this._extendPath(doc, e);
    this.select([layer.id]);
  };
  P._extendPath = function (doc, e) {
    var g = this._gesture;
    var pressure = e && e.pressure ? e.pressure : 0.5;
    if (!pressure && e && e.pointerType === 'mouse') pressure = 0.5;
    if (e && e.pointerType === 'mouse') pressure = 0.55;
    g.docs.push([doc.x, doc.y, clamp(pressure || 0.5, 0.05, 1)]);
    var layer = this._find(g.id);
    if (!layer) return;
    bakePath(layer, g.docs);
    this._after();
  };
  P._finishPath = function () {
    var g = this._gesture;
    var layer = g && this._find(g.id);
    if (layer && (!layer.points || layer.points.length === 0)) this._removeIds([layer.id]);
  };
  function bakePath(layer, docs) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    docs.forEach(function (p) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    });
    var pad = (layer.width || 4) + 2;
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    layer.x = minX - pad;
    layer.y = minY - pad;
    layer.w = Math.max(8, maxX - minX + pad * 2);
    layer.h = Math.max(8, maxY - minY + pad * 2);
    layer.points = docs.map(function (p) { return [p[0] - layer.x, p[1] - layer.y, p[2]]; });
  }

  P._erase = function (a, b) {
    var self = this;
    var rad = 16 / this._zoom;
    this._doc.layers.forEach(function (layer) {
      if (layer.type !== 'path' || layer.locked || layer.visible === false) return;
      var pts = layer.points || [];
      for (var i = 0; i < pts.length; i++) {
        var w = localToWorld(layer, pts[i][0], pts[i][1]);
        if (distToSeg(w.x, w.y, a.x, a.y, b.x, b.y) <= rad + (layer.width || 4) / 2) {
          self._gesture.ids[layer.id] = 1;
          break;
        }
      }
    });
    var gone = this._gesture.ids;
    this._doc.layers.forEach(function (layer) {
      if (gone[layer.id]) layer.visible = false;
    });
    this._mark();
  };
  P._finishErase = function () {
    var ids = this._gesture && this._gesture.ids ? Object.keys(this._gesture.ids) : [];
    var self = this;
    ids.forEach(function (id) {
      var l = self._find(id);
      if (l) l.visible = true;
    });
    if (ids.length) {
      this._removeIds(ids);
      this._after();
    }
  };

  P._beginShape = function (doc, shape) {
    this._before('pointer');
    var layer = this._insert({
      type: 'shape',
      shape: shape || 'rect',
      x: doc.x,
      y: doc.y,
      w: 1,
      h: 1,
      fill: { type: 'solid', color: '#7457F0' },
      stroke: shape === 'line' ? { width: 4, color: '#17131F', cap: 'round' } : null
    });
    this._gesture = { type: 'shape', id: layer.id, x: doc.x, y: doc.y };
    this.select([layer.id]);
  };
  P._updateShape = function (doc) {
    var g = this._gesture;
    var layer = this._find(g.id);
    if (!layer) return;
    layer.x = Math.min(g.x, doc.x);
    layer.y = Math.min(g.y, doc.y);
    layer.w = Math.max(1, Math.abs(doc.x - g.x));
    layer.h = Math.max(1, Math.abs(doc.y - g.y));
    this._after();
  };
  P._finishShape = function () {
    var g = this._gesture;
    var layer = g && this._find(g.id);
    if (!layer) return;
    if (layer.w < 8 && layer.h < 8) {
      layer.w = 180;
      layer.h = layer.shape === 'line' ? 24 : 120;
    }
    this._after();
  };

  P._placeText = function (doc) {
    this._before(null);
    var layer = this._insert({
      type: 'text',
      text: 'Text',
      x: doc.x,
      y: doc.y,
      w: 320,
      h: 72,
      size: 42,
      font: 'Plus Jakarta Sans',
      weight: 700,
      color: '#17131F'
    });
    this._after();
    this.select([layer.id]);
    var self = this;
    setTimeout(function () { if (!self._dead) self._startEdit(layer); }, 0);
  };

  P._startEdit = function (layer) {
    if (!layer || layer.type !== 'text' || layer.locked) return;
    this._editing = layer.id;
    var ed = this._editor;
    ed.hidden = false;
    ed.textContent = layer.text || '';
    this._placeEditor();
    this._emit('edit-text', { id: layer.id, editing: true });
    this._mark();
    var self = this;
    setTimeout(function () {
      if (self._editing !== layer.id) return;
      ed.focus();
      var sel = window.getSelection && window.getSelection();
      if (!sel) return;
      var range = document.createRange();
      range.selectNodeContents(ed);
      sel.removeAllRanges();
      sel.addRange(range);
    }, 0);
  };
  P._placeEditor = function () {
    var layer = this._find(this._editing);
    if (!layer) return;
    this._place(this._editor, layer);
    var ed = this._editor;
    ed.style.fontFamily = fontFamily(layer.font);
    ed.style.fontWeight = String(layer.weight || 400);
    ed.style.fontStyle = layer.italic ? 'italic' : 'normal';
    ed.style.fontSize = (layer.size * this._zoom) + 'px';
    ed.style.lineHeight = String(layer.lineHeight || 1.2);
    ed.style.letterSpacing = ((layer.letterSpacing || 0) * this._zoom) + 'px';
    ed.style.textAlign = layer.align || 'left';
    ed.style.color = layer.color || '#17131F';
    ed.style.textTransform = layer.uppercase ? 'uppercase' : 'none';
    ed.style.textDecoration = (layer.underline ? 'underline ' : '') + (layer.strike ? 'line-through' : '');
  };
  P._onEditInput = function () {
    if (!this._editing) return;
    var layer = this._find(this._editing);
    if (!layer) return;
    var text = this._editor.innerText || '';
    text = text.replace(/\u00a0/g, ' ').replace(/\r/g, '');
    this._before('text:' + layer.id);
    layer.text = text;
    if (this._editor.scrollHeight > layer.h * this._zoom + 1) {
      layer.h = Math.max(layer.h, this._editor.scrollHeight / this._zoom);
      this._placeEditor();
    }
    this._after();
  };
  P._commitEdit = function () {
    if (!this._editing) return;
    var id = this._editing;
    var layer = this._find(id);
    this._editing = null;
    if (layer && this._editor) {
      var text = (this._editor.innerText || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
      if (text !== layer.text) {
        this._before('text:' + id);
        layer.text = text;
        this._after();
      }
    }
    this._endHist();
    this._closeEdit();
    this._emit('edit-text', { id: id, editing: false });
    this._mark();
    this._layout();
  };
  P._closeEdit = function () {
    this._editing = null;
    if (this._editor) {
      this._editor.hidden = true;
      this._editor.textContent = '';
    }
  };

  P._beginCrop = function (layer) {
    if (!layer || layer.type !== 'image') return;
    if (this._crop && this._crop.id === layer.id) return;
    this._commitEdit(true);
    var crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    var fw = layer.w / (crop.w || 1);
    var fh = layer.h / (crop.h || 1);
    var fx = -crop.x * fw;
    var fy = -crop.y * fh;
    var center = localToWorld(layer, fx + fw / 2, fy + fh / 2);
    this._crop = {
      id: layer.id,
      cx: center.x,
      cy: center.y,
      fw: fw,
      fh: fh,
      rot: layer.rotation || 0,
      flipX: !!layer.flipX,
      flipY: !!layer.flipY,
      pan: !!layer.slot,
      snap: this._snapshot()
    };
    this._cropEl.classList.toggle('is-pan', !!layer.slot);
    this._tool = 'crop';
    this.el.setAttribute('data-tool', 'crop');
    this._emit('tool', { tool: 'crop' });
    this._mark();
    this._layout();
  };
  P._toFullLocal = function (wx, wy) {
    var s = this._crop;
    var dx = wx - s.cx, dy = wy - s.cy;
    var r = -(s.rot || 0) * Math.PI / 180;
    var c = Math.cos(r), sn = Math.sin(r);
    var x = dx * c - dy * sn;
    var y = dx * sn + dy * c;
    if (s.flipX) x = -x;
    if (s.flipY) y = -y;
    return { x: x + s.fw / 2, y: y + s.fh / 2 };
  };
  P._fromFullLocal = function (lx, ly) {
    var s = this._crop;
    var x = lx - s.fw / 2, y = ly - s.fh / 2;
    if (s.flipX) x = -x;
    if (s.flipY) y = -y;
    var r = (s.rot || 0) * Math.PI / 180;
    var c = Math.cos(r), sn = Math.sin(r);
    return { x: s.cx + x * c - y * sn, y: s.cy + x * sn + y * c };
  };
  P._cropLocal = function () {
    var layer = this._find(this._crop.id);
    var c = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    return { x: c.x * this._crop.fw, y: c.y * this._crop.fh, w: c.w * this._crop.fw, h: c.h * this._crop.fh };
  };
  P._applyCropDrag = function (doc) {
    var g = this._gesture;
    var s = this._crop;
    var layer = this._find(s.id);
    if (!layer) return;
    var cur = this._toFullLocal(doc.x, doc.y);
    var dx = cur.x - g.anchor.x;
    var dy = cur.y - g.anchor.y;
    var left = g.start.x, right = g.start.x + g.start.w, top = g.start.y, bottom = g.start.y + g.start.h;
    if (g.handle.indexOf('e') >= 0) right += dx;
    if (g.handle.indexOf('w') >= 0) left += dx;
    if (g.handle.indexOf('s') >= 0) bottom += dy;
    if (g.handle.indexOf('n') >= 0) top += dy;
    left = clamp(left, 0, s.fw - 8);
    right = clamp(right, 8, s.fw);
    top = clamp(top, 0, s.fh - 8);
    bottom = clamp(bottom, 8, s.fh);
    if (right < left + 8) { if (g.handle.indexOf('w') >= 0) left = right - 8; else right = left + 8; }
    if (bottom < top + 8) { if (g.handle.indexOf('n') >= 0) top = bottom - 8; else bottom = top + 8; }
    var cl = { x: left, y: top, w: right - left, h: bottom - top };
    var center = this._fromFullLocal(cl.x + cl.w / 2, cl.y + cl.h / 2);
    var self = this;
    this._live(function () {
      layer.w = cl.w;
      layer.h = cl.h;
      layer.x = center.x - cl.w / 2;
      layer.y = center.y - cl.h / 2;
      layer.crop = { x: cl.x / s.fw, y: cl.y / s.fh, w: cl.w / s.fw, h: cl.h / s.fh };
      self._scheduleImage(layer.id);
    });
  };
  P._applyCrop = function () {
    if (!this._crop) return;
    var now = this._snapshot();
    var before = this._crop.snap;
    this._crop = null;
    if (this._tool === 'crop') this._tool = 'select';
    this.el.setAttribute('data-tool', this._tool);
    if (now !== before) {
      this._hist.undo.push(before);
      this._hist.redo = [];
      var cap = this._histCap();
      while (this._hist.undo.length > cap) this._hist.undo.shift();
      this._emit('history', this._histInfo());
    }
    this._endHist();
    this._emit('tool', { tool: this._tool });
    this._mark();
    this._layout();
    this._emitSelect();
  };
  P._cancelCrop = function () {
    if (!this._crop) return;
    var snap = this._crop.snap;
    this._crop = null;
    if (this._tool === 'crop') this._tool = 'select';
    this.el.setAttribute('data-tool', this._tool);
    this._restore(snap, true);
    this._emit('tool', { tool: this._tool });
  };

  /* ---------- Photo slots: pan / zoom inside the cell, drag-to-swap, collage meta ---------- */
  P._assetSize = function (src) {
    var node = src ? assetNode(this._assets[src]) : null;
    if (!node) return null;
    return { w: node.naturalWidth || node.width, h: node.naturalHeight || node.height };
  };
  P._slotCropSet = function (layer, crop) {
    var s = this._crop;
    var self = this;
    this._live(function () {
      layer.crop = crop;
      if (s && s.id === layer.id) {
        s.fw = layer.w / crop.w;
        s.fh = layer.h / crop.h;
        var c = localToWorld(layer, -crop.x * s.fw + s.fw / 2, -crop.y * s.fh + s.fh / 2);
        s.cx = c.x;
        s.cy = c.y;
      }
      self._scheduleImage(layer.id);
    });
    this._layout();
  };
  P._applyCropPan = function (doc) {
    var g = this._gesture;
    var layer = this._find(this._crop.id);
    if (!layer) return;
    var a = worldToLocal(layer, g.last.x, g.last.y);
    var b = worldToLocal(layer, doc.x, doc.y);
    g.last = doc;
    var c = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
    var fw = layer.w / c.w, fh = layer.h / c.h;
    this._slotCropSet(layer, {
      x: clamp(c.x - (b.x - a.x) / fw, 0, 1 - c.w),
      y: clamp(c.y - (b.y - a.y) / fh, 0, 1 - c.h),
      w: c.w, h: c.h
    });
  };
  /* Zooms the photo by factor f from crop `from`, keeping the image point under `doc` still. */
  P._zoomSlotCrop = function (layer, from, f, doc) {
    from = from || { x: 0, y: 0, w: 1, h: 1 };
    f = Math.max(f, Math.max(from.w, from.h));
    f = Math.min(f, Math.min(from.w, from.h) / 0.04);
    var w = from.w / f, h = from.h / f;
    var p = doc ? worldToLocal(layer, doc.x, doc.y) : { x: layer.w / 2, y: layer.h / 2 };
    var u = clamp(p.x / layer.w, 0, 1), v = clamp(p.y / layer.h, 0, 1);
    var ix = from.x + u * from.w, iy = from.y + v * from.h;
    this._slotCropSet(layer, { x: clamp(ix - u * w, 0, 1 - w), y: clamp(iy - v * h, 0, 1 - h), w: w, h: h });
  };
  P._applyCropPinch = function () {
    var ids = Object.keys(this._pointers);
    var g = this._gesture;
    var layer = this._crop && this._find(this._crop.id);
    if (ids.length < 2 || !g || !layer) return;
    var a = this._pointers[ids[0]], b = this._pointers[ids[1]];
    var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this._zoomSlotCrop(layer, g.crop, dist / g.dist, g.at);
  };
  /* Public: zoom the photo inside the slot being cropped (or any slot) by a factor. */
  P.zoomSlot = function (id, f) {
    var layer = this._find(id);
    if (!layer || layer.type !== 'image') return;
    var own = !this._crop || this._crop.id !== id;
    if (own) this._before(null);
    this._zoomSlotCrop(layer, layer.crop, f, null);
    if (own) this._after();
  };
  P._slotAt = function (x, y, skipId) {
    var layers = this._doc.layers;
    for (var i = layers.length - 1; i >= 0; i--) {
      var l = layers[i];
      if (l.id === skipId || l.type !== 'image' || !l.slot || l.visible === false || this._hidden(l) || this._locked(l)) continue;
      if (this._hits(l, x, y)) return l.id;
    }
    return null;
  };
  P._slotDropCheck = function (doc) {
    var g = this._gesture;
    if (!g || g.type !== 'move' || g.roots.length !== 1) return;
    var moving = this._find(g.roots[0]);
    if (!moving || moving.type !== 'image' || !moving.slot) return;
    var target = this._slotAt(doc.x, doc.y, moving.id);
    g.swap = target;
    this._hoverEl.classList.toggle('is-drop', !!target);
    this._hover = target;
    this._layout();
  };
  P._swapPhotos = function (A, B) {
    var sa = this._assetSize(A.src), sb = this._assetSize(B.src);
    var ca = A.crop, cb = B.crop;
    ['src', 'adjust', 'filter', 'removeBg'].forEach(function (k) { var t = A[k]; A[k] = B[k]; B[k] = t; });
    A.crop = A.src && sb ? refitCrop(cb, sb.w, sb.h, A.w, A.h) : { x: 0, y: 0, w: 1, h: 1 };
    B.crop = B.src && sa ? refitCrop(ca, sa.w, sa.h, B.w, B.h) : { x: 0, y: 0, w: 1, h: 1 };
    this._scheduleImage(A.id);
    this._scheduleImage(B.id);
  };
  P._finishSlotSwap = function (g) {
    var A = this._find(g.roots[0]), B = this._find(g.swap);
    this._hoverEl.classList.remove('is-drop');
    this._hover = null;
    if (!A || !B) return;
    var self = this;
    this._live(function () {
      var st = g.starts[A.id];
      if (st) self._shiftTree(A, st.x - A.x, st.y - A.y);
      self._swapPhotos(A, B);
    });
    this._emit('slot-swap', { from: A.id, to: B.id });
  };
  /* Public: swap the photos of two slot layers (frames, masks and borders stay). One undo step. */
  P.swapSlots = function (a, b) {
    var A = this._find(a), B = this._find(b);
    if (!A || !B || A.type !== 'image' || B.type !== 'image' || a === b) return false;
    this._before(null);
    this._swapPhotos(A, B);
    this._after();
    return true;
  };
  P.collage = function () { return this._doc.collage ? clone(this._doc.collage) : null; };
  P.setCollage = function (meta, opts) {
    var key = opts && opts.coalesce ? String(opts.coalesce) : null;
    this._before(key);
    var m = collageOf(meta);
    if (m) this._doc.collage = m; else delete this._doc.collage;
    this._after();
  };

  P._marqueeHits = function (box) {
    var ids = [];
    var self = this;
    this._doc.layers.forEach(function (layer) {
      if (layer.type === 'group' || layer.visible === false || self._locked(layer)) return;
      var b = layerAabb(layer);
      if (b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y) {
        var id = self._topGroup(layer.id);
        if (ids.indexOf(id) < 0) ids.push(id);
      }
    });
    return ids;
  };

  function normBox(x0, y0, x1, y1) {
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }

  P._key = function (e, up) {
    if (this._dead) return;
    var t = e.target;
    if (t && t !== window && t !== document && t !== document.body && t !== document.documentElement && t !== this.el && t !== this._editor && !(this.el && this.el.contains(t))) return;
    var tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (t && t.isContentEditable && t !== this._editor) return;
    var inEditor = !!(this._editing && t === this._editor);
    if (up) {
      if (e.code === 'Space') {
        this._space = false;
        this.el.classList.remove('is-space');
      }
      if (!inEditor && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) this._endHist();
      return;
    }
    if (e.code === 'Space' && !inEditor) {
      this._space = true;
      this.el.classList.add('is-space');
      e.preventDefault();
      return;
    }
    if (inEditor) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._commitEdit(true);
        this.el.focus();
      }
      var modEdit = e.ctrlKey || e.metaKey;
      if (!(modEdit && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y'))) return;
    }
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;
    if (key === 'Escape') {
      e.preventDefault();
      if (this._crop) this._cancelCrop();
      else if (this._editing) this._commitEdit(true);
      else this.select([]);
      return;
    }
    if (key === 'Enter' && this._crop) {
      e.preventDefault();
      this._applyCrop();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      var self = this;
      var ids = this._sel.filter(function (id) {
        var l = self._find(id);
        return l && !l.locked;
      });
      if (ids.length) this.remove(ids);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      var step = e.shiftKey ? 10 : 1;
      var mx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      var my = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      var roots = this._roots(this._sel);
      if (!roots.length) return;
      this._before('nudge');
      var scene = this;
      roots.forEach(function (id) {
        var l = scene._find(id);
        if (l && !l.locked) scene._shiftTree(l, mx, my);
      });
      this._after();
      this._emitSelect();
      return;
    }
    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (mod && (key === 'y' || key === 'Y')) { e.preventDefault(); this.redo(); return; }
    if (mod && (key === 'd' || key === 'D')) { e.preventDefault(); this.duplicate(this._sel); return; }
    if (mod && (key === 'g' || key === 'G')) {
      e.preventDefault();
      if (e.shiftKey) this.ungroup(this._sel[0]);
      else this.group(this._sel);
      return;
    }
    if (mod && (key === 'c' || key === 'C') && !inEditor) {
      e.preventDefault();
      this._clipboard = this._selectionTree(this._sel);
      this._pasteN = 0;
      return;
    }
    if (mod && (key === 'v' || key === 'V') && !inEditor) {
      e.preventDefault();
      if (!this._clipboard.length) return;
      this._pasteN++;
      this._before(null);
      var created = this._spawn(this._clipboard, 24 * this._pasteN);
      this._after();
      this.select(created.filter(function (l) { return !l.groupId; }).map(function (l) { return l.id; }));
      return;
    }
    if (!mod && (key === '[' || key === ']')) {
      e.preventDefault();
      var dir = key === ']' ? 'forward' : 'backward';
      var ordered = this._sel.slice();
      if (dir === 'forward') ordered.reverse();
      var scene2 = this;
      ordered.forEach(function (id) { scene2.order(id, dir); });
      return;
    }
  };

  P.destroy = function () {
    if (this._dead) return;
    this._dead = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._longTimer) clearTimeout(this._longTimer);
    if (this._ro) this._ro.disconnect();
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKeyUp);
    var self = this;
    Object.keys(this._assets).forEach(function (k) {
      if (self._assets[k].url) URL.revokeObjectURL(self._assets[k].url);
    });
    this._clearBitmaps();
    this._ev = {};
    if (this.el) {
      this.el.innerHTML = '';
      this.el.classList.remove('le-scene', 'is-space', 'is-panning');
      this.el.removeAttribute('data-tool');
    }
  };

  LE.Scene = Scene;
  LE.Scene.EXTENDED_ADJUST = true;
  LE.Scene.blank = blank;
  LE.Scene.collageOf = collageOf;
  LE.Scene.carouselOf = carouselOf;
  LE.Scene.redactOf = redactOf;
  LE.Scene.redactSize = redactSize;
  LE.Scene.paintRedact = paintRedact;
  LE.Scene.makerOf = makerOf;
  LE.Scene.expertOf = expertOf;
  LE.Scene.expertAssets = expertAssets;
  LE.Scene._fx = { cutoutAlpha: cutoutAlpha, cutoutApply: cutoutApply, cutoutOutline: cutoutOutline };
  LE.Scene.printOf = printOf;
  LE.Scene.refitCrop = refitCrop;
  LE.Scene.backgroundSpec = bgSpec;
  LE.Scene.backgroundPlacement = function (bg, W, H, sw, sh) { return bgPlace(bgSpec(bg), W, H, sw, sh); };
})(typeof window !== 'undefined' ? window : this);
