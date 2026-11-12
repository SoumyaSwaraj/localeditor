/* LocalEditor Convert to PDF page: file list, page options, live preview, download and hand-off to PDF studio. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var d = document;

  var SIZES = { A4: [595, 842], Letter: [612, 792], Legal: [612, 1008], A3: [842, 1191], A5: [420, 595], Tabloid: [792, 1224] };
  /* Word, OpenDocument, HTML, Markdown and EPUB are written as searchable text by default (QA-010); slides stay pictures */
  var DOCS = { docx: 1, odt: 1, html: 1, markdown: 1, epub: 1 };
  var DEFAULTS = { output: 'text', font: 'sans', pageSize: 'A4', orientation: 'auto', margin: 'normal', scale: 100, fit: 'width', imageQuality: 85, sheets: '', lineNumbers: true, pageNumbers: false, header: '', footer: '' };
  var OUT_HINT = {
    text: 'Text can be selected, searched and read aloud. The layout is a clean reflow, not an exact copy.',
    picture: 'Each page is saved as a picture: it looks like the original, but text can’t be selected or searched and the file is larger.'
  };
  function isPicture(kind, o) { return kind === 'pptx' || (!!DOCS[kind] && (o || readOpts()).output === 'picture'); }

  var S = { files: [], sel: null, tok: 0, buildTok: 0, cache: [], built: null };
  var E = {};

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || d).querySelectorAll(s)); }
  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
  }
  var IC = {
    up: svg('<path d="m6 15 6-6 6 6"/>'),
    down: svg('<path d="m6 9 6 6 6-6"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    grip: svg('<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>'),
    alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    print: svg('<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>')
  };
  function say(msg, ms) { if (global.IT && IT.say) IT.say(msg, ms); }
  function bytesLabel(n) { return global.IT && IT.formatBytes ? IT.formatBytes(n) : Math.round(n / 1024) + ' KB'; }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, ''); }
  function uid() { return 'f' + Math.random().toString(36).slice(2, 9); }
  function isPhone() { return global.matchMedia('(max-width: 860px)').matches; }

  function lib() {
    if (LE.convert) return Promise.resolve(LE.convert);
    var root = d.documentElement.getAttribute('data-root') || '';
    return LE.lazy(root + 'assets/js/le-convert.js').then(function () { return LE.convert; });
  }
  function detect(file) {
    try { return LE.convert ? LE.convert.detect(file) : null; } catch (e) { return null; }
  }
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toUpperCase().slice(0, 4) : 'FILE'; }

  /* ---------- options ---------- */

  function readOpts() {
    var o = {};
    $$('[data-opt]', E.side).forEach(function (n) {
      var k = n.getAttribute('data-opt');
      if (n.classList.contains('seg')) {
        var on = $('[aria-pressed="true"]', n);
        o[k] = on ? on.getAttribute('data-v') : DEFAULTS[k];
      } else if (n.type === 'checkbox') o[k] = n.checked;
      else if (n.type === 'range') o[k] = +n.value;
      else o[k] = n.value;
    });
    return o;
  }
  function engineOpts(o, kind) {
    var out = {
      pageSize: o.pageSize === 'image' && kind !== 'image' && kind !== 'svg' ? 'A4' : o.pageSize,
      orientation: o.orientation,
      margin: o.margin,
      scale: o.scale,
      fit: o.pageSize === 'image' ? 'image' : o.fit,
      imageQuality: o.imageQuality / 100,
      lineNumbers: !!o.lineNumbers,
      pageNumbers: !!o.pageNumbers,
      output: o.output === 'picture' ? 'picture' : 'text',
      font: o.font === 'serif' ? 'serif' : 'sans'
    };
    /* text documents read best upright; "auto" only turns wide spreadsheets sideways */
    if (DOCS[kind] && out.orientation === 'auto' && out.output === 'text') out.orientation = 'portrait';
    if (o.header.trim()) out.header = o.header.trim();
    if (o.footer.trim()) out.footer = o.footer.trim();
    var sh = String(o.sheets || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { return /^\d+$/.test(s) ? Math.max(0, +s - 1) : s; });
    if (sh.length) out.sheets = sh;
    return out;
  }
  function writeOpts(o) {
    $$('[data-opt]', E.side).forEach(function (n) {
      var k = n.getAttribute('data-opt');
      if (n.classList.contains('seg')) $$('button', n).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(o[k]))); });
      else if (n.type === 'checkbox') n.checked = !!o[k];
      else n.value = o[k];
    });
    syncOutputs();
  }
  function syncOutputs() {
    $('#cv-scale-out').textContent = $('#cv-scale').value + '%';
    $('#cv-q-out').textContent = $('#cv-q').value + '%';
  }
  function saveOpts() {
    try { localStorage.setItem('le-convert-opts', JSON.stringify(readOpts())); } catch (e) {}
  }
  function loadOpts() {
    try {
      var o = JSON.parse(localStorage.getItem('le-convert-opts') || 'null');
      if (o && typeof o === 'object') writeOpts(Object.assign({}, DEFAULTS, o));
    } catch (e) {}
  }

  function kinds() {
    var k = {};
    S.files.forEach(function (f) { if (f.det) k[f.det.kind] = 1; });
    return k;
  }
  function syncKindFields() {
    var k = kinds();
    $$('[data-kinds]', E.side).forEach(function (n) {
      var show = n.getAttribute('data-kinds').split(' ').some(function (x) { return k[x]; });
      if (n.tagName === 'OPTION') { n.hidden = !show; n.disabled = !show; }
      else n.hidden = !show;
    });
    var size = $('#cv-size');
    if (size.value === 'image' && !(k.image || k.svg)) size.value = 'A4';
    syncOutput();
  }
  /* "Text style" only matters for searchable text; hide it when every document is saved as pictures */
  function syncOutput() {
    var o = readOpts();
    var k = kinds();
    $$('[data-output]', E.side).forEach(function (n) {
      if (n.hidden) return;
      var docsOnly = n.getAttribute('data-kinds').split(' ').every(function (x) { return !k[x] || DOCS[x]; });
      if (docsOnly && n.getAttribute('data-output') !== o.output) n.hidden = true;
    });
    var hint = $('#cv-out-hint');
    if (hint) hint.textContent = OUT_HINT[o.output] || OUT_HINT.text;
  }

  /* ---------- files ---------- */

  function addFiles(list) {
    list = [].slice.call(list || []).filter(function (f) { return f && f.size >= 0; });
    if (!list.length) return;
    var first = !S.files.length;
    lib().then(function () {
      list.forEach(function (f) { S.files.push({ id: uid(), file: f, det: detect(f) }); });
      if (first || !S.sel) S.sel = S.files[0].id;
      var bad = list.filter(function (f) { var x = detect(f); return x && x.kind === 'unsupported'; }).length;
      if (bad) say(bad === 1 ? 'One file can’t be converted. It is marked in the list.' : bad + ' files can’t be converted. They are marked in the list.', 4200);
      render();
      schedule(0);
    }, function () { say('The converter could not load. Reload the page and try again.', 4200); });
  }
  function usable() { return S.files.filter(function (f) { return f.det && f.det.kind !== 'unsupported'; }); }

  function render() {
    var has = S.files.length > 0;
    d.body.classList.toggle('cv-has-files', has);
    E.start.hidden = has;
    E.count.textContent = has ? String(S.files.length) : '';
    E.orderHint.hidden = S.files.length < 2;
    E.list.innerHTML = '';
    S.files.forEach(function (f, i) {
      var li = el('li', 'cv-item');
      li.setAttribute('data-id', f.id);
      li.draggable = true;
      li.tabIndex = 0;
      if (f.id === S.sel) li.setAttribute('aria-current', 'true');
      var bad = f.det && f.det.kind === 'unsupported';
      if (bad) li.classList.add('is-bad');
      var grip = el('span', 'cv-grip');
      grip.innerHTML = IC.grip;
      grip.setAttribute('aria-hidden', 'true');
      var badge = el('b', 'cv-badge k-' + (f.det ? f.det.kind : 'unsupported'), extOf(f.file.name));
      var body = el('span', 'cv-item-body');
      body.appendChild(el('span', 'cv-item-name', f.file.name || 'Untitled'));
      body.appendChild(el('span', 'cv-item-meta', (f.det ? f.det.label : 'File') + ' · ' + bytesLabel(f.file.size)));
      if (f.det && f.det.note) body.appendChild(el('span', 'cv-item-note' + (bad ? ' is-bad' : ''), f.det.note));
      var acts = el('span', 'cv-item-acts');
      [['up', 'Move up', i === 0], ['down', 'Move down', i === S.files.length - 1], ['x', 'Remove']].forEach(function (a) {
        var b = el('button', 'cv-ib cv-ib-sm');
        b.type = 'button';
        b.innerHTML = IC[a[0]];
        b.setAttribute('aria-label', a[1] + ' ' + (f.file.name || ''));
        b.title = a[1];
        b.setAttribute('data-item', a[0]);
        if (a[2]) b.disabled = true;
        acts.appendChild(b);
      });
      li.appendChild(grip);
      li.appendChild(badge);
      li.appendChild(body);
      li.appendChild(acts);
      E.list.appendChild(li);
    });
    syncKindFields();
    updateMeta();
  }
  function move(id, delta) {
    var i = S.files.findIndex(function (f) { return f.id === id; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= S.files.length) return;
    var f = S.files.splice(i, 1)[0];
    S.files.splice(j, 0, f);
    S.built = null;
    render();
    var again = $('.cv-item[data-id="' + id + '"] [data-item="' + (delta < 0 ? 'up' : 'down') + '"]');
    if (again && !again.disabled) again.focus();
  }
  function remove(id) {
    S.files = S.files.filter(function (f) { return f.id !== id; });
    if (S.sel === id) S.sel = S.files.length ? S.files[0].id : null;
    S.built = null;
    render();
    if (S.files.length) schedule(0);
    else { S.tok++; E.pages.innerHTML = ''; E.warn.hidden = true; }
  }
  function selected() { return S.files.filter(function (f) { return f.id === S.sel; })[0] || null; }

  function bindList() {
    E.list.addEventListener('click', function (e) {
      var li = e.target.closest('.cv-item');
      if (!li) return;
      var id = li.getAttribute('data-id');
      var b = e.target.closest('[data-item]');
      if (b) {
        var a = b.getAttribute('data-item');
        if (a === 'up') move(id, -1);
        else if (a === 'down') move(id, 1);
        else remove(id);
        return;
      }
      if (S.sel !== id) { S.sel = id; render(); schedule(0); }
    });
    E.list.addEventListener('keydown', function (e) {
      var li = e.target.closest('.cv-item');
      if (!li || e.target !== li) return;
      var id = li.getAttribute('data-id');
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        move(id, e.key === 'ArrowUp' ? -1 : 1);
        var n = $('.cv-item[data-id="' + id + '"]');
        if (n) n.focus();
      } else if (e.key === 'Delete') remove(id);
    });
    var dragId = null;
    E.list.addEventListener('dragstart', function (e) {
      var li = e.target.closest('.cv-item');
      if (!li) return;
      dragId = li.getAttribute('data-id');
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
    });
    E.list.addEventListener('dragover', function (e) {
      if (!dragId) return;
      e.preventDefault();
      var li = e.target.closest('.cv-item');
      $$('.cv-item', E.list).forEach(function (n) { n.classList.remove('drop-before', 'drop-after'); });
      if (!li || li.getAttribute('data-id') === dragId) return;
      var r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    E.list.addEventListener('drop', function (e) {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      var li = e.target.closest('.cv-item');
      if (li && li.getAttribute('data-id') !== dragId) {
        var after = li.classList.contains('drop-after');
        var f = S.files.filter(function (x) { return x.id === dragId; })[0];
        S.files = S.files.filter(function (x) { return x.id !== dragId; });
        var at = S.files.findIndex(function (x) { return x.id === li.getAttribute('data-id'); }) + (after ? 1 : 0);
        S.files.splice(at, 0, f);
        S.built = null;
      }
      dragId = null;
      render();
    });
    E.list.addEventListener('dragend', function () {
      dragId = null;
      $$('.cv-item', E.list).forEach(function (n) { n.classList.remove('is-dragging', 'drop-before', 'drop-after'); });
    });
  }

  /* ---------- preview ---------- */

  var timer = 0;
  function schedule(delay) {
    clearTimeout(timer);
    S.built = null;
    timer = setTimeout(preview, delay == null ? 350 : delay);
  }
  function pageAspect(o, kind) {
    var s = SIZES[o.pageSize] || SIZES.A4;
    var land = o.orientation === 'landscape' || (o.orientation === 'auto' && kind === 'pptx');
    if (kind === 'pptx' && o.orientation === 'auto') return 16 / 9;
    return land ? s[1] / s[0] : s[0] / s[1];
  }
  function skeleton(n, ar) {
    E.pages.innerHTML = '';
    for (var i = 0; i < n; i++) {
      var card = el('figure', 'cv-page is-loading');
      card.style.setProperty('--ar', ar.toFixed(4));
      var sheet = el('div', 'cv-sheet');
      sheet.appendChild(el('span', 'cv-sk'));
      card.appendChild(sheet);
      card.appendChild(el('figcaption', null, String(i + 1)));
      E.pages.appendChild(card);
    }
  }
  function optsKey(f, o) { return f.id + '|' + JSON.stringify(o); }
  function cacheGet(k) {
    for (var i = 0; i < S.cache.length; i++) if (S.cache[i].k === k) return S.cache[i].v;
    return null;
  }
  function cachePut(k, v) {
    S.cache = [{ k: k, v: v }].concat(S.cache.filter(function (x) { return x.k !== k; })).slice(0, 6);
  }

  function preview() {
    var f = selected();
    var tok = ++S.tok;
    if (!f) return;
    var o = readOpts();
    var kind = f.det ? f.det.kind : 'unsupported';
    E.prevName.textContent = f.file.name || 'Preview';
    showWarnings(f, null);
    if (kind === 'unsupported') {
      E.pages.innerHTML = '';
      var msg = el('div', 'cv-empty-prev');
      msg.appendChild(el('strong', null, 'This file can’t be converted'));
      msg.appendChild(el('span', null, f.det ? f.det.note : ''));
      E.pages.appendChild(msg);
      E.prevMeta.textContent = '';
      return;
    }
    var eo = engineOpts(o, kind);
    var key = optsKey(f, eo);
    var hit = cacheGet(key);
    if (hit) { show(hit, eo, kind); return; }
    var existing = $$('.cv-page:not(.is-loading)', E.pages);
    if (existing.length) {
      E.pages.classList.add('is-busy');
      existing.forEach(function (c) { c.style.setProperty('--ar', pageAspect(o, kind).toFixed(4)); });
    } else skeleton(kind === 'image' || kind === 'svg' ? 1 : 3, pageAspect(o, kind));
    E.prevMeta.textContent = 'Rendering…';
    lib().then(function (C) {
      return C.previewPages(f.file, eo);
    }).then(function (canvases) {
      if (tok !== S.tok) return;
      cachePut(key, canvases);
      show(canvases, eo, kind);
    }, function (err) {
      if (tok !== S.tok) return;
      E.pages.classList.remove('is-busy');
      E.pages.innerHTML = '';
      var msg = el('div', 'cv-empty-prev');
      msg.appendChild(el('strong', null, 'Preview failed'));
      msg.appendChild(el('span', null, err && err.message ? err.message : 'This file could not be read.'));
      E.pages.appendChild(msg);
      E.prevMeta.textContent = '';
    });
  }
  function show(canvases, eo, kind) {
    E.pages.classList.remove('is-busy');
    E.pages.innerHTML = '';
    canvases.forEach(function (c, i) {
      var card = el('figure', 'cv-page');
      card.style.setProperty('--ar', (c.width / Math.max(1, c.height)).toFixed(4));
      var sheet = el('div', 'cv-sheet');
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Page ' + (i + 1));
      sheet.appendChild(c);
      card.appendChild(sheet);
      card.appendChild(el('figcaption', null, String(i + 1)));
      E.pages.appendChild(card);
    });
    var size = eo.pageSize === 'image' ? 'Image size' : eo.pageSize;
    var n = canvases.length;
    var base = n + ' page' + (n === 1 ? '' : 's') + ' · ' + size + (eo.orientation !== 'auto' ? ' ' + eo.orientation : '');
    E.prevMeta.textContent = base;
    var f = selected();
    if (f) showWarnings(f, null);
    if (!f || !f.det) return;
    var tok = S.tok;
    if (f.det.kind === 'image' || f.det.kind === 'svg') return;
    if (isPicture(f.det.kind, null)) { resultLabel(base, { mode: 'picture' }); return; }
    /* the preview was drawn from the finished PDF, so this is a cache hit: show its size and what it contains */
    lib().then(function (C) { return C.toPDF(f.file, eo); }).then(function (res) {
      if (tok !== S.tok) return;
      resultLabel(base + ' · ' + bytesLabel(res.bytes.length), res);
      if (res.mode === 'picture') showWarnings(f, res.warnings, res);
    }, function () {});
  }
  function resultLabel(prefix, res) {
    E.prevMeta.textContent = prefix + ' · ';
    var pic = res && res.mode === 'picture';
    E.prevMeta.appendChild(el('span', 'cv-result' + (pic ? ' is-picture' : ''), pic ? 'Pages are pictures' : 'Text can be selected and searched'));
  }

  function showWarnings(f, extra, res) {
    var box = E.warn;
    box.innerHTML = '';
    var kind = f.det ? f.det.kind : '';
    var lines = [];
    if (f.det && f.det.note && kind !== 'unsupported') lines.push(f.det.note);
    var fallback = null;
    (extra || []).forEach(function (w) {
      if (/^Saved as pictures/.test(w)) { fallback = w; return; }
      if (/^Searchable text:/.test(w)) return;
      if (lines.indexOf(w) < 0) lines.push(w);
    });
    var raster = isPicture(kind, null) || !!fallback;
    if (!lines.length && !raster) { box.hidden = true; return; }
    box.hidden = false;
    var head = el('div', 'cv-warn-head');
    head.innerHTML = IC.alert;
    head.appendChild(el('strong', null, fallback ? 'Saved as pictures' : raster ? (kind === 'pptx' ? 'Slides are saved as pictures' : 'Pages are pictures of the document') : 'Good to know'));
    box.appendChild(head);
    if (fallback) box.appendChild(el('p', null, fallback.replace(/^Saved as pictures:\s*/, '').replace(/^./, function (c) { return c.toUpperCase(); }) + ' The pages look right, but their text can’t be selected or searched.'));
    else if (raster && kind === 'pptx') box.appendChild(el('p', null, 'Each slide is a picture, so its text can’t be selected or searched. For selectable text, print to PDF from the browser instead.'));
    else if (raster) box.appendChild(el('p', null, 'They look exactly like the preview, but the text can’t be selected or searched. Choose “Searchable text” for a smaller file with real text.'));
    if (lines.length) {
      var ul = el('ul');
      lines.slice(0, 6).forEach(function (w) { ul.appendChild(el('li', null, w)); });
      box.appendChild(ul);
    }
    if (raster) {
      var b = el('button', 'btn btn-sm');
      b.type = 'button';
      b.innerHTML = IC.print + '<span>Print for selectable text</span>';
      b.addEventListener('click', function () { printVector(f); });
      box.appendChild(b);
    }
  }

  function printVector(f) {
    lib().then(function (C) {
      return C.print(f.file, engineOpts(readOpts(), f.det.kind));
    }).then(function (res) {
      if (res && res.warnings) say('In the print dialog, choose “Save as PDF”.', 4200);
    }, function (err) { say('Could not open the print dialog: ' + (err && err.message ? err.message : err), 4200); });
  }

  /* ---------- build, download, hand-off ---------- */

  var prog = { tok: 0 };
  function progress(label) {
    var box = $('#cv-progress');
    box.hidden = false;
    $('.cv-prog-label', box).textContent = label;
    $('.cv-prog-sub', box).textContent = '';
    $('.cv-prog-bar', box).classList.add('is-indet');
    var t = ++prog.tok;
    var st = { cancelled: false };
    $('.cv-prog-cancel', box).onclick = function () { st.cancelled = true; box.hidden = true; say('Stopped'); };
    return {
      sub: function (s) { if (t === prog.tok) $('.cv-prog-sub', box).textContent = s; },
      cancelled: function () { return st.cancelled; },
      end: function () { if (t === prog.tok) box.hidden = true; }
    };
  }
  function outName() {
    var list = usable();
    if (list.length === 1) return baseName(list[0].file.name) + '.pdf';
    return baseName(list[0].file.name) + '-and-' + (list.length - 1) + '-more.pdf';
  }
  function build() {
    var list = usable();
    if (!list.length) return Promise.reject(new Error('Add a file that can be converted'));
    var o = readOpts();
    var key = list.map(function (f) { return optsKey(f, engineOpts(o, f.det.kind)); }).join('#');
    if (S.built && S.built.key === key) return Promise.resolve(S.built);
    var pr = progress(list.length > 1 ? 'Converting ' + list.length + ' files' : 'Converting ' + list[0].file.name);
    pr.sub(list.length > 1 ? 'Merging into one PDF, top to bottom' : 'Building pages');
    var mixed = list.some(function (f) { return f.det.kind !== list[0].det.kind; });
    var job = lib().then(function (C) {
      if (list.length === 1) return C.toPDF(list[0].file, engineOpts(o, list[0].det.kind));
      return C.many(list.map(function (f) { return f.file; }), engineOpts(o, mixed ? '' : list[0].det.kind));
    });
    return job.then(function (res) {
      if (pr.cancelled()) { var e = new Error('Cancelled'); e.cancelled = true; throw e; }
      pr.end();
      var pictures = res.parts ? res.parts.some(function (p) { return p.mode === 'picture'; }) : res.mode === 'picture';
      list.forEach(function (x) { if (isPicture(x.det.kind, o)) pictures = true; });
      S.built = { key: key, bytes: res.bytes, pageCount: res.pageCount, warnings: res.warnings || [], name: outName(), mode: pictures ? 'picture' : 'text', mixed: list.length > 1 };
      var f = selected();
      if (f && S.built.warnings.length) showWarnings(f, S.built.warnings.map(function (w) { return w.replace(/^[^:]+\.[a-z0-9]+:\s*/i, ''); }), list.length === 1 ? res : null);
      updateMeta();
      return S.built;
    }, function (err) {
      pr.end();
      throw err;
    });
  }
  function download() {
    build().then(function (b) {
      IT.download(new Blob([b.bytes], { type: 'application/pdf' }), b.name);
      say('PDF ready · ' + b.pageCount + ' page' + (b.pageCount === 1 ? '' : 's'));
    }, function (err) { if (!err.cancelled) say(err.message || 'Conversion failed', 4200); });
  }
  function toStudio() {
    build().then(function (b) {
      return LE.handoff.put(new Blob([b.bytes], { type: 'application/pdf' }), { name: b.name, from: 'convert' }).then(function () {
        location.href = '../pdf-studio/?from=convert';
      });
    }).catch(function (err) { if (!err.cancelled) say(err.message || 'Could not open PDF Studio', 4200); });
  }
  function updateMeta() {
    var list = usable();
    var t = list.length ? list.length + ' file' + (list.length === 1 ? '' : 's') : 'No convertible files';
    if (list.length > 1) t += ' → one PDF';
    if (S.built && S.built.pageCount) t += ' · ' + S.built.pageCount + ' pages · ' + bytesLabel(S.built.bytes.length);
    E.barMeta.textContent = t;
    if (S.built && S.built.pageCount) {
      var pic = S.built.mode === 'picture';
      E.barMeta.appendChild(d.createTextNode(' · '));
      E.barMeta.appendChild(el('span', 'cv-result' + (pic ? ' is-picture' : ''), pic ? (S.built.mixed ? 'Some pages are pictures' : 'Pages are pictures') : 'Text can be selected and searched'));
    }
    $$('[data-cv="download"], [data-cv="studio"]').forEach(function (b) { b.disabled = !list.length; });
  }

  /* ---------- settings ---------- */

  function openSettings(anchor) {
    var pop = $('#cv-settings');
    if (!pop.hidden) { pop.hidden = true; return; }
    pop.innerHTML = '';
    pop.appendChild(el('h3', null, 'Performance'));
    var mode = LE.perf ? LE.perf.mode() : 'auto';
    [['auto', 'Auto', 'Matches this device'], ['quality', 'Best quality', 'Sharpest previews'], ['saver', 'Battery saver', 'Lighter previews for older phones']].forEach(function (o) {
      var b = el('button', 'cv-opt');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(mode === o[0]));
      b.appendChild(el('strong', null, o[1]));
      b.appendChild(el('small', null, o[2]));
      b.addEventListener('click', function () {
        if (LE.perf) LE.perf.set(o[0]);
        $$('.cv-opt[role="radio"]', pop).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        S.cache = [];
        schedule(0);
      });
      pop.appendChild(b);
    });
    pop.appendChild(el('h3', null, 'Appearance'));
    var t = el('button', 'cv-opt');
    t.type = 'button';
    t.setAttribute('data-theme-toggle', '');
    t.appendChild(el('strong', null, 'Switch light / dark'));
    t.appendChild(el('small', null, 'Pages stay white so colors stay true'));
    pop.appendChild(t);
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(global.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    setTimeout(function () {
      d.addEventListener('pointerdown', function off(e) {
        if (pop.contains(e.target) || anchor.contains(e.target)) return;
        pop.hidden = true;
        d.removeEventListener('pointerdown', off);
      });
    }, 0);
  }

  /* ---------- boot ---------- */

  var picker;
  function pick() {
    if (!picker) {
      picker = d.createElement('input');
      picker.type = 'file';
      picker.multiple = true;
      picker.hidden = true;
      picker.accept = '.pdf,.docx,.pptx,.pptm,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.odt,.rtf,.txt,.log,.md,.markdown,.html,.htm,.json,.epub,.svg,image/*,.js,.ts,.css,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.sh,.xml,.yaml,.yml,.sql';
      picker.addEventListener('change', function () { addFiles(picker.files); picker.value = ''; });
      d.body.appendChild(picker);
    }
    picker.click();
  }

  function boot() {
    E.side = $('#cv-side');
    E.start = $('#cv-start');
    E.list = $('#cv-list');
    E.count = $('#cv-count');
    E.orderHint = $('#cv-order-hint');
    E.pages = $('#cv-pages');
    E.warn = $('#cv-warn');
    E.prevName = $('#cv-prev-name');
    E.prevMeta = $('#cv-prev-meta');
    E.barMeta = $('#cv-bar-meta');
    loadOpts();
    bindList();
    syncKindFields();

    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cv]');
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-cv');
      if (a === 'pick') pick();
      else if (a === 'download') download();
      else if (a === 'studio') toStudio();
      else if (a === 'settings') openSettings(b);
      else if (a === 'reset') { writeOpts(DEFAULTS); saveOpts(); syncKindFields(); schedule(0); }
    });
    E.side.addEventListener('click', function (e) {
      var b = e.target.closest('.cv-seg button');
      if (!b) return;
      $$('button', b.parentNode).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      saveOpts();
      if (b.parentNode.getAttribute('data-opt') === 'output') syncKindFields();
      schedule(150);
    });
    E.side.addEventListener('input', function (e) {
      if (!e.target.matches('[data-opt]')) return;
      syncOutputs();
      saveOpts();
      schedule(e.target.type === 'range' ? 300 : 450);
    });
    E.side.addEventListener('change', function (e) {
      if (!e.target.matches('select[data-opt], input[type="checkbox"][data-opt]')) return;
      saveOpts();
      schedule(100);
    });
    $('.cv-zoom').addEventListener('click', function (e) {
      var b = e.target.closest('[data-zoom]');
      if (!b) return;
      $$('[data-zoom]', b.parentNode).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      E.pages.setAttribute('data-zoom', b.getAttribute('data-zoom'));
    });

    var depth = 0;
    d.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      depth++;
      d.body.classList.add('cv-dragging');
    });
    d.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) d.body.classList.remove('cv-dragging'); });
    d.addEventListener('dragover', function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
    d.addEventListener('drop', function (e) {
      depth = 0;
      d.body.classList.remove('cv-dragging');
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    });
    d.addEventListener('paste', function (e) {
      var files = e.clipboardData && e.clipboardData.files;
      if (!files || !files.length || (e.target && e.target.matches && e.target.matches('input, textarea'))) return;
      e.preventDefault();
      addFiles(files);
    });
    d.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && S.files.length) { e.preventDefault(); download(); }
      if (e.key === 'Escape') { var p = $('#cv-settings'); if (!p.hidden) p.hidden = true; }
    });
    updateMeta();
    var idle = global.requestIdleCallback || function (fn) { return setTimeout(fn, 1200); };
    idle(function () { lib().catch(function () {}); });
    d.body.classList.add('cv-ready');
  }

  global.CV = { S: S, addFiles: addFiles, build: build, readOpts: readOpts, schedule: schedule };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})(window);
