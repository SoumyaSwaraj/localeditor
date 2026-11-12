/* LocalEditor studio tools: format painter, text & photo effects, grids, QR, rulers & guides, pages. */
(function () {
  'use strict';
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var LE = window.LE;
  var U = P._u;
  var H = P._hooks = P._hooks || {};
  var CMDS = P._cmds = P._cmds || {};
  function hook(n, f) { (H[n] = H[n] || []).push(f); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function K(c) { var d = c.doc(); return Math.min(d.width, d.height) / 1080; }
  function COL() { return window.LEStudioColor; }
  function root() { var r = document.documentElement.getAttribute('data-root') || ''; if (r && r.charAt(r.length - 1) !== '/') r += '/'; return r; }

  /* ---------- Format painter ---------- */
  var COMMON = ['shadow', 'opacity', 'blend'];
  var STYLE_KEYS = {
    text: ['font', 'weight', 'italic', 'size', 'align', 'lineHeight', 'letterSpacing', 'color', 'fill', 'uppercase', 'underline', 'strike', 'stroke', 'background', 'curve'],
    shape: ['fill', 'stroke', 'radius'],
    image: ['adjust', 'filter', 'radius', 'border', 'mask'],
    svg: ['color', 'strokeWidth'],
    path: ['color', 'width', 'smoothing']
  };
  function mainColor(l) {
    if (!l) return null;
    if (l.type === 'shape') return l.fill && l.fill.type === 'solid' ? l.fill.color : l.fill && l.fill.colors ? l.fill.colors[0] : null;
    return typeof l.color === 'string' ? l.color : null;
  }
  function styleOf(l) {
    var out = { type: l.type, props: {} };
    (STYLE_KEYS[l.type] || []).concat(COMMON).forEach(function (k) { if (l[k] !== undefined) out.props[k] = JSON.parse(JSON.stringify(l[k])); });
    out.color = mainColor(l);
    return out;
  }
  function stylePatch(style, target) {
    var p = {};
    if (style.type === target.type) {
      Object.keys(style.props).forEach(function (k) { p[k] = JSON.parse(JSON.stringify(style.props[k])); });
      if (target.type === 'text' && style.props.size && target.size) p.h = target.h * (style.props.size / target.size);
      if (target.type === 'svg' && /^withicons:/.test(target.assetId || '')) delete p.color;
    } else {
      COMMON.forEach(function (k) { if (style.props[k] !== undefined) p[k] = JSON.parse(JSON.stringify(style.props[k])); });
      if (style.color) {
        if (target.type === 'shape') p.fill = { type: 'solid', color: style.color };
        else if (target.type === 'text' || target.type === 'path' || (target.type === 'svg' && /^(lucide|phosphor):/.test(target.assetId || ''))) p.color = style.color;
      }
      if (style.props.radius != null && (target.type === 'image' || target.type === 'shape')) p.radius = style.props.radius;
    }
    return p;
  }
  function copyStyle(c) {
    var l = c.one();
    if (!l) { c.toast('Select one item to copy its style.'); return; }
    if (l.type === 'group') { c.toast('Pick an item inside the group to copy its style.'); return; }
    c.S.painter = styleOf(l);
    c.S.painterSrc = l.id;
    c.S.painterArmed = true;
    c.renderToolbar();
    c.E.stage.classList.add('is-painting');
    c.toast('Style copied — click another item to paste (Esc to stop)');
  }
  function pasteStyle(c, ids) {
    var st = c.S.painter;
    if (!st) { c.toast('Copy a style first (Ctrl+Alt+C).'); return 0; }
    var n = 0;
    c.batch(function () {
      (ids || c.sel()).forEach(function (id) {
        var t = c.L(id);
        if (!t || t.type === 'group' || t.locked) return;
        c.scene.update(id, stylePatch(st, t));
        n++;
      });
    });
    if (n) c.toast('Style pasted' + (n > 1 ? ' on ' + n + ' items' : ''));
    return n;
  }
  function stopPainter(c) {
    if (!c.S.painterArmed) return false;
    c.S.painterArmed = false;
    c.E.stage.classList.remove('is-painting');
    c.renderToolbar();
    return true;
  }
  CMDS.copyStyle = function (c) { if (c.S.painterArmed) { stopPainter(c); return; } copyStyle(c); };
  CMDS.pasteStyle = function (c) { pasteStyle(c); };
  hook('select', function (c, ids) {
    if (!c.S.painterArmed || !ids || !ids.length) return;
    var src = c.S.painterSrc;
    if (ids.length === 1 && src === ids[0]) return;
    pasteStyle(c, ids);
    stopPainter(c);
  });
  hook('escape', function (c) { return stopPainter(c); });

  function textSig(l) { return [l.font, l.weight || 400, Math.round(l.size), String(l.color || '').toLowerCase(), !!l.italic].join('|'); }
  P._stylesTab = function (c, body) {
    var l = c.one();
    var s1 = c.ui.section('Format painter');
    var b1 = s1.querySelector('.sx-sec-body');
    b1.appendChild(U.note(c, 'Copy the look of one item — font, colours, effects, filters, border, shadow and corners — and paste it onto others.'));
    var row = c.h('<div class="sx-row"></div>');
    row.appendChild(U.btn(c, 'Copy style', 'brush', 'btn btn-ghost btn-sm', function () { copyStyle(c); c.renderPanel(true); }));
    var pb = U.btn(c, 'Paste to selection', 'check', 'btn btn-ghost btn-sm', function () { pasteStyle(c); });
    if (!c.S.painter || !c.sel().length) pb.disabled = true;
    row.appendChild(pb);
    b1.appendChild(row);
    if (c.S.painter) {
      var info = c.h('<div class="sx-painter-card"><span class="sx-eyebrow">Copied</span><strong></strong><small></small></div>');
      var stl = c.S.painter;
      info.querySelector('strong').textContent = ({ text: 'Text style', shape: 'Shape style', image: 'Photo look', svg: 'Graphic style', path: 'Drawing style' })[stl.type] || 'Style';
      info.querySelector('small').textContent = Object.keys(stl.props).slice(0, 8).join(' · ');
      if (stl.type === 'text' && stl.props.font) { info.querySelector('strong').style.fontFamily = c.fontCss(stl.props.font); info.querySelector('strong').style.fontWeight = stl.props.weight || 400; }
      b1.appendChild(info);
    }
    body.appendChild(s1);
    var groups = {}, order = [];
    c.syncProject();
    var p = c.S.project;
    p.pages.forEach(function (pg, i) {
      var d = i === p.activePage ? c.doc() : pg;
      d.layers.forEach(function (t) {
        if (t.type !== 'text') return;
        var k = textSig(t);
        if (!groups[k]) { groups[k] = { sig: k, sample: t, count: 0, pages: {} }; order.push(k); }
        groups[k].count++;
        groups[k].pages[i] = 1;
      });
    });
    var s2 = c.ui.section('Text styles in this design', '<span class="sx-count">' + order.length + '</span>');
    var b2 = s2.querySelector('.sx-sec-body');
    if (!order.length) b2.appendChild(U.note(c, 'Add some text to see its styles here.'));
    var src = l && l.type === 'text' ? l : null;
    if (order.length) b2.appendChild(U.note(c, src ? 'Apply the selected text’s style to every text that looks like one of these.' : 'Select a text to use its style, or copy a style first.', 'is-muted'));
    order.sort(function (a, b) { return groups[b].count - groups[a].count; }).forEach(function (k) {
      var g = groups[k], t = g.sample;
      var card = c.h('<div class="sx-card sx-style-row"><span class="sx-style-sample"></span><small>' + c.esc(t.font) + ' · ' + Math.round(t.size) + 'px · ' + g.count + ' text' + (g.count === 1 ? '' : 's') + (Object.keys(g.pages).length > 1 ? ' · ' + Object.keys(g.pages).length + ' pages' : '') + '</small><div class="sx-row"></div></div>');
      var smp = card.querySelector('.sx-style-sample');
      smp.textContent = String(t.text || '').split('\n')[0].slice(0, 24) || 'Text';
      smp.style.fontFamily = c.fontCss(t.font);
      smp.style.fontWeight = t.weight || 400;
      smp.style.fontStyle = t.italic ? 'italic' : 'normal';
      smp.style.color = t.color || '#17131f';
      var rowc = card.querySelector('.sx-row');
      var useStyle = src ? styleOf(src) : c.S.painter && c.S.painter.type === 'text' ? c.S.painter : null;
      var ab = U.btn(c, 'Apply to all ' + g.count, 'brush', 'btn btn-gold btn-sm', function () {
        if (!useStyle) return;
        var n = COL().applyAcross(c, function (d) {
          var x = JSON.parse(JSON.stringify(d)), touched = false;
          x.layers.forEach(function (tl) {
            if (tl.type !== 'text' || textSig(tl) !== k || (src && tl.id === src.id)) return;
            var patch = stylePatch(useStyle, tl);
            Object.keys(patch).forEach(function (kk) { tl[kk] = patch[kk]; });
            touched = true;
          });
          return touched ? x : null;
        }, 'style');
        c.toast(n ? 'Style applied on ' + n + ' page' + (n === 1 ? '' : 's') + ' — one undo reverts it' : 'Nothing to change');
        c.renderPanel(true);
      });
      if (!useStyle || (src && textSig(src) === k && g.count === 1)) ab.disabled = true;
      rowc.appendChild(ab);
      rowc.appendChild(U.btn(c, 'Select on page', 'position', 'btn btn-ghost btn-sm', function () {
        var ids = c.scene.layers().filter(function (tl) { return tl.type === 'text' && textSig(tl) === k; }).map(function (tl) { return tl.id; });
        if (ids.length) c.scene.select(ids); else c.toast('None on this page');
      }));
      b2.appendChild(card);
    });
    body.appendChild(s2);
  };

  /* ---------- Text effect presets ---------- */
  var TFX = [
    ['none', 'None'], ['shadow', 'Shadow'], ['lift', 'Lift'], ['hollow', 'Hollow'], ['splice', 'Splice'],
    ['echo', 'Echo'], ['outline', 'Outline'], ['background', 'Background'], ['neon', 'Neon'], ['glitch', 'Glitch']
  ];
  function baseTextColor(c, l) {
    var st = c.studio().tfx = c.studio().tfx || {};
    var mem = st[l.id];
    var col = l.color;
    if (mem && mem.base) col = mem.base;
    var pp = COL().parse(col);
    if (!pp || pp.a === 0) col = (l.stroke && l.stroke.color) || '#17131f';
    return COL().hex6(col);
  }
  function textFx(c, l, id, o) {
    var C = COL();
    var s = l.size || 64;
    var k = o.k == null ? 1 : o.k;
    var base = o.base;
    var accent = o.color || (id === 'neon' ? base : id === 'background' ? '#f2d594' : id === 'splice' ? '#e0668e' : id === 'glitch' ? '#00e5ff' : '#17131f');
    var p = { color: base, shadow: null, stroke: null, background: null };
    if (id === 'shadow') p.shadow = { color: C.hex(Object.assign(C.parse(accent), { a: 0.45 })), blur: 0.06 * s * k, x: 0.06 * s * k, y: 0.06 * s * k };
    else if (id === 'lift') p.shadow = { color: 'rgba(0,0,0,' + (0.18 + 0.2 * k).toFixed(2) + ')', blur: 0.35 * s * k, x: 0, y: 0.1 * s * k };
    else if (id === 'hollow') { p.color = 'rgba(0,0,0,0)'; p.stroke = { width: Math.max(1, 0.03 * s * k), color: base }; }
    else if (id === 'splice') { p.color = 'rgba(0,0,0,0)'; p.stroke = { width: Math.max(1, 0.025 * s * k), color: base }; p.shadow = { color: accent, blur: 0, x: 0.06 * s * k, y: 0.06 * s * k }; }
    else if (id === 'echo') p.shadow = { color: C.hex(Object.assign(C.parse(accent === '#17131f' ? base : accent), { a: 0.5 })), blur: 0, x: 0.07 * s * k, y: 0.07 * s * k };
    else if (id === 'outline') p.stroke = { width: Math.max(1, 0.035 * s * k), color: accent === base ? (C.lum(base) > 0.4 ? '#17131f' : '#ffffff') : accent };
    else if (id === 'background') p.background = { color: accent, radius: 0.18 * s, padding: 0.22 * s * k };
    else if (id === 'neon') { p.color = C.mix(base, '#ffffff', 0.72); p.shadow = { color: accent, blur: 0.45 * s * k, x: 0, y: 0 }; }
    else if (id === 'glitch') { p.stroke = { width: Math.max(1, 0.012 * s * k), color: '#ff2bd6' }; p.shadow = { color: accent, blur: 0, x: -0.045 * s * k, y: 0.02 * s * k }; }
    return p;
  }
  function textPresets(c, body, l) {
    var st = c.studio().tfx = c.studio().tfx || {};
    var mem = st[l.id] || { id: 'none', k: 1, color: null };
    var s = c.ui.section('Text effects');
    var sb = s.querySelector('.sx-sec-body');
    var g = U.grid('sx-grid-5 sx-tfx-grid');
    var base = baseTextColor(c, l);
    TFX.forEach(function (fx) {
      var b = c.h('<button type="button" class="sx-tfx" aria-pressed="' + (mem.id === fx[0]) + '"><span class="sx-tfx-art sx-tfx-' + fx[0] + '">Ag</span><small>' + fx[1] + '</small></button>');
      b.onclick = function () {
        mem = { id: fx[0], k: mem.k || 1, color: fx[0] === mem.id ? mem.color : null, base: base };
        st[l.id] = mem;
        c.patch(l.id, textFx(c, c.L(l.id), fx[0], mem));
        c.renderPanel(true);
      };
      g.appendChild(b);
    });
    sb.appendChild(g);
    if (mem.id && mem.id !== 'none') {
      sb.appendChild(c.ui.slider({ label: mem.id === 'background' ? 'Spread' : mem.id === 'hollow' || mem.id === 'outline' ? 'Thickness' : 'Intensity', min: 10, max: 300, value: Math.round((mem.k || 1) * 100), reset: 100, fmt: function (v) { return v + '%'; }, onInput: function (v, key) { mem.k = v / 100; c.patch(l.id, textFx(c, c.L(l.id), mem.id, mem), key); } }));
      if (['shadow', 'splice', 'echo', 'outline', 'background', 'neon', 'glitch'].indexOf(mem.id) >= 0) {
        sb.appendChild(c.ui.swatchBtn(mem.color || textFx(c, l, mem.id, mem).shadow && textFx(c, l, mem.id, mem).shadow.color || '#17131f', 'Effect colour', function (btn) {
          c.colorPop(btn, { value: mem.color || '#17131f', title: 'Effect colour', onChange: function (v, key) { mem.color = v; btn.querySelector('i').style.background = v; c.patch(l.id, textFx(c, c.L(l.id), mem.id, mem), key); } });
        }));
      }
    }
    body.insertBefore(s, body.firstChild);
  }

  /* ---------- Photo effects (baked, original kept) ---------- */
  function fxMap(c) { var st = c.studio(); st.fx = st.fx || {}; return st.fx; }
  function duotone(src, a, b) {
    var C = COL();
    var out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    var x = out.getContext('2d');
    x.drawImage(src, 0, 0);
    var id = x.getImageData(0, 0, out.width, out.height), d = id.data;
    var A = C.parse(a), B = C.parse(b);
    for (var i = 0; i < d.length; i += 4) {
      var t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = A.r + (B.r - A.r) * t; d[i + 1] = A.g + (B.g - A.g) * t; d[i + 2] = A.b + (B.b - A.b) * t;
    }
    x.putImageData(id, 0, 0);
    return out;
  }
  function outline(src, width, color) {
    var pad = Math.ceil(width) + 2;
    var sil = document.createElement('canvas');
    sil.width = src.width; sil.height = src.height;
    var sx = sil.getContext('2d');
    sx.drawImage(src, 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = color;
    sx.fillRect(0, 0, sil.width, sil.height);
    var out = document.createElement('canvas');
    out.width = src.width + pad * 2; out.height = src.height + pad * 2;
    var x = out.getContext('2d');
    var n = clamp(Math.round(width * 1.5), 16, 48);
    [1, 0.5].forEach(function (r) {
      for (var i = 0; i < n; i++) {
        var ang = i / n * Math.PI * 2;
        x.drawImage(sil, pad + Math.cos(ang) * width * r, pad + Math.sin(ang) * width * r);
      }
    });
    x.drawImage(src, pad, pad);
    out._pad = pad;
    return out;
  }
  function blurCanvas(src, r) {
    var out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    var x = out.getContext('2d');
    if ('filter' in x) {
      x.filter = 'blur(' + r + 'px)';
      x.drawImage(src, -r, -r, src.width + r * 2, src.height + r * 2);
      x.filter = 'none';
      return out;
    }
    var f = Math.max(1, Math.round(r / 2));
    var sm = document.createElement('canvas');
    sm.width = Math.max(1, Math.round(src.width / f)); sm.height = Math.max(1, Math.round(src.height / f));
    sm.getContext('2d').drawImage(src, 0, 0, sm.width, sm.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(sm, 0, 0, out.width, out.height);
    return out;
  }
  function blurBg(src, amount, focus) {
    var r = Math.max(1, amount / 100 * Math.max(src.width, src.height) * 0.03);
    var out = blurCanvas(src, r);
    var keep = document.createElement('canvas');
    keep.width = src.width; keep.height = src.height;
    var kx = keep.getContext('2d');
    kx.drawImage(src, 0, 0);
    kx.globalCompositeOperation = 'destination-in';
    var f = clamp(focus / 100, 0.1, 1);
    kx.save();
    kx.translate(src.width / 2, src.height / 2);
    kx.scale(src.width / 2, src.height / 2);
    var g = kx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, '#000');
    g.addColorStop(clamp(f * 0.7, 0.05, 0.95), '#000');
    g.addColorStop(clamp(f, 0.1, 1), 'rgba(0,0,0,0)');
    kx.fillStyle = g;
    kx.fillRect(-1, -1, 2, 2);
    kx.restore();
    out.getContext('2d').drawImage(keep, 0, 0);
    return out;
  }
  function runFx(kind, src, o, scale) {
    if (kind === 'duotone') return duotone(src, o.a, o.b);
    if (kind === 'outline') return outline(src, Math.max(1, o.width * scale), o.color);
    return blurBg(src, o.amount, o.focus);
  }
  var FXP = {};
  function fxPreview(c, l, kind, o) {
    var map = fxMap(c);
    var origSrc = (map[l.id] && map[l.id].src) || l.src;
    var m = c.mem[origSrc];
    if (!m) return;
    var small = LE.fit(m.canvas, 640);
    var s = small.width / m.canvas.width;
    var res = runFx(kind, small, o, s * (m.canvas.width / l.w));
    var key = 'le-fx-preview-' + l.id + '-' + (FXP[l.id] ? FXP[l.id].n + 1 : 0);
    c.scene.addAsset(key, res);
    var layer = c.scene._find(l.id);
    if (!layer) return;
    if (!FXP[l.id]) FXP[l.id] = { src: layer.src, n: 0 };
    FXP[l.id].n++;
    layer.src = key;
    c.scene._scheduleImage(l.id);
    c.scene._mark();
  }
  function fxRestore(c, id) {
    var p = FXP[id];
    if (!p) return;
    var layer = c.scene._find(id);
    if (layer) { layer.src = p.src; c.scene._scheduleImage(id); c.scene._mark(); }
    delete FXP[id];
  }
  function fxCommit(c, lid, kind, o) {
    var l = c.L(lid);
    if (!l) return Promise.resolve();
    fxRestore(c, lid);
    l = c.L(lid);
    var map = fxMap(c);
    var prev = map[l.id];
    var origSrc = (prev && prev.src) || l.src;
    var m = c.mem[origSrc];
    if (!m) { c.toast('The original photo is not loaded.'); return Promise.resolve(); }
    var full = LE.fit(m.canvas, 4096);
    var s = full.width / m.canvas.width;
    var res = runFx(kind, full, o, s * (m.canvas.width / l.w));
    var keepAlpha = kind === 'outline' || /png|webp|gif/.test(m.meta.type || '');
    c.toast('Applying…');
    return LE.toBlob(res, keepAlpha ? 'image/png' : 'image/jpeg', keepAlpha ? undefined : 0.92).then(function (blob) {
      return c.ingest(new File([blob], (m.meta.name || 'photo').replace(/\.[^.]+$/, '') + '-' + kind + (keepAlpha ? '.png' : '.jpg'), { type: blob.type }));
    }).then(function (meta) {
      var cur = c.L(lid);
      if (!cur) return;
      var geo = unpad(cur, prev);
      var p = { src: meta.id };
      if (kind === 'outline') {
        var k = geo.w / full.width;
        var pad = res._pad;
        p.x = geo.x - pad * k; p.y = geo.y - pad * k; p.w = geo.w + pad * 2 * k; p.h = geo.h + pad * 2 * k; p.crop = null;
      } else if (geo !== cur) { p.x = geo.x; p.y = geo.y; p.w = geo.w; p.h = geo.h; }
      c.patch(lid, p);
      var rec = Object.assign({ src: origSrc, kind: kind }, o);
      if (kind === 'outline') { rec.pad = res._pad; rec.outW = res.width; }
      map[lid] = rec;
      c.toast(({ duotone: 'Duotone applied', outline: 'Sticker outline added', blurbg: 'Background blurred' })[kind] + ' — Reset restores the original');
      c.renderPanel(true);
    }).catch(function (err) { c.toast(err && err.message ? err.message : 'Effect failed.'); });
  }
  function unpad(l, rec) {
    if (!rec || rec.kind !== 'outline' || !rec.outW) return l;
    var s = l.w / rec.outW;
    return { x: l.x + rec.pad * s, y: l.y + rec.pad * s, w: l.w - rec.pad * 2 * s, h: l.h - rec.pad * 2 * s };
  }
  function fxReset(c, lid) {
    var map = fxMap(c);
    var rec = map[lid];
    var l = c.L(lid);
    if (!rec || !l) return;
    var geo = unpad(l, rec);
    var p = { src: rec.src };
    if (geo !== l) { p.x = geo.x; p.y = geo.y; p.w = geo.w; p.h = geo.h; }
    c.patch(lid, p);
    delete map[lid];
    c.toast('Original photo restored');
    c.renderPanel(true);
  }
  hook('panel-close', function (c) { Object.keys(FXP).forEach(function (id) { fxRestore(c, id); }); });
  function photoEffects(c, body, l) {
    var map = fxMap(c);
    var rec = map[l.id];
    var s = c.ui.section('Photo effects', rec ? '<button type="button" class="sx-link">Reset</button>' : '');
    if (rec) s.querySelector('.sx-link').onclick = function () { fxReset(c, l.id); };
    var sb = s.querySelector('.sx-sec-body');
    var kind = c.S.panelOpts.fx || (rec && rec.kind) || 'duotone';
    sb.appendChild(c.ui.seg([['duotone', 'Duotone'], ['outline', 'Sticker outline'], ['blurbg', 'Blur background']], kind, function (v) { Object.keys(FXP).forEach(function (id) { fxRestore(c, id); }); c.S.panelOpts.fx = v; c.renderPanel(true); }, 'sx-seg-sm sx-seg-fill'));
    var o = rec && rec.kind === kind ? Object.assign({}, rec) : kind === 'duotone' ? { a: '#3b2f63', b: '#f2d594' } : kind === 'outline' ? { width: 14, color: '#ffffff' } : { amount: 40, focus: 55 };
    function live() { fxPreview(c, c.L(l.id), kind, o); }
    if (kind === 'duotone') {
      var pres = [['#3b2f63', '#f2d594', 'Amethyst gold'], ['#0b1f3a', '#7ee8fa', 'Ice'], ['#5c0a0a', '#ffb4a2', 'Rose'], ['#17131f', '#e0668e', 'Pop'], ['#0f5257', '#f6efe1', 'Jade'], ['#2b2d42', '#edf2f4', 'Mono']];
      var g = c.h('<div class="sx-duo-grid"></div>');
      pres.forEach(function (pr) {
        var b = c.h('<button type="button" class="sx-duo" aria-label="' + pr[2] + ' duotone" title="' + pr[2] + '"><i></i></button>');
        b.querySelector('i').style.background = 'linear-gradient(135deg,' + pr[0] + ' 50%,' + pr[1] + ' 50%)';
        b.onclick = function () { o.a = pr[0]; o.b = pr[1]; live(); fxCommit(c, l.id, kind, o); };
        g.appendChild(b);
      });
      sb.appendChild(g);
      var r = c.h('<div class="sx-row"></div>');
      r.appendChild(c.ui.swatchBtn(o.a, 'Shadows', function (b) { c.colorPop(b, { value: o.a, alpha: false, title: 'Duotone shadows', onChange: function (v) { o.a = v; b.querySelector('i').style.background = v; live(); } }); }));
      r.appendChild(c.ui.swatchBtn(o.b, 'Highlights', function (b) { c.colorPop(b, { value: o.b, alpha: false, title: 'Duotone highlights', onChange: function (v) { o.b = v; b.querySelector('i').style.background = v; live(); } }); }));
      sb.appendChild(r);
    } else if (kind === 'outline') {
      sb.appendChild(U.note(c, 'Best on cut-outs with a transparent background — remove the background first, then add a sticker border.', 'is-muted'));
      sb.appendChild(c.ui.slider({ label: 'Thickness', min: 2, max: 60, value: o.width, reset: 14, onInput: function (v) { o.width = v; live(); } }));
      sb.appendChild(c.ui.swatchBtn(o.color, 'Outline colour', function (b) { c.colorPop(b, { value: o.color, alpha: false, title: 'Outline colour', onChange: function (v) { o.color = v; b.querySelector('i').style.background = v; live(); } }); }));
    } else {
      sb.appendChild(c.ui.slider({ label: 'Blur', min: 5, max: 100, value: o.amount, reset: 40, onInput: function (v) { o.amount = v; live(); } }));
      sb.appendChild(c.ui.slider({ label: 'Focus size', min: 15, max: 95, value: o.focus, reset: 55, fmt: function (v) { return v + '%'; }, onInput: function (v) { o.focus = v; live(); } }));
    }
    var apply = U.btn(c, rec && rec.kind === kind ? 'Update effect' : 'Apply effect', 'check', 'btn btn-gold btn-sm sx-block', function () { apply.disabled = true; fxCommit(c, l.id, kind, o); });
    sb.appendChild(apply);
    return s;
  }
  var effectsRender = P.effects && P.effects.render;
  if (effectsRender) {
    P.effects.render = function (c, body, o) {
      effectsRender(c, body, o);
      var l = c.one();
      if (!l) return;
      if (l.type === 'text') textPresets(c, body, l);
      if (l.type === 'image') { var s = photoEffects(c, body, l); var first = body.querySelector('.sx-sec'); body.insertBefore(s, first ? first.nextSibling : null); }
    };
    P.effects.eyebrow = 'Presets, shadow, outline, photo effects';
  }

  /* ---------- Photo grids & drop into frame ---------- */
  var GRIDS = [
    ['2col', 'Two columns', [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]],
    ['2row', 'Two rows', [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]],
    ['2x2', 'Four squares', [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]],
    ['3col', 'Three columns', [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]],
    ['1+2', 'Feature left', [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]]],
    ['1+3', 'Feature top', [[0, 0, 1, 0.6], [0, 0.6, 1 / 3, 0.4], [1 / 3, 0.6, 1 / 3, 0.4], [2 / 3, 0.6, 1 / 3, 0.4]]],
    ['3x3', 'Nine squares', (function () { var a = []; for (var r = 0; r < 3; r++) for (var q = 0; q < 3; q++) a.push([q / 3, r / 3, 1 / 3, 1 / 3]); return a; })()],
    ['film', 'Film strip', [[0, 0.15, 0.25, 0.7], [0.25, 0.15, 0.25, 0.7], [0.5, 0.15, 0.25, 0.7], [0.75, 0.15, 0.25, 0.7]]]
  ];
  var CELL = 'Photo cell';
  function gridArt(cells) {
    return '<svg viewBox="0 0 48 48" class="sx-grid-art" aria-hidden="true">' + cells.map(function (r) { return '<rect x="' + (2 + r[0] * 44 + 1) + '" y="' + (2 + r[1] * 44 + 1) + '" width="' + Math.max(1, r[2] * 44 - 2) + '" height="' + Math.max(1, r[3] * 44 - 2) + '" rx="2"/>'; }).join('') + '</svg>';
  }
  function addGrid(c, g) {
    if (!c.S.project) c.newDesign(1080, 1080, 'Untitled design');
    var d = c.doc();
    var gap = Math.round(Math.min(d.width, d.height) * 0.015);
    var list = g[2].map(function (r, i) {
      return { type: 'shape', shape: 'rect', name: CELL, fill: { type: 'solid', color: i % 2 ? '#e4e0ec' : '#ebe8f1' }, stroke: { width: 0, color: '#17131f' }, radius: 0,
        x: gap + r[0] * (d.width - gap) , y: gap + r[1] * (d.height - gap), w: r[2] * (d.width - gap) - gap, h: r[3] * (d.height - gap) - gap };
    });
    c.addLayers(list, { group: false });
    c.toast('Drag photos onto the grid cells — or use “Fill with uploads”');
  }
  function isCell(l) { return l && ((l.type === 'shape' && l.name === CELL) || (l.type === 'image' && (l.name === CELL || (l.mask && l.mask !== 'none')))); }
  function hitCell(c, at) {
    var ls = c.scene.layers();
    for (var i = ls.length - 1; i >= 0; i--) {
      var l = ls[i];
      if (l.visible === false || l.locked) continue;
      if (at.x >= l.x && at.x <= l.x + l.w && at.y >= l.y && at.y <= l.y + l.h) return isCell(l) ? l : null;
    }
    return null;
  }
  function fillCell(c, cell, assetId) {
    var m = c.mem[assetId];
    if (!m) return;
    var crop = c.coverCrop(m.canvas.width, m.canvas.height, null, cell.w, cell.h, null);
    if (cell.type === 'image') { c.patch(cell.id, { src: assetId, crop: crop }); return cell.id; }
    var id;
    c.batch(function () {
      id = c.scene.add({ type: 'image', src: assetId, name: CELL, x: cell.x, y: cell.y, w: cell.w, h: cell.h, crop: crop, radius: cell.radius || 0, rotation: cell.rotation || 0, shadow: cell.shadow || null });
      var all = c.scene.layers().map(function (x) { return x.id; });
      var target = all.indexOf(cell.id);
      c.scene.remove([cell.id]);
      var now = c.scene.layers().map(function (x) { return x.id; });
      var steps = now.length - 1 - target;
      for (var s = 0; s < steps; s++) c.scene.order(id, 'backward');
    });
    return id;
  }
  hook('drop', function (c, d) {
    if (!d.asset && !(d.files && d.files.length)) return false;
    var cell = hitCell(c, d.at);
    if (!cell) return false;
    if (d.asset && c.mem[d.asset]) { fillCell(c, cell, d.asset); c.toast('Photo placed in frame'); return true; }
    var f = d.files.filter(function (x) { return /^image\//.test(x.type); })[0];
    if (!f) return false;
    c.ingest(f).then(function (meta) { fillCell(c, cell, meta.id); c.toast('Photo placed in frame'); }).catch(function (err) { c.toast(err.message || 'Could not read that photo.'); });
    return true;
  });
  P._grids = function (c, host) {
    var s = U.sec(c, host, 'Photo grids');
    var g = U.grid('sx-grid-4');
    GRIDS.forEach(function (gr) { g.appendChild(U.tile(c, gridArt(gr[2]), gr[1] + ' grid', function () { addGrid(c, gr); })); });
    s.appendChild(g);
    var row = c.h('<div class="sx-row"></div>');
    row.appendChild(U.btn(c, 'Fill with uploads', 'image', 'btn btn-ghost btn-sm', function () {
      if (!c.S.project) return;
      var cells = c.scene.layers().filter(function (l) { return l.type === 'shape' && l.name === CELL; });
      var ids = Object.keys(c.S.project.assets || {}).filter(function (id) { return c.mem[id] && !/^background-/.test((c.S.project.assets[id] || {}).name || ''); });
      if (!cells.length) { c.toast('Add a grid first.'); return; }
      if (!ids.length) { c.toast('Upload some photos first.'); c.pickFiles('tray'); return; }
      cells.forEach(function (cell, i) { fillCell(c, cell, ids[i % ids.length]); });
    }));
    s.appendChild(row);
    s.appendChild(U.note(c, 'Drag a photo from Uploads (or from your computer) onto any cell or framed photo to drop it in.', 'is-muted'));
  };

  /* ---------- QR code ---------- */
  var qrReady = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrReady) qrReady = LE.lazy(root() + 'assets/vendor/qrcode.js').then(function () { if (!window.qrcode) throw new Error('QR maker unavailable'); return window.qrcode; });
    return qrReady;
  }
  function qrSvg(text, fg, bg, ec) {
    var q = window.qrcode;
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    var qr = q(0, ec || 'M');
    qr.addData(text || ' ', 'Byte');
    qr.make();
    var n = qr.getModuleCount(), m = 4, size = n + m * 2;
    var d = '';
    for (var r = 0; r < n; r++) {
      var run = -1;
      for (var col = 0; col <= n; col++) {
        var dark = col < n && qr.isDark(r, col);
        if (dark && run < 0) run = col;
        if (!dark && run >= 0) { d += 'M' + (run + m) + ' ' + (r + m) + 'h' + (col - run) + 'v1h-' + (col - run) + 'z'; run = -1; }
      }
    }
    var C = COL();
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges">' + (bg ? '<rect width="' + size + '" height="' + size + '" fill="' + C.hex6(bg) + '"/>' : '') + '<path d="' + d + '" fill="' + C.hex6(fg) + '"/></svg>';
  }
  function qrMap(c) { var st = c.studio(); st.qr = st.qr || {}; return st.qr; }
  function qrModal(c, lid) {
    var map = lid ? qrMap(c) : {};
    var cur = (lid && map[lid]) || { text: 'https://', fg: '#17131f', bg: '#ffffff', ec: 'M' };
    var body = c.openModal(lid ? 'Edit <em>QR code</em>' : 'Add a <em>QR code</em>', '<div class="sx-qr"><div class="sx-qr-prev" aria-live="polite"></div><div class="sx-qr-form"></div></div>');
    var prev = body.querySelector('.sx-qr-prev'), form = body.querySelector('.sx-qr-form');
    var ta = c.h('<label class="sx-field"><span>Link or text</span><textarea class="sx-input" rows="3" maxlength="1200" spellcheck="false"></textarea></label>');
    ta.querySelector('textarea').value = cur.text;
    form.appendChild(ta);
    var cols = c.h('<div class="sx-row"></div>');
    var fgB = c.ui.swatchBtn(cur.fg, 'Code colour', function (b) { c.colorPop(b, { value: cur.fg, alpha: false, title: 'Code colour', onChange: function (v) { cur.fg = v; b.querySelector('i').style.background = v; draw(); } }); });
    var bgB = c.ui.swatchBtn(cur.bg || 'transparent', 'Background', function (b) { c.colorPop(b, { value: cur.bg || '#ffffff', alpha: false, none: 'null', title: 'QR background', onChange: function (v) { cur.bg = v && typeof v === 'string' ? v : null; b.querySelector('i').style.background = cur.bg || 'transparent'; draw(); } }); });
    cols.appendChild(fgB); cols.appendChild(bgB);
    form.appendChild(cols);
    form.appendChild(c.ui.seg([['L', 'Low'], ['M', 'Medium'], ['Q', 'High'], ['H', 'Max']], cur.ec, function (v) { cur.ec = v; draw(); }, 'sx-seg-sm sx-seg-fill'));
    form.appendChild(U.note(c, 'Higher error correction survives logos and print wear but makes a denser code. Made on this device — nothing is sent anywhere.', 'is-muted'));
    var warn = c.h('<p class="sx-note is-warn" hidden></p>');
    form.appendChild(warn);
    var go = c.h('<button type="button" class="btn btn-gold sx-block">' + c.ic('check') + '<span>' + (lid ? 'Update QR code' : 'Add to design') + '</span></button>');
    form.appendChild(go);
    var markup = '';
    function draw() {
      cur.text = ta.querySelector('textarea').value;
      try {
        markup = qrSvg(cur.text, cur.fg, cur.bg, cur.ec);
        prev.innerHTML = markup;
        var C = COL();
        var lc = cur.bg ? Math.abs(C.lum(cur.fg) - C.lum(cur.bg)) : 1;
        warn.hidden = lc > 0.35;
        warn.textContent = 'Low contrast between code and background — scanners may struggle.';
        go.disabled = false;
      } catch (e) { prev.innerHTML = ''; markup = ''; warn.hidden = false; warn.textContent = 'That is too long for a QR code — shorten it.'; go.disabled = true; }
    }
    ta.querySelector('textarea').addEventListener('input', c.debounce(draw, 120));
    loadQr().then(draw).catch(function () { prev.textContent = 'QR maker is not available offline yet.'; go.disabled = true; });
    go.onclick = function () {
      if (!markup) return;
      var clean = LE.project.sanitizeSvg ? LE.project.sanitizeSvg(markup) || markup : markup;
      if (lid && c.L(lid)) { c.patch(lid, { svg: clean, name: 'QR · ' + cur.text.slice(0, 30) }); qrMap(c)[lid] = Object.assign({}, cur); }
      else {
        var id = c.addSvg('qr:code', null, { markup: clean, name: 'QR · ' + cur.text.slice(0, 30), noRecent: true });
        if (id) qrMap(c)[id] = Object.assign({}, cur);
      }
      c.closeModal();
      c.markDirty();
    };
  }
  CMDS.addQr = function (c) { qrModal(c, null); };
  CMDS.editQr = function (c) { var l = c.one(); if (l) qrModal(c, l.id); };
  var elementsRender = P.elements && P.elements.render;
  if (elementsRender) {
    P.elements.render = function (c, body, o) {
      elementsRender(c, body, o);
      var host = body.querySelector('.sx-el-host');
      if (!host) return;
      var mo = new MutationObserver(function () { decorate(); });
      function decorate() {
        var t = c.S.panelOpts.tab || 'all';
        if (c.S.panelOpts.q || t !== 'all' || host.querySelector('.sx-extra')) return;
        var s = c.h('<div class="sx-extra"></div>');
        var b = U.sec(c, s, 'Quick add');
        var g = U.grid('sx-grid-4');
        g.appendChild(U.tile(c, c.ic('qr'), 'QR code', function () { qrModal(c, null); }));
        GRIDS.slice(0, 3).forEach(function (gr) { g.appendChild(U.tile(c, gridArt(gr[2]), gr[1] + ' photo grid', function () { addGrid(c, gr); })); });
        b.appendChild(g);
        host.insertBefore(s, host.children[1] || null);
      }
      decorate();
      mo.observe(host, { childList: true });
    };
  }

  /* ---------- Rulers, guides, grid & snapping ---------- */
  var OV = null;
  function ovState(c) {
    var s = c.S.ov;
    if (!s) s = c.S.ov = Object.assign({ rulers: false, grid: false, gridSize: 40, snap: true, snapObjects: true, snapGuides: true, snapGrid: false }, c.lsGet('le-studio-ov', {}));
    return s;
  }
  function saveOv(c) { c.lsSet('le-studio-ov', c.S.ov); }
  function guides(c) { var st = c.studio(); st.guides = st.guides || { x: [], y: [] }; return st.guides; }
  function pageBox(c) {
    var sr = c.E.stage.getBoundingClientRect(), er = c.E.sceneEl.getBoundingClientRect();
    var v = c.S.view;
    return { left: er.left - sr.left + v.panX, top: er.top - sr.top + v.panY, z: v.zoom, offX: er.left - sr.left, offY: er.top - sr.top };
  }
  function ensureOv(c) {
    if (OV) return OV;
    var el = c.h('<div class="sx-ov" aria-hidden="true"><div class="sx-ov-grid"></div><div class="sx-ov-guides"></div><canvas class="sx-ruler sx-ruler-x"></canvas><canvas class="sx-ruler sx-ruler-y"></canvas><span class="sx-ruler-corner"></span></div>');
    c.E.stage.appendChild(el);
    OV = { el: el, grid: el.querySelector('.sx-ov-grid'), guides: el.querySelector('.sx-ov-guides'), rx: el.querySelector('.sx-ruler-x'), ry: el.querySelector('.sx-ruler-y') };
    rulerDrag(c, OV.rx, 'y');
    rulerDrag(c, OV.ry, 'x');
    return OV;
  }
  function niceStep(z) {
    var target = 80 / z;
    var p = Math.pow(10, Math.floor(Math.log10(target)));
    return [1, 2, 5, 10].map(function (m) { return m * p; }).filter(function (s) { return s >= target; })[0] || 10 * p;
  }
  function drawRuler(c, cv, axis, pb) {
    var w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) return;
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
    var x = cv.getContext('2d');
    x.scale(dpr, dpr);
    var cs = getComputedStyle(c.E.stage);
    var ink = cs.getPropertyValue('--sx-ruler-ink').trim() || '#6b6478';
    x.clearRect(0, 0, w, hgt);
    x.fillStyle = cs.getPropertyValue('--sx-ruler-bg').trim() || 'rgba(255,255,255,.92)';
    x.fillRect(0, 0, w, hgt);
    var d = c.doc();
    var origin = axis === 'x' ? pb.left : pb.top;
    var len = axis === 'x' ? w : hgt;
    var z = pb.z;
    x.fillStyle = cs.getPropertyValue('--sx-ruler-page').trim() || 'rgba(116,87,240,.10)';
    if (axis === 'x') x.fillRect(origin, 0, d.width * z, hgt); else x.fillRect(0, origin, w, d.height * z);
    var step = niceStep(z);
    var start = Math.floor(-origin / z / step) * step;
    x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = 1;
    x.font = '10px system-ui, sans-serif';
    x.beginPath();
    for (var v = start; v * z + origin < len; v += step / 5) {
      var px = Math.round(v * z + origin) + 0.5;
      var major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      var t = major ? 10 : 4;
      if (axis === 'x') { x.moveTo(px, hgt); x.lineTo(px, hgt - t); } else { x.moveTo(w, px); x.lineTo(w - t, px); }
      if (major) {
        var label = String(Math.round(v));
        if (axis === 'x') x.fillText(label, px + 3, 10);
        else { x.save(); x.translate(10, px - 3); x.rotate(-Math.PI / 2); x.fillText(label, 0, 0); x.restore(); }
      }
    }
    x.stroke();
  }
  function paintOv(c) {
    var s = ovState(c);
    if (!c.S.project || (!s.rulers && !s.grid && !(guides(c).x.length + guides(c).y.length))) { if (OV) OV.el.hidden = true; return; }
    var o = ensureOv(c);
    o.el.hidden = false;
    o.el.classList.toggle('has-rulers', !!s.rulers);
    var pb = pageBox(c), d = c.doc();
    o.grid.hidden = !s.grid;
    if (s.grid) {
      var gs = s.gridSize * pb.z;
      o.grid.style.left = pb.left + 'px'; o.grid.style.top = pb.top + 'px';
      o.grid.style.width = d.width * pb.z + 'px'; o.grid.style.height = d.height * pb.z + 'px';
      o.grid.style.backgroundSize = gs + 'px ' + gs + 'px';
    }
    o.guides.innerHTML = '';
    var gd = guides(c);
    ['x', 'y'].forEach(function (axis) {
      gd[axis].forEach(function (v, i) {
        var g = document.createElement('div');
        g.className = 'sx-guide is-' + axis;
        g.setAttribute('role', 'separator');
        g.setAttribute('aria-label', (axis === 'x' ? 'Vertical' : 'Horizontal') + ' guide at ' + Math.round(v) + ' px — drag to the ruler to remove');
        if (axis === 'x') g.style.left = (pb.left + v * pb.z) + 'px'; else g.style.top = (pb.top + v * pb.z) + 'px';
        g.title = Math.round(v) + ' px';
        guideDrag(c, g, axis, i);
        o.guides.appendChild(g);
      });
    });
    if (s.rulers) { drawRuler(c, o.rx, 'x', pb); drawRuler(c, o.ry, 'y', pb); }
  }
  function rulerDrag(c, cv, axis) {
    cv.addEventListener('pointerdown', function (e) {
      if (!c.S.project) return;
      e.preventDefault();
      var gd = guides(c);
      if (gd[axis].length >= 40) { c.toast('Up to 40 guides'); return; }
      gd[axis].push(-99999);
      var i = gd[axis].length - 1;
      startGuideDrag(c, e, axis, i, cv);
    });
  }
  function guideDrag(c, el, axis, i) {
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); startGuideDrag(c, e, axis, i, el); });
    el.addEventListener('dblclick', function () { guides(c)[axis].splice(i, 1); c.markDirty(); paintOv(c); });
  }
  function startGuideDrag(c, e, axis, i, cap) {
    var sr = c.E.stage.getBoundingClientRect();
    try { cap.setPointerCapture(e.pointerId); } catch (err) {}
    var tip = c.h('<span class="sx-guide-tip"></span>');
    c.E.stage.appendChild(tip);
    function mv(ev) {
      var pb = pageBox(c);
      var sp = axis === 'x' ? ev.clientX - sr.left : ev.clientY - sr.top;
      var v = Math.round((sp - (axis === 'x' ? pb.left : pb.top)) / pb.z);
      var s = ovState(c);
      if (s.snapGrid) v = Math.round(v / s.gridSize) * s.gridSize;
      guides(c)[axis][i] = v;
      tip.textContent = (axis === 'x' ? 'X ' : 'Y ') + v;
      tip.style.left = (ev.clientX - sr.left + 12) + 'px'; tip.style.top = (ev.clientY - sr.top + 12) + 'px';
      paintOv(c);
    }
    function up(ev) {
      cap.removeEventListener('pointermove', mv); cap.removeEventListener('pointerup', up); cap.removeEventListener('pointercancel', up);
      tip.remove();
      var s = ovState(c);
      var sp = axis === 'x' ? ev.clientX - sr.left : ev.clientY - sr.top;
      if (sp < (s.rulers ? 22 : 8) || guides(c)[axis][i] === -99999) guides(c)[axis].splice(i, 1);
      c.markDirty();
      paintOv(c);
    }
    cap.addEventListener('pointermove', mv); cap.addEventListener('pointerup', up); cap.addEventListener('pointercancel', up);
  }
  function wrapSnap(c) {
    var sc = c.scene;
    if (sc._leSnapWrapped) return;
    var orig = sc._snapRect;
    if (typeof orig !== 'function') return;
    sc._leSnapWrapped = true;
    sc._snapRect = function (box, ignore) {
      var s = ovState(c);
      if (!s.snap) return { x: box.x, y: box.y, guides: [] };
      var r = s.snapObjects ? orig.call(this, box, ignore) : { x: box.x, y: box.y, guides: [] };
      var th = 6 / (this._zoom || 1);
      var gd = guides(c);
      var gl = r.guides ? r.guides.slice() : [];
      function axisSnap(pos, size, lines, key) {
        var best = null;
        lines.forEach(function (v) {
          [[v - pos, v], [v - (pos + size), v], [v - (pos + size / 2), v]].forEach(function (t) { if (Math.abs(t[0]) <= th && (!best || Math.abs(t[0]) < Math.abs(best[0]))) best = t; });
        });
        if (best) { var g = {}; g[key] = best[1]; gl.push(g); return pos + best[0]; }
        return null;
      }
      var gridLines = function (len, size) { var a = []; if (!s.snapGrid) return a; for (var v = 0; v <= len; v += size) a.push(v); return a; };
      var d = this._doc;
      if (r.x === box.x) {
        var lx = (s.snapGuides ? gd.x : []).concat(gridLines(d.width, s.gridSize));
        var nx = axisSnap(box.x, box.w, lx, 'x');
        if (nx != null) r = Object.assign({}, r, { x: nx });
      }
      if (r.y === box.y) {
        var ly = (s.snapGuides ? gd.y : []).concat(gridLines(d.height, s.gridSize));
        var ny = axisSnap(box.y, box.h, ly, 'y');
        if (ny != null) r = Object.assign({}, r, { y: ny });
      }
      r.guides = gl;
      return r;
    };
  }
  CMDS.guidesMenu = function (c, arg, el) {
    var s = ovState(c);
    var body = c.h('<div class="sx-guides-pop"></div>');
    function tog(label, key, hint) {
      var t = c.ui.toggle(label, !!s[key], function (v) { s[key] = v; saveOv(c); paintOv(c); c.renderFoot(); }, hint);
      body.appendChild(t);
    }
    tog('Rulers', 'rulers', 'Drag from a ruler to add a guide (Shift+R)');
    tog('Grid', 'grid', "Shows a layout grid (Shift+')");
    body.appendChild(c.ui.slider({ label: 'Grid size', min: 8, max: 200, step: 4, value: s.gridSize, reset: 40, fmt: function (v) { return v + ' px'; }, onInput: function (v) { s.gridSize = v; saveOv(c); paintOv(c); } }));
    var h = c.h('<div class="sx-sub-h"><span class="sx-eyebrow">Snapping</span></div>');
    body.appendChild(h);
    tog('Snap while moving', 'snap', 'Hold Alt to move freely');
    tog('To other items & page', 'snapObjects');
    tog('To guides', 'snapGuides');
    tog('To grid', 'snapGrid');
    var gd = guides(c);
    var clr = U.btn(c, 'Clear ' + (gd.x.length + gd.y.length) + ' guide' + (gd.x.length + gd.y.length === 1 ? '' : 's'), 'trash', 'btn btn-ghost btn-sm', function () { gd.x = []; gd.y = []; c.markDirty(); paintOv(c); c.closePop(); });
    if (!(gd.x.length + gd.y.length)) clr.disabled = true;
    body.appendChild(clr);
    c.openPop(el, body, { title: 'Rulers, grid & snapping', cls: 'is-guides' });
  };
  hook('init', function (c) {
    ovState(c);
    wrapSnap(c);
    window.addEventListener('keydown', function (e) { if (e.key === 'Alt' && c.S.ov) { c.S.ov._altSnap = c.S.ov.snap; c.S.ov.snap = false; } });
    window.addEventListener('keyup', function (e) { if (e.key === 'Alt' && c.S.ov && c.S.ov._altSnap != null) { c.S.ov.snap = c.S.ov._altSnap; c.S.ov._altSnap = null; } });
    window.addEventListener('resize', c.debounce(function () { paintOv(c); }, 80));
    if (window.ResizeObserver) new ResizeObserver(function () { paintOv(c); }).observe(c.E.stage);
    var mo = new MutationObserver(function () { paintOv(c); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  ['zoom', 'page', 'resize'].forEach(function (n) { hook(n, function (c) { requestAnimationFrame(function () { paintOv(c); }); }); });
  hook('change', function (c) { if (OV && !OV.el.hidden && ovState(c).rulers) { clearTimeout(paintOv._t); paintOv._t = setTimeout(function () { paintOv(c); }, 60); } });

  /* ---------- Pages panel ---------- */
  function movePage(c, from, to) {
    var p = c.S.project;
    if (to < 0 || to >= p.pages.length || from === to) return;
    c.syncProject();
    var pg = p.pages.splice(from, 1)[0];
    p.pages.splice(to, 0, pg);
    var a = p.activePage;
    if (a === from) p.activePage = to;
    else if (from < a && to >= a) p.activePage = a - 1;
    else if (from > a && to <= a) p.activePage = a + 1;
    c.S.pageThumbs = {};
    c.markDirty();
    c.renderFoot();
    c.renderPanel(true);
  }
  P.pages = {
    title: 'Pages', eyebrow: 'Add, reorder & export every page', doc: false,
    render: function (c, body) {
      if (U.needProject(c, body)) return;
      var p = c.S.project;
      c.syncProject();
      var top = c.h('<div class="sx-row-between"></div>');
      top.appendChild(U.btn(c, 'Add page', 'plus', 'btn btn-ghost btn-sm', function () { c.addPage(false); c.renderPanel(true); }));
      top.appendChild(U.btn(c, 'Duplicate', 'copy', 'btn btn-ghost btn-sm', function () { c.addPage(true); c.renderPanel(true); }));
      body.appendChild(top);
      var list = c.h('<ol class="sx-pagelist" aria-label="Pages — drag to reorder"></ol>');
      p.pages.forEach(function (pg, i) {
        var li = c.h('<li class="sx-pagecard' + (i === p.activePage ? ' is-on' : '') + '" draggable="true" data-i="' + i + '"><button type="button" class="sx-pagecard-art" aria-label="Go to page ' + (i + 1) + '"' + (i === p.activePage ? ' aria-current="page"' : '') + '><span class="sx-skel" style="aspect-ratio:' + pg.width + '/' + pg.height + '"></span></button><div class="sx-pagecard-meta"><b>Page ' + (i + 1) + '</b><small>' + pg.width + ' × ' + pg.height + '</small></div><div class="sx-pagecard-act"></div></li>');
        li.querySelector('.sx-pagecard-art').onclick = function () { c.switchPage(i); c.renderPanel(true); };
        var act = li.querySelector('.sx-pagecard-act');
        var mk = function (icon, label, fn, dis) { var b = c.h('<button type="button" class="sx-iconbtn" aria-label="' + label + '" title="' + label + '"' + (dis ? ' disabled' : '') + '>' + c.ic(icon) + '</button>'); b.onclick = fn; act.appendChild(b); };
        mk('back', 'Move page ' + (i + 1) + ' up', function () { movePage(c, i, i - 1); }, i === 0);
        mk('right', 'Move page ' + (i + 1) + ' down', function () { movePage(c, i, i + 1); }, i === p.pages.length - 1);
        mk('trash', 'Delete page ' + (i + 1), function () {
          if (p.pages.length < 2) return;
          var removed = p.pages[i];
          c.deletePage(i);
          c.toast('Page ' + (i + 1) + ' deleted', { action: { label: 'Undo', fn: function () { c.syncProject(); p.pages.splice(i, 0, removed); c.loadPage(i); c.markDirty(); c.renderPanel(true); } } });
          c.renderPanel(true);
        }, p.pages.length < 2);
        li.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/x-le-page', String(i)); e.dataTransfer.effectAllowed = 'move'; li.classList.add('is-drag'); });
        li.addEventListener('dragend', function () { li.classList.remove('is-drag'); });
        li.addEventListener('dragover', function (e) { if ([].indexOf.call(e.dataTransfer.types || [], 'text/x-le-page') >= 0) { e.preventDefault(); li.classList.add('is-over'); } });
        li.addEventListener('dragleave', function () { li.classList.remove('is-over'); });
        li.addEventListener('drop', function (e) { var from = Number(e.dataTransfer.getData('text/x-le-page')); li.classList.remove('is-over'); if (isFinite(from)) { e.preventDefault(); movePage(c, from, i); } });
        list.appendChild(li);
        var d = i === p.activePage ? c.doc() : pg;
        var sc = Math.min(1, 240 / Math.max(d.width, d.height));
        c.hiddenRender(d, sc, { small: true }).then(function (cv) {
          var img = new Image();
          img.alt = '';
          img.src = cv.toDataURL('image/jpeg', 0.75);
          var art = li.querySelector('.sx-pagecard-art');
          art.innerHTML = '';
          art.appendChild(img);
        }).catch(function () {});
      });
      body.appendChild(list);
      var s = c.ui.section('Export all pages');
      var row = c.h('<div class="sx-row"></div>');
      row.appendChild(U.btn(c, 'PNG images (ZIP)', 'download', 'btn btn-ghost btn-sm', function () { exportAll(c, 'png'); }));
      row.appendChild(U.btn(c, 'One PDF', 'file', 'btn btn-gold btn-sm', function () { exportAll(c, 'pdf'); }));
      s.querySelector('.sx-sec-body').appendChild(row);
      s.querySelector('.sx-sec-body').appendChild(U.note(c, p.pages.length + ' page' + (p.pages.length === 1 ? '' : 's') + ' · drag cards or use the arrows to reorder · Alt + ↑/↓ switches pages', 'is-muted'));
      body.appendChild(s);
    }
  };
  function exportAll(c, fmt) {
    c.toast(fmt === 'pdf' ? 'Building your PDF…' : 'Preparing ' + c.S.project.pages.length + ' images…');
    c.exportImage({ format: fmt, pages: 'all', scale: Math.min(c.S.exportOpts.scale || 1, c.maxScale()) }).then(function (b) { if (b) c.toast('Downloaded ' + c.fmtBytes(b.size)); });
  }

  /* ---------- Keys ---------- */
  hook('key', function (c, e) {
    var mod = e.ctrlKey || e.metaKey;
    var k = e.key;
    if (mod && e.altKey && (k === 'c' || k === 'C')) { e.preventDefault(); copyStyle(c); return true; }
    if (mod && e.altKey && (k === 'v' || k === 'V')) { e.preventDefault(); pasteStyle(c); return true; }
    if (!mod && e.altKey && c.S.project && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      var n = c.S.project.activePage + (k === 'ArrowDown' ? 1 : -1);
      if (n >= 0 && n < c.S.project.pages.length) c.switchPage(n);
      return true;
    }
    if (!mod && !e.altKey && e.shiftKey && (k === 'R' || k === 'r') && c.S.project) { var s = ovState(c); s.rulers = !s.rulers; saveOv(c); paintOv(c); c.renderFoot(); return true; }
    if (!mod && !e.altKey && e.shiftKey && (k === '"' || k === "'") && c.S.project) { var s2 = ovState(c); s2.grid = !s2.grid; saveOv(c); paintOv(c); c.renderFoot(); return true; }
    return false;
  });
})();
