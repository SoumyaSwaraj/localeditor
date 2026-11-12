/* LocalEditor: agent control API (window.LEAgent). One operation vocabulary for every agent:
   - in the browser, where a person watches each change (le-studio-agent.js draws the live view), and
   - headless, where a CLI / MCP server / local API drives the same engine with no UI (window.LE_AGENT_HEADLESS = true).
   Every change goes through LE.design.parse (shorthand, safety scan) and LE.project.validate (the one safety gate).
   Batches are atomic: fully applied as one step, or not at all. Results are plain JSON.
   Guide: docs/AGENT-GUIDE.md. Format: docs/FORMAT-DESIGN.md. */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  var HEADLESS = window.LE_AGENT_HEADLESS === true;
  var VERSION = '1.0.0';
  var PROTOCOL = 1;
  var INITIAL = { hash: String(location.hash || ''), search: String(location.search || '') };
  var SS_KEY = 'le-agent';
  var BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  var LIMITS = { opsPerBatch: 200, queue: 50, batchJson: 12 * 1024 * 1024, exportBytes: 20 * 1024 * 1024, changes: 400, feed: 200 };
  var CODES = {
    invalid: 'The input is wrong. The message and path say what and where; nothing was changed (unless partial: true).',
    conflict: 'The document changed under you (the person edited, deleted or undid something, or ifRev is stale). Read state(), then decide again.',
    interrupted: 'The person pressed Stop. Queued batches were cancelled. A fresh state is attached; re-plan from it.',
    paused: 'The person paused you, or is editing. Your batch is queued (or refused with whenPaused: "reject"). Poll state().paused or wait for on("resume").',
    'no-session': 'There is no active session: call begin({ name, task }). Sessions end on Take over, Turn off, end(), reload or a crash.',
    consent: 'The person has not allowed this (agent mode, a remote image host, a file). Ask them in chat; never click consent buttons yourself.',
    unsupported: 'Not available here (for example remote images in headless mode, or a missing studio module).',
    'too-large': 'Over a size limit (batch, export, image). Use smaller images, a lower scale, or download: true.'
  };

  /* ---------- small helpers ---------- */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function now() { return Date.now(); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').trim().slice(0, max || 200); }
  function rid(p) { return (p || 'x') + now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function C() { return window.LEStudio || null; }
  function ssGet() { try { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null') || {}; } catch (e) { return {}; } }
  function ssSet(o) { try { sessionStorage.setItem(SS_KEY, JSON.stringify(o)); } catch (e) {} }
  function AgentError(code, message, path, extra) { this.code = code; this.message = message; this.path = path || ''; this.extra = extra || null; }
  function err(code, message, path, extra) { return new AgentError(code, message, path, extra); }
  function quote(s) { return '“' + String(s).slice(0, 48) + '”'; }
  function timeStr(t) { try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- state ---------- */
  var saved = ssGet();
  var A = {
    mode: HEADLESS, askNext: !HEADLESS, session: null, ended: null, rev: Number(saved.rev) || 0, changes: [], lastSig: null, lastPages: null, projectId: null,
    queue: [], running: null, paused: false, pauseReason: null, stopped: null, speed: HEADLESS ? 'instant' : (saved.speed || 'normal'),
    results: {}, unseen: [], newNotes: [], listeners: {}, feed: [], hosts: { allowed: {}, declined: {} }, ui: null, blobs: {}, busyUntil: 0,
    committing: false, consentWait: null, config: {}, ready: false, normScene: null
  };
  if (saved.session && !HEADLESS) {
    A.ended = { reason: 'reload', name: saved.session.name, task: saved.session.task, at: now() };
    saved.session = null;
    ssSet(saved);
  }
  function persist() { var s = ssGet(); s.rev = A.rev; s.speed = A.speed; s.session = A.session ? { name: A.session.name, task: A.session.task, id: A.session.id } : null; ssSet(s); }

  function emit(name, data) {
    (A.listeners[name] || []).slice().forEach(function (fn) { try { fn(clone(data)); } catch (e) { console.error(e); } });
    (A.listeners['*'] || []).slice().forEach(function (fn) { try { fn(name, clone(data)); } catch (e) { console.error(e); } });
  }
  function on(name, fn) {
    if (typeof fn !== 'function') return function () {};
    var arr = A.listeners[name] = A.listeners[name] || [];
    arr.push(fn);
    return function () { var i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); };
  }

  /* ---------- studio access ---------- */
  var readyWaiters = [];
  function whenReady() {
    if (A.ready && C()) return Promise.resolve(C());
    return new Promise(function (res) { readyWaiters.push(res); });
  }
  function markReady() {
    if (A.ready) return;
    A.ready = true;
    readyWaiters.splice(0).forEach(function (f) { f(C()); });
  }
  function project() { var c = C(); return c && c.S ? c.S.project : null; }
  function studioMeta(p) { p = p || project(); return p ? (p.meta.studio = p.meta.studio || {}) : {}; }
  function ensureProject() {
    var c = C();
    if (!c) throw err('unsupported', 'The studio is not ready yet. Wait a moment and try again.');
    if (!c.S.project) c.newDesign(1080, 1080, 'Untitled design');
    return c.S.project;
  }

  /* ---------- revisions and change tracking ---------- */
  function bbox(l) { return { x: l.x || 0, y: l.y || 0, w: l.w || 0, h: l.h || 0 }; }
  function layerKind(a, b) {
    var keys = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) keys[k] = 1; });
    var ks = Object.keys(keys);
    if (!ks.length) return null;
    var geo = ks.every(function (k) { return k === 'x' || k === 'y' || k === 'points'; });
    if (geo) return 'moved';
    if (ks.every(function (k) { return /^(x|y|w|h|size|points)$/.test(k); })) return 'resized';
    if (ks.indexOf('text') >= 0 && ks.every(function (k) { return /^(text|h|w|x|y|size)$/.test(k); })) return 'text';
    if (ks.indexOf('src') >= 0 || ks.indexOf('crop') >= 0) return 'image';
    return 'restyled';
  }
  /* Diff two page lists by layer id. Pages are matched by position. */
  function diffPages(a, b) {
    var out = { items: [], pagesAdded: 0, pagesRemoved: 0, background: [], resized: [] };
    a = a || []; b = b || [];
    if (b.length > a.length) out.pagesAdded = b.length - a.length;
    if (a.length > b.length) out.pagesRemoved = a.length - b.length;
    var n = Math.min(a.length, b.length);
    for (var pi = 0; pi < n; pi++) {
      var pa = a[pi], pb = b[pi];
      if (JSON.stringify(pa.background) !== JSON.stringify(pb.background)) out.background.push(pi);
      if (pa.width !== pb.width || pa.height !== pb.height) out.resized.push(pi);
      var ma = {}, mb = {};
      (pa.layers || []).forEach(function (l, i) { ma[l.id] = { l: l, i: i }; });
      (pb.layers || []).forEach(function (l, i) { mb[l.id] = { l: l, i: i }; });
      (pb.layers || []).forEach(function (l) {
        if (!ma[l.id]) out.items.push({ page: pi, id: l.id, kind: 'added', type: l.type, name: l.name || '', text: l.type === 'text' ? String(l.text || '').slice(0, 60) : undefined, after: bbox(l) });
        else {
          var k = layerKind(ma[l.id].l, l);
          if (k) out.items.push({ page: pi, id: l.id, kind: k, type: l.type, name: l.name || '', text: l.type === 'text' ? String(l.text || '').slice(0, 60) : undefined, before: bbox(ma[l.id].l), after: bbox(l) });
        }
      });
      (pa.layers || []).forEach(function (l) {
        if (!mb[l.id]) out.items.push({ page: pi, id: l.id, kind: 'removed', type: l.type, name: l.name || '', before: bbox(l) });
      });
      var orderA = (pa.layers || []).filter(function (l) { return mb[l.id]; }).map(function (l) { return l.id; }).join('|');
      var orderB = (pb.layers || []).filter(function (l) { return ma[l.id]; }).map(function (l) { return l.id; }).join('|');
      if (orderA !== orderB) out.items.push({ page: pi, id: '', kind: 'reordered', type: '', name: '' });
    }
    out.empty = !out.items.length && !out.pagesAdded && !out.pagesRemoved && !out.background.length && !out.resized.length;
    return out;
  }
  function compactChange(ch) {
    return {
      rev: ch.rev, by: ch.by, at: ch.at, label: ch.label || undefined,
      layers: ch.diff.items.filter(function (i) { return i.id; }).map(function (i) { return { page: i.page, id: i.id, change: i.kind }; }),
      pages: ch.diff.pagesAdded || ch.diff.pagesRemoved ? { added: ch.diff.pagesAdded, removed: ch.diff.pagesRemoved } : undefined,
      background: ch.diff.background.length ? ch.diff.background : undefined
    };
  }
  function recordChange(by, diff, extra) {
    A.rev++;
    var ch = Object.assign({ rev: A.rev, by: by, at: now(), diff: diff }, extra || {});
    A.changes.push(ch);
    if (A.changes.length > LIMITS.changes) A.changes.splice(0, A.changes.length - LIMITS.changes);
    persist();
    if (by === 'person') emit('person-edit', compactChange(ch));
    emit('change', compactChange(ch));
    return ch;
  }
  function changesSince(rev) {
    return A.changes.filter(function (c) { return c.rev > rev; }).map(compactChange);
  }
  /* Reads the studio document; any difference from the last known state is the person's edit. */
  function sync() {
    if (A.ui && A.ui.finish) A.ui.finish();
    var c = C();
    var p = c && c.S ? c.S.project : null;
    if (!p) { A.lastSig = null; A.lastPages = null; A.projectId = null; return null; }
    /* Read-only: the open page comes from the scene; the project object is not touched here. */
    var pages = p.pages.slice();
    if (!c.S.preview) pages[p.activePage || 0] = c.doc();
    if (A.projectId !== p.id) {
      if (A.projectId) {
        recordChange('person', { items: [], pagesAdded: 0, pagesRemoved: 0, background: [], resized: [], empty: false, project: true }, { label: 'Opened another design' });
      }
      A.projectId = p.id;
      A.lastSig = JSON.stringify(pages);
      A.lastPages = JSON.parse(A.lastSig);
      return p;
    }
    var s = JSON.stringify(pages);
    if (s !== A.lastSig) {
      var next = JSON.parse(s);
      var d = diffPages(A.lastPages, next);
      A.lastSig = s;
      A.lastPages = next;
      if (!d.empty) recordChange('person', d);
    }
    return p;
  }
  /* sync() plus writing the open page into the project, for actions that read or change the project. */
  function syncP() {
    var p = sync(), c = C();
    if (p && !c.S.preview) c.syncProject();
    return p;
  }
  function settleKnown() {
    var c = C(), p = project();
    if (!p) return;
    var pages = p.pages.slice();
    if (!c.S.preview) pages[p.activePage || 0] = c.doc();
    A.projectId = p.id;
    A.lastSig = JSON.stringify(pages);
    A.lastPages = JSON.parse(A.lastSig);
  }
  function personChangedSince(rev, pi, id) {
    for (var i = A.changes.length - 1; i >= 0; i--) {
      var ch = A.changes[i];
      if (ch.rev <= rev) break;
      if (ch.by !== 'person') continue;
      if (ch.diff.project) return { change: 'opened another design', rev: ch.rev };
      for (var j = 0; j < ch.diff.items.length; j++) {
        var it = ch.diff.items[j];
        if (it.id === id && it.page === pi) return { change: it.kind, rev: ch.rev };
      }
    }
    return null;
  }

  /* ---------- notes (meta.studio.notes) ---------- */
  function notesList(p) { var st = studioMeta(p); if (!Array.isArray(st.notes)) st.notes = []; return st.notes; }
  function addNote(spec) {
    var c = C(), p = project();
    if (!p) return null;
    var text = str(spec.text, 1000);
    if (!text) return null;
    var n = { id: rid('n'), page: p.activePage || 0, x: r2(Number(spec.x) || 0), y: r2(Number(spec.y) || 0), text: text, status: 'open', at: now() };
    if (spec.page != null) n.page = Math.max(0, Math.min(p.pages.length - 1, Number(spec.page) || 0));
    if (spec.layer && /^[\w:.-]{1,48}$/.test(spec.layer)) n.layer = spec.layer;
    notesList(p).push(n);
    A.newNotes.push(n.id);
    c.markDirty();
    emit('note', n);
    emit('notes', notesList(p));
    return n;
  }
  function setNote(id, patch) {
    var p = project();
    if (!p) return null;
    var list = notesList(p);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
      if (patch.remove) { list.splice(i, 1); C().markDirty(); emit('notes', list); return { id: id, removed: true }; }
      Object.keys(patch).forEach(function (k) { list[i][k] = patch[k]; });
      C().markDirty();
      emit('notes', list);
      return list[i];
    }
    return null;
  }

  /* ---------- the safety scan for raw op payloads ---------- */
  var DANGER = /<\s*\/?\s*(?:script|iframe|object|embed|style|link|meta|html|body|svg|img|foreignobject|form|input|textarea|button|a)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;
  function scan(v, path, depth) {
    if (depth > 40) throw err('invalid', 'Nesting is deeper than 40 levels.', path);
    if (typeof v === 'string') {
      if (/^data:image\//i.test(v) && /\/src$|\/design\/.*\/src$/.test(path)) return;
      if (/\/svg$/.test(path)) return;
      if (DANGER.test(v)) throw err('invalid', 'Text may not contain HTML, script or script URLs. Write plain text.', path);
      return;
    }
    if (Array.isArray(v)) { v.forEach(function (x, i) { scan(x, path + '/' + i, depth + 1); }); return; }
    if (v && typeof v === 'object') {
      Object.keys(v).forEach(function (k) {
        if (BAD_KEYS[k]) throw err('invalid', 'The key "' + k + '" is not allowed.', path + '/' + k);
        scan(v[k], path + '/' + k, depth + 1);
      });
    }
  }
  function safeJson(text) {
    return JSON.parse(text, function (k, v) { if (BAD_KEYS[k]) throw err('invalid', 'The key "' + k + '" is not allowed.', '/' + k); return v; });
  }

  /* ---------- open-format bridges ---------- */
  function mapPath(p, single) {
    if (single === 'raw') return String(p || '');
    return String(p || '').replace(/^\/pages\/0\/layers\/(\d+)/, function (m, i) { return single === 'self' ? '' : single ? '/layer' : '/layers/' + i; }).replace(/^\/pages\/0/, '');
  }
  function resolver() {
    if (HEADLESS) return A.config.resolve || null;
    return function (path) {
      if (!A.ui || !A.ui.askFile) return Promise.resolve(null);
      return A.ui.askFile(path, A.session ? A.session.name : 'The assistant');
    };
  }
  function askHosts(hosts) {
    var need = hosts.filter(function (h) { return !A.hosts.allowed[h] && !A.hosts.declined[h]; });
    if (HEADLESS || !need.length || !A.ui || !A.ui.askRemote) {
      if (HEADLESS) need.forEach(function (h) { A.hosts.declined[h] = 'headless'; });
      return Promise.resolve();
    }
    var chain = Promise.resolve();
    need.forEach(function (h) {
      chain = chain.then(function () { return A.ui.askRemote(h, A.session ? A.session.name : 'The assistant'); }).then(function (yes) { if (yes) A.hosts.allowed[h] = 1; else A.hosts.declined[h] = 'declined'; });
    });
    return chain;
  }
  /* Parses an open-format document (or a mini one) through LE.design.parse and pulls its assets into W. */
  function parseInto(W, doc, basePath, single, opts) {
    opts = opts || {};
    /* opts.layer: parse one layer with LE.design.parseLayer (paths come back relative to the layer). */
    var parsed = opts.layer ? LE.design.parseLayer(opts.layer, { width: opts.page.width, height: opts.page.height, assets: W.assets }, { resolve: resolver() })
      : LE.design.parse(doc, { assets: W.assets, resolve: resolver() });
    return parsed.then(function (res) {
      if (!res.ok) {
        var e0 = res.errors[0] || { path: '', message: 'Not valid.' };
        throw err('invalid', e0.message, basePath + mapPath(e0.path, single), { errors: res.errors.slice(0, 12).map(function (e) { return { path: basePath + mapPath(e.path, single), message: e.message }; }) });
      }
      var remote = res.remote || [];
      var hosts = [];
      remote.forEach(function (r) { if (hosts.indexOf(r.host) < 0) hosts.push(r.host); });
      return askHosts(hosts).then(function () {
        var allowed = hosts.filter(function (h) { return A.hosts.allowed[h]; });
        return allowed.length ? LE.design.fetchRemote(res, allowed) : res;
      }).then(function (r) {
        var bad = remote.filter(function (x) { return !x.done; });
        if (bad.length && !opts.allowEmpty) {
          var b = bad[0];
          var why = A.hosts.declined[b.host] === 'headless' ? err('unsupported', 'Images from the web are not downloaded in headless mode. Pass the image as a data: URI.', basePath + mapPath(b.refs[0].path, single))
            : A.hosts.declined[b.host] ? err('consent', 'The person did not allow downloading images from ' + b.host + '. Use a data: URI, ask them in chat, or pass allowEmpty: true to keep an empty photo slot.', basePath + mapPath(b.refs[0].path, single), { host: b.host })
              : err('invalid', 'The image from ' + b.host + ' could not be downloaded.', basePath + mapPath(b.refs[0].path, single), { host: b.host });
          throw why;
        }
        Object.keys(r.project.assets || {}).forEach(function (id) { if (!W.assets[id]) W.assets[id] = r.project.assets[id]; });
        Object.keys(r.assets || {}).forEach(function (id) { W.blobs[id] = r.assets[id]; });
        var st = r.project.meta.studio || {};
        ['icons', 'qr', 'fx'].forEach(function (k) { if (st[k]) { W.studio[k] = W.studio[k] || {}; Object.keys(st[k]).forEach(function (id) { W.studio[k][id] = st[k][id]; }); } });
        W.warnings = W.warnings.concat((r.warnings || []).filter(function (w) { return /missing-image|unknown-icon|unknown-shape|shrink-needs-height|remote-failed/.test(w.kind); }).map(function (w) { return { path: basePath + mapPath(w.path, single), kind: w.kind, message: w.message }; }));
        if (r.regenerate && r.regenerate.length) W.regen = true;
        return r;
      });
    });
  }
  function miniDoc(page, layers, bg) {
    return { format: 'localeditor-design', version: 1, name: 'agent', pages: [{ width: page.width, height: page.height, background: bg || '#ffffff', layers: layers }] };
  }
  /* The long (open-format) form of one studio layer, for merging a patch onto. */
  function longForm(W, page, layer) {
    return LE.design.layerToLong(layer, { width: page.width, height: page.height, assets: W.assets, studio: W.studio });
  }
  function pageLong(W, pi) {
    var page = W.pages[pi];
    var mini = { schema: LE.project.SCHEMA, v: LE.project.VERSION, name: 'x', kind: 'design', pages: [clone(page)], activePage: 0, assets: W.assets, meta: { studio: { icons: W.studio.icons, qr: W.studio.qr, fx: W.studio.fx } } };
    return JSON.parse(LE.design.stringify(mini, { images: 'ids' }).text).pages[0];
  }

  /* ---------- working copy ---------- */
  function makeWork(p) {
    var st = p.meta.studio || {};
    return {
      pages: clone(p.pages), active: p.activePage || 0, assets: clone(p.assets || {}), blobs: {}, name: p.name,
      studio: { icons: clone(st.icons || {}), qr: clone(st.qr || {}), fx: clone(st.fx || {}), pageIds: (p.pages || []).map(function (pg, i) { return pg.id || (st.pageIds || [])[i] || ''; }), variables: clone(st.variables || null), remix: clone(st.remix || null) },
      touched: {}, pagesTouched: {}, replacedPages: {}, select: null, warnings: [], regen: false, structural: false, renamed: false
    };
  }
  function touch(W, pi, id) { W.touched[pi + '\u0000' + id] = 1; }
  function pageIndex(W, ref, path) {
    if (ref == null || ref === 'current' || ref === '') return W.active;
    if (typeof ref === 'number') {
      if (ref % 1 !== 0 || ref < 0 || ref >= W.pages.length) throw err('invalid', 'There is no page ' + ref + '. Pages are numbered from 0; this design has ' + W.pages.length + '.', path);
      return ref;
    }
    if (typeof ref === 'string') {
      var i = (W.studio.pageIds || []).indexOf(ref);
      if (i >= 0 && i < W.pages.length) return i;
      if (/^\d+$/.test(ref) && Number(ref) < W.pages.length) return Number(ref);
    }
    throw err('invalid', 'No page ' + quote(ref) + '. Use a page number (0 = first) or a page id from state().pages.', path);
  }
  function layerList(page) { return page.layers || (page.layers = []); }
  function findOn(page, ref) {
    var ls = layerList(page);
    for (var i = 0; i < ls.length; i++) if (ls[i].id === ref) return i;
    var low = String(ref).toLowerCase(), hit = -1, n = 0;
    for (var j = 0; j < ls.length; j++) if (String(ls[j].name || '').toLowerCase() === low) { hit = j; n++; }
    return n === 1 ? hit : (n > 1 ? -2 : -1);
  }
  function suggest(page) {
    return layerList(page).slice(0, 14).map(function (l) { return l.id + (l.name && l.name !== l.id ? ' (' + l.name + ')' : ''); }).join(', ');
  }
  /* Finds a layer by id (or unique name): the given page, else the current page, else the only page that has it. */
  function findLayer(W, ref, pageRef, path, B) {
    if (typeof ref !== 'string' || !ref) throw err('invalid', 'Give the layer "id" (a string). state().design lists every id.', path);
    var pi = pageRef != null ? pageIndex(W, pageRef, path) : W.active;
    var idx = findOn(W.pages[pi], ref);
    if (idx === -2) throw err('invalid', 'More than one layer is named ' + quote(ref) + '. Use its id.', path);
    if (idx < 0 && pageRef == null) {
      var found = [];
      W.pages.forEach(function (pg, i) { if (i !== pi) { var k = findOn(pg, ref); if (k >= 0) found.push([i, k]); } });
      if (found.length === 1) { pi = found[0][0]; idx = found[0][1]; }
      else if (found.length > 1) throw err('invalid', 'The layer ' + quote(ref) + ' is on pages ' + found.map(function (f) { return f[0]; }).join(' and ') + '. Pass "page".', path);
    }
    if (idx < 0) {
      if (B) {
        var gone = personChangedSince(B.knownRev, pi, ref);
        if (gone) throw err('conflict', 'The person ' + (gone.change === 'removed' ? 'deleted' : 'changed') + ' the layer ' + quote(ref) + ' (rev ' + gone.rev + ') after you last read the design. Read state() and decide again.', path, { layer: ref, change: gone.change });
      }
      throw err('invalid', 'No layer ' + quote(ref) + ' on page ' + pi + '. Layers there: ' + (suggest(W.pages[pi]) || 'none') + '.', path);
    }
    var layer = W.pages[pi].layers[idx];
    if (B && !B.ignoreConflicts) {
      var ch = personChangedSince(B.knownRev, pi, layer.id);
      if (ch) throw err('conflict', 'The person ' + (ch.change === 'moved' ? 'moved' : ch.change === 'text' ? 'edited the text of' : 'changed') + ' ' + quote(layer.name || layer.id) + ' (rev ' + ch.rev + ') after you last read the design (your rev ' + B.knownRev + '). Their edit wins: read state(), then decide again.', path, { layer: layer.id, change: ch.change, rev: ch.rev });
    }
    return { page: pi, index: idx, layer: layer };
  }
  function freshId(page, base) {
    base = String(base || 'layer').replace(/[^\w:.-]+/g, '-').slice(0, 40) || 'layer';
    var ids = {};
    layerList(page).forEach(function (l) { ids[l.id] = 1; });
    if (!ids[base]) return base;
    for (var n = 2; n < 10000; n++) if (!ids[base + '-' + n]) return base + '-' + n;
    return rid(base);
  }
  function descendants(page, gid, out) {
    out = out || [];
    layerList(page).forEach(function (l) { if (l.groupId === gid) { out.push(l); if (l.type === 'group') descendants(page, l.id, out); } });
    return out;
  }
  function shift(l, dx, dy) {
    l.x = r2((l.x || 0) + dx); l.y = r2((l.y || 0) + dy);
    if (l.type === 'path' && Array.isArray(l.points)) l.points.forEach(function (p) { p[0] += dx; p[1] += dy; });
  }
  function union(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (l) { if (l.type === 'group') return; x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x + l.w); y1 = Math.max(y1, l.y + l.h); });
    if (!isFinite(x0)) return null;
    return { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) };
  }
  function syncGroups(page) {
    layerList(page).forEach(function (g) {
      if (g.type !== 'group') return;
      var b = union(descendants(page, g.id));
      if (b) { g.x = b.x; g.y = b.y; g.w = b.w; g.h = b.h; }
    });
  }
  function idsOf(op, path) {
    var ids = op.ids != null ? op.ids : op.id != null ? [op.id] : null;
    if (typeof ids === 'string') ids = [ids];
    if (!Array.isArray(ids) || !ids.length) throw err('invalid', 'Give "id" or "ids".', path);
    return ids;
  }

  /* Update one layer from a patch in open-format shorthand. */
  function updateLayer(W, hit, set, path, B) {
    var page = W.pages[hit.page], layer = hit.layer;
    if (!isObj(set)) throw err('invalid', '"set" must be an object of fields, for example { "color": "#FFFFFF" }.', path + '/set');
    var keys = Object.keys(set);
    if (!keys.length) throw err('invalid', '"set" is empty.', path + '/set');
    if (set.id != null && set.id !== layer.id) throw err('invalid', 'Ids cannot be changed. Remove the layer and add a new one.', path + '/set/id');
    if (set.type != null && set.type !== layer.type && !(set.type === 'icon' && layer.type === 'svg')) throw err('invalid', 'A ' + layer.type + ' layer cannot become a ' + set.type + ' layer. Remove it and add a new one.', path + '/set/type');
    if (layer.type === 'group' && keys.some(function (k) { return k !== 'x' && k !== 'y' && k !== 'name' && k !== 'visible' && k !== 'locked' && k !== 'opacity'; })) throw err('invalid', 'A group only takes x, y, name, visible, locked and opacity; change its members instead.', path + '/set');
    if (layer.type === 'group') {
      var gx = set.x != null ? resolveNum(set.x, page.width, layer.w, path + '/set/x') : layer.x;
      var gy = set.y != null ? resolveNum(set.y, page.height, layer.h, path + '/set/y') : layer.y;
      var dx = gx - layer.x, dy = gy - layer.y;
      descendants(page, layer.id).forEach(function (m) { shift(m, dx, dy); touch(W, hit.page, m.id); });
      layer.x = r2(gx); layer.y = r2(gy);
      ['name', 'visible', 'locked', 'opacity'].forEach(function (k) { if (set[k] != null) layer[k] = set[k]; });
      touch(W, hit.page, layer.id);
      return Promise.resolve(layer);
    }
    var long = longForm(W, page, layer);
    keys.forEach(function (k) { if (set[k] === null) delete long[k]; else long[k] = set[k]; });
    if (own(set, 'src') && !own(set, 'crop')) delete long.crop;
    if (set.type === 'icon') long.type = 'icon';
    long.id = layer.id;
    return parseInto(W, null, path + '/set', 'raw', { allowEmpty: B && B.allowEmpty, layer: long, page: page }).then(function (r) {
      var nl = r.layer;
      var out = clone(layer);
      Object.keys(nl).forEach(function (k) { out[k] = nl[k]; });
      keys.forEach(function (k) { if (set[k] === null && k !== 'x' && k !== 'y' && k !== 'w' && k !== 'h') delete out[k]; });
      out.id = layer.id;
      if (layer.groupId) out.groupId = layer.groupId; else delete out.groupId;
      page.layers[hit.index] = out;
      touch(W, hit.page, out.id);
      if (out.groupId) syncGroups(page);
      return out;
    });
  }
  function resolveNum(v, total, size, path) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (v === 'left' || v === 'top') return 0;
    if (v === 'center' || v === 'middle') return (total - size) / 2;
    if (v === 'right' || v === 'bottom') return total - size;
    var m = /^(-?\d+(?:\.\d+)?)%$/.exec(String(v));
    if (m) return total * Number(m[1]) / 100;
    throw err('invalid', 'Use a number, a percentage like "10%", or left / center / right (top / center / bottom).', path);
  }

  /* ---------- operations ---------- */
  var OPS = {};
  OPS.add = function (W, op, path, B) {
    var list = op.layers || (op.layer ? [op.layer] : null);
    if (!list && op.type) { list = [Object.assign({}, op)]; delete list[0].op; delete list[0].page; delete list[0].at; }
    if (!Array.isArray(list) || !list.length) throw err('invalid', '"add" needs "layer": { "type": "text", … } (or "layers": [ … ]).', path + '/layer');
    if (list.length > 600) throw err('too-large', 'Add at most 600 layers in one operation.', path + '/layers');
    var single = !op.layers;
    var base = path + (single ? '' : '');
    var pi = pageIndex(W, op.page, path + '/page');
    var page = W.pages[pi];
    var groupLink = {};
    var mine = {};
    list = list.map(function (l, i) {
      if (!isObj(l)) throw err('invalid', 'A layer is an object with a "type".', path + (single ? '/layer' : '/layers/' + i));
      l = clone(l);
      if (l.id != null) {
        if (typeof l.id !== 'string') throw err('invalid', 'A layer id is a string.', path + (single ? '/layer/id' : '/layers/' + i + '/id'));
        if (findOn(page, l.id) >= 0 && layerList(page).some(function (x) { return x.id === l.id; })) throw err('invalid', 'The id "' + l.id + '" is already used on this page. Use {"op":"update","id":"' + l.id + '","set":{…}} to change it, or choose a new id.', path + (single ? '/layer/id' : '/layers/' + i + '/id'));
      } else {
        var baseId = l.type === 'icon' ? 'icon' : (l.type || 'layer');
        var id = freshId({ layers: layerList(page).concat(Object.keys(mine).map(function (k) { return { id: k }; })) }, baseId);
        l.id = id;
      }
      mine[l.id] = 1;
      if (l.groupId && !list.some(function (o) { return o && o.id === l.groupId; })) {
        var gi = findOn(page, l.groupId);
        if (gi < 0 || page.layers[gi].type !== 'group') throw err('invalid', 'No group layer "' + l.groupId + '" on this page.', path + (single ? '/layer/groupId' : '/layers/' + i + '/groupId'));
        groupLink[l.id] = page.layers[gi].id;
        delete l.groupId;
      }
      return l;
    });
    return parseInto(W, miniDoc(page, list), base, single, { allowEmpty: op.allowEmpty }).then(function (r) {
      var made = r.project.pages[0].layers;
      made.forEach(function (l) { if (groupLink[l.id]) l.groupId = groupLink[l.id]; touch(W, pi, l.id); });
      var at = layerList(page).length;
      if (op.at === 'back') at = 0;
      else if (typeof op.at === 'number') at = Math.max(0, Math.min(layerList(page).length, Math.round(op.at)));
      else if (isObj(op.at) && (op.at.above || op.at.below)) {
        var ref = findOn(page, op.at.above || op.at.below);
        if (ref < 0) throw err('invalid', 'No layer ' + quote(op.at.above || op.at.below) + ' to place next to.', path + '/at');
        at = op.at.above ? ref + 1 : ref;
      }
      Array.prototype.splice.apply(page.layers, [at, 0].concat(made));
      syncGroups(page);
      W.added = (W.added || []).concat(made.map(function (l) { return { page: pi, id: l.id }; }));
      return { added: made.map(function (l) { return l.id; }) };
    });
  };
  OPS.update = function (W, op, path, B) {
    var set = op.set || op.patch;
    if (!set) { set = Object.assign({}, op); ['op', 'id', 'ids', 'page'].forEach(function (k) { delete set[k]; }); }
    var ids = idsOf(op, path);
    var chain = Promise.resolve();
    ids.forEach(function (ref, i) {
      chain = chain.then(function () { return updateLayer(W, findLayer(W, ref, op.page, path + (op.ids ? '/ids/' + i : '/id'), B), set, path, B); });
    });
    return chain.then(function () { return { updated: ids.length }; });
  };
  OPS.remove = function (W, op, path, B) {
    idsOf(op, path).forEach(function (ref, i) {
      var hit = findLayer(W, ref, op.page, path + (op.ids ? '/ids/' + i : '/id'), B);
      var page = W.pages[hit.page];
      var drop = {};
      drop[hit.layer.id] = 1;
      descendants(page, hit.layer.id).forEach(function (m) { drop[m.id] = 1; });
      page.layers = page.layers.filter(function (l) { return !drop[l.id]; });
      Object.keys(drop).forEach(function (id) { touch(W, hit.page, id); });
      syncGroups(page);
    });
  };
  OPS.reorder = function (W, op, path, B) {
    var hit = findLayer(W, op.id, op.page, path + '/id', B);
    var page = W.pages[hit.page];
    var arr = page.layers;
    var item = arr.splice(hit.index, 1)[0];
    var to = op.to != null ? op.to : op.position;
    var at;
    if (to === 'front') at = arr.length;
    else if (to === 'back') at = 0;
    else if (to === 'forward') at = Math.min(arr.length, hit.index + 1);
    else if (to === 'backward') at = Math.max(0, hit.index - 1);
    else if (typeof to === 'number') at = Math.max(0, Math.min(arr.length, Math.round(to)));
    else if (isObj(to) && (to.above || to.below)) {
      var ref = findOn(page, to.above || to.below);
      if (ref < 0) { arr.splice(hit.index, 0, item); throw err('invalid', 'No layer ' + quote(to.above || to.below) + '.', path + '/to'); }
      at = to.above ? ref + 1 : ref;
    } else { arr.splice(hit.index, 0, item); throw err('invalid', '"to" is front, back, forward, backward, an index, or { "above": id } / { "below": id }.', path + '/to'); }
    arr.splice(at, 0, item);
    touch(W, hit.page, item.id);
  };
  OPS.group = function (W, op, path, B) {
    var ids = idsOf(op, path);
    if (ids.length < 2) throw err('invalid', 'Group at least two layers.', path + '/ids');
    var hits = ids.map(function (r, i) { return findLayer(W, r, op.page, path + '/ids/' + i, B); });
    var pi = hits[0].page;
    if (hits.some(function (h) { return h.page !== pi; })) throw err('invalid', 'All layers in a group must be on the same page.', path + '/ids');
    var page = W.pages[pi];
    var members = [];
    hits.forEach(function (h) { members.push(h.layer); if (h.layer.type === 'group') descendants(page, h.layer.id, members); });
    var b = union(members);
    var gid = op.groupId || op.as || freshId(page, 'group');
    if (findOn(page, gid) >= 0 && layerList(page).some(function (l) { return l.id === gid; })) throw err('invalid', 'The id "' + gid + '" is already used.', path + '/groupId');
    if (!/^[\w:.-]{1,48}$/.test(gid)) throw err('invalid', 'Ids use letters, numbers, "-", "_", "." or ":" (up to 48).', path + '/groupId');
    var g = { id: gid, type: 'group', name: str(op.name || 'Group', 120), x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0, opacity: 1, visible: true, locked: false };
    var parent = hits[0].layer.groupId || null;
    if (parent) g.groupId = parent;
    hits.forEach(function (h) { h.layer.groupId = gid; touch(W, pi, h.layer.id); });
    page.layers.push(g);
    touch(W, pi, gid);
    syncGroups(page);
    return { group: gid };
  };
  OPS.ungroup = function (W, op, path, B) {
    var hit = findLayer(W, op.id, op.page, path + '/id', B);
    if (hit.layer.type !== 'group') throw err('invalid', quote(hit.layer.id) + ' is not a group.', path + '/id');
    var page = W.pages[hit.page];
    page.layers.forEach(function (l) { if (l.groupId === hit.layer.id) { if (hit.layer.groupId) l.groupId = hit.layer.groupId; else delete l.groupId; touch(W, hit.page, l.id); } });
    page.layers = page.layers.filter(function (l) { return l.id !== hit.layer.id; });
    touch(W, hit.page, hit.layer.id);
  };
  function rootsOf(W, op, path, B) {
    var hits = idsOf(op, path).map(function (r, i) { return findLayer(W, r, op.page, path + '/ids/' + i, B); });
    var pi = hits[0].page;
    if (hits.some(function (h) { return h.page !== pi; })) throw err('invalid', 'All layers must be on the same page.', path + '/ids');
    return { pi: pi, page: W.pages[pi], hits: hits };
  }
  function boxOf(page, l) { return l.type === 'group' ? (union(descendants(page, l.id)) || bbox(l)) : bbox(l); }
  function moveTree(W, pi, page, l, dx, dy) {
    shift(l, dx, dy); touch(W, pi, l.id);
    if (l.type === 'group') descendants(page, l.id).forEach(function (m) { shift(m, dx, dy); touch(W, pi, m.id); });
  }
  OPS.align = function (W, op, path, B) {
    var R = rootsOf(W, op, path, B);
    var edge = op.edge || op.to;
    if (['left', 'center', 'right', 'top', 'middle', 'bottom'].indexOf(edge) < 0) throw err('invalid', '"edge" is left, center, right, top, middle or bottom.', path + '/edge');
    var rel = op.relativeTo || op.within || (R.hits.length < 2 ? 'page' : 'selection');
    var box = rel === 'page' ? { x: 0, y: 0, w: R.page.width, h: R.page.height } : union(R.hits.map(function (h) { return boxOf(R.page, h.layer); }));
    R.hits.forEach(function (h) {
      var b = boxOf(R.page, h.layer), dx = 0, dy = 0;
      if (edge === 'left') dx = box.x - b.x; else if (edge === 'center') dx = box.x + box.w / 2 - (b.x + b.w / 2); else if (edge === 'right') dx = box.x + box.w - (b.x + b.w);
      else if (edge === 'top') dy = box.y - b.y; else if (edge === 'middle') dy = box.y + box.h / 2 - (b.y + b.h / 2); else dy = box.y + box.h - (b.y + b.h);
      moveTree(W, R.pi, R.page, h.layer, dx, dy);
    });
    syncGroups(R.page);
  };
  OPS.distribute = function (W, op, path, B) {
    var R = rootsOf(W, op, path, B);
    if (R.hits.length < 3) throw err('invalid', 'Distribute needs at least three layers.', path + '/ids');
    var v = op.axis === 'v' || op.axis === 'vertical' || op.axis === 'y';
    var items = R.hits.map(function (h) { return { l: h.layer, b: boxOf(R.page, h.layer) }; }).sort(function (a, b) { return v ? a.b.y - b.b.y : a.b.x - b.b.x; });
    var first = items[0].b, last = items[items.length - 1].b;
    var span = v ? last.y + last.h - first.y : last.x + last.w - first.x;
    var size = items.reduce(function (s, it) { return s + (v ? it.b.h : it.b.w); }, 0);
    var gap = (span - size) / (items.length - 1);
    var cur = v ? first.y : first.x;
    items.forEach(function (it, i) {
      if (i > 0 && i < items.length - 1) { var d = cur - (v ? it.b.y : it.b.x); moveTree(W, R.pi, R.page, it.l, v ? 0 : d, v ? d : 0); }
      cur += (v ? it.b.h : it.b.w) + gap;
    });
    syncGroups(R.page);
  };
  OPS.select = function (W, op, path, B) {
    var ids = op.ids == null && op.id == null ? [] : idsOf(op, path);
    W.select = ids.map(function (r, i) { var h = findLayer(W, r, op.page, path + '/ids/' + i, null); W.active = h.page; return h.layer.id; });
  };
  OPS['page.select'] = function (W, op, path) { W.active = pageIndex(W, op.page, path + '/page'); W.select = []; };
  OPS['page.add'] = function (W, op, path) {
    if (W.pages.length >= 50) throw err('too-large', 'A design can have up to 50 pages.', path);
    var at = op.at == null ? W.active + 1 : Math.max(0, Math.min(W.pages.length, Number(op.at) || 0));
    if (op.id != null && (typeof op.id !== 'string' || !/^[\w:.-]{1,48}$/.test(op.id) || (W.studio.pageIds || []).indexOf(op.id) >= 0)) throw err('invalid', 'A page id is unique and uses letters, numbers, "-", "_", "." or ":".', path + '/id');
    var ids = W.studio.pageIds || [];
    while (ids.length < W.pages.length) ids.push('');
    if (op.duplicate != null) {
      var src = pageIndex(W, op.duplicate, path + '/duplicate');
      W.pages.splice(at, 0, clone(W.pages[src]));
      ids.splice(at, 0, op.id || '');
      W.studio.pageIds = ids; W.active = at; W.structural = true; W.replacedPages[at] = 1;
      return Promise.resolve({ page: at });
    }
    var cur = W.pages[W.active];
    var pg = { width: op.width || cur.width, height: op.height || cur.height, background: op.background || (cur.background && cur.background.type === 'color' ? cur.background.color : '#ffffff'), layers: op.layers || [] };
    var doc = { format: 'localeditor-design', version: 1, name: 'agent', pages: [pg] };
    return parseInto(W, doc, path, false).then(function (r) {
      W.pages.splice(at, 0, r.project.pages[0]);
      ids.splice(at, 0, op.id || '');
      W.studio.pageIds = ids; W.active = at; W.structural = true; W.replacedPages[at] = 1;
      return { page: at };
    });
  };
  OPS['page.remove'] = function (W, op, path) {
    if (W.pages.length < 2) throw err('invalid', 'A design needs at least one page.', path);
    var pi = pageIndex(W, op.page, path + '/page');
    W.pages.splice(pi, 1);
    if (W.studio.pageIds) W.studio.pageIds.splice(pi, 1);
    W.active = Math.min(W.active > pi ? W.active - 1 : W.active, W.pages.length - 1);
    W.structural = true;
  };
  OPS['page.resize'] = function (W, op, path) {
    var pi = pageIndex(W, op.page, path + '/page');
    var page = W.pages[pi];
    ['width', 'height'].forEach(function (k) { if (typeof op[k] !== 'number' || op[k] < 16 || op[k] > 20000) throw err('invalid', k + ' must be a number of pixels from 16 to 20000.', path + '/' + k); });
    var sx = op.width / page.width, sy = op.height / page.height, k = (Math.abs(sx) + Math.abs(sy)) / 2;
    if (op.scaleContent !== false) {
      layerList(page).forEach(function (l) {
        l.x = r2(l.x * sx); l.y = r2(l.y * sy); l.w = r2(l.w * sx); l.h = r2(l.h * sy);
        if (l.type === 'text') l.size = Math.max(1, r2(l.size * k));
        if (l.type === 'path') { (l.points || []).forEach(function (p) { p[0] *= sx; p[1] *= sy; }); l.width = r2(l.width * k); }
        touch(W, pi, l.id);
      });
    }
    page.width = Math.round(op.width); page.height = Math.round(op.height);
    W.pagesTouched[pi] = 1;
    if (pi === W.active) W.resizedActive = true;
  };
  OPS['page.background'] = function (W, op, path) {
    var pi = pageIndex(W, op.page, path + '/page');
    var page = W.pages[pi];
    var bg = op.background != null ? op.background : op.color;
    if (bg == null) throw err('invalid', 'Give "background": a colour like "#14213D", or a gradient / pattern / image object.', path + '/background');
    return parseInto(W, miniDoc(page, [], bg), path, false).then(function (r) {
      page.background = r.project.pages[0].background;
      W.pagesTouched[pi] = 1;
      if (r.regenerate && r.regenerate.length) (W.regenPages = W.regenPages || []).push(pi);
    });
  };
  OPS.replace = function (W, op, path) {
    var design = op.design || op.document;
    if (typeof design === 'string') { try { design = safeJson(design); } catch (e) { throw err('invalid', e instanceof AgentError ? e.message : 'design is not valid JSON.', path + '/design'); } }
    if (!isObj(design)) throw err('invalid', '"replace" needs "design": an open-format document { "format": "localeditor-design", "version": 1, "pages": [ … ] }.', path + '/design');
    if (!design.format) design = Object.assign({ format: 'localeditor-design', version: 1 }, design);
    return parseInto(W, design, path + '/design', 'raw', { allowEmpty: op.allowEmpty }).then(function (r) {
      var P = r.project, st = P.meta.studio || {};
      if (op.page != null) {
        var pi = pageIndex(W, op.page, path + '/page');
        W.pages[pi] = P.pages[0];
        W.replacedPages[pi] = 1;
        if (W.pages[pi].width !== (r.project.pages[0].width)) W.structural = true;
        W.structural = true;
      } else {
        W.pages = P.pages;
        W.active = 0;
        W.name = P.name;
        W.renamed = true;
        W.studio.pageIds = P.pages.map(function (pg, i) { return pg.id || (st.pageIds || [])[i] || ''; });
        W.studio.variables = st.variables || null;
        W.studio.remix = st.remix || null;
        W.pages.forEach(function (p, i) { W.replacedPages[i] = 1; });
        W.structural = true;
      }
      if (r.regenerate && r.regenerate.length) W.regenPages = (W.regenPages || []).concat(op.page != null ? [pageIndex(W, op.page)] : r.regenerate);
    });
  };
  OPS.rename = function (W, op, path) {
    var n = str(op.name, 160);
    if (!n) throw err('invalid', '"name" is the design name (plain text).', path + '/name');
    W.name = n; W.renamed = true;
  };
  OPS['text.replace'] = function (W, op, path, B) {
    if (typeof op.find !== 'string' || !op.find) throw err('invalid', '"find" is the text to look for.', path + '/find');
    if (typeof op.replace !== 'string') throw err('invalid', '"replace" is the new text (it can be "").', path + '/replace');
    var pages = op.page === 'all' ? W.pages.map(function (p, i) { return i; }) : [pageIndex(W, op.page, path + '/page')];
    var only = op.ids ? (Array.isArray(op.ids) ? op.ids : [op.ids]) : null;
    var esc = op.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var rx = new RegExp(esc, op.matchCase ? 'g' : 'gi');
    var targets = [];
    pages.forEach(function (pi) {
      layerList(W.pages[pi]).forEach(function (l, idx) {
        if (l.type !== 'text' || (only && only.indexOf(l.id) < 0 && only.indexOf(l.name) < 0)) return;
        rx.lastIndex = 0;
        if (rx.test(String(l.text || ''))) targets.push({ page: pi, index: idx, layer: l });
      });
    });
    if (!targets.length) throw err('invalid', 'No text contains ' + quote(op.find) + '.', path + '/find');
    var chain = Promise.resolve();
    targets.forEach(function (t) {
      chain = chain.then(function () {
        var hit = findLayer(W, t.layer.id, t.page, path, B);
        return updateLayer(W, hit, { text: String(hit.layer.text).replace(rx, function () { return op.replace; }) }, path, B);
      });
    });
    return chain.then(function () { return { replaced: targets.length, ids: targets.map(function (t) { return t.layer.id; }) }; });
  };
  OPS['image.fill'] = function (W, op, path, B) {
    var hit = findLayer(W, op.id, op.page, path + '/id', B);
    if (hit.layer.type !== 'image') throw err('invalid', quote(hit.layer.id) + ' is a ' + hit.layer.type + ' layer; image.fill needs an image layer or photo slot.', path + '/id');
    if (typeof op.src !== 'string' || !op.src) throw err('invalid', '"src" is a data:image/… URI, an https:// URL (the person is asked), or a relative path (the person picks the file).', path + '/src');
    var set = { src: op.src };
    if (op.fit) set.fit = op.fit;
    return updateLayer(W, hit, set, path, Object.assign({}, B, { allowEmpty: false }));
  };
  OPS.recipe = function (W, op, path, B) {
    var hit = findLayer(W, op.id, op.page, path + '/id', B);
    if (hit.layer.type !== 'image') throw err('invalid', 'Recipes apply to image layers.', path + '/id');
    var rec = op.recipe;
    if (rec === null) return updateLayer(W, hit, { recipe: null }, path, B);
    if (typeof rec !== 'string') throw err('invalid', '"recipe" is a recipe id (see catalog("recipes")).', path + '/recipe');
    return updateLayer(W, hit, { recipe: op.strength != null ? { id: rec, strength: op.strength } : rec }, path, B);
  };
  OPS.collage = function (W, op, path) {
    var pi = pageIndex(W, op.page, path + '/page');
    var long = pageLong(W, pi);
    var meta = {};
    ['layout', 'template', 'count', 'spacing', 'margin', 'radius', 'border', 'aspect'].forEach(function (k) { if (op[k] != null) meta[k] = op[k]; });
    if (!meta.layout && !meta.template && !meta.count) throw err('invalid', '"collage" needs "layout" (e.g. "r-2.3"), "template" or "count".', path);
    long.collage = meta;
    long.layers = (long.layers || []).filter(function (l) { return !(meta.template && l.type === 'image' && l.slot); }).map(function (l) {
      if (l.type === 'image' && l.slot) { var o = clone(l); delete o.x; delete o.y; delete o.w; delete o.h; delete o.crop; return o; }
      return l;
    });
    return parseInto(W, { format: 'localeditor-design', version: 1, name: 'agent', pages: [long] }, path, false).then(function (r) {
      W.pages[pi] = r.project.pages[0];
      W.replacedPages[pi] = 1;
    });
  };
  OPS.make = function (W, op, path) {
    if (!LE.makers || !LE.makers.build) throw err('unsupported', 'Quick makers are not loaded on this page.', path);
    var id = op.maker || op.id;
    return LE.makers.ready().then(function () {
      if (!LE.makers.get(id)) throw err('invalid', 'No maker ' + quote(id) + '. See catalog("makers").', path + '/maker');
      var v = LE.makers.validate(id, op.values || {});
      if (!v.ok) { var e0 = v.errors[0]; throw err('invalid', e0.message, path + '/values/' + (e0.key || ''), { errors: v.errors }); }
      return LE.makers.build(id, op.values || {}, { size: op.size, style: op.style });
    }).then(function (res) {
      var pg = res.pages && res.pages[0];
      if (!pg) throw err('invalid', 'The maker made no page.', path);
      layerList(pg).forEach(function (l) { if (l.type === 'image' && l.src && !W.assets[l.src]) l.src = ''; });
      var pi;
      if (op.newPage) { pi = W.active + 1; W.pages.splice(pi, 0, pg); (W.studio.pageIds || []).splice(pi, 0, ''); W.active = pi; }
      else { pi = pageIndex(W, op.page, path + '/page'); W.pages[pi] = pg; }
      W.replacedPages[pi] = 1;
      W.structural = true;
      W.warnings = W.warnings.concat((res.warnings || []).map(function (w) { return { path: path, kind: w.kind || 'maker', message: w.message || String(w) }; }));
    });
  };
  var OP_ALIASES = { 'add-layer': 'add', set: 'update', patch: 'update', delete: 'remove', order: 'reorder', 'page.background': 'page.background', background: 'page.background', 'replace-text': 'text.replace', fill: 'image.fill', maker: 'make' };

  /* ---------- the gate and the commit ---------- */
  function gate(W, p) {
    var studio = Object.assign({}, p.meta.studio || {}, { icons: W.studio.icons, qr: W.studio.qr, fx: W.studio.fx });
    delete studio.pageIds;
    /* Page ids live on the pages (open format): the working list by position is written onto them here. */
    W.pages.forEach(function (pg, i) { var pid = (W.studio.pageIds || [])[i]; if (pid) pg.id = pid; else delete pg.id; });
    if (W.studio.variables) studio.variables = W.studio.variables; else delete studio.variables;
    if (W.studio.remix) studio.remix = W.studio.remix; else delete studio.remix;
    var raw = { schema: LE.project.SCHEMA, v: LE.project.VERSION, id: p.id, name: W.name, kind: p.kind || 'design', createdAt: p.createdAt, updatedAt: p.updatedAt, pages: W.pages, activePage: W.active, assets: W.assets, meta: { app: (p.meta && p.meta.app) || '2.0', studio: studio } };
    var check = LE.project.validate(raw);
    if (!check.ok) throw err('invalid', (check.errors || ['The result is not a valid design.'])[0], '', { errors: check.errors });
    var out = check.project;
    /* Untouched layers keep their exact objects; touched layers and replaced pages take the sanitised form. */
    var pages = W.pages.map(function (pg, pi) {
      var sp = out.pages[pi];
      if (W.replacedPages[pi]) return sp;
      var byId = {};
      sp.layers.forEach(function (l) { byId[l.id] = l; });
      var res = Object.assign({}, pg);
      if (W.pagesTouched[pi]) { res.background = sp.background; res.width = sp.width; res.height = sp.height; }
      res.layers = layerList(pg).map(function (l) { return W.touched[pi + '\u0000' + l.id] ? byId[l.id] || l : l; }).filter(function (l) { return !W.touched[pi + '\u0000' + l.id] || byId[l.id]; });
      return res;
    });
    var warn = (check.errors || []).map(function (m) { return { path: '', kind: 'sanitised', message: m }; });
    return { pages: pages, active: W.active, name: W.name, assets: out.assets, studio: out.meta.studio, warnings: W.warnings.concat(warn) };
  }
  function normScene() {
    if (A.normScene) return A.normScene;
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none;visibility:hidden';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    A.normScene = new LE.Scene({ el: host, width: 64, height: 64 });
    return A.normScene;
  }
  function normalizePage(pg) {
    try { var s = normScene(); s.load(pg); var o = s.toJSON(); if (pg.id) o.id = pg.id; return o; } catch (e) { return clone(pg); }
  }
  function decodeBlob(blob, name) { return LE.load(new File([blob], name || 'image', { type: blob.type || 'image/png' })); }
  /* New images: into this device's asset store (browser) or memory only (headless), and onto the canvas. */
  function ingestAssets(W, metaOut) {
    var c = C();
    var ids = Object.keys(W.blobs).filter(function (id) { return !c.S.mem[id]; });
    return Promise.all(ids.map(function (id) {
      var blob = W.blobs[id], m = W.assets[id] || metaOut[id] || {};
      var put = HEADLESS ? Promise.resolve({ id: id }) : LE.project.putAsset({ blob: blob, name: m.name, type: m.type || blob.type, width: m.width, height: m.height, source: m.source });
      return put.then(function (meta) {
        if (meta && meta.id && meta.id !== id) throw err('invalid', 'An image could not be stored.');
        return decodeBlob(blob, m.name);
      }).then(function (canvas) {
        var meta = Object.assign({}, W.assets[id] || {}, { id: id });
        c.S.mem[id] = { meta: meta, canvas: canvas };
        c.scene.addAsset(id, canvas);
        A.blobs[id] = blob;
      });
    }));
  }
  /* Swaps the computed pages in. Synchronous: no person edit can land in the middle. */
  function swapIn(final, label) {
    var c = C(), p = c.S.project;
    var before = clone(p.pages), beforeActive = p.activePage || 0;
    var structural = final.pages.length !== before.length || final.active !== beforeActive;
    Object.keys(final.assets || {}).forEach(function (id) { if (!p.assets[id]) p.assets[id] = c.S.mem[id] ? c.S.mem[id].meta : final.assets[id]; });
    if (final.studio) ['icons', 'qr', 'fx', 'pageIds', 'variables', 'remix'].forEach(function (k) { if (final.studio[k] != null) p.meta.studio[k] = final.studio[k]; else if (k === 'variables' || k === 'remix' || k === 'pageIds') delete p.meta.studio[k]; });
    if (final.name && final.name !== p.name) p.name = final.name;
    A.committing = true;
    try {
      if (structural) {
        p.pages = final.pages.map(function (pg, i) { return i === final.active ? normalizePage(pg) : pg; });
        c.loadPage(final.active);
      } else {
        final.pages.forEach(function (pg, i) { if (i !== beforeActive) p.pages[i] = pg; });
        var act = final.pages[beforeActive];
        if (act.id) p.pages[beforeActive].id = act.id; else delete p.pages[beforeActive].id;
        if (JSON.stringify(act) !== JSON.stringify(before[beforeActive])) {
          var norm = normalizePage(act);
          c.replaceDoc(norm, true);
          if (norm.width !== before[beforeActive].width || norm.height !== before[beforeActive].height) c.fit();
        }
      }
      if (c.renderHead) try { c.renderHead(); } catch (e) {}
    } finally { A.committing = false; }
    c.syncProject();
    var after = clone(p.pages);
    var diff = diffPages(before, after);
    A.lastSig = JSON.stringify(p.pages);
    A.lastPages = JSON.parse(A.lastSig);
    A.projectId = p.id;
    c.markDirty();
    return { before: before, after: after, beforeActive: beforeActive, afterActive: p.activePage || 0, diff: diff, structural: structural };
  }

  /* ---------- plain-language summaries ---------- */
  var TYPE_WORD = { text: ['text', 'text layers'], image: ['photo', 'photos'], shape: ['shape', 'shapes'], svg: ['graphic', 'graphics'], path: ['drawing', 'drawings'], group: ['group', 'groups'] };
  function colorWord(bg) {
    if (!bg) return '';
    var c = bg.type === 'color' ? bg.color : bg.type === 'gradient' ? (bg.colors || [])[0] : null;
    if (!c) return bg.type === 'image' ? 'a photo' : 'a new look';
    var name = '';
    try { if (LE.makers && LE.makers.colorName) name = LE.makers.colorName(c); } catch (e) {}
    return (bg.type === 'gradient' ? 'a gradient from ' : '') + (name ? name.toLowerCase() + ' (' + c + ')' : c);
  }
  function summarize(diff, afterPages) {
    var parts = [];
    var groups = {};
    diff.items.forEach(function (it) { if (!it.id) return; (groups[it.kind] = groups[it.kind] || []).push(it); });
    function nameOf(it) {
      if (it.type === 'text' && it.text) return 'text “' + it.text.replace(/\s+/g, ' ').slice(0, 28) + (it.text.length > 28 ? '…' : '') + '”';
      var w = (TYPE_WORD[it.type] || ['layer'])[0];
      return it.name && it.name !== it.id && !/^(Image|Text|Shape|Graphic|Drawing|Group)( \d+)?$/.test(it.name) ? w + ' “' + it.name + '”' : 'a ' + w;
    }
    function many(list) {
      if (list.length === 1) return nameOf(list[0]);
      var types = {};
      list.forEach(function (i) { types[i.type] = (types[i.type] || 0) + 1; });
      var ks = Object.keys(types);
      if (ks.length === 1) return list.length + ' ' + (TYPE_WORD[ks[0]] || ['layer', 'layers'])[1];
      return list.length + ' layers';
    }
    var VERB = { added: 'Added', removed: 'Removed', moved: 'Moved', resized: 'Resized', text: 'Edited', restyled: 'Restyled', image: 'Changed the photo in' };
    ['added', 'text', 'restyled', 'image', 'moved', 'resized', 'removed'].forEach(function (k) {
      if (groups[k]) parts.push(VERB[k] + ' ' + many(groups[k]));
    });
    diff.background.forEach(function (pi) { parts.push('Changed the background to ' + colorWord(afterPages[pi] && afterPages[pi].background)); });
    diff.resized.forEach(function (pi) { var pg = afterPages[pi]; parts.push('Resized the page to ' + pg.width + ' × ' + pg.height); });
    if (diff.pagesAdded) parts.push('Added ' + (diff.pagesAdded > 1 ? diff.pagesAdded + ' pages' : 'a page'));
    if (diff.pagesRemoved) parts.push('Removed ' + (diff.pagesRemoved > 1 ? diff.pagesRemoved + ' pages' : 'a page'));
    if (!parts.length && diff.items.some(function (i) { return i.kind === 'reordered'; })) parts.push('Changed the layer order');
    if (!parts.length) return 'No visible change';
    var s = parts.slice(0, 3).join(', ');
    if (parts.length > 3) s += ' and ' + (parts.length - 3) + ' more';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------- feed and undo ---------- */
  function touchedKeys(diff) {
    var out = {};
    diff.items.forEach(function (it) { if (it.id) out[it.page + '\u0000' + it.id] = it; });
    return out;
  }
  function layerAt(pages, pi, id) {
    var pg = pages[pi];
    if (!pg) return null;
    for (var i = 0; i < pg.layers.length; i++) if (pg.layers[i].id === id) return { i: i, l: pg.layers[i] };
    return null;
  }
  /* Reverts one feed entry on a page list. Returns the new pages, or null when a later change touched the same things. */
  function revertOn(pages, e) {
    if (e.structural || e.diff.pagesAdded || e.diff.pagesRemoved) return JSON.stringify(pages) === e.afterSig ? clone(e.before) : null;
    if (pages.length !== e.after.length) return null;
    var out = clone(pages);
    var keys = touchedKeys(e.diff);
    var ok = true;
    Object.keys(keys).forEach(function (k) {
      var it = keys[k], pi = it.page;
      var nowL = layerAt(pages, pi, it.id), afterL = layerAt(e.after, pi, it.id);
      if (JSON.stringify(nowL && nowL.l) !== JSON.stringify(afterL && afterL.l)) ok = false;
    });
    e.diff.background.forEach(function (pi) { if (JSON.stringify(pages[pi].background) !== JSON.stringify(e.after[pi].background)) ok = false; });
    e.diff.resized.forEach(function (pi) { if (pages[pi].width !== e.after[pi].width || pages[pi].height !== e.after[pi].height) ok = false; });
    if (!ok) return null;
    if (e.diff.items.some(function (i) { return i.kind === 'reordered'; })) {
      var pis = {};
      e.diff.items.forEach(function (i) { if (i.kind === 'reordered') pis[i.page] = 1; });
      for (var pk in pis) if (JSON.stringify(pages[pk].layers.map(function (l) { return l.id; })) !== JSON.stringify(e.after[pk].layers.map(function (l) { return l.id; }))) return null;
    }
    Object.keys(keys).forEach(function (k) {
      var it = keys[k], pi = it.page, pg = out[pi];
      var cur = layerAt(out, pi, it.id), was = layerAt(e.before, pi, it.id);
      if (cur && !was) pg.layers.splice(cur.i, 1);
      else if (cur && was) pg.layers[cur.i] = clone(was.l);
      else if (!cur && was) pg.layers.splice(Math.min(was.i, pg.layers.length), 0, clone(was.l));
    });
    e.diff.items.forEach(function (i) {
      if (i.kind !== 'reordered') return;
      var order = {};
      e.before[i.page].layers.forEach(function (l, n) { order[l.id] = n; });
      out[i.page].layers.sort(function (a, b) { return (order[a.id] == null ? 1e6 : order[a.id]) - (order[b.id] == null ? 1e6 : order[b.id]); });
    });
    e.diff.background.forEach(function (pi) { out[pi].background = clone(e.before[pi].background); });
    e.diff.resized.forEach(function (pi) { out[pi].width = e.before[pi].width; out[pi].height = e.before[pi].height; });
    return out;
  }
  function feedEntry(id) { for (var i = 0; i < A.feed.length; i++) if (A.feed[i].id === id) return A.feed[i]; return null; }
  function undoInfo(id) {
    var e = feedEntry(id);
    if (!e || e.undone) return { ok: false, code: 'invalid', message: 'Nothing to undo.' };
    var p = syncP();
    if (!p || p.id !== e.projectId) return { ok: false, code: 'conflict', message: 'That change was made in another design.' };
    var sel = revertOn(p.pages, e);
    var later = A.changes.filter(function (c) { return c.rev > e.rev; });
    return { ok: true, selective: !!sel, later: later.length, laterByPerson: later.filter(function (c) { return c.by === 'person'; }).length };
  }
  /* mode: 'selective' (only this change, when sound) or 'toHere' (the whole design back to just before it). */
  function undoEntry(id, mode) {
    var e = feedEntry(id);
    if (!e || e.undone) return Promise.resolve({ ok: false, code: 'invalid', message: 'Nothing to undo.' });
    var p = syncP();
    if (!p || p.id !== e.projectId) return Promise.resolve({ ok: false, code: 'conflict', message: 'That change was made in another design.' });
    var target = mode === 'toHere' ? clone(e.before) : revertOn(p.pages, e);
    if (!target) return Promise.resolve({ ok: false, code: 'conflict', message: 'Later changes touched the same layers, so this change cannot be undone on its own. Use “Undo back to here”.' });
    var active = Math.min(mode === 'toHere' ? e.beforeActive : (p.activePage || 0), target.length - 1);
    var r = swapIn({ pages: target, active: active, assets: {}, studio: null }, 'Undo');
    if (mode === 'toHere') A.feed.forEach(function (x) { if (x.projectId === e.projectId && x.rev >= e.rev) x.undone = true; });
    else e.undone = true;
    var label = (mode === 'toHere' ? 'Undid back to before: ' : 'Undid: ') + e.summary;
    var ch = recordChange('person', r.diff, { label: label, undo: e.id });
    var undoE = addFeed({ by: 'person', label: label, summary: label, diff: r.diff, swap: r, rev: ch.rev, undoOf: e.id });
    emit('undo', { entry: e.id, mode: mode, rev: A.rev });
    return Promise.resolve({ ok: true, mode: mode, rev: A.rev, entry: undoE.id });
  }
  function undoSession(sessionId) {
    var p = syncP();
    if (!p) return Promise.resolve({ ok: false, code: 'invalid', message: 'No design open.' });
    var list = A.feed.filter(function (e) { return e.by === 'agent' && !e.undone && (!sessionId || e.session === sessionId) && e.projectId === p.id; });
    if (!list.length) return Promise.resolve({ ok: false, code: 'invalid', message: 'The assistant has not changed this design.' });
    var pages = p.pages;
    for (var i = list.length - 1; i >= 0 && pages; i--) pages = revertOn(pages, list[i]);
    var mode = pages ? 'selective' : 'toHere';
    var target = pages || clone(list[0].before);
    var r = swapIn({ pages: target, active: Math.min(p.activePage || 0, target.length - 1), assets: {}, studio: null }, 'Undo all');
    list.forEach(function (e) { e.undone = true; });
    var label = 'Undid everything the assistant did' + (mode === 'toHere' ? ' (back to before it started)' : '');
    var ch = recordChange('person', r.diff, { label: label });
    addFeed({ by: 'person', label: label, summary: label, diff: r.diff, swap: r, rev: ch.rev });
    return Promise.resolve({ ok: true, mode: mode, rev: A.rev });
  }
  function undoAllInfo(sessionId) {
    var p = syncP();
    if (!p) return { ok: false };
    var list = A.feed.filter(function (e) { return e.by === 'agent' && !e.undone && (!sessionId || e.session === sessionId) && e.projectId === p.id; });
    var pages = p.pages;
    for (var i = list.length - 1; i >= 0 && pages; i--) pages = revertOn(pages, list[i]);
    return { ok: !!list.length, count: list.length, selective: !!pages };
  }
  function addFeed(o) {
    var p = project();
    var e = {
      id: rid('f'), at: now(), by: o.by, source: o.source || null, session: o.session || null, agent: o.agent || null, label: o.label || '', summary: o.summary,
      ops: o.ops || null, batch: o.batch || null, rev: o.rev, diff: o.diff, before: o.swap.before, after: o.swap.after, afterSig: JSON.stringify(o.swap.after),
      beforeActive: o.swap.beforeActive, structural: o.swap.structural, projectId: p ? p.id : null, undone: false, undoOf: o.undoOf || null, thumb: null
    };
    A.feed.push(e);
    if (A.feed.length > LIMITS.feed) A.feed.splice(0, A.feed.length - LIMITS.feed);
    emit('feed', publicFeedEntry(e));
    return e;
  }
  function publicFeedEntry(e) {
    return { id: e.id, at: e.at, by: e.by, source: e.source, agent: e.agent, label: e.label, summary: e.summary, rev: e.rev, undone: e.undone, ops: e.ops, structural: e.structural };
  }

  /* ---------- sessions, consent, pause ---------- */
  var COLORS = ['#B3510B', '#2F6BFF', '#D07A45', '#E0668E']; /* the first is the agent colour: Apricot 600, distinct from the blue of selection */
  function sessionInfo() {
    var s = A.session;
    return s ? { id: s.id, name: s.name, task: s.task, startedAt: s.startedAt, color: s.color, batches: s.batches } : null;
  }
  function personBusy() { return now() < A.busyUntil || (A.ui && A.ui.busy && A.ui.busy()); }
  function setPaused(on, reason) {
    if (on === A.paused && reason === A.pauseReason) return;
    A.paused = !!on;
    A.pauseReason = on ? reason || 'person' : null;
    if (on) {
      if (A.ui && A.ui.finish) A.ui.finish();
      A.queue.forEach(function (b) { settleQueued(b); });
      emit('pause', { reason: A.pauseReason, queued: A.queue.length });
    } else {
      emit('resume', { queued: A.queue.length });
      pump();
    }
  }
  function settleQueued(b) {
    if (b.answered) return;
    b.answered = true;
    b.resolve(wrap({ ok: true, queued: true, paused: true, code: 'paused', batch: b.id, position: A.queue.indexOf(b) + 1, reason: A.pauseReason,
      message: A.pauseReason === 'person-editing' ? 'The person is editing. Your batch is queued and runs when they press Resume. Poll state().paused or wait for on("resume"); result(batch) has the outcome.' : 'The person paused you. Your batch is queued and runs when they resume. result(batch) has the outcome.' }, b.session));
  }
  function stopAll(reason, code) {
    if (A.running) A.running.cancelled = { reason: reason, code: code || 'interrupted' };
    var q = A.queue.splice(0);
    q.forEach(function (b) {
      var res = { ok: false, code: code || 'interrupted', reason: reason, batch: b.id, message: reason };
      A.results[b.id] = res;
      if (b.session) A.unseen.push(b.id);
      if (!b.answered) { b.answered = true; b.resolve(wrap(Object.assign({ state: stateLite() }, res), b.session)); }
    });
    return q.length;
  }

  /* ---------- the queue ---------- */
  function enqueue(b) {
    return new Promise(function (resolve) {
      b.resolve = resolve;
      if (A.queue.length >= LIMITS.queue) { resolve(wrap({ ok: false, code: 'too-large', message: 'Too many queued batches (' + LIMITS.queue + '). Wait for them to finish.' }, b.session)); return; }
      A.queue.push(b);
      emit('queue', { queued: A.queue.length });
      if (A.paused) settleQueued(b);
      pump();
    });
  }
  function pump() {
    if (A.running || A.paused || !A.queue.length) return;
    /* Never land inside the person's gesture: wait until they let go (an edit while batches are queued pauses instead). */
    if (personBusy() && !HEADLESS) { clearTimeout(A.waitT); A.waitT = setTimeout(pump, 200); return; }
    var b = A.queue.shift();
    A.running = b;
    emit('queue', { queued: A.queue.length, running: b.id });
    runBatch(b).then(function (res) {
      var present = res._present || null;
      delete res._present;
      A.results[b.id] = res;
      if (b.answered && b.session) A.unseen.push(b.id);
      if (present && A.ui && A.ui.present && !HEADLESS) {
        if (b.noWait && !b.answered) { b.answered = true; b.resolve(wrap(res, b.session)); }
        return present().catch(function (e) { console.error(e); }).then(function () { finishRun(b, res); });
      }
      finishRun(b, res);
    }).catch(function (e) {
      console.error(e);
      finishRun(b, { ok: false, code: 'invalid', message: 'Something went wrong while applying the batch: ' + String(e && e.message || e).slice(0, 200), batch: b.id });
    });
  }
  function finishRun(b, res) {
    A.running = null;
    if (!b.answered) { b.answered = true; b.resolve(wrap(res, b.session)); }
    emit('batch', { batch: b.id, ok: res.ok, code: res.code || null, applied: res.applied || 0, rev: A.rev, source: b.source || 'agent' });
    pump();
  }

  /* Runs one batch: compute on a working copy, gate it, then swap it in at once. */
  function runBatch(b) {
    var attempt = 0;
    function once() {
      attempt++;
      var c = C();
      try { ensureProject(); } catch (e) { return Promise.resolve(failRes(b, e)); }
      var p = syncP();
      if (b.ifRev != null && b.ifRev !== A.rev) {
        return Promise.resolve({ ok: false, code: 'conflict', batch: b.id, applied: 0, message: 'The design changed since rev ' + b.ifRev + ' (now ' + A.rev + '). Nothing was applied. "changes" lists what changed; read state() and send the batch again.', changes: changesSince(b.ifRev), errors: [] });
      }
      var sigBase = A.lastSig;
      var W = makeWork(p);
      var errors = [], applied = 0, results = [];
      var chain = Promise.resolve();
      b.ops.forEach(function (op, i) {
        chain = chain.then(function () {
          var path = '/ops/' + i;
          var snap = JSON.stringify({ pages: W.pages, active: W.active, studio: W.studio, name: W.name, select: W.select });
          var fn;
          return Promise.resolve().then(function () {
            if (!isObj(op)) throw err('invalid', 'Each operation is an object like { "op": "add", … }.', path);
            var name = OP_ALIASES[op.op] || op.op;
            fn = OPS[name];
            if (!fn) throw err('invalid', 'Unknown operation ' + quote(op.op) + '. Operations: ' + Object.keys(OPS).join(', ') + '.', path + '/op');
            return fn(W, op, path, b);
          }).then(function (out) {
            applied++;
            results.push(Object.assign({ op: i, ok: true }, out || {}));
          }, function (e) {
            if (!(e instanceof AgentError)) e = err('invalid', String(e && e.message || e).slice(0, 300), path);
            var s = JSON.parse(snap);
            W.pages = s.pages; W.active = s.active; W.studio = s.studio; W.name = s.name; W.select = s.select;
            var o = { op: i, path: e.path || path, code: e.code, message: e.message };
            if (e.extra) Object.keys(e.extra).forEach(function (k) { o[k] = e.extra[k]; });
            errors.push(o);
            results.push({ op: i, ok: false, code: e.code });
          });
        });
      });
      return chain.then(function () {
        if (errors.length && !b.partial) {
          var code = errors.every(function (x) { return x.code === 'conflict'; }) ? 'conflict' : errors[0].code;
          return { ok: false, code: code, batch: b.id, applied: 0, errors: errors, message: 'Nothing was changed: ' + errors.length + ' operation' + (errors.length > 1 ? 's' : '') + ' failed. Fix them and send the batch again (or pass partial: true).', changes: code === 'conflict' ? changesSince(b.knownRev) : undefined };
        }
        if (!applied) return { ok: errors.length === 0, code: errors.length ? errors[0].code : undefined, batch: b.id, applied: 0, errors: errors, message: errors.length ? 'No operation could be applied.' : 'Nothing to do.' };
        var final;
        try { final = gate(W, project()); } catch (e) { return failRes(b, e); }
        return ingestAssets(W, final.assets).then(function () {
          syncP();
          if (A.lastSig !== sigBase || project() !== p) {
            if (attempt < 3) return once();
            return { ok: false, code: 'conflict', batch: b.id, applied: 0, message: 'The person kept editing while this batch was prepared. Nothing was applied; read state() and try again.', errors: [] };
          }
          if (b.cancelled) return { ok: false, code: b.cancelled.code, reason: b.cancelled.reason, batch: b.id, applied: 0, message: b.cancelled.reason + ' before this batch was applied. Nothing was changed.', state: stateLite() };
          var regen = W.regenPages || [];
          var r = swapIn(final, b.label);
          if (W.select && C()) { try { C().scene.select(W.select.filter(function (id) { return layerAt(r.after, r.afterActive, id); })); } catch (e) {} }
          if (r.diff.empty) {
            return { ok: true, batch: b.id, applied: applied, errors: errors, results: results, message: 'Applied, but nothing visible changed.', problems: problems() };
          }
          var summary = summarize(r.diff, r.after);
          var ch = recordChange(b.by || 'agent', r.diff, { label: b.label || summary, batch: b.id, session: b.session ? b.session.id : null });
          var e = addFeed({ by: b.by || 'agent', source: b.source, session: b.session ? b.session.id : null, agent: b.session ? b.session.name : (b.sourceName || null), label: b.label || '', summary: summary, ops: clone(b.ops).slice(0, 60), batch: b.id, rev: ch.rev, diff: r.diff, swap: r });
          if (b.session) { b.session.batches++; b.session.seenRev = A.rev; }
          if (!HEADLESS && C() && !C().S.noSave) C().saveNow();
          regenAfter(regen);
          var out = { ok: true, batch: b.id, applied: applied, errors: errors, results: results, summary: summary, entry: e.id, changed: compactChange(ch).layers, problems: problems(), warnings: final.warnings.length ? final.warnings.slice(0, 20) : undefined };
          out._present = function () { return A.ui && A.ui.present ? A.ui.present({ entry: publicFeedEntry(e), diff: r.diff, before: r.before, after: r.after, afterActive: r.afterActive, speed: A.speed, session: sessionInfo() }) : Promise.resolve(); };
          return out;
        });
      });
    }
    return once();
  }
  function regenAfter(list) {
    var Col = window.LEStudioColor, c = C();
    if (!list || !list.length || !Col || typeof Col.specToBg !== 'function' || !c) return;
    var p = c.S.project;
    list.forEach(function (i) {
      var pg = p.pages[i];
      if (!pg || !pg.background || !pg.background.spec) return;
      Col.specToBg(c, pg.background.spec, { width: pg.width, height: pg.height }).then(function (bg) {
        if (!bg) return;
        if (i === p.activePage) { A.committing = true; try { c.scene.setBackground(bg, { history: false }); } finally { A.committing = false; } c.syncProject(); }
        else p.pages[i] = Object.assign({}, pg, { background: bg });
        settleKnown();
        c.markDirty();
      }).catch(function () {});
    });
  }
  function failRes(b, e) {
    if (!(e instanceof AgentError)) e = err('invalid', String(e && e.message || e).slice(0, 300));
    var o = { ok: false, code: e.code, batch: b.id, applied: 0, message: e.message, errors: [{ op: -1, path: e.path, code: e.code, message: e.message }] };
    if (e.extra && e.extra.errors) o.errors = o.errors.concat(e.extra.errors.slice(1).map(function (x) { return { op: -1, path: x.path || '', code: 'invalid', message: typeof x === 'string' ? x : x.message }; }));
    return o;
  }

  /* ---------- responses ---------- */
  function wrap(res, session) {
    res = res || {};
    res.protocol = PROTOCOL;
    res.rev = A.rev;
    res.paused = A.paused;
    if (A.paused) res.pauseReason = A.pauseReason;
    var s = session || A.session;
    var pend = { notes: [], interrupted: null, results: [], changes: [] };
    var p = project();
    if (p && A.newNotes.length && (session || A.session)) {
      var ids = A.newNotes.splice(0);
      pend.notes = notesList(p).filter(function (n) { return ids.indexOf(n.id) >= 0 && n.status === 'open'; });
    }
    if (p) pend.openNotes = notesList(p).filter(function (n) { return n.status === 'open'; }).length;
    if (A.stopped) pend.interrupted = { reason: A.stopped.reason, at: A.stopped.at };
    if (A.unseen.length && s) {
      pend.results = A.unseen.splice(0).map(function (id) { var r = A.results[id] || {}; return { batch: id, ok: !!r.ok, code: r.code || null, applied: r.applied || 0, summary: r.summary || r.message || '' }; });
    }
    if (s && s.seenRev != null && s.seenRev < A.rev) pend.changes = changesSince(s.seenRev).filter(function (c) { return c.by === 'person'; });
    res.pending = pend;
    if (s && A.session === s) s.seenRev = A.rev;
    return JSON.parse(JSON.stringify(res));
  }
  function fail(code, message, extra) { return wrap(Object.assign({ ok: false, code: code, message: message }, extra || {})); }
  function noSession() {
    var e = A.ended;
    var why = !e ? 'There is no agent session. Call LEAgent.begin({ name, task }) first (the person is asked once).'
      : e.reason === 'taken-over' ? 'The person took over at ' + timeStr(e.at) + ' and ended your session. Stop editing and tell them in chat what you were doing. If they want you to continue, call begin({ name, task }) again — they will be asked.'
        : e.reason === 'off' ? 'The person turned agent mode off at ' + timeStr(e.at) + '. Ask them in chat before calling begin again.'
          : e.reason === 'reload' ? 'The page was reloaded, so your session ended. Committed changes are saved. Call begin({ name, task }) again to continue.'
            : 'Your session has ended. Call begin({ name, task }) to start a new one.';
    return fail('no-session', why, { reason: e ? e.reason : 'none' });
  }
  /* Common entry checks: a Stop is reported once, with a fresh state; mutating calls need a session. */
  function entry(needSession, needMode) {
    if (A.stopped && A.session && !A.stopped.reported) {
      A.stopped.reported = true;
      return fail('interrupted', 'The person stopped the session' + (A.stopped.cancelled ? ' and cancelled ' + A.stopped.cancelled + ' queued batch' + (A.stopped.cancelled > 1 ? 'es' : '') : '') + '. Re-plan from this state; nothing queued will run.', { reason: 'The person stopped the session', state: stateLite() });
    }
    if (needSession && !A.session) return noSession();
    if (needMode && !A.mode && !A.session && A.ended) return noSession();
    if (needMode && !A.mode && !A.session) return fail('consent', 'Agent mode is off. Call LEAgent.begin({ name, task }) to ask the person, or ask them to open the studio with ?agent=1.');
    if (!C()) return fail('unsupported', 'The studio is still loading. Try again in a moment.');
    return null;
  }

  /* ---------- reading ---------- */
  function designOf(p) {
    try { return JSON.parse(LE.design.stringify(p, { images: 'ids' }).text); } catch (e) { return null; }
  }
  function problems(all) {
    var p = project();
    if (!p || !LE.design) return [];
    try {
      return LE.design.lint(p).map(function (w) {
        var m = /^\/pages\/(\d+)/.exec(w.path || '');
        return { page: m ? Number(m[1]) : 0, layer: w.layer || null, kind: w.kind, message: w.message };
      });
    } catch (e) { return []; }
  }
  function pagesInfo(p) {
    var ids = (p.meta.studio && p.meta.studio.pageIds) || [];
    return p.pages.map(function (pg, i) { return { index: i, id: pg.id || ids[i] || null, width: pg.width, height: pg.height, layers: (pg.layers || []).length, current: i === (p.activePage || 0) }; });
  }
  function stateLite() {
    var p = project();
    if (!p) return { design: null, page: 0, pages: [], selection: [] };
    return { design: designOf(p), page: p.activePage || 0, pages: pagesInfo(p), selection: C().scene.selection(), rev: A.rev };
  }
  function pageImage(maxEdge) {
    var c = C(), p = project();
    if (!p) return Promise.resolve(null);
    var pg = p.pages[p.activePage || 0];
    var scale = Math.min(1, (maxEdge || 512) / Math.max(pg.width, pg.height));
    return c.hiddenRender(pg, scale).then(function (cv) { return cv.toDataURL('image/png'); }).catch(function () { return null; });
  }
  function fontsInfo() {
    var n = 0;
    try { n = LE.fonts && LE.fonts.list ? LE.fonts.list().length : 0; } catch (e) {}
    return { count: n, search: 'LEAgent.catalog("fonts", "serif")  — or {"op":"catalog","kind":"fonts","q":"serif"} in the console' };
  }

  /* ---------- check: problems with suggested fixes ---------- */
  function hexOf(c) { var m = /^#([0-9a-f]{6})$/i.exec(String(c || '')); return m ? c : null; }
  function lum(hex) {
    var n = parseInt(hex.slice(1), 16);
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255);
  }
  function behindColor(page, idx) {
    for (var i = idx - 1; i >= 0; i--) {
      var l = page.layers[i], t = page.layers[idx];
      if (l.type === 'shape' && l.fill && l.fill.type === 'solid' && l.x <= t.x && l.y <= t.y && l.x + l.w >= t.x + t.w && l.y + l.h >= t.y + t.h) return hexOf(l.fill.color);
    }
    return page.background && page.background.type === 'color' ? hexOf(page.background.color) : null;
  }
  function fixFor(pr, p) {
    var pg = p.pages[pr.page];
    if (!pg || !pr.layer) return null;
    var idx = -1;
    pg.layers.forEach(function (l, i) { if (l.id === pr.layer) idx = i; });
    if (idx < 0) return null;
    var l = pg.layers[idx];
    var base = { op: 'update', id: l.id };
    if (pr.page !== (p.activePage || 0)) base.page = pr.page;
    if (pr.kind === 'overflow') return Object.assign(base, { set: { fit: 'shrink', h: Math.round(l.h) } });
    if (pr.kind === 'clipped') {
      var set = {};
      if (l.x < 0 || l.x + l.w > pg.width) { set.w = Math.min(Math.round(l.w), Math.round(pg.width * 0.9)); set.x = 'center'; }
      if (l.y < 0) set.y = Math.round(pg.height * 0.05);
      if (l.y + l.h > pg.height) set.y = Math.max(0, Math.round(pg.height - l.h - pg.height * 0.05));
      return Object.assign(base, { set: set });
    }
    if (pr.kind === 'off-page') return Object.assign(base, { set: { x: 'center', y: 'center' } });
    if (pr.kind === 'low-contrast') {
      var bg = behindColor(pg, idx);
      var col = bg && lum(bg) > 0.35 ? '#17131F' : '#FFFFFF';
      return Object.assign(base, { set: { color: col } });
    }
    if (pr.kind === 'unknown-font') return Object.assign(base, { set: { font: 'Plus Jakarta Sans' }, note: 'or pick one from catalog("fonts")' });
    if (pr.kind === 'missing-image') return { op: 'image.fill', id: l.id, src: 'data:image/png;base64,…', note: 'or { "op": "update", "id": "' + l.id + '", "set": { "src": null } } to leave an empty slot' };
    return null;
  }

  /* ---------- catalog ---------- */
  function paged(kind, items, o, total) {
    var off = Math.max(0, Number(o.offset) || 0), lim = Math.max(1, Math.min(200, Number(o.limit) || 50));
    var slice = items.slice(off, off + lim);
    return { ok: true, kind: kind, total: total != null ? total : items.length, offset: off, items: slice, next: off + lim < items.length ? off + lim : null };
  }
  function match(q, hay) { if (!q) return true; q = q.toLowerCase(); return hay.toLowerCase().indexOf(q) >= 0; }
  function catalog(kind, q, o) {
    o = isObj(q) ? q : (o || {});
    if (isObj(q)) q = q.q;
    q = q == null ? '' : String(q).trim();
    var K = String(kind || '').toLowerCase();
    if (K === 'font') K = 'fonts'; if (K === 'icon') K = 'icons'; if (K === 'shape') K = 'shapes'; if (K === 'recipe') K = 'recipes'; if (K === 'maker') K = 'makers';
    if (K === 'collage' || K === 'layouts') K = 'collages'; if (K === 'size' || K === 'page-sizes' || K === 'presets') K = 'sizes'; if (K === 'pattern') K = 'patterns'; if (K === 'filter') K = 'filters';
    try {
      if (K === 'fonts') {
        var fl = (LE.fonts && LE.fonts.list ? LE.fonts.list() : []).map(function (f) { return { id: f.family, name: f.family, category: f.category, weights: f.weights, italic: !!f.italic }; });
        return Promise.resolve(paged(K, fl.filter(function (f) { return match(q, f.name + ' ' + f.category); }), o, null));
      }
      if (K === 'icons') {
        if (!LE.assets) return Promise.resolve({ ok: false, code: 'unsupported', message: 'Icons are not loaded on this page.' });
        if (!q) return Promise.resolve(paged(K, LE.assets.sets().filter(function (s) { return s.kind !== 'shape'; }).map(function (s) { return { id: s.id + ':', name: s.name + ' (' + s.count + ')', hint: 'search with a word: catalog("icons", "sun")' }; }), o));
        var setsWanted = o.set ? [o.set] : ['lucide', 'phosphor', 'emoji', 'stickers'];
        return Promise.all(setsWanted.map(function (s) { return LE.assets.load(s).catch(function () {}); })).then(function () {
          var hits = LE.assets.search(q, { limit: 200, set: o.set });
          return paged(K, hits.map(function (h) { return { id: h.id, name: h.name, set: h.set }; }), o);
        });
      }
      if (K === 'shapes') {
        var sh = (LE.assets ? LE.assets.shapes() : []).map(function (s) { return { id: s.id, name: s.name || s.id }; });
        return Promise.resolve(paged(K, sh.filter(function (s) { return match(q, s.id + ' ' + s.name); }), o));
      }
      if (K === 'recipes') {
        var rl = (LE.recipes && LE.recipes.builtins ? LE.recipes.builtins : []).map(function (r) { var m = r.metadata || {}; return { id: m.id, name: m.name, category: m.category, tags: m.tags }; });
        return Promise.resolve(paged(K, rl.filter(function (r) { return match(q, r.id + ' ' + r.name + ' ' + r.category + ' ' + (r.tags || []).join(' ')); }), o));
      }
      if (K === 'makers') {
        if (!LE.makers) return Promise.resolve({ ok: false, code: 'unsupported', message: 'Makers are not loaded on this page.' });
        return LE.makers.ready().then(function () {
          var ml = LE.makers.list().map(function (m) {
            return { id: m.id, name: m.name, category: m.category, summary: m.summary, styles: (m.styles || []).map(function (s) { return s.id; }),
              sizes: (m.sizes || ['square', 'portrait', 'story']).map(function (s) { return typeof s === 'string' ? s : s.id; }),
              inputs: (m.inputs || []).map(function (i) { return { key: i.key, type: i.type, required: !!i.required, max: i.max, options: i.options }; }) };
          });
          return paged(K, ml.filter(function (m) { return match(q, m.id + ' ' + m.name + ' ' + m.category + ' ' + m.summary); }), o);
        });
      }
      if (K === 'collages') {
        var G = LE.collage && LE.collage.layouts ? LE.collage : null;
        if (!G) return Promise.resolve({ ok: false, code: 'unsupported', message: 'Collage layouts are not loaded on this page.' });
        if (/^\d+$/.test(q)) {
          var p = project(), pg = p ? p.pages[p.activePage || 0] : { width: 1080, height: 1080 };
          return Promise.resolve(paged(K, G.layouts(Number(q), pg.width / pg.height).map(function (l) { return { id: l.id, name: l.name || l.id, cells: l.cells.length, use: { op: 'collage', layout: l.id } }; }), o));
        }
        return G.index().then(function (ix) {
          var st = (ix.styles || []).filter(function (s) { return match(q, s.id + ' ' + s.name + ' ' + (s.tags || []).join(' ')); });
          if (st.length === 1 || o.style) {
            return G.loadStyle(o.style || st[0].id).then(function (pack) {
              return paged(K, (pack.templates || []).map(function (t) { return { id: t.id, name: t.name || t.id, style: pack.id, use: { op: 'collage', template: t.id } }; }), o);
            });
          }
          return paged(K, st.map(function (s) { return { id: s.id, name: s.name, slots: s.slotCount, templates: s.count, kind: 'style', hint: 'catalog("collages", "' + s.id + '") lists its templates; a number like catalog("collages", "4") lists layouts for 4 photos' }; }), o);
        });
      }
      if (K === 'sizes') {
        var sz = ((C() && C().SIZES) || []).map(function (s) { return { id: s.id, name: s.name, group: s.group, width: s.w, height: s.h }; });
        return Promise.resolve(paged(K, sz.filter(function (s) { return match(q, s.id + ' ' + s.name + ' ' + s.group); }), o));
      }
      if (K === 'patterns') {
        var pt = (LE.assets && LE.assets.patterns ? LE.assets.patterns() : []).map(function (x) { return { id: x.id || x[0], name: x.name || x[1] }; });
        return Promise.resolve(paged(K, pt.filter(function (x) { return match(q, x.id + ' ' + x.name); }), o));
      }
      if (K === 'filters') {
        var fk = LE.presets && LE.presets.filters ? Object.keys(LE.presets.filters) : [];
        return Promise.resolve(paged(K, fk.filter(function (k) { return match(q, k); }).map(function (k) { return { id: k, name: k }; }), o));
      }
    } catch (e) { return Promise.resolve({ ok: false, code: 'invalid', message: String(e && e.message || e) }); }
    return Promise.resolve({ ok: false, code: 'invalid', message: 'Unknown catalog ' + quote(kind) + '. Kinds: fonts, icons, shapes, recipes, makers, collages, sizes, patterns, filters.' });
  }

  /* ---------- find ---------- */
  var TYPE_SYN = { photo: 'image', photos: 'image', image: 'image', images: 'image', picture: 'image', pictures: 'image', slot: 'image', slots: 'image',
    text: 'text', texts: 'text', words: 'text', label: 'text', labels: 'text', shape: 'shape', shapes: 'shape', box: 'shape', boxes: 'shape',
    icon: 'svg', icons: 'svg', sticker: 'svg', stickers: 'svg', graphic: 'svg', graphics: 'svg', svg: 'svg', drawing: 'path', drawings: 'path', group: 'group', groups: 'group' };
  function find(query) {
    var p = project();
    if (!p) return [];
    var q = isObj(query) ? query : { q: String(query == null ? '' : query) };
    var pages = q.page === 'all' || q.page == null ? p.pages.map(function (x, i) { return i; }) : [Number(q.page) || 0];
    var all = [];
    pages.forEach(function (pi) { (p.pages[pi] ? p.pages[pi].layers : []).forEach(function (l, z) { all.push({ l: l, page: pi, z: z }); }); });
    function out(x, score) {
      var l = x.l;
      return { id: l.id, name: l.name || '', type: l.type, page: x.page, z: x.z, text: l.type === 'text' ? String(l.text || '').slice(0, 200) : undefined, x: r2(l.x), y: r2(l.y), w: r2(l.w), h: r2(l.h), slot: l.type === 'image' && l.slot ? true : undefined, empty: l.type === 'image' && !l.src ? true : undefined, score: score };
    }
    if (q.id) return all.filter(function (x) { return x.l.id === q.id; }).map(function (x) { return out(x, 100); });
    var res = all;
    if (q.type) { var t = TYPE_SYN[q.type] || q.type; res = res.filter(function (x) { return x.l.type === t; }); }
    if (q.name) res = res.filter(function (x) { return String(x.l.name || '').toLowerCase().indexOf(String(q.name).toLowerCase()) >= 0; });
    if (q.text) res = res.filter(function (x) { return x.l.type === 'text' && String(x.l.text || '').toLowerCase().indexOf(String(q.text).toLowerCase()) >= 0; });
    if (!q.q) return res.map(function (x) { return out(x, 50); });
    var s = q.q.toLowerCase().trim();
    var exact = res.filter(function (x) { return x.l.id === q.q || String(x.l.name || '').toLowerCase() === s; });
    if (exact.length) return exact.map(function (x) { return out(x, 100); });
    var one = /^(the|a|an)\s+/.test(s);
    var allWord = /^(all|every)\s+(the\s+)?/.test(s);
    s = s.replace(/^(the|a|an|all|every)\s+(the\s+)?/, '').replace(/\s+(layers?|ones?)$/, '');
    var type = TYPE_SYN[s];
    var scored;
    if (/^(title|headline|heading|header|main text)$/.test(s)) {
      scored = res.filter(function (x) { return x.l.type === 'text'; }).map(function (x) {
        var named = /title|headline|heading/i.test(x.l.id + ' ' + (x.l.name || '')) ? 1000 : 0;
        return { x: x, sc: named + (x.l.size || 0) };
      }).sort(function (a, b) { return b.sc - a.sc; });
      if (scored.length) return (allWord ? scored : scored.slice(0, 1)).map(function (o) { return out(o.x, 90); });
    }
    if (/^(background|backdrop)$/.test(s)) return [{ id: '@background', type: 'background', page: p.activePage || 0, background: clone(p.pages[p.activePage || 0].background), hint: 'change it with { "op": "page.background", "background": "#14213D" }' }];
    if (type) {
      var list = res.filter(function (x) { return x.l.type === type; });
      if (type === 'image' && /slot/.test(s)) list = list.filter(function (x) { return x.l.slot; });
      return (one && !allWord ? list.slice(-1) : list).map(function (x) { return out(x, 80); });
    }
    scored = res.map(function (x) {
      var hay = (x.l.id + ' ' + (x.l.name || '') + ' ' + (x.l.type === 'text' ? x.l.text || '' : '')).toLowerCase();
      var sc = 0;
      s.split(/\s+/).forEach(function (tok) { if (tok && hay.indexOf(tok) >= 0) sc += 20; });
      return { x: x, sc: sc };
    }).filter(function (o) { return o.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; });
    return (one ? scored.slice(0, 1) : scored).map(function (o) { return out(o.x, o.sc); });
  }

  /* ---------- link channel (#ops=) ---------- */
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function streamBytes(bytes, t, cap) {
    var reader = new Blob([bytes]).stream().pipeThrough(t).getReader(), chunks = [], total = 0;
    function next() {
      return reader.read().then(function (r) {
        if (r.done) { var o = new Uint8Array(total), at = 0; chunks.forEach(function (c) { o.set(c, at); at += c.length; }); return o; }
        total += r.value.length;
        if (cap && total > cap) { reader.cancel().catch(function () {}); throw new Error('too large'); }
        chunks.push(r.value);
        return next();
      });
    }
    return next();
  }
  function canDeflate() { try { return typeof CompressionStream !== 'undefined' && !!new CompressionStream('deflate-raw'); } catch (e) { return false; } }
  function opsFromHash(h) {
    var m = /(?:^#|[#&])ops=([zj][A-Za-z0-9_-]+)/.exec(String(h || ''));
    return m ? m[1] : null;
  }
  function decodeOps(payload) {
    if (!payload || payload.length > 60000) return Promise.resolve({ ok: false, message: 'This assistant link is too large or damaged.' });
    var bytes;
    try { bytes = b64urlToBytes(payload.slice(1)); } catch (e) { return Promise.resolve({ ok: false, message: 'This assistant link is damaged.' }); }
    var raw = payload.charAt(0) === 'z' ? (canDeflate() ? streamBytes(bytes, new DecompressionStream('deflate-raw'), 2 * 1024 * 1024) : Promise.reject(new Error('This browser cannot open compressed links.'))) : Promise.resolve(bytes);
    return raw.then(function (out) {
      var text = new TextDecoder('utf-8', { fatal: true }).decode(out);
      var data = safeJson(text);
      if (Array.isArray(data)) data = { ops: data };
      if (!isObj(data) || !Array.isArray(data.ops) || !data.ops.length) return { ok: false, message: 'This assistant link has no operations.' };
      scan(data, '', 0);
      return { ok: true, ops: data.ops, name: str(data.name || data.agent || 'An assistant', 60), task: str(data.task || data.label || '', 200), label: str(data.label || '', 120) };
    }).catch(function (e) { return { ok: false, message: e instanceof AgentError ? e.message : 'This assistant link is damaged (' + String(e && e.message || e).slice(0, 80) + ').' }; });
  }
  function toLink(ops, o) {
    o = o || {};
    var json = JSON.stringify({ name: o.name, task: o.task, label: o.label, ops: ops });
    var bytes = new TextEncoder().encode(json);
    var base = o.base || (location.origin + location.pathname.replace(/[^/]*$/, ''));
    var make = canDeflate() && o.compress !== false ? streamBytes(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'z' + bytesToB64url(z); }) : Promise.resolve('j' + bytesToB64url(bytes));
    return make.then(function (payload) { return { ok: true, url: base + '?agent=1#ops=' + payload, payload: payload, chars: payload.length }; });
  }
  /* Human list of what a batch will do, for the confirmation sheet. */
  function describeOps(ops) {
    return (ops || []).slice(0, 40).map(function (op) {
      if (!isObj(op)) return 'Unreadable operation';
      var n = OP_ALIASES[op.op] || op.op;
      var L = op.layer || (op.layers && op.layers[0]) || {};
      switch (n) {
        case 'add': return op.layers && op.layers.length > 1 ? 'Add ' + op.layers.length + ' layers' : 'Add ' + (L.type === 'text' ? 'text “' + str(L.text, 40).replace(/^[“"']+|[”"']+$/g, '') + '”' : 'a ' + (L.type === 'icon' ? 'icon' : (TYPE_WORD[L.type] || ['layer'])[0]));
        case 'update': return 'Change ' + str(op.id || (op.ids || []).join(', '), 60) + (op.set ? ' (' + Object.keys(op.set).slice(0, 4).join(', ') + ')' : '');
        case 'remove': return 'Remove ' + str(op.id || (op.ids || []).join(', '), 60);
        case 'page.background': return 'Change the background';
        case 'page.add': return 'Add a page';
        case 'page.remove': return 'Remove page ' + str(op.page, 8);
        case 'page.resize': return 'Resize the page to ' + op.width + ' × ' + op.height;
        case 'replace': return op.page != null ? 'Replace page ' + str(op.page, 8) : 'Replace the whole design';
        case 'text.replace': return 'Replace “' + str(op.find, 30) + '” with “' + str(op.replace, 30) + '”';
        case 'image.fill': return 'Put an image into ' + str(op.id, 40) + (/^https?:/i.test(op.src || '') ? ' from ' + (function () { try { return new URL(op.src).host; } catch (e) { return 'the web'; } })() : '');
        case 'make': return 'Make a ' + str(op.maker || op.id, 30) + ' design';
        case 'collage': return 'Lay out a collage';
        case 'recipe': return 'Apply the ' + str(op.recipe, 30) + ' look to ' + str(op.id, 30);
        default: return str(n, 30) + (op.id ? ' ' + str(op.id, 40) : '');
      }
    });
  }

  /* ---------- public API ---------- */
  function normalizeOps(ops) {
    if (typeof ops === 'string') ops = safeJson(ops);
    if (isObj(ops) && Array.isArray(ops.ops)) ops = ops.ops;
    if (isObj(ops)) ops = [ops];
    if (!Array.isArray(ops)) throw err('invalid', 'apply takes a list of operations: [ { "op": "add", … }, … ].', '/ops');
    if (ops.length > LIMITS.opsPerBatch) throw err('too-large', 'Send at most ' + LIMITS.opsPerBatch + ' operations per batch.', '/ops');
    var json = JSON.stringify(ops);
    if (json.length > LIMITS.batchJson) throw err('too-large', 'This batch is larger than 12 MB. Use smaller images.', '/ops');
    scan(ops, '/ops', 0);
    return JSON.parse(json);
  }
  function apply(ops, o) {
    o = o || {};
    var bad = entry(true, true);
    if (bad) return Promise.resolve(bad);
    try { ops = normalizeOps(ops); } catch (e) { return Promise.resolve(fail(e.code || 'invalid', e.message, { errors: [{ op: -1, path: e.path || '', code: e.code || 'invalid', message: e.message }], applied: 0 })); }
    var s = A.session;
    if (A.paused && o.whenPaused === 'reject') return Promise.resolve(fail('paused', 'The person paused you (' + (A.pauseReason || 'paused') + '). Nothing was queued. Poll state().paused or wait for on("resume").'));
    return enqueue({ id: rid('b'), ops: ops, label: str(o.label, 120), partial: !!o.partial, ifRev: o.ifRev != null ? Number(o.ifRev) : null, knownRev: s.seenRev != null ? s.seenRev : A.rev, session: s, by: 'agent', source: 'agent', noWait: o.wait === false, allowEmpty: !!o.allowEmpty });
  }
  function applyExternal(docOrOps, o) {
    o = o || {};
    if (!C()) return Promise.resolve(fail('unsupported', 'The studio is still loading.'));
    var ops;
    try {
      if (typeof docOrOps === 'string') docOrOps = safeJson(docOrOps);
      ops = isObj(docOrOps) && (docOrOps.format === 'localeditor-design' || Array.isArray(docOrOps.pages)) ? [{ op: 'replace', design: docOrOps }] : normalizeOps(docOrOps);
      scan(ops, '/ops', 0);
    } catch (e) { return Promise.resolve(fail(e.code || 'invalid', e.message)); }
    return enqueue({ id: rid('b'), ops: ops, label: str(o.label || '', 120), partial: !!o.partial, ifRev: null, knownRev: A.rev, session: null, by: 'agent', source: str(o.source || 'external', 40), sourceName: str(o.name || o.source || 'Linked file', 60), ignoreConflicts: o.force === true });
  }
  function begin(o) {
    o = o || {};
    var name = str(o.name || 'Assistant', 40) || 'Assistant';
    var task = str(o.task || '', 200);
    if (!C()) return whenReady().then(function () { return begin(o); });
    if (A.session) {
      if (A.session.name === name) { if (task) A.session.task = task; return Promise.resolve(wrap({ ok: true, session: sessionInfo(), resumed: true, state: stateLite(), message: 'Your session is already active.' })); }
      return Promise.resolve(fail('consent', A.session.name + ' is already editing. Only one assistant at a time; ask the person to end that session first.'));
    }
    function start() {
      A.mode = true;
      A.askNext = false;
      A.ended = null;
      A.stopped = null;
      setPaused(false);
      syncP();
      A.session = { id: rid('s'), name: name, task: task, startedAt: now(), color: COLORS[0], batches: 0, seenRev: A.rev };
      A.newNotes = [];
      persist();
      emit('session', { active: true, session: sessionInfo() });
      return wrap({ ok: true, session: sessionInfo(), state: stateLite(), notes: project() ? notesList().filter(function (n) { return n.status === 'open'; }) : [], help: 'LEAgent.help() lists every operation. Read state(), apply small batches, check(), then end({ summary }).' });
    }
    if (HEADLESS || (A.mode && !A.askNext)) return Promise.resolve(start());
    if (!A.ui || !A.ui.askConsent) return Promise.resolve(fail('consent', 'Agent mode cannot be turned on here (the studio agent module is missing).'));
    if (!A.consentWait) {
      A.consentWait = A.ui.askConsent({ name: name, task: task }).then(function (yes) { A.consentWait = null; A.consentAnswer = yes ? 'yes' : 'no'; return yes; });
    }
    var waitMs = o.wait == null ? 120000 : Math.max(0, Math.min(600000, Number(o.wait) || 0));
    var timeout = new Promise(function (r) { setTimeout(function () { r('timeout'); }, waitMs); });
    return Promise.race([A.consentWait, timeout]).then(function (ans) {
      if (ans === 'timeout') return fail('consent', 'Waiting for the person to tap Allow in the studio. Ask them in chat, then call begin again (the request stays open).', { consentPending: true });
      if (!ans) return fail('consent', 'The person said no to agent mode for now. Do not ask again unless they tell you to.');
      return start();
    });
  }
  function end(o) {
    o = o || {};
    if (!A.session) return Promise.resolve(noSession());
    var s = A.session;
    var summary = str(o.summary || '', 400);
    finishSession('ended', summary);
    return Promise.resolve(wrap({ ok: true, ended: true, summary: summary, batches: s.batches }, null));
  }
  function finishSession(reason, summary) {
    var s = A.session;
    if (!s) return;
    var cancelled = stopAll(reason === 'taken-over' ? 'The person took over' : 'The session ended', 'no-session');
    A.session = null;
    A.ended = { reason: reason, at: now(), name: s.name, summary: summary || '', cancelled: cancelled };
    A.stopped = null;
    if (reason !== 'ended') A.askNext = true;
    setPaused(false);
    persist();
    emit('session', { active: false, reason: reason, summary: summary || '', name: s.name });
  }
  function state(o) {
    o = o || {};
    var bad = entry(false, true);
    if (bad) return Promise.resolve(bad);
    var p = syncP();
    var c = C();
    var res = {
      ok: true, version: VERSION, session: sessionInfo(), speed: A.speed, queued: A.queue.length + (A.running ? 1 : 0),
      design: p ? designOf(p) : null, page: p ? p.activePage || 0 : 0, pages: p ? pagesInfo(p) : [], selection: c.scene.selection(),
      fonts: fontsInfo(), problems: problems(), notes: p ? notesList(p).filter(function (n) { return n.status === 'open'; }) : [],
      catalogs: 'LEAgent.catalog(kind, q): fonts icons shapes recipes makers collages sizes patterns filters'
    };
    if (!p) res.hint = 'No design is open. apply() with { "op": "replace", "design": { … } } or { "op": "page.resize", … } starts one.';
    if (!o.image) return Promise.resolve(wrap(res));
    return pageImage(typeof o.image === 'number' ? o.image : 512).then(function (img) { res.image = img; return wrap(res); });
  }
  function check() {
    var bad = entry(false, true);
    if (bad) return Promise.resolve(bad);
    var p = syncP();
    if (!p) return Promise.resolve(wrap({ ok: true, problems: [], count: 0 }));
    var list = problems().map(function (pr) { var f = fixFor(pr, p); if (f) pr.fix = f; return pr; });
    return Promise.resolve(wrap({ ok: true, count: list.length, problems: list, clean: !list.length,
      next: list.length ? 'Apply the suggested "fix" operations (or better ones) in one batch, then check() again.' : 'No problems found. Look at state({ image: true }) once before you end.' }));
  }
  function exportImage(o) {
    o = o || {};
    var bad = entry(false, true);
    if (bad) return Promise.resolve(bad);
    var c = C(), p = syncP();
    if (!p) return Promise.resolve(fail('invalid', 'No design is open.'));
    var fmt = String(o.format || 'png').toLowerCase().replace('jpg', 'jpeg');
    if (['png', 'jpeg', 'webp', 'pdf'].indexOf(fmt) < 0) return Promise.resolve(fail('invalid', 'format is png, jpeg, webp or pdf.'));
    var scale = Math.max(0.05, Math.min(4, Number(o.scale) || 1));
    var opts = { format: fmt, scale: scale, pages: o.pages === 'all' ? 'all' : 'current', quality: o.quality || 0.92, transparent: !!o.transparent, dryRun: !o.download };
    if (o.download && fmt !== 'pdf' && opts.pages === 'all') opts.pages = 'all';
    return c.exportImage(opts).then(function (blob) {
      if (!blob) return fail('invalid', 'Export failed.');
      if (o.download) return wrap({ ok: true, downloaded: true, format: fmt, bytes: blob.size, message: 'The normal download started in the person’s browser.' });
      if (blob.size > LIMITS.exportBytes) return fail('too-large', 'The export is ' + Math.round(blob.size / 1048576) + ' MB; use a smaller scale or download: true.');
      return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); }).then(function (url) {
        var last = c.S.lastExport || {};
        return wrap({ ok: true, format: fmt, bytes: blob.size, width: last.width, height: last.height, dataUrl: url });
      });
    });
  }
  function notes(o) {
    o = o || {};
    var bad = entry(false, true);
    if (bad) return Promise.resolve(bad);
    var p = project();
    var list = p ? notesList(p) : [];
    if (o.status) list = list.filter(function (n) { return n.status === o.status; });
    A.newNotes = [];
    return Promise.resolve(wrap({ ok: true, notes: clone(list) }));
  }
  function resolveNote(id, reply) {
    var bad = entry(true, false);
    if (bad) return Promise.resolve(bad);
    if (isObj(id)) { reply = id.reply; id = id.id; }
    var r = typeof reply === 'string' ? str(reply, 1000) : '';
    var n = setNote(String(id || ''), Object.assign({ status: 'done', doneAt: now() }, r ? { reply: r } : {}));
    if (!n) return Promise.resolve(fail('invalid', 'No note ' + quote(id) + '. notes() lists them.'));
    emit('note-resolved', n);
    return Promise.resolve(wrap({ ok: true, note: clone(n) }));
  }
  function load(design, o) {
    o = o || {};
    if (HEADLESS && !A.session) return begin({ name: o.name || 'CLI', task: o.task || 'load' }).then(function () { return load(design, o); });
    if (o.resolve) A.config.resolve = o.resolve;
    return apply([{ op: 'replace', design: design, allowEmpty: o.allowEmpty !== false }], { label: o.label || 'Loaded a design file', partial: false }).then(function (res) {
      if (!res.ok) return res;
      return state({ image: !!o.image }).then(function (st) { st.loaded = true; st.summary = res.summary; st.batch = res.batch; st.warnings = res.warnings; return st; });
    });
  }
  function save(o) {
    o = o || {};
    var bad = entry(false, true);
    if (bad) return Promise.resolve(bad);
    var p = syncP();
    if (!p) return Promise.resolve(fail('invalid', 'No design is open.'));
    var images = ['embed', 'paths', 'ids', 'none'].indexOf(o.images) >= 0 ? o.images : 'embed';
    return LE.design.exportText(p, { images: images, blobs: A.blobs }).then(function (r) {
      var assets = (r.assets || []).map(function (a) { return { id: a.id, path: a.path, name: a.name, type: a.type, bytes: a.bytes, blob: a.blob }; });
      return Promise.all(assets.map(function (a) {
        if (!a.blob) { delete a.blob; return a; }
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { a.dataUrl = fr.result; delete a.blob; res(a); }; fr.readAsDataURL(a.blob); });
      })).then(function (list) { return wrap({ ok: true, text: r.text, bytes: r.bytes, images: images, assets: list, missing: r.missing || [] }); });
    });
  }
  function result(batchId) {
    var r = A.results[batchId];
    if (!r) {
      var q = A.queue.filter(function (b) { return b.id === batchId; })[0];
      if (q || (A.running && A.running.id === batchId)) return Promise.resolve(wrap({ ok: true, queued: true, batch: batchId, position: q ? A.queue.indexOf(q) + 1 : 0 }));
      return Promise.resolve(fail('invalid', 'No batch ' + quote(batchId) + '.'));
    }
    var i = A.unseen.indexOf(batchId);
    if (i >= 0) A.unseen.splice(i, 1);
    return Promise.resolve(wrap(clone(r)));
  }
  function feed() { return A.feed.map(publicFeedEntry); }

  /* Console channel: one JSON command → one JSON result (same as calling the method). */
  function command(input) {
    var cmd;
    try { cmd = typeof input === 'string' ? safeJson(input) : clone(input); } catch (e) { return Promise.resolve(fail('invalid', e instanceof AgentError ? e.message : 'That is not valid JSON. Example: {"op":"state"}')); }
    if (Array.isArray(cmd)) cmd = { op: 'apply', ops: cmd };
    if (!isObj(cmd) || typeof cmd.op !== 'string') return Promise.resolve(fail('invalid', 'A command is a JSON object with "op", for example {"op":"help"}, {"op":"begin","name":"Claude","task":"…"} or {"op":"apply","ops":[…]}.'));
    var o = cmd;
    switch (o.op) {
      case 'help': return Promise.resolve(help());
      case 'version': return Promise.resolve({ ok: true, version: VERSION, protocol: PROTOCOL });
      case 'begin': return begin(o);
      case 'end': return end(o);
      case 'state': return state(o);
      case 'apply': return apply(o.ops, o);
      case 'find': return Promise.resolve(findApi(o.query != null ? o.query : o.q != null ? o.q : o));
      case 'catalog': return catalog(o.kind, o.q, o);
      case 'check': return check();
      case 'export': return exportImage(o);
      case 'notes': return notes(o);
      case 'resolveNote': case 'resolve': return resolveNote(o.id, o.reply);
      case 'result': return result(o.batch);
      case 'save': return save(o);
      case 'load': return load(o.design, o);
      default:
        if (OPS[OP_ALIASES[o.op] || o.op]) return apply([o], {});
        return Promise.resolve(fail('invalid', 'Unknown command ' + quote(o.op) + '. Commands: help, begin, state, apply, find, catalog, check, export, notes, resolveNote, result, save, load, end — or any single operation (add, update, …).'));
    }
  }
  function findApi(q) {
    var bad = entry(false, true);
    if (bad) return bad;
    syncP();
    var list = find(q);
    return wrap({ ok: true, count: list.length, layers: list });
  }

  /* ---------- help: everything an agent needs, in one call ---------- */
  function help() {
    return {
      ok: true, protocol: PROTOCOL, version: VERSION, headless: HEADLESS,
      what: 'LocalEditor studio control API. One design = pages of layers, back to front, each with a readable id. You change it with batches of operations; each batch is one undo step, applied completely or not at all, and checked by the same safety gate as file imports. A person may be watching and can pause, stop, take over, undo, edit and leave you notes.',
      happyPath: [
        'await LEAgent.begin({ name: "Claude", task: "Launch post for the repo" })   // the person is asked once',
        'const s = await LEAgent.state({ image: true })   // design (open format), problems, notes, rev; image = PNG data URL',
        'await LEAgent.apply([ { op: "page.background", background: "#14213D" }, { op: "add", layer: { id: "title", type: "text", text: "Launch day", font: "Anton", size: 160, color: "#FFFFFF", x: "center", y: 120, w: "86%", h: 360, fit: "shrink", align: "center" } } ], { label: "Background and title" })',
        'const c = await LEAgent.check()   // problems with ready-made "fix" operations',
        'await LEAgent.apply(c.problems.map(p => p.fix).filter(Boolean), { label: "Fix problems" })',
        'await LEAgent.end({ summary: "Made a launch post" })'
      ],
      channels: {
        javascript: 'Evaluate window.LEAgent.<method>(…) in the page; every method returns a Promise of plain JSON.',
        console: 'No JavaScript? Open /studio/?agent=1, find the textbox labelled "Agent command", type one JSON command such as {"op":"state"} or {"op":"apply","ops":[…]}, press the "Run" button, then read the latest result in the "Agent result" region (role=log keeps a history).',
        link: '/studio/?agent=1#ops=<z|j><base64url of {"name","task","ops":[…]}> — the person sees what will change and must confirm. LEAgent.toLink(ops, { name, task }) builds one.',
        readable: 'In agent mode the page has a hidden "Design outline" list (one item per layer: id, type, text, position) and transparent buttons over the canvas with data-le-layer="<id>" so "click the title" selects it. Prefer the select operation.',
        headless: 'Set window.LE_AGENT_HEADLESS = true before the scripts load (the CLI does): no consent sheet, no animation, nothing saved to the person\'s designs. load(design) and save({ images }) move files in and out.'
      },
      methods: {
        'help()': 'This description.',
        'begin({ name, task, wait? })': 'Starts a visible session. Asks the person the first time (waits up to wait ms, default 120000; if unanswered returns code "consent" — call again). → { session, state }.',
        'end({ summary })': 'Ends your session; the person sees the summary.',
        'state({ image? })': '→ { design (open format, long form; images by asset id), page, pages, selection, fonts, problems, notes, rev, paused, queued, image? }. image: true or a max edge in px.',
        'apply(ops, { label?, ifRev?, partial?, whenPaused?: "queue"|"reject", wait? })': 'Applies a batch as ONE undo step. → { ok, applied, errors: [{ op, path, code, message }], summary, changed, problems, rev }. Invalid batch changes nothing unless partial: true. ifRev refuses a stale batch with the changes since. While paused the batch is queued and the call returns at once with queued: true.',
        'find(query)': 'Layers by id, name, type or text: "the title", "all photos", "photo slots", { type: "text", text: "sale" }. → { layers: [{ id, name, type, page, text, x, y, w, h }] }.',
        'catalog(kind, q?, { offset, limit })': 'Names and ids, paged. kinds: fonts, icons (needs q), shapes, recipes, makers, collages (q = photo count for layouts, or a style id for its templates), sizes, patterns, filters.',
        'check()': 'Problems (overflow, clipped, off-page, low-contrast, missing-image, unknown-font) with layer ids and a suggested fix operation each.',
        'export({ format: png|jpeg|webp|pdf, scale?, download? })': 'A data URL of the current page, or the normal download when download: true.',
        'notes({ status? }) / resolveNote(id, reply?)': 'The person\'s pinned notes { id, page, layer?, x, y, text, status, reply? }; mark one done with a short reply.',
        'on(event, fn) → unsubscribe': 'Events: note, notes, note-resolved, person-edit, change, pause, resume, stop, session, batch, feed, queue, undo.',
        'result(batchId)': 'The outcome of a queued batch.',
        'load(design, { resolve? }) / save({ images: embed|paths|ids|none })': 'Replace the document from an open-format file (one undo step) / write it out → { text, assets: [{ path, dataUrl }] }.',
        'applyExternal(docOrOps, { source, label })': 'For live links and local bridges: a whole design or ops from outside, shown in the feed like any batch, obeying pause and stop. No session needed.',
        'toLink(ops, { name, task })': 'Builds an #ops= link for agents that can only open URLs.'
      },
      operations: {
        add: { example: { op: 'add', layer: { id: 'badge', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 820, y: 60, w: 200, h: 200 } }, fields: 'layer (one) or layers (several, back to front); page?; at?: front|back|index|{ above: id }|{ below: id }; allowEmpty?' },
        update: { example: { op: 'update', id: 'title', set: { color: '#FFF3E2', size: 180, y: 'center' } }, fields: 'id or ids, set: open-format fields (shorthand allowed). null removes a field. Ids and types cannot change. h: "auto" re-measures text.' },
        remove: { example: { op: 'remove', ids: ['old-logo'] } },
        reorder: { example: { op: 'reorder', id: 'badge', to: 'front' }, fields: 'to: front|back|forward|backward|index|{ above: id }|{ below: id }' },
        group: { example: { op: 'group', ids: ['badge', 'badge-text'], groupId: 'badge-group', name: 'Badge' } },
        ungroup: { example: { op: 'ungroup', id: 'badge-group' } },
        align: { example: { op: 'align', ids: ['title', 'subtitle'], edge: 'center', relativeTo: 'page' }, fields: 'edge: left|center|right|top|middle|bottom; relativeTo: page|selection' },
        distribute: { example: { op: 'distribute', ids: ['a', 'b', 'c'], axis: 'h' } },
        select: { example: { op: 'select', ids: ['title'] } },
        'page.add': { example: { op: 'page.add', width: 1080, height: 1350, background: '#FFFFFF', layers: [], id: 'slide-2' }, fields: 'or { duplicate: <page> }. The new page becomes current.' },
        'page.remove': { example: { op: 'page.remove', page: 1 } },
        'page.resize': { example: { op: 'page.resize', width: 1080, height: 1920, scaleContent: true } },
        'page.background': { example: { op: 'page.background', background: { type: 'gradient', kind: 'linear', colors: ['#14213D', '#2F6BFF'], angle: 90 } }, fields: 'a colour, gradient, pattern { type: "pattern", id: "dots", fg, bg } or image { type: "image", src }' },
        'page.select': { example: { op: 'page.select', page: 0 } },
        replace: { example: { op: 'replace', design: { format: 'localeditor-design', version: 1, pages: [{ width: 1080, height: 1080, background: '#FFF3E2', layers: [] }] } }, fields: 'design: a whole open-format document (replaces every page), or with page: replaces only that page with design.pages[0].' },
        make: { example: { op: 'make', maker: 'quote', style: 'editorial', size: 'square', values: { quote: 'Ship small, ship often.', author: 'The team' } }, fields: 'Replaces the current page (or newPage: true). catalog("makers") lists ids, styles, sizes and inputs.' },
        recipe: { example: { op: 'recipe', id: 'hero', recipe: 'golden-hour', strength: 80 }, fields: 'recipe: null removes it. catalog("recipes").' },
        collage: { example: { op: 'collage', layout: 'r-2.3', count: 5, spacing: 16, margin: 40, radius: 18 }, fields: 'or template: <id>. Lays out the page\'s photo slots (creates count slots if there are none).' },
        'text.replace': { example: { op: 'text.replace', find: '2025', replace: '2026', page: 'all' } },
        'image.fill': { example: { op: 'image.fill', id: 'hero', src: 'data:image/jpeg;base64,…' }, fields: 'src: data:image URI (best), https:// URL (the person is asked, naming the host), or a relative path (the person picks the file).' },
        rename: { example: { op: 'rename', name: 'Launch post' } }
      },
      layers: {
        common: 'id (letters, digits, - _ . :), name, type: text|image|shape|icon|svg|path|group, x, y (number, "50%", left|center|right / top|center|bottom), w, h (number or "90%"), rotation, opacity 0–1, visible, locked, blend, shadow { color, blur, x, y }, groupId',
        text: 'text (\\n breaks lines), font (catalog fonts), weight 100–900, italic, size, color, fill (gradient), align left|center|right, lineHeight, letterSpacing, uppercase, underline, strike, stroke { width, color }, background (highlight pill), curve, fit: "shrink" (needs a fixed h). Leave h out to measure it.',
        image: 'src (data: URI, https URL with consent, asset id) or slot: true for an empty photo slot; fit cover|contain|stretch; crop; radius; border { width, color }; mask (shape id); adjust { brightness … }; filter; recipe',
        shape: 'shape (catalog shapes: rectangle rounded-rectangle ellipse star …), fill (colour or gradient; none unless given), stroke (colour or { width, color, dash }), radius, params',
        icon: 'icon: "lucide:sun" (catalog icons), color, strokeWidth, w (h follows)',
        path: 'points [[x, y, pressure?], …], width, color, mode pen|marker|highlighter',
        group: 'a box; members point at it with groupId'
      },
      errors: CODES,
      rules: [
        'Use ids for everything; give new layers short readable ids ("title", "hero-photo").',
        'Prefer shorthand positions ("center", "90%") over guessed pixels; let text fit: "shrink" inside a fixed box.',
        'Never guess fonts or icon ids: search catalog() first.',
        'Small batches with a label each, so the person can follow and undo one at a time.',
        'Read pending on every response: notes from the person, interruptions, results of queued batches, the person\'s edits since your last call.',
        'The person\'s edits always win. On code "conflict" read state() and re-plan; never re-send blindly.',
        'Never click consent, Allow, Pause, Stop or Take over buttons yourself; they belong to the person.',
        'No HTML, script or remote URLs in text. Images are data: URIs; remote URLs need the person\'s consent.',
        'Run check() after every few batches and fix what it reports; look at state({ image: true }) before end().'
      ],
      pacing: 'speed is set by the person: slow, normal or instant. In the browser apply() resolves after the change is shown, so slow pacing slows you down on purpose.',
      docs: { guide: '/docs/AGENT-GUIDE.md', format: '/docs/FORMAT-DESIGN.md', schema: '/schema/design-1.json', examples: '/examples/designs/' }
    };
  }

  /* ---------- person-side controls (used by le-studio-agent.js) ---------- */
  var person = {
    turnOn: function () { A.mode = true; A.askNext = false; persist(); emit('mode', { on: true }); },
    turnOff: function () { if (A.session) finishSession('off'); A.mode = false; A.askNext = true; stopAll('Agent mode was turned off', 'no-session'); setPaused(false); emit('mode', { on: false }); },
    pause: function (reason) { setPaused(true, reason || 'person'); },
    resume: function () { A.busyUntil = 0; setPaused(false); },
    stop: function () {
      var n = stopAll('The person stopped the session', 'interrupted');
      if (A.ui && A.ui.finish) A.ui.finish();
      A.stopped = { at: now(), reason: 'The person stopped the session', cancelled: n, reported: false };
      setPaused(false);
      emit('stop', { cancelled: n });
      return n;
    },
    takeOver: function () { finishSession('taken-over'); },
    activity: function (kind) {
      if (HEADLESS) return;
      A.busyUntil = now() + 700;
      if ((A.queue.length || A.running) && !A.paused) setPaused(true, 'person-editing');
    },
    setSpeed: function (s) { if (['slow', 'normal', 'instant'].indexOf(s) >= 0) { A.speed = s; persist(); emit('speed', { speed: s }); } },
    addNote: addNote, setNote: setNote, undoInfo: undoInfo, undoEntry: undoEntry, undoSession: undoSession, undoAllInfo: undoAllInfo,
    undoLastAndPause: function () {
      setPaused(true, 'person');
      var list = A.feed.filter(function (e) { return e.by === 'agent' && !e.undone; });
      var e = list[list.length - 1];
      if (!e) return Promise.resolve({ ok: false, message: 'Nothing to undo.' });
      var info = undoInfo(e.id);
      return undoEntry(e.id, info.selective ? 'selective' : 'toHere');
    }
  };

  /* ---------- Expert effects (LE.fx; docs/FX-AUTHORING.md "Agent plumbing") ----------
     One contained block. The operations are LE.fx.ops, run on the batch's working copy like every other operation, so they share
     its atomic commit, conflict checks, change feed and undo. Layers are named by id or unique name ("layer"); an effect entry by
     its id or, when the layer has only one of that kind, by its type ("id"). The renderer loads on first use. */
  var FX_OPS = { 'fx.add': 'layer', 'fx.update': 'layer', 'fx.remove': 'layer', 'fx.reorder': 'layer', 'mask.set': 'layer', 'transform.set': 'layer', 'adjust.add': 'above' };
  function fxLoad(path) {
    if (!LE.fxBoot) return Promise.reject(err('unsupported', 'Expert effects are not available on this page.', path));
    return LE.fxBoot.load().catch(function () { throw err('unsupported', 'The effect renderer could not be loaded.', path); });
  }
  Object.keys(FX_OPS).forEach(function (name) {
    OPS[name] = function (W, op, path, B) {
      var o = clone(op), key = FX_OPS[name], pi, hit = null;
      delete o.page;
      if (o[key] != null) { hit = findLayer(W, String(o[key]), op.page, path + '/' + key, B); pi = hit.page; o[key] = hit.layer.id; }
      else if (name === 'adjust.add') pi = pageIndex(W, op.page, path + '/page');
      else throw err('invalid', '"' + name + '" needs "layer": the id or name of a layer.', path + '/layer');
      return fxLoad(path).then(function (fx) {
        var r = fx.ops.apply(W.pages[pi], o);
        if (!r.ok) throw err('invalid', r.errors[0].message + (name === 'fx.add' && r.errors[0].code === 'unknown-type' ? ' See catalog("fx").' : ''), path + (r.errors[0].path || ''));
        W.pages[pi] = r.doc;
        if (name === 'adjust.add') { W.added = (W.added || []).concat([{ page: pi, id: r.id }]); touch(W, pi, r.id); return { added: [r.id], warnings: r.warnings }; }
        touch(W, pi, hit.layer.id);
        return { layer: hit.layer.id, id: r.id, warnings: r.warnings };
      });
    };
  });
  /* A page resized with its content: lengths that effects keep in document pixels (blur radii, mask blurs) follow. */
  var resizeBase = OPS['page.resize'];
  OPS['page.resize'] = function (W, op, path) {
    var pi = pageIndex(W, op.page, path + '/page'), page = W.pages[pi], w0 = page.width, h0 = page.height;
    var out = resizeBase(W, op, path);
    var expert = op.scaleContent !== false && layerList(page).filter(function (l) { return Array.isArray(l.fx) || l.layerMask; });
    if (!expert || !expert.length) return out;
    var k = (Math.abs(page.width / w0) + Math.abs(page.height / h0)) / 2;
    return fxLoad(path).then(function (fx) { expert.forEach(function (l) { fx.rescale(l, k); }); return out; }, function () { return out; });
  };
  /* LEAgent.analyze(target?, { region, kinds }): the numbers to grade by. target: nothing or "page" (the whole page), or a layer id or name. */
  function analyze(target, o) {
    if (isObj(target) && !o) { o = target; target = o.target != null ? o.target : o.layer; }
    o = o || {};
    var c = C();
    if (!c || !c.scene) return Promise.resolve(fail('invalid', 'No design is open.'));
    var layerId = null;
    if (target != null && target !== 'page' && target !== '') {
      var doc = c.scene.toJSON(), i = findOn(doc, String(target));
      if (i < 0) return Promise.resolve(fail('invalid', i === -2 ? 'More than one layer is named ' + quote(target) + '. Use its id.' : 'No layer ' + quote(target) + ' on this page. Layers: ' + (suggest(doc) || 'none') + '.'));
      layerId = doc.layers[i].id;
    }
    return fxLoad('').then(function (fx) {
      return fx.analyze(layerId ? { scene: c.scene, layer: layerId } : c.scene, { region: o.region, kinds: o.kinds });
    }).then(function (stats) { return { ok: true, target: layerId || 'page', stats: stats }; }, function (e) { return fail(e && e.code ? e.code : 'invalid', String(e && e.message || e).slice(0, 300)); });
  }
  /* catalog("fx"): the index; catalog("fx", "<effect id>"): one effect in full; "schema" and "actions" for the rest; any other word searches. */
  var catalogBase = catalog;
  catalog = function (kind, q, o) {
    var K = String(kind || '').toLowerCase();
    if (K !== 'fx' && K !== 'effects' && K !== 'effect') return catalogBase(kind, q, o);
    o = isObj(q) ? q : (o || {});
    if (isObj(q)) q = q.q;
    q = q == null ? '' : String(q).trim();
    return fxLoad('').then(function (fx) {
      if (q === 'schema') return { ok: true, kind: 'fx', schema: fx.schema() };
      if (q === 'actions') return { ok: true, kind: 'fx', actions: fx.actions.list() };
      var one = q ? fx.describe(q) : null;
      if (one) return { ok: true, kind: 'fx', effect: one };
      var items = fx.describe().filter(function (e) { return match(q, e.id + ' ' + e.name + ' ' + e.group + ' ' + e.section + ' ' + e.summary); });
      var out = paged('fx', items, o, null);
      out.hint = 'catalog("fx", "<id>") gives one effect in full (parameters, ranges, tips, an example entry); catalog("fx", "schema") the blends, mask kinds and limits.';
      return out;
    }, function (e) { return fail(e.code || 'unsupported', e.message); });
  };
  var commandBase = command;
  command = function (o) { return isObj(o) && o.op === 'analyze' ? analyze(o.target != null ? o.target : o.layer, o) : commandBase(o); };
  var helpBase = help;
  help = function () {
    var r = helpBase();
    try {
      r.methods = r.methods || {};
      r.methods['analyze(target?, { region, kinds })'] = 'Numbers to grade by: histogram and percentiles, clipping, white-balance estimate and suggestion, saturation, sharpness, hue. target: nothing (the page) or a layer id or name.';
      r.methods['catalog("fx", q?)'] = 'Expert effects: the index, or one effect in full by id; "schema" for blends, mask kinds and limits; "actions" for auto and import/export helpers.';
      r.operations = r.operations || {};
      r.operations['fx.add'] = { example: { op: 'fx.add', layer: 'photo', entry: { type: 'exposure', p: { ev: 0.4 } } }, fields: 'Adds an effect to a layer\'s stack (index optional). Types and parameters: catalog("fx").' };
      r.operations['fx.update'] = { example: { op: 'fx.update', layer: 'photo', id: 'exposure', p: { ev: 0.2 }, amount: 0.8 }, fields: 'id is the entry id, or its type when the layer has one of that kind. p is merged; on, amount, blend, mask can be set.' };
      r.operations['fx.remove'] = { example: { op: 'fx.remove', layer: 'photo', id: 'exposure' }, fields: 'Removes one entry.' };
      r.operations['fx.reorder'] = { example: { op: 'fx.reorder', layer: 'photo', id: 'grain', index: 0 }, fields: 'Moves an entry inside its stack; the first runs first.' };
      r.operations['mask.set'] = { example: { op: 'mask.set', layer: 'photo', fx: 'gaussian-blur', mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.4, rx: 0.3, ry: 0.3, feather: 0.5, invert: true }] } }, fields: 'Without fx it sets the layer mask; mask: null clears.' };
      r.operations['adjust.add'] = { example: { op: 'adjust.add', fx: [{ type: 'contrast', p: { amount: 15 } }], name: 'Grade', above: 'photo' }, fields: 'An adjustment layer over the page (or x, y, w, h); clip: true limits it to the layer below.' };
      r.operations['transform.set'] = { example: { op: 'transform.set', layer: 'photo', quad: [[0, 40], [1000, 0], [1000, 800], [0, 760]] }, fields: 'Perspective: four corners in page units; quad: null clears.' };
    } catch (e) { /* help keeps its own shape */ }
    return r;
  };

  window.LEAgent = {
    version: VERSION, protocol: PROTOCOL, headless: HEADLESS, codes: Object.keys(CODES),
    help: help, begin: begin, end: end, state: state, apply: apply, applyExternal: applyExternal,
    find: function (q) { return Promise.resolve(findApi(q)); }, catalog: catalog, check: check, export: exportImage,
    analyze: analyze, notes: notes, resolveNote: resolveNote, on: on, result: result, load: load, save: save, toLink: toLink, command: command,
    configure: function (o) { o = o || {}; if (typeof o.resolve === 'function') A.config.resolve = o.resolve; if (o.speed) person.setSpeed(o.speed); return { ok: true }; },
    get paused() { return A.paused; },
    get rev() { return A.rev; },
    _person: person,
    _internal: {
      A: A, register: function (ui) { A.ui = ui; }, feed: feed, feedEntry: function (id) { var e = feedEntry(id); return e ? publicFeedEntry(e) : null; }, entryThumb: function (id, url) { var e = feedEntry(id); if (e) e.thumb = url; },
      thumbOf: function (id) { var e = feedEntry(id); return e ? e.thumb : null; }, session: sessionInfo, notesList: function () { return project() ? notesList() : []; },
      describeOps: describeOps, decodeOps: decodeOps, opsFromHash: opsFromHash, initial: INITIAL, sync: sync, settle: settleKnown, find: find, markReady: markReady, isHeadless: HEADLESS,
      committing: function () { return A.committing; }, diffPages: diffPages, summarize: summarize, colorWord: colorWord
    }
  };

  /* Studio hooks: ready, person edits (debounced), notes and headless setup. */
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  function hook(name, fn) { (H[name] = H[name] || []).push(fn); }
  var syncSoon = (function () { var t; return function soon() { clearTimeout(t); t = setTimeout(function () { if (A.ui && A.ui.animating && A.ui.animating()) { soon(); return; } if (!A.committing) sync(); }, 350); }; })();
  hook('init', function (c) {
    if (HEADLESS) { c.S.noSave = true; document.documentElement.setAttribute('data-le-headless', ''); }
  });
  hook('ready', function () { settleKnown(); markReady(); });
  hook('change', function () { if (!A.committing && (A.mode || A.session || A.queue.length)) syncSoon(); });
  hook('page', function () { if (!A.committing && (A.mode || A.session || A.queue.length)) syncSoon(); });
  (P._cmds = P._cmds || {}).agentMode = function (c) { c.closePop(); if (A.ui && A.ui.openPanel) A.ui.openPanel(); };
})();
