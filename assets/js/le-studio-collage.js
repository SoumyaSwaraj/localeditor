/* Collage builder, style catalogue, photo slots on the canvas, attribution, and the stock / replace sheets.
   Collage state lives in the page document as doc.collage (see LE.collage in le-collage.js):
   { v, layout, cells, order, spacing, margin, radius, border, aspect } for a builder grid,
   or { v, template, order } for a catalogue style. Every cell is its own image layer with slot {id,label,photo}. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  function hook(name, fn) { (H[name] = H[name] || []).push(fn); }

  var CLASSIC = {
    'grid-2': 1, 'grid-3': 1, 'grid-4': 1, masonry: 1, mosaic: 1, 'polaroid-wall': 1, 'polaroid-scatter': 1,
    'film-strip': 1, lookbook: 1, moodboard: 1, yearbook: 1, 'family-cluster': 1, honeycomb: 1, 'diamond-grid': 1,
    timeline: 1, 'map-travel': 1, postcard: 1, 'instant-camera': 1, 'torn-paper': 1, 'comic-pop': 1, 'heart-shape': 1,
    'circle-crop': 1, 'star-mask': 1, 'overlapping-cascade': 1, 'bento-grid': 1, 'magazine-cover': 1, 'typography-poster': 1,
    'editorial-spread': 1, 'circular-mosaic': 1
  };
  var FILLS = [
    'linear-gradient(150deg,#d9c3a8,#8d6b4f)',
    'linear-gradient(160deg,#b7c6d6,#5d7590)',
    'linear-gradient(145deg,#e0b7ae,#8f5d5a)',
    'linear-gradient(155deg,#c9d2b4,#6d7b55)',
    'linear-gradient(150deg,#e6d3b0,#a68455)'
  ];
  var SWATCHES = ['#FFFFFF', '#F6F1E8', '#EFE4D6', '#F8E6EA', '#E6EEF0', '#DCE6D5', '#17131F', '#2A1F0A', '#E2B15A', '#7457F0'];
  var SVG = {
    shuffle: '<path d="M3.5 7h3.2c2.3 0 3.6 1.2 4.8 3.4l1 1.8c1.2 2.2 2.5 3.3 4.8 3.3h3.2M17.5 13.5l3 3-3 3M3.5 17h3.2c1.6 0 2.7-.6 3.6-1.7M14.6 8.7c.9-1.1 2-1.7 3.6-1.7h2.3M17.5 4l3 3-3 3"/>',
    next: '<rect x="3.5" y="4.5" width="7" height="15" rx="1.5"/><rect x="13.5" y="4.5" width="7" height="6.5" rx="1.5"/><rect x="13.5" y="13" width="7" height="6.5" rx="1.5"/>',
    cells: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 14v6M14 17h6"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11V5a1.5 1.5 0 013 0v6M14 11V6.5a1.5 1.5 0 013 0V14c0 4-2.5 6.5-6 6.5-2.6 0-4-1.3-5.4-3.4L4 14.5a1.5 1.5 0 012.4-1.8L8 15"/>',
    credit: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.6a3.5 3.5 0 100 4.8"/>',
    zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M11 8v6M8 11h6"/>',
    zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6"/>',
    offline: '<path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 13a10 10 0 015-2.7M19 13a10 10 0 00-3.2-2.2M2 9.5a15 15 0 015.2-3M22 9.5A15 15 0 0011 5"/><circle cx="12" cy="20" r=".8"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
  };
  function svg(name) {
    return '<svg class="sx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG[name] + '</svg>';
  }

  var studio = null;
  var indexCache = null;
  var styleCache = {};
  var photoCache = null;
  var catState = { design: { chip: 'classic', q: '' }, apps: { q: '', count: 'any', orient: 'any', style: '' } };
  var build = { view: 'build', pick: [], empty: 4, aspect: '1:1', picked: false };
  var stockState = { provider: '', q: '', orient: '', page: 1, hits: [], total: 0, gen: 0, loading: false, error: null, keys: false, more: false, verify: '' };
  var repTab = 'uploads';
  var hoverId = null;
  var chipEl = null;
  var attrEl = null;
  var bound = false;
  var sliding = false;

  /* ---------- Small helpers ---------- */
  function rootPath() {
    var r = document.documentElement.getAttribute('data-root') || '';
    if (r && r.charAt(r.length - 1) !== '/') r += '/';
    return r;
  }
  function G() { return window.LE && LE.collage; }
  function stockApi() { return window.LE && LE.stock; }
  function tail(secret) { secret = String(secret || ''); return secret ? '••••' + secret.slice(-4) : ''; }
  function nice(id) { return String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }); }
  function isClassic(t) {
    if (!t) return false;
    if (t.group === 'classic') return true;
    if (t.group === 'style') return false;
    return !!CLASSIC[t.style];
  }
  /* Photos the person added: never a cut-out mask or another working image (c.isUserPhoto, shared by every picker;
     the name test is the fallback when the studio is older than the helper). */
  var MANY_PHOTOS = 10;
  function isMaskName(a) { return /^background-/.test((a && a.name) || ''); }
  /* An entry from the device-wide photo list: never a mask by name, nor one this design uses as a mask. */
  function pickable(c, a) {
    if (!a || isMaskName(a)) return false;
    var mine = c.S.project && c.S.project.assets && c.S.project.assets[a.id];
    return !(mine && typeof c.isUserPhoto === 'function' && !c.isUserPhoto(a.id));
  }
  function uploadIds(c) {
    var assets = c.S.project && c.S.project.assets;
    if (!assets) return [];
    return Object.keys(assets).filter(function (id) {
      if (!/^[a-f0-9]{64}$/.test(id)) return false;
      return typeof c.isUserPhoto === 'function' ? c.isUserPhoto(id) : !isMaskName(assets[id]);
    });
  }
  function shuffled(list, avoidSame) {
    var out = list.slice();
    for (var tries = 0; tries < 6; tries++) {
      for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = out[i]; out[i] = out[j]; out[j] = t; }
      if (!avoidSame || out.length < 2 || out.some(function (v, k) { return v !== list[k]; })) break;
    }
    return out;
  }
  function k1080(c) { var d = c.doc(); return Math.min(d.width, d.height) / 1080; }
  function inApp(c) { return c.S.panel === 'apps' && c.S.panelOpts && c.S.panelOpts.app === 'collage'; }

  /* ---------- Catalogue data ---------- */
  function loadIndex() {
    var C = G();
    if (!C || typeof C.index !== 'function') return Promise.resolve(null);
    if (indexCache) return Promise.resolve(indexCache);
    return C.index().then(function (idx) { indexCache = idx || null; return indexCache; }).catch(function () { return null; });
  }
  function loadStyle(id) {
    var C = G();
    if (!C || !id) return Promise.resolve(null);
    if (styleCache[id]) return Promise.resolve(styleCache[id]);
    return C.loadStyle(id).then(function (pack) { styleCache[id] = pack; return pack; }).catch(function () { return null; });
  }
  function loadPhotos() {
    if (photoCache) return Promise.resolve(photoCache);
    var C = G();
    if (!C) { photoCache = []; return Promise.resolve(photoCache); }
    return C.photos().then(function (data) {
      photoCache = ((data && data.photos) || []).filter(function (p) { return p && p.file; });
      return photoCache;
    }).catch(function () { photoCache = []; return photoCache; });
  }
  function resolveFull(t) {
    if (t && t.slots && t.slots.length) return Promise.resolve(t);
    return loadStyle(t.style).then(function (pack) {
      var list = (pack && pack.templates) || [];
      var found = list.filter(function (x) { return x.id === t.id; })[0];
      if (!found) throw new Error('That collage is not on this device yet.');
      return found;
    });
  }
  function sourceFromPhoto(photo) {
    var who = photo.photographer || '';
    var license = photo.license || '';
    return {
      provider: 'pool',
      photographer: who,
      pageUrl: photo.url || '',
      license: license,
      attribution: photo.attribution || (who ? 'Photo by ' + who + (license ? ' (' + license + ')' : '') : (license || 'Collage sample photo'))
    };
  }
  function photoFileUrl(file) {
    var name = String(file || '').split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '');
    return name ? rootPath() + 'assets/photos/collage/' + name : '';
  }
  var poolIds = {};
  function ingestPool(c, photo) {
    var url = photoFileUrl(photo.file);
    if (!url) return Promise.resolve('');
    if (poolIds[photo.id] && c.mem[poolIds[photo.id]]) return Promise.resolve(poolIds[photo.id]);
    return fetch(url).then(function (r) { return r.ok ? r.blob() : null; }).then(function (blob) {
      if (!blob) return '';
      var file = new File([blob], photo.id + '.jpg', { type: blob.type || 'image/jpeg' });
      file.source = sourceFromPhoto(photo);
      return c.ingest(file).then(function (meta) { if (meta) poolIds[photo.id] = meta.id; return meta ? meta.id : ''; });
    }).catch(function () { return ''; });
  }
  /* Loads stored uploads into memory so they can fill cells. */
  function ensureUploads(c, ids) {
    return Promise.all(ids.map(function (id) {
      if (c.mem[id] && c.mem[id].canvas) return id;
      return LE.project.assetRecord(id).then(function (rec) {
        if (!rec || !rec.blob) return '';
        var file = new File([rec.blob], rec.name || 'photo', { type: rec.type || 'image/jpeg' });
        if (rec.source) file.source = rec.source;
        return c.ingest(file).then(function (meta) { return meta ? meta.id : ''; });
      }).catch(function () { return ''; });
    })).then(function (list) { return list.filter(Boolean); });
  }
  function samplePhotos(c, n) {
    return loadPhotos().then(function (all) {
      if (!all.length) return [];
      var pick = shuffled(all).slice(0, n);
      var out = [];
      var chain = Promise.resolve();
      pick.forEach(function (p) { chain = chain.then(function () { return ingestPool(c, p).then(function (id) { if (id) out.push(id); }); }); });
      return chain.then(function () { return out; });
    });
  }

  /* ---------- Page targeting ---------- */
  /* A collage goes on the current page when it is empty; otherwise on a new page right after it. */
  function targetPage(c, w, h, name) {
    if (!c.S.project) { c.newDesign(w, h, name || 'Collage'); return 'new'; }
    if (c.scene.layers().length) { c.addPage(false); c.toast('Collage added on a new page'); }
    return 'page';
  }

  /* ---------- Builder: document model ---------- */
  function meta(c) { return c.scene && c.scene.collage ? c.scene.collage() : null; }
  function isGrid(m) { return !!(m && m.cells && m.cells.length && m.order && m.order.length); }
  function slotMap(c) {
    var map = {};
    c.scene.layers().forEach(function (l) { if (l.type === 'image' && l.slot && l.slot.id && !map[l.slot.id]) map[l.slot.id] = l; });
    return map;
  }
  function slotList(c) {
    return c.scene.layers().filter(function (l) { return l.type === 'image' && l.slot; });
  }
  function freshSlotId(c, taken) {
    var used = Object.assign({}, slotMap(c), taken || {});
    for (var i = 1; i < 999; i++) if (!used['cell' + i]) return 'cell' + i;
    return 'cell' + Date.now().toString(36);
  }
  function pageAr(c) { var d = c.doc(); return d.width / d.height; }
  function withDefaults(m, c) {
    var k = c ? k1080(c) : 1;
    var D = G().DEFAULTS;
    m.spacing = m.spacing == null ? Math.round(D.spacing * k) : m.spacing;
    m.margin = m.margin == null ? Math.round(D.margin * k) : m.margin;
    m.radius = m.radius == null ? D.radius : m.radius;
    m.border = m.border || { width: 0, color: '#FFFFFF' };
    return m;
  }
  /* Cells that no longer match the layout (moved, resized, rotated or deleted by hand). */
  function drift(c, m) {
    if (!isGrid(m)) return 0;
    var d = c.doc();
    var R = G().rects(m, d.width, d.height);
    var map = slotMap(c);
    var bad = 0;
    m.order.forEach(function (sid, i) {
      var l = map[sid], r = R[i];
      if (!l || !r) { bad++; return; }
      if (Math.abs(l.x - r.x) > 1.5 || Math.abs(l.y - r.y) > 1.5 || Math.abs(l.w - r.w) > 1.5 || Math.abs(l.h - r.h) > 1.5 || Math.abs(l.rotation || 0) > 0.5) bad++;
    });
    if (m.order.length !== m.cells.length) bad++;
    return bad;
  }
  /* Puts every cell where the meta says. key → coalesced live preview; no key → caller batches. */
  function relayout(c, m, key) {
    var d = c.doc();
    var R = G().rects(m, d.width, d.height);
    var map = slotMap(c);
    var opt = key ? { coalesce: key } : null;
    var bw = m.border && m.border.width > 0 ? m.border.width : 0;
    m.order.forEach(function (sid, i) {
      var l = map[sid], r = R[i];
      if (!l || !r) return;
      var p = {
        x: r.x, y: r.y, w: r.w, h: r.h, rotation: 0,
        radius: Math.min(m.radius || 0, Math.min(r.w, r.h) / 2),
        border: bw ? { width: bw, color: m.border.color || '#FFFFFF' } : null
      };
      var mem = l.src && c.mem[l.src] && c.mem[l.src].canvas;
      if (mem && (Math.abs(l.w - r.w) > 0.01 || Math.abs(l.h - r.h) > 0.01)) p.crop = LE.Scene.refitCrop(l.crop, mem.width, mem.height, r.w, r.h);
      c.scene.update(l.id, p, opt);
    });
    c.scene.setCollage(m, opt);
  }
  function commit(c, fn) {
    c.batch(fn);
    c.markDirty();
    refreshSoon(c);
  }
  function cellLayer(c, id, src, r, i, sid) {
    var mem = src && c.mem[src];
    return {
      type: 'image', name: 'Photo ' + (i + 1), src: src || '',
      x: r.x, y: r.y, w: r.w, h: r.h,
      crop: mem && mem.canvas ? G().coverCrop(mem.canvas.width, mem.canvas.height, r.w, r.h) : { x: 0, y: 0, w: 1, h: 1 },
      slot: { id: sid, label: 'Photo ' + (i + 1), photo: '' }
    };
  }
  /* Creates a builder collage from asset ids ('' = empty cell). One undo step on the target page. */
  function createGrid(c, ids, opts) {
    opts = opts || {};
    var A = G().ASPECTS.filter(function (a) { return a.id === (opts.aspect || build.aspect); })[0] || G().ASPECTS[0];
    targetPage(c, A.w, A.h, 'Collage');
    var n = Math.max(1, Math.min(G().MAX_CELLS, ids.length));
    var lay = G().layouts(n, A.w / A.h)[0];
    var m = withDefaults({ v: 1, layout: lay.id, cells: lay.cells, order: [], aspect: A.id }, null);
    var k = Math.min(A.w, A.h) / 1080;
    m.spacing = Math.round(G().DEFAULTS.spacing * k);
    m.margin = Math.round(G().DEFAULTS.margin * k);
    var first = null;
    c.batch(function () {
      var d = c.doc();
      if (d.width !== A.w || d.height !== A.h) c.scene.resizePage(A.w, A.h);
      if (opts.bg) c.scene.setBackground({ type: 'color', color: opts.bg });
      var R = G().rects(m, A.w, A.h);
      var taken = {};
      for (var i = 0; i < n; i++) {
        var sid = freshSlotId(c, taken);
        taken[sid] = 1;
        m.order.push(sid);
        var id = c.scene.add(cellLayer(c, null, ids[i], R[i], i, sid));
        if (!first) first = id;
      }
      c.scene.setCollage(m);
    });
    c.fit();
    c.markDirty();
    if (first) c.scene.select([]);
    return m;
  }
  function setLayout(c, m, lay) {
    m.layout = lay.id;
    m.cells = lay.cells;
    commit(c, function () { relayout(c, m); });
  }
  function setCount(c, m, n) {
    n = Math.max(1, Math.min(G().MAX_CELLS, n));
    var map = slotMap(c);
    var order = m.order.filter(function (sid) { return map[sid]; });
    if (n === order.length) return;
    commit(c, function () {
      if (n > order.length) {
        var taken = {};
        for (var i = order.length; i < n; i++) {
          var sid = freshSlotId(c, taken);
          taken[sid] = 1;
          order.push(sid);
          c.scene.add(cellLayer(c, null, '', { x: 0, y: 0, w: 100, h: 100 }, i, sid));
        }
      } else {
        while (order.length > n) {
          var drop = -1;
          for (var j = order.length - 1; j >= 0; j--) if (!map[order[j]].src) { drop = j; break; }
          if (drop < 0) drop = order.length - 1;
          c.scene.remove([map[order[drop]].id]);
          order.splice(drop, 1);
        }
      }
      m.order = order;
      var lay = G().layouts(n, pageAr(c))[0];
      m.layout = lay.id;
      m.cells = lay.cells;
      relayout(c, m);
    });
  }
  var PHOTO_KEYS = ['src', 'adjust', 'filter', 'removeBg'];
  function shufflePhotos(c, ids) {
    var layers = ids.map(function (id) { return c.L(id); }).filter(Boolean);
    if (layers.length < 2) { c.toast('Add another photo to shuffle.'); return; }
    var photos = layers.map(function (l) { var o = {}; PHOTO_KEYS.forEach(function (k) { o[k] = l[k] == null ? null : l[k]; }); return o; });
    var order = shuffled(photos.map(function (p, i) { return i; }), true);
    commit(c, function () {
      layers.forEach(function (l, i) {
        var ph = photos[order[i]];
        var p = Object.assign({}, ph);
        p.src = ph.src || '';
        var mem = p.src && c.mem[p.src] && c.mem[p.src].canvas;
        p.crop = mem ? G().coverCrop(mem.width, mem.height, l.w, l.h) : { x: 0, y: 0, w: 1, h: 1 };
        c.scene.update(l.id, p);
      });
    });
  }
  function orderedIds(c, m) {
    var map = slotMap(c);
    if (m && m.order) return m.order.map(function (sid) { return map[sid] && map[sid].id; }).filter(Boolean);
    return slotList(c).map(function (l) { return l.id; });
  }
  function reapply(c, m) {
    var map = slotMap(c);
    var order = m.order.filter(function (sid) { return map[sid]; });
    Object.keys(map).forEach(function (sid) { if (order.indexOf(sid) < 0) order.push(sid); });
    if (!order.length) { c.scene.setCollage(null); refreshSoon(c); return; }
    m.order = order;
    if (m.cells.length !== order.length) {
      var lay = G().layoutFor(m.layout, order.length, pageAr(c));
      m.layout = lay.id;
      m.cells = lay.cells;
    }
    commit(c, function () { relayout(c, m); });
  }
  /* Turns the slot layers already on the page (from a style, or made by hand) into a tunable grid. */
  function adoptAsGrid(c) {
    var slots = slotList(c);
    if (!slots.length) return;
    var n = Math.min(G().MAX_CELLS, slots.length);
    var lay = G().layouts(n, pageAr(c))[0];
    var m = withDefaults({ v: 1, layout: lay.id, cells: lay.cells, order: [], aspect: G().aspectFor(c.doc().width, c.doc().height) }, c);
    commit(c, function () {
      slots.slice(0, n).forEach(function (l, i) {
        var sid = l.slot.id || freshSlotId(c);
        if (m.order.indexOf(sid) >= 0) { sid = freshSlotId(c); c.scene.update(l.id, { slot: { id: sid, label: l.slot.label || 'Photo ' + (i + 1), photo: l.slot.photo || '' } }); }
        m.order.push(sid);
        c.scene.update(l.id, { mask: 'none', shadow: null });
      });
      relayout(c, m);
    });
  }
  /* Fills empty cells first, then grows the grid. */
  function addToCells(c, ids) {
    var m = meta(c);
    if (!ids.length) return;
    if (!isGrid(m)) { createGrid(c, ids); refreshSoon(c); return; }
    var map = slotMap(c);
    var queue = ids.slice();
    commit(c, function () {
      m.order.forEach(function (sid) {
        var l = map[sid];
        if (!l || l.src || !queue.length) return;
        var src = queue.shift();
        var mem = c.mem[src] && c.mem[src].canvas;
        c.scene.update(l.id, { src: src, crop: mem ? G().coverCrop(mem.width, mem.height, l.w, l.h) : l.crop });
      });
      if (queue.length) {
        var taken = {};
        queue.slice(0, G().MAX_CELLS - m.order.length).forEach(function (src) {
          var sid = freshSlotId(c, taken);
          taken[sid] = 1;
          c.scene.add(cellLayer(c, null, src, { x: 0, y: 0, w: 100, h: 100 }, m.order.length, sid));
          m.order.push(sid);
        });
        var lay = G().layouts(m.order.length, pageAr(c))[0];
        m.layout = lay.id;
        m.cells = lay.cells;
      }
      relayout(c, m);
    });
  }
  function setAspect(c, m, id) {
    var A = G().ASPECTS.filter(function (a) { return a.id === id; })[0];
    if (!A) return;
    m.aspect = A.id;
    var d = c.doc();
    var k = Math.min(A.w, A.h) / Math.min(d.width, d.height);
    m.spacing = Math.round(m.spacing * k * 100) / 100;
    m.margin = Math.round(m.margin * k * 100) / 100;
    m.radius = Math.round((m.radius || 0) * k * 100) / 100;
    if (m.border) m.border.width = Math.round(m.border.width * k * 100) / 100;
    var lay = G().layoutFor(m.layout, m.order.length, A.w / A.h);
    m.cells = lay.cells;
    commit(c, function () {
      c.scene.resizePage(A.w, A.h);
      relayout(c, m);
    });
    c.fit();
  }

  /* ---------- Builder: UI ---------- */
  var refreshSoon = (function () {
    var t = 0;
    return function (c) {
      clearTimeout(t);
      t = setTimeout(function () { if (inApp(c) && !sliding && !c.S.pointer) c.renderPanel(true); }, 60);
    };
  })();
  function cellArt(cells, ar, extra) {
    var W = 100 * Math.min(1, ar), Hh = 100 * Math.min(1, 1 / ar);
    var R = G().rects({ cells: cells, spacing: 5, margin: 5 }, ar * 100, 100);
    var html = '<span class="sx-cl-art" style="aspect-ratio:' + ar + '" aria-hidden="true">';
    R.forEach(function (r) {
      html += '<i style="left:' + (r.x / ar) + '%;top:' + r.y + '%;width:' + (r.w / ar) + '%;height:' + r.h + '%"></i>';
    });
    void W; void Hh;
    return html + (extra || '') + '</span>';
  }
  function iconBtn(c, label, icon, cls, fn) {
    var b = c.h('<button type="button" class="sx-cl-act' + (cls ? ' ' + cls : '') + '">' + (SVG[icon] ? svg(icon) : c.ic(icon)) + '<span>' + c.esc(label) + '</span></button>');
    b.onclick = fn;
    return b;
  }
  function section(c, title, extra) {
    var s = c.ui.section(title, extra);
    return { el: s, body: s.querySelector('.sx-sec-body') };
  }
  function swatchRow(c, current, onPick, label) {
    var row = c.h('<div class="sx-cl-swatches" role="group" aria-label="' + c.esc(label) + '"></div>');
    SWATCHES.forEach(function (col) {
      var b = c.h('<button type="button" class="sx-cl-sw" aria-label="' + col + '" aria-pressed="' + (String(current).toUpperCase() === col) + '"><i style="background:' + col + '"></i></button>');
      b.onclick = function () { onPick(col, null, true); };
      row.appendChild(b);
    });
    var more = c.h('<button type="button" class="sx-cl-sw sx-cl-sw-more" aria-label="More colours">' + c.ic('plus') + '</button>');
    more.onclick = function () {
      c.colorPop(more, { value: current || '#FFFFFF', title: label, onChange: function (v, key) { if (typeof v === 'string') onPick(v, key, false); } });
    };
    row.appendChild(more);
    return row;
  }
  function segTabs(c, body, view) {
    var seg = c.ui.seg([['build', 'Builder'], ['styles', 'Styles']], view, function (v) { build.view = v; c.renderPanel(); }, 'sx-cl-tabs');
    body.appendChild(seg);
  }

  function renderApp(c, body) {
    var C = G();
    var root = c.h('<div class="sx-cl-root"></div>');
    body.appendChild(root);
    if (!C || !C.layouts) { root.appendChild(c.ui.empty('Collage is not available', 'Reload the studio to try again.', [])); return; }
    segTabs(c, root, build.view);
    if (build.view === 'styles') { renderCatalog(c, root, { surface: 'apps' }); return; }
    var m = c.S.project ? meta(c) : null;
    var map = c.S.project ? slotMap(c) : {};
    if (isGrid(m) && m.order.some(function (sid) { return map[sid]; }) && !build.picking) return renderTune(c, root, m);
    if (m && m.template && Object.keys(map).length && !build.picking) return renderStyleInfo(c, root, m);
    renderStart(c, root);
  }

  function renderStart(c, root) {
    var hasSlots = c.S.project && slotList(c).length > 0;
    root.appendChild(c.h('<p class="sx-cl-lede">Pick photos, then tune the layout. Every cell stays its own photo you can swap, move or replace.</p>'));
    if (hasSlots && !build.picking) {
      var adopt = c.h('<div class="sx-cl-banner"><span>This page has ' + slotList(c).length + ' photo cells.</span></div>');
      var ab = c.h('<button type="button" class="btn btn-ghost btn-sm">Make them a tidy grid</button>');
      ab.onclick = function () { adoptAsGrid(c); };
      adopt.appendChild(ab);
      root.appendChild(adopt);
    }
    if (build.picking) {
      var back = c.h('<button type="button" class="sx-link sx-cl-back">' + c.ic('back') + '<span>Back to the collage</span></button>');
      back.onclick = function () { build.picking = false; c.renderPanel(true); };
      root.appendChild(back);
    }
    var src = section(c, 'Add photos');
    var row = c.h('<div class="sx-cl-sources"></div>');
    var file = c.h('<input type="file" accept="image/*" multiple hidden>');
    row.appendChild(file);
    row.appendChild(iconBtn(c, 'This device', 'uploads', '', function () { file.click(); }));
    row.appendChild(iconBtn(c, 'Stock', 'search', '', function () { openStockPick(c); }));
    row.appendChild(iconBtn(c, 'Samples', 'image', '', function (e) {
      var b = e.currentTarget;
      b.disabled = true;
      samplePhotos(c, Math.max(4, Math.min(9, build.empty))).then(function (ids) {
        ids.forEach(function (id) { if (build.pick.indexOf(id) < 0) build.pick.push(id); });
        if (!ids.length) c.toast('Sample photos could not load.');
        c.renderPanel(true);
      });
    }));
    file.onchange = function () {
      var files = [].slice.call(file.files || []);
      file.value = '';
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () { return c.ingest(f).then(function (meta2) { if (meta2 && build.pick.indexOf(meta2.id) < 0) build.pick.push(meta2.id); }); }).catch(function (err) { c.toast((err && err.message) || 'Could not read that photo.'); });
      });
      chain.then(function () { c.renderPanel(true); });
    };
    src.body.appendChild(row);
    root.appendChild(src.el);

    var mine = section(c, 'Your photos', '<span class="sx-cl-count" data-count></span>');
    var grid = c.h('<div class="sx-cl-pick"></div>');
    mine.body.appendChild(grid);
    root.appendChild(mine.el);
    var countEl = mine.el.querySelector('[data-count]');
    function paintCount() { countEl.textContent = build.pick.length ? build.pick.length + ' selected' : ''; paintGo(); }
    function tile(id, name) {
      var on = build.pick.indexOf(id);
      var t = c.h('<button type="button" class="sx-cl-ptile" aria-pressed="' + (on >= 0) + '" aria-label="' + c.esc(name || 'Photo') + '"><img alt=""><b>' + (on >= 0 ? on + 1 : '') + '</b></button>');
      c.thumbUrl(id).then(function (u) { if (u) t.querySelector('img').src = u; });
      t.onclick = function () {
        var i = build.pick.indexOf(id);
        if (i >= 0) build.pick.splice(i, 1); else if (build.pick.length < G().MAX_CELLS) build.pick.push(id);
        grid.querySelectorAll('.sx-cl-ptile').forEach(function (n) {
          var k = build.pick.indexOf(n.getAttribute('data-id'));
          n.setAttribute('aria-pressed', k >= 0 ? 'true' : 'false');
          n.querySelector('b').textContent = k >= 0 ? k + 1 : '';
        });
        paintCount();
      };
      t.setAttribute('data-id', id);
      return t;
    }
    var shown = {};
    var inDesign = uploadIds(c);
    if (!build.picked && !build.pick.length && !build.picking) {
      build.pick = inDesign.filter(function (id) { return c.mem[id]; }).slice(0, 9);
      build.picked = true;
    }
    build.pick.concat(inDesign).forEach(function (id) {
      if (shown[id]) return;
      shown[id] = 1;
      var a = (c.S.project && c.S.project.assets[id]) || (c.mem[id] && c.mem[id].meta) || {};
      grid.appendChild(tile(id, a.name));
    });
    if (LE.project && LE.project.assets) {
      LE.project.assets().then(function (list) {
        (list || []).filter(function (a) { return pickable(c, a); }).slice(0, 60).forEach(function (a) {
          if (shown[a.id] || !grid.isConnected) return;
          shown[a.id] = 1;
          grid.appendChild(tile(a.id, a.name));
        });
        if (!grid.children.length && grid.isConnected) grid.appendChild(c.h('<p class="sx-note sx-cl-wide">No photos yet. Add some from this device, stock, or the samples.</p>'));
      }).catch(function () {});
    }

    if (!build.picking) {
      var sz = section(c, 'Size');
      sz.body.appendChild(aspectChips(c, build.aspect, function (id) { build.aspect = id; c.renderPanel(true); }));
      root.appendChild(sz.el);
      var em = section(c, 'Or start with empty cells');
      em.body.appendChild(stepper(c, build.empty, 1, G().MAX_CELLS, function (v) { build.empty = v; paintGo(); }));
      root.appendChild(em.el);
    }
    var foot = c.h('<div class="sx-cl-foot"></div>');
    var go = c.h('<button type="button" class="btn btn-gold sx-block sx-cl-go"></button>');
    foot.appendChild(go);
    root.appendChild(foot);
    function paintGo() {
      if (build.picking) go.textContent = build.pick.length ? 'Add ' + build.pick.length + ' photo' + (build.pick.length === 1 ? '' : 's') : 'Pick photos to add';
      else go.textContent = build.pick.length ? 'Make collage · ' + build.pick.length + ' photo' + (build.pick.length === 1 ? '' : 's') : 'Make ' + build.empty + ' empty cells';
      go.disabled = !!build.picking && !build.pick.length;
    }
    go.onclick = function () {
      go.disabled = true;
      ensureUploads(c, build.pick.slice()).then(function (ready) {
        if (build.picking) {
          build.picking = false;
          addToCells(c, ready);
        } else {
          var ids = ready.length ? ready : new Array(build.empty).join(',').split(',').map(function () { return ''; });
          createGrid(c, ids);
          c.toast(ready.length ? 'Drag a photo onto another to swap · double-tap to reframe' : 'Tap a cell to add a photo');
        }
        build.pick = [];
        build.picked = true;
        c.renderPanel();
      });
    };
    paintCount();
  }
  function aspectChips(c, current, onPick) {
    var row = c.h('<div class="sx-cl-aspects" role="group" aria-label="Page size"></div>');
    G().ASPECTS.forEach(function (a) {
      var ar = a.w / a.h;
      var b = c.h('<button type="button" class="sx-cl-asp" aria-pressed="' + (a.id === current) + '"><i style="aspect-ratio:' + ar + ';' + (ar >= 1 ? 'width:22px' : 'height:22px') + '"></i><span>' + c.esc(a.name) + '</span><small>' + a.id + '</small></button>');
      b.onclick = function () { onPick(a.id); };
      row.appendChild(b);
    });
    return row;
  }
  function stepper(c, value, min, max, onSet) {
    var n = c.h('<div class="sx-cl-step"><button type="button" aria-label="Fewer">' + c.ic('minus') + '</button><output aria-live="polite">' + value + '</output><button type="button" aria-label="More">' + c.ic('plus') + '</button></div>');
    var out = n.querySelector('output');
    var bs = n.querySelectorAll('button');
    function set(v) { v = Math.max(min, Math.min(max, v)); value = v; out.textContent = v; onSet(v); }
    bs[0].onclick = function () { set(value - 1); };
    bs[1].onclick = function () { set(value + 1); };
    return n;
  }

  function renderTune(c, root, m) {
    m = withDefaults(m, c);
    var d = c.doc();
    var ar = d.width / d.height;
    var n = m.order.length;
    var moved = drift(c, m);
    if (moved) {
      var ban = c.h('<div class="sx-cl-banner is-warn"><span>' + (moved === 1 ? 'A cell was' : 'Some cells were') + ' moved by hand. Tuning puts them back into the layout.</span></div>');
      var rb = c.h('<button type="button" class="btn btn-ghost btn-sm">Re-apply layout</button>');
      rb.onclick = function () { reapply(c, m); };
      ban.appendChild(rb);
      root.appendChild(ban);
    }
    var acts = c.h('<div class="sx-cl-acts"></div>');
    acts.appendChild(iconBtn(c, 'Shuffle', 'shuffle', '', function () { shufflePhotos(c, orderedIds(c, m)); }));
    acts.appendChild(iconBtn(c, 'Next layout', 'next', '', function () {
      var list = G().layouts(n, ar);
      var i = 0;
      for (var j = 0; j < list.length; j++) if (list[j].id === m.layout) i = j;
      setLayout(c, m, list[(i + 1) % list.length]);
    }));
    acts.appendChild(iconBtn(c, 'Add photos', 'cells', '', function () { build.picking = true; build.pick = []; c.renderPanel(); }));
    acts.appendChild(iconBtn(c, 'New collage', 'plus', '', function () { build.picking = false; build.pick = []; build.picked = false; build.forceStart = true; startFresh(c); }));
    root.appendChild(acts);

    var ls = section(c, 'Layout', '<span class="sx-cl-countrow" data-step></span>');
    ls.el.querySelector('[data-step]').appendChild(stepper(c, n, 1, G().MAX_CELLS, function (v) { setCount(c, m, v); }));
    var lg = c.h('<div class="sx-cl-layouts" role="listbox" aria-label="Layouts"></div>');
    G().layouts(n, ar).forEach(function (lay) {
      var b = c.h('<button type="button" class="sx-cl-lay" role="option" aria-selected="' + (lay.id === m.layout) + '" aria-label="' + c.esc(lay.name) + '" title="' + c.esc(lay.name) + '">' + cellArt(lay.cells, ar) + '</button>');
      b.onclick = function () { setLayout(c, m, lay); };
      lg.appendChild(b);
    });
    ls.body.appendChild(lg);
    root.appendChild(ls.el);

    var ss = section(c, 'Size');
    ss.body.appendChild(aspectChips(c, m.aspect || G().aspectFor(d.width, d.height), function (id) { setAspect(c, m, id); }));
    root.appendChild(ss.el);

    var k = Math.min(d.width, d.height) / 1080;
    function live(prop, max) {
      return c.ui.slider({
        label: prop[1], min: 0, max: max, value: Math.round(prop[2]() / k), reset: prop[3],
        onInput: function (v, key) { sliding = true; prop[0](v * k); relayout(c, m, key); },
        onEnd: function () { sliding = false; c.scene._endHist && c.scene._endHist(); c.markDirty(); }
      });
    }
    var sp = section(c, 'Spacing');
    sp.body.appendChild(live([function (v) { m.spacing = v; }, 'Between photos', function () { return m.spacing; }, 16], 80));
    sp.body.appendChild(live([function (v) { m.margin = v; }, 'Outer margin', function () { return m.margin; }, 24], 160));
    sp.body.appendChild(live([function (v) { m.radius = v; }, 'Corner radius', function () { return m.radius || 0; }, 0], 200));
    root.appendChild(sp.el);

    var bs = section(c, 'Border');
    bs.body.appendChild(live([function (v) { m.border = { width: v, color: (m.border && m.border.color) || '#FFFFFF' }; }, 'Width', function () { return (m.border && m.border.width) || 0; }, 0], 40));
    bs.body.appendChild(swatchRow(c, (m.border && m.border.color) || '#FFFFFF', function (col, key, done) {
      m.border = { width: (m.border && m.border.width) || Math.round(8 * k), color: col };
      if (key) relayout(c, m, key); else commit(c, function () { relayout(c, m); });
    }, 'Border colour'));
    root.appendChild(bs.el);

    var bg = section(c, 'Background');
    var curBg = (d.background && d.background.type === 'color' && d.background.color) || '';
    bg.body.appendChild(swatchRow(c, curBg, function (col, key) {
      if (key) { c.scene.setBackground({ type: 'color', color: col }, { coalesce: key }); return; }
      commit(c, function () { c.setBackground({ type: 'color', color: col }); });
    }, 'Background colour'));
    bg.body.appendChild(c.h('<p class="sx-note">Spacing and margin show this colour. Photo backgrounds live in the Background panel.</p>'));
    root.appendChild(bg.el);

    root.appendChild(c.h('<p class="sx-note sx-cl-tip">' + (c.isPhone() ? 'Tap a cell for Replace. Double-tap to move or pinch-zoom its photo. Long-press and drag onto another cell to swap.' : 'Double-click a cell to move or zoom its photo (scroll to zoom). Drag a photo onto another cell to swap. Drop a file on a cell to replace it.') + '</p>'));
  }
  function startFresh(c) {
    build.view = 'build';
    build.forceStart = false;
    if (c.S.project && c.scene.layers().length) { c.addPage(false); }
    c.renderPanel();
  }
  function renderStyleInfo(c, root, m) {
    var name = nice(m.template || 'style');
    if (indexCache && indexCache.templates) {
      var t = indexCache.templates.filter(function (x) { return x.id === m.template; })[0];
      if (t) name = t.name;
    }
    root.appendChild(c.h('<div class="sx-cl-banner"><span>This page uses the <b>' + c.esc(name) + '</b> style. Its cells are photo slots: tap one to replace it.</span></div>'));
    var acts = c.h('<div class="sx-cl-acts"></div>');
    acts.appendChild(iconBtn(c, 'Shuffle', 'shuffle', '', function () { shufflePhotos(c, orderedIds(c, m)); }));
    acts.appendChild(iconBtn(c, 'Fill from uploads', 'uploads', '', function () { build.picking = true; build.pick = []; c.renderPanel(); }));
    acts.appendChild(iconBtn(c, 'Make a grid', 'next', '', function () { adoptAsGrid(c); }));
    acts.appendChild(iconBtn(c, 'Other styles', 'grid', '', function () { build.view = 'styles'; c.renderPanel(); }));
    root.appendChild(acts);
    if (build.picking) renderStart(c, root);
  }

  /* ---------- Catalogue (styles) ---------- */
  function slotArt(c, t, bg) {
    var w = t.w || 1080, h = t.h || 1080;
    var slots = t.slots && t.slots.length ? t.slots.map(function (s) { return { x: s.x / w, y: s.y / h, w: s.w / w, h: s.h / h, rot: s.rot || 0, mask: s.mask || (s.maskPath ? 'p' : '') }; }) : G().artSlots(t.art);
    if (!slots.length) {
      var n = t.slots || t.slotCount || 4;
      var lay = G().layouts(typeof n === 'number' ? n : 4, w / h)[0];
      slots = lay.cells.map(function (cl) { return { x: cl[0] * 0.92 + 0.04, y: cl[1] * 0.92 + 0.04, w: cl[2] * 0.92 - 0.02, h: cl[3] * 0.92 - 0.02 }; });
    }
    var html = '<span class="sx-cg-art ' + (w >= h ? 'is-wide' : 'is-tall') + '" style="--sx-ar:' + (w / h) + (bg ? ';background:' + c.esc(bg) : '') + '">';
    slots.forEach(function (s, i) {
      var shape = s.mask === 'ellipse' || s.mask === 'circle' ? 'border-radius:50%;' : s.mask === 'heart' || s.mask === 'star' || s.mask === 'p' ? 'border-radius:40%;' : '';
      html += '<i class="sx-cg-slot" style="left:' + (s.x * 100).toFixed(2) + '%;top:' + (s.y * 100).toFixed(2) + '%;width:' + (s.w * 100).toFixed(2) + '%;height:' + (s.h * 100).toFixed(2) + '%;background:' + FILLS[i % FILLS.length] + ';' + shape + (s.rot ? 'transform:rotate(' + s.rot + 'deg)' : '') + '"></i>';
    });
    return html + '</span>';
  }
  function orientOf(t) { var r = (t.w || 1) / (t.h || 1); return r > 1.05 ? 'landscape' : r < 0.95 ? 'portrait' : 'square'; }
  function countBand(n) { return n <= 3 ? '1-3' : n <= 6 ? '4-6' : n <= 9 ? '7-9' : '10+'; }
  function templateCard(c, t, onDone) {
    var count = (t.slots && t.slots.length) || t.slots || 0;
    if (typeof count !== 'number') count = t.slotCount || 0;
    var b = c.h('<button type="button" class="sx-cg-card"><span class="sx-cg-artwrap">' + slotArt(c, t, t.bgc || (t.bg && (t.bg.color || (t.bg.colors && t.bg.colors[0])))) + '</span><b>' + c.esc(t.name || nice(t.id)) + '</b><small>' + (count ? count + ' photo' + (count === 1 ? '' : 's') : '') + ' · ' + (t.w || 1080) + '×' + (t.h || 1080) + '</small></button>');
    b.onclick = function () {
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('is-busy');
      resolveFull(t).then(function (full) { return applyTemplate(c, full, {}); }).catch(function (err) { c.toast((err && err.message) || 'Could not add that collage.'); })
        .then(function () { b.disabled = false; b.classList.remove('is-busy'); if (onDone) onDone(); });
    };
    return b;
  }
  function renderCatalog(c, body, opts) {
    opts = opts || {};
    var surface = opts.surface === 'apps' ? 'apps' : 'design';
    var state = catState[surface];
    var wrap = c.h('<div class="sx-cg-root"></div>');
    body.appendChild(wrap);
    var search = c.h('<div class="sx-search sx-cg-search">' + c.ic('search') + '<input type="search" placeholder="Search styles, e.g. polaroid, heart, travel" aria-label="Search collage styles" value="' + c.esc(state.q) + '"></div>');
    var input = search.querySelector('input');
    wrap.appendChild(search);
    var chips = c.h('<div class="sx-cg-filters"></div>');
    wrap.appendChild(chips);
    var list = c.h('<div class="sx-cg-list"></div>');
    wrap.appendChild(list);
    var idx = null;
    function chipRow(label, set, value, onPick) {
      var row = c.h('<div class="sx-cg-chips" role="group" aria-label="' + c.esc(label) + '"></div>');
      set.forEach(function (p) {
        var b = c.h('<button type="button" class="sx-cg-chip" aria-pressed="' + (value === p[0]) + '">' + c.esc(p[1]) + '</button>');
        b.onclick = function () { onPick(p[0]); drawChips(); draw(); };
        row.appendChild(b);
      });
      return row;
    }
    function drawChips() {
      chips.innerHTML = '';
      if (surface === 'design') {
        chips.appendChild(chipRow('Template type', [['classic', 'Classic'], ['collage', 'Collage styles'], ['text', 'Text layouts'], ['new', 'New design']], state.chip, function (v) { state.chip = v; }));
        return;
      }
      chips.appendChild(chipRow('Photos', [['any', 'Any count'], ['1-3', '1–3'], ['4-6', '4–6'], ['7-9', '7–9'], ['10+', '10+']], state.count, function (v) { state.count = v; }));
      chips.appendChild(chipRow('Orientation', [['any', 'Any shape'], ['square', 'Square'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], state.orient, function (v) { state.orient = v; }));
    }
    function all() {
      if (!idx) return [];
      var bgOf = {};
      return (idx.templates || []).map(function (t) { var o = Object.assign({}, t); void bgOf; return o; });
    }
    function matches(t, q) {
      if (!q) return true;
      var style = (idx.styles || []).filter(function (s) { return s.id === t.style; })[0] || {};
      return ((t.name || '') + ' ' + (t.style || '') + ' ' + (style.name || '') + ' ' + (style.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    }
    function grid(items, fn) {
      var g = c.h('<div class="sx-cg-grid"></div>');
      items.forEach(function (t) { g.appendChild(fn(t)); });
      return g;
    }
    function drawText() {
      list.innerHTML = '';
      var q = state.q.toLowerCase();
      var g = c.h('<div class="sx-grid sx-grid-2 sx-cg-grid"></div>');
      (opts.textTemplates || []).forEach(function (t) {
        if (q && t.name.toLowerCase().indexOf(q) < 0) return;
        var b = c.h('<button type="button" class="sx-tpl sx-tpl-' + t.id + '"><span class="sx-tpl-art" aria-hidden="true"><i></i><i></i><i></i></span><b>' + c.esc(t.name) + '</b></button>');
        b.onclick = function () {
          if (!opts.applyText) return;
          if (!c.S.project) { c.useSample().then(function () { opts.applyText(c, t); }); return; }
          opts.applyText(c, t);
        };
        g.appendChild(b);
      });
      list.appendChild(g);
      if (!g.children.length) list.appendChild(c.ui.empty('No text layouts', 'Try another search.', []));
    }
    function drawSizes() {
      list.innerHTML = '';
      var g = c.h('<div class="sx-grid sx-grid-2"></div>');
      c.SIZES.forEach(function (s) {
        var q = state.q.toLowerCase();
        if (q && s.name.toLowerCase().indexOf(q) < 0) return;
        var b = c.h('<button type="button" class="sx-size-mini"><span class="sx-size-art"><i style="width:28px;height:28px"></i></span><span><b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + '</small></span></button>');
        b.onclick = function () { c.newDesign(s.w, s.h, s.name); };
        g.appendChild(b);
      });
      list.appendChild(g);
    }
    function drawStyleVariations(styleId) {
      list.innerHTML = '';
      var st = (idx.styles || []).filter(function (s) { return s.id === styleId; })[0] || { id: styleId, name: nice(styleId) };
      var head = c.h('<div class="sx-cg-head"><button type="button" class="sx-link sx-cl-back">' + c.ic('back') + '<span>All styles</span></button><b>' + c.esc(st.name) + '</b></div>');
      head.querySelector('button').onclick = function () { state.style = ''; draw(); };
      list.appendChild(head);
      var g = c.h('<div class="sx-cg-grid"><p class="sx-note">Loading…</p></div>');
      list.appendChild(g);
      loadStyle(styleId).then(function (pack) {
        g.innerHTML = '';
        ((pack && pack.templates) || []).forEach(function (t) { g.appendChild(templateCard(c, t)); });
        if (!g.children.length) g.appendChild(c.ui.empty('Style not on this device', 'Connect once to download it, then it works offline.', []));
      });
    }
    function draw() {
      if (surface === 'design' && state.chip === 'text') return drawText();
      if (surface === 'design' && state.chip === 'new') return drawSizes();
      list.innerHTML = '';
      if (!idx) { list.appendChild(c.h('<div class="sx-cg-grid">' + new Array(7).join('<span class="sx-skel sx-cg-skel"></span>') + '</div>')); return; }
      var q = state.q.toLowerCase();
      if (surface === 'design') {
        var featured = all().filter(function (t) { return t.featured && (state.chip === 'classic' ? isClassic(t) : !isClassic(t)) && matches(t, q); });
        if (!featured.length) { list.appendChild(c.ui.empty('No templates match', 'Try another word.', [])); return; }
        list.appendChild(grid(featured, function (t) { return templateCard(c, t); }));
        list.appendChild(c.h('<p class="sx-note">More variations of every style are in Apps → Collage → Styles.</p>'));
        return;
      }
      if (state.style) return drawStyleVariations(state.style);
      var filtered = state.count !== 'any' || state.orient !== 'any' || q;
      if (filtered) {
        var hits = all().filter(function (t) {
          if (state.count !== 'any' && countBand(t.slots) !== state.count) return false;
          if (state.orient !== 'any' && orientOf(t) !== state.orient) return false;
          return matches(t, q);
        });
        list.appendChild(c.h('<p class="sx-cg-meta">' + hits.length + ' collage' + (hits.length === 1 ? '' : 's') + '</p>'));
        if (!hits.length) { list.appendChild(c.ui.empty('Nothing matches', 'Try fewer filters, or build your own in Builder.', [{ label: 'Clear filters', fn: function () { state.q = ''; state.count = 'any'; state.orient = 'any'; input.value = ''; drawChips(); draw(); } }])); return; }
        var shown = 24;
        var g2 = grid(hits.slice(0, shown), function (t) { return templateCard(c, t); });
        list.appendChild(g2);
        if (hits.length > shown) {
          var more = c.h('<button type="button" class="btn btn-ghost btn-sm sx-block">Show more</button>');
          more.onclick = function () { hits.slice(shown, shown + 24).forEach(function (t) { g2.appendChild(templateCard(c, t)); }); shown += 24; if (shown >= hits.length) more.remove(); };
          list.appendChild(more);
        }
        return;
      }
      [['Trending styles', function (s) { return s.group === 'style'; }], ['Classics', function (s) { return s.group !== 'style'; }]].forEach(function (grp) {
        var styles = (idx.styles || []).filter(grp[1]);
        if (!styles.length) return;
        list.appendChild(c.h('<h3 class="sx-cg-h">' + grp[0] + '</h3>'));
        list.appendChild(grid(styles, function (s) {
          var feat = (idx.templates || []).filter(function (t) { return t.style === s.id && t.featured; })[0] || { w: 1080, h: 1080, slots: s.slotCount };
          var b = c.h('<button type="button" class="sx-cg-card"><span class="sx-cg-artwrap">' + slotArt(c, feat, feat.bgc) + '</span><b>' + c.esc(s.name) + '</b><small>' + s.count + ' variation' + (s.count === 1 ? '' : 's') + '</small></button>');
          b.onclick = function () {
            if (s.count <= 1) { b.disabled = true; resolveFull(feat).then(function (full) { return applyTemplate(c, full, {}); }).catch(function (err) { c.toast(err.message); }).then(function () { b.disabled = false; }); return; }
            state.style = s.id;
            draw();
            c.E.panelBody.scrollTop = 0;
          };
          return b;
        }));
      });
    }
    input.addEventListener('input', c.debounce(function () { state.q = input.value.trim(); if (state.q) state.style = ''; draw(); }, 140));
    drawChips();
    draw();
    loadIndex().then(function (data) {
      idx = data;
      if (!idx) { list.innerHTML = ''; list.appendChild(c.ui.empty('Styles are not on this device', 'Connect once to download the style list. The Builder works offline.', [])); return; }
      draw();
    });
  }

  /* ---------- Template apply (catalogue styles) ---------- */
  /* The person's own photos: uploads in this design that did not come from the sample pool. */
  function ownUploads(c) {
    return uploadIds(c).filter(function (id) {
      var a = c.S.project.assets[id] || {};
      return !(a.source && a.source.provider === 'pool');
    });
  }
  function chooseFill(c, tpl, mode) {
    var n = tpl.slots.length;
    var uploads = ownUploads(c);
    if (!mode) mode = uploads.length >= n ? 'uploads' : 'pool';
    if (mode === 'empty') return Promise.resolve(tpl.slots.map(function () { return ''; }));
    if (mode === 'uploads') {
      return ensureUploads(c, uploads).then(function (ready) {
        return tpl.slots.map(function (s, i) { return ready.length ? ready[i % ready.length] : ''; });
      });
    }
    return loadPhotos().then(function (photos) {
      if (!photos.length) return tpl.slots.map(function () { return ''; });
      var ids = tpl.slots.map(function () { return ''; });
      var byId = {};
      photos.forEach(function (p) { byId[p.id] = p; });
      var done = {};
      var chain = Promise.resolve();
      tpl.slots.forEach(function (slot, i) {
        chain = chain.then(function () {
          var photo = byId[slot.photo] || photos[i % photos.length];
          if (done[photo.id]) { ids[i] = done[photo.id]; return null; }
          return ingestPool(c, photo).then(function (id) { ids[i] = id; done[photo.id] = id; });
        });
      });
      return chain.then(function () { return ids; });
    });
  }
  function mount(c, tpl, ids) {
    var w = Math.max(16, Math.round(tpl.w || 1080));
    var h = Math.max(16, Math.round(tpl.h || 1080));
    targetPage(c, w, h, tpl.name || 'Collage');
    var first = null;
    var order = [];
    c.batch(function () {
      var d = c.doc();
      if (d.width !== w || d.height !== h) c.scene.resizePage(w, h);
      applyBg(c, tpl.bg);
      var decorIds = [];
      G().templateItems(tpl, w, h).forEach(function (item) {
        if (item.kind === 'slot') {
          var slot = item.slot, box = item.box, k = item.k;
          var src = ids[item.i] || '';
          var mem = src && c.mem[src];
          var layer = {
            type: 'image', name: slot.label || ('Photo ' + (item.i + 1)), src: src,
            x: box.x, y: box.y, w: box.w, h: box.h,
            rotation: Number(slot.rot || 0) || 0,
            radius: Math.max(0, Number(slot.radius || 0) * k),
            mask: slot.mask && slot.mask !== 'none' ? String(slot.mask).slice(0, 40) : 'none',
            crop: mem && mem.canvas ? G().coverCrop(mem.canvas.width, mem.canvas.height, box.w, box.h) : { x: 0, y: 0, w: 1, h: 1 },
            slot: { id: String(slot.id || ('p' + (item.i + 1))).slice(0, 40), label: String(slot.label || ('Photo ' + (item.i + 1))).slice(0, 80), photo: String(slot.photo || '').slice(0, 80) }
          };
          if (slot.border && Number(slot.border.width) > 0) layer.border = { width: Number(slot.border.width) * k, color: slot.border.color || '#FBF8F3' };
          if (slot.shadow) layer.shadow = { color: slot.shadow.color || 'rgba(42,31,10,.28)', blur: (slot.shadow.blur || 16) * k, x: (slot.shadow.x || 0) * k, y: (slot.shadow.y || 0) * k };
          if (slot.maskPath) layer.maskPath = slot.maskPath;
          var id = c.scene.add(layer);
          order.push(layer.slot.id);
          if (!first) first = id;
        } else if (item.spec) decorIds.push(c.scene.add(item.spec));
      });
      if (decorIds.length > 1) {
        var gid = c.scene.group(decorIds);
        if (gid) c.patch(gid, { name: (tpl.name || 'Collage') + ' details' });
      }
      c.scene.setCollage({ v: 1, template: tpl.id, order: order });
      c.scene.select([]);
    });
    c.fit();
    c.markDirty();
  }
  function applyBg(c, bg) {
    if (!bg) return;
    if (typeof bg === 'string') { c.scene.setBackground({ type: 'color', color: bg }); return; }
    if (bg.type === 'linear' || bg.type === 'gradient' || (bg.colors && bg.colors.length)) {
      c.scene.setBackground({ type: 'gradient', kind: bg.kind === 'radial' ? 'radial' : 'linear', colors: bg.colors || ['#ffffff', '#E7E5EB'], angle: bg.angle || 0, color: bg.color || (bg.colors && bg.colors[0]) || '#ffffff' });
      return;
    }
    if (bg.color) c.scene.setBackground({ type: 'color', color: bg.color });
  }
  function applyTemplate(c, tpl, opts) {
    opts = opts || {};
    if (!tpl || !tpl.slots || !tpl.slots.length) { c.toast('That collage has no photo slots.'); return Promise.resolve(); }
    return chooseFill(c, tpl, opts.fill).then(function (ids) {
      mount(c, tpl, ids);
      c.toast(c.isPhone() ? 'Tap a photo to replace it' : 'Click a photo to replace it · drag onto another to swap');
      refreshSoon(c);
    }).catch(function (err) { c.toast((err && err.message) || 'Could not add that collage.'); });
  }

  /* ---------- Stock photos (data-driven from LE.stock.providers()) ---------- */
  function providers() {
    var api = stockApi();
    var list = api && typeof api.providers === 'function' ? api.providers() : [];
    return (list || []).filter(function (p) { return p && p.id; });
  }
  function provider(id) { return providers().filter(function (p) { return p.id === id; })[0] || null; }
  function usable(p) { return p && !(p.needsKey && !p.hasKey); }
  function pickDefault() {
    var list = providers();
    var saved = '';
    try { saved = localStorage.getItem('le-stock-provider') || ''; } catch (e) {}
    var s = list.filter(function (p) { return p.id === saved; })[0];
    if (s) return s.id;
    var ok = list.filter(usable)[0];
    return ok ? ok.id : (list[0] ? list[0].id : '');
  }
  function errKind(err) {
    if (!err) return '';
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || (err.name === 'TypeError' && !err.status)) return 'offline';
    if (err.status === 401 || err.status === 403) return 'key';
    if (err.status === 429) return 'rate';
    return 'error';
  }
  function creditHtml(c, p) {
    if (!p || !p.creditText) return '';
    var safe = /^https:\/\//.test(p.creditUrl || '') ? p.creditUrl : '';
    return '<p class="sx-stock-credit">' + (safe ? '<a href="' + c.esc(safe) + '" target="_blank" rel="noopener noreferrer">' + c.esc(p.creditText) + '</a>' : c.esc(p.creditText)) + '</p>';
  }
  function keyForm(c, p, onSaved) {
    var api = stockApi();
    var keys = api.keys ? api.keys() : {};
    var cur = typeof keys[p.id] === 'string' ? keys[p.id] : '';
    var row = c.h('<div class="sx-stock-key" data-provider="' + c.esc(p.id) + '"><div class="sx-stock-key-h"><b>' + c.esc(p.name) + '</b><small>' + c.esc(p.keyLabel || 'API key') + '</small></div></div>');
    if (cur) {
      var saved = c.h('<div class="sx-stock-saved"><span>' + c.ic('check') + 'Saved · <code>' + c.esc(tail(cur)) + '</code></span></div>');
      var rm = c.h('<button type="button" class="sx-link">Remove</button>');
      rm.onclick = function () { var part = {}; part[p.id] = ''; try { api.setKeys(part); } catch (e) {} c.toast(p.name + ' key removed'); if (onSaved) onSaved(); };
      saved.appendChild(rm);
      row.appendChild(saved);
    }
    var form = c.h('<form class="sx-stock-keyform"><input class="sx-input" type="password" autocomplete="off" spellcheck="false" aria-label="' + c.esc(p.name + ' ' + (p.keyLabel || 'key')) + '" placeholder="' + c.esc(cur ? 'Paste a new ' + (p.keyLabel || 'key') : 'Paste ' + (p.keyLabel || 'key')) + '"><button type="submit" class="btn btn-ink btn-sm">Save</button></form>');
    form.onsubmit = function (e) {
      e.preventDefault();
      var v = form.querySelector('input').value.trim();
      if (!v) { c.toast('Paste a key first.'); return; }
      var part = {};
      part[p.id] = v;
      try { api.setKeys(part); } catch (err) { c.toast(err.message || 'Could not save that key.'); return; }
      form.querySelector('input').value = '';
      c.toast(p.name + ' key saved on this device');
      if (onSaved) onSaved();
    };
    row.appendChild(form);
    var help = /^https:\/\//.test(p.keyHelpUrl || '') ? ' <a href="' + c.esc(p.keyHelpUrl) + '" target="_blank" rel="noopener noreferrer">Get a key</a>' : '';
    if (p.keyHint || help) row.appendChild(c.h('<p class="sx-stock-hint">' + c.esc(p.keyHint || '') + help + '</p>'));
    return row;
  }
  function openverseFlow(c, onChange) {
    var api = stockApi();
    var ov = (api.keys().openverse) || {};
    var token = ov.token && ov.tokenExp > Date.now();
    var step = token ? 3 : (ov.clientId && ov.clientSecret ? 2 : 1);
    var box = c.h('<div class="sx-stock-key sx-stock-ov" data-provider="openverse"><div class="sx-stock-key-h"><b>Openverse</b><small>Optional · higher limit</small></div>' +
      '<ol class="sx-stock-steps"><li class="' + (step > 1 ? 'is-done' : 'is-on') + '">Register</li><li class="' + (step > 2 ? 'is-done' : step === 2 ? 'is-on' : '') + '">Verify email</li><li class="' + (step === 3 ? 'is-done' : '') + '">Connected</li></ol></div>');
    if (step === 1) {
      var f = c.h('<form class="sx-stock-ovform"><label class="sx-field"><span>Email Openverse should verify</span><input class="sx-input" name="email" type="email" autocomplete="email" required value="' + c.esc(ov.email || '') + '"></label><button type="submit" class="btn btn-ink btn-sm">Register this device</button></form>');
      f.onsubmit = function (e) {
        e.preventDefault();
        var btn = f.querySelector('button');
        btn.disabled = true;
        api.registerOpenverse({ name: 'LocalEditor on this device', email: f.querySelector('[name=email]').value.trim() }).then(function (res) {
          stockState.verify = (res && res.message) || '';
          c.toast('Check your email to verify Openverse');
          onChange();
        }).catch(function (err) { btn.disabled = false; c.toast((err && err.message) || 'Could not register.'); });
      };
      box.appendChild(f);
      var paste = c.h('<details class="sx-stock-more"><summary>I already have a client id and secret</summary></details>');
      var pf = c.h('<form class="sx-stock-ovform"><input class="sx-input" name="id" autocomplete="off" spellcheck="false" placeholder="Client id" aria-label="Client id"><input class="sx-input" name="secret" type="password" autocomplete="off" spellcheck="false" placeholder="Client secret" aria-label="Client secret"><button type="submit" class="btn btn-ghost btn-sm">Save</button></form>');
      pf.onsubmit = function (e) {
        e.preventDefault();
        var id = pf.querySelector('[name=id]').value.trim(), sec = pf.querySelector('[name=secret]').value.trim();
        if (!id || !sec) { c.toast('Paste both the client id and the secret.'); return; }
        try { api.setKeys({ openverse: { clientId: id, clientSecret: sec, token: '', tokenExp: 0 } }); } catch (err) { c.toast(err.message); return; }
        onChange();
      };
      paste.appendChild(pf);
      box.appendChild(paste);
    } else if (step === 2) {
      box.appendChild(c.h('<p class="sx-stock-verify">' + c.esc(stockState.verify || ('Openverse sent a link to ' + (ov.email || 'your inbox') + '. Open it, then connect.')) + ' Until then, search stays on the anonymous limit.</p>'));
      box.appendChild(c.h('<p class="sx-stock-saved">Client id <code>' + c.esc(tail(ov.clientId)) + '</code> · secret <code>' + c.esc(tail(ov.clientSecret)) + '</code></p>'));
      var connect = c.h('<button type="button" class="btn btn-ink btn-sm">I verified it — connect</button>');
      connect.onclick = function () {
        connect.disabled = true;
        api.tokenOpenverse().then(function (t) { if (t) c.toast('Openverse connected'); onChange(); })
          .catch(function (err) { connect.disabled = false; c.toast((err && err.message) || 'Verify the email, then try again.'); });
      };
      box.appendChild(connect);
    } else {
      box.appendChild(c.h('<p class="sx-stock-saved">' + c.ic('check') + 'Connected until ' + new Date(ov.tokenExp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · refreshes on its own</p>'));
      var quota = c.h('<p class="sx-stock-quota"></p>');
      box.appendChild(quota);
      if (api.rateLimit) api.rateLimit().then(function (r) {
        if (!r) return;
        var left = r.requestsThisMinute != null ? r.requestsThisMinute + ' requests this minute' : r.requestsToday != null ? r.requestsToday + ' requests today' : '';
        quota.textContent = left;
      }).catch(function () {});
    }
    if (step > 1) {
      var forget = c.h('<button type="button" class="sx-link">Forget these credentials</button>');
      forget.onclick = function () { api.setKeys({ openverse: { clientId: '', clientSecret: '', token: '', tokenExp: 0 } }); stockState.verify = ''; onChange(); };
      box.appendChild(forget);
    }
    return box;
  }
  function paintKeys(c, host, rerun) {
    host.innerHTML = '';
    var api = stockApi();
    if (!api) return;
    var box = c.h('<div class="sx-stock-keys"><div class="sx-stock-keys-h"><strong>Photo source keys</strong><button type="button" class="sx-link">Done</button></div><p class="sx-note">Keys stay in this browser only. After saving, only the last four characters are shown.</p></div>');
    box.querySelector('.sx-link').onclick = function () { stockState.keys = false; rerun(); };
    function again() { paintKeys(c, host, rerun); rerun(true); }
    providers().forEach(function (p) {
      if (p.id === 'openverse') box.appendChild(openverseFlow(c, again));
      else if (p.needsKey) box.appendChild(keyForm(c, p, again));
    });
    host.appendChild(box);
  }
  function quotaLine(p) {
    var api = stockApi();
    var q = api && api.quota ? api.quota(p.id) : null;
    if (!q || q.remaining == null) return '';
    return q.remaining + (q.limit ? ' of ' + q.limit : '') + ' searches left';
  }
  function renderStock(c, host, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var api = stockApi();
    var root = c.h('<div class="sx-stock-root"></div>');
    host.appendChild(root);
    if (!api || !providers().length) { root.appendChild(c.ui.empty('Stock photos', 'Stock search is not available in this build.', [])); return; }
    if (!stockState.provider || !provider(stockState.provider)) stockState.provider = pickDefault();
    var head = c.h('<div class="sx-stock-head"></div>');
    var keysHost = c.h('<div class="sx-stock-keyshost"></div>');
    var grid = c.h('<div class="sx-stock-grid" aria-live="polite"></div>');
    var more = c.h('<div class="sx-stock-more-row"></div>');
    var foot = c.h('<div class="sx-stock-foot"></div>');
    root.appendChild(head);
    root.appendChild(keysHost);
    root.appendChild(grid);
    root.appendChild(more);
    root.appendChild(foot);
    var io = null;
    function current() { return provider(stockState.provider) || providers()[0]; }
    function paintHead() {
      head.innerHTML = '';
      var bar = c.h('<div class="sx-stock-bar"></div>');
      var row = c.h('<div class="sx-stock-provs" role="tablist" aria-label="Photo source"></div>');
      providers().forEach(function (p) {
        var badge = p.needsKey && !p.hasKey ? '<i class="sx-stock-badge" title="Needs a key">' + c.ic('lock') + '</i>' : p.status === 'rate-limited' ? '<i class="sx-stock-badge" title="Resting">' + svg('clock') + '</i>' : '';
        var b = c.h('<button type="button" class="sx-stock-prov" role="tab" data-provider="' + c.esc(p.id) + '" data-status="' + c.esc(p.status || 'ok') + '" aria-selected="' + (stockState.provider === p.id) + '">' + c.esc(p.name) + badge + '</button>');
        b.onclick = function () {
          stockState.provider = p.id;
          try { localStorage.setItem('le-stock-provider', p.id); } catch (e) {}
          paintHead();
          run(true);
        };
        row.appendChild(b);
      });
      var keysBtn = c.h('<button type="button" class="sx-stock-keysbtn" aria-expanded="' + !!stockState.keys + '">' + c.ic('lock') + '<span>Keys</span></button>');
      keysBtn.onclick = function () { stockState.keys = !stockState.keys; paintKeysHost(); keysBtn.setAttribute('aria-expanded', String(!!stockState.keys)); };
      bar.appendChild(row);
      bar.appendChild(keysBtn);
      head.appendChild(bar);
      var form = c.h('<form class="sx-search sx-stock-search" role="search">' + c.ic('search') + '<input type="search" enterkeyhint="search" aria-label="Search stock photos" placeholder="Search ' + c.esc(current().name) + '" value="' + c.esc(stockState.q) + '"></form>');
      var field = form.querySelector('input');
      form.onsubmit = function (e) { e.preventDefault(); stockState.q = field.value.trim(); field.blur(); run(true); };
      field.addEventListener('input', c.debounce(function () { if (field.value.trim() === stockState.q) return; stockState.q = field.value.trim(); run(true); }, 450));
      head.appendChild(form);
      var p = current();
      if (!p.supports || p.supports.orientation !== false) {
        var orient = c.h('<div class="sx-cg-chips sx-stock-orient" role="group" aria-label="Orientation"></div>');
        [['', 'Any'], ['landscape', 'Landscape'], ['portrait', 'Portrait'], ['square', 'Square']].forEach(function (o) {
          var ob = c.h('<button type="button" class="sx-cg-chip" aria-pressed="' + (stockState.orient === o[0]) + '">' + o[1] + '</button>');
          ob.onclick = function () { stockState.orient = o[0]; paintHead(); run(true); };
          orient.appendChild(ob);
        });
        head.appendChild(orient);
      }
      head.insertAdjacentHTML('beforeend', creditHtml(c, p));
    }
    function paintKeysHost() { if (stockState.keys) paintKeys(c, keysHost, rerun); else keysHost.innerHTML = ''; }
    function rerun(soft) { paintHead(); if (!soft) paintKeysHost(); run(true); }
    function skeletons(n) { var s = ''; for (var i = 0; i < n; i++) s += '<span class="sx-skel sx-stock-skel" aria-hidden="true"></span>'; return s; }
    function state(title, text, actions, icon) {
      var n = c.h('<div class="sx-stock-state">' + (icon ? '<span class="sx-stock-state-ic">' + icon + '</span>' : '') + '<strong>' + c.esc(title) + '</strong><p>' + c.esc(text) + '</p><div class="sx-empty-act"></div></div>');
      (actions || []).forEach(function (a) {
        var b = c.h('<button type="button" class="btn ' + (a.gold ? 'btn-ink' : 'btn-ghost') + ' btn-sm">' + c.esc(a.label) + '</button>');
        b.onclick = a.fn;
        n.querySelector('.sx-empty-act').appendChild(b);
      });
      return n;
    }
    function otherSources() {
      return providers().filter(function (p) { return p.id !== stockState.provider && usable(p) && p.status !== 'rate-limited'; }).slice(0, 2).map(function (p) {
        return { label: 'Try ' + p.name, fn: function () { stockState.provider = p.id; paintHead(); run(true); } };
      });
    }
    function paintGrid() {
      grid.innerHTML = '';
      more.innerHTML = '';
      if (io) { io.disconnect(); io = null; }
      var p = current();
      if (p.needsKey && !p.hasKey) {
        var need = state('Add your ' + p.name + ' ' + (p.keyLabel || 'key'), p.name + ' needs a free key before it can search. It stays on this device.', otherSources(), c.ic('lock'));
        need.appendChild(keyForm(c, p, function () { rerun(true); }));
        grid.appendChild(need);
        return;
      }
      if (stockState.loading && !stockState.hits.length) { grid.innerHTML = skeletons(9); return; }
      var kind = errKind(stockState.error);
      if (kind && !stockState.hits.length) {
        if (kind === 'offline') grid.appendChild(state(navigator.onLine === false ? 'You are offline' : 'Could not reach ' + p.name, navigator.onLine === false ? 'Stock search needs a connection. Your own photos and the editor still work.' : 'Check the connection and try again. Your own photos and the editor still work.', [{ label: 'Try again', gold: true, fn: function () { run(true); } }], svg('offline')));
        else if (kind === 'rate') grid.appendChild(state(p.name + ' needs a short rest', stockState.error.message || 'Too many searches. Try again in a moment.', otherSources().concat([{ label: 'Try again', fn: function () { run(true); } }]), svg('clock')));
        else if (kind === 'key') { grid.appendChild(state(p.name + ' did not accept the key', 'Paste the ' + (p.keyLabel || 'key') + ' again.', [], c.ic('lock'))); grid.lastChild.appendChild(keyForm(c, p, function () { rerun(true); })); }
        else grid.appendChild(state('Could not search ' + p.name, stockState.error.message || 'Something went wrong.', [{ label: 'Try again', gold: true, fn: function () { run(true); } }].concat(otherSources())));
        return;
      }
      if (!stockState.hits.length) {
        var tips = ['flowers', 'beach', 'city', 'coffee'].map(function (w) { return { label: w, fn: function () { stockState.q = w; paintHead(); run(true); } }; });
        grid.appendChild(state('No photos for “' + (stockState.q || 'nature') + '”', 'Try a simpler word, one of these, or another source.', tips, c.ic('search')));
        return;
      }
      stockState.hits.forEach(function (hit) { grid.appendChild(hitButton(c, hit, opts)); });
      if (stockState.loading) grid.insertAdjacentHTML('beforeend', skeletons(3));
      if (stockState.error && stockState.hits.length) more.appendChild(c.h('<p class="sx-note">' + c.esc(stockState.error.message || 'Could not load more.') + '</p>'));
      if (stockState.more && !stockState.loading) {
        var btn = c.h('<button type="button" class="btn btn-ghost btn-sm sx-block sx-stock-morebtn">More photos</button>');
        btn.onclick = function () { run(false); };
        more.appendChild(btn);
        if ('IntersectionObserver' in window) {
          io = new IntersectionObserver(function (en) { if (en.some(function (x) { return x.isIntersecting; }) && !stockState.loading) { io.disconnect(); io = null; run(false); } }, { rootMargin: '0px 0px 320px 0px' });
          io.observe(btn);
        }
      }
    }
    function paintFoot() {
      var q = quotaLine(current());
      foot.innerHTML = q ? '<p class="sx-stock-quota">' + c.esc(q) + '</p>' : '';
    }
    function run(reset) {
      var p = current();
      if (reset) { stockState.page = 1; stockState.hits = []; stockState.more = false; stockState.gen += 1; stockState.error = null; }
      else stockState.page += 1;
      if (p.needsKey && !p.hasKey) { stockState.loading = false; paintGrid(); paintFoot(); return; }
      var gen = stockState.gen;
      stockState.loading = true;
      paintGrid();
      var q = stockState.q || 'nature';
      api.search(q, { provider: p.id, page: stockState.page, perPage: 20, orientation: stockState.orient || undefined }).then(function (res) {
        if (gen !== stockState.gen) return;
        var hits = (res && res.hits) || [];
        var seen = {};
        stockState.hits.forEach(function (h0) { seen[h0.provider + h0.id] = 1; });
        stockState.hits = stockState.hits.concat(hits.filter(function (h0) { return !seen[h0.provider + h0.id]; }));
        stockState.total = res && res.total != null ? res.total : stockState.hits.length;
        stockState.more = hits.length > 0 && stockState.hits.length < stockState.total && (!p.supports || p.supports.page !== false);
        stockState.loading = false;
        stockState.error = null;
        paintGrid();
        paintFoot();
      }).catch(function (err) {
        if (gen !== stockState.gen) return;
        stockState.loading = false;
        stockState.error = err || new Error('Could not search.');
        if (!reset) stockState.page -= 1;
        paintHead();
        paintGrid();
        paintFoot();
      });
    }
    paintHead();
    paintKeysHost();
    run(true);
  }
  function hitButton(c, hit, opts) {
    var licText = /^(by|by-[a-z-]+|cc0)$/i.test(hit.license || '') ? 'CC ' + hit.license.toUpperCase() : /^pdm$/i.test(hit.license || '') ? 'Public domain' : (hit.license || '');
    var lic = licText ? '<em>' + c.esc(licText) + '</em>' : '';
    var b = c.h('<button type="button" class="sx-stock-hit"><span class="sx-stock-img"><img alt="" loading="lazy" referrerpolicy="no-referrer">' + lic + '</span><small>' + c.esc(hit.photographer || hit.provider || 'Photo') + '</small></button>');
    var img = b.querySelector('img');
    img.alt = hit.attribution || hit.photographer || 'Stock photo';
    if (hit.thumb) img.src = hit.thumb;
    img.onerror = function () { img.removeAttribute('src'); b.classList.add('is-broken'); };
    b.onclick = function () {
      var api = stockApi();
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('is-busy');
      api.importHit(hit).then(function (res) {
        var file = res && (res.file || res.blob);
        if (file && res.source && !file.source) file.source = res.source;
        if (opts.mode === 'replace') return c.replaceImage(res).then(function (meta2) { if (meta2) c.closeModal(); });
        if (opts.mode === 'pick') return c.ingest(file).then(function (meta2) { if (opts.onPick) opts.onPick(meta2.id); });
        if (!c.S.project) return c.newFromPhoto(file);
        return c.ingest(file).then(function (meta2) {
          var target = c.one();
          if (target && target.type === 'image' && target.slot && !target.src) return c.replaceImage(meta2.id);
          c.placeImage(meta2.id);
          c.toast('Added to the design');
        });
      }).catch(function (err) { c.toast((err && err.message) || 'Could not add that photo.'); })
        .then(function () { b.disabled = false; b.classList.remove('is-busy'); });
    };
    return b;
  }
  function openStockPick(c) {
    var host = document.createElement('div');
    var body = c.openModal('Stock photos', host);
    var card = body && body.parentElement;
    if (card) card.classList.add('sx-rep-card');
    renderStock(c, host, { mode: 'pick', onPick: function (id) {
      if (build.pick.indexOf(id) < 0) build.pick.push(id);
      c.toast(build.pick.length + ' photo' + (build.pick.length === 1 ? '' : 's') + ' selected');
      c.renderPanel(true);
    } });
  }

  /* ---------- Replace sheet ---------- */
  function renderReplaceSheet(c, host) {
    host.innerHTML = '';
    var root = c.h('<div class="sx-rep-root"></div>');
    host.appendChild(root);
    var tabs = c.h('<div class="sx-rep-tabs" role="tablist"></div>');
    var body = c.h('<div class="sx-rep-body"></div>');
    root.appendChild(tabs);
    root.appendChild(body);
    function paintTabs() {
      tabs.innerHTML = '';
      [['uploads', 'Uploads'], ['device', 'This device'], ['stock', 'Stock photos']].forEach(function (pair) {
        var b = c.h('<button type="button" role="tab" aria-selected="' + (repTab === pair[0]) + '">' + pair[1] + '</button>');
        b.onclick = function () { repTab = pair[0]; paintTabs(); paint(); };
        tabs.appendChild(b);
      });
    }
    function useUpload(id) { c.replaceImage(id).then(function (meta2) { if (meta2) c.closeModal(); }); }
    function paintUploads() {
      body.innerHTML = '';
      var mine = uploadIds(c);
      var g = c.h('<div class="sx-rep-grid"></div>');
      mine.forEach(function (id) {
        var name = (c.S.project.assets[id] && c.S.project.assets[id].name) || 'Photo';
        var b = c.h('<button type="button" class="sx-thumb" aria-label="Use ' + c.esc(name) + '"><img alt=""></button>');
        c.thumbUrl(id).then(function (u) { if (u) b.querySelector('img').src = u; });
        b.onclick = function () { useUpload(id); };
        g.appendChild(b);
      });
      if (mine.length) body.appendChild(g);
      var all = c.h('<div class="sx-rep-grid sx-rep-all"></div>');
      var sub = c.h('<h3 class="sx-sub">Other photos on this device</h3>');
      body.appendChild(sub);
      body.appendChild(all);
      LE.project.assets().then(function (list) {
        list = (list || []).filter(function (a) { return mine.indexOf(a.id) < 0 && pickable(c, a); });
        if (!list.length) {
          sub.remove();
          if (!mine.length) body.appendChild(c.ui.empty('No uploads yet', 'Choose a photo from this device, or search stock.', [{ label: 'This device', gold: true, fn: function () { repTab = 'device'; paintTabs(); paint(); } }]));
          return;
        }
        list.slice(0, 60).forEach(function (a) {
          var b = c.h('<button type="button" class="sx-thumb" aria-label="Use ' + c.esc(a.name || 'photo') + '"><img alt=""></button>');
          c.thumbUrl(a.id).then(function (u) { if (u) b.querySelector('img').src = u; });
          b.onclick = function () { useUpload(a.id); };
          all.appendChild(b);
        });
      }).catch(function () {});
    }
    function paintDevice() {
      body.innerHTML = '';
      var box = c.h('<div class="sx-rep-device"><p>The frame, mask, border, rotation and shadow stay. Only the picture changes.</p><button type="button" class="btn btn-gold sx-block">Choose a photo</button><input type="file" accept="image/*" hidden></div>');
      var input = box.querySelector('input');
      box.querySelector('button').onclick = function () { input.click(); };
      input.onchange = function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (file) c.replaceImage(file).then(function (meta2) { if (meta2) c.closeModal(); });
      };
      body.appendChild(box);
    }
    function paint() {
      if (repTab === 'device') return paintDevice();
      if (repTab === 'stock') { body.innerHTML = ''; renderStock(c, body, { mode: 'replace' }); return; }
      paintUploads();
    }
    paintTabs();
    paint();
  }
  function openReplace(c) {
    var l = c.one();
    if (!l || l.type !== 'image') { c.toast('Select a photo to replace.'); return; }
    repTab = uploadIds(c).length ? 'uploads' : 'device';
    var host = document.createElement('div');
    var sheet = c.openModal(l.src ? 'Replace photo' : 'Add a photo', host);
    var card = sheet && sheet.parentElement;
    if (card) card.classList.add('sx-rep-card');
    renderReplaceSheet(c, host);
  }

  /* ---------- Attribution and credits ---------- */
  function sourceOf(c, src) {
    if (!src) return null;
    var a = (c.S.project && c.S.project.assets[src]) || (c.mem[src] && c.mem[src].meta) || null;
    var s = a && a.source;
    if (!s || typeof s !== 'object') return null;
    if (!s.photographer && !s.attribution && !s.license) return null;
    return s;
  }
  function safeUrl(u) { return typeof u === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : ''; }
  function providerName(id) {
    var p = provider(id);
    if (p) return p.name;
    if (id === 'pool') return 'LocalEditor samples';
    return nice(id || '');
  }
  function creditText(s) {
    var line = s.attribution || ((s.photographer ? 'Photo by ' + s.photographer : 'Photo') + (s.provider && s.provider !== 'pool' ? ' on ' + providerName(s.provider) : '') + (s.license ? ' (' + s.license + ')' : ''));
    var url = safeUrl(s.pageUrl);
    if (url && line.indexOf(url) < 0) line += ' ' + url;
    return line;
  }
  function allCredits(c) {
    if (!c.S.project) return [];
    try { c.syncProject(); } catch (e) {}
    var seen = {};
    var out = [];
    (c.S.project.pages || []).forEach(function (pg) {
      var srcs = (pg.layers || []).filter(function (l) { return l.type === 'image' && l.src; }).map(function (l) { return l.src; });
      if (pg.background && pg.background.src) srcs.push(pg.background.src);
      srcs.forEach(function (src) {
        if (seen[src]) return;
        seen[src] = 1;
        var s = sourceOf(c, src);
        if (s) out.push({ src: src, source: s, text: creditText(s) });
      });
    });
    return out;
  }
  function copyText(c, text) {
    var done = function () { c.toast('Credits copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return; }
    fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { c.toast('Select the text and copy it.'); }
      ta.remove();
    }
  }
  function openCredits(c) {
    var list = allCredits(c);
    var host = c.h('<div class="sx-credits"></div>');
    if (!list.length) host.appendChild(c.ui.empty('No credits needed', 'None of the photos in this design came from stock or the sample pool.', []));
    else {
      host.appendChild(c.h('<p class="sx-note">CC BY and stock licences ask you to credit the photographer when you share. Paste these lines next to your post or under the image.</p>'));
      var ul = c.h('<ol class="sx-credits-list"></ol>');
      list.forEach(function (it) {
        var s = it.source;
        var li = c.h('<li><span class="sx-credits-thumb"><img alt=""></span><span><b></b><small></small></span></li>');
        li.querySelector('b').textContent = s.photographer || providerName(s.provider);
        li.querySelector('small').textContent = [s.license, providerName(s.provider)].filter(Boolean).join(' · ');
        c.thumbUrl(it.src).then(function (u) { if (u) li.querySelector('img').src = u; });
        ul.appendChild(li);
      });
      host.appendChild(ul);
      var text = list.map(function (it) { return it.text; }).join('\n');
      var ta = c.h('<textarea class="sx-input sx-credits-text" readonly rows="4" aria-label="Credits text"></textarea>');
      ta.value = text;
      host.appendChild(ta);
      var cp = c.h('<button type="button" class="btn btn-gold sx-block">' + c.ic('copy') + '<span>Copy credits</span></button>');
      cp.onclick = function () { copyText(c, text); };
      host.appendChild(cp);
    }
    var body = c.openModal('Photo credits', host);
    if (body && body.parentElement) body.parentElement.classList.add('sx-rep-card');
  }
  function placeAttr(c) {
    if (!attrEl) return;
    var l = c.one();
    var s = l && l.type === 'image' && c.S.tool !== 'crop' && !c.S.preview ? sourceOf(c, l.src) : null;
    if (!s) { attrEl.hidden = true; return; }
    var who = s.photographer ? c.esc(s.photographer) : 'Photo';
    var whoUrl = safeUrl(s.photographerUrl);
    var pageUrl = safeUrl(s.pageUrl);
    var html = '<span class="sx-attr-txt">' + svg('credit') + '<span>' + (whoUrl ? '<a href="' + c.esc(whoUrl) + '" target="_blank" rel="noopener noreferrer">' + who + '</a>' : who) +
      (s.provider ? ' · ' + (pageUrl ? '<a href="' + c.esc(pageUrl) + '" target="_blank" rel="noopener noreferrer">' + c.esc(providerName(s.provider)) + '</a>' : c.esc(providerName(s.provider))) : '') +
      (s.license ? ' · <em>' + c.esc(s.license) + '</em>' : '') + '</span></span><button type="button" class="sx-attr-btn">Credits</button>';
    attrEl.innerHTML = html;
    attrEl.hidden = false;
    attrEl.querySelector('.sx-attr-btn').onclick = function () { openCredits(c); };
  }

  /* ---------- Canvas chrome: replace chip, empty-cell tap, drops, crop toolbar ---------- */
  function coarse() { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }
  function placeChip(c) {
    if (!chipEl || !c || !c.E) return;
    var show = null, mode = 'hover';
    if (c.S.project && c.S.tool === 'select' && !c.S.preview && !c.S.editing && !c.S.pointer) {
      var cur = c.one();
      if ((c.isPhone() || coarse()) && cur && cur.type === 'image' && cur.slot) { if (!(c.isPhone() && c.S.panel)) { show = cur.id; mode = 'touch'; } }
      else if (hoverId) {
        var hv = c.L(hoverId);
        if (hv && hv.type === 'image' && hv.slot) show = hoverId;
      }
    }
    if (!show) { chipEl.hidden = true; return; }
    var rect = c.scene.screenRect(show);
    var stage = c.E.stage.getBoundingClientRect();
    if (!rect || rect.width < 12 || rect.height < 12) { chipEl.hidden = true; return; }
    var layer = c.L(show);
    chipEl.setAttribute('data-id', show);
    chipEl.setAttribute('data-mode', mode);
    chipEl.querySelector('[data-act="move"]').hidden = mode !== 'touch' || !layer.src;
    chipEl.querySelector('[data-act="replace"] span').textContent = layer.src ? 'Replace' : 'Add photo';
    chipEl.hidden = false;
    var w = chipEl.offsetWidth || 96, h = chipEl.offsetHeight || 32;
    var x = rect.left + rect.width / 2 - stage.left - w / 2;
    /* Touch: centred in the cell, clear of the floating mini toolbar and the rotate handle. */
    var y = mode === 'touch' ? rect.top + rect.height / 2 - stage.top - h / 2 : rect.top - stage.top + 8;
    x = Math.max(8, Math.min(x, stage.width - w - 8));
    y = Math.max(8, Math.min(y, stage.height - h - 8));
    chipEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }
  function bindChrome(c) {
    if (bound || !c.E || !c.E.stage) return;
    bound = true;
    chipEl = c.h('<div class="sx-rep-chip" hidden role="group" aria-label="Photo cell"><button type="button" data-act="replace">' + c.ic('replace') + '<span>Replace</span></button><button type="button" data-act="move" hidden>' + svg('hand') + '<span>Reframe</span></button></div>');
    c.E.stage.appendChild(chipEl);
    chipEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    chipEl.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var b = e.target.closest('button');
      var id = chipEl.getAttribute('data-id');
      if (!b || !id) return;
      c.scene.select([id]);
      if (b.getAttribute('data-act') === 'move') { chipEl.hidden = true; c.startCrop(id); return; }
      openReplace(c);
    });
    attrEl = c.h('<div class="sx-attr" hidden></div>');
    c.E.stage.appendChild(attrEl);
    if (c.scene && c.scene.on) {
      c.scene.on('hover', function (e) { hoverId = e && e.id; placeChip(c); });
      c.scene.on('zoom', function () { placeChip(c); });
      c.scene.on('tool', function () { setTimeout(function () { placeChip(c); placeAttr(c); }, 0); });
      c.scene.on('slot-swap', function () { c.toast('Photos swapped'); refreshSoon(c); });
    }
    /* A tap on an empty cell opens the picker; drags and double-taps are left to the engine. */
    var down = null;
    c.E.sceneEl.addEventListener('pointerdown', function (e) {
      down = null;
      if (!c.S.project || c.S.tool !== 'select' || e.button > 0) return;
      var pt = c.docPoint(e.clientX, e.clientY);
      var id = pt && c.scene.hitTest(pt.x, pt.y);
      var l = id && c.L(id);
      if (l && l.type === 'image' && l.slot && !l.src) down = { id: id, x: e.clientX, y: e.clientY, t: Date.now() };
    }, true);
    window.addEventListener('pointerup', function (e) {
      var d = down;
      down = null;
      setTimeout(function () { placeChip(c); placeAttr(c); }, 0);
      if (!d || Math.abs(e.clientX - d.x) > 8 || Math.abs(e.clientY - d.y) > 8 || Date.now() - d.t > 600) return;
      setTimeout(function () {
        if (c.S.tool !== 'select') return;
        c.scene.select([d.id]);
        openReplace(c);
      }, 0);
    });
  }
  function slotUnder(c, at) {
    var id = at && c.scene.hitTest(at.x, at.y);
    var l = id && c.L(id);
    return l && l.type === 'image' && l.slot ? l : null;
  }

  hook('init', function (c) { studio = c; bindChrome(c); });
  hook('select', function (c) { placeChip(c); placeAttr(c); });
  hook('zoom', function (c) { placeChip(c); });
  hook('change', function (c) { placeAttr(c); });
  hook('history', function (c) { if (inApp(c) && !sliding) refreshSoon(c); });
  hook('page', function (c) { if (inApp(c)) refreshSoon(c); placeAttr(c); });
  hook('drop', function (c, d) {
    var l = slotUnder(c, d.at);
    if (!l) return false;
    var file = (d.files || []).filter(function (f) { return !f.type || /^image\//.test(f.type); })[0];
    if (!file && !d.asset) return false;
    c.scene.select([l.id]);
    c.replaceImage(file || d.asset);
    return true;
  });
  hook('toolbar', function (c, kind, l) {
    if (kind !== 'crop' || !l || !l.slot) return null;
    function tb(cmd, icon, label, cls) {
      return '<button type="button" class="sx-tb has-text' + (cls ? ' ' + cls : '') + '" data-cmd="' + cmd + '" aria-label="' + c.esc(label) + '" title="' + c.esc(label) + '">' + icon + '<span>' + c.esc(label) + '</span></button>';
    }
    return '<span class="sx-tb-label">' + svg('hand') + (c.isPhone() ? 'Drag · pinch' : 'Drag to move · scroll to zoom') + '</span>' +
      tb('cellZoom:out', svg('zoomOut'), 'Zoom out') + tb('cellZoom:in', svg('zoomIn'), 'Zoom in') + tb('cellZoom:fit', c.ic('fit'), 'Fill cell') +
      '<span class="sx-grow"></span>' + tb('cropCancel', c.ic('x'), 'Cancel') + tb('cropDone', c.ic('check'), 'Done', 'is-primary');
  });
  CMDS.cellZoom = function (c, arg) {
    var l = c.one();
    if (!l) return;
    c.scene.zoomSlot(l.id, arg === 'in' ? 1.2 : arg === 'out' ? 1 / 1.2 : 0.001);
  };
  CMDS.collageCredits = function (c) { openCredits(c); };

  /* ---------- Public ---------- */
  window.LEStudioCollage = {
    renderApp: renderApp,
    renderCatalog: renderCatalog,
    renderReplaceSheet: renderReplaceSheet,
    renderStock: renderStock,
    applyTemplate: function (c, tpl, opts) { return resolveFull(tpl).then(function (full) { return applyTemplate(c, full, opts); }); },
    openReplace: openReplace,
    openCredits: openCredits,
    credits: function (c) { return allCredits(c || studio).map(function (x) { return x.text; }); },
    createGrid: function (c, ids, opts) { var m = createGrid(c, ids, opts); refreshSoon(c); return m; },
    meta: function (c) { return meta(c || studio); },
    setLayout: function (c, id) { var m = withDefaults(meta(c), c); setLayout(c, m, G().layoutFor(id, m.order.length, pageAr(c))); },
    tune: function (c, patch) {
      var m = withDefaults(meta(c), c);
      Object.keys(patch || {}).forEach(function (k) { if (/^(spacing|margin|radius|border)$/.test(k)) m[k] = patch[k]; });
      commit(c, function () { relayout(c, m); });
    },
    setCount: function (c, n) { setCount(c, withDefaults(meta(c), c), n); },
    setAspect: function (c, id) { setAspect(c, withDefaults(meta(c), c), id); },
    shuffle: function (c) { shufflePhotos(c, orderedIds(c, meta(c))); },
    reapply: function (c) { reapply(c, withDefaults(meta(c), c)); },
    drift: function (c) { return drift(c, meta(c)); }
  };
})();
