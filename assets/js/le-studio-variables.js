/* LocalEditor studio: Fields (fill a template once) and Create many (a list in, a zip of finished designs out).
   Roadmap 2.6. Model and engine: assets/js/le-variables.js (LE.variables). Docs: docs/VARIABLES.md.
   Loaded lazily (LE.modules.defer in studio/index.html); panels: fields, bulk. Everything stays on this device. */
(function () {
  'use strict';
  var LE = window.LE;
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  (window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push({ id: 'variables.bulk', name: 'Create many', group: 'Photo studio', needs: ['canvas-2d'], wants: ['device-memory-4gb'], memoryMB: 300 });
  if (!LE || !LE.Scene) return;

  var ST = { selText: null, bulk: null, samples: {}, gallery: null, thumbs: {}, editing: null, focus: 0, lastSig: '' };
  function V() { return LE.variables; }
  function ready() { return LE.variables ? Promise.resolve(LE.variables) : LE.varBoot.ready(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function root() { var r = document.documentElement.getAttribute('data-root') || '../'; return r.charAt(r.length - 1) === '/' ? r : r + '/'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtTime(ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; }

  /* ---------- the document ---------- */
  function project(c) { if (c.S.project) c.syncProject(); return c.S.project; }
  function defs(c) {
    var p = project(c);
    if (!p || !V()) return [];
    return V().definitions(p);
  }
  function pageValues(c) { return clone(c.scene._doc.values || {}) || {}; }
  function usesFields(pg) { return (pg.layers || []).some(function (l) { return LE.varBoot.touches(l); }); }
  /* Save the variable list (labels, types, samples) in the document. Pages carry the values. */
  function saveDefs(c, list) {
    var p = project(c);
    if (!p) return;
    var st = c.studio();
    var keep = V().storedList(list);
    if (keep.length) st.variables = keep; else delete st.variables;
    c.markDirty();
  }
  /* Values: the page in view through history (one undo step per field edit); other pages that showed the same values
     follow (pages made by Create many keep their own row). */
  function setValues(c, next, key) {
    var sc = c.scene, prev = JSON.stringify(sc._doc.values || null);
    var clean = LE.Scene.valuesOf(next);
    if (JSON.stringify(clean || null) === prev) return;
    sc._before(key || null);
    if (clean) sc._doc.values = clean; else delete sc._doc.values;
    sc._varCache = {};
    sc._after();
    if (!key) sc._endHist();
    var p = project(c);
    if (p) p.pages.forEach(function (pg, i) {
      if (i === p.activePage || !usesFields(pg)) return;
      if (JSON.stringify(pg.values || null) !== prev) return;
      if (clean) pg.values = clone(clean); else delete pg.values;
      c.S.pageThumbs[i] = null;
    });
    if (c.renderFoot) c.renderFoot();
    c.markDirty();
  }
  function patchLayer(c, id, patch) { c.scene._before(null); c.scene.update(id, patch); c.scene._after(); c.scene._endHist(); }

  /* ---------- the selected layer: make a field, bind it ---------- */
  document.addEventListener('selectionchange', function () {
    var c = window.LEStudio, sc = c && c.scene;
    if (!sc || !sc._editing || !sc._editor) return;
    var s = window.getSelection && window.getSelection();
    if (!s || !s.rangeCount || !sc._editor.contains(s.anchorNode)) return;
    var r = s.getRangeAt(0), pre = document.createRange();
    pre.selectNodeContents(sc._editor); pre.setEnd(r.startContainer, r.startOffset);
    var start = pre.toString().length, text = r.toString();
    ST.selText = { id: sc._editing, start: start, end: start + text.length, text: text, at: Date.now() };
  });
  function makeField(c) {
    var l = c.one();
    var sc = c.scene;
    var sel = ST.selText;
    if (sc._editing && sc._commitEdit) sc._commitEdit(true);
    if (!l && sel) l = c.L(sel.id);
    if (!l || l.type !== 'text') { c.toast('Select a text box first.'); return; }
    var text = String(l.text || '');
    var part = sel && sel.id === l.id && sel.end > sel.start && Date.now() - sel.at < 120000 && text.slice(sel.start, sel.end) === sel.text ? sel : null;
    var sample = part ? part.text.trim() : text.trim();
    if (!sample) { c.toast('Type something in the text box first.'); return; }
    if (/\{\{/.test(sample)) { c.toast('That text is already a field.'); return; }
    var list = defs(c);
    var key = V().keyFrom(sample.length <= 24 ? sample : (l.name && l.name !== l.id ? l.name : 'field'), list.map(function (d) { return d.key; }));
    if (!part) key = V().keyFrom(l.name && !/^Text \d+$/.test(l.name) ? l.name : (sample.split(/\s+/).length <= 3 ? sample : 'text'), list.map(function (d) { return d.key; }));
    var token = '{{' + key + '}}';
    var next = part ? text.slice(0, part.start) + token + text.slice(part.end) : token;
    var hadValues = !!sc._doc.values;
    sc._before(null);
    sc.update(l.id, { text: next, overflow: l.overflow || 'shrink' });
    var vals = Object.assign({}, sc._doc.values || {});
    vals[key] = sample;
    sc._doc.values = LE.Scene.valuesOf(vals);
    sc._varCache = {};
    sc._after(); sc._endHist();
    ST.selText = null;
    list = defs(c);
    list.forEach(function (d) { if (d.key === key) { d.label = V().labelOf(sample.length <= 24 ? sample : key); d.sample = sample; } });
    saveDefs(c, list);
    c.toast(hadValues ? 'Made a field. Fill it in Fields.' : 'Made a field: the text stays as it was, and you can change it in Fields.', { action: { label: 'Fields', fn: function () { c.openPanel('fields'); } } });
    if (c.S.panel === 'fields') c.renderPanel(true);
    c.renderToolbar();
  }
  function bindLayer(c, what, key) {
    var l = c.one();
    if (!l) return;
    var b = Object.assign({}, l.bind || {});
    if (key) b[what] = key; else delete b[what];
    var patch = { bind: (b.content || b.color || b.show) ? b : null };
    patchLayer(c, l.id, patch);
    c.renderPanel(true);
  }

  /* ---------- Fields panel ---------- */
  var TYPE_NAMES = { text: 'Text', number: 'Number', date: 'Date', image: 'Photo', colour: 'Colour', url: 'Link or QR text', boolean: 'Yes / no' };
  function input(c, d, value, onChange) {
    var id = 'vx-in-' + d.key.replace(/[^\w-]/g, '_');
    var t = d.type, ctl;
    if (t === 'boolean') {
      ctl = c.ui.toggle(d.label || d.key, value === true || (typeof value === 'string' && V().truthy(value)), function (on) { onChange(on, true); });
      ctl.classList.add('vx-switch');
      return ctl;
    }
    if (t === 'image') {
      ctl = el('<div class="vx-photo"><span class="vx-photo-img" aria-hidden="true"></span><label class="btn btn-sm vx-photo-btn"><span>' + (value ? 'Change photo' : 'Choose photo') + '</span><input type="file" accept="image/*" hidden></label>' + (value ? '<button type="button" class="btn btn-sm btn-ghost vx-photo-x">Remove</button>' : '') + '</div>');
      var holder = ctl.querySelector('.vx-photo-img');
      if (value && c.thumbUrl) c.thumbUrl(value).then(function (u) { if (u) { var im = new Image(); im.alt = ''; im.src = u; holder.appendChild(im); } });
      ctl.querySelector('input').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        ctl.querySelector('.vx-photo-btn span').textContent = 'Adding…';
        c.ingest(f).then(function (meta) { onChange(meta.id, true); }, function (err) { c.toast(err && err.message || 'Could not read that photo.'); });
      };
      var x = ctl.querySelector('.vx-photo-x');
      if (x) x.onclick = function () { onChange('', true); };
      return ctl;
    }
    if (t === 'colour') {
      ctl = el('<div class="vx-colour"><input type="color" aria-label="' + esc(d.label || d.key) + '"><input class="sx-input" type="text" maxlength="9" spellcheck="false" autocomplete="off" placeholder="#1F6FEB"></div>');
      var pick = ctl.querySelector('[type=color]'), hex = ctl.querySelector('[type=text]');
      var hx = V().hexOf(value) || '';
      pick.value = (hx || '#1F6FEB').slice(0, 7); hex.value = hx || (value || '');
      hex.id = id;
      pick.addEventListener('input', function () { hex.value = pick.value.toUpperCase(); onChange(hex.value); });
      hex.addEventListener('input', function () { var v = V().hexOf(hex.value); if (v) pick.value = v.slice(0, 7); onChange(hex.value); });
      return ctl;
    }
    if (t === 'date') ctl = el('<input class="sx-input" type="date" min="1800-01-01" max="2300-12-31">');
    else if (t === 'number') ctl = el('<input class="sx-input" type="text" inputmode="decimal" autocomplete="off">');
    else if (t === 'url') ctl = el('<input class="sx-input" type="text" inputmode="url" autocomplete="off" spellcheck="false">');
    else ctl = el('<textarea class="sx-input vx-text" rows="1"></textarea>');
    ctl.id = id;
    ctl.maxLength = t === 'url' ? 1200 : 2000;
    ctl.placeholder = d.sample != null ? String(d.sample) : (t === 'number' ? '12.50' : t === 'url' ? 'https://…' : '');
    ctl.value = value == null ? '' : (t === 'date' ? (V().toDate(value) || '') : String(value));
    var grow = function () { if (ctl.tagName === 'TEXTAREA') { ctl.style.height = 'auto'; ctl.style.height = Math.min(160, ctl.scrollHeight + 2) + 'px'; } };
    ctl.addEventListener('input', function () { grow(); onChange(ctl.value); });
    ctl.addEventListener('focus', function () { ST.focus++; });
    ctl.addEventListener('blur', function () { onChange(ctl.value, true); });
    requestAnimationFrame(grow);
    return ctl;
  }
  function fieldRow(c, d, vals) {
    var row = el('<div class="mk-field vx-field" data-key="' + esc(d.key) + '"><div class="vx-field-head"><label for="vx-in-' + esc(d.key.replace(/[^\w-]/g, '_')) + '">' + esc(d.label || d.key) + (d.required ? '' : ' <small>optional</small>') + '</label>' +
      '<button type="button" class="vx-edit" aria-label="Edit the field ' + esc(d.label || d.key) + '">Edit</button></div></div>');
    if (d.type === 'boolean') row.querySelector('label').remove();
    var ctl = input(c, d, vals[d.key], function (v, commit) {
      var next = pageValues(c);
      if (v === '' && d.type !== 'text') delete next[d.key]; else next[d.key] = v;
      setValues(c, next, commit ? null : 'fields:' + d.key + ':' + ST.focus);
      if (commit && d.type === 'image') c.renderPanel(true);
      paintNote();
    });
    row.appendChild(ctl);
    var note = el('<small class="mk-hint vx-hint"></small>');
    function paintNote() {
      var where = (d.uses || []).length;
      var v = c.scene._doc.values && c.scene._doc.values[d.key];
      var c0 = v != null && d.type !== 'image' && d.type !== 'text' && d.type !== 'boolean' && v !== '' ? V().coerce(v, d) : null;
      note.textContent = c0 && c0.error ? c0.message : (d.unused ? 'Not used in this design yet' : 'Used in ' + plural(where, 'place'));
      note.classList.toggle('is-err', !!(c0 && c0.error));
    }
    paintNote();
    row.appendChild(note);
    row.querySelector('.vx-edit').onclick = function () { ST.editing = ST.editing === d.key ? null : d.key; c.renderPanel(true); };
    if (ST.editing === d.key) row.appendChild(editor(c, d));
    return row;
  }
  function editor(c, d) {
    var box = el('<div class="vx-editor" role="group" aria-label="Edit field">' +
      '<label class="vx-mini">Name shown in forms<input class="sx-input" data-k="label" maxlength="80"></label>' +
      '<label class="vx-mini">Key, used as {{key}} in text<input class="sx-input" data-k="key" maxlength="40" spellcheck="false" autocomplete="off"></label>' +
      '<label class="vx-mini">Kind<select class="sx-input" data-k="type"></select></label>' +
      '<label class="vx-mini">Example value<input class="sx-input" data-k="sample" maxlength="200"></label>' +
      '<label class="vx-mini">If it is empty, use<input class="sx-input" data-k="default" maxlength="200"></label>' +
      '<div class="vx-req"></div><p class="vx-err" role="alert" hidden></p>' +
      '<div class="vx-editor-act"><button type="button" class="btn btn-sm btn-ghost" data-a="cancel">Cancel</button><button type="button" class="btn btn-sm" data-a="save">Save field</button></div></div>');
    var sel = box.querySelector('select');
    Object.keys(TYPE_NAMES).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = TYPE_NAMES[t]; sel.appendChild(o); });
    box.querySelector('[data-k=label]').value = d.label || '';
    box.querySelector('[data-k=key]').value = d.key;
    sel.value = d.type || 'text';
    box.querySelector('[data-k=sample]').value = d.sample == null ? '' : d.sample;
    box.querySelector('[data-k=default]').value = d.default == null ? '' : d.default;
    var req = !!d.required;
    box.querySelector('.vx-req').appendChild(c.ui.toggle('Required in lists', req, function (on) { req = on; }, 'Rows without it are listed as problems'));
    var err = box.querySelector('.vx-err');
    box.querySelector('[data-a=cancel]').onclick = function () { ST.editing = null; c.renderPanel(true); };
    box.querySelector('[data-a=save]').onclick = function () {
      var key = box.querySelector('[data-k=key]').value.trim();
      var list = defs(c);
      if (!/^[A-Za-z_][\w.-]{0,39}$/.test(key)) { err.hidden = false; err.textContent = 'A key starts with a letter and uses letters, numbers and _ (no spaces), like first_name.'; return; }
      if (key !== d.key && list.some(function (x) { return x.key === key; })) { err.hidden = false; err.textContent = 'Another field is already called ' + key + '.'; return; }
      var upd = { label: box.querySelector('[data-k=label]').value.trim() || V().labelOf(key), type: sel.value, sample: box.querySelector('[data-k=sample]').value, default: box.querySelector('[data-k=default]').value, required: req };
      var before = { list: clone(list), key: d.key };
      if (key !== d.key) renameEverywhere(c, d.key, key);
      list = defs(c).map(function (x) { return x.key === key ? Object.assign({}, x, upd, { key: key, keep: true }) : x; });
      saveDefs(c, list);
      ST.editing = null;
      c.renderPanel(true);
      if (key !== d.key) c.toast('Renamed to {{' + key + '}} everywhere.', { action: { label: 'Undo', fn: function () { renameEverywhere(c, key, before.key); saveDefs(c, before.list); c.renderPanel(true); } } });
    };
    return box;
  }
  /* Rename a field in every page: the page in view through history (one undo step), the others in the project. */
  function renameEverywhere(c, from, to) {
    var p = project(c);
    if (!p) return;
    var sc = c.scene;
    var cur = sc.toJSON();
    V().renamePages([cur], from, to);
    sc._before(null);
    cur.layers.forEach(function (l) { var live = sc._find(l.id); if (live) { if (l.type === 'text') live.text = l.text; if (l.bind) live.bind = l.bind; } });
    if (cur.values) sc._doc.values = cur.values;
    sc._varCache = {};
    sc._after(); sc._endHist();
    p.pages.forEach(function (pg, i) { if (i !== p.activePage) { V().renamePages([pg], from, to); c.S.pageThumbs[i] = null; } });
    var st = c.studio();
    if (st.variables) st.variables = V().renameList(st.variables, from, to);
    c.markDirty();
  }
  function layerTools(c, list) {
    var l = c.one();
    if (!l) return null;
    var sec = c.ui.section('This ' + (l.type === 'text' ? 'text' : l.type === 'image' ? 'photo' : 'layer'));
    var b = sec.querySelector('.sx-sec-body');
    var keys = function (type) { return list.filter(function (d) { return !type || d.type === type; }); };
    function picker(label, what, type, hint) {
      var cur = l.bind && l.bind[what] ? l.bind[what].replace(/^!/, '') : '';
      var row = el('<label class="vx-mini vx-bind">' + esc(label) + '<select class="sx-input"></select>' + (hint ? '<small class="mk-hint">' + esc(hint) + '</small>' : '') + '</label>');
      var s = row.querySelector('select');
      [['', 'Nothing']].concat(keys(type).map(function (d) { return [d.key, d.label || d.key]; })).concat([['+', 'New field…']]).forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
      s.value = cur;
      s.onchange = function () {
        var v = s.value;
        if (v === '+') {
          var base = type === 'image' ? 'photo' : type === 'colour' ? 'colour' : type === 'boolean' ? 'show' : type === 'url' ? 'link' : 'field';
          v = V().keyFrom(base, list.map(function (d) { return d.key; }));
          var nl = defs(c).concat([{ key: v, label: V().labelOf(v), type: type, keep: true, uses: [] }]);
          saveDefs(c, nl);
        }
        bindLayer(c, what, v);
      };
      b.appendChild(row);
    }
    if (l.type === 'text') {
      var mk = el('<button type="button" class="btn vx-make">' + c.ic('plus') + '<span>Make this a field</span></button>');
      mk.addEventListener('mousedown', function (e) { e.preventDefault(); });
      mk.onclick = function () { makeField(c); };
      b.appendChild(mk);
      b.appendChild(el('<p class="mk-hint">Select words while editing to turn only those into a field.</p>'));
      if (/\{\{/.test(l.text || '')) {
        b.appendChild(el('<span class="vx-mini-label">When the filled-in text is longer</span>'));
        b.appendChild(c.ui.seg([['shrink', 'Shrink to fit'], ['wrap', 'Wrap'], ['ellipsis', 'Cut with …']], l.overflow || 'shrink', function (v) { patchLayer(c, l.id, { overflow: v }); }, 'sx-seg-sm vx-seg'));
      }
      picker('Text colour from a field', 'color', 'colour');
    } else if (l.type === 'image') {
      picker('Fill this photo from a field', 'content', 'image', 'Rows name a photo file; the frame, crop and look stay.');
    } else if (l.type === 'svg' && l.svg && /<path d="M\d/.test(l.svg) && /QR/i.test(l.name || '')) {
      picker('Fill this QR code from a field', 'content', 'url', 'A link, payment string or any text per row.');
    } else if (l.type === 'shape') picker('Colour from a field', 'color', 'colour');
    picker('Show only when', 'show', 'boolean', 'A yes / no column decides if this layer is shown.');
    return sec;
  }
  function renderFields(c, host) {
    var body = el('<div class="vx-body"></div>');
    host.appendChild(body);
    if (!V()) { body.appendChild(el('<p class="sx-note le-load-wait" role="status">Opening…</p>')); ready().then(function () { if (c.S.panel === 'fields') c.renderPanel(true); }); return; }
    var list = defs(c), vals = pageValues(c);
    ST.lastSig = sigOf(c);
    var tools = layerTools(c, list);
    if (!list.length) {
      var empty = el('<div class="vx-empty"><h3>Make this design a template</h3><p>Put <code>{{name}}</code> in any text, or select a text box and choose <b>Make this a field</b>. Then fill it in here, or make one for every row of a list.</p></div>');
      body.appendChild(empty);
      if (tools) body.appendChild(tools);
      else body.appendChild(el('<p class="mk-hint vx-tip">Tip: tap a text box on the page to make it a field.</p>'));
      gallery(c, body, 'Or start from a ready template');
      return;
    }
    var sec = c.ui.section('Fill in once', '<span class="vx-count">' + plural(list.length, 'field') + '</span>');
    var sb = sec.querySelector('.sx-sec-body');
    list.forEach(function (d) { sb.appendChild(fieldRow(c, d, vals)); });
    var row = el('<div class="vx-row"><button type="button" class="btn btn-sm btn-ghost" data-a="sample">Fill with examples</button><button type="button" class="btn btn-sm btn-ghost" data-a="reset"' + (c.scene._doc.values ? '' : ' disabled') + '>Reset to template</button></div>');
    row.querySelector('[data-a=reset]').onclick = function () { setValues(c, null); c.renderPanel(true); c.toast('Showing the template. Undo brings your values back.'); };
    row.querySelector('[data-a=sample]').onclick = function () {
      var next = pageValues(c);
      list.forEach(function (d) { if (d.sample != null && d.sample !== '' && d.type !== 'image') next[d.key] = d.type === 'boolean' ? V().truthy(d.sample) : d.sample; });
      setValues(c, next); c.renderPanel(true);
    };
    sb.appendChild(row);
    body.appendChild(sec);
    if (tools) body.appendChild(tools);
    var lint = V().lint({ pages: [c.scene.toJSON()], meta: { studio: c.studio() } }).filter(function (w) { return w.kind === 'unknown-pipe' || w.kind === 'overflow'; });
    if (lint.length) {
      var warn = el('<div class="vx-warn" role="status"></div>');
      lint.slice(0, 4).forEach(function (w) { warn.appendChild(el('<p>' + esc(w.message) + '</p>')); });
      body.appendChild(warn);
    }
    gallery(c, body, 'Ready templates');
    var go = el('<button type="button" class="btn btn-primary vx-go">' + c.ic('batch') + '<span>Create many</span></button>');
    go.onclick = function () { c.openPanel('bulk', { back: 'fields' }); };
    host.appendChild(c.ui.actions([go]));
  }
  function sigOf(c) {
    var d = c.scene._doc, sel = c.scene.selection().join(',');
    var keys = [];
    (d.layers || []).forEach(function (l) { if (LE.varBoot.touches(l)) keys.push(l.id + ':' + (l.type === 'text' ? (l.text.match(/\{\{[^}]*\}\}/g) || []).join('') : '') + JSON.stringify(l.bind || null) + (l.overflow || '')); });
    return sel + '|' + keys.join(';') + '|' + JSON.stringify((c.S.project && c.studio().variables) || null);
  }

  /* ---------- Ready templates ---------- */
  var galleryJob = null;
  function loadGallery() {
    if (!galleryJob) {
      galleryJob = fetch(root() + 'assets/data/templates/fields.json').then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
        .then(function (j) { return (j && Array.isArray(j.templates) ? j.templates : []).filter(function (t) { return t && /^[a-z][a-z0-9-]{1,39}$/.test(t.id) && t.design; }); });
      galleryJob.catch(function () { galleryJob = null; });
    }
    return galleryJob;
  }
  function samplePhoto(name) {
    var n = String(name).replace(/\.jpg$/i, '').replace(/[^\w-]/g, '');
    return fetch(root() + 'assets/photos/collage/' + n + '.jpg').then(function (r) { if (!r.ok) throw new Error('missing'); return r.blob(); })
      .then(function (b) { return new File([b], n + '.jpg', { type: 'image/jpeg' }); });
  }
  /* Template photos are files of the sample pool, by relative path; nothing else is fetched. */
  function resolveSample(path) {
    var m = /^assets\/photos\/collage\/([\w-]+)\.jpg$/.exec(path);
    if (!m) return Promise.resolve(null);
    return samplePhoto(m[1]);
  }
  function thumb(c, t, node) {
    if (ST.thumbs[t.id]) { node.style.backgroundImage = 'url(' + ST.thumbs[t.id] + ')'; return; }
    LE.design.parse(t.design, { resolve: resolveSample }).then(function (r) {
      if (!r.ok) return null;
      var pg = r.project.pages[0];
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px;visibility:hidden';
      document.body.appendChild(host);
      var sc = new LE.Scene({ el: host, width: pg.width, height: pg.height });
      return Promise.all(Object.keys(r.assets).map(function (id) { return createImageBitmap(r.assets[id]).then(function (bm) { var cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); sc.addAsset(id, cv); }); })).then(function () {
        sc.load(pg);
        return sc.render(Math.min(1, 480 / Math.max(pg.width, pg.height)));
      }).then(function (cv) {
        try { sc.destroy(); } catch (e) {}
        host.remove();
        return LE.toBlob(cv, 'image/jpeg', 0.86);
      }).then(function (b) { ST.thumbs[t.id] = URL.createObjectURL(b); node.style.backgroundImage = 'url(' + ST.thumbs[t.id] + ')'; node.classList.add('is-ready'); });
    }).catch(function () {});
  }
  function gallery(c, body, title) {
    var sec = c.ui.section(title);
    var grid = el('<div class="vx-gallery" role="list"></div>');
    sec.querySelector('.sx-sec-body').appendChild(grid);
    body.appendChild(sec);
    loadGallery().then(function (list) {
      list.forEach(function (t) {
        var card = el('<button type="button" class="vx-tpl" role="listitem"><span class="vx-tpl-img" aria-hidden="true"></span><span class="vx-tpl-txt"><b>' + esc(t.name) + '</b><small>' + esc(t.summary || '') + '</small></span></button>');
        card.onclick = function () { useTemplate(c, t); };
        grid.appendChild(card);
        var img = card.querySelector('.vx-tpl-img');
        if ('IntersectionObserver' in window) {
          var io = new IntersectionObserver(function (en) { if (en.some(function (e) { return e.isIntersecting; })) { io.disconnect(); thumb(c, t, img); } });
          io.observe(card);
        } else thumb(c, t, img);
      });
    }, function () { grid.appendChild(el('<p class="sx-note">Templates could not be loaded. Check your connection once; they work offline after that.</p>')); });
  }
  function useTemplate(c, t) {
    c.toast('Opening ' + t.name + '…', { ms: 1400 });
    return LE.design.importText(c, JSON.stringify(t.design), { name: t.name, resolve: resolveSample }).then(function (p) {
      if (!p) return;
      ST.samples[p.id] = { rows: t.rows || '', photos: t.photos || [], name: t.name };
      c.openPanel('fields');
    });
  }

  /* =====================================================================
     Create many
     ===================================================================== */
  var STEPS = [['list', 'Your list'], ['match', 'Match'], ['photos', 'Photos'], ['check', 'Check'], ['preview', 'Preview'], ['make', 'Create']];
  function B(c) {
    var p = c.S.project;
    if (!ST.bulk || ST.bulk.project !== (p && p.id) || ST.bulk.page !== (p && p.activePage)) {
      endPreview(c);
      ST.bulk = { project: p && p.id, page: p && p.activePage, step: 'list', table: null, mapping: {}, fixed: {}, photos: null, rows: null, preview: 0, out: lsGet('le-bulk-out', { kind: 'zip', format: 'png', scale: 1, name: '', paper: 'a4', cellW: 0, marks: true }), job: null, done: null };
    }
    return ST.bulk;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? Object.assign({}, d, JSON.parse(v)) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function needsPhotos(list) { return list.some(function (d) { return d.type === 'image' && (d.uses || []).length; }); }
  function stepList(list) { return STEPS.filter(function (s) { return s[0] !== 'photos' || needsPhotos(list); }); }
  function go(c, step) { var b = B(c); if (b.step === 'preview' && step !== 'preview') endPreview(c); b.step = step; c.renderPanel(); }
  function renderBulk(c, host) {
    var body = el('<div class="vx-body vx-bulk"></div>');
    host.appendChild(body);
    if (!V()) { body.appendChild(el('<p class="sx-note le-load-wait" role="status">Opening…</p>')); ready().then(function () { if (c.S.panel === 'bulk') c.renderPanel(true); }); return; }
    var list = defs(c);
    if (!c.S.project || !list.length) {
      body.appendChild(c.ui.empty('This design has no fields yet', 'Put {{name}} in a text, or open Fields and choose Make this a field. Or start from a ready template.', [{ label: 'Open Fields', gold: true, fn: function () { c.openPanel('fields'); } }]));
      gallery(c, body, 'Ready templates');
      return;
    }
    var b = B(c), steps = stepList(list);
    if (!steps.some(function (s) { return s[0] === b.step; })) b.step = 'list';
    var idx = steps.map(function (s) { return s[0]; }).indexOf(b.step);
    var nav = el('<ol class="vx-steps" aria-label="Steps"></ol>');
    steps.forEach(function (s, i) {
      var li = el('<li><button type="button"' + (i === idx ? ' aria-current="step"' : '') + (i > idx && !canReach(b, s[0]) ? ' disabled' : '') + '><span class="vx-step-n">' + (i + 1) + '</span><span class="vx-step-t">' + esc(s[1]) + '</span></button></li>');
      li.querySelector('button').onclick = function () { go(c, s[0]); };
      nav.appendChild(li);
    });
    body.appendChild(nav);
    var view = el('<div class="vx-view"></div>');
    body.appendChild(view);
    var next = steps[idx + 1];
    ({ list: viewList, match: viewMatch, photos: viewPhotos, check: viewCheck, preview: viewPreview, make: viewMake })[b.step](c, view, list, b, next ? next[0] : null);
  }
  function canReach(b, step) {
    if (step === 'list') return true;
    if (!b.table || !b.table.rows.length) return false;
    if (step === 'match' || step === 'photos') return true;
    return !!b.rows || step === 'check';
  }
  function primary(c, view, label, fn, disabled) {
    var btn = el('<button type="button" class="btn btn-primary vx-next"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>');
    btn.onclick = fn;
    c.E.panelBody.appendChild(c.ui.actions([btn]));
    return btn;
  }
  /* ---- 1. Your list ---- */
  function sampleCsv(c, list) {
    var p = c.S.project, s = p && ST.samples[p.id];
    if (s && s.rows) return s.rows;
    var head = list.map(function (d) { return d.key; });
    var one = list.map(function (d) { var v = d.sample != null ? String(d.sample) : (c.scene._doc.values && c.scene._doc.values[d.key] != null && d.type !== 'image' ? String(c.scene._doc.values[d.key]) : ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; });
    return head.join(',') + '\n' + one.join(',') + '\n';
  }
  function setTable(c, b, tbl, list) {
    b.table = tbl; b.rows = null; b.done = null; b.preview = 0;
    b.mapping = V().automap(tbl.columns, list);
    b.fixed = {};
  }
  function viewList(c, view, list, b, next) {
    view.appendChild(el('<p class="vx-lead">Bring a list: one row per design, the first row names the columns. It is read on this device and never uploaded.</p>'));
    var area = el('<div class="vx-drop"><label for="vx-paste" class="vx-mini-label">Paste from a spreadsheet</label><textarea id="vx-paste" class="sx-input vx-paste" rows="5" spellcheck="false" autocomplete="off"></textarea>' +
      '<div class="vx-row vx-pick"><label class="btn">' + c.ic('file') + '<span>Choose a file</span><input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,text/csv,text/tab-separated-values" hidden></label>' +
      '<button type="button" class="btn btn-ghost" data-a="type">Type it here</button><button type="button" class="btn btn-ghost" data-a="sample">Try the example list</button></div>' +
      '<p class="mk-hint">CSV, TSV or Excel. Drop a file here too.</p><p class="vx-status" role="status" aria-live="polite"></p></div>');
    var ta = area.querySelector('textarea'), status = area.querySelector('.vx-status');
    ta.placeholder = sampleCsv(c, list).split('\n').slice(0, 3).join('\n').replace(/,/g, '\t');
    function show() {
      if (!b.table) { status.textContent = ''; return; }
      status.textContent = plural(b.table.rows.length, 'row') + ' · ' + plural(b.table.columns.length, 'column') + (b.table.source === 'xlsx' && b.table.sheet ? ' · sheet “' + b.table.sheet + '”' : '') + (b.table.warnings.length ? ' · ' + b.table.warnings.join(' ') : '');
      if (btn) btn.disabled = !b.table.rows.length;
    }
    var pasteT = 0;
    ta.addEventListener('input', function () {
      clearTimeout(pasteT);
      pasteT = setTimeout(function () {
        if (!ta.value.trim()) { b.table = null; show(); if (btn) btn.disabled = true; return; }
        if (ta.value.length > V().LIMITS.pasteChars) { status.textContent = 'That is too much to paste here. Save it as a CSV file and choose it instead.'; return; }
        setTable(c, b, V().parseCSV(ta.value), list); show();
      }, 200);
    });
    function file(f) {
      if (!f) return;
      status.textContent = 'Reading ' + f.name + '…';
      V().parseFile(f, { progress: function (p) { status.textContent = 'Reading ' + f.name + '… ' + Math.round(p * 100) + '%'; } }).then(function (t) { setTable(c, b, t, list); b.fileName = f.name; show(); if (t.sheets && t.sheets.length > 1) sheetPick(f, t); }, function (e) { status.textContent = e && e.message || 'That file could not be read.'; });
    }
    function sheetPick(f, t) {
      var s = el('<label class="vx-mini">Sheet<select class="sx-input"></select></label>');
      t.sheets.forEach(function (n) { var o = document.createElement('option'); o.value = o.textContent = n; s.querySelector('select').appendChild(o); });
      s.querySelector('select').value = t.sheet;
      s.querySelector('select').onchange = function (e) { V().parseFile(f, { sheet: e.target.value }).then(function (t2) { setTable(c, b, t2, list); show(); }); };
      area.insertBefore(s, status);
    }
    area.querySelector('input[type=file]').onchange = function (e) { file(e.target.files && e.target.files[0]); };
    area.addEventListener('dragover', function (e) { e.preventDefault(); area.classList.add('is-over'); });
    area.addEventListener('dragleave', function () { area.classList.remove('is-over'); });
    area.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); area.classList.remove('is-over'); file(e.dataTransfer.files && e.dataTransfer.files[0]); });
    area.querySelector('[data-a=sample]').onclick = function () {
      setTable(c, b, V().parseCSV(sampleCsv(c, list), { source: 'example' }), list);
      var s = c.S.project && ST.samples[c.S.project.id];
      if (s && s.photos && s.photos.length && needsPhotos(list)) {
        status.textContent = 'Getting the example photos…';
        Promise.all(s.photos.map(function (n) { return samplePhoto(n).catch(function () { return null; }); })).then(function (files) { b.photos = V().photoIndex(files.filter(Boolean)); show(); });
      } else show();
    };
    area.querySelector('[data-a=type]').onclick = function () {
      if (!b.table) setTable(c, b, V().parseCSV(sampleCsv(c, list), { source: 'typed' }), list);
      b.grid = true; c.renderPanel(true);
    };
    view.appendChild(area);
    if (b.grid && b.table) view.appendChild(grid(c, b, list));
    var btn = primary(c, view, next === 'match' ? 'Next: match columns' : 'Next', function () { go(c, next); }, !(b.table && b.table.rows.length));
    show();
  }
  /* A small grid to type rows: a table on wide screens, one card per row on a phone. */
  function grid(c, b, list) {
    var t = b.table, phone = c.isPhone();
    var box = el('<div class="vx-grid' + (phone ? ' is-cards' : '') + '"><div class="vx-grid-body"></div><button type="button" class="btn btn-sm" data-a="add">' + c.ic('plus') + '<span>Add a row</span></button></div>');
    var host = box.querySelector('.vx-grid-body');
    var cols = t.columns;
    function cellInput(ri, ci) {
      var inp = el('<input class="sx-input" type="text" autocomplete="off">');
      inp.value = t.rows[ri][ci] || '';
      inp.setAttribute('aria-label', cols[ci] + ', row ' + (ri + 1));
      inp.addEventListener('input', function () { t.rows[ri][ci] = inp.value.slice(0, 2000); b.rows = null; });
      return inp;
    }
    function draw() {
      host.innerHTML = '';
      if (phone) {
        t.rows.forEach(function (r, ri) {
          var card = el('<fieldset class="vx-card"><legend>Row ' + (ri + 1) + '</legend></fieldset>');
          cols.forEach(function (name, ci) { var lab = el('<label class="vx-mini">' + esc(name) + '</label>'); lab.appendChild(cellInput(ri, ci)); card.appendChild(lab); });
          var del = el('<button type="button" class="btn btn-sm btn-ghost">Remove row ' + (ri + 1) + '</button>');
          del.onclick = function () { t.rows.splice(ri, 1); b.rows = null; draw(); };
          card.appendChild(del);
          host.appendChild(card);
        });
      } else {
        var tb = el('<table class="vx-table"><thead><tr></tr></thead><tbody></tbody></table>');
        cols.forEach(function (n) { tb.querySelector('tr').appendChild(el('<th scope="col">' + esc(n) + '</th>')); });
        tb.querySelector('tr').appendChild(el('<th><span class="sr-only">Remove</span></th>'));
        t.rows.forEach(function (r, ri) {
          var tr = document.createElement('tr');
          cols.forEach(function (n, ci) { var td = document.createElement('td'); td.appendChild(cellInput(ri, ci)); tr.appendChild(td); });
          var td2 = document.createElement('td');
          var del = el('<button type="button" class="sx-iconbtn" aria-label="Remove row ' + (ri + 1) + '">' + c.ic('x') + '</button>');
          del.onclick = function () { t.rows.splice(ri, 1); b.rows = null; draw(); };
          td2.appendChild(del); tr.appendChild(td2);
          tb.querySelector('tbody').appendChild(tr);
        });
        host.appendChild(tb);
      }
    }
    box.querySelector('[data-a=add]').onclick = function () { if (t.rows.length >= V().rowCap()) return; t.rows.push(cols.map(function () { return ''; })); b.rows = null; draw(); var last = host.querySelector(phone ? '.vx-card:last-child input' : 'tbody tr:last-child input'); if (last) last.focus(); };
    draw();
    return box;
  }
  /* ---- 2. Match columns ---- */
  function viewMatch(c, view, list, b, next) {
    var t = b.table;
    view.appendChild(el('<p class="vx-lead">Which column fills each field? Columns with the same name are matched for you.</p>'));
    var box = el('<div class="vx-map"></div>');
    list.forEach(function (d) {
      var ci = b.mapping[d.key];
      var row = el('<div class="vx-map-row"><label class="vx-map-f" for="vx-map-' + esc(d.key) + '"><b>' + esc(d.label || d.key) + '</b><small>' + esc(TYPE_NAMES[d.type] || 'Text') + (d.required ? ' · required' : '') + '</small></label><select class="sx-input" id="vx-map-' + esc(d.key) + '"></select><input class="sx-input vx-fixed" type="text" placeholder="Same for every row" hidden></div>');
      var s = row.querySelector('select'), fx = row.querySelector('.vx-fixed');
      [['-1', 'Leave empty'], ['fixed', 'Same text for every row…']].concat(t.columns.map(function (n, i) { return [String(i), n + (t.rows[0] && t.rows[0][i] ? ' — e.g. ' + String(t.rows[0][i]).slice(0, 24) : '')]; })).forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
      s.value = own(b.fixed, d.key) ? 'fixed' : String(ci == null ? -1 : ci);
      fx.hidden = s.value !== 'fixed'; fx.value = b.fixed[d.key] || '';
      s.onchange = function () { b.rows = null; if (s.value === 'fixed') { b.mapping[d.key] = -1; b.fixed[d.key] = fx.value; fx.hidden = false; fx.focus(); } else { delete b.fixed[d.key]; b.mapping[d.key] = Number(s.value); fx.hidden = true; } paint(); };
      fx.oninput = function () { b.fixed[d.key] = fx.value; b.rows = null; };
      box.appendChild(row);
    });
    view.appendChild(box);
    var note = el('<p class="vx-status" role="status"></p>');
    view.appendChild(note);
    function paint() {
      var used = {}, missingReq = [];
      list.forEach(function (d) { var i = b.mapping[d.key]; if (i >= 0) used[i] = 1; else if (d.required && !own(b.fixed, d.key)) missingReq.push(d.label || d.key); });
      var spare = t.columns.filter(function (n, i) { return !used[i]; });
      note.textContent = (missingReq.length ? 'Not matched yet: ' + missingReq.join(', ') + '. ' : '') + (spare.length ? 'Not used: ' + spare.slice(0, 6).join(', ') + (spare.length > 6 ? '…' : '') + '.' : 'Every column is used.');
    }
    paint();
    primary(c, view, next === 'photos' ? 'Next: photos' : 'Next: check', function () { go(c, next); });
  }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  /* ---- 3. Photos ---- */
  function imageValues(b, list) {
    var keys = list.filter(function (d) { return d.type === 'image'; }).map(function (d) { return d.key; }), out = [];
    b.table.rows.forEach(function (r) { keys.forEach(function (k) { var ci = b.mapping[k]; var v = ci >= 0 ? r[ci] : b.fixed[k]; if (v) out.push(String(v).trim()); }); });
    return out;
  }
  function viewPhotos(c, view, list, b, next) {
    view.appendChild(el('<p class="vx-lead">Choose the photos your list names. They are matched by file name: “ana.jpg”, “Ana.JPG” and “ana” are the same.</p>'));
    var row = el('<div class="vx-row vx-pick"><label class="btn">' + c.ic('image') + '<span>Choose photos</span><input type="file" accept="image/*" multiple hidden></label><label class="btn btn-ghost">' + c.ic('file') + '<span>Choose a folder</span><input type="file" webkitdirectory multiple hidden></label></div>');
    var status = el('<div class="vx-status" role="status" aria-live="polite"></div>');
    function paint() {
      var want = imageValues(b, list);
      if (!b.photos) { status.textContent = want.length ? 'Your list names ' + plural(want.length, 'photo') + '.' : 'Your list does not name any photos; the template photo is used.'; return; }
      var miss = want.filter(function (v) { return !b.photos.match(v); });
      var unused = b.photos.unused(want);
      status.innerHTML = '<p><b>' + (want.length - miss.length) + ' of ' + want.length + '</b> photos matched.' + (b.photos.dupes.length ? ' ' + plural(b.photos.dupes.length, 'file') + ' had the same name as another and were left out.' : '') + '</p>' +
        (miss.length ? '<p class="vx-miss">Not found: ' + esc(miss.slice(0, 12).join(', ')) + (miss.length > 12 ? ' and ' + (miss.length - 12) + ' more' : '') + '</p>' : '') +
        (unused.length ? '<p class="mk-hint">' + plural(unused.length, 'photo') + ' not named in your list.</p>' : '');
    }
    row.querySelectorAll('input').forEach(function (inp) { inp.onchange = function () { b.photos = V().photoIndex(inp.files); b.rows = null; paint(); }; });
    view.appendChild(row); view.appendChild(status);
    paint();
    primary(c, view, 'Next: check', function () { go(c, next); });
  }
  /* ---- 4. Check ---- */
  function convert(c, b, list) {
    var conv = V().rowsToValues(b.table, b.mapping, list, { photos: needsPhotos(list) ? (b.photos || V().photoIndex([])) : null, fixed: b.fixed });
    return V().checkRows(c.scene.toJSON(), conv.rows).then(function (rows) { b.rows = rows; return rows; });
  }
  function viewCheck(c, view, list, b, next) {
    var status = el('<p class="vx-status" role="status" aria-live="polite">Checking ' + plural(b.table.rows.length, 'row') + '…</p>');
    view.appendChild(status);
    var box = el('<div class="vx-problems"></div>');
    view.appendChild(box);
    var btn = primary(c, view, 'Next: preview', function () { go(c, next); }, true);
    (b.rows ? Promise.resolve(b.rows) : convert(c, b, list)).then(function (rows) {
      if (B(c) !== b || b.step !== 'check') return;
      var bad = rows.filter(function (r) { return r.problems.length; });
      status.innerHTML = '<b>' + (rows.length - bad.length) + ' ready</b>' + (bad.length ? ' · ' + plural(bad.length, 'row needs', 'rows need') + ' a look' : ' · nothing to fix');
      btn.disabled = false;
      if (bad.length) {
        box.appendChild(c.ui.toggle('Leave out rows with missing or wrong values', b.skip !== false, function (on) { b.skip = on; }, 'Long text is shrunk or cut; it is only listed here.'));
        bad.slice(0, 200).forEach(function (r) { box.appendChild(problemCard(c, b, list, r)); });
        if (bad.length > 200) box.appendChild(el('<p class="mk-hint">And ' + (bad.length - 200) + ' more rows. The full list is in problems.csv inside the zip.</p>'));
      }
    });
  }
  function rowTitle(b, list, r) {
    var first = list.filter(function (d) { return d.type === 'text'; })[0];
    var v = first ? r.values[first.key] : '';
    return 'Row ' + (r.index + 1) + (v ? ' · ' + String(v).slice(0, 40) : '');
  }
  function problemCard(c, b, list, r) {
    var card = el('<div class="vx-prob"><div class="vx-prob-head"><b></b><button type="button" class="btn btn-sm btn-ghost">Fix here</button></div><ul></ul></div>');
    card.querySelector('b').textContent = rowTitle(b, list, r);
    r.problems.forEach(function (p) { var li = document.createElement('li'); li.textContent = p.message; li.className = 'is-' + p.kind; card.querySelector('ul').appendChild(li); });
    card.querySelector('button').onclick = function () {
      if (card.querySelector('.vx-fix')) return;
      var fix = el('<div class="vx-fix"></div>');
      var keys = {};
      r.problems.forEach(function (p) { if (p.key) keys[p.key] = 1; if (p.layer) list.forEach(function (d) { (d.uses || []).forEach(function (u) { if (u.layer === p.layer) keys[d.key] = 1; }); }); });
      Object.keys(keys).forEach(function (k) {
        var d = list.filter(function (x) { return x.key === k; })[0], ci = b.mapping[k];
        if (!d || !(ci >= 0)) return;
        var lab = el('<label class="vx-mini">' + esc(d.label || k) + '<input class="sx-input" type="text" autocomplete="off"></label>');
        var inp = lab.querySelector('input');
        inp.value = b.table.rows[r.index][ci] || '';
        inp.oninput = function () { b.table.rows[r.index][ci] = inp.value; };
        fix.appendChild(lab);
      });
      var save = el('<button type="button" class="btn btn-sm">Check this row again</button>');
      save.onclick = function () {
        var one = { columns: b.table.columns, rows: [b.table.rows[r.index]] };
        var conv = V().rowsToValues(one, b.mapping, list, { photos: needsPhotos(list) ? (b.photos || V().photoIndex([])) : null, fixed: b.fixed }).rows[0];
        conv.index = r.index; conv.values['#'] = r.index + 1; conv.values['#total'] = b.table.rows.length;
        V().checkRows(c.scene.toJSON(), [conv]).then(function () { b.rows[r.index] = conv; c.renderPanel(true); });
      };
      fix.appendChild(save);
      card.appendChild(fix);
      var f = fix.querySelector('input'); if (f) f.focus();
    };
    return card;
  }
  /* ---- 5. Preview ---- */
  function showRow(c, b) {
    var r = b.rows[b.preview];
    if (!r) return;
    var v = Object.assign({}, r.values);
    /* Photos of the list are previewed from their files, decoded once. */
    var jobs = [];
    defs(c).forEach(function (d) {
      if (d.type !== 'image' || !v[d.key]) return;
      var f = b.photos && b.photos.match(v[d.key]);
      if (!f) { delete v[d.key]; return; }
      var key = 'bulk:' + V().photoKey(f.name);
      v[d.key] = key;
      if (!c.scene._assets[key]) jobs.push(createImageBitmap(f).then(function (bm) { var s = Math.min(1, 1600 / Math.max(bm.width, bm.height)); var cv = document.createElement('canvas'); cv.width = Math.round(bm.width * s); cv.height = Math.round(bm.height * s); cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height); if (bm.close) bm.close(); c.scene.addAsset(key, cv); (b.previewAssets = b.previewAssets || []).push(key); }).catch(function () {}));
    });
    Promise.all(jobs).then(function () {
      c.scene._varPreview = LE.Scene.valuesOf(v) || {};
      c.scene._varMissing = 'empty';
      c.scene._varCache = {};
      c.scene._mark();
    });
  }
  function endPreview(c) {
    var sc = c && c.scene;
    if (!sc || !sc._varPreview) return;
    sc._varPreview = null; sc._varMissing = null; sc._varCache = {};
    var b = ST.bulk;
    if (b && b.previewAssets) { b.previewAssets.forEach(function (k) { if (sc._assets[k]) { var cv = sc._assets[k].canvas; delete sc._assets[k]; if (cv) { cv.width = 1; cv.height = 1; } } }); b.previewAssets = []; }
    sc._mark();
  }
  function viewPreview(c, view, list, b, next) {
    if (!b.rows) { go(c, 'check'); return; }
    var rows = b.rows, n = rows.length;
    if (c.isPhone() && c.sheet) c.sheet('half');   /* the page shows above the sheet */
    b.preview = Math.min(b.preview, n - 1);
    var bar = el('<div class="vx-stepper" role="group" aria-label="Row on the page"><button type="button" class="sx-iconbtn" data-d="-1" aria-label="Previous row">' + c.ic('back') + '</button><output aria-live="polite"></output><button type="button" class="sx-iconbtn" data-d="1" aria-label="Next row">' + c.ic('right') + '</button></div>');
    var out = bar.querySelector('output');
    function paint() {
      var r = rows[b.preview];
      out.textContent = rowTitle(b, list, r) + ' of ' + n + (r.problems.length ? ' · needs a look' : '');
      bar.querySelector('[data-d="-1"]').disabled = b.preview <= 0;
      bar.querySelector('[data-d="1"]').disabled = b.preview >= n - 1;
      sheet.querySelectorAll('.vx-thumb').forEach(function (t, i) { t.setAttribute('aria-current', i === b.preview ? 'true' : 'false'); });
      showRow(c, b);
    }
    bar.querySelectorAll('button').forEach(function (x) { x.onclick = function () { b.preview = Math.max(0, Math.min(n - 1, b.preview + Number(x.getAttribute('data-d')))); paint(); }; });
    view.appendChild(el('<p class="vx-lead">Each row on the real page. Step through them, or tap a thumbnail.</p>'));
    view.appendChild(bar);
    var only = el('<div class="vx-row"></div>');
    var flagged = rows.filter(function (r) { return r.problems.length; }).length;
    if (flagged) only.appendChild(c.ui.toggle('Only rows that need a look (' + flagged + ')', !!b.onlyBad, function (on) { b.onlyBad = on; drawSheet(); }));
    view.appendChild(only);
    var sheet = el('<div class="vx-sheet" role="list" aria-label="Contact sheet"></div>');
    view.appendChild(sheet);
    var token = (b.sheetToken = (b.sheetToken || 0) + 1);
    function drawSheet() {
      sheet.innerHTML = '';
      var shown = rows.map(function (r, i) { return i; }).filter(function (i) { return !b.onlyBad || rows[i].problems.length; }).slice(0, 120);
      shown.forEach(function (i) {
        var r = rows[i];
        var t = el('<button type="button" class="vx-thumb" role="listitem"><span class="vx-thumb-img"></span><span class="vx-thumb-n">' + (i + 1) + '</span>' + (r.problems.length ? '<span class="vx-flag" title="Needs a look">!</span>' : '') + '</button>');
        t.setAttribute('aria-label', rowTitle(b, list, r) + (r.problems.length ? ', needs a look' : ''));
        t.onclick = function () { b.preview = i; paint(); };
        sheet.appendChild(t);
      });
      if (rows.length > 120) sheet.appendChild(el('<p class="mk-hint">Showing the first 120 rows.</p>'));
      thumbs(c, b, sheet, shown, token);
      paint();
    }
    drawSheet();
    primary(c, view, 'Next: create', function () { go(c, next); });
  }
  /* Contact-sheet thumbnails, a few at a time, on one hidden scene (same engine as the export). */
  function thumbs(c, b, sheet, idxs, token) {
    var nodes = sheet.querySelectorAll('.vx-thumb-img');
    var doc = c.scene.toJSON();
    var i = 0;
    function step() {
      if (b.sheetToken !== token || !sheet.isConnected || i >= idxs.length) return;
      var batch = idxs.slice(i, i + 6).map(function (ri) { return b.rows[ri]; });
      var start = i;
      i += 6;
      V().run({ doc: doc, rows: batch.map(function (r) { return { values: r.values, index: r.index }; }), asset: assetFor(c), photos: b.photos, output: { kind: 'jpeg', scale: Math.min(1, 180 / Math.max(doc.width, doc.height)), quality: 0.7, name: '{{#}}' } }).then(function (res) {
        if (b.sheetToken !== token) return;
        return unzipFirst(res.blob, batch.length).then(function (blobs) {
          blobs.forEach(function (bl, k) { var n = nodes[start + k]; if (n && bl) { var u = URL.createObjectURL(bl); (b.urls = b.urls || []).push(u); n.style.backgroundImage = 'url(' + u + ')'; } });
        });
      }).then(function () { setTimeout(step, 30); }, function () {});
    }
    step();
  }
  /* Our own stored zip: entries are header + bytes, so they can be sliced out without inflating. */
  function unzipFirst(blob, n) {
    return blob.arrayBuffer().then(function (buf) {
      var dv = new DataView(buf), off = 0, out = [];
      while (out.length < n && off + 30 <= buf.byteLength && dv.getUint32(off, true) === 0x04034b50) {
        var size = dv.getUint32(off + 18, true), nl = dv.getUint16(off + 26, true), xl = dv.getUint16(off + 28, true);
        var start = off + 30 + nl + xl;
        out.push(new Blob([buf.slice(start, start + size)], { type: 'image/jpeg' }));
        off = start + size;
      }
      return out;
    });
  }
  function assetFor(c) {
    return function (id) {
      var m = c.S.mem && c.S.mem[id];
      if (m && m.canvas) return m.canvas;
      return LE.project && LE.project.assetRecord ? LE.project.assetRecord(id).then(function (r) { return r && r.blob ? r.blob : null; }) : null;
    };
  }
  /* ---- 6. Create ---- */
  var KINDS = [['zip', 'Images (zip)'], ['pdf', 'One PDF'], ['sheet', 'Print sheets'], ['pages', 'Pages here']];
  function viewMake(c, view, list, b) {
    if (!b.rows) { go(c, 'check'); return; }
    var o = b.out, doc = c.scene.toJSON();
    var skip = b.skip !== false;
    var rows = b.rows.filter(function (r) { return !(skip && r.problems.some(function (p) { return p.kind === 'missing' || p.kind === 'type'; })); });
    if (!o.name) o.name = defaultPattern(list, c);
    var prog = el('<div class="vx-progress" hidden><div class="vx-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Creating"><i></i></div><p class="vx-prog-t" aria-live="polite"></p><div class="vx-row"><button type="button" class="btn btn-sm" data-a="pause">Pause</button><button type="button" class="btn btn-sm btn-ghost" data-a="cancel">Cancel</button></div></div>');
    view.appendChild(prog);
    var doneBox = el('<div class="vx-done" hidden role="status"></div>');
    view.appendChild(doneBox);
    view.appendChild(el('<span class="vx-mini-label">What to make</span>'));
    view.appendChild(c.ui.seg(KINDS, o.kind, function (v) { o.kind = v; save(); c.renderPanel(true); }, 'sx-seg-sm vx-seg vx-kinds'));
    var opts = el('<div class="vx-opts"></div>');
    view.appendChild(opts);
    var cap = V().LIMITS.pages - (c.S.project ? c.S.project.pages.length : 1);
    if (o.kind === 'zip') {
      opts.appendChild(el('<span class="vx-mini-label">Format</span>'));
      opts.appendChild(c.ui.seg([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']], o.format, function (v) { o.format = v; save(); }, 'sx-seg-sm vx-seg'));
      opts.appendChild(el('<span class="vx-mini-label">Size</span>'));
      var max = c.maxScale ? c.maxScale() : 2;
      opts.appendChild(c.ui.seg([[0.5, '½×'], [1, '1×'], [2, '2×']].filter(function (s) { return s[0] <= max; }).map(function (s) { return [String(s[0]), s[1] + ' · ' + Math.round(doc.width * s[0]) + ' px']; }), String(o.scale), function (v) { o.scale = Number(v); save(); }, 'sx-seg-sm vx-seg'));
      var nm = el('<label class="vx-mini">File names<input class="sx-input" type="text" maxlength="200" spellcheck="false" autocomplete="off"></label>');
      var prev = el('<small class="mk-hint vx-names"></small>');
      var ni = nm.querySelector('input');
      ni.value = o.name;
      function names() { var f = V().namer(ni.value, o.format === 'jpeg' ? 'jpg' : o.format); prev.textContent = rows.slice(0, 3).map(function (r, i) { return f(r.values, i); }).join(', ') + (rows.length > 3 ? ', …' : ''); }
      ni.oninput = function () { o.name = ni.value; save(); names(); };
      names();
      opts.appendChild(nm); opts.appendChild(prev);
    } else if (o.kind === 'sheet') {
      opts.appendChild(el('<span class="vx-mini-label">Paper</span>'));
      opts.appendChild(c.ui.seg([['a4', 'A4'], ['letter', 'Letter'], ['a4-landscape', 'A4 wide'], ['letter-landscape', 'Letter wide']], o.paper, function (v) { o.paper = v; save(); paintSheet(); }, 'sx-seg-sm vx-seg'));
      var nat = V().pageMM(doc);
      var cw = el('<label class="vx-mini">Width of each on paper (mm)<input class="sx-input" type="number" min="10" max="290" step="1" inputmode="decimal"></label>');
      var ci = cw.querySelector('input');
      ci.value = Math.round(o.cellW || nat.w);
      ci.oninput = function () { o.cellW = Number(ci.value) || 0; save(); paintSheet(); };
      opts.appendChild(cw);
      opts.appendChild(c.ui.toggle('Cut marks', o.marks !== false, function (on) { o.marks = on; save(); }));
      var sn = el('<p class="mk-hint vx-sheetnote"></p>');
      opts.appendChild(sn);
      var paintSheet = function () { var S = V().sheetLayout(doc, { paper: o.paper, cellW: o.cellW || nat.w }); sn.textContent = S.per + ' per sheet (' + S.cols + ' × ' + S.rows + '), ' + Math.round(S.cell.w) + ' × ' + Math.round(S.cell.h) + ' mm each · ' + plural(Math.ceil(rows.length / S.per), 'sheet') + ' as one PDF.'; };
      paintSheet();
    } else if (o.kind === 'pages') {
      opts.appendChild(el('<p class="mk-hint">' + (rows.length > cap ? 'A design holds up to ' + V().LIMITS.pages + ' pages, so ' + Math.max(0, cap) + ' of your ' + rows.length + ' rows fit here. Use Images or One PDF for the rest.' : 'Adds ' + plural(rows.length, 'page') + ' after this one, each filled from its row. You can edit any of them.') + '</p>'));
    } else {
      opts.appendChild(el('<p class="mk-hint">One page per row, ' + (doc.print ? Math.round(doc.print.w) + ' × ' + Math.round(doc.print.h) + ' mm' : 'at the design size') + '.</p>'));
    }
    var cap2 = V().rowCap();
    var note = el('<p class="vx-status" role="status" aria-live="polite"></p>');
    if (rows.length > cap2) note.textContent = 'This device makes up to ' + cap2 + ' at a time; the first ' + cap2 + ' rows are used.';
    if (b.rows.length !== rows.length) note.textContent += ' ' + plural(b.rows.length - rows.length, 'row') + ' with problems left out.';
    view.appendChild(note);
    if (b.done) showDone(c, b, doneBox);
    var n = Math.min(rows.length, o.kind === 'pages' ? Math.max(0, cap) : cap2);
    var btn = primary(c, view, b.done ? 'Create again' : 'Create ' + plural(n, 'design'), function () { start(c, b, rows.slice(0, n), doc, list, prog, doneBox, btn); }, !n);
    function save() { lsSet('le-bulk-out', { kind: o.kind, format: o.format, scale: o.scale, paper: o.paper, cellW: 0, marks: o.marks }); }
  }
  function defaultPattern(list, c) {
    var first = list.filter(function (d) { return d.type === 'text' && d.required; })[0] || list.filter(function (d) { return d.type === 'text'; })[0];
    var nm = V().safeName((c.S.project && c.S.project.name) || 'design', 30).toLowerCase().replace(/\s+/g, '-');
    return (first ? '{{' + first.key + '}}-' : '{{#}}-') + nm;
  }
  function start(c, b, rows, doc, list, prog, doneBox, btn) {
    var o = b.out;
    if (o.kind === 'pages') return addPages(c, b, rows, doc);
    var gate = LE.support && LE.support.gate && rows.length > 200 ? function (run) { return LE.support.gate('variables.bulk', { title: 'Create ' + rows.length + ' designs', run: run }); } : function (run) { return run(); };
    endPreview(c);
    var ctl = b.job = { paused: false, cancelled: false };
    btn.disabled = true; btn.hidden = true;
    doneBox.hidden = true;
    prog.hidden = false;
    var bar = prog.querySelector('.vx-bar'), fill = bar.querySelector('i'), txt = prog.querySelector('.vx-prog-t');
    var pause = prog.querySelector('[data-a=pause]');
    pause.onclick = function () { ctl.paused = !ctl.paused; pause.textContent = ctl.paused ? 'Resume' : 'Pause'; txt.textContent = ctl.paused ? 'Paused' : txt.textContent; };
    prog.querySelector('[data-a=cancel]').onclick = function () { ctl.cancelled = true; txt.textContent = 'Cancelling…'; };
    txt.textContent = 'Starting…';
    var kind = o.kind === 'zip' ? o.format : o.kind === 'pdf' ? 'pdf' : 'sheet';
    gate(function () {
      return V().run({
        doc: doc, rows: rows.map(function (r) { return { values: r.values, index: r.index }; }), asset: assetFor(c), photos: b.photos, title: c.S.project && c.S.project.name,
        output: { kind: kind, scale: o.scale || 1, quality: o.format === 'png' ? undefined : 0.92, name: o.name, sheet: { paper: o.paper, cellW: o.cellW || 0, marks: o.marks !== false } },
        control: ctl,
        onProgress: function (p) {
          var pc = Math.round(p.done / p.total * 100);
          fill.style.width = pc + '%'; bar.setAttribute('aria-valuenow', String(pc));
          if (!ctl.paused && !ctl.cancelled) txt.textContent = p.done + ' of ' + p.total + (p.done < p.total && p.done >= 2 ? ' · about ' + fmtTime(p.eta) + ' left' : '');
        }
      });
    }).then(function (res) {
      prog.hidden = true; btn.hidden = false; btn.disabled = false;
      b.job = null;
      if (!res || res.cancelled) { c.toast('Cancelled. Nothing was downloaded.'); return; }
      var name = V().safeName((c.S.project && c.S.project.name) || 'designs', 60) + (res.ext === 'zip' ? '.zip' : '.pdf');
      b.done = { blob: res.blob, name: name, count: res.count, bytes: res.bytes, ms: res.ms, problems: res.problems, sheets: res.sheets };
      c.download(res.blob, name);
      showDone(c, b, doneBox);
      btn.textContent = 'Create again';
    }).catch(function (e) {
      prog.hidden = true; btn.hidden = false; btn.disabled = false; b.job = null;
      c.toast(e && e.message || 'Creating stopped. Your design is safe.');
    });
  }
  function showDone(c, b, box) {
    var d = b.done;
    box.hidden = false;
    box.innerHTML = '<p><b>Downloaded ' + esc(d.name) + '</b> · ' + (d.sheets ? plural(d.sheets, 'sheet') : plural(d.count, 'design')) + ' · ' + esc(c.fmtBytes(d.bytes)) + ' · ' + fmtTime(d.ms) + '</p>' + (d.problems && d.problems.length ? '<p class="mk-hint">' + plural(d.problems.length, 'note') + (/zip$/.test(d.name) ? ' in problems.csv inside the zip.' : '.') + '</p>' : '') + '<button type="button" class="btn btn-sm btn-ghost">Download again</button>';
    box.querySelector('button').onclick = function () { c.download(d.blob, d.name); };
  }
  function addPages(c, b, rows, doc) {
    var p = project(c);
    if (!p) return;
    var at = p.activePage, made = rows.map(function (r) { var pg = clone(doc); delete pg.id; pg.values = LE.Scene.valuesOf(r.values) || {}; return pg; });
    var ids = rows.map(function (r) { return r.values; });
    Array.prototype.splice.apply(p.pages, [at + 1, 0].concat(made));
    c.S.pageThumbs = {};
    if (c.renderFoot) c.renderFoot();
    c.markDirty();
    c.toast('Added ' + plural(made.length, 'page') + ' after this one.', { action: { label: 'Undo', fn: function () {
      var q = project(c);
      if (!q) return;
      var keep = q.pages.filter(function (pg) { return made.indexOf(pg) < 0; });
      if (q.activePage > at) c.switchPage(at);
      q.pages = keep.length ? keep : q.pages;
      c.S.pageThumbs = {};
      if (c.renderFoot) c.renderFoot();
      c.markDirty();
    } } });
    b.done = null;
    return ids;
  }

  /* ---------- registration ---------- */
  P.fields = {
    eyebrow: 'Template', title: 'Fields', rail: { label: 'Fields', icon: 'list' }, sheet: 'half',
    render: renderFields,
    doc: function (c) { if (sigOf(c) !== ST.lastSig) c.renderPanel(true); }
  };
  P.bulk = {
    eyebrow: 'Fields', title: 'Create many', sheet: 'full', keepSheet: true,
    render: renderBulk,
    close: function (c) { endPreview(c); var b = ST.bulk; if (b && b.urls) { b.urls.forEach(function (u) { URL.revokeObjectURL(u); }); b.urls = []; } b && (b.sheetToken = (b.sheetToken || 0) + 1); }
  };
  (P._cmds = P._cmds || {}).fields = function (c, arg) { if (arg === 'make') makeField(c); else c.openPanel(arg === 'bulk' ? 'bulk' : 'fields'); };
  (H.select = H.select || []).push(function (c) { if (c.S.panel === 'fields') setTimeout(function () { if (c.S.panel === 'fields' && sigOf(c) !== ST.lastSig) c.renderPanel(true); }, 0); });
  (H.page = H.page || []).push(function (c) { endPreview(c); if (ST.bulk) ST.bulk.page = -1; });
  (H['panel-close'] = H['panel-close'] || []).push(function (c, id) { if (id === 'bulk') endPreview(c); });
  (H['toolbar-add'] = H['toolbar-add'] || []).push(function (c, kind, l) {
    if (!l || l.type !== 'text') return '';
    var has = /\{\{/.test(l.text || '');
    return '<button type="button" class="sx-tb sx-tb-chip vx-tb" data-cmd="fields:' + (has ? 'open' : 'make') + '" data-pri="3" title="' + (has ? 'Fill the fields' : 'Make this text a field for templates') + '">' + (has ? 'Fields' : 'Make field') + '</button>';
  });
  /* Design → Templates also offers the ready templates. */
  (function wrapDesign() {
    var spec = P.design;
    if (!spec || typeof spec.render !== 'function' || spec.__vx) return;
    var orig = spec.render;
    P.design = Object.assign({}, spec, { __vx: true, render: function (c, body, o) {
      var r = orig.apply(this, arguments);
      if (o && o.tab === 'templates' && LE.variables) gallery(c, body, 'Fill-in templates');
      else if (o && o.tab === 'templates') ready().then(function () { if (c.S.panel === 'design' && c.S.panelOpts.tab === 'templates') gallery(c, c.E.panelBody, 'Fill-in templates'); });
      return r;
    } });
  })();
  /* A design with fields loads the filler now (lint reports unknown pipes; Fields opens at once). */
  (H.init = H.init || []).push(function (c) { if (c.scene && (c.scene._doc.layers || []).some(function (l) { return LE.varBoot.touches(l); })) ready(); });

  window.LEStudioVariables = {
    makeField: function () { return makeField(window.LEStudio); },
    setValues: function (v) { return setValues(window.LEStudio, v); },
    bulk: function () { return ST.bulk; },
    useTemplate: function (id) { return loadGallery().then(function (l) { var t = l.filter(function (x) { return x.id === id; })[0]; return t ? useTemplate(window.LEStudio, t) : null; }); },
    templates: loadGallery,
    endPreview: function () { endPreview(window.LEStudio); }
  };
})();
