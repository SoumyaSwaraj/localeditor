/* LocalEditor PDF studio panels: pages, edit, sign, forms, tools, convert, export, context bar, find, settings. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var PS = global.PS;
  var d = document;
  var S = PS.S;
  var $ = PS.$, $$ = PS.$$, el = PS.el, esc = PS.esc, icon = PS.icon, say = PS.say, clamp = PS.clamp, num = PS.num;

  var STYLE = {
    ink: '#17131F',
    penWidth: 2.2,
    hl: '#FFE56A',
    hlWidth: 16,
    stroke: '#E5484D',
    strokeWidth: 2,
    fill: 'none',
    fillColor: '#F2D594',
    font: 'Plus Jakarta Sans',
    size: 14,
    bold: false,
    italic: false,
    textColor: '#17131F',
    align: 'left'
  };
  PS.STYLE = STYLE;

  var INKS = ['#17131F', '#1D4ED8', '#E5484D', '#17A37A', '#7457F0', '#D07A45', '#E0668E', '#FFFFFF'];
  var HLS = ['#FFE56A', '#8BF5B0', '#FFA3C7', '#9CD3FF', '#FFC27A', '#D5C2FF'];

  function btn(cls, html, attrs) {
    var b = el('button', cls, html);
    b.type = 'button';
    Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    return b;
  }
  function section(title, sub) {
    var s = el('section', 'ps-sec');
    if (title) s.appendChild(el('h3', 'ps-sec-title', esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '')));
    return s;
  }
  function tile(iconName, label, attrs, tone) {
    var b = btn('ps-tile', '<span class="ps-tile-ic' + (tone ? ' t-' + tone : '') + '">' + icon(iconName) + '</span><span>' + esc(label) + '</span>', attrs);
    b.setAttribute('aria-label', label);
    return b;
  }
  function field(label, input, id) {
    var w = el('div', 'ps-field');
    var l = el('label', null, esc(label));
    if (id) { l.htmlFor = id; input.id = id; }
    w.appendChild(l);
    w.appendChild(input);
    return w;
  }
  function inputEl(type, value, attrs) {
    var i = d.createElement('input');
    i.type = type;
    i.className = type === 'range' ? '' : type === 'checkbox' || type === 'color' ? '' : 'input';
    if (value != null) i.value = value;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function selectEl(options, value) {
    var s = d.createElement('select');
    s.className = 'input';
    options.forEach(function (o) {
      var op = d.createElement('option');
      op.value = Array.isArray(o) ? o[0] : o;
      op.textContent = Array.isArray(o) ? o[1] : o;
      s.appendChild(op);
    });
    if (value != null) s.value = value;
    return s;
  }
  function seg(options, value, onPick) {
    var s = el('div', 'seg ps-seg');
    s.setAttribute('role', 'group');
    options.forEach(function (o) {
      var b = btn('', esc(o[1]), { 'data-v': o[0], 'aria-pressed': String(o[0] === value) });
      s.appendChild(b);
    });
    s.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      $$('button', s).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      onPick(b.getAttribute('data-v'));
    });
    s.setValue = function (v) { $$('button', s).forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-v') === String(v))); }); };
    return s;
  }
  function slider(label, min, max, step, value, fmt, onInput, opts) {
    opts = opts || {};
    var dflt = opts.reset != null ? opts.reset : value;
    var w = el('div', 'ps-slider');
    var head = el('div', 'ps-slider-head');
    var l = el('span', null, esc(label));
    var out = btn('ps-slider-v', '', { 'aria-label': label + ' value, click to type', title: 'Click to type · double-click the slider to reset' });
    head.appendChild(l);
    head.appendChild(out);
    var track = el('div', 'ps-slider-track');
    var r = inputEl('range', value, { min: min, max: max, step: step, 'aria-label': label });
    var tick = el('i', 'ps-slider-tick');
    tick.style.left = 'calc(' + ((dflt - min) / (max - min) * 100) + '% + ' + (8 - (dflt - min) / (max - min) * 16) + 'px)';
    track.appendChild(r);
    track.appendChild(tick);
    function show(v) { out.textContent = fmt ? fmt(v) : v; r.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%'); }
    show(value);
    function set(v, fire) {
      v = clamp(Math.round(v / step) * step, min, max);
      v = +v.toFixed(4);
      r.value = v;
      show(v);
      if (fire) onInput(v);
    }
    r.addEventListener('input', function () { show(+r.value); onInput(+r.value); });
    r.addEventListener('dblclick', function () { set(dflt, true); });
    out.addEventListener('click', function () {
      var i = inputEl('number', r.value, { min: min, max: max, step: step, 'aria-label': label });
      i.className = 'input ps-slider-in';
      out.replaceWith(i);
      i.focus();
      i.select();
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        if (ok && i.value !== '' && isFinite(+i.value)) set(+i.value, true);
        i.replaceWith(out);
      }
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
      i.addEventListener('blur', function () { finish(true); });
    });
    w.appendChild(head);
    w.appendChild(track);
    w.setValue = function (v) { r.value = v; show(v); };
    return w;
  }
  function toggle(label, checked, onChange, hint) {
    var w = el('label', 'ps-toggle');
    var i = inputEl('checkbox');
    i.checked = !!checked;
    w.appendChild(i);
    w.appendChild(el('span', 'ps-toggle-ui'));
    w.appendChild(el('span', 'ps-toggle-text', esc(label) + (hint ? '<small>' + esc(hint) + '</small>' : '')));
    i.addEventListener('change', function () { onChange(i.checked); });
    w.input = i;
    return w;
  }
  function swatches(colors, value, onPick, withCustom, opts) {
    opts = opts || {};
    var w = el('div', 'ps-swatches');
    w.setAttribute('role', 'radiogroup');
    if (opts.label) w.setAttribute('aria-label', opts.label);
    colors.forEach(function (c, i) {
      var hex = Array.isArray(c) ? c[0] : c, name = Array.isArray(c) ? c[1] : null;
      var b = btn('ps-sw', '', { 'data-c': hex, 'aria-label': (name || 'Colour') + ' ' + hex, title: name ? name + ' · ' + hex : hex, role: 'radio', 'aria-checked': String(hex.toLowerCase() === String(value).toLowerCase()) });
      b.style.setProperty('--c', hex);
      if (PS.color && PS.color.luminance(hex) > 0.6) b.classList.add('is-light');
      w.appendChild(b);
    });
    var custom = null, cur = value;
    if (withCustom !== false) {
      custom = btn('ps-sw ps-sw-custom', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v10M7 12h10"/></svg>', { 'aria-label': 'More colours', title: 'More colours', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
      w.appendChild(custom);
      custom.addEventListener('click', function () {
        if (!PS.color) return;
        PS.color.open(custom, {
          value: /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#17131F', title: opts.title || 'Colour', named: opts.named, namedTitle: opts.namedTitle,
          onInput: function (v) { if (!v) return; mark(v); onPick(v); }
        });
      });
    }
    function mark(v) {
      cur = v;
      var hit = false;
      $$('.ps-sw[data-c]', w).forEach(function (b) { var on = b.getAttribute('data-c').toLowerCase() === String(v).toLowerCase(); if (on) hit = true; b.setAttribute('aria-checked', String(on)); });
      if (custom) {
        if (!hit && opts.known) hit = opts.known().some(function (k) { return String(k).toLowerCase() === String(v).toLowerCase(); });
        var own = !hit && /^#[0-9a-f]{6}$/i.test(v || '');
        custom.classList.toggle('has-c', own);
        custom.style.setProperty('--c', own ? v : '');
        custom.setAttribute('aria-checked', String(own));
      }
    }
    mark(value);
    w.addEventListener('click', function (e) {
      var b = e.target.closest('.ps-sw[data-c]');
      if (!b) return;
      mark(b.getAttribute('data-c'));
      onPick(b.getAttribute('data-c'));
    });
    w.setValue = mark;
    return w;
  }
  PS.ui = { btn: btn, section: section, tile: tile, field: field, inputEl: inputEl, selectEl: selectEl, seg: seg, slider: slider, toggle: toggle, swatches: swatches };

  function fontFamilies() {
    try { return LE.fonts ? LE.fonts.list() : []; } catch (e) { return []; }
  }
  function fontSelect(value) {
    var s = d.createElement('select');
    s.className = 'input ps-font-select';
    var cats = { sans: 'Sans', serif: 'Serif', display: 'Display', handwriting: 'Handwriting', mono: 'Monospace' };
    var groups = {};
    fontFamilies().forEach(function (f) {
      var g = groups[f.category];
      if (!g) {
        g = groups[f.category] = d.createElement('optgroup');
        g.label = cats[f.category] || f.category;
        s.appendChild(g);
      }
      var o = d.createElement('option');
      o.value = f.family;
      o.textContent = f.family;
      g.appendChild(o);
    });
    if (!s.options.length) { var o2 = d.createElement('option'); o2.value = 'Plus Jakarta Sans'; o2.textContent = 'Plus Jakarta Sans'; s.appendChild(o2); }
    s.value = value || 'Plus Jakarta Sans';
    if (s.value !== value && value) {
      var extra = d.createElement('option');
      extra.value = value;
      extra.textContent = value;
      s.insertBefore(extra, s.firstChild);
      s.value = value;
    }
    s.setAttribute('aria-label', 'Font');
    return s;
  }

  function svgMark(kind, color) {
    var p = kind === 'check' ? '<path d="M4 12.5l5 5L20 6.5" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
      : kind === 'cross' ? '<path d="M5 5l14 14M19 5 5 19" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>'
      : '<circle cx="12" cy="12" r="6" fill="' + color + '"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + p + '</svg>';
  }
  function today() {
    try { return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return new Date().toDateString(); }
  }
  function within(pt, ref, w, h) {
    var size = PS.refSize(ref);
    return { x: clamp(pt.x - w / 2, 0, Math.max(0, size.w - w)), y: clamp(pt.y - h / 2, 0, Math.max(0, size.h - h)) };
  }

  /* ---------- placers (tap on a page to place) ---------- */

  PS.placers.text = function (pt, ref) {
    var size = STYLE.size, w = Math.max(120, size * 14), h = Math.round(size * 1.5);
    var at = within(pt, ref, w, h);
    at.x = clamp(pt.x - 4, 0, PS.refSize(ref).w - 40);
    return { layer: { type: 'text', name: 'Text', text: 'Type here', x: at.x, y: at.y, w: w, h: h, size: size, font: STYLE.font, weight: STYLE.bold ? 700 : 400, italic: STYLE.italic, color: STYLE.textColor, align: STYLE.align, lineHeight: 1.25 }, edit: true };
  };
  PS.placers.note = function (pt, ref) {
    var at = within(pt, ref, 180, 64);
    return { layer: { type: 'text', name: 'Note', text: 'Comment', x: at.x, y: at.y, w: 180, h: 64, size: 11, font: 'Plus Jakarta Sans', weight: 500, color: '#3A2A0E', lineHeight: 1.3, background: { color: '#FFE58A', radius: 6, padding: 9 } }, edit: true };
  };
  PS.placers.date = function (pt, ref) {
    var size = STYLE.size, txt = today(), w = Math.max(60, txt.length * size * 0.56), h = Math.round(size * 1.4);
    var at = within(pt, ref, w, h);
    return { layer: { type: 'text', name: 'Date', text: txt, x: at.x, y: at.y, w: w, h: h, size: size, font: STYLE.font, weight: 400, color: STYLE.textColor, lineHeight: 1.2 } };
  };
  ['check', 'cross', 'dot'].forEach(function (k) {
    PS.placers[k] = function (pt, ref) {
      var s = k === 'dot' ? 10 : 16;
      var at = within(pt, ref, s, s);
      return { layer: { type: 'svg', name: k === 'check' ? 'Check' : k === 'cross' ? 'Cross' : 'Dot', svg: svgMark(k, STYLE.ink), x: at.x, y: at.y, w: s, h: s } };
    };
  });
  PS.placers.image = function (pt, ref) {
    var o = S.toolOpts;
    if (!o.canvas) return null;
    var size = PS.refSize(ref);
    var w = Math.min(o.width || 220, size.w * 0.8);
    var h = w * o.canvas.height / o.canvas.width;
    var at = within(pt, ref, w, h);
    return { layer: { type: 'image', name: o.name || 'Image', src: o.key, x: at.x, y: at.y, w: w, h: h }, asset: { key: o.key, value: o.canvas } };
  };
  PS.placers.sign = PS.placers.image;
  PS.placers.sticker = function (pt, ref) {
    var o = S.toolOpts;
    if (!o.assetId && !o.svg) return null;
    var w = o.width || 96, h = w * (o.ratio || 1);
    var at = within(pt, ref, w, h);
    var layer = { type: 'svg', name: o.name || 'Sticker', x: at.x, y: at.y, w: w, h: h };
    if (o.svg) {
      layer.id = PS.uid('ic');
      layer.svg = o.svg;
      if (o.meta) { S.docTools._iconMeta = S.docTools._iconMeta || {}; S.docTools._iconMeta[layer.id] = PS.clone(o.meta); }
    } else layer.assetId = o.assetId;
    if (o.color && !o.svg) layer.color = o.color;
    return { layer: layer };
  };

  PS.toolHint = function (tool) {
    var phone = PS.isPhone();
    var tap = phone ? 'Tap' : 'Click';
    return {
      text: tap + ' where the text should go',
      note: tap + ' to pin a comment',
      date: tap + ' to stamp today’s date',
      check: tap + ' to add a check mark',
      cross: tap + ' to add a cross',
      dot: tap + ' to add a dot',
      sign: tap + ' where you want to sign',
      image: tap + ' to place the image',
      sticker: tap + ' to place it',
      pen: 'Draw on any page' + (phone ? '' : ' · Esc to stop'),
      highlighter: 'Drag across text to highlight',
      hlbox: 'Drag a box to highlight an area',
      whiteout: 'Drag to cover content with white',
      redact: 'Drag over anything to remove it for good',
      eraser: 'Drag across a drawing to erase it'
    }[tool] || (tool.indexOf('shape:') === 0 ? 'Drag to draw the shape' : '');
  };

  PS.styleNew = function (layer) {
    var t = S.tool;
    if (layer.type === 'path' && (t === 'pen' || t === 'highlighter' || t === 'marker')) {
      if (t === 'highlighter') return { color: STYLE.hl, width: STYLE.hlWidth };
      return { color: STYLE.ink, width: STYLE.penWidth, name: 'Ink' };
    }
    if (layer.type === 'shape' && layer.fill && layer.fill.color === '#7457F0') {
      if (t === 'hlbox') return { fill: { type: 'solid', color: STYLE.hl }, stroke: null, opacity: 0.5, blend: 'multiply', name: 'Highlight' };
      if (t === 'whiteout') return { fill: { type: 'solid', color: '#FFFFFF' }, stroke: null, name: 'Whiteout' };
      if (t === 'redact') return { fill: { type: 'solid', color: '#000000' }, stroke: null, name: 'Redaction' };
      if (t.indexOf('shape:') === 0) {
        var id = t.slice(6);
        var open = /line|arc|curve|polyline/.test(id);
        return {
          fill: open || STYLE.fill === 'none' ? { type: 'none' } : { type: 'solid', color: STYLE.fillColor },
          stroke: { width: STYLE.strokeWidth, color: STYLE.stroke, cap: 'round', join: 'round', dash: id === 'dashed-line' ? [6, 4] : null }
        };
      }
    }
    return null;
  };

  PS.shortcut = function (key) {
    if (!S.pages.length) return false;
    var map = { v: 'select', t: 'text', h: 'highlighter', p: 'pen', n: 'note', e: 'eraser', r: 'shape:rectangle' };
    var k = String(key).toLowerCase();
    if (map[k]) { PS.setTool(map[k]); return true; }
    return false;
  };

  /* ---------- context bar ---------- */

  var ctxKey = '';
  var QUICK = [
    ['select', 'pointer', 'Select'],
    ['text', 'text', 'Text'],
    ['highlighter', 'highlight', 'Highlight'],
    ['pen', 'pen', 'Draw'],
    ['shape:rectangle', 'square', 'Box'],
    ['shape:arrow-line', 'arrow', 'Arrow'],
    ['note', 'note', 'Note'],
    ['check', 'check', 'Check'],
    ['date', 'calendar', 'Date'],
    ['sign-panel', 'sign', 'Sign'],
    ['whiteout', 'whiteout', 'Whiteout'],
    ['redact', 'redact', 'Redact']
  ];

  function selLayers() {
    var sc = PS.activeScene();
    if (!sc) return null;
    var ids = sc.selection();
    var layers = ids.map(function (id) { return sc.layer(id); }).filter(Boolean);
    if (!layers.length) return null;
    return { sc: sc, ids: ids, layers: layers };
  }
  function patchSel(patch, key) {
    var s = selLayers();
    if (!s) return;
    s.ids.forEach(function (id) { s.sc.update(id, typeof patch === 'function' ? patch(s.sc.layer(id)) : patch, { coalesce: 'ctx-' + key }); });
    if (s.sc._endHist && /^(bold|italic|underline|align|front|back|lock)$/.test(key)) s.sc._endHist();
  }

  PS.renderCtx = function () {
    var box = PS.E && PS.E.ctx;
    if (!box) return;
    if (!S.pages.length) { box.innerHTML = ''; ctxKey = ''; return; }
    var s = /^(pen|marker|highlighter|eraser)$/.test(S.tool) ? null : selLayers();
    var editing = s && s.sc._editing;
    var key = s ? 'sel:' + s.ids.join(',') + ':' + s.layers.map(function (l) { return l.type; }).join(',') + (editing ? ':e' : '') : 'tool:' + S.tool + ':' + (PS.isPhone() ? 'p' : 'd');
    if (key === ctxKey && box.contains(d.activeElement)) { syncCtxValues(s); return; }
    ctxKey = key;
    box.innerHTML = '';
    box.classList.toggle('is-sel', !!s);
    if (s) buildSelCtx(box, s);
    else buildToolCtx(box);
  };

  function buildToolCtx(box) {
    var row = el('div', 'ps-ctx-row');
    QUICK.forEach(function (q) {
      var on = S.tool === q[0];
      var b = btn('ps-chip' + (on ? ' is-on' : ''), icon(q[1]) + '<span>' + esc(q[2]) + '</span>', { 'aria-pressed': String(on), title: q[2] });
      b.addEventListener('click', function () {
        if (q[0] === 'sign-panel') { PS.openPanel('sign'); return; }
        PS.setTool(S.tool === q[0] && q[0] !== 'select' ? 'select' : q[0]);
      });
      row.appendChild(b);
    });
    if (S.tool === 'pen' || S.tool === 'highlighter') {
      row.appendChild(el('span', 'ps-ctx-sep'));
      var sw = swatches(S.tool === 'pen' ? INKS.slice(0, 6) : HLS, S.tool === 'pen' ? STYLE.ink : STYLE.hl, function (c) {
        if (S.tool === 'pen') STYLE.ink = c; else STYLE.hl = c;
      }, true, { title: S.tool === 'pen' ? 'Pen colour' : 'Highlighter colour' });
      sw.classList.add('is-compact');
      row.appendChild(sw);
    }
    if (S.tool !== 'select') {
      var done = btn('ps-chip ps-chip-done', icon('check') + '<span>Done</span>');
      done.addEventListener('click', function () { PS.setTool('select'); });
      row.appendChild(done);
    }
    box.appendChild(row);
  }

  function colorBtn(label, value, onInput, opts) {
    return PS.color.button(label, value && value !== 'none' ? value : null, function (c) { if (c) onInput(c); }, opts);
  }
  PS.ui.colorBtn = colorBtn;

  function buildSelCtx(box, s) {
    var row = el('div', 'ps-ctx-row');
    var L = s.layers[0];
    var same = s.layers.every(function (l) { return l.type === L.type; });
    if (same && L.type === 'text') {
      var fs = fontSelect(L.font);
      fs.setAttribute('data-k', 'font');
      fs.addEventListener('change', function () { STYLE.font = fs.value; patchSel({ font: fs.value }, 'font'); });
      row.appendChild(fs);
      var size = inputEl('number', Math.round(L.size), { min: 4, max: 400, step: 1, 'aria-label': 'Font size', 'data-k': 'size' });
      size.className = 'input ps-num';
      size.addEventListener('input', function () {
        var v = clamp(+size.value || 12, 4, 400);
        STYLE.size = v;
        patchSel(function (l) { return { size: v, h: Math.max(l.h, v * 1.3) }; }, 'size');
      });
      row.appendChild(size);
      row.appendChild(colorBtn('Text color', L.color, function (c) { STYLE.textColor = c; patchSel({ color: c }, 'color'); }));
      [['bold', 'bold', 'Bold'], ['italic', 'italic', 'Italic'], ['underline', 'underline', 'Underline']].forEach(function (f) {
        var on = f[0] === 'bold' ? L.weight >= 600 : !!L[f[0]];
        var b = btn('ps-ib' + (on ? ' is-on' : ''), icon(f[1]), { 'aria-label': f[2], 'aria-pressed': String(on), title: f[2] });
        b.addEventListener('click', function () {
          var cur = selLayers();
          if (!cur) return;
          var l0 = cur.layers[0];
          var next = f[0] === 'bold' ? !(l0.weight >= 600) : !l0[f[0]];
          if (f[0] === 'bold') { STYLE.bold = next; patchSel({ weight: next ? 700 : 400 }, 'bold'); }
          else { if (f[0] === 'italic') STYLE.italic = next; var p = {}; p[f[0]] = next; patchSel(p, f[0]); }
          b.classList.toggle('is-on', next);
          b.setAttribute('aria-pressed', String(next));
        });
        row.appendChild(b);
      });
      var al = btn('ps-ib', icon(L.align === 'center' ? 'alignC' : L.align === 'right' ? 'alignR' : 'alignL'), { 'aria-label': 'Align', title: 'Align' });
      al.addEventListener('click', function () {
        var cur = selLayers();
        if (!cur) return;
        var next = { left: 'center', center: 'right', right: 'left' }[cur.layers[0].align || 'left'];
        STYLE.align = next;
        patchSel({ align: next }, 'align');
        al.innerHTML = icon(next === 'center' ? 'alignC' : next === 'right' ? 'alignR' : 'alignL');
      });
      row.appendChild(al);
      if (L.background) {
        row.appendChild(colorBtn('Note color', L.background.color, function (c) { patchSel({ background: { color: c } }, 'bg'); }));
      }
    } else if (same && L.type === 'shape') {
      var isLine = /line|arc|curve|polyline/.test(L.shape);
      if (!isLine) {
        row.appendChild(colorBtn('Fill', L.fill && L.fill.type !== 'none' ? L.fill.color : '#ffffff', function (c) { STYLE.fillColor = c; patchSel({ fill: { type: 'solid', color: c } }, 'fill'); }));
        var nofill = btn('ps-chip', 'No fill', { title: 'Remove fill' });
        nofill.addEventListener('click', function () { patchSel({ fill: { type: 'none' } }, 'fill'); });
        row.appendChild(nofill);
      }
      row.appendChild(colorBtn('Outline', L.stroke ? L.stroke.color : '#17131F', function (c) { STYLE.stroke = c; patchSel(function (l) { return { stroke: { color: c, width: l.stroke && l.stroke.width ? l.stroke.width : 2 } }; }, 'stroke'); }));
      var sw = selectEl([['0', 'No line'], ['1', 'Thin'], ['2', 'Medium'], ['4', 'Thick'], ['8', 'Heavy']], String(L.stroke ? Math.round(L.stroke.width) : 0));
      sw.setAttribute('aria-label', 'Outline width');
      sw.classList.add('ps-mini');
      sw.addEventListener('change', function () {
        var v = +sw.value;
        STYLE.strokeWidth = v || STYLE.strokeWidth;
        patchSel(function (l) { return v ? { stroke: { width: v, color: (l.stroke && l.stroke.color) || STYLE.stroke } } : { stroke: { width: 0 } }; }, 'sw');
      });
      row.appendChild(sw);
    } else if (same && L.type === 'path') {
      row.appendChild(colorBtn('Ink color', L.color, function (c) { patchSel({ color: c }, 'ink'); }));
      var pw = selectEl([['1', 'Fine'], ['2.2', 'Pen'], ['4', 'Bold'], ['8', 'Marker'], ['16', 'Highlighter'], ['28', 'Wide']], String(L.width));
      pw.classList.add('ps-mini');
      pw.setAttribute('aria-label', 'Stroke width');
      pw.addEventListener('change', function () { patchSel({ width: +pw.value }, 'pw'); });
      row.appendChild(pw);
    } else if (same && L.type === 'svg' && PS.graphics && PS.graphics.ctxFor(L)) {
      PS.graphics.buildCtx(row, s);
    } else if (same && L.type === 'svg' && (L.assetId ? !/^emoji:|^stickers:/.test(L.assetId) : false)) {
      row.appendChild(colorBtn('Icon colour', L.color || '#17131F', function (c) { patchSel({ color: c }, 'svgc'); }));
    } else if (s.layers.every(PS.isSigLayer)) {
      row.appendChild(el('span', 'ps-ctx-label', 'Ink'));
      var inkSw = swatches(PS.SIG_INKS.slice(0, 7), PS.sigInkOf(L) || '', function (c) { PS.recolorSigLayers(c); }, true, { label: 'Signature ink', title: 'Signature ink', named: PS.signatureInks ? PS.signatureInks() : PS.SIG_INKS, namedTitle: 'Signature inks' });
      inkSw.classList.add('is-compact');
      row.appendChild(inkSw);
    }
    var op = el('label', 'ps-ctx-op');
    op.innerHTML = '<span>Opacity</span>';
    var r = inputEl('range', Math.round((L.opacity == null ? 1 : L.opacity) * 100), { min: 5, max: 100, step: 1, 'aria-label': 'Opacity', 'data-k': 'opacity' });
    r.addEventListener('input', function () { patchSel({ opacity: +r.value / 100 }, 'opacity'); });
    op.appendChild(r);
    row.appendChild(op);
    row.appendChild(el('span', 'ps-ctx-sep'));
    var acts = [
      ['copy', 'Duplicate', function (cur) { cur.sc.duplicate(cur.ids); }],
      ['front', 'Bring to front', function (cur) { cur.ids.forEach(function (id) { cur.sc.order(id, 'front'); }); }],
      ['back', 'Send to back', function (cur) { cur.ids.forEach(function (id) { cur.sc.order(id, 'back'); }); }],
      [L.locked ? 'unlock' : 'lock', L.locked ? 'Unlock' : 'Lock', function (cur) { cur.ids.forEach(function (id) { cur.sc.lock(id, !cur.sc.layer(id).locked); }); ctxKey = ''; PS.renderCtx(); }],
      ['trash', 'Delete', function (cur) { cur.sc.remove(cur.ids); }]
    ];
    acts.forEach(function (a) {
      var b = btn('ps-ib' + (a[0] === 'trash' ? ' is-danger' : ''), icon(a[0]), { 'aria-label': a[1], title: a[1] });
      b.addEventListener('click', function () { var cur = selLayers(); if (cur) a[2](cur); });
      row.appendChild(b);
    });
    var name = L.name || '';
    if (/^Redaction/.test(name)) {
      var warn = el('span', 'ps-ctx-warn', icon('alert') + '<span>Redacted page saves as an image</span>');
      row.appendChild(warn);
    }
    var done = btn('ps-chip ps-chip-done', icon('check') + '<span>Done</span>');
    done.addEventListener('click', function () { var cur = selLayers(); if (cur) cur.sc.select([]); });
    row.appendChild(done);
    box.appendChild(row);
  }
  function syncCtxValues(s) {
    if (!s) return;
    var L = s.layers[0];
    var r = $('[data-k="opacity"]', PS.E.ctx);
    if (r && d.activeElement !== r) r.value = Math.round((L.opacity == null ? 1 : L.opacity) * 100);
    var size = $('[data-k="size"]', PS.E.ctx);
    if (size && d.activeElement !== size && L.size) size.value = Math.round(L.size);
  }

  /* ---------- Pages panel ---------- */

  PS.panels.pages = {
    title: 'Pages', icon: 'pages', tone: 'violet', snap: 'half',
    build: function (pane) {
      var slot = el('div', 'ps-thumb-slot');
      slot.setAttribute('data-thumb-slot', '');
      pane.appendChild(slot);

      var selBar = el('div', 'ps-selbar');
      selBar.innerHTML = '<span class="ps-selcount" data-selcount>Page 1</span>';
      var all = btn('btn btn-sm btn-ghost', 'Select all');
      all.addEventListener('click', function () {
        var allOn = S.pages.every(function (r) { return S.sel[r.uid]; });
        S.sel = {};
        if (!allOn) S.pages.forEach(function (r) { S.sel[r.uid] = true; });
        if (!allOn && PS.isPhone()) d.body.classList.add('ps-selecting'); else d.body.classList.remove('ps-selecting');
        PS.thumbs().updateSel();
      });
      selBar.appendChild(all);
      pane.appendChild(selBar);

      var s1 = section('Selected pages');
      var g = el('div', 'ps-tiles');
      var acts = [
        ['rotL', 'Rotate left', function () { PS.rotatePages(PS.selectedUids(), -90); }],
        ['rotR', 'Rotate right', function () { PS.rotatePages(PS.selectedUids(), 90); }],
        ['copy', 'Duplicate', function () { PS.duplicatePages(PS.selectedUids()); }],
        ['trash', 'Delete', function () { PS.deletePages(PS.selectedUids()); }, 'rose'],
        ['scissors', 'Extract', function () { extractSelected(); }],
        ['up', 'Move up', function () { var idx = PS.selectedIndexes(); if (idx[0] > 0) PS.movePages(PS.selectedUids(), idx[0] - 1); }],
        ['down', 'Move down', function () { var idx = PS.selectedIndexes(); var last = idx[idx.length - 1]; if (last < S.pages.length - 1) PS.movePages(PS.selectedUids(), last + 2); }],
        ['grid', 'Organize', function () { PS.openOrganizer(); if (PS.isPhone()) PS.setSheet('closed'); }]
      ];
      acts.forEach(function (a) {
        var t = tile(a[0], a[1], null, a[3]);
        t.addEventListener('click', a[2]);
        g.appendChild(t);
      });
      s1.appendChild(g);
      pane.appendChild(s1);

      var s2 = section('Insert');
      var sizeSel = selectEl([['same', 'Same as current'], ['A4', 'A4'], ['Letter', 'Letter'], ['Legal', 'Legal'], ['A5', 'A5'], ['A3', 'A3']], 'same');
      var land = toggle('Landscape', false, function () {});
      var row = el('div', 'ps-row');
      row.appendChild(field('Blank page size', sizeSel, 'ps-blank-size'));
      s2.appendChild(row);
      s2.appendChild(land);
      var ib = el('div', 'ps-btnrow');
      var addBlank = btn('btn btn-sm', icon('blank') + 'Blank page');
      addBlank.addEventListener('click', function () { PS.insertBlank(sizeSel.value, land.input.checked); });
      var addFile = btn('btn btn-sm', icon('filePlus') + 'From file');
      addFile.addEventListener('click', function () {
        PS.pickFiles(PS.ACCEPT_ANY, true).then(function (files) { if (files.length) PS.addFiles(files, { at: S.current + 1 }); });
      });
      ib.appendChild(addBlank);
      ib.appendChild(addFile);
      s2.appendChild(ib);
      pane.appendChild(s2);

      var s3 = section('Arrange');
      var ar = el('div', 'ps-btnrow');
      var rev = btn('btn btn-sm', icon('reverse') + 'Reverse order');
      rev.addEventListener('click', function () { PS.reorderAll(LE.pdf.order.reverse(S.pages), 'Reverse'); say('Order reversed'); });
      ar.appendChild(rev);
      s3.appendChild(ar);
      var scanSel = selectEl([['odd-even', 'Fronts then backs'], ['odd-even-reverse', 'Fronts then backs (backs reversed)'], ['even-odd', 'Backs then fronts']], 'odd-even-reverse');
      s3.appendChild(field('Scanned double-sided order', scanSel, 'ps-scan'));
      var scanBtn = btn('btn btn-sm', icon('shuffle') + 'Interleave pages');
      scanBtn.addEventListener('click', function () { PS.reorderAll(LE.pdf.order.scan(S.pages, scanSel.value), 'Interleave'); say('Pages interleaved'); });
      s3.appendChild(scanBtn);
      s3.appendChild(el('p', 'ps-note', 'Scanned the fronts, then the backs? Interleave puts every sheet back in reading order.'));
      pane.appendChild(s3);

      var s4 = section('Split or extract');
      var ranges = inputEl('text', '', { placeholder: 'e.g. 1-3, 5, 8-', inputmode: 'text', autocomplete: 'off' });
      s4.appendChild(field('Page ranges', ranges, 'ps-ranges'));
      var note = el('p', 'ps-note', 'Each range becomes its own PDF.');
      s4.appendChild(note);
      ranges.addEventListener('input', function () {
        var r = LE.pdf.parseRanges(ranges.value, S.pages.length);
        note.textContent = !ranges.value.trim() ? 'Each range becomes its own PDF.' : r.bad ? 'Check the ranges. Use numbers like 1-3, 5, 8-.' : r.groups.length + ' file' + (r.groups.length === 1 ? '' : 's') + ', ' + r.pages.length + ' page' + (r.pages.length === 1 ? '' : 's');
        note.classList.toggle('ps-bad', !!r.bad);
      });
      var sr = el('div', 'ps-btnrow');
      var splitBtn = btn('btn btn-sm', icon('scissors') + 'Split into files');
      splitBtn.addEventListener('click', function () { splitRanges(ranges.value); });
      var exBtn = btn('btn btn-sm', icon('download') + 'Extract as one PDF');
      exBtn.addEventListener('click', function () {
        var r = LE.pdf.parseRanges(ranges.value, S.pages.length);
        if (!r.pages.length) { say('Type the pages to extract'); return; }
        extractPages(r.pages.map(function (n) { return S.pages[n - 1]; }), '-pages.pdf');
      });
      sr.appendChild(splitBtn);
      sr.appendChild(exBtn);
      s4.appendChild(sr);
      var every = btn('btn btn-sm btn-ghost', 'Split every page');
      every.addEventListener('click', function () {
        var parts = S.pages.map(function (_, i) { return String(i + 1); }).join(',');
        splitRanges(parts);
      });
      s4.appendChild(every);
      pane.appendChild(s4);
    },
    show: function () { updateSelCount(); }
  };
  function updateSelCount() {
    var n = Object.keys(S.sel).length;
    $$('[data-selcount]').forEach(function (x) { x.textContent = n ? n + ' selected' : 'Page ' + (S.current + 1) + ' of ' + S.pages.length; });
  }
  PS.onSelectionChange = updateSelCount;
  PS.onStatus = updateSelCount;
  var prevPagesChanged = PS.onPagesChanged;
  PS.onPagesChanged = function () { updateSelCount(); if (prevPagesChanged) prevPagesChanged(); if (PS.onFields) PS.onFields(); };

  async function extractPages(refs, suffix) {
    if (!refs.length) return;
    var pr = PS.progress('Extracting ' + refs.length + ' page' + (refs.length === 1 ? '' : 's'), true);
    try {
      var bytes = await PS.buildPdf({ pages: refs, progress: pr });
      pr.end();
      IT.download(new Blob([bytes], { type: 'application/pdf' }), PS.outName(suffix));
    } catch (e) {
      pr.end();
      if (!e.cancelled) say('Could not extract: ' + e.message, 4200);
    }
  }
  function extractSelected() {
    var idx = PS.selectedIndexes();
    extractPages(idx.map(function (i) { return S.pages[i]; }), idx.length === 1 ? '-page-' + (idx[0] + 1) + '.pdf' : '-selection.pdf');
  }
  PS.extractSelected = extractSelected;

  async function splitRanges(spec) {
    var r = LE.pdf.parseRanges(spec, S.pages.length);
    if (r.bad || !r.groups.length) { say('Type ranges like 1-3, 5, 8-'); return; }
    var pr = PS.progress('Splitting into ' + r.groups.length + ' files', true);
    try {
      var files = [];
      for (var i = 0; i < r.groups.length; i++) {
        var g = r.groups[i];
        pr.set(i, r.groups.length, 'File ' + (i + 1) + ' of ' + r.groups.length);
        var bytes = await PS.buildPdf({ pages: g.map(function (n) { return S.pages[n - 1]; }) });
        var label = g.length === 1 ? 'page-' + g[0] : 'pages-' + g[0] + '-' + g[g.length - 1];
        files.push({ name: PS.baseName(PS.outName()) + '-' + label + '.pdf', data: bytes });
        await PS.frame();
      }
      pr.end();
      if (files.length === 1) IT.download(new Blob([files[0].data], { type: 'application/pdf' }), files[0].name);
      else IT.download(LE.zip(files), PS.outName('-split.zip'));
    } catch (e) {
      pr.end();
      if (!e.cancelled) say('Could not split: ' + e.message, 4200);
    }
  }
  PS.splitRanges = splitRanges;

  /* ---------- Edit panel ---------- */

  var STAMPS = [['stickers:stamp-approved', 'Approved'], ['stickers:stamp-draft', 'Draft'], ['stickers:stamp-confidential', 'Confidential'], ['stickers:stamp-paid', 'Paid'], ['stickers:check-seal', 'Verified'], ['stickers:seal', 'Seal']];

  function armSticker(id, name) {
    var ratio = 1;
    try {
      var svg = LE.assets.svg(id);
      var m = /viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"/.exec(svg);
      if (m) ratio = (+m[4]) / (+m[3]) || 1;
    } catch (e) {}
    var stamp = /stamp-/.test(id);
    PS.setTool('sticker', { assetId: id, name: name, ratio: ratio, width: stamp ? 150 : /^emoji:/.test(id) ? 48 : 64, color: /^(lucide|phosphor):/.test(id) ? STYLE.ink : null });
    if (PS.isPhone()) PS.setSheet('closed');
  }
  PS.STAMPS = STAMPS;
  PS.armSticker = armSticker;

  PS.panels.edit = {
    title: 'Edit & annotate', icon: 'edit', tone: 'rose', snap: 'half',
    build: function (pane) {
      var s1 = section('Tools');
      var g = el('div', 'ps-tiles ps-tiles-tools');
      var tools = [
        ['select', 'pointer', 'Select'], ['text', 'text', 'Text'], ['highlighter', 'highlight', 'Highlighter'], ['hlbox', 'hlbox', 'Highlight box'],
        ['pen', 'pen', 'Pen'], ['eraser', 'eraser', 'Eraser'], ['note', 'note', 'Comment'], ['whiteout', 'whiteout', 'Whiteout'], ['redact', 'redact', 'Redact']
      ];
      tools.forEach(function (t) {
        var b = tile(t[1], t[2], { 'data-tool': t[0] }, t[0] === 'redact' ? 'ink' : null);
        b.addEventListener('click', function () { PS.setTool(t[0]); if (PS.isPhone() && t[0] !== 'select') PS.setSheet('closed'); });
        g.appendChild(b);
      });
      s1.appendChild(g);
      pane.appendChild(s1);

      var sForm = section('Form marks', 'tap a page to place');
      var fm = el('div', 'ps-chips');
      [['check', 'check', 'Check'], ['cross', 'cross', 'Cross'], ['dot', 'dot', 'Dot'], ['date', 'calendar', 'Date']].forEach(function (t) {
        var b = btn('ps-chip', icon(t[1]) + '<span>' + t[2] + '</span>', { 'data-tool': t[0] });
        b.addEventListener('click', function () { PS.setTool(t[0]); if (PS.isPhone()) PS.setSheet('closed'); });
        fm.appendChild(b);
      });
      sForm.appendChild(fm);
      pane.appendChild(sForm);

      var sStyle = section('Style');
      sStyle.appendChild(el('div', 'ps-eyebrow', 'Ink & text colour'));
      sStyle.appendChild(swatches(INKS, STYLE.ink, function (c) { STYLE.ink = c; STYLE.textColor = c; }, true, { title: 'Ink & text colour', named: PS.SIG_INKS, namedTitle: 'Classic inks' }));
      sStyle.appendChild(slider('Pen width', 0.5, 8, 0.1, STYLE.penWidth, function (v) { return v.toFixed(1) + ' pt'; }, function (v) { STYLE.penWidth = v; }, { reset: 2.2 }));
      sStyle.appendChild(el('div', 'ps-eyebrow', 'Highlighter'));
      sStyle.appendChild(swatches(HLS, STYLE.hl, function (c) { STYLE.hl = c; }, true, { title: 'Highlighter colour' }));
      sStyle.appendChild(slider('Highlighter width', 6, 32, 1, STYLE.hlWidth, function (v) { return v + ' pt'; }, function (v) { STYLE.hlWidth = v; }, { reset: 16 }));
      var fs = fontSelect(STYLE.font);
      fs.addEventListener('change', function () { STYLE.font = fs.value; if (LE.fonts) LE.fonts.load(fs.value, 400, false).catch(function () {}); });
      var row = el('div', 'ps-row');
      row.appendChild(field('Font', fs, 'ps-font'));
      var sz = inputEl('number', STYLE.size, { min: 4, max: 200 });
      sz.addEventListener('input', function () { STYLE.size = clamp(+sz.value || 14, 4, 200); });
      var szf = field('Size', sz, 'ps-size');
      szf.classList.add('ps-field-sm');
      row.appendChild(szf);
      sStyle.appendChild(row);
      pane.appendChild(sStyle);

      var sShapes = section('Shapes', 'drag on a page');
      var sg = el('div', 'ps-shapes');
      var list = [];
      try { list = LE.assets.shapes(); } catch (e) { list = []; }
      list.forEach(function (sh) {
        var b = btn('ps-shape', '', { 'aria-label': sh.name, title: sh.name, 'data-tool': 'shape:' + sh.id });
        var path = '';
        try { path = sh.path(24, 24, {}); } catch (e) { path = 'M2 2h20v20H2z'; }
        var open = sh.closed === false || /line|arc|curve|polyline/.test(sh.id);
        b.innerHTML = '<svg viewBox="-2 -2 28 28" aria-hidden="true"><path d="' + esc(path) + '" fill="' + (open ? 'none' : 'currentColor') + '" fill-opacity=".18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
        b.addEventListener('click', function () { PS.setTool('shape:' + sh.id); if (PS.isPhone()) PS.setSheet('closed'); });
        sg.appendChild(b);
      });
      sShapes.appendChild(sg);
      sShapes.appendChild(el('div', 'ps-eyebrow', 'Outline'));
      sShapes.appendChild(swatches(INKS, STYLE.stroke, function (c) { STYLE.stroke = c; }, true, { title: 'Outline colour' }));
      var fillBox = el('div', 'ps-sub');
      fillBox.hidden = STYLE.fill === 'none';
      sShapes.appendChild(toggle('Fill shapes', STYLE.fill !== 'none', function (on) { STYLE.fill = on ? 'solid' : 'none'; fillBox.hidden = !on; }));
      fillBox.appendChild(el('div', 'ps-eyebrow', 'Fill'));
      fillBox.appendChild(swatches(['#F2D594', '#FFE56A', '#CDE7FF', '#D7F5DD', '#FFD6E0', '#E5DBFF', '#FFFFFF'], STYLE.fillColor, function (c) { STYLE.fillColor = c; }, true, { title: 'Fill colour' }));
      sShapes.appendChild(fillBox);
      pane.appendChild(sShapes);

      var sMore = section('Stamps, icons & images');
      var go = btn('ps-cta', '<span class="ps-cta-ic">' + icon('stamp') + '</span><span><strong>Open the graphics library</strong><small>Stamps, 34 icon styles, stickers, emoji and your images</small></span>' + icon('right'));
      go.addEventListener('click', function () { PS.openPanel('convert'); if (PS.graphics) PS.graphics.focus(); });
      sMore.appendChild(go);
      pane.appendChild(sMore);

      var sRed = section('About redaction');
      sRed.appendChild(el('p', 'ps-note', 'Redact removes the content under each black box for good: the whole page is saved as an image, so its text can no longer be selected or searched. Whiteout only covers content.'));
      pane.appendChild(sRed);
    },
    show: function () {
      markTools();
    }
  };
  function markTools() {
    $$('.ps-panel [data-tool]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tool') === S.tool); });
  }
  var prevSetTool = PS.setTool;
  PS.setTool = function (t, o) { prevSetTool(t, o); markTools(); };

  function fileToCanvas(file, maxEdge) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, (maxEdge || 2400) / Math.max(img.naturalWidth, img.naturalHeight));
        var c = d.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s));
        c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That image could not be read')); };
      img.src = url;
    });
  }
  PS.fileToCanvas = fileToCanvas;
  function armImage(file) {
    return fileToCanvas(file, 2400).then(function (c) {
      PS.setTool('image', { canvas: c, key: PS.uid('img'), name: file.name || 'Image' });
      if (PS.isPhone()) PS.setSheet('closed');
    }, function (e) { say(e.message); });
  }
  PS.armImage = armImage;
  PS.onPasteFiles = function (files) {
    var f = files[0];
    if (f && /^image\//.test(f.type)) { armImage(f); say('Click a page to place the pasted image'); return true; }
    return false;
  };

  /* ---------- Sign panel ---------- */

  var SIG_CLASSIC = [
    ['#16141C', 'Black'], ['#050506', 'Jet'], ['#1B2A4A', 'Navy'], ['#2346C8', 'Royal blue'], ['#1A2238', 'Blue-black'],
    ['#1F5135', 'Dark green'], ['#7A1F2B', 'Burgundy'], ['#5B3A21', 'Sepia'], ['#4B2A7A', 'Purple'], ['#C62828', 'Correction red'],
    ['#1A3CFF', 'Gel blue'], ['#E10600', 'Gel red'], ['#159447', 'Gel green'], ['#6D28D9', 'Gel violet'], ['#E11D74', 'Gel pink'],
    ['#F05A12', 'Gel orange'], ['#0E7C86', 'Teal'], ['#0F6F8A', 'Turquoise'], ['#A67C00', 'Metallic gold'], ['#B87333', 'Metallic copper'],
    ['#8C5A2B', 'Bronze'], ['#A15C68', 'Rose gold'], ['#D6336C', 'Pink'], ['#3730A3', 'Indigo']
  ];
  var SIG_BRAND = [['#4E36C9', 'Amethyst'], ['#9A6B1F', 'Champagne gold'], ['#B83463', 'Rose'], ['#1F4FBF', 'Sapphire'], ['#147A60', 'Jade'], ['#A4532E', 'Copper'], ['#17131F', 'Obsidian']];
  var MORE_INK_IDS = ['gold-foil', 'copper-brand', 'champagne', 'teal', 'cyan', 'pink', 'ocean', 'sakura', 'navy', 'forest', 'jewel', 'midnight', 'coffee', 'blush', 'grape', 'terracotta', 'glacier', 'corporate', 'amber', 'blue', 'rose-brand', 'desert'];
  PS.SIG_INKS = SIG_CLASSIC;
  var moreInkCache = null;
  function inkHex(c) {
    var n = PS.color && PS.color.norm ? PS.color.norm(c) : null;
    return n || (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toUpperCase() : null);
  }
  function inkLuma(hex) {
    try { if (PS.color && PS.color.luminance) return PS.color.luminance(hex); } catch (e) {}
    return 0.3;
  }
  function buildMoreInks() {
    if (!LE.assets || typeof LE.assets.colorSets !== 'function') return [];
    var sets;
    try { sets = LE.assets.colorSets(); } catch (e) { return []; }
    if (!sets || !sets.length) return [];
    var byId = {};
    sets.forEach(function (s) { if (s && s.id) byId[s.id] = s; });
    var taken = {}, names = {};
    SIG_CLASSIC.concat(SIG_BRAND).forEach(function (x) {
      var h = inkHex(x[0]);
      if (h) taken[h] = 1;
      names[String(x[1]).toLowerCase()] = 1;
    });
    var out = [];
    MORE_INK_IDS.forEach(function (id) {
      var set = byId[id];
      if (!set || !set.colors) return;
      var best = null, bestScore = 1e9;
      set.colors.forEach(function (c) {
        var h = inkHex(c);
        if (!h || taken[h]) return;
        var L = inkLuma(h);
        if (L < 0.05 || L > 0.46) return;
        var score = Math.abs(L - 0.2);
        if (score < bestScore) { bestScore = score; best = h; }
      });
      if (!best) return;
      taken[best] = 1;
      var label = set.name || id;
      if (names[String(label).toLowerCase()]) label = label + ' ink';
      names[String(label).toLowerCase()] = 1;
      out.push([best, label]);
    });
    return out;
  }
  function moreInks() {
    if (!moreInkCache) moreInkCache = buildMoreInks();
    return moreInkCache;
  }
  function allNamed() { return SIG_CLASSIC.concat(SIG_BRAND, moreInks()); }
  PS.signatureInks = allNamed;
  var PEN_STYLES = [
    ['fine', 'Fine', { w: 1.3, vary: 0.35 }],
    ['medium', 'Medium', { w: 2.4, vary: 0.5 }],
    ['bold', 'Bold', { w: 4, vary: 0.4 }],
    ['fountain', 'Fountain', { w: 3.2, vary: 0.45, nib: true }],
    ['marker', 'Marker', { w: 5.2, vary: 0, alpha: 0.94 }],
    ['ballpoint', 'Ballpoint', { w: 1.7, vary: 0.12, alpha: 0.9 }]
  ];
  function penOf(id) { for (var i = 0; i < PEN_STYLES.length; i++) if (PEN_STYLES[i][0] === id) return PEN_STYLES[i][2]; return PEN_STYLES[1][2]; }
  var sig = { color: '#16141C', pen: 'medium', width: 2.4, smooth: 55, strokes: [], kind: 'signature', family: 'Great Vibes', upload: null, threshold: 46, uploadInk: true, savedTint: 'original', last: {} };
  PS.sig = sig;

  function inkName(c) {
    var all = allNamed();
    var hex = inkHex(c) || String(c || '');
    for (var i = 0; i < all.length; i++) if ((inkHex(all[i][0]) || all[i][0]).toLowerCase() === hex.toLowerCase()) return all[i][1];
    return String(c).toUpperCase();
  }
  function tintCanvas(src, color) {
    var c = d.createElement('canvas');
    c.width = src.naturalWidth || src.width;
    c.height = src.naturalHeight || src.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  PS.tintCanvas = tintCanvas;

  function smoothPts(raw, amount) {
    var pts = [];
    raw.forEach(function (p) {
      var last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.6) pts.push({ x: p.x, y: p.y, p: p.p, t: p.t });
    });
    var passes = Math.round(clamp(amount, 0, 100) / 25);
    for (var k = 0; k < passes; k++) {
      for (var i = 1; i < pts.length - 1; i++) {
        pts[i] = { x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4, y: (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4, p: pts[i].p, t: pts[i].t };
      }
    }
    return pts;
  }
  function renderStroke(ctx, raw, o) {
    var pen = penOf(o.pen);
    var base = (o.width || pen.w) * o.scale;
    var pts = smoothPts(raw.map(function (p) { return { x: p[0] * o.scale - o.ox, y: p[1] * o.scale - o.oy, p: p[2], t: p[3] }; }), o.smooth);
    ctx.fillStyle = ctx.strokeStyle = o.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length < 2) {
      if (pts[0]) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, base / 2, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    var speeds = [];
    for (var i = 1; i < pts.length; i++) {
      var dt = pts[i].t != null && pts[i - 1].t != null ? Math.max(6, pts[i].t - pts[i - 1].t) : 16;
      speeds.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / o.scale / dt);
    }
    var sorted = speeds.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0.4;
    var prevW = null;
    for (var s = 1; s < pts.length; s++) {
      var a = pts[s - 1], b = pts[s];
      var f = 1;
      if (pen.vary) f = 1 - pen.vary + pen.vary * clamp(1.35 - (speeds[s - 1] || median) / (median || 0.4) * 0.55, 0.3, 1.8);
      if (b.p != null && b.p !== 0.6 && pen.vary) f *= 0.55 + clamp(b.p, 0.15, 1) * 0.7;
      if (pen.nib) f *= 0.3 + 0.95 * Math.abs(Math.sin(Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 4));
      var w = Math.max(0.35 * o.scale, base * f);
      w = prevW == null ? w : prevW * 0.62 + w * 0.38;
      prevW = w;
      ctx.beginPath();
      ctx.lineWidth = w;
      ctx.moveTo(a.x, a.y);
      if (s < pts.length - 1) ctx.quadraticCurveTo(b.x, b.y, (b.x + pts[s + 1].x) / 2, (b.y + pts[s + 1].y) / 2);
      else ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  function strokesCanvas(strokes, scale, o) {
    var pen = penOf(o.pen);
    var pad = (o.width || pen.w) * scale * 2 + 8;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    strokes.forEach(function (st) { st.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
    if (!isFinite(x0)) return null;
    var layer = d.createElement('canvas');
    layer.width = Math.max(4, Math.ceil((x1 - x0) * scale + pad * 2));
    layer.height = Math.max(4, Math.ceil((y1 - y0) * scale + pad * 2));
    var lc = layer.getContext('2d');
    strokes.forEach(function (st) { renderStroke(lc, st, { scale: scale, ox: x0 * scale - pad, oy: y0 * scale - pad, color: o.color, pen: o.pen, width: o.width, smooth: o.smooth }); });
    if (!pen.alpha) return layer;
    var out = d.createElement('canvas');
    out.width = layer.width;
    out.height = layer.height;
    var oc = out.getContext('2d');
    oc.globalAlpha = pen.alpha;
    oc.drawImage(layer, 0, 0);
    return out;
  }

  function placeSignature(canvas, name, ink) {
    var key = PS.uid('sig');
    var initials = sig.kind === 'initials';
    sig.last[initials ? 'initials' : 'signature'] = canvas;
    if (ink === undefined) ink = sig.color;
    S.docTools._sigBase = S.docTools._sigBase || {};
    S.docTools._sigBase[key] = key;
    if (ink) { S.docTools._sigInk = S.docTools._sigInk || {}; S.docTools._sigInk[key] = ink; }
    PS.setTool('sign', { canvas: canvas, key: key, name: name || (initials ? 'Initials' : 'Signature'), width: initials ? 70 : 150 });
    if (PS.isPhone()) PS.setSheet('closed');
  }
  PS.placeSignature = placeSignature;
  function dataUrlCanvas(url) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var c = d.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        res(c);
      };
      img.onerror = function () { res(null); };
      img.src = url;
    });
  }

  function buildPad(wrap) {
    var pad = el('div', 'ps-pad');
    var canvas = d.createElement('canvas');
    canvas.setAttribute('aria-label', 'Signature pad. Draw with your finger, pen, or mouse.');
    canvas.setAttribute('role', 'img');
    var line = el('div', 'ps-pad-line');
    var hint = el('div', 'ps-pad-hint', 'Sign here');
    pad.appendChild(canvas);
    pad.appendChild(line);
    pad.appendChild(hint);
    wrap.appendChild(pad);
    var ctx = canvas.getContext('2d');
    var cur = null;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    function size() {
      var r = pad.getBoundingClientRect();
      if (r.width < 10) return;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      redraw();
    }
    function redraw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var all = sig.strokes.slice();
      if (all.length) {
        var c = strokesCanvas(all, dpr, sig);
        var x0 = Infinity, y0 = Infinity;
        all.forEach(function (st) { st.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); }); });
        var padPx = (sig.width || penOf(sig.pen).w) * dpr * 2 + 8;
        if (c) ctx.drawImage(c, x0 * dpr - padPx, y0 * dpr - padPx);
      }
      hint.hidden = sig.strokes.length > 0 || !!cur;
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, e.pressure && e.pointerType === 'pen' ? e.pressure : 0.6, performance.now()];
    }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      cur = [pos(e)];
      hint.hidden = true;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!cur) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!evs.length) evs = [e];
      var pen = penOf(sig.pen);
      evs.forEach(function (ev) {
        var p = pos(ev);
        var last = cur[cur.length - 1];
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = sig.color;
        ctx.globalAlpha = pen.alpha || 1;
        var speed = Math.hypot(p[0] - last[0], p[1] - last[1]) / Math.max(4, p[3] - last[3]);
        var f = pen.vary ? 1 - pen.vary + pen.vary * clamp(1.3 - speed * 0.5, 0.45, 1.6) : 1;
        if (pen.nib) f *= 0.3 + 0.95 * Math.abs(Math.sin(Math.atan2(p[1] - last[1], p[0] - last[0]) - Math.PI / 4));
        ctx.lineWidth = Math.max(0.4, (sig.width || pen.w) * f);
        ctx.beginPath();
        ctx.moveTo(last[0], last[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
        cur.push(p);
      });
    });
    function end() {
      if (!cur) return;
      if (cur.length > 1) sig.strokes.push(cur);
      cur = null;
      redraw();
      if (wrap._onStroke) wrap._onStroke();
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    if (global.ResizeObserver) new ResizeObserver(size).observe(pad);
    return { redraw: redraw, size: size };
  }

  function composeDrawn() {
    if (!sig.strokes.length) return null;
    return strokesCanvas(sig.strokes, 3, sig);
  }
  PS.composeSignature = composeDrawn;

  function saveSig(canvas, kind) {
    if (!LE.pdf.signatures) return Promise.resolve();
    return LE.pdf.signatures.save({ name: sig.kind === 'initials' ? 'Initials' : 'Signature', kind: kind, canvas: canvas }).then(function () {
      if (PS.panels.sign._refreshSaved) PS.panels.sign._refreshSaved();
    }).catch(function () {});
  }

  function isSigLayer(l) {
    return l && l.type === 'image' && (/^(signature|initials)/i.test(l.name || '') || !!(S.docTools._sigInk && S.docTools._sigInk[l.src]));
  }
  PS.isSigLayer = isSigLayer;
  function assetCanvasOf(sc, key) {
    if (!key) return null;
    var v = S.assets[key];
    if (v && typeof v !== 'string' && (v.getContext || v.naturalWidth || v.width)) return v;
    var rec = sc && sc._assets && sc._assets[key];
    if (!rec) return null;
    if (rec.canvas) return rec.canvas;
    if (rec.image && (rec.image.naturalWidth || rec.image.width)) return rec.image;
    return null;
  }
  function recolorSigLayers(color) {
    var sc = PS.activeScene();
    var changed = false;
    if (sc) {
      var ids = sc.selection();
      S.docTools._sigInk = S.docTools._sigInk || {};
      S.docTools._sigBase = S.docTools._sigBase || {};
      ids.forEach(function (id) {
        var l = sc.layer(id);
        if (!isSigLayer(l)) return;
        var baseKey = S.docTools._sigBase[l.src];
        var base = assetCanvasOf(sc, baseKey) || assetCanvasOf(sc, l.src);
        if (!base) return;
        var key = PS.uid('sig');
        var c = tintCanvas(base, color);
        S.assets[key] = c;
        S.docTools._sigBase[key] = baseKey || l.src;
        S.docTools._sigInk[key] = color;
        sc.addAsset(key, c);
        sc.update(id, { src: key }, { coalesce: 'ctx-sigink' });
        changed = true;
      });
    }
    sig.color = color;
    var ip = PS.panels.sign && PS.panels.sign._ink;
    if (ip) { ip.querySelector('.ps-inkname').textContent = inkName(color); $$('.ps-swatches', ip).forEach(function (s) { if (s.setValue) s.setValue(color); }); }
    if (PS.E && PS.E.ctx) $$('.ps-swatches', PS.E.ctx).forEach(function (s) { if (s.setValue) s.setValue(color); });
    if (changed) PS.markDirty();
  }
  PS.recolorSigLayers = recolorSigLayers;
  PS.sigInkOf = function (l) { return (S.docTools._sigInk && S.docTools._sigInk[l.src]) || null; };

  function inkPicker(onPick) {
    var box = el('div', 'ps-inkbox');
    var head = el('div', 'ps-inkbox-h');
    var label = el('span', 'ps-eyebrow', 'Ink');
    var nameOut = el('strong', 'ps-inkname', esc(inkName(sig.color)));
    head.appendChild(label);
    head.appendChild(nameOut);
    box.appendChild(head);
    var classic = swatches(SIG_CLASSIC, sig.color, pick, false, { label: 'Classic inks' });
    classic.classList.add('ps-sw-grid');
    box.appendChild(classic);
    var brandRow = el('div', 'ps-inkbox-row');
    brandRow.appendChild(el('span', 'ps-mini-label', 'Brand'));
    var brand = swatches(SIG_BRAND, sig.color, pick, true, { label: 'Brand inks', title: 'Signature ink', named: allNamed(), namedTitle: 'Signature inks', known: function () { return allNamed().map(function (x) { return x[0]; }).concat(PS.color.recents()); } });
    brandRow.appendChild(brand);
    box.appendChild(brandRow);
    var moreRow = el('div', 'ps-inkbox-row ps-ink-more');
    var more = null;
    var extra = moreInks();
    if (extra.length) {
      moreRow.appendChild(el('span', 'ps-mini-label', 'More inks'));
      more = swatches(extra, sig.color, pick, false, { label: 'More inks' });
      more.classList.add('ps-ink-scroll');
      moreRow.appendChild(more);
      box.appendChild(moreRow);
    }
    var recentRow = el('div', 'ps-inkbox-row');
    box.appendChild(recentRow);
    function namedHit(c) { return allNamed().some(function (x) { return (inkHex(x[0]) || '') === c; }); }
    function renderRecent() {
      recentRow.innerHTML = '';
      var rc = PS.color.recents().filter(function (c) { return !namedHit(c); }).slice(0, 7);
      recentRow.hidden = !rc.length;
      if (!rc.length) return;
      recentRow.appendChild(el('span', 'ps-mini-label', 'Recent'));
      recentRow.appendChild(swatches(rc, sig.color, pick, false, { label: 'Recent inks' }));
    }
    renderRecent();
    function pick(c) {
      sig.color = c;
      nameOut.textContent = inkName(c);
      [classic, brand, more].forEach(function (s) { if (s) s.setValue(c); });
      $$('.ps-swatches', recentRow).forEach(function (s) { s.setValue(c); });
      onPick(c);
    }
    box.sync = function () { pick(sig.color); renderRecent(); };
    return box;
  }

  PS.panels.sign = {
    title: 'Sign', icon: 'sign', tone: 'sapphire', snap: 'full',
    build: function (pane) {
      var self = this;
      var kindSeg = seg([['signature', 'Signature'], ['initials', 'Initials']], sig.kind, function (v) { sig.kind = v; typedPreview(); });
      kindSeg.classList.add('ps-seg-full');
      pane.appendChild(kindSeg);

      var ink = inkPicker(function (c) {
        padApi.redraw();
        typedPreview();
        cleanLive();
        PS.recolorSigLayers(c);
        if (activeTab === 'saved') { sig.savedTint = 'ink'; tintSeg.setValue('ink'); refreshSaved(); }
      });
      pane.appendChild(ink);
      self._ink = ink;

      var tabs = el('div', 'ps-tabs');
      tabs.setAttribute('role', 'tablist');
      var panes = {};
      var activeTab = 'draw';
      [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload'], ['saved', 'Saved']].forEach(function (t, i) {
        var b = btn('ps-tab', esc(t[1]), { role: 'tab', 'aria-selected': String(i === 0), 'data-tab': t[0] });
        tabs.appendChild(b);
        var p = el('div', 'ps-tabpane');
        p.setAttribute('role', 'tabpanel');
        p.hidden = i !== 0;
        panes[t[0]] = p;
      });
      pane.appendChild(tabs);
      tabs.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]');
        if (!b) return;
        activeTab = b.getAttribute('data-tab');
        $$('[data-tab]', tabs).forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
        Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== activeTab; });
        if (activeTab === 'draw') padApi.size();
        if (activeTab === 'type') typedPreview();
        if (activeTab === 'saved') refreshSaved();
      });
      Object.keys(panes).forEach(function (k) { pane.appendChild(panes[k]); });

      /* Draw */
      var dp = panes.draw;
      var padApi = buildPad(dp);
      var padTools = el('div', 'ps-row ps-row-between ps-padtools');
      padTools.appendChild(el('span', 'ps-note', 'Use a finger, stylus or mouse'));
      var tools = el('div', 'ps-btnrow');
      var undoS = btn('ps-ib', icon('undo'), { 'aria-label': 'Undo stroke', title: 'Undo stroke' });
      undoS.addEventListener('click', function () { sig.strokes.pop(); padApi.redraw(); });
      var clear = btn('ps-ib', icon('trash'), { 'aria-label': 'Clear', title: 'Clear' });
      clear.addEventListener('click', function () { sig.strokes = []; padApi.redraw(); });
      tools.appendChild(undoS);
      tools.appendChild(clear);
      padTools.appendChild(tools);
      dp.appendChild(padTools);
      dp.appendChild(el('div', 'ps-eyebrow', 'Pen'));
      var pens = el('div', 'ps-pens');
      pens.setAttribute('role', 'radiogroup');
      pens.setAttribute('aria-label', 'Pen style');
      PEN_STYLES.forEach(function (p) {
        var b = btn('ps-pen', '<svg viewBox="0 0 64 22" aria-hidden="true"><path d="M4 15c8-10 14-10 18-3s9 6 14-2 12-6 16 1 6 4 8 2"/></svg><span>' + esc(p[1]) + '</span>', { role: 'radio', 'aria-checked': String(p[0] === sig.pen), 'data-pen': p[0] });
        var path = b.querySelector('path');
        path.setAttribute('stroke-width', String(Math.min(5, p[2].w * 0.9)));
        if (p[2].nib) path.setAttribute('stroke-dasharray', '');
        if (p[2].alpha) path.setAttribute('stroke-opacity', String(p[2].alpha));
        b.addEventListener('click', function () {
          sig.pen = p[0];
          sig.width = p[2].w;
          widthS.setValue(sig.width);
          $$('.ps-pen', pens).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
          padApi.redraw();
        });
        pens.appendChild(b);
      });
      dp.appendChild(pens);
      var widthS = slider('Thickness', 0.6, 8, 0.1, sig.width, function (v) { return v.toFixed(1); }, function (v) { sig.width = v; padApi.redraw(); }, { reset: 2.4 });
      dp.appendChild(widthS);
      dp.appendChild(slider('Smoothing', 0, 100, 1, sig.smooth, function (v) { return v + '%'; }, function (v) { sig.smooth = v; padApi.redraw(); }, { reset: 55 }));
      var keep1 = toggle('Save to my signatures', true, function () {});
      dp.appendChild(keep1);
      var useDraw = btn('btn btn-gold btn-block', icon('sign') + 'Use this signature');
      useDraw.addEventListener('click', function () {
        var c = composeDrawn();
        if (!c) { say('Draw your signature first'); return; }
        if (keep1.input.checked) saveSig(c, 'draw');
        placeSignature(c);
      });
      dp.appendChild(useDraw);

      /* Type */
      var tp = panes.type;
      var nameIn = inputEl('text', '', { placeholder: 'Your name', autocomplete: 'name' });
      tp.appendChild(field('Type your name', nameIn, 'ps-sig-name'));
      self._nameIn = nameIn;
      var fontsBox = el('div', 'ps-sigfonts');
      tp.appendChild(fontsBox);
      var hand = fontFamilies().filter(function (f) { return f.category === 'handwriting'; }).map(function (f) { return f.family; });
      if (!hand.length) hand = ['Great Vibes', 'Dancing Script', 'Caveat', 'Sacramento'];
      hand.slice(0, 12).forEach(function (fam) {
        var b = btn('ps-sigfont', '<span class="ps-sigfont-text"></span><small>' + esc(fam) + '</small>', { 'aria-pressed': String(fam === sig.family), 'data-fam': fam });
        b.querySelector('.ps-sigfont-text').style.fontFamily = LE.fonts ? LE.fonts.css(fam) : fam;
        b.addEventListener('click', function () {
          sig.family = fam;
          $$('.ps-sigfont', fontsBox).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        });
        fontsBox.appendChild(b);
      });
      function typedText() {
        var v = nameIn.value.trim() || 'Your Name';
        if (sig.kind === 'initials') v = v.split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase(); }).join('.') + (v.indexOf(' ') > 0 ? '.' : '');
        return v;
      }
      self._typedText = typedText;
      function typedPreview() {
        var t = typedText();
        $$('.ps-sigfont', fontsBox).forEach(function (b) {
          var span = b.querySelector('.ps-sigfont-text');
          span.textContent = t;
          span.style.color = sig.color;
          span.style.fontSize = '';
          var fs = 25;
          while (fs > 13 && span.scrollWidth > span.clientWidth + 1) { fs -= 2; span.style.fontSize = fs + 'px'; }
        });
      }
      if (d.fonts && d.fonts.addEventListener) d.fonts.addEventListener('loadingdone', function () { if (!pane.hidden) typedPreview(); });
      self._typedPreview = typedPreview;
      nameIn.addEventListener('input', typedPreview);
      var keep2 = toggle('Save to my signatures', true, function () {});
      tp.appendChild(keep2);
      var useType = btn('btn btn-gold btn-block', icon('sign') + 'Use this signature');
      useType.addEventListener('click', function () {
        if (!nameIn.value.trim()) { say('Type your name first'); nameIn.focus(); return; }
        LE.pdf.signatureFromText(typedText(), sig.family, sig.color).then(function (c) {
          if (keep2.input.checked) saveSig(c, 'type');
          placeSignature(c);
        });
      });
      tp.appendChild(useType);

      /* Upload */
      var up = panes.upload;
      up.appendChild(el('p', 'ps-note', 'Sign on white paper, take a photo, and upload it. The paper is removed so only the ink stays.'));
      var upBtn = btn('btn btn-sm', icon('upload') + 'Choose a photo');
      up.appendChild(upBtn);
      var cmp = el('div', 'ps-upcmp');
      cmp.hidden = true;
      var beforeBox = el('figure', 'ps-upfig');
      beforeBox.innerHTML = '<figcaption>Photo</figcaption>';
      var afterBox = el('figure', 'ps-upfig is-after');
      afterBox.innerHTML = '<figcaption>Background removed</figcaption>';
      cmp.appendChild(beforeBox);
      cmp.appendChild(afterBox);
      up.appendChild(cmp);
      var upStat = el('p', 'ps-note ps-upstat');
      upStat.hidden = true;
      up.appendChild(upStat);
      var thr = slider('Paper removal', 10, 120, 1, sig.threshold, null, function (v) { sig.threshold = v; cleanLive(); }, { reset: 46 });
      thr.hidden = true;
      up.appendChild(thr);
      var inkT = toggle('Recolour with the selected ink', sig.uploadInk, function (v) { sig.uploadInk = v; cleanLive(); }, 'Off keeps the photo’s own ink colour');
      inkT.hidden = true;
      up.appendChild(inkT);
      var keep3 = toggle('Save to my signatures', true, function () {});
      keep3.hidden = true;
      up.appendChild(keep3);
      var useUp = btn('btn btn-gold btn-block', icon('sign') + 'Use this signature');
      useUp.hidden = true;
      up.appendChild(useUp);
      var cleaned = null, cleanTimer = 0;
      function cleanLive() {
        clearTimeout(cleanTimer);
        cleanTimer = setTimeout(function () {
          if (!sig.upload) return;
          cleaned = LE.pdf.cleanSignatureImage(sig.upload, { threshold: sig.threshold, color: sig.uploadInk ? sig.color : null });
          $$('canvas', afterBox).forEach(function (c) { c.remove(); });
          afterBox.insertBefore(cleaned, afterBox.firstChild);
          var cx = cleaned.getContext('2d').getImageData(0, 0, cleaned.width, cleaned.height).data, ink = 0, n = 0;
          for (var i = 3; i < cx.length; i += 16) { n++; if (cx[i] > 40) ink++; }
          upStat.textContent = n ? 'Ink covers ' + Math.max(1, Math.round(ink / n * 100)) + '% of the cropped signature. Slide right if paper still shows, left if strokes break up.' : '';
        }, 60);
      }
      upBtn.addEventListener('click', function () {
        PS.pickFiles('image/*', false).then(function (files) {
          if (!files[0]) return;
          fileToCanvas(files[0], 1400).then(function (c) {
            sig.upload = c;
            $$('canvas,img', beforeBox).forEach(function (x) { x.remove(); });
            var thumb = d.createElement('canvas');
            var s = Math.min(1, 480 / Math.max(c.width, c.height));
            thumb.width = Math.max(1, Math.round(c.width * s));
            thumb.height = Math.max(1, Math.round(c.height * s));
            thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
            beforeBox.insertBefore(thumb, beforeBox.firstChild);
            cmp.hidden = thr.hidden = inkT.hidden = keep3.hidden = useUp.hidden = upStat.hidden = false;
            cleanLive();
          }, function (e) { say(e.message); });
        });
      });
      useUp.addEventListener('click', function () {
        if (!cleaned) return;
        if (keep3.input.checked) saveSig(cleaned, 'upload');
        placeSignature(cleaned, null, sig.uploadInk ? sig.color : null);
      });

      /* Saved */
      var sv = panes.saved;
      var tintSeg = seg([['original', 'Original colours'], ['ink', 'Selected ink']], sig.savedTint, function (v) { sig.savedTint = v; refreshSaved(); });
      tintSeg.classList.add('ps-seg-sm');
      sv.appendChild(tintSeg);
      var grid = el('div', 'ps-sigsaved');
      sv.appendChild(grid);
      var savedCanvases = {};
      function savedCanvas(r) {
        if (savedCanvases[r.id]) return Promise.resolve(savedCanvases[r.id]);
        return dataUrlCanvas(r.png).then(function (c) { if (c) savedCanvases[r.id] = c; return c; });
      }
      function refreshSaved() {
        if (!LE.pdf.signatures) return;
        LE.pdf.signatures.list().then(function (rows) {
          grid.innerHTML = '';
          if (!rows.length) { grid.appendChild(el('p', 'ps-note', 'Signatures you save appear here, ready to place with one tap.')); return; }
          rows.forEach(function (r) {
            var card = el('div', 'ps-savedsig');
            var use = btn('ps-savedsig-use', '', { 'aria-label': 'Place ' + r.name });
            var img = new Image();
            img.alt = '';
            img.src = r.png;
            use.appendChild(img);
            use.appendChild(el('span', null, esc(r.name)));
            if (sig.savedTint === 'ink') {
              savedCanvas(r).then(function (c) { if (c) img.src = tintCanvas(c, sig.color).toDataURL('image/png'); });
            }
            use.addEventListener('click', function () {
              savedCanvas(r).then(function (c) {
                if (!c) return;
                sig.kind = /initial/i.test(r.name) ? 'initials' : 'signature';
                placeSignature(sig.savedTint === 'ink' ? tintCanvas(c, sig.color) : c, r.name, sig.savedTint === 'ink' ? sig.color : null);
              });
            });
            var rm = btn('ps-ib', icon('trash'), { 'aria-label': 'Delete ' + r.name, title: 'Delete' });
            rm.addEventListener('click', function () { LE.pdf.signatures.remove(r.id).then(refreshSaved); });
            card.appendChild(use);
            card.appendChild(rm);
            grid.appendChild(card);
          });
        }).catch(function () { grid.innerHTML = '<p class="ps-note">Saved signatures are not available in this browser mode.</p>'; });
      }
      self._refreshSaved = refreshSaved;

      var quick = section('Quick fields', 'tap a page to place');
      var qc = el('div', 'ps-chips');
      [['text', 'text', 'Name'], ['date', 'calendar', 'Date'], ['check', 'check', 'Check'], ['cross', 'cross', 'Cross']].forEach(function (t) {
        var b = btn('ps-chip', icon(t[1]) + '<span>' + t[2] + '</span>');
        b.addEventListener('click', function () {
          PS.setTool(t[0]);
          if (t[2] === 'Name' && nameIn.value.trim()) {
            var base = PS.placers.text;
            PS.placers.__name = function (pt, ref) { var spec = base(pt, ref); spec.layer.text = nameIn.value.trim(); spec.edit = false; return spec; };
            PS.setTool('__name');
          }
          if (PS.isPhone()) PS.setSheet('closed');
        });
        qc.appendChild(b);
      });
      quick.appendChild(qc);
      pane.appendChild(quick);
      if (PS.buildEveryPage) pane.appendChild(PS.buildEveryPage());
    },
    show: function () {
      if (this._ink) this._ink.sync();
      if (this._typedPreview) this._typedPreview();
      if (this._refreshSaved) this._refreshSaved();
      var hand = fontFamilies().filter(function (f) { return f.category === 'handwriting'; });
      hand.slice(0, 12).forEach(function (f) {
        if (LE.fonts && LE.fonts.load) LE.fonts.load(f.family, 400, false).catch(function () {});
      });
    }
  };

  /* ---------- Forms panel ---------- */

  function fieldValue(f) {
    var vals = S.formValues[f.docId];
    if (vals && Object.prototype.hasOwnProperty.call(vals, f.name)) return vals[f.name];
    return f.value;
  }
  function setFieldValue(f, v) {
    var vals = S.formValues[f.docId] || (S.formValues[f.docId] = {});
    vals[f.name] = v;
    PS.markDirty();
    $$('[data-fkey="' + cssEsc(f.key) + '"]').forEach(function (n) {
      if (n === d.activeElement) return;
      if (n.type === 'checkbox') n.checked = !!v;
      else if (n.getAttribute('role') === 'checkbox') n.setAttribute('aria-checked', String(!!v));
      else n.value = v == null ? '' : v;
    });
  }
  function cssEsc(s) { return global.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function fieldsOnDoc() {
    var used = {};
    S.pages.forEach(function (r) { if (r.docId) used[r.docId] = 1; });
    var seen = {};
    return S.fields.filter(function (f) {
      if (!used[f.docId] || f.type === 'signature' && false) return false;
      if (seen[f.key]) return false;
      seen[f.key] = 1;
      return true;
    });
  }
  PS.fieldsOnDoc = fieldsOnDoc;
  PS.fieldValue = fieldValue;
  function fieldControl(f, cls) {
    var v = fieldValue(f);
    var c;
    if (f.type === 'checkbox') {
      c = inputEl('checkbox');
      c.checked = !!v;
      c.addEventListener('change', function () { setFieldValue(f, c.checked); PS.refreshOverlays(); });
    } else if ((f.type === 'dropdown' || f.type === 'option-list' || f.type === 'radio') && f.options && f.options.length) {
      c = selectEl([['', '—']].concat(f.options.map(function (o) { return [o, o]; })), Array.isArray(v) ? v[0] : v);
      c.addEventListener('change', function () { setFieldValue(f, c.value); PS.refreshOverlays(); });
    } else if (f.type === 'signature') {
      c = btn('btn btn-sm', icon('sign') + 'Sign here');
      c.addEventListener('click', function () { PS.openPanel('sign'); });
      return c;
    } else {
      c = inputEl('text', v == null ? '' : v, { autocomplete: 'off' });
      c.addEventListener('input', function () { setFieldValue(f, c.value); PS.refreshOverlays(); });
    }
    if (f.readOnly) c.disabled = true;
    c.setAttribute('data-fkey', f.key);
    if (cls) c.classList.add(cls);
    return c;
  }
  function pageOfField(f) {
    for (var i = 0; i < S.pages.length; i++) if (S.pages[i].docId === f.docId && S.pages[i].pageIndex === f.page) return i;
    return -1;
  }
  PS.panels.forms = {
    title: 'Fill forms', icon: 'forms', tone: 'jade', snap: 'half',
    build: function (pane) {
      this.pane = pane;
      this.render();
    },
    render: function () {
      var pane = this.pane;
      if (!pane) return;
      pane.innerHTML = '';
      var fields = fieldsOnDoc();
      if (!fields.length) {
        var s = section('Fill & sign');
        s.appendChild(el('p', 'ps-note', 'This PDF has no fillable fields. Tap a tool, then tap the page where the answer goes.'));
        var g = el('div', 'ps-tiles');
        [['text', 'text', 'Text'], ['check', 'check', 'Check'], ['cross', 'cross', 'Cross'], ['dot', 'dot', 'Dot'], ['date', 'calendar', 'Date'], ['sign', 'sign', 'Signature']].forEach(function (t) {
          var b = tile(t[1], t[2]);
          b.addEventListener('click', function () {
            if (t[0] === 'sign') { PS.openPanel('sign'); return; }
            PS.setTool(t[0]);
            if (PS.isPhone()) PS.setSheet('closed');
          });
          g.appendChild(b);
        });
        s.appendChild(g);
        pane.appendChild(s);
        return;
      }
      var head = el('div', 'ps-formhead');
      var filled = fields.filter(function (f) { var v = fieldValue(f); return v !== '' && v != null && v !== false; }).length;
      head.innerHTML = '<div class="ps-meter"><i style="width:' + Math.round(filled / fields.length * 100) + '%"></i></div><span>' + filled + ' of ' + fields.length + ' filled</span>';
      pane.appendChild(head);
      var list = el('div', 'ps-formlist');
      fields.forEach(function (f) {
        var row = el('div', 'ps-formrow');
        var pi = pageOfField(f);
        var lab = el('label', null, '<span>' + esc(f.name.replace(/[._]/g, ' ')) + '</span><small>' + (pi >= 0 ? 'Page ' + (pi + 1) : 'Not in document') + ' · ' + esc(f.type) + '</small>');
        var ctl = fieldControl(f);
        var id = 'pf-' + PS.uid('f');
        ctl.id = id;
        lab.htmlFor = id;
        row.appendChild(lab);
        row.appendChild(ctl);
        ctl.addEventListener('focus', function () {
          if (pi >= 0) PS.goTo(pi);
          $$('.pv-field.is-focus').forEach(function (n) { n.classList.remove('is-focus'); });
          $$('.pv-field[data-fkey="' + cssEsc(f.key) + '"]').forEach(function (n) { n.classList.add('is-focus'); });
        });
        list.appendChild(row);
      });
      pane.appendChild(list);
      pane.appendChild(toggle('Flatten form when saving', S.flattenForms, function (on) { S.flattenForms = on; PS.markDirty(); }, 'Locks the answers into the page so they cannot be changed'));
      var clear = btn('btn btn-sm btn-ghost', 'Clear answers');
      clear.addEventListener('click', function () { S.formValues = {}; PS.panels.forms.render(); PS.refreshOverlays(); });
      pane.appendChild(clear);
    },
    show: function () { this.render(); }
  };
  PS.onFields = function () {
    if (S.panel === 'forms') PS.panels.forms.render();
    $$('.ps-rail [data-panel="forms"]').forEach(function (b) { b.classList.toggle('has-dot', fieldsOnDoc().length > 0); });
  };

  function rotateBox(b, ref, base) {
    var rot = ((ref.rotation || 0) % 360 + 360) % 360;
    var W = base.w, Hh = base.h;
    if (rot === 90) return { x: Hh - (b.y + b.h), y: b.x, w: b.h, h: b.w };
    if (rot === 180) return { x: W - (b.x + b.w), y: Hh - (b.y + b.h), w: b.w, h: b.h };
    if (rot === 270) return { x: b.y, y: W - (b.x + b.w), w: b.h, h: b.w };
    return b;
  }
  function baseSize(ref) {
    var doc = S.docs[ref.docId];
    var p = doc && doc.pages[ref.pageIndex];
    return p ? { w: p.width, h: p.height } : PS.refSize(ref);
  }
  function pct(box, size) {
    return 'left:' + (box.x / size.w * 100) + '%;top:' + (box.y / size.h * 100) + '%;width:' + (box.w / size.w * 100) + '%;height:' + (box.h / size.h * 100) + '%;';
  }

  PS.overlays.forms = function (slot, ref) {
    if (!ref.docId) { if (slot.childNodes.length) slot.innerHTML = ''; return; }
    var fields = S.fields.filter(function (f) { return f.docId === ref.docId && f.page === ref.pageIndex && f.rect && f.rect.w > 1; });
    var key = ref.rotation + '|' + fields.length;
    if (slot._key === key && slot.childNodes.length === fields.length) {
      $$('[data-fkey]', slot).forEach(function (n) {
        var f = fields[+n.getAttribute('data-i')];
        if (!f || n === d.activeElement) return;
        var v = fieldValue(f);
        if (n.getAttribute('role') === 'checkbox') n.setAttribute('aria-checked', String(!!v));
        else if ('value' in n) n.value = v == null ? '' : v;
      });
      return;
    }
    slot._key = key;
    slot.innerHTML = '';
    var size = PS.refSize(ref), base = baseSize(ref);
    fields.forEach(function (f, i) {
      var box = rotateBox(f.rect, ref, base);
      var n;
      if (f.type === 'checkbox') {
        n = btn('pv-field pv-check', icon('check'), { role: 'checkbox', 'aria-checked': String(!!fieldValue(f)), 'aria-label': f.name });
        n.addEventListener('click', function () {
          var next = !fieldValue(f);
          setFieldValue(f, next);
          n.setAttribute('aria-checked', String(next));
          if (PS.panels.forms.pane && S.panel === 'forms') PS.panels.forms.render();
        });
      } else if ((f.type === 'dropdown' || f.type === 'option-list') && f.options && f.options.length) {
        n = selectEl([['', '']].concat(f.options.map(function (o) { return [o, o]; })), fieldValue(f));
        n.className = 'pv-field pv-select';
        n.setAttribute('aria-label', f.name);
        n.addEventListener('change', function () { setFieldValue(f, n.value); });
      } else if (f.type === 'signature') {
        n = btn('pv-field pv-sig', icon('sign') + '<span>Sign</span>', { 'aria-label': 'Sign ' + f.name });
        n.addEventListener('click', function () { PS.openPanel('sign'); });
      } else if (f.type === 'radio') {
        n = btn('pv-field pv-radio', '', { 'aria-label': f.name + ' (choose in the Forms panel)' });
        n.addEventListener('click', function () { PS.openPanel('forms'); });
      } else {
        n = d.createElement(f.rect.h > 40 ? 'textarea' : 'input');
        n.className = 'pv-field pv-text';
        n.value = fieldValue(f) == null ? '' : fieldValue(f);
        n.setAttribute('aria-label', f.name);
        n.autocomplete = 'off';
        n.style.setProperty('--fs', Math.max(6, Math.min(14, f.rect.h * 0.62)).toFixed(1));
        n.addEventListener('input', function () { setFieldValue(f, n.value); });
      }
      if (f.readOnly) n.disabled = true;
      n.setAttribute('data-fkey', f.key);
      n.setAttribute('data-i', i);
      n.title = f.name;
      n.setAttribute('style', (n.getAttribute('style') || '') + pct(box, size));
      slot.appendChild(n);
    });
  };

  /* ---------- Tools panel (document tools with live preview) ---------- */

  var POS = [['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right']];
  function posPicker(value, onPick) {
    var g = el('div', 'ps-pos');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', 'Position');
    POS.forEach(function (p) {
      var b = btn('ps-pos-b', '<i></i>', { 'aria-label': p[1], title: p[1], role: 'radio', 'aria-checked': String(p[0] === value), 'data-v': p[0] });
      g.appendChild(b);
    });
    g.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      $$('[data-v]', g).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      onPick(b.getAttribute('data-v'));
    });
    return g;
  }
  PS.ui.posPicker = posPicker;
  function chromeChanged() { PS.refreshOverlays(); PS.markDirty(); }
  function toolCard(title, iconName, key, defaults, buildBody) {
    var card = el('section', 'ps-card');
    var head = el('div', 'ps-card-head');
    head.innerHTML = '<span class="ps-card-ic">' + icon(iconName) + '</span><strong>' + esc(title) + '</strong>';
    var on = !!S.docTools[key];
    var t = toggle('', on, function (v) {
      S.docTools[key] = v ? (S.docTools['_' + key] || PS.clone(defaults)) : null;
      if (!v && body._cfg) S.docTools['_' + key] = body._cfg;
      body.hidden = !v;
      card.classList.toggle('is-on', v);
      if (v) body._cfg = S.docTools[key];
      chromeChanged();
    });
    t.classList.add('ps-toggle-head');
    t.setAttribute('aria-label', 'Turn ' + title.toLowerCase() + ' on or off');
    head.appendChild(t);
    card.appendChild(head);
    var body = el('div', 'ps-card-body');
    body.hidden = !on;
    card.classList.toggle('is-on', on);
    function cfg() { return S.docTools[key] || (S.docTools['_' + key] = S.docTools['_' + key] || PS.clone(defaults)); }
    buildBody(body, cfg);
    card.appendChild(body);
    card._toggle = t;
    return card;
  }

  PS.panels.tools = {
    title: 'Document tools', icon: 'tools', tone: 'copper', snap: 'half',
    build: function (pane) {
      pane.appendChild(el('p', 'ps-note ps-lead', 'Turn a tool on to preview it on every page. It is added when you save.'));
      pane.appendChild(toolCard('Page numbers', 'hash', 'pageNumbers', { position: 'bc', format: 'n / N', start: 1, size: 10, margin: 28, color: '#333333', skipFirst: false, font: 'Plus Jakarta Sans' }, function (b, cfg) {
        b.appendChild(posPicker(cfg().position, function (v) { cfg().position = v; chromeChanged(); }));
        var fmt = selectEl([['n', '1'], ['n / N', '1 / 12'], ['Page n', 'Page 1'], ['Page n of N', 'Page 1 of 12']], cfg().format);
        fmt.addEventListener('change', function () { cfg().format = fmt.value; chromeChanged(); });
        var row = el('div', 'ps-row');
        row.appendChild(field('Format', fmt, 'ps-pn-fmt'));
        var st = inputEl('number', cfg().start, { min: 0, max: 99999 });
        st.addEventListener('input', function () { cfg().start = +st.value || 1; chromeChanged(); });
        var stf = field('Start at', st, 'ps-pn-start');
        stf.classList.add('ps-field-sm');
        row.appendChild(stf);
        b.appendChild(row);
        b.appendChild(slider('Size', 6, 28, 1, cfg().size, function (v) { return v + ' pt'; }, function (v) { cfg().size = v; chromeChanged(); }));
        b.appendChild(slider('Margin', 8, 72, 1, cfg().margin, function (v) { return v + ' pt'; }, function (v) { cfg().margin = v; chromeChanged(); }));
        b.appendChild(el('div', 'ps-eyebrow', 'Colour'));
        b.appendChild(swatches(['#333333', '#17131F', '#7457F0', '#1D4ED8', '#E5484D', '#888888'], cfg().color, function (c) { cfg().color = c; chromeChanged(); }, true, { title: 'Page number colour' }));
        b.appendChild(toggle('Skip the first page', cfg().skipFirst, function (v) { cfg().skipFirst = v; chromeChanged(); }));
      }));
      pane.appendChild(toolCard('Watermark', 'drop', 'watermark', { text: 'CONFIDENTIAL', size: 54, color: '#E5484D', opacity: 0.18, rotation: 45, tiled: false, behind: false, font: 'Plus Jakarta Sans' }, function (b, cfg) {
        var mode = seg([['text', 'Text'], ['image', 'Image']], cfg().imageKey ? 'image' : 'text', function (v) {
          if (v === 'image') {
            PS.pickFiles('image/*', false).then(function (files) {
              if (!files[0]) { mode.setValue('text'); return; }
              fileToCanvas(files[0], 1600).then(function (c) {
                var k = PS.uid('wm');
                S.assets[k] = c;
                cfg().imageKey = k;
                textBox.hidden = true;
                chromeChanged();
              });
            });
          } else { delete cfg().imageKey; textBox.hidden = false; chromeChanged(); }
        });
        b.appendChild(mode);
        var textBox = el('div');
        textBox.hidden = !!cfg().imageKey;
        var tx = inputEl('text', cfg().text, { autocomplete: 'off' });
        tx.addEventListener('input', function () { cfg().text = tx.value; chromeChanged(); });
        textBox.appendChild(field('Text', tx, 'ps-wm-text'));
        textBox.appendChild(slider('Size', 12, 160, 1, cfg().size, function (v) { return v + ' pt'; }, function (v) { cfg().size = v; chromeChanged(); }));
        textBox.appendChild(el('div', 'ps-eyebrow', 'Colour'));
        textBox.appendChild(swatches(['#E5484D', '#888888', '#17131F', '#1D4ED8', '#17A37A', '#7457F0'], cfg().color, function (c) { cfg().color = c; chromeChanged(); }, true, { title: 'Watermark colour' }));
        b.appendChild(textBox);
        b.appendChild(slider('Opacity', 3, 100, 1, Math.round(cfg().opacity * 100), function (v) { return v + '%'; }, function (v) { cfg().opacity = v / 100; chromeChanged(); }));
        b.appendChild(slider('Rotation', -90, 90, 1, cfg().rotation, function (v) { return v + '°'; }, function (v) { cfg().rotation = v; chromeChanged(); }));
        b.appendChild(toggle('Tile across the page', cfg().tiled, function (v) { cfg().tiled = v; chromeChanged(); }));
        b.appendChild(toggle('Place behind content', cfg().behind, function (v) { cfg().behind = v; chromeChanged(); }));
      }));
      pane.appendChild(toolCard('Header & footer', 'alignC', 'headerFooter', { header: { left: '', center: '{title}', right: '' }, footer: { left: '{date}', center: '', right: 'Page {page} of {pages}' }, size: 9, margin: 30, color: '#555555', skipFirst: false, font: 'Plus Jakarta Sans' }, function (b, cfg) {
        b.appendChild(el('p', 'ps-note', 'Tokens: {page} {pages} {date} {title}'));
        [['header', 'Header'], ['footer', 'Footer']].forEach(function (part) {
          b.appendChild(el('div', 'ps-label', part[1]));
          var row = el('div', 'ps-hf');
          ['left', 'center', 'right'].forEach(function (slot) {
            var i = inputEl('text', cfg()[part[0]][slot], { placeholder: slot, 'aria-label': part[1] + ' ' + slot, autocomplete: 'off' });
            i.addEventListener('input', function () { cfg()[part[0]][slot] = i.value; chromeChanged(); });
            row.appendChild(i);
          });
          b.appendChild(row);
        });
        b.appendChild(slider('Size', 6, 20, 1, cfg().size, function (v) { return v + ' pt'; }, function (v) { cfg().size = v; chromeChanged(); }));
        b.appendChild(slider('Margin', 8, 72, 1, cfg().margin, function (v) { return v + ' pt'; }, function (v) { cfg().margin = v; chromeChanged(); }));
        b.appendChild(el('div', 'ps-eyebrow', 'Colour'));
        b.appendChild(swatches(['#555555', '#17131F', '#1B2A4A', '#7457F0', '#1D4ED8', '#888888'], cfg().color, function (c) { cfg().color = c; chromeChanged(); }, true, { title: 'Header & footer colour' }));
        b.appendChild(toggle('Skip the first page', cfg().skipFirst, function (v) { cfg().skipFirst = v; chromeChanged(); }));
      }));
      pane.appendChild(toolCard('Bates numbering', 'hash', 'bates', { prefix: 'ABC', suffix: '', start: 1, digits: 6, position: 'br', size: 9, margin: 24, color: '#222222', font: 'IBM Plex Mono' }, function (b, cfg) {
        var row = el('div', 'ps-row');
        var pre = inputEl('text', cfg().prefix, { autocomplete: 'off' });
        pre.addEventListener('input', function () { cfg().prefix = pre.value; chromeChanged(); });
        row.appendChild(field('Prefix', pre, 'ps-b-pre'));
        var st = inputEl('number', cfg().start, { min: 0 });
        st.addEventListener('input', function () { cfg().start = +st.value || 0; chromeChanged(); });
        var stf = field('Start', st, 'ps-b-start');
        stf.classList.add('ps-field-sm');
        row.appendChild(stf);
        var dg = inputEl('number', cfg().digits, { min: 1, max: 12 });
        dg.addEventListener('input', function () { cfg().digits = clamp(+dg.value || 6, 1, 12); chromeChanged(); });
        var dgf = field('Digits', dg, 'ps-b-dig');
        dgf.classList.add('ps-field-sm');
        row.appendChild(dgf);
        b.appendChild(row);
        b.appendChild(posPicker(cfg().position, function (v) { cfg().position = v; chromeChanged(); }));
        b.appendChild(el('div', 'ps-eyebrow', 'Colour'));
        b.appendChild(swatches(['#222222', '#17131F', '#1B2A4A', '#C62828', '#1D4ED8'], cfg().color, function (c) { cfg().color = c; chromeChanged(); }, true, { title: 'Bates colour' }));
      }));
      var meta = toolCard('Document properties', 'info', 'metadata', { title: '', author: '', subject: '', keywords: '' }, function (b, cfg) {
        [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords (comma separated)']].forEach(function (f) {
          var i = inputEl('text', cfg()[f[0]], { autocomplete: 'off' });
          i.setAttribute('data-meta', f[0]);
          i.addEventListener('input', function () { cfg()[f[0]] = i.value; PS.markDirty(); chromeChanged(); });
          b.appendChild(field(f[1], i, 'ps-meta-' + f[0]));
        });
      });
      pane.appendChild(meta);
      this._meta = meta;

      var comp = el('section', 'ps-card is-on');
      comp.innerHTML = '<div class="ps-card-head"><span class="ps-card-ic">' + icon('layers') + '</span><strong>Compress</strong></div>';
      var cb = el('div', 'ps-card-body');
      var cseg = seg([['none', 'Original'], ['balanced', 'Balanced'], ['small', 'Smallest']], S.docTools.compress || 'none', function (v) { S.docTools.compress = v; est.textContent = ''; PS.markDirty(); });
      cb.appendChild(cseg);
      cb.appendChild(el('p', 'ps-note', 'Compress turns heavy pages into JPEG images. Pages that are already small stay sharp vector text.'));
      var estBtn = btn('btn btn-sm', icon('gauge') + 'Estimate size');
      var est = el('p', 'ps-note ps-est');
      estBtn.addEventListener('click', function () { estimate(est); });
      cb.appendChild(estBtn);
      cb.appendChild(est);
      cb.appendChild(toggle('Flatten annotations and forms', S.docTools.flatten, function (v) { S.docTools.flatten = v; PS.markDirty(); }, 'Pages with annotations are saved as images'));
      comp.appendChild(cb);
      pane.appendChild(comp);
      this._cseg = cseg;
    },
    show: function () {
      var meta = this._meta;
      var first = Object.keys(S.docs)[0];
      if (meta && first && !meta._filled) {
        meta._filled = true;
        S.docs[first].metadata().then(function (m) {
          var cfg = S.docTools.metadata || S.docTools._metadata || (S.docTools._metadata = { title: '', author: '', subject: '', keywords: '' });
          ['title', 'author', 'subject', 'keywords'].forEach(function (k) {
            if (!cfg[k] && m[k]) cfg[k] = Array.isArray(m[k]) ? m[k].join(', ') : String(m[k]);
            var i = $('[data-meta="' + k + '"]', meta);
            if (i) i.value = cfg[k] || '';
          });
        });
      }
    }
  };

  async function estimate(out) {
    var mode = S.docTools.compress === 'none' ? 'balanced' : S.docTools.compress;
    var pr = PS.progress('Estimating compressed size', true);
    try {
      var original = await PS.buildPdf({ progress: pr, noTools: true });
      var opts = PS.docToolOpts();
      opts.compress = mode;
      var refs = S.pages;
      pr.set(0, 1, 'Compressing');
      var small = await LE.pdf.compress(original, mode, { onProgress: function (dn, t) { pr.set(dn, t, 'Page ' + dn + ' of ' + t); } });
      pr.end();
      var rep = small.report || LE.pdf.lastReport || {};
      var saved = original.length ? Math.round((1 - small.length / original.length) * 100) : 0;
      out.innerHTML = '';
      out.appendChild(d.createTextNode(IT.formatBytes(original.length) + ' → ' + IT.formatBytes(small.length) + (saved > 0 ? ' (' + saved + '% smaller)' : ' (already compact)') + '. ' + (rep.compressedPages ? rep.compressedPages.length : 0) + ' of ' + refs.length + ' pages turned into images. '));
      var dl = btn('btn btn-sm btn-gold', icon('download') + 'Download compressed');
      dl.addEventListener('click', function () { IT.download(new Blob([small], { type: 'application/pdf' }), PS.outName('-compressed.pdf')); });
      out.appendChild(dl);
    } catch (e) {
      pr.end();
      if (!e.cancelled) out.textContent = 'Could not estimate: ' + e.message;
    }
  }

  function fontCss(f) {
    if (!f || /^helvetica/i.test(f)) return 'Helvetica, Arial, sans-serif';
    if (/^times/i.test(f)) return '"Times New Roman", Times, serif';
    if (/^courier/i.test(f)) return '"Courier New", Courier, monospace';
    return LE.fonts ? LE.fonts.css(f) : f;
  }
  function chromeText(text, x, y, size, color, font, align) {
    var n = el('span', 'pv-chrome-t');
    n.textContent = text;
    n.style.cssText = 'top:' + y + '%;font-size:calc(var(--z) * ' + size + 'px);color:' + color + ';font-family:' + fontCss(font) + ';' +
      (align === 'r' ? 'right:' + x + '%;' : align === 'c' ? 'left:50%;transform:translateX(-50%);' : 'left:' + x + '%;');
    return n;
  }
  function pageLabel(fmt, n, N) {
    if (fmt === 'n / N') return n + ' / ' + N;
    if (fmt === 'Page n of N') return 'Page ' + n + ' of ' + N;
    if (fmt === 'Page n') return 'Page ' + n;
    return String(n);
  }
  function title() {
    var m = S.docTools.metadata;
    return (m && m.title) || PS.baseName(PS.outName());
  }
  PS.overlays.chrome = function (slot, ref, i) {
    slot.innerHTML = '';
    var T = S.docTools;
    if (!T.pageNumbers && !T.watermark && !T.headerFooter && !T.bates) return;
    var size = PS.refSize(ref), N = S.pages.length;
    function place(text, pos, cfg, fontDefault) {
      var m = PS.num(cfg.margin, 28), sz = PS.num(cfg.size, 10);
      var top = pos.charAt(0) === 't' ? m / size.h * 100 : (size.h - m - sz * 0.78) / size.h * 100;
      var a = pos.charAt(1) || 'c';
      slot.appendChild(chromeText(text, m / size.w * 100, top, sz, cfg.color || '#333', cfg.font || fontDefault, a));
    }
    if (T.watermark) {
      var w = T.watermark;
      var wrap = el('div', 'pv-wm' + (w.tiled ? ' is-tiled' : ''));
      wrap.style.opacity = String(w.opacity == null ? 0.18 : w.opacity);
      var mk = function () {
        var n;
        if (w.imageKey && S.assets[w.imageKey]) {
          n = new Image();
          n.alt = '';
          var c = S.assets[w.imageKey];
          if (!c._url) c._url = c.toDataURL('image/png');
          n.src = c._url;
          n.className = 'pv-wm-img';
          n.style.width = 'calc(var(--z) * ' + (Math.min(size.w, size.h) * 0.45) + 'px)';
        } else {
          n = el('span', 'pv-wm-t');
          n.textContent = w.text || '';
          n.style.cssText = 'font-size:calc(var(--z) * ' + (w.size || 54) + 'px);color:' + (w.color || '#888') + ';font-family:' + fontCss(w.font) + ';';
        }
        n.style.transform = 'rotate(' + (-(w.rotation == null ? 45 : w.rotation)) + 'deg)';
        return n;
      };
      if (w.tiled) {
        var cols = 3, rows = Math.max(3, Math.round(3 * size.h / size.w));
        for (var k = 0; k < cols * rows; k++) { var cell = el('div', 'pv-wm-cell'); cell.appendChild(mk()); wrap.appendChild(cell); }
        wrap.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
      } else wrap.appendChild(mk());
      slot.appendChild(wrap);
    }
    if (T.pageNumbers) {
      var pn = T.pageNumbers;
      if (!(pn.skipFirst && i === 0)) {
        var skip = pn.skipFirst ? 1 : 0, start = PS.num(pn.start, 1);
        place(pageLabel(pn.format, start + i - skip, start + Math.max(1, N - skip) - 1), pn.position || 'bc', pn, 'Helvetica');
      }
    }
    if (T.headerFooter) {
      var hf = T.headerFooter;
      if (!(hf.skipFirst && i === 0)) {
        var info = function (s) {
          return String(s || '').replace(/\{page\}/gi, i + 1).replace(/\{pages\}/gi, N).replace(/\{date\}/gi, new Date().toLocaleDateString()).replace(/\{title\}/gi, title());
        };
        [['header', 't'], ['footer', 'b']].forEach(function (part) {
          var src = hf[part[0]] || {};
          [['left', 'l'], ['center', 'c'], ['right', 'r']].forEach(function (s) {
            if (src[s[0]]) place(info(src[s[0]]), part[1] + s[1], { margin: hf.margin == null ? 36 : hf.margin, size: hf.size, color: hf.color, font: hf.font }, 'Helvetica');
          });
        });
      }
    }
    if (T.bates) {
      var bt = T.bates;
      var nb = String(PS.num(bt.start, 1) + i);
      while (nb.length < (bt.digits || 6)) nb = '0' + nb;
      place((bt.prefix || '') + nb + (bt.suffix || ''), bt.position || 'br', bt, 'Courier');
    }
  };

  /* ---------- Convert panel ---------- */

  PS.panels.convert = {
    title: 'Add & convert', icon: 'convert', tone: 'sapphire', snap: 'half',
    build: function (pane) {
      var dz = el('div', 'ps-addzone');
      dz.tabIndex = 0;
      dz.setAttribute('role', 'button');
      dz.innerHTML = '<span class="ic ic-sapphire ic-lg">' + icon('filePlus') + '</span><strong>Add any file</strong><small>PDF, Word, PowerPoint, Excel, images, HTML, Markdown, text, EPUB. Each becomes pages here.</small>';
      pane.appendChild(dz);
      var where = seg([['end', 'At the end'], ['after', 'After this page']], 'end', function () {});
      pane.appendChild(where);
      function go(files) {
        if (!files.length) return;
        var at = $('[aria-pressed="true"]', where).getAttribute('data-v') === 'after' ? S.current + 1 : null;
        PS.addFiles(files, { at: at });
      }
      dz.addEventListener('click', function () { PS.pickFiles(PS.ACCEPT_ANY, true).then(go); });
      dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dz.click(); } });
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-over'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('is-over'); });
      dz.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove('is-over'); d.body.classList.remove('ps-drop'); go([].slice.call(e.dataTransfer.files || [])); });
      var s = section('Quick starts');
      var g = el('div', 'ps-tiles');
      [['merge', 'merge', 'Merge PDFs'], ['images', 'images', 'Images to pages'], ['blank', 'blank', 'Blank page']].forEach(function (t) {
        var b = tile(t[1], t[2]);
        b.addEventListener('click', function () {
          if (t[0] === 'blank') { PS.insertBlank('same', false); return; }
          PS.pickFiles(t[0] === 'images' ? 'image/*' : '.pdf,application/pdf', true).then(go);
        });
        g.appendChild(b);
      });
      s.appendChild(g);
      pane.appendChild(s);
      var more = section('Need more control?');
      more.appendChild(el('p', 'ps-note', 'Convert to PDF has page size, margins, headers, sheet picking, and a live preview of every page.'));
      var a = el('a', 'btn btn-sm', icon('convert') + 'Open Convert to PDF');
      a.href = '../convert-to-pdf/';
      more.appendChild(a);
      pane.appendChild(more);
      var warn = el('div', 'ps-warnlist');
      pane.appendChild(warn);
      this._warn = warn;
    },
    show: function () {
      var w = this._warn;
      if (!w) return;
      w.innerHTML = '';
      if (S.warnings.length) {
        w.appendChild(el('h3', 'ps-sec-title', 'Conversion notes'));
        var ul = el('ul');
        S.warnings.slice(-8).forEach(function (x) { ul.appendChild(el('li', null, esc(x))); });
        w.appendChild(ul);
      }
    }
  };

  /* ---------- Export panel ---------- */

  PS.panels.export = {
    title: 'Save & export', icon: 'export', tone: 'gold', snap: 'half',
    build: function (pane) {
      var s1 = section('Save PDF');
      var name = inputEl('text', PS.outName(), { autocomplete: 'off', spellcheck: 'false' });
      name.addEventListener('input', function () { PS.E.name.value = name.value; S.name = name.value; });
      this._name = name;
      s1.appendChild(field('File name', name, 'ps-ex-name'));
      var summary = el('div', 'ps-summary');
      this._summary = summary;
      s1.appendChild(summary);
      var saveB = btn('btn btn-gold btn-lg btn-block', icon('download') + 'Save PDF', { 'data-act': 'save' });
      s1.appendChild(saveB);
      var saveAs = btn('btn btn-sm btn-ghost', 'Save as…', { 'data-act': 'save-as' });
      s1.appendChild(saveAs);
      pane.appendChild(s1);

      var s2 = section('Pages as images');
      var fmt = seg([['png', 'PNG'], ['jpeg', 'JPG']], 'png', function () {});
      s2.appendChild(fmt);
      var scale = slider('Resolution', 1, 4, 0.5, 2, function (v) { return Math.round(v * 72) + ' dpi'; }, function () {});
      s2.appendChild(scale);
      var imgB = btn('btn btn-sm', icon('images') + 'Download images (.zip)');
      imgB.addEventListener('click', function () {
        exportImages($('[aria-pressed="true"]', fmt).getAttribute('data-v'), +$('input', scale).value);
      });
      s2.appendChild(imgB);
      pane.appendChild(s2);

      var s3 = section('Split & extract');
      var exSel = btn('btn btn-sm', icon('scissors') + 'Extract selected pages');
      exSel.addEventListener('click', function () { PS.extractSelected(); });
      s3.appendChild(exSel);
      var every = btn('btn btn-sm', icon('pages') + 'One PDF per page (.zip)');
      every.addEventListener('click', function () { PS.splitRanges(S.pages.map(function (_, i) { return String(i + 1); }).join(',')); });
      s3.appendChild(every);
      s3.appendChild(el('p', 'ps-note', 'For custom ranges, open Pages → Split or extract.'));
      pane.appendChild(s3);

      var s4 = section('Last save');
      var rep = el('div', 'ps-lastsave');
      rep.appendChild(el('p', 'ps-note', 'Nothing saved yet.'));
      this._rep = rep;
      s4.appendChild(rep);
      pane.appendChild(s4);

      var s5 = section('Start over');
      var closeB = btn('btn btn-sm btn-ghost', icon('close') + 'Close document');
      closeB.addEventListener('click', function () {
        PS.dialog({ title: 'Close this document?', text: 'Your edits are cleared from this device. Save first if you want to keep them.', ok: 'Close' }).then(function (ok) { if (ok) PS.closeAll(); });
      });
      s5.appendChild(closeB);
      pane.appendChild(s5);
    },
    show: function () {
      if (this._name) this._name.value = PS.outName();
      var sm = this._summary;
      if (sm) {
        var T = S.docTools, bits = [];
        var ann = S.pages.filter(function (r) { return r.scene && r.scene.layers && r.scene.layers.length; }).length;
        var red = S.pages.filter(function (r) { return r.scene && r.scene.layers && r.scene.layers.some(function (l) { return /^Redaction/.test(l.name || ''); }); }).length;
        bits.push(S.pages.length + ' page' + (S.pages.length === 1 ? '' : 's'));
        if (ann) bits.push(ann + ' annotated');
        if (T.pageNumbers) bits.push('page numbers');
        if (T.watermark) bits.push('watermark');
        if (T.headerFooter) bits.push('header & footer');
        if (T.bates) bits.push('Bates');
        if (T.compress && T.compress !== 'none') bits.push(T.compress + ' compression');
        var nForm = Object.keys(S.formValues).reduce(function (n, k) { return n + Object.keys(S.formValues[k]).length; }, 0);
        if (nForm) bits.push(nForm + ' form answer' + (nForm === 1 ? '' : 's'));
        sm.innerHTML = '';
        sm.appendChild(el('p', null, esc(bits.join(' · '))));
        if (red) sm.appendChild(el('p', 'ps-note ps-warn', icon('alert') + esc(red + ' redacted page' + (red === 1 ? '' : 's') + ' will be saved as image' + (red === 1 ? '' : 's') + '. Text there cannot be selected afterwards.')));
      }
    }
  };
  PS.onSaved = function (info) {
    var p = PS.panels.export;
    if (!p._rep) return;
    var r = p._rep;
    r.innerHTML = '';
    r.appendChild(el('p', null, '<strong></strong> · ' + IT.formatBytes(info.bytes.length) + ' · ' + (info.report.pageCount || S.pages.length) + ' pages'));
    $('strong', r).textContent = info.name;
    (info.report.warnings || []).slice(0, 6).forEach(function (w) { r.appendChild(el('p', 'ps-note ps-warn', esc(w))); });
  };

  async function exportImages(format, scale) {
    var pr = PS.progress('Making images', true);
    try {
      var bytes = await PS.buildPdf({ progress: pr });
      pr.set(0, 1, 'Rendering pages');
      var imgs = await LE.pdf.toImages(bytes, { format: format, scale: scale, quality: 0.9, onProgress: function (dn, t) { pr.set(dn, t, 'Image ' + dn + ' of ' + t); } });
      var files = [];
      for (var i = 0; i < imgs.length; i++) {
        files.push({ name: PS.baseName(PS.outName()) + '-' + String(i + 1).padStart(3, '0') + (format === 'jpeg' ? '.jpg' : '.png'), data: new Uint8Array(await imgs[i].blob.arrayBuffer()) });
      }
      pr.end();
      if (files.length === 1) IT.download(new Blob([files[0].data], { type: format === 'jpeg' ? 'image/jpeg' : 'image/png' }), files[0].name);
      else IT.download(LE.zip(files), PS.outName('-images.zip'));
    } catch (e) {
      pr.end();
      if (!e.cancelled) say('Could not export images: ' + e.message, 4200);
    }
  }

  /* ---------- find ---------- */

  var F = { q: '', hits: [], idx: -1, cache: {}, token: 0 };
  PS.overlays.find = function (slot, ref) {
    var mine = F.hits.filter(function (h) { return h.uid === ref.uid; });
    var key = F.q + '|' + F.idx + '|' + mine.length + '|' + ref.rotation;
    if (slot._key === key) return;
    slot._key = key;
    slot.innerHTML = '';
    if (!mine.length) return;
    var size = PS.refSize(ref), base = baseSize(ref);
    mine.forEach(function (h) {
      var b = rotateBox(h.box, ref, base);
      var m = el('i', 'pv-hit' + (F.hits[F.idx] === h ? ' is-current' : ''));
      m.setAttribute('style', pct({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, size));
      slot.appendChild(m);
    });
  };
  function textOf(ref) {
    var k = ref.docId + ':' + ref.pageIndex;
    if (F.cache[k]) return Promise.resolve(F.cache[k]);
    return S.docs[ref.docId].text(ref.pageIndex).then(function (t) { F.cache[k] = t; return t; });
  }
  async function runFind(q) {
    var tok = ++F.token;
    F.q = q;
    F.hits = [];
    F.idx = -1;
    var count = $('#ps-find-count');
    if (!q) { count.textContent = ''; PS.refreshOverlays(); return; }
    var low = q.toLowerCase();
    count.textContent = 'Searching…';
    var order = S.pages.map(function (r, i) { return i; });
    order = order.slice(S.current).concat(order.slice(0, S.current));
    var found = [];
    for (var n = 0; n < order.length; n++) {
      var ref = S.pages[order[n]];
      if (!ref.docId || !S.docs[ref.docId]) continue;
      var t;
      try { t = await textOf(ref); } catch (e) { continue; }
      if (tok !== F.token) return;
      t.items.forEach(function (it) {
        var s = it.str.toLowerCase();
        var from = 0, at;
        while ((at = s.indexOf(low, from)) >= 0) {
          var len = it.str.length || 1;
          found.push({ uid: ref.uid, page: order[n], box: { x: it.x + it.w * at / len, y: it.y, w: Math.max(2, it.w * low.length / len), h: it.h } });
          from = at + low.length;
        }
      });
      if (n % 3 === 2) { F.hits = found.slice().sort(byPage); count.textContent = found.length + ' found…'; await PS.frame(); }
    }
    if (tok !== F.token) return;
    F.hits = found.sort(byPage);
    count.textContent = F.hits.length ? '' : 'No matches';
    if (F.hits.length) {
      for (var j = 0; j < F.hits.length; j++) if (F.hits[j].page >= S.current) { F.idx = j; break; }
      if (F.idx < 0) F.idx = 0;
      showHit();
    }
    PS.refreshOverlays();
  }
  function byPage(a, b) { return a.page - b.page || a.box.y - b.box.y || a.box.x - b.box.x; }
  function showHit() {
    var h = F.hits[F.idx];
    if (!h) return;
    $('#ps-find-count').textContent = (F.idx + 1) + ' of ' + F.hits.length;
    var i = PS.refIndex(h.uid);
    if (i < 0) return;
    var p = PS.pageEls[h.uid];
    var ref = S.pages[i];
    var b = rotateBox(h.box, ref, baseSize(ref));
    var v = PS.E.viewer;
    if (p) {
      var y = p.offsetTop + b.y * S.zoom - v.clientHeight * 0.35;
      v.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
      var x = p.offsetLeft + b.x * S.zoom - v.clientWidth / 2;
      if (v.scrollWidth > v.clientWidth) v.scrollLeft = Math.max(0, x);
    }
    PS.refreshOverlays();
  }
  function stepFind(dir) {
    if (!F.hits.length) return;
    F.idx = (F.idx + dir + F.hits.length) % F.hits.length;
    showHit();
  }
  PS.openFind = function () {
    var bar = $('#ps-find');
    bar.hidden = false;
    d.body.classList.add('ps-finding');
    var i = $('#ps-find-input');
    i.focus();
    i.select();
  };
  PS.closeFind = function () {
    var bar = $('#ps-find');
    if (bar.hidden) return false;
    bar.hidden = true;
    d.body.classList.remove('ps-finding');
    F.q = '';
    F.hits = [];
    PS.refreshOverlays();
    return true;
  };
  function bindFind() {
    var i = $('#ps-find-input');
    var t = 0;
    i.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { runFind(i.value.trim()); }, 220); });
    i.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (F.q !== i.value.trim()) runFind(i.value.trim()); else stepFind(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); PS.closeFind(); }
    });
    $('#ps-find').addEventListener('click', function (e) {
      var b = e.target.closest('[data-find]');
      if (!b) return;
      var a = b.getAttribute('data-find');
      if (a === 'next') stepFind(1);
      else if (a === 'prev') stepFind(-1);
      else PS.closeFind();
    });
  }

  /* ---------- settings ---------- */

  PS.openSettings = function (anchor) {
    var pop = $('#ps-settings');
    if (!pop.hidden) { pop.hidden = true; return; }
    pop.innerHTML = '';
    pop.appendChild(el('h3', 'ps-sec-title', 'Performance'));
    var mode = LE.perf ? LE.perf.mode() : 'auto';
    var opts = [['auto', 'Auto', 'Matches this device'], ['quality', 'Best quality', 'Sharpest pages, more memory'], ['saver', 'Battery saver', 'Lighter rendering for older phones']];
    opts.forEach(function (o) {
      var b = btn('ps-opt', '<strong>' + o[1] + '</strong><small>' + o[2] + '</small>', { role: 'radio', 'aria-checked': String(mode === o[0]) });
      b.addEventListener('click', function () {
        LE.perf.set(o[0]);
        $$('.ps-opt', pop).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        Object.keys(PS.pageEls).forEach(function (k) { PS.pageEls[k]._scale = 0.0001; });
        PS.scheduleRender();
        say(o[1] + ' on');
      });
      pop.appendChild(b);
    });
    pop.appendChild(el('h3', 'ps-sec-title', 'Appearance'));
    var theme = btn('ps-opt', '<strong>Switch light / dark</strong><small>Pages stay white so colors stay true</small>', { 'data-theme-toggle': '' });
    pop.appendChild(theme);
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(global.innerHeight - pop.offsetHeight - 8, r.bottom + 8) + 'px';
    pop.style.left = clamp(r.right - pop.offsetWidth, 8, global.innerWidth - pop.offsetWidth - 8) + 'px';
    setTimeout(function () {
      d.addEventListener('pointerdown', function off(e) {
        if (pop.contains(e.target) || anchor.contains(e.target)) return;
        pop.hidden = true;
        d.removeEventListener('pointerdown', off);
      });
    }, 0);
  };

  /* ---------- wiring ---------- */

  PS.onOrganizer = function () { PS.renderCtx(); };
  PS.onClosed = function () { S.warnings = []; F.cache = {}; ['tools', 'forms', 'export'].forEach(function (k) { var p = $('.ps-pane[data-pane="' + k + '"]'); if (p) p.remove(); }); };
  PS.onRestored = function () { ['tools'].forEach(function (k) { var p = $('.ps-pane[data-pane="' + k + '"]'); if (p) p.remove(); }); PS.refreshOverlays(); };
  PS.onAfterHistory = function () { PS.renderCtx(); };

  PS.panels.pages.init = function () {
    bindFind();
    var org = $('#ps-organize');
    if (org) org.addEventListener('click', function (e) {
      var b = e.target.closest('[data-org]');
      if (!b) return;
      var a = b.getAttribute('data-org');
      var uids = PS.selectedUids();
      if (a === 'rotL') PS.rotatePages(uids, -90);
      else if (a === 'rotR') PS.rotatePages(uids, 90);
      else if (a === 'dup') PS.duplicatePages(uids);
      else if (a === 'del') PS.deletePages(uids);
      else if (a === 'blank') PS.insertBlank('same', false);
    });
    if (LE.fonts && LE.fonts.load) LE.fonts.load('Plus Jakarta Sans', 400, false).catch(function () {});
  };
})(window);
