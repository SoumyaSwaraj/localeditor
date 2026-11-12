/* LocalEditor: studio export and share (download, share sheet, copy, every size, carousel, process replay).
   Replaces the Download panel (window.LEStudioPanels.export) and exposes window.LEStudioExport. See docs/ROADMAP.md 2.3–2.5. */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  var P = window.LEStudioPanels = window.LEStudioPanels || {};
  var HOOKS = P._hooks = P._hooks || {};
  function hook(name, fn) { (HOOKS[name] = HOOKS[name] || []).push(fn); }

  /* ---------- Device support (LE.support when present, a minimal check otherwise) ---------- */
  var DEFS = [
    { id: 'export.share', name: 'Share to apps', needs: ['web-share-files'], wants: [], memoryMB: 60, downloadMB: 0 },
    { id: 'export.copy', name: 'Copy image', needs: ['clipboard-write-image'], wants: [], memoryMB: 60, downloadMB: 0 },
    { id: 'export.replay', name: 'Process replay video', needs: ['canvas-capture-stream', 'media-recorder'], wants: ['media-recorder-mp4', 'webcodecs-video-encoder'], memoryMB: 120, downloadMB: 0 },
    { id: 'export.every-size', name: 'Export for every platform', needs: [], wants: ['device-memory-4gb'], memoryMB: 110, downloadMB: 0 },
    { id: 'export.carousel', name: 'Carousel slides', needs: [], wants: ['device-memory-4gb'], memoryMB: 90, downloadMB: 0 }
  ];
  var SUPPORT_DEFS = window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || [];
  DEFS.forEach(function (d) { if (!SUPPORT_DEFS.some(function (x) { return x.id === d.id; })) SUPPORT_DEFS.push(d); });

  function tryOr(fn, d) { try { return fn(); } catch (e) { return d; } }
  function testFile() { return new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' }); }
  var CAPS = {
    'web-share-files': function () { return !!(navigator.share && navigator.canShare) && tryOr(function () { return navigator.canShare({ files: [testFile()] }); }, false); },
    'web-share': function () { return !!navigator.share; },
    'clipboard-write-image': function () {
      if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) return false;
      if (typeof window.ClipboardItem.supports === 'function') return tryOr(function () { return window.ClipboardItem.supports('image/png'); }, null);
      return null;
    },
    'media-recorder': function () { return typeof window.MediaRecorder === 'function'; },
    'canvas-capture-stream': function () { return !!(window.HTMLCanvasElement && HTMLCanvasElement.prototype.captureStream); },
    'media-recorder-mp4': function () { return !!(window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4')); },
    'webcodecs-video-encoder': function () { return typeof window.VideoEncoder === 'function'; },
    'device-memory-4gb': function () { return navigator.deviceMemory == null ? null : navigator.deviceMemory >= 4; }
  };
  var WHY = {
    'web-share-files': 'This browser cannot hand files to other apps.',
    'clipboard-write-image': 'This browser cannot put images on the clipboard.',
    'media-recorder': 'This browser cannot record video from the page.',
    'canvas-capture-stream': 'This browser cannot record the canvas.',
    'media-recorder-mp4': 'Videos will be WebM, which some apps do not accept.',
    'webcodecs-video-encoder': 'Video encoding falls back to the slower recorder.',
    'device-memory-4gb': 'This device may be short of memory for large exports.'
  };
  var SUGGEST = {
    'export.share': [{ browser: 'Safari on iPhone and Mac, Chrome on Android, Edge on Windows', reason: 'They open the share sheet with files.' }],
    'export.copy': [{ browser: 'Chrome, Edge and Safari', reason: 'They copy images to the clipboard.' }],
    'export.replay': [{ browser: 'Chrome, Edge or Safari', reason: 'They record MP4 video from the page.' }]
  };
  function ownCheck(id) {
    var def = DEFS.filter(function (d) { return d.id === id; })[0];
    if (!def) return { status: 'unknown', reasons: [], suggest: [], canForce: true };
    var reasons = [], status = 'ok', canForce = true;
    def.needs.forEach(function (cap) {
      var v = CAPS[cap] ? tryOr(CAPS[cap], null) : null;
      if (v === false) { status = 'unsupported'; canForce = false; reasons.push(WHY[cap] || cap); }
      else if (v == null && status !== 'unsupported') { status = 'unknown'; reasons.push('This browser does not say whether it supports this. You can try it.'); }
    });
    if (status === 'ok') def.wants.forEach(function (cap) {
      var v = CAPS[cap] ? tryOr(CAPS[cap], null) : null;
      if (v === false) { status = 'limited'; reasons.push(WHY[cap] || cap); }
    });
    return { status: status, reasons: reasons, suggest: status === 'ok' ? [] : (SUGGEST[id] || []), canForce: canForce };
  }
  function check(id) {
    if (LE.support && typeof LE.support.check === 'function') {
      var r = tryOr(function () { return LE.support.check(id); }, null);
      if (r && r.status) return r;
    }
    return ownCheck(id);
  }
  /* Runs fn when the feature is fine here; otherwise explains, and offers "Try anyway" when that can work. */
  function gate(c, id, title, run, fallback) {
    function safe() {
      try {
        return Promise.resolve(run()).catch(function (err) { c.toast((err && err.message) || 'That did not work here. Nothing was changed.'); });
      } catch (err) { c.toast((err && err.message) || 'That did not work here. Nothing was changed.'); return Promise.resolve(); }
    }
    /* LE.support owns the verdict and the sheet (with our fallback as an action); its gate records a run that
       throws, so the error reaches it first and is explained here afterwards. */
    if (LE.support && typeof LE.support.gate === 'function') {
      return LE.support.gate(id, { title: title, run: run, fallback: fallback }).then(null, function (err) {
        c.toast((err && err.message) || 'That did not work here. Nothing was changed.');
      });
    }
    var r = check(id);
    if (r.status === 'ok' || r.status === 'limited') return safe();
    var box = c.h('<div class="sxe-gate"></div>');
    box.appendChild(c.h('<p>' + c.esc(r.status === 'unsupported' ? 'Not available in this browser.' : 'This browser may not support this.') + '</p>'));
    if (r.reasons.length) box.appendChild(c.h('<ul>' + r.reasons.map(function (t) { return '<li>' + c.esc(t) + '</li>'; }).join('') + '</ul>'));
    (r.suggest || []).forEach(function (s) { box.appendChild(c.h('<p class="sxe-muted">Works in ' + c.esc(s.browser) + '. ' + c.esc(s.reason || '') + '</p>')); });
    var row = c.h('<div class="sxe-gate-act"></div>');
    var ok = c.h('<button type="button" class="btn btn-sm">OK</button>');
    ok.onclick = function () { c.closeModal(); };
    row.appendChild(ok);
    if (fallback) {
      var fb = c.h('<button type="button" class="btn btn-sm btn-ink" data-fallback>' + c.esc(fallback.label) + '</button>');
      fb.onclick = function () { c.closeModal(); fallback.run(); };
      row.appendChild(fb);
    }
    if (r.canForce) {
      var force = c.h('<button type="button" class="btn btn-sm' + (fallback ? '' : ' btn-ink') + '" data-force>Try anyway</button>');
      force.onclick = function () { c.closeModal(); safe(); };
      row.appendChild(force);
    }
    box.appendChild(row);
    c.openModal(c.esc(title), box);
    return Promise.resolve();
  }
  function supportNote(id) {
    var r = check(id);
    if (r.status !== 'unsupported') return '';
    var sug = r.suggest || [];
    var upd = sug.filter(function (s) { return s.update; })[0];
    var other = sug.filter(function (s) { return s.browser; })[0];
    return 'Not available in this browser' + (upd ? ' — update ' + upd.name + ' to use it' : other ? ' — works in ' + other.browser : '') + '.';
  }

  /* ---------- Small helpers ---------- */
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'size'; }
  function extOf(fmt) { return fmt === 'jpeg' ? 'jpg' : fmt; }
  function mimeOf(fmt) { return { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[fmt] || 'image/png'; }
  function release(cv) { if (cv && cv.getContext) { cv.width = 1; cv.height = 1; } }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function base(c) { return c.safeName(c.S.project ? c.S.project.name : 'design'); }
  function zipOf(items) {
    var files = [];
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () { return it.blob.arrayBuffer(); }).then(function (buf) { files.push({ name: it.name, data: new Uint8Array(buf) }); });
    });
    return chain.then(function () { return LE.zip(files); });
  }
  function encodeCanvas(cv, fmt, quality) { return LE.exportImage(cv, { format: fmt, quality: quality }); }

  /* ---------- Share sheet, clipboard ---------- */
  /* items: Blob, File or { blob, name }. Resolves 'shared' | 'cancelled' | 'unsupported' | 'failed'. */
  function share(c, items, opts) {
    opts = opts || {};
    var files = (Array.isArray(items) ? items : [items]).map(function (it, i) {
      if (window.File && it instanceof File) return it;
      var blob = it.blob || it;
      var name = it.name || (base(c) + '-' + (i + 1) + '.' + (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg'));
      return new File([blob], name, { type: blob.type });
    });
    var can = !!(navigator.share && navigator.canShare) && tryOr(function () { return navigator.canShare({ files: files }); }, false);
    if (!can) return Promise.resolve('unsupported');
    var data = { files: files };
    if (opts.title) data.title = opts.title;
    return navigator.share(data).then(function () { return 'shared'; }, function (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      return 'failed';
    });
  }
  /* Shares when the browser can, otherwise downloads (one file, or a zip for several). */
  function shareOrDownload(c, items, zipName) {
    return share(c, items, { title: c.S.project && c.S.project.name }).then(function (r) {
      if (r === 'shared') { c.toast('Shared'); if (LE.support && LE.support.reportSuccess) LE.support.reportSuccess('export.share'); return r; }
      if (r === 'cancelled') return r;
      var msg = r === 'unsupported' ? 'Sharing files is not available here, so it was downloaded instead.' : 'Sharing did not work, so it was downloaded instead.';
      var done = items.length === 1 ? Promise.resolve(c.download(items[0].blob, items[0].name)) : zipOf(items).then(function (z) { c.download(z, zipName || base(c) + '.zip'); });
      return done.then(function () { c.toast(msg); return 'downloaded'; });
    });
  }
  function currentCanvas(c, o) {
    var scale = Math.min(o.scale || 1, c.maxScale());
    var transparent = !!o.transparent && o.format !== 'jpeg';
    return c.scene.render(scale, { includeBackground: !transparent });
  }
  /* Copies the current page as PNG. Calls clipboard.write inside the click so Safari keeps the gesture. */
  function copy(c, opts) {
    var o = Object.assign({}, c.S.exportOpts, opts || {}, { format: 'png' });
    if (!c.S.project) { c.toast('Open a photo or start a design first.'); return Promise.resolve(false); }
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) {
      c.toast('Copy image is not available in this browser — works in Chrome, Edge and Safari. Use Download instead.');
      return Promise.resolve(false);
    }
    var png = currentCanvas(c, o).then(function (cv) { return LE.toBlob(cv, 'image/png').then(function (b) { release(cv); return b; }); });
    var write;
    try { write = navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]); }
    catch (e) { write = png.then(function (b) { return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })]); }); }
    return write.then(function () {
      c.toast('Copied as PNG — paste it into any app');
      if (LE.support && LE.support.reportSuccess) LE.support.reportSuccess('export.copy');
      return true;
    }, function (err) {
      var why = err && err.name === 'NotAllowedError' ? 'the browser blocked clipboard access' : 'this browser refused the image';
      c.toast('Could not copy: ' + why + '. Use Download instead.');
      return false;
    });
  }

  /* Blobs for the image tab: current page, or every page. */
  function pageItems(c, o, numbered) {
    var p = c.S.project;
    c.syncProject();
    var ext = extOf(o.format);
    var idx = o.pages === 'all' || numbered ? p.pages.map(function (x, i) { return i; }) : [p.activePage];
    var out = [];
    var chain = Promise.resolve();
    idx.forEach(function (i, k) {
      chain = chain.then(function () {
        var scale = Math.min(o.scale || 1, c.maxScale());
        var transparent = !!o.transparent && o.format !== 'jpeg';
        var r = i === p.activePage ? c.scene.render(scale, { includeBackground: !transparent }) : c.hiddenRender(p.pages[i], scale, { includeBackground: !transparent });
        return r;
      }).then(function (cv) {
        return encodeCanvas(cv, o.format, o.quality).then(function (b) {
          release(cv);
          var nm = idx.length === 1 ? base(c) + '.' + ext : numbered ? base(c) + '-' + pad2(k + 1) + '.' + ext : base(c) + '-page-' + (i + 1) + '.' + ext;
          out.push({ name: nm, blob: b });
        });
      });
    });
    return chain.then(function () { return out; });
  }

  /* ---------- One design, every size ---------- */
  var SIZE_KEY = 'le-studio-export-sizes';
  var DEFAULT_SIZES = ['ig-post', 'ig-portrait', 'ig-story', 'fb-post', 'x-post', 'li-post'];
  var sizeState = null;
  function sizeSt(c) {
    if (sizeState) return sizeState;
    var saved = c.lsGet(SIZE_KEY, null) || {};
    sizeState = { ids: Array.isArray(saved.ids) ? saved.ids : DEFAULT_SIZES.slice(), custom: Array.isArray(saved.custom) ? saved.custom.slice(0, 12) : [], format: saved.format || 'jpeg', quality: saved.quality || 0.9, over: {} };
    return sizeState;
  }
  function saveSizeSt(c) { var s = sizeSt(c); c.lsSet(SIZE_KEY, { ids: s.ids, custom: s.custom, format: s.format, quality: s.quality }); }
  function chosenSizes(c) {
    var s = sizeSt(c);
    var list = c.SIZES.filter(function (z) { return s.ids.indexOf(z.id) >= 0; });
    s.custom.forEach(function (z) { if (s.ids.indexOf(z.id) >= 0) list.push(z); });
    return list;
  }
  function normSize(z) { return { id: z.id || ('custom-' + z.w + 'x' + z.h), name: z.name || ('Custom ' + z.w + ' × ' + z.h), w: Math.round(z.w), h: Math.round(z.h), group: z.group }; }
  function sizeFileName(c, z, ext) { return base(c) + '-' + slug(z.name.replace(/^Custom\s.*$/, 'custom')) + '-' + z.w + 'x' + z.h + '.' + ext; }
  /* The adapted document for one size, from the same source and settings the Resize panel uses. Never touches the open page. */
  function adaptedDoc(c, z, over) {
    var src = c.size.source(c.doc(), c.size.chain());
    var o = c.size.opts(Object.assign({ region: src.region }, over || {}));
    var d = c.size.compute(src.from, z.w, z.h, o);
    delete d.carousel;
    return d;
  }
  /* Renders each size in turn and encodes it. opts: { format, quality, onProgress(i, n, size), signal:{cancelled}, over:{id:{fit,focal}} }.
     Resolves [{ name, blob, width, height, size }]. Each bitmap is released before the next one starts. */
  function renderSizes(c, sizes, opts) {
    opts = opts || {};
    var fmt = opts.format || 'jpeg';
    var q = opts.quality == null ? 0.9 : opts.quality;
    var out = [];
    var list = sizes.map(normSize);
    var chain = Promise.resolve();
    c.syncProject();
    list.forEach(function (z, i) {
      chain = chain.then(function () {
        if (opts.signal && opts.signal.cancelled) throw cancelled();
        if (opts.onProgress) opts.onProgress(i, list.length, z);
        var d = adaptedDoc(c, z, (opts.over || {})[z.id]);
        return c.hiddenRender(d, 1, { includeBackground: true });
      }).then(function (cv) {
        return encodeCanvas(cv, fmt, q).then(function (b) {
          var item = { name: sizeFileName(c, z, extOf(fmt)), blob: b, width: cv.width, height: cv.height, size: z };
          release(cv);
          out.push(item);
          return tick();
        });
      });
    });
    return chain.then(function () { if (opts.onProgress) opts.onProgress(list.length, list.length, null); return out; });
  }
  function cancelled() { var e = new Error('Cancelled'); e.cancelled = true; return e; }
  function thumbFor(c, z, over, max) {
    var d = adaptedDoc(c, z, over);
    var scale = Math.min(1, (max || 240) / Math.max(z.w, z.h));
    return c.hiddenRender(d, scale, { small: true }).then(function (cv) {
      return LE.toBlob(cv, 'image/jpeg', 0.82).then(function (b) { release(cv); return URL.createObjectURL(b); });
    });
  }

  /* ---------- Carousel ---------- */
  function carInfo(c) {
    var d = c.doc();
    var car = LE.Scene.carouselOf ? LE.Scene.carouselOf(d.carousel) : null;
    if (!car) return null;
    return { slides: car.slides, slideWidth: d.width / car.slides, height: d.height, width: d.width };
  }
  function rootsOf(d) {
    var groups = {};
    d.layers.forEach(function (l) { if (l.type === 'group') groups[l.id] = l; });
    return groups;
  }
  /* Moves every layer whose root (the layer, or its group) has its centre right of x by dx. */
  function shiftRight(d, x, dx, dropRange) {
    var groups = rootsOf(d);
    function root(l) { return l.groupId && groups[l.groupId] ? groups[l.groupId] : l; }
    var drop = {};
    d.layers.forEach(function (l) {
      var r = root(l);
      var cx = r.x + r.w / 2;
      if (dropRange && cx >= dropRange[0] && cx < dropRange[1]) { drop[l.id] = 1; return; }
      if (cx >= x) l.x = Math.round((l.x + dx) * 1000) / 1000;
    });
    if (dropRange) d.layers = d.layers.filter(function (l) { return !drop[l.id]; });
    return Object.keys(drop).length;
  }
  var carousel = {
    info: carInfo,
    /* Turns the open page into N slides. The current page becomes slide 1; content stays where it is. */
    make: function (c, opts) {
      opts = opts || {};
      var d = c.doc();
      var cur = carInfo(c);
      var sw = opts.slideWidth || (cur ? cur.slideWidth : d.width);
      var n = Math.max(1, Math.min(20, Math.round(opts.slides || (cur ? cur.slides : 3))));
      if (opts.slideHeight) d.height = Math.round(opts.slideHeight);
      d.width = Math.round(sw * n);
      d.carousel = { v: 1, slides: n, slideWidth: Math.round(sw * 100) / 100 };
      c.replaceDoc(d, true);
      c.fit();
      c.renderFoot();
      c.markDirty();
      return d.carousel;
    },
    /* Back to a single page the width of one slide (content beyond stays in the document, off the page). */
    unmake: function (c) {
      var info = carInfo(c);
      if (!info) return;
      var d = c.doc();
      d.width = Math.round(info.slideWidth * info.slides);
      delete d.carousel;
      c.replaceDoc(d, true);
      c.markDirty();
    },
    /* Inserts a blank slide after index `at` (default: at the end); slides to its right move with their content. */
    addSlide: function (c, at) {
      var info = carInfo(c);
      if (!info) return null;
      if (info.slides >= 20) { c.toast('A carousel holds up to 20 slides.'); return null; }
      if (at == null || at >= info.slides) at = info.slides;
      var d = c.doc();
      var sw = info.slideWidth;
      shiftRight(d, at * sw, sw);
      d.width = Math.round(sw * (info.slides + 1));
      d.carousel = { v: 1, slides: info.slides + 1, slideWidth: Math.round(sw * 100) / 100 };
      c.replaceDoc(d, true);
      c.fit();
      c.renderFoot();
      c.markDirty();
      return d.carousel;
    },
    /* Removes slide i (default: the last). Its layers go; layers to its right move left. One undo step. */
    removeSlide: function (c, i) {
      var info = carInfo(c);
      if (!info || info.slides < 2) { c.toast('A carousel needs at least one slide.'); return null; }
      if (i == null || i >= info.slides) i = info.slides - 1;
      var d = c.doc();
      var sw = info.slideWidth;
      var gone = shiftRight(d, (i + 1) * sw, -sw, [i * sw, (i + 1) * sw]);
      d.width = Math.round(sw * (info.slides - 1));
      if (info.slides - 1 > 1) d.carousel = { v: 1, slides: info.slides - 1, slideWidth: Math.round(sw * 100) / 100 };
      else delete d.carousel;
      c.replaceDoc(d, true);
      c.fit();
      c.renderFoot();
      c.markDirty();
      if (gone) c.toast('Removed slide ' + (i + 1) + ' and ' + gone + ' layer' + (gone > 1 ? 's' : '') + ' on it', { action: { label: 'Undo', fn: function () { c.scene.undo(); } } });
      return d.carousel || null;
    },
    /* Starts a new carousel design (e.g. Instagram carousel 1080 × 1350 × 3). */
    newDesign: function (c, opts) {
      opts = opts || {};
      var w = opts.w || 1080, hh = opts.h || 1350, n = Math.max(2, Math.min(20, opts.slides || 3));
      c.newDesign(w * n, hh, opts.name || 'Instagram carousel');
      var d = c.doc();
      d.carousel = { v: 1, slides: n, slideWidth: w };
      c.replaceDoc(d, false);
      c.fit();
      c.markDirty();
      return d.carousel;
    },
    /* Splits the page into N slide images. Renders the whole width once when it fits the device, otherwise in bands. */
    split: function (c, opts) {
      opts = opts || {};
      var info = carInfo(c);
      var d = c.doc();
      var n = info ? info.slides : (opts.slides || 1);
      var sw = d.width / n;
      var fmt = opts.format || 'jpeg';
      var q = opts.quality == null ? 0.92 : opts.quality;
      var scale = opts.scale || 1;
      var maxEdge = { older: 4096, modern: 8192, desktop: 16384 }[LE.device.tier()] || 8192;
      var per = Math.max(1, Math.floor(maxEdge / Math.ceil(sw * scale)));
      var out = [];
      var chain = Promise.resolve();
      for (var b0 = 0; b0 < n; b0 += per) (function (b0) {
        var k = Math.min(per, n - b0);
        chain = chain.then(function () {
          if (opts.signal && opts.signal.cancelled) throw cancelled();
          var band = c.clone(d);
          delete band.carousel;
          if (b0 > 0 || k < n) {
            band.width = Math.round(sw * k);
            band.layers.forEach(function (l) { l.x = l.x - sw * b0; });
          }
          return c.hiddenRender(band, scale, { includeBackground: !(opts.transparent && fmt !== 'jpeg') });
        }).then(function (cv) {
          var w = Math.round(sw * scale), hgt = cv.height;
          var inner = Promise.resolve();
          for (var j = 0; j < k; j++) (function (j) {
            inner = inner.then(function () {
              var s = document.createElement('canvas');
              s.width = w; s.height = hgt;
              s.getContext('2d').drawImage(cv, Math.round(j * sw * scale), 0, w, hgt, 0, 0, w, hgt);
              if (opts.onProgress) opts.onProgress(b0 + j, n);
              return encodeCanvas(s, fmt, q).then(function (blob) {
                release(s);
                out.push({ name: base(c) + '-slide-' + pad2(b0 + j + 1) + '.' + extOf(fmt), blob: blob, width: w, height: hgt });
              });
            });
          })(j);
          return inner.then(function () { release(cv); });
        });
      })(b0);
      return chain.then(function () { return out; });
    }
  };
  /* Slide edges join the snap targets while a carousel is open. */
  function wrapCarouselSnap(c) {
    var sc = c.scene;
    if (sc._leCarSnap || typeof sc._snapRect !== 'function') return;
    sc._leCarSnap = true;
    var orig = sc._snapRect;
    sc._snapRect = function (box, ignore) {
      var r = orig.call(this, box, ignore);
      var car = this._doc.carousel;
      if (!car || car.slides < 2 || !r || r.x !== box.x) return r;
      if (c.S.ov && c.S.ov.snap === false) return r;
      var th = 6 / (this._zoom || 1), sw = this._doc.width / car.slides, best = null;
      for (var i = 1; i < car.slides; i++) {
        var v = i * sw;
        [[v - box.x, v], [v - (box.x + box.w), v], [(v - sw / 2) - (box.x + box.w / 2), v - sw / 2], [(v + sw / 2) - (box.x + box.w / 2), v + sw / 2]].forEach(function (t) {
          if (Math.abs(t[0]) <= th && (!best || Math.abs(t[0]) < Math.abs(best[0]))) best = t;
        });
      }
      if (!best) return r;
      var g = (r.guides || []).slice();
      g.push({ x1: best[1], y1: 0, x2: best[1], y2: this._doc.height });
      return Object.assign({}, r, { x: box.x + best[0], guides: g });
    };
  }
  /* Floating slide strip on the stage: jump to a slide, add one. */
  var strip = null;
  function paintStrip(c) {
    var info = c.S.project ? carInfo(c) : null;
    if (!info) { if (strip) strip.hidden = true; return; }
    if (!strip) {
      strip = c.h('<nav class="sxe-strip" aria-label="Carousel slides"></nav>');
      c.E.stage.appendChild(strip);
    }
    strip.hidden = false;
    var html = '<span class="sxe-strip-lb">Slides</span>';
    for (var i = 0; i < info.slides; i++) html += '<button type="button" data-slide="' + i + '" aria-label="Go to slide ' + (i + 1) + '">' + (i + 1) + '</button>';
    html += '<button type="button" class="sxe-strip-add" data-add aria-label="Add a slide">' + c.ic('plus') + '</button>';
    strip.innerHTML = html;
    strip.querySelectorAll('[data-slide]').forEach(function (b) { b.onclick = function () { goSlide(c, Number(b.getAttribute('data-slide'))); }; });
    strip.querySelector('[data-add]').onclick = function () { carousel.addSlide(c); };
  }
  function goSlide(c, i) {
    var info = carInfo(c);
    if (!info) return;
    var el = c.E.sceneEl;
    var W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    var z = Math.min((W - 48) / info.slideWidth, (H - 96) / info.height);
    var cx = (i + 0.5) * info.slideWidth;
    c.S.fitting = true;
    c.scene.setView(z, W / 2 - cx * z, (H - 40) / 2 - info.height / 2 * z);
    c.S.fitting = false;
    c.S.autoFit = false;
    if (strip) strip.querySelectorAll('[data-slide]').forEach(function (b) { b.setAttribute('aria-current', Number(b.getAttribute('data-slide')) === i ? 'true' : 'false'); });
  }

  /* ---------- Process replay ---------- */
  /* Timeline: one lightweight snapshot per history commit (document JSON only; image layers reference asset ids, never pixels).
     Kept in memory for this session, per project and page. Capped by count and bytes; older steps are thinned first. */
  var TL = { byKey: {}, maxSteps: 160, maxBytes: 3 * 1024 * 1024, coalesceMs: 250, enabled: true };
  function tlKey(c) { var p = c.S.project; return p ? p.id + ':' + p.activePage : ''; }
  function tlList(c) { var k = tlKey(c); if (!k) return null; return (TL.byKey[k] = TL.byKey[k] || { steps: [], bytes: 0, thinned: 0 }); }
  function tlRecord(c, force) {
    if (!TL.enabled || !c.S.project || c.S.preview || c.S.silent) return;
    var t = tlList(c);
    var json = c.scene._snapshot ? c.scene._snapshot() : JSON.stringify(c.doc());
    var last = t.steps[t.steps.length - 1];
    if (last && last.json === json) return;
    var now = Date.now();
    if (!force && last && t.steps.length > 1 && now - last.at < TL.coalesceMs) { t.bytes -= last.json.length * 2; t.steps.pop(); }
    t.steps.push({ at: now, json: json });
    t.bytes += json.length * 2;
    thin(t);
  }
  function thin(t) {
    while ((t.steps.length > TL.maxSteps || t.bytes > TL.maxBytes) && t.steps.length > 3) {
      var half = Math.max(2, Math.floor(t.steps.length / 2));
      var removed = 0;
      for (var i = half - 1; i >= 1; i -= 2) { t.bytes -= t.steps[i].json.length * 2; t.steps.splice(i, 1); removed++; }
      t.thinned += removed;
      if (!removed) { t.bytes -= t.steps[1].json.length * 2; t.steps.splice(1, 1); t.thinned++; }
    }
  }
  function tlStats(c) {
    var t = c && c.S.project ? tlList(c) : null;
    var all = Object.keys(TL.byKey).reduce(function (a, k) { a.steps += TL.byKey[k].steps.length; a.bytes += TL.byKey[k].bytes; return a; }, { steps: 0, bytes: 0 });
    return { steps: t ? t.steps.length : 0, bytes: t ? t.bytes : 0, thinned: t ? t.thinned : 0, totalSteps: all.steps, totalBytes: all.bytes, maxSteps: TL.maxSteps, maxBytes: TL.maxBytes };
  }

  function videoTypes() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return [];
    var list = [
      ['mp4', 'video/mp4;codecs=avc1.42E01E'], ['mp4', 'video/mp4;codecs=avc1'], ['mp4', 'video/mp4'],
      ['webm', 'video/webm;codecs=vp9'], ['webm', 'video/webm;codecs=vp8'], ['webm', 'video/webm']
    ];
    var seen = {};
    return list.filter(function (t) {
      if (seen[t[0]]) return false;
      var ok = tryOr(function () { return MediaRecorder.isTypeSupported(t[1]); }, false);
      if (ok) seen[t[0]] = 1;
      return ok;
    }).map(function (t) { return { ext: t[0], mime: t[1] }; });
  }
  function videoCap() {
    var tier = LE.device.tier();
    var lvl = LE.perf && LE.perf.level ? LE.perf.level() : 'high';
    if (tier === 'older' || lvl === 'low') return 540;
    if (tier === 'modern' || lvl === 'mid') return 720;
    return 1080;
  }
  function even(n) { n = Math.max(2, Math.round(n)); return n % 2 ? n - 1 : n; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function weights(n, curve) {
    var w = [];
    for (var i = 0; i < n; i++) {
      var u = n > 1 ? i / (n - 1) : 0;
      w.push(curve === 'ease' ? 1 + 1.6 * Math.pow(Math.cos(Math.PI * u), 2) : curve === 'quick' ? 2.2 - 1.6 * u : 1);
    }
    var s = w.reduce(function (a, b) { return a + b; }, 0);
    return w.map(function (x) { return x / s; });
  }

  /* A private offscreen scene for replay frames, reused across steps. */
  function frameScene(c, d, small) {
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:96px;height:96px;pointer-events:none;';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    var sc = new LE.Scene({ el: host, width: d.width, height: d.height });
    Object.keys(c.mem).forEach(function (id) {
      var m = c.mem[id];
      if (!m || !m.canvas) return;
      if (small) { if (!m.small) m.small = LE.fit(m.canvas, 900); sc.addAsset(id, m.small); } else sc.addAsset(id, m.canvas);
    });
    return {
      render: function (doc, scale, opts) { sc.load(doc); return sc.render(scale, opts || {}); },
      destroy: function () { try { sc.destroy(); } catch (e) {} host.remove(); }
    };
  }
  /* Segments: each prepares its frames (renders, off the clock) then draws at time u in [0, 1]. */
  function buildPlan(c, opts) {
    var d = c.doc();
    var t = tlList(c);
    var steps = (t && t.steps.length > 1 && opts.mode !== 'build') ? t.steps.map(function (s) { return JSON.parse(s.json); }) : null;
    if (steps && steps.length > 1 && JSON.stringify(steps[steps.length - 1]) !== JSON.stringify(d)) steps.push(d);
    var mode = steps && steps.length > 1 ? 'timeline' : 'build';
    var len = Math.max(4, Math.min(30, opts.length || 10));
    var hold = Math.max(0, Math.min(4, opts.hold == null ? 1.5 : opts.hold));
    var cap = opts.maxEdge || videoCap();
    var k = Math.min(1, cap / Math.max(d.width, d.height));
    var W = even(d.width * k), H = even(d.height * k);
    var scale = W / d.width;
    var segs = [];
    if (mode === 'timeline') {
      var maxSteps = Math.max(2, Math.round((len - hold) * 8));
      if (steps.length > maxSteps) {
        var picked = [];
        for (var i = 0; i < maxSteps; i++) picked.push(steps[Math.round(i * (steps.length - 1) / (maxSteps - 1))]);
        steps = picked;
      }
      var first = steps[0];
      var ws = weights(steps.length - 1, opts.curve);
      segs.push({ kind: 'state', doc: first, from: null, dur: 0.5 });
      for (var j = 1; j < steps.length; j++) segs.push({ kind: 'state', doc: steps[j], dur: Math.max(0.06, (len - hold - 0.5) * ws[j - 1]) });
    } else {
      var groups = {};
      d.layers.forEach(function (l) { if (l.type === 'group') groups[l.id] = l; });
      var units = [];
      var unitOf = {};
      d.layers.forEach(function (l) {
        if (l.type === 'group' || l.visible === false) return;
        var key = l.groupId && groups[l.groupId] ? l.groupId : l.id;
        if (unitOf[key] == null) { unitOf[key] = units.length; units.push([]); }
        units[unitOf[key]].push(l.id);
      });
      var plainBg = !d.background || d.background.type === 'color';
      var bgDur = units.length ? (plainBg ? 0.35 : 0.8) : Math.max(1, len - hold);
      var wb = weights(units.length, opts.curve);
      var avail = Math.max(units.length * 0.12, len - hold - bgDur);
      segs.push({ kind: 'bg', doc: Object.assign({}, d, { layers: [] }), dur: bgDur });
      var shown = {};
      units.forEach(function (ids, ui) {
        ids.forEach(function (id) { shown[id] = 1; });
        var upto = Object.keys(shown).reduce(function (a, k2) { a[k2] = 1; return a; }, {});
        var cum = Object.assign({}, d, { layers: d.layers.filter(function (l) { return upto[l.id] || (l.type === 'group' && ids.indexOf(l.id) < 0 && d.layers.some(function (m) { return m.groupId === l.id && upto[m.id]; })); }) });
        var only = Object.assign({}, d, { layers: d.layers.filter(function (l) { return ids.indexOf(l.id) >= 0 || (l.type === 'group' && d.layers.some(function (m) { return m.groupId === l.id && ids.indexOf(m.id) >= 0; })); }) });
        segs.push({ kind: 'layer', doc: cum, only: only, dur: Math.min(1.4, avail * wb[ui]) });
      });
    }
    var used = segs.reduce(function (a, s) { return a + s.dur; }, 0);
    segs.push({ kind: 'hold', dur: Math.max(hold, len - used) });
    return { mode: mode, W: W, H: H, scale: scale, segs: segs, doc: d, duration: segs.reduce(function (a, s) { return a + s.dur; }, 0), small: W <= 720 };
  }
  function drawTag(ctx, W, H, a) {
    if (a <= 0) return;
    var fs = Math.max(11, Math.round(Math.min(W, H) * 0.028));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 ' + fs + 'px "Plus Jakarta Sans", system-ui, sans-serif';
    var text = 'Made with LocalEditor';
    var tw = ctx.measureText(text).width;
    var padX = fs * 0.8, bh = fs * 2, bw = tw + padX * 2 + fs * 1.1;
    var x = W - bw - fs, y = H - bh - fs;
    ctx.fillStyle = 'rgba(20,19,24,.78)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bh / 2); else ctx.rect(x, y, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#E8BF6A';
    ctx.beginPath(); ctx.arc(x + padX + fs * 0.3, y + bh / 2, fs * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F2EFE9';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX + fs * 1.0, y + bh / 2 + 0.5);
    ctx.restore();
  }
  /* Runs the plan, calling sink.frame() as frames are drawn. sink: { pause(), resume(), frameAt(u) } */
  function runPlan(c, plan, opts, sink) {
    var out = document.createElement('canvas');
    out.width = plan.W; out.height = plan.H;
    var ctx = out.getContext('2d');
    var fs = frameScene(c, plan.doc, plan.small);
    var prev = document.createElement('canvas'); prev.width = plan.W; prev.height = plan.H;
    var pctx = prev.getContext('2d');
    pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, plan.W, plan.H);
    var signal = opts.signal || {};
    var dy = plan.H * 0.03;
    var cur = null, lay = null;
    function draw(seg, u) {
      ctx.globalAlpha = 1;
      ctx.drawImage(prev, 0, 0);
      if (seg.kind === 'state' || seg.kind === 'bg') {
        var a = easeOut(Math.min(1, u * (seg.dur > 0.5 ? seg.dur / 0.45 : 1.6)));
        ctx.globalAlpha = a;
        ctx.drawImage(cur, 0, 0, plan.W, plan.H);
      } else if (seg.kind === 'layer') {
        var e = easeOut(Math.min(1, u * Math.max(1, seg.dur / 0.5)));
        ctx.save();
        ctx.globalAlpha = e;
        var s = 0.965 + 0.035 * e;
        ctx.translate(plan.W / 2, plan.H / 2 + (1 - e) * dy);
        ctx.scale(s, s);
        ctx.translate(-plan.W / 2, -plan.H / 2);
        ctx.drawImage(lay, 0, 0, plan.W, plan.H);
        ctx.restore();
        if (e >= 1) { ctx.globalAlpha = 1; ctx.drawImage(cur, 0, 0, plan.W, plan.H); }
      } else if (seg.kind === 'hold' && opts.endTag) {
        drawTag(ctx, plan.W, plan.H, Math.min(1, u * seg.dur / 0.4));
      }
      ctx.globalAlpha = 1;
    }
    var i = 0;
    function next() {
      if (signal.cancelled) return Promise.reject(cancelled());
      if (i >= plan.segs.length) return Promise.resolve();
      var seg = plan.segs[i++];
      if (opts.onProgress) opts.onProgress(i - 1, plan.segs.length);
      sink.pause();
      var prep;
      if (seg.kind === 'hold') prep = Promise.resolve();
      else if (seg.kind === 'layer') {
        prep = fs.render(seg.only, plan.scale, { includeBackground: false }).then(function (cv) { release(lay); lay = cv; return fs.render(seg.doc, plan.scale); }).then(function (cv) { release(cur); cur = cv; });
      } else prep = fs.render(seg.doc, plan.scale).then(function (cv) { release(cur); cur = cv; });
      return prep.then(function () {
        draw(seg, 0);
        return sink.play(seg.dur, function (u) { draw(seg, u); });
      }).then(function () {
        if (seg.kind !== 'hold') { draw(seg, 1); pctx.drawImage(out, 0, 0); }
        return next();
      });
    }
    function cleanup() { fs.destroy(); release(prev); release(cur); release(lay); }
    return { canvas: out, run: function () { return next().then(function (r) { cleanup(); return r; }, function (err) { cleanup(); throw err; }); } };
  }
  /* Records the replay. Resolves { blob, mime, ext, duration, mode, width, height }, or a frame zip when video recording is missing. */
  function exportReplay(c, opts) {
    opts = opts || {};
    if (!c.S.project) return Promise.reject(new Error('Open a design first.'));
    c.syncProject();
    var plan = buildPlan(c, opts);
    var types = videoTypes();
    var want = opts.container ? types.filter(function (t) { return t.ext === opts.container; })[0] : null;
    var type = want || types[0];
    var canRecord = type && window.HTMLCanvasElement && HTMLCanvasElement.prototype.captureStream && !opts.frames;
    if (!canRecord) return exportFrames(c, plan, opts);
    var rec, chunks = [], stream;
    var sink = {
      pause: function () { if (rec && rec.state === 'recording') rec.pause(); },
      play: function (dur, drawAt) {
        if (rec.state === 'paused') rec.resume();
        return new Promise(function (resolve) {
          var t0 = performance.now();
          var track = stream.getVideoTracks()[0];
          (function loop() {
            var u = Math.min(1, (performance.now() - t0) / (dur * 1000));
            drawAt(u);
            if (track && track.requestFrame) track.requestFrame();
            if (u >= 1 || (opts.signal && opts.signal.cancelled)) { resolve(); return; }
            if (document.hidden) setTimeout(loop, 16); else requestAnimationFrame(loop);
          })();
        });
      }
    };
    var runner = runPlan(c, plan, opts, sink);
    stream = runner.canvas.captureStream(30);
    var px = plan.W * plan.H;
    rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: Math.round(Math.min(8e6, Math.max(1.5e6, px * 4.5))) });
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var stopped = new Promise(function (res) { rec.onstop = res; });
    rec.start(250);
    rec.pause();
    return runner.run().then(function () {
      if (rec.state === 'paused') rec.resume();
      rec.stop();
      return stopped;
    }, function (err) {
      try { rec.stop(); } catch (e) {}
      stream.getTracks().forEach(function (t) { t.stop(); });
      throw err;
    }).then(function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      var blob = new Blob(chunks, { type: type.mime.split(';')[0] });
      release(runner.canvas);
      return { blob: blob, mime: blob.type, ext: type.ext, duration: plan.duration, mode: plan.mode, width: plan.W, height: plan.H, name: base(c) + '-replay.' + type.ext };
    });
  }
  /* No video recorder here: the same frames as numbered JPEGs in a zip (10 per second). */
  function exportFrames(c, plan, opts) {
    var fps = opts.fps || 10;
    var files = [];
    var n = 0;
    var sink = {
      pause: function () {},
      play: function (dur, drawAt) {
        var count = Math.max(1, Math.round(dur * fps));
        var chain = Promise.resolve();
        for (var f = 1; f <= count; f++) (function (f) {
          chain = chain.then(function () {
            drawAt(f / count);
            return LE.toBlob(runner.canvas, 'image/jpeg', 0.85).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
              n++;
              files.push({ name: 'frame-' + ('0000' + n).slice(-4) + '.jpg', data: new Uint8Array(buf) });
            });
          });
        })(f);
        return chain;
      }
    };
    var runner = runPlan(c, plan, opts, sink);
    return runner.run().then(function () {
      var blob = LE.zip(files);
      release(runner.canvas);
      return { blob: blob, mime: 'application/zip', ext: 'zip', frames: true, fps: fps, duration: plan.duration, mode: plan.mode, width: plan.W, height: plan.H, name: base(c) + '-replay-frames.zip' };
    });
  }

  /* ---------- Panel ---------- */
  var TABS = [['image', 'Image'], ['sizes', 'Every size'], ['slides', 'Slides'], ['replay', 'Replay']];
  function tabsRow(c, body, active) {
    var bar = c.h('<div class="sx-tabs-row sxe-tabs" role="tablist"></div>');
    TABS.forEach(function (t) {
      var b = c.h('<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === active) + '">' + c.esc(t[1]) + '</button>');
      b.onclick = function () { c.openPanel('export', { tab: t[0] }); };
      bar.appendChild(b);
    });
    body.appendChild(bar);
  }
  function btn(c, label, icon, cls, fn) {
    var b = c.h('<button type="button" class="' + (cls || 'btn btn-sm') + '">' + (icon ? c.ic(icon) : '') + '<span>' + c.esc(label) + '</span></button>');
    if (fn) b.onclick = fn;
    return b;
  }
  function note(c, text, cls) { return c.h('<p class="sx-note' + (cls ? ' ' + cls : '') + '">' + c.esc(text) + '</p>'); }
  function shareFirst() { return check('export.share').status === 'ok' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }
  function busy(b, on, label) {
    b.disabled = !!on;
    var s = b.querySelector('span');
    if (on) { b.setAttribute('data-label', s.textContent); s.textContent = label || 'Preparing…'; }
    else if (b.getAttribute('data-label')) s.textContent = b.getAttribute('data-label');
  }
  /* The sticky action bar: gold primary (Share on phones that can, Download elsewhere), the other as a plain button. */
  function actions(c, body, o) {
    var bar = c.h('<div class="sxe-actions"></div>');
    var sf = shareFirst();
    var dl = btn(c, o.downloadLabel || 'Download', 'download', 'btn ' + (sf ? '' : 'btn-gold') + ' sxe-act', null);
    var sh = btn(c, o.shareLabel || 'Share', 'share', 'btn ' + (sf ? 'btn-gold' : '') + ' sxe-act', null);
    dl.setAttribute('data-act', 'download');
    sh.setAttribute('data-act', 'share');
    var unsupported = check('export.share').status === 'unsupported';
    if (unsupported) sh.classList.add('is-unsupported');
    dl.onclick = function () { busy(dl, true); Promise.resolve(o.download()).then(function () { busy(dl, false); }, function (err) { busy(dl, false); if (!err || !err.cancelled) c.toast((err && err.message) || 'Export failed.'); }); };
    sh.onclick = function () {
      gate(c, 'export.share', 'Share', function () {
        busy(sh, true);
        return Promise.resolve(o.share()).then(function () { busy(sh, false); }, function (err) { busy(sh, false); throw err; });
      }, { label: 'Download instead', run: function () { dl.click(); } });
    };
    if (sf) { bar.appendChild(sh); bar.appendChild(dl); } else { bar.appendChild(dl); bar.appendChild(sh); }
    body.appendChild(bar);
    if (unsupported) body.appendChild(note(c, 'This browser cannot share files to other apps. Download works everywhere.', 'sxe-support'));
    return { bar: bar, download: dl, share: sh };
  }
  function privacyLine(c) {
    return c.h('<p class="sxe-privacy">' + c.ic('lock') + '<span>Made on this device. Exported images carry no camera metadata — no location, device or time.</span></p>');
  }

  function renderImage(c, body) {
    var o = c.S.exportOpts;
    var d = c.doc();
    var maxS = c.maxScale();
    function save() { c.lsSet('le-studio-export', o); }
    var s1 = c.ui.section('File type');
    s1.querySelector('.sx-sec-body').appendChild(c.ui.seg([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF']], o.format, function (v) { o.format = v; save(); c.renderPanel(true); }));
    s1.querySelector('.sx-sec-body').appendChild(note(c, o.format === 'png' ? 'Best for graphics and text. Supports transparency.' : o.format === 'jpeg' ? 'Smallest for photos. No transparency — the design is flattened.' : o.format === 'pdf' ? 'One PDF page per design page, sized to your design. Great for printing and sharing.' : 'Modern and small. Supports transparency.'));
    body.appendChild(s1);
    var s2 = c.ui.section('Size');
    var chips = c.h('<div class="sx-chips sxe-scales"></div>');
    if (o.scale > maxS) { o.scale = Math.max(0.5, Math.floor(maxS * 2) / 2); save(); }
    [0.5, 1, 1.5, 2, 3, 4].forEach(function (sc) {
      var ok = sc <= maxS + 1e-6;
      var b = c.h('<button type="button" class="sx-chip" aria-pressed="' + (o.scale === sc) + '"' + (ok ? '' : ' disabled title="Too large for this device"') + '>' + sc + '×<small>' + Math.round(d.width * sc) + '×' + Math.round(d.height * sc) + '</small></button>');
      b.onclick = function () { o.scale = sc; save(); c.renderPanel(true); };
      chips.appendChild(b);
    });
    s2.querySelector('.sx-sec-body').appendChild(chips);
    body.appendChild(s2);
    if (o.format !== 'png' && o.format !== 'pdf') {
      var s3 = c.ui.section('Quality');
      s3.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Quality', min: 40, max: 100, value: Math.round(o.quality * 100), fmt: function (v) { return v + '%'; }, onInput: function (v) { o.quality = v / 100; save(); est(); } }));
      body.appendChild(s3);
    }
    var s4 = c.ui.section('Options');
    var b4 = s4.querySelector('.sx-sec-body');
    if (o.format !== 'jpeg' && o.format !== 'pdf') b4.appendChild(c.ui.toggle('Transparent background', !!o.transparent, function (v) { o.transparent = v; save(); est(); }, 'Leaves the page background out.'));
    var multi = c.S.project.pages.length > 1;
    if (multi) b4.appendChild(c.ui.seg([['current', 'This page'], ['all', 'All ' + c.S.project.pages.length + ' pages' + (o.format === 'pdf' ? '' : ' (zip)')]], o.pages || 'current', function (v) { o.pages = v; save(); }, 'sx-seg-sm'));
    var nm = c.h('<label class="sx-field"><span>File name</span><input class="sx-input" maxlength="80" value="' + c.esc(c.safeName(c.S.project.name)) + '"></label>');
    b4.appendChild(nm);
    body.appendChild(s4);
    var info = c.h('<div class="sx-export-info"><span class="sx-eyebrow">Estimated</span><strong>…</strong><small>Flattened on export · made on this device</small></div>');
    body.appendChild(info);
    function fname() { return nm.querySelector('input').value; }
    function items() {
      var oo = Object.assign({}, o);
      if (oo.format === 'pdf') return c.exportImage({ name: fname(), dryRun: true }).then(function (b) { return b ? [{ name: c.safeName(fname()) + '.pdf', blob: b }] : []; });
      return pageItems(c, Object.assign(oo, { pages: multi ? (o.pages || 'current') : 'current' })).then(function (list) {
        var bn = c.safeName(fname());
        return list.map(function (it) { return { name: it.name.replace(base(c), bn), blob: it.blob }; });
      });
    }
    actions(c, body, {
      download: function () {
        return c.exportImage({ name: fname() }).then(function (blob) { if (blob) c.toast('Downloaded ' + c.fmtBytes(blob.size)); });
      },
      share: function () { return items().then(function (list) { if (list.length) return shareOrDownload(c, list, c.safeName(fname()) + '.zip'); }); }
    });
    var more = c.h('<div class="sxe-rows"></div>');
    var cp = btn(c, 'Copy image', 'clip', 'sxe-row', function () { gate(c, 'export.copy', 'Copy image', function () { return copy(c); }); });
    var cpNote = supportNote('export.copy');
    if (cpNote) { cp.classList.add('is-unsupported'); cp.appendChild(c.h('<small>' + c.esc(cpNote) + '</small>')); }
    else cp.appendChild(c.h('<small>PNG, ready to paste into chats and docs</small>'));
    more.appendChild(cp);
    if (LE.design && typeof LE.design.openShare === 'function') {
      var tl = btn(c, 'Share as template link', 'share', 'sxe-row', function () { LE.design.openShare(c); });
      tl.appendChild(c.h('<small>Layout and text in a link; photos stay on this device</small>'));
      more.appendChild(tl);
    }
    var pj = btn(c, 'Save as .leproject', 'file', 'sxe-row', function () { c.exportProject(); });
    pj.appendChild(c.h('<small>The editable design, to open again later</small>'));
    more.appendChild(pj);
    body.appendChild(more);
    body.appendChild(privacyLine(c));
    var token = 0;
    function est() {
      var my = ++token;
      info.querySelector('strong').textContent = '…';
      c.estimate().then(function (r) {
        if (my !== token) return;
        info.querySelector('strong').textContent = r.width + ' × ' + r.height + ' px' + (r.bytes ? ' · ~' + c.fmtBytes(r.bytes) : '');
      });
    }
    est();
  }

  var thumbUrls = [];
  function dropThumbs() { thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); }); thumbUrls = []; }
  var job = null;
  function progressUI(c, host, label, signal) {
    var n = c.h('<div class="sxe-progress" role="status" aria-live="polite"><div class="sxe-progress-top"><span>' + c.esc(label) + '</span><button type="button" class="btn btn-sm btn-ghost">Cancel</button></div><div class="sxe-bar"><i></i></div></div>');
    n.querySelector('button').onclick = function () { signal.cancelled = true; n.querySelector('span').textContent = 'Stopping…'; };
    host.appendChild(n);
    return {
      set: function (f, text) { n.querySelector('i').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; if (text) n.querySelector('span').textContent = text; },
      done: function () { n.remove(); }
    };
  }
  function renderSizesTab(c, body) {
    var s = sizeSt(c);
    var d = c.doc();
    body.appendChild(note(c, 'One design, adapted to each size — the open page is not changed. Tap a preview to adjust it.'));
    var pick = c.ui.section('Sizes', '<span class="sxe-count"></span>');
    var pb = pick.querySelector('.sx-sec-body');
    var chips = c.h('<div class="sxe-size-chips"></div>');
    var all = c.SIZES.concat(s.custom);
    function count() { pick.querySelector('.sxe-count').textContent = chosenSizes(c).length + ' selected'; }
    all.forEach(function (z) {
      var on = s.ids.indexOf(z.id) >= 0;
      var b = c.h('<button type="button" class="sxe-size-chip" aria-pressed="' + on + '"><b>' + c.esc(z.name) + '</b><small>' + z.w + '×' + z.h + '</small></button>');
      b.onclick = function () {
        var i = s.ids.indexOf(z.id);
        if (i >= 0) s.ids.splice(i, 1); else s.ids.push(z.id);
        b.setAttribute('aria-pressed', String(i < 0));
        saveSizeSt(c); count(); paintThumbs();
      };
      chips.appendChild(b);
    });
    pb.appendChild(chips);
    var form = c.h('<form class="sxe-custom"><label>W<input class="sx-input" type="number" min="16" max="8000" value="' + d.width + '" aria-label="Custom width"></label><span aria-hidden="true">×</span><label>H<input class="sx-input" type="number" min="16" max="8000" value="' + d.height + '" aria-label="Custom height"></label><button type="submit" class="btn btn-sm">Add size</button></form>');
    form.onsubmit = function (e) {
      e.preventDefault();
      var ins = form.querySelectorAll('input');
      var w = c.clamp(Math.round(Number(ins[0].value) || 0), 16, 8000), hh = c.clamp(Math.round(Number(ins[1].value) || 0), 16, 8000);
      var z = normSize({ w: w, h: hh });
      if (!s.custom.some(function (x) { return x.id === z.id; })) s.custom.push(z);
      if (s.ids.indexOf(z.id) < 0) s.ids.push(z.id);
      saveSizeSt(c);
      c.renderPanel(true);
    };
    pb.appendChild(form);
    count();
    body.appendChild(pick);
    var fmt = c.ui.section('File type');
    fmt.querySelector('.sx-sec-body').appendChild(c.ui.seg([['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']], s.format, function (v) { s.format = v; saveSizeSt(c); }, 'sx-seg-sm'));
    body.appendChild(fmt);
    var prev = c.ui.section('Preview');
    var grid = c.h('<div class="sxe-thumbs" aria-live="polite"></div>');
    prev.querySelector('.sx-sec-body').appendChild(grid);
    body.appendChild(prev);
    var ptoken = 0;
    function paintThumbs() {
      var my = ++ptoken;
      dropThumbs();
      grid.innerHTML = '';
      var list = chosenSizes(c);
      if (!list.length) { grid.appendChild(note(c, 'Pick at least one size.')); return; }
      var cells = list.map(function (z) {
        var cell = c.h('<button type="button" class="sxe-thumb" aria-label="Adjust ' + c.esc(z.name) + '"><span class="sxe-thumb-art" style="aspect-ratio:' + z.w + '/' + z.h + '"></span><b>' + c.esc(z.name) + '</b><small>' + z.w + ' × ' + z.h + (s.over[z.id] ? ' · adjusted' : '') + '</small></button>');
        cell.onclick = function () { sizeDetail(c, z, paintThumbs); };
        grid.appendChild(cell);
        return cell;
      });
      var chain = Promise.resolve();
      list.forEach(function (z, i) {
        chain = chain.then(function () {
          if (my !== ptoken) return null;
          return thumbFor(c, z, s.over[z.id], 240).then(function (u) {
            if (my !== ptoken) { URL.revokeObjectURL(u); return; }
            thumbUrls.push(u);
            cells[i].querySelector('.sxe-thumb-art').style.backgroundImage = 'url("' + u + '")';
            cells[i].classList.add('is-ready');
          });
        });
      });
    }
    paintThumbs();
    var host = c.h('<div></div>');
    body.appendChild(host);
    function run() {
      var list = chosenSizes(c);
      if (!list.length) { c.toast('Pick at least one size.'); return Promise.resolve(null); }
      var signal = { cancelled: false };
      var pr = progressUI(c, host, 'Rendering 1 of ' + list.length + '…', signal);
      return renderSizes(c, list, { format: s.format, quality: s.quality, over: s.over, signal: signal, onProgress: function (i, n, z) { pr.set(i / n, z ? 'Rendering ' + (i + 1) + ' of ' + n + ' · ' + z.name : 'Packing…'); } })
        .then(function (items) { pr.done(); return items; }, function (err) { pr.done(); if (err && err.cancelled) { c.toast('Cancelled'); return null; } throw err; });
    }
    actions(c, body, {
      downloadLabel: 'Download zip',
      download: function () { return run().then(function (items) { if (!items) return; return zipOf(items).then(function (z) { c.download(z, base(c) + '-sizes.zip'); c.toast('Downloaded ' + items.length + ' sizes · ' + c.fmtBytes(z.size)); }); }); },
      share: function () { return run().then(function (items) { if (items) return shareOrDownload(c, items, base(c) + '-sizes.zip'); }); }
    });
    body.appendChild(privacyLine(c));
  }
  function sizeDetail(c, z, onDone) {
    var s = sizeSt(c);
    var def = c.size.opts();
    var cur = Object.assign({ fit: def.fit, focal: def.focal }, s.over[z.id] || {});
    var box = c.h('<div class="sxe-detail"><div class="sxe-detail-art" style="aspect-ratio:' + z.w + '/' + z.h + '"><img alt=""></div><div class="sxe-detail-ctl"></div></div>');
    var img = box.querySelector('img');
    var ctl = box.querySelector('.sxe-detail-ctl');
    var url = null;
    function paint() {
      thumbFor(c, z, s.over[z.id], 520).then(function (u) { if (url) URL.revokeObjectURL(url); url = u; img.src = u; img.alt = z.name + ' preview'; });
    }
    function set(p) { cur = Object.assign(cur, p); s.over[z.id] = { fit: cur.fit, focal: cur.focal }; paint(); }
    if (c.baseLayer()) {
      ctl.appendChild(c.h('<h4 class="sx-sub">Photo</h4>'));
      ctl.appendChild(c.ui.seg([['cover', 'Fill'], ['contain', 'Fit'], ['stretch', 'Stretch']], cur.fit, function (v) { set({ fit: v }); }, 'sx-seg-sm'));
      ctl.appendChild(c.h('<h4 class="sx-sub">Keep in view</h4>'));
      var pad = c.h('<div class="sxe-focal" role="group" aria-label="Focal point"></div>');
      [0.15, 0.5, 0.85].forEach(function (y) {
        [0.15, 0.5, 0.85].forEach(function (x) {
          var on = Math.abs(cur.focal.x - x) < 0.2 && Math.abs(cur.focal.y - y) < 0.2;
          var b = c.h('<button type="button" aria-pressed="' + on + '" aria-label="Focus ' + (y < 0.3 ? 'top' : y > 0.7 ? 'bottom' : 'middle') + ' ' + (x < 0.3 ? 'left' : x > 0.7 ? 'right' : 'centre') + '"><i></i></button>');
          b.onclick = function () { pad.querySelectorAll('button').forEach(function (n) { n.setAttribute('aria-pressed', String(n === b)); }); set({ focal: { x: x, y: y } }); };
          pad.appendChild(b);
        });
      });
      ctl.appendChild(pad);
    } else ctl.appendChild(note(c, 'Text, shapes and stickers keep their place relative to the page.'));
    var row = c.h('<div class="sxe-detail-act"></div>');
    row.appendChild(btn(c, 'Reset', 'reset', 'btn btn-sm btn-ghost', function () { delete s.over[z.id]; cur = { fit: def.fit, focal: def.focal }; paint(); }));
    row.appendChild(btn(c, 'Edit at this size', 'resize', 'btn btn-sm', function () {
      c.closeModal(); c.closePanel(); c.size.preview(z.w, z.h, z.name, s.over[z.id]);
      c.toast('Previewing ' + z.name + ' — Use this size to keep it, or Cancel');
    }));
    row.appendChild(btn(c, 'Done', 'check', 'btn btn-sm btn-ink', function () { c.closeModal(); }));
    ctl.appendChild(row);
    c.S.onModalClose = function () { if (url) URL.revokeObjectURL(url); if (onDone) onDone(); };
    c.openModal(c.esc(z.name) + ' <small class="sxe-muted">' + z.w + ' × ' + z.h + '</small>', box, { wide: true });
    paint();
  }

  function renderSlidesTab(c, body) {
    var info = carInfo(c);
    var p = c.S.project;
    var st = sizeSt(c);
    if (!info) {
      var sec = c.ui.section('Carousel');
      var sb = sec.querySelector('.sx-sec-body');
      sb.appendChild(note(c, 'Make this page one wide canvas of side-by-side slides. Anything that crosses a slide edge flows seamlessly when people swipe.'));
      var n = 3;
      var stepper = c.h('<div class="sxe-stepper"><button type="button" class="sx-iconbtn" aria-label="Fewer slides">' + c.ic('minus') + '</button><output aria-live="polite">3 slides</output><button type="button" class="sx-iconbtn" aria-label="More slides">' + c.ic('plus') + '</button></div>');
      var outEl = stepper.querySelector('output');
      var bs = stepper.querySelectorAll('button');
      bs[0].onclick = function () { n = Math.max(2, n - 1); outEl.textContent = n + ' slides'; };
      bs[1].onclick = function () { n = Math.min(20, n + 1); outEl.textContent = n + ' slides'; };
      sb.appendChild(stepper);
      sb.appendChild(note(c, 'This page becomes slide 1; the rest start empty. A new Instagram carousel is 1080 × 1350 per slide.'));
      body.appendChild(sec);
      var multi = p.pages.length > 1;
      var row = c.h('<div class="' + (multi ? 'sxe-two' : 'sxe-actions') + '"></div>');
      var mk = btn(c, 'Make slides', 'pages', 'btn ' + (multi ? '' : 'btn-gold ') + 'sxe-act', function () { carousel.make(c, { slides: n }); c.renderPanel(true); });
      mk.setAttribute('data-act', 'make');
      row.appendChild(mk);
      var nw = btn(c, 'New carousel', 'plus', 'btn sxe-act', function () { carousel.newDesign(c, { w: 1080, h: 1350, slides: n }); c.openPanel('export', { tab: 'slides' }); });
      nw.setAttribute('data-act', 'new');
      row.appendChild(nw);
      body.appendChild(row);
      if (multi) {
        var ms = c.ui.section('Pages as numbered slides');
        ms.querySelector('.sx-sec-body').appendChild(note(c, 'Export all ' + p.pages.length + ' pages as ' + base(c) + '-01, -02… ready to post as a carousel.'));
        body.appendChild(ms);
        actions(c, body, {
          downloadLabel: 'Download slides',
          download: function () { return pageItems(c, Object.assign({}, c.S.exportOpts, { format: st.format === 'png' ? 'png' : 'jpeg', quality: 0.92, transparent: false }), true).then(function (items) { return zipOf(items).then(function (z) { c.download(z, base(c) + '-slides.zip'); c.toast('Downloaded ' + items.length + ' slides'); }); }); },
          share: function () { return pageItems(c, Object.assign({}, c.S.exportOpts, { format: 'jpeg', quality: 0.92, transparent: false }), true).then(function (items) { return shareOrDownload(c, items, base(c) + '-slides.zip'); }); }
        });
      }
      return;
    }
    var head = c.h('<div class="sxe-car-head"><div><span class="sx-eyebrow">Carousel</span><strong>' + info.slides + ' slides · ' + Math.round(info.slideWidth) + ' × ' + info.height + '</strong></div></div>');
    body.appendChild(head);
    var ss = c.ui.section('Slides');
    var list = c.h('<div class="sxe-slides" role="list"></div>');
    for (var i = 0; i < info.slides; i++) (function (i) {
      var it = c.h('<div class="sxe-slide" role="listitem"><button type="button" class="sxe-slide-go" aria-label="Go to slide ' + (i + 1) + '"><span>' + (i + 1) + '</span></button><button type="button" class="sx-iconbtn sxe-slide-x" aria-label="Remove slide ' + (i + 1) + '">' + c.ic('x') + '</button></div>');
      it.querySelector('.sxe-slide-go').onclick = function () { goSlide(c, i); };
      it.querySelector('.sxe-slide-x').onclick = function () { carousel.removeSlide(c, i); c.renderPanel(true); };
      list.appendChild(it);
    })(i);
    var add = c.h('<button type="button" class="sxe-slide sxe-slide-add" aria-label="Add a slide">' + c.ic('plus') + '<span>Add</span></button>');
    add.onclick = function () { carousel.addSlide(c); c.renderPanel(true); };
    list.appendChild(add);
    ss.querySelector('.sx-sec-body').appendChild(list);
    ss.querySelector('.sx-sec-body').appendChild(note(c, 'Dashed lines on the canvas mark slide edges; layers snap to them.'));
    body.appendChild(ss);
    var fs = c.ui.section('File type');
    var fmt = st.format === 'png' ? 'png' : 'jpeg';
    fs.querySelector('.sx-sec-body').appendChild(c.ui.seg([['jpeg', 'JPG'], ['png', 'PNG']], fmt, function (v) { fmt = v; }, 'sx-seg-sm'));
    body.appendChild(fs);
    var host = c.h('<div></div>');
    body.appendChild(host);
    function run() {
      var signal = { cancelled: false };
      var pr = progressUI(c, host, 'Splitting…', signal);
      return carousel.split(c, { format: fmt, signal: signal, onProgress: function (i, n) { pr.set(i / n, 'Slide ' + (i + 1) + ' of ' + n); } })
        .then(function (items) { pr.done(); return items; }, function (err) { pr.done(); if (err && err.cancelled) { c.toast('Cancelled'); return null; } throw err; });
    }
    var pv = btn(c, 'Swipe preview', 'compare', 'sxe-row', function () { run().then(function (items) { if (items) swipePreview(c, items); }); });
    pv.appendChild(c.h('<small>Check that the seams line up before you post</small>'));
    var rows = c.h('<div class="sxe-rows"></div>');
    rows.appendChild(pv);
    var un = btn(c, 'Back to a single page', 'reset', 'sxe-row', function () { carousel.unmake(c); c.renderPanel(true); });
    un.appendChild(c.h('<small>Keeps everything; removes the slide split</small>'));
    rows.appendChild(un);
    actions(c, body, {
      downloadLabel: 'Download ' + info.slides + ' slides',
      download: function () { return run().then(function (items) { if (!items) return; return zipOf(items).then(function (z) { c.download(z, base(c) + '-slides.zip'); c.toast('Downloaded ' + items.length + ' slides'); }); }); },
      share: function () { return run().then(function (items) { if (items) return shareOrDownload(c, items, base(c) + '-slides.zip'); }); }
    });
    body.appendChild(rows);
  }
  function swipePreview(c, items) {
    var urls = items.map(function (it) { return URL.createObjectURL(it.blob); });
    var box = c.h('<div class="sxe-swipe"><div class="sxe-swipe-track" tabindex="0" aria-label="Slides, swipe or use arrow keys"></div><div class="sxe-dots" aria-hidden="true"></div><label class="sx-mini-toggle"><input type="checkbox"><span>Show seams side by side</span></label></div>');
    var track = box.querySelector('.sxe-swipe-track');
    var dots = box.querySelector('.sxe-dots');
    urls.forEach(function (u, i) {
      track.appendChild(c.h('<figure class="sxe-swipe-slide"><img src="' + u + '" alt="Slide ' + (i + 1) + ' of ' + urls.length + '"></figure>'));
      dots.appendChild(c.h('<i' + (i === 0 ? ' class="on"' : '') + '></i>'));
    });
    track.addEventListener('scroll', function () {
      var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      dots.querySelectorAll('i').forEach(function (d, k) { d.className = k === i ? 'on' : ''; });
    });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * track.clientWidth, behavior: 'smooth' }); }
    });
    box.querySelector('input').onchange = function (e) { box.classList.toggle('is-seams', e.target.checked); };
    c.S.onModalClose = function () { urls.forEach(function (u) { URL.revokeObjectURL(u); }); };
    c.openModal('Swipe <em>preview</em>', box, { wide: true });
  }

  var replayOpts = null;
  function rOpts(c) {
    if (!replayOpts) replayOpts = Object.assign({ length: 10, curve: 'ease', hold: 1.5, endTag: false, container: '' }, c.lsGet('le-studio-replay', {}));
    replayOpts.endTag = !!replayOpts.endTag;
    return replayOpts;
  }
  var lastReplay = null;
  function renderReplayTab(c, body) {
    var o = rOpts(c);
    function save() { c.lsSet('le-studio-replay', o); }
    var stats = tlStats(c);
    var hasTl = stats.steps > 1;
    var types = videoTypes();
    body.appendChild(c.h('<div class="sxe-car-head"><div><span class="sx-eyebrow">Process replay</span><strong>Watch it come together</strong><small>' + (hasTl ? stats.steps + ' edits recorded this session — they play back in order.' : 'No edits recorded yet, so each layer builds in, back to front.') + '</small></div></div>'));
    var s1 = c.ui.section('Length');
    s1.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Length', min: 6, max: 20, value: o.length, fmt: function (v) { return v + ' s'; }, onInput: function (v) { o.length = v; save(); } }));
    s1.querySelector('.sx-sec-body').appendChild(c.ui.slider({ label: 'Hold the final frame', min: 0, max: 4, step: 0.5, value: o.hold, fmt: function (v) { return v + ' s'; }, onInput: function (v) { o.hold = v; save(); } }));
    body.appendChild(s1);
    var s2 = c.ui.section('Pace');
    s2.querySelector('.sx-sec-body').appendChild(c.ui.seg([['even', 'Even'], ['ease', 'Gentle'], ['quick', 'Quick start']], o.curve, function (v) { o.curve = v; save(); }, 'sx-seg-sm'));
    if (hasTl) s2.querySelector('.sx-sec-body').appendChild(c.ui.toggle('Build layer by layer instead', o.mode === 'build', function (v) { o.mode = v ? 'build' : ''; save(); }, 'Ignores the recorded edits.'));
    body.appendChild(s2);
    var s3 = c.ui.section('Video');
    var b3 = s3.querySelector('.sx-sec-body');
    if (types.length > 1) b3.appendChild(c.ui.seg(types.map(function (t) { return [t.ext, t.ext.toUpperCase()]; }), (o.container && types.some(function (t) { return t.ext === o.container; })) ? o.container : types[0].ext, function (v) { o.container = v; save(); }, 'sx-seg-sm'));
    var d = c.doc();
    var cap = videoCap();
    var k = Math.min(1, cap / Math.max(d.width, d.height));
    b3.appendChild(note(c, (types.length ? types.map(function (t) { return t.ext.toUpperCase(); }).join(' or ') + ' · ' : '') + even(d.width * k) + ' × ' + even(d.height * k) + ' (the design’s shape, capped for this device) · 30 fps'));
    b3.appendChild(c.ui.toggle('“Made with LocalEditor” end tag', o.endTag, function (v) { o.endTag = v; save(); }, 'A small label on the last frame. Off by default.'));
    if (!types.length) b3.appendChild(note(c, 'This browser cannot record video. You can download the frames as a zip of JPEGs (10 per second) instead — works in Chrome, Edge and Safari as a video.', 'sxe-support'));
    body.appendChild(s3);
    var host = c.h('<div class="sxe-replay-out"></div>');
    body.appendChild(host);
    function make() {
      if (lastReplay && lastReplay.key === JSON.stringify([o, c.doc().layers.length, tlStats(c).steps])) return Promise.resolve(lastReplay.r);
      var signal = { cancelled: false };
      var pr = progressUI(c, host, 'Recording…', signal);
      return exportReplay(c, Object.assign({}, o, { signal: signal, onProgress: function (i, n) { pr.set(i / n, 'Recording · step ' + (i + 1) + ' of ' + n); } })).then(function (r) {
        pr.done();
        lastReplay = { key: JSON.stringify([o, c.doc().layers.length, tlStats(c).steps]), r: r };
        showReplay(c, host, r);
        return r;
      }, function (err) { pr.done(); if (err && err.cancelled) { c.toast('Cancelled'); return null; } throw err; });
    }
    var mk = btn(c, lastReplay ? 'Make it again' : 'Make the replay', 'play', 'btn sxe-make', function () {
      lastReplay = null;
      gate(c, 'export.replay', 'Process replay', function () { return make(); });
    });
    if (!types.length) mk.querySelector('span').textContent = 'Make frames (zip)';
    body.appendChild(mk);
    if (lastReplay) showReplay(c, host, lastReplay.r);
    actions(c, body, {
      download: function () { return make().then(function (r) { if (r) { c.download(r.blob, r.name); c.toast('Downloaded ' + c.fmtBytes(r.blob.size)); } }); },
      share: function () { return make().then(function (r) { if (r) return shareOrDownload(c, [{ name: r.name, blob: r.blob }]); }); }
    });
    body.appendChild(c.h('<p class="sxe-privacy">' + c.ic('lock') + '<span>Recorded on this device. Your edit history stays in memory for this session only.</span></p>'));
  }
  var replayUrl = null;
  function showReplay(c, host, r) {
    host.innerHTML = '';
    if (replayUrl) URL.revokeObjectURL(replayUrl);
    replayUrl = null;
    if (r.frames) { host.appendChild(note(c, r.name + ' · ' + c.fmtBytes(r.blob.size) + ' · ' + Math.round(r.duration) + ' s at ' + r.fps + ' fps')); return; }
    replayUrl = URL.createObjectURL(r.blob);
    var v = c.h('<video class="sxe-video" controls muted playsinline loop autoplay style="aspect-ratio:' + r.width + '/' + r.height + '"></video>');
    v.src = replayUrl;
    host.appendChild(v);
    host.appendChild(c.h('<p class="sx-note">' + r.ext.toUpperCase() + ' · ' + r.width + ' × ' + r.height + ' · ' + Math.round(r.duration) + ' s · ' + c.fmtBytes(r.blob.size) + '</p>'));
  }

  P.export = {
    title: 'Download', eyebrow: 'Export & share',
    render: function (c, body, opts) {
      if (!c.S.project) {
        body.appendChild(c.ui.empty('Start with a photo or a blank page', 'Open a photo from this device, try the sample, or pick a size in Design.', [
          { label: 'Open photo', gold: true, fn: function () { c.pickFiles('add'); } },
          { label: 'Try sample', fn: function () { c.useSample(); } }
        ]));
        return;
      }
      body.classList.add('sxe-body');
      var tab = (opts && opts.tab) || (carInfo(c) ? 'slides' : 'image');
      tabsRow(c, body, tab);
      if (tab === 'sizes') return renderSizesTab(c, body);
      if (tab === 'slides') return renderSlidesTab(c, body);
      if (tab === 'replay') return renderReplayTab(c, body);
      renderImage(c, body);
    },
    close: function (c) { dropThumbs(); c.E.panelBody.classList.remove('sxe-body'); }
  };

  /* "Starts from" entry in Design → Resize and the New design list. */
  function wrapDesign() {
    var spec = P.design;
    if (!spec || spec._sxe) return;
    var orig = spec.render;
    spec._sxe = true;
    spec.render = function (c, body, o) {
      orig.call(this, c, body, o);
      var tab = (o && o.tab) || (c.S.project ? 'sizes' : 'templates');
      if (tab !== 'sizes' && tab !== 'templates') return;
      var sec = c.ui.section('Carousel');
      var b = c.h('<button type="button" class="sx-size-mini sxe-car-start"><span class="sx-size-art sxe-car-art" aria-hidden="true"><i></i><i></i><i></i></span><span><b>Instagram carousel</b><small>1080 × 1350 × 3 slides</small></span></button>');
      b.onclick = function () { carousel.newDesign(c, { w: 1080, h: 1350, slides: 3 }); c.openPanel('export', { tab: 'slides' }); };
      sec.querySelector('.sx-sec-body').appendChild(b);
      var heads = [].slice.call(body.querySelectorAll('.sx-sec-head h3'));
      var before = heads.filter(function (h3) { return /^(Custom size|New design)$/i.test(h3.textContent.trim()); })[0];
      if (before) body.insertBefore(sec, before.closest('.sx-sec')); else body.appendChild(sec);
    };
  }

  /* ---------- Hooks ---------- */
  hook('init', function (c) {
    if (c.I && !c.I.play) c.I.play = '<path d="M8 5.5v13l10.5-6.5z"/>';
    wrapDesign();
    wrapCarouselSnap(c);
  });
  hook('page', function (c) { tlRecord(c, true); paintStrip(c); });
  hook('history', function (c) { tlRecord(c); });
  hook('change', function (c) {
    var sd = c.scene._doc;
    var car = sd && sd.carousel;
    var key = car ? car.slides + ':' + sd.width + ':' + (c.S.project && c.S.project.id) : '';
    if (key !== paintStrip.key) { paintStrip.key = key; paintStrip(c); }
  });
  hook('resize', function (c) { paintStrip(c); });

  window.LEStudioExport = {
    open: function (c, opts) { c = c || window.LEStudio; c.openPanel('export', opts || {}); },
    renderSizes: function (c, sizes, opts) {
      if (typeof opts === 'function') opts = { onProgress: opts };
      return renderSizes(c || window.LEStudio, sizes, opts);
    },
    share: function (c, items, opts) { return share(c || window.LEStudio, items, opts); },
    shareOrDownload: function (c, items, zipName) { return shareOrDownload(c || window.LEStudio, items, zipName); },
    copy: function (c, opts) { return copy(c || window.LEStudio, opts); },
    pages: function (c, opts, numbered) { c = c || window.LEStudio; return pageItems(c, Object.assign({}, c.S.exportOpts, opts || {}), !!numbered); },
    replay: {
      stats: function (c) { return tlStats(c || window.LEStudio); },
      steps: function (c) { var t = tlList(c || window.LEStudio); return t ? t.steps.map(function (s) { return JSON.parse(s.json); }) : []; },
      record: function (c) { tlRecord(c || window.LEStudio, true); },
      clear: function (c) { if (c) delete TL.byKey[tlKey(c)]; else TL.byKey = {}; },
      setEnabled: function (v) { TL.enabled = !!v; },
      limits: TL,
      plan: function (c, opts) { var p = buildPlan(c || window.LEStudio, opts || {}); return { mode: p.mode, width: p.W, height: p.H, duration: p.duration, segments: p.segs.length }; },
      types: videoTypes,
      export: function (c, opts) { return exportReplay(c || window.LEStudio, opts || {}); }
    },
    carousel: {
      info: function (c) { return carInfo(c || window.LEStudio); },
      make: function (c, opts) { return carousel.make(c || window.LEStudio, opts); },
      unmake: function (c) { return carousel.unmake(c || window.LEStudio); },
      addSlide: function (c, at) { return carousel.addSlide(c || window.LEStudio, at); },
      removeSlide: function (c, i) { return carousel.removeSlide(c || window.LEStudio, i); },
      newDesign: function (c, opts) { return carousel.newDesign(c || window.LEStudio, opts); },
      split: function (c, opts) { return carousel.split(c || window.LEStudio, opts); },
      goTo: function (c, i) { goSlide(c || window.LEStudio, i); }
    },
    support: { check: check, defs: DEFS }
  };
})();
