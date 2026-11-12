/* LocalEditor PDF studio office tools: every-page stamps, bookmarks, blank page colour, compare two PDFs, send checklist. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var PS = global.PS;
  if (!PS || !PS.panels) return;
  var d = document;
  var S = PS.S;
  var $ = PS.$, $$ = PS.$$, el = PS.el, esc = PS.esc, icon = PS.icon, say = PS.say, clamp = PS.clamp;
  var ui = PS.ui;

  function today() {
    try { return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return new Date().toDateString(); }
  }
  function card(title, iconName, open) {
    var c = el('section', 'ps-card' + (open ? ' is-on' : ''));
    c.innerHTML = '<div class="ps-card-head"><span class="ps-card-ic">' + icon(iconName) + '</span><strong>' + esc(title) + '</strong></div>';
    var b = el('div', 'ps-card-body');
    c.appendChild(b);
    c.body = b;
    return c;
  }
  function wrap(name, after) {
    var p = PS.panels[name];
    if (!p) return;
    var b = p.build, s = p.show;
    p.build = function (pane) { b.call(this, pane); after.build.call(this, pane); };
    p.show = function () { if (s) s.call(this); if (after.show) after.show.call(this); };
  }

  /* ---------- every page: initials, date, signature ---------- */

  var EP = { what: 'initials', pos: 'br', skip: false, onlySel: false };
  function epSource() {
    var sig = PS.sig || { last: {} };
    var sp = PS.panels.sign;
    var typed = sp && sp._nameIn && sp._nameIn.value.trim();
    if (EP.what === 'date') return Promise.resolve(null);
    var have = sig.last[EP.what];
    if (have) return Promise.resolve(have);
    if (!typed) return Promise.resolve(false);
    var text = EP.what === 'initials' ? typed.split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase(); }).join('.') + (typed.indexOf(' ') > 0 ? '.' : '') : typed;
    return LE.pdf.signatureFromText(text, sig.family || 'Great Vibes', sig.color || '#16141C');
  }
  function epBox(ref, w, h) {
    var size = PS.refSize(ref), m = 28;
    var col = EP.pos.charAt(1), row = EP.pos.charAt(0);
    var x = col === 'l' ? m : col === 'r' ? size.w - m - w : (size.w - w) / 2;
    var y = row === 't' ? m : size.h - m - h;
    return { x: clamp(x, 0, size.w - w), y: clamp(y, 0, size.h - h) };
  }
  function applyEveryPage(note) {
    epSource().then(function (canvas) {
      if (canvas === false) { say(EP.what === 'initials' ? 'Type your name in the Type tab, or place your initials once first' : 'Create a signature above first'); return; }
      var key = null;
      if (canvas) { key = PS.uid('sig'); S.assets[key] = canvas; }
      var picked = Object.keys(S.sel).length;
      var targets = EP.onlySel && picked ? S.pages.filter(function (r) { return S.sel[r.uid]; }) : S.pages.slice();
      var n = 0;
      PS.commitPages(function () {
        targets.forEach(function (ref) {
          if (EP.skip && PS.refIndex(ref.uid) === 0) return;
          var size = PS.refSize(ref);
          var layer;
          if (EP.what === 'date') {
            var txt = today(), fs = 10, w = Math.max(60, txt.length * fs * 0.56), h = Math.round(fs * 1.4);
            var at = epBox(ref, w, h);
            layer = { id: PS.uid('l'), type: 'text', name: 'Date', text: txt, x: at.x, y: at.y, w: w, h: h, size: fs, font: (PS.STYLE && PS.STYLE.font) || 'Plus Jakarta Sans', weight: 400, color: (PS.STYLE && PS.STYLE.textColor) || '#17131F', align: EP.pos.charAt(1) === 'r' ? 'right' : EP.pos.charAt(1) === 'c' ? 'center' : 'left', lineHeight: 1.2, rotation: 0, opacity: 1, visible: true };
          } else {
            var lw = EP.what === 'initials' ? 56 : 130;
            var lh = lw * canvas.height / canvas.width;
            var bx = epBox(ref, lw, lh);
            layer = { id: PS.uid('l'), type: 'image', name: EP.what === 'initials' ? 'Initials' : 'Signature', src: key, x: bx.x, y: bx.y, w: lw, h: lh, rotation: 0, opacity: 1, visible: true, crop: { x: 0, y: 0, w: 1, h: 1 } };
          }
          ref.scene = ref.scene || { v: 1, width: size.w, height: size.h, layers: [] };
          ref.scene.layers = (ref.scene.layers || []).concat([layer]);
          n++;
        });
      }, EP.what === 'date' ? 'Date on every page' : 'Initial every page');
      PS.remountAll();
      if (note) note.textContent = 'Added to ' + n + ' page' + (n === 1 ? '' : 's') + '. Undo removes them all at once.';
      say((EP.what === 'date' ? 'Date' : EP.what === 'initials' ? 'Initials' : 'Signature') + ' added to ' + n + ' page' + (n === 1 ? '' : 's'));
    });
  }
  PS.applyEveryPage = applyEveryPage;
  PS.everyPage = EP;
  PS.buildEveryPage = function () {
    var sec = ui.section('Every page', 'initials, date or signature');
    var what = ui.seg([['initials', 'Initials'], ['date', 'Date'], ['signature', 'Signature']], EP.what, function (v) { EP.what = v; hint(); });
    sec.appendChild(what);
    sec.appendChild(el('div', 'ps-eyebrow', 'Position'));
    sec.appendChild(ui.posPicker(EP.pos, function (v) { EP.pos = v; }));
    sec.appendChild(ui.toggle('Skip the first page', EP.skip, function (v) { EP.skip = v; }));
    sec.appendChild(ui.toggle('Only selected pages', EP.onlySel, function (v) { EP.onlySel = v; }, 'Select pages in the Pages panel'));
    var note = el('p', 'ps-note');
    sec.appendChild(note);
    function hint() {
      var sig = PS.sig || { last: {} };
      note.textContent = EP.what === 'date' ? 'Today’s date in your text style.' : sig.last[EP.what] ? 'Uses the ' + EP.what + ' you placed last.' : 'Uses your typed name in the chosen handwriting font and ink.';
    }
    hint();
    var go = ui.btn('btn btn-block', icon('allPages') + 'Add to every page');
    go.addEventListener('click', function () { applyEveryPage(note); });
    sec.appendChild(go);
    sec._hint = hint;
    return sec;
  };

  /* ---------- pages panel: blank page colour + bookmarks ---------- */

  var bgHist = { at: 0, key: '' };
  function setBlankColor(c, all) {
    var targets = S.pages.filter(function (r, i) { return r.blank && (all || i === S.current); });
    if (!targets.length) return;
    var key = (all ? 'all' : targets[0].uid);
    var fresh = Date.now() - bgHist.at > 900 || bgHist.key !== key;
    bgHist = { at: Date.now(), key: key };
    PS.commitPages(function () { targets.forEach(function (r) { r.blank.color = c; }); }, fresh ? 'Page colour' : null);
    targets.forEach(function (r) { PS.reloadScene(r.uid); });
  }
  PS.setBlankColor = setBlankColor;

  function outlineRows(items, docId, depth, out) {
    items.forEach(function (it) {
      out.push({ it: it, docId: docId, depth: depth });
      if (it.items && it.items.length && depth < 4) outlineRows(it.items, docId, depth + 1, out);
    });
    return out;
  }
  function refFor(docId, page) {
    for (var i = 0; i < S.pages.length; i++) if (S.pages[i].docId === docId && S.pages[i].pageIndex === page) return i;
    return -1;
  }

  wrap('pages', {
    build: function (pane) {
      var self = this;
      var bg = ui.section('Blank page colour');
      bg.hidden = true;
      var all = false;
      var sw = ui.swatches([['#FFFFFF', 'White'], ['#FBF8F3', 'Cream'], ['#F4F1EA', 'Ivory'], ['#EEF2F7', 'Cloud'], ['#E8F5EE', 'Mint'], ['#FDECEF', 'Blush'], ['#17131F', 'Ink']], '#FFFFFF', function (c) { setBlankColor(c, all); }, true, { title: 'Page colour' });
      bg.appendChild(sw);
      bg.appendChild(ui.toggle('Apply to every blank page', false, function (v) { all = v; }));
      bg.appendChild(el('p', 'ps-note', 'Only pages you added as blank can be recoloured. The colour is saved in the PDF.'));
      pane.appendChild(bg);
      self._bg = bg;
      self._bgSw = sw;

      var bm = ui.section('Bookmarks');
      var list = el('div', 'ps-outline');
      list.setAttribute('role', 'tree');
      list.setAttribute('aria-label', 'Bookmarks');
      bm.appendChild(list);
      pane.appendChild(bm);
      self._outline = list;
    },
    show: function () {
      var ref = S.pages[S.current];
      if (this._bg) {
        var anyBlank = S.pages.some(function (r) { return r.blank; });
        this._bg.hidden = !anyBlank;
        if (ref && ref.blank) this._bgSw.setValue(ref.blank.color || '#FFFFFF');
      }
      var list = this._outline;
      if (!list) return;
      var sig = Object.keys(S.docs).join(',') + '|' + S.pages.length;
      if (list._sig === sig) return;
      list._sig = sig;
      list.innerHTML = '<div class="ps-skel ps-skel-line"></div><div class="ps-skel ps-skel-line"></div>';
      var ids = Object.keys(S.docs).filter(function (id) { return S.pages.some(function (r) { return r.docId === id; }); });
      Promise.all(ids.map(function (id) { return S.docs[id].outline ? S.docs[id].outline().catch(function () { return []; }) : []; })).then(function (outs) {
        list.innerHTML = '';
        var rows = [];
        outs.forEach(function (o, i) { if (o && o.length) outlineRows(o, ids[i], 0, rows); });
        if (!rows.length) {
          list.appendChild(el('p', 'ps-note', 'This document has no bookmarks. Long reports and manuals often do; they appear here so you can jump straight to a chapter.'));
          return;
        }
        rows.slice(0, 400).forEach(function (r) {
          var idx = r.it.page == null ? -1 : refFor(r.docId, r.it.page);
          var b = ui.btn('ps-ol', '<span class="ps-ol-t"></span><span class="ps-ol-p">' + (idx >= 0 ? idx + 1 : '–') + '</span>', { role: 'treeitem', title: idx >= 0 ? 'Go to page ' + (idx + 1) : 'That page is no longer in the document' });
          b.style.setProperty('--depth', r.depth);
          $('.ps-ol-t', b).textContent = r.it.title || 'Untitled';
          if (r.it.bold) b.classList.add('is-bold');
          if (idx < 0) b.disabled = true;
          b.addEventListener('click', function () { PS.goTo(idx); if (PS.isPhone()) PS.setSheet('closed'); });
          list.appendChild(b);
        });
        list.appendChild(el('p', 'ps-note ps-ol-note', 'Bookmarks help you move around here. The saved copy does not keep them yet.'));
      });
    }
  });

  /* ---------- tools panel: compare two PDFs ---------- */

  function words(t) { return String(t || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }
  function diffWords(a, b) {
    var n = a.length, m = b.length;
    if (n * m > 4e6) {
      var sa = {}, out = [];
      b.forEach(function (w) { sa[w] = (sa[w] || 0) + 1; });
      a.forEach(function (w) { if (sa[w]) { sa[w]--; out.push([0, w]); } else out.push([-1, w]); });
      Object.keys(sa).forEach(function (w) { for (var k = 0; k < sa[w]; k++) out.push([1, w]); });
      return out;
    }
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var res = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { res.push([0, a[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { res.push([-1, a[i]]); i++; }
      else { res.push([1, b[j]]); j++; }
    }
    while (i < n) res.push([-1, a[i++]]);
    while (j < m) res.push([1, b[j++]]);
    return res;
  }
  function snippet(ops, side) {
    var box = el('div', 'ps-cmp-text');
    var keep = ops.map(function (o) { return o[0] !== 0; });
    var show = ops.map(function (o, i) {
      for (var k = Math.max(0, i - 6); k <= Math.min(ops.length - 1, i + 6); k++) if (keep[k]) return true;
      return false;
    });
    var gap = false;
    ops.forEach(function (o, i) {
      if (side === 'a' && o[0] === 1) return;
      if (side === 'b' && o[0] === -1) return;
      if (!show[i]) { if (!gap) { box.appendChild(el('span', 'ps-cmp-gap', '…')); gap = true; } return; }
      gap = false;
      var n = d.createElement(o[0] === -1 ? 'del' : o[0] === 1 ? 'ins' : 'span');
      n.textContent = o[1] + ' ';
      box.appendChild(n);
    });
    return box;
  }
  async function pageTexts(getText, count, pr, offset, total) {
    var out = [];
    for (var i = 0; i < count; i++) {
      pr.set(offset + i, total, 'Reading page ' + (i + 1));
      try { out.push(await getText(i)); } catch (e) { out.push(''); }
    }
    return out;
  }
  async function comparePdf(file) {
    var other;
    var pr = PS.progress('Comparing documents', true);
    try {
      var bytes = new Uint8Array(await file.arrayBuffer());
      other = await LE.pdf.open(bytes, { name: file.name });
      var refs = S.pages;
      var total = refs.length + other.pageCount;
      var mine = await pageTexts(function (i) {
        var r = refs[i];
        if (r.blank || !S.docs[r.docId]) return Promise.resolve('');
        return S.docs[r.docId].text(r.pageIndex).then(function (t) { return t.text; });
      }, refs.length, pr, 0, total);
      var theirs = await pageTexts(function (i) { return other.text(i).then(function (t) { return t.text; }); }, other.pageCount, pr, refs.length, total);
      pr.end();
      showCompare(mine, theirs, file.name);
    } catch (e) {
      pr.end();
      if (!e.cancelled) say('Could not compare: ' + (e.message || e), 4200);
    } finally {
      try { if (other && other.close) other.close(); } catch (e2) {}
    }
  }
  PS.comparePdf = comparePdf;
  function showCompare(mine, theirs, otherName) {
    var body = el('div', 'ps-cmp');
    var n = Math.max(mine.length, theirs.length);
    var changed = 0, added = 0, removed = 0;
    var list = el('div', 'ps-cmp-list');
    for (var i = 0; i < n; i++) {
      var a = words(mine[i]), b = words(theirs[i]);
      var ops = diffWords(a, b);
      var plus = 0, minus = 0;
      ops.forEach(function (o) { if (o[0] === 1) plus++; else if (o[0] === -1) minus++; });
      if (!plus && !minus) continue;
      changed++;
      added += plus;
      removed += minus;
      var row = el('details', 'ps-cmp-page');
      if (changed <= 3) row.open = true;
      var sum = el('summary');
      sum.innerHTML = '<strong>Page ' + (i + 1) + '</strong><span class="ps-cmp-badges">' + (plus ? '<span class="is-add">+' + plus + '</span>' : '') + (minus ? '<span class="is-del">−' + minus + '</span>' : '') + '</span>' +
        (i >= mine.length ? '<small>only in the other file</small>' : i >= theirs.length ? '<small>only in this file</small>' : '');
      row.appendChild(sum);
      var cols = el('div', 'ps-cmp-cols');
      var ca = el('div', 'ps-cmp-col');
      ca.appendChild(el('div', 'ps-eyebrow', 'This document'));
      ca.appendChild(snippet(ops, 'a'));
      var cb = el('div', 'ps-cmp-col');
      var lab = el('div', 'ps-eyebrow');
      lab.textContent = otherName;
      cb.appendChild(lab);
      cb.appendChild(snippet(ops, 'b'));
      cols.appendChild(ca);
      cols.appendChild(cb);
      row.appendChild(cols);
      list.appendChild(row);
    }
    var head = el('div', 'ps-cmp-sum');
    if (!changed) head.innerHTML = '<span class="ps-cmp-ok">' + icon('check') + '</span><div><strong>The text matches</strong><small>' + n + ' page' + (n === 1 ? '' : 's') + ' compared. Layout, images and annotations are not compared.</small></div>';
    else head.innerHTML = '<span class="ps-cmp-chg">' + icon('compare') + '</span><div><strong>' + changed + ' of ' + n + ' pages differ</strong><small><span class="is-add">' + added + ' words added</span> · <span class="is-del">' + removed + ' removed</span> · text only, layout and images are not compared</small></div>';
    body.appendChild(head);
    body.appendChild(list);
    var dlgP = PS.dialog({ title: 'Compare documents', body: body, ok: 'Done', cancel: false });
    var dlg = body.closest('dialog');
    if (dlg) {
      dlg.classList.add('is-wide');
      dlgP.then(function () { dlg.classList.remove('is-wide'); });
    }
    return { changed: changed, added: added, removed: removed, pages: n };
  }
  PS.showCompare = showCompare;
  PS.diffWords = diffWords;

  wrap('tools', {
    build: function (pane) {
      var c = card('Compare two PDFs', 'compare', true);
      c.body.appendChild(el('p', 'ps-note', 'See which words changed between this document and another version, page by page. Nothing leaves your device.'));
      var b = ui.btn('btn btn-sm', icon('filePlus') + 'Choose the other PDF');
      b.addEventListener('click', function () {
        if (!S.pages.length) { say('Open a PDF first'); return; }
        PS.pickFiles('.pdf,application/pdf', false).then(function (f) { if (f[0]) comparePdf(f[0]); });
      });
      c.body.appendChild(b);
      pane.appendChild(c);
    }
  });

  /* ---------- export panel: before you send ---------- */

  function checklist() {
    var items = [];
    var fields = PS.fieldsOnDoc ? PS.fieldsOnDoc().filter(function (f) { return f.type !== 'button' && f.type !== 'signature' && !f.readOnly; }) : [];
    if (fields.length) {
      var filled = fields.filter(function (f) { var v = PS.fieldValue(f); return f.type === 'checkbox' ? true : v != null && String(v).trim() !== ''; }).length;
      items.push({ ok: filled === fields.length, text: filled + ' of ' + fields.length + ' form fields filled', act: filled < fields.length ? ['Fill', 'forms'] : null });
    }
    var sigs = 0, reds = 0, notes = 0;
    S.pages.forEach(function (r) {
      ((r.scene && r.scene.layers) || []).forEach(function (l) {
        if (PS.isSigLayer && PS.isSigLayer(l)) sigs++;
        if (/^Redaction/.test(l.name || '')) reds++;
        if (l.type === 'text' && l.background && l.name === 'Note') notes++;
      });
    });
    var sigFields = (S.fields || []).filter(function (f) { return f.type === 'signature'; }).length;
    items.push({ ok: sigs > 0, warn: !sigs && sigFields > 0, text: sigs ? 'Signed (' + sigs + ' signature' + (sigs === 1 ? '' : 's') + ' or initials)' : sigFields ? 'Not signed yet. The form has ' + sigFields + ' signature field' + (sigFields === 1 ? '' : 's') : 'Not signed', act: sigs ? null : ['Sign', 'sign'] });
    if (reds) items.push({ warn: true, text: reds + ' redaction' + (reds === 1 ? '' : 's') + '. Those pages are saved as images so the text underneath is gone' });
    if (notes) items.push({ info: true, text: notes + ' comment' + (notes === 1 ? '' : 's') + ' will print on the page. Delete them if they are just for you' });
    var meta = S.docTools.metadata || S.docTools._metadata;
    items.push({ ok: !!(meta && meta.title), info: !(meta && meta.title), text: meta && meta.title ? 'Title: ' + meta.title : 'No document title. Readers show the file name instead', act: meta && meta.title ? null : ['Add', 'tools'] });
    var blanks = S.pages.filter(function (r) { return r.blank && !(r.scene && r.scene.layers && r.scene.layers.length); }).length;
    if (blanks) items.push({ warn: true, text: blanks + ' empty blank page' + (blanks === 1 ? '' : 's'), act: ['Review', 'pages'] });
    items.push({ info: true, ok: !!S.docTools.pageNumbers, text: S.docTools.pageNumbers ? 'Page numbers on' : 'No page numbers', act: S.docTools.pageNumbers ? null : ['Add', 'tools'] });
    return items;
  }
  PS.checklist = checklist;
  wrap('export', {
    build: function (pane) {
      var sec = ui.section('Before you send');
      var list = el('ul', 'ps-check');
      sec.appendChild(list);
      var first = pane.querySelector('.ps-sec');
      if (first && first.nextSibling) pane.insertBefore(sec, first.nextSibling);
      else pane.appendChild(sec);
      this._check = list;
    },
    show: function () {
      var list = this._check;
      if (!list) return;
      list.innerHTML = '';
      checklist().forEach(function (it) {
        var li = el('li', it.ok ? 'is-ok' : it.warn ? 'is-warn' : 'is-info');
        li.innerHTML = '<span class="ps-check-ic">' + icon(it.ok ? 'check' : it.warn ? 'alert' : 'info') + '</span><span class="ps-check-t"></span>';
        $('.ps-check-t', li).textContent = it.text;
        if (it.act) {
          var b = ui.btn('ps-chip ps-chip-sm', esc(it.act[0]));
          b.addEventListener('click', function () { PS.openPanel(it.act[1]); });
          li.appendChild(b);
        }
        list.appendChild(li);
      });
    }
  });
})(window);
