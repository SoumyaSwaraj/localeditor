/* Collage data: the style catalogue loader plus the pure geometry the builder and agents use.
   Nothing here touches the DOM. Layouts are generated, not hard-coded, so any photo count works.

   A layout is { id, name, cells: [[x, y, w, h], ...] } in 0..1 units of the content box
   (the page minus the outer margin). rects() turns a collage meta block into page pixels:
   interior cell edges are inset by spacing / 2, so every gap is exactly `spacing`. */
(function () {
  'use strict';

  var CACHE = 'le-assets-v1';
  var DIR = 'assets/data/collages/';
  var indexData = null;
  var indexFlight = null;
  var photoData = null;
  var photoFlight = null;
  var packs = {};
  var flights = {};

  function base() {
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root;
  }

  function abs(rel) {
    return new URL(base() + String(rel || '').replace(/^\//, ''), document.baseURI).href;
  }

  function readJson(rel) {
    var href = abs(rel);
    function fromNet() {
      return fetch(href).then(function (res) {
        if (!res.ok) throw new Error('Collage data failed (' + res.status + ')');
        var copy = res.clone();
        var put = window.caches
          ? caches.open(CACHE).then(function (cache) { return cache.put(href, copy); }).catch(function () {})
          : Promise.resolve();
        return put.then(function () { return res.json(); });
      });
    }
    if (!window.caches) return fromNet();
    return caches.open(CACHE).then(function (cache) {
      return cache.match(href).then(function (hit) { return hit ? hit.json() : fromNet(); });
    }).catch(fromNet);
  }

  function index() {
    if (indexData) return Promise.resolve(indexData);
    if (indexFlight) return indexFlight;
    indexFlight = readJson(DIR + 'index.json').then(function (data) {
      indexData = data;
      indexFlight = null;
      return data;
    }, function (err) {
      indexFlight = null;
      throw err;
    });
    return indexFlight;
  }

  function loadStyle(id) {
    var key = String(id || '');
    if (!/^[a-z0-9-]{1,48}$/.test(key)) return Promise.reject(new Error('Unknown collage style'));
    if (packs[key]) return Promise.resolve(packs[key]);
    if (flights[key]) return flights[key];
    flights[key] = index().then(function () {
      return readJson(DIR + key + '.json');
    }).then(function (data) {
      packs[key] = data;
      delete flights[key];
      return data;
    }, function (err) {
      delete flights[key];
      throw err;
    });
    return flights[key];
  }

  function photos() {
    if (photoData) return Promise.resolve(photoData);
    if (photoFlight) return photoFlight;
    photoFlight = readJson(DIR + 'photos.json').then(function (data) {
      photoData = data;
      photoFlight = null;
      return data;
    }, function (err) {
      photoFlight = null;
      throw err;
    });
    return photoFlight;
  }

  /* ---------- Geometry ---------- */

  var ASPECTS = [
    { id: '1:1', name: 'Square', w: 1080, h: 1080 },
    { id: '4:5', name: 'Portrait', w: 1080, h: 1350 },
    { id: '9:16', name: 'Story', w: 1080, h: 1920 },
    { id: '16:9', name: 'Wide', w: 1920, h: 1080 },
    { id: '3:2', name: 'Photo', w: 1800, h: 1200 },
    { id: '2:3', name: 'Poster', w: 1200, h: 1800 }
  ];
  var MAX_CELLS = 20;
  var DEFAULTS = { spacing: 16, margin: 24, radius: 0, border: { width: 0, color: '#FFFFFF' } };

  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

  function aspectFor(w, h) {
    for (var i = 0; i < ASPECTS.length; i++) {
      if (Math.abs(ASPECTS[i].w / ASPECTS[i].h - w / h) < 0.01) return ASPECTS[i].id;
    }
    return 'custom';
  }

  /* Rows of equal height; counts[i] cells in row i. Transposed for columns. */
  function rowsCells(counts) {
    var out = [];
    var R = counts.length;
    counts.forEach(function (k, r) {
      for (var i = 0; i < k; i++) out.push([i / k, r / R, 1 / k, 1 / R]);
    });
    return out;
  }
  function transpose(cells) { return cells.map(function (c) { return [c[1], c[0], c[3], c[2]]; }); }
  function stripCells(n, x, y, w, h, along) {
    /* Fills a box with n cells in one line, or two lines when n > 3. */
    var out = [];
    var lines = n > 3 ? 2 : 1;
    var first = Math.ceil(n / lines);
    for (var l = 0; l < lines; l++) {
      var k = l === 0 ? first : n - first;
      for (var i = 0; i < k; i++) {
        if (along === 'x') out.push([x + w * i / k, y + h * l / lines, w / k, h / lines]);
        else out.push([x + w * l / lines, y + h * i / k, w / lines, h / k]);
      }
    }
    return out;
  }
  function heroCells(n, side, frac) {
    var rest = n - 1;
    if (side === 'l') return [[0, 0, frac, 1]].concat(stripCells(rest, frac, 0, 1 - frac, 1, 'y'));
    if (side === 'r') return [[1 - frac, 0, frac, 1]].concat(stripCells(rest, 0, 0, 1 - frac, 1, 'y'));
    if (side === 't') return [[0, 0, 1, frac]].concat(stripCells(rest, 0, frac, 1, 1 - frac, 'x'));
    return [[0, 1 - frac, 1, frac]].concat(stripCells(rest, 0, 0, 1, 1 - frac, 'x'));
  }
  function seeded(seed) {
    var a = (seed * 2654435761) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* Guillotine mosaic: split the longer side, with a seeded ratio wobble. */
  function mosaicCells(n, seed, ar) {
    var rnd = seeded(seed + n * 31);
    var out = [];
    (function split(x, y, w, h, k) {
      if (k <= 1) { out.push([x, y, w, h]); return; }
      var a = Math.floor(k / 2);
      if (k > 2 && rnd() < 0.5) a = Math.ceil(k / 2);
      if (k === 3 && rnd() < 0.6) a = 1;
      var t = a / k + (rnd() - 0.5) * 0.18;
      t = clamp(t, 0.28, 0.72);
      if (w * ar >= h) { split(x, y, w * t, h, a); split(x + w * t, y, w * (1 - t), h, k - a); }
      else { split(x, y, w, h * t, a); split(x, y + h * t, w, h * (1 - t), k - a); }
    })(0, 0, 1, 1, n);
    return out;
  }
  function balanced(n, r, extraLast) {
    var b = Math.floor(n / r), e = n % r;
    var out = [];
    for (var i = 0; i < r; i++) out.push(b + ((extraLast ? i >= r - e : i < e) ? 1 : 0));
    return out;
  }
  function clean(cells) { return cells.map(function (c) { return [r4(c[0]), r4(c[1]), r4(c[2]), r4(c[3])]; }); }
  function sig(cells) {
    return cells.map(function (c) { return c.map(function (v) { return Math.round(v * 200); }).join(','); }).sort().join('|');
  }
  /* Lower is better: cells close to the photos' usual 4:3..3:4 shapes, and similar sizes. */
  function score(cells, ar) {
    var s = 0, areas = [];
    cells.forEach(function (c) {
      var a = (c[2] * ar) / c[3];
      s += Math.abs(Math.log(a));
      areas.push(c[2] * c[3]);
    });
    var mean = areas.reduce(function (p, v) { return p + v; }, 0) / areas.length;
    var dev = areas.reduce(function (p, v) { return p + Math.abs(v - mean); }, 0) / areas.length / mean;
    return s / cells.length + dev * 0.25;
  }

  /* Parses a layout id back into cells, so a document (or an agent) can name a layout only. */
  function fromId(id, n, ar) {
    var m = /^(r|c)-([\d.]+)$/.exec(id || '');
    if (m) {
      var counts = m[2].split('.').map(Number).filter(function (v) { return v > 0 && v <= 8; });
      var total = counts.reduce(function (p, v) { return p + v; }, 0);
      if (!counts.length || (n && total !== n)) return null;
      var cells = rowsCells(counts);
      return m[1] === 'c' ? transpose(cells) : cells;
    }
    m = /^h-([lrtb])-(\d+)$/.exec(id || '');
    if (m && n >= 2) return heroCells(n, m[1], clamp(Number(m[2]) / 100, 0.4, 0.8));
    m = /^m-(\d+)$/.exec(id || '');
    if (m && n >= 2) return mosaicCells(n, Number(m[1]), ar || 1);
    return null;
  }

  function layoutName(id) {
    var m = /^(r|c)-([\d.]+)$/.exec(id);
    if (m) {
      var parts = m[2].split('.');
      if (parts.length === 1) return m[1] === 'r' ? (parts[0] === '1' ? 'Single' : 'One row') : 'One column';
      var even = parts.every(function (p) { return p === parts[0]; });
      if (even) return (m[1] === 'r' ? parts.length + ' × ' + parts[0] : parts[0] + ' × ' + parts.length) + ' grid';
      return (m[1] === 'r' ? 'Rows ' : 'Columns ') + parts.join('·');
    }
    m = /^h-([lrtb])/.exec(id);
    if (m) return 'Hero ' + ({ l: 'left', r: 'right', t: 'top', b: 'bottom' })[m[1]];
    if (/^m-/.test(id)) return 'Mosaic ' + id.slice(2);
    return 'Layout';
  }

  /* Every sensible layout for n photos on a page of aspect ar (= width / height), best first. */
  function layouts(n, ar) {
    n = clamp(Math.round(num(n, 1)), 1, MAX_CELLS);
    ar = num(ar, 1) || 1;
    var cand = [];
    function add(id, cells) { if (cells && cells.length === n) cand.push({ id: id, cells: clean(cells) }); }
    if (n === 1) return [{ id: 'r-1', name: 'Single', cells: [[0, 0, 1, 1]] }];
    for (var r = 1; r <= Math.min(n, 6); r++) {
      [false, true].forEach(function (last) {
        var counts = balanced(n, r, last);
        if (counts.some(function (k) { return k > 6; })) return;
        add('r-' + counts.join('.'), rowsCells(counts));
        add('c-' + counts.join('.'), transpose(rowsCells(counts)));
      });
    }
    if (n >= 3 && n <= 9) {
      ['l', 'r', 't', 'b'].forEach(function (s) { add('h-' + s + '-62', heroCells(n, s, 0.62)); });
    }
    if (n === 2) { add('h-l-62', heroCells(2, 'l', 0.62)); add('h-t-62', heroCells(2, 't', 0.62)); }
    if (n >= 3) for (var sd = 1; sd <= 4; sd++) add('m-' + sd, mosaicCells(n, sd, ar));
    var seen = {};
    var uniq = cand.filter(function (c) { var k = sig(c.cells); if (seen[k]) return false; seen[k] = 1; return true; });
    uniq.forEach(function (c) { c.score = score(c.cells, ar); c.name = layoutName(c.id); });
    var grids = uniq.filter(function (c) { return /^[rc]-/.test(c.id); }).sort(function (a, b) { return a.score - b.score; });
    var heroes = uniq.filter(function (c) { return /^h-/.test(c.id); }).sort(function (a, b) { return a.score - b.score; });
    var mosaics = uniq.filter(function (c) { return /^m-/.test(c.id); }).sort(function (a, b) { return a.score - b.score; });
    /* Best grid first, then interleave families so the first row of the chooser shows variety. */
    var out = [];
    var lists = [grids, heroes, mosaics];
    var guard = 0;
    while (out.length < 16 && guard++ < 40) {
      var took = false;
      lists.forEach(function (l) { if (l.length && out.length < 16) { out.push(l.shift()); took = true; } });
      if (!took) break;
    }
    return out.map(function (c) { return { id: c.id, name: c.name, cells: c.cells }; });
  }

  function layoutFor(id, n, ar) {
    var list = layouts(n, ar);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    var cells = fromId(id, n, ar);
    if (cells) return { id: id, name: layoutName(id), cells: clean(cells) };
    return list[0];
  }

  /* Meta block → page-pixel rects, one per cell. */
  function rects(meta, W, H) {
    meta = meta || {};
    var m = clamp(num(meta.margin, DEFAULTS.margin), 0, Math.min(W, H) * 0.4);
    var g = clamp(num(meta.spacing, DEFAULTS.spacing), 0, Math.min(W, H) * 0.3);
    var cw = W - m * 2, ch = H - m * 2;
    var cells = meta.cells || [];
    var e = 1e-3;
    return cells.map(function (c) {
      var x0 = m + c[0] * cw + (c[0] > e ? g / 2 : 0);
      var y0 = m + c[1] * ch + (c[1] > e ? g / 2 : 0);
      var x1 = m + (c[0] + c[2]) * cw - (c[0] + c[2] < 1 - e ? g / 2 : 0);
      var y1 = m + (c[1] + c[3]) * ch - (c[1] + c[3] < 1 - e ? g / 2 : 0);
      return { x: Math.round(x0 * 100) / 100, y: Math.round(y0 * 100) / 100, w: Math.max(8, Math.round((x1 - x0) * 100) / 100), h: Math.max(8, Math.round((y1 - y0) * 100) / 100) };
    });
  }

  /* Cover crop of an iw×ih image into a W×H frame, centred on focal (0..1). */
  function coverCrop(iw, ih, W, H, focal) {
    focal = focal || { x: 0.5, y: 0.5 };
    var A = iw / ih, T = W / H;
    var c = { x: 0, y: 0, w: 1, h: 1 };
    if (A > T) { c.w = T / A; c.x = clamp(focal.x - c.w / 2, 0, 1 - c.w); }
    else { c.h = A / T; c.y = clamp(focal.y - c.h / 2, 0, 1 - c.h); }
    return { x: r6(c.x), y: r6(c.y), w: r6(c.w), h: r6(c.h) };
  }
  function r6(n) { return Math.round(n * 1e6) / 1e6; }
  /* Keeps a crop's centre and zoom when its frame changes shape (layout, spacing, replace). */
  function refitCrop(crop, iw, ih, W, H) {
    crop = crop || { x: 0, y: 0, w: 1, h: 1 };
    if (!iw || !ih || !W || !H) return { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
    var oldA = (crop.w * iw) / (crop.h * ih);
    var oldCover = coverCrop(iw, ih, oldA, 1);
    var zoom = Math.max(1, Math.min(oldCover.w / crop.w, oldCover.h / crop.h) || 1);
    var cover = coverCrop(iw, ih, W, H);
    var w = cover.w / zoom, h = cover.h / zoom;
    var cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    return { x: r6(clamp(cx - w / 2, 0, 1 - w)), y: r6(clamp(cy - h / 2, 0, 1 - h)), w: r6(w), h: r6(h) };
  }

  /* Template (catalogue style) → ordered placement list in page pixels. Pure: no scene calls. */
  function templateItems(tpl, W, H) {
    var sx = W / (tpl.w || W), sy = H / (tpl.h || H);
    var smin = Math.min(sx, sy) || 1;
    var items = [];
    (tpl.slots || []).forEach(function (slot, i) {
      var z = slot.z == null ? i : slot.z;
      var box = { x: (slot.x || 0) * sx, y: (slot.y || 0) * sy, w: Math.max(8, (slot.w || 100) * sx), h: Math.max(8, (slot.h || 100) * sy) };
      items.push({ z: z, kind: 'slot', slot: slot, i: i, box: box, k: smin });
      if (typeof slot.caption === 'string' && slot.caption) {
        var size = Math.max(16, Math.min(box.h * 0.09, 46));
        items.push({ z: z + 0.4, kind: 'decor', spec: {
          type: 'text', text: String(slot.caption), font: 'Caveat', weight: 700, size: size, align: 'center', color: '#2A1F0A',
          name: 'Caption', x: box.x, y: box.y + box.h - size * 1.45, w: box.w, h: size * 1.5
        } });
      } else if (slot.caption && typeof slot.caption === 'object') items.push({ z: z + 0.4, kind: 'decor', spec: scaleDecor(slot.caption, tpl, sx, sy) });
    });
    (tpl.decor || []).forEach(function (spec, i) { items.push({ z: spec.z == null ? 80 + i : spec.z, kind: 'decor', spec: scaleDecor(spec, tpl, sx, sy) }); });
    items.sort(function (a, b) { return a.z - b.z; });
    return items;
  }
  function scaleDecor(spec, tpl, sx, sy) {
    var o = JSON.parse(JSON.stringify(spec || {}));
    var smin = Math.min(sx, sy) || 1;
    if (o.type === 'text') {
      if (o.w == null) o.w = Math.min(tpl.w * 0.84, (o.size || 48) * String(o.text || 'Text').length * 0.62);
      var lines = String(o.text || ' ').split('\n').length;
      if (o.h == null) o.h = Math.ceil(lines * (o.size || 32) * (o.lineHeight || 1.2) * 1.15);
      if (o.x == null && o.abs) o.x = o.abs.x;
      if (o.y == null && o.abs) o.y = o.abs.y;
      if (o.x == null) o.x = (tpl.w - o.w) / 2 + (o.dx || 0);
      if (o.y == null) o.y = (tpl.h - o.h) / 2 + (o.dy || 0);
    }
    delete o.abs; delete o.dx; delete o.dy; delete o.z; delete o.build;
    if (typeof o.x === 'number') o.x *= sx;
    if (typeof o.y === 'number') o.y *= sy;
    if (typeof o.w === 'number') o.w = Math.max(4, o.w * sx);
    if (typeof o.h === 'number') o.h = Math.max(4, o.h * sy);
    if (typeof o.size === 'number') o.size = Math.max(8, o.size * smin);
    if (typeof o.radius === 'number') o.radius *= smin;
    if (typeof o.letterSpacing === 'number') o.letterSpacing *= smin;
    if (o.stroke && o.stroke.width) o.stroke = Object.assign({}, o.stroke, { width: o.stroke.width * smin });
    if (o.border && o.border.width) o.border = Object.assign({}, o.border, { width: o.border.width * smin });
    if (o.shadow) o.shadow = Object.assign({}, o.shadow, { blur: (o.shadow.blur || 0) * smin, x: (o.shadow.x || 0) * smin, y: (o.shadow.y || 0) * smin });
    if (o.background && o.background.padding) o.background = Object.assign({}, o.background, { padding: o.background.padding * smin });
    if (o.params && typeof o.params.radius === 'number') o.params = Object.assign({}, o.params, { radius: o.params.radius * smin });
    return o;
  }

  /* Decodes the compact slot art the index carries: "x,y,w,h[,rot][,m]" in % of the page, ';'-joined. */
  function artSlots(str) {
    if (typeof str !== 'string' || !str) return [];
    return str.split(';').slice(0, 40).map(function (p) {
      var a = p.split(',');
      return { x: num(a[0], 0) / 100, y: num(a[1], 0) / 100, w: num(a[2], 10) / 100, h: num(a[3], 10) / 100, rot: num(a[4], 0), mask: a[5] || '' };
    });
  }

  window.LE = window.LE || {};
  window.LE.collage = {
    index: index, loadStyle: loadStyle, photos: photos,
    ASPECTS: ASPECTS, DEFAULTS: DEFAULTS, MAX_CELLS: MAX_CELLS,
    aspectFor: aspectFor, layouts: layouts, layoutFor: layoutFor, layoutName: layoutName, rects: rects,
    coverCrop: coverCrop, refitCrop: refitCrop, templateItems: templateItems, scaleDecor: scaleDecor, artSlots: artSlots
  };
})();
