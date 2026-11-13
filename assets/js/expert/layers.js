/* LocalEditor Expert: layers panel. Thumbnails, visibility, lock, blend mode, opacity, mask thumbnail (enable, disable,
 * invert), clipping indicator, effect rows per layer (on/off, drag to reorder, amount, expand for settings and mask),
 * adjustment layers as first-class rows, drag to reorder layers, context menus (right-click, long-press, Shift+F10).
 * Rows are keyed by id and updated in place; nothing re-renders the whole list on a value change. */
(function (global) {
  'use strict';
  var X = global.LE && global.LE.expert;
  if (!X) return;
  var C = X.controls, h = X.h, esc = X.esc, clamp = X.clamp;
  var BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Colour dodge'], ['color-burn', 'Colour burn'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Colour'], ['luminosity', 'Luminosity']];
  var FX_BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['luminosity', 'Luminosity'], ['color', 'Colour']];
  var TYPE_ICON = { image: 'image', text: 'text', shape: 'shapes', svg: 'elements', path: 'draw', group: 'group', adjust: 'adjust' };
  function c() { return global.LEStudio; }

  /* ---------- Searchable effect menu, grouped like the registry ---------- */
  /* An effect chosen from the add-effect list: appended in one undo step and selected, so its on-canvas handles show. */
  function addPicked(layerId, type) {
    var fxId = X.doc.addFx(layerId, type, { append: true }, X.gesture());
    X.emit('fx-select', { layerId: layerId, type: type, fxId: fxId });
    return fxId;
  }
  function fxMenu(anchor, title, pick) {
    var defs = X.defs();
    var node = h('<div class="xp-fxmenu"><label class="xp-search">' + X.ic('search') + '<input type="search" placeholder="Search effects" aria-label="Search effects" autocomplete="off"></label><div class="xp-fxmenu-list" role="listbox" aria-label="' + esc(title) + '"></div></div>');
    var list = node.querySelector('.xp-fxmenu-list'), input = node.querySelector('input');
    function draw(q) {
      q = (q || '').trim().toLowerCase();
      var html = '', last = null, n = 0;
      defs.forEach(function (d) {
        var hay = (d.name + ' ' + d.id + ' ' + d.section + ' ' + ((d.agent && d.agent.summary) || '')).toLowerCase();
        if (q && hay.indexOf(q) < 0) return;
        if (d.section !== last) { html += '<div class="xp-fxmenu-grp" role="presentation">' + esc(d.section) + '</div>'; last = d.section; }
        html += '<button type="button" role="option" data-id="' + esc(d.id) + '" tabindex="-1"><span>' + esc(d.name || d.id) + '</span>' + (d.agent && d.agent.summary ? '<small>' + esc(d.agent.summary) + '</small>' : '') + '</button>';
        n++;
      });
      list.innerHTML = html || '<p class="xp-note">No effect matches “' + esc(q) + '”.</p>';
      var f = list.querySelector('[role="option"]'); if (f) f.setAttribute('aria-selected', 'true');
      return n;
    }
    function opts() { return [].slice.call(list.querySelectorAll('[role="option"]')); }
    function move(d) {
      var o = opts(); if (!o.length) return;
      var i = o.findIndex(function (b) { return b.getAttribute('aria-selected') === 'true'; });
      o.forEach(function (b) { b.removeAttribute('aria-selected'); });
      var n = o[clamp(i + d, 0, o.length - 1)]; n.setAttribute('aria-selected', 'true'); n.scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('input', function () { draw(input.value); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); var s = list.querySelector('[aria-selected="true"]'); if (s) choose(s.getAttribute('data-id')); }
      else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('click', function (e) { var b = e.target.closest('[data-id]'); if (b) choose(b.getAttribute('data-id')); });
    function close() { var cc = c(); if (cc && cc.closePop) cc.closePop(); else node.remove(); }
    function choose(id) { close(); pick(id); }
    draw('');
    var cc = c();
    if (cc && cc.openPop) cc.openPop(anchor, node, { title: title, cls: 'xp-pop-fx' });
    else { node.classList.add('xp-pop'); document.body.appendChild(node); }
    setTimeout(function () { input.focus(); }, 30);
    return node;
  }
  X.fxMenu = fxMenu;

  /* Mask thumbnail: the mask evaluated at 40 px (geometry parts exactly; ranges need pixels and show as full). */
  var thumbCache = {};
  function maskThumb(mask) {
    var k = JSON.stringify(mask);
    if (thumbCache[k]) return thumbCache[k];
    var w = 40, hh = 40, f = X.evalMask(mask, { w: w, h: hh, pixels: null, assets: X.assetCanvases ? X.assetCanvases() : {} });
    var cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    var cx = cv.getContext('2d'), img = cx.createImageData(w, hh);
    for (var i = 0; i < f.length; i++) { var v = Math.round(f[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    cx.putImageData(img, 0, 0);
    var url = cv.toDataURL();
    var keys = Object.keys(thumbCache); if (keys.length > 80) delete thumbCache[keys[0]];
    thumbCache[k] = url;
    return url;
  }

  X.layers = function (host) {
    var el = h('<div class="xp-layers"><div class="xp-lay-props"></div><ul class="xp-lay-list" role="list" aria-label="Layers"></ul>' +
      '<div class="xp-lay-foot"><button type="button" class="xp-ib" data-act="adj" aria-haspopup="dialog" aria-label="New adjustment layer" title="New adjustment layer">' + X.ic('adjust') + '</button>' +
      '<button type="button" class="xp-ib" data-act="fx" aria-haspopup="dialog" aria-label="Add effect to the selected layer" title="Add effect">' + X.ic('fx') + '</button>' +
      '<button type="button" class="xp-ib" data-act="mask" aria-label="Add a layer mask" title="Add layer mask">' + X.ic('mask') + '</button>' +
      '<span class="xp-grow"></span><button type="button" class="xp-ib" data-act="del" aria-label="Delete layer" title="Delete layer">' + X.ic('trash') + '</button></div></div>');
    host.appendChild(el);
    var list = el.querySelector('.xp-lay-list'), props = el.querySelector('.xp-lay-props');
    var rows = {};           /* layer id -> row element */
    var openFx = X.lsGet('le-expert-fxopen', {});    /* layer id -> true: effect rows shown */
    var openEntry = {};      /* fx id -> { panel, maskCtl } */
    var lastSig = '';
    var thumbs = {};

    function scene() { return c().scene; }
    function layersTopFirst() { return scene().layers().slice().reverse(); }
    function selected() { return c().sel(); }

    /* ---------- Properties of the selected layer: blend and opacity ---------- */
    var blendSel = h('<select class="xp-select" aria-label="Blend mode">' + BLENDS.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('') + '</select>');
    var opac = C.create('slider', { label: 'Opacity', compact: true, schema: { min: 0, max: 100, step: 1, default: 100, unit: '%' }, value: 100,
      onInput: function (v, k) { var id = selected()[0]; if (id) X.doc.patchLayer(id, { opacity: v / 100 }, k); },
      onCommit: function (v, k) { var id = selected()[0]; if (id) X.doc.patchLayer(id, { opacity: v / 100 }, k); } });
    var pr = h('<div class="xp-lay-blend"></div>');
    pr.appendChild(blendSel);
    props.appendChild(pr); props.appendChild(opac.el);
    blendSel.addEventListener('change', function () { var id = selected()[0]; if (id) X.doc.patchLayer(id, { blend: blendSel.value }, X.gesture()); });
    blendSel.addEventListener('keydown', function (e) { e.stopPropagation(); });
    function paintProps() {
      var ids = selected(), l = ids.length === 1 ? X.doc.layer(ids[0]) : null;
      props.classList.toggle('is-off', !l);
      blendSel.disabled = !l;
      if (l) { var b = l.blend === 'normal' || !l.blend ? 'source-over' : l.blend; if (blendSel.value !== b) blendSel.value = b; opac.set(Math.round((l.opacity == null ? 1 : l.opacity) * 100)); }
    }

    /* ---------- Rows ---------- */
    function rowFor(l) {
      var r = rows[l.id];
      if (!r) {
        r = h('<li class="xp-lay" data-id="' + esc(l.id) + '"><div class="xp-lay-row" tabindex="-1">' +
          '<button type="button" class="xp-ib xp-lay-eye" data-act="eye"></button>' +
          '<span class="xp-lay-thumb" aria-hidden="true"></span>' +
          '<button type="button" class="xp-lay-name" data-act="select"></button>' +
          '<span class="xp-lay-clip" title="Clipped to the layer below" hidden>' + X.ic('clip') + '</span>' +
          '<button type="button" class="xp-lay-mask" data-act="mask" aria-haspopup="menu" hidden></button>' +
          '<button type="button" class="xp-ib xp-lay-fxbtn" data-act="fxopen" hidden></button>' +
          '<button type="button" class="xp-ib xp-lay-lock" data-act="lock"></button>' +
          '</div><ul class="xp-fxrows" role="list" hidden></ul></li>');
        rows[l.id] = r;
        bindRow(r, l.id);
      }
      paintRow(r, l);
      return r;
    }
    function paintRow(r, l) {
      var on = selected().indexOf(l.id) >= 0;
      r.classList.toggle('is-sel', on);
      r.classList.toggle('is-hidden', l.visible === false);
      r.classList.toggle('is-adjust', l.type === 'adjust');
      var name = r.querySelector('.xp-lay-name');
      var nm = l.name || l.type;
      if (name.textContent !== nm) name.textContent = nm;
      name.setAttribute('aria-pressed', on ? 'true' : 'false');
      name.setAttribute('aria-label', nm + (l.type === 'adjust' ? ', adjustment layer' : '') + (on ? ', selected' : ''));
      var eye = r.querySelector('[data-act="eye"]');
      if (eye._s !== (l.visible === false)) { eye._s = l.visible === false; eye.innerHTML = X.ic(eye._s ? 'eyeOff' : 'eye'); }
      eye.setAttribute('aria-label', (l.visible === false ? 'Show ' : 'Hide ') + nm);
      eye.setAttribute('aria-pressed', l.visible === false ? 'false' : 'true');
      var lock = r.querySelector('[data-act="lock"]');
      if (lock._s !== !!l.locked) { lock._s = !!l.locked; lock.innerHTML = X.ic(l.locked ? 'lock' : 'unlock'); }
      lock.classList.toggle('is-on', !!l.locked);
      lock.setAttribute('aria-label', (l.locked ? 'Unlock ' : 'Lock ') + nm);
      lock.setAttribute('aria-pressed', l.locked ? 'true' : 'false');
      r.querySelector('.xp-lay-clip').hidden = !l.clip;
      var m = X.doc.mask(l), mb = r.querySelector('[data-act="mask"]');
      mb.hidden = !m;
      if (m) {
        var u = maskThumb(m);
        if (mb._u !== u) { mb.style.backgroundImage = 'url(' + u + ')'; mb._u = u; }
        mb.classList.toggle('is-off', m.on === false);
        mb.classList.toggle('is-inv', !!m.invert);
        mb.setAttribute('aria-label', 'Mask of ' + nm + (m.on === false ? ', off' : '') + (m.invert ? ', inverted' : ''));
      }
      var fx = l.fx || [];
      var fb = r.querySelector('[data-act="fxopen"]');
      var showFx = fx.length > 0 || l.type === 'adjust';
      fb.hidden = !showFx;
      if (fb._n !== fx.length) { fb._n = fx.length; fb.innerHTML = X.ic('fx') + '<b>' + fx.length + '</b>' + X.ic('chev', 'xp-chev'); }
      fb.setAttribute('aria-expanded', openFx[l.id] ? 'true' : 'false');
      fb.setAttribute('aria-label', fx.length + ' effect' + (fx.length === 1 ? '' : 's') + ' on ' + nm);
      thumb(r, l);
      var ul = r.querySelector('.xp-fxrows');
      ul.hidden = !(showFx && openFx[l.id]);
      if (!ul.hidden) paintFx(ul, l);
    }
    function thumb(r, l) {
      var t = r.querySelector('.xp-lay-thumb');
      var key = l.type + (l.src || '') + (l.color || '') + (l.fill && l.fill.color || '');
      if (t._k === key) return;
      t._k = key;
      if (l.type === 'image' && l.src) {
        t.innerHTML = '';
        var cached = thumbs[l.src];
        if (cached) { t.style.backgroundImage = 'url(' + cached + ')'; return; }
        t.innerHTML = X.ic('image');
        if (c().thumbUrl) c().thumbUrl(l.src).then(function (u) { if (u) { thumbs[l.src] = u; t.innerHTML = ''; t.style.backgroundImage = 'url(' + u + ')'; } });
      } else {
        t.style.backgroundImage = '';
        t.innerHTML = l.type === 'text' ? '<b>T</b>' : X.ic(TYPE_ICON[l.type] || 'layers');
        if (l.type === 'shape' && typeof l.fill === 'string') t.style.background = l.fill;
      }
    }
    /* Effect rows of one layer, keyed by fx id. */
    function paintFx(ul, l) {
      var fx = l.fx || [];
      var keep = {};
      fx.forEach(function (e, i) {
        var li = ul.querySelector('[data-fx="' + e.id + '"]');
        if (!li) li = fxRow(l.id, e);
        keep[e.id] = 1;
        var d = X.def(e.type);
        li.classList.toggle('is-off', e.on === false);
        li.querySelector('input[type="checkbox"]').checked = e.on !== false;
        li.querySelector('.xp-fx-name').textContent = (d && d.name) || e.type;
        var amt = li._amt; if (amt) amt.set(Math.round((e.amount == null ? 1 : e.amount) * 100));
        li.querySelector('.xp-fx-mask').hidden = !(e.mask && e.mask.parts && e.mask.parts.length);
        if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
        var oe = openEntry[e.id];
        if (oe) { oe.panel.refresh(); if (oe.maskCtl) oe.maskCtl.set(e.mask); if (oe.blend.value !== (e.blend || 'normal')) oe.blend.value = e.blend || 'normal'; }
      });
      [].slice.call(ul.querySelectorAll('[data-fx]')).forEach(function (n) { if (!keep[n.getAttribute('data-fx')]) { closeEntry(n.getAttribute('data-fx')); n.remove(); } });
      var add = ul.querySelector('.xp-fx-add');
      if (!add) {
        add = h('<li class="xp-fx-add"><button type="button" class="xp-linkbtn" aria-haspopup="dialog">' + X.ic('plus') + '<span>Add effect</span></button></li>');
        add.querySelector('button').addEventListener('click', function (e) { var b = e.currentTarget; fxMenu(b, 'Add effect', function (id) { addPicked(l.id, id); openFx[l.id] = true; }); });
      }
      ul.appendChild(add);
    }
    function fxRow(layerId, e) {
      var d = X.def(e.type);
      var li = h('<li class="xp-fx" data-fx="' + esc(e.id) + '"><div class="xp-fx-row"><span class="xp-fx-grip" aria-hidden="true" title="Drag to reorder">' + X.ic('grip') + '</span>' +
        '<label class="xp-fx-on"><input type="checkbox" aria-label="Effect on"><i aria-hidden="true"></i></label>' +
        '<button type="button" class="xp-fx-name" aria-expanded="false"></button><span class="xp-fx-mask" title="Has a mask" hidden>' + X.ic('mask') + '</span><span class="xp-fx-amt"></span>' +
        '<button type="button" class="xp-ib" data-act="more" aria-label="Effect options" aria-haspopup="menu">' + X.ic('more') + '</button></div><div class="xp-fx-body" hidden></div></li>');
      li.querySelector('input').addEventListener('change', function (ev) { X.doc.setEntry(layerId, e.id, { on: ev.target.checked }, X.gesture()); });
      li.querySelector('input').addEventListener('keydown', function (ev) { if (/^(Backspace|Delete)$/.test(ev.key)) ev.stopPropagation(); });
      var amtEl = li.querySelector('.xp-fx-amt');
      var amtG = C.gesture({ onInput: function (v, k) { X.doc.setEntry(layerId, e.id, { amount: v / 100 }, k); }, onCommit: function (v, k) { X.doc.setEntry(layerId, e.id, { amount: v / 100 }, k); } });
      var cur = Math.round((e.amount == null ? 1 : e.amount) * 100);
      var num = h('<span class="xp-num" role="slider" tabindex="0" aria-label="Amount of ' + esc((d && d.name) || e.type) + '" aria-valuemin="0" aria-valuemax="100"></span>');
      amtEl.appendChild(num);
      var sc = { min: 0, max: 100, step: 1, unit: '%' };
      function setAmt(v) { cur = v; if (!num.querySelector('input')) num.textContent = v + '%'; num.setAttribute('aria-valuenow', String(v)); }
      var scr = C.scrubber(num, sc, function () { return cur; }, function (v, one) { setAmt(Math.round(v)); if (one) amtG.once(cur); else amtG.input(cur); }, amtG, 'Amount');
      num.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { C.swallow(ev); scr.edit(); return; }
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown' && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        C.swallow(ev); setAmt(clamp(cur + ((ev.key === 'ArrowUp' || ev.key === 'ArrowRight') ? 1 : -1) * (ev.shiftKey ? 10 : 1), 0, 100)); amtG.once(cur, true);
      });
      C.doubleTap(num, function () { setAmt(100); amtG.once(100); });
      li._amt = { set: function (v) { if (!amtG.active()) setAmt(v); } };
      setAmt(cur);
      li.querySelector('.xp-fx-name').addEventListener('click', function () { if (openEntry[e.id]) closeEntry(e.id); else openEntryPanel(layerId, e.id, li); });
      li.querySelector('[data-act="more"]').addEventListener('click', function (ev) {
        var en = X.doc.entry(layerId, e.id) || {};
        X.menu(ev.currentTarget, [
          { label: en.on === false ? 'Turn on' : 'Turn off', icon: en.on === false ? 'eye' : 'eyeOff', fn: function () { X.doc.setEntry(layerId, e.id, { on: en.on === false }, X.gesture()); } },
          { label: 'Reset settings', icon: 'reset', fn: function () { X.doc.resetEntry(layerId, e.id, X.gesture()); } },
          { label: 'Duplicate', icon: 'copy', fn: function () { var list = X.clone(X.doc.fx(layerId)); var i = list.findIndex(function (x) { return x.id === e.id; }); var cp = X.clone(list[i]); cp.id = X.uid('fx'); list.splice(i + 1, 0, cp); X.doc.setFx(layerId, list, X.gesture()); } },
          { label: 'Move up', icon: 'chev', disabled: X.doc.fx(layerId)[0] && X.doc.fx(layerId)[0].id === e.id, fn: function () { var i = X.doc.fx(layerId).findIndex(function (x) { return x.id === e.id; }); X.doc.moveFx(layerId, e.id, i - 1, X.gesture()); } },
          { label: 'Move down', icon: 'chev', fn: function () { var i = X.doc.fx(layerId).findIndex(function (x) { return x.id === e.id; }); X.doc.moveFx(layerId, e.id, i + 1, X.gesture()); } },
          { label: 'Copy mask', icon: 'copy', disabled: !(en.mask && en.mask.parts), fn: function () { X.clip.copy(en.mask); } },
          { label: 'Paste mask', icon: 'paste', disabled: !X.clip.has(), fn: function () { X.doc.setMask(layerId, e.id, X.clip.paste(), X.gesture()); } },
          { sep: true },
          { label: 'Remove effect', icon: 'trash', danger: true, fn: function () { X.doc.removeFx(layerId, e.id, X.gesture()); } }
        ]);
      });
      dragList(li.querySelector('.xp-fx-grip'), li, function () { return li.parentNode.querySelectorAll('.xp-fx'); }, function (to) { X.doc.moveFx(layerId, e.id, to, X.gesture()); });
      return li;
    }
    function openEntryPanel(layerId, fxId, li) {
      var en = X.doc.entry(layerId, fxId), d = en && X.def(en.type);
      var body = li.querySelector('.xp-fx-body');
      body.innerHTML = '';
      if (!d) { body.appendChild(h('<p class="xp-note">This effect (“' + esc(en ? en.type : '?') + '”) is not in the library on this device. It is kept in the design.</p>')); body.hidden = false; return; }
      var p = X.panel.build(d, X.panel.bindEntry(layerId, fxId));
      var blend = h('<div class="xp-row xp-choice"><label class="xp-lbl">Blend</label><div class="xp-ctl"><select class="xp-select" aria-label="Effect blend mode">' + FX_BLENDS.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('') + '</select></div></div>');
      var bs = blend.querySelector('select');
      bs.value = en.blend || 'normal';
      bs.addEventListener('change', function () { X.doc.setEntry(layerId, fxId, { blend: bs.value }, X.gesture()); });
      bs.addEventListener('keydown', function (e) { e.stopPropagation(); });
      var mk = C.create('mask', { label: 'Effect mask', value: en.mask, layerId: function () { return layerId; }, fxId: fxId,
        sample: function () { return null; },
        onInput: function (m, k) { X.doc.setMask(layerId, fxId, m, k); }, onCommit: function (m, k) { X.doc.setMask(layerId, fxId, m, k); },
        onPaint: function (i, erase) { X.emit('paint-mask', { layerId: layerId, fxId: fxId, part: i, erase: erase }); } });
      body.appendChild(p.el); body.appendChild(blend); body.appendChild(mk.el);
      body.hidden = false;
      li.classList.add('is-open');
      li.querySelector('.xp-fx-name').setAttribute('aria-expanded', 'true');
      openEntry[fxId] = { panel: p, maskCtl: mk, blend: bs };
      X.emit('fx-select', { layerId: layerId, type: en.type, fxId: fxId });
    }
    function closeEntry(fxId) {
      var oe = openEntry[fxId]; if (!oe) return;
      oe.panel.destroy(); if (oe.maskCtl) oe.maskCtl.destroy();
      delete openEntry[fxId];
      var hs = X.handles && X.handles.selected(); if (hs && hs.fxId === fxId) X.emit('fx-select', null);
      var li = list.querySelector('[data-fx="' + fxId + '"]');
      if (li) { li.classList.remove('is-open'); li.querySelector('.xp-fx-body').hidden = true; li.querySelector('.xp-fx-body').innerHTML = ''; li.querySelector('.xp-fx-name').setAttribute('aria-expanded', 'false'); }
    }

    /* Pointer reorder for layer rows and effect rows. Mouse: drag after 6 px. Touch: hold 300 ms, then drag. */
    function dragList(handle, item, siblings, drop) {
      var st = null, timer = 0;
      handle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target.closest('input, select, .xp-num, [data-act="eye"], [data-act="lock"], [data-act="mask"], [data-act="fxopen"], [data-act="more"]')) return;
        st = { y: e.clientY, x: e.clientX, id: e.pointerId, on: false, armed: e.pointerType === 'mouse' };
        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        if (!st.armed) timer = setTimeout(function () { if (st) { st.armed = true; item.classList.add('is-armed'); if (navigator.vibrate) try { navigator.vibrate(8); } catch (err) {} } }, 300);
      });
      handle.addEventListener('pointermove', function (e) {
        if (!st || e.pointerId !== st.id) return;
        if (!st.armed) { if (Math.abs(e.clientY - st.y) > 8) { clearTimeout(timer); st = null; } return; }
        if (!st.on) { if (Math.abs(e.clientY - st.y) < 6) return; st.on = true; item.classList.add('is-dragging'); el.classList.add('is-sorting'); }
        e.preventDefault();
        item.style.transform = 'translateY(' + (e.clientY - st.y) + 'px)';
        var sibs = [].slice.call(siblings()), idx = 0;
        sibs.forEach(function (s) { if (s === item) return; var r = s.getBoundingClientRect(); s.classList.toggle('is-drop-above', false); if (e.clientY > r.top + r.height / 2) idx++; });
        st.idx = idx;
        var target = sibs.filter(function (s) { return s !== item; })[idx];
        sibs.forEach(function (s) { s.classList.remove('is-drop-above', 'is-drop-below'); });
        if (target) target.classList.add('is-drop-above'); else if (sibs.length > 1) sibs.filter(function (s) { return s !== item; }).pop().classList.add('is-drop-below');
      });
      function end(e) {
        clearTimeout(timer);
        if (!st || e.pointerId !== st.id) { st = null; return; }
        var s = st; st = null;
        item.classList.remove('is-armed', 'is-dragging'); el.classList.remove('is-sorting');
        item.style.transform = '';
        [].forEach.call(siblings(), function (n) { n.classList.remove('is-drop-above', 'is-drop-below'); });
        if (s.on && s.idx != null && e.type !== 'pointercancel') { drop(s.idx); item._dragged = Date.now(); }
      }
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('click', function (e) { if (item._dragged && Date.now() - item._dragged < 300) { e.stopPropagation(); e.preventDefault(); } }, true);
    }

    function bindRow(r, id) {
      var row = r.querySelector('.xp-lay-row');
      row.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        var act = b ? b.getAttribute('data-act') : 'select';
        var l = X.doc.layer(id); if (!l) return;
        if (act === 'eye') X.doc.patchLayer(id, { visible: l.visible === false }, X.gesture());
        else if (act === 'lock') scene().lock(id, !l.locked);
        else if (act === 'fxopen') { openFx[id] = !openFx[id]; X.lsSet('le-expert-fxopen', openFx); paintRow(r, l); }
        else if (act === 'mask') maskMenu(b, id);
        else if (e.shiftKey || e.metaKey || e.ctrlKey) { var s = selected(); var i = s.indexOf(id); if (i >= 0) s.splice(i, 1); else s.push(id); scene().select(s); }
        else scene().select([id]);
      });
      row.addEventListener('dblclick', function (e) { var b = e.target.closest('[data-act]'); if (!b || b.getAttribute('data-act') === 'select') rename(id, r); });
      row.addEventListener('contextmenu', function (e) { e.preventDefault(); scene().select([id]); ctxMenu(r.querySelector('.xp-lay-name'), id); });
      /* Long-press opens the same menu on touch. */
      var lp = 0;
      row.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'touch') return; lp = setTimeout(function () { if (!r.classList.contains('is-dragging')) { scene().select([id]); ctxMenu(r.querySelector('.xp-lay-name'), id); } }, 600); });
      ['pointerup', 'pointercancel', 'pointermove'].forEach(function (t) { row.addEventListener(t, function (e) { if (t !== 'pointermove' || Math.abs(e.movementY) > 2) clearTimeout(lp); }); });
      row.addEventListener('keydown', function (e) {
        var k = e.key;
        if (e.target.closest('input, select, .xp-num')) return;
        if (k === 'F2') { C.swallow(e); rename(id, r); }
        else if ((k === 'F10' && e.shiftKey) || k === 'ContextMenu') { C.swallow(e); ctxMenu(r.querySelector('.xp-lay-name'), id); }
        else if (k === 'ArrowDown' || k === 'ArrowUp') {
          C.swallow(e);
          var all = [].slice.call(list.querySelectorAll(':scope > .xp-lay')), i = all.indexOf(r);
          if (e.altKey) { reorderBy(id, k === 'ArrowUp' ? 1 : -1); return; }
          var n = all[clamp(i + (k === 'ArrowDown' ? 1 : -1), 0, all.length - 1)];
          if (n) n.querySelector('.xp-lay-name').focus();
        } else if (k === 'Delete' || k === 'Backspace') { C.swallow(e); var l = X.doc.layer(id); if (l && !l.locked) scene().remove([id]); }
      });
      dragList(row, r, function () { return list.querySelectorAll(':scope > .xp-lay'); }, function (topIdx) {
        var n = scene().layers().length;
        scene().order(id, clamp(n - 1 - topIdx, 0, n - 1));
      });
    }
    function reorderBy(id, d) {
      var arr = scene().layers(); var i = arr.findIndex(function (l) { return l.id === id; });
      if (i < 0) return;
      scene().order(id, clamp(i + d, 0, arr.length - 1));
      setTimeout(function () { var r = rows[id]; if (r) r.querySelector('.xp-lay-name').focus(); }, 30);
    }
    function rename(id, r) {
      var nameBtn = r.querySelector('.xp-lay-name'), l = X.doc.layer(id);
      var input = h('<input class="xp-field xp-lay-rename" aria-label="Layer name">');
      input.value = l.name || '';
      nameBtn.hidden = true; nameBtn.parentNode.insertBefore(input, nameBtn);
      input.focus(); input.select();
      var done = false;
      function fin(ok) { if (done) return; done = true; var v = input.value.trim(); input.remove(); nameBtn.hidden = false; if (ok && v && v !== l.name) X.doc.patchLayer(id, { name: v.slice(0, 120) }, X.gesture()); nameBtn.focus(); }
      input.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
      input.addEventListener('blur', function () { fin(true); });
    }
    function maskMenu(anchor, id) {
      var l = X.doc.layer(id), m = X.doc.mask(l); if (!m) return;
      X.menu(anchor, [
        { label: m.on === false ? 'Enable mask' : 'Disable mask', icon: m.on === false ? 'eye' : 'eyeOff', fn: function () { var n = X.clone(m); if (n.on === false) delete n.on; else n.on = false; X.doc.setMask(id, null, n, X.gesture()); } },
        { label: m.invert ? 'Un-invert mask' : 'Invert mask', icon: 'invert', fn: function () { var n = X.clone(m); n.invert = !n.invert; if (!n.invert) delete n.invert; X.doc.setMask(id, null, n, X.gesture()); } },
        { label: 'Edit mask', icon: 'mask', fn: function () { scene().select([id]); X.emit('edit-mask', { layerId: id }); } },
        { label: 'Copy mask', icon: 'copy', fn: function () { X.clip.copy(m); } },
        { sep: true },
        { label: 'Delete mask', icon: 'trash', danger: true, fn: function () { X.doc.setMask(id, null, null, X.gesture()); } }
      ]);
    }
    function ctxMenu(anchor, id) {
      var l = X.doc.layer(id); if (!l) return;
      var m = X.doc.mask(l);
      X.menu(anchor, [
        { label: 'Rename', icon: 'text', kbd: 'F2', fn: function () { rename(id, rows[id]); } },
        { label: 'Duplicate', icon: 'copy', kbd: 'Ctrl D', fn: function () { scene().duplicate([id]); } },
        { label: l.visible === false ? 'Show' : 'Hide', icon: l.visible === false ? 'eye' : 'eyeOff', fn: function () { X.doc.patchLayer(id, { visible: l.visible === false }, X.gesture()); } },
        { label: l.locked ? 'Unlock' : 'Lock', icon: l.locked ? 'unlock' : 'lock', fn: function () { scene().lock(id, !l.locked); } },
        { sep: true },
        { label: 'Add effect…', icon: 'fx', disabled: l.type !== 'image' && l.type !== 'group' && l.type !== 'adjust', fn: function () { fxMenu(anchor, 'Add effect', function (t) { addPicked(id, t); openFx[id] = true; }); } },
        { label: 'New adjustment layer above…', icon: 'adjust', fn: function () { addAdjustMenu(anchor, id); } },
        l.type === 'adjust' ? { label: l.clip ? 'Release clipping' : 'Clip to layer below', icon: 'clip', fn: function () { X.doc.patchLayer(id, { clip: !l.clip }, X.gesture()); } } : null,
        { label: m ? 'Paste mask (replace)' : 'Paste mask', icon: 'paste', disabled: !X.clip.has(), fn: function () { X.doc.setMask(id, null, X.clip.paste(), X.gesture()); } },
        m ? { label: 'Copy mask', icon: 'copy', fn: function () { X.clip.copy(m); } } : { label: 'Add layer mask', icon: 'mask', fn: function () { X.doc.setMask(id, null, { parts: [X.maskPart('radial')] }, X.gesture()); } },
        (l.fx && l.fx.length) ? { label: 'Clear effects', icon: 'reset', fn: function () { X.doc.setFx(id, [], X.gesture()); } } : null,
        { sep: true },
        { label: 'Delete layer', icon: 'trash', danger: true, disabled: !!l.locked, fn: function () { scene().remove([id]); } }
      ].filter(Boolean));
    }
    function addAdjustMenu(anchor, above) {
      fxMenu(anchor, 'New adjustment layer', function (t) { var s = selected(); X.doc.addAdjust(t, { above: above || s[0] }, X.gesture()); });
    }
    X.layers.addAdjustMenu = addAdjustMenu;

    el.querySelector('[data-act="adj"]').addEventListener('click', function (e) { addAdjustMenu(e.currentTarget); });
    el.querySelector('[data-act="fx"]').addEventListener('click', function (e) {
      var id = selected()[0] || (c().targetImage() || {}).id;
      if (!id) { c().toast('Select a photo, a group or an adjustment layer first.'); return; }
      fxMenu(e.currentTarget, 'Add effect', function (t) { addPicked(id, t); openFx[id] = true; X.lsSet('le-expert-fxopen', openFx); });
    });
    el.querySelector('[data-act="mask"]').addEventListener('click', function () {
      var id = selected()[0]; if (!id) { c().toast('Select a layer first.'); return; }
      if (!X.doc.mask(X.doc.layer(id))) X.doc.setMask(id, null, { parts: [X.maskPart('radial')] }, X.gesture());
      X.emit('edit-mask', { layerId: id });
    });
    el.querySelector('[data-act="del"]').addEventListener('click', function () { var s = selected().filter(function (id) { var l = X.doc.layer(id); return l && !l.locked; }); if (s.length) scene().remove(s); });

    function sig() {
      var src = scene()._doc && scene()._doc.layers ? scene()._doc.layers : scene().layers();
      return selected().join(',') + '#' + JSON.stringify(src.map(function (l) { return [l.id, l.name, l.visible, l.locked, l.type, l.clip, l.src, l.opacity, l.blend, l.fx || 0, l[X.doc.MASK] && l[X.doc.MASK].parts ? l[X.doc.MASK] : 0]; })) + JSON.stringify(openFx);
    }
    function render() {
      if (!c() || !scene()) return;
      var s = sig();
      if (s === lastSig) return;
      lastSig = s;
      var ls = layersTopFirst();
      var keep = {};
      ls.forEach(function (l, i) {
        var r = rowFor(l);
        keep[l.id] = 1;
        if (list.children[i] !== r) list.insertBefore(r, list.children[i] || null);
      });
      Object.keys(rows).forEach(function (id) {
        if (keep[id]) return;
        [].forEach.call(rows[id].querySelectorAll('[data-fx]'), function (n) { closeEntry(n.getAttribute('data-fx')); });
        rows[id].remove(); delete rows[id];
      });
      el.classList.toggle('is-empty', !ls.length);
      paintProps();
      el.querySelector('[data-act="del"]').disabled = !selected().length;
    }
    var renderSoon = X.rafThrottle(render);
    render();
    return {
      el: el, render: renderSoon, renderNow: render,
      openEffects: function (id, on) { openFx[id] = on !== false; lastSig = ''; render(); },
      row: function (id) { return rows[id]; },
      destroy: function () { Object.keys(openEntry).forEach(closeEntry); el.remove(); }
    };
  };
})(window);
