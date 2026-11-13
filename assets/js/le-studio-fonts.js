/* LocalEditor: the studio font picker and font upkeep (roadmap F1). See docs/FONTS.md.
   - Replaces P.fonts from le-studio-panels.js: search, Style / Feel / Language filters, Recent, Favourites,
     In this design, Saved on this device, LocalEditor originals; a virtual list whose rows show each family's
     name in its own typeface from tiny preview subsets; live preview on the selected text; weight slider for
     variable fonts; "Goes well with"; Save for offline per font, per collection or everything.
   - Hooks: loads only the script slices each text layer needs, and sets letters a font lacks in a library font
     for that script (told once) instead of drawing boxes. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = P._hooks = P._hooks || {};
  var ROW = 56;
  var OVERSCAN = 6;
  var state = { style: '', feel: '', script: '', view: 'all', q: '', scroll: 0, intent: '' };
  var pv = null;
  var told = {};
  var offlineSet = null;
  var unsub = null;

  function fonts() { return window.LE && window.LE.fonts; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function textIds(c) { return c.sel().filter(function (id) { var x = c.L(id); return x && x.type === 'text'; }); }
  function redraw(c) {
    var s = c && c.scene;
    if (!s) return;
    s._textCache = {};
    s._fontEpoch = (s._fontEpoch || 0) + 1;
    if (typeof s._mark === 'function') s._mark();
  }
  function label(kind, id) { var L = fonts().labels[kind] || {}; return L[id] || id; }
  function nearest(list, w) { return (list || [400]).reduce(function (a, b) { return Math.abs(b - w) < Math.abs(a - w) ? b : a; }, (list || [400])[0]); }
  function weightFor(f, w) {
    w = Number(w) || 400;
    if (!f) return w;
    if (f.wght) return Math.max(f.wght[0], Math.min(f.wght[1], w));
    return nearest(f.weights, w);
  }

  /* Text layers of every page: [{ font, weight, italic, text }] */
  function designText(c) {
    var out = [];
    var p = c.S && c.S.project;
    var pages = p && p.pages ? p.pages.map(function (pg, i) { return i === p.activePage ? c.doc() : pg; }) : [c.doc()];
    function walk(layers) {
      (layers || []).forEach(function (l) {
        if (l.type === 'text') out.push({ font: l.font, weight: l.weight || 400, italic: !!l.italic, text: l.uppercase ? String(l.text || '').toUpperCase() : String(l.text || '') });
        if (l.layers) walk(l.layers);
      });
    }
    pages.forEach(function (d) { if (d) walk(d.layers); });
    return out;
  }
  function designFamilies(c) {
    var seen = [];
    designText(c).forEach(function (t) { if (t.font && seen.indexOf(t.font) < 0 && fonts().find(t.font)) seen.push(t.font); });
    return seen;
  }

  /* ---------- Upkeep: script slices and missing letters ---------- */
  var prepTimer = 0;
  function prepareAll(c) {
    var FX = fonts();
    if (!FX || !FX.prepare || !c || !c.doc) return;
    clearTimeout(prepTimer);
    prepTimer = setTimeout(function () {
      var items = designText(c).filter(function (t) { return t.text && t.font; });
      Promise.all(items.map(function (t) {
        return FX.prepare(t.font, t.text, { weight: t.weight, italic: t.italic }).catch(function () { return null; });
      })).then(function (res) {
        res.forEach(function (r) {
          if (!r) return;
          r.fallbacks.forEach(function (fb) {
            var k = r.family + '|' + fb.script;
            if (told[k]) return;
            told[k] = 1;
            var sc = label('script', fb.script);
            c.toast(fb.available ? r.family + ' has no ' + sc + ' letters, so they are set in ' + fb.family + '.'
              : sc + ' letters need ' + fb.family + ', which is not included in this copy of LocalEditor.');
          });
        });
      });
    }, 160);
  }
  /* Download policy (docs/DOWNLOADS.md): fonts used in a saved design are kept offline automatically in the default
     mode; in "Always ask first" mode LE.downloads asks once (remembered) before the first one is kept. */
  var keepTimer = 0;
  function request(id, name, bytes, reason) {
    var D = window.LE && window.LE.downloads;
    if (D && typeof D.request === 'function') return Promise.resolve(D.request({ id: id, name: name, bytes: bytes, kind: 'font', reason: reason })).then(function (r) { return !!(r && r.ok); }, function () { return false; });
    /* No download manager on this page: no question at 60 MB or less, ask once above (remembered). */
    if (bytes <= 60 * 1048576) return Promise.resolve(true);
    var key = 'le-fonts-asked-' + id;
    try { if (localStorage.getItem(key)) return Promise.resolve(localStorage.getItem(key) === 'yes'); } catch (e) { /* private mode */ }
    var yes = window.confirm('Download ' + name + ' (' + Math.round(bytes / 1048576) + ' MB) for offline use?');
    try { localStorage.setItem(key, yes ? 'yes' : 'no'); } catch (e) { /* private mode */ }
    return Promise.resolve(yes);
  }
  function keepDesignFonts(c) {
    var FX = fonts();
    if (!FX || !FX.keep || !window.caches || !c || !c.S || !c.S.project) return;
    clearTimeout(keepTimer);
    keepTimer = setTimeout(function () {
      var fams = designFamilies(c);
      if (!fams.length) return;
      request('fonts-design', 'Fonts of your designs', 0, 'So saved designs open with their fonts when you are offline').then(function (ok) { if (ok) FX.keep(fams); });
    }, 2500);
  }
  var redrawTimer = 0;
  function onFontsEvent(c, type) {
    if (type === 'loaded') { clearTimeout(redrawTimer); redrawTimer = setTimeout(function () { redraw(c); }, 30); }
    if (type === 'saved' || type === 'removed') offlineSet = null;
  }

  (H.init = H.init || []).push(function (c) {
    if (!fonts()) return;
    if (unsub) unsub();
    unsub = fonts().on(function (type) { onFontsEvent(c, type); });
    prepareAll(c);
  });
  ['change', 'page', 'history'].forEach(function (name) {
    (H[name] = H[name] || []).push(function (c) { prepareAll(c); keepDesignFonts(c); });
  });
  (H.select = H.select || []).push(function (c) { cancelPreview(c); });
  (H['panel-close'] = H['panel-close'] || []).push(function (c) { cancelPreview(c); });
  (H.escape = H.escape || []).push(function (c) { if (pv) { cancelPreview(c); return true; } });

  /* ---------- Live preview (no history until committed) ---------- */
  function previewFont(c, fam) {
    var FX = fonts();
    var ids = textIds(c);
    if (!ids.length || !c.scene._find) return false;
    if (!pv) {
      pv = { orig: ids.map(function (id) { var l = c.scene._find(id); return l ? { l: l, font: l.font, weight: l.weight, italic: l.italic } : null; }).filter(Boolean) };
    }
    if (!pv.orig.length) { pv = null; return false; }
    pv.fam = fam;
    var f = FX.find(fam);
    pv.orig.forEach(function (o) { o.l.font = fam; o.l.weight = weightFor(f, o.weight); o.l.italic = !!(o.italic && f && f.italic); });
    FX.load(fam, { weights: [weightFor(f, pv.orig[0].weight)], italic: pv.orig[0].l.italic, text: pv.orig.map(function (o) { return o.l.text; }).join(' ') }).then(function () { if (pv && pv.fam === fam) redraw(c); }, function () {});
    redraw(c);
    return true;
  }
  function cancelPreview(c) {
    if (!pv) return;
    pv.orig.forEach(function (o) { o.l.font = o.font; o.l.weight = o.weight; o.l.italic = o.italic; });
    pv = null;
    redraw(c);
    var bar = document.querySelector('.sf-pvbar');
    if (bar) bar.hidden = true;
  }

  function apply(c, fam) {
    var FX = fonts();
    cancelPreview(c);
    var f = FX.find(fam);
    if (!f) return;
    if (f.cjk) {
      FX.cjkAvailable().then(function (ok) { if (ok.indexOf(f.slug) < 0) c.toast(fam + ' is not included in this copy of LocalEditor.'); });
    }
    var ids = textIds(c);
    if (!ids.length) {
      var id = c.addText({ text: fam, font: fam, weight: weightFor(f, 700), size: 90 });
      if (id) c.scene.select([id]);
    } else {
      ids.forEach(function (id) {
        var x = c.L(id);
        c.patch(id, { font: fam, weight: weightFor(f, x.weight || 400), italic: !!(x.italic && f.italic) });
      });
    }
    FX.touch(fam);
    FX.load(fam, { weights: [400], text: fam }).catch(function (err) {
      if (!navigator.onLine) c.toast(fam + ' is not saved on this device yet. It will appear when you are online.');
      else if (!err || err.code !== 'not-available') c.toast(fam + ' could not be loaded.');
    });
    state.scroll = c.E.panelBody.scrollTop;
    c.renderPanel(true);
  }

  /* ---------- Offline state ---------- */
  function offline() {
    if (offlineSet) return offlineSet;
    offlineSet = fonts().usage().then(function (list) {
      var s = {};
      list.forEach(function (u) { if (u.offline) s[u.family] = u; });
      return s;
    }).catch(function () { return {}; });
    return offlineSet;
  }
  function saveTarget(c, target, btn, done) {
    var FX = fonts();
    if (!window.caches) { c.toast('This browser cannot keep fonts for offline use.'); return; }
    if (typeof target === 'string' && FX.find(target)) { run(); return; }
    /* A collection or everything: one question at most, through the shared download policy. */
    Promise.resolve(FX.sizeOf(target)).then(function (bytes) {
      var name = target === 'all' ? 'All fonts' : Array.isArray(target) ? 'These fonts' : ((FX.collections().filter(function (x) { return x.id === target; })[0] || {}).name || 'Fonts') + ' fonts';
      return request('fonts-' + (Array.isArray(target) ? 'set' : target), name, bytes, 'Fonts that work with no connection');
    }).then(function (ok) { if (ok) run(); });
    function run() { save(c, target, btn, done); }
  }
  function save(c, target, btn, done) {
    var FX = fonts();
    btn.disabled = true;
    var was = btn.textContent;
    FX.saveOffline(target, function (p) {
      btn.textContent = 'Saving… ' + Math.round(100 * p.loaded / Math.max(1, p.total)) + '%';
    }, { track: true }).then(function (r) {
      offlineSet = null;
      c.toast(r.families.length === 1 ? r.families[0] + ' is saved on this device.' : r.families.length + ' fonts are saved on this device.');
      if (done) done(); else c.renderPanel(true);
    }, function () {
      btn.disabled = false;
      btn.textContent = was;
      c.toast(navigator.onLine ? 'Saving fonts failed. There may not be enough space.' : 'Connect to the internet to save fonts for offline use.');
    });
  }
  function removeTarget(c, target) {
    fonts().removeOffline(target).then(function () {
      offlineSet = null;
      c.toast('Removed from this device.');
      c.renderPanel(true);
    });
  }

  /* ---------- Rows ---------- */
  function metaLine(f) {
    if (f.source === 'localeditor' && f.description) return f.description;
    var bits = [label('style', f.style)];
    if (f.wght) bits.push('Variable');
    else bits.push(f.weights.length === 1 ? '1 weight' : f.weights.length + ' weights');
    var sc = (f.scripts || []).filter(function (s) { return s !== 'latin'; });
    if (f.scripts && f.scripts[0] !== 'latin') bits.push(label('script', f.scripts[0]));
    else if (sc.length) bits.push('+' + sc.length + ' scripts');
    return bits.join(' · ');
  }
  function paintName(el, fam) {
    fonts().preview(fam).then(function (cssName) {
      el.style.fontFamily = cssName + ', var(--font-ui, system-ui), sans-serif';
      el.classList.add('is-ready');
    }, function () { el.classList.add('is-ready'); });
  }

  /* ---------- The panel ---------- */
  function render(c, body) {
    var FX = fonts();
    if (!FX || !FX.ready) { body.appendChild(c.ui.empty('Fonts are not available', 'Reload the page to try again.')); return; }
    var root = c.h('<div class="sf"></div>');
    body.appendChild(root);
    /* The same stand-in as a deferred panel (docs/LOADING.md): the list's shape while it loads, plain words and Try again if it cannot. */
    var loading = c.h('<div class="le-load-wait" role="status" aria-busy="true"><span class="skel skel-row"></span><span class="skel skel-cards"></span><p class="sx-note le-load-msg">Loading fonts…</p></div>');
    root.appendChild(loading);
    FX.ready().then(function () {
      loading.remove();
      build(c, root, body);
    }, function () {
      loading.remove();
      var box = c.h('<div class="le-load-error" role="alert"></div>');
      box.appendChild(c.ui.empty('The font list could not open', navigator.onLine === false ? 'You are offline and the font list is not on this device yet. Connect and try again. Fonts already in your design still work.' : 'It did not download. Check your connection and try again.'));
      var b = c.h('<button type="button" class="btn btn-ghost btn-sm le-load-retry">Try again</button>');
      b.onclick = function () { root.remove(); render(c, body); };
      box.appendChild(b);
      root.appendChild(box);
    });
  }

  function build(c, root, body) {
    var FX = fonts();
    var l = c.one();
    var cur = l && l.type === 'text' ? FX.find(l.font) : null;
    if (l && l.type === 'text') root.appendChild(currentCard(c, l, cur));

    /* Search and filters */
    var bar = c.h('<div class="sf-bar sx-sticky"></div>');
    var all = FX.list();
    bar.innerHTML = '<label class="sf-search"><span class="sr-only">Search fonts</span><input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Search ' + all.length + ' fonts" value="' + esc(state.q) + '"></label>' +
      '<div class="sf-filters">' + select('style', 'Style', 'Style', FX.labels.style) + select('feel', 'Feel', 'Feel', FX.labels.feel) + select('script', 'Language', 'Language', scriptsInLibrary(FX)) + '</div>' +
      '<div class="sf-views sx-chips is-scroll" role="group" aria-label="Show"></div>';
    root.appendChild(bar);
    var views = [['all', 'All'], ['recent', 'Recent'], ['favourites', 'Favourites'], ['design', 'In this design'], ['saved', 'Saved on this device']];
    if (FX.list({ source: 'localeditor' }).length) views.push(['originals', 'LocalEditor originals']);
    var vbox = bar.querySelector('.sf-views');
    views.forEach(function (v) {
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (state.view === v[0]) + '" data-view="' + v[0] + '">' + esc(v[1]) + '</button>');
      b.onclick = function () { state.view = v[0]; vbox.querySelectorAll('.sx-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); state.scroll = 0; draw(); };
      vbox.appendChild(b);
    });
    var input = bar.querySelector('input');
    var t = 0;
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.q = input.value; state.scroll = 0; draw(); }, 90); });
    bar.querySelectorAll('select').forEach(function (s) {
      s.value = state[s.name] || '';
      s.onchange = function () { state[s.name] = s.value; state.scroll = 0; draw(); };
    });

    var count = c.h('<p class="sf-count" aria-live="polite"></p>');
    root.appendChild(count);
    var extra = c.h('<div class="sf-extra"></div>');
    root.appendChild(extra);
    var listEl = c.h('<div class="sf-list" role="list"></div>');
    root.appendChild(listEl);
    var pvbar = c.h('<div class="sf-pvbar" hidden><span></span><button type="button" class="btn btn-sm" data-x>Cancel</button><button type="button" class="btn btn-ink btn-sm" data-use>Use font</button></div>');
    root.appendChild(pvbar);
    pvbar.querySelector('[data-x]').onclick = function () { cancelPreview(c); pvbar.hidden = true; };
    pvbar.querySelector('[data-use]').onclick = function () { if (pv) apply(c, pv.fam); };

    var rows = [];
    var shown = {};
    var favs = FX.favourites();
    var lastPointer = window.matchMedia && matchMedia('(hover: none)').matches ? 'touch' : 'mouse';
    var hoverT = 0;
    var scroller = c.E.panelBody;

    function filtered() {
      var f = { style: state.style || undefined, feel: state.feel || undefined, script: state.script || undefined, q: state.q || undefined };
      if (state.view === 'recent') return FX.recent().map(function (n) { return FX.list({ families: [n] })[0]; }).filter(Boolean).filter(matcher(f));
      if (state.view === 'favourites') f.favourites = true;
      if (state.view === 'originals') { f.source = 'localeditor'; if (state.intent) f.intent = state.intent; }
      if (state.view === 'design') f.families = designFamilies(c);
      var res = state.q ? FX.search(state.q).filter(matcher(f)) : FX.list(f);
      return res;
    }
    function matcher(f) {
      var keep = FX.list(Object.assign({}, f, { families: f.families })).map(function (x) { return x.family; });
      return function (x) { return keep.indexOf(x.family) >= 0; };
    }
    function draw() {
      extra.innerHTML = '';
      if (state.view === 'originals') {
        /* The four intents the originals were drawn for. */
        var chips = c.h('<div class="sx-chips is-scroll sf-intents" role="group" aria-label="Made for"></div>');
        [['', 'All'], ['attention', 'Attention'], ['trust', 'Trust'], ['positive', 'Positive feeling'], ['tension', 'Tension']].forEach(function (it) {
          var b = c.h('<button type="button" class="sx-chip" data-intent="' + it[0] + '" aria-pressed="' + ((state.intent || '') === it[0]) + '">' + esc(it[1]) + '</button>');
          b.onclick = function () { state.intent = it[0]; state.scroll = 0; draw(); };
          chips.appendChild(b);
        });
        extra.appendChild(chips);
      }
      if (state.view === 'saved') {
        offline().then(function (set) {
          rows = filtered().filter(function (x) { return set[x.family]; });
          savedPanel(c, extra, set);
          paint();
        });
        return;
      }
      rows = filtered();
      paint();
    }
    function paint() {
      favs = FX.favourites();
      count.textContent = rows.length === 1 ? '1 font' : rows.length + ' fonts';
      listEl.innerHTML = '';
      shown = {};
      listEl.style.height = (rows.length * ROW) + 'px';
      if (!rows.length) {
        listEl.style.height = 'auto';
        var msg = state.view === 'favourites' ? 'Tap the star next to a font to keep it here.' : state.view === 'recent' ? 'Fonts you use appear here.' :
          state.view === 'design' ? 'This design has no text yet.' : state.view === 'saved' ? 'No fonts are saved on this device yet.' : 'No fonts match. Try fewer words or another filter.';
        listEl.appendChild(c.h('<p class="sf-note">' + esc(msg) + '</p>'));
      }
      requestAnimationFrame(function () {
        if (state.scroll) { scroller.scrollTop = state.scroll; state.scroll = 0; }
        update();
      });
    }
    function rowNode(f, i) {
      var on = cur && cur.family === f.family;
      var fav = favs.indexOf(f.family) >= 0;
      var n = c.h('<div class="sf-row' + (on ? ' is-on' : '') + '" role="listitem" style="top:' + (i * ROW) + 'px">' +
        '<button type="button" class="sf-pick" data-fam="' + esc(f.family) + '"' + (on ? ' aria-current="true"' : '') + '><span class="sf-name">' + esc(f.family) + '</span><small>' + esc(metaLine(f)) + '</small></button>' +
        '<span class="sf-saved" hidden title="Saved on this device">' + c.ic('check') + '</span>' +
        '<button type="button" class="sf-fav" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Remove ' : 'Add ') + esc(f.family) + (fav ? ' from' : ' to') + ' favourites">' + star(fav) + '</button></div>');
      var pick = n.querySelector('.sf-pick');
      pick.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse' || lastPointer !== 'mouse') return;
        clearTimeout(hoverT);
        hoverT = setTimeout(function () { if (previewFont(c, f.family)) pvbar.hidden = true; }, 140);
      });
      pick.onclick = function () {
        if (lastPointer !== 'mouse' && textIds(c).length && !(pv && pv.fam === f.family)) {
          if (previewFont(c, f.family)) {
            pvbar.hidden = false;
            pvbar.querySelector('span').textContent = 'Previewing ' + f.family;
            return;
          }
        }
        apply(c, f.family);
      };
      n.querySelector('.sf-fav').onclick = function (e) {
        var b = e.currentTarget;
        var now = b.getAttribute('aria-pressed') !== 'true';
        FX.setFavourite(f.family, now);
        b.setAttribute('aria-pressed', String(now));
        b.innerHTML = star(now);
        b.setAttribute('aria-label', (now ? 'Remove ' : 'Add ') + f.family + (now ? ' from' : ' to') + ' favourites');
      };
      paintName(n.querySelector('.sf-name'), f.family);
      offline().then(function (set) { if (set[f.family]) n.querySelector('.sf-saved').hidden = false; });
      return n;
    }
    function update() {
      if (!listEl.isConnected || !rows.length) return;
      var sb = scroller.getBoundingClientRect();
      var lb = listEl.getBoundingClientRect();
      var top = sb.top - lb.top;
      var first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
      /* The list may start below the visible part of a phone sheet: keep the first rows ready for the first scroll. */
      var last = Math.min(rows.length - 1, Math.max(Math.ceil((top + sb.height) / ROW) + OVERSCAN, first + 11));
      Object.keys(shown).forEach(function (k) {
        var i = Number(k);
        if (i < first || i > last) { shown[k].remove(); delete shown[k]; }
      });
      for (var i = first; i <= last; i++) {
        if (shown[i]) continue;
        shown[i] = rowNode(rows[i], i);
        listEl.appendChild(shown[i]);
      }
    }
    var raf = 0;
    function onScroll() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    listEl.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || lastPointer; }, true);
    listEl.addEventListener('touchstart', function () { lastPointer = 'touch'; }, { capture: true, passive: true });
    listEl.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { clearTimeout(hoverT); if (pv && pvbar.hidden) cancelPreview(c); } });
    var mo = new MutationObserver(function () {
      if (!root.isConnected) { scroller.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); mo.disconnect(); }
    });
    mo.observe(body, { childList: true });
    draw();
  }

  function star(on) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }
  function select(name, aria, any, labels) {
    return '<label class="sf-select"><span class="sr-only">' + esc(aria) + '</span><select name="' + name + '" aria-label="' + esc(aria) + '"><option value="">' + esc(any) + '</option>' +
      Object.keys(labels).map(function (k) { return '<option value="' + esc(k) + '">' + esc(labels[k]) + '</option>'; }).join('') + '</select></label>';
  }
  function scriptsInLibrary(FX) {
    var out = {};
    var have = {};
    FX.list().forEach(function (f) { (f.scripts || []).forEach(function (s) { have[s] = 1; }); });
    Object.keys(FX.labels.script).forEach(function (s) { if (have[s]) out[s] = FX.labels.script[s]; });
    return out;
  }

  function currentCard(c, l, f) {
    var FX = fonts();
    var card = c.h('<section class="sf-current" aria-label="Font of the selected text"></section>');
    if (!f) {
      card.innerHTML = '<p class="sf-note">This text uses <b>' + esc(l.font) + '</b>, which is not in the library. Pick a font below to replace it.</p>';
      return card;
    }
    card.innerHTML = '<div class="sf-cur-head"><div><span class="sf-cur-name">' + esc(f.family) + '</span><small>' + esc(metaLine(f)) + '</small></div></div>' +
      '<div class="sf-cur-weight"></div><div class="sf-pairs" hidden><span class="sf-label">Goes well with</span><div class="sf-pair-list"></div></div>' +
      '<div class="sf-cur-save"></div>';
    var name = card.querySelector('.sf-cur-name');
    name.style.fontFamily = FX.css(f.family);
    FX.load(f.family, { weights: [l.weight || 400], text: f.family }).then(function () { name.classList.add('is-ready'); }, function () {});
    var wbox = card.querySelector('.sf-cur-weight');
    if (f.wght) {
      wbox.appendChild(c.ui.slider({
        label: 'Weight', min: f.wght[0], max: f.wght[1], step: 10, value: weightFor(f, l.weight || 400), reset: weightFor(f, 400),
        onInput: function (v, key) { c.patch(textIds(c), { weight: Math.round(v) }, key); }
      }));
    } else if (f.weights.length > 1) {
      var WN = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
      wbox.appendChild(c.ui.seg(f.weights.map(function (w) { return [w, WN[w] || String(w)]; }), weightFor(f, l.weight || 400), function (w) { c.patch(textIds(c), { weight: w }); }, 'sx-seg-sm'));
    } else wbox.remove();
    var pairs = FX.pairs(f.family);
    if (pairs.length) {
      var pl = card.querySelector('.sf-pairs');
      pl.hidden = false;
      pairs.forEach(function (p) {
        var b = c.h('<button type="button" class="sf-pair">' + esc(p) + '</button>');
        paintName(b, p);
        b.onclick = function () { apply(c, p); };
        pl.querySelector('.sf-pair-list').appendChild(b);
      });
    }
    var sv = card.querySelector('.sf-cur-save');
    FX.isOffline(f.family).then(function (yes) {
      if (yes) {
        sv.innerHTML = '<span class="sf-ok">' + c.ic('check') + ' Saved on this device</span><button type="button" class="btn btn-ghost btn-sm">Remove</button>';
        sv.querySelector('button').onclick = function () { removeTarget(c, f.family); };
      } else {
        sv.innerHTML = '<button type="button" class="btn btn-ghost btn-sm">Save for offline · ' + esc(FX.fmt(f.bytes)) + '</button><small>' + esc(f.license === 'Apache-2.0' ? 'Apache 2.0' : 'Open Font License') + ', free for commercial use</small>';
        sv.querySelector('button').onclick = function (e) { saveTarget(c, f.family, e.currentTarget); };
      }
    });
    return card;
  }

  function savedPanel(c, box, set) {
    var FX = fonts();
    var cols = FX.collections();
    var byId = {};
    cols.forEach(function (x) { byId[x.id] = x; });
    var wrap = c.h('<section class="sf-save" aria-label="Save fonts for offline"><p class="sf-note">Fonts download when you use them, and fonts in your saved designs are kept on this device automatically. Save more here to have them with no connection.</p><div class="sf-save-list"></div></section>');
    var listEl = wrap.querySelector('.sf-save-list');
    function line(title, sub, target, fams, bytes) {
      var savedAll = fams.length && fams.every(function (f) { return set[f]; });
      var n = c.h('<div class="sf-save-row"><div><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div></div>');
      var b = c.h(savedAll ? '<button type="button" class="btn btn-ghost btn-sm">Remove</button>' : '<button type="button" class="btn btn-sm">Save · ' + esc(FX.fmt(bytes)) + '</button>');
      b.onclick = function (e) { if (savedAll) removeTarget(c, target); else saveTarget(c, target, e.currentTarget); };
      n.appendChild(b);
      listEl.appendChild(n);
      return n;
    }
    var df = designFamilies(c);
    if (df.length) {
      var db = df.reduce(function (a, f) { var m = FX.find(f); return a + ((m && m.bytes) || 0); }, 0);
      line('This design', df.length === 1 ? df[0] : df.length + ' fonts', df, df, db);
    }
    if (byId.originals) line(byId.originals.name, byId.originals.families.length + ' fonts', 'originals', byId.originals.families, byId.originals.bytes);
    if (byId.essentials) line('Essentials', byId.essentials.families.length + ' popular fonts', 'essentials', byId.essentials.families, byId.essentials.bytes);
    /* A language or a feel, chosen from one menu. */
    var pickRow = c.h('<div class="sf-save-row"><label class="sf-select"><span class="sr-only">Collection</span><select aria-label="Collection to save"></select></label></div>');
    var sel = pickRow.querySelector('select');
    var groups = [['A language', 'script-'], ['A feel', 'feel-'], ['A style', 'style-']];
    groups.forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g[0];
      cols.filter(function (x) { return x.id.indexOf(g[1]) === 0 && x.id !== 'script-latin'; }).forEach(function (x) {
        var o = document.createElement('option');
        o.value = x.id;
        o.textContent = x.name + ' (' + x.families.length + ', ' + FX.fmt(x.bytes) + ')';
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    var go = c.h('<button type="button" class="btn btn-sm">Save</button>');
    go.onclick = function (e) { saveTarget(c, sel.value, e.currentTarget); };
    pickRow.appendChild(go);
    listEl.appendChild(pickRow);
    var everything = FX.list().filter(function (f) { return !f.cjk; });
    line('Everything', everything.length + ' fonts', 'all', everything.map(function (f) { return f.family; }), everything.reduce(function (a, f) { return a + (f.bytes || 0); }, 0));
    var n = Object.keys(set).length;
    if (n) {
      var rm = c.h('<div class="sf-save-row"><div><b>' + n + (n === 1 ? ' font' : ' fonts') + ' saved</b><small>Listed below. Each one is also in Storage with its size.</small></div><button type="button" class="btn btn-ghost btn-sm">Remove all</button></div>');
      rm.querySelector('button').onclick = function () { removeTarget(c, Object.keys(set)); };
      listEl.appendChild(rm);
    }
    box.appendChild(wrap);
  }

  P.fonts = {
    title: 'Fonts', eyebrow: 'Font library', select: true,
    render: function (c, body) { render(c, body); },
    close: function (c) { cancelPreview(c); }
  };
  window.LEStudioFonts = { apply: apply, preview: previewFont, cancel: cancelPreview, prepare: prepareAll, previewing: function () { return pv ? pv.fam : null; } };
})();
