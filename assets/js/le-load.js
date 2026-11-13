/* LocalEditor: deferred modules (LE.modules). What loads when, the options and how to add a module: docs/LOADING.md. */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  if (LE.modules) return;
  /* Read at call time: le-studio-panels.js starts a fresh LEStudioPanels object. */
  function Ps() { return (window.LEStudioPanels = window.LEStudioPanels || {}); }
  function hooks() { var P = Ps(); return (P._hooks = P._hooks || {}); }
  var mods = [];
  var byId = {};
  var chain = Promise.resolve();
  var ready = { fired: false, arg: undefined, at: 0 };
  var warm = { started: false, done: false };
  var listeners = [];

  function emit(id, state, err) {
    var d = { id: id, state: state, error: err ? String(err.message || err) : null };
    listeners.slice().forEach(function (fn) { try { fn(d); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('le-load', { detail: d })); } catch (e) {}
  }
  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-le-deferred', '1');
      s.onload = function () { resolve(); };
      /* A failed tag is removed, so the next try asks the network again instead of reusing the error. */
      s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); reject(new Error('Could not load ' + src)); };
      document.body.appendChild(s);
    });
  }
  function style(href) {
    var have = document.querySelector('link[data-le-css="' + href.replace(/"/g, '') + '"]');
    if (have && have.getAttribute('data-le-ok') === '1') return Promise.resolve();
    if (have && have.parentNode) have.parentNode.removeChild(have);
    return new Promise(function (resolve, reject) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.setAttribute('data-le-css', href);
      l.onload = function () { l.setAttribute('data-le-ok', '1'); resolve(); };
      l.onerror = function () { if (l.parentNode) l.parentNode.removeChild(l); reject(new Error('Could not load ' + href)); };
      document.head.appendChild(l);
    });
  }
  function counts() { var H = hooks(), o = {}; Object.keys(H).forEach(function (k) { o[k] = (H[k] || []).length; }); return o; }
  function ctx() { var c = window.LEStudio; return c && c.scene ? c : null; }
  function list(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
  function runNew(name, before, args) {
    (hooks()[name] || []).slice(before[name] || 0).forEach(function (fn) { try { fn.apply(null, args); } catch (e) { console.error(e); } });
  }

  /* Loads one module and its deps. Files run in the order they were asked for (one chain), so a dependency always runs first. */
  function need(id) {
    var m = byId[id];
    if (!m) return Promise.reject(new Error('Unknown module ' + id));
    if (m.p) return m.p;
    var deps = m.deps.map(function (d) { return need(d); });
    m.state = 'loading';
    m.tries = (m.tries || 0) + 1;
    emit(m.id, 'loading');
    var p = Promise.all(deps).then(function () {
      return (chain = chain.catch(function () {}).then(function () {
        if (m.loaded) return;
        var before = counts();
        var t0 = Date.now();
        return (m.css ? style(m.css) : Promise.resolve()).then(function () { return script(m.src); }).then(function () {
          m.loaded = true;
          m.state = 'loaded';
          m.ms = Date.now() - t0;
          var c = ctx();
          if (c) {
            /* The studio already fired 'init' (and maybe 'ready'): run the hooks this module added, once. */
            runNew('init', before, [c]);
            if (ready.fired) runNew('ready', before, [c, ready.arg]);
            (m.replay || []).forEach(function (name) {
              var q = (m.buffered && m.buffered[name]) || [];
              q.forEach(function (args) { runNew(name, before, [c].concat(args)); });
            });
            if (c.renderRail) try { c.renderRail(); } catch (e) {}
            if (m.retool && c.renderToolbar) try { c.renderToolbar(); } catch (e) {}
            var open = c.S && c.S.panel;
            if (open && (m.panels[open] || m.rerender.indexOf(open) >= 0 || m.wrap[open]) && c.renderPanel) try { c.renderPanel(true); } catch (e) { console.error(e); }
          }
          m.buffered = null;
          if (typeof m.after === 'function') try { m.after(c); } catch (e) { console.error(e); }
          emit(m.id, 'loaded');
        });
      }));
    });
    m.p = p;
    p.catch(function (err) {
      console.warn(err && err.message ? err.message : err);
      /* Never cache a failure: the next need() (a retry, or the next tap) tries again. */
      m.p = null;
      m.state = 'error';
      m.error = err;
      emit(m.id, 'error', err);
    });
    return p;
  }
  /* Everything a document (a project with pages, or one page) needs before it is drawn: modules whose doc() test says so. */
  function forDoc(x) {
    if (!x) return Promise.resolve([]);
    var pages = Array.isArray(x.pages) ? x.pages : [x];
    var ids = mods.filter(function (m) {
      if (m.loaded || typeof m.doc !== 'function') return false;
      try { return !!m.doc(pages, x); } catch (e) { return false; }
    }).map(function (m) { return m.id; });
    if (!ids.length) return Promise.resolve([]);
    /* A document still opens when a module cannot load (offline and not kept): it draws, and the feature asks again on use. */
    return Promise.all(ids.map(function (id) { return need(id).catch(function () {}); })).then(function () { return ids; });
  }

  /* ---------- Placeholders: a panel frame at once, a skeleton, then the real panel; plain words and Retry on failure ---------- */
  function skeleton(body, label) {
    var el = document.createElement('div');
    el.className = 'le-load-wait';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = '<span class="skel skel-row"></span><span class="skel skel-cards"></span><p class="sx-note le-load-msg">Opening…</p>';
    body.appendChild(el);
    var slow = setTimeout(function () { var p = el.querySelector('.le-load-msg'); if (p && el.isConnected) p.textContent = 'Downloading ' + (label || 'this tool') + '…'; }, 800);
    return { el: el, done: function () { clearTimeout(slow); if (el.parentNode) el.parentNode.removeChild(el); } };
  }
  function failed(c, body, m, retry) {
    var box = document.createElement('div');
    box.className = 'le-load-error';
    box.setAttribute('role', 'alert');
    var offline = navigator.onLine === false;
    var empty = c && c.ui && c.ui.empty ? c.ui.empty('This could not open', offline ? 'You are offline and this part is not kept on this device yet. Connect and try again. Your design is safe.' : 'It did not download. Check your connection and try again. Your design is safe.') : null;
    if (empty) box.appendChild(empty);
    else box.innerHTML = '<p class="sx-note">This could not open. Check your connection and try again.</p>';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost btn-sm le-load-retry';
    b.textContent = 'Try again';
    b.onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); retry(); };
    box.appendChild(b);
    body.appendChild(box);
  }
  function placeholder(m, id, title) {
    var P = Ps(), base = P[id];
    var spec = {
      title: title || (base && base.title) || id, eyebrow: (base && base.eyebrow) || 'Studio', __lePlaceholder: m.id,
      rail: base && base.rail, sheet: base && base.sheet,
      render: function (c, body, o) {
        var q = m.queue;
        var stub = null, queued = [];
        if (q && c.S) { stub = function () { queued.push(arguments); }; c.S[q] = stub; }
        if (m.loaded && Ps()[id] === spec && !base) { body.appendChild(Object.assign(document.createElement('p'), { className: 'sx-note', textContent: 'This panel is not available here.' })); return; }
        var go = function () {
          var sk = skeleton(body, m.label || spec.title);
          need(m.id).then(function () {
            sk.done();
            if (Ps()[id] === spec) Ps()[id] = base || spec;
            if (c.S && c.S.panel === id) c.renderPanel();
            if (stub && c.S[q] && c.S[q] !== stub) queued.forEach(function (a) { c.S[q].apply(null, a); });
          }, function () {
            sk.done();
            if (c.S && c.S.panel === id) failed(c, body, m, go);
          });
        };
        go();
      }
    };
    return spec;
  }
  /* Wrap an existing panel so that some of its views (o.app === 'batch', for example) wait for the module. */
  function wrapPanel(m, id, test) {
    var P = Ps(), base = P[id];
    if (!base || typeof base.render !== 'function') return;
    P[id] = Object.assign({}, base, {
      render: function (c, body, o) {
        if (m.loaded || !test(o || {}, c)) return base.render.apply(this, arguments);
        var go = function () {
          var sk = skeleton(body, m.label);
          need(m.id).then(function () { sk.done(); if (c.S && c.S.panel === id) c.renderPanel(); }, function () { sk.done(); if (c.S && c.S.panel === id) failed(c, body, m, go); });
        };
        go();
      }
    });
  }
  /* A command (data-cmd) a deferred module registers: the stub loads the module, then runs the real command. */
  function cmdStub(m, name) {
    var P = Ps();
    var C = P._cmds = P._cmds || {};
    if (C[name]) return;
    var stub = C[name] = function (c, arg, el, e) {
      need(m.id).then(function () {
        var f = (Ps()._cmds || {})[name];
        if (typeof f !== 'function' || f === stub) return;
        if (el && !el.isConnected) el = document.querySelector('[data-cmd="' + name + (arg != null && arg !== '' ? ':' + arg : '') + '"]') || document.querySelector('[data-cmd^="' + name + '"]') || el;
        f(c, arg, el, e);
      }, function () { if (c && c.toast) c.toast('That tool did not download. Check your connection and try again.'); });
    };
    stub.__leStub = m.id;
  }
  /* A hook that is the trigger to load (the first selection loads the modules that add selection tools), and hooks whose
     calls are kept and replayed once the module is there (a shortcut pressed before it arrived). */
  function hookTriggers(m) {
    var H = hooks();
    m.on.forEach(function (name) {
      (H[name] = H[name] || []).push(function () { if (!m.loaded && !m.p && ctx()) need(m.id).catch(function () {}); });
    });
    m.replay.forEach(function (name) {
      (H[name] = H[name] || []).push(function (c) {
        if (m.loaded) return;
        var b = m.buffered = m.buffered || {};
        var q = b[name] = b[name] || [];
        if (q.length < 10) q.push([].slice.call(arguments, 1));
        if (!m.p) need(m.id).catch(function () {});
      });
    });
  }
  function trackReady() {
    var H = hooks();
    var list0 = H.ready = H.ready || [];
    if (list0.some(function (f) { return f.__leReady; })) return;
    var f = function (c, r) {
      ready.fired = true; ready.arg = r; ready.at = Date.now();
      scheduleWarm();
    };
    f.__leReady = true;
    list0.unshift(f);
  }

  /* ---------- Warm-up: after the first interaction, when idle, the modules most people open next ---------- */
  function conn() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return { metered: false };
    var slow = /^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
    return { metered: !!(c.saveData || c.type === 'cellular' || slow) };
  }
  function canWarm() {
    if (navigator.onLine === false) return 'offline';
    if (conn().metered) return 'metered';
    if (navigator.deviceMemory && navigator.deviceMemory < 2) return 'low-memory';
    try { if (LE.perf && LE.perf.level && LE.perf.level() === 'low') return 'low-memory'; } catch (e) {}
    try { if (LE.downloads && LE.downloads.mode && LE.downloads.mode() !== 'auto') return 'ask-mode'; } catch (e) {}
    if (window.LE_LOAD_NO_WARM) return 'off';
    return '';
  }
  function usage() {
    try { if (LE.downloads && LE.downloads.usage) return LE.downloads.usage() || {}; } catch (e) {}
    try { return (JSON.parse(localStorage.getItem('le-downloads-usage') || 'null') || {}).f || {}; } catch (e) { return {}; }
  }
  function score(m, u) {
    var month = Date.now() - 30 * 864e5;
    return m.features.reduce(function (s, f) { var r = u[f]; return s + (r && r.last > month ? r.n : 0); }, 0);
  }
  function warmOrder() {
    var u = usage();
    return mods.filter(function (m) { return typeof m.idle === 'number' && !m.loaded; })
      .map(function (m) { return { m: m, s: score(m, u) }; })
      .sort(function (a, b) { return b.s - a.s || a.m.idle - b.m.idle; })
      .map(function (x) { return x.m; });
  }
  function idle(fn, t) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: t || 2000 }); else setTimeout(fn, 250); }
  function runWarm() {
    if (warm.done) return;
    var why = canWarm();
    if (why) { warm.skipped = why; return; }
    var next = warmOrder().filter(function (m) { return !m.p && (m.tries || 0) < 2; })[0];
    if (!next) { warm.done = true; return; }
    idle(function () {
      need(next.id).then(function () { idle(runWarm, 3000); }, function () { idle(runWarm, 3000); });
    }, 3000);
  }
  /* Starts on the first pointer, key or touch after the app is interactive, or a few seconds after it, whichever is first. */
  function scheduleWarm() {
    if (warm.started) return;
    warm.started = true;
    var go = function () {
      if (warm.go) return;
      warm.go = true;
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) { window.removeEventListener(t, go, true); });
      idle(runWarm, 3000);
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) { window.addEventListener(t, go, true); });
    setTimeout(go, LE_WARM_AFTER());
  }
  function LE_WARM_AFTER() { return typeof window.LE_LOAD_WARM_MS === 'number' ? window.LE_LOAD_WARM_MS : 5000; }
  function param(names) {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return false; }
    return names.some(function (n) { return q.has(n); });
  }

  LE.modules = {
    /* defer({ id, src, css, deps, label, panels, wrap, rerender, queue, cmds, on, replay, retool, doc, param, hash, when, idle,
               features, after }): docs/LOADING.md, "Options". */
    defer: function (m) {
      m = Object.assign({ panels: {}, wrap: {}, rerender: [], deps: [] }, m || {});
      if (!m.id || !m.src || byId[m.id]) return;
      if (Array.isArray(m.panels)) { var o = {}; m.panels.forEach(function (id) { o[id] = ''; }); m.panels = o; }
      m.deps = list(m.deps);
      m.on = list(m.on);
      m.replay = list(m.replay);
      m.cmds = list(m.cmds);
      m.features = list(m.features).concat(Object.keys(m.panels).map(function (p) { return 'studio.' + p; }));
      m.state = 'waiting';
      byId[m.id] = m;
      mods.push(m);
      trackReady();
      Object.keys(m.panels).forEach(function (id) { Ps()[id] = placeholder(m, id, m.panels[id]); });
      Object.keys(m.wrap).forEach(function (id) { wrapPanel(m, id, m.wrap[id]); });
      m.cmds.forEach(function (n) { cmdStub(m, n); });
      hookTriggers(m);
      var now = false;
      try { now = (m.param && param(list(m.param))) || (m.hash && m.hash.test(location.hash || '')) || (typeof m.when === 'function' && m.when()); } catch (e) {}
      if (now) need(m.id).catch(function () {});
    },
    need: need,
    /* need(ids...) for several; resolves when all are there. */
    needAll: function (ids) { return Promise.all(list(ids).map(need)); },
    forDoc: forDoc,
    has: function (id) { return !!byId[id]; },
    loaded: function (id) { return !!(byId[id] && byId[id].loaded); },
    state: function (id) { return byId[id] ? byId[id].state : null; },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    /* The studio calls this once it is interactive (its 'ready' hook does it for the photo studio). */
    interactive: function (arg) { if (!ready.fired) { ready.fired = true; ready.arg = arg; ready.at = Date.now(); } scheduleWarm(); },
    warmStatus: function () { return { started: warm.started, running: !!warm.go, done: warm.done, skipped: warm.skipped || canWarm() || null, order: warmOrder().map(function (m) { return m.id; }) }; },
    list: function () { return mods.map(function (m) { return { id: m.id, src: m.src, css: m.css || null, deps: m.deps.slice(), loaded: !!m.loaded, state: m.state, idle: typeof m.idle === 'number' ? m.idle : null }; }); }
  };
})();
