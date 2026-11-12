/* LocalEditor converters. Imported files are data: sanitized, never executed. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var PX = 96 / 72;
  var MAX_PAGES = 120;
  var MAX_XML = 6000000;
  var MAX_ZIP_ENTRY = 12000000;
  var MAX_ZIP_TOTAL = 80000000;
  var MAX_ZIP_FILES = 2000;
  var loads = {};
  var parseCache = new Map();
  var layoutCache = new Map();
  var pdfCache = new Map();

  var PAGE = {
    A3: [841.89, 1190.55],
    A4: [595.28, 841.89],
    A5: [419.53, 595.28],
    Letter: [612, 792],
    Legal: [612, 1008],
    Tabloid: [792, 1224]
  };

  var MARGIN_MM = { none: 0, small: 10, normal: 16, wide: 25.4 };

  var CODE = {
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TSX', jsx: 'JSX',
    py: 'Python', java: 'Java', c: 'C', h: 'C header', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++ header',
    cs: 'C#', go: 'Go', rb: 'Ruby', php: 'PHP', xml: 'XML', xsl: 'XML', yaml: 'YAML', yml: 'YAML',
    css: 'CSS', scss: 'SCSS', less: 'Less', sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
    rs: 'Rust', swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', lua: 'Lua', pl: 'Perl', pm: 'Perl',
    r: 'R', toml: 'TOML', ini: 'INI', cfg: 'Config', vue: 'Vue', svelte: 'Svelte', dart: 'Dart',
    hs: 'Haskell', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', clj: 'Clojure', fs: 'F#', fsx: 'F#',
    ml: 'OCaml', vb: 'Visual Basic', bat: 'Batch', cmd: 'Batch', gradle: 'Gradle', properties: 'Properties',
    conf: 'Config'
  };

  function asset(file) {
    var root = '';
    try { root = document.documentElement.getAttribute('data-root') || ''; } catch (e) { root = ''; }
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root + 'assets/vendor/' + file;
  }

  function loadScript(src) {
    var lazy = global.LE && typeof global.LE.lazy === 'function' ? global.LE.lazy : null;
    if (lazy && lazy !== loadScript) return Promise.resolve(lazy(src));
    if (loads[src]) return loads[src];
    loads[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        loads[src] = null;
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(s);
    });
    return loads[src];
  }

  function need(src, ready) {
    if (ready()) return Promise.resolve();
    return loadScript(src).then(function () {
      if (!ready()) throw new Error('Library failed to start');
    });
  }

  function loadPdfLib() {
    return need(asset('pdf-lib.min.js'), function () { return global.PDFLib && global.PDFLib.PDFDocument; });
  }
  function loadPdfJs() {
    return need(asset('pdf.min.js'), function () { return global.pdfjsLib && global.pdfjsLib.getDocument; }).then(function () {
      if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.js');
      }
    });
  }
  function loadMammoth() {
    return need(asset('mammoth.browser.min.js'), function () { return global.mammoth && global.mammoth.convertToHtml; });
  }
  function loadXlsx() {
    return need(asset('xlsx.full.min.js'), function () { return global.XLSX && global.XLSX.read; });
  }
  function loadZip() {
    return need(asset('jszip.min.js'), function () { return global.JSZip; });
  }
  function loadPurify() {
    return need(asset('purify.min.js'), function () { return global.DOMPurify && global.DOMPurify.sanitize; });
  }
  function loadMarked() {
    return need(asset('marked.umd.js'), function () { return global.marked; });
  }
  function loadH2C() {
    return need(asset('html2canvas.min.js'), function () { return global.html2canvas; });
  }
  function loadFontkit() {
    if (global.fontkit) return Promise.resolve(global.fontkit);
    if (!(global.LE && global.LE.fonts && typeof global.LE.fonts.bytes === 'function')) return Promise.resolve(null);
    return loadScript(asset('fontkit.umd.min.js')).then(function () {
      return global.fontkit || null;
    }).catch(function () { return null; });
  }

  function mmPt(mm) { return (Number(mm) || 0) * 72 / 25.4; }
  function extOf(name) {
    var base = String(name || '').replace(/^.*[\\/]/, '');
    var m = /\.([a-z0-9]+)$/i.exec(base);
    return m ? m[1].toLowerCase() : '';
  }
  function baseName(name) {
    var base = String(name || 'document').replace(/^.*[\\/]/, '');
    return base || 'document';
  }
  function hashStr(s) {
    var h = 2166136261;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function fileKey(file) {
    if (typeof file === 'string') return 's:' + hashStr(file);
    if (file instanceof ArrayBuffer) return 'ab:' + file.byteLength + ':' + hashStr(new Uint8Array(file).slice(0, 32).join(','));
    if (file && file.bytes && file.name) return 'b:' + file.name + ':' + (file.bytes.byteLength || file.bytes.length || 0);
    return 'f:' + (file && file.name || '') + ':' + (file && file.size || 0) + ':' + (file && file.lastModified || 0) + ':' + (file && file.type || '');
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uniq(list) {
    var out = [], seen = {};
    (list || []).forEach(function (w) {
      w = String(w || '').trim();
      if (!w || seen[w]) return;
      seen[w] = 1;
      out.push(w);
    });
    return out;
  }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : (d || 0); }
  function dateStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function normScale(v) {
    if (v == null || v === '') return 1;
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 1;
    if (n > 3) n = n / 100;
    if (n < 0.25) n = 0.25;
    if (n > 4) n = 4;
    return n;
  }
  function normFit(v) {
    v = String(v || 'width').toLowerCase();
    if (v === 'page' || v === 'contain' || v === 'fit') return 'page';
    if (v === 'image' || v === 'image-size' || v === 'actual' || v === 'none') return 'image';
    return 'width';
  }
  function normQuality(q) {
    if (q == null || q === '') return 0.86;
    q = Number(q);
    if (!isFinite(q)) return 0.86;
    if (q > 1) q = q / 100;
    if (q < 0.2) q = 0.2;
    if (q > 1) q = 1;
    return q;
  }
  function pdfScale() {
    try {
      if (global.LE && global.LE.perf && typeof global.LE.perf.pdfScale === 'function') {
        var n = Number(global.LE.perf.pdfScale());
        if (n > 0) return n;
      }
    } catch (e) {}
    var w = 1200;
    var coarse = false;
    try {
      w = Math.min(global.innerWidth || 1200, global.screen && global.screen.width || 1200);
      coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches && w < 900;
    } catch (e2) {}
    return coarse ? 1.5 : 2;
  }
  function chromeOf(opts) {
    opts = opts || {};
    var header = opts.header;
    var footer = opts.footer;
    if (opts.headerFooter) {
      if (header == null) header = opts.headerFooter.header;
      if (footer == null) footer = opts.headerFooter.footer;
    }
    if (opts.pageNumbers && (footer == null || footer === '' || (typeof footer === 'object' && !footer.text))) {
      footer = '{page} / {pages}';
    }
    return { header: header || '', footer: footer || '' };
  }
  function wantsChrome(opts) {
    var c = chromeOf(opts);
    return !!(c.header || c.footer);
  }
  function templateText(tpl) {
    if (tpl && typeof tpl === 'object') return String(tpl.text || '');
    return String(tpl || '');
  }
  function templateAlign(tpl, fallback) {
    if (tpl && typeof tpl === 'object' && tpl.align) return String(tpl.align);
    return fallback;
  }
  function fillTemplate(tpl, info) {
    return templateText(tpl).replace(/\{(page|pages|date|file)\}/g, function (_, k) {
      if (k === 'page') return String(info.page);
      if (k === 'pages') return String(info.pages);
      if (k === 'date') return info.date;
      return info.file;
    });
  }
  function resolvePage(opts) {
    opts = opts || {};
    var spec = opts.pageSize || 'A4';
    if (spec === 'custom') spec = opts.pageMm || opts.customPage || { w: 210, h: 297, unit: 'mm' };
    var w, h, name;
    if (typeof spec === 'string' && spec.toLowerCase() === 'image') {
      return { w: PAGE.A4[0], h: PAGE.A4[1], name: 'image', orientation: 'image', image: true };
    }
    if (typeof spec === 'object' && spec) {
      name = 'custom';
      var unit = spec.unit || 'pt';
      w = num(spec.w != null ? spec.w : spec.width, 0);
      h = num(spec.h != null ? spec.h : spec.height, 0);
      if (unit === 'mm') { w = mmPt(w); h = mmPt(h); }
      else if (unit === 'in') { w *= 72; h *= 72; }
    } else {
      name = String(spec);
      var found = null;
      var keys = Object.keys(PAGE);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === name.toLowerCase()) { found = PAGE[keys[i]]; name = keys[i]; break; }
      }
      if (!found) { found = PAGE.A4; name = 'A4'; }
      w = found[0];
      h = found[1];
    }
    if (!(w > 72)) w = PAGE.A4[0];
    if (!(h > 72)) h = PAGE.A4[1];
    var orient = String(opts.orientation || 'portrait').toLowerCase();
    if (orient !== 'landscape' && orient !== 'auto' && orient !== 'portrait') orient = 'portrait';
    if (orient === 'landscape' && h > w) { var t = w; w = h; h = t; }
    if (orient === 'portrait' && w > h) { var t2 = w; w = h; h = t2; }
    return { w: w, h: h, name: name, orientation: orient, image: false };
  }
  function asLandscape(page) {
    if (page.w >= page.h) return page;
    return { w: page.h, h: page.w, name: page.name, orientation: 'landscape', image: page.image };
  }
  function resolveMargin(opts) {
    var m = opts && opts.margin;
    if (m === 'custom') m = (opts.marginMm != null ? opts.marginMm : { top: 20, right: 20, bottom: 20, left: 20 });
    if (m == null) m = 'normal';
    var top, right, bottom, left;
    if (typeof m === 'number') top = right = bottom = left = mmPt(m);
    else if (typeof m === 'string') {
      var mm = MARGIN_MM[String(m).toLowerCase()];
      if (mm == null) mm = 16;
      top = right = bottom = left = mmPt(mm);
    } else {
      top = mmPt(m.top != null ? m.top : 16);
      right = mmPt(m.right != null ? m.right : (m.top != null ? m.top : 16));
      bottom = mmPt(m.bottom != null ? m.bottom : (m.top != null ? m.top : 16));
      left = mmPt(m.left != null ? m.left : (m.right != null ? m.right : (m.top != null ? m.top : 16)));
    }
    var bumped = false;
    if (wantsChrome(opts)) {
      var min = mmPt(8);
      if (top < min) { top = min; bumped = true; }
      if (bottom < min) { bottom = min; bumped = true; }
    }
    return { top: top, right: right, bottom: bottom, left: left, bumped: bumped };
  }
  function optKey(opts) {
    opts = opts || {};
    return JSON.stringify({
      pageSize: opts.pageSize, pageMm: opts.pageMm, customPage: opts.customPage,
      orientation: opts.orientation, margin: opts.margin, marginMm: opts.marginMm,
      scale: opts.scale, fit: opts.fit, header: opts.header, footer: opts.footer,
      headerFooter: opts.headerFooter, pageNumbers: opts.pageNumbers, sheets: opts.sheets,
      lineNumbers: opts.lineNumbers, pretty: opts.pretty, dpi: opts.dpi, imageQuality: opts.imageQuality
    });
  }

  function detect(file) {
    if (typeof file === 'string') return { kind: 'html', label: 'HTML', note: '' };
    var name = file && file.name ? String(file.name) : '';
    var base = name.replace(/^.*[\\/]/, '');
    var type = file && file.type ? String(file.type).toLowerCase() : '';
    var e = extOf(base);
    if (/^dockerfile$/i.test(base)) return { kind: 'code', label: 'Dockerfile', note: '' };
    if (/^makefile$/i.test(base)) return { kind: 'code', label: 'Makefile', note: '' };
    if (e === 'pdf' || type === 'application/pdf') return { kind: 'pdf', label: 'PDF', note: '' };
    if (e === 'docx' || type.indexOf('wordprocessingml') >= 0) return { kind: 'docx', label: 'Word document', note: '' };
    if (e === 'rtf' || type === 'application/rtf' || type === 'text/rtf') return { kind: 'rtf', label: 'RTF', note: '' };
    if (e === 'doc' || (type === 'application/msword' && e !== 'docx' && e !== 'odt' && e !== 'rtf')) {
      return { kind: 'unsupported', label: 'Legacy Word', note: 'Legacy .doc files cannot be converted here. Save the file as .docx and try again.' };
    }
    if (e === 'pptx' || e === 'pptm') return { kind: 'pptx', label: 'PowerPoint', note: e === 'pptm' ? 'Macros are ignored.' : '' };
    if (e === 'ppt' || type === 'application/vnd.ms-powerpoint') {
      return { kind: 'unsupported', label: 'Legacy PowerPoint', note: 'Legacy .ppt files cannot be converted here. Save the file as .pptx and try again.' };
    }
    if (e === 'odt') return { kind: 'odt', label: 'OpenDocument text', note: '' };
    if (e === 'xlsx' || e === 'xlsm') return { kind: 'xlsx', label: 'Excel workbook', note: '' };
    if (e === 'xls' || e === 'xlsb') return { kind: 'xlsx', label: e === 'xlsb' ? 'Excel binary workbook' : 'Excel 97-2003 workbook', note: 'Formulas are shown as cached values.' };
    if (e === 'ods') return { kind: 'xlsx', label: 'Spreadsheet', note: 'OpenDocument sheets are read as values.' };
    if (e === 'csv') return { kind: 'csv', label: 'CSV', note: '' };
    if (e === 'tsv') return { kind: 'csv', label: 'TSV', note: '' };
    if (e === 'html' || e === 'htm' || e === 'xhtml' || type === 'text/html') return { kind: 'html', label: 'HTML', note: '' };
    if (e === 'md' || e === 'markdown') return { kind: 'markdown', label: 'Markdown', note: '' };
    if (e === 'json' || type === 'application/json') return { kind: 'json', label: 'JSON', note: '' };
    if (e === 'svg' || type === 'image/svg+xml') return { kind: 'svg', label: 'SVG image', note: '' };
    if (e === 'heic' || e === 'heif' || type === 'image/heic' || type === 'image/heif') {
      return { kind: 'image', label: 'HEIC image', note: 'HEIC is used only when this browser can decode it. Otherwise export JPG or PNG.' };
    }
    if (e === 'jpg' || e === 'jpeg' || type === 'image/jpeg') return { kind: 'image', label: 'JPEG image', note: '' };
    if (e === 'png' || type === 'image/png') return { kind: 'image', label: 'PNG image', note: '' };
    if (e === 'webp' || type === 'image/webp') return { kind: 'image', label: 'WebP image', note: '' };
    if (e === 'gif' || type === 'image/gif') return { kind: 'image', label: 'GIF image', note: 'Only the first frame is used.' };
    if (e === 'bmp' || type === 'image/bmp') return { kind: 'image', label: 'BMP image', note: '' };
    if (e === 'txt' || e === 'text' || e === 'log') return { kind: 'text', label: e === 'log' ? 'Log' : 'Plain text', note: '' };
    if (e === 'epub') return { kind: 'epub', label: 'EPUB', note: '' };
    if (CODE[e]) return { kind: 'code', label: CODE[e], note: '' };
    if (type.indexOf('image/') === 0) return { kind: 'image', label: 'Image', note: '' };
    if (type.indexOf('text/') === 0) return { kind: 'text', label: 'Plain text', note: '' };
    return { kind: 'unsupported', label: 'Unsupported', note: 'This file type cannot be converted. Try PDF, Word, PowerPoint, Excel, HTML, Markdown, text, or an image.' };
  }

  function readBytes(file) {
    if (file instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(file));
    if (file instanceof Uint8Array) return Promise.resolve(file);
    if (file && file.bytes) {
      var b = file.bytes;
      if (b instanceof Uint8Array) return Promise.resolve(b);
      if (b instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(b));
    }
    if (file && typeof file.arrayBuffer === 'function') {
      return file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return Promise.reject(new Error('This file could not be read'));
  }
  function textOf(bytes) {
    var dec = new TextDecoder('utf-8', { fatal: false });
    var t = dec.decode(bytes);
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return t;
  }
  function abOf(bytes) {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  function parseXml(str) {
    return new DOMParser().parseFromString(String(str || ''), 'application/xml');
  }
  function one(el, name) {
    if (!el || !el.children) return null;
    for (var i = 0; i < el.children.length; i++) if (el.children[i].localName === name) return el.children[i];
    return null;
  }
  function kids(el, name) {
    var out = [];
    if (!el || !el.children) return out;
    for (var i = 0; i < el.children.length; i++) {
      if (!name || el.children[i].localName === name) out.push(el.children[i]);
    }
    return out;
  }
  function firstLocal(el, name) {
    if (!el) return null;
    if (el.localName === name) return el;
    var all = el.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) if (all[i].localName === name) return all[i];
    return null;
  }
function attr(el, name) {
  if (!el || !el.attributes) return '';
  for (var i = 0; i < el.attributes.length; i++) {
    if (el.attributes[i].localName === name || el.attributes[i].name === name) return el.attributes[i].value || '';
  }
  return '';
}
function relAttr(el) {
  if (!el || !el.attributes) return '';
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i];
    if (a.localName === 'id' && (a.prefix === 'r' || a.name === 'r:id' || /^rId/i.test(a.value))) return a.value || '';
  }
  return '';
}
  function joinZip(base, rel) {
    if (!rel) return '';
    if (/^[a-z]+:/i.test(rel)) return rel;
    var parts = String(base || '').split('/');
    parts.pop();
    String(rel).split('/').forEach(function (p) {
      if (p === '..') parts.pop();
      else if (p && p !== '.') parts.push(p);
    });
    return parts.join('/');
  }
  function mimeOf(name) {
    var e = extOf(name);
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'gif') return 'image/gif';
    if (e === 'webp') return 'image/webp';
    if (e === 'svg') return 'image/svg+xml';
    if (e === 'bmp') return 'image/bmp';
    return 'image/png';
  }

  function isSafeUrl(u) {
    u = String(u || '').replace(/^\s+|\s+$/g, '');
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(u) || u.charAt(0) === '#';
  }
  function decodeCssEscapes(css) {
    return String(css || '')
      .replace(/\\([0-9a-f]{1,6})\s?/gi, function (_, hex) {
        var cp = parseInt(hex, 16);
        if (!cp || cp > 0x10ffff) return '';
        try { return String.fromCodePoint(cp); } catch (e) { return ''; }
      })
      .replace(/\\([^0-9a-f\r\n])/gi, '$1');
  }
  function cleanCss(css) {
    return decodeCssEscapes(css)
      .replace(/<\/\s*/gi, '')
      .replace(/@import\b[^;]*;?/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/-moz-binding\s*:[^;]*/gi, '')
      .replace(/behavior\s*:[^;]*/gi, '')
      .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, function (_, q, u) {
        u = String(u || '').replace(/^\s+|\s+$/g, '');
        if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(u)) return 'url("' + u.replace(/"/g, '') + '")';
        return 'none';
      });
  }
  function hexColor(value) {
    var v = String(value || '').replace(/^#/, '').trim();
    if (/^[0-9a-f]{3}$/i.test(v) || /^[0-9a-f]{6}$/i.test(v) || /^[0-9a-f]{8}$/i.test(v)) return '#' + v;
    return '';
  }
  function cssFamily(value) {
    var name = String(value || '').replace(/[^A-Za-z0-9 \-]/g, ' ').replace(/\s+/g, ' ').trim();
    return name ? name.slice(0, 64) : '';
  }
  function remember(map, key, value) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > 8) map.delete(map.keys().next().value);
    return value;
  }
  function hardenZip(zip) {
    var names = Object.keys(zip.files || {});
    if (names.length > MAX_ZIP_FILES) throw new Error('Archive has too many files');
    var total = 0;
    names.forEach(function (name) {
      var entry = zip.files[name];
      if (!entry || entry.dir) return;
      var size = (entry._data && entry._data.uncompressedSize) || 0;
      total += size;
      if (entry._leWrapped) return;
      var read = entry.async.bind(entry);
      entry.async = function (type) {
        var limit = type === 'string' ? MAX_XML : MAX_ZIP_ENTRY;
        var bytes = (entry._data && entry._data.uncompressedSize) || 0;
        if (bytes > limit) return Promise.reject(new Error('Archive entry is too large'));
        return read(type);
      };
      entry._leWrapped = true;
    });
    if (total > MAX_ZIP_TOTAL) throw new Error('Archive is too large');
    return zip;
  }
  function capCanvas(w, h) {
    w = Math.max(1, Math.round(w) || 1);
    h = Math.max(1, Math.round(h) || 1);
    var edge = 8192;
    var area = 24000000;
    if (w > edge || h > edge || w * h > area) {
      var fit = Math.min(edge / w, edge / h, Math.sqrt(area / (w * h)));
      w = Math.max(1, Math.round(w * fit));
      h = Math.max(1, Math.round(h * fit));
    }
    return { w: w, h: h };
  }
  function stripRemote(html, warnings) {
    var doc = new DOMParser().parseFromString('<div id="le-root">' + html + '</div>', 'text/html');
    var root = doc.getElementById('le-root');
    var changed = false;
    var drop = { SCRIPT: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, LINK: 1, META: 1, BASE: 1, FRAME: 1, FRAMESET: 1, APPLET: 1, FOREIGNOBJECT: 1, ANIMATE: 1, SET: 1, ANIMATETRANSFORM: 1, ANIMATEMOTION: 1 };
    var nodes = [].slice.call(root.querySelectorAll('*'));
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.parentNode) continue;
      if (drop[el.tagName]) { el.parentNode.removeChild(el); changed = true; continue; }
      var attrs = [].slice.call(el.attributes || []);
      for (var a = 0; a < attrs.length; a++) {
        var nm = attrs[a].name.toLowerCase();
        var val = attrs[a].value || '';
        if (nm.indexOf('on') === 0) { el.removeAttribute(attrs[a].name); changed = true; continue; }
        if (nm === 'style') {
          var next = cleanCss(val);
          if (next !== val) {
            changed = true;
            if (next) el.setAttribute('style', next);
            else el.removeAttribute('style');
          }
          continue;
        }
        if (nm === 'src' || nm === 'href' || nm === 'poster' || nm === 'action' || nm === 'formaction' || nm.slice(-4) === 'href') {
          if (val && !isSafeUrl(val)) { el.removeAttribute(attrs[a].name); changed = true; }
        }
      }
      if ((el.tagName === 'IMG' || el.tagName === 'SOURCE' || el.tagName === 'IMAGE') && !isSafeUrl(el.getAttribute('src') || el.getAttribute('href') || '')) {
        el.parentNode.removeChild(el);
        changed = true;
      }
    }
    var styles = [].slice.call(root.querySelectorAll('style'));
    for (var s = 0; s < styles.length; s++) {
      var c = cleanCss(styles[s].textContent);
      if (c !== styles[s].textContent) { styles[s].textContent = c; changed = true; }
    }
    if (changed && warnings) warnings.push('Scripts, forms, and remote links were removed so nothing is fetched or run.');
    return root.innerHTML;
  }
  function sanitize(html, warnings) {
    return loadPurify().then(function () {
      var clean = global.DOMPurify.sanitize(String(html || ''), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'video', 'audio', 'source', 'frame', 'frameset', 'applet', 'noscript'],
        FORBID_ATTR: ['srcset', 'action', 'formaction'],
        ALLOW_DATA_ATTR: false,
        ADD_ATTR: ['style', 'colspan', 'rowspan', 'start'],
        FORCE_BODY: false
      });
      return stripRemote(String(clean), warnings);
    });
  }

  function flowCss(widthPx, scale) {
    var fs = Math.round(16 * scale * 10) / 10;
    return [
      'html,body{margin:0;padding:0;background:#fff;color:#1a1a1a;}',
      'body{width:' + widthPx + 'px;}',
      '#le-flow{position:relative;display:flex;flex-direction:column;align-items:stretch;width:' + widthPx + 'px;font:400 ' + fs + 'px/1.45 Georgia,"Times New Roman",serif;color:#1a1a1a;background:#fff;}',
      '#le-flow>*{flex:0 0 auto;max-width:100%;}',
      '#le-flow *{box-sizing:border-box;}',
      '#le-flow img{max-width:100%;height:auto;}',
      '#le-flow h1{font-size:1.7em;line-height:1.2;margin:0 0 .55em;font-weight:700;}',
      '#le-flow h2{font-size:1.38em;line-height:1.25;margin:.9em 0 .4em;font-weight:700;}',
      '#le-flow h3{font-size:1.18em;margin:.85em 0 .35em;font-weight:700;}',
      '#le-flow h4,#le-flow h5,#le-flow h6{font-size:1.05em;margin:.75em 0 .3em;font-weight:700;}',
      '#le-flow p{margin:0 0 .7em;}',
      '#le-flow ul,#le-flow ol{margin:0 0 .7em;padding-left:1.35em;}',
      '#le-flow li{margin:0 0 .22em;}',
      '#le-flow table{border-collapse:collapse;width:100%;margin:0 0 .8em;}',
      '#le-flow th,#le-flow td{border:1px solid #c8c8c8;padding:4px 6px;vertical-align:top;text-align:left;}',
      '#le-flow th{background:#f3f3f3;font-weight:700;}',
      '#le-flow pre{font-family:Consolas,ui-monospace,monospace;font-size:.86em;white-space:pre-wrap;background:#f6f6f6;padding:8px;margin:0 0 .8em;}',
      '#le-flow code{font-family:Consolas,ui-monospace,monospace;font-size:.92em;}',
      '#le-flow blockquote{margin:0 0 .8em;padding-left:.8em;border-left:3px solid #ddd;}',
      '#le-flow a{color:#1a1a1a;text-decoration:underline;}',
      '#le-flow hr{border:0;border-top:1px solid #ddd;margin:.8em 0;}',
      '#le-flow .le-chapter{margin:0;}'
    ].join('');
  }

  function docxHtml(bytes) {
    return loadMammoth().then(function () {
      var opts = {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh"
        ]
      };
      if (global.mammoth.images && global.mammoth.images.imgElement) {
        opts.convertImage = global.mammoth.images.imgElement(function (image) {
          return image.read('base64').then(function (b64) {
            return { src: 'data:' + (image.contentType || 'image/png') + ';base64,' + b64 };
          });
        });
      }
      return global.mammoth.convertToHtml({ arrayBuffer: abOf(bytes) }, opts);
    }).then(function (result) {
      var warnings = ['Word layout is approximated. Headers, footers, text boxes, and exact spacing may differ.'];
      (result.messages || []).slice(0, 6).forEach(function (m) {
        if (m && m.message) warnings.push(m.message);
      });
      warnings.push('This PDF page is a picture of the document. Use the print option when you need selectable text.');
      return sanitize(result.value || '', warnings).then(function (html) {
        return { mode: 'html', html: html, warnings: uniq(warnings) };
      });
    });
  }

  function readOdtStyles(doc) {
    var map = {};
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].localName !== 'style') continue;
      var name = attr(all[i], 'name');
      var props = one(all[i], 'text-properties');
      if (!name || !props) continue;
      var weight = attr(props, 'font-weight');
      var fs = attr(props, 'font-style');
      map[name] = { bold: weight === 'bold' || weight === '700', italic: fs === 'italic' || fs === 'oblique' };
    }
    return map;
  }
  function odtMedia(zip) {
    var names = Object.keys(zip.files);
    var jobs = names.filter(function (n) { return !zip.files[n].dir && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n); });
    return Promise.all(jobs.map(function (n) {
      return zip.files[n].async('base64').then(function (b64) {
        return { name: n, src: 'data:' + mimeOf(n) + ';base64,' + b64 };
      });
    })).then(function (list) {
      var map = {};
      list.forEach(function (item) { map[item.name] = item.src; map[item.name.split('/').pop()] = item.src; });
      return map;
    });
  }
  function odtInline(el, styles, media) {
    var html = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) { html += esc(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      var ln = n.localName;
      if (ln === 'span') {
        var st = styles[attr(n, 'style-name')] || {};
        var inner = odtInline(n, styles, media);
        if (st.bold && st.italic) html += '<strong><em>' + inner + '</em></strong>';
        else if (st.bold) html += '<strong>' + inner + '</strong>';
        else if (st.italic) html += '<em>' + inner + '</em>';
        else html += inner;
      } else if (ln === 'line-break') html += '<br>';
      else if (ln === 'tab') html += '&nbsp;&nbsp;&nbsp;&nbsp;';
      else if (ln === 's') {
        var c = parseInt(attr(n, 'c') || '1', 10);
        if (!isFinite(c) || c < 1) c = 1;
        if (c > 40) c = 40;
        html += new Array(c + 1).join('&nbsp;');
      } else if (ln === 'frame' || ln === 'image') {
        var img = ln === 'image' ? n : one(n, 'image');
        var href = img ? attr(img, 'href') : '';
        var src = media[href] || media[(href || '').split('/').pop()] || '';
        if (src) html += '<img src="' + src + '" alt="">';
      } else html += odtInline(n, styles, media);
    }
    return html;
  }
  function odtBlocks(el, styles, media) {
    var html = '';
    var list = el.children || [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var ln = n.localName;
      if (ln === 'h') {
        var level = parseInt(attr(n, 'outline-level') || '1', 10);
        if (!isFinite(level) || level < 1) level = 1;
        if (level > 6) level = 6;
        html += '<h' + level + '>' + odtInline(n, styles, media) + '</h' + level + '>';
      } else if (ln === 'p') html += '<p>' + odtInline(n, styles, media) + '</p>';
      else if (ln === 'list') html += odtList(n, styles, media);
      else if (ln === 'table') html += odtTable(n, styles, media);
      else if (ln === 'soft-page-break') html += '<div style="break-before:page"></div>';
    }
    return html;
  }
  function odtList(el, styles, media) {
    var items = '';
    kids(el, 'list-item').forEach(function (item) {
      var inner = '';
      for (var i = 0; i < item.children.length; i++) {
        var c = item.children[i];
        if (c.localName === 'p' || c.localName === 'h') inner += odtInline(c, styles, media);
        else if (c.localName === 'list') inner += odtList(c, styles, media);
      }
      items += '<li>' + inner + '</li>';
    });
    return '<ul>' + items + '</ul>';
  }
  function odtTable(el, styles, media) {
    var head = '', body = '';
    function rowHtml(row, tag) {
      var cells = '';
      for (var i = 0; i < row.children.length; i++) {
        var c = row.children[i];
        if (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell') continue;
        var span = attr(c, 'number-columns-spanned');
        var rspan = attr(c, 'number-rows-spanned');
        var extra = (span && span !== '1' ? ' colspan="' + esc(span) + '"' : '') + (rspan && rspan !== '1' ? ' rowspan="' + esc(rspan) + '"' : '');
        cells += '<' + tag + extra + '>' + (c.localName === 'covered-table-cell' ? '' : odtBlocks(c, styles, media)) + '</' + tag + '>';
      }
      return '<tr>' + cells + '</tr>';
    }
    function walk(node, header) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (c.localName === 'table-row') {
          if (header) head += rowHtml(c, 'th');
          else body += rowHtml(c, 'td');
        } else if (c.localName === 'table-header-rows') walk(c, true);
      }
    }
    walk(el, false);
    return '<table>' + (head ? '<thead>' + head + '</thead>' : '') + '<tbody>' + body + '</tbody></table>';
  }
  function odtHtml(bytes) {
    return loadZip().then(function () { return global.JSZip.loadAsync(bytes); }).then(hardenZip).then(function (zip) {
      var file = zip.file('content.xml');
      if (!file) throw new Error('This OpenDocument file has no content.');
      return Promise.all([file.async('string'), zip.file('styles.xml') ? zip.file('styles.xml').async('string') : Promise.resolve(''), odtMedia(zip)]).then(function (parts) {
        var doc = parseXml(parts[0]);
        var styles = readOdtStyles(doc);
        if (parts[1]) {
          var extra = readOdtStyles(parseXml(parts[1]));
          Object.keys(extra).forEach(function (k) { if (!styles[k]) styles[k] = extra[k]; });
        }
        var body = firstLocal(doc, 'text');
        var html = body ? odtBlocks(body, styles, parts[2]) : '';
        var warnings = ['OpenDocument text is approximated: page styles, headers, and precise fonts are simplified.', 'This PDF page is a picture of the document. Use the print option when you need selectable text.'];
        return sanitize(html, warnings).then(function (clean) {
          return { mode: 'html', html: clean, warnings: uniq(warnings) };
        });
      });
    });
  }

  function rtfParse(text) {
    var i = 0;
    var state = { bold: false, italic: false, skip: 0, uc: 1 };
    var stack = [];
    var paragraphs = [{ runs: [] }];
    var skipDest = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, object: 1, datastore: 1, latentstyles: 1, listtable: 1, listoverridetable: 1, revtbl: 1, rsids: 1, generator: 1, themedata: 1, colorschememapping: 1, header: 1, footer: 1, headerl: 1, headerr: 1, headerf: 1, footerl: 1, footerr: 1, footerf: 1, footnote: 1, annotation: 1, fldinst: 1, nonshppict: 1, filetbl: 1, stylesheet0: 1 };
    function addText(s) {
      if (!s || state.skip) return;
      var para = paragraphs[paragraphs.length - 1];
      var last = para.runs[para.runs.length - 1];
      if (last && last.bold === state.bold && last.italic === state.italic) last.text += s;
      else para.runs.push({ text: s, bold: !!state.bold, italic: !!state.italic });
    }
    function addBreak() {
      if (state.skip) return;
      paragraphs.push({ runs: [] });
    }
    while (i < text.length) {
      var c = text.charAt(i);
      if (c === '{') {
        stack.push({ bold: state.bold, italic: state.italic, skip: state.skip, uc: state.uc });
        i++;
        continue;
      }
      if (c === '}') {
        var prev = stack.pop();
        state = prev || { bold: false, italic: false, skip: 0, uc: 1 };
        i++;
        continue;
      }
      if (c === '\\') {
        i++;
        if (i >= text.length) break;
        var n = text.charAt(i);
        if (n === '\\' || n === '{' || n === '}') { addText(n); i++; continue; }
        if (n === '\n' || n === '\r') { i++; continue; }
        if (n === '*') { state.skip = Math.max(state.skip, 1); i++; continue; }
        if (n === "'") {
          var code = parseInt(text.substr(i + 1, 2), 16);
          if (!state.skip && isFinite(code)) addText(String.fromCharCode(code));
          i += 3;
          continue;
        }
        var m = /^([a-zA-Z]+)(-?\d+)?/.exec(text.slice(i));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (text.charAt(i) === ' ') i++;
        var word = m[1].toLowerCase();
        var arg = m[2] != null ? parseInt(m[2], 10) : null;
        if (word === 'uc' && arg != null) { state.uc = arg; continue; }
        if (word === 'u' && arg != null) {
          var cp = arg < 0 ? arg + 65536 : arg;
          if (!state.skip) addText(String.fromCharCode(cp));
          var left = state.uc || 0;
          while (left > 0 && i < text.length) {
            if (text.charAt(i) === '\\' && text.charAt(i + 1) === "'") { i += 4; left--; }
            else if (text.charAt(i) === '\\' || text.charAt(i) === '{' || text.charAt(i) === '}') break;
            else { i++; left--; }
          }
          continue;
        }
        if (skipDest[word]) { state.skip = Math.max(state.skip, 1); continue; }
        if (state.skip) continue;
        if (word === 'par' || word === 'line') { addBreak(); continue; }
        if (word === 'tab') { addText('\t'); continue; }
        if (word === 'b') { state.bold = arg !== 0; continue; }
        if (word === 'i') { state.italic = arg !== 0; continue; }
        if (word === 'plain') { state.bold = false; state.italic = false; continue; }
        if (word === 'emdash') { addText('\u2014'); continue; }
        if (word === 'endash') { addText('\u2013'); continue; }
        if (word === 'bullet') { addText('\u2022'); continue; }
        if (word === 'lquote') { addText('\u2018'); continue; }
        if (word === 'rquote') { addText('\u2019'); continue; }
        if (word === 'ldblquote') { addText('\u201c'); continue; }
        if (word === 'rdblquote') { addText('\u201d'); continue; }
        continue;
      }
      var j = i;
      while (j < text.length && text.charAt(j) !== '\\' && text.charAt(j) !== '{' && text.charAt(j) !== '}') j++;
      addText(text.slice(i, j).replace(/[\r\n]/g, ''));
      i = j;
    }
    return paragraphs;
  }
  function rtfHtml(paragraphs) {
    return paragraphs.map(function (p) {
      var inner = p.runs.map(function (r) {
        var t = esc(r.text);
        if (r.bold && r.italic) return '<strong><em>' + t + '</em></strong>';
        if (r.bold) return '<strong>' + t + '</strong>';
        if (r.italic) return '<em>' + t + '</em>';
        return t;
      }).join('');
      return '<p>' + (inner || '&nbsp;') + '</p>';
    }).join('');
  }

  function markdownHtml(src) {
    return loadMarked().then(function () {
      var m = global.marked;
      var fn = m && typeof m.parse === 'function' ? m.parse : (typeof m === 'function' ? m : (m && m.marked));
      if (!fn) throw new Error('Markdown library failed to start');
      var out = fn(String(src || ''), { async: false, gfm: true, breaks: false });
      if (out && typeof out.then === 'function') throw new Error('Markdown parser did not finish synchronously');
      var warnings = ['Markdown is drawn as page images so headings, lists, and tables keep their shape. Use the print option for selectable text.'];
      return sanitize(String(out), warnings).then(function (html) {
        return { mode: 'html', html: html, warnings: uniq(warnings) };
      });
    });
  }

  function htmlMode(raw, warnings) {
    warnings = warnings || ['HTML is sanitized and paginated approximately. Scripts, forms, and remote images are removed.', 'Pages are pictures. Use the print option for selectable text.'];
    return sanitize(raw, warnings).then(function (html) {
      return { mode: 'html', html: html, warnings: uniq(warnings) };
    });
  }

  function inlineZipImages(html, basePath, zip) {
    var doc = new DOMParser().parseFromString('<div id="le-root">' + html + '</div>', 'text/html');
    var root = doc.getElementById('le-root');
    var imgs = [].slice.call(root.querySelectorAll('img'));
    var jobs = imgs.map(function (img) {
      var src = img.getAttribute('src') || '';
      if (!src || isSafeUrl(src) || /^[a-z]+:/i.test(src) || src.indexOf('//') === 0) return Promise.resolve();
      var path = joinZip(basePath, decodeURIComponent(src.split('#')[0]));
      var file = zip.file(path) || zip.file(decodeURI(path));
      if (!file) return Promise.resolve();
      return file.async('base64').then(function (b64) {
        img.setAttribute('src', 'data:' + mimeOf(path) + ';base64,' + b64);
      }).catch(function () {});
    });
    return Promise.all(jobs).then(function () { return root.innerHTML; });
  }
  function epubHtml(bytes) {
    return loadZip().then(function () { return global.JSZip.loadAsync(bytes); }).then(hardenZip).then(function (zip) {
      var container = zip.file('META-INF/container.xml');
      if (!container) throw new Error('This EPUB has no container.');
      return container.async('string').then(function (xml) {
        var root = firstLocal(parseXml(xml), 'rootfile');
        var opfPath = root ? root.getAttribute('full-path') : '';
        if (!opfPath || !zip.file(opfPath)) throw new Error('This EPUB has no package document.');
        return zip.file(opfPath).async('string').then(function (opfXml) {
          var opf = parseXml(opfXml);
          var manifest = {};
          var all = opf.getElementsByTagName('*');
          var spine = [];
          for (var i = 0; i < all.length; i++) {
            if (all[i].localName === 'item') manifest[all[i].getAttribute('id')] = all[i].getAttribute('href');
            if (all[i].localName === 'itemref') spine.push(all[i].getAttribute('idref'));
          }
          var chain = Promise.resolve([]);
          spine.forEach(function (id) {
            chain = chain.then(function (parts) {
              var href = manifest[id];
              if (!href) return parts;
              var path = joinZip(opfPath, decodeURIComponent(href));
              var file = zip.file(path);
              if (!file) return parts;
              return file.async('string').then(function (raw) {
                var bodyDoc = new DOMParser().parseFromString(raw, 'text/html');
                var body = bodyDoc.body ? bodyDoc.body.innerHTML : raw;
                return inlineZipImages(body, path, zip).then(function (inlined) {
                  parts.push(inlined);
                  return parts;
                });
              });
            });
          });
          return chain.then(function (parts) {
            var html = parts.map(function (part, idx) {
              var br = idx ? ' style="break-before:page"' : '';
              return '<section class="le-chapter"' + br + '>' + part + '</section>';
            }).join('');
            var warnings = ['EPUB is flowed as chapters. Fixed-layout books, embedded fonts, and complex CSS are approximated.', 'Scripts and remote images are removed.', 'Pages are pictures. Use the print option for selectable text.'];
            return sanitize(html, warnings).then(function (clean) {
              return { mode: 'html', html: clean, warnings: uniq(warnings) };
            });
          });
        });
      });
    });
  }

  function cellString(cell) {
    if (!cell) return '';
    if (cell.w != null && cell.w !== '') return String(cell.w);
    if (cell.v == null) return '';
    try {
      if (cell.z && global.XLSX && global.XLSX.SSF && global.XLSX.SSF.format) return String(global.XLSX.SSF.format(cell.z, cell.v));
    } catch (e) {}
    if (cell.t === 'd' && cell.v && cell.v.getFullYear) {
      try { return cell.v.toISOString().slice(0, 10); } catch (e2) {}
    }
    return String(cell.v);
  }
  function sheetModels(bytes, name, opts, asText) {
    return loadXlsx().then(function () {
      var wb;
      if (asText) {
        var fs = extOf(name) === 'tsv' ? '\t' : ',';
        wb = global.XLSX.read(textOf(bytes), { type: 'string', FS: fs, cellDates: true });
      } else {
        wb = global.XLSX.read(bytes, { type: 'array', cellDates: true });
      }
      var names = (wb.SheetNames || []).slice();
      var want = opts && opts.sheets;
      var warnings = ['Formulas are shown as cached values. Charts, pivot tables, and cell colors are not reproduced.', 'Spreadsheet text stays selectable. Merged cells keep the top-left value.'];
      if (want && want !== 'all') {
        var list = Array.isArray(want) ? want : [want];
        var picked = [];
        list.forEach(function (w) {
          if (typeof w === 'number' && names[w]) picked.push(names[w]);
          else if (names.indexOf(String(w)) >= 0) picked.push(String(w));
        });
        if (!picked.length) warnings.push('None of the chosen sheets were found, so every sheet is included.');
        else names = picked;
      }
      var sheets = names.map(function (sheetName) {
        var ws = wb.Sheets[sheetName] || {};
        var ref = ws['!ref'];
        var rows = [];
        var colCount = 0;
        if (ref) {
          var range = global.XLSX.utils.decode_range(ref);
          colCount = range.e.c - range.s.c + 1;
          for (var r = range.s.r; r <= range.e.r; r++) {
            var row = [];
            for (var c = range.s.c; c <= range.e.c; c++) {
              var addr = global.XLSX.utils.encode_cell({ r: r, c: c });
              row.push(cellString(ws[addr]).slice(0, 500));
            }
            rows.push(row);
          }
        }
        var cols = ws['!cols'] || [];
        var widths = [];
        for (var i = 0; i < colCount; i++) {
          var wch = cols[i] && (cols[i].wch || cols[i].width);
          if (!wch && cols[i] && cols[i].wpx) wch = cols[i].wpx / 7;
          if (!wch) {
            wch = 8;
            for (var rr = 0; rr < rows.length && rr < 80; rr++) wch = Math.max(wch, Math.min(42, String(rows[rr][i] || '').length + 2));
          }
          widths.push(Math.max(4, Math.min(48, wch)));
        }
        return { name: sheetName, rows: rows, widths: widths, merges: ws['!merges'] || [] };
      });
      return { mode: 'sheets', sheets: sheets, warnings: uniq(warnings) };
    });
  }

  function themeMap(xml) {
    var map = {};
    if (!xml) return map;
    var scheme = firstLocal(parseXml(xml), 'clrScheme');
    if (!scheme) return map;
    for (var i = 0; i < scheme.children.length; i++) {
      var child = scheme.children[i];
      var srgb = one(child, 'srgbClr');
      var sys = one(child, 'sysClr');
      var val = srgb ? attr(srgb, 'val') : (sys ? (sys.getAttribute('lastClr') || attr(sys, 'lastClr')) : '');
      var painted = hexColor(val);
      if (painted) map[child.localName] = painted;
    }
    return map;
  }
  function fillHex(node, theme) {
    if (!node) return '';
    var srgb = one(node, 'srgbClr') || firstLocal(node, 'srgbClr');
    if (srgb && attr(srgb, 'val')) return hexColor(attr(srgb, 'val'));
    var scheme = one(node, 'schemeClr') || firstLocal(node, 'schemeClr');
    if (scheme) {
      var key = attr(scheme, 'val');
      if (key === 'tx1') key = 'dk1';
      if (key === 'bg1') key = 'lt1';
      if (key === 'tx2') key = 'dk2';
      if (key === 'bg2') key = 'lt2';
      if (theme[key]) return theme[key];
    }
    return '';
  }
  function emuPx(n) {
    var v = (Number(n) || 0) / 9525;
    if (!isFinite(v)) return 0;
    if (v > 8000) return 8000;
    if (v < -4000) return -4000;
    return v;
  }
  function readXfrm(xfrm) {
    if (!xfrm) return null;
    var off = one(xfrm, 'off');
    var ext = one(xfrm, 'ext');
    var chOff = one(xfrm, 'chOff');
    var chExt = one(xfrm, 'chExt');
    return {
      x: num(attr(off, 'x')), y: num(attr(off, 'y')),
      cx: num(attr(ext, 'cx')), cy: num(attr(ext, 'cy')),
      chx: chOff ? num(attr(chOff, 'x')) : 0, chy: chOff ? num(attr(chOff, 'y')) : 0,
      chcx: chExt ? num(attr(chExt, 'cx')) : 0, chcy: chExt ? num(attr(chExt, 'cy')) : 0,
      rot: num(attr(xfrm, 'rot'))
    };
  }
  function mapBox(box, group) {
    if (!box) return null;
    if (!group) return { x: box.x, y: box.y, cx: box.cx, cy: box.cy, rot: box.rot };
    var sx = group.chcx ? group.cx / group.chcx : 1;
    var sy = group.chcy ? group.cy / group.chcy : 1;
    return {
      x: group.x + (box.x - group.chx) * sx,
      y: group.y + (box.y - group.chy) * sy,
      cx: box.cx * sx,
      cy: box.cy * sy,
      rot: box.rot
    };
  }
  function txHtml(txBody, theme) {
    if (!txBody) return '';
    var html = '';
    kids(txBody, 'p').forEach(function (p) {
      var pPr = one(p, 'pPr');
      var algn = pPr ? (attr(pPr, 'algn') || 'l') : 'l';
      var align = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn] || 'left';
      var bullet = '';
      if (pPr && !one(pPr, 'buNone')) {
        var bc = one(pPr, 'buChar');
        if (bc || one(pPr, 'buAutoNum') || one(pPr, 'buFont')) bullet = (bc && attr(bc, 'char')) || '\u2022';
      }
      var runs = '';
      for (var i = 0; i < p.children.length; i++) {
        var ch = p.children[i];
        if (ch.localName === 'br') { runs += '<br>'; continue; }
        if (ch.localName !== 'r' && ch.localName !== 'fld') continue;
        var rPr = one(ch, 'rPr');
        var tEl = one(ch, 't');
        var text = tEl ? tEl.textContent : '';
        if (!text) continue;
        var sz = rPr ? num(attr(rPr, 'sz'), 1800) : 1800;
        if (!sz) sz = 1800;
        var px = (sz / 100) * PX;
        var col = '#222222';
        if (rPr) {
          var got = fillHex(one(rPr, 'solidFill'), theme);
          if (got) col = got;
        }
        var st = 'font-size:' + px.toFixed(2) + 'px;color:' + col + ';';
        if (rPr && attr(rPr, 'b') === '1') st += 'font-weight:700;';
        if (rPr && attr(rPr, 'i') === '1') st += 'font-style:italic;';
        var face = rPr ? firstLocal(rPr, 'latin') : null;
        var family = face ? cssFamily(attr(face, 'typeface')) : '';
        if (family && family.charAt(0) !== '+') st += 'font-family:' + family + ',Calibri,sans-serif;';
        runs += '<span style="' + st + '">' + esc(text) + '</span>';
      }
      if (!runs) runs = '<br>';
      var pst = 'margin:0;padding:0;text-align:' + align + ';line-height:1.15;white-space:pre-wrap;';
      if (bullet) {
        var mar = pPr ? emuPx(attr(pPr, 'marL')) : 18;
        pst += 'padding-left:' + Math.max(14, mar || 18).toFixed(1) + 'px;';
        runs = esc(bullet) + ' ' + runs;
      }
      html += '<div style="' + pst + '">' + runs + '</div>';
    });
    return html;
  }
  function shapeHtml(sp, theme, group) {
    var spPr = one(sp, 'spPr');
    var xfrm = spPr ? one(spPr, 'xfrm') : null;
    var box = mapBox(readXfrm(xfrm), group);
    var tx = one(sp, 'txBody');
    var text = txHtml(tx, theme);
    if (!box || (box.cx < 1 && box.cy < 1)) return '';
    var fill = '';
    var line = '';
    if (spPr && !one(spPr, 'noFill')) fill = fillHex(one(spPr, 'solidFill'), theme);
    var ln = spPr ? one(spPr, 'ln') : null;
    if (ln && !one(ln, 'noFill')) {
      var lc = fillHex(one(ln, 'solidFill'), theme);
      if (lc) line = Math.max(1, emuPx(attr(ln, 'w') || 9525)).toFixed(2) + 'px solid ' + lc;
    }
    if (!fill && !line && !text.replace(/<[^>]+>/g, '').replace(/\s+/g, '')) return '';
    var geom = spPr ? one(spPr, 'prstGeom') : null;
    var prst = geom ? attr(geom, 'prst') : 'rect';
    var radius = prst === 'ellipse' ? '50%' : (prst === 'roundRect' ? '10px' : '0');
    var bodyPr = tx ? one(tx, 'bodyPr') : null;
    var anchor = bodyPr ? (attr(bodyPr, 'anchor') || 't') : 't';
    var jc = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[anchor] || 'flex-start';
    var st = 'position:absolute;left:' + emuPx(box.x).toFixed(2) + 'px;top:' + emuPx(box.y).toFixed(2) + 'px;width:' + Math.max(1, emuPx(box.cx)).toFixed(2) + 'px;height:' + Math.max(1, emuPx(box.cy)).toFixed(2) + 'px;overflow:hidden;';
    if (fill) st += 'background:' + fill + ';';
    if (line) st += 'border:' + line + ';';
    if (radius !== '0') st += 'border-radius:' + radius + ';';
    if (box.rot) st += 'transform:rotate(' + (box.rot / 60000) + 'deg);';
    if (text) st += 'display:flex;flex-direction:column;justify-content:' + jc + ';';
    return '<div style="' + st + '">' + text + '</div>';
  }
  function picHtml(pic, rels, media, group) {
    var spPr = one(pic, 'spPr');
    var box = mapBox(readXfrm(spPr ? one(spPr, 'xfrm') : null), group);
    var blip = firstLocal(pic, 'blip');
    var id = blip ? attr(blip, 'embed') : '';
    var src = id && rels[id] ? media[rels[id]] : '';
    if (!box || !src) return '';
    var st = 'position:absolute;left:' + emuPx(box.x).toFixed(2) + 'px;top:' + emuPx(box.y).toFixed(2) + 'px;width:' + Math.max(1, emuPx(box.cx)).toFixed(2) + 'px;height:' + Math.max(1, emuPx(box.cy)).toFixed(2) + 'px;object-fit:fill;';
    return '<img alt="" src="' + src + '" style="' + st + '">';
  }
  function tableHtml(frame, theme, group) {
    var xfrm = one(frame, 'xfrm') || firstLocal(frame, 'xfrm');
    var box = mapBox(readXfrm(xfrm), group);
    var tbl = firstLocal(frame, 'tbl');
    if (!box || !tbl) return '';
    var grid = firstLocal(tbl, 'tblGrid');
    var cols = [];
    if (grid) kids(grid, 'gridCol').forEach(function (c) { cols.push(num(attr(c, 'w'), 1)); });
    var sum = cols.reduce(function (a, b) { return a + b; }, 0) || 1;
    var rows = '';
    kids(tbl, 'tr').forEach(function (tr) {
      var cells = '';
      kids(tr, 'tc').forEach(function (tc, idx) {
        var tcPr = one(tc, 'tcPr');
        var bg = tcPr ? fillHex(one(tcPr, 'solidFill'), theme) : '';
        var span = attr(tc, 'gridSpan');
        var st = 'border:1px solid #cccccc;vertical-align:middle;padding:2px 4px;';
        if (bg) st += 'background:' + bg + ';';
        if (cols[idx] && sum) st += 'width:' + (cols[idx] / sum * 100).toFixed(2) + '%;';
        cells += '<td' + (span && span !== '1' ? ' colspan="' + esc(span) + '"' : '') + ' style="' + st + '">' + txHtml(one(tc, 'txBody'), theme) + '</td>';
      });
      rows += '<tr>' + cells + '</tr>';
    });
    var stBox = 'position:absolute;left:' + emuPx(box.x).toFixed(2) + 'px;top:' + emuPx(box.y).toFixed(2) + 'px;width:' + Math.max(1, emuPx(box.cx)).toFixed(2) + 'px;height:' + Math.max(1, emuPx(box.cy)).toFixed(2) + 'px;border-collapse:collapse;table-layout:fixed;background:#fff;';
    return '<table style="' + stBox + '"><tbody>' + rows + '</tbody></table>';
  }
  function walkShapes(node, theme, rels, media, group, out) {
    if (!node) return;
    for (var i = 0; i < node.children.length; i++) {
      var ch = node.children[i];
      var ln = ch.localName;
      if (ln === 'sp' || ln === 'cxnSp') out.push(shapeHtml(ch, theme, group));
      else if (ln === 'pic') out.push(picHtml(ch, rels, media, group));
      else if (ln === 'graphicFrame') out.push(tableHtml(ch, theme, group));
      else if (ln === 'grpSp') {
        var gx = one(one(ch, 'grpSpPr'), 'xfrm');
        var g = mapBox(readXfrm(gx), group);
        var childGroup = g ? {
          x: g.x, y: g.y, cx: g.cx, cy: g.cy,
          chx: readXfrm(gx).chx, chy: readXfrm(gx).chy, chcx: readXfrm(gx).chcx, chcy: readXfrm(gx).chcy
        } : group;
        walkShapes(ch, theme, rels, media, childGroup, out);
      }
    }
  }
  function readRels(zip, part) {
    var rel = part.replace(/([^/]+)$/, '_rels/$1.rels');
    var file = zip.file(rel);
    if (!file) return Promise.resolve({});
    return file.async('string').then(function (xml) {
      var map = {};
      var all = parseXml(xml).getElementsByTagName('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].localName !== 'Relationship') continue;
        var id = all[i].getAttribute('Id');
        if (!id) continue;
        map[id] = { target: all[i].getAttribute('Target') || '', type: all[i].getAttribute('Type') || '' };
      }
      return map;
    });
  }
  function solidBg(xml, theme) {
    if (!xml) return '';
    var doc = parseXml(xml);
    var bg = firstLocal(doc, 'bg');
    if (!bg) return '';
    return fillHex(firstLocal(bg, 'solidFill'), theme) || '';
  }
  function pptxHtml(bytes) {
    return loadZip().then(function () { return global.JSZip.loadAsync(bytes); }).then(hardenZip).then(function (zip) {
      var pres = zip.file('ppt/presentation.xml');
      if (!pres) throw new Error('This PowerPoint file has no presentation.');
      return pres.async('string').then(function (presXml) {
        return readRels(zip, 'ppt/presentation.xml').then(function (presRels) {
          var presDoc = parseXml(presXml);
          var sldSz = firstLocal(presDoc, 'sldSz');
          var sw = sldSz ? emuPx(attr(sldSz, 'cx')) : 960;
          var sh = sldSz ? emuPx(attr(sldSz, 'cy')) : 540;
          if (!(sw > 32 && sw <= 4000)) sw = 960;
          if (!(sh > 32 && sh <= 4000)) sh = 540;
          var order = [];
          var ids = firstLocal(presDoc, 'sldIdLst');
          if (ids) {
            kids(ids, 'sldId').forEach(function (sld) {
              var id = relAttr(sld);
              var rel = presRels[id];
              if (rel) order.push(joinZip('ppt/presentation.xml', rel.target));
            });
          }
          if (!order.length) {
            order = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); }).sort();
          }
          var slidesCut = order.length > MAX_PAGES;
          if (slidesCut) order = order.slice(0, MAX_PAGES);
          var themeXml = '';
          Object.keys(presRels).forEach(function (k) {
            if (presRels[k].type.indexOf('theme') >= 0 && !themeXml) themeXml = joinZip('ppt/presentation.xml', presRels[k].target);
          });
          return (themeXml && zip.file(themeXml) ? zip.file(themeXml).async('string') : Promise.resolve('')).then(function (txml) {
            var theme = themeMap(txml);
            var chain = Promise.resolve([]);
            order.forEach(function (part) {
              chain = chain.then(function (slides) {
                var file = zip.file(part);
                if (!file) return slides;
                return file.async('string').then(function (xml) {
                  return readRels(zip, part).then(function (rels) {
                    var mediaJobs = [];
                    var media = {};
                    Object.keys(rels).forEach(function (id) {
                      if (rels[id].type.indexOf('image') < 0 && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(rels[id].target)) return;
                      var target = joinZip(part, rels[id].target);
                      var zf = zip.file(target);
                      if (!zf) return;
                      mediaJobs.push(zf.async('base64').then(function (b64) {
                        media[target] = 'data:' + mimeOf(target) + ';base64,' + b64;
                      }));
                      rels[id] = target;
                    });
                    return Promise.all(mediaJobs).then(function () {
                      var layoutId = '';
                      Object.keys(rels).some(function (id) {
                        if (String(rels[id].type || rels[id]).indexOf('slideLayout') >= 0 || /slideLayouts\//.test(rels[id].target || rels[id])) {
                          layoutId = id;
                          return true;
                        }
                        return false;
                      });
                      var layoutPath = '';
                      if (layoutId && rels[layoutId] && rels[layoutId].target) layoutPath = joinZip(part, rels[layoutId].target);
                      else if (layoutId && typeof rels[layoutId] === 'string' && rels[layoutId].indexOf('slideLayout') >= 0) layoutPath = rels[layoutId];
                      function masterBg(layoutXmlPath) {
                        if (!layoutXmlPath || !zip.file(layoutXmlPath)) return Promise.resolve('');
                        return zip.file(layoutXmlPath).async('string').then(function (lxml) {
                          var bg = solidBg(lxml, theme);
                          if (bg) return bg;
                          return readRels(zip, layoutXmlPath).then(function (lrels) {
                            var mp = '';
                            Object.keys(lrels).some(function (id) {
                              if ((lrels[id].type || '').indexOf('slideMaster') >= 0) { mp = joinZip(layoutXmlPath, lrels[id].target); return true; }
                              return false;
                            });
                            if (!mp || !zip.file(mp)) return '';
                            return zip.file(mp).async('string').then(function (mxml) { return solidBg(mxml, theme); });
                          });
                        }).catch(function () { return ''; });
                      }
                      return masterBg(layoutPath).then(function (fromMaster) {
                        var bg = hexColor(solidBg(xml, theme) || fromMaster) || '#ffffff';
                        var tree = firstLocal(parseXml(xml), 'spTree');
                        var bits = [];
                        walkShapes(tree, theme, rels, media, null, bits);
                        var html = '<div class="le-slide" style="position:relative;width:' + sw.toFixed(2) + 'px;height:' + sh.toFixed(2) + 'px;overflow:hidden;background:' + bg + ';">' + bits.join('') + '</div>';
                        slides.push({ html: html, w: sw, h: sh, bg: bg });
                        return slides;
                      });
                    });
                  });
                });
              });
            });
            return chain.then(function (slides) {
              var warnings = ['Slides are approximated. Animations, charts, SmartArt, gradients, and WordArt are not reproduced exactly.', 'Each slide is drawn as a picture. Master decorations other than a solid background are omitted.'];
              if (slidesCut) warnings.push('Only the first ' + MAX_PAGES + ' slides are imported.');
              return Promise.all(slides.map(function (slide) {
                return sanitize(slide.html, warnings).then(function (html) {
                  slide.html = html;
                  return slide;
                });
              })).then(function (clean) {
                return {
                  mode: 'slides',
                  slides: clean,
                  html: clean.map(function (s) { return s.html; }).join('<div style="height:12px"></div>'),
                  pages: clean.map(function (s) { return s.html; }),
                  warnings: warnings
                };
              });
            });
          });
        });
      });
    });
  }

  function parseUncached(file) {
    var info = detect(file);
    var name = typeof file === 'string' ? 'document.html' : baseName(file && file.name);
    if (info.kind === 'unsupported') {
      return Promise.resolve({ mode: 'unsupported', kind: info.kind, name: name, note: info.note, warnings: [info.note], html: '' });
    }
    if (typeof file === 'string') {
      return htmlMode(file).then(function (doc) { doc.kind = 'html'; doc.name = name; doc.key = fileKey(file); return doc; });
    }
    if (info.kind === 'text' || info.kind === 'code' || info.kind === 'json' || info.kind === 'log') {
      return readBytes(file).then(function (bytes) {
        var raw = textOf(bytes).replace(/\t/g, '    ');
        var text = raw;
        var warnings = [];
        if (info.kind === 'json') {
          try { text = JSON.stringify(JSON.parse(raw), null, 2); }
          catch (e) { warnings.push('JSON could not be parsed, so the raw text is shown.'); text = raw; }
        }
        return {
          mode: 'plain', kind: info.kind, name: name, key: fileKey(file), text: text, rawText: raw,
          mono: info.kind !== 'text', lineNumbers: info.kind === 'code', warnings: warnings
        };
      });
    }
    if (info.kind === 'rtf') {
      return readBytes(file).then(function (bytes) {
        var paragraphs = rtfParse(textOf(bytes));
        return {
          mode: 'richtext', kind: 'rtf', name: name, key: fileKey(file), paragraphs: paragraphs,
          warnings: ['RTF keeps text, bold, and italic. Images, tables, fonts, and headers are dropped.']
        };
      });
    }
    if (info.kind === 'image' || info.kind === 'svg') {
      return readBytes(file).then(function (bytes) {
        var warnings = [];
        if (extOf(name) === 'gif') warnings.push('Only the first frame of the GIF is used.');
        if (extOf(name) === 'svg' || info.kind === 'svg') warnings.push('SVG scripts and external images are removed. Filters and fonts may change.');
        if (extOf(name) === 'heic' || extOf(name) === 'heif') warnings.push(info.note);
        return { mode: 'image', kind: info.kind === 'svg' ? 'svg' : 'image', name: name, key: fileKey(file), bytes: bytes, mime: (file && file.type) || mimeOf(name), warnings: warnings };
      });
    }
    if (info.kind === 'pdf') {
      return readBytes(file).then(function (bytes) {
        return { mode: 'pdf', kind: 'pdf', name: name, key: fileKey(file), bytes: bytes, warnings: ['PDF pages are copied unchanged. Page size, fit, and margins do not reflow them.'] };
      });
    }
    return readBytes(file).then(function (bytes) {
      var job;
      if (info.kind === 'docx') job = docxHtml(bytes);
      else if (info.kind === 'odt') job = odtHtml(bytes);
      else if (info.kind === 'html') job = htmlMode(textOf(bytes));
      else if (info.kind === 'markdown') job = markdownHtml(textOf(bytes));
      else if (info.kind === 'epub') job = epubHtml(bytes);
      else if (info.kind === 'csv') job = sheetModels(bytes, name, {}, true);
      else if (info.kind === 'xlsx') job = sheetModels(bytes, name, {}, false);
      else if (info.kind === 'pptx') job = pptxHtml(bytes);
      else job = Promise.resolve({ mode: 'unsupported', note: info.note, warnings: [info.note], html: '' });
      return job.then(function (doc) {
        doc.kind = info.kind;
        doc.name = name;
        doc.key = fileKey(file);
        if (info.note && (doc.warnings || []).indexOf(info.note) < 0) doc.warnings = [info.note].concat(doc.warnings || []);
        return doc;
      });
    });
  }
  function parseFile(file) {
    var key = fileKey(file);
    if (parseCache.has(key)) return parseCache.get(key);
    var p = parseUncached(file).then(function (doc) {
      doc.key = doc.key || key;
      return doc;
    }).catch(function (err) {
      parseCache.delete(key);
      throw err;
    });
    remember(parseCache, key, p);
    return p;
  }

  function canEncode(font, ch) {
    try { font.encodeText(ch); return true; } catch (e) { return false; }
  }
  function safeText(font, text, fonts) {
    var s = String(text == null ? '' : text);
    var out = '';
    var loss = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var code = s.charCodeAt(i);
      if (ch === '\n' || ch === '\r' || ch === '\t') { out += ch; continue; }
      if (code < 32) continue;
      if (code >= 0xD800 && code <= 0xDBFF) {
        var pair = s.substr(i, 2);
        if (canEncode(font, pair)) { out += pair; i++; continue; }
        loss = true; out += '?'; i++; continue;
      }
      if (canEncode(font, ch)) out += ch;
      else { loss = true; out += '?'; }
    }
    if (loss && fonts && fonts.markLoss) fonts.markLoss();
    return out;
  }
  function widthOf(font, text, size) {
    try { return font.widthOfTextAtSize(text || '', size); }
    catch (e) { return (text ? text.length : 0) * size * 0.5; }
  }
  function wrapText(font, text, size, maxW) {
    var lines = [];
    String(text == null ? '' : text).split('\n').forEach(function (part) {
      if (!part) { lines.push(''); return; }
      var words = part.split(/(\s+)/);
      var cur = '';
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (!w) continue;
        if (widthOf(font, cur + w, size) <= maxW + 0.75) { cur += w; continue; }
        if (cur) {
          lines.push(cur.replace(/\s+$/g, ''));
          cur = '';
          if (/^\s+$/.test(w)) continue;
        }
        if (widthOf(font, w, size) <= maxW) { cur = w; continue; }
        var buf = '';
        for (var c = 0; c < w.length; c++) {
          var ch = w.charAt(c);
          if (buf && widthOf(font, buf + ch, size) > maxW + 0.75) { lines.push(buf); buf = ch; }
          else buf += ch;
        }
        cur = buf;
      }
      if (cur) lines.push(cur.replace(/\s+$/g, ''));
    });
    return lines;
  }
  function fontKey(bold, italic, mono) {
    if (mono) return bold ? 'mono-bold' : 'mono';
    if (bold && italic) return 'sans-bi';
    if (bold) return 'sans-bold';
    if (italic) return 'sans-italic';
    return 'sans';
  }
  function makeFonts(doc) {
    return loadFontkit().then(function (kit) {
      var STD = global.PDFLib.StandardFonts;
      function std(name) { return doc.embedFont(STD[name]); }
      return Promise.all([std('Helvetica'), std('HelveticaBold'), std('HelveticaOblique'), std('HelveticaBoldOblique'), std('Courier'), std('CourierBold')]).then(function (list) {
        var fonts = { sans: list[0], 'sans-bold': list[1], 'sans-italic': list[2], 'sans-bi': list[3], mono: list[4], 'mono-bold': list[5], unicode: false, loss: false };
        fonts.markLoss = function () { fonts.loss = true; };
        if (!(kit && global.LE && global.LE.fonts && global.LE.fonts.bytes && global.LE.fonts.list)) return fonts;
        var families = [];
        try { families = global.LE.fonts.list() || []; } catch (e) { families = []; }
        var sans = null, mono = null;
        for (var i = 0; i < families.length; i++) {
          if (!sans && families[i].category === 'sans') sans = families[i];
          if (!mono && families[i].category === 'mono') mono = families[i];
        }
        if (!sans) return fonts;
        try { doc.registerFontkit(kit); } catch (e2) { return fonts; }
        function embed(family, weight, italic) {
          return global.LE.fonts.bytes(family, weight, italic).then(function (buf) {
            return doc.embedFont(buf, { subset: true });
          });
        }
        var jobs = [embed(sans.family, 400, false)];
        if (sans.weights && sans.weights.indexOf(700) >= 0) jobs.push(embed(sans.family, 700, false));
        else jobs.push(Promise.resolve(null));
        if (sans.italic) jobs.push(embed(sans.family, 400, true));
        else jobs.push(Promise.resolve(null));
        if (mono) jobs.push(embed(mono.family, 400, false));
        else jobs.push(Promise.resolve(null));
        return Promise.all(jobs).then(function (got) {
          fonts.sans = got[0] || fonts.sans;
          fonts['sans-bold'] = got[1] || fonts['sans-bold'];
          fonts['sans-italic'] = got[2] || fonts['sans-italic'];
          fonts['sans-bi'] = got[1] || fonts['sans-bi'];
          if (got[3]) { fonts.mono = got[3]; fonts['mono-bold'] = got[3]; }
          fonts.unicode = true;
          return fonts;
        }).catch(function () { return fonts; });
      });
    });
  }
  function lossWarning(fonts, warnings) {
    if (fonts && fonts.loss) warnings.push('Some characters were replaced because the built-in PDF fonts cover Western European text only.');
  }
  function drawOps(page, ops, fonts) {
    var rgb = global.PDFLib.rgb;
    function color(hex) {
      hex = String(hex || '#222222').replace('#', '');
      if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
      var n = parseInt(hex.slice(0, 6), 16);
      if (!isFinite(n)) n = 0x222222;
      return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    }
    ops.forEach(function (op) {
      if (op.op === 'rect') {
        var spec = { x: op.x, y: op.y, width: Math.max(0.2, op.w), height: Math.max(0.2, op.h), borderWidth: op.borderWidth || 0 };
        if (op.fill) spec.color = color(op.fill);
        if (op.border) { spec.borderColor = color(op.border); spec.borderWidth = op.borderWidth || 0.4; }
        page.drawRectangle(spec);
      } else if (op.op === 'text' && op.text) {
        var font = fonts[op.font] || fonts.sans;
        var text = safeText(font, op.text, fonts);
        if (!text) return;
        page.drawText(text, { x: op.x, y: op.y, size: op.size, font: font, color: color(op.color || '#1a1a1a') });
      }
    });
  }
  function paintChrome(pages, opts, fileName, fonts) {
    var chrome = chromeOf(opts);
    if (!chrome.header && !chrome.footer) return;
    var total = pages.length;
    var date = dateStamp();
    var file = baseName(fileName).slice(0, 80);
    pages.forEach(function (entry, i) {
      var info = { page: i + 1, pages: total, date: date, file: file };
      var header = fillTemplate(chrome.header, info);
      var footer = fillTemplate(chrome.footer, info);
      var size = 9;
      var font = fonts.sans;
      if (header) {
        header = safeText(font, header, fonts);
        var hw = widthOf(font, header, size);
        var max = entry.w - 36;
        if (hw > max) header = fitLine(font, header, size, max);
        hw = widthOf(font, header, size);
        var hx = xAlign(templateAlign(chrome.header, 'left'), entry.w, hw, 18);
        entry.ops.push({ op: 'text', text: header, x: hx, y: entry.h - 16, size: size, font: 'sans', color: '#444444' });
      }
      if (footer) {
        footer = safeText(font, footer, fonts);
        var fw = widthOf(font, footer, size);
        var maxF = entry.w - 36;
        if (fw > maxF) footer = fitLine(font, footer, size, maxF);
        fw = widthOf(font, footer, size);
        var fx = xAlign(templateAlign(chrome.footer, 'center'), entry.w, fw, 18);
        entry.ops.push({ op: 'text', text: footer, x: fx, y: 10, size: size, font: 'sans', color: '#444444' });
      }
    });
  }
  function fitLine(font, text, size, maxW) {
    if (widthOf(font, text, size) <= maxW) return text;
    var t = text;
    while (t.length > 1 && widthOf(font, t + '...', size) > maxW) t = t.slice(0, -1);
    return t + '...';
  }
  function xAlign(align, pageW, textW, inset) {
    if (align === 'left') return inset;
    if (align === 'right') return Math.max(inset, pageW - inset - textW);
    return Math.max(inset, (pageW - textW) / 2);
  }
  function blankPage(page) {
    return { w: page.w, h: page.h, ops: [] };
  }
  function sourceOf(parsed, opts) {
    if (parsed && parsed.kind === 'json' && opts && opts.pretty === false && parsed.rawText != null) return String(parsed.rawText);
    return String((parsed && parsed.text) || '');
  }
  function layoutPlain(parsed, page, margin, fonts, opts) {
    var scale = normScale(opts.scale);
    var mono = !!parsed.mono;
    var size = (mono ? 9.5 : 11) * scale;
    var lineH = Math.max(8, size * 1.35);
    var fontName = mono ? 'mono' : 'sans';
    var font = fonts[fontName];
    var source = sourceOf(parsed, opts).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var show = parsed.lineNumbers && opts.lineNumbers !== false;
    var gutter = 0;
    if (show) gutter = widthOf(fonts.mono, String(Math.max(1, source.length)), size) + 14;
    var maxW = Math.max(24, page.w - margin.left - margin.right - gutter);
    var pages = [];
    var ops = [];
    var yTop = margin.top;
    function bump() {
      if (yTop + lineH > page.h - margin.bottom + 0.4) {
        pages.push({ w: page.w, h: page.h, ops: ops });
        ops = [];
        yTop = margin.top;
      }
    }
    source.forEach(function (line, idx) {
      var safe = safeText(font, line, fonts);
      var parts = wrapText(font, safe, size, maxW);
      if (!parts.length) parts = [''];
      parts.forEach(function (part, pi) {
        bump();
        var baseline = page.h - yTop - size * 0.82;
        if (show && pi === 0) {
          var label = String(idx + 1);
          var lw = widthOf(fonts.mono, label, size);
          ops.push({ op: 'text', text: label, x: margin.left + gutter - 8 - lw, y: baseline, size: size, font: 'mono', color: '#8a8a8a' });
        }
        if (part) ops.push({ op: 'text', text: part, x: margin.left + gutter, y: baseline, size: size, font: fontName, color: '#1a1a1a' });
        yTop += lineH;
      });
    });
    pages.push({ w: page.w, h: page.h, ops: ops });
    if (pages.length > MAX_PAGES) {
      pages = pages.slice(0, MAX_PAGES);
      parsed.warnings = (parsed.warnings || []).concat(['Stopped after ' + MAX_PAGES + ' pages.']);
    }
    return pages;
  }
  function layoutRich(parsed, page, margin, fonts, opts) {
    var scale = normScale(opts.scale);
    var size = 11 * scale;
    var lineH = Math.max(8, size * 1.4);
    var maxW = Math.max(24, page.w - margin.left - margin.right);
    var pages = [];
    var ops = [];
    var yTop = margin.top;
    function bump(extra) {
      if (yTop + extra > page.h - margin.bottom + 0.4 && yTop > margin.top + 1) {
        pages.push({ w: page.w, h: page.h, ops: ops });
        ops = [];
        yTop = margin.top;
      }
    }
    (parsed.paragraphs || []).forEach(function (para) {
      var atoms = [];
      (para.runs || []).forEach(function (run) {
        var key = fontKey(run.bold, run.italic, false);
        var font = fonts[key] || fonts.sans;
        var safe = safeText(font, String(run.text || '').replace(/\t/g, '    '), fonts);
        safe.split(/(\s+)/).forEach(function (piece) {
          if (piece) atoms.push({ text: piece, font: key, face: font });
        });
      });
      var lines = [];
      var cur = [];
      var used = 0;
      atoms.forEach(function (atom) {
        var w = widthOf(atom.face, atom.text, size);
        if (cur.length && used + w > maxW && !/^\s+$/.test(atom.text)) {
          lines.push(cur);
          cur = [];
          used = 0;
        }
        if (/^\s+$/.test(atom.text) && !cur.length) return;
        if (w > maxW && !cur.length) {
          wrapText(atom.face, atom.text, size, maxW).forEach(function (piece, idx) {
            if (idx) { lines.push(cur); cur = []; }
            cur = [{ text: piece, font: atom.font, face: atom.face }];
          });
          used = cur.length ? widthOf(cur[0].face, cur[0].text, size) : 0;
          return;
        }
        cur.push(atom);
        used += w;
      });
      if (cur.length) lines.push(cur);
      if (!lines.length) lines = [[]];
      lines.forEach(function (line) {
        bump(lineH);
        var x = margin.left;
        var baseline = page.h - yTop - size * 0.82;
        line.forEach(function (atom) {
          var piece = atom.text;
          if (!piece || /^\s+$/.test(piece) && x === margin.left) return;
          ops.push({ op: 'text', text: piece, x: x, y: baseline, size: size, font: atom.font, color: '#1a1a1a' });
          x += widthOf(atom.face, piece, size);
        });
        yTop += lineH;
      });
      yTop += lineH * 0.28;
    });
    pages.push({ w: page.w, h: page.h, ops: ops });
    return pages;
  }
  function naturalWidths(sheet, fonts, size, pad) {
    var rows = sheet.rows || [];
    var n = sheet.widths ? sheet.widths.length : 0;
    rows.forEach(function (row) { if (row && row.length > n) n = row.length; });
    var probe = widthOf(fonts.sans, '0', size) || size * 0.5;
    var out = [];
    for (var c = 0; c < n; c++) {
      var hint = sheet.widths && sheet.widths[c] ? sheet.widths[c] : 8;
      var w = Math.max(4, hint) * probe;
      for (var r = 0; r < rows.length && r < 80; r++) {
        var raw = String((rows[r] && rows[r][c]) || '');
        if (raw.length > 48) raw = raw.slice(0, 48);
        var face = r === 0 ? (fonts['sans-bold'] || fonts.sans) : fonts.sans;
        var tw = widthOf(face, safeText(face, raw, fonts), size);
        if (tw > w) w = tw;
      }
      out.push(w + pad * 2 + 2);
    }
    return out;
  }
  function sheetPages(parsed, opts, fonts) {
    var scale = normScale(opts.scale);
    var size = 9 * scale;
    var titleSize = 13 * scale;
    var lineH = Math.max(8, size * 1.28);
    var pad = 3.2;
    var wide = false;
    (parsed.sheets || []).forEach(function (sheet) {
      var cols = naturalWidths(sheet, fonts, size, pad);
      var sum = cols.reduce(function (a, b) { return a + b; }, 0);
      var portrait = resolvePage(Object.assign({}, opts, { orientation: 'portrait' }));
      var m = resolveMargin(opts);
      if (sum > portrait.w - m.left - m.right + 4) wide = true;
    });
    var page = resolvePage(opts);
    var warnings = (parsed.warnings || []).slice();
    if ((opts.orientation || 'auto') === 'auto' && wide) {
      page = asLandscape(page);
      warnings.push('Wide sheet: landscape is used so more columns fit.');
    } else if (wide && page.w < page.h) {
      warnings.push('This sheet is wider than the page. Landscape orientation fits more columns.');
    }
    var margin = resolveMargin(opts);
    if (margin.bumped) warnings.push('A little margin was added so the header or footer has room.');
    var contentW = page.w - margin.left - margin.right;
    var contentBottom = page.h - margin.bottom;
    var pages = [];
    function rowHeight(row, colW, key) {
      var face = fonts[key] || fonts.sans;
      var lines = 1;
      for (var c = 0; c < colW.length; c++) {
        var wrapped = wrapText(face, safeText(face, row[c] || '', fonts), size, Math.max(8, colW[c] - pad * 2));
        if (wrapped.length > lines) lines = wrapped.length;
      }
      return Math.max(lineH + pad * 2, lines * lineH + pad * 2);
    }
    (parsed.sheets || []).forEach(function (sheet) {
      var rows = sheet.rows || [];
      var colW = naturalWidths(sheet, fonts, size, pad);
      var sum = colW.reduce(function (a, b) { return a + b; }, 0);
      if (sum > contentW && sum > 0) {
        var f = contentW / sum;
        colW = colW.map(function (w) { return Math.max(16, w * f); });
        var sum2 = colW.reduce(function (a, b) { return a + b; }, 0);
        if (sum2 > contentW) {
          var f2 = contentW / sum2;
          colW = colW.map(function (w) { return w * f2; });
        }
        warnings.push('Columns on “' + sheet.name + '” were narrowed to the page width.');
      }
      var tableW = colW.reduce(function (a, b) { return a + b; }, 0);
      var header = rows.length ? rows[0] : [];
      var body = rows.slice(1);
      var headerH = rows.length ? rowHeight(header, colW, 'sans-bold') : 0;
      var titleH = titleSize * 1.45;
      var groups = [];
      var cur = [];
      var isFirst = true;
      var used = titleH + headerH;
      function startH(first) { return (first ? titleH : titleSize * 0.4) + headerH; }
      if (!body.length) groups.push({ first: true, rows: [] });
      for (var r = 0; r < body.length; r++) {
        var h = rowHeight(body[r], colW, 'sans');
        var limit = contentBottom - margin.top;
        if (cur.length && used + h > limit) {
          groups.push({ first: isFirst, rows: cur });
          isFirst = false;
          cur = [];
          used = startH(false);
        }
        if (!cur.length && h > limit - startH(isFirst)) {
          groups.push({ first: isFirst, rows: [body[r]] });
          isFirst = false;
          used = startH(false);
          warnings.push('A row on “' + sheet.name + '” is taller than the page and may be tight.');
          continue;
        }
        cur.push(body[r]);
        used += h;
      }
      if (cur.length) groups.push({ first: isFirst, rows: cur });
      groups.forEach(function (group) {
        var ops = [];
        var top = margin.top;
        if (group.first) {
          ops.push({ op: 'text', text: sheet.name, x: margin.left, y: page.h - top - titleSize * 0.85, size: titleSize, font: 'sans-bold', color: '#1a1a1a' });
          top += titleH;
        }
        function paintRow(row, y, h, key, fill) {
          var x = margin.left;
          var face = fonts[key] || fonts.sans;
          for (var c = 0; c < colW.length; c++) {
            ops.push({ op: 'rect', x: x, y: page.h - y - h, w: colW[c], h: h, fill: fill || '', border: '#c5c5c5', borderWidth: 0.4 });
            var lines = wrapText(face, safeText(face, (row && row[c]) || '', fonts), size, Math.max(8, colW[c] - pad * 2));
            for (var li = 0; li < lines.length; li++) {
              if (!lines[li]) continue;
              var baseline = page.h - y - pad - size * 0.82 - li * lineH;
              ops.push({ op: 'text', text: lines[li], x: x + pad, y: baseline, size: size, font: key, color: '#1a1a1a' });
            }
            x += colW[c];
          }
        }
        if (rows.length) {
          paintRow(header, top, headerH, 'sans-bold', '#f2f2f2');
          top += headerH;
        }
        group.rows.forEach(function (row) {
          var h = rowHeight(row, colW, 'sans');
          paintRow(row, top, h, 'sans', '');
          top += h;
        });
        if (!rows.length) {
          ops.push({ op: 'text', text: sheet.name + ' is empty', x: margin.left, y: page.h - margin.top - 16, size: 12, font: 'sans', color: '#444' });
        }
        pages.push({ w: page.w, h: page.h, ops: ops, tableW: tableW });
      });
    });
    if (!pages.length) pages.push(blankPage(page));
    if (pages.length > MAX_PAGES) {
      pages = pages.slice(0, MAX_PAGES);
      warnings.push('Stopped after ' + MAX_PAGES + ' pages.');
    }
    return { pages: pages, warnings: uniq(warnings) };
  }

  function newDoc(title) {
    return loadPdfLib().then(function () {
      return global.PDFLib.PDFDocument.create().then(function (doc) {
        doc.setCreator('LocalEditor');
        doc.setProducer('LocalEditor');
        try { if (title) doc.setTitle(String(title).replace(/\.[^.]+$/, '').slice(0, 120)); } catch (e) {}
        return doc;
      });
    });
  }
  function finishDoc(doc, pages, fonts, opts, fileName, warnings) {
    paintChrome(pages, opts, fileName, fonts);
    pages.forEach(function (entry) {
      var page = doc.addPage([entry.w, entry.h]);
      drawOps(page, entry.ops, fonts);
    });
    lossWarning(fonts, warnings);
    return doc.save().then(function (bytes) {
      return { bytes: bytes, pageCount: pages.length, warnings: uniq(warnings) };
    });
  }
  function vectorPdf(parsed, opts) {
    return newDoc(parsed.name).then(function (doc) {
      return makeFonts(doc).then(function (fonts) {
        var page = resolvePage(opts);
        if (page.image) page = { w: PAGE.A4[0], h: PAGE.A4[1], name: 'A4', orientation: 'portrait' };
        var margin = resolveMargin(opts);
        var warnings = (parsed.warnings || []).slice();
        if (margin.bumped) warnings.push('A little margin was added so the header or footer has room.');
        var laid = parsed.mode === 'richtext' ? layoutRich(parsed, page, margin, fonts, opts) : layoutPlain(parsed, page, margin, fonts, opts);
        return finishDoc(doc, laid, fonts, opts, parsed.name, warnings.concat(parsed.warnings || []));
      });
    });
  }
  function sheetsPdf(parsed, opts) {
    return newDoc(parsed.name).then(function (doc) {
      return makeFonts(doc).then(function (fonts) {
        var laid = sheetPages(Object.assign({}, parsed, { warnings: [] }), Object.assign({}, opts, { sheets: undefined }), fonts);
        if (opts && opts.sheets) {
          /* sheetPages uses parsed.sheets, already filtered at parse when opts passed. */
        }
        return finishDoc(doc, laid.pages, fonts, opts, parsed.name, (parsed.warnings || []).concat(laid.warnings || []));
      });
    });
  }

