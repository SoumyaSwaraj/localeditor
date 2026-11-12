/* LocalEditor photo studio: the loader map (docs/LOADING.md). Loaded after le-studio-panels.js and before le-studio.js.
   Everything here is data plus tiny stubs: what each deferred module is, what loads it (a panel, a command, the first
   selection, a deep link, a document that uses it, idle warm-up), and the few globals other code checks synchronously.
   The modules themselves are unchanged; when one arrives it replaces its stubs. scripts/build.js reads the paths below
   to keep every file in the design studio's offline part. */
(function () {
  'use strict';
  var LE = window.LE;
  var M = LE && LE.modules;
  var P = window.LEStudioPanels;
  if (!M || !P) return;
  var JS = '../assets/js/', CSS = '../assets/css/';
  function layersOf(pages) { var out = []; (pages || []).forEach(function (p) { (p && p.layers || []).forEach(function (l) { if (l) out.push(l); }); }); return out; }
  function anyLayer(pages, fn) { return layersOf(pages).some(fn); }
  function anyPage(pages, fn) { return (pages || []).some(function (p) { return !!p && fn(p); }); }
  function designTab(o, c) { return (o.tab || (c && c.S && c.S.project ? 'sizes' : 'templates')) === 'templates'; }
  var readyAt = 0;
  (P._hooks = P._hooks || {}).ready = P._hooks.ready || [];
  P._hooks.ready.push(function () { readyAt = Date.now(); });
  function ss(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- The map. `idle` ranks the warm-up (lower first; usage signals from LE.downloads reorder it). ---------- */
  M.defer({ id: 'stock', src: JS + 'le-stock.js', label: 'stock photos', rerender: ['apps', 'uploads', 'elements'], wrap: { uploads: function (o) { return o.tab === 'stock'; } }, idle: 9, features: ['studio.uploads'] });
  M.defer({ id: 'color', src: JS + 'le-studio-color.js', label: 'colour tools', panels: { replace: 'Replace', brand: 'Brand kit' }, doc: function (pages) { return anyPage(pages, function (p) { return p.background && p.background.spec; }); }, idle: 2 });
  M.defer({ id: 'tools', src: JS + 'le-studio-tools.js', label: 'studio tools', deps: ['color'], panels: { pages: 'Pages' }, cmds: ['addQr', 'copyStyle', 'editQr', 'guidesMenu', 'pasteStyle'], on: ['select'], replay: ['key'], retool: true,
    when: function () { try { var o = JSON.parse(localStorage.getItem('le-studio-ov') || 'null'); return !!(o && (o.rulers || o.grid)); } catch (e) { return false; } },
    doc: function (pages) { return anyLayer(pages, function (l) { return (l.mask && l.mask !== 'none') || /cell/i.test(l.name || ''); }); }, idle: 1 });
  M.defer({ id: 'icons', src: JS + 'le-studio-icons.js', label: 'icon styles', deps: ['color'], cmds: ['iconColors', 'swapStyle', 'tintSticker'], idle: 6, features: ['studio.elements'] });
  M.defer({ id: 'collagelib', src: JS + 'le-collage.js', label: 'collages' });
  M.defer({ id: 'collage', src: JS + 'le-studio-collage.js', css: CSS + 'studio-collage.css', label: 'collages', deps: ['collagelib'], cmds: ['cellZoom', 'collageCredits'], on: ['select'], retool: true,
    wrap: { design: designTab, uploads: function (o) { return o.tab === 'stock'; }, apps: function (o) { return o.app === 'collage'; } },
    doc: function (pages) { return anyPage(pages, function (p) { return p.collage; }) || anyLayer(pages, function (l) { return l.slot; }); }, idle: 5, features: ['studio.design', 'studio.collage'] });
  M.defer({ id: 'background', src: JS + 'le-studio-background.js', css: CSS + 'studio-background.css', label: 'background tools', deps: ['color'], panels: { background: 'Background' }, cmds: ['bgDetach', 'bgEdit', 'bgPanel'], on: ['select'], retool: true,
    doc: function (pages) { return anyPage(pages, function (p) { return p.background && (p.background.spec || p.background.type === 'image'); }); }, idle: 4 });
  M.defer({ id: 'recipes', src: JS + 'le-studio-recipes.js', css: CSS + 'studio-recipes.css', label: 'recipes', panels: { recipes: 'Recipes' }, wrap: { apps: function (o) { return o.app === 'batch'; } }, queue: 'onRecipeFile',
    doc: function (pages) { return anyLayer(pages, function (l) { return l.adjust && l.adjust.recipe; }); }, idle: 7 });
  M.defer({ id: 'export', src: JS + 'le-studio-export.js', css: CSS + 'studio-export.css', label: 'download options', panels: { export: 'Download' },
    doc: function (pages) { return anyPage(pages, function (p) { return p.carousel; }); }, idle: 0 });
  M.defer({ id: 'privacy', src: JS + 'le-studio-privacy.js', css: CSS + 'studio-privacy.css', label: 'redaction', panels: { redact: 'Redact' }, cmds: ['redactAdd', 'redactBake', 'redactMode', 'redactPanel', 'redactShape', 'redactStart'], on: ['select'], retool: true,
    wrap: { elements: function () { return true; }, apps: function (o) { return o.app === 'metadata'; } },
    doc: function (pages) { return anyLayer(pages, function (l) { return l.redact; }); }, idle: 3, features: ['studio.elements'] });
  M.defer({ id: 'cutout', src: JS + 'le-studio-cutout.js', css: CSS + 'studio-cutout.css', label: 'background remover', panels: { cutout: 'Remove background' }, cmds: ['cutBrush', 'cutCancel', 'cutDone', 'cutRedo', 'cutSoft', 'cutUndo', 'cutout'], on: ['select'], retool: true,
    wrap: { apps: function (o) { return o.app === 'thumbnail'; } },
    doc: function (pages) { return anyLayer(pages, function (l) { return l.cutout; }); }, idle: 6 });
  M.defer({ id: 'makerslib', src: JS + 'le-makers.js', label: 'quick makers' });
  M.defer({ id: 'makers', src: JS + 'le-studio-makers.js', css: CSS + 'studio-makers.css', label: 'quick makers', deps: ['makerslib'], param: ['make'],
    wrap: { apps: function (o) { return o.app === 'make'; } },
    doc: function (pages) { return anyPage(pages, function (p) { return p.maker; }); }, idle: 8, features: ['studio.make', 'studio.makers'] });
  M.defer({ id: 'fonts', src: JS + 'le-studio-fonts.js', css: CSS + 'studio-fonts.css', label: 'fonts', panels: { fonts: 'Fonts' }, idle: 1, features: ['studio.text'] });
  M.defer({ id: 'design', src: JS + 'le-design.js', css: CSS + 'studio-design.css', label: 'design files', deps: ['collagelib', 'makerslib'], hash: /(?:^#|[#&])d=[A-Za-z0-9_-]/, idle: 10 });
  /* Agent mode and live links: never warmed; ?agent, #ops=, ?link=, a session to resume, headless mode, the File menu entry
     or a call on window.LEAgent loads them. */
  var agentNow = function () { if (window.LE_AGENT_HEADLESS === true) return true; try { var s = JSON.parse(ss('le-agent') || 'null'); return !!(s && s.session); } catch (e) { return false; } };
  M.defer({ id: 'agent', src: JS + 'le-agent.js', label: 'agent mode', deps: ['design'], param: ['agent'], hash: /(?:^#|[#&])ops=/, when: agentNow, cmds: ['agentMode'] });
  M.defer({ id: 'agentui', src: JS + 'le-studio-agent.js', css: CSS + 'studio-agent.css', label: 'agent mode', deps: ['agent'], param: ['agent'], hash: /(?:^#|[#&])ops=/, when: agentNow, retool: true });
  M.defer({ id: 'link', src: JS + 'le-link.js', label: 'live link', deps: ['design', 'agentui'], param: ['link'] });

  /* ---------- Registration data that stays in the core ---------- */
  if (P._apps && !P._apps.some(function (a) { return a[0] === 'thumbnail'; })) P._apps.splice(0, 0, ['thumbnail', 'Thumbnail', 'thumb', 'Cut-out + bold title, 1280×720']);

  /* ---------- Stubs: sync checks other code makes, forwarded once the module is there ---------- */
  function later(id, get, name) {
    return function () {
      var a = arguments, self = this;
      return M.need(id).then(function () { var o = get(); var f = o && o[name]; if (typeof f !== 'function' || f.__leStub) throw new Error(name + ' is not available'); return f.apply(o, a); });
    };
  }
  function stub(fn) { fn.__leStub = true; return fn; }
  /* A view inside a core panel (Elements → frames, the 34 icon styles): a skeleton, the module, then the panel again. */
  function view(id, key) {
    P[key] = stub(function (c, host) {
      var sk = document.createElement('div');
      sk.className = 'le-load-wait';
      sk.setAttribute('aria-busy', 'true');
      sk.innerHTML = '<span class="skel skel-cards"></span>';
      if (host && host.appendChild) host.appendChild(sk);
      var open = c && c.S && c.S.panel;
      M.need(id).then(function () { if (P[key] && !P[key].__leStub && c.S.panel === open && c.renderPanel) c.renderPanel(true); }, function () { sk.innerHTML = '<p class="sx-note">This did not download. Check your connection and open the panel again.</p>'; });
    });
  }
  view('tools', '_grids');
  view('tools', '_stylesTab');
  view('icons', '_withIcons');
  view('icons', '_withIconsSearch');
  P._colorPop = stub(function (c, anchor, o) { M.need('color').then(function () { if (P._colorPop && !P._colorPop.__leStub) P._colorPop(c, anchor && anchor.isConnected ? anchor : anchor, o); }, function () { if (c && c.colorPopBasic) c.colorPopBasic(anchor, o); }); });

  /* LE.design: the studio asks isDesignFile() synchronously (drops, the project picker) and shows the File menu entries. */
  if (!LE.design) {
    var D = function () { return LE.design; };
    LE.design = {
      __leStub: true,
      isDesignFile: function (f) { return !!f && (/\.json$/i.test(f.name || '') || f.type === 'application/json'); },
      studioImport: later('design', D, 'studioImport'), studioCmd: later('design', D, 'studioCmd'), openShare: later('design', D, 'openShare'),
      parse: later('design', D, 'parse'), stringify: later('design', D, 'stringify'), saveDialog: later('design', D, 'saveDialog'), openSharedLink: later('design', D, 'openSharedLink'),
      /* Template links (#d=…): the hash trigger above already loads the module; later links (hashchange) load it then. */
      studioBoot: function (c) {
        if (M.loaded('design') || /(?:^#|[#&])d=[A-Za-z0-9_-]/.test(location.hash || '')) return M.need('design').then(function () { return LE.design.studioBoot(c); });
        var onHash = function () {
          if (!/(?:^#|[#&])d=[A-Za-z0-9_-]/.test(location.hash || '')) return;
          window.removeEventListener('hashchange', onHash);
          M.need('design').then(function () { LE.design.studioBoot(c); });
        };
        window.addEventListener('hashchange', onHash);
        return Promise.resolve(null);
      }
    };
  }
  /* window.LEAgent: agents call it straight away (docs/AGENT-GUIDE.md); the first call loads agent mode. */
  if (!window.LEAgent) {
    var A = function () { return window.LEAgent; };
    var api = { __leStub: true, protocol: 1, headless: window.LE_AGENT_HEADLESS === true, paused: false, rev: 0 };
    ['help', 'begin', 'end', 'state', 'apply', 'applyExternal', 'find', 'catalog', 'check', 'export', 'notes', 'resolveNote', 'result', 'load', 'save', 'toLink', 'command', 'configure']
      .forEach(function (k) { api[k] = later('agentui', A, k); });
    api.on = function (name, fn) {
      var off = null, dead = false;
      M.need('agentui').then(function () { if (!dead && window.LEAgent.on && !window.LEAgent.__leStub) off = window.LEAgent.on(name, fn); });
      return function () { dead = true; if (typeof off === 'function') off(); };
    };
    window.LEAgent = api;
  }
  /* Collage replace sheet and background editing are reached from a selection (which loads them); forward if faster. */
  if (!window.LEStudioCollage) window.LEStudioCollage = { __leStub: true, openReplace: later('collage', function () { return window.LEStudioCollage; }, 'openReplace') };
  if (!window.LEStudioBackground) window.LEStudioBackground = { __leStub: true, fromLayer: later('background', function () { return window.LEStudioBackground; }, 'fromLayer') };

  /* ---------- Start screen: the makers row is a skeleton until the makers arrive (idle, or on scroll into view) ---------- */
  var start0 = P._start;
  if (typeof start0 === 'function') {
    P._start = function (c, host) {
      start0.apply(this, arguments);
      if (M.loaded('makers')) return;
      var inner = host.querySelector('.sx-start-inner');
      if (!inner || inner.querySelector('.mk-start')) return;
      var sec = document.createElement('div');
      sec.className = 'sx-start-sec mk-start le-load-stub';
      sec.setAttribute('aria-busy', 'true');
      sec.innerHTML = '<div class="sx-sec-head"><h2>Make something quick</h2></div><div class="mk-row-cards"><span class="skel skel-cards"></span></div>';
      var hero = inner.querySelector('.sx-hero');
      if (hero && hero.nextSibling) inner.insertBefore(sec, hero.nextSibling); else inner.appendChild(sec);
      var go = function () { M.need('makers').catch(function () { if (sec.parentNode) sec.parentNode.removeChild(sec); }); };
      /* On screen: it loads once the studio is interactive and the main thread is idle; below the fold: when scrolled to. */
      var r = sec.getBoundingClientRect();
      if (r.top < window.innerHeight || !window.IntersectionObserver) afterReady(go);
      else {
        var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); } });
        io.observe(sec);
      }
    };
  }
  function afterReady(fn) {
    var run = function () { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 300); };
    if (readyAt) setTimeout(run, 300);
    else (P._hooks.ready = P._hooks.ready || []).push(function () { setTimeout(run, 300); });
  }
})();
