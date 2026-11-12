/* LocalEditor: deferred studio modules (LE.modules). See docs/LOADING.md.
   A module that is only needed after a tap does not have to block the first paint. Declare it where its <script> tag was:
     <script>LE.modules.defer({ id: 'stock', src: '../assets/js/le-stock.js' });</script>
   It then loads, in declaration order, when the page is idle after load, or at once when one of its panels is opened.
   Everything it registers keeps working: panel specs get a placeholder that loads the real module on first open and
   re-renders; 'init' hooks it adds after the studio booted run once with the studio context; the rail is redrawn. */
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
  var idleStarted = false;

  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-le-deferred', '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.body.appendChild(s);
    });
  }
  function style(href) {
    return new Promise(function (resolve) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = l.onerror = function () { resolve(); };
      document.head.appendChild(l);
    });
  }
  function counts() { var H = hooks(), o = {}; Object.keys(H).forEach(function (k) { o[k] = (H[k] || []).length; }); return o; }
  function ctx() { var c = window.LEStudio; return c && c.scene ? c : null; }

  /* Loads one module (and everything declared before it, so the order of the page's script tags is kept). */
  function need(id) {
    var m = byId[id];
    if (!m) return Promise.reject(new Error('Unknown module ' + id));
    if (m.p) return m.p;
    var before = mods.slice(0, mods.indexOf(m)).filter(function (x) { return !x.p; });
    before.forEach(function (x) { need(x.id); });
    m.p = chain = chain.then(function () {
      var hooksBefore = counts();
      return (m.css ? style(m.css) : Promise.resolve()).then(function () { return script(m.src); }).then(function () {
        m.loaded = true;
        var c = ctx();
        if (c) {
          /* The studio already fired 'init': run the hooks this module added, once. */
          (hooks().init || []).slice(hooksBefore.init || 0).forEach(function (fn) { try { fn(c); } catch (e) { console.error(e); } });
          if (c.renderRail) try { c.renderRail(); } catch (e) {}
          var open = c.S && c.S.panel;
          if (open && (m.panels[open] || m.rerender.indexOf(open) >= 0 || m.wrap[open]) && c.renderPanel) try { c.renderPanel(true); } catch (e) { console.error(e); }
        }
        try { window.dispatchEvent(new CustomEvent('le-load', { detail: { id: m.id } })); } catch (e) {}
      });
    });
    m.p.catch(function (err) { console.warn(err); m.p = null; });
    return m.p;
  }
  function loading(c, body) {
    var el = document.createElement('p');
    el.className = 'sx-note le-load-wait';
    el.setAttribute('role', 'status');
    el.textContent = 'Opening…';
    body.appendChild(el);
  }
  /* A stand-in panel: shows a short "Opening…" line and swaps in the real panel as soon as the module has loaded. */
  function placeholder(m, id, title) {
    var P = Ps(), base = P[id];
    var spec = {
      title: title || (base && base.title) || id, eyebrow: (base && base.eyebrow) || 'Studio', __lePlaceholder: m.id,
      rail: base && base.rail, sheet: base && base.sheet,
      render: function (c, body, o) {
        loading(c, body);
        var q = m.queue;
        var stub = null, queued = [];
        if (q && c.S) { stub = function () { queued.push(arguments); }; c.S[q] = stub; }
        need(m.id).then(function () {
          if (c.S && c.S.panel === id && Ps()[id] === spec && base) { Ps()[id] = base; }
          if (c.S && c.S.panel === id) c.renderPanel();
          if (stub && c.S[q] && c.S[q] !== stub) queued.forEach(function (a) { c.S[q].apply(null, a); });
        }, function () {
          body.innerHTML = '';
          if (base) { Ps()[id] = base; c.renderPanel(); } else body.appendChild(c.ui.empty('This panel could not open', 'Check your connection and try again. Your design is safe.'));
        });
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
        if (m.loaded || !test(o || {})) return base.render.apply(base, arguments);
        loading(c, body);
        need(m.id).then(function () { if (c.S && c.S.panel === id) c.renderPanel(); });
      }
    });
  }
  /* After the load event, when the main thread is idle: every deferred module, in order. Later declarations follow. */
  function startIdle() {
    if (idleStarted) return;
    idleStarted = true;
    var go = function () {
      var run = function () { mods.forEach(function (m) { need(m.id); }); };
      if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 1500 }); else setTimeout(run, 200);
      idleStarted = 'ran';
    };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  }

  LE.modules = {
    /* defer({ id, src, css, panels: { id: title }, wrap: { panelId: fn(opts) -> bool }, rerender: [panelId], queue: 'S key' }) */
    defer: function (m) {
      m = Object.assign({ panels: {}, wrap: {}, rerender: [] }, m || {});
      if (!m.id || !m.src || byId[m.id]) return;
      if (Array.isArray(m.panels)) { var o = {}; m.panels.forEach(function (id) { o[id] = ''; }); m.panels = o; }
      byId[m.id] = m;
      mods.push(m);
      Object.keys(m.panels).forEach(function (id) { Ps()[id] = placeholder(m, id, m.panels[id]); });
      Object.keys(m.wrap).forEach(function (id) { wrapPanel(m, id, m.wrap[id]); });
      if (idleStarted === 'ran') { idleStarted = false; }
      startIdle();
    },
    need: need,
    loaded: function (id) { return !!(byId[id] && byId[id].loaded); },
    list: function () { return mods.map(function (m) { return { id: m.id, src: m.src, loaded: !!m.loaded }; }); }
  };
})();
