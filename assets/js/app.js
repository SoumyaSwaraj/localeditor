/* Instant Tools — shared runtime (theme, PWA install, offline, helpers) */
(function () {
  'use strict';
  var root = document.documentElement;
  try { var t = localStorage.getItem('it-theme'); if (t) root.setAttribute('data-theme', t); } catch (e) {}

  var IT = window.IT = {};

  IT.toast = function (msg, ms) {
    var el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
  };

  IT.formatBytes = function (b) {
    if (!b && b !== 0) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(1) : b) + ' ' + u[i];
  };

  /* Trigger a download of a Blob / data URL. */
  IT.download = function (blobOrUrl, filename) {
    var url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    var a = document.createElement('a'); a.href = url; a.download = filename || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    if (typeof blobOrUrl !== 'string') setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  IT.copy = function (text) {
    var done = function () { IT.toast('Copied to clipboard'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done);
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove();
  };

  /* Wire a .dropzone element: IT.dropzone(el, {accept:'image/*', multiple:true, onFiles:fn}) */
  IT.dropzone = function (el, opts) {
    opts = opts || {};
    var input = el.querySelector('input[type=file]');
    if (!input) { input = document.createElement('input'); input.type = 'file'; el.appendChild(input); }
    if (opts.accept) input.accept = opts.accept;
    if (opts.multiple) input.multiple = true;
    el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button');
    var emit = function (list) { var f = Array.prototype.slice.call(list || []); if (f.length && opts.onFiles) opts.onFiles(f); };
    el.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { emit(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) { el.addEventListener(n, function (e) { e.preventDefault(); el.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (n) { el.addEventListener(n, function (e) { e.preventDefault(); el.classList.remove('drag'); }); });
    el.addEventListener('drop', function (e) { emit(e.dataTransfer && e.dataTransfer.files); });
    if (opts.paste) document.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.files) || []; if (items.length) emit(items);
    });
    return input;
  };

  IT.loadImage = function (file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); }; img.onerror = rej; img.src = url;
    });
  };

  IT.canvasToBlob = function (canvas, type, quality) {
    return new Promise(function (res) { canvas.toBlob(res, type || 'image/png', quality); });
  };

  IT.baseName = function (name) { return (name || 'file').replace(/\.[^.]+$/, ''); };

  /* Theme toggle */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark'; root.setAttribute('data-theme', next);
    try { localStorage.setItem('it-theme', next); } catch (err) {}
  });

  /* PWA install prompt */
  var deferred;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    document.querySelectorAll('.install-btn').forEach(function (b) { b.classList.add('show'); });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.install-btn');
    if (!b) return;
    if (deferred) { deferred.prompt(); deferred.userChoice.finally(function () { deferred = null; b.classList.remove('show'); }); }
    else IT.toast('Use your browser menu → "Add to Home screen" to install', 3500);
  });
  window.addEventListener('appinstalled', function () { IT.toast('Installed — works offline now'); });

  /* Service worker (offline). Path relative to site root via data attribute on <html>. */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      var base = root.getAttribute('data-root') || './';
      navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(function () {});
    });
  }
  window.addEventListener('offline', function () { IT.toast('You are offline — tools keep working'); });
})();
