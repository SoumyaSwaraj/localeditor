/* LocalEditor recipes page: library with live previews, detail view, share links (#r=...), import.
   Recipes are validated by LE.recipes.validate before anything is shown, saved or run. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.recipes) return;
  var R = LE.recipes;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function say(msg) { if (window.IT && IT.say) IT.say(msg, 3200); }
  function save(blob, name) {
    if (window.IT && IT.download) { IT.download(blob, name); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }
  function release(cv) { if (cv && cv.getContext) { cv.width = 0; cv.height = 0; } }
  var ROOT = document.documentElement.getAttribute('data-root') || '../';
  var ICON = {
    studio: '<path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 21h8M12 17v4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    share: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
    save: '<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7M8 21v-7h8v7"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.4"/><path d="m21 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L7 18"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    batch: '<rect x="7" y="7" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'; }

  var ST = { photo: null, photoFull: null, photoName: '', photoKey: 'covers', q: '', cat: 'all', detail: null, mode: null, shared: null, opener: null };

  /* ---------- Images ---------- */
  var covers = {};
  function loadCover(id) {
    if (!covers[id]) {
      covers[id] = fetch(ROOT + 'assets/photos/collage/' + id + '.jpg').then(function (r) {
        if (!r.ok) throw new Error('missing');
        return r.blob();
      }).then(function (b) { return LE.load(new File([b], id + '.jpg', { type: 'image/jpeg' })); }).then(function (cv) {
        var small = LE.fit(cv, 1000);
        release(cv);
        return small;
      });
      covers[id].catch(function () { delete covers[id]; });
    }
    return covers[id];
  }
  var samples = {};
  function sample(wf) {
    var kind = wf && wf.metadata.category === 'portrait' ? 'portrait' : 'scene';
    if (!samples[kind]) samples[kind] = LE.fit(LE.sample(kind), 1000);
    return samples[kind];
  }
  /* The picture a recipe is previewed on: the visitor's photo, else the recipe's cover, else a drawn sample. */
  function baseFor(wf) {
    if (ST.photo) return Promise.resolve({ canvas: ST.photo, label: 'your photo', key: ST.photoKey });
    var id = wf.metadata.cover;
    if (id && /^[a-z]+-\d{2}$/.test(id)) {
      return loadCover(id).then(function (cv) { return { canvas: cv, label: 'a sample photo', key: id }; }, function () { return { canvas: sample(wf), label: 'a sample picture', key: 'sample' }; });
    }
    return Promise.resolve({ canvas: sample(wf), label: 'a sample picture', key: 'sample' });
  }

  /* ---------- Card previews: lazy, sequential, cached ---------- */
  var urls = {};
  var queue = [];
  var busy = false;
  function urlFor(key, canvas) {
    return new Promise(function (res) {
      if (urls[key]) { res(urls[key]); return; }
      canvas.toBlob(function (b) { urls[key] = b ? URL.createObjectURL(b) : ''; res(urls[key]); }, 'image/jpeg', 0.84);
    });
  }
  function pump() {
    if (busy) return;
    var job = queue.shift();
    if (!job) return;
    busy = true;
    var next = function () { busy = false; setTimeout(pump, 0); };
    job().then(next, next);
  }
  function previewCard(card) {
    var wf = card._wf;
    var gen = ST.photoKey;
    queue.push(function () {
      if (gen !== ST.photoKey || !card.isConnected) return Promise.resolve();
      return baseFor(wf).then(function (base) {
        var thumb = LE.fit(base.canvas, 560);
        var bk = 'b|' + base.key;
        var ak = 'a|' + base.key + '|' + wf.metadata.id + '|' + JSON.stringify(wf.steps) + '|' + (wf.parameters[0] ? wf.parameters[0].default : 75);
        return urlFor(bk, thumb).then(function (u) {
          card.querySelector('.is-before').src = u;
          if (urls[ak]) return urls[ak];
          return R.apply(thumb, wf).then(function (res) { return urlFor(ak, res.canvas).then(function (u2) { release(res.canvas); return u2; }); });
        }).then(function (u) {
          release(thumb);
          if (gen !== ST.photoKey) return;
          var img = card.querySelector('.is-after');
          img.src = u;
          card.classList.add('is-ready');
        });
      });
    });
    pump();
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      previewCard(e.target);
    });
  }, { rootMargin: '300px 0px' }) : null;

  /* ---------- Lists ---------- */
  function card(wf, mine) {
    var el = document.createElement('article');
    el.className = 'rx-card';
    el.setAttribute('role', 'listitem');
    el.dataset.id = wf.metadata.id;
    var n = wf.steps.length;
    el.innerHTML = '<button type="button" class="rx-card-btn" aria-label="' + esc(wf.metadata.name) + ', ' + esc(mine ? 'yours' : R.categoryLabel(wf.metadata.category)) + '">' +
      '<span class="rx-card-art"><img class="is-before" alt=""><img class="is-after" alt=""><span class="rx-peek" aria-hidden="true">Before</span></span>' +
      '<span class="rx-card-text"><b>' + esc(wf.metadata.name) + '</b><small>' + esc(mine ? 'Yours' : R.categoryLabel(wf.metadata.category)) + ' · ' + n + (n === 1 ? ' step' : ' steps') + '</small></span></button>';
    el._wf = wf;
    el._text = (wf.metadata.name + ' ' + wf.metadata.description + ' ' + (wf.metadata.tags || []).join(' ') + ' ' + R.categoryLabel(wf.metadata.category)).toLowerCase();
    var b = el.querySelector('button');
    b.addEventListener('click', function () { openDetail(wf, mine ? 'mine' : 'builtin', b); });
    function peek(on) { el.classList.toggle('is-peek', on); }
    b.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') b._t = setTimeout(function () { peek(true); }, 220); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { b.addEventListener(t, function () { clearTimeout(b._t); peek(false); }); });
    if (io) io.observe(el); else previewCard(el);
    return el;
  }
  function paintLibrary() {
    var grid = $('rx-grid');
    grid.innerHTML = '';
    R.builtins.forEach(function (wf) { grid.appendChild(card(wf, false)); });
    var cats = $('rx-cats');
    cats.innerHTML = '';
    [['all', 'All']].concat(R.categories).forEach(function (c) {
      var count = c[0] === 'all' ? R.builtins.length : R.builtins.filter(function (w) { return w.metadata.category === c[0]; }).length;
      if (!count) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rx-chip';
      b.setAttribute('aria-pressed', String(ST.cat === c[0]));
      b.innerHTML = esc(c[1]) + ' <small>' + count + '</small>';
      b.addEventListener('click', function () {
        ST.cat = c[0];
        cats.querySelectorAll('.rx-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        filter();
      });
      cats.appendChild(b);
    });
    filter();
  }
  function filter() {
    var shown = 0;
    $('rx-grid').querySelectorAll('.rx-card').forEach(function (el) {
      var ok = (ST.cat === 'all' || el._wf.metadata.category === ST.cat) && (!ST.q || el._text.indexOf(ST.q) >= 0);
      el.hidden = !ok;
      if (ok) shown++;
    });
    $('rx-none').hidden = shown > 0;
  }
  function paintMine() {
    var grid = $('rx-mine');
    grid.innerHTML = '';
    var mine = LE.userRecipes.all();
    mine.forEach(function (wf) { grid.appendChild(card(wf, true)); });
    $('rx-mine-empty').hidden = mine.length > 0;
    grid.hidden = !mine.length;
  }

  /* ---------- Your photo ---------- */
  function usePhoto(file) {
    if (!file || (file.type && !/^image\//.test(file.type))) { say('Choose an image file.'); return Promise.resolve(false); }
    return LE.load(file).then(function (cv) {
      if (ST.photoFull) release(ST.photoFull);
      ST.photoFull = Math.max(cv.width, cv.height) > 4096 ? LE.fit(cv, 4096) : cv;
      if (ST.photoFull !== cv) release(cv);
      ST.photo = LE.fit(ST.photoFull, 1000);
      ST.photoName = file.name || 'photo.jpg';
      ST.photoKey = 'photo-' + Date.now();
      $('rx-yourphoto-img').src = ST.photo.toDataURL('image/jpeg', 0.7);
      $('rx-yourphoto').hidden = false;
      refreshPreviews();
      say('Previews now use your photo. It stays on this device.');
      return true;
    }, function () { say('That image could not be read.'); return false; });
  }
  function clearPhoto() {
    release(ST.photoFull); release(ST.photo);
    ST.photo = ST.photoFull = null;
    ST.photoKey = 'covers';
    $('rx-yourphoto').hidden = true;
    refreshPreviews();
  }
  function refreshPreviews() {
    queue.length = 0;
    document.querySelectorAll('.rx-card').forEach(function (el) {
      el.classList.remove('is-ready');
      if (io) { io.unobserve(el); io.observe(el); } else previewCard(el);
    });
    if (ST.detail) renderCompare();
  }

  /* ---------- Detail ---------- */
  var sheet = $('rx-detail');
  var dbody = sheet.querySelector('.rx-dialog-body');
  var cmp = { token: 0, base: null };
  function isSaved(wf) {
    var mine = LE.userRecipes.get(wf.metadata.id);
    return !!mine && JSON.stringify(mine.steps) === JSON.stringify(wf.steps);
  }
  function openSheet(el, opener) {
    ST.opener = opener || document.activeElement;
    el.hidden = false;
    document.documentElement.classList.add('rx-lock');
    requestAnimationFrame(function () { el.classList.add('is-on'); el.querySelector('.rx-dialog').focus(); });
  }
  function closeSheet(el) {
    if (el.hidden) return;
    el.classList.remove('is-on');
    el.hidden = true;
    if ($('rx-detail').hidden && $('rx-import').hidden) document.documentElement.classList.remove('rx-lock');
    if (ST.opener && ST.opener.focus && document.contains(ST.opener)) ST.opener.focus();
  }
  function closeDetail() {
    if (sheet.hidden) return;
    cmp.token++;
    ST.detail = null;
    closeSheet(sheet);
    if (!/r=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }
  /* mode: builtin | mine | shared | import */
  function openDetail(wf, mode, opener) {
    ST.detail = wf;
    ST.mode = mode;
    var meta = wf.metadata;
    var strength = wf.parameters && wf.parameters[0] ? wf.parameters[0].default : 75;
    var external = mode === 'shared' || mode === 'import';
    dbody.innerHTML =
      '<div class="rx-d">' +
        '<div class="rx-d-view">' +
          '<div class="rx-compare" style="--split:50%"><canvas class="is-before"></canvas><canvas class="is-after"></canvas><i class="rx-split" aria-hidden="true"></i>' +
          '<input type="range" min="0" max="100" value="50" aria-label="Drag to compare before and after"><span class="rx-tag is-l">Before</span><span class="rx-tag is-r">After</span></div>' +
          '<div class="rx-d-photo"><small id="rx-d-on"></small><label class="btn btn-sm rx-filebtn">' + icon('image') + '<span>' + (ST.photo ? 'Change photo' : 'Use your photo') + '</span><input type="file" accept="image/*" id="rx-d-file"></label></div>' +
        '</div>' +
        '<div class="rx-d-info">' +
          (external ? '<p class="rx-banner">' + (mode === 'shared' ? 'Shared with you' : 'Ready to import') + ' · checked and safe to use</p>' : '') +
          '<p class="kicker">' + esc(mode === 'mine' ? 'Yours' : R.categoryLabel(meta.category)) + ' · by ' + esc(meta.author) + '</p>' +
          '<h2 id="rx-d-title">' + esc(meta.name) + '</h2>' +
          (meta.description ? '<p class="rx-d-desc">' + esc(meta.description) + '</p>' : '') +
          '<div class="rx-strength"><div class="rx-strength-row"><label for="rx-d-strength">Strength</label><output id="rx-d-sv">' + strength + '%</output></div><input type="range" id="rx-d-strength" min="0" max="100" value="' + strength + '"></div>' +
          '<div class="rx-row rx-d-main">' +
            '<button type="button" class="btn btn-gold" id="rx-d-result">' + icon('download') + '<span>' + (ST.photo ? 'Download result' : 'Download preview') + '</span></button>' +
            '<button type="button" class="btn" id="rx-d-studio">' + icon('studio') + '<span>Open in studio</span></button>' +
          '</div>' +
          '<div class="rx-row rx-d-more">' +
            (mode === 'builtin' ? '' : (mode === 'mine'
              ? '<button type="button" class="btn btn-sm" id="rx-d-delete">' + icon('trash') + '<span>Delete</span></button>'
              : '<button type="button" class="btn btn-sm" id="rx-d-save">' + icon(isSaved(wf) ? 'check' : 'save') + '<span>' + (isSaved(wf) ? 'Saved on this device' : 'Save to this device') + '</span></button>')) +
            '<button type="button" class="btn btn-sm" id="rx-d-file-dl">' + icon('file') + '<span>Download recipe</span></button>' +
            '<button type="button" class="btn btn-sm" id="rx-d-share" aria-expanded="false">' + icon('share') + '<span>Share</span></button>' +
          '</div>' +
          '<div class="rx-sharebox" id="rx-sharebox" hidden></div>' +
          '<div class="rx-notices" id="rx-d-notices"></div>' +
          '<h3 class="rx-h3">Steps</h3>' +
          '<ol class="rx-steps">' + wf.steps.map(function (s) {
            return '<li' + (s.enabled === false ? ' class="is-off"' : '') + '><b>' + esc(s.label) + '</b><span>' + esc(stepValue(s)) + '</span>' + (s.description ? '<small>' + esc(s.description) + '</small>' : '') + (s.enabled === false ? '<small>Turned off</small>' : '') + '</li>';
          }).join('') + '</ol>' +
          '<details class="rx-json"><summary>View the file</summary><pre class="mono">' + esc(R.stringify(wf)) + '</pre></details>' +
        '</div>' +
      '</div>';
    var range = dbody.querySelector('.rx-compare input');
    range.addEventListener('input', function () { dbody.querySelector('.rx-compare').style.setProperty('--split', range.value + '%'); });
    var sl = $('rx-d-strength');
    var t = 0;
    sl.addEventListener('input', function () {
      $('rx-d-sv').textContent = sl.value + '%';
      clearTimeout(t);
      t = setTimeout(renderAfter, 60);
    });
    $('rx-d-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) usePhoto(f).then(function (ok) { if (ok && ST.detail) openDetail(ST.detail, ST.mode); });
    });
    $('rx-d-result').addEventListener('click', downloadResult);
    $('rx-d-studio').addEventListener('click', openStudio);
    $('rx-d-file-dl').addEventListener('click', function () { save(new Blob([R.stringify(wf)], { type: 'application/json' }), meta.id + '.leworkflow'); });
    $('rx-d-share').addEventListener('click', toggleShare);
    if ($('rx-d-save')) $('rx-d-save').addEventListener('click', function () { saveHere(wf); });
    if ($('rx-d-delete')) $('rx-d-delete').addEventListener('click', function () {
      LE.userRecipes.remove(meta.id);
      paintMine();
      closeDetail();
      say('Deleted “' + meta.name + '” from this device');
    });
    if (!sheet.hidden) { sheet.querySelector('.rx-dialog').scrollTop = 0; } else openSheet(sheet, opener);
    if (mode === 'builtin' || mode === 'mine') history.replaceState(null, '', location.pathname + location.search + '#' + meta.id);
    renderCompare();
  }
  function stepValue(s) {
    var p = s.parameters || {};
    var k = Object.keys(p);
    if (s.operation === 'split-tone') return 'shadows ' + (p.shadowAmount || 0) + ', highlights ' + (p.highlightAmount || 0);
    if (s.operation === 'levels') return (p.black || 0) + ' – ' + (p.white == null ? 255 : p.white);
    if (s.operation === 'resize' && p.maxWidth) return '≤ ' + p.maxWidth + ' px';
    if (s.operation === 'filter') return p.name + (p.intensity != null ? ' ' + p.intensity + '%' : '');
    if (k.length === 1 && typeof p[k[0]] === 'number') return (p[k[0]] > 0 && k[0] === 'value' ? '+' : '') + p[k[0]];
    return '';
  }
  function strengthNow() { var s = $('rx-d-strength'); return s ? Number(s.value) : 75; }
  function renderCompare() {
    var wf = ST.detail;
    if (!wf) return;
    var token = ++cmp.token;
    baseFor(wf).then(function (base) {
      if (token !== cmp.token) return;
      cmp.base = base;
      var on = $('rx-d-on');
      if (on) on.textContent = 'Previewing on ' + base.label;
      var bc = dbody.querySelector('canvas.is-before');
      bc.width = base.canvas.width; bc.height = base.canvas.height;
      bc.getContext('2d').drawImage(base.canvas, 0, 0);
      dbody.querySelector('.rx-compare').style.aspectRatio = base.canvas.width + ' / ' + base.canvas.height;
      renderAfter();
    });
  }
  function renderAfter() {
    var wf = ST.detail;
    if (!wf || !cmp.base) return;
    var token = ++cmp.token;
    R.apply(cmp.base.canvas, wf, { strength: strengthNow() }).then(function (res) {
      if (token !== cmp.token || !ST.detail) { release(res.canvas); return; }
      var ac = dbody.querySelector('canvas.is-after');
      ac.width = res.canvas.width; ac.height = res.canvas.height;
      ac.getContext('2d').drawImage(res.canvas, 0, 0);
      release(res.canvas);
      var notes = res.notices.filter(function (n) { return n.level !== 'optimized' || /desktop/.test(n.message); });
      $('rx-d-notices').innerHTML = notes.map(function (n) { return '<p>' + esc(n.message) + '</p>'; }).join('');
    });
  }
  function downloadResult() {
    var wf = ST.detail;
    if (!wf) return;
    var btn = $('rx-d-result');
    btn.disabled = true;
    var src = ST.photoFull ? Promise.resolve(ST.photoFull) : baseFor(wf).then(function (b) { return b.canvas; });
    src.then(function (canvas) { return R.apply(canvas, wf, { strength: strengthNow() }); }).then(function (res) {
      var fmt = (wf.export && wf.export.format) || 'jpeg';
      return LE.exportImage(res.canvas, { format: fmt, quality: ((wf.export && wf.export.quality) || 90) / 100 }).then(function (blob) {
        release(res.canvas);
        var base = ST.photo ? String(ST.photoName).replace(/\.[^.]+$/, '') : 'preview';
        save(blob, base + '-' + wf.metadata.id + '.' + (fmt === 'jpeg' ? 'jpg' : fmt));
      });
    }).catch(function () { say('That result could not be saved.'); }).then(function () { btn.disabled = false; });
  }
  function openStudio() {
    var wf = ST.detail;
    if (!wf) return;
    var src = ST.photoFull ? Promise.resolve(ST.photoFull) : baseFor(wf).then(function (b) { return b.canvas; });
    var name = ST.photo ? ST.photoName : (wf.metadata.cover || 'sample') + '.jpg';
    src.then(function (canvas) { return LE.toBlob(canvas, 'image/jpeg', 0.92); }).then(function (blob) {
      return LE.handoff.put(blob, { name: name, recipe: wf });
    }).then(function () { location.href = ROOT + 'studio/?tool=recipes'; }, function () { say('The studio could not be opened from here.'); });
  }
  function saveHere(wf) {
    var copy = JSON.parse(JSON.stringify(wf));
    var existing = LE.userRecipes.get(copy.metadata.id);
    if (R.isBuiltin(copy.metadata.id) || (existing && JSON.stringify(existing.steps) !== JSON.stringify(copy.steps))) copy.metadata.id = LE.userRecipes.freeId(copy.metadata.name);
    try {
      var saved = LE.userRecipes.save(copy);
      ST.detail = saved;
      paintMine();
      var b = $('rx-d-save');
      if (b) { b.innerHTML = icon('check') + '<span>Saved on this device</span>'; }
      say('Saved “' + saved.metadata.name + '”. It is now in the studio’s Recipes panel too.');
      if (ST.shared) paintShared();
    } catch (err) { say(err.message); }
  }

  /* ---------- Share ---------- */
  function qrSvg(text) {
    var q = window.qrcode;
    if (!q) return '';
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    var qr = q(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount(), m = 4, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) d += 'M' + (x + m) + ' ' + (y + m) + 'h1v1h-1z';
    return '<svg viewBox="0 0 ' + (n + 2 * m) + ' ' + (n + 2 * m) + '" role="img" aria-label="QR code for the recipe link" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#17131F"/></svg>';
  }
  function toggleShare() {
    var box = $('rx-sharebox');
    var b = $('rx-d-share');
    if (!box.hidden) { box.hidden = true; b.setAttribute('aria-expanded', 'false'); return; }
    var wf = ST.detail;
    box.hidden = false;
    b.setAttribute('aria-expanded', 'true');
    box.innerHTML = '<p class="rx-muted">Making a private link…</p>';
    R.encodeLink(wf, { base: new URL(ROOT + 'recipes/', location.href).href }).then(function (link) {
      box.innerHTML = '<p class="rx-muted">The recipe travels after the <b>#</b>, which browsers never send to a server. No photo is included.</p>' +
        '<div class="rx-linkrow"><input class="input" readonly aria-label="Recipe link" value="' + esc(link.url) + '"><button type="button" class="btn btn-gold btn-sm" id="rx-copy">' + icon('copy') + '<span>Copy link</span></button></div>' +
        '<div class="rx-row">' + (navigator.share ? '<button type="button" class="btn btn-sm" id="rx-native">' + icon('share') + '<span>Share…</span></button>' : '') + '</div>' +
        (link.url.length <= 1200 && window.qrcode ? '<div class="rx-qr">' + qrSvg(link.url) + '<small>Scan to open this recipe on a phone</small></div>' : '');
      var input = box.querySelector('input');
      input.addEventListener('focus', function () { input.select(); });
      $('rx-copy').addEventListener('click', function () {
        var done = function () { $('rx-copy').querySelector('span').textContent = 'Copied'; say('Link copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link.url).then(done, function () { input.select(); say('Press Ctrl+C to copy'); });
        else { input.select(); try { document.execCommand('copy'); done(); } catch (e) { say('Press Ctrl+C to copy'); } }
      });
      if ($('rx-native')) $('rx-native').addEventListener('click', function () {
        var file = new File([R.stringify(wf)], wf.metadata.id + '.leworkflow', { type: 'application/json' });
        var data = { title: wf.metadata.name, text: 'A LocalEditor recipe: ' + wf.metadata.name };
        if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file]; else data.url = link.url;
        navigator.share(data).catch(function () {});
      });
    }, function (err) {
      box.innerHTML = '<p class="rx-error">' + esc(err.message) + '</p>';
    });
  }

  /* ---------- Shared links and import ---------- */
  function paintShared() {
    var box = $('rx-shared');
    var s = ST.shared;
    if (!s) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (!s.ok) {
      box.className = 'rx-shared is-bad';
      box.innerHTML = '<div><p class="kicker">Shared recipe</p><h2>This link could not be opened</h2><p>' + esc(s.errors[0] || 'The recipe in it is not valid.') + ' Nothing was run. Ask the sender for the .leworkflow file, or browse the library below.</p></div>' +
        '<div class="rx-row"><button type="button" class="btn btn-sm" id="rx-shared-dismiss">Dismiss</button></div>';
      $('rx-shared-dismiss').addEventListener('click', function () { ST.shared = null; history.replaceState(null, '', location.pathname + location.search); paintShared(); });
      return;
    }
    var wf = s.workflow;
    var saved = isSaved(wf);
    box.className = 'rx-shared';
    box.innerHTML = '<div class="rx-shared-art"><img alt=""></div><div class="rx-shared-text"><p class="kicker">Shared with you</p><h2>' + esc(wf.metadata.name) + '</h2>' +
      '<p>' + esc(wf.metadata.description || (wf.steps.length + ' steps')) + '</p>' +
      '<div class="rx-row"><button type="button" class="btn btn-gold btn-sm" id="rx-shared-open">Preview</button>' +
      '<button type="button" class="btn btn-sm" id="rx-shared-save"' + (saved ? ' disabled' : '') + '>' + icon(saved ? 'check' : 'save') + '<span>' + (saved ? 'Saved on this device' : 'Save to this device') + '</span></button>' +
      '<button type="button" class="btn btn-sm" id="rx-shared-studio">' + icon('studio') + '<span>Open in studio</span></button></div></div>';
    $('rx-shared-open').addEventListener('click', function (e) { openDetail(wf, 'shared', e.currentTarget); });
    $('rx-shared-save').addEventListener('click', function () { saveHere(wf); });
    $('rx-shared-studio').addEventListener('click', function () { ST.detail = wf; openStudio(); });
    baseFor(wf).then(function (base) {
      var t = LE.fit(base.canvas, 360);
      return R.apply(t, wf).then(function (res) { release(t); var img = box.querySelector('img'); if (img) img.src = res.canvas.toDataURL('image/jpeg', 0.84); release(res.canvas); });
    });
  }
  function readHash() {
    var h = location.hash || '';
    if (/[#&]r=/.test(h)) {
      return R.decodeLink(h).then(function (v) {
        ST.shared = v;
        paintShared();
        if (v.ok) openDetail(v.workflow, 'shared');
        $('rx-shared').scrollIntoView({ block: 'nearest' });
      });
    }
    var id = decodeURIComponent(h.replace(/^#/, ''));
    if (id) {
      var mine = LE.userRecipes.get(id);
      var wf = mine || R.builtins.filter(function (r) { return r.metadata.id === id; })[0];
      if (wf) openDetail(wf, mine ? 'mine' : 'builtin');
    }
    return Promise.resolve();
  }
  function preview(v) {
    if (!v.ok) return false;
    closeSheet($('rx-import'));
    openDetail(v.workflow, 'import');
    if (v.warnings && v.warnings.length) say(v.warnings.length + ' unknown setting' + (v.warnings.length === 1 ? ' was' : 's were') + ' left out.');
    return true;
  }
  function importText(text) {
    var t = String(text || '').trim();
    if (!t) return Promise.resolve({ ok: false, errors: ['Paste a recipe link or the text of a .leworkflow file.'] });
    if (t.charAt(0) !== '{' && R.linkPayload(t)) return R.decodeLink(t);
    return Promise.resolve(R.validate(t));
  }
  function importFile(file) {
    if (!file) return;
    if (file.size > R.limits.bytes) { showImportError('That file is too large to be a recipe.'); return; }
    file.text().then(function (txt) {
      var v = R.validate(txt);
      if (!preview(v)) showImportError(v.errors[0]);
    });
  }
  function showImportError(msg) {
    var imp = $('rx-import');
    if (imp.hidden) openSheet(imp);
    var e = $('rx-import-error');
    e.hidden = false;
    e.textContent = msg || 'That is not a valid recipe.';
  }
  function openImport(opener) {
    $('rx-import-error').hidden = true;
    $('rx-import-text').value = '';
    openSheet($('rx-import'), opener);
  }

  /* ---------- Wiring ---------- */
  $('rx-photo').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) usePhoto(f); });
  $('rx-yourphoto-clear').addEventListener('click', clearPhoto);
  $('rx-import-open').addEventListener('click', function (e) { openImport(e.currentTarget); });
  document.querySelectorAll('[data-import]').forEach(function (b) { b.addEventListener('click', function () { openImport(b); }); });
  $('rx-import-file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; importFile(f); });
  $('rx-import-go').addEventListener('click', function () {
    importText($('rx-import-text').value).then(function (v) { if (!preview(v)) showImportError(v.errors[0]); });
  });
  var qInput = $('rx-q');
  var qt = 0;
  qInput.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { ST.q = qInput.value.trim().toLowerCase(); filter(); }, 120); });
  document.querySelectorAll('.rx-sheet [data-close]').forEach(function (b) {
    b.addEventListener('click', function () { var s = b.closest('.rx-sheet'); if (s.id === 'rx-detail') closeDetail(); else closeSheet(s); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('rx-import').hidden) closeSheet($('rx-import'));
    else if (!sheet.hidden) closeDetail();
  });
  /* Keep focus inside an open dialog. */
  document.addEventListener('focusin', function (e) {
    var open = !$('rx-import').hidden ? $('rx-import') : (!sheet.hidden ? sheet : null);
    if (open && !open.contains(e.target)) open.querySelector('.rx-dialog').focus();
  });
  window.addEventListener('hashchange', function () { if (/r=/.test(location.hash)) readHash(); });

  var drop = $('rx-drop');
  var depth = 0;
  function hasFiles(e) { return e.dataTransfer && [].slice.call(e.dataTransfer.types || []).indexOf('Files') >= 0; }
  document.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; depth++; drop.hidden = false; });
  document.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
  document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    var files = [].slice.call(e.dataTransfer.files || []);
    var rec = files.filter(function (f) { return /\.(leworkflow|json)$/i.test(f.name) || f.type === 'application/json'; })[0];
    if (rec) { importFile(rec); return; }
    var img = files.filter(function (f) { return /^image\//.test(f.type); })[0];
    if (img) usePhoto(img); else say('Drop a .leworkflow file or a photo.');
  });
  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var text = e.clipboardData && e.clipboardData.getData('text');
    if (!text || !(/^\s*\{/.test(text) || R.linkPayload(text))) return;
    e.preventDefault();
    importText(text).then(function (v) { if (!preview(v)) showImportError(v.errors[0]); });
  });

  var sampleWf = R.builtins.filter(function (r) { return r.metadata.id === 'golden-hour'; })[0] || R.builtins[0];
  $('rx-sample-json').textContent = R.stringify(sampleWf);
  paintLibrary();
  paintMine();
  readHash();

  window.LERecipesPage = { openDetail: openDetail, usePhoto: usePhoto, importText: importText, state: ST };
})();