function mountFrame(innerHtml, css, widthPx, sandbox, onscreen) {
  return new Promise(function (resolve) {
    var iframe = document.createElement('iframe');
    if (sandbox) iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    var w = Math.max(80, Math.ceil(widthPx));
    iframe.style.cssText = onscreen
      ? 'position:fixed;left:0;top:0;width:' + w + 'px;height:520px;border:0;background:#fff;opacity:0.02;pointer-events:none;z-index:-1;'
      : 'position:absolute;left:-16000px;top:0;width:' + w + 'px;height:520px;border:0;background:#fff;';
    var shell = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + String(css || '').replace(/<\/\s*/gi, '') + '</style></head><body>' + innerHtml + '</body></html>';
    var done = false;
    function ready() {
      var doc = iframe.contentDocument;
      if (!doc || !doc.body) return false;
      return !!(doc.getElementById('le-flow') || doc.querySelector('.le-slide') || (doc.body.innerHTML && doc.body.innerHTML.indexOf('le-') >= 0));
    }
    function finish() {
      if (done || !ready()) return;
      done = true;
      resolve(iframe);
    }
    iframe.onload = function () { finish(); };
    document.body.appendChild(iframe);
    iframe.srcdoc = shell;
    setTimeout(finish, 400);
    setTimeout(function () { if (!done) { done = true; resolve(iframe); } }, 1800);
  });
}
  function waitReady(doc) {
    var imgs = [].slice.call(doc.images || []);
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (res) { img.onload = img.onerror = function () { res(); }; });
    })).then(function () {
      if (doc.fonts && doc.fonts.ready) return doc.fonts.ready.catch(function () {});
    }).then(function () {
      return new Promise(function (res) { requestAnimationFrame(function () { res(); }); });
    });
  }
  function breakOn(el, which) {
    var view = el.ownerDocument.defaultView;
    var cs = view.getComputedStyle(el);
    var v = which === 'before' ? (cs.breakBefore || cs.pageBreakBefore || '') : (cs.breakAfter || cs.pageBreakAfter || '');
    if (which === 'before' && el.getAttribute('data-le-force-break') === '1') return true;
    return v === 'always' || v === 'page' || v === 'left' || v === 'right';
  }
  function insertSpacer(el, px) {
    if (px < 1) return;
    var spacer = el.ownerDocument.createElement('div');
    spacer.setAttribute('data-le-spacer', '1');
    spacer.style.cssText = 'height:' + px + 'px;margin:0;padding:0;flex:0 0 auto;';
    el.parentNode.insertBefore(spacer, el);
  }
  function splitTable(table, pageH) {
    var doc = table.ownerDocument;
    var thead = table.tHead;
    var headerH = thead ? thead.offsetHeight : 0;
    var bodyRows = [];
    for (var b = 0; b < table.tBodies.length; b++) {
      for (var r = 0; r < table.tBodies[b].rows.length; r++) bodyRows.push(table.tBodies[b].rows[r]);
    }
    if (bodyRows.length < 2 || headerH >= pageH) return false;
    var heights = bodyRows.map(function (row) { return row.offsetHeight || 1; });
    var avail = Math.max(24, pageH - headerH - 6);
    var groups = [];
    var cur = [];
    var used = 0;
    for (var i = 0; i < bodyRows.length; i++) {
      if (cur.length && used + heights[i] > avail) { groups.push(cur); cur = []; used = 0; }
      cur.push(bodyRows[i]);
      used += heights[i];
      if (heights[i] > avail && cur.length === 1) { groups.push(cur); cur = []; used = 0; }
    }
    if (cur.length) groups.push(cur);
    if (groups.length < 2) return false;
    var parent = table.parentNode;
    var frag = doc.createDocumentFragment();
    groups.forEach(function (group, idx) {
      var t = doc.createElement('table');
      if (table.className) t.className = table.className;
      if (table.getAttribute('style')) t.setAttribute('style', table.getAttribute('style'));
      if (thead) t.appendChild(idx === 0 ? thead : thead.cloneNode(true));
      var tb = doc.createElement('tbody');
      group.forEach(function (row) { tb.appendChild(row); });
      t.appendChild(tb);
      frag.appendChild(t);
    });
    parent.replaceChild(frag, table);
    return true;
  }
  function splitList(list, pageH) {
    var items = [].slice.call(list.children).filter(function (n) { return n.tagName === 'LI'; });
    if (items.length < 2) return false;
    var heights = items.map(function (li) { return li.offsetHeight || 1; });
    var groups = [];
    var cur = [];
    var used = 0;
    var limit = Math.max(24, pageH - 8);
    for (var i = 0; i < items.length; i++) {
      if (cur.length && used + heights[i] > limit) { groups.push(cur); cur = []; used = 0; }
      cur.push(items[i]);
      used += heights[i];
    }
    if (cur.length) groups.push(cur);
    if (groups.length < 2) return false;
    var doc = list.ownerDocument;
    var frag = doc.createDocumentFragment();
    var start = parseInt(list.getAttribute('start') || '1', 10);
    if (!isFinite(start)) start = 1;
    var seen = 0;
    groups.forEach(function (group) {
      var nl = doc.createElement(list.tagName);
      if (list.className) nl.className = list.className;
      if (list.tagName === 'OL') nl.setAttribute('start', String(start + seen));
      group.forEach(function (li) { nl.appendChild(li); });
      frag.appendChild(nl);
      seen += group.length;
    });
    list.parentNode.replaceChild(frag, list);
    return true;
  }
  function canExplode(el, pageH) {
    var tag = el.tagName;
    if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'ARTICLE' && tag !== 'MAIN' && tag !== 'BLOCKQUOTE') return false;
    if (!el.children || !el.children.length || el.offsetHeight <= pageH) return false;
    var block = { P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, TABLE: 1, PRE: 1, BLOCKQUOTE: 1, HR: 1, FIGURE: 1, IMG: 1 };
    var n = 0;
    for (var i = 0; i < el.children.length; i++) if (block[el.children[i].tagName]) n++;
    return n > 0;
  }
  function explode(el) {
    var force = breakOn(el, 'before') || el.getAttribute('style') && /break-before\s*:\s*page/i.test(el.getAttribute('style'));
    var frag = el.ownerDocument.createDocumentFragment();
    var first = true;
    while (el.firstChild) {
      var n = el.firstChild;
      if (first && force && n.nodeType === 1) n.setAttribute('data-le-force-break', '1');
      first = false;
      frag.appendChild(n);
    }
    el.parentNode.replaceChild(frag, el);
  }
  function paginateFlow(flow, pageH, warnings) {
    var guard = 0;
    while (guard++ < 2500) {
      var children = [].slice.call(flow.children || []);
      var changed = false;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (!el || el.nodeType !== 1 || !el.parentNode) continue;
        if (el.getAttribute('data-le-spacer') === '1') continue;
        if (canExplode(el, pageH)) { explode(el); changed = true; break; }
        var h = el.offsetHeight;
        if ((el.tagName === 'TABLE') && h > pageH + 2 && el.getAttribute('data-le-nosplit') !== '1') {
          if (splitTable(el, pageH)) { changed = true; break; }
          el.setAttribute('data-le-nosplit', '1');
          warnings.push('A table row taller than the page was split across the boundary.');
        }
        if ((el.tagName === 'UL' || el.tagName === 'OL') && h > pageH + 2 && el.getAttribute('data-le-nosplit') !== '1') {
          if (splitList(el, pageH)) { changed = true; break; }
          el.setAttribute('data-le-nosplit', '1');
        }
        if (h > pageH + 2) {
          var img = el.tagName === 'IMG' ? el : el.querySelector && el.querySelector('img');
          if (img && img.getAttribute('data-le-shrunk') !== '1') {
            img.style.maxHeight = Math.max(40, pageH - 8) + 'px';
            img.style.maxWidth = '100%';
            img.style.objectFit = 'contain';
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.setAttribute('data-le-shrunk', '1');
            warnings.push('An image taller than the page was shrunk to fit.');
            changed = true;
            break;
          }
        }
        h = el.offsetHeight;
        var top = el.offsetTop;
        var pageStart = Math.floor(top / pageH) * pageH;
        if (pageStart < 0) pageStart = 0;
        var pageEnd = pageStart + pageH;
        if ((breakOn(el, 'before') || (el.getAttribute('style') || '').indexOf('break-before') >= 0) && top > pageStart + 1 && el.getAttribute('data-le-bb') !== '1') {
          insertSpacer(el, pageEnd - top);
          el.setAttribute('data-le-bb', '1');
          changed = true;
          break;
        }
        if (el.getAttribute('data-le-pushed') !== '1' && h <= pageH + 1 && top + h > pageEnd + 1 && top > pageStart + 2) {
          insertSpacer(el, pageEnd - top);
          el.setAttribute('data-le-pushed', '1');
          changed = true;
          break;
        }
        if (breakOn(el, 'after') && el.nextElementSibling && el.getAttribute('data-le-ba') !== '1') {
          var next = el.nextElementSibling;
          var nTop = next.offsetTop;
          var nStart = Math.floor(nTop / pageH) * pageH;
          if (nTop > nStart + 2) {
            insertSpacer(next, nStart + pageH - nTop);
            el.setAttribute('data-le-ba', '1');
            changed = true;
            break;
          }
        }
      }
      if (!changed) break;
    }
    var buckets = [];
    [].slice.call(flow.childNodes).forEach(function (node) {
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-le-spacer') === '1') return;
      if (node.nodeType === 3 && !String(node.textContent || '').replace(/\s/g, '')) return;
      var top = node.nodeType === 1 ? node.offsetTop : 0;
      var idx = Math.max(0, Math.floor((top + 0.5) / pageH));
      if (!buckets[idx]) buckets[idx] = [];
      buckets[idx].push(node.nodeType === 1 ? node.outerHTML : esc(node.textContent || ''));
    });
    var last = -1;
    for (var bi = 0; bi < buckets.length; bi++) if (buckets[bi] && buckets[bi].length) last = bi;
    var pages = [];
    for (var pj = 0; pj <= last; pj++) pages.push(buckets[pj] ? buckets[pj].join('') : '');
    if (!pages.length) pages.push(flow.innerHTML);
    if (pages.length > MAX_PAGES) {
      pages = pages.slice(0, MAX_PAGES);
      warnings.push('Stopped after ' + MAX_PAGES + ' pages.');
    }
    var slices = pages.map(function (html) { return { y: 0, h: pageH, html: html }; });
    return { slices: slices, html: flow.innerHTML, total: pages.length * pageH };
  }
  function layoutHtml(parsed, opts) {
    var page = resolvePage(opts);
    if ((opts.orientation || 'auto') === 'auto') page = resolvePage(Object.assign({}, opts, { orientation: 'portrait' }));
    if (normFit(opts.fit) === 'page' && (opts.orientation || '') === 'auto') {
      /* flow documents stay portrait unless the user picks landscape */
    }
    var margin = resolveMargin(opts);
    var warnings = (parsed.warnings || []).slice();
    if (margin.bumped) warnings.push('A little margin was added so the header or footer has room.');
    var scale = normScale(opts.scale);
    var contentW = Math.max(80, page.w - margin.left - margin.right);
    var contentH = Math.max(80, page.h - margin.top - margin.bottom);
    var contentWpx = Math.max(80, Math.floor(contentW * PX));
    var contentHpx = Math.max(80, Math.floor(contentH * PX));
    var css = flowCss(contentWpx, scale);
    return mountFrame('<div id="le-flow">' + (parsed.html || '') + '</div>', css, contentWpx, true).then(function (iframe) {
      var doc = iframe.contentDocument;
      return waitReady(doc).then(function () {
        var flow = doc.getElementById('le-flow');
        if (normFit(opts.fit) === 'page' && flow.scrollHeight > contentHpx + 2) {
          var z = contentHpx / flow.scrollHeight;
          flow.style.zoom = String(Math.max(0.2, Math.min(1, z)));
          warnings.push('Content was scaled down to fit on one page.');
        }
        var laid = paginateFlow(flow, contentHpx, warnings);
        var zoom = flow.style.zoom || '';
        iframe.parentNode.removeChild(iframe);
        return {
          kind: 'html',
          page: page,
          margin: margin,
          slices: laid.slices,
          html: laid.html,
          zoom: zoom,
          css: css,
          contentWpx: contentWpx,
          contentHpx: contentHpx,
          warnings: uniq(warnings),
          name: parsed.name
        };
      });
    });
  }
  function inkScore(canvas) {
    try {
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return 0;
      var data = ctx.getImageData(0, 0, w, h).data;
      var step = Math.max(1, Math.floor(Math.min(w, h) / 36));
      var ink = 0, n = 0;
      for (var y = 0; y < h; y += step) {
        for (var x = 0; x < w; x += step) {
          var i = (y * w + x) * 4;
          n++;
          if (data[i + 3] > 12 && (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248)) ink++;
        }
      }
      return n ? ink / n : 0;
    } catch (e) { return 1; }
  }
  function shoot(iframe, slice, w, scale) {
    var doc = iframe.contentDocument;
    var flow = doc.getElementById('le-flow');
    var h = slice.h;
    doc.body.style.margin = '0';
    doc.body.style.padding = '0';
    doc.body.style.width = w + 'px';
    doc.body.style.height = Math.ceil(h) + 'px';
    doc.body.style.overflow = 'hidden';
    doc.body.style.background = '#fff';
    flow.style.width = w + 'px';
    flow.style.marginTop = '0';
    flow.innerHTML = slice.html || '';
    iframe.style.width = Math.ceil(w) + 'px';
    iframe.style.height = Math.ceil(h) + 'px';
    return waitReady(doc).then(function () {
      return global.html2canvas(doc.body, {
        scale: scale,
        backgroundColor: '#ffffff',
        logging: false,
        width: Math.ceil(w),
        height: Math.ceil(h),
        windowWidth: Math.ceil(w),
        windowHeight: Math.ceil(h),
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        useCORS: false,
        allowTaint: true,
        imageTimeout: 12000,
        removeContainer: true
      });
    });
  }
