/* LocalEditor PDF studio graphics library: stamps, withicons styles (style switcher, search, palettes, offline), stickers, emoji, images. Lives in the Add panel. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var PS = global.PS;
  if (!PS || !PS.panels || !PS.panels.convert) return;
  var d = document;
  var S = PS.S;
  var $ = PS.$, $$ = PS.$$, el = PS.el, esc = PS.esc, icon = PS.icon, say = PS.say;
  var ui = PS.ui;

  var GROUPS = [['all', 'All'], ['essentials', 'Essentials'], ['product', 'Product'], ['3d-glass', '3D & glass'], ['playful', 'Playful'], ['artistic', 'Artistic'], ['holidays', 'Holidays']];
  var SEEDS = 'check star heart home mail phone calendar user file lock gift bell camera map pin flag cloud sun moon coffee bike car rocket trophy'.split(' ');
  var LEGACY_SEEDS = {
    stickers: 'star heart arrow badge ribbon speech seal tape sparkle crown check banner',
    lucide: 'check x star heart arrow alert info phone mail map calendar clock pin flag thumbs',
    emoji: 'smile heart thumbs star fire check party clap warning eyes'
  };
  var PAGE = 60;
  var G = { src: null, style: 'line', group: 'all', palette: 'default', color: '#17131F', q: '', shown: PAGE, token: 0 };

  function hasWith() { return !!(LE.assets && typeof LE.assets.iconStyles === 'function' && typeof LE.assets.loadStyle === 'function'); }
  function fmtBytes(n) { return global.IT && IT.formatBytes ? IT.formatBytes(n) : Math.round(n / 1024) + ' KB'; }
  function nice(name) { return String(name || '').replace(/-/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); }); }
  function styles() { try { return LE.assets.iconStyles() || []; } catch (e) { return []; } }
  function styleOf(id) { var l = styles(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function iconOpts(meta) {
    var st = styleOf(meta.style);
    if (st && st.colorful) return meta.palette && meta.palette !== 'default' ? { palette: meta.palette } : {};
    return { color: meta.color || '#17131F' };
  }
  function svgFor(meta) { return LE.assets.svg(meta.assetId, iconOpts(meta)); }

  function armIcon(hit) {
    var meta = { assetId: hit.id, style: G.style, name: hit.name, palette: G.palette, color: G.color };
    var svg;
    try { svg = svgFor(meta); } catch (e) { say('That icon could not load. Try again.'); return; }
    PS.setTool('sticker', { svg: svg, meta: meta, name: nice(hit.name), ratio: 1, width: 64, keep: false });
    if (PS.isPhone()) PS.setSheet('closed');
    say((PS.isPhone() ? 'Tap' : 'Click') + ' a page to place ' + nice(hit.name));
  }

  /* ---------- context bar for placed withicons ---------- */

  function metaOf(l) { return (S.docTools._iconMeta || {})[l.id] || null; }
  function selectedIcons(s) { return s.ids.filter(function (id) { return metaOf(s.sc.layer(id) || {}); }); }
  function recolor(s, patch) {
    selectedIcons(s).forEach(function (id) {
      var m = metaOf(s.sc.layer(id));
      Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
      try { s.sc.update(id, { svg: svgFor(m) }, { coalesce: 'ctx-icon' }); } catch (e) {}
    });
    PS.markDirty();
  }
  function paletteEntries(styleId, iconName) {
    var out = [], seen = {};
    function add(list) {
      (list || []).forEach(function (p) {
        if (!p || !p.id || seen[p.id]) return;
        seen[p.id] = 1;
        out.push(p);
      });
    }
    try { add(LE.assets.iconPalettes(styleId)); } catch (e) {}
    if (iconName && iconName !== styleId) {
      try { add(LE.assets.iconPalettes(iconName)); } catch (e2) {}
    }
    return out;
  }
  function palettePop(anchor, styleId, cur, onPick, iconName) {
    var old = $('.ps-palpop');
    if (old) { old.remove(); if (old._anchor === anchor) return; }
    var pop = el('div', 'ps-palpop');
    pop._anchor = anchor;
    pop._icon = iconName || '';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-label', 'Icon palettes');
    function fill() {
      pop.innerHTML = '';
      paletteList(styleId, cur, function (id) { onPick(id); pop.remove(); }, iconName).forEach(function (n) { pop.appendChild(n); });
    }
    fill();
    d.body.appendChild(pop);
    if (iconName && LE.assets.loadIconPalettes) {
      LE.assets.loadIconPalettes(iconName).then(function () { if (pop.isConnected) fill(); }, function () {});
    }
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6;
    if (top + pop.offsetHeight > global.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.left = Math.round(Math.min(global.innerWidth - pop.offsetWidth - 8, Math.max(8, r.left))) + 'px';
    pop.style.top = Math.round(top) + 'px';
    function off(e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); d.removeEventListener('pointerdown', off, true); } }
    d.addEventListener('pointerdown', off, true);
  }
  function paletteList(styleId, cur, onPick, iconName) {
    var list = paletteEntries(styleId, iconName);
    return list.map(function (p) {
      var b = el('button', 'ps-pal' + (p.id === cur ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(p.id === cur));
      b.setAttribute('data-pal', p.id);
      b.title = p.name;
      var dots = '';
      (p.colors || []).slice(0, 5).forEach(function (c) { dots += '<i style="background:' + esc(c) + '"></i>'; });
      b.innerHTML = '<span class="ps-pal-dots">' + dots + '</span><span class="ps-pal-n">' + esc(p.name) + '</span>';
      b.addEventListener('click', function () { onPick(p.id); });
      return b;
    });
  }

  PS.graphics = {
    ctxFor: function (l) { return !!metaOf(l); },
    buildCtx: function (row, s) {
      var m = metaOf(s.layers[0]);
      var st = styleOf(m.style);
      row.appendChild(el('span', 'ps-ctx-label', esc(st ? st.name : 'Icon')));
      if (st && st.colorful) {
        var pb = el('button', 'ps-chip ps-chip-pal');
        pb.type = 'button';
        pb.setAttribute('aria-haspopup', 'listbox');
        pb.innerHTML = icon('palette') + '<span>Palette</span>';
        pb.addEventListener('click', function () {
          palettePop(pb, m.style, m.palette, function (id) { var cur = PS.activeScene() && { sc: PS.activeScene(), ids: PS.activeScene().selection() }; if (cur) recolor(cur, { palette: id }); }, m.name);
        });
        row.appendChild(pb);
      } else {
        var sw = ui.swatches(['#17131F', '#7457F0', '#2F6BFF', '#17A37A', '#E5484D', '#B8862F'], m.color || '#17131F', function (c) {
          var sc = PS.activeScene();
          if (sc) recolor({ sc: sc, ids: sc.selection() }, { color: c });
        }, true, { title: 'Icon colour' });
        sw.classList.add('is-compact');
        row.appendChild(sw);
      }
    },
    focus: function () {
      var p = PS.panels.convert;
      if (p._setMode) p._setMode('graphics');
      setTimeout(function () { var q = $('.ps-gfx-q'); if (q && !PS.isPhone()) q.focus({ preventScroll: true }); }, 240);
    }
  };

  /* ---------- Add panel: Graphics | Pages & files ---------- */

  var base = PS.panels.convert;
  var baseBuild = base.build, baseShow = base.show;
  base.title = 'Add';
  base.build = function (pane) {
    var self = this;
    var modes = ui.seg([['graphics', 'Graphics'], ['files', 'Pages & files']], 'graphics', function (v) { setMode(v); });
    modes.classList.add('ps-seg-full', 'ps-seg-top');
    pane.appendChild(modes);
    var gfx = el('div', 'ps-gfx');
    var files = el('div', 'ps-addfiles');
    files.hidden = true;
    pane.appendChild(gfx);
    pane.appendChild(files);
    baseBuild.call(self, files);
    function setMode(v) {
      modes.setValue(v);
      gfx.hidden = v !== 'graphics';
      files.hidden = v === 'graphics';
      if (v === 'graphics') ensure();
    }
    self._setMode = setMode;
    buildGraphics(gfx);
    var started = false;
    function ensure() { if (!started) { started = true; self._start(); } }
    self._ensure = ensure;
  };
  base.show = function () {
    if (baseShow) baseShow.call(this);
    var g = $('.ps-gfx');
    if (this._ensure && g && !g.hidden) this._ensure();
  };

  function buildGraphics(root) {
    var head = el('div', 'ps-gfx-head');
    var q = d.createElement('input');
    q.type = 'search';
    q.className = 'input ps-search ps-gfx-q';
    q.placeholder = 'Search icons, stickers and emoji';
    q.setAttribute('aria-label', 'Search icons, stickers and emoji');
    q.autocomplete = 'off';
    head.appendChild(q);
    var srcRow = el('div', 'ps-chips ps-gfx-src');
    srcRow.setAttribute('role', 'tablist');
    srcRow.setAttribute('aria-label', 'Graphic type');
    head.appendChild(srcRow);
    root.appendChild(head);

    var stampSec = ui.section('Stamps');
    var stamps = el('div', 'ps-stamps');
    PS.STAMPS.forEach(function (st) {
      var b = ui.btn('ps-stamp', '<span class="ps-stamp-art" data-asset="' + esc(st[0]) + '"><i class="ps-skel"></i></span><span>' + esc(st[1]) + '</span>', { 'aria-label': st[1] + ' stamp' });
      b.addEventListener('click', function () { PS.armSticker(st[0], st[1]); });
      stamps.appendChild(b);
    });
    stampSec.appendChild(stamps);
    root.appendChild(stampSec);

    var lib = ui.section('Icons');
    var libTitle = $('.ps-sec-title', lib);
    var styleBox = el('div', 'ps-gfx-styles');
    var groupRow = el('div', 'ps-chips ps-chips-scroll ps-gfx-groups');
    groupRow.setAttribute('role', 'radiogroup');
    groupRow.setAttribute('aria-label', 'Style group');
    var styleRow = el('div', 'ps-gfx-stylegrid');
    styleRow.setAttribute('role', 'radiogroup');
    styleRow.setAttribute('aria-label', 'Icon style');
    styleBox.appendChild(groupRow);
    styleBox.appendChild(styleRow);
    lib.appendChild(styleBox);
    var colorBox = el('div', 'ps-gfx-color');
    lib.appendChild(colorBox);
    var grid = el('div', 'ps-assets ps-gfx-grid');
    grid.setAttribute('aria-live', 'polite');
    lib.appendChild(grid);
    var more = ui.btn('btn btn-sm btn-ghost ps-gfx-more', 'Show more');
    more.hidden = true;
    lib.appendChild(more);
    root.appendChild(lib);

    var off = el('section', 'ps-card ps-offline');
    off.innerHTML = '<div class="ps-card-head"><span class="ps-card-ic">' + icon('cloud') + '</span><strong>Use offline</strong></div>';
    var offBody = el('div', 'ps-card-body');
    off.appendChild(offBody);
    root.appendChild(off);

    var imgSec = ui.section('Your images');
    var ibtn = ui.btn('btn btn-sm', icon('image') + 'Add an image');
    ibtn.addEventListener('click', function () { PS.pickFiles('image/*', false).then(function (f) { if (f[0]) PS.armImage(f[0]); }); });
    imgSec.appendChild(ibtn);
    imgSec.appendChild(el('p', 'ps-note', 'Logos, photos or a scanned stamp. You can also paste an image.'));
    root.appendChild(imgSec);

    var sources = [];
    function renderSources() {
      sources = [];
      if (hasWith()) sources.push(['withicons', 'Icons']);
      sources.push(['stickers', 'Stickers'], ['emoji', 'Emoji']);
      if (!hasWith()) sources.push(['lucide', 'Icons']);
      else sources.push(['lucide', 'Simple']);
      if (!G.src) G.src = sources[0][0];
      srcRow.innerHTML = '';
      sources.forEach(function (s) {
        var b = ui.btn('ps-chip', esc(s[1]), { role: 'tab', 'aria-selected': String(s[0] === G.src), 'aria-pressed': String(s[0] === G.src), 'data-src': s[0] });
        srcRow.appendChild(b);
      });
    }
    srcRow.addEventListener('click', function (e) {
      var b = e.target.closest('[data-src]');
      if (!b) return;
      G.src = b.getAttribute('data-src');
      $$('[data-src]', srcRow).forEach(function (x) { var on = x === b; x.setAttribute('aria-pressed', String(on)); x.setAttribute('aria-selected', String(on)); });
      G.shown = PAGE;
      layout();
      run();
    });

    function renderGroups() {
      groupRow.innerHTML = '';
      var have = {};
      styles().forEach(function (s) { have[s.group] = 1; });
      GROUPS.forEach(function (g) {
        if (g[0] !== 'all' && !have[g[0]]) return;
        groupRow.appendChild(ui.btn('ps-chip ps-chip-sm', esc(g[1]), { role: 'radio', 'aria-checked': String(g[0] === G.group), 'aria-pressed': String(g[0] === G.group), 'data-g': g[0] }));
      });
    }
    groupRow.addEventListener('click', function (e) {
      var b = e.target.closest('[data-g]');
      if (!b) return;
      G.group = b.getAttribute('data-g');
      $$('[data-g]', groupRow).forEach(function (x) { var on = x === b; x.setAttribute('aria-checked', String(on)); x.setAttribute('aria-pressed', String(on)); });
      renderStyles();
    });
    function renderStyles() {
      styleRow.innerHTML = '';
      styles().filter(function (s) { return G.group === 'all' || s.group === G.group; }).forEach(function (s) {
        var b = ui.btn('ps-style', '<span class="ps-style-art" aria-hidden="true"></span><span class="ps-style-n">' + esc(s.name) + '</span>' + (s.offline ? '<i class="ps-style-off" title="Saved offline"></i>' : ''), {
          role: 'radio', 'aria-checked': String(s.id === G.style), 'data-style': s.id, title: s.name + (s.description ? ' · ' + s.description : '') + ' · ' + s.count + ' icons · ' + fmtBytes(s.bytes)
        });
        styleRow.appendChild(b);
        if (s.loaded) previewStyle(b, s.id);
        else stubStyle(b, s);
      });
      var on = $('[aria-checked="true"]', styleRow);
      if (on && on.scrollIntoView) { var r = styleRow; r.scrollLeft = Math.max(0, on.offsetLeft - r.clientWidth / 2 + on.offsetWidth / 2); }
    }
    function stubStyle(b, s) {
      var art = $('.ps-style-art', b);
      if (!art) return;
      var cols = [];
      try {
        var pals = LE.assets.iconPalettes(s.id) || [];
        var p = pals.filter(function (x) { return x.id === (s.defaultPalette || 'default'); })[0] || pals[0];
        cols = (p && p.colors || []).filter(function (c) { return /^#[0-9a-f]{3,8}$/i.test(c); }).slice(0, 4);
      } catch (e) { cols = []; }
      if (s.colorful && cols.length) {
        art.classList.add('is-dots');
        cols.forEach(function (c) { var i = d.createElement('i'); i.style.background = c; art.appendChild(i); });
      } else {
        art.classList.add('is-stub');
        art.innerHTML = PS.icon('star');
      }
    }
    function previewStyle(b, id) {
      var art = $('.ps-style-art', b);
      if (!art || art._done) return;
      art.classList.remove('is-dots', 'is-stub');
      art.innerHTML = '';
      try {
        var st = styleOf(id);
        art.innerHTML = LE.assets.svg('withicons:' + id + '/star', st && st.colorful ? {} : { color: 'currentColor' });
        art._done = true;
      } catch (e) {}
    }
    styleRow.addEventListener('click', function (e) {
      var b = e.target.closest('[data-style]');
      if (!b) return;
      G.style = b.getAttribute('data-style');
      G.palette = 'default';
      G.shown = PAGE;
      $$('[data-style]', styleRow).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      renderColor();
      run();
      renderOffline();
      placeholder();
    });

    function renderColor() {
      colorBox.innerHTML = '';
      if (G.src === 'emoji' || G.src === 'stickers') return;
      var st = G.src === 'withicons' ? styleOf(G.style) : null;
      if (st && st.colorful) {
        colorBox.appendChild(el('div', 'ps-eyebrow', 'Palette'));
        var row = el('div', 'ps-pals');
        paletteList(G.style, G.palette, function (id) {
          G.palette = id;
          $$('.ps-pal', row).forEach(function (x) { var on = x.getAttribute('data-pal') === id; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); });
          repaint();
        }).forEach(function (n) { row.appendChild(n); });
        colorBox.appendChild(row);
      } else {
        colorBox.appendChild(el('div', 'ps-eyebrow', 'Colour'));
        colorBox.appendChild(ui.swatches(['#17131F', '#7457F0', '#2F6BFF', '#17A37A', '#E5484D', '#B8862F', '#E0668E'], G.color, function (c) { G.color = c; repaint(); }, true, { title: 'Icon colour' }));
      }
    }

    function tileFor(hit) {
      var b = ui.btn('ps-asset', '', { 'aria-label': nice(hit.name), title: nice(hit.name), 'data-id': hit.id });
      b._hit = hit;
      paintTile(b);
      b.addEventListener('click', function () {
        if (hit.set === 'withicons') armIcon(hit);
        else PS.armSticker(hit.id, nice(hit.name));
      });
      return b;
    }
    function paintTile(b) {
      var hit = b._hit;
      try {
        if (hit.set === 'withicons') b.innerHTML = svgFor({ assetId: hit.id, style: G.style, palette: G.palette, color: G.color });
        else b.innerHTML = LE.assets.svg(hit.id, { color: hit.set === 'lucide' || hit.set === 'phosphor' ? G.color : undefined });
      } catch (e) { b.innerHTML = ''; }
    }
    function repaint() { $$('.ps-asset', grid).forEach(paintTile); }
    function skeleton(n) {
      grid.innerHTML = '';
      for (var i = 0; i < n; i++) grid.appendChild(el('i', 'ps-asset ps-skel'));
    }
    var timer = 0;
    function run() {
      clearTimeout(timer);
      timer = setTimeout(go, 140);
    }
    function go() {
      var token = ++G.token;
      var term = q.value.trim().toLowerCase();
      var src = G.src;
      skeleton(18);
      more.hidden = true;
      var ready = src === 'withicons' ? LE.assets.load('withicons').then(function () { return LE.assets.loadStyle(G.style); }) : LE.assets.load(src);
      ready.then(function () {
        if (token !== G.token) return;
        var hits = [], seen = {};
        var opts = { set: src, limit: term ? 400 : 8 };
        if (src === 'withicons') opts.style = G.style;
        (term ? [term] : (src === 'withicons' ? SEEDS : LEGACY_SEEDS[src].split(' '))).forEach(function (t) {
          LE.assets.search(t, opts).forEach(function (h) { if (!seen[h.id]) { seen[h.id] = 1; hits.push(h); } });
        });
        grid.innerHTML = '';
        libTitle.innerHTML = esc(src === 'withicons' ? 'Icons' : src === 'emoji' ? 'Emoji' : src === 'stickers' ? 'Stickers' : 'Simple icons') + '<small>' + (term ? hits.length + ' found' : 'tap one, then a page') + '</small>';
        if (!hits.length) { grid.appendChild(el('p', 'ps-note ps-gfx-empty', 'Nothing found for “' + esc(term) + '”. Try a simpler word like “star” or “mail”.')); return; }
        var frag = d.createDocumentFragment();
        hits.slice(0, G.shown).forEach(function (h) { frag.appendChild(tileFor(h)); });
        grid.appendChild(frag);
        more.hidden = hits.length <= G.shown;
        more.textContent = 'Show ' + Math.min(PAGE, hits.length - G.shown) + ' more';
        if (src === 'withicons') {
          var b = $('[data-style="' + G.style + '"]', styleRow);
          if (b) previewStyle(b, G.style);
        }
      }).catch(function () {
        if (token !== G.token) return;
        grid.innerHTML = '<p class="ps-note ps-gfx-empty">These graphics could not load. Connect once and they work offline after that.</p>';
      });
    }
    more.addEventListener('click', function () { G.shown += PAGE; go(); });
    q.addEventListener('input', function () { G.shown = PAGE; run(); });

    function renderOffline() {
      offBody.innerHTML = '';
      if (!hasWith() || G.src !== 'withicons') {
        offBody.appendChild(el('p', 'ps-note', 'Stamps, stickers and emoji you open are kept on this device, so they work without a connection.'));
        return;
      }
      var st = styleOf(G.style);
      if (!st) return;
      var line = el('div', 'ps-offline-row');
      var txt = el('div', 'ps-offline-t', '<strong>' + esc(st.name) + '</strong><small>' + st.count + ' icons · ' + fmtBytes(st.bytes) + '</small>');
      line.appendChild(txt);
      var act = ui.btn('btn btn-sm', 'Checking…');
      act.disabled = true;
      line.appendChild(act);
      offBody.appendChild(line);
      LE.assets.isStyleOffline(st.id).then(function (on) {
        act.disabled = false;
        if (on) {
          act.className = 'btn btn-sm btn-ghost';
          act.innerHTML = icon('trash') + 'Free space';
          txt.querySelector('small').textContent = 'Saved for offline · ' + fmtBytes(st.bytes);
          act.onclick = function () { LE.assets.removeStyleOffline(st.id).then(function () { say(st.name + ' removed from this device'); renderOffline(); renderStyles(); }); };
        } else {
          act.className = 'btn btn-sm';
          act.innerHTML = icon('download') + 'Save style';
          act.onclick = function () {
            act.disabled = true;
            act.textContent = 'Saving…';
            LE.assets.saveStyleOffline(st.id).then(function () { say(st.name + ' saved for offline use'); renderOffline(); renderStyles(); }, function () { say('Could not save. Check the connection.'); renderOffline(); });
          };
        }
      });
      var total = 0;
      styles().forEach(function (s) { total += s.bytes || 0; });
      var all = el('div', 'ps-offline-row');
      var usage = el('div', 'ps-offline-t', '<strong>All 34 styles</strong><small>' + fmtBytes(total) + ' in total</small>');
      all.appendChild(usage);
      var allBtn = ui.btn('btn btn-sm btn-ghost', icon('cloud') + 'Save all');
      allBtn.addEventListener('click', function () {
        PS.dialog({ title: 'Save every icon style?', text: 'This keeps all 34 styles on this device (' + fmtBytes(total) + ') so they work with no connection. You can free the space again at any time.', ok: 'Save all' }).then(function (ok) {
          if (!ok) return;
          var pr = PS.progress('Saving icon styles for offline', false);
          LE.assets.saveStyleOffline('all', function (p) { try { pr.set(p.loaded, p.total, nice(p.style) + ' · ' + fmtBytes(p.bytes) + ' of ' + fmtBytes(p.totalBytes)); } catch (e) {} })
            .then(function () { pr.end(); say('All icon styles are saved offline'); renderOffline(); renderStyles(); }, function () { pr.end(); say('Saving stopped. Check the connection and try again.'); renderOffline(); });
        });
      });
      all.appendChild(allBtn);
      offBody.appendChild(all);
      LE.assets.styleUsage().then(function (u) {
        var used = 0, n = 0;
        Object.keys(u || {}).forEach(function (k) { used += u[k]; n++; });
        if (n) usage.querySelector('small').textContent = n + ' saved · ' + fmtBytes(used) + ' of ' + fmtBytes(total) + ' used';
      });
    }

    function layout() {
      var w = G.src === 'withicons';
      styleBox.hidden = !w;
      renderColor();
      renderOffline();
      placeholder();
    }
    function placeholder() {
      var st = styleOf(G.style) || {};
      q.placeholder = G.src === 'withicons' ? 'Search ' + (st.count ? st.count.toLocaleString() + ' ' : '') + 'icons in ' + (st.name || 'this style') : G.src === 'emoji' ? 'Search emoji' : G.src === 'stickers' ? 'Search stickers' : 'Search icons';
    }

    PS.panels.convert._start = function () {
      var p = hasWith() ? LE.assets.load('withicons').catch(function () {}) : Promise.resolve();
      skeleton(18);
      p.then(function () {
        renderSources();
        if (hasWith()) { renderGroups(); renderStyles(); }
        layout();
        run();
      });
      LE.assets.load('stickers').then(function () {
        $$('[data-asset]', stamps).forEach(function (s) { try { s.innerHTML = LE.assets.svg(s.getAttribute('data-asset')); } catch (e) {} });
      }).catch(function () {});
    };
  }
})(window);
