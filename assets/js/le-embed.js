/* LocalEditor: the embed viewer (embed/index.html). A read-only view of one design, from a template link
   (#d=<payload>) or a design file on this site (?src=<path>.json). The renderer is the studio's own, loaded after the
   first paint. Nothing in the design is run: it is parsed as data by LE.design and drawn on a canvas. Requests go to
   this origin only. docs/EMBED.md */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  var ROOT = html.getAttribute('data-root') || '../';
  var JS = ROOT + 'assets/js/';
  var q = new URLSearchParams(location.search);
  var $ = function (id) { return doc.getElementById(id); };

  /* Theme: ?theme=light|dark, else the visitor's own choice on this site, else the system's. Tokens only. */
  var theme = q.get('theme');
  try {
    if (theme !== 'light' && theme !== 'dark') theme = localStorage.getItem('le-theme');
    var skin = localStorage.getItem('le-skin');
    if (skin && /^[a-z]{1,20}$/.test(skin) && skin !== 'clear') html.setAttribute('data-skin', skin);
  } catch (e) { /* storage is closed in some frames */ }
  if (theme !== 'light' && theme !== 'dark') theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  html.setAttribute('data-theme', theme);

  var main = $('em'), stage = $('em-stage'), msg = $('em-msg'), nav = $('em-nav'), prev = $('em-prev'), next = $('em-next');
  var status = $('em-status'), title = $('em-title'), open = $('em-open'), copy = $('em-copy'), link = $('em-link');
  var S = { project: null, blobs: {}, canvases: {}, page: 0, gen: 0, run: 0, drawn: 0 };
  var LIMIT = { text: 12 * 1024 * 1024, image: 25 * 1024 * 1024, images: 60, edge: 2048 };

  /* The site's tokens and button styles arrive after the first paint; the bar shows once they are in (or after 2 s). */
  (function () {
    var l = doc.createElement('link');
    var done = function () { main.classList.add('is-styled'); };
    l.rel = 'stylesheet'; l.href = ROOT + 'assets/css/app.css';
    l.onload = done; l.onerror = done;
    doc.head.insertBefore(l, doc.head.querySelector('link[rel="stylesheet"]'));
    setTimeout(done, 2000);
  })();

  function say(text, error) {
    S.run++;
    stage.textContent = '';
    msg.textContent = text;
    msg.className = 'em-msg' + (error ? ' is-error' : '');
    msg.setAttribute('role', error ? 'alert' : 'status');
    stage.appendChild(msg);
    main.setAttribute('aria-busy', error ? 'false' : 'true');
    if (error) { nav.hidden = true; open.hidden = true; }
  }
  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = src; s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('load')); };
      doc.head.appendChild(s);
    });
  }
  var libsReady = null;
  function libs() {
    if (!libsReady) {
      libsReady = ['le-engine.js', 'le-objects.js', 'le-project.js', 'le-fx-boot.js', 'le-fonts.js', 'le-fonts-originals.js', 'le-assets.js', 'le-collage.js', 'le-design.js']
        .reduce(function (chain, f) { return chain.then(function () { return script(JS + f); }); }, Promise.resolve());
      libsReady.catch(function () { libsReady = null; });
    }
    return libsReady;
  }
  /* Same-origin requests only; a redirect is refused so it cannot lead elsewhere. */
  function get(url) { return fetch(url.href, { credentials: 'same-origin', redirect: 'error' }).then(function (r) { if (!r.ok) throw new Error('missing'); return r; }); }
  function sameOrigin(path, base) {
    var u = null;
    try { u = new URL(path, base || location.href); } catch (e) { return null; }
    return u.origin === location.origin && (u.protocol === 'https:' || u.protocol === 'http:') ? u : null;
  }
  function payloadOf(hash) { var m = /(?:^#|[#&])d=([A-Za-z0-9_-]+)/.exec(String(hash || '')); return m ? m[1] : ''; }

  function load() {
    var payload = payloadOf(location.hash), src = q.get('src');
    copy.hidden = true;
    S.gen++; S.project = null;
    if (!payload && !src) { say('There is no design to show. Add a template link to the address (#d=…) or the path of a design file on this site (?src=…).', true); return; }
    var file = null;
    if (!payload) {
      file = sameOrigin(src);
      if (!file || !/\.json$/i.test(file.pathname)) { say('This viewer opens design files from this site only (a path that ends in .json).', true); return; }
    }
    say('Loading the design…');
    var gen = ++S.gen;
    var LE, read;
    libs().then(function () {
      LE = window.LE;
      if (payload) { read = function () { return LE.design.fromLink('#d=' + payload); }; return read(); }
      var count = 0;
      var resolve = function (rel) {
        var u = sameOrigin(rel, file.href);
        if (!u || ++count > LIMIT.images) return null;
        return get(u).then(function (r) { return r.blob(); }).then(function (b) { return b.size <= LIMIT.image && /^image\//.test(b.type) ? b : null; }, function () { return null; });
      };
      return get(file).then(function (r) { return r.text(); }).then(function (text) {
        if (text.length > LIMIT.text) throw new Error('large');
        read = function () { count = 0; return LE.design.parse(text, { resolve: resolve }); };
        return read();
      });
    }).then(function (res) {
      /* A page that is only a quick-maker recipe needs the makers; fetch them and read again. */
      if (res && res.ok && !LE.makers && (res.warnings || []).some(function (w) { return w.kind === 'maker-unavailable'; })) {
        return script(JS + 'le-makers.js').then(read).catch(function () { return res; });
      }
      return res;
    }).then(function (res) {
      if (gen !== S.gen) return;
      if (!res || !res.ok) { say('This design cannot be shown. ' + ((res && res.errors && res.errors[0] && res.errors[0].message) || ''), true); return; }
      S.project = res.project; S.blobs = res.assets || {}; S.canvases = {}; S.page = 0;
      var name = String(res.project.name || 'Design').slice(0, 160);
      title.textContent = name;
      doc.title = name + ' · LocalEditor';
      var studio = new URL(ROOT + 'studio/', location.href).href;
      if (payload) { open.href = studio + '#d=' + payload; open.hidden = false; }
      else LE.design.toLink(res.project, { base: studio }).then(function (l) { if (gen === S.gen && l && l.fits) { open.href = l.url; open.hidden = false; } }, function () {});
      nav.hidden = res.project.pages.length < 2;
      return draw(0);
    }).catch(function (e) {
      if (gen !== S.gen) return;
      say(e && e.message === 'large' ? 'This design file is too large to show here.' : e && e.message === 'missing' ? 'The design file was not found on this site.' : 'The design could not be loaded. Check your connection and try again.', true);
    });
  }

  function canvasFor(id) {
    if (S.canvases[id]) return Promise.resolve(S.canvases[id]);
    var blob = S.blobs[id];
    if (!blob) return Promise.resolve(null);
    return createImageBitmap(blob).then(function (bmp) {
      var c = doc.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      S.canvases[id] = c;
      return c;
    }, function () { return null; });
  }
  function fit(pg) {
    var cs = getComputedStyle(stage);
    var w = Math.max(40, stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), h = Math.max(40, stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    return Math.min(w / pg.width, h / pg.height);
  }
  function place(c, pg) { var f = fit(pg); c.style.width = Math.max(1, Math.round(pg.width * f)) + 'px'; c.style.height = Math.max(1, Math.round(pg.height * f)) + 'px'; return f; }
  function describe(pg, i, n) {
    var words = (pg.layers || []).filter(function (l) { return l.type === 'text' && l.visible !== false && l.text; }).map(function (l) { return String(l.text).replace(/\s+/g, ' ').trim(); }).join('. ').slice(0, 300);
    return title.textContent + (n > 1 ? ', page ' + (i + 1) + ' of ' + n : '') + (words ? '. ' + words : '');
  }
  function draw(i) {
    var LE = window.LE, p = S.project;
    if (!p) return Promise.resolve();
    var n = p.pages.length;
    i = Math.max(0, Math.min(n - 1, i));
    S.page = i;
    var run = ++S.run;
    var pg = p.pages[i];
    prev.disabled = i === 0; next.disabled = i === n - 1;
    status.textContent = n > 1 ? 'Page ' + (i + 1) + ' of ' + n : '';
    var old = stage.querySelector('canvas');
    if (old) old.classList.add('is-stale');
    main.setAttribute('aria-busy', 'true');
    var scale = Math.min(fit(pg) * Math.min(window.devicePixelRatio || 1, 2), LIMIT.edge / Math.max(pg.width, pg.height), 2);
    var ids = (pg.layers || []).map(function (l) { return l.src; }).filter(Boolean);
    if (pg.background && pg.background.src) ids.push(pg.background.src);
    return Promise.all(ids.map(function (id) { return canvasFor(id).then(function (c) { return [id, c]; }); })).then(function (pairs) {
      var host = doc.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:64px;pointer-events:none;';
      doc.body.appendChild(host);
      var sc = new LE.Scene({ el: host, width: pg.width, height: pg.height });
      pairs.forEach(function (x) { if (x[1]) sc.addAsset(x[0], x[1]); });
      sc.load(pg);
      var done = function () { try { sc.destroy(); } catch (e) { /* already gone */ } host.remove(); };
      return sc.render(scale, { includeBackground: true }).then(function (c) { done(); return c; }, function (e) { done(); throw e; });
    }).then(function (c) {
      if (run !== S.run) return;
      c.className = 'em-page';
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', describe(pg, i, n));
      stage.textContent = '';
      stage.appendChild(c);
      place(c, pg);
      S.drawn = scale;
      main.setAttribute('aria-busy', 'false');
    }, function () { if (run === S.run) say('This page could not be drawn.', true); });
  }

  prev.addEventListener('click', function () { draw(S.page - 1); });
  next.addEventListener('click', function () { draw(S.page + 1); });
  main.addEventListener('keydown', function (e) {
    if (!S.project || e.altKey || e.ctrlKey || e.metaKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    var n = S.project.pages.length, to = null;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') to = S.page + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') to = S.page - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to == null || n < 2) return;
    e.preventDefault();
    to = Math.max(0, Math.min(n - 1, to));
    if (to !== S.page) draw(to);
  });
  /* In a frame the new tab may be blocked by the host page; then the address is offered for copying. */
  open.addEventListener('click', function (e) {
    if (window.top === window.self) return;
    e.preventDefault();
    var w = null;
    try { w = window.open(open.href, '_blank'); } catch (err) { w = null; }
    if (w) { try { w.opener = null; } catch (err2) { /* another origin */ } return; }
    copy.hidden = false;
    link.value = open.href;
    link.focus(); link.select();
  });
  link.addEventListener('focus', function () { link.select(); });

  var timer = 0;
  function refit() {
    var c = stage.querySelector('canvas');
    if (!c || !S.project) return;
    var pg = S.project.pages[S.page];
    var f = place(c, pg);
    clearTimeout(timer);
    var want = Math.min(f * Math.min(window.devicePixelRatio || 1, 2), LIMIT.edge / Math.max(pg.width, pg.height), 2);
    if (want > S.drawn * 1.25) timer = setTimeout(function () { draw(S.page); }, 200);
  }
  if (window.ResizeObserver) new ResizeObserver(refit).observe(stage); else window.addEventListener('resize', refit);
  window.addEventListener('hashchange', load);
  load();
})();
