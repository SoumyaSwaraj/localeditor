/* LocalEditor shell. Existing tool pages keep the IT helpers they already call. */
(function () {
  'use strict';

  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('le-theme') || localStorage.getItem('it-theme');
    if (saved) root.setAttribute('data-theme', saved);
    else if (!root.getAttribute('data-theme')) root.setAttribute('data-theme', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch (e) {}
  document.body.classList.add('le-ready');

  var IT = window.IT = window.IT || {};

  IT.toast = function (msg, ms) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
  };

  IT.say = function (msg, ms) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
  };

  IT.celebrate = function () {};

  IT.formatBytes = function (b) {
    if (b == null || isNaN(b)) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? (Math.round(b * 10) / 10) : Math.round(b)) + ' ' + u[i];
  };

  IT.download = function (blobOrUrl, filename) {
    var url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof blobOrUrl !== 'string') setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    IT.say('Download started');
  };

  IT.copy = function (text) {
    var done = function () { IT.say('Copied'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done).catch(function () { IT.say('Could not copy'); });
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { IT.say('Press Ctrl+C to copy'); }
    ta.remove();
  };

  IT.dropzone = function (el, opts) {
    opts = opts || {};
    var input = el.querySelector('input[type=file]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      el.appendChild(input);
    }
    if (opts.accept) input.accept = opts.accept;
    if (opts.multiple) input.multiple = true;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    var emit = function (list) {
      var files = Array.prototype.slice.call(list || []);
      if (files.length && opts.onFiles) opts.onFiles(files);
    };
    el.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { emit(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) {
      el.addEventListener(n, function (e) { e.preventDefault(); el.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      el.addEventListener(n, function (e) { e.preventDefault(); el.classList.remove('drag'); });
    });
    el.addEventListener('drop', function (e) { emit(e.dataTransfer && e.dataTransfer.files); });
    if (opts.paste) {
      document.addEventListener('paste', function (e) {
        var items = (e.clipboardData && e.clipboardData.files) || [];
        if (items.length) emit(items);
      });
    }
    return input;
  };

  IT.loadImage = function (file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('unreadable')); };
      img.src = url;
    });
  };

  IT.canvasToBlob = function (canvas, type, quality) {
    return new Promise(function (res) { canvas.toBlob(function (b) { res(b); }, type || 'image/png', quality); });
  };

  IT.baseName = function (name) { return (name || 'file').replace(/\.[^.]+$/, ''); };

  var TOOLS = [
    ['Photo studio', 'studio/', 'Layers, text, collages, filters, every social size'],
    ['PDF studio', 'pdf-studio/', 'Sign, fill, annotate, merge and reorder pages'],
    ['Convert to PDF', 'convert-to-pdf/', 'Word, Excel, PowerPoint, images and text to PDF'],
    ['Recipes', 'recipes/', 'Apply, edit and share a list of photo edits'],
    ['Image compressor', 'image-compressor/', 'Shrink a photo for the web or email'],
    ['Image resizer', 'image-resizer/', 'Change pixel size or use a social preset'],
    ['Image converter', 'image-converter/', 'JPG, PNG, WebP'],
    ['Crop', 'image-cropper/', 'Crop to a ratio or a free rectangle'],
    ['Rotate and flip', 'rotate-flip-image/', 'Turn or mirror a photo'],
    ['Filters', 'image-filters/', 'Brightness, contrast, and looks'],
    ['Watermark', 'watermark-image/', 'Stamp text or a logo'],
    ['Color palette', 'color-picker/', 'Pick colors from a photo'],
    ['Blur and sharpen', 'studio/?tool=blur', 'Soften or crisp a photo'],
    ['Background', 'studio/?tool=background', 'Remove a flat background by hand'],
    ['Collage', 'studio/?tool=collage', 'Arrange several photos'],
    ['Meme', 'studio/?tool=meme', 'Top and bottom captions'],
    ['Text', 'studio/?tool=text', 'Add words to a photo'],
    ['Frames', 'studio/?tool=frame', 'Border, padding, rounded corners'],
    ['Upscale', 'studio/?tool=upscale', 'Enlarge with sharpening'],
    ['Batch', 'studio/?tool=batch', 'Resize and export many photos'],
    ['Metadata', 'studio/?tool=metadata', 'Read or drop camera data'],
    ['Compare', 'studio/?tool=compare', 'Before and after'],
    ['Merge PDF', 'merge-pdf/', 'Combine PDFs'],
    ['Split PDF', 'split-pdf/', 'Extract pages'],
    ['JPG to PDF', 'jpg-to-pdf/', 'Images into one PDF'],
    ['PDF to JPG', 'pdf-to-jpg/', 'Each page as an image'],
    ['Rotate PDF', 'rotate-pdf/', 'Turn PDF pages'],
    ['Organize PDF', 'organize-pdf/', 'Reorder pages'],
    ['Page numbers', 'add-page-numbers/', 'Number PDF pages'],
    ['Watermark PDF', 'watermark-pdf/', 'Stamp a PDF'],
    ['Word counter', 'word-counter/', 'Count words and reading time'],
    ['Case converter', 'case-converter/', 'Change text case'],
    ['Text compare', 'text-diff/', 'See what changed'],
    ['QR code', 'qr-code-generator/', 'Make a QR code'],
    ['Password', 'password-generator/', 'Make a password'],
    ['JSON', 'json-formatter/', 'Format JSON'],
    ['Base64', 'base64-encoder/', 'Encode or decode'],
    ['Hash', 'hash-generator/', 'MD5 and SHA'],
    ['Units', 'unit-converter/', 'Convert units'],
    ['Color converter', 'color-converter/', 'HEX, RGB, HSL'],
    ['UUID', 'uuid-generator/', 'Generate IDs'],
    ['Favicon', 'favicon-generator/', 'App icons from an image'],
    ['Lorem ipsum', 'lorem-ipsum-generator/', 'Placeholder text'],
    ['Image to Base64', 'image-to-base64/', 'Data URLs'],
    ['Privacy and install', 'about/', 'How LocalEditor keeps files on this device']
  ];

  function base() {
    return root.getAttribute('data-root') || '';
  }

  function here() {
    var path = location.pathname.replace(/\/index\.html$/, '/');
    var bits = path.split('/').filter(Boolean);
    return bits[bits.length - 1] || '';
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  var ICONS = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
    studio: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    recipes: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M8 12h8M8 16h5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.4"/><path d="m21 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L7 18"/>',
    pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    office: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    crop: '<path d="M6 3v14a2 2 0 0 0 2 2h13"/><path d="M18 21V8a2 2 0 0 0-2-2H3"/>',
    resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    filters: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/>',
    background: '<path d="M12 3a9 9 0 1 0 0 18z" fill="currentColor" fill-opacity=".25"/><circle cx="12" cy="12" r="9"/>',
    collage: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    storage: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    merge: '<path d="M8 6h10a2 2 0 0 1 2 2v12"/><rect x="2" y="2" width="12" height="16" rx="2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
    pdfstudio: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="m9.5 17 4.8-4.8a1.3 1.3 0 0 1 1.8 1.8L11.3 18.8 9 19.3z"/>',
    convert: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M17 4h3v6M7 20H4v-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'
  };

  function mark() {
    return '<span class="le-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><defs><linearGradient id="le-foil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3CC7C"/><stop offset="1" stop-color="#E2B15A"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#le-foil)"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#2A1F0A" stroke-width="1.9"/><circle cx="16" cy="16" r="2" fill="#2A1F0A"/></svg></span>';
  }

  function isCurrent(href) {
    var slug = here();
    if (href.indexOf('?') >= 0 || href.indexOf('#') >= 0) return false;
    var s = href.replace(/\/$/, '');
    return s ? s === slug : !slug;
  }

  /* The drawer: the whole menu, at every width. */
  function sideHTML() {
    var b = base();
    function item(href, name, ic, note) {
      return '<a class="item" href="' + b + href + '"' + (isCurrent(href) ? ' aria-current="page"' : '') + '>' + icon(ICONS[ic] || ICONS.image) + '<span>' + name + '</span>' + (note ? '<small>' + note + '</small>' : '') + '</a>';
    }
    return '' +
      '<div class="le-side-head">' +
        '<a class="le-brand" href="' + (b || './') + '">' + mark() + '<span><strong>LocalEditor</strong><em>Private design studio</em></span></a>' +
        '<button class="le-icon" type="button" data-menu-close aria-label="Close menu">' + icon(ICONS.close) + '</button>' +
      '</div>' +
      '<nav class="le-nav" aria-label="All sections">' +
        '<div class="le-label">Studios</div>' +
        item('', 'Home', 'home') +
        item('studio/', 'Photo studio', 'studio') +
        item('pdf-studio/', 'PDF studio', 'pdfstudio') +
        item('convert-to-pdf/', 'Convert to PDF', 'convert') +
        item('recipes/', 'Recipes', 'recipes') +
        '<div class="le-label">Popular tools</div>' +
        item('image-compressor/', 'Compress image', 'compress') +
        item('image-resizer/', 'Resize image', 'resize') +
        item('merge-pdf/', 'Merge PDF', 'merge') +
        item('studio/?tool=collage', 'Collage', 'collage') +
        item('#tools', 'Every tool', 'grid', '35') +
        '<div class="le-promise">' + icon(ICONS.shield) + '<span><strong>Nothing is uploaded</strong>Your photos and PDFs are edited by this browser and stay on this device.</span></div>' +
      '</nav>' +
      '<div class="le-side-foot">' +
        '<button type="button" class="le-row" data-le-install>' + icon(ICONS.download) + '<span>Install app</span><small>Works offline</small></button>' +
        '<button type="button" class="le-row" data-le-storage>' + icon(ICONS.storage) + '<span>Storage on this device</span></button>' +
        '<button type="button" class="le-row" data-theme-toggle>' + icon(ICONS.moon) + '<span data-theme-label>Dark theme</span></button>' +
        '<a class="le-row" href="' + b + 'about/">' + icon(ICONS.info) + '<span>Privacy and about</span></a>' +
      '</div>';
  }

  /* The header: brand, sections, search, theme, menu and the one primary action. */
  function topHTML() {
    var b = base();
    function link(href, name) {
      return '<a href="' + b + href + '"' + (isCurrent(href) ? ' aria-current="page"' : '') + '>' + name + '</a>';
    }
    return '' +
      '<a class="le-brand" href="' + (b || './') + '" aria-label="LocalEditor home">' + mark() + '<span><strong>LocalEditor</strong></span></a>' +
      '<nav class="le-links" aria-label="Sections">' +
        link('studio/', 'Photo studio') +
        link('pdf-studio/', 'PDF studio') +
        link('convert-to-pdf/', 'Convert') +
        link('recipes/', 'Recipes') +
        '<a href="' + b + '#tools">All tools</a>' +
      '</nav>' +
      '<span class="spacer"></span>' +
      '<button class="le-search" type="button" data-search aria-label="Search tools">' + icon(ICONS.search) + '<span>Search tools</span><kbd>/</kbd></button>' +
      '<button class="le-icon" type="button" data-theme-toggle aria-label="Switch to dark theme"><span class="le-theme-icon-light">' + icon(ICONS.moon) + '</span><span class="le-theme-icon-dark">' + icon(ICONS.sun) + '</span></button>' +
      '<button class="le-icon le-menu" type="button" data-menu aria-label="Open menu" aria-expanded="false" aria-controls="le-drawer">' + icon(ICONS.menu) + '</button>' +
      '<a class="btn btn-gold btn-sm le-cta" href="' + b + 'studio/">Open studio</a>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function syncTheme() {
    var dark = root.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      if (b.classList.contains('le-icon')) b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    });
    document.querySelectorAll('[data-theme-label]').forEach(function (s) { s.textContent = dark ? 'Light theme' : 'Dark theme'; });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && !document.body.classList.contains('sx-body') && !document.body.classList.contains('ps-body') && !document.body.classList.contains('cv-body')) {
      meta.setAttribute('content', dark ? '#0F0E13' : '#F7F6F3');
    }
  }

  function mountShell() {
    var sideSlot = document.querySelector('.le-side[data-fill]');
    var topSlot = document.querySelector('.le-top[data-fill]');
    if (sideSlot) { sideSlot.innerHTML = sideHTML(); sideSlot.id = sideSlot.id || 'le-drawer'; }
    if (topSlot) topSlot.innerHTML = topHTML();
    if (document.body.classList.contains('le-built') || document.querySelector('.le-app')) { afterMount(); return; }
    var main = document.getElementById('main');
    if (!main) return;
    var app = document.createElement('div');
    app.className = 'le-app';
    var side = document.createElement('aside');
    side.className = 'le-side';
    side.id = 'le-drawer';
    side.setAttribute('aria-label', 'Menu');
    side.innerHTML = sideHTML();
    var wrap = document.createElement('div');
    wrap.className = 'le-main';
    var top = document.createElement('header');
    top.className = 'le-top';
    top.innerHTML = topHTML();
    var content = document.createElement('div');
    content.className = 'le-content';
    var scrim = document.createElement('button');
    scrim.className = 'le-scrim';
    scrim.type = 'button';
    scrim.hidden = true;
    scrim.tabIndex = -1;
    scrim.setAttribute('data-scrim', '');
    scrim.setAttribute('aria-label', 'Close menu');
    var skip = document.querySelector('.skip');
    if (skip && skip.nextSibling) document.body.insertBefore(app, skip.nextSibling);
    else document.body.insertBefore(app, document.body.firstChild);
    app.appendChild(wrap);
    wrap.appendChild(top);
    wrap.appendChild(content);
    content.appendChild(main);
    var footer = document.querySelector('.site-footer');
    if (footer) content.appendChild(footer);
    app.appendChild(side);
    document.body.appendChild(scrim);
    afterMount();
  }

  function afterMount() {
    syncTheme();
    initDirectory();
    /* app.js sets a fixed theme-color after mounting; correct it once that has run. */
    setTimeout(syncTheme, 0);
  }

  var lastFocus = null;
  function setMenu(open) {
    var side = document.querySelector('.le-side');
    if (open === document.body.classList.contains('le-menu-open')) return;
    document.body.classList.toggle('le-menu-open', open);
    var scrim = document.querySelector('[data-scrim]');
    if (scrim) scrim.hidden = !open;
    document.querySelectorAll('[data-menu]').forEach(function (btn) { btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    if (open) {
      lastFocus = document.activeElement;
      var first = side && (side.querySelector('[aria-current="page"]') || side.querySelector('a, button'));
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 30);
    } else if (lastFocus && lastFocus.focus) {
      lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu]')) { setMenu(!document.body.classList.contains('le-menu-open')); return; }
    if (e.target.closest('[data-scrim], [data-menu-close]')) { setMenu(false); return; }
    if (e.target.closest('.le-nav a')) setMenu(false);

    var themeBtn = e.target.closest('[data-theme-toggle]');
    if (themeBtn) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('le-theme', next); } catch (err) {}
      syncTheme();
      return;
    }

    if (e.target.closest('[data-search]')) openSearch();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
    if (e.key === 'Tab' && document.body.classList.contains('le-menu-open')) {
      var side = document.querySelector('.le-side');
      var items = side ? [].slice.call(side.querySelectorAll('a[href], button:not([disabled])')).filter(function (el) { return el.offsetParent !== null; }) : [];
      if (items.length) {
        var firstEl = items[0], lastEl = items[items.length - 1];
        if (!side.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); }
        else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    }
    var tag = (e.target && e.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      openSearch();
    }
  });

  /* Homepage tool directory: [data-tool-dir] holds a search field, category chips and groups of links. */
  function initDirectory() {
    var dir = document.querySelector('[data-tool-dir]');
    if (!dir || dir._le) return;
    dir._le = true;
    var input = dir.querySelector('[data-dir-search]');
    var chips = [].slice.call(dir.querySelectorAll('[data-dir-cat]'));
    var groups = [].slice.call(dir.querySelectorAll('[data-dir-group]'));
    var empty = dir.querySelector('[data-dir-empty]');
    var status = dir.querySelector('[data-dir-status]');
    var cat = 'all';
    function apply() {
      var words = (input ? input.value : '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      var total = 0;
      groups.forEach(function (g) {
        var inCat = cat === 'all' || g.getAttribute('data-dir-group') === cat;
        var n = 0;
        [].slice.call(g.querySelectorAll('li')).forEach(function (li) {
          var a = li.querySelector('[data-k]');
          var hay = a ? a.getAttribute('data-k') : '';
          var ok = inCat && words.every(function (w) { return hay.indexOf(w) >= 0; });
          li.hidden = !ok;
          if (ok) n++;
        });
        g.hidden = n === 0;
        var count = g.querySelector('.hp-dir-label span');
        if (count) count.textContent = n;
        total += n;
      });
      if (empty) {
        empty.hidden = total > 0;
        var q = empty.querySelector('[data-dir-query]');
        if (q) q.textContent = input ? input.value.trim() : '';
      }
      if (status) status.textContent = total + (total === 1 ? ' tool' : ' tools') + ' shown';
    }
    if (input) input.addEventListener('input', apply);
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        cat = c.getAttribute('data-dir-cat');
        chips.forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        apply();
      });
    });
    apply();
  }

  var dialog;
  function openSearch() {
    setMenu(false);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'le-dialog';
      dialog.setAttribute('aria-label', 'Search tools');
      dialog.innerHTML = '<form method="dialog"><input type="search" placeholder="Search tools and studios" aria-label="Search tools" autocomplete="off" enterkeyhint="go"><ul></ul><p class="empty-search hidden">No tools match.</p></form>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
      var input = dialog.querySelector('input');
      input.addEventListener('input', function () { paintSearch(input.value); });
      input.addEventListener('keydown', function (e) {
        var links = [].slice.call(dialog.querySelectorAll('a'));
        var i = links.findIndex(function (a) { return a.getAttribute('aria-selected') === 'true'; });
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!links.length) return;
          if (i >= 0) links[i].removeAttribute('aria-selected');
          i = e.key === 'ArrowDown' ? Math.min(links.length - 1, i + 1) : Math.max(0, i - 1);
          links[i].setAttribute('aria-selected', 'true');
          links[i].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (i < 0 && links.length) i = 0;
          if (i >= 0) links[i].click();
        }
      });
    }
    paintSearch('');
    dialog.showModal();
    dialog.querySelector('input').value = '';
    dialog.querySelector('input').focus();
  }

  function paintSearch(q) {
    var words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var ul = dialog.querySelector('ul');
    var empty = dialog.querySelector('.empty-search');
    var b = base();
    var html = '';
    var n = 0;
    TOOLS.forEach(function (t) {
      var hay = (t[0] + ' ' + t[2] + ' ' + t[1]).toLowerCase();
      if (words.length && !words.every(function (w) { return hay.indexOf(w) >= 0; })) return;
      n++;
      html += '<li><a href="' + b + t[1] + '">' + escapeHtml(t[0]) + '<span>' + escapeHtml(t[2]) + '</span></a></li>';
    });
    ul.innerHTML = html;
    empty.classList.toggle('hidden', n > 0);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(base() + 'sw.js', { scope: base() || './' }).catch(function () {});
    });
  }

  window.addEventListener('offline', function () { IT.say('You are offline. Tools on this device keep working.'); });

  mountShell();

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#141318');
})();

