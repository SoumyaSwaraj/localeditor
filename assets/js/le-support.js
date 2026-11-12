/* LocalEditor: device and browser support checks (LE.support). Loaded on every page by the loader at the end
   of app.js. See docs/SUPPORT.md for how features declare what they need, the capability ids, the verdict
   rules and how to update the browser matrix.

   Rules this file keeps:
   - Real feature tests, not user-agent strings, wherever a test exists. The user agent is read only to name the
     browser and operating system (for suggestions and the report) and for the few capabilities that have no test
     (marked `inferred`).
   - A probe answers true, false or null ("cannot tell"). It never throws and never guesses.
   - Ambiguity never blocks: anything short of a definitely missing API can be run anyway.
   - No network requests. Everything it remembers stays in this browser's storage. */
(function () {
  'use strict';
  var LE = window.LE = window.LE || {};
  if (LE.support && LE.support.version) return;

  var root = document.documentElement;
  var BASE = root.getAttribute('data-root') || '';
  var KEY = 'le-support';            /* localStorage: { never: { id: time }, history: { id: { ok|fail, at, msg } } } */
  var SKEY = 'le-support-session';   /* sessionStorage: { id: time } "Try anyway" for this session */
  var PROBE_TIMEOUT = 2500;

  /* ---------- Small helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function read(store, k, d) { try { var v = window[store].getItem(k); return v == null ? d : JSON.parse(v) || d; } catch (e) { return d; } }
  function write(store, k, v) { try { window[store].setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function local() { var s = read('localStorage', KEY, {}); s.never = s.never || {}; s.history = s.history || {}; return s; }
  function list(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }) : []; }
  function joinAnd(a) { return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function sizeText(mb) {
    if (!(mb > 0)) return '';
    if (mb < 1) return 'under 1 MB';
    if (mb < 1000) return 'about ' + (mb < 20 ? Math.round(mb * 10) / 10 : Math.round(mb / 10) * 10) + ' MB';
    return 'about ' + (Math.round(mb / 512) / 2 || 0.5) + ' GB';
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms || PROBE_TIMEOUT);
      Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
  }
  var bus = [];
  function emit(what) {
    bus.slice().forEach(function (fn) { try { fn(what); } catch (e) { console.warn(e); } });
    try { window.dispatchEvent(new CustomEvent('le-support:change', { detail: { what: what } })); } catch (e) {}
    scheduleAnnotate();
  }

  /* ---------- This browser and operating system ----------
     The coarse platform comes from LEPwa.platform() (le-pwa.js owns that sniffing). Here we only add what it does
     not say: the desktop operating system, the browser's name and version, for suggestions and the report. */
  function pwaKind() { try { return window.LEPwa && LEPwa.platform ? LEPwa.platform() : null; } catch (e) { return null; } }
  var envCache = null;
  function env() {
    if (envCache && envCache.fromPwa) return envCache;
    var u = navigator.userAgent || '';
    var kind = pwaKind();
    var ipad = /iPad/.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var os;
    if (kind && /^ios-/.test(kind)) os = 'ios';
    else if (kind && /^android/.test(kind)) os = 'android';
    else os = /iPad|iPhone|iPod/.test(u) || ipad ? 'ios' : /Android/i.test(u) ? 'android' : /CrOS/.test(u) ? 'chromeos' :
      /Windows/.test(u) ? 'windows' : /Macintosh|Mac OS X/.test(u) ? 'mac' : /Linux|X11/.test(u) ? 'linux' : 'other';
    var b;
    if (os === 'ios') b = /CriOS/.test(u) ? 'chrome' : /EdgiOS/.test(u) ? 'edge' : /FxiOS/.test(u) ? 'firefox' : /OPiOS/.test(u) ? 'opera' : 'safari';
    else b = /SamsungBrowser/.test(u) ? 'samsung' : /EdgA?\/|Edg\//.test(u) ? 'edge' : /OPR\//.test(u) ? 'opera' : /Firefox\//.test(u) ? 'firefox' :
      /Chrome\/|Chromium\//.test(u) ? 'chrome' : /Safari\//.test(u) ? 'safari' : 'other';
    var vre = { chrome: /(?:Chrome|CriOS|Chromium)\/(\d+)/, edge: /Edg(?:A|iOS)?\/(\d+)/, firefox: /(?:Firefox|FxiOS)\/(\d+)/, samsung: /SamsungBrowser\/(\d+)/, opera: /(?:OPR|OPiOS)\/(\d+)/, safari: /Version\/(\d+(?:\.\d+)?)/ }[b];
    var vm = vre && vre.exec(u);
    var iosv = /OS (\d+)[_.](\d+)/.exec(u);
    var inApp = kind ? kind === 'in-app' : null;
    var mobile = os === 'ios' || os === 'android';
    var device = os === 'ios' ? (ipad ? 'iPad' : 'iPhone') : os === 'android' ? (/Mobile/.test(u) ? 'phone' : 'tablet') : os === 'other' ? 'device' : 'computer';
    envCache = {
      fromPwa: !!kind,
      os: os,
      osName: { ios: ipad ? 'iPadOS' : 'iOS', android: 'Android', windows: 'Windows', mac: 'macOS', linux: 'Linux', chromeos: 'ChromeOS', other: 'this system' }[os],
      osVersion: os === 'ios' && iosv ? iosv[1] + '.' + iosv[2] : null,
      browser: b,
      browserName: inApp ? 'an app’s built-in browser' : BROWSER_NAMES[b] || 'this browser',
      version: vm ? vm[1] : null,
      engine: os === 'ios' || b === 'safari' ? 'webkit' : b === 'firefox' ? 'gecko' : 'blink',
      inApp: inApp,
      mobile: mobile,
      device: device,
      deviceWord: device === 'iPhone' || device === 'iPad' ? 'this ' + device : 'this ' + device
    };
    return envCache;
  }
  var BROWSER_NAMES = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', samsung: 'Samsung Internet', opera: 'Opera' };
  /* Browsers a person can actually install on each operating system, in the order we suggest them. */
  var BROWSERS_BY_OS = {
    ios: ['safari', 'chrome', 'edge', 'firefox'],
    android: ['chrome', 'edge', 'samsung', 'firefox'],
    windows: ['chrome', 'edge', 'firefox'],
    mac: ['safari', 'chrome', 'edge', 'firefox'],
    linux: ['chrome', 'edge', 'firefox'],
    chromeos: ['chrome'],
    other: []
  };

  /* ---------- Browser support matrix ----------
     Which browsers support each capability on each operating system, for the current stable versions (checked
     November 2026). Used only to suggest a browser; what this browser can do always comes from the probes.
     Spec per OS: names listed are "yes", "?name" is "unsure" (never suggested), unlisted is "no", "all" is every
     browser on that OS. Device and site capabilities (memory, cores, isolation, connection) have no row: another
     browser cannot change them. Update rules are in docs/SUPPORT.md. */
  var MATRIX_SPEC = {
    'wasm':                    'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'wasm-simd':               'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'worker':                  'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'offscreen-canvas':        'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'compression-stream':      'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'web-share':               'ios:all android:chrome,edge,samsung,?firefox windows:chrome,edge mac:safari,?chrome,?edge linux: chromeos:chrome',
    'web-share-files':         'ios:all android:chrome,edge,samsung,?firefox windows:chrome,edge mac:safari,?chrome,?edge linux: chromeos:chrome',
    'clipboard-write-image':   'ios:all android:?chrome,?edge,?samsung windows:chrome,edge,?firefox mac:safari,chrome,edge,?firefox linux:chrome,edge,?firefox chromeos:chrome',
    'clipboard-read':          'ios:all android:chrome,edge,?samsung,?firefox windows:chrome,edge,firefox mac:safari,chrome,edge,firefox linux:chrome,edge,firefox chromeos:chrome',
    'media-recorder':          'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'media-recorder-mp4':      'ios:all android:chrome,edge,?samsung windows:chrome,edge mac:safari,chrome,edge linux:chrome,edge chromeos:chrome',
    'media-recorder-webm':     'ios:?safari,?chrome,?edge,?firefox android:chrome,edge,samsung,firefox windows:all mac:chrome,edge,firefox,?safari linux:all chromeos:chrome',
    'canvas-capture-stream':   'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'webcodecs-video-encoder': 'ios:all android:chrome,edge,?samsung windows:all mac:all linux:all chromeos:chrome',
    'webcodecs-h264':          'ios:all android:chrome,edge,?samsung windows:chrome,edge,?firefox mac:safari,chrome,edge,?firefox linux:?chrome,?edge,?firefox chromeos:chrome',
    'camera':                  'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'file-system-access':      'ios: android:?chrome windows:chrome,edge mac:chrome,edge linux:chrome,edge chromeos:chrome',
    'directory-picker':        'ios: android: windows:chrome,edge mac:chrome,edge linux:chrome,edge chromeos:chrome',
    'file-handling':           'ios: android: windows:chrome,edge mac:chrome,edge linux:chrome,edge chromeos:chrome',
    'launch-queue':            'ios: android:?chrome,?edge windows:chrome,edge mac:chrome,edge linux:chrome,edge chromeos:chrome',
    'share-target':            'ios: android:chrome,?edge,?samsung windows:?edge mac: linux: chromeos:chrome',
    'indexeddb':               'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'cache-storage':           'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'service-worker':          'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'persistent-storage':      'ios:?safari,?chrome,?edge,?firefox android:all windows:all mac:chrome,edge,firefox,?safari linux:all chromeos:all',
    'storage-estimate':        'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'eyedropper':              'ios: android: windows:chrome,edge mac:chrome,edge linux:chrome,edge chromeos:chrome',
    'webgpu':                  'ios:?safari,?chrome,?edge,?firefox android:?chrome,?edge,?samsung windows:chrome,edge,?firefox mac:chrome,edge,?safari,?firefox linux:?chrome,?edge chromeos:chrome',
    'webgl2':                  'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'createimagebitmap':       'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'avif-encode':             'ios: android: windows: mac: linux: chromeos:',
    'webp-encode':             'ios: android:chrome,edge,samsung,firefox windows:all mac:chrome,edge,firefox linux:all chromeos:chrome',
    'install-prompt':          'ios: android:chrome,edge,samsung windows:chrome,edge mac:chrome,edge linux:chrome,edge chromeos:chrome',
    'installable':             'ios:all android:all windows:chrome,edge,?firefox mac:safari,chrome,edge linux:chrome,edge chromeos:chrome',
    'canvas-2d':               'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'canvas-filter':           'ios:?safari,?chrome,?edge,?firefox android:all windows:all mac:chrome,edge,firefox,?safari linux:all chromeos:all',
    'path2d':                  'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'resize-observer':         'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'intersection-observer':   'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'dialog':                  'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'fetch':                   'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'crypto-subtle':           'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'crypto-random':           'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'random-uuid':             'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'text-encoding':           'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'dom-parser':              'ios:all android:all windows:all mac:all linux:all chromeos:all',
    'font-loading':            'ios:all android:all windows:all mac:all linux:all chromeos:all'
  };
  /* Why each "?" above is unsure, for review. */
  var MATRIX_NOTES = {
    'web-share': 'Firefox for Android: share() exists in recent versions but behaviour varies. Chrome and Edge on macOS: shipped in 2024 (Chrome 128 era); not confirmed here.',
    'web-share-files': 'As web-share; Firefox for Android file sharing not confirmed.',
    'clipboard-write-image': 'Chromium on Android: writing PNG via the async clipboard is not confirmed. Firefox desktop: ClipboardItem is on by default from 127; PNG write not confirmed here.',
    'clipboard-read': 'Samsung Internet and Firefox for Android: not confirmed.',
    'media-recorder-mp4': 'Samsung Internet: depends on its Chromium base (MP4 recording arrived in Chromium 126).',
    'media-recorder-webm': 'Safari added WebM recording late (18.x); not confirmed.',
    'webcodecs-video-encoder': 'Samsung Internet: depends on its Chromium base.',
    'webcodecs-h264': 'H.264 encoding depends on the operating system codecs; Firefox and Linux builds vary.',
    'file-system-access': 'Chrome for Android: partial support (open picker) in recent versions; save picker not confirmed.',
    'launch-queue': 'Chromium on Android exposes the launch queue in some versions; file handling itself is desktop only.',
    'share-target': 'Edge and Samsung Internet on Android, and Edge on Windows, are documented in places but not confirmed here.',
    'persistent-storage': 'Safari (and every iOS browser) added persist() around Safari 17; not confirmed here.',
    'webgpu': 'Safari 26 (iOS 26, macOS 26) ships WebGPU; older versions do not. Android needs Android 12+ and a supported GPU. Firefox has it on Windows from 141; macOS and Linux later. Chrome on Linux is not on by default everywhere.',
    'installable': 'Firefox on Windows can pin sites as taskbar apps from 143; not counted as install here.',
    'canvas-filter': 'Safari: canvas filters were behind a flag for years; whether Safari 18 or 26 ships them by default is not confirmed.'
  };
  var SUPPORT_MATRIX = (function () {
    var out = {};
    Object.keys(MATRIX_SPEC).forEach(function (cap) {
      var row = out[cap] = {};
      MATRIX_SPEC[cap].split(/\s+/).forEach(function (part) {
        var m = /^(\w+):(.*)$/.exec(part);
        if (!m) return;
        var os = m[1], cell = row[os] = {};
        (BROWSERS_BY_OS[os] || []).forEach(function (b) { cell[b] = 0; });
        m[2].split(',').filter(Boolean).forEach(function (b) {
          if (b === 'all') (BROWSERS_BY_OS[os] || []).forEach(function (x) { cell[x] = 1; });
          else if (b.charAt(0) === '?') cell[b.slice(1)] = '?';
          else cell[b] = 1;
        });
      });
    });
    return out;
  })();
  function matrixValue(cap, os, browser) {
    var row = SUPPORT_MATRIX[cap];
    if (!row || !row[os] || !own(row[os], browser)) return null;
    var v = row[os][browser];
    return v === 1 ? true : v === 0 ? false : null;
  }

  /* ---------- Capabilities ----------
     Each: { kind: 'browser' | 'device' | 'site', test (sync, cheap or computed once on first use), async (lazy,
     run by probe()), inferred (no feature test exists; answered from the platform), live (a cheap test of a global
     that can change after load: connection, display mode, a polyfill or a test stub; never cached), can, lack }.
     `can` completes "Chrome on this phone can …"; `lack` is the plain sentence shown when it is missing. */
  var WASM_SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
  var WASM_THREADS = [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11];
  function wasmValid(bytes) { return typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function' && WebAssembly.validate(new Uint8Array(bytes)); }
  function canvas2d() { var c = document.createElement('canvas'); c.width = c.height = 1; return c.getContext && c.getContext('2d'); }
  function encodes(type) { var c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL(type).indexOf('data:' + type) === 0; }
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var why = {};

  var CAPS = {
    'wasm': { kind: 'browser', test: function () { return wasmValid([0, 97, 115, 109, 1, 0, 0, 0]); }, can: 'run the fast engine some tools use', lack: 'This browser cannot run the fast engine some tools use.' },
    'wasm-simd': { kind: 'browser', test: function () { return wasmValid(WASM_SIMD); }, can: 'run on-device AI models', lack: 'This browser is too old to run on-device AI models.' },
    'wasm-threads': {
      kind: 'site',
      test: function () {
        if (typeof SharedArrayBuffer === 'undefined' || window.crossOriginIsolated !== true) {
          why['wasm-threads'] = window.crossOriginIsolated === true ? 'no-shared-memory' : 'not-isolated';
          return false;
        }
        var ok = wasmValid(WASM_THREADS);
        why['wasm-threads'] = ok ? null : 'no-wasm-threads';
        return ok;
      },
      can: 'use several processor cores for AI',
      lack: 'This site runs AI on one processor core, so it takes a little longer.'
    },
    'worker': { kind: 'browser', test: function () { return typeof Worker === 'function'; }, can: 'do heavy work in the background', lack: 'This browser cannot do heavy work in the background, so the page may pause while it works.' },
    'offscreen-canvas': { kind: 'browser', test: function () { if (typeof OffscreenCanvas !== 'function') return false; try { return !!new OffscreenCanvas(1, 1).getContext('2d'); } catch (e) { return false; } }, can: 'draw images in the background', lack: 'This browser cannot draw images in the background.' },
    'compression-stream': { kind: 'browser', test: function () { if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return false; try { new CompressionStream('deflate-raw'); new DecompressionStream('deflate-raw'); return true; } catch (e) { return false; } }, can: 'compress links and files', lack: 'This browser cannot compress data, so share links are longer and some project files cannot be opened.' },
    'web-share': { live: true, kind: 'browser', test: function () { return typeof navigator.share === 'function'; }, can: 'open the share menu', lack: 'This browser cannot open the share menu.' },
    'web-share-files': {
      live: true, kind: 'browser',
      test: function () {
        if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return false;
        try { return !!navigator.canShare({ files: [new File(['x'], 'probe.png', { type: 'image/png' })] }); } catch (e) { return false; }
      },
      can: 'share images to other apps', lack: 'This browser cannot share images to other apps.'
    },
    'clipboard-write-image': {
      live: true, kind: 'browser',
      test: function () {
        if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof window.ClipboardItem !== 'function') return false;
        if (typeof ClipboardItem.supports === 'function') { try { return !!ClipboardItem.supports('image/png'); } catch (e) { return null; } }
        return true;
      },
      can: 'copy images to the clipboard', lack: 'This browser cannot copy images to the clipboard.'
    },
    'clipboard-read': { live: true, kind: 'browser', test: function () { return !!(navigator.clipboard && typeof navigator.clipboard.read === 'function'); }, can: 'paste images from the clipboard', lack: 'This browser cannot paste images from the clipboard.' },
    'media-recorder': { live: true, kind: 'browser', test: function () { return typeof window.MediaRecorder === 'function'; }, can: 'record video', lack: 'This browser cannot record video.' },
    'media-recorder-mp4': { live: true, kind: 'browser', test: function () { var M = window.MediaRecorder; if (typeof M !== 'function') return false; if (typeof M.isTypeSupported !== 'function') return null; return M.isTypeSupported('video/mp4') || M.isTypeSupported('video/mp4;codecs=avc1'); }, can: 'save videos as MP4', lack: 'This browser cannot save videos as MP4.' },
    'media-recorder-webm': { live: true, kind: 'browser', test: function () { var M = window.MediaRecorder; if (typeof M !== 'function') return false; if (typeof M.isTypeSupported !== 'function') return null; return M.isTypeSupported('video/webm') || M.isTypeSupported('video/webm;codecs=vp9') || M.isTypeSupported('video/webm;codecs=vp8'); }, can: 'save videos as WebM', lack: 'This browser cannot save videos as WebM.' },
    'canvas-capture-stream': { live: true, kind: 'browser', test: function () { return typeof HTMLCanvasElement === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function'; }, can: 'turn a design into a video', lack: 'This browser cannot turn a design into a video.' },
    'webcodecs-video-encoder': { live: true, kind: 'browser', test: function () { return typeof window.VideoEncoder === 'function'; }, can: 'make videos quickly', lack: 'This browser cannot make videos quickly, so video export is slower.' },
    'webcodecs-h264': {
      kind: 'browser',
      test: function () { return typeof window.VideoEncoder === 'function' && typeof VideoEncoder.isConfigSupported === 'function' ? null : false; },
      async: function () { return VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 640, height: 480, bitrate: 1e6, framerate: 30 }).then(function (r) { return !!(r && r.supported); }); },
      can: 'make MP4 videos quickly', lack: 'This browser cannot make MP4 videos quickly.'
    },
    'camera': { live: true, kind: 'browser', test: function () { return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'); }, can: 'use the camera', lack: 'This browser cannot use the camera here.' },
    'file-system-access': { live: true, kind: 'browser', test: function () { return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function'; }, can: 'save straight back to a file you opened', lack: 'This browser cannot save straight back to a file you opened; it saves a new copy instead.' },
    'directory-picker': { live: true, kind: 'browser', test: function () { return typeof window.showDirectoryPicker === 'function'; }, can: 'open a folder and keep it in sync', lack: 'This browser cannot open a folder and keep it in sync.' },
    'launch-queue': { kind: 'browser', test: function () { return 'launchQueue' in window; }, can: 'receive files when the app opens', lack: 'This browser cannot hand files to LocalEditor when it opens.' },
    'file-handling': {
      kind: 'browser', inferred: true,
      test: function () {
        if (!('launchQueue' in window)) return false;
        if (!(typeof window.LaunchParams === 'function' && 'files' in LaunchParams.prototype)) return false;
        /* Browsers register file handlers for installed apps on desktop systems only. */
        return !env().mobile;
      },
      can: 'open files from the file manager', lack: 'This browser cannot open files from the file manager in LocalEditor.'
    },
    'share-target': {
      kind: 'browser', inferred: true,
      test: function () { var e = env(); return e.inApp ? false : matrixValue('share-target', e.os, e.browser); },
      can: 'receive photos shared from other apps', lack: 'This browser cannot receive photos shared from other apps.'
    },
    'indexeddb': {
      kind: 'browser',
      test: function () { try { return typeof indexedDB !== 'undefined' && !!indexedDB && typeof indexedDB.open === 'function'; } catch (e) { return false; } },
      async: function () {
        return new Promise(function (resolve) {
          var name = 'le-support-probe', req;
          try { req = indexedDB.open(name); } catch (e) { resolve(false); return; }
          req.onsuccess = function () { try { req.result.close(); indexedDB.deleteDatabase(name); } catch (e) {} resolve(true); };
          req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve(false); };
          req.onblocked = function () { resolve(null); };
        });
      },
      can: 'save designs on this device', lack: 'This browser cannot save designs on this device. Private browsing can cause this.'
    },
    'cache-storage': {
      kind: 'browser',
      test: function () { return typeof caches !== 'undefined' && !!caches && typeof caches.open === 'function'; },
      async: function () { return caches.keys().then(function () { return true; }, function () { return false; }); },
      can: 'keep app files for offline use', lack: 'This browser cannot keep app files for offline use. Private browsing can cause this.'
    },
    'service-worker': { kind: 'browser', test: function () { return 'serviceWorker' in navigator && !!navigator.serviceWorker; }, can: 'run the app with no connection', lack: 'This browser cannot run LocalEditor with no connection.' },
    'persistent-storage': { kind: 'browser', test: function () { return !!(navigator.storage && typeof navigator.storage.persist === 'function'); }, can: 'protect saved work from automatic clean-up', lack: 'This browser cannot protect saved work from automatic clean-up.' },
    'storage-estimate': { kind: 'browser', test: function () { return !!(navigator.storage && typeof navigator.storage.estimate === 'function'); }, can: 'say how much space is free', lack: 'This browser does not say how much space is free.' },
    'eyedropper': { live: true, kind: 'browser', test: function () { return typeof window.EyeDropper === 'function'; }, can: 'pick colours from anywhere on screen', lack: 'This browser can only pick colours from inside the page.' },
    'webgpu': {
      kind: 'browser',
      test: function () { return navigator.gpu && typeof navigator.gpu.requestAdapter === 'function' ? null : false; },
      async: function () { return navigator.gpu.requestAdapter().then(function (a) { return !!a; }); },
      can: 'use the graphics chip for AI', lack: 'This browser cannot use the graphics chip for AI, so it uses the processor instead.'
    },
    'webgl2': {
      kind: 'browser', lazy: true,
      test: function () {
        var c = document.createElement('canvas');
        var gl = c.getContext('webgl2');
        if (!gl) return false;
        try { var x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {}
        return true;
      },
      can: 'use the graphics chip for effects', lack: 'This browser cannot use the graphics chip for effects.'
    },
    'canvas-max-area': {
      kind: 'device', lazy: true,
      test: function () { return maxCanvas().area >= 32 * 1024 * 1024; },
      can: 'edit very large photos at full size',
      lack: function () { return 'Very large photos are reduced to about ' + Math.floor(maxCanvas().area / 1e6) + ' megapixels on ' + env().deviceWord + '.'; }
    },
    'createimagebitmap': { kind: 'browser', test: function () { return typeof window.createImageBitmap === 'function'; }, can: 'open photos quickly', lack: 'This browser opens photos more slowly.' },
    'avif-encode': { kind: 'browser', lazy: true, test: function () { return encodes('image/avif'); }, can: 'save AVIF images', lack: 'This browser cannot save AVIF images.' },
    'webp-encode': { kind: 'browser', lazy: true, test: function () { return encodes('image/webp'); }, can: 'save WebP images', lack: 'This browser cannot save WebP images; it saves PNG instead.' },
    'install-prompt': { live: true, kind: 'browser', test: function () { return 'onbeforeinstallprompt' in window || !!(window.__lePwaEarly && window.__lePwaEarly.prompt); }, can: 'install with one tap', lack: 'This browser has no one-tap install, so installing takes a few steps from its menu.' },
    'installable': {
      kind: 'browser', inferred: true,
      test: function () {
        if (has('standalone')) return true;
        var e = env();
        if (e.inApp) return false;
        if (window.LEPwa && LEPwa.canInstall) { try { return !!(LEPwa.isInstalled() || LEPwa.canInstall()); } catch (x) { return null; } }
        return matrixValue('installable', e.os, e.browser);
      },
      can: 'install LocalEditor as an app', lack: 'This browser cannot install LocalEditor as an app.'
    },
    'touch': { kind: 'device', test: function () { return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window; }, can: 'use touch', lack: 'This device has no touch screen.' },
    'pointer-fine': { kind: 'device', test: function () { return window.matchMedia ? mq('(any-pointer: fine)') : null; }, can: 'use a mouse or trackpad', lack: 'This device has no mouse or trackpad, so fine placement is by touch.' },
    'device-memory-4gb': { kind: 'device', test: function () { var m = memoryGB(); return m == null ? null : m >= 4; }, can: 'hold large work in memory', lack: function () { return cap1(env().deviceWord) + ' has less than 4 GB of memory.'; } },
    'cpu-cores': { kind: 'device', test: function () { var n = cpuCores(); return n == null ? null : n >= 4; }, can: 'work on several things at once', lack: function () { return cap1(env().deviceWord) + ' has fewer than 4 processor cores, so heavy work is slower.'; } },
    'secure-context': { kind: 'site', test: function () { return window.isSecureContext === true; }, can: 'use protected features', lack: 'This page is not on a secure connection, so some features are switched off.' },
    'in-app-browser': { kind: 'site', inferred: true, test: function () { return env().inApp; }, can: '', lack: 'This is an app’s built-in browser, which switches some features off.' },
    'standalone': { live: true, kind: 'site', test: function () { return mq('(display-mode: standalone)') || mq('(display-mode: minimal-ui)') || mq('(display-mode: fullscreen)') || mq('(display-mode: window-controls-overlay)') || navigator.standalone === true; }, can: 'run as an installed app', lack: 'LocalEditor is not installed on this device.' },
    'online': { live: true, kind: 'site', inferred: true, test: function () { return navigator.onLine !== false; }, can: 'reach the internet', lack: 'You are offline. This needs a connection.' },
    'canvas-2d': { kind: 'browser', test: function () { return !!canvas2d(); }, can: 'draw images', lack: 'This browser cannot draw images.' },
    'canvas-filter': { kind: 'browser', test: function () { var c = canvas2d(); if (!c || !('filter' in c)) return false; c.filter = 'blur(2px)'; return c.filter === 'blur(2px)'; }, can: 'blur and filter quickly', lack: 'This browser draws blur and filters a simpler way, so they look slightly different.' },
    'path2d': { kind: 'browser', test: function () { return typeof window.Path2D === 'function'; }, can: 'draw shapes and masks', lack: 'This browser cannot draw shapes and masks.' },
    'resize-observer': { kind: 'browser', test: function () { return typeof window.ResizeObserver === 'function'; }, can: 'fit the editor to the screen', lack: 'This browser cannot fit the editor to the screen as it changes size.' },
    'intersection-observer': { kind: 'browser', test: function () { return typeof window.IntersectionObserver === 'function'; }, can: 'load previews as you scroll', lack: 'This browser loads every preview at once, which is slower.' },
    'dialog': { kind: 'browser', test: function () { return typeof window.HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function'; }, can: 'show pop-up panels', lack: 'This browser shows panels in a simpler way.' },
    'fetch': { kind: 'browser', test: function () { return typeof window.fetch === 'function'; }, can: 'load files on demand', lack: 'This browser cannot load files on demand.' },
    'crypto-subtle': { kind: 'browser', test: function () { return !!(window.crypto && crypto.subtle && typeof crypto.subtle.digest === 'function'); }, can: 'compute secure checksums', lack: 'This browser cannot compute secure checksums here.' },
    'crypto-random': { kind: 'browser', test: function () { return !!(window.crypto && typeof crypto.getRandomValues === 'function'); }, can: 'make secure random numbers', lack: 'This browser cannot make secure random numbers.' },
    'random-uuid': { kind: 'browser', test: function () { return !!(window.crypto && typeof crypto.randomUUID === 'function'); }, can: 'make standard IDs directly', lack: 'This browser makes IDs a slower way.' },
    'text-encoding': { kind: 'browser', test: function () { return typeof window.TextEncoder === 'function' && typeof window.TextDecoder === 'function'; }, can: 'read and write text in any language', lack: 'This browser cannot convert text reliably.' },
    'dom-parser': { kind: 'browser', test: function () { return typeof window.DOMParser === 'function'; }, can: 'read documents', lack: 'This browser cannot read documents.' },
    'font-loading': { kind: 'browser', test: function () { return typeof window.FontFace === 'function' && !!document.fonts; }, can: 'load fonts on demand', lack: 'This browser cannot load fonts on demand, so some text uses a fallback font.' }
  };
  /* Capabilities another browser cannot change. */
  function suggestable(cap) { var c = CAPS[cap]; return !!c && c.kind === 'browser' && !!SUPPORT_MATRIX[cap]; }

  var results = {};      /* cap -> true | false | null, after the sync test or the async probe */
  var probed = {};       /* cap -> true once the async probe has answered */
  var pending = {};      /* cap -> Promise */
  var overrides = {};    /* cap -> value, for tests and support staff (LE.support.override) */

  function runSync(cap) {
    var c = CAPS[cap];
    if (!c) return null;
    try {
      var v = c.test();
      return v === true || v === false ? v : null;
    } catch (e) { return null; }
  }
  function has(cap) {
    if (own(overrides, cap)) return overrides[cap];
    if (!CAPS[cap]) return null;
    if (CAPS[cap].live && !CAPS[cap].async) return runSync(cap);
    if (own(results, cap)) return results[cap];
    var v = runSync(cap);
    /* Inferred answers can change once le-pwa arrives, so they are not cached until it has. */
    if (!CAPS[cap].inferred || pwaKind()) results[cap] = v;
    return v;
  }
  function probe(cap) {
    if (own(overrides, cap)) return Promise.resolve(overrides[cap]);
    var c = CAPS[cap];
    if (!c) return Promise.resolve(null);
    if (!c.async || probed[cap]) return Promise.resolve(has(cap));
    if (pending[cap]) return pending[cap];
    var pre = runSync(cap);
    if (pre === false) { results[cap] = false; probed[cap] = true; return Promise.resolve(false); }
    pending[cap] = withTimeout(new Promise(function (resolve) {
      try { resolve(c.async()); } catch (e) { resolve(null); }
    })).then(function (v) {
      v = v === true || v === false ? v : null;
      results[cap] = v;
      probed[cap] = true;
      delete pending[cap];
      emit('probe');
      return v;
    });
    return pending[cap];
  }
  function probeAll(caps) {
    caps = caps ? list(caps) : Object.keys(CAPS);
    return Promise.all(caps.map(probe)).then(function () {
      var out = {};
      caps.forEach(function (k) { out[k] = has(k); });
      return out;
    });
  }

  /* ---------- Device numbers ---------- */
  function memoryGB() { try { var m = navigator.deviceMemory; return typeof m === 'number' && m > 0 ? m : null; } catch (e) { return null; } }
  function cpuCores() { try { var n = navigator.hardwareConcurrency; return typeof n === 'number' && n > 0 ? n : null; } catch (e) { return null; } }
  /* Largest canvas this browser will draw. Area limits cannot be measured safely (a test would allocate up to
     1 GB), so they come from a conservative table per engine; the edge length is checked with a 1 px tall
     canvas, which costs a few kilobytes. iOS is the classic failure: about 16.7 megapixels in total. */
  var maxCanvasCache = null;
  function maxCanvas() {
    if (maxCanvasCache) return maxCanvasCache;
    var e = env();
    var t = e.os === 'ios' ? { side: 8192, area: 16777216 } :
      e.os === 'android' ? (e.browser === 'firefox' ? { side: 8192, area: 33554432 } : { side: 16384, area: 67108864 }) :
      e.browser === 'firefox' ? { side: 16384, area: 124992400 } :
      { side: 16384, area: 268435456 };
    var side = t.side, measured = false;
    try {
      var c = document.createElement('canvas');
      for (var s = side; s >= 2048; s = s / 2) {
        c.width = s; c.height = 1;
        var x = c.getContext('2d');
        if (!x) break;
        x.fillStyle = '#123456';
        x.fillRect(s - 1, 0, 1, 1);
        var d = x.getImageData(s - 1, 0, 1, 1).data;
        if (d[0] === 0x12 && d[2] === 0x56) { side = s; measured = true; break; }
      }
      c.width = c.height = 1;
    } catch (err) { measured = false; }
    var area = Math.min(t.area, side * side);
    maxCanvasCache = { side: side, area: area, megapixels: Math.round(area / 1e5) / 10, measured: measured ? 'side' : false, source: 'table' };
    return maxCanvasCache;
  }

  /* ---------- Feature registry ---------- */
  var defs = {};
  var order = [];
  var GROUPS = ['Photo studio', 'PDF studio', 'Sharing', 'Offline and install', 'On-device AI', 'Tools'];
  var GROUP_ALIASES = {
    photo: 'Photo studio', studio: 'Photo studio', design: 'Photo studio', 'photo studio': 'Photo studio', export: 'Sharing',
    pdf: 'PDF studio', 'pdf studio': 'PDF studio', documents: 'PDF studio',
    share: 'Sharing', sharing: 'Sharing', social: 'Sharing',
    offline: 'Offline and install', install: 'Offline and install', storage: 'Offline and install', 'offline and install': 'Offline and install',
    ai: 'On-device AI', 'on-device ai': 'On-device AI', cutout: 'On-device AI', ocr: 'On-device AI', models: 'On-device AI',
    tools: 'Tools', tool: 'Tools'
  };
  function groupName(g) {
    if (!g) return 'Tools';
    var k = String(g).trim();
    return GROUP_ALIASES[k.toLowerCase()] || k.slice(0, 40);
  }
  function define(d, builtin) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(d.id)) return null;
    var prev = defs[d.id];
    if (builtin && prev && !prev.builtin) return prev;   /* an owner's own definition wins over the built-in one */
    var def = {
      id: d.id,
      name: typeof d.name === 'string' && d.name ? d.name.slice(0, 80) : d.id,
      group: groupName(d.group),
      needs: list(d.needs),
      wants: list(d.wants),
      memoryMB: typeof d.memoryMB === 'number' && d.memoryMB > 0 ? d.memoryMB : 0,
      downloadMB: typeof d.downloadMB === 'number' && d.downloadMB > 0 ? d.downloadMB : 0,
      note: typeof d.note === 'string' ? d.note.slice(0, 240) : '',
      degraded: typeof d.degraded === 'string' ? d.degraded.slice(0, 240) : (d.degraded === true ? 'A simpler version still works.' : ''),
      url: typeof d.url === 'string' ? d.url : '',
      builtin: !!builtin
    };
    if (!prev) order.push(def.id);
    defs[def.id] = def;
    if (ready) emit('define');
    return def;
  }
  function features() { return order.map(function (id) { return defs[id]; }); }

  /* Built-in definitions for everything that already exists (read from the code, November 2026). */
  var BUILTIN = [
    /* Photo studio */
    { id: 'studio.core', name: 'Photo and design studio', group: 'Photo studio', url: 'studio/', needs: ['canvas-2d', 'path2d', 'resize-observer'], wants: ['createimagebitmap', 'font-loading', 'canvas-filter'], memoryMB: 300, note: 'Layers, text, photos, shapes and pages.' },
    { id: 'studio.large-photos', name: 'Large photo editing', group: 'Photo studio', url: 'studio/', needs: ['canvas-2d'], wants: ['canvas-max-area', 'createimagebitmap'], memoryMB: 700, degraded: 'Photos are reduced to fit this device.', note: 'Photos over the device limit are reduced for editing.' },
    { id: 'studio.pdf-export', name: 'Multi-page PDF export', group: 'Photo studio', url: 'studio/', needs: ['canvas-2d'], wants: ['fetch'], memoryMB: 400 },
    { id: 'studio.projects', name: 'Projects and version history', group: 'Photo studio', url: 'studio/', needs: ['indexeddb'], wants: ['compression-stream', 'persistent-storage', 'storage-estimate'], note: 'Designs are saved in this browser only.' },
    { id: 'studio.collage', name: 'Collage', group: 'Photo studio', url: 'studio/?tool=collage', needs: ['canvas-2d', 'fetch'], wants: ['intersection-observer', 'cache-storage'], memoryMB: 400 },
    { id: 'studio.recipes', name: 'Recipes and batch', group: 'Photo studio', url: 'recipes/', needs: ['canvas-2d'], wants: ['compression-stream'], memoryMB: 400, note: 'Batch runs one photo at a time to save memory. Results download as a zip.' },
    { id: 'studio.background', name: 'Background photo editing', group: 'Photo studio', url: 'studio/', needs: ['canvas-2d'], wants: ['canvas-filter'], memoryMB: 300 },
    { id: 'studio.stock', name: 'Stock photo search', group: 'Photo studio', url: 'studio/', needs: ['online', 'fetch'], wants: ['createimagebitmap'], note: 'Needs a connection. Searches go to the photo provider you choose.' },
    { id: 'studio.eyedropper', name: 'Pick a colour from the screen', group: 'Photo studio', url: 'studio/', needs: [], wants: ['eyedropper'], note: 'Without it you can still pick colours from your design.' },
    /* PDF studio */
    { id: 'pdf.open', name: 'Open and read PDFs', group: 'PDF studio', url: 'pdf-studio/', needs: ['canvas-2d'], wants: ['worker'], memoryMB: 300 },
    { id: 'pdf.edit', name: 'Edit PDF pages', group: 'PDF studio', url: 'pdf-studio/', needs: ['canvas-2d'], wants: ['font-loading', 'resize-observer'], memoryMB: 400 },
    { id: 'pdf.sign', name: 'Sign PDFs', group: 'PDF studio', url: 'pdf-studio/', needs: ['canvas-2d'], wants: ['indexeddb'], note: 'Saved signatures stay in this browser.' },
    { id: 'pdf.save', name: 'Save PDFs', group: 'PDF studio', url: 'pdf-studio/', needs: [], wants: [], memoryMB: 300 },
    { id: 'pdf.convert-office', name: 'Convert Office files to PDF', group: 'PDF studio', url: 'convert-to-pdf/', needs: ['dom-parser', 'canvas-2d'], wants: ['text-encoding'], memoryMB: 500 },
    /* Sharing */
    { id: 'export.copy', name: 'Copy image', group: 'Sharing', needs: ['clipboard-write-image'], wants: [], degraded: '' },
    { id: 'export.share', name: 'Share to other apps', group: 'Sharing', needs: ['web-share-files'], wants: [] },
    { id: 'recipes.share-link', name: 'Recipe share links', group: 'Sharing', url: 'recipes/', needs: [], wants: ['compression-stream', 'web-share'] },
    /* Offline and install */
    { id: 'offline.app', name: 'Works offline', group: 'Offline and install', needs: ['service-worker', 'cache-storage'], wants: ['persistent-storage'] },
    { id: 'offline.install', name: 'Install as an app', group: 'Offline and install', needs: ['installable'], wants: [] },
    { id: 'offline.storage-manager', name: 'Storage manager', group: 'Offline and install', needs: [], wants: ['storage-estimate', 'persistent-storage', 'cache-storage', 'indexeddb'] },
    { id: 'os.share-target', name: 'Receive photos from other apps', group: 'Offline and install', needs: ['share-target'], wants: ['standalone'], note: 'Works once LocalEditor is installed.' },
    { id: 'os.file-handlers', name: 'Open files from the file manager', group: 'Offline and install', needs: ['file-handling'], wants: ['standalone'], note: 'Works once LocalEditor is installed.' },
    /* On-device AI */
    { id: 'labs.bg-remove', name: 'Background remover (lab)', group: 'On-device AI', url: 'labs/bg-remove/', needs: ['wasm', 'wasm-simd', 'worker', 'offscreen-canvas', 'createimagebitmap'], wants: ['cache-storage'], memoryMB: 400, downloadMB: 7.1, note: 'Prototype. Downloads the small model the first time.' },
    /* Tools */
    { id: 'tool.image-compressor', name: 'Image compressor', group: 'Tools', url: 'image-compressor/', needs: ['canvas-2d'], wants: ['webp-encode'] },
    { id: 'tool.image-converter', name: 'Image converter', group: 'Tools', url: 'image-converter/', needs: ['canvas-2d'], wants: ['webp-encode'] },
    { id: 'tool.image-resizer', name: 'Image resizer', group: 'Tools', url: 'image-resizer/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.image-cropper', name: 'Image cropper', group: 'Tools', url: 'image-cropper/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.image-filters', name: 'Image filters', group: 'Tools', url: 'image-filters/', needs: ['canvas-2d'], wants: ['canvas-filter'] },
    { id: 'tool.rotate-flip-image', name: 'Rotate and flip image', group: 'Tools', url: 'rotate-flip-image/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.watermark-image', name: 'Watermark image', group: 'Tools', url: 'watermark-image/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.image-to-base64', name: 'Image to Base64', group: 'Tools', url: 'image-to-base64/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.favicon-generator', name: 'Favicon generator', group: 'Tools', url: 'favicon-generator/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.color-picker', name: 'Colour picker', group: 'Tools', url: 'color-picker/', needs: [], wants: ['eyedropper'] },
    { id: 'tool.qr-code-generator', name: 'QR code generator', group: 'Tools', url: 'qr-code-generator/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.merge-pdf', name: 'Merge PDF', group: 'Tools', url: 'merge-pdf/', needs: [], wants: ['worker'] },
    { id: 'tool.split-pdf', name: 'Split PDF', group: 'Tools', url: 'split-pdf/', needs: [], wants: ['worker'] },
    { id: 'tool.organize-pdf', name: 'Organise PDF pages', group: 'Tools', url: 'organize-pdf/', needs: ['canvas-2d'], wants: ['worker'] },
    { id: 'tool.rotate-pdf', name: 'Rotate PDF', group: 'Tools', url: 'rotate-pdf/', needs: ['canvas-2d'], wants: ['worker'] },
    { id: 'tool.add-page-numbers', name: 'Add page numbers', group: 'Tools', url: 'add-page-numbers/', needs: [], wants: ['worker'] },
    { id: 'tool.watermark-pdf', name: 'Watermark PDF', group: 'Tools', url: 'watermark-pdf/', needs: [], wants: ['worker'] },
    { id: 'tool.jpg-to-pdf', name: 'JPG to PDF', group: 'Tools', url: 'jpg-to-pdf/', needs: ['canvas-2d'], wants: [] },
    { id: 'tool.pdf-to-jpg', name: 'PDF to JPG', group: 'Tools', url: 'pdf-to-jpg/', needs: ['canvas-2d'], wants: ['worker'], memoryMB: 300 },
    { id: 'tool.hash-generator', name: 'Hash generator', group: 'Tools', url: 'hash-generator/', needs: ['crypto-subtle', 'text-encoding'], wants: [] },
    { id: 'tool.password-generator', name: 'Password generator', group: 'Tools', url: 'password-generator/', needs: ['crypto-random'], wants: [] },
    { id: 'tool.uuid-generator', name: 'UUID generator', group: 'Tools', url: 'uuid-generator/', needs: ['crypto-random'], wants: ['random-uuid'] },
    { id: 'tool.base64-encoder', name: 'Base64 encoder', group: 'Tools', url: 'base64-encoder/', needs: ['text-encoding'], wants: [] },
    { id: 'tool.text', name: 'Text tools (word counter, case, diff, JSON, lorem ipsum)', group: 'Tools', url: 'word-counter/', needs: [], wants: [] },
    { id: 'tool.converters', name: 'Unit and colour converters', group: 'Tools', url: 'unit-converter/', needs: [], wants: [] }
  ];

  /* ---------- History and remembered choices ---------- */
  function history(id) { var hst = local().history[id]; return hst || null; }
  /* A cancel, a lost connection or a failed download says nothing about whether this device can run the feature,
     so gate() does not record those (an error can also opt out with err.deviceFailure === false). */
  function isDeviceFailure(err) {
    if (!err) return true;
    if (err.deviceFailure === false) return false;
    if (err.deviceFailure === true) return true;
    if (err.name === 'AbortError' || err.cancelled) return false;
    return !/^(cancelled|canceled|abort|offline|download|network|unsupported)$/.test(String(err.code || ''));
  }
  function reportFailure(id, error) {
    if (typeof id !== 'string') return;
    var s = local();
    var msg = error && error.message ? String(error.message) : error ? String(error) : '';
    s.history[id] = { fail: true, at: Date.now(), msg: msg.slice(0, 200) };
    write('localStorage', KEY, s);
    emit('history');
  }
  function reportSuccess(id) {
    if (typeof id !== 'string') return;
    var s = local();
    var prev = s.history[id];
    if (prev && prev.ok && Date.now() - prev.at < 6e4) return;   /* already recorded; keep storage writes rare */
    s.history[id] = { ok: true, at: Date.now() };
    write('localStorage', KEY, s);
    emit('history');
  }
  function forced(id) {
    if (read('sessionStorage', SKEY, {})[id]) return 'session';
    if (local().never[id]) return 'device';
    return null;
  }
  function rememberForce(id, device) {
    var s = read('sessionStorage', SKEY, {});
    s[id] = Date.now();
    write('sessionStorage', SKEY, s);
    if (device) { var l = local(); l.never[id] = Date.now(); write('localStorage', KEY, l); }
  }
  function forget(id) {
    var l = local();
    var ss = read('sessionStorage', SKEY, {});
    if (id) { delete l.never[id]; delete l.history[id]; delete ss[id]; }
    else { l = { never: {}, history: {} }; ss = {}; }
    write('localStorage', KEY, l);
    write('sessionStorage', SKEY, ss);
    emit('history');
  }

  /* ---------- Verdicts ---------- */
  function capLack(cap) {
    var c = CAPS[cap];
    if (!c) return 'This needs something this browser does not describe.';
    return typeof c.lack === 'function' ? c.lack() : c.lack;
  }
  function capUnknown(cap) {
    var c = CAPS[cap];
    if (cap === 'device-memory-4gb') return 'This browser does not say how much memory ' + env().deviceWord + ' has.';
    if (cap === 'cpu-cores') return 'This browser does not say how many processor cores ' + env().deviceWord + ' has.';
    if (!c || !c.can) return 'We could not tell whether this browser supports everything this needs.';
    return 'This browser does not say whether it can ' + c.can + '.';
  }

  function engineOf(os, b) { return os === 'ios' || b === 'safari' ? 'webkit' : b === 'firefox' ? 'gecko' : 'blink'; }
  function suggestFor(def, missing) {
    var e = env();
    var caps = missing.filter(suggestable);
    if (!caps.length) return [];
    var out = [];
    if (e.inApp) {
      var main = e.os === 'ios' ? 'safari' : e.os === 'android' ? 'chrome' : null;
      if (main && caps.every(function (c) { return matrixValue(c, e.os, main) === true; })) {
        out.push({ browser: BROWSER_NAMES[main], reason: 'Open this page in ' + BROWSER_NAMES[main] + ' to use ' + def.name.toLowerCase() + '. Built-in app browsers switch some features off.' });
      }
      return out;
    }
    var names = (BROWSERS_BY_OS[e.os] || []).filter(function (b) {
      if (b === e.browser) return false;
      return caps.every(function (c) { return matrixValue(c, e.os, b) === true; });
    });
    var can = joinAnd(caps.map(function (c) { return CAPS[c].can; }).filter(Boolean));
    /* The table says the current version of this browser can do it, but the live test says no: this copy is
       out of date (or the feature is switched off). Say so; browsers on the same engine would fail the same way. */
    var curName = BROWSER_NAMES[e.browser];
    var outdated = !!curName && caps.every(function (c) { return matrixValue(c, e.os, e.browser) === true; });
    if (outdated) {
      var upd = e.os === 'ios' ? e.osName : curName;
      out.push({ browser: null, update: true, name: upd, reason: 'The current version of ' + curName + ' can ' + (can || 'run ' + def.name.toLowerCase()) + '. Update ' + upd + ' to the latest version, then try again.' });
      names = names.filter(function (b) { return engineOf(e.os, b) !== e.engine; });
    }
    if (e.os === 'ios') {
      /* Every iOS browser uses Safari's engine, so another browser cannot help; say where it does work. */
      var desk = ['windows', 'mac', 'chromeos'].some(function (os) {
        return (BROWSERS_BY_OS[os] || []).some(function (b) { return caps.every(function (c) { return matrixValue(c, os, b) === true; }); });
      });
      if (desk) out.push({ browser: null, device: 'computer', reason: 'On ' + e.device + ' every browser uses the same engine, so switching browsers will not help. ' + def.name + ' works on a computer.' });
      return out;
    }
    names.forEach(function (b) {
      out.push({ browser: BROWSER_NAMES[b], reason: BROWSER_NAMES[b] + ' on ' + e.deviceWord + ' can ' + (can || 'run ' + def.name.toLowerCase()) + '.' });
    });
    return out;
  }

  function check(id) {
    var def = defs[id];
    var e = env();
    if (!def) return { id: id, name: id, status: 'unknown', reasons: ['This feature has not described what it needs yet.'], missing: [], unknown: [], suggest: [], canForce: true, forced: forced(id), label: LABELS.unknown };
    var reasons = [];
    var missing = [], unknown = [], softMissing = [], wantMissing = [];
    def.needs.forEach(function (cap) {
      var v = has(cap);
      if (v === false) { missing.push(cap); if (!CAPS[cap] || CAPS[cap].inferred) softMissing.push(cap); }
      else if (v !== true) unknown.push(cap);
    });
    def.wants.forEach(function (cap) { if (has(cap) === false) wantMissing.push(cap); });
    var status, tone = null;
    if (missing.length) {
      status = 'unsupported';
      missing.forEach(function (c) { reasons.push(capLack(c)); });
    } else if (unknown.length) {
      status = 'unknown';
      unknown.forEach(function (c) { reasons.push(capUnknown(c)); });
    } else status = 'ok';
    if (status !== 'unsupported' && wantMissing.length) {
      if (status === 'ok') { status = 'limited'; tone = 'limits'; }
      wantMissing.forEach(function (c) { reasons.push(capLack(c)); });
    }
    /* Memory and processor: estimates only, so at worst "limited" or "unknown", never a block. */
    if (def.memoryMB && status !== 'unsupported') {
      var gb = memoryGB();
      var word = cap1(e.deviceWord);
      if (gb != null) {
        if (gb < 8 && def.memoryMB > gb * 1024 * 0.25) {
          if (status === 'ok') status = 'limited';
          tone = 'slow';
          reasons.push(word + ' may not have enough memory for ' + lowerName(def) + ' (needs ' + sizeText(def.memoryMB) + ').');
        }
      } else if (e.mobile && def.memoryMB >= 600) {
        if (status === 'ok') status = 'unknown';
        reasons.push(capUnknown('device-memory-4gb') + ' ' + cap1(lowerName(def)) + ' needs ' + sizeText(def.memoryMB) + ', so older devices may struggle.');
      }
      var cores = cpuCores();
      if (cores != null && cores < 4 && def.memoryMB >= 300) {
        if (status === 'ok') status = 'limited';
        tone = 'slow';
        reasons.push(capLack('cpu-cores'));
      }
    }
    var past = history(id);
    if (past && past.ok && !missing.length) {
      /* It has worked here: that beats any estimate (but not an API that is missing now). */
      status = 'ok';
      tone = null;
      reasons = ['This has worked on ' + e.deviceWord + ' before.'];
    } else if (past && past.fail) {
      if (status === 'ok') status = 'limited';
      tone = 'failed';
      reasons.unshift('This did not work last time on ' + e.deviceWord + '.');
    }
    if (e.inApp && status !== 'ok') reasons.push(capLack('in-app-browser'));
    var degradedPath = !!def.degraded;
    var canForce = status !== 'unsupported' || degradedPath || (softMissing.length === missing.length);
    if (status === 'unsupported' && degradedPath) reasons.push(def.degraded);
    var sug = status === 'ok' ? [] : suggestFor(def, missing.length ? missing : wantMissing);
    var label = status === 'ok' ? LABELS.ok : status === 'unsupported' ? LABELS.unsupported : status === 'unknown' ? LABELS.unknown :
      tone === 'failed' ? LABELS.failed : tone === 'slow' ? LABELS.slow : LABELS.limited;
    return { id: id, name: def.name, group: def.group, status: status, reasons: dedupe(reasons), missing: missing.length ? missing : wantMissing, unknown: unknown, suggest: sug, canForce: canForce, forced: forced(id), label: label, def: def };
  }
  function lowerName(def) { return /^[A-Z][a-z]/.test(def.name) && !/^(PDF|AI|QR|JPG|UUID)/.test(def.name) ? 'the ' + def.name.charAt(0).toLowerCase() + def.name.slice(1) : def.name; }
  function dedupe(a) { var seen = {}; return a.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }); }
  var LABELS = { ok: 'Runs well here', limited: 'Works, with limits', slow: 'May be slow here', unknown: 'Might work here', unsupported: 'Not available in this browser', failed: 'Did not work last time' };

  function capsOf(id) { var d = defs[id]; return d ? d.needs.concat(d.wants) : []; }
  /* No async probe of this feature is still to run. */
  function settled(id) { return capsOf(id).every(function (c) { return own(overrides, c) || !CAPS[c] || !CAPS[c].async || probed[c]; }); }
  function checkAsync(id) { return probeAll(capsOf(id)).then(function () { return check(id); }); }
  function checkAll() { return features().map(function (d) { return check(d.id); }); }

  /* ---------- Gate ---------- */
  var openGate = null;
  function gate(id, opts) {
    opts = opts || {};
    var run = typeof opts.run === 'function' ? opts.run : function () {};
    function go() {
      return new Promise(function (resolve) { resolve(run()); }).then(null, function (err) { if (isDeviceFailure(err)) reportFailure(id, err); throw err; });
    }
    var fallback = opts.fallback && typeof opts.fallback.run === 'function' ? opts.fallback : null;
    /* Already known to be fine: run in this same task, so APIs that need the tap (clipboard, eyedropper, share)
       still see the user gesture. */
    if (settled(id)) {
      var now = check(id);
      if (now.status === 'ok' || (now.canForce && now.forced)) return go();
    }
    return checkAsync(id).then(function (r) {
      if (r.status === 'ok' || (r.canForce && r.forced)) return go();
      return new Promise(function (resolve, reject) {
        showGate(r, opts, function (choice, device) {
          if (choice === 'run') {
            if (r.canForce) rememberForce(id, device);
            go().then(resolve, reject);
          } else if (choice === 'fallback' && fallback) {
            new Promise(function (res) { res(fallback.run(r)); }).then(resolve, reject);
          } else {
            if (typeof opts.onCancel === 'function') { try { opts.onCancel(r); } catch (e) { console.warn(e); } }
            resolve(undefined);
          }
        });
      });
    });
  }
  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.6"/></svg>',
    limited: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.2M12 16.2v.3"/></svg>',
    unknown: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 16.6v.3"/></svg>',
    unsupported: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    browser: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/></svg>',
    device: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19.5h20"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/></svg>'
  };
  var HEAD = {
    limited: 'This works here, with limits',
    unknown: 'This may not work here',
    unsupported: 'Not available in this browser'
  };
  function showGate(r, opts, done) {
    if (openGate && openGate.open) { try { openGate.close(); } catch (e) {} }
    var title = opts.title || r.name;
    var fb = opts.fallback && typeof opts.fallback.run === 'function' && opts.fallback.label ? String(opts.fallback.label).slice(0, 60) : '';
    /* The feature's own way round (e.g. "Download instead") is the safest choice when it cannot run here. */
    var fbPrimary = !!fb && (r.status === 'unsupported' || !r.canForce);
    var fbBtn = fb ? '<button type="button" class="lp-btn' + (fbPrimary ? ' lp-primary' : '') + '" data-ls-fallback>' + esc(fb) + '</button>' : '';
    var sub = r.label === LABELS.failed ? 'It did not work last time on ' + env().deviceWord + '.' : r.label === LABELS.slow ? 'It may be slow on ' + env().deviceWord + '.' : HEAD[r.status] || '';
    var primaryRuns = r.status === 'limited' || (r.status === 'unknown' && r.canForce);
    var runLabel = r.status === 'limited' && r.label !== LABELS.failed ? 'Continue' : 'Try anyway';
    var sug = r.suggest.map(function (s) {
      return '<li>' + (s.update ? ICON.refresh : s.browser ? ICON.browser : ICON.device) + '<div><b>' + esc(s.update ? 'Update ' + s.name : s.browser ? 'Works in ' + s.browser : 'Works on a computer') + '</b><small>' + esc(s.reason) + '</small></div></li>';
    }).join('');
    var d = h('<dialog class="lp-sheet ls-gate" aria-labelledby="ls-gate-h"><div class="lp-sheet-in" tabindex="-1"></div></dialog>');
    d.firstChild.innerHTML =
      '<header class="lp-head"><div><h2 id="ls-gate-h">' + esc(title) + '</h2><p class="ls-status ls-' + r.status + '">' + ICON[r.status] + '<span>' + esc(sub) + '</span></p></div><button type="button" class="lp-x" data-ls-close aria-label="Close">' + ICON.close + '</button></header>' +
      '<div class="ls-gate-body">' +
        '<ul class="ls-reasons">' + r.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        (sug ? '<ul class="ls-suggest">' + sug + '</ul><button type="button" class="lp-btn lp-btn-sm ls-copylink" data-ls-copylink>' + ICON.copy + 'Copy link to open it there</button>' : '') +
        (r.canForce && r.status !== 'limited' ? '<p class="ls-force-note">' + (r.status === 'unsupported' ? 'You can still try. If it does not work, nothing is lost.' : 'You can try it. If it does not work, nothing is lost and we will remember.') + '</p>' : '') +
        (r.canForce ? '<label class="ls-remember"><input type="checkbox" data-ls-never> <span>Don’t ask again on this device</span></label>' : '') +
      '</div>' +
      '<div class="lp-actions">' +
        (fbPrimary ?
          (r.canForce ? '<button type="button" class="lp-btn" data-ls-run>Try anyway</button>' : '') + '<button type="button" class="lp-btn" data-ls-cancel>Not now</button>' + fbBtn :
        r.canForce ? (primaryRuns ?
          '<button type="button" class="lp-btn" data-ls-cancel>Not now</button>' + fbBtn + '<button type="button" class="lp-btn lp-primary" data-ls-run>' + runLabel + '</button>' :
          '<button type="button" class="lp-btn" data-ls-run>Try anyway</button>' + fbBtn + '<button type="button" class="lp-btn lp-primary" data-ls-cancel>Not now</button>') :
          '<button type="button" class="lp-btn lp-primary" data-ls-cancel>OK</button>') +
      '</div>';
    document.body.appendChild(d);
    openGate = d;
    var choice = 'cancel';
    d.addEventListener('click', function (ev) {
      if (ev.target === d) { d.close(); return; }
      var t = ev.target.closest && ev.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-ls-close') || t.hasAttribute('data-ls-cancel')) d.close();
      else if (t.hasAttribute('data-ls-run')) { choice = 'run'; d.close(); }
      else if (t.hasAttribute('data-ls-fallback')) { choice = 'fallback'; d.close(); }
      else if (t.hasAttribute('data-ls-copylink')) copyText(location.href.split('#')[0], 'Link copied. Paste it into the other browser.');
    });
    d.addEventListener('close', function () {
      var never = d.querySelector('[data-ls-never]');
      if (openGate === d) openGate = null;
      setTimeout(function () { d.remove(); }, 0);
      done(choice, !!(never && never.checked));
    });
    if (typeof d.showModal === 'function') { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } } else d.setAttribute('open', '');
    var focus = d.querySelector('.lp-primary');
    if (focus) focus.focus();
    return d;
  }
  function copyText(text, msg) {
    var p;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') p = navigator.clipboard.writeText(text);
    else p = Promise.reject(new Error('no clipboard'));
    return p.then(function () { say(msg || 'Copied'); return true; }, function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      (document.querySelector('dialog[open]') || document.body).appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      say(ok ? (msg || 'Copied') : 'Could not copy. Select the text and copy it yourself.');
      return ok;
    });
  }
  function say(msg) {
    var host = document.querySelector('dialog[open]');
    if (!host && window.IT && IT.say) { IT.say(msg, 3200); return; }
    var el = (host || document.body).querySelector('.ls-toast');
    if (!el) { el = h('<div class="ls-toast" role="status" aria-live="polite"></div>'); (host || document.body).appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  /* ---------- Badges and inline states ---------- */
  function badge(id) {
    var r = check(id);
    var el = h('<span class="ls-badge ls-' + r.status + '" data-le-badge-for="' + esc(id) + '">' + ICON[r.status] + '<span>' + esc(r.label) + '</span></span>');
    el.title = r.reasons.join(' ');
    return el;
  }
  var describeSeq = 0;
  function annotate(rootEl) {
    var scope = rootEl && rootEl.querySelectorAll ? rootEl : document;
    var els = [].slice.call(scope.querySelectorAll('[data-le-feature]'));
    if (scope.getAttribute && scope.getAttribute('data-le-feature')) els.unshift(scope);
    els.forEach(function (el) {
      var id = el.getAttribute('data-le-feature');
      var r = check(id);
      el.setAttribute('data-le-support', r.status);
      var dId = el.getAttribute('data-le-support-desc');
      var desc = dId && document.getElementById(dId);
      if (!desc) {
        dId = 'ls-desc-' + (++describeSeq);
        desc = h('<span class="ls-sr" id="' + dId + '"></span>');
        (el.parentNode || document.body).insertBefore(desc, el.nextSibling);
        el.setAttribute('data-le-support-desc', dId);
        var by = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        by.push(dId);
        el.setAttribute('aria-describedby', by.join(' '));
      }
      desc.textContent = r.status === 'ok' ? '' : r.label + '. ' + r.reasons.join(' ');
      if (el.hasAttribute('data-le-badge')) {
        var old = el.querySelector('.ls-badge');
        if (old) old.remove();
        el.appendChild(badge(id));
      }
      if (!el._lsBound) {
        el._lsBound = true;
        el.addEventListener('click', interceptClick, true);
      }
    });
    return els.length;
  }
  /* An action that is not available stays visible and explains itself on tap; "Try anyway" passes the tap on. */
  function interceptClick(ev) {
    var el = ev.currentTarget;
    if (el.getAttribute('data-le-gate') === 'off' || el._lsPass) return;
    var id = el.getAttribute('data-le-feature');
    var r = check(id);
    if (r.status !== 'unsupported' || (r.canForce && r.forced)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    showGate(r, {}, function (choice, device) {
      if (choice !== 'run') return;
      rememberForce(id, device);
      el._lsPass = true;
      try { el.click(); } finally { el._lsPass = false; }
    });
  }
  var annotateTimer = 0;
  function scheduleAnnotate() {
    if (annotateTimer || !document.body) return;
    annotateTimer = setTimeout(function () { annotateTimer = 0; if (document.querySelector('[data-le-feature]')) annotate(document); }, 60);
  }

  /* ---------- Report (the /device-check/ page and the studio sheet) ---------- */
  function storageInfo() {
    if (!has('storage-estimate')) return Promise.resolve(null);
    var est;
    try { est = navigator.storage.estimate(); } catch (e) { return Promise.resolve(null); }
    return withTimeout(est, 2000).then(function (e) { return e && e.quota ? { quota: e.quota, usage: e.usage || 0 } : null; });
  }
  function fmtBytes(n) {
    if (!(n >= 0)) return '';
    if (n >= 1e9) return (Math.round(n / 1e8) / 10) + ' GB';
    if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
    return Math.max(1, Math.round(n / 1e3)) + ' KB';
  }
  function deviceSummary(st) {
    var e = env();
    var gb = memoryGB(), cores = cpuCores();
    var installed = has('standalone') || !!(window.LEPwa && LEPwa.isInstalled && safeCall(LEPwa.isInstalled));
    var rows = [
      ['Browser', (e.inApp ? 'An app’s built-in browser' : (BROWSER_NAMES[e.browser] || 'Unknown browser') + (e.version ? ' ' + e.version : '')) + ' on ' + e.osName + (e.osVersion ? ' ' + e.osVersion : '')],
      ['Memory', gb == null ? 'Not reported by this browser' : 'About ' + gb + ' GB' + (gb >= 8 ? ' or more' : '')],
      ['Processor', cores == null ? 'Not reported by this browser' : cores + ' cores'],
      ['Storage', st ? 'About ' + fmtBytes(Math.max(0, st.quota - st.usage)) + ' free (' + fmtBytes(st.usage) + ' used)' : 'Not reported by this browser'],
      ['Installed', installed ? 'Yes' : 'No'],
      ['Screen', (has('touch') ? 'Touch' : 'No touch') + (has('pointer-fine') ? ', mouse or trackpad' : '')],
      ['Largest image', 'About ' + Math.floor(maxCanvas().area / 1e6) + ' megapixels']
    ];
    return rows;
  }
  function safeCall(fn) { try { return fn(); } catch (e) { return null; } }
  function grouped(rs) {
    var by = {};
    rs.forEach(function (r) { (by[r.group] = by[r.group] || []).push(r); });
    var names = GROUPS.filter(function (g) { return by[g]; }).concat(Object.keys(by).filter(function (g) { return GROUPS.indexOf(g) < 0; }).sort());
    return names.map(function (g) { return { name: g, items: by[g] }; });
  }
  /* "Works better in": for each other browser on this OS, which features it would unlock. */
  function betterIn(rs) {
    var e = env();
    var by = {}, desk = [];
    rs.forEach(function (r) {
      if (r.status === 'ok') return;
      r.suggest.forEach(function (s) {
        if (s.browser) (by[s.browser] = by[s.browser] || []).push(r.name);
        else if (s.device === 'computer') desk.push(r.name);
      });
    });
    var out = Object.keys(by).map(function (b) { return { browser: b, unlocks: by[b] }; }).sort(function (a, b) { return b.unlocks.length - a.unlocks.length; });
    if (desk.length) out.push({ browser: null, device: 'computer', unlocks: desk, note: 'On ' + e.device + ' every browser uses the same engine, so switching browsers will not help. These work on a computer.' });
    return out;
  }
  function counts(rs) {
    var c = { ok: 0, limited: 0, unknown: 0, unsupported: 0 };
    rs.forEach(function (r) { c[r.status]++; });
    return c;
  }
  function reportText() {
    return Promise.all([probeAll(), storageInfo()]).then(function (x) {
      var rs = checkAll();
      var lines = ['LocalEditor device check', 'Date: ' + new Date().toISOString().slice(0, 10), 'Address: ' + location.origin + location.pathname, ''];
      deviceSummary(x[1]).forEach(function (r) { lines.push(r[0] + ': ' + r[1]); });
      var c = counts(rs);
      lines.push('', 'Summary: ' + c.ok + ' run well, ' + c.limited + ' with limits, ' + c.unknown + ' uncertain, ' + c.unsupported + ' not available');
      grouped(rs).forEach(function (g) {
        lines.push('', g.name);
        g.items.forEach(function (r) {
          lines.push('  [' + r.status + '] ' + r.name + (r.forced ? ' (tried anyway: ' + r.forced + ')' : ''));
          r.reasons.forEach(function (s) { lines.push('      ' + s); });
          if (r.missing.length) lines.push('      missing: ' + r.missing.join(', '));
          if (r.unknown.length) lines.push('      not reported: ' + r.unknown.join(', '));
        });
      });
      var better = betterIn(rs);
      if (better.length) {
        lines.push('', 'Works better in');
        better.forEach(function (b) { lines.push('  ' + (b.browser || 'A computer') + ': ' + b.unlocks.join(', ')); });
      }
      var caps = Object.keys(CAPS).map(function (k) { var v = has(k); return k + '=' + (v === true ? 'yes' : v === false ? 'no' : '?'); });
      lines.push('', 'Capabilities', '  ' + caps.join(' '), '', 'User agent: ' + (navigator.userAgent || ''));
      return lines.join('\n');
    });
  }
  function rowHTML(r) {
    var d = r.def || {};
    var meta = [];
    if (d.downloadMB) meta.push('Downloads ' + sizeText(d.downloadMB) + ' the first time');
    if (d.memoryMB >= 300) meta.push('Uses ' + sizeText(d.memoryMB) + ' of memory');
    var reasons = r.status === 'ok' ? (r.reasons.length ? r.reasons : []) : r.reasons;
    /* Short form here; the full sentence is in "Works better in" and in the gate. */
    var named = r.suggest.filter(function (s) { return s.browser; }).map(function (s) { return s.browser; });
    var upd = r.suggest.filter(function (s) { return s.update; })[0];
    var comp = r.suggest.some(function (s) { return s.device === 'computer'; });
    var sugText = (upd ? 'Update ' + upd.name + ' to the latest version.' : '') +
      (named.length ? (upd ? ' Also works in ' : 'Works in ') + joinAnd(named) + ' on ' + env().deviceWord + '.' : comp ? (upd ? ' Also works on a computer.' : 'Works on a computer.') : '');
    var sug = sugText ? '<p class="ls-row-sug">' + esc(sugText) + '</p>' : '';
    var name = d.url && !/^labs\//.test(d.url) ? '<a href="' + esc(BASE + d.url) + '">' + esc(r.name) + '</a>' : esc(r.name);
    return '<li class="ls-row ls-' + r.status + '" data-feature="' + esc(r.id) + '">' +
      '<span class="ls-ic">' + ICON[r.status] + '</span>' +
      '<div class="ls-row-main"><div class="ls-row-top"><b>' + name + '</b><span class="ls-pill ls-' + r.status + '">' + esc(r.label) + '</span></div>' +
      (reasons.length ? '<ul class="ls-row-why">' + reasons.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '') +
      sug +
      ((d.note || meta.length) ? '<p class="ls-row-note">' + esc([d.note].concat(meta).filter(Boolean).join(' · ')) + '</p>' : '') +
      '</div></li>';
  }
  function renderReport(host, opts) {
    opts = opts || {};
    if (!host) return Promise.resolve(null);
    host.classList.add('ls-report');
    host.setAttribute('aria-busy', 'true');
    if (!host.firstElementChild) host.innerHTML = '<p class="ls-loading">Checking this device…</p>';
    return Promise.all([probeAll(), storageInfo()]).then(function (x) {
      var rs = checkAll();
      var c = counts(rs);
      var better = betterIn(rs);
      var e = env();
      var summary = deviceSummary(x[1]);
      host.innerHTML =
        '<section class="ls-card ls-device" aria-labelledby="ls-dev-h">' +
          '<h2 id="ls-dev-h">' + (opts.compact ? 'This device' : 'This device and browser') + '</h2>' +
          '<dl class="ls-dl">' + summary.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
          '<p class="ls-counts"><span class="ls-ok">' + ICON.ok + c.ok + ' run well</span>' +
            (c.limited ? '<span class="ls-limited">' + ICON.limited + c.limited + ' with limits</span>' : '') +
            (c.unknown ? '<span class="ls-unknown">' + ICON.unknown + c.unknown + ' uncertain</span>' : '') +
            (c.unsupported ? '<span class="ls-unsupported">' + ICON.unsupported + c.unsupported + ' not available</span>' : '') + '</p>' +
          (e.inApp ? '<p class="ls-inapp">' + esc(capLack('in-app-browser')) + ' Open this page in ' + (e.os === 'ios' ? 'Safari' : e.os === 'android' ? 'Chrome' : 'your browser') + ' for the full app.</p>' : '') +
        '</section>' +
        (better.length ? '<section class="ls-card ls-better" aria-labelledby="ls-better-h"><h2 id="ls-better-h">Works better in</h2><ul>' + better.map(function (b) {
          return '<li>' + (b.browser ? ICON.browser : ICON.device) + '<div><b>' + esc(b.browser ? b.browser + ' on ' + e.deviceWord : 'A computer') + '</b>' +
            (b.note ? '<small>' + esc(b.note) + '</small>' : '') + '<small>Also unlocks: ' + esc(joinAnd(b.unlocks)) + '.</small></div></li>';
        }).join('') + '</ul><p class="ls-fine">Suggestions only name browsers you can install on ' + esc(e.osName) + '. Your designs stay in this browser; move them with a backup from the storage manager.</p></section>' : '') +
        grouped(rs).map(function (g, i) {
          return '<section class="ls-group" aria-labelledby="ls-g-' + i + '"><h2 id="ls-g-' + i + '">' + esc(g.name) + '</h2><ul class="ls-rows">' + g.items.map(rowHTML).join('') + '</ul></section>';
        }).join('') +
        '<section class="ls-actions-card"><div class="ls-actions">' +
          '<button type="button" class="btn ' + (opts.compact ? '' : 'btn-gold') + ' ls-copy" data-ls-copy>' + ICON.copy + '<span>Copy this report</span></button>' +
          '<button type="button" class="btn btn-ghost" data-ls-recheck>' + ICON.refresh + '<span>Check again</span></button>' +
          (opts.compact ? '<a class="btn btn-ghost" href="' + esc(BASE + 'device-check/') + '" target="_blank" rel="noopener">Open the full page</a>' : '') +
        '</div><p class="ls-fine">The report is plain text for support. It names your browser and the features above; it holds no files and nothing is sent anywhere unless you paste it.</p></section>';
      host.removeAttribute('aria-busy');
      host.querySelector('[data-ls-copy]').onclick = function () { reportText().then(function (t) { copyText(t, 'Report copied'); }); };
      host.querySelector('[data-ls-recheck]').onclick = function () {
        forget();
        results = {}; probed = {}; maxCanvasCache = null; envCache = null;
        renderReport(host, opts).then(function () { say('Checked again. Remembered choices were cleared.'); });
      };
      return { results: rs, counts: c, better: better };
    });
  }
  /* A sheet with the same report, for the studio's settings. */
  function open() {
    var d = h('<dialog class="lp-sheet ls-sheet" aria-labelledby="ls-sheet-h"><div class="lp-sheet-in" tabindex="-1"></div></dialog>');
    d.firstChild.innerHTML = '<header class="lp-head"><div><h2 id="ls-sheet-h">What works on this device</h2><p>Checked here, in this browser. Nothing is sent anywhere.</p></div><button type="button" class="lp-x" data-ls-close aria-label="Close">' + ICON.close + '</button></header><div class="ls-sheet-body"></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (ev) { if (ev.target === d || (ev.target.closest && ev.target.closest('[data-ls-close]'))) d.close(); });
    d.addEventListener('close', function () { setTimeout(function () { d.remove(); }, 0); });
    if (typeof d.showModal === 'function') { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } } else d.setAttribute('open', '');
    renderReport(d.querySelector('.ls-sheet-body'), { compact: true });
    return d;
  }
  /* One row in the studio's settings panel (le-studio-panels.js calls this). */
  function studioSettings(c, body) {
    var s = c.ui.section('This device');
    var b = s.querySelector('.sx-sec-body') || s;
    var row = h('<button type="button" class="btn btn-ghost btn-sm ls-settings-row"><span>What works on this device</span></button>');
    row.onclick = function () { open(); };
    b.appendChild(row);
    body.appendChild(s);
    return s;
  }

  /* ---------- Footer link and the page itself ---------- */
  function footerLink() {
    var f = document.querySelector('.site-footer');
    if (!f || f.querySelector('[data-ls-footer]') || /\/device-check\/?$/.test(location.pathname)) return;
    var spans = f.querySelectorAll('span');
    var host = spans[spans.length - 1];
    if (!host || !host.querySelector('a')) return;
    host.appendChild(document.createTextNode(' · '));
    var a = h('<a data-ls-footer href="' + esc(BASE + 'device-check/') + '">What works here</a>');
    host.appendChild(a);
  }
  function bootPage() {
    var host = document.querySelector('[data-le-device-check]');
    if (host) renderReport(host);
  }

  /* ---------- Boot ---------- */
  var ready = false;
  BUILTIN.forEach(function (d) { define(d, true); });
  var queue = window.LE_SUPPORT_DEFS = Array.isArray(window.LE_SUPPORT_DEFS) ? window.LE_SUPPORT_DEFS : [];
  queue.forEach(function (d) { define(d); });
  queue.push = function () {
    for (var i = 0; i < arguments.length; i++) define(arguments[i]);
    return Array.prototype.push.apply(queue, arguments);
  };
  ready = true;
  /* Cheap probes run now; costly ones (graphics adapter, video codecs, storage round trips) wait for probe(). */
  Object.keys(CAPS).forEach(function (k) { if (!CAPS[k].lazy && !CAPS[k].async) has(k); });
  window.addEventListener('online', function () { delete results.online; emit('online'); });
  window.addEventListener('offline', function () { delete results.online; emit('online'); });
  window.addEventListener('le-pwa-ready', function () { envCache = null; emit('platform'); });

  LE.support = {
    version: 1,
    /* capabilities */
    has: has, probe: probe, probeAll: probeAll, caps: function () { return Object.keys(CAPS); },
    capInfo: function (cap) { var c = CAPS[cap]; return c ? { id: cap, kind: c.kind, inferred: !!c.inferred, async: !!c.async, can: c.can, lack: typeof c.lack === 'function' ? c.lack() : c.lack } : null; },
    why: function (cap) { has(cap); return why[cap] || null; },
    maxCanvas: maxCanvas, memoryGB: memoryGB, cpuCores: cpuCores, env: env,
    /* features */
    define: function (d) { return define(d); }, features: features, get: function (id) { return defs[id] || null; },
    /* verdicts */
    check: check, checkAsync: checkAsync, checkAll: checkAll, gate: gate,
    reportFailure: reportFailure, reportSuccess: reportSuccess, history: history, forget: forget,
    /* UI */
    badge: badge, annotate: annotate, open: open, renderReport: renderReport, reportText: reportText, studioSettings: studioSettings,
    /* data */
    matrix: SUPPORT_MATRIX, matrixNotes: MATRIX_NOTES, browsersFor: function (os) { return (BROWSERS_BY_OS[os] || []).map(function (b) { return BROWSER_NAMES[b]; }); },
    /* tests and support staff: pin a capability's answer (true / false / null); pass undefined to clear. */
    override: function (cap, v) { if (v === undefined) delete overrides[cap]; else overrides[cap] = v === true || v === false ? v : null; emit('override'); },
    on: function (fn) { bus.push(fn); return function () { bus = bus.filter(function (f) { return f !== fn; }); }; }
  };

  function domReady() { footerLink(); bootPage(); scheduleAnnotate(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', domReady); else domReady();
  if (window.MutationObserver) {
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType === 1 && (n.hasAttribute('data-le-feature') ? !n.hasAttribute('data-le-support') : n.querySelector && n.querySelector('[data-le-feature]:not([data-le-support])'))) { scheduleAnnotate(); return; }
        }
      }
    });
    var start = function () { if (document.body) mo.observe(document.body, { childList: true, subtree: true }); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
  try { window.dispatchEvent(new CustomEvent('le-support-ready')); } catch (e) {}
})();
