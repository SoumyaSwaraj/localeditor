/* LocalEditor projects: versioned documents, content-addressed assets, a local ledger, and .leproject files. */
(function () {
  'use strict';

  var LE = window.LE = window.LE || {};
  var SCHEMA = 'localeditor.project';
  var VERSION = 1;
  var APP = '2.0';
  var DB_NAME = 'le-projects';
  var LIMITS = {
    pages: 50, layers: 600, text: 8000, name: 160, assets: 400, svg: 200000, points: 20000,
    history: 200, assetBytes: 80 * 1024 * 1024, totalBytes: 600 * 1024 * 1024, json: 12 * 1024 * 1024, entries: 1200
  };
  var BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  var IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' };
  var BLENDS = ['source-over', 'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  var ADJUST_KEYS = ['brightness', 'contrast', 'saturation', 'warmth', 'temperature', 'tint', 'exposure', 'highlights', 'shadows', 'vibrance', 'sharpness', 'blur', 'vignette', 'grain', 'hue',
    'fade', 'clarity', 'splitShadowHue', 'splitShadowAmount', 'splitHighlightHue', 'splitHighlightAmount', 'splitBalance', 'black', 'white', 'gamma'];

  function now() { return Date.now(); }
  function uid(p) { return (p || 'p') + now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tier() { return LE.device && LE.device.tier ? LE.device.tier() : 'desktop'; }
  function level() { return LE.perf && LE.perf.level ? LE.perf.level() : 'high'; }

  function fingerprint(str) {
    str = String(str || '');
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = ((h2 << 5) + h2 + c) >>> 0;
    }
    return h1.toString(16) + '-' + h2.toString(16) + '-' + str.length.toString(36);
  }

  /* ---------- SHA-256 ---------- */
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256js(buf) {
    var bytes = new Uint8Array(buf);
    var len = bytes.length;
    var total = ((len + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    var bits = len * 8;
    var dv = new DataView(m.buffer);
    dv.setUint32(total - 4, bits >>> 0);
    dv.setUint32(total - 8, Math.floor(bits / 4294967296));
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var o = 0; o < total; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
    return hex(out.buffer);
  }
  function toBuffer(src) {
    if (src instanceof ArrayBuffer) return Promise.resolve(src);
    if (src && src.buffer instanceof ArrayBuffer && src.byteLength != null) return Promise.resolve(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
    if (src && src.arrayBuffer) return src.arrayBuffer();
    return new Response(src).arrayBuffer();
  }
  function hash(src) {
    return toBuffer(src).then(function (buf) {
      if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        return crypto.subtle.digest('SHA-256', buf).then(hex, function () { return sha256js(buf); });
      }
      return sha256js(buf);
    });
  }

  /* ---------- IndexedDB ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('This browser cannot store designs.')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('versions')) d.createObjectStore('versions', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        if (!d.objectStoreNames.contains('ledger')) d.createObjectStore('ledger', { keyPath: 'seq', autoIncrement: true }).createIndex('projectId', 'projectId');
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { dbp = null; rej(req.error || new Error('Storage failed')); };
    });
    return dbp;
  }
  function run(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode);
        var result;
        var r = fn(t.objectStore(store));
        if (r) r.onsuccess = function () { result = r.result; };
        t.oncomplete = function () { res(result); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('Storage is full or unavailable.')); };
      });
    });
  }
  function get(store, key) { return run(store, 'readonly', function (s) { return s.get(key); }); }
  function put(store, value) { return run(store, 'readwrite', function (s) { return s.put(value); }); }
  function del(store, key) { return run(store, 'readwrite', function (s) { return s.delete(key); }); }
  function all(store) { return run(store, 'readonly', function (s) { return s.getAll(); }); }
  function byProject(store, id) { return run(store, 'readonly', function (s) { return s.index('projectId').getAll(id); }); }

  function log(type, projectId, detail) {
    return put('ledger', { type: type, projectId: projectId || null, at: now(), detail: detail || null }).catch(function () {});
  }

  /* ---------- Schema ---------- */
  function blankPage(w, h, bg) {
    return { v: 1, width: Math.max(1, Math.round(num(w, 1080))), height: Math.max(1, Math.round(num(h, 1080))), background: bg || { type: 'color', color: '#ffffff' }, layers: [] };
  }
  function create(opts) {
    opts = opts || {};
    var t = now();
    return {
      schema: SCHEMA, v: VERSION, id: uid('d'), name: String(opts.name || 'Untitled design').slice(0, LIMITS.name),
      kind: opts.kind || 'design', createdAt: t, updatedAt: t,
      pages: opts.pages || [blankPage(opts.width, opts.height, opts.background)], activePage: 0,
      assets: opts.assets || {}, sizeHistory: [], meta: { app: APP, tier: tier(), studio: opts.studio || {} }
    };
  }
  function assetIds(project) {
    var ids = {};
    Object.keys((project && project.assets) || {}).forEach(function (k) { ids[k] = 1; });
    function scan(doc) {
      if (!doc) return;
      if (doc.background && doc.background.src) ids[doc.background.src] = 1;
      (doc.layers || []).forEach(function (l) { if (l.type === 'image' && l.src) ids[l.src] = 1; });
    }
    ((project && project.pages) || []).forEach(scan);
    return Object.keys(ids).filter(function (k) { return /^[a-f0-9]{64}$/.test(k); });
  }

  /* ---------- Projects ---------- */
  function save(project, opts) {
    opts = opts || {};
    if (!project || !project.id) return Promise.reject(new Error('No project to save.'));
    project.updatedAt = now();
    var json = JSON.stringify(project);
    var page = project.pages && project.pages[project.activePage || 0];
    var rec = {
      id: project.id, name: project.name, kind: project.kind, createdAt: project.createdAt, updatedAt: project.updatedAt,
      pages: (project.pages || []).length, width: page ? page.width : 0, height: page ? page.height : 0,
      bytes: json.length, doc: JSON.parse(json)
    };
    var keep = opts.thumb ? Promise.resolve(opts.thumb) : get('projects', project.id).then(function (old) { return old ? old.thumb : null; }, function () { return null; });
    return keep.then(function (thumb) {
      rec.thumb = thumb || null;
      return put('projects', rec);
    }).then(function () {
      if (opts.created) log('created', project.id, { name: project.name });
      return rec;
    });
  }
  function list() {
    return all('projects').then(function (rows) {
      return (rows || []).map(function (r) {
        return { id: r.id, name: r.name, kind: r.kind, createdAt: r.createdAt, updatedAt: r.updatedAt, pages: r.pages, width: r.width, height: r.height, bytes: r.bytes, thumb: r.thumb || null };
      }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    });
  }
  function open(id) {
    return get('projects', id).then(function (rec) {
      if (!rec) throw new Error('That design is no longer on this device.');
      log('opened', id);
      var t = now();
      assetIds(rec.doc).forEach(function (aid) {
        get('assets', aid).then(function (a) { if (a) { a.lastUsed = t; put('assets', a); } }).catch(function () {});
      });
      return clone(rec.doc);
    });
  }
  function rename(id, name) {
    return get('projects', id).then(function (rec) {
      if (!rec) return null;
      rec.name = rec.doc.name = String(name || 'Untitled design').slice(0, LIMITS.name);
      return put('projects', rec).then(function () { return rec.name; });
    });
  }
  function duplicate(id) {
    return get('projects', id).then(function (rec) {
      if (!rec) throw new Error('Design not found.');
      var doc = clone(rec.doc);
      doc.id = uid('d');
      doc.name = (doc.name || 'Design') + ' copy';
      doc.createdAt = now();
      return save(doc, { thumb: rec.thumb }).then(function () {
        log('created', doc.id, { from: id });
        return doc;
      });
    });
  }
  function remove(id) {
    return byProject('versions', id).then(function (vs) {
      return Promise.all((vs || []).map(function (v) { return del('versions', v.id); }));
    }).then(function () { return del('projects', id); }).then(function () {
      log('deleted', id);
      return gc();
    });
  }

  /* ---------- Assets ---------- */
  function putAsset(info) {
    var blob = info.blob;
    return hash(blob).then(function (id) {
      return get('assets', id).then(function (old) {
        var t = now();
        var source = cleanSource(info.source);
        if (old) {
          old.lastUsed = t;
          if (!old.thumb && info.thumb) old.thumb = info.thumb;
          if (source) old.source = source;
          return put('assets', old).then(function () { return meta(old); });
        }
        var rec = {
          id: id, blob: blob, type: blob.type || info.type || 'image/png', name: String(info.name || 'image').slice(0, LIMITS.name),
          width: Math.round(num(info.width, 0)), height: Math.round(num(info.height, 0)), bytes: blob.size,
          thumb: info.thumb || null, createdAt: t, lastUsed: t, refs: 0
        };
        if (source) rec.source = source;
        return put('assets', rec).then(function () { return meta(rec); });
      });
    });
  }
  function meta(rec) {
    var m = { id: rec.id, type: rec.type, name: rec.name, width: rec.width, height: rec.height, bytes: rec.bytes, original: true };
    var source = cleanSource(rec.source);
    if (source) m.source = source;
    return m;
  }
  function getAsset(id) { return get('assets', id).then(function (r) { return r ? r.blob : null; }); }
  function assetRecord(id) { return get('assets', id); }
  function assets() {
    return all('assets').then(function (rows) {
      return (rows || []).map(function (r) {
        var m = meta(r);
        m.thumb = r.thumb || null;
        m.lastUsed = r.lastUsed;
        m.refs = r.refs || 0;
        return m;
      }).sort(function (a, b) { return b.lastUsed - a.lastUsed; });
    });
  }

  /* ---------- Versions ---------- */
  function keepCount() { var l = level(); return l === 'high' ? 30 : l === 'mid' ? 20 : 10; }
  function snapshot(id, label, opts) {
    opts = opts || {};
    var source = opts.project ? Promise.resolve({ doc: clone(opts.project), thumb: opts.thumb || null }) : get('projects', id);
    return source.then(function (rec) {
      if (!rec) throw new Error('Save the design first.');
      var v = {
        id: uid('v'), projectId: id, at: now(), label: label ? String(label).slice(0, 80) : '',
        kind: label ? 'checkpoint' : 'auto', doc: clone(rec.doc), thumb: opts.thumb || rec.thumb || null
      };
      return put('versions', v).then(function () {
        log(label ? 'checkpoint' : 'autosaved', id, label ? { label: v.label } : null);
        return prune(id);
      }).then(function () { return { id: v.id, at: v.at, label: v.label, kind: v.kind }; });
    });
  }
  function prune(id) {
    return byProject('versions', id).then(function (vs) {
      var autos = (vs || []).filter(function (v) { return v.kind === 'auto'; }).sort(function (a, b) { return b.at - a.at; });
      var extra = autos.slice(keepCount());
      return Promise.all(extra.map(function (v) { return del('versions', v.id); }));
    });
  }
  function versions(id) {
    return byProject('versions', id).then(function (vs) {
      return (vs || []).sort(function (a, b) { return b.at - a.at; });
    });
  }
  function restore(id, versionId) {
    return get('versions', versionId).then(function (v) {
      if (!v || v.projectId !== id) throw new Error('That version is gone.');
      var doc = clone(v.doc);
      doc.id = id;
      return save(doc, { thumb: v.thumb }).then(function () {
        log('restored', id, { version: versionId, at: v.at });
        return doc;
      });
    });
  }

  /* ---------- Ledger, usage, cleanup ---------- */
  function ledger(id) {
    var q = id ? byProject('ledger', id) : all('ledger');
    return q.then(function (rows) { return (rows || []).sort(function (a, b) { return b.at - a.at; }).slice(0, 300); });
  }
  function blobSize(b) { return b && b.size ? b.size : 0; }
  function usage() {
    return Promise.all([all('projects'), all('assets'), all('versions')]).then(function (r) {
      var projects = 0, assetsBytes = 0, versionsBytes = 0;
      r[0].forEach(function (p) { projects += (p.bytes || 0) + blobSize(p.thumb); });
      r[1].forEach(function (a) { assetsBytes += (a.bytes || 0) + blobSize(a.thumb); });
      r[2].forEach(function (v) { versionsBytes += JSON.stringify(v.doc || {}).length + blobSize(v.thumb); });
      var out = { projects: projects, assets: assetsBytes, versions: versionsBytes, total: projects + assetsBytes + versionsBytes, counts: { projects: r[0].length, assets: r[1].length, versions: r[2].length }, quota: null, usage: null };
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (e) { out.quota = e.quota || null; out.usage = e.usage || null; return out; }, function () { return out; });
      }
      return out;
    });
  }
  function cleanKit(k) {
    k = k && typeof k === 'object' ? k : {};
    var hex = /^#[0-9a-f]{6}$/i;
    var colors = (Array.isArray(k.colors) ? k.colors : []).filter(function (c) { return typeof c === 'string' && hex.test(c); }).map(function (c) { return c.toLowerCase(); });
    var fonts = (Array.isArray(k.fonts) ? k.fonts : []).filter(function (f) { return f && typeof f.family === 'string' && f.family.length < 80; }).map(function (f) {
      return { family: f.family.slice(0, 80), weight: Math.max(100, Math.min(900, Math.round(num(f.weight, 400) / 100) * 100)), role: oneOf(f.role, ['heading', 'subheading', 'body'], 'body') };
    });
    var logos = (Array.isArray(k.logos) ? k.logos : []).filter(function (id) { return typeof id === 'string' && /^[\w-]{1,80}$/.test(id); });
    return { name: str(k.name, 60, 'Brand kit'), colors: colors.filter(function (c, i) { return colors.indexOf(c) === i; }).slice(0, 40), fonts: fonts.slice(0, 8), logos: logos.slice(0, 12) };
  }
  function brandRows() {
    return all('ledger').then(function (rows) { return (rows || []).filter(function (r) { return r.type === 'brand' && !r.projectId; }).sort(function (a, b) { return b.seq - a.seq; }); });
  }
  function brandKit() {
    return brandRows().then(function (rows) { return cleanKit(rows[0] && rows[0].detail); }).catch(function () { return cleanKit(null); });
  }
  function saveBrandKit(kit) {
    var k = cleanKit(kit);
    return put('ledger', { type: 'brand', projectId: null, at: now(), detail: k }).then(function () {
      return brandRows();
    }).then(function (rows) {
      return Promise.all(rows.slice(5).map(function (r) { return del('ledger', r.seq); }));
    }).then(function () { return k; });
  }
  function gc(opts) {
    opts = opts || {};
    var grace = opts.grace == null ? 10 * 60 * 1000 : opts.grace;
    return Promise.all([all('projects'), all('versions'), all('assets'), brandKit()]).then(function (r) {
      var refs = {};
      function count(doc) { assetIds(doc).forEach(function (id) { refs[id] = (refs[id] || 0) + 1; }); }
      r[0].forEach(function (p) { count(p.doc); });
      r[1].forEach(function (v) { count(v.doc); });
      r[3].logos.forEach(function (id) { refs[id] = (refs[id] || 0) + 1; });
      var t = now(), removed = 0, freed = 0;
      return Promise.all(r[2].map(function (a) {
        var n = refs[a.id] || 0;
        if (!n && t - (a.createdAt || 0) > grace) {
          removed++;
          freed += a.bytes || 0;
          return del('assets', a.id);
        }
        if (a.refs !== n) { a.refs = n; return put('assets', a); }
        return null;
      })).then(function () { return { removed: removed, freed: freed }; });
    });
  }

  /* ---------- Validation ---------- */
  function str(v, max, d) { return typeof v === 'string' ? v.slice(0, max) : (d == null ? '' : d); }
  function safeHttp(u) {
    if (typeof u !== 'string') return '';
    u = u.trim();
    if (!u || u.length > 500) return '';
    if (!/^https?:\/\//i.test(u)) return '';
    if (/[\s<>"']/.test(u)) return '';
    return u;
  }
  function cleanSource(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    var o = {};
    if (typeof s.provider === 'string' && s.provider.trim()) o.provider = s.provider.trim().slice(0, 40);
    if (typeof s.photographer === 'string' && s.photographer.trim()) o.photographer = s.photographer.trim().slice(0, 160);
    var page = safeHttp(s.pageUrl);
    if (page) o.pageUrl = page;
    var who = safeHttp(s.photographerUrl);
    if (who) o.photographerUrl = who;
    if (typeof s.license === 'string' && s.license.trim()) o.license = s.license.trim().slice(0, 80);
    if (typeof s.attribution === 'string' && s.attribution.trim()) o.attribution = s.attribution.trim().slice(0, 600);
    if (!o.provider && !o.photographer && !o.pageUrl && !o.license && !o.attribution) return null;
    return o;
  }
  function sanitizeMaskPath(d) {
    if (typeof d !== 'string' || !d || d.length > 20000) return '';
    if (!/[MmLlCcQqAaZzHhVv]/.test(d)) return '';
    if (/[^MmLlCcQqAaZzHhVv0-9eE+.,\s-]/.test(d)) return '';
    return d;
  }
  function slotSpec(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    var id = typeof s.id === 'string' ? s.id.replace(/[^\w.-]/g, '').slice(0, 40) : '';
    var label = typeof s.label === 'string' ? s.label.replace(/[<>]/g, '').slice(0, 80) : '';
    var photo = typeof s.photo === 'string' ? s.photo.replace(/[^\w.-]/g, '').slice(0, 80) : '';
    if (!id && !label && !photo) return null;
    return { id: id, label: label, photo: photo };
  }
  function bool(v) { return v === true; }
  /* The applied-recipe note on a photo: what the recipe added, so it can be removed or re-tuned later. */
  function lookFilter(f) {
    return f && typeof f === 'object' && typeof f.name === 'string' && /^[a-z-]{1,30}$/.test(f.name) ? { name: f.name, intensity: clamp(num(f.intensity, 100), 0, 100) } : null;
  }
  function recipeMarker(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.id !== 'string' || !/^[\w.-]{1,80}$/.test(m.id)) return null;
    var out = { id: m.id, name: str(m.name, 120).replace(/[<>]/g, ''), strength: clamp(num(m.strength, 75), 0, 200), add: {}, prev: {}, filter: m.filter === true, prevFilter: lookFilter(m.prevFilter) };
    ADJUST_KEYS.forEach(function (k) {
      if (m.add && typeof m.add === 'object' && m.add[k] != null && isFinite(Number(m.add[k]))) out.add[k] = clamp(Number(m.add[k]), -2000, 2000);
      if (m.prev && typeof m.prev === 'object' && Object.prototype.hasOwnProperty.call(m.prev, k)) {
        out.prev[k] = m.prev[k] == null || !isFinite(Number(m.prev[k])) ? null : clamp(Number(m.prev[k]), -1000, 1000);
      }
    });
    return out;
  }
  function oneOf(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function safeColor(v) {
    if (typeof v !== 'string') return null;
    var c = v.trim();
    if (c.length > 64) return null;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
    if (/^(?:rgb|hsl)a?\(\s*[\d.%\s,\/-]+\)$/i.test(c)) return c;
    if (/^[a-z]{3,24}$/i.test(c)) return c;
    return null;
  }
  var SVG_TAGS = {};
  ('svg g path rect circle ellipse line polyline polygon text tspan textpath defs lineargradient radialgradient stop clippath mask pattern symbol use ' +
    'title desc image style marker switch filter feblend fecolormatrix fecomponenttransfer fecomposite feconvolvematrix fediffuselighting ' +
    'fedisplacementmap fedistantlight fedropshadow feflood fefunca fefuncb fefuncg fefuncr fegaussianblur femerge femergenode femorphology ' +
    'feoffset fepointlight fespecularlighting fespotlight fetile feturbulence').split(' ').forEach(function (t) { SVG_TAGS[t] = 1; });
  var SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+\/=\s]+$/i;

  function cleanCss(css) {
    return String(css || '')
      .replace(/<\/?\s*/g, '')
      .replace(/@import\b[^;]*;?/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, function (_, q, u) {
        u = String(u || '').trim();
        if (u.charAt(0) === '#') return 'url(#' + u.slice(1).replace(/[^A-Za-z0-9_.:-]/g, '') + ')';
        return 'none';
      });
  }
  function sanitizeSvg(svg) {
    svg = String(svg || '').slice(0, LIMITS.svg);
    if (!/<svg[\s>]/i.test(svg) || /<!(?:DOCTYPE|ENTITY)/i.test(svg) || typeof DOMParser === 'undefined') return '';
    var doc;
    try { doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); } catch (e) { return ''; }
    var root = doc && doc.documentElement;
    if (!root || String(root.localName || '').toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return '';
    var all = [root].concat([].slice.call(root.getElementsByTagName('*')));
    for (var i = all.length - 1; i >= 0; i--) {
      var n = all[i];
      var name = String(n.localName || '').toLowerCase();
      if (!SVG_TAGS[name] || (n.namespaceURI && n.namespaceURI !== 'http://www.w3.org/2000/svg')) {
        if (n !== root && n.parentNode) n.parentNode.removeChild(n);
        continue;
      }
      if (name === 'style') { n.textContent = cleanCss(n.textContent); continue; }
      var attrs = [].slice.call(n.attributes || []);
      for (var a = 0; a < attrs.length; a++) {
        var an = String(attrs[a].name || '');
        var nm = an.toLowerCase();
        var val = String(attrs[a].value || '');
        if (nm.indexOf('on') === 0 || BAD_KEYS[nm] || /^(?:xmlns:(?!xlink$)|xml:base)/.test(nm)) { n.removeAttribute(an); continue; }
        if (nm === 'style') {
          var css = cleanCss(val);
          if (css.trim()) n.setAttribute(an, css); else n.removeAttribute(an);
          continue;
        }
        if (nm === 'href' || nm === 'xlink:href' || nm.slice(-5) === ':href') {
          var u = val.trim();
          if (!(u.charAt(0) === '#' || (name === 'image' && SAFE_DATA_IMAGE.test(u)))) n.removeAttribute(an);
          continue;
        }
        if (/javascript\s*:|data\s*:|@import|expression\s*\(/i.test(val)) { n.removeAttribute(an); continue; }
        if (/url\s*\(/i.test(val)) {
          var fixed = cleanCss(val);
          if (fixed !== val) n.setAttribute(an, fixed);
        }
      }
    }
    var out = '';
    try { out = new XMLSerializer().serializeToString(root); } catch (e2) { return ''; }
    return out.length > LIMITS.svg ? '' : out;
  }
  function fillSpec(f) {
    if (!f || typeof f !== 'object') return null;
    var type = oneOf(f.type, ['solid', 'linear', 'radial', 'none'], 'solid');
    var out = { type: type };
    var c = safeColor(f.color);
    if (c) out.color = c;
    if (Array.isArray(f.colors)) out.colors = f.colors.slice(0, 8).map(safeColor).filter(Boolean);
    if (f.angle != null) out.angle = clamp(num(f.angle, 0), -360, 360);
    return out;
  }
  function shadowSpec(s) {
    if (!s || typeof s !== 'object') return null;
    return { color: safeColor(s.color) || 'rgba(23,19,31,.35)', blur: clamp(num(s.blur, 16), 0, 500), x: clamp(num(s.x, 0), -2000, 2000), y: clamp(num(s.y, 8), -2000, 2000) };
  }
  function idOk(v, max) { return typeof v === 'string' && v.length <= (max || 64) && /^[\w:.-]+$/.test(v); }
  function sanitizeLayer(src, errors) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    var types = ['image', 'text', 'shape', 'svg', 'path', 'group'];
    if (types.indexOf(src.type) < 0) { errors.push('A layer has an unknown type and was left out.'); return null; }
    var l = {
      id: idOk(src.id, 48) ? src.id : uid('l'), type: src.type, name: str(src.name, 120, src.type),
      x: clamp(num(src.x, 0), -100000, 100000), y: clamp(num(src.y, 0), -100000, 100000),
      w: clamp(num(src.w, 100), 1, 100000), h: clamp(num(src.h, 100), 1, 100000),
      rotation: clamp(num(src.rotation, 0), -3600, 3600), opacity: clamp(num(src.opacity, 1), 0, 1),
      blend: oneOf(src.blend, BLENDS, 'source-over'), visible: src.visible !== false, locked: bool(src.locked),
      flipX: bool(src.flipX), flipY: bool(src.flipY), shadow: shadowSpec(src.shadow), groupId: idOk(src.groupId, 48) ? src.groupId : null
    };
    if (l.type === 'image') {
      l.src = idOk(src.src, 80) ? src.src : '';
      var c = src.crop || {};
      l.crop = { x: clamp(num(c.x, 0), 0, 1), y: clamp(num(c.y, 0), 0, 1), w: clamp(num(c.w, 1), 0.001, 1), h: clamp(num(c.h, 1), 0.001, 1) };
      l.radius = clamp(num(src.radius, 0), 0, 100000);
      l.border = src.border && typeof src.border === 'object' ? { width: clamp(num(src.border.width, 0), 0, 2000), color: safeColor(src.border.color) || '#17131F' } : null;
      l.mask = typeof src.mask === 'string' && /^[\w-]{1,40}$/.test(src.mask) ? src.mask : 'none';
      var maskPath = sanitizeMaskPath(src.maskPath);
      if (maskPath) l.maskPath = maskPath;
      var slot = slotSpec(src.slot);
      if (slot) l.slot = slot;
      l.adjust = {};
      var a = src.adjust && typeof src.adjust === 'object' ? src.adjust : {};
      ADJUST_KEYS.forEach(function (k) { if (a[k] != null && isFinite(Number(a[k]))) l.adjust[k] = clamp(Number(a[k]), -1000, 1000); });
      var recipeMark = recipeMarker(a.recipe);
      if (recipeMark) l.adjust.recipe = recipeMark;
      l.filter = src.filter && typeof src.filter.name === 'string' && /^[a-z-]{1,30}$/.test(src.filter.name) ? { name: src.filter.name, intensity: clamp(num(src.filter.intensity, 100), 0, 100) } : null;
      l.removeBg = src.removeBg && typeof src.removeBg === 'object' ? { color: safeColor(src.removeBg.color) || '#ffffff', tolerance: clamp(num(src.removeBg.tolerance, 28), 0, 255) } : null;
      var cut = src.cutout && typeof src.cutout === 'object' && !Array.isArray(src.cutout) ? src.cutout : null;
      if (cut && idOk(cut.asset, 80)) {
        var ol = cut.outline && typeof cut.outline === 'object' && num(cut.outline.width, 0) > 0 ? { color: safeColor(cut.outline.color) || '#ffffff', width: clamp(num(cut.outline.width, 0), 0, 200) } : null;
        l.cutout = { asset: cut.asset, enabled: cut.enabled !== false, model: typeof cut.model === 'string' && /^[\w.-]{1,40}$/.test(cut.model) ? cut.model : '', feather: clamp(num(cut.feather, 0), 0, 50), refine: cut.refine === 'none' ? 'none' : 'guided', version: 1, outline: ol };
      }
    } else if (l.type === 'text') {
      l.text = str(src.text, LIMITS.text, 'Text');
      l.font = typeof src.font === 'string' && /^[\w \-]{1,80}$/.test(src.font) ? src.font : 'Plus Jakarta Sans';
      l.weight = clamp(Math.round(num(src.weight, 700)), 100, 900);
      l.italic = bool(src.italic);
      l.size = clamp(num(src.size, 48), 1, 5000);
      l.color = safeColor(src.color) || '#17131F';
      l.fill = fillSpec(src.fill);
      l.align = oneOf(src.align, ['left', 'center', 'right'], 'left');
      l.lineHeight = clamp(num(src.lineHeight, 1.2), 0.5, 5);
      l.letterSpacing = clamp(num(src.letterSpacing, 0), -200, 2000);
      l.uppercase = bool(src.uppercase); l.underline = bool(src.underline); l.strike = bool(src.strike);
      l.stroke = src.stroke && typeof src.stroke === 'object' ? { width: clamp(num(src.stroke.width, 0), 0, 500), color: safeColor(src.stroke.color) || '#17131F' } : null;
      l.background = src.background && typeof src.background === 'object' ? { color: safeColor(src.background.color) || '#ffffff', radius: clamp(num(src.background.radius, 999), 0, 9999), padding: clamp(num(src.background.padding, 8), 0, 2000) } : null;
      l.curve = clamp(num(src.curve, 0), -360, 360);
    } else if (l.type === 'shape') {
      l.shape = typeof src.shape === 'string' && /^[\w-]{1,40}$/.test(src.shape) ? src.shape : 'rect';
      l.params = {};
      var p = src.params && typeof src.params === 'object' ? src.params : {};
      Object.keys(p).slice(0, 16).forEach(function (k) {
        if (BAD_KEYS[k] || !/^[a-zA-Z]{1,24}$/.test(k)) return;
        if (typeof p[k] === 'number' && isFinite(p[k])) l.params[k] = clamp(p[k], -100000, 100000);
        else if (Array.isArray(p[k])) l.params[k] = p[k].slice(0, 64).map(function (pt) { return [clamp(num(pt && pt[0], 0), -100000, 100000), clamp(num(pt && pt[1], 0), -100000, 100000)]; });
      });
      l.radius = clamp(num(src.radius, 0), 0, 100000);
      l.fill = fillSpec(src.fill) || { type: 'none' };
      l.stroke = src.stroke && typeof src.stroke === 'object' ? {
        width: clamp(num(src.stroke.width, 0), 0, 2000), color: safeColor(src.stroke.color) || '#17131F',
        dash: Array.isArray(src.stroke.dash) ? src.stroke.dash.slice(0, 8).map(function (d) { return clamp(num(d, 0), 0, 5000); }) : null,
        cap: oneOf(src.stroke.cap, ['butt', 'round', 'square'], 'butt'), join: oneOf(src.stroke.join, ['miter', 'round', 'bevel'], 'miter')
      } : null;
      var redact = LE.Scene && LE.Scene.redactOf ? LE.Scene.redactOf(src.redact) : null;
      if (redact) l.redact = redact;
    } else if (l.type === 'svg') {
      l.assetId = typeof src.assetId === 'string' && /^[\w-]{1,24}:(?:[\w-]{1,40}\/)?[\w-]{1,80}$/.test(src.assetId) ? src.assetId : '';
      l.svg = src.svg ? sanitizeSvg(src.svg) : '';
      l.color = safeColor(src.color);
      l.strokeWidth = src.strokeWidth == null ? null : clamp(num(src.strokeWidth, 2), 0, 48);
    } else if (l.type === 'path') {
      l.points = (Array.isArray(src.points) ? src.points.slice(0, LIMITS.points) : []).map(function (pt) {
        return [clamp(num(pt && pt[0], 0), -100000, 100000), clamp(num(pt && pt[1], 0), -100000, 100000), clamp(num(pt && pt[2], 0.5), 0, 1)];
      });
      l.smoothing = clamp(num(src.smoothing, 0.55), 0, 1);
      l.width = clamp(num(src.width, 4), 0.5, 2000);
      l.color = safeColor(src.color) || '#17131F';
      l.mode = oneOf(src.mode, ['pen', 'marker', 'highlighter'], 'pen');
    }
    return l;
  }
  /* Photo background framing and look (see le-objects.js "Photo backgrounds"); only fields that are present are kept. */
  function photoBg(bg, out) {
    if (bg.crop && typeof bg.crop === 'object') out.crop = region(bg.crop);
    if (bg.x != null) out.x = clamp(num(bg.x, 0), -10, 10);
    if (bg.y != null) out.y = clamp(num(bg.y, 0), -10, 10);
    if (bg.scale != null) out.scale = clamp(num(bg.scale, 1), 0.05, 50);
    if (bg.rotation != null) out.rotation = clamp(num(bg.rotation, 0), -3600, 3600);
    if (bg.flipX != null) out.flipX = bool(bg.flipX);
    if (bg.flipY != null) out.flipY = bool(bg.flipY);
    if (bg.opacity != null) out.opacity = clamp(num(bg.opacity, 1), 0, 1);
    if (bg.blur != null) out.blur = clamp(num(bg.blur, 0), 0, 250);
    if (bg.dim && typeof bg.dim === 'object') out.dim = { color: safeColor(bg.dim.color) || '#000000', amount: clamp(num(bg.dim.amount, 0), 0, 1) };
    if (bg.adjust && typeof bg.adjust === 'object') {
      out.adjust = {};
      ADJUST_KEYS.forEach(function (k) { if (bg.adjust[k] != null && isFinite(Number(bg.adjust[k]))) out.adjust[k] = clamp(Number(bg.adjust[k]), -1000, 1000); });
    }
    if (bg.filter && typeof bg.filter.name === 'string' && /^[a-z-]{1,30}$/.test(bg.filter.name)) out.filter = { name: bg.filter.name, intensity: clamp(num(bg.filter.intensity, 100), 0, 100) };
    if (bg.tile && typeof bg.tile === 'object') out.tile = { size: clamp(num(bg.tile.size, 0.25), 0.02, 4), gap: clamp(num(bg.tile.gap, 0), 0, 1) };
  }
  function sanitizeDoc(doc, errors) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { errors.push('A page could not be read.'); return null; }
    var bg = doc.background && typeof doc.background === 'object' ? doc.background : {};
    var out = {
      v: 1, width: clamp(Math.round(num(doc.width, 1080)), 1, 20000), height: clamp(Math.round(num(doc.height, 1080)), 1, 20000),
      background: { type: oneOf(bg.type, ['color', 'gradient', 'image'], 'color') },
      layers: []
    };
    if (safeColor(bg.color)) out.background.color = safeColor(bg.color);
    else if (out.background.type === 'color') out.background.color = '#ffffff';
    if (bg.kind) out.background.kind = oneOf(bg.kind, ['linear', 'radial'], 'linear');
    if (Array.isArray(bg.colors)) out.background.colors = bg.colors.slice(0, 8).map(safeColor).filter(Boolean);
    if (bg.angle != null) out.background.angle = clamp(num(bg.angle, 0), -360, 360);
    if (bg.src && idOk(bg.src, 80)) out.background.src = bg.src;
    if (bg.fit) out.background.fit = oneOf(bg.fit, ['cover', 'contain', 'fill', 'tile'], 'cover');
    if (out.background.type === 'image') photoBg(bg, out.background);
    var spec = bgSpec(bg.spec);
    if (spec) out.background.spec = spec;
    var layers = Array.isArray(doc.layers) ? doc.layers : [];
    if (layers.length > LIMITS.layers) errors.push('This page has too many layers; extra ones were left out.');
    layers.slice(0, LIMITS.layers).forEach(function (l) { var s = sanitizeLayer(l, errors); if (s) out.layers.push(s); });
    var collage = LE.Scene && LE.Scene.collageOf ? LE.Scene.collageOf(doc.collage) : null;
    if (collage) out.collage = collage;
    var carousel = LE.Scene && LE.Scene.carouselOf ? LE.Scene.carouselOf(doc.carousel) : null;
    if (carousel) out.carousel = carousel;
    var maker = LE.Scene && LE.Scene.makerOf ? LE.Scene.makerOf(doc.maker) : null;
    if (maker) out.maker = maker;
    var print = LE.Scene && LE.Scene.printOf ? LE.Scene.printOf(doc.print) : null;
    if (print) out.print = print;
    return out;
  }
  function sizeEntry(e, errors) {
    if (!e || typeof e !== 'object') return null;
    function wh(o) { o = o || {}; return { w: clamp(Math.round(num(o.w, 1)), 1, 20000), h: clamp(Math.round(num(o.h, 1)), 1, 20000) }; }
    return {
      id: idOk(e.id, 48) ? e.id : uid('s'), at: num(e.at, now()), type: oneOf(e.type, ['resize', 'revert', 'reset'], 'resize'),
      label: str(e.label, 80), from: wh(e.from), to: wh(e.to), fit: oneOf(e.fit, ['cover', 'contain', 'stretch'], 'cover'),
      source: oneOf(e.source, ['original', 'current'], 'original'), scaleContent: e.scaleContent !== false, reverted: bool(e.reverted),
      before: e.before ? sanitizeDoc(e.before, errors) : null
    };
  }
  function region(r) {
    r = r || {};
    return { x: clamp(num(r.x, 0), 0, 1), y: clamp(num(r.y, 0), 0, 1), w: clamp(num(r.w, 1), 0.001, 1), h: clamp(num(r.h, 1), 0.001, 1) };
  }
  function studioMeta(m, errors) {
    m = m && typeof m === 'object' ? m : {};
    var out = {
      baseId: idOk(m.baseId, 48) ? m.baseId : null, fit: oneOf(m.fit, ['cover', 'contain', 'stretch'], 'cover'),
      focal: { x: clamp(num(m.focal && m.focal.x, 0.5), 0, 1), y: clamp(num(m.focal && m.focal.y, 0.5), 0, 1) },
      scaleContent: m.scaleContent !== false, baseRegion: region(m.baseRegion), lastResult: str(m.lastResult, 80),
      anchor: m.anchor ? sanitizeDoc(m.anchor, errors) : null
    };
    if (m.originalSize) out.originalSize = { w: clamp(Math.round(num(m.originalSize.w, 1080)), 1, 20000), h: clamp(Math.round(num(m.originalSize.h, 1080)), 1, 20000) };
    if (Array.isArray(m.docColors)) out.docColors = m.docColors.slice(0, 24).map(safeColor).filter(Boolean);
    var icons = sideMap(m.icons, function (v) {
      var o = { style: str(v.style, 40), name: str(v.name, 80), palette: str(v.palette, 60), color: safeColor(v.color) || null };
      if (Array.isArray(v.colors)) o.colors = v.colors.slice(0, 12).map(safeColor).filter(Boolean);
      return o;
    });
    if (icons) out.icons = icons;
    var qr = sideMap(m.qr, function (v) {
      return { text: str(v.text, 1200), fg: safeColor(v.fg) || '#17131f', bg: safeColor(v.bg) || null, ec: oneOf(v.ec, ['L', 'M', 'Q', 'H'], 'M') };
    });
    if (qr) out.qr = qr;
    var fx = sideMap(m.fx, function (v) {
      if (!idOk(v.src, 80)) return null;
      var o = { src: v.src, kind: oneOf(v.kind, ['duotone', 'outline', 'blurbg'], 'duotone') };
      ['a', 'b', 'color'].forEach(function (k) { if (safeColor(v[k])) o[k] = safeColor(v[k]); });
      ['width', 'amount', 'mix', 'focus', 'pad', 'outW'].forEach(function (k) { if (v[k] != null) o[k] = clamp(num(v[k], 0), 0, 40000); });
      return o;
    });
    if (fx) out.fx = fx;
    /* Open design format (le-design.js): template variables, remix credit and page ids, all plain text. */
    if (Array.isArray(m.variables)) {
      out.variables = m.variables.slice(0, 50).map(function (v) {
        if (!v || typeof v !== 'object' || typeof v.key !== 'string' || !/^[A-Za-z_][\w.-]{0,39}$/.test(v.key)) return null;
        var o = { key: v.key, label: str(v.label, 80).replace(/[<>]/g, ''), type: oneOf(v.type, ['text', 'image'], 'text') };
        if (typeof v.default === 'string') o.default = v.default.slice(0, 2000);
        return o;
      }).filter(Boolean);
    }
    if (m.remix && typeof m.remix === 'object') {
      var rn = str(m.remix.name, 160).replace(/[<>]/g, '').trim(), rb = str(m.remix.by, 80).replace(/[<>]/g, '').trim();
      if (rn || rb) out.remix = { name: rn, by: rb };
    }
    if (Array.isArray(m.pageIds)) out.pageIds = m.pageIds.slice(0, LIMITS.pages).map(function (p) { return idOk(p, 48) ? p : ''; });
    if (m.guides && typeof m.guides === 'object') {
      var gd = {};
      ['x', 'y'].forEach(function (a) { gd[a] = (Array.isArray(m.guides[a]) ? m.guides[a] : []).slice(0, 40).map(function (n) { return clamp(num(n, 0), -20000, 40000); }); });
      out.guides = gd;
    }
    return out;
  }
  function sideMap(src, fn) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    var out = {};
    Object.keys(src).slice(0, LIMITS.layers).forEach(function (k) {
      if (BAD_KEYS[k] || !idOk(k, 48) || !src[k] || typeof src[k] !== 'object') return;
      var v = fn(src[k]);
      if (v) out[k] = v;
    });
    return out;
  }
  function bgSpec(s) {
    if (!s || typeof s !== 'object') return null;
    var o = { kind: oneOf(s.kind, ['gradient', 'pattern', 'texture'], 'gradient'), id: str(s.id, 60) };
    if (o.kind === 'gradient') {
      o.type = oneOf(s.type, ['linear', 'radial', 'conic', 'mesh'], 'linear');
      o.angle = clamp(num(s.angle, 0), -360, 360);
      o.stops = (Array.isArray(s.stops) ? s.stops : []).slice(0, 12).map(function (st) {
        var c = st && safeColor(st.color);
        return c ? { color: c, at: clamp(num(st.at, 0), 0, 1) } : null;
      }).filter(Boolean);
      if (Array.isArray(s.points)) o.points = s.points.slice(0, 8).map(function (p) { return { x: clamp(num(p && p.x, 0.5), 0, 1), y: clamp(num(p && p.y, 0.5), 0, 1), color: safeColor(p && p.color) || '#ffffff', r: clamp(num(p && p.r, 0.6), 0.05, 2) }; });
    } else {
      o.fg = safeColor(s.fg) || '#17131f';
      o.bg = safeColor(s.bg) || '#ffffff';
      o.scale = clamp(num(s.scale, 1), 0.1, 8);
    }
    return o;
  }
  function validate(raw) {
    var errors = [];
    if (typeof raw === 'string') {
      if (raw.length > LIMITS.json) return { ok: false, errors: ['This project file is too large.'] };
      try {
        raw = JSON.parse(raw, function (k, v) {
          if (BAD_KEYS[k]) throw new Error('bad key');
          return v;
        });
      } catch (e) { return { ok: false, errors: [e.message === 'bad key' ? 'This project file contains forbidden keys.' : 'This project file is not valid JSON.'] }; }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['This is not a LocalEditor project.'] };
    if (raw.schema !== SCHEMA) return { ok: false, errors: ['This is not a LocalEditor project.'] };
    if (!(Number(raw.v) >= 1 && Number(raw.v) <= VERSION)) return { ok: false, errors: ['This project needs a newer LocalEditor.'] };
    var pages = Array.isArray(raw.pages) ? raw.pages : [];
    if (!pages.length) return { ok: false, errors: ['This project has no pages.'] };
    if (pages.length > LIMITS.pages) errors.push('Only the first ' + LIMITS.pages + ' pages were kept.');
    var assetsIn = raw.assets && typeof raw.assets === 'object' && !Array.isArray(raw.assets) ? raw.assets : {};
    var assetsOut = {};
    var assetKeys = Object.keys(assetsIn);
    if (assetKeys.length > LIMITS.assets) return { ok: false, errors: ['This project has too many images.'] };
    assetKeys.forEach(function (k) {
      var a = assetsIn[k];
      if (!/^[a-f0-9]{64}$/.test(k) || !a || typeof a !== 'object') { errors.push('An image reference was not valid and was left out.'); return; }
      var type = typeof a.type === 'string' ? a.type.toLowerCase() : '';
      if (!IMAGE_TYPES[type]) { errors.push('An image of an unsupported type was left out.'); return; }
      assetsOut[k] = {
        id: k, type: type, name: str(a.name, LIMITS.name, 'image'), width: clamp(Math.round(num(a.width, 1)), 1, 40000),
        height: clamp(Math.round(num(a.height, 1)), 1, 40000), bytes: clamp(Math.round(num(a.bytes, 0)), 0, LIMITS.assetBytes), original: a.original !== false
      };
      var source = cleanSource(a.source);
      if (source) assetsOut[k].source = source;
    });
    var out = {
      schema: SCHEMA, v: VERSION, id: idOk(raw.id, 64) ? raw.id : uid('d'), name: str(raw.name, LIMITS.name, 'Imported design') || 'Imported design',
      kind: oneOf(raw.kind, ['design', 'pdf'], 'design'), createdAt: num(raw.createdAt, now()), updatedAt: num(raw.updatedAt, now()),
      pages: [], activePage: 0, assets: assetsOut, sizeHistory: [],
      meta: { app: str(raw.meta && raw.meta.app, 24, APP), tier: oneOf(raw.meta && raw.meta.tier, ['older', 'modern', 'desktop'], tier()), studio: studioMeta(raw.meta && raw.meta.studio, errors) }
    };
    pages.slice(0, LIMITS.pages).forEach(function (p) { var d = sanitizeDoc(p, errors); if (d) out.pages.push(d); });
    if (!out.pages.length) return { ok: false, errors: ['No page in this project could be read.'] };
    out.activePage = clamp(Math.round(num(raw.activePage, 0)), 0, out.pages.length - 1);
    (Array.isArray(raw.sizeHistory) ? raw.sizeHistory.slice(-LIMITS.history) : []).forEach(function (e) { var s = sizeEntry(e, errors); if (s) out.sizeHistory.push(s); });
    out.pages.forEach(function (p) {
      p.layers.forEach(function (l) { if (l.type === 'image' && l.src && !assetsOut[l.src]) errors.push('A photo in this project is missing.'); if (l.cutout && !assetsOut[l.cutout.asset]) { delete l.cutout; errors.push('A background-removal mask was missing, so that photo shows its full background.'); } });
    });
    return { ok: true, errors: errors, project: out };
  }

  /* ---------- .leproject files ---------- */
  function u8(str) { return new TextEncoder().encode(str); }
  function exportFile(project, opts) {
    opts = opts || {};
    var check = validate(JSON.parse(JSON.stringify(project)));
    if (!check.ok) return Promise.reject(new Error(check.errors[0]));
    var clean = check.project;
    var ids = Object.keys(clean.assets);
    return Promise.all(ids.map(function (id) {
      var inline = opts.blobs && opts.blobs[id];
      return (inline ? Promise.resolve(inline) : getAsset(id)).then(function (blob) {
        if (!blob) throw new Error('A photo in this design is missing from this device.');
        return blob.arrayBuffer().then(function (buf) {
          return { name: 'assets/' + id + '.' + (IMAGE_TYPES[clean.assets[id].type] || 'bin'), data: new Uint8Array(buf) };
        });
      });
    })).then(function (files) {
      files.unshift({ name: 'project.json', data: u8(JSON.stringify(clean, null, 1)) });
      files.unshift({ name: 'mimetype', data: u8('application/vnd.localeditor.project+zip') });
      var thumb = opts.thumb ? opts.thumb.arrayBuffer().then(function (b) { files.push({ name: 'thumbnail.png', data: new Uint8Array(b) }); }) : Promise.resolve();
      return thumb.then(function () {
        if (!LE.zip) throw new Error('Packing is not available.');
        log('exported', project.id, { bytes: files.reduce(function (s, f) { return s + f.data.length; }, 0) });
        return new Blob([LE.zip(files)], { type: 'application/zip' });
      });
    });
  }

  function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('compressed'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(buf) {
    var bytes = new Uint8Array(buf);
    var dv = new DataView(buf);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('This is not a .leproject file.'));
    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    if (count > LIMITS.entries) return Promise.reject(new Error('This project file has too many parts.'));
    var dec = new TextDecoder();
    var jobs = [];
    var out = {};
    var total = 0;
    for (var n = 0; n < count; n++) {
      if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) return Promise.reject(new Error('This project file is damaged.'));
      var method = dv.getUint16(off + 10, true);
      var csize = dv.getUint32(off + 20, true);
      var size = dv.getUint32(off + 24, true);
      var nlen = dv.getUint16(off + 28, true);
      var elen = dv.getUint16(off + 30, true);
      var clen = dv.getUint16(off + 32, true);
      var local = dv.getUint32(off + 42, true);
      var name = dec.decode(bytes.subarray(off + 46, off + 46 + nlen));
      off += 46 + nlen + elen + clen;
      if (/(^|\/)\.\.(\/|$)|^\/|\\/.test(name) || name.length > 200) return Promise.reject(new Error('This project file has an unsafe path.'));
      if (/\/$/.test(name)) continue;
      total += size;
      if (size > LIMITS.assetBytes || total > LIMITS.totalBytes) return Promise.reject(new Error('This project file is too large.'));
      if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) return Promise.reject(new Error('This project file is damaged.'));
      var start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      var chunk = bytes.subarray(start, start + csize);
      (function (nm, m, ch, sz) {
        if (m === 0) out[nm] = ch;
        else if (m === 8) jobs.push(inflateRaw(ch).then(function (d) { if (d.length !== sz) throw new Error('size'); out[nm] = d; }));
        else jobs.push(Promise.reject(new Error('unsupported')));
      })(name, method, chunk, size);
    }
    return Promise.all(jobs).then(function () { return out; });
  }
  function unzipAny(buf) {
    return unzip(buf).catch(function (err) {
      if (err && /not a|unsafe|too large|too many/.test(err.message)) throw err;
      return LE.lazy(base() + 'assets/vendor/jszip.min.js').then(function () {
        return window.JSZip.loadAsync(buf);
      }).then(function (zip) {
        var out = {};
        var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
        if (names.length > LIMITS.entries) throw new Error('This project file has too many parts.');
        return Promise.all(names.map(function (n) {
          if (/(^|\/)\.\.(\/|$)|^\//.test(n)) throw new Error('This project file has an unsafe path.');
          return zip.files[n].async('uint8array').then(function (d) { out[n] = d; });
        })).then(function () { return out; });
      });
    });
  }
  function base() {
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root;
  }
  function decodes(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).then(function (bmp) { var ok = { width: bmp.width, height: bmp.height }; if (bmp.close) bmp.close(); return ok; });
    }
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  function readFile(file) {
    if (!file) return Promise.reject(new Error('Choose a .leproject file.'));
    if (file.size > LIMITS.totalBytes) return Promise.reject(new Error('This project file is too large.'));
    return toBuffer(file).then(unzipAny).then(function (files) {
      var json = files['project.json'];
      if (!json) throw new Error('This file has no project inside.');
      if (json.length > LIMITS.json) throw new Error('This project file is too large.');
      var check = validate(new TextDecoder().decode(json));
      if (!check.ok) throw new Error(check.errors[0]);
      var project = check.project;
      var byId = {};
      Object.keys(files).forEach(function (n) {
        var m = /^assets\/([a-f0-9]{64})\.[a-z0-9]{2,5}$/.exec(n);
        if (m) byId[m[1]] = files[n];
      });
      var blobs = {};
      return Promise.all(Object.keys(project.assets).map(function (id) {
        var data = byId[id];
        if (!data) throw new Error('A photo is missing from this project file.');
        var a = project.assets[id];
        var blob = new Blob([data], { type: a.type });
        return hash(blob).then(function (h) {
          if (h !== id) throw new Error('A photo in this project file does not match its fingerprint.');
          return decodes(blob);
        }).then(function (dim) {
          a.width = dim.width; a.height = dim.height; a.bytes = blob.size;
          blobs[id] = blob;
        }, function (err) {
          if (err && /fingerprint/.test(err.message)) throw err;
          throw new Error('A photo in this project file could not be read as an image.');
        });
      })).then(function () {
        return { project: project, blobs: blobs, warnings: check.errors, thumb: files['thumbnail.png'] ? new Blob([files['thumbnail.png']], { type: 'image/png' }) : null };
      });
    });
  }
  function importFile(file, opts) {
    opts = opts || {};
    return readFile(file).then(function (res) {
      var project = res.project;
      return Promise.all(Object.keys(res.blobs).map(function (id) {
        var a = project.assets[id];
        return putAsset({ blob: res.blobs[id], name: a.name, type: a.type, width: a.width, height: a.height, source: a.source });
      })).then(function () { return get('projects', project.id); }).then(function (exists) {
        if (exists && !opts.replace) {
          project.id = uid('d');
          project.name = project.name + ' (imported)';
        }
        return save(project, { thumb: res.thumb });
      }).then(function () {
        log('imported', project.id, { warnings: res.warnings.length });
        project.warnings = res.warnings;
        return project;
      });
    });
  }

  LE.project = {
    SCHEMA: SCHEMA, VERSION: VERSION, LIMITS: LIMITS,
    create: create, blankPage: blankPage, hash: hash, fingerprint: fingerprint, assetIds: assetIds,
    list: list, open: open, save: save, rename: rename, duplicate: duplicate, remove: remove,
    snapshot: snapshot, versions: versions, restore: restore, ledger: ledger, log: log, usage: usage, gc: gc, brandKit: brandKit, saveBrandKit: saveBrandKit,
    putAsset: putAsset, getAsset: getAsset, assetRecord: assetRecord, assets: assets,
    validate: validate, sanitizeSvg: sanitizeSvg, exportFile: exportFile, readFile: readFile, importFile: importFile
  };
})();
