/* LocalEditor: live link between a design file on disk and an open studio tab.
   Two halves in one file:
   1. LE.link core (pure, no DOM): applyOps / diff / merge on open-format documents (.ledesign.json). The command-line
      tools (tools/le-cli) load the same file in Node, so the tab, the CLI, the MCP server and the local API share one
      operation vocabulary.
   2. The tab client: when the studio is opened with ?link=<id> by `localeditor link` or `localeditor serve --open`,
      it loads the file, follows changes over Server-Sent Events and writes the person's edits back. */
(function (root, factory) {
  'use strict';
  var core = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = core;
  if (root && root.document) {
    var LE = root.LE = root.LE || {};
    LE.link = core;
    core._client(root);
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ helpers */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function same(a, b) { return canon(a) === canon(b); }
  var BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  var ID_RE = /^[\w:.-]{1,48}$/;
  var PAGE_KEYS = ['id', 'name', 'width', 'height', 'background', 'collage'];
  var DOC_KEYS = ['name', 'variables', 'remix', 'notes'];

  function OpError(code, message, path) { this.code = code; this.message = message; this.path = path || ''; }

  /* A page reference is an index (number) or a page id (string). */
  function pageAt(doc, ref, path) {
    var pages = doc.pages || [];
    if (ref == null) return 0;
    if (typeof ref === 'number') {
      if (ref >= 0 && ref < pages.length && Math.floor(ref) === ref) return ref;
      throw new OpError('not-found', 'There is no page ' + ref + ' (the design has ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + ', counted from 0).', path);
    }
    if (typeof ref === 'string') {
      for (var i = 0; i < pages.length; i++) if (pages[i] && pages[i].id === ref) return i;
      if (/^\d+$/.test(ref) && Number(ref) < pages.length) return Number(ref);
      throw new OpError('not-found', 'There is no page with the id "' + String(ref).slice(0, 48) + '".', path);
    }
    throw new OpError('invalid', '"page" is a page id or a page number.', path);
  }
  function findLayer(doc, id) {
    var pages = doc.pages || [];
    for (var p = 0; p < pages.length; p++) {
      var ls = (pages[p] && pages[p].layers) || [];
      for (var i = 0; i < ls.length; i++) if (ls[i] && ls[i].id === id) return { page: p, index: i, layer: ls[i] };
    }
    return null;
  }
  function layerOrFail(doc, id, path) {
    if (typeof id !== 'string' || !id) throw new OpError('invalid', 'Name the layer with "id".', path + '/id');
    var f = findLayer(doc, id);
    if (!f) throw new OpError('not-found', 'There is no layer with the id "' + id.slice(0, 48) + '". Use find or show to list ids.', path + '/id');
    return f;
  }
  function allIds(doc) {
    var ids = {};
    (doc.pages || []).forEach(function (p) { ((p && p.layers) || []).forEach(function (l) { if (l && l.id) ids[l.id] = 1; }); });
    return ids;
  }
  function freshId(doc, type) {
    var ids = allIds(doc);
    var base = String(type || 'layer').replace(/[^\w-]/g, '') || 'layer';
    for (var n = 1; n < 100000; n++) if (!ids[base + '-' + n]) return base + '-' + n;
    return base + '-' + Date.now();
  }
  function checkKeys(o, path) {
    if (Array.isArray(o)) { o.forEach(function (v, i) { checkKeys(v, path + '/' + i); }); return; }
    if (!isObj(o)) return;
    Object.keys(o).forEach(function (k) {
      if (BAD_KEYS[k]) throw new OpError('invalid', 'The key "' + k + '" is not allowed.', path + '/' + k);
      checkKeys(o[k], path + '/' + k);
    });
  }
  function setProps(target, set, path, protect) {
    if (!isObj(set)) throw new OpError('invalid', '"set" is an object of the fields to change; null removes a field.', path);
    Object.keys(set).forEach(function (k) {
      if (protect && protect.indexOf(k) >= 0) throw new OpError('invalid', 'The field "' + k + '" cannot be changed with this operation.', path + '/' + k);
      if (set[k] === null) delete target[k];
      else target[k] = clone(set[k]);
    });
  }

  var NOTE_KEYS = ['id', 'text', 'layer', 'page', 'x', 'y', 'status', 'by', 'at', 'reply'];
  function cleanNote(n, path) {
    if (!isObj(n)) throw new OpError('invalid', 'A note is an object { id, text, layer?, status }.', path);
    var o = {};
    Object.keys(n).forEach(function (k) { if (NOTE_KEYS.indexOf(k) < 0) throw new OpError('invalid', 'Notes have no field "' + String(k).slice(0, 32) + '".', path + '/' + k); });
    if (typeof n.id !== 'string' || !ID_RE.test(n.id)) throw new OpError('invalid', 'A note id uses letters, digits, "-", "_", "." or ":".', path + '/id');
    o.id = n.id;
    ['text', 'reply'].forEach(function (k) {
      if (n[k] == null) return;
      var s = String(n[k]);
      if (/<\s*\/?\s*[a-z!]/i.test(s) || /(javascript|vbscript)\s*:/i.test(s)) throw new OpError('invalid', 'Notes are plain text: no HTML and no script URLs.', path + '/' + k);
      o[k] = s.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, 2000);
    });
    if (!o.text) throw new OpError('invalid', 'A note needs "text".', path + '/text');
    if (n.layer != null) { if (typeof n.layer !== 'string' || !ID_RE.test(n.layer)) throw new OpError('invalid', 'note.layer is a layer id.', path + '/layer'); o.layer = n.layer; }
    if (n.page != null) { if (!(typeof n.page === 'number' || (typeof n.page === 'string' && ID_RE.test(n.page)))) throw new OpError('invalid', 'note.page is a page id or number.', path + '/page'); o.page = n.page; }
    ['x', 'y'].forEach(function (k) { if (n[k] != null) { if (typeof n[k] !== 'number' || !isFinite(n[k])) throw new OpError('invalid', 'note.' + k + ' is a number.', path + '/' + k); o[k] = Math.round(n[k] * 100) / 100; } });
    o.status = n.status === 'done' ? 'done' : 'open';
    if (n.by != null) o.by = n.by === 'agent' ? 'agent' : 'person';
    if (n.at != null) o.at = String(n.at).replace(/[^\dTZ:.+-]/g, '').slice(0, 40);
    return o;
  }
  function cleanNotes(list, path) {
    if (list == null) return null;
    if (!Array.isArray(list)) throw new OpError('invalid', '"notes" is a list.', path);
    if (list.length > 200) throw new OpError('too-large', 'A design keeps up to 200 notes.', path);
    var seen = {};
    return list.map(function (n, i) {
      var c = cleanNote(n, path + '/' + i);
      if (seen[c.id]) throw new OpError('invalid', 'The note id "' + c.id + '" is used twice.', path + '/' + i + '/id');
      seen[c.id] = 1;
      return c;
    });
  }

  /* ------------------------------------------------------------------ applyOps
     The operation vocabulary of agent mode (LEAgent.apply), applied to an open-format document. Ids are unique in
     the whole file, so a layer is found on any page; "page" (an index from 0 or a page id) narrows it. Operations
     that need the browser (make) are expanded by the caller before they reach here. */
  function pageOf(doc, op, path, ctx) { return op.page == null || op.page === 'current' || op.page === '' ? Math.min(ctx.active, doc.pages.length - 1) : pageAt(doc, op.page, path + '/page'); }
  function layerIn(doc, id, op, path, ctx) {
    var f = layerOrFail(doc, id, path);
    if (op.page != null && op.page !== 'current' && f.page !== pageAt(doc, op.page, path + '/page')) throw new OpError('not-found', 'The layer "' + id + '" is on page ' + f.page + ', not on page ' + op.page + '.', path);
    return f;
  }
  function idList(op, path) {
    var ids = Array.isArray(op.ids) ? op.ids : (op.id != null ? [op.id] : null);
    if (!ids || !ids.length) throw new OpError('invalid', 'Name the layer with "id" (or several with "ids").', path + '/id');
    return ids;
  }
  function pos(at, list, path) {
    /* "at": "back" | "front" | index | { above: id } | { below: id } */
    if (at == null || at === 'front') return list.length;
    if (at === 'back') return 0;
    if (typeof at === 'number') return Math.max(0, Math.min(list.length, Math.round(at)));
    if (isObj(at) && (at.above || at.below)) {
      var ref = at.above || at.below, j = -1;
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === ref) j = i;
      if (j < 0) throw new OpError('not-found', 'No layer "' + String(ref).slice(0, 48) + '" on that page to place next to.', path);
      return at.above ? j + 1 : j;
    }
    throw new OpError('invalid', '"at" is "front", "back", an index, or { "above": id } / { "below": id }.', path);
  }
  function placeOf(op) {
    if (op.at != null) return op.at;
    if (op.index != null) return op.index;
    if (op.before != null) return { below: op.before };
    if (op.after != null) return { above: op.after };
    if (op.to != null && op.to !== 'forward' && op.to !== 'backward') return op.to;
    return null;
  }
  function box(l) { return { x: Number(l.x) || 0, y: Number(l.y) || 0, w: Number(l.w) || 0, h: Number(l.h) || 0 }; }
  function numeric(l, path) { ['x', 'y', 'w', 'h'].forEach(function (k) { if (typeof l[k] !== 'number') throw new OpError('invalid', 'This operation needs numeric x, y, w and h on "' + l.id + '" (read the design again after it was normalised).', path); }); }
  function r2(v) { return Math.round(v * 100) / 100; }

  var OPS = {
    add: function (doc, op, path, ctx) {
      var list = Array.isArray(op.layers) ? op.layers : (isObj(op.layer) ? [op.layer] : null);
      if (!list && typeof op.type === 'string') { var one = clone(op); ['op', 'page', 'at', 'index', 'before', 'after'].forEach(function (k) { delete one[k]; }); list = [one]; }
      if (!list || !list.length) throw new OpError('invalid', '"add" needs "layer": { "id", "type", … } (or "layers": [ … ]).', path + '/layer');
      if (list.length > 600) throw new OpError('too-large', 'Add at most 600 layers in one operation.', path + '/layers');
      var p = pageOf(doc, op, path, ctx);
      var page = doc.pages[p];
      page.layers = page.layers || [];
      var at = pos(placeOf(op), page.layers, path + '/at');
      var made = list.map(function (src, i) {
        var lp = op.layers ? path + '/layers/' + i : path + '/layer';
        if (!isObj(src)) throw new OpError('invalid', 'A layer is an object with a "type".', lp);
        var l = clone(src);
        if (typeof l.type !== 'string') throw new OpError('invalid', 'The new layer needs a "type" (text, image, shape, icon, svg, path, group).', lp + '/type');
        if (l.id == null) l.id = freshId(doc, l.type);
        if (typeof l.id !== 'string' || !ID_RE.test(l.id)) throw new OpError('invalid', 'Layer ids use 1–48 letters, digits, "-", "_", "." or ":".', lp + '/id');
        if (findLayer(doc, l.id)) throw new OpError('invalid', 'The id "' + l.id + '" is already used. Use {"op":"update","id":"' + l.id + '","set":{…}} to change it, or choose a new id.', lp + '/id');
        page.layers.splice(at + i, 0, l);
        return l.id;
      });
      return { added: made, page: p };
    },
    update: function (doc, op, path, ctx) {
      var set = op.set != null ? op.set : (op.patch != null ? op.patch : op.props);
      if (set == null) { set = clone(op); ['op', 'id', 'ids', 'page'].forEach(function (k) { delete set[k]; }); }
      var ids = idList(op, path);
      ids.forEach(function (id, i) {
        var f = layerIn(doc, id, op, Array.isArray(op.ids) ? path + '/ids/' + i : path, ctx);
        if (isObj(set) && own(set, 'id') && set.id !== id) {
          if (ids.length > 1) throw new OpError('invalid', 'Rename one layer at a time.', path + '/set/id');
          if (typeof set.id !== 'string' || !ID_RE.test(set.id)) throw new OpError('invalid', 'Layer ids use 1–48 letters, digits, "-", "_", "." or ":".', path + '/set/id');
          if (findLayer(doc, set.id)) throw new OpError('invalid', 'The id "' + set.id + '" is already used.', path + '/set/id');
        }
        setProps(f.layer, set, path + '/set');
        if (!f.layer.id) f.layer.id = id;
      });
      return { updated: ids.length };
    },
    remove: function (doc, op, path, ctx) {
      var ids = idList(op, path);
      ids.forEach(function (id, i) {
        var f = layerIn(doc, id, op, Array.isArray(op.ids) ? path + '/ids/' + i : path, ctx);
        var page = doc.pages[f.page];
        var drop = {}; drop[id] = 1;
        var grew = true;
        while (grew) { grew = false; page.layers.forEach(function (l) { if (l.groupId && drop[l.groupId] && !drop[l.id]) { drop[l.id] = 1; grew = true; } }); }
        page.layers = page.layers.filter(function (l) { return !drop[l.id]; });
      });
      return { removed: ids };
    },
    reorder: function (doc, op, path, ctx) {
      var f = layerIn(doc, op.id, op, path, ctx);
      var target = op.toPage != null ? pageAt(doc, op.toPage, path + '/toPage') : f.page;
      doc.pages[f.page].layers.splice(f.index, 1);
      var list = doc.pages[target].layers = doc.pages[target].layers || [];
      var to = op.to != null ? op.to : op.position;
      var at;
      if (to === 'forward') at = Math.min(list.length, f.index + 1);
      else if (to === 'backward') at = Math.max(0, f.index - 1);
      else {
        var where = placeOf(op);
        if (where == null && target === f.page) { list.splice(f.index, 0, f.layer); throw new OpError('invalid', '"to" is front, back, forward, backward, an index, or { "above": id } / { "below": id }.', path + '/to'); }
        try { at = pos(where, list, path + '/to'); } catch (e) { doc.pages[f.page].layers.splice(f.index, 0, f.layer); throw e; }
      }
      list.splice(at, 0, f.layer);
      return { id: f.layer.id, page: target, index: at };
    },
    group: function (doc, op, path, ctx) {
      var ids = idList(op, path);
      if (ids.length < 2) throw new OpError('invalid', 'Group at least two layers.', path + '/ids');
      var hits = ids.map(function (id, i) { return layerIn(doc, id, op, path + '/ids/' + i, ctx); });
      var p = hits[0].page;
      if (hits.some(function (h) { return h.page !== p; })) throw new OpError('invalid', 'All layers in a group must be on the same page.', path + '/ids');
      hits.forEach(function (h) { numeric(h.layer, path); });
      var gid = op.groupId || op.as || freshId(doc, 'group');
      if (!ID_RE.test(gid) || findLayer(doc, gid)) throw new OpError('invalid', 'The group id "' + gid + '" is used or not valid.', path + '/groupId');
      var b = hits.map(function (h) { return box(h.layer); });
      var x0 = Math.min.apply(null, b.map(function (q) { return q.x; })), y0 = Math.min.apply(null, b.map(function (q) { return q.y; }));
      var x1 = Math.max.apply(null, b.map(function (q) { return q.x + q.w; })), y1 = Math.max.apply(null, b.map(function (q) { return q.y + q.h; }));
      var page = doc.pages[p];
      var first = Math.min.apply(null, hits.map(function (h) { return page.layers.indexOf(h.layer); }));
      page.layers.splice(first, 0, { id: gid, name: String(op.name || 'Group').slice(0, 120), type: 'group', x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) });
      hits.forEach(function (h) { h.layer.groupId = gid; });
      return { group: gid };
    },
    ungroup: function (doc, op, path, ctx) {
      var f = layerIn(doc, op.id, op, path, ctx);
      if (f.layer.type !== 'group') throw new OpError('invalid', '"' + f.layer.id + '" is not a group.', path + '/id');
      var page = doc.pages[f.page];
      page.layers.forEach(function (l) { if (l.groupId === f.layer.id) { if (f.layer.groupId) l.groupId = f.layer.groupId; else delete l.groupId; } });
      page.layers.splice(page.layers.indexOf(f.layer), 1);
      return {};
    },
    align: function (doc, op, path, ctx) {
      var ids = idList(op, path);
      var hits = ids.map(function (id, i) { return layerIn(doc, id, op, path + '/ids/' + i, ctx); });
      var edge = op.edge || op.to;
      if (['left', 'center', 'right', 'top', 'middle', 'bottom'].indexOf(edge) < 0) throw new OpError('invalid', '"edge" is left, center, right, top, middle or bottom.', path + '/edge');
      hits.forEach(function (h) { numeric(h.layer, path); });
      var page = doc.pages[hits[0].page];
      var rel = op.relativeTo || op.within || (hits.length < 2 ? 'page' : 'selection');
      var bs = hits.map(function (h) { return box(h.layer); });
      var B = rel === 'page' ? { x: 0, y: 0, w: page.width || 1080, h: page.height || 1080 } : (function () {
        var x0 = Math.min.apply(null, bs.map(function (q) { return q.x; })), y0 = Math.min.apply(null, bs.map(function (q) { return q.y; }));
        return { x: x0, y: y0, w: Math.max.apply(null, bs.map(function (q) { return q.x + q.w; })) - x0, h: Math.max.apply(null, bs.map(function (q) { return q.y + q.h; })) - y0 };
      })();
      hits.forEach(function (h, i) {
        var b = bs[i], l = h.layer;
        if (edge === 'left') l.x = r2(B.x); else if (edge === 'center') l.x = r2(B.x + (B.w - b.w) / 2); else if (edge === 'right') l.x = r2(B.x + B.w - b.w);
        else if (edge === 'top') l.y = r2(B.y); else if (edge === 'middle') l.y = r2(B.y + (B.h - b.h) / 2); else l.y = r2(B.y + B.h - b.h);
      });
      return {};
    },
    distribute: function (doc, op, path, ctx) {
      var ids = idList(op, path);
      if (ids.length < 3) throw new OpError('invalid', 'Distribute needs at least three layers.', path + '/ids');
      var v = op.axis === 'v' || op.axis === 'vertical' || op.axis === 'y';
      var items = ids.map(function (id, i) { var h = layerIn(doc, id, op, path + '/ids/' + i, ctx); numeric(h.layer, path); return h.layer; })
        .sort(function (a, b) { return v ? a.y - b.y : a.x - b.x; });
      var first = items[0], last = items[items.length - 1];
      var span = v ? last.y + last.h - first.y : last.x + last.w - first.x;
      var size = items.reduce(function (s, l) { return s + (v ? l.h : l.w); }, 0);
      var gap = (span - size) / (items.length - 1);
      var at = v ? first.y : first.x;
      items.forEach(function (l) { if (v) l.y = r2(at); else l.x = r2(at); at += (v ? l.h : l.w) + gap; });
      return {};
    },
    select: function () { return { ignored: 'selection has no meaning without a screen' }; },
    'page.select': function (doc, op, path, ctx) { ctx.active = pageAt(doc, op.page, path + '/page'); return { page: ctx.active }; },
    'page.add': function (doc, op, path, ctx) {
      if (doc.pages.length >= 50) throw new OpError('too-large', 'A design can have up to 50 pages.', path);
      var cur = doc.pages[Math.min(ctx.active, doc.pages.length - 1)] || {};
      var pg;
      if (op.duplicate != null) {
        pg = clone(doc.pages[pageAt(doc, op.duplicate, path + '/duplicate')]);
        delete pg.id;
        var taken = allIds(doc);
        (pg.layers || []).forEach(function (l) { var base = l.id, n = 2; while (taken[base + '-' + n]) n++; var nid = (base + '-' + n).slice(0, 48); taken[nid] = 1; (pg.layers || []).forEach(function (m) { if (m.groupId === l.id) m.groupId = nid; }); l.id = nid; });
      } else if (isObj(op.page)) pg = clone(op.page);
      else {
        pg = { width: op.width || cur.width || 1080, height: op.height || cur.height || 1080, background: op.background != null ? clone(op.background) : (typeof cur.background === 'string' ? cur.background : '#ffffff'), layers: clone(op.layers || []) };
      }
      var pid = op.id != null ? op.id : pg.id;
      if (pid != null) {
        if (typeof pid !== 'string' || !ID_RE.test(pid)) throw new OpError('invalid', 'Page ids use letters, digits, "-", "_", "." or ":".', path + '/id');
        if (doc.pages.some(function (p) { return p.id === pid; })) throw new OpError('invalid', 'The page id "' + pid + '" is already used.', path + '/id');
        pg = Object.assign({ id: pid }, pg); pg.id = pid;
      }
      var ids = allIds(doc);
      (pg.layers || []).forEach(function (l, i) { if (l && l.id && ids[l.id]) throw new OpError('invalid', 'The id "' + l.id + '" is already used.', path + '/layers/' + i + '/id'); });
      var where = op.at != null ? op.at : op.index;
      var at = where == null ? Math.min(doc.pages.length, ctx.active + 1) : Math.max(0, Math.min(doc.pages.length, Math.floor(Number(where) || 0)));
      doc.pages.splice(at, 0, pg);
      ctx.active = at;
      return { page: at };
    },
    'page.update': function (doc, op, path, ctx) {
      var p = pageOf(doc, op, path, ctx);
      var set = op.set != null ? op.set : op.props;
      if (isObj(set)) Object.keys(set).forEach(function (k) { if (PAGE_KEYS.indexOf(k) < 0) throw new OpError('invalid', 'Pages have no field "' + String(k).slice(0, 32) + '" (use ' + PAGE_KEYS.join(', ') + ').', path + '/set/' + k); });
      if (isObj(set) && own(set, 'id') && set.id !== null && set.id !== doc.pages[p].id && doc.pages.some(function (q) { return q.id === set.id; })) throw new OpError('invalid', 'The page id "' + set.id + '" is already used.', path + '/set/id');
      setProps(doc.pages[p], set, path + '/set');
      return { page: p };
    },
    'page.remove': function (doc, op, path, ctx) {
      if (doc.pages.length < 2) throw new OpError('invalid', 'A design needs at least one page.', path);
      var p = pageOf(doc, op, path, ctx);
      doc.pages.splice(p, 1);
      ctx.active = Math.min(ctx.active > p ? ctx.active - 1 : ctx.active, doc.pages.length - 1);
      return { page: p };
    },
    'page.move': function (doc, op, path, ctx) {
      var p = pageOf(doc, op, path, ctx);
      var to = op.index != null ? op.index : op.to;
      if (typeof to !== 'number') throw new OpError('invalid', '"page.move" needs "index".', path + '/index');
      var pg = doc.pages.splice(p, 1)[0];
      var at = Math.max(0, Math.min(doc.pages.length, Math.floor(to)));
      doc.pages.splice(at, 0, pg);
      return { page: at };
    },
    'page.resize': function (doc, op, path, ctx) {
      var p = pageOf(doc, op, path, ctx);
      var page = doc.pages[p];
      ['width', 'height'].forEach(function (k) { if (typeof op[k] !== 'number' || op[k] < 16 || op[k] > 20000) throw new OpError('invalid', k + ' must be a number of pixels from 16 to 20000.', path + '/' + k); });
      var W0 = page.width || 1080, H0 = page.height || 1080;
      var sx = op.width / W0, sy = op.height / H0, k = (Math.abs(sx) + Math.abs(sy)) / 2;
      if (op.scaleContent !== false) {
        (page.layers || []).forEach(function (l) {
          ['x', 'w'].forEach(function (q) { if (typeof l[q] === 'number') l[q] = r2(l[q] * sx); });
          ['y', 'h'].forEach(function (q) { if (typeof l[q] === 'number') l[q] = r2(l[q] * sy); });
          if (l.type === 'text' && typeof l.size === 'number') l.size = Math.max(1, r2(l.size * k));
          if (l.type === 'path' && Array.isArray(l.points)) { l.points.forEach(function (pt) { pt[0] = r2(pt[0] * sx); pt[1] = r2(pt[1] * sy); }); if (typeof l.width === 'number') l.width = r2(l.width * k); }
        });
      }
      page.width = Math.round(op.width); page.height = Math.round(op.height);
      return { page: p };
    },
    'page.background': function (doc, op, path, ctx) {
      var p = pageOf(doc, op, path, ctx);
      var bg = op.background != null ? op.background : op.color;
      if (bg == null) throw new OpError('invalid', 'Give "background": a colour like "#14213D", or a gradient / pattern / image object.', path + '/background');
      doc.pages[p].background = clone(bg);
      return { page: p };
    },
    replace: function (doc, op, path, ctx) {
      var d = op.design != null ? op.design : op.document;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw new OpError('invalid', '"design" is not valid JSON.', path + '/design'); } }
      if (!isObj(d)) throw new OpError('invalid', '"replace" needs "design": an open-format document { "format": "localeditor-design", "version": 1, "pages": [ … ] }.', path + '/design');
      if (op.page != null) {
        var p = pageAt(doc, op.page, path + '/page');
        var pg = Array.isArray(d.pages) ? d.pages[0] : d;
        if (!isObj(pg)) throw new OpError('invalid', 'Replacing one page needs a design with one page (or a page object).', path + '/design');
        var others = allIds({ pages: doc.pages.filter(function (x, i) { return i !== p; }) });
        (pg.layers || []).forEach(function (l, i) { if (l && others[l.id]) throw new OpError('invalid', 'The id "' + l.id + '" is used on another page.', path + '/design/pages/0/layers/' + i + '/id'); });
        var keep = doc.pages[p].id;
        doc.pages[p] = clone(pg);
        if (keep && doc.pages[p].id == null) doc.pages[p].id = keep;
        return { page: p };
      }
      Object.keys(doc).forEach(function (k) { delete doc[k]; });
      Object.keys(d).forEach(function (k) { doc[k] = clone(d[k]); });
      if (!doc.format) doc.format = 'localeditor-design';
      if (doc.version == null) doc.version = 1;
      if (!Array.isArray(doc.pages)) doc.pages = [];
      ctx.active = 0;
      return {};
    },
    rename: function (doc, op, path) {
      var n = String(op.name == null ? '' : op.name).replace(/[<>]/g, '').trim().slice(0, 160);
      if (!n) throw new OpError('invalid', '"name" is the design name (plain text).', path + '/name');
      doc.name = n;
      return {};
    },
    'text.replace': function (doc, op, path, ctx) {
      if (typeof op.find !== 'string' || !op.find) throw new OpError('invalid', '"find" is the text to look for.', path + '/find');
      if (typeof op.replace !== 'string') throw new OpError('invalid', '"replace" is the new text (it can be "").', path + '/replace');
      var pages = op.page === 'all' ? doc.pages.map(function (x, i) { return i; }) : [pageOf(doc, op, path, ctx)];
      var only = op.ids ? (Array.isArray(op.ids) ? op.ids : [op.ids]) : null;
      var rx = new RegExp(op.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), op.matchCase ? 'g' : 'gi');
      var hit = [];
      pages.forEach(function (p) {
        (doc.pages[p].layers || []).forEach(function (l) {
          if (l.type !== 'text' || (only && only.indexOf(l.id) < 0 && only.indexOf(l.name) < 0)) return;
          var t = String(l.text || '');
          var n = t.replace(rx, function () { return op.replace; });
          if (n !== t) { l.text = n; hit.push(l.id); }
        });
      });
      if (!hit.length) throw new OpError('invalid', 'No text contains "' + op.find.slice(0, 60) + '".', path + '/find');
      return { replaced: hit.length, ids: hit };
    },
    'image.fill': function (doc, op, path, ctx) {
      var f = layerIn(doc, op.id, op, path, ctx);
      if (f.layer.type !== 'image') throw new OpError('invalid', '"' + f.layer.id + '" is a ' + f.layer.type + ' layer; image.fill needs an image layer or photo slot.', path + '/id');
      if (typeof op.src !== 'string' || !op.src) throw new OpError('invalid', '"src" is a data:image/… URI, an https:// URL, or a path relative to the design file.', path + '/src');
      f.layer.src = op.src;
      delete f.layer.crop;
      if (op.fit) f.layer.fit = op.fit;
      return { id: f.layer.id };
    },
    recipe: function (doc, op, path, ctx) {
      var f = layerIn(doc, op.id, op, path, ctx);
      if (f.layer.type !== 'image') throw new OpError('invalid', 'Recipes apply to image layers.', path + '/id');
      if (op.recipe === null) { delete f.layer.recipe; return {}; }
      if (typeof op.recipe !== 'string') throw new OpError('invalid', '"recipe" is a recipe id (see catalog recipes).', path + '/recipe');
      f.layer.recipe = op.strength != null ? { id: op.recipe, strength: op.strength } : op.recipe;
      return { id: f.layer.id };
    },
    collage: function (doc, op, path, ctx) {
      var p = pageOf(doc, op, path, ctx);
      var page = doc.pages[p];
      var meta = {};
      ['layout', 'template', 'count', 'spacing', 'margin', 'radius', 'border', 'aspect'].forEach(function (k) { if (op[k] != null) meta[k] = clone(op[k]); });
      if (!meta.layout && !meta.template && !meta.count) throw new OpError('invalid', '"collage" needs "layout" (e.g. "r-2.3"), "template" or "count".', path);
      page.collage = meta;
      page.layers = (page.layers || []).filter(function (l) { return !(meta.template && l.type === 'image' && l.slot); }).map(function (l) {
        if (l.type === 'image' && l.slot) { delete l.x; delete l.y; delete l.w; delete l.h; delete l.crop; }
        return l;
      });
      return { page: p };
    },
    'doc.update': function (doc, op, path) {
      var set = op.set != null ? op.set : op.props;
      if (isObj(set)) Object.keys(set).forEach(function (k) { if (DOC_KEYS.indexOf(k) < 0) throw new OpError('invalid', 'The document has no field "' + String(k).slice(0, 32) + '" here (use ' + DOC_KEYS.join(', ') + ').', path + '/set/' + k); });
      if (isObj(set) && own(set, 'notes') && set.notes !== null) set = Object.assign({}, set, { notes: cleanNotes(set.notes, path + '/set/notes') });
      setProps(doc, set, path + '/set');
      return {};
    },
    'note.add': function (doc, op, path) {
      var n = Object.assign({ status: 'open', by: 'agent' }, isObj(op.note) ? op.note : { text: op.text, layer: op.layer, page: op.page });
      Object.keys(n).forEach(function (k) { if (n[k] === undefined) delete n[k]; });
      doc.notes = doc.notes || [];
      if (n.id == null) { var k = 1; while (doc.notes.some(function (x) { return x.id === 'note-' + k; })) k++; n.id = 'note-' + k; }
      if (doc.notes.some(function (x) { return x.id === n.id; })) throw new OpError('invalid', 'The note id "' + n.id + '" is already used.', path + '/note/id');
      if (doc.notes.length >= 200) throw new OpError('too-large', 'A design keeps up to 200 notes.', path);
      doc.notes.push(cleanNote(n, path + '/note'));
      return { note: n.id };
    },
    'note.resolve': function (doc, op, path) {
      var list = doc.notes || [];
      var n = list.filter(function (x) { return x.id === op.id; })[0];
      if (!n) throw new OpError('not-found', 'There is no note "' + String(op.id).slice(0, 48) + '".', path + '/id');
      n.status = op.status === 'open' ? 'open' : 'done';
      if (op.reply != null) n.reply = cleanNote({ id: n.id, text: 'x', reply: op.reply }, path).reply;
      return { note: n.id };
    }
  };
  var ALIASES = { 'add-layer': 'add', set: 'update', patch: 'update', delete: 'remove', move: 'reorder', order: 'reorder', background: 'page.background',
    'replace-text': 'text.replace', fill: 'image.fill', 'add-page': 'page.add', 'update-page': 'page.update', 'remove-page': 'page.remove', 'resolve-note': 'note.resolve' };

  /* applyOps(doc, ops, { partial }) → { ok, doc, results: [{ index, op, ok, id?, page?, code?, message?, path? }], errors, applied }
     Atomic by default: any failure leaves the input untouched and ok false. With partial: true the operations that
     work are kept and the failures are listed. The input document is never mutated. */
  function applyOps(doc, ops, opts) {
    opts = opts || {};
    if (isObj(ops) && Array.isArray(ops.ops)) ops = ops.ops;
    if (isObj(ops) && typeof ops.op === 'string') ops = [ops];
    var out = { ok: true, doc: null, results: [], errors: [], applied: 0 };
    if (!Array.isArray(ops)) { out.ok = false; out.errors.push({ index: -1, code: 'invalid', message: 'Operations are a JSON list: [ { "op": "add", … }, … ].', path: '' }); return out; }
    if (ops.length > 2000) { out.ok = false; out.errors.push({ index: -1, code: 'too-large', message: 'Up to 2000 operations per batch.', path: '' }); return out; }
    if (!isObj(doc)) doc = { pages: [] };
    var work = clone(doc);
    if (!Array.isArray(work.pages)) work.pages = [];
    var ctx = { active: Math.max(0, Number(opts.page) || 0) };
    var stop = false;
    ops.forEach(function (op, i) {
      if (stop) return;
      var path = '/ops/' + i;
      var name = isObj(op) && typeof op.op === 'string' ? (ALIASES[op.op] || op.op) : null;
      var before = opts.partial ? JSON.stringify(work) : null;
      try {
        if (!name) throw new OpError('invalid', 'Each operation is an object with "op".', path);
        if (!own(OPS, name)) throw new OpError('invalid', 'Unknown operation "' + String(op.op).slice(0, 32) + '". Use one of: ' + Object.keys(OPS).join(', ') + '.', path + '/op');
        checkKeys(op, path);
        var r = OPS[name](work, op, path, ctx) || {};
        r.index = i; r.op = name; r.ok = true;
        out.results.push(r);
        out.applied++;
      } catch (e) {
        var err = e instanceof OpError ? e : new OpError('invalid', String((e && e.message) || e), path);
        var rec = { index: i, op: name || null, ok: false, code: err.code, message: err.message, path: err.path };
        out.results.push(rec);
        out.errors.push(rec);
        if (opts.partial && before) work = JSON.parse(before);
        if (!opts.partial) stop = true;
      }
    });
    if (out.errors.length && !opts.partial) { out.ok = false; out.doc = null; out.applied = 0; return out; }
    out.ok = !out.errors.length;
    out.doc = work;
    return out;
  }

  /* ------------------------------------------------------------------ diff */
  function pageKey(p, i) { return p && p.id ? 'id:' + p.id : '#' + i; }
  function layerSet(a, b) {
    var set = {};
    Object.keys(b).forEach(function (k) { if (k !== 'id' && !same(a[k], b[k])) set[k] = clone(b[k]); });
    Object.keys(a).forEach(function (k) { if (k !== 'id' && !own(b, k)) set[k] = null; });
    return set;
  }
  /* diff(a, b) → the operations that turn document a into b, addressed by page and layer id. */
  function diff(a, b) {
    var ops = [];
    a = a || { pages: [] }; b = b || { pages: [] };
    var dset = {};
    DOC_KEYS.forEach(function (k) { if (!same(a[k], b[k])) dset[k] = b[k] === undefined ? null : clone(b[k]); });
    if (Object.keys(dset).length) ops.push({ op: 'doc.update', set: dset });
    var ap = a.pages || [], bp = b.pages || [];
    var bKeys = bp.map(pageKey), aKeys = ap.map(pageKey);
    /* Without page ids, pages are matched by position. */
    var cur = ap.map(function (p, i) { return { key: aKeys[i], page: p }; });
    for (var i = cur.length - 1; i >= 0; i--) {
      if (bKeys.indexOf(cur[i].key) < 0) { ops.push({ op: 'page.remove', page: cur[i].page.id || i }); cur.splice(i, 1); }
    }
    /* After removals, indexes of later pages shift; emit page refs by id when there is one. */
    bp.forEach(function (pb, j) {
      var k = bKeys[j];
      var at = -1;
      for (var x = 0; x < cur.length; x++) if (cur[x].key === k) at = x;
      if (at < 0) {
        ops.push({ op: 'page.add', index: j, page: clone(pb) });
        cur.splice(j, 0, { key: k, page: clone(pb), fresh: true });
        return;
      }
      if (at !== j) { ops.push({ op: 'page.move', page: cur[at].page.id || at, index: j }); var mv = cur.splice(at, 1)[0]; cur.splice(j, 0, mv); }
    });
    cur.forEach(function (c, j) {
      if (c.fresh) return;
      var pa = c.page, pb = bp[j];
      var ref = pb.id || j;
      var pset = {};
      PAGE_KEYS.forEach(function (k) { if (k !== 'id' && !same(pa[k], pb[k])) pset[k] = pb[k] === undefined ? null : clone(pb[k]); });
      if (Object.keys(pset).length) ops.push({ op: 'page.update', page: ref, set: pset });
      var la = (pa.layers || []).slice(), lb = pb.layers || [];
      var bIds = lb.map(function (l) { return l.id; });
      var aById = {};
      la.forEach(function (l) { aById[l.id] = l; });
      for (var r = la.length - 1; r >= 0; r--) if (bIds.indexOf(la[r].id) < 0) { ops.push({ op: 'remove', id: la[r].id }); la.splice(r, 1); }
      lb.forEach(function (l, idx) {
        if (!aById[l.id]) {
          var elsewhere = null;
          (a.pages || []).forEach(function (pp, pi) { if (pi !== j || true) ((pp && pp.layers) || []).forEach(function (x) { if (x.id === l.id && pp !== pa) elsewhere = x; }); });
          if (elsewhere) ops.push({ op: 'remove', id: l.id });
          ops.push({ op: 'add', page: ref, index: idx, layer: clone(l) });
          la.splice(idx, 0, l);
        }
      });
      lb.forEach(function (l, idx) {
        var at = -1;
        for (var q = 0; q < la.length; q++) if (la[q].id === l.id) at = q;
        if (at !== idx) { ops.push({ op: 'move', id: l.id, index: idx }); var m = la.splice(at, 1)[0]; la.splice(idx, 0, m); }
        var old = aById[l.id];
        if (old) { var s = layerSet(old, l); if (Object.keys(s).length) ops.push({ op: 'update', id: l.id, set: s }); }
      });
    });
    return ops;
  }

  /* ------------------------------------------------------------------ merge */
  function byId(list) { var m = {}; (list || []).forEach(function (l) { if (l && l.id) m[l.id] = l; }); return m; }
  function mergeOrder(base, ours, theirs) {
    var bo = base.map(function (l) { return l.id; }), oo = ours.map(function (l) { return l.id; }), to = theirs.map(function (l) { return l.id; });
    var primary = same(oo.filter(function (x) { return bo.indexOf(x) >= 0; }), bo.filter(function (x) { return oo.indexOf(x) >= 0; })) && !same(to, bo) ? to : oo;
    var secondary = primary === to ? oo : to;
    var out = primary.slice();
    secondary.forEach(function (id, i) {
      if (out.indexOf(id) >= 0) return;
      var prev = null;
      for (var k = i - 1; k >= 0; k--) if (out.indexOf(secondary[k]) >= 0) { prev = secondary[k]; break; }
      out.splice(prev == null ? 0 : out.indexOf(prev) + 1, 0, id);
    });
    return out;
  }
  /* merge(base, ours, theirs) — three-way, per layer. "ours" is the person (the tab), "theirs" the agent (the file).
     Different layers merge; when both sides changed the same layer the person's version wins and the agent's is
     returned in conflicts so it can be reported. → { doc, conflicts: [{ page, layer, kind, agent, person }] } */
  function merge(base, ours, theirs) {
    base = base || { pages: [] };
    if (same(ours, theirs)) return { doc: clone(ours), conflicts: [] };
    if (same(base, ours)) return { doc: clone(theirs), conflicts: [] };
    if (same(base, theirs)) return { doc: clone(ours), conflicts: [] };
    var conflicts = [];
    var doc = {};
    var keys = {};
    [base, ours, theirs].forEach(function (d) { Object.keys(d || {}).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      if (k === 'pages' || k === 'notes') return;
      var v = !same(base[k], ours[k]) ? ours[k] : theirs[k];
      if (v !== undefined) doc[k] = clone(v);
    });
    /* Notes: union by id; "done" wins. */
    var notes = {}, order = [];
    [base.notes, theirs.notes, ours.notes].forEach(function (list) { (list || []).forEach(function (n) { if (!notes[n.id]) order.push(n.id); var prev = notes[n.id]; notes[n.id] = clone(n); if (prev && prev.status === 'done') notes[n.id].status = 'done'; if (prev && prev.reply && !notes[n.id].reply) notes[n.id].reply = prev.reply; }); });
    var removedNotes = {};
    (base.notes || []).forEach(function (n) {
      var inO = (ours.notes || []).some(function (x) { return x.id === n.id; }), inT = (theirs.notes || []).some(function (x) { return x.id === n.id; });
      if (!inO || !inT) removedNotes[n.id] = 1;
    });
    var nl = order.filter(function (id) { return !removedNotes[id]; }).map(function (id) { return notes[id]; });
    if (nl.length) doc.notes = nl;

    var bp = base.pages || [], op = ours.pages || [], tp = theirs.pages || [];
    var bk = bp.map(pageKey), ok = op.map(pageKey), tk = tp.map(pageKey);
    var pageKeys = mergeOrder(bk.map(function (k) { return { id: k }; }), ok.map(function (k) { return { id: k }; }), tk.map(function (k) { return { id: k }; }));
    doc.pages = [];
    pageKeys.forEach(function (k) {
      var b = bp[bk.indexOf(k)], o = op[ok.indexOf(k)], t = tp[tk.indexOf(k)];
      if (b && (!o || !t)) {
        /* Removed on one side: kept only if the other side changed it. */
        var survivor = o || t;
        if (!survivor || same(survivor, b)) return;
        if (!o) { conflicts.push({ page: k, layer: null, kind: 'page-removed-by-person', agent: clone(t) }); return; }
      }
      if (!b) { doc.pages.push(clone(o || t)); return; }
      var page = {};
      var pk = {};
      [b, o, t].forEach(function (x) { Object.keys(x || {}).forEach(function (kk) { pk[kk] = 1; }); });
      Object.keys(pk).forEach(function (kk) {
        if (kk === 'layers') return;
        var v = !same(b[kk], o[kk]) ? o[kk] : t[kk];
        if (!same(b[kk], o[kk]) && !same(b[kk], t[kk]) && !same(o[kk], t[kk])) conflicts.push({ page: k, layer: null, field: kk, kind: 'both-changed', agent: clone(t[kk]), person: clone(o[kk]) });
        if (v !== undefined) page[kk] = clone(v);
      });
      var bl = b.layers || [], ol = o.layers || [], tl = t.layers || [];
      var B = byId(bl), O = byId(ol), T = byId(tl);
      var ids = mergeOrder(bl, ol, tl);
      page.layers = [];
      ids.forEach(function (id) {
        var lb = B[id], lo = O[id], lt = T[id];
        var pick;
        if (!lb) {
          if (lo && lt && !same(lo, lt)) conflicts.push({ page: k, layer: id, kind: 'both-added', agent: clone(lt), person: clone(lo) });
          pick = lo || lt;
        } else if (!lo && !lt) pick = null;
        else if (!lo) { pick = null; if (!same(lt, lb)) conflicts.push({ page: k, layer: id, kind: 'removed-by-person', agent: clone(lt) }); }
        else if (!lt) pick = same(lo, lb) ? null : lo;
        else if (same(lo, lb)) pick = lt;
        else if (same(lt, lb) || same(lo, lt)) pick = lo;
        else { pick = lo; conflicts.push({ page: k, layer: id, kind: 'both-changed', agent: clone(lt), person: clone(lo) }); }
        if (pick) page.layers.push(clone(pick));
      });
      doc.pages.push(page);
    });
    /* Key order of the document follows ours, so the written file stays stable. */
    var ordered = {};
    Object.keys(ours).concat(Object.keys(doc)).forEach(function (k) { if (own(doc, k) && !own(ordered, k)) ordered[k] = doc[k]; });
    return { doc: ordered, conflicts: conflicts };
  }

  /* An outline of a document for people and agents: pages, layers with ids, types, text and boxes. */
  function outline(doc) {
    return {
      name: doc.name || '',
      pages: (doc.pages || []).map(function (p, i) {
        return {
          index: i, id: p.id || null, width: p.width, height: p.height,
          background: typeof p.background === 'string' ? p.background : p.background && (p.background.color || p.background.type) || null,
          layers: (p.layers || []).map(function (l) {
            var o = { id: l.id, type: l.type };
            if (l.name && l.name !== l.id) o.name = l.name;
            ['x', 'y', 'w', 'h'].forEach(function (k) { if (l[k] != null) o[k] = l[k]; });
            if (l.type === 'text') { o.text = String(l.text || '').slice(0, 200); if (l.font) o.font = l.font; if (l.size) o.size = l.size; }
            if (l.type === 'image') { o.photo = l.src ? (String(l.src).indexOf('data:') === 0 ? 'embedded' : String(l.src).slice(0, 120)) : (l.slot ? 'empty slot' : 'empty'); }
            if (l.type === 'shape') o.shape = l.shape || 'rectangle';
            if (l.assetId || l.icon) o.icon = l.assetId || l.icon;
            if (l.visible === false) o.hidden = true;
            if (l.locked) o.locked = true;
            return o;
          })
        };
      }),
      notes: (doc.notes || []).map(function (n) { return { id: n.id, text: n.text, layer: n.layer || null, status: n.status }; })
    };
  }

  var core = { applyOps: applyOps, diff: diff, merge: merge, outline: outline, canon: canon, same: same, findLayer: findLayer, canonical: function (name) { return ALIASES[name] || name; }, FILE_OPS: ['note.add', 'note.resolve', 'doc.update', 'page.update', 'page.move'], cleanNotes: function (l) { try { return { ok: true, notes: cleanNotes(l, '/notes') }; } catch (e) { return { ok: false, error: { path: e.path, message: e.message } }; } }, OPS: Object.keys(OPS), VERSION: 1 };

  /* ================================================================== the tab client */
  core._client = function (win) {
    var params;
    try { params = new URLSearchParams(win.location.search); } catch (e) { return; }
    var linkId = params.get('link');
    if (!linkId || !/^[\w-]{4,64}$/.test(linkId)) return;
    var m = /(?:^#|&)lt=([\w-]{16,64})/.exec(win.location.hash || '');
    var tok = m ? m[1] : null;
    try { if (tok) win.sessionStorage.setItem('le-link-' + linkId, tok); else tok = win.sessionStorage.getItem('le-link-' + linkId); } catch (e) {}
    if (m) { try { win.history.replaceState(null, '', win.location.pathname + win.location.search); } catch (e) {} }
    if (!tok) return;
    var client = new Client(win, linkId, tok);
    core.client = client;
    var start = function () { client.start(); };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
    else setTimeout(start, 0);
  };

  function Client(win, id, tok) {
    this.win = win; this.id = id; this.tok = tok;
    this.api = '/api/' + tok + '/link/' + id;
    this.cid = Math.random().toString(36).slice(2, 12);
    this.base = null; /* last synced document (open format, image references as in the file) */
    this.rev = null;
    this.seq = 0; /* the server numbers every version; older ones are ignored */
    this.knownSrc = {};
    this.applying = 0;
    this.timer = 0;
    this.q = Promise.resolve(); /* one sync step at a time: incoming changes and outgoing edits never interleave */
    this.state = 'connecting';
    this.dead = false;
    this.notes = null;
  }
  Client.prototype.c = function () { return this.win.LEStudio; };
  Client.prototype.serial = function (fn) { var p = this.q.then(fn, fn); this.q = p.catch(function () {}); return p; };
  Client.prototype.req = function (method, path, body) {
    return this.win.fetch(this.api + path + (path.indexOf('?') < 0 ? '?' : '&') + 'client=' + this.cid, {
      method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e; } return j; });
    });
  };
  Client.prototype.start = function () {
    var self = this;
    var tries = 0;
    (function wait() {
      var c = self.c();
      if (c && c.S && self.win.LE && self.win.LE.design && typeof c.startProject === 'function' && self.win.LEStudioPanels) return self.boot();
      if (++tries > 600) return;
      setTimeout(wait, 50);
    })();
  };
  Client.prototype.resolver = function () {
    var self = this;
    return function (p) {
      return self.win.fetch(self.api + '/file?path=' + encodeURIComponent(p), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('missing'); return r.blob(); });
    };
  };
  Client.prototype.boot = function () {
    var self = this;
    this.chip();
    this.show('sync', 'Opening…');
    return this.req('GET', '/doc').then(function (j) {
      self.name = j.file || 'design';
      return self.win.LE.design.parse(j.text, { resolve: self.resolver() }).then(function (res) {
        if (!res.ok) { self.show('error', 'The file has errors; fix it and save again.'); return null; }
        self.base = JSON.parse(j.text);
        self.notes = self.base.notes || null;
        self.rev = j.rev;
        self.seq = j.seq || 0;
        self.knownSrc = j.srcOf || {};
        return self.openFresh(res);
      });
    }).then(function () {
      self.listen();
      self.hook();
      self.show('ok', 'Linked');
      self.ready = true;
    }).catch(function (e) { self.show('error', 'Link failed: ' + (e && e.message || e)); });
  };
  Client.prototype.storeAssets = function (res) {
    var LE = this.win.LE;
    var ids = Object.keys(res.assets || {});
    return Promise.all(ids.map(function (aid) {
      var m = res.project.assets[aid] || {};
      return LE.project.putAsset({ blob: res.assets[aid], name: m.name, type: m.type, width: m.width, height: m.height, source: m.source });
    }));
  };
  Client.prototype.openFresh = function (res) {
    var c = this.c(), self = this;
    self.applying++;
    return this.storeAssets(res).then(function () {
      return c.startProject(res.project, { toast: 'Linked to ' + self.name + ' — changes to the file appear here' });
    }).then(function () { self.projectId = c.S.project && c.S.project.id; return c.saveNow ? c.saveNow({ created: true }) : null; })
      .then(function () { self.applying--; }, function (e) { self.applying--; throw e; });
  };
  Client.prototype.listen = function () {
    var self = this;
    if (!this.win.EventSource) return;
    var es = this.es = new this.win.EventSource(this.api + '/events?client=' + this.cid);
    es.addEventListener('doc', function (ev) { var j; try { j = JSON.parse(ev.data); } catch (e) { return; } self.serial(function () { return self.incoming(j); }); });
    es.addEventListener('status', function (ev) {
      var j; try { j = JSON.parse(ev.data); } catch (e) { return; }
      if (j.ok === false) self.show('error', 'The file has errors; the last good version stays. ' + ((j.errors && j.errors[0] && ((j.errors[0].path ? j.errors[0].path + ': ' : '') + j.errors[0].message)) || ''));
    });
    es.addEventListener('gone', function () { self.show('error', 'The file was deleted. Your design stays here.'); });
    es.addEventListener('bye', function () { self.dead = true; es.close(); self.show('off', 'The local server stopped. Your edits stay in this tab.'); });
    var fails = 0;
    es.onerror = function () {
      if (self.dead) return;
      fails++;
      if (fails >= 4 || es.readyState === 2) self.show('off', 'The local server is not reachable. Your edits stay in this tab.');
      else if (self.state !== 'error') self.show('off', 'Reconnecting…');
    };
    es.onopen = function () { fails = 0; if (self.state === 'off') self.show('ok', 'Linked'); };
  };
  /* The studio document as open-format JSON, with image references written the way the file writes them. */
  Client.prototype.current = function () {
    var c = this.c();
    if (!c.S.project) return null;
    c.syncProject();
    var r = this.win.LE.design.stringify(c.S.project, { images: 'ids' });
    var d = JSON.parse(r.text);
    var src = this.knownSrc || {};
    var unknown = [];
    (function fix(o) {
      if (Array.isArray(o)) { o.forEach(fix); return; }
      if (!isObj(o)) return;
      Object.keys(o).forEach(function (k) {
        if (k === 'src' && typeof o[k] === 'string' && /^[0-9a-f]{64}$/.test(o[k])) { if (src[o[k]]) o[k] = src[o[k]]; else if (unknown.indexOf(o[k]) < 0) unknown.push(o[k]); }
        else fix(o[k]);
      });
    })(d);
    if (this.notes && this.notes.length) d.notes = clone(this.notes);
    return { doc: d, unknown: unknown };
  };
  Client.prototype.mine = function () {
    var c = this.c();
    return !!(c.S.project && (!this.projectId || c.S.project.id === this.projectId));
  };
  Client.prototype.dirty = function () {
    if (!this.base || !this.mine()) return false;
    var cur = this.current();
    return !!cur && !same(stripNotes(cur.doc), stripNotes(this.base));
  };
  /* A new version from the file. Unsaved edits in the tab go to the server first; it merges and answers with the result. */
  Client.prototype.incoming = function (j) {
    var self = this;
    if (!j || !j.text || (j.seq != null && j.seq <= this.seq) || j.rev === this.rev || !this.mine()) return Promise.resolve();
    if (this.timer || this.dirty()) { clearTimeout(this.timer); this.timer = 0; return this.push(); }
    return this.show_(j.text, j.rev, j.srcOf, j.seq);
  };
  Client.prototype.show_ = function (text, rev, srcOf, seq) {
    var self = this, c = this.c(), LE = this.win.LE;
    return LE.design.parse(text, { resolve: this.resolver(), assets: c.S.project.assets }).then(function (res) {
      if (!res.ok) { self.show('error', 'The file has errors; the last good version stays.'); return null; }
      var next = JSON.parse(text);
      self.knownSrc = Object.assign(self.knownSrc || {}, srcOf || {});
      return self.storeAssets(res).then(function () { return self.applyProject(res, next); }).then(function () {
        self.base = next; self.rev = rev; if (seq != null) self.seq = Math.max(self.seq, seq); self.notes = next.notes || null; self.renderNotes();
      });
    }).catch(function (e) { self.show('error', String(e && e.message || e)); });
  };
  /* Puts the new document on screen: through agent mode when it exists (animated, in the activity feed, obeys pause),
     otherwise as one undo step on the open page. */
  Client.prototype.applyProject = function (res, next) {
    var self = this, c = this.c(), LE = this.win.LE;
    var cur = this.current();
    var ops = cur ? diff(stripNotes(cur.doc), stripNotes(next)) : [];
    if (!ops.length) { self.show('ok', 'Up to date'); return Promise.resolve(); }
    var A = this.win.LEAgent;
    self.applying++;
    var done = function () { self.applying--; };
    if (A && typeof A.applyExternal === 'function') {
      /* Agent mode applies the whole new version as one batch (replace), animated and listed in the activity feed. */
      return Promise.resolve(A.applyExternal(stripNotes(next), { source: 'link', name: self.name, label: 'Changed ' + self.name + ' (' + ops.length + ' change' + (ops.length > 1 ? 's' : '') + ')' }))
        .then(function (r) {
          if (r && r.ok === false) self.show('warn', r.code === 'paused' ? 'Paused: the change from the file waits until you resume' : 'Agent mode did not apply the change: ' + (r.message || r.code));
          else self.show('ok', 'Updated from the file');
        }, function (e) { self.show('error', 'Agent mode refused the change: ' + (e && (e.message || e.code) || e)); })
        .then(done, done);
    }
    var p = c.S.project;
    var incoming = res.project;
    return Promise.resolve().then(function () {
      Object.keys(incoming.assets || {}).forEach(function (aid) { p.assets[aid] = incoming.assets[aid]; });
      p.name = incoming.name;
      p.meta = p.meta || {};
      p.meta.studio = Object.assign({}, p.meta.studio || {}, (incoming.meta && incoming.meta.studio) || {});
      if (incoming.pages.length !== p.pages.length) {
        p.pages = incoming.pages;
        p.activePage = Math.min(p.activePage || 0, p.pages.length - 1);
        return c.startProject(p, { toast: 'Updated from ' + self.name });
      }
      var active = p.activePage || 0;
      incoming.pages.forEach(function (pg, i) { if (i !== active) p.pages[i] = pg; });
      return self.ensure(incoming).then(function () {
        c.replaceDoc(incoming.pages[active], true);
        if (c.renderHead) c.renderHead();
        if (c.renderFoot) c.renderFoot();
        if (c.S.panel && c.renderPanel) c.renderPanel(true);
        if (c.toast) c.toast('The agent changed ' + ops.length + ' thing' + (ops.length > 1 ? 's' : '') + ' · Undo takes it back');
        if (c.markDirty) c.markDirty();
      });
    }).then(function () { self.show('ok', 'Updated from the file'); done(); }, function (e) { done(); self.show('error', String(e && e.message || e)); });
  };
  /* Decodes any new photos into the studio's scene before the page is swapped in. */
  Client.prototype.ensure = function (project) {
    var c = this.c(), LE = this.win.LE, doc = this.win.document;
    var ids = LE.project.assetIds(project).filter(function (aid) { return !(c.mem && c.mem[aid]); });
    return Promise.all(ids.map(function (aid) {
      return LE.project.assetRecord(aid).then(function (rec) {
        if (!rec) return null;
        return createImageBitmap(rec.blob).then(function (bmp) {
          var cv = doc.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
          if (bmp.close) bmp.close();
          c.mem[aid] = { meta: project.assets[aid] || { id: aid, width: cv.width, height: cv.height }, canvas: cv };
          c.scene.addAsset(aid, cv);
        });
      }).catch(function () {});
    }));
  };
  function stripNotes(d) { var o = clone(d); delete o.notes; delete o.$schema; return o; }
  Client.prototype.hook = function () {
    var self = this;
    var P = this.win.LEStudioPanels;
    if (!P) return;
    var H = P._hooks = P._hooks || {};
    var on = function () { if (!self.applying && !self.dead) self.schedule(); };
    (H.history = H.history || []).push(on);
    (H.change = H.change || []).push(on);
    this.win.addEventListener('pagehide', function () { self.beacon(); });
  };
  Client.prototype.schedule = function () {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.timer = 0; self.serial(function () { return self.push(); }); }, 600);
  };
  Client.prototype.body = function () {
    var self = this, LE = this.win.LE;
    var cur = this.current();
    if (!cur) return Promise.resolve(null);
    return Promise.all(cur.unknown.map(function (aid) {
      return LE.project.getAsset(aid).then(function (blob) {
        if (!blob) return null;
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res([aid, fr.result]); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(blob); });
      }).catch(function () { return null; });
    })).then(function (pairs) {
      var assets = {};
      pairs.forEach(function (p) { if (p) assets[p[0]] = p[1]; });
      return { baseRev: self.rev, doc: cur.doc, assets: assets };
    });
  };
  /* Sends the person's edits; the server merges with any newer file version and answers with the result. */
  Client.prototype.push = function () {
    var self = this;
    if (this.dead || !this.base || !this.mine()) return Promise.resolve();
    if (!this.dirty()) return Promise.resolve();
    this.show('sync', 'Saving to the file…');
    return this.body().then(function (body) {
      if (!body) return null;
      return self.req('POST', '/edit', body).then(function (j) {
        self.knownSrc = Object.assign(self.knownSrc || {}, j.srcOf || {});
        var after = function () {
          self.base = JSON.parse(j.text); self.rev = j.rev; self.seq = Math.max(self.seq, j.seq || 0); self.notes = self.base.notes || null;
          var n = (j.conflicts || []).filter(function (x) { return x.layer; }).length;
          self.show(n ? 'warn' : 'ok', n ? 'Saved · your edit was kept over the agent\'s on ' + n + ' layer' + (n > 1 ? 's' : '') : 'Saved to the file');
        };
        if (j.merged) return self.show_(j.text, j.rev, j.srcOf, j.seq).then(after);
        after();
        return null;
      });
    }).catch(function (e) { self.show('error', 'Could not save to the file: ' + (e && e.message || e)); });
  };
  Client.prototype.beacon = function () {
    var self = this;
    if (this.dead || !this.base || !this.mine() || !this.dirty() || !navigator.sendBeacon) return;
    var cur = this.current();
    try { navigator.sendBeacon(self.api + '/edit?client=' + self.cid, new Blob([JSON.stringify({ baseRev: self.rev, doc: cur.doc, assets: {} })], { type: 'application/json' })); } catch (e) {}
  };
  Client.prototype.report = function (st) { return this.req('POST', '/status', st).catch(function () {}); };
  Client.prototype.addNote = function (text, layer) {
    var self = this;
    return this.serial(function () {
      return self.push().then(function () {
        return self.req('POST', '/note', { text: text, layer: layer || null, page: self.c().S.project ? self.c().S.project.activePage || 0 : 0 });
      }).then(function (j) {
        self.notes = j.notes; if (self.base) self.base.notes = j.notes; self.rev = j.rev || self.rev; self.seq = Math.max(self.seq, j.seq || 0); self.renderNotes(); return j;
      });
    });
  };

  /* ---------- the link chip (status + notes) ---------- */
  Client.prototype.chip = function () {
    var doc = this.win.document, self = this;
    if (doc.getElementById('le-link-chip')) return;
    var st = doc.createElement('style');
    st.textContent = '#le-link-chip{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:60;display:flex;gap:6px;align-items:center;' +
      'background:var(--surface,#fff);color:var(--ink,#17131F);border:1px solid var(--line,rgba(23,19,31,.15));border-radius:999px;padding:4px 6px 4px 12px;' +
      'font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 4px 16px rgba(23,19,31,.12);max-width:calc(100vw - 24px)}' +
      '#le-link-chip .dot{width:8px;height:8px;border-radius:50%;background:#8a8a8a;flex:none}#le-link-chip[data-s=ok] .dot{background:#2f9e5b}' +
      '#le-link-chip[data-s=error] .dot{background:#c0392b}#le-link-chip[data-s=warn] .dot{background:#E0B354}#le-link-chip[data-s=sync] .dot{background:#3b82f6}' +
      '#le-link-chip .msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
      '#le-link-chip button{min-height:36px;min-width:44px;border-radius:999px;border:1px solid var(--line,rgba(23,19,31,.15));background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0 12px}' +
      '#le-link-notes{position:fixed;left:12px;bottom:calc(64px + env(safe-area-inset-bottom));z-index:61;width:min(340px,calc(100vw - 24px));background:var(--surface,#fff);color:var(--ink,#17131F);' +
      'border:1px solid var(--line,rgba(23,19,31,.15));border-radius:14px;padding:12px;box-shadow:0 8px 28px rgba(23,19,31,.18);font:14px/1.4 system-ui,sans-serif}' +
      '#le-link-notes textarea{width:100%;box-sizing:border-box;min-height:64px;border-radius:10px;border:1px solid var(--line,rgba(23,19,31,.2));padding:8px;font:inherit;background:transparent;color:inherit}' +
      '#le-link-notes ul{list-style:none;margin:0 0 8px;padding:0;max-height:40vh;overflow:auto}#le-link-notes li{padding:6px 0;border-bottom:1px solid var(--line,rgba(23,19,31,.1))}' +
      '#le-link-notes li.done{opacity:.55;text-decoration:line-through}#le-link-notes .row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}' +
      '#le-link-notes button{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line,rgba(23,19,31,.2));background:transparent;color:inherit;font:600 14px system-ui,sans-serif;cursor:pointer}' +
      '#le-link-notes button.primary{background:#E0B354;color:#2A1F0A;border-color:#E0B354}';
    doc.head.appendChild(st);
    var el = doc.createElement('div');
    el.id = 'le-link-chip';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="msg">Linking…</span><button type="button" data-act="notes" aria-label="Notes for the agent">Notes</button>';
    doc.body.appendChild(el);
    el.querySelector('[data-act=notes]').addEventListener('click', function () { self.toggleNotes(); });
    this.el = el;
  };
  Client.prototype.show = function (state, msg) {
    this.state = state;
    if (!this.el) return;
    this.el.setAttribute('data-s', state);
    this.el.querySelector('.msg').textContent = (this.name ? this.name + ' · ' : '') + msg;
  };
  Client.prototype.toggleNotes = function () {
    var doc = this.win.document, self = this;
    var box = doc.getElementById('le-link-notes');
    if (box) { box.remove(); return; }
    box = doc.createElement('div');
    box.id = 'le-link-notes';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Notes for the agent');
    box.innerHTML = '<ul></ul><label for="le-link-note-text" style="font-weight:600">Note for the agent</label><textarea id="le-link-note-text" maxlength="2000" placeholder="e.g. make this warmer"></textarea>' +
      '<div class="row"><button type="button" data-act="close">Close</button><button type="button" class="primary" data-act="pin">Pin note</button></div>';
    doc.body.appendChild(box);
    this.renderNotes();
    box.querySelector('[data-act=close]').onclick = function () { box.remove(); };
    box.querySelector('[data-act=pin]').onclick = function () {
      var ta = box.querySelector('textarea');
      var t = ta.value.trim();
      if (!t) { ta.focus(); return; }
      var c = self.c();
      var sel = c.scene && c.scene.selection ? c.scene.selection() : [];
      self.addNote(t, sel && sel[0]).then(function () { ta.value = ''; }, function (e) { self.show('error', 'Could not pin the note: ' + (e && e.message || e)); });
    };
    box.querySelector('textarea').focus();
  };
  Client.prototype.renderNotes = function () {
    var box = this.win.document.getElementById('le-link-notes');
    if (!box) return;
    var ul = box.querySelector('ul');
    ul.textContent = '';
    (this.notes || (this.base && this.base.notes) || []).forEach(function (n) {
      var li = document.createElement('li');
      if (n.status === 'done') li.className = 'done';
      li.textContent = (n.layer ? '[' + n.layer + '] ' : '') + n.text + (n.reply ? ' — ' + n.reply : '');
      ul.appendChild(li);
    });
  };

  return core;
});
