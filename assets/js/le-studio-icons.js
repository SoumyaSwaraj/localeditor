/* LocalEditor studio icons: withicons styles, palettes, offline packs, recolour & swap style. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var LE = window.LE;
  var U = P._u;
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  function hook(n, f) { (H[n] = H[n] || []).push(f); }
  function has(fn) { return !!(LE.assets && typeof LE.assets[fn] === 'function'); }
  function COL() { return window.LEStudioColor; }

  var GROUPS = [['', 'All'], ['essentials', 'Essentials'], ['product', 'Product'], ['3d-glass', '3D & glass'], ['playful', 'Playful'], ['artistic', 'Artistic'], ['holidays', 'Holidays']];
  var TOPICS = [['', 'Popular'], ['home', 'Home'], ['heart', 'Love'], ['star', 'Stars'], ['arrow', 'Arrows'], ['shop', 'Shopping'], ['food', 'Food'], ['travel', 'Travel'], ['music', 'Music'], ['user', 'People'], ['weather', 'Weather'], ['chat', 'Chat'], ['gift', 'Gifts'], ['camera', 'Media']];
  var MONO_DEFAULT = '#17131f';

  function ready() {
    if (!LE.assets || !LE.assets.load) return Promise.reject(new Error('no assets'));
    return LE.assets.load('withicons').then(function () {
      if (!has('iconStyles')) throw new Error('styles unavailable');
      var list = LE.assets.iconStyles() || [];
      if (!list.length) throw new Error('styles unavailable');
      return list;
    });
  }
  function styleById(list, id) { return list.filter(function (s) { return s.id === id; })[0] || null; }
  function palettesFor(styleId) {
    if (!has('iconPalettes')) return [];
    try { return LE.assets.iconPalettes(styleId) || []; } catch (e) { return []; }
  }
  function prefs(c) {
    var p = c.lsGet('le-studio-wi', null) || {};
    p.style = p.style || 'line';
    p.pal = p.pal || {};
    p.color = p.color || MONO_DEFAULT;
    p.custom = p.custom || {};
    return p;
  }
  function savePrefs(c, p) { c.lsSet('le-studio-wi', p); }
  function optsFor(c, st, p) {
    if (!st) return {};
    if (st.colorful) {
      if (p.custom[st.id] && p.custom[st.id].length) return { colors: p.custom[st.id].slice() };
      return palOpts(palettesFor(st.id), p.pal[st.id] || st.defaultPalette);
    }
    return { color: p.color };
  }
  function palOpts(pals, id) {
    if (!id || id === 'default') return {};
    var pl = pals.filter(function (x) { return x.id === id; })[0];
    return pl && pl.colors && pl.colors.length ? { colors: pl.colors.slice() } : { palette: id };
  }
  function iconName(id) { var m = /^withicons:([\w-]+)\/([\w-]+)$/.exec(id || ''); return m ? { style: m[1], name: m[2] } : null; }
  var urls = P._urlCache ? P._urlCache('icons', 400) : null;
  var urlMemo = {};
  function iconUrl(id, o) {
    var key = id + '|' + JSON.stringify(o || {});
    var hit = urls ? urls.get(key) : urlMemo[key];
    if (hit) return hit;
    var markup = LE.assets.svg(id, o || {});
    if (!markup) throw new Error('missing');
    var u = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    return urls ? urls.set(key, u) : (urlMemo[key] = u);
  }
  var loading = {};
  function loadStyle(id, onProgress) {
    if (!has('loadStyle')) return Promise.resolve();
    if (!loading[id]) loading[id] = Promise.resolve(LE.assets.loadStyle(id, onProgress)).catch(function (err) { delete loading[id]; throw err; });
    return loading[id];
  }
  function frac(a, b) {
    if (typeof a === 'number' && typeof b === 'number' && b > 0) return a / b;
    if (a && typeof a === 'object' && a.total) return (a.loaded || a.done || 0) / a.total;
    if (typeof a === 'number' && a <= 1) return a;
    if (typeof a === 'number' && a <= 100) return a / 100;
    return null;
  }
  var POPULAR = ('star heart home user search check bell camera gift music sun moon cloud phone mail chat calendar clock map pin cart bag tag settings lock image video play book coffee leaf flower fire bolt globe plane car trophy crown smile thumbs-up rocket light-bulb pencil trash download upload share link wifi battery cake balloon sparkles diamond shield key wallet credit-card chart briefcase graduation-cap paw tree mountain umbrella snowflake pizza wine headphones microphone gamepad palette brush scissors')
    .split(' ');
  function popular(styleId, limit) {
    var out = [], seen = {};
    for (var i = 0; i < POPULAR.length && out.length < limit; i++) {
      var r = LE.assets.search(POPULAR[i], { set: 'withicons', style: styleId, limit: 2 }) || [];
      for (var j = 0; j < r.length && out.length < limit; j++) if (!seen[r[j].id]) { seen[r[j].id] = 1; out.push(r[j]); }
    }
    return out;
  }
  function sampleId(st) {
    try {
      var r = LE.assets.search('star', { set: 'withicons', style: st.id, limit: 1 });
      if (r && r[0]) return r[0].id;
      r = popular(st.id, 1);
      return r[0] ? r[0].id : null;
    } catch (e) { return null; }
  }
  function addIcon(c, id, st, p, at) {
    var o = optsFor(c, st, p);
    var go = function () {
      var lid = c.addSvg(id, at || null, { svg: o, name: id.split('/').pop().replace(/-/g, ' ') });
      if (lid) {
        var map = side(c);
        var nm = iconName(id);
        map[lid] = { style: nm.style, name: nm.name, palette: o.palette || '', color: o.color || null };
        if (o.colors) map[lid].colors = o.colors;
      }
      return lid;
    };
    return loadStyle(st.id).then(go).catch(function () { c.toast('That style is not available offline yet.'); });
  }
  function side(c) { var s = c.studio(); s.icons = s.icons || {}; return s.icons; }

  /* ---------- Elements › Icons › 34 styles ---------- */
  P._withIcons = function (c, host) {
    var wrap = c.h('<div class="sx-wi"><div class="sx-wi-skel">' + new Array(7).join('<i class="sx-skel"></i>') + '</div></div>');
    host.appendChild(wrap);
    ready().then(function (list) { wrap.innerHTML = ''; draw(c, wrap, list); }).catch(function () {
      wrap.innerHTML = '';
      wrap.appendChild(c.ui.empty('Icon styles are installing', 'The 34 withicons styles will appear here once they finish downloading. Lucide and Phosphor work right now.', [{ label: 'Use Lucide', fn: function () { c.lsSet('le-studio-iconset', 'lucide'); c.renderPanel(true); } }]));
    });
  };
  function draw(c, wrap, list) {
    var p = prefs(c);
    var st = styleById(list, p.style) || list[0];
    p.style = st.id;
    var po = c.S.panelOpts;
    var grp = po.wiGroup || '';
    var sw = c.h('<div class="sx-wi-styles"><div class="sx-wi-head"><div><span class="sx-eyebrow">Style</span><strong class="sx-wi-cur"></strong></div><button type="button" class="sx-link sx-wi-off">' + c.ic('cloudOff') + 'Offline</button></div><div class="sx-chips is-scroll sx-wi-groups"></div><div class="sx-wi-rail" role="listbox" aria-label="Icon styles"></div></div>');
    wrap.appendChild(sw);
    sw.querySelector('.sx-wi-cur').textContent = st.name + ' · ' + (st.count || '') + ' icons';
    sw.querySelector('.sx-wi-off').onclick = function () { offlineModal(c, list); };
    var gEl = sw.querySelector('.sx-wi-groups');
    GROUPS.forEach(function (g) {
      if (g[0] && !list.some(function (s) { return s.group === g[0]; })) return;
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (g[0] === grp) + '">' + c.esc(g[1]) + '</button>');
      b.onclick = function () { po.wiGroup = g[0]; c.renderPanel(true); };
      gEl.appendChild(b);
    });
    var rail = sw.querySelector('.sx-wi-rail');
    list.filter(function (s) { return !grp || s.group === grp; }).forEach(function (s) {
      var card = c.h('<button type="button" class="sx-wi-style" role="option" aria-selected="' + (s.id === st.id) + '" data-id="' + c.esc(s.id) + '" title="' + c.esc(s.description || s.name) + '"><span class="sx-wi-prev"><i class="sx-skel"></i></span><b>' + c.esc(s.name) + '</b>' + (s.offline ? '<em class="sx-wi-badge" aria-label="Saved offline">' + c.ic('check') + '</em>' : '') + '</button>');
      card.onclick = function () { p.style = s.id; savePrefs(c, p); c.renderPanel(true); };
      rail.appendChild(card);
    });
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); preview(en.target); } });
    }, { root: rail, rootMargin: '0px 120px' }) : null;
    var queue = Promise.resolve();
    function preview(card) {
      var s = styleById(list, card.getAttribute('data-id'));
      queue = queue.then(function () {
        return loadStyle(s.id).then(function () {
          var sid = sampleId(s);
          if (!sid) return;
          var box = card.querySelector('.sx-wi-prev');
          box.innerHTML = '<img alt="" src="' + iconUrl(sid, optsFor(c, s, p)) + '">';
        }).catch(function () { card.querySelector('.sx-wi-prev').innerHTML = c.ic('cloudOff'); });
      });
    }
    [].forEach.call(rail.children, function (card) { if (io) io.observe(card); else preview(card); });
    var cur = rail.querySelector('[aria-selected="true"]');
    if (cur) requestAnimationFrame(function () { rail.scrollLeft = Math.max(0, cur.offsetLeft - (rail.clientWidth - cur.offsetWidth) / 2); });

    var colorCard = c.h('<div class="sx-card sx-wi-colors"></div>');
    wrap.appendChild(colorCard);
    colorRow(c, colorCard, st, p, function () { c.renderPanel(true); });

    var bar = c.h('<div class="sx-sticky sx-wi-search"></div>');
    wrap.appendChild(bar);
    var q = po.wiQ || '';
    U.searchBox(c, bar, 'Search ' + (st.count || 1000) + ' ' + st.name + ' icons', q, function (v) { po.wiQ = v; po.wiTopic = ''; drawGrid(); });
    var topic = po.wiTopic || '';
    var tEl = c.h('<div class="sx-chips is-scroll"></div>');
    TOPICS.forEach(function (t) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (t[0] === topic && !q) + '">' + c.esc(t[1]) + '</button>');
      b.onclick = function () { po.wiTopic = t[0]; po.wiQ = ''; bar.querySelector('input').value = ''; tEl.querySelectorAll('.sx-chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); drawGrid(); };
      tEl.appendChild(b);
    });
    bar.appendChild(tEl);
    var gridHost = c.h('<div class="sx-wi-grid-host"></div>');
    wrap.appendChild(gridHost);
    function drawGrid() {
      gridHost.innerHTML = '';
      var query = po.wiQ || po.wiTopic || '';
      var prog = c.h('<div class="sx-wi-load"><div class="sx-progress"><i></i></div><small>Loading ' + c.esc(st.name) + ' icons…</small></div>');
      var sk = c.h('<div class="sx-grid sx-grid-5 sx-wi-grid">' + new Array(16).join('<span class="sx-tile sx-skel"></span>') + '</div>');
      gridHost.appendChild(prog);
      gridHost.appendChild(sk);
      loadStyle(st.id, function (a, b) { var f = frac(a, b); if (f != null) prog.querySelector('i').style.width = Math.round(f * 100) + '%'; }).then(function () {
        gridHost.innerHTML = '';
        var res = [];
        try { res = query ? LE.assets.search(query, { set: 'withicons', style: st.id, limit: 150 }) || [] : popular(st.id, 120); } catch (e) { res = []; }
        if (!res.length) { gridHost.appendChild(U.note(c, 'No ' + st.name + ' icons match “' + query + '”. Try home, star, gift or chat.')); return; }
        var g = U.grid('sx-grid-5 sx-wi-grid');
        var o = optsFor(c, st, p);
        res.forEach(function (r) {
          var t = U.tile(c, '<img alt="">', (r.name || r.id).replace(/-/g, ' '), function () { addIcon(c, r.id, st, p); });
          t.setAttribute('data-lazy', r.id);
          t.classList.add('is-icon');
          t.draggable = true;
          t.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/x-le-el', JSON.stringify({ kind: 'wi', id: r.id })); e.dataTransfer.effectAllowed = 'copy'; });
          g.appendChild(t);
        });
        gridHost.appendChild(g);
        c.ui.lazy(g, function (n) { try { n.querySelector('img').src = iconUrl(n.getAttribute('data-lazy'), o); } catch (e) { n.remove(); } });
        gridHost.appendChild(U.note(c, res.length + (res.length >= 120 ? '+' : '') + ' icons · drag onto the page or click to add · recolour from the toolbar', 'is-muted'));
      }).catch(function () {
        gridHost.innerHTML = '';
        gridHost.appendChild(c.ui.empty('Could not load ' + st.name, 'This style is not on this device yet and you appear to be offline.', [{ label: 'Try again', fn: drawGrid }]));
      });
    }
    drawGrid();
  }
  function colorRow(c, host, st, p, done) {
    host.innerHTML = '';
    var C = COL();
    if (st.colorful) {
      var pals = palettesFor(st.id);
      var kit = C && C.kit ? C.kit() : { colors: [] };
      var head = c.h('<div class="sx-card-h"><span class="sx-eyebrow">Palette</span><small>' + pals.length + ' palettes</small></div>');
      host.appendChild(head);
      var row = c.h('<div class="sx-pal-row is-scroll"></div>');
      var activeCustom = p.custom[st.id] && p.custom[st.id].length;
      var curPal = p.pal[st.id] || st.defaultPalette;
      pals.forEach(function (pl) {
        var b = c.h('<button type="button" class="sx-ipal" aria-pressed="' + (!activeCustom && pl.id === curPal) + '" title="' + c.esc(pl.name) + '"><span class="sx-ipal-dots"></span><small>' + c.esc(pl.name) + '</small></button>');
        (pl.colors || []).slice(0, 5).forEach(function (col) { var i = document.createElement('i'); i.style.background = col; b.firstChild.appendChild(i); });
        b.onclick = function () { p.pal[st.id] = pl.id; delete p.custom[st.id]; savePrefs(c, p); done(); };
        row.appendChild(b);
      });
      if (kit.colors.length >= 2) {
        var kb = c.h('<button type="button" class="sx-ipal is-brand" aria-pressed="' + !!activeCustom + '" title="Your brand kit"><span class="sx-ipal-dots"></span><small>My brand</small></button>');
        kit.colors.slice(0, 5).forEach(function (col) { var i = document.createElement('i'); i.style.background = col; kb.firstChild.appendChild(i); });
        kb.onclick = function () { p.custom[st.id] = kit.colors.slice(0, 6); savePrefs(c, p); done(); };
        row.appendChild(kb);
      }
      host.appendChild(row);
      if (!pals.length) host.appendChild(U.note(c, 'This style uses its built-in colours.', 'is-muted'));
    } else {
      host.appendChild(c.h('<div class="sx-card-h"><span class="sx-eyebrow">Colour</span><small>Single-colour style</small></div>'));
      var sws = c.h('<div class="sx-sws"></div>');
      var picks = ['#17131f', '#ffffff', '#7457f0', '#e0668e', '#c99a45', '#0f766e', '#2563eb', '#ef4444'];
      var kitc = C && C.kit ? C.kit().colors : [];
      picks.concat(kitc.filter(function (x) { return picks.indexOf(x) < 0; }).slice(0, 6)).forEach(function (col) {
        sws.appendChild(C.swatch(c, col, col, C.hex6(p.color) === C.hex6(col), function () { p.color = col; savePrefs(c, p); done(); }));
      });
      var more = c.h('<button type="button" class="sx-sw is-add" aria-label="Custom colour">' + c.ic('plus') + '</button>');
      more.onclick = function () {
        c.colorPop(more, { value: p.color, alpha: false, title: st.name + ' colour', onChange: function (v) { p.color = v; savePrefs(c, p); } });
        var watch = new MutationObserver(function () { if (c.E.pop.hidden) { watch.disconnect(); done(); } });
        watch.observe(c.E.pop, { attributes: true, attributeFilter: ['hidden'] });
      };
      sws.appendChild(more);
      host.appendChild(sws);
    }
  }

  /* ---------- Offline packs ---------- */
  function offlineModal(c, list) {
    var body = c.openModal('Icon styles <em>offline</em>', '<div class="sx-wi-offline"><div class="sx-wi-off-top"></div><ol class="sx-wi-off-list"></ol></div>', { wide: true });
    var top = body.querySelector('.sx-wi-off-top'), ol = body.querySelector('.sx-wi-off-list');
    var canSave = has('saveStyleOffline');
    var total = list.reduce(function (a, s) { return a + (s.bytes || 0); }, 0);
    top.innerHTML = '<div class="sx-wi-usage"><span class="sx-eyebrow">On this device</span><strong>…</strong><small>All 34 styles: ' + c.fmtBytes(total) + '</small></div>';
    var all = c.h('<button type="button" class="btn btn-gold btn-sm">' + c.ic('download') + '<span>Save all styles</span></button>');
    var bar = c.h('<div class="sx-progress" hidden><i></i></div>');
    if (!canSave) all.disabled = true;
    all.onclick = function () {
      all.disabled = true;
      bar.hidden = false;
      all.querySelector('span').textContent = 'Saving…';
      Promise.resolve(LE.assets.saveStyleOffline('all', function (a, b) { var f = frac(a, b); if (f != null) { bar.querySelector('i').style.width = Math.round(f * 100) + '%'; all.querySelector('span').textContent = 'Saving ' + Math.round(f * 100) + '%'; } }))
        .then(function () { c.toast('All icon styles saved for offline use'); refresh(); })
        .catch(function () { c.toast('Could not save every style — check your storage space.'); })
        .then(function () { all.disabled = false; all.querySelector('span').textContent = 'Save all styles'; bar.hidden = true; });
    };
    top.appendChild(all);
    top.appendChild(bar);
    function refresh() {
      var usage = has('styleUsage') ? Promise.resolve(LE.assets.styleUsage()).catch(function () { return {}; }) : Promise.resolve({});
      usage.then(function (u) {
        u = u || {};
        var used = Object.keys(u).reduce(function (a, k) { return a + (u[k] || 0); }, 0);
        top.querySelector('.sx-wi-usage strong').textContent = c.fmtBytes(used) + ' saved';
        ol.innerHTML = '';
        list.forEach(function (s) {
          var bytes = u[s.id] || 0;
          var li = c.h('<li class="sx-wi-off-row"><span class="sx-wi-off-name"><b>' + c.esc(s.name) + '</b><small>' + c.esc(GROUPS.filter(function (g) { return g[0] === s.group; }).map(function (g) { return g[1]; })[0] || s.group || '') + ' · ' + c.fmtBytes(s.bytes || 0) + '</small></span></li>');
          var t = c.ui.toggle(bytes ? 'Saved' : 'Save for offline', !!bytes, function (on) {
            if (!canSave) return;
            var job = on ? LE.assets.saveStyleOffline(s.id) : LE.assets.removeStyleOffline(s.id);
            Promise.resolve(job).then(function () { c.toast(on ? s.name + ' saved for offline' : s.name + ' removed — ' + c.fmtBytes(bytes) + ' freed'); refresh(); }).catch(function () { c.toast('Storage action failed'); refresh(); });
          });
          t.classList.add('is-compact');
          if (!canSave) t.querySelector('input').disabled = true;
          li.appendChild(t);
          ol.appendChild(li);
        });
      });
    }
    refresh();
  }

  /* ---------- Toolbar: recolour & swap style ---------- */
  function regen(c, l, o, key) {
    var nm = iconName(l.assetId);
    if (!nm) return;
    var markup;
    try { markup = LE.assets.svg(l.assetId, o); } catch (e) { return; }
    if (!markup) return;
    c.patch(l.id, { svg: markup }, key);
    var map = side(c);
    map[l.id] = { style: nm.style, name: nm.name, palette: o.palette || '', color: o.color || null };
    if (o.colors) map[l.id].colors = o.colors.slice();
  }
  CMDS.iconColors = function (c, arg, el) {
    var l = c.one();
    if (!l || !iconName(l.assetId)) return;
    var nm = iconName(l.assetId);
    var C = COL();
    ready().then(function (list) {
      var st = styleById(list, nm.style) || { id: nm.style, name: nm.style, colorful: false };
      var perIcon = st.colorful && has('loadIconPalettes') ? Promise.resolve(LE.assets.loadIconPalettes(nm.name)).catch(function () { return []; }) : Promise.resolve([]);
      return Promise.all([loadStyle(st.id), perIcon]).then(function (r) { return { st: st, extra: r[1] || [] }; });
    }).then(function (got) {
      var st = got.st;
      var cur = side(c)[l.id] || {};
      var key = c.gesture();
      if (!st.colorful) {
        c.colorPop(el, { value: cur.color || MONO_DEFAULT, alpha: false, title: st.name + ' icon colour', onChange: function (v, k) { regen(c, c.L(l.id), { color: v }, k); } });
        return;
      }
      var pals = palettesFor(st.id);
      var seen = pals.map(function (x) { return x.id; });
      got.extra.forEach(function (x) { if (x && x.id && seen.indexOf(x.id) < 0 && x.colors && x.colors.length) { seen.push(x.id); pals.push(x); } });
      var colors = (cur.colors && cur.colors.slice()) || ((pals.filter(function (x) { return x.id === (cur.palette || st.defaultPalette); })[0] || pals[0] || { colors: [] }).colors || []).slice();
      var body = c.h('<div class="sx-icp"><span class="sx-eyebrow">Palettes</span><div class="sx-pal-row is-wrap"></div><span class="sx-eyebrow">Colours in this icon</span><div class="sx-sws sx-icp-slots"></div><div class="sx-icp-ed"></div></div>');
      var row = body.querySelector('.sx-pal-row');
      var kit = C.kit();
      var list = pals.slice();
      if (kit.colors.length >= 2) list.push({ id: '', name: 'My brand', colors: kit.colors.slice(0, 6) });
      list.forEach(function (pl) {
        var b = c.h('<button type="button" class="sx-ipal" aria-pressed="' + !!(pl.id && pl.id === (cur.palette || (!cur.colors && st.defaultPalette))) + '"><span class="sx-ipal-dots"></span><small>' + c.esc(pl.name) + '</small></button>');
        (pl.colors || []).slice(0, 5).forEach(function (col) { var i = document.createElement('i'); i.style.background = col; b.firstChild.appendChild(i); });
        b.onclick = function () {
          row.querySelectorAll('.sx-ipal').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          colors = (pl.colors || []).slice();
          regen(c, c.L(l.id), pl.id ? (pl.id === 'default' ? { palette: 'default' } : { palette: pl.id, colors: colors.slice() }) : { colors: colors }, key);
          key = c.gesture();
          slots();
        };
        row.appendChild(b);
      });
      var selI = 0;
      var ed = C.solidEditor(c, colors[0] || '#7457f0', { alpha: false, onInput: function (v, commit) {
        colors[selI] = v;
        var s = body.querySelectorAll('.sx-icp-slots .sx-sw i')[selI];
        if (s) s.style.background = v;
        row.querySelectorAll('.sx-ipal').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        regen(c, c.L(l.id), { colors: colors.slice() }, key);
        if (commit) key = c.gesture();
      } });
      body.querySelector('.sx-icp-ed').appendChild(ed);
      function slots() {
        var host = body.querySelector('.sx-icp-slots');
        host.innerHTML = '';
        colors.forEach(function (col, i) {
          host.appendChild(C.swatch(c, col, 'Colour ' + (i + 1), i === selI, function () { selI = i; ed.set(colors[i]); slots(); }));
        });
        if (!colors.length) host.appendChild(U.note(c, 'This style has fixed colours.', 'is-muted'));
      }
      slots();
      c.openPop(el, body, { title: st.name + ' colours', cls: 'is-color' });
    }).catch(function () { c.toast('Icon styles are not available offline yet.'); });
  };
  CMDS.swapStyle = function (c, arg, el) {
    var l = c.one();
    var nm = l && iconName(l.assetId);
    if (!nm) return;
    ready().then(function (list) {
      var body = c.h('<div class="sx-swap"><div class="sx-swap-grid" role="listbox" aria-label="Choose a style"></div></div>');
      var gridEl = body.querySelector('.sx-swap-grid');
      var p = prefs(c);
      list.forEach(function (s) {
        var b = c.h('<button type="button" class="sx-wi-style is-sm" role="option" aria-selected="' + (s.id === nm.style) + '"><span class="sx-wi-prev"><i class="sx-skel"></i></span><b>' + c.esc(s.name) + '</b></button>');
        b.onclick = function () {
          loadStyle(s.id).then(function () {
            var id = 'withicons:' + s.id + '/' + nm.name;
            var o = optsFor(c, s, p);
            var markup = LE.assets.svg(id, o);
            if (!markup) throw new Error('missing');
            c.patch(l.id, { assetId: id, svg: markup });
            var map = side(c);
            map[l.id] = { style: s.id, name: nm.name, palette: o.palette || '', color: o.color || null };
            if (o.colors) map[l.id].colors = o.colors;
            gridEl.querySelectorAll('.sx-wi-style').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
            nm = iconName(id);
            c.renderToolbar();
          }).catch(function () { c.toast(s.name + ' does not have “' + nm.name.replace(/-/g, ' ') + '”.'); });
        };
        gridEl.appendChild(b);
      });
      c.openPop(el, body, { title: 'Swap style · ' + nm.name.replace(/-/g, ' '), cls: 'is-swap' });
      var q = Promise.resolve();
      [].forEach.call(gridEl.children, function (b, i) {
        var s = list[i];
        q = q.then(function () {
          if (!body.isConnected) return;
          return loadStyle(s.id).then(function () {
            b.querySelector('.sx-wi-prev').innerHTML = '<img alt="" src="' + iconUrl('withicons:' + s.id + '/' + nm.name, optsFor(c, s, p)) + '">';
          }).catch(function () { b.querySelector('.sx-wi-prev').innerHTML = c.ic('cloudOff'); });
        });
      });
    }).catch(function () { c.toast('Icon styles are not available offline yet.'); });
  };
  CMDS.tintSticker = function (c, arg, el) {
    var l = c.one();
    if (!l || l.type !== 'svg') return;
    var C = COL();
    var body = c.h('<div class="sx-icp"><button type="button" class="btn btn-ghost btn-sm sx-block">' + c.ic('reset') + '<span>Original colours</span></button><span class="sx-eyebrow">Brand tints</span><div class="sx-sws"></div><div class="sx-icp-ed"></div></div>');
    body.querySelector('.btn').onclick = function () { c.patch(l.id, { color: null }); c.closePop(); };
    var key = c.gesture();
    var kit = C.kit().colors;
    var brand = (kit.length ? kit : []).concat(['#7457f0', '#c99a45', '#e0668e', '#0f766e', '#2563eb', '#17131f', '#ffffff']).filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 14);
    var ed = C.solidEditor(c, l.color || '#7457f0', { alpha: false, onInput: function (v, commit) { c.patch(l.id, { color: v }, key); if (commit) { c.addRecent(v); key = c.gesture(); } } });
    brand.forEach(function (col) { body.querySelector('.sx-sws').appendChild(C.swatch(c, col, col, l.color && C.hex6(l.color) === C.hex6(col), function () { ed.set(col); c.patch(l.id, { color: col }); })); });
    body.querySelector('.sx-icp-ed').appendChild(ed);
    body.appendChild(U.note(c, 'Tinting turns a sticker or emoji into a single brand colour. Original colours come back any time.', 'is-muted'));
    c.openPop(el, body, { title: 'Tint', cls: 'is-color' });
  };

  /* ---------- Search across styles & drag drop ---------- */
  P._withIconsSearch = function (c, host, q) {
    ready().then(function (list) {
      var p = prefs(c);
      var st = styleById(list, p.style) || list[0];
      return loadStyle(st.id).then(function () {
        var res = LE.assets.search(q, { set: 'withicons', style: st.id, limit: 48 }) || [];
        if (!res.length) { if (!host.children.length) host.appendChild(U.note(c, 'Nothing found for “' + q + '”. Try a simpler word like heart, star or arrow.')); return; }
        var g = U.grid('sx-grid-6');
        var o = optsFor(c, st, p);
        res.forEach(function (r) {
          var t = U.tile(c, '<img alt="">', (r.name || r.id).replace(/-/g, ' '), function () { addIcon(c, r.id, st, p); });
          t.setAttribute('data-lazy', r.id);
          t.classList.add('is-icon');
          g.appendChild(t);
        });
        var b = U.sec(c, host, 'Icons · ' + st.name);
        b.appendChild(g);
        host.insertBefore(b.parentNode, host.firstChild);
        c.ui.lazy(g, function (n) { try { n.querySelector('img').src = iconUrl(n.getAttribute('data-lazy'), o); } catch (e) { n.remove(); } });
      });
    }).catch(function () { if (!host.children.length) host.appendChild(U.note(c, 'Nothing found for “' + q + '”. Try a simpler word like heart, star or arrow.')); });
  };
  hook('drop', function (c, d) {
    if (!d.el) return false;
    var item;
    try { item = JSON.parse(d.el); } catch (e) { return false; }
    if (!item || item.kind !== 'wi') return false;
    ready().then(function (list) {
      var nm = iconName(item.id);
      var st = nm && styleById(list, nm.style);
      if (st) addIcon(c, item.id, st, prefs(c), d.at);
    });
    return true;
  });
})();
