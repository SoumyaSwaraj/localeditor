/* Runs inside the headless studio page (evaluated by tools/le-cli/lib/engine.js). Defines window.__lecli: one adapter
   in front of the real engine, so the command line, the MCP server and the local API all go through the same calls.

   - "agent" mode: window.LEAgent (agent mode, docs/ROADMAP.md G1) exists with the documented contract
     (begin/end, state, apply, find, catalog, check, export, load, save). Operations go straight to it.
   - "fallback" mode: until LEAgent lands, the same operation vocabulary is applied by LE.link.applyOps on the
     open-format document, then normalised, validated and linted by LE.design.parse, and drawn with LE.Scene.

   Every function returns plain JSON. Image bytes cross the boundary as base64. */
(function () {
  'use strict';
  if (window.__lecli) return;
  var LE = window.LE;
  var LINT = ['overflow', 'clipped', 'off-page', 'missing-image', 'unknown-font', 'low-contrast', 'unknown-icon', 'unknown-shape', 'shrink-needs-height', 'remote-image'];
  var HEX = /^[0-9a-f]{64}$/;

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function b64ToBlob(b64, type) {
    var bin = atob(b64); var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type || '' });
  }
  function blobToB64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), s = '';
      for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    });
  }
  function typeOf(path) {
    var m = /\.([a-z0-9]+)$/i.exec(path || '');
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' }[(m ? m[1] : '').toLowerCase()] || '';
  }

  /* ---------------------------------------------------------------- agent mode detection */
  function agent() {
    if (window.LE_CLI_ADAPTER === 'fallback') return null;
    var A = window.LEAgent;
    if (!A || typeof A.apply !== 'function' || typeof A.load !== 'function' || typeof A.save !== 'function') return null;
    return A;
  }
  var session = null;
  function agentSession(A) {
    if (session || typeof A.begin !== 'function') return Promise.resolve(session);
    return Promise.resolve(A.begin({ name: 'localeditor CLI', headless: true })).then(function (s) { session = s || true; return session; });
  }
  function agentError(e) {
    return { ok: false, code: (e && e.code) || 'invalid', errors: (e && e.errors) || [{ path: (e && e.path) || '', message: String((e && e.message) || e) }] };
  }

  /* ---------------------------------------------------------------- state */
  var cur = null; /* { project, doc, notes, blobs, srcOf, warnings, remote, canvases } */

  /* Walks the raw document and returns every image reference: layer src, background src, fx src. */
  function srcRefs(raw) {
    var out = [];
    (raw.pages || []).forEach(function (p, pi) {
      if (!isObj(p)) return;
      if (isObj(p.background) && typeof p.background.src === 'string') out.push({ path: '/pages/' + pi + '/background/src', src: p.background.src });
      (p.layers || []).forEach(function (l, li) {
        if (!isObj(l)) return;
        if (typeof l.src === 'string') out.push({ path: '/pages/' + pi + '/layers/' + li + '/src', src: l.src, layer: l.id });
        if (isObj(l.fx) && typeof l.fx.src === 'string') out.push({ path: '/pages/' + pi + '/layers/' + li + '/fx/src', src: l.fx.src, layer: l.id });
      });
    });
    return out;
  }
  function dataUriBlob(u) {
    var m = /^data:([\w.+\/-]+)?(;base64)?,(.*)$/i.exec(u);
    if (!m) return null;
    try { return m[2] ? b64ToBlob(m[3], m[1]) : new Blob([decodeURIComponent(m[3])], { type: m[1] || '' }); } catch (e) { return null; }
  }
  /* Learns which asset id each original reference becomes (SHA-256 of the bytes, as LE.project.hash does). */
  function learnSources(raw, files, srcOf) {
    var refs = srcRefs(raw);
    return Promise.all(refs.map(function (r) {
      var blob = null;
      if (/^data:/i.test(r.src)) blob = dataUriBlob(r.src);
      else if (files && files[r.src]) blob = b64ToBlob(files[r.src], typeOf(r.src));
      else if (HEX.test(r.src)) { return null; }
      if (!blob) return null;
      return LE.project.hash(blob).then(function (id) { if (!srcOf[id]) srcOf[id] = r.src; });
    }));
  }
  /* The normalised long form with each image written the way the source file wrote it (relative path, data URI). */
  function fakeId(s) {
    var out = '';
    for (var seed = 0; seed < 8; seed++) {
      var h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      out += ('0000000' + h.toString(16)).slice(-8);
    }
    return out;
  }
  /* Remote images that were not downloaded stay in the file as their URL (the reader leaves an empty frame). */
  function withRemote(project, srcOf, remote) {
    var pending = (remote || []).filter(function (r) { return !r.done; });
    if (!pending.length) return project;
    var p = clone(project);
    pending.forEach(function (r) {
      var id = fakeId(r.url);
      srcOf[id] = r.url;
      (r.refs || []).forEach(function (ref) {
        var page = p.pages[ref.page];
        if (!page) return;
        if (ref.background) { page.background = Object.assign({}, page.background, { type: 'image', src: id }); return; }
        page.layers.forEach(function (l) { if (l.id === ref.layer && l.type === 'image' && !l.src) l.src = id; });
      });
    });
    return p;
  }
  function textOf(project, srcOf, notes, remote) {
    var text = LE.design.stringify(withRemote(project, srcOf, remote), { images: 'ids' }).text;
    text = text.replace(/"([0-9a-f]{64})"/g, function (all, id) { return srcOf[id] ? JSON.stringify(srcOf[id]) : all; });
    if (notes && notes.length) {
      var body = '[\n' + notes.map(function (n) { return '    ' + JSON.stringify(n); }).join(',\n') + '\n  ]';
      text = text.replace(/\n\}\s*$/, ',\n  "notes": ' + body + '\n}\n');
    }
    return text;
  }
  function problemsOf(warnings, remote) {
    var list = (warnings || []).filter(function (w) { return LINT.indexOf(w.kind) >= 0; }).map(function (w) { return { path: w.path, layer: w.layer || null, kind: w.kind, message: w.message }; });
    (remote || []).forEach(function (r) {
      (r.refs || [{}]).forEach(function (ref) { list.push({ path: ref.path || '', layer: ref.layer || null, kind: 'remote-image', message: 'The image at ' + r.url + ' is on another site (' + r.host + ') and was not downloaded. Save it next to the design and use a relative path, or allow the host.' }); });
    });
    return list;
  }
  function key(p) { return p.kind + '|' + (p.layer || p.path); }

  /* parse with the given files; → { ok, res, notes, srcOf } */
  function parseDoc(raw, files, assets, srcOf) {
    var notes = null;
    if (isObj(raw) && raw.notes != null) {
      var cn = LE.link.cleanNotes(raw.notes);
      if (!cn.ok) return Promise.resolve({ ok: false, errors: [cn.error], warnings: [] });
      notes = cn.notes;
      raw = Object.assign({}, raw); delete raw.notes;
    }
    var resolve = function (p) { return files && files[p] ? b64ToBlob(files[p], typeOf(p)) : null; };
    srcOf = srcOf || {};
    /* LE.design measures text without "font" / "weight" in the browser's default font at 400, while it draws and lints
       it in Plus Jakarta Sans 700 (the format's defaults): fill the defaults in first so the measured height is right.
       The long form leaves defaults out again, so the file does not change. */
    raw = clone(raw);
    if (isObj(raw) && Array.isArray(raw.pages)) raw.pages.forEach(function (p) {
      if (isObj(p) && Array.isArray(p.layers)) p.layers.forEach(function (l) {
        if (!isObj(l) || l.type !== 'text') return;
        if (l.font == null) l.font = 'Plus Jakarta Sans';
        if (l.weight == null) l.weight = 700;
      });
    });
    return learnSources(raw, files, srcOf).then(function () {
      return LE.design.parse(JSON.stringify(raw), { resolve: resolve, assets: assets || undefined });
    }).then(function (res) { return { ok: res.ok, res: res, notes: notes, srcOf: srcOf, errors: res.errors, warnings: res.warnings }; });
  }

  function summary(c, extra) {
    var out = {
      ok: true, mode: agent() ? 'agent' : 'fallback', text: c.text, warnings: c.warnings, remote: c.remote || [],
      problems: problemsOf(c.warnings, c.remote), srcOf: c.srcOf, pages: c.project.pages.length
    };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  function load(input) {
    var raw;
    try { raw = typeof input.text === 'string' ? JSON.parse(input.text) : input.doc; } catch (e) { return Promise.resolve({ ok: false, code: 'invalid', errors: [{ path: '', message: 'This is not valid JSON: ' + String(e.message).slice(0, 160) }], warnings: [] }); }
    return parseDoc(raw, input.files, null, {}).then(function (r) {
      if (!r.ok) return r;
      var hosts = (input.allowHosts || []).filter(function (h) { return (r.res.remote || []).some(function (x) { return x.host === h; }); });
      if (!hosts.length) return r;
      /* Only hosts the caller allowed with --allow-host; the engine's network seal lets exactly these through. */
      return LE.design.fetchRemote(r.res, hosts).then(function (res2) {
        (res2.remote || r.res.remote).forEach(function (x) {
          if (!x.done) return;
          (x.refs || []).forEach(function (ref) {
            var page = res2.project.pages[ref.page];
            if (!page) return;
            if (ref.background && page.background && page.background.src) r.srcOf[page.background.src] = x.url;
            page.layers.forEach(function (l) { if (l.id === ref.layer && l.src) r.srcOf[l.src] = x.url; });
          });
        });
        r.res = res2;
        return r;
      });
    }).then(function (r) {
      if (!r.ok) return { ok: false, code: 'invalid', errors: r.errors, warnings: r.warnings || [] };
      var res = r.res;
      cur = { project: res.project, notes: r.notes, blobs: Object.assign({}, res.assets), srcOf: r.srcOf, warnings: res.warnings, remote: res.remote, canvases: {}, regen: res.regenerate || [] };
      cur.text = textOf(cur.project, cur.srcOf, cur.notes, cur.remote);
      cur.doc = JSON.parse(cur.text);
      var A = agent();
      if (!A) return summary(cur);
      /* Agent mode: hand the same text to LEAgent.load, so its state matches ours. */
      return agentSession(A).then(function () {
        return A.load(cur.text, { resolve: function (p) { return input.files && input.files[p] ? b64ToBlob(input.files[p], typeOf(p)) : null; }, headless: true });
      }).then(function () { return summary(cur); }, function (e) { return agentError(e); });
    });
  }

  /* "make" needs the browser (LE.makers), so it is expanded here into a page replace / page add. */
  function expandMakes(ops) {
    if (isObj(ops) && Array.isArray(ops.ops)) ops = ops.ops;
    if (isObj(ops)) ops = [ops];
    if (!Array.isArray(ops) || !ops.some(function (o) { return isObj(o) && (o.op === 'make' || o.op === 'maker'); })) return Promise.resolve(ops);
    return Promise.all(ops.map(function (o) {
      if (!isObj(o) || (o.op !== 'make' && o.op !== 'maker')) return o;
      return make({ id: o.maker || o.id, values: o.values, style: o.style, size: o.size }).then(function (r) {
        if (!r.ok) { var e = new Error((r.errors[0] || {}).message || 'The maker failed.'); e.code = 'invalid'; throw e; }
        var pg = JSON.parse(r.text).pages[0];
        return o.newPage ? { op: 'page.add', page: pg } : { op: 'replace', page: o.page == null ? 0 : o.page, design: { pages: [pg] } };
      });
    }));
  }
  function apply(input) {
    if (!cur) return Promise.resolve({ ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] });
    return expandMakes(input.ops).then(function (ops) { return applyExpanded(Object.assign({}, input, { ops: ops, original: input.ops })); });
  }
  function applyExpanded(input) {
    var A = agent();
    var r = LE.link.applyOps(cur.doc, input.ops, { partial: !!input.partial });
    if (!r.ok && !input.partial) return Promise.resolve({ ok: false, code: (r.errors[0] && r.errors[0].code) || 'invalid', errors: r.errors, results: r.results });
    var before = problemsOf(cur.warnings, cur.remote);
    var srcOf = Object.assign({}, cur.srcOf);
    return parseDoc(r.doc, input.files, cur.project.assets, srcOf).then(function (p) {
      if (!p.ok) return { ok: false, code: 'invalid', errors: p.errors, warnings: p.warnings || [], results: r.results };
      var res = p.res;
      var next = { project: res.project, notes: p.notes, blobs: Object.assign({}, cur.blobs, res.assets), srcOf: p.srcOf, warnings: res.warnings, remote: res.remote, canvases: cur.canvases, regen: res.regenerate || [] };
      next.text = textOf(next.project, next.srcOf, next.notes, next.remote);
      next.doc = JSON.parse(next.text);
      var probs = problemsOf(next.warnings, next.remote);
      var had = {}; before.forEach(function (x) { had[key(x)] = 1; });
      var extra = { results: r.results, applied: r.applied, errors: r.errors, partial: !!input.partial && r.errors.length > 0, newProblems: probs.filter(function (x) { return !had[key(x)]; }), dryRun: !!input.dryRun };
      if (input.dryRun) return summary(next, extra);
      var commit = function () { cur = next; return summary(cur, extra); };
      if (!A) return commit();
      return agentSession(A).then(function () { return A.apply(input.original || input.ops, { label: input.label || 'localeditor CLI', partial: !!input.partial, ifRev: input.ifRev }); })
        .then(function () { return commit(); }, function (e) { return agentError(e); });
    });
  }

  /* ---------------------------------------------------------------- render */
  function canvasFor(id) {
    if (cur.canvases[id]) return Promise.resolve(cur.canvases[id]);
    var studioMem = window.LEStudio && window.LEStudio.mem && window.LEStudio.mem[id];
    if (studioMem && studioMem.canvas) return Promise.resolve(studioMem.canvas);
    var blob = cur.blobs[id];
    if (!blob) return Promise.resolve(null);
    return createImageBitmap(blob).then(function (bmp) {
      var c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      cur.canvases[id] = c;
      return c;
    }, function () { return null; });
  }
  /* Pattern and texture backgrounds are drawn by the studio's background module at the page size. */
  function pageForRender(i) {
    var pg = clone(cur.project.pages[i]);
    var bg = pg.background;
    var C = window.LEStudioColor;
    if (bg && bg.spec && cur.regen.indexOf(i) >= 0 && C && typeof C.specToBg === 'function' && window.LEStudio) {
      var k = JSON.stringify([bg.spec, pg.width, pg.height]);
      cur.bgCache = cur.bgCache || {};
      var p = cur.bgCache[k] || (cur.bgCache[k] = C.specToBg(window.LEStudio, bg.spec, { width: pg.width, height: pg.height }).catch(function () { return null; }));
      return p.then(function (nb) { if (nb) pg.background = nb; return pg; });
    }
    return Promise.resolve(pg);
  }
  function renderCanvas(i, scale, transparent) {
    return pageForRender(i).then(function (pg) {
      var ids = LE.project.assetIds({ pages: [pg], assets: cur.project.assets, meta: cur.project.meta });
      if (pg.background && pg.background.src && ids.indexOf(pg.background.src) < 0) ids.push(pg.background.src);
      return Promise.all(ids.map(function (id) { return canvasFor(id).then(function (c) { return [id, c]; }); })).then(function (pairs) {
        var host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none;';
        document.body.appendChild(host);
        var sc = new LE.Scene({ el: host, width: pg.width, height: pg.height });
        pairs.forEach(function (p) { if (p[1]) sc.addAsset(p[0], p[1]); });
        sc.load(pg);
        var done = function () { try { sc.destroy(); } catch (e) {} host.remove(); };
        return sc.render(scale, { includeBackground: !transparent }).then(function (c) { done(); return c; }, function (e) { done(); throw e; });
      });
    });
  }
  function pageList(sel) {
    var n = cur.project.pages.length;
    if (sel == null || sel === 'all') return sel === 'all' ? Array.from({ length: n }, function (_, i) { return i; }) : [0];
    var ids = (cur.project.meta && cur.project.meta.studio && cur.project.meta.studio.pageIds) || [];
    var i = typeof sel === 'number' ? sel : (ids.indexOf(sel) >= 0 ? ids.indexOf(sel) : (/^\d+$/.test(String(sel)) ? Number(sel) : -1));
    if (!(i >= 0 && i < n)) return null;
    return [i];
  }
  function render(input) {
    if (!cur) return Promise.resolve({ ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] });
    var list = pageList(input.page);
    if (!list) return Promise.resolve({ ok: false, code: 'invalid', errors: [{ path: '/page', message: 'There is no page ' + input.page + ' (pages are counted from 0, or use a page id).' }] });
    var fmt = input.format || 'png';
    var mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' }[fmt];
    if (!mime) return Promise.resolve({ ok: false, code: 'unsupported', errors: [{ path: '/format', message: 'Formats: png, jpg, webp, pdf.' }] });
    var out = [];
    var chain = Promise.resolve();
    var canvases = [];
    list.forEach(function (i) {
      chain = chain.then(function () {
        var pg = cur.project.pages[i];
        var scale = input.scale || 1;
        if (input.maxEdge) scale = Math.min(scale, input.maxEdge / Math.max(pg.width, pg.height));
        if (pg.width * scale * pg.height * scale > 16384 * 16384 / 4) return Promise.reject(Object.assign(new Error('That render would be larger than the browser can draw; use a smaller --scale.'), { code: 'too-large' }));
        return renderCanvas(i, scale, !!input.transparent && fmt !== 'jpg' && fmt !== 'jpeg' && fmt !== 'pdf').then(function (c) {
          if (fmt === 'pdf') { canvases.push(c); return null; }
          return new Promise(function (res) { c.toBlob(res, mime, input.quality || (mime === 'image/png' ? undefined : 0.92)); }).then(function (blob) {
            return blobToB64(blob).then(function (b64) { out.push({ index: i, width: c.width, height: c.height, mime: mime, bytes: blob.size, data: b64 }); });
          });
        });
      });
    });
    return chain.then(function () {
      if (fmt !== 'pdf') return { ok: true, pages: out };
      var root = document.documentElement.getAttribute('data-root') || '../';
      if (root.charAt(root.length - 1) !== '/') root += '/';
      var ready = LE.pdf && LE.pdf.fromImages ? Promise.resolve() : LE.lazy(root + 'assets/js/le-pdf.js');
      return ready.then(function () { return LE.pdf.fromImages(canvases, { pageSize: 'fit', margin: 0, metadata: { title: cur.project.name } }); }).then(function (bytes) {
        var blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
        return blobToB64(blob).then(function (b64) { return { ok: true, pages: [{ index: list[0], pages: list.length, mime: 'application/pdf', bytes: blob.size, data: b64 }] }; });
      });
    }).catch(function (e) { return { ok: false, code: e.code || 'invalid', errors: [{ path: '', message: String(e.message || e) }] }; });
  }

  /* ---------------------------------------------------------------- read helpers */
  function state(input) {
    if (!cur) return { ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] };
    var out = { ok: true, mode: agent() ? 'agent' : 'fallback', outline: LE.link.outline(cur.doc), problems: problemsOf(cur.warnings, cur.remote) };
    if (input && input.full) out.text = cur.text;
    return out;
  }
  function find(input) {
    if (!cur) return { ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] };
    var q = String(input.query || '').toLowerCase();
    var hits = [];
    (cur.doc.pages || []).forEach(function (p, pi) {
      (p.layers || []).forEach(function (l, li) {
        var hay = [l.id, l.name, l.type, l.text, l.font, l.shape, l.assetId, l.icon, typeof l.src === 'string' && !/^data:/.test(l.src) ? l.src : ''].filter(Boolean).join(' ').toLowerCase();
        if (!q || hay.indexOf(q) >= 0) hits.push({ page: pi, index: li, path: '/pages/' + pi + '/layers/' + li, id: l.id, type: l.type, name: l.name || l.id, text: l.type === 'text' ? String(l.text).slice(0, 120) : undefined, box: { x: l.x, y: l.y, w: l.w, h: l.h } });
      });
    });
    return { ok: true, matches: hits };
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function match(q, parts) { if (!q) return true; var h = parts.filter(Boolean).join(' ').toLowerCase(); return String(q).toLowerCase().split(/\s+/).every(function (t) { return h.indexOf(t) >= 0; }); }
  function catalog(input) {
    var kind = input.kind, q = input.query || '';
    var lim = input.limit || 60;
    if (kind === 'fonts') return Promise.resolve({ ok: true, items: LE.fonts.list().filter(function (f) { return match(q, [f.family, f.category]); }).map(function (f) { return { family: f.family, category: f.category, weights: f.weights, italic: !!f.italic }; }) });
    if (kind === 'shapes') return Promise.resolve({ ok: true, items: LE.assets.shapes().filter(function (s) { return match(q, [s.id, s.name, s.group]); }).map(function (s) { return { id: s.id, name: s.name, params: s.params ? Object.keys(s.params) : undefined }; }) });
    if (kind === 'recipes') return Promise.resolve({ ok: true, items: (LE.recipes.builtins || []).map(function (r) { return { id: r.metadata.id, name: r.metadata.name, description: r.metadata.description || '', tags: r.metadata.tags || [] }; }).filter(function (r) { return match(q, [r.id, r.name, r.description, (r.tags || []).join(' ')]); }) });
    if (kind === 'sizes') {
      var S = (window.LEStudio && window.LEStudio.SIZES) || [];
      return Promise.resolve({ ok: true, items: S.filter(function (s) { return match(q, [s.id, s.name, s.group]); }).map(function (s) { return { id: s.id, preset: slug(s.name), name: s.name, group: s.group, width: s.w, height: s.h }; }) });
    }
    if (kind === 'layouts') {
      var n = Number(q) || 0;
      var out = [];
      for (var k = n || 1; k <= (n || 9); k++) LE.collage.layouts(k, 1).forEach(function (l) { out.push({ id: l.id, cells: k, name: l.name || LE.collage.layoutName && LE.collage.layoutName(l.id) || l.id }); });
      return LE.collage.index().then(function (ix) {
        var styles = ((ix && (ix.templates || ix.styles || ix.items)) || []).slice(0, 400).map(function (t) { return { template: t.id, name: t.name, photos: t.slots || t.count || t.photos }; });
        return { ok: true, items: out, templates: styles };
      }, function () { return { ok: true, items: out }; });
    }
    if (kind === 'makers') return LE.makers.ready().then(function (list) { return { ok: true, items: list.filter(function (m) { return match(q, [m.id, m.name, m.category, m.summary, (m.keywords || []).join(' ')]); }).map(function (m) { return { id: m.id, name: m.name, category: m.category, summary: m.summary, sizes: m.sizes.map(function (s) { return s.id; }), styles: m.styles.map(function (s) { return s.id; }), inputs: m.inputs.map(function (i) { var o = { key: i.key, type: i.type, label: i.label }; if (i.required) o.required = true; if (i.max) o.max = i.max; if (i.options) o.options = i.options.map(function (x) { return x.id || x; }); return o; }), sample: m.sample && m.sample.values }; }) }; });
    if (kind === 'icons') {
      if (!q) return Promise.resolve({ ok: true, items: LE.assets.sets().filter(function (s) { return s.kind !== 'shape'; }), hint: 'Give a query, e.g. "sun" or "arrow"; icon ids look like lucide:sun.' });
      return Promise.all(['lucide', 'phosphor', 'emoji', 'stickers'].map(function (s) { return LE.assets.load(s).catch(function () {}); })).then(function () {
        var hits = LE.assets.search(q, { limit: lim }) || [];
        return { ok: true, items: hits.slice(0, lim).map(function (h) { return { id: h.id || ((h.set || '') + ':' + (h.name || '')), name: h.name || h.label || '', set: h.set }; }) };
      });
    }
    return Promise.resolve({ ok: false, code: 'invalid', errors: [{ path: '/kind', message: 'Catalogues: fonts, icons, shapes, recipes, makers, layouts, sizes.' }] });
  }
  function make(input) {
    return LE.makers.build(input.id, input.values || {}, { style: input.style, size: input.size }).then(function (r) {
      var studio = { originalSize: { w: r.pages[0].width, h: r.pages[0].height }, fit: 'cover', focal: { x: 0.5, y: 0.5 }, scaleContent: true };
      var raw = { schema: LE.project.SCHEMA, v: LE.project.VERSION, name: r.name, kind: 'design', pages: r.pages, activePage: 0, assets: {}, meta: { app: '2.0', studio: studio } };
      var chk = LE.project.validate(raw);
      if (!chk.ok) return { ok: false, code: 'invalid', errors: (chk.errors || []).map(function (m) { return { path: '', message: m }; }) };
      var text = LE.design.stringify(chk.project, { images: 'ids' }).text;
      return { ok: true, text: text, warnings: r.warnings || [] };
    }, function (e) { return { ok: false, code: 'invalid', errors: (e.errors || [{ key: '', message: e.message }]).map(function (x) { return { path: '/values' + (x.key ? '/' + x.key : ''), message: x.message }; }) }; });
  }
  function validate(input) {
    var raw;
    try { raw = JSON.parse(input.text); } catch (e) { return Promise.resolve({ ok: false, errors: [{ path: '', message: 'This is not valid JSON: ' + String(e.message).slice(0, 160) }], warnings: [] }); }
    return parseDoc(raw, input.files, null, {}).then(function (r) {
      return { ok: r.ok, errors: r.errors || [], warnings: r.warnings || [], problems: r.ok ? problemsOf(r.res.warnings, r.res.remote) : [], remote: r.ok ? r.res.remote : [] };
    });
  }
  /* ---------------------------------------------------------------- containers */
  function exportProject() {
    if (!cur) return Promise.resolve({ ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] });
    var p = clone(cur.project);
    p.id = p.id || 'd' + Date.now().toString(36);
    return LE.project.exportFile(p, { blobs: cur.blobs }).then(blobToB64).then(function (b64) { return { ok: true, data: b64 }; });
  }
  function importProject(input) {
    var blob = b64ToBlob(input.data, 'application/zip');
    var file = new File([blob], input.name || 'design.leproject', { type: 'application/zip' });
    return LE.project.readFile(file).then(function (r) {
      var project = r.project;
      var srcOf = {};
      cur = { project: project, notes: null, blobs: Object.assign({}, r.blobs), srcOf: srcOf, warnings: [], remote: [], canvases: {}, regen: [] };
      return LE.design.exportText(project, { images: 'embed', blobs: cur.blobs }).then(function (t) {
        return LE.design.parse(t.text).then(function (res) {
          if (!res.ok) return { ok: false, code: 'invalid', errors: res.errors };
          cur.warnings = res.warnings;
          cur.text = textOf(cur.project, srcOf, null);
          cur.doc = JSON.parse(cur.text);
          return summary(cur, { importWarnings: r.warnings || [] });
        });
      });
    }, function (e) { return { ok: false, code: 'invalid', errors: [{ path: '', message: String(e.message || e) }] }; });
  }
  /* The open design as text with images embedded (data URIs) or as assets/<name>.<ext> paths (+ the bytes). */
  function exportText(input) {
    if (!cur) return Promise.resolve({ ok: false, code: 'no-session', errors: [{ path: '', message: 'No design is open.' }] });
    var images = input.images === 'paths' ? 'paths' : 'embed';
    return LE.design.exportText(cur.project, { images: images, blobs: cur.blobs }).then(function (r) {
      var text = r.text;
      if (cur.notes && cur.notes.length) text = text.replace(/\n\}\s*$/, ',\n  "notes": [\n' + cur.notes.map(function (n) { return '    ' + JSON.stringify(n); }).join(',\n') + '\n  ]\n}\n');
      return Promise.all((r.assets || []).map(function (a) {
        var b = a.blob || cur.blobs[a.id];
        return b ? blobToB64(b).then(function (d) { return { id: a.id, path: a.path, type: a.type, data: d }; }) : { id: a.id, path: a.path, missing: true };
      })).then(function (assets) { return { ok: true, text: text, assets: images === 'paths' ? assets : [], missing: r.missing || [] }; });
    });
  }
  function selfTest() {
    /* Proves the network seal from inside the page: any request off this origin must fail. */
    return fetch('https://example.com/le-cli-seal-check', { cache: 'no-store', mode: 'no-cors' }).then(function () { return { sealed: false }; }, function () { return { sealed: true }; });
  }
  function info() {
    var A = window.LEAgent;
    return {
      ok: true, mode: agent() ? 'agent' : 'fallback', ready: !!(LE && LE.design && LE.Scene && LE.link),
      format: LE.design && LE.design.VERSION, agent: A ? { protocol: A.protocol || null, hasApplyExternal: typeof A.applyExternal === 'function' } : null,
      headless: window.LE_AGENT_HEADLESS === true, userAgent: navigator.userAgent, ops: LE.link ? LE.link.OPS : []
    };
  }

  function guard(fn) {
    return function (input) {
      try {
        return Promise.resolve(fn(input || {})).catch(function (e) { return { ok: false, code: (e && e.code) || 'invalid', errors: [{ path: '', message: String((e && e.message) || e) }] }; });
      } catch (e) { return Promise.resolve({ ok: false, code: 'invalid', errors: [{ path: '', message: String((e && e.message) || e) }] }); }
    };
  }
  window.__lecli = {
    info: guard(info), load: guard(load), apply: guard(apply), state: guard(state), render: guard(render), find: guard(find),
    catalog: guard(catalog), make: guard(make), validate: guard(validate), selfTest: guard(selfTest),
    exportProject: guard(exportProject), importProject: guard(importProject), exportText: guard(exportText),
    close: function () { cur = null; return true; }
  };
})();
