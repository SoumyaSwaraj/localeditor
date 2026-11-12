/* LocalEditor: agent mode in the studio — the watching experience for window.LEAgent (le-agent.js).
   Banner with Pause / Stop / Take over and speed, a labelled pointer that shows each change happen, the activity feed
   with per-change undo, notes for the agent (pins on the canvas), the typed console, the readable outline and the
   consent sheets. Nothing here runs in headless mode. See docs/AGENT-GUIDE.md. */
(function () {
  'use strict';
  var LE = window.LE;
  var AG = window.LEAgent;
  if (!AG || AG.headless) return;
  var I = AG._internal, P = AG._person;
  var PANELS = window.LEStudioPanels = window.LEStudioPanels || {};
  var H = PANELS._hooks = PANELS._hooks || {};
  function hook(name, fn) { (H[name] = H[name] || []).push(fn); }
  var c = null;
  var EL = {};
  var STATE = { tab: 'activity', more: false, noting: false, consoleLog: [], expanded: {}, animating: null, finalVals: null, confirm: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function svg(path) { return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; }
  var IC = {
    pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 4.5l12 7.5-12 7.5z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    hand: '<path d="M7.5 11.5V6a1.5 1.5 0 0 1 3 0v5M10.5 10V4.5a1.5 1.5 0 0 1 3 0V10M13.5 10V5.5a1.5 1.5 0 0 1 3 0V12M16.5 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.5-1.7l1.1 1.4"/>',
    list: '<path d="M9.5 6h11M9.5 12h11M9.5 18h11"/><circle cx="4.8" cy="6" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="18" r="1.1"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>', power: '<path d="M12 3v9"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/>', x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
  };
  function reduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function isPhone() { try { return matchMedia('(max-width: 767px)').matches; } catch (e) { return false; } }
  function sleep(ms) {
    return new Promise(function (res) {
      if (!STATE.animating || ms <= 0) { res(); return; }
      var t = setTimeout(done, ms);
      var a = STATE.animating;
      function done() { clearTimeout(t); var i = a.waiters.indexOf(done); if (i >= 0) a.waiters.splice(i, 1); res(); }
      a.waiters.push(done);
    });
  }
  function timeStr(t) { try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function A() { return I.A; }
  function sess() { return I.session(); }

  /* ---------- geometry: document → stage pixels ---------- */
  function toStage(x, y) {
    var v = c.scene.view();
    var sr = c.E.sceneEl.getBoundingClientRect(), st = c.E.stage.getBoundingClientRect();
    return { x: sr.left - st.left + v.panX + x * v.zoom, y: sr.top - st.top + v.panY + y * v.zoom };
  }
  function rectOn(b) {
    var a = toStage(b.x, b.y), z = c.scene.view().zoom;
    return { x: a.x, y: a.y, w: Math.max(4, b.w * z), h: Math.max(4, b.h * z) };
  }
  function ensureVisible(b) {
    var r = rectOn(b), st = c.E.stage.getBoundingClientRect();
    var pad = 24;
    if (r.x >= -2 && r.y >= -2 && r.x + r.w <= st.width + 2 && r.y + r.h <= st.height + 2) return false;
    if (c.S.autoFit) return false;
    var v = c.scene.view();
    var dx = (st.width / 2) - (r.x + r.w / 2), dy = (st.height / 2) - (r.y + r.h / 2);
    if (Math.abs(dx) < pad && Math.abs(dy) < pad) return false;
    c.scene.setView(v.zoom, v.panX + dx, v.panY + dy);
    return true;
  }

  /* ---------- the DOM ---------- */
  function mount() {
    if (EL.bar) return;
    var stage = c.E.stage;
    EL.bar = h('<div class="sxa-bar" data-sxa role="region" aria-label="Agent mode" hidden></div>');
    EL.fx = h('<div class="sxa-fx" data-sxa aria-hidden="true"></div>');
    EL.pointer = h('<div class="sxa-pointer" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 2.5l15.5 9.2-6.6 1.6-3.3 6.9z"/></svg><span class="sxa-pointer-name"></span><span class="sxa-pointer-say"></span></div>');
    EL.pins = h('<div class="sxa-pins" data-sxa></div>');
    EL.live = h('<div class="sxa-sr" role="status" aria-live="polite" data-sxa></div>');
    EL.outline = h('<section class="sxa-sr" data-sxa aria-label="Design outline"><h2>Design outline</h2><p class="sxa-outline-meta"></p><ol class="sxa-outline"></ol></section>');
    EL.hits = h('<div class="sxa-hits" data-sxa-hits></div>');
    EL.fx.appendChild(EL.pointer);
    stage.appendChild(EL.fx);
    stage.appendChild(EL.pins);
    stage.appendChild(EL.bar);
    document.body.appendChild(EL.live);
    document.body.appendChild(EL.outline);
    var ov = c.E.sceneEl.querySelector('.le-overlay');
    if (ov) c.E.sceneEl.insertBefore(EL.hits, ov); else c.E.sceneEl.appendChild(EL.hits);
    EL.bar.addEventListener('click', onBarClick);
    EL.bar.addEventListener('submit', function (e) { e.preventDefault(); sendQuickNote(); });
    EL.pins.addEventListener('click', onPinClick);
  }
  function modeOn() { return !!A().mode || !!sess(); }
  function renderAll() {
    if (!c) return;
    mount();
    renderBar();
    renderPins();
    renderOutline();
    if (c.S.panel === 'agent') renderPanelBody();
  }
  function renderBar() {
    var s = sess(), a = A();
    var on = modeOn();
    EL.bar.hidden = !on;
    document.documentElement.classList.toggle('sxa-on', on);
    if (!on) { EL.bar.innerHTML = ''; reserve(); return; }
    var queued = a.queue.length + (a.running ? 1 : 0);
    var who, sub, tone = '';
    if (s && a.paused && a.pauseReason === 'person-editing') { who = 'You’re editing — ' + s.name + ' is waiting'; sub = queued ? queued + ' change' + (queued > 1 ? 's' : '') + ' queued. Resume when you’re done.' : 'Resume when you’re done.'; tone = 'is-wait'; }
    else if (s && a.paused) { who = s.name + ' is paused'; sub = queued ? queued + ' change' + (queued > 1 ? 's' : '') + ' waiting' : (s.task || 'Paused'); tone = 'is-wait'; }
    else if (s) { who = s.name + ' is editing'; sub = s.task || 'Working on your design'; tone = 'is-live'; }
    else { who = 'Agent mode is on'; sub = a.ended && a.ended.reason === 'reload' ? 'The session with ' + a.ended.name + ' ended when the page reloaded. Its changes are saved.' : a.ended && a.ended.name ? 'Session with ' + a.ended.name + ' ended' + (a.ended.summary ? ': ' + a.ended.summary : '.') : 'Waiting for an assistant. Nothing is uploaded.'; }
    var speed = a.speed;
    var feedN = I.feed().length;
    var color = s ? s.color : '#7457F0';
    EL.bar.className = 'sxa-bar ' + tone + (STATE.more ? ' is-more' : '');
    EL.bar.style.setProperty('--sxa-agent', color);
    EL.bar.innerHTML =
      '<div class="sxa-row">' +
        '<span class="sxa-dot" aria-hidden="true"></span>' +
        '<div class="sxa-who"><strong>' + esc(who) + '</strong><small>' + esc(sub) + '</small></div>' +
        '<div class="sxa-acts">' +
          (s ? (a.paused ? '<button type="button" class="sxa-btn is-primary" data-act="resume">' + svg(IC.play) + '<span>Resume</span></button>' : '<button type="button" class="sxa-btn" data-act="pause">' + svg(IC.pause) + '<span>Pause</span></button>') +
            '<button type="button" class="sxa-btn sxa-wide-only" data-act="stop" title="Cancel what is queued; the assistant re-plans">' + svg(IC.stop) + '<span>Stop</span></button>' +
            '<button type="button" class="sxa-btn" data-act="takeover" title="End the session and edit yourself">' + svg(IC.hand) + '<span>Take over</span></button>' : '') +
          '<button type="button" class="sxa-btn sxa-icon" data-act="feed" aria-label="Activity (' + feedN + ' changes)">' + svg(IC.list) + (feedN ? '<b class="sxa-count">' + feedN + '</b>' : '') + '</button>' +
          '<button type="button" class="sxa-btn sxa-icon sxa-morebtn" data-act="more" aria-expanded="' + (STATE.more ? 'true' : 'false') + '" aria-label="More agent controls">' + svg(IC.more) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="sxa-row2">' +
        '<form class="sxa-noteform" autocomplete="off"><label class="sxa-sr" for="sxa-quick">Tell the assistant what to change</label>' +
          '<input id="sxa-quick" class="sxa-input" type="text" maxlength="1000" placeholder="Tell the assistant what to change…" enterkeyhint="send">' +
          '<button type="submit" class="sxa-btn sxa-icon" aria-label="Send note">' + svg(IC.send) + '</button></form>' +
        '<div class="sxa-seg" role="group" aria-label="Watch speed">' +
          [['slow', 'Watch slowly'], ['normal', 'Normal'], ['instant', 'Instant']].map(function (o) { return '<button type="button" data-speed="' + o[0] + '" aria-pressed="' + (speed === o[0]) + '">' + o[1] + '</button>'; }).join('') +
        '</div>' +
        (s ? '<button type="button" class="sxa-btn sxa-phone-only" data-act="stop">' + svg(IC.stop) + '<span>Stop</span></button>' : '') +
        (s ? '<button type="button" class="sxa-btn" data-act="undolast">' + svg(IC.undo) + '<span>Undo last change and pause</span></button>' : '') +
        '<button type="button" class="sxa-btn" data-act="pinnote">' + svg(IC.pin) + '<span>Pin a note</span></button>' +
        '<button type="button" class="sxa-btn" data-act="off">' + svg(IC.power) + '<span>Turn off agent mode</span></button>' +
      '</div>';
    reserve();
  }
  /* Keeps the page clear of the banner: the canvas starts below it and refits when the banner changes height. */
  function reserve() {
    var stage = c.E.stage;
    var hgt = EL.bar.hidden ? 0 : Math.ceil(EL.bar.getBoundingClientRect().height) + 12;
    if (STATE.reserved === hgt) return;
    STATE.reserved = hgt;
    stage.classList.toggle('sxa-has-bar', hgt > 0);
    stage.style.setProperty('--sxa-bar-h', hgt + 'px');
    if (c.S.autoFit && c.S.project) requestAnimationFrame(function () { c.fit(); outlineSoon(); });
  }
  function onBarClick(e) {
    var sp = e.target.closest('[data-speed]');
    if (sp) { P.setSpeed(sp.getAttribute('data-speed')); renderBar(); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'pause') P.pause('person');
    else if (act === 'resume') P.resume();
    else if (act === 'stop') { var n = P.stop(); c.toast(n ? 'Stopped. ' + n + ' queued change' + (n > 1 ? 's were' : ' was') + ' cancelled.' : 'Stopped. The assistant will re-plan.'); }
    else if (act === 'takeover') { P.takeOver(); c.toast('You have the design. The assistant’s session ended.'); }
    else if (act === 'feed') openPanel('activity');
    else if (act === 'more') { STATE.more = !STATE.more; renderBar(); }
    else if (act === 'undolast') P.undoLastAndPause().then(function (r) { c.toast(r.ok ? 'Undid the last change. The assistant is paused.' : r.message || 'Nothing to undo.'); renderAll(); });
    else if (act === 'pinnote') startNoting();
    else if (act === 'off') { P.turnOff(); c.toast('Agent mode is off'); }
    renderAll();
  }
  function sendQuickNote() {
    var inp = EL.bar.querySelector('#sxa-quick');
    var text = inp ? inp.value.trim() : '';
    if (!text) return;
    if (!c.S.project) { c.toast('Open a design first.'); return; }
    var sel = c.scene.selection();
    var d = c.doc(), spec = { text: text, x: d.width / 2, y: d.height / 2 };
    if (sel.length === 1) { var l = c.scene.layer(sel[0]); if (l) { spec.layer = l.id; spec.x = l.x + l.w; spec.y = l.y; } }
    var n = P.addNote(spec);
    inp.value = '';
    if (n) { c.toast('Note sent to the assistant'); announce('Note sent: ' + text); }
    renderAll();
  }
  function announce(t) { if (EL.live) { EL.live.textContent = ''; setTimeout(function () { EL.live.textContent = t; }, 30); } }

  /* ---------- pins and notes ---------- */
  function notesOnPage() {
    var p = c.S.project;
    if (!p) return [];
    return I.notesList().filter(function (n) { return n.page === (p.activePage || 0); });
  }
  function pinPos(n) {
    if (n.layer) { var l = c.scene.layer(n.layer); if (l) return toStage(l.x + l.w, l.y); }
    return toStage(n.x, n.y);
  }
  function renderPins() {
    if (!EL.pins) return;
    var list = modeOn() || I.notesList().length ? notesOnPage() : [];
    EL.pins.innerHTML = '';
    list.forEach(function (n, i) {
      var p = pinPos(n);
      var b = h('<button type="button" class="sxa-pin' + (n.status === 'done' ? ' is-done' : '') + '" data-note="' + esc(n.id) + '" aria-label="Note ' + (i + 1) + (n.status === 'done' ? ' (done)' : '') + ': ' + esc(n.text) + '"><span>' + (n.status === 'done' ? svg(IC.check) : (i + 1)) + '</span></button>');
      b.style.transform = 'translate(' + Math.round(p.x - 6) + 'px,' + Math.round(p.y - 38) + 'px)';
      EL.pins.appendChild(b);
    });
  }
  function onPinClick(e) {
    var b = e.target.closest('[data-note]');
    if (!b) return;
    var n = I.notesList().filter(function (x) { return x.id === b.getAttribute('data-note'); })[0];
    if (!n) return;
    var body = h('<div class="sxa-notecard" data-sxa><p class="sxa-note-text"></p>' + (n.layer ? '<p class="sxa-note-meta">On layer <code></code></p>' : '') +
      (n.reply ? '<p class="sxa-note-reply"><b>Reply:</b> <span></span></p>' : '') + '<p class="sxa-note-meta">' + (n.status === 'done' ? 'Done' : 'Open') + ' · ' + esc(timeStr(n.at)) + '</p>' +
      '<div class="sxa-actions"><button type="button" class="btn btn-sm" data-n="del">Delete</button>' + (n.status === 'done' ? '<button type="button" class="btn btn-sm" data-n="reopen">Reopen</button>' : '<button type="button" class="btn btn-sm" data-n="done">Mark done</button>') + '</div></div>');
    body.querySelector('.sxa-note-text').textContent = n.text;
    if (n.layer) body.querySelector('code').textContent = n.layer;
    if (n.reply) body.querySelector('.sxa-note-reply span').textContent = n.reply;
    body.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-n]');
      if (!a) return;
      var k = a.getAttribute('data-n');
      if (k === 'del') P.setNote(n.id, { remove: true });
      else if (k === 'done') P.setNote(n.id, { status: 'done' });
      else if (k === 'reopen') P.setNote(n.id, { status: 'open' });
      c.closePop();
      renderAll();
    });
    c.openPop(b, body, { title: 'Note for the assistant', cls: 'sxa-pop' });
  }
  function startNoting() {
    if (!c.S.project) { c.toast('Open a design first.'); return; }
    STATE.noting = true;
    var cover = h('<div class="sxa-notecover" data-sxa><div class="sxa-notehint">' + svg(IC.pin) + '<span>Tap a layer or a spot for your note</span><button type="button" class="sxa-btn" data-cancel>Cancel</button></div></div>');
    c.E.stage.appendChild(cover);
    cover.querySelector('[data-cancel]').onclick = function (e) { e.stopPropagation(); cover.remove(); STATE.noting = false; };
    cover.addEventListener('pointerdown', function (e) {
      if (e.target.closest('[data-cancel]')) return;
      e.preventDefault();
      var pt = c.docPoint(e.clientX, e.clientY);
      var id = c.scene.hitTest(pt.x, pt.y);
      cover.remove();
      STATE.noting = false;
      noteForm({ x: pt.x, y: pt.y, layer: id || null });
    });
  }
  function noteForm(spec) {
    var l = spec.layer ? c.scene.layer(spec.layer) : null;
    var box = h('<form class="sxa-noteedit" data-sxa><label for="sxa-note-text">' + (l ? 'Note about “' + esc(l.name || l.id) + '”' : 'Note about this spot') + '</label>' +
      '<textarea id="sxa-note-text" class="textarea" rows="3" maxlength="1000" placeholder="For example: make this warmer"></textarea>' +
      '<div class="sxa-actions"><button type="button" class="btn" data-no>Cancel</button><button type="submit" class="btn btn-gold">Pin note</button></div></form>');
    c.openModal('Note for the <em>assistant</em>', box);
    var ta = box.querySelector('textarea');
    setTimeout(function () { ta.focus(); }, 40);
    box.querySelector('[data-no]').onclick = function () { c.closeModal(); };
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = P.addNote({ text: ta.value, x: spec.x, y: spec.y, layer: spec.layer });
      c.closeModal();
      if (n) c.toast('Note pinned. The assistant sees it on its next call.');
      renderAll();
    });
  }

  /* ---------- outline and hit boxes ---------- */
  function renderOutline() {
    if (!EL.outline) return;
    var on = modeOn();
    var ol = EL.outline.querySelector('ol');
    EL.outline.hidden = !on;
    EL.hits.hidden = !on;
    if (!on || !c.S.project) { ol.innerHTML = ''; EL.hits.innerHTML = ''; return; }
    var d = c.doc(), p = c.S.project;
    EL.outline.querySelector('.sxa-outline-meta').textContent = 'Page ' + ((p.activePage || 0) + 1) + ' of ' + p.pages.length + ', ' + d.width + ' × ' + d.height + ' px, background ' + I.colorWord(d.background) + ', ' + d.layers.length + ' layers, back to front. Revision ' + A().rev + '.';
    var items = '', hits = '';
    d.layers.forEach(function (l, i) {
      var what = l.type === 'text' ? 'text “' + String(l.text || '').replace(/\s+/g, ' ').slice(0, 120) + '”' : l.type === 'image' ? (l.slot ? (l.src ? 'photo slot (filled)' : 'empty photo slot') : 'photo') : l.type === 'svg' ? 'graphic' + (l.assetId ? ' ' + l.assetId : '') : l.type;
      var pos = 'x ' + Math.round(l.x) + ', y ' + Math.round(l.y) + ', ' + Math.round(l.w) + ' × ' + Math.round(l.h);
      items += '<li data-le-layer="' + esc(l.id) + '">' + esc(l.id) + (l.name && l.name !== l.id ? ' (' + esc(l.name) + ')' : '') + ' — ' + esc(what) + ' — ' + pos + (l.groupId ? ' — in group ' + esc(l.groupId) : '') + (l.visible === false ? ' — hidden' : '') + '</li>';
      if (l.type === 'group' || l.visible === false) return;
      var r = rectOn(l), sr = c.E.sceneEl.getBoundingClientRect(), st = c.E.stage.getBoundingClientRect();
      hits += '<button type="button" tabindex="-1" class="sxa-hit" data-le-layer="' + esc(l.id) + '" aria-label="' + esc((l.name && l.name !== l.id ? l.name : l.id) + ', ' + what) + '" style="left:' + Math.round(r.x - (sr.left - st.left)) + 'px;top:' + Math.round(r.y - (sr.top - st.top)) + 'px;width:' + Math.round(r.w) + 'px;height:' + Math.round(r.h) + 'px;z-index:' + (i + 1) + (l.rotation ? ';transform:rotate(' + l.rotation + 'deg)' : '') + '"></button>';
    });
    ol.innerHTML = items;
    EL.hits.innerHTML = hits;
    var selEl = c.E.sceneEl.querySelector('.le-sel');
    var sel = c.scene.selection();
    if (selEl) { if (sel.length === 1) selEl.setAttribute('data-le-layer', sel[0]); else selEl.removeAttribute('data-le-layer'); }
  }
  var outlineSoon = (function () { var t; return function () { clearTimeout(t); t = setTimeout(function () { renderOutline(); renderPins(); }, 120); }; })();

  /* ---------- the live view: pointer, highlights, animations ---------- */
  var PACE = { slow: { glide: 700, fx: 720, rest: 420, max: 6 }, normal: { glide: 320, fx: 380, rest: 140, max: 0 }, instant: { glide: 0, fx: 0, rest: 0, max: 0 } };
  function ring(b, kind, ms) {
    var r = rectOn(b);
    var el = h('<div class="sxa-ring is-' + kind + '"></div>');
    el.style.cssText = 'left:' + Math.round(r.x - 4) + 'px;top:' + Math.round(r.y - 4) + 'px;width:' + Math.round(r.w + 8) + 'px;height:' + Math.round(r.h + 8) + 'px;--sxa-ms:' + Math.max(200, ms || 600) + 'ms';
    EL.fx.appendChild(el);
    setTimeout(function () { el.remove(); }, Math.max(900, (ms || 600) + 900));
    return el;
  }
  function pointTo(b, say, ms) {
    var r = rectOn(b);
    var x = r.x + Math.min(r.w * 0.5, r.w - 6), y = r.y + Math.min(r.h * 0.5, Math.max(8, r.h - 6));
    var p = EL.pointer;
    p.classList.add('is-on');
    p.classList.remove('is-rest');
    p.style.transitionDuration = (reduced() ? 0 : ms) + 'ms';
    p.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    var s = p.querySelector('.sxa-pointer-say');
    s.textContent = say || '';
    s.hidden = !say;
  }
  function liveLayer(id) { return c.scene._find ? c.scene._find(id) : null; }
  function mark() { if (c.scene._mark) c.scene._mark(); if (c.scene._layout) c.scene._layout(); }
  function tween(ms, fn) {
    return new Promise(function (res) {
      var a = STATE.animating;
      if (!a || ms <= 0 || reduced()) { fn(1); res(); return; }
      var t0 = performance.now();
      function done() { var i = a.waiters.indexOf(done); if (i >= 0) a.waiters.splice(i, 1); fn(1); res(); }
      a.waiters.push(done);
      (function step(t) {
        if (a.dead) return;
        var k = Math.min(1, (t - t0) / ms);
        var e = 1 - Math.pow(1 - k, 3);
        fn(e);
        if (k < 1) requestAnimationFrame(step); else done();
      })(t0);
    });
  }
  function sayFor(it) {
    var w = it.type === 'text' ? 'text' : it.type === 'image' ? 'photo' : it.type === 'svg' ? 'graphic' : it.type;
    var nm = it.type === 'text' && it.text ? '“' + it.text.replace(/\s+/g, ' ').slice(0, 24) + (it.text.length > 24 ? '…' : '') + '”' : (it.name && it.name !== it.id ? it.name : it.id);
    return ({ added: 'Adding ', removed: 'Removing ', moved: 'Moving ', resized: 'Resizing ', text: 'Editing ', restyled: 'Restyling ', image: 'Placing a photo in ' })[it.kind] + (it.kind === 'added' || it.kind === 'removed' ? w + ' ' : '') + nm;
  }
  /* Data is already committed. Animations only touch the live scene for a moment and always end on the committed values. */
  function present(job) {
    finish();
    var speed = job.speed || 'normal';
    var pace = PACE[speed] || PACE.normal;
    var s = job.session || {};
    renderAll();
    if (!c || !c.S.project) return Promise.resolve();
    var pageIdx = job.afterActive;
    var items = job.diff.items.filter(function (it) { return it.id && it.page === pageIdx; });
    var bgChanged = job.diff.background.indexOf(pageIdx) >= 0 || job.diff.resized.indexOf(pageIdx) >= 0;
    EL.pointer.style.setProperty('--sxa-agent', s.color || '#2F6BFF');
    EL.fx.style.setProperty('--sxa-agent', s.color || '#2F6BFF');
    EL.pointer.querySelector('.sxa-pointer-name').textContent = s.name || job.entry.agent || 'Link';
    announce((s.name || 'The assistant') + ': ' + job.entry.summary);
    if (speed === 'instant' || reduced() && speed !== 'slow') {
      items.slice(0, 20).forEach(function (it) { ring(it.after || it.before, it.kind === 'removed' ? 'removed' : 'pulse', 500); });
      if (bgChanged) ring({ x: 0, y: 0, w: c.doc().width, h: c.doc().height }, 'pulse', 500);
      var last = items[items.length - 1];
      if (last && (last.after || last.before)) { pointTo(last.after || last.before, '', 0); restPointer(); }
      return Promise.resolve().then(thumb(job));
    }
    var a = STATE.animating = { waiters: [], finals: {}, dead: false };
    if (!c.S.noSave) { a.restoreSave = true; c.S.noSave = true; }
    function keepFinal(id) {
      var L = liveLayer(id);
      if (L && !a.finals[id]) a.finals[id] = { x: L.x, y: L.y, opacity: L.opacity, points: L.points ? JSON.stringify(L.points) : null };
      return L;
    }
    function animate(it) {
      var L, f;
      var b = it.after || it.before;
      if (it.kind === 'added') {
        L = keepFinal(it.id);
        ring(b, 'add', pace.fx);
        if (!L || reduced()) return sleep(pace.fx);
        f = a.finals[it.id];
        return tween(pace.fx, function (k) { var l2 = liveLayer(it.id); if (l2) { l2.opacity = f.opacity * k; mark(); } });
      }
      if ((it.kind === 'moved' || it.kind === 'resized') && it.before && !reduced()) {
        L = keepFinal(it.id);
        ring(it.after, 'move', pace.fx);
        if (!L || it.kind === 'resized' || L.type === 'path' || L.type === 'group') return sleep(pace.fx);
        f = a.finals[it.id];
        var x0 = it.before.x, y0 = it.before.y;
        return tween(pace.fx, function (k) { var l2 = liveLayer(it.id); if (l2) { l2.x = x0 + (f.x - x0) * k; l2.y = y0 + (f.y - y0) * k; mark(); } });
      }
      if (it.kind === 'removed') { ring(it.before, 'removed', pace.fx); return sleep(pace.fx); }
      ring(b, 'pulse', pace.fx);
      return sleep(pace.fx);
    }
    /* Show the "before" at once, so nothing appears in its final place before its turn. */
    if (!reduced()) items.forEach(function (it) {
      if (it.kind === 'added') { var L = keepFinal(it.id); if (L) L.opacity = 0; }
      else if (it.kind === 'moved' && it.before) { var M = keepFinal(it.id); if (M && M.type !== 'path' && M.type !== 'group') { M.x = it.before.x; M.y = it.before.y; } }
    });
    mark();
    var chain = Promise.resolve();
    var pageBox = { x: 0, y: 0, w: c.doc().width, h: c.doc().height };
    if (bgChanged) {
      chain = chain.then(function () {
        pointTo({ x: pageBox.w * 0.08, y: pageBox.h * 0.08, w: 2, h: 2 }, job.diff.resized.indexOf(pageIdx) >= 0 ? 'Resizing the page' : 'Changing the background', pace.glide);
        return sleep(pace.glide);
      }).then(function () { ring(pageBox, 'pulse', pace.fx); return sleep(pace.fx * 0.8); });
    }
    var seq = pace.max ? items.slice(0, pace.max) : [];
    var rest = pace.max ? items.slice(pace.max) : items;
    seq.forEach(function (it) {
      chain = chain.then(function () {
        if (a.dead) return null;
        var b = it.after || it.before;
        if (ensureVisible(b)) return sleep(120).then(function () { return b; });
        return b;
      }).then(function (b) {
        if (a.dead || !b) return null;
        pointTo(b, sayFor(it), pace.glide);
        return sleep(pace.glide).then(function () { return a.dead ? null : animate(it); }).then(function () { return sleep(pace.rest); });
      });
    });
    if (rest.length) {
      chain = chain.then(function () {
        if (a.dead) return null;
        var u = unionOf(rest);
        if (u) ensureVisible(u);
        if (u) pointTo(u, rest.length === 1 ? sayFor(rest[0]) : job.entry.summary, pace.glide);
        return sleep(pace.glide).then(function () { return Promise.all(rest.slice(0, 40).map(animate)); }).then(function () { return sleep(pace.rest); });
      });
    }
    return chain.then(function () { finish(); }, function () { finish(); }).then(thumb(job));
  }
  function unionOf(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (it) { var b = it.after || it.before; if (!b) return; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  function thumb(job) {
    return function () {
      return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); }).then(function () {
        try { var cv = c.artboard(160); if (cv) I.entryThumb(job.entry.id, cv.toDataURL('image/jpeg', 0.7)); } catch (e) {}
        restPointer();
        renderAll();
      });
    };
  }
  function restPointer() {
    var p = EL.pointer;
    if (!p) return;
    p.classList.add('is-rest');
    p.querySelector('.sxa-pointer-say').hidden = true;
    clearTimeout(STATE.restT);
    STATE.restT = setTimeout(function () { if (!STATE.animating) p.classList.remove('is-on', 'is-rest'); }, 4000);
  }
  /* Ends any running animation at once, on the committed values. */
  function finish() {
    var a = STATE.animating;
    if (!a) return;
    a.dead = true;
    STATE.animating = null;
    Object.keys(a.finals).forEach(function (id) {
      var L = liveLayer(id), f = a.finals[id];
      if (!L) return;
      L.x = f.x; L.y = f.y; L.opacity = f.opacity;
      if (f.points) L.points = JSON.parse(f.points);
    });
    mark();
    if (a.restoreSave) { c.S.noSave = false; c.markDirty(); }
    a.waiters.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* ---------- consent and permission sheets ---------- */
  function ask(title, html, yes, no, opts) {
    return new Promise(function (res) {
      var decided = false;
      var box = h('<div class="sxa-ask" data-sxa>' + html + '<div class="sxa-actions"><button type="button" class="btn" data-no>' + esc(no) + '</button><button type="button" class="btn btn-gold" data-yes>' + esc(yes) + '</button></div></div>');
      c.openModal(title, box, opts);
      c.S.onModalClose = function () { if (!decided) { decided = true; res(false); } };
      box.querySelector('[data-yes]').onclick = function () { decided = true; res(true); c.closeModal(); };
      box.querySelector('[data-no]').onclick = function () { decided = true; res(false); c.closeModal(); };
    });
  }
  var EXPLAIN = '<p class="sxa-lead">An assistant can now change this design. You can pause or take over at any time. Nothing is uploaded.</p>' +
    '<ul class="sxa-points"><li>You see every change happen, and can undo any of them.</li><li>Your own edits always win.</li><li>It asks before using images from the web.</li></ul>';
  function askConsent(req) {
    return whenUi().then(function () {
      return ask('Let an assistant edit?', '<p class="sxa-lead"><b>' + esc(req.name) + '</b> wants to edit this design' + (req.task ? ':' : '.') + '</p>' + (req.task ? '<p class="sxa-task"></p>' : '') + EXPLAIN.replace('<p class="sxa-lead">An assistant can now change this design. You can pause or take over at any time. Nothing is uploaded.</p>', '<p class="sx-note">You can pause or take over at any time. Nothing is uploaded.</p>'), 'Allow', 'Not now').then(function (yes) {
        if (yes) P.turnOn();
        renderAll();
        return yes;
      });
    }).then(function (v) { return v; });
  }
  function fillTask(req) { var t = document.querySelector('.sxa-task'); if (t) t.textContent = req.task; }
  function askRemote(host, name) {
    var p = ask('Download an image?', '<p class="sxa-lead">' + esc(name) + ' wants to use an image from <b>' + esc(host) + '</b>.</p><p class="sx-note">LocalEditor downloads it only if you agree. That site will see your IP address, like any visit. If you say no, the assistant is told and nothing changes.</p>', 'Download from ' + host, 'Not now');
    return p;
  }
  function askFile(path, name) {
    return new Promise(function (res) {
      var done = false;
      var box = h('<div class="sxa-ask" data-sxa><p class="sxa-lead">' + esc(name) + ' wants to use the file <code></code>.</p><p class="sx-note">The page cannot read files on its own. Choose that file to allow it; it stays on this device.</p>' +
        '<label class="btn btn-gold sxa-file">Choose the file<input type="file" accept="image/*" hidden></label><div class="sxa-actions"><button type="button" class="btn" data-no>Skip</button></div></div>');
      box.querySelector('code').textContent = path;
      c.openModal('Use a file?', box);
      c.S.onModalClose = function () { if (!done) { done = true; res(null); } };
      box.querySelector('input').onchange = function () { var f = this.files && this.files[0]; done = true; c.closeModal(); res(f || null); };
      box.querySelector('[data-no]').onclick = function () { done = true; c.closeModal(); res(null); };
    });
  }
  var uiReady = null, uiReadyRes = null;
  uiReady = new Promise(function (r) { uiReadyRes = r; });
  function whenUi() { return uiReady; }

  /* ---------- the activity panel (Activity · Notes · Console) ---------- */
  function openPanel(tab) {
    if (tab) STATE.tab = tab;
    if (c.S.panel === 'agent') renderPanelBody(); else c.openPanel('agent');
  }
  PANELS.agent = {
    eyebrow: 'Agent mode',
    title: function () { var s = sess(); return s ? s.name + ' · activity' : 'Agent activity'; },
    render: function (cx, body) { EL.panelBody = body; renderPanelBody(); },
    close: function () { EL.panelBody = null; }
  };
  function renderPanelBody() {
    var body = EL.panelBody;
    if (!body || !body.isConnected) return;
    var keepCmd = body.querySelector('#sxa-cmd');
    var cmdVal = keepCmd ? keepCmd.value : STATE.cmdDraft || '';
    var focusCmd = keepCmd && document.activeElement === keepCmd;
    var tabs = [['activity', 'Activity'], ['notes', 'Notes'], ['console', 'Console']];
    body.innerHTML = '';
    var wrap = h('<div class="sxa-panel" data-sxa><div class="sxa-tabs" role="tablist" aria-label="Agent panel">' + tabs.map(function (t) {
      return '<button type="button" role="tab" id="sxa-tab-' + t[0] + '" aria-selected="' + (STATE.tab === t[0]) + '" data-tab="' + t[0] + '">' + t[1] + (t[0] === 'notes' ? countNotes() : '') + '</button>';
    }).join('') + '</div><div class="sxa-tabbody" role="tabpanel" aria-labelledby="sxa-tab-' + STATE.tab + '"></div></div>');
    body.appendChild(wrap);
    var tb = wrap.querySelector('.sxa-tabbody');
    if (STATE.tab === 'activity') renderActivity(tb);
    else if (STATE.tab === 'notes') renderNotes(tb);
    else renderConsole(tb, cmdVal, focusCmd);
    wrap.querySelector('.sxa-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      var ta = body.querySelector('#sxa-cmd');
      if (ta) STATE.cmdDraft = ta.value;
      STATE.tab = b.getAttribute('data-tab');
      renderPanelBody();
    });
  }
  function countNotes() { var n = I.notesList().filter(function (x) { return x.status === 'open'; }).length; return n ? ' <b class="sxa-count">' + n + '</b>' : ''; }
  function renderActivity(tb) {
    var s = sess(), a = A();
    var list = I.feed().slice().reverse();
    var info = P.undoAllInfo(s ? s.id : null);
    var head = h('<div class="sxa-feedhead"><p class="sx-note">' + (s ? esc(s.name) + ' · ' + esc(s.task || 'editing') : a.mode ? 'Agent mode is on. Changes from assistants appear here.' : 'Agent mode is off. Turn it on from the File menu or open the studio with ?agent=1.') + '</p>' +
      (info.ok ? '<button type="button" class="btn btn-sm" data-all>' + svg(IC.undo) + 'Undo everything the agent did</button>' : '') +
      (!a.mode && !s ? '<button type="button" class="btn btn-sm" data-on>Turn on agent mode</button>' : '') + '</div>');
    tb.appendChild(head);
    if (!list.length) { tb.appendChild(h('<p class="sxa-empty">No changes yet. Each batch the assistant applies shows up here in plain words, with a picture and its own undo.</p>')); }
    var ul = h('<ol class="sxa-feed"></ol>');
    list.forEach(function (e) {
      var t = I.thumbOf(e.id);
      var who = e.by === 'person' ? 'You' : e.agent || (e.source === 'link' ? 'Link' : 'Assistant');
      var li = h('<li class="sxa-entry' + (e.undone ? ' is-undone' : '') + (e.by === 'person' ? ' is-person' : '') + '" data-entry="' + esc(e.id) + '">' +
        '<div class="sxa-entry-main">' + (t ? '<img class="sxa-thumb" alt="" src="' + esc(t) + '">' : '<span class="sxa-thumb is-empty"></span>') +
        '<div class="sxa-entry-text"><strong></strong><small>' + esc(who) + ' · ' + esc(timeStr(e.at)) + (e.undone ? ' · undone' : '') + '</small></div></div>' +
        '<div class="sxa-entry-acts">' + (e.ops ? '<button type="button" class="btn btn-sm btn-ghost" data-ops aria-expanded="' + (!!STATE.expanded[e.id]) + '">Details</button>' : '') +
        (e.by !== 'person' && !e.undone ? '<button type="button" class="btn btn-sm" data-undo>' + svg(IC.undo) + 'Undo this change</button>' : '') + '</div>' +
        (STATE.confirm === e.id ? '<div class="sxa-confirm" role="alert"></div>' : '') +
        (STATE.expanded[e.id] && e.ops ? '<pre class="sxa-ops"></pre>' : '') + '</li>');
      li.querySelector('strong').textContent = (e.label && e.label !== e.summary ? e.label + ' — ' : '') + e.summary;
      var pre = li.querySelector('.sxa-ops');
      if (pre) pre.textContent = JSON.stringify(e.ops, function (k, v) { return typeof v === 'string' && v.length > 120 ? v.slice(0, 60) + '…(' + v.length + ' chars)' : v; }, 1);
      var cf = li.querySelector('.sxa-confirm');
      if (cf) {
        var inf = P.undoInfo(e.id);
        cf.innerHTML = '<p>Later changes touched the same layers, so this one cannot be undone on its own.</p><p><b>Undo back to here</b> puts the whole design back to just before it' + (inf.later ? ', which also removes ' + inf.later + ' later change' + (inf.later > 1 ? 's' : '') + (inf.laterByPerson ? ' (' + inf.laterByPerson + ' of them yours)' : '') : '') + '.</p><div class="sxa-actions"><button type="button" class="btn btn-sm" data-cancel>Keep</button><button type="button" class="btn btn-sm" data-tohere>Undo back to here</button></div>';
      }
      ul.appendChild(li);
    });
    tb.appendChild(ul);
    tb.onclick = function (ev) {
      if (ev.target.closest('[data-on]')) { P.turnOn(); renderAll(); return; }
      if (ev.target.closest('[data-all]')) {
        var inf = P.undoAllInfo(s ? s.id : null);
        var go = function () { P.undoSession(s ? s.id : null).then(function (r) { c.toast(r.ok ? 'Undid everything the assistant did' : r.message); renderAll(); }); };
        if (inf.selective) go();
        else ask('Undo everything?', '<p class="sxa-lead">Some of the assistant’s changes were edited afterwards.</p><p class="sx-note">This puts the design back to how it was before the assistant started, including anything you changed since.</p>', 'Undo everything', 'Keep').then(function (y) { if (y) go(); });
        return;
      }
      var li = ev.target.closest('[data-entry]');
      if (!li) return;
      var id = li.getAttribute('data-entry');
      if (ev.target.closest('[data-ops]')) { STATE.expanded[id] = !STATE.expanded[id]; renderPanelBody(); return; }
      if (ev.target.closest('[data-cancel]')) { STATE.confirm = null; renderPanelBody(); return; }
      if (ev.target.closest('[data-tohere]')) { STATE.confirm = null; P.undoEntry(id, 'toHere').then(function (r) { c.toast(r.ok ? 'Design restored to just before that change' : r.message); renderAll(); }); return; }
      if (ev.target.closest('[data-undo]')) {
        var inf2 = P.undoInfo(id);
        if (!inf2.ok) { c.toast(inf2.message || 'Cannot undo that.'); return; }
        if (inf2.selective) P.undoEntry(id, 'selective').then(function (r) { c.toast(r.ok ? 'Undone' : r.message); renderAll(); });
        else { STATE.confirm = id; renderPanelBody(); }
      }
    };
  }
  function renderNotes(tb) {
    var list = I.notesList();
    tb.appendChild(h('<div class="sxa-feedhead"><p class="sx-note">Notes are for the assistant. It reads them on its next call and marks them done.</p><button type="button" class="btn btn-sm" data-add>' + svg(IC.pin) + 'Pin a note</button></div>'));
    if (!list.length) tb.appendChild(h('<p class="sxa-empty">No notes yet. Tap “Pin a note”, then a layer or a spot, and say what you want changed.</p>'));
    var ul = h('<ol class="sxa-notes"></ol>');
    list.slice().sort(function (x, y) { return (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || y.at - x.at; }).forEach(function (n) {
      var li = h('<li class="sxa-noteitem' + (n.status === 'done' ? ' is-done' : '') + '" data-note="' + esc(n.id) + '"><p class="sxa-note-text"></p><p class="sxa-note-meta">' + (n.status === 'done' ? 'Done' : 'Open') + ' · page ' + (n.page + 1) + (n.layer ? ' · <code></code>' : '') + '</p>' + (n.reply ? '<p class="sxa-note-reply"><b>Reply:</b> <span></span></p>' : '') +
        '<div class="sxa-actions"><button type="button" class="btn btn-sm btn-ghost" data-del>Delete</button>' + (n.status === 'done' ? '<button type="button" class="btn btn-sm" data-reopen>Reopen</button>' : '') + '</div></li>');
      li.querySelector('.sxa-note-text').textContent = n.text;
      if (n.layer) li.querySelector('code').textContent = n.layer;
      if (n.reply) li.querySelector('.sxa-note-reply span').textContent = n.reply;
      ul.appendChild(li);
    });
    tb.appendChild(ul);
    tb.onclick = function (ev) {
      if (ev.target.closest('[data-add]')) { if (isPhone()) c.closePanel(); startNoting(); return; }
      var li = ev.target.closest('[data-note]');
      if (!li) return;
      var id = li.getAttribute('data-note');
      if (ev.target.closest('[data-del]')) P.setNote(id, { remove: true });
      else if (ev.target.closest('[data-reopen]')) P.setNote(id, { status: 'open' });
      renderAll();
    };
  }
  function renderConsole(tb, val, focus) {
    var box = h('<form class="sxa-console" data-sxa autocomplete="off">' +
      '<label for="sxa-cmd">Agent command</label>' +
      '<p class="sx-note" id="sxa-cmd-hint">One JSON command, for assistants that cannot run JavaScript. Try {"op":"help"}, {"op":"begin","name":"…","task":"…"}, {"op":"state"} or {"op":"apply","ops":[…]}.</p>' +
      '<textarea id="sxa-cmd" class="textarea sxa-cmd" rows="5" spellcheck="false" aria-describedby="sxa-cmd-hint"></textarea>' +
      '<div class="sxa-actions"><button type="button" class="btn btn-sm btn-ghost" data-clear>Clear output</button><button type="submit" class="btn btn-sm btn-gold" id="sxa-run">Run</button></div>' +
      '<div class="sxa-log" role="log" aria-live="polite" aria-label="Agent console output" id="sxa-log"></div></form>');
    tb.appendChild(box);
    var ta = box.querySelector('textarea');
    ta.value = val || '';
    paintLog(box.querySelector('#sxa-log'));
    if (focus) ta.focus();
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCommand(ta.value); } });
    box.addEventListener('submit', function (e) { e.preventDefault(); runCommand(ta.value); });
    box.querySelector('[data-clear]').onclick = function () { STATE.consoleLog = []; paintLog(box.querySelector('#sxa-log')); };
  }
  function paintLog(el) {
    if (!el) return;
    el.innerHTML = '';
    STATE.consoleLog.slice(-8).forEach(function (r, i, arr) {
      var item = h('<div class="sxa-logitem"><div class="sxa-logcmd"></div><pre class="sxa-logout"' + (i === arr.length - 1 ? ' id="sxa-result" aria-label="Agent result"' : '') + '></pre></div>');
      item.querySelector('.sxa-logcmd').textContent = '> ' + r.cmd;
      item.querySelector('.sxa-logout').textContent = r.out;
      el.appendChild(item);
    });
    el.scrollTop = el.scrollHeight;
  }
  function runCommand(text) {
    text = String(text || '').trim();
    if (!text) return Promise.resolve();
    var entry = { cmd: text.length > 400 ? text.slice(0, 400) + '…' : text, out: 'Running…' };
    STATE.consoleLog.push(entry);
    if (STATE.consoleLog.length > 30) STATE.consoleLog.splice(0, STATE.consoleLog.length - 30);
    paintLog(document.getElementById('sxa-log'));
    return AG.command(text).then(function (res) {
      entry.out = JSON.stringify(res, null, 1);
      var ta = document.getElementById('sxa-cmd');
      if (ta) ta.value = '';
      STATE.cmdDraft = '';
      paintLog(document.getElementById('sxa-log'));
      return res;
    });
  }

  /* ---------- person activity: auto-pause at the next safe point ---------- */
  function ours(t) { return !!(t && t.closest && (t.closest('[data-sxa]') || t.closest('#sx-modal') || t.closest('.sxa-pop'))); }
  function onActivity(e) {
    if (!sess() && !A().queue.length) return;
    if (ours(e.target)) return;
    if (e.type === 'keydown' && /^(Shift|Control|Alt|Meta|Tab)$/.test(e.key)) return;
    finish();
    P.activity(e.type);
  }
  ['pointerdown', 'keydown', 'input', 'change'].forEach(function (t) { document.addEventListener(t, onActivity, true); });
  window.addEventListener('beforeunload', finish, true);
  window.addEventListener('pagehide', finish, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden) finish(); });

  /* ---------- the link channel: #ops= after the person confirms ---------- */
  function bootLinks() {
    var params = new URLSearchParams(I.initial.search);
    var agentParam = params.get('agent');
    var payload = I.opsFromHash(I.initial.hash) || I.opsFromHash(location.hash);
    var chain = Promise.resolve();
    if (agentParam && !A().mode) {
      chain = chain.then(function () {
        return ask('Agent <em>mode</em>', EXPLAIN, 'Turn on agent mode', 'Not now').then(function (yes) {
          if (yes) { P.turnOn(); if (agentParam === 'console') STATE.tab = 'console'; if (!isPhone() || agentParam === 'console') openPanel(); }
          renderAll();
        });
      });
    } else if (agentParam && A().mode) chain = chain.then(function () { openPanel(agentParam === 'console' ? 'console' : null); });
    if (payload) {
      chain = chain.then(function () { return I.decodeOps(payload); }).then(function (res) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
        if (!res.ok) {
          return ask('Assistant link', '<p class="sxa-lead">This link can’t be used.</p><p class="sx-note">' + esc(res.message) + ' Nothing was changed.</p>', 'OK', 'Close').then(function () {});
        }
        var lines = I.describeOps(res.ops);
        var html = '<p class="sxa-lead"><b>' + esc(res.name) + '</b> sent ' + res.ops.length + ' change' + (res.ops.length > 1 ? 's' : '') + ' for ' + (c.S.project ? 'this design' : 'a new design') + '.</p>' +
          (res.task ? '<p class="sxa-task">' + esc(res.task) + '</p>' : '') +
          '<ol class="sxa-oplist">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + (res.ops.length > lines.length ? '<li>…and ' + (res.ops.length - lines.length) + ' more</li>' : '') + '</ol>' +
          '<p class="sx-note">Nothing changes unless you apply. You can undo it afterwards. Nothing is uploaded.</p>';
        return ask('Apply these changes?', html, 'Apply changes', 'Cancel').then(function (yes) {
          if (!yes) { c.toast('Nothing was changed'); return; }
          return AG.applyExternal(res.ops, { source: 'link', name: res.name, label: res.label || res.task || '' }).then(function (r) {
            c.toast(r.ok ? (r.summary || 'Applied') : 'Not applied: ' + (r.errors && r.errors[0] ? r.errors[0].message : r.message));
            STATE.lastLink = r;
            renderAll();
          });
        });
      });
    }
    return chain;
  }

  /* ---------- wiring ---------- */
  I.register({
    askConsent: function (req) { var p = askConsent(req); setTimeout(function () { fillTask(req); }, 0); return p; },
    askRemote: function (host, name) { return whenUi().then(function () { return askRemote(host, name); }); },
    askFile: function (path, name) { return whenUi().then(function () { return askFile(path, name); }); },
    present: function (job) { return present(job); },
    finish: finish,
    animating: function () { return !!STATE.animating; },
    busy: function () { return !!(c && (c.S.pointer || c.S.editing || c.S.panelDrag)); },
    openPanel: function () { openPanel(); }
  });
  ['session', 'pause', 'resume', 'stop', 'feed', 'notes', 'note', 'note-resolved', 'mode', 'speed', 'queue', 'undo', 'batch'].forEach(function (ev) {
    AG.on(ev, function () { if (c) { renderBar(); renderPins(); if (c.S.panel === 'agent' && ev !== 'queue') renderPanelBody(); } });
  });
  AG.on('note-resolved', function (n) { if (c) c.toast('The assistant marked a note done' + (n.reply ? ': ' + n.reply : '')); });
  AG.on('session', function (e) {
    if (!c) return;
    if (e.active) { c.toast((e.session ? e.session.name : 'An assistant') + ' started editing. You can pause or take over at any time.'); if (!isPhone() && c.S.panel !== 'agent') openPanel('activity'); }
    if (!e.active && EL.pointer) EL.pointer.classList.remove('is-on', 'is-rest');
    if (e.reason === 'ended') c.toast((e.name || 'The assistant') + ' finished' + (e.summary ? ': ' + e.summary : '.'), { ms: 5000 });
  });
  hook('init', function (cx) { c = cx; });
  hook('ready', function (cx) {
    c = cx;
    mount();
    renderAll();
    uiReadyRes();
    bootLinks();
  });
  hook('change', function () { if (!STATE.animating) outlineSoon(); });
  hook('zoom', function () { outlineSoon(); });
  hook('select', function () { outlineSoon(); });
  hook('page', function () { outlineSoon(); });
  hook('resize', function () { outlineSoon(); });
  window.addEventListener('resize', outlineSoon);
  window.LEStudioAgent = { runCommand: runCommand, openPanel: openPanel, finish: finish, present: present };
})();
