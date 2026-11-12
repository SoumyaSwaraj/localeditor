/* Collage catalog, photo slots, and the replace / stock sheets. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  function hook(name, fn) { (H[name] = H[name] || []).push(fn); }

  var CLASSIC = {
    'grid-2': 1, 'grid-3': 1, 'grid-4': 1, masonry: 1, mosaic: 1, 'polaroid-wall': 1, 'polaroid-scatter': 1,
    'film-strip': 1, lookbook: 1, moodboard: 1, yearbook: 1, 'family-cluster': 1, honeycomb: 1, 'diamond-grid': 1,
    timeline: 1, 'map-travel': 1, postcard: 1, 'instant-camera': 1, 'torn-paper': 1, 'comic-pop': 1, 'heart-shape': 1,
    'circle-crop': 1, 'star-mask': 1, 'overlapping-cascade': 1, 'bento-grid': 1, 'magazine-cover': 1, 'typography-poster': 1,
    'editorial-spread': 1, newspaper: 1, scrapbook: 1, 'washi-tape': 1, 'travel-journal': 1, silhouette: 1, panoramic: 1,
    'circular-mosaic': 1, vaporwave: 1, cottagecore: 1, 'dark-academia': 1, coquette: 1, streetwear: 1
  };
  var FILLS = [
    'linear-gradient(150deg,#d9c3a8,#8d6b4f)',
    'linear-gradient(160deg,#b7c6d6,#5d7590)',
    'linear-gradient(145deg,#e0b7ae,#8f5d5a)',
    'linear-gradient(155deg,#c9d2b4,#6d7b55)',
    'linear-gradient(150deg,#e6d3b0,#a68455)'
  ];
  var STUBS = [
    { id: 'studio-grid-2', style: 'grid-2', name: 'Side by side', group: 'classic', featured: true, _stub: true, w: 1080, h: 1080, bg: { type: 'solid', color: '#F6F1E8' }, slots: [
      { id: 'a', label: 'Photo 1', x: 36, y: 36, w: 492, h: 1008, radius: 18, z: 1 },
      { id: 'b', label: 'Photo 2', x: 552, y: 36, w: 492, h: 1008, radius: 18, z: 2 }
    ], decor: [] },
    { id: 'studio-grid-4', style: 'grid-4', name: 'Four square', group: 'classic', featured: true, _stub: true, w: 1080, h: 1080, bg: { type: 'solid', color: '#F3EEE6' }, slots: [
      { id: 'a', label: 'Photo 1', x: 36, y: 36, w: 492, h: 492, radius: 16, z: 1 },
      { id: 'b', label: 'Photo 2', x: 552, y: 36, w: 492, h: 492, radius: 16, z: 2 },
      { id: 'c', label: 'Photo 3', x: 36, y: 552, w: 492, h: 492, radius: 16, z: 3 },
      { id: 'd', label: 'Photo 4', x: 552, y: 552, w: 492, h: 492, radius: 16, z: 4 }
    ], decor: [] },
    { id: 'studio-grid-3', style: 'grid-3', name: 'Hero and two', group: 'classic', featured: true, _stub: true, w: 1080, h: 1080, bg: { type: 'solid', color: '#EFE7DC' }, slots: [
      { id: 'a', label: 'Photo 1', x: 36, y: 36, w: 640, h: 1008, radius: 18, z: 1 },
      { id: 'b', label: 'Photo 2', x: 700, y: 36, w: 344, h: 492, radius: 16, z: 2 },
      { id: 'c', label: 'Photo 3', x: 700, y: 552, w: 344, h: 492, radius: 16, z: 3 }
    ], decor: [] },
    { id: 'studio-polaroid', style: 'polaroid-scatter', name: 'Polaroid pair', group: 'classic', featured: true, _stub: true, w: 1080, h: 1080, bg: { type: 'solid', color: '#E7D7C3' }, slots: [
      { id: 'a', label: 'Photo 1', x: 110, y: 130, w: 400, h: 480, rot: -7, radius: 2, border: { width: 16, color: '#FBF8F3' }, shadow: { color: 'rgba(42,31,10,.28)', blur: 22, x: 0, y: 10 }, caption: 'summer', z: 1 },
      { id: 'b', label: 'Photo 2', x: 540, y: 300, w: 400, h: 480, rot: 6, radius: 2, border: { width: 16, color: '#FBF8F3' }, shadow: { color: 'rgba(42,31,10,.28)', blur: 22, x: 0, y: 10 }, caption: 'later', z: 2 }
    ], decor: [] }
  ];

  var indexCache = null;
  var styleCache = {};
  var photoCache = null;
  var catState = { design: { chip: 'classic', q: '' }, apps: { chip: 'all', q: '' } };
  var stockState = { provider: 'openverse', q: 'flower', page: 1, hits: [], total: 0, gen: 0, loading: false, error: '', keys: false, limit: null, rate: null, more: false, verify: '' };
  var repTab = 'uploads';
  var hoverId = null;
  var chipBtn = null;
  var bound = false;
  var studio = null;
  var lastSlotTap = { t: 0, id: null, x: 0, y: 0 };
  window.addEventListener('pointerdown', function (e) {
    if (!studio || !studio.E || !studio.E.sceneEl || !studio.E.sceneEl.contains(e.target)) return;
    if (!studio.docPoint || !studio.scene || !studio.scene.hitTest) return;
    var pt = studio.docPoint(e.clientX, e.clientY);
    if (!pt) return;
    var id = studio.scene.hitTest(pt.x, pt.y);
    var layer = studio.L(id);
    var now = Date.now();
    var again = layer && lastSlotTap.id === id && (now - lastSlotTap.t) < 340 && Math.abs(e.clientX - lastSlotTap.x) < 28 && Math.abs(e.clientY - lastSlotTap.y) < 28;
    lastSlotTap = { t: now, id: id, x: e.clientX, y: e.clientY };
    if (!(e.detail >= 2 || again)) return;
    if (!layer || layer.type !== 'image' || !layer.slot || layer.src) return;
    e.preventDefault();
    e.stopPropagation();
    studio.scene.select([id]);
    openReplace(studio);
  }, true);

  function rootPath() {
    var r = document.documentElement.getAttribute('data-root') || '';
    if (r && r.charAt(r.length - 1) !== '/') r += '/';
    return r;
  }
  function stockApi() { return window.LE && LE.stock; }
  function collageApi() {
    var C = window.LE && LE.collage;
    if (!C || typeof C === 'function') return null;
    if (typeof C.index === 'function' || typeof C.loadStyle === 'function' || typeof C.photos === 'function') return C;
    if (C.index && typeof C.index === 'object') return C;
    return null;
  }
  function tail(secret) {
    secret = String(secret || '');
    if (!secret) return '';
    return '••••' + secret.slice(-4);
  }
  function nice(id) {
    return String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }
  function isClassic(t) {
    if (!t) return false;
    if (t.group === 'collage' || t.group === 'style' || t.group === 'styles') return false;
    if (t.group === 'classic' || t.group === 'classics' || t._stub) return true;
    return !!CLASSIC[t.style];
  }
  function uploadIds(c) {
    var assets = c.S.project && c.S.project.assets;
    if (!assets) return [];
    return Object.keys(assets).filter(function (id) { return /^[a-f0-9]{64}$/.test(id); });
  }
  function asList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.templates)) return data.templates;
    if (Array.isArray(data.photos)) return data.photos;
    return [];
  }
  function templatesFrom(data, styleId) {
    var list = asList(data);
    if (!list.length && data && data.slots) list = [data];
    return list.map(function (t) {
      if (!t || typeof t !== 'object') return null;
      if (!t.style && styleId) t = Object.assign({ style: styleId }, t);
      return t;
    }).filter(Boolean);
  }
  function loadIndex() {
    var C = collageApi();
    if (!C) return Promise.resolve(null);
    if (indexCache) return Promise.resolve(indexCache);
    var p = null;
    if (typeof C.index === 'function') p = Promise.resolve().then(function () { return C.index(); });
    else if (C.index && typeof C.index.then === 'function') p = C.index;
    else if (C.index && typeof C.index === 'object') p = Promise.resolve(C.index);
    else return Promise.resolve(null);
    return p.then(function (idx) { indexCache = idx || null; return indexCache; }).catch(function () { return null; });
  }
  function loadStyle(id) {
    var C = collageApi();
    if (!C || typeof C.loadStyle !== 'function' || !id) return Promise.resolve(null);
    if (styleCache[id]) return Promise.resolve(styleCache[id]);
    return Promise.resolve().then(function () { return C.loadStyle(id); }).then(function (pack) {
      styleCache[id] = pack;
      return pack;
    }).catch(function () { return null; });
  }
  function asPhotos(data) {
    var list = asList(data);
    if (!list.length && data && Array.isArray(data.results)) list = data.results;
    return list.filter(function (p) { return p && (p.file || p.id); }).map(function (p) {
      return {
        id: String(p.id || ''),
        file: String(p.file || ''),
        w: p.w || 0,
        h: p.h || 0,
        source: p.source || '',
        photographer: p.photographer || '',
        url: p.url || '',
        license: p.license || '',
        query: p.query || ''
      };
    });
  }
  function loadPhotos() {
    if (photoCache) return Promise.resolve(photoCache);
    var C = collageApi();
    if (!C) { photoCache = []; return Promise.resolve(photoCache); }
    var p = null;
    if (typeof C.photos === 'function') p = Promise.resolve().then(function () { return C.photos(); });
    else if (Array.isArray(C.photos)) p = Promise.resolve(C.photos);
    else if (C.photos && typeof C.photos.then === 'function') p = C.photos;
    else p = Promise.resolve(null);
    return p.then(function (data) {
      var list = asPhotos(data);
      if (list.length) { photoCache = list; return list; }
      return fetch(rootPath() + 'assets/data/collages/photos.json', { cache: 'force-cache' }).then(function (r) {
        if (!r.ok) return [];
        return r.json();
      }).then(function (json) {
        photoCache = asPhotos(json);
        return photoCache;
      }).catch(function () { photoCache = []; return photoCache; });
    }).catch(function () { photoCache = []; return photoCache; });
  }
  function catalogTemplates(idx) {
    var remote = [];
    if (idx) {
      remote = remote.concat(templatesFrom(idx));
      (idx.styles || []).forEach(function (style) {
        if (!style) return;
        (style.templates || []).forEach(function (t) {
          remote.push(Object.assign({ style: t.style || style.id, group: t.group || style.group }, t));
        });
      });
    }
    var map = {};
    STUBS.forEach(function (t) { map[t.id] = t; });
    remote.forEach(function (t) {
      if (!t || !t.id) return;
      map[t.id] = map[t.id] ? Object.assign({}, map[t.id], t) : t;
    });
    var out = [];
    Object.keys(map).forEach(function (k) { out.push(map[k]); });
    return out;
  }
  function synthesize(tpl) {
    tpl = tpl || {};
    if (tpl.slots && tpl.slots.length) return tpl;
    var n = Math.max(1, Math.min(12, tpl.slotCount || 4));
    var w = tpl.w || 1080, h = tpl.h || 1080;
    var cols = Math.max(1, Math.ceil(Math.sqrt(n * (w / h))));
    var rows = Math.ceil(n / cols);
    var gap = Math.min(w, h) * 0.025;
    var cw = (w - gap * (cols + 1)) / cols;
    var ch = (h - gap * (rows + 1)) / rows;
    var slots = [];
    for (var i = 0; i < n; i++) {
      var col = i % cols, row = Math.floor(i / cols);
      slots.push({ id: 'p' + (i + 1), label: 'Photo ' + (i + 1), x: gap + col * (cw + gap), y: gap + row * (ch + gap), w: cw, h: ch, radius: Math.min(cw, ch) * 0.04, z: i });
    }
    return Object.assign({}, tpl, { w: w, h: h, slots: slots, decor: tpl.decor || [], bg: tpl.bg || { type: 'solid', color: '#F4EFE6' } });
  }
  function resolveFull(tpl) {
    if (tpl && tpl.slots && tpl.slots.length) return Promise.resolve(tpl);
    if (!tpl || !tpl.style) return Promise.resolve(synthesize(tpl));
    return loadStyle(tpl.style).then(function (pack) {
      var found = templatesFrom(pack, tpl.style).filter(function (t) { return t.id === tpl.id; })[0];
      return synthesize(found || tpl);
    });
  }
  function sourceFromPhoto(photo) {
    if (!photo) return null;
    var provider = typeof photo.source === 'string' ? photo.source : (photo.source && photo.source.provider) || 'pool';
    var who = photo.photographer || '';
    var license = photo.license || '';
    return {
      provider: provider,
      photographer: who,
      pageUrl: photo.url || '',
      license: license,
      attribution: who ? ('Photo by ' + who + (license ? ' · ' + license : '')) : (license || 'Collage photo')
    };
  }
  function photoFileUrl(file) {
    var name = String(file || '').split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '');
    if (!name) return '';
    return rootPath() + 'assets/photos/collage/' + name;
  }
  function ensureUploads(c, ids) {
    return Promise.all(ids.map(function (id) {
      if (c.mem[id] && c.mem[id].canvas) return id;
      return LE.project.assetRecord(id).then(function (rec) {
        if (!rec || !rec.blob) return '';
        var file = new File([rec.blob], rec.name || 'photo', { type: rec.type || 'image/jpeg' });
        if (rec.source) file.source = rec.source;
        return c.ingest(file).then(function () { return id; });
      }).catch(function () { return ''; });
    })).then(function (list) { return list.filter(Boolean); });
  }
  function chooseFill(c, tpl, mode) {
    var n = tpl.slots.length;
    var uploads = uploadIds(c);
    if (mode !== 'uploads' && mode !== 'pool' && mode !== 'empty') mode = uploads.length >= n ? 'uploads' : 'pool';
    if (mode === 'empty') return Promise.resolve(tpl.slots.map(function () { return ''; }));
    if (mode === 'uploads') {
      if (!uploads.length) return Promise.resolve(tpl.slots.map(function () { return ''; }));
      return ensureUploads(c, uploads).then(function (ready) {
        if (!ready.length) return tpl.slots.map(function () { return ''; });
        return tpl.slots.map(function (slot, i) { return ready[i % ready.length]; });
      });
    }
    return loadPhotos().then(function (photos) {
      if (!photos.length) return tpl.slots.map(function () { return ''; });
      var ids = tpl.slots.map(function () { return ''; });
      var chain = Promise.resolve();
      tpl.slots.forEach(function (slot, i) {
        chain = chain.then(function () {
          var photo = null;
          if (slot.photo) {
            for (var p = 0; p < photos.length; p++) if (photos[p].id === slot.photo) photo = photos[p];
          }
          if (!photo) photo = photos[i % photos.length];
          var url = photoFileUrl(photo.file);
          if (!url) return null;
          return fetch(url).then(function (r) {
            if (!r.ok) return null;
            return r.blob();
          }).then(function (blob) {
            if (!blob) return null;
            var file = new File([blob], photo.file || 'photo.jpg', { type: blob.type || 'image/jpeg' });
            file.source = sourceFromPhoto(photo);
            return c.ingest(file).then(function (meta) { if (meta) ids[i] = meta.id; });
          }).catch(function () { return null; });
        });
      });
      return chain.then(function () { return ids; });
    });
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
  function applyBg(c, bg) {
    if (!bg) return;
    if (typeof bg === 'string') { c.setBackground({ type: 'color', color: bg }); return; }
    if (bg.type === 'linear' || bg.type === 'gradient' || (bg.colors && bg.colors.length)) {
      c.setBackground({ type: 'gradient', kind: bg.kind === 'radial' ? 'radial' : 'linear', colors: bg.colors || ['#ffffff', '#E7E5EB'], angle: bg.angle || 0, color: bg.color || '#ffffff' });
      return;
    }
    if (bg.color) c.setBackground({ type: 'color', color: bg.color });
  }
  function mount(c, tpl, ids) {
    var fresh = !c.S.project;
    var w = Math.max(16, Math.round(tpl.w || 1080));
    var h = Math.max(16, Math.round(tpl.h || 1080));
    if (fresh) c.newDesign(w, h, tpl.name || 'Collage');
    var page = c.doc();
    var sx = page.width / w, sy = page.height / h;
    var smin = Math.min(sx, sy) || 1;
    var items = [];
    tpl.slots.forEach(function (slot, i) {
      items.push({ z: slot.z == null ? i : slot.z, kind: 'slot', slot: slot, i: i });
      if (typeof slot.caption === 'string' && slot.caption) items.push({ z: (slot.z == null ? i : slot.z) + 0.4, kind: 'caption', slot: slot, i: i });
      else if (slot.caption && typeof slot.caption === 'object') items.push({ z: (slot.z == null ? i : slot.z) + 0.4, kind: 'decor', spec: slot.caption });
    });
    (tpl.decor || []).forEach(function (spec, i) { items.push({ z: spec.z == null ? 80 + i : spec.z, kind: 'decor', spec: spec }); });
    items.sort(function (a, b) { return a.z - b.z; });
    var first = null;
    var decorIds = [];
    c.batch(function () {
      applyBg(c, tpl.bg);
      items.forEach(function (item) {
        if (item.kind === 'slot') {
          var slot = item.slot;
          var box = { x: (slot.x || 0) * sx, y: (slot.y || 0) * sy, w: Math.max(8, (slot.w || 100) * sx), h: Math.max(8, (slot.h || 100) * sy) };
          var src = ids[item.i] || '';
          var mem = src && c.mem[src];
          var crop = { x: 0, y: 0, w: 1, h: 1 };
          if (mem && mem.canvas) crop = c.coverCrop(mem.canvas.width, mem.canvas.height, null, box.w, box.h, null);
          var shadow = slot.shadow ? { color: slot.shadow.color || 'rgba(42,31,10,.28)', blur: (slot.shadow.blur || 16) * smin, x: (slot.shadow.x || 0) * smin, y: (slot.shadow.y || 0) * smin } : null;
          var layer = {
            type: 'image',
            name: slot.label || ('Photo ' + (item.i + 1)),
            src: src,
            x: box.x, y: box.y, w: box.w, h: box.h,
            rotation: Number(slot.rot || slot.rotation || 0) || 0,
            radius: Math.max(0, Number(slot.radius || 0) * smin),
            mask: slot.mask && slot.mask !== 'none' ? String(slot.mask).slice(0, 40) : 'none',
            crop: crop,
            slot: { id: String(slot.id || ('p' + (item.i + 1))).slice(0, 40), label: String(slot.label || ('Photo ' + (item.i + 1))).slice(0, 80), photo: String(slot.photo || '').slice(0, 80) }
          };
          if (slot.border && Number(slot.border.width) > 0) layer.border = { width: Number(slot.border.width) * smin, color: slot.border.color || '#FBF8F3' };
          if (shadow) layer.shadow = shadow;
          if (slot.maskPath) layer.maskPath = slot.maskPath;
          var id = c.scene.add(layer);
          if (!first) first = id;
          item.box = box;
        } else if (item.kind === 'caption') {
          var host = item.box || { x: (item.slot.x || 0) * sx, y: (item.slot.y || 0) * sy, w: Math.max(8, (item.slot.w || 100) * sx), h: Math.max(8, (item.slot.h || 100) * sy) };
          var size = Math.max(16, Math.min(host.h * 0.09, 46));
          decorIds.push(c.scene.add({
            type: 'text', text: String(item.slot.caption), font: 'Caveat', weight: 700, size: size, align: 'center', color: '#2A1F0A',
            name: 'Caption', x: host.x, y: host.y + host.h - size * 1.45, w: host.w, h: size * 1.5
          }));
        } else if (item.spec) {
          decorIds.push(c.scene.add(scaleDecor(item.spec, tpl, sx, sy)));
        }
      });
      if (decorIds.length > 1) {
        var gid = c.scene.group(decorIds);
        if (gid) c.patch(gid, { name: (tpl.name || 'Collage') + ' details' });
      }
      if (first) c.scene.select([first]);
    });
    if (fresh) c.fit();
  }
  function applyTemplate(c, tpl, opts) {
    opts = opts || {};
    tpl = synthesize(tpl);
    if (!tpl.slots || !tpl.slots.length) { c.toast('That collage has no photo slots.'); return Promise.resolve(); }
    return chooseFill(c, tpl, opts.fill).then(function (ids) {
      mount(c, tpl, ids);
      c.toast('Tap a photo to replace it');
    }).catch(function (err) {
      c.toast((err && err.message) || 'Could not add that collage.');
    });
  }

  function slotArt(c, tpl) {
    var w = tpl.w || 1080, h = tpl.h || 1080;
    var slots = tpl.slots;
    var unit = false;
    if (!slots || !slots.length) {
      var n = tpl.slotCount || 4;
      var cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      var rows = Math.ceil(n / cols);
      slots = [];
      unit = true;
      for (var i = 0; i < n; i++) slots.push({ x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows });
    }
    var html = '<span class="sx-cg-art" style="--sx-ar:' + (w / h) + '">';
    slots.forEach(function (slot, i) {
      var px = unit || (slot.w <= 1.5 && slot.h <= 1.5 && slot.x <= 1.5 && slot.y <= 1.5);
      var left = px ? slot.x * 100 : (slot.x || 0) / w * 100;
      var top = px ? slot.y * 100 : (slot.y || 0) / h * 100;
      var sw = px ? slot.w * 100 : (slot.w || 10) / w * 100;
      var sh = px ? slot.h * 100 : (slot.h || 10) / h * 100;
      var rot = Number(slot.rot || slot.rotation || 0) || 0;
      html += '<i class="sx-cg-slot" style="left:' + left + '%;top:' + top + '%;width:' + sw + '%;height:' + sh + '%;background:' + FILLS[i % FILLS.length] + ';transform:rotate(' + rot + 'deg)"></i>';
    });
    html += '</span>';
    return html;
  }
  function renderCatalog(c, body, opts) {
    opts = opts || {};
    var surface = opts.surface === 'apps' ? 'apps' : 'design';
    var state = catState[surface];
    var wrap = c.h('<div class="sx-cg-root"></div>');
    body.appendChild(wrap);
    var search = c.h('<div class="sx-search sx-cg-search">' + c.ic('search') + '<input type="search" placeholder="Search templates" aria-label="Search templates" value="' + c.esc(state.q) + '"></div>');
    var input = search.querySelector('input');
    wrap.appendChild(search);
    var chips = c.h('<div class="sx-cg-chips" role="tablist"></div>');
    wrap.appendChild(chips);
    var list = c.h('<div class="sx-cg-list"></div>');
    wrap.appendChild(list);
    var chipSet = surface === 'apps'
      ? [['all', 'All'], ['classic', 'Classic'], ['collage', 'Styles']]
      : [['classic', 'Classic'], ['collage', 'Collage'], ['text', 'Text layouts'], ['new', 'New design']];
    function drawChips() {
      chips.innerHTML = '';
      chipSet.forEach(function (pair) {
        var b = c.h('<button type="button" class="sx-cg-chip" role="tab" aria-selected="' + (state.chip === pair[0]) + '">' + c.esc(pair[1]) + '</button>');
        b.onclick = function () { state.chip = pair[0]; drawChips(); draw(); };
        chips.appendChild(b);
      });
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
      var q = state.q.toLowerCase();
      var g = c.h('<div class="sx-grid sx-grid-2"></div>');
      c.SIZES.forEach(function (s) {
        if (q && (s.name.toLowerCase().indexOf(q) < 0 && String(s.w).indexOf(q) < 0)) return;
        var b = c.h('<button type="button" class="sx-size-mini"><span class="sx-size-art"><i style="width:28px;height:28px"></i></span><span><b>' + c.esc(s.name) + '</b><small>' + s.w + ' × ' + s.h + '</small></span></button>');
        b.onclick = function () { c.newDesign(s.w, s.h, s.name); };
        g.appendChild(b);
      });
      list.appendChild(g);
    }
    function drawPhotos(all, remoteReady) {
      list.innerHTML = '';
      var q = state.q.toLowerCase();
      var featured = all.filter(function (t) { return t.featured === true; });
      var pool = surface === 'design' && featured.length ? featured : all;
      var shown = pool.filter(function (t) {
        if (surface === 'design' && state.chip === 'classic' && !isClassic(t)) return false;
        if (surface === 'design' && state.chip === 'collage' && isClassic(t)) return false;
        if (surface === 'apps' && state.chip === 'classic' && !isClassic(t)) return false;
        if (surface === 'apps' && state.chip === 'collage' && isClassic(t)) return false;
        if (!q) return true;
        return ((t.name || '') + ' ' + (t.style || '') + ' ' + (t.id || '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!shown.length) {
        var title = state.chip === 'collage' ? 'No style collages yet' : 'No templates match';
        var copy = remoteReady ? 'Try another search, or use a classic layout.' : 'Style packs are not on this device yet. These built-in layouts still drop in photo slots you can replace.';
        if (state.chip === 'collage' && !q) list.appendChild(c.ui.empty(title, 'Style packs appear here when they are on this device. Classic layouts are ready now.', [{ label: 'Show classic', gold: true, fn: function () { state.chip = 'classic'; drawChips(); draw(); } }]));
        else list.appendChild(c.ui.empty(title, copy, []));
        return;
      }
      var g = c.h('<div class="sx-cg-grid"></div>');
      shown.forEach(function (t) {
        var count = (t.slots && t.slots.length) || t.slotCount || 0;
        var b = c.h('<button type="button" class="sx-cg-card"><span class="sx-cg-artwrap">' + slotArt(c, t) + '</span><b>' + c.esc(t.name || nice(t.id)) + '</b><small>' + (count ? count + ' photos' : nice(t.style || 'Collage')) + '</small></button>');
        b.onclick = function () {
          if (b.disabled) return;
          b.disabled = true;
          resolveFull(t).then(function (full) { return applyTemplate(c, full, {}); }).then(function () { b.disabled = false; }, function () { b.disabled = false; });
        };
        g.appendChild(b);
      });
      list.appendChild(g);
      if (!remoteReady && state.chip !== 'collage') list.appendChild(c.h('<p class="sx-note">Built-in photo layouts. Named style packs join this list when they are on this device.</p>'));
    }
    var remote = null;
    var ready = false;
    function draw() {
      if (surface === 'design' && state.chip === 'text') return drawText();
      if (surface === 'design' && state.chip === 'new') return drawSizes();
      drawPhotos(catalogTemplates(remote), ready);
    }
    input.addEventListener('input', c.debounce(function () { state.q = input.value.trim(); draw(); }, 140));
    drawChips();
    draw();
    loadIndex().then(function (idx) {
      remote = idx;
      ready = !!idx;
      if (state.chip === 'text' || state.chip === 'new') return;
      draw();
    });
  }

  function stockToken() {
    var api = stockApi();
    if (!api || typeof api.keys !== 'function') return '';
    var ov = (api.keys().openverse) || {};
    if (ov.token && ov.tokenExp && ov.tokenExp > Date.now()) return ov.token;
    return '';
  }
  function hasKey(provider) {
    var api = stockApi();
    if (!api || typeof api.keys !== 'function') return false;
    var k = api.keys();
    if (provider === 'pixabay') return !!(k.pixabay);
    if (provider === 'pexels') return !!(k.pexels);
    var ov = k.openverse || {};
    return !!(ov.clientId && ov.clientSecret);
  }
  function savedLine(label, secret) {
    if (!secret) return '';
    return '<p class="sx-stock-saved">' + label + ' saved · ' + tail(secret) + '</p>';
  }
  function quotaText() {
    var lim = stockState.limit || {};
    var left = lim['x-ratelimit-remaining'] || lim['x-ratelimit-available-anon_burst'] || lim['x-ratelimit-available'];
    var bits = [];
    if (left != null && left !== '') bits.push(String(left) + ' requests left');
    if (stockState.rate && stockState.rate.requestsThisMinute != null) bits.push(stockState.rate.requestsThisMinute + ' used this minute');
    else if (stockState.rate && stockState.rate.requestsToday != null) bits.push(stockState.rate.requestsToday + ' used today');
    if (stockState.rate && stockState.rate.model) bits.push(String(stockState.rate.model));
    if (!bits.length && stockState.rate && stockState.rate.message) return stockState.rate.message;
    return bits.join(' · ');
  }
  function paintKeys(c, host, opts, rerun) {
    var api = stockApi();
    var keys = api && api.keys ? api.keys() : { pixabay: '', pexels: '', openverse: {} };
    var ov = keys.openverse || {};
    host.innerHTML = '';
    var box = c.h('<div class="sx-stock-keys"></div>');
    box.appendChild(c.h('<div class="sx-stock-keys-h"><strong>Photo source keys</strong><button type="button" class="sx-link">Close</button></div>'));
    box.querySelector('.sx-link').onclick = function () { stockState.keys = false; if (rerun) rerun(); };
    function keyRow(provider, label, current) {
      var row = c.h('<label class="sx-field">' + c.esc(label) + '<input class="sx-input" type="password" autocomplete="off" spellcheck="false" placeholder="' + (current ? 'Paste a new key to replace it' : 'Paste key') + '"></label>');
      if (current) row.appendChild(c.h(savedLine(label, current)));
      var save = c.h('<button type="button" class="btn btn-gold btn-sm">Save ' + c.esc(label) + ' key</button>');
      save.onclick = function () {
        if (!api || !api.setKeys) { c.toast('Stock keys are not available yet.'); return; }
        var value = row.querySelector('input').value.trim();
        if (!value) { c.toast('Paste a key first.'); return; }
        var partial = {};
        partial[provider] = value;
        try { api.setKeys(partial); } catch (err) { c.toast(err.message || 'Could not save that key.'); return; }
        row.querySelector('input').value = '';
        c.toast(label + ' key saved on this device');
        paintKeys(c, host, opts, rerun);
      };
      row.appendChild(save);
      return row;
    }
    box.appendChild(keyRow('pixabay', 'Pixabay', keys.pixabay));
    box.appendChild(keyRow('pexels', 'Pexels', keys.pexels));
    var ovForm = c.h('<form class="sx-stock-ov"><h3>Openverse</h3><p class="sx-note">Anonymous search works. Register for a higher limit. Secrets stay on this device and are never shown in full after saving.</p></form>');
    ovForm.appendChild(c.h('<label class="sx-field">Application name<input class="sx-input" name="name" maxlength="120" value="LocalEditor on this device"></label>'));
    ovForm.appendChild(c.h('<label class="sx-field">Description<input class="sx-input" name="description" maxlength="240" value="Private photo studio on this device."></label>'));
    ovForm.appendChild(c.h('<label class="sx-field">Email<input class="sx-input" name="email" type="email" autocomplete="email" value="' + c.esc(ov.email || '') + '" required></label>'));
    ovForm.appendChild(c.h('<button type="submit" class="btn btn-gold btn-sm">Register with Openverse</button>'));
    if (stockState.verify) ovForm.appendChild(c.h('<p class="sx-stock-verify">' + c.esc(stockState.verify) + '</p>'));
    else if (ov.email) ovForm.appendChild(c.h('<p class="sx-stock-verify">Check the inbox for ' + c.esc(ov.email) + ' and verify the app. Until then, search stays on the anonymous limit.</p>'));
    ovForm.appendChild(c.h('<label class="sx-field">Client id<input class="sx-input" name="client" autocomplete="off" spellcheck="false" placeholder="' + (ov.clientId ? 'Paste a new client id' : 'Paste client id') + '"></label>'));
    if (ov.clientId) ovForm.appendChild(c.h(savedLine('Client id', ov.clientId)));
    ovForm.appendChild(c.h('<label class="sx-field">Client secret<input class="sx-input" name="secret" type="password" autocomplete="off" spellcheck="false" placeholder="' + (ov.clientSecret ? 'Paste a new secret' : 'Paste client secret') + '"></label>'));
    if (ov.clientSecret) ovForm.appendChild(c.h(savedLine('Secret', ov.clientSecret)));
    ovForm.appendChild(c.h('<button type="button" class="btn btn-gold btn-sm" data-token>Save and get token</button>'));
    ovForm.onsubmit = function (e) {
      e.preventDefault();
      if (!api || !api.registerOpenverse) { c.toast('Openverse registration is not available yet.'); return; }
      var fd = ovForm;
      api.registerOpenverse({
        name: fd.querySelector('[name="name"]').value.trim(),
        description: fd.querySelector('[name="description"]').value.trim(),
        email: fd.querySelector('[name="email"]').value.trim()
      }).then(function (res) {
        stockState.verify = (res && res.message) || 'Check your email and verify this app. Search stays on the anonymous limit until then.';
        c.toast('Check your email to verify Openverse');
        paintKeys(c, host, opts, rerun);
      }).catch(function (err) { c.toast((err && err.message) || 'Could not register.'); });
    };
    ovForm.querySelector('[data-token]').onclick = function () {
      if (!api || !api.tokenOpenverse) { c.toast('Openverse is not available yet.'); return; }
      var idVal = ovForm.querySelector('[name="client"]').value.trim();
      var secretVal = ovForm.querySelector('[name="secret"]').value.trim();
      if ((idVal || secretVal) && api.setKeys) {
        var partial = {};
        if (idVal) partial.clientId = idVal;
        if (secretVal) partial.clientSecret = secretVal;
        try { api.setKeys({ openverse: partial }); } catch (err) { c.toast(err.message || 'Could not save those credentials.'); return; }
      }
      ovForm.querySelector('[name="client"]').value = '';
      ovForm.querySelector('[name="secret"]').value = '';
      api.tokenOpenverse().then(function (token) {
        if (!token) { c.toast('Paste a client id and secret first.'); return; }
        c.toast('Openverse connected');
        paintKeys(c, host, opts, rerun);
      }).catch(function (err) { c.toast((err && err.message) || 'Verify the email, then try again.'); });
    };
    box.appendChild(ovForm);
    var quota = c.h('<p class="sx-stock-quota">' + c.esc(quotaText() || 'Quota appears after a search.') + '</p>');
    var refresh = c.h('<button type="button" class="btn btn-ghost btn-sm">Refresh quota</button>');
    refresh.onclick = function () {
      if (!api || !api.rateLimit || !stockToken()) {
        c.toast('Quota is available after an Openverse token is saved.');
        return;
      }
      api.rateLimit().then(function (r) { stockState.rate = r; quota.textContent = quotaText() || 'No quota details yet.'; }).catch(function (err) { c.toast((err && err.message) || 'Could not read the quota.'); });
    };
    box.appendChild(quota);
    box.appendChild(refresh);
    host.appendChild(box);
  }
  function hitButton(c, hit, opts) {
    var lic = hit.license ? '<em>' + c.esc(hit.license) + '</em>' : '';
    var b = c.h('<button type="button" class="sx-stock-hit"><img alt="" referrerpolicy="no-referrer">' + lic + '<small>' + c.esc(hit.photographer || hit.provider || 'Photo') + '</small></button>');
    var img = b.querySelector('img');
    img.alt = hit.attribution || hit.photographer || 'Stock photo';
    if (hit.thumb) img.src = hit.thumb;
    img.onerror = function () { img.removeAttribute('src'); };
    b.onclick = function () {
      var api = stockApi();
      if (!api || typeof api.importHit !== 'function') { c.toast('Stock import is not available yet.'); return; }
      if (b.disabled) return;
      b.disabled = true;
      api.importHit(hit).then(function (res) {
        var file = res && (res.file || res.blob);
        if (file && res.source && !file.source) file.source = res.source;
        if (opts.mode === 'replace') return c.replaceImage(res || file).then(function (meta) { if (meta) c.closeModal(); });
        if (!c.S.project) return c.newFromPhoto(file);
        return c.ingest(file).then(function (meta) { c.placeImage(meta.id); c.toast('Added to the design'); });
      }).catch(function (err) { c.toast((err && err.message) || 'Could not add that photo.'); }).then(function () { b.disabled = false; });
    };
    return b;
  }
  function renderStock(c, host, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var root = c.h('<div class="sx-stock-root"></div>');
    host.appendChild(root);
    var head = c.h('<div class="sx-stock-head"></div>');
    var grid = c.h('<div class="sx-stock-grid"></div>');
    var more = c.h('<div class="sx-stock-more"></div>');
    var foot = c.h('<div class="sx-stock-foot"></div>');
    root.appendChild(head);
    root.appendChild(grid);
    root.appendChild(more);
    root.appendChild(foot);
    function providers() {
      var api = stockApi();
      if (api && typeof api.providers === 'function') return api.providers();
      return [{ id: 'openverse', name: 'Openverse' }, { id: 'pixabay', name: 'Pixabay' }, { id: 'pexels', name: 'Pexels' }];
    }
    function paintHead() {
      head.innerHTML = '';
      var row = c.h('<div class="sx-stock-provs" role="tablist"></div>');
      providers().forEach(function (p) {
        var b = c.h('<button type="button" class="sx-stock-prov" role="tab" aria-selected="' + (stockState.provider === p.id) + '">' + c.esc(p.name) + '</button>');
        b.onclick = function () {
          stockState.provider = p.id;
          stockState.error = '';
          paintHead();
          run(true);
        };
        row.appendChild(b);
      });
      var keysBtn = c.h('<button type="button" class="sx-stock-keysbtn">' + c.ic('lock') + '<span>Keys</span></button>');
      keysBtn.onclick = function () { stockState.keys = !stockState.keys; paintFoot(); };
      var bar = c.h('<div class="sx-stock-bar"></div>');
      bar.appendChild(row);
      bar.appendChild(keysBtn);
      head.appendChild(bar);
      var form = c.h('<form class="sx-search sx-stock-search" role="search">' + c.ic('search') + '<input type="search" aria-label="Search stock photos" placeholder="Search photos" value="' + c.esc(stockState.q) + '"></form>');
      var field = form.querySelector('input');
      form.onsubmit = function (e) { e.preventDefault(); stockState.q = field.value.trim(); run(true); };
      field.addEventListener('input', c.debounce(function () { stockState.q = field.value.trim(); run(true); }, 280));
      head.appendChild(form);
      if (stockState.provider === 'pexels') head.appendChild(c.h('<p class="sx-stock-credit">Photos provided by <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a></p>'));
      else if (stockState.provider === 'pixabay') head.appendChild(c.h('<p class="sx-stock-credit">Photos from <a href="https://pixabay.com" target="_blank" rel="noopener noreferrer">Pixabay</a></p>'));
    }
    function paintGrid() {
      grid.innerHTML = '';
      more.innerHTML = '';
      if (stockState.loading && !stockState.hits.length) {
        grid.appendChild(c.h('<p class="sx-note">Searching…</p>'));
        return;
      }
      if (stockState.error && !stockState.hits.length) {
        grid.appendChild(c.ui.empty('Could not search', stockState.error, stockState.error.indexOf('key') >= 0 ? [{ label: 'Add keys', gold: true, fn: function () { stockState.keys = true; paintFoot(); } }] : []));
        return;
      }
      if (!stockState.hits.length) {
        grid.appendChild(c.h('<p class="sx-note">No photos for that search.</p>'));
        return;
      }
      stockState.hits.forEach(function (hit) { grid.appendChild(hitButton(c, hit, opts)); });
      if (stockState.more) {
        var sentinel = c.h('<button type="button" class="btn btn-ghost btn-sm sx-block">More photos</button>');
        sentinel.onclick = function () { run(false); };
        more.appendChild(sentinel);
      }
    }
    function paintFoot() {
      foot.innerHTML = '';
      var q = quotaText();
      if (q) foot.appendChild(c.h('<p class="sx-stock-quota">' + c.esc(q) + '</p>'));
      if (stockState.keys) paintKeys(c, foot, opts, function () { paintHead(); run(true); });
    }
    function run(reset) {
      var api = stockApi();
      if (!api || typeof api.search !== 'function') {
        grid.innerHTML = '';
        grid.appendChild(c.ui.empty('Stock photos', 'Search needs the stock library. Add keys once it is on this device.', [{ label: 'Keys', gold: true, fn: function () { stockState.keys = true; paintFoot(); } }]));
        paintFoot();
        return;
      }
      var provider = stockState.provider;
      if ((provider === 'pixabay' || provider === 'pexels') && !hasKey(provider)) {
        stockState.hits = [];
        stockState.loading = false;
        stockState.error = 'Add a ' + nice(provider) + ' key to search ' + nice(provider) + '.';
        paintGrid();
        paintFoot();
        return;
      }
      var q = stockState.q || 'flower';
      if (reset) {
        stockState.page = 1;
        stockState.hits = [];
        stockState.gen += 1;
        stockState.more = false;
      } else stockState.page += 1;
      var gen = stockState.gen;
      var page = stockState.page;
      stockState.loading = true;
      stockState.error = '';
      paintGrid();
      api.search(q, { provider: provider, page: page, perPage: 20 }).then(function (res) {
        if (gen !== stockState.gen) return;
        var hits = res && res.hits ? res.hits : [];
        stockState.hits = reset ? hits : stockState.hits.concat(hits);
        stockState.total = res && res.total ? res.total : stockState.hits.length;
        stockState.limit = (res && res.limit) || stockState.limit;
        stockState.more = hits.length >= 20 && stockState.hits.length < stockState.total;
        stockState.loading = false;
        paintGrid();
        paintFoot();
      }).catch(function (err) {
        if (gen !== stockState.gen) return;
        stockState.loading = false;
        stockState.error = (err && err.message) || 'Could not search.';
        if (err && err.status === 401) stockState.keys = true;
        if (err && err.status === 429) c.toast(stockState.error);
        paintGrid();
        paintFoot();
      });
    }
    paintHead();
    run(true);
  }

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
    function useUpload(id) {
      c.replaceImage(id).then(function (meta) { if (meta) c.closeModal(); });
    }
    function paintUploads() {
      body.innerHTML = '';
      var mine = uploadIds(c);
      if (!mine.length) {
        body.appendChild(c.ui.empty('No uploads yet', 'Choose a photo from this device, or search stock.', [{ label: 'This device', gold: true, fn: function () { repTab = 'device'; paintTabs(); paint(); } }]));
        return;
      }
      var g = c.h('<div class="sx-rep-grid"></div>');
      mine.forEach(function (id) {
        var name = (c.S.project.assets[id] && c.S.project.assets[id].name) || 'Photo';
        var b = c.h('<button type="button" class="sx-thumb" aria-label="Use ' + c.esc(name) + '"><img alt=""></button>');
        c.thumbUrl(id).then(function (u) { if (u) b.querySelector('img').src = u; });
        b.onclick = function () { useUpload(id); };
        g.appendChild(b);
      });
      body.appendChild(g);
      var all = c.h('<div class="sx-rep-grid sx-rep-all"></div>');
      body.appendChild(c.h('<h3 class="sx-sub">Other photos on this device</h3>'));
      body.appendChild(all);
      LE.project.assets().then(function (list) {
        list = (list || []).filter(function (a) { return mine.indexOf(a.id) < 0; });
        if (!list.length || !body.isConnected) return;
        list.slice(0, 48).forEach(function (a) {
          var b = c.h('<button type="button" class="sx-thumb" aria-label="Use ' + c.esc(a.name || 'photo') + '"><img alt=""></button>');
          c.thumbUrl(a.id).then(function (u) { if (u) b.querySelector('img').src = u; });
          b.onclick = function () { useUpload(a.id); };
          all.appendChild(b);
        });
      }).catch(function () {});
    }
    function paintDevice() {
      body.innerHTML = '';
      var box = c.h('<div class="sx-rep-device"><p>The frame, mask, rotation, and crop stay. Only the picture changes.</p><button type="button" class="btn btn-gold sx-block">Choose a photo</button><input type="file" accept="image/*" hidden></div>');
      var input = box.querySelector('input');
      box.querySelector('button').onclick = function () { input.click(); };
      input.onchange = function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        c.replaceImage(file).then(function (meta) { if (meta) c.closeModal(); });
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
    repTab = 'uploads';
    var host = document.createElement('div');
    var sheet = c.openModal('Replace photo', host);
    var card = sheet && sheet.parentElement;
    if (card) card.classList.add('sx-rep-card');
    renderReplaceSheet(c, host);
  }

  function placeChip(c) {
    if (!chipBtn || !c || !c.E) return;
    var show = null;
    if (c.S.project && c.S.tool === 'select' && !c.S.preview && !c.S.editing) {
      if (c.isPhone()) {
        var current = c.one();
        if (current && current.type === 'image' && current.slot) show = current.id;
      } else if (hoverId) {
        var hovered = c.L(hoverId);
        if (hovered && hovered.type === 'image' && hovered.slot) show = hoverId;
      }
    }
    if (!show) { chipBtn.hidden = true; return; }
    var rect = c.scene.screenRect(show);
    var stage = c.E.stage.getBoundingClientRect();
    if (!rect || rect.width < 12 || rect.height < 12) { chipBtn.hidden = true; return; }
    chipBtn.hidden = false;
    chipBtn.setAttribute('data-id', show);
    var width = chipBtn.offsetWidth || 86;
    var x = rect.left + rect.width / 2 - stage.left - width / 2;
    var y = rect.top - stage.top + 8;
    x = Math.max(8, Math.min(x, stage.width - width - 8));
    y = Math.max(8, Math.min(y, stage.height - 40));
    chipBtn.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }
  function bindChrome(c) {
    if (bound) return;
    bound = true;
    chipBtn = c.h('<button type="button" class="sx-rep-chip" hidden>Replace</button>');
    c.E.stage.appendChild(chipBtn);
    chipBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = chipBtn.getAttribute('data-id');
      if (id) c.scene.select([id]);
      openReplace(c);
    });
    if (c.scene && c.scene.on) {
      c.scene.on('hover', function (e) { hoverId = e && e.id; placeChip(c); });
      c.scene.on('zoom', function () { placeChip(c); });
    }
    window.addEventListener('pointerup', function () { placeChip(c); });
  }
  hook('init', function (c) { studio = c; bindChrome(c); });
  hook('select', function (c) { placeChip(c); });
  hook('zoom', function (c) { placeChip(c); });

  window.LEStudioCollage = {
    renderCatalog: renderCatalog,
    renderReplaceSheet: renderReplaceSheet,
    renderStock: renderStock,
    applyTemplate: applyTemplate,
    openReplace: openReplace
  };
})();
