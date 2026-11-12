/* LocalEditor PDF studio: workspace, viewer, pages, history, save. Panels live in le-pdf-studio-panels.js. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var PS = global.PS = global.PS || {};
  var d = document;

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || d).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, html) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  var uidN = 0;
  function uid(p) { uidN++; return (p || 'p') + uidN.toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isPhone() { return global.matchMedia('(max-width: 767px)').matches; }
  function isTablet() { return global.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches; }
  function say(msg, ms) { if (global.IT && IT.say) IT.say(msg, ms); }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, ''); }
  function perfLevel() { try { return LE.perf.level(); } catch (e) { return 'high'; } }
  function pdfScaleCap() { try { return LE.perf.pdfScale(); } catch (e) { return 2; } }

  var ICON = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    pages: '<rect x="4" y="3" width="12" height="15" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V7"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    sign: '<path d="M3 17c2.5-2 4-8 6.5-8 2.8 0-.8 8 2.2 8 2 0 2.6-3.5 4.6-3.5 1.6 0 1.7 2.5 4.7 2.5"/><path d="M3 21h18"/>',
    forms: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    tools: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    convert: '<path d="M4 7h12l-3.5-3.5M20 17H8l3.5 3.5"/>',
    export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-3.5-3.5"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.5-3.5"/>',
    fitW: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    fitP: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    rotR: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v6h-6"/>',
    rotL: '<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v6h6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    blank: '<rect x="5" y="3" width="14" height="18" rx="2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    strip: '<rect x="4" y="3" width="6" height="8" rx="1.5"/><rect x="4" y="13" width="6" height="8" rx="1.5"/><path d="M14 5h6M14 9h4M14 15h6M14 19h4"/>',
    reverse: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    pointer: '<path d="M5 3l6.5 17 2.4-7.1L21 10.5z"/>',
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    highlight: '<path d="m9 11-6 6v3h6l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    hlbox: '<rect x="3" y="8" width="18" height="8" rx="1.5" fill="currentColor" fill-opacity=".3"/><path d="M6 12h12"/>',
    pen: '<path d="M12 20h9"/><path d="M3 21c3-1 5.5-3 8-6l6.5-6.5a2.1 2.1 0 0 0-3-3L8 12c-3 2.5-5 5-5 9z"/>',
    shapes: '<rect x="3" y="11" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="7.5" r="4.5"/>',
    square: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
    circle: '<ellipse cx="12" cy="12" rx="8.5" ry="7.5"/>',
    line: '<path d="M5 19 19 5"/>',
    arrow: '<path d="M5 19 19 5M10 5h9v9"/>',
    check: '<path d="M5 12.5l4.5 4.5L19.5 7"/>',
    cross: '<path d="M6 6l12 12M18 6 6 18"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6M7 13h6M7 17h4"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5L5 19"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    stamp: '<path d="M5 21h14M6 17h12v-3a2 2 0 0 0-2-2h-2l-.5-3.5a3 3 0 1 0-3 0L10 12H8a2 2 0 0 0-2 2z"/>',
    eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13 5l6 6-9.3 9.3"/><path d="M22 21H7M5 11l8 8"/>',
    whiteout: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 15l3-6 3 6M8.2 13h3.6"/>',
    redact: '<rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor"/><path d="M3 4h10M3 20h14"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/>',
    front: '<rect x="9" y="9" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".3"/><path d="M15 5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h0"/>',
    back: '<rect x="4" y="4" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".3"/><path d="M9 19v0a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h0"/>',
    bold: '<path d="M7 4h6.5a4 4 0 0 1 0 8H7zM7 12h7.5a4 4 0 0 1 0 8H7z"/>',
    italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 21h16"/>',
    alignL: '<path d="M4 6h16M4 12h10M4 18h14"/>',
    alignC: '<path d="M4 6h16M7 12h10M5 18h14"/>',
    alignR: '<path d="M4 6h16M10 12h10M6 18h14"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    merge: '<path d="M8 3v6a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v4M16 3v6a4 4 0 0 1-4 4"/><path d="m5 6 3-3 3 3M13 6l3-3 3 3"/>',
    images: '<rect x="7" y="3" width="14" height="12" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/><circle cx="12" cy="8" r="1.4"/><path d="m21 12-3.5-3.5L11 15"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    select: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    dropper: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>',
    bookmark: '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M5.5 9h2M5.5 13h2M16.5 9h2M16.5 13h2"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.3" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.3" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.3" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.3" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>',
    cloud: '<path d="M17.5 19H8a5 5 0 1 1 1.2-9.9A6 6 0 0 1 20.8 11 4 4 0 0 1 17.5 19z"/><path d="m9.5 14 2 2 3.5-3.5"/>',
    checklist: '<path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
    allPages: '<rect x="3" y="6" width="9" height="12" rx="1.5"/><rect x="12" y="6" width="9" height="12" rx="1.5"/><path d="M6 14h3M15 14h3"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || ICON.file) + '</svg>';
  }

  var PAGE_PRESETS = {
    A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A5: [419.53, 595.28], A3: [841.89, 1190.55]
  };

  var S = {
    docs: {},
    docNames: {},
    pages: [],
    assets: {},
    sel: {},
    current: 0,
    zoom: 1,
    fit: 'width',
    name: 'document.pdf',
    panel: '',
    tool: 'select',
    toolOpts: {},
    active: null,
    fields: [],
    formValues: {},
    flattenForms: false,
    docTools: { pageNumbers: null, watermark: null, headerFooter: null, bates: null, metadata: null, compress: 'none', flatten: false },
    warnings: [],
    dirty: false
  };
  PS.S = S;
  PS.icon = icon;
  PS.esc = esc;
  PS.el = el;
  PS.$ = $;
  PS.$$ = $$;
  PS.clamp = clamp;
  PS.num = num;
  PS.uid = uid;
  PS.clone = clone;
  PS.frame = frame;
  PS.wait = wait;
  PS.isPhone = isPhone;
  PS.say = say;
  PS.baseName = baseName;
  PS.PAGE_PRESETS = PAGE_PRESETS;
  PS.panels = PS.panels || {};
  PS.overlays = PS.overlays || {};
  PS.placers = PS.placers || {};

  var E = {};

  /* ---------- small UI helpers ---------- */

  function dialog(opts) {
    var dlg = E.dialog;
    return new Promise(function (resolve) {
      dlg.innerHTML = '';
      var form = el('form', 'ps-dlg');
      form.method = 'dialog';
      var head = el('div', 'ps-dlg-head');
      head.appendChild(el('h2', null, esc(opts.title || '')));
      form.appendChild(head);
      var body = el('div', 'ps-dlg-body');
      if (opts.text) body.appendChild(el('p', null, esc(opts.text)));
      if (opts.body) body.appendChild(opts.body);
      form.appendChild(body);
      var foot = el('div', 'ps-dlg-foot');
      if (opts.cancel !== false) {
        var c = el('button', 'btn btn-ghost', esc(opts.cancel || 'Cancel'));
        c.type = 'button';
        c.addEventListener('click', function () { dlg.close('cancel'); });
        foot.appendChild(c);
      }
      var ok = el('button', 'btn btn-gold', esc(opts.ok || 'OK'));
      ok.type = 'submit';
      ok.value = 'ok';
      foot.appendChild(ok);
      form.appendChild(foot);
      dlg.appendChild(form);
      function done() {
        dlg.removeEventListener('close', done);
        resolve(dlg.returnValue === 'ok');
      }
      dlg.addEventListener('close', done);
      dlg.returnValue = '';
      dlg.showModal();
      var first = body.querySelector('input,select,textarea');
      if (first) setTimeout(function () { first.focus(); if (first.select) first.select(); }, 30);
    });
  }
  PS.dialog = dialog;

  function askPassword(name, reason) {
    var wrap = el('div', 'ps-field');
    wrap.innerHTML = '<label for="ps-pw">Password for <strong></strong></label><input class="input" id="ps-pw" type="password" autocomplete="off">' +
      (reason === 'incorrect' ? '<p class="ps-note ps-bad">That password did not work. Try again.</p>' : '<p class="ps-note">This PDF is locked. The password is used on this device only.</p>');
    wrap.querySelector('strong').textContent = name;
    return dialog({ title: 'Unlock PDF', body: wrap, ok: 'Unlock' }).then(function (ok) {
      return ok ? wrap.querySelector('input').value : null;
    });
  }

  var progressState = null;
  function progress(label, cancellable) {
    var box = E.progress;
    box.hidden = false;
    $('.ps-prog-label', box).textContent = label || 'Working…';
    $('.ps-prog-bar i', box).style.width = '0%';
    $('.ps-prog-sub', box).textContent = '';
    var cancelBtn = $('.ps-prog-cancel', box);
    cancelBtn.hidden = !cancellable;
    var st = { cancelled: false };
    progressState = st;
    cancelBtn.onclick = function () { st.cancelled = true; cancelBtn.disabled = true; $('.ps-prog-sub', box).textContent = 'Stopping…'; };
    cancelBtn.disabled = false;
    return {
      set: function (done, total, sub) {
        if (st.cancelled) { var err = new Error('Cancelled'); err.cancelled = true; throw err; }
        var pct = total ? Math.round(done / total * 100) : 0;
        $('.ps-prog-bar i', box).style.width = pct + '%';
        if (sub != null) $('.ps-prog-sub', box).textContent = sub;
        else if (total) $('.ps-prog-sub', box).textContent = done + ' of ' + total;
      },
      cancelled: function () { return st.cancelled; },
      end: function () { if (progressState === st) box.hidden = true; }
    };
  }
  PS.progress = progress;

  var filePicker;
  function pickFiles(accept, multiple) {
    return new Promise(function (resolve) {
      if (!filePicker) {
        filePicker = d.createElement('input');
        filePicker.type = 'file';
        filePicker.hidden = true;
        d.body.appendChild(filePicker);
      }
      filePicker.accept = accept || '';
      filePicker.multiple = !!multiple;
      filePicker.value = '';
      filePicker.onchange = function () { resolve([].slice.call(filePicker.files || [])); };
      filePicker.click();
    });
  }
  PS.pickFiles = pickFiles;

  /* ---------- documents ---------- */

  function isPdfFile(f) { return /pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''); }
  function isImageFile(f) { return /^image\/(png|jpe?g|webp|gif|bmp)/i.test(f.type || '') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || ''); }
  function convertLib() {
    if (LE.convert) return Promise.resolve(LE.convert);
    var root = d.documentElement.getAttribute('data-root') || '';
    return LE.lazy(root + 'assets/js/le-convert.js').then(function () { return LE.convert; });
  }
  PS.convertLib = convertLib;

  async function openPdf(src, name) {
    var password = null;
    for (var tries = 0; tries < 6; tries++) {
      try {
        return await LE.pdf.open(src, { name: name, password: password || undefined });
      } catch (err) {
        if (err && err.code === 'password') {
          password = await askPassword(name, tries ? 'incorrect' : err.reason);
          if (password == null) return null;
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  async function fileToDoc(file) {
    var name = file.name || 'document.pdf';
    if (isPdfFile(file)) return openPdf(file, name);
    if (isImageFile(file)) {
      var imgBytes = await LE.pdf.fromImages([file], { pageSize: 'fit-image', margin: 0 });
      return openPdf(imgBytes, baseName(name) + '.pdf');
    }
    var conv = await convertLib();
    var kind = conv.detect(file);
    if (kind.kind === 'unsupported') throw new Error(kind.note || 'This file type cannot be opened.');
    var out = await conv.toPDF(file, { pageSize: 'A4', orientation: 'auto', margin: 'normal' });
    if (out.warnings && out.warnings.length) S.warnings = S.warnings.concat(out.warnings.map(function (w) { return name + ': ' + w; }));
    return openPdf(out.bytes, baseName(name) + '.pdf');
  }

  function registerDoc(doc, displayName) {
    S.docs[doc.id] = doc;
    S.docNames[doc.id] = displayName || doc.name;
    if (doc.encrypted) say('This PDF is encrypted. Its pages are flattened to images when you save.', 4200);
    loadFields(doc);
    return doc;
  }

  function refsFor(doc) {
    return doc.pages.map(function (p) { return { uid: uid(), docId: doc.id, pageIndex: p.index, rotation: 0, scene: null }; });
  }

  async function addFiles(files, opts) {
    opts = opts || {};
    files = [].slice.call(files || []);
    if (!files.length) return 0;
    /* Device support: one check for the batch (opening PDFs, or converting Office files); invisible when ok. */
    var sup = LE.support && LE.support.gate ? LE.support : null;
    var supId = files.some(function (f) { return !isPdfFile(f) && !isImageFile(f); }) ? 'pdf.convert-office' : 'pdf.open';
    if (sup) {
      var goOn = false;
      await sup.gate(supId, { title: supId === 'pdf.open' ? 'Open PDF' : 'Convert to PDF', run: function () { goOn = true; } });
      if (!goOn) return 0;
    }
    await LE.pdf.ready();
    var pr = files.length > 1 || !isPdfFile(files[0]) ? progress(files.length > 1 ? 'Adding files' : 'Opening ' + files[0].name, false) : null;
    var newRefs = [];
    var firstName = null;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (pr) pr.set(i, files.length, f.name);
      try {
        var doc = await fileToDoc(f);
        if (!doc) continue;
        registerDoc(doc, f.name);
        if (!firstName) firstName = f.name;
        newRefs = newRefs.concat(refsFor(doc));
      } catch (err) {
        say((f.name ? f.name + ': ' : '') + (err && err.message ? err.message : 'could not be opened'), 4200);
        /* A damaged or unsupported file says nothing about the device; running out of memory does. */
        if (sup && /memory|allocation|RangeError/i.test(String((err && (err.name + ' ' + err.message)) || err))) sup.reportFailure(supId, err);
      }
      await frame();
    }
    if (pr) pr.end();
    if (sup && newRefs.length) sup.reportSuccess(supId);
    if (!newRefs.length) return 0;
    var wasEmpty = !S.pages.length;
    var at = opts.at == null ? S.pages.length : clamp(opts.at, 0, S.pages.length);
    commitPages(function () {
      S.pages.splice.apply(S.pages, [at, 0].concat(newRefs));
    }, wasEmpty ? null : 'Add pages');
    if (wasEmpty) {
      H.undo = [];
      H.redo = [];
      updateHistory();
      S.name = baseName(firstName || 'document') + '.pdf';
      E.name.value = S.name;
      showWorkspace(true);
      fitTo('width');
      if (!opts.panel && PS.pendingPanel && PS.panels[PS.pendingPanel]) opts.panel = PS.pendingPanel; /* ?panel= link waiting for a file */
      if (!opts.panel && !isPhone()) openPanel('pages');
    } else {
      say(newRefs.length + ' page' + (newRefs.length === 1 ? '' : 's') + ' added');
      goTo(at);
    }
    if (opts.panel) { openPanel(opts.panel); if (opts.panel === PS.pendingPanel) runDeepJob(); }
    markDirty();
    return newRefs.length;
  }
  PS.addFiles = addFiles;

  /* ?panel=<id>&job=<job> deep links: security views (send, reveal, safety, redact, find) and bulk jobs (protect, merge, split, watermark, compress). */
  function runDeepJob() {
    var panel = PS.pendingPanel, job = PS.pendingJob;
    PS.pendingPanel = PS.pendingJob = null;
    if (!panel || !job) return;
    if (panel === 'security' && PS.security && PS.security.go) {
      if (job === 'find') { PS.security.findOpen = true; PS.security.go('redact'); }
      else if (['send', 'reveal', 'safety', 'redact'].indexOf(job) >= 0) PS.security.go(job);
    } else if (panel === 'bulk' && PS.bulk && PS.bulk.jobs && PS.bulk.jobs.some(function (j) { return j.id === job; })) PS.bulk.open(job);
  }
  function applyDeepLink(panel, job) {
    if (!panel || !PS.panels[panel]) return;
    PS.pendingPanel = panel;
    PS.pendingJob = job || null;
    if (S.pages.length || panel === 'convert' || PS.panels[panel].noDoc) { openPanel(panel); runDeepJob(); return; }
    say('Open a PDF to continue to ' + (PS.panels[panel].title || 'this tool') + '.', 6000); /* the file prompt stays on screen; addFiles carries on to the panel */
  }

  function createBlank(size, landscape) {
    var dims = PAGE_PRESETS[size] || PAGE_PRESETS.A4;
    var w = landscape ? dims[1] : dims[0], h = landscape ? dims[0] : dims[1];
    return { uid: uid(), blank: { w: w, h: h, color: '#ffffff' }, rotation: 0, scene: null };
  }
  PS.createBlank = createBlank;

  function newBlankDocument(size) {
    var wasEmpty = !S.pages.length;
    commitPages(function () { S.pages.push(createBlank(size || 'A4')); }, wasEmpty ? null : 'Add blank page');
    if (wasEmpty) {
      H.undo = [];
      updateHistory();
      S.name = 'Untitled.pdf';
      E.name.value = S.name;
      showWorkspace(true);
      fitTo('width');
    }
    markDirty();
  }
  PS.newBlankDocument = newBlankDocument;

  function refSize(ref) {
    var w, h;
    if (ref.blank) { w = ref.blank.w; h = ref.blank.h; }
    else {
      var doc = S.docs[ref.docId];
      var p = doc && doc.pages[ref.pageIndex];
      w = p ? p.width : 595.28;
      h = p ? p.height : 841.89;
    }
    if (((ref.rotation || 0) / 90) % 2) return { w: h, h: w };
    return { w: w, h: h };
  }
  PS.refSize = refSize;
  function renderKey(ref) {
    return ref.blank ? 'b:' + ref.blank.w + 'x' + ref.blank.h + ':' + ref.blank.color : ref.docId + ':' + ref.pageIndex + ':' + (ref.rotation || 0);
  }
  PS.renderKey = renderKey;
  function refIndex(uidv) {
    for (var i = 0; i < S.pages.length; i++) if (S.pages[i].uid === uidv) return i;
    return -1;
  }
  PS.refIndex = refIndex;
  function refByUid(uidv) { var i = refIndex(uidv); return i >= 0 ? S.pages[i] : null; }
  PS.refByUid = refByUid;

  function rotateCanvas(c, deg) {
    deg = ((deg || 0) % 360 + 360) % 360;
    if (!deg) return c;
    var out = d.createElement('canvas');
    var swap = deg === 90 || deg === 270;
    out.width = swap ? c.height : c.width;
    out.height = swap ? c.width : c.height;
    var ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(c, -c.width / 2, -c.height / 2);
    return out;
  }
  PS.rotateCanvas = rotateCanvas;

  function renderRef(ref, scale) {
    var size = refSize(ref);
    if (ref.blank) {
      var c = d.createElement('canvas');
      c.width = Math.max(2, Math.round(size.w / 8));
      c.height = Math.max(2, Math.round(size.h / 8));
      var ctx = c.getContext('2d');
      ctx.fillStyle = ref.blank.color || '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      return Promise.resolve(c);
    }
    var doc = S.docs[ref.docId];
    if (!doc) return Promise.reject(new Error('Missing document'));
    var maxEdge = (LE.perf && LE.perf.previewMax ? LE.perf.previewMax() : 2400) * 1.4;
    var s = Math.min(scale, maxEdge / Math.max(size.w, size.h));
    return doc.render(ref.pageIndex, s).then(function (cv) { return rotateCanvas(cv, ref.rotation); });
  }
  PS.renderRef = renderRef;

  var thumbCache = {};
  var thumbOrder = [];
  function thumbFor(ref, px) {
    var key = renderKey(ref) + '@' + px;
    if (thumbCache[key]) return Promise.resolve(thumbCache[key]);
    var p;
    if (ref.blank) p = renderRef(ref, 1);
    else {
      var doc = S.docs[ref.docId];
      if (!doc) return Promise.reject(new Error('Missing document'));
      p = doc.thumb(ref.pageIndex, px).then(function (c) { return rotateCanvas(c, ref.rotation); });
    }
    return p.then(function (c) {
      thumbCache[key] = c;
      thumbOrder.push(key);
      if (thumbOrder.length > 240) delete thumbCache[thumbOrder.shift()];
      return c;
    });
  }
  PS.thumbFor = thumbFor;

  /* ---------- history ---------- */

  var H = { undo: [], redo: [] };
  PS.H = H;
  function snapPages() {
    return S.pages.map(function (r) {
      var c = {};
      Object.keys(r).forEach(function (k) { c[k] = r[k]; });
      c.scene = r.scene ? clone(r.scene) : null;
      if (r.blank) c.blank = clone(r.blank);
      return c;
    });
  }
  function commitPages(fn, label) {
    var before = snapPages();
    fn();
    if (label !== null) {
      H.undo.push({ kind: 'pages', pages: before, label: label });
      if (H.undo.length > 80) H.undo.shift();
      H.redo = [];
    }
    syncPages();
    updateHistory();
    markDirty();
  }
  PS.commitPages = commitPages;

  function pushSceneHistory(uidv, before) {
    H.undo.push({ kind: 'scene', uid: uidv, before: before });
    if (H.undo.length > 120) H.undo.shift();
    H.redo = [];
    updateHistory();
  }

  function applyEntry(entry, into) {
    if (entry.kind === 'pages') {
      into.push({ kind: 'pages', pages: snapPages(), label: entry.label });
      S.pages = entry.pages;
      syncPages();
      remountAll();
      return true;
    }
    var ref = refByUid(entry.uid);
    if (!ref) return false;
    into.push({ kind: 'scene', uid: entry.uid, before: JSON.stringify(ref.scene || null) });
    ref.scene = JSON.parse(entry.before);
    reloadScene(entry.uid);
    var idx = refIndex(entry.uid);
    if (idx >= 0 && (idx < S.current - 1 || idx > S.current + 1)) goTo(idx);
    thumbs.refreshBadge(entry.uid);
    return true;
  }
  function commitEditing() {
    Object.keys(scenes).forEach(function (k) {
      var sc = scenes[k];
      if (sc && sc._editing && sc._commitEdit) { try { sc._commitEdit(true); } catch (e) {} }
    });
  }
  function undo() {
    commitEditing();
    while (H.undo.length) { if (applyEntry(H.undo.pop(), H.redo)) break; }
    updateHistory();
    markDirty();
    if (PS.onAfterHistory) PS.onAfterHistory();
  }
  function redo() {
    commitEditing();
    while (H.redo.length) { if (applyEntry(H.redo.pop(), H.undo)) break; }
    updateHistory();
    markDirty();
    if (PS.onAfterHistory) PS.onAfterHistory();
  }
  PS.undo = undo;
  PS.redo = redo;
  function updateHistory() {
    $$('[data-act="undo"]').forEach(function (b) { b.disabled = !H.undo.length; });
    $$('[data-act="redo"]').forEach(function (b) { b.disabled = !H.redo.length; });
  }

  /* ---------- viewer ---------- */

  var PAD = 24, GAP = 18;
  var pageEls = {};
  var scenes = {};
  var lastJSON = {};
  var muted = 0;
  var near = {};
  var io = null;
  var tops = [];
  PS.scenes = scenes;
  PS.pageEls = pageEls;

  function viewerPad() { return isPhone() ? 12 : PAD; }

  function createPageEl(ref) {
    var p = el('div', 'pv-page');
    p.setAttribute('data-uid', ref.uid);
    p.setAttribute('role', 'img');
    var c = d.createElement('canvas');
    c.className = 'pv-img';
    c.width = 1;
    c.height = 1;
    p.appendChild(c);
    var marks = el('div', 'pv-marks');
    p.appendChild(marks);
    var lab = el('span', 'pv-label');
    p.appendChild(lab);
    p._canvas = c;
    p._tok = 0;
    p._scale = 0;
    p._key = '';
    p._marks = marks;
    p._label = lab;
    if (io) io.observe(p);
    return p;
  }

  function syncPages() {
    var keep = {};
    var stack = E.stack;
    var z = S.zoom;
    S.pages.forEach(function (ref, i) {
      var p = pageEls[ref.uid];
      if (!p) { p = createPageEl(ref); pageEls[ref.uid] = p; }
      keep[ref.uid] = 1;
      var size = refSize(ref);
      p.style.width = Math.round(size.w * z) + 'px';
      p.style.height = Math.round(size.h * z) + 'px';
      p._size = size;
      p._label.textContent = String(i + 1);
      p.setAttribute('aria-label', 'Page ' + (i + 1) + ' of ' + S.pages.length);
      if (stack.children[i] !== p) stack.insertBefore(p, stack.children[i] || null);
      var key = renderKey(ref);
      if (p._key !== key) {
        p._key = key;
        p._scale = 0;
        p._tok++;
        if (scenes[ref.uid]) unmountScene(ref.uid);
      }
    });
    Object.keys(pageEls).forEach(function (k) {
      if (keep[k]) return;
      unmountScene(k);
      if (io) io.unobserve(pageEls[k]);
      pageEls[k].remove();
      delete pageEls[k];
      delete near[k];
    });
    Object.keys(S.sel).forEach(function (k) { if (!keep[k]) delete S.sel[k]; });
    E.stack.style.setProperty('--z', z);
    measure();
    S.current = clamp(S.current, 0, Math.max(0, S.pages.length - 1));
    thumbs.sync();
    if (organizer) organizer.sync();
    updateStatus();
    showWorkspace(S.pages.length > 0);
    scheduleRender();
    refreshScenes();
    refreshOverlays();
    if (PS.onPagesChanged) PS.onPagesChanged();
  }
  PS.syncPages = syncPages;

  function measure() {
    tops = S.pages.map(function (ref) {
      var p = pageEls[ref.uid];
      return p ? p.offsetTop : 0;
    });
  }

  function showWorkspace(on) {
    d.body.classList.toggle('ps-has-doc', !!on);
    E.empty.hidden = !!on;
  }

  function maxWidth() {
    var ws = S.pages.map(function (r) { return refSize(r).w; }).sort(function (a, b) { return a - b; });
    return ws.length ? ws[Math.floor((ws.length - 1) / 2)] : 595;
  }
  function fitZoom(mode) {
    var vw = E.viewer.clientWidth - viewerPad() * 2 - 4;
    var vh = E.viewer.clientHeight - viewerPad() * 2;
    var ref = S.pages[S.current] || S.pages[0];
    var size = ref ? refSize(ref) : { w: 595, h: 842 };
    if (mode === 'page') return clamp(Math.min(vw / size.w, vh / size.h), 0.1, 6);
    return clamp(vw / maxWidth(), 0.1, isPhone() ? 4 : 1.6);
  }
  function fitTo(mode) {
    S.fit = mode;
    setZoom(fitZoom(mode), null, true);
    if (mode === 'page') goTo(S.current, true);
  }
  PS.fitTo = fitTo;

  function setZoom(z, anchor, keepFit) {
    z = clamp(z, 0.1, 6);
    if (!keepFit) S.fit = null;
    var v = E.viewer;
    var old = S.zoom;
    var ax = anchor ? anchor.x : v.clientWidth / 2;
    var ay = anchor ? anchor.y : v.clientHeight / 2;
    var cx = v.scrollLeft + ax, cy = v.scrollTop + ay;
    var atTop = v.scrollTop <= 1 && !anchor;
    S.zoom = z;
    S.pages.forEach(function (ref) {
      var p = pageEls[ref.uid];
      if (!p) return;
      var size = p._size || refSize(ref);
      p.style.width = Math.round(size.w * z) + 'px';
      p.style.height = Math.round(size.h * z) + 'px';
    });
    E.stack.style.setProperty('--z', z);
    measure();
    var ratio = z / old;
    v.scrollLeft = Math.max(0, cx * ratio - ax);
    v.scrollTop = atTop ? 0 : Math.max(0, (cy - viewerPad()) * ratio + viewerPad() - ay);
    Object.keys(scenes).forEach(function (k) { scenes[k].fit(); });
    updateZoomLabel();
    clearTimeout(setZoom._t);
    setZoom._t = setTimeout(scheduleRender, 140);
  }
  PS.setZoom = setZoom;

  function updateZoomLabel() {
    $$('[data-zoom-label]').forEach(function (n) { n.textContent = Math.round(S.zoom * 100) + '%'; });
  }

  function goTo(i, instant) {
    if (!S.pages.length) return;
    i = clamp(i | 0, 0, S.pages.length - 1);
    var t = tops[i] != null ? tops[i] : 0;
    E.viewer.scrollTo({ top: Math.max(0, t - viewerPad() + 2), behavior: instant || perfLevel() === 'low' ? 'auto' : 'smooth' });
    S.current = i;
    updateStatus();
  }
  PS.goTo = goTo;

  function currentFromScroll() {
    if (!tops.length) return 0;
    var y = E.viewer.scrollTop + E.viewer.clientHeight * 0.35;
    var lo = 0, hi = tops.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  var scrollRaf = 0;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      var c = currentFromScroll();
      if (c !== S.current) {
        S.current = c;
        updateStatus();
      }
    });
  }

  function updateStatus() {
    var n = S.pages.length;
    $$('[data-page-label]').forEach(function (x) { x.textContent = n ? (S.current + 1) + ' / ' + n : '0 / 0'; });
    var inp = E.pageInput;
    if (inp && d.activeElement !== inp) inp.value = n ? S.current + 1 : '';
    $$('[data-page-total]').forEach(function (x) { x.textContent = String(n); });
    thumbs.setCurrent(S.current);
    if (PS.onStatus) PS.onStatus();
  }
  PS.updateStatus = updateStatus;

  /* render queue */
  var RQ = { busy: false, timer: 0 };
  function scheduleRender() {
    if (RQ.timer) return;
    RQ.timer = setTimeout(pumpRender, 24);
  }
  PS.scheduleRender = scheduleRender;
  function wantScale() {
    var dpr = global.devicePixelRatio || 1;
    return clamp(S.zoom * dpr, 0.25, pdfScaleCap() * Math.max(1, S.zoom));
  }
  function needsRender(p, ref, scale) {
    if (p._key !== renderKey(ref)) return true;
    if (!p._scale) return true;
    if (ref.blank) return false;
    var cap = Math.min(scale, pdfScaleCap());
    return Math.abs(p._scale - cap) / cap > 0.18;
  }
  function pickNext() {
    var vTop = E.viewer.scrollTop, vMid = vTop + E.viewer.clientHeight / 2;
    var scale = wantScale();
    var best = null, bestD = Infinity;
    S.pages.forEach(function (ref, i) {
      if (!near[ref.uid]) return;
      var p = pageEls[ref.uid];
      if (!p || p._busy || p._failed === renderKey(ref)) return;
      if (!needsRender(p, ref, scale)) return;
      var dist = Math.abs((tops[i] || 0) + p.offsetHeight / 2 - vMid);
      if (dist < bestD) { bestD = dist; best = { p: p, ref: ref }; }
    });
    return best;
  }
  async function pumpRender() {
    RQ.timer = 0;
    if (RQ.busy) return;
    RQ.busy = true;
    try {
      for (var guard = 0; guard < 400; guard++) {
        var next = pickNext();
        if (!next) break;
        var p = next.p, ref = next.ref;
        var scale = wantScale();
        var token = ++p._tok;
        var key = renderKey(ref);
        p._busy = true;
        var c = null;
        try { c = await renderRef(ref, scale); }
        catch (e) { p._failed = key; }
        p._busy = false;
        if (!c || p._tok !== token || !p.isConnected) continue;
        c.className = 'pv-img';
        p.replaceChild(c, p._canvas);
        p._canvas = c;
        p._scale = ref.blank ? 1 : Math.min(scale, pdfScaleCap());
        p._key = key;
        var sc = scenes[ref.uid];
        if (sc && !ref.blank) sc.addAsset('__page', c);
        await frame();
        if (perfLevel() === 'low') await wait(16);
      }
      releaseFar();
    } finally {
      RQ.busy = false;
    }
  }
  function releaseFar() {
    var cur = S.current;
    var keepSpan = perfLevel() === 'low' ? 4 : perfLevel() === 'mid' ? 8 : 14;
    S.pages.forEach(function (ref, i) {
      if (near[ref.uid] || Math.abs(i - cur) <= keepSpan) return;
      var p = pageEls[ref.uid];
      if (!p || !p._scale) return;
      var c = d.createElement('canvas');
      c.className = 'pv-img';
      c.width = 1;
      c.height = 1;
      p.replaceChild(c, p._canvas);
      p._canvas = c;
      p._scale = 0;
    });
  }

  function onIntersect(entries) {
    entries.forEach(function (en) {
      var u = en.target.getAttribute('data-uid');
      if (en.isIntersecting) near[u] = 1; else delete near[u];
    });
    scheduleRender();
    refreshScenes();
    refreshOverlays();
  }

  /* ---------- scenes ---------- */

  function pinFit() {
    var host = this.el;
    var w = host.clientWidth;
    if (w < 2) return;
    this._zoom = w / this._doc.width;
    this._panX = 0;
    this._panY = 0;
    this._dirty = true;
    this._layout();
    this._emit('zoom', { zoom: this._zoom, panX: 0, panY: 0 });
    if (this._sel.length) this._emitSelect();
  }

  function editMode() {
    return S.panel === 'edit' || S.panel === 'sign' || S.tool !== 'select';
  }
  PS.editMode = editMode;

  function sceneDoc(ref) {
    var size = refSize(ref);
    var bg = ref.blank ? { type: 'color', color: ref.blank.color || '#ffffff' } : { type: 'image', src: '__page', fit: 'fill', color: '#ffffff' };
    return { v: 1, width: size.w, height: size.h, background: bg, layers: (ref.scene && ref.scene.layers) ? clone(ref.scene.layers) : [] };
  }
  function stripScene(doc) {
    return { v: 1, width: doc.width, height: doc.height, layers: doc.layers || [] };
  }

  var loadedSets = {};
  function assetSets(layers) {
    var sets = {};
    (layers || []).forEach(function (l) {
      if (l.type === 'svg' && l.assetId && l.assetId.indexOf(':') > 0) {
        var s = l.assetId.slice(0, l.assetId.indexOf(':'));
        if (!loadedSets[s]) sets[s] = 1;
      }
    });
    return Object.keys(sets);
  }
  function ensureSets(layers) {
    var sets = assetSets(layers);
    if (!sets.length || !LE.assets || !LE.assets.load) return Promise.resolve(false);
    return Promise.all(sets.map(function (s) {
      return LE.assets.load(s).then(function () { loadedSets[s] = 1; }, function () {});
    })).then(function () { return true; });
  }
  PS.ensureSets = ensureSets;
  function feedAssets(sc, layers) {
    (layers || []).forEach(function (l) {
      if (l.type === 'image' && l.src && S.assets[l.src] && !sc._assets[l.src]) sc.addAsset(l.src, S.assets[l.src]);
    });
    ensureSets(layers).then(function (loaded) {
      if (!loaded || sc._dead) return;
      sc._svgCache = {};
      if (sc._mark) sc._mark();
    });
  }
  PS.feedAssets = feedAssets;

  function mountScene(uidv) {
    if (scenes[uidv]) return scenes[uidv];
    var ref = refByUid(uidv);
    var p = pageEls[uidv];
    if (!ref || !p) return null;
    var host = el('div', 'pv-scene');
    p.insertBefore(host, p._marks);
    var size = refSize(ref);
    var sc = new LE.Scene({ el: host, width: size.w, height: size.h });
    sc.fit = pinFit;
    sc.el.setAttribute('aria-label', 'Page ' + (refIndex(uidv) + 1) + ' annotations');
    var docJ = sceneDoc(ref);
    feedAssets(sc, docJ.layers);
    if (!ref.blank && p._scale) sc.addAsset('__page', p._canvas);
    muted++;
    try { sc.load(docJ); } finally { muted--; }
    lastJSON[uidv] = JSON.stringify(ref.scene || null);
    sc.setTool(sceneToolFor(S.tool));
    sc.on('history', function (info) {
      if (muted || !info.canUndo) return;
      pushSceneHistory(uidv, lastJSON[uidv]);
    });
    sc.on('change', function (e) {
      if (muted) return;
      var r = refByUid(uidv);
      if (!r) return;
      var j = stripScene(e.doc);
      r.scene = j.layers.length ? j : null;
      lastJSON[uidv] = JSON.stringify(r.scene);
      styleNewLayers(sc, uidv, e.doc.layers);
      thumbs.refreshBadge(uidv);
      markDirty();
    });
    sc.on('select', function (e) {
      if (e.ids.length) {
        S.active = uidv;
        Object.keys(scenes).forEach(function (k) {
          if (k !== uidv && scenes[k].selection().length) scenes[k].select([]);
        });
      }
      p.classList.toggle('has-sel', e.ids.length > 0);
      if (PS.renderCtx) PS.renderCtx();
    });
    sc.on('edit-text', function () { if (PS.renderCtx) PS.renderCtx(); });
    scenes[uidv] = sc;
    p.classList.add('has-scene');
    known[uidv] = {};
    docJ.layers.forEach(function (l) { known[uidv][l.id] = 1; });
    return sc;
  }
  PS.mountScene = mountScene;

  function unmountScene(uidv) {
    var sc = scenes[uidv];
    if (!sc) return;
    try { if (sc._editing) sc._commitEdit(true); } catch (e) {}
    sc.destroy();
    if (sc.el && sc.el.parentNode) sc.el.parentNode.removeChild(sc.el);
    delete scenes[uidv];
    var p = pageEls[uidv];
    if (p) p.classList.remove('has-scene', 'has-sel');
    if (S.active === uidv) S.active = null;
  }

  function reloadScene(uidv) {
    var sc = scenes[uidv];
    var ref = refByUid(uidv);
    if (!sc || !ref) { refreshScenes(); return; }
    var docJ = sceneDoc(ref);
    feedAssets(sc, docJ.layers);
    muted++;
    try { sc.load(docJ); } finally { muted--; }
    lastJSON[uidv] = JSON.stringify(ref.scene || null);
    known[uidv] = {};
    docJ.layers.forEach(function (l) { known[uidv][l.id] = 1; });
    var p = pageEls[uidv];
    if (p) p.classList.remove('has-sel');
  }
  PS.reloadScene = reloadScene;

  function remountAll() {
    Object.keys(scenes).forEach(function (k) {
      var sc = scenes[k];
      var ref = refByUid(k);
      if (!ref) { unmountScene(k); return; }
      var size = refSize(ref);
      if (Math.abs(sc._doc.width - size.w) > 0.5 || Math.abs(sc._doc.height - size.h) > 0.5) unmountScene(k);
      else if (lastJSON[k] !== JSON.stringify(ref.scene || null)) reloadScene(k);
    });
    refreshScenes();
  }
  PS.remountAll = remountAll;

  function refreshScenes() {
    var want = editMode();
    var low = perfLevel() === 'low';
    S.pages.forEach(function (ref) {
      var u = ref.uid;
      var has = !!(ref.scene && ref.scene.layers && ref.scene.layers.length);
      var should = near[u] && (want || has);
      if (should && !scenes[u]) mountScene(u);
      else if (!should && scenes[u] && !(scenes[u].selection().length && !low)) unmountScene(u);
    });
    Object.keys(scenes).forEach(function (k) { if (!near[k] && !scenes[k].selection().length) unmountScene(k); });
  }
  PS.refreshScenes = refreshScenes;

  var known = {};
  function styleNewLayers(sc, uidv, layers) {
    var seen = known[uidv] || (known[uidv] = {});
    var fresh = [];
    layers.forEach(function (l) {
      if (!seen[l.id]) { seen[l.id] = 1; fresh.push(l); }
    });
    if (!fresh.length || !PS.styleNew) return;
    fresh.forEach(function (l) {
      var patch = PS.styleNew(l, uidv);
      if (patch) {
        muted++;
        try { sc.update(l.id, patch, { coalesce: 'pointer' }); } finally { muted--; }
        var r = refByUid(uidv);
        if (r) {
          var j = stripScene(sc.toJSON());
          r.scene = j.layers.length ? j : null;
          lastJSON[uidv] = JSON.stringify(r.scene);
        }
      }
    });
  }

  function activeScene() {
    if (S.active && scenes[S.active]) return scenes[S.active];
    var keys = Object.keys(scenes);
    for (var i = 0; i < keys.length; i++) if (scenes[keys[i]].selection().length) return scenes[keys[i]];
    return null;
  }
  PS.activeScene = function () {
    var sc = activeScene();
    return sc && sc.selection().length ? sc : null;
  };
  PS.sceneForCurrent = function () {
    var ref = S.pages[S.current];
    if (!ref) return null;
    if (!near[ref.uid]) near[ref.uid] = 1;
    return mountScene(ref.uid);
  };
  PS.activeUid = function () {
    var sc = activeScene();
    if (sc) {
      for (var k in scenes) if (scenes[k] === sc) return k;
    }
    return S.pages[S.current] ? S.pages[S.current].uid : null;
  };

  function sceneToolFor(tool) {
    if (tool === 'pen' || tool === 'marker' || tool === 'highlighter' || tool === 'eraser') return tool;
    if (tool.indexOf('shape:') === 0) return tool;
    if (tool === 'hlbox' || tool === 'whiteout' || tool === 'redact') return 'shape:rectangle';
    return 'select';
  }

  function setTool(tool, opts) {
    S.tool = tool || 'select';
    S.toolOpts = opts || {};
    var sceneTool = sceneToolFor(S.tool);
    d.body.setAttribute('data-tool', S.tool);
    E.viewer.classList.toggle('is-drawing', sceneTool !== 'select');
    E.viewer.classList.toggle('is-placing', !!PS.placers[S.tool]);
    refreshScenes();
    Object.keys(scenes).forEach(function (k) {
      if (sceneTool !== 'select') scenes[k].select([]);
      scenes[k].setTool(sceneTool);
    });
    var hint = PS.toolHint ? PS.toolHint(S.tool) : '';
    E.hint.hidden = !hint;
    E.hint.textContent = hint || '';
    if (PS.renderCtx) PS.renderCtx();
  }
  PS.setTool = setTool;

  /* pointer routing on the viewer */
  var touchIds = {};
  var pinch = null;
  var manualScroll = null;

  function pagePoint(p, e) {
    var r = p.getBoundingClientRect();
    var size = p._size;
    return { x: (e.clientX - r.left) / r.width * size.w, y: (e.clientY - r.top) / r.height * size.h };
  }
  PS.pagePoint = pagePoint;

  function onDownCapture(e) {
    if (e.pointerType === 'touch') {
      touchIds[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(touchIds).length >= 2) {
        e.stopPropagation();
        Object.keys(scenes).forEach(function (k) {
          var sc = scenes[k];
          if (sc._gesture) {
            Object.keys(sc._pointers || {}).forEach(function (pid) {
              var pt = sc._pointers[pid];
              try { sc._up({ pointerId: +pid, clientX: pt.x, clientY: pt.y, pointerType: 'touch' }); } catch (err) {}
            });
          }
          sc._pointers = {};
        });
        return;
      }
    }
    var p = e.target.closest && e.target.closest('.pv-page');
    if (!p) return;
    var u = p.getAttribute('data-uid');
    var ref = refByUid(u);
    if (!ref) return;
    var idx = refIndex(u);
    if (idx !== S.current && e.button === 0) { S.current = idx; updateStatus(); }
    var placer = PS.placers[S.tool];
    if (placer && (e.button === 0 || e.button == null)) {
      e.preventDefault();
      e.stopPropagation();
      near[u] = 1;
      var sc = mountScene(u);
      if (!sc) return;
      var pt = pagePoint(p, e);
      Promise.resolve(placer(pt, ref, sc)).then(function (spec) {
        if (!spec) return;
        S.active = u;
        if (spec.asset && spec.asset.key) {
          S.assets[spec.asset.key] = spec.asset.value;
          sc.addAsset(spec.asset.key, spec.asset.value);
        }
        var id = sc.add(spec.layer);
        known[u] = known[u] || {};
        known[u][id] = 1;
        if (!S.toolOpts.keep) setTool('select');
        if (spec.edit) editTextLayer(sc, id);
      });
      return;
    }
    S.active = u;
    var sc2 = scenes[u];
    if (sc2 && e.pointerType === 'touch' && sc2.tool() === 'select' && !(e.target.closest && e.target.closest('.le-h'))) {
      var dp = pagePoint(p, e);
      var hit = sc2.hitTest(dp.x, dp.y);
      if (!hit) {
        e.stopPropagation();
        if (sc2.selection().length) sc2.select([]);
        manualScroll = { id: e.pointerId, y: e.clientY, x: e.clientX, top: E.viewer.scrollTop, left: E.viewer.scrollLeft };
      }
    }
  }

  function onMoveCapture(e) {
    if (e.pointerType === 'touch' && touchIds[e.pointerId]) {
      touchIds[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(touchIds).length >= 2) { e.stopPropagation(); return; }
    }
    if (manualScroll && manualScroll.id === e.pointerId) {
      E.viewer.scrollTop = manualScroll.top - (e.clientY - manualScroll.y);
      E.viewer.scrollLeft = manualScroll.left - (e.clientX - manualScroll.x);
      e.stopPropagation();
    }
  }
  function onUpCapture(e) {
    if (e.pointerType === 'touch') delete touchIds[e.pointerId];
    if (manualScroll && manualScroll.id === e.pointerId) { manualScroll = null; e.stopPropagation(); }
  }

  function editTextLayer(sc, id) {
    setTimeout(function () {
      var layer = sc._find && sc._find(id);
      if (layer && sc._startEdit) sc._startEdit(layer);
    }, 30);
  }
  PS.editTextLayer = editTextLayer;

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      var a = e.touches[0], b = e.touches[1];
      pinch = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        zoom: S.zoom,
        mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
      };
      e.preventDefault();
    }
  }
  function onTouchMove(e) {
    if (!pinch || e.touches.length < 2) return;
    e.preventDefault();
    var a = e.touches[0], b = e.touches[1];
    var dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    var r = E.viewer.getBoundingClientRect();
    var z = clamp(pinch.zoom * dist / pinch.dist, 0.2, 5);
    if (Math.abs(z - S.zoom) / S.zoom > 0.02) setZoom(z, { x: pinch.mid.x - r.left, y: pinch.mid.y - r.top });
  }
  function onTouchEnd(e) {
    if (pinch && e.touches.length < 2) { pinch = null; scheduleRender(); }
  }

  function onWheelCapture(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      var r = E.viewer.getBoundingClientRect();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setZoom(S.zoom * Math.exp(-dy * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
      return;
    }
    if (e.target.closest && e.target.closest('.le-scene')) e.stopPropagation();
  }

  function typingTarget(t) {
    if (!t || !t.tagName) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true;
    return !!(t.isContentEditable && !(t.classList && t.classList.contains('le-textedit')));
  }

  function onKeyCapture(e) {
    if (!S.pages.length) return;
    var t = e.target;
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;
    if (E.dialog.open) return;
    if (mod && (key === 's' || key === 'S')) { e.preventDefault(); e.stopPropagation(); save(); return; }
    if (mod && (key === 'f' || key === 'F')) { e.preventDefault(); e.stopPropagation(); if (PS.openFind) PS.openFind(); return; }
    if (typingTarget(t)) return;
    var inEditor = t && t.classList && t.classList.contains('le-textedit');
    if (mod && (key === 'z' || key === 'Z' || key === 'y' || key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      if (key === 'y' || key === 'Y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (inEditor) return;
    if (e.code === 'Space') { e.stopPropagation(); return; }
    if (mod && (key === '=' || key === '+')) { e.preventDefault(); e.stopPropagation(); setZoom(S.zoom * 1.2); return; }
    if (mod && key === '-') { e.preventDefault(); e.stopPropagation(); setZoom(S.zoom / 1.2); return; }
    if (mod && key === '0') { e.preventDefault(); e.stopPropagation(); fitTo('width'); return; }
    var sceneFocused = t && t.closest && t.closest('.le-scene');
    var anySel = !!PS.activeScene();
    if (!sceneFocused && !anySel) {
      if (key === 'PageDown' || (key === 'ArrowRight' && !mod && t === d.body)) { e.preventDefault(); e.stopPropagation(); goTo(S.current + 1); return; }
      if (key === 'PageUp' || (key === 'ArrowLeft' && !mod && t === d.body)) { e.preventDefault(); e.stopPropagation(); goTo(S.current - 1); return; }
      if (key === 'ArrowUp' || key === 'ArrowDown') { e.stopPropagation(); return; }
      if (key === 'Home' && t === d.body) { e.preventDefault(); goTo(0); return; }
      if (key === 'End' && t === d.body) { e.preventDefault(); goTo(S.pages.length - 1); return; }
      if ((key === 'Delete' || key === 'Backspace') && t.closest && t.closest('.ps-thumbs, .ps-organize')) {
        e.preventDefault(); e.stopPropagation(); deletePages(selectedUids()); return;
      }
      if ((key === 'Delete' || key === 'Backspace') && t === d.body) { e.stopPropagation(); return; }
    }
    if (!mod && !e.altKey && PS.shortcut && key.length === 1) {
      if (PS.shortcut(key)) { e.preventDefault(); e.stopPropagation(); }
    }
    if (key === 'Escape') {
      if (S.tool !== 'select') { setTool('select'); e.stopPropagation(); }
      else if (PS.closeFind && PS.closeFind()) e.stopPropagation();
    }
  }

  /* ---------- overlays (search hits, form fields, document tool previews) ---------- */

  var ovTimer = 0;
  function refreshOverlays() {
    if (ovTimer) return;
    ovTimer = requestAnimationFrame(function () {
      ovTimer = 0;
      var names = Object.keys(PS.overlays);
      S.pages.forEach(function (ref, i) {
        var p = pageEls[ref.uid];
        if (!p) return;
        if (!near[ref.uid]) {
          if (p._marks.childNodes.length) p._marks.innerHTML = '';
          p._ovKey = '';
          return;
        }
        names.forEach(function (n) {
          var slot = p._marks.querySelector('[data-ov="' + n + '"]');
          if (!slot) {
            slot = el('div', 'pv-ov pv-ov-' + n);
            slot.setAttribute('data-ov', n);
            p._marks.appendChild(slot);
          }
          try { PS.overlays[n](slot, ref, i, p); } catch (e) { slot.innerHTML = ''; }
        });
      });
    });
  }
  PS.refreshOverlays = refreshOverlays;

  /* ---------- thumbnails ---------- */

  function selectedUids() {
    var list = S.pages.filter(function (r) { return S.sel[r.uid]; }).map(function (r) { return r.uid; });
    if (!list.length && S.pages[S.current]) list = [S.pages[S.current].uid];
    return list;
  }
  PS.selectedUids = selectedUids;
  function selectedIndexes() {
    return selectedUids().map(refIndex).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
  }
  PS.selectedIndexes = selectedIndexes;

  function ThumbList(container, mode) {
    this.box = container;
    this.mode = mode;
    this.items = {};
    this.lastClick = -1;
    var self = this;
    this.io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        self.paint(en.target);
      });
    }, { root: container, rootMargin: '300px' });
    this.bind();
  }
  ThumbList.prototype.px = function () {
    var lvl = perfLevel();
    var base = this.mode === 'grid' ? 260 : 170;
    return lvl === 'low' ? Math.round(base * 0.7) : lvl === 'mid' ? base : Math.round(base * 1.3);
  };
  ThumbList.prototype.sync = function () {
    var box = this.box;
    var keep = {};
    var self = this;
    S.pages.forEach(function (ref, i) {
      var it = self.items[ref.uid];
      if (!it) {
        it = el('div', 'th');
        it.setAttribute('data-uid', ref.uid);
        it.setAttribute('role', 'option');
        it.tabIndex = 0;
        it.innerHTML = '<div class="th-img"><span class="th-sk"></span></div><span class="th-n"></span><span class="th-badge" hidden>' + icon('edit') + '</span><span class="th-check" aria-hidden="true">' + icon('check') + '</span>';
        self.items[ref.uid] = it;
        self.io.observe(it);
      }
      keep[ref.uid] = 1;
      var size = refSize(ref);
      it.style.setProperty('--ar', (size.w / size.h).toFixed(4));
      $('.th-n', it).textContent = String(i + 1);
      it.setAttribute('aria-label', 'Page ' + (i + 1));
      it.setAttribute('aria-selected', S.sel[ref.uid] ? 'true' : 'false');
      it.classList.toggle('is-current', i === S.current);
      if (it._key !== renderKey(ref)) { it._key = renderKey(ref); it._painted = false; }
      self.badge(it, ref);
      if (box.children[i] !== it) box.insertBefore(it, box.children[i] || null);
    });
    Object.keys(this.items).forEach(function (k) {
      if (keep[k]) return;
      self.io.unobserve(self.items[k]);
      self.items[k].remove();
      delete self.items[k];
    });
    this.repaintVisible();
  };
  ThumbList.prototype.badge = function (it, ref) {
    var b = $('.th-badge', it);
    var n = ref.scene && ref.scene.layers ? ref.scene.layers.length : 0;
    b.hidden = !n;
  };
  ThumbList.prototype.refreshBadge = function (u) {
    var it = this.items[u];
    var ref = refByUid(u);
    if (it && ref) this.badge(it, ref);
  };
  ThumbList.prototype.repaintVisible = function () {
    var self = this;
    var r = this.box.getBoundingClientRect();
    Object.keys(this.items).forEach(function (k) {
      var it = self.items[k];
      if (it._painted) return;
      var b = it.getBoundingClientRect();
      if (b.bottom > r.top - 300 && b.top < r.bottom + 300 && b.right > r.left - 300 && b.left < r.right + 300) self.paint(it);
    });
  };
  ThumbList.prototype.paint = function (it) {
    if (it._painted || it._painting) return;
    var ref = refByUid(it.getAttribute('data-uid'));
    if (!ref) return;
    it._painting = true;
    var key = renderKey(ref);
    thumbFor(ref, this.px()).then(function (c) {
      it._painting = false;
      if (it._key !== key) return;
      var img = $('.th-img', it);
      var copy = d.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext('2d').drawImage(c, 0, 0);
      img.innerHTML = '';
      img.appendChild(copy);
      it._painted = true;
    }, function () { it._painting = false; });
  };
  ThumbList.prototype.setCurrent = function (i) {
    var self = this;
    Object.keys(this.items).forEach(function (k) {
      var on = refIndex(k) === i;
      var it = self.items[k];
      if (it.classList.contains('is-current') !== on) it.classList.toggle('is-current', on);
      if (on && self.mode === 'strip' && !self.dragging) {
        var br = self.box.getBoundingClientRect(), ir = it.getBoundingClientRect();
        if (ir.top < br.top || ir.bottom > br.bottom || ir.left < br.left || ir.right > br.right) {
          if (isPhone()) self.box.scrollLeft += ir.left - br.left - br.width / 2 + ir.width / 2;
          else self.box.scrollTop += ir.top - br.top - br.height / 2 + ir.height / 2;
        }
      }
    });
  };
  ThumbList.prototype.updateSel = function () {
    var self = this;
    Object.keys(this.items).forEach(function (k) { self.items[k].setAttribute('aria-selected', S.sel[k] ? 'true' : 'false'); });
    if (PS.onSelectionChange) PS.onSelectionChange();
  };
  ThumbList.prototype.click = function (it, e) {
    var u = it.getAttribute('data-uid');
    var i = refIndex(u);
    var touchSelect = d.body.classList.contains('ps-selecting');
    if (e.shiftKey && this.lastClick >= 0) {
      var a = Math.min(this.lastClick, i), b = Math.max(this.lastClick, i);
      if (!e.ctrlKey && !e.metaKey) S.sel = {};
      for (var k = a; k <= b; k++) S.sel[S.pages[k].uid] = true;
    } else if (e.ctrlKey || e.metaKey || touchSelect) {
      if (S.sel[u]) delete S.sel[u]; else S.sel[u] = true;
      this.lastClick = i;
      if (touchSelect && !Object.keys(S.sel).length) d.body.classList.remove('ps-selecting');
    } else {
      S.sel = {};
      this.lastClick = i;
      if (this.mode === 'grid') S.sel[u] = true;
      goTo(i);
      if (this.mode === 'grid' && e.detail >= 2) closeOrganizer();
    }
    thumbs.updateSel();
    if (organizer) organizer.updateSel();
  };
  ThumbList.prototype.bind = function () {
    var self = this;
    var box = this.box;
    var st = null;
    box.addEventListener('click', function (e) {
      var it = e.target.closest('.th');
      if (!it || self.suppressClick) { self.suppressClick = false; return; }
      self.click(it, e);
    });
    box.addEventListener('keydown', function (e) {
      var it = e.target.closest('.th');
      if (!it) return;
      var i = refIndex(it.getAttribute('data-uid'));
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.click(it, e); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var di = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
        if (e.altKey) {
          var to = clamp(i + di, 0, S.pages.length - 1);
          if (to !== i) movePages([it.getAttribute('data-uid')], di > 0 ? to + 1 : to);
          var again = self.items[it.getAttribute('data-uid')];
          if (again) again.focus();
          return;
        }
        var nx = S.pages[clamp(i + di, 0, S.pages.length - 1)];
        if (nx && self.items[nx.uid]) { self.items[nx.uid].focus(); goTo(refIndex(nx.uid)); }
      }
    });
    box.addEventListener('scroll', function () {
      if (self._rp) return;
      self._rp = requestAnimationFrame(function () { self._rp = 0; self.repaintVisible(); });
    }, { passive: true });
    box.addEventListener('pointerdown', function (e) {
      var it = e.target.closest('.th');
      if (!it || e.button > 0) return;
      st = { it: it, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', active: false, timer: 0 };
      if (st.touch) {
        st.timer = setTimeout(function () {
          if (!st || st.moved) return;
          var u = it.getAttribute('data-uid');
          if (!S.sel[u]) { S.sel[u] = true; thumbs.updateSel(); if (organizer) organizer.updateSel(); }
          d.body.classList.add('ps-selecting');
          if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
          self.beginDrag(st, e);
        }, 380);
      }
    });
    global.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var dist = Math.hypot(e.clientX - st.x, e.clientY - st.y);
      if (!st.active) {
        if (st.touch) { if (dist > 10) { st.moved = true; clearTimeout(st.timer); st = null; } return; }
        if (dist > 6) self.beginDrag(st, e);
        else return;
      }
      self.moveDrag(st, e);
    });
    function end(e) {
      if (!st || (e && e.pointerId !== st.id)) return;
      clearTimeout(st.timer);
      if (st.active) self.endDrag(st, e && e.type === 'pointercancel');
      st = null;
    }
    global.addEventListener('pointerup', end);
    global.addEventListener('pointercancel', end);
    box.addEventListener('touchmove', function (e) { if (self.dragging) e.preventDefault(); }, { passive: false });
    box.addEventListener('contextmenu', function (e) { if (e.target.closest('.th')) e.preventDefault(); });
  };
  ThumbList.prototype.beginDrag = function (st, e) {
    st.active = true;
    this.dragging = true;
    var u = st.it.getAttribute('data-uid');
    if (!S.sel[u]) { S.sel = {}; S.sel[u] = true; this.updateSel(); }
    var count = selectedUids().length;
    var ghost = st.it.cloneNode(true);
    ghost.classList.add('th-ghost');
    ghost.style.width = st.it.offsetWidth + 'px';
    if (count > 1) ghost.appendChild(el('span', 'th-count', String(count)));
    d.body.appendChild(ghost);
    st.ghost = ghost;
    st.ox = st.it.offsetWidth / 2;
    st.oy = st.it.offsetHeight / 2;
    var mark = el('div', 'th-drop');
    this.box.appendChild(mark);
    st.mark = mark;
    this.box.classList.add('is-dragging');
    this.moveDrag(st, e);
  };
  ThumbList.prototype.dropIndex = function (e) {
    var horizontal = this.mode === 'grid' || isPhone();
    var best = S.pages.length, items = this.box.querySelectorAll('.th');
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      if (horizontal) {
        if (e.clientY < r.top) { best = i; break; }
        if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) { best = i; break; }
      } else if (e.clientY < r.top + r.height / 2) { best = i; break; }
    }
    return best;
  };
  ThumbList.prototype.moveDrag = function (st, e) {
    st.ghost.style.transform = 'translate(' + (e.clientX - st.ox) + 'px,' + (e.clientY - st.oy) + 'px) rotate(-3deg)';
    var idx = this.dropIndex(e);
    st.to = idx;
    var items = this.box.querySelectorAll('.th');
    var br = this.box.getBoundingClientRect();
    var ref = items[Math.min(idx, items.length - 1)];
    if (ref) {
      var r = ref.getBoundingClientRect();
      var after = idx >= items.length;
      var horizontal = this.mode === 'grid' || isPhone();
      if (horizontal) {
        st.mark.className = 'th-drop is-v';
        st.mark.style.left = ((after ? r.right + 4 : r.left - 6) - br.left + this.box.scrollLeft) + 'px';
        st.mark.style.top = (r.top - br.top + this.box.scrollTop) + 'px';
        st.mark.style.height = r.height + 'px';
        st.mark.style.width = '';
      } else {
        st.mark.className = 'th-drop is-h';
        st.mark.style.top = ((after ? r.bottom + 4 : r.top - 6) - br.top + this.box.scrollTop) + 'px';
        st.mark.style.left = (r.left - br.left) + 'px';
        st.mark.style.width = r.width + 'px';
        st.mark.style.height = '';
      }
    }
    var edge = 48, speed = 0;
    var vertical = !(isPhone() && this.mode === 'strip');
    if (vertical) {
      if (e.clientY < br.top + edge) speed = -12; else if (e.clientY > br.bottom - edge) speed = 12;
    } else if (e.clientX < br.left + edge) speed = -12; else if (e.clientX > br.right - edge) speed = 12;
    var self = this;
    cancelAnimationFrame(this._as);
    if (speed) {
      var step = function () {
        if (!self.dragging) return;
        if (vertical) self.box.scrollTop += speed; else self.box.scrollLeft += speed;
        self._as = requestAnimationFrame(step);
      };
      this._as = requestAnimationFrame(step);
    }
  };
  ThumbList.prototype.endDrag = function (st, cancelled) {
    this.dragging = false;
    cancelAnimationFrame(this._as);
    if (st.ghost) st.ghost.remove();
    if (st.mark) st.mark.remove();
    this.box.classList.remove('is-dragging');
    this.suppressClick = true;
    var self = this;
    setTimeout(function () { self.suppressClick = false; }, 60);
    if (cancelled || st.to == null) return;
    movePages(selectedUids(), st.to);
  };

  function movePages(uids, to) {
    var set = {};
    uids.forEach(function (u) { set[u] = 1; });
    var before = 0;
    for (var i = 0; i < to && i < S.pages.length; i++) if (set[S.pages[i].uid]) before++;
    var moving = S.pages.filter(function (r) { return set[r.uid]; });
    var rest = S.pages.filter(function (r) { return !set[r.uid]; });
    var at = clamp(to - before, 0, rest.length);
    var next = rest.slice(0, at).concat(moving, rest.slice(at));
    var same = next.every(function (r, i) { return r === S.pages[i]; });
    if (same) return;
    commitPages(function () { S.pages = next; }, 'Move pages');
    S.current = refIndex(moving[0].uid);
    updateStatus();
    say(moving.length > 1 ? moving.length + ' pages moved' : 'Page moved to ' + (S.current + 1));
  }
  PS.movePages = movePages;

  function deletePages(uids) {
    if (!uids.length) return;
    if (uids.length >= S.pages.length) { say('A PDF needs at least one page'); return; }
    var set = {};
    uids.forEach(function (u) { set[u] = 1; });
    commitPages(function () {
      S.pages = S.pages.filter(function (r) { return !set[r.uid]; });
      S.sel = {};
    }, 'Delete pages');
    say(uids.length + ' page' + (uids.length === 1 ? '' : 's') + ' deleted · Undo with Ctrl+Z');
  }
  PS.deletePages = deletePages;

  function transformScene(scene, w, h, angle) {
    if (!scene || !scene.layers || !scene.layers.length) return scene;
    var a = ((angle % 360) + 360) % 360;
    if (!a) return scene;
    var out = clone(scene);
    var nw = a === 180 ? w : h, nh = a === 180 ? h : w;
    out.layers.forEach(function (l) {
      var cx = l.x + l.w / 2, cy = l.y + l.h / 2, nx, ny;
      if (a === 90) { nx = h - cy; ny = cx; }
      else if (a === 180) { nx = w - cx; ny = h - cy; }
      else { nx = cy; ny = w - cx; }
      l.x = nx - l.w / 2;
      l.y = ny - l.h / 2;
      l.rotation = ((l.rotation || 0) + a) % 360;
    });
    out.width = nw;
    out.height = nh;
    return out;
  }

  function rotatePages(uids, angle) {
    var set = {};
    uids.forEach(function (u) { set[u] = 1; });
    commitPages(function () {
      S.pages = S.pages.map(function (r) {
        if (!set[r.uid]) return r;
        var size = refSize(r);
        var c = {};
        Object.keys(r).forEach(function (k) { c[k] = r[k]; });
        c.rotation = (((r.rotation || 0) + angle) % 360 + 360) % 360;
        c.scene = transformScene(r.scene, size.w, size.h, angle);
        return c;
      });
    }, 'Rotate pages');
    remountAll();
  }
  PS.rotatePages = rotatePages;

  function duplicatePages(uids) {
    var set = {};
    uids.forEach(function (u) { set[u] = 1; });
    var firstNew = null;
    commitPages(function () {
      var out = [];
      S.pages.forEach(function (r) {
        out.push(r);
        if (set[r.uid]) {
          var c = {};
          Object.keys(r).forEach(function (k) { c[k] = r[k]; });
          c.uid = uid();
          c.scene = r.scene ? clone(r.scene) : null;
          if (r.blank) c.blank = clone(r.blank);
          if (c.scene) c.scene.layers.forEach(function (l) { l.id = uid('l'); });
          if (!firstNew) firstNew = c.uid;
          out.push(c);
        }
      });
      S.pages = out;
    }, 'Duplicate pages');
    say(uids.length + ' page' + (uids.length === 1 ? '' : 's') + ' duplicated');
  }
  PS.duplicatePages = duplicatePages;

  function insertBlank(size, landscape, at) {
    var ref = createBlank(size, landscape);
    if (size === 'same') {
      var cur = S.pages[S.current];
      var s = cur ? refSize(cur) : { w: 595.28, h: 841.89 };
      ref.blank.w = s.w;
      ref.blank.h = s.h;
    }
    var pos = at == null ? S.current + 1 : at;
    commitPages(function () { S.pages.splice(pos, 0, ref); }, 'Insert blank page');
    goTo(pos);
  }
  PS.insertBlank = insertBlank;

  function reorderAll(next, label) {
    commitPages(function () { S.pages = next; }, label);
  }
  PS.reorderAll = reorderAll;

  /* ---------- organizer grid ---------- */

  var organizer = null;
  function openOrganizer() {
    if (!S.pages.length) return;
    E.organize.hidden = false;
    d.body.classList.add('ps-organizing');
    if (!organizer) {
      organizer = new ThumbList($('.ps-org-grid', E.organize), 'grid');
    }
    organizer.sync();
    $$('[data-act="organize"]').forEach(function (b) { b.setAttribute('aria-pressed', 'true'); });
    if (PS.onOrganizer) PS.onOrganizer(true);
  }
  function closeOrganizer() {
    E.organize.hidden = true;
    d.body.classList.remove('ps-organizing');
    $$('[data-act="organize"]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    if (PS.onOrganizer) PS.onOrganizer(false);
    setTimeout(function () { goTo(S.current, true); }, 20);
  }
  PS.openOrganizer = openOrganizer;
  PS.closeOrganizer = closeOrganizer;

  /* ---------- panels & sheets ---------- */

  function openPanel(name) {
    if (!name || !PS.panels[name]) name = '';
    var prev = S.panel;
    if (prev && PS.panels[prev] && PS.panels[prev].hide) PS.panels[prev].hide();
    S.panel = name;
    d.body.setAttribute('data-panel', name);
    $$('.ps-rail [data-panel]').forEach(function (b) {
      var on = b.getAttribute('data-panel') === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
    });
    if (name) {
      var P = PS.panels[name];
      E.panelTitle.innerHTML = '<span class="ic ic-' + (P.tone || 'violet') + '">' + icon(P.icon) + '</span><span>' + esc(P.title) + '</span>';
      $$('.ps-pane', E.panelBody).forEach(function (pane) { pane.hidden = pane.getAttribute('data-pane') !== name; });
      var pane = $('.ps-pane[data-pane="' + name + '"]', E.panelBody);
      if (!pane) {
        pane = el('div', 'ps-pane');
        pane.setAttribute('data-pane', name);
        E.panelBody.appendChild(pane);
        P.build(pane);
      }
      E.panelBody.scrollTop = 0;
      if (P.show) P.show(pane);
      if (isPhone()) setSheet(P.snap || 'half');
    } else if (isPhone()) setSheet('closed');
    placeThumbs();
    refreshScenes();
    if (S.tool !== 'select' && name !== 'edit' && name !== 'sign' && name !== 'forms') setTool('select');
    if (PS.renderCtx) PS.renderCtx();
    if (!isPhone()) setTimeout(function () { if (S.fit) fitTo(S.fit); }, 0);
  }
  PS.openPanel = openPanel;

  var sheet = { state: 'closed' };
  function setSheet(state) {
    sheet.state = state;
    E.panel.setAttribute('data-snap', state);
    E.panel.style.transform = '';
    d.body.classList.toggle('ps-sheet-open', state !== 'closed');
    if (state === 'closed' && S.panel && isPhone()) {
      var P = PS.panels[S.panel];
      if (P && P.hide) P.hide();
      S.panel = '';
      d.body.setAttribute('data-panel', '');
      $$('.ps-rail [data-panel]').forEach(function (b) { b.setAttribute('aria-selected', 'false'); b.classList.remove('is-on'); });
      placeThumbs();
      if (PS.renderCtx) PS.renderCtx();
    }
  }
  PS.setSheet = setSheet;

  function bindSheet() {
    var handle = E.sheetHandle;
    var st = null;
    handle.addEventListener('pointerdown', function (e) {
      if (!isPhone()) return;
      st = { y: e.clientY, h: E.panel.getBoundingClientRect().height, t: Date.now() };
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      E.panel.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', function (e) {
      if (!st) return;
      var dy = e.clientY - st.y;
      E.panel.style.transform = dy > 0 ? 'translateY(' + dy + 'px)' : '';
      if (dy < 0) E.panel.style.height = Math.min(global.innerHeight * 0.9, st.h - dy) + 'px';
    });
    function end(e) {
      if (!st) return;
      var dy = e.clientY - st.y;
      var v = dy / Math.max(1, Date.now() - st.t);
      E.panel.classList.remove('is-dragging');
      E.panel.style.height = '';
      var cur = sheet.state;
      if (dy > 80 || v > 0.6) setSheet(cur === 'full' && dy < 260 ? 'half' : 'closed');
      else if (dy < -40 || v < -0.5) setSheet('full');
      else setSheet(cur);
      st = null;
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('click', function () {
      if (!isPhone()) return;
      setSheet(sheet.state === 'half' ? 'full' : 'half');
    });
  }

  function placeThumbs() {
    var list = E.thumbList;
    var slot = $('[data-thumb-slot]', E.panelBody);
    if (isPhone() && S.panel === 'pages' && slot) {
      if (list.parentNode !== slot) slot.appendChild(list);
    } else if (list.parentNode !== E.thumbs) E.thumbs.appendChild(list);
    thumbs.repaintVisible();
  }
  PS.placeThumbs = placeThumbs;

  /* ---------- form fields ---------- */

  function loadFields(doc) {
    doc.formFields().then(function (fields) {
      fields.forEach(function (f) { f.docId = doc.id; f.key = doc.id + '|' + f.name; });
      S.fields = S.fields.concat(fields.filter(function (f) { return f.type !== 'button' && f.name; }));
      if (PS.onFields) PS.onFields();
      refreshOverlays();
    }, function () {});
  }

  /* ---------- save ---------- */

  function exportScene(scene) {
    if (!scene || !scene.layers || !scene.layers.length) return undefined;
    var out = clone(scene);
    out.layers = out.layers.filter(function (l) { return l.visible !== false; });
    out.layers.forEach(function (l) {
      if (/^Redaction/.test(l.name || '')) l.redact = true;
    });
    return out.layers.length ? out : undefined;
  }

  var rasterHelper = null;
  function rasterScene() {
    if (!rasterHelper) {
      var host = el('div', 'ps-raster-host');
      host.setAttribute('aria-hidden', 'true');
      d.body.appendChild(host);
      rasterHelper = new LE.Scene({ el: host, width: 10, height: 10 });
    }
    return rasterHelper;
  }
  async function rasterize(layer, sceneJson) {
    var sc = rasterScene();
    var docJ = { v: 1, width: sceneJson.width || 600, height: sceneJson.height || 800, background: { type: 'color', color: '#ffffff' }, layers: [layer] };
    feedAssets(sc, [layer]);
    sc.load(docJ);
    var scale = perfLevel() === 'low' ? 2 : 3;
    var c = await sc.exportLayer(layer.id, scale);
    if (!c) return null;
    var rot = layer.rotation || 0;
    if (!rot) return { canvas: c, x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    var rad = rot * Math.PI / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    var bw = layer.w * cos + layer.h * sin, bh = layer.w * sin + layer.h * cos;
    var out = d.createElement('canvas');
    out.width = Math.max(1, Math.round(bw * scale));
    out.height = Math.max(1, Math.round(bh * scale));
    var ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(c, -c.width / 2, -c.height / 2);
    var cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
    return { canvas: out, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  }

  function docToolOpts() {
    var t = S.docTools;
    var o = {};
    if (t.pageNumbers) o.pageNumbers = clone(t.pageNumbers);
    if (t.watermark) {
      o.watermark = clone(t.watermark);
      if (t.watermark.imageKey && S.assets[t.watermark.imageKey]) o.watermark.image = S.assets[t.watermark.imageKey];
    }
    if (t.headerFooter) o.headerFooter = clone(t.headerFooter);
    if (t.bates) o.bates = clone(t.bates);
    if (t.metadata) o.metadata = clone(t.metadata);
    if (t.flatten) o.flatten = true;
    if (t.compress && t.compress !== 'none') o.compress = t.compress;
    return o;
  }
  PS.docToolOpts = docToolOpts;

  function hasFormValues(docId) {
    var vals = S.formValues[docId];
    return vals && Object.keys(vals).length;
  }

  async function buildPdf(opts) {
    opts = opts || {};
    var pr = opts.progress;
    var pages = opts.pages || S.pages;
    var docMap = {};
    var report = { warnings: [] };
    var docIds = {};
    pages.forEach(function (r) { if (r.docId) docIds[r.docId] = 1; });
    var toolOpts = opts.noTools ? {} : docToolOpts();
    var plain = !opts.pages && Object.keys(docIds).length === 1 && pages.every(function (r, i) {
      return r.docId && r.pageIndex === i && !(r.rotation % 360) && !exportScene(r.scene);
    });
    var onlyDoc = Object.keys(docIds)[0];
    if (plain && onlyDoc && pages.length === S.docs[onlyDoc].pageCount && hasFormValues(onlyDoc) && !Object.keys(toolOpts).length && !S.docs[onlyDoc].encrypted) {
      if (pr) pr.set(0, 1, 'Filling the form');
      var filled = await LE.pdf.fillForm(S.docs[onlyDoc], S.formValues[onlyDoc], { flatten: !!S.flattenForms });
      if (pr) pr.set(1, 1);
      return filled;
    }
    for (var id in docIds) {
      if (hasFormValues(id) && !S.docs[id].encrypted) {
        if (pr) pr.set(0, 1, 'Filling the form');
        var bytes = await LE.pdf.fillForm(S.docs[id], S.formValues[id], { flatten: !!S.flattenForms });
        var tmp = await LE.pdf.open(bytes, { name: S.docs[id].name });
        docMap[id] = tmp.id;
        S.tempDocs = (S.tempDocs || []).concat([tmp]);
      }
    }
    var ws = pages.map(function (r) {
      var o = { rotation: r.rotation || 0 };
      if (r.blank) o.blank = clone(r.blank);
      else { o.docId = docMap[r.docId] || r.docId; o.pageIndex = r.pageIndex; }
      var sc = exportScene(r.scene);
      if (sc) o.scene = sc;
      return o;
    });
    await ensureSets([].concat.apply([], ws.map(function (o) { return o.scene ? o.scene.layers : []; })));
    var buildOpts = Object.assign({}, toolOpts, {
      assets: S.assets,
      rasterize: rasterize,
      onProgress: function (done, total) { if (pr) pr.set(done, total, 'Page ' + done + ' of ' + total); }
    });
    try {
      var out = await LE.pdf.build(ws, buildOpts);
      if (out.report && report.warnings.length) out.report.warnings = report.warnings.concat(out.report.warnings || []);
      return out;
    } finally {
      (S.tempDocs || []).forEach(function (t) { try { t.close(); } catch (e) {} });
      S.tempDocs = [];
    }
  }
  PS.buildPdf = buildPdf;

  function outName(suffix) {
    var n = (E.name.value || S.name || 'document.pdf').trim() || 'document.pdf';
    n = n.replace(/[\\/:*?"<>|]+/g, '-');
    if (suffix) n = baseName(n) + suffix;
    else if (!/\.pdf$/i.test(n)) n += '.pdf';
    return n;
  }
  PS.outName = outName;

  async function save(asName) {
    if (!S.pages.length) { say('Open a PDF first'); return null; }
    if (asName) {
      var wrap = el('div', 'ps-field');
      wrap.innerHTML = '<label for="ps-saveas">File name</label><input class="input" id="ps-saveas">';
      wrap.querySelector('input').value = outName();
      var ok = await dialog({ title: 'Save as', body: wrap, ok: 'Save' });
      if (!ok) return null;
      E.name.value = wrap.querySelector('input').value;
      S.name = E.name.value;
    }
    commitEditing();
    var pr = progress('Saving PDF', true);
    try {
      var bytes = await buildPdf({ progress: pr });
      pr.end();
      var name = outName();
      IT.download(new Blob([bytes], { type: 'application/pdf' }), name);
      var rep = bytes.report || LE.pdf.lastReport || { warnings: [] };
      S.lastSave = { bytes: bytes, report: rep, name: name };
      if (PS.onSaved) PS.onSaved(S.lastSave);
      if (rep.warnings && rep.warnings.length) showReport(rep);
      E.saved.textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return bytes;
    } catch (err) {
      pr.end();
      if (err && err.cancelled) say('Save cancelled');
      else say('Could not save: ' + (err && err.message ? err.message : err), 5000);
      return null;
    }
  }
  PS.save = save;

  function showReport(rep) {
    var box = el('div', 'ps-report');
    var list = el('ul');
    (rep.warnings || []).slice(0, 12).forEach(function (w) { list.appendChild(el('li', null, esc(w))); });
    if (rep.redactedPages && rep.redactedPages.length) {
      box.appendChild(el('p', 'ps-note', 'Redacted pages were turned into images so the hidden text is gone for good. Those pages are no longer selectable.'));
    }
    box.appendChild(list);
    dialog({ title: 'Saved with notes', body: box, ok: 'Got it', cancel: false });
  }
  PS.showReport = showReport;

  /* ---------- autosave ---------- */

  var SESSION = 'pdfstudio-session';
  var autosaveTimer = 0;
  var savedDocs = {};
  function markDirty() {
    S.dirty = true;
    if (E.saved) E.saved.textContent = 'Edited';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosave, 2200);
  }
  PS.markDirty = markDirty;

  function canvasData(c) {
    try { return c.toDataURL ? c.toDataURL('image/png') : null; } catch (e) { return null; }
  }
  async function autosave() {
    if (!LE.store || !S.pages.length) return;
    try {
      var used = {};
      S.pages.forEach(function (r) { if (r.docId) used[r.docId] = 1; });
      for (var id in used) {
        if (savedDocs[id]) continue;
        await LE.store.set('pdfstudio-doc-' + id, { name: S.docNames[id] || S.docs[id].name, bytes: S.docs[id].bytes() });
        savedDocs[id] = 1;
      }
      var assetKeys = {};
      S.pages.forEach(function (r) { (r.scene && r.scene.layers || []).forEach(function (l) { if (l.type === 'image' && l.src) assetKeys[l.src] = 1; }); });
      var bases = (S.docTools && S.docTools._sigBase) || {};
      Object.keys(bases).forEach(function (k) { assetKeys[k] = 1; if (bases[k]) assetKeys[bases[k]] = 1; });
      if (S.docTools.watermark && S.docTools.watermark.imageKey) assetKeys[S.docTools.watermark.imageKey] = 1;
      var assets = {};
      Object.keys(assetKeys).forEach(function (k) {
        var v = S.assets[k];
        if (!v) return;
        if (typeof v === 'string') { assets[k] = v; return; }
        if (!v._data) v._data = canvasData(v);
        if (v._data) assets[k] = v._data;
      });
      var prev = await LE.store.get(SESSION).catch(function () { return null; });
      ((prev && prev.docs) || []).forEach(function (old) {
        if (!used[old]) { delete savedDocs[old]; LE.store.del('pdfstudio-doc-' + old).catch(function () {}); }
      });
      E.restore.hidden = true;
      await LE.store.set(SESSION, {
        at: Date.now(),
        name: E.name.value || S.name,
        docs: Object.keys(used),
        pages: S.pages.map(function (r) { var c = clone(r); return c; }),
        assets: assets,
        docTools: S.docTools,
        formValues: S.formValues,
        flattenForms: S.flattenForms
      });
      S.dirty = false;
      if (E.saved) E.saved.textContent = 'Kept on this device';
    } catch (e) {
      if (E.saved) E.saved.textContent = 'Not kept (storage full)';
    }
  }
  PS.autosave = autosave;

  function loadImageData(src) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var c = d.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        c._data = src;
        res(c);
      };
      img.onerror = function () { res(null); };
      img.src = src;
    });
  }

  async function restoreSession(sess) {
    var pr = progress('Restoring your last session', false);
    try {
      await LE.pdf.ready();
      var map = {};
      for (var i = 0; i < sess.docs.length; i++) {
        var rec = await LE.store.get('pdfstudio-doc-' + sess.docs[i]);
        if (!rec) continue;
        pr.set(i, sess.docs.length, rec.name);
        var doc = await openPdf(rec.bytes, rec.name);
        if (!doc) continue;
        registerDoc(doc, rec.name);
        map[sess.docs[i]] = doc.id;
        if (doc.id !== sess.docs[i]) {
          await LE.store.set('pdfstudio-doc-' + doc.id, rec);
          LE.store.del('pdfstudio-doc-' + sess.docs[i]).catch(function () {});
        }
      }
      var keys = Object.keys(sess.assets || {});
      for (var k = 0; k < keys.length; k++) {
        var c = await loadImageData(sess.assets[keys[k]]);
        if (c) S.assets[keys[k]] = c;
      }
      var pages = (sess.pages || []).filter(function (r) { return r.blank || map[r.docId]; }).map(function (r) {
        if (r.docId) r.docId = map[r.docId];
        r.uid = uid();
        return r;
      });
      if (!pages.length) throw new Error('The saved files are no longer available.');
      S.docTools = Object.assign(S.docTools, sess.docTools || {});
      var fv = {};
      Object.keys(sess.formValues || {}).forEach(function (oldId) { if (map[oldId]) fv[map[oldId]] = sess.formValues[oldId]; });
      S.formValues = fv;
      S.flattenForms = !!sess.flattenForms;
      S.pages = pages;
      S.name = sess.name || 'document.pdf';
      E.name.value = S.name;
      Object.keys(map).forEach(function (o) { savedDocs[map[o]] = 1; });
      pr.end();
      syncPages();
      fitTo('width');
      if (!isPhone()) openPanel('pages');
      if (PS.onRestored) PS.onRestored();
      say('Session restored');
      autosave();
    } catch (e) {
      pr.end();
      say('Could not restore: ' + (e && e.message ? e.message : e), 4200);
    }
  }

  function offerRestore() {
    if (!LE.store) return;
    LE.store.get(SESSION).then(function (sess) {
      if (!sess || !sess.pages || !sess.pages.length || S.pages.length) return;
      var box = E.restore;
      var mins = Math.max(1, Math.round((Date.now() - sess.at) / 60000));
      var ago = mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' days ago';
      $('.ps-restore-name', box).textContent = sess.name || 'document.pdf';
      $('.ps-restore-meta', box).textContent = sess.pages.length + ' page' + (sess.pages.length === 1 ? '' : 's') + ' · ' + ago;
      box.hidden = false;
      $('[data-act="restore"]', box).onclick = function () { box.hidden = true; restoreSession(sess); };
      $('[data-act="discard"]', box).onclick = function () { box.hidden = true; clearSession(sess); };
    }).catch(function () {});
  }
  function clearSession(sess) {
    if (!LE.store) return;
    LE.store.del(SESSION).catch(function () {});
    ((sess && sess.docs) || []).forEach(function (id) { LE.store.del('pdfstudio-doc-' + id).catch(function () {}); });
  }

  function closeAll() {
    Object.keys(scenes).forEach(unmountScene);
    Object.keys(S.docs).forEach(function (k) { try { S.docs[k].close(); } catch (e) {} });
    S.docs = {};
    S.docNames = {};
    S.pages = [];
    S.assets = {};
    S.sel = {};
    S.fields = [];
    S.formValues = {};
    S.current = 0;
    S.docTools = { pageNumbers: null, watermark: null, headerFooter: null, bates: null, metadata: null, compress: 'none', flatten: false };
    H.undo = [];
    H.redo = [];
    savedDocs = {};
    thumbCache = {};
    thumbOrder = [];
    LE.store && LE.store.get(SESSION).then(clearSession).catch(function () {});
    syncPages();
    updateHistory();
    openPanel('');
    if (PS.onClosed) PS.onClosed();
  }
  PS.closeAll = closeAll;

  /* ---------- start screen intents ---------- */

  var ACCEPT_ANY = '.pdf,application/pdf,image/*,.docx,.pptx,.xlsx,.xls,.ods,.csv,.tsv,.odt,.rtf,.txt,.md,.markdown,.html,.htm,.json,.epub,.svg,.js,.ts,.css,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.sh,.xml,.yaml,.yml,.log';
  PS.ACCEPT_ANY = ACCEPT_ANY;
  function intent(name) {
    if (name === 'blank') { newBlankDocument('A4'); openPanel(isPhone() ? '' : 'edit'); return; }
    var accept = name === 'images' ? 'image/*' : name === 'open' || name === 'sign' || name === 'fill' ? '.pdf,application/pdf' : ACCEPT_ANY;
    var multiple = name === 'merge' || name === 'images' || name === 'convert';
    pickFiles(accept, multiple).then(function (files) {
      if (!files.length) return;
      var panel = name === 'sign' ? 'sign' : name === 'fill' ? 'forms' : null;
      addFiles(files, { panel: panel });
    });
  }
  PS.intent = intent;

  /* ---------- boot ---------- */

  var thumbs;
  PS.thumbs = function () { return thumbs; };

  function bindChrome() {
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-act');
      if (a === 'undo') undo();
      else if (a === 'redo') redo();
      else if (a === 'save') save();
      else if (a === 'save-as') save(true);
      else if (a === 'zoom-in') setZoom(S.zoom * 1.2);
      else if (a === 'zoom-out') setZoom(S.zoom / 1.2);
      else if (a === 'fit-width') fitTo('width');
      else if (a === 'fit-page') fitTo('page');
      else if (a === 'prev-page') goTo(S.current - 1);
      else if (a === 'next-page') goTo(S.current + 1);
      else if (a === 'organize') { if (E.organize.hidden) openOrganizer(); else closeOrganizer(); }
      else if (a === 'close-organize') closeOrganizer();
      else if (a === 'toggle-thumbs') {
        d.body.classList.toggle('ps-thumbs-off');
        b.setAttribute('aria-pressed', d.body.classList.contains('ps-thumbs-off') ? 'false' : 'true');
        setTimeout(function () { if (S.fit) fitTo(S.fit); }, 0);
      }
      else if (a === 'panel-close') { if (isPhone()) setSheet('closed'); else openPanel(''); }
      else if (a === 'intent') intent(b.getAttribute('data-intent'));
      else if (a === 'settings') { if (PS.openSettings) PS.openSettings(b); }
      else if (a === 'find') { if (PS.openFind) PS.openFind(); }
    });
    E.rail.addEventListener('click', function (e) {
      var b = e.target.closest('[data-panel]');
      if (!b) return;
      var name = b.getAttribute('data-panel');
      if (!S.pages.length && name !== 'convert' && !(PS.panels[name] && PS.panels[name].noDoc)) { /* noDoc: panels that work without an open document (bulk tools) */
        if (name === 'sign') intent('sign');
        else if (name === 'forms') intent('fill');
        else intent('open');
        return;
      }
      openPanel(S.panel === name ? '' : name);
    });
    E.pageInput.addEventListener('change', function () {
      var n = parseInt(E.pageInput.value, 10);
      if (n >= 1) goTo(n - 1);
    });
    E.name.addEventListener('change', function () { S.name = E.name.value; markDirty(); });
    E.viewer.addEventListener('scroll', onScroll, { passive: true });
    E.viewer.addEventListener('pointerdown', onDownCapture, true);
    E.viewer.addEventListener('pointermove', onMoveCapture, true);
    E.viewer.addEventListener('pointerup', onUpCapture, true);
    E.viewer.addEventListener('pointercancel', onUpCapture, true);
    E.viewer.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    E.viewer.addEventListener('touchstart', onTouchStart, { passive: false });
    E.viewer.addEventListener('touchmove', onTouchMove, { passive: false });
    E.viewer.addEventListener('touchend', onTouchEnd);
    E.viewer.addEventListener('pointerdown', function (e) {
      if (e.target === E.viewer || e.target === E.stack) {
        Object.keys(scenes).forEach(function (k) { if (scenes[k].selection().length) scenes[k].select([]); });
      }
    });
    global.addEventListener('keydown', onKeyCapture, true);
    var dropTarget = d.body;
    ['dragenter', 'dragover'].forEach(function (n) {
      dropTarget.addEventListener(n, function (e) {
        if (!e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
        e.preventDefault();
        d.body.classList.add('ps-drop');
      });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      dropTarget.addEventListener(n, function (e) {
        if (n === 'dragleave' && e.relatedTarget) return;
        d.body.classList.remove('ps-drop');
      });
    });
    dropTarget.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      var at = null;
      var p = e.target.closest && e.target.closest('.pv-page, .th');
      if (p) at = refIndex(p.getAttribute('data-uid')) + 1;
      addFiles(e.dataTransfer.files, { at: at });
    });
    d.addEventListener('paste', function (e) {
      var files = (e.clipboardData && e.clipboardData.files) || [];
      if (!files.length || typingTarget(e.target)) return;
      e.preventDefault();
      if (PS.onPasteFiles && S.pages.length && PS.onPasteFiles(files)) return;
      addFiles(files);
    });
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (S.fit && !pinch) { clearTimeout(ro._t); ro._t = setTimeout(function () { fitTo(S.fit); }, 60); }
        measure();
      });
      ro.observe(E.viewer);
    }
    var mq = global.matchMedia('(max-width: 767px)');
    var onMq = function () {
      if (!isPhone()) {
        E.panel.style.transform = '';
        d.body.classList.remove('ps-sheet-open');
        E.panel.removeAttribute('data-snap');
      } else if (S.panel) setSheet('half');
      placeThumbs();
      if (PS.renderCtx) PS.renderCtx();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
    global.addEventListener('beforeunload', function () { if (S.dirty && S.pages.length) autosave(); });
  }

  function boot() {
    E.app = $('#ps-app');
    E.viewer = $('#ps-viewer');
    E.stack = $('#pv-stack');
    E.empty = $('#ps-empty');
    E.thumbs = $('#ps-thumbs');
    E.thumbList = $('#ps-thumb-list');
    E.panel = $('#ps-panel');
    E.panelTitle = $('#ps-panel-title');
    E.panelBody = $('#ps-panel-body');
    E.sheetHandle = $('#ps-sheet-handle');
    E.rail = $('#ps-rail');
    E.organize = $('#ps-organize');
    E.hint = $('#ps-hint');
    E.name = $('#ps-name');
    E.saved = $('#ps-saved');
    E.pageInput = $('#ps-page-input');
    E.dialog = $('#ps-dialog');
    E.progress = $('#ps-progress');
    E.restore = $('#ps-restore');
    E.ctx = $('#ps-ctx');
    PS.E = E;
    [E.app, $('#ps-stage')].forEach(function (n) {
      n.addEventListener('scroll', function () { if (n.scrollTop || n.scrollLeft) { n.scrollTop = 0; n.scrollLeft = 0; } });
    });
    thumbs = new ThumbList(E.thumbList, 'strip');
    io = new IntersectionObserver(onIntersect, { root: E.viewer, rootMargin: '120% 0px 120% 0px' });
    bindChrome();
    bindSheet();
    Object.keys(PS.panels).forEach(function (k) { if (PS.panels[k].init) PS.panels[k].init(); });
    updateHistory();
    updateZoomLabel();
    syncPages();
    if (PS.renderCtx) PS.renderCtx();
    var params = new URLSearchParams(location.search);
    if (params.get('from') === 'convert' && LE.handoff) {
      LE.handoff.take().then(function (v) {
        if (v && v.blob) {
          var name = (v.meta && v.meta.name) || 'converted.pdf';
          var f = new File([v.blob], name, { type: 'application/pdf' });
          addFiles([f]);
        } else offerRestore();
      }).catch(offerRestore);
    } else offerRestore();
    var p = params.get('panel');
    /* The Protect and Bulk panels come from scripts that run after this one, so wait until every script has run. */
    var job = (params.get('job') || '').replace(/[^a-z-]/g, '');
    if (p) { if (d.readyState === 'complete') applyDeepLink(p, job); else global.addEventListener('load', function () { applyDeepLink(p, job); }); }
    d.body.classList.add('ps-ready');
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})(window);