function captureLayout(layout, scale, sandbox, onscreen) {
  var shell = '<div id="le-flow">' + layout.html + '</div>';
  return mountFrame(shell, layout.css, layout.contentWpx, sandbox, onscreen).then(function (iframe) {
return waitReady(iframe.contentDocument).then(function () {
      var flow = iframe.contentDocument.getElementById('le-flow');
      if (flow && layout.zoom) flow.style.zoom = layout.zoom;
      var chain = Promise.resolve([]);
        layout.slices.forEach(function (slice) {
          chain = chain.then(function (list) {
            return shoot(iframe, slice, layout.contentWpx, scale).then(function (canvas) {
              list.push(canvas);
              return list;
            });
          });
        });
        return chain.then(function (list) {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          return list;
        }, function (err) {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          throw err;
        });
      });
    });
  }
function captureHtml(layout, scale) {
  return loadH2C().then(function () {
    return captureLayout(layout, scale, true, false).then(function (canvases) {
      if (!pagesBlank(layout, canvases)) return canvases;
      return captureLayout(layout, scale, false, false).then(function (second) {
        if (!pagesBlank(layout, second)) return second;
        return captureLayout(layout, scale, false, true);
      });
    });
  });
}
  function pagesBlank(layout, canvases) {
    if (!canvases || !canvases.length) return true;
    for (var i = 0; i < canvases.length; i++) {
      var html = (layout.slices[i] && layout.slices[i].html) || layout.html || '';
      var texty = /[A-Za-z0-9]/.test(String(html).replace(/<[^>]+>/g, ''));
      if (texty && inkScore(canvases[i]) < 0.0008) return true;
    }
    return false;
  }
  function canvasBytes(canvas, quality) {
    var q = normQuality(quality);
    var mime = q >= 0.97 ? 'image/png' : 'image/jpeg';
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Could not encode a page')); return; }
        blob.arrayBuffer().then(function (buf) { resolve({ bytes: new Uint8Array(buf), mime: mime }); }, reject);
      }, mime, q);
    });
  }
  function drawChromePdf(page, opts, index, total, fileName, font) {
    var chrome = chromeOf(opts);
    if (!chrome.header && !chrome.footer) return Promise.resolve();
    var info = { page: index + 1, pages: total, date: dateStamp(), file: baseName(fileName).slice(0, 80) };
    var size = 9;
    var jobs = [];
    function paint(tpl, y, fallbackAlign) {
      var text = fillTemplate(tpl, info);
      if (!text) return;
      text = safeText(font, text, null);
      var max = page.getWidth() - 36;
      if (widthOf(font, text, size) > max) text = fitLine(font, text, size, max);
      var x = xAlign(templateAlign(tpl, fallbackAlign), page.getWidth(), widthOf(font, text, size), 18);
      page.drawText(text, { x: x, y: y, size: size, font: font, color: global.PDFLib.rgb(0.27, 0.27, 0.27) });
    }
    paint(chrome.header, page.getHeight() - 16, 'left');
    paint(chrome.footer, 10, 'center');
    return Promise.all(jobs);
  }
  function htmlPdf(parsed, opts) {
    var key = (parsed.key || '') + '|html|' + optKey(opts);
    if (layoutCache.has(key)) {
      return layoutCache.get(key).then(function (layout) { return rasterPdf(layout, opts, pdfScale()); });
    }
    var job = layoutHtml(parsed, opts);
    remember(layoutCache, key, job);
    job.catch(function () { layoutCache.delete(key); });
    return job.then(function (layout) { return rasterPdf(layout, opts, pdfScale()); });
  }
  function rasterPdf(layout, opts, scale) {
    return captureHtml(layout, scale).then(function (canvases) {
      return newDoc(layout.name).then(function (doc) {
        return doc.embedFont(global.PDFLib.StandardFonts.Helvetica).then(function (font) {
          var chain = Promise.resolve();
          var embedded = [];
          canvases.forEach(function (canvas, i) {
            chain = chain.then(function () {
              return canvasBytes(canvas, opts.imageQuality).then(function (img) {
                var embed = img.mime === 'image/png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
                return embed.then(function (pdfImg) {
                  var page = doc.addPage([layout.page.w, layout.page.h]);
                  var slice = layout.slices[i];
                  var hPt = slice.h / PX;
                  var wPt = layout.contentWpx / PX;
                  page.drawImage(pdfImg, {
                    x: layout.margin.left,
                    y: layout.page.h - layout.margin.top - hPt,
                    width: wPt,
                    height: hPt
                  });
                  embedded.push(page);
                });
              });
            });
          });
          return chain.then(function () {
            for (var i = 0; i < embedded.length; i++) drawChromePdf(embedded[i], opts, i, embedded.length, layout.name, font);
            return doc.save().then(function (bytes) {
              return { bytes: bytes, pageCount: embedded.length, warnings: layout.warnings || [] };
            });
          });
        });
      });
    });
  }
  function composePreview(layout, canvases, previewScale) {
    var s = previewScale;
    return canvases.map(function (content, i) {
      var cssW = layout.page.w * PX;
      var cssH = layout.page.h * PX;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(cssW * s));
      canvas.height = Math.max(1, Math.round(cssH * s));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      var dx = layout.margin.left * PX * s;
      var dy = layout.margin.top * PX * s;
      var dw = content.width;
      var dh = content.height;
      ctx.drawImage(content, dx, dy, dw, dh);
      paintCanvasChrome(ctx, canvas.width, canvas.height, s, layout, i, canvases.length);
      return canvas;
    });
  }
  function paintCanvasChrome(ctx, w, h, s, layout, index, total) {
    var chrome = chromeOf(layout.opts || {});
    if (!chrome.header && !chrome.footer) return;
    var info = { page: index + 1, pages: total, date: dateStamp(), file: baseName(layout.name || '').slice(0, 80) };
    ctx.fillStyle = '#444444';
    ctx.font = Math.max(8, 12 * s) + 'px Helvetica, Arial, sans-serif';
    function paint(tpl, y, fallback) {
      var text = fillTemplate(tpl, info);
      if (!text) return;
      var tw = ctx.measureText(text).width;
      var align = templateAlign(tpl, fallback);
      var x = 8 * s;
      if (align === 'center') x = Math.max(8, (w - tw) / 2);
      if (align === 'right') x = Math.max(8, w - tw - 8 * s);
      ctx.fillText(text, x, y);
    }
    paint(chrome.header, Math.max(12 * s, 16 * s), 'left');
    paint(chrome.footer, h - Math.max(6, 8 * s), 'center');
  }
  function htmlPreview(parsed, opts) {
    var key = (parsed.key || '') + '|html|' + optKey(opts);
    var layoutJob = layoutCache.has(key) ? layoutCache.get(key) : layoutHtml(parsed, opts);
    if (!layoutCache.has(key)) {
      remember(layoutCache, key, layoutJob);
      layoutJob.catch(function () { layoutCache.delete(key); });
    }
    var cssW = resolvePage(opts).w * PX;
    var preview = Math.max(0.3, Math.min(1, 800 / Math.max(200, cssW)));
    if (opts.previewScale) preview = Number(opts.previewScale) || preview;
    return layoutJob.then(function (layout) {
      layout.opts = opts;
      return captureHtml(layout, preview).then(function (canvases) {
        return { canvases: composePreview(layout, canvases, preview), warnings: layout.warnings, pageCount: canvases.length };
      });
    });
  }

  function slideFit(slide, page, margin, userScale) {
    var boxW = page.w - margin.left - margin.right;
    var boxH = page.h - margin.top - margin.bottom;
    var natW = slide.w * 72 / 96;
    var natH = slide.h * 72 / 96;
    var fit = Math.min(boxW / natW, boxH / natH) * userScale;
    if (natW * fit > boxW || natH * fit > boxH) fit = Math.min(boxW / natW, boxH / natH);
    var dw = natW * fit;
    var dh = natH * fit;
    return {
      x: margin.left + (boxW - dw) / 2,
      y: margin.bottom + (boxH - dh) / 2,
      w: dw,
      h: dh
    };
  }
  function slidesPdf(parsed, opts) {
    var page = resolvePage(opts);
    var first = parsed.slides && parsed.slides[0];
    if ((opts.orientation || 'auto') === 'auto' && first && first.w > first.h) page = asLandscape(page);
    var margin = resolveMargin(opts);
    var warnings = (parsed.warnings || []).slice();
    if (margin.bumped) warnings.push('A little margin was added so the header or footer has room.');
    var userScale = normScale(opts.scale);
    return loadH2C().then(function () { return newDoc(parsed.name); }).then(function (doc) {
      return doc.embedFont(global.PDFLib.StandardFonts.Helvetica).then(function (font) {
        var pages = [];
        var chain = Promise.resolve();
        (parsed.slides || []).forEach(function (slide) {
          chain = chain.then(function () {
            var css = 'html,body{margin:0;padding:0;background:' + (slide.bg || '#fff') + ';}';
            return mountFrame(slide.html, css, slide.w, true).then(function (iframe) {
              return waitReady(iframe.contentDocument).then(function () {
                var el = iframe.contentDocument.querySelector('.le-slide') || iframe.contentDocument.body;
                return global.html2canvas(el, {
                  scale: pdfScale(),
                  backgroundColor: slide.bg || '#ffffff',
                  logging: false,
                  width: Math.ceil(slide.w),
                  height: Math.ceil(slide.h),
                  windowWidth: Math.ceil(slide.w),
                  useCORS: false,
                  allowTaint: true,
                  imageTimeout: 12000
                }).then(function (canvas) {
                  if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                  if (inkScore(canvas) < 0.0008) {
                    return mountFrame(slide.html, css, slide.w, false).then(function (frame2) {
                      return waitReady(frame2.contentDocument).then(function () {
                        var el2 = frame2.contentDocument.querySelector('.le-slide') || frame2.contentDocument.body;
                        return global.html2canvas(el2, {
                          scale: pdfScale(), backgroundColor: slide.bg || '#ffffff', logging: false,
                          width: Math.ceil(slide.w), height: Math.ceil(slide.h), windowWidth: Math.ceil(slide.w),
                          useCORS: false, allowTaint: true
                        }).then(function (c2) {
                          if (frame2.parentNode) frame2.parentNode.removeChild(frame2);
                          return c2;
                        });
                      });
                    });
                  }
                  return canvas;
                });
              });
            }).then(function (canvas) {
              return canvasBytes(canvas, opts.imageQuality).then(function (img) {
                var embed = img.mime === 'image/png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
                return embed.then(function (pdfImg) {
                  var pdfPage = doc.addPage([page.w, page.h]);
                  var box = slideFit(slide, page, margin, userScale);
                  pdfPage.drawImage(pdfImg, { x: box.x, y: box.y, width: box.w, height: box.h });
                  pages.push(pdfPage);
                });
              });
            });
          });
        });
        return chain.then(function () {
          if (!pages.length) doc.addPage([page.w, page.h]);
          for (var i = 0; i < pages.length; i++) drawChromePdf(pages[i], opts, i, pages.length, parsed.name, font);
          return doc.save().then(function (bytes) {
            return { bytes: bytes, pageCount: Math.max(1, pages.length), warnings: uniq(warnings) };
          });
        });
      });
    });
  }
  function slidesPreview(parsed, opts) {
    var page = resolvePage(opts);
    var first = parsed.slides && parsed.slides[0];
    if ((opts.orientation || 'auto') === 'auto' && first && first.w > first.h) page = asLandscape(page);
    var margin = resolveMargin(opts);
    var userScale = normScale(opts.scale);
    var cssW = page.w * PX;
    var preview = opts.previewScale ? Number(opts.previewScale) : Math.max(0.28, Math.min(0.7, 720 / cssW));
    return loadH2C().then(function () {
      var canvases = [];
      var chain = Promise.resolve();
      (parsed.slides || []).forEach(function (slide, index) {
        chain = chain.then(function () {
          var css = 'html,body{margin:0;padding:0;background:' + (slide.bg || '#fff') + ';}';
          return mountFrame(slide.html, css, slide.w, true).then(function (iframe) {
            return waitReady(iframe.contentDocument).then(function () {
              var el = iframe.contentDocument.querySelector('.le-slide') || iframe.contentDocument.body;
              return global.html2canvas(el, {
                scale: Math.max(0.35, preview),
                backgroundColor: slide.bg || '#ffffff',
                logging: false,
                width: Math.ceil(slide.w),
                height: Math.ceil(slide.h),
                windowWidth: Math.ceil(slide.w),
                useCORS: false,
                allowTaint: true
              }).then(function (shotCanvas) {
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                var box = slideFit(slide, page, margin, userScale);
                var s = preview;
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(page.w * PX * s));
                canvas.height = Math.max(1, Math.round(page.h * PX * s));
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                var x = box.x * PX * s;
                var y = (page.h - box.y - box.h) * PX * s;
                ctx.drawImage(shotCanvas, x, y, box.w * PX * s, box.h * PX * s);
                var fake = { opts: opts, name: parsed.name, margin: margin, page: page };
                paintCanvasChrome(ctx, canvas.width, canvas.height, s, fake, index, parsed.slides.length);
                canvases.push(canvas);
              });
            });
          });
        });
      });
      return chain.then(function () {
        return { canvases: canvases, warnings: parsed.warnings || [], pageCount: canvases.length };
      });
    });
  }

  function blobOf(bytes, mime) {
    var copy = new Uint8Array(bytes);
    return new Blob([copy], { type: mime || 'application/octet-stream' });
  }
  function cleanSvg(text) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var root = doc.documentElement;
    if (!root || String(root.nodeName).toLowerCase() === 'parsererror') throw new Error('This SVG could not be read');
    var all = [].slice.call(doc.getElementsByTagName('*'));
    for (var i = all.length - 1; i >= 0; i--) {
      var n = all[i];
      var tag = String(n.localName || '').toLowerCase();
      if (tag === 'script' || tag === 'foreignobject' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'set' || tag === 'animate' || tag === 'animatetransform' || tag === 'animatemotion') {
        if (n.parentNode) n.parentNode.removeChild(n);
        continue;
      }
      var attrs = [].slice.call(n.attributes || []);
      for (var a = 0; a < attrs.length; a++) {
        var nm = attrs[a].name.toLowerCase();
        var val = attrs[a].value || '';
        if (nm.indexOf('on') === 0) n.removeAttribute(attrs[a].name);
        else if (nm === 'style') {
          var css = cleanCss(val);
          if (css) n.setAttribute('style', css);
          else n.removeAttribute(attrs[a].name);
        }
        else if ((nm === 'href' || nm.slice(-4) === 'href') && val && !isSafeUrl(val) && val.charAt(0) !== '#') n.removeAttribute(attrs[a].name);
        else if (/javascript\s*:/i.test(val)) n.removeAttribute(attrs[a].name);
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }
  function svgSize(text) {
    var vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(text);
    var w = /width\s*=\s*["']([0-9.]+)/i.exec(text);
    var h = /height\s*=\s*["']([0-9.]+)/i.exec(text);
    var ww = w ? parseFloat(w[1]) : 0;
    var hh = h ? parseFloat(h[1]) : 0;
    if ((!ww || !hh) && vb) {
      var bits = vb[1].replace(/,/g, ' ').split(/\s+/);
      if (bits.length >= 4) { ww = ww || parseFloat(bits[2]); hh = hh || parseFloat(bits[3]); }
    }
    if (!(ww > 1)) ww = 800;
    if (!(hh > 1)) hh = 600;
    return { w: ww, h: hh };
  }
  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('This image could not be decoded')); };
      img.src = src;
    });
  }
  function decodeImage(parsed) {
    var e = extOf(parsed.name);
    if (parsed.kind === 'svg' || e === 'svg') {
      var raw = textOf(parsed.bytes);
      var clean = cleanSvg(raw);
      var size = svgSize(clean);
      var url = URL.createObjectURL(new Blob([clean], { type: 'image/svg+xml' }));
      return loadImageEl(url).then(function (img) {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || size.w;
        var h = img.naturalHeight || size.h;
        return { img: img, w: w, h: h, bytes: parsed.bytes, mime: 'image/svg+xml', svg: true };
      });
    }
    var blob = blobOf(parsed.bytes, parsed.mime || mimeOf(parsed.name));
    if (global.createImageBitmap) {
      var opts = { imageOrientation: 'from-image' };
      return createImageBitmap(blob, opts).catch(function () { return createImageBitmap(blob); }).then(function (bmp) {
        return { img: bmp, w: bmp.width, h: bmp.height, bytes: parsed.bytes, mime: parsed.mime || mimeOf(parsed.name) };
      }).catch(function () {
        if (e === 'heic' || e === 'heif') throw new Error('This browser cannot decode HEIC. Export the photo as JPG or PNG and try again.');
        throw new Error('This image could not be decoded');
      });
    }
    var url = URL.createObjectURL(blob);
    return loadImageEl(url).then(function (img) {
      URL.revokeObjectURL(url);
      return { img: img, w: img.naturalWidth, h: img.naturalHeight, bytes: parsed.bytes, mime: parsed.mime || mimeOf(parsed.name) };
    });
  }
  function imageToPngBytes(img, w, h) {
    var sized = capCanvas(w, h);
    var canvas = document.createElement('canvas');
    canvas.width = sized.w;
    canvas.height = sized.h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasBytes(canvas, 1).then(function (out) {
      if (img.close) try { img.close(); } catch (e) {}
      return out.bytes;
    });
  }
  function imagePdf(parsed, opts) {
    return decodeImage(parsed).then(function (im) {
      return newDoc(parsed.name).then(function (doc) {
        return doc.embedFont(global.PDFLib.StandardFonts.Helvetica).then(function (font) {
          var fit = normFit(opts.fit);
          if (opts.pageSize === 'image') fit = 'image';
          var margin = resolveMargin(opts);
          var userScale = normScale(opts.scale);
          var dpi = num(opts.dpi, 96) || 96;
          var page;
          var warnings = (parsed.warnings || []).slice();
          if (margin.bumped) warnings.push('A little margin was added so the header or footer has room.');
          if (fit === 'image') {
            var wpt = im.w * 72 / dpi * userScale + margin.left + margin.right;
            var hpt = im.h * 72 / dpi * userScale + margin.top + margin.bottom;
            page = { w: Math.max(72, wpt), h: Math.max(72, hpt) };
          } else {
            page = resolvePage(opts);
            if ((opts.orientation || 'auto') === 'auto') {
              if (im.w > im.h && page.h > page.w) page = asLandscape(page);
              if (im.w <= im.h && page.w > page.h) page = { w: page.h, h: page.w, name: page.name, orientation: 'portrait' };
            }
          }
          var boxW = page.w - margin.left - margin.right;
          var boxH = page.h - margin.top - margin.bottom;
          var dw, dh, x, y;
          if (fit === 'image') {
            dw = im.w * 72 / dpi * userScale;
            dh = im.h * 72 / dpi * userScale;
            x = margin.left;
            y = margin.bottom;
          } else {
            var s = fit === 'width' ? boxW / im.w : Math.min(boxW / im.w, boxH / im.h);
            s *= userScale;
            dw = im.w * s;
            dh = im.h * s;
            if (dw > boxW || dh > boxH) {
              var clamp = Math.min(boxW / im.w, boxH / im.h);
              dw = im.w * clamp;
              dh = im.h * clamp;
              warnings.push('Scale was limited so the image stays on one page.');
            }
            x = margin.left + (boxW - dw) / 2;
            y = margin.bottom + (boxH - dh) / 2;
          }
          var e = extOf(parsed.name);
          var quality = normQuality(opts.imageQuality);
          var embedJob;
          if ((e === 'jpg' || e === 'jpeg') && quality >= 0.92 && !im.svg) embedJob = doc.embedJpg(im.bytes).catch(function () { return null; });
          else embedJob = Promise.resolve(null);
          return embedJob.then(function (existing) {
            var next = existing ? Promise.resolve(existing) : imageToPngBytes(im.img, im.w, im.h).then(function (png) { return doc.embedPng(png); });
            return next.then(function (pdfImg) {
              var pdfPage = doc.addPage([page.w, page.h]);
              pdfPage.drawImage(pdfImg, { x: x, y: y, width: dw, height: dh });
              drawChromePdf(pdfPage, opts, 0, 1, parsed.name, font);
              if (im.img && im.img.close) try { im.img.close(); } catch (err) {}
              return doc.save().then(function (bytes) {
                return { bytes: bytes, pageCount: 1, warnings: uniq(warnings) };
              });
            });
          });
        });
      });
    });
  }

  function pdfPass(parsed, opts) {
    return loadPdfLib().then(function () {
      return global.PDFLib.PDFDocument.load(parsed.bytes, { ignoreEncryption: true }).then(function (src) {
        var warnings = (parsed.warnings || []).slice();
        if (!wantsChrome(opts)) {
          return Promise.resolve({ bytes: parsed.bytes, pageCount: src.getPageCount(), warnings: warnings });
        }
        return global.PDFLib.PDFDocument.create().then(function (doc) {
          return doc.embedFont(global.PDFLib.StandardFonts.Helvetica).then(function (font) {
            var idx = src.getPageIndices();
            return doc.copyPages(src, idx).then(function (pages) {
              pages.forEach(function (p) { doc.addPage(p); });
              var added = doc.getPages();
              for (var i = 0; i < added.length; i++) drawChromePdf(added[i], opts, i, added.length, parsed.name, font);
              doc.setCreator('LocalEditor');
              doc.setProducer('LocalEditor');
              return doc.save().then(function (bytes) {
                return { bytes: bytes, pageCount: added.length, warnings: warnings };
              });
            });
          });
        });
      }).catch(function () {
        throw new Error('This PDF could not be opened. It may be encrypted or damaged.');
      });
    });
  }

  function renderPdf(parsed, opts) {
    opts = opts || {};
    if (parsed.mode === 'unsupported') return Promise.reject(new Error(parsed.note || 'This file type cannot be converted.'));
    if (parsed.mode === 'plain' || parsed.mode === 'richtext') return vectorPdf(parsed, opts);
    if (parsed.mode === 'sheets') {
      if (opts.sheets) {
        return sheetModelsFilter(parsed, opts).then(function (next) { return sheetsPdf(next, opts); });
      }
      return sheetsPdf(parsed, opts);
    }
    if (parsed.mode === 'html') return htmlPdf(parsed, opts);
    if (parsed.mode === 'slides') return slidesPdf(parsed, opts);
    if (parsed.mode === 'image') return imagePdf(parsed, opts);
    if (parsed.mode === 'pdf') return pdfPass(parsed, opts);
    return Promise.reject(new Error('This file type cannot be converted.'));
  }
  function sheetModelsFilter(parsed, opts) {
    var names = parsed.sheets.map(function (s) { return s.name; });
    var want = opts.sheets;
    var list = Array.isArray(want) ? want : [want];
    var picked = [];
    list.forEach(function (w) {
      if (typeof w === 'number' && parsed.sheets[w]) picked.push(parsed.sheets[w]);
      else {
        for (var i = 0; i < parsed.sheets.length; i++) if (parsed.sheets[i].name === String(w)) picked.push(parsed.sheets[i]);
      }
    });
    var warnings = (parsed.warnings || []).slice();
    if (!picked.length) {
      warnings.push('None of the chosen sheets were found, so every sheet is included.');
      picked = parsed.sheets;
    }
    return Promise.resolve({ mode: 'sheets', sheets: picked, warnings: uniq(warnings), name: parsed.name, key: parsed.key, kind: parsed.kind });
  }
  function buildPdf(file, opts) {
    var key = fileKey(file) + '|pdf|' + optKey(opts || {});
    if (pdfCache.has(key)) return pdfCache.get(key);
    var job = parseFile(file).then(function (parsed) {
      if (parsed.mode === 'sheets' && opts && opts.sheets) {
        return sheetModelsFilter(parsed, opts).then(function (next) { return renderPdf(next, Object.assign({}, opts, { sheets: null })); });
      }
      return renderPdf(parsed, opts || {});
    });
    remember(pdfCache, key, job);
    job.catch(function () { pdfCache.delete(key); });
    return job;
  }

  function openPdfJs(bytes) {
    return loadPdfJs().then(function () {
      var data = new Uint8Array(bytes);
      return global.pdfjsLib.getDocument({ data: data, isEvalSupported: false, verbosity: 0 }).promise;
    });
  }
  function pdfPreview(bytes, opts) {
    return openPdfJs(bytes).then(function (pdf) {
      var target = opts && opts.previewWidth ? Number(opts.previewWidth) : 720;
      try {
        if (global.LE && global.LE.perf && typeof global.LE.perf.previewMax === 'function') {
          target = Math.min(target, Math.max(320, global.LE.perf.previewMax() / 2));
        }
      } catch (e) {}
      var canvases = [];
      var chain = Promise.resolve();
      var count = Math.min(pdf.numPages, MAX_PAGES);
      for (var n = 1; n <= count; n++) {
        (function (n) {
          chain = chain.then(function () {
            return pdf.getPage(n).then(function (page) {
              var base = page.getViewport({ scale: 1 });
              var scale = target / Math.max(1, base.width);
              if (base.height * scale > 8192) scale = 8192 / Math.max(1, base.height);
              var vp = page.getViewport({ scale: scale });
              var canvas = document.createElement('canvas');
              canvas.width = Math.ceil(vp.width);
              canvas.height = Math.ceil(vp.height);
              var ctx = canvas.getContext('2d');
              return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                canvases.push(canvas);
              });
            });
          });
        })(n);
      }
      return chain.then(function () {
        try { pdf.destroy(); } catch (e2) {}
        return canvases;
      }, function (err) {
        try { pdf.destroy(); } catch (e3) {}
        throw err;
      });
    });
  }

  function blocksToPreviewHtml(parsed, opts) {
    if (parsed.mode === 'plain') {
      var body = sourceOf(parsed, opts);
      var lines = body.split('\n');
      if (parsed.lineNumbers && (!opts || opts.lineNumbers !== false)) {
        var rows = lines.map(function (line, i) {
          return '<div><span style="display:inline-block;width:3.2em;color:#888;">' + (i + 1) + '</span>' + esc(line || ' ') + '</div>';
        }).join('');
        return { html: '<div style="font-family:Consolas,ui-monospace,monospace;font-size:13px;line-height:1.45;white-space:pre-wrap;">' + rows + '</div>', css: 'body{margin:16px;color:#1a1a1a;background:#fff;}' };
      }
      return { html: '<pre style="white-space:pre-wrap;font-family:' + (parsed.mono ? 'Consolas,ui-monospace,monospace' : 'Georgia,serif') + ';">' + esc(body) + '</pre>', css: 'body{margin:16px;color:#1a1a1a;background:#fff;}' };
    }
    if (parsed.mode === 'richtext') {
      return { html: rtfHtml(parsed.paragraphs || []), css: flowCss(720, 1) };
    }
    if (parsed.mode === 'sheets') {
      var html = (parsed.sheets || []).map(function (sheet) {
        var head = '<tr>' + (sheet.rows[0] || []).map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>';
        var body = (sheet.rows || []).slice(1).map(function (row) {
          return '<tr>' + row.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
        }).join('');
        return '<h2>' + esc(sheet.name) + '</h2><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
      }).join('');
      return { html: html, css: flowCss(960, 1) };
    }
    if (parsed.mode === 'slides') {
      return {
        html: parsed.html || '',
        css: 'body{margin:12px;background:#e9e9e9;} .le-slide{margin:0 auto 12px auto;box-shadow:0 1px 4px rgba(0,0,0,.18);}',
        pages: parsed.pages || (parsed.slides || []).map(function (s) { return s.html; })
      };
    }
    if (parsed.mode === 'image') {
      return null;
    }
    if (parsed.mode === 'html') return { html: parsed.html || '', css: flowCss(760, 1), pages: parsed.pages };
    if (parsed.mode === 'pdf') return { html: '<p>This PDF is copied through without reflow.</p>', css: 'body{font:16px/1.4 sans-serif;margin:16px;}' };
    return { html: '<p>' + esc(parsed.note || '') + '</p>', css: 'body{font:16px/1.4 sans-serif;margin:16px;}' };
  }

  function htmlFromParsed(parsed, opts) {
    var view = blocksToPreviewHtml(parsed, opts) || { html: '', css: '' };
    return { html: view.html || '', css: view.css || '', pages: view.pages || parsed.pages || null, warnings: uniq(parsed.warnings || []) };
  }

  function toPDF(file, opts) {
    opts = opts || {};
    if (opts.vector) return printDocument(file, opts);
    return buildPdf(file, opts);
  }
  function previewPages(file, opts) {
    opts = opts || {};
    return parseFile(file).then(function (parsed) {
      if (parsed.mode === 'unsupported') return Promise.reject(new Error(parsed.note || 'This file type cannot be converted.'));
      if (parsed.mode === 'html') return htmlPreview(parsed, opts).then(function (r) { return r.canvases; });
      if (parsed.mode === 'slides') return slidesPreview(parsed, opts).then(function (r) { return r.canvases; });
      var built = parsed.mode === 'sheets' && opts.sheets
        ? sheetModelsFilter(parsed, opts).then(function (next) { return renderPdf(next, Object.assign({}, opts, { sheets: null })); })
        : buildPdf(file, opts);
      return built.then(function (pdf) { return pdfPreview(pdf.bytes, opts); });
    });
  }
  function many(files, opts) {
    files = [].slice.call(files || []);
    if (!files.length) return Promise.reject(new Error('No files to convert'));
    opts = Object.assign({}, opts || {}, { vector: false });
    return loadPdfLib().then(function () {
      return global.PDFLib.PDFDocument.create().then(function (doc) {
        var warnings = [];
        var count = 0;
        var chain = Promise.resolve();
        files.forEach(function (file, i) {
          chain = chain.then(function () {
            var label = file && file.name ? file.name : ('File ' + (i + 1));
            return toPDF(file, opts).then(function (res) {
              (res.warnings || []).forEach(function (w) { warnings.push(label + ': ' + w); });
              return global.PDFLib.PDFDocument.load(res.bytes, { ignoreEncryption: true }).then(function (src) {
                var idx = src.getPageIndices();
                return doc.copyPages(src, idx).then(function (pages) {
                  pages.forEach(function (p) { doc.addPage(p); });
                  count += pages.length;
                });
              });
            }).catch(function (err) {
              throw new Error(label + ': ' + (err && err.message ? err.message : 'could not convert'));
            });
          });
        });
        return chain.then(function () {
          doc.setCreator('LocalEditor');
          doc.setProducer('LocalEditor');
          return doc.save().then(function (bytes) {
            return { bytes: bytes, pageCount: count, warnings: uniq(warnings) };
          });
        });
      });
    });
  }

  var printFrame = null;
  function printDocument(file, opts) {
    opts = opts || {};
    return toHTMLPublic(file, Object.assign({}, opts, { vector: false })).then(function (view) {
      var page = resolvePage(opts);
      var margin = resolveMargin(opts);
      function inch(pt) { return (pt / 72).toFixed(3) + 'in'; }
      var pageCss = '@page{size:' + inch(page.w) + ' ' + inch(page.h) + ';margin:' + inch(margin.top) + ' ' + inch(margin.right) + ' ' + inch(margin.bottom) + ' ' + inch(margin.left) + ';}';
      var css = pageCss + (view.css || '') + '@media print{body{background:#fff;}}';
      if (printFrame && printFrame.parentNode) printFrame.parentNode.removeChild(printFrame);
      var iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
      iframe.setAttribute('title', 'Print preview');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + String(css || '').replace(/<\/\s*/gi, '') + '</style></head><body>' + (view.html || '') + '</body></html>';
      document.body.appendChild(iframe);
      printFrame = iframe;
      return new Promise(function (resolve) {
        iframe.onload = function () {
          setTimeout(function () {
            try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
            catch (e) { view.warnings = (view.warnings || []).concat(['The print dialog could not be opened.']); }
            resolve({
              bytes: null,
              pageCount: view.pages ? view.pages.length : null,
              warnings: uniq((view.warnings || []).concat(['The print dialog uses the browser’s pagination, which can differ from the pictured pages.'])),
              printed: true
            });
          }, 200);
        };
        iframe.srcdoc = html;
      });
    });
  }

  function btoaSafe(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  var imageHtml = function (parsed) {
    return decodeImage(parsed).then(function (im) {
      return imageToPngBytes(im.img, im.w, im.h).then(function (png) {
        return { html: '<img alt="" src="data:image/png;base64,' + btoaSafe(png) + '">', css: 'body{margin:0;background:#fff;} img{max-width:100%;height:auto;}', warnings: uniq(parsed.warnings || []) };
      });
    }).catch(function (err) {
      return { html: '', css: '', warnings: uniq((parsed.warnings || []).concat([err.message || 'Image could not be previewed'])) };
    });
  };

  var toHTMLPublic = function (file, opts) {
    opts = opts || {};
    return parseFile(file).then(function (parsed) {
      if (parsed.mode === 'sheets' && opts.sheets) {
        return sheetModelsFilter(parsed, opts).then(function (next) { return htmlFromParsed(next, opts); });
      }
      if (parsed.mode === 'image') return imageHtml(parsed);
      return htmlFromParsed(parsed, opts);
    });
  };

  LE.convert = {
    detect: detect,
    toHTML: toHTMLPublic,
    toPDF: toPDF,
    previewPages: previewPages,
    many: many,
    print: function (file, opts) { return printDocument(file, opts || {}); },
    pageSizes: ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'],
    options: {
      pageSize: 'A3 | A4 | A5 | Letter | Legal | Tabloid | custom | image. custom uses pageMm or {w,h,unit?:pt|mm|in}. {w,h} alone is PDF points.',
      orientation: 'portrait | landscape | auto. auto keeps text portrait, matches images and slides, and turns wide sheets sideways.',
      margin: 'none | small (10mm) | normal (16mm) | wide (25.4mm) | custom. custom reads marginMm as a number or {top,right,bottom,left} in mm.',
      scale: 'Percent. 100 is natural. Values from 0.25 through 3 are a ratio instead (1 = 100%).',
      fit: 'width | page | image. Images: width or whole page, or a page the size of the image. HTML fit page scales the flow onto one page.',
      header: 'String or {text, align}. Tokens {page} {pages} {date} {file}.',
      footer: 'Same as header. align defaults to center.',
      pageNumbers: 'When true and footer is empty, footer becomes {page} / {pages}.',
      imageQuality: 'JPEG quality 0.2–1 or 20–100. Values at or above 0.97 embed PNG. PNG and SVG images stay lossless.',
      sheets: 'Spreadsheet names or zero-based indexes to include.',
      lineNumbers: 'Code files number lines unless this is false.',
      pretty: 'JSON is pretty-printed. Invalid JSON is shown raw with a warning.',
      vector: 'On toPDF, open the browser print dialog (selectable text) instead of returning PDF bytes.',
      previewWidth: 'Pixel width of vector-PDF preview canvases (default 720).',
      dpi: 'Pixels per inch when fit is image (default 96).'
    }
  };
})(window);
