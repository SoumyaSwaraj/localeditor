/* LocalEditor graphics library: icons, emoji, stickers, shapes, withicons, colour. */
(function () {
  'use strict';

  var CACHE = 'le-assets-v1';
  var COUNTS = /*COUNTS*/{"lucide":2100,"phosphor":1798,"emoji":918,"stickers":42}/*COUNTS_END*/;
  var FILES = {
    lucide: 'assets/data/lucide.json',
    phosphor: 'assets/data/phosphor.json',
    emoji: 'assets/data/emoji.json',
    stickers: 'assets/data/stickers.json',
    withicons: 'assets/data/withicons/index.json'
  };
  var memory = {};
  var inflight = {};
  var raster = {};
  var packs = {};
  var styleState = {};
  var styleFlight = {};
  var svgNonce = 0;

  function base() {
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root;
  }

  function asset(rel) {
    return base() + String(rel || '').replace(/^\//, '');
  }

  function abs(rel) {
    return new URL(asset(rel), document.baseURI).href;
  }

  function sets() {
    return [
      { id: 'lucide', name: 'Lucide', kind: 'icon', count: COUNTS.lucide || 0 },
      { id: 'phosphor', name: 'Phosphor', kind: 'icon', count: COUNTS.phosphor || 0 },
      { id: 'emoji', name: 'Emoji', kind: 'sticker', count: COUNTS.emoji || 0 },
      { id: 'stickers', name: 'Stickers', kind: 'sticker', count: COUNTS.stickers || 0 },
      { id: 'shapes', name: 'Shapes', kind: 'shape', count: SHAPES.length },
      { id: 'withicons', name: 'Withicons', kind: 'icon', count: (memory.withicons && memory.withicons.count) || 1000 }
    ];
  }

  function readJson(rel) {
    var href = abs(rel);
    var fromNet = function () {
      return fetch(href).then(function (res) {
        if (!res.ok) throw new Error('Asset failed (' + res.status + ')');
        var copy = res.clone();
        var put = window.caches
          ? caches.open(CACHE).then(function (cache) { return cache.put(href, copy); }).catch(function () {})
          : Promise.resolve();
        return put.then(function () { return res.json(); });
      });
    };
    if (!window.caches) return fromNet();
    return caches.open(CACHE).then(function (cache) {
      return cache.match(href).then(function (hit) { return hit ? hit.json() : fromNet(); });
    }).catch(fromNet);
  }

  function load(setId) {
    if (setId === 'shapes') return Promise.resolve();
    if (memory[setId]) return Promise.resolve();
    if (inflight[setId]) return inflight[setId];
    if (!FILES[setId]) return Promise.reject(new Error('Unknown set ' + setId));
    inflight[setId] = readJson(FILES[setId]).then(function (data) {
      memory[setId] = setId === 'withicons' ? expandWithicons(data) : data;
      delete inflight[setId];
    }).catch(function (err) {
      delete inflight[setId];
      throw err;
    });
    return inflight[setId];
  }

  function saveAllOffline(onProgress) {
    var ids = Object.keys(FILES);
    var done = 0;
    function one(i) {
      if (i >= ids.length) return Promise.resolve();
      var rel = FILES[ids[i]];
      var href = abs(rel);
      return fetch(href).then(function (res) {
        if (!res.ok) throw new Error('Asset failed (' + res.status + ')');
        var copy = res.clone();
        return caches.open(CACHE).then(function (cache) {
          return cache.put(href, copy);
        }).then(function () { return res.json(); });
      }).then(function (data) {
        memory[ids[i]] = ids[i] === 'withicons' ? expandWithicons(data) : data;
        done++;
        if (onProgress) onProgress({ loaded: done, total: ids.length, file: rel });
        return one(i + 1);
      });
    }
    return one(0);
  }

  function parseId(id) {
    var s = String(id || '');
    var at = s.indexOf(':');
    var set = at < 0 ? '' : s.slice(0, at);
    var name = at < 0 ? s : s.slice(at + 1);
    if (set === 'ph') set = 'phosphor';
    if (set === 'fluent-emoji-flat') set = 'emoji';
    return { set: set, name: name };
  }

  function aliasOf(data, name) {
    var alias = data.aliases && data.aliases[name];
    if (!alias) return null;
    if (typeof alias === 'string') return { parent: alias, hFlip: false };
    return { parent: alias.parent, hFlip: !!alias.hFlip };
  }

  function resolve(data, name) {
    if (data.icons && data.icons[name]) return { name: name, icon: data.icons[name], hFlip: false };
    var alias = aliasOf(data, name);
    if (!alias || !data.icons[alias.parent]) return null;
    return { name: alias.parent, icon: data.icons[alias.parent], hFlip: alias.hFlip };
  }

  function search(query, opts) {
    opts = opts || {};
    var limit = opts.limit || 40;
    var q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    var tokens = q.split(/[^a-z0-9]+/).filter(function (t) { return t.length > 1 || t === 'x'; });
    var ids = opts.set ? [opts.set] : ['lucide', 'phosphor', 'emoji', 'stickers'];
    var hits = [];
    ids.forEach(function (setId) {
      if (setId === 'withicons') {
        searchWithicons(q, tokens, opts, hits);
        return;
      }
      var data = memory[setId];
      if (!data || !data.icons) return;
      var scores = {};
      function bump(name, n) { scores[name] = (scores[name] || 0) + n; }
      var index = data.search || {};
      tokens.forEach(function (token) {
        var list = index[token] || [];
        for (var i = 0; i < list.length; i++) bump(list[i], 12);
      });
      if (index[q]) {
        var exact = index[q];
        for (var j = 0; j < exact.length; j++) bump(exact[j], 24);
      }
      Object.keys(data.icons).forEach(function (name) {
        var hay = name.replace(/-/g, ' ');
        if (name === q || hay === q) bump(name, 80);
        else if (name.indexOf(q) === 0 || hay.indexOf(q) === 0) bump(name, 36);
        else if (q && (name.indexOf(q) >= 0 || hay.indexOf(q) >= 0)) bump(name, 18);
        if (/-fill$/.test(name)) bump(name, -2);
        if (/-duotone$/.test(name)) bump(name, -3);
      });
      Object.keys(scores).forEach(function (name) {
        if (!data.icons[name] || scores[name] <= 0) return;
        hits.push({
          id: setId + ':' + name,
          set: setId,
          name: name,
          tags: data.icons[name].tags || '',
          score: scores[name]
        });
      });
    });
    hits.sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    var seen = {};
    var out = [];
    for (var n = 0; n < hits.length && out.length < limit; n++) {
      if (seen[hits[n].id]) continue;
      seen[hits[n].id] = 1;
      var item = { id: hits[n].id, set: hits[n].set, name: hits[n].name, tags: hits[n].tags };
      if (hits[n].style) item.style = hits[n].style;
      out.push(item);
    }
    return out;
  }

  function safeColor(value) {
    if (!value || typeof value !== 'string') return '';
    var c = value.trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
    if (/^(?:rgb|hsl)a?\(\s*[\d.%\s,\/]+\)$/i.test(c)) return c;
    if (/^[a-z]{3,24}$/i.test(c)) return c;
    return '';
  }

  var DROP_SVG = { script: 1, foreignobject: 1, iframe: 1, object: 1, embed: 1, audio: 1, video: 1, link: 1, meta: 1, base: 1, set: 1, animate: 1, animatetransform: 1, animatemotion: 1, handler: 1 };

  function cleanStyle(css) {
    return String(css || '')
      .replace(/<\/\s*/gi, '')
      .replace(/@import\b[^;]*;?/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, function (_, q, u) {
        u = String(u || '').trim();
        if (u.charAt(0) === '#') return 'url(#' + u.slice(1).replace(/[^A-Za-z0-9_.:-]/g, '') + ')';
        return 'none';
      });
  }

  function scrub(body) {
    var wrapped = '<svg xmlns="http://www.w3.org/2000/svg">' + String(body || '') + '</svg>';
    var doc;
    try { doc = new DOMParser().parseFromString(wrapped, 'image/svg+xml'); }
    catch (e) { return ''; }
    var root = doc.documentElement;
    if (!root || /parsererror/i.test(root.nodeName || root.localName || '')) return '';
    var all = [].slice.call(doc.getElementsByTagName('*'));
    for (var i = all.length - 1; i >= 0; i--) {
      var n = all[i];
      if (n === root) continue;
      var name = String(n.localName || '').toLowerCase();
      if (name === 'style') {
        n.textContent = cleanStyle(n.textContent || '');
        continue;
      }
      if (DROP_SVG[name]) {
        if (n.parentNode) n.parentNode.removeChild(n);
        continue;
      }
      var attrs = [].slice.call(n.attributes || []);
      for (var a = 0; a < attrs.length; a++) {
        var nm = String(attrs[a].name || '').toLowerCase();
        var val = attrs[a].value || '';
        if (nm.indexOf('on') === 0) { n.removeAttribute(attrs[a].name); continue; }
        if (nm === 'style') {
          var css = cleanStyle(val);
          if (css) n.setAttribute('style', css);
          else n.removeAttribute(attrs[a].name);
          continue;
        }
        if (nm === 'href' || nm.slice(-4) === 'href') {
          var u = val.replace(/^\s+|\s+$/g, '');
          if (u.charAt(0) !== '#') n.removeAttribute(attrs[a].name);
          continue;
        }
        if (/javascript\s*:/i.test(val)) n.removeAttribute(attrs[a].name);
      }
    }
    var out = '';
    for (var c = 0; c < root.childNodes.length; c++) {
      try { out += new XMLSerializer().serializeToString(root.childNodes[c]); }
      catch (e2) {}
    }
    return out;
  }

  function idPrefix(name) {
    var h = 0;
    svgNonce = (svgNonce + 1) % 1679616;
    for (var i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
    return 'i' + h.toString(36) + svgNonce.toString(36) + '_';
  }

  function prefixIds(body, prefix) {
    return body
      .replace(/\bid="([^"]+)"/g, function (_, id) { return 'id="' + prefix + id + '"'; })
      .replace(/url\(#([^)]+)\)/g, function (_, id) { return 'url(#' + prefix + id + ')'; })
      .replace(/\bhref="#([^"]+)"/g, function (_, id) { return 'href="#' + prefix + id + '"'; });
  }

  function svg(id, opts) {
    opts = opts || {};
    var parsed = parseId(id);
    if (parsed.set === 'withicons') return withSvg(parsed.name, opts);
    var data = memory[parsed.set];
    if (!data) throw new Error('Set not loaded: ' + parsed.set);
    var found = resolve(data, parsed.name);
    if (!found) throw new Error('Unknown asset ' + id);
    var icon = found.icon;
    var w = icon.width || data.width || 24;
    var h = icon.height || data.height || 24;
    var body = scrub(icon.body || '');
    var color = safeColor(opts.color);
    if (color && parsed.set !== 'emoji') body = body.split('currentColor').join(color);
    if (parsed.set === 'lucide' && opts.strokeWidth != null) {
      var sw = Number(opts.strokeWidth);
      if (isFinite(sw) && sw > 0 && sw < 48) {
        var width = String(Math.round(sw * 100) / 100);
        if (/stroke-width="/i.test(body)) body = body.replace(/stroke-width="[^"]*"/gi, 'stroke-width="' + width + '"');
        else body = '<g stroke-width="' + width + '">' + body + '</g>';
      }
    }
    if (found.hFlip) body = '<g transform="translate(' + w + ' 0) scale(-1 1)">' + body + '</g>';
    body = prefixIds(body, idPrefix(parsed.set + '-' + found.name));
    var dw = opts.size || w;
    var dh = opts.size || h;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + dw + '" height="' + dh + '">' + body + '</svg>';
  }

  function image(id, size, opts) {
    opts = opts || {};
    var px = Math.max(1, Math.round(Number(size) || 128));
    var parsed = parseId(id);
    var draw = {};
    if (parsed.set === 'withicons') {
      if (opts.color) draw.color = opts.color;
      if (opts.palette) draw.palette = opts.palette;
      if (opts.colors) draw.colors = opts.colors;
      if (!draw.color && !draw.palette && !draw.colors) draw.color = '#110F17';
    } else if (opts.color) draw.color = opts.color;
    else if (parsed.set !== 'emoji' && parsed.set !== 'stickers') draw.color = '#110F17';
    if (opts.strokeWidth != null) draw.strokeWidth = opts.strokeWidth;
    var key = id + '|' + px + '|' + (draw.color || '') + '|' + (draw.strokeWidth || '') + '|' + (draw.palette || '') + '|' + (draw.colors ? draw.colors.join(',') : '');
    if (raster[key]) return raster[key];
    var keys = Object.keys(raster);
    while (keys.length >= 80) {
      delete raster[keys.shift()];
    }
    draw.size = px;
    var needsIconPalette = parsed.set === 'withicons' && draw.palette && draw.palette !== 'default' && !isBrandPalette(draw.palette) && !iconPaletteTable;
    function paint() {
      var markup = svg(id, draw);
      var blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          img.width = px;
          img.height = px;
          resolve(img);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('Could not draw ' + id));
        };
        img.src = url;
      });
    }
    raster[key] = (needsIconPalette ? loadIconPalettes() : Promise.resolve()).then(paint).catch(function (err) {
      delete raster[key];
      throw err;
    });
    return raster[key];
  }

  function rnd(v) {
    return (Math.round(v * 100) / 100).toString();
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function take(editable, params) {
    var out = {};
    var ed = editable || {};
    Object.keys(ed).forEach(function (key) {
      var spec = ed[key] || {};
      if (Array.isArray(spec.default)) {
        var incoming = params && Array.isArray(params[key]) ? params[key] : spec.default;
        out[key] = incoming.map(function (pt) { return pt.slice ? pt.slice() : pt; });
        return;
      }
      var value = params && params[key] != null ? params[key] : spec.default;
      if (typeof spec.default === 'number') {
        value = Number(value);
        if (!isFinite(value)) value = spec.default;
        if (typeof spec.min === 'number') value = Math.max(spec.min, value);
        if (typeof spec.max === 'number') value = Math.min(spec.max, value);
      }
      out[key] = value;
    });
    return out;
  }

  function poly(points) {
    var d = '';
    for (var i = 0; i < points.length; i++) {
      d += (i ? 'L' : 'M') + rnd(points[i][0]) + ' ' + rnd(points[i][1]);
    }
    return d + 'Z';
  }

  function regular(w, h, n, rot) {
    var points = [];
    for (var i = 0; i < n; i++) {
      var a = rot + i * Math.PI * 2 / n;
      points.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
    }
    return poly(points);
  }

  function ellipse(x, y, w, h) {
    var rx = w / 2;
    var ry = h / 2;
    var cx = x + rx;
    var cy = y + ry;
    return 'M' + rnd(cx + rx) + ' ' + rnd(cy) +
      'A' + rnd(rx) + ' ' + rnd(ry) + ' 0 1 0 ' + rnd(cx - rx) + ' ' + rnd(cy) +
      'A' + rnd(rx) + ' ' + rnd(ry) + ' 0 1 0 ' + rnd(cx + rx) + ' ' + rnd(cy) + 'Z';
  }

  function roundRect(w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r <= 0) return 'M0 0H' + rnd(w) + 'V' + rnd(h) + 'H0Z';
    return 'M' + rnd(r) + ' 0H' + rnd(w - r) +
      'A' + rnd(r) + ' ' + rnd(r) + ' 0 0 1 ' + rnd(w) + ' ' + rnd(r) +
      'V' + rnd(h - r) +
      'A' + rnd(r) + ' ' + rnd(r) + ' 0 0 1 ' + rnd(w - r) + ' ' + rnd(h) +
      'H' + rnd(r) +
      'A' + rnd(r) + ' ' + rnd(r) + ' 0 0 1 0 ' + rnd(h - r) +
      'V' + rnd(r) +
      'A' + rnd(r) + ' ' + rnd(r) + ' 0 0 1 ' + rnd(r) + ' 0Z';
  }

  function starPath(w, h, count, inner) {
    var points = [];
    var rot = -Math.PI / 2;
    for (var i = 0; i < count * 2; i++) {
      var radius = i % 2 === 0 ? 1 : inner;
      var a = rot + i * Math.PI / count;
      points.push([w / 2 + (w / 2) * radius * Math.cos(a), h / 2 + (h / 2) * radius * Math.sin(a)]);
    }
    return poly(points);
  }

  function unit(cmds, w, h) {
    var d = '';
    for (var i = 0; i < cmds.length; i++) {
      var c = cmds[i];
      d += c[0];
      for (var k = 1; k < c.length; k += 2) d += rnd(c[k] * w) + ' ' + rnd(c[k + 1] * h) + (k + 2 < c.length ? ' ' : '');
    }
    return d;
  }

  function mapPoints(pts, w, h) {
    var pixel = false;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][0] > 1 || pts[i][1] > 1) pixel = true;
    }
    return pts.map(function (pt) {
      return [pixel ? pt[0] : pt[0] * w, pixel ? pt[1] : pt[1] * h];
    });
  }

  function openLine(points) {
    var d = '';
    for (var i = 0; i < points.length; i++) {
      d += (i ? 'L' : 'M') + rnd(points[i][0]) + ' ' + rnd(points[i][1]);
    }
    return d;
  }

  function curveThrough(points) {
    if (points.length < 2) return '';
    if (points.length === 2) return openLine(points);
    var d = 'M' + rnd(points[0][0]) + ' ' + rnd(points[0][1]);
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[Math.max(0, i - 1)];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[Math.min(points.length - 1, i + 2)];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6;
      var c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6;
      var c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + rnd(c1x) + ' ' + rnd(c1y) + ' ' + rnd(c2x) + ' ' + rnd(c2y) + ' ' + rnd(p2[0]) + ' ' + rnd(p2[1]);
    }
    return d;
  }

  function thickSegment(x1, y1, x2, y2, tw) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len * tw / 2;
    var ny = dx / len * tw / 2;
    return 'M' + rnd(x1 + nx) + ' ' + rnd(y1 + ny) +
      'L' + rnd(x2 + nx) + ' ' + rnd(y2 + ny) +
      'L' + rnd(x2 - nx) + ' ' + rnd(y2 - ny) +
      'L' + rnd(x1 - nx) + ' ' + rnd(y1 - ny) + 'Z';
  }

  function define(id, name, editable, draw, extra) {
    var item = {
      id: id,
      name: name,
      editable: editable || {},
      path: function (w, h, params) {
        w = Math.max(1, Number(w) || 1);
        h = Math.max(1, Number(h) || 1);
        return draw(w, h, take(editable, params));
      }
    };
    if (extra) Object.keys(extra).forEach(function (key) { item[key] = extra[key]; });
    return item;
  }

  var SHAPES = [
    define('rectangle', 'Rectangle', {}, function (w, h) {
      return 'M0 0H' + rnd(w) + 'V' + rnd(h) + 'H0Z';
    }),
    define('rounded-rectangle', 'Rounded rectangle', {
      radius: { default: 24, min: 0, max: 800 }
    }, function (w, h, p) { return roundRect(w, h, p.radius); }),
    define('ellipse', 'Circle', {}, function (w, h) { return ellipse(0, 0, w, h); }),
    define('triangle', 'Triangle', {}, function (w, h) { return regular(w, h, 3, -Math.PI / 2); }),
    define('right-triangle', 'Right triangle', {}, function (w, h) {
      return 'M0 0L0 ' + rnd(h) + 'L' + rnd(w) + ' ' + rnd(h) + 'Z';
    }),
    define('diamond', 'Diamond', {}, function (w, h) { return regular(w, h, 4, -Math.PI / 2); }),
    define('pentagon', 'Pentagon', {}, function (w, h) { return regular(w, h, 5, -Math.PI / 2); }),
    define('hexagon', 'Hexagon', {}, function (w, h) { return regular(w, h, 6, -Math.PI / 2 + Math.PI / 6); }),
    define('octagon', 'Octagon', {}, function (w, h) { return regular(w, h, 8, -Math.PI / 2 + Math.PI / 8); }),
    define('star', 'Star', {
      points: { default: 5, min: 3, max: 24 },
      innerRatio: { default: 0.4, min: 0.05, max: 0.95 }
    }, function (w, h, p) { return starPath(w, h, Math.round(p.points), p.innerRatio); }),
    define('burst', 'Burst', {
      points: { default: 16, min: 6, max: 36 },
      innerRatio: { default: 0.74, min: 0.4, max: 0.95 }
    }, function (w, h, p) { return starPath(w, h, Math.round(p.points), p.innerRatio); }),
    define('heart', 'Heart', {}, function (w, h) {
      return unit([
        ['M', 0.5, 0.88],
        ['C', 0.5, 0.88, 0.12, 0.64, 0.12, 0.4],
        ['C', 0.12, 0.22, 0.26, 0.1, 0.38, 0.16],
        ['C', 0.44, 0.2, 0.48, 0.26, 0.5, 0.34],
        ['C', 0.52, 0.26, 0.56, 0.2, 0.62, 0.16],
        ['C', 0.74, 0.1, 0.88, 0.22, 0.88, 0.4],
        ['C', 0.88, 0.64, 0.5, 0.88, 0.5, 0.88],
        ['Z']
      ], w, h);
    }),
    define('cloud', 'Cloud', {}, function (w, h) {
      return unit([
        ['M', 0.22, 0.72],
        ['C', 0.08, 0.72, 0.05, 0.54, 0.16, 0.48],
        ['C', 0.14, 0.32, 0.3, 0.24, 0.42, 0.34],
        ['C', 0.48, 0.16, 0.7, 0.16, 0.76, 0.34],
        ['C', 0.92, 0.3, 0.98, 0.5, 0.88, 0.62],
        ['C', 0.98, 0.76, 0.84, 0.86, 0.7, 0.78],
        ['C', 0.62, 0.92, 0.36, 0.9, 0.3, 0.76],
        ['C', 0.24, 0.84, 0.16, 0.8, 0.22, 0.72],
        ['Z']
      ], w, h);
    }),
    define('speech-round', 'Speech bubble', {
      radius: { default: 28, min: 0, max: 400 }
    }, function (w, h, p) {
      var bh = h * 0.74;
      return roundRect(w, bh, Math.min(p.radius, bh / 2, w / 2)) +
        'M' + rnd(w * 0.22) + ' ' + rnd(bh) + 'L' + rnd(w * 0.16) + ' ' + rnd(h) + 'L' + rnd(w * 0.42) + ' ' + rnd(bh) + 'Z';
    }),
    define('speech-square', 'Square speech bubble', {}, function (w, h) {
      var bh = h * 0.74;
      return 'M0 0H' + rnd(w) + 'V' + rnd(bh) + 'H' + rnd(w * 0.42) + 'L' + rnd(w * 0.16) + ' ' + rnd(h) + 'L' + rnd(w * 0.22) + ' ' + rnd(bh) + 'H0Z';
    }),
    define('arrow-right', 'Arrow', {
      arrowHead: { default: 0.38, min: 0.16, max: 0.7 }
    }, function (w, h, p) {
      var hw = w * p.arrowHead;
      var body = h * 0.34;
      var y1 = (h - body) / 2;
      var y2 = (h + body) / 2;
      var x = w - hw;
      return 'M0 ' + rnd(y1) + 'H' + rnd(x) + 'V0L' + rnd(w) + ' ' + rnd(h / 2) + 'L' + rnd(x) + ' ' + rnd(h) + 'V' + rnd(y2) + 'H0Z';
    }),
    define('arrow-double', 'Double arrow', {
      arrowHead: { default: 0.32, min: 0.16, max: 0.46 }
    }, function (w, h, p) {
      var hw = w * p.arrowHead;
      var body = h * 0.32;
      var y1 = (h - body) / 2;
      var y2 = (h + body) / 2;
      return 'M' + rnd(hw) + ' 0L0 ' + rnd(h / 2) + 'L' + rnd(hw) + ' ' + rnd(h) +
        'V' + rnd(y2) + 'H' + rnd(w - hw) + 'V' + rnd(h) +
        'L' + rnd(w) + ' ' + rnd(h / 2) + 'L' + rnd(w - hw) + ' 0V' + rnd(y1) +
        'H' + rnd(hw) + 'V0Z';
    }),
    define('arrow-curved', 'Curved arrow', {
      arrowHead: { default: 0.28, min: 0.12, max: 0.5 }
    }, function (w, h, p) {
      var p0 = [w * 0.08, h * 0.78];
      var c = [w * 0.42, h * 0.06];
      var p1 = [w * 0.78, h * 0.46];
      var steps = 16;
      var width = Math.min(w, h) * 0.07;
      var left = [];
      var right = [];
      var ang = 0;
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var u = 1 - t;
        var x = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0];
        var y = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1];
        var dx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]);
        var dy = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]);
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        ang = Math.atan2(dy, dx);
        left.push([x + (-dy / len) * width, y + (dx / len) * width]);
        right.push([x - (-dy / len) * width, y - (dx / len) * width]);
      }
      var tipLen = Math.min(w, h) * p.arrowHead;
      var tip = [p1[0] + Math.cos(ang) * tipLen, p1[1] + Math.sin(ang) * tipLen];
      var spread = tipLen * 0.62;
      var n1 = [p1[0] + Math.cos(ang + 1.65) * spread, p1[1] + Math.sin(ang + 1.65) * spread];
      var n2 = [p1[0] + Math.cos(ang - 1.65) * spread, p1[1] + Math.sin(ang - 1.65) * spread];
      var d = 'M' + rnd(left[0][0]) + ' ' + rnd(left[0][1]);
      for (var a = 1; a < left.length; a++) d += 'L' + rnd(left[a][0]) + ' ' + rnd(left[a][1]);
      d += 'L' + rnd(n1[0]) + ' ' + rnd(n1[1]) + 'L' + rnd(tip[0]) + ' ' + rnd(tip[1]) + 'L' + rnd(n2[0]) + ' ' + rnd(n2[1]);
      for (var b = right.length - 1; b >= 0; b--) d += 'L' + rnd(right[b][0]) + ' ' + rnd(right[b][1]);
      return d + 'Z';
    }),
    define('chevron', 'Chevron', {
      thickness: { default: 0.34, min: 0.12, max: 0.7 }
    }, function (w, h, p) {
      var inset = w * (1 - p.thickness);
      return 'M0 0L' + rnd(inset) + ' 0L' + rnd(w) + ' ' + rnd(h / 2) + 'L' + rnd(inset) + ' ' + rnd(h) + 'L0 ' + rnd(h) + 'L' + rnd(w - inset) + ' ' + rnd(h / 2) + 'Z';
    }),
    define('plus', 'Plus', {
      thickness: { default: 0.28, min: 0.08, max: 0.6 }
    }, function (w, h, p) {
      var t = Math.min(w, h) * p.thickness;
      var x = (w - t) / 2;
      var y = (h - t) / 2;
      return 'M' + rnd(x) + ' 0H' + rnd(x + t) + 'V' + rnd(y) + 'H' + rnd(w) + 'V' + rnd(y + t) + 'H' + rnd(x + t) + 'V' + rnd(h) + 'H' + rnd(x) + 'V' + rnd(y + t) + 'H0V' + rnd(y) + 'H' + rnd(x) + 'Z';
    }),
    define('cross', 'Cross', {
      thickness: { default: 0.22, min: 0.08, max: 0.45 }
    }, function (w, h, p) {
      var t = Math.min(w, h) * p.thickness;
      var m = t * 0.85;
      return thickSegment(m, m, w - m, h - m, t) + thickSegment(w - m, m, m, h - m, t);
    }),
    define('ring', 'Ring', {
      innerRatio: { default: 0.62, min: 0.15, max: 0.92 }
    }, function (w, h, p) {
      var iw = w * p.innerRatio;
      var ih = h * p.innerRatio;
      return ellipse(0, 0, w, h) + ellipse((w - iw) / 2, (h - ih) / 2, iw, ih);
    }, { fillRule: 'evenodd' }),
    define('arc', 'Arc', {
      sweep: { default: 270, min: 15, max: 350 }
    }, function (w, h, p) {
      var sweep = p.sweep * Math.PI / 180;
      var rx = w / 2;
      var ry = h / 2;
      var start = -Math.PI / 2;
      var x1 = rx + rx * Math.cos(start);
      var y1 = ry + ry * Math.sin(start);
      var x2 = rx + rx * Math.cos(start + sweep);
      var y2 = ry + ry * Math.sin(start + sweep);
      var large = sweep > Math.PI ? 1 : 0;
      return 'M' + rnd(x1) + ' ' + rnd(y1) + 'A' + rnd(rx) + ' ' + rnd(ry) + ' 0 ' + large + ' 1 ' + rnd(x2) + ' ' + rnd(y2);
    }, { closed: false }),
    define('half-circle', 'Half circle', {}, function (w, h) {
      return 'M0 ' + rnd(h) + 'A' + rnd(w / 2) + ' ' + rnd(h) + ' 0 0 1 ' + rnd(w) + ' ' + rnd(h) + 'Z';
    }),
    define('parallelogram', 'Parallelogram', {
      skew: { default: 0.22, min: 0, max: 0.45 }
    }, function (w, h, p) {
      var o = w * p.skew;
      return 'M' + rnd(o) + ' 0H' + rnd(w) + 'L' + rnd(w - o) + ' ' + rnd(h) + 'H0Z';
    }),
    define('trapezoid', 'Trapezoid', {
      inset: { default: 0.18, min: 0, max: 0.4 }
    }, function (w, h, p) {
      var inset = w * p.inset;
      return 'M' + rnd(inset) + ' 0H' + rnd(w - inset) + 'L' + rnd(w) + ' ' + rnd(h) + 'H0Z';
    }),
    define('cylinder', 'Cylinder', {}, function (w, h) {
      var ry = Math.max(3, h * 0.14);
      return 'M0 ' + rnd(ry) + 'L0 ' + rnd(h - ry) +
        'A' + rnd(w / 2) + ' ' + rnd(ry) + ' 0 0 0 ' + rnd(w) + ' ' + rnd(h - ry) +
        'L' + rnd(w) + ' ' + rnd(ry) +
        'A' + rnd(w / 2) + ' ' + rnd(ry) + ' 0 0 1 0 ' + rnd(ry) + 'Z' +
        ellipse(0, 0, w, ry * 2);
    }),
    define('blob', 'Blob', {}, function (w, h) {
      return unit([
        ['M', 0.62, 0.08],
        ['C', 0.84, 0.02, 0.98, 0.24, 0.94, 0.46],
        ['C', 0.99, 0.72, 0.8, 0.98, 0.54, 0.96],
        ['C', 0.28, 0.99, 0.06, 0.82, 0.08, 0.58],
        ['C', 0.02, 0.34, 0.2, 0.12, 0.42, 0.1],
        ['C', 0.48, 0.06, 0.52, 0.1, 0.62, 0.08],
        ['Z']
      ], w, h);
    }),
    define('blob-2', 'Blob 2', {}, function (w, h) {
      return unit([
        ['M', 0.28, 0.12],
        ['C', 0.48, -0.02, 0.78, 0.08, 0.9, 0.28],
        ['C', 1.04, 0.5, 0.86, 0.78, 0.66, 0.9],
        ['C', 0.46, 1.04, 0.16, 0.9, 0.08, 0.68],
        ['C', -0.02, 0.46, 0.08, 0.22, 0.28, 0.12],
        ['Z']
      ], w, h);
    }),
    define('blob-3', 'Blob 3', {}, function (w, h) {
      return unit([
        ['M', 0.5, 0.06],
        ['C', 0.72, 0.04, 0.9, 0.18, 0.94, 0.38],
        ['C', 1.02, 0.58, 0.84, 0.7, 0.78, 0.78],
        ['C', 0.9, 0.96, 0.62, 1.02, 0.42, 0.92],
        ['C', 0.18, 0.98, 0.02, 0.74, 0.08, 0.52],
        ['C', 0.02, 0.28, 0.24, 0.08, 0.5, 0.06],
        ['Z']
      ], w, h);
    }),
    define('line', 'Line', {}, function (w, h) {
      return 'M0 ' + rnd(h / 2) + 'H' + rnd(w);
    }, { closed: false }),
    define('dashed-line', 'Dashed line', {}, function (w, h) {
      return 'M0 ' + rnd(h / 2) + 'H' + rnd(w);
    }, { closed: false, dash: [8, 6] }),
    define('arrow-line', 'Line with arrowheads', {
      arrowHead: { default: 0.28, min: 0.1, max: 0.6 }
    }, function (w, h, p) {
      var m = Math.min(w, h);
      var ah = m * p.arrowHead;
      var aw = Math.min(w * 0.22, ah * 1.2);
      var shaft = Math.max(2, Math.min(h * 0.16, m * 0.12));
      var y = h / 2;
      var x1 = aw;
      var x2 = w - aw;
      return 'M' + rnd(x1) + ' ' + rnd(y - shaft / 2) + 'H' + rnd(x2) + 'V' + rnd(y + shaft / 2) + 'H' + rnd(x1) + 'Z' +
        'M' + rnd(w) + ' ' + rnd(y) + 'L' + rnd(x2) + ' ' + rnd(y - ah) + 'L' + rnd(x2) + ' ' + rnd(y + ah) + 'Z' +
        'M0 ' + rnd(y) + 'L' + rnd(x1) + ' ' + rnd(y - ah) + 'L' + rnd(x1) + ' ' + rnd(y + ah) + 'Z';
    }),
    define('polyline', 'Polyline', {
      points: { default: [[0.06, 0.78], [0.28, 0.32], [0.52, 0.6], [0.74, 0.22], [0.94, 0.48]] }
    }, function (w, h, p) {
      return openLine(mapPoints(p.points || [], w, h));
    }, { closed: false }),
    define('curve', 'Curve', {
      points: { default: [[0.08, 0.76], [0.3, 0.24], [0.58, 0.68], [0.92, 0.2]] }
    }, function (w, h, p) {
      return curveThrough(mapPoints(p.points || [], w, h));
    }, { closed: false })
  ];

  var WI_ROLES = ['ink', 'c1', 'c2', 'c3', 'c4', 'tint', 'accent', 'shadow', 'shine', 'edge'];
  var WI_FIXED = {
    '--with-duo': 'c1',
    '--with-accent': 'c1',
    '--with-glass-back': 'c1',
    '--with-glass-pane': 'tint',
    '--with-glass-etch': 'ink',
    '--with-glass-accent': 'accent',
    '--with-glass-frost': 'shine',
    '--with-glass-shine': 'shine',
    '--with-kawaii-face': 'ink',
    '--with-kawaii-blush': 'accent',
    '--with-kawaii-sparkle': 'accent',
    '--with-kawaii-accent': 'accent',
    '--with-kawaii-shine': 'shine',
    '--with-sticker-edge': 'edge',
    '--with-sticker-ink': 'ink',
    '--with-sticker-shadow': 'shadow',
    '--with-sticker-shine': 'shine',
    '--with-pixel-fill': 'c1',
    '--with-pixel-shine': 'shine',
    '--with-retro-shadow': 'shadow'
  };
  var WI_GENERIC = /^--with-[a-z0-9]+-(ink|c1|c2|c3|c4|tint|accent|shadow|shine|edge)$/;
  var WI_SLOT = [/^--with-kawaii-fill-\d+$/, /^--with-sticker-(bubblegum|grape|lemon|mint|peach|sky)$/, /^--with-retro-\d+$/];
  var WI_SLOTS = ['c1', 'c2', 'c3', 'c4'];

  function styleRel(styleId) {
    return 'assets/data/withicons/' + styleId + '.json';
  }

  function styleMeta(styleId) {
    var index = memory.withicons;
    var list = index && index.styles || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === styleId) return list[i];
    return null;
  }

  function splitWith(name) {
    var slash = String(name || '').indexOf('/');
    if (slash < 0) return { style: 'line', icon: String(name || '') };
    return { style: name.slice(0, slash), icon: name.slice(slash + 1) };
  }

  function readTracked(rel) {
    var href = abs(rel);
    var fromNet = function () {
      return fetch(href).then(function (res) {
        if (!res.ok) throw new Error('Asset failed (' + res.status + ')');
        var copy = res.clone();
        var put = window.caches
          ? caches.open(CACHE).then(function (cache) { return cache.put(href, copy); }).catch(function () {})
          : Promise.resolve();
        return put.then(function () { return res.json(); }).then(function (data) {
          return { data: data, cached: !!window.caches };
        });
      });
    };
    if (!window.caches) return fromNet();
    return caches.open(CACHE).then(function (cache) {
      return cache.match(href).then(function (hit) {
        if (!hit) return fromNet();
        return hit.json().then(function (data) { return { data: data, cached: true }; });
      });
    }).catch(fromNet);
  }

  function iconStyles() {
    var index = memory.withicons;
    if (!index || !index.styles) return [];
    return index.styles.map(function (s) {
      var state = styleState[s.id] || {};
      return {
        id: s.id,
        name: s.name,
        group: s.group,
        description: s.description,
        colorful: !!s.colorful,
        count: s.count,
        bytes: s.bytes || 0,
        palettes: (s.palettes || []).slice(),
        defaultPalette: s.defaultPalette || null,
        loaded: !!packs[s.id] || !!state.loaded,
        offline: !!state.offline
      };
    });
  }

  function expandWithicons(data) {
    if (!data || !data.names || data.icons) return data;
    var icons = {};
    var search = {};
    var vocab = data.vocab || [];
    var cats = data.categories || [];
    function add(token, name) {
      if (!token) return;
      var list = search[token] || (search[token] = []);
      if (list.indexOf(name) < 0) list.push(name);
    }
    for (var i = 0; i < data.names.length; i++) {
      var name = data.names[i];
      var ids = data.tags[i] || [];
      var words = [];
      for (var k = 0; k < ids.length; k++) {
        var word = vocab[ids[k]];
        if (!word) continue;
        words.push(word);
        add(word, name);
      }
      icons[name] = { c: cats[data.cat[i]] || '', t: words.join(' ') };
    }
    data.icons = icons;
    data.search = search;
    data.count = data.names.length;
    return data;
  }

  function loadStyle(styleId, onProgress) {
    var ready = memory.withicons && memory.withicons.styles ? Promise.resolve() : load('withicons');
    return ready.then(function () {
      if (!styleMeta(styleId)) return Promise.reject(new Error('Unknown style ' + styleId));
      if (packs[styleId]) {
        if (onProgress) onProgress({ loaded: 1, total: 1, bytes: styleMeta(styleId).bytes || 0, totalBytes: styleMeta(styleId).bytes || 0, file: styleRel(styleId), style: styleId });
        return;
      }
      if (styleFlight[styleId]) return styleFlight[styleId];
      var rel = styleRel(styleId);
      styleFlight[styleId] = readTracked(rel).then(function (hit) {
        packs[styleId] = hit.data;
        styleState[styleId] = { loaded: true, offline: !!hit.cached };
        delete styleFlight[styleId];
        var bytes = (styleMeta(styleId) && styleMeta(styleId).bytes) || 0;
        if (onProgress) onProgress({ loaded: 1, total: 1, bytes: bytes, totalBytes: bytes, file: rel, style: styleId });
      }).catch(function (err) {
        delete styleFlight[styleId];
        throw err;
      });
      return styleFlight[styleId];
    });
  }

  function isStyleOffline(styleId) {
    if (!window.caches) return Promise.resolve(false);
    return caches.open(CACHE).then(function (cache) {
      return cache.match(abs(styleRel(styleId)));
    }).then(function (hit) { return !!hit; }).catch(function () { return false; });
  }

  function saveStyleOffline(styleId, onProgress) {
    var ready = memory.withicons ? Promise.resolve() : load('withicons');
    return ready.then(function () {
      var ids = styleId === 'all' ? (memory.withicons.styles || []).map(function (s) { return s.id; }) : [styleId];
      if (!ids.length) return Promise.reject(new Error('Unknown style ' + styleId));
      for (var i = 0; i < ids.length; i++) if (!styleMeta(ids[i])) return Promise.reject(new Error('Unknown style ' + ids[i]));
      var cachePalettes = styleId === 'all';
      var totalBytes = memory.withicons.paletteBytes && cachePalettes ? memory.withicons.paletteBytes : 0;
      ids.forEach(function (id) { totalBytes += styleMeta(id).bytes || 0; });
      var steps = ids.length + (cachePalettes ? 1 : 0);
      var done = 0;
      var got = 0;
      function one(i) {
        if (i >= ids.length) {
          if (!cachePalettes) return Promise.resolve();
          return cacheRel('assets/data/withicons/palettes.json').then(function (data) {
            iconPaletteTable = data && data.icons ? data : null;
            done++;
            got += memory.withicons.paletteBytes || 0;
            if (onProgress) onProgress({ loaded: done, total: steps, bytes: got, totalBytes: totalBytes, file: 'assets/data/withicons/palettes.json', style: 'palettes' });
          });
        }
        var id = ids[i];
        var rel = styleRel(id);
        var href = abs(rel);
        return fetch(href).then(function (res) {
          if (!res.ok) throw new Error('Asset failed (' + res.status + ')');
          var copy = res.clone();
          return caches.open(CACHE).then(function (cache) {
            return cache.put(href, copy);
          }).then(function () { return res.json(); });
        }).then(function (data) {
          packs[id] = data;
          styleState[id] = { loaded: true, offline: true };
          done++;
          got += styleMeta(id).bytes || 0;
          if (onProgress) onProgress({ loaded: done, total: steps, bytes: got, totalBytes: totalBytes, file: rel, style: id });
          return one(i + 1);
        });
      }
      return one(0);
    });
  }

  /* Every style at once is a large download: it goes through the download policy and the shared progress chip
     (LE.downloads, docs/DOWNLOADS.md). The person tapped a button that showed the size, so only free space can stop it. */
  var saveStylesNow = saveStyleOffline;
  saveStyleOffline = function (styleId, onProgress) {
    var D = window.LE && LE.downloads;
    if (styleId !== 'all' || !D || !D.request) return saveStylesNow(styleId, onProgress);
    var ready = memory.withicons ? Promise.resolve() : load('withicons');
    return ready.then(function () {
      var w = memory.withicons || {};
      var total = (w.styles || []).reduce(function (a, s) { return a + (s.bytes || 0); }, 0) + (w.paletteBytes || 0);
      return D.request({ id: 'icons:all', name: 'All icon styles', bytes: total, kind: 'pack', reason: 'Every icon style, offline', confirmed: true });
    }).then(function (r) {
      if (!r.ok) { var err = new Error('There is not enough space to save every icon style.'); err.code = r.why; throw err; }
      var t = D.track('icons:all', { name: 'Icon styles' });
      return saveStylesNow('all', function (p) { if (p && p.totalBytes) t.progress(p.bytes, p.totalBytes); if (onProgress) onProgress(p); })
        .then(function (x) { t.done(); return x; }, function (e) { t.fail(e); throw e; });
    });
  };

  function removeStyleOffline(styleId) {
    delete packs[styleId];
    if (styleState[styleId]) styleState[styleId].offline = false;
    if (styleState[styleId]) styleState[styleId].loaded = false;
    if (!window.caches) return Promise.resolve(false);
    return caches.open(CACHE).then(function (cache) {
      return cache.delete(abs(styleRel(styleId)));
    });
  }

  function styleUsage() {
    var index = memory.withicons;
    if (!index || !index.styles || !window.caches) return Promise.resolve({});
    return caches.open(CACHE).then(function (cache) {
      return Promise.all(index.styles.map(function (s) {
        return cache.match(abs(styleRel(s.id))).then(function (hit) {
          if (!hit) return 0;
          return hit.blob().then(function (blob) { return blob.size; }).catch(function () { return s.bytes || 0; });
        });
      }));
    }).then(function (sizes) {
      var out = {};
      index.styles.forEach(function (s, i) { if (sizes[i]) out[s.id] = sizes[i]; });
      return out;
    }).catch(function () { return {}; });
  }

  function searchWithicons(q, tokens, opts, hits) {
    var index = memory.withicons;
    if (!index || !index.icons) return;
    var style = opts.style || 'line';
    if (style === 'soft3d') style = 'soft-3d';
    if (style === 'lunar') style = 'lunar-new-year';
    var scores = {};
    function bump(name, n) { scores[name] = (scores[name] || 0) + n; }
    var table = index.search || {};
    tokens.forEach(function (token) {
      var list = table[token] || [];
      for (var i = 0; i < list.length; i++) bump(list[i], 12);
    });
    if (table[q]) {
      var exact = table[q];
      for (var j = 0; j < exact.length; j++) bump(exact[j], 24);
    }
    Object.keys(index.icons).forEach(function (name) {
      var hay = name.replace(/-/g, ' ');
      if (name === q || hay === q) bump(name, 80);
      else if (name.indexOf(q) === 0 || hay.indexOf(q) === 0) bump(name, 36);
      else if (q && (name.indexOf(q) >= 0 || hay.indexOf(q) >= 0)) bump(name, 18);
    });
    Object.keys(scores).forEach(function (name) {
      if (!index.icons[name] || scores[name] <= 0) return;
      hits.push({
        id: 'withicons:' + style + '/' + name,
        set: 'withicons',
        style: style,
        name: name,
        tags: index.icons[name].t || '',
        score: scores[name]
      });
    });
  }

  function varsIn(markup) {
    var seen = [];
    var re = /var\(\s*(--with-[\w-]+)/g;
    var m;
    while ((m = re.exec(markup))) if (seen.indexOf(m[1]) < 0) seen.push(m[1]);
    return seen;
  }

  function rolesFor(markup) {
    var out = {};
    var n = [0, 0, 0];
    varsIn(markup).forEach(function (v) {
      if (WI_FIXED[v]) { out[v] = WI_FIXED[v]; return; }
      var g = WI_GENERIC.exec(v);
      if (g) { out[v] = g[1]; return; }
      for (var f = 0; f < WI_SLOT.length; f++) {
        if (WI_SLOT[f].test(v)) {
          out[v] = WI_SLOTS[Math.min(n[f], WI_SLOTS.length - 1)];
          n[f]++;
          return;
        }
      }
    });
    return out;
  }

  function roleMap(colors) {
    var out = {};
    if (!colors) return out;
    if (!Array.isArray(colors)) {
      WI_ROLES.forEach(function (role) {
        var c = safeColor(colors[role]);
        if (c) out[role] = c;
      });
      return out;
    }
    for (var i = 0; i < WI_ROLES.length && i < colors.length; i++) {
      var c = safeColor(colors[i]);
      if (c) out[WI_ROLES[i]] = c;
    }
    return out;
  }

  var BRAND_FALLBACK = null;
  function brandPalettes() {
    var index = memory.withicons;
    var list = index && index.brand && index.brand.length ? index.brand : brandFallback();
    return list.slice();
  }

  function brandFallback() {
    if (BRAND_FALLBACK) return BRAND_FALLBACK;
    BRAND_FALLBACK = [
      { id: 'amethyst', name: 'Amethyst', colors: ['#2A2154', '#7457F0', '#A894F6', '#4E36C9', '#C8B8FF', '#E4DCFF', '#8B6CF6', '#1E1638', '#FFFFFF', '#D9CEFF'] },
      { id: 'champagne-gold', name: 'Champagne Gold', colors: ['#2A1F0A', '#E2B15A', '#F2D594', '#B9832F', '#F7E7C4', '#FBF3E0', '#E2B15A', '#3A2A10', '#FFFFFF', '#F2D594'] },
      { id: 'rose', name: 'Rose', colors: ['#3A1424', '#E0668E', '#F2A8C0', '#B53D68', '#F8D0DE', '#FDE8EF', '#E0668E', '#4A1830', '#FFFFFF', '#F6C3D4'] },
      { id: 'sapphire', name: 'Sapphire', colors: ['#0E1B4A', '#2F6BFF', '#8AADFF', '#1D4ED8', '#D6E2FF', '#E8EFFF', '#2F6BFF', '#0A1230', '#FFFFFF', '#C5D6FF'] },
      { id: 'jade', name: 'Jade', colors: ['#063528', '#17A37A', '#7DDCB8', '#0E7A5B', '#C8F3E4', '#E5FAF3', '#17A37A', '#04241C', '#FFFFFF', '#B7EBD8'] },
      { id: 'copper', name: 'Copper', colors: ['#3A1E0C', '#D07A45', '#E7B08A', '#A85A2C', '#F3D7C4', '#F8EBE1', '#D07A45', '#2A1408', '#FFFFFF', '#E8C4A8'] },
      { id: 'obsidian', name: 'Obsidian', colors: ['#110F17', '#2A1A3E', '#5C4A72', '#110F17', '#8A7A9E', '#D4CCE0', '#7457F0', '#07060C', '#F4F1EA', '#3A2A4E'] },
      { id: 'pearl', name: 'Pearl', colors: ['#3A342C', '#FBF8F3', '#E7E1D6', '#C9C0B2', '#FFFFFF', '#F7F2EA', '#E2B15A', '#8A8175', '#FFFFFF', '#E4DDD2'] }
    ];
    return BRAND_FALLBACK;
  }

  var iconPaletteTable = null;
  var iconPaletteFlight = null;

  function cacheRel(rel) {
    var href = abs(rel);
    return fetch(href).then(function (res) {
      if (!res.ok) throw new Error('Asset failed (' + res.status + ')');
      var copy = res.clone();
      var put = window.caches
        ? caches.open(CACHE).then(function (cache) { return cache.put(href, copy); }).catch(function () {})
        : Promise.resolve();
      return put.then(function () { return res.json(); });
    });
  }

  function ensureIconPalettes() {
    if (iconPaletteTable) return Promise.resolve(iconPaletteTable);
    if (iconPaletteFlight) return iconPaletteFlight;
    iconPaletteFlight = readTracked('assets/data/withicons/palettes.json').then(function (hit) {
      iconPaletteTable = hit.data && hit.data.icons ? hit.data : null;
      iconPaletteFlight = null;
      if (!iconPaletteTable) throw new Error('Icon palettes missing');
      return iconPaletteTable;
    }).catch(function (err) {
      iconPaletteFlight = null;
      throw err;
    });
    return iconPaletteFlight;
  }

  function loadIconPalettes(name) {
    return ensureIconPalettes().then(function () { return iconPalettes(name); });
  }

  function isBrandPalette(id) {
    var list = brandPalettes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
    return false;
  }

  function expandPalette(row) {
    var table = iconPaletteTable;
    if (table && typeof row[0] === 'number') {
      var parts = String(table.tuples[row[2]] || '').split(',');
      var colors = [];
      var packed = typeof table.hex === 'string';
      for (var i = 0; i < parts.length; i++) {
        var n = Number(parts[i]);
        colors.push(packed ? '#' + table.hex.substr(n * 6, 6) : (table.hex[n] || ''));
      }
      return { id: table.ids[row[0]], name: table.names[row[1]], colors: colors };
    }
    return { id: row[0], name: row[1], colors: String(row[2] || '').split(',') };
  }

  function iconRows(icon) {
    var rows = iconPaletteTable && iconPaletteTable.icons && iconPaletteTable.icons[icon];
    return rows && rows.length ? rows : null;
  }

  function iconPalettes(styleId) {
    var brand = brandPalettes();
    if (!styleId) return brand;
    var key = String(styleId);
    var meta = styleMeta(key);
    if (meta) {
      var extra = [];
      if (meta.suggested && meta.suggested.length) extra = meta.suggested.slice();
      else if (meta.colorful) {
        var colors = [];
        Object.keys(meta.vars || {}).forEach(function (k) { colors.push(meta.vars[k]); });
        extra.push({ id: 'default', name: meta.name + ' default', colors: colors });
      }
      return extra.concat(brand);
    }
    var rows = iconRows(key);
    if (rows) return rows.map(expandPalette).concat(brand);
    return brand;
  }

  function findPalette(icon, id) {
    if (!id || id === 'default') return null;
    var brand = brandPalettes();
    for (var i = 0; i < brand.length; i++) if (brand[i].id === id) return roleMap(brand[i].colors);
    var rows = iconRows(icon);
    if (!rows) return null;
    for (var j = 0; j < rows.length; j++) if (rows[j][0] === id) return roleMap(expandPalette(rows[j]).colors);
    return null;
  }

  function bakeVars(markup, palette) {
    var vars = {};
    if (palette) {
      var map = rolesFor(markup);
      Object.keys(map).forEach(function (v) {
        if (palette[map[v]]) vars[v] = palette[map[v]];
      });
    }
    var s = String(markup);
    var re = /var\(\s*(--with-[\w-]+)\s*,\s*([^()]*?)\s*\)/g;
    for (var n = 0; n < 4; n++) {
      var next = s.replace(re, function (all, v, d) {
        return vars[v] || String(d).replace(/^\s+|\s+$/g, '');
      });
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function withSvg(name, opts) {
    opts = opts || {};
    var parts = splitWith(name);
    var pack = packs[parts.style];
    if (!pack) throw new Error('Style not loaded: ' + parts.style);
    var body = pack.icons && pack.icons[parts.icon];
    if (!body) throw new Error('Unknown asset withicons:' + parts.style + '/' + parts.icon);
    body = scrub(body);
    var palette = opts.colors ? roleMap(opts.colors) : findPalette(parts.icon, opts.palette);
    body = bakeVars(body, palette);
    var ink = safeColor(opts.color) || (palette && palette.ink) || '';
    if (ink) body = body.split('currentColor').join(ink);
    body = prefixIds(body, idPrefix('withicons-' + parts.style + '-' + parts.icon));
    var root = pack.root || {};
    var attrs = '';
    var sawStroke = false;
    Object.keys(root).forEach(function (k) {
      var v = root[k];
      if (typeof v === 'string' && v.indexOf('var(') >= 0) v = bakeVars(v, palette);
      if (v === 'currentColor' && ink) v = ink;
      if (k === 'stroke-width' && opts.strokeWidth != null && isFinite(Number(opts.strokeWidth))) {
        v = String(Math.round(Number(opts.strokeWidth) * 100) / 100);
        sawStroke = true;
      }
      attrs += ' ' + k + '="' + v + '"';
    });
    if (!sawStroke && opts.strokeWidth != null && isFinite(Number(opts.strokeWidth))) {
      attrs += ' stroke-width="' + String(Math.round(Number(opts.strokeWidth) * 100) / 100) + '"';
    }
    var size = opts.size || pack.width || 24;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size + '"' + attrs + '>' + body + '</svg>';
  }

  function shapes() {
    return SHAPES;
  }

  function byteHex(n) {
    var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return h.length < 2 ? '0' + h : h;
  }

  function hslHex(h, s, l) {
    s = s / 100;
    l = l / 100;
    var a = s * Math.min(l, 1 - l);
    function ch(n) {
      var k = (n + h / 30) % 12;
      var c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return byteHex(255 * c);
    }
    return '#' + ch(0) + ch(8) + ch(4);
  }

  function hueRamp(h, s) {
    var L = [97, 94, 88, 77, 65, 53, 44, 36, 29, 22, 14];
    var k = [0.38, 0.55, 0.72, 0.86, 0.96, 1, 1, 0.92, 0.82, 0.68, 0.5];
    var out = [];
    for (var i = 0; i < L.length; i++) out.push(hslHex(h, s * k[i], L[i]));
    return out;
  }

  function colorSets() {
    var sets = [
      { id: 'localeditor', name: 'LocalEditor', group: 'brand', colors: ['#FAFAFA', '#E6EEFF', '#81A6FE', '#3F67D9', '#2E51B6', '#182D6B', '#FEB38C', '#EF8C57', '#14874E', '#141414'] },
      { id: 'amethyst', name: 'Amethyst', group: 'brand', colors: ['#F3EEFF', '#D9CEFF', '#B7A4FA', '#7457F0', '#4E36C9', '#2A2154'] },
      { id: 'champagne', name: 'Champagne', group: 'brand', colors: ['#FBF6EA', '#F2D594', '#E2B15A', '#B9832F', '#6E4E16'] },
      { id: 'rose-brand', name: 'Rose', group: 'brand', colors: ['#FDE8EF', '#F2A8C0', '#E0668E', '#B53D68', '#5C1C34'] },
      { id: 'sapphire-brand', name: 'Sapphire', group: 'brand', colors: ['#E8EFFF', '#8AADFF', '#2F6BFF', '#1D4ED8', '#0E1B4A'] },
      { id: 'jade-brand', name: 'Jade', group: 'brand', colors: ['#E5FAF3', '#7DDCB8', '#17A37A', '#0E7A5B', '#063528'] },
      { id: 'copper-brand', name: 'Copper', group: 'brand', colors: ['#F8EBE1', '#E7B08A', '#D07A45', '#A85A2C', '#3A1E0C'] },
      { id: 'obsidian-brand', name: 'Obsidian', group: 'brand', colors: ['#F4F1EA', '#D4CCE0', '#5C4A72', '#2A1A3E', '#110F17'] },
      { id: 'pearl-brand', name: 'Pearl', group: 'brand', colors: ['#FFFFFF', '#FBF8F3', '#E7E1D6', '#C9C0B2', '#8A8175'] },
      { id: 'ink', name: 'Ink', group: 'neutral', colors: ['#F7F6F8', '#E7E5EB', '#C9C6D0', '#A39EAD', '#7A7486', '#5C5866', '#3E3A48', '#2A2633', '#1A1720', '#110F17'] },
      { id: 'warm-grey', name: 'Warm grey', group: 'neutral', colors: ['#F8F4EE', '#E8E0D4', '#D2C6B6', '#B5A790', '#8F826E', '#6C6152', '#4A4238', '#2C2722'] },
      { id: 'cool-grey', name: 'Cool grey', group: 'neutral', colors: ['#F4F6F8', '#E2E6EC', '#C5CCD6', '#9AA6B5', '#6E7C8F', '#4C5A6C', '#2E3A4A', '#17202B'] },
      { id: 'stone', name: 'Stone', group: 'neutral', colors: ['#F6F4F1', '#E4E0DA', '#C9C2B8', '#A89F92', '#7E756A', '#5C554C', '#3C3832', '#221F1B'] },
      { id: 'warm', name: 'Warm', group: 'mood', colors: ['#FBF3E4', '#F2D594', '#E2B15A', '#D07A45', '#B53D68', '#6E2A3A'] },
      { id: 'cool', name: 'Cool', group: 'mood', colors: ['#E7F4F8', '#B7D6E8', '#6AA8C9', '#2F6BFF', '#1D4ED8', '#163A5F'] },
      { id: 'pastel', name: 'Pastel', group: 'mood', colors: ['#FDE8EF', '#F2D594', '#D7F0E4', '#D6E2FF', '#E4DCFF', '#FBF8F3'] },
      { id: 'earthy', name: 'Earthy', group: 'mood', colors: ['#EFE6D6', '#C4A574', '#8C6A43', '#6B4F3A', '#3E5C45', '#2C3A32'] },
      { id: 'jewel', name: 'Jewel tones', group: 'mood', colors: ['#6B1D4A', '#0E7A5B', '#1D4ED8', '#4E36C9', '#B9832F', '#9B1B3A'] },
      { id: 'neon', name: 'Neon', group: 'mood', colors: ['#E8FF47', '#3DFFB0', '#4D7CFF', '#C44DFF', '#FF4D8D', '#FF6A2A'] },
      { id: 'vintage', name: 'Vintage', group: 'mood', colors: ['#F3E6D0', '#D7B48A', '#B86B4A', '#7E4A3A', '#3E4C3A', '#2A2E38'] },
      { id: 'scandinavian', name: 'Scandinavian', group: 'place', colors: ['#F7F5F2', '#E4E0D8', '#C9C3B8', '#8E99A4', '#5E6A72', '#2C3338'] },
      { id: 'ocean', name: 'Ocean', group: 'place', colors: ['#E5F6F8', '#9FD6DE', '#3AA7B8', '#1D6F8A', '#143E5C', '#0C2438'] },
      { id: 'forest', name: 'Forest', group: 'place', colors: ['#E7F2E4', '#A9CFA0', '#4F8F56', '#1F6B45', '#1B3D32', '#12241C'] },
      { id: 'desert', name: 'Desert', group: 'place', colors: ['#FBF3E4', '#F0D2A0', '#D7A15A', '#C47A45', '#8C4A32', '#4A2C24'] },
      { id: 'sunset', name: 'Sunset', group: 'place', colors: ['#FFE3C4', '#FFB085', '#F2786D', '#C44B7A', '#6B3A8C', '#2A2154'] },
      { id: 'candy', name: 'Candy', group: 'mood', colors: ['#FFD6E8', '#FF8FB8', '#FF6A6A', '#FFD36A', '#7DDCB8', '#8AADFF'] },
      { id: 'coffee', name: 'Coffee', group: 'mood', colors: ['#F6EFE6', '#E2C2A4', '#B88860', '#6F4E37', '#3C2A21', '#1C1410'] },
      { id: 'wedding', name: 'Wedding', group: 'occasion', colors: ['#FBF8F3', '#F6E4EA', '#E7C2CE', '#C9A27A', '#8C6A5A', '#3A2A2E'] },
      { id: 'corporate', name: 'Corporate', group: 'occasion', colors: ['#F4F7FB', '#D5DEEA', '#8AA0B8', '#1E3A5F', '#16324F', '#0E1B2C'] },
      { id: 'diwali', name: 'Diwali', group: 'festive', colors: ['#FFF4DC', '#F4C95D', '#F59E0B', '#E11D48', '#7B2FE0', '#3B0A45'] },
      { id: 'holi', name: 'Holi', group: 'festive', colors: ['#FFE14A', '#FF5C9A', '#7B6CFF', '#3DDC97', '#2F6BFF', '#FBF8F3'] },
      { id: 'spring', name: 'Spring', group: 'season', colors: ['#F4FBE8', '#C8E6A0', '#7BC67E', '#F2A8C0', '#F2D594', '#6AA84F'] },
      { id: 'summer', name: 'Summer', group: 'season', colors: ['#FFF6D8', '#FFD36A', '#FF8A4A', '#2F6BFF', '#17A37A', '#FBF8F3'] },
      { id: 'autumn', name: 'Autumn', group: 'season', colors: ['#F8E6C8', '#E2B15A', '#D07A45', '#A33B24', '#6B3A2A', '#2C2118'] },
      { id: 'winter', name: 'Winter', group: 'season', colors: ['#F7FBFF', '#D5E4F2', '#9BB8D3', '#4E6E8C', '#24344A', '#121820'] },
      { id: 'material', name: 'Material', group: 'system', colors: ['#F44336', '#FF9800', '#FFEB3B', '#4CAF50', '#2196F3', '#673AB7'] },
      { id: 'contrast', name: 'High contrast', group: 'system', colors: ['#110F17', '#FBF8F3', '#2F6BFF', '#FFFFFF', '#B9832F', '#1A1206', '#17A37A', '#04241C'] },
      { id: 'gold-foil', name: 'Gold foil', group: 'metal', colors: ['#FBF3E0', '#F2D594', '#E2B15A', '#B9832F', '#6E4E16', '#2A1F0A'] },
      { id: 'aurora-set', name: 'Aurora', group: 'mood', colors: ['#0C2438', '#1D6F8A', '#3DFFB0', '#7457F0', '#E0668E', '#F2D594'] },
      { id: 'peach', name: 'Peach', group: 'mood', colors: ['#FFF1E6', '#FFD0B5', '#FFAB7A', '#E07A45', '#A24B32'] },
      { id: 'mint', name: 'Mint', group: 'mood', colors: ['#F0FFF8', '#C8F3E4', '#7DDCB8', '#17A37A', '#0E7A5B'] },
      { id: 'midnight', name: 'Midnight', group: 'mood', colors: ['#E4DCFF', '#7457F0', '#3A2A6A', '#1A1440', '#0C0A18'] },
      { id: 'sakura', name: 'Sakura', group: 'mood', colors: ['#FFF5F8', '#FFD0E0', '#FF8FB8', '#E0668E', '#6A2444'] },
      { id: 'terracotta', name: 'Terracotta', group: 'mood', colors: ['#F8E6DC', '#E7B09A', '#C46B4A', '#8C3E2A', '#3E241C'] },
      { id: 'grape', name: 'Grape', group: 'mood', colors: ['#F6F0FF', '#D7C4F5', '#A98BFF', '#6B46C1', '#3B0764'] },
      { id: 'sand', name: 'Sand', group: 'place', colors: ['#FBF6EE', '#EFE2CC', '#D9C4A0', '#B89A6A', '#7A6244'] },
      { id: 'glacier', name: 'Glacier', group: 'place', colors: ['#F5FBFF', '#D7EEF8', '#9FD4E8', '#5BA4C4', '#1E4E68'] },
      { id: 'navy', name: 'Navy', group: 'occasion', colors: ['#E8EEF8', '#B7C6E0', '#5C78A8', '#1E3A5F', '#0E1B2C'] },
      { id: 'blush', name: 'Blush', group: 'occasion', colors: ['#FFF8F6', '#F8D7E3', '#E7A8BE', '#C46B8A', '#6A3048'] },
      { id: 'festival-night', name: 'Festival night', group: 'festive', colors: ['#1A0B2E', '#4E36C9', '#E0668E', '#F2D594', '#FBF8F3'] }
    ];
    var hues = [
      ['red', 'Red', 4], ['orange', 'Orange', 28], ['amber', 'Amber', 42], ['yellow', 'Yellow', 52],
      ['lime', 'Lime', 88], ['green', 'Green', 142], ['teal', 'Teal', 168], ['cyan', 'Cyan', 192],
      ['sky', 'Sky', 206], ['blue', 'Blue', 226], ['violet', 'Violet', 268], ['pink', 'Pink', 338]
    ];
    for (var i = 0; i < hues.length; i++) {
      sets.push({ id: hues[i][0], name: hues[i][1], group: 'ramp', colors: hueRamp(hues[i][2], 78) });
    }
    return sets;
  }

  function gradStops(colors) {
    var out = [];
    for (var i = 0; i < colors.length; i++) out.push({ color: colors[i], at: colors.length === 1 ? 0 : i / (colors.length - 1) });
    return out;
  }

  function gradCss(type, angle, stops, at) {
    var list = stops.map(function (s) { return s.color + ' ' + Math.round(s.at * 100) + '%'; }).join(', ');
    if (type === 'radial') return 'radial-gradient(circle at ' + (at || '50% 40%') + ', ' + list + ')';
    if (type === 'conic') return 'conic-gradient(from ' + (angle || 0) + 'deg, ' + list + ')';
    return 'linear-gradient(' + (angle || 135) + 'deg, ' + list + ')';
  }

  function gradients() {
    var named = [
      ['aurora', 'Aurora', 'sky', '#0C2438', '#1D6F8A', '#3DDC97', '#7457F0'],
      ['sunset-glow', 'Sunset', 'sky', '#2A2154', '#C44B7A', '#F2786D', '#F2D594'],
      ['ocean-deep', 'Ocean', 'water', '#0C2438', '#1D6F8A', '#3AA7B8', '#E5F6F8'],
      ['peach-cream', 'Peach', 'soft', '#FFF1E6', '#FFD0B5', '#E07A45'],
      ['mint-air', 'Mint', 'soft', '#F0FFF8', '#7DDCB8', '#0E7A5B'],
      ['gold-foil', 'Gold foil', 'metal', '#6E4E16', '#E2B15A', '#FBF3E0', '#B9832F'],
      ['chrome', 'Chrome', 'metal', '#1A1E2A', '#8794AA', '#F4F7FC', '#5E6A82'],
      ['holo', 'Holographic', 'metal', '#FF5C9A', '#F2D594', '#3DFFB0', '#7457F0', '#2F6BFF'],
      ['amethyst-wash', 'Amethyst', 'brand', '#2A2154', '#7457F0', '#E4DCFF'],
      ['rose-wash', 'Rose', 'brand', '#5C1C34', '#E0668E', '#FDE8EF'],
      ['sapphire-wash', 'Sapphire', 'brand', '#0E1B4A', '#2F6BFF', '#E8EFFF'],
      ['jade-wash', 'Jade', 'brand', '#063528', '#17A37A', '#E5FAF3'],
      ['champagne', 'Champagne', 'brand', '#2A1F0A', '#E2B15A', '#F2D594', '#FBF8F3'],
      ['obsidian-glow', 'Obsidian', 'brand', '#07060C', '#2A1A3E', '#7457F0'],
      ['forest-mist', 'Forest', 'place', '#12241C', '#1F6B45', '#C8F3E4'],
      ['desert-sun', 'Desert', 'place', '#4A2C24', '#D07A45', '#FBF3E4'],
      ['candy-pop', 'Candy', 'play', '#FF5C9A', '#FFD36A', '#7DDCB8', '#8AADFF'],
      ['diwali-night', 'Diwali', 'festive', '#3B0A45', '#E11D48', '#F4C95D'],
      ['holi-dust', 'Holi', 'festive', '#7B6CFF', '#FF5C9A', '#FFE14A', '#3DDC97'],
      ['sakura-fall', 'Sakura', 'soft', '#6A2444', '#FF8FB8', '#FFF5F8'],
      ['midnight', 'Midnight', 'night', '#0C0A18', '#3A2A6A', '#7457F0'],
      ['glacier', 'Glacier', 'water', '#1E4E68', '#9FD4E8', '#F5FBFF'],
      ['coffee-crema', 'Coffee', 'warm', '#1C1410', '#6F4E37', '#E2C2A4'],
      ['blush-veil', 'Blush', 'soft', '#6A3048', '#E7A8BE', '#FFF8F6'],
      ['navy-dawn', 'Navy dawn', 'place', '#0E1B2C', '#1E3A5F', '#F4F7FB']
    ];
    var out = [];
    var duos = [
      ['duo-amethyst-rose', 'Amethyst / rose', '#7457F0', '#E0668E'],
      ['duo-sapphire-gold', 'Sapphire / gold', '#2F6BFF', '#E2B15A'],
      ['duo-jade-copper', 'Jade / copper', '#17A37A', '#D07A45'],
      ['duo-ink-pearl', 'Ink / pearl', '#110F17', '#FBF8F3'],
      ['duo-night-foil', 'Night / foil', '#2A1A3E', '#F2D594'],
      ['duo-ocean-sand', 'Ocean / sand', '#1D6F8A', '#E8D2A8'],
      ['duo-berry-cream', 'Berry / cream', '#B53D68', '#FBF3E0'],
      ['duo-violet-mint', 'Violet / mint', '#6B46C1', '#7DDCB8']
    ];
    duos.forEach(function (row) { named.push([row[0], row[1], 'duotone', row[2], row[3]]); });
    named.forEach(function (row, i) {
      var colors = row.slice(3);
      var stops = gradStops(colors);
      var angle = 120 + (i % 5) * 18;
      out.push({ id: row[0], name: row[1], group: row[2], type: 'linear', angle: angle, stops: stops, css: gradCss('linear', angle, stops) });
      out.push({ id: row[0] + '-radial', name: row[1] + ' radial', group: row[2], type: 'radial', angle: 0, stops: stops, css: gradCss('radial', 0, stops, (i % 2 ? '30% 30%' : '70% 20%')) });
    });
    var conics = [
      ['conic-spectrum', 'Spectrum', '#FF5C9A', '#F2D594', '#3DDC97', '#2F6BFF', '#7457F0', '#FF5C9A'],
      ['conic-foil', 'Foil wheel', '#B9832F', '#F2D594', '#FBF8F3', '#E2B15A', '#B9832F'],
      ['conic-dusk', 'Dusk wheel', '#2A2154', '#C44B7A', '#F2D594', '#1D6F8A', '#2A2154'],
      ['conic-jewel', 'Jewel wheel', '#6B1D4A', '#0E7A5B', '#1D4ED8', '#B9832F', '#6B1D4A'],
      ['conic-holo', 'Holo wheel', '#FF4D8D', '#FFD36A', '#3DFFB0', '#4D7CFF', '#C44DFF', '#FF4D8D'],
      ['conic-ink', 'Ink wheel', '#110F17', '#5C5866', '#FBF8F3', '#5C5866', '#110F17']
    ];
    conics.forEach(function (row) {
      var stops = gradStops(row.slice(2));
      out.push({ id: row[0], name: row[1], group: 'conic', type: 'conic', angle: 0, stops: stops, css: gradCss('conic', 0, stops) });
    });
    var meshes = [
      ['mesh-aurora', 'Aurora mesh', [[12, 20, '#3DFFB0', 55], [78, 18, '#7457F0', 60], [70, 78, '#E0668E', 50], [20, 80, '#1D6F8A', 48]]],
      ['mesh-sunset', 'Sunset mesh', [[20, 80, '#F2786D', 62], [80, 30, '#F2D594', 55], [50, 50, '#C44B7A', 40], [10, 10, '#2A2154', 45]]],
      ['mesh-ocean', 'Ocean mesh', [[30, 20, '#E5F6F8', 50], [75, 40, '#1D6F8A', 58], [40, 85, '#0C2438', 52]]],
      ['mesh-peach', 'Peach mesh', [[25, 30, '#FFD0B5', 60], [70, 60, '#E07A45', 50], [50, 15, '#FFF1E6', 40]]],
      ['mesh-mint', 'Mint mesh', [[20, 70, '#7DDCB8', 58], [75, 25, '#F0FFF8', 48], [60, 80, '#0E7A5B', 36]]],
      ['mesh-gold', 'Gold mesh', [[30, 20, '#F2D594', 55], [70, 65, '#B9832F', 50], [50, 50, '#FBF3E0', 30]]],
      ['mesh-chrome', 'Chrome mesh', [[20, 30, '#F4F7FC', 45], [70, 20, '#8794AA', 50], [50, 80, '#1A1E2A', 55]]],
      ['mesh-holo', 'Holo mesh', [[15, 25, '#FF5C9A', 48], [80, 20, '#2F6BFF', 46], [70, 75, '#3DFFB0', 44], [25, 80, '#F2D594', 42]]],
      ['mesh-brand', 'Brand mesh', [[18, 22, '#7457F0', 52], [82, 28, '#E0668E', 48], [60, 78, '#E2B15A', 46], [20, 75, '#2F6BFF', 40]]],
      ['mesh-blush', 'Blush mesh', [[30, 30, '#F8D7E3', 60], [75, 55, '#C46B8A', 48], [40, 80, '#FFF8F6', 36]]],
      ['mesh-forest', 'Forest mesh', [[25, 70, '#1F6B45', 55], [70, 30, '#C8F3E4', 48], [50, 50, '#12241C', 40]]],
      ['mesh-night', 'Night mesh', [[20, 20, '#7457F0', 40], [80, 70, '#E0668E', 36], [50, 50, '#0C0A18', 70]]]
    ];
    meshes.forEach(function (row) {
      var layers = row[2];
      var css = layers.map(function (L) {
        return 'radial-gradient(circle at ' + L[0] + '% ' + L[1] + '%, ' + L[2] + ' 0%, rgba(0,0,0,0) ' + L[3] + '%)';
      }).join(', ');
      out.push({
        id: row[0],
        name: row[1],
        group: 'mesh',
        type: 'mesh',
        angle: 0,
        stops: layers.map(function (L) { return { color: L[2], at: 0, x: L[0] / 100, y: L[1] / 100, r: L[3] / 100 }; }),
        css: css
      });
    });
    return out;
  }

  function tileSvg(size, bg, body) {
    var s = Math.max(8, Math.round(Number(size) || 32));
    var paint = safeColor(bg);
    var back = paint && paint !== 'transparent' ? '<rect width="' + s + '" height="' + s + '" fill="' + paint + '"/>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' + back + body + '</svg>';
  }

  function patternBody(kind, s, fg) {
    var h = s / 2;
    var q = s / 4;
    var u = rnd(s);
    if (kind === 'dots') return '<circle cx="' + rnd(h) + '" cy="' + rnd(h) + '" r="' + rnd(s * 0.08) + '" fill="' + fg + '"/>';
    if (kind === 'polka') return '<circle cx="0" cy="0" r="' + rnd(s * 0.12) + '" fill="' + fg + '"/><circle cx="' + u + '" cy="0" r="' + rnd(s * 0.12) + '" fill="' + fg + '"/><circle cx="0" cy="' + u + '" r="' + rnd(s * 0.12) + '" fill="' + fg + '"/><circle cx="' + u + '" cy="' + u + '" r="' + rnd(s * 0.12) + '" fill="' + fg + '"/><circle cx="' + rnd(h) + '" cy="' + rnd(h) + '" r="' + rnd(s * 0.12) + '" fill="' + fg + '"/>';
    if (kind === 'grid') return '<path d="M0 0H' + u + 'M0 0V' + u + 'M0 ' + rnd(h) + 'H' + u + 'M' + rnd(h) + ' 0V' + u + '" fill="none" stroke="' + fg + '" stroke-width="1"/>';
    if (kind === 'graph') return '<path d="M0 ' + rnd(q) + 'H' + u + 'M0 ' + rnd(h) + 'H' + u + 'M0 ' + rnd(q * 3) + 'H' + u + 'M' + rnd(q) + ' 0V' + u + 'M' + rnd(h) + ' 0V' + u + 'M' + rnd(q * 3) + ' 0V' + u + '" fill="none" stroke="' + fg + '" stroke-width="0.6" opacity="0.85"/>';
    if (kind === 'stripes') return '<rect x="0" width="' + rnd(q) + '" height="' + u + '" fill="' + fg + '"/><rect x="' + rnd(h) + '" width="' + rnd(q) + '" height="' + u + '" fill="' + fg + '"/>';
    if (kind === 'stripes-wide') return '<rect width="' + rnd(h) + '" height="' + u + '" fill="' + fg + '"/>';
    if (kind === 'diagonal') return '<path d="M' + rnd(-q) + ' ' + u + 'L' + u + ' ' + rnd(-q) + 'M' + rnd(h) + ' ' + rnd(s + q) + 'L' + rnd(s + q) + ' ' + rnd(h) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(s * 0.08) + '"/>';
    if (kind === 'diagonal-wide') return '<path d="M' + rnd(-h) + ' ' + u + 'L' + u + ' ' + rnd(-h) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(h) + '"/>';
    if (kind === 'chevron') return '<path d="M0 ' + rnd(q) + 'L' + rnd(h) + ' ' + rnd(h) + 'L' + u + ' ' + rnd(q) + 'M0 ' + rnd(h + q) + 'L' + rnd(h) + ' ' + u + 'L' + u + ' ' + rnd(h + q) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(s * 0.08) + '" stroke-linejoin="miter"/>';
    if (kind === 'waves') return '<path d="M0 ' + rnd(h) + 'C' + rnd(q) + ' ' + rnd(q) + ' ' + rnd(q) + ' ' + rnd(h + q) + ' ' + rnd(h) + ' ' + rnd(h) + 'S' + rnd(h + q) + ' ' + rnd(q) + ' ' + u + ' ' + rnd(h) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(s * 0.06) + '"/>';
    if (kind === 'scallops') return '<path d="M0 ' + rnd(h) + 'A' + rnd(q) + ' ' + rnd(q) + ' 0 0 1 ' + rnd(h) + ' ' + rnd(h) + 'A' + rnd(q) + ' ' + rnd(q) + ' 0 0 1 ' + u + ' ' + rnd(h) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(s * 0.06) + '"/>';
    if (kind === 'checker') return '<rect width="' + rnd(h) + '" height="' + rnd(h) + '" fill="' + fg + '"/><rect x="' + rnd(h) + '" y="' + rnd(h) + '" width="' + rnd(h) + '" height="' + rnd(h) + '" fill="' + fg + '"/>';
    if (kind === 'gingham') return '<rect width="' + rnd(h) + '" height="' + u + '" fill="' + fg + '" opacity="0.35"/><rect y="' + rnd(h) + '" width="' + u + '" height="' + rnd(h) + '" fill="' + fg + '" opacity="0.35"/><rect width="' + rnd(h) + '" height="' + rnd(h) + '" fill="' + fg + '" opacity="0.45"/>';
    if (kind === 'houndstooth') return '<path fill="' + fg + '" d="M0 0H' + rnd(h) + 'L0 ' + rnd(h) + 'ZM' + rnd(h) + ' ' + rnd(h) + 'H' + u + 'L' + rnd(h) + ' ' + u + 'Z"/>';
    if (kind === 'terrazzo') return '<path fill="' + fg + '" d="M' + rnd(q) + ' ' + rnd(q * 0.4) + 'l' + rnd(q) + ' ' + rnd(q * 0.3) + 'l-' + rnd(q * 0.2) + ' ' + rnd(q) + 'zM' + rnd(h + q) + ' ' + rnd(q) + 'l' + rnd(q * 0.7) + ' ' + rnd(q * 0.5) + 'l-' + rnd(q) + ' ' + rnd(q * 0.2) + 'zM' + rnd(q) + ' ' + rnd(h + q * 0.4) + 'l' + rnd(q * 0.8) + ' -' + rnd(q * 0.2) + 'l' + rnd(q * 0.2) + ' ' + rnd(q) + 'z"/>';
    if (kind === 'confetti') return '<rect x="' + rnd(q) + '" y="' + rnd(q * 0.5) + '" width="' + rnd(s * 0.08) + '" height="' + rnd(s * 0.16) + '" fill="' + fg + '" transform="rotate(20 ' + rnd(q) + ' ' + rnd(q) + ')"/><rect x="' + rnd(h) + '" y="' + rnd(h) + '" width="' + rnd(s * 0.07) + '" height="' + rnd(s * 0.14) + '" fill="' + fg + '" transform="rotate(-25 ' + rnd(h) + ' ' + rnd(h) + ')"/><circle cx="' + rnd(h + q) + '" cy="' + rnd(q) + '" r="' + rnd(s * 0.05) + '" fill="' + fg + '"/>';
    if (kind === 'stars') return '<path fill="' + fg + '" transform="translate(' + rnd(s * 0.22) + ' ' + rnd(s * 0.22) + ')" d="' + starPath(s * 0.56, s * 0.56, 5, 0.42) + '"/>';
    if (kind === 'hearts') return '<path fill="' + fg + '" transform="translate(' + rnd(s * 0.22) + ' ' + rnd(s * 0.18) + ') scale(' + rnd(s / 48) + ')" d="M12 20.5C12 20.5 3 15.2 3 8.9 3 6.2 5.1 4 7.8 4 9.6 4 11.1 5 12 6.5 12.9 5 14.4 4 16.2 4 18.9 4 21 6.2 21 8.9 21 15.2 12 20.5 12 20.5Z"/>';
    if (kind === 'plus') return '<path stroke="' + fg + '" stroke-width="' + rnd(s * 0.08) + '" d="M' + rnd(h) + ' ' + rnd(q) + 'V' + rnd(h + q) + 'M' + rnd(q) + ' ' + rnd(h) + 'H' + rnd(h + q) + '"/>';
    if (kind === 'triangles') return '<path fill="' + fg + '" d="M0 ' + u + 'L' + rnd(h) + ' 0L' + u + ' ' + u + 'Z"/>';
    if (kind === 'hex') {
      var r = s * 0.22;
      function hexAt(cx, cy) {
        var d = '';
        for (var i = 0; i < 6; i++) {
          var a = Math.PI / 6 + i * Math.PI / 3;
          d += (i ? 'L' : 'M') + rnd(cx + Math.cos(a) * r) + ' ' + rnd(cy + Math.sin(a) * r);
        }
        return d + 'Z';
      }
      return '<path fill="none" stroke="' + fg + '" stroke-width="1" d="' + hexAt(h, h) + hexAt(0, 0) + hexAt(s, 0) + hexAt(0, s) + hexAt(s, s) + '"/>';
    }
    if (kind === 'crosshatch') return '<path d="M0 0L' + u + ' ' + u + 'M0 ' + u + 'L' + u + ' 0" fill="none" stroke="' + fg + '" stroke-width="1"/>';
    if (kind === 'grain') {
      var dots = '';
      for (var g = 0; g < 18; g++) {
        var gx = ((g * 47) % 100) / 100 * s;
        var gy = ((g * 83) % 100) / 100 * s;
        dots += '<circle cx="' + rnd(gx) + '" cy="' + rnd(gy) + '" r="' + rnd(0.6 + (g % 3) * 0.35) + '" fill="' + fg + '" opacity="0.55"/>';
      }
      return dots;
    }
    if (kind === 'paper') return patternBody('grain', s, fg);
    if (kind === 'linen') return '<path d="M0 ' + rnd(q) + 'H' + u + 'M0 ' + rnd(h) + 'H' + u + 'M0 ' + rnd(q * 3) + 'H' + u + 'M' + rnd(q) + ' 0V' + u + 'M' + rnd(h) + ' 0V' + u + 'M' + rnd(q * 3) + ' 0V' + u + '" fill="none" stroke="' + fg + '" stroke-width="0.5" opacity="0.7"/>';
    if (kind === 'rangoli') return '<circle cx="' + rnd(h) + '" cy="' + rnd(h) + '" r="' + rnd(s * 0.06) + '" fill="' + fg + '"/><circle cx="' + rnd(h) + '" cy="' + rnd(q) + '" r="' + rnd(s * 0.035) + '" fill="' + fg + '"/><circle cx="' + rnd(h) + '" cy="' + rnd(h + q) + '" r="' + rnd(s * 0.035) + '" fill="' + fg + '"/><circle cx="' + rnd(q) + '" cy="' + rnd(h) + '" r="' + rnd(s * 0.035) + '" fill="' + fg + '"/><circle cx="' + rnd(h + q) + '" cy="' + rnd(h) + '" r="' + rnd(s * 0.035) + '" fill="' + fg + '"/>';
    if (kind === 'memphis') return '<circle cx="' + rnd(q) + '" cy="' + rnd(q) + '" r="' + rnd(s * 0.08) + '" fill="none" stroke="' + fg + '" stroke-width="1.5"/><path d="M' + rnd(h) + ' ' + rnd(h) + 'l' + rnd(q) + ' ' + rnd(q * 0.6) + 'l-' + rnd(q) + ' ' + rnd(q * 0.3) + 'z" fill="' + fg + '"/><path d="M' + rnd(q) + ' ' + rnd(h + q) + 'H' + rnd(h) + '" stroke="' + fg + '" stroke-width="2"/>';
    if (kind === 'diamonds') return '<path fill="' + fg + '" d="M' + rnd(h) + ' 0L' + u + ' ' + rnd(h) + 'L' + rnd(h) + ' ' + u + 'L0 ' + rnd(h) + 'Z"/>';
    if (kind === 'zigzag') return '<path d="M0 ' + rnd(h) + 'L' + rnd(q) + ' ' + rnd(q) + 'L' + rnd(h) + ' ' + rnd(h) + 'L' + rnd(h + q) + ' ' + rnd(q) + 'L' + u + ' ' + rnd(h) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(s * 0.06) + '"/>';
    if (kind === 'rings') return '<circle cx="' + rnd(h) + '" cy="' + rnd(h) + '" r="' + rnd(s * 0.18) + '" fill="none" stroke="' + fg + '" stroke-width="1.25"/><circle cx="0" cy="0" r="' + rnd(s * 0.12) + '" fill="none" stroke="' + fg + '" stroke-width="1.25"/><circle cx="' + u + '" cy="0" r="' + rnd(s * 0.12) + '" fill="none" stroke="' + fg + '" stroke-width="1.25"/><circle cx="0" cy="' + u + '" r="' + rnd(s * 0.12) + '" fill="none" stroke="' + fg + '" stroke-width="1.25"/><circle cx="' + u + '" cy="' + u + '" r="' + rnd(s * 0.12) + '" fill="none" stroke="' + fg + '" stroke-width="1.25"/>';
    if (kind === 'dashed') return '<path d="M0 ' + rnd(h) + 'H' + u + 'M' + rnd(h) + ' 0V' + u + '" fill="none" stroke="' + fg + '" stroke-width="1.25" stroke-dasharray="3 3"/>';
    if (kind === 'waves-double') return patternBody('waves', s, fg) + '<path d="M0 ' + rnd(h + q * 0.7) + 'C' + rnd(q) + ' ' + rnd(h) + ' ' + rnd(q) + ' ' + rnd(s * 0.9) + ' ' + rnd(h) + ' ' + rnd(h + q * 0.7) + 'S' + rnd(h + q) + ' ' + rnd(h) + ' ' + u + ' ' + rnd(h + q * 0.7) + '" fill="none" stroke="' + fg + '" stroke-width="' + rnd(s * 0.045) + '"/>';
    return '';
  }

  function patterns() {
    var list = [
      ['dots', 'Dots', 'basic', 24], ['polka', 'Polka', 'basic', 32], ['grid', 'Grid', 'basic', 32],
      ['graph', 'Graph paper', 'basic', 32], ['stripes', 'Stripes', 'lines', 24], ['stripes-wide', 'Wide stripes', 'lines', 24],
      ['diagonal', 'Diagonal', 'lines', 32], ['diagonal-wide', 'Wide diagonal', 'lines', 32],
      ['chevron', 'Chevron', 'lines', 32], ['waves', 'Waves', 'lines', 36], ['scallops', 'Scallops', 'lines', 32],
      ['checker', 'Checker', 'classic', 32], ['gingham', 'Gingham', 'classic', 32], ['houndstooth', 'Houndstooth', 'classic', 32],
      ['terrazzo', 'Terrazzo', 'play', 40], ['confetti', 'Confetti', 'play', 40], ['stars', 'Stars', 'play', 36],
      ['hearts', 'Hearts', 'play', 36], ['plus', 'Plus', 'basic', 28], ['triangles', 'Triangles', 'basic', 28],
      ['hex', 'Hexagons', 'basic', 36], ['crosshatch', 'Cross-hatch', 'texture', 24], ['grain', 'Grain', 'texture', 32],
      ['paper', 'Paper', 'texture', 32], ['linen', 'Linen', 'texture', 28], ['rangoli', 'Rangoli', 'motif', 36],
      ['memphis', 'Memphis', 'play', 40], ['diamonds', 'Diamonds', 'classic', 28], ['zigzag', 'Zigzag', 'lines', 32],
      ['rings', 'Rings', 'basic', 32], ['dashed', 'Dashed grid', 'basic', 28], ['waves-double', 'Double waves', 'lines', 40]
    ];
    return list.map(function (row) {
      return {
        id: row[0],
        name: row[1],
        group: row[2],
        tile: row[3],
        svg: function (tileSize, fg, bg) {
          var s = Math.max(8, Math.round(Number(tileSize) || row[3]));
          var ink = safeColor(fg) || '#110F17';
          return tileSvg(s, bg || 'transparent', patternBody(row[0], s, ink));
        }
      };
    });
  }

  function paintNoise(ctx, w, h, color, amount, base) {
    ctx.fillStyle = color;
    ctx.globalAlpha = base;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = ((i * 17) % 255) - 128;
      d[i] = Math.max(0, Math.min(255, d[i] + n * amount / 128));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * amount / 160));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * amount / 180));
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function textures() {
    return [
      { id: 'grain', name: 'Grain', draw: function (ctx, w, h, color) { paintNoise(ctx, w, h, color || '#C9C0B2', 46, 1); } },
      { id: 'paper', name: 'Paper', draw: function (ctx, w, h, color) { paintNoise(ctx, w, h, color || '#F4EFE6', 22, 1); } },
      { id: 'canvas', name: 'Canvas', draw: function (ctx, w, h, color) {
        paintNoise(ctx, w, h, color || '#E7E1D4', 18, 1);
        ctx.strokeStyle = 'rgba(17,15,23,0.08)';
        ctx.lineWidth = 1;
        for (var y = 0; y < h; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      } },
      { id: 'concrete', name: 'Concrete', draw: function (ctx, w, h, color) { paintNoise(ctx, w, h, color || '#B7B5B0', 70, 1); } }
    ];
  }

  var LE = window.LE = window.LE || {};
  LE.assets = {
    sets: sets,
    load: load,
    search: search,
    svg: svg,
    image: image,
    shapes: shapes,
    saveAllOffline: saveAllOffline,
    iconStyles: iconStyles,
    loadStyle: loadStyle,
    isStyleOffline: isStyleOffline,
    saveStyleOffline: saveStyleOffline,
    removeStyleOffline: removeStyleOffline,
    styleUsage: styleUsage,
    iconPalettes: iconPalettes,
    loadIconPalettes: loadIconPalettes,
    colorSets: colorSets,
    gradients: gradients,
    patterns: patterns,
    textures: textures
  };
})();
