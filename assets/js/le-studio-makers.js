/* LocalEditor: quick makers in the studio (gallery, forms, live preview, edit details, ?make= links). */
(function () {
  'use strict';
  var LE = window.LE;
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  (window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || []).push({ id: 'makers', name: 'Quick makers', needs: [], wants: [] });
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var ST = { q: '', cat: '', thumbs: {}, thumbJobs: {}, samples: {}, form: null };
  function root() { var r = document.documentElement.getAttribute('data-root') || ''; if (r && r.charAt(r.length - 1) !== '/') r += '/'; return r; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /* ---------- Images: the person's photos (studio memory) and sample photos (served with the app) ---------- */
  function sampleFile(id) { return root() + 'assets/photos/collage/' + id.slice(7).replace(/[^\w-]/g, '') + '.jpg'; }
  function loadSample(id) {
    if (ST.samples[id]) return ST.samples[id];
    ST.samples[id] = fetch(sampleFile(id)).then(function (r) { if (!r.ok) throw new Error('missing'); return r.blob(); })
      .then(function (b) { return createImageBitmap(b); })
      .then(function (bm) { var c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0); if (bm.close) bm.close(); return c; })
      .catch(function () { delete ST.samples[id]; return null; });
    return ST.samples[id];
  }
  function photoIds(m, values) {
    var out = [];
    m.inputs.forEach(function (inp) {
      var v = values[inp.key];
      if (inp.type === 'photo' && v) out.push(v);
      if (inp.type === 'photos' && Array.isArray(v)) v.forEach(function (x) { if (x) out.push(x); });
    });
    return out;
  }
  function images(c, m, values) {
    var ids = photoIds(m, values), map = {};
    return Promise.all(ids.map(function (id) {
      if (/^sample:/.test(id)) return loadSample(id).then(function (cv) { if (cv) map[id] = cv; });
      var mem = c && c.mem && c.mem[id];
      if (mem && mem.canvas) { map[id] = mem.canvas; return null; }
      if (!c || !LE.project || !LE.project.assetRecord) return null;
      return LE.project.assetRecord(id).then(function (rec) { return rec && rec.blob ? createImageBitmap(rec.blob) : null; }).then(function (bm) {
        if (!bm) return;
        var cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0);
        map[id] = cv;
      }).catch(function () {});
    })).then(function () { return map; });
  }
  /* Sample photos become real assets of the design when it is made. */
  function ingestSamples(c, m, values) {
    var out = clone(values), jobs = [];
    m.inputs.forEach(function (inp) {
      function one(id) {
        if (!/^sample:/.test(id || '')) return Promise.resolve(id);
        return fetch(sampleFile(id)).then(function (r) { return r.blob(); }).then(function (b) {
          return c.ingest(new File([b], id.slice(7) + '.jpg', { type: 'image/jpeg' }));
        }).then(function (meta) { return meta.id; }).catch(function () { return ''; });
      }
      if (inp.type === 'photo' && out[inp.key]) jobs.push(one(out[inp.key]).then(function (id) { if (id) out[inp.key] = id; else delete out[inp.key]; }));
      if (inp.type === 'photos' && Array.isArray(out[inp.key])) jobs.push(Promise.all(out[inp.key].map(one)).then(function (ids) { out[inp.key] = ids.filter(Boolean); }));
    });
    return Promise.all(jobs).then(function () { return out; });
  }

  /* A detached scene normalises a built page into exactly what LE.Scene stores. */
  function normalize(doc) {
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:32px;height:32px;';
    document.body.appendChild(host);
    var sc = new LE.Scene({ el: host, width: doc.width, height: doc.height });
    sc.load(doc);
    var out = sc.toJSON();
    sc.destroy();
    host.remove();
    return out;
  }

  /* ---------- Gallery ---------- */
  function thumb(id, node) {
    if (ST.thumbs[id]) { paintThumb(node, ST.thumbs[id]); return; }
    if (ST.thumbJobs[id]) { ST.thumbJobs[id].then(function (u) { if (u) paintThumb(node, u); }); return; }
    var m = M.get(id);
    var vals = clone(m.sample.values || {});
    ST.thumbJobs[id] = images(null, m, vals).then(function (imgs) {
      return M.build(id, vals, { images: imgs, size: 'portrait', today: '2026-11-12' }).then(function (out) {
        return M.renderPage(out.pages[0], { images: imgs, maxEdge: 360 });
      });
    }).then(function (cv) { ST.thumbs[id] = cv.toDataURL('image/jpeg', 0.86); return ST.thumbs[id]; }).catch(function () { return ''; });
    ST.thumbJobs[id].then(function (u) { if (u) paintThumb(node, u); });
  }
  function paintThumb(node, url) {
    var img = node.querySelector('img');
    if (!img) { img = new Image(); img.alt = ''; node.appendChild(img); }
    img.src = url;
    node.classList.add('is-ready');
  }
  function lazyThumbs(container) {
    var nodes = [].slice.call(container.querySelectorAll('[data-mk-thumb]'));
    if (!('IntersectionObserver' in window)) { nodes.forEach(function (n) { thumb(n.getAttribute('data-mk-thumb'), n); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        thumb(en.target.getAttribute('data-mk-thumb'), en.target);
      });
    }, { rootMargin: '200px' });
    nodes.forEach(function (n) { io.observe(n); });
  }
  function card(c, m, compact) {
    var b = el('<button type="button" class="mk-card' + (compact ? ' is-compact' : '') + '" data-maker="' + esc(m.id) + '"><span class="mk-thumb" data-mk-thumb="' + esc(m.id) + '"></span><b>' + esc(m.name) + '</b>' + (compact ? '' : '<small>' + esc(m.summary) + '</small>') + '</button>');
    b.onclick = function () { open(c, m.id); };
    return b;
  }
  function matches(m, q) {
    if (!q) return true;
    var hay = (m.name + ' ' + m.summary + ' ' + m.category + ' ' + m.keywords.join(' ')).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (t) { return hay.indexOf(t) >= 0; });
  }
  function renderGallery(c, body) {
    var wrap = el('<div class="mk-gallery"><p class="mk-lede">Fill in a few words, add a photo, pick a style. You get a finished design where every part stays editable.</p></div>');
    body.appendChild(wrap);
    var made = c.scene && c.scene.toJSON().maker;
    if (made && M.get(made.id)) {
      var ban = el('<div class="mk-banner"><span>This page was made with <b>' + esc(M.get(made.id).name) + '</b>.</span><button type="button" class="btn btn-sm">Edit details</button></div>');
      ban.querySelector('button').onclick = function () { editDetails(c); };
      wrap.appendChild(ban);
    }
    var search = el('<label class="sx-search mk-search">' + c.ic('search') + '<input type="search" placeholder="Search makers" aria-label="Search makers"></label>');
    var input = search.querySelector('input');
    input.value = ST.q;
    wrap.appendChild(search);
    var chips = el('<div class="sx-chips is-scroll mk-cats" role="group" aria-label="Categories"></div>');
    wrap.appendChild(chips);
    var grid = el('<div class="mk-grid" aria-live="polite"></div>');
    wrap.appendChild(grid);
    M.ready().then(function (list) {
      var cats = [];
      list.forEach(function (m) { if (cats.indexOf(m.category) < 0) cats.push(m.category); });
      [''].concat(cats).forEach(function (cat) {
        var b = el('<button type="button" class="sx-chip" aria-pressed="' + (ST.cat === cat) + '">' + esc(cat || 'All') + '</button>');
        b.onclick = function () { ST.cat = cat; chips.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); fill(); };
        chips.appendChild(b);
      });
      function fill() {
        grid.innerHTML = '';
        var shown = list.filter(function (m) { return (!ST.cat || m.category === ST.cat) && matches(m, ST.q); });
        shown.forEach(function (m) { grid.appendChild(card(c, m)); });
        if (!shown.length) grid.appendChild(el('<p class="sx-note">No maker matches “' + esc(ST.q) + '”.</p>'));
        lazyThumbs(grid);
      }
      var t = 0;
      input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { ST.q = input.value.trim().slice(0, 60); fill(); }, 120); });
      fill();
    });
  }

  /* ---------- Form sheet ---------- */
  function today() { return M.date.today(); }
  function open(c, id, opts) {
    opts = opts || {};
    return M.ready().then(function () {
      var m = M.get(id);
      if (!m) { if (c && c.toast) c.toast('That maker is not available.'); return null; }
      close();
      var values = opts.values ? clone(opts.values) : clone(m.sample.values || {});
      var F = ST.form = { c: c, m: m, values: values, style: opts.style || m.styles[0].id, size: opts.size || m.sizes[0].id, edit: !!opts.edit, token: 0, timer: 0, errors: {} };
      F.node = el('<div class="mk-sheet" role="dialog" aria-modal="true" aria-labelledby="mk-title">' +
        '<div class="mk-card-sheet">' +
        '<header class="mk-head"><div><span class="mk-eyebrow">' + (F.edit ? 'Edit details' : 'Quick maker') + '</span><h2 id="mk-title">' + esc(m.name) + '</h2></div>' +
        '<button type="button" class="sx-iconbtn mk-close" aria-label="Close">' + c.ic('x') + '</button></header>' +
        '<div class="mk-body"><div class="mk-preview"><div class="mk-canvas" aria-label="Live preview" role="img"></div><span class="mk-busy" hidden>Updating…</span></div>' +
        '<form class="mk-form" novalidate></form></div>' +
        '<footer class="mk-foot"><p class="mk-warn" hidden></p><button type="button" class="btn btn-ghost mk-cancel">Cancel</button><button type="submit" class="btn btn-gold mk-make">' + (F.edit ? 'Remake page' : 'Make it') + '</button></footer>' +
        '</div></div>');
      document.body.appendChild(F.node);
      F.form = F.node.querySelector('.mk-form');
      F.canvas = F.node.querySelector('.mk-canvas');
      renderForm(F);
      F.node.querySelector('.mk-close').onclick = close;
      F.node.querySelector('.mk-cancel').onclick = close;
      F.node.querySelector('.mk-make').onclick = function () { make(F); };
      F.form.onsubmit = function (e) { e.preventDefault(); make(F); };
      F.node.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
      F.node.addEventListener('click', function (e) { if (e.target === F.node) close(); });
      F.prevFocus = document.activeElement;
      requestAnimationFrame(function () { F.node.classList.add('is-on'); var f = F.form.querySelector('input,textarea,select,button'); if (f) f.focus({ preventScroll: true }); });
      if (F.edit && c && c.scene) {
        var d = c.scene.toJSON();
        if (d.maker && d.maker.sig && M.signature(d.layers) !== d.maker.sig) {
          var w = F.node.querySelector('.mk-warn');
          w.hidden = false;
          w.textContent = 'You changed this page by hand. Remaking it replaces those changes (you can undo).';
        }
      }
      schedule(F, 0);
      return F;
    });
  }
  function close() {
    var F = ST.form;
    if (!F) return;
    F.token++;
    clearTimeout(F.timer);
    ST.form = null;
    F.node.remove();
    if (F.prevFocus && F.prevFocus.focus) try { F.prevFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  function optList(inp) { return (inp.options || []).map(function (o) { return typeof o === 'object' ? { id: String(o.id), name: o.name || String(o.id) } : { id: String(o), name: String(o) }; }); }
  function field(F, inp) {
    var c = F.c, v = F.values[inp.key], id = 'mk-' + inp.key;
    var wrap = el('<div class="mk-field" data-key="' + esc(inp.key) + '"><label for="' + id + '">' + esc(inp.label || inp.key) + (inp.required ? '' : ' <small>optional</small>') + '</label></div>');
    var set = function (val) { if (val === '' || val == null || (Array.isArray(val) && !val.length)) delete F.values[inp.key]; else F.values[inp.key] = val; schedule(F); };
    var ctl;
    var t = inp.type;
    if (t === 'text' || t === 'longtext') {
      ctl = el(t === 'text' ? '<input class="sx-input" type="text" autocomplete="off">' : '<textarea class="sx-input mk-area" rows="3"></textarea>');
      ctl.id = id;
      ctl.maxLength = inp.max || (t === 'text' ? 80 : 600);
      ctl.placeholder = inp.placeholder || '';
      ctl.value = v == null ? '' : String(v);
      ctl.addEventListener('input', function () { set(ctl.value); });
    } else if (t === 'date') {
      ctl = el('<input class="sx-input" type="date" min="1800-01-01" max="2300-12-31">');
      ctl.id = id; ctl.value = v || '';
      ctl.addEventListener('input', function () { set(ctl.value); });
    } else if (t === 'number') {
      ctl = el('<input class="sx-input" type="number" inputmode="decimal">');
      ctl.id = id;
      if (inp.min != null) ctl.min = inp.min;
      if (inp.max != null) ctl.max = inp.max;
      ctl.step = inp.step || 1;
      ctl.value = v == null ? (inp.default == null ? '' : inp.default) : v;
      ctl.addEventListener('input', function () { set(ctl.value === '' ? '' : Number(ctl.value)); });
    } else if (t === 'color') {
      ctl = el('<div class="mk-color"><input type="color"><span></span><button type="button" class="btn btn-sm btn-ghost">Use the style’s colour</button></div>');
      var ci = ctl.querySelector('input'), cs = ctl.querySelector('span'), cr = ctl.querySelector('button');
      ci.id = id;
      ci.value = v || '#7457F0';
      cs.textContent = v || 'The style’s own';
      cr.hidden = !v;
      ci.addEventListener('input', function () { cs.textContent = ci.value.toUpperCase(); cr.hidden = false; set(ci.value.toUpperCase()); });
      cr.onclick = function () { cs.textContent = 'The style’s own'; cr.hidden = true; set(''); };
    } else if (t === 'toggle') {
      ctl = el('<label class="mk-toggle"><input type="checkbox"><span>' + (inp.hint ? esc(inp.hint) : 'On') + '</span></label>');
      var cb = ctl.querySelector('input');
      cb.id = id;
      cb.checked = v == null ? inp.default !== false : !!v;
      cb.addEventListener('change', function () { F.values[inp.key] = cb.checked; schedule(F); });
    } else if (t === 'choice') {
      var opts = optList(inp);
      if (opts.length <= 4) {
        ctl = c.ui.seg(opts.map(function (o) { return [o.id, o.name]; }), v || inp.default || opts[0].id, function (val) { set(val); }, 'sx-seg-sm');
      } else {
        ctl = el('<select class="sx-input"></select>');
        ctl.id = id;
        opts.forEach(function (o) { var op = document.createElement('option'); op.value = o.id; op.textContent = o.name; ctl.appendChild(op); });
        ctl.value = v || inp.default || opts[0].id;
        ctl.addEventListener('change', function () { set(ctl.value); });
      }
    } else if (t === 'list') {
      ctl = listField(F, inp, set);
    } else if (t === 'photo' || t === 'photos') {
      ctl = photoField(F, inp, set);
    }
    wrap.appendChild(ctl);
    if (inp.hint && t !== 'toggle') wrap.appendChild(el('<small class="mk-hint">' + esc(inp.hint) + '</small>'));
    wrap.appendChild(el('<small class="mk-err" role="alert" hidden></small>'));
    return wrap;
  }
  function listField(F, inp, set) {
    var cols = inp.columns || ['Item'];
    var box = el('<div class="mk-list"></div>');
    var rows = (F.values[inp.key] || []).map(function (r) { return Array.isArray(r) ? r.slice() : [r]; });
    function commit() {
      var out = rows.map(function (r) { return cols.length > 1 ? cols.map(function (_, i) { return r[i] || ''; }) : (r[0] || ''); })
        .filter(function (r) { return Array.isArray(r) ? r.some(Boolean) : !!r; });
      set(out);
    }
    function draw() {
      box.innerHTML = '';
      rows.forEach(function (r, ri) {
        var row = el('<div class="mk-row"></div>');
        cols.forEach(function (col, ci) {
          var inpt = el('<input class="sx-input" type="text" autocomplete="off">');
          inpt.maxLength = inp.cellMax || 48;
          inpt.placeholder = col;
          inpt.setAttribute('aria-label', col + ' ' + (ri + 1));
          inpt.value = r[ci] || '';
          if (ci === cols.length - 1 && cols.length > 1) inpt.classList.add('is-value');
          inpt.addEventListener('input', function () { r[ci] = inpt.value; commit(); });
          row.appendChild(inpt);
        });
        var del = el('<button type="button" class="sx-iconbtn" aria-label="Remove line ' + (ri + 1) + '">' + F.c.ic('x') + '</button>');
        del.onclick = function () { rows.splice(ri, 1); draw(); commit(); };
        row.appendChild(del);
        box.appendChild(row);
      });
      var max = inp.max || 15;
      var add = el('<button type="button" class="btn btn-sm mk-add"' + (rows.length >= max ? ' disabled' : '') + '>' + F.c.ic('plus') + '<span>Add a line</span></button>');
      add.onclick = function () { rows.push(cols.map(function () { return ''; })); draw(); var ins = box.querySelectorAll('.mk-row:last-of-type input'); if (ins[0]) ins[0].focus(); };
      box.appendChild(add);
      if (rows.length >= max) box.appendChild(el('<small class="mk-hint">That is the most lines this design holds.</small>'));
    }
    draw();
    return box;
  }
  function photoField(F, inp, set) {
    var c = F.c, many = inp.type === 'photos', max = many ? (inp.max || 4) : 1;
    var box = el('<div class="mk-photos"></div>');
    function list() { var v = F.values[inp.key]; return many ? (v || []).slice() : (v ? [v] : []); }
    function put(ids) { set(many ? ids.slice(0, max) : (ids[0] || '')); draw(); }
    function draw() {
      box.innerHTML = '';
      list().forEach(function (id, i) {
        var t = el('<div class="mk-ph"><span class="mk-ph-img"></span><button type="button" class="mk-ph-x" aria-label="Remove photo ' + (i + 1) + '">' + c.ic('x') + '</button></div>');
        var holder = t.querySelector('.mk-ph-img');
        if (/^sample:/.test(id)) { var im = new Image(); im.alt = 'Sample photo'; im.src = sampleFile(id); holder.appendChild(im); }
        else if (c.thumbUrl) c.thumbUrl(id).then(function (u) { if (u) { var im2 = new Image(); im2.alt = 'Your photo'; im2.src = u; holder.appendChild(im2); } });
        t.querySelector('button').onclick = function () { var l = list(); l.splice(i, 1); put(l); };
        box.appendChild(t);
      });
      var full = list().length >= max;
      if (!full || !many) {
        var b = el('<button type="button" class="btn mk-use">' + c.ic('image') + '<span>' + (full ? 'Change photo' : list().length ? 'Add another' : 'Use my photo') + '</span></button>');
        b.onclick = function () { pickPhoto(F, inp, b, function (ids) { put(many ? list().concat(ids) : ids); }); };
        box.appendChild(b);
      }
    }
    draw();
    return box;
  }
  /* Uploads already in this design, plus a device picker. */
  function pickPhoto(F, inp, anchor, done) {
    var c = F.c;
    var menu = F.node.querySelector('.mk-picker');
    if (menu) menu.remove();
    menu = el('<div class="mk-picker" role="dialog" aria-label="Choose a photo"><div class="mk-picker-head"><b>Choose a photo</b><button type="button" class="sx-iconbtn" aria-label="Close">' + c.ic('x') + '</button></div><div class="mk-picker-grid"></div>' +
      '<label class="btn btn-ink mk-device">' + c.ic('plus') + '<span>From this device</span><input type="file" accept="image/*"' + (inp.type === 'photos' ? ' multiple' : '') + ' hidden></label></div>');
    var grid = menu.querySelector('.mk-picker-grid');
    var ids = c.S && c.S.project ? Object.keys(c.S.project.assets || {}) : Object.keys(c.mem || {});
    ids.slice(0, 40).forEach(function (id) {
      var b = el('<button type="button" class="mk-pick" aria-label="Use this photo"></button>');
      c.thumbUrl(id).then(function (u) { if (u) { var im = new Image(); im.alt = ''; im.src = u; b.appendChild(im); } });
      b.onclick = function () { menu.remove(); exifInto(F, id, null); done([id]); };
      grid.appendChild(b);
    });
    if (!ids.length) grid.appendChild(el('<p class="sx-note">No photos in this design yet.</p>'));
    menu.querySelector('.mk-picker-head button').onclick = function () { menu.remove(); anchor.focus(); };
    var file = menu.querySelector('input');
    file.onchange = function () {
      var files = [].slice.call(file.files || []).filter(function (f) { return !f.type || /^image\//.test(f.type); }).slice(0, inp.type === 'photos' ? (inp.max || 4) : 1);
      if (!files.length) return;
      menu.querySelector('.mk-device span').textContent = 'Adding…';
      var out = [];
      var chain = Promise.resolve();
      files.forEach(function (f, i) {
        chain = chain.then(function () {
          if (i === 0) exifInto(F, null, f);
          return c.ingest(f).then(function (meta) { out.push(meta.id); }).catch(function (err) { c.toast(err.message || 'Could not read that photo.'); });
        });
      });
      chain.then(function () { menu.remove(); if (out.length) done(out); });
    };
    F.node.querySelector('.mk-card-sheet').appendChild(menu);
    var first = menu.querySelector('button');
    if (first) first.focus();
  }
  /* The photo's capture date fills an empty date field (film date stamps). */
  function exifInto(F, assetId, file) {
    var dateInp = F.m.inputs.filter(function (i) { return i.type === 'date' && (i.key === 'date'); })[0];
    if (!dateInp || F.values[dateInp.key] || !LE.exif) return;
    var get = file ? Promise.resolve(file) : (LE.project && LE.project.assetRecord ? LE.project.assetRecord(assetId).then(function (r) { return r && r.blob; }) : Promise.resolve(null));
    get.then(function (b) { return b ? LE.exif(b) : null; }).then(function (info) {
      var m = info && info.date && /^(\d{4}):(\d{2}):(\d{2})/.exec(info.date);
      if (!m || ST.form !== F) return;
      var iso = m[1] + '-' + m[2] + '-' + m[3];
      if (M.validate(F.m.id, (function () { var o = {}; o[dateInp.key] = iso; return o; })()).errors.some(function (e) { return e.key === dateInp.key && !e.required; })) return;
      F.values[dateInp.key] = iso;
      var node = F.form.querySelector('[data-key="' + dateInp.key + '"] input');
      if (node) node.value = iso;
      schedule(F);
    }).catch(function () {});
  }
  function renderForm(F) {
    var c = F.c, m = F.m;
    F.form.innerHTML = '';
    var styleBox = el('<div class="mk-field"><span class="mk-label">Style</span><div class="sx-chips is-scroll mk-styles" role="group" aria-label="Style"></div></div>');
    var chips = styleBox.querySelector('.mk-styles');
    m.styles.forEach(function (s) {
      var b = el('<button type="button" class="sx-chip" aria-pressed="' + (s.id === F.style) + '">' + esc(s.name) + '</button>');
      b.onclick = function () { F.style = s.id; chips.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); schedule(F, 0); };
      chips.appendChild(b);
    });
    F.form.appendChild(styleBox);
    var sizeBox = el('<div class="mk-field"><span class="mk-label">Size</span></div>');
    sizeBox.appendChild(c.ui.seg(m.sizes.map(function (s) { return [s.id, s.name]; }), F.size, function (v) { F.size = v; schedule(F, 0); }, 'sx-seg-sm'));
    F.form.appendChild(sizeBox);
    m.inputs.forEach(function (inp) { F.form.appendChild(field(F, inp)); });
  }
  function showErrors(F, errors) {
    F.form.querySelectorAll('.mk-field').forEach(function (n) {
      var e = n.querySelector('.mk-err');
      if (!e) return;
      var hit = errors.filter(function (x) { return x.key === n.getAttribute('data-key'); })[0];
      e.hidden = !hit;
      e.textContent = hit ? hit.message : '';
      n.querySelectorAll('input,textarea,select').forEach(function (i) { if (hit) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
    });
  }
  function schedule(F, ms) {
    clearTimeout(F.timer);
    var token = ++F.token;
    var busy = F.node.querySelector('.mk-busy');
    F.timer = setTimeout(function () {
      if (busy) busy.hidden = false;
      var vals = clone(F.values);
      images(F.c, F.m, vals).then(function (imgs) {
        if (token !== F.token) return null;
        return M.build(F.m.id, vals, { style: F.style, size: F.size, images: imgs }).then(function (out) {
          if (token !== F.token) return null;
          var box = F.canvas.getBoundingClientRect();
          var dpr = Math.min(2, window.devicePixelRatio || 1);
          return M.renderPage(out.pages[0], { images: imgs, maxEdge: Math.max(320, Math.round(Math.max(box.width, box.height) * dpr)) });
        });
      }).then(function (cv) {
        if (!cv || token !== F.token) return;
        cv.className = 'mk-render';
        F.canvas.innerHTML = '';
        F.canvas.appendChild(cv);
        if (busy) busy.hidden = true;
        showErrors(F, []);
      }).catch(function (err) {
        if (token !== F.token) return;
        if (busy) busy.hidden = true;
        if (err && err.errors) showErrors(F, err.errors.filter(function (e) { return !e.required; }));
      });
    }, ms == null ? 180 : ms);
  }

  /* ---------- Making ---------- */
  function make(F) {
    var c = F.c, m = F.m;
    var vals = clone(F.values);
    m.inputs.forEach(function (inp) { if (inp.today && !vals[inp.key]) vals[inp.key] = today(); });
    var v = M.validate(m.id, vals);
    if (!v.ok) {
      showErrors(F, v.errors);
      var first = F.form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return Promise.resolve(null);
    }
    var btn = F.node.querySelector('.mk-make');
    btn.disabled = true;
    btn.textContent = 'Making…';
    return ingestSamples(c, m, v.values).then(function (finalVals) {
      return images(c, m, finalVals).then(function (imgs) {
        return M.build(m.id, finalVals, { style: F.style, size: F.size, images: imgs });
      });
    }).then(function (out) {
      var page = normalize(out.pages[0]);
      page.maker.sig = M.signature(page.layers);
      var edit = F.edit;
      close();
      place(c, page, out.name, edit);
      return page;
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = F.edit ? 'Remake page' : 'Make it';
      c.toast((err && err.message) || 'That could not be made.');
      return null;
    });
  }
  /* New design, or the current page when it is empty or being remade, or a new page after it. Never overwrites work. */
  function place(c, page, name, edit) {
    if (!c.S.project) c.newDesign(page.width, page.height, name);
    else if (!edit && c.scene.layers().length) c.addPage(false);
    if (c.hideStart) c.hideStart();
    c.replaceDoc(page, true);
    var p = c.S.project;
    photoIdsOfPage(page).forEach(function (id) { if (c.mem[id] && p) p.assets[id] = c.mem[id].meta; });
    c.scene.select([]);
    c.fit();
    c.markDirty();
    if (c.renderFoot) c.renderFoot();
    c.toast(edit ? 'Page remade' : 'Made. Tap any part to edit it.', { action: { label: 'Edit details', fn: function () { editDetails(c); } } });
  }
  function photoIdsOfPage(d) {
    var out = [];
    (d.layers || []).forEach(function (l) { if (l.type === 'image' && l.src) out.push(l.src); });
    if (d.background && d.background.src) out.push(d.background.src);
    return out;
  }
  function editDetails(c) {
    var d = c.scene.toJSON();
    if (!d.maker || !M.get(d.maker.id)) { c.toast('This page was not made with a maker.'); return Promise.resolve(null); }
    return open(c, d.maker.id, { values: d.maker.values, style: d.maker.style, size: d.maker.size, edit: true });
  }

  /* ---------- Hooks into the studio ---------- */
  (function wrapApps() {
    var spec = P.apps;
    if (!spec || typeof spec.render !== 'function') return;
    var orig = spec.render;
    spec.render = function (c, body, o) {
      if (o && o.app === 'make') {
        if (!o.back) c.S.panelOpts.back = 'apps';
        return renderGallery(c, body);
      }
      return orig.apply(this, arguments);
    };
  })();
  (function wrapStart() {
    var orig = P._start;
    if (typeof orig !== 'function') return;
    P._start = function (c, host) {
      orig.apply(this, arguments);
      var inner = host.querySelector('.sx-start-inner');
      if (!inner) return;
      var sec = el('<div class="sx-start-sec mk-start"><div class="sx-sec-head"><h2>Make something quick</h2><button type="button" class="sx-link">See all</button></div><div class="mk-row-cards"></div></div>');
      sec.querySelector('.sx-link').onclick = function () { c.openPanel('apps', { app: 'make' }); };
      var hero = inner.querySelector('.sx-hero');
      if (hero && hero.nextSibling) inner.insertBefore(sec, hero.nextSibling); else inner.appendChild(sec);
      var row = sec.querySelector('.mk-row-cards');
      M.ready().then(function (list) {
        list.slice(0, 8).forEach(function (m) { row.appendChild(card(c, m, true)); });
        lazyThumbs(row);
      });
    };
  })();
  (H.ready = H.ready || []).push(function (c) {
    var q = new URLSearchParams(location.search);
    var id = q.get('make');
    if (!id) return;
    id = id.replace(/[^a-z0-9-]/g, '').slice(0, 40);
    M.ready().then(function () {
      if (!M.get(id)) { c.toast('There is no maker called “' + id + '”.'); return; }
      var raw = q.get('v');
      var opts = {};
      if (raw != null) {
        var d = M.decodeValues(id, raw);
        if (d.ok) opts.values = d.values;
        else c.toast('The details in that link could not be used, so the form starts fresh.');
      }
      var st = (q.get('style') || '').replace(/[^\w-]/g, ''), sz = (q.get('size') || '').replace(/[^\w-]/g, '');
      var m = M.get(id);
      if (m.styles.some(function (s) { return s.id === st; })) opts.style = st;
      if (m.sizes.some(function (s) { return s.id === sz; })) opts.size = sz;
      open(c, id, opts);
    });
  });

  window.LEStudioMakers = {
    open: function (id, opts) { return open(window.LEStudio, id, opts); },
    close: close,
    edit: function () { return editDetails(window.LEStudio); },
    make: function () { return ST.form ? make(ST.form) : Promise.resolve(null); },
    form: function () { return ST.form; },
    renderGallery: renderGallery,
    normalize: normalize
  };
})();
