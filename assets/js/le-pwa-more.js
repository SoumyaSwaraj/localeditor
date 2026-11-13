/* LocalEditor: the storage manager and the install chooser (docs/INSTALL.md, docs/LOADING.md). le-pwa.js loads this file on
   first use: Install app, Storage, ?install=, ?storage=1, #storage, or a call to one of the LEPwa functions below. The code
   is moved from le-pwa.js unchanged; what it shares with le-pwa.js comes from LEPwa._core. Install state, worker
   registration and update safety stay in le-pwa.js. */
(function () {
  'use strict';
  var C = window.LEPwa && window.LEPwa._core;
  if (!C || window.LEPwa._more) return;
  var BASE = C.BASE, MB = C.MB, DAY = C.DAY, CACHES = C.CACHES, DOWNLOADS = C.DOWNLOADS, KEY = C.KEY, DATABASES = C.DATABASES, lsGet = C.lsGet,
    lsSet = C.lsSet, state = C.state, fmt = C.fmt, esc = C.esc, h = C.h, ago = C.ago, pretty = C.pretty, plural = C.plural, sum = C.sum, on = C.on,
    emit = C.emit, toast = C.toast, needProject = C.needProject, needZip = C.needZip, download = C.download, platform = C.platform,
    standalone = C.standalone, APPS = C.APPS, APP_IDS = C.APP_IDS, inScope = C.inScope, pageApp = C.pageApp, linkManifest = C.linkManifest,
    restoreManifest = C.restoreManifest, installedApps = C.installedApps, installKind = C.installKind, canInstall = C.canInstall,
    promptFor = C.promptFor, whenDownloads = C.whenDownloads, install = C.install, firePrompt = C.firePrompt, ICON = C.ICON,
    promptCapable = C.promptCapable, snooze = C.snooze, call = C.call, memory = C.memory, sw = C.sw, ask = C.ask, limits = C.limits,
    setLimits = C.setLimits, hasCaches = C.hasCaches, entries = C.entries, appCacheNames = C.appCacheNames, versions = C.versions,
    removeEntries = C.removeEntries, modelId = C.modelId, modelInfo = C.modelInfo, persisted = C.persisted, persist = C.persist;

  /* Each platform gets one short, illustrated recipe. */
  function helpFor(kind, name) {
    var N = esc(name || 'LocalEditor');
    var iPad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var where = iPad ? 'at the top right of Safari' : 'in the toolbar at the bottom of Safari';
    var H = {
      'ios-safari': {
        title: 'Add ' + N + ' to your Home Screen',
        steps: [
          { art: 'safari-bar', text: '<b>Tap Share</b> ' + ICON.share + ' ' + where + '. If you do not see it, tap ' + ICON.more + ' first.' },
          { art: 'share-sheet', text: 'Scroll down and tap <b>Add to Home Screen</b> ' + ICON.plus + '.' },
          { art: 'add', text: 'Tap <b>Add</b>. ' + N + ' now opens full screen and works with no connection.' }
        ]
      },
      'ios-other': {
        title: 'Add ' + N + ' to your Home Screen',
        steps: [
          { art: 'safari-bar', text: '<b>Tap Share</b> ' + ICON.share + ' next to the address bar (in some browsers it is inside the ' + ICON.more + ' menu).' },
          { art: 'share-sheet', text: 'Tap <b>Add to Home Screen</b> ' + ICON.plus + ', then <b>Add</b>.' }
        ],
        note: 'Needs iOS 16.4 or later. If you do not see the option, open this page in Safari.'
      },
      'mac-safari': {
        title: 'Add ' + N + ' to your Dock',
        steps: [
          { art: 'mac-menu', text: 'In the menu bar, choose <b>File</b>, then <b>Add to Dock</b> ' + ICON.dock + '.' },
          { art: 'add', text: 'Click <b>Add</b>. ' + N + ' opens in its own window, even offline.' }
        ],
        note: 'Needs macOS Sonoma (Safari 17) or later.'
      },
      'android': {
        title: 'Install ' + N,
        steps: [
          { art: 'menu', text: 'Tap the browser menu ' + ICON.dots + ' at the top right.' },
          { art: 'install', text: 'Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.' }
        ]
      },
      'android-samsung': {
        title: 'Install ' + N,
        steps: [
          { art: 'menu', text: 'Tap the menu ' + ICON.menu + ' at the bottom right.' },
          { art: 'install', text: 'Tap <b>Add page to</b>, then <b>Apps screen</b> or <b>Home screen</b>.' }
        ]
      },
      'android-firefox': {
        title: 'Install ' + N,
        steps: [
          { art: 'menu', text: 'Tap the menu ' + ICON.dots + '.' },
          { art: 'install', text: 'Tap <b>Install</b> (or <b>Add to Home screen</b>), then <b>Add</b>.' }
        ]
      },
      'desktop': {
        title: 'Install ' + N,
        steps: [
          { art: 'desktop-bar', text: 'Click the install icon ' + ICON.install + ' at the right end of the address bar.' },
          { art: 'menu', text: 'No icon? Open the browser menu ' + ICON.dots + ' and choose <b>Install ' + N + '</b> (Chrome: <b>Cast, save and share</b> &rsaquo; <b>Install page as app</b>; Edge: <b>Apps</b> &rsaquo; <b>Install this site as an app</b>).' }
        ]
      },
      'desktop-firefox': {
        title: 'Firefox cannot install web apps yet',
        steps: [
          { art: 'offline', text: N + ' still works offline in this tab after your first visit, and everything stays on this device.' },
          { art: 'desktop-bar', text: 'For an app window with its own icon, open this page in <b>Chrome</b>, <b>Edge</b> or <b>Safari</b> and install it there.' }
        ],
        copy: true
      },
      'in-app': {
        title: 'Open ' + N + ' in your browser',
        steps: [
          { art: 'menu', text: 'You are inside another app’s viewer, which cannot install apps or keep your work. Tap ' + ICON.more + ' or ' + ICON.dots + ' in the corner.' },
          { art: 'open', text: 'Choose <b>Open in browser</b> (or <b>Open in Safari</b> / <b>Open in Chrome</b>), then install from there.' }
        ],
        copy: true
      }
    };
    return H[kind] || H.desktop;
  }
  function art(kind) {
    var A = {
      'safari-bar': '<div class="lp-art lp-art-bar"><span>&lsaquo;</span><span>&rsaquo;</span><span class="lp-hot">' + ICON.share + '</span><span>' + ICON.more + '</span></div>',
      'share-sheet': '<div class="lp-art lp-art-sheet"><span>Copy</span><span>Add to Reading List</span><span class="lp-hot">Add to Home Screen ' + ICON.plus + '</span></div>',
      'add': '<div class="lp-art lp-art-add"><span>Cancel</span><b>Add to Home Screen</b><span class="lp-hot">Add</span></div>',
      'mac-menu': '<div class="lp-art lp-art-sheet"><span>File</span><span>New Window</span><span class="lp-hot">Add to Dock…</span></div>',
      'menu': '<div class="lp-art lp-art-sheet"><span>New tab</span><span>Bookmarks</span><span class="lp-hot">Install app</span></div>',
      'install': '<div class="lp-art lp-art-add"><span>Cancel</span><b>Install app?</b><span class="lp-hot">Install</span></div>',
      'desktop-bar': '<div class="lp-art lp-art-bar lp-art-url"><span class="lp-url">localeditor.net</span><span class="lp-hot">' + ICON.install + '</span></div>',
      'offline': '<div class="lp-art lp-art-icon">' + ICON.offline + '</div>',
      'open': '<div class="lp-art lp-art-sheet"><span>Copy link</span><span class="lp-hot">Open in browser ' + ICON.open + '</span></div>'
    };
    return A[kind] || '';
  }

  /* ---------- Dialogs ---------- */
  function sheet(cls, label) {
    var d = h('<dialog class="lp-sheet ' + cls + '" aria-label="' + esc(label) + '"><div class="lp-sheet-in" tabindex="-1" autofocus></div></dialog>');
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.addEventListener('close', function () { setTimeout(function () { d.remove(); }, 0); });
    return d;
  }
  function showModal(d) {
    if (typeof d.showModal === 'function') { try { d.showModal(); return; } catch (e) {} }
    d.setAttribute('open', '');
  }
  function headHTML(title, sub) {
    return '<header class="lp-head"><div><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div><button type="button" class="lp-x" data-lp-close aria-label="Close">' + ICON.close + '</button></header>';
  }
  function bindClose(d) {
    d.addEventListener('click', function (e) { if (e.target.closest('[data-lp-close]')) d.close(); });
  }

  function openInstallHelp(kind) {
    kind = kind || installKind();
    if (kind === 'installed') { toast('LocalEditor is already installed on this device.'); return null; }
    if (kind === 'prompt') { install(); return null; }
    var info = helpFor(kind);
    var d = sheet('lp-install', info.title);
    var why = '<ul class="lp-why"><li>' + ICON.open + 'Opens like an app, full screen</li><li>' + ICON.offline + 'Works with no connection</li><li>' + ICON.shield + 'Your photos still never leave this device</li></ul>';
    d.firstChild.innerHTML = headHTML(esc(info.title), 'Takes about ten seconds. Nothing to download from a store.') +
      '<ol class="lp-steps">' + info.steps.map(function (s, i) {
        return '<li><span class="lp-num">' + (i + 1) + '</span><div>' + art(s.art) + '<p>' + s.text + '</p></div></li>';
      }).join('') + '</ol>' + (info.note ? '<p class="lp-note">' + esc(info.note) + '</p>' : '') + why +
      '<div class="lp-actions">' + (info.copy ? '<button type="button" class="lp-btn" data-lp-copy>Copy link</button>' : '') + '<button type="button" class="lp-btn lp-primary" data-lp-close>Got it</button></div>';
    bindClose(d);
    var copy = d.querySelector('[data-lp-copy]');
    if (copy) copy.onclick = function () {
      var url = location.origin + location.pathname;
      if (window.IT && IT.copy) IT.copy(url); else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); });
    };
    d.addEventListener('close', function () { snooze(); });
    showModal(d);
    return d;
  }

  /* ---------- The install chooser: three choices, one sentence and a size each ----------
     Browsers with an install prompt (Chromium): the chosen app's manifest is linked, a fresh prompt arrives and is fired from
     the same tap. Browsers without one (Safari, Firefox for Android, Samsung Internet without a prompt): the steps for this
     browser, after linking the chosen manifest; a studio chosen on another page first opens that studio (?install=). */
  function sizeText(id, sep) {
    var D = window.LE && LE.downloads;
    var a = D && D.apps ? D.apps().filter(function (x) { return x.id === id; })[0] : null;
    return a ? 'About ' + fmt(a.raw) + ' on this device' + (sep || '') : '';
  }
  function goInstall(app) {
    var start = APPS[app].start;
    location.href = BASE + start + (start.indexOf('?') >= 0 ? '&' : '?') + 'install=' + app;
  }
  var chooser = null;
  function openChooser(opts) {
    opts = opts || {};
    if (chooser && chooser.open) return chooser;
    var installed = installedApps();
    var pick = APPS[opts.app] ? opts.app : pageApp();
    if (installed.indexOf(pick) >= 0) pick = APP_IDS.filter(function (a) { return installed.indexOf(a) < 0; })[0] || pick;
    var kind = platform();
    var withPrompt = promptCapable();
    var d = sheet('lp-install lp-choose', 'Install LocalEditor');
    chooser = d;
    d.firstChild.innerHTML = headHTML('Install LocalEditor', 'Pick one. You can add the others later. Nothing is uploaded.') +
      '<div class="lp-apps" role="radiogroup" aria-label="What to install">' + APP_IDS.map(function (id) {
        var a = APPS[id], has = installed.indexOf(id) >= 0;
        return '<label class="lp-app" data-lp-app="' + id + '"><input type="radio" name="lp-app" value="' + id + '"' + (id === pick ? ' checked' : '') + (has ? ' disabled' : '') + '>' +
          '<span class="lp-app-tx"><b>' + esc(a.title) + (id === 'suite' ? ' <em class="lp-rec">Recommended</em>' : '') + '</b>' +
          '<small>' + esc(a.about) + '</small>' +
          '<small class="lp-app-mb"><span data-lp-size="' + id + '">' + (has ? 'Installed on this device · ' : esc(sizeText(id, ' · '))) + '</span>shows as <span class="lp-nw">“' + esc(a.short) + '”</span></small></span></label>';
      }).join('') + '</div>' +
      '<div class="lp-how" data-lp-how hidden></div>' +
      '<p class="lp-note lp-choose-msg" data-lp-msg role="status" aria-live="polite"></p>' +
      '<div class="lp-actions"><button type="button" class="lp-btn" data-lp-close>Not now</button><button type="button" class="lp-btn lp-primary" data-lp-go>Install</button></div>';
    bindClose(d);
    var go = d.querySelector('[data-lp-go]');
    var how = d.querySelector('[data-lp-how]');
    var msg = d.querySelector('[data-lp-msg]');
    function chosen() { var r = d.querySelector('input[name="lp-app"]:checked'); return r ? r.value : 'suite'; }
    function say(t) { msg.textContent = t || ''; }
    /* Without an install prompt the steps are the answer: link the chosen app now (Safari reads it when the person adds it). */
    function paintHow() {
      say('');
      if (withPrompt) { how.hidden = true; go.textContent = 'Install'; go.removeAttribute('data-lp-close'); return; }
      var app = chosen();
      if (kind === 'desktop-firefox') {
        how.hidden = false;
        var ff = helpFor(kind, APPS[app].name);
        how.innerHTML = '<p><b>' + esc(ff.title) + '</b></p>' + stepsHTML(ff);
        go.textContent = 'Got it'; go.setAttribute('data-lp-close', '');
        return;
      }
      if (app !== 'suite' && !inScope(app)) {
        how.hidden = false;
        how.innerHTML = '<p class="lp-sub">' + esc(APPS[app].name) + ' opens in its own studio. Go there first, then add it from that page.</p>';
        go.textContent = app === 'design' ? 'Open the design studio' : 'Open the PDF studio';
        go.removeAttribute('data-lp-close');
        return;
      }
      linkManifest(app);
      var info = helpFor(kind, APPS[app].name);
      how.hidden = false;
      how.innerHTML = stepsHTML(info) + (info.note ? '<p class="lp-note">' + esc(info.note) + '</p>' : '');
      go.textContent = 'Got it'; go.setAttribute('data-lp-close', '');
    }
    d.addEventListener('change', function (e) { if (e.target && e.target.name === 'lp-app') paintHow(); });
    go.addEventListener('click', function () {
      if (go.hasAttribute('data-lp-close')) return; /* "Got it": bindClose closes it */
      var app = chosen();
      if (installedApps().indexOf(app) >= 0) { say(APPS[app].name + ' is already installed. Find it with your other apps.'); return; }
      if (!withPrompt) { goInstall(app); return; }
      go.disabled = true;
      say('');
      linkManifest(app);
      promptFor(app, 4000).then(function (ev) {
        go.disabled = false;
        if (ev) {
          return firePrompt(ev, app, say).then(function (outcome) {
            if (outcome === 'accepted') { d._accepted = true; d.close(); }
            else if (outcome === 'dismissed') say('Not installed. You can install it any time from the menu.');
            else if (outcome === 'failed') { how.hidden = false; how.innerHTML = stepsHTML(helpFor(kind, APPS[app].name)); }
          });
        }
        /* No prompt for it here: this browser wants the app's own page, or it is installed already, or it installs from its menu. */
        if (app !== 'suite' && !inScope(app)) { goInstall(app); return; }
        how.hidden = false;
        how.innerHTML = '<p class="lp-sub">This browser did not offer to install ' + esc(APPS[app].name) + ' just now. If it is not installed yet, use the browser menu:</p>' + stepsHTML(helpFor(kind === 'desktop-firefox' ? 'desktop' : kind, APPS[app].name));
      });
    });
    d.addEventListener('close', function () {
      if (chooser === d) chooser = null;
      /* Chromium: the page goes back to offering the whole suite. Safari keeps the chosen link: the person adds it after closing this. */
      if (withPrompt) restoreManifest();
      if (!opts.quiet && !d._accepted) snooze();
    });
    /* Sizes come from packs.json, which may still be loading. */
    whenDownloads(function (D) {
      (D.ready || Promise.resolve()).then(function () {
        APP_IDS.forEach(function (id) { var el = d.querySelector('[data-lp-size="' + id + '"]'); if (el && installed.indexOf(id) < 0) el.textContent = sizeText(id, ' · '); });
      });
    });
    paintHow();
    if (opts.note) say(opts.note);
    showModal(d);
    return d;
  }
  function stepsHTML(info) {
    return '<ol class="lp-steps">' + info.steps.map(function (s, i) {
      return '<li><span class="lp-num">' + (i + 1) + '</span><div>' + art(s.art) + '<p>' + s.text + '</p></div></li>';
    }).join('') + '</ol>';
  }

  function confirmBox(opts) {
    return new Promise(function (resolve) {
      var d = sheet('lp-confirm', opts.title);
      d.firstChild.innerHTML = '<h2>' + esc(opts.title) + '</h2><p>' + opts.text + '</p>' +
        (opts.type ? '<label class="lp-type">Type <b>' + esc(opts.type) + '</b> to confirm<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' : '') +
        '<div class="lp-actions"><button type="button" class="lp-btn" data-no>Cancel</button><button type="button" class="lp-btn ' + (opts.danger ? 'lp-danger' : 'lp-primary') + '" data-yes>' + esc(opts.ok || 'OK') + '</button></div>';
      var yes = d.querySelector('[data-yes]');
      var input = d.querySelector('input');
      var answer = false;
      if (input) {
        yes.disabled = true;
        input.addEventListener('input', function () { yes.disabled = input.value.trim().toLowerCase() !== opts.type.toLowerCase(); });
      }
      yes.onclick = function () { answer = true; d.close(); };
      d.querySelector('[data-no]').onclick = function () { d.close(); };
      d.addEventListener('close', function () { resolve(answer); });
      showModal(d);
      (input || d.querySelector('[data-no]')).focus();
    });
  }

  /* ---------- Cache Storage names ---------- */
  function packId(path) { var m = /\/assets\/data\/withicons\/([\w-]+)\.json$/.exec(path); return m && ['index', 'palettes', 'previews'].indexOf(m[1]) < 0 ? m[1] : null; }
  function packNames() {
    if (window.LE && LE.assets && LE.assets.iconStyles) {
      var list = LE.assets.iconStyles();
      if (list.length) { var o = {}; list.forEach(function (s) { o[s.id] = s.name; }); return Promise.resolve(o); }
    }
    if (!hasCaches()) return Promise.resolve({});
    return caches.open(CACHES.assets).then(function (c) {
      return c.match(new URL(BASE + 'assets/data/withicons/index.json', location.href).href);
    }).then(function (r) { return r ? r.json() : null; }).then(function (idx) {
      var o = {};
      ((idx && idx.styles) || []).forEach(function (s) { o[s.id] = s.name; });
      return o;
    }).catch(function () { return {}; });
  }
  function fontFamily(path) { var m = /\/assets\/fonts\/(?:library|cjk|originals)\/([\w-]+)\//.exec(path); return m ? m[1] : 'other'; }
  /* Fonts: "Save for offline" copies live in le-fonts-saved-v1 (never trimmed); fonts fetched when used in le-fonts-v1. */
  function fontEntries() {
    return Promise.all([entries(CACHES.fonts), entries(CACHES.savedFonts)]).then(function (r) { r[1].forEach(function (x) { x.saved = true; }); return r[0].concat(r[1]); });
  }
  function fontName(slug) {
    var F = window.LE && LE.fonts;
    var f = F && F.find ? F.find(slug) : null;
    if (!f && F && F.list) f = F.list().filter(function (x) { return x.family.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug; })[0];
    return f ? f.family : pretty(slug);
  }

  /* ---------- Designs database (same schema as le-project.js; opened only after le-project.js is loaded) ---------- */
  var dbp = null;
  function projectsDb() {
    if (dbp) return dbp;
    dbp = needProject().then(function () {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('le-projects', 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('versions')) d.createObjectStore('versions', { keyPath: 'id' }).createIndex('projectId', 'projectId');
          if (!d.objectStoreNames.contains('ledger')) d.createObjectStore('ledger', { keyPath: 'seq', autoIncrement: true }).createIndex('projectId', 'projectId');
        };
        req.onsuccess = function () {
          var d = req.result;
          d.onversionchange = function () { d.close(); dbp = null; };
          resolve(d);
        };
        req.onerror = function () { dbp = null; reject(req.error); };
      });
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return projectsDb().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode);
        var out;
        var r = fn(t.objectStore(store));
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Storage is full or unavailable.')); };
      });
    });
  }
  function allRows(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; }); }
  function blobSize(b) { return b && b.size ? b.size : 0; }
  function idsIn(doc) { return window.LE && LE.project && LE.project.assetIds ? LE.project.assetIds(doc) : []; }

  /* One pass over the designs database: designs, versions, photos and what each photo is used by. */
  function designs() {
    if (!window.indexedDB) return Promise.resolve(null);
    return Promise.all([allRows('projects'), allRows('versions'), allRows('assets'), LE_kit()]).then(function (r) {
      var projects = r[0], vers = r[1], assets = r[2], logos = r[3];
      var refs = {};
      var byProject = {};
      function count(doc, pid) {
        idsIn(doc).forEach(function (id) {
          refs[id] = (refs[id] || 0) + 1;
          if (pid) (byProject[pid] = byProject[pid] || {})[id] = 1;
        });
      }
      projects.forEach(function (p) { count(p.doc, p.id); });
      vers.forEach(function (v) { count(v.doc, null); });
      logos.forEach(function (id) { refs[id] = (refs[id] || 0) + 1; });
      var assetBytes = {};
      assets.forEach(function (a) { assetBytes[a.id] = (a.bytes || blobSize(a.blob)) + blobSize(a.thumb); });
      var grace = 10 * 60 * 1000;
      var unused = assets.filter(function (a) { return !refs[a.id] && Date.now() - (a.createdAt || 0) > grace; });
      var vByP = {};
      vers.forEach(function (v) {
        var size = JSON.stringify(v.doc || {}).length + blobSize(v.thumb);
        var row = vByP[v.projectId] = vByP[v.projectId] || { count: 0, bytes: 0, list: [] };
        row.count++;
        row.bytes += size;
        row.list.push({ id: v.id, at: v.at, kind: v.kind, bytes: size });
      });
      var rows = projects.map(function (p) {
        var ids = Object.keys(byProject[p.id] || {});
        var photos = sum(ids.map(function (id) { return assetBytes[id] || 0; }));
        return {
          id: p.id, name: p.name || 'Untitled design', updatedAt: p.updatedAt, pages: p.pages, photos: ids.length,
          docBytes: (p.bytes || 0) + blobSize(p.thumb), photoBytes: photos, bytes: (p.bytes || 0) + blobSize(p.thumb) + photos,
          versions: vByP[p.id] || { count: 0, bytes: 0, list: [] }
        };
      }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      var usedPhotoBytes = sum(assets.filter(function (a) { return refs[a.id]; }).map(function (a) { return assetBytes[a.id]; }));
      return {
        projects: rows,
        projectBytes: sum(projects.map(function (p) { return (p.bytes || 0) + blobSize(p.thumb); })) + usedPhotoBytes,
        versionCount: vers.length,
        versionBytes: sum(Object.keys(vByP).map(function (k) { return vByP[k].bytes; })),
        orphanVersions: Object.keys(vByP).filter(function (k) { return !projects.some(function (p) { return p.id === k; }); }),
        unused: unused.map(function (a) { return { id: a.id, name: a.name, bytes: assetBytes[a.id], at: a.lastUsed || a.createdAt }; }),
        unusedBytes: sum(unused.map(function (a) { return assetBytes[a.id]; })),
        photoCount: assets.length
      };
    }).catch(function (err) { console.warn(err); return null; });
  }
  function LE_kit() {
    if (!(window.LE && LE.project && LE.project.brandKit)) return Promise.resolve([]);
    return LE.project.brandKit().then(function (k) { return (k && k.logos) || []; }, function () { return []; });
  }
  /* Keeps the newest `keep` automatic versions per design. Versions you named are kept. */
  function trimVersions(keep, dry) {
    return allRows('versions').then(function (vs) {
      var by = {};
      vs.forEach(function (v) { (by[v.projectId] = by[v.projectId] || []).push(v); });
      var drop = [];
      Object.keys(by).forEach(function (pid) {
        var autos = by[pid].filter(function (v) { return v.kind !== 'checkpoint'; }).sort(function (a, b) { return b.at - a.at; });
        autos.slice(keep).forEach(function (v) { drop.push(v); });
      });
      var bytes = sum(drop.map(function (v) { return JSON.stringify(v.doc || {}).length + blobSize(v.thumb); }));
      if (dry || !drop.length) return { count: drop.length, bytes: bytes };
      return tx('versions', 'readwrite', function (s) { drop.forEach(function (v) { s.delete(v.id); }); return null; }).then(function () {
        return { count: drop.length, bytes: bytes };
      });
    }).catch(function () { return { count: 0, bytes: 0 }; });
  }
  function deleteProject(id) {
    return needProject().then(function () { return LE.project.remove(id); }).then(function () {
      try { if (localStorage.getItem('le-studio-last') === id) localStorage.removeItem('le-studio-last'); } catch (e) {}
    });
  }
  function clearUnusedImages() { return needProject().then(function () { return LE.project.gc(); }); }

  /* ---------- Settings and keys (localStorage) ---------- */
  var SETTINGS = [
    [/^le-theme$|^it-theme$/, 'Light or dark theme'],
    [/^le-stock-keys$/, 'Stock photo keys', 'Keys you pasted for Pixabay, Pexels or Openverse. Clearing them signs those searches out.'],
    [/^le-perf$/, 'Speed and quality mode'],
    [/^le-pdf-details/, 'Your saved details (PDF forms)', 'Names, addresses and other details you saved to fill PDF forms, and which form field each one goes in. Clearing them cannot be undone.'],
    [/^le-docs-v1$/, 'Your invoices, clients and business details', 'Business details, the client list, drafts and invoice numbers from the PDF studio. Export your clients first if you want to keep them.'],
    [/^le-pdf-workflows$/, 'Your saved PDF workflows', 'Step lists you saved in the PDF studio. Export them first if you want to keep them.'],
    [/^le-user-recipes$/, 'Your saved recipes', 'Recipes you saved or imported. Back them up first if you want to keep them.'],
    [/^le-recipe-/, 'Recipe bookmarks and ratings'],
    [/^le-studio-last$/, 'Last open design'],
    [/^le-studio-/, 'Photo studio preferences'],
    [/^le-recent-colors$|^le-studio-colors$/, 'Recent colours'],
    [/^le-convert-/, 'Convert to PDF preferences'],
    [/^le-pwa-limits$/, 'Storage limits you set here'],
    [/^le-pwa/, 'Install and storage reminders'],
    [/^le-downloads-usage$/, 'What you use, for offline downloads', 'Counts of the features you open, kept on this device to decide what to download next.'],
    [/^le-downloads$/, 'Offline download choices'],
    [/^le-downloads-keep$/, 'Which parts are kept offline', 'Which studios this device keeps for offline use (set when you install one on its own). The offline files themselves are listed under App files.']
  ];
  function settingsRows() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = localStorage.getItem(k) || '';
        var m = SETTINGS.filter(function (s) { return s[0].test(k); })[0];
        out.push({ key: k, name: m ? m[1] : 'Other setting (' + k + ')', about: m && m[2], bytes: (k.length + v.length) * 2 });
      }
    } catch (e) {}
    return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function stockKeys() {
    var raw = lsGet('le-stock-keys', null);
    if (!raw || typeof raw !== 'object') return [];
    var rows = [];
    if (raw.pixabay) rows.push({ id: 'pixabay', name: 'Pixabay key', tail: String(raw.pixabay).slice(-4) });
    if (raw.pexels) rows.push({ id: 'pexels', name: 'Pexels key', tail: String(raw.pexels).slice(-4) });
    if (raw.unsplash) rows.push({ id: 'unsplash', name: 'Unsplash key', tail: String(raw.unsplash).slice(-4) });
    if (raw.openverse && typeof raw.openverse === 'object' && (raw.openverse.clientId || raw.openverse.token || raw.openverse.clientSecret)) rows.push({ id: 'openverse', name: 'Openverse sign-in', tail: '' });
    return rows;
  }
  function clearStockKey(id) {
    var raw = lsGet('le-stock-keys', {}) || {};
    if (id === 'openverse') delete raw.openverse; else delete raw[id];
    if (Object.keys(raw).length) lsSet('le-stock-keys', raw); else { try { localStorage.removeItem('le-stock-keys'); } catch (e) {} }
  }

  /* ---------- The report: every place LocalEditor stores something ---------- */
  var COLORS = { app: '#9E9E9E', fonts: '#4C6FD8', packs: '#7C5CD6', photos: '#D45D79', models: '#0E8A93', projects: '#3F67D9', versions: '#81A6FE', unused: '#D9822B', settings: '#5B8C9A', other: '#C7C7C7' };
  function report() {
    var est = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(function () { return {}; }) : Promise.resolve({});
    var pers = navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(function () { return false; }) : Promise.resolve(null);
    var appP = Promise.all([versions(), appCacheNames()]).then(function (r) {
      return Promise.all(r[1].map(function (n) { return entries(n).then(function (list) { return { name: n, list: list }; }); })).then(function (all) { return { v: r[0], caches: all }; });
    });
    return Promise.all([est, pers, appP, fontEntries(), entries(CACHES.assets), entries(CACHES.photos), entries(CACHES.models), entries(CACHES.share), designs(), packNames()]).then(function (r) {
      var e = r[0] || {}, app = r[2], fonts = r[3], assets = r[4], photos = r[5], models = r[6], share = r[7], d = r[8], names = r[9];
      var packsUsed = lsGet(KEY.packs, {}) || {};
      var cats = [];

      var appItems = app.caches.map(function (c) {
        var label = c.name === app.v.current ? 'This version' : c.name === app.v.waiting ? 'New version, ready to install' : 'Older version (left over)';
        return { id: c.name, name: label, detail: plural(c.list.length, 'file'), bytes: sum(c.list, 'bytes'), stale: c.name !== app.v.current && c.name !== app.v.waiting };
      });
      cats.push({
        id: 'app', name: 'App files', color: COLORS.app, bytes: sum(appItems, 'bytes'), count: sum(app.caches.map(function (c) { return c.list.length; })), unit: 'file',
        about: 'The pages, code and icons that let LocalEditor open with no connection. Cleared files download again next time you are online.',
        items: appItems
      });

      var fam = {};
      fonts.forEach(function (x) { var f = fontFamily(x.path); (fam[f] = fam[f] || []).push(x); });
      cats.push({
        id: 'fonts', name: 'Fonts', color: COLORS.fonts, bytes: sum(fonts, 'bytes'), count: Object.keys(fam).length, unit: 'font',
        about: 'Typefaces downloaded when a design used them, and fonts you saved for offline use. Downloaded ones may be removed when space is needed and download again when used; saved ones stay until you remove them.',
        items: Object.keys(fam).sort().map(function (f) {
          var saved = fam[f].filter(function (x) { return x.saved; }).length;
          return { id: f, name: fontName(f), detail: (saved ? 'Saved on this device' : 'Downloaded when used') + ' · ' + plural(fam[f].length, 'file'), bytes: sum(fam[f], 'bytes'), at: Math.max.apply(null, fam[f].map(function (x) { return x.at; })), entries: fam[f], saved: saved > 0 };
        })
      });

      var packs = {}, library = [], collageData = [];
      assets.forEach(function (x) {
        var id = packId(x.path);
        if (id) (packs[id] = packs[id] || []).push(x);
        else if (x.path.indexOf('/assets/data/collages/') >= 0) collageData.push(x);
        else library.push(x);
      });
      var packItems = Object.keys(packs).map(function (id) {
        var at = Math.max(packsUsed[id] || 0, Math.max.apply(null, packs[id].map(function (x) { return x.at; })));
        return { id: id, name: (names[id] || pretty(id)) + ' icons', detail: 'Used ' + ago(at), bytes: sum(packs[id], 'bytes'), at: at, entries: packs[id], pack: true };
      }).sort(function (a, b) { return b.bytes - a.bytes; });
      if (library.length) packItems.push({ id: 'library', name: 'Icon search, emoji and colour palettes', detail: plural(library.length, 'file'), bytes: sum(library, 'bytes'), entries: library });
      cats.push({
        id: 'packs', name: 'Icon and graphic packs', color: COLORS.packs, bytes: sum(packItems, 'bytes'), count: Object.keys(packs).length, unit: 'pack',
        about: 'Icon styles you opened or saved for offline use. Remove any you no longer use; they download again if you pick them.',
        items: packItems
      });

      var photoItems = [];
      if (photos.length) photoItems.push({ id: 'pool', name: 'Collage sample photos', detail: plural(photos.length, 'photo'), bytes: sum(photos, 'bytes'), entries: photos });
      if (collageData.length) photoItems.push({ id: 'layouts', name: 'Collage layouts', detail: plural(collageData.length, 'file'), bytes: sum(collageData, 'bytes'), entries: collageData });
      cats.push({
        id: 'photos', name: 'Collage and stock photos cache', color: COLORS.photos, bytes: sum(photoItems, 'bytes'), count: photos.length, unit: 'photo',
        about: 'Sample photos and layouts downloaded for collages. Stock photos you add to a design are kept inside that design, not here.',
        items: photoItems
      });

      var mod = {};
      models.forEach(function (x) { var id = modelId(x); (mod[id] = mod[id] || []).push(x); });
      cats.push({
        id: 'models', name: 'AI models', color: COLORS.models, bytes: sum(models, 'bytes'), count: Object.keys(mod).length, unit: 'model',
        about: 'On-device AI, such as the background remover, downloaded only when you ask for it. It runs here; your photos are never sent anywhere.',
        empty: 'No AI models downloaded.',
        items: Object.keys(mod).map(function (id) {
          var info = modelInfo[id] || {};
          return { id: id, name: info.name || pretty(id), detail: (info.about ? info.about + ' · ' : '') + 'Downloaded ' + ago(Math.max.apply(null, mod[id].map(function (x) { return x.at; }))), bytes: sum(mod[id], 'bytes'), entries: mod[id] };
        })
      });

      if (d) {
        cats.push({
          id: 'projects', name: 'Your designs', color: COLORS.projects, bytes: d.projectBytes, count: d.projects.length, unit: 'design', precious: true,
          about: 'Designs saved in the photo studio, with the photos inside them. Deleting a design cannot be undone, so back it up first.',
          empty: 'No designs saved yet.',
          items: d.projects.map(function (p) {
            return { id: p.id, name: p.name, detail: 'Edited ' + ago(p.updatedAt) + ' · ' + plural(p.photos, 'photo'), bytes: p.bytes, at: p.updatedAt, project: true };
          })
        });
        cats.push({
          id: 'versions', name: 'Version history', color: COLORS.versions, bytes: d.versionBytes, count: d.versionCount, unit: 'version',
          about: 'Automatic snapshots that let you go back in time. Versions you named yourself are always kept.',
          items: d.projects.filter(function (p) { return p.versions.count; }).map(function (p) {
            return { id: p.id, name: p.name, detail: plural(p.versions.count, 'version'), bytes: p.versions.bytes };
          })
        });
        cats.push({
          id: 'unused', name: 'Unused images', color: COLORS.unused, bytes: d.unusedBytes, count: d.unused.length, unit: 'image',
          about: 'Photos that no design, version or brand kit uses any more. Safe to clear.',
          empty: 'Nothing unused. Nice and tidy.',
          items: []
        });
      }

      var settings = settingsRows();
      cats.push({
        id: 'settings', name: 'Settings and keys', color: COLORS.settings, bytes: sum(settings, 'bytes'), count: settings.length, unit: 'setting',
        about: 'Small preferences such as your theme, and any API keys you pasted. Keys never leave this device except to the service they belong to.',
        items: settings.map(function (s) { return { id: s.key, name: s.name, detail: s.about || '', bytes: s.bytes, setting: true }; }),
        keys: stockKeys()
      });

      var known = sum(cats, 'bytes') + sum(share, 'bytes');
      var usage = e.usage || known;
      return {
        quota: e.quota || null,
        usage: usage,
        other: Math.max(0, usage - known),
        persisted: r[1],
        version: app.v.version,
        share: share,
        categories: cats
      };
    });
  }

  /* ---------- Clearing ---------- */
  function clearCategory(id, opts) {
    opts = opts || {};
    var done = function (n) { emit('storage-change', { category: id }); return n; };
    if (id === 'fonts' || id === 'photos') {
      var names = id === 'fonts' ? [CACHES.fonts, CACHES.savedFonts] : [CACHES.photos];
      return Promise.all(names.map(function (n) { return entries(n); })).then(function (lists) {
        var all = [].concat.apply([], lists);
        if (id === 'photos') return entries(CACHES.assets).then(function (a) { return all.concat(a.filter(function (x) { return x.path.indexOf('/assets/data/collages/') >= 0; })); });
        return all;
      }).then(removeEntries).then(done);
    }
    if (id === 'packs') return entries(CACHES.assets).then(function (a) { return removeEntries(a.filter(function (x) { return x.path.indexOf('/assets/data/collages/') < 0; })); }).then(function (n) { forgetPacks(); return n; }).then(done);
    if (id === 'models') return entries(CACHES.models).then(removeEntries).then(done);
    if (id === 'app') return appCacheNames().then(function (names) { return Promise.all(names.map(function (n) { return caches.delete(n); })); }).then(function () { return 0; }).then(done);
    if (id === 'unused') return clearUnusedImages().then(function (r) { return r ? r.freed : 0; }).then(done);
    if (id === 'versions') return trimVersions(opts.keep == null ? limits().versions : opts.keep).then(function (r) { return r.bytes; }).then(done);
    if (id === 'settings') {
      try { var keep = ['le-pwa-limits']; Object.keys(localStorage).forEach(function (k) { if (keep.indexOf(k) < 0) localStorage.removeItem(k); }); } catch (e) {}
      return Promise.resolve(0).then(done);
    }
    return Promise.reject(new Error('Designs are never cleared in one tap. Delete them one by one.'));
  }
  function forgetPacks(ids) {
    var A = window.LE && LE.assets;
    var m = lsGet(KEY.packs, {}) || {};
    (ids || Object.keys(m)).forEach(function (id) {
      delete m[id];
      if (A && A.removeStyleOffline) { try { A.removeStyleOffline(id); } catch (e) {} }
    });
    lsSet(KEY.packs, m);
  }
  function removeItem(cat, item) {
    if (item.entries) return removeEntries(item.entries).then(function (n) { if (item.pack) forgetPacks([item.id]); emit('storage-change', { category: cat.id }); return n; });
    if (cat.id === 'app') return caches.delete(item.id).then(function () { emit('storage-change', { category: 'app' }); return item.bytes; });
    if (item.project) return deleteProject(item.id).then(function () { emit('storage-change', { category: 'projects' }); return item.bytes; });
    if (item.setting) { try { localStorage.removeItem(item.id); } catch (e) {} emit('storage-change', { category: 'settings' }); return Promise.resolve(item.bytes); }
    return Promise.resolve(0);
  }
  function repairAppFiles() {
    var c = sw();
    if (!c || !c.controller) return Promise.resolve(null);
    return ask(c.controller, { type: 'le-precache' }, 120000);
  }

  /* ---------- Limits: enforced automatically, and "Free up space" ---------- */
  /* Downloads (fonts, icon packs, collage photos and layouts) share one budget. Least recently used goes first. */
  function downloadsOverBudget(budget) {
    var packsUsed = lsGet(KEY.packs, {}) || {};
    return Promise.all(DOWNLOADS.map(entries)).then(function (lists) {
      var all = [].concat.apply([], lists).map(function (x) {
        var id = packId(x.path);
        if (id && packsUsed[id]) x.at = Math.max(x.at, packsUsed[id]);
        return x;
      });
      var total = sum(all, 'bytes');
      all.sort(function (a, b) { return a.at - b.at; });
      var drop = [];
      for (var i = 0; i < all.length && total > budget; i++) { drop.push(all[i]); total -= all[i].bytes; }
      return drop;
    });
  }
  function stalePacks(days) {
    if (!days) return Promise.resolve([]);
    var packsUsed = lsGet(KEY.packs, {}) || {};
    var cutoff = Date.now() - days * DAY;
    return entries(CACHES.assets).then(function (a) {
      /* An entry of unknown age (no stamp, no date) is never called stale. */
      return a.filter(function (x) { var id = packId(x.path); var t = Math.max(x.at, packsUsed[id] || 0); return id && t > 0 && t < cutoff; });
    });
  }
  function staleShares() {
    return entries(CACHES.share).then(function (a) { return a.filter(function (x) { return Date.now() - x.at > DAY; }); });
  }
  function staleAppCaches() {
    return Promise.all([versions(), appCacheNames()]).then(function (r) {
      var keep = [r[0].current, r[0].waiting];
      return Promise.all(r[1].filter(function (n) { return keep.indexOf(n) < 0; }).map(function (n) {
        return entries(n).then(function (l) { return { name: n, bytes: sum(l, 'bytes') }; });
      }));
    });
  }
  /* What "Free up space" would do. Never includes designs or AI models. */
  function plan() {
    var L = limits();
    var dp = window.indexedDB ? designs() : Promise.resolve(null);
    return Promise.all([dp, trimVersions(L.versions, true).catch(function () { return { count: 0, bytes: 0 }; }), staleAppCaches(), stalePacks(L.packDays), staleShares(), downloadsOverBudget(L.budgetMB * MB)]).then(function (r) {
      var items = [];
      var d = r[0];
      if (d && d.unused.length) items.push({ id: 'unused', label: plural(d.unused.length, 'unused image'), bytes: d.unusedBytes, run: function () { return clearUnusedImages(); } });
      if (r[1].count) items.push({ id: 'versions', label: plural(r[1].count, 'old automatic version') + ' (keeping the last ' + L.versions + ' per design)', bytes: r[1].bytes, run: function () { return trimVersions(L.versions); } });
      if (r[2].length) items.push({ id: 'app-old', label: 'Left-over files from an older app version', bytes: sum(r[2], 'bytes'), run: function () { return Promise.all(r[2].map(function (c) { return caches.delete(c.name); })); } });
      var stale = r[3];
      if (stale.length) items.push({ id: 'packs', label: plural(stale.length, 'icon pack') + ' not used for ' + L.packDays + ' days', bytes: sum(stale, 'bytes'), run: function () { return removeEntries(stale).then(function () { forgetPacks(stale.map(function (x) { return packId(x.path); })); }); } });
      if (r[4].length) items.push({ id: 'share', label: 'Shared files that were never opened', bytes: sum(r[4], 'bytes'), run: function () { return removeEntries(r[4]); } });
      var seen = {};
      stale.concat(r[4]).forEach(function (x) { seen[x.url] = 1; });
      var over = r[5].filter(function (x) { return !seen[x.url]; });
      if (over.length) items.push({ id: 'budget', label: 'Least-used downloads over your ' + fmt(L.budgetMB * MB) + ' limit', bytes: sum(over, 'bytes'), run: function () { return removeEntries(over); } });
      return { items: items, bytes: sum(items, 'bytes') };
    });
  }
  function freeUpSpace(opts) {
    opts = opts || {};
    return plan().then(function (p) {
      if (opts.dryRun) return p;
      var chain = Promise.resolve();
      p.items.forEach(function (it) { chain = chain.then(function () { return it.run(); }).catch(function (e) { console.warn(e); }); });
      return chain.then(function () { emit('storage-change', { category: 'all' }); p.freed = p.bytes; return p; });
    });
  }
  /* Automatic limits: downloads budget, stale icon packs, versions kept per design. Never designs. */
  function enforceLimits(opts) {
    opts = opts || {};
    var L = limits();
    var jobs = [
      downloadsOverBudget(L.budgetMB * MB).then(removeEntries),
      stalePacks(L.packDays).then(function (list) { return removeEntries(list).then(function (n) { if (list.length) forgetPacks(list.map(function (x) { return packId(x.path); })); return n; }); }),
      staleShares().then(removeEntries)
    ];
    if (opts.versions !== false && window.indexedDB && window.LE && LE.project) jobs.push(trimVersions(L.versions).then(function (r) { return r.bytes; }));
    return Promise.all(jobs.map(function (j) { return j.catch(function () { return 0; }); })).then(function (r) {
      state({ enforcedAt: Date.now() });
      var freed = sum(r);
      if (freed) emit('storage-change', { category: 'limits', freed: freed });
      return { freed: freed };
    });
  }

  /* ---------- Keep my work safe ---------- */
  function backup() {
    return Promise.all([needProject(), needZip()]).then(function () { return allRows('projects'); }).then(function (rows) {
      var enc = new TextEncoder();
      var files = [];
      var used = {};
      var chain = Promise.resolve();
      rows.forEach(function (rec) {
        chain = chain.then(function () {
          return LE.project.exportFile(rec.doc).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
            var base = String(rec.name || 'design').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'design';
            var name = base;
            for (var n = 2; used[name]; n++) name = base + '-' + n;
            used[name] = 1;
            files.push({ name: 'designs/' + name + '.leproject', data: new Uint8Array(buf) });
          }).catch(function (err) { files.push({ name: 'designs/' + rec.id + '-could-not-export.txt', data: enc.encode(String(err && err.message || err)) }); });
        });
      });
      return chain.then(function () {
        var recipes = lsGet('le-user-recipes', []) || [];
        recipes.forEach(function (r, i) {
          var id = (r && r.metadata && r.metadata.id ? String(r.metadata.id) : 'recipe-' + i).replace(/[^\w-]+/g, '-').slice(0, 60);
          files.push({ name: 'recipes/' + id + '.leworkflow', data: enc.encode(JSON.stringify(r, null, 1)) });
        });
        files.unshift({ name: 'README.txt', data: enc.encode('LocalEditor backup, ' + new Date().toISOString() + '\n\n' + rows.length + ' designs in designs/ (open each .leproject in the photo studio).\n' + recipes.length + ' recipes in recipes/ (import each .leworkflow in Recipes).\n') });
        return { blob: new Blob([LE.zip(files)], { type: 'application/zip' }), designs: rows.length, recipes: recipes.length };
      });
    });
  }
  function eraseEverything(opts) {
    opts = opts || {};
    C.editors().forEach(function (ed) { call(ed, 'discard'); });
    var jobs = [];
    if (hasCaches()) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
    var c = sw();
    if (c && c.getRegistrations) jobs.push(c.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }).catch(function () {}));
    if (window.indexedDB) {
      var names = indexedDB.databases ? indexedDB.databases().then(function (l) { return l.map(function (x) { return x.name; }).concat(DATABASES); }, function () { return DATABASES; }) : Promise.resolve(DATABASES);
      jobs.push(names.then(function (list) {
        var uniq = list.filter(function (n, i) { return n && list.indexOf(n) === i; });
        return Promise.all(uniq.map(wipeDb));
      }));
    }
    return Promise.all(jobs.map(function (j) { return j.catch(function () {}); })).then(function () {
      try { localStorage.clear(); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
      emit('erased', {});
      if (opts.reload !== false) setTimeout(function () { location.href = BASE + '?erased=1'; }, 400);
      return true;
    });
  }
  /* Empty every store first (works even while another tab holds the database open), then delete it. */
  function wipeDb(name) {
    if (name === 'le-projects' && dbp) { dbp.then(function (d) { d.close(); }).catch(function () {}); dbp = null; }
    return new Promise(function (resolve) {
      var exists = true;
      var req = indexedDB.open(name);
      req.onupgradeneeded = function () { exists = false; };
      req.onsuccess = function () {
        var d = req.result;
        var stores = [].slice.call(d.objectStoreNames);
        var fin = function () {
          d.close();
          var del = indexedDB.deleteDatabase(name);
          del.onsuccess = del.onerror = del.onblocked = function () { resolve(); };
        };
        if (!exists || !stores.length) { fin(); return; }
        try {
          var t = d.transaction(stores, 'readwrite');
          stores.forEach(function (s) { t.objectStore(s).clear(); });
          t.oncomplete = t.onerror = t.onabort = fin;
        } catch (e) { fin(); }
      };
      req.onerror = function () { resolve(); };
    });
  }

  /* ---------- The storage manager ---------- */
  var openSheet = null;
  function openStorage(opts) {
    opts = opts || {};
    if (openSheet && openSheet.open) { if (opts.free) openSheet._free(); return Promise.resolve(openSheet); }
    var d = sheet('lp-storage', 'Storage on this device');
    openSheet = d;
    d.firstChild.innerHTML = headHTML('Storage on this device', 'Everything LocalEditor keeps here, and how to tidy it.') + '<div class="lp-body" data-lp-body>' + LOADING + '</div>';
    bindClose(d);
    d.addEventListener('close', function () {
      if (openSheet === d) openSheet = null;
      if (/[?&]storage=1|#storage$/.test(location.href)) history.replaceState(null, '', location.href.replace(/([?&])storage=1&?/, '$1').replace(/[?&]$/, '').replace(/#storage$/, ''));
    });
    showModal(d);
    var body = d.querySelector('[data-lp-body]');
    d._free = function () { freeFlow(d, body); };
    var off = on('storage-change', function () { if (d.open && !d._busy) paint(); });
    d.addEventListener('close', off);
    function paint() {
      return report().then(function (r) { d._report = r; renderStorage(d, body, r); return d; }).catch(function (err) {
        console.warn(err);
        body.innerHTML = '<div class="lp-fail" role="alert"><p class="lp-note">The storage on this device could not be measured. Your designs are safe.</p><button type="button" class="lp-btn" data-lp-retry>Try again</button></div>';
        body.querySelector('[data-lp-retry]').onclick = function () { body.innerHTML = LOADING; paint(); };
        return d;
      });
    }
    d._paint = paint;
    return paint().then(function () { if (opts.free) freeFlow(d, body); return d; });
  }
  /* While sizes are measured: the sheet's own shape (total, bar, the list rows), not a blank sheet. */
  var LOADING = '<div class="lp-loading" role="status" aria-busy="true"><span class="skel skel-row"></span><span class="skel skel-line"></span><span class="skel skel-row"></span><span class="skel skel-row"></span><span class="skel skel-row"></span><span class="skel skel-row"></span><p class="lp-note">Measuring what is stored…</p></div>';
  function renderStorage(d, body, r) {
    var cats = r.categories;
    var used = r.usage;
    var scale = r.quota || used || 1;
    var bar = cats.filter(function (c) { return c.bytes > 0; }).map(function (c) {
      return '<i style="width:' + Math.max(0.6, c.bytes / scale * 100).toFixed(2) + '%;background:' + c.color + '" title="' + esc(c.name + ': ' + fmt(c.bytes)) + '"></i>';
    }).join('') + (r.other ? '<i style="width:' + Math.max(0.4, r.other / scale * 100).toFixed(2) + '%;background:' + COLORS.other + '" title="Other"></i>' : '');
    var pct = r.quota ? Math.round(used / r.quota * 100) : null;
    var L = limits();
    var mem = memory();
    body.innerHTML =
      '<section class="lp-summary">' +
        '<div class="lp-total"><b>' + fmt(used) + '</b><span>' + (r.quota ? 'used of ' + fmt(r.quota) + ' this browser lets LocalEditor use' + (pct >= 1 ? ' (' + pct + '%)' : '') : 'used on this device') + '</span></div>' +
        '<div class="lp-bar" role="img" aria-label="' + esc(fmt(used) + ' used' + (r.quota ? ' of ' + fmt(r.quota) : '')) + '">' + bar + '</div>' +
        '<ul class="lp-legend">' + cats.filter(function (c) { return c.bytes > 0; }).map(function (c) { return '<li><i style="background:' + c.color + '"></i>' + esc(c.name) + '</li>'; }).join('') + (r.other ? '<li><i style="background:' + COLORS.other + '"></i>Browser overhead</li>' : '') + '</ul>' +
        '<div class="lp-free"><button type="button" class="lp-btn lp-primary lp-wide" data-lp-free>' + ICON.spark + 'Free up space</button><p>Safe cleanup. Your designs are never touched.</p></div>' +
      '</section>' +
      '<section class="lp-sec"><h3>What is stored</h3><div class="lp-cats">' + cats.map(catHTML).join('') + '</div></section>' +
      '<section class="lp-sec"><h3>Limits</h3><p class="lp-sub">LocalEditor keeps to these on its own. Defaults suit this ' + esc(tierName(mem.tier)) + '.</p><div class="lp-limits">' +
        limitRow('budgetMB', 'Space for downloads', 'Fonts, icon packs and collage photos. The least used go first.', [[100, '100 MB'], [250, '250 MB'], [500, '500 MB'], [800, '800 MB'], [1500, '1.5 GB'], [3000, '3 GB']], L.budgetMB, fmt(L.budgetMB * MB)) +
        limitRow('versions', 'Versions kept per design', 'Automatic snapshots. Named versions are always kept.', [[5, '5'], [10, '10'], [20, '20'], [30, '30'], [50, '50']], L.versions) +
        limitRow('packDays', 'Remove icon packs unused for', 'They download again if you pick them.', [[0, 'Never'], [14, '2 weeks'], [30, '1 month'], [60, '2 months'], [90, '3 months']], L.packDays) +
        toggleRow('autoClean', 'Keep to these limits automatically', 'Checks a few times a day, quietly.', L.autoClean) +
        toggleRow('memoryGuard', 'Free editor memory in the background', 'When you switch away, big images are let go and redrawn when you return.', L.memoryGuard) +
      '</div></section>' +
      (window.LE && LE.downloads ? '<section class="lp-sec" id="downloads" data-lp-downloads></section>' : '') +
      '<section class="lp-sec lp-safe"><h3>Keep my work safe</h3>' +
        '<div class="lp-persist" data-lp-persist>' + persistHTML(r.persisted) + '</div>' +
        '<div class="lp-row-btns"><button type="button" class="lp-btn" data-lp-backup>' + ICON.install + 'Back up everything</button><button type="button" class="lp-btn lp-danger-ghost" data-lp-erase>Erase everything on this device</button></div>' +
        '<p class="lp-sub">The backup is one .zip with every design and saved recipe. Erasing removes all of it from this browser and cannot be undone.</p>' +
      '</section>' +
      '<section class="lp-sec"><h3>This device</h3>' + memoryHTML(mem, r) + '</section>';
    bindStorage(d, body, r);
    var dl = body.querySelector('[data-lp-downloads]');
    if (dl) LE.downloads.renderSettings(dl);
  }
  function tierName(t) { return t === 'older' ? 'device (lighter settings to save memory)' : t === 'modern' ? 'phone or tablet' : 'computer'; }
  function catHTML(c) {
    var empty = !c.bytes && !(c.items && c.items.length) && !(c.keys && c.keys.length);
    var count = c.count ? plural(c.count, c.unit) : '';
    var actions = '';
    if (c.id === 'app') actions = '<button type="button" class="lp-btn lp-btn-sm" data-lp-repair>Repair offline files</button>' + (c.items.some(function (i) { return i.stale; }) ? '<button type="button" class="lp-btn lp-btn-sm" data-lp-clear="app-old">Remove older versions</button>' : '');
    else if (c.id === 'versions') actions = c.count ? '<button type="button" class="lp-btn lp-btn-sm" data-lp-trim>Keep the last ' + limits().versions + ' per design</button>' : '';
    else if (c.id === 'unused') actions = c.count ? '<button type="button" class="lp-btn lp-btn-sm" data-lp-clear="unused">Clear ' + fmt(c.bytes) + '</button>' : '';
    else if (c.id === 'projects') actions = c.count ? '<button type="button" class="lp-btn lp-btn-sm" data-lp-backup>Back up designs</button>' : '';
    else if (c.id === 'settings') actions = c.count ? '<button type="button" class="lp-btn lp-btn-sm" data-lp-clear="settings">Reset all settings</button>' : '';
    else if (c.bytes) actions = '<button type="button" class="lp-btn lp-btn-sm" data-lp-clear="' + c.id + '">Clear ' + esc(c.name.toLowerCase().replace(' cache', '')) + '</button>';
    var items = (c.items || []).map(function (it, i) {
      var act = '';
      if (it.project) act = '<button type="button" class="lp-link lp-danger-tx" data-lp-item="' + i + '">Delete</button>';
      else if (c.id === 'app') act = it.stale ? '<button type="button" class="lp-link" data-lp-item="' + i + '">Remove</button>' : '';
      else if (c.id === 'versions' || c.id === 'unused') act = '';
      else act = '<button type="button" class="lp-link" data-lp-item="' + i + '">' + (it.setting ? 'Clear' : 'Remove') + '</button>';
      return '<li><div><b>' + esc(it.name) + '</b>' + (it.detail ? '<small>' + esc(it.detail) + '</small>' : '') + '</div><span class="lp-size">' + fmt(it.bytes) + '</span>' + act + '</li>';
    }).join('');
    var keys = (c.keys || []).map(function (k) {
      return '<li class="lp-key"><div><b>' + esc(k.name) + '</b><small>' + (k.tail ? 'Ends in …' + esc(k.tail) : 'Signed in') + '</small></div><span class="lp-size"></span><button type="button" class="lp-link" data-lp-key="' + esc(k.id) + '">Clear</button></li>';
    }).join('');
    return '<details class="lp-cat" data-cat="' + c.id + '"' + (c.id === 'projects' ? ' open' : '') + '><summary><i class="lp-dot" style="background:' + c.color + '"></i><span class="lp-cat-name">' + esc(c.name) + '<small>' + esc(count || (empty ? 'Empty' : '')) + '</small></span><span class="lp-size">' + fmt(c.bytes) + '</span>' + ICON.chev + '</summary>' +
      '<div class="lp-cat-body"><p>' + esc(c.about) + '</p>' + ((items || keys) ? '<ul class="lp-items">' + keys + items + '</ul>' : (c.empty ? '<p class="lp-empty">' + esc(c.empty) + '</p>' : '')) + (actions ? '<div class="lp-row-btns">' + actions + '</div>' : '') + '</div></details>';
  }
  function limitRow(key, label, hint, opts, value) {
    var has = opts.some(function (o) { return o[0] === value; });
    if (!has) opts = opts.concat([[value, key === 'budgetMB' ? fmt(value * MB) : String(value)]]).sort(function (a, b) { return a[0] - b[0]; });
    var id = 'lp-l-' + key;
    return '<div class="lp-limit"><label for="' + id + '"><b>' + esc(label) + '</b><small>' + esc(hint) + '</small></label><select id="' + id + '" data-lp-limit="' + key + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
  }
  function toggleRow(key, label, hint, value) {
    var id = 'lp-l-' + key;
    return '<div class="lp-limit"><label for="' + id + '"><b>' + esc(label) + '</b><small>' + esc(hint) + '</small></label><input type="checkbox" role="switch" class="lp-switch" id="' + id + '" data-lp-toggle="' + key + '"' + (value ? ' checked' : '') + '></div>';
  }
  function persistHTML(p) {
    if (p === null || p === undefined) return '<span class="lp-badge">' + ICON.shield + '</span><div><b>Protection is not available in this browser</b><small>Back up now and then to be safe.</small></div>';
    if (p) return '<span class="lp-badge lp-ok">' + ICON.shield + '</span><div><b>Your work is protected</b><small>This browser will not clear your designs on its own, even when the device runs low on space.</small></div>';
    return '<span class="lp-badge lp-warn">' + ICON.shield + '</span><div><b>Not protected yet</b><small>If this device runs low on space, the browser may clear LocalEditor’s data, including your designs. Ask it to keep them.</small></div><button type="button" class="lp-btn lp-btn-sm" data-lp-persist-ask>Protect my work</button>';
  }
  function memoryHTML(m, r) {
    var rows = [];
    if (m.deviceMemoryGB) rows.push(['Device memory', 'About ' + m.deviceMemoryGB + ' GB' + (m.deviceMemoryGB >= 8 ? ' or more' : '')]);
    if (m.heapUsed) rows.push(['This page is using', fmt(m.heapUsed) + ' of ' + fmt(m.heapLimit)]);
    m.editors.forEach(function (e) { if (e.stats && e.stats.text) rows.push([e.name, e.stats.text]); });
    if (r.version) rows.push(['App version', r.version]);
    rows.push(['Installed', installedText() + (canInstall() ? ' — <button type="button" class="lp-link" data-lp-install>' + (installedApps().length ? 'add more' : 'install') + '</button>' : '')]);
    return '<dl class="lp-dl">' + rows.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + (x[0] === 'Installed' ? x[1] : esc(x[1])) + '</dd></div>'; }).join('') + '</dl>' + '<p class="lp-sub"><a class="lp-link" href="' + BASE + 'device-check/">What works on this device</a></p>';
  }
  function installedText() {
    var l = installedApps();
    if (!l.length) return standalone() ? 'Yes' : 'No';
    if (l.indexOf('suite') >= 0) return 'Yes, the whole LocalEditor';
    return l.map(function (a) { return a === 'design' ? 'Design studio' : 'PDF studio'; }).join(' and ') + (l.length === 1 ? ' only' : '');
  }
  function busyBtn(b, text) { b.disabled = true; b._label = b.innerHTML; b.textContent = text; }
  function bindStorage(d, body, r) {
    var cats = {};
    r.categories.forEach(function (c) { cats[c.id] = c; });
    function after(p, msg) {
      d._busy = true;
      return p.then(function (n) {
        d._busy = false;
        toast(typeof msg === 'function' ? msg(n) : msg);
        return d._paint();
      }, function (err) { d._busy = false; toast((err && err.message) || 'That did not work. Try again.'); return d._paint(); });
    }
    body.querySelector('[data-lp-free]').onclick = function () { freeFlow(d, body); };
    [].forEach.call(body.querySelectorAll('[data-lp-clear]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-lp-clear');
        if (id === 'app-old') { busyBtn(b, 'Removing…'); after(staleAppCaches().then(function (l) { return Promise.all(l.map(function (c) { return caches.delete(c.name); })).then(function () { return sum(l, 'bytes'); }); }), function (n) { return 'Freed ' + fmt(n); }); return; }
        var c = cats[id];
        var warn = id === 'settings' ? 'Your theme, preferences, saved recipes and any API keys are reset. Designs are not affected.' : id === 'app' ? 'LocalEditor will not open offline until it downloads its files again.' : 'They download again when you need them.';
        confirmBox({ title: id === 'settings' ? 'Reset all settings?' : 'Clear ' + c.name.toLowerCase() + '?', text: esc(warn) + (c.bytes ? ' Frees about <b>' + fmt(c.bytes) + '</b>.' : ''), ok: id === 'settings' ? 'Reset' : 'Clear', danger: id === 'settings' }).then(function (yes) {
          if (!yes) return;
          busyBtn(b, 'Clearing…');
          after(clearCategory(id), function (n) { return n ? 'Freed ' + fmt(n) : 'Done'; });
        });
      };
    });
    [].forEach.call(body.querySelectorAll('[data-lp-item]'), function (b) {
      b.onclick = function () {
        var c = cats[b.closest('[data-cat]').getAttribute('data-cat')];
        var it = c.items[Number(b.getAttribute('data-lp-item'))];
        if (it.project) {
          confirmBox({ title: 'Delete “' + it.name + '”?', text: 'This design and its version history are removed from this device. This cannot be undone. Photos it shares with other designs are kept.', ok: 'Delete design', danger: true }).then(function (yes) {
            if (yes) after(removeItem(c, it), 'Deleted “' + it.name + '”');
          });
          return;
        }
        if (it.id === 'le-stock-keys' || it.id === 'le-user-recipes') {
          confirmBox({ title: 'Clear ' + it.name.toLowerCase() + '?', text: esc(it.detail || 'This cannot be undone.'), ok: 'Clear', danger: true }).then(function (yes) { if (yes) after(removeItem(c, it), 'Cleared'); });
          return;
        }
        busyBtn(b, '…');
        after(removeItem(c, it), function (n) { return n ? 'Freed ' + fmt(n) : 'Removed'; });
      };
    });
    [].forEach.call(body.querySelectorAll('[data-lp-key]'), function (b) {
      b.onclick = function () { clearStockKey(b.getAttribute('data-lp-key')); after(Promise.resolve(0), 'Key cleared from this device'); };
    });
    var trim = body.querySelector('[data-lp-trim]');
    if (trim) trim.onclick = function () { busyBtn(trim, 'Trimming…'); after(trimVersions(limits().versions).then(function (x) { return x.bytes; }), function (n) { return n ? 'Freed ' + fmt(n) : 'Nothing to trim'; }); };
    var repair = body.querySelector('[data-lp-repair]');
    if (repair) repair.onclick = function () {
      if (!navigator.onLine) { toast('Connect to the internet to repair offline files.'); return; }
      busyBtn(repair, 'Downloading…');
      after(repairAppFiles(), function (x) { return x ? (x.failed && x.failed.length ? 'Saved ' + x.count + ' files; ' + x.failed.length + ' could not be downloaded' : 'All ' + x.count + ' app files are saved for offline use') : 'Reload the page to finish setting up offline use.'; });
    };
    [].forEach.call(body.querySelectorAll('[data-lp-limit]'), function (s) {
      s.onchange = function () { var p = {}; p[s.getAttribute('data-lp-limit')] = Number(s.value); setLimits(p); after(enforceLimits(), function (x) { return x && x.freed ? 'Limit saved. Freed ' + fmt(x.freed) : 'Limit saved'; }); };
    });
    [].forEach.call(body.querySelectorAll('[data-lp-toggle]'), function (s) {
      s.onchange = function () { var p = {}; p[s.getAttribute('data-lp-toggle')] = s.checked; setLimits(p); toast('Saved'); };
    });
    var pa = body.querySelector('[data-lp-persist-ask]');
    if (pa) pa.onclick = function () {
      busyBtn(pa, 'Asking…');
      persist().then(function (ok) {
        var host = body.querySelector('[data-lp-persist]');
        host.innerHTML = persistHTML(ok);
        if (!ok) host.insertAdjacentHTML('beforeend', '<p class="lp-sub lp-full">The browser said not yet. It usually agrees once LocalEditor is installed or used often. Backups keep you safe meanwhile.</p>');
      });
    };
    [].forEach.call(body.querySelectorAll('[data-lp-backup]'), function (b) {
      b.onclick = function () {
        busyBtn(b, 'Packing…');
        backup().then(function (x) {
          b.disabled = false; b.innerHTML = b._label;
          if (!x.designs && !x.recipes) { toast('Nothing to back up yet.'); return; }
          download(x.blob, 'localeditor-backup-' + new Date().toISOString().slice(0, 10) + '.zip');
          toast('Backed up ' + plural(x.designs, 'design') + (x.recipes ? ' and ' + plural(x.recipes, 'recipe') : ''));
        }).catch(function (err) { b.disabled = false; b.innerHTML = b._label; toast((err && err.message) || 'The backup could not be made.'); });
      };
    });
    body.querySelector('[data-lp-erase]').onclick = function () { eraseFlow(d, r); };
    var ib = body.querySelector('[data-lp-install]');
    if (ib) ib.onclick = function () { d.close(); install(); };
  }
  function freeFlow(d, body) {
    var host = h('<div class="lp-plan" role="region" aria-label="Free up space"><div class="lp-loading">Looking for things to tidy…</div></div>');
    var old = body.querySelector('.lp-plan');
    if (old) old.remove();
    var summary = body.querySelector('.lp-free');
    if (summary) summary.after(host); else body.prepend(host);
    var top = body.querySelector('[data-lp-free]');
    if (top) top.classList.remove('lp-primary');
    host.scrollIntoView({ block: 'nearest' });
    plan().then(function (p) {
      if (!p.items.length) {
        host.innerHTML = '<p><b>Nothing to clean up.</b> Everything stored is in use. To free more, remove fonts, icon packs or designs below.</p><div class="lp-row-btns"><button type="button" class="lp-btn lp-btn-sm" data-x>OK</button></div>';
        host.querySelector('[data-x]').onclick = function () { host.remove(); if (top) top.classList.add('lp-primary'); };
        return;
      }
      host.innerHTML = '<p><b>Free about ' + fmt(p.bytes) + '</b> by removing:</p><ul class="lp-items">' + p.items.map(function (it) {
        return '<li><div><b>' + esc(it.label) + '</b></div><span class="lp-size">' + fmt(it.bytes) + '</span></li>';
      }).join('') + '</ul><p class="lp-sub">Your designs, named versions and AI models stay.</p><div class="lp-row-btns"><button type="button" class="lp-btn lp-btn-sm" data-x>Cancel</button><button type="button" class="lp-btn lp-btn-sm lp-primary" data-go>Free ' + fmt(p.bytes) + '</button></div>';
      host.querySelector('[data-x]').onclick = function () { host.remove(); if (top) top.classList.add('lp-primary'); };
      host.querySelector('[data-go]').onclick = function (e) {
        busyBtn(e.currentTarget, 'Freeing…');
        d._busy = true;
        freeUpSpace().then(function (res) {
          d._busy = false;
          toast('Freed ' + fmt(res.freed));
          d._paint();
        });
      };
    });
  }
  function eraseFlow(d) {
    confirmBox({
      title: 'Erase everything on this device?',
      text: 'This removes <b>all your designs</b>, version history, photos, saved recipes, settings, API keys, downloads and the offline app from this browser. Back up first if you want to keep anything.',
      ok: 'Continue', danger: true
    }).then(function (yes) {
      if (!yes) return false;
      return confirmBox({ title: 'Last check', text: 'There is no undo. LocalEditor will start fresh, like a first visit.', ok: 'Erase everything', danger: true, type: 'erase' });
    }).then(function (yes) {
      if (!yes) return;
      d._busy = true;
      d.querySelector('[data-lp-body]').innerHTML = '<div class="lp-loading">Erasing…</div>';
      eraseEverything().then(function () {
        d.querySelector('[data-lp-body]').innerHTML = '<div class="lp-done">' + ICON.shield + '<b>Everything is erased</b><p>Nothing from LocalEditor is left in this browser. Reloading…</p></div>';
      });
    });
  }

  window.LEPwa._more = {
    openInstallHelp: openInstallHelp, openChooser: openChooser, openStorage: openStorage, closeStorage: function () { if (openSheet) openSheet.close(); },
    report: report, plan: plan, freeUpSpace: freeUpSpace, clearCategory: clearCategory, trimVersions: trimVersions, enforceLimits: enforceLimits,
    backup: backup, eraseEverything: eraseEverything, repairAppFiles: repairAppFiles
  };
})();