/* Install, updates and storage manager: loads le-pwa.js and le-pwa.css on every page.
   The install prompt can fire before le-pwa.js arrives, so it is kept here until then. */
(function () {
  'use strict';
  if (window.__lePwaLoader) return;
  window.__lePwaLoader = true;
  var early = window.__lePwaEarly = { prompt: null, installed: false };
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); early.prompt = e; });
  window.addEventListener('appinstalled', function () { early.installed = true; early.prompt = null; });
  var base = document.documentElement.getAttribute('data-root') || '';
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + 'assets/css/le-pwa.css';
  document.head.appendChild(css);
  var js = document.createElement('script');
  js.src = base + 'assets/js/le-pwa.js';
  js.async = true;
  document.head.appendChild(js);
})();

/* Device support checks (LE.support): loads le-support.js and le-support.css on every page. Features may push
   their definitions onto window.LE_SUPPORT_DEFS before it arrives. See docs/SUPPORT.md. */
(function () {
  'use strict';
  if (window.__leSupportLoader) return;
  window.__leSupportLoader = true;
  window.LE_SUPPORT_DEFS = window.LE_SUPPORT_DEFS || [];
  var base = document.documentElement.getAttribute('data-root') || '';
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + 'assets/css/le-support.css';
  document.head.appendChild(css);
  var js = document.createElement('script');
  js.src = base + 'assets/js/le-support.js';
  js.async = true;
  document.head.appendChild(js);
})();
