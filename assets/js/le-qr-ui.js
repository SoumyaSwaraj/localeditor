/* LocalEditor: the QR maker's interface (LE.qr.ui), shared by the tool page (/qr-code-generator/) and the studio's QR
   dialog. Docs: docs/QR.md. One editor (content, looks, shapes and colours, picture, frame, the scannability line),
   the exports (PNG, SVG, PDF, clipboard, hand-over to the studio) and "Make many" from a list. Styles: assets/css/qr.css.
   Everything stays on the device: pictures are read with FileReader-free canvas calls, lists with LE.variables. */
(function (global) {
  'use strict';
  var LE = global.LE = global.LE || {}, Q = LE.qr, doc = document, UI = Q.ui = {}, seq = 0;

  function el(html) { var t = doc.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function say(msg) { if (UI.toast) UI.toast(msg); else if (global.IT && global.IT.say) global.IT.say(msg); }
  function save(blob, name) {
    if (UI.download) return UI.download(blob, name);
    if (global.IT && global.IT.download) return global.IT.download(blob, name);
    var a = doc.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function toBlob(cv, type, q) { return new Promise(function (ok, no) { cv.toBlob(function (b) { if (b) ok(b); else no(new Error('This picture could not be made.')); }, type || 'image/png', q); }); }

  /* ---------- pictures: read on the device, made small enough to live inside the code's SVG ---------- */
  function loadPicture(file, edge, budget) {
    if (!file || !/^image\//.test(file.type || '')) return Promise.reject(new Error('Choose a picture file (PNG, JPG or WebP).'));
    if (file.size > 40 * 1024 * 1024) return Promise.reject(new Error('That picture is larger than 40 MB.'));
    var url = URL.createObjectURL(file);
    return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { no(new Error('That picture could not be read.')); }; im.src = url; }).then(function (im) {
      URL.revokeObjectURL(url);
      return shrink(im, edge, budget);
    }, function (e) { URL.revokeObjectURL(url); throw e; });
  }
  function shrink(im, edge, budget) {
    var w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height, out = '';
    budget = budget || Q.LIMITS.picture;
    for (var e = edge; e >= 48; e = Math.round(e * 0.75)) {
      var k = Math.min(1, e / Math.max(w0, h0)), cv = doc.createElement('canvas');
      cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
      var g = cv.getContext('2d');
      g.drawImage(im, 0, 0, cv.width, cv.height);
      var d = g.getImageData(0, 0, cv.width, cv.height).data, alpha = false;
      for (var i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break; }
      out = alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.84);
      if (out.length <= budget) return out;
    }
    throw new Error('That picture is too detailed to put inside a code.');
  }
  function reshrink(src, edge, budget) { return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { try { ok(shrink(im, edge, budget)); } catch (e) { no(e); } }; im.onerror = no; im.src = src; }); }

  /* ---------- exports ---------- */
  var OUT = UI.out = {};
  OUT.flat = function (spec, transparent) { if (!transparent) return spec; var s = clone(spec); s.bg = null; return s; };
  OUT.png = function (spec, px, o) { return Q.canvas(spec, px || 1024, o).then(function (cv) { return toBlob(cv, 'image/png'); }); };
  OUT.svg = function (spec, o) { return new Blob([Q.svg(spec, o)], { type: 'image/svg+xml' }); };
  function vars() {
    if (LE.variables && LE.variables.ZipWriter) return Promise.resolve(LE.variables);
    if (!LE.lazy) LE.lazy = Q.lazy;
    return Q.lazy(Q.BASE + 'le-variables.js').then(function () { if (!LE.variables) throw new Error('The list reader did not load.'); return LE.variables; });
  }
  UI.vars = vars;
  var PAPER = { a4: [210, 297, 'A4'], letter: [215.9, 279.4, 'Letter'] };
  /* pdf(items, { paper, cols, marks, fill, title, ctl, onProgress }) → Blob. items: [{ spec, caption }]; fill repeats the
     first one until a page is full. One sheet page at a
     time (JPEG at 200 dpi through LE.variables.PdfWriter), so memory stays flat however long the list is. */
  OUT.pdf = function (items, o) {
    o = o || {};
    var P = PAPER[o.paper] || PAPER.a4, cols = Math.max(1, Math.min(8, Math.round(o.cols || 1))), m = 10, gap = cols > 1 ? 6 : 0, K = 200 / 25.4;
    var caps = items.some(function (it) { return it.caption; }), capOf = function (it) { return caps ? (it.caption || ' ') : undefined; };
    var a = Q.aspect(items[0].spec, { caption: capOf(items[0]) });
    var cw = cols === 1 ? Math.min(P[0] - 2 * m, 120) : (P[0] - 2 * m - (cols - 1) * gap) / cols, ch = cw / a;
    if (ch > P[1] - 2 * m) { ch = P[1] - 2 * m; cw = ch * a; }
    var rows = cols === 1 ? 1 : Math.max(1, Math.floor((P[1] - 2 * m + gap) / (ch + gap))), per = cols * rows;
    if (o.fill) { items = []; while (items.length < per) items.push(arguments[0][0]); }
    var x0 = (P[0] - (cols * cw + (cols - 1) * gap)) / 2, y0 = cols === 1 ? (P[1] - ch) / 2 : (P[1] - (rows * ch + (rows - 1) * gap)) / 2;
    return vars().then(function (V) {
      var W = new V.PdfWriter(), i = 0, ctl = o.ctl || {};
      function sheet() {
        if (i >= items.length || ctl.cancelled) return null;
        var cv = doc.createElement('canvas'), g = cv.getContext('2d'), n = 0;
        cv.width = Math.round(P[0] * K); cv.height = Math.round(P[1] * K);
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
        function cell() {
          if (n >= per || i >= items.length) return null;
          var it = items[i], c = n % cols, r = Math.floor(n / cols), x = (x0 + c * (cw + gap)) * K, y = (y0 + r * (ch + gap)) * K;
          return wait(ctl).then(function () { return Q.canvas(it.spec, Math.round(cw * K), { caption: capOf(it) }); }).then(function (code) {
            g.drawImage(code, Math.round(x), Math.round(y));
            if (o.marks !== false && cols > 1) marks(g, x, y, cw * K, ch * K, K);
            i++; n++;
            if (o.onProgress) o.onProgress(i, items.length);
            return cell();
          });
        }
        return Promise.resolve(cell()).then(function () { return toBlob(cv, 'image/jpeg', 0.93); }).then(function (jpg) {
          return W.addPage(jpg, cv.width, cv.height, P[0] / 25.4 * 72, P[1] / 25.4 * 72);
        }).then(sheet);
      }
      return Promise.resolve(sheet()).then(function () { if (ctl.cancelled) { W.abort(); throw cancelled(); } return W.finish(o.title || 'QR codes'); });
    });
  };
  function marks(g, x, y, w, h, K) {
    var len = 3 * K, off = 1 * K;
    g.save(); g.strokeStyle = '#6b6577'; g.lineWidth = Math.max(1, 0.15 * K); g.beginPath();
    [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]].forEach(function (p) {
      g.moveTo(p[0] + p[2] * off, p[1]); g.lineTo(p[0] + p[2] * (off + len), p[1]);
      g.moveTo(p[0], p[1] + p[3] * off); g.lineTo(p[0], p[1] + p[3] * (off + len));
    });
    g.stroke(); g.restore();
  }
  function cancelled() { var e = new Error('Cancelled.'); e.code = 'cancelled'; return e; }
  function wait(ctl) {
    if (!ctl || !ctl.paused) return new Promise(function (ok) { setTimeout(ok, 0); });
    return new Promise(function (ok) { var t = setInterval(function () { if (!ctl.paused || ctl.cancelled) { clearInterval(t); ok(); } }, 120); });
  }
  /* A design layer for the studio: the spec alone, the studio draws it (le-design.js). */
  OUT.layer = function (spec) { var w = 640, a = Q.aspect(spec); return { id: 'qr', type: 'svg', name: 'QR · ' + String(spec.text).slice(0, 30), qr: spec, x: Math.round((1080 - w) / 2), y: Math.round((1080 - w / a) / 2), w: w, h: Math.round(w / a) }; };
  OUT.design = function (spec) { return { format: 'localeditor-design', version: 1, name: 'QR code', pages: [{ width: 1080, height: 1080, background: '#FFFFFF', layers: [OUT.layer(spec)] }] }; };
  function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    var cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(cs.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
  }
  /* studioLink(spec) → Promise<{ url, smaller, dropped }>: the studio's own template link (#d=…, docs/FORMAT-DESIGN.md).
     Links hold 30,000 characters, so a picture inside the code is made smaller until it fits, or left out and said so. */
  OUT.studioLink = function (spec, base) {
    var LIMIT = 29000, root = base || new URL((doc.documentElement.getAttribute('data-root') || '../') + 'studio/', location.href).href;
    function pack(s) {
      var bytes = new TextEncoder().encode(JSON.stringify(OUT.design(s)));
      return deflate(bytes).then(function (z) { return z ? 'z' + b64url(z) : 'j' + b64url(bytes); });
    }
    var tries = [[spec, 0]];
    function attempt(s, step) {
      return pack(s).then(function (p) {
        if (p.length <= LIMIT) return { url: root + '#d=' + p, smaller: step > 0, dropped: false };
        if ((!s.image && !s.picture) || step >= 5) { var bare = clone(s); delete bare.image; delete bare.picture; return pack(bare).then(function (p2) { return { url: root + '#d=' + p2, smaller: false, dropped: !!(s.image || s.picture) }; }); }
        var next = clone(s), edge = [200, 150, 110, 80, 60][step], jobs = [];
        ['image', 'picture'].forEach(function (k) { if (next[k]) jobs.push(reshrink(next[k].src, k === 'image' ? edge : edge * 1.6, 9000 - step * 1200).then(function (src) { next[k].src = src; }, function () { delete next[k]; })); });
        return Promise.all(jobs).then(function () { return attempt(next, step + 1); });
      });
    }
    return attempt(tries[0][0], 0);
  };
  /* copy(spec) → what reached the clipboard: 'both' (a PNG for anywhere, our design layer for the studio), 'png' or 'text'. */
  OUT.copy = function (spec) {
    return OUT.png(spec, 768).then(function (png) {
      var CI = global.ClipboardItem, cb = navigator.clipboard;
      if (!CI || !cb || !cb.write) throw new Error('no clipboard');
      return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(png); }).then(function (uri) {
        var html = '<img alt="QR code" data-le-design="' + esc(JSON.stringify(OUT.layer(Q.isPlain(spec) ? spec : Q.clean(spec)))) + '" src="' + uri + '">';
        return cb.write([new CI({ 'image/png': png, 'text/html': new Blob([html], { type: 'text/html' }) })]).then(function () { return 'both'; }, function () {
          return cb.write([new CI({ 'image/png': png })]).then(function () { return 'png'; });
        });
      });
    }).catch(function () {
      return navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(spec.text).then(function () { return 'text'; }) : Promise.reject(new Error('This browser does not allow copying pictures.'));
    });
  };
  /* The design layer inside pasted HTML (the studio's paste handler calls this). Returns a clean spec or null. */
  UI.fromPaste = function (html) {
    try {
      var im = new DOMParser().parseFromString(String(html || '').slice(0, 2000000), 'text/html').querySelector('img[data-le-design]');
      var o = im ? JSON.parse(im.getAttribute('data-le-design')) : null;
      if (!o || !o.qr || typeof o.qr.text !== 'string' || !o.qr.text) return null;
      return Q.isPlain(o.qr) ? { text: String(o.qr.text).slice(0, Q.LIMITS.text), fg: Q.color.hex(o.qr.fg) || '#17131f', bg: Q.color.hex(o.qr.bg), ec: Q.clean(o.qr).ec } : Q.clean(o.qr);
    } catch (e) { return null; }
  };

  /* ---------- the editor ---------- */
  var SHAPE_NAMES = { square: 'Squares', rounded: 'Rounded', dots: 'Dots', diamond: 'Soft diamonds', vbars: 'Tall bars', hbars: 'Wide bars', connected: 'Connected' };
  var EYE_NAMES = { square: 'Square', rounded: 'Rounded', circle: 'Circle', leaf: 'Leaf', dot: 'Dot' };
  var FRAME_NAMES = { none: 'None', label: 'Label below', tab: 'Speech tab', badge: 'Badge', ticket: 'Ticket' };
  function guess(text) { return /^https?:\/\//i.test(text) ? ['link', { url: text }] : ['text', { text: text }]; }

  UI.editor = function (host, opts) {
    opts = opts || {};
    var page = opts.mode !== 'studio', P = page ? 'f-' : 'sxq-' + (++seq) + '-';
    var start = opts.spec || Q.withStyle('https://localeditor.net/', 'ink');
    var keepPlain = !!opts.spec && Q.isPlain(opts.spec), st = Q.clean(start), g0 = opts.type ? [opts.type, opts.values || {}] : guess(st.text);
    var type = g0[0], values = {}, report = null, pending = null, syncs = [], error = null, brand = opts.brand || null;
    values[type] = g0[1];
    var root = el('<div class="qr-app" data-mode="' + (page ? 'page' : 'studio') + '">' +
      '<div class="qr-stage"><div class="qr-prev"><canvas' + (page ? ' id="cv"' : '') + ' width="640" height="640" role="img" aria-label="QR code preview"></canvas></div>' +
      '<p class="qr-status" role="status" aria-live="polite" data-state="wait">Checking…</p>' +
      '<div class="qr-anyway" hidden><span>This code did not pass the test scan, so people may not be able to use it.</span><button type="button" class="btn btn-sm" data-anyway>' + esc(opts.anyway || 'Download anyway') + '</button><button type="button" class="btn btn-sm" data-cancel>Cancel</button></div>' +
      '<div class="qr-actions"></div></div>' +
      '<div class="qr-controls">' +
      '<section class="qr-sec"><h3>What it holds</h3><div class="qr-tabs" role="group" aria-label="Content type"></div><div class="qr-fields"></div><p class="qr-hint" data-len></p></section>' +
      '<section class="qr-sec"><h3>Looks</h3><div class="qr-presets" role="group" aria-label="Ready-made looks"></div></section>' +
      '<details class="qr-sec" data-sec="style"><summary>Shapes and colours</summary><div class="qr-grid"></div></details>' +
      '<details class="qr-sec" data-sec="picture"><summary>Picture</summary><div class="qr-grid"></div></details>' +
      '<details class="qr-sec" data-sec="frame"><summary>Frame and call to action</summary><div class="qr-grid"></div></details>' +
      '</div></div>');
    host.appendChild(root);
    var cv = root.querySelector('canvas'), status = root.querySelector('.qr-status'), anyway = root.querySelector('.qr-anyway');
    var tabs = root.querySelector('.qr-tabs'), fields = root.querySelector('.qr-fields'), lenNote = root.querySelector('[data-len]'), presetBox = root.querySelector('.qr-presets');
    function secBody(n) { return root.querySelector('[data-sec="' + n + '"] .qr-grid'); }

    /* ---- small control builders; each registers a sync so presets and fixes refresh the form ---- */
    function wrap(label, inner, cls) { var w = el('<label class="qr-f ' + (cls || '') + '"><span>' + esc(label) + '</span></label>'); inner.setAttribute('data-k', Q.slug(label)); w.appendChild(inner); return w; }
    function segCtl(label, list, get, set) {
      var w = el('<div class="qr-f qr-f-wide"><span>' + esc(label) + '</span><span class="seg qr-seg" role="group" data-k="' + Q.slug(label) + '" aria-label="' + esc(label) + '"></span></div>'), box = w.lastChild;
      list.forEach(function (it) { var b = el('<button type="button" data-v="' + esc(it[0]) + '">' + esc(it[1]) + '</button>'); b.onclick = function () { set(it[0]); changed(); }; box.appendChild(b); });
      syncs.push(function () { var v = String(get()); [].forEach.call(box.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false'); }); });
      return w;
    }
    function selCtl(label, listFn, get, set) {
      var s = el('<select class="select"></select>');
      s.onchange = function () { set(s.value); changed(); };
      syncs.push(function () { s.innerHTML = listFn().map(function (it) { return '<option value="' + esc(it[0]) + '">' + esc(it[1]) + '</option>'; }).join(''); s.value = get(); });
      return wrap(label, s);
    }
    function colCtl(label, get, set) {
      var i = el('<input type="color" class="qr-color">');
      i.oninput = function () { set(i.value); changed(true); };
      syncs.push(function () { i.value = get() || '#ffffff'; });
      return wrap(label, i, 'qr-f-color');
    }
    function rngCtl(label, min, max, step, get, set, fmt) {
      var i = el('<input type="range" min="' + min + '" max="' + max + '" step="' + step + '">'), w = wrap(label, i), out = el('<output></output>');
      w.firstChild.appendChild(out);
      i.oninput = function () { set(Number(i.value)); out.textContent = ' ' + fmt(Number(i.value)); changed(true); };
      syncs.push(function () { i.value = get(); out.textContent = ' ' + fmt(Number(i.value)); });
      return w;
    }
    function chkCtl(label, get, set) {
      var w = el('<label class="check qr-f-wide"><input type="checkbox" role="switch"> <span>' + esc(label) + '</span></label>'), i = w.firstChild;
      i.onchange = function () { set(i.checked); changed(); };
      syncs.push(function () { i.checked = !!get(); });
      return w;
    }
    function fileCtl(label, onFile) {
      var w = el('<label class="btn btn-sm qr-file" tabindex="0" role="button"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><span>' + esc(label) + '</span></label>'), i = w.firstChild;
      w.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); i.click(); } };
      i.onchange = function () { var fl = i.files && i.files[0]; i.value = ''; if (fl) onFile(fl); };
      return w;
    }
    function group(cond, kids) { var d = el('<div class="qr-grid qr-f-wide"></div>'); kids.forEach(function (k) { d.appendChild(k); }); syncs.push(function () { d.hidden = !cond(); }); return d; }
    function eye() { st.eye = st.eye || { outer: 'square', inner: 'square' }; return st.eye; }
    function eyeNow() { return st.eye || { outer: 'square', inner: 'square' }; }
    function grad() { return typeof st.fg === 'object' ? st.fg : null; }
    function solid() { return grad() ? grad().stops[0].color : st.fg; }

    /* ---- shapes and colours ---- */
    var S = secBody('style');
    S.appendChild(selCtl('Dot shape', function () { return Q.SHAPES.map(function (s) { return [s, SHAPE_NAMES[s]]; }); }, function () { return st.shape || 'square'; }, function (v) { st.shape = v; }));
    S.appendChild(selCtl('Corner frames', function () { return Q.EYES.outer.map(function (s) { return [s, EYE_NAMES[s]]; }); }, function () { return eyeNow().outer; }, function (v) { eye().outer = v; if (Q.EYES.pairs[v].indexOf(eye().inner) < 0) eye().inner = Q.EYES.pairs[v][0]; }));
    S.appendChild(selCtl('Corner centres', function () { return Q.EYES.pairs[eyeNow().outer].map(function (s) { return [s, EYE_NAMES[s]]; }); }, function () { return eyeNow().inner; }, function (v) { eye().inner = v; }));
    S.appendChild(segCtl('Dot colour', [['solid', 'One colour'], ['linear', 'Gradient'], ['radial', 'Glow']], function () { return grad() ? grad().type : 'solid'; }, function (v) {
      var a = solid();
      if (v === 'solid') st.fg = a;
      else st.fg = { type: v, angle: grad() ? grad().angle : 45, stops: grad() ? grad().stops : [{ at: 0, color: a }, { at: 1, color: Q.color.mix(a, '#1d4ed8', 0.6) }] };
    }));
    S.appendChild(group(function () { return !grad(); }, [colCtl('Dots', function () { return st.fg; }, function (v) { st.fg = v; })]));
    S.appendChild(group(function () { return !!grad(); }, [
      colCtl('From', function () { return grad().stops[0].color; }, function (v) { grad().stops[0].color = v; }),
      colCtl('To', function () { var s = grad().stops; return s[s.length - 1].color; }, function (v) { var s = grad().stops; s[s.length - 1].color = v; }),
      chkCtl('A third colour in the middle', function () { return grad().stops.length > 2; }, function (on) { var s = grad().stops; if (on && s.length < 3) s.splice(1, 0, { at: 0.5, color: Q.color.mix(s[0].color, s[1].color, 0.5) }); else if (!on && s.length > 2) s.splice(1, 1); }),
      group(function () { return grad().stops.length > 2; }, [colCtl('Middle', function () { return grad().stops[1].color; }, function (v) { grad().stops[1].color = v; })]),
      group(function () { return grad().type === 'linear'; }, [rngCtl('Direction', 0, 360, 15, function () { return grad().angle; }, function (v) { grad().angle = v; }, function (v) { return v + '°'; })])
    ]));
    S.appendChild(chkCtl('Corners in their own colours', function () { return !!(eyeNow().outerColor || eyeNow().innerColor); }, function (on) { if (on) { eye().outerColor = solid(); eye().innerColor = solid(); } else { delete eye().outerColor; delete eye().innerColor; } }));
    S.appendChild(group(function () { return !!(eyeNow().outerColor || eyeNow().innerColor); }, [
      colCtl('Corner frames', function () { return eyeNow().outerColor || solid(); }, function (v) { eye().outerColor = v; }),
      colCtl('Corner centres', function () { return eyeNow().innerColor || eyeNow().outerColor || solid(); }, function (v) { eye().innerColor = v; })
    ]));
    S.appendChild(chkCtl('See-through background', function () { return !st.bg; }, function (on) { st.bg = on ? null : '#ffffff'; }));
    S.appendChild(group(function () { return !!st.bg; }, [colCtl('Background', function () { return st.bg; }, function (v) { st.bg = v; })]));
    S.appendChild(rngCtl('Margin', 0, 8, 1, function () { return st.quiet == null ? 4 : st.quiet; }, function (v) { st.quiet = v; }, function (v) { return v + (v === 1 ? ' square' : ' squares'); }));
    S.appendChild(rngCtl('Rounded tile', 0, 25, 1, function () { return Math.round((st.radius || 0) * 100); }, function (v) { st.radius = v / 100; }, function (v) { return v + '%'; }));
    S.appendChild(segCtl('Damage it survives', [['L', 'Low'], ['M', 'Medium'], ['Q', 'High'], ['H', 'Most']], function () { return st.image ? 'H' : st.ec; }, function (v) { st.ec = v; }));

    /* ---- picture ---- */
    var Pc = secBody('picture');
    function addPicture(key, edge, budget) {
      return function (file) {
        loadPicture(file, edge, budget).then(function (src) {
          if (key === 'image') st.image = { src: src, size: 0.22, fit: 'contain', round: 0.2 }; else st.picture = { src: src, dim: 0.6 };
          changed();
        }).catch(function (e) { say(e.message); });
      };
    }
    Pc.appendChild(el('<p class="qr-hint qr-f-wide">A logo or photo in the middle. It stays on this device, and the code switches to its strongest repair setting so it still scans.</p>'));
    Pc.appendChild(fileCtl('Choose a centre picture', addPicture('image', 240, 60000)));
    Pc.appendChild(group(function () { return !!st.image; }, [
      rngCtl('Size', 10, 30, 1, function () { return Math.round(st.image.size * 100); }, function (v) { st.image.size = v / 100; }, function (v) { return v + '% of the code'; }),
      segCtl('Fit', [['contain', 'Whole picture'], ['cover', 'Fill the space']], function () { return st.image.fit; }, function (v) { st.image.fit = v; }),
      rngCtl('Roundness', 0, 50, 5, function () { return Math.round(st.image.round * 100); }, function (v) { st.image.round = v / 100; }, function (v) { return v === 50 ? 'circle' : v + '%'; }),
      (function () { var b = el('<button type="button" class="btn btn-sm" data-remove="image">Remove centre picture</button>'); b.onclick = function () { delete st.image; changed(); }; return b; })()
    ]));
    Pc.appendChild(el('<p class="qr-hint qr-f-wide">Or a picture behind the code. It is dimmed and the code is drawn as dots on top, so cameras can still read it.</p>'));
    Pc.appendChild(fileCtl('Choose a background picture', addPicture('picture', 420, 105000)));
    Pc.appendChild(group(function () { return !!st.picture; }, [
      rngCtl('Dimming', 35, 90, 5, function () { return Math.round(st.picture.dim * 100); }, function (v) { st.picture.dim = v / 100; }, function (v) { return v + '%'; }),
      (function () { var b = el('<button type="button" class="btn btn-sm" data-remove="picture">Remove background picture</button>'); b.onclick = function () { delete st.picture; changed(); }; return b; })()
    ]));

    /* ---- frame ---- */
    var Fr = secBody('frame');
    function frame() { return st.frame || { style: 'none' }; }
    Fr.appendChild(segCtl('Frame', Q.FRAMES.map(function (s) { return [s, FRAME_NAMES[s]]; }), function () { return frame().style; }, function (v) { if (v === 'none') delete st.frame; else st.frame = Object.assign({ text: 'Scan me' }, st.frame || {}, { style: v }); }));
    var ftext = el('<input class="input" type="text" maxlength="' + Q.LIMITS.frameText + '" id="' + P + 'cta">');
    ftext.oninput = function () { if (st.frame) { st.frame.text = ftext.value; changed(true); } };
    syncs.push(function () { if (doc.activeElement !== ftext) ftext.value = frame().text || ''; });
    var chips = el('<div class="qr-chips qr-f-wide"></div>');
    ['Scan me', 'Menu', 'Pay here', 'Join Wi-Fi', 'Follow us'].forEach(function (t) { var b = el('<button type="button" class="chip">' + esc(t) + '</button>'); b.onclick = function () { st.frame.text = t; changed(); }; chips.appendChild(b); });
    Fr.appendChild(group(function () { return !!st.frame; }, [wrap('Words', ftext, 'qr-f-wide'), chips,
      colCtl('Frame colour', function () { return frame().color || solid(); }, function (v) { st.frame.color = v; delete st.frame.ink; })]));

    /* ---- content ---- */
    Q.TYPES.forEach(function (t) { var b = el('<button type="button" class="chip" data-t="' + t.id + '">' + esc(t.name) + '</button>'); b.onclick = function () { type = t.id; values[type] = values[type] || clone(t.sample || {}); drawFields(); changed(); }; tabs.appendChild(b); });
    function drawFields() {
      var t = Q.TYPES.filter(function (x) { return x.id === type; })[0], v = values[type] = values[type] || {};
      [].forEach.call(tabs.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-t') === type ? 'true' : 'false'); });
      fields.innerHTML = '';
      t.fields.forEach(function (fd) {
        var id = P + fd.k, c;
        if (fd.type === 'check') { c = el('<label class="check"><input type="checkbox" role="switch" id="' + id + '"> <span>' + esc(fd.label) + '</span></label>'); c.firstChild.checked = !!v[fd.k]; c.firstChild.onchange = function () { v[fd.k] = c.firstChild.checked; changed(); }; fields.appendChild(c); return; }
        if (fd.type === 'select') c = el('<select class="select" id="' + id + '">' + fd.opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>');
        else if (fd.type === 'textarea') c = el('<textarea class="textarea" rows="3" id="' + id + '" spellcheck="false"></textarea>');
        else c = el('<input class="input" id="' + id + '" type="' + (fd.type === 'number' ? 'text' : fd.type) + '"' + (fd.type === 'number' ? ' inputmode="decimal"' : '') + ' autocomplete="off" autocapitalize="off" spellcheck="false">');
        if (fd.max) c.maxLength = fd.max;
        if (fd.ph) c.placeholder = fd.ph;
        c.value = v[fd.k] == null ? (fd.type === 'select' ? fd.opts[0][0] : '') : v[fd.k];
        c.oninput = c.onchange = function () { v[fd.k] = c.value; changed(true); };
        fields.appendChild(wrap(fd.label + (fd.req ? '' : ' (optional)'), c));
        if (fd.hint) fields.appendChild(el('<p class="qr-hint">' + esc(fd.hint) + '</p>'));
      });
    }

    /* ---- looks ---- */
    var thumbText = '';
    function drawPresets() {
      var text = st.text && st.text.length <= 60 ? st.text : 'https://localeditor.net/';
      if (text === thumbText && presetBox.children.length) return;
      thumbText = text;
      presetBox.innerHTML = '';
      Q.presets(brand).forEach(function (p) {
        var b = el('<button type="button" class="qr-preset" data-preset="' + p.id + '" title="' + esc(p.name) + '"><img alt="" width="72" height="72"><span>' + esc(p.name) + '</span></button>'), look = clone(p.style);
        delete look.frame;
        try { b.firstChild.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(Q.svg(Q.withStyle(text, look))); } catch (e) { /* too long for a thumbnail */ }
        b.onclick = function () {
          var keep = { text: st.text, ec: st.ec, image: st.image, picture: st.picture, quiet: st.quiet };
          st = Q.clean(Object.assign({}, p.style, keep));
          keepPlain = false;
          changed();
        };
        presetBox.appendChild(b);
      });
    }
    var thumbsLater = debounce(drawPresets, 500);

    /* ---- draw, check, report ---- */
    function current() {
      if (keepPlain && typeof st.fg === 'string' && !st.shape && !st.eye && st.quiet == null && st.radius == null && !st.image && !st.picture && !st.frame) return { text: st.text, fg: st.fg, bg: st.bg, ec: st.ec };
      return Q.clean(st);
    }
    var run = 0;
    function draw() {
      var spec = current(), mine = ++run;
      if (error && !spec.text) { paintStatus(); return; }
      Q.canvas(spec, 640).then(function (c) {
        if (mine !== run) return;
        cv.width = c.width; cv.height = c.height;
        cv.getContext('2d').drawImage(c, 0, 0);
      }).catch(function () { /* the status line says why */ });
    }
    var checkLater = debounce(function () {
      var mine = run, spec = current();
      pending = Q.check(spec).then(function (r) { if (mine === run) { report = r; pending = null; paintStatus(); if (opts.onChange) opts.onChange(spec, r); } return r; });
    }, 220);
    function paintStatus() {
      var r = report, notes = r ? r.notes : [], top = notes.filter(function (n) { return n.level === 'fail'; })[0] || notes.filter(function (n) { return n.level === 'warn'; })[0];
      status.innerHTML = '';
      if (error) { status.setAttribute('data-state', 'fail'); status.textContent = error; return; }
      if (!r) { status.setAttribute('data-state', 'wait'); status.textContent = 'Checking…'; return; }
      status.setAttribute('data-state', top ? top.level : 'ok');
      var line = top ? top.text : r.decoded ? 'Scans. A test scan read it back at two sizes.' : 'Looks fine. Try it with your phone before you print it.';
      status.appendChild(el('<span>' + esc(line) + '</span>'));
      if (top && top.fix) { var b = el('<button type="button" class="btn btn-sm" data-fix>' + esc(top.fix.label) + '</button>'); b.onclick = function () { st = Q.clean(Q.applyFix(st, top.fix.patch)); keepPlain = false; changed(); }; status.appendChild(b); }
      notes.filter(function (n) { return n !== top && (n.level === 'info' || n.level === 'warn'); }).slice(0, 2).forEach(function (n) { status.appendChild(el('<small>' + esc(n.text) + '</small>')); });
      if (!top || top.level !== 'fail') anyway.hidden = true;
    }
    function changed(typing) {
      var e = Q.encode(type, values[type] || {});
      error = e.error || null;
      st.text = e.text || '';
      lenNote.textContent = e.text ? e.text.length + ' of ' + Q.LIMITS.text + ' characters' + (e.error ? '. ' + e.error : '') : '';
      if (!typing) { st = Q.clean(st); if (!st.text) st.text = ''; syncs.forEach(function (f) { try { f(); } catch (e) { /* a control in a hidden group has nothing to show yet */ } }); }
      report = null;
      run++;
      status.setAttribute('data-state', error ? 'fail' : 'wait');
      status.textContent = error || 'Checking…';
      if (!error) { draw(); checkLater(); }
      thumbsLater();
    }
    function settle() { return pending ? pending : report ? Promise.resolve(report) : new Promise(function (ok) { setTimeout(function () { ok(settle()); }, 60); }); }
    /* guard(fn): run fn(spec) only for a code that passed, or after an explicit "Download anyway". */
    function guard(fn) {
      if (error) { say(error); return Promise.resolve(false); }
      return settle().then(function (r) {
        if (r.ok) return fn(current(), r);
        anyway.hidden = false;
        anyway.querySelector('[data-anyway]').onclick = function () { anyway.hidden = true; fn(current(), r); };
        anyway.querySelector('[data-cancel]').onclick = function () { anyway.hidden = true; };
        anyway.querySelector('[data-anyway]').focus();
        return false;
      });
    }
    drawFields();
    Q.ready().then(function () { changed(); drawPresets(); }).catch(function () { error = 'The QR maker is not available offline yet. Connect once and it will be.'; paintStatus(); });
    var api = {
      el: root, actions: root.querySelector('.qr-actions'), spec: current, report: function () { return report; }, settle: settle, guard: guard, type: function () { return type; },
      style: function () { return Q.styleOf(st); }, set: function (spec) { st = Q.clean(spec); keepPlain = Q.isPlain(spec); var g = guess(st.text); type = g[0]; values[type] = g[1]; drawFields(); changed(); },
      setBrand: function (b) { brand = b; thumbText = ''; drawPresets(); }
    };
    return api;
  };

  /* ---------- Make many: one code per row of a list ---------- */
  /* plan(table, map, style) → [{ row, text, label, name, error }]. map: { type, fields: { key: column index }, label, file }.
     Cells are text: nothing in them is run, formulas arrive as their cached values (LE.variables), long cells are refused. */
  UI.plan = function (table, map, style, fixes) {
    var used = {}, fieldsOf = Q.TYPES.filter(function (t) { return t.id === map.type; })[0].fields;
    return table.rows.map(function (cells, i) {
      var v = {}, fx = (fixes && fixes[i]) || {};
      fieldsOf.forEach(function (fd) { var c = map.fields[fd.k]; v[fd.k] = fx[fd.k] != null ? fx[fd.k] : c == null || c < 0 ? '' : cells[c] || ''; });
      var e = Q.encode(map.type, v), it = { row: i + 1, values: v, text: e.text, error: e.error, label: map.label >= 0 ? String(cells[map.label] || '').slice(0, 60) : '' };
      if (!it.error) { var r = Q.inspect(Q.withStyle(e.text, style)), bad = r.notes.filter(function (n) { return n.level === 'fail'; })[0]; if (bad) it.error = bad.text; }
      var base = (map.file >= 0 && Q.slug(cells[map.file], 60)) || Q.fileName(e.text || 'row-' + (i + 1));
      var name = base, k = 1;
      while (used[name]) name = base + '-' + (++k);
      used[name] = 1;
      it.name = name;
      return it;
    });
  };
  /* make(items, style, { format: 'png' | 'svg' | 'pdf', px, paper, cols, verify, ctl, onProgress }) → Promise<{ blob, name, made, failed[] }> */
  UI.make = function (items, style, o) {
    o = o || {};
    var ctl = o.ctl || {}, failed = [], made = 0, good = [];
    function specOf(it) { return Q.withStyle(it.text, style); }
    function verify(it) {
      if (o.verify === false) return Promise.resolve(true);
      return Q.check(specOf(it), { quick: true }).then(function (r) { if (!r.ok) failed.push([it.row, it.name, (r.notes.filter(function (n) { return n.level === 'fail'; })[0] || {}).text || 'The test scan could not read it.']); return r.ok; });
    }
    return vars().then(function (V) {
      var zip = o.format === 'pdf' ? null : new V.ZipWriter(), i = 0;
      function next() {
        if (ctl.cancelled) { if (zip) zip.abort(); throw cancelled(); }
        if (i >= items.length) return null;
        var it = items[i++];
        return wait(ctl).then(function () { return verify(it); }).then(function (ok) {
          if (!ok) return null;
          if (!zip) { good.push({ spec: specOf(it), caption: it.label }); return null; }
          var cap = it.label ? { caption: it.label } : undefined;
          return (o.format === 'svg' ? Promise.resolve(OUT.svg(specOf(it), cap)) : OUT.png(specOf(it), o.px || 1024, cap)).then(function (b) { made++; return zip.add(it.name + '.' + (o.format === 'svg' ? 'svg' : 'png'), b); });
        }).then(function () { if (o.onProgress) o.onProgress(i, items.length, zip ? 'Making' : 'Checking'); return next(); });
      }
      return Promise.resolve(next()).then(function () {
        var rep = failed.length ? new Blob([V.csvReport([['Row', 'File', 'Problem']].concat(failed))], { type: 'text/csv' }) : null;
        if (zip) return (rep ? zip.add('left-out.csv', rep) : Promise.resolve()).then(function () { return { blob: zip.finish(), name: 'qr-codes.zip', made: made, failed: failed }; });
        if (!good.length) throw new Error('No row passed the test scan, so there is nothing to print.');
        return OUT.pdf(good, { paper: o.paper, cols: o.cols || 3, ctl: ctl, title: 'QR codes', onProgress: function (a, b) { if (o.onProgress) o.onProgress(a, b, 'Laying out'); } }).then(function (blob) { return { blob: blob, name: 'qr-codes.pdf', made: good.length, failed: failed }; });
      });
    });
  };
  function automap(columns, type, prev) {
    var t = Q.TYPES.filter(function (x) { return x.id === type; })[0], low = columns.map(function (c) { return c.toLowerCase(); }), m = {};
    var SYN = { url: ['url', 'link', 'web', 'site'], text: ['text', 'content', 'code', 'value'], ssid: ['ssid', 'network', 'wifi', 'wi-fi'], password: ['pass', 'key'], first: ['first', 'given', 'name'], last: ['last', 'surname', 'family'], org: ['company', 'org'], title: ['title', 'job', 'role'], phone: ['phone', 'mobile', 'tel', 'number'], email: ['email', 'mail'], to: ['email', 'mail', 'to'], upiId: ['upi', 'vpa', 'id'], payee: ['payee', 'name', 'shop'], amount: ['amount', 'price', 'total'], note: ['note', 'memo'], lat: ['lat'], lng: ['lng', 'lon'], link: ['link', 'url', 'chat'], start: ['start', 'date', 'when'], end: ['end'], location: ['where', 'venue', 'location', 'place'], message: ['message', 'text', 'body'], subject: ['subject'], security: ['security', 'type'], label: ['label', 'place'], address: ['address'] };
    t.fields.forEach(function (fd) {
      var words = [fd.k.toLowerCase()].concat(SYN[fd.k] || []), hit = -1;
      words.some(function (w) { hit = low.findIndex(function (c, i) { return c.indexOf(w) >= 0 && Object.keys(m).every(function (k) { return m[k] !== i; }); }); return hit >= 0; });
      m[fd.k] = hit;
    });
    if (t.fields.length === 1 && m[t.fields[0].k] < 0) m[t.fields[0].k] = prev >= 0 && prev < columns.length ? prev : 0;
    return m;
  }
  /* bulk(host, { style(), type() }) builds the "Make many" form. */
  UI.bulk = function (host, opts) {
    var id = 'qrb' + (++seq) + '-', table = null, map = null, items = [], fixes = {}, ctl = null, file = null;
    var root = el('<div class="qr-bulk">' +
      '<p class="qr-hint">One code per row, each in the look you have set above. Paste rows copied from a spreadsheet, or open a CSV, TSV or Excel file. The first row holds the column names. Cells are read as plain text and nothing is uploaded.</p>' +
      '<label class="qr-f qr-f-wide"><span>Paste your rows</span><textarea class="textarea" rows="4" spellcheck="false" id="' + id + 'paste" placeholder="name&#9;link&#10;Table 1&#9;https://example.com/t/1"></textarea></label>' +
      '<div class="qr-row"><label class="btn btn-sm qr-file"><input type="file" hidden accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,text/csv"><span>Open a list file</span></label>' +
      '<label class="qr-f" data-sheets hidden><span>Sheet</span><select class="select" id="' + id + 'sheet"></select></label></div>' +
      '<div class="qr-bulk-map qr-grid" hidden></div><div class="qr-bulk-sum" role="status" aria-live="polite"></div><ul class="qr-bulk-bad"></ul>' +
      '<div class="qr-bulk-out qr-grid" hidden></div>' +
      '<div class="qr-bulk-run" hidden><progress max="1" value="0"></progress><span data-msg></span><button type="button" class="btn btn-sm" data-pause>Pause</button><button type="button" class="btn btn-sm" data-stop>Cancel</button></div></div>');
    host.appendChild(root);
    var paste = root.querySelector('textarea'), fileIn = root.querySelector('input[type=file]'), sheetBox = root.querySelector('[data-sheets]'), sheetSel = sheetBox.querySelector('select');
    var mapBox = root.querySelector('.qr-bulk-map'), sum = root.querySelector('.qr-bulk-sum'), badList = root.querySelector('.qr-bulk-bad'), outBox = root.querySelector('.qr-bulk-out'), runBox = root.querySelector('.qr-bulk-run');
    var out = { format: 'png', px: 1024, paper: 'a4', cols: 3 };
    function fail(e) { sum.textContent = e && e.message ? e.message : String(e); sum.setAttribute('data-state', 'fail'); }
    function useTable(t) {
      table = t; fixes = {};
      var type = map ? map.type : (opts.type && opts.type()) || 'link';
      map = { type: type, fields: automap(t.columns, type), label: -1, file: -1 };
      sheetBox.hidden = !(t.sheets && t.sheets.length > 1);
      if (!sheetBox.hidden) { sheetSel.innerHTML = t.sheets.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join(''); sheetSel.value = t.sheet; }
      drawMap(); replan();
    }
    function colSelect(label, get, set, none) {
      var s = el('<select class="select"></select>');
      s.innerHTML = (none ? '<option value="-1">' + esc(none) + '</option>' : '') + table.columns.map(function (c, i) { return '<option value="' + i + '">' + esc(c) + '</option>'; }).join('');
      s.value = String(get());
      s.onchange = function () { set(Number(s.value)); replan(); };
      var w = el('<label class="qr-f"><span>' + esc(label) + '</span></label>'); w.appendChild(s); return w;
    }
    function drawMap() {
      mapBox.hidden = false; mapBox.innerHTML = '';
      var ts = el('<select class="select" id="' + id + 'type">' + Q.TYPES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('') + '</select>');
      ts.value = map.type;
      ts.onchange = function () { var keys = Object.keys(map.fields), prev = keys.length === 1 ? map.fields[keys[0]] : -1; map.type = ts.value; map.fields = automap(table.columns, map.type, prev); fixes = {}; drawMap(); replan(); };
      var w = el('<label class="qr-f"><span>Each row is a</span></label>'); w.appendChild(ts); mapBox.appendChild(w);
      Q.TYPES.filter(function (t) { return t.id === map.type; })[0].fields.forEach(function (fd) {
        mapBox.appendChild(colSelect(fd.label + ' column', function () { return map.fields[fd.k]; }, function (v) { map.fields[fd.k] = v; }, fd.req ? null : 'Not used'));
      });
      mapBox.appendChild(colSelect('Words under each code', function () { return map.label; }, function (v) { map.label = v; }, 'None'));
      mapBox.appendChild(colSelect('File names from', function () { return map.file; }, function (v) { map.file = v; }, 'The content'));
    }
    function ready() { return items.filter(function (it) { return !it.error; }); }
    function replan() {
      items = UI.plan(table, map, opts.style(), fixes);
      var bad = items.filter(function (it) { return it.error; }), ok = ready();
      sum.setAttribute('data-state', ok.length ? 'ok' : 'fail');
      sum.textContent = ok.length + (ok.length === 1 ? ' row is' : ' rows are') + ' ready' + (bad.length ? ', ' + bad.length + ' left out (fix them below, or carry on without them)' : '') + '.' + (table.warnings.length ? ' ' + table.warnings.join(' ') : '');
      badList.innerHTML = '';
      bad.slice(0, 40).forEach(function (it) {
        var li = el('<li data-row="' + it.row + '"><span><b>Row ' + it.row + '</b> ' + esc(it.error) + '</span><button type="button" class="btn btn-sm" data-fix>Fix here</button></li>');
        li.querySelector('[data-fix]').onclick = function () {
          var form = el('<div class="qr-grid"></div>');
          Q.TYPES.filter(function (t) { return t.id === map.type; })[0].fields.filter(function (fd) { return fd.type !== 'check' && fd.type !== 'select'; }).forEach(function (fd) {
            var inp = el('<input class="input" type="text" maxlength="' + (fd.max || 1200) + '">');
            inp.value = String(it.values[fd.k] || '').slice(0, 1200);
            inp.onchange = function () { fixes[it.row - 1] = fixes[it.row - 1] || {}; fixes[it.row - 1][fd.k] = inp.value; replan(); };
            var w = el('<label class="qr-f"><span>' + esc(fd.label) + '</span></label>'); w.appendChild(inp); form.appendChild(w);
          });
          li.appendChild(form); this.remove();
          form.querySelector('input').focus();
        };
        badList.appendChild(li);
      });
      if (bad.length > 40) badList.appendChild(el('<li>…and ' + (bad.length - 40) + ' more.</li>'));
      drawOut();
    }
    function drawOut() {
      outBox.hidden = !ready().length; outBox.innerHTML = '';
      if (outBox.hidden) return;
      var fmt = el('<div class="qr-f qr-f-wide"><span>Make</span><span class="seg qr-seg" role="group" aria-label="Output"></span></div>');
      [['png', 'PNG files (zip)'], ['svg', 'SVG files (zip)'], ['pdf', 'PDF sheet to print']].forEach(function (f) { var b = el('<button type="button" data-v="' + f[0] + '" aria-pressed="' + (out.format === f[0]) + '">' + f[1] + '</button>'); b.onclick = function () { out.format = f[0]; drawOut(); }; fmt.lastChild.appendChild(b); });
      outBox.appendChild(fmt);
      function pick(label, list, key) { var s = el('<select class="select">' + list.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>'); s.value = String(out[key]); s.onchange = function () { out[key] = isNaN(Number(s.value)) ? s.value : Number(s.value); }; var w = el('<label class="qr-f"><span>' + label + '</span></label>'); w.appendChild(s); outBox.appendChild(w); }
      if (out.format === 'png') pick('Size', [[512, '512 px'], [1024, '1024 px'], [2048, '2048 px']], 'px');
      if (out.format === 'pdf') { pick('Paper', [['a4', 'A4'], ['letter', 'Letter']], 'paper'); pick('Across the page', [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], 'cols'); }
      var go = el('<button type="button" class="btn btn-primary qr-f-wide" data-go>Make ' + ready().length + (ready().length === 1 ? ' code' : ' codes') + '</button>');
      go.onclick = start;
      outBox.appendChild(go);
    }
    function start() {
      var list = ready(), bar = runBox.querySelector('progress'), msg = runBox.querySelector('[data-msg]'), pause = runBox.querySelector('[data-pause]');
      ctl = { paused: false, cancelled: false };
      runBox.hidden = false; outBox.hidden = true;
      pause.textContent = 'Pause';
      pause.onclick = function () { ctl.paused = !ctl.paused; pause.textContent = ctl.paused ? 'Resume' : 'Pause'; };
      runBox.querySelector('[data-stop]').onclick = function () { ctl.cancelled = true; };
      UI.make(list, opts.style(), Object.assign({}, out, { ctl: ctl, onProgress: function (a, b, word) { bar.max = b; bar.value = a; msg.textContent = word + ' ' + a + ' of ' + b; } })).then(function (res) {
        save(res.blob, res.name);
        sum.setAttribute('data-state', res.failed.length ? 'warn' : 'ok');
        sum.textContent = res.made + (res.made === 1 ? ' code' : ' codes') + ' made.' + (res.failed.length ? ' ' + res.failed.length + ' did not pass the test scan and were left out (rows ' + res.failed.slice(0, 12).map(function (f) { return f[0]; }).join(', ') + (res.failed.length > 12 ? '…' : '') + ').' : '');
      }, function (e) { if (e.code === 'cancelled') { sum.textContent = 'Cancelled. Nothing was saved.'; sum.setAttribute('data-state', 'warn'); } else fail(e); }).then(function () { runBox.hidden = true; ctl = null; drawOut(); });
    }
    var parsePaste = debounce(function () {
      if (!paste.value.trim()) return;
      file = null;
      vars().then(function (V) { useTable(V.parseCSV(paste.value)); }).catch(fail);
    }, 350);
    paste.addEventListener('input', parsePaste);
    function openFile(sheet) { return vars().then(function (V) { return V.parseFile(file, sheet ? { sheet: sheet } : {}); }).then(useTable).catch(fail); }
    fileIn.onchange = function () { file = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (file) { paste.value = ''; map = null; openFile(); } };
    sheetSel.onchange = function () { if (file) openFile(sheetSel.value); };
    return { el: root, restyle: function () { if (table) replan(); }, state: function () { return { items: items, map: map, table: table }; }, cap: function () { return vars().then(function (V) { return V.rowCap(); }); } };
  };
})(window);
