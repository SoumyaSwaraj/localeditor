/* LocalEditor PDF studio: the loader map (docs/LOADING.md). Loaded after le-pdf-studio-office.js.
   The viewer core (open, view, pages, edit, sign, forms, tools, convert, export) loads first. Protect, Bulk, Office kit,
   Business docs, Scan and Read text load when their panel, start-screen link or deep link is used, when a document
   needs them (Read text checks scanned pages after a PDF opens), or when the device is idle after the first interaction.
   Their rail tabs and start-screen links are drawn here, as data, with the same markup the modules use, so the first
   paint looks the same; each module then finds its entry points already there. */
(function (global) {
  'use strict';
  var LE = global.LE, PS = global.PS, d = document;
  var M = LE && LE.modules;
  if (!M || !PS || !PS.panels) return;
  var JS = '../assets/js/', CSS = '../assets/css/';
  var STROKE = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var I = {
    chevron: '<path d="m9 6 6 6-6 6"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    kit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9h8M8 12h8M8 15h5"/>',
    camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'
  };
  function ic(name) { return I[name] ? STROKE + I[name] + '</svg>' : (PS.icon ? PS.icon(name) : ''); }
  function $(s, r) { return (r || d).querySelector(s); }
  function node(tag, cls, html, attrs) { var n = d.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function railTab(id, html, attrs, before) {
    var rail = $('#ps-rail');
    if (!rail || $('[data-panel="' + id + '"]', rail)) return null;
    var b = node('button', null, html, Object.assign({ type: 'button', role: 'tab', 'aria-selected': 'false', 'data-panel': id, 'data-le-stub': id }, attrs || {}));
    rail.insertBefore(b, $('[data-panel="' + before + '"]', rail) || null);
    return b;
  }
  function q(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  var deepPanel = q('panel');

  /* ---------- Placeholder panels: the frame and a skeleton at once; the real panel replaces them on arrival ---------- */
  function placeholder(mod, id, spec) {
    var real = PS.panels[id];
    if (real && !real.__leStub) return;
    PS.panels[id] = Object.assign({}, spec, {
      __leStub: mod,
      build: function (pane) {
        var go = function () {
          pane.innerHTML = '<div class="le-load-wait" role="status" aria-busy="true"><span class="skel skel-row"></span><span class="skel skel-cards"></span><p class="ps-note le-load-msg">Opening…</p></div>';
          var slow = setTimeout(function () { var p = $('.le-load-msg', pane); if (p) p.textContent = 'Downloading ' + spec.title + '…'; }, 800);
          M.need(mod).then(function () { clearTimeout(slow); rebuild(id); }, function () {
            clearTimeout(slow);
            pane.innerHTML = '';
            pane.appendChild(node('p', 'ps-note le-load-error', navigator.onLine === false ? 'You are offline and ' + spec.title + ' is not kept on this device yet. Connect and try again.' : spec.title + ' did not download. Check your connection and try again.', { role: 'alert' }));
            var b = node('button', 'btn btn-sm le-load-retry', 'Try again', { type: 'button' });
            b.addEventListener('click', go);
            pane.appendChild(b);
          });
        };
        go();
      }
    });
  }
  /* A pane built before its module arrived is built again (the open one at once, the others on their next open). */
  function rebuild(id) {
    var pane = $('.ps-pane[data-pane="' + id + '"]');
    if (pane) pane.parentNode.removeChild(pane);
    if (PS.S && PS.S.panel === id && PS.openPanel) PS.openPanel(id);
  }
  function restub(id) {
    var b = $('#ps-rail [data-le-stub="' + id + '"]');
    var P = PS.panels[id];
    if (!b || !P || P.__leStub || typeof P.init !== 'function') return;
    b.parentNode.removeChild(b);
    P.init();
    var nb = $('#ps-rail [data-panel="' + id + '"]');
    if (nb && PS.S && PS.S.panel === id) { nb.setAttribute('aria-selected', 'true'); nb.classList.add('is-on'); }
  }

  /* ---------- The map ---------- */
  M.defer({ id: 'security', src: JS + 'le-pdf-security.js', css: CSS + 'pdf-security.css', label: 'Protect', idle: 1, features: ['pdf.security'],
    when: function () { return deepPanel === 'security'; }, after: function () { restub('security'); rebuild('security'); } });
  M.defer({ id: 'bulk', src: JS + 'le-pdf-bulk.js', css: CSS + 'pdf-bulk.css', label: 'Bulk & protect', idle: 3, features: ['pdf.bulk'],
    when: function () { return deepPanel === 'bulk'; }, after: function () { rebuild('bulk'); } });
  M.defer({ id: 'office', src: JS + 'le-pdf-office.js', css: CSS + 'pdf-office.css', label: 'Office kit', idle: 2, features: ['pdf.office'],
    when: function () { return deepPanel === 'office'; },
    /* It adds to Tools, Edit and Forms; workflows use the bulk and protect tools, which follow in the background. */
    after: function () { ['office', 'tools', 'edit', 'forms'].forEach(rebuild); M.need('bulk').catch(function () {}); M.need('security').catch(function () {}); } });
  M.defer({ id: 'docs', src: JS + 'le-pdf-docs.js', css: CSS + 'pdf-docs.css', label: 'Business docs', idle: 4, features: ['pdf.docs'],
    when: function () { return deepPanel === 'docs'; }, after: function () { rebuild('docs'); } });
  M.defer({ id: 'ocr', src: JS + 'le-pdf-ocr.js', css: CSS + 'pdf-ocr.css', label: 'Scan & read text', idle: 5, features: ['pdf.scan'],
    when: function () { return deepPanel === 'scan'; }, after: function () { rebuild('scan'); } });
  M.defer({ id: 'scan', src: JS + 'le-pdf-scan.js', css: CSS + 'pdf-scan.css', label: 'Scan with camera', deps: ['ocr'], idle: 6,
    when: function () { return deepPanel === 'scan'; }, after: function () { rebuild('scan'); } });

  /* Panels (title, icon, tone and sheet height are the modules' own). */
  placeholder('security', 'security', { title: 'Protect', icon: 'shield', tone: 'jade', snap: 'full',
    init: function () {
      var b = railTab('security', '<svg viewBox="0 0 24 24" aria-hidden="true">' + I.shield + '</svg><span>Protect</span>', null, 'convert');
      /* With no document, Protect asks for a PDF first (as the module does). */
      if (b) b.addEventListener('click', function (e) {
        if (PS.S.pages.length) return;
        e.preventDefault(); e.stopPropagation();
        PS.pickFiles('.pdf,application/pdf', false).then(function (files) { if (files.length) PS.addFiles(files, { panel: 'security' }); });
      }, true);
    } });
  placeholder('bulk', 'bulk', { title: 'Bulk & protect', icon: 'lock', tone: 'jade', snap: 'half', noDoc: true,
    init: function () { railTab('bulk', ic('lock') + '<span>Bulk</span>', { title: 'Bulk & protect', 'aria-label': 'Bulk and protect' }, 'export'); } });
  placeholder('office', 'office', { title: 'Office kit', icon: 'checklist', tone: 'sapphire', snap: 'half', noDoc: true });
  placeholder('docs', 'docs', { title: 'Business docs', icon: 'file', tone: 'amber', snap: 'half', noDoc: true,
    init: function () { railTab('docs', ic('receipt') + '<span>Docs</span>', { title: 'Invoices and tables', 'aria-label': 'Business documents' }, 'export'); } });
  placeholder('ocr', 'scan', { title: 'Scan & read text', icon: 'search', tone: 'sapphire', snap: 'half', noDoc: true,
    init: function () { railTab('scan', ic('scan') + '<span>Scan</span>', { title: 'Scan and read text', 'aria-label': 'Scan and read text' }, 'export'); } });

  /* Tools lists the Office kit first: it waits for it (a skeleton). Edit and Forms draw at once and gain their office
     rows when it arrives. */
  (function () {
    var t = PS.panels.tools;
    if (!t || typeof t.build !== 'function') return;
    var b = t.build;
    t.build = function (pane) {
      if (M.loaded('office')) return b.apply(this, arguments);
      var self = this, a = arguments;
      pane.innerHTML = '<div class="le-load-wait" role="status" aria-busy="true"><span class="skel skel-row"></span><span class="skel skel-cards"></span></div>';
      M.need('office').then(null, function () {
        /* The other tools still work: list them, and say plainly what is missing with one way to get it. */
        pane.innerHTML = ''; b.apply(self, a);
        var box = node('div', 'le-load-error', '', { role: 'alert' });
        box.appendChild(node('p', 'ps-note', navigator.onLine === false ? 'You are offline and the Office tools are not kept on this device yet. The tools below still work.' : 'The Office tools did not download. Check your connection and try again. The tools below still work.'));
        var r = node('button', 'btn btn-sm le-load-retry', 'Try again', { type: 'button' });
        r.addEventListener('click', function () { t.build.apply(self, a); });
        box.appendChild(r);
        pane.insertBefore(box, pane.firstChild);
      });
    };
  })();

  ['edit', 'forms'].forEach(function (id) {
    var p = PS.panels[id];
    if (!p || typeof p.build !== 'function') return;
    var b = p.build;
    p.build = function () { var r = b.apply(this, arguments); if (!M.loaded('office')) M.need('office').catch(function () {}); return r; };
  });

  /* Start-screen links (the same markup as the modules'; they keep these). */
  function starts() {
    var s = $('.ps-empty .ps-starts');
    if (!s) return;
    var btn = function (cls, html, mod, fn, attrs) {
      var b = node('button', cls, html, Object.assign({ type: 'button' }, attrs || {}));
      b.addEventListener('click', function () { M.need(mod).then(fn, function () { if (PS.say) PS.say('That did not download. Check your connection and try again.', 5000); }); });
      return b;
    };
    if (!$('.pb-entry')) s.parentNode.insertBefore(btn('pb-entry', ic('lock') + '<span><strong>Office jobs</strong> · protect, mail-merge, split, watermark, compress</span>' + ic('chevron'), 'bulk', function () { PS.openPanel('bulk'); }, { 'data-act-bulk': 'open' }), s.nextSibling);
    var after = $('.pb-entry') || s;
    if (!$('.po-entry')) after.parentNode.insertBefore(btn('po-entry', ic('kit') + '<span><strong>Office kit</strong> · fill from my details, compare, packs, stamps, workflows, fingerprints</span>' + ic('chevron'), 'office', function () { PS.openPanel('office'); }, { 'data-act-office': 'open' }), after.nextSibling);
    if (!$('.pd-entry')) after.parentNode.insertBefore(btn('pd-entry', ic('receipt') + '<span><strong>Invoice or quote</strong> · make one, or pull tables out of a PDF</span>' + ic('chevron'), 'docs', function () { PS.openPanel('docs'); }, { 'data-act-docs': 'open' }), after.nextSibling);
    if (!s.querySelector('[data-psn-open]')) {
      var img = s.querySelector('[data-intent="images"]');
      s.insertBefore(btn('ps-start psn-start', '<span class="ic ic-sapphire">' + ic('camera') + '</span><strong>Scan with camera</strong><small>Paper to a clean PDF</small>', 'scan', function () { PS.scan.open(); }, { 'data-psn-open': 'start' }), img ? img.nextSibling : null);
    }
  }
  /* Saved workflows opened from the system (le-pwa.js) ask PS.office.open() straight away. */
  if (!PS.office) PS.office = { __leStub: true, open: function (id) { return M.need('office').then(function () { return PS.office.open(id); }); } };

  /* Read text: after a PDF opens, when the device is idle, it checks for scanned pages (its offer to read them). */
  function watchDocs() {
    var stack = d.getElementById('pv-stack');
    if (!stack || !global.MutationObserver) return;
    var mo = new MutationObserver(function () {
      if (!stack.children.length || M.loaded('ocr')) return;
      mo.disconnect();
      var go = function () { M.need('ocr').catch(function () {}); };
      if (global.requestIdleCallback) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1500);
    });
    mo.observe(stack, { childList: true });
  }
  function boot() { starts(); watchDocs(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); }); else setTimeout(boot, 0);
  /* Warm-up starts once the studio is interactive (after the load event). */
  if (d.readyState === 'complete') M.interactive(); else global.addEventListener('load', function () { M.interactive(); });
})(window);
