/* LocalEditor shell. Existing tool pages keep the IT helpers they already call. */
(function () {
  'use strict';

  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('le-theme') || localStorage.getItem('it-theme');
    if (saved) root.setAttribute('data-theme', saved);
    else if (!root.getAttribute('data-theme')) root.setAttribute('data-theme', 'light');
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
    ['Studio', 'studio/', 'The full editor: crop, color, text, recipes, export'],
    ['Recipes', 'recipes/', 'Apply a shared editing recipe'],
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
    ['Image to Base64', 'image-to-base64/', 'Data URLs']
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
    moon: '<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/>',
    menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    crop: '<path d="M6 3v14a2 2 0 0 0 2 2h13"/><path d="M18 21V8a2 2 0 0 0-2-2H3"/>',
    resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    filters: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/>',
    background: '<path d="M12 3a9 9 0 1 0 0 18z" fill="currentColor" fill-opacity=".25"/><circle cx="12" cy="12" r="9"/>',
    collage: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    pdfstudio: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="m9.5 17 4.8-4.8a1.3 1.3 0 0 1 1.8 1.8L11.3 18.8 9 19.3z"/>',
    convert: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M17 4h3v6M7 20H4v-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };

  function sideHTML() {
    var b = base();
    var slug = here();
    function item(href, name, ic) {
      var slugPart = href.replace(/\/$/, '').replace(/^\.\.\//, '');
      var current = slugPart === slug || (href.indexOf('?') < 0 && slug && href.replace(/\/$/, '') === slug);
      if (!slug && (href === '' || href === './')) current = true;
      return '<a class="item" href="' + b + href + '"' + (current ? ' aria-current="page"' : '') + '>' + icon(ICONS[ic] || ICONS.image) + name + '</a>';
    }
    return '' +
      '<a class="le-brand" href="' + b + '">' +
        '<span class="le-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><defs><linearGradient id="le-foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F8E3AE"/><stop offset=".55" stop-color="#E2B15A"/><stop offset="1" stop-color="#B9832F"/></linearGradient></defs><rect width="32" height="32" rx="10" fill="url(#le-foil)"/><path d="M6 6h20" stroke="#fff" stroke-opacity=".5" stroke-width="1"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#2C220F" stroke-width="1.8"/><circle cx="16" cy="16" r="3.6" fill="none" stroke="#2C220F" stroke-width="1.2" stroke-opacity=".55"/><circle cx="16" cy="16" r="1.6" fill="#2C220F"/><circle cx="21.5" cy="10.5" r="1.3" fill="#fff" fill-opacity=".85"/></svg></span>' +
        '<span><strong>LocalEditor</strong><em>Private image studio</em></span></a>' +
      '<nav class="le-nav" aria-label="Primary">' +
        '<div class="le-label">Create</div>' +
        item('', 'Home', 'home') +
        item('studio/', 'Photo studio', 'studio') +
        item('pdf-studio/', 'PDF studio', 'pdfstudio') +
        item('convert-to-pdf/', 'Convert to PDF', 'convert') +
        item('recipes/', 'Recipes', 'recipes') +
        '<div class="le-label">Start here</div>' +
        item('image-compressor/', 'Compress', 'compress') +
        item('image-cropper/', 'Crop', 'crop') +
        item('image-resizer/', 'Resize', 'resize') +
        item('image-filters/', 'Filters', 'filters') +
        item('studio/?tool=background', 'Background', 'background') +
        item('studio/?tool=collage', 'Collage', 'collage') +
        '<div class="le-label">Library</div>' +
        item('#image', 'All image tools', 'grid') +
        item('#pdf', 'PDF tools', 'pdf') +
        item('#office', 'Office tools', 'office') +
      '</nav>' +
      '<div class="le-side-foot">' +
        '<div class="le-promise">' + icon(ICONS.shield) + '<span><strong>Private by design</strong>Photos never leave this device.</span></div>' +
        '<button type="button" class="le-install">' + icon(ICONS.download) + 'Install for offline use</button>' +
        '<a class="quiet" href="' + b + 'about/">Privacy</a>' +
      '</div>';
  }

  function topHTML() {
    var b = base();
    var slug = here();
    var names = {
      'image-compressor': 'Compress', 'image-resizer': 'Resize', 'image-converter': 'Convert',
      'image-cropper': 'Crop', 'rotate-flip-image': 'Rotate', 'watermark-image': 'Watermark',
      'image-to-base64': 'Base64', 'color-picker': 'Palette', 'favicon-generator': 'Favicon',
      'image-filters': 'Filters', 'merge-pdf': 'Merge PDF', 'split-pdf': 'Split PDF',
      'jpg-to-pdf': 'JPG to PDF', 'pdf-to-jpg': 'PDF to JPG', 'rotate-pdf': 'Rotate PDF',
      'organize-pdf': 'Organize PDF', 'add-page-numbers': 'Page numbers', 'watermark-pdf': 'Watermark PDF',
      'word-counter': 'Word counter', 'case-converter': 'Case', 'text-diff': 'Compare',
      'lorem-ipsum-generator': 'Lorem ipsum', 'qr-code-generator': 'QR code', 'password-generator': 'Password',
      'json-formatter': 'JSON', 'base64-encoder': 'Base64 text', 'hash-generator': 'Hash',
      'unit-converter': 'Units', 'color-converter': 'Color', 'uuid-generator': 'UUID', 'about': 'Privacy', 'convert-to-pdf': 'Convert to PDF'
    };
    var title = names[slug] || 'This tool';
    var homeCurrent = !slug;
    return '' +
      '<button class="le-icon le-menu" type="button" data-menu aria-label="Open menu" aria-expanded="false">' + icon(ICONS.menu) + '</button>' +
      '<nav class="le-pills" aria-label="Sections">' +
        '<a href="' + b + '"' + (homeCurrent ? ' aria-current="page"' : '') + '>Overview</a>' +
        '<a href="' + b + 'studio/"' + (slug === 'studio' ? ' aria-current="page"' : '') + '>Photo</a>' +
        '<a href="' + b + 'pdf-studio/"' + (slug === 'pdf-studio' ? ' aria-current="page"' : '') + '>PDF</a>' +
        '<a href="' + b + 'recipes/"' + (slug === 'recipes' ? ' aria-current="page"' : '') + '>Recipes</a>' +
        (slug && slug !== 'studio' && slug !== 'pdf-studio' && slug !== 'recipes' ? '<a href="" aria-current="page">' + escapeHtml(title) + '</a>' : '') +
      '</nav>' +
      '<span class="spacer"></span>' +
      '<span class="le-status"><i aria-hidden="true"></i>On this device</span>' +
      '<button class="le-icon" type="button" data-search aria-label="Search tools">' + icon(ICONS.search) + '</button>' +
      '<button class="le-icon" type="button" data-theme-toggle aria-label="Switch color theme">' + icon(ICONS.moon) + '</button>' +
      '<a class="le-avatar" href="' + b + 'about/" aria-label="About LocalEditor">LE</a>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mountShell() {
    var sideSlot = document.querySelector('.le-side[data-fill]');
    var topSlot = document.querySelector('.le-top[data-fill]');
    if (sideSlot) sideSlot.innerHTML = sideHTML();
    if (topSlot) topSlot.innerHTML = topHTML();
    if (document.body.classList.contains('le-built') || document.querySelector('.le-app')) return;
    var main = document.getElementById('main');
    if (!main) return;
    var app = document.createElement('div');
    app.className = 'le-app';
    var side = document.createElement('aside');
    side.className = 'le-side';
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
    scrim.setAttribute('data-scrim', '');
    scrim.setAttribute('aria-label', 'Close menu');
    var skip = document.querySelector('.skip');
    if (skip && skip.nextSibling) document.body.insertBefore(app, skip.nextSibling);
    else document.body.insertBefore(app, document.body.firstChild);
    app.appendChild(side);
    app.appendChild(wrap);
    wrap.appendChild(top);
    wrap.appendChild(content);
    content.appendChild(main);
    var footer = document.querySelector('.site-footer');
    if (footer) content.appendChild(footer);
    document.body.appendChild(scrim);
  }

  function setMenu(open) {
    document.body.classList.toggle('le-menu-open', open);
    var scrim = document.querySelector('[data-scrim]');
    if (scrim) scrim.hidden = !open;
    var btn = document.querySelector('[data-menu]');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  var deferred;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    document.querySelectorAll('.install-btn').forEach(function (b) { b.classList.add('show'); });
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu]')) { setMenu(true); return; }
    if (e.target.closest('[data-scrim]')) { setMenu(false); return; }
    if (e.target.closest('.le-nav a')) setMenu(false);

    var themeBtn = e.target.closest('[data-theme-toggle]');
    if (themeBtn) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('le-theme', next); } catch (err) {}
      return;
    }

    var install = e.target.closest('.install-btn, .le-install');
    if (install) {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.finally(function () { deferred = null; });
      } else {
        IT.say('In the browser menu, choose Install or Add to Home Screen');
      }
      return;
    }

    if (e.target.closest('[data-search]')) openSearch();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
    var tag = (e.target && e.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      openSearch();
    }
  });

  var dialog;
  function openSearch() {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'le-dialog';
      dialog.innerHTML = '<form method="dialog"><input type="search" placeholder="Search tools" aria-label="Search tools" autocomplete="off"><ul></ul><p class="empty-search hidden">No tools match.</p></form>';
      document.body.appendChild(dialog);
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
        } else if (e.key === 'Enter' && i >= 0) {
          e.preventDefault();
          links[i].click();
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
