/* LocalEditor: download policy and packs (LE.downloads). See docs/DOWNLOADS.md. Loaded on every page by app.js.
   One place decides whether something large may download: features ask here instead of showing their own prompts.
   People never read "service worker", "cache" or "precache" here; the words are "download", "offline" and "space". */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  if (LE.downloads && LE.downloads.__real) return;

  var BASE = document.documentElement.getAttribute('data-root') || '';
  var MB = 1024 * 1024;
  var DAY = 864e5;
  /* The numbers in docs/DOWNLOADS.md. */
  var LIMITS = { auto: 60 * MB, metered: 5 * MB, whole: 25 * MB, showChipAfter: 1000, idleMs: 4000 };
  var KEY = { state: 'le-downloads', usage: 'le-downloads-usage', session: 'le-downloads-session' };
  var CACHES = { models: 'le-models-v1', fonts: 'le-fonts-v1', assets: 'le-assets-v1', photos: 'le-photos-v1', packs: 'le-packs-v1' };
  var KIND_WORDS = { feature: 'features', model: 'AI models', font: 'fonts', pack: 'downloads' };

  /* ---------- Small helpers ---------- */
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ssGet(k, d) { try { var v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mbWhole(n) { return Math.max(1, Math.round((n || 0) / MB)) + ' MB'; }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function abs(u) { return new URL(String(u).replace(/^\.\//, ''), new URL(BASE || './', location.href)).href; }
  function ago(t) {
    if (!t) return '';
    var s = (Date.now() - t) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' minutes ago';
    if (s < 86400) return Math.round(s / 3600) + ' hours ago';
    var d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }
  var bus = {};
  function on(name, fn) { (bus[name] = bus[name] || []).push(fn); return function () { bus[name] = (bus[name] || []).filter(function (f) { return f !== fn; }); }; }
  function emit(name, data) {
    (bus[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.warn(e); } });
    try { window.dispatchEvent(new CustomEvent('le-downloads:' + name, { detail: data })); } catch (e) {}
  }

  /* ---------- Stored choices: localStorage le-downloads; "Not now" lives in sessionStorage ---------- */
  function st() {
    var s = lsGet(KEY.state, null) || {};
    s.mode = s.mode === 'ask' ? 'ask' : 'auto';
    s.answers = s.answers || {};
    s.kinds = s.kinds || {};
    s.log = s.log || [];
    s.wants = s.wants || {};
    return s;
  }
  function save(patch) { var s = st(); Object.keys(patch).forEach(function (k) { s[k] = patch[k]; }); lsSet(KEY.state, s); return s; }
  function session() { var s = ssGet(KEY.session, null) || {}; s.notNow = s.notNow || {}; s.refused = s.refused || {}; return s; }
  function saveSession(s) { ssSet(KEY.session, s); }
  function mode() { return st().mode; }
  function setMode(m) {
    if (m !== 'auto' && m !== 'ask') throw new Error('mode is auto or ask');
    save({ mode: m });
    emit('mode', m);
    if (m === 'auto') scheduleBackground();
    return m;
  }
  /* "What downloaded and why": newest first, at most 60 rows, nothing but names, sizes and reasons. */
  function logDownload(row) {
    var s = st();
    s.log = [Object.assign({ at: Date.now() }, row)].concat(s.log.filter(function (x) { return x.id !== row.id; })).slice(0, 60);
    save({ log: s.log });
    emit('log', row);
  }

  /* ---------- Connection and space ---------- */
  function connection() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    if (!c) return { metered: false, known: false };
    var slow = /^(slow-2g|2g|3g)$/.test(c.effectiveType || '');
    var cell = c.type === 'cellular';
    return { metered: !!(c.saveData || cell || slow), saveData: !!c.saveData, cellular: cell, slow: slow, known: c.type != null || c.effectiveType != null || c.saveData != null };
  }
  function autoLimit() { return connection().metered ? LIMITS.metered : LIMITS.auto; }
  function estimate() {
    if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
    return navigator.storage.estimate().catch(function () { return null; });
  }
  function budgetBytes() {
    var L = window.LEPwa && LEPwa.limits ? LEPwa.limits() : null;
    return L && L.budgetMB ? L.budgetMB * MB : null;
  }
  /* Fonts, icon packs and collage photos share the storage manager's budget; models and the app do not. */
  var budgetUse = { at: 0, bytes: 0 };
  function downloadsUsed() {
    if (Date.now() - budgetUse.at < 60e3 || typeof caches === 'undefined') return Promise.resolve(budgetUse.bytes);
    return Promise.all([CACHES.fonts, CACHES.assets, CACHES.photos].map(function (n) {
      return caches.has(n).then(function (ok) {
        if (!ok) return 0;
        return caches.open(n).then(function (c) { return c.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return c.match(k).then(function (r) { return r ? Number(r.headers.get('x-le-bytes')) || Number(r.headers.get('content-length')) || 0 : 0; }); })); }); })
          .then(function (l) { return l.reduce(function (a, b) { return a + b; }, 0); });
      });
    })).then(function (l) { budgetUse = { at: Date.now(), bytes: l.reduce(function (a, b) { return a + b; }, 0) }; return budgetUse.bytes; }).catch(function () { return 0; });
  }
  /* { fits, free, overBudget }: fits=false when the browser would run out of room (with a margin). */
  function space(bytes, item) {
    return estimate().then(function (e) {
      var out = { fits: true, free: null, overBudget: false };
      if (e && e.quota) {
        out.free = Math.max(0, e.quota - (e.usage || 0));
        if (bytes * 1.1 + Math.min(20 * MB, e.quota * 0.05) > out.free) out.fits = false;
      }
      var budget = budgetBytes();
      if (!budget || !(item && (item.kind === 'font' || item.budget))) return out;
      return downloadsUsed().then(function (used) { out.overBudget = used + bytes > budget; return out; });
    });
  }

  /* ---------- The one question ---------- */
  var asking = Promise.resolve();
  var inflight = {};
  function kindOf(item) { return KIND_WORDS[item.kind] ? item.kind : 'feature'; }
  function sheet(cls, label) {
    var d = document.createElement('dialog');
    d.className = 'lp-sheet lp-confirm ld-sheet ' + cls;
    d.setAttribute('aria-label', label);
    d.innerHTML = '<div class="lp-sheet-in" tabindex="-1"></div>';
    d.addEventListener('close', function () { setTimeout(function () { d.remove(); }, 0); });
    document.body.appendChild(d);
    return d;
  }
  function showModal(d) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
  function ask(item, why) {
    return new Promise(function (resolve) {
      var k = kindOf(item);
      var d = sheet('ld-ask', 'Download ' + item.name);
      var notes = [];
      if (why.metered) notes.push(why.saveData ? 'Data saver is on.' : 'You seem to be on mobile data.');
      if (why.overBudget) notes.push('This goes past the space you set for downloads.');
      d.firstChild.innerHTML =
        '<div class="ld-ask-body">' +
          '<h2>Download ' + esc(item.name) + '?</h2>' +
          '<p>' + esc(item.reason || 'Needed for this feature') + '. <b class="ld-size">' + mbWhole(item.bytes) + '</b>, then it works offline.</p>' +
          (notes.length ? '<p class="ld-note">' + esc(notes.join(' ')) + '</p>' : '') +
          '<label class="ld-check"><input type="checkbox" data-ld-kind> <span>Don’t ask again for this kind</span></label>' +
          '<div class="lp-actions"><button type="button" class="lp-btn" data-ld-no>Not now</button><button type="button" class="lp-btn lp-primary" data-ld-yes>Download</button></div>' +
        '</div>';
      var answer = null;
      d.querySelector('[data-ld-yes]').onclick = function () { answer = true; d.close(); };
      d.querySelector('[data-ld-no]').onclick = function () { answer = false; d.close(); };
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
      d.addEventListener('close', function () {
        var always = d.querySelector('[data-ld-kind]').checked;
        var s = st();
        if (always) { s.kinds[k] = answer ? 'yes' : 'no'; save({ kinds: s.kinds }); }
        if (answer) { s.answers[item.id] = 'yes'; save({ answers: s.answers }); }
        else { var ss = session(); ss.notNow[item.id] = Date.now(); saveSession(ss); emit('deferred', item); }
        resolve(!!answer);
      });
      showModal(d);
      var yes = d.querySelector('[data-ld-yes]');
      try { yes.focus(); } catch (e) {}
    });
  }
  function refuse(item, sp) {
    var ss = session();
    if (ss.refused[item.id]) return;
    ss.refused[item.id] = Date.now();
    saveSession(ss);
    var d = sheet('ld-space', 'Not enough space');
    d.firstChild.innerHTML = '<div class="ld-ask-body"><h2>Not enough space for ' + esc(item.name) + '</h2>' +
      '<p>It needs about <b>' + mbWhole(item.bytes) + '</b>' + (sp.free != null ? ', and this browser has about ' + mbWhole(sp.free) + ' left for LocalEditor' : '') + '. Free up some space, then try again.</p>' +
      '<div class="lp-actions"><button type="button" class="lp-btn" data-ld-no>OK</button><button type="button" class="lp-btn lp-primary" data-ld-free>Free up space</button></div></div>';
    d.querySelector('[data-ld-no]').onclick = function () { d.close(); };
    d.querySelector('[data-ld-free]').onclick = function () { d.close(); if (window.LEPwa) LEPwa.openStorage({ free: true }); };
    showModal(d);
  }

  /* request({ id, name, bytes, kind, reason, confirmed, quiet }) -> Promise<{ ok, why }>
     confirmed: the person just tapped a button that showed the size; only space can stop it.
     quiet: never show a sheet (background use); resolves { ok:false, why:'ask' } where a question would be needed. */
  function request(item) {
    item = Object.assign({ kind: 'feature', bytes: 0 }, item || {});
    if (!item.id) item.id = item.kind + ':' + (item.name || 'item');
    if (!item.name) item.name = 'this feature';
    if (inflight[item.id]) return inflight[item.id];
    var p = decide(item).then(function (r) { delete inflight[item.id]; emit('request', { item: item, result: r }); return r; }, function (err) { delete inflight[item.id]; throw err; });
    inflight[item.id] = p;
    return p;
  }
  function decide(item) {
    var s = st(), ss = session(), k = kindOf(item), bytes = item.bytes || 0;
    return space(bytes, item).then(function (sp) {
      if (!sp.fits) {
        if (!item.quiet) refuse(item, sp);
        return { ok: false, why: 'space', free: sp.free };
      }
      if (item.confirmed) { s.answers[item.id] = 'yes'; save({ answers: s.answers }); delete ss.notNow[item.id]; saveSession(ss); return { ok: true, why: 'confirmed' }; }
      if (s.answers[item.id] === 'yes' && !sp.overBudget) return { ok: true, why: 'remembered' };
      if (s.kinds[k] === 'yes' && !sp.overBudget) return { ok: true, why: 'kind' };
      if (s.kinds[k] === 'no') return { ok: false, why: 'declined' };
      if (ss.notNow[item.id]) return { ok: false, why: 'not-now' };
      var conn = connection();
      var needsAsk = s.mode === 'ask' || bytes > autoLimit() || sp.overBudget;
      if (!needsAsk) return { ok: true, why: 'auto' };
      if (item.quiet) return { ok: false, why: 'ask' };
      var why = { metered: conn.metered && bytes > LIMITS.metered, saveData: conn.saveData, overBudget: sp.overBudget };
      var turn = asking.then(function () {
        /* Answered while it waited its turn (another request for the same kind). */
        var s2 = st();
        if (s2.answers[item.id] === 'yes') return true;
        if (s2.kinds[k] === 'yes') return true;
        if (s2.kinds[k] === 'no') return false;
        return ask(item, why);
      });
      asking = turn.catch(function () {});
      return turn.then(function (yes) { return yes ? { ok: true, why: 'asked' } : { ok: false, why: 'not-now' }; });
    });
  }
  /* What the person put off: shown quietly in the downloads settings with a Download button. */
  function pending() {
    var ss = session(), s = st(), out = [];
    Object.keys(ss.notNow).forEach(function (id) { if (s.wants[id] || lastItems[id]) out.push(Object.assign({}, lastItems[id] || s.wants[id], { id: id })); });
    return out;
  }
  var lastItems = {};
  on('request', function (x) { lastItems[x.item.id] = { id: x.item.id, name: x.item.name, bytes: x.item.bytes, kind: x.item.kind, reason: x.item.reason }; });

  /* ---------- One quiet progress chip for everything ---------- */
  var tracks = {};
  var chip = null, chipTimer = null, chipDone = null;
  function track(id, opts) {
    opts = opts || {};
    var t = tracks[id];
    if (!t || t.finished) {
      t = tracks[id] = { id: id, name: opts.name || 'Download', bytes: opts.bytes || 0, loaded: 0, start: Date.now(), finished: false, failed: false, cancel: opts.cancel || null };
    } else {
      if (opts.name) t.name = opts.name;
      if (opts.bytes) t.bytes = opts.bytes;
      if (opts.cancel) t.cancel = opts.cancel;
    }
    paintSoon();
    var api = {
      progress: function (loaded, total) {
        if (t.finished) return;
        if (total) t.bytes = total;
        t.loaded = Math.max(0, loaded || 0);
        paintSoon();
      },
      done: function () { if (t.finished) return; t.finished = true; t.loaded = t.bytes || t.loaded; t.end = Date.now(); paintSoon(); emit('done', { id: id }); },
      fail: function (err) { if (t.finished) return; t.finished = true; t.failed = true; t.error = err && err.message ? err.message : String(err || ''); t.end = Date.now(); paintSoon(); emit('fail', { id: id, error: t.error }); },
      onCancel: function (fn) { t.cancel = fn; }
    };
    return api;
  }
  function running() { return Object.keys(tracks).map(function (k) { return tracks[k]; }).filter(function (t) { return !t.finished; }); }
  function visibleTracks() {
    var now = Date.now();
    return Object.keys(tracks).map(function (k) { return tracks[k]; }).filter(function (t) { return (t.finished ? t.end : now) - t.start >= LIMITS.showChipAfter && (!t.finished || now - t.end < 2500); });
  }
  var paintQueued = false;
  function paintSoon() {
    if (paintQueued) return;
    paintQueued = true;
    (window.requestAnimationFrame || setTimeout)(function () { paintQueued = false; paintChip(); });
  }
  function ensureChip() {
    if (chip && chip.isConnected) return chip;
    chip = h('<div class="ld-chip" hidden><button type="button" class="ld-chip-btn" aria-expanded="false"><span class="ld-ring" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><circle class="ld-ring-v" cx="10" cy="10" r="8"/></svg></span><span class="ld-chip-tx" role="status" aria-live="polite"></span></button><div class="ld-pop" hidden role="region" aria-label="Downloads"></div></div>');
    document.body.appendChild(chip);
    var btn = chip.querySelector('.ld-chip-btn');
    btn.onclick = function () {
      var pop = chip.querySelector('.ld-pop');
      pop.hidden = !pop.hidden;
      btn.setAttribute('aria-expanded', String(!pop.hidden));
      paintChip();
    };
    chip.querySelector('.ld-pop').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ld-cancel]');
      if (b) cancel(b.getAttribute('data-ld-cancel'));
      if (e.target.closest('[data-ld-open]')) open();
    });
    return chip;
  }
  function cancel(id) {
    var t = tracks[id];
    if (!t || t.finished) return;
    try { if (t.cancel) t.cancel(); } catch (e) {}
    t.finished = true; t.cancelled = true; t.end = Date.now() - 3000;
    paintSoon();
    emit('cancel', { id: id });
  }
  function paintChip() {
    clearTimeout(chipTimer);
    var list = visibleTracks();
    var live = running();
    /* Re-check once a waiting download reaches one second. */
    var wait = live.filter(function (t) { return Date.now() - t.start < LIMITS.showChipAfter; });
    if (wait.length) chipTimer = setTimeout(paintChip, LIMITS.showChipAfter - (Date.now() - wait[0].start) + 20);
    if (!list.length) { if (chip) chip.hidden = true; return; }
    var c = ensureChip();
    var act = list.filter(function (t) { return !t.finished; });
    var total = act.reduce(function (a, t) { return a + (t.bytes || 0); }, 0);
    var got = act.reduce(function (a, t) { return a + Math.min(t.loaded, t.bytes || t.loaded); }, 0);
    var pct = total ? Math.min(99, Math.floor(got / total * 100)) : null;
    var text;
    if (act.length) text = (act.length === 1 ? 'Downloading ' + act[0].name : 'Downloading ' + act.length + ' items') + (pct != null ? ' · ' + pct + '%' : '');
    else text = list.some(function (t) { return t.failed; }) ? 'A download did not finish' : list.some(function (t) { return t.cancelled; }) ? 'Download stopped' : 'Available offline';
    c.querySelector('.ld-chip-tx').textContent = text;
    c.classList.toggle('is-done', !act.length);
    c.querySelector('.ld-ring-v').style.strokeDashoffset = String(50.3 * (1 - (act.length ? (pct || 0) / 100 : 1)));
    c.hidden = false;
    var pop = c.querySelector('.ld-pop');
    if (!pop.hidden) {
      pop.innerHTML = '<ul>' + list.map(function (t) {
        var p = t.bytes ? Math.min(100, Math.floor(t.loaded / t.bytes * 100)) : null;
        return '<li><div><b>' + esc(t.name) + '</b><small>' + (t.finished ? (t.failed ? 'Did not finish' : t.cancelled ? 'Stopped' : 'Available offline') : (p != null ? p + '% of ' + mbWhole(t.bytes) : 'Downloading')) + '</small></div>' +
          (!t.finished ? '<button type="button" class="lp-link" data-ld-cancel="' + esc(t.id) + '">Cancel</button>' : '') + '</li>';
      }).join('') + '</ul><button type="button" class="lp-link" data-ld-open>Download settings</button>';
    }
    if (!act.length) chipTimer = setTimeout(paintChip, 2600);
  }

  /* ---------- Quality first, then speed ---------- */
  var SPEED = { fast: 3, medium: 2, slow: 1 };
  function speedOf(o) { return typeof o.speed === 'number' ? o.speed : SPEED[o.speed] || 0; }
  function statusOf(o) {
    if (!o.supportId || !(LE.support && LE.support.check)) return 'ok';
    try { return LE.support.check(o.supportId).status || 'unknown'; } catch (e) { return 'unknown'; }
  }
  /* pick(options) -> { now, next, ranked }: never trades quality for speed. */
  function pick(options) {
    var list = (options || []).filter(Boolean).map(function (o) { return Object.assign({}, o, { status: statusOf(o) }); });
    var tier = null;
    ['ok', 'limited', 'unknown'].some(function (s) { var l = list.filter(function (o) { return o.status === s; }); if (l.length) { tier = l; return true; } return false; });
    if (!tier) return { now: null, next: null, ranked: [] };
    tier.sort(function (a, b) { return (b.quality || 0) - (a.quality || 0) || speedOf(b) - speedOf(a); });
    var best = tier[0];
    var limit = autoLimit();
    var now = tier.filter(function (o) { return o.cached; })[0] || tier.filter(function (o) { return (o.bytes || 0) <= limit; })[0] || best;
    var next = null;
    if (best !== now && !best.cached && (best.bytes || 0) <= limit && mode() === 'auto') next = best;
    if (next && typeof next.fetch === 'function') want({ id: next.id, name: next.name || next.id, bytes: next.bytes, kind: next.kind || 'model', reason: 'Better quality for next time', fetch: next.fetch });
    return { now: now, next: next, ranked: tier };
  }

  /* ---------- Usage signals: local only, counts and recency, erasable ---------- */
  function usage() { var u = lsGet(KEY.usage, null) || {}; u.f = u.f || {}; return u; }
  function used(featureId) {
    if (!featureId) return;
    var u = usage();
    var r = u.f[featureId] = u.f[featureId] || { n: 0, first: Date.now(), last: 0 };
    if (Date.now() - r.last < 2000) return;
    r.n++;
    r.last = Date.now();
    var ids = Object.keys(u.f);
    if (ids.length > 200) { ids.sort(function (a, b) { return u.f[a].last - u.f[b].last; }).slice(0, ids.length - 200).forEach(function (k) { delete u.f[k]; }); }
    lsSet(KEY.usage, u);
    emit('used', featureId);
    scheduleBackground();
  }
  function forget() {
    try { localStorage.removeItem(KEY.usage); localStorage.removeItem(KEY.state); sessionStorage.removeItem(KEY.session); } catch (e) {}
    lastItems = {};
    emit('forget', {});
  }
  /* Feature ids map onto the file groups the build lists in packs.json (features). */
  var GROUP = { cutout: /cutout|bg-?remove|background-remover/, ocr: /ocr|scan|text-recognition/, expert: /^expert|\.expert|\bfx\b/ };
  function groupOf(id) { var k = null; Object.keys(GROUP).some(function (g) { if (GROUP[g].test(id)) { k = g; return true; } return false; }); return k; }
  var GROUP_NAMES = { cutout: 'Background remover', ocr: 'Text recognition', expert: 'Expert editor' };
  function wantedGroups() {
    var u = usage().f, by = {};
    Object.keys(u).forEach(function (id) {
      var g = groupOf(id);
      if (!g) return;
      var r = u[id];
      if (Date.now() - r.last > 30 * DAY) return;
      var x = by[g] = by[g] || { n: 0, last: 0 };
      x.n += r.n; x.last = Math.max(x.last, r.last);
    });
    return Object.keys(by).filter(function (g) { return by[g].n >= 2 || Date.now() - by[g].last < 3 * DAY; }).map(function (g) { return { group: g, n: by[g].n }; });
  }
  /* want(item): fetch this in the background when the device is idle (pick's `next` lands here). */
  var wantFns = {};
  function want(item) {
    if (!item || !item.id) return;
    if (item.fetch) wantFns[item.id] = item.fetch;
    var s = st();
    s.wants[item.id] = { id: item.id, name: item.name, bytes: item.bytes || 0, kind: item.kind || 'feature', reason: item.reason || '', files: item.files || null, at: Date.now() };
    save({ wants: s.wants });
    scheduleBackground();
  }

  /* ---------- Background fetching: idle, online, unmetered, battery allowing; pauses on any interaction ---------- */
  var lastInput = 0, bg = { running: false, ctrl: null, timer: null, paused: 0 };
  function onInput() {
    lastInput = Date.now();
    if (bg.running && bg.ctrl) { bg.ctrl.abort(); bg.paused++; emit('background', { state: 'paused' }); }
    if (bg.running || bg.wanted) scheduleBackground();
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { window.addEventListener(t, onInput, { capture: true, passive: true }); });
  function batteryOk() {
    if (!navigator.getBattery) return Promise.resolve(true);
    return navigator.getBattery().then(function (b) { return b.charging || b.level > 0.2; }, function () { return true; });
  }
  function scheduleBackground(ms) {
    bg.wanted = true;
    clearTimeout(bg.timer);
    bg.timer = setTimeout(function () {
      var quiet = Date.now() - lastInput;
      if (quiet < LIMITS.idleMs) { scheduleBackground(LIMITS.idleMs - quiet + 50); return; }
      var go = function () { background(); };
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 5000 }); else go();
    }, ms == null ? LIMITS.idleMs : ms);
  }
  function stored(u) {
    if (typeof caches === 'undefined') return Promise.resolve(false);
    return caches.match(abs(u)).then(function (r) { return !!r; }, function () { return false; });
  }
  function missing(files) {
    return Promise.all(files.map(function (f) { return stored(f.u).then(function (ok) { return ok ? null : f; }); })).then(function (l) { return l.filter(Boolean); });
  }
  function fileRows(urls) {
    var all = manifest ? [].concat.apply([], manifest.packs.filter(function (p) { return Array.isArray(p.files); }).map(function (p) { return p.files; })) : [];
    var by = {};
    all.forEach(function (f) { by[f.u] = f; });
    return urls.map(function (u) { return by[u] || { u: u, raw: 0, transfer: 0 }; });
  }
  /* Candidates, most useful first: the better model pick() asked for, the files of features in use, fonts of saved designs. */
  function candidates() {
    var out = [], s = st();
    Object.keys(s.wants).forEach(function (id) {
      var w = s.wants[id];
      out.push({ id: id, name: w.name, bytes: w.bytes, kind: w.kind, why: w.reason || 'Better quality for next time', fetch: wantFns[id] || null, files: w.files ? fileRows(w.files) : null, want: true });
    });
    if (manifest && manifest.features) wantedGroups().forEach(function (g) {
      var files = fileRows(manifest.features[g.group] || []);
      if (!files.length) return;
      out.push({ id: 'feature:' + g.group, name: GROUP_NAMES[g.group] || g.group, kind: g.group === 'expert' ? 'feature' : 'model', files: files, why: 'You used ' + (GROUP_NAMES[g.group] || g.group).toLowerCase() + ' ' + (g.n === 1 ? 'recently' : g.n + ' times') });
    });
    out.push({ id: 'fonts:designs', name: 'Fonts in your designs', kind: 'font', fonts: true, why: 'Used by designs saved on this device' });
    return out;
  }
  function background() {
    bg.wanted = false;
    if (bg.running) return Promise.resolve({ state: 'busy' });
    if (mode() !== 'auto') return Promise.resolve({ state: 'off' });
    if (navigator.onLine === false) return Promise.resolve({ state: 'offline' });
    if (connection().metered) return Promise.resolve({ state: 'metered' });
    if (Date.now() - lastInput < LIMITS.idleMs) { scheduleBackground(); return Promise.resolve({ state: 'waiting' }); }
    bg.running = true;
    var ctrl = bg.ctrl = new AbortController();
    var fetched = [];
    return Promise.all([batteryOk(), ready]).then(function (r) {
      if (!r[0]) return 'battery';
      var list = candidates();
      var chain = Promise.resolve();
      list.forEach(function (c) {
        chain = chain.then(function () {
          if (ctrl.signal.aborted) return;
          return runCandidate(c, ctrl.signal).then(function (n) { if (n) fetched.push(c.id); });
        });
      });
      return chain.then(function () { return ctrl.signal.aborted ? 'paused' : 'done'; });
    }).then(function (state) {
      bg.running = false; bg.ctrl = null;
      if (state === 'paused') scheduleBackground();
      emit('background', { state: state, fetched: fetched });
      return { state: state, fetched: fetched };
    }, function (err) {
      bg.running = false; bg.ctrl = null;
      if (ctrl.signal.aborted) scheduleBackground();
      return { state: ctrl.signal.aborted ? 'paused' : 'failed', fetched: fetched, error: String(err && err.message || err) };
    });
  }
  function runCandidate(c, signal) {
    if (c.fonts) return fontsOfDesigns(signal);
    var filesP = c.files ? missing(c.files) : Promise.resolve(null);
    return filesP.then(function (files) {
      if (files && !files.length) { if (c.want) dropWant(c.id); return 0; }
      var bytes = files ? files.reduce(function (a, f) { return a + (f.transfer || f.raw || 0); }, 0) : c.bytes || 0;
      return request({ id: c.id, name: c.name, bytes: bytes, kind: c.kind, reason: c.why, quiet: true }).then(function (r) {
        if (!r.ok) return 0;
        var job = files ? fetchFiles(c.id, files, signal) : c.fetch ? Promise.resolve(c.fetch({ signal: signal })) : null;
        if (!job) return 0;
        return job.then(function () {
          if (signal.aborted) return 0;
          if (c.want) dropWant(c.id);
          logDownload({ id: c.id, name: c.name, bytes: bytes, why: c.why, auto: true });
          return 1;
        });
      });
    }).catch(function (err) { if (signal.aborted) return 0; throw err; });
  }
  function dropWant(id) { var s = st(); delete s.wants[id]; save({ wants: s.wants }); delete wantFns[id]; }
  /* Page-side download into the same place the worker would keep it. Stops at once when signal aborts. */
  function homeOf(u) {
    var p = new URL(abs(u)).pathname;
    if (/\/assets\/(models\/|vendor\/ort|vendor\/tesseract\/)/.test(p)) return Promise.resolve(CACHES.models);
    if (p.indexOf('/assets/fonts/library/') >= 0) return Promise.resolve(CACHES.fonts);
    if (/\/assets\/data\/[\w\/-]+\.json$/.test(p)) return Promise.resolve(CACHES.assets);
    if (p.indexOf('/assets/photos/') >= 0) return Promise.resolve(CACHES.photos);
    return appCache();
  }
  function fetchFiles(id, files, signal, t) {
    var chain = Promise.resolve();
    var got = 0;
    files.forEach(function (f) {
      chain = chain.then(function () {
        if (signal && signal.aborted) throw new DOMException('Paused', 'AbortError');
        return fetch(abs(f.u), { signal: signal, credentials: 'same-origin' }).then(function (res) {
          if (!res.ok) throw new Error('Could not download ' + f.u + ' (' + res.status + ')');
          return res.blob();
        }).then(function (b) {
          if (f.raw && b.size !== f.raw) throw new Error('Incomplete download: ' + f.u);
          got += b.size;
          if (t) t.progress(got);
          var hd = { 'content-type': b.type || 'application/octet-stream', 'x-le-bytes': String(b.size), 'x-le-at': String(Date.now()) };
          if (f.model) hd['x-le-model'] = f.model;
          return homeOf(f.u).then(function (name) { return caches.open(name).then(function (c) { return c.put(abs(f.u), new Response(b, { headers: hd })); }); });
        });
      });
    });
    return chain;
  }
  /* Fonts used by designs saved here: loaded through LE.fonts (which keeps them offline). Only where the font module runs. */
  function fontsOfDesigns(signal) {
    if (!(LE.fonts && LE.fonts.load) || !window.indexedDB) return Promise.resolve(0);
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open('le-projects'); } catch (e) { resolve([]); return; }
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (e) {} };
      req.onerror = function () { resolve([]); };
      req.onsuccess = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('projects')) { d.close(); resolve([]); return; }
        var all = d.transaction('projects', 'readonly').objectStore('projects').getAll();
        all.onsuccess = function () {
          var fams = {};
          (all.result || []).forEach(function (p) {
            var re = /"font"\s*:\s*"([^"]{1,80})"/g, m, txt = JSON.stringify(p.doc || {});
            while ((m = re.exec(txt))) fams[m[1]] = 1;
          });
          d.close();
          resolve(Object.keys(fams));
        };
        all.onerror = function () { d.close(); resolve([]); };
      };
    }).then(function (fams) {
      var chain = Promise.resolve(0);
      fams.slice(0, 40).forEach(function (f) {
        chain = chain.then(function (n) {
          if (signal.aborted) return n;
          return Promise.resolve(LE.fonts.load(f, 400, false)).then(function () { return n + 1; }, function () { return n; });
        });
      });
      return chain;
    });
  }

  /* ---------- Worker bridge ---------- */
  function sw() { return 'serviceWorker' in navigator ? navigator.serviceWorker : null; }
  function controller() { var c = sw(); return c && c.controller; }
  function message(msg, ms) {
    var w = controller();
    if (!w) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      var t = ms ? setTimeout(function () { resolve(null); }, ms) : null;
      ch.port1.onmessage = function (m) { clearTimeout(t); resolve(m.data); };
      try { w.postMessage(msg, [ch.port2]); } catch (e) { clearTimeout(t); resolve(null); }
    });
  }
  var appCacheName = null;
  function appCache() {
    if (appCacheName) return Promise.resolve(appCacheName);
    return message({ type: 'le-version' }, 1500).then(function (r) {
      if (r && r.cache) { appCacheName = r.cache; return r.cache; }
      if (typeof caches === 'undefined') return 'le-app-local';
      return caches.keys().then(function (ks) { var l = ks.filter(function (k) { return k.indexOf('le-app-') === 0; }).sort(); return l[l.length - 1] || 'le-app-local'; });
    });
  }
  function onWorkerMessage(e) {
    var d = e.data || {};
    if (d.type === 'le-pack-progress') packProgress(d);
    if (d.type === 'le-activated') { appCacheName = null; refreshPacks(); }
  }

  /* ---------- Packs ---------- */
  var manifest = null;
  var packState = {};
  var ready = loadManifest();
  function loadManifest() {
    return fetch(abs('assets/data/packs.json'), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { manifest = j; emit('packs', packs()); refreshPacks(); return j; })
      .catch(function () { return null; });
  }
  function packDef(id) { return manifest ? manifest.packs.filter(function (p) { return p.id === id; })[0] || null : null; }
  function filesOf(id) {
    var p = packDef(id);
    if (!p) return [];
    if (p.files && Array.isArray(p.files)) return p.files;
    var seen = {}, out = [];
    (p.includes || []).forEach(function (sub) { filesOf(sub).forEach(function (f) { if (!seen[f.u]) { seen[f.u] = 1; out.push(f); } }); });
    return out;
  }
  function extrasOf(id) { var p = packDef(id); return p && p.includes ? p.includes.filter(function (x) { return x === 'fonts' || x === 'icons'; }) : []; }
  /* State of one pack: none | downloading | done | update. */
  function refreshPacks() {
    if (!manifest || typeof caches === 'undefined') return Promise.resolve(packs());
    var ids = manifest.packs.map(function (p) { return p.id; });
    return Promise.all(ids.map(function (id) {
      var files = filesOf(id);
      return Promise.all(files.map(function (f) {
        return caches.match(abs(f.u)).then(function (r) {
          if (!r) return 'missing';
          var n = Number(r.headers.get('x-le-bytes')) || Number(r.headers.get('content-length')) || 0;
          return f.model && n && f.raw && n !== f.raw ? 'stale' : 'ok';
        }, function () { return 'missing'; });
      })).then(function (r) {
        var ps = packState[id] = packState[id] || {};
        var allOk = r.every(function (x) { return x === 'ok'; });
        var extrasDone = extrasOf(id).every(function (x) { return !!(st().extras || {})[x]; });
        if (ps.state === 'downloading') return;
        ps.state = allOk && extrasDone ? 'done' : r.some(function (x) { return x === 'stale'; }) ? 'update' : 'none';
        if (ps.state === 'done' && (id === 'basic' || id === 'basic+models' || id === 'all') && window.LEPwa && LEPwa.updateReady && LEPwa.updateReady()) ps.state = 'update';
        ps.missing = r.filter(function (x) { return x !== 'ok'; }).length;
      });
    })).then(function () { emit('packs', packs()); return packs(); });
  }
  function packProgress(d) {
    var id = String(d.id || '');
    if (id.indexOf('pack:') !== 0) return;
    var pid = id.slice(5);
    var ps = packState[pid] = packState[pid] || {};
    var t = track(id, { name: (packDef(pid) || {}).name || PACK_NAMES[pid] || 'Offline files', bytes: d.total, cancel: function () { message({ type: 'le-pack-cancel', id: id }); } });
    t.progress(d.loaded, d.total);
    if (d.state === 'running') { ps.state = 'downloading'; ps.loaded = d.loaded; ps.total = d.total; emit('packs', packs()); return; }
    if (d.state === 'done') t.done(); else t.fail(new Error(d.state === 'cancelled' ? 'Stopped' : 'Some files did not download'));
    /* A job this page did not start (it was reloaded meanwhile): settle the state from what is stored now. */
    if (!packJobs[pid]) { ps.state = null; ps.total = 0; refreshPacks(); }
  }
  var PACK_NAMES = { basic: 'Basic editor', 'basic+models': 'Basic editor + models', expert: 'Expert editor', all: 'Everything' };
  function packs() {
    if (!manifest) return [];
    return manifest.packs.filter(function (p) { return !p.hidden; }).map(function (p) {
      var ps = packState[p.id] || {};
      var bytes = p.transfer;
      if (p.id === 'all') bytes = p.transfer - manifest.extras.fonts.transfer - manifest.extras.icons.transfer + sizeOfFonts() + sizeOfIcons();
      return {
        id: p.id, name: p.name, about: p.about, bytes: bytes, raw: p.raw, gzip: p.gzip, files: filesOf(p.id).length,
        state: ps.state || 'none', done: ps.state === 'done', progress: ps.total ? ps.loaded / ps.total : null, empty: !filesOf(p.id).length && !extrasOf(p.id).length,
        download: function () { return downloadPack(p.id); },
        cancel: function () { cancel('pack:' + p.id); },
        remove: function () { return removePack(p.id); }
      };
    });
  }
  function sizeOfFonts() {
    try { if (LE.fonts && typeof LE.fonts.sizeOf === 'function') { var n = LE.fonts.sizeOf('all'); if (typeof n === 'number' && n > 0) return n; } } catch (e) {}
    return manifest ? manifest.extras.fonts.transfer : 0;
  }
  function sizeOfIcons() { return manifest ? manifest.extras.icons.transfer : 0; }
  function need(src, test) {
    if (test()) return Promise.resolve();
    if (LE.lazy) return LE.lazy(abs(src)).then(function () { if (!test()) throw new Error('Could not load ' + src); });
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = abs(src); s.async = true;
      s.onload = function () { if (test()) resolve(); else reject(new Error('Could not load ' + src)); };
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  var packJobs = {};
  /* The person tapped a pack button: they saw the size, so only space can stop it. */
  function downloadPack(id) {
    if (packJobs[id]) return packJobs[id];
    var p = packs().filter(function (x) { return x.id === id; })[0];
    if (!p) return Promise.reject(new Error('Unknown pack ' + id));
    var job = ready.then(function () {
      return request({ id: 'pack:' + id, name: p.name, bytes: p.bytes, kind: 'pack', reason: p.about, confirmed: true });
    }).then(function (r) {
      if (!r.ok) return { ok: false, why: r.why };
      var ps = packState[id] = packState[id] || {};
      ps.state = 'downloading';
      emit('packs', packs());
      var files = filesOf(id);
      var expertOnDemand = manifest.decision && !manifest.decision.expertWithBasic;
      var marker = (id === 'expert' || id === 'all') && expertOnDemand;
      var core = files.length ? viaWorkerOrPage('pack:' + id, p.name, files, marker) : Promise.resolve({ state: 'done' });
      return core.then(function (res) {
        if (res.state !== 'done') throw new Error(res.state === 'cancelled' ? 'Stopped' : 'Some files did not download');
        return extras(id);
      }).then(function () {
        ps.state = 'done';
        logDownload({ id: 'pack:' + id, name: p.name, bytes: p.bytes, why: 'You chose Download now' });
        return refreshPacks().then(function () { return { ok: true }; });
      }, function (err) {
        ps.state = 'none';
        refreshPacks();
        return { ok: false, why: err && err.message === 'Stopped' ? 'cancelled' : 'failed', error: String(err && err.message || err) };
      });
    });
    packJobs[id] = job;
    job.then(function () { delete packJobs[id]; }, function () { delete packJobs[id]; });
    return job;
  }
  function viaWorkerOrPage(tid, name, files, marker) {
    var total = files.reduce(function (a, f) { return a + (f.raw || 0); }, 0);
    var t = track(tid, { name: name, bytes: total });
    if (controller()) {
      t.onCancel(function () { message({ type: 'le-pack-cancel', id: tid }); });
      return message({ type: 'le-pack', id: tid, name: name, files: files, marker: marker }).then(function (r) {
        if (!r) throw new Error('No answer');
        if (r.state === 'done') t.done(); else t.fail(new Error(r.state));
        return r;
      });
    }
    var ctrl = new AbortController();
    t.onCancel(function () { ctrl.abort(); });
    return missing(files).then(function (need) {
      var have = total - need.reduce(function (a, f) { return a + (f.raw || 0); }, 0);
      var pt = { progress: function (n) { t.progress(have + n, total); } };
      return fetchFiles(tid, need, ctrl.signal, pt);
    }).then(function () {
      if (marker && typeof caches !== 'undefined') return caches.open(CACHES.packs).then(function (c) { return c.put(abs('__packs/expert'), new Response(String(Date.now()))); });
    }).then(function () { t.done(); return { state: 'done' }; }, function (err) {
      if (ctrl.signal.aborted) return { state: 'cancelled' };
      t.fail(err); return { state: 'failed', error: String(err && err.message || err) };
    });
  }
  /* "Everything" also saves the font library and every icon style through their own modules, so nothing is stored twice. */
  function extras(id) {
    var list = extrasOf(id);
    if (!list.length) return Promise.resolve();
    var s = st();
    s.extras = s.extras || {};
    var chain = Promise.resolve();
    if (list.indexOf('fonts') >= 0) chain = chain.then(function () {
      return need('assets/js/le-fonts.js', function () { return !!LE.fonts; }).then(function () {
        var t = track('fonts:all', { name: 'Font library', bytes: sizeOfFonts() });
        var fn = typeof LE.fonts.saveOffline === 'function' ? function (cb) { return LE.fonts.saveOffline('all', cb); } : typeof LE.fonts.saveAllOffline === 'function' ? function (cb) { return LE.fonts.saveAllOffline(cb); } : null;
        if (!fn) { t.done(); return; }
        return Promise.resolve(fn(function (p) { if (p && p.total) t.progress(p.loaded / p.total * sizeOfFonts(), sizeOfFonts()); })).then(function () { t.done(); s.extras.fonts = Date.now(); save({ extras: s.extras }); }, function (e) { t.fail(e); throw e; });
      });
    });
    if (list.indexOf('icons') >= 0) chain = chain.then(function () {
      return need('assets/js/le-assets.js', function () { return !!(LE.assets && LE.assets.saveStyleOffline); }).then(function () {
        var t = track('icons:all', { name: 'Icon styles', bytes: sizeOfIcons() });
        return Promise.resolve(LE.assets.saveStyleOffline('all', function (p) { if (p && p.totalBytes) t.progress(p.bytes / p.totalBytes * sizeOfIcons(), sizeOfIcons()); })).then(function () { t.done(); s.extras.icons = Date.now(); save({ extras: s.extras }); }, function (e) { t.fail(e); throw e; });
      });
    });
    return chain;
  }
  function removePack(id) {
    var files = filesOf(id);
    var s = st();
    var jobs = files.map(function (f) {
      return homeOf(f.u).then(function (n) { return caches.open(n).then(function (c) { return c.delete(abs(f.u)); }); }).catch(function () {});
    });
    if (id === 'expert' || id === 'all') {
      jobs.push(message({ type: 'le-pack-forget', id: 'expert' }, 1500));
      if (typeof caches !== 'undefined') jobs.push(caches.open(CACHES.packs).then(function (c) { return c.delete(abs('__packs/expert')); }).catch(function () {}));
    }
    if (extrasOf(id).length) {
      s.extras = {}; save({ extras: {} });
      if (window.LEPwa && LEPwa.clearCategory) { jobs.push(LEPwa.clearCategory('fonts').catch(function () {})); jobs.push(LEPwa.clearCategory('packs').catch(function () {})); }
    }
    s.log = s.log.filter(function (x) { return x.id !== 'pack:' + id; });
    save({ log: s.log });
    return Promise.all(jobs).then(function () { if (packState[id]) packState[id].state = 'none'; return refreshPacks(); });
  }

  /* ---------- Settings: one place, in the studio's Settings and in the storage manager ---------- */
  var STATE_TEXT = { none: 'Not downloaded', downloading: 'Downloading', done: 'Available offline', update: 'Update available' };
  function packRowHTML(p) {
    var st0 = p.state;
    var label = st0 === 'downloading' ? 'Downloading ' + Math.floor((p.progress || 0) * 100) + '%' : STATE_TEXT[st0];
    var btn = '';
    if (p.empty) label = 'Comes with the basic editor';
    else if (st0 === 'none') btn = '<button type="button" class="lp-btn lp-btn-sm" data-ld-get="' + esc(p.id) + '">Download</button>';
    else if (st0 === 'update') btn = '<button type="button" class="lp-btn lp-btn-sm" data-ld-get="' + esc(p.id) + '">Update</button>';
    else if (st0 === 'downloading') btn = '<button type="button" class="lp-btn lp-btn-sm" data-ld-stop="' + esc(p.id) + '">Cancel</button>';
    else if (st0 === 'done') btn = '<button type="button" class="lp-link" data-ld-rm="' + esc(p.id) + '">Remove</button>';
    return '<li class="ld-pack" data-ld-pack="' + esc(p.id) + '" data-state="' + st0 + '"><div><b>' + esc(p.name) + ' <span class="ld-mb">' + (p.empty ? '' : mbWhole(p.bytes)) + '</span></b><small>' + esc(p.about) + '</small>' +
      '<small class="ld-state">' + (st0 === 'done' ? '<i class="ld-ok" aria-hidden="true"></i>' : '') + esc(label) + '</small>' +
      (st0 === 'downloading' ? '<span class="ld-bar"><i style="width:' + Math.floor((p.progress || 0) * 100) + '%"></i></span>' : '') + '</div>' + btn + '</li>';
  }
  function logHTML() {
    var l = st().log;
    if (!l.length) return '<p class="ld-empty">Nothing downloaded for offline use yet, apart from the app itself.</p>';
    return '<ul class="ld-log">' + l.slice(0, 20).map(function (x) {
      return '<li><div><b>' + esc(x.name) + '</b><small>' + esc(x.why || '') + (x.at ? ' · ' + esc(ago(x.at)) : '') + '</small></div><span class="ld-mb">' + (x.bytes ? mbWhole(x.bytes) : '') + '</span></li>';
    }).join('') + '</ul>';
  }
  function pendingHTML() {
    var l = pending();
    if (!l.length) return '';
    return '<h4>Waiting for your OK</h4><ul class="ld-log">' + l.map(function (x) {
      return '<li><div><b>' + esc(x.name) + '</b><small>' + esc(x.reason || '') + '</small></div><span class="ld-mb">' + (x.bytes ? mbWhole(x.bytes) : '') + '</span><button type="button" class="lp-btn lp-btn-sm" data-ld-ok="' + esc(x.id) + '">Download</button></li>';
    }).join('') + '</ul>';
  }
  function renderSettings(el) {
    if (!el) return null;
    el.classList.add('ld-settings');
    var m = mode();
    el.innerHTML =
      '<h3 id="ld-h">Downloading features for offline use</h3>' +
      '<div class="ld-modes" role="radiogroup" aria-labelledby="ld-h">' +
        '<label class="ld-mode"><input type="radio" name="ld-mode" value="auto"' + (m === 'auto' ? ' checked' : '') + '><span><b>Automatically, as I use them</b><small>Things download quietly when you use a feature or are likely to next.</small></span></label>' +
        '<label class="ld-mode"><input type="radio" name="ld-mode" value="ask"' + (m === 'ask' ? ' checked' : '') + '><span><b>Always ask first</b><small>One short question the first time each feature needs a download.</small></span></label>' +
      '</div>' +
      '<h4>Download now</h4><ul class="ld-packs">' + (manifest ? packs().map(packRowHTML).join('') : '<li class="ld-empty">Sizes are not available right now.</li>') + '</ul>' +
      '<div data-ld-pending>' + pendingHTML() + '</div>' +
      '<h4>What downloaded and why</h4><div data-ld-log>' + logHTML() + '</div>' +
      '<div class="lp-row-btns"><button type="button" class="lp-btn lp-btn-sm" data-ld-forget>Forget what I use</button></div>' +
      '<p class="ld-fine">Which features you open is counted on this device only, to decide what to download next. Nothing leaves this device.</p>';
    if (!el.__ld) {
      el.__ld = true;
      el.addEventListener('change', function (e) { if (e.target.name === 'ld-mode') setMode(e.target.value); });
      el.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-ld-get')) { b.disabled = true; downloadPack(b.getAttribute('data-ld-get')); }
        else if (b.hasAttribute('data-ld-stop')) cancel('pack:' + b.getAttribute('data-ld-stop'));
        else if (b.hasAttribute('data-ld-rm')) {
          if (!b.classList.contains('is-sure')) { b.classList.add('is-sure'); b.textContent = 'Tap again to remove'; return; }
          b.disabled = true; removePack(b.getAttribute('data-ld-rm'));
        } else if (b.hasAttribute('data-ld-ok')) {
          var id = b.getAttribute('data-ld-ok'), it = lastItems[id] || st().wants[id] || { id: id };
          b.disabled = true;
          request(Object.assign({}, it, { confirmed: true })).then(function (r) { if (r.ok) { want(it); scheduleBackground(0); } renderSettings(el); });
        } else if (b.hasAttribute('data-ld-forget')) { var keepMode = mode(); forget(); save({ mode: keepMode }); renderSettings(el); }
      });
      var offs = [on('packs', function () { if (!el.isConnected) return offs.forEach(function (f) { f(); }); repaintPacks(el); }), on('log', function () { if (el.isConnected) el.querySelector('[data-ld-log]').innerHTML = logHTML(); }),
        on('deferred', function () { if (el.isConnected) el.querySelector('[data-ld-pending]').innerHTML = pendingHTML(); })];
    }
    refreshPacks();
    return el;
  }
  function repaintPacks(el) {
    var ul = el.querySelector('.ld-packs');
    if (!ul || !manifest) return;
    var focus = document.activeElement && ul.contains(document.activeElement) ? document.activeElement.closest('[data-ld-pack]') : null;
    var fid = focus && focus.getAttribute('data-ld-pack');
    ul.innerHTML = packs().map(packRowHTML).join('');
    if (fid) { var nb = ul.querySelector('[data-ld-pack="' + fid + '"] button'); if (nb) try { nb.focus({ preventScroll: true }); } catch (e) {} }
  }
  var openD = null;
  function open() {
    if (openD && openD.open) return openD;
    var d = document.createElement('dialog');
    d.className = 'lp-sheet ld-sheet ld-settings-sheet';
    d.setAttribute('aria-label', 'Downloads for offline use');
    d.innerHTML = '<div class="lp-sheet-in" tabindex="-1"><div class="lp-head"><div><h2>Downloads for offline use</h2><p>What LocalEditor keeps on this device so it works without a connection.</p></div><button type="button" class="lp-x" aria-label="Close" data-ld-close><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><section data-ld-body></section></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('[data-ld-close]')) d.close(); });
    d.addEventListener('close', function () {
      setTimeout(function () { d.remove(); }, 0);
      if (/[?&]downloads=1|#downloads$/.test(location.href)) history.replaceState(null, '', location.href.replace(/([?&])downloads=1&?/, '$1').replace(/[?&]$/, '').replace(/#downloads$/, ''));
    });
    renderSettings(d.querySelector('[data-ld-body]'));
    showModal(d);
    openD = d;
    return d;
  }
  /* The studio Settings panel row (le-studio-panels.js calls this). */
  function studioRow(c, host) {
    var b = h('<button type="button" class="btn btn-sm ld-studio-btn"><span>Downloads for offline use</span></button>');
    b.onclick = function () { open(); };
    var p = h('<p class="sx-note ld-studio-note"></p>');
    function paint() {
      var l = packs().filter(function (x) { return !x.empty; }), done = l.filter(function (x) { return x.done; }).length;
      p.textContent = (mode() === 'auto' ? 'Features download as you use them.' : 'LocalEditor asks before each download.') + (l.length ? ' ' + done + ' of ' + l.length + ' downloads are on this device.' : '');
    }
    paint();
    var off = on('packs', function () { if (!b.isConnected) { off(); return; } paint(); });
    host.appendChild(p);
    host.appendChild(b);
    return b;
  }

  /* ---------- Usage recording without touching feature code: studio tools, tool pages, features marked data-le-feature ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-panel-btn],[data-cmd^="tool:"],[data-cmd^="openPanel:"],[data-le-feature]') : null;
    if (!el) return;
    var id = el.getAttribute('data-le-feature') || el.getAttribute('data-panel-btn') || (el.getAttribute('data-cmd') || '').replace(/^(tool|openPanel):/, '');
    if (id && id !== 'more') used('studio.' + id.split(':')[0]);
  }, true);
  function pageSignal() {
    var p = location.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
    var slug = p.split('/').filter(Boolean).slice(-2).join('/') || 'home';
    /* Only pages that need a download count (nothing is written on an ordinary visit, so an erased browser stays empty). */
    if (groupOf('page:' + slug)) used('page:' + slug);
    var tool = new URLSearchParams(location.search).get('tool');
    if (tool) used('studio.' + tool);
  }

  /* ---------- Boot ---------- */
  function boot() {
    var c = sw();
    if (c) {
      c.addEventListener('message', onWorkerMessage);
      /* A pack the worker is still downloading (this page was opened or reloaded meanwhile): show it in the chip. */
      (c.ready || Promise.resolve()).then(function () { return message({ type: 'le-pack-status' }, 2000); }).then(function (list) {
        (list || []).forEach(function (j) { if (j && j.state === 'running') packProgress(Object.assign({ type: 'le-pack-progress' }, j)); });
      }).catch(function () {});
    }
    if (window.LEPwa) wirePwa(); else window.addEventListener('le-pwa-ready', wirePwa);
    try { pageSignal(); } catch (e) {}
    if (/[?&]downloads=1(&|$)/.test(location.search) || location.hash === '#downloads') ready.then(open);
    window.addEventListener('online', function () { scheduleBackground(); });
    if (Object.keys(st().wants).length || wantedGroups().length) scheduleBackground(LIMITS.idleMs * 2);
  }
  function wirePwa() {
    if (!window.LEPwa || wirePwa.done) return;
    wirePwa.done = true;
    var P = window.LEPwa;
    if (P.describeModel) {
      P.describeModel('ocr-engine', { name: 'Text recognition engine', about: 'Reads text in scans and photos' });
      P.describeModel('ocr-eng', { name: 'Text recognition: English', about: 'Language data for reading English text' });
    }
    if (P.on) {
      P.on('erased', function () { lastItems = {}; packState = {}; budgetUse.at = 0; });
      P.on('storage-change', function () { budgetUse.at = 0; refreshPacks(); });
    }
  }

  LE.downloads = {
    __real: true,
    LIMITS: LIMITS,
    mode: mode, setMode: setMode,
    request: request, track: track, pick: pick, packs: packs,
    used: used, want: want, pending: pending, forget: forget, log: function () { return st().log.slice(); }, usage: function () { return usage().f; },
    on: on, open: open, renderSettings: renderSettings, studioRow: studioRow,
    ready: ready.then(function () { return packs(); }), refresh: refreshPacks, manifest: function () { return manifest; },
    connection: connection, autoLimit: autoLimit,
    /* Tests and support: run the background planner now (still obeys mode, connection and battery). */
    _background: function () { lastInput = 0; return background(); },
    _config: function (o) { Object.keys(o || {}).forEach(function (k) { if (k in LIMITS) LIMITS[k] = o[k]; }); return LIMITS; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  try { window.dispatchEvent(new CustomEvent('le-downloads-ready')); } catch (e) {}
})();
