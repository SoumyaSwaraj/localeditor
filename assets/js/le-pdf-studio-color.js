/* LocalEditor PDF studio colour picker: Solid (HSV, hex, RGB, eyedropper, document, recent, brand) and Palettes (LE.assets.colorSets). */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var PS = global.PS;
  if (!PS) return;
  var d = document;
  var $ = PS.$, $$ = PS.$$, el = PS.el, esc = PS.esc, icon = PS.icon, clamp = PS.clamp;

  var BRAND = ['#17131F', '#4E36C9', '#7457F0', '#B79CFF', '#E0668E', '#D33B4A', '#B8862F', '#F2D594', '#17A37A', '#2F6BFF'];
  var FALLBACK_SETS = [
    { id: 'brand', name: 'LocalEditor', group: 'Brand', colors: BRAND },
    { id: 'office', name: 'Office ink', group: 'Business', colors: ['#111111', '#1B2A4A', '#2346C8', '#1F5135', '#7A1F2B', '#5B3A21', '#4B2A7A', '#C62828'] },
    { id: 'corporate', name: 'Corporate navy', group: 'Business', colors: ['#0B1F3A', '#14325C', '#1F4E8C', '#3A73B8', '#7FA6D6', '#C9DAF0', '#E8EEF7'] },
    { id: 'greys', name: 'Greys', group: 'Neutrals', colors: ['#000000', '#262626', '#404040', '#595959', '#737373', '#A3A3A3', '#D4D4D4', '#F5F5F5', '#FFFFFF'] },
    { id: 'warm', name: 'Warm', group: 'Mood', colors: ['#7C2D12', '#C2410C', '#EA580C', '#F59E0B', '#FBBF24', '#FDE68A'] },
    { id: 'cool', name: 'Cool', group: 'Mood', colors: ['#0C4A6E', '#0369A1', '#0EA5E9', '#14B8A6', '#5EEAD4', '#CCFBF1'] },
    { id: 'pastel', name: 'Pastel', group: 'Mood', colors: ['#FFD6E0', '#FFEFC2', '#D7F5DD', '#CDE7FF', '#E5DBFF', '#FFE0CC'] },
    { id: 'highlight', name: 'Highlighters', group: 'Office', colors: ['#FFE56A', '#8BF5B0', '#FFA3C7', '#9CD3FF', '#FFC27A', '#D5C2FF'] },
    { id: 'jewel', name: 'Jewel tones', group: 'Mood', colors: ['#0F5257', '#2E1760', '#7B1E3B', '#1E3A8A', '#065F46', '#92400E'] },
    { id: 'earthy', name: 'Earthy', group: 'Nature', colors: ['#3F2E1E', '#6B4F35', '#9C7A54', '#C2A878', '#7A8450', '#4B5D3A'] },
    { id: 'ocean', name: 'Ocean', group: 'Nature', colors: ['#03256C', '#2541B2', '#1768AC', '#06BEE1', '#9AE6F0', '#F0FBFD'] },
    { id: 'forest', name: 'Forest', group: 'Nature', colors: ['#14281D', '#1F4D2B', '#355E3B', '#5C8D50', '#A3C585', '#E3EFD3'] },
    { id: 'sunset', name: 'Sunset', group: 'Nature', colors: ['#2D1B4E', '#6B2D5C', '#C04B5D', '#F07C52', '#F9B45B', '#FDE4A6'] },
    { id: 'vivid', name: 'Vivid', group: 'Bold', colors: ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#00B0FF', '#D500F9'] },
    { id: 'contrast', name: 'High contrast', group: 'Accessible', colors: ['#000000', '#FFFFFF', '#0B3D91', '#FFD100', '#8B0000', '#006400'] }
  ];
  var RKEY = 'le-recent-colors';

  function hex2(n) { var s = Math.round(clamp(n, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; }
  function norm(v) {
    if (v == null) return null;
    var s = String(v).trim();
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      return '#' + h.toUpperCase();
    }
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return ('#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3])).toUpperCase();
    return null;
  }
  function rgbOf(hex) {
    var h = norm(hex) || '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function toHex(r, g, b) { return ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase(); }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn, h = 0;
    if (dd) {
      if (mx === r) h = ((g - b) / dd) % 6;
      else if (mx === g) h = (b - r) / dd + 2;
      else h = (r - g) / dd + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, mx ? dd / mx : 0, mx];
  }
  function hsv2rgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function luminance(hex) {
    return rgbOf(hex).map(function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce(function (a, c, i) { return a + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }

  function recents() {
    try { var r = JSON.parse(global.localStorage.getItem(RKEY) || '[]'); return Array.isArray(r) ? r.map(norm).filter(Boolean).slice(0, 12) : []; } catch (e) { return []; }
  }
  function remember(hex) {
    hex = norm(hex);
    if (!hex) return;
    var r = recents().filter(function (c) { return c !== hex; });
    r.unshift(hex);
    try { global.localStorage.setItem(RKEY, JSON.stringify(r.slice(0, 12))); } catch (e) {}
  }
  function docColors() {
    var seen = {}, out = [];
    function add(c) { c = norm(c); if (c && !seen[c]) { seen[c] = 1; out.push(c); } }
    (PS.S.pages || []).forEach(function (r) {
      if (r.blank && r.blank.color && norm(r.blank.color) !== '#FFFFFF') add(r.blank.color);
      ((r.scene && r.scene.layers) || []).forEach(function (l) {
        add(l.color);
        if (l.fill && l.fill.type !== 'none') add(l.fill.color);
        if (l.stroke && l.stroke.width) add(l.stroke.color);
        if (l.background) add(l.background.color);
      });
    });
    var T = PS.S.docTools || {};
    ['pageNumbers', 'watermark', 'headerFooter', 'bates'].forEach(function (k) { if (T[k]) add(T[k].color); });
    return out.slice(0, 16);
  }
  var setsCache = null;
  function colorSets() {
    if (setsCache) return setsCache;
    var list = null;
    try { if (LE.assets && typeof LE.assets.colorSets === 'function') list = LE.assets.colorSets(); } catch (e) { list = null; }
    if (!list || !list.length) return FALLBACK_SETS;
    setsCache = list.filter(function (s) { return s && s.colors && s.colors.length; });
    return setsCache;
  }

  function swatch(c, cur, label) {
    var hex = norm(c);
    var b = el('button', 'ps-sw');
    b.type = 'button';
    b.setAttribute('data-c', hex);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(hex === norm(cur)));
    b.setAttribute('aria-label', (label || 'Colour') + ' ' + hex);
    b.title = label ? label + ' · ' + hex : hex;
    b.style.setProperty('--c', hex);
    if (luminance(hex) > 0.6) b.classList.add('is-light');
    return b;
  }
  function group(title, colors, cur, labels) {
    var g = el('div', 'ps-cp-group');
    g.appendChild(el('div', 'ps-eyebrow', esc(title)));
    var row = el('div', 'ps-swatches ps-cp-sws');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', title);
    colors.forEach(function (c, i) { row.appendChild(swatch(c, cur, labels ? labels[i] : title)); });
    g.appendChild(row);
    return g;
  }

  var pop = null;

  function close() {
    if (!pop) return;
    var p = pop;
    pop = null;
    d.removeEventListener('pointerdown', p.outside, true);
    d.removeEventListener('keydown', p.key, true);
    global.removeEventListener('resize', p.place);
    if (p.changed) remember(p.hex);
    if (p.anchor) p.anchor.setAttribute('aria-expanded', 'false');
    p.node.classList.add('is-out');
    setTimeout(function () { if (p.node.parentNode) p.node.parentNode.removeChild(p.node); }, 140);
    if (p.opts.onClose) p.opts.onClose(p.hex);
    if (p.anchor && d.body.contains(p.anchor) && p.returnFocus) { try { p.anchor.focus({ preventScroll: true }); } catch (e) {} }
  }

  function open(anchor, opts) {
    opts = opts || {};
    if (pop && pop.anchor === anchor) { close(); return null; }
    close();
    var start = norm(opts.value) || '#17131F';
    var hsv = rgb2hsv.apply(null, rgbOf(start));
    var st = { anchor: anchor, opts: opts, hex: start, changed: false, returnFocus: false };
    pop = st;

    var node = el('div', 'ps-cp');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', opts.title || 'Choose a colour');
    st.node = node;
    var head = el('div', 'ps-cp-head');
    head.appendChild(el('strong', null, esc(opts.title || 'Colour')));
    var x = el('button', 'ps-ib ps-cp-x', icon('close'));
    x.type = 'button';
    x.setAttribute('aria-label', 'Close colour picker');
    x.addEventListener('click', function () { st.returnFocus = true; close(); });
    head.appendChild(x);
    node.appendChild(head);

    var tabs = el('div', 'seg ps-seg ps-cp-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = '<button type="button" role="tab" data-v="solid" aria-pressed="true" aria-selected="true">Solid</button><button type="button" role="tab" data-v="palettes" aria-pressed="false" aria-selected="false">Palettes</button>';
    node.appendChild(tabs);

    var solid = el('div', 'ps-cp-solid');
    var sv = el('div', 'ps-cp-sv');
    sv.tabIndex = 0;
    sv.setAttribute('role', 'slider');
    sv.setAttribute('aria-label', 'Saturation and brightness');
    var svT = el('i', 'ps-cp-thumb');
    sv.appendChild(svT);
    solid.appendChild(sv);

    var bar = el('div', 'ps-cp-bar');
    var drop = null;
    if (global.EyeDropper) {
      drop = el('button', 'ps-ib ps-cp-drop', icon('dropper'));
      drop.type = 'button';
      drop.title = 'Pick a colour from the screen';
      drop.setAttribute('aria-label', 'Pick a colour from the screen');
      drop.addEventListener('click', function () {
        try {
          new global.EyeDropper().open().then(function (r) { if (r && r.sRGBHex) setHex(r.sRGBHex, true); }).catch(function () {});
        } catch (e) {}
      });
      bar.appendChild(drop);
    }
    var hue = el('div', 'ps-cp-hue');
    hue.tabIndex = 0;
    hue.setAttribute('role', 'slider');
    hue.setAttribute('aria-label', 'Hue');
    hue.setAttribute('aria-valuemin', '0');
    hue.setAttribute('aria-valuemax', '360');
    var hueT = el('i', 'ps-cp-thumb');
    hue.appendChild(hueT);
    bar.appendChild(hue);
    var prev = el('span', 'ps-cp-prev');
    prev.innerHTML = '<i class="ps-cp-was"></i><i class="ps-cp-now"></i>';
    $('.ps-cp-was', prev).style.background = start;
    $('.ps-cp-was', prev).title = 'Original ' + start;
    bar.appendChild(prev);
    solid.appendChild(bar);

    var ins = el('div', 'ps-cp-ins');
    function numIn(label, max) {
      var w = el('label', 'ps-cp-in');
      var i = d.createElement('input');
      i.className = 'input';
      i.type = max ? 'number' : 'text';
      if (max) { i.min = 0; i.max = max; i.inputMode = 'numeric'; }
      else { i.spellcheck = false; i.autocomplete = 'off'; i.maxLength = 7; }
      i.setAttribute('aria-label', label);
      w.appendChild(i);
      w.appendChild(el('span', null, esc(label === 'Hex colour' ? 'Hex' : label.charAt(0))));
      ins.appendChild(w);
      return i;
    }
    var hexIn = numIn('Hex colour');
    hexIn.parentNode.classList.add('is-hex');
    var rIn = numIn('Red', 255), gIn = numIn('Green', 255), bIn = numIn('Blue', 255);
    solid.appendChild(ins);

    var groups = el('div', 'ps-cp-groups');
    if (opts.named && opts.named.length) groups.appendChild(group(opts.namedTitle || 'Classic inks', opts.named.map(function (n) { return n[0]; }), start, opts.named.map(function (n) { return n[1]; })));
    var dc = docColors();
    if (dc.length) groups.appendChild(group('Document colours', dc, start));
    var rc = recents();
    if (rc.length) groups.appendChild(group('Recent', rc, start));
    groups.appendChild(group('Brand kit', BRAND, start));
    solid.appendChild(groups);
    node.appendChild(solid);

    var pal = el('div', 'ps-cp-pal');
    pal.hidden = true;
    var q = d.createElement('input');
    q.type = 'search';
    q.className = 'input ps-search';
    q.placeholder = 'Search colour sets';
    q.setAttribute('aria-label', 'Search colour sets');
    pal.appendChild(q);
    var list = el('div', 'ps-cp-sets');
    pal.appendChild(list);
    node.appendChild(pal);
    function renderSets() {
      var term = q.value.trim().toLowerCase();
      list.innerHTML = '';
      var n = 0;
      colorSets().forEach(function (set) {
        var hay = ((set.name || '') + ' ' + (set.group || '') + ' ' + (set.id || '')).toLowerCase();
        if (term && hay.indexOf(term) < 0) return;
        n++;
        var row = el('div', 'ps-cp-set');
        row.appendChild(el('div', 'ps-cp-set-h', '<strong>' + esc(set.name || set.id) + '</strong>' + (set.group ? '<small>' + esc(set.group) + '</small>' : '')));
        var sw = el('div', 'ps-cp-strip');
        set.colors.slice(0, 12).forEach(function (c) { if (norm(c)) sw.appendChild(swatch(c, st.hex, set.name)); });
        row.appendChild(sw);
        list.appendChild(row);
      });
      if (!n) list.appendChild(el('p', 'ps-note', 'No colour sets match. Try “blue”, “pastel” or “office”.'));
    }
    q.addEventListener('input', renderSets);

    if (opts.allowNone) {
      var none = el('button', 'btn btn-sm btn-ghost ps-cp-none', 'No colour');
      none.type = 'button';
      none.addEventListener('click', function () { st.changed = false; if (opts.onInput) opts.onInput(null); st.returnFocus = true; close(); });
      node.appendChild(none);
    }

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      $$('[data-v]', tabs).forEach(function (t) { var on = t === b; t.setAttribute('aria-pressed', String(on)); t.setAttribute('aria-selected', String(on)); });
      var p = b.getAttribute('data-v') === 'palettes';
      solid.hidden = p;
      pal.hidden = !p;
      if (p && !list.childNodes.length) renderSets();
      place();
    });
    node.addEventListener('click', function (e) {
      var b = e.target.closest('.ps-sw[data-c]');
      if (b) setHex(b.getAttribute('data-c'), true);
    });

    var raf = 0;
    function emit() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; if (opts.onInput) opts.onInput(st.hex); });
    }
    function paint(skip) {
      var rgb = hsv2rgb(hsv[0] % 360, hsv[1], hsv[2]);
      st.hex = toHex(rgb[0], rgb[1], rgb[2]);
      sv.style.setProperty('--h', String(Math.round(hsv[0])));
      svT.style.left = (hsv[1] * 100) + '%';
      svT.style.top = ((1 - hsv[2]) * 100) + '%';
      svT.style.background = st.hex;
      hueT.style.left = (hsv[0] / 360 * 100) + '%';
      sv.setAttribute('aria-valuetext', st.hex);
      hue.setAttribute('aria-valuenow', String(Math.round(hsv[0])));
      $('.ps-cp-now', prev).style.background = st.hex;
      if (skip !== 'hex') hexIn.value = st.hex;
      if (skip !== 'rgb') { rIn.value = Math.round(rgb[0]); gIn.value = Math.round(rgb[1]); bIn.value = Math.round(rgb[2]); }
      $$('.ps-sw[data-c]', node).forEach(function (s) { s.setAttribute('aria-checked', String(s.getAttribute('data-c') === st.hex)); });
    }
    function setHex(v, fire, skip) {
      var h = norm(v);
      if (!h) return;
      var nh = rgb2hsv.apply(null, rgbOf(h));
      if (nh[1] === 0 || nh[2] === 0) nh[0] = hsv[0];
      hsv = nh;
      paint(skip);
      if (fire) { st.changed = true; emit(); }
    }
    function drag(target, fn) {
      target.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        try { target.setPointerCapture(e.pointerId); } catch (err) {}
        target.focus({ preventScroll: true });
        fn(e);
        function mv(ev) { fn(ev); }
        function up() { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); }
        target.addEventListener('pointermove', mv);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      });
    }
    drag(sv, function (e) {
      var r = sv.getBoundingClientRect();
      hsv[1] = clamp((e.clientX - r.left) / r.width, 0, 1);
      hsv[2] = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      paint(); st.changed = true; emit();
    });
    drag(hue, function (e) {
      var r = hue.getBoundingClientRect();
      hsv[0] = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360;
      paint(); st.changed = true; emit();
    });
    sv.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 0.1 : 0.02, hit = true;
      if (e.key === 'ArrowLeft') hsv[1] = clamp(hsv[1] - step, 0, 1);
      else if (e.key === 'ArrowRight') hsv[1] = clamp(hsv[1] + step, 0, 1);
      else if (e.key === 'ArrowUp') hsv[2] = clamp(hsv[2] + step, 0, 1);
      else if (e.key === 'ArrowDown') hsv[2] = clamp(hsv[2] - step, 0, 1);
      else hit = false;
      if (hit) { e.preventDefault(); paint(); st.changed = true; emit(); }
    });
    hue.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 15 : 3;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') hsv[0] = (hsv[0] - step + 360) % 360;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') hsv[0] = (hsv[0] + step) % 360;
      else return;
      e.preventDefault(); paint(); st.changed = true; emit();
    });
    hexIn.addEventListener('input', function () { if (norm(hexIn.value) && hexIn.value.replace('#', '').length >= 6) setHex(hexIn.value, true, 'hex'); });
    hexIn.addEventListener('change', function () { setHex(hexIn.value, true); });
    [rIn, gIn, bIn].forEach(function (i) {
      i.addEventListener('input', function () { setHex(toHex(+rIn.value || 0, +gIn.value || 0, +bIn.value || 0), true, 'rgb'); });
    });

    st.outside = function (e) {
      if (node.contains(e.target) || (anchor && anchor.contains(e.target))) return;
      close();
    };
    st.key = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); st.returnFocus = true; close(); }
    };
    function place() {
      if (!node.parentNode) return;
      if (PS.isPhone()) { node.classList.add('is-sheet'); node.style.left = node.style.top = ''; return; }
      node.classList.remove('is-sheet');
      var r = anchor ? anchor.getBoundingClientRect() : { left: global.innerWidth / 2, right: global.innerWidth / 2, top: 80, bottom: 80 };
      var w = node.offsetWidth, h = node.offsetHeight, vw = global.innerWidth, vh = global.innerHeight;
      var left = clamp(r.left + (r.right - r.left) / 2 - w / 2, 8, vw - w - 8);
      var top = r.bottom + 8;
      if (top + h > vh - 8) top = r.top - h - 8;
      if (top < 8) {
        top = clamp(r.top + (r.bottom - r.top) / 2 - h / 2, 8, Math.max(8, vh - h - 8));
        left = r.right + 8 + w < vw ? r.right + 8 : clamp(r.left - w - 8, 8, vw - w - 8);
      }
      node.style.left = Math.round(left) + 'px';
      node.style.top = Math.round(top) + 'px';
    }
    st.place = place;

    d.body.appendChild(node);
    paint();
    place();
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    d.addEventListener('pointerdown', st.outside, true);
    d.addEventListener('keydown', st.key, true);
    global.addEventListener('resize', place);
    requestAnimationFrame(function () { node.classList.add('is-in'); if (!PS.isPhone()) sv.focus({ preventScroll: true }); });
    return { close: close, set: function (v) { setHex(v, false); } };
  }

  function button(label, value, onInput, opts) {
    opts = opts || {};
    var b = el('button', 'ps-cbtn' + (opts.cls ? ' ' + opts.cls : ''));
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    var dot = el('span', 'ps-cbtn-dot');
    b.appendChild(dot);
    if (opts.text) b.appendChild(el('span', 'ps-cbtn-t', esc(opts.text)));
    var cur = norm(value);
    function show(v) { cur = v; dot.style.background = v || 'transparent'; dot.classList.toggle('is-none', !v); }
    show(cur);
    b.addEventListener('click', function () {
      open(b, {
        value: cur || '#17131F', title: label, allowNone: opts.allowNone, named: opts.named, namedTitle: opts.namedTitle,
        onInput: function (v) { show(v); onInput(v); }
      });
    });
    b.setValue = function (v) { show(norm(v)); };
    return b;
  }

  PS.color = { open: open, close: close, button: button, norm: norm, recents: recents, remember: remember, docColors: docColors, colorSets: colorSets, luminance: luminance, rgbOf: rgbOf };
})(window);
