/* LocalEditor install, updates and storage manager. Loaded on every page by the loader at the end of app.js.
   Public API: window.LEPwa (listed at the bottom). People never see the words "service worker", "cache" or
   "IndexedDB": the UI talks about app files, downloads, designs and versions. */
(function () {
  'use strict';
  if (window.LEPwa) return;

  var root = document.documentElement;
  var BASE = root.getAttribute('data-root') || '';
  var KB = 1024;
  var MB = 1024 * 1024;
  var DAY = 864e5;
  var CACHES = { app: 'le-app-', fonts: 'le-fonts-v1', savedFonts: 'le-fonts-saved-v1', assets: 'le-assets-v1', photos: 'le-photos-v1', models: 'le-models-v1', share: 'le-share-v1' };
  var DOWNLOADS = [CACHES.fonts, CACHES.assets, CACHES.photos];
  var KEY = { state: 'le-pwa', limits: 'le-pwa-limits', packs: 'le-pwa-packs' };
  var DATABASES = ['le-projects', 'localeditor', 'le-signatures'];
  var early = window.__lePwaEarly || (window.__lePwaEarly = { prompt: null, installed: false });

  /* ---------- Small helpers ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { reportQuotaError(e); return false; } }
  function state(patch) {
    var s = lsGet(KEY.state, {}) || {};
    if (patch) { Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); lsSet(KEY.state, s); }
    return s;
  }
  function fmt(n) {
    n = Math.max(0, Number(n) || 0);
    if (n < MB) return (n ? Math.max(1, Math.round(n / KB)) : 0) + ' KB';
    if (n < 1024 * MB) return (n < 10 * MB ? (Math.round(n / MB * 10) / 10) : Math.round(n / MB)) + ' MB';
    return (Math.round(n / (1024 * MB) * 10) / 10) + ' GB';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function ago(t) {
    if (!t) return 'never';
    var d = Date.now() - t;
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.round(d / 60e3) + ' min ago';
    if (d < DAY) return Math.round(d / 3600e3) + ' h ago';
    if (d < 2 * DAY) return 'yesterday';
    if (d < 60 * DAY) return Math.round(d / DAY) + ' days ago';
    return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function pretty(slug) { return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function sum(list, key) { return list.reduce(function (a, x) { return a + (key ? x[key] || 0 : x || 0); }, 0); }
  function tier() {
    if (window.LE && LE.device && LE.device.tier) { try { return LE.device.tier(); } catch (e) {} }
    var mem = navigator.deviceMemory || 8;
    var cores = navigator.hardwareConcurrency || 8;
    if (mem <= 2 || (mem <= 3 && cores <= 4)) return 'older';
    if (Math.min(screen.width, screen.height) < 900) return 'modern';
    return 'desktop';
  }
  var bus = {};
  function on(name, fn) { (bus[name] = bus[name] || []).push(fn); return function () { bus[name] = (bus[name] || []).filter(function (f) { return f !== fn; }); }; }
  function emit(name, data) {
    (bus[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.warn(e); } });
    try { window.dispatchEvent(new CustomEvent('le-pwa:' + name, { detail: data })); } catch (e) {}
  }
  function toast(msg) {
    /* An open sheet sits in the top layer, above the shell's toast, so speak from inside it. */
    var host = document.querySelector('dialog.lp-sheet[open]');
    if (!host && window.IT && IT.say) { IT.say(msg, 3200); return; }
    host = host || document.body;
    var el = host.querySelector('.lp-toast') || host.appendChild(h('<div class="lp-toast" role="status" aria-live="polite"></div>'));
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }
  function need(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = BASE + src;
      s.onload = function () { if (ready()) resolve(); else reject(new Error('Could not load ' + src)); };
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function needProject() { return need('assets/js/le-project.js', function () { return !!(window.LE && LE.project && LE.project.gc); }); }
  function needZip() { return need('assets/js/le-engine.js', function () { return !!(window.LE && LE.zip); }); }
  function download(blob, name) {
    if (window.IT && IT.download) { IT.download(blob, name); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------- Platform and install ---------- */
  function platform() {
    var u = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|MicroMessenger|Pinterest|Line\/\d|GSA\//.test(u)) return 'in-app';
    if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(u) ? 'ios-other' : 'ios-safari';
    if (/Android/i.test(u)) return /Firefox/i.test(u) ? 'android-firefox' : /SamsungBrowser/.test(u) ? 'android-samsung' : 'android';
    if (/Firefox/i.test(u)) return 'desktop-firefox';
    if (/Macintosh/.test(u) && /Safari/.test(u) && !/Chrome|Chromium|Edg\//.test(u)) return 'mac-safari';
    return 'desktop';
  }
  function standalone() {
    try {
      if (window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen), (display-mode: window-controls-overlay)').matches) return true;
    } catch (e) {}
    return navigator.standalone === true;
  }
  /* ---------- Three apps from one site (docs/INSTALL.md) ----------
     "LocalEditor" (everything, scope /), "LocalEditor Design" (scope /studio/) and "LocalEditor PDF" (scope /pdf-studio/).
     Pages link the suite's manifest; choosing a single studio switches the link, and Chromium then offers a fresh
     install prompt for that app (checked in Chromium 153, docs/INSTALL.md). Paths are relative to the site root. */
  var APPS = {
    suite: { name: 'LocalEditor', short: 'LocalEditor', title: 'Everything', manifest: 'manifest.webmanifest', scope: '', start: '', about: 'The design studio, the PDF studio and every tool, in one app.' },
    design: { name: 'LocalEditor Design', short: 'LE Design', title: 'Design studio only', manifest: 'manifest-design.webmanifest', scope: 'studio/', start: 'studio/?app=design', about: 'Photos, layouts, collages and text. Opens straight into the design studio.' },
    pdf: { name: 'LocalEditor PDF', short: 'LE PDF', title: 'PDF studio only', manifest: 'manifest-pdf.webmanifest', scope: 'pdf-studio/', start: 'pdf-studio/?app=pdf', about: 'Sign, fill, organise and protect PDFs. Opens straight into the PDF studio.' }
  };
  var APP_IDS = ['suite', 'design', 'pdf'];
  function siteUrl(rel) { return new URL(BASE + (rel || ''), location.href); }
  function inScope(app, url) {
    var u = url ? new URL(url, location.href) : location;
    return u.pathname.indexOf(siteUrl(APPS[app].scope).pathname) === 0;
  }
  /* The single studio whose page this is (pre-selected in the chooser), else the suite. */
  function pageApp() { return inScope('pdf') ? 'pdf' : inScope('design') ? 'design' : 'suite'; }
  function manifestLink() {
    var l = document.querySelector('link[rel="manifest"]');
    if (!l) { l = document.createElement('link'); l.rel = 'manifest'; l.href = BASE + APPS.suite.manifest; document.head.appendChild(l); }
    return l;
  }
  function linkedApp() {
    var href = (document.querySelector('link[rel="manifest"]') || {}).href || '';
    var m = /manifest-(design|pdf)\.webmanifest/.exec(href);
    return m ? m[1] : 'suite';
  }
  var pageManifest = null;
  /* Point the page at one app's manifest. Safari reads it (and the home-screen title) when the person adds the page. */
  function linkManifest(app) {
    if (pageManifest == null) pageManifest = linkedApp();
    var l = manifestLink();
    var want = siteUrl(APPS[app].manifest).href;
    if (l.href !== want) { l.href = want; early.prompt = null; early.promptFor = null; }
    var t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!t) { t = document.createElement('meta'); t.name = 'apple-mobile-web-app-title'; document.head.appendChild(t); }
    t.setAttribute('content', APPS[app].short);
  }
  function restoreManifest() { if (pageManifest && linkedApp() !== pageManifest) linkManifest(pageManifest); }
  /* Which app this window is: the start page of each app carries ?app=, kept for the life of the window. */
  var WIN_KEY = 'le-pwa-window-app';
  function currentApp() {
    if (!standalone()) return null;
    var v = null;
    try { v = sessionStorage.getItem(WIN_KEY); } catch (e) {}
    return APPS[v] ? v : null;
  }
  function noteWindowApp() {
    if (!standalone()) return;
    var q = new URLSearchParams(location.search).get('app');
    var v = null;
    try { v = sessionStorage.getItem(WIN_KEY); } catch (e) {}
    if (APPS[q]) v = q;
    if (!APPS[v]) {
      /* No marker (opened from a link): the most specific installed app whose pages include this one. */
      var known = Object.keys(state().apps || {});
      v = ['pdf', 'design'].filter(function (a) { return known.indexOf(a) >= 0 && inScope(a); })[0] || 'suite';
    }
    try { sessionStorage.setItem(WIN_KEY, v); } catch (e) {}
    /* First launch of an app this browser did not see being installed (Safari's Add to Home Screen): remember it now. */
    if (!(state().apps || {})[v]) recordInstall(v, true);
  }
  /* The apps installed from this browser, as far as it can know: what it saw installed (appinstalled, or a launch), and the
     app this window is. A prompt the browser offers again for an app means that app was removed since. */
  function installedApps() {
    var s = state();
    var list = Object.keys(s.apps || {}).filter(function (a) { return APPS[a]; });
    if (!list.length && s.installedAt) list = ['suite']; /* installed before there were three apps */
    if (early.prompt && early.promptFor && !standalone()) list = list.filter(function (a) { return a !== early.promptFor; });
    var cur = currentApp();
    if (cur && list.indexOf(cur) < 0) list.push(cur);
    return list;
  }
  function isInstalled(app) {
    if (app) return installedApps().indexOf(app) >= 0;
    return standalone() || !!early.installed || installedApps().length > 0;
  }
  /* Nothing left to offer: this is an app window, or the whole suite is installed (it holds both studios). */
  function nothingToInstall() { return standalone() || installedApps().indexOf('suite') >= 0; }
  function installKind() { return nothingToInstall() ? 'installed' : early.prompt ? 'prompt' : platform(); }
  function canInstall() { var k = installKind(); return k !== 'installed' && k !== 'desktop-firefox'; }
  function refreshInstall() {
    var k = installKind();
    root.classList.toggle('le-pwa-installed', k === 'installed');
    root.classList.toggle('le-pwa-can-install', canInstall());
    root.classList.toggle('le-pwa-no-install', !canInstall());
    root.setAttribute('data-le-install-state', k === 'installed' ? 'installed' : k === 'prompt' ? 'prompt' : 'help');
    [].forEach.call(document.querySelectorAll('.install-btn'), function (b) { b.classList.toggle('show', canInstall()); });
  }
  var promptWaiters = [];
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    early.prompt = e;
    early.promptFor = linkedApp();
    early.seen = true;
    refreshInstall();
    emit('installable', { kind: 'prompt', app: early.promptFor });
    promptWaiters.splice(0).forEach(function (fn) { fn(); });
  });
  /* Resolves with a prompt for that app's manifest, or null when the browser offers none within ms. */
  function promptFor(app, ms) {
    if (early.prompt && early.promptFor === app) return Promise.resolve(early.prompt);
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms || 4000);
      (function wait() {
        promptWaiters.push(function () {
          if (done) return;
          if (early.promptFor === app) { done = true; clearTimeout(t); resolve(early.prompt); } else wait();
        });
      })();
    });
  }
  var pendingApp = null;
  function recordInstall(app, quiet) {
    app = APPS[app] ? app : 'suite';
    var s = state();
    var apps = s.apps || {};
    if (!apps[app]) apps[app] = Date.now();
    state({ apps: apps, installedAt: s.installedAt || Date.now() });
    /* What stays offline follows the installed app (LE.downloads keeps the choice where the worker can read it). */
    whenDownloads(function (D) { if (D.chooseApp) D.chooseApp(app); });
    refreshInstall();
    emit('installed', { app: app, quiet: !!quiet });
  }
  function whenDownloads(fn) {
    var D = window.LE && LE.downloads;
    if (D && D.__real) { fn(D); return; }
    window.addEventListener('le-downloads-ready', function go() { window.removeEventListener('le-downloads-ready', go); if (window.LE && LE.downloads) fn(LE.downloads); });
  }
  window.addEventListener('appinstalled', function () {
    var app = pendingApp || early.promptFor || linkedApp();
    early.installed = true;
    early.prompt = null;
    pendingApp = null;
    hideNotice('install');
    recordInstall(app);
    toast(APPS[app].name + ' is installed. Find it with your other apps.');
  });

  /* The Install entries (menus, the nudge) open the chooser. Installed already, or inside another app's viewer: as before. */
  function install(opts) {
    var k = installKind();
    if (k === 'installed') { toast((currentApp() ? APPS[currentApp()].name : 'LocalEditor') + ' is already installed on this device.'); return Promise.resolve('installed'); }
    if (k === 'in-app') return openInstallHelp('in-app').then(function () { return 'sheet'; });
    return openChooser(opts || {}).then(function () { return 'chooser'; });
  }
  /* Fires the browser's own install prompt for one app. Chromium needs a recent tap; if it has expired, one more tap does it. */
  function firePrompt(ev, app, note) {
    early.prompt = null;
    pendingApp = app;
    refreshInstall();
    return Promise.resolve().then(function () { return ev.prompt(); }).then(function () { return ev.userChoice; }).then(function (choice) {
      var outcome = choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
      if (outcome === 'accepted') recordInstall(app); else { pendingApp = null; snooze(); }
      hideNotice('install');
      refreshInstall();
      return outcome;
    }, function (err) {
      if (err && err.name === 'NotAllowedError') { early.prompt = ev; early.promptFor = app; if (note) note('Ready. Tap Install once more to finish.'); return 'tap-again'; }
      pendingApp = null;
      return 'failed';
    });
  }

  var ICON = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
    dock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M6 20h12"/><rect x="9" y="17" width="2" height="2"/><rect x="13" y="17" width="2" height="2"/></svg>',
    install: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    offline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    disk: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'
  };


  /* ---------- The install chooser: three choices, one sentence and a size each ----------
     Browsers with an install prompt (Chromium): the chosen app's manifest is linked, a fresh prompt arrives and is fired from
     the same tap. Browsers without one (Safari, Firefox for Android, Samsung Internet without a prompt): the steps for this
     browser, after linking the chosen manifest; a studio chosen on another page first opens that studio (?install=). */
  function promptCapable() {
    if (early.prompt || early.seen) return true;
    var u = navigator.userAgent || '';
    return /Chrome|Chromium|Edg\//.test(u) && !/iPad|iPhone|iPod|CriOS|EdgiOS/.test(u) && platform() !== 'in-app';
  }
  /* Arriving from the chooser on another page (?install=design): link that app here and finish with one more tap. */
  function installLanding() {
    var q = new URLSearchParams(location.search);
    var app = q.get('install');
    if (!APPS[app]) return;
    q.delete('install');
    var qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    if (standalone() || (app !== 'suite' && !inScope(app))) return;
    linkManifest(app);
    var name = APPS[app].name;
    openChooser({ app: app, quiet: true, note: promptCapable() ? 'Tap Install to add ' + name + '.' : '' });
  }
  /* In a studio installed on its own, a link to the rest of LocalEditor opens outside this app's window: in the whole
     LocalEditor or LocalEditor PDF when they are installed (Chromium sends new windows to the app that owns the page),
     otherwise in the browser. Offline, a page that is not kept here says so instead of opening an empty window. */
  function crossLinks() {
    document.addEventListener('click', function (e) {
      var cur = currentApp();
      if (!cur || cur === 'suite' || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      var u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (x) { return; }
      if (u.origin !== location.origin || inScope(cur, u.href) || /^\/(sw\.js|__share)/.test(u.pathname)) return;
      e.preventDefault();
      var open = function () { var w = window.open(u.href, '_blank'); if (w) { try { w.opener = null; } catch (x) {} } else location.href = u.href; };
      if (navigator.onLine !== false || !hasCaches()) { open(); return; }
      caches.match(u.href, { ignoreSearch: true }).then(function (hit) {
        if (hit) { open(); return; }
        var what = inScope('pdf', u.href) ? 'The PDF studio' : inScope('design', u.href) ? 'The design studio' : 'That page';
        showNotice('offline', {
          icon: ICON.offline, title: what + ' is not kept offline here',
          text: 'Connect to the internet to open it. To keep it offline, add it in Storage, under Downloads for offline use.',
          actions: [{ label: 'Storage', run: function () { openStorage(); } }], ms: 9000
        });
      });
    }, true);
  }

  /* ---------- Notices (one at a time, never over a dialog) ---------- */
  var notice = null;
  var PRIORITY = { quota: 4, update: 3, updated: 3, offline: 2, install: 1 };
  function showNotice(id, o) {
    if (notice && notice.id !== id && PRIORITY[notice.id] > PRIORITY[id]) return null;
    hideNotice();
    var el = h('<section class="lp-notice lp-notice-' + id + '" role="status" aria-live="polite">' +
      '<span class="lp-notice-ic">' + (o.icon || ICON.spark) + '</span>' +
      '<div class="lp-notice-tx"><b>' + esc(o.title) + '</b>' + (o.text ? '<span>' + esc(o.text) + '</span>' : '') + '</div>' +
      '<div class="lp-notice-ac"></div><button type="button" class="lp-x" aria-label="Dismiss">' + ICON.close + '</button></section>');
    var ac = el.querySelector('.lp-notice-ac');
    (o.actions || []).forEach(function (a, i) {
      var b = h('<button type="button" class="lp-btn lp-btn-sm' + (i === 0 ? ' lp-primary' : '') + '">' + esc(a.label) + '</button>');
      b.onclick = function () { if (a.keep !== true) hideNotice(id); a.run(); };
      ac.appendChild(b);
    });
    el.querySelector('.lp-x').onclick = function () { hideNotice(id); if (o.dismiss) o.dismiss(); };
    document.body.appendChild(el);
    notice = { id: id, el: el };
    if (o.ms) setTimeout(function () { hideNotice(id); }, o.ms);
    requestAnimationFrame(function () { el.classList.add('show'); });
    return el;
  }
  function hideNotice(id) {
    if (!notice || (id && notice.id !== id)) return;
    var el = notice.el;
    notice = null;
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 220);
  }

  /* ---------- "Never nag": offer to install only after real use, and back off after each "Not now". ---------- */
  var usedHere = false;
  function markUsed() {
    if (usedHere) return;
    usedHere = true;
    var s = state();
    state({ uses: (s.uses || 0) + 1, lastUse: Date.now() });
    setTimeout(maybeNudge, 5000);
  }
  function snooze() {
    var s = state();
    state({ snoozedAt: Date.now(), snoozes: (s.snoozes || 0) + 1 });
  }
  function nudgeAllowed() {
    if (!canInstall() || installKind() === 'in-app' || installedApps().length) return false;
    var s = state();
    if ((s.uses || 0) < 2) return false;
    var n = s.snoozes || 0;
    if (n >= 3) return false;
    var wait = n === 0 ? 0 : n === 1 ? 14 * DAY : 60 * DAY;
    if (s.snoozedAt && Date.now() - s.snoozedAt < wait) return false;
    if (s.nudgedAt && Date.now() - s.nudgedAt < DAY) return false;
    return true;
  }
  function maybeNudge() {
    if (!nudgeAllowed() || document.querySelector('dialog[open]')) return;
    state({ nudgedAt: Date.now() });
    var prompt = installKind() === 'prompt';
    showNotice('install', {
      icon: ICON.install,
      title: 'Keep LocalEditor one tap away',
      text: 'Install it to open like an app and work offline. Free, no store, nothing uploaded.',
      actions: [{ label: prompt ? 'Install' : 'Show me how', run: install }, { label: 'Not now', run: snooze }],
      dismiss: snooze
    });
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.type === 'file' && t.files && t.files.length) markUsed();
  }, true);
  document.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) markUsed(); }, true);

  /* ---------- Buttons from the shell: [data-le-install], [data-le-storage], and the old controls ---------- */
  window.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    /* The shell no longer handles these; let the click bubble so a drawer can close itself. */
    var inst = t.closest('[data-le-install], .le-install, .install-btn');
    if (inst) { e.preventDefault(); install(); return; }
    var st = t.closest('[data-le-storage]');
    if (st) { e.preventDefault(); openStorage(); }
  }, true);

  /* ---------- Theme colour for the browser bar, light and dark ---------- */
  function syncThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta || meta.hasAttribute('data-le-fixed')) return;
    var dark = root.getAttribute('data-theme') === 'dark';
    var c = '';
    try { c = getComputedStyle(root).getPropertyValue('--bg').trim(); } catch (e) {}
    meta.setAttribute('content', c || (dark ? '#141414' : '#FAFAFA'));
  }
  if (window.MutationObserver) new MutationObserver(syncThemeColor).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- Editors: busy state, saving before an update, memory guard ---------- */
  var editors = [];
  function registerEditor(ed) {
    ed = ed || {};
    editors.push(ed);
    return function () { editors = editors.filter(function (x) { return x !== ed; }); };
  }
  function call(ed, fn) { try { return ed[fn] ? ed[fn]() : undefined; } catch (e) { console.warn(e); return undefined; } }
  function busy() { return usedHere || editors.some(function (ed) { return !!call(ed, 'isBusy'); }); }
  function saveEditors() {
    return Promise.all(editors.map(function (ed) { return Promise.resolve(call(ed, 'save')).catch(function () {}); }));
  }
  var hiddenAt = 0;
  var released = false;
  var guardTimer = 0;
  function guardDelay() { var t = tier(); return t === 'older' ? 20e3 : t === 'modern' ? 45e3 : 120e3; }
  function releaseMemory() {
    if (released) return;
    released = true;
    editors.forEach(function (ed) { call(ed, 'release'); });
    emit('memory', { released: true });
  }
  function restoreMemory() {
    if (!released) return;
    released = false;
    editors.forEach(function (ed) { call(ed, 'restore'); });
    emit('memory', { released: false });
  }
  function memory() {
    var pm = performance && performance.memory;
    return {
      tier: tier(),
      deviceMemoryGB: navigator.deviceMemory || null,
      cores: navigator.hardwareConcurrency || null,
      heapUsed: pm ? pm.usedJSHeapSize : null,
      heapLimit: pm ? pm.jsHeapSizeLimit : null,
      released: released,
      guard: limits().memoryGuard,
      editors: editors.map(function (ed) { return { name: ed.name || 'Editor', stats: call(ed, 'stats') || null }; })
    };
  }

  /* ---------- Updates ---------- */
  var reg = null;
  var waiting = null;
  var applying = false;
  var reloadOnShow = false;
  var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  var updateSnoozed = false;
  function sw() { return navigator.serviceWorker || null; }
  function ask(worker, msg, ms) {
    return new Promise(function (resolve) {
      if (!worker) { resolve(null); return; }
      var ch = new MessageChannel();
      var t = setTimeout(function () { resolve(null); }, ms || 1500);
      ch.port1.onmessage = function (m) { clearTimeout(t); resolve(m.data); };
      try { worker.postMessage(msg, [ch.port2]); } catch (e) { clearTimeout(t); resolve(null); }
    });
  }
  function watch(r) {
    if (!r || reg === r) return;
    reg = r;
    if (r.waiting && sw().controller) onWaiting(r.waiting);
    r.addEventListener('updatefound', function () {
      var w = r.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        if (w.state === 'installed' && sw().controller) onWaiting(w);
      });
    });
    sendLimits();
  }
  function onWaiting(w) {
    waiting = w;
    root.classList.add('le-pwa-update');
    emit('update-ready', {});
    if (!updateSnoozed) {
      showNotice('update', {
        icon: ICON.spark,
        title: 'A new version of LocalEditor is ready',
        text: busy() ? 'Your work is saved first, then the page reloads.' : 'It takes a second.',
        actions: [{ label: 'Update now', run: update }, { label: 'Later', run: function () { updateSnoozed = true; } }],
        dismiss: function () { updateSnoozed = true; }
      });
    }
    if (document.hidden && !busy()) applyIfIdle();
  }
  function applyIfIdle() {
    if (!waiting || applying) return Promise.resolve(false);
    return ask(waiting, { type: 'le-apply-if-idle' }, 3000).then(function (r) { return !!(r && r.applied); });
  }
  function update() {
    if (!waiting) {
      return checkForUpdate().then(function (found) {
        if (!found) toast('LocalEditor is up to date.');
        return false;
      });
    }
    applying = true;
    showNotice('updated', { icon: ICON.spark, title: 'Updating…', text: 'Saving your work first.' });
    return saveEditors().then(function () {
      waiting.postMessage({ type: 'le-skip-waiting' });
      setTimeout(function () { location.reload(); }, 5000);
      return true;
    });
  }
  function checkForUpdate() {
    if (!reg) return Promise.resolve(false);
    state({ checkedAt: Date.now() });
    return reg.update().then(function () { return !!(reg.installing || reg.waiting); }, function () { return false; });
  }
  function onControllerChange() {
    if (applying) { location.reload(); return; }
    if (!hadController) { hadController = true; return; }
    waiting = null;
    root.classList.remove('le-pwa-update');
    hideNotice('update');
    if (busy()) {
      showNotice('updated', {
        icon: ICON.spark, title: 'LocalEditor was updated in another tab',
        text: 'Your work here is safe. Reload when you are ready.',
        actions: [{ label: 'Save and reload', run: function () { saveEditors().then(function () { location.reload(); }); } }, { label: 'Later', run: function () {} }]
      });
    } else if (document.hidden) reloadOnShow = true;
    else reloadOnShow = true;
  }
  function onMessage(e) {
    var d = e.data || {};
    if (d.type === 'le-busy?') {
      if (e.ports && e.ports[0]) e.ports[0].postMessage({ busy: busy() });
    } else if (d.type === 'le-installed' && d.first) {
      offlineReady(d.count, d.failed && d.failed.length);
    }
  }
  function offlineReady(count, failed) {
    if (state().offlineAt) return;
    state({ offlineAt: Date.now() });
    emit('offline-ready', { count: count || 0, failed: failed || 0 });
    appFilesSize().then(function (bytes) {
      showNotice('offline', {
        icon: ICON.offline,
        title: 'LocalEditor now works offline',
        text: (bytes ? fmt(bytes) + ' of app files are saved on this device.' : 'The app is saved on this device.') + (failed ? ' A few extras will download when you use them.' : ''),
        actions: [{ label: 'Manage storage', run: openStorage }],
        ms: 9000
      });
    });
  }
  function swInit() {
    var c = sw();
    if (!c) return;
    c.addEventListener('message', onMessage);
    c.addEventListener('controllerchange', onControllerChange);
    if (c.getRegistration) c.getRegistration().then(function (r) { if (r) watch(r); }).catch(function () {});
    c.ready.then(function (r) {
      watch(r);
      if (!state().offlineAt) offlineReady(0, 0);
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = Date.now();
      clearTimeout(guardTimer);
      if (editors.length && limits().memoryGuard) guardTimer = setTimeout(releaseMemory, guardDelay());
      if (waiting && !busy()) applyIfIdle();
      return;
    }
    clearTimeout(guardTimer);
    restoreMemory();
    if (reloadOnShow && !busy()) { location.reload(); return; }
    if (reg && Date.now() - (state().checkedAt || 0) > 3600e3) checkForUpdate();
  });
  window.addEventListener('pagehide', function () { if (waiting && !busy()) applyIfIdle(); });

  /* ---------- Limits ---------- */
  function defaults() {
    var t = tier();
    return {
      budgetMB: t === 'older' ? 150 : t === 'modern' ? 300 : 800,
      versions: t === 'older' ? 10 : t === 'modern' ? 20 : 30,
      packDays: t === 'older' ? 30 : 60,
      autoClean: true,
      memoryGuard: true
    };
  }
  function limits() {
    var d = defaults();
    var s = lsGet(KEY.limits, {}) || {};
    var out = {};
    Object.keys(d).forEach(function (k) { out[k] = s[k] == null ? d[k] : s[k]; });
    return out;
  }
  function setLimits(patch) {
    var s = lsGet(KEY.limits, {}) || {};
    patch = patch || {};
    if (patch.budgetMB != null) s.budgetMB = Math.max(25, Math.min(20000, Math.round(Number(patch.budgetMB) || 0)));
    if (patch.versions != null) s.versions = Math.max(1, Math.min(200, Math.round(Number(patch.versions) || 0)));
    if (patch.packDays != null) s.packDays = Math.max(0, Math.min(3650, Math.round(Number(patch.packDays) || 0)));
    if (patch.autoClean != null) s.autoClean = !!patch.autoClean;
    if (patch.memoryGuard != null) s.memoryGuard = !!patch.memoryGuard;
    lsSet(KEY.limits, s);
    sendLimits();
    syncKeepCount();
    emit('limits', limits());
    return limits();
  }
  /* The "versions kept" setting is the limit LE.project prunes to (not only what trimVersions enforces later). */
  function syncKeepCount() {
    try { if (window.LE && LE.project && typeof LE.project.setKeepCount === 'function') LE.project.setKeepCount(limits().versions); } catch (e) {}
  }
  function sendLimits() {
    var c = sw();
    var target = (reg && reg.active) || (c && c.controller);
    if (!target) return;
    var cap = limits().budgetMB * MB;
    var caps = {};
    DOWNLOADS.forEach(function (n) { caps[n] = cap; });
    try { target.postMessage({ type: 'le-limits', caps: caps }); } catch (e) {}
  }

  /* ---------- Cache Storage readers ---------- */
  function hasCaches() { return typeof caches !== 'undefined'; }
  function entrySize(res) {
    if (!res) return Promise.resolve(0);
    var n = Number(res.headers.get('x-le-bytes')) || Number(res.headers.get('content-length'));
    if (n) return Promise.resolve(n);
    return res.blob().then(function (b) { return b.size; }, function () { return 0; });
  }
  function entryTime(res) {
    return Number(res.headers.get('x-le-at')) || Date.parse(res.headers.get('date') || '') || 0;
  }
  /* Every entry of one cache: { req, url, path, bytes, at } in insertion order (oldest first). */
  function entries(name) {
    if (!hasCaches()) return Promise.resolve([]);
    return caches.has(name).then(function (ok) {
      if (!ok) return [];
      return caches.open(name).then(function (c) {
        return c.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) {
            return c.match(k).then(function (res) {
              return entrySize(res).then(function (n) {
                var u = new URL(k.url);
                return { cache: name, req: k, url: k.url, path: u.pathname, bytes: n, at: res ? entryTime(res) : 0, model: res ? res.headers.get('x-le-model') : null };
              });
            });
          }));
        });
      });
    }).catch(function () { return []; });
  }
  function appCacheNames() {
    if (!hasCaches()) return Promise.resolve([]);
    return caches.keys().then(function (ks) { return ks.filter(function (k) { return k.indexOf(CACHES.app) === 0 || /^it-\d+$/.test(k); }); });
  }
  function appFilesSize() {
    return versions().then(function (v) { return v.current ? entries(v.current) : []; }).then(function (list) { return sum(list, 'bytes'); });
  }
  /* The active and waiting app versions, so cleanup never touches either. */
  function versions() {
    var c = sw();
    var out = { current: null, waiting: null, version: null };
    var active = c && c.controller;
    return Promise.all([ask(active, { type: 'le-version' }, 1200), ask(waiting || (reg && reg.waiting), { type: 'le-version' }, 1200)]).then(function (r) {
      if (r[0]) { out.current = r[0].cache; out.version = r[0].version; }
      if (r[1]) out.waiting = r[1].cache;
      if (out.current) return out;
      return appCacheNames().then(function (names) { names.sort(); out.current = names[names.length - 1] || null; return out; });
    });
  }
  function removeEntries(list) {
    var by = {};
    list.forEach(function (e) { (by[e.cache] = by[e.cache] || []).push(e); });
    return Promise.all(Object.keys(by).map(function (name) {
      return caches.open(name).then(function (c) { return Promise.all(by[name].map(function (e) { return c.delete(e.req); })); });
    })).then(function () { return sum(list, 'bytes'); });
  }

  /* Icon-pack use is tracked here because le-assets.js reads packs straight from the cache. */
  function notePack(id) {
    if (!id) return;
    var m = lsGet(KEY.packs, {}) || {};
    if (m[id] && Date.now() - m[id] < 60e3) return;
    m[id] = Date.now();
    lsSet(KEY.packs, m);
  }
  function wrapAssets() {
    var A = window.LE && LE.assets;
    if (!A || A.__lePwa) return;
    A.__lePwa = true;
    ['loadStyle', 'saveStyleOffline'].forEach(function (fn) {
      var orig = A[fn];
      if (typeof orig !== 'function') return;
      A[fn] = function (id) { if (id !== 'all') notePack(id); return orig.apply(this, arguments); };
    });
  }
  /* Model files carry the id of the model in x-le-model; the shared AI engine (ONNX Runtime) is one entry. */
  function modelId(x) {
    if (x.model) return x.model;
    if (/\/assets\/vendor\/ort/.test(x.path)) return 'ai-engine';
    var m = /\/assets\/models\/(?:local\/)?([^/]+)(\/|$)/.exec(x.path);
    return m ? m[1].replace(/\.(onnx|ort|bin|json|wasm|tflite)$/i, '') : x.path.split('/').pop();
  }
  var modelInfo = {
    'ai-engine': { name: 'AI engine', about: 'Shared by every on-device AI feature' },
    'u2netp': { name: 'Background remover (fast)', about: 'Cuts people and objects out of photos' }
  };
  function describeModel(id, info) { modelInfo[id] = info || {}; }

  /* ---------- The storage manager and the install chooser: le-pwa-more.js, loaded on first use (docs/LOADING.md) ---------- */
  var morep = null;
  function more() {
    if (!morep) morep = need('assets/js/le-pwa-more.js', function () { return !!(window.LEPwa && window.LEPwa._more); }).then(function () { return window.LEPwa._more; }, function (err) { morep = null; throw err; });
    return morep;
  }
  function later(name) { return function () { var a = arguments; return more().then(function (m) { return m[name].apply(null, a); }); }; }
  /* Windows that open: when the file cannot be fetched they say so and answer null (nothing opened). */
  function opener(name) { var f = later(name); return function () { return f.apply(null, arguments).catch(function (err) { console.warn(err); toast('That did not open. Check your connection and try again.'); return null; }); }; }
  var openInstallHelp = opener('openInstallHelp'), openChooser = opener('openChooser'), openStorage = opener('openStorage');
  var report = later('report'), plan = later('plan'), freeUpSpace = later('freeUpSpace'), clearCategory = later('clearCategory'), trimVersions = later('trimVersions'),
    enforceLimits = later('enforceLimits'), backup = later('backup'), eraseEverything = later('eraseEverything'), repairAppFiles = later('repairAppFiles');

  /* ---------- Low space ---------- */
  function isQuota(err) {
    if (!err) return false;
    var name = err.name || (err.target && err.target.error && err.target.error.name) || '';
    return name === 'QuotaExceededError' || err.code === 22 || err.code === 1014 || /quota|storage is full|not enough space|exceeded the storage/i.test(String(err.message || ''));
  }
  var lastQuota = 0;
  function reportQuotaError(err) {
    if (!isQuota(err)) return false;
    if (Date.now() - lastQuota < 60e3) return true;
    lastQuota = Date.now();
    lowSpace(true);
    return true;
  }
  function lowSpace(failed) {
    emit('low-space', { failed: !!failed });
    showNotice('quota', {
      icon: ICON.warn,
      title: failed ? 'Your device is out of space for LocalEditor' : 'Space for LocalEditor is running low',
      text: failed ? 'The last change could not be saved. Free up space, then try again.' : 'Free up space now so your next save does not fail.',
      actions: [{ label: 'Free up space', run: function () { openStorage({ free: true }); } }, { label: 'See what is stored', run: openStorage }]
    });
  }
  function checkSpace() {
    if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
    return navigator.storage.estimate().then(function (e) {
      var ratio = e.quota ? e.usage / e.quota : 0;
      if (ratio > 0.8 && Date.now() - (state().lowAt || 0) > DAY) { state({ lowAt: Date.now() }); lowSpace(false); }
      return ratio;
    }).catch(function () { return null; });
  }
  window.addEventListener('unhandledrejection', function (e) { if (isQuota(e.reason)) reportQuotaError(e.reason); });

  /* ---------- Keep my work safe ---------- */
  function persisted() { return navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(null); }
  function persist() {
    if (!(navigator.storage && navigator.storage.persist)) return Promise.resolve(null);
    return navigator.storage.persist().then(function (ok) { state({ persistAsked: Date.now() }); emit('storage-change', { category: 'persist' }); return ok; });
  }

  /* ---------- Files opened from the system or shared to the app ---------- */
  var pending = [];
  var launchCbs = [];
  function deliver(files, source) {
    files = (files || []).filter(Boolean);
    if (!files.length) return;
    markUsed();
    if (launchCbs.length) launchCbs.forEach(function (cb) { try { cb(files, { source: source }); } catch (e) { console.warn(e); } });
    else pending.push({ files: files, source: source });
  }
  function onLaunchFiles(cb) {
    launchCbs.push(cb);
    var q = pending.splice(0);
    q.forEach(function (x) { try { cb(x.files, { source: x.source }); } catch (e) { console.warn(e); } });
    return function () { launchCbs = launchCbs.filter(function (f) { return f !== cb; }); };
  }
  if ('launchQueue' in window && window.launchQueue && launchQueue.setConsumer) {
    launchQueue.setConsumer(function (params) {
      if (!params || !params.files || !params.files.length) return;
      Promise.all(params.files.map(function (fh) { return fh.getFile(); })).then(function (files) { deliver(files, 'launch'); }).catch(function () { toast('That file could not be opened.'); });
    });
  }
  function pickUpShared() {
    var q = new URLSearchParams(location.search);
    var id = q.get('shared');
    if (!id) return;
    q.delete('shared');
    var qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    if (id === 'failed') { toast('Those files could not be received. Try sharing them again.'); return; }
    if (!hasCaches()) return;
    caches.open(CACHES.share).then(function (c) {
      return c.keys().then(function (keys) {
        var mine = keys.filter(function (k) { return k.url.indexOf('/__share/' + id + '/') >= 0; });
        return Promise.all(mine.map(function (k) {
          return c.match(k).then(function (res) {
            return res.blob().then(function (b) {
              var name = 'shared';
              try { name = decodeURIComponent(res.headers.get('x-le-name') || 'shared'); } catch (e) {}
              return c.delete(k).then(function () { return new File([b], name, { type: b.type || res.headers.get('content-type') || '' }); });
            });
          });
        }));
      });
    }).then(function (files) {
      if (files.length) deliver(files, 'share'); else toast('The shared files were already opened.');
    }).catch(function () {});
  }

  /* ---------- Boot ---------- */
  function idle(fn, ms) { setTimeout(function () { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 4000 }); else fn(); }, ms || 0); }
  function deepLink() {
    if (/[?&]storage=1(&|$)/.test(location.search) || location.hash === '#storage') openStorage();
  }
  /* Files opened with LocalEditor PDF (.pdf, .lepdfworkflow) reach the PDF studio through its public PS.addFiles. */
  function pdfLaunchBridge() {
    if (!inScope('pdf')) return;
    var hook = function () {
      var PS = window.PS;
      if (!PS || !PS.addFiles || hook.done) return;
      hook.done = true;
      onLaunchFiles(function (files) {
        var flows = files.filter(function (f) { return /\.lepdfworkflow$/i.test(f.name); });
        var docs = files.filter(function (f) { return flows.indexOf(f) < 0; });
        if (docs.length) PS.addFiles(docs);
        if (flows.length && PS.office && PS.office.open && PS.pickFiles) {
          /* Office kit may still be downloading (docs/LOADING.md): open() returns a promise then. */
          Promise.resolve(PS.office.open('workflows')).then(function () { setTimeout(function () {
            var b = document.querySelector('[data-po="wf-import"]');
            if (!b) return;
            var orig = PS.pickFiles;
            PS.pickFiles = function () { PS.pickFiles = orig; return Promise.resolve([flows[0]]); };
            b.click();
          }, 400); });
        }
      });
    };
    if (document.readyState === 'complete') hook(); else window.addEventListener('load', hook);
  }
  function boot() {
    if (early.prompt && !early.promptFor) early.promptFor = linkedApp();
    noteWindowApp();
    if (early.installed && !installedApps().length) recordInstall(linkedApp(), true);
    syncKeepCount();
    refreshInstall();
    syncThemeColor();
    wrapAssets();
    swInit();
    pickUpShared();
    deepLink();
    installLanding();
    crossLinks();
    pdfLaunchBridge();
    window.addEventListener('hashchange', function () { if (location.hash === '#storage') openStorage(); });
    if (/[?&]erased=1/.test(location.search)) {
      history.replaceState(null, '', location.pathname);
      /* A delete blocked by a tab that still held a database open is dropped on unload; finish it now. */
      if (window.indexedDB) DATABASES.forEach(function (n) { try { indexedDB.deleteDatabase(n); } catch (e) {} });
      toast('Everything was erased from this device.');
    }
    idle(function () {
      wrapAssets();
      checkSpace();
      var L = limits();
      if (L.autoClean && Date.now() - (state().enforcedAt || 0) > 6 * 3600e3) {
        var withVersions = !!(window.LE && LE.project);
        enforceLimits({ versions: withVersions });
      }
    }, 3000);
  }
  window.addEventListener('load', wrapAssets);

  window.LEPwa = {
    _core: {
      BASE: BASE, MB: MB, DAY: DAY, CACHES: CACHES, DOWNLOADS: DOWNLOADS, KEY: KEY, DATABASES: DATABASES, lsGet: lsGet, lsSet: lsSet, state: state,
      fmt: fmt, esc: esc, h: h, ago: ago, pretty: pretty, plural: plural, sum: sum, on: on, emit: emit, toast: toast, needProject: needProject,
      needZip: needZip, download: download, platform: platform, standalone: standalone, APPS: APPS, APP_IDS: APP_IDS, inScope: inScope,
      pageApp: pageApp, linkManifest: linkManifest, restoreManifest: restoreManifest, installedApps: installedApps, installKind: installKind,
      canInstall: canInstall, promptFor: promptFor, whenDownloads: whenDownloads, install: install, firePrompt: firePrompt, ICON: ICON,
      promptCapable: promptCapable, snooze: snooze, call: call, memory: memory, sw: sw, ask: ask, limits: limits, setLimits: setLimits,
      hasCaches: hasCaches, entries: entries, appCacheNames: appCacheNames, versions: versions, removeEntries: removeEntries, modelId: modelId,
      modelInfo: modelInfo, persisted: persisted, persist: persist,
      editors: function () { return editors; }
    },
    caches: CACHES,
    /* install */
    install: install, canInstall: canInstall, isInstalled: isInstalled, platform: platform, installKind: installKind, openInstallHelp: openInstallHelp, markUsed: markUsed,
    /* three apps (docs/INSTALL.md) */
    apps: APPS, openChooser: openChooser, installedApps: installedApps, currentApp: currentApp, pageApp: pageApp, linkManifest: linkManifest, linkedApp: linkedApp,
    /* updates */
    update: update, checkForUpdate: checkForUpdate, updateReady: function () { return !!waiting; }, versions: versions,
    /* storage */
    openStorage: openStorage, closeStorage: function () { if (window.LEPwa._more) window.LEPwa._more.closeStorage(); }, report: report, plan: plan, freeUpSpace: freeUpSpace,
    clearCategory: clearCategory, trimVersions: trimVersions, limits: limits, setLimits: setLimits, enforceLimits: enforceLimits,
    persist: persist, persisted: persisted, backup: backup, eraseEverything: eraseEverything, reportQuotaError: reportQuotaError, isQuotaError: isQuota,
    describeModel: describeModel, repairAppFiles: repairAppFiles,
    /* editors and files */
    registerEditor: registerEditor, onLaunchFiles: onLaunchFiles, memory: memory, releaseMemory: releaseMemory, restoreMemory: restoreMemory, busy: busy,
    on: on
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  try { window.dispatchEvent(new CustomEvent('le-pwa-ready')); } catch (e) {}
})();
